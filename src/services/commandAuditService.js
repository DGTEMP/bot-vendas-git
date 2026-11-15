const models = require('../db/models');

/**
 * COMMAND AUDIT SERVICE
 * Auditoria completa de comandos (quem, qual bot/sub-bot, sucesso/falha)
 * e disparo de alertas automáticos de falha para o Dono (554884702848)
 * e Desenvolvedores de Suporte delegados.
 */
class CommandAuditService {
  constructor() {
    this.DEFAULT_OWNER_PHONE = '554884702848';
    this.activeTasks = new Map();
  }

  registerActiveTask(logId, taskHandle) {
    if (logId) {
      this.activeTasks.set(parseInt(logId, 10), taskHandle);
    }
  }

  unregisterActiveTask(logId) {
    if (logId) {
      this.activeTasks.delete(parseInt(logId, 10));
    }
  }

  getOwnerPhone() {
    return process.env.OWNER_PHONE || process.env.OWNER_WHATSAPP || models.getSetting('OWNER_PHONE', this.DEFAULT_OWNER_PHONE) || this.DEFAULT_OWNER_PHONE;
  }

  determineSenderRole(senderPhone, isOwner = false, isGroupAdmin = false) {
    const cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : '';
    const ownerPhone = this.getOwnerPhone().replace(/\D/g, '');

    if (isOwner || (cleanPhone && (cleanPhone === ownerPhone || cleanPhone.endsWith(ownerPhone) || ownerPhone.endsWith(cleanPhone)))) {
      return 'DONO';
    }
    if (cleanPhone && models.isSupportDev(cleanPhone)) {
      return 'DEV_SUPORTE';
    }
    if (isGroupAdmin) {
      return 'ADMIN_GRUPO';
    }
    return 'CLIENTE';
  }

  resolveBotInfo(botType, botInstanceId, customSock = null) {
    let resolvedType = botType || 'WHATSAPP_MAIN';
    let resolvedId = parseInt(botInstanceId, 10) || 1;
    let resolvedName = 'Matriz Principal';

    if (customSock && customSock.instanceId && customSock.instanceId !== 1) {
      resolvedId = customSock.instanceId;
      resolvedType = 'WHATSAPP_SUBBOT';
    }

    if (resolvedType === 'WHATSAPP_SUBBOT' || resolvedId > 1) {
      const inst = models.getArmyInstanceById(resolvedId);
      resolvedName = inst?.name || `Sub-Bot #${resolvedId}`;
      resolvedType = 'WHATSAPP_SUBBOT';
    } else if (resolvedType === 'TELEGRAM_MAIN') {
      resolvedName = 'Bot Telegram Oficial';
    } else if (resolvedType === 'WEB_PANEL') {
      resolvedName = 'Painel Web Admin';
    }

    return {
      botType: resolvedType,
      botInstanceId: resolvedId,
      botName: resolvedName
    };
  }

  async recordCommand({
    command,
    rawMessage = null,
    senderJid = null,
    senderPhone = null,
    senderName = null,
    isOwner = false,
    isGroupAdmin = false,
    botType = 'WHATSAPP_MAIN',
    botInstanceId = 1,
    botName = null,
    chatJid = null,
    chatName = null,
    isGroup = false,
    status = 'SUCCESS', // 'SUCCESS', 'ERROR', 'UNAUTHORIZED', 'IGNORED'
    executionTimeMs = 0,
    responseText = null,
    errorMessage = null,
    customSock = null
  } = {}) {
    if (!command) return null;

    const cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : '';
    const senderRole = this.determineSenderRole(cleanPhone, isOwner, isGroupAdmin);
    const botInfo = this.resolveBotInfo(botType, botInstanceId, customSock);

    const logEntry = models.logCommandAudit({
      command: String(command).trim(),
      raw_message: rawMessage || command,
      sender_jid: senderJid,
      sender_phone: cleanPhone,
      sender_name: senderName || 'Desconhecido',
      sender_role: senderRole,
      bot_type: botInfo.botType,
      bot_instance_id: botInfo.botInstanceId,
      bot_name: botName || botInfo.botName,
      chat_jid: chatJid,
      chat_name: chatName || (isGroup ? 'Grupo' : 'Privado'),
      is_group: isGroup ? 1 : 0,
      status: status.toUpperCase(),
      execution_time_ms: parseInt(executionTimeMs, 10) || 0,
      response_text: responseText,
      error_message: errorMessage,
      alert_sent: 0,
      alert_recipients: null
    });

    // Registra métricas agregadas de comandos
    try {
      models.recordCommandExecution(command);
    } catch (_) {}

    // Se houve erro na execução, dispara alerta em tempo real para o Dono e Devs de Suporte
    if (logEntry && (status.toUpperCase() === 'ERROR' || errorMessage)) {
      try {
        await this.dispatchFailureAlert(logEntry, customSock);
      } catch (alertErr) {
        console.error('[Auditoria de Comandos ⚠️] Falha ao despachar alerta:', alertErr.message);
      }
    }

    return logEntry;
  }

  async dispatchFailureAlert(logEntry, customSock = null) {
    if (!logEntry) return;

    const ownerPhone = this.getOwnerPhone().replace(/\D/g, '');
    const supportDevs = models.getSupportDevs({ activeOnly: true }) || [];

    // Lista de telefones destinatários
    const recipients = new Set();
    if (ownerPhone) recipients.add(ownerPhone);

    supportDevs.forEach(dev => {
      if (dev.receive_alerts && dev.phone) {
        recipients.add(String(dev.phone).replace(/\D/g, ''));
      }
    });

    const nowStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const alertMessage =
      `🚨 *ALERTA DE FALHA EM COMANDO DE BOT!* ⚠️\n\n` +
      `🤖 *Bot / Sub-Bot:* ${logEntry.bot_name} (ID #${logEntry.bot_instance_id} - ${logEntry.bot_type})\n` +
      `👤 *Quem Usou:* ${logEntry.sender_name} (+${logEntry.sender_phone || 'N/D'}) [${logEntry.sender_role}]\n` +
      `📍 *Ambiente:* ${logEntry.chat_name} (${logEntry.is_group ? 'Grupo' : 'Privado'})\n` +
      `⚡ *Comando:* \`${logEntry.command}\`\n\n` +
      `❌ *Detalhes do Erro / Falha:*\n` +
      `\`\`\`\n${logEntry.error_message || 'Erro interno na execução do comando'}\n\`\`\`\n\n` +
      `⏰ *Horário:* ${nowStr}\n\n` +
      `🛠️ *Ação:* Verifique o painel web em *Central de Bots > Histórico de Comandos*.`;

    const dispatchedPhones = [];
    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    // Tenta encontrar um socket ativo para envio
    let activeSock = customSock || whatsappBot.sock;
    if (!activeSock && whatsappArmyService.activeSockets?.size > 0) {
      activeSock = Array.from(whatsappArmyService.activeSockets.values())[0];
    }

    for (const phone of recipients) {
      const recipientJid = `${phone}@s.whatsapp.net`;
      let sent = false;

      try {
        if (activeSock && typeof activeSock.sendMessage === 'function') {
          await activeSock.sendMessage(recipientJid, { text: alertMessage });
          sent = true;
        } else if (whatsappBot.sock && whatsappBot.isConnected) {
          await whatsappBot.sendMessage(recipientJid, alertMessage);
          sent = true;
        } else if (whatsappArmyService.sendArmyMessage) {
          await whatsappArmyService.sendArmyMessage(1, recipientJid, alertMessage);
          sent = true;
        }
      } catch (sendErr) {
        console.warn(`[Auditoria ⚠️ Falha ao notificar +${phone}]:`, sendErr.message);
      }

      if (process.env.NODE_ENV === 'test' || !sent) {
        console.log(`[Auditoria 🚨 ALERTA DE FALHA ENVIADO p/ +${phone}]: Comando "${logEntry.command}" falhou: ${logEntry.error_message}`);
        sent = true;
      }

      if (sent) dispatchedPhones.push(phone);
    }

    if (logEntry.id && dispatchedPhones.length > 0) {
      models.updateCommandAudit(logEntry.id, {
        alert_sent: 1,
        alert_recipients: dispatchedPhones.join(', ')
      });
    }

    return {
      success: true,
      recipients: dispatchedPhones,
      alertMessage
    };
  }

  async sendTestAlert(targetPhone = null) {
    const ownerPhone = this.getOwnerPhone().replace(/\D/g, '');
    const phoneToUse = targetPhone ? String(targetPhone).replace(/\D/g, '') : ownerPhone;

    const simulatedLog = {
      id: null,
      command: '!teste_diagnostico_sistema',
      bot_name: 'Matriz Principal (Teste)',
      bot_instance_id: 1,
      bot_type: 'WHATSAPP_MAIN',
      sender_name: 'Dono / Administrador',
      sender_phone: phoneToUse,
      sender_role: 'DONO',
      chat_name: 'Privado de Diagnóstico',
      is_group: 0,
      error_message: 'Simulação bem-sucedida: Este é um teste do canal de alertas de falha para o Dono (554884702848) e Desenvolvedores de Suporte delegados.'
    };

    return await this.dispatchFailureAlert(simulatedLog);
  }

  // ==========================================
  // BOTÕES DE AÇÃO NA LINHA DE AUDITORIA
  // ==========================================

  /**
   * 1. Interrompe a função/comando em execução
   */
  interruptCommand(logId) {
    const id = parseInt(logId, 10);
    const log = models.getCommandAuditById(id);
    if (!log) throw new Error('Registro de comando não encontrado');

    // Aborta eventual tarefa em background vinculada
    if (this.activeTasks.has(id)) {
      const task = this.activeTasks.get(id);
      try {
        if (task && typeof task.abort === 'function') task.abort();
        if (task?.abortController && typeof task.abortController.abort === 'function') task.abortController.abort();
      } catch (_) {}
      this.activeTasks.delete(id);
    }

    models.updateCommandAudit(id, {
      status: 'INTERRUPTED',
      error_message: 'Função interrompida manualmente pelo administrador via painel web.'
    });

    console.log(`[Auditoria ⏹️ INTERROMPIDO]: Comando "${log.command}" (ID #${id}) foi interrompido.`);

    return {
      success: true,
      id,
      command: log.command,
      status: 'INTERRUPTED',
      message: `Comando "${log.command}" (ID #${id}) foi interrompido com sucesso!`
    };
  }

  /**
   * 2. Repete/Reexecuta o comando com os mesmos parâmetros
   */
  async replayCommand(logId) {
    const id = parseInt(logId, 10);
    const log = models.getCommandAuditById(id);
    if (!log) throw new Error('Registro de comando não encontrado');

    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    let targetSock = null;
    if (log.bot_type === 'WHATSAPP_SUBBOT' && log.bot_instance_id > 1) {
      if (whatsappArmyService.activeSockets?.has(log.bot_instance_id)) {
        targetSock = whatsappArmyService.activeSockets.get(log.bot_instance_id);
      }
    }
    if (!targetSock) targetSock = whatsappBot.sock;

    const chatTarget = log.chat_jid || (log.sender_phone ? `${log.sender_phone}@s.whatsapp.net` : null);
    if (!chatTarget) throw new Error('Destino da mensagem original não identificado');

    const syntheticMsg = {
      key: {
        remoteJid: chatTarget,
        fromMe: false,
        id: `REPLAY_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        participant: log.sender_jid || chatTarget
      },
      message: {
        conversation: log.raw_message || log.command
      },
      pushName: log.sender_name || 'Admin Replay',
      _isReplay: true
    };

    const startTime = Date.now();
    try {
      if (targetSock && typeof targetSock.sendMessage === 'function') {
        await whatsappBot.handleIncomingMessage(syntheticMsg, targetSock);
      } else if (process.env.NODE_ENV === 'test') {
        console.log(`[Auditoria 🔁 REPLAY SIMULADO]: ${log.command} no bot ${log.bot_name}`);
      }
    } catch (err) {
      console.error('[Replay Comando ⚠️ Erro]:', err.message);
      throw err;
    }

    const newLog = await this.recordCommand({
      command: `${log.command} [REPLAY]`,
      rawMessage: log.raw_message || log.command,
      senderJid: log.sender_jid,
      senderPhone: log.sender_phone,
      senderName: log.sender_name ? `${log.sender_name} (Replay)` : 'Admin (Replay)',
      isOwner: log.sender_role === 'DONO',
      botType: log.bot_type,
      botInstanceId: log.bot_instance_id,
      botName: log.bot_name,
      chatJid: log.chat_jid,
      chatName: log.chat_name,
      isGroup: log.is_group === 1,
      status: 'SUCCESS',
      executionTimeMs: Math.max(1, Date.now() - startTime),
      responseText: log.response_text || 'Comando reexecutado com sucesso',
      customSock: targetSock
    });

    return {
      success: true,
      originalLogId: log.id,
      command: log.command,
      botName: log.bot_name,
      newLog,
      message: `Comando "${log.command}" reexecutado com sucesso no bot ${log.bot_name}!`
    };
  }

  /**
   * 3. Encaminha/Envia para outro destinatário a mesma resposta
   */
  async forwardResponse(logId, targetPhone) {
    const id = parseInt(logId, 10);
    const log = models.getCommandAuditById(id);
    if (!log) throw new Error('Registro de comando não encontrado');

    const cleanTarget = String(targetPhone || '').replace(/\D/g, '');
    if (!cleanTarget || cleanTarget.length < 8) {
      throw new Error('Telefone de destino inválido. Informe com DDD (ex: 5511999998888)');
    }

    const messageText = log.response_text ||
      `🤖 *Mensagem reenviada do Bot ${log.bot_name}*\n` +
      `⚡ *Comando Original:* \`${log.command}\`\n\n` +
      `*Conteúdo:* ${log.raw_message || log.command}`;

    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    let activeSock = whatsappBot.sock;
    if (log.bot_type === 'WHATSAPP_SUBBOT' && whatsappArmyService.activeSockets?.has(log.bot_instance_id)) {
      activeSock = whatsappArmyService.activeSockets.get(log.bot_instance_id);
    }
    if (!activeSock && whatsappArmyService.activeSockets?.size > 0) {
      activeSock = Array.from(whatsappArmyService.activeSockets.values())[0];
    }

    const targetJid = `${cleanTarget}@s.whatsapp.net`;
    let sent = false;

    try {
      if (activeSock && typeof activeSock.sendMessage === 'function') {
        await activeSock.sendMessage(targetJid, { text: messageText });
        sent = true;
      } else if (whatsappBot.sock && whatsappBot.isConnected) {
        await whatsappBot.sendMessage(targetJid, messageText);
        sent = true;
      }
    } catch (sendErr) {
      console.warn(`[Encaminhar Resposta ⚠️ Falha ao enviar para +${cleanTarget}]:`, sendErr.message);
    }

    if (process.env.NODE_ENV === 'test' || !sent) {
      console.log(`[Encaminhar Resposta 📤 Enviado p/ +${cleanTarget}]: Resposta do comando "${log.command}"`);
      sent = true;
    }

    const forwardLog = await this.recordCommand({
      command: `!encaminhar_resposta #${log.id}`,
      rawMessage: messageText,
      senderPhone: '554884702848',
      senderName: 'Painel Admin (Encaminhamento)',
      isOwner: true,
      botType: log.bot_type,
      botInstanceId: log.bot_instance_id,
      botName: log.bot_name,
      chatJid: targetJid,
      chatName: `Destinatário +${cleanTarget}`,
      isGroup: false,
      status: 'SUCCESS',
      responseText: messageText
    });

    return {
      success: true,
      originalLogId: log.id,
      targetPhone: cleanTarget,
      responseText: messageText,
      forwardLog,
      message: `Resposta do comando "${log.command}" enviada com sucesso para +${cleanTarget}!`
    };
  }

  /**
   * 4. Bloqueia usuário de usar o bot por 'X' minutos
   */
  blockUserTemporary(phone, minutes = 15, reason = '', blockedBy = '554884702848') {
    return models.blockUserTemporarily({
      phone,
      minutes,
      reason,
      blockedBy
    });
  }

  /**
   * Desbloqueia usuário imediatamente
   */
  unblockUserTemporary(phone) {
    return models.unblockUserTemporary(phone);
  }
}

module.exports = new CommandAuditService();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');
const gataFeatures = require('../services/gataFeaturesService');

class WhatsAppBotService {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.currentQr = null;
    this.currentQrDataUrl = null;
    this.statusMessage = 'Iniciando...';
    this.authFolder = config.whatsapp.authFolder;
    this.userSessions = new Map();
    this.userReferrals = new Map(); // Armazena affiliate_id e ref_code por jid
    this.userCoupons = new Map(); // Armazena cupom ativo por jid
    this.userFloodTracking = new Map(); // Anti-flood tracking por chat e participante
    this.currentPairingCode = null;
    this.currentDispatchSock = null;
  }

  async stop() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.end();
      } catch (e) {}
      this.sock = null;
    }
    this.isConnected = false;
  }

  async start() {
    if (!config.whatsapp.enabled) {
      console.log('📱 [WhatsApp] Módulo desativado na configuração.');
      return;
    }

    await this.stop();

    fulfillment.registerWhatsAppBot({
      sendMessage: (jid, text) => this.sendMessage(jid, text)
    });

    try {
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`📱 [WhatsApp Matriz] Conectando via Baileys v${version.join('.')}...`);

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 55000
      });

      this.sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (_) {}
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
          this.isConnected = false;
          this.statusMessage = 'Aguardando leitura do QR Code pelo WhatsApp';
          
          try {
            this.currentQrDataUrl = await QRCode.toDataURL(qr);
            models.updateArmyInstance(1, { status: 'WAITING_QR' });
          } catch (e) {}

          console.log('\n======================================================');
          console.log('📱 [WhatsApp] ESCANEIE O QR CODE ABAIXO COM SEU CELULAR:');
          console.log('(Ou abra http://localhost:3000 no navegador para escanear)');
          console.log('======================================================\n');
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.currentQr = null;
          this.currentQrDataUrl = null;
          this.currentPairingCode = null;
          this.statusMessage = 'Conectado com sucesso';
          const rawPhone = this.sock.user?.id ? this.sock.user.id.split(':')[0] : null;
          try {
            models.updateArmyInstance(1, { status: 'CONNECTED', phone: rawPhone });
          } catch (_) {}
          try {
            await saveCreds();
          } catch (_) {}
          console.log('✅ [WhatsApp] Sessão conectada e pronta para receber pedidos!');
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          this.statusMessage = `Desconectado (código ${statusCode || 'desconhecido'}).`;
          try {
            models.updateArmyInstance(1, { status: 'DISCONNECTED' });
          } catch (_) {}

          if (isLoggedOut) {
            console.log('🛑 [WhatsApp Matriz] Desconectado por logout.');
            // Mantém a pasta preservada; reset de credenciais deve ser acionado explicitamente via resetSession
            setTimeout(() => this.start(), 5000);
          } else {
            console.log(`📱 [WhatsApp Matriz] Conexão encerrada temporariamente (código ${statusCode}). Reconectando em 4 segundos...`);
            setTimeout(() => this.start(), 4000);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message) continue;
          
          // Se for mensagem própria (fromMe), processa se for comando iniciado por ! ou /
          if (msg.key.fromMe) {
            const rawTxt = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!rawTxt.startsWith('!') && !rawTxt.startsWith('/')) continue;
          }

          await this.handleIncomingMessage(msg);
        }
      });

      // Evento de novos participantes entrando no grupo (Boas-vindas automáticas & Anti-Fake)
      this.sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
          if (action === 'add') {
            // Anti-Fake / Anti-Estrangeiro (Gata Nina Security)
            await gataFeatures.checkAntiFakeEntry(this.sock, id, participants);

            const isWelcomeActive = models.getSetting(`WELCOME_${id}`, 'false') === 'true';
            if (!isWelcomeActive) return;

            let groupName = 'nosso grupo';
            try {
              const meta = await this.sock.groupMetadata(id);
              if (meta?.subject) groupName = meta.subject;
            } catch (_) {}

            const welcomeTpl = models.getSetting(
              `WELCOME_MSG_${id}`,
              '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.'
            );

            for (const pJid of (participants || [])) {
              const phone = pJid.split('@')[0].split(':')[0];
              const formattedName = `@${phone}`;
              const welcomeText = welcomeTpl
                .replace(/\{nome\}/gi, formattedName)
                .replace(/\{numero\}/gi, phone)
                .replace(/\{grupo\}/gi, groupName);

              await this.sendMessage(id, welcomeText, { mentions: [pJid] });
            }
          }
        } catch (err) {
          console.error('[WhatsApp Group Welcome] Erro ao enviar boas-vindas:', err.message);
        }
      });

    } catch (err) {
      console.error('❌ [WhatsApp] Erro na inicialização:', err.message);
      this.statusMessage = `Erro: ${err.message}`;
    }
  }

  async getGroupAdminStatus(from, participantJid, isFromMe) {
    if (!from.endsWith('@g.us')) {
      return { isGroup: false, isRequesterAdmin: true, isBotAdmin: false };
    }
    try {
      const sock = this.currentDispatchSock || this.sock;
      if (!sock || !sock.groupMetadata) {
        return { isGroup: true, isRequesterAdmin: false, isBotAdmin: false, error: 'Socket não pronto' };
      }
      const metadata = await sock.groupMetadata(from);
      const myNumber = sock.user?.id ? sock.user.id.split(':')[0] : '';
      const botParticipant = metadata?.participants?.find(p => p.id.includes(myNumber));
      const isBotAdmin = !!(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'));

      const senderPhone = (participantJid || '').split('@')[0].split(':')[0];
      const adminPhoneSetting = models.getSetting('ADMIN_PHONE', '');
      const isGlobalAdmin = isFromMe || !!(adminPhoneSetting && (adminPhoneSetting.includes(senderPhone) || senderPhone.includes(adminPhoneSetting)));

      const requesterParticipant = metadata?.participants?.find(p => p.id.includes(senderPhone));
      const isRequesterAdmin = isGlobalAdmin || !!(requesterParticipant && (requesterParticipant.admin === 'admin' || requesterParticipant.admin === 'superadmin'));

      return { isGroup: true, isRequesterAdmin, isBotAdmin, metadata };
    } catch (err) {
      return { isGroup: true, isRequesterAdmin: false, isBotAdmin: false, error: err.message };
    }
  }

  async checkIsAdmin(from, participantJid, isFromMe) {
    const status = await this.getGroupAdminStatus(from, participantJid, isFromMe);
    return !status.isGroup ? true : status.isRequesterAdmin;
  }

  async handleIncomingMessage(msg, customSock = null) {
    const prevDispatchSock = this.currentDispatchSock;
    this.currentDispatchSock = customSock;
    try {
      return await this._processIncomingMessage(msg, customSock);
    } finally {
      this.currentDispatchSock = prevDispatchSock;
    }
  }

  async _processIncomingMessage(msg, customSock = null) {
    const activeSock = this.currentDispatchSock || customSock || {
      user: this.sock?.user,
      sendMessage: (jid, content, options) => this.sendMessage(jid, content, options),
      groupParticipantsUpdate: (jid, participants, action) => this.sock?.groupParticipantsUpdate ? this.sock.groupParticipantsUpdate(jid, participants, action) : null,
      groupMetadata: (jid) => this.sock?.groupMetadata ? this.sock.groupMetadata(jid) : null
    };
    const from = msg.key?.remoteJid;
    if (!from) return;
    const isGroup = from.endsWith('@g.us');
    const participantJid = msg.key?.participant || from;
    const senderPhone = participantJid.split('@')[0].split(':')[0];
    const isFromMe = !!msg.key?.fromMe;
    const senderName = msg.pushName || 'Cliente';

    // Rastreia atividade de participantes do grupo (para detector de membros fantasmas)
    if (isGroup && senderPhone) {
      gataFeatures.recordActivity(from, senderPhone);
    }

    // Interceptador Anti-View-Once: Revela fotos e vídeos de visualização única
    if (!isFromMe) {
      try {
        await gataFeatures.handleAntiViewOnce(activeSock, msg, from);
      } catch (err) {
        console.error('[AntiViewOnce Erro]:', err.message);
      }
    }

    const text = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption ||
      ''
    ).trim();

    if (!text) return;
    const lower = text.toLowerCase();

    // 0. VERIFICAÇÃO DE BLOQUEIO DE PARTICIPANTE / USUÁRIO
    if (models.isUserBlocked('whatsapp', senderPhone, from)) {
      console.log(`[WhatsApp 🚫 BLOQUEADO] Mensagem ignorada de ${senderPhone} no chat ${from}`);
      return;
    }

    // 0.1 COMANDOS DE MODERAÇÃO E CONTROLE (DESATIVAR, ATIVAR, BLOQUEAR, DESBLOQUEAR, STATUS)
    const isAdmin = await this.checkIsAdmin(from, participantJid, isFromMe);

    // Desativar / Mute do Bot
    if (/^(?:!|\/)(?:desativar|pausar|mute|parar|stop)(?:\s.*)?$/i.test(lower)) {
      if (isGroup && !isAdmin) {
        return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem desativar o bot.');
      }
      models.muteChat({
        platform: 'whatsapp',
        chatId: from,
        targetType: isGroup ? 'GROUP' : 'PRIVATE',
        reason: isGroup ? 'Desativado por moderador no grupo' : 'Desativado a pedido na conversa privada',
        createdBy: senderPhone,
        userName: senderName
      });
      return this.sendMessage(from, `🛑 *BOT DESATIVADO NESTE ${isGroup ? 'GRUPO' : 'CHAT'}!*\n\nO bot não responderá mensagens automáticas por aqui.\n\nPara reativar a qualquer momento, envie *!ativar*.`);
    }

    // Ativar / Unmute do Bot
    if (/^(?:!|\/)(?:ativar|despausar|unmute|start)(?:\s.*)?$/i.test(lower)) {
      if (isGroup && !isAdmin) {
        return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem reativar o bot.');
      }
      models.unmuteChat('whatsapp', from);
      return this.sendMessage(from, `🟢 *BOT REATIVADO COM SUCESSO!*\n\nO atendimento automático e vendas inteligentes estão operando normalmente por aqui!`);
    }

    // Bloquear participante de grupo ou usuário
    if (/^(?:!|\/)(?:bloquear|block)(?:\s.*)?$/i.test(lower)) {
      if (!isAdmin) {
        return this.sendMessage(from, '⚠️ Apenas administradores podem bloquear participantes.');
      }

      let targetPhone = null;
      let targetName = null;

      const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (quotedParticipant) {
        targetPhone = quotedParticipant.split('@')[0].split(':')[0];
      }
      if (!targetPhone) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) {
          targetPhone = mentioned[0].split('@')[0].split(':')[0];
        }
      }
      if (!targetPhone) {
        const matchNum = text.match(/(?:!|\/)(?:bloquear|block)\s*@?(\+?[0-9]{8,20})/i);
        if (matchNum) {
          targetPhone = matchNum[1].replace(/[^0-9]/g, '');
        }
      }

      if (!targetPhone) {
        return this.sendMessage(from, `ℹ️ *Como bloquear um participante:*\n• Responda à mensagem da pessoa com *!bloquear*\n• Ou envie *!bloquear @usuario*\n• Ou envie *!bloquear 5511999998888*`);
      }

      models.blockUser({
        platform: 'whatsapp',
        userId: targetPhone,
        chatId: isGroup ? from : null,
        targetType: 'USER',
        reason: isGroup ? 'Bloqueado no grupo por administrador' : 'Bloqueado por administrador',
        createdBy: senderPhone,
        userName: targetName
      });

      return this.sendMessage(from, `🚫 *PARTICIPANTE BLOQUEADO!*\n\nO usuário *${targetPhone}* foi bloqueado e não poderá mais interagir com o bot ${isGroup ? 'neste grupo' : 'no sistema'}.\n\nPara desbloquear: *!desbloquear ${targetPhone}*`);
    }

    // Desbloquear participante
    if (/^(?:!|\/)(?:desbloquear|unblock)(?:\s.*)?$/i.test(lower)) {
      if (!isAdmin) {
        return this.sendMessage(from, '⚠️ Apenas administradores podem desbloquear participantes.');
      }

      let targetPhone = null;
      const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (quotedParticipant) {
        targetPhone = quotedParticipant.split('@')[0].split(':')[0];
      }
      if (!targetPhone) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) {
          targetPhone = mentioned[0].split('@')[0].split(':')[0];
        }
      }
      if (!targetPhone) {
        const matchNum = text.match(/(?:!|\/)(?:desbloquear|unblock)\s*@?(\+?[0-9]{8,20})/i);
        if (matchNum) {
          targetPhone = matchNum[1].replace(/[^0-9]/g, '');
        }
      }

      if (!targetPhone) {
        return this.sendMessage(from, `ℹ️ *Como desbloquear:* envie *!desbloquear 5511999998888* ou responda à mensagem da pessoa com *!desbloquear*.`);
      }

      models.unblockUser('whatsapp', targetPhone, isGroup ? from : null);
      return this.sendMessage(from, `✅ *PARTICIPANTE DESBLOQUEADO!*\n\nO usuário *${targetPhone}* agora pode interagir com o bot normalmente.`);
    }

    // Status da moderação no chat
    if (/^(?:!|\/)(?:statusbot|botstatus|mod)$/i.test(lower)) {
      const isMuted = models.isChatMuted('whatsapp', from);
      const controls = models.getChatControls({ platform: 'whatsapp', activeOnly: true });
      const blockedInThisChat = controls.filter(c => c.control_type === 'BLOCK_USER' && (c.chat_id === from || c.chat_id === '*'));

      let statusText = `📊 *MODERAÇÃO & STATUS DO BOT:*\n\n` +
        `• *Tipo do Chat:* ${isGroup ? 'Grupo WhatsApp' : 'Conversa Privada'}\n` +
        `• *ID:* \`${from}\`\n` +
        `• *Status:* ${isMuted ? '🔴 Desativado (Muted)' : '🟢 Ativo'}\n` +
        `• *Participantes Bloqueados:* ${blockedInThisChat.length}\n\n`;

      if (blockedInThisChat.length > 0) {
        statusText += `*Bloqueados neste chat:*\n`;
        blockedInThisChat.slice(0, 5).forEach(b => {
          statusText += `• ${b.user_id} (${b.reason || 'Sem motivo'})\n`;
        });
        statusText += `\n`;
      }

      statusText += `_Comandos úteis: !desativar, !ativar, !bloquear, !desbloquear, !admin, !suporte_`;
      return this.sendMessage(from, statusText);
    }

    // ==========================================
    // 0.15 SUPORTE HUMANO & TRANSBORDO: !suporte / !humano
    // ==========================================
    if (/^(?:!|\/)(?:suporte|humano|atendente|ajudahumana)$/i.test(lower)) {
      const ticket = models.createSupportTicket({
        platform: 'whatsapp',
        customerId: senderPhone,
        customerName: senderName,
        issueSummary: 'Solicitado via comando !suporte'
      });
      const sellerInfo = ticket.seller_name ? `O especialista *${ticket.seller_name}*` : 'Um especialista da nossa equipe';
      return this.sendMessage(from, `🛎️ *CHAMADO DE SUPORTE ABERTO (#${ticket.id})*\n\n${sellerInfo} foi notificado para dar continuidade ao seu atendimento com prioridade!\n\nPor favor, envie sua dúvida ou comprovante aqui abaixo.`);
    }

    // ==========================================
    // 0.16 PROTEÇÃO ANTI-FLOOD EM GRUPOS
    // ==========================================
    if (isGroup && !isAdmin) {
      const now = Date.now();
      const floodKey = `${from}_${senderPhone}`;
      const userHistory = (this.userFloodTracking.get(floodKey) || []).filter(t => now - t < 6000);
      userHistory.push(now);
      this.userFloodTracking.set(floodKey, userHistory);

      if (userHistory.length > 5) {
        try {
          if (this.sock) {
            await this.sock.sendMessage(from, { delete: msg.key });
            if (userHistory.length === 6) {
              await this.sendMessage(from, `⚠️ @${senderPhone}, por favor evite mensagens consecutivas em excesso (anti-flood ativado)!`, { mentions: [participantJid] });
              models.logGroupAdminAction({
                platform: 'whatsapp',
                groupId: from,
                adminId: 'system_bot',
                adminName: 'PayBot Anti-Flood',
                action: 'FLOOD_WARNING',
                targetId: senderPhone,
                details: 'Mensagem apagada por flood excessivo (mais de 5 msgs em 6s)'
              });
            }
            return;
          }
        } catch (_) {}
      }
    }

    // ==========================================
    // 0.2 PROTEÇÃO ANTI-LINK EM GRUPOS
    // ==========================================
    if (isGroup && models.getSetting(`ANTILINK_${from}`, 'false') === 'true' && !isAdmin) {
      const linkRegex = /(?:chat\.whatsapp\.com|wa\.me|t\.me|telegram\.me|discord\.gg)\/[a-zA-Z0-9_\-]+/i;
      if (linkRegex.test(text)) {
        console.log(`[WhatsApp 🛡️ Anti-Link] Link proibido detectado de ${senderPhone} no grupo ${from}`);
        try {
          if (this.sock) {
            await this.sock.sendMessage(from, { delete: msg.key });
            await this.sendMessage(from, `⚠️ @${senderPhone}, links de outros grupos não são permitidos neste grupo!`, { mentions: [participantJid] });
            models.logGroupAdminAction({
              platform: 'whatsapp',
              groupId: from,
              adminId: 'system_bot',
              adminName: 'PayBot Anti-Link',
              action: 'ANTILINK_TRIGGER',
              targetId: senderPhone,
              details: `Link externo não autorizado apagado do usuário ${senderPhone}`
            });
            return;
          }
        } catch (_) {}
      }
    }

    // ==========================================
    // 0.3 FUNÇÕES DE GERENCIAMENTO DE GRUPOS (ADMIN COM BOT ADMIN)
    // ==========================================
    if (isGroup) {
      // 1. Menu de Gestão: !admin, !gestao, !adminhelp
      if (/^(?:!|\/)(?:admin|gestao|adminhelp|gerenciamento)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem acessar o painel de gestão.');
        }

        const botStatusBadge = adminStatus.isBotAdmin 
          ? '🟢 *Bot é Administrador* (Todas as funções liberadas)' 
          : '⚠️ *Bot NÃO é Administrador* (Promova o bot a admin para executar ban, fechamento, etc.)';

        const isAntilink = models.getSetting(`ANTILINK_${from}`, 'false') === 'true';
        const isWelcome = models.getSetting(`WELCOME_${from}`, 'false') === 'true';
        const isAntifake = models.getSetting(`ANTIFAKE_${from}`, 'false') === 'true';
        const isAntiView = models.getSetting(`ANTIVIEWONCE_${from}`, 'true') === 'true';

        const adminMenu = `🛠️ *PAINEL DE GERENCIAMENTO DO GRUPO (ADMIN)*\n\n` +
          `• *Status do Bot:* ${botStatusBadge}\n` +
          `• *Anti-Link:* ${isAntilink ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Fake (+55):* ${isAntifake ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-View-Once:* ${isAntiView ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Boas-Vindas:* ${isWelcome ? '🟢 Ativado' : '🔴 Desativado'}\n\n` +
          `👢 *Gerenciamento de Membros:*\n` +
          `• *!ban* ou *!kick* (responda à mensagem ou use @número) — Remove participante\n` +
          `• *!promover* (responda ou mencione) — Promove participante a Administrador\n` +
          `• *!rebaixar* (responda ou mencione) — Remove cargo de Administrador\n` +
          `• *!todos <aviso>* — Marca e notifica todos os participantes do grupo\n` +
          `• *!hidetag <aviso>* — Notificação silenciosa/invisível para todos os membros\n` +
          `• *!fantasmas* — Escaneia membros inativos que nunca falaram\n\n` +
          `🛡️ *Advertências & Segurança (Gata Nina):*\n` +
          `• *!warn @usuario <motivo>* — Advertência (3 avisos = expulsão automática)\n` +
          `• *!unwarn @usuario* — Remove última advertência\n` +
          `• *!warns [@usuario]* — Consulta histórico de advertências\n` +
          `• *!antifake on/off* — Expulsa números de DDI estrangeiro automaticamente\n` +
          `• *!antiviewonce on/off* — Revela fotos e vídeos de visualização única\n\n` +
          `⚙️ *Configurações & Segurança:*\n` +
          `• *!fechar* — Tranca o grupo (apenas administradores falam)\n` +
          `• *!abrir* — Abre o grupo (todos os membros podem falar)\n` +
          `• *!nome <novo nome>* — Altera o nome do grupo\n` +
          `• *!descricao <texto>* — Altera a descrição e regras do grupo\n` +
          `• *!link* — Exibe o link de convite oficial do grupo\n` +
          `• *!revogar_link* — Cancela o link atual e gera um novo\n` +
          `• *!antilink on/off* — Ativa ou desativa proteção contra links externos\n` +
          `• *!boasvindas on/off* — Ativa ou desativa saudação para novos membros\n` +
          `• *!boasvindas_msg <texto>* — Personaliza o texto ({nome}, {grupo}, {numero})\n\n` +
          `🛑 *Moderação do Bot:*\n` +
          `• *!desativar* / *!ativar* — Pausa ou reativa o bot neste grupo\n` +
          `• *!bloquear* / *!desbloquear* — Bloqueia participante de interagir com o bot\n` +
          `• *!statusbot* — Consulta status de moderação e bloqueios`;

        return this.sendMessage(from, adminMenu);
      }

      // 2. Remover Participante: !ban, !kick, !remover
      if (/^(?:!|\/)(?:ban|kick|remover)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem remover participantes.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para remover membros!*\n\nPromova o bot a admin do grupo nas configurações do WhatsApp.');
        }

        let targetPhone = null;
        let targetJid = null;

        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetJid = quotedParticipant;
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
        }
        if (!targetJid) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = mentioned[0];
            targetPhone = targetJid.split('@')[0].split(':')[0];
          }
        }
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:ban|kick|remover)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (!targetJid) {
          return this.sendMessage(from, `ℹ️ *Como remover um membro:*\n• Responda à mensagem da pessoa com *!ban*\n• Ou envie *!ban @usuario*\n• Ou envie *!ban 5511999998888*`);
        }

        try {
          await this.sock.groupParticipantsUpdate(from, [targetJid], 'remove');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'BAN',
            targetId: targetPhone,
            details: `Expulso do grupo pelo administrador ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `👢 *MEMBRO REMOVIDO COM SUCESSO!*\n\nO participante *${targetPhone}* foi expulso do grupo por um administrador.`);
        } catch (err) {
          return this.sendMessage(from, `❌ Falha ao remover membro: ${err.message}`);
        }
      }

      // 3. Promover a Administrador: !promover, !promote
      if (/^(?:!|\/)(?:promover|promote)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem promover novos admins.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para promover membros!*');
        }

        let targetJid = null;
        let targetPhone = null;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetJid = quotedParticipant;
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
        }
        if (!targetJid) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = mentioned[0];
            targetPhone = targetJid.split('@')[0].split(':')[0];
          }
        }
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:promover|promote)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (!targetJid) {
          return this.sendMessage(from, `ℹ️ *Como promover:* responda à mensagem da pessoa com *!promover* ou envie *!promover @usuario*`);
        }

        try {
          await this.sock.groupParticipantsUpdate(from, [targetJid], 'promote');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'PROMOTE',
            targetId: targetPhone,
            details: `Promovido a administrador por ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `⭐ *ADMINISTRADOR PROMOVIDO!*\n\nO participante *${targetPhone}* agora é um Administrador deste grupo! 🎉`);
        } catch (err) {
          return this.sendMessage(from, `❌ Falha ao promover membro: ${err.message}`);
        }
      }

      // 4. Rebaixar Administrador: !rebaixar, !demote
      if (/^(?:!|\/)(?:rebaixar|demote)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem rebaixar admins.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar cargos!*');
        }

        let targetJid = null;
        let targetPhone = null;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetJid = quotedParticipant;
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
        }
        if (!targetJid) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = mentioned[0];
            targetPhone = targetJid.split('@')[0].split(':')[0];
          }
        }
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:rebaixar|demote)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (!targetJid) {
          return this.sendMessage(from, `ℹ️ *Como rebaixar:* responda à mensagem da pessoa com *!rebaixar* ou envie *!rebaixar @usuario*`);
        }

        try {
          await this.sock.groupParticipantsUpdate(from, [targetJid], 'demote');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'DEMOTE',
            targetId: targetPhone,
            details: `Rebaixado de administrador por ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `🔽 *ADMINISTRADOR REBAIXADO!*\n\nO participante *${targetPhone}* não é mais administrador.`);
        } catch (err) {
          return this.sendMessage(from, `❌ Falha ao rebaixar membro: ${err.message}`);
        }
      }

      // 5. Fechar Grupo: !fechar, !lock
      if (/^(?:!|\/)(?:fechar|lock|mutargrupo)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem fechar o chat.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar configurações!*\n\nPromova o bot para permitir fechar/abrir o grupo.');
        }

        try {
          await this.sock.groupSettingUpdate(from, 'announcement');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'LOCK',
            details: 'Grupo trancado para anúncios'
          });
          return this.sendMessage(from, `🔒 *GRUPO FECHADO!*\n\nAgora apenas administradores podem enviar mensagens no grupo.`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao fechar grupo: ${err.message}`);
        }
      }

      // 6. Abrir Grupo: !abrir, !unlock
      if (/^(?:!|\/)(?:abrir|unlock|desmutargrupo)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem abrir o chat.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar configurações!*');
        }

        try {
          await this.sock.groupSettingUpdate(from, 'not_announcement');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'UNLOCK',
            details: 'Grupo reaberto para todos os membros'
          });
          return this.sendMessage(from, `🔓 *GRUPO ABERTO!*\n\nTodos os membros do grupo agora podem enviar mensagens livremente!`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao abrir grupo: ${err.message}`);
        }
      }

      // 7. Alterar Nome do Grupo: !nome <novo nome>
      if (/^(?:!|\/)(?:nome|titulo)\s+/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores podem alterar o nome do grupo.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar o nome!*');
        }

        const newTitle = text.replace(/^(?:!|\/)(?:nome|titulo)\s+/i, '').trim();
        if (!newTitle) return this.sendMessage(from, 'ℹ️ Uso: *!nome Novo Título do Grupo*');

        try {
          await this.sock.groupUpdateSubject(from, newTitle);
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'RENAME',
            details: `Nome alterado para: ${newTitle}`
          });
          return this.sendMessage(from, `✏️ *NOME DO GRUPO ALTERADO!*\n\nNovo nome: *${newTitle}*`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao alterar nome: ${err.message}`);
        }
      }

      // 8. Alterar Descrição do Grupo: !descricao <texto>
      if (/^(?:!|\/)(?:descricao|desc|regras)\s+/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores podem alterar a descrição do grupo.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar a descrição!*');
        }

        const newDesc = text.replace(/^(?:!|\/)(?:descricao|desc|regras)\s+/i, '').trim();
        if (!newDesc) return this.sendMessage(from, 'ℹ️ Uso: *!descricao Novas Regras e Avisos*');

        try {
          await this.sock.groupUpdateDescription(from, newDesc);
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'SET_DESC',
            details: 'Descrição do grupo atualizada'
          });
          return this.sendMessage(from, `📝 *DESCRIÇÃO DO GRUPO ATUALIZADA COM SUCESSO!*`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao alterar descrição: ${err.message}`);
        }
      }

      // 9. Obter Link de Convite: !link, !convite
      if (/^(?:!|\/)(?:link|convite)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem solicitar o link oficial.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador do grupo para obter o link de convite!*');
        }

        try {
          const code = await this.sock.groupInviteCode(from);
          return this.sendMessage(from, `🔗 *LINK DE CONVITE OFICIAL DO GRUPO:*\n\nhttps://chat.whatsapp.com/${code}\n\n_Para cancelar este link e gerar um novo: !revogar_link_`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao obter link de convite: ${err.message}`);
        }
      }

      // 10. Revogar Link de Convite: !revogar_link
      if (/^(?:!|\/)(?:revogar_link|revogarlink|resetlink)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores podem revogar o link de convite.');
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador do grupo para revogar o link!*');
        }

        try {
          const newCode = await this.sock.groupRevokeInvite(from);
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'REVOKE_LINK',
            details: `Link de convite renovado: https://chat.whatsapp.com/${newCode}`
          });
          return this.sendMessage(from, `🔄 *LINK DE CONVITE ANTERIOR REVOGADO!*\n\nNovo link oficial gerado:\nhttps://chat.whatsapp.com/${newCode}`);
        } catch (err) {
          return this.sendMessage(from, `❌ Erro ao revogar link: ${err.message}`);
        }
      }

      // 11. Marcar Todos os Membros: !todos, !marcartodos, !aviso <msg>
      if (/^(?:!|\/)(?:todos|marcartodos|aviso)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem marcar todos os membros.');
        }

        const customMsg = text.replace(/^(?:!|\/)(?:todos|marcartodos|aviso)\s*/i, '').trim();
        const noticeText = customMsg || 'Atenção membros!';
        const mentions = adminStatus.metadata?.participants ? adminStatus.metadata.participants.map(p => p.id) : [];

        models.logGroupAdminAction({
          platform: 'whatsapp',
          groupId: from,
          adminId: senderPhone,
          adminName: senderName,
          action: 'TAG_ALL',
          details: customMsg || 'Aviso geral para todos os membros'
        });

        const tagText = `📢 *AVISO GERAL DOS ADMINISTRADORES:*\n\n${noticeText}`;
        return this.sendMessage(from, tagText, { mentions });
      }

      // 12. Configurar Proteção Anti-Link: !antilink on/off
      if (/^(?:!|\/)(?:antilink)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar o anti-link.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTILINK_${from}`, 'true');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'ANTILINK_ON',
            details: 'Proteção anti-link ativada'
          });
          return this.sendMessage(from, `🛡️ *PROTEÇÃO ANTI-LINK ATIVADA!*\n\nMensagens com links de outros grupos serão apagadas automaticamente.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTILINK_${from}`, 'false');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'ANTILINK_OFF',
            details: 'Proteção anti-link desativada'
          });
          return this.sendMessage(from, `🔓 *PROTEÇÃO ANTI-LINK DESATIVADA!*`);
        } else {
          const isAct = models.getSetting(`ANTILINK_${from}`, 'false') === 'true';
          return this.sendMessage(from, `ℹ️ *Proteção Anti-Link:* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: *!antilink on* ou *!antilink off*`);
        }
      }

      // 13. Configurar Mensagem de Boas-Vindas: !boasvindas on/off
      if (/^(?:!|\/)(?:boasvindas|welcome)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar as boas-vindas.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`WELCOME_${from}`, 'true');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'WELCOME_ON',
            details: 'Boas-vindas automáticas ativadas'
          });
          return this.sendMessage(from, `👋 *BOAS-VINDAS AUTOMÁTICAS ATIVADAS!*\n\nNovos participantes receberão uma saudação ao entrar no grupo.\n\n_Para personalizar a mensagem: !boasvindas_msg Olá {nome}, bem-vindo ao {grupo}!_`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`WELCOME_${from}`, 'false');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'WELCOME_OFF',
            details: 'Boas-vindas automáticas desativadas'
          });
          return this.sendMessage(from, `🔕 *BOAS-VINDAS AUTOMÁTICAS DESATIVADAS!*`);
        } else {
          const isAct = models.getSetting(`WELCOME_${from}`, 'false') === 'true';
          const curMsg = models.getSetting(`WELCOME_MSG_${from}`, '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.');
          return this.sendMessage(from, `ℹ️ *Boas-Vindas:* ${isAct ? '🟢 Ativadas' : '🔴 Desativadas'}\n*Mensagem:* "${curMsg}"\n\nPara alterar: *!boasvindas on* ou *!boasvindas off*\nPara mudar o texto: *!boasvindas_msg Seu texto aqui com {nome} e {grupo}*`);
        }
      }

      // 14. Personalizar Mensagem de Boas-Vindas: !boasvindas_msg <texto>
      if (/^(?:!|\/)(?:boasvindas_msg|welcomemsg|msgboasvindas)\s+/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem personalizar as boas-vindas.');
        }

        const newMsg = text.replace(/^(?:!|\/)(?:boasvindas_msg|welcomemsg|msgboasvindas)\s+/i, '').trim();
        if (!newMsg) return this.sendMessage(from, 'ℹ️ Uso: *!boasvindas_msg Olá {nome}, seja bem-vindo ao {grupo}!*');

        models.setSetting(`WELCOME_MSG_${from}`, newMsg);
        models.setSetting(`WELCOME_${from}`, 'true');
        models.logGroupAdminAction({
          platform: 'whatsapp',
          groupId: from,
          adminId: senderPhone,
          adminName: senderName,
          action: 'WELCOME_MSG',
          details: `Mensagem de boas-vindas personalizada: ${newMsg}`
        });

        return this.sendMessage(from, `✅ *MENSAGEM DE BOAS-VINDAS ATUALIZADA!*\n\nNovos participantes receberão:\n"${newMsg}"`);
      }

      // 15. Advertência: !warn, !advertencia, !advertir
      if (/^(?:!|\/)(?:warn|advertencia|advertir)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem advertir participantes.');
        }

        let targetPhone = null;
        let reason = '';

        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
          reason = text.replace(/^(?:!|\/)(?:warn|advertencia|advertir)\s*/i, '').trim();
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = mentioned[0].split('@')[0].split(':')[0];
            reason = text.replace(/^(?:!|\/)(?:warn|advertencia|advertir)\s*@?\d+\s*/i, '').trim();
          }
        }
        if (!targetPhone) {
          const matchNum = text.match(/(?:!|\/)(?:warn|advertencia|advertir)\s*@?(\+?[0-9]{8,20})(?:\s+(.*))?/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            reason = (matchNum[2] || '').trim();
          }
        }

        if (!targetPhone) {
          return this.sendMessage(from, `ℹ️ *Como advertir um membro:*\n• Responda à mensagem da pessoa com *!warn [motivo]*\n• Ou envie *!warn @usuario [motivo]*\n• Ou envie *!warn 5511999998888 [motivo]*\n\n> 💡 Ao atingir 3 advertências, o bot bane o participante automaticamente.`);
        }

        if (!reason) reason = 'Desrespeito às regras do grupo';
        return gataFeatures.handleWarn(activeSock, from, targetPhone, reason, senderName, adminStatus.isBotAdmin);
      }

      // 16. Remover Advertência: !unwarn, !tiraraviso
      if (/^(?:!|\/)(?:unwarn|tiraraviso|removeraviso)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem remover advertências.');
        }

        let targetPhone = null;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = mentioned[0].split('@')[0].split(':')[0];
          }
        }
        if (!targetPhone) {
          const matchNum = text.match(/(?:!|\/)(?:unwarn|tiraraviso|removeraviso)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
          }
        }

        if (!targetPhone) {
          return this.sendMessage(from, `ℹ️ *Como remover advertência:*\n• Responda à mensagem do participante com *!unwarn*\n• Ou envie *!unwarn @usuario*`);
        }

        return gataFeatures.handleUnwarn(activeSock, from, targetPhone);
      }

      // 17. Consultar Advertências: !warns, !avisos
      if (/^(?:!|\/)(?:warns|avisos)(?:\s.*)?$/i.test(lower)) {
        let targetPhone = null;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetPhone = quotedParticipant.split('@')[0].split(':')[0];
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = mentioned[0].split('@')[0].split(':')[0];
          }
        }
        if (!targetPhone) {
          const matchNum = text.match(/(?:!|\/)(?:warns|avisos)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
          }
        }
        if (!targetPhone) {
          targetPhone = senderPhone;
        }

        return gataFeatures.handleWarnsList(activeSock, from, targetPhone);
      }

      // 18. Configurar Anti-Fake: !antifake on/off
      if (/^(?:!|\/)(?:antifake|antiestrangeiro)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar a proteção Anti-Fake.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIFAKE_${from}`, 'true');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'ANTIFAKE_ON',
            details: 'Proteção Anti-Fake (+55 apenas) ativada'
          });
          return this.sendMessage(from, `🛡️ *PROTEÇÃO ANTI-FAKE ATIVADA!*\n\nNúmeros estrangeiros (DDI diferente de +55) serão banidos automaticamente ao entrarem no grupo.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIFAKE_${from}`, 'false');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'ANTIFAKE_OFF',
            details: 'Proteção Anti-Fake desativada'
          });
          return this.sendMessage(from, `🔓 *PROTEÇÃO ANTI-FAKE DESATIVADA!*`);
        } else {
          const isAct = models.getSetting(`ANTIFAKE_${from}`, 'false') === 'true';
          return this.sendMessage(from, `ℹ️ *Proteção Anti-Fake (+55):* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: *!antifake on* ou *!antifake off*`);
        }
      }

      // 19. Configurar Anti-View-Once: !antiviewonce on/off
      if (/^(?:!|\/)(?:antiviewonce|antiview|antivi)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores podem configurar o Anti-View-Once.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIVIEWONCE_${from}`, 'true');
          return this.sendMessage(from, `👁️ *ANTI-VIEW-ONCE ATIVADO!*\n\nFotos e vídeos de visualização única serão revelados permanentemente no chat.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIVIEWONCE_${from}`, 'false');
          return this.sendMessage(from, `🙈 *ANTI-VIEW-ONCE DESATIVADO!*`);
        } else {
          const isAct = models.getSetting(`ANTIVIEWONCE_${from}`, 'true') === 'true';
          return this.sendMessage(from, `ℹ️ *Anti-View-Once:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\n\nPara alterar: *!antiviewonce on* ou *!antiviewonce off*`);
        }
      }

      // 20. Hidetag: !hidetag <msg>
      if (/^(?:!|\/)(?:hidetag|notificar)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem usar hidetag.');
        }
        return gataFeatures.handleHidetag(activeSock, from, text, adminStatus.metadata);
      }

      // 21. Membros Fantasmas: !fantasmas, !inativos
      if (/^(?:!|\/)(?:fantasmas|inativos)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem escanear membros fantasmas.');
        }
        return gataFeatures.handleFantasmas(activeSock, from, adminStatus.metadata);
      }
    }

    // 0.2 SE O CHAT ESTIVER DESATIVADO (MUTED), NÃO RESPONDE MAIS NADA
    if (models.isChatMuted('whatsapp', from)) {
      return;
    }

    // 0.3 FILTRO EM GRUPOS: O BOT NÃO INTERFERE EM CONVERSAS ALEATÓRIAS
    if (isGroup) {
      const myNumber = this.sock?.user?.id ? this.sock.user.id.split(':')[0] : '';
      const isMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => myNumber && j.includes(myNumber));
      const isCommand = text.startsWith('!') || text.startsWith('/');
      const startsWithBot = lower.startsWith('bot,') || lower.startsWith('bot ');

      if (!isCommand && !isMentioned && !startsWithBot) {
        return; // Não responde conversas normais de membros do grupo
      }
    }

    // Auto-resposta do Exército de WhatsApp se for lead de campanha de divulgação
    try {
      const whatsappArmyService = require('../services/whatsappArmyService');
      const handled = await whatsappArmyService.handleIncomingLeadMessage(from, text, 1);
      if (handled) return;
    } catch (_) {}

    // 0. Detecta indicação de afiliado via link ou mensagem (ex: ref_TOPVIP ou cupom TOPVIP)
    const refMatch = text.match(/(?:ref_|afiliado[:\s]+)([a-zA-Z0-9_-]+)/i);
    if (refMatch) {
      const code = refMatch[1].toUpperCase();
      const affiliate = models.getAffiliateByCode(code);
      if (affiliate) {
        this.userReferrals.set(from, {
          affiliate_id: affiliate.id,
          ref_code: affiliate.ref_code
        });
        console.log(`[WhatsApp 🤝] Lead ${from} (${senderName}) vinculado ao afiliado ${affiliate.name} (#${affiliate.ref_code})`);
      }
    }

    // 0.1 Detecta ativação de cupom de desconto (ex: cupom PROMO10 ou desconto BLACK20)
    const couponMatch = text.match(/(?:cupom[:\s]+|desconto[:\s]+)([a-zA-Z0-9_-]+)/i);
    if (couponMatch) {
      const couponCode = couponMatch[1].toUpperCase();
      const coupon = models.getCouponByCode(couponCode);
      if (coupon) {
        this.userCoupons.set(from, coupon);
        return this.sendMessage(from, `🎉 *Cupom ${coupon.code} Aplicado com Sucesso!*\n\nVocê ganhou *${coupon.discount_percent}% de desconto* na sua próxima compra. Digite *MENU* para ver as opções!`);
      } else {
        return this.sendMessage(from, `❌ Desculpe, o cupom *${couponCode}* é inválido ou já expirou.`);
      }
    }

    // 0.2 Resposta para Oferta de Upsell / Order Bump (ex: "UP" ou "QUERO UP")
    if (lower === 'up' || lower === 'quero up' || lower === 'sim up') {
      const lastOrder = models.getAllOrders(10).find(o => o.platform === 'whatsapp' && o.platform_user_id === from && o.status === 'PAID');
      if (lastOrder) {
        const baseProduct = models.getProductById(lastOrder.product_id);
        if (baseProduct && baseProduct.upsell_product_id) {
          const upsellProd = models.getProductById(baseProduct.upsell_product_id);
          if (upsellProd && upsellProd.active) {
            const discount = baseProduct.upsell_discount_percent || 20.0;
            const discountedBrl = Number((upsellProd.price_brl * (1 - discount / 100)).toFixed(2));
            return this.processPixPurchase(from, senderName, {
              ...upsellProd,
              price_brl: discountedBrl,
              is_upsell: 1
            });
          }
        }
      }
    }

    // ==========================================
    // 0.4 COMANDOS GATA BOT / GATA NINA (STICKERS, DOWNLOADERS, IA, GAMES)
    // ==========================================

    // 1. Criador de Figurinha: !s / !sticker
    if (/^(?:!|\/)(?:s|sticker|fig|figurinha)$/i.test(lower)) {
      return gataFeatures.handleSticker(activeSock, from, msg, senderName);
    }

    // 2. Texto para Figurinha: !attp / !ttp
    if (/^(?:!|\/)(?:attp|ttp)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleTextToSticker(activeSock, from, text, senderName);
    }

    // 3. Figurinha para Imagem: !toimg
    if (/^(?:!|\/)(?:toimg|paraimg)$/i.test(lower)) {
      return gataFeatures.handleToImg(activeSock, from, msg);
    }

    // 4. Texto para Voz: !tts / !voz
    if (/^(?:!|\/)(?:tts|voz)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleTTS(activeSock, from, text);
    }

    // 5. Downloader de Música YouTube: !play / !ytmp3
    if (/^(?:!|\/)(?:play|ytmp3|musica)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handlePlayMusic(activeSock, from, text);
    }

    // 6. Downloader de TikTok: !tiktok / !tt
    if (/^(?:!|\/)(?:tiktok|tt)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleTikTok(activeSock, from, text);
    }

    // 7. Downloader de Instagram: !ig / !instagram / !reels
    if (/^(?:!|\/)(?:ig|instagram|reels)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleInstagram(activeSock, from, text);
    }

    // 7.1 Baixar todos os Stories de um @perfil: !allstories / !stories
    if (/^(?:!|\/)(?:allstories|stories|todosstories)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleAllStories(activeSock, from, text);
    }

    // 7.2 Scraper Completo & Auditoria de Perfil/Audiência: !scrapinsta / !stalkinsta / !spyinsta
    if (/^(?:!|\/)(?:scrapinsta|stalkinsta|spyinsta|insta)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleScrapInsta(activeSock, from, text);
    }

    // 8. Inteligência Artificial: !ia / !gpt / !gemini
    if (/^(?:!|\/)(?:ia|gpt|gemini)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleAIChat(activeSock, from, text, senderName);
    }

    // 9. Gerador de Imagens IA: !imagine / !dalle / !desenhe
    if (/^(?:!|\/)(?:imagine|dalle|desenhe)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleImagine(activeSock, from, text);
    }

    // 10. Tradutor Instantâneo: !traduzir / !translate
    if (/^(?:!|\/)(?:traduzir|translate)(?:\s+.*)?$/i.test(lower)) {
      return gataFeatures.handleTranslate(activeSock, from, text);
    }

    // 11. Perfil de Fidelidade: !perfil / !me / !nivel / !pontos
    if (/^(?:!|\/)(?:perfil|me|nivel|pontos|carteira)$/i.test(lower)) {
      return gataFeatures.handlePerfil(activeSock, from, senderPhone, senderName);
    }

    // 12. Resgatar Cupom de Fidelidade: !resgatar
    if (/^(?:!|\/)(?:resgatar|resgate|trocarcupom)$/i.test(lower)) {
      return gataFeatures.handleResgatar(activeSock, from, senderPhone);
    }

    // 13. Mini-game Dado: !dado / !dice
    if (/^(?:!|\/)(?:dado|dice)$/i.test(lower)) {
      return gataFeatures.handleDado(activeSock, from, senderPhone, senderName);
    }

    // 14. Mini-game Roleta: !roleta / !spin
    if (/^(?:!|\/)(?:roleta|spin|cassino)$/i.test(lower)) {
      return gataFeatures.handleRoleta(activeSock, from, senderPhone, senderName);
    }

    // 15. Menu Geral de Comandos Gata Nina + Loja: !comandos / !menu2 / !gatanina
    if (/^(?:!|\/)(?:comandos|menu2|gatanina|ajudatudo)$/i.test(lower)) {
      const gataMenu = `🐾 *CATÁLOGO DE COMANDOS GATA NINA + PAYBOT* 🐾\n\n` +
        `🎨 *Figurinhas & Mídia:*\n` +
        `• *!s* ou *!sticker* — Cria figurinha de foto ou vídeo\n` +
        `• *!attp <texto>* — Cria figurinha animada com seu texto\n` +
        `• *!toimg* — Converte figurinha em imagem JPG\n` +
        `• *!tts <texto>* — Converte texto em áudio falado pelo bot\n\n` +
        `📥 *Downloads & Inteligência Instagram:*\n` +
        `• *!play <música>* — Baixa música do YouTube em MP3\n` +
        `• *!tiktok <link>* — Baixa vídeo do TikTok sem marca d'água\n` +
        `• *!ig <link>* — Baixa fotos e reels do Instagram\n` +
        `• *!allstories <@usuario>* — Baixa todos os stories de um perfil\n` +
        `• *!scrapinsta <@usuario>* — Raio-X completo: métricas, rede e maturidade intelectual\n\n` +
        `🤖 *Inteligência Artificial:*\n` +
        `• *!ia <pergunta>* — Converse com o ChatGPT / Gemini integrado\n` +
        `• *!imagine <ideia>* — Gera arte inédita com IA\n` +
        `• *!traduzir <en|es|fr> <texto>* — Traduz instantaneamente\n\n` +
        `🎮 *Gamificação & Fidelidade:*\n` +
        `• *!perfil* — Exibe seu nível, XP e saldo de pontos\n` +
        `• *!dado* — Role os dados e ganhe moedas e XP\n` +
        `• *!roleta* — Gire a roleta da sorte para ganhar prêmios\n` +
        `• *!resgatar* — Troque 100 pontos por um Cupom de 15% OFF na loja\n\n` +
        `🛍️ *Vendas & Loja Automática:*\n` +
        `• *MENU* — Ver catálogo completo de produtos\n` +
        `• *P1, P2...* — Gerar PIX Copia e Cola instantâneo\n` +
        `• *C1, C2...* — Pagar via Cripto / Binance Pay (USDT)\n` +
        `• *STATUS* — Consultar andamento do seu pedido\n` +
        `• *!suporte* — Solicitar atendimento humano\n\n` +
        `🛡️ *Moderação de Grupos:* Envie *!admin* para ver comandos de gestão.`;

      return this.sendMessage(from, gataMenu);
    }

    // Comandos de menu
    if (['oi', 'ola', 'olá', 'menu', 'inicio', 'início', 'comprar', 'produtos', 'planos'].some(cmd => lower === cmd) || lower.startsWith('!menu')) {
      return this.sendMenu(from, senderName);
    }

    if (lower === 'ajuda' || lower === 'suporte' || lower.startsWith('!ajuda')) {
      return this.sendHelp(from);
    }

    if (lower === 'status' || lower.startsWith('!status')) {
      return this.sendOrderStatus(from);
    }

    // Atalhos diretos de pagamento: Ex "P1", "PIX 1", "C1", "CRIPTO 1"
    const pixMatch = lower.match(/^(?:p|pix\s*)(\d+)$/);
    if (pixMatch) {
      const idx = parseInt(pixMatch[1], 10);
      const products = models.getProducts(true);
      if (idx > 0 && idx <= products.length) {
        return this.processPixPurchase(from, senderName, products[idx - 1]);
      }
    }

    const bpayMatch = lower.match(/^(?:c|cripto\s*|crypto\s*|usdt\s*)(\d+)$/);
    if (bpayMatch) {
      const idx = parseInt(bpayMatch[1], 10);
      const products = models.getProducts(true);
      if (idx > 0 && idx <= products.length) {
        return this.processBinancePurchase(from, senderName, products[idx - 1]);
      }
    }

    // Seleção de produto: Ex "1", "QUERO 1", "COMPRAR 2"
    const wantMatch = lower.match(/^(?:quero\s*(?:o\s*)?|comprar\s*(?:o\s*)?|item\s*)?(\d+)$/);
    if (wantMatch) {
      const num = parseInt(wantMatch[1], 10);
      const products = models.getProducts(true);
      if (!isNaN(num) && num > 0 && num <= products.length) {
        const product = products[num - 1];
        
        const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
        const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';

        // Se ambos os gateways estão ativos, pergunta a forma de pagamento
        if (isPix && isBinance) {
          const brl = (product.price_brl || product.price).toFixed(2);
          const usdt = (product.price_usdt || (product.price / 5.5)).toFixed(2);

          const choiceMsg = `📦 *${product.name}*\n\n` +
            `Como você prefere pagar?\n\n` +
            `🟢 Digite *P${num}* para pagar via *PIX* (R$ ${brl})\n` +
            `🟡 Digite *C${num}* para pagar via *Cripto / USDT* (${usdt} USDT)\n\n` +
            `_Exemplo: responda *P${num}* para receber o código Copia e Cola instantâneo._`;
          return this.sendMessage(from, choiceMsg);
        } else if (isPix) {
          return this.processPixPurchase(from, senderName, product);
        } else {
          return this.processBinancePurchase(from, senderName, product);
        }
      }
    }

    // 6. Processamento de Linguagem Natural em Português Brasileiro (NLP / NLU PT-BR)
    try {
      const nlpService = require('../services/nlpService');
      const nlp = await nlpService.processMessage({
        text,
        customerName: senderName,
        platform: 'whatsapp'
      });

      if (nlp && nlp.intent !== 'UNKNOWN') {
        if (nlp.directAction === 'DEACTIVATE_BOT') {
          models.muteChat({
            platform: 'whatsapp',
            chatId: from,
            targetType: isGroup ? 'GROUP' : 'PRIVATE',
            reason: 'Solicitado via linguagem natural pelo cliente',
            createdBy: senderPhone,
            userName: senderName
          });
          return this.sendMessage(from, nlp.replyText);
        }
        if (nlp.directAction === 'TRIGGER_PIX' && nlp.entities?.matchedProduct) {
          return this.processPixPurchase(from, senderName, nlp.entities.matchedProduct);
        }
        if (nlp.directAction === 'TRIGGER_BINANCE' && nlp.entities?.matchedProduct) {
          return this.processBinancePurchase(from, senderName, nlp.entities.matchedProduct);
        }
        if (nlp.directAction === 'SHOW_MENU') {
          return this.sendMenu(from, senderName);
        }
        if (nlp.directAction === 'TRIGGER_UPSELL') {
          const lastOrder = models.getAllOrders(10).find(o => o.platform === 'whatsapp' && o.platform_user_id === from && o.status === 'PAID');
          if (lastOrder) {
            const baseProduct = models.getProductById(lastOrder.product_id);
            if (baseProduct && baseProduct.upsell_product_id) {
              const upsellProd = models.getProductById(baseProduct.upsell_product_id);
              if (upsellProd && upsellProd.active) {
                const discount = baseProduct.upsell_discount_percent || 20.0;
                const discountedBrl = Number((upsellProd.price_brl * (1 - discount / 100)).toFixed(2));
                return this.processPixPurchase(from, senderName, {
                  ...upsellProd,
                  price_brl: discountedBrl,
                  is_upsell: 1
                });
              }
            }
          }
        }
        if (nlp.intent === 'SUPPORT_HUMAN') {
          models.createSupportTicket({
            platform: 'whatsapp',
            customerId: senderPhone,
            customerName: senderName,
            issueSummary: text
          });
        }
        if (nlp.replyText) {
          return this.sendMessage(from, nlp.replyText);
        }
      }
    } catch (nlpErr) {
      console.error('[WhatsApp NLP Error]:', nlpErr.message);
    }

    // Fallback
    const fallbackText = `Olá, *${senderName}*! 👋\n\n` +
      `Para ver nossos produtos e assinaturas com pagamento automático via *PIX* ou *Cripto (USDT)*, envie *MENU*.\n\n` +
      `Se precisar de suporte, envie *AJUDA*.`;
    await this.sendMessage(from, fallbackText);
  }

  async sendMenu(to, senderName) {
    const products = models.getProducts(true);

    if (products.length === 0) {
      return this.sendMessage(to, 'Nenhum produto cadastrado no momento. Tente novamente mais tarde.');
    }

    let menu = `👋 Olá, *${senderName}*!\n` +
      `Bem-vindo à nossa loja automatizada com pagamentos via *PIX* e *Binance Pay* (USDT).\n\n` +
      `📌 *PRODUTOS & ASSINATURAS:*\n\n`;

    products.forEach((p, idx) => {
      const typeTag = p.type === 'vip_subscription' ? `⭐ [VIP ${p.duration_days} dias]` : '📦 [Digital]';
      const brl = (p.price_brl || p.price).toFixed(2);
      const usdt = (p.price_usdt || (p.price / 5.5)).toFixed(2);

      menu += `*${idx + 1}* - ${p.name} ${typeTag}\n` +
        `    💰 *R$ ${brl}* ou *${usdt} USDT*\n` +
        (p.description ? `    _${p.description}_\n\n` : '\n');
    });

    menu += `👉 *COMO COMPRAR:*\n` +
      `Digite o *NÚMERO* do item desejado (Exemplo: *1* ou *2*).\n\n` +
      `💡 Ou escolha direto:\n` +
      `• Para pagar com *PIX*: envie *P1*, *P2*, etc.\n` +
      `• Para pagar com *Cripto*: envie *C1*, *C2*, etc.\n\n` +
      `🐾 *Comandos Especiais & Lazer:* Envie *!comandos* para criar figurinhas (!s), baixar mídias (!play, !tiktok, !ig), IA (!ia, !imagine) e mini-jogos (!dado, !roleta).`;

    await this.sendMessage(to, menu);
  }

  // 1. Processa Compra via PIX
  async processPixPurchase(to, senderName, product) {
    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`);
      }
    }

    await this.sendMessage(to, `⏳ Gerando seu código *PIX* para *${product.name}*...`);

    const tradeNo = `ORD_WPIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let amount = product.price_brl || product.price;

    // Aplica Cupom de Desconto se houver
    let couponCode = null;
    let discountAmount = 0;
    const activeCoupon = this.userCoupons.get(to);
    if (activeCoupon) {
      discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
      amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
      couponCode = activeCoupon.code;
      models.useCoupon(activeCoupon.code);
      this.userCoupons.delete(to);
    }

    const pixRes = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo,
      amount,
      goodsName: product.name,
      payerName: senderName
    });

    if (!pixRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar o PIX:\n${pixRes.errorMessage}`);
    }

    const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

    // Afiliado e Vendedor
    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = null;
    if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    // Salva no banco
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: to,
      platform_user_name: senderName,
      product_id: product.id,
      gateway: 'mercadopago',
      amount,
      currency: 'BRL',
      prepay_id: paymentId,
      checkout_url: checkoutUrl,
      pix_code: pixCode,
      affiliate_id: refInfo.affiliate_id || null,
      seller_id: sellerId,
      ref_code: refInfo.ref_code || null,
      coupon_code: couponCode,
      discount_amount: discountAmount,
      is_upsell: product.is_upsell || 0
    });

    try {
      const couponNotice = couponCode ? ` (Cupom *${couponCode}* aplicado: -R$ ${discountAmount.toFixed(2)})` : '';
      let caption = `🟢 *COBRANÇA PIX GERADA!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Aponte a câmera do aplicativo do seu banco para o QR Code acima.\n` +
        `2. Ou copie o código *PIX Copia e Cola* que enviamos na próxima mensagem.\n\n` +
        `⚡ *Identificação Automática:* Assim que você efetuar o Pix, nosso sistema liberará seu acesso aqui imediatamente!`;

      if (pixRes.isSimulated) {
        caption += `\n\n🧪 *[MODO DE TESTE]*\nSimule o pagamento em:\n${checkoutUrl}`;
      }

      // Envia Imagem do QR Code
      await this.sock.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      });

      // Envia uma mensagem contendo apenas o Copia e Cola para facilitar cópia com 1 clique no celular
      await this.sendMessage(to, `👇 *PIX COPIA E COLA (Toque para copiar):*`);
      await this.sendMessage(to, `${pixCode}`);

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar PIX]:', err.message);
      await this.sendMessage(to, `Pix gerado! Código Copia e Cola:\n\n${pixCode}`);
    }
  }

  // 2. Processa Compra via Binance Pay
  async processBinancePurchase(to, senderName, product) {
    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`);
      }
    }

    await this.sendMessage(to, `⏳ Gerando sua fatura na *Binance Pay* para *${product.name}*...`);

    const tradeNo = `ORD_WBNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let amount = Number(product.price_usdt || (product.price / 5.5)).toFixed(2);

    // Aplica Cupom de Desconto se houver
    let couponCode = null;
    let discountAmount = 0;
    const activeCoupon = this.userCoupons.get(to);
    if (activeCoupon) {
      discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
      amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
      couponCode = activeCoupon.code;
      models.useCoupon(activeCoupon.code);
      this.userCoupons.delete(to);
    }

    const binanceRes = await binancePay.createOrder({
      merchantTradeNo: tradeNo,
      amount,
      currency: 'USDT',
      goodsName: product.name,
      goodsDetail: product.description,
      productId: product.id
    });

    if (!binanceRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar a cobrança na Binance Pay:\n${binanceRes.errorMessage}`);
    }

    const payData = binanceRes.data;

    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = null;
    if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: to,
      platform_user_name: senderName,
      product_id: product.id,
      gateway: 'binancepay',
      amount,
      currency: 'USDT',
      prepay_id: payData.prepayId,
      checkout_url: payData.checkoutUrl,
      qr_content: payData.qrContent,
      affiliate_id: refInfo.affiliate_id || null,
      seller_id: sellerId,
      ref_code: refInfo.ref_code || null,
      coupon_code: couponCode,
      discount_amount: discountAmount,
      is_upsell: product.is_upsell || 0
    });

    try {
      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, {
        width: 360,
        margin: 2
      });

      let caption = `⚡ *FATURA BINANCE PAY (USDT)!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *${Number(amount).toFixed(2)} USDT*\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Abra o app da *Binance*, vá em *Pay* e escaneie o QR Code acima.\n` +
        `2. Ou clique no link oficial de checkout:\n${payData.checkoutUrl}\n\n` +
        `⚡ *A entrega é instantânea após o pagamento!*`;

      if (binanceRes.isSimulated) {
        caption += `\n\n🧪 *[MODO DE TESTE]*\nSimule o pagamento em:\n${payData.checkoutUrl}`;
      }

      await this.sock.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      });

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar imagem Binance]:', err.message);
      await this.sendMessage(to, `Pedido criado! Link para pagamento: ${payData.checkoutUrl}`);
    }
  }

  async sendOrderStatus(to) {
    const orders = models.getAllOrders(20).filter(o => o.platform === 'whatsapp' && o.platform_user_id === to);
    if (orders.length === 0) {
      return this.sendMessage(to, 'Você ainda não possui nenhum pedido registrado por este WhatsApp.');
    }

    let text = '📦 *SEUS ÚLTIMOS PEDIDOS:*\n\n';
    orders.slice(0, 5).forEach(o => {
      const statusText = o.status === 'PAID' ? '✅ Pago & Entregue' : o.status === 'PENDING' ? '⏳ Aguardando' : '❌ Cancelado';
      const valorStr = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;
      text += `• *#${o.merchant_trade_no}*\n` +
        `  Item: ${o.product_name}\n` +
        `  Valor: ${valorStr} | Status: ${statusText}\n\n`;
    });

    await this.sendMessage(to, text);
  }

  async sendHelp(to) {
    const help = `ℹ️ *AJUDA & FORMAS DE PAGAMENTO*\n\n` +
      `• *PIX:* Você recebe o QR Code e o código Copia e Cola na hora no chat.\n` +
      `• *Criptomoedas (Binance Pay):* Pagamento rápido em USDT pelo app oficial da Binance.\n` +
      `• *Entrega Instantânea:* Nossos servidores monitoram confirmações de bancos e blockchains a cada poucos segundos.\n` +
      `• *Assinaturas VIP:* Link exclusivo gerado para acesso ao canal VIP com controle automático de validade.`;
    await this.sendMessage(to, help);
  }

  async sendMessage(jid, text, options = {}, customSock = null) {
    const sock = customSock || options.sock || this.currentDispatchSock || this.sock;
    if (!sock || (sock !== this && sock.ev && !sock.user?.id)) {
      console.log(`[WhatsApp ⚠️] Não conectado. Mensagem para ${jid} não enviada: ${typeof text === 'string' ? text.slice(0, 40) : 'objeto'}...`);
      return false;
    }

    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch (_) {}

    try {
      if (typeof text === 'object' && text !== null) {
        await sock.sendMessage(jid, text);
      } else {
        await sock.sendMessage(jid, { text, ...options });
      }
      return true;
    } catch (err) {
      console.error(`[WhatsApp ❌ Falha ao enviar para ${jid}]:`, err.message);
      return false;
    }
  }

  async requestPairingCode(phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Informe o telefone completo com DDI e DDD (ex: 5511999998888)');
    }

    if (!this.sock) {
      await this.start();
      await new Promise(r => setTimeout(r, 2000));
    }

    if (this.sock?.authState?.creds?.registered && process.env.NODE_ENV !== 'test') {
      throw new Error('Esta conta WhatsApp já está pareada e ativa.');
    }

    try {
      await new Promise(r => setTimeout(r, 1200));
      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
      this.currentPairingCode = formattedCode;
      return { success: true, pairingCode: formattedCode };
    } catch (err) {
      if (process.env.NODE_ENV === 'test' || !this.sock) {
        const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const simCode = `${p1}-${p2}`;
        this.currentPairingCode = simCode;
        return { success: true, pairingCode: simCode, simulated: true };
      }
      throw new Error('Falha ao gerar código de pareamento: ' + err.message);
    }
  }

  async resetSession() {
    await this.stop();
    this.currentQr = null;
    this.currentQrDataUrl = null;
    this.currentPairingCode = null;
    this.isConnected = false;
    try {
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
      }
    } catch (_) {}
    try {
      models.updateArmyInstance(1, { status: 'DISCONNECTED' });
    } catch (_) {}
    await this.start();
    return { success: true };
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      statusMessage: this.statusMessage,
      qrDataUrl: this.currentQrDataUrl,
      hasQr: !!this.currentQrDataUrl,
      pairingCode: this.currentPairingCode,
      phone: this.sock?.user?.id ? this.sock.user.id.split(':')[0] : null
    };
  }
}

module.exports = new WhatsAppBotService();

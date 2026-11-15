/**
 * groupManagerService.js
 * =========================================================================
 * 👑 GESTÃO DE DELEGAÇÃO DE GRUPOS PARA SUB-BOTS GERENTES
 * =========================================================================
 * Permite ao Dono delegar a gerência completa de um grupo do WhatsApp para
 * um Sub-Bot específico do exército (WhatsApp Army).
 *
 * O Sub-Bot Gerente assume:
 * - Atendimento ao vivo e respostas aos comandos do grupo
 * - Escuta e Social Listening de produtos/afiliados
 * - Radar Sentinela e moderação ativa
 * - Mensagens de boas-vindas e proteção do grupo
 * =========================================================================
 */

const models = require('../db/models');
const whatsappArmyService = require('./whatsappArmyService');

class GroupManagerService {
  constructor() {}

  /**
   * Obtém os dados do Sub-Bot gerente de um grupo
   */
  getGroupManager(groupJid) {
    if (!groupJid) return null;
    return models.getGroupManager(groupJid);
  }

  /**
   * Retorna o socket ativo do Sub-Bot Gerente se ele estiver conectado
   */
  getManagerSocket(groupJid) {
    if (!groupJid) return null;
    const manager = models.getGroupManager(groupJid);
    if (!manager || !manager.instance_id) return null;

    if (whatsappArmyService && whatsappArmyService.activeSockets) {
      const sock = whatsappArmyService.activeSockets.get(Number(manager.instance_id));
      if (sock) return sock;
    }
    return null;
  }

  /**
   * Vincula um Sub-Bot como gerente de um grupo
   */
  setGroupManager(groupJid, instanceId, delegatedBy = 'Dono') {
    if (!groupJid || !instanceId) return null;
    const instId = Number(instanceId);

    const instance = models.getArmyInstanceById(instId);
    if (!instance) {
      throw new Error(`Sub-Bot #${instId} não encontrado no sistema.`);
    }

    models.setGroupManager(groupJid, instId, delegatedBy);
    return models.getGroupManager(groupJid);
  }

  /**
   * Remove o gerente de um grupo, voltando para a Matriz
   */
  removeGroupManager(groupJid) {
    if (!groupJid) return false;
    return models.removeGroupManager(groupJid);
  }

  /**
   * Lista todos os grupos com sub-bots gerentes
   */
  listGroupManagers() {
    return models.listGroupManagers();
  }

  /**
   * Trata o comando !gerente / !delegargrupo
   */
  async handleGerenteCommand(sock, from, text = '', senderPhone = '', isOwner = false, isAdmin = false, isGroup = false) {
    if (!sock || !from) return;

    // Apenas o Dono ou Administradores autorizados podem delegar grupos
    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, {
        text: '⚠️ *ACESSO RESTRITO:* Apenas o Dono e Administradores podem definir ou alterar o Sub-Bot Gerente deste grupo.'
      });
    }

    const rawArgs = text.replace(/^(?:!|\/)?(?:gerente|gerentegrupo|delegargrupo)\s*/i, '').trim();
    const parts = rawArgs.split(/\s+/);
    const subCmd = (parts[0] || '').toLowerCase();

    // 1. REMOVER GERENTE (!gerente off / !gerente remover)
    if (subCmd === 'off' || subCmd === 'remover' || subCmd === 'del' || subCmd === 'desativar') {
      const targetGroup = parts[1] ? parts[1].trim() : (isGroup ? from : null);
      if (!targetGroup) {
        return sock.sendMessage(from, { text: '⚠️ Envie o comando dentro do grupo ou informe o JID do grupo: `!gerente remover <jid>`' });
      }

      const existing = models.getGroupManager(targetGroup);
      if (!existing) {
        return sock.sendMessage(from, { text: 'ℹ️ Este grupo não possui nenhum Sub-Bot gerente vinculado (já é gerenciado pela Matriz).' });
      }

      models.removeGroupManager(targetGroup);
      return sock.sendMessage(from, {
        text: `🛡️ *GERÊNCIA DO GRUPO RESTAURADA PARA A MATRIZ!*\n\n` +
          `O Sub-Bot #${existing.instance_id} (${existing.instance_name || 'Sub-Bot'}) foi desvinculado.\n` +
          `A partir de agora o Bot Matriz reassume o atendimento e comandos diretos neste grupo.`
      });
    }

    // 2. LISTAR TODOS OS GRUPOS GERENCIADOS (!gerente list)
    if (subCmd === 'list' || subCmd === 'listar' || subCmd === 'todos') {
      const managers = models.listGroupManagers();
      if (!managers || managers.length === 0) {
        return sock.sendMessage(from, {
          text: `📋 *NENHUM GRUPO POSSUI SUB-BOT GERENTE DELEGADO!*\n\nPara delegar um grupo, digite no grupo:\n\`!gerente <id_subbot>\``
        });
      }

      let listTxt = `👑 *GRUPOS GERENCIADOS POR SUB-BOTS (${managers.length})*\n\n`;
      managers.forEach((m, idx) => {
        listTxt += `*${idx + 1}. Grupo:* \`${m.group_jid}\`\n` +
          `   🤖 *Gerente:* Sub-Bot #${m.instance_id} (*${m.instance_name || 'Sub-Bot'}*)\n` +
          `   📱 *Telefone:* +${m.instance_phone || 'Sem número'}\n` +
          `   🟢 *Status:* ${m.instance_status || 'DESCONHECIDO'}\n` +
          `   📅 *Delegado em:* ${m.created_at || 'N/A'}\n\n`;
      });
      listTxt += `_Para remover um gerente: *!gerente remover*_`;
      return sock.sendMessage(from, { text: listTxt });
    }

    // 3. DEFINIR GERENTE (!gerente <id_subbot> [group_jid])
    const potentialId = parseInt(subCmd.replace(/\D/g, ''), 10);
    if (!isNaN(potentialId) && potentialId > 0) {
      const instId = potentialId;
      const targetGroup = parts[1] && parts[1].includes('@') ? parts[1].trim() : (isGroup ? from : null);

      if (!targetGroup) {
        return sock.sendMessage(from, {
          text: `⚠️ *GRUPO NÃO IDENTIFICADO!*\n\nEnvie o comando \`!gerente ${instId}\` diretamente dentro do grupo desejado, ou informe o ID do grupo:\n\`!gerente ${instId} <jid_do_grupo>\``
        });
      }

      const instance = models.getArmyInstanceById(instId);
      if (!instance) {
        return sock.sendMessage(from, {
          text: `❌ *Sub-Bot #${instId} não encontrado!*\n\nUse \`!subbots\` para visualizar os chips cadastrados no seu exército.`
        });
      }

      let groupTitle = 'este grupo';
      try {
        if (sock && typeof sock.groupMetadata === 'function') {
          const meta = await sock.groupMetadata(targetGroup);
          if (meta?.subject) groupTitle = `*${meta.subject}*`;
        }
      } catch (_) {}

      models.setGroupManager(targetGroup, instId, senderPhone || 'Dono');
      const isConnected = instance.status === 'CONNECTED';

      return sock.sendMessage(from, {
        text: `👑 *SUB-BOT #${instance.id} DESIGNADO COMO GERENTE OFICIAL!* 🤖\n\n` +
          `📍 *Grupo:* ${groupTitle}\n` +
          `🤖 *Gerente Nomeado:* *${instance.name}* (+${instance.phone || 'Sem número'})\n` +
          `🟢 *Status do Chip:* ${isConnected ? '🟢 Conectado & Operacional' : '🟡 ' + instance.status}\n` +
          `👤 *Delegado por:* +${senderPhone}\n\n` +
          `⚡ *Ações Assumidas pelo Sub-Bot Gerente:*\n` +
          `• Respostas automáticas e atendimento de comandos\n` +
          `• Motor de Social Listening e recomendações stealth\n` +
          `• Radar Sentinela e alertas ao vivo no PV\n` +
          `• Boas-vindas e controle de membros do grupo\n\n` +
          `_Para desvincular e retornar para a Matriz: envie *!gerente remover*_`
      });
    }

    // 4. CONSULTA DE STATUS (!gerente sem ID)
    if (isGroup) {
      const currentManager = models.getGroupManager(from);
      if (currentManager) {
        const isConnected = currentManager.instance_status === 'CONNECTED';
        return sock.sendMessage(from, {
          text: `🤖 *SUB-BOT GERENTE DESTE GRUPO:*\n\n` +
            `• *Instância:* Sub-Bot #${currentManager.instance_id} (*${currentManager.instance_name || 'Sub-Bot'}*)\n` +
            `• *Telefone:* +${currentManager.instance_phone || 'N/A'}\n` +
            `• *Status de Conexão:* ${isConnected ? '🟢 Online (Ativo)' : '🟡 ' + currentManager.instance_status}\n` +
            `• *Delegado por:* ${currentManager.delegated_by || 'Dono'}\n\n` +
            `_Para trocar de gerente: *!gerente <novo_id>* | Para remover: *!gerente remover*_`
        });
      } else {
        return sock.sendMessage(from, {
          text: `ℹ️ *STATUS DA GERÊNCIA DO GRUPO:*\n\n` +
            `Este grupo é gerenciado diretamente pelo *Bot Matriz*.\n\n` +
            `👉 *Como delegar para um Sub-Bot:* \`!gerente <id_subbot>\` (ex: \`!gerente 2\`)\n` +
            `_O Sub-Bot assumirá o atendimento, social listening e comandos com o seu próprio chip._`
        });
      }
    }

    // No privado sem argumentos: manual
    return sock.sendMessage(from, {
      text: `👑 *DELEGAÇÃO DE GRUPOS PARA SUB-BOTS GERENTES* 🤖\n\n` +
        `Você pode colocar qualquer Sub-Bot do seu exército para cuidar e gerenciar grupos com o chip dele:\n\n` +
        `• \`!gerente <id>\` — Nomeia o Sub-Bot como gerente do grupo atual\n` +
        `• \`!gerente remover\` — Desvincula o gerente e volta para a Matriz\n` +
        `• \`!gerente list\` — Lista todos os grupos que possuem gerentes\n` +
        `• \`!gerente status\` — Consulta quem é o gerente atual do grupo`
    });
  }
}

module.exports = new GroupManagerService();

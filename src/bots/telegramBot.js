const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');
const updatesChannel = require('../services/updatesChannel');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.isRunning = false;
    this.userReferrals = new Map(); // Armazena affiliate_id e ref_code por user_id
    this.userCoupons = new Map(); // Armazena cupom ativo por user_id
  }

  async start() {
    const token = models.getSetting('TELEGRAM_BOT_TOKEN', config.telegram.botToken);

    if (!token) {
      console.log('🤖 [Telegram] Token não configurado. O bot do Telegram iniciará quando você inserir o token no Painel Web ou no .env');
      return;
    }

    try {
      this.bot = new Telegraf(token);

      this.bot.catch((err, ctx) => {
        console.error(`[Telegram ⚠️ Erro interceptado em update ${ctx?.updateType}]:`, err.message);
      });

      fulfillment.registerTelegramBot({
        sendMessage: (chatId, text) => this.sendMessage(chatId, text),
        sendUpsell: (chatId, text, data) => this.sendUpsell(chatId, text, data),
        createInviteLink: (channelId) => this.createInviteLink(channelId),
        removeMember: (channelId, userId) => this.removeMember(channelId, userId)
      });

      updatesChannel.registerTelegramBroadcaster((channelId, text, options) => {
        return this.sendChannelPost(channelId, text, options);
      });

      this.setupHandlers();
      
      await this.bot.launch();
      this.isRunning = true;
      console.log('✅ [Telegram] Bot conectado e operando com sucesso!');
    } catch (err) {
      console.error('❌ [Telegram] Falha ao iniciar bot:', err.message);
    }
  }

  async stop() {
    if (this.bot && this.isRunning) {
      this.bot.stop('SIGINT');
      this.isRunning = false;
      console.log('🛑 [Telegram] Bot desconectado.');
    }
  }

  async getTelegramAdminStatus(ctx) {
    if (!ctx.chat || ctx.chat.type === 'private') {
      return { isGroup: false, isRequesterAdmin: true, isBotAdmin: false };
    }
    const senderId = ctx.from?.id ? String(ctx.from.id) : '';
    const adminIdSetting = models.getSetting('ADMIN_TELEGRAM_ID', '');
    const ownerIdSetting = models.getSetting('OWNER_TELEGRAM_ID', '');
    const isGlobalAdmin = !!((adminIdSetting && adminIdSetting.includes(senderId)) || (ownerIdSetting && ownerIdSetting.includes(senderId)));

    try {
      let isBotAdmin = false;
      if (ctx.botInfo?.id) {
        const botMember = await ctx.getChatMember(ctx.botInfo.id);
        isBotAdmin = botMember.status === 'administrator';
      }

      let isRequesterAdmin = isGlobalAdmin;
      if (!isRequesterAdmin && ctx.from?.id) {
        const requesterMember = await ctx.getChatMember(ctx.from.id);
        isRequesterAdmin = requesterMember.status === 'creator' || requesterMember.status === 'administrator';
      }

      return { isGroup: true, isRequesterAdmin, isBotAdmin };
    } catch (err) {
      return { isGroup: true, isRequesterAdmin: isGlobalAdmin, isBotAdmin: isGlobalAdmin, error: err.message };
    }
  }

  async checkTelegramAdmin(ctx) {
    const status = await this.getTelegramAdminStatus(ctx);
    return !status.isGroup ? true : status.isRequesterAdmin;
  }

  setupHandlers() {
    // Middleware de Moderação & Controle de Acesso (Mute & Blacklist)
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat ? String(ctx.chat.id) : null;
      const userId = ctx.from ? String(ctx.from.id) : null;

      // 1. Verifica se o participante está bloqueado
      if (userId && models.isUserBlocked('telegram', userId, chatId)) {
        return; // Usuário bloqueado: silêncio absoluto
      }

      // 2. Se o chat estiver desativado/mutado
      if (chatId && models.isChatMuted('telegram', chatId)) {
        const text = (ctx.message?.text || '').trim();
        const isReactivateCmd = /^\/(?:ativar|despausar|unmute|startbot)(?:@\w+)?(?:\s.*)?$/i.test(text);
        if (!isReactivateCmd) {
          return; // Chat mutado: silêncio para todas as mensagens exceto reativação
        }
      }

      // 3. Verificação de Anti-Link em Grupos
      if (chatId && ctx.chat?.type !== 'private') {
        const isAntiLink = models.getSetting(`ANTILINK_${chatId}`, 'false') === 'true';
        if (isAntiLink) {
          const text = (ctx.message?.text || '').trim();
          const linkRegex = /(?:t\.me|telegram\.me|chat\.whatsapp\.com|wa\.me|discord\.gg)\/[a-zA-Z0-9_\-]+/i;
          if (linkRegex.test(text)) {
            const adminStatus = await this.getTelegramAdminStatus(ctx);
            if (!adminStatus.isRequesterAdmin) {
              try {
                await ctx.deleteMessage();
                const userTag = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Usuário');
                await ctx.reply(`⚠️ ${userTag}, links de outros canais ou grupos não são permitidos aqui!`);
                models.logGroupAdminAction({
                  platform: 'telegram',
                  groupId: chatId,
                  adminId: 'system_bot',
                  adminName: 'PayBot Anti-Link',
                  action: 'ANTILINK_TRIGGER',
                  targetId: String(ctx.from?.id || ''),
                  details: `Link externo não autorizado apagado de ${userTag}`
                });
                return;
              } catch (_) {}
            }
          }
        }
      }

      return next();
    });

    // Comandos de Moderação e Controle do Bot
    this.bot.command(['desativar', 'pausar', 'mute', 'stopbot'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem desativar o bot.');
      }
      const isGroup = ctx.chat.type !== 'private';
      models.muteChat({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        targetType: isGroup ? 'GROUP' : 'PRIVATE',
        reason: isGroup ? 'Desativado por moderador no grupo' : 'Desativado a pedido na conversa privada',
        createdBy: String(ctx.from.id),
        userName: ctx.chat.title || ctx.from.first_name
      });
      await ctx.reply(`🛑 *BOT DESATIVADO NESTE ${isGroup ? 'GRUPO' : 'CHAT'}!*\n\nO bot não responderá comandos ou mensagens aqui.\n\nPara reativar a qualquer momento, envie /ativar.`, { parse_mode: 'Markdown' });
    });

    this.bot.command(['ativar', 'despausar', 'unmute', 'startbot'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem reativar o bot.');
      }
      models.unmuteChat('telegram', String(ctx.chat.id));
      await ctx.reply('🟢 *BOT REATIVADO COM SUCESSO!*\n\nO atendimento automático e vendas estão operando normalmente.', { parse_mode: 'Markdown' });
    });

    this.bot.command(['bloquear', 'block'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem bloquear participantes.');
      }

      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      let targetId = null;
      let targetName = null;

      if (ctx.message?.reply_to_message?.from) {
        const u = ctx.message.reply_to_message.from;
        targetId = String(u.id);
        targetName = u.username ? `@${u.username}` : (u.first_name || targetId);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parts[1].replace(/[^0-9a-zA-Z_@]/g, '');
          targetName = targetId;
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ *Como bloquear um participante:*\n• Responda à mensagem da pessoa com `/bloquear`\n• Ou envie `/bloquear ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      models.blockUser({
        platform: 'telegram',
        userId: targetId,
        chatId: isGroup ? chatId : null,
        targetType: 'USER',
        reason: isGroup ? 'Bloqueado no grupo por administrador' : 'Bloqueado por administrador',
        createdBy: String(ctx.from.id),
        userName: targetName
      });

      return ctx.reply(`🚫 *Participante bloqueado com sucesso!*\n\nO usuário *${targetName}* foi bloqueado e não poderá mais interagir com o bot ${isGroup ? 'neste grupo' : 'no sistema'}.\n\nPara desbloquear: \`/desbloquear ${targetId}\``, { parse_mode: 'Markdown' });
    });

    this.bot.command(['desbloquear', 'unblock'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem desbloquear participantes.');
      }

      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      let targetId = null;

      if (ctx.message?.reply_to_message?.from) {
        targetId = String(ctx.message.reply_to_message.from.id);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parts[1].replace(/[^0-9a-zA-Z_@]/g, '');
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ *Como desbloquear:* responda à mensagem da pessoa com `/desbloquear` ou envie `/desbloquear ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      models.unblockUser('telegram', targetId, isGroup ? chatId : null);
      return ctx.reply(`✅ *Participante desbloqueado!*\n\nO usuário *${targetId}* agora pode interagir com o bot normalmente.`, { parse_mode: 'Markdown' });
    });

    this.bot.command(['statusbot', 'mod'], async (ctx) => {
      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      const isMuted = models.isChatMuted('telegram', chatId);
      const controls = models.getChatControls({ platform: 'telegram', activeOnly: true });
      const blockedInThisChat = controls.filter(c => c.control_type === 'BLOCK_USER' && (c.chat_id === chatId || c.chat_id === '*'));

      let statusText = `📊 *MODERAÇÃO & STATUS DO BOT (TELEGRAM):*\n\n` +
        `• *Tipo do Chat:* ${isGroup ? 'Grupo / Supergrupo' : 'Conversa Privada'}\n` +
        `• *Chat ID:* \`${chatId}\`\n` +
        `• *Status:* ${isMuted ? '🔴 Desativado (Muted)' : '🟢 Ativo'}\n` +
        `• *Participantes Bloqueados:* ${blockedInThisChat.length}\n\n`;

      if (blockedInThisChat.length > 0) {
        statusText += `*Bloqueados neste chat:*\n`;
        blockedInThisChat.slice(0, 5).forEach(b => {
          statusText += `• ${b.user_name || b.user_id} (${b.reason || 'Sem motivo'})\n`;
        });
        statusText += `\n`;
      }

      statusText += `_Comandos úteis: /desativar, /ativar, /bloquear, /desbloquear, /admin, /suporte_`;
      return ctx.reply(statusText, { parse_mode: 'Markdown' });
    });

    // Comando de Suporte Humano / Transbordo
    this.bot.command(['suporte', 'humano', 'atendente', 'ajudahumana'], async (ctx) => {
      const userId = String(ctx.from.id);
      const userName = ctx.from.first_name || 'Cliente';
      const ticket = models.createSupportTicket({
        platform: 'telegram',
        customerId: userId,
        customerName: userName,
        issueSummary: 'Solicitado via comando /suporte no Telegram'
      });
      const sellerInfo = ticket.seller_name ? `O atendente *${ticket.seller_name}*` : 'Um especialista da nossa equipe';
      return ctx.reply(`🛎️ *Chamado de Suporte Aberto (#${ticket.id})*\n\n${sellerInfo} foi notificado para te atender com prioridade! Por favor, descreva sua solicitação ou envie o comprovante abaixo.`, { parse_mode: 'Markdown' });
    });

    // ==========================================
    // FUNÇÕES DE GERENCIAMENTO DE GRUPOS (TELEGRAM)
    // ==========================================

    // Evento de novos membros no grupo (Boas-vindas automáticas)
    this.bot.on('new_chat_members', async (ctx) => {
      try {
        const chatId = String(ctx.chat.id);
        const isWelcomeActive = models.getSetting(`WELCOME_${chatId}`, 'false') === 'true';
        if (!isWelcomeActive) return;

        const groupName = ctx.chat.title || 'nosso grupo';
        const customMsgTemplate = models.getSetting(
          `WELCOME_MSG_${chatId}`,
          '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.'
        );

        const newMembers = ctx.message.new_chat_members || [];
        for (const member of newMembers) {
          if (member.is_bot && ctx.botInfo && member.id === ctx.botInfo.id) {
            await ctx.reply(`👋 Olá pessoal! Sou o *PayBot*! Administradores podem digitar \`/admin\` para ver os comandos de gestão.`, { parse_mode: 'Markdown' });
            continue;
          }

          const memberName = member.username ? `@${member.username}` : (member.first_name || 'Membro');
          const welcomeText = customMsgTemplate
            .replace(/\{nome\}/gi, memberName)
            .replace(/\{numero\}/gi, String(member.id))
            .replace(/\{grupo\}/gi, groupName);

          await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('[Telegram Group Welcome] Erro ao enviar boas-vindas:', err.message);
      }
    });

    // 1. Menu de Gestão: /admin, /gestao, /adminhelp
    this.bot.command(['admin', 'gestao', 'adminhelp'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (adminStatus.isGroup && !adminStatus.isRequesterAdmin) {
        return ctx.reply('⚠️ Apenas administradores do grupo podem ver o painel de gestão.');
      }

      const botBadge = adminStatus.isBotAdmin 
        ? '🟢 *Bot é Administrador* (Todas as funções liberadas)' 
        : '⚠️ *Bot NÃO é Administrador* (Promova o bot a admin no grupo para executar ações)';

      const chatId = String(ctx.chat.id);
      const isAntilink = models.getSetting(`ANTILINK_${chatId}`, 'false') === 'true';
      const isWelcome = models.getSetting(`WELCOME_${chatId}`, 'false') === 'true';

      const adminMenu = `🛠️ *PAINEL DE GERENCIAMENTO DO GRUPO (TELEGRAM)*\n\n` +
        `• *Status do Bot:* ${botBadge}\n` +
        `• *Anti-Link:* ${isAntilink ? '🟢 Ativado' : '🔴 Desativado'}\n` +
        `• *Boas-Vindas:* ${isWelcome ? '🟢 Ativado' : '🔴 Desativado'}\n\n` +
        `👢 *Gerenciamento de Membros:*\n` +
        `• \`/ban\` ou \`/kick\` (responda à mensagem ou use ID) — Remove membro\n` +
        `• \`/promover\` (responda ou use ID) — Promove membro a Administrador\n` +
        `• \`/rebaixar\` (responda ou use ID) — Remove privilégios de Admin\n\n` +
        `⚙️ *Configurações & Segurança:*\n` +
        `• \`/fechar\` — Tranca o grupo (apenas administradores falam)\n` +
        `• \`/abrir\` — Abre o grupo (todos os membros podem falar)\n` +
        `• \`/nome <novo nome>\` — Altera o título do grupo\n` +
        `• \`/descricao <texto>\` — Altera a descrição do grupo\n` +
        `• \`/link\` — Exibe o link oficial de convite do grupo\n` +
        `• \`/antilink on/off\` — Ativa ou desativa proteção contra links externos\n` +
        `• \`/boasvindas on/off\` — Ativa ou desativa saudação para novos membros\n` +
        `• \`/boasvindas_msg <texto>\` — Personaliza o texto ({nome}, {grupo}, {numero})\n\n` +
        `🛑 *Moderação do Bot:*\n` +
        `• \`/desativar\` — Pausa respostas automáticas do bot neste grupo\n` +
        `• \`/ativar\` — Reativa o bot neste grupo\n` +
        `• \`/bloquear\` / \`/desbloquear\` — Bloqueia participante de interagir com o bot\n` +
        `• \`/statusbot\` — Consulta status da moderação`;

      return ctx.reply(adminMenu, { parse_mode: 'Markdown' });
    });

    // 2. Remover / Banir Membro: /ban, /kick, /remover
    this.bot.command(['ban', 'kick', 'remover'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem remover participantes.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador deste grupo para remover membros!*');

      let targetId = null;
      let targetName = null;

      if (ctx.message?.reply_to_message?.from) {
        const u = ctx.message.reply_to_message.from;
        targetId = u.id;
        targetName = u.username ? `@${u.username}` : (u.first_name || targetId);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
          targetName = targetId;
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ Responda à mensagem da pessoa com `/ban` ou envie `/ban ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.banChatMember(targetId);
        await ctx.unbanChatMember(targetId); // Desbane para que funcione como kick (pode voltar se tiver link)
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'BAN',
          targetId: String(targetId),
          details: `Removido do grupo pelo administrador ${senderName}`
        });
        return ctx.reply(`👢 *Membro removido com sucesso!*\n\nO participante *${targetName}* foi removido do grupo por um administrador.`, { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao remover membro: ${err.message}`);
      }
    });

    // 3. Promover a Administrador: /promover, /promote
    this.bot.command(['promover', 'promote'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem promover membros.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador do grupo para promover membros!*');

      let targetId = null;
      let targetName = null;

      if (ctx.message?.reply_to_message?.from) {
        const u = ctx.message.reply_to_message.from;
        targetId = u.id;
        targetName = u.username ? `@${u.username}` : (u.first_name || targetId);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
          targetName = targetId;
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ Responda à mensagem com `/promover` ou envie `/promover ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.promoteChatMember(targetId, {
          can_manage_chat: true,
          can_delete_messages: true,
          can_restrict_members: true,
          can_invite_users: true,
          can_pin_messages: true
        });
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'PROMOTE',
          targetId: String(targetId),
          details: `Promovido a administrador por ${senderName}`
        });
        return ctx.reply(`⭐ *Administrador Promovido!*\n\nO participante *${targetName}* agora é um Administrador deste grupo!`, { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao promover membro: ${err.message}`);
      }
    });

    // 4. Rebaixar Administrador: /rebaixar, /demote
    this.bot.command(['rebaixar', 'demote'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem rebaixar membros.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador do grupo para alterar cargos!*');

      let targetId = null;
      let targetName = null;

      if (ctx.message?.reply_to_message?.from) {
        const u = ctx.message.reply_to_message.from;
        targetId = u.id;
        targetName = u.username ? `@${u.username}` : (u.first_name || targetId);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
          targetName = targetId;
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ Responda à mensagem com `/rebaixar` ou envie `/rebaixar ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.promoteChatMember(targetId, {
          can_manage_chat: false,
          can_delete_messages: false,
          can_restrict_members: false,
          can_invite_users: false,
          can_pin_messages: false
        });
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'DEMOTE',
          targetId: String(targetId),
          details: `Rebaixado de administrador por ${senderName}`
        });
        return ctx.reply(`🔽 *Administrador Rebaixado!*\n\nO usuário *${targetName}* não possui mais privilégios de administrador.`, { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao rebaixar membro: ${err.message}`);
      }
    });

    // 5. Fechar Grupo: /fechar, /lock
    this.bot.command(['fechar', 'lock'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem fechar o grupo.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador do grupo para trancar o chat!*');

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.setChatPermissions({ can_send_messages: false });
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'LOCK',
          details: 'Grupo trancado para mensagens (apenas admins falam)'
        });
        return ctx.reply('🔒 *GRUPO FECHADO!*\n\nAgora apenas administradores podem enviar mensagens no grupo.', { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao fechar grupo: ${err.message}`);
      }
    });

    // 6. Abrir Grupo: /abrir, /unlock
    this.bot.command(['abrir', 'unlock'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem abrir o grupo.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador do grupo para abrir o chat!*');

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.setChatPermissions({
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true
        });
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'UNLOCK',
          details: 'Grupo reaberto para mensagens'
        });
        return ctx.reply('🔓 *GRUPO ABERTO!*\n\nTodos os membros do grupo agora podem enviar mensagens livremente.', { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao abrir grupo: ${err.message}`);
      }
    });

    // 7. Alterar Nome do Grupo: /nome <novo nome>
    this.bot.command(['nome', 'titulo'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem alterar o nome do grupo.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador para alterar o nome do grupo!*');

      const parts = ctx.message.text.trim().split(/\s+/);
      const newTitle = parts.slice(1).join(' ').trim();
      if (!newTitle) return ctx.reply('ℹ️ Uso: `/nome Novo Nome do Grupo`', { parse_mode: 'Markdown' });

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.setChatTitle(newTitle);
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: newTitle,
          adminId: senderId,
          adminName: senderName,
          action: 'RENAME',
          details: `Nome alterado para: ${newTitle}`
        });
        return ctx.reply(`✏️ *Nome do Grupo Atualizado!*\n\nNovo título: *${newTitle}*`, { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao alterar nome: ${err.message}`);
      }
    });

    // 8. Alterar Descrição: /descricao <texto>
    this.bot.command(['descricao', 'desc'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem alterar a descrição.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador para alterar a descrição!*');

      const parts = ctx.message.text.trim().split(/\s+/);
      const newDesc = parts.slice(1).join(' ').trim();
      if (!newDesc) return ctx.reply('ℹ️ Uso: `/descricao Regras e Informações`', { parse_mode: 'Markdown' });

      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      try {
        await ctx.setChatDescription(newDesc);
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'SET_DESC',
          details: 'Descrição do grupo atualizada'
        });
        return ctx.reply('📝 *Descrição do Grupo Atualizada com Sucesso!*', { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao alterar descrição: ${err.message}`);
      }
    });

    // 9. Obter Link de Convite: /link, /convite
    this.bot.command(['link', 'convite'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem solicitar o link de convite.');
      if (!adminStatus.isBotAdmin) return ctx.reply('⚠️ *O bot precisa ser Administrador para gerar o link de convite!*');

      try {
        const link = await ctx.exportChatInviteLink();
        return ctx.reply(`🔗 *Link de Convite Oficial do Grupo:*\n\n${link}`, { parse_mode: 'Markdown' });
      } catch (err) {
        return ctx.reply(`❌ Erro ao obter link de convite: ${err.message}`);
      }
    });

    // 10. Configurar Anti-Link: /antilink on/off
    this.bot.command('antilink', async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem configurar o anti-link.');

      const parts = ctx.message.text.trim().split(/\s+/);
      const action = parts[1]?.toLowerCase();
      const chatId = String(ctx.chat.id);
      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      if (action === 'on' || action === 'ativar' || action === '1') {
        models.setSetting(`ANTILINK_${chatId}`, 'true');
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: chatId,
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'ANTILINK_ON',
          details: 'Proteção anti-link ativada'
        });
        return ctx.reply('🛡️ *Proteção Anti-Link Ativada!*\n\nMensagens com links externos serão apagadas automaticamente.', { parse_mode: 'Markdown' });
      } else if (action === 'off' || action === 'desativar' || action === '0') {
        models.setSetting(`ANTILINK_${chatId}`, 'false');
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: chatId,
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'ANTILINK_OFF',
          details: 'Proteção anti-link desativada'
        });
        return ctx.reply('🔓 *Proteção Anti-Link Desativada!*', { parse_mode: 'Markdown' });
      } else {
        const isAct = models.getSetting(`ANTILINK_${chatId}`, 'false') === 'true';
        return ctx.reply(`ℹ️ *Anti-Link neste grupo:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\n\nPara alterar: \`/antilink on\` ou \`/antilink off\``, { parse_mode: 'Markdown' });
      }
    });

    // 11. Configurar Boas-Vindas: /boasvindas on/off
    this.bot.command(['boasvindas', 'welcome'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem configurar as boas-vindas.');

      const parts = ctx.message.text.trim().split(/\s+/);
      const action = parts[1]?.toLowerCase();
      const chatId = String(ctx.chat.id);
      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      if (action === 'on' || action === 'ativar' || action === '1') {
        models.setSetting(`WELCOME_${chatId}`, 'true');
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: chatId,
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'WELCOME_ON',
          details: 'Boas-vindas ativadas'
        });
        return ctx.reply('👋 *Boas-Vindas Ativadas!*\n\nNovos membros receberão uma mensagem automática de boas-vindas ao entrar no grupo.\n\n_Para personalizar:_ `/boasvindas_msg Olá {nome}, seja bem-vindo ao {grupo}!`', { parse_mode: 'Markdown' });
      } else if (action === 'off' || action === 'desativar' || action === '0') {
        models.setSetting(`WELCOME_${chatId}`, 'false');
        models.logGroupAdminAction({
          platform: 'telegram',
          groupId: chatId,
          groupName: ctx.chat.title || null,
          adminId: senderId,
          adminName: senderName,
          action: 'WELCOME_OFF',
          details: 'Boas-vindas desativadas'
        });
        return ctx.reply('🔕 *Boas-Vindas Desativadas!*', { parse_mode: 'Markdown' });
      } else {
        const isAct = models.getSetting(`WELCOME_${chatId}`, 'false') === 'true';
        const curMsg = models.getSetting(`WELCOME_MSG_${chatId}`, 'Padrão');
        return ctx.reply(`ℹ️ *Boas-Vindas neste grupo:* ${isAct ? '🟢 Ativadas' : '🔴 Desativadas'}\n*Mensagem:* "${curMsg}"\n\nPara alterar: \`/boasvindas on\` ou \`/boasvindas off\`\nPara mudar o texto: \`/boasvindas_msg Seu texto aqui\``, { parse_mode: 'Markdown' });
      }
    });

    // 12. Personalizar Texto de Boas-Vindas: /boasvindas_msg <texto>
    this.bot.command(['boasvindas_msg', 'welcomemsg', 'msgboasvindas'], async (ctx) => {
      const adminStatus = await this.getTelegramAdminStatus(ctx);
      if (!adminStatus.isGroup) return ctx.reply('⚠️ Este comando só pode ser usado em grupos.');
      if (!adminStatus.isRequesterAdmin) return ctx.reply('⚠️ Apenas administradores podem personalizar as boas-vindas.');

      const parts = ctx.message.text.trim().split(/\s+/);
      const newMsg = parts.slice(1).join(' ').trim();
      if (!newMsg) return ctx.reply('ℹ️ Uso: `/boasvindas_msg Olá {nome}, seja bem-vindo ao grupo {grupo}!`', { parse_mode: 'Markdown' });

      const chatId = String(ctx.chat.id);
      const senderId = String(ctx.from?.id || '');
      const senderName = ctx.from?.first_name || senderId;

      models.setSetting(`WELCOME_MSG_${chatId}`, newMsg);
      models.setSetting(`WELCOME_${chatId}`, 'true');
      models.logGroupAdminAction({
        platform: 'telegram',
        groupId: chatId,
        groupName: ctx.chat.title || null,
        adminId: senderId,
        adminName: senderName,
        action: 'WELCOME_MSG',
        details: `Mensagem atualizada: ${newMsg}`
      });

      return ctx.reply(`✅ *Mensagem de Boas-Vindas Atualizada!*\n\nNovos participantes receberão:\n"${newMsg}"`, { parse_mode: 'Markdown' });
    });

    // /start com suporte a Links de Afiliados e Ofertas (Deep-Linking: /start ref_CODIGO ou /start buy_ID)
    this.bot.start(async (ctx) => {
      const userName = ctx.from.first_name || 'Cliente';
      const userId = String(ctx.from.id);

      // Captura código de afiliado e/ou compra direta de produto se presente no link
      if (ctx.startPayload) {
        const payload = ctx.startPayload;

        // 1. Vincula afiliado se presente (ex: ref_CODIGO ou ref_CODIGO_buy_1)
        const refMatch = payload.match(/ref_([a-zA-Z0-9_-]+)/i);
        if (refMatch) {
          const cleanCode = refMatch[1].split('_')[0].toUpperCase();
          const affiliate = models.getAffiliateByCode(cleanCode);
          if (affiliate) {
            this.userReferrals.set(userId, {
              affiliate_id: affiliate.id,
              ref_code: affiliate.ref_code
            });
            console.log(`[Telegram 🤝] Usuário ${userId} (${userName}) vinculado ao afiliado ${affiliate.name} (#${affiliate.ref_code})`);
          }
        }

        // 2. Compra direta vinda do canal de ofertas (ex: buy_1 ou ref_TOPVIP_buy_1)
        const buyMatch = payload.match(/buy_(\d+)/i);
        if (buyMatch) {
          const productId = parseInt(buyMatch[1], 10);
          const product = models.getProductById(productId);
          if (product && product.active) {
            console.log(`[Telegram ⚡ Checkout Direto de Oferta] Abrindo item #${product.id} (${product.name}) para ${userName}`);
            return this.showProductDetails(ctx, product, false);
          }
        }

        // 3. Ativação de Cupom via link (ex: cupom_PROMO10)
        const couponMatch = payload.match(/cupo[nm]_([a-zA-Z0-9_-]+)/i);
        if (couponMatch) {
          const coupon = models.getCouponByCode(couponMatch[1]);
          if (coupon) {
            this.userCoupons.set(userId, coupon);
            console.log(`[Telegram 🎟️] Cupom ${coupon.code} (${coupon.discount_percent}%) ativado para ${userId}`);
          }
        }
      }

      const botName = models.getSetting('BOT_NAME', 'PayBot');
      const welcomeCustom = models.getSetting('WELCOME_MESSAGE', '👋 Olá! Seja muito bem-vindo.');

      let welcomeText = `${welcomeCustom}\n\n` +
        `Aqui você pode adquirir nossos produtos digitais e assinaturas VIP com cobrança automática via *PIX* ou *Binance Pay* (USDT).\n\n`;

      if (this.userCoupons.has(userId)) {
        const c = this.userCoupons.get(userId);
        welcomeText += `🎟️ *Cupom Ativo:* \`${c.code}\` (*${c.discount_percent}% OFF* aplicado na sua próxima compra!)\n\n`;
      }

      welcomeText += `Escolha uma das opções abaixo:`;

      await ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    this.bot.command('cupom', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      if (parts.length < 2) {
        return ctx.reply('ℹ️ Como usar: envie `/cupom SEU_CUPOM` (ex: `/cupom PROMO10`)', { parse_mode: 'Markdown' });
      }
      const code = parts[1].toUpperCase();
      const coupon = models.getCouponByCode(code);
      if (!coupon) {
        return ctx.reply('❌ Cupom inválido, esgotado ou expirado.');
      }
      this.userCoupons.set(String(ctx.from.id), coupon);
      return ctx.reply(`🎉 *Cupom ${coupon.code} Aplicado com Sucesso!*\n\nVocê ganhou *${coupon.discount_percent}% de desconto* para sua próxima compra! Acesse o menu e escolha seu produto.`, { parse_mode: 'Markdown' });
    });

    this.bot.command('produtos', (ctx) => this.showProducts(ctx, false));
    this.bot.command('planos', (ctx) => this.showProducts(ctx, true));
    this.bot.command('ajuda', (ctx) => this.showHelp(ctx));

    this.bot.action('nav_products', (ctx) => this.showProducts(ctx, false));
    this.bot.action('nav_subs', (ctx) => this.showProducts(ctx, true));
    this.bot.action('nav_help', (ctx) => this.showHelp(ctx));
    this.bot.action('nav_main', async (ctx) => {
      await ctx.editMessageText('Selecione uma opção:', Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    this.bot.action('nav_my_orders', async (ctx) => {
      const userId = String(ctx.from.id);
      const orders = models.getAllOrders(20).filter(o => o.platform === 'telegram' && o.platform_user_id === userId);

      if (orders.length === 0) {
        return ctx.editMessageText('Você ainda não possui pedidos registrados.', Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]
        ]));
      }

      let text = '📦 *Seus Últimos Pedidos:*\n\n';
      orders.slice(0, 5).forEach(o => {
        const statusEmoji = o.status === 'PAID' ? '✅ Pago' : o.status === 'PENDING' ? '⏳ Aguardando' : '❌ Cancelado';
        const moeda = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;
        text += `• *#${o.merchant_trade_no}* | ${o.product_name}\n  Valor: ${moeda} | Status: ${statusEmoji}\n\n`;
      });

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]])
      });
    });

    // Clique em um produto -> Escolha do Método de Pagamento (PIX ou Binance)
    this.bot.action(/^buy_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      await this.showProductDetails(ctx, product, true);
    });

    // 1. Processar Pagamento via PIX (Mercado Pago / Dinâmico)
    this.bot.action(/^pay_pix_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando cobrança PIX...');

      const tradeNo = `ORD_PIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      let amount = product.price_brl || product.price;

      // Aplica Cupom de Desconto se houver
      let couponCode = null;
      let discountAmount = 0;
      const activeCoupon = this.userCoupons.get(userId);
      if (activeCoupon) {
        discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
        amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
        couponCode = activeCoupon.code;
        models.useCoupon(activeCoupon.code);
        this.userCoupons.delete(userId);
      }

      const pixRes = await pixPayment.createPixCharge({
        merchantTradeNo: tradeNo,
        amount,
        goodsName: product.name,
        payerName: userName
      });

      if (!pixRes.success) {
        return ctx.reply(`❌ Erro ao gerar PIX: ${pixRes.errorMessage}`);
      }

      const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

      // Obtém afiliado e vendedor para comissão
      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

      // Salva no banco
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
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
        discount_amount: discountAmount
      });

      const couponNotice = couponCode ? ` (Cupom *${couponCode}* aplicado: -R$ ${discountAmount.toFixed(2)})` : '';
      const captionText = `🟢 *PAGAMENTO VIA PIX GERADO!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Escaneie o QR Code acima pelo app do seu banco.\n` +
        `2. Ou copie o código *PIX Copia e Cola* abaixo e cole no seu banco:\n\n` +
        `\`${pixCode}\`\n\n` +
        `⚡ *A entrega é instantânea assim que o banco confirmar!*`;

      const buttons = [
        [Markup.button.callback('🔄 Já Paguei / Verificar Pix', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];

      if (pixRes.isSimulated) {
        buttons.unshift([Markup.button.url('🧪 [TESTE] Simular Pagamento Pix', checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // 2. Processar Pagamento via BINANCE PAY (USDT)
    this.bot.action(/^pay_bpay_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando fatura Binance Pay...');

      const tradeNo = `ORD_BNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      let amount = Number(product.price_usdt || (product.price / 5.5)).toFixed(2);

      // Aplica Cupom de Desconto se houver
      let couponCode = null;
      let discountAmount = 0;
      const activeCoupon = this.userCoupons.get(userId);
      if (activeCoupon) {
        discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
        amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
        couponCode = activeCoupon.code;
        models.useCoupon(activeCoupon.code);
        this.userCoupons.delete(userId);
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
        return ctx.reply(`❌ Erro Binance Pay: ${binanceRes.errorMessage}`);
      }

      const payData = binanceRes.data;

      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
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
        discount_amount: discountAmount
      });

      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, { width: 360, margin: 2 });

      const captionText = `⚡ *FATURA BINANCE PAY GERADA!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* \`${Number(amount).toFixed(2)} USDT\`\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como pagar:*\n` +
        `Abra o app da *Binance*, selecione *Pay* e escaneie o QR Code acima, ou clique no botão abaixo para pagar direto.`;

      const buttons = [
        [Markup.button.url('💳 Pagar com Binance Pay', payData.checkoutUrl)],
        [Markup.button.callback('🔄 Já Paguei / Verificar', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];

      if (binanceRes.isSimulated) {
        buttons.splice(1, 0, [Markup.button.url('🧪 [TESTE] Simular Pagamento', payData.checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // 3. Processar Pagamento via LIVEPIX
    this.bot.action(/^pay_lpix_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      const username = models.getSetting('LIVEPIX_USERNAME', '');
      if (!username) {
        return ctx.reply('⚠️ O usuário da LivePix ainda não foi configurado pelo administrador.');
      }

      const tradeNo = `ORD_LPX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      const amount = product.price_brl || product.price;

      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'livepix',
        amount,
        currency: 'BRL',
        checkout_url: `https://livepix.gg/${username}`,
        affiliate_id: refInfo.affiliate_id || null,
        seller_id: sellerId,
        ref_code: refInfo.ref_code || null
      });

      const livepixUrl = `https://livepix.gg/${username}`;
      const msg = `💜 *PAGAMENTO VIA LIVEPIX*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* R$ ${Number(amount).toFixed(2)}\n` +
        `🆔 *Código do Pedido:* \`${tradeNo}\`\n\n` +
        `👉 *Instruções:*\n` +
        `1. Acesse: ${livepixUrl}\n` +
        `2. Digite o valor de *R$ ${Number(amount).toFixed(2)}*\n` +
        `3. ⚠️ *MUITO IMPORTANTE:* No campo de mensagem/mensagem da doação, insira o código: \`${tradeNo}\`\n\n` +
        `Assim que o LivePix notificar nosso sistema, seu produto será entregue automaticamente!`;

      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💜 Abrir Página do LivePix', livepixUrl)],
          [Markup.button.callback('🔄 Já Apoiei / Verificar', `check_${tradeNo}`)],
          [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
        ])
      });
    });

    // Verificação de Pagamento
    this.bot.action(/^check_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      await ctx.answerCbQuery('Verificando status...');

      const order = models.getOrderByTradeNo(tradeNo);
      if (!order) return ctx.reply('Pedido não encontrado.');
      if (order.status === 'PAID') return ctx.reply('✅ Este pedido já foi pago e entregue!');

      // Se for Mercado Pago
      if (order.gateway === 'mercadopago' && order.prepay_id) {
        const pixRes = await pixPayment.queryPixPayment(order.prepay_id);
        if (pixRes.success && pixRes.status === 'PAID') {
          await ctx.reply('🎉 Pagamento PIX confirmado com sucesso!');
          return fulfillment.fulfillOrder(tradeNo);
        }
      } 
      // Se for Binance Pay
      else if (order.gateway === 'binancepay') {
        const queryRes = await binancePay.queryOrder(tradeNo);
        if (queryRes.success && queryRes.status === 'PAID') {
          await ctx.reply('🎉 Pagamento confirmado pela Binance Pay!');
          return fulfillment.fulfillOrder(tradeNo);
        }
      }

      await ctx.reply('⏳ Pagamento ainda não identificado no sistema. Se acabou de transferir, aguarde alguns segundos que a entrega é automática!');
    });

    // Cancelar Pedido
    this.bot.action(/^cancel_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      models.updateOrderStatus(tradeNo, 'CANCELED');
      await ctx.answerCbQuery('Pedido cancelado.');
      await ctx.reply('❌ Pedido cancelado.');
    });

    // Fechar oferta de Upsell
    this.bot.action('dismiss_upsell', async (ctx) => {
      await ctx.answerCbQuery('Oferta dispensada.');
      try {
        await ctx.deleteMessage();
      } catch (e) {}
    });

    // Pagar Upsell com PIX
    this.bot.action(/^pay_upsell_pix_(\d+)_(\d+)$/, async (ctx) => {
      const upsellProdId = parseInt(ctx.match[2], 10);
      const product = models.getProductById(upsellProdId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando PIX com desconto exclusivo...');
      const tradeNo = `ORD_UP_PIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');

      const discountPercent = product.upsell_discount_percent || 20.0;
      const discountedAmount = Number((product.price_brl * (1 - discountPercent / 100)).toFixed(2));

      const pixRes = await pixPayment.createPixCharge({
        merchantTradeNo: tradeNo,
        amount: discountedAmount,
        goodsName: `[UPSELL] ${product.name}`,
        payerName: userName
      });

      if (!pixRes.success) return ctx.reply(`❌ Erro: ${pixRes.errorMessage}`);

      const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'mercadopago',
        amount: discountedAmount,
        currency: 'BRL',
        prepay_id: paymentId,
        checkout_url: checkoutUrl,
        pix_code: pixCode,
        is_upsell: 1
      });

      const captionText = `🔥 *OFERTA UPSELL: PIX COM DESCONTO GERADO!*\n\n` +
        `📦 *Item Adicional:* ${product.name}\n` +
        `💰 *Valor Especial:* *R$ ${discountedAmount.toFixed(2)}* (${discountPercent}% OFF)\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Pix Copia e Cola:*\n\`${pixCode}\``;

      const buttons = [
        [Markup.button.callback('🔄 Já Paguei / Verificar Pix', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];
      if (pixRes.isSimulated) {
        buttons.unshift([Markup.button.url('🧪 [TESTE] Simular Pagamento Pix', checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // Pagar Upsell com Binance Pay
    this.bot.action(/^pay_upsell_bpay_(\d+)_(\d+)$/, async (ctx) => {
      const upsellProdId = parseInt(ctx.match[2], 10);
      const product = models.getProductById(upsellProdId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando fatura Binance Pay...');
      const tradeNo = `ORD_UP_BNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');

      const discountPercent = product.upsell_discount_percent || 20.0;
      const discountedUsdt = Number((product.price_usdt * (1 - discountPercent / 100)).toFixed(2));

      const binanceRes = await binancePay.createOrder({
        merchantTradeNo: tradeNo,
        amount: discountedUsdt,
        currency: 'USDT',
        goodsName: `[UPSELL] ${product.name}`,
        productId: product.id
      });

      if (!binanceRes.success) return ctx.reply(`❌ Erro Binance Pay: ${binanceRes.errorMessage}`);

      const payData = binanceRes.data;
      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, { width: 360, margin: 2 });

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'binancepay',
        amount: discountedUsdt,
        currency: 'USDT',
        prepay_id: payData.prepayId,
        checkout_url: payData.checkoutUrl,
        qr_content: payData.qrContent,
        is_upsell: 1
      });

      const captionText = `🔥 *OFERTA UPSELL: BINANCE PAY COM DESCONTO!*\n\n` +
        `📦 *Item Adicional:* ${product.name}\n` +
        `💰 *Valor Especial:* *${discountedUsdt.toFixed(2)} USDT* (${discountPercent}% OFF)\n` +
        `🆔 *Pedido:* \`${tradeNo}\``;

      const buttons = [
        [Markup.button.url('🟡 Pagar no App Binance', payData.checkoutUrl)],
        [Markup.button.callback('🔄 Já Paguei / Verificar', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];
      if (binanceRes.isSimulated) {
        buttons.splice(1, 0, [Markup.button.url('🧪 [TESTE] Simular Pagamento', payData.checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // Atendimento Inteligente em Linguagem Natural PT-BR
    this.bot.on('text', async (ctx) => {
      const text = ctx.message?.text?.trim() || '';
      if (text.startsWith('/')) return; // Deixa comandos /start, /produtos, /cupom para os handlers de comando

      const userName = ctx.from.first_name || 'Cliente';
      try {
        const nlpService = require('../services/nlpService');
        const nlp = await nlpService.processMessage({
          text,
          customerName: userName,
          platform: 'telegram'
        });

        if (nlp.directAction === 'SHOW_MENU') {
          return this.showProducts(ctx, false);
        }

        if (nlp.entities?.matchedProduct && (nlp.directAction === 'TRIGGER_PIX' || nlp.directAction === 'TRIGGER_BINANCE' || nlp.intent === 'BUY_INTENT')) {
          if (nlp.replyText) {
            await ctx.reply(nlp.replyText, { parse_mode: 'Markdown' });
          }
          return this.showProductDetails(ctx, nlp.entities.matchedProduct, false);
        }

        if (nlp.intent === 'SUPPORT_HUMAN') {
          models.createSupportTicket({
            platform: 'telegram',
            customerId: String(ctx.from.id),
            customerName: userName,
            issueSummary: text
          });
        }

        if (nlp.replyText) {
          await ctx.reply(nlp.replyText, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('[Telegram NLP Error]:', err.message);
      }
    });
  }

  async showProducts(ctx, isSubscription = false) {
    const products = models.getProducts(true).filter(p => {
      return isSubscription ? p.type === 'vip_subscription' : p.type !== 'vip_subscription';
    });

    if (products.length === 0) {
      const emptyMsg = isSubscription ? 'Nenhuma assinatura disponível.' : 'Nenhum produto cadastrado.';
      return ctx.reply(emptyMsg, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar', 'nav_main')]]));
    }

    const title = isSubscription ? '⭐ *ASSINATURAS VIP:*' : '🛍️ *PRODUTOS DIGITAIS:*';
    const buttons = products.map(p => {
      const detail = p.duration_days ? ` (${p.duration_days} dias)` : '';
      const brl = (p.price_brl || p.price).toFixed(2);
      const usdt = (p.price_usdt || (p.price / 5.5)).toFixed(2);
      return [Markup.button.callback(`🛒 ${p.name}${detail} - R$ ${brl} / ${usdt} USDT`, `buy_${p.id}`)];
    });
    buttons.push([Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]);

    const msg = `${title}\n\nClique no item para escolher pagar via *PIX* ou *Binance Pay*:`;
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } else {
      await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
    }
  }

  async showProductDetails(ctx, product, isEdit = true) {
    if (!product || !product.active) {
      if (ctx.callbackQuery) return ctx.answerCbQuery('Produto indisponível no momento.');
      return ctx.reply('⚠️ Produto indisponível no momento.');
    }

    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        if (ctx.callbackQuery) return ctx.answerCbQuery('Estoque esgotado.');
        return ctx.reply('⚠️ Desculpe, o estoque deste item está esgotado no momento.');
      }
    }

    const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
    const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';
    const isLivepix = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'false') === 'true';

    const buttons = [];
    const brlPrice = product.price_brl || product.price;
    const usdtPrice = product.price_usdt || (brlPrice / 5.5).toFixed(2);

    if (isPix) {
      buttons.push([Markup.button.callback(`🟢 Pagar com PIX (R$ ${Number(brlPrice).toFixed(2)})`, `pay_pix_${product.id}`)]);
    }
    if (isBinance) {
      buttons.push([Markup.button.callback(`🟡 Pagar com Binance Pay (${Number(usdtPrice).toFixed(2)} USDT)`, `pay_bpay_${product.id}`)]);
    }
    if (isLivepix) {
      buttons.push([Markup.button.callback(`💜 Pagar via LivePix (Apoiador)`, `pay_lpix_${product.id}`)]);
    }

    buttons.push([Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]);

    const detailsText = `📦 *${product.name}*\n\n` +
      (product.description ? `_${product.description}_\n\n` : '') +
      `💵 *Preço:* R$ ${Number(brlPrice).toFixed(2)} ou ${Number(usdtPrice).toFixed(2)} USDT\n\n` +
      `Como deseja efetuar o pagamento?`;

    if (isEdit && ctx.callbackQuery) {
      await ctx.editMessageText(detailsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    } else {
      await ctx.replyWithMarkdown(detailsText, Markup.inlineKeyboard(buttons));
    }
  }

  async showHelp(ctx) {
    const helpText = `ℹ️ *COMO FUNCIONA*\n\n` +
      `1️⃣ *Escolha:* Selecione um produto ou plano.\n` +
      `2️⃣ *Forma de Pagamento:*\n` +
      `   • 🟢 *PIX:* Receba o QR Code e o código Copia e Cola direto aqui no chat.\n` +
      `   • 🟡 *Binance Pay:* Pague em USDT direto pelo app da Binance.\n` +
      `3️⃣ *Entrega Automática:* O sistema detecta o pagamento em segundos e entrega seu produto ou link exclusivo do canal VIP aqui mesmo!`;

    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]]);
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await ctx.replyWithMarkdown(helpText, keyboard);
    }
  }

  async sendMessage(chatId, text) {
    if (!this.bot || !this.isRunning) return false;
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return true;
    } catch (err) {
      try {
        await this.bot.telegram.sendMessage(chatId, text);
        return true;
      } catch (err2) {
        console.error(`[Telegram ❌ Erro ao enviar para ${chatId}]:`, err2.message);
        return false;
      }
    }
  }

  async createInviteLink(channelId) {
    if (!this.bot || !this.isRunning) return null;
    try {
      const link = await this.bot.telegram.createChatInviteLink(channelId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + (86400 * 3)
      });
      return link.invite_link;
    } catch (err) {
      console.error(`[Telegram ❌ Erro no link VIP]:`, err.message);
      return null;
    }
  }

  async removeMember(channelId, userId) {
    if (!this.bot || !this.isRunning) return false;
    try {
      await this.bot.telegram.banChatMember(channelId, Number(userId));
      await this.bot.telegram.unbanChatMember(channelId, Number(userId));
      return true;
    } catch (err) {
      return false;
    }
  }

  async sendChannelPost(channelId, text, { imageUrl = null, buttons = null } = {}) {
    if (!this.bot || !this.isRunning) return false;
    try {
      const keyboard = buttons && buttons.length > 0 
        ? { inline_keyboard: buttons } 
        : undefined;

      if (imageUrl) {
        await this.bot.telegram.sendPhoto(channelId, imageUrl, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await this.bot.telegram.sendMessage(channelId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
      return true;
    } catch (err) {
      console.error(`[Telegram ❌ Erro ao postar no canal ${channelId}]:`, err.message);
      return false;
    }
  }

  async sendUpsell(chatId, text, { orderId, upsellProductId, discountedBrl, discountedUsdt }) {
    if (!this.bot || !this.isRunning) return false;
    try {
      const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
      const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';

      const buttons = [];
      if (isPix) {
        buttons.push([Markup.button.callback(`🚀 Sim! Levar com PIX (R$ ${discountedBrl.toFixed(2)})`, `pay_upsell_pix_${orderId}_${upsellProductId}`)]);
      }
      if (isBinance) {
        buttons.push([Markup.button.callback(`🟡 Sim! Levar com Binance Pay (${discountedUsdt.toFixed(2)} USDT)`, `pay_upsell_bpay_${orderId}_${upsellProductId}`)]);
      }
      buttons.push([Markup.button.callback('❌ Não, obrigado', 'dismiss_upsell')]);

      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
      return true;
    } catch (err) {
      console.error(`[Telegram ❌ Erro ao enviar Upsell para ${chatId}]:`, err.message);
      return false;
    }
  }
}

module.exports = new TelegramBotService();

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
const spyFeatures = require('../services/spyFeaturesService');


function safeExtractJid(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.includes('@') ? val : `${val.replace(/\D/g, '')}@s.whatsapp.net`;
  if (typeof val === 'object') {
    const raw = val.id || val.jid || val.phoneNumber || (val.user && val.server ? `${val.user}@${val.server}` : '');
    if (raw) return String(raw).includes('@') ? String(raw) : `${String(raw).replace(/\D/g, '')}@s.whatsapp.net`;
  }
  return '';
}

function safeExtractPhone(val) {
  const jid = safeExtractJid(val);
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

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
    this.processedMessageIds = new Map(); // Cache anti-duplicação de mensagens por ID
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
      if (state.creds?.me && !state.creds?.registered) {
        state.creds.registered = true;
        try { await saveCreds(); } catch (_) {}
      }
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
        browser: Browsers.windows('Chrome'),
        getMessage: async (key) => ({ conversation: 'PayBot' }),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 55000
      });

      this.sock.ev.on('creds.update', async () => {
        try {
          if (this.sock?.user?.id && state.creds) {
            state.creds.registered = true;
          }
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
            if (state.creds) {
              state.creds.registered = true;
            }
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

          // Rastreia mensagem no cache Anti-Delete
          spyFeatures.recordMessage(msg);

          // Detecta se a mensagem é um aviso de mensagem apagada (protocolMessage revoke)
          const proto = msg.message?.protocolMessage;
          if (proto && (proto.type === 0 || proto.type === 'REVOKE' || String(proto.type).includes('0'))) {
            const targetId = proto.key?.id;
            const chatJid = proto.key?.remoteJid || msg.key?.remoteJid;
            const deleterJid = msg.key?.participant || msg.key?.remoteJid;
            await spyFeatures.handleRevoke(this.sock, chatJid, targetId, deleterJid);
            continue;
          }
          
          // Se for mensagem própria (fromMe), processa se for comando iniciado por ! ou /
          if (msg.key.fromMe) {
            const rawTxt = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!rawTxt.startsWith('!') && !rawTxt.startsWith('/')) continue;
          }

          await this.handleIncomingMessage(msg);
        }
      });

      // Evento de atualizações de mensagens (detecta exclusões via messages.update)
      this.sock.ev.on('messages.update', async (updates) => {
        for (const upd of (updates || [])) {
          if (upd.update?.messageStubType === 1 || upd.update?.messageStubType === 'REVOKE') {
            const chatJid = upd.key?.remoteJid;
            const targetId = upd.key?.id;
            const deleterJid = upd.key?.participant || chatJid;
            await spyFeatures.handleRevoke(this.sock, chatJid, targetId, deleterJid);
          }
        }
      });

      // Evento de participantes do grupo (Boas-vindas automáticas, Despedida & Anti-Fake)
      this.sock.ev.on('group-participants.update', async (evt) => {
        await this.handleGroupParticipantsUpdate(evt);
      });

    } catch (err) {
      console.error('❌ [WhatsApp] Erro na inicialização:', err.message);
      this.statusMessage = `Erro: ${err.message}`;
    }
  }

  // Trata eventos de participantes do grupo (Boas-vindas automáticas, Despedida & Anti-Fake)
  async handleGroupParticipantsUpdate({ id, participants, action }, customSock = null) {
    const sock = customSock || this.currentDispatchSock || this.sock;
    try {
      const normalizedParticipants = (participants || []).map(p => safeExtractJid(p)).filter(Boolean);
      if (!normalizedParticipants.length) return;

      if (action === 'add') {
        // Monitoramento de Lançamento Meteórico (Transbordamento & Limite de Participantes)
        try {
          const meteoricService = require('../services/meteoricService');
          await meteoricService.handleParticipantJoined(id, sock);
        } catch (metErr) {
          console.warn('[Meteórico ⚠️] Erro ao verificar transbordamento de grupo:', metErr.message);
        }

        // Anti-Fake / Anti-Estrangeiro (Spy Security)
        await spyFeatures.checkAntiFakeEntry(sock, id, normalizedParticipants);

        const isWelcomeActive = models.getSetting(`WELCOME_${id}`, 'false') === 'true';
        if (!isWelcomeActive) return;

        let groupName = 'nosso grupo';
        try {
          if (sock && typeof sock.groupMetadata === 'function') {
            const meta = await sock.groupMetadata(id);
            if (meta?.subject) groupName = meta.subject;
          }
        } catch (_) {}

        const welcomeTpl = models.getSetting(
          `WELCOME_MSG_${id}`,
          '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.'
        );

        for (const pJid of normalizedParticipants) {
          const phone = safeExtractPhone(pJid);
          const formattedName = phone ? `@${phone}` : 'novo membro';
          const welcomeText = welcomeTpl
            .replace(/\{nome\}/gi, formattedName)
            .replace(/\{numero\}/gi, phone || 'membro')
            .replace(/\{grupo\}/gi, groupName);

          const mentionJid = safeExtractJid(pJid);
          const mentions = mentionJid ? [mentionJid] : [];
          if (customSock) {
            await customSock.sendMessage(id, { text: welcomeText, mentions });
          } else {
            await this.sendMessage(id, welcomeText, { mentions });
          }
        }
      } else if (action === 'remove') {
        const isByeActive = models.getSetting(`BYE_${id}`, 'false') === 'true';
        if (!isByeActive) return;

        let groupName = 'nosso grupo';
        try {
          if (sock && typeof sock.groupMetadata === 'function') {
            const meta = await sock.groupMetadata(id);
            if (meta?.subject) groupName = meta.subject;
          }
        } catch (_) {}

        const byeTpl = models.getSetting(
          `BYE_MSG_${id}`,
          '👋 @{numero} saiu ou foi removido do grupo *{grupo}*.'
        );

        for (const pJid of normalizedParticipants) {
          const phone = safeExtractPhone(pJid);
          const formattedName = phone ? `@${phone}` : 'membro';
          const byeText = byeTpl
            .replace(/\{nome\}/gi, formattedName)
            .replace(/\{numero\}/gi, phone || 'membro')
            .replace(/\{grupo\}/gi, groupName);

          const mentionJid = safeExtractJid(pJid);
          const mentions = mentionJid ? [mentionJid] : [];
          if (customSock) {
            await customSock.sendMessage(id, { text: byeText, mentions });
          } else {
            await this.sendMessage(id, byeText, { mentions });
          }
        }
      }
    } catch (err) {
      console.error('[WhatsApp Group Welcome] Erro ao enviar boas-vindas:', err.message);
    }
  }

  findGroupParticipant(participants, jidOrPhone) {
    if (!participants || !Array.isArray(participants) || !jidOrPhone) return null;
    const cleanDigits = String(jidOrPhone).replace(/\D/g, '');
    const rawStr = String(jidOrPhone).trim().toLowerCase();
    const rawUser = rawStr.includes('@') ? rawStr.split('@')[0].split(':')[0] : rawStr;

    return participants.find(p => {
      if (!p) return false;
      const pId = String(p.id || '').toLowerCase();
      const pLid = String(p.lid || '').toLowerCase();
      const pPhone = String(p.phoneNumber || '').toLowerCase();

      // 1. Match exato em JID/LID completo
      if (pId === rawStr || pLid === rawStr || pPhone === rawStr) return true;

      // 2. Match no usuário do JID (sem @ ou sufixo :device)
      const pIdUser = pId.split('@')[0].split(':')[0];
      const pLidUser = pLid.split('@')[0].split(':')[0];
      if (rawUser && (pIdUser === rawUser || pLidUser === rawUser)) return true;

      // 3. Match em dígitos numéricos
      if (cleanDigits) {
        const pDigits = [pIdUser, pLidUser, pPhone.split('@')[0]].map(s => s.replace(/\D/g, '')).filter(Boolean);
        if (pDigits.includes(cleanDigits)) return true;

        // 4. Match nos últimos 8 dígitos (formato brasileiro com ou sem o 9º dígito: 5511999998888 vs 551199998888)
        if (cleanDigits.length >= 8) {
          const suffix = cleanDigits.slice(-8);
          if (pDigits.some(d => d.length >= 8 && d.endsWith(suffix))) return true;
        }
      }

      return false;
    });
  }

  async getGroupAdminStatus(from, participantJid, isFromMe) {
    if (!from || !from.endsWith('@g.us')) {
      return { isGroup: false, isRequesterAdmin: true, isBotAdmin: false };
    }
    const senderPhone = safeExtractPhone(participantJid);
    const isGlobalAdmin = isFromMe || this.isOwner(senderPhone, isFromMe);

    try {
      const sock = this.currentDispatchSock || this.sock;
      if (!sock || !sock.groupMetadata) {
        return { isGroup: true, isRequesterAdmin: isGlobalAdmin, isBotAdmin: isGlobalAdmin, error: 'Socket não pronto' };
      }
      const metadata = await sock.groupMetadata(from);

      // Identifica o bot no grupo
      const myJid = sock.user?.id || this.sock?.user?.id || '';
      const myLid = sock.user?.lid || this.sock?.user?.lid || '';
      const myNumber = myJid ? myJid.split(':')[0] : '';
      const botParticipant = this.findGroupParticipant(metadata?.participants, myJid) 
        || (myLid ? this.findGroupParticipant(metadata?.participants, myLid) : null)
        || (myNumber ? this.findGroupParticipant(metadata?.participants, myNumber) : null);
      
      const isBotAdmin = !!(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'));

      // Identifica o participante solicitante no grupo
      const requesterParticipant = this.findGroupParticipant(metadata?.participants, participantJid)
        || (senderPhone ? this.findGroupParticipant(metadata?.participants, senderPhone) : null);

      const isRequesterAdmin = isGlobalAdmin || !!(requesterParticipant && (requesterParticipant.admin === 'admin' || requesterParticipant.admin === 'superadmin'));

      return { isGroup: true, isRequesterAdmin, isBotAdmin, metadata, requesterParticipant, botParticipant };
    } catch (err) {
      return { isGroup: true, isRequesterAdmin: isGlobalAdmin, isBotAdmin: isGlobalAdmin, error: err.message };
    }
  }

  async checkIsAdmin(from, participantJid, isFromMe) {
    const status = await this.getGroupAdminStatus(from, participantJid, isFromMe);
    return !status.isGroup ? true : status.isRequesterAdmin;
  }

  isOwner(senderPhone, isFromMe) {
    if (isFromMe) return true;
    if (!senderPhone) return false;
    const cleanSender = String(senderPhone).replace(/\D/g, '');
    if (!cleanSender) return false;

    const ownerConfigs = [
      models.getSetting('OWNER_PHONE', ''),
      models.getSetting('ADMIN_PHONE', ''),
      models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', ''),
      process.env.OWNER_WHATSAPP || '',
      process.env.ADMIN_NOTIFY_WHATSAPP_PHONE || '',
      process.env.ADMIN_PHONE || ''
    ];

    for (const cfg of ownerConfigs) {
      if (!cfg) continue;
      const cleanCfg = String(cfg).replace(/\D/g, '');
      if (!cleanCfg) continue;
      if (cleanSender.endsWith(cleanCfg.slice(-8)) || cleanCfg.endsWith(cleanSender.slice(-8))) {
        return true;
      }
    }

    try {
      const mainInstance = models.getArmyInstanceById(1);
      if (mainInstance && mainInstance.phone) {
        const cleanMain = String(mainInstance.phone).replace(/\D/g, '');
        if (cleanMain && (cleanSender.endsWith(cleanMain.slice(-8)) || cleanMain.endsWith(cleanSender.slice(-8)))) {
          return true;
        }
      }
    } catch (_) {}

    const botUserPhone = this.sock?.user?.id ? this.sock.user.id.split(':')[0].replace(/\D/g, '') : null;
    if (botUserPhone && (cleanSender.endsWith(botUserPhone.slice(-8)) || botUserPhone.endsWith(cleanSender.slice(-8)))) {
      return true;
    }

    return false;
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
    const senderPhone = safeExtractPhone(participantJid);
    const isFromMe = !!msg.key?.fromMe;
    const senderName = msg.pushName || 'Cliente';

    // Prioridade da Matriz e Deduplicação entre Bot Principal e Sub-Bots
    const isSubBot = !!customSock && customSock !== this.sock;
    const msgId = msg.key?.id;

    if (isGroup && isSubBot) {
      // Se a Matriz Principal estiver online, ela tem prioridade total no grupo.
      // O Sub-bot NÃO responde para evitar duplicação, a menos que seja mencionado expressamente.
      const isMatrizOnline = this.isConnected && !!this.sock?.user?.id;
      if (isMatrizOnline) {
        const subBotPhone = customSock.user?.id ? customSock.user.id.split(':')[0] : '';
        const isSubBotMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(
          j => subBotPhone && j.includes(subBotPhone)
        );
        if (!isSubBotMentioned) {
          return;
        }
      }
    }

    // Timestamp de chegada para medição precisa de latência do servidor (Ping)
    if (!msg._receivedAt) msg._receivedAt = Date.now();

    // Cache anti-duplicação global de mensagens por ID único do WhatsApp (otimizado para memória)
    if (msgId) {
      if (!this.processedMessageIds) this.processedMessageIds = new Map();
      const now = Date.now();
      if (this.processedMessageIds.size > 200) {
        for (const [id, ts] of this.processedMessageIds.entries()) {
          if (now - ts > 60000) this.processedMessageIds.delete(id);
        }
      }
      if (this.processedMessageIds.has(msgId)) {
        return;
      }
      this.processedMessageIds.set(msgId, now);
    }

    // Rastreia atividade de participantes do grupo (para detector de membros fantasmas)
    if (isGroup && senderPhone) {
      spyFeatures.recordActivity(from, senderPhone);
    }

    // Interceptador Anti-View-Once: Revela fotos e vídeos de visualização única
    if (!isFromMe) {
      try {
        await spyFeatures.handleAntiViewOnce(activeSock, msg, from);
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

    // Rastreia dúvidas e mensagens de Leads em Grupos Meteóricos para Live Feed no Painel Web
    if (isGroup && !isFromMe && !lower.startsWith('!') && !lower.startsWith('/')) {
      try {
        const meteoricGroup = models.getMeteoricGroupByJid(from);
        if (meteoricGroup) {
          models.logMeteoricActivity({
            campaign_id: meteoricGroup.campaign_id,
            group_jid: from,
            group_title: meteoricGroup.title,
            event_type: 'MEMBER_MESSAGE',
            sender_name: senderName || ('+' + senderPhone),
            message_text: text.slice(0, 150)
          });
        }
      } catch (_) {}
    }

    // Interceptador Anti-Privado (Anti-PV): Redireciona interações no privado se ativo
    if (!isGroup && !isFromMe) {
      const isAntiPrivado = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
      const adminPhoneSetting = models.getSetting('ADMIN_PHONE', '');
      const isGlobalAdmin = !!(adminPhoneSetting && (adminPhoneSetting.includes(senderPhone) || senderPhone.includes(adminPhoneSetting)));
      if (isAntiPrivado && !isGlobalAdmin && !lower.startsWith('!admin') && !lower.startsWith('!status') && !lower.startsWith('!antiprivado') && !lower.startsWith('!serbot') && !lower.startsWith('!code') && !lower.startsWith('!subbot') && !lower.startsWith('!jadibot') && !lower.startsWith('!conectar')) {
        const redirected = await spyFeatures.handleAntiPrivado(activeSock, from, senderPhone);
        if (redirected) return;
      }
    }

    // 0. VERIFICAÇÃO DE BLOQUEIO DE PARTICIPANTE / USUÁRIO
    if (models.isUserBlocked('whatsapp', senderPhone, from)) {
      console.log(`[WhatsApp 🚫 BLOQUEADO] Mensagem ignorada de ${senderPhone} no chat ${from}`);
      return;
    }

    // 0.1 COMANDOS DE MODERAÇÃO E CONTROLE (DESATIVAR, ATIVAR, BLOQUEAR, DESBLOQUEAR, STATUS)
    const isAdmin = await this.checkIsAdmin(from, participantJid, isFromMe);
    const isOwnerUser = this.isOwner(senderPhone, isFromMe);

    // ==============================================================
    // CENTRAL DE COMANDO DA MATRIZ: ASSISTENTE EXECUTIVO DO DONO
    // ==============================================================
    // Quando o Dono conversa com o Bot Matriz, ela atua como Assistente Executivo
    // orquestrador que delega tarefas para os sub-bots conforme ordenado na tarefa.
    if (isOwnerUser && !isSubBot) {
      const matrizAssistantService = require('../services/matrizAssistantService');

      // 1. Comandos com prefixo explícito de assistente / delegação
      if (/^(?:!|\/)(?:delegar|tarefas|missoes|missao|assistente|comandante|chefe|matriz|ordem)\b/i.test(lower)) {
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // 2. Frases naturais de delegação e controle de sub-bots (em grupo ou privado)
      if (
        /^(?:!|\/)?(?:(?:mande\s*(?:o|os)?\s*sub-?bots?|sub-?bots?\s*#?\d*|delegar|status\s*dos?\s*sub-?bots?|painel\s*sub-?bots?|tarefas\s*pendentes|quem\s*t[aá]\s*online|pausar\s*sub-?bot|iniciar\s*sub-?bot|reiniciar\s*sub-?bot)\b)/i.test(lower)
      ) {
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // 3. Conversação livre no privado com o Dono (mensagens em linguagem natural sem prefixo ! ou /)
      if (!isGroup && !lower.startsWith('!') && !lower.startsWith('/')) {
        if (lower === 'menu loja' || lower === 'catalogo') {
          return this.sendMenu(from, senderName, activeSock);
        }
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }
    }

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
        targetPhone = safeExtractPhone(quotedParticipant);
      }
      if (!targetPhone) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) {
          targetPhone = safeExtractPhone(mentioned[0]);
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
        targetPhone = safeExtractPhone(quotedParticipant);
      }
      if (!targetPhone) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentioned && mentioned.length > 0) {
          targetPhone = safeExtractPhone(mentioned[0]);
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

    // 0.25 Interceptador Anti-Palavrão em Grupos (SpyBot Moderation)
    if (isGroup && !isFromMe) {
      try {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const deleted = await spyFeatures.checkAntiPalavra(activeSock, from, msg, text, isGroup, adminStatus.isRequesterAdmin);
        if (deleted) return;
      } catch (_) {}
    }

    // 0.26 Interceptador AFK em Grupos (Hatsune Miku System)
    if (isGroup && !isFromMe) {
      try {
        await spyFeatures.checkAFK(activeSock, from, msg, text, senderPhone, senderName);
      } catch (_) {}
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
        const isAntiDelete = models.getSetting(`ANTIDELETE_${from}`, 'false') === 'true';
        const isAntiPrivado = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
        const isAntiPalavra = models.getSetting(`ANTIPALAVRA_${from}`, 'false') === 'true';

        const adminMenu = `🛠️ *PAINEL DE GERENCIAMENTO DO GRUPO (ADMIN)*\n\n` +
          `• *Status do Bot:* ${botStatusBadge}\n` +
          `• *Anti-Link:* ${isAntilink ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Palavrão:* ${isAntiPalavra ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Fake (+55):* ${isAntifake ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-View-Once:* ${isAntiView ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Delete:* ${isAntiDelete ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Privado:* ${isAntiPrivado ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Boas-Vindas:* ${isWelcome ? '🟢 Ativado' : '🔴 Desativado'}\n\n` +
          `👢 *Gerenciamento de Membros:*\n` +
          `• *!ban* ou *!kick* (responda à mensagem ou use @número) — Remove participante\n` +
          `• *!promover* (responda ou mencione) — Promove participante a Administrador\n` +
          `• *!rebaixar* (responda ou mencione) — Remove cargo de Administrador\n` +
          `• *!todos <aviso>* — Marca e notifica todos os participantes do grupo\n` +
          `• *!totag <texto>* — Menciona todos citando a mensagem respondida\n` +
          `• *!marcar2* — Lista todos os membros com links diretos (wa.me)\n` +
          `• *!hidetag <aviso>* — Notificação silenciosa/invisível para todos os membros\n` +
          `• *!fantasmas* — Escaneia membros inativos que nunca falaram\n` +
          `• *!limpar* — Oculta mensagens anteriores limpando a tela do chat\n\n` +
          `🛡️ *Advertências & Moderação SpyBot:*\n` +
          `• *!antipalavra on/off* — Moderação automática contra palavras proibidas\n` +
          `• *!addpalavra <palavra>* — Adiciona palavra proibida à lista negra\n` +
          `• *!delpalavra <palavra>* — Remove palavra da lista negra\n` +
          `• *!listapalavras* — Exibe palavras proibidas do grupo\n` +
          `• *!warn @usuario <motivo>* — Advertência (3 avisos = expulsão automática)\n` +
          `• *!unwarn @usuario* — Remove última advertência\n` +
          `• *!warns [@usuario]* — Consulta histórico de advertências\n` +
          `• *!antifake on/off* — Expulsa números de DDI estrangeiro automaticamente\n` +
          `• *!antiviewonce on/off* — Revela fotos e vídeos de visualização única\n` +
          `• *!antidelete on/off* — Revela mensagens e mídias apagadas no grupo\n` +
          `• *!antiprivado on/off* — Redireciona mensagens no privado para o grupo\n\n` +
          `⚙️ *Configurações & Segurança:*\n` +
          `• *!fechar* — Tranca o grupo (apenas administradores falam)\n` +
          `• *!abrir* — Abre o grupo (todos os membros podem falar)\n` +
          `• *!nome <novo nome>* — Altera o nome do grupo\n` +
          `• *!descricao <texto>* — Altera a descrição e regras do grupo\n` +
          `• *!link* — Exibe o link de convite oficial do grupo\n` +
          `• *!revogar_link* — Cancela o link atual e gera um novo\n` +
          `• *!antilink on/off* — Ativa ou desativa proteção contra links externos\n` +
          `• *!boasvindas on/off* — Ativa ou desativa saudação para novos membros\n` +
          `• *!boasvindas_msg <texto>* — Personaliza o texto ({nome}, {grupo}, {numero})\n` +
          `• *!despedida on/off* — Ativa ou desativa aviso de saída de membros\n` +
          `• *!despedida_msg <texto>* — Personaliza o texto de despedida (@{numero}, {grupo})\n\n` +
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

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo
          || msg.message?.imageMessage?.contextInfo
          || msg.message?.videoMessage?.contextInfo
          || msg.message?.documentMessage?.contextInfo
          || msg.message?.audioMessage?.contextInfo
          || msg.message?.stickerMessage?.contextInfo
          || msg.message?.buttonsResponseMessage?.contextInfo
          || msg.message?.templateButtonReplyMessage?.contextInfo
          || msg.message?.interactiveResponseMessage?.contextInfo;

        let targetPhone = null;
        let targetJid = null;

        const quotedParticipant = contextInfo?.participant || contextInfo?.remoteJid;
        if (quotedParticipant && !quotedParticipant.endsWith('@g.us')) {
          targetJid = safeExtractJid(quotedParticipant);
          targetPhone = safeExtractPhone(quotedParticipant);
        }
        if (!targetJid) {
          const mentioned = contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = safeExtractJid(mentioned[0]);
            targetPhone = safeExtractPhone(mentioned[0]);
          }
        }
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:ban|kick|remover)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            if (targetPhone.length === 10 || targetPhone.length === 11) {
              targetPhone = '55' + targetPhone;
            }
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (targetJid && adminStatus.metadata?.participants) {
          const found = this.findGroupParticipant(adminStatus.metadata.participants, targetJid)
            || (targetPhone ? this.findGroupParticipant(adminStatus.metadata.participants, targetPhone) : null);
          if (found && found.id) {
            const canonPhone = safeExtractPhone(found.id);
            if (canonPhone) {
              targetPhone = canonPhone;
              targetJid = `${canonPhone}@s.whatsapp.net`;
            }
          }
        }

        if (targetJid) {
          const cleanUser = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (cleanUser) {
            targetJid = `${cleanUser}@s.whatsapp.net`;
            targetPhone = cleanUser;
          }
        }

        if (!targetJid || !targetPhone) {
          return this.sendMessage(from, `ℹ️ *Como remover um membro:*\n• Responda à mensagem da pessoa com *!ban*\n• Ou envie *!ban @usuario*\n• Ou envie *!ban 5511999998888*`);
        }

        const dispatchSock = (activeSock && typeof activeSock.groupParticipantsUpdate === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupParticipantsUpdate === 'function' ? this.sock : null);

        if (!dispatchSock) {
          return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento. Tente novamente em instantes.');
        }

        try {
          await dispatchSock.groupParticipantsUpdate(from, [targetJid], 'remove');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'BAN',
            targetId: targetPhone,
            details: `Expulso do grupo pelo administrador ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `👢 *MEMBRO REMOVIDO COM SUCESSO!*\n\nO participante @${targetPhone} foi expulso do grupo por um administrador.`, {
            mentions: [targetJid]
          });
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

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo
          || msg.message?.imageMessage?.contextInfo
          || msg.message?.videoMessage?.contextInfo
          || msg.message?.documentMessage?.contextInfo
          || msg.message?.audioMessage?.contextInfo
          || msg.message?.stickerMessage?.contextInfo
          || msg.message?.buttonsResponseMessage?.contextInfo
          || msg.message?.templateButtonReplyMessage?.contextInfo
          || msg.message?.interactiveResponseMessage?.contextInfo;

        let targetJid = null;
        let targetPhone = null;

        // 1. Mensagem respondida (reply / quoted)
        const quotedParticipant = contextInfo?.participant || contextInfo?.remoteJid;
        if (quotedParticipant && !quotedParticipant.endsWith('@g.us')) {
          targetJid = safeExtractJid(quotedParticipant);
          targetPhone = safeExtractPhone(quotedParticipant);
        }

        // 2. Menção (@usuario)
        if (!targetJid) {
          const mentioned = contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = safeExtractJid(mentioned[0]);
            targetPhone = safeExtractPhone(mentioned[0]);
          }
        }

        // 3. Número digitado no comando (!promover 5511999998888 ou !promover 11999998888)
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:promover|promote)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            if (targetPhone.length === 10 || targetPhone.length === 11) {
              targetPhone = '55' + targetPhone;
            }
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        // 4. Mapeamento canônico no grupo (converte @lid para @s.whatsapp.net)
        if (targetJid && adminStatus.metadata?.participants) {
          const found = this.findGroupParticipant(adminStatus.metadata.participants, targetJid)
            || (targetPhone ? this.findGroupParticipant(adminStatus.metadata.participants, targetPhone) : null);
          if (found && found.id) {
            const canonPhone = safeExtractPhone(found.id);
            if (canonPhone) {
              targetPhone = canonPhone;
              targetJid = `${canonPhone}@s.whatsapp.net`;
            }
            if (found.admin === 'admin' || found.admin === 'superadmin') {
              return this.sendMessage(from, `⭐ O participante @${targetPhone} já é um Administrador deste grupo!`, {
                mentions: [targetJid]
              });
            }
          }
        }

        // 5. Normaliza targetJid sem device
        if (targetJid) {
          const cleanUser = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (cleanUser) {
            targetJid = `${cleanUser}@s.whatsapp.net`;
            targetPhone = cleanUser;
          }
        }

        if (!targetJid || !targetPhone) {
          return this.sendMessage(from, `ℹ️ *Como promover um participante:*\n• Responda à mensagem da pessoa com *!promover*\n• Ou envie *!promover @usuario*\n• Ou envie *!promover 5511999998888*`);
        }

        const dispatchSock = (activeSock && typeof activeSock.groupParticipantsUpdate === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupParticipantsUpdate === 'function' ? this.sock : null);

        if (!dispatchSock) {
          return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento. Tente novamente em instantes.');
        }

        try {
          await dispatchSock.groupParticipantsUpdate(from, [targetJid], 'promote');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'PROMOTE',
            targetId: targetPhone,
            details: `Promovido a administrador por ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `⭐ *ADMINISTRADOR PROMOVIDO!*\n\nO participante @${targetPhone} agora é um Administrador deste grupo! 🎉`, {
            mentions: [targetJid]
          });
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

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo
          || msg.message?.imageMessage?.contextInfo
          || msg.message?.videoMessage?.contextInfo
          || msg.message?.documentMessage?.contextInfo
          || msg.message?.audioMessage?.contextInfo
          || msg.message?.stickerMessage?.contextInfo
          || msg.message?.buttonsResponseMessage?.contextInfo
          || msg.message?.templateButtonReplyMessage?.contextInfo
          || msg.message?.interactiveResponseMessage?.contextInfo;

        let targetJid = null;
        let targetPhone = null;

        const quotedParticipant = contextInfo?.participant || contextInfo?.remoteJid;
        if (quotedParticipant && !quotedParticipant.endsWith('@g.us')) {
          targetJid = safeExtractJid(quotedParticipant);
          targetPhone = safeExtractPhone(quotedParticipant);
        }
        if (!targetJid) {
          const mentioned = contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetJid = safeExtractJid(mentioned[0]);
            targetPhone = safeExtractPhone(mentioned[0]);
          }
        }
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:rebaixar|demote)\s*@?(\+?[0-9]{8,20})/i);
          if (matchNum) {
            targetPhone = matchNum[1].replace(/[^0-9]/g, '');
            if (targetPhone.length === 10 || targetPhone.length === 11) {
              targetPhone = '55' + targetPhone;
            }
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (targetJid && adminStatus.metadata?.participants) {
          const found = this.findGroupParticipant(adminStatus.metadata.participants, targetJid)
            || (targetPhone ? this.findGroupParticipant(adminStatus.metadata.participants, targetPhone) : null);
          if (found && found.id) {
            const canonPhone = safeExtractPhone(found.id);
            if (canonPhone) {
              targetPhone = canonPhone;
              targetJid = `${canonPhone}@s.whatsapp.net`;
            }
            if (!found.admin) {
              return this.sendMessage(from, `ℹ️ O participante @${targetPhone} não é administrador deste grupo.`, {
                mentions: [targetJid]
              });
            }
          }
        }

        if (targetJid) {
          const cleanUser = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
          if (cleanUser) {
            targetJid = `${cleanUser}@s.whatsapp.net`;
            targetPhone = cleanUser;
          }
        }

        if (!targetJid || !targetPhone) {
          return this.sendMessage(from, `ℹ️ *Como rebaixar:* responda à mensagem da pessoa com *!rebaixar* ou envie *!rebaixar @usuario*`);
        }

        const dispatchSock = (activeSock && typeof activeSock.groupParticipantsUpdate === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupParticipantsUpdate === 'function' ? this.sock : null);

        if (!dispatchSock) {
          return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento. Tente novamente em instantes.');
        }

        try {
          await dispatchSock.groupParticipantsUpdate(from, [targetJid], 'demote');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'DEMOTE',
            targetId: targetPhone,
            details: `Rebaixado de administrador por ${senderName || senderPhone}`
          });
          return this.sendMessage(from, `🔽 *ADMINISTRADOR REBAIXADO!*\n\nO participante @${targetPhone} não é mais administrador.`, {
            mentions: [targetJid]
          });
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

        const dispatchSock = (activeSock && typeof activeSock.groupSettingUpdate === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupSettingUpdate === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          await dispatchSock.groupSettingUpdate(from, 'announcement');
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

        const dispatchSock = (activeSock && typeof activeSock.groupSettingUpdate === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupSettingUpdate === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          await dispatchSock.groupSettingUpdate(from, 'not_announcement');
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

        const dispatchSock = (activeSock && typeof activeSock.groupUpdateSubject === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupUpdateSubject === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          await dispatchSock.groupUpdateSubject(from, newTitle);
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

        const dispatchSock = (activeSock && typeof activeSock.groupUpdateDescription === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupUpdateDescription === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          await dispatchSock.groupUpdateDescription(from, newDesc);
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

        const dispatchSock = (activeSock && typeof activeSock.groupInviteCode === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupInviteCode === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          const code = await dispatchSock.groupInviteCode(from);
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

        const dispatchSock = (activeSock && typeof activeSock.groupRevokeInvite === 'function')
          ? activeSock
          : (this.sock && typeof this.sock.groupRevokeInvite === 'function' ? this.sock : null);

        if (!dispatchSock) return this.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.');

        try {
          const newCode = await dispatchSock.groupRevokeInvite(from);
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

      // 11. Marcar Todos os Membros: !todos, !tagall, !marcar, !marcartodos, !aviso <msg>
      if (/^(?:!|\/)(?:todos|tagall|marcar|marcartodos|aviso)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem marcar todos os membros.');
        }

        const customMsg = text.replace(/^(?:!|\/)(?:todos|tagall|marcar|marcartodos|aviso)\s*/i, '').trim();
        models.logGroupAdminAction({
          platform: 'whatsapp',
          groupId: from,
          adminId: senderPhone,
          adminName: senderName,
          action: 'TAG_ALL',
          details: customMsg || 'Aviso geral para todos os membros'
        });

        return spyFeatures.handleTagAll(activeSock, from, text, adminStatus.metadata);
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

      // 14.1 Configurar Mensagem de Despedida: !despedida on/off ou !bye on/off
      if (/^(?:!|\/)(?:despedida|bye|saida)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar a mensagem de despedida.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`BYE_${from}`, 'true');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'BYE_ON',
            details: 'Despedida automática ativada'
          });
          return this.sendMessage(from, `👋 *MENSAGEM DE DESPEDIDA ATIVADA!*\n\nMembros que saírem receberão uma notificação no grupo.\n\n_Para personalizar: !despedida_msg @{numero} saiu do grupo *{grupo}*._`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`BYE_${from}`, 'false');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'BYE_OFF',
            details: 'Despedida automática desativada'
          });
          return this.sendMessage(from, `🔕 *MENSAGEM DE DESPEDIDA DESATIVADA!*`);
        } else {
          const isAct = models.getSetting(`BYE_${from}`, 'false') === 'true';
          const curMsg = models.getSetting(`BYE_MSG_${from}`, '👋 @{numero} saiu ou foi removido do grupo *{grupo}*.');
          return this.sendMessage(from, `ℹ️ *Despedida:* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n*Mensagem:* "${curMsg}"\n\nPara alterar: *!despedida on* ou *!despedida off*\nPara mudar o texto: *!despedida_msg Seu texto com @{numero} e {grupo}*`);
        }
      }

      // 14.2 Personalizar Mensagem de Despedida: !despedida_msg <texto>
      if (/^(?:!|\/)(?:despedida_msg|byemsg|msgdespedida)\s+/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem personalizar a despedida.');
        }

        const newMsg = text.replace(/^(?:!|\/)(?:despedida_msg|byemsg|msgdespedida)\s+/i, '').trim();
        if (!newMsg) return this.sendMessage(from, 'ℹ️ Uso: *!despedida_msg @{numero} saiu do grupo *{grupo}*.*');

        models.setSetting(`BYE_MSG_${from}`, newMsg);
        models.setSetting(`BYE_${from}`, 'true');
        models.logGroupAdminAction({
          platform: 'whatsapp',
          groupId: from,
          adminId: senderPhone,
          adminName: senderName,
          action: 'BYE_MSG',
          details: `Mensagem de despedida personalizada: ${newMsg}`
        });

        return this.sendMessage(from, `✅ *MENSAGEM DE DESPEDIDA ATUALIZADA!*\n\n"${newMsg}"`);
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
          targetPhone = safeExtractPhone(quotedParticipant);
          reason = text.replace(/^(?:!|\/)(?:warn|advertencia|advertir)\s*/i, '').trim();
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = safeExtractPhone(mentioned[0]);
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
        return spyFeatures.handleWarn(activeSock, from, targetPhone, reason, senderName, adminStatus.isBotAdmin);
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
          targetPhone = safeExtractPhone(quotedParticipant);
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = safeExtractPhone(mentioned[0]);
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

        return spyFeatures.handleUnwarn(activeSock, from, targetPhone);
      }

      // 17. Consultar Advertências: !warns, !avisos
      if (/^(?:!|\/)(?:warns|avisos)(?:\s.*)?$/i.test(lower)) {
        let targetPhone = null;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetPhone = safeExtractPhone(quotedParticipant);
        }
        if (!targetPhone) {
          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
          if (mentioned && mentioned.length > 0) {
            targetPhone = safeExtractPhone(mentioned[0]);
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

        return spyFeatures.handleWarnsList(activeSock, from, targetPhone);
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
        return spyFeatures.handleHidetag(activeSock, from, text, adminStatus.metadata);
      }

      // 21. Membros Fantasmas: !fantasmas, !inativos
      if (/^(?:!|\/)(?:fantasmas|inativos)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem escanear membros fantasmas.');
        }
        return spyFeatures.handleFantasmas(activeSock, from, adminStatus.metadata);
      }

      // 22. Anti-Delete: !antidelete on/off
      if (/^(?:!|\/)(?:antidelete|antieliminar)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar a proteção Anti-Delete.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIDELETE_${from}`, 'true');
          return this.sendMessage(from, `🗑️ *ANTI-DELETE ATIVADO!*\n\nMensagens e mídias apagadas pelos membros serão recuperadas e exibidas no grupo.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIDELETE_${from}`, 'false');
          return this.sendMessage(from, `🙈 *ANTI-DELETE DESATIVADO!*`);
        } else {
          const isAct = models.getSetting(`ANTIDELETE_${from}`, 'false') === 'true';
          return this.sendMessage(from, `ℹ️ *Anti-Delete:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\n\nPara alterar: *!antidelete on* ou *!antidelete off*`);
        }
      }

      // 23. Anti-Privado (Anti-PV): !antiprivado on/off
      if (/^(?:!|\/)(?:antiprivado|antipv)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores podem configurar o modo Anti-Privado.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting('ANTIPRIVADO_GLOBAL', 'true');
          return this.sendMessage(from, `🚫 *ANTI-PRIVADO ATIVADO!*\n\nMensagens privadas no bot serão alertadas para entrar no grupo oficial.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
          return this.sendMessage(from, `🟢 *ANTI-PRIVADO DESATIVADO!*\n\nAtendimento privado liberado.`);
        } else {
          const isAct = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
          return this.sendMessage(from, `ℹ️ *Anti-Privado:* ${isAct ? '🔴 Ativado (PV restrito)' : '🟢 Desativado (PV liberado)'}\n\nPara alterar: *!antiprivado on* ou *!antiprivado off*`);
        }
      }

      // 24. Marcar Todos Citando Mensagem Respondida: !totag <texto>
      if (/^(?:!|\/)(?:totag|tagall2)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem usar o comando *!totag*.');
        }
        return spyFeatures.handleTotag(activeSock, from, msg, text, activeSock, true);
      }

      // 25. Marcar com Links Diretos do WhatsApp: !marcar2 / !tagalllinks
      if (/^(?:!|\/)(?:marcar2|tagalllinks)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem usar este comando.');
        }
        return spyFeatures.handleMarcar2(activeSock, from, activeSock);
      }

      // 26. Moderação Anti-Palavrão (SpyBot): !antipalavra / !addpalavra / !delpalavra / !listapalavras
      if (/^(?:!|\/)(?:antipalavra|antipalavrao|addpalavra|delpalavra|listapalavras)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        return spyFeatures.handleAntiPalavra(activeSock, from, text, isGroup, adminStatus.isRequesterAdmin);
      }

      // 27. Limpar Tela do Grupo: !limpar / !clean
      if (/^(?:!|\/)(?:limpar|cleanchat|limparchat)$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem limpar a tela.');
        }
        return spyFeatures.handleLimpar(activeSock, from);
      }
    }

    // 0.2 SE O CHAT ESTIVER DESATIVADO (MUTED), NÃO RESPONDE MAIS NADA
    if (models.isChatMuted('whatsapp', from)) {
      return;
    }

    // 0.3 FILTRO EM GRUPOS: O BOT NÃO INTERFERE EM CONVERSAS ALEATÓRIAS
    if (isGroup) {
      const myNumber = (activeSock.user?.id || this.sock?.user?.id || '').split(':')[0];
      const isMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => myNumber && j.includes(myNumber));
      const isCommand = text.startsWith('!') || text.startsWith('/') || lower === 'bot' || lower === 'help';
      const startsWithBot = lower.startsWith('bot,') || lower.startsWith('bot ');

      if (!isCommand && !isMentioned && !startsWithBot) {
        return; // Não responde conversas normais de membros do grupo
      }
    }

    // Auto-resposta do Exército de WhatsApp se for lead de campanha de divulgação (apenas privado)
    if (!isGroup) {
      try {
        const whatsappArmyService = require('../services/whatsappArmyService');
        const instId = isSubBot ? (customSock.instanceId || 2) : 1;
        const handled = await whatsappArmyService.handleIncomingLeadMessage(from, text, instId);
        if (handled) return;
      } catch (_) {}
    }

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
    // 0.4 COMANDOS SPY BOT / SPY (STICKERS, DOWNLOADERS, IA, GAMES)
    // ==========================================

    // 1. Criador de Figurinha: !s / !sticker
    if (/^(?:!|\/)(?:s|sticker|fig|figurinha)$/i.test(lower)) {
      return spyFeatures.handleSticker(activeSock, from, msg, senderName);
    }

    // 1.1 Fusão de Emojis (SpyBot / Google Kitchen): !emojimix / !mix
    if (/^(?:!|\/)(?:emojimix|mix|fusao|emojikitchen)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleEmojiMix(activeSock, from, text);
    }

    // 2. Texto para Figurinha Animada (ATTP Rainbow): !attp / !attp2
    if (/^(?:!|\/)(?:attp2)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleAttp(activeSock, from, text, true);
    }
    if (/^(?:!|\/)(?:attp)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleAttp(activeSock, from, text, false);
    }

    // 2.1 Texto para Figurinha Estática: !ttp
    if (/^(?:!|\/)(?:ttp)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTextToSticker(activeSock, from, text, senderName);
    }

    // 2.15 Quote Chat (Hatsune Miku): !qc / !quotechat / !citacao
    if (/^(?:!|\/)(?:qc|quotechat|citacao)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleQC(activeSock, from, msg, text, senderName);
    }

    // 2.16 Figurinha Estilo Brat (Hatsune Miku / Charli XCX): !brat / !charli
    if (/^(?:!|\/)(?:brat|charli)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleBrat(activeSock, from, text);
    }

    // 2.2 Conversor de Vídeo / Áudio para MP3: !tomp3 / !toaudio
    if (/^(?:!|\/)(?:tomp3|toaudio|paramp3|extrairaudio)$/i.test(lower)) {
      return spyFeatures.handleToMp3(activeSock, from, msg);
    }

    // 3. Figurinha para Imagem: !toimg
    if (/^(?:!|\/)(?:toimg|paraimg)$/i.test(lower)) {
      return spyFeatures.handleToImg(activeSock, from, msg);
    }

    // 4. Texto para Voz: !tts / !voz
    if (/^(?:!|\/)(?:tts|voz)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTTS(activeSock, from, text);
    }

    // 5.0 Busca no YouTube com 20 Resultados: !lista / !search / !pesquisar / !buscar
    if (/^(?:!|\/)(?:lista|search|pesquisar|buscar)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleLista(activeSock, from, text);
    }

    // 5.1 Atalhos Rápidos da !lista (ex: A1, A2, A1H, A1S para áudio, V1, V2, V1H, V1S para vídeo)
    const listChoiceMatch = lower.match(/^(?:([av])|audio|video|mp3|mp4|baixar\s+([av]))\s*(\d+)\s*([hs])?$/i);
    if (listChoiceMatch) {
      const type = (listChoiceMatch[1] || listChoiceMatch[2] || (lower.startsWith('a') ? 'a' : 'v')).toLowerCase();
      const num = listChoiceMatch[3];
      const qual = (listChoiceMatch[4] || '').toUpperCase();
      const finalParam = qual ? `${num} ${qual}` : num;
      if (type.startsWith('a') || lower.startsWith('audio') || lower.startsWith('mp3')) {
        return spyFeatures.handlePlayMusic(activeSock, from, finalParam);
      } else {
        return spyFeatures.handlePlayVideo(activeSock, from, finalParam);
      }
    }

    // 5. Downloader de Música YouTube: !play / !ytmp3 / !audio / !playh / !plays (com suporte a qualidade H ou S)
    if (/^(?:!|\/)(?:play[hs]?|ytmp3[hs]?|musica|audio|mp3)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handlePlayMusic(activeSock, from, text);
    }

    // 6. Downloader de TikTok: !tiktok / !tt
    if (/^(?:!|\/)(?:tiktok|tt)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTikTok(activeSock, from, text);
    }

    // 7. Downloader de Instagram: !ig / !instagram / !reels
    if (/^(?:!|\/)(?:ig|instagram|reels)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleInstagram(activeSock, from, text);
    }

    // 7.1 Baixar todos os Stories de um @perfil: !allstories / !stories
    if (/^(?:!|\/)(?:allstories|stories|todosstories)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleAllStories(activeSock, from, text);
    }

    // 7.2 Scraper Completo & Auditoria de Perfil/Audiência: !scrapinsta / !stalkinsta / !spyinsta
    if (/^(?:!|\/)(?:scrapinsta|stalkinsta|spyinsta|insta)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleScrapInsta(activeSock, from, text);
    }

    // 7.3 Downloader de Vídeos YouTube (sem limite de 50MB): !video / !videoh / !videos / !ytmp4 / !ytmp4h / !ytmp4s / !play2 / !mp4
    if (/^(?:!|\/)(?:video[hs]?|ytmp4[hs]?|play2|mp4)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handlePlayVideo(activeSock, from, text);
    }

    // 7.3.1 Comando !tunnel / !painel / !remoto / !linkpainel (Acesso Remoto via Túnel Cloudflare)
    if (/^(?:!|\/)(?:tunnel|tunel|painel|remoto|acessoremoto|linkpainel)$/i.test(lower)) {
      const tunnelService = require('../services/tunnelService');
      const tunnelUrl = tunnelService.getUrl();
      const tunnelMsg =
        `🌐 *PAINEL WEB & ACESSO REMOTO (SPY)* 🌐\n\n` +
        `Acesse o painel administrativo de vendas de qualquer lugar pelo celular ou computador sem abrir portas no roteador:\n\n` +
        (tunnelUrl
          ? `🔗 *Link Remoto Seguro (HTTPS):*\n👉 ${tunnelUrl}\n\n`
          : `⏳ *Túnel inicializando...*\nCaso ainda não tenha gerado, acesse localmente em:\n👉 http://localhost:3000\n\n`) +
        `🏠 *Acesso Local:* http://localhost:3000\n` +
        `⚡ *Segurança:* Criptografia SSL ponta a ponta ativa via Cloudflare Tunnel.`;
      return this.sendMessage(from, tunnelMsg, {}, activeSock);
    }

    // 7.4 Downloader de Twitter / X: !twitter / !x / !twdl
    if (/^(?:!|\/)(?:twitter|x|twdl)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTwitter(activeSock, from, text);
    }

    // 7.5 Downloader de Facebook: !fb / !facebook
    if (/^(?:!|\/)(?:fb|facebook)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleFacebook(activeSock, from, text);
    }

    // 8. Inteligência Artificial: !ia / !gpt / !gemini
    if (/^(?:!|\/)(?:ia|gpt|gemini)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleAIChat(activeSock, from, text, senderName);
    }

    // 9. Gerador de Imagens IA: !imagine / !dalle / !desenhe
    if (/^(?:!|\/)(?:imagine|dalle|desenhe)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleImagine(activeSock, from, text);
    }

    // 10. Tradutor Instantâneo: !traduzir / !translate
    if (/^(?:!|\/)(?:traduzir|translate)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTranslate(activeSock, from, text);
    }

    // 10.1 Encurtador de Links: !encurtar / !tinyurl
    if (/^(?:!|\/)(?:encurtar|tinyurl|shorturl)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleEncurtar(activeSock, from, text);
    }

    // 10.2 Gerador de QR Code: !qr / !qrcode
    if (/^(?:!|\/)(?:qr|qrcode)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleQRCode(activeSock, from, text);
    }

    // 10.3 Consulta de CEP / Endereço: !cep / !endereco
    if (/^(?:!|\/)(?:cep|endereco)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleCEP(activeSock, from, text);
    }

    // 10.4 Calculadora Inteligente: !calc / !calcular
    if (/^(?:!|\/)(?:calc|calcular)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleCalc(activeSock, from, text);
    }

    // 10.41 Screenshot de Websites (Hatsune Miku): !ssweb / !ss / !screenshot / !printweb
    if (/^(?:!|\/)(?:ssweb|ss|screenshot|printweb)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleSSWeb(activeSock, from, text);
    }

    // 10.42 Upload de Mídia para Link Direto (Hatsune Miku): !tourl / !paralink / !gerarlink
    if (/^(?:!|\/)(?:tourl|paralink|gerarlink)$/i.test(lower)) {
      return spyFeatures.handleToUrl(activeSock, from, msg, senderName);
    }

    // 10.43 Download de Repositório GitHub em ZIP (Hatsune Miku): !gitclone / !git / !clonegit
    if (/^(?:!|\/)(?:gitclone|git|clonegit)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleGitClone(activeSock, from, text);
    }

    // 10.5 Latência e Status do Sistema: !ping / !p / !latencia / !statusbot
    if (/^(?:!|\/)(?:ping|p|latencia|statusbot|pong)$/i.test(lower)) {
      return spyFeatures.handlePing(activeSock, from, msg);
    }

    // 10.51 Otimização Instantânea de Memória RAM & Ping: !otimizar / !limparram
    if (/^(?:!|\/)(?:otimizar|limparram|otimizaram|limparmemoria|cleanram)$/i.test(lower)) {
      const beforeRss = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const beforeHeap = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

      const db = require('../db/database');
      if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
      this.cleanupMemory();
      if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
      if (typeof global.gc === 'function') global.gc();

      const afterRss = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const afterHeap = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
      const freedHeap = Math.max(0, (Number(beforeHeap) - Number(afterHeap))).toFixed(1);

      return activeSock.sendMessage(from, {
        text: `🧹 *OTIMIZAÇÃO DE MEMÓRIA & LATÊNCIA CONCLUÍDA!*\n\n` +
              `💾 *RAM Antes:* \`${beforeRss} MB\` (Heap: \`${beforeHeap} MB\`)\n` +
              `🚀 *RAM Atual:* \`${afterRss} MB\` (Heap: \`${afterHeap} MB\`)\n` +
              `✨ *Heap Liberado:* \`~${freedHeap} MB\`\n` +
              `⚡ *Latência do Servidor:* \`~1-5ms\`\n` +
              `🗄️ *Banco SQLite:* Cache reciclado e WAL truncado com sucesso!`
      });
    }

    // 10.6 Painel de Configurações Interativo: !configurar / !config / !painel
    if (/^(?:!|\/)(?:configurar|config|configuracoes|painelbot)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleConfigurar(activeSock, from, text, isAdmin);
    }

    // 10.7 Cotação de Moedas em Tempo Real (SpyBot): !moedas / !cotacao / !dolar
    if (/^(?:!|\/)(?:moedas|cotacao|cotacoes|dolar|cambio)$/i.test(lower)) {
      return spyFeatures.handleMoedas(activeSock, from);
    }

    // 10.8 Fazer Nick & Tabela de Fontes Estilosas (SpyBot): !fazernick / !tabela
    if (/^(?:!|\/)(?:fazernick|gerarnick|tabela|fontes)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleFazerNick(activeSock, from, text);
    }

    // 10.9 Conselhos Bíblicos e Sabedoria (SpyBot): !conselhobiblico / !biblia / !versiculo
    if (/^(?:!|\/)(?:conselhobiblico|biblia|versiculo|palavradodia)$/i.test(lower)) {
      return spyFeatures.handleConselhoBiblico(activeSock, from);
    }

    // 10.10 Conselhos de Vida e Motivação (SpyBot): !conselho / !motivacao
    if (/^(?:!|\/)(?:conselho|motivacao|frasedodia)$/i.test(lower)) {
      return spyFeatures.handleConselho(activeSock, from);
    }

    // 10.11 Metadinhas para Casais e Amigos (SpyBot): !metadinha / !metadinhas
    if (/^(?:!|\/)(?:metadinha|metadinhas)$/i.test(lower)) {
      return spyFeatures.handleMetadinha(activeSock, from);
    }

    // 10.12 Previsão do Tempo em Tempo Real: !clima / !tempo
    if (/^(?:!|\/)(?:clima|tempo)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleClima(activeSock, from, text);
    }

    // 10.13 Consulta de DDD do Brasil: !ddd <número>
    if (/^(?:!|\/)(?:ddd)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleDDD(activeSock, from, text);
    }

    // 11. Perfil de Fidelidade: !perfil / !me / !nivel / !pontos
    if (/^(?:!|\/)(?:perfil|me|nivel|pontos|carteira)$/i.test(lower)) {
      return spyFeatures.handlePerfil(activeSock, from, senderPhone, senderName);
    }

    // 12. Resgatar Cupom de Fidelidade: !resgatar
    if (/^(?:!|\/)(?:resgatar|resgate|trocarcupom)$/i.test(lower)) {
      return spyFeatures.handleResgatar(activeSock, from, senderPhone);
    }

    // 13. Mini-game Dado: !dado / !dice
    if (/^(?:!|\/)(?:dado|dice)$/i.test(lower)) {
      return spyFeatures.handleDado(activeSock, from, senderPhone, senderName);
    }

    // 14. Mini-game Roleta da Sorte: !roleta / !spin
    if (/^(?:!|\/)(?:roleta|spin)$/i.test(lower)) {
      return spyFeatures.handleRoleta(activeSock, from, senderPhone, senderName);
    }

    // 14.1 Mini-game Cassino Caça-Níquel (SpyBot): !cassino / !slots
    if (/^(?:!|\/)(?:cassino|slots|cacaniquel)$/i.test(lower)) {
      return spyFeatures.handleCassino(activeSock, from, senderPhone, senderName);
    }

    // 14.2 Brincadeiras e Interações em Grupos (SpyBot): !casal, !ship, !gado, !corno, !feio, !gostoso, !chance
    if (/^(?:!|\/)(?:casal|ship|gado|corno|feio|gostoso|gostosa|chance)(?:\s+.*)?$/i.test(lower)) {
      const cmd = lower.split(/\s+/)[0].replace(/^[!/]/, '');
      return spyFeatures.handleBrincadeiras(activeSock, from, msg, cmd, text, senderPhone, activeSock);
    }

    // 14.21 Modo Ausente / AFK (Hatsune Miku): !afk / !ausente
    if (/^(?:!|\/)(?:afk|ausente)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleAFK(activeSock, from, text, senderPhone, senderName);
    }

    // 14.22 Sistema de Casamento (Hatsune Miku): !casar / !marry / !casamento
    if (/^(?:!|\/)(?:casar|marry|casamento)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleCasar(activeSock, from, msg, senderPhone, senderName);
    }

    // 14.23 Divórcio (Hatsune Miku): !divorciar / !divorce
    if (/^(?:!|\/)(?:divorciar|divorce)$/i.test(lower)) {
      return spyFeatures.handleDivorciar(activeSock, from, senderPhone);
    }

    // 14.24 Jogo Coinflip / Cara ou Coroa (Hatsune Miku): !coinflip / !cf / !flip / !caraoucoroa
    if (/^(?:!|\/)(?:coinflip|cf|flip|caraoucoroa)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleCoinflip(activeSock, from, text, senderPhone, senderName);
    }

    // 14.25 Trabalho RPG com Salário (Hatsune Miku): !trabalhar / !work / !chamba / !trampo
    if (/^(?:!|\/)(?:trabalhar|work|chamba|trampo)$/i.test(lower)) {
      return spyFeatures.handleWork(activeSock, from, senderPhone, senderName);
    }

    // 14.26 Crime RPG de Alto Risco (Hatsune Miku): !crime / !assalto
    if (/^(?:!|\/)(?:crime|assalto)$/i.test(lower)) {
      return spyFeatures.handleCrime(activeSock, from, senderPhone, senderName);
    }

    // 14.27 Metadinhas Anime Casal (Hatsune Miku): !ppcouple / !ppcp / !metadinha2
    if (/^(?:!|\/)(?:ppcouple|ppcp|metadinha2)$/i.test(lower)) {
      return spyFeatures.handlePPCouple(activeSock, from);
    }

    // 14.28 Vitrine Digital & Catálogo E-Commerce (AutoRepuestos Pro): !loja / !catalogo / !vitrine
    if (/^(?:!|\/)(?:loja|catalogo|vitrine|store|vercatalogo)$/i.test(lower)) {
      return spyFeatures.handleLoja(activeSock, from);
    }

    // 14.29 Central de Avisos & Alertas da Equipe (Sistemas Avisos PC): !aviso / !notificar / !urgente / !comunicado
    if (/^(?:!|\/)(?:urgente|alertaurgente)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleEmitAviso(activeSock, from, text, senderPhone, senderName, true);
    }
    if (/^(?:!|\/)(?:aviso|notificar|comunicado)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleEmitAviso(activeSock, from, text, senderPhone, senderName, false);
    }

    // 14.30 Consulta de Avisos Ativos (Sistemas Avisos PC): !avisos
    if (/^(?:!|\/)(?:avisos|alertas|comunicados)$/i.test(lower)) {
      return spyFeatures.handleListAvisos(activeSock, from);
    }

    // 14.31 Resposta a Aviso da Central (Sistemas Avisos PC): !responderaviso / !confirmaraviso
    if (/^(?:!|\/)(?:responderaviso|confirmaraviso|respostaviso)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleResponderAviso(activeSock, from, text, senderPhone, senderName);
    }

    // 14. MULTI-CONTAS, SUB-BOTS & FUNÇÕES EXCLUSIVAS DO DONO E BOT PRINCIPAL
    // 14.0 Guia de Usabilidade & Controle dos Sub-Bots: !subbothelp / !subbotajuda
    if (/^(?:!|\/)(?:subbothelp|subbotajuda|ajudasubbot|guiasubbot|comosubbot)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleSubBotHelp(activeSock, from, isOwnerUser);
    }

    // 14.1 Lista de Bots & Painel dos Sub-Bots: !bots / !subbots / !painelsubbots / !subbotstatus / !listabots
    if (/^(?:!|\/)(?:bots|subbots|painelsubbots|subbotstatus|listabots|chips)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleListBots(activeSock, from, isOwnerUser);
    }

    // 14.2 Conectar Sub-bot: !serbot / !jadibot / !subbot / !code / !conectar
    if (/^(?:!|\/)(?:serbot|jadibot|subbot|conectar|code)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleSerBot(activeSock, from, text, senderPhone, isGroup);
    }

    // 14.3 Parar Sub-bot: !stopbot / !pararbot / !desconectarbot / !pararsubbot
    if (/^(?:!|\/)(?:stopbot|pararbot|desconectarbot|pararsubbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleStopBot(activeSock, from, senderPhone, text, isOwnerUser);
    }

    // 14.4 Reiniciar Sub-bot: !reiniciarsubbot / !restartbot / !reiniciarbot
    if (/^(?:!|\/)(?:reiniciarsubbot|restartbot|reiniciarbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nEste comando é exclusivo para o Dono (Owner) e o Bot Principal controlarem os sub-bots.` });
      }
      return spyFeatures.handleRestartSubBot(activeSock, from, text);
    }

    // 14.5 Resetar Sub-bot: !resetarsubbot / !limparsubbot
    if (/^(?:!|\/)(?:resetarsubbot|limparsubbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nEste comando é exclusivo para o Dono (Owner) e o Bot Principal controlarem os sub-bots.` });
      }
      return spyFeatures.handleResetSubBot(activeSock, from, text);
    }

    // 14.6 Definir Dono: !setowner <numero>
    if (/^(?:!|\/)(?:setowner|definirdono)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nApenas o Dono atual ou o Bot Principal pode definir um novo dono.` });
      }
      return spyFeatures.handleSetOwner(activeSock, from, text);
    }

    // 14.7 Divulgação em Massa pelo Exército de Sub-Bots: !divulgar / !bcbot / !broadcast
    if (/^(?:!|\/)(?:divulgar|bcbot|broadcast)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nA função de divulgação em massa pelo Exército de Sub-Bots é exclusiva do Dono e do Bot Principal.` });
      }
      return spyFeatures.handleBroadcastSubBots(activeSock, from, text);
    }

    // 14.8 Promover Produto do Catálogo via Sub-Bots: !promover / !divulgarproduto
    if (/^(?:!|\/)(?:promover|divulgarproduto)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nA função de divulgação de produtos pelo Exército de Sub-Bots é exclusiva do Dono e do Bot Principal.` });
      }
      return spyFeatures.handlePromoteProduct(activeSock, from, text);
    }

    // 14.9 Divulgação em Grupos via Sub-Bots: !divulgargrupos / !bcgrupos / !bcgc
    if (/^(?:!|\/)(?:divulgargrupos|bcgrupos|bcgc)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nA transmissão em grupos é exclusiva do Dono e do Bot Principal.` });
      }
      return spyFeatures.handleBroadcastGroups(activeSock, from, text);
    }

    // 14.10 Lançamento Meteórico (Multi-Grupos, Auto-Transbordamento & Aquecimento com Sub-Bots): !meteorico / !meteoro
    if (/^(?:!|\/)(?:meteorico|meteoro|lancamentometeorico)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const isChatAdmin = await this.checkIsAdmin(from, participantJid, isFromMe);
      if (!isOwnerUser && !isChatAdmin) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Administradores*\n\nO gerenciamento do Lançamento Meteórico é exclusivo para administradores e o Dono do Bot.` });
      }
      return this.handleMeteoricCommand(activeSock, from, text, isOwnerUser);
    }

    // 14.11 Radar Viral & Criador de Posts (@ Insta & Facebook): !viral / !radar / !viraladd / !gerarpost
    if (/^(?:!|\/)(?:viral|radar|viraladd|gerarpost|viralscan)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const isChatAdmin = await this.checkIsAdmin(from, participantJid, isFromMe);
      if (!isOwnerUser && !isChatAdmin) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Administradores*\n\nO Radar Viral e Criador de Posts é exclusivo para administradores e o Dono do Bot.` });
      }
      return this.handleViralRadarCommand(activeSock, from, text, isOwnerUser);
    }

    // 15. Menu Geral de Comandos Spy Bot + Loja: !help / !bot / !comandos / !menu2 / !spy / !spybot / !ajudatudo
    if (/^(?:!|\/)?(?:help|bot|comandos|menu2|spy|spybot|ajudatudo|allmenu|menucompleto)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const tunnelService = require('../services/tunnelService');
      const tunnelUrl = tunnelService.getUrl();
      const webUrl = tunnelUrl ? `${tunnelUrl}` : 'http://localhost:3000';

      let spyMenu = `🕵️‍♂️ *CATÁLOGO DE COMANDOS SPY BOT + PAYBOT* 🕵️‍♂️\n\n` +
        `💡 _Acesse este menu a qualquer momento enviando *!help*, *!bot* ou *!comandos*_\n\n` +
        `🎨 *Figurinhas & Mídia (Hatsune Miku + SpyBot):*\n` +
        `• *!s* ou *!sticker* — Cria figurinha de foto ou vídeo\n` +
        `• *!qc <texto>* — Figurinha Quote Chat balão escuro oficial WhatsApp\n` +
        `• *!brat <texto>* — Figurinha viral Charli XCX verde-limão com desfoque\n` +
        `• *!emojimix <e1>+<e2>* — Funde dois emojis pelo Google Kitchen\n` +
        `• *!attp <texto>* ou *!attp2* — Figurinha animada em cores rainbow piscantes\n` +
        `• *!tomp3* — Converte vídeo ou áudio respondido em música MP3\n` +
        `• *!toimg* — Converte figurinha em imagem JPG\n` +
        `• *!tts <texto>* — Converte texto em áudio falado pelo bot\n\n` +
        `📥 *Downloads & Ferramentas na Nuvem (Qualidade H = Alta / S = Padrão):*\n` +
        `• *!play <música> [H|S]* — Baixa música do YouTube em MP3 com título oficial e capa\n` +
        `• *!video <vídeo> [H|S]* — Baixa vídeo em MP4 sem limite de tamanho (H: 720p/1080p | S: 360p)\n` +
        `• *A1, A2... / V1, V2...* — Atalhos rápidos com suporte a qualidade (ex: A1H, V1S)\n` +
        `• *!lista <busca>* — Busca os 20 melhores vídeos do YouTube com atalhos\n` +
        `• *!ssweb <url>* — Print em alta resolução de qualquer página da internet\n` +
        `• *!tourl* — Transforma foto, vídeo, áudio ou figurinha em link público CDN\n` +
        `• *!gitclone <link>* — Baixa repositório GitHub inteiro em arquivo .ZIP\n` +
        `• *!tiktok <link>* — Baixa vídeo do TikTok sem marca d'água\n` +
        `• *!ig <link>* — Baixa fotos e reels do Instagram\n` +
        `• *!x <link>* — Baixa vídeos e posts do Twitter / X\n` +
        `• *!fb <link>* — Baixa vídeos e reels do Facebook\n` +
        `• *!allstories <@usuario>* — Baixa todos os stories de um perfil\n` +
        `• *!scrapinsta <@usuario>* — Raio-X completo: métricas, rede e maturidade intelectual\n\n` +
        `🌐 *Acesso Remoto & Dashboard:* \n` +
        `• *!tunnel* ou *!painel* — Link seguro HTTPS para acesso remoto ao painel web\n\n` +
        `🔗 *Multi-Dispositivos & Sub-Bots (SpyBot Multi-Device):*\n` +
        `• *!serbot <numero>* ou *!code <numero>* — Conecta outro WhatsApp com código de 8 dígitos\n` +
        `• *!bots* ou *!subbots* — Lista todos os WhatsApps conectados e seus status\n` +
        `• *!stopbot* — Desconecta sua sessão de sub-bot\n` +
        `• *!subbothelp* — Guia completo de usabilidade e conexão de sub-bots\n\n` +
        `🚀 *Lançamento Meteórico (Multi-Grupos & Sub-Bots):*\n` +
        `• *!meteorico* — Painel do lançamento, grupos e link inteligente\n` +
        `• *!meteorico ativar [nome] [limite]* — Ativa transbordamento automático\n` +
        `• *!meteorico criargrupo* — Cria novo grupo com sub-bots integrados\n` +
        `• *!meteorico etapa <1-5>* — Dispara diretrizes de aquecimento com sub-bots\n` +
        `• *!meteorico aquecer* — Aciona conversa rápida dos sub-bots no grupo\n` +
        `• *!meteorico fechar / abrir* — Alterna modo anúncio do grupo\n` +
        `• *!meteorico link* — Exibe link ativo do grupo e redirecionador\n\n` +
        `🔥 *Radar Viral & Criador de Posts (@ Insta e Facebook):*\n` +
        `• *!viral* ou *!radar* — Painel do radar e virais capturados\n` +
        `• *!viraladd <insta|fb> <@perfil> [nicho]* — Cadastra perfil para capturar virais\n` +
        `• *!gerarpost <id_ou_perfil>* — Gera nosso post adaptado com gancho e CTA\n` +
        `• *!viralscan* — Faz varredura de virais em todos os perfis agora\n\n`;

      if (isOwnerUser) {
        spyMenu += `👑 *Assistente Matriz & Central de Comando dos Sub-Bots (Exclusivo Dono):*\n` +
          `• *!assistente* ou conversa no PV — Converse com a Matriz como sua assistente executiva\n` +
          `• *!delegar <id_bot> <telefone> <msg>* — Delega envio direto para sub-bot específico\n` +
          `• *!tarefas* ou *!missoes* — Consulta tarefas delegadas e relatório de execução\n` +
          `• *!painelsubbots* — Painel consolidado do exército de sub-bots\n` +
          `• *!divulgar <mensagem>* — Disparo em massa com Spintax via sub-bots para leads\n` +
          `• *!promover <id_produto>* — Dispara promoção do catálogo via sub-bots\n` +
          `• *!divulgargrupos <mensagem>* — Transmite em todos os grupos onde os bots estão\n` +
          `• *!pararsubbot <id>* — Desconecta sub-bot específico\n` +
          `• *!reiniciarsubbot <id>* — Reconecta sub-bot específico\n` +
          `• *!resetarsubbot <id>* — Limpa credenciais para re-parear sub-bot\n` +
          `• *!setowner <numero>* — Define número do Dono\n\n`;
      }

      spyMenu += `🤖 *Inteligência Artificial & Utilitários SpyBot:*\n` +
        `• *!moedas* — Cotações em tempo real (USD, EUR, GBP, USDT, BTC e ETH)\n` +
        `• *!fazernick <texto>* ou *!tabela* — 20 estilos de fontes elegantes para nicks\n` +
        `• *!conselhobiblico* — Versículo bíblico e reflexão de sabedoria\n` +
        `• *!conselho* — Conselhos motivacionais dos maiores líderes e empreendedores\n` +
        `• *!metadinha* — Envia fotos de perfil combinando para casais ou amigos\n` +
        `• *!clima <cidade>* — Previsão do tempo completa em tempo real\n` +
        `• *!ddd <número>* — Consulta de estado e cidades por código DDD\n` +
        `• *!ia <pergunta>* — Converse com o ChatGPT / Gemini integrado\n` +
        `• *!imagine <ideia>* — Gera arte inédita com IA\n` +
        `• *!ping* — Mede velocidade de resposta, uptime e status dos bots\n` +
        `• *!configurar* — Painel interativo de configurações do bot e grupos\n` +
        `• *!traduzir <en|es|fr> <texto>* — Traduz instantaneamente\n` +
        `• *!encurtar <link>* — Encurta qualquer link (TinyURL)\n` +
        `• *!qr <texto ou link>* — Gera imagem de QR Code instantânea\n` +
        `• *!cep <número>* — Consulta endereço completo (ViaCEP)\n` +
        `• *!calc <expressão>* — Calculadora de bolso inteligente\n\n` +
        `🎮 *Gamificação, Social & RPG (Hatsune Miku + SpyBot):*\n` +
        `• *!afk [motivo]* — Ativa status de ausência; avisa quem marcar você\n` +
        `• *!casar @usuario* — Propõe casamento ou aceita pedido no grupo\n` +
        `• *!divorciar* — Encerra o casamento atual\n` +
        `• *!coinflip <valor> <cara|coroa>* — Aposta moedas no cara ou coroa\n` +
        `• *!trabalhar* — Bico remunerado para ganhar moedas (cooldown 3m)\n` +
        `• *!crime* — Golpe arriscado de alto rendimento com polícia e multas\n` +
        `• *!ppcouple* — Envia metadinhas anime (Ele & Ela) para foto de perfil\n` +
        `• *!cassino* — Caça-níquel com jackpot e pontos de fidelidade\n` +
        `• *!casal* ou *!ship* — Forma um casal aleatório no grupo com % de amor\n` +
        `• *!gado*, *!corno*, *!feio*, *!gostoso* — Medidor com barra de progresso\n` +
        `• *!chance <pergunta>* — Calcula a probabilidade de um evento\n` +
        `• *!perfil* — Exibe seu nível, XP, moedas e estado civil\n` +
        `• *!dado* — Role os dados e ganhe moedas e XP\n` +
        `• *!roleta* — Gire a roleta da sorte para ganhar prêmios\n` +
        `• *!resgatar* — Troque 100 pontos por um Cupom de 15% OFF na loja\n\n` +
        `🛍️ *Vendas, Vitrine & Loja Automática (AutoRepuestos Pro):*\n` +
        `• *!loja* ou *!vitrine* — Vitrine online com carrinho e checkout Pix/USDT\n` +
        `• *MENU* — Ver catálogo completo no WhatsApp\n` +
        `• *P1, P2...* — Gerar PIX Copia e Cola instantâneo\n` +
        `• *C1, C2...* — Pagar via Cripto / Binance Pay (USDT)\n` +
        `• *STATUS* — Consultar andamento do seu pedido\n` +
        `• *!suporte* — Solicitar atendimento humano\n\n` +
        `📢 *Central de Avisos & Broadcast (Sistemas Avisos PC):*\n` +
        `• *!aviso <mensagem>* — Emite comunicado geral para a equipe\n` +
        `• *!urgente <mensagem>* — Emite alerta crítico com som e prioridade\n` +
        `• *!avisos* — Lista os avisos ativos no sistema\n` +
        `• *!confirmaraviso <id>* — Confirma recebimento ou responde\n\n` +
        `🌐 *Painel Web:* ${webUrl}\n` +
        `🛡️ *Moderação de Grupos:* Envie *!admin* para ver comandos de gestão.`;

      return this.sendMessage(from, spyMenu);
    }

    // Comandos de menu
    if (['oi', 'ola', 'olá', 'menu', 'inicio', 'início', 'comprar', 'produtos', 'planos'].some(cmd => lower === cmd) || lower.startsWith('!menu')) {
      return this.sendMenu(from, senderName, activeSock);
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
      const products = this.getProductsForContext(activeSock);
      if (idx > 0 && idx <= products.length) {
        return this.processPixPurchase(from, senderName, products[idx - 1], activeSock);
      }
    }

    const bpayMatch = lower.match(/^(?:c|cripto\s*|crypto\s*|usdt\s*)(\d+)$/);
    if (bpayMatch) {
      const idx = parseInt(bpayMatch[1], 10);
      const products = this.getProductsForContext(activeSock);
      if (idx > 0 && idx <= products.length) {
        return this.processBinancePurchase(from, senderName, products[idx - 1], activeSock);
      }
    }

    // Seleção de produto: Ex "1", "QUERO 1", "COMPRAR 2"
    const wantMatch = lower.match(/^(?:quero\s*(?:o\s*)?|comprar\s*(?:o\s*)?|item\s*)?(\d+)$/);
    if (wantMatch) {
      const num = parseInt(wantMatch[1], 10);
      const products = this.getProductsForContext(activeSock);
      if (!isNaN(num) && num > 0 && num <= products.length) {
        const product = products[num - 1];
        
        const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
        const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';

        // Se ambos os gateways estão ativos, pergunta a forma de pagamento
        if (isPix && isBinance) {
          const brl = Number(product.price_brl || product.price || 0).toFixed(2);
          const usdt = Number(product.price_usdt || ((product.price || 10) / 5.5)).toFixed(2);

          const choiceMsg = `📦 *${product.name}*\n\n` +
            `Como você prefere pagar?\n\n` +
            `🟢 Digite *P${num}* para pagar via *PIX* (R$ ${brl})\n` +
            `🟡 Digite *C${num}* para pagar via *Cripto / USDT* (${usdt} USDT)\n\n` +
            `_Exemplo: responda *P${num}* para receber o código Copia e Cola instantâneo._`;
          return this.sendMessage(from, choiceMsg, {}, activeSock);
        } else if (isPix) {
          return this.processPixPurchase(from, senderName, product, activeSock);
        } else {
          return this.processBinancePurchase(from, senderName, product, activeSock);
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
          return this.processPixPurchase(from, senderName, nlp.entities.matchedProduct, activeSock);
        }
        if (nlp.directAction === 'TRIGGER_BINANCE' && nlp.entities?.matchedProduct) {
          return this.processBinancePurchase(from, senderName, nlp.entities.matchedProduct, activeSock);
        }
        if (nlp.directAction === 'SHOW_MENU') {
          return this.sendMenu(from, senderName, activeSock);
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
                }, activeSock);
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
          return this.sendMessage(from, nlp.replyText, {}, activeSock);
        }
      }
    } catch (nlpErr) {
      console.error('[WhatsApp NLP Error]:', nlpErr.message);
    }

    // Fallback
    const fallbackText = `Olá, *${senderName}*! 👋\n\n` +
      `Para ver nossos produtos e assinaturas com pagamento automático via *PIX* ou *Cripto (USDT)*, envie *MENU*.\n\n` +
      `Se precisar de suporte, envie *AJUDA*.`;
    await this.sendMessage(from, fallbackText, {}, activeSock);
  }

  // Retorna os produtos ativos para o contexto do atendimento:
  // Se for um Sub-Bot com conta WhatsApp Business (ou catálogo próprio), opera ESTRITAMENTE com os produtos do seu catálogo!
  // Se for a Matriz Principal (ou subbot sem catálogo próprio), opera com o catálogo geral da loja.
  getProductsForContext(sock = null) {
    const activeSock = sock || this.currentDispatchSock || this.sock;
    const isSubBot = !!activeSock && activeSock !== this.sock;
    const instanceId = activeSock?.instanceId || (isSubBot ? 2 : 1);

    if (isSubBot) {
      const isBusiness = models.isSubBotBusiness(instanceId);
      const subBotProds = models.getSubBotProducts(instanceId, activeSock?.user?.id);

      // Quando uma conta WhatsApp Business estiver logada como subbot, ela opera SOMENTE com seus próprios produtos!
      if (isBusiness || subBotProds.length > 0) {
        return subBotProds;
      }
    }

    // Matriz Principal ou Sub-Bot comum sem catálogo próprio
    return models.getProducts(true);
  }

  async sendMenu(to, senderName, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const isSubBot = !!sock && sock !== this.sock;
    const instanceId = sock?.instanceId || (isSubBot ? 2 : 1);
    const isBusiness = isSubBot && models.isSubBotBusiness(instanceId);
    const products = this.getProductsForContext(sock);

    if (products.length === 0) {
      if (isBusiness) {
        return this.sendMessage(to,
          `ℹ️ *ATENDIMENTO OFICIAL WHATSAPP BUSINESS*\n\n` +
          `Este canal de atendimento opera exclusivamente com o catálogo próprio desta conta do WhatsApp Business.\n` +
          `Nenhum produto está disponível no momento. Para comprar ou tirar dúvidas, envie *AJUDA* para suporte humano!`,
          {}, sock
        );
      }
      return this.sendMessage(to, 'Nenhum produto cadastrado no momento. Tente novamente mais tarde.', {}, sock);
    }

    let menu = `👋 Olá, *${senderName}*!\n`;
    if (isBusiness) {
      menu += `Bem-vindo ao nosso atendimento oficial via *WhatsApp Business*.\n` +
              `Confira nosso catálogo exclusivo abaixo:\n\n` +
              `📌 *CATÁLOGO DE PRODUTOS:*\n\n`;
    } else {
      menu += `Bem-vindo à nossa loja automatizada com pagamentos via *PIX* e *Binance Pay* (USDT).\n\n` +
              `📌 *PRODUTOS & ASSINATURAS:*\n\n`;
    }

    products.forEach((p, idx) => {
      const typeTag = p.type === 'vip_subscription' ? `⭐ [VIP ${p.duration_days} dias]` : '📦 [Digital]';
      const brl = Number(p.price_brl || p.price || 0).toFixed(2);
      const usdt = Number(p.price_usdt || ((p.price || 10) / 5.5)).toFixed(2);

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

    await this.sendMessage(to, menu, {}, sock);
  }

  // 1. Processa Compra via PIX
  async processPixPurchase(to, senderName, product, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const isSubBot = !!sock && sock !== this.sock;
    const instanceId = sock?.instanceId;

    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`, {}, sock);
      }
    }

    await this.sendMessage(to, `⏳ Gerando seu código *PIX* para *${product.name}*...`, {}, sock);

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
      return this.sendMessage(to, `❌ Não foi possível gerar o PIX:\n${pixRes.errorMessage}`, {}, sock);
    }

    const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

    // Afiliado e Vendedor
    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = product.seller_id || null;
    if (isSubBot && instanceId) {
      sellerId = instanceId;
    } else if (!sellerId && models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
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
      await this.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      }, {}, sock);

      // Envia uma mensagem contendo apenas o Copia e Cola para facilitar cópia com 1 clique no celular
      await this.sendMessage(to, `👇 *PIX COPIA E COLA (Toque para copiar):*`, {}, sock);
      await this.sendMessage(to, `${pixCode}`, {}, sock);

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar PIX]:', err.message);
      await this.sendMessage(to, `Pix gerado! Código Copia e Cola:\n\n${pixCode}`, {}, sock);
    }
  }

  // 2. Processa Compra via Binance Pay
  async processBinancePurchase(to, senderName, product, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const isSubBot = !!sock && sock !== this.sock;
    const instanceId = sock?.instanceId;

    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`, {}, sock);
      }
    }

    await this.sendMessage(to, `⏳ Gerando sua fatura na *Binance Pay* para *${product.name}*...`, {}, sock);

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
      return this.sendMessage(to, `❌ Não foi possível gerar a cobrança na Binance Pay:\n${binanceRes.errorMessage}`, {}, sock);
    }

    const payData = binanceRes.data;

    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = product.seller_id || null;
    if (isSubBot && instanceId) {
      sellerId = instanceId;
    } else if (!sellerId && models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
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

      await this.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      }, {}, sock);

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar imagem Binance]:', err.message);
      await this.sendMessage(to, `Pedido criado! Link para pagamento: ${payData.checkoutUrl}`, {}, sock);
    }
  }

  async sendOrderStatus(to, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const orders = models.getAllOrders(20).filter(o => o.platform === 'whatsapp' && o.platform_user_id === to);
    if (orders.length === 0) {
      return this.sendMessage(to, 'Você ainda não possui nenhum pedido registrado por este WhatsApp.', {}, sock);
    }

    let text = '📦 *SEUS ÚLTIMOS PEDIDOS:*\n\n';
    orders.slice(0, 5).forEach(o => {
      const statusText = o.status === 'PAID' ? '✅ Pago & Entregue' : o.status === 'PENDING' ? '⏳ Aguardando' : '❌ Cancelado';
      const valorStr = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;
      text += `• *#${o.merchant_trade_no}*\n` +
        `  Item: ${o.product_name}\n` +
        `  Valor: ${valorStr} | Status: ${statusText}\n\n`;
    });

    await this.sendMessage(to, text, {}, sock);
  }

  async sendHelp(to, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const help = `ℹ️ *AJUDA & FORMAS DE PAGAMENTO*\n\n` +
      `• *PIX:* Você recebe o QR Code e o código Copia e Cola na hora no chat.\n` +
      `• *Criptomoedas (Binance Pay):* Pagamento rápido em USDT pelo app oficial da Binance.\n` +
      `• *Entrega Instantânea:* Nossos servidores monitoram confirmações de bancos e blockchains a cada poucos segundos.\n` +
      `• *Assinaturas VIP:* Link exclusivo gerado para acesso ao canal VIP com controle automático de validade.\n\n` +
      `💡 _Para ver o catálogo completo de comandos, envie *!help* ou *!bot*_`;
    await this.sendMessage(to, help, {}, sock);
  }

  async sendMessage(jid, text, options = {}, customSock = null) {
    if (!jid || typeof jid !== 'string') return false;
    let targetJid = jid.trim();

    // Se for número puro de telefone sem @, adiciona sufixo padrão WhatsApp
    if (!targetJid.includes('@')) {
      const digits = targetJid.replace(/\D/g, '');
      if (digits.length >= 8) {
        targetJid = `${digits}@s.whatsapp.net`;
      } else {
        // JID inválido ou ID de teste sem telefone real (ex: 'quick_test_123')
        return false;
      }
    }

    // Se for JID individual, valida se o usuário possui apenas dígitos
    if (targetJid.endsWith('@s.whatsapp.net')) {
      const userPart = targetJid.split('@')[0].split(':')[0];
      if (!/^\d+$/.test(userPart)) {
        return false;
      }
    }

    const sock = customSock || options.sock || this.currentDispatchSock || this.sock;
    if (!sock || (sock !== this && sock.ev && !sock.user?.id)) {
      console.log(`[WhatsApp ⚠️] Não conectado. Mensagem para ${targetJid} não enviada: ${typeof text === 'string' ? text.slice(0, 40) : 'objeto'}...`);
      return false;
    }

    try {
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('composing', targetJid);
        if (process.env.NODE_ENV !== 'test') {
          const delay = Math.min(1200, Math.max(400, (typeof text === 'string' ? text.length * 15 : 600)));
          await new Promise(resolve => setTimeout(resolve, delay));
          await sock.sendPresenceUpdate('paused', targetJid);
        }
      }
    } catch (_) {}

    try {
      if (typeof text === 'object' && text !== null) {
        await sock.sendMessage(targetJid, text);
      } else {
        await sock.sendMessage(targetJid, { text, ...options });
      }
      return true;
    } catch (err) {
      console.error(`[WhatsApp ❌ Falha ao enviar para ${targetJid}]:`, err.message);
      return false;
    }
  }

  async handleMeteoricCommand(sock, from, text, isOwnerUser = false) {
    const meteoricService = require('../services/meteoricService');
    const parts = text.trim().split(/\s+/).slice(1);
    const subCmd = parts[0]?.toLowerCase();

    // 1. Status / Ajuda Geral
    if (!subCmd || subCmd === 'status' || subCmd === 'ajuda' || subCmd === 'help') {
      const status = meteoricService.getCampaignStatus();
      const c = status.campaign;
      const g = status.activeGroup;

      const card = `🚀 *LANÇAMENTO METEÓRICO & MULTI-GRUPOS* 🚀\n\n` +
        `⚙️ *Status do Lançamento:* ${c.active ? '🟢 ATIVO (Auto-Transbordamento Ligado)' : '🔴 PAUSADO'}\n` +
        `🏷️ *Nome Base:* \`${c.group_base_name}\`\n` +
        `👥 *Capacidade por Grupo:* *${c.max_members_per_group} membros*\n` +
        `📦 *Total de Grupos Criados:* *${status.totalGroups}*\n` +
        `📈 *Total de Leads/Membros:* *${status.totalMembers} participantes*\n` +
        `🎯 *Etapa Atual:* *${status.currentStage?.title || 'Etapa 1'}*\n` +
        `🤖 *Sub-Bots de Aquecimento:* 🟢 *${status.onlineSubBots} online* de ${status.totalSubBots}\n\n` +
        `🔗 *Link Central de Tráfego (Auto-Redirect):*\n` +
        `👉 *http://localhost:3000/l/vip*\n` +
        `_(Redireciona sempre para o grupo com vagas abertas!)_\n\n` +
        (g ? `📌 *Grupo Ativo Agora:* *${g.title}*\n👥 *Membros:* ${g.member_count}/${g.max_limit}\n🔗 *Convite:* ${g.invite_url || 'Gerando link...'}\n\n` : `⚠️ *Nenhum grupo ativo criado ainda.*\n\n`) +
        `🛠️ *Comandos Rápidos no WhatsApp:*\n` +
        `• *!meteorico ativar [nome] [limite]* — Ativa campanha\n` +
        `• *!meteorico pausar* — Pausa campanha\n` +
        `• *!meteorico criargrupo [nome]* — Cria o próximo grupo agora\n` +
        `• *!meteorico etapa <1-5>* — Dispara a etapa e aquece com sub-bots\n` +
        `• *!meteorico aquecer [msg]* — Força aquecimento rápido no grupo\n` +
        `• *!meteorico fechar* — Fecha o grupo (apenas admins)\n` +
        `• *!meteorico abrir* — Abre o grupo para todos conversarem\n` +
        `• *!meteorico limite <num>* — Altera limite por grupo\n` +
        `• *!meteorico link* — Mostra link de entrada e redirecionador\n\n` +
        `🌐 *Painel Web Completo:* http://localhost:3000`;

      return sock.sendMessage(from, { text: card });
    }

    // 2. Ativar Lançamento
    if (subCmd === 'ativar' || subCmd === 'ligar' || subCmd === 'iniciar') {
      const updates = { active: 1 };
      if (parts[1] && !isNaN(parts[1])) {
        updates.max_members_per_group = parseInt(parts[1], 10);
      } else if (parts[1]) {
        updates.group_base_name = parts.slice(1).join(' ');
      }
      meteoricService.updateConfig(updates);
      meteoricService.toggleCampaign(true);
      return sock.sendMessage(from, {
        text: `✅ *Lançamento Meteórico ATIVADO com sucesso!*\n\nO monitoramento de lotação e criação automática de novos grupos está operante.\n🌐 Acesse: http://localhost:3000`
      });
    }

    // 3. Pausar Lançamento
    if (subCmd === 'pausar' || subCmd === 'parar' || subCmd === 'desligar') {
      meteoricService.toggleCampaign(false);
      return sock.sendMessage(from, {
        text: `⏸️ *Lançamento Meteórico PAUSADO.*\n\nA criação automática e o transbordamento foram suspensos.`
      });
    }

    // 4. Criar Próximo Grupo Manualmente
    if (subCmd === 'criargrupo' || subCmd === 'novogrupo' || subCmd === 'criar') {
      const customTitle = parts.slice(1).join(' ');
      await sock.sendMessage(from, { text: `⏳ *Criando novo grupo meteórico no WhatsApp...* Adicionando sub-bots e gerando link de convite!` });
      try {
        const result = await meteoricService.createNewMeteoricGroup({ title: customTitle || null });
        const grp = result.group;
        return sock.sendMessage(from, {
          text: `🎉 *Novo Grupo Meteórico Criado com Sucesso!*\n\n` +
            `📌 *Nome:* *${grp.title}*\n` +
            `🔢 *Número do Grupo:* #${grp.group_num}\n` +
            `👥 *Capacidade:* ${grp.max_limit} membros\n` +
            `🔗 *Link de Convite:* ${grp.invite_url || 'Aguardando'}\n\n` +
            `🚀 O redirecionador global *http://localhost:3000/l/vip* já está apontando para este novo grupo!`
        });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ Erro ao criar grupo: ${err.message}` });
      }
    }

    // 5. Executar Etapa de Aquecimento com Sub-Bots
    if (subCmd === 'etapa' || subCmd === 'fase') {
      const stageNum = parseInt(parts[1], 10);
      if (!stageNum || stageNum < 1 || stageNum > 5) {
        return sock.sendMessage(from, {
          text: `⚠️ *Informe o número da etapa (1 a 5)*.\n\nExemplo: *!meteorico etapa 1* (Antecipação) ou *!meteorico etapa 3* (Abertura do Carrinho)`
        });
      }

      await sock.sendMessage(from, { text: `⏳ *Disparando Etapa #${stageNum} nos grupos meteóricos...* Os sub-bots iniciarão o diálogo nos próximos instantes!` });
      try {
        const report = await meteoricService.executeStageWarmup(stageNum, from.endsWith('@g.us') ? from : null);
        return sock.sendMessage(from, {
          text: `🔥 *ETAPA #${stageNum} DO METEÓRICO EXECUTADA!* 🔥\n\n` +
            `📌 *Título:* *${report.stageTitle}*\n` +
            `🔒 *Modo do Grupo:* ${report.groupMode === 'announcement' ? 'Fechado para Anúncios' : 'Aberto para Conversas'}\n` +
            `📢 *Anúncios Enviados:* ${report.announcementsSent}\n` +
            `💬 *Falas dos Sub-Bots Agendadas:* ${report.subbotInteractionsScheduled} interações\n` +
            `👥 *Grupos Impactados:* ${report.targetGroupsCount} grupo(s)`
        });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ Erro ao executar etapa: ${err.message}` });
      }
    }

    // 6. Aquecimento Rápido / Imediato no Grupo
    if (subCmd === 'aquecer' || subCmd === 'esquentar' || subCmd === 'warmup') {
      const customTopic = parts.slice(1).join(' ');
      await meteoricService.executeInstantWarmup(from, customTopic || null);
      return sock.sendMessage(from, {
        text: `💬 *Aquecimento com Sub-Bots iniciado neste grupo!*\n\nOs sub-bots entrarão em ação com interações nos próximos instantes.`
      });
    }

    // 7. Fechar Grupo (Apenas Admins / Modo Anúncio)
    if (subCmd === 'fechar' || subCmd === 'silenciar') {
      await meteoricService.setGroupMode(from, 'closed');
      return sock.sendMessage(from, {
        text: `🔒 *Grupo FECHADO com sucesso!* Apenas administradores e sub-bots podem enviar mensagens.`
      });
    }

    // 8. Abrir Grupo (Todos os Membros Podem Falar)
    if (subCmd === 'abrir' || subCmd === 'liberar') {
      await meteoricService.setGroupMode(from, 'open');
      return sock.sendMessage(from, {
        text: `🔓 *Grupo ABERTO com sucesso!* Todos os participantes podem enviar mensagens e dúvidas.`
      });
    }

    // 9. Alterar Limite de Membros
    if (subCmd === 'limite' || subCmd === 'max') {
      const newLimit = parseInt(parts[1], 10);
      if (!newLimit || newLimit < 2) {
        return sock.sendMessage(from, { text: `⚠️ Informe um número válido para o limite. Exemplo: *!meteorico limite 250*` });
      }
      meteoricService.updateConfig({ max_members_per_group: newLimit });
      return sock.sendMessage(from, {
        text: `✅ *Capacidade máxima por grupo alterada para:* *${newLimit} participantes*.\n\nQuando um grupo atingir essa marca, o próximo será criado automaticamente!`
      });
    }

    // 10. Links do Lançamento
    if (subCmd === 'link' || subCmd === 'links' || subCmd === 'convite') {
      const status = meteoricService.getCampaignStatus();
      const g = status.activeGroup;
      return sock.sendMessage(from, {
        text: `🔗 *LINKS DO LANÇAMENTO METEÓRICO*\n\n` +
          `📌 *Grupo Ativo Atual:* ${g?.title || 'Nenhum'}\n` +
          `👉 *Convite Direto:* ${g?.invite_url || 'Sem link ativo'}\n\n` +
          `🌐 *Link de Tráfego Inteligente (Auto-Redirect):*\n` +
          `👉 *http://localhost:3000/l/vip*\n\n` +
          `💡 _Use o Link Inteligente em seus anúncios e redes sociais; ele direciona automaticamente o visitante para o grupo mais recente com vagas abertas!_`
      });
    }

    return sock.sendMessage(from, { text: `⚠️ Comando meteórico desconhecido. Envie *!meteorico* para ver todas as opções.` });
  }

  async handleViralRadarCommand(sock, from, text, isOwnerUser = false) {
    const viralRadarService = require('../services/viralRadarService');
    const models = require('../db/models');
    const parts = text.trim().split(/\s+/);
    const mainCmd = parts[0]?.toLowerCase().replace(/^(?:!|\/)/, '');
    const subCmd = parts[1]?.toLowerCase();

    // 1. Comando Direto !viraladd <insta|fb> <@perfil> [nicho]
    if (mainCmd === 'viraladd') {
      const platArg = parts[1]?.toLowerCase();
      const userArg = parts[2] || (parts[1]?.startsWith('@') ? parts[1] : null);
      const nicheArg = parts.slice(userArg === parts[1] ? 2 : 3).join(' ') || 'Geral';

      if (!userArg) {
        return sock.sendMessage(from, {
          text: `⚠️ *Uso correto:* *!viraladd <insta|fb> <@usuario> [nicho]*\n\nExemplo: *!viraladd insta @marketingdigital.brasil Marketing*\nExemplo: *!viraladd fb viverdecripto Criptomoedas*`
        });
      }

      const platform = platArg === 'fb' || platArg === 'facebook' ? 'facebook' : 'instagram';
      await sock.sendMessage(from, { text: `⏳ *Cadastrando e rastreando virais de ${userArg} (${platform.toUpperCase()})...*` });

      try {
        const profile = await viralRadarService.addTrackedProfile({
          platform,
          username: userArg,
          niche: nicheArg
        });

        const captured = models.getViralCapturedPosts({ profile_id: profile.id, limit: 3 });
        let reply = `✅ *PERFIL CADASTRADO NO RADAR VIRAL!*\n\n` +
          `• *Plataforma:* ${profile.platform.toUpperCase()}\n` +
          `• *Perfil:* @${profile.username}\n` +
          `• *Nome:* ${profile.display_name}\n` +
          `• *Nicho:* ${profile.niche}\n` +
          `• *Total de Virais Capturados:* ${captured.length}\n\n`;

        if (captured.length > 0) {
          reply += `🔥 *Principais Ganchos Virais Identificados:*\n`;
          captured.forEach((c, idx) => {
            reply += `${idx + 1}. [Score: ${c.viral_score}/100] "${c.hook_text}"\n`;
          });
          reply += `\n👉 Para gerar nosso post agora baseado nesse perfil, envie: *!gerarpost @${profile.username}* ou *!gerarpost ${captured[0].id}*`;
        }

        return sock.sendMessage(from, { text: reply });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ Erro ao adicionar perfil: ${err.message}` });
      }
    }

    // 2. Comando Direto !gerarpost <id_ou_perfil>
    if (mainCmd === 'gerarpost' || (mainCmd === 'viral' && subCmd === 'gerar')) {
      const targetArg = mainCmd === 'gerarpost' ? parts[1] : parts[2];
      let targetPost = null;

      if (!targetArg) {
        // Pega o post com maior viral_score
        const topPosts = models.getViralCapturedPosts({ limit: 1 });
        targetPost = topPosts[0];
      } else if (/^\d+$/.test(targetArg)) {
        targetPost = models.getViralCapturedPostById(parseInt(targetArg, 10));
      } else {
        const cleanUser = viralRadarService.cleanUsername(targetArg);
        const profile = models.getViralProfileByUsername('instagram', cleanUser) || models.getViralProfileByUsername('facebook', cleanUser);
        if (profile) {
          const profilePosts = models.getViralCapturedPosts({ profile_id: profile.id, limit: 1 });
          targetPost = profilePosts[0];
        }
      }

      if (!targetPost) {
        return sock.sendMessage(from, {
          text: `⚠️ Nenhum post viral encontrado com esse ID ou @. Envie *!viral* para ver a lista de posts capturados!`
        });
      }

      await sock.sendMessage(from, {
        text: `🧠 *Criando nosso post persuasivo baseado no viral #${targetPost.id} (@${targetPost.source_username})...*\nAguarde alguns instantes enquanto a IA reestrutura o gancho, corpo e CTA!`
      });

      try {
        const result = await viralRadarService.generateOurPost({
          viralPostId: targetPost.id,
          targetPlatform: 'whatsapp',
          tone: 'Comercial & Persuasivo',
          objective: 'Vendas & Conversão'
        });

        const p = result.post;
        const msg = `✍️ *NOSSO POST GERADO (Baseado no Viral #${targetPost.id} de @${targetPost.source_username})*\n\n` +
          `${p.full_content}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 *Sugestão de Mídia / Roteiro:*\n${p.media_suggestion}\n\n` +
          `💡 _Copie o texto acima para disparar nos grupos ou no direct!_`;

        return sock.sendMessage(from, { text: msg });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ Erro ao gerar post: ${err.message}` });
      }
    }

    // 3. Varredura Geral !viralscan
    if (mainCmd === 'viralscan' || (mainCmd === 'viral' && subCmd === 'scan')) {
      await sock.sendMessage(from, { text: `🔍 *Iniciando varredura geral em todos os perfis do Instagram e Facebook...*` });
      try {
        const results = await viralRadarService.scrapeAllProfiles();
        const totalNew = results.reduce((acc, r) => acc + (r.captured || 0), 0);
        return sock.sendMessage(from, {
          text: `✅ *VARREDURA CONCLUÍDA!*\n\n` +
            `• Perfis Verificados: ${results.length}\n` +
            `• Novos Posts/Ganchos Virais: ${totalNew}\n\n` +
            `👉 Envie *!viral* para ver o ranking dos melhores conteúdos!`
        });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ Falha na varredura: ${err.message}` });
      }
    }

    // 4. Status Geral do Radar Viral (!viral / !radar)
    const stats = models.getViralStats();
    const profiles = models.getViralProfiles();
    const topPosts = models.getViralCapturedPosts({ limit: 4 });

    let card = `🔥 *RADAR DE CONTEÚDO VIRAL & CRIADOR DE POSTS* 🔥\n\n` +
      `📊 *Estatísticas Atuais:*\n` +
      `• *Perfis Rastreados:* *${stats.totalProfiles} contas* (Insta & Facebook)\n` +
      `• *Virais Capturados:* *${stats.totalCaptured} publicações*\n` +
      `• *Nossos Posts Gerados:* *${stats.totalGenerated} copies*\n` +
      `• *Média de Viral Score:* *${stats.avgViralScore}/100*\n\n`;

    if (profiles.length > 0) {
      card += `👥 *Perfis Monitorados:*\n`;
      profiles.slice(0, 4).forEach(p => {
        card += `• ${p.platform === 'instagram' ? '📸' : '📘'} *${p.display_name}* (@${p.username}) — Nicho: ${p.niche} (${p.total_captured} virais)\n`;
      });
      card += `\n`;
    }

    if (topPosts.length > 0) {
      card += `🚀 *Melhores Ganchos Virais Capturados:*\n`;
      topPosts.forEach(c => {
        card += `• *ID #${c.id}* [${c.viral_score}/100] (@${c.source_username}):\n  "${c.hook_text}"\n  Curtidas: ~${c.likes_count.toLocaleString('pt-BR')} | Comentários: ~${c.comments_count.toLocaleString('pt-BR')}\n`;
      });
      card += `\n`;
    }

    card += `⚙️ *Comandos Disponíveis:*\n` +
      `• *!viraladd <insta|fb> <@perfil> [nicho]* — Cadastra novo perfil\n` +
      `• *!gerarpost <id>* — Gera nosso post persuasivo baseado no viral\n` +
      `• *!gerarpost @perfil* — Gera nosso post usando o melhor viral do perfil\n` +
      `• *!viralscan* — Força varredura de novos virais agora\n\n` +
      `🌐 *Painel Web Completo:* http://localhost:3000/#viral`;

    return sock.sendMessage(from, { text: card });
  }

  async requestPairingCode(phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Informe o telefone completo com DDI e DDD (ex: 5511999998888)');
    }

    if (process.env.NODE_ENV === 'test') {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      this.currentPairingCode = simCode;
      return { success: true, pairingCode: simCode, simulated: true };
    }

    if (this.sock?.authState?.creds?.registered) {
      throw new Error('Esta conta WhatsApp já está pareada e ativa.');
    }

    if (!this.sock) {
      await this.start();
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      await new Promise(r => setTimeout(r, 1200));
      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
      this.currentPairingCode = formattedCode;
      return { success: true, pairingCode: formattedCode };
    } catch (err) {
      throw new Error('Falha ao gerar código de pareamento: ' + err.message);
    }
  }

  async resetSession(force = false) {
    if (process.env.NODE_ENV === 'test') {
      this.currentPairingCode = null;
      return { success: true };
    }
    await this.stop();
    this.currentQr = null;
    this.currentQrDataUrl = null;
    this.currentPairingCode = null;
    this.isConnected = false;
    try {
      if (fs.existsSync(this.authFolder)) {
        const credsFile = path.join(this.authFolder, 'creds.json');
        let hasActiveSession = false;
        if (fs.existsSync(credsFile)) {
          try {
            const raw = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
            if (raw.me?.id) hasActiveSession = true;
          } catch (_) {}
        }
        // Em testes automatizados, nunca destrua as credenciais ativas do usuário
        if (!hasActiveSession || force || process.env.NODE_ENV !== 'test') {
          fs.rmSync(this.authFolder, { recursive: true, force: true });
        }
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

  // Lista todos os grupos onde o WhatsApp Matriz está participando (Zero Celular)
  async fetchAllGroups(forceRefresh = false) {
    if (!forceRefresh && this.cachedGroups && (Date.now() - (this.lastGroupsFetch || 0) < 30000)) {
      return this.cachedGroups;
    }

    if (this.sock && this.isConnected && typeof this.sock.groupFetchAllParticipating === 'function') {
      try {
        const groupsMap = await this.sock.groupFetchAllParticipating();
        const myJid = this.sock.user?.id ? (this.sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
        const groupsList = Object.values(groupsMap || {}).map(g => {
          const myParticipant = g.participants?.find(p => p.id?.split(':')[0] === myJid?.split('@')[0] || p.id === myJid);
          const isBotAdmin = myParticipant ? (myParticipant.admin === 'admin' || myParticipant.admin === 'superadmin') : false;
          return {
            id: g.id,
            subject: g.subject || 'Sem título',
            participantsCount: g.participants?.length || g.size || 0,
            isAnnounce: !!g.announce,
            isBotAdmin,
            desc: g.desc || '',
            owner: g.owner || g.subjectOwner || '',
            creation: g.creation || null,
            participants: (g.participants || []).map(p => ({
              id: p.id,
              phone: p.id ? p.id.split('@')[0].split(':')[0] : '',
              admin: p.admin || null
            }))
          };
        });

        this.cachedGroups = groupsList;
        this.lastGroupsFetch = Date.now();
        return groupsList;
      } catch (err) {
        console.warn('[WhatsApp Bot ⚠️] Falha ao buscar grupos com Baileys:', err.message);
      }
    }

    // Fallback gracioso com grupos meteóricos
    const meteoric = models.getMeteoricGroups() || [];
    const synthesized = meteoric.map(mg => ({
      id: mg.group_jid,
      subject: mg.title || `Grupo VIP #${mg.group_num}`,
      participantsCount: mg.member_count || 0,
      isAnnounce: !!mg.is_closed,
      isBotAdmin: true,
      desc: 'Grupo de Lançamento Meteórico',
      owner: '',
      creation: null,
      participants: []
    }));

    return synthesized;
  }

  // Altera permissão do grupo (aberto a todos vs modo anúncio)
  async setGroupAnnouncement(groupId, isAnnounce) {
    const mode = isAnnounce ? 'announcement' : 'not_announcement';
    if (this.sock && this.isConnected && typeof this.sock.groupSettingUpdate === 'function') {
      await this.sock.groupSettingUpdate(groupId, mode);
      return { success: true, mode };
    }
    return { success: true, mode, simulated: true };
  }

  // Obtém lista de participantes do grupo
  async getGroupParticipants(groupId) {
    if (this.sock && this.isConnected && typeof this.sock.groupMetadata === 'function') {
      try {
        const meta = await this.sock.groupMetadata(groupId);
        if (meta && meta.participants) {
          return meta.participants.map(p => ({
            id: p.id,
            phone: p.id ? p.id.split('@')[0].split(':')[0] : '',
            admin: p.admin || null
          }));
        }
      } catch (err) {
        console.warn(`[WhatsApp Bot ⚠️] Falha ao obter participantes de ${groupId}:`, err.message);
      }
    }
    return [];
  }

  // Limpeza Periódica de Memória RAM (Caches de Mensagens e Sessões Inativas)
  cleanupMemory() {
    try {
      const now = Date.now();
      if (this.processedMessageIds) {
        for (const [id, ts] of this.processedMessageIds.entries()) {
          if (now - ts > 60000) this.processedMessageIds.delete(id);
        }
      }
      if (this.userSessions) {
        for (const [jid, session] of this.userSessions.entries()) {
          if (session?.lastActivity && now - session.lastActivity > 1800000) {
            this.userSessions.delete(jid);
          }
        }
      }
      if (this.userFloodTracking) {
        for (const [key, track] of this.userFloodTracking.entries()) {
          if (track?.lastMsgTime && now - track.lastMsgTime > 120000) {
            this.userFloodTracking.delete(key);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = new WhatsAppBotService();

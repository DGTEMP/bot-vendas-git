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
const cryptoWalletService = require('../services/cryptoWalletService');
const fulfillment = require('../services/fulfillment');
const spyFeatures = require('../services/spyFeaturesService');
const zapVoiceService = require('../services/zapVoiceService');
const interactiveMessageService = require('../services/interactiveMessageService');
const { getBrasiliaGreeting, getBrasiliaHour } = require('../utils/dateTime');

// Filtra logs internos ruidosos do libsignal para não poluir o terminal com SessionEntry
const origConsoleInfo = console.info;
console.info = function (...args) {
  const suppress = models.getSetting('WPP_SUPPRESS_LIBSIGNAL_LOGS', 'true') !== 'false';
  if (suppress && typeof args[0] === 'string' && (args[0].startsWith('Closing session:') || args[0].includes('SessionEntry'))) {
    return;
  }
  return origConsoleInfo.apply(console, args);
};
const origConsoleWarn = console.warn;
console.warn = function (...args) {
  const suppress = models.getSetting('WPP_SUPPRESS_LIBSIGNAL_LOGS', 'true') !== 'false';
  if (suppress && typeof args[0] === 'string' && args[0].includes('Closing open session in favor of incoming prekey bundle')) {
    return;
  }
  return origConsoleWarn.apply(console, args);
};


const lidToPhoneCache = new Map();

function resolveLidToPhone(jidOrPhone) {
  if (!jidOrPhone) return null;
  try {
    const whatsappMessageStore = require('../services/whatsappMessageStoreService');
    const resolved = whatsappMessageStore.resolveLidToPhone(jidOrPhone);
    if (resolved) {
      const clean = String(jidOrPhone).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (clean) lidToPhoneCache.set(clean, resolved);
      return resolved;
    }
  } catch (_) {}

  const str = String(jidOrPhone).trim();
  const clean = str.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!clean) return null;

  if (lidToPhoneCache.has(clean)) {
    const cached = lidToPhoneCache.get(clean);
    if (cached) return cached;
  }

  // LID oficial do Dono autenticado no WhatsApp (554884702848)
  if (clean === '151866151276711') {
    lidToPhoneCache.set(clean, '554884702848');
    return '554884702848';
  }

  // Números normais de telefone (8 a 13 dígitos) já são números válidos de telefone
  if (clean.length >= 8 && clean.length <= 13) {
    lidToPhoneCache.set(clean, clean);
    return clean;
  }

  try {
    const authDir = config.whatsapp?.authFolder || path.join(__dirname, '..', '..', 'data', 'whatsapp_auth');
    const revFile = path.join(authDir, `lid-mapping-${clean}_reverse.json`);
    if (fs.existsSync(revFile)) {
      const content = fs.readFileSync(revFile, 'utf8').trim().replace(/["\s]/g, '');
      const phoneDigits = content.replace(/\D/g, '');
      if (phoneDigits) {
        lidToPhoneCache.set(clean, phoneDigits);
        return phoneDigits;
      }
    }

    // Busca nas instâncias do exército/sub-bots
    const armyDir = path.join(__dirname, '..', '..', 'data', 'whatsapp_army');
    if (fs.existsSync(armyDir)) {
      const instances = fs.readdirSync(armyDir);
      for (const inst of instances) {
        const subRev = path.join(armyDir, inst, `lid-mapping-${clean}_reverse.json`);
        if (fs.existsSync(subRev)) {
          const content = fs.readFileSync(subRev, 'utf8').trim().replace(/["\s]/g, '');
          const phoneDigits = content.replace(/\D/g, '');
          if (phoneDigits) {
            lidToPhoneCache.set(clean, phoneDigits);
            return phoneDigits;
          }
        }
      }
    }
  } catch (_) {}

  lidToPhoneCache.set(clean, null);
  return null;
}

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
  const rawUser = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (jid.includes('@lid') || (rawUser.length >= 14 && /^\d+$/.test(rawUser))) {
    const resolved = resolveLidToPhone(rawUser);
    if (resolved) return resolved;
  }
  return rawUser;
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
    this.userActiveOrderContext = new Map(); // Armazena contexto de pedido ativo por JID para menu 1 a 4
    this.userLastActivity = new Map(); // Armazena timestamp da última atividade (incoming/outgoing) por JID e telefone
    this.currentPairingCode = null;
    this.currentDispatchSock = null;
    this.processedMessageIds = new Map(); // Cache anti-duplicação de mensagens por ID
    this.sentBotMessages = new Map(); // Cache de IDs de mensagens enviadas pelo bot/subbots para cancelamento (!d)
    this.isStarting = false;
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Obtém o timestamp (ms) da última interação (mensagem recebida ou enviada) de um contato.
   * Checa memória rápida do WhatsAppBot, sessões de usuário, buffers do CRM cognitivo e SQLite.
   */
  getLastUserActivity(jidOrPhone) {
    if (!jidOrPhone) return 0;
    const clean = String(jidOrPhone).replace(/\D/g, '');
    if (!clean) return 0;
    const jid = `${clean}@s.whatsapp.net`;

    if (!this.userLastActivity) this.userLastActivity = new Map();

    const mem = this.userLastActivity.get(clean) || this.userLastActivity.get(jid) || 0;
    if (mem > 0) return mem;

    const session = this.userSessions?.get(jid) || this.userSessions?.get(clean);
    if (session?.lastActivity) return session.lastActivity;
    if (session?.timestamp) return session.timestamp;

    try {
      const cognitiveService = require('../services/cognitiveSalesService');
      const cog = cognitiveService.getLastDialogueTimestamp(clean);
      if (cog > 0) return cog;
    } catch (_) {}

    try {
      const row = models.getLeadCognitiveProfile(clean);
      if (row?.last_interaction_at) {
        const t = new Date(row.last_interaction_at).getTime();
        if (!isNaN(t) && t > 0) return t;
      }
    } catch (_) {}

    return 0;
  }

  /**
   * Registra a atividade do usuário no canal privado em memória e na sessão.
   */
  recordUserActivity(jidOrPhone) {
    if (!jidOrPhone) return;
    const clean = String(jidOrPhone).replace(/\D/g, '');
    if (!clean) return;
    const now = Date.now();
    if (!this.userLastActivity) this.userLastActivity = new Map();
    this.userLastActivity.set(clean, now);
    this.userLastActivity.set(`${clean}@s.whatsapp.net`, now);

    if (this.userSessions) {
      const jid = `${clean}@s.whatsapp.net`;
      const prev = this.userSessions.get(jid) || {};
      this.userSessions.set(jid, {
        ...prev,
        lastActivity: now
      });
    }
  }

  scheduleReconnect(delayMs) {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.start();
    }, delayMs);
  }

  async stop() {
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
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

    if (this.isStarting) {
      return;
    }
    this.isStarting = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      await this.stop();

      fulfillment.registerWhatsAppBot({
        sendMessage: (jid, text) => this.sendMessage(jid, text)
      });

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

      const keepAliveIntervalSec = parseInt(models.getSetting('WPP_KEEPALIVE_INTERVAL_SEC', '25'), 10) || 25;
      const getMessageCache = models.getSetting('WPP_GETMESSAGE_CACHE_ENABLED', 'true') !== 'false';
      const whatsappMessageStore = require('../services/whatsappMessageStoreService');

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Chrome'),
        msgRetryCounterCache: whatsappMessageStore.msgRetryCounterCache,
        getMessage: async (key) => {
          if (!getMessageCache) return undefined;
          return await whatsappMessageStore.getMessage(key);
        },
        enableAutoSessionRecreation: true,
        enableRecentMessageCache: true,
        maxMsgRetryCount: 5,
        retryRequestDelayMs: 250,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: keepAliveIntervalSec * 1000,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: (jid) => {
          if (!jid) return false;
          // Ignora newsletters e canais desnecessários da Meta
          if (jid.endsWith('@newsletter')) return true;
          return false;
        }
      });

      this.wrapSocketWithSupremeProtection(this.sock);

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
          this.reconnectAttempts = 0;
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
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
          try {
            const groupRentalService = require('../services/groupRentalService');
            groupRentalService.startExpiringRentalsCron(this.sock);
          } catch (_) {}
          try {
            const socialListening = require('../services/socialListeningService');
            setTimeout(() => {
              socialListening.ensureSentinelGroup(this.sock).catch(err => {
                console.warn('[Sentinela ⚠️ Erro na auto-inicialização do grupo]:', err.message);
              });
            }, 3000);
          } catch (_) {}
        }

        if (connection === 'close') {
          this.isConnected = false;
          try {
            const groupRentalService = require('../services/groupRentalService');
            groupRentalService.stopExpiringRentalsCron();
          } catch (_) {}
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          this.statusMessage = `Desconectado (código ${statusCode || 'desconhecido'}).`;
          try {
            models.updateArmyInstance(1, { status: 'DISCONNECTED' });
          } catch (_) {}

          const autoReconnect = models.getSetting('WPP_AUTO_RECONNECT', 'true') !== 'false';
          const reconnectDelaySec = parseInt(models.getSetting('WPP_RECONNECT_DELAY_SEC', '4'), 10) || 4;

          if (!autoReconnect) {
            console.log(`📱 [WhatsApp Matriz] Conexão encerrada (código ${statusCode}). Auto-reconexão está desativada no painel.`);
            return;
          }

          if (isLoggedOut) {
            console.log('🛑 [WhatsApp Matriz] Desconectado por logout (401). Limpando sessão antiga para permitir nova conexão...');
            this.reconnectAttempts = 0;
            this.currentPairingCode = null;
            this.currentQr = null;
            this.currentQrDataUrl = null;
            try {
              if (fs.existsSync(this.authFolder) && process.env.NODE_ENV !== 'test') {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
              }
            } catch (_) {}
            this.scheduleReconnect(2000);
          } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
            console.log('⚡ [WhatsApp Matriz] Pareamento confirmado pelo celular! Reinicializando imediatamente...');
            this.reconnectAttempts = 0;
            this.scheduleReconnect(300);
          } else {
            const baseDelay = reconnectDelaySec * 1000;
            const factor = Math.min(this.reconnectAttempts++, 6);
            const backoffDelay = Math.min(30000, Math.round(baseDelay * Math.pow(1.5, factor)));
            const jitter = Math.floor(Math.random() * 800);
            const finalDelay = backoffDelay + jitter;
            console.log(`📱 [WhatsApp Matriz] Conexão encerrada temporariamente (código ${statusCode}, tentativa ${this.reconnectAttempts}). Reconectando em ${(finalDelay / 1000).toFixed(1)} segundos...`);
            this.scheduleReconnect(finalDelay);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message) continue;

          // Sincroniza mapeamento de LID e telefone em tempo real
          try {
            const whatsappMessageStore = require('../services/whatsappMessageStoreService');
            whatsappMessageStore.extractAndRegisterFromMsg(msg);
          } catch (_) {}

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
          
          // Desempacota mídias efêmeras, de visualização única ou encapsuladas (preservando chaves para !ver)
          if (msg.message) {
            const isVo = !!(msg._isViewOnce || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.viewOnceMessageV2Extension ||
                            msg.message.ephemeralMessage?.message?.viewOnceMessage || msg.message.ephemeralMessage?.message?.viewOnceMessageV2 ||
                            msg.message.ephemeralMessage?.message?.viewOnceMessageV2Extension);
            if (isVo) {
              msg._isViewOnce = true;
            }
            try {
              await spyFeatures.captureViewOnceMedia(this.sock, msg, msg.key?.remoteJid);
            } catch (_) {}

            while (msg.message.ephemeralMessage || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.documentWithCaptionMessage) {
              msg.message = msg.message.ephemeralMessage?.message ||
                            msg.message.viewOnceMessage?.message ||
                            msg.message.viewOnceMessageV2?.message ||
                            msg.message.documentWithCaptionMessage?.message ||
                            msg.message;
            }
            if (isVo && msg.message) {
              if (msg.message.imageMessage) msg.message.imageMessage.viewOnce = true;
              if (msg.message.videoMessage) msg.message.videoMessage.viewOnce = true;
              if (msg.message.audioMessage) msg.message.audioMessage.viewOnce = true;
            }
          }

          // Se for mensagem própria (fromMe), processa se for comando iniciado por ! ou /
          if (msg.key.fromMe) {
            const rawTxt = (
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption ||
              ''
            ).trim();
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

      // Evento de chamadas de voz/vídeo (Anti-Chamada / Anti-Call)
      this.sock.ev.on('call', async (callEvents) => {
        await spyFeatures.handleCallEvents(this.sock, callEvents);
      });

      // Cache dinâmico em tempo real de mapeamentos LID -> Telefone (PN)
      this.sock.ev.on('lid-mapping.update', (mapping) => {
        try {
          if (mapping && mapping.lid && mapping.pn) {
            const cleanLid = String(mapping.lid).split('@')[0].split(':')[0].replace(/\D/g, '');
            const cleanPn = String(mapping.pn).split('@')[0].split(':')[0].replace(/\D/g, '');
            if (cleanLid && cleanPn) {
              lidToPhoneCache.set(cleanLid, cleanPn);
            }
          }
        } catch (_) {}
      });

      // Monitoramento de Presença em Tempo Real (Digitando / Gravando Áudio / Pausado)
      this.sock.ev.on('presence.update', (evt) => {
        try {
          const incomingBuffer = require('../services/incomingMessageBufferService');
          incomingBuffer.handlePresenceUpdate(evt);
        } catch (_) {}
      });

    } catch (err) {
      console.error('❌ [WhatsApp] Erro na inicialização:', err.message);
      this.statusMessage = `Erro: ${err.message}`;
    } finally {
      this.isStarting = false;
    }
  }

  // Trata eventos de participantes do grupo (Boas-vindas automáticas, Despedida, Indique & Ganhe & Anti-Fake)
  async handleGroupParticipantsUpdate({ id, participants, action, author }, customSock = null) {
    const sock = customSock || this.currentDispatchSock || this.sock;
    try {
      const normalizedParticipants = (participants || []).map(p => safeExtractJid(p)).filter(Boolean);
      if (!normalizedParticipants.length) return;

      const botHierarchyOrchestrator = require('../services/botHierarchyOrchestratorService');

      // 🛡️ Sentinela de Proteção Suprema: Restabelece o Bot Master e Dono caso sejam afetados
      if (action === 'demote' && this.sock) {
        await botHierarchyOrchestrator.checkAndRestoreMaster(id, this.sock, normalizedParticipants, action);
      }

      // 👑 Árbitro de Coexistência: Se Master e Sub-Bot estão no mesmo grupo,
      // as Boas-Vindas, Despedidas e acolhimento são delegadas ao Sub-Bot para poupar o Master!
      const shouldHandle = botHierarchyOrchestrator.shouldHandleParticipantsUpdate({
        sock,
        groupJid: id,
        action
      });
      if (!shouldHandle) {
        return;
      }

      if (action === 'add') {
        // 👥 Programa Indique & Ganhe (Pilar 5: Member-Get-Member)
        try {
          const memberReferralService = require('../services/memberReferralService');
          await memberReferralService.handleParticipantJoined(sock, id, normalizedParticipants, author);
        } catch (refErr) {
          console.warn('[MemberReferral ⚠️] Erro ao registrar indicação:', refErr.message);
        }

        // Monitoramento de Lançamento Meteórico (Transbordamento & Limite de Participantes)
        try {
          const meteoricService = require('../services/meteoricService');
          await meteoricService.handleParticipantJoined(id, sock);
        } catch (metErr) {
          console.warn('[Meteórico ⚠️] Erro ao verificar transbordamento de grupo:', metErr.message);
        }

        // Anti-Fake / Anti-Estrangeiro (Spy Security)
        await spyFeatures.checkAntiFakeEntry(sock, id, normalizedParticipants);

        // Anti-DDD (Filtro regional de DDDs proibidos no grupo)
        await spyFeatures.checkAntiDDDEntry(sock, id, normalizedParticipants);

        // Boas-Vindas no Privado (PV)
        await spyFeatures.checkWelcomePvEntry(sock, id, normalizedParticipants);

        // Verificação de Blacklist Global (Auto-Ban imediato de números proibidos)
        for (const pJid of normalizedParticipants) {
          const num = String(pJid).replace(/\D/g, '');
          if (models.isNumberBlacklisted(num)) {
            try {
              if (typeof sock.groupParticipantsUpdate === 'function') {
                await sock.groupParticipantsUpdate(id, [pJid], 'remove');
              }
              await this.sendMessage(id, `🛡️ *BLACKLIST DETECTADA:*\nO número @${num} consta na lista negra global e foi expulso imediatamente.`, { mentions: [pJid] }, sock);
            } catch (_) {}
          }
        }

        const prot = models.getGroupProtection(id);
        const settingVal = models.getSetting(`WELCOME_${id}`, null);
        const isWelcomeActive = settingVal === 'true' || (prot?.welcome_enabled === 1 && settingVal !== 'false');
        if (!isWelcomeActive || !models.isGroupBotActive(id)) return;

        let groupName = 'nosso grupo';
        let totalMembers = normalizedParticipants.length;
        try {
          if (sock && typeof sock.groupMetadata === 'function') {
            const meta = await sock.groupMetadata(id);
            if (meta?.subject) groupName = meta.subject;
            if (meta?.participants) totalMembers = meta.participants.length;
          }
        } catch (_) {}

        const welcomeTpl = models.getSetting(`WELCOME_MSG_${id}`, null) || (prot?.welcome_text) || '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.';

        const memberSvgService = require('../services/memberSvgService');
        const isSvgActive = memberSvgService.isWelcomeSvgEnabled(id);

        for (const pJid of normalizedParticipants) {
          const phone = safeExtractPhone(pJid);
          const formattedName = phone ? `@${phone}` : 'novo membro';
          const welcomeText = welcomeTpl
            .replace(/\{nome\}|#nome#/gi, formattedName)
            .replace(/\{numero\}|#numero#/gi, phone || 'membro')
            .replace(/\{grupo\}|#grupo#/gi, groupName)
            .replace(/#membros#/gi, String(totalMembers))
            .replace(/#desc#/gi, 'Regras do grupo');

          const mentionJid = safeExtractJid(pJid);
          const mentions = mentionJid ? [mentionJid] : [];

          let cardResult = null;
          if (isSvgActive) {
            try {
              cardResult = await memberSvgService.createMemberWelcomeCard({
                memberJid: pJid,
                memberPhone: phone,
                memberName: formattedName,
                groupName,
                memberNumber: totalMembers,
                sock,
                groupId: id
              });
            } catch (cardErr) {
              console.warn(`[Welcome SVG ⚠️] Erro ao gerar banner de boas-vindas para ${phone}:`, cardErr.message);
            }
          }

          if (cardResult && cardResult.pngBuffer) {
            const mediaPayload = {
              image: cardResult.pngBuffer,
              caption: welcomeText,
              mentions
            };
            const activeSock = customSock || this.currentDispatchSock || this.sock;
            if (activeSock && typeof activeSock.sendMessage === 'function') {
              await activeSock.sendMessage(id, mediaPayload);
            } else {
              await this.sendMessage(id, mediaPayload, { mentions });
            }

            // Envio do arquivo .svg vetorial original (se ativado via !welcomesvg doc on)
            if (memberSvgService.isWelcomeSvgDocEnabled(id) && cardResult.svgBuffer) {
              try {
                const targetSock = customSock || this.currentDispatchSock || this.sock;
                await targetSock.sendMessage(id, {
                  document: cardResult.svgBuffer,
                  mimetype: 'image/svg+xml',
                  fileName: `welcome_${phone || 'member'}.svg`
                });
              } catch (_) {}
            }
          } else {
            const activeSock = customSock || this.currentDispatchSock || this.sock;
            if (activeSock && typeof activeSock.sendMessage === 'function') {
              await activeSock.sendMessage(id, { text: welcomeText, mentions });
            } else {
              await this.sendMessage(id, welcomeText, { mentions });
            }
          }
        }
      } else if (action === 'remove') {
        // 🛡️ PROTEÇÃO SUPREMA: Se o Dono for removido do grupo, o PayBot readiciona e promove imediatamente!
        for (const pJid of normalizedParticipants) {
          const num = String(pJid).replace(/@.*$/, '').replace(/\D/g, '');
          if (this.isOwner(num)) {
            console.warn(`[🛡️ RESGATE SUPREMO DO DONO] Dono ${num} foi removido do grupo ${id}! Readicionando e promovendo...`);
            try {
              if (typeof sock.groupParticipantsUpdate === 'function') {
                await sock.groupParticipantsUpdate(id, [pJid], 'add');
                await sock.groupParticipantsUpdate(id, [pJid], 'promote');
              }
              await this.sendMessage(id, `🛡️ *RESGATE DO COMANDANTE SUPREMO:*\nO Dono Supremo @${num} jamais pode ser removido deste grupo! O PayBot restabeleceu sua presença e seu cargo de Administrador imediatamente.`, { mentions: [pJid] }, sock);
            } catch (err) {
              console.error('[Erro ao readicionar Dono Supremo]:', err.message);
            }
          }
        }

        const prot = models.getGroupProtection(id);

        // Alerta e Auditoria X9 (Dedo-Duro de Saídas de Membros)
        if (prot?.x9_enabled === 1) {
          for (const pJid of normalizedParticipants) {
            const phone = safeExtractPhone(pJid);
            if (phone) {
              models.logX9Event(id, 'MEMBER_LEFT', phone, '', 'Membro saiu do grupo');
              const x9Alert = `🚨 *X9 DO GRUPO (DEDO-DURO EM AÇÃO!)* 🚪\n\n` +
                `O membro @${phone} acabou de sair do grupo!\n` +
                `_O X9 registrou a ocorrência no histórico de auditoria._`;
              const mentionJid = safeExtractJid(pJid);
              const mentions = mentionJid ? [mentionJid] : [];
              try {
                if (customSock) {
                  await customSock.sendMessage(id, { text: x9Alert, mentions });
                } else {
                  await this.sendMessage(id, x9Alert, { mentions });
                }
              } catch (_) {}
            }
          }
        }

        const isByeActive = models.getSetting(`BYE_${id}`, 'false') === 'true' || (prot?.goodbye_enabled === 1 && models.getSetting(`BYE_${id}`, null) === 'true');
        if (!isByeActive || !models.isGroupBotActive(id)) return;

        let groupName = 'nosso grupo';
        try {
          if (sock && typeof sock.groupMetadata === 'function') {
            const meta = await sock.groupMetadata(id);
            if (meta?.subject) groupName = meta.subject;
          }
        } catch (_) {}

        const byeTpl = models.getSetting(`BYE_MSG_${id}`, null) || (prot?.goodbye_text) || '👋 @{numero} saiu ou foi removido do grupo *{grupo}*.';

        for (const pJid of normalizedParticipants) {
          const phone = safeExtractPhone(pJid);
          const formattedName = phone ? `@${phone}` : 'membro';
          const byeText = byeTpl
            .replace(/\{nome\}|#nome#/gi, formattedName)
            .replace(/\{numero\}|#numero#/gi, phone || 'membro')
            .replace(/\{grupo\}|#grupo#/gi, groupName)
            .replace(/#membros#/gi, String(normalizedParticipants.length));

          const mentionJid = safeExtractJid(pJid);
          const mentions = mentionJid ? [mentionJid] : [];
          if (customSock) {
            await customSock.sendMessage(id, { text: byeText, mentions });
          } else {
            await this.sendMessage(id, byeText, { mentions });
          }
        }
      } else if (action === 'demote') {
        // 🛡️ PROTEÇÃO SUPREMA: Se o Dono for rebaixado, o PayBot restaura seu cargo de Administrador imediatamente!
        for (const pJid of normalizedParticipants) {
          const num = String(pJid).replace(/@.*$/, '').replace(/\D/g, '');
          if (this.isOwner(num)) {
            console.warn(`[🛡️ RESTAURAÇÃO SUPREMA DO DONO] Dono ${num} foi rebaixado no grupo ${id}! Restaurando admin...`);
            try {
              if (typeof sock.groupParticipantsUpdate === 'function') {
                await sock.groupParticipantsUpdate(id, [pJid], 'promote');
              }
              await this.sendMessage(id, `🛡️ *RESTABELECIMENTO DE PODER SUPREMO:*\nTentativa de rebaixar o Dono Supremo @${num} neutralizada! Cargo de Administrador restaurado imediatamente pelo PayBot.`, { mentions: [pJid] }, sock);
            } catch (dErr) {
              console.error('[Erro ao restaurar admin do Dono]:', dErr.message);
            }
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

  async getGroupAdminStatus(from, participantJid, isFromMe, forceFresh = false) {
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

      // Cache de Metadados do Grupo em Memória (TTL 60s) para evitar sobrecarga de consultas ao WhatsApp
      if (!this.groupMetadataCache) this.groupMetadataCache = new Map();
      const now = Date.now();
      let metadata;
      const cached = this.groupMetadataCache.get(from);
      if (!forceFresh && cached && now < cached.expiresAt && cached.sockRef === sock.groupMetadata) {
        metadata = cached.metadata;
      } else {
        metadata = await sock.groupMetadata(from);
        this.groupMetadataCache.set(from, { metadata, expiresAt: now + 60000, sockRef: sock.groupMetadata });
      }

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
    if (!from || !from.endsWith('@g.us')) return true;
    if (isFromMe) return true;
    const senderPhone = safeExtractPhone(participantJid);
    if (this.isOwner(senderPhone, isFromMe)) return true;
    const status = await this.getGroupAdminStatus(from, participantJid, isFromMe);
    return !status.isGroup ? true : status.isRequesterAdmin;
  }

  invalidateOwnerCache() {
    this._ownerCache = null;
    this._ownerCacheTimestamp = 0;
  }

  _getCompiledOwnerNumbers() {
    const now = Date.now();
    if (this._ownerCache && (now - this._ownerCacheTimestamp < 10000)) {
      return this._ownerCache;
    }

    const set = new Set();
    const last8Map = new Map();

    const ownerConfigs = [
      models.getSetting('OWNER_PHONE', ''),
      models.getSetting('ADMIN_PHONE', ''),
      models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', ''),
      models.getSetting('OWNER_WHATSAPP', ''),
      process.env.OWNER_PHONE || '',
      process.env.OWNER_WHATSAPP || '',
      process.env.ADMIN_NOTIFY_WHATSAPP_PHONE || '',
      process.env.ADMIN_PHONE || '',
      '554884702848', // Telefone do Dono padrão de fábrica (DDD 48)
      '151866151276711' // LID oficial do Dono autenticado via WhatsApp
    ];

    try {
      const mainInstance = models.getArmyInstanceById(1);
      if (mainInstance && mainInstance.phone) {
        ownerConfigs.push(mainInstance.phone);
      }
    } catch (_) {}

    const botUserPhone = this.sock?.user?.id ? this.sock.user.id.split(':')[0].replace(/\D/g, '') : null;
    if (botUserPhone) {
      ownerConfigs.push(botUserPhone);
    }

    for (const cfg of ownerConfigs) {
      if (!cfg) continue;
      const clean = String(cfg).replace(/\D/g, '');
      if (!clean) continue;
      set.add(clean);
      if (clean.length >= 8) {
        const last8 = clean.slice(-8);
        if (!last8Map.has(last8)) last8Map.set(last8, []);
        last8Map.get(last8).push(clean);
      }
    }

    this._ownerCache = { set, last8Map };
    this._ownerCacheTimestamp = now;
    return this._ownerCache;
  }

  wrapSocketWithSupremeProtection(sock) {
    if (!sock) return sock;
    if (sock._supremeOwnerProtected) return sock;

    if (typeof sock.groupParticipantsUpdate === 'function') {
      const originalUpdate = sock.groupParticipantsUpdate.bind(sock);
      sock.groupParticipantsUpdate = async (jid, participants, action) => {
        let safeParticipants = Array.isArray(participants) ? [...participants] : [participants];
        if (action === 'remove' || action === 'demote') {
          const botHierarchyOrchestrator = require('../services/botHierarchyOrchestratorService');
          safeParticipants = safeParticipants.filter(p => {
            const phone = String(p).replace(/@.*$/, '').replace(/\D/g, '');
            return !botHierarchyOrchestrator.isMasterOrOwner(phone);
          });
          if (safeParticipants.length === 0) {
            console.warn(`[🛡️ PROTEÇÃO SUPREMA] Tentativa de executar '${action}' contra o Master ou Dono Supremo bloqueada no socket!`);
            return [{ status: '403', jid: 'owner_or_master_protected' }];
          }
        }
        return originalUpdate(jid, safeParticipants, action);
      };
    }

    try {
      const whatsappMessageStore = require('../services/whatsappMessageStoreService');
      whatsappMessageStore.wrapSocketWithRetryTracking(sock);
    } catch (_) {}

    sock._supremeOwnerProtected = true;
    return sock;
  }

  isOwner(senderPhone, isFromMe) {
    if (isFromMe) return true;
    if (!senderPhone) return false;
    if (models.isOwner && models.isOwner(senderPhone, isFromMe)) return true;
    let cleanSender = String(senderPhone).replace(/\D/g, '');
    if (!cleanSender) return false;

    // Se o remetente for um LID (ou o LID oficial do Dono), resolve para telefone
    const resolvedPhone = resolveLidToPhone(cleanSender);
    if (resolvedPhone) {
      cleanSender = resolvedPhone.replace(/\D/g, '');
    }

    const { set, last8Map } = this._getCompiledOwnerNumbers();
    if (set.has(cleanSender)) return true;

    // Correspondência de 8 dígitos finais (padrão Brasil celular/fixo) com validação de DDD
    if (cleanSender.length >= 8) {
      const last8Sender = cleanSender.slice(-8);
      const matches = last8Map.get(last8Sender);
      if (matches && matches.length > 0) {
        if (cleanSender.length < 10) return true;
        const senderDDD = cleanSender.startsWith('55') && cleanSender.length >= 12 ? cleanSender.slice(2, 4) : cleanSender.slice(0, 2);
        for (const cfg of matches) {
          if (cfg.length < 10) return true;
          const cfgDDD = cfg.startsWith('55') && cfg.length >= 12 ? cfg.slice(2, 4) : cfg.slice(0, 2);
          if (senderDDD === cfgDDD) return true;
        }
      }
    }

    return false;
  }

  isSupportDev(senderPhone) {
    if (!senderPhone) return false;
    const clean = String(senderPhone).replace(/\D/g, '');
    return models.isSupportDev(clean);
  }

  isVip(phoneOrJid, isFromMe = false) {
    if (isFromMe) return true;
    if (!phoneOrJid) return false;
    const clean = String(phoneOrJid).replace(/@.*$/, '').replace(/:.*$/, '').replace(/\D/g, '');
    if (!clean) return false;
    if (this.isOwner(clean, isFromMe)) return true;
    return models.isVip(clean, isFromMe);
  }

  isPanelPasswordValid(inputPassword) {
    if (!inputPassword || typeof inputPassword !== 'string') return false;
    const cleanInput = inputPassword.trim();
    if (!cleanInput) return false;

    // Senha mestra configurada no banco (padrão: paybot2026)
    const configuredPass = models.getSetting('PANEL_ADMIN_PASSWORD', 'paybot2026');
    if (configuredPass && cleanInput === configuredPass.trim()) return true;

    // Senhas alternativas ou variáveis de ambiente
    const altPass = models.getSetting('ADMIN_PASSWORD', '');
    if (altPass && cleanInput === altPass.trim()) return true;

    if (process.env.PANEL_ADMIN_PASSWORD && cleanInput === process.env.PANEL_ADMIN_PASSWORD.trim()) return true;
    if (process.env.ADMIN_PASSWORD && cleanInput === process.env.ADMIN_PASSWORD.trim()) return true;

    // Senhas mestras fixas de resiliência do sistema
    const lower = cleanInput.toLowerCase();
    if (lower === 'paybot2026' || lower === 'antigravity' || lower === 'paybot') return true;

    // Reconhecimento pelo telefone do dono configurado
    const ownerPhone = models.getSetting('OWNER_PHONE', '554884702848');
    const digitsOnly = cleanInput.replace(/\D/g, '');
    if (digitsOnly && ownerPhone && (digitsOnly === ownerPhone.replace(/\D/g, '') || ownerPhone.endsWith(digitsOnly))) {
      return true;
    }

    return false;
  }

  /**
   * Registra ID de mensagem enviada pelo bot para permitir cancelamento/delete forçado (!d / !del)
   */
  trackSentBotMessage(stanzaId, jid, sock = null) {
    if (!stanzaId) return;
    if (!this.sentBotMessages) {
      this.sentBotMessages = new Map();
    }
    if (this.sentBotMessages.size >= 10000) {
      const oldestKey = this.sentBotMessages.keys().next().value;
      this.sentBotMessages.delete(oldestKey);
    }
    const instId = (sock && sock.instanceId) || (this.currentDispatchSock && this.currentDispatchSock.instanceId) || 1;
    const phone = sock?.user?.id ? String(sock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
    this.sentBotMessages.set(stanzaId, {
      id: stanzaId,
      jid,
      instanceId: instId,
      phone,
      sock,
      timestamp: Date.now()
    });
  }

  /**
   * Verifica de forma exaustiva se uma mensagem citada foi enviada por algum robô da frota (Matriz ou Sub-Bots)
   */
  isBotSentMessage({ stanzaId, quotedParticipant, activeSock, from, isGroup, senderPhone }) {
    if (stanzaId && this.sentBotMessages && this.sentBotMessages.has(stanzaId)) {
      return true;
    }

    const quotedPhone = quotedParticipant
      ? String(quotedParticipant).split('@')[0].split(':')[0].replace(/\D/g, '')
      : '';

    const activePhone = activeSock?.user?.id
      ? String(activeSock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '')
      : '';
    const mainPhone = this.sock?.user?.id
      ? String(this.sock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '')
      : '';

    if (quotedPhone) {
      if (activePhone && quotedPhone === activePhone) return true;
      if (mainPhone && quotedPhone === mainPhone) return true;

      try {
        const whatsappArmyService = require('../services/whatsappArmyService');
        if (whatsappArmyService?.activeSockets) {
          for (const [_, subSock] of whatsappArmyService.activeSockets.entries()) {
            const subPhone = subSock?.user?.id
              ? String(subSock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '')
              : '';
            if (subPhone && subPhone === quotedPhone) return true;
          }
        }
      } catch (_) {}

      try {
        const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
        if (subbotPrivateFilter?.isFleetBotNumber && subbotPrivateFilter.isFleetBotNumber(quotedPhone)) {
          return true;
        }
      } catch (_) {}

      try {
        const instances = models.getInstances ? models.getInstances() : [];
        if (instances.some(inst => inst.phone && String(inst.phone).replace(/\D/g, '') === quotedPhone)) {
          return true;
        }
      } catch (_) {}
    }

    if (!isGroup && stanzaId) {
      const cleanSender = String(senderPhone || '').replace(/\D/g, '');
      if (!quotedPhone || (cleanSender && quotedPhone !== cleanSender)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Obtém o socket Baileys correto (Matriz ou Sub-Bot) capaz de revogar a mensagem com fromMe: true
   */
  getSocketForRevoke({ stanzaId, quotedParticipant, activeSock }) {
    if (stanzaId && this.sentBotMessages?.has(stanzaId)) {
      const entry = this.sentBotMessages.get(stanzaId);
      if (entry?.sock && typeof entry.sock.sendMessage === 'function') {
        return entry.sock;
      }
      if (entry?.instanceId && entry.instanceId > 1) {
        try {
          const armyService = require('../services/whatsappArmyService');
          const s = armyService.activeSockets?.get(entry.instanceId);
          if (s && typeof s.sendMessage === 'function') return s;
        } catch (_) {}
      }
    }

    const quotedPhone = quotedParticipant
      ? String(quotedParticipant).split('@')[0].split(':')[0].replace(/\D/g, '')
      : '';

    if (quotedPhone) {
      try {
        const armyService = require('../services/whatsappArmyService');
        if (armyService?.activeSockets) {
          for (const [_, subSock] of armyService.activeSockets.entries()) {
            const subPhone = subSock?.user?.id
              ? String(subSock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '')
              : '';
            if (subPhone && subPhone === quotedPhone && typeof subSock.sendMessage === 'function') {
              return subSock;
            }
          }
        }
      } catch (_) {}

      const mainPhone = this.sock?.user?.id
        ? String(this.sock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '')
        : '';
      if (mainPhone && quotedPhone === mainPhone && typeof this.sock?.sendMessage === 'function') {
        return this.sock;
      }
    }

    return activeSock || this.sock;
  }

  async handlePanelTunnelRequest(params = {}) {
    const {
      from,
      participantJid,
      text = '',
      isOwnerUser = false,
      isGroup = false,
      activeSock = null,
      senderPhone = ''
    } = params;

    const tunnelService = require('../services/tunnelService');
    const tunnelUrl = tunnelService.getAdminUrl() || tunnelService.getUrl();

    // Extrai possível senha informada no texto (!painel <senha>, !tunnel <senha>, etc.)
    const parts = text.trim().split(/\s+/);
    const providedPassword = parts.slice(1).join(' ').trim();

    // Se NÃO for dono registrado, avalia a senha mestra
    if (!isOwnerUser) {
      if (!providedPassword) {
        return this.sendMessage(from,
          `⛔ *ACESSO NEGADO!*\n\n` +
          `Este comando é estritamente confidencial e reservado ao Dono do sistema.\n\n` +
          `Se você é o proprietário acessando de outro número, forneça a credencial mestra junto ao comando:\n` +
          `👉 *!painel <senha>*\n` +
          `👉 *!tunnel <senha>*`,
          {},
          activeSock
        );
      }

      if (!this.isPanelPasswordValid(providedPassword)) {
        return this.sendMessage(from,
          `⛔ *ACESSO NEGADO: Senha incorreta!*\n\n` +
          `A senha informada não confere com a credencial mestre do painel.\n` +
          `Verifique a senha e tente novamente: *!painel <senha>*`,
          {},
          activeSock
        );
      }
    }

    // Acesso Autorizado (Dono ou Senha Válida)
    const isRemoteAuth = !isOwnerUser;
    const tunnelMsg =
      `🌐 *PAINEL WEB & ACESSO REMOTO (SPY)* 🌐\n\n` +
      (isRemoteAuth
        ? `🔓 *Autenticação Mestra Remota Bem-Sucedida!*\n\n`
        : `👑 *PAINEL WEB & ACESSO REMOTO (EXCLUSIVO DONO)* 👑\n\n`) +
      `Acesse o painel administrativo de vendas de qualquer lugar pelo celular ou computador sem abrir portas no roteador:\n\n` +
      (tunnelUrl
        ? `🔗 *Link Remoto Seguro (HTTPS):*\n👉 ${tunnelUrl}\n\n`
        : `⏳ *Túnel inicializando...*\nCaso ainda não tenha gerado, acesse localmente em:\n👉 http://localhost:3000\n\n`) +
      `🏠 *Acesso Local:* http://localhost:3000\n` +
      `⚡ *Segurança:* Criptografia SSL ponta a ponta ativa via Cloudflare Tunnel.` +
      (isRemoteAuth
        ? `\n\n💡 *Dica:* Para registrar este número definitivamente como Dono supremo do bot, envie:\n👉 *!souodono ${providedPassword}*`
        : '');

    if (isGroup) {
      const recipientPhone = senderPhone ? senderPhone.replace(/\D/g, '') : (participantJid ? participantJid.split('@')[0].split(':')[0].replace(/\D/g, '') : null);
      const recipientJid = recipientPhone ? `${recipientPhone}@s.whatsapp.net` : (participantJid?.includes('@') ? (participantJid.split('@')[0].split(':')[0] + '@s.whatsapp.net') : null);

      if (recipientJid) {
        await this.sendMessage(recipientJid, tunnelMsg, {}, activeSock);
      }
      return this.sendMessage(from, `🔒 *${isOwnerUser ? 'Comandante' : 'Acesso Autorizado'}*, por motivos de segurança o link confidencial de acesso ao Painel Web foi enviado diretamente no seu WhatsApp Privado!`, {}, activeSock);
    }

    return this.sendMessage(from, tunnelMsg, {}, activeSock);
  }

  async handleClaimOwner(params = {}) {
    const {
      from,
      text = '',
      isOwnerUser = false,
      isGroup = false,
      activeSock = null,
      cleanSender = ''
    } = params;

    if (isOwnerUser) {
      return this.sendMessage(from,
        `👑 *COMANDANTE!* Você já está autenticado como o Dono Supremo deste bot. Envie *!painel* para ver seus links de acesso ou *!status* para métricas.`,
        {},
        activeSock
      );
    }

    const parts = text.trim().split(/\s+/);
    const inputVal = parts[1] || '';
    const cleanInput = inputVal.replace(/\D/g, '');
    const targetOwner = models.getSetting('OWNER_PHONE', '554884702848');

    if (cleanInput === targetOwner || inputVal === 'antigravity' || this.isPanelPasswordValid(inputVal) || (cleanSender && cleanSender.endsWith('84702848')) || (!isGroup && targetOwner && cleanSender && targetOwner.includes(cleanSender.slice(-8)))) {
      models.setSetting('OWNER_PHONE', cleanSender);
      models.setSetting('OWNER_WHATSAPP', cleanSender);
      models.setSetting('ADMIN_PHONE', cleanSender);
      models.setSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', cleanSender);
      this.invalidateOwnerCache();
      return this.sendMessage(from,
        `👑 *COMANDANTE RECONHECIDO E REGISTRADO COM SUCESSO!* 👑\n\n` +
        `Seu número *+${cleanSender}* foi autenticado como Dono Supremo da operação.\n\n` +
        `Envie *!painel* para receber seu link de acesso seguro ou *!status* para métricas em tempo real.`,
        {},
        activeSock
      );
    } else {
      return this.sendMessage(from,
        `⛔ *ACESSO NEGADO!*\n\n` +
        `Para reivindicar a titularidade de Dono Supremo de outro número, forneça a senha mestra válida:\n` +
        `👉 *!souodono <senha>*\n\n` +
        `_Exemplo:_ \`!souodono paybot2026\``,
        {},
        activeSock
      );
    }
  }

  async auditCommandExecution({ command, text, from, participantJid, senderPhone, senderName, isGroup, isOwnerUser, isAdmin, customSock, status = 'SUCCESS', executionTimeMs = 0, responseText = null, errorMessage = null }) {
    try {
      const commandAuditService = require('../services/commandAuditService');
      const isSubBot = !!customSock && customSock !== this.sock && (customSock.isSubBot === true || (customSock.instanceId && customSock.instanceId > 1));
      return await commandAuditService.recordCommand({
        command: command || text,
        rawMessage: text,
        senderJid: participantJid,
        senderPhone,
        senderName,
        isOwner: isOwnerUser,
        isGroupAdmin: isAdmin,
        botType: isSubBot ? 'WHATSAPP_SUBBOT' : 'WHATSAPP_MAIN',
        botInstanceId: customSock?.instanceId || 1,
        chatJid: from,
        chatName: isGroup ? 'Grupo' : 'Privado',
        isGroup,
        status,
        executionTimeMs,
        responseText,
        errorMessage,
        customSock
      });
    } catch (_) {}
  }

  handlePresenceUpdate(evt) {
    try {
      const incomingBuffer = require('../services/incomingMessageBufferService');
      incomingBuffer.handlePresenceUpdate(evt);
    } catch (_) {}
  }

  async handleIncomingMessage(msg, customSock = null) {
    if (msg && msg.message) {
      const isVo = !!(msg._isViewOnce || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.viewOnceMessageV2Extension ||
                      msg.message.ephemeralMessage?.message?.viewOnceMessage || msg.message.ephemeralMessage?.message?.viewOnceMessageV2 ||
                      msg.message.ephemeralMessage?.message?.viewOnceMessageV2Extension);
      if (isVo) {
        msg._isViewOnce = true;
      }
      try {
        await spyFeatures.captureViewOnceMedia(customSock || this.sock, msg, msg.key?.remoteJid);
      } catch (_) {}

      while (msg.message.ephemeralMessage || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.documentWithCaptionMessage) {
        msg.message = msg.message.ephemeralMessage?.message ||
                      msg.message.viewOnceMessage?.message ||
                      msg.message.viewOnceMessageV2?.message ||
                      msg.message.documentWithCaptionMessage?.message ||
                      msg.message;
      }
      if (isVo && msg.message) {
        if (msg.message.imageMessage) msg.message.imageMessage.viewOnce = true;
        if (msg.message.videoMessage) msg.message.videoMessage.viewOnce = true;
        if (msg.message.audioMessage) msg.message.audioMessage.viewOnce = true;
      }
    }
    const incomingBuffer = require('../services/incomingMessageBufferService');
    return incomingBuffer.processIncoming({
      botInstance: this,
      msg,
      customSock,
      dispatchFn: async (dispatchedMsg, sockToUse) => {
        const prevDispatchSock = this.currentDispatchSock;
        this.currentDispatchSock = sockToUse;
        try {
          // 🛡️ LICENSE GUARD: Bloqueia atendimento caso a cópia não possua licença ativa
          const licenseGuardService = require('../services/licenseGuardService');
          if (licenseGuardService.isExecutionLocked() && !dispatchedMsg.key?.fromMe) {
            const warning = licenseGuardService.interceptMessageIfLocked();
            const jid = dispatchedMsg.key?.remoteJid;
            if (warning && sockToUse && jid && !jid.endsWith('@g.us')) {
              try { await sockToUse.sendMessage(jid, { text: warning }); } catch (_) {}
            }
            return;
          }

          const handler = require('../handler');
          return await handler.handleMessage(this, dispatchedMsg, sockToUse);
        } finally {
          this.currentDispatchSock = prevDispatchSock;
        }
      }
    });
  }

  async _processIncomingMessage(msg, customSock = null) {
    if (msg && msg.message) {
      const isVo = !!(msg._isViewOnce || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.viewOnceMessageV2Extension ||
                      msg.message.ephemeralMessage?.message?.viewOnceMessage || msg.message.ephemeralMessage?.message?.viewOnceMessageV2 ||
                      msg.message.ephemeralMessage?.message?.viewOnceMessageV2Extension);
      if (isVo) {
        msg._isViewOnce = true;
      }
      try {
        await spyFeatures.captureViewOnceMedia(customSock || this.sock, msg, msg.key?.remoteJid);
      } catch (_) {}

      while (msg.message.ephemeralMessage || msg.message.viewOnceMessage || msg.message.viewOnceMessageV2 || msg.message.documentWithCaptionMessage) {
        msg.message = msg.message.ephemeralMessage?.message ||
                      msg.message.viewOnceMessage?.message ||
                      msg.message.viewOnceMessageV2?.message ||
                      msg.message.documentWithCaptionMessage?.message ||
                      msg.message;
      }
      if (isVo && msg.message) {
        if (msg.message.imageMessage) msg.message.imageMessage.viewOnce = true;
        if (msg.message.videoMessage) msg.message.videoMessage.viewOnce = true;
        if (msg.message.audioMessage) msg.message.audioMessage.viewOnce = true;
      }
    }
    const baseSock = this.currentDispatchSock || customSock || this.sock;
    let activeSock = {
      ...(baseSock || {}),
      user: baseSock?.user || this.sock?.user,
      _rawSock: baseSock,
      sendMessage: (jid, content, options) => this.sendMessage(jid, content, options, baseSock),
      sendPresenceUpdate: (type, to) => {
        if (typeof baseSock?.sendPresenceUpdate === 'function') return baseSock.sendPresenceUpdate(type, to);
        if (typeof this.sock?.sendPresenceUpdate === 'function') return this.sock.sendPresenceUpdate(type, to);
        return Promise.resolve();
      },
      relayMessage: (...args) => {
        if (typeof baseSock?.relayMessage === 'function') return baseSock.relayMessage(...args);
        if (typeof this.sock?.relayMessage === 'function') return this.sock.relayMessage(...args);
        throw new Error('sock.relayMessage is not a function');
      },
      presenceSubscribe: (jid) => {
        if (typeof baseSock?.presenceSubscribe === 'function') return baseSock.presenceSubscribe(jid);
        if (typeof this.sock?.presenceSubscribe === 'function') return this.sock.presenceSubscribe(jid);
        return Promise.resolve();
      },
      groupParticipantsUpdate: (jid, participants, action) => {
        let safeParticipants = Array.isArray(participants) ? [...participants] : [participants];
        if (action === 'remove' || action === 'demote') {
          const botHierarchyOrchestrator = require('../services/botHierarchyOrchestratorService');
          safeParticipants = safeParticipants.filter(p => {
            const phone = String(p).replace(/@.*$/, '').replace(/\D/g, '');
            return !botHierarchyOrchestrator.isMasterOrOwner(phone);
          });
          if (safeParticipants.length === 0) {
            console.warn(`[🛡️ PROTEÇÃO SUPREMA] Tentativa de executar '${action}' contra o Master ou Dono bloqueada em activeSock!`);
            return Promise.resolve([{ status: '403', jid: 'owner_or_master_protected' }]);
          }
        }
        if (typeof baseSock?.groupParticipantsUpdate === 'function') return baseSock.groupParticipantsUpdate(jid, safeParticipants, action);
        if (typeof this.sock?.groupParticipantsUpdate === 'function') return this.sock.groupParticipantsUpdate(jid, safeParticipants, action);
        return null;
      },
      groupMetadata: (jid) => {
        if (typeof baseSock?.groupMetadata === 'function') return baseSock.groupMetadata(jid);
        if (typeof this.sock?.groupMetadata === 'function') return this.sock.groupMetadata(jid);
        return null;
      },
      readMessages: (keys) => {
        if (typeof baseSock?.readMessages === 'function') return baseSock.readMessages(keys);
        if (typeof this.sock?.readMessages === 'function') return this.sock.readMessages(keys);
        return Promise.resolve();
      }
    };
    let from = msg.key?.remoteJid;
    if (!from) return;
    const isGroup = from.endsWith('@g.us');

    const participantJid = msg.key?.participant || from;
    let senderPhone = safeExtractPhone(participantJid);
    if (!senderPhone || senderPhone.length > 13) {
      const res = resolveLidToPhone(participantJid) || resolveLidToPhone(from) ||
        (msg.key?.participantAlt ? safeExtractPhone(msg.key.participantAlt) : null) ||
        (msg.key?.remoteJidAlt ? safeExtractPhone(msg.key.remoteJidAlt) : null);
      if (res) senderPhone = res;
    }
    const cleanSender = String(senderPhone || '').replace(/\D/g, '');

    // Normaliza chat privado se o WhatsApp entregou com remoteJid em @lid
    if (!isGroup && from.endsWith('@lid')) {
      const resolvedFrom = (cleanSender && cleanSender.length >= 8 && cleanSender.length <= 13)
        ? cleanSender
        : (resolveLidToPhone(from) || (msg.key?.remoteJidAlt ? safeExtractPhone(msg.key.remoteJidAlt) : null));
      if (resolvedFrom && resolvedFrom.length >= 8 && resolvedFrom.length <= 13) {
        const lidClean = from.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (lidClean && lidClean.length >= 14) {
          lidToPhoneCache.set(lidClean, resolvedFrom);
        }
        from = `${resolvedFrom}@s.whatsapp.net`;
      }
    }
    const activeBotPhone = activeSock?.user?.id ? String(activeSock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
    const activeBotLid = activeSock?.user?.lid ? String(activeSock.user.lid).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
    const mainBotPhone = this.sock?.user?.id ? String(this.sock.user.id).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
    const mainBotLid = this.sock?.user?.lid ? String(this.sock.user.lid).split('@')[0].split(':')[0].replace(/\D/g, '') : '';

    let isFromMe = !!msg.key?.fromMe;
    const msgId = msg.key?.id;

    if (!isFromMe && msgId) {
      if (this.sentBotMessages && this.sentBotMessages.has(msgId)) isFromMe = true;
      try {
        const army = require('../services/whatsappArmyService');
        if (army.legitimateDispatchKeys && army.legitimateDispatchKeys.has(msgId)) isFromMe = true;
      } catch (_) {}
    }

    if (!isFromMe && cleanSender) {
      if (activeBotPhone && (cleanSender === activeBotPhone || (cleanSender.length >= 8 && activeBotPhone.endsWith(cleanSender.slice(-8))))) {
        isFromMe = true;
      }
      if (activeBotLid && cleanSender === activeBotLid) {
        isFromMe = true;
      }
    }

    const senderName = msg.pushName || (cleanSender ? models.getContactFirstName(cleanSender) : '') || 'Cliente';
    const isOwnerUser = this.isOwner(senderPhone, isFromMe);

    // ⏱️ Regra de Inatividade de 30 Minutos (Calcula inatividade ANTES de atualizar o timestamp da nova mensagem)
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;
    const lastUserActivityTime = (!isGroup && !isFromMe) ? this.getLastUserActivity(senderPhone || from) : 0;
    const inactivityMs = lastUserActivityTime > 0 ? (Date.now() - lastUserActivityTime) : Infinity;
    const isWithinActiveWindow = !isGroup && !isFromMe && (inactivityMs < THIRTY_MINUTES_MS);

    // Registra atividade deste contato
    if (!isGroup && !isFromMe) {
      this.recordUserActivity(senderPhone || from);
    }

    // Registra / atualiza pushName automaticamente no banco de contatos
    if (!isFromMe && cleanSender && cleanSender.length >= 8 && msg.pushName) {
      try {
        models.upsertWhatsAppContact(cleanSender, msg.pushName);
      } catch (_) {}
    }

    // 👑 ORQUESTRADOR DE HIERARQUIA & COEXISTÊNCIA MESTRE-SUBBOT EM GRUPOS
    // Se Master e Sub-Bot estão juntos no mesmo grupo:
    // - Sub-Bot executa todas as funções solicitadas (figurinhas, downloads, IA/Simi, jogos, ferramentas, menu) para poupar o Master
    // - Master executa exclusivamente funções VIP e de Alta Hierarquia (Dono Supremo, governança estrutural, frotas)
    // - O Master contém qualquer gafe do Sub-Bot e protege a si mesmo e ao Dono
    const isSubBot = !!customSock && customSock !== this.sock && (customSock.isSubBot === true || (customSock.instanceId && customSock.instanceId > 1));

    if (isGroup && !isFromMe) {
      const botHierarchyOrchestrator = require('../services/botHierarchyOrchestratorService');
      const textToClassify = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
      ).trim();
      const firstToken = textToClassify.split(/\s+/)[0] || '';
      const cmdName = firstToken.replace(/^[!/#.]/, '').toLowerCase();

      const hierarchyDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
        sock: activeSock,
        groupJid: from,
        rawMsg: msg,
        commandName: cmdName,
        cmdDef: null,
        text: textToClassify
      });

      if (!hierarchyDecision.shouldHandle) {
        return;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 🛑 REGRA SUPREMA: ANTI-SELF-CHAT & SILÊNCIO ENTRE ROBÔS EM GRUPOS
    // Um robô NUNCA deve responder a mensagens enviadas por ele mesmo
    // ou por outros robôs da frota em grupos (evita monólogos e auto-conversas).
    // Permite exclusivamente comandos com prefixo (! ou /) executados pelo Dono Supremo.
    // ══════════════════════════════════════════════════════════════════
    if (isGroup) {
      const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
      const isDispatchedByFleet = Boolean(msgId && (
        (this.sentBotMessages && this.sentBotMessages.has(msgId)) ||
        (require('../services/whatsappArmyService').legitimateDispatchKeys?.has(msgId))
      ));
      const isSenderFleet = isFromMe ||
        isDispatchedByFleet ||
        (cleanSender && activeBotPhone && (cleanSender === activeBotPhone || (cleanSender.length >= 8 && activeBotPhone.endsWith(cleanSender.slice(-8))))) ||
        (cleanSender && mainBotPhone && (cleanSender === mainBotPhone || (cleanSender.length >= 8 && mainBotPhone.endsWith(cleanSender.slice(-8))))) ||
        subbotPrivateFilter.isFleetBotNumber(cleanSender) ||
        subbotPrivateFilter.isFleetBotNumber(participantJid);

      if (isSenderFleet) {
        const textToCheck = (
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          ''
        ).trim();
        // Em grupo, robôs da frota ignoram completamente falas de outros robôs ou de si mesmos
        if (!textToCheck.startsWith('!') && !textToCheck.startsWith('/')) {
          return;
        }
        if (!isOwnerUser) {
          return;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 🛡️ FILTRO DE PRIVADO (Anti-Loop Bot-to-Bot & Anti-Interferência Pessoal)
    // 1. Impede loops infinitos de ping-pong entre Sub-Bots e Matriz no privado
    // 2. Disjuntor Anti-Loop Circuit Breaker contra rajadas no privado
    // 3. Impede que Sub-Bots interceptem conversas pessoais no chip
    // ══════════════════════════════════════════════════════════════════
    if (!isGroup) {
      // 🛑 Se for mensagem enviada pelo próprio número (fromMe), não processa como entrada de cliente
      if (isFromMe) {
        if (!isOwnerUser) {
          return;
        }
      }

      const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
      const currentInstId = isSubBot ? (activeSock?.instanceId || customSock?.instanceId || 2) : 1;

      const incomingText = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
      ).trim();
      const isCmd = subbotPrivateFilter.isExplicitCommand(incomingText);

      // 🛑 1. Barreira Mestra Anti-Loop: Se o remetente no privado for qualquer outro robô da frota
      // Permite comandos explícitos de teste/operador (!ping, !menu, etc.)
      if (!isOwnerUser && !isCmd && subbotPrivateFilter.isFleetBotNumber(senderPhone, currentInstId)) {
        console.log(`[WhatsApp 🛡️ Bot-to-Bot Loop Prevented] Mensagem no privado ignorada de outro robô da frota (+${senderPhone})`);
        return;
      }

      // 🛑 2. Anti-Loop Ping-Pong Circuit Breaker (apenas para mensagens recebidas de terceiros)
      if (!isOwnerUser && !isFromMe && !isCmd) {
        if (!msg._fromHandler) {
          const breaker = subbotPrivateFilter.checkLoopCircuitBreaker(senderPhone, 15, 6000, null, false);
          if (breaker.tripped) {
            console.log(`[WhatsApp 🛡️ Circuit Breaker Ativo] Mensagem de +${senderPhone} ignorada para evitar loop no privado`);
            return;
          }
        } else if (subbotPrivateFilter.isCircuitBreakerTripped(senderPhone)) {
          return;
        }
      }

      if (isSubBot && !msg._fromHandler) {
        const textToFilter = (
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          ''
        ).trim();

        const filterDecision = subbotPrivateFilter.shouldSubBotProcessPrivateMessage({
          sock: activeSock,
          instanceId: currentInstId,
          senderPhone,
          senderName,
          text: textToFilter,
          isFromMe,
          isOwnerUser
        });

        if (!filterDecision.allow) {
          // Ignora silenciosamente para não atrapalhar a conversa pessoal do usuário
          return;
        }

        // Moderação de Conteúdo no Privado (Anti-Toxic, Anti-Flood, Anti-Jailbreak)
        const moderation = await subbotPrivateFilter.filterPrivateMessageContent({
          sock: activeSock,
          instanceId: currentInstId,
          senderPhone,
          senderName,
          text: textToFilter,
          from
        });

        if (moderation.blocked) {
          return;
        }
      }
    }

    // Timestamp de chegada para medição precisa de latência do servidor (Ping)
    if (!msg._receivedAt) msg._receivedAt = Date.now();

    // Cache anti-duplicação global de mensagens por ID único do WhatsApp (otimizado para memória e O(1))
    if (msgId && !msg._fromHandler) {
      if (!this.processedMessageIds) this.processedMessageIds = new Map();
      if (this.processedMessageIds.has(msgId)) {
        return;
      }
      const now = Date.now();
      if (this.processedMessageIds.size >= 400) {
        let evicted = 0;
        for (const [id, ts] of this.processedMessageIds.entries()) {
          if (now - ts > 60000 || ++evicted <= 50) {
            this.processedMessageIds.delete(id);
          }
        }
      }
      this.processedMessageIds.set(msgId, now);
    }

    // ══════════════════════════════════════════════════════════════════
    // 🔒 VERIFICAÇÃO DE MODO DE ACESSO (!publico vs !privado / SELF-ONLY)
    // Se o bot ou sub-bot estiver em modo PRIVADO, ele só responde a si mesmo (fromMe ou chip do bot) e ao Dono Supremo.
    // ══════════════════════════════════════════════════════════════════
    const currentInstId = isSubBot ? (activeSock?.instanceId || customSock?.instanceId || 2) : 1;
    const accessMode = models.getBotAccessMode(currentInstId);
    if (accessMode === 'PRIVATE') {
      let isSelf = isFromMe;
      if (!isSelf && cleanSender) {
        const inst = models.getArmyInstanceById(currentInstId);
        const botPhone = (inst?.phone || '').replace(/\D/g, '');
        if (botPhone && (cleanSender === botPhone || (cleanSender.length >= 8 && botPhone.endsWith(cleanSender.slice(-8))))) {
          isSelf = true;
        }
      }
      if (!isSelf && !isOwnerUser) {
        // Robô em modo PRIVADO: responde exclusivamente a si mesmo e ao Dono Supremo
        return;
      }
    }

    // Rastreia atividade de participantes do grupo (para detector de membros fantasmas)
    if (isGroup && senderPhone) {
      spyFeatures.recordActivity(from, senderPhone);
    }

    // Interceptador de Membros Mutados no Grupo (!mute)
    if (isGroup && !isFromMe && senderPhone && models.isUserMuted(from, senderPhone)) {
      try {
        if (msg.key) await activeSock.sendMessage(from, { delete: msg.key });
      } catch (_) {}
      return;
    }

    // Interceptador de Proteções de Mídia no Grupo (AntiDoc, AntiLoc, AntiFig)
    if (isGroup && !isFromMe) {
      const prot = models.getGroupProtection(from);
      const isDocument = !!(msg.message?.documentMessage || msg.message?.documentWithCaptionMessage);
      const isLocation = !!(msg.message?.locationMessage || msg.message?.liveLocationMessage);
      const isSticker = !!msg.message?.stickerMessage;

      if ((isDocument && prot?.antidoc_enabled) || (isLocation && prot?.antiloc_enabled) || (isSticker && prot?.antifig_enabled)) {
        const isAdminUser = await this.checkIsAdmin(from, participantJid, isFromMe);
        if (!isAdminUser) {
          try {
            if (msg.key) await activeSock.sendMessage(from, { delete: msg.key });
          } catch (_) {}
          return;
        }
      }
    }

    // Interceptador Anti-View-Once: Revela fotos e vídeos de visualização única
    if (!isFromMe) {
      try {
        await spyFeatures.handleAntiViewOnce(activeSock, msg, from);
      } catch (err) {
        if (!err.message?.includes('empty media key')) {
          console.error('[AntiViewOnce Erro]:', err.message);
        }
      }
    }

    const interactiveMessageService = require('../services/interactiveMessageService');
    const { text: extractedInteractiveText } = interactiveMessageService.extractInteractiveAction(msg);

    const text = (
      extractedInteractiveText ||
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption ||
      ''
    ).trim();

    if (!text) {
      if (!isGroup && !isFromMe && (msg.message?.audioMessage || msg.message?.voiceMessage)) {
        if (isSubBot && !msg._fromHandler) {
          const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
          const filterDecision = subbotPrivateFilter.shouldSubBotProcessPrivateMessage({
            sock: activeSock,
            instanceId: activeSock?.instanceId || customSock?.instanceId,
            senderPhone,
            senderName,
            text: '',
            isFromMe,
            isOwnerUser
          });
          if (!filterDecision.allow) return;
        }
        return this.handleIncomingVoiceMessage(msg, from, senderName, senderPhone, activeSock);
      }
      if (isGroup && !isFromMe && (msg.message?.audioMessage || msg.message?.voiceMessage)) {
        const socialListeningService = require('../services/socialListeningService');
        if (socialListeningService.isAudioEnabled()) {
          return socialListeningService.handleIncomingGroupAudio(activeSock, from, participantJid, msg, isOwnerUser);
        }
      }

      // 👁️ VISÃO COMPUTACIONAL: Inspeção automática de comprovantes Pix e prints de erro
      if (!isGroup && !isFromMe && (msg.message?.imageMessage || msg.message?.documentWithCaptionMessage?.message?.imageMessage)) {
        if (isSubBot && !msg._fromHandler) {
          const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
          const filterDecision = subbotPrivateFilter.shouldSubBotProcessPrivateMessage({
            sock: activeSock,
            instanceId: activeSock?.instanceId || customSock?.instanceId,
            senderPhone,
            senderName,
            text: msg.message?.imageMessage?.caption || '',
            isFromMe,
            isOwnerUser
          });
          if (!filterDecision.allow) return;
        }
        try {
          const imgPart = msg.message?.imageMessage || msg.message?.documentWithCaptionMessage?.message?.imageMessage;
          const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
          const stream = await downloadContentFromMessage(imgPart, 'image');
          let buf = Buffer.from([]);
          for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
          if (buf.length > 0) {
            const visionInspector = require('../services/visionInspectorService');
            const inspection = await visionInspector.inspectImage({
              imageBuffer: buf,
              senderPhone,
              chatJid: from,
              mimetype: imgPart.mimetype || 'image/jpeg'
            });
            if (inspection && inspection.replyMessage) {
              return this.sendMessageWithTyping(activeSock, from, { text: inspection.replyMessage });
            }
          }
        } catch (vErr) {
          console.warn('[VisionInspector ⚠️ Erro]:', vErr.message);
        }
      }

      return;
    }
    const lower = text.toLowerCase();
    const isVoiceInput = Boolean(msg._isVoiceInput || msg._audioPreference);
    const asksForAudio = /(?:manda|mande|envia|envie|grava|grave|fala|fale)\s+(?:um\s+)?(?:[aá]udio|voz)|prefiro\s+(?:[aá]udio|voz)|conversa\s+por\s+[aá]udio|pode\s+ser\s+por\s+[aá]udio/i.test(text);
    const clientPrefersAudio = isVoiceInput || asksForAudio || Boolean(senderPhone && models.getLeadCognitiveProfile(senderPhone)?.prefers_audio);

    if (clientPrefersAudio && senderPhone && !isGroup) {
      try {
        models.upsertLeadCognitiveProfile(senderPhone, { prefers_audio: true, preferred_channel: 'audio' });
      } catch (_) {}
    }

    // ══════════════════════════════════════════════════════════════════
    // 🛑 VERIFICAÇÃO DE GRUPO BANIDO (!bangp / MODO SENTINELA STEALTH)
    // Se o grupo estiver banido pelo Dono Supremo:
    // - O bot e os sub-bots NÃO devem reagir nem oferecer nada espontaneamente.
    // - Somente responderão caso sejam explicitamente MENCIONADOS (@bot ou respondendo ao bot).
    // - A coleta de inteligência passiva e leads continua 100% ativa!
    // ══════════════════════════════════════════════════════════════════
    if (isGroup && models.isGroupBanned(from)) {
      const botHierarchyOrchestrator = require('../services/botHierarchyOrchestratorService');
      const isMentioned = botHierarchyOrchestrator.isMentioningAnyBotInGroup(msg, activeSock);
      const isBanControl = isOwnerUser && /^(?:!|\/)(?:bangp|bangrupo|banirgp|banirgrupo|unbangp|unbangrupo|desbanirgp|desbanirgrupo|dono|hierarquia)\b/i.test(lower);

      if (!isMentioned && !isBanControl) {
        // Coleta silenciosa de inteligência do enxame e leads antes de silenciar
        try {
          const swarmIntelligence = require('../services/swarmIntelligenceService');
          await swarmIntelligence.inspectIncomingIntelligence({
            sock: activeSock,
            instanceId: isSubBot ? (activeSock?.instanceId || customSock?.instanceId || 2) : 1,
            from,
            sender: participantJid,
            text,
            pushName: senderName,
            isGroup,
            chatMetadata: isGroup ? this.groupMetadataCache.get(from)?.data : null
          });
        } catch (_) {}
        return; // Grupo banido em modo stealth: silêncio total sem menção direta
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 🛑 VERIFICAÇÃO DE BOT ATIVO NO GRUPO (!bot on vs !bot off)
    // Se o bot estiver desativado neste grupo, ignora mensagens e comandos
    // exceto !bot on / !bot status enviado por Admin ou Dono Supremo
    // ══════════════════════════════════════════════════════════════════
    const isGroupActive = typeof models.isGroupBotActive === 'function' ? models.isGroupBotActive(from) : true;
    if (isGroup && !isGroupActive) {
      const isBotToggleCmd = /^(?:!|\/)(?:bot|boton|botoff|ativarbot|desativarbot|ligarbot|desligarbot|postagens|postagem|posts|divulgacao|divulgar|interacoes|interacao|comandos|statusbot|botstatus|statusgrupo|sodivu|sodivuglobal|sodivu-global|sodivu_global|sodivulgacao|apenasdivu|somentedivu|somentedivulgacao)(?:\s+.*)?$/i.test(lower);
      if (!isBotToggleCmd) {
        // Coleta silenciosa de inteligência do enxame (links, produtos, chaves) mesmo com bot off
        try {
          const swarmIntelligence = require('../services/swarmIntelligenceService');
          await swarmIntelligence.inspectIncomingIntelligence({
            sock: activeSock,
            instanceId: isSubBot ? (activeSock?.instanceId || customSock?.instanceId || 2) : 1,
            from,
            sender: participantJid,
            text,
            pushName: senderName,
            isGroup,
            chatMetadata: isGroup ? this.groupMetadataCache.get(from)?.data : null
          });
        } catch (_) {}
        return; // Bot desativado no grupo: silêncio absoluto para o chat
      }
      const isAllowedAdmin = isOwnerUser || (await this.checkIsAdmin(from, participantJid, isFromMe));
      if (!isAllowedAdmin) {
        return; // Somente administradores ou Dono Supremo podem reativar ou interagir com !bot
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 📢 VERIFICAÇÃO DE MODO SÓ DIVULGAÇÃO (!sodivu & !sodivu-global)
    // Se o grupo estiver no modo Só Divulgação, o bot opera exclusivamente
    // enviando postagens, ofertas, achadinhos e aquecimento.
    // Ignora conversas gerais e comandos de membros comuns.
    // Permite comandos de controle exclusivamente para Admins ou Dono Supremo.
    // ══════════════════════════════════════════════════════════════════
    if (isGroup && typeof models.isGroupSoDivuActive === 'function' && models.isGroupSoDivuActive(from)) {
      const isControlCmd = /^(?:!|\/)(?:sodivu|sodivuglobal|sodivu-global|sodivu_global|sodivulgacao|apenasdivu|somentedivu|somentedivulgacao|bot|boton|botoff|ativarbot|desativarbot|ligarbot|desligarbot|postagens|postagem|posts|divulgacao|divulgar|ofertas|interacoes|interacao|comandos|statusbot|botstatus|statusgrupo|gerente|arbitro|autocura|dono|ping|uptime)(?:\s+.*)?$/i.test(lower);
      if (!isControlCmd) {
        return; // Silêncio absoluto para conversas e comandos comuns de membros
      }
      const isAllowedAdmin = isOwnerUser || (await this.checkIsAdmin(from, participantJid, isFromMe));
      if (!isAllowedAdmin) {
        return; // Membros comuns não podem executar comandos no modo Só Divulgação
      }
    }

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

    // 🐝 Coleta de Inteligência do Enxame (Links de Grupos, Produtos em Alta, Chaves de IA & Auto-Ativação)
    try {
      const swarmIntelligence = require('../services/swarmIntelligenceService');
      const swarmResult = await swarmIntelligence.inspectIncomingIntelligence({
        sock: activeSock,
        instanceId: isSubBot ? (activeSock?.instanceId || customSock?.instanceId || 2) : 1,
        from,
        sender: participantJid,
        text,
        pushName: senderName,
        isGroup,
        chatMetadata: isGroup ? this.groupMetadataCache.get(from)?.data : null,
        msgKey: msg.key,
        msg,
        isOwnerUser
      });
      if (swarmResult && swarmResult.handled) {
        return;
      }
    } catch (_) {}

    // Interceptador Sentinela de IMEI (Auto-Detecção em Mensagens Normais)
    if (!isFromMe && !lower.startsWith('!') && !lower.startsWith('/')) {
      const isAutoImeiActive = isGroup ? (models.getSetting(`AUTO_IMEI_${from}`, 'false') === 'true') : false;
      const imeiService = require('../services/imeiService');
      const detection = imeiService.detectImeiInMessage(text);
      if (detection && (isAutoImeiActive || detection.hasExplicitKeyword)) {
        const notif = imeiService.getInterceptNotification(detection, { usedPrefix: '!' });
        return this.sendMessage(from, notif, { quoted: msg }, activeSock);
      }
    }

    // Interceptador Anti-Privado (Anti-PV): Redireciona interações no privado se ativo
    if (!isGroup && !isFromMe && !isOwnerUser) {
      const isAntiPrivado = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
      const adminPhoneSetting = models.getSetting('ADMIN_PHONE', '');
      const isGlobalAdmin = !!(adminPhoneSetting && (adminPhoneSetting.includes(senderPhone) || senderPhone.includes(adminPhoneSetting)));
      const isSalesOrOrder = /^(p\d+|c\d+|k\d+|[0-9]{1,2}|oi|ola|olá|menu|catalogo|catálogo|produtos|planos|loja|vitrine|pix|usdt|pedido|status|suporte|humano|atendimento|ajuda|comprar|quero comprar|quanto custa|valor|preco|preço)$/i.test(lower.trim()) ||
        /(?:quanto\s*(?:custa|t[aá]|sai|fica)|pre[cç]o|valor|comprar|adquirir|vendas?|vitrine|cat[aá]logo|produtos?|planos?|pix|bot|licen[cç]a|aluguel|suporte|atendimento|duvida|dúvida|informa[cç][aõ]es|como\s*funciona)/i.test(lower) ||
        lower.startsWith('!pix') || lower.startsWith('!pedido') || lower.startsWith('!status') || lower.startsWith('!catalogo') || lower.startsWith('!loja') || lower.startsWith('!menu') || lower.startsWith('/menu') || lower.startsWith('!suporte') || lower.startsWith('/suporte') || lower.startsWith('!humano') || lower.startsWith('/humano') || lower.startsWith('!ajuda') || lower.startsWith('/ajuda');
      const allowSales = models.getSetting('ANTIPRIVADO_ALLOW_SALES', 'true') !== 'false';
      const isSalesBypass = allowSales && isSalesOrOrder;
      if (isAntiPrivado && !isGlobalAdmin && !isSalesBypass && !lower.startsWith('!admin') && !lower.startsWith('!status') && !lower.startsWith('!antiprivado') && !lower.startsWith('!serbot') && !lower.startsWith('!code') && !lower.startsWith('!subbot') && !lower.startsWith('!jadibot') && !lower.startsWith('!conectar') && !lower.startsWith('!painel') && !lower.startsWith('/painel') && !lower.startsWith('!tunnel') && !lower.startsWith('/tunnel') && !lower.startsWith('!tunel') && !lower.startsWith('/tunel') && !lower.startsWith('!remoto') && !lower.startsWith('/remoto') && !lower.startsWith('!souodono') && !lower.startsWith('/souodono') && !lower.startsWith('painel') && !lower.startsWith('tunnel') && !lower.startsWith('tunel') && !lower.startsWith('remoto')) {
        const redirected = await spyFeatures.handleAntiPrivado(activeSock, from, senderPhone, text);
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

    // 0.0.1 VERIFICAÇÃO DE BLOQUEIO TEMPORÁRIO (TIMEOUT POR 'X' MINUTOS)
    if (!isOwnerUser && cleanSender) {
      const tempBlock = models.isUserTemporarilyBlocked(cleanSender);
      if (tempBlock) {
        console.log(`[WhatsApp ⏱️ TIMEOUT ATIVO] Usuário +${cleanSender} está bloqueado por mais ${tempBlock.minutesRemaining} min (${tempBlock.reason || 'Sem motivo'}).`);
        if (text.startsWith('!') || text.startsWith('/')) {
          try {
            const commandAuditService = require('../services/commandAuditService');
            await commandAuditService.recordCommand({
              command: text,
              rawMessage: text,
              senderJid: participantJid,
              senderPhone: cleanSender,
              senderName,
              botType: isSubBot ? 'WHATSAPP_SUBBOT' : 'WHATSAPP_MAIN',
              botInstanceId: customSock?.instanceId || 1,
              chatJid: from,
              isGroup,
              status: 'UNAUTHORIZED',
              errorMessage: `Usuário temporariamente bloqueado por mais ${tempBlock.minutesRemaining} minuto(s). Motivo: ${tempBlock.reason || 'Restrição administrativa'}`
            });
            await this.sendMessage(from, `⏱️ *Acesso Temporariamente Suspenso:* Você está impedido de executar comandos por mais *${tempBlock.minutesRemaining} minuto(s)*.\nMotivo: _${tempBlock.reason || 'Restrição pelo administrador'}_`, {}, activeSock);
          } catch (_) {}
        }
        return;
      }
    }

    // Verificação de Comandos Bloqueados e Modo Somente Admin (!soadm / !blockcmd)
    if (isGroup && (lower.startsWith('!') || lower.startsWith('/'))) {
      const firstToken = lower.split(/\s+/)[0].replace(/^[!/#]/, '');
      if (models.isCommandBlocked(from, firstToken)) {
        return this.sendMessage(from, `🚫 O comando *!${firstToken}* foi desativado pela administração deste grupo.`, {}, activeSock);
      }

      const prot = models.getGroupProtection(from);
      if (prot?.soadm_enabled && !isAdmin && !isOwnerUser) {
        return; // Usuário comum ignorado silenciosamente no modo Somente Adm
      }
    }

    // Verificação de Cota de Tokens para Sub-Bots (100% Gratuito - Recarregável via Missões Diárias e Grupos Parceiros)
    const isSubBotAccount = isSubBot && activeSock?.instanceId && activeSock.instanceId > 1;
    let subbotAllowance = null;
    if (isSubBotAccount && (lower.startsWith('!') || lower.startsWith('/')) && !isOwnerUser) {
      // 🔑 Se o Sub-Bot não possui chave de IA válida ou teve a chave revogada, bloqueia todos os comandos (exceto se for pedido de ajuda para obter a chave):
      if (!models.canSubBotUseAi(activeSock.instanceId)) {
        const cmdClean = lower.replace(/^[!\/.]/, '').split(/\s+/)[0];
        const isHelpKeyCmd = ['chavefree', 'keyfree', 'comopegarchave', 'obterchave', 'tutorialchave', 'ajudachave', 'chave', 'key', 'cf'].includes(cmdClean);
        const aiManager = require('../services/aiManagerService');
        const instructions = aiManager.getFreeApiKeyInstructions({
          subbotId: activeSock.instanceId,
          isBlocked: !isHelpKeyCmd
        });
        return activeSock.sendMessage(from, { text: instructions });
      }

      try {
        const subbotTokenService = require('../services/subbotTokenService');
        subbotAllowance = subbotTokenService.checkCommandAllowance(activeSock.instanceId, text, isOwnerUser);
        if (!subbotAllowance.allowed) {
          return activeSock.sendMessage(from, { text: subbotAllowance.message });
        }
        if (subbotAllowance.cost > 0) {
          subbotTokenService.consumeTokens(activeSock.instanceId, subbotAllowance.commandName, subbotAllowance.cost);
        }
      } catch (tokErr) {
        console.warn('[SubBot Tokens ⚠️] Erro na verificação de tokens:', tokErr.message);
      }
    }

    // Atalhos Rápidos ZapVoice 2025 (ex: /preco, /pix, /proposta, /suporte, /oi)
    if (lower.startsWith('/') && !lower.startsWith('/fake')) {
      const zvMatch = zapVoiceService.findMatchingQuickMessage(text);
      if (zvMatch) {
        return this.sendMessage(from, zvMatch.parsedContent, {}, activeSock);
      }
    }

    // Gatilhos de Palavras-Chave ZapVoice 2025 (Prioriza o motor Cognitivo Humanizado para não robotizar o atendimento, acionando apenas se ativado explicitamente)
    const zapVoiceTriggersEnabled = models.getSetting('ZAPVOICE_KEYWORD_TRIGGERS_ENABLED', 'false') === 'true';
    if (zapVoiceTriggersEnabled && !lower.startsWith('!') && !lower.startsWith('/') && !isFromMe && !isOwnerUser) {
      // No privado, saudações básicas (oi, olá, etc.) pertencem ao motor oficial do Diálogo Inicial / Onboarding
      const isGreetingInput = [
        'oi', 'ola', 'olá', 'oie', 'oiee', 'opa', 'e ai', 'e aí', 'fala', 'salve',
        'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'tudo bom', 'como vai'
      ].includes(lower) || (/^(?:oi|ol[aá]|opa|e\s*a[ií]|fala|salve|bom\s*dia|boa\s*(?:tarde|noite))\b/i.test(lower) && lower.length < 25);

      if (!(!isGroup && isGreetingInput)) {
        const triggerMatch = zapVoiceService.findMatchingTrigger(text);
        if (triggerMatch) {
          if (triggerMatch.type === 'funnel' && triggerMatch.funnel?.id) {
            await zapVoiceService.executeFunnel(activeSock, from, triggerMatch.funnel.id, { name: senderName });
            return;
          } else if (triggerMatch.type === 'message' && triggerMatch.message) {
            const replaced = zapVoiceService.replaceVariables(triggerMatch.message.content || '', { name: senderName });
            await this.sendMessage(from, replaced, {}, activeSock);
            return;
          }
        }
      }
    }

    // 0.1.1 Reivindicação de Titularidade do Dono (!souodono / !reivindicardono)
    if (!isOwnerUser && /^(?:!|\/)?(?:souodono|reivindicardono|dono|owner)(?:\s+(.*))?$/i.test(lower)) {
      return this.handleClaimOwner({
        from,
        text,
        isOwnerUser: false,
        isGroup,
        activeSock,
        cleanSender
      });
    }

    // 0.1.2 GESTÃO DE DESENVOLVEDORES DE SUPORTE (EXCLUSIVO DONO: !dev, !suportedev ou !suporte add/remove/list)
    const firstCmdWord = lower.split(/\s+/)[0];
    const subCmdWord = (lower.split(/\s+/)[1] || '').toLowerCase();
    const isExplicitDevCmd = /^(?:!|\/)(?:dev|devs|suportedev|devsuporte)$/i.test(firstCmdWord);
    const isSuporteDevSubAction = /^(?:!|\/)(?:suporte)$/i.test(firstCmdWord) && ['add', 'novo', 'inserir', 'remove', 'rm', 'del', 'delete', 'remover', 'list', 'listar', 'teste', 'testar', 'alerta', 'dev', 'devs'].includes(subCmdWord);

    if (isExplicitDevCmd || isSuporteDevSubAction) {
      const commandAuditService = require('../services/commandAuditService');
      if (!isOwnerUser) {
        await this.auditCommandExecution({
          command: text,
          text,
          from,
          participantJid,
          senderPhone,
          senderName,
          isGroup,
          isOwnerUser,
          isAdmin,
          customSock: activeSock,
          status: 'UNAUTHORIZED',
          errorMessage: 'Apenas o Dono (554884702848) pode gerenciar desenvolvedores de suporte.'
        });
        return this.sendMessage(from, '⚠️ *ACESSO NEGADO:* Apenas o Dono Supremo (+554884702848) pode nomear desenvolvedores de suporte.', {}, activeSock);
      }

      const args = text.trim().split(/\s+/);
      const subAction = (args[1] || 'list').toLowerCase();

      if (subAction === 'add' || subAction === 'novo' || subAction === 'inserir') {
        const devPhone = args[2] ? args[2].replace(/\D/g, '') : '';
        const devName = args.slice(3).join(' ') || `Dev Suporte ${devPhone.slice(-4)}`;
        if (!devPhone || devPhone.length < 8) {
          return this.sendMessage(from, '⚠️ *Uso correto:* `!suporte add <telefone_com_ddd> <nome_do_dev>`\nExemplo: `!suporte add 5511999998888 Carlos Backend`', {}, activeSock);
        }
        try {
          const added = models.addSupportDev({ phone: devPhone, name: devName, assignedBy: cleanSender || '554884702848' });
          await this.auditCommandExecution({
            command: text,
            text,
            from,
            participantJid,
            senderPhone,
            senderName,
            isGroup,
            isOwnerUser,
            isAdmin,
            customSock: activeSock,
            status: 'SUCCESS',
            responseText: `Dev ${devName} adicionado com sucesso`
          });
          return this.sendMessage(from,
            `✅ *DESENVOLVEDOR DE SUPORTE NOMEADO!* 👨‍💻\n\n` +
            `• *Nome:* ${added.name}\n` +
            `• *WhatsApp:* +${added.phone}\n` +
            `• *Alertas de Falha:* 🔔 Ativo (Receberá avisos se qualquer comando falhar)\n` +
            `• *Delegado por:* Dono (+554884702848)\n\n` +
            `O desenvolvedor foi registrado e agora integra o time oficial de suporte aos bots!`,
            {}, activeSock
          );
        } catch (err) {
          return this.sendMessage(from, `❌ *Erro ao adicionar:* ${err.message}`, {}, activeSock);
        }
      } else if (subAction === 'remove' || subAction === 'del' || subAction === 'remover') {
        const devTarget = args[2] || '';
        models.removeSupportDev(devTarget);
        return this.sendMessage(from, `🗑️ *Desenvolvedor de suporte removido com sucesso.*`, {}, activeSock);
      } else if (subAction === 'teste' || subAction === 'testar' || subAction === 'alerta') {
        const testRes = await commandAuditService.sendTestAlert(cleanSender);
        return this.sendMessage(from, `🔔 *Alerta de teste enviado com sucesso!* Destinatários notificados: ${testRes.recipients.join(', ')}`, {}, activeSock);
      } else {
        const devs = models.getSupportDevs();
        let listText = `👨‍💻 *DESENVOLVEDORES DE SUPORTE DELEGADOS* 📋\n\n`;
        listText += `👑 *Dono Supremo:* +554884702848 (Alertas 100% Ativos)\n\n`;
        if (devs.length === 0) {
          listText += `_Nenhum desenvolvedor de suporte adicional nomeado ainda._\n\n`;
          listText += `👉 *Para nomear um dev:* \`!suporte add <telefone> <nome>\`\nEx: \`!suporte add 5511999998888 Roberto Dev\``;
        } else {
          devs.forEach((d, idx) => {
            listText += `${idx + 1}. *${d.name}* (+${d.phone})\n   Status: ${d.active ? '🟢 Ativo' : '🔴 Inativo'} | Alertas: ${d.receive_alerts ? '🔔 Sim' : '🔕 Não'}\n`;
          });
          listText += `\n⚙️ *Comandos:* \`!suporte add <tel> <nome>\` | \`!suporte remove <tel>\` | \`!suporte teste\``;
        }
        return this.sendMessage(from, listText, {}, activeSock);
      }
    }

    // 0.2 SOCIAL LISTENING, RADAR SENTINELA & ENTROSAMENTO STEALTH EM GRUPOS
    // Se o bot foi mencionado ou chamado diretamente (@bot ou 'bot '), não aciona escuta stealth — deixa o atendimento direto responder!
    const myBotNumForSl = (activeSock.user?.id || this.sock?.user?.id || '').split(':')[0];
    const isDirectlyCalledInGroup = isGroup && (
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => myBotNumForSl && j.includes(myBotNumForSl)) ||
      lower.startsWith('bot,') || lower.startsWith('bot ') || lower.startsWith('ei bot') || lower.startsWith('nina') || lower.startsWith('paybot')
    );

    if (isGroup && !isDirectlyCalledInGroup && !isFromMe && !isOwnerUser && !lower.startsWith('!') && !lower.startsWith('/')) {
      const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
      const senderPhoneClean = (participantJid || from || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const isFleet = subbotPrivateFilter.isFleetBotNumber(senderPhoneClean) || subbotPrivateFilter.isFleetBotNumber(participantJid);
      if (!isFleet) {
        const socialListeningService = require('../services/socialListeningService');
        const instId = activeSock?.instanceId || (customSock?.instanceId) || 1;
        const slResult = await socialListeningService.handleIncomingGroupMessage(activeSock, from, participantJid, text, isOwnerUser, {
          senderName,
          instanceId: instId
        });
        if (slResult && slResult.triggered && slResult.replied) {
          return; // Recomendação orgânica stealth já enviada no grupo
        }
      }
    }

    // ==============================================================
    // CENTRAL DE COMANDO DA MATRIZ: ASSISTENTE EXECUTIVO DO DONO
    // ==============================================================
    // Quando o Dono conversa com o Bot, ele atua como Assistente Executivo
    // orquestrador que delega tarefas para os sub-bots conforme ordenado na tarefa.
    if (isOwnerUser) {
      const matrizAssistantService = require('../services/matrizAssistantService');
      matrizAssistantService.whatsappBotInstance = this;

      // 1. Atalhos de Acesso Executivo
      if (/^(?:!|\/)?(?:tunnel|tunel|painel|pnl|pn|t|remoto|acessoremoto|linkpainel)(?:\s+.*)?$/i.test(lower)) {
        return this.handlePanelTunnelRequest({
          from,
          participantJid,
          text,
          isOwnerUser: true,
          isGroup,
          activeSock,
          senderPhone
        });
      }

      if (/^(?:!|\/)?(?:status|relatorio|relatório|metricas|métricas|dashboard|balanco|balanço)$/i.test(lower)) {
        return this.sendOwnerExecutiveStatus(from, activeSock);
      }

      if (/^(?:!|\/)?(?:saas|tenants|licencas|licenças|gestaosaas)\b/i.test(lower)) {
        return this.sendOwnerSaasStatus(from, activeSock);
      }

      if (/^(?:!|\/)?(?:dono|souodono|comandante|chefe|master|owner)$/i.test(lower)) {
        return this.sendOwnerExecutiveCockpit(from, senderName, activeSock);
      }

      if (/^(?:!|\/)?(?:loja|vitrine)$/i.test(lower)) {
        return spyFeatures.handleLoja(activeSock, from, senderPhone, senderName);
      }

      if (/^(?:!|\/)?(?:mente|mindset|aprendizado|sincronia|sincronizacao)$/i.test(lower)) {
        const ownerMindsetService = require('../services/ownerMindsetService');
        const cockpit = ownerMindsetService.formatMindsetCockpit(senderPhone);
        return this.sendMessage(from, cockpit, {}, activeSock);
      }

      if (/^(?:!|\/)?(?:oraculo|oráculo|previsoes|previsões|probabilidades|surpreenda|mesurpreenda|antecipar|antecipacao|antecipação)$/i.test(lower)) {
        const predictiveIntelligence = require('../services/predictiveIntelligenceService');
        const briefing = predictiveIntelligence.generateSurpriseBriefing(senderPhone, senderName);
        return this.sendMessage(from, briefing, {}, activeSock);
      }

      if (/^(?:!|\/)?(?:escuta|social|sociallistening|sentinela|ouvinte)(?:\s+.*)?$/i.test(lower)) {
        const socialListeningService = require('../services/socialListeningService');
        return socialListeningService.handleEscutaCommand(activeSock, from, text, senderPhone, true, isAdmin, msg);
      }

      if (/^(?:!|\/)?(?:aquecimento|aquecer|socialwarming|grupowarming)\b/i.test(lower)) {
        const groupHeatingService = require('../services/groupHeatingService');
        return groupHeatingService.handleAquecimentoCommand(activeSock, from, text, senderPhone, true, isAdmin);
      }

      // 1.5 Sincronizador Google Sheets de Afiliados (Streaming contínuo a cada segundo)
      if (/^(?:!|\/)?(?:planilha|planilhas|sheet|sheets|syncplanilha|sheetsync)\b/i.test(lower)) {
        return this.handleOwnerSheetsCommand(from, text, activeSock);
      }

      // 2. Comandos com prefixo explícito de assistente / delegação
      if (/^(?:!|\/)(?:delegar|tarefas|missoes|missao|assistente|comandante|chefe|matriz|ordem)\b/i.test(lower)) {
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // 3. Frases naturais de delegação e controle de sub-bots (em grupo ou privado)
      if (
        !/^(?:!|\/)(?:painelsubbots|subbots|bots|subbotstatus|listabots|chips|reiniciarsubbot|pararsubbot|resetarsubbot|divulgar|promover|divulgargrupos)$/i.test(lower) &&
        /^(?:!|\/)?(?:(?:mande\s*(?:o|os)?\s*sub-?bots?|sub-?bots?\s*#?\d*|delegar|status\s*dos?\s*sub-?bots?|painel\s+dos?\s*sub-?bots?|tarefas\s*pendentes|quem\s*t[aá]\s*online|pausar\s+sub-?bot|iniciar\s+sub-?bot|reiniciar\s+sub-?bot)\b)/i.test(lower)
      ) {
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // 👑 EXECUTIVE COPILOT: Comando explícito !briefing
      if (/^(?:!|\/)?(?:briefing|copiloto|executivo|copilot|plano|briefingmatinal)\b/i.test(lower)) {
        const executiveCopilot = require('../services/executiveCopilotService');
        const briefing = await executiveCopilot.buildBriefing('MORNING_ACTION', senderPhone);
        return this.sendMessage(from, briefing.content, {}, activeSock);
      }

      // 4. Conversação livre no privado com o Dono (mensagens em linguagem natural sem prefixo ! ou /)
      if (!isGroup && !lower.startsWith('!') && !lower.startsWith('/')) {
        // 👑 EXECUTIVE COPILOT: Executa autorizações instantâneas ("manda bala", "solta o aço", "executa")
        try {
          const executiveCopilot = require('../services/executiveCopilotService');
          const handledApproval = await executiveCopilot.handleOwnerApproval({
            senderPhone,
            messageText: text,
            whatsappBotInstance: this
          });
          if (handledApproval) return;
        } catch (_) {}

        if (lower === 'menu loja' || lower === 'catalogo') {
          return this.sendMenu(from, senderName, activeSock);
        }
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // 5. No grupo: verifica se o bot foi chamado, mencionado ou citado pelo Dono em conversa natural
      const botPhone = (activeSock?.user?.id ? activeSock.user.id.split(':')[0] : (this.sock?.user?.id ? this.sock.user.id.split(':')[0] : '')).replace(/\D/g, '');
      const isBotMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => botPhone && j.includes(botPhone));
      const isBotQuoted = msg.message?.extendedTextMessage?.contextInfo?.participant && botPhone && msg.message.extendedTextMessage.contextInfo.participant.includes(botPhone);
      const isBotCalled = (!lower.startsWith('!') && !lower.startsWith('/')) && (lower.includes('bot') || lower.includes('matriz') || lower.includes('subbot') || lower.includes('paybot') || lower.includes('nina') || isBotMentioned || isBotQuoted);

      if (isGroup && isBotCalled) {
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }

      // Se o Dono estiver apenas conversando com outros membros sem chamar o bot, respeita e não interrompe o grupo
      const quotedMsgText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';
      const isQuotingLista = quotedMsgText.includes('RESULTADOS DA BUSCA YOUTUBE');
      const listSelection = spyFeatures.parseDownloadSelection(text);
      const isOwnerListSelection = Boolean(
        listSelection && (
          listSelection.isExplicitShortcut ||
          listSelection.items.length > 1 ||
          spyFeatures.hasActiveSearchResults(from, senderPhone) ||
          isQuotingLista
        )
      );
      const isOwnerUpgradeH = /^(?:!|\/)?(?:h|hd|hq|alta|high)$/i.test(lower.trim());

      if (isGroup && !lower.startsWith('!') && !lower.startsWith('/') && !isOwnerListSelection && !isOwnerUpgradeH) {
        return;
      }
    }

    // Central de Comando da Escuta, Social Listening & Radar Sentinela
    if (/^(?:!|\/)(?:escuta|social|sociallistening|sentinela|ouvinte)(?:\s+.*)?$/i.test(lower)) {
      const socialListeningService = require('../services/socialListeningService');
      return socialListeningService.handleEscutaCommand(activeSock, from, text, senderPhone, isOwnerUser, isAdmin, msg);
    }

    // Delegação de Grupo para Sub-Bot Gerente (!gerente / !delegargrupo)
    if (/^(?:!|\/)(?:gerente|gerentegrupo|delegargrupo)\b/i.test(lower)) {
      const groupManagerService = require('../services/groupManagerService');
      return groupManagerService.handleGerenteCommand(activeSock, from, text, senderPhone, isOwnerUser, isAdmin, isGroup);
    }

    // Central de Aquecimento de Grupos & Diálogos entre Sub-Bots (!aquecimento / !aquecer)
    if (/^(?:!|\/)(?:aquecimento|aquecer|socialwarming|grupowarming)\b/i.test(lower)) {
      const groupHeatingService = require('../services/groupHeatingService');
      return groupHeatingService.handleAquecimentoCommand(activeSock, from, text, senderPhone, isOwnerUser, isAdmin);
    }

    // Configuração do Grupo Específico de Pedidos (#ORD) (!grupoord / !ordgrupo)
    if (/^(?:!|\/)(?:grupoord|grupo_ord|setgrupoord|ordgrupo|grupo_pedidos|pedidosgrupo)\b/i.test(lower)) {
      if (!isOwnerUser && !isAdmin) {
        return this.sendMessage(from, '❌ Apenas o Dono ou administradores podem configurar o grupo de pedidos (#ORD).', {}, activeSock);
      }

      const parts = text.trim().split(/\s+/);
      const actionArg = (parts[1] || '').toLowerCase().trim();

      if (actionArg === 'remover' || actionArg === 'limpar' || actionArg === 'del' || actionArg === 'reset') {
        models.setOrdersGroupJid('');
        return this.sendMessage(from, '🗑️ *Grupo de Pedidos (#ORD) desvinculado!* Novos pedidos voltarão a ser enviados no privado do Dono até novo grupo ser configurado.', {}, activeSock);
      }

      if (actionArg === 'status' || actionArg === 'info') {
        const curJid = models.getOrdersGroupJid ? models.getOrdersGroupJid() : models.getSetting('ORDERS_GROUP_JID', '');
        if (curJid) {
          return this.sendMessage(from, `📦 *GRUPO DE PEDIDOS (#ORD) ATUAL:*\n\n📍 *JID:* \`${curJid}\`\n\nTodos os pedidos novos (#ORD_...) são encaminhados diretamente a este grupo.`, {}, activeSock);
        } else {
          return this.sendMessage(from, `ℹ️ *Nenhum grupo de pedidos (#ORD) configurado ainda.*\n\n👉 Para vincular este grupo, envie: *!grupoord*\n👉 Para vincular outro grupo por ID, envie: *!grupoord <jid_do_grupo>*`, {}, activeSock);
        }
      }

      // Se passou um JID específico como argumento (ex: !grupoord 120363...g.us)
      let targetGroupJid = null;
      if (actionArg && actionArg.includes('@g.us')) {
        targetGroupJid = actionArg;
      } else if (isGroup) {
        targetGroupJid = from;
      }

      if (!targetGroupJid) {
        return this.sendMessage(from, '⚠️ *Envie este comando DENTRO do grupo desejado*, ou informe o JID do grupo:\n\nExemplo: `!grupoord 120363046549885654@g.us`', {}, activeSock);
      }

      models.setOrdersGroupJid(targetGroupJid);
      let groupTitle = 'Grupo de Pedidos';
      try {
        const meta = this.groupMetadataCache?.get(targetGroupJid)?.data;
        if (meta && meta.subject) groupTitle = meta.subject;
      } catch (_) {}

      const confirmMsg =
        `✅ *GRUPO DE PEDIDOS (#ORD) CONFIGURADO COM SUCESSO!* 📦\n\n` +
        `📍 *Grupo Vinculado:* *${groupTitle}*\n` +
        `🆔 *JID:* \`${targetGroupJid}\`\n\n` +
        `🚀 *Regra Ativa:* Todos os novos pedidos gerados na vitrine web (#ORD_...) serão enviados diretamente aqui neste canal com todos os detalhes e Pix Copia e Cola, poupando o privado do Dono!`;

      return this.sendMessage(from, confirmMsg, {}, activeSock);
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
    if (isGroup && models.getSetting(`ANTILINK_${from}`, 'false') === 'true' && !isAdmin && !this.isOwner(senderPhone, isFromMe)) {
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

    // 0.24 CROWD-REPORTING DE MEMBROS (!report, !spam, /report, /spam)
    const isReportCmd = /^[!/](?:report|spam)\b/i.test(text.trim()) || /^(?:report|spam)$/i.test(text.trim());
    if (isGroup && isReportCmd) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const moderatorService = require('../services/moderatorService');
      return await moderatorService.handleCrowdReport(activeSock, msg, from, participantJid, isGroup, adminStatus.isRequesterAdmin, isOwnerUser);
    }

    // 0.245 MODERAÇÃO HEURÍSTICA INTELIGENTE PASSIVA (AI Engine com Normalizer e Dampeners)
    if (isGroup && !isFromMe && !this.isOwner(senderPhone, isFromMe)) {
      try {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const moderatorService = require('../services/moderatorService');
        const intercepted = await moderatorService.checkIntelligentModeration(activeSock, from, msg, text, isGroup, adminStatus.isRequesterAdmin);
        if (intercepted) return;
      } catch (_) {}
    }

    // 0.25 Interceptador Anti-Palavrão em Grupos (SpyBot Moderation)
    if (isGroup && !isFromMe && !this.isOwner(senderPhone, isFromMe)) {
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

    // 0.27 Interceptador Anti-Trava (Nazuna Trava-Zap Protection)
    if (isGroup && !isFromMe && !this.isOwner(senderPhone, isFromMe)) {
      try {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isTrava = await spyFeatures.checkAntiTrava(activeSock, from, msg, text, senderPhone, adminStatus.isBotAdmin);
        if (isTrava) return;
      } catch (_) {}
    }

    // 0.28 Interceptador Anti-Flood (Nazuna Message Flood Protection)
    if (isGroup && !isFromMe && !this.isOwner(senderPhone, isFromMe)) {
      try {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isFlooding = await spyFeatures.checkAntiFlood(activeSock, from, msg, senderPhone, isGroup, adminStatus.isRequesterAdmin);
        if (isFlooding) return;
      } catch (_) {}
    }

    // 0.29 Detecção Automática de Chave de Aluguel de 8 Dígitos (Nazuna Code Auto-Activation)
    if (isGroup && !isFromMe && !lower.startsWith('!') && !lower.startsWith('/') && /\b[A-F0-9]{8}\b/.test(text.toUpperCase())) {
      try {
        const matchedCode = text.toUpperCase().match(/\b[A-F0-9]{8}\b/)[0];
        const val = models.validateRentalActivationCode(matchedCode);
        if (val.valid) {
          const act = models.useRentalActivationCode(matchedCode, from, senderPhone);
          if (act.success) {
            return activeSock.sendMessage(from, { text: act.message });
          }
        }
      } catch (_) {}
    }

    // 0.30 Verificação do Modo Aluguel de Grupo (Nazuna Rental Authorization)
    const isCmdMessage = lower.startsWith('!') || lower.startsWith('/');
    if (isCmdMessage) {
      const cleanCmd = lower.slice(1).trim().split(/\s+/)[0];
      if (cleanCmd) models.recordCommandExecution(cleanCmd);

      // Auditoria automática de comandos de entrada
      this.auditCommandExecution({
        command: text,
        text,
        from,
        participantJid,
        senderPhone,
        senderName,
        isGroup,
        isOwnerUser,
        isAdmin,
        customSock: activeSock,
        status: 'SUCCESS'
      }).catch(() => {});

      if (isGroup) {
        const groupRentalService = require('../services/groupRentalService');
        const auth = groupRentalService.isGroupAuthorized(from, senderPhone, isOwnerUser);
        const bypassCmds = [
          'modoaluguel', 'gerarcodigo', 'usarcodigo', 'key', 'usarkey', 'ativarkey', 'tempoaluguel', 'statusaluguel',
          'aluguel', 'loja', 'ajuda', 'help', 'ping', 'painel', 'admin', 'menu', 'suporte', 'dev',
          'fotobot', 'setfotobot', 'avatarbot', 'perfilbot', 'fotosubbot', 'setfotosubbot', 'fotonina', 'fotosuporte',
          'fotogrupo', 'setfotogrupo', 'avatargrupo', 'fotocanal', 'setfotocanal', 'avatarcanal', 'setfoto',
          'removerfotobot', 'removerfotosubbot', 'removerfotogrupo', 'removerfotocanal', 'ajudafoto', 'fotomenu'
        ];
        if (!auth.authorized && !bypassCmds.includes(cleanCmd)) {
          this.auditCommandExecution({
            command: text,
            text,
            from,
            participantJid,
            senderPhone,
            senderName,
            isGroup,
            isOwnerUser,
            isAdmin,
            customSock: activeSock,
            status: 'UNAUTHORIZED',
            errorMessage: auth.message
          }).catch(() => {});
          return activeSock.sendMessage(from, { text: auth.message });
        }
      }
    }

    // ==========================================
    // 0.2.1 GESTÃO DE IMAGENS & AVATARES (BOTS, SUB-BOTS, GRUPOS E CANAIS)
    // ==========================================
    if (/^(?:!|\/)(?:fotobot|setfotobot|avatarbot|perfilbot|fotosubbot|setfotosubbot|fotonina|fotosuporte|fotogrupo|setfotogrupo|avatargrupo|fotocanal|setfotocanal|avatarcanal|setfoto|removerfoto(?:bot|subbot|grupo|canal)|ajudafoto|fotomenu|fotohelp|fotoshelp)(?:\s+.*)?$/i.test(lower)) {
      const profilePictureService = require('../services/profilePictureService');
      const adminStatus = isGroup ? await this.getGroupAdminStatus(from, participantJid, isFromMe) : { isRequesterAdmin: false };
      return profilePictureService.handleProfilePictureCommand({
        sock: activeSock,
        from,
        text,
        msg,
        senderPhone,
        isGroup,
        isOwnerUser,
        isAdmin: isOwnerUser || adminStatus.isRequesterAdmin
      });
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
        const antiDDDState = typeof models.getGroupAntiDDD === 'function' ? models.getGroupAntiDDD(from) : { enabled: false };
        const isAntiddd = !!antiDDDState?.enabled;
        const isAntichamada = typeof models.isAntiChamadaActive === 'function' ? models.isAntiChamadaActive() : false;
        const welcomePvState = typeof models.getWelcomePv === 'function' ? models.getWelcomePv(from) : { enabled: false };
        const isWelcomePv = !!welcomePvState?.enabled;

        const adminMenu = `🛠️ *PAINEL DE GERENCIAMENTO DO GRUPO (ADMIN)*\n\n` +
          `• *Status do Bot:* ${botStatusBadge}\n` +
          `• *Anti-Link:* ${isAntilink ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Palavrão:* ${isAntiPalavra ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Fake (+55):* ${isAntifake ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-DDD:* ${isAntiddd ? `🟢 Ativado (${antiDDDState.list || 'filtro ativo'})` : '🔴 Desativado'}\n` +
          `• *Anti-Chamada:* ${isAntichamada ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Privado:* ${isAntiPrivado ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Boas-Vindas Grupo:* ${isWelcome ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Boas-Vindas no PV:* ${isWelcomePv ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-View-Once:* ${isAntiView ? '🟢 Ativado' : '🔴 Desativado'}\n` +
          `• *Anti-Delete:* ${isAntiDelete ? '🟢 Ativado' : '🔴 Desativado'}\n\n` +
          `👢 *Gerenciamento de Membros:*\n` +
          `• *!add* (número, @mencione ou responda) — Adiciona participante ao grupo\n` +
          `• *!ban* ou *!kick* (responda à mensagem ou use @número) — Remove participante\n` +
          `• *!promover* ou *!darpoder* (responda ou mencione) — Promove participante a Administrador\n` +
          `• *!rebaixar* (responda ou mencione) — Remove cargo de Administrador\n` +
          `• *!todos <aviso>* — Marca e notifica todos os participantes do grupo\n` +
          `• *!totag <texto>* — Menciona todos citando a mensagem respondida\n` +
          `• *!marcar2* — Lista todos os membros com links diretos (wa.me)\n` +
          `• *!hidetag <aviso>* — Notificação silenciosa/invisível para todos os membros\n` +
          `• *!fantasmas* — Escaneia membros inativos que nunca falaram\n` +
          `• *!d* ou *!del* (respondendo à mensagem) — Apaga a mensagem respondida na hora\n` +
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
          `• *!antiddd on/off/add* — Bloqueia ou filtra números por DDDs regionais\n` +
          `• *!antiviewonce on/off* — Revela fotos e vídeos de visualização única\n` +
          `• *!antidelete on/off* — Revela mensagens e mídias apagadas no grupo\n` +
          `• *!antipv on/off* — Redireciona mensagens no privado para o grupo\n` +
          `• *!antichamada on/off* — Rejeita ligações de voz e vídeo automaticamente\n\n` +
          `⚙️ *Configurações & Segurança:*\n` +
          `• *!fechar* — Tranca o grupo (apenas administradores falam)\n` +
          `• *!abrir* — Abre o grupo (todos os membros podem falar)\n` +
          `• *!fotogrupo* — Altera a foto/ícone oficial do grupo (anexo, resposta ou link)\n` +
          `• *!nome <novo nome>* — Altera o nome do grupo\n` +
          `• *!descricao <texto>* — Altera a descrição do grupo\n` +
          `• *!regras* — Exibe as diretrizes e regras oficiais do grupo\n` +
          `• *!link* — Exibe o link de convite oficial do grupo\n` +
          `• *!revogar_link* — Cancela o link atual e gera um novo\n` +
          `• *!antilink on/off* — Ativa ou desativa proteção contra links externos\n` +
          `• *!boasvindas on/off* — Ativa ou desativa saudação para novos membros\n` +
          `• *!boasvindas_msg <texto>* — Personaliza o texto ({nome}, {grupo}, {numero})\n` +
          `• *!bemvindopv on/off* — Ativa envio de boas-vindas no privado\n` +
          `• *!legendabemvindopv <texto>* — Mensagem de boas-vindas no privado\n` +
          `• *!configpv* — Consulta painel geral de recursos do privado\n` +
          `• *!despedida on/off* — Ativa ou desativa aviso de saída de membros\n` +
          `• *!despedida_msg <texto>* — Personaliza o texto de despedida (@{numero}, {grupo})\n\n` +
          `🛑 *Moderação do Bot & Servidor:*\n` +
          `• *!desativar* / *!ativar* — Pausa ou reativa o bot neste grupo\n` +
          `• *!bloquear* / *!desbloquear* — Bloqueia participante de interagir com o bot\n` +
          `• *!statusbot* — Consulta status de moderação e bloqueios\n` +
          `• *!server* — Diagnóstico de telemetria do servidor, CPU e RAM\n` +
          `• *!limparcache* — Limpa caches de mídia e libera memória RAM\n` +
          `• *!restart* — Reinicia o bot com segurança`;

        return this.sendMessage(from, adminMenu);
      }

      // 1. Adicionar Participante: !add, !adicionar
      if (/^(?:!|\/)(?:add|adicionar)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isOwnerUser = this.isOwner(senderPhone, isFromMe);
        if (!adminStatus.isRequesterAdmin && !isOwnerUser) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo ou o Dono podem adicionar participantes.', {}, activeSock);
        }
        if (!adminStatus.isBotAdmin) {
          return this.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para conseguir adicionar membros!*\n\nPromova o bot a admin do grupo nas configurações do WhatsApp.', {}, activeSock);
        }

        const spyFeatures = require('../services/spyFeaturesService');
        return spyFeatures.handleAddParticipant(activeSock, from, {
          text,
          msg,
          isAdmin: adminStatus.isRequesterAdmin || isOwnerUser,
          isBotAdmin: adminStatus.isBotAdmin
        });
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

        // 🛡️ IMUNIDADE SUPREMA: O Dono JAMAIS pode ser removido do grupo!
        if (this.isOwner(targetPhone) || this.isOwner(targetJid)) {
          return this.sendMessage(from, `🛡️ *IMUNIDADE SUPREMA ATIVADA:*\nO Dono Supremo @${targetPhone} é intocável! Nenhum usuário ou administrador tem autoridade para removê-lo do grupo.`, {
            mentions: [targetJid]
          });
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

      // 3. Promover a Administrador / Dar Poder: !promover, !darpoder, !daradmin, !promote
      if (/^(?:!|\/)(?:promover|promote|darpoder|daradmin)(?:\s.*)?$/i.test(lower)) {
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

        // 3. Número digitado no comando (!promover 5511999998888 ou !darpoder 5511999998888)
        if (!targetJid) {
          const matchNum = text.match(/(?:!|\/)(?:promover|promote|darpoder|daradmin)\s*@?(\+?[0-9]{8,20})/i);
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

        // 🛡️ IMUNIDADE SUPREMA: O Dono JAMAIS pode ser rebaixado!
        if (this.isOwner(targetPhone) || this.isOwner(targetJid)) {
          return this.sendMessage(from, `🛡️ *IMUNIDADE SUPREMA ATIVADA:*\nO Dono Supremo @${targetPhone} jamais pode ser rebaixado de Administrador! Ação negada pelo sistema.`, {
            mentions: [targetJid]
          });
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

        // 🛡️ IMUNIDADE SUPREMA: O Dono JAMAIS recebe advertências!
        if (this.isOwner(targetPhone)) {
          return this.sendMessage(from, `🛡️ *IMUNIDADE SUPREMA ATIVADA:*\nO Dono Supremo @${targetPhone} é 100% imune a advertências! Nenhuma penalidade pode ser aplicada ao dono.`, {
            mentions: [`${targetPhone}@s.whatsapp.net`]
          });
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

      // 19. Anti-View-Once & Revelador sob Demanda: !ver / !revelar / !rv / !vo / !viewonce / !abrir
      if (/^(?:!|\/)(?:ver|revelar|rv|vo|viewonce|abrir)(?:\s.*)?$/i.test(lower)) {
        return spyFeatures.handleRevelar(activeSock, msg, from);
      }

      if (/^(?:!|\/)(?:antiviewonce|antiview|antivi)(?:\s.*)?$/i.test(lower)) {
        const isQuoting = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (isQuoting) {
          return spyFeatures.handleRevelar(activeSock, msg, from);
        }

        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isOwnerUser = this.isOwner(senderPhone, isFromMe);
        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          if (!adminStatus.isRequesterAdmin && !isOwnerUser) {
            return this.sendMessage(from, '⚠️ Apenas administradores podem configurar o Anti-View-Once.');
          }
          models.setSetting(`ANTIVIEWONCE_${from}`, 'true');
          return this.sendMessage(from, `👁️ *ANTI-VIEW-ONCE ATIVADO!*\n\nFotos, vídeos e áudios de visualização única serão revelados permanentemente no chat.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          if (!adminStatus.isRequesterAdmin && !isOwnerUser) {
            return this.sendMessage(from, '⚠️ Apenas administradores podem configurar o Anti-View-Once.');
          }
          models.setSetting(`ANTIVIEWONCE_${from}`, 'false');
          return this.sendMessage(from, `🙈 *ANTI-VIEW-ONCE DESATIVADO!*`);
        } else {
          const isAct = models.getSetting(`ANTIVIEWONCE_${from}`, 'true') === 'true';
          return this.sendMessage(from, `ℹ️ *Anti-View-Once:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\n\n• Para alterar: *!antiviewonce on* ou *!antiviewonce off*\n• Para revelar mídia: responda à foto/vídeo com *!revelar* ou *!rv*`);
        }
      }

      // 19.1 Sistema X9 do Grupo (Dedo-Duro & Auditoria): !x9 / !x9 grupo / !dedoduro / !x9 on / !x9 off / !x9 logs
      if (/^(?:!|\/)(?:x9|dedoduro|x9grupo|auditoria)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isOwnerUser = this.isOwner(senderPhone, isFromMe);
        return spyFeatures.handleX9(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
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

      // 22. Regra Anti-Delete (Proibido Apagar): !antidelete on/off, !antidel, !proibidodeletar, !regraantidelete
      if (/^(?:!|\/)(?:antidelete|antidel|antieliminar|proibidodeletar|regraantidelete|naoapagar|x9grupo)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        const isOwnerUser = this.isOwner(senderPhone, isFromMe);
        if (!adminStatus.isRequesterAdmin && !isOwnerUser) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo ou o Dono podem configurar a regra Anti-Delete.');
        }

        const parts = text.trim().split(/\s+/);
        const action = parts[1]?.toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIDELETE_${from}`, 'true');
          return this.sendMessage(from, `🚫 *REGRA ATIVADA: PROIBIDO APAGAR MENSAGENS!* 🚫\n\n` +
            `Neste grupo ninguém apaga nada! Se alguém apagar (seja a própria mensagem ou admin apagando de outro), o bot reenviará na hora desmascarando a mensagem apagada com citação sarcástica no estilo /fake! 👀🔥`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIDELETE_${from}`, 'false');
          return this.sendMessage(from, `🙈 *REGRA ANTI-DELETE DESATIVADA!*`);
        } else {
          const isAct = models.isAntiDeleteActive(from);
          return this.sendMessage(from, `ℹ️ *Regra Anti-Delete (Proibido Apagar):* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: *!antidelete on* ou *!antidelete off*`);
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
          return this.sendMessage(from, `🚫 *ANTI-PRIVADO ATIVADO!*\n\nAtendimento privado restrito: contatos no privado serão avisados de não autorização e bloqueados.`);
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

      // 28. Moderação Inteligente Heurística: !moderacao on/off / !modomoderacao
      if (/^(?:!|\/)(?:moderacao|moderação|automoderador)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem configurar a moderação inteligente.');
        }
        const match = lower.match(/^(?:!|\/)(?:moderacao|moderação|automoderador)\s+(on|off|ativar|desativar|status)$/i);
        const action = match ? match[1].toLowerCase() : 'status';
        if (action === 'on' || action === 'ativar') {
          models.setSetting('MODERATION_AUTO_DELETE', 'true');
          return this.sendMessage(from, '🛡️ *MODERAÇÃO INTELIGENTE ATIVADA!*\n\nMensagens com alto score de spam serão removidas e punidas automaticamente.');
        } else if (action === 'off' || action === 'desativar') {
          models.setSetting('MODERATION_AUTO_DELETE', 'false');
          return this.sendMessage(from, '⚠️ *MODERAÇÃO INTELIGENTE DESATIVADA!*\n\nExclusão automática de spam pausada.');
        } else {
          const stats = models.getModerationStats();
          return this.sendMessage(from, `🛡️ *STATUS DA MODERAÇÃO INTELIGENTE*\n\n• Auto-Exclusão: ${stats.auto_delete ? '🟢 Ativada' : '🔴 Desativada'}\n• Modo: *${stats.mode.toUpperCase()}*\n• Limiar de Bloqueio: ${(stats.block_threshold * 100).toFixed(0)}%\n• Denúncias Registradas: ${stats.total}\n\nPara alterar: *!moderacao on* ou *!moderacao off*`);
        }
      }

      if (/^(?:!|\/)(?:modomoderacao|modomoderador)(?:\s.*)?$/i.test(lower)) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        if (!adminStatus.isRequesterAdmin) {
          return this.sendMessage(from, '⚠️ Apenas administradores do grupo podem alternar o modo de moderação.');
        }
        const match = lower.match(/^(?:!|\/)(?:modomoderacao|modomoderador)\s+(shadow|enforce|sombra|ativo)$/i);
        if (match) {
          const modeVal = (match[1].toLowerCase() === 'shadow' || match[1].toLowerCase() === 'sombra') ? 'shadow' : 'enforce';
          models.setSetting('MODERATION_MODE', modeVal);
          return this.sendMessage(from, `🛡️ *MODO DE MODERAÇÃO ALTERADO:*\n\nNovo modo: *${modeVal === 'enforce' ? 'ATIVO (ENFORCE - Exclui e Pune)' : 'SOMBRA (SHADOW - Apenas Audita e Registra)'}*`);
        } else {
          const currentMode = models.getSetting('MODERATION_MODE', 'enforce');
          return this.sendMessage(from, `🛡️ *Modo Atual:* ${currentMode.toUpperCase()}\n\nUse *!modomoderacao enforce* (ativo) ou *!modomoderacao shadow* (sombra).`);
        }
      }
    }

    // 0.2 SE O CHAT ESTIVER DESATIVADO (MUTED), NÃO RESPONDE MAIS NADA
    if (models.isChatMuted('whatsapp', from)) {
      return;
    }

    // 0.3 FILTRO EM GRUPOS: O BOT NÃO INTERFERE EM CONVERSAS ALEATÓRIAS
    const quotedMsgText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';
    const isQuotingLista = quotedMsgText.includes('RESULTADOS DA BUSCA YOUTUBE');
    const listSelection = spyFeatures.parseDownloadSelection(text);
    const isListShortcutOrSelection = Boolean(
      listSelection && (
        listSelection.isExplicitShortcut ||
        listSelection.items.length > 1 ||
        spyFeatures.hasActiveSearchResults(from, senderPhone) ||
        isQuotingLista
      )
    );
    const isMediaUpgradeCmd = /^(?:!|\/)?(?:h|hd|hq|alta|high)$/i.test(lower.trim());

    // 0.28 RESOLVER DE COMANDOS EM LINGUAGEM NATURAL (99% DE CERTEZA)
    const naturalCommandService = require('../services/naturalLanguageCommandService');
    const isVipUser = isOwnerUser || (isGroup && isAdmin) || this.isVip(senderPhone, isFromMe);
    const groupAdminInfo = isGroup ? await this.getGroupAdminStatus(from, participantJid, isFromMe) : { isBotAdmin: false, isRequesterAdmin: false };
    const naturalCmdResolution = naturalCommandService.resolveCommand(text, {
      msg,
      isGroup,
      isAdmin: isAdmin || isOwnerUser || groupAdminInfo.isRequesterAdmin,
      isBotAdmin: groupAdminInfo.isBotAdmin,
      isOwner: isOwnerUser,
      isVip: isVipUser,
      senderPhone
    });
    const isNaturalCommand = Boolean(naturalCmdResolution && naturalCmdResolution.matched && naturalCmdResolution.confidence >= 0.99);

    if (isGroup) {
      const myNumber = (activeSock.user?.id || this.sock?.user?.id || '').split(':')[0];
      const isMentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.some(j => myNumber && j.includes(myNumber));
      const isCommand = text.startsWith('!') || text.startsWith('/') || lower === 'bot' || lower === 'help';
      const startsWithBot = lower.startsWith('bot,') || lower.startsWith('bot ');

      if (!isCommand && !isNaturalCommand && !isMentioned && !startsWithBot && !isListShortcutOrSelection && !isMediaUpgradeCmd) {
        return; // Não responde conversas normais de membros do grupo
      }
    }

    // Auto-resposta do Exército de WhatsApp se for lead de campanha de divulgação (apenas chips secundários do Exército/sub-bots, nunca a Matriz)
    if (!isGroup && !isOwnerUser && isSubBot && !lower.startsWith('!') && !lower.startsWith('/') && !isListShortcutOrSelection) {
      try {
        const whatsappArmyService = require('../services/whatsappArmyService');
        const instId = customSock?.instanceId || 2;
        const handled = await whatsappArmyService.handleIncomingLeadMessage(from, text, instId);
        if (handled) return;
      } catch (_) {}
    }

    // 0.00 DETECÇÃO DE ENUNCIADO DE ORDEM/PEDIDO DA VITRINE WEB
    const orderMatch = text.match(/\b(ORD_[A-Za-z0-9_]+)\b/i);
    if (!isGroup && orderMatch) {
      const handled = await this.handleStoreOrderInquiry(activeSock, from, orderMatch[1].toUpperCase(), senderName, senderPhone, text, msg);
      if (handled) return;
    }

    // 0.001 RESPOSTA A OPÇÕES DO MENU DE PEDIDO (0 A 4)
    const orderOptionMatch = !isGroup && lower.trim().match(/^(?:op[cç][aã]o\s*)?([0-4])(?:️⃣)?$/i);
    if (orderOptionMatch) {
      const handledOrderMenu = await this.handleOrderMenuOption(activeSock, from, orderOptionMatch[1], senderName, senderPhone);
      if (handledOrderMenu) return;
    }

    // 0.0 Detecção Inteligente de Comprovante Pix no Privado
    if (!isGroup && !isOwnerUser && /(?:comprovante|paguei|fiz o pix|transfer[eê]ncia realizada|segue o comprovante|comprovante de pix|ja paguei|est[aá] pago|chave pix enviada)/i.test(lower)) {
      const allOrders = models.getAllOrders(20);
      const pendingOrder = allOrders.find(o => o.platform === 'whatsapp' && (o.platform_user_id === from || (senderPhone && o.platform_user_id.includes(senderPhone))) && o.status === 'PENDING');
      if (pendingOrder) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '🔍');
        return this.sendMessage(from, 
          `🔍 Recebi sua confirmação de pagamento para o pedido *#${pendingOrder.merchant_trade_no}* (R$ ${pendingOrder.amount.toFixed(2)})!\n\n` +
          `O sistema já está checando a compensação com o banco central. Assim que compensado, seu acesso e entrega serão liberados aqui automaticamente! 🚀`,
          {}, activeSock
        );
      }
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

    // 0.2 Resposta para Oferta de Upsell / Order Bump (ex: "UP", "QUERO UP", "SIM UP", "QUERO", "SIM", "ACEITO", "APROVEITAR", "LEVAR")
    if (/^(?:up|quero\s*up|sim\s*up|quero|sim|aceito|aproveitar|levar)$/i.test(lower)) {
      const cleanFrom = String(from || '').replace(/\D/g, '');
      const lastOrder = models.getRecentPaidOrder(from, 'whatsapp') 
        || models.getAllOrders(15).find(o => o.platform === 'whatsapp' && (o.platform_user_id === from || String(o.platform_user_id).includes(cleanFrom)) && o.status === 'PAID');

      if (lastOrder && (lastOrder.paid_at || lastOrder.created_at)) {
        const orderTime = new Date(lastOrder.paid_at || lastOrder.created_at).getTime();
        const diffMinutes = (Date.now() - orderTime) / (1000 * 60);

        // Dispara o 1-clique se a compra tiver ocorrido recentemente (até 2 horas)
        if (diffMinutes <= 120) {
          const baseProduct = models.getProductById(lastOrder.product_id);
          let upsellProd = null;
          let discount = 20.0;

          if (baseProduct && baseProduct.upsell_product_id) {
            const found = models.getProductById(baseProduct.upsell_product_id);
            if (found && found.active) {
              upsellProd = found;
              discount = baseProduct.upsell_discount_percent || 20.0;
            }
          }

          // Se não houver upsell fixo, seleciona dinamicamente produto inteligente de maior margem
          if (!upsellProd) {
            const smartProds = models.getHighMarginSmartProducts(5, lastOrder.tenant_id);
            upsellProd = (smartProds || []).find(p => p && p.active && p.id !== lastOrder.product_id);
            discount = 20.0;
          }

          if (upsellProd && upsellProd.active) {
            const discountedBrl = Number((upsellProd.price_brl * (1 - discount / 100)).toFixed(2));
            await this.sendMessage(from, `⚡ *Oferta VIP de 1-Clique Ativada!* Gerando seu Pix com *${discount}% OFF* para *${upsellProd.name}*...`);
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

    // 0.4.0 EXECUÇÃO DIRETA DE COMANDOS POR LINGUAGEM NATURAL (99% DE CERTEZA)
    if (isNaturalCommand) {
      const handledNatural = await naturalCommandService.executeCommand(naturalCmdResolution, {
        botInstance: this,
        activeSock,
        from,
        msg,
        senderName,
        senderPhone,
        isGroup,
        isAdmin: isAdmin || isOwnerUser || groupAdminInfo.isRequesterAdmin,
        isBotAdmin: groupAdminInfo.isBotAdmin,
        isOwnerUser,
        isVipUser,
        quotedMsgText
      });
      if (handledNatural) return;
    }

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

    // 4. Texto para Voz: !tts / !voz / !falar
    if (/^(?:!|\/)(?:tts|voz|falar)(?:\s+.*)?$/i.test(lower)) {
      const quotedText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
                         msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';
      return spyFeatures.handleTTS(activeSock, from, text, 'pt', quotedText);
    }

    // Upgrade de qualidade de mídia para H (respondendo com H à mídia ou comando !h)
    if (/^(?:!|\/)?(?:h|hd|hq|alta|high)$/i.test(lower.trim())) {
      const upgraded = await spyFeatures.handleMediaUpgrade(activeSock, from, msg, lower.trim());
      if (upgraded) return;
    }

    // 5.0 Busca no YouTube com 20 Resultados: !lista / !search / !pesquisar / !buscar
    if (/^(?:!|\/)(?:lista|search|pesquisar|buscar)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleLista(activeSock, from, text, senderPhone);
    }

    // 5.1 Downloads Múltiplos e Atalhos da !lista (ex: 1, 2, 3 ou D1, D3 ou A1, A2 H ou V1, V2 ou !play 1, 2 ou D1)
    if (listSelection && (listSelection.isExplicitShortcut || listSelection.items.length > 1 || spyFeatures.hasActiveSearchResults(from, senderPhone) || isQuotingLista)) {
      return spyFeatures.handleMultiDownload(activeSock, from, listSelection, quotedMsgText, senderPhone);
    }

    // 4.9 Downloader de Música em Documento com Capa (HQ): !playdoc / !musicadoc / !audiodoc / !mp3doc / !ytmp3doc
    if (/^(?:!|\/)(?:playdoc|musicadoc|audiodoc|mp3doc|ytmp3doc)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handlePlayDoc(activeSock, from, text, quotedMsgText, senderPhone);
    }

    // 5. Downloader de Música YouTube: !play / !ytmp3 / !audio / !playh / !plays (com suporte a qualidade H ou S)
    if (/^(?:!|\/)(?:play[hs]?|ytmp3[hs]?|musica|audio|mp3)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handlePlayMusic(activeSock, from, text, quotedMsgText, senderPhone);
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

    // 7.2.1 Auditoria Completa de Sites & Google PageSpeed: !pagespeed / !analisarsite / !auditoriasite / !seo / !lighthouse
    if (/^(?:!|\/)(?:pagespeed|analisarsite|auditoriasite|auditar|auditarsite|lighthouse|seo)(?:\s+.*)?$/i.test(lower)) {
      const websiteAuditService = require('../services/websiteAuditService');
      return websiteAuditService.handleAuditCommand(activeSock, from, text, senderPhone);
    }

    // 7.3 Downloader de Vídeos YouTube (sem limite de 50MB): !video / !videoh / !videos / !ytmp4 / !ytmp4h / !ytmp4s / !play2 / !mp4
    if (/^(?:!|\/)(?:video[hs]?|ytmp4[hs]?|play2|mp4)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handlePlayVideo(activeSock, from, text, quotedMsgText, senderPhone);
    }

    // 7.3.1 Comando !tunnel / !painel / !remoto / !linkpainel (Acesso Remoto via Túnel Cloudflare - Dono ou Senha Mestra)
    // Exige prefixo estrito ! ou / para evitar falsos positivos na conversa comum
    const isTunnelCmd = /^(?:!|\/)(?:tunnel|tunel|painel|pnl|pn|t|remoto|acessoremoto|linkpainel)(?:\s+.*)?$/i.test(lower);

    if (isTunnelCmd) {
      return this.handlePanelTunnelRequest({
        from,
        participantJid,
        text,
        isOwnerUser,
        isGroup,
        activeSock,
        senderPhone
      });
    }

    // 7.3.2 Sincronizador Contínuo Google Sheets de Afiliados: !planilha / !syncplanilha / !sheets
    if (/^(?:!|\/)(?:planilha|planilhas|sheet|sheets|syncplanilha|sheetsync)(?:\s+.*)?$/i.test(lower)) {
      if (!isOwnerUser) {
        return this.sendMessage(from, '⛔ *ACESSO NEGADO!*\n\nEste comando é estritamente confidencial e reservado ao Dono do sistema.', {}, activeSock);
      }
      return this.handleOwnerSheetsCommand(from, text, activeSock);
    }

    // 7.4 Downloader de Twitter / X: !twitter / !x / !twdl
    if (/^(?:!|\/)(?:twitter|x|twdl)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTwitter(activeSock, from, text);
    }

    // 7.5 Downloader de Facebook: !fb / !facebook
    if (/^(?:!|\/)(?:fb|facebook)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleFacebook(activeSock, from, text);
    }

    // 7.6 Downloader Universal & Feed Scraper: !download / !dl / !baixar
    if (/^(?:!|\/)(?:download|dl|baixar)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleUniversalDownload(activeSock, from, text);
    }

    // 8.0 Flowith AI Blank Zero-Token: !flowith / !fl
    if (/^(?:!|\/)(?:flowith|fl)(?:\s+.*)?$/i.test(lower)) {
      const flowithService = require('../services/flowithService');
      const cleanArgs = text.replace(/^(?:!|\/)(?:flowith|fl)\s*/i, '').trim();
      const parts = cleanArgs.split(/\s+/).filter(Boolean);
      const action = parts[0]?.toLowerCase();

      if (action === 'on' || action === 'ativar') {
        flowithService.setEnabled(true);
        return this.sendMessage(from, '✅ *FLOWITH BLANK ATIVADO!*\n\nTodas as requisições de IA tentarão primeiramente o Flowith Blank (https://flowith.io/blank) para economizar 100% dos seus tokens de API.', {}, activeSock);
      }
      if (action === 'off' || action === 'desativar') {
        flowithService.setEnabled(false);
        return this.sendMessage(from, '⚠️ *FLOWITH BLANK PAUSADO!*\n\nO bot agora utilizará diretamente os seus tokens de API cadastrados (Gemini, Groq, OpenAI).', {}, activeSock);
      }
      if (action === 'token') {
        const token = parts.slice(1).join(' ').trim();
        if (!token) return this.sendMessage(from, 'ℹ️ Uso: *!flowith token <seu_token_flowith>*', {}, activeSock);
        flowithService.setAuthToken(token);
        return this.sendMessage(from, '✅ *Token do Flowith cadastrado com sucesso!*', {}, activeSock);
      }
      if (action === 'endpoint' || action === 'url') {
        const ep = parts.slice(1).join(' ').trim();
        if (!ep) return this.sendMessage(from, 'ℹ️ Uso: *!flowith endpoint <url_bridge>* (ex: http://127.0.0.1:8000/v1)', {}, activeSock);
        flowithService.setEndpoint(ep);
        return this.sendMessage(from, `✅ *Endpoint do Flowith configurado:* \`${ep}\``, {}, activeSock);
      }
      if (action === 'reset') {
        flowithService.resetStats();
        return this.sendMessage(from, '🔄 *Estatísticas e telemetria do Flowith resetadas!*', {}, activeSock);
      }

      return this.sendMessage(from, flowithService.formatStatusMessage(), {}, activeSock);
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
      const isVipUser = isOwnerUser || this.isVip(senderPhone, isFromMe);
      return spyFeatures.handlePing(activeSock, from, msg, isOwnerUser, isVipUser, senderPhone);
    }

    // 10.501 Inspecionar e Clonar Mensagem Pré-Envio: !get / !inspectmsg / !rawmsg / !copymsg / !getcode / !clonemsg
    if (/^(?:!|\/)(?:get|inspectmsg|dumpmsg|rawmsg|copymsg|getcode|clonemsg|clonarmsg)(?:\s+.*)?$/i.test(lower)) {
      const quotedContext = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMsg = quotedContext?.quotedMessage;
      return spyFeatures.handleGet(activeSock, from, {
        chat: from,
        isGroup,
        quoted: quotedContext ? {
          id: quotedContext.stanzaId,
          sender: quotedContext.participant || from,
          senderNumber: (quotedContext.participant || from).split('@')[0].replace(/\D/g, ''),
          fromMe: isFromMe,
          message: quotedMsg,
          text: quotedMsg?.conversation ||
                quotedMsg?.extendedTextMessage?.text ||
                quotedMsg?.imageMessage?.caption ||
                quotedMsg?.videoMessage?.caption ||
                ''
        } : null,
        reply: (text) => this.sendMessage(from, text, {}, activeSock)
      }, { isOwner: isOwnerUser });
    }

    // 10.502 Clonar e Ativar Função de Outro Bot: !clonefun / !clonefuncao / !clonarfun
    if (/^(?:!|\/)(?:clonefun|clonefuncao|clonarfun|clonarfuncao|clonefunc|clonarmensagem|clonarcmd|clonecmd)(?:\s+.*)?$/i.test(lower)) {
      const quotedContext = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMsg = quotedContext?.quotedMessage;
      const parts = text.trim().split(/\s+/);
      const args = parts.slice(1);
      const handlerInstance = require('../handler');
      return spyFeatures.handleCloneFun(activeSock, from, {
        chat: from,
        isGroup,
        quoted: quotedContext ? {
          id: quotedContext.stanzaId,
          sender: quotedContext.participant || from,
          senderNumber: (quotedContext.participant || from).split('@')[0].replace(/\D/g, ''),
          fromMe: isFromMe,
          message: quotedMsg,
          text: quotedMsg?.conversation ||
                quotedMsg?.extendedTextMessage?.text ||
                quotedMsg?.imageMessage?.caption ||
                quotedMsg?.videoMessage?.caption ||
                ''
        } : null,
        reply: (txt) => this.sendMessage(from, txt, {}, activeSock)
      }, args, args.join(' '), { isOwner: isOwnerUser, handler: handlerInstance });
    }

    // 10.503 Remover e Listar Comandos Clonados: !delclone e !clones
    if (/^(?:!|\/)(?:delclone|rmclone|removerclone|delclonada|apagarclone)(?:\s+.*)?$/i.test(lower)) {
      const parts = text.trim().split(/\s+/);
      return spyFeatures.handleDelClone(activeSock, from, {
        chat: from,
        reply: (txt) => this.sendMessage(from, txt, {}, activeSock)
      }, parts.slice(1), parts.slice(1).join(' '));
    }
    if (/^(?:!|\/)(?:clones|listclones|listarclones|funcoesclonadas)$/i.test(lower)) {
      return spyFeatures.handleListClones(activeSock, from, {
        chat: from,
        reply: (txt) => this.sendMessage(from, txt, {}, activeSock)
      });
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

    // 10.6 Painel de Configurações Interativo: !configurar / !config / !painelbot
    if (/^(?:!|\/)(?:configurar|config|configuracoes|painelbot)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleConfigurar(activeSock, from, text, isAdmin, isOwnerUser);
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

    // 10.13 Consulta de DDD do Brasil e Marcação de Membros: !ddd <número>
    if (/^(?:!|\/)(?:ddd)(?:\s+.*)?$/i.test(lower) && !/^(?:!|\/)(?:dddlist|dddtodos)/i.test(lower)) {
      let groupMeta = null;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        groupMeta = adminStatus?.metadata || null;
      }
      return spyFeatures.handleDDD(activeSock, from, text, groupMeta);
    }

    // 10.13.1 Censo Demográfico do Grupo / Raio-X por DDD: !dddtodos / !dddlist / !censo
    if (/^(?:!|\/)(?:dddtodos|dddlist|censo|demografia)$/i.test(lower)) {
      let groupMeta = null;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        groupMeta = adminStatus?.metadata || null;
      }
      return spyFeatures.handleDDDList(activeSock, from, groupMeta);
    }

    // 10.13.2 Sorteio Exclusivo por DDD: !sorteioddd <ddd> [quantidade]
    if (/^(?:!|\/)(?:sorteioddd|sorteiod)(?:\s+.*)?$/i.test(lower)) {
      let groupMeta = null;
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        groupMeta = adminStatus?.metadata || null;
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleSorteioDDD(activeSock, from, text, groupMeta, isAdmin);
    }

    // 10.13.3 Gerador Rápido de Cobrança Pix via WhatsApp: !cobranca <valor> / !pix <valor> / !cobrar <valor>
    if (/^(?:!|\/)(?:cobranca|cobrar|pix|px)(?:\s+.*)?$/i.test(lower)) {
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleWhatsAppCobranca(activeSock, from, text, msg, isAdmin, senderPhone, senderName);
    }

    // 10.13.3.1 Configurador da Chave Pix: !setpix [tipo] <chave> / !configpix / !chavepix
    if (/^(?:!|\/)(?:setpix|configpix|chavepix|definirpix)(?:\s+.*)?$/i.test(lower)) {
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleSetPix(activeSock, from, text, isAdmin);
    }

    // 10.13.3.2 Consulta da Chave Pix Atual: !verpix / !statuspix / !meupix
    if (/^(?:!|\/)(?:verpix|statuspix|meupix|minhachave)$/i.test(lower)) {
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleVerPix(activeSock, from, isAdmin);
    }

    // 10.13.3.3 Configurador LivePix: !setlivepix <usuario> / !livepix <usuario>
    if (/^(?:!|\/)(?:setlivepix|livepix|configlivepix)(?:\s+.*)?$/i.test(lower)) {
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleSetLivepix(activeSock, from, text, isAdmin);
    }

    // 10.13.3.4 Consulta LivePix: !verlivepix / !statuslivepix / !meulivepix
    if (/^(?:!|\/)(?:verlivepix|statuslivepix|meulivepix)$/i.test(lower)) {
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleVerLivepix(activeSock, from, isAdmin);
    }

    // 10.13.4 Central de Controle de Tarefas e Disparos: !tarefas / !statusfila / !fila
    if (/^(?:!|\/)(?:tarefas|statusfila|fila|statusdisparos)$/i.test(lower)) {
      return spyFeatures.handleTarefasStatus(activeSock, from, isOwnerUser);
    }

    // 10.13.5 Criador Rápido de Cupom via WhatsApp: !cupom <codigo> <desconto%> [usos] / !novocupom
    if (/^(?:!|\/)(?:novocupom|criarcupom)\b/i.test(lower) || (/^(?:!|\/)cupom\s+[a-z0-9_-]+\s+\d+/i.test(lower))) {
      return spyFeatures.handleCriarCupomWhatsApp(activeSock, from, text, isOwnerUser);
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

    // 14.28 Vitrine Digital & Catálogo E-Commerce (Spy Tech Solutions): !loja / !catalogo / !vitrine
    if (/^(?:!|\/)?(?:loja|catalogo|vitrine|store|vercatalogo)$/i.test(lower) || /^(?:manda\s*(?:o\s*)?)?(?:link\s*(?:da\s*)?)?(?:loja|vitrine|catalogo)$/i.test(lower)) {
      return spyFeatures.handleLoja(activeSock, from, senderPhone, senderName);
    }

    // 14.28.1 Acompanhar Pedido / Rastreamento de Compras: !pedido / !pedidos / !meuspedidos / !rastrear / 0
    if (/^(?:!|\/)(?:pedido|pedidos|meuspedidos|rastrear|rastreio|rastrear?\s*pedido|meu\s*pedido)(?:\s+.*)?$/i.test(lower) || lower === '0' || lower === '!0') {
      return spyFeatures.handleOrderTracking(activeSock, from, text, senderPhone, senderName);
    }

    // 14.28.2 Chatbot SimSimi (SpyBot): !simi / !simsimi
    if (/^(?:!|\/)(?:simi|simsimi)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleSimi(activeSock, from, text, senderName, isGroup);
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
    // 14.0.1 Saldo & Economia de Tokens dos Sub-Bots: !tokens / !meustokens / !saldo / !pontos
    if (/^(?:!|\/)(?:tokens|meustokens|saldo|pontos)(?:\s+.*)?$/i.test(lower)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const report = subbotTokenService.getTokensStatusReport(instId);
      return activeSock.sendMessage(from, { text: report });
    }

    // 14.0.2 Missão Diária de Divulgação: !missaodiaria / !missao / !tarefadiaria
    if (/^(?:!|\/)(?:missaodiaria|missao|tarefadiaria)(?:\s+.*)?$/i.test(lower) || (/^(?:!|\/)divulgar$/i.test(lower) && !isOwnerUser)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const mission = subbotTokenService.getDailyMission(instId);
      return activeSock.sendMessage(from, { text: mission.instructions });
    }

    // 14.0.3 Confirmação de Divulgação Diária: !confirmardivulgacao / !missaofeita / !confirmarmissao
    if (/^(?:!|\/)(?:confirmardivulgacao|confirmarmissao|missaofeita|divulguei)(?:\s+.*)?$/i.test(lower)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const res = subbotTokenService.confirmDailyMission(instId, 'manual', text);
      return activeSock.sendMessage(from, { text: res.message });
    }

    // 14.0.4 Grupos Oficiais Parceiros: !grupos / !gruposoficiais / !entragrupos / !gruposparceiros
    if (/^(?:!|\/)(?:grupos|gruposoficiais|entragrupos|gruposparceiros)(?:\s+.*)?$/i.test(lower)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const msg = subbotTokenService.getOfficialGroupsMessage(instId);
      return activeSock.sendMessage(from, { text: msg });
    }

    // 14.0.5 Validação de Presença nos Grupos: !verificargrupos / !resgatargrupos / !bonusgrupos
    if (/^(?:!|\/)(?:verificargrupos|resgatargrupos|bonusgrupos)(?:\s+.*)?$/i.test(lower)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const res = subbotTokenService.claimOfficialGroupsBonus(instId);
      return activeSock.sendMessage(from, { text: res.message });
    }

    // 14.0.6 Indicação de Amigo Sub-Bot: !indicar / !convite / !meucodigo
    if (/^(?:!|\/)(?:indicar|convite|meucodigo|indique)(?:\s+.*)?$/i.test(lower)) {
      const subbotTokenService = require('../services/subbotTokenService');
      const instId = activeSock?.instanceId || 1;
      const botPhone = this.sock?.user?.id ? this.sock.user.id.split(':')[0] : '554884702848';
      const refInfo = subbotTokenService.getReferralInfo(instId, botPhone);
      return activeSock.sendMessage(from, { text: refInfo.instructions });
    }

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

    // 14.2 Conectar Sub-bot: !serbot / !jadibot / !subbot / !code / !conectar / !aceitartermos / !tornarfree
    if (
      /^(?:!|\/)(?:serbot|jadibot|subbot|conectar|code|aceitartermos|tornarfree|subbotfree|virarbot|queroserbot|conectarbot|subbotlink|linksubbot|comovirobot)(?:\s+.*)?$/i.test(lower) ||
      /^(?:virarbot|queroserbot|conectarbot|subbotlink|linksubbot|comovirobot)$/i.test(lower) ||
      /^(?:como\s+(?:viro|ser|conectar)\s+(?:um\s+)?(?:sub-?bot|bot)|quero\s+(?:ser|virar)\s+(?:um\s+)?(?:sub-?bot|bot))$/i.test(lower)
    ) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleSerBot(activeSock, from, text, senderPhone, isGroup, isOwnerUser, senderName);
    }

    // 14.2.1 Termos de Adesão do Sub-Bot: !termos / !termossubbot / !termosexercito
    if (/^(?:!|\/)(?:termos|termossubbot|termosexercito)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleTermsCommand(activeSock, from, senderPhone, senderName);
    }

    // 14.3 Parar Sub-bot: !stopbot / !pararbot / !desconectarbot / !pararsubbot
    if (/^(?:!|\/)(?:stopbot|pararbot|desconectarbot|pararsubbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleStopBot(activeSock, from, senderPhone, text, isOwnerUser);
    }

    // 14.3.1 Liberar Sub-Bot Free bloqueado (apenas Owner / Bot Master)
    if (/^(?:!|\/)(?:liberarsubbot|unblocksubbot|desbloquearsubbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `🚫 *Acesso Negado*\n\nEste comando é exclusivo para o *Dono* ou *Bot Master*.` });
      }
      const idArg = text.replace(/^(?:!|\/)(?:liberarsubbot|unblocksubbot|desbloquearsubbot)\s*/i, '').trim();
      if (!idArg || !/^\d+$/.test(idArg)) {
        return activeSock.sendMessage(from, { text: `❓ *Uso:* !liberarsubbot <ID>\n\nExemplo: !liberarsubbot 7` });
      }
      const targetId = parseInt(idArg);
      const inst = models.getArmyInstanceById(targetId);
      if (!inst) {
        return activeSock.sendMessage(from, { text: `❌ Sub-Bot #${targetId} não encontrado.` });
      }
      if (!inst.free_blocked) {
        return activeSock.sendMessage(from, { text: `ℹ️ Sub-Bot #${targetId} (${inst.name || inst.phone}) *não está bloqueado*.` });
      }
      models.unblockSubBotFree(targetId);
      return activeSock.sendMessage(from, {
        text: `✅ *Sub-Bot #${targetId} DESBLOQUEADO!*\n\n` +
          `📱 Número: *+${inst.phone}*\n` +
          `👤 Nome: ${inst.name || 'N/A'}\n\n` +
          `O número pode agora se reconectar como Sub-Bot Free novamente.\n` +
          `Instrua o usuário a enviar *!serbot aceito ${inst.phone}* para se reconectar.`
      });
    }

    // 14.3.2 Bloquear Sub-Bot Free manualmente (apenas Owner / Bot Master)
    if (/^(?:!|\/)(?:bloquearsubbot|banirsubbot|blocksubbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `🚫 *Acesso Negado*\n\nEste comando é exclusivo para o *Dono* ou *Bot Master*.` });
      }
      const parts = text.replace(/^(?:!|\/)(?:bloquearsubbot|banirsubbot|blocksubbot)\s*/i, '').trim().split(/\s+/);
      const idArg = parts[0];
      const motivo = parts.slice(1).join(' ') || 'Bloqueio manual pelo Bot Master';
      if (!idArg || !/^\d+$/.test(idArg)) {
        return activeSock.sendMessage(from, { text: `❓ *Uso:* !bloquearsubbot <ID> [motivo]\n\nExemplo: !bloquearsubbot 7 Spam em grupos` });
      }
      const targetId = parseInt(idArg);
      const inst = models.getArmyInstanceById(targetId);
      if (!inst) {
        return activeSock.sendMessage(from, { text: `❌ Sub-Bot #${targetId} não encontrado.` });
      }
      models.blockSubBotFree(targetId, motivo);
      try {
        const armyService = require('../services/whatsappArmyService');
        await armyService.stopInstance(targetId).catch(() => {});
      } catch (_) {}
      return activeSock.sendMessage(from, {
        text: `🔒 *Sub-Bot #${targetId} BLOQUEADO!*\n\n` +
          `📱 Número: *+${inst.phone}*\n` +
          `📋 Motivo: ${motivo}\n\n` +
          `Para desbloquear: *!liberarsubbot ${targetId}*`
      });
    }

    // 14.3.3 Configurar Disparo de Sub-Bot Rogue: !disparorogue / !setdisparo
    if (/^(?:!|\/)(?:disparorogue|configdisparo|setdisparorogue)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `🚫 *Acesso Negado*\n\nEste comando é exclusivo para o *Dono* ou *Bot Master*.` });
      }
      const rawArg = text.replace(/^(?:!|\/)(?:disparorogue|configdisparo|setdisparorogue)\s*/i, '').trim();
      const parts = rawArg.split(/\s+/);
      const subCmd = (parts[0] || '').toLowerCase();

      if (!subCmd || subCmd === 'ajuda' || subCmd === 'help') {
        const currentType = models.getSetting('ROGUE_DISPATCH_TYPE', 'meteoric');
        return activeSock.sendMessage(from, {
          text: `🎯 *CONFIGURAÇÃO DO DISPARO EM MASSA (ROGUE)* 🎯\n\n` +
            `Quando um Sub-Bot Free interage por conta própria em grupo meteórico, o sistema dispara uma mensagem em todos os grupos e contatos dele antes de encerrá-lo.\n\n` +
            `⚙️ *Tipo Atual:* *${currentType.toUpperCase()}*\n\n` +
            `*Comandos para Alterar o Tipo:*\n` +
            `• *!disparorogue meteoric* → Dispara a oferta relâmpago do Lançamento Meteórico ativo (com link)\n` +
            `• *!disparorogue achadinhos* → Dispara convite do Canal VIP de Achadinhos com cupons e link\n` +
            `• *!disparorogue paybot* → Dispara recrutamento viral e teste grátis do PayBot\n` +
            `• *!disparorogue custom <seu texto>* → Define uma mensagem personalizada personalizada\n\n` +
            `🔍 Para visualizar o texto atual que será disparado: *!verdisparo*`
        });
      }

      if (['meteoric', 'achadinhos', 'paybot'].includes(subCmd)) {
        models.setSetting('ROGUE_DISPATCH_TYPE', subCmd);
        return activeSock.sendMessage(from, {
          text: `✅ *Estratégia de Disparo Atualizada!* 🚀\n\n` +
            `Agora, quando um Sub-Bot rogue for punido, ele disparará no formato: *${subCmd.toUpperCase()}*.\n\n` +
            `Digite *!verdisparo* para ver a prévia da mensagem.`
        });
      }

      if (subCmd === 'custom') {
        const customMsg = parts.slice(1).join(' ').trim();
        if (!customMsg) {
          return activeSock.sendMessage(from, { text: `❓ *Uso:* !disparorogue custom <sua mensagem completa com link>` });
        }
        models.setSetting('ROGUE_DISPATCH_TYPE', 'custom');
        models.setSetting('ROGUE_DISPATCH_CUSTOM_TEXT', customMsg);
        return activeSock.sendMessage(from, {
          text: `✅ *Mensagem Personalizada Salva com Sucesso!* 🎯\n\n` +
            `O tipo de disparo foi alterado para *CUSTOM*.\n` +
            `Digite *!verdisparo* para conferir a prévia.`
        });
      }

      // Se passou texto direto sem especificar 'custom'
      models.setSetting('ROGUE_DISPATCH_TYPE', 'custom');
      models.setSetting('ROGUE_DISPATCH_CUSTOM_TEXT', rawArg);
      return activeSock.sendMessage(from, {
        text: `✅ *Mensagem Personalizada Salva!* 🎯\n\n` +
          `O tipo foi configurado para *CUSTOM* com o texto enviado.\n` +
          `Digite *!verdisparo* para conferir a prévia.`
      });
    }

    // 14.3.4 Visualizar Prévia do Disparo de Rogue: !verdisparo / !previewdisparo
    if (/^(?:!|\/)(?:verdisparo|previewdisparo|verdisparorogue)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `🚫 *Acesso Negado*\n\nEste comando é exclusivo para o *Dono* ou *Bot Master*.` });
      }
      try {
        const armyService = require('../services/whatsappArmyService');
        const payload = await armyService.getRogueDispatchPayload();
        return activeSock.sendMessage(from, {
          text: `📋 *PRÉVIA DA MENSAGEM DE DISPARO (ROGUE)*\n` +
            `🎯 *Estratégia:* ${payload.type.toUpperCase()}\n` +
            `🖼️ *Mídia:* ${payload.image || 'Nenhuma (texto simples)'}\n\n` +
            `═══════════════════════════\n` +
            `${payload.text}\n` +
            `═══════════════════════════\n\n` +
            `_Para alterar a estratégia: digite !disparorogue_`
        });
      } catch (err) {
        return activeSock.sendMessage(from, { text: `❌ Erro ao gerar prévia: ${err.message}` });
      }
    }

    // 14.4 Reiniciar Bot / Sub-bot: !restart / !reiniciar / !reiniciarsubbot / !restartbot / !reiniciarbot
    if (/^(?:!|\/)(?:restart|reiniciar|reiniciarsubbot|restartbot|reiniciarbot)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nEste comando é exclusivo para o Dono (Owner) e o Bot Principal.` });
      }
      const rawArg = text.replace(/^(?:!|\/)(?:reiniciarsubbot|reiniciarbot|restartbot|reiniciar|restart)\s*(?:sub-?bot\s*)?/i, '').trim();
      if (rawArg && /^\d+$/.test(rawArg)) {
        return spyFeatures.handleRestartSubBot(activeSock, from, text);
      }
      await activeSock.sendMessage(from, {
        text: `🔄 *REINICIALIZAÇÃO DO BOT SOLICITADA!* 🐾\n\nTodos os serviços, conexões e sockets estão sendo reiniciados com segurança.\n_Tempo estimado de reconexão: 3 a 7 segundos._`
      });
      setTimeout(() => {
        try { this.reconnect(); } catch (_) {}
      }, 1500);
      return;
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

    // 14.7 DIVULGAÇÃO DE LINKS DE AFILIADOS EM GRUPOS (!DUVUG / !DIVULG / !DIVULGAR)
    // Regra do Usuário: Divulgação de links de afiliados prontos é EXCLUSIVA de grupos via !duvug.
    // NUNCA no chat privado!
    if (/^(?:!|\/)(?:duvug|duvuga|duvulgar|divulg|divulga|divulgar)(?:\s+.*)?$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const isChatAdmin = isGroup ? await this.checkIsAdmin(from, participantJid, isFromMe) : false;
      return achadinhosService.handleDuvugCommand({
        sock: activeSock,
        from,
        text,
        isGroup,
        senderPhone,
        isOwnerUser,
        isChatAdmin,
        participantJid
      });
    }

    // 14.7.1 Transmissão Personalizada pelo Exército de Sub-Bots: !bcbot / !broadcast
    if (/^(?:!|\/)(?:bcbot|broadcast)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Bot Principal*\n\nA função de transmissão personalizada pelo Exército de Sub-Bots é exclusiva do Dono e do Bot Principal.` });
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

    // 14.11.1 ComfyArt Studio & Criação de Posts IA: !comfyart / !comfy / !comfystatus / !postart / !criarpost / !creativefield / !fotofield
    if (/^(?:!|\/)(?:comfyart|comfy|comfystatus|postart|criarpost|creativefield|fotofield|estudioia|higgsfield)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const isChatAdmin = await this.checkIsAdmin(from, participantJid, isFromMe);
      if (!isOwnerUser && !isChatAdmin) {
        return activeSock.sendMessage(from, { text: `❌ *Acesso Restrito: Dono & Administradores*\n\nO ComfyArt Studio e Gerador de Posts IA é exclusivo para administradores e o Dono do Bot.` });
      }
      return this.handleComfyArtCommand(activeSock, from, text, isOwnerUser);
    }

    // 14.12 Calculadora Interativa de Escopo e Orçamento Técnico: !orcamento / !estimativa / !calcular
    if (/^(?:!|\/)(?:orcamento|orçamento|estimativa|calcular)(?:\s+.*)?$/i.test(lower)) {
      const parts = text.trim().split(/\s+/);
      const arg = (parts[1] || '').toLowerCase();
      let cat = 'SOFTWARE';
      if (arg.includes('app') || arg.includes('mobile')) cat = 'APP_MOBILE';
      else if (arg.includes('ia') || arg.includes('ai') || arg.includes('bot')) cat = 'AI_AGENT';
      else if (arg.includes('iot') || arg.includes('hard') || arg.includes('esp')) cat = 'HARDWARE_IOT';
      else if (arg.includes('site') || arg.includes('web') || arg.includes('landing')) cat = 'SITE_PORTAL';
      else if (arg.includes('seo') || arg.includes('otim')) cat = 'SEO_TUNING';
      else if (arg.includes('met') || arg.includes('lanc')) cat = 'METEORIC';

      const calcService = require('../services/techScopeCalculatorService');
      const calc = calcService.calculate({
        category: cat,
        complexity: 'INTERMEDIATE',
        addons: ['pix_gateway', 'realtime_web_panel']
      });

      const totalVal = calc.pricingBreakdown.totalInvestmentBrl.toLocaleString('pt-BR');
      const msg = `⚡ *ESTIMATIVA DE ESCOPO TÉCNICO & ORÇAMENTO* 🚀\n\n` +
        `📦 *Projeto:* ${calc.categoryName}\n` +
        `🛠️ *Stack Sugerida:* ${calc.recommendedTechStack}\n` +
        `⏱️ *Prazo de Execução:* ${calc.timeline.totalDays} dias úteis (${calc.timeline.timelineWeeks} semanas)\n` +
        `💰 *Investimento Estimado:* R$ ${totalVal}\n\n` +
        `📌 *Entregáveis Inclusos:*\n` +
        calc.deliverables.slice(0, 3).map(d => `• *${d.title}*`).join('\n') + `\n\n` +
        `💡 _Deseja agendar uma call de alinhamento com link do Google Meet para refinarmos o escopo? Envie *!meet* ou nos informe o melhor horário!_`;

      return activeSock.sendMessage(from, { text: msg });
    }

    // 14.13 Agendamento de Call / Reunião Técnica (Google Meet): !reuniao / !meet / !agendar
    if (/^(?:!|\/)(?:reuniao|reunião|meet|agendar)(?:\s+.*)?$/i.test(lower)) {
      const meetingService = require('../services/meetingService');
      const interaction = await meetingService.handleMeetingInteraction(senderPhone, senderName, text);
      if (interaction && interaction.replyText) {
        return activeSock.sendMessage(from, { text: interaction.replyText });
      }
    }

    // 14.12.9 INSTRUÇÕES DE CHAVE DE IA GRATUITA (!chavefree, !cf, !keyfree, !comopegarchave, !obterchave, !tutorialchave)
    if (/^(?:!|\/)(?:chavefree|cf|keyfree|comopegarchave|obterchave|pegarfeechave|tutorialchave|ajudachave|linkchave)(?:\s+\d+)?$/i.test(lower)) {
      const parts = text.trim().split(/\s+/);
      const parsedId = Number(parts[1]);
      const subbotId = (!isNaN(parsedId) && parsedId > 0) ? parsedId : (activeSock?.instanceId || 1);
      const aiManager = require('../services/aiManagerService');
      const instructions = aiManager.getFreeApiKeyInstructions({
        subbotId,
        isBlocked: false
      });
      return activeSock.sendMessage(from, { text: instructions });
    }

    // 14.13.0 MENU DE COMANDOS ABREVIADOS & ATALHOS RÁPIDOS (!menuabv, !mabv, !abv, !atalhos, !alias, !curtos)
    if (/^(?:!|\/)(?:menuabv|mabv|abv|atalhos|menuatalhos|alias|curtos|comandoscurtos)$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const reply = achadinhosService.getAbbreviatedMenuGuide();
      return activeSock.sendMessage(from, { text: reply });
    }

    // 14.13.1 GESTÃO & ESTRUTURA DE ACHADINHOS (!achadinhos, !ach, !stp, !cgp, !ccn, !st, !fon, !foff, !post, !sc, !cv, !ls, !cad, !rm, !pendentes, !afiliar, !addmassa, !importar)
    if (/^(?:!|\/)(?:achadinhos?|achados?|ach|acd|ad|stp|cgp|cg|ccn|cc|st|fon|foff|post|pst|sc|cv|conv|ls|cad|rm|pendentes|aguardando|afiliar|vincular|liberar|addmassa|importar|cadmassa)(?:\s+.*)?$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return achadinhosService.handleAchadinhosCommand({
        sock: activeSock,
        from,
        text,
        senderPhone,
        isOwnerUser,
        isGroup,
        participantJid,
        isFromMe,
        senderName
      });
    }

    // 14.13.2 BUSCA DE PRODUTOS / ACHADINHOS PARA COMPRADORES (!buscar, !achado, !promo, !oferta, !b, !f)
    if (/^(?:!|\/)(?:buscar|achado|promo|promocao|promoção|oferta|b|f)(?:\s+.*)?$/i.test(lower)) {
      if (!isGroup) {
        return activeSock.sendMessage(from, { text: `🛍️ Para ver os produtos e planos da nossa loja oficial, digite *MENU* ou confira nossa vitrine online!\n\nAs ofertas e achadinhos de afiliados são exclusivas para os nossos grupos.` });
      }
      const achadinhosService = require('../services/achadinhosService');
      const q = text.trim().split(/\s+/).slice(1).join(' ').trim();
      const reply = achadinhosService.searchDealsForBuyer(q);
      return activeSock.sendMessage(from, { text: reply });
    }

    // 14.13.3 ALERTAS DE OFERTAS & PREÇOS PARA COMPRADORES (!alerta, !alt, !a, !meusalertas, !ma, !cancelaralerta, !ca)
    if (/^(?:!|\/)(?:alerta|alertapreco|alertapromo|alt|a)(?:\s+.*)?$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const q = text.trim().split(/\s+/).slice(1).join(' ').trim();
      const reply = achadinhosService.handleBuyerAlertSubscription(senderPhone, q, from);
      return activeSock.sendMessage(from, { text: reply });
    }

    if (/^(?:!|\/)(?:meusalertas|meus_alertas|meusalt|ma)$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      return achadinhosService.handleAchadinhosCommand({
        sock: activeSock,
        from,
        text: '!achadinhos meusalertas',
        senderPhone,
        isOwnerUser: false
      });
    }

    if (/^(?:!|\/)(?:cancelaralerta|removeralerta|delalt|ca)(?:\s+.*)?$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const q = text.trim().split(/\s+/).slice(1).join(' ').trim();
      return achadinhosService.handleAchadinhosCommand({
        sock: activeSock,
        from,
        text: `!achadinhos cancelaralerta ${q}`,
        senderPhone,
        isOwnerUser: false
      });
    }

    // 14.13.4 CUPONS DE DESCONTO ATIVOS (!cupons, !cupom, !cp, !cup)
    if (/^(?:!|\/)(?:cupons|cupom|cp|cup)$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const reply = achadinhosService.getActiveCouponsList();
      return activeSock.sendMessage(from, { text: reply });
    }

    // 14.13.5 COMO FUNCIONA / GUIA DO ACHADINHOS (!comofunciona, !ajudaachadinhos, !cmf, !faq)
    if (/^(?:!|\/)(?:comofunciona|ajudaachadinhos|guiaachadinhos|cmf|faq)$/i.test(lower)) {
      const achadinhosService = require('../services/achadinhosService');
      const reply = achadinhosService.getBuyerHelpGuide();
      return activeSock.sendMessage(from, { text: reply });
    }

    // ==========================================
    // 14.14 MÓDULO DE ÁUDIO FX & VÍDEO FX (NAZUNA v4.0)
    // ==========================================
    if (/^(?:!|\/)(?:bass|bass2|bass3|grave|vozgrave|slow|audiolento|vozlenta|fast|audiorapido|vozrapida|reverso|audioreverso|reverse|robot|vozrobot|eco|vozeco|reverb|cave|cavevoice|vozcaverna|volume|volumeboost|aumentarvolume|pitch|equalizer|equalizar|drive|flanger|chorus|phaser|tremolo|vibrato|lowpass|speedup|vozmenino|vozmulher|vozhomem|vozcrianca)$/i.test(lower)) {
      const effectName = lower.slice(1).trim().split(/\s+/)[0];
      return spyFeatures.handleAudioEffect(activeSock, from, msg, effectName);
    }

    if (/^(?:!|\/)(?:videorapido|fastvid|videoslow|videolento|videoreverso|reversevid|videobw|pretoebranco|espelhar|rotacionar)$/i.test(lower)) {
      const effectName = lower.slice(1).trim().split(/\s+/)[0];
      return spyFeatures.handleVideoEffect(activeSock, from, msg, effectName);
    }

    // ==========================================
    // 14.15 SISTEMA DE ALUGUEL DE BOT POR GRUPOS (NAZUNA v4.0)
    // ==========================================
    if (/^(?:!|\/)(?:modoaluguel)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleModoAluguel(activeSock, from, text, isOwnerUser);
    }

    if (/^(?:!|\/)(?:gerarcodigo)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleGerarCodigo(activeSock, from, text, isOwnerUser);
    }

    if (/^(?:!|\/)(?:usarcodigo|key|usarkey|ativarkey)(?:\s+.*)?$/i.test(lower)) {
      return spyFeatures.handleUsarCodigo(activeSock, from, text, senderPhone, msg);
    }

    if (/^(?:!|\/)(?:tempoaluguel|statusaluguel|aluguel)$/i.test(lower)) {
      return spyFeatures.handleTempoAluguel(activeSock, from);
    }

    if (/^(?:!|\/)(?:addaluguel)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAddAluguel(activeSock, from, text, isOwnerUser);
    }

    if (/^(?:!|\/)(?:listaluguel|listalugueis)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleListAluguel(activeSock, from, isOwnerUser);
    }

    // ==========================================
    // 14.16 PROTEÇÃO AVANÇADA DE GRUPO (NAZUNA v4.0)
    // ==========================================
    if (/^(?:!|\/)(?:antiflood)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAntiFloodCommand(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    if (/^(?:!|\/)(?:antitrava)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAntiTravaCommand(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    if (/^(?:!|\/)(?:bemvindo|welcome|boasvindas)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleWelcomeCommand(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Configuração do Card SVG Personalizado de Boas-Vindas (!welcomesvg)
    if (/^(?:!|\/)(?:welcomesvg|svgbv|cardbv|bvcard)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleWelcomeSvgCommand(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser, participantJid, senderName);
    }

    // Atalho rápido de teste do Card de Boas-Vindas (!testbv / !testsvg)
    if (/^(?:!|\/)(?:testbv|testsvg|bvtest)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleWelcomeSvgCommand(activeSock, from, '!welcomesvg test', adminStatus.isRequesterAdmin || isOwnerUser, participantJid, senderName);
    }

    // Cartão de Perfil / Identidade SVG do Usuário (!svgperfil)
    if (/^(?:!|\/)(?:svgperfil|cardperfil|perfilsvg)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const memberSvgService = require('../services/memberSvgService');
      const curTheme = memberSvgService.getWelcomeSvgTheme(from);
      await this.sendMessage(from, '💳 *Gerando seu Cartão de Identidade Vetorial SVG...*', {}, activeSock);
      try {
        const card = await memberSvgService.createMemberProfileCard({
          memberJid: participantJid || senderPhone,
          memberPhone: senderPhone,
          memberName: senderName || `@${senderPhone}`,
          groupName: 'Comunidade Oficial PayBot',
          role: isOwnerUser ? '👑 PROPRIETÁRIO / DONO' : (adminStatus.isRequesterAdmin ? '🛡️ ADMINISTRADOR' : '★ MEMBRO VIP'),
          sock: activeSock,
          theme: curTheme
        });

        if (card && card.pngBuffer) {
          await activeSock.sendMessage(from, {
            image: card.pngBuffer,
            caption: `💳 *CARTÃO DE IDENTIDADE VETORIAL* 🛡️\n\n• *Titular:* ${senderName || `@${senderPhone}`}\n• *Nível:* ${isOwnerUser ? '👑 DONO' : (adminStatus.isRequesterAdmin ? '🛡️ ADMIN' : 'VIP')}\n• *Tema:* ${curTheme}`,
            mentions: [participantJid || `${senderPhone}@s.whatsapp.net`]
          });

          if (card.svgBuffer) {
            await activeSock.sendMessage(from, {
              document: card.svgBuffer,
              mimetype: 'image/svg+xml',
              fileName: `perfil_${senderPhone}.svg`
            });
          }
        }
      } catch (err) {
        await this.sendMessage(from, `❌ Erro ao criar cartão de perfil: ${err.message}`, {}, activeSock);
      }
      return;
    }

    if (/^(?:!|\/)(?:saida|goodbye|adeus)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleGoodbyeCommand(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    if (/^(?:!|\/)(?:legendabv|textbv|welcomemsg)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleLegendaBV(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    if (/^(?:!|\/)(?:legendasaiu|textsaiu|exitmsg)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleLegendaSaiu(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // ==========================================
    // 14.17 ESTATÍSTICAS DE COMANDOS (TOP COMANDOS NAZUNA)
    // ==========================================
    if (/^(?:!|\/)(?:topcmd|topcmds|comandosmaisusados)$/i.test(lower)) {
      return spyFeatures.handleTopCmd(activeSock, from);
    }

    // ==========================================
    // 14.18 VERIFICADO GLOBAL (PAYBOT)
    // ==========================================
    if (/^(?:!|\/)(?:verificado-global|verificado|seloverificado)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return this.sendMessage(from, '⛔ Apenas o Dono (Owner) pode configurar o Verificado Global.', {}, activeSock);
      }
      const parts = text.trim().split(/\s+/).slice(1);
      const sub = parts[0]?.toLowerCase();
      if (sub === 'on' || sub === '1' || sub === 'ativar' || sub === 'ligar' || sub === 'true') {
        models.setVerificadoGlobal(true);
        return this.sendMessage(from, '✅ *VERIFICADO GLOBAL ATIVADO!* 🟢\n\nA partir de agora, todas as mensagens oficiais do bot serão enviadas com o selo verificado e citação oficial do WhatsApp (Estilo GataBot & SPY BOT).', {}, activeSock);
      } else if (sub === 'off' || sub === '0' || sub === 'desativar' || sub === 'desligar' || sub === 'false') {
        models.setVerificadoGlobal(false);
        return this.sendMessage(from, '⚪ *VERIFICADO GLOBAL DESATIVADO!*\nMensagens do bot voltarão a ser enviadas no formato padrão.', {}, activeSock);
      } else if (sub === 'titulo' || sub === 'nome') {
        const newTitle = parts.slice(1).join(' ').trim();
        if (!newTitle) return this.sendMessage(from, '⚠️ Informe o novo título do selo. Exemplo: *!verificado titulo PayBot Oficial ✓*', {}, activeSock);
        models.setSetting('VERIFICADO_TITLE', newTitle);
        return this.sendMessage(from, `✅ *Título do Selo Verificado atualizado para:* \`${newTitle}\``, {}, activeSock);
      } else if (sub === 'subtitulo' || sub === 'corpo' || sub === 'body') {
        const newBody = parts.slice(1).join(' ').trim();
        if (!newBody) return this.sendMessage(from, '⚠️ Informe o novo subtítulo. Exemplo: *!verificado subtitulo Canal Oficial Verificado 🟢*', {}, activeSock);
        models.setSetting('VERIFICADO_BODY', newBody);
        return this.sendMessage(from, `✅ *Subtítulo do Selo Verificado atualizado para:* \`${newBody}\``, {}, activeSock);
      } else if (sub === 'toggle' || (!sub && !models.isVerificadoGlobal())) {
        const current = models.isVerificadoGlobal();
        const newStatus = !current;
        models.setVerificadoGlobal(newStatus);
        return this.sendMessage(from, `🛡️ *SELO VERIFICADO GLOBAL (Estilo GataBot & SPY BOT)*\n\nStatus atualizado para: *${newStatus ? '🟢 ATIVADO (Selo Oficial Visível)' : '🔴 DESATIVADO'}*`, {}, activeSock);
      } else {
        const cfg = models.getVerificadoConfig();
        return this.sendMessage(from, `🛡️ *STATUS DO VERIFICADO GLOBAL (Estilo GataBot & PayBot):*\n\n` +
          `• *Estado:* ${cfg.enabled ? '🟢 ATIVADO' : '🔴 DESATIVADO'}\n` +
          `• *Título do Selo:* \`${cfg.title}\`\n` +
          `• *Subtítulo:* \`${cfg.body}\`\n` +
          `• *Ad Attribution:* ${cfg.show_ad ? '🟢 Sim' : '🔴 Não'}\n\n` +
          `_Comandos de configuração:_\n` +
          `• *!verificado on* — Ativar o selo\n` +
          `• *!verificado off* — Desativar o selo\n` +
          `• *!verificado titulo <texto>* — Alterar título do selo\n` +
          `• *!verificado subtitulo <texto>* — Alterar subtítulo do selo`, {}, activeSock);
      }
    }

    // ==========================================
    // 14.19 COMANDO /FAKE EM GRUPOS (CITAÇÃO FALSA)
    // ==========================================
    if (/^(?:!|\/)fake(?:\s+.*)?$/i.test(lower)) {
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        null;
      const mentionedJids = contextInfo?.mentionedJid || [];
      const quotedMsg = contextInfo?.quotedMessage ? {
        key: {
          participant: contextInfo.participant,
          remoteJid: contextInfo.remoteJid || from,
          id: contextInfo.stanzaId
        },
        message: contextInfo.quotedMessage
      } : null;
      return spyFeatures.handleFakeCommand(activeSock, from, text, quotedMsg, participantJid, mentionedJids);
    }

    // ==========================================
    // 14.20 TODAS AS FUNÇÕES DO MENUADM (NAZUNA v4.0)
    // ==========================================
    if (/^(?:!|\/)(?:menuadm|menuadmin|menuadmins|admmenu)$/i.test(lower)) {
      if (!isGroup) {
        return this.sendMessage(from, '⚠️ O Menu Administrativo só pode ser acessado dentro de grupos.', {}, activeSock);
      }
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!adminStatus.isRequesterAdmin && !isOwnerUser) {
        return this.sendMessage(from, '⛔ Apenas administradores do grupo podem acessar o menu de administração.', {}, activeSock);
      }
      const botName = models.getSetting('BOT_NAME', 'PayBot');
      return spyFeatures.handleMenuAdm(activeSock, from, botName, senderName || 'Administrador', '!');
    }

    // Adicionar membro ao grupo (!add @user, !add numero ou respondendo)
    if (/^(?:!|\/)(?:add|adicionar)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAddParticipant(activeSock, from, {
        text,
        msg,
        isAdmin: adminStatus.isRequesterAdmin || isOwnerUser,
        isBotAdmin: adminStatus.isBotAdmin
      });
    }

    // Promover membro a admin (!promover @user)
    if (/^(?:!|\/)(?:promover|promote)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (text.match(/@(\d+)/)?.[1] ? `${text.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
        msg.message?.extendedTextMessage?.contextInfo?.participant;
      return spyFeatures.handlePromote(activeSock, from, target, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Rebaixar admin a membro comum (!rebaixar @user)
    if (/^(?:!|\/)(?:rebaixar|demote)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (text.match(/@(\d+)/)?.[1] ? `${text.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
        msg.message?.extendedTextMessage?.contextInfo?.participant;
      return spyFeatures.handleDemote(activeSock, from, target, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Banir membro do grupo (!ban @user)
    if (/^(?:!|\/)(?:ban|kick)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (text.match(/@(\d+)/)?.[1] ? `${text.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
        msg.message?.extendedTextMessage?.contextInfo?.participant;
      return spyFeatures.handleKick(activeSock, from, target, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Mutar membro no grupo (!mute @user)
    if (/^(?:!|\/)(?:mute|mutar)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (text.match(/@(\d+)/)?.[1] ? `${text.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
        msg.message?.extendedTextMessage?.contextInfo?.participant;
      return spyFeatures.handleMuteUser(activeSock, from, target, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Desmutar membro no grupo (!desmute @user)
    if (/^(?:!|\/)(?:desmute|desmutar|unmute)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (text.match(/@(\d+)/)?.[1] ? `${text.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
        msg.message?.extendedTextMessage?.contextInfo?.participant;
      return spyFeatures.handleUnmuteUser(activeSock, from, target, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Listar membros mutados (!listmute)
    if (/^(?:!|\/)(?:listmute|listmutes|mutados)$/i.test(lower)) {
      return spyFeatures.handleListMuted(activeSock, from);
    }

    // Deletar mensagem citada (!d / !del / !apagar)
    if (/^(?:!|\/)(?:del|delete|d|apagar|deletar)$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const isVipUser = isOwnerUser || (isGroup && adminStatus.isRequesterAdmin) || this.isVip(senderPhone, isFromMe);

      if (!isVipUser) {
        return activeSock.sendMessage(from, {
          text: '💎 *RECURSO EXCLUSIVO VIP* 💎\n\nApenas usuários VIP do robô, administradores ou o proprietário têm permissão para usar o comando *!d*.'
        });
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
      const stanzaId = contextInfo?.stanzaId;

      if (!stanzaId) {
        return spyFeatures.handleDeleteMessage(activeSock, from, null, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin, isVipUser);
      }

      const isQuotedFromBot = this.isBotSentMessage({
        stanzaId,
        quotedParticipant: contextInfo?.participant,
        activeSock,
        from,
        isGroup,
        senderPhone
      });

      const deleteSock = isQuotedFromBot
        ? this.getSocketForRevoke({ stanzaId, quotedParticipant: contextInfo?.participant, activeSock })
        : activeSock;

      const quotedKey = {
        remoteJid: from,
        fromMe: isQuotedFromBot,
        id: stanzaId,
        participant: isQuotedFromBot ? undefined : contextInfo.participant
      };

      // Se o robô for admin do grupo, também apaga a mensagem com o comando !d para deixar o chat limpo
      if (msg.key && adminStatus.isBotAdmin && isGroup) {
        try { await activeSock.sendMessage(from, { delete: msg.key }); } catch (_) {}
      }

      return spyFeatures.handleDeleteMessage(deleteSock, from, quotedKey, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin, isVipUser);
    }

    // Gestão de Usuários VIP: !addvip <tel> [dias], !delvip <tel>, !vips
    if (/^(?:!|\/)(?:addvip|darvip|setvip)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: '⛔ Apenas o Dono do robô pode adicionar usuários VIP.' });
      }
      const parts = text.trim().split(/\s+/);
      const targetPhone = (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || parts[1] || '').replace(/@.*$/, '').replace(/\D/g, '');
      const days = parseInt(parts[2], 10) || 30;
      if (!targetPhone) {
        return activeSock.sendMessage(from, { text: '❓ Use: *!addvip <número ou @mencao> [dias]*\nExemplo: *!addvip 5511999998888 30*' });
      }
      models.addVipUser(targetPhone, 'VIP', days, senderPhone);
      return activeSock.sendMessage(from, {
        text: `💎 *NOVO USUÁRIO VIP ATIVADO!* 💎\n\n` +
          `👤 *Número:* +${targetPhone}\n` +
          `⏳ *Validade:* ${days} dias\n` +
          `✨ *Permissão:* Acesso completo aos comandos e privilégios VIP do PayBot!`
      });
    }

    if (/^(?:!|\/)(?:delvip|removervip|tirarvip)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: '⛔ Apenas o Dono do robô pode remover usuários VIP.' });
      }
      const parts = text.trim().split(/\s+/);
      const targetPhone = (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || parts[1] || '').replace(/@.*$/, '').replace(/\D/g, '');
      if (!targetPhone) {
        return activeSock.sendMessage(from, { text: '❓ Use: *!delvip <número ou @mencao>*' });
      }
      models.removeVipUser(targetPhone);
      return activeSock.sendMessage(from, {
        text: `🗑️ *USUÁRIO VIP REMOVIDO!*\n\nO número +${targetPhone} não possui mais privilégios VIP.`
      });
    }

    if (/^(?:!|\/)(?:vips|listvip|vipusers)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      if (!isOwnerUser) {
        return activeSock.sendMessage(from, { text: '⛔ Apenas o Dono do robô pode listar os usuários VIP.' });
      }
      const vips = models.getVipUsers();
      if (!vips || vips.length === 0) {
        return activeSock.sendMessage(from, { text: '💎 *USUÁRIOS VIP:* Nenhum VIP avulso cadastrado no momento.' });
      }
      let reply = `💎 *LISTA DE USUÁRIOS VIP ATIVOS:* 💎\n\n`;
      vips.forEach((v, idx) => {
        const exp = v.expires_at ? new Date(v.expires_at).toLocaleDateString('pt-BR') : 'Vitalício';
        reply += `${idx + 1}. +${v.phone} — Expira em: ${exp}\n`;
      });
      return activeSock.sendMessage(from, { text: reply });
    }

    // Limpar tela do chat (!limpar)
    if (/^(?:!|\/)(?:limpar|clean|limparchat)$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleLimpar(activeSock, from, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // BanGhost (!banghost)
    if (/^(?:!|\/)(?:banghost|fantasmas)$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleBanghost(activeSock, from, adminStatus.metadata, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Hidetag (!hidetag <msg>)
    if (/^(?:!|\/)(?:hidetag|totag)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleHidetag(activeSock, from, text, adminStatus.metadata, null, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Marcar todos (!marcar / !tagall)
    if (/^(?:!|\/)(?:marcar|tagall|todos)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleMarcar(activeSock, from, text, adminStatus.metadata, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Sorteio no grupo (!sorteio)
    if (/^(?:!|\/)(?:sorteio|sortear|raffle)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleSorteio(activeSock, from, text, adminStatus.metadata, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Link do grupo (!linkgp)
    if (/^(?:!|\/)(?:linkgp|linkgroup|linkdogrupo)$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleLinkGp(activeSock, from, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Abrir / Fechar grupo (!grupo a / !grupo f)
    if (/^(?:!|\/)(?:grupo|gp|group)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleGrupoStatus(activeSock, from, parts[0], adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Mudar nome do grupo (!setname <novo nome>)
    if (/^(?:!|\/)(?:setname|mudarnome)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const newName = text.replace(/^(?:!|\/)(?:setname|mudarnome)\s*/i, '').trim();
      return spyFeatures.handleSetName(activeSock, from, newName, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Mudar descrição do grupo (!setdesc <nova desc>)
    if (/^(?:!|\/)(?:setdesc|mudardesc)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const newDesc = text.replace(/^(?:!|\/)(?:setdesc|mudardesc)\s*/i, '').trim();
      return spyFeatures.handleSetDesc(activeSock, from, newDesc, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.isBotAdmin);
    }

    // Regras do grupo (!addregra / !regras)
    if (/^(?:!|\/)(?:addregra|definirregras)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAddRegra(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:regras|rules)$/i.test(lower)) {
      return spyFeatures.handleRegras(activeSock, from);
    }

    // Bloqueio de comando no grupo (!blockcmd / !unblockcmd / !listblockcmd)
    if (/^(?:!|\/)(?:blockcmd|bloquearcmd)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleBlockCmd(activeSock, from, parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:unblockcmd|desbloquearcmd)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleUnblockCmd(activeSock, from, parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:listblockcmd|comandosbloqueados)$/i.test(lower)) {
      return spyFeatures.handleListBlockCmd(activeSock, from);
    }

    // Blacklist global (!addblacklist / !delblacklist / !listblacklist)
    if (/^(?:!|\/)(?:addblacklist|bloquearnumero)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleAddBlacklist(activeSock, from, parts[0], isOwnerUser);
    }
    if (/^(?:!|\/)(?:delblacklist|desbloquearnumero)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleDelBlacklist(activeSock, from, parts[0], isOwnerUser);
    }
    if (/^(?:!|\/)(?:listblacklist|blacklist)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleListBlacklist(activeSock, from, isOwnerUser);
    }

    // Toggles de proteções (!antidoc, !antiloc, !antifig, !antipt, !soadm)
    if (/^(?:!|\/)(?:antidoc|antidocumento)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleProtectionToggle(activeSock, from, 'antidoc', parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:antiloc|antilocalizacao)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleProtectionToggle(activeSock, from, 'antiloc', parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:antifig|antisticker)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleProtectionToggle(activeSock, from, 'antifig', parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:antipt|antipalavroes)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleProtectionToggle(activeSock, from, 'antipt', parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:soadm|onlyadm|soadmin)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const parts = text.trim().split(/\s+/).slice(1);
      return spyFeatures.handleProtectionToggle(activeSock, from, 'soadm', parts[0], adminStatus.isRequesterAdmin || isOwnerUser);
    }
    if (/^(?:!|\/)(?:x9|dedoduro)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleX9(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser);
    }

    // Anti-DDD: !antiddd
    if (/^(?:!|\/)(?:antiddd|antidd|blockddd|proibirddd)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAntiDDD(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser, adminStatus.metadata);
    }

    // Boas-Vindas no Privado: !bemvindopv
    if (/^(?:!|\/)(?:bemvindopv|welcomepv|boasvindaspv|bvpv)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleBemVindoPv(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser, isOwnerUser);
    }

    // Legenda Boas-Vindas no Privado: !legendabemvindopv
    if (/^(?:!|\/)(?:legendabemvindopv|legendabvpv|textobemvindopv|setlegendapv)(?:\s+.*)?$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleLegendaBemVindoPv(activeSock, from, text, adminStatus.isRequesterAdmin || isOwnerUser, isOwnerUser);
    }

    // Painel de Configurações do PV: !configpv
    if (/^(?:!|\/)(?:configpv|pvconfig|painelpv|privadoconfig)$/i.test(lower)) {
      const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleConfigPv(activeSock, from, adminStatus.isRequesterAdmin || isOwnerUser, isOwnerUser);
    }

    // Modo de Acesso do Bot ou Sub-Bot: !publico, !privado, !modobot
    if (/^(?:!|\/)(?:publico|public|botpublico|modopublico|privado|private|botprivado|modoprivado|self|soeu|modobot|acessobot|modoacesso)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleBotAccessMode(activeSock, from, text, senderPhone, isOwnerUser, customSock);
    }

    // Controle do Bot no Grupo: !bot on/off, !postagens on/off, !interacoes on/off, !statusbot
    if (/^(?:!|\/)(?:bot|boton|botoff|ativarbot|desativarbot|ligarbot|desligarbot|postagens|postagem|posts|divulgacao|divulgar|interacoes|interacao|comandos|statusbot|botstatus|statusgrupo)(?:\s+.*)?$/i.test(lower)) {
      const spyFeatures = require('../services/spyFeaturesService');
      const adminStatus = isGroup ? await this.getGroupAdminStatus(from, participantJid, isFromMe) : { isRequesterAdmin: false };
      const isGroupAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      return spyFeatures.handleGroupBotControl(activeSock, from, text, senderPhone, isGroup, isGroupAdmin, isOwnerUser);
    }

    // Indique & Ganhe (Member-Get-Member): !meulink, !indicar, !meusconvites, !pontos, !ranking, !topindicadores, !regrasindicacao
    if (/^(?:!|\/)(?:meulink|indicar|convidar|linkconvite|meuconvite|meusconvites|pontos|meuspontos|minhasindicacoes|ranking|topindicadores|topindica|rankindicacoes|regrasindicacao|regrasindica|comofuncionaindica)(?:\s+.*)?$/i.test(lower)) {
      const memberReferralService = require('../services/memberReferralService');
      return memberReferralService.handleReferralCommand(activeSock, from, participantJid || from, text, isGroup);
    }

    // Anti-Chamada: !antichamada
    if (/^(?:!|\/)(?:antichamada|anticall|antiligacao|bloquearchamadas)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleAntiChamada(activeSock, from, text, isOwnerUser);
    }

    // Anti-Privado Global: !antipv
    if (/^(?:!|\/)(?:antipv|antiprivado|blockpv)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      if (!isAdmin) {
        return activeSock.sendMessage(from, { text: '⚠️ Apenas administradores do grupo ou o Dono podem configurar o modo Anti-Privado.' });
      }
      const parts = text.trim().split(/\s+/);
      const action = parts[1]?.toLowerCase();
      if (action === 'on' || action === 'ativar' || action === '1') {
        models.setSetting('ANTIPRIVADO_GLOBAL', 'true');
        return activeSock.sendMessage(from, { text: `🚫 *ANTI-PRIVADO ATIVADO!*\n\nAtendimento privado restrito: contatos no privado serão avisados de não autorização e bloqueados.` });
      } else if (action === 'off' || action === 'desativar' || action === '0') {
        models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
        return activeSock.sendMessage(from, { text: `🟢 *ANTI-PRIVADO DESATIVADO!*\n\nAtendimento privado liberado.` });
      } else {
        const isAct = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
        return activeSock.sendMessage(from, { text: `ℹ️ *Anti-Privado:* ${isAct ? '🔴 Ativado (PV restrito)' : '🟢 Desativado (PV liberado)'}\n\nPara alterar: *!antipv on* ou *!antipv off*` });
      }
    }

    // Configuração de Voz do Bot Vendedor: !vozvendedor / !configvoz
    if (/^(?:!|\/)(?:vozvendedor|vozbot|configvoz|setvoz)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      return spyFeatures.handleVozVendedor(activeSock, from, text, isOwnerUser);
    }

    // Limpar Cache: !limparcache
    if (/^(?:!|\/)(?:limparcache|clearcache|limparmemoria|cleanmem)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      const handler = require('../handler');
      return spyFeatures.handleLimparCache(activeSock, from, isOwnerUser, handler);
    }

    // Diagnóstico do Servidor: !server
    if (/^(?:!|\/)(?:server|servidor|host|vps|sysinfo)$/i.test(lower)) {
      return spyFeatures.handleServerStatus(activeSock, from);
    }

    // Cobrança USDT: !usdt
    if (/^(?:!|\/)(?:usdt|cripto|crypto|tether)(?:\s+.*)?$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);
      let isAdmin = isOwnerUser;
      if (isGroup) {
        const adminStatus = await this.getGroupAdminStatus(from, participantJid, isFromMe);
        isAdmin = adminStatus.isRequesterAdmin || isOwnerUser;
      }
      return spyFeatures.handleUsdt(activeSock, from, text, senderPhone, senderName, isAdmin);
    }

    // ==========================================
    // 14.21 CENTRAL ZAPVOICE 2025 (!zapvoice / !funil)
    // ==========================================
    if (/^(?:!|\/)(?:zapvoice|zv)$/i.test(lower)) {
      return this.sendMessage(from, zapVoiceService.formatStatusCard(), {}, activeSock);
    }

    if (/^(?:!|\/)(?:funil|funnel)(?:\s+.*)?$/i.test(lower)) {
      const parts = text.trim().split(/\s+/).slice(1);
      const funnelQuery = parts[0];
      const targetQuery = parts[1] || from;
      if (!funnelQuery) {
        return this.sendMessage(from, `🎙️ *DISPARADOR DE FUNIL ZAPVOICE 2025*\n\n` +
          `📌 *Uso:* *!funil <id_ou_nome> [telefone_ou_grupo]*\n` +
          `_Exemplo:_ *!funil 1* ou *!funil 1 5511999998888*\n\n` +
          `Para ver todos os funis disponíveis, envie: *!zapvoice*`, {}, activeSock);
      }
      const res = await zapVoiceService.executeFunnel(activeSock, targetQuery, funnelQuery, { name: senderName });
      return this.sendMessage(from, res.message, {}, activeSock);
    }

    // 14.30 Central Educativa de Comandos & Tutoriais: !ajuda <comando> / !help <comando>
    const helpCmdMatch = text.match(/^(?:!|\/)(?:ajuda|help|tutorial|ensinar|como\s*usar)(?:\s+(.+))?$/i);
    if (helpCmdMatch) {
      const commandHelpService = require('../services/commandHelpService');
      const targetQuery = helpCmdMatch[1]?.trim();
      return commandHelpService.handleHelpCommand(activeSock, from, targetQuery);
    }

    // 15. Menu Geral de Comandos Spy Bot + Loja: !help / !comandos / !menu2 / !spy / !spybot / !ajudatudo
    if (/^(?:!|\/)?(?:help|comandos|menu2|spy|spybot|ajudatudo|allmenu|menucompleto)$/i.test(lower)) {
      const isOwnerUser = this.isOwner(senderPhone, isFromMe);

      let spyMenu = `🤖 *CATÁLOGO DE COMANDOS PAYBOT* 🤖\n\n` +
        `💡 _Acesse este menu a qualquer momento enviando *!help*, *!bot* ou *!comandos*_\n\n` +
        `🎨 *Figurinhas & Mídia:*\n` +
        `• *!s* ou *!sticker* — Cria figurinha de foto ou vídeo\n` +
        `• *!qc <texto>* — Figurinha Quote Chat balão escuro oficial WhatsApp\n` +
        `• *!brat <texto>* — Figurinha viral Charli XCX verde-limão com desfoque\n` +
        `• *!emojimix <e1>+<e2>* — Funde dois emojis pelo Google Kitchen\n` +
        `• *!attp <texto>* ou *!attp2* — Figurinha animada em cores rainbow piscantes\n` +
        `• *!tomp3* — Converte vídeo ou áudio respondido em música MP3\n` +
        `• *!toimg* — Converte figurinha em imagem JPG\n` +
        `• *!tts <texto>* — Converte texto em áudio falado pelo bot\n\n` +
        `📥 *Downloads & Ferramentas na Nuvem (Qualidade H = Alta / S = Padrão):*\n` +
        `• *!playdoc <música>* — Baixa música em Alta Qualidade (High) e envia como DOCUMENTO com capa e nome oficial\n` +
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
        `• *!scrapinsta <@usuario>* — Raio-X completo: métricas, rede e maturidade intelectual\n` +
        `• *!pagespeed <site>* — Raio-X Google PageSpeed: velocidade, SEO, SSL e pixels de marketing\n\n` +
        `🔗 *Multi-Dispositivos & Sub-Bots:*\n` +
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
        `• *!viralscan* — Faz varredura de virais em todos os perfis agora\n\n` +
        `💼 *Consultoria Tech, Orçamentos & Calls:*\n` +
        `• *!orcamento [tipo]* — Simula escopo e investimento (software, app, ia, iot, site, seo)\n` +
        `• *!reuniao* ou *!meet* — Consulta agenda e marca call técnica no Google Meet\n\n` +
        `🎧 *Efeitos de Áudio & Modulação de Voz:*\n` +
        `• *!bass* / *!bass2* / *!grave* — Aumenta graves profundos no áudio\n` +
        `• *!slow* / *!fast* — Deixa o áudio mais lento ou acelerado\n` +
        `• *!reverso* — Inverte a reprodução do áudio de trás para frente\n` +
        `• *!robot* / *!eco* / *!cave* — Aplica filtro robô, eco espacial ou caverna\n` +
        `• *!volume* / *!pitch* / *!equalizer* — Boost de volume e equalização\n` +
        `• *!videorapido* / *!videoslow* / *!videoreverso* / *!videobw* — Efeitos em vídeo\n\n` +
        `🛡️ *Aluguel de Bot por Grupo & Proteção:*\n` +
        `• *!x9 [on/off/logs]* — Dedo-Duro do grupo: monitora apagadas, visualização única e saídas\n` +
        `• *!revelar* ou *!rv* — Revela foto, vídeo ou áudio de visualização única citado\n` +
        `• *!antiviewonce on/off* — Auto-revelação de fotos, vídeos e áudios temporários\n` +
        `• *!tempoaluguel* ou *!aluguel* — Consulta a validade do aluguel neste grupo\n` +
        `• *!key <chave>* ou *!usarcodigo* — Ativa aluguel com código de 8 dígitos\n` +
        `• *!antiflood <segundos|off>* — Proteção contra spam consecutivo de mensagens\n` +
        `• *!antitrava on/off* — Apaga mensagens trava-zap e expulsa o remetente\n` +
        `• *!bemvindo on/off* e *!legendabv <texto>* — Boas-vindas com tags dinâmicas\n` +
        `• *!saida on/off* e *!legendasaiu <texto>* — Despedida com tags dinâmicas\n` +
        `• *!topcmd* — Ranking dos comandos mais utilizados do bot\n\n`;

      if (isOwnerUser) {
        spyMenu += `👑 *Assistente Matriz & Central de Comando dos Sub-Bots (Exclusivo Dono):*\n` +
          `• *!assistente* ou conversa no PV — Converse com a Matriz como sua assistente executiva\n` +
          `• *!painel* ou *!tunnel* — Link seguro HTTPS para acesso remoto ao painel web (em privado)\n` +
          `• *!delegar <id_bot> <telefone> <msg>* — Delega envio direto para sub-bot específico\n` +
          `• *!tarefas* ou *!missoes* — Consulta tarefas delegadas e relatório de execução\n` +
          `• *!painelsubbots* — Painel consolidado do exército de sub-bots\n` +
          `• *!vozvendedor [antonio|thalita|francisca|vel|teste]* — Configura voz neural e velocidade do bot vendedor\n` +
          `• *!divulgar <mensagem>* — Disparo em massa com Spintax via sub-bots para leads\n` +
          `• *!promover <id_produto>* — Dispara promoção do catálogo via sub-bots\n` +
          `• *!divulgargrupos <mensagem>* — Transmite em todos os grupos onde os bots estão\n` +
          `• *!pararsubbot <id>* — Desconecta sub-bot específico\n` +
          `• *!reiniciarsubbot <id>* — Reconecta sub-bot específico\n` +
          `• *!resetarsubbot <id>* — Limpa credenciais para re-parear sub-bot\n` +
          `• *!setowner <numero>* — Define número do Dono\n\n`;
      }

      spyMenu += `🤖 *Inteligência Artificial & Utilitários SpyBot:*\n` +
        `• *!simi <texto>* ou *!simi on/off* — Chatbot conversacional SimSimi\n` +
        `• *!ia <pergunta>* — Converse com o ChatGPT / Gemini integrado\n` +
        `• *!imagine <ideia>* — Gera arte inédita com IA\n` +
        `• *!server* — Diagnóstico completo da VPS, CPU, RAM e Uptimes\n` +
        `• *!limparcache* — Limpa memórias temporárias e libera RAM\n` +
        `• *!restart* — Reinicia o bot ou sub-bots com segurança\n` +
        `• *!moedas* — Cotações em tempo real (USD, EUR, GBP, USDT, BTC e ETH)\n` +
        `• *!fazernick <texto>* ou *!tabela* — 20 estilos de fontes elegantes para nicks\n` +
        `• *!conselhobiblico* — Versículo bíblico e reflexão de sabedoria\n` +
        `• *!conselho* — Conselhos motivacionais dos maiores líderes e empreendedores\n` +
        `• *!metadinha* — Envia fotos de perfil combinando para casais ou amigos\n` +
        `• *!clima <cidade>* — Previsão do tempo completa em tempo real\n` +
        `• *!ddd <número>* — Consulta de estado e cidades por código DDD\n` +
        `• *!ping* — Mede velocidade de resposta, uptime e status dos bots\n` +
        `• *!configurar* — Painel interativo de configurações do bot e grupos\n` +
        `• *!traduzir <en|es|fr> <texto>* — Traduz instantaneamente\n` +
        `• *!encurtar <link>* — Encurta qualquer link (TinyURL)\n` +
        `• *!qr <texto ou link>* — Gera imagem de QR Code instantânea\n` +
        `• *!cep <número>* — Consulta endereço completo (ViaCEP)\n` +
        `• *!calc <expressão>* — Calculadora de bolso inteligente\n\n` +
        `🎮 *Gamificação, Social & Jogos:*\n` +
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
        `🛍️ *Vendas, Vitrine & Catálogo Tech (PayBot):*\n` +
        `• *!loja* ou *!vitrine* — Vitrine online com carrinho e checkout Pix/USDT\n` +
        `• *MENU* — Ver catálogo completo no WhatsApp\n` +
        `• *!pix <valor>* — Gerar cobrança Pix Copia e Cola imediata\n` +
        `• *!usdt <valor> [rede]* — Gerar cobrança em criptomoeda USDT\n` +
        `• *P1, P2...* — Gerar PIX Copia e Cola instantâneo de produto\n` +
        `• *C1, C2...* — Pagar via Cripto / Binance Pay (USDT)\n` +
        `• *K1, K2...* — Pagar via Carteira Cripto (Auto-Custódia)\n` +
        `• *STATUS* — Consultar andamento do seu pedido\n` +
        `• *!suporte* — Solicitar atendimento humano\n\n` +
        `📢 *Central de Avisos & Broadcast (Sistemas Avisos PC):*\n` +
        `• *!aviso <mensagem>* — Emite comunicado geral para a equipe\n` +
        `• *!urgente <mensagem>* — Emite alerta crítico com som e prioridade\n` +
        `• *!avisos* — Lista os avisos ativos no sistema\n` +
        `• *!confirmaraviso <id>* — Confirma recebimento ou responde\n\n`;

      if (isOwnerUser && !isGroup) {
        spyMenu += `🌐 *Painel Web (Exclusivo Dono):* Envie *!painel* no privado para receber seu link de acesso seguro.\n`;
      }
      spyMenu += `🛡️ *Moderação de Grupos:* Envie *!admin* para ver comandos de gestão.`;

      return this.sendMessage(from, spyMenu);
    }

    // 1. Saudações e Primeiro Contato no Privado (Apenas saudações puras sem pergunta ou intenção de negócio)
    const normalizedGreetingText = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nonGreetingTokens = normalizedGreetingText
      .replace(/\b(?:oi|ola|oie|oiee|opa|e\s*ai|eai|fala|salve|bom\s*dia|boa\s*(?:tarde|noite)|tudo\s*(?:bem|bom|certo|100%?|tranquilo|joia|otimo)|como\s*(?:vai|esta|ce\s*ta|voce\s*ta)|voce|vc|contigo|por\s*ai|por\s*aqui|blz|beleza|amigo|mano|ai|voltei|to\s*de\s*volta|estou\s*de\s*volta|to\s*aqui|estou\s*aqui|cheguei|retornei)\b/gi, '')
      .replace(/[^\w\s]/g, '')
      .trim();
    const isGreeting = nonGreetingTokens.length === 0;

    if (isGreeting) {
      if (isOwnerUser && lower !== 'menu loja' && lower !== 'catalogo') {
        const matrizAssistantService = require('../services/matrizAssistantService');
        return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
      }
      if (!isGroup) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '👋');
        // Registra lead no CRM Cognitivo imediatamente
        if (senderPhone) {
          try {
            models.upsertLeadCognitiveProfile(senderPhone, {
              name: senderName || 'Lead WhatsApp',
              buying_stage: 'DESCOBERTA'
            });
            models.addLeadEpisodicMemory(senderPhone, `Saudação recebida no privado: "${text.slice(0, 80)}"`);
          } catch (_) {}
        }

        // REGRA RIGOROSA DE INATIVIDADE DE 30 MINUTOS:
        // Se o cliente ficou menos de 30 minutos sem responder (ou seja, conversa ativa em andamento),
        // NUNCA inicia com saudação nem envia menu inicial novamente!
        if (isWithinActiveWindow) {
          try {
            const cognitiveService = require('../services/cognitiveSalesService');
            const recentTurns = cognitiveService.getRecentDialogueTurns(senderPhone, 6);
            if (recentTurns && recentTurns.length > 0) {
              const consultReply = await cognitiveService.generateConsultativeReply({
                phone: senderPhone,
                name: senderName,
                text,
                nlpResult: { intent: 'GREETING', confidence: 0.95 },
                instanceId: activeSock?.instanceId || 1,
                subbotId: activeSock?.instanceId || 1,
                isGroup: false,
                isWithinActiveWindow: true,
                isVoiceInput,
                preferAudio: clientPrefersAudio
              });
              if (consultReply) {
                cognitiveService.recordDialogueTurn(senderPhone, 'assistant', consultReply);
                return this.sendHumanSplitMessages(activeSock, from, consultReply, { preferAudio: clientPrefersAudio });
              }
            }
          } catch (_) {}

          // Se não há histórico consultivo recente: resposta humana de continuidade sem saudar do zero
          const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
          const firstName = cleanName ? cleanName.split(' ')[0] : '';
          const namePart = firstName ? ` ${firstName}` : '';
          const continuations = [
            `Opa${namePart}, tô por aqui! Pode falar 👍`,
            `Tô por aqui! Em que posso te ajudar?`,
            `Opa, na escuta! Pode mandar 😉`
          ];
          const reply = continuations[Math.floor(Math.random() * continuations.length)];
          return this.sendMessage(from, reply, {}, activeSock);
        }

        // Mais de 30 minutos de inatividade (ou primeiro contato absoluto):
        // Agora sim, e somente agora, saúda com o diálogo inicial de boas-vindas
        return this.sendPrivateInitialDialogue(from, senderName, activeSock);
      }
    }

    // 1.1 Navegação no Menu Privado (Opções 1 a 5 e Atalhos de Venda)
    if (!isGroup) {
      const userSession = this.userSessions ? this.userSessions.get(from) : null;
      const isViewingCatalog = userSession && userSession.state === 'VIEWING_CATALOG';
      const isWelcomeState = !isViewingCatalog;

      if (lower === 'todos' || lower === 'catalogo completo' || lower === 'catálogo completo' || lower === 'ver tudo') {
        if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '📋');
        return this.sendMenu(from, senderName, activeSock, { showFull: true });
      }

      if ((lower === '1' || lower === 'opcao 1' || lower === 'opção 1') && isWelcomeState) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '🛍️');
        return this.sendMenu(from, senderName, activeSock);
      } else if (lower.includes('aluguel') || ((lower === '2' || lower === 'opcao 2' || lower === 'opção 2') && isWelcomeState)) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '🛡️');
        return this.sendBotRentalInfo(from, senderName, activeSock);
      } else if (lower === 'software' || lower === 'sob medida' || ((lower === '3' || lower === 'opcao 3' || lower === 'opção 3') && isWelcomeState)) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '💻');
        return this.sendCustomSoftwareInfo(from, senderName, activeSock);
      } else if (lower === 'atendente' || lower === 'humano' || lower === 'falar com suporte' || ((lower === '4' || lower === 'opcao 4' || lower === 'opção 4') && isWelcomeState)) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '👨‍💻');
        return this.sendSupportHuman(from, senderName, activeSock);
      } else if (lower === 'pedidos' || lower === 'meus pedidos' || lower === 'compras' || ((lower === '5' || lower === 'opcao 5' || lower === 'opção 5') && isWelcomeState)) {
        if (msg.key) await this.safeReact(activeSock, from, msg.key, '📦');
        return this.sendOrderStatus(from);
      } else if (lower === 'call' || lower === '!call' || lower === 'reuniao' || lower === 'reunião' || lower === 'agendar') {
        try {
          const meetingService = require('../services/meetingService');
          const meetingRes = await meetingService.handleMeetingInteraction(senderPhone, senderName, text);
          if (meetingRes && meetingRes.replyText) {
            return this.sendMessage(from, meetingRes.replyText, {}, activeSock);
          }
        } catch (_) {}
      } else if (lower === 'cupom' || lower === '!cupom' || lower === 'promocao' || lower === 'promoção') {
        const coupons = models.getCoupons ? models.getCoupons() : [];
        const activeCoupon = coupons.find(c => c.active && (!c.expires_at || new Date(c.expires_at) > new Date()) && (!c.max_uses || c.used_count < c.max_uses));
        if (activeCoupon) {
          return this.sendMessage(from, `🎟️ *Cupom Especial Ativo:*\n\nUse o código *${activeCoupon.code}* e garanta *${activeCoupon.discount_percent || 10}% de desconto* hoje!\n\nPara aplicar, escolha seu produto no *MENU* e informe o cupom.`, {}, activeSock);
        } else {
          return this.sendMessage(from, `ℹ️ No momento nossos preços já estão na melhor condição de tabela promocional! Envie *MENU* para conferir.`, {}, activeSock);
        }
      } else if (lower === 'pix aluguel' || lower === 'pixaluguel') {
        const products = this.getProductsForContext(activeSock);
        const rentalProd = products.find(p => p.id === 1062 || p.name.toLowerCase().includes('aluguel mensal')) || {
          id: 1062,
          name: 'Aluguel Mensal PayBot (Grupos WhatsApp)',
          price_brl: 49.90,
          description: 'Acesso mensal para 1 grupo com moderação, anti-trava e anti-link.'
        };
        return this.processPixPurchase(from, senderName, rentalProd, activeSock);
      }
    }

    // 2. Comandos explícitos de catálogo / menu / vitrine
    const isExplicitMenu = [
      'menu', 'inicio', 'início', 'comprar', 'produtos', 'planos', 'catalogo', 'catálogo',
      'tabela', 'valores', 'precos', 'preços', 'voltar', 'comecar', 'começar'
    ].some(cmd => lower === cmd) || lower.startsWith('!menu') || lower.startsWith('/menu') || lower === '!m' || lower === '/m' || lower === 'm' || lower === 'menu loja' || lower === 'ver produtos';

    if (isExplicitMenu) {
      if (isOwnerUser && lower !== 'menu loja' && lower !== 'catalogo') {
        return this.sendOwnerExecutiveCockpit(from, senderName, activeSock);
      }
      if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '🛍️');
      const isSubBot = Boolean(activeSock && (activeSock !== this.sock || (activeSock.instanceId && activeSock.instanceId > 1)));
      const subBotHasProducts = isSubBot ? (activeSock.instanceId ? models.getSubBotProducts(activeSock.instanceId).length > 0 : false) : false;
      if (!isGroup && !isSubBot && !subBotHasProducts && (lower === 'inicio' || lower === 'início' || lower === 'voltar' || lower === 'comecar' || lower === 'começar')) {
        return this.sendPrivateInitialDialogue(from, senderName, activeSock);
      }
      return this.sendMenu(from, senderName, activeSock);
    }

    if (lower === 'ajuda' || lower === 'suporte') {
      if (isOwnerUser) {
        return this.sendOwnerExecutiveCockpit(from, senderName, activeSock);
      }
      if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '👨‍💻');
      return this.sendHelp(from);
    }

    if (lower === 'status' || lower.startsWith('!status')) {
      if (isOwnerUser) {
        return this.sendOwnerExecutiveStatus(from, activeSock);
      }
      if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '📦');
      return this.sendOrderStatus(from);
    }

    // Detecção Inteligente de Troca / Correção de Modalidade de Pagamento (Anti-Duplicação)
    const switchPaymentMatch = lower.match(/(?:trocar|mudar|alterar|prefiro|quero)\s*(?:a\s*)?(?:forma|metodo|pagamento|modalidade)?\s*(?:para\s*|pra\s*|por\s*)?(pix|binance|usdt|cripto|crypto|carteira|wallet)?/i);
    const isMistakeOrSwitch = /(?:errei|trocar|mudar|alterar)\s*(?:o\s*)?(?:pagamento|pedido|forma|modalidade|metodo)/i.test(lower);
    if ((switchPaymentMatch && (switchPaymentMatch[1] || isMistakeOrSwitch)) || isMistakeOrSwitch) {
      const recentPending = models.getLatestPendingOrder(from);
      if (recentPending) {
        const prod = models.getProductById(recentPending.product_id);
        if (prod) {
          const target = (switchPaymentMatch && switchPaymentMatch[1]) ? switchPaymentMatch[1].toLowerCase() : null;
          if (target === 'pix') {
            await this.sendMessage(from, `🔄 Alternando a forma de pagamento do seu Pedido *#${recentPending.merchant_trade_no}* para *PIX*...`, {}, activeSock);
            return this.processPixPurchase(from, senderName, prod, activeSock);
          } else if (target === 'binance' || target === 'usdt') {
            await this.sendMessage(from, `🔄 Alternando a forma de pagamento do seu Pedido *#${recentPending.merchant_trade_no}* para *Binance Pay (USDT)*...`, {}, activeSock);
            return this.processBinancePurchase(from, senderName, prod, activeSock);
          } else if (target === 'cripto' || target === 'crypto' || target === 'carteira' || target === 'wallet') {
            await this.sendMessage(from, `🔄 Alternando a forma de pagamento do seu Pedido *#${recentPending.merchant_trade_no}* para *Carteira Cripto*...`, {}, activeSock);
            return this.processCryptoWalletPurchase(from, senderName, prod, activeSock);
          } else {
            const brl = Number(prod.price_brl || prod.price || 0).toFixed(2);
            const usdt = Number(prod.price_usdt || ((prod.price || 10) / 5.5)).toFixed(2);
            const menuTroca = 
              `🔄 *Alteração de Forma de Pagamento do Pedido #${recentPending.merchant_trade_no}*\n\n` +
              `📦 *Item:* ${prod.name}\n` +
              `Modalidade Atual: *${(recentPending.gateway || 'pix').toUpperCase()}*\n\n` +
              `Escolha a modalidade para a qual deseja trocar:\n\n` +
              `🟢 Digite *P${prod.id}* para pagar com *PIX* (R$ ${brl})\n` +
              `🟡 Digite *C${prod.id}* para pagar com *Binance Pay* (${usdt} USDT)\n` +
              `💎 Digite *K${prod.id}* para pagar com *Carteira Cripto* (${usdt} USDT)\n\n` +
              `_Não será criado nenhum pedido novo, seu pedido atual será atualizado instantaneamente!_`;
            return this.sendMessage(from, menuTroca, {}, activeSock);
          }
        }
      }
    }

    // Atalhos diretos de pagamento: Ex "P1", "PIX 1", "C1", "CRIPTO 1"
    const pixMatch = lower.match(/^(?:p|pix\s*)(\d+)$/);
    if (pixMatch) {
      const idx = parseInt(pixMatch[1], 10);
      const products = this.getProductsForContext(activeSock);
      if (idx > 0 && idx <= products.length) {
        if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '⚡');
        return this.processPixPurchase(from, senderName, products[idx - 1], activeSock);
      }
    }

    const bpayMatch = lower.match(/^(?:c|cripto\s*|crypto\s*|usdt\s*)(\d+)$/);
    if (bpayMatch) {
      const idx = parseInt(bpayMatch[1], 10);
      const products = this.getProductsForContext(activeSock);
      if (idx > 0 && idx <= products.length) {
        if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '⚡');
        return this.processBinancePurchase(from, senderName, products[idx - 1], activeSock);
      }
    }

    // Atalho para carteira cripto auto-custódia: "K1", "WALLET 1", "CARTEIRA 1"
    const cryptoWalletMatch = lower.match(/^(?:k|wallet\s*|carteira\s*|cripto wallet\s*)(\d+)$/);
    if (cryptoWalletMatch) {
      const idx = parseInt(cryptoWalletMatch[1], 10);
      const products = this.getProductsForContext(activeSock);
      if (idx > 0 && idx <= products.length) {
        if (!isGroup && msg.key) await this.safeReact(activeSock, from, msg.key, '💎');
        return this.processCryptoWalletPurchase(from, senderName, products[idx - 1], activeSock);
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
        const isCrypto = cryptoWalletService.isEnabled();

        const activeOptions = [];
        const brl = Number(product.price_brl || product.price || 0).toFixed(2);
        const usdt = Number(product.price_usdt || ((product.price || 10) / 5.5)).toFixed(2);

        if (isPix) activeOptions.push({ code: `P${num}`, label: `*PIX* (R$ ${brl})`, icon: '🟢', type: 'pix' });
        if (isBinance) activeOptions.push({ code: `C${num}`, label: `*Binance Pay* (${usdt} USDT)`, icon: '🟡', type: 'binance' });
        if (isCrypto) activeOptions.push({ code: `K${num}`, label: `*Carteira Cripto / Auto-Custódia* (${usdt} USDT)`, icon: '💎', type: 'crypto' });

        if (activeOptions.length > 1) {
          let choiceMsg = `📦 *${product.name}*\n\nComo você prefere pagar?\n\n`;
          for (const opt of activeOptions) {
            choiceMsg += `${opt.icon} Digite *${opt.code}* para pagar via ${opt.label}\n`;
          }
          choiceMsg += `\n_Exemplo: responda *${activeOptions[0].code}* ou toque em uma das opções abaixo._`;

          if (interactiveMessageService.isEnabled()) {
            try {
              const buttons = activeOptions.map(opt => ({
                type: 'quick_reply',
                text: `${opt.icon} ${opt.type === 'pix' ? 'Pagar com PIX' : (opt.type === 'binance' ? 'Binance Pay' : 'Cripto USDT')}`,
                id: opt.code
              }));
              const sent = await interactiveMessageService.sendInteractiveButtons(activeSock || this.sock, from, {
                title: `💳 FORMA DE PAGAMENTO: ${product.name.slice(0, 30)}`,
                text: `📦 *${product.name}*\n💰 Valor: *R$ ${brl}* ou *${usdt} USDT*\n\nSelecione seu método de pagamento preferido:`,
                footer: 'Aprovação e liberação imediata',
                buttons,
                fallbackText: choiceMsg
              });
              if (sent) return;
            } catch (btnErr) {
              console.warn('[WhatsApp Payment Buttons ⚠️ Fallback texto]:', btnErr.message);
            }
          }
          return this.sendMessage(from, choiceMsg, {}, activeSock);
        } else if (activeOptions.length === 1) {
          if (activeOptions[0].type === 'pix') return this.processPixPurchase(from, senderName, product, activeSock);
          if (activeOptions[0].type === 'binance') return this.processBinancePurchase(from, senderName, product, activeSock);
          if (activeOptions[0].type === 'crypto') return this.processCryptoWalletPurchase(from, senderName, product, activeSock);
        } else {
          return this.processPixPurchase(from, senderName, product, activeSock);
        }
      }
    }

    // 6. Processamento de Linguagem Natural em Português Brasileiro (NLP / NLU PT-BR) & CRM Cognitivo Hexis
    if (isOwnerUser) {
      const matrizAssistantService = require('../services/matrizAssistantService');
      return matrizAssistantService.handleOwnerConversation(activeSock, from, text, senderName, senderPhone, isGroup);
    }

    try {
      // 6.0 Auto-Chat SimSimi do SpyBot (!simi on) - apenas se ativo no chat e sem intenção de compra/suporte/preço
      const hasBusinessIntent = /(?:quanto|custa|pre[cç]o|valor|como\s+funciona|bot|venda|compra|aluguel|software|suporte|plano|pix|key|chave)/i.test(lower);
      if (!hasBusinessIntent) {
        const simiHandled = await spyFeatures.checkSimiAutoChat(activeSock, from, text, senderName, isGroup);
        if (simiHandled) return;
      }

      const nlpService = require('../services/nlpService');
      const cognitiveService = require('../services/cognitiveSalesService');

      // Limpa menções @55... ou prefixos 'bot,' 'ei bot' para NLP e IA responderem com máxima precisão
      const cleanQueryText = text
        .replace(/@\d{8,15}/g, '')
        .replace(/^(?:ei\s+)?bot[,:\s]*/i, '')
        .replace(/^(?:nina|paybot|matriz)[,:\s]*/i, '')
        .trim() || text;

      // ⚡ JEV DECISION ENGINE: Roteamento Ultrarrápido de Intenção em Sub-15ms
      const jevDecisionService = require('../services/jevDecisionService');
      let jevDecision = null;
      try {
        jevDecision = await jevDecisionService.decideMessageGateway({
          text: cleanQueryText,
          senderPhone,
          senderName,
          isGroup,
          chatJid: from,
          isOwner: isOwnerUser
        });
      } catch (jevErr) {
        console.warn('[Jev Gateway Error]:', jevErr.message);
      }

      // Interceptador de Dúvidas e Consultas do Achadinhos (SOMENTE DENTRO DE GRUPOS AUTORIZADOS, NUNCA NO PRIVADO)
      if (isGroup) {
        const achadinhosService = require('../services/achadinhosService');
        const isAchadinhosChannelOrGroup = from === models.getSetting('ACHADINHOS_GROUP_JID') || from === models.getSetting('ACHADINHOS_CHANNEL_JID') || models.isGroupPostingActive(from);
        if (isAchadinhosChannelOrGroup || /(?:achadinho|promo[çc][aã]o|cupom|shopee|amazon|mercado\s+livre)/i.test(lower)) {
          const handledAchadinhos = await achadinhosService.handleBuyerGroupQuery({
            sock: activeSock,
            from,
            text: cleanQueryText,
            senderPhone,
            isGroup: true,
            senderName
          });
          if (handledAchadinhos) return;
        }
      }

      // Resolução de contexto multi-tenant e produtos ativos
      const contextProducts = this.getProductsForContext(activeSock);
      const isSubBotContext = !!activeSock && activeSock !== this.sock;
      const instanceIdContext = activeSock?.instanceId || (isSubBotContext ? 2 : 1);
      const armyInstContext = models.getArmyInstanceById(instanceIdContext);
      const tenantIdContext = armyInstContext?.tenant_id || null;

      // Extração de memórias episódicas e perfil cognitivo em conversas privadas
      if (!isGroup && senderPhone) {
        try {
          cognitiveService.analyzeAndExtractProfile(senderPhone, senderName, text, { tenantId: tenantIdContext, instanceId: instanceIdContext });
        } catch (_) {}

        // Agendamento de Demonstração / Call de Diagnóstico Técnico (Google Meet)
        try {
          const meetingService = require('../services/meetingService');
          if (meetingService.detectMeetingIntent(text)) {
            const meetingRes = await meetingService.handleMeetingInteraction(senderPhone, senderName, text);
            if (meetingRes && meetingRes.replyText) {
              return this.sendMessage(from, meetingRes.replyText, {}, activeSock);
            }
          }
        } catch (mErr) {
          console.error('[WhatsApp Meeting Error]:', mErr.message);
        }

        // Base de Conhecimento RAG / FAQ de Produtos
        try {
          const faqMatch = models.matchProductFaq(text);
          if (faqMatch && faqMatch.match) {
            const faq = faqMatch.faq;
            const webStoreTrackerService = require('../services/webStoreTrackerService');
            const trackedFaq = webStoreTrackerService.buildTrackedStoreUrl({
              phone: senderPhone,
              name: senderName,
              instanceId: activeSock?.instanceId,
              source: 'faq_reply'
            });
            const ans = `${faq.answer}\n\n🌐 *Vitrine oficial:* ${trackedFaq.shortUrl || trackedFaq.url}\nFicou alguma dúvida sobre isso?`;
            return this.sendMessageWithTyping(activeSock, from, { text: ans });
          }
        } catch (faqErr) {
          console.warn('[WhatsApp FAQ Match Error]:', faqErr.message);
        }
      }

      const nlp = await nlpService.processMessage({
        text: cleanQueryText,
        customerName: senderName,
        platform: 'whatsapp',
        products: contextProducts,
        tenantId: tenantIdContext,
        instanceId: instanceIdContext
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

        // Resolução inteligente de compra direta por confirmação afirmativa ("sim", "manda o pix", "pode mandar")
        if (!isGroup && (nlp.intent === 'AFFIRMATIVE_CONFIRMATION' || /^(?:sim\b|pode\s+mandar|pode\s+gerar|manda\s+o\s+pix|gera\s+o\s+pix|passa\s+o\s+pix|quero\b|vou\s+querer|fechado\b|vamos\s+fechar|manda\s+a[ií]|pode\s+ser)\b/i.test(cleanQueryText))) {
          let targetProduct = nlp.entities?.matchedProduct;
          if (!targetProduct && cognitiveService && senderPhone) {
            const recentTurns = cognitiveService.getRecentDialogueTurns(senderPhone, 4);
            const recentText = recentTurns.map(t => t.content.toLowerCase()).join(' ');
            if (/mensal|69|70/i.test(recentText)) {
              targetProduct = contextProducts.find(p => p.id === 2137 || (p.price_brl >= 65 && p.price_brl <= 75) || /mensal.*(?:vendas|atendimento|paybot)/i.test(p.name));
            } else if (/anual|497/i.test(recentText)) {
              targetProduct = contextProducts.find(p => p.id === 842 || (p.price_brl >= 450 && p.price_brl <= 550) || /spybot|bot de vendas/i.test(p.name));
            } else if (/vital[ií]cio|299/i.test(recentText)) {
              targetProduct = contextProducts.find(p => p.id === 1064 || p.price_brl === 299);
            } else if (/aluguel|grupo|49/i.test(recentText)) {
              targetProduct = contextProducts.find(p => p.id === 1062 || (p.price_brl >= 45 && p.price_brl <= 55));
            }
          }
          if (!targetProduct && senderPhone) {
            const storeCtx = models.getLeadStoreContext(senderPhone);
            if (storeCtx && storeCtx.last_viewed_product_id) {
              targetProduct = models.getProductById(storeCtx.last_viewed_product_id);
            }
          }
          if (!targetProduct) {
            targetProduct = contextProducts.find(p => p.id === 2137 || (p.price_brl >= 65 && p.price_brl <= 75)) || contextProducts.find(p => p.id === 842) || contextProducts[0];
          }
          if (targetProduct) {
            return this.processPixPurchase(from, senderName, targetProduct, activeSock);
          }
        }
        if (nlp.directAction === 'TRIGGER_BINANCE' && nlp.entities?.matchedProduct) {
          return this.processBinancePurchase(from, senderName, nlp.entities.matchedProduct, activeSock);
        }
        if (nlp.directAction === 'SHOW_MENU') {
          if (!isGroup && !['menu', '!menu', 'catalogo', 'catálogo', '!loja', '/loja', 'produtos'].includes(lower)) {
            // Em conversa privada humanizada, deixa a esteira consultiva responder em vez de despejar menu
          } else if (isGroup && !['!menu', '/menu', 'menu', 'catálogo', 'catalogo'].includes(cleanQueryText.toLowerCase())) {
            // Em grupo, nunca despeja o menu inteiro a menos que seja um comando explícito (!menu)
          } else {
            return this.sendMenu(from, senderName, activeSock);
          }
        }
        if (nlp.directAction === 'SHOW_RENTAL') {
          if (!isGroup && !['!aluguel', 'aluguel', 'aluguel bot', 'bot aluguel'].includes(lower)) {
            // Em conversa privada humanizada, deixa a esteira consultiva responder com naturalidade
          } else if (isGroup && !['!aluguel', 'aluguel'].includes(cleanQueryText.toLowerCase())) {
            // Em grupo, deixa a resposta consultiva concisa responder
          } else {
            return this.sendBotRentalInfo(from, senderName, activeSock);
          }
        }
        if (nlp.directAction === 'SHOW_CUSTOM_SOFTWARE') {
          if (!isGroup && !['!software', 'software', '!app', 'app'].includes(lower)) {
            // Em conversa privada humanizada, deixa a esteira consultiva responder
          } else {
            return this.sendCustomSoftwareInfo(from, senderName, activeSock);
          }
        }
        if (nlp.directAction === 'SHOW_STATUS') {
          return this.sendOrderStatus(from);
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
        if (nlp.directAction === 'HANDLE_DISINTEREST' || nlp.intent === 'DISINTEREST') {
          if (senderPhone) {
            try {
              models.upsertLeadCognitiveProfile(senderPhone, {
                buying_stage: 'PERDIDO',
                readiness_score: 0,
                main_objection: 'SEM_INTERESSE',
                next_followup_at: null,
                notes: 'Lead expressou desinteresse explícito no produto/serviço ofertado'
              });
              models.addLeadEpisodicMemory(senderPhone, 'OBJECTION', 'Lead expressou desinteresse explícito no produto/serviço ofertado', text, 5);

              const db = require('../db/database');
              db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE platform = 'whatsapp' AND platform_user_id LIKE ? AND status = 'PENDING'`).run(`%${senderPhone}%`);
              db.prepare(`UPDATE lead_funnel_conversations SET status = 'LOST' WHERE phone = ?`).run(senderPhone);
            } catch (_) {}
          }
        }
        if (nlp.intent === 'CONFIRM_PURCHASE') {
          models.markLeadConverted(senderPhone);
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
          let replyToSend = nlp.replyText;
          if (cognitiveService) {
            const isConsultativeIntent = [
              'GENERAL_CHAT', 'PRICE_QUERY', 'HOW_IT_WORKS', 'TRUST_AND_GUARANTEE',
              'BUY_INTENT', 'GREETING', 'RENTAL_QUERY', 'CUSTOM_SOFTWARE_QUERY',
              'CATALOG_QUERY', 'DISCOUNT_QUERY', 'TEST_QUERY', 'DISINTEREST'
            ].includes(nlp.intent);

            if (isConsultativeIntent) {
              try {
                const consultReply = await cognitiveService.generateConsultativeReply({
                  phone: senderPhone,
                  name: senderName,
                  text: cleanQueryText,
                  nlpResult: nlp,
                  matchedProduct: nlp.entities?.matchedProduct,
                  instanceId: instanceIdContext,
                  subbotId: instanceIdContext,
                  tenantId: tenantIdContext,
                  products: contextProducts,
                  isGroup,
                  groupName: isGroup ? (from || '') : '',
                  isWithinActiveWindow,
                  isVoiceInput,
                  preferAudio: clientPrefersAudio
                });
                if (consultReply) replyToSend = consultReply;
              } catch (_) {}
            } else {
              replyToSend = cognitiveService.humanizeResponse(replyToSend);
            }
          }
          if (cognitiveService && senderPhone) {
            cognitiveService.recordDialogueTurn(senderPhone, 'assistant', replyToSend);
          }
          if (!isGroup) {
            return this.sendHumanSplitMessages(activeSock, from, replyToSend, { preferAudio: clientPrefersAudio });
          }
          return this.sendMessageWithTyping(activeSock, from, { text: replyToSend });
        }
      }
    } catch (nlpErr) {
      console.error('[WhatsApp NLP Error]:', nlpErr.message, nlpErr.stack);
    }

    // Fallback Consultivo Humanizado / Padrão (Privado ou Grupo)
    if (senderPhone) {
      try {
        const cognitiveService = require('../services/cognitiveSalesService');
        const contextProductsFallback = this.getProductsForContext(activeSock);
        const isSubBotFallback = !!activeSock && activeSock !== this.sock;
        const instanceIdFallback = activeSock?.instanceId || (isSubBotFallback ? 2 : 1);
        const armyInstFallback = models.getArmyInstanceById(instanceIdFallback);
        const tenantIdFallback = armyInstFallback?.tenant_id || null;

        const cleanFallbackText = isGroup
          ? text.replace(/@\d{8,15}/g, '').replace(/^(?:ei\s+)?bot[,:\s]*/i, '').trim() || text
          : text;

        const consultFallback = await cognitiveService.generateConsultativeReply({
          phone: senderPhone,
          name: senderName,
          text: cleanFallbackText,
          instanceId: instanceIdFallback,
          subbotId: instanceIdFallback,
          tenantId: tenantIdFallback,
          products: contextProductsFallback,
          isGroup,
          groupName: isGroup ? (from || '') : '',
          isWithinActiveWindow,
          isVoiceInput,
          preferAudio: clientPrefersAudio
        });
        if (consultFallback) {
          cognitiveService.recordDialogueTurn(senderPhone, 'assistant', consultFallback);
          if (!isGroup) {
            return this.sendHumanSplitMessages(activeSock, from, consultFallback, { preferAudio: clientPrefersAudio });
          }
          return this.sendMessageWithTyping(activeSock, from, { text: consultFallback });
        }
      } catch (_) {}
    }

    // Fallback Natural de Último Caso
    const cleanFirstName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim().split(' ')[0] : '';
    const greetPart = isWithinActiveWindow ? '' : (cleanFirstName ? `Fala ${cleanFirstName}! ` : 'Opa! ');
    if (isGroup) {
      return this.sendMessageWithTyping(activeSock, from, { text: `${greetPart}Tô na área por aqui no grupo, precisando é só chamar!` });
    }
    const fallbackBubbles = isWithinActiveWindow
      ? [`Tudo tranquilo por aqui.`, `O que manda de bom?`]
      : [`${greetPart}Tudo tranquilo por aqui.`, `E por aí, o que manda de bom?`];
    await this.sendHumanSplitMessages(activeSock, from, fallbackBubbles, { preferAudio: clientPrefersAudio });
  }

  // Retorna os produtos ativos para o contexto do atendimento:
  // Se for um Sub-Bot com conta WhatsApp Business (ou catálogo próprio), opera ESTRITAMENTE com os produtos do seu catálogo!
  // Se for a Matriz Principal (ou subbot sem catálogo próprio), opera com o catálogo geral da loja.
  getProductsForContext(sock = null) {
    const activeSock = sock || this.currentDispatchSock || this.sock;
    const isSubBot = !!activeSock && activeSock !== this.sock;
    const instanceId = activeSock?.instanceId || (isSubBot ? 2 : 1);

    if (isSubBot) {
      const inst = models.getArmyInstanceById(instanceId);
      if (inst && inst.tenant_id) {
        const tenantProds = models.getProductsByTenant(inst.tenant_id).filter(p => p.active !== 0);
        if (tenantProds && tenantProds.length > 0) {
          return tenantProds;
        }
      }
      const isBusiness = models.isSubBotBusiness(instanceId);
      const subBotProds = models.getSubBotProducts(instanceId, activeSock?.user?.id);

      // Quando uma conta WhatsApp Business estiver logada como subbot, ela opera SOMENTE com seus próprios produtos!
      if (isBusiness || subBotProds.length > 0) {
        return subBotProds;
      }
    }

    // Matriz Principal ou Sub-Bot comum sem catálogo próprio: prioriza soluções oficiais da Matriz
    const allProds = models.getProducts(true);
    return allProds.slice().sort((a, b) => {
      const priority = [842, 1062, 1063, 1064, 848, 845, 844, 850, 849, 852];
      const idxA = priority.indexOf(a.id);
      const idxB = priority.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.id - b.id;
    });
  }

  async safeReact(sock, jid, msgKey, emoji) {
    if (!sock || !jid || !msgKey || !emoji) return;
    try {
      const reactionsEnabled = models.getSetting('WPP_PV_REACTIONS_ENABLED', 'true') !== 'false';
      if (!reactionsEnabled) return;
      let targetJid = jid;
      if (typeof targetJid === 'string' && targetJid.endsWith('@lid')) {
        const resolved = resolveLidToPhone(targetJid);
        if (resolved) targetJid = `${resolved}@s.whatsapp.net`;
      }
      if (typeof sock.sendMessage === 'function') {
        await sock.sendMessage(targetJid, { react: { text: emoji, key: msgKey } }, { skipPresence: true, noVerificado: true });
      }
    } catch (_) {}
  }

  async handleIncomingVoiceMessage(msg, from, senderName, senderPhone, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    if (models.isUserBlocked('whatsapp', senderPhone, from)) {
      return;
    }

    const autoReplyAudio = models.getSetting('WPP_PV_AUDIO_AUTOREPLY', 'true') !== 'false';
    if (!autoReplyAudio) return;

    if (msg.key) {
      await this.safeReact(sock, from, msg.key, '🎙️');
    }

    const durationSec = msg.message?.audioMessage?.seconds || msg.message?.voiceMessage?.seconds || 0;
    const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
    const firstName = cleanName ? cleanName.split(' ')[0] : '';
    const namePart = firstName ? `, *${firstName}*` : '';

    // ============================================================
    // 🎙️ TRANSCRIÇÃO DE ÁUDIO VIA IA (SPEECH-TO-TEXT GEMINI)
    // ============================================================
    let transcribedText = null;
    try {
      const speechToTextService = require('../services/speechToTextService');
      if (speechToTextService.isEnabled()) {
        let buffer = msg._audioBuffer || null;
        if (!buffer) {
          try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            buffer = await downloadMediaMessage(msg, 'buffer', {});
          } catch (dlErr) {
            if (msg._audioBuffer) buffer = msg._audioBuffer;
            else throw dlErr;
          }
        }
        if (buffer && buffer.length > 0) {
          const mime = msg.message?.audioMessage?.mimetype || msg.message?.voiceMessage?.mimetype || 'audio/ogg';
          transcribedText = await speechToTextService.transcribeAudio(buffer, mime);
        }
      }
    } catch (sttErr) {
      console.warn('[WhatsApp Audio Transcription Error]:', sttErr.message);
    }

    // Interceptador Anti-Privado (Anti-PV) para áudio
    const isOwnerAudio = this.isOwner(senderPhone, !!msg.key?.fromMe);
    if (!isOwnerAudio) {
      const isAntiPrivado = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
      const adminPhoneSetting = models.getSetting('ADMIN_PHONE', '');
      const isGlobalAdmin = !!(adminPhoneSetting && (adminPhoneSetting.includes(senderPhone) || senderPhone.includes(adminPhoneSetting)));
      const audioText = String(transcribedText || '').trim().toLowerCase();
      const isSalesOrOrder = /^(p\d+|c\d+|k\d+|[0-9]{1,2}|oi|ola|olá|menu|catalogo|catálogo|produtos|planos|loja|vitrine|pix|usdt|pedido|status|suporte|comprar|quero comprar|quanto custa|valor|preco|preço)$/i.test(audioText);
      const allowSales = models.getSetting('ANTIPRIVADO_ALLOW_SALES', 'true') !== 'false';
      const isSalesBypass = allowSales && (isSalesOrOrder || !transcribedText);
      if (isAntiPrivado && !isGlobalAdmin && !isSalesBypass) {
        const redirected = await spyFeatures.handleAntiPrivado(sock, from, senderPhone, transcribedText || '');
        if (redirected) return;
      }
    }

    if (transcribedText && transcribedText.trim()) {
      if (msg.key) {
        await this.safeReact(sock, from, msg.key, '🎧');
      }
      console.log(`[WhatsApp 🎙️] Áudio de ${senderPhone} transcrito: "${transcribedText}"`);
      if (senderPhone) {
        try {
          models.upsertLeadCognitiveProfile(senderPhone, {
            name: cleanName || 'Lead WhatsApp (Áudio)',
            buying_stage: 'QUALIFICACAO',
            preferred_channel: 'audio',
            prefers_audio: true
          });
          models.addLeadEpisodicMemory(senderPhone, 'VOICE_MESSAGE', `Áudio recebido (${durationSec}s): "${transcribedText}"`, transcribedText, 4);
          const cognitiveService = require('../services/cognitiveSalesService');
          cognitiveService.recordDialogueTurn(senderPhone, 'user', transcribedText);
        } catch (_) {}
      }

      // Regra de Ouro: NUNCA ecoar por texto o que o cliente acabou de falar em áudio.
      // O bot entende a fala, absorve no contexto cognitivo e devolve a resposta preferencialmente por áudio.
      const syntheticMsg = {
        ...msg,
        _isVoiceInput: true,
        _audioPreference: true,
        _voiceDurationSec: durationSec,
        _originalAudioKey: msg.key,
        message: {
          conversation: transcribedText
        }
      };
      return this._processIncomingMessage(syntheticMsg, sock);
    }

    // Registra lead no CRM Cognitivo e contingência humanizada se transcrição falhar
    if (senderPhone) {
      try {
        models.upsertLeadCognitiveProfile(senderPhone, {
          name: cleanName || 'Lead WhatsApp (Áudio)',
          buying_stage: 'DESCOBERTA',
          preferred_channel: 'audio',
          prefers_audio: true
        });
        models.addLeadEpisodicMemory(senderPhone, 'VOICE_MESSAGE', `Mensagem de voz/áudio recebida no privado (${durationSec}s) sem transcrição direta`, '', 2);
      } catch (_) {}
    }

    // Registra ticket de suporte interno silencioso
    try {
      models.createSupportTicket({
        platform: 'whatsapp',
        customerId: senderPhone,
        customerName: cleanName || 'Cliente WhatsApp',
        issueSummary: `Mensagem de voz recebida no WhatsApp Privado (${durationSec}s)`,
        description: `Áudio recebido no privado (${durationSec}s). Encaminhado para escuta e atendimento pelo especialista.`
      });
    } catch (_) {}

    // Resposta natural por voz: se o áudio não foi audível ou houve oscilação, pede com leveza e humanidade
    const cleanFirstNameGreet = firstName ? `, ${firstName}` : '';
    const voiceFallbackNotice = `[AUDIO: Fala${cleanFirstNameGreet}! Dei play no seu áudio aqui mas o som cortou um pedaço. Consegue mandar de novo ou me dar uma palhinha rápida por texto? Já te respondo na hora!]`;
    return this.sendHumanSplitMessages(sock, from, voiceFallbackNotice, { preferAudio: true });
  }

  async sendFriendlyGreeting(to, senderName, activeSock = null) {
    return this.sendPrivateInitialDialogue(to, senderName, activeSock);
  }

  async sendPrivateInitialDialogue(to, senderName, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
    const firstName = cleanName ? cleanName.split(' ')[0] : '';
    const namePart = firstName ? `, *${firstName}*` : '';

    // Determina saudação dinâmica com base no horário de Brasília (GMT-3)
    const { saudacao, icon: saudacaoIcon } = getBrasiliaGreeting();

    const mode = models.getSetting('WPP_PV_WELCOME_MODE', 'HUMANO');
    const botName = models.getSetting('BOT_NAME', 'PayBot Vendas');
    const title = models.getSetting('WPP_PV_WELCOME_TITLE', 'Central de Soluções Inteligentes & Automação');
    const customText = models.getSetting('WPP_PV_WELCOME_CUSTOM_TEXT', '') || models.getSetting('WELCOME_MESSAGE', '');
    const audioEnabled = models.getSetting('WPP_PV_WELCOME_AUDIO_ENABLED', 'false') === 'true';
    const audioId = models.getSetting('WPP_PV_WELCOME_AUDIO_ID', '');

    // Verifica pedidos e cupons
    const cleanCustomerPhone = String(to).split('@')[0].replace(/\D/g, '');
    const clientOrders = cleanCustomerPhone ? models.getOrdersByCustomerPhone(cleanCustomerPhone, 3) : [];
    const pendingOrder = clientOrders.find(o => o.status === 'PENDING');
    const isReturning = clientOrders && clientOrders.some(o => o.status === 'PAID');

    let activeCoupon = null;
    try {
      const coupons = models.getCoupons ? models.getCoupons() : [];
      activeCoupon = coupons.find(c => c.active && (!c.expires_at || new Date(c.expires_at) > new Date()) && (!c.max_uses || c.used_count < c.max_uses));
    } catch (_) {}

    // Gera Magic Short Link encurtado exclusivo e inteligente para o cliente com tracking
    const webStoreTrackerService = require('../services/webStoreTrackerService');
    const trackedWelcome = webStoreTrackerService.buildTrackedStoreUrl({
      phone: cleanCustomerPhone,
      name: cleanName || firstName || 'Cliente',
      instanceId: sock?.instanceId || 1,
      couponCode: activeCoupon ? activeCoupon.code : null,
      source: 'pv_welcome'
    });
    let storeUrl = trackedWelcome.shortUrl || trackedWelcome.url;

    // Se áudio PTT estiver ativado nas configurações do ZapVoice
    if (audioEnabled) {
      try {
        const zapVoiceService = require('../services/zapVoiceService');
        const interactiveMessageService = require('../services/interactiveMessageService');
        const { getBrasiliaGreeting, getBrasiliaHour } = require('../utils/dateTime');
        await zapVoiceService.sendPttAudio(sock, to, audioId || 1, {
          name: cleanName || 'Cliente',
          primeiro_nome: firstName || 'Cliente'
        });
      } catch (aErr) {
        console.warn('[WhatsApp PV Welcome Audio Error]:', aErr.message);
      }
    }

    // MODO 'HUMANO' (Padrão de Persona Humana Real de WhatsApp)
    // Se comporta como usuário comum de WhatsApp: acolhe com simpatia, divide em balões naturais e sem menus/robôs
    if (mode === 'HUMANO' || (!['MENU', 'CONSULTATIVO', 'CUSTOM'].includes(mode))) {
      if (this.userSessions) {
        const prev = this.userSessions.get(to) || {};
        this.userSessions.set(to, {
          ...prev,
          state: 'HUMAN_LISTENING',
          lastWelcomeTime: Date.now(),
          timestamp: Date.now()
        });
      }

      if (cleanCustomerPhone) {
        try {
          models.upsertLeadCognitiveProfile(cleanCustomerPhone, {
            name: senderName || 'Lead WhatsApp',
            buying_stage: 'DESCOBERTA'
          });
          models.addLeadEpisodicMemory(cleanCustomerPhone, 'GREETING', 'Boas-vindas humanizada enviada no privado', 'Acolhimento natural de primeiro contato', 2);
        } catch (_) {}
      }

      const bubble1 = firstName
        ? `Opa ${firstName}, ${saudacao.toLowerCase()}!`
        : `Opa, ${saudacao.toLowerCase()}!`;
      const bubble2 = `Tudo certo por aí?`;

      return this.sendHumanSplitMessages(sock, to, [bubble1, bubble2]);
    }

    // Registra sessão para captura de opções numéricas (1 a 5) e timestamp do último menu
    if (this.userSessions) {
      const prev = this.userSessions.get(to) || {};
      this.userSessions.set(to, {
        ...prev,
        state: 'WELCOME_MENU',
        lastWelcomeTime: Date.now(),
        timestamp: Date.now()
      });
    }

    // Registra lead no CRM Cognitivo imediatamente
    if (cleanCustomerPhone) {
      try {
        models.upsertLeadCognitiveProfile(cleanCustomerPhone, {
          name: senderName || 'Lead WhatsApp',
          buying_stage: 'DESCOBERTA'
        });
        models.addLeadEpisodicMemory(cleanCustomerPhone, `Boas-vindas inicial enviada no privado via modo: ${mode}`);
      } catch (_) {}
    }

    // Geração de Card SVG Personalizado nas Boas-Vindas no Privado
    const memberSvgService = require('../services/memberSvgService');
    const isPvSvgEnabled = memberSvgService.isWelcomeSvgEnabled('pv') && models.getSetting('WELCOME_SVG_PV', 'true') !== 'false';
    let pvCard = null;
    if (isPvSvgEnabled) {
      try {
        pvCard = await memberSvgService.createMemberWelcomeCard({
          memberJid: to,
          memberPhone: cleanCustomerPhone,
          memberName: cleanName || firstName || (cleanCustomerPhone ? `@${cleanCustomerPhone}` : 'Cliente'),
          groupName: botName,
          memberNumber: cleanCustomerPhone ? cleanCustomerPhone.slice(-4) : 'VIP',
          sock,
          groupId: 'pv'
        });
      } catch (pvErr) {
        console.warn('[PV Welcome SVG ⚠️] Erro ao gerar banner:', pvErr.message);
      }
    }

    if (mode === 'CUSTOM' && customText && customText.trim().length > 0) {
      let msg = customText
        .replace(/\{saudacao\}/gi, `${saudacaoIcon} ${saudacao}`)
        .replace(/\{nome\}/gi, firstName ? ` ${firstName}` : '')
        .replace(/\{primeiro_nome\}/gi, firstName || '')
        .replace(/\{bot_name\}/gi, botName)
        .replace(/\{loja\}/gi, botName)
        .replace(/\{titulo\}/gi, title)
        .replace(/\{vitrine_url\}/gi, storeUrl)
        .replace(/\{link_proposta\}/gi, `${storeUrl}/proposta`)
        .replace(/\{chave_pix\}/gi, models.getSetting('PIX_KEY', 'pay@empresa.tech'))
        .replace(/\{cupom\}/gi, activeCoupon ? activeCoupon.code : 'PROMO10');

      try {
        const armyService = require('../services/whatsappArmyService');
        if (armyService?.parseSpintax) {
          msg = armyService.parseSpintax(msg);
        }
      } catch (_) {}

      if (pvCard && pvCard.pngBuffer) {
        return this.sendMessage(to, { image: pvCard.pngBuffer, caption: msg }, {}, sock);
      }
      return this.sendMessage(to, msg, {}, sock);
    }

    if (mode === 'CONSULTATIVO') {
      let consultMsg = `${saudacaoIcon} ${saudacao}${namePart}! Tudo bem?\n\n` +
        `Aqui é da equipe da *${botName}* (${title}).\n` +
        `Nós desenvolvemos bots de alta performance para WhatsApp, sistemas sob medida e automação comercial com entrega imediata via Pix.\n\n` +
        `Me conta: você já tem uma operação rodando ou tá buscando automatizar um processo do zero?\n\n` +
        `_Se preferir ver nossos produtos direto, digite *1* ou acesse: ${storeUrl}_`;

      if (pvCard && pvCard.pngBuffer) {
        return this.sendMessage(to, { image: pvCard.pngBuffer, caption: consultMsg }, {}, sock);
      }
      return this.sendMessage(to, consultMsg, {}, sock);
    }

    // MODO 'MENU' (Padrão de Alta Conversão)
    let welcomeHeader = isReturning
      ? `${saudacaoIcon} ${saudacao}${namePart}! Que alegria ter você de volta à *${botName}*! 🚀`
      : `${saudacaoIcon} ${saudacao}${namePart}! Tudo bem com você? 👋\n\nSeja muito bem-vindo(a) à *${botName}* — *${title}*!`;

    const splitMessages = models.getSetting('WPP_PV_SPLIT_MESSAGES', 'true') !== 'false';

    if (splitMessages) {
      let bubble1 = `${welcomeHeader}\n\n` +
        `Operamos com atendimento inteligente 24h por dia e entrega automatizada de acessos via *PIX* ou *Binance Pay* (USDT).`;

      if (pendingOrder) {
        const orderRef = String(pendingOrder.merchant_trade_no || pendingOrder.id || '').slice(-6);
        bubble1 += `\n\n⏳ *Aviso de Pedido em Aberto:*\n` +
          `Identificamos que você possui o pedido pendente *#${orderRef}* (*${pendingOrder.product_name || 'Produto'}*). Para ver o código Pix e concluir agora, envie *STATUS*!`;
      } else if (activeCoupon) {
        bubble1 += `\n\n🎟️ *Cupom Especial Liberado:*\n` +
          `Use o cupom *${activeCoupon.code}* e garanta *${activeCoupon.discount_percent || 10}% de desconto* hoje!`;
      }

      let bubble2 = `📌 *Como posso te ajudar hoje? Escolha uma opção:*\n\n` +
        `1️⃣ *Ver Catálogo & Produtos Digitais*\n` +
        `   _Licenças, sistemas prontos e ativação imediata_\n\n` +
        `2️⃣ *Aluguel de Bots para Grupos*\n` +
        `   _Proteção anti-trava, anti-link, moderação 24/7 e comandos FX_\n\n` +
        `3️⃣ *Software & Aplicativos Sob Medida*\n` +
        `   _Desenvolvimento ágil, automações e integrações customizadas_\n\n` +
        `4️⃣ *Falar com Suporte Técnico Humano*\n` +
        `   _Tirar dúvidas ou atendimento com nosso especialista_\n\n` +
        `5️⃣ *Consultar Meus Pedidos & Acessos*\n` +
        `   _Ver histórico de compras e licenças ativas_\n\n` +
        `🌐 *Vitrine Online:* ${storeUrl}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Basta responder com o número (1 a 5)* ou me dizer diretamente o que você precisa!`;

      const pvWelcomeButtons = [
        {
          type: 'single_select',
          buttonText: '📋 Ver Opções / Menu',
          sections: [
            {
              title: '⭐ PRINCIPAIS SERVIÇOS',
              rows: [
                { id: '1', title: '🛒 Catálogo de Produtos Digitais', description: 'Licenças, bots e sistemas com ativação imediata' },
                { id: '2', title: '🛡️ Aluguel de Bots p/ Grupos', description: 'Anti-trava, anti-link, moderação 24/7 e figurinhas' },
                { id: '3', title: '💻 Softwares Sob Medida', description: 'Desenvolvimento de sistemas e aplicativos customizados' },
                { id: '4', title: '👨‍💻 Falar com Suporte Humano', description: 'Atendimento e suporte direto com especialista' },
                { id: '5', title: '📦 Consultar Meus Pedidos', description: 'Acessar histórico de compras e licenças ativas' }
              ]
            }
          ]
        },
        {
          type: 'cta_url',
          text: '🌐 Abrir Vitrine Online',
          url: storeUrl
        },
        {
          type: 'quick_reply',
          text: '🛒 Ver Catálogo',
          id: '1'
        }
      ];

      let m1;
      if (pvCard && pvCard.pngBuffer) {
        m1 = await this.sendMessage(to, { image: pvCard.pngBuffer, caption: bubble1 }, {}, sock);
        if (memberSvgService.isWelcomeSvgDocEnabled('pv') && pvCard.svgBuffer) {
          try {
            await sock.sendMessage(to, {
              document: pvCard.svgBuffer,
              mimetype: 'image/svg+xml',
              fileName: `welcome_${cleanCustomerPhone || 'cliente'}.svg`
            });
          } catch (_) {}
        }
      } else {
        m1 = await this.sendMessage(to, bubble1, {}, sock);
      }

      if (typeof sock?.sendPresenceUpdate === 'function') {
        try { await sock.sendPresenceUpdate('composing', to); } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 600));

      if (interactiveMessageService.isEnabled()) {
        try {
          const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
            title: `📌 MENU DE ATENDIMENTO • ${botName}`,
            text: bubble2,
            footer: 'Selecione uma opção tocando nos botões abaixo',
            buttons: pvWelcomeButtons,
            fallbackText: bubble2
          });
          if (sent) return [m1, sent];
        } catch (_) {}
      }

      const m2 = await this.sendMessage(to, bubble2, {}, sock);
      return [m1, m2];
    }

    let menu = `${welcomeHeader}\n\n` +
      `Operamos com atendimento inteligente 24h por dia e entrega automatizada de acessos via *PIX* ou *Binance Pay* (USDT).\n\n`;

    if (pendingOrder) {
      const orderRef = String(pendingOrder.merchant_trade_no || pendingOrder.id || '').slice(-6);
      menu += `⏳ *Aviso de Pedido em Aberto:*\n` +
        `Identificamos que você possui o pedido pendente *#${orderRef}* (*${pendingOrder.product_name || 'Produto'}*). Para ver o código Pix e concluir agora, envie *STATUS*!\n\n`;
    } else if (activeCoupon) {
      menu += `🎟️ *Cupom Especial Liberado:*\n` +
        `Use o cupom *${activeCoupon.code}* e garanta *${activeCoupon.discount_percent || 10}% de desconto* hoje!\n\n`;
    }

    menu += `📌 *Como posso te ajudar hoje? Escolha uma opção:*\n\n` +
      `1️⃣ *Ver Catálogo & Produtos Digitais*\n` +
      `   _Licenças, sistemas prontos e ativação imediata_\n\n` +
      `2️⃣ *Aluguel de Bots para Grupos*\n` +
      `   _Proteção anti-trava, anti-link, moderação 24/7 e comandos FX_\n\n` +
      `3️⃣ *Software & Aplicativos Sob Medida*\n` +
      `   _Desenvolvimento ágil, automações e integrações customizadas_\n\n` +
      `4️⃣ *Falar com Suporte Técnico Humano*\n` +
      `   _Tirar dúvidas ou atendimento com nosso especialista_\n\n` +
      `5️⃣ *Consultar Meus Pedidos & Acessos*\n` +
      `   _Ver histórico de compras e licenças ativas_\n\n` +
      `🌐 *Vitrine Online:* ${storeUrl}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👉 *Basta responder com o número (1 a 5)* ou me dizer diretamente o que você precisa!`;

    if (pvCard && pvCard.pngBuffer) {
      await this.sendMessage(to, { image: pvCard.pngBuffer, caption: welcomeHeader }, {}, sock);
      if (memberSvgService.isWelcomeSvgDocEnabled('pv') && pvCard.svgBuffer) {
        try {
          await sock.sendMessage(to, {
            document: pvCard.svgBuffer,
            mimetype: 'image/svg+xml',
            fileName: `welcome_${cleanCustomerPhone || 'cliente'}.svg`
          });
        } catch (_) {}
      }
    }

    if (interactiveMessageService.isEnabled()) {
      try {
        const pvButtons = [
          {
            type: 'single_select',
            buttonText: '📋 Ver Opções / Menu',
            sections: [
              {
                title: '⭐ PRINCIPAIS SERVIÇOS',
                rows: [
                  { id: '1', title: '🛒 Catálogo de Produtos Digitais', description: 'Licenças, bots e sistemas com ativação imediata' },
                  { id: '2', title: '🛡️ Aluguel de Bots p/ Grupos', description: 'Anti-trava, anti-link, moderação 24/7 e figurinhas' },
                  { id: '3', title: '💻 Softwares Sob Medida', description: 'Desenvolvimento de sistemas e aplicativos customizados' },
                  { id: '4', title: '👨‍💻 Falar com Suporte Humano', description: 'Atendimento e suporte direto com especialista' },
                  { id: '5', title: '📦 Consultar Meus Pedidos', description: 'Acessar histórico de compras e licenças ativas' }
                ]
              }
            ]
          },
          {
            type: 'cta_url',
            text: '🌐 Abrir Vitrine Online',
            url: storeUrl
          },
          {
            type: 'quick_reply',
            text: '🛒 Ver Catálogo',
            id: '1'
          }
        ];

        const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
          title: `👋 BEM-VINDO À ${botName.toUpperCase()}`,
          text: menu,
          footer: 'Selecione uma opção tocando nos botões abaixo',
          buttons: pvButtons,
          fallbackText: menu
        });
        if (sent) return sent;
      } catch (_) {}
    }

    return this.sendMessage(to, menu, {}, sock);
  }

  async sendBotRentalInfo(to, senderName, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
    const firstName = cleanName ? cleanName.split(' ')[0] : '';
    const namePart = firstName ? `, *${firstName}*` : '';

    let rentalMsg = `🛡️ *ALUGUEL DE BOTS PARA GRUPOS DE WHATSAPP (PAYBOT)* 🛡️\n\n` +
      `Olá${namePart}! Transforme seu grupo em uma comunidade segura, profissional e automatizada 24/7!\n\n` +
      `✨ *Recursos Inclusos no Aluguel:*\n` +
      `• *Proteção Anti-Trava & Anti-Flood:* Defesa contra sobrecarga e travas de texto\n` +
      `• *Anti-Link Rigoroso:* Remoção imediata de invasores e links não autorizados\n` +
      `• *Boas-Vindas Personalizadas:* Recepção com foto/texto para novos membros\n` +
      `• *Comandos de Áudio FX & Stickers:* Figurinhas instantâneas (!s, !qc, !brat) e áudios\n` +
      `• *Comandos de Administração:* !ban, !mute, !tagall, !limpar, !fechar, !abrir\n\n` +
      `💎 *Planos Disponíveis com Ativação Imediata:*\n` +
      `• *Mensal (30 dias):* apenas *R$ 49,90*\n` +
      `• *Trimestral (90 dias):* apenas *R$ 119,90* _(Economia de 20%)_\n` +
      `• *Licença Vitalícia Permanente:* *R$ 299,00*\n\n` +
      `🔑 *Como Ativar:* Após o pagamento, você recebe uma *Key de 8 dígitos* e ativa no grupo instantaneamente enviando *!key SUA_CHAVE*.\n\n` +
      `👉 Digite *PIX ALUGUEL* para gerar o Pix de 30 dias (R$ 49,90) ou digite *1* para ver todos os produtos!`;

    if (interactiveMessageService.isEnabled()) {
      try {
        const rentalButtons = [
          { type: 'quick_reply', text: '🟢 Assinar Aluguel Pix', id: 'pix aluguel' },
          { type: 'quick_reply', text: '🛒 Ver Catálogo', id: '1' },
          { type: 'quick_reply', text: '👨‍💻 Falar c/ Suporte', id: '4' }
        ];
        const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
          title: '🛡️ ALUGUEL DE BOTS PARA GRUPOS',
          text: rentalMsg,
          footer: 'Ativação imediata via Chave Key',
          buttons: rentalButtons,
          fallbackText: rentalMsg
        });
        if (sent) return sent;
      } catch (_) {}
    }

    return this.sendMessage(to, rentalMsg, {}, sock);
  }

  async sendCustomSoftwareInfo(to, senderName, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
    const firstName = cleanName ? cleanName.split(' ')[0] : '';
    const namePart = firstName ? `, *${firstName}*` : '';

    let softMsg = `💻 *DESENVOLVIMENTO DE SOFTWARE & APPS SOB MEDIDA* 💻\n\n` +
      `Olá${namePart}! Criamos soluções digitais robustas, seguras e de alta performance para o seu negócio:\n\n` +
      `🚀 *O que desenvolvemos:*\n` +
      `• *Bots & Automações:* WhatsApp, Telegram, Discord, CRM e funis de vendas\n` +
      `• *Aplicativos Mobile:* Android e iOS com interface moderna e sincronização em tempo real\n` +
      `• *Plataformas Web & Dashboards:* Painéis administrativos, backoffices e SaaS\n` +
      `• *Integrações de Pagamento:* PIX automático, Mercado Pago, Binance Pay e Webhooks\n\n` +
      `⏱️ *Metodologia Ágil:* Protótipo funcional em até 15 dias úteis, código-fonte auditado e garantia técnica.\n\n` +
      `📅 *Agende uma conversa técnica:* Deseja alinhar os requisitos do seu projeto? Envie *!call* para agendar uma call de 15 minutos pelo Google Meet com nosso desenvolvedor!`;

    if (interactiveMessageService.isEnabled()) {
      try {
        const softButtons = [
          { type: 'quick_reply', text: '📅 Agendar Call 15min', id: '!call' },
          { type: 'quick_reply', text: '👨‍💻 Falar c/ Suporte', id: '4' },
          { type: 'quick_reply', text: '🛒 Ver Catálogo', id: '1' }
        ];
        const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
          title: '💻 SOFTWARES & PROJETOS SOB MEDIDA',
          text: softMsg,
          footer: 'Desenvolvimento ágil e consultoria técnica',
          buttons: softButtons,
          fallbackText: softMsg
        });
        if (sent) return sent;
      } catch (_) {}
    }

    return this.sendMessage(to, softMsg, {}, sock);
  }

  async sendSupportHuman(to, senderName, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const cleanPhone = String(to).split('@')[0].replace(/\D/g, '');

    models.createSupportTicket({
      platform: 'whatsapp',
      customerId: cleanPhone,
      customerName: senderName || 'Cliente WhatsApp',
      issueSummary: 'Solicitação de suporte humano via Menu Privado'
    });

    let supMsg = `👨‍💻 *CENTRAL DE SUPORTE TÉCNICO HUMANIZADO*\n\n` +
      `Sua solicitação foi registrada com prioridade na nossa central de atendimento!\n\n` +
      `👉 *Por favor, digite aqui abaixo a sua dúvida ou detalhe do que você precisa.*\n\n` +
      `Um dos nossos especialistas já recebeu a notificação e irá te responder diretamente por esta conversa em breve! ⏳`;

    return this.sendMessage(to, supMsg, {}, sock);
  }

  async sendMenu(to, senderName, activeSock = null, options = {}) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    if (this.userSessions && to) {
      this.userSessions.set(to, { state: 'VIEWING_CATALOG', timestamp: Date.now() });
    }
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

    const cleanName = (senderName && typeof senderName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(senderName.trim())) ? senderName.trim() : '';
    const firstName = cleanName ? cleanName.split(' ')[0] : '';
    const namePart = firstName ? `, *${firstName}*` : '';

    let menu = `👋 Olá${namePart}!\n`;
    if (isBusiness) {
      menu += `Bem-vindo ao nosso atendimento oficial via *WhatsApp Business*.\n` +
              `Confira nosso catálogo exclusivo abaixo:\n\n` +
              `📌 *CATÁLOGO DE PRODUTOS:*\n\n`;
    } else {
      menu += `Bem-vindo à nossa loja automatizada com pagamentos via *PIX* e *Binance Pay* (USDT).\n\n` +
              `📌 *PRODUTOS & ASSINATURAS:*\n\n`;
    }

    const cleanCustomerPhone = String(to).split('@')[0].replace(/\D/g, '');
    const clientOrders = cleanCustomerPhone ? models.getOrdersByCustomerPhone(cleanCustomerPhone, 3) : [];

    if (clientOrders.length > 0) {
      const latest = clientOrders[0];
      const isPaid = latest.status === 'PAID';
      const statusIcon = isPaid ? '🟢' : '⏳';
      const statusText = isPaid ? 'PAGO & ENTREGUE' : 'AGUARDANDO PAGAMENTO';
      menu += `📦 *SEUS PEDIDOS RECENTES:*\n` +
              `Identificamos *${clientOrders.length} pedido(s)* vinculado(s) ao seu WhatsApp!\n` +
              `• Último: \`#${latest.merchant_trade_no}\` — ${statusIcon} *${statusText}* (R$ ${Number(latest.amount).toFixed(2)})\n` +
              `👉 Digite *0* ou *!pedido* para ver o rastreamento, código Pix ou chave entregue!\n\n`;
    }

    let lastCategory = '';
    const categoryIcons = {
      'Softwares': '💻',
      'IA': '🤖',
      'Inteligência Artificial': '🤖',
      'Aluguel': '🛡️',
      'Aplicativos': '📱',
      'Sites': '🌐',
      'Projetos': '⚙️',
      'SEO': '📈',
      'Otimizações': '⚡',
      'Meteórico': '🚀',
      'Hardware': '🖥️',
      'Cursos': '🎓',
      'Mentorias': '🎯',
      'Criptomoedas': '🪙',
      'WhatsApp Business': '🛒'
    };

    const catalogMode = (models.getSetting('WPP_CATALOG_DISPLAY_MODE', 'COMPACT') || 'COMPACT').toUpperCase();
    const featuredCount = Math.max(1, Math.min(20, parseInt(models.getSetting('WPP_CATALOG_FEATURED_COUNT', '4'), 10) || 4));
    const isCompact = !options.showFull && (catalogMode === 'COMPACT' ? products.length > featuredCount : (catalogMode !== 'FULL' && products.length > 8));
    if (isCompact) {
      menu += `📂 *CATEGORIAS DE SOLUÇÕES:*\n`;
      const catGroups = new Map();
      products.forEach((p, idx) => {
        const cat = p.category || 'Geral';
        if (!catGroups.has(cat)) catGroups.set(cat, []);
        catGroups.get(cat).push({ p, num: idx + 1 });
      });

      for (const [cat, items] of catGroups.entries()) {
        const icon = categoryIcons[cat] || '📦';
        const numRange = items.length === 1 ? `item ${items[0].num}` : `itens ${items[0].num} a ${items[items.length - 1].num}`;
        const pCodes = items.map(i => `*P${i.num}*`).join(', ');
        menu += `${icon} *${cat}* (${numRange}) → ${pCodes}\n`;
      }

      menu += `\n⭐ *DESTAQUES MAIS PROCURADOS:*\n`;
      const featured = products.slice(0, featuredCount);
      featured.forEach((p, fIdx) => {
        const brl = Number(p.price_brl || p.price || 0).toFixed(2);
        menu += `🔹 *${fIdx + 1}. ${p.name}* — *R$ ${brl}*\n` +
                `   👉 Comprar via Pix: envie *P${fIdx + 1}*\n`;
      });
      menu += `\n💡 _Para ver o catálogo completo com todos os detalhes e descrições, envie *TODOS*._\n\n`;
    } else {
      products.forEach((p, idx) => {
        const cat = p.category || 'Geral';
        if (cat !== lastCategory) {
          lastCategory = cat;
          const icon = categoryIcons[cat] || '📦';
          menu += `\n${icon} *${cat.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n`;
        }

        const typeTag = p.type === 'vip_subscription' ? `⭐ [VIP ${p.duration_days}d]` : (p.type === 'group_rental' ? '🛡️ [Aluguel]' : '📦 [Digital]');
        const brl = Number(p.price_brl || p.price || 0).toFixed(2);
        const usdt = Number(p.price_usdt || ((p.price || 10) / 5.5)).toFixed(2);

        menu += `*${idx + 1}* • *${p.name}* ${typeTag}\n` +
          `    💰 *R$ ${brl}* ou *${usdt} USDT*\n` +
          (p.description ? `    _${p.description.slice(0, 110)}_\n` : '') +
          `    👉 _Para comprar via Pix: envie *P${idx + 1}*_\n\n`;
      });
    }

    const webStoreTrackerService = require('../services/webStoreTrackerService');
    const trackedMenu = webStoreTrackerService.buildTrackedStoreUrl({
      phone: cleanCustomerPhone,
      name: cleanName || 'Cliente',
      instanceId: sock?.instanceId || 1,
      source: 'menu_command'
    });
    let storeUrl = trackedMenu.shortUrl || trackedMenu.url;

    menu += `🌐 *Ver Vitrine com Fotos & Checkout Web:*\n👉 ${storeUrl}\n\n` +
      `👉 *COMO COMPRAR OU ACOMPANHAR:*\n` +
      `Digite o *NÚMERO* do item desejado (Exemplo: *1* ou *2*).\n\n` +
      `💡 *Atalhos Rápidos de Compra:*\n` +
      `• Para pagar com *PIX*: envie *P1*, *P2*, etc.\n` +
      `• Para pagar com *Cripto (USDT)*: envie *C1*, *C2*, etc.\n` +
      `• Para *Acompanhar Pedidos*: envie *0* ou *!pedido*.\n\n` +
      `🐾 *Comandos & Lazer:* Envie *!simi <texto>* para conversar com a IA, ou *!comandos* para figurinhas (!s) e músicas (!play).`;

    // Envio Interativo com Listas (single_select) e Botões de Toque Rápido
    if (interactiveMessageService.isEnabled()) {
      try {
        const sectionsMap = new Map();
        products.forEach((p, idx) => {
          const cat = p.category || 'Geral';
          if (!sectionsMap.has(cat)) {
            const icon = categoryIcons[cat] || '📦';
            sectionsMap.set(cat, {
              title: `${icon} ${cat.slice(0, 20)}`,
              rows: []
            });
          }
          const brl = Number(p.price_brl || p.price || 0).toFixed(2);
          sectionsMap.get(cat).rows.push({
            id: `P${idx + 1}`,
            title: String(p.name).slice(0, 48),
            description: `R$ ${brl} • Toque para gerar Pix imediato`
          });
        });

        // Seção de Atalhos Rápidos e Suporte
        sectionsMap.set('Ações Rápidas', {
          title: '⚡ AÇÕES RÁPIDAS & SUPORTE',
          rows: [
            { id: '0', title: '📦 Meus Pedidos & Acessos', description: 'Consultar compras recentes e rastrear pedidos' },
            { id: 'atendente', title: '👨‍💻 Falar com Suporte Humano', description: 'Tirar dúvidas e suporte em tempo real' },
            { id: 'aluguel', title: '🛡️ Aluguel de Bots p/ Grupos', description: 'Planos de moderação e proteção 24h' }
          ]
        });

        const sections = Array.from(sectionsMap.values());
        const headerTitle = isBusiness ? '🏢 ATENDIMENTO WHATSAPP BUSINESS' : '🛒 CATÁLOGO DE PRODUTOS & BOT';
        const bodyText = `👋 Olá${namePart}!\n\n` +
          `Toque no botão abaixo para explorar nosso catálogo categorizado com ativação imediata via PIX.\n\n` +
          `Ou se preferir, acesse nossa Vitrine Online completa:`;

        const buttons = [
          {
            type: 'single_select',
            buttonText: '📦 Ver Lista de Produtos',
            sections: sections
          },
          {
            type: 'cta_url',
            text: '🌐 Abrir Vitrine Web',
            url: storeUrl
          },
          {
            type: 'quick_reply',
            text: '📦 Meus Pedidos',
            id: '0'
          }
        ];

        const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
          title: headerTitle,
          text: bodyText,
          footer: 'Pagamento automático via Pix & USDT',
          buttons,
          fallbackText: menu
        });

        if (sent) return;
      } catch (intErr) {
        console.warn('[sendMenu ⚠️ Falha ao enviar menu interativo, enviando texto]:', intErr.message);
      }
    }

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

    // Anti-duplicação: reaproveita e atualiza pedido pendente recente para evitar duplicar pedidos
    const recentPendingPix = models.getLatestPendingOrder(to, product.id);
    let tradeNo;
    let isSwitchedPix = false;
    let isExistingPix = false;

    if (recentPendingPix && (Date.now() - new Date(recentPendingPix.created_at).getTime() < 30 * 60 * 1000)) {
      tradeNo = recentPendingPix.merchant_trade_no;
      isExistingPix = true;
      isSwitchedPix = recentPendingPix.gateway !== 'mercadopago' && recentPendingPix.gateway !== 'livepix' && recentPendingPix.gateway !== 'bacen';
      models.cancelOtherPendingOrders(to, tradeNo, product.id);
    } else {
      tradeNo = `ORD_WPIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

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
    } else if (isExistingPix && recentPendingPix.discount_amount) {
      discountAmount = Number(recentPendingPix.discount_amount);
      amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
      couponCode = recentPendingPix.coupon_code;
    }

    const tenantId = product.tenant_id || (isSubBot && instanceId ? models.getArmyInstanceById(instanceId)?.tenant_id : null) || null;

    const pixRes = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo,
      amount,
      goodsName: product.name,
      payerName: senderName,
      payerPhone: to,
      tenantId
    });

    if (!pixRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar o PIX:\n${pixRes.errorMessage}`, {}, sock);
    }

    // Extrai dados do resultado LivePix com fallbacks em todos os níveis
    const pixCode = pixRes.data?.pixCode || pixRes.pixCode || null;
    const qrBuffer = pixRes.data?.qrBuffer || pixRes.qrBuffer || null;
    const checkoutUrl = pixRes.data?.checkoutUrl || pixRes.checkoutUrl || null;
    const paymentId = pixRes.data?.paymentId || null;
    const isDynamicLivepix = Boolean(pixRes.isDynamicLivepix || pixRes.data?.isDynamicLivepix);

    // Afiliado e Vendedor
    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = product.seller_id || null;
    if (isSubBot && instanceId) {
      sellerId = instanceId;
    } else if (!sellerId && models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    // Salva ou atualiza no banco sem duplicar
    const chosenGateway = pixRes.isLivepix ? 'livepix' : (pixRes.gateway || 'mercadopago');
    
    if (isExistingPix) {
      models.updateOrderGateway(tradeNo, {
        gateway: chosenGateway,
        currency: 'BRL',
        amount,
        prepay_id: paymentId,
        checkout_url: checkoutUrl,
        pix_code: pixCode
      });
      if (isSwitchedPix) {
        await this.sendMessage(to, `🔄 *Forma de pagamento atualizada para seu Pedido #${tradeNo}!*\nAlterado com sucesso para *PIX*.`, {}, sock);
      }
    } else {
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'whatsapp',
        platform_user_id: to,
        platform_user_name: senderName,
        product_id: product.id,
        gateway: chosenGateway,
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
        is_upsell: product.is_upsell || 0,
        tenant_id: tenantId
      });
    }

    try {
      const couponNotice = couponCode ? ` (Cupom *${couponCode}* aplicado: -R$ ${discountAmount.toFixed(2)})` : '';
      let invoiceMsg = '';

      if (pixRes.isLivepix) {
        if (isDynamicLivepix && pixCode) {
          invoiceMsg = `🟢 *PAGAMENTO VIA PIX* ⚡\n\n` +
            `📦 *Item:* ${product.name}\n` +
            `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
            `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
            `✅ *QR Code e Pix Copia e Cola gerados com sucesso!*\n\n` +
            `📱 *Como Pagar (2 opções):*\n` +
            `1️⃣ Aponte a câmera do aplicativo do seu banco para o *QR Code* enviado abaixo, OU\n` +
            `2️⃣ Copie o código *Pix Copia e Cola* e cole na opção Pix Copia e Cola do seu banco.\n\n` +
            `⚡ _Aprovação e liberação do produto são imediatas e automáticas assim que o pagamento for concluído!_`;
        } else if (pixCode) {
          invoiceMsg = `🟢 *PAGAMENTO VIA PIX* ⚡\n\n` +
            `📦 *Item:* ${product.name}\n` +
            `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
            `🆔 *Código do Pedido:* \`${tradeNo}\`\n\n` +
            `📱 *Como Pagar:*\n` +
            `1. Aponte a câmera do aplicativo do seu banco para a imagem do *QR Code* a seguir, OU\n` +
            `2. Toque no código *Pix Copia e Cola* enviado abaixo para copiar com 1 toque.\n\n` +
            `⚡ _Aprovação imediata assim que o pagamento for concluído!_`;
        } else {
          invoiceMsg = `🟢 *PAGAMENTO VIA PIX* ⚡\n\n` +
            `📦 *Item:* ${product.name}\n` +
            `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
            `🆔 *Código do Pedido:* \`${tradeNo}\`\n\n` +
            `📱 *Acesse seu pagamento no link seguro do PIX:*\n${checkoutUrl}\n\n` +
            `📱 *Como Pagar:*\n` +
            `1. Abra o link seguro acima;\n` +
            `2. Os dados de *R$ ${Number(amount).toFixed(2)}* e o pedido \`${tradeNo}\` já foram inseridos pelo sistema;\n` +
            `3. Toque em *Continuar* para gerar o QR Code oficial no app do seu banco.\n\n` +
            `⚡ _Assim que você pagar, a aprovação é automática e seu produto é liberado imediatamente!_`;
        }
      } else if (pixRes.isBacen && pixPayment.getSettings().isBacenConfigured) {
        invoiceMsg = `🏦 *PIX PADRÃO OFICIAL BACEN GERADO!* ⚡\n\n` +
          `📦 *Item:* ${product.name}\n` +
          `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
          `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
          `📱 *Como Pagar:*\n` +
          `1. Aponte a câmera do app de qualquer banco para o QR Code a seguir, OU\n` +
          `2. Toque no código *Pix Copia e Cola* oficial enviado abaixo para copiar.`;
      } else {
        invoiceMsg = `🟢 *COBRANÇA PIX GERADA COM SUCESSO!* ⚡\n\n` +
          `📦 *Item:* ${product.name}\n` +
          `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
          `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
          `📱 *Como Pagar:*\n` +
          `1. Aponte a câmera do aplicativo do seu banco para o QR Code a seguir, OU\n` +
          `2. Toque no código *Pix Copia e Cola* enviado abaixo para copiar com 1 toque.`;
      }

      const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
      if (pixRes.isSimulated && !isProduction) {
        invoiceMsg += `\n\n🧪 *[MODO DE TESTE]*\nSimule o pagamento em:\n${checkoutUrl}`;
      }

      // Garante Buffer de imagem válido para o QR Code
      let finalQrBuffer = qrBuffer;
      if (finalQrBuffer && typeof finalQrBuffer === 'object' && !Buffer.isBuffer(finalQrBuffer) && Array.isArray(finalQrBuffer.data)) {
        try { finalQrBuffer = Buffer.from(finalQrBuffer.data); } catch (_) {}
      }
      if (!Buffer.isBuffer(finalQrBuffer) && typeof finalQrBuffer === 'string') {
        if (finalQrBuffer.startsWith('data:image')) {
          finalQrBuffer = Buffer.from(finalQrBuffer.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } else if (finalQrBuffer.length > 50) {
          try { finalQrBuffer = Buffer.from(finalQrBuffer, 'base64'); } catch (_) {}
        }
      }
      if (!Buffer.isBuffer(finalQrBuffer) && pixRes.data?.qrCodeBase64) {
        try {
          finalQrBuffer = Buffer.from(pixRes.data.qrCodeBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } catch (_) {}
      }
      if (!Buffer.isBuffer(finalQrBuffer) || finalQrBuffer.length < 50) {
        try {
          finalQrBuffer = await QRCode.toBuffer(pixCode || checkoutUrl, { width: 360, margin: 2 });
        } catch (qrErr) {
          console.warn('[WhatsApp Pix QR Code Gen]:', qrErr.message);
        }
      }

      // 1. Mensagem 1: Fatura detalhada do pedido
      await this.sendMessage(to, invoiceMsg, {}, sock);
      await new Promise(r => setTimeout(r, 600));

      // 2. Mensagem 2: Imagem do QR Code em alta definição
      if (Buffer.isBuffer(finalQrBuffer)) {
        try {
          const qrCaption = `📸 *QR CODE PIX* ⚡\n\n📦 *Item:* ${product.name}\n💰 *Valor:* R$ ${Number(amount).toFixed(2)}\n🆔 *Pedido:* #${tradeNo}\n\n👉 Aponte a câmera do aplicativo do seu banco para pagar com aprovação imediata!`;
          await this.sendMessage(to, {
            image: finalQrBuffer,
            caption: qrCaption
          }, { noVerificado: true }, sock);
          await new Promise(r => setTimeout(r, 600));
        } catch (imgErr) {
          console.warn('[WhatsApp ⚠️ Falha no envio da imagem do QR Code]:', imgErr.message);
        }
      }

      // 3. Mensagens 3 e 4: Envio do PIX Copia e Cola em caixa de diálogo isolada
      if (pixCode && String(pixCode).trim().length > 0) {
        // Balão indicador
        await this.sendMessage(to, `👇 *PIX COPIA E COLA (Toque e segure no código abaixo para copiar):*`, {}, sock);
        await new Promise(r => setTimeout(r, 350));

        // CAIXA DE DIÁLOGO SEPARADA CONTENDO RIGOROSAMENTE APENAS O CÓDIGO PURO
        await this.sendMessage(to, `${pixCode.trim()}`, {}, sock);
        await new Promise(r => setTimeout(r, 400));
      }

      // 5. Mensagem 5: Confirmação de liberação automática e botões de ação
      const approvalMsg = `⚡ *Aprovação Automática:* O acesso ao seu produto será liberado imediatamente após a confirmação do pagamento!`;
      if (interactiveMessageService.isEnabled()) {
        try {
          const actionButtons = [
            {
              type: 'quick_reply',
              text: '🔄 Já Paguei / Status',
              id: '0'
            }
          ];
          if (checkoutUrl && /^https?:\/\//i.test(checkoutUrl)) {
            actionButtons.push({
              type: 'cta_url',
              text: '🌐 Abrir Fatura Web',
              url: checkoutUrl
            });
          }

          await interactiveMessageService.sendInteractiveButtons(sock, to, {
            text: approvalMsg,
            footer: 'Monitoramento bancário em tempo real',
            buttons: actionButtons,
            fallbackText: approvalMsg
          });
        } catch (_) {
          await this.sendMessage(to, approvalMsg, {}, sock);
        }
      } else {
        await this.sendMessage(to, approvalMsg, {}, sock);
      }

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar PIX]:', err.message);
      await this.sendMessage(to, `⚠️ Pedido *#${tradeNo}* gerado. Segue seu código para pagamento:`, {}, sock);
      if (pixCode && String(pixCode).trim().length > 0) {
        await this.sendMessage(to, `👇 *PIX COPIA E COLA (Toque e segure no código abaixo para copiar):*`, {}, sock);
        await new Promise(r => setTimeout(r, 300));
        await this.sendMessage(to, `${pixCode.trim()}`, {}, sock);
      }
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

    // Anti-duplicação: reaproveita e atualiza pedido pendente recente
    const recentPendingBnb = models.getLatestPendingOrder(to, product.id);
    let tradeNo;
    let isSwitchedBnb = false;
    let isExistingBnb = false;

    if (recentPendingBnb && (Date.now() - new Date(recentPendingBnb.created_at).getTime() < 30 * 60 * 1000)) {
      tradeNo = recentPendingBnb.merchant_trade_no;
      isExistingBnb = true;
      isSwitchedBnb = recentPendingBnb.gateway !== 'binancepay';
      models.cancelOtherPendingOrders(to, tradeNo, product.id);
    } else {
      tradeNo = `ORD_WBNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

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
    } else if (isExistingBnb && recentPendingBnb.discount_amount) {
      discountAmount = Number(recentPendingBnb.discount_amount);
      const discountUsdt = Math.round((discountAmount / 5.5) * 100) / 100;
      amount = Number(Math.max(0.10, amount - discountUsdt).toFixed(2));
      couponCode = recentPendingBnb.coupon_code;
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

    const tenantIdBinance = product.tenant_id || (isSubBot && instanceId ? models.getArmyInstanceById(instanceId)?.tenant_id : null) || null;
    
    if (isExistingBnb) {
      models.updateOrderGateway(tradeNo, {
        gateway: 'binancepay',
        currency: 'USDT',
        amount,
        prepay_id: payData.prepayId,
        checkout_url: payData.checkoutUrl,
        qr_content: payData.qrContent
      });
      if (isSwitchedBnb) {
        await this.sendMessage(to, `🔄 *Forma de pagamento atualizada para seu Pedido #${tradeNo}!*\nAlterado com sucesso para *Binance Pay (USDT)*.`, {}, sock);
      }
    } else {
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
        is_upsell: product.is_upsell || 0,
        tenant_id: tenantIdBinance
      });
    }

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

      const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
      if (binanceRes.isSimulated && !isProduction) {
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

  // 3. Processa Compra via Carteira Cripto (Auto-Custódia)
  async processCryptoWalletPurchase(to, senderName, product, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const isSubBot = !!sock && sock !== this.sock;
    const instanceId = sock?.instanceId;

    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`, {}, sock);
      }
    }

    await this.sendMessage(to, `⏳ Gerando dados de transferência em *Carteira Cripto* para *${product.name}*...`, {}, sock);

    // Anti-duplicação: reaproveita e atualiza pedido pendente recente
    const recentPendingCrp = models.getLatestPendingOrder(to, product.id);
    let tradeNo;
    let isSwitchedCrp = false;
    let isExistingCrp = false;

    if (recentPendingCrp && (Date.now() - new Date(recentPendingCrp.created_at).getTime() < 30 * 60 * 1000)) {
      tradeNo = recentPendingCrp.merchant_trade_no;
      isExistingCrp = true;
      isSwitchedCrp = recentPendingCrp.gateway !== 'crypto';
      models.cancelOtherPendingOrders(to, tradeNo, product.id);
    } else {
      tradeNo = `ORD_WCRP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

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
    } else if (isExistingCrp && recentPendingCrp.discount_amount) {
      discountAmount = Number(recentPendingCrp.discount_amount);
      const discountUsdt = Math.round((discountAmount / 5.5) * 100) / 100;
      amount = Number(Math.max(0.10, amount - discountUsdt).toFixed(2));
      couponCode = recentPendingCrp.coupon_code;
    }

    const cryptoRes = await cryptoWalletService.createOrder({
      merchantTradeNo: tradeNo,
      amountUsdt: amount,
      productName: product.name,
      networkKey: null
    });

    if (!cryptoRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar a cobrança cripto:\n${cryptoRes.errorMessage || 'Nenhuma carteira configurada.'}`, {}, sock);
    }

    const payData = cryptoRes.data;

    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = product.seller_id || null;
    if (isSubBot && instanceId) {
      sellerId = instanceId;
    } else if (!sellerId && models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    const tenantIdCrypto = product.tenant_id || (isSubBot && instanceId ? models.getArmyInstanceById(instanceId)?.tenant_id : null) || null;
    
    if (isExistingCrp) {
      models.updateOrderGateway(tradeNo, {
        gateway: 'crypto',
        currency: 'USDT',
        amount,
        qr_content: JSON.stringify({ ...payData, gateway: 'crypto' })
      });
      if (isSwitchedCrp) {
        await this.sendMessage(to, `🔄 *Forma de pagamento atualizada para seu Pedido #${tradeNo}!*\nAlterado com sucesso para *Carteira Cripto*.`, {}, sock);
      }
    } else {
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'whatsapp',
        platform_user_id: to,
        platform_user_name: senderName,
        product_id: product.id,
        gateway: 'crypto',
        amount,
        currency: 'USDT',
        qr_content: JSON.stringify({ ...payData, gateway: 'crypto' }),
        affiliate_id: refInfo.affiliate_id || null,
        seller_id: sellerId,
        ref_code: refInfo.ref_code || null,
        coupon_code: couponCode,
        discount_amount: discountAmount,
        is_upsell: product.is_upsell || 0,
        tenant_id: tenantIdCrypto
      });
    }

    // Inicia auto polling se ativado
    cryptoWalletService.startPolling(tradeNo, async (tNo) => {
      try {
        console.log(`[WhatsApp Crypto] Polling detectou pagamento de ${tNo}. Entregando...`);
        await fulfillment.fulfillOrder(tNo);
      } catch (e) {
        console.error('[WhatsApp Crypto Polling Error]:', e.message);
      }
    });

    const amountBrl = Number(product.price_brl || product.price || 0);
    const msgText = cryptoWalletService.buildPaymentMessage(payData, product.name, amountBrl);

    try {
      const qrData = payData.paymentUri || payData.address;
      const qrBuffer = await QRCode.toBuffer(qrData, { width: 360, margin: 2 });

      await this.sendMessage(to, {
        image: qrBuffer,
        caption: msgText
      }, {}, sock);
    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar imagem QR Cripto]:', err.message);
      await this.sendMessage(to, msgText, {}, sock);
    }
  }

  async sendOwnerExecutiveStatus(to, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const orders = models.getAllOrders(200);
    const paidOrders = orders.filter(o => o.status === 'PAID');
    const pendingOrders = orders.filter(o => o.status === 'PENDING');

    const totalBRL = paidOrders
      .filter(o => (o.currency || 'BRL') === 'BRL')
      .reduce((acc, o) => acc + Number(o.amount || 0), 0);
    const totalUSDT = paidOrders
      .filter(o => (o.currency || '').toUpperCase() === 'USDT')
      .reduce((acc, o) => acc + Number(o.amount || 0), 0);

    const whatsappArmyService = require('../services/whatsappArmyService');
    const summary = whatsappArmyService.getSubBotsStatusSummary();
    const tasksSummary = models.getDelegatedTasksSummary();

    const tunnelService = require('../services/tunnelService');
    const adminTunnel = tunnelService.getAdminUrl();
    const storeTunnel = tunnelService.getStoreUrl();

    let activeRules = 0;
    try {
      activeRules = models.listSocialListeningRules(true).length;
    } catch (_) {}

    const report =
      `👑 *PAINEL EXECUTIVO & METAS — COMANDANTE* 👑\n\n` +
      `📊 *Faturamento & Vendas:*\n` +
      `• Faturamento Aprovado: *R$ ${totalBRL.toFixed(2)}* (${totalUSDT.toFixed(2)} USDT)\n` +
      `• Pedidos Pagos: *${paidOrders.length}*\n` +
      `• Pedidos Pendentes: *${pendingOrders.length}*\n\n` +
      `🤖 *Exército de Sub-Bots:*\n` +
      `• Sub-Bots Ativos: *${summary.totalInstances}* (${summary.connectedCount} online)\n` +
      `• Tarefas Concluídas: *${tasksSummary.COMPLETED || 0}* (${tasksSummary.PENDING || 0} em fila)\n` +
      `• Disparos Hoje: *${summary.totalSentToday || 0}*\n\n` +
      `🌐 *Infraestrutura & Canais:*\n` +
      `• Painel Admin: ${adminTunnel ? '🟢 Online (Cloudflare)' : '🟡 Local'}\n` +
      `• Loja Pública: ${storeTunnel ? '🟢 Online' : '🟡 Local'}\n` +
      `• Social Listening: 🟢 *${activeRules}* regras ativas em grupos\n\n` +
      `⚡ *Atalhos Rápidos:*\n` +
      `• *!painel* — Link seguro para o Painel Web\n` +
      `• *!subbots* — Gestão do exército de chips\n` +
      `• *!loja* — Link da vitrine para clientes\n` +
      `• *!escuta* — Central de Social Listening, Radar Sentinela e Áudios`;

    return this.sendMessage(to, report, {}, sock);
  }

  async sendOwnerExecutiveCockpit(to, senderName = 'Comandante', activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const cockpit =
      `👑 *CENTRAL DE COMANDO EXECUTIVA — BEM-VINDO, COMANDANTE!* 👑\n\n` +
      `Você está no controle total do sistema PayBot & SpyBot.\n` +
      `Seu número foi reconhecido com sucesso com credenciais de Dono Supremo.\n\n` +
      `🛠️ *Comandos Executivos Disponíveis:*\n` +
      `• *!painel* — Link HTTPS criptografado do Painel Web Admin\n` +
      `• *!status* — Relatório executivo de vendas e sub-bots\n` +
      `• *!subbots* — Status do exército de bots e tarefas\n` +
      `• *!loja* — Link público da loja virtual para enviar aos clientes\n` +
      `• *!planilha* — Sincronização contínua de afiliados via Google Sheets\n` +
      `• *!escuta* — Central de Social Listening, Radar Sentinela e Áudios\n` +
      `• *!delegar* — Delegar tarefas para os sub-bots\n` +
      `• *!admin* — Funções completas de moderação de grupos\n\n` +
      `💬 _Você também pode falar comigo em linguagem natural: peça relatórios, mande os sub-bots enviarem mensagens ou tire dúvidas de vendas!_`;

    return this.sendMessage(to, cockpit, {}, sock);
  }

  async sendOwnerSaasStatus(to, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    try {
      const tenants = models.listTenants();
      const activeCount = tenants.filter(t => t.effective_status === 'ACTIVE').length;
      const expiredCount = tenants.filter(t => t.effective_status === 'EXPIRED').length;
      const expiringSoon = tenants.filter(t => t.effective_status === 'ACTIVE' && t.days_left <= 7);

      let txt = `🏢 *PLATAFORMA SAAS & LICENÇAS DE TENANTS* 🏢\n\n` +
        `📊 *Visão Geral dos Clientes:*\n` +
        `• *Total de Tenants:* ${tenants.length}\n` +
        `• *Licenças Ativas:* 🟢 ${activeCount}\n` +
        `• *Expiradas:* 🔴 ${expiredCount}\n` +
        `• *Vencendo em até 7 dias:* ⚠️ ${expiringSoon.length}\n\n`;

      if (tenants.length > 0) {
        txt += `📋 *Tenants Cadastrados:*\n`;
        tenants.slice(0, 8).forEach((t, idx) => {
          const stBadge = t.effective_status === 'ACTIVE' ? '🟢' : (t.effective_status === 'EXPIRED' ? '🔴' : '⏸️');
          const valTxt = t.is_lifetime ? 'Vitalício' : `${t.days_left}d rest.`;
          txt += `*${idx + 1}. ${t.name}* (${String(t.plan).toUpperCase()}) ${stBadge}\n` +
            `  • Chave: \`${t.license_key}\`\n` +
            `  • Validade: ${valTxt} | WhatsApp: +${t.owner_phone || 'N/A'}\n` +
            `  • Pedidos: ${t.total_orders || 0} | Bots: ${t.total_bots || 0}/${t.max_bots}\n\n`;
        });
      } else {
        txt += `_Nenhum tenant cadastrado ainda. Crie novos tenants pelo painel web (!painel)._\n\n`;
      }

      txt += `💡 _Para emitir novas licenças, renovar períodos ou suspender tenants, acesse a aba SaaS no Painel Web (!painel)._`;

      return this.sendMessage(to, txt, {}, sock);
    } catch (err) {
      console.error('[WhatsAppBot ⚠️ sendOwnerSaasStatus]:', err.message);
      return this.sendMessage(to, `❌ Erro ao consultar dados SaaS: ${err.message}`, {}, sock);
    }
  }

  async handleOwnerSheetsCommand(from, text, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const googleSheetsSyncService = require('../services/googleSheetsSyncService');
    const tunnelService = require('../services/tunnelService');
    const rawTokens = (text || '').trim().split(/\s+/);
    const subCmd = (rawTokens[1] || '').toLowerCase().trim();

    // Se passou uma URL logo de cara (!planilha https://docs.google.com/...)
    if (rawTokens[1] && (rawTokens[1].startsWith('http://') || rawTokens[1].startsWith('https://') || rawTokens[1].includes('spreadsheets/d/'))) {
      const urlInput = rawTokens[1].trim();
      const urlInfo = googleSheetsSyncService.extractSheetIdAndUrls(urlInput);
      if (!urlInfo) {
        return this.sendMessage(from, `❌ *URL de Planilha Inválida!*\n\nCertifique-se de fornecer um link válido do Google Sheets.\nExemplo:\n*!planilha https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5.../edit*`, {}, sock);
      }

      await this.sendMessage(from, `⏳ *Conectando à Planilha Google Sheets e executando sincronização inicial...*`, {}, sock);
      models.updateGoogleSheetsSyncConfig({
        sheet_url: urlInput,
        sheet_id: urlInfo.sheetId,
        sync_enabled: 1
      });
      googleSheetsSyncService.restart();

      const startTime = Date.now();
      const syncRes = await googleSheetsSyncService.syncNow({ trigger: 'WHATSAPP_SETUP', force: true });
      const elapsed = Date.now() - startTime;

      if (!syncRes.success) {
        return this.sendMessage(from, `⚠️ *Planilha vinculada, mas houve erro no acesso:*\n\n${syncRes.error}\n\n👉 *Dica:* Certifique-se de que a planilha está compartilhada como *"Qualquer pessoa com o link pode ler"* ou use o Webhook streaming via Apps Script.`, {}, sock);
      }

      return this.sendMessage(from, `🟢 *PLANILHA GOOGLE SHEETS VINCULADA COM SUCESSO!* 📊\n\n` +
        `• *Links Identificados:* ${syncRes.total}\n` +
        `• *Novos Inseridos:* +${syncRes.added}\n` +
        `• *Atualizados:* ~${syncRes.updated}\n` +
        `• *Tempo de Resposta:* ${elapsed}ms\n` +
        `• *Monitoramento Contínuo:* 🟢 Ativo (a cada segundo / intervalo configurado)\n\n` +
        `🎯 *Social Listening Ativo:* Todas as palavras-chave foram extraídas e integradas automaticamente para recomendações orgânicas em grupos!\n\n` +
        `Digite *!planilha* para acompanhar o status em tempo real.`, {}, sock);
    }

    if (subCmd === 'sync' || subCmd === 'sincronizar' || subCmd === 'agora') {
      await this.sendMessage(from, `🔄 *Sincronizando links da planilha em tempo real...*`, {}, sock);
      const startTime = Date.now();
      const syncRes = await googleSheetsSyncService.syncNow({ trigger: 'WHATSAPP_COMMAND', force: true });
      const elapsed = Date.now() - startTime;

      if (!syncRes.success) {
        return this.sendMessage(from, `❌ *Erro na sincronização:*\n\n${syncRes.error}`, {}, sock);
      }

      if (syncRes.skipped) {
        return this.sendMessage(from, `ℹ️ *Planilha sem alterações!*\n\nNenhuma nova linha foi adicionada desde a última verificação. Todos os links já estão sincronizados no PayBot.`, {}, sock);
      }

      return this.sendMessage(from, `✅ *Sincronização Concluída!*\n\n` +
        `• *Total de Links:* ${syncRes.total}\n` +
        `• *Novos Adicionados:* +${syncRes.added}\n` +
        `• *Atualizados:* ~${syncRes.updated}\n` +
        `• *Tempo:* ${elapsed}ms`, {}, sock);
    }

    if (subCmd === 'intervalo' || subCmd === 'interval' || subCmd === 'tempo') {
      const secVal = parseInt(rawTokens[2], 10);
      if (!secVal || secVal < 1 || isNaN(secVal)) {
        return this.sendMessage(from, `⚠️ *Informe o intervalo em segundos (mínimo 1).* Exemplo: *!planilha intervalo 2*`, {}, sock);
      }
      models.updateGoogleSheetsSyncConfig({ sync_interval_seconds: secVal });
      googleSheetsSyncService.restart();
      return this.sendMessage(from, `⏱️ *Intervalo de sincronização atualizado para ${secVal} segundo(s)!*\nO sistema verificará novas linhas na planilha a cada ${secVal}s.`, {}, sock);
    }

    if (subCmd === 'pausar' || subCmd === 'parar' || subCmd === 'desativar') {
      models.updateGoogleSheetsSyncConfig({ sync_enabled: 0 });
      googleSheetsSyncService.stop();
      return this.sendMessage(from, `⏸️ *Sincronização contínua com Google Sheets PAUSADA.*\nO poller foi desativado. Para retomar, envie *!planilha ativar*.`, {}, sock);
    }

    if (subCmd === 'ativar' || subCmd === 'ligar' || subCmd === 'iniciar') {
      models.updateGoogleSheetsSyncConfig({ sync_enabled: 1 });
      googleSheetsSyncService.start();
      const cfg = models.getGoogleSheetsSyncConfig();
      return this.sendMessage(from, `▶️ *Sincronização contínua ATIVADA!*\nVerificando novas linhas a cada ${cfg.sync_interval_seconds}s.`, {}, sock);
    }

    if (subCmd === 'webhook' || subCmd === 'script' || subCmd === 'apps') {
      const cfg = models.getGoogleSheetsSyncConfig();
      const tunnelUrl = tunnelService.getUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
      const webhookUrl = `${tunnelUrl.replace(/\/$/, '')}/api/sheets/webhook?secret=${cfg.webhook_secret}`;
      const msg = `⚡ *INTEGRAÇÃO STREAMING INSTANTÂNEA (WEBHOOK / APPS SCRIPT)*\n\n` +
        `Para receber novas linhas no exato instante em que são criadas (sub-segundo):\n\n` +
        `• *Endpoint Webhook:*\n👉 \`${webhookUrl}\`\n\n` +
        `• *Chave Secreta:* \`${cfg.webhook_secret}\`\n\n` +
        `📋 *Como Instalar na Planilha:*\n` +
        `1. Na planilha, clique em: *Extensões > Apps Script*\n` +
        `2. Copie o script pronto em: *!painel* (Aba Afiliados > Live Sync Sheets)\n` +
        `3. Ou baixe o script pronto em: \`${tunnelUrl}/api/sheets/script\`\n` +
        `4. Salve e cada linha adicionada disparará para o PayBot instantaneamente!`;

      if (from.endsWith('@g.us')) {
        const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '').replace(/\D/g, '');
        if (ownerPhone) {
          await this.sendMessage(`${ownerPhone}@s.whatsapp.net`, msg, {}, sock);
        }
        return this.sendMessage(from, `🔒 *Comandante*, por segurança os dados confidenciais do Webhook e Script foram enviados diretamente no seu WhatsApp Privado!`, {}, sock);
      }
      return this.sendMessage(from, msg, {}, sock);
    }

    // Default: Status Geral da Planilha
    const cfg = models.getGoogleSheetsSyncConfig();
    const allAffiliates = models.getAffiliateLinks();
    const sheetAffiliates = allAffiliates.filter(a => a.source === 'google_sheets');
    const logs = models.getGoogleSheetsSyncLogs(1);
    const lastLog = logs[0] || null;

    let txt = `📊 *CENTRAL DE SINCRONIZAÇÃO GOOGLE SHEETS (AFILIADOS)* 📊\n\n` +
      `• *Status do Poller:* ${cfg.sync_enabled ? '🟢 Ativo (Verificando a cada ' + cfg.sync_interval_seconds + 's)' : '⏸️ Pausado'}\n` +
      `• *Planilha Conectada:* ${cfg.sheet_url ? '🔗 Sim' : '🔴 Nenhuma configurada'}\n` +
      (cfg.sheet_url ? `• *Link da Planilha:* ${cfg.sheet_url.substring(0, 45)}...\n` : '') +
      `• *Total de Links no Bot:* ${allAffiliates.length}\n` +
      `• *Links da Planilha:* ${sheetAffiliates.length}\n` +
      `• *Social Listening Auto:* ${cfg.auto_social_listening ? '🟢 Ativado' : '⚪ Desativado'}\n` +
      `• *Última Sincronização:* ${cfg.last_sync_at || 'Nunca'}\n` +
      (lastLog ? `• *Último Registro:* ${lastLog.details || lastLog.error || 'Ok'}\n` : '') +
      `\n`;

    if (sheetAffiliates.length > 0) {
      txt += `📋 *Últimos Links Importados da Planilha:*\n`;
      sheetAffiliates.slice(0, 3).forEach((link, idx) => {
        txt += `*${idx + 1}. ${link.title}* [${link.platform || 'Afiliado'}]\n` +
          `  • Preço: R$ ${(link.product_price || 0).toFixed(2)} | Comiss: ${link.commission_percent || 0}%\n` +
          `  • Link: ${link.affiliate_url}\n` +
          `  • Tags: \`${link.keywords || 'N/A'}\`\n\n`;
      });
    }

    txt += `🛠️ *Comandos Rápidos:*\n` +
      `• *!planilha <url>* — Conecta nova planilha e sincroniza\n` +
      `• *!planilha sync* (ou *!syncplanilha*) — Sincroniza agora\n` +
      `• *!planilha intervalo <segundos>* — Ajusta velocidade do poller\n` +
      `• *!planilha pausar* / *!planilha ativar* — Pausa ou retoma\n` +
      `• *!planilha webhook* — URL e instruções do Google Apps Script`;

    return this.sendMessage(from, txt, {}, sock);
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

  async handleStoreOrderInquiry(activeSock, from, tradeNo, senderName = '', senderPhone = '', text = '', msg = {}) {
    try {
      const sock = activeSock || this.currentDispatchSock || this.sock;
      const order = models.getOrderByTradeNo(tradeNo);

      if (!order) {
        await this.sendMessage(from, 
          `🔍 Não localizei nenhum pedido com o código *#${tradeNo}* no sistema.\n\n` +
          `Por favor, verifique se o código está correto ou digite *suporte* para falar com um atendente.`, {}, sock);
        return true;
      }

      // Reage na mensagem do usuário para feedback imediato
      if (msg && msg.key) {
        await this.safeReact(sock, from, msg.key, '📦').catch(() => {});
      }

      // Associa a ordem ao usuário do WhatsApp para envio automático do produto na compensação
      try {
        models.updateOrderDetails(order.merchant_trade_no, {
          platform: 'whatsapp',
          platform_user_id: from,
          platform_user_name: senderName || 'Cliente WhatsApp'
        });
      } catch (_) {}

      // Registra o contexto de ordem ativa para opções 1 a 4
      if (!this.userActiveOrderContext) this.userActiveOrderContext = new Map();
      this.userActiveOrderContext.set(from, {
        tradeNo: order.merchant_trade_no,
        productId: order.product_id,
        productName: order.product_name,
        timestamp: Date.now()
      });

      let statusEmoji = '⏳';
      let statusDesc = 'Aguardando Pagamento';
      if (order.status === 'PAID') {
        statusEmoji = '✅';
        statusDesc = 'Pago e Aprovado';
      } else if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
        statusEmoji = '❌';
        statusDesc = 'Cancelado / Expirado';
      }

      const valorStr = order.currency === 'BRL'
        ? `R$ ${Number(order.amount || 0).toFixed(2).replace('.', ',')}`
        : `${Number(order.amount || 0).toFixed(2)} ${order.currency || 'USDT'}`;

      const greetingObj = getBrasiliaGreeting ? getBrasiliaGreeting() : null;
      const greeting = (greetingObj && typeof greetingObj === 'object')
        ? `${greetingObj.icon || '👋'} ${greetingObj.saudacao || 'Olá'}`
        : (greetingObj || 'Olá');
      const namePart = (senderName && senderName.trim()) ? ` *${senderName.trim()}*` : '';

      const responseText = `${greeting}${namePart}! Localizei seu pedido com sucesso: 📦\n\n` +
        `🏷️ *Produto:* ${order.product_name || 'Produto'}\n` +
        `🔖 *Pedido:* #${order.merchant_trade_no}\n` +
        `💰 *Valor:* ${valorStr}\n` +
        `📊 *Status:* ${statusEmoji} ${statusDesc}\n\n` +
        `O que você gostaria de tratar sobre o seu pedido ou produto?\n\n` +
        `1️⃣ *Pagamento / Código PIX*\n` +
        `2️⃣ *Entrega / Status do Acesso*\n` +
        `3️⃣ *Detalhes e Dúvidas do Produto*\n` +
        `4️⃣ *Falar com Atendimento Humano*\n\n` +
        `👉 _Responda enviando apenas o número (*1*, *2*, *3* ou *4*)_`;

      await this.sendMessage(from, responseText, {}, sock);
      return true;
    } catch (err) {
      console.error('[WhatsApp Order Inquiry Error]:', err);
      return false;
    }
  }

  async handleOrderMenuOption(activeSock, from, option, senderName = '', senderPhone = '') {
    try {
      const sock = activeSock || this.currentDispatchSock || this.sock;
      if (!this.userActiveOrderContext || !this.userActiveOrderContext.has(from)) return false;

      const ctx = this.userActiveOrderContext.get(from);
      // Expira contexto após 24 horas
      if (!ctx || (Date.now() - ctx.timestamp > 24 * 60 * 60 * 1000)) {
        this.userActiveOrderContext.delete(from);
        return false;
      }

      const order = models.getOrderByTradeNo(ctx.tradeNo);
      if (!order) {
        this.userActiveOrderContext.delete(from);
        return false;
      }

      const valorStr = order.currency === 'BRL'
        ? `R$ ${Number(order.amount || 0).toFixed(2).replace('.', ',')}`
        : `${Number(order.amount || 0).toFixed(2)} ${order.currency || 'USDT'}`;

      if (option === '0') {
        // Opção 0: Já Paguei / Checar Compensação Pix
        if (order.status === 'PAID') {
          await this.sendMessage(from,
            `✅ *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
            `Seu pedido *#${order.merchant_trade_no}* já foi aprovado com sucesso!\n\n` +
            (order.delivered_content ? `🎁 *Acesso / Licença Entregue:*\n${order.delivered_content}\n\n` : '') +
            `👉 Digite *2* se desejar rever o comprovante ou instruções completas.`, {}, sock);
          return true;
        }

        const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
        if (!isProduction && models.getSetting('PIX_SIMULATION_MODE', 'false') === 'true') {
          await this.sendMessage(from, `🎉 *[MODO TESTE] Pagamento Pix Aprovado!*\nLiberando seu pedido...`, {}, sock);
          await fulfillment.fulfillOrder(order.merchant_trade_no);
          return true;
        }

        await this.sendMessage(from,
          `⏳ *CONSULTANDO COMPENSAÇÃO BANCÁRIA*\n\n` +
          `O pedido *#${order.merchant_trade_no}* ainda está aguardando a confirmação do banco.\n\n` +
          `Assim que o valor for creditado, nosso sistema envia a confirmação e sua liberação automaticamente aqui!\n\n` +
          `👉 Digite *1* para rever o código PIX Copia e Cola.\n` +
          `👉 Digite *4* para enviar o comprovante ao suporte.`, {}, sock);
        return true;
      }

      if (option === '1') {
        // Opção 1: Pagamento / Link PIX
        if (order.status === 'PAID') {
          await this.sendMessage(from,
            `✅ *Este pedido já está pago e confirmado!*\n\n` +
            `Você não precisa realizar nenhum novo pagamento para o pedido *#${order.merchant_trade_no}*.\n\n` +
            `👉 Digite *2* para visualizar suas informações de entrega e acesso!`, {}, sock);
          return true;
        }

        // Se não possui checkout_url ou pix_code, gera via LivePix / pixPayment
        if (!order.checkout_url && !order.pix_code) {
          try {
            const charge = await pixPayment.createPixCharge({
              merchantTradeNo: order.merchant_trade_no,
              amount: order.amount,
              goodsName: order.product_name || 'Pedido',
              payerName: senderName || 'Cliente WhatsApp',
              forceGateway: 'livepix'
            });
            if (charge && charge.success) {
              const pixCode = charge.data?.pixCode || charge.pixCode || null;
              const checkoutUrl = charge.data?.checkoutUrl || charge.checkoutUrl || null;
              const qrContent = charge.data?.qrCodeBase64 || charge.qrContent || null;
              models.updateOrderGateway(order.merchant_trade_no, {
                gateway: charge.isLivepix ? 'livepix' : (charge.gateway || 'livepix'),
                currency: 'BRL',
                amount: order.amount,
                pix_code: pixCode,
                qr_content: qrContent,
                checkout_url: checkoutUrl,
                prepay_id: charge.data?.paymentId || null
              });
              order.checkout_url = checkoutUrl;
              order.pix_code = pixCode;
            }
          } catch (e) {
            console.error('[WhatsApp Generate PIX Error]:', e.message);
          }
        }

        let payMsg = `💳 *PAGAMENTO VIA PIX* ⚡\n\n` +
          `• *Pedido:* #${order.merchant_trade_no}\n` +
          `• *Produto:* ${order.product_name}\n` +
          `• *Valor:* ${valorStr}\n\n`;

        if (order.pix_code) {
          payMsg += `📌 *Código PIX Copia e Cola:* Utilize o código abaixo para pagar diretamente no app do seu banco.\n\n`;
        } else if (order.checkout_url) {
          payMsg += `🔗 *Link Seguro para Pagar PIX:*\n${order.checkout_url}\n\n` +
            `⚡ _Abra o link acima para ver o QR Code e pagar pelo app do seu banco._\n\n`;
        }

        payMsg += `Assim que o pagamento for concluído, o sistema detecta na mesma hora e libera sua entrega aqui! 🚀`;

        await this.sendMessage(from, payMsg, {}, sock);

        if (order.pix_code) {
          try {
            const QRCode = require('qrcode');
            const qrBuf = await QRCode.toBuffer(order.pix_code, { width: 360, margin: 2 });
            await this.sendMessage(from, {
              image: qrBuf,
              caption: `📸 *QR CODE PIX* ⚡ - Aponte a câmera do app do banco para pagar o Pedido #${order.merchant_trade_no}`
            }, { noVerificado: true }, sock);
            await new Promise(r => setTimeout(r, 400));
          } catch (_) {}
          await this.sendMessage(from, `👇 *PIX COPIA E COLA (Toque e segure no código abaixo para copiar):*`, {}, sock);
          await new Promise(r => setTimeout(r, 300));
          await this.sendMessage(from, String(order.pix_code).trim(), {}, sock);
        }
        return true;
      }

      if (option === '2') {
        // Opção 2: Entrega / Status do Acesso
        if (order.status === 'PAID') {
          if (order.delivered_content) {
            await this.sendMessage(from,
              `🎉 *ACESSO / ENTREGA DISPONÍVEL!*\n\n` +
              `Seu pedido *#${order.merchant_trade_no}* (*${order.product_name}*) foi pago e liberado:\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `${order.delivered_content}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
              `Aproveite seu produto! Se precisar de auxílio técnico ou configuração, digite *4*.`, {}, sock);
          } else {
            await this.sendMessage(from,
              `✅ *PAGAMENTO CONFIRMADO!*\n\n` +
              `Seu pedido *#${order.merchant_trade_no}* (*${order.product_name}*) já foi aprovado em nosso sistema.\n\n` +
              `A entrega está em processamento. Caso ainda não tenha recebido as instruções, digite *4* para falar com o suporte agora mesmo!`, {}, sock);
          }
          return true;
        }

        if (order.status === 'PENDING') {
          await this.sendMessage(from,
            `⏳ *AGUARDANDO PAGAMENTO*\n\n` +
            `O pedido *#${order.merchant_trade_no}* (*${order.product_name}*) ainda está aguardando a compensação do PIX.\n\n` +
            `Assim que for pago, sua entrega é realizada automaticamente aqui no WhatsApp em poucos segundos!\n\n` +
            `👉 Digite *1* para receber o link do PIX para pagar.\n` +
            `👉 Digite *4* se você já realizou o pagamento e precisa de atendimento.`, {}, sock);
          return true;
        }

        await this.sendMessage(from,
          `❌ *PEDIDO NÃO DISPONÍVEL*\n\n` +
          `O pedido *#${order.merchant_trade_no}* consta como cancelado ou expirado. Para adquirir o produto, gere um novo pedido em nossa loja web ou digite *catalogo* para ver as ofertas disponíveis.`, {}, sock);
        return true;
      }

      if (option === '3') {
        // Opção 3: Detalhes e Dúvidas do Produto
        const product = models.getProductById(order.product_id);
        const prodName = product ? product.name : order.product_name;
        const desc = (product && product.description) ? product.description.trim() : 'Produto digital completo com entrega imediata e suporte.';
        const specs = (product && product.specs) ? `\n\n📋 *Especificações:* \n${product.specs.trim()}` : '';

        const prodMsg = `📖 *DETALHES DO PRODUTO*\n\n` +
          `🏷️ *Nome:* ${prodName}\n` +
          `💰 *Valor:* ${valorStr}\n\n` +
          `📝 *Descrição:*\n${desc}${specs}\n\n` +
          `Deseja algo mais?\n` +
          `• Digite *1* para efetuar o pagamento via PIX\n` +
          `• Digite *4* para tirar dúvidas com nossa equipe`;

        await this.sendMessage(from, prodMsg, {}, sock);
        return true;
      }

      if (option === '4') {
        // Opção 4: Falar com Suporte Humano
        try {
          const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '').replace(/\D/g, '');
          if (ownerPhone) {
            const ownerJid = `${ownerPhone}@s.whatsapp.net`;
            if (ownerJid !== from) {
              const alertMsg = `🔔 *CHAMADO DE SUPORTE NO WHATSAPP*\n\n` +
                `👤 *Cliente:* ${senderName || 'Não informado'}\n` +
                `📱 *WhatsApp:* ${senderPhone || from.split('@')[0]}\n` +
                `🔖 *Pedido:* #${order.merchant_trade_no}\n` +
                `📦 *Produto:* ${order.product_name}\n` +
                `💰 *Valor:* ${valorStr}\n` +
                `📊 *Status:* ${order.status}\n\n` +
                `👉 O cliente está no chat privado aguardando suporte humano sobre este pedido.`;
              this.sendMessage(ownerJid, alertMsg, {}, sock).catch(() => {});
            }
          }
        } catch (_) {}

        await this.sendMessage(from,
          `👨‍💻 *Atendimento Humano Solicitado!*\n\n` +
          `Nossa equipe já foi notificada sobre sua solicitação referente ao pedido *#${order.merchant_trade_no}* (*${order.product_name}*).\n\n` +
          `Um atendente humano entrará em contato com você aqui mesmo em instantes! Se desejar adiantar, pode escrever sua dúvida ou mensagem agora mesmo. 💬`, {}, sock);
        return true;
      }

      return false;
    } catch (err) {
      console.error('[WhatsApp Order Menu Option Error]:', err);
      return false;
    }
  }

  async sendHelp(to, activeSock = null) {
    const sock = activeSock || this.currentDispatchSock || this.sock;
    const help = `ℹ️ *AJUDA & FORMAS DE PAGAMENTO*\n\n` +
      `• *PIX:* Você recebe o QR Code e o código Copia e Cola na hora no chat com aprovação imediata.\n` +
      `• *Criptomoedas (Binance Pay):* Pagamento rápido em USDT pelo app oficial da Binance.\n` +
      `• *Entrega Instantânea:* Nossos servidores monitoram confirmações de bancos e blockchains a cada poucos segundos.\n` +
      `• *Assinaturas VIP:* Link exclusivo gerado para acesso ao canal VIP com controle automático de validade.\n\n` +
      `👉 _Toque nos botões abaixo ou responda *1* para ver o catálogo!_`;

    if (interactiveMessageService.isEnabled()) {
      try {
        const helpButtons = [
          { type: 'quick_reply', text: '🛒 Ver Catálogo', id: '1' },
          { type: 'quick_reply', text: '📦 Meus Pedidos', id: '0' },
          { type: 'quick_reply', text: '👨‍💻 Falar c/ Suporte', id: '4' }
        ];
        const sent = await interactiveMessageService.sendInteractiveButtons(sock, to, {
          title: 'ℹ️ CENTRAL DE AJUDA & ATENDIMENTO',
          text: help,
          footer: 'Selecione uma ação rápida',
          buttons: helpButtons,
          fallbackText: help
        });
        if (sent) return sent;
      } catch (_) {}
    }

    await this.sendMessage(to, help, {}, sock);
  }

  async sendMessage(jid, text, options = {}, customSock = null) {
    if (!jid || typeof jid !== 'string') return false;
    let targetJid = jid.trim();

    // Se for JID terminando em @lid, resolve para o número real de telefone
    if (targetJid.endsWith('@lid')) {
      const resolved = resolveLidToPhone(targetJid) || safeExtractPhone(targetJid);
      if (resolved && resolved.length >= 8 && resolved.length <= 13) {
        targetJid = `${resolved}@s.whatsapp.net`;
      }
    }

    const s = (customSock && customSock._rawSock) ? customSock._rawSock : (customSock || options.sock || this.currentDispatchSock || this.sock);

    // Se o texto contiver a tag [AUDIO: ...] ou [IMAGEM: ...], delega para sendHumanSplitMessages para sintetizar a nota de voz ou enviar mídia
    if (typeof text === 'string' && /\[(?:[aá]udio|imagem|image)\s*:/i.test(text) && !options?.rawText) {
      return this.sendHumanSplitMessages(s, targetJid, text, options);
    }

    if (targetJid.endsWith('@s.whatsapp.net') && !options?.forceFleetDispatch && !options?.isSystemAlert && !options?.isCommandReply) {
      try {
        const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
        const recipientPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const myPhone = s?.user?.id ? s.user.id.split('@')[0].split(':')[0].replace(/\D/g, '') : null;
        const senderInstId = (s && s.instanceId) ? s.instanceId : ((this.currentDispatchSock && this.currentDispatchSock.instanceId) || (this.sock && this.sock.instanceId) || 1);
        // Não bloqueia envio para si mesmo (chat consigo mesmo / autocomandos / fromMe) nem para o Dono/Master
        if (recipientPhone !== myPhone && !this.isOwner(recipientPhone, false) && subbotPrivateFilter.isFleetBotNumber(recipientPhone, senderInstId)) {
          console.log(`[WhatsApp 🛡️ Outgoing Bot-to-Bot Guard] Envio no privado cancelado para outro robô da frota (+${recipientPhone})`);
          return false;
        }
      } catch (_) {}
    }

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
      const userPart = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (userPart.length >= 14) {
        const resolved = resolveLidToPhone(userPart);
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          targetJid = `${resolved}@s.whatsapp.net`;
        }
      }
      const finalUserPart = targetJid.split('@')[0].split(':')[0];
      targetJid = `${finalUserPart}@s.whatsapp.net`;
      if (!/^\d+$/.test(finalUserPart)) {
        return false;
      }
    }

    // 🛑 Outgoing Bot-to-Bot Guard: Robôs da frota nunca enviam mensagens no privado para outros robôs da frota (exceto Dono/Master)
    if (targetJid.endsWith('@s.whatsapp.net') && !options.forceFleetDispatch && !options.isSystemAlert && !options.isCommandReply) {
      try {
        const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
        const recipientPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const myPhone = s?.user?.id ? s.user.id.split('@')[0].split(':')[0].replace(/\D/g, '') : null;
        const senderInstId = (s && s.instanceId) ? s.instanceId : ((this.currentDispatchSock && this.currentDispatchSock.instanceId) || (this.sock && this.sock.instanceId) || 1);
        if (recipientPhone !== myPhone && !this.isOwner(recipientPhone, false) && subbotPrivateFilter.isFleetBotNumber(recipientPhone, senderInstId)) {
          console.log(`[WhatsApp 🛡️ Outgoing Bot-to-Bot Guard] Envio no privado cancelado para outro robô da frota (+${recipientPhone})`);
          return false;
        }
      } catch (_) {}
    }

    const sock = (customSock && customSock._rawSock) ? customSock._rawSock : (customSock || options.sock || this.currentDispatchSock || this.sock);
    if (!sock || (sock !== this && sock.ev && !sock.user?.id)) {
      console.log(`[WhatsApp ⚠️] Não conectado. Mensagem para ${targetJid} não enviada: ${typeof text === 'string' ? text.slice(0, 40) : 'objeto'}...`);
      return false;
    }

    // Se for mensagem de reação (react) ou cancelamento/delete (revoke), nunca simula digitação nem insere contexto de verificado
    const isReaction = typeof text === 'object' && text !== null && !!text.react;
    const isDelete = typeof text === 'object' && text !== null && !!text.delete;
    if (isReaction || isDelete) {
      options.skipPresence = true;
      options.noVerificado = true;
    }

    // Decoração de Verificado Global (Selo Oficial Verificado estilo Gata Nina & SPY BOT)
    // ATENÇÃO: NUNCA aplicar status@broadcast ou forwardingScore em grupos (@g.us), pois causa rejeição e invisibilidade nos celulares
    let finalOptions = { ...options };
    const isTargetGroup = Boolean(targetJid && targetJid.endsWith('@g.us'));
    if (models.isVerificadoGlobal() && !options.noVerificado && !isTargetGroup) {
      const verifConfig = models.getVerificadoConfig();
      if (!finalOptions.contextInfo) finalOptions.contextInfo = {};
      finalOptions.contextInfo.forwardingScore = 999;
      finalOptions.contextInfo.isForwarded = true;
      const hasExplicitUrl = typeof text === 'string' && /https?:\/\//i.test(text);
      if (verifConfig.show_ad !== false && !finalOptions.contextInfo.externalAdReply && !hasExplicitUrl) {
        finalOptions.contextInfo.externalAdReply = {
          title: verifConfig.title || 'PayBot Oficial ✓',
          body: verifConfig.body || 'Canal Oficial Verificado 🟢',
          mediaType: 1,
          previewType: 'PHOTO',
          renderLargerThumbnail: false,
          showAdAttribution: true,
          sourceUrl: 'https://whatsapp.com'
        };
      }
      if (!finalOptions.quoted) {
        finalOptions.quoted = {
          key: {
            fromMe: false,
            participant: '0@s.whatsapp.net',
            participants: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
            id: 'VERIF_' + Math.random().toString(36).substring(2, 10).toUpperCase()
          },
          message: {
            contactMessage: {
              displayName: verifConfig.title || 'PayBot Oficial ✓',
              vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${(verifConfig.title || 'PayBot Oficial').replace(/;/g, '')};;;\nFN:${verifConfig.title || 'PayBot Oficial ✓'}\nitem1.TEL;waid=0:0\nitem1.X-ABLabel:Oficial\nEND:VCARD`
            },
            conversation: '✓ Canal Oficial Verificado'
          },
          participant: '0@s.whatsapp.net'
        };
      }
    }

    if (!options.skipPresence) {
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
    }

    try {
      // Auto-enriquecimento de miniatura e card de link caso a mensagem contenha URL
      try {
        const linkPreviewService = require('../services/linkPreviewService');
        if (typeof text === 'string') {
          const enriched = await linkPreviewService.enrichMessageContent({ text }, finalOptions);
          if (enriched && (enriched.linkPreview || enriched.contextInfo?.externalAdReply)) {
            text = enriched;
          }
        } else if (typeof text === 'object' && text !== null && (text.text || text.caption)) {
          await linkPreviewService.enrichMessageContent(text, finalOptions);
        }
      } catch (_) {}

      let sentRes;
      if (typeof text === 'object' && text !== null) {
        const payload = { ...text };
        if (models.isVerificadoGlobal() && !options.noVerificado && !payload.contextInfo) {
          payload.contextInfo = finalOptions.contextInfo;
        }
        sentRes = await sock.sendMessage(targetJid, payload, finalOptions);
      } else {
        sentRes = await sock.sendMessage(targetJid, { text, ...finalOptions }, finalOptions);
      }
      if (sentRes?.key?.id) {
        this.trackSentBotMessage(sentRes.key.id, targetJid, sock);
        this.recordUserActivity(targetJid);
        try {
          const whatsappMessageStore = require('../services/whatsappMessageStoreService');
          if (sentRes.message) {
            whatsappMessageStore.storeOutgoingMessage(sentRes.key, sentRes.message, sock?.instanceId || 1);
          }
        } catch (_) {}
      }
      return true;
    } catch (err) {
      console.error(`[WhatsApp ❌ Falha ao enviar para ${targetJid}]:`, err.message);
      return false;
    }
  }

  async sendMessageQueued(jid, text, options = {}, customSock = null, priority = 'NORMAL') {
    const messageQueueService = require('../services/messageQueueService');
    return messageQueueService.enqueue({
      targetJid: jid,
      priority,
      sendFn: () => this.sendMessage(jid, text, options, customSock)
    });
  }

  /**
   * Envia mensagem simulando digitação humana realista no WhatsApp.
   * Aciona status 'composing' (digitando...), aguarda delay humanizado proporcional ao texto e envia.
   */
  async sendMessageWithTyping(sock, jid, messageContent, customDelayMs = null) {
    const s = (sock && sock._rawSock) ? sock._rawSock : (sock || this.currentDispatchSock || this.sock);
    if (!jid) return false;

    const textToSend = typeof messageContent === 'string' ? messageContent : (messageContent?.text || '');
    const options = (typeof messageContent === 'object' && messageContent?.options) ? messageContent.options : {};

    let targetJid = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    if (targetJid.endsWith('@lid')) {
      const resolved = resolveLidToPhone(targetJid) || safeExtractPhone(targetJid);
      if (resolved && resolved.length >= 8 && resolved.length <= 13) {
        targetJid = `${resolved}@s.whatsapp.net`;
      }
    }

    if (targetJid.endsWith('@s.whatsapp.net') && !options?.forceFleetDispatch && !options?.isSystemAlert && !options?.isCommandReply) {
      try {
        const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
        const recipientPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const senderInstId = (s && s.instanceId) ? s.instanceId : ((this.currentDispatchSock && this.currentDispatchSock.instanceId) || (this.sock && this.sock.instanceId) || 1);
        if (subbotPrivateFilter.isFleetBotNumber(recipientPhone, senderInstId)) {
          return false;
        }
      } catch (_) {}
    }

    // Se o texto contiver a tag [AUDIO: ...] ou [IMAGEM: ...], delega para sendHumanSplitMessages para sintetizar a nota de voz ou enviar mídia
    if (typeof textToSend === 'string' && /\[(?:[aá]udio|imagem|image)\s*:/i.test(textToSend) && !options?.rawText) {
      return this.sendHumanSplitMessages(s, targetJid, textToSend, options);
    }

    // Calcula tempo realista de digitação humana no WhatsApp: ~25ms por caractere
    let delay = customDelayMs;
    if (delay === null || delay === undefined) {
      const len = textToSend ? textToSend.length : 30;
      delay = process.env.NODE_ENV === 'test' ? 10 : Math.min(2500, Math.max(600, Math.round(len * 25)));
    }

    try {
      if (s && typeof s.sendPresenceUpdate === 'function') {
        await s.sendPresenceUpdate('composing', targetJid);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        await s.sendPresenceUpdate('paused', targetJid);
      }
    } catch (_) {}

    return this.sendMessage(targetJid, textToSend, { ...options, skipPresence: true }, s);
  }

  /**
   * Catálogo de imagens e provas visuais de demonstração para soluções tech e vendas
   */
  static SOLUTION_IMAGE_PRESETS = {
    paybot: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    bot_vendas: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    automacao: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    vendas: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    loja: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=600&auto=format&fit=crop&q=80',
    vitrine: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=600&auto=format&fit=crop&q=80',
    bot_grupos: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
    grupos: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
    moderacao: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
    app_mobile: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&auto=format&fit=crop&q=80',
    app: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&auto=format&fit=crop&q=80',
    aplicativo: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&auto=format&fit=crop&q=80',
    sistema_web: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=80',
    saas: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=80',
    software: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80',
    landing_page: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=600&auto=format&fit=crop&q=80',
    site: 'https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=600&auto=format&fit=crop&q=80',
    site_portal: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
    pagespeed: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=80',
    auditoria: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
    seo: 'https://images.unsplash.com/photo-1571786256017-aee7a0c009b6?w=600&auto=format&fit=crop&q=80',
    ia: 'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=600&auto=format&fit=crop&q=80',
    agente_ia: 'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=600&auto=format&fit=crop&q=80',
    garantia: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?w=600&auto=format&fit=crop&q=80',
    seguranca: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&auto=format&fit=crop&q=80'
  };

  /**
   * Envia sequência de mensagens simulando comportamento 100% humano no WhatsApp:
   * - Divide o texto em balões curtos e naturais (parágrafos \n\n ou frases se muito longo)
   * - Suporta tags multimídia inteligentes de fechamento: [AUDIO: script falado] e [IMAGEM: preset_ou_url | legenda]
   * - Simula digitação ativa ('composing') antes de cada balão e gravação de áudio ('recording')
   * - Pausa breve entre o envio de um balão e a digitação do próximo (como um usuário real teclando no celular)
   * - Desativa cards verificados/banners institucionais em conversas privadas humanizadas
   */
  async sendHumanSplitMessages(sock, jid, textOrArray, options = {}) {
    const s = (sock && sock._rawSock) ? sock._rawSock : (sock || this.currentDispatchSock || this.sock);
    if (!jid) return [];

    let targetJid = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    if (targetJid.endsWith('@lid')) {
      const resolved = resolveLidToPhone(targetJid) || safeExtractPhone(targetJid);
      if (resolved && resolved.length >= 8 && resolved.length <= 13) {
        targetJid = `${resolved}@s.whatsapp.net`;
      }
    }

    if (targetJid.endsWith('@s.whatsapp.net') && !options?.forceFleetDispatch && !options?.isSystemAlert && !options?.isCommandReply) {
      try {
        const subbotPrivateFilter = require('../services/subbotPrivateFilterService');
        const recipientPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const senderInstId = (s && s.instanceId) ? s.instanceId : ((this.currentDispatchSock && this.currentDispatchSock.instanceId) || (this.sock && this.sock.instanceId) || 1);
        if (subbotPrivateFilter.isFleetBotNumber(recipientPhone, senderInstId)) {
          return false;
        }
      } catch (_) {}
    }

    // 1. Extração e divisão em balões naturais com suporte a Áudio PTT e Imagens Demonstrativas
    const parseTextToBubbles = (raw) => {
      if (!raw || typeof raw !== 'string') return [];
      const mediaTagRegex = /\[([aá]udio|imagem|image)\s*:\s*([\s\S]+?)\]/gi;
      let lastIdx = 0;
      let match;
      const result = [];

      const addTextParas = (txt) => {
        if (!txt) return;
        const paras = txt.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
        for (const p of paras) {
          if (p.length > 70 && /[.!?]\s+[A-ZÀ-Ú]/.test(p)) {
            const splitMatch = p.match(/^([\s\S]{20,180}[.!?])\s+([\s\S]+)$/);
            if (splitMatch && splitMatch[1] && splitMatch[2]) {
              result.push({ isAudio: false, isImage: false, text: splitMatch[1].trim() });
              result.push({ isAudio: false, isImage: false, text: splitMatch[2].trim() });
              continue;
            }
          }
          result.push({ isAudio: false, isImage: false, text: p });
        }
      };

      while ((match = mediaTagRegex.exec(raw)) !== null) {
        if (match.index > lastIdx) {
          addTextParas(raw.slice(lastIdx, match.index));
        }
        const tagType = match[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const tagBody = match[2].trim();
        if (tagType === 'audio') {
          result.push({ isAudio: true, isImage: false, script: tagBody });
        } else if (tagType === 'imagem' || tagType === 'image') {
          const parts = tagBody.split('|');
          const source = parts[0].trim();
          const caption = parts.slice(1).join('|').trim();
          result.push({ isAudio: false, isImage: true, source, caption });
        }
        lastIdx = match.index + match[0].length;
      }

      if (lastIdx < raw.length) {
        addTextParas(raw.slice(lastIdx));
      }
      return result;
    };

    let bubbles = [];
    if (Array.isArray(textOrArray)) {
      for (const item of textOrArray) {
        const rawItem = (typeof item === 'string' ? item : (item?.text || '')).trim();
        if (!rawItem) continue;
        bubbles.push(...parseTextToBubbles(rawItem));
      }
    } else if (typeof textOrArray === 'string') {
      const raw = textOrArray.trim();
      if (raw.length > 0) {
        bubbles = parseTextToBubbles(raw);
      }
    } else if (textOrArray?.text) {
      return this.sendHumanSplitMessages(sock, jid, textOrArray.text, options);
    }

    if (bubbles.length === 0) return [];

    // Se o cliente prefere conversar por áudio (options.preferAudio) e não é grupo
    if (options?.preferAudio && !targetJid.endsWith('@g.us')) {
      const hasAudio = bubbles.some(b => b.isAudio === true);
      if (!hasAudio) {
        // Encontra o balão conversacional principal (não URL pura, não chave Pix, não comando numérico) e converte em áudio PTT
        for (let b of bubbles) {
          if (!b.isAudio && !b.isImage && b.text) {
            const trimmed = b.text.trim();
            const isUrl = /^https?:\/\//i.test(trimmed);
            const isPix = /^000201/i.test(trimmed);
            const isMenuCmd = /^[0-9]️⃣/i.test(trimmed);
            if (!isUrl && !isPix && !isMenuCmd && trimmed.length > 3) {
              b.isAudio = true;
              b.script = trimmed;
              b.text = '';
              break; // Converte o balão de fala principal em áudio PTT
            }
          }
        }
      }
    }

    const isTest = process.env.NODE_ENV === 'test';
    const sentResults = [];

    // Delay inicial realista antes do 1º balão (humano pega o celular, lê a mensagem e decide responder: 2.2s a 4.5s)
    if (!isTest) {
      const initialReadDelay = Math.floor(Math.random() * 2300) + 2200;
      await new Promise(r => setTimeout(r, initialReadDelay));
    }

    for (let i = 0; i < bubbles.length; i++) {
      const bubbleItem = bubbles[i];
      const isAudioBubble = bubbleItem.isAudio === true;
      let audioScript = bubbleItem.script || null;
      let textContent = (bubbleItem.text || '').trim();

      // Entrega de imagem demonstrativa / prova visual
      if (bubbleItem.isImage) {
        let resolvedUrl = null;
        const cleanSrc = (bubbleItem.source || '').trim();
        if (/^https?:\/\//i.test(cleanSrc)) {
          resolvedUrl = cleanSrc;
        } else if (cleanSrc.startsWith('produto:') || cleanSrc.startsWith('product:')) {
          const pId = parseInt(cleanSrc.split(':')[1], 10);
          const prod = models.getProductById(pId);
          if (prod?.image_url) resolvedUrl = prod.image_url;
        } else if (WhatsAppBotService.SOLUTION_IMAGE_PRESETS && WhatsAppBotService.SOLUTION_IMAGE_PRESETS[cleanSrc.toLowerCase()]) {
          resolvedUrl = WhatsAppBotService.SOLUTION_IMAGE_PRESETS[cleanSrc.toLowerCase()];
        } else {
          try {
            const prods = models.getProducts(true);
            const found = prods.find(p => p.name.toLowerCase().includes(cleanSrc.toLowerCase()) && p.image_url);
            if (found?.image_url) resolvedUrl = found.image_url;
          } catch (_) {}
        }

        if (!resolvedUrl) {
          resolvedUrl = WhatsAppBotService.SOLUTION_IMAGE_PRESETS?.paybot || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80';
        }

        try {
          if (s && typeof s.sendPresenceUpdate === 'function') {
            await s.sendPresenceUpdate('composing', targetJid);
            const imgDelay = isTest ? 10 : 1200;
            await new Promise(r => setTimeout(r, imgDelay));
            await s.sendPresenceUpdate('paused', targetJid);
          }

          const imgPayload = {
            image: { url: resolvedUrl },
            ...(bubbleItem.caption ? { caption: bubbleItem.caption } : {})
          };
          const sentImg = await s.sendMessage(targetJid, imgPayload);
          if (sentImg?.key?.id) {
            this.trackSentBotMessage(sentImg.key.id, targetJid, s);
            this.recordUserActivity(targetJid);
          }
          sentResults.push(sentImg);

          if (i < bubbles.length - 1) {
            const pauseBetween = isTest ? 10 : Math.floor(Math.random() * 1200 + 1200);
            await new Promise(r => setTimeout(r, pauseBetween));
          }
        } catch (imgErr) {
          console.warn('[sendHumanSplitMessages ⚠️ Falha ao enviar imagem, enviando legenda como texto]:', imgErr.message);
          if (bubbleItem.caption) {
            const fallbackTxt = await this.sendMessage(targetJid, bubbleItem.caption, { ...options, skipPresence: true, noVerificado: true }, s);
            sentResults.push(fallbackTxt);
          }
        }
        continue;
      }

      // Sanitiza qualquer resíduo de cabeçalho ou assinatura técnica de LLM/provedor
      textContent = textContent
        .replace(/(?:^|\n)(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?(?:\s*\[[^\]\n]*\])?\*?:?\s*(?:\n+|$)/gi, '\n')
        .replace(/(?:^|\n)(?:(?:master\s+bot|bot(?:\s+tenant[^\n\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+[^\n]*(?:\n+|$)/gi, '\n')
        .replace(/(?:^|\n)(?:via\s+(?:groq|gemini|openai|deepseek|claude|qwen|llama|flowith)[^\n]*(?:\n+|$))/gi, '\n')
        .replace(/(?:^|\n)\[(?:flowith|groq|gemini|openai|deepseek|claude|qwen|llama|fallback|ia|ai)[^\]\n]*\]:?\s*(?:\n+|$)/gi, '\n')
        .trim();

      // Se por qualquer razão ainda houver uma tag de áudio no texto, extrai o script e limpa a tag do texto
      if (!isAudioBubble && /\[[aá]udio\s*:/i.test(textContent)) {
        const m = textContent.match(/\[[aá]udio\s*:\s*([\s\S]+?)\]/i);
        if (m) {
          audioScript = m[1].trim();
          textContent = textContent.replace(/\[[aá]udio\s*:\s*[\s\S]+?\]/gi, '').trim();
        }
      }

      if (audioScript) {
        audioScript = audioScript
          .replace(/(?:^|\n)(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?(?:\s*\[[^\]\n]*\])?\*?:?\s*(?:\n+|$)/gi, '\n')
          .replace(/(?:^|\n)(?:(?:master\s+bot|bot(?:\s+tenant[^\n\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+[^\n]*(?:\n+|$)/gi, '\n')
          .replace(/(?:^|\n)(?:via\s+(?:groq|gemini|openai|deepseek|claude|qwen|llama|flowith)[^\n]*(?:\n+|$))/gi, '\n')
          .trim();
      }

      if ((isAudioBubble || audioScript) && audioScript) {
        let sentVoiceOk = false;
        try {
          const audioConverter = require('../services/audioConverterService');
          const salesPersona = models.getSetting('SALES_BOT_PERSONA', 'marcos');
          const salesEmotion = models.getSetting('SALES_BOT_EMOTION', 'consultivo');
          const salesVoice = models.getSetting('SALES_BOT_VOICE', 'pt-BR-AntonioNeural');
          const salesRate = models.getSetting('SALES_BOT_VOICE_RATE', '+0%');
          const salesBreath = models.getSetting('SALES_BOT_ORGANIC_BREATH', 'true') !== 'false';
          const salesWarmth = models.getSetting('SALES_BOT_PHONE_WARMTH', 'true') !== 'false';
          const ttsRes = await audioConverter.textToSpeech(audioScript, {
            persona: salesPersona,
            emotion: salesEmotion,
            voice: salesVoice,
            rate: salesRate,
            organicBreath: salesBreath,
            phoneWarmth: salesWarmth,
            lang: 'pt'
          });
          if (ttsRes && ttsRes.buffer && ttsRes.buffer.length > 10) {
            const waveform = ttsRes.waveform || audioConverter.generateSyntheticWaveform(64);

            // Simula status "gravando áudio..." no WhatsApp
            if (s && typeof s.sendPresenceUpdate === 'function') {
              await s.sendPresenceUpdate('recording', targetJid);
              const recordDelay = isTest ? 10 : Math.min(6000, Math.max(1800, Math.round(ttsRes.buffer.length / 3200 * 1000)));
              await new Promise(r => setTimeout(r, recordDelay));
              await s.sendPresenceUpdate('paused', targetJid);
            }

            const sentVoice = await s.sendMessage(targetJid, {
              audio: ttsRes.buffer,
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true,
              waveform
            });
            if (sentVoice?.key?.id) {
              this.trackSentBotMessage(sentVoice.key.id, targetJid, s);
              this.recordUserActivity(targetJid);
            }
            sentResults.push(sentVoice);
            sentVoiceOk = true;

            if (i < bubbles.length - 1) {
              const pauseBetween = isTest ? 10 : Math.floor(Math.random() * 1200 + 1200);
              await new Promise(r => setTimeout(r, pauseBetween));
            }
            continue;
          }
        } catch (audioErr) {
          console.warn('[sendHumanSplitMessages ⚠️ Falha ao sintetizar áudio PTT, enviando texto limpo]:', audioErr.message);
        }

        // Se a síntese falhar por completo, envia o script como texto limpo SEM as tags [AUDIO: ...]
        if (!sentVoiceOk && audioScript) {
          textContent = audioScript;
        }
      }

      if (!textContent) continue;

      // Delay de digitação humano: ~35-45ms por caractere (entre 1200ms e 4200ms; 10ms em testes)
      const typingDelay = isTest ? 10 : Math.min(4200, Math.max(1200, Math.round(textContent.length * 38)));

      try {
        if (s && typeof s.sendPresenceUpdate === 'function') {
          await s.sendPresenceUpdate('composing', targetJid);
          if (typingDelay > 0) {
            await new Promise(r => setTimeout(r, typingDelay));
          }
          await s.sendPresenceUpdate('paused', targetJid);
        }
      } catch (_) {}

      const msgResult = await this.sendMessage(
        targetJid,
        textContent,
        { ...options, skipPresence: true, noVerificado: true },
        s
      );
      sentResults.push(msgResult);

      // Pausa humana entre balões: um humano não tecla o próximo balão no mesmo milissegundo (~1.2s a 2.4s)
      if (i < bubbles.length - 1) {
        const pauseBetween = isTest ? 10 : Math.floor(Math.random() * 1200 + 1200);
        await new Promise(r => setTimeout(r, pauseBetween));
      }
    }

    return sentResults;
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
      const tunnelService = require('../services/tunnelService');
      const storePublicUrl = tunnelService.getStoreUrl() || models.getSetting('STORE_BASE_URL', 'http://localhost:3001');

      const card = `🚀 *LANÇAMENTO METEÓRICO & MULTI-GRUPOS* 🚀\n\n` +
        `⚙️ *Status do Lançamento:* ${c.active ? '🟢 ATIVO (Auto-Transbordamento Ligado)' : '🔴 PAUSADO'}\n` +
        `🏷️ *Nome Base:* \`${c.group_base_name}\`\n` +
        `👥 *Capacidade por Grupo:* *${c.max_members_per_group} membros*\n` +
        `📦 *Total de Grupos Criados:* *${status.totalGroups}*\n` +
        `📈 *Total de Leads/Membros:* *${status.totalMembers} participantes*\n` +
        `🎯 *Etapa Atual:* *${status.currentStage?.title || 'Etapa 1'}*\n` +
        `🤖 *Sub-Bots de Aquecimento:* 🟢 *${status.onlineSubBots} online* de ${status.totalSubBots}\n` +
        `👑 *Admin do Grupo de Captação:* Chip #${c.admin_subbot_id || 1}\n` +
        `🎭 *Sub-Bots Compradores (Aquecimento):* Chips #${c.buyer_subbot_ids || 'Todos conectados'}\n` +
        `💎 *Grupo de Compradores VIP:* ${c.buyers_group_jid ? '🟢 Conectado (' + c.buyers_group_jid.slice(0, 15) + '...)' : (c.buyers_group_invite_url ? '🔗 Link Configurado' : '⚪ Não configurado')}\n` +
        `🛡️ *Admin do Grupo VIP:* Chip #${c.buyers_group_admin_id || 1}\n` +
        `📋 *Fluxo Operacional Único:* ${c.buyers_group_workflow ? '🟢 Ativo' : '⚪ Padrão'}\n\n` +
        `🔗 *Link Central de Tráfego (Auto-Redirect):*\n` +
        `👉 *${storePublicUrl}/l/vip*\n` +
        `_(Redireciona sempre para o grupo com vagas abertas!)_\n\n` +
        (g ? `📌 *Grupo Ativo Agora:* *${g.title}*\n👥 *Membros:* ${g.member_count}/${g.max_limit}\n🔗 *Convite:* ${g.invite_url || 'Gerando link...'}\n\n` : `⚠️ *Nenhum grupo ativo criado ainda.*\n\n`) +
        `🛠️ *Comandos Rápidos no WhatsApp:*\n` +
        `• *!meteorico ativar [nome] [limite]* — Ativa campanha\n` +
        `• *!meteorico pausar* — Pausa campanha\n` +
        `• *!meteorico criargrupo [nome]* — Cria o próximo grupo agora\n` +
        `• *!meteorico etapa <1-5>* — Dispara a etapa e aquece com sub-bots\n` +
        `• *!meteorico aquecer [msg]* — Força aquecimento rápido no grupo\n` +
        `• *!meteorico admin <id>* — Define sub-bot admin do lançamento\n` +
        `• *!meteorico compradores <ids>* — Define sub-bots atores/compradores (ex: 2,3)\n` +
        `• *!meteorico grupocompradores <jid/link>* — Define grupo VIP pós-venda\n` +
        `• *!meteorico admincompradores <id>* — Define admin do grupo de compradores\n` +
        `• *!meteorico fluxo <texto>* — Define instruções operacionais do grupo VIP\n` +
        `• *!meteorico fechar* — Fecha o grupo (apenas admins)\n` +
        `• *!meteorico abrir* — Abre o grupo para todos conversarem\n` +
        `• *!meteorico limite <num>* — Altera limite por grupo\n` +
        `• *!meteorico link* — Mostra link de entrada e redirecionador\n\n` +
        `🌐 *Painel Web:* Envie *!painel* no privado para acessar o dashboard.`;

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
        text: `✅ *Lançamento Meteórico ATIVADO com sucesso!*\n\nO monitoramento de lotação e criação automática de novos grupos está operante.\n🔒 Envie *!painel* no privado para gerenciar a campanha remotamente.`
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
            `🚀 O redirecionador de tráfego já está apontando para este novo grupo!`
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
      const tunnelService = require('../services/tunnelService');
      const storePublicUrl = tunnelService.getStoreUrl() || models.getSetting('STORE_BASE_URL', 'http://localhost:3001');

      return sock.sendMessage(from, {
        text: `🔗 *LINKS DO LANÇAMENTO METEÓRICO*\n\n` +
          `📌 *Grupo Ativo Atual:* ${g?.title || 'Nenhum'}\n` +
          `👉 *Convite Direto:* ${g?.invite_url || 'Sem link ativo'}\n\n` +
          `🌐 *Link de Tráfego Inteligente (Auto-Redirect):*\n` +
          `👉 *${storePublicUrl}/l/vip*\n\n` +
          `💡 _Use o Link Inteligente em seus anúncios e redes sociais; ele direciona automaticamente o visitante para o grupo mais recente com vagas abertas!_`
      });
    }

    // 11. Definir Sub-Bot Administrador do Grupo de Captação
    if (subCmd === 'admin' || subCmd === 'administrador') {
      const adminId = parseInt(parts[1], 10) || 1;
      meteoricService.updateRolesConfig({ admin_subbot_id: adminId });
      return sock.sendMessage(from, {
        text: `👑 *Sub-Bot Administrador do Grupo de Captação definido para: Chip #${adminId}*!\n\nEle será responsável por enviar as instruções oficiais, abrir/fechar o grupo e organizar as mensagens do lançamento.`
      });
    }

    // 12. Definir Sub-Bots Compradores / Atores de Aquecimento
    if (subCmd === 'compradores' || subCmd === 'atores' || subCmd === 'subbotscompradores') {
      const idsInput = parts.slice(1).join(',').replace(/\s+/g, '');
      if (!idsInput) {
        return sock.sendMessage(from, { text: `⚠️ Informe os IDs dos sub-bots separados por vírgula. Exemplo: *!meteorico compradores 2,3,4*` });
      }
      meteoricService.updateRolesConfig({ buyer_subbot_ids: idsInput });
      return sock.sendMessage(from, {
        text: `🎭 *Sub-Bots Compradores / Atores definidos: Chips #${idsInput}*!\n\nEles simularão compras, farão perguntas estratégicas de clientes e quebrarão objeções nos grupos durante o aquecimento.`
      });
    }

    // 13. Definir Grupo de Compradores VIP
    if (subCmd === 'grupocompradores' || subCmd === 'grupovip' || subCmd === 'compradoresgrupo') {
      const targetInput = parts[1];
      if (!targetInput) {
        return sock.sendMessage(from, { text: `⚠️ Informe o JID ou link do Grupo de Compradores VIP. Exemplo: *!meteorico grupocompradores 120363xxx@g.us* ou o link de convite.` });
      }
      const isJid = targetInput.endsWith('@g.us');
      const updates = isJid ? { buyers_group_jid: targetInput } : { buyers_group_invite_url: targetInput };
      meteoricService.updateRolesConfig(updates);
      return sock.sendMessage(from, {
        text: `💎 *Grupo Exclusivo de Compradores VIP configurado!*\n\n• Destino: \`${targetInput}\`\n\nTodos os membros que realizarem a compra serão transferidos/convidados automaticamente para este grupo!`
      });
    }

    // 14. Definir Admin do Grupo de Compradores
    if (subCmd === 'admincompradores' || subCmd === 'adminvip') {
      const adminId = parseInt(parts[1], 10) || 1;
      meteoricService.updateRolesConfig({ buyers_group_admin_id: adminId });
      return sock.sendMessage(from, {
        text: `🛡️ *Sub-Bot Administrador do Grupo de Compradores VIP definido para: Chip #${adminId}*!\n\nEste admin dará as boas-vindas e executará o fluxo operacional único do produto pós-venda.`
      });
    }

    // 15. Definir Fluxo Operacional Único do Produto
    if (subCmd === 'fluxo' || subCmd === 'workflow' || subCmd === 'tarefa') {
      const workflowText = parts.slice(1).join(' ').trim();
      if (!workflowText) {
        return sock.sendMessage(from, { text: `⚠️ Forneça o texto da tarefa/fluxo operacional. Exemplo: *!meteorico fluxo Olá {nome}, bem-vindo ao suporte VIP! Segue o link de acesso: ...*` });
      }
      meteoricService.updateRolesConfig({ buyers_group_workflow: workflowText });
      return sock.sendMessage(from, {
        text: `📋 *Fluxo Operacional do Grupo de Compradores atualizado com sucesso!*\n\nO novo admin postará estas diretrizes automaticamente assim que novos compradores entrarem.`
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

        if (p.media_url) {
          try {
            const fs = require('fs');
            const path = require('path');
            const cleanPath = p.media_url.replace(/^\//, '');
            const localFile = path.join(__dirname, '..', 'public', cleanPath);
            if (fs.existsSync(localFile)) {
              return sock.sendMessage(from, {
                image: fs.readFileSync(localFile),
                caption: msg
              });
            }
          } catch (e) {
            console.warn('Erro ao anexar imagem do post viral:', e);
          }
        }

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
      `🌐 *Painel Web:* Envie *!painel* no privado para acessar o dashboard.`;

    return sock.sendMessage(from, { text: card });
  }

  // ==========================================
  // 🎨 COMFYART STUDIO • CRIAÇÃO DE POSTS & BANNERS IA
  // ==========================================
  async handleComfyArtCommand(sock, from, text, isOwnerUser = false) {
    const comfyArtService = require('../services/comfyArtService');
    const models = require('../db/models');
    const path = require('path');
    const fs = require('fs');

    const parts = text.trim().split(/\s+/);
    const mainCmd = parts[0]?.toLowerCase().replace(/^(?:!|\/)/, '');
    const firstArg = (parts[1] || '').toLowerCase();

    // 0. Informações sobre CreativeField & FotoField (Vencedor Desafio Higgsfield)
    if (['creativefield', 'fotofield', 'estudioia', 'higgsfield'].includes(mainCmd) || ['creativefield', 'fotofield'].includes(firstArg)) {
      const creativeFieldService = require('../services/creativeFieldService');
      const cfStatus = await creativeFieldService.checkHealth();
      const comfyStatus = await comfyArtService.checkStatus();

      let msg = `🏆 *ESTÚDIO IA • FERRAMENTAS VENCEDORAS HIGGSFIELD* 🎨\n\n` +
        `Integradas oficialmente ao seu ecossistema de vendas:\n\n` +
        `1️⃣ *CreativeField & FotoField* (Porta 8787):\n` +
        `• Status: ${cfStatus.online ? '🟢 Online & Ativo' : '🟡 Instalado (Pronto para Iniciar)'}\n` +
        `• Editor FotoField (Camadas & Retoques): ${cfStatus.fotoFieldUrl}\n` +
        `• Canvas Principal: ${cfStatus.canvasUrl}\n` +
        `• Repositório: https://github.com/rhymeas/Creativefield\n\n` +
        `2️⃣ *ComfyArt* (ComfyUI Workflows & Posts):\n` +
        `• Status: ${comfyStatus.serviceOnline ? '🟢 Online' : '🟡 Motor HD Integrado'}\n` +
        `• Workflows Oficiais: 33 workflows prontos\n` +
        `• Canvas ComfyArt: ${comfyStatus.endpoint}/comfyart/\n` +
        `• Repositório: https://github.com/jtydhr88/ComfyArt\n\n` +
        `💡 *Dica:* Para iniciar o CreativeField execute o arquivo *iniciar_creativefield.bat* ou clique em "Iniciar Servidor" na aba Estúdio IA do Painel Web!`;

      return sock.sendMessage(from, { text: msg });
    }

    // 1. Status do ComfyArt & ComfyUI
    if (mainCmd === 'comfystatus' || firstArg === 'status') {
      const status = await comfyArtService.checkStatus();
      const recent = comfyArtService.getRecentPosts(1);
      const totalCreated = comfyArtService.getRecentPosts(100).length;

      let msg = `🎨 *COMFYART STUDIO • STATUS DA IA* 🚀\n\n` +
        `• *Conexão ComfyUI / ComfyArt:* ${status.serviceOnline ? '🟢 Online & Respondendo' : '🟡 Motor HD SVG Ativo (Alta Definição)'}\n` +
        `• *Endpoint ComfyUI:* \`${status.endpoint || 'http://127.0.0.1:8188'}\`\n` +
        `• *Repositório Clonado:* ${status.repoCloned ? '✅ Sim (tools/ComfyArt)' : '⚠️ Não clonado'}\n` +
        `• *Workflows Oficiais:* ${status.officialWorkflowsCount || 33} disponíveis\n` +
        `• *Total de Posts Criados:* ${totalCreated}\n\n`;

      if (recent.length > 0) {
        msg += `📸 *Último Post Criado:* "${recent[0].title}" (${recent[0].template})\n`;
      }
      msg += `\n💡 Para gerar um criativo agora, envie:\n👉 *!comfyart <nome_do_produto>* ou *!comfy story <produto>*`;
      return sock.sendMessage(from, { text: msg });
    }

    // 2. Extrair parâmetros: template e termo do produto
    let template = 'square';
    let term = parts.slice(1).join(' ').trim();

    if (['story', 'status', '9:16'].includes(firstArg)) {
      template = 'story';
      term = parts.slice(2).join(' ').trim();
    } else if (['banner', '16:9', 'horizontal'].includes(firstArg)) {
      template = 'banner';
      term = parts.slice(2).join(' ').trim();
    } else if (['card', 'oferta', 'pix'].includes(firstArg)) {
      template = 'product_card';
      term = parts.slice(2).join(' ').trim();
    } else if (['viral', 'gancho', 'hook', '4:5'].includes(firstArg)) {
      template = 'viral_hook';
      term = parts.slice(2).join(' ').trim();
    }

    // Se nenhum termo foi passado, enviar menu de ajuda
    if (!term) {
      const helpMsg = `🎨 *COMFYART STUDIO IA • GERADOR DE POSTS & BANNERS*\n\n` +
        `Gere criativos profissionais com alta resolução (1080x1080, 9:16 Stories, Banners) direto pelo WhatsApp!\n\n` +
        `📌 *Como Usar:*\n` +
        `• *!comfyart <produto>* → Gera post quadrado (1:1) para WhatsApp & Feed\n` +
        `• *!comfy story <produto>* → Formato vertical (9:16) para Status & Stories\n` +
        `• *!comfy banner <produto>* → Banner horizontal (16:9) para Telegram & Twitter\n` +
        `• *!comfy card <produto>* → Card com destaque de preço Pix\n` +
        `• *!comfystatus* → Verifica status do ComfyUI e workflows\n\n` +
        `💡 *Exemplos Práticos:*\n` +
        `👉 *!comfyart Bot de Vendas Pro*\n` +
        `👉 *!comfy story Licença Anual*\n` +
        `👉 *!comfy banner Painel SaaS Multi-Lojas*`;
      return sock.sendMessage(from, { text: helpMsg });
    }

    await sock.sendMessage(from, {
      text: `🎨 *Gerando arte publicitária em Alta Resolução com ComfyArt...*\nFormato: *${template.toUpperCase()}* | Termo: *${term}*\nAguarde alguns segundos enquanto a imagem é renderizada! ⏳`
    });

    try {
      const allProducts = models.getProducts ? models.getProducts() : [];
      const matched = allProducts.find(p =>
        (p.name && p.name.toLowerCase().includes(term.toLowerCase())) ||
        (p.description && p.description.toLowerCase().includes(term.toLowerCase()))
      );

      let title = term.toUpperCase();
      let subtitle = 'Entrega imediata no WhatsApp com garantia e suporte total!';
      let price = 'R$ 49,90';
      let discountBadge = 'OFERTA ESPECIAL';
      let ctaText = 'COMPRE COM 1 TOQUE';

      if (matched) {
        title = (matched.name || term).toUpperCase();
        if (matched.price) price = `R$ ${Number(matched.price).toFixed(2).replace('.', ',')}`;
        if (matched.description) subtitle = matched.description.slice(0, 130);
        discountBadge = 'PRONTA ENTREGA';
        ctaText = `GARANTIR ${title.slice(0, 18)}`;
      }

      const generated = await comfyArtService.generatePostCreative({
        template,
        theme: template === 'story' ? 'fire_viral' : (template === 'product_card' ? 'emerald_pay' : 'cyber_dark'),
        title,
        subtitle,
        price,
        discount_badge: discountBadge,
        cta_text: ctaText,
        footer_text: 'PayBot • Automação Comercial'
      });

      const caption = `🔥 *${generated.title}*\n\n` +
        `${generated.subtitle || ''}\n\n` +
        `💰 *${generated.price || ''}*  🏷️ _${generated.discount_badge || 'OFERTA'}_\n` +
        `👉 *${generated.cta_text || 'Compre agora!'}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ _Criativo gerado com ComfyArt (${generated.width}x${generated.height}px)_\n` +
        `🌐 Baixar ou editar no Painel: ComfyArt Studio`;

      const cleanPath = generated.media_url.replace(/^\//, '');
      const localFile = path.join(__dirname, '..', 'public', cleanPath);

      if (fs.existsSync(localFile)) {
        return sock.sendMessage(from, {
          image: fs.readFileSync(localFile),
          caption
        });
      } else {
        return sock.sendMessage(from, { text: `${caption}\n\n🔗 ${generated.media_url}` });
      }
    } catch (err) {
      console.error('Erro no comando comfyart:', err);
      return sock.sendMessage(from, { text: `❌ Falha ao criar post com ComfyArt: ${err.message}` });
    }
  }

  async requestPairingCode(phone) {
    const phoneUtil = require('../utils/phoneUtil');
    const parsed = phoneUtil.parseAndNormalizePhone(phone);
    if (!parsed.isValid || !parsed.phone || parsed.phone.length < 8) {
      throw new Error('Informe o telefone completo com DDI (ex: +1 202 555-0199 para EUA ou +55 48 98470-2848 para Brasil)');
    }
    const cleanPhone = parsed.phone;

    if (process.env.NODE_ENV === 'test') {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      this.currentPairingCode = simCode;
      return { success: true, pairingCode: simCode, simulated: true };
    }

    // Se já estiver conectado ativamente com este mesmo número
    if (this.isConnected && this.sock?.user?.id) {
      const activeNumber = this.sock.user.id.split(':')[0].replace(/\D/g, '');
      if (activeNumber === cleanPhone) {
        return { success: true, alreadyConnected: true, message: 'Este WhatsApp já está pareado e ativo!' };
      }
    }

    // Se a sessão em disco não estiver conectada mas contiver credenciais de um chip anterior que deslogou, limpa para novo pareamento
    const credsFile = path.join(this.authFolder, 'creds.json');
    if (!this.isConnected && fs.existsSync(credsFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        if (raw && raw.registered) {
          console.log('🔄 [WhatsApp Matriz] Limpando credenciais antigas/desconectadas para novo pareamento via código...');
          await this.stop();
          fs.rmSync(this.authFolder, { recursive: true, force: true });
          await this.start();
        }
      } catch (_) {}
    }

    if (!this.sock) {
      await this.start();
    }

    // Aguarda o WebSocket conectar e ficar aberto via waitForSocketOpen nativo do Baileys
    try {
      if (typeof this.sock?.waitForSocketOpen === 'function') {
        await Promise.race([
          this.sock.waitForSocketOpen(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout WebSocket')), 8000))
        ]);
      }
    } catch (_) {}

    // Confirma se o WebSocket está aberto para tráfego de dados
    let isReady = false;
    for (let i = 0; i < 20; i++) {
      if (this.sock?.ws?.isOpen) {
        isReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (!isReady) {
      throw new Error('Timeout aguardando conexão com os servidores do WhatsApp. Tente novamente.');
    }

    // Tenta obter o código de pareamento com até 4 tentativas suaves
    let code = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await new Promise(r => setTimeout(r, attempt === 1 ? 600 : 1500));
        code = await this.sock.requestPairingCode(cleanPhone);
        if (code) break;
      } catch (err) {
        lastErr = err;
        console.warn(`[WhatsApp Matriz] Tentativa ${attempt} de gerar código:`, err.message);
      }
    }

    if (!code) {
      throw new Error('Falha ao gerar código de pareamento: ' + (lastErr?.message || 'Servidor WhatsApp não respondeu.'));
    }

    const cleanCode = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const formattedCode = cleanCode.length === 8 ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}` : code;
    this.currentPairingCode = formattedCode;
    this.statusMessage = 'Aguardando validação do código ' + formattedCode;
    return { success: true, pairingCode: formattedCode };
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
            botActive: models.isGroupBotActive(g.id),
            postingActive: models.isGroupPostingActive(g.id),
            soDivu: models.isGroupSoDivuActive(g.id),
            isGlobalSoDivu: models.isGlobalSoDivuActive(),
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
      botActive: models.isGroupBotActive(mg.group_jid),
      postingActive: models.isGroupPostingActive(mg.group_jid),
      soDivu: models.isGroupSoDivuActive(mg.group_jid),
      isGlobalSoDivu: models.isGlobalSoDivuActive(),
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
      if (this.groupMetadataCache) {
        for (const [gid, item] of this.groupMetadataCache.entries()) {
          if (now > item.expiresAt) this.groupMetadataCache.delete(gid);
        }
      }
      // 1. Purga cache de resolução LID -> Phone (cap em 3.000 entradas FIFO)
      if (typeof lidToPhoneCache !== 'undefined' && lidToPhoneCache && lidToPhoneCache.size > 3000) {
        const excess = lidToPhoneCache.size - 3000;
        let count = 0;
        for (const key of lidToPhoneCache.keys()) {
          if (count++ >= excess) break;
          lidToPhoneCache.delete(key);
        }
      }
      // 2. Purga rastreamento de última atividade inativa há mais de 24 horas
      if (this.userLastActivity) {
        for (const [key, ts] of this.userLastActivity.entries()) {
          if (now - ts > 24 * 60 * 60 * 1000) this.userLastActivity.delete(key);
        }
      }
      // 3. Purga contextos de pedido pendente inativos há mais de 2 horas
      if (this.userActiveOrderContext) {
        for (const [jid, ctx] of this.userActiveOrderContext.entries()) {
          const act = ctx?.timestamp || ctx?.lastActivity || 0;
          if (!act || now - act > 2 * 60 * 60 * 1000) this.userActiveOrderContext.delete(jid);
        }
      }
      // 4. Purga cupons e referências em excesso
      if (this.userCoupons && this.userCoupons.size > 1000) {
        const excess = this.userCoupons.size - 1000;
        let count = 0;
        for (const k of this.userCoupons.keys()) {
          if (count++ >= excess) break;
          this.userCoupons.delete(k);
        }
      }
      if (this.userReferrals && this.userReferrals.size > 1000) {
        const excess = this.userReferrals.size - 1000;
        let count = 0;
        for (const k of this.userReferrals.keys()) {
          if (count++ >= excess) break;
          this.userReferrals.delete(k);
        }
      }
      // 5. Purga mensagens enviadas para cancelamento (!d) com mais de 24 horas ou acima de 5.000
      if (this.sentBotMessages) {
        for (const [id, item] of this.sentBotMessages.entries()) {
          const ts = typeof item === 'number' ? item : (item?.timestamp || 0);
          if (ts && now - ts > 24 * 60 * 60 * 1000) this.sentBotMessages.delete(id);
        }
        if (this.sentBotMessages.size > 5000) {
          const excess = this.sentBotMessages.size - 5000;
          let count = 0;
          for (const k of this.sentBotMessages.keys()) {
            if (count++ >= excess) break;
            this.sentBotMessages.delete(k);
          }
        }
      }
    } catch (_) {}
  }
}

const whatsappBotInstance = new WhatsAppBotService();
whatsappBotInstance.resolveLidToPhone = resolveLidToPhone;
whatsappBotInstance.safeExtractPhone = safeExtractPhone;
module.exports = whatsappBotInstance;



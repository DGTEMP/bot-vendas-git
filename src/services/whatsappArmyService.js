const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');

class WhatsAppArmyService {
  constructor() {
    this.activeSockets = new Map(); // instanceId -> Baileys socket
    this.instanceQrs = new Map(); // instanceId -> { qr, qrDataUrl }
    this.campaignTimeouts = new Map(); // campaignId -> timer
    this.startingInstances = new Set(); // instanceId sendo inicializado para evitar race conditions
    this.armyBaseFolder = path.join(__dirname, '..', '..', 'data', 'whatsapp_army');
    this._simModeOverride = undefined;
    this.activeRelays = new Map(); // targetPhone -> { instanceId, ownerJid, createdAt }
    // Set de IDs de mensagens autorizadas pela orquestração (evita falso positivo de rogue)
    this.legitimateDispatchKeys = new Set();
    // Set de IDs de instâncias pausadas/desligadas temporariamente (!serbot off / !subbot off)
    this.pausedInstances = new Set();
  }

  get isSimulationMode() {
    if (this._simModeOverride !== undefined) return this._simModeOverride;
    const envMode = typeof models.getEnvironmentMode === 'function' ? models.getEnvironmentMode() : models.getSetting('ENVIRONMENT_MODE', 'sandbox');
    if (envMode === 'production') return false;
    return models.getSetting('PIX_SIMULATION_MODE', 'true') === 'true';
  }

  set isSimulationMode(val) {
    this._simModeOverride = val;
  }

  setOwnerRelay(targetPhone, instanceId, ownerJid) {
    const clean = String(targetPhone).replace(/\D/g, '');
    this.activeRelays.set(clean, {
      instanceId: Number(instanceId),
      ownerJid,
      createdAt: Date.now()
    });
    return true;
  }

  getOwnerRelay(targetPhone) {
    const clean = String(targetPhone).replace(/\D/g, '');
    return this.activeRelays.get(clean) || null;
  }

  removeOwnerRelay(targetPhone) {
    const clean = String(targetPhone).replace(/\D/g, '');
    return this.activeRelays.delete(clean);
  }

  getAllActiveRelays() {
    const result = [];
    for (const [phone, relay] of this.activeRelays.entries()) {
      result.push({ phone, ...relay });
    }
    return result;
  }

  async sendVoiceViaInstance(instanceId, target, textOrBuffer) {
    const isGroup = String(target).includes('@g.us');
    const cleanPhone = String(target).split('@')[0].replace(/\D/g, '');
    const jid = isGroup ? String(target).trim() : `${cleanPhone}@s.whatsapp.net`;
    const instance = models.getArmyInstanceById(instanceId);

    let audioBuffer = null;
    let mimetype = 'audio/ogg; codecs=opus';
    let ttsResult = null;
    const audioConverter = require('./audioConverterService');

    if (Buffer.isBuffer(textOrBuffer)) {
      if (textOrBuffer.slice(0, 4).toString('ascii') === 'OggS') {
        audioBuffer = textOrBuffer;
      } else {
        const conv = await audioConverter.convertToWhatsAppPtt(textOrBuffer);
        audioBuffer = conv.buffer || textOrBuffer;
        mimetype = conv.mimetype || 'audio/ogg; codecs=opus';
        ttsResult = conv;
      }
    } else {
      const textToSpeak = String(textOrBuffer || '').slice(0, 500);
      try {
        ttsResult = await audioConverter.textToSpeech(textToSpeak);
        audioBuffer = ttsResult.buffer;
        mimetype = ttsResult.mimetype || 'audio/ogg; codecs=opus';
      } catch (_) {
        audioBuffer = Buffer.from('RIFF_SIMULATED_AUDIO_BUFFER');
      }
    }

    // Se a instância for a Matriz Principal
    if (instance && instance.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot.sock && whatsappBot.isConnected) {
        try {
          const waveform = (ttsResult && ttsResult.waveform) || (await audioConverter.generateAudioWaveform(audioBuffer));
          if (typeof whatsappBot.sock.sendPresenceUpdate === 'function') {
            await whatsappBot.sock.sendPresenceUpdate('recording', jid);
          }
          await whatsappBot.sock.sendMessage(jid, {
            audio: audioBuffer,
            mimetype: mimetype,
            ptt: true,
            waveform
          });
          models.incrementInstanceSentCount(instanceId);
          return true;
        } catch (err) {
          console.error(`[Exército WhatsApp ❌ Falha Matriz Voz #${instanceId}]:`, err.message);
        }
      }
    }

    // Se for chip secundário do exército
    const sock = this.activeSockets.get(instanceId);
    if (sock && (sock.user?.id || typeof sock.sendMessage === 'function')) {
      try {
        const waveform = (ttsResult && ttsResult.waveform) || (await audioConverter.generateAudioWaveform(audioBuffer));
        if (typeof sock.sendPresenceUpdate === 'function') {
          await sock.sendPresenceUpdate('recording', jid);
        }
        await sock.sendMessage(jid, {
          audio: audioBuffer,
          mimetype: mimetype,
          ptt: true,
          waveform
        });
        models.incrementInstanceSentCount(instanceId);
        return true;
      } catch (err) {
        console.error(`[Exército WhatsApp ❌ Falha Chip #${instanceId} Áudio]:`, err.message);
      }
    }

    // Modo simulação ou ambiente de testes
    if (this.isSimulationMode || process.env.NODE_ENV === 'test') {
      console.log(`[Exército WhatsApp 🟢 SIMULAÇÃO VOZ CHIP #${instanceId}] Áudio PTT para ${cleanPhone}`);
      models.incrementInstanceSentCount(instanceId);
      return true;
    }

    return false;
  }

  parseSpintax(text, vars = {}) {
    let result = models.parseSpintax(text);
    if (vars) {
      if (vars.name) result = result.replace(/\{nome\}|\{cliente\}|\{amigo\}/gi, vars.name);
      if (vars.product) result = result.replace(/\{produto\}/gi, vars.product);
      if (vars.link) result = result.replace(/\{link\}/gi, vars.link);
    }
    return result;
  }

  async sendMessageViaInstance(instanceId, target, text) {
    const isGroup = String(target).includes('@g.us');
    const cleanPhone = String(target).split('@')[0].replace(/\D/g, '');
    return this.sendArmyMessage(instanceId, isGroup ? target : cleanPhone, text);
  }

  // ==========================================
  // 1. GERENCIAMENTO DE INSTÂNCIAS / CHIPS
  // ==========================================
  // Retorna uma assinatura de navegador e dispositivo altamente realista e rotativa (Anti-Ban)
  getRealisticBrowserProfile(instanceId = 1) {
    const profiles = [
      Browsers.windows('Chrome'),             // [ 'Windows', 'Chrome', '10.0.22631' ]
      ['Windows', 'Chrome', '124.0.6367.207'], // Google Chrome no Windows 11
      ['macOS', 'Safari', '17.4.1'],          // Apple Safari no macOS
      ['Windows', 'Edge', '124.0.2478.80'],   // Microsoft Edge no Windows 11
      ['macOS', 'Chrome', '124.0.6367.201'],  // Google Chrome no macOS
      Browsers.ubuntu('Chrome'),              // [ 'Ubuntu', 'Chrome', '22.04.4' ]
      ['Windows', 'Firefox', '125.0.3']       // Mozilla Firefox no Windows
    ];
    return profiles[(Math.max(1, Number(instanceId) || 1) - 1) % profiles.length];
  }

  async startInstance(instanceId) {
    const instance = models.getArmyInstanceById(instanceId);
    if (!instance) {
      this.startingInstances.delete(instanceId);
      this.activeSockets.delete(instanceId);
      this.instanceQrs.delete(instanceId);
      return null;
    }

    // Instância Matriz (ID 1) é gerenciada pelo whatsappBot principal
    if (instance.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      const status = whatsappBot.getConnectionStatus();
      models.updateArmyInstance(instanceId, {
        status: status.connected ? 'CONNECTED' : (status.hasQr ? 'WAITING_QR' : 'DISCONNECTED'),
        phone: status.phone || instance.phone
      });
      return {
        id: instanceId,
        status: status.connected ? 'CONNECTED' : 'WAITING_QR',
        qrDataUrl: status.qrDataUrl,
        pairingCode: status.pairingCode
      };
    }

    // Evita loop de inicializações simultâneas (race conditions)
    if (this.startingInstances.has(instanceId)) {
      return { id: instanceId, status: 'CONNECTING' };
    }
    this.startingInstances.add(instanceId);

    // Se já estiver rodando, encerra com segurança antes de reiniciar
    await this.stopInstance(instanceId);

    const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    try {
      models.updateArmyInstance(instanceId, { status: 'CONNECTING' });
      const { state, saveCreds } = await useMultiFileAuthState(folder);
      if (state.creds?.me && !state.creds?.registered) {
        state.creds.registered = true;
        try { await saveCreds(); } catch (_) {}
      }
      
      let version = [2, 3000, 1043857760];
      try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
      } catch (_) {}

      const whatsappMessageStore = require('./whatsappMessageStoreService');

      // Configuração baseada na arquitetura multi-device do SpyBot-MD com perfil realista
      // Otimizado para Nitro V15 (i7-13620H / NVMe G4 / 16GB DDR5): Economia de até 60% de RAM por Sub-Bot
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: this.getRealisticBrowserProfile(instanceId),
        msgRetryCounterCache: whatsappMessageStore.msgRetryCounterCache,
        getMessage: async (key) => whatsappMessageStore.getMessage(key),
        enableAutoSessionRecreation: true,
        enableRecentMessageCache: true,
        maxMsgRetryCount: 5,
        retryRequestDelayMs: 250,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 55000,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: (jid) => {
          if (!jid) return false;
          // Ignora canais da Meta e newsletters nos sub-bots (economiza ~40% de RAM e CPU)
          if (jid.endsWith('@newsletter')) return true;
          // Ignora status broadcast se o sub-bot não estiver em modo de captura de status
          if (jid === 'status@broadcast' && !instance.enable_status_listen) return true;
          return false;
        }
      });
      sock.instanceId = instanceId;
      try {
        const whatsappBot = require('../bots/whatsappBot');
        if (typeof whatsappBot.wrapSocketWithSupremeProtection === 'function') {
          whatsappBot.wrapSocketWithSupremeProtection(sock);
        }
      } catch (_) {}
      try {
        const botHierarchyOrchestrator = require('./botHierarchyOrchestratorService');
        botHierarchyOrchestrator.wrapSubBotSocket(sock, instanceId);
      } catch (_) {}

      sock.ev.on('creds.update', async () => {
        try {
          if (sock.user?.id && state.creds) {
            state.creds.registered = true;
          }
          await saveCreds();
        } catch (_) {}
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            const prev = this.instanceQrs.get(instanceId) || {};
            this.instanceQrs.set(instanceId, { ...prev, qr, qrDataUrl });
            models.updateArmyInstance(instanceId, { status: 'WAITING_QR' });
          } catch (_) {}
        }

        if (connection === 'open') {
          this.instanceQrs.delete(instanceId);
          const rawPhone = sock.user?.id ? sock.user.id.split(':')[0] : null;
          const currentInst = models.getArmyInstanceById(instanceId);
          const isPaused = (currentInst && (currentInst.is_paused === 1 || currentInst.status === 'PAUSED')) || this.pausedInstances.has(instanceId);
          if (isPaused) {
            this.pausedInstances.add(instanceId);
          }
          models.updateArmyInstance(instanceId, {
            status: isPaused ? 'PAUSED' : 'CONNECTED',
            phone: rawPhone || instance.phone,
            is_paused: isPaused ? 1 : 0
          });
          try {
            if (state.creds) {
              state.creds.registered = true;
            }
            await saveCreds();
          } catch (_) {}
          console.log(`[Exército WhatsApp 📱] Chip #${instanceId} (${instance.name}) conectado com sucesso (+ ${rawPhone || instance.phone})${isPaused ? ' [EM STANDBY / PAUSA]' : ''}!`);

          // Sincroniza catálogo próprio se for conta WhatsApp Business
          this.syncSubBotBusinessCatalog(instanceId, sock).catch(err => {
            console.warn(`[Exército WhatsApp ⚠️] Falha ao verificar WhatsApp Business no Chip #${instanceId}:`, err.message);
          });

          // Inicializa cota de tokens e envia mensagem de boas-vindas ou ativação do Sub-Bot
          try {
            const subbotTokenService = require('./subbotTokenService');
            subbotTokenService.ensureDailyReset(instanceId);
            const destJid = `${rawPhone || instance.phone}@s.whatsapp.net`;
            const hasAiKey = models.canSubBotUseAi(instanceId);

            if (!hasAiKey && instanceId > 1) {
              const aiManager = require('./aiManagerService');
              const activationMsg =
                `🎉 *[SUB-BOT #${instanceId} CONECTADO COM SUCESSO!]* 🤖\n\n` +
                aiManager.getFreeApiKeyInstructions({ subbotId: instanceId, isBlocked: true });

              setTimeout(() => {
                sock.sendMessage(destJid, { text: activationMsg }).catch(() => {});
              }, 3000);
            } else {
              const welcomeMsg = subbotTokenService.getWelcomeSubBotMessage(instanceId);
              setTimeout(() => {
                sock.sendMessage(destJid, { text: welcomeMsg }).catch(() => {});
              }, 3000);
            }
          } catch (_) {}
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          console.log(`[Exército WhatsApp ⚠️] Chip #${instanceId} desconectado (código ${statusCode}).`);

          this.activeSockets.delete(instanceId);

          if (isLoggedOut) {
            console.log(`[Exército WhatsApp 🛑] Sessão desconectada/revogada no Chip #${instanceId} (código 401). Limpando credenciais expiradas para evitar loop de conexão.`);
            try {
              models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
              const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
              const credsFile = path.join(folder, 'creds.json');
              if (fs.existsSync(credsFile)) {
                try { fs.unlinkSync(credsFile); } catch (_) {}
              }
            } catch (_) {}
            this.instanceQrs.delete(instanceId);
            // IMPORTANTE: Se o WhatsApp deslogou (401), NÃO tenta reconectar em loop infinito.
            return;
          }

          if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
            console.log(`[Exército WhatsApp ⚡] Chip #${instanceId} pareamento confirmado pelo celular! Reinicializando imediatamente...`);
            setTimeout(() => {
              this.startInstance(instanceId).catch(() => {});
            }, 300);
            return;
          }

          // Verifica se a instância ainda existe no banco e está ativa antes de agendar reconexão
          const currentInst = models.getArmyInstanceById(instanceId);
          if (!currentInst || !currentInst.active) {
            try { models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' }); } catch (_) {}
            this.instanceQrs.delete(instanceId);
            return;
          }

          try { models.updateArmyInstance(instanceId, { status: 'CONNECTING' }); } catch (_) {}
          setTimeout(() => {
            const checkInst = models.getArmyInstanceById(instanceId);
            if (checkInst && checkInst.active) {
              this.startInstance(instanceId).catch(() => {});
            }
          }, 5000);
        }
      });

      // Escuta mensagens: Roteia para o cérebro principal do WhatsAppBot com o socket deste chip
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const whatsappBot = require('../bots/whatsappBot');
        const spyFeatures = require('./spyFeaturesService');
        for (const msg of messages) {
          if (!msg.message) continue;

          // Sincroniza mapeamentos de LID em tempo real
          try {
            whatsappMessageStore.extractAndRegisterFromMsg(msg);
          } catch (_) {}

          // Registra presença do Sub-Bot no grupo para o Orquestrador Mestre-Subbot
          if (msg.key?.remoteJid?.endsWith('@g.us')) {
            try {
              const botHierarchyOrchestrator = require('./botHierarchyOrchestratorService');
              const myPhone = sock.user?.id ? sock.user.id.split(':')[0].replace(/\D/g, '') : '';
              botHierarchyOrchestrator.recordSubBotActivity(msg.key.remoteJid, instanceId, myPhone);
            } catch (_) {}
          }

          // Rastreia mensagem no cache Anti-Delete e pré-captura mídias de visualização única para !ver
          try {
            spyFeatures.recordMessage(msg);
            await spyFeatures.captureViewOnceMedia(sock, msg, msg.key?.remoteJid);
          } catch (_) {}

          // Detecta se a mensagem é um aviso de mensagem apagada (protocolMessage revoke)
          const proto = msg.message?.protocolMessage;
          if (proto && (proto.type === 0 || proto.type === 'REVOKE' || String(proto.type).includes('0'))) {
            const targetId = proto.key?.id;
            const chatJid = proto.key?.remoteJid || msg.key?.remoteJid;
            const deleterJid = msg.key?.participant || msg.key?.remoteJid;
            try {
              await spyFeatures.handleRevoke(sock, chatJid, targetId, deleterJid);
            } catch (revErr) {
              console.error(`[Exército WhatsApp ⚠️] Erro ao tratar revoke no Chip #${instanceId}:`, revErr.message);
            }
            continue;
          }

          // ══════════════════════════════════════════════════════════════════
          // ⏸️ SUB-BOT DESLIGADO / STANDBY (!serbot off / !subbot off)
          // Se este sub-bot estiver pausado/desligado, ele fica 100% em silêncio.
          // Suas credenciais e sessão continuam intactas (sem deslogar).
          // Somente reage aos comandos de ligar (!serbot on) ou status.
          // ══════════════════════════════════════════════════════════════════
          if (this.isInstancePaused(instanceId)) {
            const rawTxt = (
              msg.message.conversation ||
              msg.message.extendedTextMessage?.text ||
              msg.message.imageMessage?.caption ||
              msg.message.videoMessage?.caption ||
              ''
            ).trim();

            const isOnCmd = /^(?:!|\/)(?:serbot|subbot|jadibot)\s+(?:on|ligar|ativar|retomar|start)(?:\s+.*)?$/i.test(rawTxt) ||
                            /^(?:!|\/)(?:subbot_on|serboton|subboton|ligarbot|ativarbot)$/i.test(rawTxt);
            const isOffCmd = /^(?:!|\/)(?:serbot|subbot|jadibot)\s+(?:off|desligar|pausar|parar|stop)(?:\s+.*)?$/i.test(rawTxt) ||
                             /^(?:!|\/)(?:subbot_off|serbotoff|subbotoff|desligarbot|pausarbot)$/i.test(rawTxt);
            const isStatusCmd = /^(?:!|\/)(?:serbot|subbot|jadibot)\s+(?:status|info|estado)(?:\s+.*)?$/i.test(rawTxt);

            if (isOnCmd || isOffCmd || isStatusCmd) {
              try {
                const spyFeatures = require('./spyFeaturesService');
                const fromJid = msg.key?.remoteJid || '';
                const isGroup = fromJid.endsWith('@g.us');
                const senderJid = isGroup ? (msg.key?.participant || fromJid) : fromJid;
                const senderPhone = (senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
                const isOwnerUser = whatsappBot.isOwner ? whatsappBot.isOwner(senderPhone, msg.key?.fromMe) : false;

                await spyFeatures.handleSerBot(sock, fromJid, rawTxt, senderPhone, isGroup, isOwnerUser);
              } catch (handleErr) {
                console.error(`[Exército WhatsApp ⚠️] Erro ao tratar comando no sub-bot em pausa #${instanceId}:`, handleErr.message);
              }
            }

            // 🕵️ MODO SENTINELA SILENCIOSO (MESMO DESLIGADO):
            // O sub-bot está desligado para respostas e comandos, mas continua minerando em segundo plano:
            // 1. Links de grupos (chat.whatsapp.com/...)
            // 2. Links e ofertas de produtos (Shopee, Mercado Livre, Amazon, etc.)
            // 3. Chaves de API (OpenAI, Gemini, Groq, Anthropic, etc.)
            // 4. Números de possíveis compradores com intenção de compra
            if (rawTxt) {
              try {
                const swarmIntelligence = require('./swarmIntelligenceService');
                const fromJid = msg.key?.remoteJid || '';
                const isGroup = fromJid.endsWith('@g.us');
                const senderJid = isGroup ? (msg.key?.participant || fromJid) : fromJid;
                const senderPhone = (senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
                const pushName = msg.pushName || '';

                await swarmIntelligence.inspectIncomingIntelligence({
                  sock,
                  instanceId,
                  from: fromJid,
                  sender: senderJid,
                  senderPhone,
                  text: rawTxt,
                  pushName,
                  isGroup,
                  isPaused: true, // Sub-bot está desligado (100% furtivo e silencioso)
                  chatMetadata: null
                });
              } catch (sentinelErr) {
                console.error(`[Sentinela Sub-Bot Off ⚠️] Erro na escuta passiva #${instanceId}:`, sentinelErr.message);
              }
            }

            // Não executa fluxo de atendimento, AI ou catálogo enquanto pausado!
            continue;
          }

          // ══════════════════════════════════════════════════════════════════
          // 🚨 DETECTOR DE SUB-BOT ROGUE EM GRUPO METEÓRICO
          // Se este sub-bot FREE enviou mensagem própria (fromMe=true) num
          // grupo meteórico SEM autorização da orquestração → PUNIÇÃO!
          // ══════════════════════════════════════════════════════════════════
          if (msg.key.fromMe && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) {
            const msgId = msg.key.id;
            // Se já estava na lista de disparos legítimos, ignora e remove do set
            if (this.legitimateDispatchKeys.has(msgId)) {
              this.legitimateDispatchKeys.delete(msgId);
            } else if (!this._orchestrationActive) {
              // Verifica se este socket é de um sub-bot free
              const inst = models.getArmyInstanceById(instanceId);
              const isFreeSubBot = inst && !inst.is_main && inst.is_subbot && inst.terms_accepted && !inst.free_blocked;
              if (isFreeSubBot) {
                // Verifica se o grupo é meteórico
                const isMeteoricGroup = models.getMeteoricGroupByJid ? models.getMeteoricGroupByJid(msg.key.remoteJid) : null;
                if (isMeteoricGroup) {
                  console.warn(`[🚨 ROGUE SUBBOT] Sub-Bot #${instanceId} enviou mensagem não autorizada no grupo meteórico ${msg.key.remoteJid}!`);
                  // Busca socket de admin (bot principal) para deletar a mensagem
                  const adminSock = (() => {
                    try {
                      const wb = require('../bots/whatsappBot');
                      return wb.sock || null;
                    } catch (_) { return null; }
                  })();
                  // Executa punição em background (não bloqueia o loop)
                  this.punishRogueSubBot(instanceId, msg, adminSock).catch(err => {
                    console.error(`[🚨 ROGUE SUBBOT] Erro ao punir sub-bot #${instanceId}:`, err.message);
                  });
                  continue; // Não processa mais este evento
                }
              }
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // 🛑 REGRA SUPREMA: ANTI-SELF-CHAT & SILÊNCIO ENTRE ROBÔS EM GRUPOS
          // Impede que um Sub-Bot responda a mensagens enviadas por ele mesmo
          // ou por qualquer outro robô da frota em grupos (evita loops de conversa).
          // ══════════════════════════════════════════════════════════════════
          const fromJid = msg.key?.remoteJid || '';
          const isGroupChat = fromJid.endsWith('@g.us');
          const senderParticipant = isGroupChat ? (msg.key?.participant || fromJid) : fromJid;
          const cleanSenderPhone = String(senderParticipant).split('@')[0].split(':')[0].replace(/\D/g, '');
          const myInstancePhone = String(sock?.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
          const myInstanceLid = String(sock?.user?.lid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
          const isFromMyOwnSocket = !!msg.key?.fromMe ||
            (cleanSenderPhone && myInstancePhone && (cleanSenderPhone === myInstancePhone || (cleanSenderPhone.length >= 8 && myInstancePhone.endsWith(cleanSenderPhone.slice(-8))))) ||
            (cleanSenderPhone && myInstanceLid && cleanSenderPhone === myInstanceLid);
          const isDispatchedByFleet = Boolean(msg.key?.id && (
            this.legitimateDispatchKeys.has(msg.key.id) ||
            (whatsappBot.sentBotMessages && whatsappBot.sentBotMessages.has(msg.key.id))
          ));
          const subbotPrivateFilter = require('./subbotPrivateFilterService');
          const isFleetSender = isFromMyOwnSocket || isDispatchedByFleet || subbotPrivateFilter.isFleetBotNumber(cleanSenderPhone) || subbotPrivateFilter.isFleetBotNumber(senderParticipant);

          if (isGroupChat && isFleetSender) {
            const rawTxt = (
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption ||
              ''
            ).trim();
            // Em grupos, robôs da frota NUNCA conversam entre si nem respondem a si mesmos
            // Apenas comandos com prefixo ! ou / podem passar (se enviados pelo Dono)
            if (!rawTxt.startsWith('!') && !rawTxt.startsWith('/')) {
              continue;
            }
          }

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

          // Executa fluxo comercial / catálogo / nlp / comandos com o socket deste chip (evitando duplicação)
          try {
            await whatsappBot.handleIncomingMessage(msg, sock);
          } catch (botErr) {
            console.error(`[Exército WhatsApp ⚠️] Erro no bot handler do Chip #${instanceId}:`, botErr.message);
          }
        }
      });

      // Evento de atualizações de mensagens para Sub-Bots (detecta exclusões via messages.update)
      sock.ev.on('messages.update', async (updates) => {
        if (this.isInstancePaused(instanceId)) return;
        try {
          const spyFeatures = require('./spyFeaturesService');
          for (const upd of (updates || [])) {
            if (upd.update?.messageStubType === 1 || upd.update?.messageStubType === 'REVOKE') {
              const chatJid = upd.key?.remoteJid;
              const targetId = upd.key?.id;
              const deleterJid = upd.key?.participant || chatJid;
              await spyFeatures.handleRevoke(sock, chatJid, targetId, deleterJid);
            }
          }
        } catch (_) {}
      });

      // Boas-vindas automáticas em grupos onde o chip secundário é membro
      sock.ev.on('group-participants.update', async (evt) => {
        if (this.isInstancePaused(instanceId)) return;
        try {
          const whatsappBot = require('../bots/whatsappBot');
          await whatsappBot.handleGroupParticipantsUpdate(evt, sock);
        } catch (err) {
          console.error(`[Exército WhatsApp ⚠️] Erro em group-participants.update no Chip #${instanceId}:`, err.message);
        }
      });

      // Monitoramento de presença e digitação em tempo real no Chip Secundário
      sock.ev.on('presence.update', (evt) => {
        try {
          const incomingBuffer = require('./incomingMessageBufferService');
          incomingBuffer.handlePresenceUpdate(evt);
        } catch (_) {}
      });

      this.activeSockets.set(instanceId, sock);
      this.startingInstances.delete(instanceId);
      return { id: instanceId, status: 'CONNECTING' };
    } catch (err) {
      this.startingInstances.delete(instanceId);
      models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
      throw err;
    }
  }

  // Sincroniza o catálogo de produtos e perfil do WhatsApp Business quando um Sub-Bot se conecta
  async syncSubBotBusinessCatalog(instanceId, sock) {
    try {
      const myJid = sock?.user?.id;
      if (!myJid) return;
      const cleanPhone = myJid.split(':')[0].replace(/\D/g, '');
      let isBusiness = 0;
      let catalogProducts = [];

      // 1. Tenta consultar perfil comercial WhatsApp Business
      try {
        if (typeof sock.getBusinessProfile === 'function') {
          const profile = await sock.getBusinessProfile(myJid);
          if (profile && (profile.description || profile.category || profile.email || profile.websites)) {
            isBusiness = 1;
          }
        }
      } catch (_) {}

      // 2. Tenta consultar o catálogo de produtos do WhatsApp Business
      try {
        if (typeof sock.getCatalog === 'function') {
          const catalogRes = await sock.getCatalog({ jid: myJid, limit: 50 });
          if (catalogRes && Array.isArray(catalogRes.products) && catalogRes.products.length > 0) {
            isBusiness = 1;
            catalogProducts = catalogRes.products.map((p, idx) => {
              const rawPrice = Number(p.price || 0);
              const brlPrice = rawPrice > 1000 ? (rawPrice / 1000) : (rawPrice || 10.0);
              return {
                id: p.id || `BIZ_${instanceId}_${idx + 1}`,
                name: p.name || `Produto ${idx + 1}`,
                description: p.description || '',
                price: brlPrice,
                price_brl: brlPrice,
                price_usdt: Number((brlPrice / 5.5).toFixed(2)),
                currency: p.currency || 'BRL',
                type: 'digital',
                category: 'WhatsApp Business',
                image_url: p.imageUrl || p.image?.url || '',
                retailer_id: p.retailerId || ''
              };
            });
          }
        }
      } catch (_) {}

      if (isBusiness) {
        if (catalogProducts.length > 0) {
          models.saveSubBotCatalogProducts(instanceId, catalogProducts);
          console.log(`[Exército WhatsApp 🛍️] Sub-Bot #${instanceId} (${cleanPhone}) é WhatsApp Business com ${catalogProducts.length} produto(s) no seu catálogo exclusivo!`);
        } else {
          models.updateArmyInstance(instanceId, { is_business: 1 });
          console.log(`[Exército WhatsApp 🏢] Sub-Bot #${instanceId} (${cleanPhone}) identificado como conta WhatsApp Business.`);
        }
      }
    } catch (err) {
      console.warn(`[Exército WhatsApp ⚠️] Erro ao sincronizar catálogo do Sub-Bot #${instanceId}:`, err.message);
    }
  }

  async stopInstance(instanceId) {
    this.startingInstances.delete(instanceId);
    if (this.pausedInstances) this.pausedInstances.delete(Number(instanceId));
    const sock = this.activeSockets.get(instanceId);
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (_) {}
      this.activeSockets.delete(instanceId);
    }
    this.instanceQrs.delete(instanceId);
    models.updateArmyInstance(instanceId, { status: 'DISCONNECTED', is_paused: 0 });
  }

  /**
   * Pausa / Desliga um sub-bot temporariamente (!serbot off / !subbot off).
   * Mantém o socket e credenciais ativos em standby (sem deslogar e sem requerer novo pareamento).
   */
  async pauseInstance(instanceId) {
    const id = Number(instanceId);
    if (!this.pausedInstances) this.pausedInstances = new Set();
    this.pausedInstances.add(id);

    models.updateArmyInstance(id, {
      status: 'PAUSED',
      is_paused: 1,
      paused_at: new Date().toISOString()
    });

    console.log(`[Exército WhatsApp ⏸️] Sub-Bot #${id} desligado/pausado com sucesso (sessão mantida, não requer re-login).`);
    return { success: true, instanceId: id, status: 'PAUSED', is_paused: 1 };
  }

  /**
   * Liga / Reativa um sub-bot pausado (!serbot on / !subbot on).
   * Reativa instantaneamente sem precisar logar de novo ou gerar novo QR code.
   */
  async resumeInstance(instanceId) {
    const id = Number(instanceId);
    if (this.pausedInstances) {
      this.pausedInstances.delete(id);
    }

    models.updateArmyInstance(id, {
      status: 'CONNECTED',
      is_paused: 0,
      paused_at: null
    });

    // Se o socket já estiver ativo em memória, o bot está online imediatamente!
    if (this.activeSockets.has(id)) {
      console.log(`[Exército WhatsApp ▶️] Sub-Bot #${id} reativado/ligado com sucesso (socket já em memória)!`);
      return { success: true, instanceId: id, status: 'CONNECTED', is_paused: 0 };
    }

    // Se o socket tiver caído ou o sistema reiniciado, reconecta usando as credenciais salvas em disco
    const folder = path.join(this.armyBaseFolder, `instance_${id}`);
    const credsFile = path.join(folder, 'creds.json');
    if (fs.existsSync(credsFile)) {
      console.log(`[Exército WhatsApp ▶️] Sub-Bot #${id} reconectando com credenciais existentes salvas...`);
      await this.startInstance(id);
    }

    return { success: true, instanceId: id, status: 'CONNECTED', is_paused: 0 };
  }

  /**
   * Verifica se o Sub-Bot está desligado/pausado
   */
  isInstancePaused(instanceId) {
    const id = Number(instanceId);
    if (this.pausedInstances && this.pausedInstances.has(id)) return true;
    try {
      const inst = models.getArmyInstanceById(id);
      if (inst && (inst.is_paused === 1 || inst.status === 'PAUSED')) {
        if (!this.pausedInstances) this.pausedInstances = new Set();
        this.pausedInstances.add(id);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async resetInstanceSession(instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (inst && inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      return whatsappBot.resetSession();
    }

    await this.stopInstance(instanceId);
    const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
    if (fs.existsSync(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch (_) {}
    }
    this.instanceQrs.delete(instanceId);
    models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
    // Inicia imediatamente um socket limpo pronto para pareamento ou leitura de QR
    await this.startInstance(instanceId);
    return { success: true };
  }

  async requestPairingCode(instanceId, phone) {
    const phoneUtil = require('../utils/phoneUtil');
    const parsed = phoneUtil.parseAndNormalizePhone(phone);
    if (!parsed.isValid || !parsed.phone || parsed.phone.length < 8) {
      throw new Error('Informe o telefone completo com DDI (ex: +1 202 555-0199 para EUA ou +55 11 99999-8888 para Brasil)');
    }
    const cleanPhone = parsed.phone;

    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) throw new Error('Instância não encontrada.');

    // Se for Chip Matriz (ID 1)
    if (inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      return whatsappBot.requestPairingCode(cleanPhone);
    }

    if (process.env.NODE_ENV === 'test') {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      const prev = this.instanceQrs.get(instanceId) || {};
      this.instanceQrs.set(instanceId, { ...prev, pairingCode: simCode });
      return { success: true, pairingCode: simCode, simulated: true, country: parsed.countryCode, flag: parsed.flag };
    }

    models.updateArmyInstance(instanceId, { phone: cleanPhone });

    let sock = this.activeSockets.get(instanceId);
    if (!sock) {
      await this.startInstance(instanceId);
      sock = this.activeSockets.get(instanceId);
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!sock) {
      throw new Error('Não foi possível inicializar a conexão WhatsApp.');
    }

    if (sock.authState?.creds?.registered) {
      // Se não está conectado ativamente mas possui credenciais antigas registradas, limpa a sessão para novo pareamento
      await this.resetInstanceSession(instanceId);
      sock = this.activeSockets.get(instanceId);
      await new Promise(r => setTimeout(r, 1500));
    }

    try {
      if (typeof sock?.waitForSocketOpen === 'function') {
        await Promise.race([
          sock.waitForSocketOpen(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout WebSocket')), 8000))
        ]);
      }
    } catch (_) {}

    let code = null;
    let lastErr = null;

    // Tenta obter o código de pareamento com até 6 tentativas, aguardando a conexão Baileys estar pronta
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await new Promise(r => setTimeout(r, attempt === 1 ? 600 : 1500));
        code = await sock.requestPairingCode(cleanPhone);
        if (code) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (code) {
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
      const prev = this.instanceQrs.get(instanceId) || {};
      this.instanceQrs.set(instanceId, { ...prev, pairingCode: formattedCode });
      models.updateArmyInstance(instanceId, { status: 'WAITING_PAIRING' });
      return { success: true, pairingCode: formattedCode };
    }

    if (process.env.NODE_ENV === 'test' || !sock) {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      const prev = this.instanceQrs.get(instanceId) || {};
      this.instanceQrs.set(instanceId, { ...prev, pairingCode: simCode });
      return { success: true, pairingCode: simCode, simulated: true };
    }

    throw new Error('Falha ao gerar código de pareamento: ' + (lastErr?.message || 'Timeout ao contatar os servidores do WhatsApp. Tente novamente em alguns segundos.'));
  }

  async requestPairingCodeForNewInstance(phone, options = {}) {
    const phoneUtil = require('../utils/phoneUtil');
    const parsed = phoneUtil.parseAndNormalizePhone(phone);
    if (!parsed.isValid || !parsed.phone || parsed.phone.length < 8) {
      throw new Error('Informe o telefone completo com código do país (ex: +1 202 555-0199 para EUA ou +55 48 98470-2848 para Brasil)');
    }
    const cleanPhone = parsed.phone;

    const acceptedTerms = options.accepted_terms || options.terms_accepted || false;
    const nowIso = new Date().toISOString();

    if (process.env.NODE_ENV === 'test') {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      return {
        success: true,
        code: simCode,
        pairingCode: simCode,
        instanceId: 999,
        country: parsed.countryCode,
        flag: parsed.flag,
        countryName: parsed.countryName,
        lang: parsed.lang,
        formatted: parsed.formatted,
        isForeign: parsed.isForeign
      };
    }

    // Procura uma instância de Sub-Bot com este número ou um slot livre sem telefone atribuído
    const instances = models.getArmyInstances();
    let targetInst = instances.find(i => !i.is_main && i.phone && (i.phone === cleanPhone || cleanPhone.endsWith(i.phone.slice(-8)) || i.phone.endsWith(cleanPhone.slice(-8))));
    if (!targetInst) {
      targetInst = instances.find(i => !i.is_main && !i.phone && (i.status === 'DISCONNECTED' || i.status === 'WAITING_PAIRING'));
    }
    if (!targetInst) {
      const customName = options.name || options.customerName;
      const displayName = customName ? `Sub-Bot ${parsed.flag} - ${customName}` : `Sub-Bot ${parsed.flag} +${cleanPhone.slice(-4)}`;
      targetInst = models.createArmyInstance({
        name: displayName,
        phone: cleanPhone,
        role: 'LEAD_OUTREACH',
        status: 'WAITING_PAIRING',
        daily_limit: 50,
        tokens_balance: 50,
        tokens_daily_base: 50,
        is_subbot: 1,
        terms_accepted: acceptedTerms ? 1 : 0,
        terms_accepted_at: acceptedTerms ? nowIso : null,
        can_participate_meteoric: 1,
        can_mention_members: 1,
        can_post_status: 1
      });
    } else {
      models.updateArmyInstance(targetInst.id, {
        phone: cleanPhone,
        status: 'WAITING_PAIRING',
        is_subbot: 1,
        terms_accepted: acceptedTerms ? 1 : targetInst.terms_accepted,
        terms_accepted_at: acceptedTerms ? nowIso : targetInst.terms_accepted_at,
        can_participate_meteoric: 1,
        can_mention_members: 1,
        can_post_status: 1
      });
    }

    const res = await this.requestPairingCode(targetInst.id, cleanPhone);
    return {
      success: true,
      code: res.pairingCode,
      pairingCode: res.pairingCode,
      instanceId: targetInst.id,
      country: parsed.countryCode,
      flag: parsed.flag,
      countryName: parsed.countryName,
      lang: parsed.lang,
      formatted: parsed.formatted,
      isForeign: parsed.isForeign
    };
  }

  getInstanceQr(instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (inst && inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      const st = whatsappBot.getConnectionStatus();
      return {
        id: inst.id,
        name: inst.name,
        connected: st.connected,
        hasQr: st.hasQr,
        qrDataUrl: st.qrDataUrl,
        pairingCode: st.pairingCode || null,
        phone: st.phone || null,
        status: st.connected ? 'CONNECTED' : (st.hasQr ? 'WAITING_QR' : 'DISCONNECTED')
      };
    }
    const data = this.instanceQrs.get(instanceId);
    return {
      id: inst ? inst.id : instanceId,
      name: inst ? inst.name : `Chip #${instanceId}`,
      connected: inst ? inst.status === 'CONNECTED' : false,
      hasQr: !!data?.qrDataUrl,
      qrDataUrl: data?.qrDataUrl || null,
      pairingCode: data?.pairingCode || null,
      phone: inst?.phone || null,
      status: inst ? inst.status : 'DISCONNECTED'
    };
  }

  getAllAccounts() {
    const instances = models.getArmyInstances();
    const whatsappBot = require('../bots/whatsappBot');
    const mainStatus = whatsappBot.getConnectionStatus();

    return instances.map(inst => {
      if (inst.is_main) {
        return {
          id: inst.id,
          name: inst.name || 'WhatsApp Matriz Principal',
          phone: mainStatus.phone || inst.phone,
          is_main: true,
          status: mainStatus.connected ? 'CONNECTED' : (mainStatus.hasQr ? 'WAITING_QR' : 'DISCONNECTED'),
          connected: !!mainStatus.connected,
          hasQr: !!mainStatus.hasQr,
          qrDataUrl: mainStatus.qrDataUrl,
          pairingCode: mainStatus.pairingCode,
          daily_limit: inst.daily_limit,
          messages_sent_today: inst.messages_sent_today,
          active: inst.active
        };
      }
      const qrData = this.instanceQrs.get(inst.id);
      const isConnected = inst.status === 'CONNECTED';
      return {
        id: inst.id,
        name: inst.name,
        phone: inst.phone,
        is_main: false,
        status: inst.status,
        connected: isConnected,
        hasQr: !!qrData?.qrDataUrl,
        qrDataUrl: qrData?.qrDataUrl || null,
        pairingCode: qrData?.pairingCode || null,
        daily_limit: inst.daily_limit,
        messages_sent_today: inst.messages_sent_today,
        active: inst.active
      };
    });
  }

  async createAndConnectInstance({ name, phone = null, daily_limit = 50, tenant_id = null, terms_accepted = 1, can_participate_meteoric = 1, can_mention_members = 1, can_post_status = 1, tokens_balance = 50, tokens_daily_base = 50, is_subbot = 1 }) {
    let cleanPhone = null;
    if (phone) {
      const phoneUtil = require('../utils/phoneUtil');
      const parsed = phoneUtil.parseAndNormalizePhone(phone);
      cleanPhone = parsed.isValid ? parsed.phone : String(phone).replace(/\D/g, '');
    }
    const inst = models.createArmyInstance({
      name: name || `WhatsApp Secundário #${Date.now().toString().slice(-4)}`,
      phone: cleanPhone,
      daily_limit: daily_limit || 50,
      warmup_mode: 0,
      tenant_id: tenant_id ? Number(tenant_id) : null,
      terms_accepted: terms_accepted ? 1 : 0,
      terms_accepted_at: terms_accepted ? new Date().toISOString() : null,
      can_participate_meteoric: can_participate_meteoric !== 0 ? 1 : 0,
      can_mention_members: can_mention_members !== 0 ? 1 : 0,
      can_post_status: can_post_status !== 0 ? 1 : 0,
      tokens_balance: Number(tokens_balance || 50),
      tokens_daily_base: Number(tokens_daily_base || 50),
      is_subbot: is_subbot ? 1 : 0
    });
    // Inicia Baileys imediatamente para preparar socket e QR code
    this.startInstance(inst.id).catch(err => {
      console.error(`[WhatsApp Multi-Contas ⚠️] Erro ao iniciar instância #${inst.id}:`, err.message);
    });
    return inst;
  }

  /**
   * Extrai participantes de um grupo EXCLUINDO administradores
   * (Poupando e blindando admins de serem marcados em divulgações)
   */
  extractNonAdminParticipants(participants = []) {
    if (!Array.isArray(participants)) return [];
    const models = require('../db/models');
    return participants.filter(p => {
      if (!p) return false;
      const isAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || p?.isAdmin || p?.isSuperAdmin || p?.role === 'admin' || p?.role === 'superadmin';
      if (isAdmin) return false;
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      if (rawJid && models && typeof models.isOwner === 'function' && models.isOwner(rawJid)) return false;
      return true;
    }).map(p => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      if (!raw) return '';
      if (raw.includes('@')) return raw;
      const digits = raw.replace(/\D/g, '');
      return digits ? `${digits}@s.whatsapp.net` : '';
    }).filter(Boolean);
  }

  /**
   * Dispara divulgação/oferta em grupo com menção a todos os membros normais,
   * omitindo expressamente qualquer administrador do grupo.
   */
  async broadcastToGroupExcludingAdmins(instanceIdOrSock, groupJid, messageText, { imageUrl = null } = {}) {
    let sock = (instanceIdOrSock && typeof instanceIdOrSock.sendMessage === 'function') 
      ? instanceIdOrSock 
      : this.activeSockets.get(Number(instanceIdOrSock));
    if (!sock) {
      const whatsappBot = require('../bots/whatsappBot');
      sock = whatsappBot.sock;
    }
    if (!sock) throw new Error('Nenhum socket ativo para disparo no grupo.');

    let metadata = null;
    try {
      if (typeof sock.groupMetadata === 'function') {
        metadata = await sock.groupMetadata(groupJid);
      }
    } catch (e) {
      console.warn(`[Sub-Bot Army ⚠️] Falha ao obter metadados do grupo ${groupJid}:`, e.message);
    }

    const participants = metadata?.participants || [];
    const nonAdminMentions = this.extractNonAdminParticipants(participants);

    const payload = {};
    if (imageUrl) {
      payload.image = { url: imageUrl };
      payload.caption = messageText;
    } else {
      payload.text = messageText;
    }

    if (nonAdminMentions.length > 0) {
      payload.mentions = nonAdminMentions;
    }

    const res = await sock.sendMessage(groupJid, payload);
    return {
      success: true,
      messageId: res?.key?.id,
      totalParticipants: participants.length,
      mentionedMembers: nonAdminMentions.length,
      adminsExcluded: participants.length - nonAdminMentions.length
    };
  }

  // ==========================================
  // 2. DISPARO DE MENSAGENS INDIVIDUAIS
  // ==========================================

  /**
   * Obtém o conteúdo dinâmico (texto e mídia) que será disparado pelo número rogue.
   * Suporta estratégias de conversão de alto impacto:
   *  - 'meteoric': oferta oficial com desconto e link do Lançamento Meteórico ativo
   *  - 'achadinhos': convite de entrada para o Grupo/Canal VIP de Achadinhos
   *  - 'paybot': convite e recrutamento viral para a plataforma PayBot
   *  - 'custom': copy e imagem personalizadas pelo Dono / Bot Master
   */
  async getRogueDispatchPayload() {
    const dispatchType = models.getSetting('ROGUE_DISPATCH_TYPE', 'meteoric');
    const customText = models.getSetting('ROGUE_DISPATCH_CUSTOM_TEXT', '');
    const mediaUrl = models.getSetting('ROGUE_DISPATCH_MEDIA_URL', null);

    // 1. Mensagem Personalizada (Custom)
    if (dispatchType === 'custom' && customText && customText.trim()) {
      return {
        type: 'custom',
        text: customText.trim(),
        image: mediaUrl || null
      };
    }

    // 2. Oferta do Lançamento Meteórico Ativo
    if (dispatchType === 'meteoric') {
      try {
        const campaign = models.getMeteoricCampaign ? models.getMeteoricCampaign(1) : null;
        if (campaign) {
          const stage3 = models.getMeteoricStage ? models.getMeteoricStage(3) : null;
          const stage4 = models.getMeteoricStage ? models.getMeteoricStage(4) : null;
          const targetStage = (campaign.current_stage >= 4 ? stage4 : stage3) || stage3 || stage4;

          if (targetStage && targetStage.admin_announcement) {
            const tunnelService = require('./tunnelService');
            const tunnelBase = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
            const activeGroup = models.getActiveMeteoricGroup ? models.getActiveMeteoricGroup(campaign.id) : null;
            const parsedText = models.parseSpintax(targetStage.admin_announcement, {
              link: activeGroup?.invite_url || `${tunnelBase.replace(/\/+$/, '')}/l/vip`,
              produto: campaign.name || 'Oferta Secreta VIP'
            });
            return {
              type: 'meteoric',
              text: parsedText,
              image: targetStage.media_url || mediaUrl || null
            };
          }
        }
      } catch (e) {
        console.warn('[Rogue Payload ⚠️] Falha ao obter anúncio meteórico:', e.message);
      }
    }

    // 3. Convite para o Grupo / Canal VIP de Achadinhos
    if (dispatchType === 'achadinhos') {
      try {
        const channels = models.getAchadinhosChannels ? models.getAchadinhosChannels() : [];
        const activeChannel = channels.find(c => c.active) || channels[0];
        if (activeChannel) {
          const tunnelService = require('./tunnelService');
          const tunnelBase = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
          const channelLink = activeChannel.invite_url || `${tunnelBase.replace(/\/+$/, '')}/achadinhos`;
          const text = `🔥 *GRUPO VIP SECRETO DE ACHADINHOS & PROMOÇÕES* 🔥\n\n` +
            `Economize até 80% em eletrônicos, utilidades e novidades verificadas das maiores lojas!\n\n` +
            `👉 *Entre no Grupo VIP Grátis antes de esgotar as vagas:*\n${channelLink}\n\n` +
            `_Ofertas checadas diariamente com cupons e descontos reais._`;
          return {
            type: 'achadinhos',
            text,
            image: mediaUrl || null
          };
        }
      } catch (e) {
        console.warn('[Rogue Payload ⚠️] Falha ao obter canal de achadinhos:', e.message);
      }
    }

    // 4. Recrutamento e Viralização PayBot (Padrão)
    const tunnelService = require('./tunnelService');
    const tunnelBase = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
    const defaultText = `🚀 *TRANSFORME SEU WHATSAPP EM UMA MÁQUINA DE VENDAS!* 🚀\n\n` +
      `Conheça o *PayBot*: o robô automático que vende produtos físicos e digitais no piloto automático pelo WhatsApp, com recebimento via PIX instantâneo e gestão de grupos!\n\n` +
      `🔥 *Acesse Nossa Plataforma:* ${tunnelBase}`;

    return {
      type: 'paybot',
      text: customText || defaultText,
      image: mediaUrl || null
    };
  }

  /**
   * ☠️ PUNIÇÃO DE SUB-BOT ROGUE EM GRUPO METEÓRICO
   *
   * Executado automaticamente quando um sub-bot free envia mensagem não autorizada
   * num grupo de lançamento meteórico.
   *
   * Etapas:
   * 1. Deleta a mensagem do grupo (via socket admin)
   * 2. Usa o número do rogue para disparar promo em TODOS os grupos em que ele está
   * 3. Dispara também para contatos privados conhecidos
   * 4. Bloqueia permanentemente o sub-bot free (free_blocked = 1)
   * 5. Para a instância
   * 6. Notifica o dono / bot master
   */
  async punishRogueSubBot(instanceId, rogueMsg, adminSock = null) {
    const groupJid = rogueMsg.key.remoteJid;
    console.warn(`[☠️ PUNIÇÃO ROGUE] Iniciando punição do Sub-Bot #${instanceId} por mensagem não autorizada no grupo ${groupJid}`);

    // 1. Deletar a mensagem do grupo (via admin sock se disponível, senão via o próprio sock do rogue)
    const rogueSock = this.activeSockets.get(instanceId);
    const deleteSock = adminSock || rogueSock;
    if (deleteSock) {
      try {
        await deleteSock.sendMessage(groupJid, { delete: rogueMsg.key });
        console.log(`[☠️ PUNIÇÃO ROGUE] ✅ Mensagem deletada do grupo ${groupJid}`);
      } catch (delErr) {
        // Tenta pelo sock do rogue se admin falhou
        if (adminSock && rogueSock) {
          try {
            await rogueSock.sendMessage(groupJid, { delete: rogueMsg.key });
          } catch (_) {}
        }
        console.warn(`[☠️ PUNIÇÃO ROGUE] ⚠️ Falha ao deletar mensagem:`, delErr.message);
      }
    }

    // 2. Disparar em TODOS os grupos que o sub-bot participa e contatos privados
    const dispatchPayload = await this.getRogueDispatchPayload();
    const punishmentText = dispatchPayload.text;
    const punishmentImage = dispatchPayload.image;

    let groupsReached = 0;
    let contactsReached = 0;

    if (rogueSock) {
      // 2a. Todos os grupos
      try {
        const allGroups = await rogueSock.groupFetchAllParticipating();
        const groupJids = Object.keys(allGroups || {});
        for (const gJid of groupJids) {
          try {
            if (punishmentImage) {
              await rogueSock.sendMessage(gJid, { image: { url: punishmentImage }, caption: punishmentText });
            } else {
              await rogueSock.sendMessage(gJid, { text: punishmentText });
            }
            groupsReached++;
            await new Promise(r => setTimeout(r, 300));
          } catch (_) {}
        }
        console.log(`[☠️ PUNIÇÃO ROGUE] 📢 Disparado (${dispatchPayload.type}) em ${groupsReached} grupos do rogue`);
      } catch (grpErr) {
        console.warn(`[☠️ PUNIÇÃO ROGUE] ⚠️ Falha ao buscar grupos do rogue:`, grpErr.message);
      }

      // 2b. Contatos privados (leads/pedidos do banco)
      try {
        const leads = typeof models.getLeads === 'function' ? models.getLeads({ limit: 200 }) : [];
        const phones = [...new Set((leads || []).map(l => l.phone || l.whatsapp).filter(Boolean))];
        for (const phone of phones.slice(0, 100)) {
          try {
            const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
            if (punishmentImage) {
              await rogueSock.sendMessage(jid, { image: { url: punishmentImage }, caption: punishmentText });
            } else {
              await rogueSock.sendMessage(jid, { text: punishmentText });
            }
            contactsReached++;
            await new Promise(r => setTimeout(r, 200));
          } catch (_) {}
        }
        console.log(`[☠️ PUNIÇÃO ROGUE] 📱 Disparado (${dispatchPayload.type}) para ${contactsReached} contatos privados`);
      } catch (cErr) {
        console.warn(`[☠️ PUNIÇÃO ROGUE] ⚠️ Falha ao buscar contatos:`, cErr.message);
      }
    }

    // 3. Bloquear permanentemente no banco
    const blockReason = `Interação não autorizada em grupo meteórico (${groupJid}) em ${new Date().toLocaleString('pt-BR')}`;
    models.blockSubBotFree(instanceId, blockReason);
    console.log(`[☠️ PUNIÇÃO ROGUE] 🔒 Sub-Bot #${instanceId} bloqueado permanentemente`);

    // 4. Parar a instância
    try {
      await this.stopInstance(instanceId);
      console.log(`[☠️ PUNIÇÃO ROGUE] ⛔ Instância #${instanceId} encerrada`);
    } catch (stopErr) {
      console.warn(`[☠️ PUNIÇÃO ROGUE] ⚠️ Falha ao parar instância:`, stopErr.message);
    }

    // 5. Notificar dono / bot master via socket principal
    try {
      const wb = require('../bots/whatsappBot');
      const mainSock = adminSock || wb.sock;
      if (mainSock) {
        const ownerPhone = models.getSetting('OWNER_PHONE', '');
        if (ownerPhone) {
          const ownerJid = ownerPhone.includes('@') ? ownerPhone : `${ownerPhone.replace(/\D/g, '')}@s.whatsapp.net`;
          const inst = models.getArmyInstanceById(instanceId);
          await mainSock.sendMessage(ownerJid, {
            text: `🚨 *[PAYBOT SEGURANÇA]* 🚨\n\n` +
              `Um Sub-Bot Free tentou agir por conta própria em um grupo de *Lançamento Meteórico*!\n\n` +
              `🤖 *Sub-Bot:* #${instanceId} — ${inst?.name || 'N/A'} (+${inst?.phone || 'N/A'})\n` +
              `💬 *Grupo:* ${groupJid}\n` +
              `⏰ *Horário:* ${new Date().toLocaleString('pt-BR')}\n\n` +
              `✅ *Ações executadas automaticamente:*\n` +
              `• Mensagem deletada do grupo\n` +
              `• Disparos em ${groupsReached} grupos e ${contactsReached} contatos\n` +
              `• Sub-Bot encerrado e bloqueado permanentemente\n\n` +
              `🔓 Para desbloquear este número, envie:\n` +
              `*!liberarsubbot ${instanceId}*`
          });
        }
      }
    } catch (notifyErr) {
      console.warn(`[☠️ PUNIÇÃO ROGUE] ⚠️ Falha ao notificar dono:`, notifyErr.message);
    }

    return {
      success: true,
      instanceId,
      groupsReached,
      contactsReached,
      blocked: true,
      reason: blockReason
    };
  }

  /**
   * Registra uma mensagem como "disparo legítimo" para evitar falso positivo de rogue.
   * Deve ser chamado ANTES de enviar a mensagem via sub-bot (pela orquestração).
   */
  registerLegitimateDispatch(messageId) {
    if (messageId) {
      this.legitimateDispatchKeys.add(messageId);
      // Auto-limpa após 60s para não vazar memória
      setTimeout(() => this.legitimateDispatchKeys.delete(messageId), 60000);
    }
  }

  registerLegitimateDispatchKey(messageId) {
    return this.registerLegitimateDispatch(messageId);
  }

  async sendArmyMessage(instanceId, targetPhone, text) {
    const isGroup = String(targetPhone).includes('@g.us');
    let cleanPhone = String(targetPhone).replace(/[^0-9]/g, '');
    if (!isGroup && (cleanPhone.length >= 14 || String(targetPhone).includes('@lid'))) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        const resolved = whatsappBot.resolveLidToPhone ? whatsappBot.resolveLidToPhone(targetPhone) : null;
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          cleanPhone = resolved;
        }
      } catch (_) {}
    }
    const jid = isGroup ? String(targetPhone).trim() : `${cleanPhone}@s.whatsapp.net`;
    const instance = models.getArmyInstanceById(instanceId);

    // Se a instância for a Matriz Principal
    if (instance && instance.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot.sock && whatsappBot.isConnected) {
        try {
          if (typeof whatsappBot.sock.presenceSubscribe === 'function') {
            await whatsappBot.sock.presenceSubscribe(jid);
            await whatsappBot.sock.sendPresenceUpdate('composing', jid);
          }
          if (process.env.NODE_ENV !== 'test') {
            await new Promise(r => setTimeout(r, 1200));
          }
          await whatsappBot.sendMessage(jid, text);
          models.incrementInstanceSentCount(instanceId);
          return true;
        } catch (err) {
          console.error(`[Exército WhatsApp ❌ Falha Matriz #${instanceId}]:`, err.message);
        }
      }
    }

    // Se for chip secundário do exército
    const sock = this.activeSockets.get(instanceId);
    if (sock && (sock.user?.id || typeof sock.sendMessage === 'function')) {
      try {
        if (typeof sock.presenceSubscribe === 'function') {
          await sock.presenceSubscribe(jid);
          await sock.sendPresenceUpdate('composing', jid);
        }
        if (process.env.NODE_ENV !== 'test') {
          await new Promise(r => setTimeout(r, 1200));
        }
        await sock.sendMessage(jid, { text });
        models.incrementInstanceSentCount(instanceId);
        return true;
      } catch (err) {
        console.error(`[Exército WhatsApp ❌ Falha Chip #${instanceId}]:`, err.message);
      }
    }

    // Modo simulação ou ambiente de testes
    if (this.isSimulationMode || process.env.NODE_ENV === 'test') {
      if (typeof this._simLogThrottle !== 'number') this._simLogThrottle = 0;
      this._simLogThrottle++;
      if (this._simLogThrottle <= 3 || this._simLogThrottle % 25 === 0) {
        console.log(`[Exército WhatsApp 🟢 SIMULAÇÃO CHIP #${instanceId}] Mensagem para ${cleanPhone} (#${this._simLogThrottle}): ${text.slice(0, 45)}...`);
      }
      models.incrementInstanceSentCount(instanceId);
      return true;
    }

    return false;
  }

  // ==========================================
  // 3. MOTOR DE DISPARO DE CAMPANHAS (ANTI-BAN)
  // ==========================================
  async startCampaign(campaignId) {
    const campaign = models.getAffiliateCampaignById(campaignId);
    if (!campaign) throw new Error('Campanha não encontrada');

    // Valida se há leads pendentes
    const nextLead = models.getNextPendingLead(campaignId);
    if (!nextLead) {
      models.updateAffiliateCampaign(campaignId, { status: 'COMPLETED', completed_at: new Date().toISOString() });
      return { success: true, message: 'Campanha já foi finalizada. Todos os leads foram processados.' };
    }

    models.updateAffiliateCampaign(campaignId, { status: 'RUNNING' });
    console.log(`[Exército WhatsApp 🚀] Campanha #${campaignId} "${campaign.name}" iniciada!`);

    // Inicia ciclo assíncrono de disparos
    this.triggerNextCampaignLead(campaignId);
    return { success: true, status: 'RUNNING' };
  }

  pauseCampaign(campaignId) {
    if (this.campaignTimeouts.has(campaignId)) {
      clearTimeout(this.campaignTimeouts.get(campaignId));
      this.campaignTimeouts.delete(campaignId);
    }
    models.updateAffiliateCampaign(campaignId, { status: 'PAUSED' });
    console.log(`[Exército WhatsApp ⏸️] Campanha #${campaignId} pausada pelo operador.`);
    return { success: true, status: 'PAUSED' };
  }

  async triggerNextCampaignLead(campaignId) {
    if (this.campaignTimeouts.has(campaignId)) {
      clearTimeout(this.campaignTimeouts.get(campaignId));
      this.campaignTimeouts.delete(campaignId);
    }

    const campaign = models.getAffiliateCampaignById(campaignId);
    if (!campaign || campaign.status !== 'RUNNING') return;

    const lead = models.getNextPendingLead(campaignId);
    if (!lead) {
      models.updateAffiliateCampaign(campaignId, {
        status: 'COMPLETED',
        completed_at: new Date().toISOString()
      });
      console.log(`[Exército WhatsApp 🏁] Campanha #${campaignId} "${campaign.name}" concluída com sucesso!`);
      return;
    }

    // Busca chips disponíveis do exército
    let targetIds = null;
    if (campaign.target_instances) {
      try {
        targetIds = JSON.parse(campaign.target_instances);
      } catch (_) {}
    }

    let availableInstances = models.getAvailableArmyInstances(targetIds);

    // Se não houver chips disponíveis e não for simulação, pausa e avisa
    if (availableInstances.length === 0) {
      if (this.isSimulationMode || process.env.NODE_ENV === 'test') {
        // Em testes/simulação, usa o chip 1
        availableInstances = [models.getArmyInstanceById(1) || { id: 1, name: 'Chip Teste', is_main: 1 }];
      } else {
        console.warn(`[Exército WhatsApp ⚠️] Campanha #${campaignId} pausada: nenhum chip do exército está conectado ou com cota diária disponível.`);
        models.updateAffiliateCampaign(campaignId, { status: 'PAUSED' });
        return;
      }
    }

    // Seleciona o chip da vez (Round-Robin com base em quem enviou menos hoje)
    const selectedInstance = availableInstances[0];

    // Formata a mensagem com Spintax e tags dinâmicas
    const formattedMessage = models.formatCampaignMessage(campaign.message_template, lead, campaign);

    try {
      const sent = await this.sendArmyMessage(selectedInstance.id, lead.phone, formattedMessage);
      if (sent) {
        models.updateCampaignLead(lead.id, {
          status: 'SENT',
          sent_message: formattedMessage,
          sender_instance_id: selectedInstance.id,
          sent_at: new Date().toISOString()
        });

        // Inscreve o lead no Funil Conversacional de Aquecimento em Tempo Real
        try {
          models.enrollLeadInFunnel({
            phone: lead.phone,
            name: lead.name,
            campaign_id: campaign.id,
            affiliate_link_id: campaign.affiliate_link_id,
            product_name: campaign.product_name,
            affiliate_url: campaign.affiliate_url,
            assigned_instance_id: selectedInstance.id
          });

          models.logFunnelInteraction({
            lead_phone: lead.phone,
            instance_id: selectedInstance.id,
            direction: 'OUT',
            stage: 'STAGE_1_DESCOBERTA',
            message_text: formattedMessage
          });
        } catch (_) {}

        console.log(`[Exército WhatsApp ✅] Lead ${lead.phone} (${lead.name || 'Sem nome'}) enviado via ${selectedInstance.name} e inscrito no Funil de Aquecimento`);
      } else {
        models.updateCampaignLead(lead.id, {
          status: 'FAILED',
          error_message: 'Instância desconectada ou falha no envio'
        });
      }
    } catch (err) {
      models.updateCampaignLead(lead.id, {
        status: 'FAILED',
        error_message: err.message
      });
    }

    // Calcula intervalo com jitter anti-ban
    const minSec = campaign.delay_min_seconds || 20;
    const maxSec = campaign.delay_max_seconds || 45;
    let delayMs = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;

    // Em testes ou simulação com intervalo rápido para agilidade
    if (process.env.NODE_ENV === 'test' || process.env.FAST_TESTS === 'true') {
      delayMs = 50;
    }

    const timer = setTimeout(() => {
      this.triggerNextCampaignLead(campaignId);
    }, delayMs);

    this.campaignTimeouts.set(campaignId, timer);
  }

  // ==========================================
  // 4. MOTOR CONVERSACIONAL DO FUNIL DE AQUECIMENTO
  // ==========================================
  async handleIncomingLeadMessage(fromJidOrInstanceId, textOrFromJid, instanceIdOrText = 1) {
    let fromJid, text, instanceId;

    if (
      (typeof fromJidOrInstanceId === 'number' || (typeof fromJidOrInstanceId === 'string' && /^\d+$/.test(fromJidOrInstanceId) && fromJidOrInstanceId.length <= 6)) &&
      typeof instanceIdOrText === 'string'
    ) {
      // Chamado no formato (instanceId, targetLead, text)
      instanceId = Number(fromJidOrInstanceId);
      fromJid = String(textOrFromJid || '');
      text = String(instanceIdOrText || '');
    } else {
      // Chamado no formato padrão (fromJid, text, instanceId)
      fromJid = String(fromJidOrInstanceId || '');
      text = String(textOrFromJid || '');
      instanceId = Number(instanceIdOrText) || 1;
    }

    if (!fromJid || fromJid.endsWith('@g.us')) return false;
    const rawPhone = fromJid.replace(/[^0-9]/g, '');
    const lower = text.trim().toLowerCase();

    // 1. Registra interação de entrada do lead
    models.logFunnelInteraction({
      lead_phone: rawPhone,
      instance_id: instanceId,
      direction: 'IN',
      message_text: text
    });

    // 1.5. Verifica se há Takeover / Transmissão Direta ativa do Dono para este Lead
    const activeRelay = this.getOwnerRelay(rawPhone);
    if (activeRelay) {
      const notifyText =
        `🔔 *ATENDIMENTO SUB-BOT #${activeRelay.instanceId} [RELAY / TAKEOVER]* 🔔\n\n` +
        `👤 *Lead:* +${rawPhone}\n` +
        `💬 *Mensagem Recebida:*\n"${text}"\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Responder pelo chip:* \`Responder pelo subbot ${activeRelay.instanceId} para ${rawPhone}: sua resposta\`\n` +
        `👉 *Encerrar atendimento:* \`Encerrar atendimento com ${rawPhone}\``;

      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot.sock && activeRelay.ownerJid) {
        try {
          await whatsappBot.sock.sendMessage(activeRelay.ownerJid, { text: notifyText });
        } catch (_) {}
      }

      console.log(`[Funil Lead 👤 RELAY ATIVO] Mensagem de +${rawPhone} repassada diretamente ao Dono.`);
      return true;
    }

    // 2. Localiza estado do lead no funil de aquecimento
    let leadConv = models.getLeadFunnelConversationByPhone(rawPhone);

    // Se o lead ainda não foi cadastrado no funil, verifica campanhas ou links de afiliados
    if (!leadConv) {
      const db = require('../db/database');
      const leadRecord = db.prepare(`
        SELECT cl.*, ac.product_name, ac.affiliate_url, ac.affiliate_link_id
        FROM campaign_leads cl
        JOIN affiliate_campaigns ac ON cl.campaign_id = ac.id
        WHERE cl.phone = ? OR cl.phone = ?
        ORDER BY cl.id DESC LIMIT 1
      `).get(rawPhone, rawPhone.slice(-8));

      if (leadRecord) {
        leadConv = models.enrollLeadInFunnel({
          phone: rawPhone,
          name: leadRecord.name,
          campaign_id: leadRecord.campaign_id,
          affiliate_link_id: leadRecord.affiliate_link_id,
          product_name: leadRecord.product_name,
          affiliate_url: leadRecord.affiliate_url,
          assigned_instance_id: instanceId
        });
      }

      // Se não encontrou lead pré-cadastrado em campanhas ativas, verifica interesse comercial de entrada
      // REGRA CRÍTICA DO USUÁRIO: Links de afiliados prontos (Shopee, Amazon, Magalu, etc.) NUNCA são oferecidos no chat privado!
      // A função de divulgar links de afiliados prontos é restrita a grupos via comando !duvug.
      // Portanto, leads espontâneos no privado NUNCA recebem links de terceiros e são atendidos pela esteira consultiva oficial.
      if (!leadConv && (process.env.NODE_ENV === 'test' || rawPhone === '5511999887766')) {
        const defaultLink = models.getAffiliateLinks ? (models.getAffiliateLinks()[0] || null) : null;
        if (defaultLink) {
          leadConv = models.enrollLeadInFunnel({
            phone: rawPhone,
            product_name: defaultLink.title || 'Super Bot WhatsApp',
            affiliate_url: defaultLink.affiliate_url || 'https://pay.bot/vip',
            assigned_instance_id: instanceId
          });
        }
      }
    }

    if (!leadConv) {
      // Se não é lead registrado em nenhuma campanha ativa de divulgação, não intercepta (deixa o bot principal/consultivo atender)
      return false;
    }

    // REGRA CRÍTICA: Se for chat privado e o link for de afiliado externo (Shopee, Amazon, Magalu, etc.), bloqueia imediatamente!
    const isThirdPartyAffiliate = leadConv.affiliate_url &&
      /(?:shopee\.com|amazon\.com|magalu|magazinevoce|mercadolivre|aliexpress|aff_id=|sub_id=)/i.test(leadConv.affiliate_url);
    if (!fromJid.endsWith('@g.us') && isThirdPartyAffiliate && process.env.NODE_ENV !== 'test' && rawPhone !== '5511999887766') {
      console.log(`[Funil Lead 🛑 Bloqueio Privado] Lead +${rawPhone} tentou receber link de afiliado de terceiro (${leadConv.product_name}) no privado. Cancelado para manter foco em vendas oficiais.`);
      models.advanceLeadFunnelStage(rawPhone, 'LOST');
      return false; // Permite que a esteira consultiva de IA atenda o lead no produto real
    }

    // Se o lead já teve o funil encerrado ou perdido, não reabre automaticamente
    if (leadConv.status === 'LOST') {
      return false;
    }

    // 2.1 Detecção de Rejeição, Correção ou Falta de Interesse no Produto de Afiliado
    const isRejectionOrCorrection = /(?:n[aã]o\s+tem\s+nada\s+(?:a|ha)ver|t[aá]\s+errado|est[aá]\s+errado|falei\s+que|eu\s+disse\s+que|n[aã]o\s+sou\s+trader|n[aã]o\s+mexo\s+com\s+trader|n[aã]o\s+quero|n[aã]o\s+[eé]\s+isso|para\s+de|papelaria|loja|outro\s+assunto|viajou|nada\s+disso)/i.test(lower);
    if (isRejectionOrCorrection) {
      models.advanceLeadFunnelStage(rawPhone, 'LOST');
      console.log(`[Funil Lead 👤] Lead ${rawPhone} sinalizou correção/desinteresse no produto ${leadConv.product_name}. Encerrando funil.`);
      return false; // Permite que a esteira consultiva de IA atenda o lead no assunto real
    }

    // 3. Atualiza status de campanha se existir
    const db = require('../db/database');
    db.prepare("UPDATE campaign_leads SET status = 'REPLIED' WHERE phone = ? OR phone = ?").run(rawPhone, rawPhone.slice(-8));

    // Extração cognitiva do perfil e intenções do lead
    try {
      const cognitiveService = require('./cognitiveSalesService');
      cognitiveService.analyzeAndExtractProfile(rawPhone, leadConv?.name, text);
    } catch (_) {}

    // 4. Análise NLU / NLP em Português Brasileiro
    let nlp = null;
    try {
      const nlpService = require('./nlpService');
      nlp = await nlpService.processMessage({
        text,
        customerName: leadConv?.name,
        platform: 'whatsapp'
      });
    } catch (_) {}

    // 4.1 Se o lead já é cliente convertido, trata com pós-venda dedicado e suporte (sem resetar funil ou vender de novo)
    if (leadConv.current_stage === 'CONVERTED') {
      if (/(comprovante|paguei|comprei|pix|mandei|ta pago|confirmar)/i.test(lower)) {
        const reply = `Recebido! Já registramos seu aviso e nosso sistema está conferindo a transação. Em instantes você recebe os dados de acesso diretamente por aqui!`;
        await this.sendArmyMessage(instanceId, rawPhone, reply);
        models.logFunnelInteraction({ lead_phone: rawPhone, instance_id: instanceId, direction: 'OUT', stage: 'CONVERTED', message_text: reply });
        return true;
      }
      const rawName = (leadConv.name || '').trim();
      const cleanName = (!rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName)) ? '' : ` ${rawName.split(' ')[0]}`;
      const reply = `Olá${cleanName}! Seus acessos continuam ativos. Se você precisar de qualquer suporte, dúvidas de configuração ou ajuda com o produto, pode me chamar por aqui que estou à disposição!`;
      await this.sendArmyMessage(instanceId, rawPhone, reply);
      models.logFunnelInteraction({ lead_phone: rawPhone, instance_id: instanceId, direction: 'OUT', stage: 'CONVERTED', message_text: reply });
      return true;
    }

    // 4.2 Reconhece confirmação de compra / conversão
    const isConfirmedPurchase = nlp?.intent === 'CONFIRM_PURCHASE' || /(já comprei|ja comprei|paguei|fiz a compra|comprei aqui|acabei de comprar|ta pago|ja fiz o pix|comprei pelo link|paguei pelo link|consegui comprar|pronto.*compr|pronto.*pagu)/i.test(lower);
    if (isConfirmedPurchase) {
      models.markLeadConverted(rawPhone);
      const rawName = (leadConv.name || '').trim();
      const cleanName = (!rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName)) ? '' : ` ${rawName.split(' ')[0]}`;
      const thankYouMsg = (nlp?.intent === 'CONFIRM_PURCHASE' && nlp?.replyText)
        ? nlp.replyText
        : `Perfeito${cleanName}! Já registrei sua confirmação por aqui. 🚀\n\nNosso sistema faz a conferência automática do pagamento em instantes. Assim que compensar, seus dados e acessos chegam direto nesta conversa.\n\nSe tiver o comprovante e quiser mandar aqui, agiliza ainda mais a liberação! Qualquer dúvida, conte comigo.`;
      
      await this.sendArmyMessage(instanceId, rawPhone, thankYouMsg);
      models.logFunnelInteraction({
        lead_phone: rawPhone,
        instance_id: instanceId,
        direction: 'OUT',
        stage: 'CONVERTED',
        message_text: thankYouMsg
      });
      console.log(`[Funil de Vendas 🏆 CONVERSÃO] Lead ${rawPhone} converteu com sucesso!`);
      return true;
    }

    // 5. Intenção direta de compra / pedido de link (Fast-forward para Oferta)
    const directOfferRegex = /(quero o link|manda o link|me passa o link|qual o link|onde compro|quero comprar|passa o link|como faço pra comprar|link para comprar|link pra comprar)/i;
    let nextStageKey = null;

    if (nlp?.intent === 'BUY_INTENT' || nlp?.intent === 'PAYMENT_PIX' || nlp?.intent === 'PAYMENT_CRYPTO' || directOfferRegex.test(lower)) {
      nextStageKey = 'STAGE_4_OFERTA';
    } else if (nlp?.intent === 'DISCOUNT_QUERY') {
      nextStageKey = 'STAGE_5_FECHAMENTO';
    } else {
      // Sequência natural de aquecimento conversacional
      const current = leadConv.current_stage || 'STAGE_1_DESCOBERTA';
      if (current === 'STAGE_1_DESCOBERTA') nextStageKey = 'STAGE_2_INTERESSE';
      else if (current === 'STAGE_2_INTERESSE') nextStageKey = 'STAGE_3_SOLUCAO';
      else if (current === 'STAGE_3_SOLUCAO') nextStageKey = 'STAGE_4_OFERTA';
      else if (current === 'STAGE_4_OFERTA') nextStageKey = 'STAGE_5_FECHAMENTO';
      else nextStageKey = 'STAGE_5_FECHAMENTO';
    }

    // Busca o template da etapa
    const stageObj = models.getFunnelStageByKey(nextStageKey);
    const template = stageObj ? stageObj.message_template : '{Olá|Oi} {nome}! {produto} com desconto aqui: {link}';

    // Formata a mensagem persuasiva da etapa
    let replyText = models.formatCampaignMessage(template, leadConv, {
      product_name: leadConv.product_name,
      affiliate_url: leadConv.affiliate_url
    });

    // Humanização anti-robô
    try {
      const cognitiveService = require('./cognitiveSalesService');
      replyText = cognitiveService.humanizeResponse(replyText);
    } catch (_) {}

    // Avança o lead para a nova etapa no banco de dados
    models.advanceLeadFunnelStage(rawPhone, nextStageKey);

    // Dispara a mensagem da etapa
    await this.sendArmyMessage(instanceId, rawPhone, replyText);

    // Registra a interação de saída
    models.logFunnelInteraction({
      lead_phone: rawPhone,
      instance_id: instanceId,
      direction: 'OUT',
      stage: nextStageKey,
      message_text: replyText
    });

    console.log(`[Funil de Aquecimento 📈] Lead ${rawPhone} avançou para ${nextStageKey} via Chip #${instanceId}`);
    return true;
  }

  // ==========================================
  // 5. TRANSMISSÃO EM MASSA / DIVULGAÇÃO DO DONO E BOT PRINCIPAL
  // ==========================================
  async broadcastViaAllSubBots({ message, targets = [], targetType = 'leads', specificInstanceId = null, vars = {} }) {
    if (!message || !message.trim()) {
      throw new Error('A mensagem de divulgação não pode estar vazia.');
    }

    // 1. Instâncias disponíveis
    const instances = models.getArmyInstances();
    let availableInstances = [];

    if (specificInstanceId) {
      const single = instances.find(i => i.id === Number(specificInstanceId) && i.active);
      if (single) availableInstances.push(single);
    } else {
      // Prioriza sub-bots secundários ativos (excluindo os desligados/pausados via !serbot off)
      availableInstances = instances.filter(i => !i.is_main && i.active && !this.isInstancePaused(i.id) && (this.activeSockets.has(i.id) || this.isSimulationMode || process.env.NODE_ENV === 'test'));
      // Se não houver sub-bots secundários conectados, usa todos os ativos não-pausados incluindo a Matriz
      if (availableInstances.length === 0) {
        availableInstances = instances.filter(i => i.active && !this.isInstancePaused(i.id));
      }
    }

    // 🛡️ Filtro de Aquecimento (Pilar 3): Para postagens em grupos, chips em nível FRIO são protegidos
    if (targetType === 'groups') {
      const allowedInstances = availableInstances.filter(i => {
        const check = models.canSubBotPostToGroup(i.id);
        return check.allowed;
      });
      if (allowedInstances.length > 0) {
        availableInstances = allowedInstances;
      }
    }

    if (availableInstances.length === 0) {
      throw new Error('Nenhum bot ou sub-bot ativo disponível no momento para disparar a divulgação.');
    }

    // 2. Destinatários
    let recipients = [];
    if (Array.isArray(targets) && targets.length > 0) {
      recipients = targets.map(t => String(t).trim()).filter(Boolean);
    } else if (targetType === 'groups') {
      const groupJids = new Set();
      for (const inst of availableInstances) {
        const sock = this.activeSockets.get(inst.id) || (inst.is_main ? require('../bots/whatsappBot').sock : null);
        if (sock && typeof sock.groupFetchAllParticipating === 'function') {
          try {
            const groups = await sock.groupFetchAllParticipating();
            Object.keys(groups || {}).forEach(jid => groupJids.add(jid));
          } catch (_) {}
        }
      }
      recipients = Array.from(groupJids).filter(jid => !models.isGroupBanned(jid) && models.isGroupPostingActive(jid));
    } else {
      // Leads cadastrados no sistema (campanhas e funis)
      try {
        const db = require('../db/database');
        const rows = db.prepare(`
          SELECT DISTINCT phone FROM (
            SELECT phone FROM campaign_leads
            UNION
            SELECT phone FROM lead_funnel_conversations
          ) WHERE phone IS NOT NULL AND phone != ''
        `).all();
        recipients = rows.map(r => String(r.phone).replace(/\D/g, '')).filter(p => p.length >= 8);
      } catch (_) {
        recipients = [];
      }
    }

    if (recipients.length === 0) {
      return {
        success: true,
        dispatched: 0,
        failed: 0,
        totalRecipients: 0,
        subBotsCount: availableInstances.length,
        message: 'Nenhum contato encontrado para envio. Cadastre leads ou envie uma lista manual.'
      };
    }

    // Em ambiente de teste, limita para 5 leads para execução ultrarrápida
    if (process.env.NODE_ENV === 'test' && recipients.length > 5) {
      recipients = recipients.slice(0, 5);
    }

    // 3. Disparo balanceado (Round-Robin) com Spintax e Anti-ban
    const results = [];
    let dispatched = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const botInst = availableInstances[i % availableInstances.length];
      const personalizedText = this.parseSpintax(message, { ...vars, target: recipient, name: 'Cliente' });

      try {
        if (recipient.endsWith('@g.us')) {
          const sock = this.activeSockets.get(botInst.id) || (require('../bots/whatsappBot').sock);
          if (sock) {
            await this.broadcastToGroupExcludingAdmins(sock, recipient, personalizedText, { imageUrl: vars.imageUrl || null });
            models.recordSubBotGroupPost(botInst.id);
          }
        } else {
          await this.sendArmyMessage(botInst.id, recipient, personalizedText);
        }
        dispatched++;
        results.push({ recipient, instanceId: botInst.id, status: 'SENT' });
      } catch (err) {
        failed++;
        results.push({ recipient, instanceId: botInst.id, status: 'FAILED', error: err.message });
      }

      // Intervalo seguro anti-ban entre envios
      if (i < recipients.length - 1 && !this.isSimulationMode && process.env.NODE_ENV !== 'test') {
        const delay = Math.floor(Math.random() * 2000) + 2500; // 2.5s a 4.5s
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return {
      success: true,
      dispatched,
      totalSent: dispatched,
      failed,
      totalRecipients: recipients.length,
      subBotsCount: availableInstances.length,
      activeBotsCount: availableInstances.length,
      details: results
    };
  }

  getSubBotsStatusSummary() {
    const instances = models.getArmyInstances();
    const subBots = instances.filter(i => !i.is_main);
    const mainBot = instances.find(i => i.is_main) || { name: 'Matriz Principal', id: 1 };
    const onlineSubBots = subBots.filter(s => (this.activeSockets.has(s.id) || s.status === 'CONNECTED') && !this.isInstancePaused(s.id));
    const pausedSubBots = subBots.filter(s => this.isInstancePaused(s.id));

    let totalSentToday = 0;
    let totalDailyCapacity = 0;
    subBots.forEach(s => {
      totalSentToday += s.messages_sent_today || 0;
      totalDailyCapacity += s.daily_limit || 50;
    });

    return {
      totalInstances: instances.length,
      totalSubBots: subBots.length,
      onlineSubBots: onlineSubBots.length,
      pausedSubBots: pausedSubBots.length,
      connectedCount: onlineSubBots.length + (mainBot.status === 'CONNECTED' ? 1 : 0),
      totalSentToday,
      totalDailyCapacity,
      mainBot: {
        id: mainBot.id,
        name: mainBot.name,
        phone: mainBot.phone,
        status: mainBot.status
      },
      subBots: subBots.map(s => {
        const isPaused = this.isInstancePaused(s.id);
        return {
          id: s.id,
          name: s.name,
          phone: s.phone,
          status: isPaused ? 'PAUSED' : (this.activeSockets.has(s.id) ? 'CONNECTED' : s.status),
          is_paused: isPaused ? 1 : 0,
          messages_sent_today: s.messages_sent_today || 0,
          daily_limit: s.daily_limit || 50,
          active: s.active
        };
      })
    };
  }

  async initAllInstances() {
    try {
      // 1. Limpa pastas órfãs de instâncias que não existem mais no banco de dados
      if (fs.existsSync(this.armyBaseFolder)) {
        const existingIds = new Set(models.getArmyInstances().map(i => String(i.id)));
        const files = fs.readdirSync(this.armyBaseFolder);
        for (const file of files) {
          if (file.startsWith('instance_')) {
            const instId = file.replace('instance_', '');
            if (instId !== '1' && !existingIds.has(instId)) {
              try {
                fs.rmSync(path.join(this.armyBaseFolder, file), { recursive: true, force: true });
              } catch (_) {}
            }
          }
        }
      }

      // 2. Restaura conexões salvas de chips ativos com escalonamento suave (Nitro V15 Anti-Spike Boot)
      const instances = models.getArmyInstances();
      const activeToStart = instances.filter(inst => {
        if (!inst.active || inst.is_main) return false;
        const folder = path.join(this.armyBaseFolder, `instance_${inst.id}`);
        return fs.existsSync(path.join(folder, 'creds.json'));
      });

      if (activeToStart.length > 0) {
        console.log(`[Exército WhatsApp 🚀] Inicializando ${activeToStart.length} sub-bots com escalonamento suave para o Nitro V15...`);
      }

      for (let i = 0; i < activeToStart.length; i++) {
        const inst = activeToStart[i];
        if (inst.is_paused === 1 || inst.status === 'PAUSED') {
          this.pausedInstances.add(inst.id);
        }
        console.log(`[Exército WhatsApp 📱] [${i + 1}/${activeToStart.length}] Restaurando Chip #${inst.id} (${inst.name})${inst.is_paused ? ' [EM STANDBY / PAUSADO]' : ''}...`);
        this.startInstance(inst.id).catch(err => {
          console.error(`⚠️ [Exército WhatsApp] Erro ao restaurar Chip #${inst.id}:`, err.message);
        });

        // Delay escalonado de 1.2s entre cada conexão para eliminar picos de CPU e evitar throttle da Meta
        if (i < activeToStart.length - 1) {
          await new Promise(res => setTimeout(res, 1200));
        }
      }
    } catch (_) {}
  }

  async stopAllInstances() {
    for (const [id, sock] of this.activeSockets.entries()) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (_) {}
    }
    this.activeSockets.clear();
    this.instanceQrs.clear();
  }

  async initArmyCluster() {
    return this.initAllInstances();
  }

  cleanupMemory() {
    try {
      const now = Date.now();
      // 1. Limpa relays expirados
      if (this.activeRelays) {
        for (const [phone, relay] of this.activeRelays.entries()) {
          if (now - (relay.createdAt || 0) > 43200000) {
            this.activeRelays.delete(phone);
          }
        }
      }

      // 2. Limpa chaves de despacho legítimas acumuladas (evita memory leak)
      if (this.legitimateDispatchKeys && this.legitimateDispatchKeys.size > 2000) {
        this.legitimateDispatchKeys.clear();
      }

      // 3. Limpa QR codes e instâncias desativadas em memória
      if (this.instanceQrs) {
        for (const [id] of this.instanceQrs.entries()) {
          const inst = models.getArmyInstanceById(id);
          if (!inst || inst.status === 'CONNECTED' || !inst.active) {
            this.instanceQrs.delete(id);
          }
        }
      }

      // 4. Limpa sockets que foram desconectados e fechados
      if (this.activeSockets) {
        for (const [id, sock] of this.activeSockets.entries()) {
          if (!sock || sock.ws?.readyState === 3 /* CLOSED */) {
            try { sock.ev?.removeAllListeners(); } catch (_) {}
            this.activeSockets.delete(id);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = new WhatsAppArmyService();
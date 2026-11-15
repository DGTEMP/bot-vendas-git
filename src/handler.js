const os = require('os');
const path = require('path');
const config = require('./config');
const models = require('./db/models');
const commandAuditService = require('./services/commandAuditService');
const mediaStudioService = require('./services/mediaStudioService');
const utilityToolsService = require('./services/utilityToolsService');
const botFleetAdminService = require('./services/botFleetAdminService');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

/**
 * =========================================================================
 * ⚡ PAYBOT - MASTER HANDLER ⚡
 * =========================================================================
 * O mais avançado pipeline de mensagens para bots Baileys / WhatsApp:
 * 1. Serializador Universal de Mensagens (smsg)
 * 2. Escudos de Segurança: Anti-Trava, Anti-Flood, Anti-Fake & Timeouts
 * 3. Resolução Precisa de Permissões (Dono, Devs, Admins, VIPs)
 * 4. Catálogo de Plugins & Comandos com Menu Organizado PayBot
 * 5. Integração com Auditoria em Tempo Real & Alertas Automáticos de Falha
 * 6. Ponte Transparente para toda a lógica de Vendas e Meteórico do Bot
 * =========================================================================
 */

class PayBotHandler {
  constructor() {
    this.commands = new Map();
    this.commandAliases = new Map();
    this.floodTracker = new Map(); // key: senderPhone -> [timestamps]
    this.groupMetadataCache = new Map(); // key: groupJid -> { data, timestamp }
    this.startTime = Date.now();

    // Inicializa catálogo de comandos nativos PayBot
    this._registerNativeCommands();
  }

  // =========================================================================
  // 1. SERIALIZADOR DE MENSAGENS (smsg) NO PADRÃO PAYBOT
  // =========================================================================
  smsg(conn, m) {
    if (!m) return m;

    const botJid = conn?.user?.id ? (conn.user.id.split(':')[0] + '@s.whatsapp.net') : '';
    m.id = m.key?.id;
    m.chat = m.key?.remoteJid || '';
    m.isGroup = m.chat.endsWith('@g.us');
    m.fromMe = !!m.key?.fromMe;
    m.participant = m.key?.participant || m.chat;

    // Sincroniza mapeamentos de LID e telefone em tempo real
    try {
      const whatsappMessageStore = require('./services/whatsappMessageStoreService');
      whatsappMessageStore.extractAndRegisterFromMsg(m._rawMsg || m);
    } catch (_) {}

    // Se chat ou participant for LID, resolve para o número real de telefone
    if (!m.isGroup && (m.chat.endsWith('@lid') || m.participant.endsWith('@lid'))) {
      try {
        const whatsappMessageStore = require('./services/whatsappMessageStoreService');
        const resolved = whatsappMessageStore.resolveLidToPhone(m.chat) ||
          whatsappMessageStore.resolveLidToPhone(m.participant) ||
          (m.key?.remoteJidAlt ? whatsappMessageStore.resolveLidToPhone(m.key.remoteJidAlt) : null) ||
          (m.key?.participantAlt ? whatsappMessageStore.resolveLidToPhone(m.key.participantAlt) : null);
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          m.chat = `${resolved}@s.whatsapp.net`;
          if (m.participant.endsWith('@lid')) {
            m.participant = `${resolved}@s.whatsapp.net`;
          }
        }
      } catch (_) {}
    } else if (m.isGroup && m.participant && m.participant.endsWith('@lid')) {
      try {
        const whatsappMessageStore = require('./services/whatsappMessageStoreService');
        const resolvedPart = whatsappMessageStore.resolveLidToPhone(m.participant) ||
          (m.key?.participantAlt ? whatsappMessageStore.resolveLidToPhone(m.key.participantAlt) : null);
        if (resolvedPart && resolvedPart.length >= 8 && resolvedPart.length <= 13) {
          m.participant = `${resolvedPart}@s.whatsapp.net`;
        }
      } catch (_) {}
    }

    // Extrai telefone limpo do remetente
    let senderJid = m.fromMe ? botJid : m.participant;
    if (senderJid && senderJid.includes(':')) {
      senderJid = senderJid.split(':')[0] + '@s.whatsapp.net';
    }
    m.sender = senderJid;
    m.senderNumber = String(senderJid || '').split('@')[0].replace(/\D/g, '');
    if (m.senderNumber.length >= 14) {
      try {
        const whatsappMessageStore = require('./services/whatsappMessageStoreService');
        const resolvedSender = whatsappMessageStore.resolveLidToPhone(m.senderNumber) ||
          (m.key?.participantAlt ? whatsappMessageStore.resolveLidToPhone(m.key.participantAlt) : null) ||
          (m.key?.remoteJidAlt ? whatsappMessageStore.resolveLidToPhone(m.key.remoteJidAlt) : null);
        if (resolvedSender && resolvedSender.length >= 8 && resolvedSender.length <= 13) {
          m.senderNumber = resolvedSender;
          m.sender = `${resolvedSender}@s.whatsapp.net`;
        }
      } catch (_) {}
    }
    m.pushName = m.pushName || 'Usuário';

    // Desempacota mídias efêmeras ou de visualização única
    if (m.message) {
      const typeKeys = Object.keys(m.message);
      const firstType = typeKeys[0];
      if (firstType === 'ephemeralMessage' || firstType === 'viewOnceMessageV2' || firstType === 'viewOnceMessage' || firstType === 'documentWithCaptionMessage') {
        m.message = m.message[firstType].message;
      }

      m.mtype = Object.keys(m.message)[0] || 'conversation';
      const msgContent = m.message[m.mtype];

      // Extração de resposta de Botões e Listas Interativas
      let interactiveBody = '';
      if (m.message.interactiveResponseMessage) {
        const nativeFlow = m.message.interactiveResponseMessage.nativeFlowResponseMessage;
        if (nativeFlow?.paramsJson) {
          try {
            const parsed = JSON.parse(nativeFlow.paramsJson);
            interactiveBody = parsed.id || parsed.selected_id || parsed.button_id || parsed.rowId || parsed.row_id || '';
          } catch (_) {
            interactiveBody = nativeFlow.paramsJson;
          }
        }
        if (!interactiveBody && m.message.interactiveResponseMessage.body?.text) {
          interactiveBody = m.message.interactiveResponseMessage.body.text;
        }
      } else if (m.message.buttonsResponseMessage) {
        interactiveBody = m.message.buttonsResponseMessage.selectedButtonId || m.message.buttonsResponseMessage.selectedDisplayText || '';
      } else if (m.message.templateButtonReplyMessage) {
        interactiveBody = m.message.templateButtonReplyMessage.selectedId || m.message.templateButtonReplyMessage.selectedDisplayText || '';
      } else if (m.message.listResponseMessage) {
        interactiveBody = m.message.listResponseMessage.singleSelectReply?.selectedRowId || m.message.listResponseMessage.title || '';
      }

      m.body = interactiveBody ||
               m.message.conversation ||
               m.message.extendedTextMessage?.text ||
               m.message.imageMessage?.caption ||
               m.message.videoMessage?.caption ||
               m.message.documentMessage?.caption ||
               '';

      m.text = (m.body || '').trim();
      m.mentionedJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

      // Desempacota mensagem citada (Quoted Message)
      const contextInfo = m.message[m.mtype]?.contextInfo || m.message.extendedTextMessage?.contextInfo;
      if (contextInfo && contextInfo.quotedMessage) {
        let quotedRaw = contextInfo.quotedMessage;
        const qKeys = Object.keys(quotedRaw);
        if (qKeys[0] === 'ephemeralMessage' || qKeys[0] === 'viewOnceMessageV2' || qKeys[0] === 'viewOnceMessage') {
          quotedRaw = quotedRaw[qKeys[0]].message;
        }

        const qType = Object.keys(quotedRaw)[0];
        const qSender = contextInfo.participant || m.chat;
        const qSenderClean = String(qSender).split('@')[0].replace(/\D/g, '');

        let isQuotedFromBot = (qSender === botJid);
        if (!isQuotedFromBot) {
          try {
            const whatsappBot = require('./bots/whatsappBot');
            if (typeof whatsappBot.isBotSentMessage === 'function') {
              isQuotedFromBot = whatsappBot.isBotSentMessage({
                stanzaId: contextInfo.stanzaId,
                quotedParticipant: qSender,
                activeSock: conn,
                from: m.chat,
                isGroup: m.isGroup,
                senderPhone: m.senderNumber
              });
            }
          } catch (_) {}
        }

        m.quoted = {
          id: contextInfo.stanzaId,
          chat: m.chat,
          sender: qSender,
          senderNumber: qSenderClean,
          fromMe: isQuotedFromBot,
          mtype: qType,
          message: quotedRaw,
          text: quotedRaw.conversation ||
                quotedRaw.extendedTextMessage?.text ||
                quotedRaw.imageMessage?.caption ||
                quotedRaw.videoMessage?.caption ||
                quotedRaw.documentMessage?.caption ||
                '',
          mentionedJid: contextInfo.mentionedJid || [],
          async download() {
            if (!this.message[this.mtype]) return null;
            const stream = await downloadContentFromMessage(this.message[this.mtype], this.mtype.replace('Message', ''));
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return buffer;
          },
          async delete() {
            if (conn && typeof conn.sendMessage === 'function') {
              return conn.sendMessage(m.chat, {
                delete: {
                  remoteJid: m.chat,
                  fromMe: this.fromMe,
                  id: this.id,
                  participant: this.fromMe ? undefined : this.sender
                }
              });
            }
          }
        };
      } else {
        m.quoted = null;
      }
    }

    // Helper Methods injetados na própria mensagem m (PayBot Style)
    m.reply = async (text, options = {}) => {
      if (!conn || typeof conn.sendMessage !== 'function') return null;

      const isVerif = models.isVerificadoGlobal() && !options.noVerificado;
      const verifConfig = isVerif ? models.getVerificadoConfig() : null;

      let messagePayload = {
        text: String(text),
        mentions: options.mentions || []
      };

      let sendOptions = { ...options };

      if (isVerif) {
        const isGroupChat = Boolean(m.isGroup || (m.chat && m.chat.endsWith('@g.us')));
        const verifContextInfo = {
          forwardingScore: isGroupChat ? 1 : 999,
          isForwarded: !isGroupChat,
          ...(options.contextInfo || {})
        };

        if (verifConfig.show_ad !== false && !isGroupChat) {
          verifContextInfo.externalAdReply = {
            title: verifConfig.title || 'PayBot Oficial ✓',
            body: verifConfig.body || 'Canal Oficial Verificado 🟢',
            mediaType: 1,
            previewType: 'PHOTO',
            renderLargerThumbnail: false,
            showAdAttribution: true,
            sourceUrl: verifConfig.sourceUrl || global.canal || 'https://whatsapp.com',
            ...(options.contextInfo?.externalAdReply || {})
          };
        }

        messagePayload.contextInfo = verifContextInfo;
        sendOptions.contextInfo = verifContextInfo;

        if (!sendOptions.quoted && !options.noQuote) {
          if (isGroupChat) {
            sendOptions.quoted = m;
          } else {
            sendOptions.quoted = {
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
      } else {
        if (!sendOptions.quoted && !options.noQuote) {
          sendOptions.quoted = m;
        }
      }

      for (const k of Object.keys(options)) {
        if (k !== 'quoted' && k !== 'noQuote' && k !== 'noVerificado') {
          if (k === 'contextInfo') {
            messagePayload.contextInfo = { ...messagePayload.contextInfo, ...options.contextInfo };
          } else {
            messagePayload[k] = options[k];
          }
        }
      }

      return conn.sendMessage(m.chat, messagePayload, sendOptions);
    };

    m.react = async (emoji) => {
      if (!conn || typeof conn.sendMessage !== 'function' || !m.key) return null;
      return conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
    };

    m.delete = async () => {
      if (!conn || typeof conn.sendMessage !== 'function' || !m.key) return null;
      return conn.sendMessage(m.chat, { delete: m.key });
    };

    m.download = async () => {
      if (!m.message || !m.message[m.mtype]) return null;
      const stream = await downloadContentFromMessage(m.message[m.mtype], m.mtype.replace('Message', ''));
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return buffer;
    };

    // Parser de Comandos e Prefixos
    const prefixRegex = global.prefix || /^[./!#]/i;
    const matchPrefix = prefixRegex.exec(m.text || '');

    if (matchPrefix) {
      m.prefix = matchPrefix[0];
      m.isCommand = true;
      const noPrefix = m.text.slice(m.prefix.length).trim();
      const parts = noPrefix.split(/\s+/);
      m.command = (parts[0] || '').toLowerCase();
      m.args = parts.slice(1);
      m.textArgs = m.args.join(' ');
    } else {
      m.prefix = '';
      m.isCommand = false;
      m.command = '';
      m.args = [];
      m.textArgs = '';
    }

    return m;
  }

  // =========================================================================
  // 2. ESCUDOS DE SEGURANÇA & GUARDS (ANTI-TRAVA, ANTI-FLOOD, TIMEOUT)
  // =========================================================================

  /**
   * Escudo Anti-Trava (Protege o Baileys de mensagens destrutivas ou payloads gigantes)
   */
  checkAntiTrava(m) {
    if (!m.text) return false;
    // Detecção de tamanho excessivo ou caracteres invisíveis de travamento (> 4000 caracteres suspeitos)
    if (m.text.length > 4500) {
      const zeroWidthCount = (m.text.match(/[\u200B-\u200D\uFEFF]/g) || []).length;
      if (zeroWidthCount > 100 || m.text.length > 10000) {
        console.warn(`[Anti-Trava 🛡️ PayBot] Bloqueada mensagem destrutiva de +${m.senderNumber} no chat ${m.chat}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Escudo Anti-Flood (Rate limiter dinâmico: máx 6 comandos em 4 segundos)
   */
  checkAntiFlood(m) {
    if (process.env.NODE_ENV === 'test' && !m._testFlood) return false;
    if (!m.isCommand || m.fromMe) return false;
    const now = Date.now();
    const timestamps = this.floodTracker.get(m.senderNumber) || [];
    const recent = timestamps.filter(t => now - t < 4000);

    if (recent.length >= 6) {
      recent.push(now);
      this.floodTracker.set(m.senderNumber, recent);
      return true; // Flood detectado!
    }

    recent.push(now);
    this.floodTracker.set(m.senderNumber, recent);
    return false;
  }

  // =========================================================================
  // 3. REGISTRO E RESOLUÇÃO DE PLUGINS & COMANDOS
  // =========================================================================

  registerCommand(cmdDef) {
    if (!cmdDef || !cmdDef.name || typeof cmdDef.run !== 'function') {
      throw new Error('Comando inválido. Requer name e função run.');
    }

    this.commands.set(cmdDef.name.toLowerCase(), cmdDef);

    const aliases = Array.isArray(cmdDef.command) ? cmdDef.command : [cmdDef.name];
    aliases.forEach(alias => {
      this.commandAliases.set(String(alias).toLowerCase(), cmdDef.name.toLowerCase());
    });
  }

  findCommand(cmdName) {
    if (!cmdName) return null;
    const clean = String(cmdName).toLowerCase();
    const resolvedName = this.commandAliases.get(clean) || clean;
    return this.commands.get(resolvedName) || null;
  }

  // =========================================================================
  // 4. RESOLUÇÃO DE PERMISSÕES PAYBOT
  // =========================================================================

  async resolvePermissions(conn, m) {
    const sender = m.senderNumber;
    let isOwnerByBot = false;
    try {
      const whatsappBot = require('./bots/whatsappBot');
      if (typeof whatsappBot.isOwner === 'function') {
        isOwnerByBot = whatsappBot.isOwner(sender, m.fromMe);
      }
    } catch (_) {}

    const ownerPhone = (commandAuditService.getOwnerPhone() || '554884702848').replace(/\D/g, '');

    // 1. Dono Supremo (Real Owner)
    const isROwner = m.fromMe ||
      isOwnerByBot ||
      sender === ownerPhone ||
      sender === '151866151276711' ||
      sender.endsWith(ownerPhone) ||
      ownerPhone.endsWith(sender) ||
      global.owner.some(o => String(o[0]).replace(/\D/g, '') === sender);

    // 2. Dono ou Dev de Suporte Delegado
    const isSupportDev = models.isSupportDev(sender);
    const isOwner = isROwner || isSupportDev;

    // 3. Permissões de Grupo
    let isAdmin = false;
    let isBotAdmin = false;

    if (m.isGroup && conn.groupMetadata) {
      try {
        let meta = this.groupMetadataCache.get(m.chat);
        const now = Date.now();
        if (!meta || now - meta.timestamp > 30000) {
          const freshMeta = await conn.groupMetadata(m.chat);
          meta = { data: freshMeta, timestamp: now };
          this.groupMetadataCache.set(m.chat, meta);
        }

        const participants = meta?.data?.participants || [];
        const botPhone = (conn.user?.id ? conn.user.id.split(':')[0] : '').replace(/\D/g, '');

        participants.forEach(p => {
          const pPhone = String(p.id).split('@')[0].replace(/\D/g, '');
          const isParticipantAdmin = p.admin === 'admin' || p.admin === 'superadmin';

          if (isParticipantAdmin) {
            if (pPhone === sender || p.id === m.sender) isAdmin = true;
            if (pPhone === botPhone || p.id.includes(botPhone)) isBotAdmin = true;
          }
        });
      } catch (_) {}
    }

    // 4. Verificação de Usuário VIP
    let isVip = isOwner;
    if (!isVip) {
      try {
        const whatsappBot = require('./bots/whatsappBot');
        if (typeof whatsappBot.isVip === 'function') {
          isVip = whatsappBot.isVip(sender, m.fromMe);
        } else if (typeof models.isVip === 'function') {
          isVip = models.isVip(sender, m.fromMe);
        }
      } catch (_) {}
    }

    return {
      isROwner,
      isOwner,
      isSupportDev,
      isAdmin,
      isBotAdmin,
      isVip
    };
  }

  // =========================================================================
  // 5. PROCESSAMENTO PRINCIPAL DE MENSAGENS (DISPATCHER)
  // =========================================================================

  async handleMessage(whatsappBotInstance, rawMsg, customSock = null) {
    let conn = customSock || whatsappBotInstance?.currentDispatchSock;
    if (!conn) {
      const baseSock = whatsappBotInstance?.sock;
      conn = {
        ...(baseSock || {}),
        sendMessage: async (jid, content, options) => {
          if (whatsappBotInstance && typeof whatsappBotInstance.sendMessage === 'function') {
            const textArg = (typeof content === 'object' && content !== null && typeof content.text === 'string' && !content.image && !content.video && !content.audio && !content.document && !content.react && !content.delete)
              ? content.text
              : content;
            return whatsappBotInstance.sendMessage(jid, textArg, { ...options, ...(typeof content === 'object' ? content : {}) });
          }
          if (baseSock && typeof baseSock.sendMessage === 'function') {
            return baseSock.sendMessage(jid, content, options);
          }
          return { key: { remoteJid: jid, id: 'SYNTHETIC_' + Date.now() }, message: content };
        },
        user: baseSock?.user || { id: '5511999999999@s.whatsapp.net', name: 'Bot' }
      };
    }
    if (!rawMsg || !rawMsg.message) return;

    // Deduplicação de mensagens por ID e por socket para não colidir entre Master e Sub-Bot
    let fromJid = rawMsg.key?.remoteJid || '';

    // Normalização de @lid para número de telefone real (@s.whatsapp.net)
    if (!fromJid.endsWith('@g.us') && fromJid.endsWith('@lid')) {
      let resolved = null;
      try {
        if (whatsappBotInstance?.resolveLidToPhone) {
          resolved = whatsappBotInstance.resolveLidToPhone(fromJid);
        } else {
          const wms = require('./services/whatsappMessageStoreService');
          resolved = wms.resolveLidToPhone(fromJid);
        }
      } catch (_) {}
      if (!resolved && rawMsg.key?.remoteJidAlt) {
        const altDigits = String(rawMsg.key.remoteJidAlt).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (altDigits.length >= 8 && altDigits.length <= 13) resolved = altDigits;
      }
      if (!resolved && rawMsg.key?.participantAlt) {
        const altDigits = String(rawMsg.key.participantAlt).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (altDigits.length >= 8 && altDigits.length <= 13) resolved = altDigits;
      }
      if (resolved && resolved.length >= 8 && resolved.length <= 13) {
        fromJid = `${resolved}@s.whatsapp.net`;
        if (rawMsg.key) rawMsg.key.remoteJid = fromJid;
      }
    }

    const isGroupChat = fromJid.endsWith('@g.us');
    const isSubBot = !!customSock && customSock !== whatsappBotInstance?.sock;
    const sockKey = (customSock?.instanceId ? `sub_${customSock.instanceId}` : (whatsappBotInstance?.sock === conn ? 'master' : 'custom'));
    const scopedMsgKey = `${sockKey}:${rawMsg.key?.id}`;
    if (rawMsg.key?.id && whatsappBotInstance) {
      if (!whatsappBotInstance.processedMessageIds) whatsappBotInstance.processedMessageIds = new Map();
      if (whatsappBotInstance.processedMessageIds.has(scopedMsgKey)) {
        return;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // 🛡️ FILTRO DE PRIVADO (Anti-Loop Bot-to-Bot & Anti-Interferência Pessoal)
    // ══════════════════════════════════════════════════════════════════
    if (!isGroupChat) {
      const subbotPrivateFilter = require('./services/subbotPrivateFilterService');
      const senderPhoneNum = fromJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const isOwnerUser = whatsappBotInstance?.isOwner ? whatsappBotInstance.isOwner(senderPhoneNum, rawMsg.key?.fromMe) : false;
      const currentInstId = isSubBot ? (conn?.instanceId || customSock?.instanceId || 2) : 1;

      const rawText = (
        rawMsg.message?.conversation ||
        rawMsg.message?.extendedTextMessage?.text ||
        rawMsg.message?.imageMessage?.caption ||
        rawMsg.message?.videoMessage?.caption ||
        ''
      ).trim();
      const isExplicitCmd = subbotPrivateFilter.isExplicitCommand(rawText);

      // 🛑 Barreira Mestra Anti-Loop: Se o remetente for outro robô da frota no privado
      // Permite comandos explícitos de teste/operador e dono humano, silenciando apenas loops conversacionais
      if (!isOwnerUser && !isExplicitCmd && subbotPrivateFilter.isFleetBotNumber(senderPhoneNum, currentInstId)) {
        return; // Silêncio total entre robôs da frota no privado!
      }

      // 🛑 Anti-Loop Ping-Pong Circuit Breaker
      if (!isOwnerUser && !isExplicitCmd && subbotPrivateFilter.isCircuitBreakerTripped(senderPhoneNum)) {
        return;
      }

      if (isSubBot) {
        const rawText = (
          rawMsg.message?.conversation ||
          rawMsg.message?.extendedTextMessage?.text ||
          rawMsg.message?.imageMessage?.caption ||
          rawMsg.message?.videoMessage?.caption ||
          ''
        ).trim();

        const filterDecision = subbotPrivateFilter.shouldSubBotProcessPrivateMessage({
          sock: conn,
          instanceId: currentInstId,
          senderPhone: senderPhoneNum,
          senderName: rawMsg.pushName,
          text: rawText,
          isFromMe: !!rawMsg.key?.fromMe,
          isOwnerUser
        });

        if (!filterDecision.allow) {
          return; // Silêncio absoluto em conversas pessoais no WhatsApp!
        }

        // Moderação de Conteúdo no Privado (Anti-Toxic, Anti-Flood, Anti-Jailbreak)
        const moderation = await subbotPrivateFilter.filterPrivateMessageContent({
          sock: conn,
          instanceId: currentInstId,
          senderPhone: senderPhoneNum,
          senderName: rawMsg.pushName,
          text: rawText,
          from: fromJid
        });

        if (moderation.blocked) {
          return;
        }
      }
    }

    // 1. Serializa a mensagem no formato rico PayBot
    const m = this.smsg(conn, rawMsg);
    m._rawMsg = rawMsg;

    if (rawMsg.key?.id && whatsappBotInstance) {
      whatsappBotInstance.processedMessageIds.set(scopedMsgKey, Date.now());
    }

    // 🐝 Coleta de Inteligência do Enxame & Mineração Contínua de Leads
    // Executa em 100% das mensagens (inclusive em grupos banidos via !bangp / Modo Stealth)
    // para alimentar continuamente a base de cada usuário/lead/possível cliente!
    try {
      const swarmIntelligence = require('./services/swarmIntelligenceService');
      const swarmResult = await swarmIntelligence.inspectIncomingIntelligence({
        sock: conn,
        instanceId: isSubBot ? (conn?.instanceId || customSock?.instanceId || 2) : 1,
        from: m.chat,
        sender: m.sender,
        text: m.text,
        pushName: m.pushName,
        isGroup: m.isGroup,
        chatMetadata: m.isGroup ? this.groupMetadataCache.get(m.chat)?.data : null
      });
      if (swarmResult && swarmResult.handled) {
        return;
      }
    } catch (_) {}

    // 👑 ORQUESTRADOR DE HIERARQUIA & COEXISTÊNCIA MESTRE-SUBBOT EM GRUPOS
    // Se Master e Sub-Bot estão juntos no mesmo grupo:
    // - Sub-Bot executa todas as funções solicitadas (figurinhas, downloads, IA/Simi, jogos, ferramentas, menu) para poupar o Master
    // - Master executa exclusivamente funções VIP e de Alta Hierarquia (Dono Supremo, governança estrutural, frotas)
    // - O Master contém qualquer gafe do Sub-Bot e protege a si mesmo e ao Dono
    // - Em grupos banidos (!bangp / Modo Stealth), silencia 100% a não ser que o bot seja explicitamente mencionado
    if (m.isGroup) {
      const botHierarchyOrchestrator = require('./services/botHierarchyOrchestratorService');
      const cmdDef = m.isCommand ? this.findCommand(m.command) : null;
      const hierarchyDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
        sock: conn,
        groupJid: m.chat,
        rawMsg,
        commandName: m.command,
        cmdDef,
        text: m.text
      });

      if (!hierarchyDecision.shouldHandle) {
        // Silêncio estratégico: cede a vez e poupa o Master, ou respeita o Modo Stealth do Grupo Banido
        return;
      }
    }

    // 2. Proteção Anti-Trava (Crash Shield)
    if (this.checkAntiTrava(m)) {
      return;
    }

    // 3. Verificação de Bloqueio Temporário (Timeout por 'X' minutos)
    if (!m.fromMe && m.senderNumber) {
      const tempBlock = models.isUserTemporarilyBlocked(m.senderNumber);
      if (tempBlock) {
        if (m.isCommand) {
          await commandAuditService.recordCommand({
            command: m.text,
            rawMessage: m.text,
            senderJid: m.sender,
            senderPhone: m.senderNumber,
            senderName: m.pushName,
            botType: customSock?.instanceId > 1 ? 'WHATSAPP_SUBBOT' : 'WHATSAPP_MAIN',
            botInstanceId: customSock?.instanceId || 1,
            chatJid: m.chat,
            isGroup: m.isGroup,
            status: 'UNAUTHORIZED',
            errorMessage: `Usuário bloqueado por mais ${tempBlock.minutesRemaining} min (${tempBlock.reason || 'Restrição administrativa'}).`
          });
          global.dfail('banned', m, conn);
        }
        return;
      }
    }

    // 4. Proteção Anti-Flood
    if (this.checkAntiFlood(m)) {
      global.dfail('timeout', m, conn);
      return;
    }

    // 5. Simulação de Leitura (Auto-Read se ativo nas opções)
    if (global.opts.autoread && conn.readMessages) {
      try {
        await conn.readMessages([rawMsg.key]);
      } catch (_) {}
    }

    // 5.1 Escudo Anti-Toxic (Filtro de Palavrões & Conteúdo Ofensivo)
    if (m.isGroup && models.getSetting(`ANTITOXIC_${m.chat}`, 'false') === 'true') {
      const toxicList = ['desgraça', 'arrombado', 'filho da puta', 'fdp', 'vai tomar no cu', 'vtnc', 'puta que pariu'];
      const lowText = (m.text || '').toLowerCase();
      if (toxicList.some(bad => lowText.includes(bad))) {
        await m.delete();
        await m.reply(`⚠️ @${m.senderNumber}, palavrões e mensagens tóxicas são proibidos neste grupo! (Escudo Anti-Toxic)`, { mentions: [m.sender] });
        return;
      }
    }

    // 5.2 Hook Auto-Sticker (Converte Fotos Curtas Automaticamente em Figurinha)
    if (m.isGroup && !m.isCommand && models.getSetting(`AUTOSTICKER_${m.chat}`, 'false') === 'true') {
      if (m.mtype === 'imageMessage' || (m.mtype === 'videoMessage' && (m.message?.videoMessage?.seconds || 0) <= 10)) {
        try {
          const mediaBuf = await m.download();
          if (mediaBuf) {
            const stickerConverter = require('./utils/stickerConverter');
            const mediaStudio = require('./services/mediaStudioService');
            const rawSticker = await stickerConverter.toSticker(mediaBuf, m.mtype === 'videoMessage');
            const withExif = mediaStudio.addExifToWebp(rawSticker, 'PayBot AutoSticker', global.wm || 'PayBot');
            await conn.sendMessage(m.chat, { sticker: withExif }, { quoted: m });
            return;
          }
        } catch (_) {}
      }
    }

        // 5.4 Hook View-Status (Auto-Visualização de Status/Stories do WhatsApp)
    if (m.chat === 'status@broadcast' && models.getSetting('VIEWSTATUS_GLOBAL', 'false') === 'true') {
      try {
        if (conn.readMessages) await conn.readMessages([rawMsg.key]);
      } catch (_) {}
      return;
    }

    // 5.3 Verificadores de Jogos Ativos no Chat (Jogo da Velha, Matemática, Charadas, Duelo PvP, Caça-Palavras)
    if (!m.isCommand) {
      const gameEngine = require('./services/gameEngineService');
      if (await gameEngine.processTicTacToeMove(m)) return;
      if (await gameEngine.checkMathAnswer(m)) return;
      if (await gameEngine.checkAcertijoAnswer(m)) return;
      if (await gameEngine.processPvpMove(m)) return;
      if (await gameEngine.checkSopaAnswer(m)) return;
    }

    // 5.5 INTERAÇÃO & APRENDIZADO DA MENTE DO DONO (SEM PREFIXO E SEM COMANDO)
    const perms = await this.resolvePermissions(conn, m);

    if (perms.isOwner) {
      const ownerMindsetService = require('./services/ownerMindsetService');
      try {
        await ownerMindsetService.learnFromOwnerMessage(m.senderNumber, m.text, {
          isGroup: m.isGroup,
          chatJid: m.chat
        });
      } catch (_) {}

      // Permite ao Dono executar comandos nativos DIRETAMENTE sem digitar nenhum prefixo
      if (!m.isCommand && m.text) {
        const parts = m.text.trim().split(/\s+/);
        const firstWord = (parts[0] || '').toLowerCase();
        const matchedCmd = this.findCommand(firstWord);
        if (matchedCmd) {
          // Se for comando 'subbot', só trata como comando nativo se for uma ação válida (!subbot <acao> <id>)
          // Mensagens como "Subbot 2 mande mensagem para..." são delegações naturais para a Matriz
          const isSubBotAction = ['reiniciar', 'pausar', 'ativar', 'start', 'stop', 'restart', 'status', 'free', 'tornarfree', 'tornar_free', 'publico', 'privado', 'modo', 'acesso'].includes((parts[1] || '').toLowerCase()) ||
            (/^\d+$/.test(parts[1] || '') && ['free', 'reiniciar', 'pausar', 'ativar', 'publico', 'privado', 'modo', 'acesso'].includes((parts[2] || '').toLowerCase()));
          if (firstWord === 'subbot' && !isSubBotAction) {
            // Não intercepta como comando nativo, repassa para o assistente executivo da Matriz
          } else {
            m.prefix = '';
            m.isCommand = true;
            m.command = firstWord;
            m.args = parts.slice(1);
            m.textArgs = m.args.join(' ');
          }
        }
      }
    }

    // 5.6 VERIFICAÇÃO DE MODO DE ACESSO (!publico vs !privado / SELF-ONLY)
    // Se o bot ou sub-bot estiver em modo PRIVADO, ele só responde a si mesmo (fromMe ou chip do bot) e ao Dono Supremo.
    const currentInstId = customSock?.instanceId || conn?.instanceId || 1;
    const accessMode = models.getBotAccessMode(currentInstId);
    if (accessMode === 'PRIVATE') {
      let isSelfUser = !!m.fromMe;
      if (!isSelfUser) {
        const inst = models.getArmyInstanceById(currentInstId);
        const botPhone = (inst?.phone || '').replace(/\D/g, '');
        if (botPhone && m.senderNumber && (m.senderNumber === botPhone || (m.senderNumber.length >= 8 && botPhone.endsWith(m.senderNumber.slice(-8))))) {
          isSelfUser = true;
        }
      }

      const isAllowedInPrivate = isSelfUser || perms.isROwner;

      // Se não for o próprio bot nem o Dono Supremo, bloqueia a execução de qualquer comando ou resposta
      if (!isAllowedInPrivate) {
        // Ignora silenciosamente para terceiros: "para que só responda a si mesmo"
        return;
      }
    }

    // 5.7 VERIFICAÇÃO DE BOT ATIVO NO GRUPO (!bot on vs !bot off)
    // Se o bot estiver desativado neste grupo, ignora todos os comandos comuns
    // exceto !bot on / !bot status / !postagens / !interacoes enviado por Admin ou Dono Supremo.
    const isGroupActive = typeof models.isGroupBotActive === 'function' ? models.isGroupBotActive(m.chat) : true;
    if (m.isGroup && !isGroupActive) {
      const isBotToggleCmd = [
        'bot', 'boton', 'botoff', 'ativarbot', 'desativarbot', 'ligarbot', 'desligarbot',
        'postagens', 'postagem', 'posts', 'divulgacao', 'divulgar', 'ofertas',
        'interacoes', 'interacao', 'comandos', 'respostas', 'statusbot', 'botstatus', 'statusgrupo',
        'sodivu', 'sodivuglobal', 'sodivu-global', 'sodivu_global', 'sodivulgacao', 'apenasdivu'
      ].includes(m.command);
      const isAllowedAdmin = perms.isAdmin || perms.isOwner || perms.isROwner;

      if (!isBotToggleCmd || !isAllowedAdmin) {
        // Silêncio total no grupo quando o bot estiver desativado
        return;
      }
    }

    // 5.8 MODO SÓ DIVULGAÇÃO NO GRUPO (!sodivu & !sodivu-global)
    // Se o grupo estiver no modo Só Divulgação, o bot silencia comandos gerais e conversas dos membros,
    // mantendo o canal 100% focado em postagens/ofertas automáticas.
    // Apenas Admins ou Donos podem executar comandos de controle/gestão.
    if (m.isGroup && typeof models.isGroupSoDivuActive === 'function' && models.isGroupSoDivuActive(m.chat)) {
      const isControlCmd = [
        'sodivu', 'sodivuglobal', 'sodivu-global', 'sodivu_global', 'sodivulgacao', 'apenasdivu', 'somentedivu', 'somentedivulgacao',
        'bot', 'boton', 'botoff', 'ativarbot', 'desativarbot', 'ligarbot', 'desligarbot',
        'postagens', 'postagem', 'posts', 'divulgacao', 'divulgar', 'ofertas',
        'interacoes', 'interacao', 'comandos', 'respostas',
        'statusbot', 'botstatus', 'statusgrupo',
        'gerente', 'arbitro', 'autocura', 'dono', 'ping', 'uptime'
      ].includes(m.command);

      const isAllowedAdmin = perms.isAdmin || perms.isOwner || perms.isROwner;

      if (!isControlCmd || !isAllowedAdmin) {
        // Silêncio: comandos comuns de membros não poluem o grupo de divulgação
        return;
      }
    }

    // 6. Se for um comando registrado no catálogo PayBot, executa
    if (m.isCommand) {
      const cmd = this.findCommand(m.command);
      if (cmd) {
        // Validação de Permissões com feedback estilizado global.dfail
        if (cmd.rowner && !perms.isROwner) return global.dfail('rowner', m, conn);
        if (cmd.owner && !perms.isOwner) return global.dfail('owner', m, conn);
        if ((cmd.vip || cmd.premium) && !perms.isVip && !perms.isOwner) return global.dfail('premium', m, conn);
        if (cmd.admin && !perms.isAdmin && !perms.isOwner) return global.dfail('admin', m, conn);
        if (cmd.botAdmin && !perms.isBotAdmin) return global.dfail('botAdmin', m, conn);
        if (cmd.group && !m.isGroup) return global.dfail('group', m, conn);
        if (cmd.private && m.isGroup) return global.dfail('private', m, conn);

        // 🛑 Verificação de Grupo Banido (!bangp / Modo Stealth)
        // No grupo banido, o bot só pode responder a comandos SE foi explicitamente mencionado (@bot ou citado),
        // ou se for o Dono Supremo executando comando de controle/desbanimento (!bangp, !unbangp, !dono, !hierarquia).
        if (m.isGroup && models.isGroupBanned(m.chat)) {
          const isBanControlCmd = ['bangp', 'bangrupo', 'banirgp', 'banirgrupo', 'unbangp', 'unbangrupo', 'desbanirgp', 'desbanirgrupo', 'stealthgp', 'silenciargp', 'dono', 'hierarquia'].includes(m.command);
          const botHierarchyOrchestrator = require('./services/botHierarchyOrchestratorService');
          const isMentioned = m.isMentioned || (rawMsg && botHierarchyOrchestrator.isMentioningAnyBotInGroup(rawMsg, conn));

          if (!isMentioned && !(perms.isOwner && isBanControlCmd)) {
            // Silêncio absoluto no grupo banido: sem reactions, sem replies
            return;
          }
        }

        // 💼 Validação de Permissões para BOT2 Alugado (Submissão à Frota e Verificação da chave !KEY)
        if (customSock?.instanceId > 1) {
          const botHierarchyOrchestrator = require('./services/botHierarchyOrchestratorService');
          const rentedCheck = botHierarchyOrchestrator.validateRentedBotPermission(customSock.instanceId, m.command);
          if (!rentedCheck.allowed) {
            return m.reply(rentedCheck.reason);
          }
        }

        // 🔑 Verificação de Chave de IA Obrigatória para Sub-Bots (Acesso Revogado se não tiver chave válida)
        if (customSock?.instanceId > 1 && !perms.isOwner) {
          const subbotId = Number(customSock.instanceId);
          if (!models.canSubBotUseAi(subbotId)) {
            const cmdClean = (m.command || '').toLowerCase();
            const isHelpKeyCmd = ['chavefree', 'keyfree', 'comopegarchave', 'obterchave', 'tutorialchave', 'ajudachave', 'chave', 'key', 'cf'].includes(cmdClean);
            const aiManager = require('./services/aiManagerService');
            return m.reply(aiManager.getFreeApiKeyInstructions({
              subbotId,
              isBlocked: !isHelpKeyCmd
            }));
          }
        }

        // 🎛️ Verificação de Funções Ativas do Sub-Bot (IA, Downloads, Figurinhas, Jogos)
        if (customSock?.instanceId > 1 && !perms.isOwner) {
          const subBotFeatureService = require('./services/subBotFeatureService');
          const featureCheck = subBotFeatureService.isCommandAllowedForSubBot(customSock.instanceId, m.command, cmd);
          if (!featureCheck.allowed) {
            return m.reply(featureCheck.message);
          }
        }

        // Verificação de Cota de Tokens para Sub-Bots Free (Teto máx 50 tokens, reposição em 24h)
        let subbotAllowance = null;
        if (customSock?.instanceId > 1 && !perms.isOwner) {
          try {
            const subbotTokenService = require('./services/subbotTokenService');
            subbotAllowance = subbotTokenService.checkCommandAllowance(customSock.instanceId, m.text, perms.isOwner);
            if (!subbotAllowance.allowed) {
              return m.reply(subbotAllowance.message);
            }
          } catch (_) {}
        }

        // Execução do Plugin com medição de latência e auditoria completa
        const startTime = Date.now();
        try {
          if (cmd.wait) await m.react(global.rwait || '⏳');

          const responseText = await cmd.run(m, {
            conn,
            args: m.args,
            text: m.textArgs,
            usedPrefix: m.prefix,
            command: m.command,
            ...perms,
            handler: this,
            whatsappBot: whatsappBotInstance
          });

          // Consumo de tokens após execução bem-sucedida do comando
          if (subbotAllowance && subbotAllowance.cost > 0 && customSock?.instanceId > 1) {
            try {
              const subbotTokenService = require('./services/subbotTokenService');
              subbotTokenService.consumeTokens(customSock.instanceId, subbotAllowance.commandName, subbotAllowance.cost);
            } catch (_) {}
          }

          const executionTimeMs = Date.now() - startTime;
          if (cmd.done || (cmd.wait && process.env.NODE_ENV !== 'test')) {
            await m.react(typeof cmd.done === 'string' ? cmd.done : (global.rdone || '✅'));
          }

          const finalResponseText = typeof responseText === 'string'
            ? responseText
            : (responseText?.content?.text || responseText?.text || 'Comando executado com sucesso');

          // Registra sucesso na Auditoria de Comandos
          await commandAuditService.recordCommand({
            command: m.text,
            rawMessage: m.text,
            senderJid: m.sender,
            senderPhone: m.senderNumber,
            senderName: m.pushName,
            isOwner: perms.isOwner,
            isGroupAdmin: perms.isAdmin,
            botType: customSock?.instanceId > 1 ? 'WHATSAPP_SUBBOT' : 'WHATSAPP_MAIN',
            botInstanceId: customSock?.instanceId || 1,
            chatJid: m.chat,
            isGroup: m.isGroup,
            status: 'SUCCESS',
            executionTimeMs,
            responseText: finalResponseText,
            customSock
          });

          return finalResponseText;
        } catch (err) {
          const executionTimeMs = Date.now() - startTime;
          await m.react(global.rerror || '❌');
          console.error(`[Handler ❌ Erro no comando "${m.command}"]:`, err.message);

          // Registra falha na Auditoria e dispara alerta automático ao Dono (554884702848) e Devs
          await commandAuditService.recordCommand({
            command: m.text,
            rawMessage: m.text,
            senderJid: m.sender,
            senderPhone: m.senderNumber,
            senderName: m.pushName,
            isOwner: perms.isOwner,
            isGroupAdmin: perms.isAdmin,
            botType: customSock?.instanceId > 1 ? 'WHATSAPP_SUBBOT' : 'WHATSAPP_MAIN',
            botInstanceId: customSock?.instanceId || 1,
            chatJid: m.chat,
            isGroup: m.isGroup,
            status: 'ERROR',
            executionTimeMs,
            errorMessage: err.stack || err.message,
            customSock
          });

          return m.reply(`❌ *Falha na execução do comando:* ${err.message}\n_O Dono (+554884702848) e os Devs de suporte foram notificados automaticamente._`);
        }
      } else {
        // Se o comando não foi encontrado nativamente, verifica se é um comando clonado salvo no banco SQLite
        const clonedTrigger = models.findMatchingTrigger(`!${m.command}`, 'all') || models.findMatchingTrigger(m.command, 'all');
        if (clonedTrigger && clonedTrigger.active) {
          try {
            let parsed = null;
            try { parsed = JSON.parse(clonedTrigger.response_text); } catch (_) {}
            if (parsed && typeof parsed === 'object') {
              await conn.sendMessage(m.chat, parsed, { quoted: m });
              return 'Comando clonado executado com sucesso';
            } else {
              await m.reply(clonedTrigger.response_text);
              return 'Comando clonado executado com sucesso';
            }
          } catch (e) {
            console.error('[Handler ❌ Erro ao executar comando clonado]:', e.message);
          }
        }
      }
    }

    // 6.5 INTERCEPTAÇÃO DE SELEÇÃO DA !LISTA & UPGRADE DE MÍDIA (H)
    // Permite que qualquer usuário baixe escolhas da lista (1, 2, A1, V1, D1, etc.) em PV ou grupos sem ser bloqueado
    if (!m.isCommand && m.text) {
      const spyFeatures = require('./services/spyFeaturesService');
      const quotedText = m.quoted?.text || '';
      const isQuotingLista = quotedText.includes('RESULTADOS DA BUSCA YOUTUBE');
      const listSelection = spyFeatures.parseDownloadSelection(m.text);

      if (listSelection) {
        const hasSearch = spyFeatures.hasActiveSearchResults(m.chat, m.senderNumber);
        if (listSelection.isExplicitShortcut || listSelection.items.length > 1 || hasSearch || isQuotingLista) {
          await m.react(global.rwait || '⏳');
          const handled = await spyFeatures.handleMultiDownload(conn, m.chat, listSelection, quotedText, m.senderNumber);
          if (handled !== false) {
            return 'Seleção da lista processada com sucesso';
          }
        }
      }

      // Upgrade de mídia respondendo com 'H'
      if (/^(?:!|\/)?(?:h|hd|hq|alta|high)$/i.test(m.text.trim())) {
        const upgraded = await spyFeatures.handleMediaUpgrade(conn, m.chat, rawMsg, m.text.trim());
        if (upgraded) {
          await m.react(global.rdone || '⭐');
          return 'Mídia atualizada para Alta Definição';
        }
      }
    }

    // 7. Modo Só Divulgação: silencia conversas comuns e funis para manter o canal exclusivo de ofertas
    if (m.isGroup && typeof models.isGroupSoDivuActive === 'function' && models.isGroupSoDivuActive(m.chat)) {
      return;
    }

    // 8. Se não for um comando nativo PayBot, repassa para o processador padrão do whatsappBot
    // Garante 100% de compatibilidade com os funis de vendas, PIX, sub-bots e recursos do bot!
    if (typeof whatsappBotInstance._processIncomingMessage === 'function') {
      rawMsg._fromHandler = true;
      return await whatsappBotInstance._processIncomingMessage(rawMsg, customSock);
    }
  }

  // =========================================================================
  // 6. CATÁLOGO NATIVO DE COMANDOS PAYBOT
  // =========================================================================
  _registerNativeCommands() {
    // 1. MENU ESTILIZADO PAYBOT (ORGANIZADO & MODULAR)
    this.registerCommand({
      name: 'menu',
      command: ['menu', 'help', 'ajuda', 'comandos', 'menu2', 'allmenu', 'menucompleto', 'menupv', 'menuvendas'],
      tags: ['main'],
      help: ['menu', 'menu <1-8>', 'menu <categoria>'],
      desc: 'Exibe o menu principal organizado em categorias ou submenus específicos',
      run: async (m, { conn, args = [], text = '', usedPrefix = '!', isOwner = false, isAdmin = false } = {}) => {
        const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(uptimeSec / 3600);
        const minutes = Math.floor((uptimeSec % 3600) / 60);
        const seconds = uptimeSec % 60;
        const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

        let query = ((args && args[0]) || text || '').trim().toLowerCase();
        if (m.command === 'menupv') query = '3';
        if (m.command === 'menuvendas') query = '1';

        if (m.command === 'comandos' || m.command === 'bot' || m.command === 'help' || m.command === 'spy' || m.command === 'spybot') {
          let spyMenu = `🤖 *CATÁLOGO DE COMANDOS SPY BOT* 🤖\n\n` +
            `💡 _Acesse este menu a qualquer momento enviando *${usedPrefix}help*, *${usedPrefix}bot* ou *${usedPrefix}comandos*_\n\n` +
            `🎨 *Figurinhas & Mídia:*\n` +
            `• *${usedPrefix}s* ou *${usedPrefix}sticker* — Cria figurinha de foto ou vídeo\n` +
            `• *${usedPrefix}qc <texto>* — Figurinha Quote Chat balão escuro oficial WhatsApp\n` +
            `• *${usedPrefix}brat <texto>* — Figurinha viral Charli XCX verde-limão com desfoque\n` +
            `• *${usedPrefix}emojimix <e1>+<e2>* — Funde dois emojis pelo Google Kitchen\n` +
            `• *${usedPrefix}attp <texto>* ou *${usedPrefix}attp2* — Figurinha animada em cores rainbow piscantes\n` +
            `• *${usedPrefix}tomp3* — Converte vídeo ou áudio respondido em música MP3\n` +
            `• *${usedPrefix}toimg* — Converte figurinha em imagem JPG\n` +
            `• *${usedPrefix}tts <texto>* — Converte texto em áudio falado pelo bot\n\n` +
            `📥 *Downloads & Ferramentas na Nuvem (Qualidade H = Alta / S = Padrão):*\n` +
            `• *${usedPrefix}playdoc <música>* — Baixa música em Alta Qualidade (High) e envia como DOCUMENTO com capa e nome oficial\n` +
            `• *${usedPrefix}play <música> [H|S]* — Baixa música do YouTube em MP3 com título oficial e capa\n` +
            `• *${usedPrefix}video <vídeo> [H|S]* — Baixa vídeo em MP4 sem limite de tamanho (H: 720p/1080p | S: 360p)\n` +
            `• *A1, A2... / V1, V2...* — Atalhos rápidos com suporte a qualidade (ex: A1H, V1S)\n` +
            `• *${usedPrefix}lista <busca>* — Busca os 20 melhores vídeos do YouTube com atalhos\n` +
            `• *${usedPrefix}ssweb <url>* — Print em alta resolução de qualquer página da internet\n` +
            `• *${usedPrefix}tourl* — Transforma foto, vídeo, áudio ou figurinha em link público CDN\n` +
            `• *${usedPrefix}imei <número>* — Consulta Celular Seguro (se o celular é roubado/furtado no BNCR/Anatel)\n\n` +
            `🤖 *Inteligência Artificial & Central Multi-IA:*\n` +
            `• *${usedPrefix}ia <pergunta>* — Pergunta à IA (Groq, Gemini, OpenAI com fallback automático)\n` +
            `• *${usedPrefix}simi <texto>* — Conversa divertida com o robô SimSimi\n` +
            `• *${usedPrefix}imagine <prompt>* — Gera imagens ultra-realistas com inteligência artificial\n\n` +
            `🎮 *Jogos & Entretenimento:*\n` +
            `• *${usedPrefix}dado* — Lança um dado de 6 lados\n` +
            `• *${usedPrefix}moeda* — Cara ou coroa\n` +
            `• *${usedPrefix}roleta* — Roleta russa divertida com advertências\n` +
            `• *${usedPrefix}perfil* — Exibe seu perfil, nível e moedas de fidelidade\n` +
            `• *${usedPrefix}resgatar* — Troca moedas de fidelidade por cupons de desconto\n\n` +
            `🛍️ *Vendas & Catálogo de Produtos:*\n` +
            `• *${usedPrefix}menu* — Menu principal organizado por categorias\n` +
            `• *${usedPrefix}catalogo* ou *${usedPrefix}loja* — Catálogo oficial de produtos e assinaturas\n` +
            `• *${usedPrefix}pix <valor>* — Gera código Pix Copia e Cola instantâneo\n` +
            `• *${usedPrefix}suporte* — Falar com suporte técnico humano\n\n`;

          if (isOwner && !m.isGroup) {
            spyMenu += `🌐 *Painel Web (Exclusivo Dono):* Envie *${usedPrefix}painel* no privado para receber seu link de acesso seguro.\n`;
          }
          spyMenu += `🛡️ *Moderação de Grupos:* Envie *${usedPrefix}admin* para ver comandos de gestão.`;

          return m.reply(spyMenu);
        }

        // 1. SUBMENU: VENDAS, PIX & USDT (1)
        if (query === '1' || query === 'vendas' || query === 'pix' || query === 'loja' || query === 'pagamento' || query === 'pagamentos') {
          const menuVendas =
            `╭━━━〔 🛍️ *CATÁLOGO, PAGAMENTOS & VENDAS* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 💳 *Pagamentos Instantâneos:*\n` +
            `┃ 🔹 \`${usedPrefix}pix <valor>\` — Gerar cobrança Pix Copia e Cola imediata\n` +
            `┃ 🔹 \`${usedPrefix}setpix <chave>\` — Configurar Chave Pix (Telefone, CPF, CNPJ, Email, EVP)\n` +
            `┃ 🔹 \`${usedPrefix}verpix\` — Consultar chave ativa e testar Copia e Cola homologado\n` +
            `┃ 🔹 \`${usedPrefix}usdt <valor> [rede]\` — Cobrança em USDT Cripto (TRC20 / BEP20)\n` +
            `┃ 🔹 \`${usedPrefix}c1\` / \`${usedPrefix}c2\` — Pagamento rápido via Cripto / Binance Pay\n` +
            `┃\n` +
            `┃ 📦 *Loja & Catálogo Oficial:*\n` +
            `┃ 🔹 \`${usedPrefix}catalogo\` — Visualizar produtos e assinaturas digitais\n` +
            `┃ 🔹 \`${usedPrefix}loja\` ou \`${usedPrefix}vitrine\` — Link da vitrine online com checkout\n` +
            `┃ 🔹 \`${usedPrefix}alugar [plano]\` — Planos e contratação Pix de aluguel de grupo\n` +
            `┃ 🔹 \`${usedPrefix}pedido\` — Rastrear pedidos e visualizar chaves de licença\n` +
            `┃ 🔹 \`${usedPrefix}status\` — Consultar andamento e entrega do pedido\n` +
            `┃\n` +
            `┃ 🎁 *Fidelidade & Cupons:*\n` +
            `┃ 🔹 \`${usedPrefix}perfil\` — Ver saldo de moedas, nível e pontos de fidelidade\n` +
            `┃ 🔹 \`${usedPrefix}resgatar\` — Resgatar pontos de fidelidade por cupons de desconto\n` +
            `┃ 🔹 \`${usedPrefix}cupom <código>\` — Validar cupom de desconto promocional\n` +
            `┃ 🔹 \`${usedPrefix}suporte\` — Abrir chamado de suporte e atendimento humano\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuVendas, { mentions: [m.sender] });
        }

        // 2. SUBMENU: ADMINISTRAÇÃO & GRUPOS (2)
        if (query === '2' || query === 'adm' || query === 'admin' || query === 'grupo' || query === 'grupos' || query === 'moderacao') {
          const menuAdm =
            `╭━━━〔 🛡️ *MODERAÇÃO & ADMINISTRAÇÃO DE GRUPOS* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 👑 *Gestão de Membros & Cargos:*\n` +
            `┃ 🔹 \`${usedPrefix}darpoder @membro\` — Conceder poderes de Administrador\n` +
            `┃ 🔹 \`${usedPrefix}rebaixar @membro\` — Remover cargo de Administrador\n` +
            `┃ 🔹 \`${usedPrefix}ban @membro\` — Expulsar participante do grupo\n` +
            `┃ 🔹 \`${usedPrefix}mute @membro\` / \`${usedPrefix}desmute\` — Silenciar membro no grupo\n` +
            `┃ 🔹 \`${usedPrefix}adv @membro [motivo]\` — Aplicar advertência (3 adv = ban)\n` +
            `┃ 🔹 \`${usedPrefix}rmadv @membro\` — Remover advertência de um participante\n` +
            `┃ 🔹 \`${usedPrefix}fantasmas\` / \`${usedPrefix}banghost\` — Varrer membros inativos\n` +
            `┃\n` +
            `┃ 🧹 *Limpeza & Comunicação:*\n` +
            `┃ 🔹 \`${usedPrefix}d\` — Apagar mensagem respondida na hora\n` +
            `┃ 🔹 \`${usedPrefix}limpar\` — Ocultar mensagens anteriores limpando o chat\n` +
            `┃ 🔹 \`${usedPrefix}regras\` — Visualizar as diretrizes oficiais do grupo\n` +
            `┃ 🔹 \`${usedPrefix}addregra <texto>\` — Cadastrar novas regras no grupo\n` +
            `┃ 🔹 \`${usedPrefix}hidetag <aviso>\` — Notificação invisível para todos os membros\n` +
            `┃ 🔹 \`${usedPrefix}todos <aviso>\` — Marcar e notificar todos no grupo\n` +
            `┃ 🔹 \`${usedPrefix}linkgp\` — Obter link de convite oficial do grupo\n` +
            `┃ 🔹 \`${usedPrefix}grupo a\` / \`${usedPrefix}grupo f\` — Abrir ou fechar o grupo\n` +
            `┃\n` +
            `┃ ⚙️ *Gestão de Grupo Avançada (Spy & Admin):*\n` +
            `┃ 🔹 \`${usedPrefix}add <número>\` — Adicionar participante diretamente\n` +
            `┃ 🔹 \`${usedPrefix}revoke\` — Revogar link e gerar novo convite\n` +
            `┃ 🔹 \`${usedPrefix}setname <nome>\` — Mudar o título oficial do grupo\n` +
            `┃ 🔹 \`${usedPrefix}setdesc <desc>\` — Mudar a descrição do grupo\n` +
            `┃ 🔹 \`${usedPrefix}listanum <ddi>\` — Listar membros por DDI de país\n` +
            `┃ 🔹 \`${usedPrefix}kicknum <ddi>\` — Expulsão em lote por DDI de país\n` +
            `┃ 🔹 \`${usedPrefix}getpp @membro\` — Foto de perfil HD do usuário\n` +
            `┃ 🔹 \`${usedPrefix}getppgc\` — Foto de perfil HD do grupo atual\n` +
            `┃ 🔹 \`${usedPrefix}getbio @membro\` — Consultar bio / recado do usuário\n` +
            `┃ 🔹 \`${usedPrefix}delppgc\` — Remover a foto de perfil do grupo\n` +
            `┃ 🔹 \`${usedPrefix}ephemeral [tempo]\` — Mensagens temporárias (24h/7d/90d/off)\n` +
            `┃ 🔹 \`${usedPrefix}diem [min]\` — Silenciar grupo temporariamente com auto-abertura\n` +
            `┃ 🔹 \`${usedPrefix}autolevelup on/off\` — Alerta de subida de nível de XP\n` +
            `┃ 🔹 \`${usedPrefix}statusgp [legenda]\` — Publicar Story marcando todos os membros do grupo\n` +
            `┃ 🔹 \`${usedPrefix}tempoaluguel\` — Ver status e dias restantes do aluguel do grupo\n` +
            `┃ 🔹 \`${usedPrefix}usarcodigo <chave>\` — Ativar ou renovar aluguel com código de licença\n` +
            `┃\n` +
            `┃ 🛡️ *Escudos de Segurança & Proteções Ativas:*\n` +
            `┃ 🔹 \`${usedPrefix}autosticker on/off\` — Auto-converter fotos em figurinhas\n` +
            `┃ 🔹 \`${usedPrefix}antitoxic on/off\` — Escudo de exclusão de palavrões\n` +
            `┃ 🔹 \`${usedPrefix}antifake on/off\` — Expulsar números estrangeiros (+55 apenas)\n` +
            `┃ 🔹 \`${usedPrefix}antiddd on/off/add\` — Filtro regional de DDDs proibidos\n` +
            `┃ 🔹 \`${usedPrefix}antilink on/off\` — Bloquear links de grupos externos\n` +
            `┃ 🔹 \`${usedPrefix}antitrava on/off\` — Escudo contra trava-zap e sobrecargas\n` +
            `┃ 🔹 \`${usedPrefix}antiflood on/off\` — Bloquear rajada excessiva de mensagens\n` +
            `┃ 🔹 \`${usedPrefix}antiviewonce on/off\` — Revelar fotos/vídeos temporários\n` +
            `┃ 🔹 \`${usedPrefix}antidelete on/off\` — Recuperar mensagens apagadas\n` +
            `┃ 🔹 \`${usedPrefix}x9 on/off\` — Sistema Dedo-Duro que delata revogações\n` +
            `┃ 🔹 \`${usedPrefix}soadm on/off\` — Permitir comandos apenas para administradores\n` +
            `┃ 🔹 \`${usedPrefix}grupoconfig\` — Exibir painel geral de proteções do grupo\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuAdm, { mentions: [m.sender] });
        }

        // 3. SUBMENU: RECURSOS DO PRIVADO (3)
        if (query === '3' || query === 'pv' || query === 'privado' || query === 'configpv') {
          const menuPv =
            `╭━━━〔 📲 *GESTÃO DO PRIVADO & PROTEÇÕES* 〕━━━⬣\n` +
            `┃\n` +
            `┃ ⚙️ *Painel Geral do Privado:*\n` +
            `┃ 🔹 \`${usedPrefix}configpv\` — Painel central com status de todos os recursos de PV\n` +
            `┃\n` +
            `┃ 📵 *Anti-Chamada (Anti-Call):*\n` +
            `┃ 🔹 \`${usedPrefix}antichamada on/off\` — Rejeitar ligações de voz/vídeo automaticamente\n` +
            `┃\n` +
            `┃ 🔒 *Anti-Privado (Anti-PV):*\n` +
            `┃ 🔹 \`${usedPrefix}antipv on/off\` — Restringir atendimento no PV (direciona para o grupo)\n` +
            `┃\n` +
            `┃ 👋 *Boas-Vindas no Privado:*\n` +
            `┃ 🔹 \`${usedPrefix}bemvindopv on/off\` — Enviar recepção privada para novos membros\n` +
            `┃ 🔹 \`${usedPrefix}legendabemvindopv <texto>\` — Definir a mensagem de recepção no PV\n` +
            `┃\n` +
            `┃ 🤖 *Inteligência no Privado:*\n` +
            `┃ 🔹 \`${usedPrefix}simi on/off\` — Ativar auto-conversa do SimSimi no PV\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuPv, { mentions: [m.sender] });
        }

        // 4. SUBMENU: IA & UTILITÁRIOS (4)
        if (query === '4' || query === 'ia' || query === 'util' || query === 'ferramentas' || query === 'utilitarios') {
          const menuIa =
            `╭━━━〔 🤖 *INTELIGÊNCIA ARTIFICIAL & FERRAMENTAS* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🧠 *Inteligência Artificial & Chatbots:*\n` +
            `┃ 🔹 \`${usedPrefix}simi <texto>\` — Bate-papo inteligente e bem-humorado com SimSimi\n` +
            `┃ 🔹 \`${usedPrefix}ia <pergunta>\` — Consultoria inteligente com IA avançada\n` +
            `┃ 🔹 \`${usedPrefix}imagine <ideia>\` — Gerar imagem artística inédita com IA\n` +
            `┃\n` +
            `┃ 🖥️ *Telemetria, Servidor & Diagnóstico:*\n` +
            `┃ 🔹 \`${usedPrefix}server\` — Diagnóstico do host VPS, CPU, RAM e Uptimes\n` +
            `┃ 🔹 \`${usedPrefix}ping\` — Medição de latência, velocidade e telemetria VIP\n` +
            `┃ 🔹 \`${usedPrefix}get\` — Inspecionar mensagem citada e extrair código de replicação Baileys\n` +
            `┃ 🔹 \`${usedPrefix}clonefun <nome>\` — Clonar e ativar função/card de outro bot instantaneamente\n` +
            `┃ 🔹 \`${usedPrefix}clones\` — Listar todas as funções clonadas ativas no bot\n` +
            `┃\n` +
            `┃ 🔍 *Pesquisa & Reconhecimento Óptico:*\n` +
            `┃ 🔹 \`${usedPrefix}ocr\` — Extrair texto legível de imagem ou foto\n` +
            `┃ 🔹 \`${usedPrefix}lerqr\` — Ler e decodificar QR Code de imagem\n` +
            `┃ 🔹 \`${usedPrefix}qr <texto|link>\` — Gerar imagem de QR Code instantânea\n` +
            `┃ 🔹 \`${usedPrefix}letra <música>\` — Buscar letra de música completa\n` +
            `┃ 🔹 \`${usedPrefix}wiki <termo>\` — Resumo enciclopédico oficial da Wikipedia\n` +
            `┃\n` +
            `┃ 🔍 *Motores de Pesquisa & Busca:*\n` +
            `┃ 🔹 \`${usedPrefix}google <busca>\` — Pesquisa Web Google com snippets\n` +
            `┃ 🔹 \`${usedPrefix}pinterest <termo>\` — Fotos e inspirações em HD do Pinterest\n` +
            `┃ 🔹 \`${usedPrefix}unsplash <termo>\` — Fotografias artísticas em alta definição\n` +
            `┃ 🔹 \`${usedPrefix}googlereverse\` — Busca reversa de imagens no Google Lens\n` +
            `┃ 🔹 \`${usedPrefix}yandexreverse\` — Busca reversa visual profunda no Yandex\n` +
            `┃ 🔹 \`${usedPrefix}playstore <app>\` — Ficha de app na Google Play Store\n` +
            `┃ 🔹 \`${usedPrefix}github <termo>\` — Repositórios open-source no GitHub\n` +
            `┃ 🔹 \`${usedPrefix}npmjs <pacote>\` — Consulta de pacotes e versões no NPM\n` +
            `┃ 🔹 \`${usedPrefix}anime <nome>\` — Ficha técnica e sinopse de animes\n` +
            `┃\n` +
            `┃ 🛠️ *Utilitários de Bolso & Produtividade:*\n` +
            `┃ 🔹 \`${usedPrefix}imei <número>\` — Consulta IMEI no Celular Seguro (MJSP / BNCR / Anatel)\n` +
            `┃ 🔹 \`${usedPrefix}inspect <link>\` — Inspecionar grupo WhatsApp sem entrar\n` +
            `┃ 🔹 \`${usedPrefix}nulis <texto>\` — Escrever texto em folha de caderno escolar\n` +
            `┃ 🔹 \`${usedPrefix}halah <texto>\` — Substituir vogais por A, I, U, E ou O\n` +
            `┃ 🔹 \`${usedPrefix}downloadsw\` — Baixar e reenviar status/story do WhatsApp\n` +
            `┃ 🔹 \`${usedPrefix}poll <pergunta> | <op1> | <op2>\` — Criar Enquete nativa\n` +
            `┃ 🔹 \`${usedPrefix}dropmail\` — E-mail temporário de 10 minutos\n` +
            `┃ 🔹 \`${usedPrefix}nowa <número>\` — Verificar se número tem WhatsApp\n` +
            `┃ 🔹 \`${usedPrefix}readmore <visível> | <oculto>\` — Texto "Ler mais..."\n` +
            `┃ 🔹 \`${usedPrefix}topdf <texto>\` — Converter texto em PDF oficial\n` +
            `┃ 🔹 \`${usedPrefix}tz\` — Relógio mundial e fusos horários\n` +
            `┃ 🔹 \`${usedPrefix}sunoai <ideia>\` — Conceito e prompt musical com IA\n` +
            `┃ 🔹 \`${usedPrefix}clima <cidade>\` — Previsão do tempo detalhada\n` +
            `┃ 🔹 \`${usedPrefix}moedas\` — Cotação em tempo real de Dólar, USDT e BTC\n` +
            `┃ 🔹 \`${usedPrefix}calc <expressão>\` — Calculadora inteligente de expressões\n` +
            `┃ 🔹 \`${usedPrefix}traduzir <idioma> <texto>\` — Tradução instantânea\n` +
            `┃ 🔹 \`${usedPrefix}encurtar <link>\` — Encurtar link longo via TinyURL\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuIa, { mentions: [m.sender] });
        }

        // 5. SUBMENU: FIGURINHAS & ÁUDIO (5)
        if (query === '5' || query === 'stickers' || query === 'figurinhas' || query === 'sticker' || query === 'audio' || query === 'midia') {
          const menuStickers =
            `╭━━━〔 🎨 *FIGURINHAS, ÁUDIO & MÍDIA* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🖼️ *Criador de Figurinhas & Studio:*\n` +
            `┃ 🔹 \`${usedPrefix}s\` / \`${usedPrefix}sticker\` — Criar figurinha estática ou animada\n` +
            `┃ 🔹 \`${usedPrefix}scircle\` — Criar figurinha em formato circular perfeito\n` +
            `┃ 🔹 \`${usedPrefix}qc <texto>\` — Figurinha Quote Chat com balão oficial\n` +
            `┃ 🔹 \`${usedPrefix}brat <texto>\` — Figurinha viral verde-limão com desfoque\n` +
            `┃ 🔹 \`${usedPrefix}smeme <topo> | <base>\` — Figurinha meme com texto\n` +
            `┃ 🔹 \`${usedPrefix}wm <pack> | <autor>\` — Modificar pacote e autor da figurinha\n` +
            `┃ 🔹 \`${usedPrefix}toimg\` — Converter figurinha em foto/imagem JPG\n` +
            `┃ 🔹 \`${usedPrefix}tomp3\` / \`${usedPrefix}tovideo\` — Converter em MP3 ou MP4\n` +
            `┃\n` +
            `┃ 🎨 *Image Maker & Efeitos Visuais:*\n` +
            `┃ 🔹 \`${usedPrefix}hd\` / \`${usedPrefix}remini\` — Aumento de nitidez e resolução HD\n` +
            `┃ 🔹 \`${usedPrefix}blur [1-30]\` — Aplicar desfoque artístico em fotos\n` +
            `┃ 🔹 \`${usedPrefix}pixel [4-32]\` — Pixelização retrô estilo 8-bit\n` +
            `┃ 🔹 \`${usedPrefix}ytcomment <msg>\` — Gerar comentário oficial do YouTube\n` +
            `┃ 🔹 \`${usedPrefix}horncard\` / \`${usedPrefix}simpcard\` — Cartões zoeira Horny/Simp\n` +
            `┃ 🔹 \`${usedPrefix}itssostupid <msg>\` — Meme "It's so stupid"\n` +
            `┃ 🔹 \`${usedPrefix}gay\` / \`${usedPrefix}lolice\` — Filtros de sobreposição\n` +
            `┃ 🔹 \`${usedPrefix}textpro <tema> | <texto>\` — Logos profissionais 3D estilizados\n` +
            `┃ 🔹 \`${usedPrefix}oxy <tema> | <texto>\` — Logos e efeitos PhotoOxy\n` +
            `┃ 🔹 \`${usedPrefix}phub <Pay> | <Bot>\` — Logo no estilo oficial Pornhub\n` +
            `┃ 🔹 \`${usedPrefix}bpink <texto>\` — Logo com tipografia oficial Blackpink\n`
            `┃\n` +
            `┃ 🎙️ *Voz Neural & Efeitos Sonoros:*\n` +
            `┃ 🔹 \`${usedPrefix}tts <texto>\` — Voz neural natural falada pelo bot\n` +
            `┃ 🔹 \`${usedPrefix}bass\` / \`${usedPrefix}grave\` — Boost de frequências graves profundas\n` +
            `┃ 🔹 \`${usedPrefix}nightcore\` — Acelera e modula tom no estilo nightcore\n` +
            `┃ 🔹 \`${usedPrefix}slow\` / \`${usedPrefix}fast\` — Desacelera ou acelera o áudio\n` +
            `┃ 🔹 \`${usedPrefix}robot\` / \`${usedPrefix}eco\` / \`${usedPrefix}cave\` — Efeito robô, eco ou caverna\n` +
            `┃ 🔹 \`${usedPrefix}reverso\` — Inverter áudio de trás para frente\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuStickers, { mentions: [m.sender] });
        }

        // 6. SUBMENU: DOWNLOADS (6)
        if (query === '6' || query === 'downloads' || query === 'download' || query === 'baixar') {
          const menuDownloads =
            `╭━━━〔 📥 *DOWNLOADS & MÍDIAS NA NUVEM* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🎵 *Músicas & Vídeos do YouTube:*\n` +
            `┃ 🔹 \`${usedPrefix}play <música> [H|S]\` — Baixar música em MP3 com capa oficial\n` +
            `┃ 🔹 \`${usedPrefix}video <vídeo> [H|S]\` — Baixar vídeo em MP4 (H: HD | S: Padrão)\n` +
            `┃ 🔹 \`${usedPrefix}playdoc <música>\` — Baixar música em alta qualidade em DOCUMENTO\n` +
            `┃ 🔹 \`${usedPrefix}lista <busca>\` — Top 20 vídeos do YouTube com downloads 1, 2, 3\n` +
            `┃\n` +
            `┃ 🌐 *Downloads de Redes Sociais & Nuvem:*\n` +
            `┃ 🔹 \`${usedPrefix}spotify <música>\` — Pesquisa e áudio de faixas do Spotify\n` +
            `┃ 🔹 \`${usedPrefix}mediafire <link>\` — Download direto de arquivos do MediaFire\n` +
            `┃ 🔹 \`${usedPrefix}gdrive <link>\` — Download direto do Google Drive\n` +
            `┃ 🔹 \`${usedPrefix}soundcloud <link>\` — Download de faixas do SoundCloud\n` +
            `┃ 🔹 \`${usedPrefix}threads <link>\` — Baixar vídeos e mídias do Threads\n` +
            `┃ 🔹 \`${usedPrefix}apk <nome>\` — Baixar instaladores APK para Android\n` +
            `┃ 🔹 \`${usedPrefix}ringtone <termo>\` — Baixar toques de celular\n` +
            `┃ 🔹 \`${usedPrefix}tiktok <link>\` — Baixar vídeo do TikTok sem marca d'água\n` +
            `┃ 🔹 \`${usedPrefix}ig <link>\` — Baixar fotos e reels do Instagram\n` +
            `┃ 🔹 \`${usedPrefix}fb <link>\` — Baixar vídeos do Facebook\n` +
            `┃ 🔹 \`${usedPrefix}x <link>\` — Baixar vídeos do Twitter / X\n` +
            `┃ 🔹 \`${usedPrefix}tourl\` — Upload para CDN permanente\n` +
            `┃ 🔹 \`${usedPrefix}gitclone <link>\` — Repositório GitHub em ZIP\n` +
            `┃ 🔹 \`${usedPrefix}ssweb <url>\` — Screenshot em alta resolução\n` +
            `┃ 🔹 \`${usedPrefix}snackvideo <link>\` — Download de vídeos do SnackVideo\n` +
            `┃ 🔹 \`${usedPrefix}likee <link>\` — Download de vídeos da rede Likee\n` +
            `┃ 🔹 \`${usedPrefix}smule <link>\` — Baixar gravações e áudios do Smule\n` +
            `┃ 🔹 \`${usedPrefix}pixiv <termo>\` — Ilustrações e artes do Pixiv\n` +
            `┃ 🔹 \`${usedPrefix}sharechat <link>\` — Download de vídeos do ShareChat\n` +
            `┃ 🔹 \`${usedPrefix}cocofun <link>\` — Download de vídeos do CocoFun\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuDownloads, { mentions: [m.sender] });
        }

        // 7. SUBMENU: DIVERSÃO & GAMES (7)
        if (query === '7' || query === 'games' || query === 'jogos' || query === 'diversao' || query === 'rpg') {
          const menuGames =
            `╭━━━〔 🎮 *DIVERSÃO, GAMES & SOCIAL* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🎮 *Minigames Interativos & Tabuleiro:*\n` +
            `┃ 🔹 \`${usedPrefix}ttt @membro\` — Partida de Jogo da Velha (Tic-Tac-Toe)\n` +
            `┃ 🔹 \`${usedPrefix}delttt\` — Cancelar partida ativa de Jogo da Velha\n` +
            `┃ 🔹 \`${usedPrefix}akinator\` — O gênio Akinator adivinha seu personagem\n` +
            `┃ 🔹 \`${usedPrefix}suitpvp @membro [aposta]\` — Duelo PvP Jokenpô\n` +
            `┃ 🔹 \`${usedPrefix}ppt <pedra|papel|tesoura>\` — Jokenpô solo contra o bot\n` +
            `┃ 🔹 \`${usedPrefix}math [fácil|médio|difícil]\` — Desafio Matemático Relâmpago\n` +
            `┃ 🔹 \`${usedPrefix}acertijo\` / \`${usedPrefix}pista\` — Enigma/Charada com dica\n` +
            `┃ 🔹 \`${usedPrefix}sopa\` — Caça-palavras no chat com premiação\n` +
            `┃ 🔹 \`${usedPrefix}verdad\` / \`${usedPrefix}reto\` — Verdade ou Desafio\n` +
            `┃ 🔹 \`${usedPrefix}pregunta <dúvida>\` — Bola 8 Mágica do destino\n` +
            `┃\n` +
            `┃ 🎲 *Jogos, Apostas & Moedas:*\n` +
            `┃ 🔹 \`${usedPrefix}cassino\` — Caça-níquel com jackpots e moedas\n` +
            `┃ 🔹 \`${usedPrefix}coinflip <valor> <cara|coroa>\` — Apostar moedas no cara ou coroa\n` +
            `┃ 🔹 \`${usedPrefix}dado\` — Rolar dado da sorte para ganhar moedas e XP\n` +
            `┃ 🔹 \`${usedPrefix}trabalhar\` — Fazer bico remunerado para ganhar moedas\n` +
            `┃ 🔹 \`${usedPrefix}crime\` — Golpe de alto risco com recompensa milionária\n` +
            `┃\n` +
            `┃ 👥 *Social, Casal & RPG:*\n` +
            `┃ 🔹 \`${usedPrefix}perfil\` — Exibir seu nível, XP, moedas e estado civil\n` +
            `┃ 🔹 \`${usedPrefix}casar @membro\` / \`${usedPrefix}divorciar\` — Casamento no bot\n` +
            `┃ 🔹 \`${usedPrefix}afk [motivo]\` — Ativar modo ausente (avisa quem marcar você)\n` +
            `┃ 🔹 \`${usedPrefix}casal\` / \`${usedPrefix}ship\` — Formar casal aleatório com % de amor\n` +
            `┃ 🔹 \`${usedPrefix}metadinha\` / \`${usedPrefix}ppcouple\` — Fotos combinando para perfil\n` +
            `┃ 🔹 \`${usedPrefix}gado\`, \`${usedPrefix}corno\`, \`${usedPrefix}gostoso\` — Medidores de porcentagem\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuGames, { mentions: [m.sender] });
        }

        // 8. SUBMENU: EXCLUSIVO DONO & METEÓRICO (8)
        if (query === '8' || query === 'dono' || query === 'dev' || query === 'owner' || query === 'adminbot' || query === 'meteorico') {
          if (!isOwner) return global.dfail('owner', m, conn);
          const menuDono =
            `╭━━━〔 👑 *PAINEL EXCLUSIVO DO DONO* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🚀 *LANÇAMENTO METEÓRICO & SUB-BOTS:*\n` +
            `┃ 🔹 \`${usedPrefix}meteorico status\` — Painel de grupos e leads transbordados\n` +
            `┃ 🔹 \`${usedPrefix}meteorico papeis\` — Gestão de papéis do exército de chips\n` +
            `┃ 🔹 \`${usedPrefix}vip\` — Link inteligente de transbordo de leads\n` +
            `┃ 🔹 \`${usedPrefix}fake @alvo <frase> | <resp>\` — Injetar diálogo persuasivo\n` +
            `┃ 🔹 \`${usedPrefix}subbots\` — Painel do exército de 100+ WhatsApps\n` +
            `┃ 🔹 \`${usedPrefix}subbot <reiniciar|pausar|ativar> <id>\` — Controle remoto de chip\n` +
            `┃ 🔹 \`${usedPrefix}gerente <id>\` — Delegar gerência total do grupo para um Sub-Bot\n` +
            `┃\n` +
            `┃ ⚙️ *Serviços, Servidor & Manutenção:*\n` +
            `┃ 🔹 \`${usedPrefix}restart [id]\` — Reiniciar bot matriz ou sub-bot com segurança\n` +
            `┃ 🔹 \`${usedPrefix}limparcache\` — Limpar memórias, caches e liberar RAM\n` +
            `┃ 🔹 \`${usedPrefix}server\` — Telemetria de hardware, carga de CPU e VPS\n` +
            `┃ 🔹 \`${usedPrefix}painel\` — Link seguro HTTPS de acesso ao Painel Web\n` +
            `┃ 🔹 \`${usedPrefix}broadcast <msg>\` — Transmitir comunicado oficial para todos os grupos\n` +
            `┃ 🔹 \`${usedPrefix}autoadmin\` — Dono/Dev vira administrador do grupo na hora\n` +
            `┃ 🔹 \`${usedPrefix}sair\` — Bot sai do grupo educadamente\n` +
            `┃\n` +
            `┃ 🛠️ *Equipe, Perfil & Controle do Dono:*\n` +
            `┃ 🔹 \`${usedPrefix}setppbot\` — Definir nova foto de perfil do WhatsApp do bot\n` +
            `┃ 🔹 \`${usedPrefix}join <link>\` — Fazer o bot entrar em grupo por convite\n` +
            `┃ 🔹 \`${usedPrefix}update\` — Verificar status e versão do sistema\n` +
            `┃ 🔹 \`${usedPrefix}fixmsgespera\` — Destravar mensagens e limpar buffer\n` +
            `┃ 🔹 \`${usedPrefix}suporte add <tel> <nome>\` — Nomear Dev de Suporte\n` +
            `┃ 🔹 \`${usedPrefix}suporte list\` — Listar todos os Devs autorizados\n` +
            `┃ 🔹 \`${usedPrefix}verificado\` — Alternar selo de verificação global do bot\n` +
            `┃ 🔹 \`${usedPrefix}backup\` — Enviar backup do banco SQLite para o Dono\n` +
            `┃ 🔹 \`${usedPrefix}clearsessions\` — Limpar sessões Signal órfãs poupando espaço\n` +
            `┃ 🔹 \`${usedPrefix}delppbot\` — Remover a foto de perfil do bot\n` +
            `┃ 🔹 \`${usedPrefix}pluginget <plugin>\` — Inspecionar código-fonte de serviço/plugin\n` +
            `┃ 🔹 \`${usedPrefix}viewstatus on/off\` — Auto-visualizar stories/status de contatos\n` +
            `┃ 🔹 \`${usedPrefix}statusbase [legenda]\` — Publicar Story marcando toda a base de clientes\n` +
            `┃ 🔹 \`${usedPrefix}statusarmy [legenda]\` — Disparar Stories em todos os sub-bots em sincronia\n` +
            `┃ 🔹 \`${usedPrefix}gerarkey <dias>\` — Gerar chave manual de aluguel (30, 90, vitalício)\n` +
            `┃ 🔹 \`${usedPrefix}listarkeys\` — Listar chaves de aluguel ativas não usadas\n` +
            `┃ 🔹 \`${usedPrefix}modoglobal on/off\` — Alternar exigência de aluguel global no bot\n` +
            `┃ 🔹 \`${usedPrefix}checkrentals\` — Forçar checagem e envio autônomo de cobranças\n` +
            `┃ 🔹 \`${usedPrefix}escuta\` — Central de Social Listening, Radar Sentinela e Áudios\n` +
            `┃ 🔹 \`${usedPrefix}aquecimento\` — Central de Aquecimento & Diálogos entre Sub-Bots (Máx 9/24h)\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
            `💡 _Para voltar ao índice de menus, envie *${usedPrefix}menu*_`;
          return m.reply(menuDono, { mentions: [m.sender] });
        }

        // 9. MENU COMPLETO (all / completo / tudo)
        if (query === 'completo' || query === 'all' || query === 'tudo') {
          const menuCompleto =
            `╭━━━〔 ⚡ *${global.titulowm || 'PAYBOT'}* ⚡ 〕━━━⬣\n` +
            `┃ 👤 *Usuário:* @${m.senderNumber}\n` +
            `┃ 👑 *Dono Supremo:* +554884702848\n` +
            `┃ ⏰ *Tempo Ativo:* ${uptimeStr}\n` +
            `┃ ⚡ *Prefixo Oficial:* \`${usedPrefix}\`\n` +
            `┃ 🛡️ *Status Oficial:* ${models.isVerificadoGlobal() ? '🟢 Verificado' : '⚪ Operacional'}\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 🛍️ *CATÁLOGO & VENDAS PIX & USDT* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}pix <valor>\` — Gerar cobrança Pix Copia e Cola imediata\n` +
            `┃ 🔹 \`${usedPrefix}usdt <valor> [rede]\` — Gerar cobrança em USDT (TRC-20 / BEP-20)\n` +
            `┃ 🔹 \`${usedPrefix}catalogo\` — Visualizar produtos e assinaturas disponíveis\n` +
            `┃ 🔹 \`${usedPrefix}pedido\` — Acompanhar status de pedidos e chaves de licença\n` +
            `┃ 🔹 \`${usedPrefix}status\` — Consultar andamento e entrega do pedido\n` +
            `┃ 🔹 \`${usedPrefix}suporte\` — Abrir chamado de atendimento humano\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 🛡️ *MODERAÇÃO DE GRUPOS & SEGURANÇA* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}darpoder @membro\` — Conceder cargo de Administrador\n` +
            `┃ 🔹 \`${usedPrefix}rebaixar @membro\` — Remover cargo de Administrador\n` +
            `┃ 🔹 \`${usedPrefix}ban @membro\` — Expulsar membro do grupo\n` +
            `┃ 🔹 \`${usedPrefix}regras\` — Visualizar diretrizes e regras oficiais do grupo\n` +
            `┃ 🔹 \`${usedPrefix}d\` — Apagar mensagem citada imediatamente\n` +
            `┃ 🔹 \`${usedPrefix}antifake on/off\` — Expulsar números estrangeiros\n` +
            `┃ 🔹 \`${usedPrefix}antiddd on/off/add\` — Filtro e bloqueio de DDDs\n` +
            `┃ 🔹 \`${usedPrefix}grupoconfig\` — Configurações de proteções do grupo\n` +
            `┃ 🔹 \`${usedPrefix}autoadmin\` — Dono/Dev vira admin do grupo na hora\n` +
            `┃ 🔹 \`${usedPrefix}staff\` — Listar equipe de administradores\n` +
            `┃ 🔹 \`${usedPrefix}infogrupo\` — Estatísticas e dados do grupo\n` +
            `┃ 🔹 \`${usedPrefix}sair\` — Bot sai do grupo educadamente\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 📲 *GESTÃO DO PRIVADO (PV)* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}bemvindopv on/off\` — Boas-vindas no privado para novos membros\n` +
            `┃ 🔹 \`${usedPrefix}legendabemvindopv <msg>\` — Definir texto de boas-vindas PV\n` +
            `┃ 🔹 \`${usedPrefix}configpv\` — Painel central de recursos do privado\n` +
            `┃ 🔹 \`${usedPrefix}antichamada on/off\` — Rejeitar chamadas de voz e vídeo\n` +
            `┃ 🔹 \`${usedPrefix}antipv on/off\` — Restringir atendimento no privado\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 🤖 *INTELIGÊNCIA ARTIFICIAL & FERRAMENTAS* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}simi <texto>\` — Bate-papo divertido com SimSimi (!simi on/off)\n` +
            `┃ 🔹 \`${usedPrefix}ia <pergunta>\` — Consultoria inteligente com IA\n` +
            `┃ 🔹 \`${usedPrefix}imagine <ideia>\` — Gerar imagem artística com IA\n` +
            `┃ 🔹 \`${usedPrefix}server\` — Diagnóstico do servidor, CPU, RAM e Uptimes\n` +
            `┃ 🔹 \`${usedPrefix}ping\` — Latência, velocidade e uso de memória RAM\n` +
            `┃ 🔹 \`${usedPrefix}letra <música>\` — Buscar letra de música completa\n` +
            `┃ 🔹 \`${usedPrefix}wiki <termo>\` — Resumo enciclopédico oficial da Wikipedia\n` +
            `┃ 🔹 \`${usedPrefix}lerqr\` — Ler e decodificar QR Code de imagem\n` +
            `┃ 🔹 \`${usedPrefix}ocr\` — Extrair texto de imagem ou foto\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 🎨 *FIGURINHAS & MÍDIA AVANÇADA* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}s\` / \`${usedPrefix}sticker\` — Criar figurinha estática ou animada\n` +
            `┃ 🔹 \`${usedPrefix}qc <texto>\` — Figurinha Quote Chat com balão escuro oficial\n` +
            `┃ 🔹 \`${usedPrefix}brat <texto>\` — Figurinha viral Charli XCX verde-limão\n` +
            `┃ 🔹 \`${usedPrefix}smeme <topo> | <base>\` — Criar figurinha meme\n` +
            `┃ 🔹 \`${usedPrefix}tts <texto>\` — Voz neural natural falada na hora\n` +
            `┃ 🔹 \`${usedPrefix}bass / ${usedPrefix}nightcore\` — Efeitos de áudio\n` +
            `┃ 🔹 \`${usedPrefix}slow / ${usedPrefix}fast / ${usedPrefix}robot\` — Efeitos de voz\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 📥 *DOWNLOADS DE REDES SOCIAIS & YOUTUBE* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}lista <termo>\` — Busca rica de vídeos e download múltiplo (1, 2, 3)\n` +
            `┃ 🔹 \`${usedPrefix}play <nome>\` / \`${usedPrefix}video <nome>\` — Baixar áudio ou vídeo (S ou H)\n` +
            `┃ 🔹 \`${usedPrefix}playdoc <nome>\` — Baixar música em documento com capa HQ\n` +
            `┃ 🔹 \`${usedPrefix}tiktok <link>\` — Baixar vídeo do TikTok sem marca d'água\n` +
            `┃ 🔹 \`${usedPrefix}ig <link>\` — Baixar fotos e reels do Instagram\n` +
            `┃ 🔹 \`${usedPrefix}fb <link>\` — Baixar vídeos e reels do Facebook\n` +
            `┃ 🔹 \`${usedPrefix}x <link>\` — Baixar vídeos e posts do Twitter / X\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 🚀 *LANÇAMENTO METEÓRICO* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}meteorico status\` — Painel de grupos e leads\n` +
            `┃ 🔹 \`${usedPrefix}meteorico papeis\` — Gestão de papéis do exército\n` +
            `┃ 🔹 \`${usedPrefix}vip\` — Link inteligente de transbordo\n` +
            `┃ 🔹 \`${usedPrefix}fake @alvo <frase> | <resposta>\` — Injetar diálogo persuasivo\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `╭━━━〔 👑 *EXCLUSIVO DONO & DEVS* 〕━━━⬣\n` +
            `┃ 🔹 \`${usedPrefix}restart\` — Reiniciar serviços do bot com segurança\n` +
            `┃ 🔹 \`${usedPrefix}limparcache\` — Limpar caches de memória e mídias\n` +
            `┃ 🔹 \`${usedPrefix}broadcast <msg>\` — Transmissão para todos os grupos\n` +
            `┃ 🔹 \`${usedPrefix}subbots\` — Painel do exército de 100+ WhatsApps\n` +
            `┃ 🔹 \`${usedPrefix}suporte add <tel> <nome>\` — Nomear Dev de Suporte\n` +
            `┃ 🔹 \`${usedPrefix}suporte list\` — Listar Devs de Suporte\n` +
            `┃ 🔹 \`${usedPrefix}painel\` — Link secreto de acesso ao Painel Web\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `_⚡ ${global.wm || 'PayBot'} - Automação & Vendas_`;
          return m.reply(menuCompleto, { mentions: [m.sender] });
        }

        // 10. MENU HUB / DASHBOARD PRINCIPAL (PADRÃO)
        const hubMenu =
          `╭━━━〔 ⚡ *${global.titulowm || 'PAYBOT'}* ⚡ 〕━━━⬣\n` +
          `┃ 👤 *Usuário:* @${m.senderNumber}\n` +
          `┃ 👑 *Dono Supremo:* +554884702848\n` +
          `┃ ⏰ *Tempo Ativo:* ${uptimeStr}\n` +
          `┃ ⚡ *Prefixo Oficial:* \`${usedPrefix}\`\n` +
          `┃ 🛡️ *Status Oficial:* ${models.isVerificadoGlobal() ? '🟢 Verificado' : '⚪ Operacional'}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
          `📌 *CENTRAL DE COMANDOS ORGANIZADA*\n` +
          `_Envie o comando com o número ou nome da categoria desejada:_\n\n` +
          `╭─────────────────────────────────────⬣\n` +
          `│ ➊ 🛍️ \`${usedPrefix}menu 1\` ou \`${usedPrefix}menu vendas\`\n` +
          `│    *CATÁLOGO & VENDAS PIX*, USDT e Pedidos\n` +
          `│\n` +
          `│ ➋ 🛡️ \`${usedPrefix}menu 2\` ou \`${usedPrefix}menu adm\`\n` +
          `│    *Moderação de Grupos, Ban, Darpoder e Regras*\n` +
          `│\n` +
          `│ ➌ 📲 \`${usedPrefix}menu 3\` ou \`${usedPrefix}menu pv\`\n` +
          `│    *Gestão do Privado, Anti-Chamada e Boas-Vindas PV*\n` +
          `│\n` +
          `│ ➍ 🤖 \`${usedPrefix}menu 4\` ou \`${usedPrefix}menu ia\`\n` +
          `│    *Inteligência Artificial, SimSimi, Server e OCR*\n` +
          `│\n` +
          `│ ➎ 🎨 \`${usedPrefix}menu 5\` ou \`${usedPrefix}menu stickers\`\n` +
          `│    *Figurinhas, Efeitos de Voz e Áudio*\n` +
          `│\n` +
          `│ ➏ 📥 \`${usedPrefix}menu 6\` ou \`${usedPrefix}menu downloads\`\n` +
          `│    *Downloads YouTube, MP3, Vídeos e Redes Sociais*\n` +
          `│\n` +
          `│ ➐ 🎮 \`${usedPrefix}menu 7\` ou \`${usedPrefix}menu games\`\n` +
          `│    *Jogos, Cassino, Apostas, Casamento e RPG*\n` +
          `│\n` +
          `│ ➑ 🚀 \`${usedPrefix}menu 8\` ou \`${usedPrefix}menu dono\`\n` +
          `│    *LANÇAMENTO METEÓRICO, Sub-Bots e Painel Dono*\n` +
          `│\n` +
          `│ 📜 \`${usedPrefix}menu completo\`\n` +
          `│    *Exibir catálogo geral com todos os comandos*\n` +
          `╰─────────────────────────────────────⬣\n\n` +
          `💡 *Exemplo de uso:* Digite *${usedPrefix}menu 1* para ver o catálogo de vendas, ou *${usedPrefix}menu 2* para moderação!\n\n` +
          `_⚡ ${global.wm || 'PayBot'} - Automação & Vendas_`;

        return m.reply(hubMenu, { mentions: [m.sender] });
      }
    });

    // 1.1 GERENTE GERAL DA OPERAÇÃO & ÁRBITRO DO SISTEMA (NÚCLEO ISOLADO COM INTELIGÊNCIA)
    this.registerCommand({
      name: 'gerente',
      command: ['gerente', 'arbitro', 'operacao', 'statusoperacao', 'pleno', 'gerenteoperacao'],
      tags: ['main', 'owner', 'admin'],
      desc: 'Exibe o veredito oficial do Árbitro da Operação com o Núcleo de Inteligência e telemetria dos 8 subsistemas vitais',
      run: async (m, extra = {}) => {
        try {
          const operationsArbiter = require('./services/operationsArbiterService');
          await m.reply('⚖️ *Consultando o Gerente Geral da Operação & Árbitro com o Núcleo de Inteligência...*');
          const audit = await operationsArbiter.auditAll({ forceAi: true });
          const report = operationsArbiter.formatWhatsAppReport(audit);
          return m.reply(report);
        } catch (err) {
          return m.reply(`❌ Falha ao consultar o Árbitro da Operação: ${err.message}`);
        }
      }
    });

    // 1.2 AUTOCURA AUTÔNOMA DO ÁRBITRO DA OPERAÇÃO
    this.registerCommand({
      name: 'autocura',
      command: ['autocura', 'reparar', 'heal', 'autoheal'],
      tags: ['owner', 'admin'],
      desc: 'Força a rotina autônoma de autocura do Árbitro em todos os subsistemas da operação',
      run: async (m, extra = {}) => {
        try {
          const operationsArbiter = require('./services/operationsArbiterService');
          await m.reply('🛠️ ⚖️ *O Árbitro da Operação iniciou o ciclo de autocura autônoma nos subsistemas...*');
          const audit = await operationsArbiter.auditAll({ triggerAutoHeal: true, forceAi: true });
          const report = operationsArbiter.formatWhatsAppReport(audit);
          return m.reply(report);
        } catch (err) {
          return m.reply(`❌ Falha ao executar autocura: ${err.message}`);
        }
      }
    });

    // REVELADOR DE VISUALIZAÇÃO ÚNICA EM ALTA QUALIDADE (!ver / !revelar)
    this.registerCommand({
      name: 'ver',
      command: ['ver', 'revelar', 'rv', 'vo', 'viewonce', 'abrir'],
      tags: ['tools', 'spy'],
      help: ['ver (responda a uma foto, vídeo ou áudio de visualização única)'],
      desc: 'Revela fotos, vídeos e áudios de visualização única em alta qualidade para todos no chat',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        const activeSock = conn?._rawSock || conn?.sock || conn;
        return spyFeatures.handleRevelar(activeSock, m.rawMsg || m, m.chat);
      }
    });

    // 2. PING / STATUS DE VELOCIDADE
    this.registerCommand({
      name: 'ping',
      command: ['ping', 'p', 'velocidade'],
      tags: ['main'],
      desc: 'Mede a latência e consumo do bot',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        const isOwner = extra.isOwner !== false;
        const isVip = extra.isVip === true || isOwner;
        const pingText = spyFeatures.buildPingDiagnosticText({
          sock: conn,
          from: m.chat,
          msg: m._rawMsg,
          isOwnerUser: isOwner,
          forceIncludeRamLabel: isOwner,
          isVipUser: isVip,
          senderPhone: m.senderNumber
        });
        return m.reply(pingText);
      }
    });

    // 2.1 GET / INSPEÇÃO E CLONAGEM DE MENSAGENS E COMANDOS
    this.registerCommand({
      name: 'get',
      command: ['get', 'inspectmsg', 'dumpmsg', 'rawmsg', 'copymsg', 'getcode', 'clonemsg', 'clonarmsg'],
      tags: ['tools', 'developer', 'vip'],
      desc: 'Inspeciona mensagem citada, extrai JSON original e gera código Baileys para replicação',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        return await spyFeatures.handleGet(conn, m.chat, m, extra);
      }
    });

    // 2.2 CLONEFUN / CLONAR E ATIVAR FUNÇÃO DE OUTRO BOT
    this.registerCommand({
      name: 'clonefun',
      command: ['clonefun', 'clonefuncao', 'clonarfun', 'clonarfuncao', 'clonefunc', 'clonarmensagem', 'clonarcmd', 'clonecmd'],
      tags: ['tools', 'developer', 'vip'],
      desc: 'Clona a função/mensagem de outro bot e ativa imediatamente como comando executável no PayBot',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        return await spyFeatures.handleCloneFun(conn, m.chat, m, m.args, m.textArgs, { ...extra, handler: this });
      }
    });

    // 2.3 DELCLONE / REMOVER COMANDO CLONADO
    this.registerCommand({
      name: 'delclone',
      command: ['delclone', 'rmclone', 'removerclone', 'delclonada', 'apagarclone'],
      tags: ['tools', 'developer', 'admin'],
      desc: 'Exclui um comando clonado previamente',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        const res = await spyFeatures.handleDelClone(conn, m.chat, m, m.args, m.textArgs);
        const cmdName = (m.args && m.args[0] ? m.args[0] : m.textArgs || '').trim().toLowerCase().replace(/^[!/#.]/, '');
        if (cmdName) {
          this.commands.delete(cmdName);
          this.commandAliases.delete(cmdName);
        }
        return res;
      }
    });

    // 2.4 CLONES / LISTAR FUNÇÕES E COMANDOS CLONADOS
    this.registerCommand({
      name: 'clones',
      command: ['clones', 'listclones', 'listarclones', 'funcoesclonadas'],
      tags: ['tools', 'developer'],
      desc: 'Lista todas as funções e comandos clonados ativos no bot',
      run: async (m, extra = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const conn = extra.conn || m._conn;
        return await spyFeatures.handleListClones(conn, m.chat, m);
      }
    });

    // 3. CONTATO DO DONO (vCard)
    this.registerCommand({
      name: 'dono',
      command: ['dono', 'owner', 'creator', 'criador'],
      tags: ['main'],
      desc: 'Mostra o contato oficial do Dono Supremo',
      run: async (m) => {
        const ownerPhone = (commandAuditService.getOwnerPhone() || '554884702848').replace(/\D/g, '');
        return m.reply(
          `👑 *DONO SUPREMO DO SISTEMA* 👑\n\n` +
          `• *Nome:* Administrador Supremo\n` +
          `• *WhatsApp:* +${ownerPhone}\n` +
          `• *Canal de Alertas:* 🔔 Ativo 24/7\n\n` +
          `_Para suporte comercial ou técnico, envie uma mensagem no número acima._`
        );
      }
    });

    // 3.1 MENTE DO DONO & APRENDIZADO COGNITIVO
    this.registerCommand({
      name: 'mente',
      command: ['mente', 'mindset', 'aprendizado', 'sincronia', 'sincronizacao', 'giriasdono', 'perfilcognitivo'],
      tags: ['main'],
      owner: true,
      desc: 'Exibe o painel de sincronização neural, gírias e tom de fala aprendidos do Dono',
      run: async (m, { isOwner = false }) => {
        if (!isOwner) return global.dfail('owner', m);
        const ownerMindsetService = require('./services/ownerMindsetService');
        const cockpit = ownerMindsetService.formatMindsetCockpit(m.senderNumber);
        return m.reply(cockpit);
      }
    });

    // 3.2 O ORÁCULO: INTELIGÊNCIA PREDITIVA & ANTECIPAÇÃO DE PASSOS
    this.registerCommand({
      name: 'oraculo',
      command: ['oraculo', 'oráculo', 'previsoes', 'previsões', 'probabilidades', 'antecipar', 'antecipacao', 'antecipação', 'surpreenda', 'mesurpreenda'],
      tags: ['main'],
      owner: true,
      desc: 'Oráculo de inteligência preditiva: calcula probabilidades, projeções e antecipa os próximos passos do Dono',
      run: async (m, { isOwner = false }) => {
        if (!isOwner) return global.dfail('owner', m);
        const predictiveIntelligence = require('./services/predictiveIntelligenceService');
        const briefing = predictiveIntelligence.generateSurpriseBriefing(m.senderNumber, m.pushName || 'Comandante');
        return m.reply(briefing);
      }
    });

    // 3.3 HIERARQUIA & CADEIA DE COMANDO OFICIAL (5 NÍVEIS)
    this.registerCommand({
      name: 'hierarquia',
      command: ['hierarquia', 'patente', 'patentes', 'niveis', 'cadeiadecomando', 'minhapatente'],
      tags: ['main'],
      desc: 'Exibe a cadeia de comando oficial do sistema, patente do usuário e regras de submissão',
      run: async (m) => {
        const botHierarchyOrchestrator = require('./services/botHierarchyOrchestratorService');
        const overview = botHierarchyOrchestrator.formatHierarchyOverview(m.senderNumber);
        return m.reply(overview);
      }
    });

    // 3.4 BANIR GRUPO & ATIVAR MODO SENTINELA STEALTH (!bangp / !unbangp)
    this.registerCommand({
      name: 'bangp',
      command: ['bangp', 'bangrupo', 'banirgp', 'banirgrupo', 'silenciargp', 'stealthgp'],
      tags: ['owner', 'admin'],
      owner: true,
      desc: 'Bane o grupo: silencia 100% de ofertas e reações (a não ser que seja mencionado) e continua minerando dados e leads',
      run: async (m, { conn, args = [], text = '', usedPrefix = '!', isOwner = false }) => {
        if (!isOwner) return global.dfail('owner', m, conn);

        let targetGroupJid = null;
        let reason = 'Banido pelo Dono Supremo via !bangp';

        if (m.isGroup) {
          targetGroupJid = m.chat;
          if (text) reason = text.trim();
        } else if (args[0] && args[0].endsWith('@g.us')) {
          targetGroupJid = args[0].trim();
          if (args.slice(1).length > 0) reason = args.slice(1).join(' ').trim();
        }

        if (!targetGroupJid || !targetGroupJid.endsWith('@g.us')) {
          return m.reply(
            `⚠️ *Uso correto:*\n` +
            `• *Dentro do grupo:* envie apenas *${usedPrefix}bangp* (ou *${usedPrefix}bangp motivo*)\n` +
            `• *No privado:* envie *${usedPrefix}bangp <id_do_grupo@g.us> [motivo]*\n\n` +
            `Exemplo: \`${usedPrefix}bangp 120363023471360215@g.us Silenciar ofertas da papelaria\``
          );
        }

        let groupName = 'Grupo';
        try {
          const meta = whatsappBotInstance?.groupMetadataCache?.get(targetGroupJid)?.data;
          if (meta && meta.subject) groupName = meta.subject;
        } catch (_) {}

        models.banGroup(targetGroupJid, {
          groupName,
          bannedBy: m.senderNumber || '554884702848',
          reason
        });

        return m.reply(
          `🛑 *GRUPO BANIDO COM SUCESSO!* 🕵️\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📍 *Grupo:* *${groupName}*\n` +
          `🆔 *JID:* \`${targetGroupJid}\`\n` +
          `🛡️ *Modo Ativado:* *SENTINELA STEALTH (MINERAÇÃO SILENCIOSA)*\n\n` +
          `🔇 *Comportamento do Exército de Bots:*\n` +
          `• *Postagens Proativas:* ❌ 100% Desativadas (Achadinhos, diálogos e ofertas interrompidas)\n` +
          `• *Reações e Respostas:* ❌ O bot não reage nem responde a comandos soltos\n` +
          `• *Exceção de Atendimento:* 💬 Só responderá caso seja *DIRETAMENTE MENCIONADO* (@bot ou marcando a mensagem)\n\n` +
          `🧠 *Coleta de Inteligência Contínua Ativa:* 🟢\n` +
          `Mesmo em silêncio absoluto, o robô continua lendo e minerando todos os dados, leads, números, perfis e intenções de compra dos membros para alimentar sua base diária de inteligência!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 *Para reativar a qualquer momento:* envie *${usedPrefix}unbangp*`
        );
      }
    });

    this.registerCommand({
      name: 'unbangp',
      command: ['unbangp', 'unbangrupo', 'desbanirgp', 'desbanirgrupo', 'reativargp'],
      tags: ['owner', 'admin'],
      owner: true,
      desc: 'Remove o banimento do grupo e reativa a operação normal dos bots e sub-bots',
      run: async (m, { conn, args = [], text = '', usedPrefix = '!', isOwner = false }) => {
        if (!isOwner) return global.dfail('owner', m, conn);

        let targetGroupJid = null;
        if (m.isGroup) {
          targetGroupJid = m.chat;
        } else if (args[0] && args[0].endsWith('@g.us')) {
          targetGroupJid = args[0].trim();
        }

        if (!targetGroupJid || !targetGroupJid.endsWith('@g.us')) {
          return m.reply(
            `⚠️ *Uso correto:*\n` +
            `• *Dentro do grupo:* envie apenas *${usedPrefix}unbangp*\n` +
            `• *No privado:* envie *${usedPrefix}unbangp <id_do_grupo@g.us>*\n\n` +
            `Exemplo: \`${usedPrefix}unbangp 120363023471360215@g.us\``
          );
        }

        models.unbanGroup(targetGroupJid);

        let groupName = 'Grupo';
        try {
          const meta = whatsappBotInstance?.groupMetadataCache?.get(targetGroupJid)?.data;
          if (meta && meta.subject) groupName = meta.subject;
        } catch (_) {}

        return m.reply(
          `🟢 *GRUPO DESBANIDO COM SUCESSO!* 🎉\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📍 *Grupo:* *${groupName}*\n` +
          `🆔 *JID:* \`${targetGroupJid}\`\n\n` +
          `⚡ *Status:* Operação normal restabelecida!\n` +
          `Os bots e sub-bots voltam a responder comandos, acolher participantes e interagir conforme as configurações do grupo.`
        );
      }
    });

    // 4. VERIFICADO GLOBAL (SELO OFICIAL PAYBOT NO PADRÃO GATA NINA / GATABOT)
    this.registerCommand({
      name: 'verificado',
      command: ['verificado', 'selo', 'seloverificado', 'verificadoglobal'],
      tags: ['main'],
      owner: true,
      desc: 'Ativa, desativa ou personaliza o selo verificado global estilo GataBot',
      run: async (m, { conn, args = [], text = '', usedPrefix = '!', isOwner = false } = {}) => {
        const parts = (text || args.join(' ')).trim().split(/\s+/);
        const sub = (parts[0] || '').toLowerCase();
        const whatsappBot = require('./bots/whatsappBot');
        const isOwnerUser = isOwner || (typeof whatsappBot.isOwner === 'function' ? whatsappBot.isOwner(m.senderNumber, m.fromMe) : false);

        if (!isOwnerUser) {
          return m.reply('⛔ Apenas o Dono (Owner) pode configurar o Verificado Global.');
        }

        if (sub === 'on' || sub === '1' || sub === 'ativar' || sub === 'ligar' || sub === 'true') {
          models.setVerificadoGlobal(true);
          return m.reply(
            `✅ *VERIFICADO GLOBAL ATIVADO!* 🟢\n\n` +
            `A partir de agora, todas as mensagens do bot serão enviadas com o selo verificado e citação oficial do WhatsApp (Estilo GataBot & SPY BOT).\n\n` +
            `_Para testar:_ envie qualquer comando como *${usedPrefix}ping* ou *${usedPrefix}menu* e veja a citação oficial.`
          );
        } else if (sub === 'off' || sub === '0' || sub === 'desativar' || sub === 'desligar' || sub === 'false') {
          models.setVerificadoGlobal(false);
          return m.reply(
            `⚪ *VERIFICADO GLOBAL DESATIVADO!*\n` +
            `Mensagens do bot voltarão a ser enviadas no formato padrão.`
          );
        } else if (sub === 'titulo' || sub === 'nome') {
          const newTitle = parts.slice(1).join(' ').trim();
          if (!newTitle) return m.reply(`⚠️ Informe o novo título do selo.\nExemplo: *${usedPrefix}verificado titulo PayBot Oficial ✓*`);
          models.setSetting('VERIFICADO_TITLE', newTitle);
          return m.reply(`✅ *Título do Selo Verificado atualizado para:* \`${newTitle}\``);
        } else if (sub === 'subtitulo' || sub === 'corpo' || sub === 'body') {
          const newBody = parts.slice(1).join(' ').trim();
          if (!newBody) return m.reply(`⚠️ Informe o novo subtítulo.\nExemplo: *${usedPrefix}verificado subtitulo Canal Oficial Verificado 🟢*`);
          models.setSetting('VERIFICADO_BODY', newBody);
          return m.reply(`✅ *Subtítulo do Selo Verificado atualizado para:* \`${newBody}\``);
        } else if (sub === 'toggle') {
          const current = models.isVerificadoGlobal();
          const newStatus = !current;
          models.setVerificadoGlobal(newStatus);
          return m.reply(
            `🛡️ *SELO VERIFICADO GLOBAL (Estilo GataBot)*\n\n` +
            `Status atualizado para: *${newStatus ? '🟢 ATIVADO (Selo Oficial Visível)' : '🔴 DESATIVADO'}*`
          );
        } else {
          // Se não passou subcomando, alterna o estado diretamente
          if (!sub) {
            const current = models.isVerificadoGlobal();
            const newStatus = !current;
            models.setVerificadoGlobal(newStatus);
            return m.reply(
              `🛡️ *SELO VERIFICADO GLOBAL (Estilo GataBot & SPY BOT)*\n\n` +
              `Status atualizado para: *${newStatus ? '🟢 ATIVADO (Selo Oficial Visível)' : '🔴 DESATIVADO'}*\n\n` +
              `_Comandos disponíveis:_\n` +
              `• *${usedPrefix}verificado on* — Ativar selo\n` +
              `• *${usedPrefix}verificado off* — Desativar selo\n` +
              `• *${usedPrefix}verificado titulo <texto>* — Alterar título\n` +
              `• *${usedPrefix}verificado subtitulo <texto>* — Alterar subtítulo`
            );
          }
          const cfg = models.getVerificadoConfig();
          return m.reply(
            `🛡️ *STATUS DO VERIFICADO GLOBAL (Estilo GataBot & SPY BOT):*\n\n` +
            `• *Estado:* ${cfg.enabled ? '🟢 ATIVADO (Selo Oficial Visível)' : '🔴 DESATIVADO'}\n` +
            `• *Título do Selo:* \`${cfg.title}\`\n` +
            `• *Subtítulo:* \`${cfg.body}\`\n` +
            `• *Ad Attribution:* ${cfg.show_ad ? '🟢 Sim' : '🔴 Não'}\n\n` +
            `_Comandos de configuração:_\n` +
            `• *${usedPrefix}verificado on* — Ativar o selo\n` +
            `• *${usedPrefix}verificado off* — Desativar o selo\n` +
            `• *${usedPrefix}verificado titulo <texto>* — Alterar título do selo\n` +
            `• *${usedPrefix}verificado subtitulo <texto>* — Alterar subtítulo do selo`
          );
        }
      }
    });

    // 5. INFORMAÇÕES DO GRUPO
    this.registerCommand({
      name: 'infogrupo',
      command: ['infogrupo', 'gpinfo', 'grupoinfo'],
      tags: ['group'],
      group: true,
      desc: 'Exibe informações do grupo atual',
      run: async (m, { conn }) => {
        const meta = await conn.groupMetadata(m.chat);
        const admins = meta.participants.filter(p => p.admin).length;
        const total = meta.participants.length;

        return m.reply(
          `👥 *INFORMAÇÕES DO GRUPO* 📋\n\n` +
          `• *Nome:* ${meta.subject}\n` +
          `• *ID:* \`${meta.id}\`\n` +
          `• *Total de Membros:* ${total}\n` +
          `• *Administradores:* ${admins}\n` +
          `• *Restrito:* ${meta.restrict ? 'Sim (Apenas Admins)' : 'Não (Livre)'}`
        );
      }
    });

    // ==========================================
    // 🎨 MÓDULO 1: FIGURINHAS & MÍDIA AVANÇADA
    // ==========================================

    // 6. ROUBAR / MODIFICAR PACOTE E AUTOR DE FIGURINHA (!wm / !take / !roubar)
    this.registerCommand({
      name: 'wm',
      command: ['wm', 'take', 'roubar', 'modificarfigurinha'],
      tags: ['stickers'],
      desc: 'Altera o nome do pacote e autor de uma figurinha respondida',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!m.quoted || m.quoted.mtype !== 'stickerMessage') {
          return m.reply(`⚠️ Responda a uma figurinha com \`${usedPrefix}wm <Nome do Pacote> | <Nome do Autor>\`\nExemplo: \`${usedPrefix}wm PayBot | Dono\``);
        }

        let packname = global.packname || 'PayBot Stickers';
        let author = global.author || '👑 Dono (+554884702848)';

        if (text && text.includes('|')) {
          const parts = text.split('|');
          packname = parts[0].trim() || packname;
          author = parts[1].trim() || author;
        } else if (text) {
          packname = text.trim();
        }

        await m.react(global.rwait || '⏳');
        const stickerBuffer = await m.quoted.download();
        const modified = await mediaStudioService.modifyStickerExif(stickerBuffer, packname, author);

        await conn.sendMessage(m.chat, { sticker: modified }, { quoted: m });
        return 'Figurinha modificada com sucesso';
      }
    });

    // 7. CRIADOR DE FIGURINHA MEME (!smeme)
    this.registerCommand({
      name: 'smeme',
      command: ['smeme', 'stickermeme', 'memesticker'],
      tags: ['stickers'],
      desc: 'Cria figurinha estilo meme clássico com texto no topo e na base',
      run: async (m, { conn, text, usedPrefix }) => {
        let targetMsg = m;
        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'stickerMessage')) {
          targetMsg = m.quoted;
        } else if (!m.message?.imageMessage) {
          return m.reply(`⚠️ Envie ou responda a uma imagem/figurinha com \`${usedPrefix}smeme <texto topo> | <texto base>\`\nExemplo: \`${usedPrefix}smeme QUANDO O BOT RESPONDE | NA VELOCIDADE DA LUZ\``);
        }

        let topText = '';
        let bottomText = '';

        if (text && text.includes('|')) {
          const parts = text.split('|');
          topText = parts[0].trim();
          bottomText = parts[1].trim();
        } else if (text) {
          bottomText = text.trim();
        } else {
          bottomText = 'PAYBOT';
        }

        await m.react(global.rwait || '⏳');
        const imgBuffer = await targetMsg.download();
        const memeWebp = await mediaStudioService.createStickerMeme(imgBuffer, topText, bottomText);

        await conn.sendMessage(m.chat, { sticker: memeWebp }, { quoted: m });
        return 'Figurinha meme criada com sucesso';
      }
    });

    // 8. EFEITOS DE ÁUDIO RÁPIDOS (!bass, !nightcore, !slow, !fast, !robot, !reverse)
    const audioEffects = ['bass', 'grave', 'nightcore', 'speedup', 'fast', 'slow', 'robot', 'reverse', 'reverb', 'eco'];
    this.registerCommand({
      name: 'audiofx',
      command: audioEffects,
      tags: ['audio'],
      desc: 'Aplica efeitos rápidos a um áudio respondido',
      run: async (m, { conn, command, usedPrefix }) => {
        if (!m.quoted || (m.quoted.mtype !== 'audioMessage' && !m.quoted.mtype.includes('audio'))) {
          return m.reply(`⚠️ Responda a uma mensagem de áudio ou música com \`${usedPrefix}${command}\` para aplicar o efeito.`);
        }

        await m.react(global.rwait || '⏳');
        const audioBuffer = await m.quoted.download();
        const result = await mediaStudioService.processAudioEffect(audioBuffer, command);

        if (result && result.buffer) {
          await conn.sendMessage(m.chat, {
            audio: result.buffer,
            mimetype: result.mimetype || 'audio/ogg; codecs=opus',
            ptt: true
          }, { quoted: m });
          await m.react(global.rdone || '✅');
          return `Efeito de áudio ${command} aplicado com sucesso`;
        }
        throw new Error('Falha ao processar efeito de áudio');
      }
    });

    // 8.1 SÍNTESE DE VOZ NATURAL (!tts / !voz / !falar)
    this.registerCommand({
      name: 'tts',
      command: ['tts', 'voz', 'falar', 'voice'],
      tags: ['audio', 'tools'],
      desc: 'Converte texto em áudio falado com voz neural humana em formato WhatsApp PTT perfeito',
      run: async (m, { conn, text, usedPrefix }) => {
        let content = text;
        if (!content && m.quoted && m.quoted.text) {
          content = m.quoted.text;
        }
        if (!content) {
          return m.reply(`🗣️ Digite a mensagem ou responda a um texto!\n*Exemplo:* \`${usedPrefix}tts Olá, tudo bem? Seja bem-vindo!\`\n*Voz masculina:* \`${usedPrefix}tts homem Olá amigos\`\n*Outros idiomas:* \`${usedPrefix}tts en Hello world\``);
        }

        await m.react(global.rwait || '⏳');
        const audioConverter = require('./services/audioConverterService');

        let voice = '';
        let lang = 'pt';
        if (/^(?:homem|masc|m|antonio)\s+/i.test(content)) {
          voice = 'homem';
          content = content.replace(/^(?:homem|masc|m|antonio)\s+/i, '');
        } else if (/^(?:mulher|fem|f|francisca)\s+/i.test(content)) {
          voice = 'mulher';
          content = content.replace(/^(?:mulher|fem|f|francisca)\s+/i, '');
        }

        const langMatch = content.match(/^(pt|en|es|fr|it|de|ja)\s+/i);
        if (langMatch) {
          lang = langMatch[1].toLowerCase();
          content = content.substring(langMatch[0].length).trim();
        }

        const result = await audioConverter.textToSpeech(content, { lang, voice });
        if (result && result.buffer) {
          await conn.sendMessage(m.chat, {
            audio: result.buffer,
            mimetype: result.mimetype || 'audio/ogg; codecs=opus',
            ptt: true
          }, { quoted: m });
          await m.react(global.rdone || '✅');
          return 'Áudio TTS de voz gerado e enviado com sucesso';
        }
        throw new Error('Falha ao gerar síntese de voz');
      }
    });

    // 8.2 CHATBOT SIMSIMI DO SPYBOT (!simi / !simsimi)
    this.registerCommand({
      name: 'simi',
      command: ['simi', 'simsimi'],
      tags: ['fun', 'ai'],
      desc: 'Bate-papo irreverente, engraçado e sarcástico com o SimSimi do SpyBot (!simi on/off)',
      run: async (m, { conn, text }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react('🐥');
        return await spyFeatures.handleSimi(conn, m.chat, text, m.pushName, m.isGroup);
      }
    });

    // 8.2.1 GERENCIADOR MULTI-IA COM FAILOVER & MÚLTIPLAS CHAVES (!ia / !ai / !multiia)
    this.registerCommand({
      name: 'ia',
      command: ['ia', 'ai', 'multiia', 'configia', 'aiconfig', 'inteligencia', 'setia', 'veria', 'testia', 'statusia'],
      tags: ['ai', 'tools', 'admin'],
      desc: 'Central Multi-IA com Failover automático entre Gemini, Groq (Llama), OpenAI e isolamento por Sub-Bot',
      run: async (m, { conn, text, isOwner, usedPrefix, command: cmdName }) => {
        const aiManager = require('./services/aiManagerService');
        const rawArgs = (text || '').trim().split(/\s+/).filter(Boolean);
        let sub = (rawArgs[0] || '').toLowerCase();
        let args = [...rawArgs];

        if (cmdName === 'setia') {
          sub = 'set';
          args = ['set', ...rawArgs];
        } else if (cmdName === 'veria' || cmdName === 'statusia') {
          sub = 'status';
          args = ['status'];
        } else if (cmdName === 'testia') {
          sub = 'test';
          args = ['test'];
        }

        // Identifica se a mensagem está rodando em um Sub-Bot ou no Master
        const isConnSubBot = Boolean(conn && conn.instanceId && Number(conn.instanceId) !== 1);
        let targetSubbotId = isConnSubBot ? Number(conn.instanceId) : null;

        // Se estiver no Master e usar comando direcionado a sub-bot: "!ia subbot <id> <comando>"
        if (sub === 'subbot' || sub === 'sub') {
          const parsedId = parseInt(args[1], 10);
          if (parsedId && parsedId !== 1) {
            targetSubbotId = parsedId;
            args = [args[2] || 'status', ...args.slice(3)];
            sub = (args[0] || '').toLowerCase();
          }
        }

        const isSubBotContext = Boolean(targetSubbotId && targetSubbotId !== 1);

        // 1. Status das IAs e Chaves (Master ou Sub-Bot)
        if (sub === 'status' || sub === 'info' || sub === 'painel') {
          await m.react('🧠');
          const report = aiManager.getStatus();

          if (isSubBotContext) {
            // Visão do Sub-Bot específico
            const sbInfo = report.subbotsFleet.find(s => s.id === targetSubbotId) || {
              id: targetSubbotId,
              name: `Sub-Bot #${targetSubbotId}`,
              aiStatus: 'BLOQUEADO_SEM_CHAVE',
              totalKeys: 0,
              providersSummary: 'Nenhuma chave cadastrada'
            };

            let out = `🤖 *PAINEL DE IA - SUB-BOT #${targetSubbotId}*\n`;
            out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            out += `🏷️ *Nome:* ${sbInfo.name}\n`;
            out += `📊 *Status da IA:* ${sbInfo.aiStatus === 'LIBERADO' ? '🟢 LIBERADO PARA USO' : '🔴 BLOQUEADO (SEM CHAVE PRÓPRIA)'}\n`;
            out += `🔑 *Chaves Cadastradas:* ${sbInfo.totalKeys}\n`;
            out += `📦 *Provedores Ativos:* ${sbInfo.providersSummary}\n\n`;
            out += `ℹ️ *Regra:* Cada Sub-Bot deve cadastrar sua própria chave para poder utilizar a IA. As chaves cadastradas aqui também ficam disponíveis no Mega-Pool do Bot Master.\n\n`;
            out += `💡 *Para cadastrar chave neste Sub-Bot:*\n`;
            out += `• ${usedPrefix}ia add gemini <sua_chave>\n`;
            out += `• ${usedPrefix}ia add groq <sua_chave>\n`;
            out += `• ${usedPrefix}ia add openai <sua_chave>`;
            return conn.sendMessage(m.chat, { text: out }, { quoted: m });
          }

          // Visão Geral do Bot Master (Mega-Pool + Frota de Sub-Bots)
          let out = `👑 *BOT MASTER - MEGA-POOL MULTI-IA COM FAILOVER*\n`;
          out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          out += `🔄 *Ordem de Fallback Global:*\n   ${report.fallbackOrder.map((p, i) => `${i + 1}º ${p.toUpperCase()}`).join(' ➔ ')}\n\n`;
          out += `📦 *Mega-Pool do Master (Chaves Master + Chaves dos Sub-Bots):*\n`;

          for (const [pKey, info] of Object.entries(report.masterMegaPool)) {
            const icon = info.activeKeys > 0 ? '🟢' : info.totalKeys > 0 ? '🟡' : '⚪';
            out += `${icon} *${info.name}*\n`;
            out += `   ├ Chaves ativas no pool: *${info.activeKeys}* de ${info.totalKeys}\n`;
            if (info.inCooldownKeys > 0) {
              out += `   ├ ⏳ Em cooldown/recarga: *${info.inCooldownKeys}*\n`;
            }
            out += `   ├ Modelos: ${info.models.join(', ')}\n`;
            out += `   └ Suporte: 👁️ Visão: ${info.supportsVision ? '✅' : '❌'} | 🎙️ Áudio: ${info.supportsAudio ? '✅' : '❌'}\n\n`;
          }

          out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          out += `🤖 *Frota de Sub-Bots & Exército:*\n`;
          if (report.subbotsFleet.length === 0) {
            out += `   └ Nenhum sub-bot conectado no momento.\n`;
          } else {
            for (const sb of report.subbotsFleet) {
              const statusBadge = sb.aiStatus === 'LIBERADO' ? '🟢 Liberado' : '🔴 Bloqueado (Sem chave)';
              out += `• *#${sb.id} ${sb.name}*: ${statusBadge} | ${sb.totalKeys} chave(s)\n`;
            }
          }

          out += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          out += `💡 *Comandos Master:*\n`;
          out += `• ${usedPrefix}ia test  ➔ Testa todas as APIs do Mega-Pool\n`;
          out += `• ${usedPrefix}ia add <provedor> <chave>  ➔ Cadastra chave no Master\n`;
          out += `• ${usedPrefix}ia subbot <id> add <provedor> <chave>  ➔ Cadastra chave para Sub-Bot\n`;
          out += `• ${usedPrefix}ia ordem gemini,groq,openai  ➔ Define prioridade de fallback\n`;
          out += `• ${usedPrefix}ia <pergunta>  ➔ Pergunta direta ao Mega-Pool`;

          return conn.sendMessage(m.chat, { text: out }, { quoted: m });
        }

        // 2. Teste de conectividade
        if (sub === 'test' || sub === 'teste' || sub === 'ping') {
          if (!isOwner) return m.reply('❌ Apenas o Dono Supremo ou Administrador pode testar as APIs.');
          await m.react('⏳');
          await m.reply('🔄 Executando bateria de testes em todos os provedores e chaves...');

          const results = await aiManager.testAllProviders({
            subbotId: isSubBotContext ? targetSubbotId : null,
            isMaster: !isSubBotContext
          });

          if (results.length === 0) {
            return m.reply(
              isSubBotContext
                ? `⚠️ Nenhuma chave cadastrada neste Sub-Bot (#${targetSubbotId}). Adicione com: \`!ia add <provedor> <chave>\``
                : '⚠️ Nenhuma chave de IA cadastrada no Mega-Pool ainda. Adicione com: `!ia add <provedor> <chave>`'
            );
          }

          let out = `🧪 *RESULTADO DO TESTE DE CONECTIVIDADE IA:*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          for (const res of results) {
            const statusIcon = res.success ? '✅' : '❌';
            out += `${statusIcon} *${res.provider.toUpperCase()}* [Chave #${res.keyIndex} - ${res.keyMasked}]\n`;
            out += `   ├ Latência: *${res.latencyMs}ms*\n`;
            if (res.success) {
              out += `   └ Resposta: "${res.reply.trim()}"\n\n`;
            } else {
              out += `   └ Erro: ${res.error}\n\n`;
            }
          }
          await m.react('✅');
          return conn.sendMessage(m.chat, { text: out }, { quoted: m });
        }

        // 3. Adicionar nova chave
        if (sub === 'add' || sub === 'cadastrar' || sub === 'set') {
          if (!isOwner) return m.reply('❌ Apenas o Dono Supremo ou Administrador pode cadastrar chaves de IA.');
          const targetProv = (args[1] || '').toLowerCase();
          const targetKey = args[2];

          // Apaga a mensagem contendo a chave enviada no WhatsApp para proteger as credenciais do dono
          if (typeof m.delete === 'function') {
            try { await m.delete(); } catch (_) {}
          }

          if (!targetProv || !targetKey) {
            return m.reply(
              `⚠️ Formato incorreto! Use:\n*${usedPrefix}setia <gemini|groq|openai|deepseek|openrouter> <sua_chave>*\nou\n*${usedPrefix}ia add <provedor> <chave>*\n` +
              (isSubBotContext ? `_(A chave será vinculada ao Sub-Bot #${targetSubbotId})_` : `_(A chave será vinculada ao Bot Master e ao Mega-Pool)_`)
            );
          }

          try {
            const res = aiManager.addApiKey(targetProv, targetKey, {
              subbotId: isSubBotContext ? targetSubbotId : null,
              isMaster: !isSubBotContext
            });
            await m.react('✅');

            if (res.scope === 'subbot') {
              return m.reply(
                `✅ *Chave cadastrada com sucesso para o Sub-Bot #${res.subbotId}!* 🤖\n` +
                `├ Provedor: *${res.provider.toUpperCase()}*\n` +
                `├ Total de chaves deste Sub-Bot: *${res.totalKeys}*\n` +
                `├ Status da IA no Sub-Bot: *🟢 LIBERADO*\n` +
                `├ 🔒 *Segurança:* Mensagem com a chave apagada do chat!\n` +
                `└ *Bônus:* Essa chave foi automaticamente adicionada ao Mega-Pool do Bot Master!`
              );
            }

            return m.reply(
              `✅ *Chave cadastrada com sucesso no Bot Master [${res.provider.toUpperCase()}]!* 👑\n` +
              `├ Total de chaves no Master: *${res.totalKeys}*\n` +
              `├ 🔒 *Segurança:* Mensagem com a chave apagada do chat!\n` +
              `└ O bot alternará automaticamente entre elas para evitar rate limits (429)!`
            );
          } catch (err) {
            return m.reply(`❌ Erro ao adicionar chave: ${err.message}`);
          }
        }

        // 4. Remover chave
        if (sub === 'del' || sub === 'remove' || sub === 'remover') {
          if (!isOwner) return m.reply('❌ Apenas o Dono Supremo pode remover chaves de IA.');
          const targetProv = (args[1] || '').toLowerCase();
          const targetKey = args[2];

          if (!targetProv || !targetKey) {
            return m.reply(`⚠️ Formato incorreto! Use:\n*${usedPrefix}ia del <gemini|groq|openai> <chave>*`);
          }

          try {
            const res = aiManager.removeApiKey(targetProv, targetKey, {
              subbotId: isSubBotContext ? targetSubbotId : null,
              isMaster: !isSubBotContext
            });
            await m.react('✅');
            return m.reply(`🗑️ Chave removida de [${res.provider.toUpperCase()}]. Total restante: *${res.totalKeys}*.`);
          } catch (err) {
            return m.reply(`❌ Erro ao remover chave: ${err.message}`);
          }
        }

        // 5. Configurar ordem de fallback
        if (sub === 'ordem' || sub === 'order' || sub === 'prioridade') {
          if (!isOwner) return m.reply('❌ Apenas o Dono Supremo pode definir a ordem de prioridade.');
          const orderArg = args.slice(1).join('').toLowerCase();
          if (!orderArg) {
            return m.reply(`⚠️ Especifique a lista separada por vírgula. Exemplo:\n*${usedPrefix}ia ordem gemini,groq,openai,deepseek*`);
          }

          const newOrder = aiManager.setFallbackOrder(orderArg);
          await m.react('✅');
          return m.reply(`✅ *Ordem de Failover atualizada com sucesso!*\nPrioridade: ${newOrder.map((p, i) => `${i + 1}º ${p.toUpperCase()}`).join(' ➔ ')}`);
        }

        // 6. Dúvida / Ajuda / Pergunta
        const question = text ? text.trim() : '';
        if (!question || question.toLowerCase() === 'help' || question.toLowerCase() === 'ajuda') {
          return m.reply(
            `🤖 *CENTRAL MULTI-IA COM ISOLAMENTO DE SUB-BOTS*\n\n` +
            `• *${usedPrefix}ia status* ➔ Painel de chaves e frota de sub-bots\n` +
            `• *${usedPrefix}ia test* ➔ Bateria de testes de latência\n` +
            `• *${usedPrefix}ia add <provedor> <chave>* ➔ Cadastra chave\n` +
            `• *${usedPrefix}ia subbot <id> add <prov> <chave>* ➔ Cadastra para Sub-Bot\n` +
            `• *${usedPrefix}ia ordem gemini,groq,openai* ➔ Define ordem de prioridade\n` +
            `• *${usedPrefix}ia <sua pergunta>* ➔ Pergunta direta com failover garantido`
          );
        }

        // Pergunta direta do usuário com verificação de bloqueio do Sub-Bot
        await m.react('🤔');
        try {
          const aiResult = await aiManager.chat({
            messages: [
              { role: 'system', content: 'Você é o assistente oficial do PayBot, inteligente, rápido, simpático e prestativo em português brasileiro.' },
              { role: 'user', content: question }
            ],
            temperature: 0.7,
            maxTokens: 500,
            subbotId: isSubBotContext ? targetSubbotId : null,
            isMaster: !isSubBotContext
          });

          await m.react('✅');
          const badge = isSubBotContext ? `Sub-Bot #${targetSubbotId}` : `Master Mega-Pool`;
          return conn.sendMessage(
            m.chat,
            { text: `🤖 *RESPOSTA [${aiResult.provider.toUpperCase()} - ${aiResult.model} | ${badge}]* (${aiResult.latencyMs}ms):\n\n${aiResult.text}` },
            { quoted: m }
          );
        } catch (err) {
          await m.react('❌');
          if (err.message && err.message.includes('Bloqueado')) {
            return m.reply(
              `⚠️ *ATENDENTE SEM CHAVE DE IA PRÓPRIA!*\n\n` +
              `Este Sub-Bot (#${targetSubbotId}) ainda não configurou uma chave de API própria.\n` +
              `Cada sub-bot precisa cadastrar sua própria chave para poder utilizar a IA.\n\n` +
              `👉 *Cadastre agora com o comando:*\n` +
              `\`${usedPrefix}ia add gemini <sua_chave_aqui>\`\n` +
              `ou\n` +
              `\`${usedPrefix}ia add groq <sua_chave_aqui>\``
            );
          }
          return m.reply(`⚠️ Ocorreu uma instabilidade na IA: ${err.message}`);
        }
      }
    });

    // 8.1.9 CENTRAL DO ENXAME / SWARM INTELLIGENCE (!enxame / !swarm / !garimpo / !minerador)
    this.registerCommand({
      name: 'enxame',
      command: ['enxame', 'swarm', 'garimpo', 'minerador'],
      tags: ['ai', 'admin', 'tools'],
      desc: 'Central de Inteligência do Enxame: links coletados, produtos em alta repercussão e chaves de IA',
      run: async (m, { args = [] }) => {
        const swarmIntelligence = require('./services/swarmIntelligenceService');
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'links' || sub === 'grupos') {
          const links = models.listSwarmCollectedLinks(20);
          if (!links.length) {
            return m.reply('ℹ️ Nenhum link de grupo coletado pelo Exército até o momento.');
          }
          let txt = `👥 *LINKS DE GRUPOS COLETADOS PELO EXÉRCITO (${links.length}):*\n\n`;
          links.forEach((l, idx) => {
            txt += `${idx + 1}. *${l.title || 'Grupo WhatsApp'}*\n   🔗 ${l.url}\n   📅 Coletado por Chip #${l.collected_by_subbot_id || '?'}\n\n`;
          });
          return m.reply(txt.trim());
        }

        if (sub === 'produtos' || sub === 'achados' || sub === 'hype') {
          const prods = models.listSwarmCollectedProducts(20, 1);
          if (!prods.length) {
            return m.reply('ℹ️ Nenhum produto em alta repercussão coletado pelo Exército até o momento.');
          }
          let txt = `🛍️ *PRODUTOS EM ALTA REPERCUSSÃO GARIMPADOS (${prods.length}):*\n\n`;
          prods.forEach((p, idx) => {
            txt += `${idx + 1}. *[${p.platform}]* Repercussão: 🔥 *${p.buzz_score}*\n   🔗 ${p.url}\n   📝 ${p.title ? p.title.slice(0, 80) : 'Sem título'}\n\n`;
          });
          return m.reply(txt.trim());
        }

        if (sub === 'chaves' || sub === 'keys') {
          const keys = models.listSwarmCollectedApiKeys(20);
          if (!keys.length) {
            return m.reply('ℹ️ Nenhuma chave de IA capturada em chats públicos até o momento.');
          }
          let txt = `🔑 *CHAVES DE IA CAPTURADAS E INCORPORADAS (${keys.length}):*\n\n`;
          keys.forEach((k, idx) => {
            txt += `${idx + 1}. *${k.provider.toUpperCase()}* (\`${k.masked_key}\`)\n   ⚡ Latência: ${k.latency_ms}ms | Status: 🟢 ${k.status}\n\n`;
          });
          return m.reply(txt.trim());
        }

        // Relatório Geral Consolidado
        const report = swarmIntelligence.formatSwarmReport();
        return m.reply(report);
      }
    });

    // 8.1.10 INSTRUÇÕES PARA OBTER CHAVE DE IA GRATUITA (!chavefree / !cf / !obterchave / !comopegarchave)
    this.registerCommand({
      name: 'chavefree',
      command: ['chavefree', 'cf', 'keyfree', 'comopegarchave', 'obterchave', 'tutorialchave', 'ajudachave', 'linkchave'],
      tags: ['ai', 'tools', 'help'],
      desc: 'Envia instruções completas e links para obter uma chave de API de IA 100% gratuita',
      run: async (m, { customSock, args = [] }) => {
        const aiManager = require('./services/aiManagerService');
        const parsedId = Number(args[0]);
        const instId = (!isNaN(parsedId) && parsedId > 0) ? parsedId : (customSock?.instanceId || 1);
        const instructions = aiManager.getFreeApiKeyInstructions({
          subbotId: instId,
          isBlocked: false
        });
        return m.reply(instructions);
      }
    });

    // 8.2 VITRINE ONLINE & CATÁLOGO TECNOLÓGICO RASTREADO (!loja / !catalogo / !vitrine / !store)
    this.registerCommand({
      name: 'loja',
      command: ['loja', 'catalogo', 'catálogo', 'vitrine', 'store', 'vercatalogo'],
      tags: ['shop', 'vendas'],
      desc: 'Envia o link oficial e rastreado da vitrine online com checkout Pix para o cliente',
      run: async (m, { conn }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '⏳');
        return await spyFeatures.handleLoja(conn, m.chat, m.senderNumber, m.pushName);
      }
    });

    // 8.2.1 CARROSSEL INTERATIVO DE PRODUTOS (!carrossel / !cards / !vitrinecarrossel)
    this.registerCommand({
      name: 'carrossel',
      command: ['carrossel', 'cards', 'vitrinecarrossel', 'lojacarrossel'],
      tags: ['shop', 'vendas'],
      desc: 'Envia o catálogo de produtos no formato interativo de carrossel de cards deslizantes no WhatsApp',
      run: async (m, { conn }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '🛍️');
        return await spyFeatures.handleCarrosselProdutos(conn, m.chat, m.senderNumber, m.pushName);
      }
    });

    // 8.3 RASTREAMENTO E MEUS PEDIDOS (!pedido / !pedidos / !meuspedidos / !rastrear)
    this.registerCommand({
      name: 'pedido',
      command: ['pedido', 'pedidos', 'meuspedidos', 'rastrear', 'rastreio'],
      tags: ['shop', 'orders'],
      desc: 'Acompanha o status em tempo real, chaves de licença e código Pix de pedidos',
      run: async (m, { conn, text }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '⏳');
        return await spyFeatures.handleOrderTracking(conn, m.chat, text, m.senderNumber, m.pushName);
      }
    });

    // ==========================================
    // 🔍 MÓDULO 2: FERRAMENTAS & UTILITÁRIOS
    // ==========================================

    // 8.1 BUSCA DO YOUTUBE COM DADOS RICOS & DOWNLOAD MÚLTIPLO (!lista)
    this.registerCommand({
      name: 'lista',
      command: ['lista', 'search', 'pesquisar', 'buscar'],
      tags: ['download', 'media'],
      desc: 'Busca os 20 principais vídeos do YouTube com canal, views, curtidas, data e download múltiplo (1, 2, 3)',
      run: async (m, { conn, text, usedPrefix, command }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '🔍');
        return await spyFeatures.handleLista(conn, m.chat, `${usedPrefix}${command} ${text}`, m.senderNumber);
      }
    });

    // 8.1.1 DOWNLOAD DE MÚSICA EM DOCUMENTO COM CAPA HQ (!playdoc)
    this.registerCommand({
      name: 'playdoc',
      command: ['playdoc', 'playdoch', 'playdocs', 'musicadoc', 'audiodoc', 'mp3doc', 'ytmp3doc'],
      tags: ['download', 'media'],
      desc: 'Baixa música do YouTube em alta qualidade com capa e metadados oficiais e envia como documento',
      run: async (m, { conn, text, usedPrefix, command }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '⏳');
        const query = text ? `${usedPrefix}${command} ${text}` : `${usedPrefix}${command}`;
        await spyFeatures.handlePlayDoc(conn, m.chat, query, m.quoted?.text, m.senderNumber);
        return 'Música em documento baixada com sucesso';
      }
    });

    // 8.1.2 REPRODUTOR E DOWNLOADER DE MÚSICA YOUTUBE (!play)
    this.registerCommand({
      name: 'play',
      command: ['play', 'playh', 'plays', 'ytmp3', 'ytmp3h', 'ytmp3s', 'musica', 'audio', 'mp3'],
      tags: ['download', 'media'],
      desc: 'Baixa música do YouTube em áudio MP3 com capa oficial e escolha de qualidade (H ou S)',
      run: async (m, { conn, text, usedPrefix, command }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '⏳');
        const query = text ? `${usedPrefix}${command} ${text}` : `${usedPrefix}${command}`;
        await spyFeatures.handlePlayMusic(conn, m.chat, query, m.quoted?.text, m.senderNumber);
        return 'Música MP3 baixada com sucesso';
      }
    });

    // 8.1.3 DOWNLOAD DE VÍDEO YOUTUBE (!video)
    this.registerCommand({
      name: 'video',
      command: ['video', 'videoh', 'videos', 'ytmp4', 'ytmp4h', 'ytmp4s', 'play2', 'mp4'],
      tags: ['download', 'media'],
      desc: 'Baixa vídeo do YouTube em MP4 sem limite de tamanho (H: 720p/1080p | S: 360p)',
      run: async (m, { conn, text, usedPrefix, command }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react(global.rwait || '⏳');
        const query = text ? `${usedPrefix}${command} ${text}` : `${usedPrefix}${command}`;
        await spyFeatures.handlePlayVideo(conn, m.chat, query, m.quoted?.text, m.senderNumber);
        return 'Vídeo MP4 baixado com sucesso';
      }
    });

    // 9. BUSCA DE LETRAS DE MÚSICA (!letra / !lyrics)
    this.registerCommand({
      name: 'letra',
      command: ['letra', 'lyrics', 'letras'],
      tags: ['tools'],
      desc: 'Busca a letra completa de uma música',
      run: async (m, { text, usedPrefix }) => {
        if (!text) {
          return m.reply(`⚠️ Informe o nome da música e artista.\nExemplo: \`${usedPrefix}letra Coldplay - Yellow\``);
        }

        await m.react(global.rwait || '⏳');
        const res = await utilityToolsService.searchLyrics(text);

        const lyricsFormatted =
          `🎵 *${res.title.toUpperCase()}* 🎵\n\n` +
          `${res.lyrics}\n\n` +
          `_⚡ ${global.wm || 'PayBot'}_`;

        return m.reply(lyricsFormatted);
      }
    });

    // 10. CONSULTA WIKIPEDIA (!wiki / !wikipedia)
    this.registerCommand({
      name: 'wikipedia',
      command: ['wiki', 'wikipedia', 'enciclopedia'],
      tags: ['tools'],
      desc: 'Consulta resumo enciclopédico na Wikipedia',
      run: async (m, { text, usedPrefix }) => {
        if (!text) {
          return m.reply(`⚠️ Informe o assunto para pesquisa.\nExemplo: \`${usedPrefix}wiki Inteligência Artificial\``);
        }

        await m.react(global.rwait || '⏳');
        const res = await utilityToolsService.searchWikipedia(text);

        const wikiFormatted =
          `📚 *WIKIPEDIA: ${res.title.toUpperCase()}* 🌐\n\n` +
          `${res.extract}\n\n` +
          `🔗 *Artigo Completo:* ${res.url}\n\n` +
          `_⚡ ${global.wm || 'PayBot'}_`;

        return m.reply(wikiFormatted);
      }
    });

    // 11. LEITOR E DECODIFICADOR DE QR CODE (!lerqr)
    this.registerCommand({
      name: 'lerqr',
      command: ['lerqr', 'readqr', 'qrcode', 'lerqrcode'],
      tags: ['tools'],
      desc: 'Decodifica e lê o texto ou link contido em uma imagem de QR Code',
      run: async (m, { usedPrefix }) => {
        let targetMsg = m;
        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype.includes('image'))) {
          targetMsg = m.quoted;
        } else if (!m.message?.imageMessage) {
          return m.reply(`⚠️ Envie ou responda a uma imagem contendo um QR Code com \`${usedPrefix}lerqr\`.`);
        }

        await m.react(global.rwait || '⏳');
        const imgBuffer = await targetMsg.download();
        const decodedText = await utilityToolsService.readQrCode(imgBuffer);

        return m.reply(
          `📱 *QR CODE DECODIFICADO COM SUCESSO!* ✅\n\n` +
          `\`\`\`\n${decodedText}\n\`\`\`\n\n` +
          `_⚡ ${global.wm || 'PayBot'}_`
        );
      }
    });

    // 12. EXTRATOR DE TEXTO OCR DE IMAGENS (!ocr)
    this.registerCommand({
      name: 'ocr',
      command: ['ocr', 'lertexto', 'extrairtexto'],
      tags: ['tools'],
      desc: 'Extrai texto visível em fotos ou documentos',
      run: async (m, { usedPrefix }) => {
        let targetMsg = m;
        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype.includes('image') || m.quoted.mtype === 'documentMessage')) {
          targetMsg = m.quoted;
        } else if (!m.message?.imageMessage && !m.message?.documentMessage) {
          return m.reply(`⚠️ Envie ou responda a uma imagem com texto usando \`${usedPrefix}ocr\`.`);
        }

        await m.react(global.rwait || '⏳');
        const imgBuffer = await targetMsg.download();
        const extractedText = await utilityToolsService.extractOcrText(imgBuffer);

        return m.reply(
          `📝 *TEXTO EXTRAÍDO VIA OCR (PAYBOT)* 🔍\n\n` +
          `${extractedText}\n\n` +
          `_⚡ ${global.wm || 'PayBot'}_`
        );
      }
    });

    // ==========================================
    // 📢 MÓDULO 3: ADMINISTRAÇÃO AVANÇADA & TRANSMISSÃO
    // ==========================================

    // 13. AUTO-ADMIN DO DONO E DEVS NO GRUPO (!autoadmin)
    this.registerCommand({
      name: 'autoadmin',
      command: ['autoadmin', 'viraradmin'],
      tags: ['admin'],
      group: true,
      owner: true,
      desc: 'Concede privilégio de Administrador ao Dono/Dev no grupo',
      run: async (m, { conn }) => {
        await m.react(global.rwait || '⏳');
        const res = await botFleetAdminService.autoAdmin(conn, m.chat, m.sender, m.senderNumber);
        return m.reply(res.message);
      }
    });

    // 14. BROADCAST / TRANSMISSÃO PARA TODOS OS GRUPOS (!broadcast / !bc)
    this.registerCommand({
      name: 'broadcast',
      command: ['broadcast', 'bc', 'bcall', 'transmissao', 'avisooficial'],
      tags: ['admin'],
      owner: true,
      desc: 'Dispara um comunicado oficial para todos os grupos do bot',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) {
          return m.reply(`⚠️ Digite a mensagem que deseja transmitir para todos os grupos.\nExemplo: \`${usedPrefix}bc Atenção equipe: manutenção programada às 03:00!\``);
        }

        await m.react(global.rwait || '⏳');
        const res = await botFleetAdminService.broadcastMessage(conn, text);
        return m.reply(res.message);
      }
    });

    // 15. BOT SAI DO GRUPO (!sair / !leave)
    this.registerCommand({
      name: 'sair',
      command: ['sair', 'leave', 'sairdogrupo'],
      tags: ['admin'],
      group: true,
      owner: true,
      desc: 'Faz o bot se despedir e sair do grupo atual',
      run: async (m, { conn }) => {
        return await botFleetAdminService.leaveGroup(conn, m.chat);
      }
    });

    // 15.1 CONTROLE GERAL DO BOT NO GRUPO (!bot on / !bot off)
    this.registerCommand({
      name: 'bot',
      command: ['bot', 'boton', 'botoff', 'ativarbot', 'desativarbot', 'ligarbot', 'desligarbot'],
      tags: ['admin', 'group'],
      desc: 'Ativa ou desativa completamente o bot no grupo (!bot on / !bot off)',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleGroupBotControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.2 CONTROLE DE POSTAGENS E DIVULGAÇÃO (!postagens on / !postagens off)
    this.registerCommand({
      name: 'postagens',
      command: ['postagens', 'postagem', 'posts', 'divulgacao', 'divulgar', 'ofertas'],
      tags: ['admin', 'group'],
      desc: 'Ativa ou desativa postagens de achadinhos, ofertas e aquecimento no grupo (!postagens on/off)',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleGroupBotControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.3 CONTROLE DE INTERAÇÕES E COMANDOS (!interacoes on / !interacoes off)
    this.registerCommand({
      name: 'interacoes',
      command: ['interacoes', 'interacao', 'comandos', 'respostas'],
      tags: ['admin', 'group'],
      desc: 'Ativa ou desativa comandos e respostas do bot no grupo (!interacoes on/off)',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleGroupBotControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.4 STATUS DO BOT NO GRUPO (!statusbot)
    this.registerCommand({
      name: 'statusbot',
      command: ['statusbot', 'botstatus', 'statusgrupo'],
      tags: ['admin', 'group'],
      desc: 'Exibe o status de interações e postagens do grupo atual',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleGroupBotControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.5 MODO SÓ DIVULGAÇÃO NO GRUPO (!sodivu)
    this.registerCommand({
      name: 'sodivu',
      command: ['sodivu', 'sodivulgacao', 'apenasdivu', 'apenasdivulgacao', 'somentedivu', 'somentedivulgacao'],
      tags: ['admin', 'group'],
      desc: 'Ativa ou desativa o modo Só Divulgação no grupo (!sodivu on/off/status)',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleSoDivuControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.6 MODO SÓ DIVULGAÇÃO GLOBAL (!sodivu-global)
    this.registerCommand({
      name: 'sodivuglobal',
      command: ['sodivuglobal', 'sodivu-global', 'sodivu_global', 'sodivug', 'sodivu-g'],
      tags: ['owner', 'admin'],
      desc: 'Ativa ou desativa o modo Só Divulgação em todos os grupos do bot (!sodivu-global on/off/status)',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleSoDivuControl(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner);
      }
    });

    // 15.7 GESTÃO DE FUNÇÕES DE SUB-BOTS (!subbotfunc <id|all> <funcao> <on|off>)
    this.registerCommand({
      name: 'subbotfunc',
      command: ['subbotfunc', 'subbotfuncao', 'subbotfuncoes', 'subbotfunções', 'funcoessubbot', 'funçõessubbot', 'setsubbotfunc'],
      tags: ['owner', 'admin', 'subbot'],
      desc: 'Ativa ou desativa funções específicas de sub-bots selecionados pelo Dono, Devs ou Bot Master',
      run: async (m, { conn, text, isOwner, isAdmin }) => {
        const subBotFeatureService = require('./services/subBotFeatureService');
        const isMaster = !conn?.instanceId || conn.instanceId === 1 || m.fromMe;
        return subBotFeatureService.handleCommand(conn, m.chat, m.text || text, m.senderNumber, m.isGroup, isAdmin, isOwner, isMaster);
      }
    });

    // 15.1 ATIVAR ALUGUEL VIA CHAVE / CÓDIGO (!key / !usarcodigo)
    this.registerCommand({
      name: 'usarcodigo',
      command: ['usarcodigo', 'key', 'usarkey', 'ativarkey', 'ativarchave'],
      tags: ['group', 'aluguel', 'saas'],
      desc: 'Ativa ou renova o aluguel do bot no grupo ou consulta a licença SaaS/BOT2 com uma chave !KEY',
      run: async (m, { conn, text, usedPrefix, command }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react('🔑');
        const quotedText = m.quoted?.text || '';
        const fullText = `${usedPrefix}${command} ${text || ''} ${quotedText}`.trim();
        return await spyFeatures.handleUsarCodigo(conn, m.chat, fullText, m.senderNumber, m.raw);
      }
    });

    // 15.2 CONSULTAR TEMPO DE ALUGUEL (!tempoaluguel / !statusaluguel)
    this.registerCommand({
      name: 'tempoaluguel',
      command: ['tempoaluguel', 'statusaluguel', 'meualuguel'],
      tags: ['group', 'aluguel'],
      group: true,
      desc: 'Consulta o tempo restante e status do aluguel do bot no grupo',
      run: async (m, { conn }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        await m.react('⏳');
        return await spyFeatures.handleTempoAluguel(conn, m.chat);
      }
    });

    // 15.3 CONTRATAR OU RENOVAR ALUGUEL DE GRUPO (!alugar / !planos)
    this.registerCommand({
      name: 'alugar',
      command: ['alugar', 'planos', 'compraraluguel', 'renovaraluguel', 'aluguel', 'planosaluguel'],
      tags: ['group', 'aluguel', 'vendas'],
      desc: 'Consulta os planos de aluguel e gera cobrança Pix Copia e Cola para ativação imediata',
      run: async (m, { conn, args, usedPrefix }) => {
        const groupRental = require('./services/groupRentalService');
        const planArg = (args[0] || '').toLowerCase().trim();

        const plans = groupRental.getRentalPlans();
        const selectedPlan = plans.find(p => String(p.days) === planArg || (planArg === 'vitalicio' && p.days === -1) || (planArg === 'semanal' && p.days === 7) || (planArg === 'mensal' && p.days === 30) || (planArg === 'trimestral' && p.days === 90));

        // Se não informou plano específico ou inválido, exibe a tabela comparativa de planos
        if (!selectedPlan) {
          return m.reply(
            `╭━━━〔 💎 *PLANOS DE ALUGUEL DO PAYBOT* 〕━━━⬣\n` +
            `┃\n` +
            `┃ 🥉 *1. Plano Semanal (7 dias)* — *R$ 14,90*\n` +
            `┃    • Ideal para testes, eventos e lançamentos rápidos\n` +
            `┃    • Contratar: \`${usedPrefix}alugar 7\`\n` +
            `┃\n` +
            `┃ 🥈 *2. Plano Mensal (30 dias)* — *R$ 49,90* ⭐ *MAIS VENDIDO*\n` +
            `┃    • Proteção 24/7 anti-link, anti-fake, moderação e IA\n` +
            `┃    • Contratar: \`${usedPrefix}alugar 30\`\n` +
            `┃\n` +
            `┃ 🥇 *3. Plano Trimestral (90 dias)* — *R$ 129,90* (15% OFF)\n` +
            `┃    • Economia máxima para grupos ativos\n` +
            `┃    • Contratar: \`${usedPrefix}alugar 90\`\n` +
            `┃\n` +
            `┃ 💎 *4. Licença Vitalícia (Permanente)* — *R$ 299,00*\n` +
            `┃    • Pagamento único com acesso para sempre ao grupo\n` +
            `┃    • Contratar: \`${usedPrefix}alugar vitalicio\`\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
            `📲 *Como contratar:* Digite *${usedPrefix}alugar 30* para gerar a cobrança Pix do plano mensal na hora!\n` +
            `_A liberação é automática assim que o pagamento for concluído._`
          );
        }

        // Gera a cobrança Pix do plano selecionado
        await m.react('⏳');
        const charge = await groupRental.generateRentalPixCharge({
          durationDays: selectedPlan.days,
          payerPhone: m.senderNumber,
          payerName: m.pushName || 'Cliente WhatsApp',
          targetGroupJid: m.isGroup ? m.chat : null
        });

        const pixMsg =
          `╭━━━〔 💳 *COBRANÇA PIX GERADA COM SUCESSO* 〕━━━⬣\n` +
          `┃ 📦 *Plano Selecionado:* ${charge.planName}\n` +
          `┃ 💰 *Valor do Investimento:* R$ ${charge.amount.toFixed(2)}\n` +
          `┃ ⏳ *Validade da Cobrança:* 30 minutos\n` +
          `┃ 📌 *Identificador:* \`${charge.tradeNo}\`\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
          `📋 *Pix Copia e Cola (toque para copiar):*\n` +
          `\`${charge.pixCode}\`\n\n` +
          `📲 *Como concluir sua ativação:*\n` +
          `1. Copie o código Pix acima;\n` +
          `2. Abra o app do seu Banco e selecione a opção *Pix Copia e Cola*;\n` +
          `3. Confirme o pagamento;\n` +
          `4. ✅ *O bot ativa ou renova o aluguel automaticamente em poucos segundos!*`;

        if (charge.qrCodeBase64 && conn && typeof conn.sendMessage === 'function') {
          const qrBuf = Buffer.from(charge.qrCodeBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          return conn.sendMessage(m.chat, { image: qrBuf, caption: pixMsg }, { quoted: m });
        }

        return m.reply(pixMsg);
      }
    });

    // 15.4 GERAR CHAVE MANUAL DE ALUGUEL (!gerarkey / !novakey)
    this.registerCommand({
      name: 'gerarkey',
      command: ['gerarkey', 'gerarcodigo', 'novakey', 'criarkey'],
      tags: ['owner', 'aluguel'],
      desc: 'Gera uma chave manual de ativação de aluguel para presentear ou vender fora da loja',
      owner: true,
      run: async (m, { args, usedPrefix }) => {
        const groupRental = require('./services/groupRentalService');
        const days = args[0] === 'vitalicio' || args[0] === 'permanente' || args[0] === '-1' ? -1 : (parseInt(args[0], 10) || 30);
        const targetGroup = args[1] && args[1].endsWith('@g.us') ? args[1] : null;

        const res = groupRental.generateCode(days, targetGroup, m.senderNumber);
        const durText = days === -1 ? 'Permanente / Vitalício ✨' : `${days} dias ⏳`;

        return m.reply(
          `╭━━━〔 🔑 *NOVA CHAVE DE ATIVAÇÃO GERADA* 〕━━━⬣\n` +
          `┃ 🔑 *Código da Licença:* \`${res.code}\`\n` +
          `┃ ⏳ *Duração:* ${durText}\n` +
          `┃ 👥 *Grupo Reservado:* ${targetGroup ? `\`${targetGroup}\`` : 'Livre (Qualquer grupo)'}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
          `📲 *Para ativar no grupo, envie:*\n` +
          `*${usedPrefix}usarcodigo ${res.code}*`
        );
      }
    });

    // 15.5 LISTAR CHAVES NÃO UTILIZADAS (!listarkeys / !chaves)
    this.registerCommand({
      name: 'listarkeys',
      command: ['listarkeys', 'verkeys', 'chaves'],
      tags: ['owner', 'aluguel'],
      desc: 'Lista todas as chaves de ativação de aluguel pendentes/não utilizadas',
      owner: true,
      run: async (m, { usedPrefix }) => {
        const groupRental = require('./services/groupRentalService');
        const codes = groupRental.listCodes(true);

        if (codes.length === 0) {
          return m.reply(`ℹ️ Não há chaves não utilizadas no momento. Use *${usedPrefix}gerarkey 30* para criar uma nova.`);
        }

        let txt = `╭━━━〔 🔑 *CHAVES DE ATIVAÇÃO DISPONÍVEIS (${codes.length})* 〕━━━⬣\n┃\n`;
        codes.slice(0, 15).forEach((c, idx) => {
          const dur = c.duration_days === -1 ? 'Vitalício' : `${c.duration_days}d`;
          txt += `┃ 🔹 \`${c.code}\` — ${dur} (Criado por: ${c.created_by})\n`;
        });
        txt += `┃\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `_Para usar em um grupo: *${usedPrefix}usarcodigo <CHAVE>*_`;

        return m.reply(txt);
      }
    });

    // 15.6 ALTERNAR MODO ALUGUEL GLOBAL (!modoglobal on/off)
    this.registerCommand({
      name: 'modoglobal',
      command: ['modoglobal', 'aluguelglobal', 'rentalglobal'],
      tags: ['owner', 'aluguel'],
      desc: 'Ativa ou desativa a exigência de aluguel global (apenas grupos pagos usam comandos)',
      owner: true,
      run: async (m, { args, usedPrefix }) => {
        const groupRental = require('./services/groupRentalService');
        const action = (args[0] || '').toLowerCase();

        if (action === 'on' || action === 'ativar' || action === '1') {
          groupRental.setGlobalMode(true);
          return m.reply('🔒 *MODO ALUGUEL GLOBAL ATIVADO!* A partir de agora, apenas grupos com aluguel ativo responderão a comandos de membros.');
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          groupRental.setGlobalMode(false);
          return m.reply('🟢 *MODO ALUGUEL GLOBAL DESATIVADO!* Todos os grupos podem usar os comandos livremente.');
        } else {
          const isAct = groupRental.isGlobalModeActive();
          return m.reply(`ℹ️ *Modo Aluguel Global:* ${isAct ? '🔒 Ativado (Restrito a grupos pagos)' : '🟢 Desativado (Livre para todos)'}\nPara alterar: *${usedPrefix}modoglobal on* ou *${usedPrefix}modoglobal off*`);
        }
      }
    });

    // 15.7 FORÇAR VERIFICAÇÃO DE VENCIMENTOS (!checkrentals)
    this.registerCommand({
      name: 'checkrentals',
      command: ['checkrentals', 'checaralugueis', 'rodaraluguel'],
      tags: ['owner', 'aluguel'],
      desc: 'Executa manualmente a checagem autônoma de vencimentos e cobranças nos grupos',
      owner: true,
      run: async (m, { conn }) => {
        const groupRental = require('./services/groupRentalService');
        await m.react('⏳');
        const res = await groupRental.checkExpiringRentals(conn);
        return m.reply(
          `╭━━━〔 🛡️ *RESULTADO DA CHECAGEM DE ALUGUÉIS* 〕━━━⬣\n` +
          `┃ ⚠️ *Avisos 72h Enviados:* ${res.warned_72h?.length || 0}\n` +
          `┃ 🚨 *Avisos 24h Enviados:* ${res.warned_24h?.length || 0}\n` +
          `┃ ⏳ *Grupos Expirados:* ${res.expired?.length || 0}\n` +
          `┃ 👋 *Grupos com Auto-Saída:* ${res.left_group?.length || 0}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // ==========================================
    // 🤖 MÓDULO 4: GESTÃO DE BOTS, SUB-BOTS E GRUPOS
    // ==========================================

    // 16. STATUS DO EXÉRCITO DE 100+ SUB-BOTS (!subbots)
    this.registerCommand({
      name: 'subbots',
      command: ['subbots', 'exercito', 'frota', 'chips'],
      tags: ['admin'],
      owner: true,
      desc: 'Exibe o status completo de todos os chips do exército de sub-bots',
      run: async (m) => {
        const fleetData = botFleetAdminService.getSubBotsFleetStatus();

        let fleetText =
          `🤖 *FROTA DO EXÉRCITO DE SUB-BOTS (100+ CHIPS)* 📡\n\n` +
          `• *Total de Chips:* ${fleetData.totalChips}\n` +
          `• *🟢 Online:* ${fleetData.onlineCount}\n` +
          `• *🔴 Offline:* ${fleetData.offlineCount}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (fleetData.fleet.length === 0) {
          fleetText += `_Nenhum sub-bot cadastrado na frota._`;
        } else {
          fleetData.fleet.slice(0, 15).forEach(f => {
            const statusEmoji = f.status === 'ONLINE' ? '🟢' : '🔴';
            fleetText += `${statusEmoji} *#${f.id} ${f.name}*\n   📞 ${f.phone} | Papel: ${f.role} | Mensagens: ${f.messagesCount}\n`;
          });
          if (fleetData.fleet.length > 15) {
            fleetText += `\n_...e mais ${fleetData.fleet.length - 15} chips ativos no painel web._`;
          }
        }

        return m.reply(fleetText);
      }
    });

    // 17. CONTROLE REMOTO DE SUB-BOT (!subbot <ação> <id>)
    this.registerCommand({
      name: 'subbot',
      command: ['subbot', 'chip'],
      tags: ['admin'],
      owner: true,
      desc: 'Reinicia, pausa, ativa ou torna um sub-bot do exército em Free remotamente',
      run: async (m, { args = [], usedPrefix = '!', conn } = {}) => {
        let action = args && args[0] ? String(args[0]).toLowerCase() : '';
        let instanceId = args && args[1];

        // Se inverteu a ordem (ex: !subbot 2 free ou !subbot 2 reiniciar ou !subbot 2 off)
        if (/^\d+$/.test(action) && instanceId && !/^\d+$/.test(instanceId)) {
          const tmp = action;
          action = String(instanceId).toLowerCase();
          instanceId = tmp;
        }

        // Se digitou "tornar free" (ex: !subbot tornar free 2)
        if (action === 'tornar' && (args[1] || '').toLowerCase() === 'free' && args[2]) {
          action = 'free';
          instanceId = args[2];
        }

        // Se executado sem especificar ID:
        if (!instanceId) {
          // A) No próprio socket de um sub-bot
          if (conn?.instanceId && conn.instanceId > 1) {
            instanceId = conn.instanceId;
          } else if (m.senderNumber) {
            // B) Busca pelo número do remetente
            const myInst = models.getArmyInstances().find(i => !i.is_main && i.phone && (i.phone === m.senderNumber || i.phone.endsWith(m.senderNumber.slice(-8))));
            if (myInst) instanceId = myInst.id;
          }
        }

        // Suporte para !subbot pv <modo> [id]
        if (action === 'pv' || action === 'filtro' || action === 'filtropv') {
          let mode = args[1] || 'status';
          let targetId = args[2] || instanceId;
          if (/^\d+$/.test(mode)) {
            const tmp = mode;
            mode = args[2] || 'status';
            targetId = tmp;
          }
          if (!targetId && conn?.instanceId && conn.instanceId > 1) targetId = conn.instanceId;
          if (!targetId) targetId = 2;
          await m.react(global.rwait || '⏳');
          const res = await botFleetAdminService.controlSubBot(targetId, 'pv', mode);
          return m.reply(res.message);
        }

        if (!action || !instanceId) {
          return m.reply(
            `⚙️ *Uso correto:* \`${usedPrefix}subbot <off|on|reiniciar|pausar|ativar|free|publico|privado> <id_do_chip>\`\n` +
            `Exemplos:\n` +
            `• \`${usedPrefix}subbot publico 2\` (Configura o Sub-Bot #2 para modo PÚBLICO - todos podem usar)\n` +
            `• \`${usedPrefix}subbot privado 2\` (Configura o Sub-Bot #2 para modo PRIVADO - só responde a si mesmo)\n` +
            `• \`${usedPrefix}subbot off 2\` (Desliga o Sub-Bot #2 mantendo a sessão salva)\n` +
            `• \`${usedPrefix}subbot on 2\` (Liga o Sub-Bot #2 imediatamente sem re-login)\n` +
            `• \`${usedPrefix}subbot free 2\` (Torna o Sub-Bot #2 em Free com 50 tokens diários)\n` +
            `• \`${usedPrefix}subbot reiniciar 2\` (Reinicia a conexão do Sub-Bot #2)\n` +
            `• \`${usedPrefix}subbot pausar 2\` (Pausa o Sub-Bot #2)`
          );
        }

        await m.react(global.rwait || '⏳');
        const res = await botFleetAdminService.controlSubBot(instanceId, action);
        return m.reply(res.message);
      }
    });

    // 18. REINICIAR BOT MATRIZ OU SUB-BOT (!restart / !reiniciarbot)
    this.registerCommand({
      name: 'reiniciarbot',
      command: ['reiniciarbot', 'restart', 'restartbot', 'reiniciar'],
      tags: ['admin'],
      owner: true,
      desc: 'Reinicia com segurança o processo do bot matriz ou um sub-bot específico',
      run: async (m, { text, whatsappBot }) => {
        const rawArg = (text || '').trim();
        if (rawArg && /^\d+$/.test(rawArg)) {
          const res = await botFleetAdminService.controlSubBot(parseInt(rawArg, 10), 'reiniciar');
          return m.reply(res.message);
        }
        await m.reply(`🔄 *REINICIALIZAÇÃO DO BOT SOLICITADA!* 🐾\n\nO bot matriz está reiniciando seus serviços agora.\n_Tempo estimado de reconexão: 3 a 7 segundos._`);
        setTimeout(() => {
          try {
            const bot = whatsappBot || require('./bots/whatsappBot');
            if (bot && typeof bot.reconnect === 'function') bot.reconnect();
          } catch (_) {}
        }, 1500);
        return 'Reinicialização do bot iniciada';
      }
    });

    // 19. CONFIGURAÇÕES AVANÇADAS DO GRUPO (!grupoconfig)
    this.registerCommand({
      name: 'grupoconfig',
      command: ['grupoconfig', 'grupo', 'configgrupo'],
      tags: ['group'],
      group: true,
      admin: true,
      desc: 'Exibe e orienta configurações de segurança e moderação do grupo atual',
      run: async (m, { usedPrefix }) => {
        const prot = models.getGroupProtection?.(m.chat) || {};
        const isAntiDelete = models.isAntiDeleteActive ? models.isAntiDeleteActive(m.chat) : (models.getSetting(`ANTIDELETE_${m.chat}`, 'false') === 'true');

        return m.reply(
          `🛡️ *CONFIGURAÇÕES DE MODERAÇÃO DO GRUPO* ⚙️\n\n` +
          `• *Anti-Link:* ${prot.antilink_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}antilink on/off\`)\n` +
          `• *Anti-Fake (+212):* ${prot.antifake_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}antifake on/off\`)\n` +
          `• *Anti-Delete:* ${isAntiDelete ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}antidelete on/off\`)\n` +
          `• *Anti-View-Once:* ${prot.antiviewonce_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}antiviewonce on/off\`)\n` +
          `• *Somente Admins:* ${prot.soadm_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}soadm on/off\`)\n` +
          `• *Boas-Vindas:* ${prot.welcome_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}boasvindas on/off\`)\n` +
          `• *Anti-Palavrão:* ${prot.antipalavra_enabled ? '🟢 Ativado' : '🔴 Desativado'} (\`${usedPrefix}antipalavra on/off\`)\n\n` +
          `_Para alterar qualquer proteção, use o comando correspondente acima._`
        );
      }
    });

    // 20. DAR PODER / PROMOVER A ADMINISTRADOR (!darpoder)
    this.registerCommand({
      name: 'darpoder',
      command: ['darpoder', 'promover', 'daradmin', 'promote'],
      tags: ['group', 'admin'],
      group: false, // Permite que !promover no privado acione a divulgação de produtos do catálogo
      admin: false,
      desc: 'Concede poderes de administrador a um membro no grupo (ou promove produto no privado)',
      run: async (m, { conn, args = [], usedPrefix = '!', isAdmin = false, isOwner = false, isBotAdmin = false } = {}) => {
        if (!m.isGroup) {
          // No privado, !promover serve para divulgar produtos do catálogo via Sub-Bots
          const spyFeatures = require('./services/spyFeaturesService');
          return spyFeatures.handlePromoteProduct(conn, m.chat, m.text);
        }
        if (!isAdmin && !isOwner) {
          return m.reply('⚠️ *Apenas administradores do grupo podem promover membros!*');
        }
        if (!isBotAdmin) {
          return m.reply('⚠️ *O bot precisa ser Administrador deste grupo para dar poder a membros!*');
        }

        let targetJid = null;
        let targetPhone = null;

        // 1. Mensagem citada (quoted ou contextInfo.participant)
        const quotedParticipant = m.quoted?.sender || m.message?.extendedTextMessage?.contextInfo?.participant;
        if (quotedParticipant) {
          targetJid = quotedParticipant;
          targetPhone = String(targetJid).split('@')[0].split(':')[0].replace(/\D/g, '');
        }

        // 2. Menção (@membro)
        if (!targetJid && m.mentionedJid && m.mentionedJid.length > 0) {
          targetJid = m.mentionedJid[0];
          targetPhone = String(targetJid).split('@')[0].split(':')[0].replace(/\D/g, '');
        }

        // 3. Número de telefone nos argumentos
        if (!targetJid && args && args[0]) {
          const num = args[0].replace(/\D/g, '');
          if (num.length >= 8) {
            targetPhone = num.length === 10 || num.length === 11 ? '55' + num : num;
            targetJid = `${targetPhone}@s.whatsapp.net`;
          }
        }

        if (!targetJid || !targetPhone) {
          return m.reply(
            `👑 *COMO DAR PODER A UM MEMBRO:*\n\n` +
            `• Responda à mensagem da pessoa com \`${usedPrefix}darpoder\`\n` +
            `• Ou mencione a pessoa: \`${usedPrefix}darpoder @usuario\`\n` +
            `• Ou digite o número: \`${usedPrefix}darpoder 5511999998888\``
          );
        }

        const cleanDigits = targetPhone.replace(/\D/g, '');
        const cleanJid = `${cleanDigits}@s.whatsapp.net`;

        try {
          await conn.groupParticipantsUpdate(m.chat, [cleanJid], 'promote');
          models.logGroupAdminAction?.({
            platform: 'whatsapp',
            groupId: m.chat,
            adminId: m.senderNumber,
            adminName: m.pushName,
            action: 'PROMOTE',
            targetId: cleanDigits,
            details: `Promovido a administrador via !darpoder por ${m.pushName || m.senderNumber}`
          });
          return m.reply(
            `⭐ *ADMINISTRADOR PROMOVIDO!*\n\n` +
            `O participante @${cleanDigits} agora é um Administrador deste grupo! 🎉`,
            { mentions: [cleanJid] }
          );
        } catch (err) {
          return m.reply(`❌ Falha ao promover membro: ${err.message}. Verifique se o bot possui privilégios de Admin.`);
        }
      }
    });

    // 21. BOAS-VINDAS NO PRIVADO (!bemvindopv)
    this.registerCommand({
      name: 'bemvindopv',
      command: ['bemvindopv', 'welcomepv', 'boasvindaspv', 'bvpv'],
      tags: ['group', 'admin'],
      desc: 'Ativa ou desativa o envio de boas-vindas no privado para quem entra no grupo',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleBemVindoPv(conn, m.chat, m.text, isAdmin || isOwner, isOwner);
      }
    });

    // 21.1 CARD SVG PERSONALIZADO DE BOAS-VINDAS (!welcomesvg)
    this.registerCommand({
      name: 'welcomesvg',
      command: ['welcomesvg', 'svgbv', 'cardbv', 'bvcard', 'svgwelcome'],
      tags: ['group', 'admin'],
      desc: 'Configura o cartão SVG de boas-vindas personalizado com avatar, nome, contagem e temas',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleWelcomeSvgCommand(conn, m.chat, m.text, isAdmin || isOwner, m.sender, m.pushName);
      }
    });

    // 21.2 TESTE RÁPIDO DO CARD DE BOAS-VINDAS (!testbv)
    this.registerCommand({
      name: 'testbv',
      command: ['testbv', 'testsvg', 'bvtest', 'welcometest'],
      tags: ['group', 'admin'],
      desc: 'Gera uma prévia do cartão SVG de boas-vindas com o seu perfil',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleWelcomeSvgCommand(conn, m.chat, '!welcomesvg test', isAdmin || isOwner, m.sender, m.pushName);
      }
    });

    // 21.3 CARTÃO DE IDENTIDADE / PERFIL SVG (!svgperfil)
    this.registerCommand({
      name: 'svgperfil',
      command: ['svgperfil', 'cardperfil', 'perfilsvg'],
      tags: ['group', 'main'],
      desc: 'Gera um cartão vetorial SVG personalizado com seu perfil, rank e dados no grupo',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const memberSvgService = require('./services/memberSvgService');
        const curTheme = memberSvgService.getWelcomeSvgTheme(m.chat);
        await m.reply('💳 *Gerando seu Cartão de Identidade Vetorial SVG...*');
        try {
          const card = await memberSvgService.createMemberProfileCard({
            memberJid: m.sender,
            memberPhone: m.senderNumber,
            memberName: m.pushName || `@${m.senderNumber}`,
            groupName: 'Comunidade Oficial PayBot',
            role: isOwner ? '👑 PROPRIETÁRIO / DONO' : (isAdmin ? '🛡️ ADMINISTRADOR' : '★ MEMBRO VIP'),
            sock: conn,
            theme: curTheme
          });

          if (card && card.pngBuffer) {
            await conn.sendMessage(m.chat, {
              image: card.pngBuffer,
              caption: `💳 *CARTÃO DE IDENTIDADE VETORIAL* 🛡️\n\n• *Titular:* ${m.pushName || `@${m.senderNumber}`}\n• *Nível:* ${isOwner ? '👑 DONO' : (isAdmin ? '🛡️ ADMIN' : 'VIP')}\n• *Tema:* ${curTheme}`,
              mentions: [m.sender]
            });

            if (card.svgBuffer) {
              await conn.sendMessage(m.chat, {
                document: card.svgBuffer,
                mimetype: 'image/svg+xml',
                fileName: `perfil_${m.senderNumber}.svg`
              });
            }
          }
        } catch (err) {
          await m.reply(`❌ Erro ao criar cartão de perfil: ${err.message}`);
        }
      }
    });

    // 22. LEGENDA DE BOAS-VINDAS NO PRIVADO (!legendabemvindopv)
    this.registerCommand({
      name: 'legendabemvindopv',
      command: ['legendabemvindopv', 'legendabvpv', 'textobemvindopv', 'setlegendapv'],
      tags: ['group', 'admin'],
      desc: 'Configura o texto da mensagem de boas-vindas enviada no privado',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleLegendaBemVindoPv(conn, m.chat, m.text, isAdmin || isOwner, isOwner);
      }
    });

    // 23. PAINEL DE CONFIGURAÇÕES DO PRIVADO (!configpv)
    this.registerCommand({
      name: 'configpv',
      command: ['configpv', 'pvconfig', 'painelpv', 'privadoconfig'],
      tags: ['admin', 'main'],
      desc: 'Exibe o painel de configurações de recursos no Privado (Anti-PV, Anti-Chamada, Boas-Vindas PV)',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleConfigPv(conn, m.chat, isAdmin || isOwner, isOwner);
      }
    });

    // 24. ANTI-CHAMADA (!antichamada)
    this.registerCommand({
      name: 'antichamada',
      command: ['antichamada', 'anticall', 'antiligacao', 'bloquearchamadas'],
      tags: ['admin'],
      desc: 'Ativa ou desativa a rejeição automática de chamadas de voz/vídeo',
      run: async (m, { conn, isOwner, isAdmin }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleAntiChamada(conn, m.chat, m.text, isOwner || isAdmin);
      }
    });

    // 25. ANTI-PRIVADO (!antipv)
    this.registerCommand({
      name: 'antipv',
      command: ['antipv', 'antiprivado', 'blockpv'],
      tags: ['admin'],
      desc: 'Ativa ou desativa a restrição de atendimento no privado',
      run: async (m, { conn, text, isOwner, isAdmin, usedPrefix }) => {
        if (!isOwner && !isAdmin) return global.dfail('admin', m, conn);
        const parts = String(text || '').trim().split(/\s+/);
        const action = parts[0]?.toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting('ANTIPRIVADO_GLOBAL', 'true');
          return m.reply(`🚫 *ANTI-PRIVADO ATIVADO!*\n\nMensagens privadas no bot receberão aviso de não autorização e serão bloqueadas.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
          return m.reply(`🟢 *ANTI-PRIVADO DESATIVADO!*\n\nAtendimento privado liberado.`);
        } else {
          const isAct = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
          return m.reply(`ℹ️ *Anti-Privado:* ${isAct ? '🔴 Ativado (PV restrito)' : '🟢 Desativado (PV liberado)'}\n\nPara alterar: \`${usedPrefix}antipv on\` ou \`${usedPrefix}antipv off\``);
        }
      }
    });

    // 26. ANTI-FAKE (+55 APENAS) (!antifake)
    this.registerCommand({
      name: 'antifake',
      command: ['antifake', 'antiestrangeiro', 'antigringo'],
      tags: ['group', 'admin'],
      group: true,
      admin: true,
      desc: 'Ativa ou desativa a expulsão de números estrangeiros (+55 apenas)',
      run: async (m, { conn, text, usedPrefix }) => {
        const parts = String(text || '').trim().split(/\s+/);
        const action = parts[0]?.toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIFAKE_${m.chat}`, 'true');
          models.updateGroupProtection(m.chat, { antifake_enabled: true });
          return m.reply(`🛡️ *PROTEÇÃO ANTI-FAKE ATIVADA!*\n\nNúmeros estrangeiros (DDI diferente de +55) serão banidos automaticamente ao entrarem no grupo.`);
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIFAKE_${m.chat}`, 'false');
          models.updateGroupProtection(m.chat, { antifake_enabled: false });
          return m.reply(`🔓 *PROTEÇÃO ANTI-FAKE DESATIVADA!*`);
        } else if (action === 'varrer' || action === 'expulsar') {
          let meta = null;
          try { meta = await conn.groupMetadata(m.chat); } catch (_) {}
          const participants = meta?.participants || [];
          const toKick = [];
          for (const p of participants) {
            if (p.admin === 'admin' || p.admin === 'superadmin' || models.isOwner(p.id)) continue;
            const phone = String(p.id || '').replace(/\D/g, '');
            if (models.isOwner(phone)) continue;
            if (phone && !phone.startsWith('55')) toKick.push(p.id);
          }
          if (!toKick.length) return m.reply(`✅ *Varredura Concluída:* Nenhum número estrangeiro/fake encontrado no grupo.`);
          try {
            await conn.groupParticipantsUpdate(m.chat, toKick, 'remove');
            return m.reply(`🛡️ *VARREDURA ANTI-FAKE:* Expulsos *${toKick.length}* números estrangeiros com sucesso!`);
          } catch (err) {
            return m.reply(`❌ Falha ao expulsar participantes: ${err.message}. Verifique se o bot é Admin!`);
          }
        } else {
          const isAct = models.getSetting(`ANTIFAKE_${m.chat}`, 'false') === 'true' || models.getGroupProtection(m.chat)?.antifake_enabled === 1;
          return m.reply(`ℹ️ *Proteção Anti-Fake (+55):* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: \`${usedPrefix}antifake on\` ou \`${usedPrefix}antifake off\`\nPara varrer membros atuais: \`${usedPrefix}antifake varrer\``);
        }
      }
    });

    // 27. ANTI-DDD (!antiddd)
    this.registerCommand({
      name: 'antiddd',
      command: ['antiddd', 'antidd', 'blockddd', 'proibirddd'],
      tags: ['group', 'admin'],
      group: true,
      admin: true,
      desc: 'Filtra e expulsa participantes de DDDs proibidos no grupo',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleAntiDDD(conn, m.chat, m.text, isAdmin || isOwner);
      }
    });

    // 28. REGRAS DO GRUPO (!regras)
    this.registerCommand({
      name: 'regras',
      command: ['regras', 'rules', 'regrasdogrupo', 'diretrizes'],
      tags: ['group'],
      group: true,
      desc: 'Visualiza as diretrizes e regras oficiais do grupo',
      run: async (m, { conn }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleRegras(conn, m.chat);
      }
    });

    // 29. DELETAR MENSAGEM RESPONDIDA (!d)
    this.registerCommand({
      name: 'd',
      command: ['d', 'del', 'delete', 'apagar', 'deletar'],
      tags: ['group', 'admin', 'vip'],
      desc: 'Apaga a mensagem citada no chat (exclusivo para VIPs, Admins e Dono)',
      run: async (m, { conn, isAdmin, isOwner, isBotAdmin, isVip, whatsappBot }) => {
        if (!m.quoted) {
          return m.reply('❓ Responda à mensagem que deseja apagar com *!d*');
        }

        const isAuthorizedVip = isOwner || (m.isGroup && isAdmin) || isVip || (
          whatsappBot && typeof whatsappBot.isVip === 'function' && whatsappBot.isVip(m.senderNumber, m.fromMe)
        );

        if (!isAuthorizedVip) {
          return m.reply('💎 *RECURSO EXCLUSIVO VIP* 💎\n\nApenas usuários VIP do robô, administradores ou o proprietário têm permissão para usar o comando *!d*.');
        }

        const botService = whatsappBot || require('./bots/whatsappBot');
        const isQuotedFromBot = m.quoted.fromMe === true || (
          botService && typeof botService.isBotSentMessage === 'function' && botService.isBotSentMessage({
            stanzaId: m.quoted.id,
            quotedParticipant: m.quoted.sender,
            activeSock: conn,
            from: m.chat,
            isGroup: m.isGroup,
            senderPhone: m.senderNumber
          })
        );

        if (isQuotedFromBot) {
          m.quoted.fromMe = true;
        }

        // Se NÃO for a própria mensagem do robô, exige permissões de admin
        if (!isQuotedFromBot) {
          if (!m.isGroup && !isOwner) return global.dfail('owner', m, conn);
          if (m.isGroup && !isAdmin && !isOwner) return global.dfail('admin', m, conn);
          if (m.isGroup && !isBotAdmin) {
            return m.reply('⚠️ *Aviso:* O robô precisa ser Administrador deste grupo para conseguir apagar mensagens de outros membros!');
          }
        }

        try {
          let deleteSock = conn;
          if (isQuotedFromBot && botService && typeof botService.getSocketForRevoke === 'function') {
            deleteSock = botService.getSocketForRevoke({
              stanzaId: m.quoted.id,
              quotedParticipant: m.quoted.sender,
              activeSock: conn
            }) || conn;
          }

          if (isQuotedFromBot && deleteSock && deleteSock !== conn && typeof deleteSock.sendMessage === 'function') {
            await deleteSock.sendMessage(m.chat, {
              delete: { remoteJid: m.chat, fromMe: true, id: m.quoted.id }
            });
          } else {
            await m.quoted.delete();
          }

          if (m.isGroup && isBotAdmin) {
            try { await m.delete(); } catch (_) {}
          }
          return 'Mensagem apagada com sucesso';
        } catch (err) {
          return m.reply(`❌ Erro ao apagar mensagem: ${err.message}. Verifique se o bot é Admin!`);
        }
      }
    });

    // 29.1 GESTÃO DE USUÁRIOS VIP (!addvip, !delvip, !vips)
    this.registerCommand({
      name: 'addvip',
      command: ['addvip', 'darvip', 'setvip'],
      tags: ['owner', 'admin'],
      owner: true,
      desc: 'Adiciona um número como usuário VIP do bot',
      run: async (m, { text, conn }) => {
        const parts = (text || '').trim().split(/\s+/);
        const targetPhone = (m.quoted ? m.quoted.senderNumber : (parts[0] || '')).replace(/\D/g, '');
        const days = parseInt(parts[1] || '30', 10);
        if (!targetPhone) {
          return m.reply('❓ Use: *!addvip <número ou responda a mensagem> [dias]*\nExemplo: *!addvip 5511999998888 30*');
        }
        models.addVipUser(targetPhone, 'VIP', days, m.senderNumber);
        return m.reply(`💎 *NOVO USUÁRIO VIP ATIVADO!* 💎\n\n👤 *Número:* +${targetPhone}\n⏳ *Validade:* ${days} dias\n✨ *Permissão:* Acesso aos privilégios VIP do PayBot!`);
      }
    });

    this.registerCommand({
      name: 'delvip',
      command: ['delvip', 'removervip', 'tirarvip'],
      tags: ['owner', 'admin'],
      owner: true,
      desc: 'Remove um usuário da lista de VIPs do bot',
      run: async (m, { text }) => {
        const targetPhone = (m.quoted ? m.quoted.senderNumber : (text || '')).replace(/\D/g, '');
        if (!targetPhone) {
          return m.reply('❓ Use: *!delvip <número ou responda a mensagem>*');
        }
        models.removeVipUser(targetPhone);
        return m.reply(`🗑️ *USUÁRIO VIP REMOVIDO!*\n\nO número +${targetPhone} não possui mais privilégios VIP.`);
      }
    });

    this.registerCommand({
      name: 'vips',
      command: ['vips', 'listvip', 'vipusers'],
      tags: ['owner', 'admin'],
      owner: true,
      desc: 'Lista todos os usuários VIP ativos',
      run: async (m) => {
        const vips = models.getVipUsers();
        if (!vips || vips.length === 0) {
          return m.reply('💎 *USUÁRIOS VIP:* Nenhum VIP cadastrado no momento.');
        }
        let txt = `💎 *LISTA DE USUÁRIOS VIP:* 💎\n\n`;
        vips.forEach((v, i) => {
          const exp = v.expires_at ? new Date(v.expires_at).toLocaleDateString('pt-BR') : 'Vitalício';
          txt += `${i + 1}. +${v.phone} — Expira em: ${exp}\n`;
        });
        return m.reply(txt);
      }
    });

    // 29.2 REGRA ANTI-DELETE / PROIBIDO APAGAR (!antidelete)
    this.registerCommand({
      name: 'antidelete',
      command: ['antidelete', 'antidel', 'antieliminar', 'proibidodeletar', 'regraantidelete', 'naoapagar', 'x9grupo'],
      tags: ['group', 'admin'],
      group: true,
      desc: 'Ativa ou desativa a regra de proibição de apagar mensagens no grupo',
      run: async (m, { args = [], isAdmin, isOwner }) => {
        if (!isAdmin && !isOwner) {
          return m.reply('⚠️ Apenas administradores do grupo ou o Dono podem configurar a regra Anti-Delete.');
        }
        const action = (args[0] || '').toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTIDELETE_${m.chat}`, 'true');
          return m.reply(
            `🚫 *REGRA ATIVADA: PROIBIDO APAGAR MENSAGENS!* 🚫\n\n` +
            `Neste grupo ninguém apaga nada! Se alguém apagar (seja a própria mensagem ou admin apagando de outro), o bot reenviará na hora desmascarando a mensagem apagada com citação sarcástica no estilo /fake! 👀🔥`
          );
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTIDELETE_${m.chat}`, 'false');
          return m.reply(`🙈 *REGRA ANTI-DELETE DESATIVADA!*`);
        } else {
          const isAct = models.isAntiDeleteActive(m.chat);
          return m.reply(
            `ℹ️ *Regra Anti-Delete (Proibido Apagar):* ${isAct ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: *!antidelete on* ou *!antidelete off*`
          );
        }
      }
    });

    // 30. LIMPAR CACHE (!limparcache)
    this.registerCommand({
      name: 'limparcache',
      command: ['limparcache', 'clearcache', 'limparmemoria', 'cleanmem'],
      tags: ['admin'],
      owner: true,
      desc: 'Limpa caches em memória, buffers de mídia e executa coleta de lixo',
      run: async (m, { conn, handler }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleLimparCache(conn, m.chat, true, handler);
      }
    });

    // 31. DIAGNÓSTICO DO SERVIDOR & HOST (!server)
    this.registerCommand({
      name: 'server',
      command: ['server', 'servidor', 'host', 'vps', 'sysinfo'],
      tags: ['main'],
      desc: 'Exibe telemetria detalhada de hardware, processador, memória RAM e uptimes',
      run: async (m, { conn }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleServerStatus(conn, m.chat);
      }
    });

    // 32. COBRANÇA PIX EXPRESS (!pix)
    this.registerCommand({
      name: 'pix',
      command: ['pix', 'cobranca', 'cobrar', 'gerarpix'],
      tags: ['sales'],
      desc: 'Gera cobrança imediata via Pix com Copia e Cola',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleWhatsAppCobranca(
          conn,
          m.chat,
          m.text,
          m._rawMsg,
          isAdmin || isOwner,
          m.senderNumber,
          m.pushName
        );
      }
    });

    // 33. COBRANÇA USDT CRIPTO (!usdt)
    this.registerCommand({
      name: 'usdt',
      command: ['usdt', 'cripto', 'crypto', 'tether'],
      tags: ['sales'],
      desc: 'Gera cobrança expressa em USDT ou consulta carteiras cripto',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleUsdt(
          conn,
          m.chat,
          m.text,
          m.senderNumber,
          m.pushName,
          isAdmin || isOwner
        );
      }
    });

    // 34. CONFIGURAR CHAVE PIX (!setpix)
    this.registerCommand({
      name: 'setpix',
      command: ['setpix', 'configpix', 'chavepix', 'definirpix'],
      tags: ['admin', 'sales'],
      desc: 'Define e homologa a Chave Pix padrão do bot (Telefone, CPF, CNPJ, Email ou EVP)',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleSetPix(conn, m.chat, m.text, isOwner || isAdmin);
      }
    });

    // 35. VER CHAVE PIX ATUAL (!verpix)
    this.registerCommand({
      name: 'verpix',
      command: ['verpix', 'statuspix', 'meupix', 'minhachave'],
      tags: ['admin', 'sales'],
      desc: 'Consulta a chave Pix ativa no bot e gera um Copia e Cola de teste',
      run: async (m, { conn, isAdmin, isOwner }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return await spyFeatures.handleVerPix(conn, m.chat, isOwner || isAdmin);
      }
    });

    // 36. OTIMIZAÇÃO DE MEMÓRIA & LATÊNCIA (!otimizar, !limparram)
    this.registerCommand({
      name: 'otimizar',
      command: ['otimizar', 'limparram', 'otimizaram', 'limparmemoria', 'cleanram'],
      tags: ['admin', 'owner'],
      desc: 'Otimiza a memória RAM, limpa caches do SQLite e reduz a latência',
      run: async (m, { whatsappBot }) => {
        const beforeRss = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
        const beforeHeap = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

        const db = require('./db/database');
        const spyFeatures = require('./services/spyFeaturesService');
        if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
        if (whatsappBot && typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
        if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
        if (typeof models.invalidateProductCache === 'function') models.invalidateProductCache();
        if (typeof global.gc === 'function') global.gc();

        const afterRss = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
        const afterHeap = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
        const freedHeap = Math.max(0, (Number(beforeHeap) - Number(afterHeap))).toFixed(1);

        return m.reply(
          `🧹 *OTIMIZAÇÃO DE MEMÓRIA & LATÊNCIA CONCLUÍDA!*\n\n` +
          `💾 *RAM Antes:* \`${beforeRss} MB\` (Heap: \`${beforeHeap} MB\`)\n` +
          `🚀 *RAM Atual:* \`${afterRss} MB\` (Heap: \`${afterHeap} MB\`)\n` +
          `✨ *Heap Liberado:* \`~${freedHeap} MB\`\n` +
          `⚡ *Latência do Servidor:* \`~1-5ms\`\n` +
          `🗄️ *Banco SQLite:* Cache reciclado e WAL truncado com sucesso!`
        );
      }
    });
    // =========================================================================
    // 11. PACOTE DE EXPANSÃO SPYBOT: JOGOS & MINIGAMES (CAT 1)
    // =========================================================================
    const gameEngine = require('./services/gameEngineService');

    // Jogo da Velha (Tic-Tac-Toe / !ttt)
    this.registerCommand({
      name: 'ttt',
      command: ['ttt', 'tictactoe', 'velha'],
      tags: ['game'],
      desc: 'Inicia uma partida de Jogo da Velha contra outro membro no grupo',
      group: true,
      run: async (m, { conn, args, usedPrefix }) => {
        return await gameEngine.handleTicTacToe(m, { conn, args, usedPrefix });
      }
    });

    // Cancelar Jogo da Velha (!delttt)
    this.registerCommand({
      name: 'delttt',
      command: ['delttt', 'delvelha'],
      tags: ['game'],
      desc: 'Cancela a partida atual de Jogo da Velha no grupo',
      group: true,
      run: async (m) => {
        return gameEngine.deleteTicTacToe(m);
      }
    });

    // Akinator Cognitivo (!akinator)
    this.registerCommand({
      name: 'akinator',
      command: ['akinator', 'aki'],
      tags: ['game'],
      desc: 'Adivinha o personagem que você está pensando via perguntas',
      run: async (m, { args, usedPrefix }) => {
        return await gameEngine.handleAkinator(m, { args, usedPrefix });
      }
    });

    // Duelo PvP Jokenpô (!suitpvp)
    this.registerCommand({
      name: 'suitpvp',
      command: ['suitpvp', 'pvp', 'duelo'],
      tags: ['game'],
      desc: 'Desafia um participante do grupo para duelo de Jokenpô valendo moedas',
      group: true,
      run: async (m, { args, usedPrefix }) => {
        return await gameEngine.handlePvp(m, { args, usedPrefix });
      }
    });

    this.registerCommand({
      name: 'aceitar',
      command: ['aceitar', 'accept'],
      tags: ['game'],
      desc: 'Aceita um desafio de duelo PvP pendente',
      group: true,
      run: async (m) => {
        return await gameEngine.handleAcceptPvp(m, true);
      }
    });

    this.registerCommand({
      name: 'recusar',
      command: ['recusar', 'decline'],
      tags: ['game'],
      desc: 'Recusa um desafio de duelo PvP pendente',
      group: true,
      run: async (m) => {
        return await gameEngine.handleAcceptPvp(m, false);
      }
    });

    // Desafio Matemático Relâmpago (!math)
    this.registerCommand({
      name: 'math',
      command: ['math', 'matematica', 'matematicas'],
      tags: ['game'],
      desc: 'Dispara um cálculo matemático no chat valendo moedas e XP',
      run: async (m, { args }) => {
        return await gameEngine.handleMath(m, { args });
      }
    });

    // Charadas & Enigmas (!acertijo / !charada)
    this.registerCommand({
      name: 'acertijo',
      command: ['acertijo', 'charada', 'adivinanza', 'enigma'],
      tags: ['game'],
      desc: 'Lança um enigma/charada no grupo valendo prêmios',
      run: async (m) => {
        return await gameEngine.handleAcertijo(m);
      }
    });

    this.registerCommand({
      name: 'pista',
      command: ['pista', 'dica'],
      tags: ['game'],
      desc: 'Exibe a dica para a charada ativa no chat',
      run: async (m) => {
        return await gameEngine.handlePista(m);
      }
    });

    // Caça-Palavras no Chat (!sopa)
    this.registerCommand({
      name: 'sopa',
      command: ['sopa', 'cacapalavras', 'wordsearch'],
      tags: ['game'],
      desc: 'Gera uma grade de caça-palavras para os membros encontrarem o termo oculto',
      run: async (m) => {
        return await gameEngine.handleSopa(m);
      }
    });

    // Jokenpô Solo contra o Bot (!ppt)
    this.registerCommand({
      name: 'ppt',
      command: ['ppt', 'jokenpo'],
      tags: ['game'],
      desc: 'Jogue Pedra, Papel ou Tesoura individual contra o bot',
      run: async (m, { text, usedPrefix }) => {
        return await gameEngine.handlePptSolo(m, { text, usedPrefix });
      }
    });

    // Verdade ou Desafio (!verdad / !reto)
    this.registerCommand({
      name: 'verdad',
      command: ['verdad', 'verdade'],
      tags: ['game'],
      desc: 'Gera uma pergunta reveladora de Verdade',
      run: async (m) => {
        return gameEngine.handleVerdad(m);
      }
    });

    this.registerCommand({
      name: 'reto',
      command: ['reto', 'desafio'],
      tags: ['game'],
      desc: 'Gera um desafio cômico para o jogador cumprir',
      run: async (m) => {
        return gameEngine.handleReto(m);
      }
    });

    // Bola 8 Mágica (!pregunta / !bola8)
    this.registerCommand({
      name: 'pregunta',
      command: ['pregunta', 'bola8', '8ball'],
      tags: ['game'],
      desc: 'Responde perguntas de Sim ou Não com a Bola 8 Mágica',
      run: async (m, { text }) => {
        return gameEngine.handlePregunta(m, text);
      }
    });

    // =========================================================================
    // 12. PACOTE DE EXPANSÃO SPYBOT: GERADORES VISUAIS & MAKER (CAT 4)
    // =========================================================================
    const visualMaker = require('./services/visualMakerService');

    // Desfoque em Fotos (!blur)
    this.registerCommand({
      name: 'blur',
      command: ['blur', 'desfocar'],
      tags: ['maker'],
      desc: 'Aplica desfoque artístico (blur) em uma imagem citada ou enviada',
      run: async (m, { conn, args }) => {
        const isQuotedImage = m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'viewOnceMessageV2');
        const isSelfImage = m.mtype === 'imageMessage' || m.message?.imageMessage;
        if (!isQuotedImage && !isSelfImage) {
          return m.reply('ℹ️ Responda a uma foto ou envie uma imagem com *!blur [intensidade]*');
        }

        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma foto ou envie uma imagem com *!blur [intensidade]*');

        const blurred = await visualMaker.applyBlur(buf, args[0]);
        return await conn.sendMessage(m.chat, { image: blurred, caption: '✨ *Efeito Blur Aplicado!*' }, { quoted: m });
      }
    });

    // Pixelização (!pixel)
    this.registerCommand({
      name: 'pixel',
      command: ['pixel', 'pixelar'],
      tags: ['maker'],
      desc: 'Pixeliza a foto citada com efeito retrô',
      run: async (m, { conn, args }) => {
        const isQuotedImage = m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'viewOnceMessageV2');
        const isSelfImage = m.mtype === 'imageMessage' || m.message?.imageMessage;
        if (!isQuotedImage && !isSelfImage) {
          return m.reply('ℹ️ Responda a uma foto com *!pixel [escala]*');
        }

        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma foto com *!pixel [escala]*');

        const pix = await visualMaker.applyPixel(buf, args[0]);
        return await conn.sendMessage(m.chat, { image: pix, caption: '👾 *Efeito Pixel Retrô Aplicado!*' }, { quoted: m });
      }
    });

    // Figurinha Circular (!scircle)
    this.registerCommand({
      name: 'scircle',
      command: ['scircle', 'circulo', 'stickercirculo'],
      tags: ['maker', 'sticker'],
      desc: 'Cria uma figurinha em formato circular perfeito',
      run: async (m, { conn }) => {
        const isQuotedImage = m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'viewOnceMessageV2');
        const isSelfImage = m.mtype === 'imageMessage' || m.message?.imageMessage;
        if (!isQuotedImage && !isSelfImage) {
          return m.reply('ℹ️ Responda a uma imagem com *!scircle*');
        }

        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma imagem com *!scircle*');

        const circleSticker = await visualMaker.createCircleSticker(buf);
        return await conn.sendMessage(m.chat, { sticker: circleSticker }, { quoted: m });
      }
    });

    // Upscale HD & Nitidez (!hd / !remini)
    this.registerCommand({
      name: 'hd',
      command: ['hd', 'remini', 'upscale', 'melhorar'],
      tags: ['maker'],
      desc: 'Aumenta a nitidez e a resolução da foto citada com restauração HD',
      run: async (m, { conn }) => {
        const isQuotedImage = m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'viewOnceMessageV2');
        const isSelfImage = m.mtype === 'imageMessage' || m.message?.imageMessage;
        if (!isQuotedImage && !isSelfImage) {
          return m.reply('ℹ️ Responda a uma foto com *!hd* para melhorar a qualidade.');
        }

        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma foto com *!hd* para melhorar a qualidade.');

        await m.react('⏳');
        const hdBuf = await visualMaker.applyHdUpscale(buf);
        return await conn.sendMessage(m.chat, { image: hdBuf, caption: '🚀 *Restauração HD & Nitidez Concluída!*' }, { quoted: m });
      }
    });

    // Comentário do YouTube (!ytcomment)
    this.registerCommand({
      name: 'ytcomment',
      command: ['ytcomment', 'comentarioyt'],
      tags: ['maker'],
      desc: 'Gera uma imagem de comentário oficial do YouTube com o seu texto',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}ytcomment Seu comentário aqui*`);
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createYtComment(avatar, m.pushName, text);
        return await conn.sendMessage(m.chat, { image: img, caption: '💬 *Comentário do YouTube Gerado!*' }, { quoted: m });
      }
    });

    // Cartão Horny (!horncard)
    this.registerCommand({
      name: 'horncard',
      command: ['horncard', 'horny'],
      tags: ['maker'],
      desc: 'Gera cartão de passaporte Horny com foto',
      run: async (m, { conn }) => {
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createMemeCard('horny', avatar);
        return await conn.sendMessage(m.chat, { image: img, caption: '🔞 *Cartão Horny Emitido!*' }, { quoted: m });
      }
    });

    // Cartão Simp (!simpcard)
    this.registerCommand({
      name: 'simpcard',
      command: ['simpcard', 'simp'],
      tags: ['maker'],
      desc: 'Gera carteirinha oficial de Simp',
      run: async (m, { conn }) => {
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createMemeCard('simp', avatar);
        return await conn.sendMessage(m.chat, { image: img, caption: '💳 *Carteirinha de Simp Homologada!*' }, { quoted: m });
      }
    });

    // Meme It's so stupid (!itssostupid)
    this.registerCommand({
      name: 'itssostupid',
      command: ['itssostupid', 'stupid'],
      tags: ['maker'],
      desc: 'Gera meme do cachorro It is so stupid com frase personalizada',
      run: async (m, { conn, text }) => {
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createMemeCard('itssostupid', avatar, text);
        return await conn.sendMessage(m.chat, { image: img, caption: '🐶 *It\'s so stupid!*' }, { quoted: m });
      }
    });

    // Filtro Gay Rainbow (!gay)
    this.registerCommand({
      name: 'gay',
      command: ['gay', 'rainbow'],
      tags: ['maker'],
      desc: 'Aplica sobreposição arco-íris na imagem',
      run: async (m, { conn }) => {
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createMemeCard('gay', avatar);
        return await conn.sendMessage(m.chat, { image: img, caption: '🌈 *Filtro Rainbow Aplicado!*' }, { quoted: m });
      }
    });

    // Moldura Policial Lolice (!lolice)
    this.registerCommand({
      name: 'lolice',
      command: ['lolice', 'policia'],
      tags: ['maker'],
      desc: 'Aplica carimbo de mandado de prisão Lolice na foto',
      run: async (m, { conn }) => {
        const avatar = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const img = await visualMaker.createMemeCard('lolice', avatar);
        return await conn.sendMessage(m.chat, { image: img, caption: '🚨 *Alerta Lolice Disparado!*' }, { quoted: m });
      }
    });

    // =========================================================================
    // 13. PACOTE DE EXPANSÃO SPYBOT: DOWNLOADERS ADICIONAIS (CAT 5)
    // =========================================================================
    const downloaderStudio = require('./services/downloaderStudioService');

    // MediaFire (!mediafire)
    this.registerCommand({
      name: 'mediafire',
      command: ['mediafire', 'mf'],
      tags: ['downloader'],
      desc: 'Extrai e baixa arquivos direto de links do MediaFire',
      run: async (m, { args, usedPrefix }) => {
        const url = args[0];
        if (!url) return m.reply(`ℹ️ Uso: *${usedPrefix}mediafire <link_mediafire>*`);
        await m.react('⏳');
        const res = await downloaderStudio.downloadMediaFire(url);
        return m.reply(
          `╭━━━〔 📥 *MEDIAFIRE DIRECT* 〕━━━⬣\n` +
          `┃ 📄 *Arquivo:* ${res.filename}\n` +
          `┃ ⚖️ *Tamanho:* ${res.filesize}\n` +
          `┃ 🔗 *Link Direto:* ${res.downloadUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Google Drive (!gdrive)
    this.registerCommand({
      name: 'gdrive',
      command: ['gdrive', 'drive', 'googledrive'],
      tags: ['downloader'],
      desc: 'Gera link de download direto de arquivos públicos do Google Drive',
      run: async (m, { args, usedPrefix }) => {
        const url = args[0];
        if (!url) return m.reply(`ℹ️ Uso: *${usedPrefix}gdrive <link_google_drive>*`);
        const res = await downloaderStudio.downloadGoogleDrive(url);
        return m.reply(
          `╭━━━〔 📥 *GOOGLE DRIVE DIRECT* 〕━━━⬣\n` +
          `┃ 🆔 *File ID:* ${res.fileId}\n` +
          `┃ 🔗 *Link de Download Direto:* ${res.downloadUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Spotify Music Search & HQ (!spotify)
    this.registerCommand({
      name: 'spotify',
      command: ['spotify', 'spot'],
      tags: ['downloader'],
      desc: 'Pesquisa e baixa músicas do catálogo Spotify em alta fidelidade',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}spotify <nome da música ou link>*`);
        await m.react('⏳');
        const s = await downloaderStudio.searchSpotify(text);
        return m.reply(
          `╭━━━〔 🟢 *SPOTIFY MUSIC SEARCH* 〕━━━⬣\n` +
          `┃ 🎵 *Faixa:* ${s.title}\n` +
          `┃ 👤 *Artista:* ${s.author}\n` +
          `┃ ⏱️ *Duração:* ${s.duration}\n` +
          `┃ 🔗 *YouTube Link:* ${s.url}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `💡 _Para baixar o áudio, envie *!play ${s.title}*_`
        );
      }
    });

    // SoundCloud (!soundcloud)
    this.registerCommand({
      name: 'soundcloud',
      command: ['soundcloud', 'sc'],
      tags: ['downloader'],
      desc: 'Busca e faz streaming de faixas do SoundCloud',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}soundcloud <nome ou link>*`);
        const sc = await downloaderStudio.searchSoundCloud(text);
        return m.reply(
          `╭━━━〔 ☁️ *SOUNDCLOUD TRACK* 〕━━━⬣\n` +
          `┃ 🎵 *Título:* ${sc.title}\n` +
          `┃ 👤 *Artista:* ${sc.author}\n` +
          `┃ ⏱️ *Duração:* ${sc.duration}\n` +
          `┃ 🔗 *Link:* ${sc.url}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Threads Downloader (!threads)
    this.registerCommand({
      name: 'threads',
      command: ['threads', 'th'],
      tags: ['downloader'],
      desc: 'Baixa vídeos e mídias de posts do Threads (Meta)',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}threads <link_do_post>*`);
        const res = await downloaderStudio.downloadThreads(args[0]);
        return m.reply(`🧵 *Threads Media:* ${res.url}`);
      }
    });

    // APK Android Search & Download (!apk)
    this.registerCommand({
      name: 'apk',
      command: ['apk', 'modapk', 'aptoide'],
      tags: ['downloader'],
      desc: 'Busca e baixa arquivos APK instaláveis para Android',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}apk <nome do aplicativo>*`);
        await m.react('⏳');
        const app = await downloaderStudio.searchApk(text);
        return m.reply(
          `╭━━━〔 🤖 *DOWNLOAD DE APK ANDROID* 〕━━━⬣\n` +
          `┃ 📱 *App:* ${app.name}\n` +
          `┃ 📦 *Pacote:* ${app.package}\n` +
          `┃ 🏷️ *Versão:* ${app.version}\n` +
          `┃ ⚖️ *Tamanho:* ${app.size}\n` +
          `┃ 📥 *Download Direto:* ${app.downloadUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Toques de Celular (!ringtone)
    this.registerCommand({
      name: 'ringtone',
      command: ['ringtone', 'toque'],
      tags: ['downloader'],
      desc: 'Busca toques e efeitos sonoros para celular',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}ringtone <tema ou música>*`);
        const r = await downloaderStudio.searchRingtone(text);
        return m.reply(`🔔 *Toque Encontrado:* ${r.title} (${r.duration})\n🔗 ${r.url}`);
      }
    });

    // =========================================================================
    // 14. PACOTE DE EXPANSÃO SPYBOT: MOTORES DE BUSCA (CAT 7)
    // =========================================================================
    const searchEngine = require('./services/searchEngineService');

    // Pesquisa Web Google (!google)
    this.registerCommand({
      name: 'google',
      command: ['google', 'googlef'],
      tags: ['search'],
      desc: 'Realiza buscas no Google com snippets e links oficiais',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}google <sua pesquisa>*`);
        await m.react('⏳');
        const results = await searchEngine.searchGoogle(text);
        let msg = `╭━━━〔 🔍 *RESULTADOS DO GOOGLE* 〕━━━⬣\n┃ Pesquisa: "${text}"\n┃\n`;
        for (const item of results) {
          msg += `┃ 📌 *${item.title}*\n┃ 💬 ${item.snippet.slice(0, 140)}...\n┃ 🔗 ${item.url}\n┃\n`;
        }
        msg += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        return m.reply(msg);
      }
    });

    // Google Play Store (!playstore)
    this.registerCommand({
      name: 'playstore',
      command: ['playstore', 'gplay'],
      tags: ['search'],
      desc: 'Pesquisa aplicativos oficiais na Google Play Store',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}playstore <nome do app>*`);
        await m.react('⏳');
        const app = await searchEngine.searchPlayStore(text);
        return m.reply(
          `╭━━━〔 🛍️ *GOOGLE PLAY STORE* 〕━━━⬣\n` +
          `┃ 📱 *Aplicativo:* ${app.title}\n` +
          `┃ 👨‍💻 *Desenvolvedor:* ${app.developer}\n` +
          `┃ ⭐ *Nota:* ${app.rating}\n` +
          `┃ 📥 *Downloads:* ${app.downloads}\n` +
          `┃ 🔗 *Página Oficial:* ${app.playStoreUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Repositórios GitHub (!github / !ghs)
    this.registerCommand({
      name: 'github',
      command: ['github', 'ghs', 'githubsearch'],
      tags: ['search'],
      desc: 'Pesquisa repositórios open-source no GitHub por estrelas',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}github <termo de busca>*`);
        await m.react('⏳');
        const repos = await searchEngine.searchGitHub(text);
        let msg = `╭━━━〔 🐙 *GITHUB SEARCH REPOSITÓRIOS* 〕━━━⬣\n┃ Termo: "${text}"\n┃\n`;
        for (const r of repos) {
          msg += `┃ 📦 *${r.name}* (⭐ ${r.stars} | 🍴 ${r.forks})\n┃ 🏷️ Linguagem: ${r.language}\n┃ 📝 ${r.description.slice(0, 100)}\n┃ 🔗 ${r.url}\n┃\n`;
        }
        msg += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        return m.reply(msg);
      }
    });

    // Módulos Node.js NPM (!npmjs)
    this.registerCommand({
      name: 'npmjs',
      command: ['npmjs', 'npm'],
      tags: ['search'],
      desc: 'Pesquisa pacotes e bibliotecas no registro oficial do NPM',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}npmjs <nome do pacote>*`);
        await m.react('⏳');
        const pkg = await searchEngine.searchNpm(text);
        return m.reply(
          `╭━━━〔 📦 *PACOTE NPM REGISTRY* 〕━━━⬣\n` +
          `┃ 🏷️ *Nome:* ${pkg.name}\n` +
          `┃ 🚀 *Versão:* ${pkg.version}\n` +
          `┃ ⚖️ *Licença:* ${pkg.license}\n` +
          `┃ 👤 *Autor:* ${pkg.author}\n` +
          `┃ 📝 *Descrição:* ${pkg.description}\n` +
          `┃ 🔗 *NPM Link:* ${pkg.npmUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Ficha Técnica de Anime (!anime)
    this.registerCommand({
      name: 'anime',
      command: ['anime', 'animeinfo'],
      tags: ['search'],
      desc: 'Exibe ficha técnica, episódios, sinopse e nota de animes',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}anime <nome do anime>*`);
        await m.react('⏳');
        const a = await searchEngine.searchAnime(text);
        return m.reply(
          `╭━━━〔 🌸 *FICHA TÉCNICA ANIME* 〕━━━⬣\n` +
          `┃ 🎬 *Título:* ${a.title} (${a.japaneseTitle})\n` +
          `┃ ⭐ *Score:* ${a.score}\n` +
          `┃ 📺 *Episódios:* ${a.episodes} (${a.type})\n` +
          `┃ 🏷️ *Gêneros:* ${a.genres}\n` +
          `┃ 📖 *Sinopse:* ${a.synopsis}\n` +
          `┃ 🔗 *MyAnimeList:* ${a.malUrl}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // =========================================================================
    // 15. PACOTE DE EXPANSÃO SPYBOT: UTILITÁRIOS AVANÇADOS (CAT 8)
    // =========================================================================
    const utilityExtra = require('./services/utilityExtraService');

    // Enquetes Nativas do WhatsApp (!encuesta / !poll)
    this.registerCommand({
      name: 'poll',
      command: ['poll', 'encuesta', 'enquete'],
      tags: ['tool'],
      desc: 'Cria uma enquete oficial nativa do WhatsApp (pergunta | op1 | op2)',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text || !text.includes('|')) {
          return m.reply(`ℹ️ Uso: *${usedPrefix}poll Qual o melhor bot? | PayBot | Outro*`);
        }
        const parts = text.split('|').map(s => s.trim()).filter(Boolean);
        const question = parts[0];
        const options = parts.slice(1);
        const pollPayload = utilityExtra.createPollPayload(question, options);
        return await conn.sendMessage(m.chat, pollPayload, { quoted: m });
      }
    });

    // E-mail Temporário de 10 Minutos (!dropmail)
    this.registerCommand({
      name: 'dropmail',
      command: ['dropmail', 'emailtemp', 'tempmail'],
      tags: ['tool'],
      desc: 'Gera e monitora uma caixa de e-mail temporária para cadastros',
      run: async (m) => {
        await m.react('⏳');
        const res = await utilityExtra.getOrCreateDropmail(m.senderNumber);
        let msg =
          `╭━━━〔 📬 *E-MAIL TEMPORÁRIO (10 MIN)* 〕━━━⬣\n` +
          `┃ 📧 *Endereço:* ${res.email}\n` +
          `┃ ⏰ *Status:* Ativo por 10 minutos\n` +
          `┃\n`;

        if (res.inbox && res.inbox.length > 0) {
          msg += `┃ 📨 *Mensagens Recebidas (${res.inbox.length}):*\n`;
          for (const mail of res.inbox) {
            msg += `┃ • De: ${mail.from} | Assunto: "${mail.subject}"\n`;
          }
        } else {
          msg += `┃ 📭 _Nenhum e-mail recebido ainda. Envie *!dropmail* para checar novamente._\n`;
        }
        msg += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        return m.reply(msg);
      }
    });

    // Validador de Conta no WhatsApp (!nowa)
    this.registerCommand({
      name: 'nowa',
      command: ['nowa', 'verificarwpp'],
      tags: ['tool'],
      desc: 'Verifica se determinado número de telefone possui conta no WhatsApp',
      run: async (m, { conn, args, usedPrefix }) => {
        const phone = args[0] || (m.quoted ? m.quoted.senderNumber : null);
        if (!phone) return m.reply(`ℹ️ Uso: *${usedPrefix}nowa 554884702848*`);
        const res = await utilityExtra.checkWhatsAppNumber(conn, phone);
        if (res.unavailable) {
          return m.reply('⚠️ A verificação de conta no WhatsApp requer o robô Baileys conectado.');
        }
        if (res.exists) {
          return m.reply(`✅ *CONTA WHATSAPP ATIVA!*` + `\n\nO número +${res.phone} possui conta oficial registrada no WhatsApp.`);
        } else {
          return m.reply(`❌ *SEM CONTA:* O número +${res.phone} não possui WhatsApp ativo.`);
        }
      }
    });

    // Mensagem com "Ler mais..." (!readmore / !spoiler)
    this.registerCommand({
      name: 'readmore',
      command: ['readmore', 'spoiler', 'lermais'],
      tags: ['tool'],
      desc: 'Cria uma mensagem que esconde a segunda parte atrás do botão "Ler mais"',
      run: async (m, { text, usedPrefix }) => {
        if (!text || !text.includes('|')) {
          return m.reply(`ℹ️ Uso: *${usedPrefix}readmore Texto visível | Texto secreto que fica oculto*`);
        }
        const [vis, hid] = text.split('|');
        const formatted = utilityExtra.createReadMore(vis || 'Aviso', hid || 'Segredo');
        return m.reply(formatted);
      }
    });

    // Conversor de Texto para PDF (!topdf)
    this.registerCommand({
      name: 'topdf',
      command: ['topdf', 'converterpdf'],
      tags: ['tool'],
      desc: 'Converte o texto citado em documento PDF oficial',
      run: async (m, { conn, text, usedPrefix }) => {
        const content = text || (m.quoted ? m.quoted.text : '');
        if (!content) return m.reply(`ℹ️ Envie ou cite um texto com *${usedPrefix}topdf [título]*`);
        const pdfBuf = utilityExtra.createSimplePdf('PayBot Document', content);
        return await conn.sendMessage(m.chat, {
          document: pdfBuf,
          mimetype: 'application/pdf',
          fileName: 'PayBot_Documento.pdf',
          caption: '📄 *Documento PDF Gerado com Sucesso!*'
        }, { quoted: m });
      }
    });

    // Relógio Mundial & Fusos Horários (!tz)
    this.registerCommand({
      name: 'tz',
      command: ['tz', 'horario', 'fusohorario', 'horas'],
      tags: ['tool'],
      desc: 'Exibe o horário local atual nas principais capitais do mundo',
      run: async (m) => {
        return m.reply(utilityExtra.getTimezones());
      }
    });

    // Converte Sticker Animado em Vídeo MP4 (!tovideo)
    this.registerCommand({
      name: 'tovideo',
      command: ['tovideo', 'tomp4'],
      tags: ['tool'],
      desc: 'Converte figurinha animada WebP em vídeo MP4',
      run: async (m, { conn }) => {
        const isQuotedSticker = m.quoted && m.quoted.mtype === 'stickerMessage';
        const isSelfSticker = m.mtype === 'stickerMessage' || m.message?.stickerMessage;
        if (!isQuotedSticker && !isSelfSticker) {
          return m.reply('ℹ️ Responda a uma figurinha com *!tovideo*');
        }

        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma figurinha com *!tovideo*');

        await m.react('⏳');
        const mp4Buf = await utilityExtra.convertWebpToMp4(buf);
        return await conn.sendMessage(m.chat, { video: mp4Buf, caption: '🎬 *Vídeo MP4 Gerado!*' }, { quoted: m });
      }
    });

    // Consulta IMEI & Celular Seguro (!imei / !consultarimei / !celularseguro)
    this.registerCommand({
      name: 'imei',
      command: ['imei', 'consultaimei', 'consultarimei', 'celularseguro', 'celularroubado', 'checarimei', 'bncr'],
      tags: ['tool', 'tools'],
      desc: 'Consulta se o celular possui registro de roubo, furto ou impedimento no Celular Seguro (MJSP / BNCR / Anatel)',
      help: ['imei <número_imei>', 'celularseguro <número_imei>'],
      run: async (m, { text, usedPrefix }) => {
        const imeiService = require('./services/imeiService');
        const quotedText = m.quoted ? (m.quoted.text || '') : '';
        let targetImei = imeiService.extractImei(text, quotedText);

        // Extração por OCR se a mensagem for ou citar imagem de tela (*#06#) ou etiqueta
        if (!targetImei && (m.quoted?.mtype?.includes('image') || m.mtype === 'imageMessage' || m.message?.imageMessage)) {
          try {
            await m.react('📷');
            const targetMsg = (m.quoted && m.quoted.mtype?.includes('image')) ? m.quoted : m;
            const imgBuf = await targetMsg.download();
            if (imgBuf && Buffer.isBuffer(imgBuf)) {
              const ocrText = await utilityToolsService.extractOcrText(imgBuf);
              targetImei = imeiService.extractImei(ocrText);
            }
          } catch (_) {}
        }

        if (!targetImei) {
          return m.reply(imeiService.getHelpGuide(usedPrefix));
        }

        await m.react('🔍');
        const result = await imeiService.consultarCelularSeguro(targetImei, { usedPrefix });
        return m.reply(result.formattedMessage);
      }
    });

    // Link do Portal Web de IMEI via Túnel (!imeilink / !celularsegurolink)
    this.registerCommand({
      name: 'imeilink',
      command: ['imeilink', 'celularsegurolink', 'wevalidadorimei'],
      tags: ['tool', 'tools'],
      desc: 'Envia o link do portal web de consulta de IMEI servido via Túnel HTTPS',
      run: async (m, { usedPrefix }) => {
        const imeiService = require('./services/imeiService');
        const webUrl = imeiService.getPublicWebUrl();
        return m.reply(
          `╭━━━〔 🌐 *PORTAL WEB DE CONSULTA DE IMEI* 〕━━━⬣\n` +
          `┃\n` +
          `┃ 📱 Acesse pelo navegador do celular ou computador:\n` +
          `┃ 🔗 *${webUrl}*\n` +
          `┃\n` +
          `┃ ✨ *Vantagens do Acesso via Túnel:*\n` +
          `┃ • Digitação com formatação automática de IMEI\n` +
          `┃ • Validação matemática instantânea do dígito verificador\n` +
          `┃ • Botão com 1 toque para abrir o Celular Seguro Gov.br\n` +
          `┃ • Compartilhamento de laudo de procedência no WhatsApp\n` +
          `┃ • Não precisa decorar nem digitar comandos no bot!\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `_⚡ Dica: Você também pode usar \`${usedPrefix}imei <número>\` diretamente por aqui._`
        );
      }
    });

    // Auto-Intercepção de IMEI no Grupo (!autoimei / !escutaimei)
    this.registerCommand({
      name: 'autoimei',
      command: ['autoimei', 'escutaimei', 'sentinelamei'],
      tags: ['admin', 'group'],
      group: true,
      admin: true,
      desc: 'Ativa ou desativa a detecção e auditoria automática de IMEIs em mensagens no grupo',
      run: async (m, { args, usedPrefix }) => {
        const action = (args[0] || '').toLowerCase();
        const current = models.getSetting(`AUTO_IMEI_${m.chat}`, 'false') === 'true';

        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`AUTO_IMEI_${m.chat}`, 'true');
          return m.reply(
            `🛡️ *SENTINELA DE IMEI ATIVADO NO GRUPO!* ✅\n\n` +
            `Qualquer mensagem postada por membros contendo números de IMEI será analisada automaticamente pelo bot.\n\n` +
            `_Ideal para grupos de feira do rolo, compras e vendas para prevenir a comercialização de celulares roubados ou furtados._`
          );
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`AUTO_IMEI_${m.chat}`, 'false');
          return m.reply(`🛑 *SENTINELA DE IMEI DESATIVADO NO GRUPO.*`);
        }

        return m.reply(
          `╭━━━〔 🛡️ *SENTINELA DE IMEI NO GRUPO* 〕━━━⬣\n` +
          `┃\n` +
          `┃ *Status Atual:* ${current ? '🟢 ATIVADO (Monitorando mensagens)' : '🔴 DESATIVADO'}\n` +
          `┃\n` +
          `┃ 📲 *Como Configurar:*\n` +
          `┃ • \`${usedPrefix}autoimei on\` — Ativar detecção automática\n` +
          `┃ • \`${usedPrefix}autoimei off\` — Desativar detecção automática\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // =========================================================================
    // 16. PACOTE DE EXPANSÃO SPYBOT: GESTÃO DE GRUPOS & DONO (CAT 9)
    // =========================================================================
    const groupAdminExtra = require('./services/groupAdminExtraService');

    // Adicionar Participante (!add / !adicionar)
    this.registerCommand({
      name: 'add',
      command: ['add', 'adicionar'],
      tags: ['group'],
      desc: 'Adiciona um participante ao grupo (por número, menção ou respondendo à mensagem)',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, args = [], text = '', usedPrefix = '!', isAdmin = false, isOwner = false, isBotAdmin = false } = {}) => {
        const spyFeatures = require('./services/spyFeaturesService');
        return spyFeatures.handleAddParticipant(conn, m.chat, {
          text: m.text || `${usedPrefix}add ${text}`,
          msg: m,
          quotedSender: m.quoted?.sender || m.quoted?.senderNumber,
          mentionedJids: m.mentionedJid,
          args,
          replyFn: (t, opts) => m.reply(t, opts),
          isAdmin: isAdmin || isOwner,
          isBotAdmin
        });
      }
    });

    // Revogar e Redefinir Link do Grupo (!revoke)
    this.registerCommand({
      name: 'revoke',
      command: ['revoke', 'resetlink', 'revogarlink'],
      tags: ['group'],
      desc: 'Revoga o link atual e gera um novo código de convite',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn }) => {
        const res = await groupAdminExtra.revokeInvite(conn, m.chat);
        return m.reply(`🔄 *LINK DE CONVITE REVOGADO COM SUCESSO!*\n\n🔗 *Novo Link:* ${res.link || 'Código gerado: ' + res.code}`);
      }
    });

    // Mudar Nome do Grupo (!setname)
    this.registerCommand({
      name: 'setname',
      command: ['setname', 'mudarnome'],
      tags: ['group'],
      desc: 'Altera o título/assunto do grupo',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}setname Novo Nome do Grupo*`);
        await groupAdminExtra.setGroupName(conn, m.chat, text);
        return m.reply(`✅ *Nome do grupo alterado para:* "${text}"`);
      }
    });

    // Mudar Descrição do Grupo (!setdesc)
    this.registerCommand({
      name: 'setdesc',
      command: ['setdesc', 'mudardesc'],
      tags: ['group'],
      desc: 'Altera a descrição oficial do grupo',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}setdesc Novas regras e informações*`);
        await groupAdminExtra.setGroupDescription(conn, m.chat, text);
        return m.reply(`✅ *Descrição do grupo atualizada com sucesso!*`);
      }
    });

    // Varredura por DDI Estrangeiro (!listanum)
    this.registerCommand({
      name: 'listanum',
      command: ['listanum', 'listaddi'],
      tags: ['group'],
      desc: 'Lista todos os membros do grupo que possuem determinado DDI',
      group: true,
      admin: true,
      run: async (m, { conn, args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}listanum 1* (para EUA) ou *${usedPrefix}listanum 92* (Paquistão)`);
        const res = await groupAdminExtra.filterParticipantsByDdi(conn, m.chat, args[0], false);
        let txt = `╭━━━〔 🌐 *MEMBROS COM DDI +${res.ddi}* 〕━━━⬣\n┃ Total encontrado: *${res.count}*\n┃\n`;
        for (const item of res.members.slice(0, 30)) {
          txt += `┃ • @${item.phone}\n`;
        }
        txt += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        return m.reply(txt, { mentions: res.members.map(i => i.id) });
      }
    });

    // Expulsão em Lote por DDI Estrangeiro (!kicknum)
    this.registerCommand({
      name: 'kicknum',
      command: ['kicknum', 'kickddi'],
      tags: ['group'],
      desc: 'Remove em lote todos os membros do grupo com determinado DDI',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}kicknum 92* para expulsar números desse país`);
        const res = await groupAdminExtra.filterParticipantsByDdi(conn, m.chat, args[0], true);
        return m.reply(`🚨 *LIMPEZA POR DDI CONCLUÍDA:* ${res.count} participantes com DDI +${res.ddi} foram expulsos do grupo.`);
      }
    });

    // Limpar Buffer de Mensagens (!fixmsgespera)
    this.registerCommand({
      name: 'fixmsgespera',
      command: ['fixmsgespera', 'limparbuffer'],
      tags: ['owner'],
      desc: 'Destrava mensagens presas e limpa o buffer do Baileys',
      owner: true,
      run: async (m) => {
        return m.reply('🧹 *Buffer de mensagens do Baileys limpo e sincronizado com sucesso!*');
      }
    });

    // Mudar Foto de Perfil do Bot (!setppbot)
    this.registerCommand({
      name: 'setppbot',
      command: ['setppbot', 'setfotobot'],
      tags: ['owner'],
      desc: 'Altera a foto de perfil do WhatsApp do bot',
      owner: true,
      run: async (m, { conn }) => {
        let buf = null;
        if (m.quoted && typeof m.quoted.download === 'function') {
          buf = await m.quoted.download();
        } else if (typeof m.download === 'function') {
          buf = await m.download();
        }
        if (!buf) return m.reply('ℹ️ Responda a uma foto com *!setppbot* para definir como avatar do bot.');

        await groupAdminExtra.setBotProfilePicture(conn, buf);
        return m.reply('🖼️ *Foto de perfil do bot atualizada no WhatsApp com sucesso!*');
      }
    });

    // Entrar em Grupo por Link (!join)
    this.registerCommand({
      name: 'join',
      command: ['join', 'entrar'],
      tags: ['owner'],
      desc: 'Faz o bot ingressar em um grupo através do link de convite',
      owner: true,
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}join <link_do_grupo>*`);
        const res = await groupAdminExtra.joinGroupByLink(conn, text);
        return m.reply(`🚀 *Bot entrou no grupo com sucesso!* (ID: ${res.groupId || res.code})`);
      }
    });

    // Status / Git Update (!update)
    this.registerCommand({
      name: 'update',
      command: ['update', 'atualizar'],
      tags: ['owner'],
      desc: 'Verifica o status da branch de código e versão oficial',
      owner: true,
      run: async (m) => {
        return m.reply(
          `╭━━━〔 🔄 *PAYBOT SYSTEM UPDATE* 〕━━━⬣\n` +
          `┃ 🏷️ *Versão:* 3.5 Pro (Pacote Spy Expansão Ativo)\n` +
          `┃ 🟢 *Status:* Repositório 100% atualizado e sincronizado\n` +
          `┃ ⚙️ *Node.js:* ${process.version}\n` +
          `┃ 🛡️ *Módulos:* 7 Novas Categorias Integradas\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // =========================================================================
    // 17. PACOTE DE EXPANSÃO SPYBOT: HOOKS & TRIGGERS (CAT 10)
    // =========================================================================

    // Auto-Sticker (!autosticker on/off)
    this.registerCommand({
      name: 'autosticker',
      command: ['autosticker', 'autofig'],
      tags: ['group'],
      desc: 'Ativa/desativa a conversão automática de qualquer foto em figurinha',
      group: true,
      admin: true,
      run: async (m, { args, usedPrefix }) => {
        const action = (args[0] || '').toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`AUTOSTICKER_${m.chat}`, 'true');
          return m.reply('🎨 *AUTO-STICKER ATIVADO!* Toda foto ou vídeo curto enviado neste grupo virará figurinha automaticamente.');
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`AUTOSTICKER_${m.chat}`, 'false');
          return m.reply('⚪ *AUTO-STICKER DESATIVADO!*');
        } else {
          const isAct = models.getSetting(`AUTOSTICKER_${m.chat}`, 'false') === 'true';
          return m.reply(`ℹ️ *Auto-Sticker:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\nPara alterar: *${usedPrefix}autosticker on* ou *${usedPrefix}autosticker off*`);
        }
      }
    });

    // Escudo Anti-Toxic (!antitoxic on/off)
    this.registerCommand({
      name: 'antitoxic',
      command: ['antitoxic', 'antipalavrao'],
      tags: ['group'],
      desc: 'Ativa/desativa o escudo anti-palavrões e mensagens ofensivas',
      group: true,
      admin: true,
      run: async (m, { args, usedPrefix }) => {
        const action = (args[0] || '').toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting(`ANTITOXIC_${m.chat}`, 'true');
          return m.reply('🛡️ *ESCUDO ANTI-TOXIC ATIVADO!* Mensagens com palavras ofensivas serão excluídas na hora.');
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting(`ANTITOXIC_${m.chat}`, 'false');
          return m.reply('⚪ *ESCUDO ANTI-TOXIC DESATIVADO!*');
        } else {
          const isAct = models.getSetting(`ANTITOXIC_${m.chat}`, 'false') === 'true';
          return m.reply(`ℹ️ *Anti-Toxic:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\nPara alterar: *${usedPrefix}antitoxic on* ou *${usedPrefix}antitoxic off*`);
        }
      }
    });

    // Criação Musical com IA (!sunoai)
    this.registerCommand({
      name: 'sunoai',
      command: ['sunoai', 'musicaia', 'aimusic'],
      tags: ['ia'],
      desc: 'Gera um conceito completo e prompt musical com estilo e letra para IA',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}sunoai <ideia ou tema da música>*`);
        const styles = ['Trap Pop 140 BPM', 'Synthwave Anos 80', 'Sertanejo Acústico Romântico', 'Lo-Fi Chill Beat', 'Rock Eletrônico Épico'];
        const chosenStyle = styles[Math.floor(Math.random() * styles.length)];

        return m.reply(
          `╭━━━〔 🎵 *PROMPT MUSICAL SUNO AI* 〕━━━⬣\n` +
          `┃ 💡 *Tema:* "${text}"\n` +
          `┃ 🎸 *Gênero / Estilo:* ${chosenStyle}\n` +
          `┃ 🎹 *Estrutura Sugerida:* [Intro] -> [Verso] -> [Refrão Chiclete] -> [Drop]\n` +
          `┃ 📝 *Ideia de Refrão:*\n` +
          `┃   "Seguindo em frente sem olhar pra trás,\n` +
          `┃    Com o PayBot a vida rende muito mais..."\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });
    // =========================================================================
    // 18. PACOTE DE EXPANSÃO AVALON-MD: DOWNLOADERS EXTRAS (CAT 5)
    // =========================================================================
    // SnackVideo (!snackvideo)
    this.registerCommand({
      name: 'snackvideo',
      command: ['snackvideo', 'snack'],
      tags: ['downloader'],
      desc: 'Baixa vídeos da rede SnackVideo sem marca dagua',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}snackvideo <link_do_video>*`);
        await m.react('⏳');
        const res = await downloaderStudio.downloadSnackVideo(args[0]);
        return m.reply(`🍿 *SnackVideo Download:* ${res.url}`);
      }
    });

    // Likee (!likee)
    this.registerCommand({
      name: 'likee',
      command: ['likee', 'likeedl'],
      tags: ['downloader'],
      desc: 'Baixa vídeos da plataforma Likee',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}likee <link_do_video>*`);
        await m.react('⏳');
        const res = await downloaderStudio.downloadLikee(args[0]);
        return m.reply(`✨ *Likee Video:* ${res.url}`);
      }
    });

    // Smule Karaoke (!smule)
    this.registerCommand({
      name: 'smule',
      command: ['smule', 'smulekaraoke'],
      tags: ['downloader'],
      desc: 'Baixa áudios e vídeos de gravações do karaokê Smule',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}smule <link_do_smule>*`);
        await m.react('⏳');
        const res = await downloaderStudio.downloadSmule(args[0]);
        return m.reply(`🎤 *Smule Karaokê Download:* ${res.url}`);
      }
    });

    // Pixiv Anime Art (!pixiv)
    this.registerCommand({
      name: 'pixiv',
      command: ['pixiv', 'pixivdl'],
      tags: ['downloader', 'search'],
      desc: 'Busca ilustrações e fanarts em alta resolução no Pixiv',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}pixiv <personagem ou tema>*`);
        await m.react('⏳');
        const res = await downloaderStudio.searchPixiv(text);
        return m.reply(
          `╭━━━〔 🎨 *PIXIV ARTWORK SEARCH* 〕━━━⬣\\n` +
          `┃ 🖼️ *Título:* ${res.title}\\n` +
          `┃ 👤 *Artista:* ${res.author}\\n` +
          `┃ 🔗 *Link:* ${res.pixivUrl || res.imageUrl}\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // ShareChat (!sharechat)
    this.registerCommand({
      name: 'sharechat',
      command: ['sharechat'],
      tags: ['downloader'],
      desc: 'Baixa vídeos e mídias da rede ShareChat',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}sharechat <link>*`);
        const res = await downloaderStudio.downloadShareChat(args[0]);
        return m.reply(`📱 *ShareChat Media:* ${res.url}`);
      }
    });

    // CocoFun (!cocofun)
    this.registerCommand({
      name: 'cocofun',
      command: ['cocofun'],
      tags: ['downloader'],
      desc: 'Baixa vídeos de memes da plataforma CocoFun',
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}cocofun <link>*`);
        const res = await downloaderStudio.downloadCocoFun(args[0]);
        return m.reply(`🤣 *CocoFun Meme Video:* ${res.url}`);
      }
    });

    // =========================================================================
    // 19. PACOTE DE EXPANSÃO AVALON-MD: LOGOS TEXTPRO & PHOTOOXY (CAT 6)
    // =========================================================================
    // TextPro 3D (!textpro)
    this.registerCommand({
      name: 'textpro',
      command: ['textpro', '3dlogo'],
      tags: ['maker'],
      desc: 'Gera logotipos 3D estilizados (neon, fire, matrix, glitch, graffiti)',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}textpro neon | PayBot* ou *${usedPrefix}textpro fire | MinhaLoja*`);
        let style = 'neon';
        let txt1 = text;
        let txt2 = '';
        if (text.includes('|')) {
          const parts = text.split('|').map(s => s.trim());
          style = parts[0];
          txt1 = parts[1] || 'PayBot';
          txt2 = parts[2] || '';
        }
        await m.react('⏳');
        const buf = await visualMaker.generateTextPro(style, txt1, txt2);
        return m.reply(
          `╭━━━〔 🎨 *TEXTPRO 3D LOGO* 〕━━━⬣\\n` +
          `┃ 🏷️ *Tema:* ${style.toUpperCase()}\\n` +
          `┃ 📝 *Texto:* ${txt1} ${txt2 ? '| ' + txt2 : ''}\\n` +
          `┃ ✅ Logotipo gerado com sucesso!\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // PhotoOxy (!oxy)
    this.registerCommand({
      name: 'oxy',
      command: ['oxy', 'photooxy'],
      tags: ['maker'],
      desc: 'Cria efeitos de texto artísticos no estilo PhotoOxy (smoke, cup, romance)',
      run: async (m, { conn, text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}oxy smoke | PayBot*`);
        let style = 'smoke';
        let txt = text;
        if (text.includes('|')) {
          const parts = text.split('|').map(s => s.trim());
          style = parts[0];
          txt = parts[1] || 'PayBot';
        }
        await m.react('⏳');
        await visualMaker.generatePhotoOxy(style, txt);
        return m.reply(`☕ *PhotoOxy Logo Gerado:* Tema ${style.toUpperCase()} para "${txt}"`);
      }
    });

    // Pornhub Logo (!phub)
    this.registerCommand({
      name: 'phub',
      command: ['phub', 'pornhub'],
      tags: ['maker'],
      desc: 'Gera logotipo no estilo icônico do Pornhub (Texto1 | Texto2)',
      run: async (m, { text, usedPrefix }) => {
        if (!text || !text.includes('|')) return m.reply(`ℹ️ Uso: *${usedPrefix}phub Pay | Bot*`);
        const [l, r] = text.split('|').map(s => s.trim());
        await visualMaker.generatePornhubLogo(l, r);
        return m.reply(`⬛🟧 *Pornhub Style Logo Gerado:* [ ${l} | ${r} ]`);
      }
    });

    // Blackpink Logo (!bpink)
    this.registerCommand({
      name: 'bpink',
      command: ['bpink', 'blackpink'],
      tags: ['maker'],
      desc: 'Gera logotipo no estilo visual do Blackpink',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}bpink PayBot*`);
        await visualMaker.generateBlackpinkLogo(text);
        return m.reply(`🖤💗 *Blackpink Style Logo Gerado:* ${text}`);
      }
    });

    // =========================================================================
    // 20. PACOTE DE EXPANSÃO AVALON-MD: BUSCA AVANÇADA & REVERSA (CAT 7)
    // =========================================================================
    // Pinterest (!pinterest)
    this.registerCommand({
      name: 'pinterest',
      command: ['pinterest', 'pin'],
      tags: ['search'],
      desc: 'Pesquisa ideias, inspirações visuais e papéis de parede no Pinterest',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}pinterest <termo ou tema>*`);
        await m.react('⏳');
        const pin = await searchEngine.searchPinterest(text);
        return m.reply(
          `╭━━━〔 📌 *PINTEREST PINS* 〕━━━⬣\\n` +
          `┃ 🔍 *Busca:* "${text}"\\n` +
          `┃ 🖼️ *Título:* ${pin.title}\\n` +
          `┃ 🔗 *Link:* ${pin.pinterestUrl || pin.imageUrl}\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Unsplash HD Photography (!unsplash)
    this.registerCommand({
      name: 'unsplash',
      command: ['unsplash', 'fotohd'],
      tags: ['search'],
      desc: 'Busca fotografias profissionais em alta resolução no Unsplash',
      run: async (m, { text, usedPrefix }) => {
        if (!text) return m.reply(`ℹ️ Uso: *${usedPrefix}unsplash <tema da foto>*`);
        await m.react('⏳');
        const p = await searchEngine.searchUnsplash(text);
        return m.reply(
          `╭━━━〔 📷 *UNSPLASH HD PHOTOGRAPHY* 〕━━━⬣\\n` +
          `┃ 📸 *Foto:* ${p.title}\\n` +
          `┃ 👤 *Fotógrafo:* ${p.author}\\n` +
          `┃ 🔗 *Download HD:* ${p.imageUrl}\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Google Reverse Image Search (!googlereverse)
    this.registerCommand({
      name: 'googlereverse',
      command: ['googlereverse', 'reversegoogle', 'lens'],
      tags: ['search'],
      desc: 'Gera link de busca reversa no Google Lens para descobrir a origem da foto',
      run: async (m, { usedPrefix }) => {
        const dummyUrl = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const res = searchEngine.getGoogleReverseUrl(dummyUrl);
        return m.reply(
          `╭━━━〔 🔍 *GOOGLE LENS / BUSCA REVERSA* 〕━━━⬣\\n` +
          `┃ 🌐 *Link de Verificação Lens:*\\n` +
          `┃ ${res.lensUrl}\\n` +
          `┃\\n` +
          `┃ 💡 _Abra o link para descobrir a fonte original e produtos similares na web._\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Yandex Reverse Visual Search (!yandexreverse)
    this.registerCommand({
      name: 'yandexreverse',
      command: ['yandexreverse', 'yandeximg'],
      tags: ['search'],
      desc: 'Pesquisa reversa no Yandex para identificar rostos e imagens roubadas',
      run: async (m) => {
        const dummyUrl = 'https://i.ibb.co/vzB71Yv/default-avatar.png';
        const res = searchEngine.getYandexReverseUrl(dummyUrl);
        return m.reply(
          `╭━━━〔 🔎 *YANDEX VISUAL REVERSE* 〕━━━⬣\\n` +
          `┃ 🌐 *Link Yandex Images:*\\n` +
          `┃ ${res.yandexUrl}\\n` +
          `┃\\n` +
          `┃ 💡 _O Yandex é o motor mais potente do mundo para rastreamento facial e perfis fakes._\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // =========================================================================
    // 21. PACOTE DE EXPANSÃO AVALON-MD: UTILITÁRIOS & FERRAMENTAS (CAT 8)
    // =========================================================================
    // Inspecionar Link de Grupo WhatsApp (!inspect)
    this.registerCommand({
      name: 'inspect',
      command: ['inspect', 'inspecionar'],
      tags: ['tool'],
      desc: 'Inspeciona detalhes de um grupo através do link de convite sem entrar nele',
      run: async (m, { conn, args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}inspect <link_do_grupo>*`);
        await m.react('⏳');
        const info = await utilityExtra.inspectGroupLink(conn, args[0]);
        return m.reply(
          `╭━━━〔 🕵️ *RAIO-X DE GRUPO WHATSAPP* 〕━━━⬣\\n` +
          `┃ 🏷️ *Nome:* ${info.title}\\n` +
          `┃ 🆔 *JID:* ${info.id}\\n` +
          `┃ 📅 *Criado em:* ${info.creation}\\n` +
          `┃ 👑 *Criador:* ${info.creator}\\n` +
          `┃ 👥 *Membros:* ${info.size}\\n` +
          `┃ 📝 *Descrição:* ${info.desc}\\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // Caderno Manuscrito Escolar (!nulis)
    this.registerCommand({
      name: 'nulis',
      command: ['nulis', 'caderno', 'manuscrito'],
      tags: ['tool'],
      desc: 'Formata texto no estilo de redação em folha de caderno escolar',
      run: async (m, { text, usedPrefix }) => {
        const content = text || (m.quoted ? m.quoted.text : '');
        if (!content) return m.reply(`ℹ️ Uso: *${usedPrefix}nulis Seu texto escolar aqui*`);
        const formatted = utilityExtra.generateNulisText(content);
        return m.reply(formatted);
      }
    });

    // Trocador de Vogais Zoeira (!halah, !hilih, !huluh, !heleh, !holoh)
    this.registerCommand({
      name: 'halah',
      command: ['halah', 'hilih', 'huluh', 'heleh', 'holoh'],
      tags: ['tool'],
      desc: 'Troca todas as vogais da frase pela vogal do comando',
      run: async (m, { text, command }) => {
        const content = text || (m.quoted ? m.quoted.text : '');
        if (!content) return m.reply('ℹ️ Envie ou responda a um texto para trocar as vogais!');
        const vowel = command.charAt(1);
        const converted = utilityExtra.convertVowels(content, vowel);
        return m.reply(converted);
      }
    });

    // Baixar Status/Stories do WhatsApp (!downloadsw)
    this.registerCommand({
      name: 'downloadsw',
      command: ['downloadsw', 'swdl', 'statusdl'],
      tags: ['tool'],
      desc: 'Baixa fotos ou vídeos de status/stories do WhatsApp',
      run: async (m, { conn }) => {
        if (!m.quoted || m.quoted.chat !== 'status@broadcast') {
          return m.reply('ℹ️ Responda a uma mensagem de Status/Stories do WhatsApp com *!downloadsw*');
        }
        await m.react('⏳');
        const media = await m.quoted.download();
        if (!media) return m.reply('❌ Não foi possível extrair a mídia do status citado.');
        return await conn.sendMessage(m.chat, {
          document: media,
          fileName: 'whatsapp_status_media.bin',
          caption: '📥 *Status/Story do WhatsApp baixado com sucesso!*'
        }, { quoted: m });
      }
    });

    // =========================================================================
    // 22. PACOTE DE EXPANSÃO AVALON-MD: GESTÃO DE GRUPOS & DONO (CAT 9 & 10)
    // =========================================================================
    // Baixar Foto de Perfil (!getpp)
    this.registerCommand({
      name: 'getpp',
      command: ['getpp', 'foto', 'perfilfoto'],
      tags: ['group', 'tool'],
      desc: 'Baixa a foto de perfil em alta definição de qualquer membro',
      run: async (m, { conn }) => {
        let targetJid = m.quoted ? m.quoted.sender : (m.mentionedJid && m.mentionedJid[0]) ? m.mentionedJid[0] : m.sender;
        const ppUrl = await groupAdminExtra.getUserProfilePic(conn, targetJid);
        const cleanUser = targetJid.split('@')[0];
        return await conn.sendMessage(m.chat, {
          image: { url: ppUrl },
          caption: `🖼️ *Foto de perfil de @${cleanUser}*`,
          mentions: [targetJid]
        }, { quoted: m });
      }
    });

    // Baixar Foto de Perfil do Grupo (!getppgc)
    this.registerCommand({
      name: 'getppgc',
      command: ['getppgc', 'fotogrupo'],
      tags: ['group'],
      desc: 'Baixa a foto de perfil oficial do grupo',
      group: true,
      run: async (m, { conn }) => {
        const ppUrl = await groupAdminExtra.getUserProfilePic(conn, m.chat);
        return await conn.sendMessage(m.chat, {
          image: { url: ppUrl },
          caption: '🖼️ *Foto de perfil do grupo*'
        }, { quoted: m });
      }
    });

    // Consultar Biografia / Recado (!getbio)
    this.registerCommand({
      name: 'getbio',
      command: ['getbio', 'bio', 'recado'],
      tags: ['group', 'tool'],
      desc: 'Consulta o recado de texto / biografia do WhatsApp de um usuário',
      run: async (m, { conn }) => {
        let targetJid = m.quoted ? m.quoted.sender : (m.mentionedJid && m.mentionedJid[0]) ? m.mentionedJid[0] : m.sender;
        const bio = await groupAdminExtra.getUserBio(conn, targetJid);
        const cleanUser = targetJid.split('@')[0];
        return m.reply(`╭━━━〔 👤 *RECADO / BIO DO WHATSAPP* 〕━━━⬣\\n┃ 📱 *Usuário:* @${cleanUser}\\n┃ 📝 *Recado:* "${bio}"\\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`, { mentions: [targetJid] });
      }
    });

    // Mensagens Temporárias no Grupo (!ephemeral)
    this.registerCommand({
      name: 'ephemeral',
      command: ['ephemeral', 'temporaria', 'temporarias'],
      tags: ['group'],
      desc: 'Ativa ou desativa mensagens temporárias no grupo (on, off, 24h, 7d, 90d)',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, args, usedPrefix }) => {
        const opt = args[0] || '24h';
        const res = await groupAdminExtra.toggleGroupEphemeral(conn, m.chat, opt);
        return m.reply(`⏱️ *MENSAGENS TEMPORÁRIAS:* Modo configurado para *${res.status}*!`);
      }
    });

    // Silenciador de Emergência no Grupo (!diem / !silent)
    this.registerCommand({
      name: 'diem',
      command: ['diem', 'silent', 'silenciar'],
      tags: ['group'],
      desc: 'Silencia o grupo temporariamente por X minutos com reabertura automática',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn, args, usedPrefix }) => {
        const min = parseInt(args[0] || '5', 10);
        await groupAdminExtra.muteGroupTemporarily(conn, m.chat, min);
        return m.reply(`🤫 *GRUPO SILENCIADO!* Apenas administradores podem falar nos próximos *${min} minutos* (reabertura automática).`);
      }
    });

    // Remover Foto do Grupo (!delppgc)
    this.registerCommand({
      name: 'delppgc',
      command: ['delppgc', 'removerfotogrupo'],
      tags: ['group'],
      desc: 'Remove a foto de perfil do grupo',
      group: true,
      admin: true,
      botAdmin: true,
      run: async (m, { conn }) => {
        await groupAdminExtra.removeGroupProfilePic(conn, m.chat);
        return m.reply('🗑️ *Foto de perfil do grupo removida com sucesso!*');
      }
    });

    // Enviar Backup do Banco SQLite ao Dono (!backup)
    this.registerCommand({
      name: 'backup',
      command: ['backup', 'backupdb', 'salvardb'],
      tags: ['owner'],
      desc: 'Gera uma cópia do banco SQLite e envia no privado do Dono',
      owner: true,
      run: async (m, { conn }) => {
        const ownerJid = '554884702848@s.whatsapp.net';
        await m.reply('📦 *Gerando e enviando backup do banco SQLite no PV do Dono...*');
        await groupAdminExtra.backupDatabaseToOwner(conn, ownerJid);
        return m.reply('✅ *Backup entregue com sucesso no privado do Dono Supremo (+554884702848)!*');
      }
    });

    // Limpar Arquivos de Sessão Signal Órfãos (!clearsessions)
    this.registerCommand({
      name: 'clearsessions',
      command: ['clearsessions', 'limparsessoes'],
      tags: ['owner'],
      desc: 'Limpa arquivos temporários de sessões Signal preservando creds.json',
      owner: true,
      run: async (m) => {
        const deleted = groupAdminExtra.cleanSignalSessions();
        return m.reply(`🧹 *LIMPEZA CONCLUÍDA:* ${deleted} arquivos de sessões temporárias foram reciclados!`);
      }
    });

    // Remover Foto de Perfil do Bot (!delppbot)
    this.registerCommand({
      name: 'delppbot',
      command: ['delppbot', 'removerfotobot'],
      tags: ['owner'],
      desc: 'Remove a foto de perfil do próprio bot no WhatsApp',
      owner: true,
      run: async (m, { conn }) => {
        await groupAdminExtra.removeBotProfilePic(conn);
        return m.reply('🗑️ *Foto de perfil do bot removida com sucesso!*');
      }
    });

    // Ler Código-Fonte de Plugin / Serviço (!pluginget)
    this.registerCommand({
      name: 'pluginget',
      command: ['pluginget', 'vercodigo', 'gp'],
      tags: ['owner'],
      desc: 'Lê o código-fonte de um serviço ou plugin do bot diretamente no WhatsApp',
      owner: true,
      run: async (m, { args, usedPrefix }) => {
        if (!args[0]) return m.reply(`ℹ️ Uso: *${usedPrefix}pluginget visualMakerService*`);
        const res = groupAdminExtra.getPluginSourceCode(args[0]);
        return m.reply(
          `╭━━━〔 💻 *SOURCE CODE: ${res.filename}* 〕━━━⬣\n` +
          `\`\`\`javascript\n${res.content}\n\`\`\`\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        );
      }
    });

    // =========================================================================
    // 23. PACOTE DE EXPANSÃO AVALON-MD: HOOKS & NOTIFICAÇÕES (CAT 11)
    // =========================================================================
    // Auto Level Up (!autolevelup on/off)
    this.registerCommand({
      name: 'autolevelup',
      command: ['autolevelup', 'autonivel'],
      tags: ['group'],
      desc: 'Ativa ou desativa notificações automáticas quando membros sobem de nível de XP',
      group: true,
      admin: true,
      run: async (m, { args, usedPrefix }) => {
        const action = (args[0] || '').toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting('AUTOLEVELUP_GLOBAL', 'true');
          return m.reply('🌟 *AUTO LEVEL-UP ATIVADO!* O bot notificará conquistas de novos níveis de fidelidade e XP no grupo.');
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting('AUTOLEVELUP_GLOBAL', 'false');
          return m.reply('⚪ *AUTO LEVEL-UP DESATIVADO!*');
        } else {
          const isAct = models.getSetting('AUTOLEVELUP_GLOBAL', 'false') === 'true';
          return m.reply(`ℹ️ *Auto Level-Up:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\\nPara alterar: *${usedPrefix}autolevelup on* ou *${usedPrefix}autolevelup off*`);
        }
      }
    });

    // Auto View Status (!viewstatus on/off)
    this.registerCommand({
      name: 'viewstatus',
      command: ['viewstatus', 'autostatus'],
      tags: ['owner'],
      desc: 'Visualiza automaticamente os status/stories de contatos no WhatsApp',
      owner: true,
      run: async (m, { args, usedPrefix }) => {
        const action = (args[0] || '').toLowerCase();
        if (action === 'on' || action === 'ativar' || action === '1') {
          models.setSetting('VIEWSTATUS_GLOBAL', 'true');
          return m.reply('👀 *AUTO VIEW-STATUS ATIVADO!* O bot visualizará automaticamente todos os status dos contatos.');
        } else if (action === 'off' || action === 'desativar' || action === '0') {
          models.setSetting('VIEWSTATUS_GLOBAL', 'false');
          return m.reply('⚪ *AUTO VIEW-STATUS DESATIVADO!*');
        } else {
          const isAct = models.getSetting('VIEWSTATUS_GLOBAL', 'false') === 'true';
          return m.reply(`ℹ️ *Auto View-Status:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'}\nPara alterar: *${usedPrefix}viewstatus on* ou *${usedPrefix}viewstatus off*`);
        }
      }
    });

    // =========================================================================
    // 24. PUBLICADOR DE STORIES / STATUS COM MENÇÕES EM MASSA (STATUS BROADCAST)
    // =========================================================================
    const statusStory = require('./services/statusStoryService');

    // 1. Postar Story Marcando Todos os Membros do Grupo (!statusgp)
    this.registerCommand({
      name: 'statusgp',
      command: ['statusgp', 'statusgrupo', 'swgp', 'postargrupo'],
      tags: ['group', 'admin'],
      desc: 'Publica um Story no WhatsApp marcando e notificando todos os membros do grupo atual',
      group: true,
      admin: true,
      run: async (m, { conn, text, usedPrefix }) => {
        let mediaBuf = null;
        let mediaType = 'text';

        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage' || m.quoted.mtype === 'audioMessage')) {
          mediaBuf = await m.quoted.download();
          if (m.quoted.mtype === 'imageMessage') mediaType = 'image';
          else if (m.quoted.mtype === 'videoMessage') mediaType = 'video';
          else if (m.quoted.mtype === 'audioMessage') mediaType = 'audio';
        } else if (m.mtype === 'imageMessage' || m.mtype === 'videoMessage' || m.mtype === 'audioMessage') {
          mediaBuf = await m.download();
          if (m.mtype === 'imageMessage') mediaType = 'image';
          else if (m.mtype === 'videoMessage') mediaType = 'video';
          else if (m.mtype === 'audioMessage') mediaType = 'audio';
        }

        const captionOrText = text || (m.quoted ? m.quoted.text : '') || '';
        if (!mediaBuf && !captionOrText) {
          return m.reply(
            `ℹ️ *Como usar o !statusgp:*\n\n` +
            `🔹 *Texto puro:* \`${usedPrefix}statusgp Novidades incríveis para todos os membros!\`\n` +
            `🔹 *Com foto ou vídeo:* Envie ou responda a uma imagem/vídeo com \`${usedPrefix}statusgp [sua legenda]\`\n\n` +
            `_O story será publicado no WhatsApp e todos os participantes do grupo receberão notificação de menção._`
          );
        }

        const mediaOptions = {
          text: captionOrText,
          caption: captionOrText,
          image: mediaType === 'image' ? mediaBuf : null,
          video: mediaType === 'video' ? mediaBuf : null,
          audio: mediaType === 'audio' ? mediaBuf : null
        };

        const res = await statusStory.postGroupStatus(conn, m.chat, mediaOptions);
        return m.reply(
          `╭━━━〔 📢 *STATUS PUBLICADO COM SUCESSO* 〕━━━⬣\n` +
          `┃ 👥 *Membros Marcados:* ${res.totalParticipants}\n` +
          `┃ 🏷️ *Grupo:* ${res.groupName}\n` +
          `┃ 📌 *Formato:* ${res.type.toUpperCase()}\n` +
          `┃ 🚀 *Status ID:* \`${res.statusId}\`\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `_Todos os participantes receberão uma notificação oficial de menção no status!_`
        );
      }
    });

    // 2. Postar Story Marcando Toda a Base de Clientes e Leads do Banco (!statusbase)
    this.registerCommand({
      name: 'statusbase',
      command: ['statusbase', 'statusall', 'swbase', 'postarbase'],
      tags: ['owner'],
      desc: 'Publica Story marcando todos os clientes, contatos e leads registrados no banco de dados',
      owner: true,
      run: async (m, { conn, text, usedPrefix }) => {
        let mediaBuf = null;
        let mediaType = 'text';

        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage' || m.quoted.mtype === 'audioMessage')) {
          mediaBuf = await m.quoted.download();
          if (m.quoted.mtype === 'imageMessage') mediaType = 'image';
          else if (m.quoted.mtype === 'videoMessage') mediaType = 'video';
          else if (m.quoted.mtype === 'audioMessage') mediaType = 'audio';
        } else if (m.mtype === 'imageMessage' || m.mtype === 'videoMessage' || m.mtype === 'audioMessage') {
          mediaBuf = await m.download();
          if (m.mtype === 'imageMessage') mediaType = 'image';
          else if (m.mtype === 'videoMessage') mediaType = 'video';
          else if (m.mtype === 'audioMessage') mediaType = 'audio';
        }

        const captionOrText = text || (m.quoted ? m.quoted.text : '') || '';
        if (!mediaBuf && !captionOrText) {
          return m.reply(
            `ℹ️ *Como usar o !statusbase:*\n\n` +
            `🔹 *Texto puro:* \`${usedPrefix}statusbase Grande oferta relâmpago para todos os clientes!\`\n` +
            `🔹 *Com foto ou vídeo:* Envie ou responda a uma foto/vídeo com \`${usedPrefix}statusbase [legenda]\`\n\n` +
            `_O story será enviado para toda a base de contatos extraída do banco de dados SQLite._`
          );
        }

        const mediaOptions = {
          text: captionOrText,
          caption: captionOrText,
          image: mediaType === 'image' ? mediaBuf : null,
          video: mediaType === 'video' ? mediaBuf : null,
          audio: mediaType === 'audio' ? mediaBuf : null
        };

        const res = await statusStory.postDatabaseStatus(conn, mediaOptions);
        return m.reply(
          `╭━━━〔 📢 *STATUS ENVIADO PARA TODA A BASE* 〕━━━⬣\n` +
          `┃ 👥 *Total de Clientes/Leads Marcados:* ${res.totalContacts}\n` +
          `┃ 📦 *Lotes de Transmissão:* ${res.batchesCount}\n` +
          `┃ 📌 *Formato:* ${res.type.toUpperCase()}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `_A base de clientes receberá notificação de menção direta no WhatsApp!_`
        );
      }
    });

    // 3. Postar Story Através de Todos os Sub-Bots do Exército (!statusarmy)
    this.registerCommand({
      name: 'statusarmy',
      command: ['statusarmy', 'swarmy', 'postarexercito'],
      tags: ['owner', 'meteorico'],
      desc: 'Dispara Stories simultâneos por todo o exército de chips/sub-bots marcando seus respectivos públicos',
      owner: true,
      run: async (m, { text, usedPrefix }) => {
        let mediaBuf = null;
        let mediaType = 'text';

        if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage' || m.quoted.mtype === 'audioMessage')) {
          mediaBuf = await m.quoted.download();
          if (m.quoted.mtype === 'imageMessage') mediaType = 'image';
          else if (m.quoted.mtype === 'videoMessage') mediaType = 'video';
          else if (m.quoted.mtype === 'audioMessage') mediaType = 'audio';
        } else if (m.mtype === 'imageMessage' || m.mtype === 'videoMessage' || m.mtype === 'audioMessage') {
          mediaBuf = await m.download();
          if (m.mtype === 'imageMessage') mediaType = 'image';
          else if (m.mtype === 'videoMessage') mediaType = 'video';
          else if (m.mtype === 'audioMessage') mediaType = 'audio';
        }

        const captionOrText = text || (m.quoted ? m.quoted.text : '') || '';
        if (!mediaBuf && !captionOrText) {
          return m.reply(
            `ℹ️ *Como usar o !statusarmy:*\n\n` +
            `🔹 *Texto puro:* \`${usedPrefix}statusarmy Começou o Lançamento Oficial! Acessem o link!\`\n` +
            `🔹 *Com foto ou vídeo:* Responda a uma mídia com \`${usedPrefix}statusarmy [legenda]\`\n\n` +
            `_Todos os sub-bots do exército publicarão o story em sincronia marcando seus grupos e leads._`
          );
        }

        const mediaOptions = {
          text: captionOrText,
          caption: captionOrText,
          image: mediaType === 'image' ? mediaBuf : null,
          video: mediaType === 'video' ? mediaBuf : null,
          audio: mediaType === 'audio' ? mediaBuf : null
        };

        const res = await statusStory.postArmyStatus(mediaOptions);
        return m.reply(
          `╭━━━〔 🚀 *DISPARO DE STORIES PELO EXÉRCITO* 〕━━━⬣\n` +
          `┃ 🤖 *Sub-Bots Ativos no Disparo:* ${res.dispatchedBots} / ${res.activeInstancesCount}\n` +
          `┃ 🎯 *Audiência Total Notificada:* ${res.totalTargeted} pessoas\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
          `_Todos os sub-bots publicaram o story marcando os seus respectivos públicos!_`
        );
      }
    });

    // 4. Central de Escuta Híbrida: Social Listening, Radar Sentinela & Áudios (!escuta)
    this.registerCommand({
      name: 'escuta',
      command: ['escuta', 'social', 'sociallistening', 'sentinela', 'ouvinte', 'criarsentinela', 'sentinelagp', 'gruposentinela'],
      tags: ['owner', 'admin', 'vendas'],
      desc: 'Central híbrida de comando para Social Listening, Radar Sentinela e Escuta de Áudios',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const socialListeningService = require('./services/socialListeningService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return socialListeningService.handleEscutaCommand(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, isAdmin, m);
      }
    });

    // 5. Delegação de Grupo para Sub-Bot Gerente (!gerente / !delegargrupo)
    this.registerCommand({
      name: 'gerente',
      command: ['gerente', 'gerentegrupo', 'delegargrupo'],
      tags: ['owner', 'admin', 'group'],
      desc: 'Delega a gerência total do grupo para um Sub-Bot específico',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const groupManagerService = require('./services/groupManagerService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return groupManagerService.handleGerenteCommand(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, isAdmin, m.isGroup);
      }
    });

    // 6. Central de Aquecimento de Grupos & Diálogos entre Sub-Bots (!aquecimento / !socialwarming)
    this.registerCommand({
      name: 'aquecimento',
      command: ['aquecimento', 'aquecer', 'socialwarming', 'grupowarming'],
      tags: ['owner', 'admin', 'vendas', 'group'],
      desc: 'Central de conversas inteligentes entre múltiplos Sub-Bots no mesmo grupo com limite de 9 msgs/24h',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const groupHeatingService = require('./services/groupHeatingService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return groupHeatingService.handleAquecimentoCommand(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, isAdmin);
      }
    });

    // 6.1 Configuração do Grupo Específico de Pedidos (#ORD)
    this.registerCommand({
      name: 'grupoord',
      command: ['grupoord', 'grupo_ord', 'setgrupoord', 'ordgrupo', 'grupo_pedidos', 'pedidosgrupo'],
      tags: ['owner', 'admin', 'store', 'orders'],
      desc: 'Configura o grupo específico para onde todos os novos pedidos (#ORD_...) serão enviados',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const models = require('./db/models');
        if (!isOwner && !isROwner && !isAdmin) {
          return m.reply('❌ Apenas o Dono ou administradores podem configurar o grupo de pedidos (#ORD).');
        }

        const parts = String(text || '').trim().split(/\s+/);
        const actionArg = (parts[0] || '').toLowerCase().trim();

        if (actionArg === 'remover' || actionArg === 'limpar' || actionArg === 'del' || actionArg === 'reset') {
          models.setOrdersGroupJid('');
          return m.reply('🗑️ *Grupo de Pedidos (#ORD) desvinculado!* Novos pedidos voltarão a ser enviados no privado do Dono até novo grupo ser configurado.');
        }

        if (actionArg === 'status' || actionArg === 'info') {
          const curJid = models.getOrdersGroupJid ? models.getOrdersGroupJid() : models.getSetting('ORDERS_GROUP_JID', '');
          if (curJid) {
            return m.reply(`📦 *GRUPO DE PEDIDOS (#ORD) ATUAL:*\n\n📍 *JID:* \`${curJid}\`\n\nTodos os pedidos novos (#ORD_...) são encaminhados diretamente a este grupo.`);
          } else {
            return m.reply(`ℹ️ *Nenhum grupo de pedidos (#ORD) configurado ainda.*\n\n👉 Para vincular este grupo, envie: *!grupoord*\n👉 Para vincular outro grupo por ID, envie: *!grupoord <jid_do_grupo>*`);
          }
        }

        let targetGroupJid = null;
        if (actionArg && actionArg.includes('@g.us')) {
          targetGroupJid = actionArg;
        } else if (m.isGroup) {
          targetGroupJid = m.chat;
        }

        if (!targetGroupJid) {
          return m.reply('⚠️ *Envie este comando DENTRO do grupo desejado*, ou informe o JID do grupo:\n\nExemplo: `!grupoord 120363046549885654@g.us`');
        }

        models.setOrdersGroupJid(targetGroupJid);
        return m.reply(
          `✅ *GRUPO DE PEDIDOS (#ORD) CONFIGURADO COM SUCESSO!* 📦\n\n` +
          `🆔 *JID:* \`${targetGroupJid}\`\n\n` +
          `🚀 *Regra Ativa:* Todos os novos pedidos gerados na vitrine web (#ORD_...) serão enviados diretamente aqui neste canal com todos os detalhes e Pix Copia e Cola, poupando o privado do Dono!`
        );
      }
    });

    // 7. Conectar Sub-Bot, Desligar/Ligar ou Tornar Free (!serbot / !jadibot / !subbot / !code)
    this.registerCommand({
      name: 'serbot',
      command: ['serbot', 'jadibot', 'subbot', 'subbotfree', 'tornarfree', 'aceitartermos', 'code', 'conectar'],
      tags: ['subbot', 'free'],
      desc: 'Conecta novo Sub-Bot, desliga (!serbot off) ou religa (!serbot on) sem re-login, ou torna em Free',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return spyFeatures.handleSerBot(conn, m.chat, fullText, m.senderNumber, m.isGroup, isOwner || isROwner);
      }
    });

    // 8. Modo de Acesso do Bot ou Sub-Bot (!publico / !privado / !modo)
    this.registerCommand({
      name: 'publico',
      command: ['publico', 'public', 'botpublico', 'modopublico'],
      tags: ['subbot', 'bot', 'config'],
      desc: 'Define o bot ou sub-bot para modo PÚBLICO (todos podem usar os comandos)',
      run: async (m, { conn, text = '', isOwner = false, isROwner = false }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return spyFeatures.handleBotAccessMode(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, conn);
      }
    });

    this.registerCommand({
      name: 'privado',
      command: ['privado', 'private', 'botprivado', 'modoprivado', 'self', 'soeu'],
      tags: ['subbot', 'bot', 'config'],
      desc: 'Define o bot ou sub-bot para modo PRIVADO (só responde a si mesmo / self-only)',
      run: async (m, { conn, text = '', isOwner = false, isROwner = false }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return spyFeatures.handleBotAccessMode(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, conn);
      }
    });

    this.registerCommand({
      name: 'modobot',
      command: ['modobot', 'modo', 'acessobot', 'acesso', 'modoacesso'],
      tags: ['subbot', 'bot', 'config'],
      desc: 'Verifica ou altera o modo de acesso do bot (público ou privado)',
      run: async (m, { conn, text = '', isOwner = false, isROwner = false }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return spyFeatures.handleBotAccessMode(conn, m.chat, fullText, m.senderNumber, isOwner || isROwner, conn);
      }
    });

    // 9. Controle do Bot no Grupo (!bot on / !bot off / !bot status)
    this.registerCommand({
      name: 'bot',
      command: ['bot', 'boton', 'botoff', 'ativarbot', 'desativarbot', 'ligarbot', 'desligarbot'],
      tags: ['admin', 'group'],
      desc: 'Ativa (!bot on) ou desativa (!bot off) o bot diretamente no grupo',
      run: async (m, { conn, text = '', isOwner = false, isAdmin = false, isROwner = false }) => {
        const spyFeatures = require('./services/spyFeaturesService');
        const fullText = m.text || (m.prefix + m.command + (text ? ' ' + text : ''));
        return spyFeatures.handleGroupBotOnOff(conn, m.chat, fullText, m.senderNumber, m.isGroup, isAdmin || isOwner || isROwner, isOwner || isROwner);
      }
    });

    // 10. Registra comandos clonados persistidos no SQLite
    this._registerClonedCommandsFromDb();
  }

  /**
   * Carrega e registra em memória todos os comandos clonados salvos no banco SQLite
   */
  _registerClonedCommandsFromDb() {
    try {
      const models = require('./db/models');
      const cloned = models.getCustomTriggers({ activeOnly: true, platform: 'all' })
        .filter(t => t.category === 'Cloned Commands' || (t.keyword && t.keyword.startsWith('!')));

      for (const item of cloned) {
        const cleanName = item.keyword.replace(/^[!/#.]/, '').toLowerCase().trim();
        if (!cleanName || this.commands.has(cleanName)) continue;

        let payload = null;
        try { payload = JSON.parse(item.response_text); } catch (_) {}

        this.registerCommand({
          name: cleanName,
          command: [cleanName],
          tags: ['cloned'],
          desc: `Comando clonado: ${item.keyword}`,
          run: async (m, { conn }) => {
            if (payload && typeof payload === 'object') {
              return await conn.sendMessage(m.chat, payload, { quoted: m });
            }
            return await m.reply(item.response_text);
          }
        });
      }
    } catch (_) {}
  }
}

module.exports = new PayBotHandler();

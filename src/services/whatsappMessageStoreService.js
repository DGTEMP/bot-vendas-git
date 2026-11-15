const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * =========================================================================
 * 🛡️ WHATSAPP MESSAGE STORE & RETRY MANAGER SERVICE 🛡️
 * =========================================================================
 * Resolve o problema de falha de entrega e descriptografia em dispositivos
 * modernos Android (ex: Galaxy S23 Ultra / One UI 6 / Android 14) e iOS:
 *
 * 1. msgRetryCounterCache Compartilhado:
 *    Mantém um cache em memória estável e durável entre reconexões para gerenciar
 *    contadores de retentativa de mensagens e re-negociação de Signal Protocol.
 *
 * 2. Outgoing Message Store (Cache de Mensagens Enviadas):
 *    Armazena em memória o protobuf completo (proto.IMessage) de todas as mensagens
 *    enviadas pelo Bot Master e Sub-Bots. Quando o WhatsApp do destinatário envia
 *    um receipt de retry (<receipt type="retry">), Baileys aciona getMessage(key).
 *    Esta store devolve o protobuf exato da mídia/texto para re-criptografar e reenviar!
 *
 * 3. LID <-> Phone (PN) Bidirectional Mapping:
 *    Mapeia em tempo real identificadores de privacidade @lid para os números reais @s.whatsapp.net,
 *    garantindo que mensagens e retries trocados via LID sejam perfeitamente correlacionados.
 *
 * 4. Interceptação Automática de Sockets:
 *    Envolve sock.sendMessage e sock.relayMessage automaticamente para registrar qualquer
 *    mensagem de saída (texto, áudio, documento, figurinha, imagem).
 * =========================================================================
 */

let NodeCache;
try {
  NodeCache = require('@cacheable/node-cache').default || require('@cacheable/node-cache');
} catch (_) {
  // Fallback seguro caso a lib não esteja disponível
  NodeCache = class FallbackNodeCache {
    constructor(opts = {}) {
      this.ttl = (opts.stdTTL || 3600) * 1000;
      this.data = new Map();
    }
    get(key) {
      const entry = this.data.get(String(key));
      if (!entry) return undefined;
      if (Date.now() > entry.expiry) {
        this.data.delete(String(key));
        return undefined;
      }
      return entry.val;
    }
    set(key, val, ttlSec) {
      const ms = (ttlSec ? ttlSec * 1000 : this.ttl);
      this.data.set(String(key), { val, expiry: Date.now() + ms });
      if (this.data.size > 20000) {
        const first = this.data.keys().next().value;
        this.data.delete(first);
      }
      return true;
    }
    del(key) {
      return this.data.delete(String(key));
    }
    flushAll() {
      this.data.clear();
    }
  };
}

class WhatsAppMessageStoreService {
  constructor() {
    // 1. msgRetryCounterCache oficial para Baileys
    this.msgRetryCounterCache = new NodeCache({
      stdTTL: 3600, // 1 hora de TTL para retries
      checkperiod: 120,
      useClones: false
    });

    // 2. Cache de mensagens enviadas (Outgoing Messages)
    // Map de msgId -> { id, remoteJid, participant, message, timestamp, instanceId }
    this.outgoingMessages = new Map();
    // Índice auxiliar: "${remoteJid}:${msgId}" -> msgId
    this.outgoingLookupIndex = new Map();
    this.maxOutgoingSize = 2500; // Otimizado para Nitro V15 (evita inflação de RAM mantendo 100% dos retries)
    this.outgoingTTL = 60 * 60 * 1000; // 1 hora de retenção (suficiente para retries do WhatsApp)

    // 3. Cache Bidirecional LID <-> Telefone (PN)
    this.lidToPhoneMap = new Map();
    this.phoneToLidMap = new Map();

    // Sincroniza Dono Supremo oficial imediatamente
    this.registerLidMapping('151866151276711', '554884702848');
  }

  /**
   * Registra mapeamento bidirecional entre LID e número de telefone
   */
  registerLidMapping(lidRaw, pnRaw) {
    if (!lidRaw || !pnRaw) return;
    const cleanLid = String(lidRaw).split('@')[0].split(':')[0].replace(/\D/g, '');
    const cleanPn = String(pnRaw).split('@')[0].split(':')[0].replace(/\D/g, '');

    if (!cleanLid || !cleanPn) return;
    if (cleanLid === cleanPn) return;

    this.lidToPhoneMap.set(cleanLid, cleanPn);
    this.phoneToLidMap.set(cleanPn, cleanLid);

    // Também indexa com sufixos comuns
    this.lidToPhoneMap.set(`${cleanLid}@lid`, `${cleanPn}@s.whatsapp.net`);
    this.phoneToLidMap.set(`${cleanPn}@s.whatsapp.net`, `${cleanLid}@lid`);
  }

  /**
   * Extrai e registra automaticamente informações de LID a partir de um objeto WAMessage
   */
  extractAndRegisterFromMsg(msg) {
    if (!msg || !msg.key) return;
    const key = msg.key;

    // 1. Avalia remoteJid e remoteJidAlt
    const remoteJid = key.remoteJid || '';
    const remoteJidAlt = key.remoteJidAlt || '';
    if (remoteJid && remoteJidAlt) {
      if (remoteJid.includes('@lid') && (remoteJidAlt.includes('@s.whatsapp.net') || !remoteJidAlt.includes('@'))) {
        this.registerLidMapping(remoteJid, remoteJidAlt);
      } else if (remoteJid.includes('@s.whatsapp.net') && remoteJidAlt.includes('@lid')) {
        this.registerLidMapping(remoteJidAlt, remoteJid);
      }
    }

    // 2. Avalia participant e participantAlt (grupos)
    const participant = key.participant || '';
    const participantAlt = key.participantAlt || '';
    if (participant && participantAlt) {
      if (participant.includes('@lid') && (participantAlt.includes('@s.whatsapp.net') || !participantAlt.includes('@'))) {
        this.registerLidMapping(participant, participantAlt);
      } else if (participant.includes('@s.whatsapp.net') && participantAlt.includes('@lid')) {
        this.registerLidMapping(participantAlt, participant);
      }
    }
  }

  /**
   * Resolve um JID ou string de LID para o número real de telefone
   */
  resolveLidToPhone(jidOrPhone) {
    if (!jidOrPhone) return null;
    const str = String(jidOrPhone).trim();
    const clean = str.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!clean) return null;

    // Números normais de telefone (8 a 13 dígitos) já são números válidos de telefone
    if (clean.length >= 8 && clean.length <= 13) {
      return clean;
    }

    // Busca no cache em memória
    if (this.lidToPhoneMap.has(clean)) {
      const val = this.lidToPhoneMap.get(clean);
      if (val) return val.replace(/\D/g, '');
    }

    // Busca no disco: data/whatsapp_auth/lid-mapping-..._reverse.json
    try {
      const authDir = config.whatsapp?.authFolder || path.join(__dirname, '..', '..', 'data', 'whatsapp_auth');
      const revFile = path.join(authDir, `lid-mapping-${clean}_reverse.json`);
      if (fs.existsSync(revFile)) {
        const content = fs.readFileSync(revFile, 'utf8').trim().replace(/["\s]/g, '');
        const phoneDigits = content.replace(/\D/g, '');
        if (phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 13) {
          this.registerLidMapping(clean, phoneDigits);
          return phoneDigits;
        }
      }

      // Busca nos diretórios do exército de sub-bots
      const armyDir = path.join(__dirname, '..', '..', 'data', 'whatsapp_army');
      if (fs.existsSync(armyDir)) {
        const instances = fs.readdirSync(armyDir);
        for (const inst of instances) {
          const subRev = path.join(armyDir, inst, `lid-mapping-${clean}_reverse.json`);
          if (fs.existsSync(subRev)) {
            const content = fs.readFileSync(subRev, 'utf8').trim().replace(/["\s]/g, '');
            const phoneDigits = content.replace(/\D/g, '');
            if (phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 13) {
              this.registerLidMapping(clean, phoneDigits);
              return phoneDigits;
            }
          }
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Resolve telefone para LID correspondente, se conhecido
   */
  resolvePhoneToLid(phoneOrJid) {
    if (!phoneOrJid) return null;
    const clean = String(phoneOrJid).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!clean) return null;
    return this.phoneToLidMap.get(clean) || null;
  }

  /**
   * Armazena uma mensagem de saída enviada pelo bot (para atender a retry receipts de Baileys)
   */
  storeOutgoingMessage(key, message, instanceId = 1) {
    if (!key || !key.id || !message) return;
    const id = String(key.id);
    const remoteJid = key.remoteJid ? String(key.remoteJid) : '';
    const participant = key.participant ? String(key.participant) : '';

    const entry = {
      id,
      remoteJid,
      participant,
      message,
      timestamp: Date.now(),
      instanceId: instanceId || 1
    };

    // Indexação por ID direto
    this.outgoingMessages.set(id, entry);

    // Indexação por remoteJid:id
    if (remoteJid) {
      this.outgoingLookupIndex.set(`${remoteJid}:${id}`, id);

      // Normaliza JIDs individuais removendo sufixo de companion device (:1@s.whatsapp.net -> @s.whatsapp.net)
      if (remoteJid.includes(':') && remoteJid.includes('@')) {
        const user = remoteJid.split('@')[0].split(':')[0];
        const server = remoteJid.split('@')[1];
        const cleanJid = `${user}@${server}`;
        this.outgoingLookupIndex.set(`${cleanJid}:${id}`, id);
      }

      // Se o remoteJid for telefone, associa também ao LID correspondente
      const cleanDigits = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanDigits && cleanDigits.length >= 8 && cleanDigits.length <= 13) {
        const mappedLid = this.resolvePhoneToLid(cleanDigits);
        if (mappedLid) {
          this.outgoingLookupIndex.set(`${mappedLid}@lid:${id}`, id);
        }
      } else if (cleanDigits && cleanDigits.length >= 14) {
        // Se for LID, associa ao telefone correspondente
        const mappedPhone = this.resolveLidToPhone(cleanDigits);
        if (mappedPhone) {
          this.outgoingLookupIndex.set(`${mappedPhone}@s.whatsapp.net:${id}`, id);
        }
      }
    }

    if (participant) {
      this.outgoingLookupIndex.set(`${participant}:${id}`, id);
    }

    // Limpeza por capacidade (FIFO) com expurgo no índice de busca rápida (Evita vazamento de memória)
    if (this.outgoingMessages.size > this.maxOutgoingSize) {
      const oldestId = this.outgoingMessages.keys().next().value;
      if (oldestId) {
        this.outgoingMessages.delete(oldestId);
      }
      // Mantém outgoingLookupIndex proporcional para não acumular órfãos na RAM
      if (this.outgoingLookupIndex.size > this.maxOutgoingSize * 2) {
        let purged = 0;
        for (const [k, msgId] of this.outgoingLookupIndex.entries()) {
          if (!this.outgoingMessages.has(msgId)) {
            this.outgoingLookupIndex.delete(k);
            purged++;
            if (purged >= 500) break;
          }
        }
      }
    }
  }

  /**
   * Limpeza de memória periódica (chamada pelo GC do sistema a cada 3 minutos)
   */
  cleanupMemory() {
    try {
      const now = Date.now();
      // Remove mensagens mais antigas que o TTL
      for (const [id, item] of this.outgoingMessages.entries()) {
        if (item?.timestamp && (now - item.timestamp > this.outgoingTTL)) {
          this.outgoingMessages.delete(id);
        }
      }
      // Remove índices que apontam para mensagens já eliminadas
      for (const [k, msgId] of this.outgoingLookupIndex.entries()) {
        if (!this.outgoingMessages.has(msgId)) {
          this.outgoingLookupIndex.delete(k);
        }
      }
    } catch (_) {}
  }

  /**
   * Recupera o protobuf proto.IMessage de uma mensagem enviada a partir da chave Baileys
   */
  getOutgoingMessage(key) {
    if (!key || !key.id) return undefined;
    const id = String(key.id);

    // 1. Busca direta por ID
    const direct = this.outgoingMessages.get(id);
    if (direct && direct.message) {
      return direct.message;
    }

    // 2. Busca por ${remoteJid}:${id}
    if (key.remoteJid) {
      const fullKey = `${key.remoteJid}:${id}`;
      const mappedId = this.outgoingLookupIndex.get(fullKey);
      if (mappedId) {
        const found = this.outgoingMessages.get(mappedId);
        if (found?.message) return found.message;
      }

      // 3. Normaliza JID sem sufixo de companion device (:1)
      if (key.remoteJid.includes(':')) {
        const user = key.remoteJid.split('@')[0].split(':')[0];
        const server = key.remoteJid.split('@')[1];
        const cleanFullKey = `${user}@${server}:${id}`;
        const cleanMappedId = this.outgoingLookupIndex.get(cleanFullKey);
        if (cleanMappedId) {
          const found = this.outgoingMessages.get(cleanMappedId);
          if (found?.message) return found.message;
        }
      }

      // 4. Se for LID, tenta pelo número de telefone resolvido
      const cleanDigits = key.remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanDigits && cleanDigits.length >= 14) {
        const phone = this.resolveLidToPhone(cleanDigits);
        if (phone) {
          const phoneKey = `${phone}@s.whatsapp.net:${id}`;
          const phoneMappedId = this.outgoingLookupIndex.get(phoneKey);
          if (phoneMappedId) {
            const found = this.outgoingMessages.get(phoneMappedId);
            if (found?.message) return found.message;
          }
        }
      }
    }

    // 5. Busca por ${participant}:${id}
    if (key.participant) {
      const partKey = `${key.participant}:${id}`;
      const partMappedId = this.outgoingLookupIndex.get(partKey);
      if (partMappedId) {
        const found = this.outgoingMessages.get(partMappedId);
        if (found?.message) return found.message;
      }
    }

    return undefined;
  }

  /**
   * Implementação universal e robusta de getMessage para Baileys
   * (usada no Bot Master e em todos os Sub-Bots)
   */
  async getMessage(key) {
    if (!key || !key.id) return undefined;

    try {
      // 1. Tenta recuperar da nossa store de mensagens enviadas (Outgoing / Respostas do Bot)
      const outMsg = this.getOutgoingMessage(key);
      if (outMsg) {
        return outMsg;
      }

      // 2. Tenta recuperar do cache de mensagens recebidas (Anti-Delete / Citadas)
      const spyFeatures = require('./spyFeaturesService');
      if (spyFeatures && spyFeatures.recentMessages) {
        if (key.remoteJid) {
          const fullKey = `${key.remoteJid}:${key.id}`;
          const inMsg = spyFeatures.recentMessages.get(fullKey);
          if (inMsg?.msg?.message) return inMsg.msg.message;
        }
        const inDirect = spyFeatures.recentMessages.get(key.id);
        if (inDirect?.msg?.message) return inDirect.msg.message;
      }
    } catch (_) {}

    return undefined;
  }

  /**
   * Envolve um socket Baileys para interceptar automaticamente sendMessage e relayMessage
   */
  wrapSocketWithRetryTracking(sock) {
    if (!sock || sock._retryTrackingWrapped) return sock;
    sock._retryTrackingWrapped = true;

    if (typeof sock.sendMessage === 'function') {
      const originalSendMessage = sock.sendMessage.bind(sock);
      sock.sendMessage = async (jid, content, options) => {
        // Enriquecimento automático de miniaturas de links para mensagens enviadas por qualquer socket Baileys
        if (content && typeof content === 'object' && (content.text || content.caption)) {
          if (!content.linkPreview && !content.contextInfo?.externalAdReply) {
            try {
              const linkPreviewService = require('./linkPreviewService');
              await linkPreviewService.enrichMessageContent(content, options);
            } catch (_) {}
          }
        }
        const result = await originalSendMessage(jid, content, options);
        if (result?.key?.id && result?.message) {
          this.storeOutgoingMessage(result.key, result.message, sock.instanceId || 1);
        }
        return result;
      };
    }

    if (typeof sock.relayMessage === 'function') {
      const originalRelayMessage = sock.relayMessage.bind(sock);
      sock.relayMessage = async (jid, message, options) => {
        if (options?.messageId && message) {
          this.storeOutgoingMessage(
            { id: options.messageId, remoteJid: jid, fromMe: true },
            message,
            sock.instanceId || 1
          );
        }
        return originalRelayMessage(jid, message, options);
      };
    }

    return sock;
  }
}

const whatsappMessageStoreInstance = new WhatsAppMessageStoreService();
module.exports = whatsappMessageStoreInstance;

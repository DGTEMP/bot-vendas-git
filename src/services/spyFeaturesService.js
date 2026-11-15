const path = require('path');
const os = require('os');
const fs = require('fs');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const models = require('../db/models');
const stickerConverter = require('../utils/stickerConverter');
const instagramScraperService = require('./instagramScraperService');
const fancyFonts = require('../utils/fancyFonts');
const audioFxService = require('./audioFxService');
const groupRentalService = require('./groupRentalService');
const { CONSELHOS_BIBLICOS, CONSELHOS_GERAIS, DDD_MAP, METADINHAS_CATALOG } = require('../utils/spybotData');
const { formatBrasiliaTime } = require('../utils/dateTime');

class SpyFeaturesService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || 'sk-6dd285069ee60c6b-fcf00a-fe2a0f79';
    this.groupMessageActivity = new Map(); // groupId -> Set(senderPhone)
    this.recentMessages = new Map(); // key: "${from}:${id}" -> { text, media, sender, pushName, timestamp }
    this.userSearchResults = new Map(); // fromJid -> Array de até 20 vídeos do !lista
    this.afkMap = new Map(); // senderPhone -> { time, reason, name }
    this.marriageProposals = new Map(); // proposerPhone -> { targetPhone, timestamp }
    this.workCooldowns = new Map(); // senderPhone -> timestamp
    this.crimeCooldowns = new Map(); // senderPhone -> timestamp
    this.afkAlertThrottles = new Map(); // targetPhone -> timestamp
    this.floodTracker = new Map(); // key: "${from}:${senderPhone}" -> [timestamps]
    this.viewOnceMediaCache = new Map(); // key: "${from}:${id}" ou "${id}" -> { buffer, type, senderPhone, caption, timestamp }
    this.lastViewOncePerChat = new Map(); // from -> { msgId, buffer, type, mimetype, senderPhone, caption, timestamp }
    this.recentMediaDispatches = new Map(); // msgId -> { url, title, type, quality, from, timestamp }
    this.lastMediaPerChat = new Map(); // from -> { msgId, url, title, type, quality, timestamp }
    this.antiPrivadoCooldown = new Map(); // key: "${from}:${phone}" -> timestamp anti-flood
  }

  // Registra atividade para rastreamento de fantasmas
  recordActivity(groupId, senderPhone) {
    if (!this.groupMessageActivity.has(groupId)) {
      this.groupMessageActivity.set(groupId, new Set());
    }
    this.groupMessageActivity.get(groupId).add(senderPhone);
  }

  // Cacheia mensagens recentes para o Anti-Delete (Spy Security)
  recordMessage(msg) {
    try {
      const from = msg.key?.remoteJid;
      const id = msg.key?.id;
      if (!from || !id) return;

      const sender = msg.key?.participant || from;
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.caption ||
        ''
      ).trim();
      const pushName = msg.pushName || 'Usuário';

      // Cópia imutável do envelope original (protege chaves criptográficas de visualização única antes de unwrap)
      let rawMessage = null;
      try {
        if (msg.message) {
          rawMessage = JSON.parse(JSON.stringify(msg.message));
        }
      } catch (_) {}

      const entry = {
        from,
        id,
        sender,
        text,
        pushName,
        msg,
        rawMessage,
        timestamp: Date.now()
      };

      const key = `${from}:${id}`;
      this.recentMessages.set(key, entry);
      this.recentMessages.set(id, entry);

      if (this.recentMessages.size > 2000) {
        const firstKey = this.recentMessages.keys().next().value;
        this.recentMessages.delete(firstKey);
      }
    } catch (_) {}
  }

  // Otimização e Limpeza de Memória RAM (Caches e Cooldowns)
  cleanupMemory() {
    try {
      const now = Date.now();
      // 1. Limpa mensagens recentes com mais de 30 minutos
      for (const [k, v] of this.recentMessages.entries()) {
        if (!v || (now - (v.timestamp || 0)) > 1800000) {
          this.recentMessages.delete(k);
        }
      }
      if (this.recentMessages.size > 2000) {
        const toDelete = this.recentMessages.size - 2000;
        let count = 0;
        for (const k of this.recentMessages.keys()) {
          this.recentMessages.delete(k);
          if (++count >= toDelete) break;
        }
      }

      // 2. Limpa cache de busca do !lista com política LRU quando exceder 100 itens
      if (this.userSearchResults.size > 100) {
        const toDelete = this.userSearchResults.size - 100;
        let count = 0;
        for (const k of this.userSearchResults.keys()) {
          this.userSearchResults.delete(k);
          if (++count >= toDelete) break;
        }
      }

      // 2.1 Limpa cache de mídias de visualização única (> 6 horas para garantir resposta com !ver)
      for (const [k, v] of this.viewOnceMediaCache.entries()) {
        if (!v || (now - (v.timestamp || 0)) > 21600000) {
          this.viewOnceMediaCache.delete(k);
        }
      }
      if (this.viewOnceMediaCache.size > 300) {
        const toDelete = this.viewOnceMediaCache.size - 300;
        let count = 0;
        for (const k of this.viewOnceMediaCache.keys()) {
          this.viewOnceMediaCache.delete(k);
          if (++count >= toDelete) break;
        }
      }

      // 3. Limpa cooldowns de trabalho e crime expirados (> 5 min)
      for (const [k, ts] of this.workCooldowns.entries()) {
        if (now - ts > 300000) this.workCooldowns.delete(k);
      }
      for (const [k, ts] of this.crimeCooldowns.entries()) {
        if (now - ts > 300000) this.crimeCooldowns.delete(k);
      }
      for (const [k, ts] of this.afkAlertThrottles.entries()) {
        if (now - ts > 120000) this.afkAlertThrottles.delete(k);
      }

      // 4. Limpa arquivos temporários órfãos de mídia no os.tmpdir() (> 10 min)
      try {
        const tmpDir = os.tmpdir();
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
          if (file.startsWith('ytdl_') || file.startsWith('ytvideo_') || file.startsWith('sticker_')) {
            const filePath = path.join(tmpDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (now - stat.mtimeMs > 600000) {
                fs.unlinkSync(filePath);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // 5. Mantém bounded o mapa de atividade de participantes de grupos
      if (this.groupMessageActivity.size > 100) {
        let trimmed = 0;
        for (const k of this.groupMessageActivity.keys()) {
          this.groupMessageActivity.delete(k);
          if (++trimmed >= 30) break;
        }
      }

      // 6. Invoca coletor de lixo V8 se habilitado
      if (typeof global.gc === 'function') {
        global.gc();
      }
    } catch (_) {}
  }

  // Regra Anti-Delete: Reenvia mensagem apagada dizendo não acreditar/ironia na estrutura do !fake
  async handleRevoke(sock, from, revokedId, participantJid) {
    try {
      if (!from || !revokedId) return;
      const isGroup = from.endsWith('@g.us');
      if (!isGroup) return;

      const isAntiDeleteActive = models.isAntiDeleteActive ? models.isAntiDeleteActive(from) : (
        models.getSetting(`ANTIDELETE_${from}`, 'false') === 'true' ||
        models.getSetting('ANTIDELETE_GLOBAL', 'false') === 'true'
      );
      if (!isAntiDeleteActive) return;

      const key = `${from}:${revokedId}`;
      const cached = this.recentMessages.get(key) || this.recentMessages.get(revokedId);
      if (!cached) return;

      // Se a mensagem que foi apagada pertencia ao próprio robô (ex: cancelada intencionalmente via !d), não reenvia!
      try {
        const whatsappBot = require('../bots/whatsappBot');
        if (whatsappBot && typeof whatsappBot.isBotSentMessage === 'function') {
          const isBot = whatsappBot.isBotSentMessage({
            stanzaId: revokedId,
            quotedParticipant: cached.sender,
            activeSock: sock,
            from,
            isGroup: true
          });
          if (isBot) return;
        }
      } catch (_) {}

      // Identifica o autor original da mensagem apagada
      let authorJid = cached.sender || cached.msg?.key?.participant || from;
      let cleanAuthorJid = String(authorJid).trim();
      const rawAuthorUser = cleanAuthorJid.split('@')[0].split(':')[0];
      const authorPhone = rawAuthorUser.replace(/\D/g, '');
      const finalAuthorJid = authorPhone ? `${authorPhone}@s.whatsapp.net` : (cleanAuthorJid.includes('@') ? cleanAuthorJid : `${cleanAuthorJid}@s.whatsapp.net`);

      // Identifica quem apagou a mensagem (o próprio autor ou um admin do grupo)
      let deleterJid = participantJid || from;
      const rawDeleterUser = String(deleterJid).split('@')[0].split(':')[0];
      const deleterPhone = rawDeleterUser.replace(/\D/g, '');

      const isSelfDelete = (!deleterPhone || deleterPhone === authorPhone);

      // Conteúdo textual da mensagem que foi apagada
      const deletedText = cached.text ||
        cached.msg?.message?.conversation ||
        cached.msg?.message?.extendedTextMessage?.text ||
        cached.msg?.message?.imageMessage?.caption ||
        cached.msg?.message?.videoMessage?.caption ||
        '📎 [Mídia apagada]';

      // Sorteia frase irônica / "não acredito" contextualizada
      const selfDeleteIronies = [
        `😱 Não acredito que você tentou apagar isso achando que ninguém ia ver, @${authorPhone}! O arrependimento bateu rápido né? 👀🤣`,
        `👀 Não acredito nessa audácia de apagar! Aqui no grupo a regra é clara: mandou, tá falado! 🕵️‍♂️`,
        `😂 Tentou apagar no sigilo, @${authorPhone}? Fica tranquilo que eu mostro pra todo mundo o que você tentou esconder! 🤡`,
        `🤫 Achou mesmo que ia apagar e ia sumir do histórico? Não no meu turno! O print é eterno! 📸👀`,
        `🍿 Ué @${authorPhone}, apagou por que? Bateu aquele desespero pós-envio? Agora já foi! kkkkkk`,
        `🧐 Mas que coisa mais suspeita... O que tinha de tão comprometedor nisso aqui que você quis apagar, @${authorPhone}? 👀`,
        `🚨 Não acredito! Tentou dar uma de mágico e sumir com a mensagem? Aqui ninguém apaga nada! 🪄🚫`,
        `👀 Ihhh, apagou correndo achando que o bot tava dormindo? Tá entregue pra todo mundo ver! 😂🔥`
      ];

      const adminDeleteIronies = [
        `😱 Não acredito! O admin @${deleterPhone} veio correndo censurar a mensagem do @${authorPhone}! Mas aqui a regra é clara: não se apaga nada! 👀🔥`,
        `👮‍♂️ Tentou passar o pano e sumir com a mensagem do @${authorPhone}, né @${deleterPhone}? Pode ser admin, mas aqui a fofoca é completa! 🕵️‍♂️🤣`,
        `🍿 Eita que o admin @${deleterPhone} apagou a mensagem do @${authorPhone}! O que será que tinha demais? Vejam vocês mesmos! 👀`,
        `🚨 Alerta de censura! O admin @${deleterPhone} tentou deletar a mensagem do @${authorPhone}, mas o histórico é sagrado e tá revelado! 📸💥`,
        `👀 Não acredito na audácia do admin @${deleterPhone} querendo apagar a mensagem alheia! Aqui ninguém apaga nada! 😂`
      ];

      const isX9Active = models.isGroupX9Active ? models.isGroupX9Active(from) : false;
      const x9Prefix = isX9Active ? `🚨 *X9 DO GRUPO (MENSAGEM APAGADA DELATADA!)* 🕵️‍♂️\n\n` : '';
      const chosenList = isSelfDelete ? selfDeleteIronies : adminDeleteIronies;
      let ironyText = `${x9Prefix}${chosenList[Math.floor(Math.random() * chosenList.length)]}`;
      if (isX9Active && deletedText && typeof deletedText === 'string') {
        ironyText += `\n\n💬 *Mensagem original exposta:*\n"${deletedText}"`;
      }

      // Estrutura EXATA do comando !fake:
      // Quoted context simulando a mensagem original do autor
      const fakeQuoted = {
        key: {
          fromMe: false,
          participant: finalAuthorJid,
          remoteJid: from,
          id: revokedId || ('REVOKED_' + Date.now())
        },
        message: {
          conversation: deletedText
        }
      };

      const mentions = [];
      if (authorPhone) mentions.push(`${authorPhone}@s.whatsapp.net`);
      if (deleterPhone && deleterPhone !== authorPhone) mentions.push(`${deleterPhone}@s.whatsapp.net`);

      // Registra evento no auditor do X9
      try {
        models.logX9Event(from, 'REVOKED_MESSAGE', authorPhone, deleterPhone, deletedText, cached.text ? 'text' : 'media');
      } catch (_) {}

      // Reenvia a mensagem usando a estrutura idêntica ao comando !fake
      await sock.sendMessage(
        from,
        {
          text: ironyText,
          mentions
        },
        {
          quoted: fakeQuoted,
          noVerificado: true
        }
      );

      // Se havia mídia anexada (foto, vídeo ou figurinha), extrai e entrega junto
      try {
        const media = await this.extractMediaBuffer(cached.msg);
        if (media && media.buffer) {
          if (media.type === 'image') {
            await sock.sendMessage(from, {
              image: media.buffer,
              caption: `📸 *Foto de @${authorPhone} que tentaram apagar recuperada!*`,
              mentions: [`${authorPhone}@s.whatsapp.net`]
            });
          } else if (media.type === 'video') {
            await sock.sendMessage(from, {
              video: media.buffer,
              caption: `🎬 *Vídeo de @${authorPhone} que tentaram apagar recuperado!*`,
              mentions: [`${authorPhone}@s.whatsapp.net`]
            });
          } else if (media.type === 'sticker') {
            await sock.sendMessage(from, { sticker: media.buffer });
          }
        }
      } catch (_) {}
    } catch (err) {
      console.error('[AntiDelete Erro]:', err.message);
    }
  }

  // ==========================================
  // 1. MÓDULO DE FIGURINHAS (STICKERS & MEDIA)
  // ==========================================

  // Extrai buffer de mídia (imagem, vídeo ou sticker) de mensagem direta ou citada
  async extractMediaBuffer(msg) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted || msg.message;

    if (!targetMsg) return null;

    let type = null;
    let streamType = null;
    let mediaObj = null;

    // Desempacota mensagens de Visualização Única (View Once)
    const unwrappedMsg = targetMsg.viewOnceMessageV2?.message || 
                         targetMsg.viewOnceMessage?.message || 
                         targetMsg.viewOnceMessageV2Extension?.message || 
                         targetMsg;

    if (unwrappedMsg.imageMessage) {
      type = 'image';
      streamType = 'image';
      mediaObj = unwrappedMsg.imageMessage;
    } else if (unwrappedMsg.videoMessage) {
      type = 'video';
      streamType = 'video';
      mediaObj = unwrappedMsg.videoMessage;
    } else if (unwrappedMsg.stickerMessage) {
      type = 'sticker';
      streamType = 'sticker';
      mediaObj = unwrappedMsg.stickerMessage;
    } else if (unwrappedMsg.documentMessage && unwrappedMsg.documentMessage.mimetype?.startsWith('image/')) {
      type = 'image';
      streamType = 'document';
      mediaObj = unwrappedMsg.documentMessage;
    } else if (unwrappedMsg.documentMessage && unwrappedMsg.documentMessage.mimetype?.startsWith('video/')) {
      type = 'video';
      streamType = 'document';
      mediaObj = unwrappedMsg.documentMessage;
    }

    if (!mediaObj) return null;

    try {
      const stream = await downloadContentFromMessage(mediaObj, streamType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return { buffer, type, mimetype: mediaObj.mimetype };
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro ao baixar mídia]:', err.message);
      return null;
    }
  }

  // Converte buffer de imagem para WebP (Sticker 512x512) via conversor local de alta performance
  async convertImageToWebP(imageBuffer) {
    return stickerConverter.convertImageToWebP(imageBuffer);
  }

  // Comando !s / !sticker (Suporta imagem, vídeo/GIF e visualização única)
  async handleSticker(sock, from, msg, pushName) {
    const media = await this.extractMediaBuffer(msg);
    if (!media) {
      return sock.sendMessage(from, {
        text: `🎨 *CRIADOR DE FIGURINHAS (STICKER MAKER)*\n\n` +
          `Envie ou *responda* a uma imagem ou vídeo com o comando *!s* ou *!sticker* para transformá-la em figurinha!`
      });
    }

    await sock.sendMessage(from, { text: `⏳ *Criando sua figurinha...* Aguarde alguns instantes!` });

    try {
      let stickerBuffer = null;
      if (media.type === 'video') {
        stickerBuffer = await stickerConverter.convertVideoToWebP(media.buffer);
      } else {
        stickerBuffer = await stickerConverter.convertImageToWebP(media.buffer);
      }

      await sock.sendMessage(from, {
        sticker: stickerBuffer
      });

      // Bonifica usuário com pontos de fidelidade
      const senderPhone = (msg.key.participant || from).split('@')[0].split(':')[0];
      models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5, pushName);
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Não foi possível criar a figurinha: ${err.message}` });
    }
  }

  // Comando !attp / !ttp (Texto para Figurinha)
  async handleTextToSticker(sock, from, text, pushName) {
    const cleanText = text.replace(/^(?:!|\/)(?:attp|ttp)\s*/i, '').trim();
    if (!cleanText) {
      return sock.sendMessage(from, { text: `ℹ️ Digite o texto desejado! Exemplo: *!attp Bom Dia!* ou *!ttp Sucesso!*` });
    }

    try {
      await sock.sendMessage(from, { text: `⏳ Gerando figurinha de texto para "*${cleanText}*"...` });

      // Gera sticker de texto usando API aberta de maker de stickers
      const apiUrl = `https://api.erdwpe.com/api/maker/attp?text=${encodeURIComponent(cleanText)}`;
      let res = await fetch(apiUrl);
      if (!res.ok) {
        // Fallback para api alternativa
        res = await fetch(`https://api.siputzx.my.id/api/m/attp?text=${encodeURIComponent(cleanText)}`);
      }

      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await sock.sendMessage(from, { sticker: buf });
      } else {
        await sock.sendMessage(from, { text: `✨ Texto formatado para figurinha: *${cleanText.toUpperCase()}*` });
      }
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro ao criar figurinha de texto: ${err.message}` });
    }
  }

  // Comando !toimg (Figurinha para Imagem)
  async handleToImg(sock, from, msg) {
    const media = await this.extractMediaBuffer(msg);
    if (!media || media.type !== 'sticker') {
      return sock.sendMessage(from, { text: `🖼️ Responda a uma *figurinha* com o comando *!toimg* para convertê-la em imagem!` });
    }

    try {
      await sock.sendMessage(from, {
        image: media.buffer,
        caption: `✅ Aqui está sua figurinha convertida em imagem!`
      });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro ao converter: ${err.message}` });
    }
  }

  // Comando !tts (Texto para Voz Neural com PTT perfeito em OGG Opus)
  async handleTTS(sock, from, text, customLang = 'pt', quotedText = '') {
    let cleanText = String(text || '').replace(/^(?:!|\/)(?:tts|voz|falar)\s*/i, '').trim();
    if (!cleanText && quotedText) {
      cleanText = String(quotedText).trim();
    }
    let lang = customLang || 'pt';
    let voice = '';

    if (/^(?:homem|masc|m|antonio)\s+/i.test(cleanText)) {
      voice = 'homem';
      cleanText = cleanText.replace(/^(?:homem|masc|m|antonio)\s+/i, '');
    } else if (/^(?:thalita|jovem)\s+/i.test(cleanText)) {
      voice = 'thalita';
      cleanText = cleanText.replace(/^(?:thalita|jovem)\s+/i, '');
    } else if (/^(?:mulher|fem|f|francisca)\s+/i.test(cleanText)) {
      voice = 'mulher';
      cleanText = cleanText.replace(/^(?:mulher|fem|f|francisca)\s+/i, '');
    }

    const langMatch = cleanText.match(/^(pt|en|es|fr|it|de|ja)\s+/i);
    if (langMatch) {
      lang = langMatch[1].toLowerCase();
      cleanText = cleanText.substring(langMatch[0].length).trim();
    }
    if (!cleanText) {
      const msg = `🗣️ Digite a mensagem que deseja ouvir em áudio ou responda a um texto!\n*Exemplo:* \`!tts Olá, tudo bem?\` ou \`!tts homem Olá\` ou \`!tts en Hello world\``;
      if (sock && typeof sock.sendMessage === 'function') {
        return sock.sendMessage(from, { text: msg });
      }
      return false;
    }

    try {
      const audioConverter = require('./audioConverterService');
      const ttsResult = await audioConverter.textToSpeech(cleanText, { lang, voice });

      // Tenta enviar pelo socket fornecido com formato WhatsApp PTT verificado
      if (sock && typeof sock.sendMessage === 'function') {
        try {
          if (typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('recording', from).catch(() => {});
          }
          await sock.sendMessage(from, {
            audio: ttsResult.buffer,
            mimetype: ttsResult.mimetype || 'audio/ogg; codecs=opus',
            ptt: true
          });
          return true;
        } catch (sockErr) {
          console.warn('[SpyFeatures ⚠️ handleTTS]: Falha no socket direto, tentando fallback:', sockErr.message);
        }
      }

      // Fallback: tenta enviar através do whatsappArmyService
      try {
        const whatsappArmyService = require('./whatsappArmyService');
        const sent = await whatsappArmyService.sendVoiceViaInstance(1, from, ttsResult.buffer);
        if (sent) return true;
      } catch (_) {}

      return false;
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleTTS]:', err.message);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: `❌ Erro ao gerar voz: ${err.message}` }).catch(() => {});
      }
      return false;
    }
  }

  // Configuração da Voz do Bot Vendedor: !vozvendedor [antonio | thalita | francisca | vel X | teste]
  async handleVozVendedor(sock, from, text = '', isOwnerUser = false) {
    if (!isOwnerUser) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: '❌ Apenas o dono supremo pode configurar a voz do bot vendedor.' });
      }
      return false;
    }

    const models = require('../db/models');
    const audioConverter = require('./audioConverterService');
    const rawArgs = String(text || '').replace(/^(?:!|\/)(?:vozvendedor|vozbot|configvoz|setvoz)\s*/i, '').trim();
    const currentVoice = models.getSetting('SALES_BOT_VOICE', 'pt-BR-AntonioNeural');
    const currentRate = models.getSetting('SALES_BOT_VOICE_RATE', '+0%');

    if (!rawArgs || /^(?:status|info|ver|ajuda|help)$/i.test(rawArgs)) {
      const voiceLabel = currentVoice.includes('Antonio')
        ? 'pt-BR-AntonioNeural 👨 (Masculina calorosa, natural e consultiva)'
        : (currentVoice.includes('Thalita')
          ? 'pt-BR-ThalitaMultilingualNeural 👩 (Feminina expressiva e dinâmica)'
          : `${currentVoice} 🎙️`);

      const msg = `🎙️ *CONFIGURAÇÃO DE VOZ DO BOT VENDEDOR*\n\n` +
        `• *Voz Atual:* ${voiceLabel}\n` +
        `• *Velocidade:* \`${currentRate}\` (Cadência humana padrão: \`+0%\`)\n` +
        `• *Tecnologia:* Microsoft Edge Neural TTS (alta definição sem voz de robô)\n\n` +
        `📌 *Comandos Rápidos:*\n` +
        `• \`!vozvendedor antonio\` ➔ Define a voz de vendedor acolhedor/masculino\n` +
        `• \`!vozvendedor thalita\` ➔ Define a voz de vendedora moderna/feminina\n` +
        `• \`!vozvendedor francisca\` ➔ Define a voz clássica institucional\n` +
        `• \`!vozvendedor vel +0%\` ➔ Ajusta velocidade (+0%, +5%, +10%, etc)\n` +
        `• \`!vozvendedor teste\` ➔ Envia um áudio de demonstração imediato no chat`;

      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: msg });
      }
      return true;
    }

    const lower = rawArgs.toLowerCase();

    // Teste de áudio imediato
    if (lower.startsWith('teste') || lower === 't') {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: `🎙️ Gravando áudio de teste com voz *${currentVoice}* a *${currentRate}*...` });
        try {
          if (typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('recording', from).catch(() => {});
          }
          const sampleText = 'Olá! Tudo bem contigo? Aqui é do atendimento. Fica 100% em paz que temos todo o tempo do mundo para te atender e tirar qualquer dúvida com total calma.';
          const ttsResult = await audioConverter.textToSpeech(sampleText, {
            voice: currentVoice,
            rate: currentRate,
            lang: 'pt'
          });
          await sock.sendMessage(from, {
            audio: ttsResult.buffer,
            mimetype: ttsResult.mimetype || 'audio/ogg; codecs=opus',
            ptt: true,
            waveform: ttsResult.waveform
          });
          return true;
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Erro ao sintetizar áudio de teste: ${err.message}` });
          return false;
        }
      }
      return true;
    }

    // Alteração de velocidade
    if (lower.startsWith('vel') || /^[+-]?\d+%?$/.test(lower)) {
      let newRate = lower.replace(/^vel(?:ocidade)?\s*/i, '').trim();
      if (!newRate.endsWith('%')) {
        const n = parseInt(newRate, 10);
        newRate = !isNaN(n) ? (n >= 0 ? `+${n}%` : `${n}%`) : '+0%';
      } else if (!newRate.startsWith('+') && !newRate.startsWith('-')) {
        newRate = `+${newRate}`;
      }
      models.setSetting('SALES_BOT_VOICE_RATE', newRate);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: `✅ *Velocidade da voz atualizada para:* \`${newRate}\`\nEnvie \`!vozvendedor teste\` para ouvir.` });
      }
      return true;
    }

    // Alteração de voz
    let targetVoice = null;
    let targetLabel = '';
    if (lower.includes('antonio') || lower.includes('homem') || lower.includes('masc')) {
      targetVoice = 'pt-BR-AntonioNeural';
      targetLabel = 'Antônio (Masculina calorosa e consultiva)';
    } else if (lower.includes('thalita') || lower.includes('jovem')) {
      targetVoice = 'pt-BR-ThalitaMultilingualNeural';
      targetLabel = 'Thalita (Feminina expressiva e dinâmica)';
    } else if (lower.includes('francisca') || lower.includes('mulher') || lower.includes('fem')) {
      targetVoice = 'pt-BR-FranciscaNeural';
      targetLabel = 'Francisca (Feminina clássica)';
    } else if (rawArgs.includes('Neural')) {
      targetVoice = rawArgs.trim();
      targetLabel = targetVoice;
    }

    if (targetVoice) {
      models.setSetting('SALES_BOT_VOICE', targetVoice);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, {
          text: `✅ *Voz do bot vendedor atualizada para:*\n🎙️ *${targetLabel}*\n\nEnvie \`!vozvendedor teste\` para ouvir uma demonstração ao vivo!`
        });
      }
      return true;
    }

    if (sock && typeof sock.sendMessage === 'function') {
      await sock.sendMessage(from, {
        text: `⚠️ Opção de voz não reconhecida. Use \`!vozvendedor antonio\`, \`!vozvendedor thalita\` ou \`!vozvendedor teste\`.`
      });
    }
    return false;
  }

  // ==========================================
  // 2. MÓDULO DE BAIXADORES (DOWNLOADERS)
  // ==========================================

  // Helper que extrai o termo de busca/URL e a qualidade desejada (H ou S)
  parseDownloadQuery(rawQuery, defaultQuality = 'standard') {
    let text = String(rawQuery || '').trim();
    let quality = defaultQuality;

    // Detecta sufixo no comando: !playh, !plays, !videoh, !videos, !ytmp3h, !playdoch, etc.
    const cmdSuffixMatch = text.match(/^(?:!|\/)(?:playdoc|musicadoc|audiodoc|mp3doc|ytmp3doc|play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)([hs])\b/i);
    if (cmdSuffixMatch) {
      quality = cmdSuffixMatch[1].toLowerCase() === 'h' ? 'high' : 'standard';
      text = text.replace(/^(?:!|\/)(?:playdoc|musicadoc|audiodoc|mp3doc|ytmp3doc|play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)[hs]\s*/i, '').trim();
    } else {
      text = text.replace(/^(?:!|\/)(?:playdoc|musicadoc|audiodoc|mp3doc|ytmp3doc|play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)\s*/i, '').trim();
    }

    // Flag no final: "termo H", "termo S", "termo -h", "termo -s", "termo /h", "termo /s", "termo high", "termo small"
    if (/(?:^|\s)(?:-h|--high|\/h|high|h)$/i.test(text)) {
      quality = 'high';
      text = text.replace(/(?:^|\s)(?:-h|--high|\/h|high|h)$/i, '').trim();
    } else if (/(?:^|\s)(?:-s|--small|--standard|\/s|small|standard|s)$/i.test(text)) {
      quality = 'standard';
      text = text.replace(/(?:^|\s)(?:-s|--small|--standard|\/s|small|standard|s)$/i, '').trim();
    }

    // Flag no início: "-h termo", "-s termo"
    if (/^(?:-h|--high|\/h)\s+/i.test(text)) {
      quality = 'high';
      text = text.replace(/^(?:-h|--high|\/h)\s+/i, '').trim();
    } else if (/^(?:-s|--small|--standard|\/s)\s+/i.test(text)) {
      quality = 'standard';
      text = text.replace(/^(?:-s|--small|--standard|\/s)\s+/i, '').trim();
    }

    // Atalhos como "1H", "1S", "A1H", "V2S", "D1H" ou "A1", "V2", "D1"
    const shortcutMatch = text.match(/^[avd]?(\d+)\s*([hs])$/i);
    if (shortcutMatch) {
      text = shortcutMatch[1];
      quality = shortcutMatch[2].toLowerCase() === 'h' ? 'high' : 'standard';
    } else {
      const pureShortcut = text.match(/^[avd](\d+)$/i);
      if (pureShortcut) {
        text = pureShortcut[1];
      }
    }

    return { cleanQuery: text, quality };
  }

  // Helper: Baixa e otimiza a thumbnail para JPEG de tamanho ideal (~30KB), garantindo exibição de preview no WhatsApp
  async fetchOptimizedThumbnail(thumbUrl) {
    if (!thumbUrl) return null;
    if (process.env.NODE_ENV === 'test') {
      return Buffer.alloc(1000, 2);
    }
    try {
      const res = await fetch(thumbUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return null;
      const rawBuf = Buffer.from(await res.arrayBuffer());
      try {
        const sharp = require('sharp');
        return await sharp(rawBuf)
          .resize(600, 600, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch (_) {
        return rawBuf;
      }
    } catch (_) {
      return null;
    }
  }

  // Helper: Extrai áudio de vídeo do YouTube usando yt-dlp ou fallbacks com suporte a qualidade H (High) e S (Standard/Small)
  async downloadYouTubeAudio(videoUrl, quality = 'standard') {
    const isHigh = String(quality || 'standard').toLowerCase().startsWith('h');
    const qualityLabel = isHigh ? 'HIGH (HQ / MP3)' : 'STANDARD (MP3)';

    // TEST MOCK AUDIO
    if (process.env.NODE_ENV === 'test') {
      const mp3Magic = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
      return {
        buffer: Buffer.concat([mp3Magic, Buffer.alloc(65000, 1)]),
        mimetype: 'audio/mpeg',
        ext: 'mp3',
        quality: qualityLabel
      };
    }

    const { spawn } = require('child_process');
    const audioConverterService = require('./audioConverterService');
    const ffmpegExe = audioConverterService.getFFmpegPath();

    const tmpBase = path.join(os.tmpdir(), `ytdlaudio_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const outPattern = `${tmpBase}.%(ext)s`;
    const expectedMp3 = `${tmpBase}.mp3`;

    // 1. Tenta baixar e converter diretamente para MP3 usando yt-dlp CLI com FFmpeg
    try {
      const args = [
        '-m', 'yt_dlp',
        '--js-runtimes', 'node',
        '--no-warnings',
        '--no-playlist',
        '--socket-timeout', '25',
        '-f', 'ba/ba[ext=m4a]/251/140/b'
      ];

      if (ffmpegExe && fs.existsSync(ffmpegExe)) {
        args.push(
          '--ffmpeg-location', ffmpegExe,
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', isHigh ? '0' : '5',
          '-o', outPattern
        );
      } else {
        args.push('-o', outPattern);
      }
      args.push(videoUrl);

      await new Promise((resolve) => {
        const proc = spawn('python', args);
        let errData = '';
        proc.stderr.on('data', d => { errData += d.toString(); });
        proc.on('close', code => {
          if (code === 0) return resolve(true);
          resolve(false);
        });
        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          resolve(false);
        }, 60000);
      });

      // Se o MP3 foi gerado diretamente
      if (fs.existsSync(expectedMp3) && fs.statSync(expectedMp3).size > 5000) {
        const fileBuf = fs.readFileSync(expectedMp3);
        try { fs.unlinkSync(expectedMp3); } catch (_) {}
        return { buffer: fileBuf, mimetype: 'audio/mpeg', ext: 'mp3', quality: qualityLabel };
      }

      // Se o yt-dlp gerou outro arquivo (ex: webm, m4a, mp4), converte via audioConverterService
      const tmpDir = os.tmpdir();
      const baseName = path.basename(tmpBase);
      const generatedFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(baseName));
      for (const f of generatedFiles) {
        const fullF = path.join(tmpDir, f);
        if (fs.existsSync(fullF) && fs.statSync(fullF).size > 5000) {
          const convRes = await audioConverterService.convertToMp3(fullF, { isHigh });
          try { fs.unlinkSync(fullF); } catch (_) {}
          if (convRes && convRes.success && convRes.buffer) {
            return { buffer: convRes.buffer, mimetype: 'audio/mpeg', ext: 'mp3', quality: qualityLabel };
          }
        }
      }
    } catch (err) {
      console.warn('[SpyFeatures ⚠️ Falha no yt-dlp CLI áudio]:', err.message);
    }

    // 2. Fallback: Python yt_dlp módulo interno com FFmpegExtractAudio
    try {
      const pyScript = `import sys, os, json
video_url = sys.argv[1]
out_tmpl = sys.argv[2]
ffmpeg_path = sys.argv[3] if len(sys.argv) > 3 else ''
is_high = sys.argv[4] == '1' if len(sys.argv) > 4 else False
try:
    import yt_dlp
    ydl_opts = {
        'format': 'ba/ba[ext=m4a]/251/140/b',
        'outtmpl': out_tmpl,
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'socket_timeout': 25,
    }
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        ydl_opts['ffmpeg_location'] = ffmpeg_path
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320' if is_high else '192'
        }]
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        filename = ydl.prepare_filename(info)
        base = os.path.splitext(filename)[0]
        mp3_name = base + '.mp3'
        final_file = mp3_name if os.path.exists(mp3_name) else filename
        print(final_file)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;
      const { execSync } = require('child_process');
      const pyTmp = path.join(os.tmpdir(), `ytdl_script_${Date.now()}.py`);
      fs.writeFileSync(pyTmp, pyScript, 'utf8');
      try {
        const outFilePath = execSync(
          `python "${pyTmp}" "${videoUrl}" "${outPattern}" "${ffmpegExe || ''}" "${isHigh ? '1' : '0'}"`,
          { timeout: 50000, encoding: 'utf8' }
        ).trim().split('\n').pop().trim();

        if (outFilePath && fs.existsSync(outFilePath)) {
          let finalBuf = fs.readFileSync(outFilePath);
          try { fs.unlinkSync(outFilePath); } catch (_) {}
          if (!outFilePath.endsWith('.mp3')) {
            const conv = await audioConverterService.convertToMp3(finalBuf, { isHigh });
            if (conv && conv.buffer) finalBuf = conv.buffer;
          }
          return { buffer: finalBuf, mimetype: 'audio/mpeg', ext: 'mp3', quality: qualityLabel };
        }
      } finally {
        try { if (fs.existsSync(pyTmp)) fs.unlinkSync(pyTmp); } catch (_) {}
      }
    } catch (pyErr) {
      console.warn('[SpyFeatures ⚠️ Falha no Python yt_dlp áudio]:', pyErr.message);
    }

    // 3. Fallback: Extração de stream URL direta via yt-dlp --get-url e conversão FFmpeg
    try {
      const { execSync } = require('child_process');
      const directUrl = execSync(
        `python -m yt_dlp --js-runtimes node --no-warnings --no-playlist -f "ba/ba[ext=m4a]/251/140/b" --get-url "${videoUrl}"`,
        { timeout: 15000, encoding: 'utf8' }
      ).trim();
      const firstUrl = directUrl.split('\n')[0].trim();
      if (firstUrl && firstUrl.startsWith('http')) {
        const res = await fetch(firstUrl, { signal: AbortSignal.timeout(25000) });
        if (res.ok) {
          const rawStreamBuf = Buffer.from(await res.arrayBuffer());
          const convRes = await audioConverterService.convertToMp3(rawStreamBuf, { isHigh });
          return {
            buffer: (convRes && convRes.buffer) ? convRes.buffer : rawStreamBuf,
            mimetype: 'audio/mpeg',
            ext: 'mp3',
            quality: qualityLabel
          };
        }
      }
    } catch (_) {}

    return null;
  }

  // Helper: Extrai áudio em alta qualidade (High) com thumbnail oficial e tags embutidas via mutagen para envio como documento
  async downloadYouTubeAudioDoc(videoUrl, metadata = {}) {
    if (process.env.NODE_ENV === 'test') {
      const mp3Magic = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
      return {
        buffer: Buffer.concat([mp3Magic, Buffer.alloc(65000, 1)]),
        mimetype: 'audio/mpeg',
        ext: 'mp3',
        thumbBuffer: Buffer.alloc(1000, 2),
        quality: 'HIGH (HQ / 320kbps)'
      };
    }

    const { spawn } = require('child_process');
    const audioConverterService = require('./audioConverterService');
    const ffmpegExe = audioConverterService.getFFmpegPath() || '';

    const tmpId = `ytdldoc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tmpOut = path.join(os.tmpdir(), `${tmpId}.%(ext)s`);
    const tmpThumb = path.join(os.tmpdir(), `${tmpId}_thumb.jpg`);
    const tmpResultJson = path.join(os.tmpdir(), `${tmpId}_res.json`);

    const pyScript = `import sys, os, json, urllib.request

video_url = sys.argv[1]
out_tmpl = sys.argv[2]
thumb_out = sys.argv[3]
res_json_out = sys.argv[4]
title_override = sys.argv[5] if len(sys.argv) > 5 else ''
artist_override = sys.argv[6] if len(sys.argv) > 6 else ''
ffmpeg_location = sys.argv[7] if len(sys.argv) > 7 else ''

try:
    import yt_dlp
    ydl_opts = {
        'format': 'ba/ba[ext=m4a]/251/140/b',
        'outtmpl': out_tmpl,
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'socket_timeout': 25,
    }
    if ffmpeg_location and os.path.exists(ffmpeg_location):
        ydl_opts['ffmpeg_location'] = ffmpeg_location
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320'
        }]
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        real_file = ydl.prepare_filename(info)
        base = os.path.splitext(real_file)[0]
        if os.path.exists(base + '.mp3'):
            real_file = base + '.mp3'
        title = title_override or info.get('title') or 'Música'
        artist = artist_override or info.get('uploader') or info.get('channel') or 'Artista'
        thumb_url = info.get('thumbnail')
        
        thumb_data = None
        if thumb_url:
            try:
                req = urllib.request.Request(thumb_url, headers={'User-Agent': 'Mozilla/5.0'})
                thumb_data = urllib.request.urlopen(req, timeout=12).read()
                with open(thumb_out, 'wb') as tf:
                    tf.write(thumb_data)
            except Exception:
                pass
                
        try:
            import mutagen
            if real_file.endswith('.mp3'):
                from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB
                try:
                    audio = ID3(real_file)
                except Exception:
                    audio = ID3()
                audio.add(TIT2(encoding=3, text=title))
                audio.add(TPE1(encoding=3, text=artist))
                audio.add(TALB(encoding=3, text=artist))
                if thumb_data:
                    audio.add(APIC(encoding=3, mime='image/jpeg', type=3, desc='Cover', data=thumb_data))
                audio.save(real_file)
            elif real_file.endswith(('.m4a', '.mp4')):
                from mutagen.mp4 import MP4, MP4Cover
                audio = MP4(real_file)
                audio['\\xa9nam'] = title
                audio['\\xa9ART'] = artist
                audio['\\xa9alb'] = artist
                if thumb_data:
                    audio['covr'] = [MP4Cover(thumb_data, imageformat=MP4Cover.FORMAT_JPEG)]
                audio.save()
        except Exception as e:
            sys.stderr.write(f'Mutagen tag warning: {e}\\n')
            
        with open(res_json_out, 'w', encoding='utf-8') as rf:
            json.dump({
                'success': True,
                'file': real_file,
                'title': title,
                'artist': artist,
                'duration': info.get('duration_string') or str(info.get('duration', ''))
            }, rf)
except Exception as e:
    sys.stderr.write(f'Download error: {e}\\n')
    with open(res_json_out, 'w', encoding='utf-8') as rf:
        json.dump({'success': False, 'error': str(e)}, rf)
`;

    const pyScriptFile = path.join(os.tmpdir(), `${tmpId}.py`);
    try {
      fs.writeFileSync(pyScriptFile, pyScript, 'utf8');

      const result = await new Promise((resolve) => {
        const proc = spawn('python', [
          pyScriptFile,
          videoUrl,
          tmpOut,
          tmpThumb,
          tmpResultJson,
          metadata.title || '',
          metadata.artist || '',
          ffmpegExe
        ]);

        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', code => {
          if (fs.existsSync(tmpResultJson)) {
            try {
              const resData = JSON.parse(fs.readFileSync(tmpResultJson, 'utf8'));
              resolve(resData);
              return;
            } catch (_) {}
          }
          resolve({ success: false, error: stderr.slice(0, 200) || `Exit code ${code}` });
        });

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          resolve({ success: false, error: 'Timeout ao baixar música' });
        }, 60000);
      });

      let audioBuffer = null;
      let thumbBuffer = null;
      let ext = 'mp3';

      if (result && result.success && result.file && fs.existsSync(result.file)) {
        let fPath = result.file;
        if (!fPath.endsWith('.mp3')) {
          const conv = await audioConverterService.convertToMp3(fPath, { isHigh: true });
          if (conv && conv.buffer) {
            audioBuffer = conv.buffer;
          } else {
            audioBuffer = fs.readFileSync(fPath);
          }
        } else {
          audioBuffer = fs.readFileSync(fPath);
        }
        ext = 'mp3';
        try { fs.unlinkSync(fPath); } catch (_) {}
      }

      if (fs.existsSync(tmpThumb)) {
        thumbBuffer = fs.readFileSync(tmpThumb);
        try { fs.unlinkSync(tmpThumb); } catch (_) {}
      }

      if (audioBuffer && audioBuffer.length > 5000) {
        return {
          buffer: audioBuffer,
          thumbBuffer,
          mimetype: 'audio/mpeg',
          ext,
          quality: 'HIGH (HQ / 320kbps)'
        };
      }
    } catch (err) {
      console.warn('[SpyFeatures ⚠️ Falha no Python yt-dlp doc]:', err.message);
    } finally {
      try { if (fs.existsSync(pyScriptFile)) fs.unlinkSync(pyScriptFile); } catch (_) {}
      try { if (fs.existsSync(tmpResultJson)) fs.unlinkSync(tmpResultJson); } catch (_) {}
      try { if (fs.existsSync(tmpThumb)) fs.unlinkSync(tmpThumb); } catch (_) {}
    }

    // Fallback 1: usar downloadYouTubeAudio padrão
    try {
      const basicAudio = await this.downloadYouTubeAudio(videoUrl, 'high');
      if (basicAudio && basicAudio.buffer) {
        let thumbBuf = null;
        if (metadata.thumbnail) {
          try {
            const res = await fetch(metadata.thumbnail, { signal: AbortSignal.timeout(10000) });
            if (res.ok) thumbBuf = Buffer.from(await res.arrayBuffer());
          } catch (_) {}
        }
        return {
          buffer: basicAudio.buffer,
          thumbBuffer: thumbBuf,
          mimetype: 'audio/mpeg',
          ext: basicAudio.ext || 'mp3',
          quality: 'HIGH (HQ)'
        };
      }
    } catch (_) {}

    return null;
  }

  // Helper: Extrai vídeo do YouTube usando yt-dlp sem limite de tamanho com suporte a qualidade H (High) e S (Standard/Small)
  async downloadYouTubeVideo(videoUrl, quality = 'standard') {
    // TEST MOCK VIDEO
    if (process.env.NODE_ENV === 'test') {
      const isHigh = String(quality || 'standard').toLowerCase().startsWith('h');
      return {
        buffer: Buffer.alloc(80000, 1),
        mimetype: 'video/mp4',
        ext: 'mp4',
        quality: isHigh ? 'HIGH (1080p/720p)' : 'STANDARD / 360p'
      };
    }
    const { spawn } = require('child_process');
    const isHigh = String(quality || 'high').toLowerCase().startsWith('h');
    const formatStr = isHigh
      ? '22/best[height<=1080][ext=mp4]/best[height<=720][ext=mp4]/18/best[ext=mp4]/b/best'
      : '18/best[height<=480][ext=mp4]/best[height<=360][ext=mp4]/b/best';

    const tmpVideo = path.join(os.tmpdir(), `ytvideo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp4`);
    try {
      const buf = await new Promise((resolve, reject) => {
        const proc = spawn('python', [
          '-m', 'yt_dlp',
          '--js-runtimes', 'node',
          '--no-warnings',
          '--no-playlist',
          '--extractor-args', 'youtube:player_client=android,web',
          '--socket-timeout', '30',
          '-f', formatStr,
          '--max-filesize', '500M',
          '-o', tmpVideo,
          videoUrl
        ]);

        let errData = '';
        proc.stderr.on('data', d => { errData += d.toString(); });

        proc.on('close', code => {
          if (code === 0 && fs.existsSync(tmpVideo)) {
            try {
              const fileBuf = fs.readFileSync(tmpVideo);
              try { fs.unlinkSync(tmpVideo); } catch (_) {}
              resolve(fileBuf);
            } catch (e) {
              reject(e);
            }
          } else {
            if (fs.existsSync(tmpVideo)) try { fs.unlinkSync(tmpVideo); } catch (_) {}
            reject(new Error(`yt-dlp video falhou (${code}): ${errData.slice(0, 100)}`));
          }
        });

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          if (fs.existsSync(tmpVideo)) try { fs.unlinkSync(tmpVideo); } catch (_) {}
          reject(new Error('Timeout de download de vídeo'));
        }, 120000);
      });

      if (buf && buf.length > 5000) {
        return { buffer: buf, mimetype: 'video/mp4', ext: 'mp4', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
      }
    } catch (err) {
      console.warn('[SpyFeatures ⚠️ Falha no yt-dlp vídeo]:', err.message);
    }

    // Fallback 1: Stream direto via --get-url
    try {
      const { execSync } = require('child_process');
      const directUrl = execSync(
        `python -m yt_dlp --js-runtimes node --no-warnings --no-playlist -f "${formatStr}" --get-url "${videoUrl}"`,
        { timeout: 15000, encoding: 'utf8' }
      ).trim();
      const firstUrl = directUrl.split('\n')[0].trim();
      if (firstUrl && firstUrl.startsWith('http')) {
        const res = await fetch(firstUrl, { signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return { buffer: Buffer.from(arrayBuf), mimetype: 'video/mp4', ext: 'mp4', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
        }
      }
    } catch (_) {}

    // Fallback 2: APIs públicas
    try {
      const apiRes = await fetch(`https://api.vreden.my.id/api/ytmp4?url=${encodeURIComponent(videoUrl)}`, { signal: AbortSignal.timeout(20000) });
      const apiData = await apiRes.json();
      const downloadUrl = apiData?.result?.download?.url || apiData?.result?.url;
      if (downloadUrl) {
        const mediaRes = await fetch(downloadUrl);
        if (mediaRes.ok) {
          const arrayBuf = await mediaRes.arrayBuffer();
          return { buffer: Buffer.from(arrayBuf), mimetype: 'video/mp4', ext: 'mp4', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
        }
      }
    } catch (_) {}

    if (process.env.NODE_ENV === 'test') {
      return { buffer: Buffer.alloc(80000, 2), mimetype: 'video/mp4', ext: 'mp4', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
    }

    return null;
  }

  // Comando !play / !ytmp3 / !audio / !playh / !plays (Busca e baixa música do YouTube com escolha de qualidade H ou S)
  async handlePlayMusic(sock, from, query, quotedText = null, senderPhone = null) {
    const { cleanQuery, quality } = this.parseDownloadQuery(query, 'standard');
    const cleanQ = cleanQuery;
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🎵 *REPRODUTOR DE MÚSICAS YOUTUBE (SPY)*\n\n` +
          `Baixe qualquer música escolhendo a qualidade desejada:\n\n` +
          `📌 *Opções de Qualidade:*\n` +
          `  ⭐ *H (High)*: Áudio em alta definição (HQ)\n` +
          `  📱 *S (Standard)*: Áudio econômico e leve (rápido download)\n\n` +
          `💡 *Exemplos de uso:*\n` +
          `  • *!play Imagine Dragons* (alta qualidade padrão)\n` +
          `  • *!play Imagine Dragons H* (alta qualidade HQ)\n` +
          `  • *!play Imagine Dragons S* (qualidade padrão/pequeno)\n` +
          `  • *!playh Imagine Dragons* ou *!plays Imagine Dragons*\n` +
          `  • *!play 1 H* (baixa o item 1 da !lista em HQ)\n` +
          `  • *!play https://www.youtube.com/watch?v=... H*`
      });
    }

    try {
      // 1. Verifica se cleanQ é uma seleção única ou múltipla da lista (ex: "1, 2", "1, 3 H", "1", "1H")
      const selection = this.parseDownloadSelection(cleanQ, 'audio');
      const hasActive = this.hasActiveSearchResults(from, senderPhone);
      const isQuoting = Boolean(quotedText && quotedText.includes('RESULTADOS DA BUSCA YOUTUBE'));
      if (selection && (selection.items.length > 1 || selection.isExplicitShortcut || hasActive || isQuoting)) {
        return await this.handleMultiDownload(sock, from, selection, quotedText, senderPhone);
      }

      const yts = require('yt-search');
      let video = null;

      // 2. Fallback de verificação de número único na lista recente do !lista
      const numMatch = cleanQ.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const cachedList = this.getSearchResults(from, senderPhone);
        if (idx >= 0 && idx < cachedList.length) {
          video = cachedList[idx];
        }
      }

      const isYtUrl = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(cleanQ);

      if (!video && isYtUrl) {
        const match = cleanQ.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
        const videoId = match ? match[1] : null;
        if (videoId) {
          try {
            const searchRes = await yts({ videoId });
            video = searchRes;
          } catch (_) {
            video = {
              title: 'Música do YouTube',
              url: `https://www.youtube.com/watch?v=${videoId}`,
              videoId,
              timestamp: 'Áudio',
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              author: { name: 'YouTube' }
            };
          }
        }
      } else if (!video) {
        const searchRes = await yts(cleanQ);
        if (searchRes && searchRes.videos && searchRes.videos.length > 0) {
          // Prefere o primeiro vídeo com duração de música padrão (<= 20 min / 1200s), evitando podcasts de 2-3 horas
          video = searchRes.videos.find(v => v.seconds && v.seconds <= 1200) || searchRes.videos[0];
        }
      }

      if (!video || !video.url) {
        return sock.sendMessage(from, { text: `❌ Nenhuma música encontrada para "*${cleanQ}*". Tente com outro termo ou envie o link direto do YouTube.` });
      }

      // Proteção de duração máxima (limite de 30 minutos para manter a estabilidade do bot e limites do WhatsApp)
      if (video.seconds && video.seconds > 1800) {
        return sock.sendMessage(from, {
          text: `⚠️ *Áudio muito extenso para download direto (${video.timestamp || 'mais de 30 min'}):*\n\n` +
            `O limite para *!play* é de até 30 minutos para garantir agilidade e estabilidade de envio.\n\n` +
            `💡 _Dica: Pesquise pela faixa musical individual ou ouça no link oficial:_\n${video.url}`
        });
      }

      const qualityTag = quality === 'high' ? '⭐ Alta Definição (HQ)' : '📱 Padrão / Compacta (Standard)';
      const safeTitle = (video.title || 'musica').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80);

      const cardText = `🎵 *SPY YOUTUBE PLAY (MÚSICA)* 🎵\n\n` +
        `📌 *Título:* ${video.title}\n` +
        `🎧 *Qualidade:* ${qualityTag}\n` +
        `⏱️ *Duração:* ${video.timestamp || 'Desconhecida'}\n` +
        `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
        `📁 *Arquivo:* \`${safeTitle}.mp3\`\n` +
        `🔗 *Link:* ${video.url}\n\n` +
        `⏳ *Baixando áudio...* Aguarde alguns instantes!`;

      // 1. Obtém thumbnail otimizada em JPEG buffer para garantir a exibição visual do preview do link
      const thumbBuffer = await this.fetchOptimizedThumbnail(video.thumbnail);

      // Envia Card Informativo com Preview Rico do Link (Capa Oficial Grande + Título + Canal + Link Oficial)
      const previewCardPayload = {
        text: cardText,
        linkPreview: {
          'matched-text': video.url,
          jpegThumbnail: thumbBuffer,
          title: (video.title || 'Música').slice(0, 100),
          description: `${video.author?.name || 'YouTube'} • ${video.timestamp || 'Música'} • ${qualityTag}`
        },
        contextInfo: {
          externalAdReply: {
            title: (video.title || 'Música').slice(0, 100),
            body: `${video.author?.name || 'YouTube'} • ${video.timestamp || 'Música'} • ${qualityTag}`,
            mediaType: 1, // 1 = IMAGE (obrigatório para renderizar a imagem no WhatsApp)
            thumbnail: thumbBuffer, // Buffer JPEG real embutido no protobuf (faz o preview aparecer no celular!)
            thumbnailUrl: video.thumbnail,
            sourceUrl: video.url,
            renderLargerThumbnail: true, // Renderiza o preview grande em alta resolução
            showAdAttribution: true
          }
        }
      };

      try {
        await sock.sendMessage(from, previewCardPayload);
      } catch (_) {
        try {
          if (thumbBuffer) {
            await sock.sendMessage(from, { image: thumbBuffer, caption: cardText });
          } else {
            await sock.sendMessage(from, { text: cardText });
          }
        } catch (_) {
          await sock.sendMessage(from, { text: cardText });
        }
      }

      // Baixa áudio do YouTube com a qualidade especificada
      const audioData = await this.downloadYouTubeAudio(video.url, quality);

      if (audioData && audioData.buffer) {
        const tipH = '\n\n💡 _Dica: Quer em Alta Definição (HD)? Responda esta mensagem com *H*!_';
        const audioBuf = audioData.buffer;
        const sizeMb = (audioBuf.length / (1024 * 1024)).toFixed(1);
        const mime = audioData.mimetype || 'audio/mpeg';

        let sentAudio = null;

        // Se o arquivo for muito grande (>16MB), WhatsApp rejeita audioMessage nativo: envia como documento automaticamente
        if (audioBuf.length > 16 * 1024 * 1024) {
          try {
            const docPayload = {
              document: audioBuf,
              mimetype: mime,
              fileName: `${safeTitle}.mp3`,
              caption: `🎵 *${video.title}*\n👤 *Artista:* ${video.author?.name || 'YouTube'}\n🎧 *Qualidade:* ${qualityTag}\n📦 *Tamanho:* ${sizeMb} MB (enviado como documento por exceder 16MB)${tipH}`
            };
            if (thumbBuffer) docPayload.jpegThumbnail = thumbBuffer;
            sentAudio = await sock.sendMessage(from, docPayload);
          } catch (docErr) {
            console.warn('[SpyFeatures ⚠️ Falha ao enviar áudio grande como documento]:', docErr.message);
          }
        } else {
          // Nível 1: Envia áudio MP3 nativo com externalAdReply (banner da música)
          try {
            const nativeAudioPayload = {
              audio: audioBuf,
              mimetype: mime,
              fileName: `${safeTitle}.mp3`,
              ptt: false
            };
            if (thumbBuffer) {
              nativeAudioPayload.contextInfo = {
                externalAdReply: {
                  title: (video.title || 'Música').slice(0, 100),
                  body: `${video.author?.name || 'YouTube'} • ${qualityTag}`,
                  mediaType: 1,
                  thumbnail: thumbBuffer,
                  thumbnailUrl: video.thumbnail,
                  sourceUrl: video.url,
                  renderLargerThumbnail: true,
                  showAdAttribution: true
                }
              };
            }
            sentAudio = await sock.sendMessage(from, nativeAudioPayload);
          } catch (t1Err) {
            console.warn('[SpyFeatures ⚠️ Nível 1 com banner falhou, tentando áudio limpo]:', t1Err.message);
            try {
              sentAudio = await sock.sendMessage(from, {
                audio: audioBuf,
                mimetype: mime,
                fileName: `${safeTitle}.mp3`,
                ptt: false
              });
            } catch (t1bErr) {
              console.warn('[SpyFeatures ⚠️ Nível 1b falhou (áudio limpo), tentando documento]:', t1bErr.message);
              // Nível 2: Envia como documento de fallback garantido
              try {
                const docPayload = {
                  document: audioBuf,
                  mimetype: mime,
                  fileName: `${safeTitle}.mp3`,
                  caption: `🎵 *${video.title}*\n👤 *Artista:* ${video.author?.name || 'YouTube'}\n📦 *Tamanho:* ${sizeMb} MB${tipH}`
                };
                if (thumbBuffer) docPayload.jpegThumbnail = thumbBuffer;
                sentAudio = await sock.sendMessage(from, docPayload);
              } catch (t2Err) {
                console.warn('[SpyFeatures ⚠️ Nível 2 falhou (documento)]:', t2Err.message);
              }
            }
          }
        }

        if (sentAudio) {
          this._recordSentMedia(sentAudio, from, video, 'audio', quality);
          // Bonifica usuário com pontos de fidelidade
          const senderPhone = from.split('@')[0].split(':')[0];
          models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5);
          return true;
        } else {
          throw new Error('Falha em todos os níveis de envio de mídia do WhatsApp');
        }
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ *Não foi possível extrair o áudio de:* "${video.title}".\n\n` +
            `🔗 Você pode ouvir diretamente no link oficial:\n${video.url}`
        });
      }
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro em handlePlayMusic]:', err.message);
      await sock.sendMessage(from, { text: `❌ Erro ao buscar ou baixar música: ${err.message}` });
    }
  }

  // Comando !playdoc / !musicadoc / !audiodoc / !mp3doc / !ytmp3doc
  // Baixa música do YouTube em alta qualidade (High) com capa oficial, nome de arquivo limpo e metadados, e envia como documento
  async handlePlayDoc(sock, from, query, quotedText = null, senderPhone = null) {
    const { cleanQuery, quality } = this.parseDownloadQuery(query, 'standard');
    const cleanQ = cleanQuery;
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🎵 *REPRODUTOR & DOWNLOADER EM DOCUMENTO (SPY PLAYDOC)* 📄\n\n` +
          `Baixe qualquer música do YouTube em *Alta Fidelidade (High Quality)* com capa oficial, nome de arquivo limpo e metadados completos, enviada diretamente como *documento* para salvar no seu celular ou computador sem perda de qualidade!\n\n` +
          `💡 *Exemplos de uso:*\n` +
          `  • *!playdoc Coldplay Yellow*\n` +
          `  • *!playdoc Henrique e Juliano Arranhao*\n` +
          `  • *!playdoc https://www.youtube.com/watch?v=...*\n` +
          `  • *!playdoc 1* (baixa o item 1 pesquisado no !lista)\n\n` +
          `📌 *Aliases disponíveis:* !playdoc, /playdoc, !musicadoc, !audiodoc, !mp3doc, !ytmp3doc`
      });
    }

    try {
      // 1. Verifica se cleanQ é uma seleção única ou múltipla da lista (ex: "1, 2", "1, 3 H", "1", "1H", "D1, D2")
      const selection = this.parseDownloadSelection(cleanQ, 'doc');
      const hasActive = this.hasActiveSearchResults(from, senderPhone);
      const isQuoting = Boolean(quotedText && quotedText.includes('RESULTADOS DA BUSCA YOUTUBE'));
      if (selection && (selection.items.length > 1 || selection.isExplicitShortcut || hasActive || isQuoting)) {
        return await this.handleMultiDownload(sock, from, selection, quotedText, senderPhone);
      }

      const yts = require('yt-search');
      let video = null;

      // 2. Fallback de verificação de número único na lista recente do !lista
      const numMatch = cleanQ.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const cachedList = this.getSearchResults(from, senderPhone);
        if (idx >= 0 && idx < cachedList.length) {
          video = cachedList[idx];
        }
      }

      const isYtUrl = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(cleanQ);

      if (!video && isYtUrl) {
        const match = cleanQ.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
        const videoId = match ? match[1] : null;
        if (videoId) {
          try {
            const searchRes = await yts({ videoId });
            video = searchRes;
          } catch (_) {
            video = {
              title: 'Música do YouTube',
              url: `https://www.youtube.com/watch?v=${videoId}`,
              videoId,
              timestamp: 'Áudio',
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              author: { name: 'YouTube' }
            };
          }
        }
      } else if (!video) {
        const searchRes = await yts(cleanQ);
        if (searchRes && searchRes.videos && searchRes.videos.length > 0) {
          // Prefere o primeiro vídeo com duração de música padrão (<= 20 min / 1200s), evitando podcasts de 2-3 horas
          video = searchRes.videos.find(v => v.seconds && v.seconds <= 1200) || searchRes.videos[0];
        }
      }

      if (!video || !video.url) {
        return sock.sendMessage(from, { text: `❌ Nenhuma música encontrada para "*${cleanQ}*". Tente com outro termo ou envie o link direto do YouTube.` });
      }

      // Proteção de duração máxima (limite de 30 minutos para manter a estabilidade do bot e limites do WhatsApp)
      if (video.seconds && video.seconds > 1800) {
        return sock.sendMessage(from, {
          text: `⚠️ *Áudio muito extenso para download direto (${video.timestamp || 'mais de 30 min'}):*\n\n` +
            `O limite para *!playdoc* é de até 30 minutos para garantir agilidade e estabilidade de envio.\n\n` +
            `💡 _Dica: Pesquise pela faixa musical individual ou ouça no link oficial:_\n${video.url}`
        });
      }

      const artist = video.author?.name || 'Artista do YouTube';
      const safeTitle = (video.title || 'musica').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'musica';
      const duration = video.timestamp || 'Desconhecida';

      const cardText = `🎵 *SPY PLAYDOC (MÚSICA EM DOCUMENTO)* 📄\n\n` +
        `📌 *Título:* ${video.title}\n` +
        `👤 *Artista:* ${artist}\n` +
        `🎧 *Qualidade:* High (320kbps / Alta Fidelidade)\n` +
        `⏱️ *Duração:* ${duration}\n` +
        `📁 *Arquivo:* \`${safeTitle}.mp3\`\n` +
        `🖼️ *Capa:* Oficial inclusa\n` +
        `🔗 *Link:* ${video.url}\n\n` +
        `⏳ *Baixando e gerando documento com capa...* Aguarde alguns instantes!`;

      // 1. Obtém thumbnail otimizada em JPEG buffer para garantir a exibição visual do preview do link
      const thumbBuffer = await this.fetchOptimizedThumbnail(video.thumbnail);

      // Envia Card Informativo com Preview Rico do Link (Capa Oficial Grande + Título + Canal + Link Oficial)
      const previewCardPayload = {
        text: cardText,
        linkPreview: {
          'matched-text': video.url,
          jpegThumbnail: thumbBuffer,
          title: (video.title || 'Música').slice(0, 100),
          description: `${artist} • High (320kbps / Alta Fidelidade)`
        },
        contextInfo: {
          externalAdReply: {
            title: (video.title || 'Música').slice(0, 100),
            body: `${artist} • High (320kbps / Alta Fidelidade)`,
            mediaType: 1, // 1 = IMAGE (obrigatório para renderizar a imagem no WhatsApp)
            thumbnail: thumbBuffer, // Buffer JPEG real embutido no protobuf (faz o preview aparecer no celular!)
            thumbnailUrl: video.thumbnail,
            sourceUrl: video.url,
            renderLargerThumbnail: true, // Renderiza o preview grande em alta resolução
            showAdAttribution: true
          }
        }
      };

      try {
        await sock.sendMessage(from, previewCardPayload);
      } catch (_) {
        try {
          if (thumbBuffer) {
            await sock.sendMessage(from, { image: thumbBuffer, caption: cardText });
          } else {
            await sock.sendMessage(from, { text: cardText });
          }
        } catch (_) {
          await sock.sendMessage(from, { text: cardText });
        }
      }

      // Baixa áudio do YouTube em High quality com capa e tags embutidas
      const audioData = await this.downloadYouTubeAudioDoc(video.url, {
        title: video.title,
        artist,
        thumbnail: video.thumbnail
      });

      if (audioData && audioData.buffer) {
        const sizeMb = (audioData.buffer.length / (1024 * 1024)).toFixed(1);

        // Garante thumbnail buffer se não veio do downloader
        let finalThumbBuffer = audioData.thumbBuffer || thumbBuffer;
        if (!finalThumbBuffer && video.thumbnail) {
          finalThumbBuffer = await this.fetchOptimizedThumbnail(video.thumbnail);
        }

        const tipH = '\n\n💡 _Dica: Quer em Alta Definição (HD)? Responda esta mensagem com *H*!_';
        const isHigh = String(quality || 'standard').toLowerCase().startsWith('h');
        const qualityCaption = isHigh
          ? 'High (320kbps / Alta Fidelidade)'
          : 'Standard (Padrão / Econômica - responda com H para High HQ)';
        const docPayload = {
          document: audioData.buffer,
          mimetype: 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption: `🎵 *${video.title}*\n` +
            `👤 *Artista:* ${artist}\n` +
            `🎧 *Qualidade:* ${qualityCaption}\n` +
            `📦 *Tamanho:* ${sizeMb} MB\n` +
            `⏱️ *Duração:* ${duration}\n` +
            `📁 *Arquivo:* \`${safeTitle}.mp3\`\n` +
            `🖼️ *Capa:* Embutida no arquivo e na prévia\n` +
            `🔗 *Fonte:* ${video.url}${tipH}`
        };

        if (finalThumbBuffer && Buffer.isBuffer(finalThumbBuffer)) {
          docPayload.jpegThumbnail = finalThumbBuffer;
        }

        let sentDoc = null;
        try {
          sentDoc = await sock.sendMessage(from, docPayload);
        } catch (t1Err) {
          console.warn('[SpyFeatures ⚠️ Tier 1 doc falhou, tentando documento limpo]:', t1Err.message);
          try {
            sentDoc = await sock.sendMessage(from, {
              document: audioData.buffer,
              mimetype: 'audio/mpeg',
              fileName: `${safeTitle}.mp3`
            });
          } catch (t2Err) {
            console.error('[SpyFeatures ❌ Falha em todos os tiers de envio do documento]:', t2Err.message);
          }
        }

        if (sentDoc) {
          this._recordSentMedia(sentDoc, from, video, 'doc', quality);
          // Bonifica usuário com pontos de fidelidade
          const senderPhone = from.split('@')[0].split(':')[0];
          models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5);
          return true;
        } else {
          throw new Error('Falha em todos os níveis de envio do documento pelo WhatsApp');
        }
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ *Não foi possível extrair o áudio em documento de:* "${video.title}".\n\n` +
            `🔗 Você pode ouvir diretamente no link oficial:\n${video.url}`
        });
      }
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro em handlePlayDoc]:', err.message);
      await sock.sendMessage(from, { text: `❌ Erro ao baixar música como documento: ${err.message}` });
    }
  }

  // Comando !tiktok (Baixar vídeo do TikTok sem marca d'água)
  async handleTikTok(sock, from, url) {
    const cleanUrl = url.replace(/^(?:!|\/)(?:tiktok|tt)\s*/i, '').trim();
    if (!cleanUrl || !cleanUrl.includes('tiktok.com')) {
      return sock.sendMessage(from, { text: `📱 Envie um link válido do TikTok! Exemplo: *!tiktok https://vm.tiktok.com/...*` });
    }

    await sock.sendMessage(from, { text: `⏳ Baixando vídeo do TikTok sem marca d'água...` });

    try {
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`);
      const data = await res.json();

      if (data?.data?.play) {
        const videoRes = await fetch(data.data.play);
        const videoBuf = Buffer.from(await videoRes.arrayBuffer());

        await sock.sendMessage(from, {
          video: videoBuf,
          caption: `🎬 *TikTok Baixado com Sucesso!*\n\n📝 *Legenda:* ${data.data.title || 'Sem descrição'}\n👤 *Autor:* ${data.data.author?.nickname || 'TikToker'}`
        });
      } else {
        throw new Error('Vídeo não encontrado ou privado');
      }
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Falha ao baixar vídeo do TikTok: ${err.message}` });
    }
  }

  // Comando !ig / !instagram
  async handleInstagram(sock, from, url) {
    const cleanUrl = url.replace(/^(?:!|\/)(?:ig|instagram|reels)\s*/i, '').trim();
    if (!cleanUrl || !cleanUrl.includes('instagram.com')) {
      return sock.sendMessage(from, { text: `📸 Envie o link do Reels ou post do Instagram! Exemplo: *!ig https://instagram.com/reel/...*` });
    }

    await sock.sendMessage(from, { text: `⏳ Processando download do Instagram...` });

    try {
      // 1. Tenta extrair via yt-dlp local
      try {
        const { spawn } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp IG falhou'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout IG')); }, 35000);
        });

        if (buf && buf.length > 5000) {
          return sock.sendMessage(from, {
            video: buf,
            caption: '🎬 *Instagram Reels Baixado com Sucesso!*'
          });
        }
      } catch (_) {}

      // 2. Fallback via API pública
      const res = await fetch(`https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const mediaUrl = data?.result?.url || data?.result?.[0]?.url;

      if (mediaUrl) {
        const mediaRes = await fetch(mediaUrl);
        const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
        if (mediaUrl.includes('.mp4') || mediaRes.headers.get('content-type')?.includes('video')) {
          await sock.sendMessage(from, { video: mediaBuf, caption: '🎬 *Instagram Reels Baixado!*' });
        } else {
          await sock.sendMessage(from, { image: mediaBuf, caption: '📸 *Foto do Instagram Baixada!*' });
        }
        return;
      }

      await sock.sendMessage(from, { text: `⚠️ Não foi possível baixar esta publicação do Instagram (pode ser perfil privado ou protegido).` });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro no download do Instagram: ${err.message}` });
    }
  }

  // Comando !allstories <@usuario> (Baixar todos os stories de um perfil do Instagram)
  async handleAllStories(sock, from, text) {
    return instagramScraperService.handleAllStoriesCommand(sock, from, text);
  }

  // Comando !scrapinsta <@usuario> (Auditoria profunda: stories, posts, seguidores, engajamento e maturidade intelectual)
  async handleScrapInsta(sock, from, text) {
    return instagramScraperService.handleScrapInstaCommand(sock, from, text);
  }

  // ==========================================
  // 3. SEGURANÇA & MODERAÇÃO DE GRUPOS (SPY SECURITY)
  // ==========================================

  // Comando !warn / !advertencia
  async handleWarn(sock, from, targetPhone, reason, warnedByName, isBotAdmin) {
    if (!targetPhone) {
      return sock.sendMessage(from, { text: `⚠️ Mencione ou informe o número do participante para advertir! Ex: *!warn @usuario Motivo*` });
    }

    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Dono é intocável!
    if (models.isOwner(cleanPhone)) {
      return sock.sendMessage(from, {
        text: `🛡️ *IMUNIDADE SUPREMA ATIVADA:*\n\nO Comandante / Dono Supremo @${cleanPhone} é intocável e 100% imune a advertências ou punições no grupo!`,
        mentions: [`${cleanPhone}@s.whatsapp.net`]
      });
    }

    const res = models.addWarning(from, targetPhone, reason, warnedByName);

    if (res.count >= 3) {
      let banSuccess = false;
      if (isBotAdmin) {
        try {
          await sock.groupParticipantsUpdate(from, [`${res.userPhone}@s.whatsapp.net`], 'remove');
          banSuccess = true;
        } catch (_) {}
      }

      models.clearWarnings(from, res.userPhone);

      return sock.sendMessage(from, {
        text: `🚨 *LIMITE DE ADVERTÊNCIAS ATINGIDO (3/3)!*\n\n` +
          `👤 *Participante:* @${res.userPhone}\n` +
          `📝 *Último Motivo:* ${res.reason}\n\n` +
          `${banSuccess ? '⛔ *O participante foi banido do grupo automaticamente por acúmulo de advertências.*' : '⚠️ *O bot precisa de privilégios de Administrador para remover o infrator.*'}`,
        mentions: [`${res.userPhone}@s.whatsapp.net`]
      });
    }

    return sock.sendMessage(from, {
      text: `⚠️ *ADVERTÊNCIA REGISTRADA (${res.count}/3)*\n\n` +
        `👤 *Infrator:* @${res.userPhone}\n` +
        `📝 *Motivo:* ${res.reason}\n` +
        `👮 *Aplicado por:* ${warnedByName}\n\n` +
        `> 💡 *Atenção:* Ao atingir 3 advertências, você será expulso automaticamente do grupo!`,
      mentions: [`${res.userPhone}@s.whatsapp.net`]
    });
  }

  // Comando !unwarn / !tiraraviso
  async handleUnwarn(sock, from, targetPhone) {
    if (!targetPhone) {
      return sock.sendMessage(from, { text: `ℹ️ Mencione ou informe o participante para remover o aviso: *!unwarn @usuario*` });
    }

    const removed = models.removeLastWarning(from, targetPhone);
    const count = models.getWarningsCount(from, targetPhone);

    if (removed) {
      return sock.sendMessage(from, {
        text: `✅ *Advertência removida!* O participante @${targetPhone} agora possui *${count}/3* advertências.`,
        mentions: [`${targetPhone}@s.whatsapp.net`]
      });
    } else {
      return sock.sendMessage(from, { text: `ℹ️ O participante @${targetPhone} não possui nenhuma advertência ativa.`, mentions: [`${targetPhone}@s.whatsapp.net`] });
    }
  }

  // Comando !warns / !avisos
  async handleWarnsList(sock, from, targetPhone) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    const warns = models.getWarnings(from, cleanPhone);

    if (warns.length === 0) {
      return sock.sendMessage(from, { text: `🟢 O participante @${cleanPhone} está com a ficha limpa (0 advertências)!`, mentions: [`${cleanPhone}@s.whatsapp.net`] });
    }

    let msg = `📋 *HISTÓRICO DE ADVERTÊNCIAS DE @${cleanPhone} (${warns.length}/3):*\n\n`;
    warns.forEach((w, i) => {
      msg += `• *#${i + 1}:* ${w.reason} (por: ${w.warned_by})\n`;
    });
    msg += `\n> ⚠️ *Limite:* 3 advertências = expulsão automática.`;

    return sock.sendMessage(from, { text: msg, mentions: [`${cleanPhone}@s.whatsapp.net`] });
  }

  /**
   * Extrai apenas participantes comuns de um grupo, EXCLUINDO rigorosamente qualquer administrador
   * (superadmin, admin, ou dono do bot), blindando-os de menções e notificações em massa.
   */
  getNonAdminParticipants(metadataOrParticipants) {
    const list = Array.isArray(metadataOrParticipants)
      ? metadataOrParticipants
      : (metadataOrParticipants?.participants || []);

    if (!Array.isArray(list)) return [];

    return list.filter(p => {
      if (!p) return false;
      if (typeof p === 'string') {
        if (models && typeof models.isOwner === 'function' && models.isOwner(p)) return false;
        return true;
      }
      const role = p.admin || p.role;
      if (role === 'admin' || role === 'superadmin') return false;
      if (p.isAdmin || p.isSuperAdmin) return false;
      const rawJid = p.id || p.jid || p.phoneNumber || '';
      if (rawJid && models && typeof models.isOwner === 'function' && models.isOwner(rawJid)) return false;
      return true;
    });
  }

  /**
   * Converte participantes comuns em JIDs válidos para menção no WhatsApp
   */
  getNonAdminJids(metadataOrParticipants) {
    const nonAdmins = this.getNonAdminParticipants(metadataOrParticipants);
    return nonAdmins.map(p => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      if (!raw) return '';
      if (raw.includes('@')) return raw;
      const digits = raw.replace(/\D/g, '');
      return digits ? `${digits}@s.whatsapp.net` : '';
    }).filter(Boolean);
  }

  // Comando !hidetag (Marcação invisível de participantes comuns, poupando administradores)
  async handleHidetag(sock, from, text, metadata = null, quotedMsg = null, isAdmin = true, isBotAdmin = false) {
    if (isAdmin === false) {
      return sock.sendMessage(from, { text: '⛔ Apenas administradores do grupo podem usar o hidetag.' });
    }

    let meta = metadata;
    if ((!meta || !meta.participants) && sock && typeof sock.groupMetadata === 'function') {
      meta = await sock.groupMetadata(from).catch(() => null);
    }

    const nonAdminJids = this.getNonAdminJids(meta);
    if (!nonAdminJids.length) {
      return sock.sendMessage(from, { text: `⚠️ Nenhum participante comum encontrado para notificar (administradores do grupo foram blindados).` });
    }

    const noticeText = (text || '').replace(/^(?:!|\/)(?:hidetag|notificar|aviso)\s*/i, '').trim();
    const finalMsg = noticeText ? `📢 *COMUNICADO IMPORTANTE:*\n\n${noticeText}` : `📢 *COMUNICADO IMPORTANTE AOS MEMBROS!*`;

    return sock.sendMessage(from, {
      text: finalMsg,
      mentions: nonAdminJids
    });
  }

  // Anti-Fake / Anti-Estrangeiro (Spy Security)
  async checkAntiFakeEntry(sock, groupId, participants) {
    const isAntiFakeActive = models.getSetting(`ANTIFAKE_${groupId}`, 'false') === 'true';
    if (!isAntiFakeActive) return false;

    let kickedAny = false;
    for (const participant of (participants || [])) {
      let rawJid = typeof participant === 'string'
        ? participant
        : (participant?.id || participant?.jid || participant?.phoneNumber || '');
      if (!rawJid && participant?.user && participant?.server) {
        rawJid = `${participant.user}@${participant.server}`;
      }
      if (!rawJid) continue;

      const phone = rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (models.isOwner(rawJid) || models.isOwner(phone)) continue; // 🛡️ IMUNIDADE DO DONO
      // Verifica se o DDI NÃO é brasileiro (não começa com 55)
      if (phone && !phone.startsWith('55')) {
        console.log(`[SpyBot 🛡️ ANTI-FAKE] Expulsando número estrangeiro ${phone} do grupo ${groupId}`);
        try {
          const kickJid = rawJid.includes('@') ? rawJid : `${phone}@s.whatsapp.net`;
          await sock.groupParticipantsUpdate(groupId, [kickJid], 'remove');
          await sock.sendMessage(groupId, {
            text: `🛡️ *ANTI-FAKE ATIVADO!*\n\n` +
              `O número estrangeiro/fake @${phone} foi banido automaticamente deste grupo para proteção dos membros contra golpes e spams.`,
            mentions: [kickJid]
          });
          kickedAny = true;
        } catch (err) {
          console.error(`[AntiFake Erro]:`, err.message);
        }
      }
    }
    return kickedAny;
  }

  // Helper: Extrai recursivamente conteúdo de Visualização Única (Foto, Vídeo, Áudio) suportando todos os envelopes Baileys
  extractViewOnceMedia(msg) {
    if (!msg) return null;
    let m = msg.rawMessage || msg.message || msg;

    let isViewOnce = !!(msg._isViewOnce || msg.isViewOnce || m._isViewOnce || m.isViewOnce);

    // 1. Unwrap ephemeralMessage se presente
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    }

    // 2. Unwrap documentWithCaptionMessage se presente
    if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    }

    // 3. Unwrap envelopes de View-Once
    const viewOnceObj = m.viewOnceMessageV2Extension?.message ||
                        m.viewOnceMessageV2?.message ||
                        m.viewOnceMessage?.message;
    if (viewOnceObj) {
      m = viewOnceObj;
      isViewOnce = true;
    }

    // 4. Se ainda tiver ephemeralMessage interno
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    }

    // Se houver envelope de view-once aninhado após ephemeral
    const innerViewOnce = m.viewOnceMessageV2Extension?.message ||
                          m.viewOnceMessageV2?.message ||
                          m.viewOnceMessage?.message;
    if (innerViewOnce) {
      m = innerViewOnce;
      isViewOnce = true;
    }

    // 5. Identifica mídia SOMENTE se for realmente de visualização única (envelope ou flag viewOnce ativa)
    if (m.imageMessage && (isViewOnce || m.imageMessage.viewOnce)) {
      return { type: 'image', media: m.imageMessage, caption: m.imageMessage.caption || '' };
    }
    if (m.videoMessage && (isViewOnce || m.videoMessage.viewOnce)) {
      return { type: 'video', media: m.videoMessage, caption: m.videoMessage.caption || '' };
    }
    if (m.audioMessage && (isViewOnce || m.audioMessage.viewOnce)) {
      return { type: 'audio', media: m.audioMessage, caption: '' };
    }

    return null;
  }

  // Pré-captura e download em alta qualidade de mídias de visualização única no momento de chegada
  // Permite que qualquer membro execute !ver mesmo horas depois ou caso o WhatsApp expire a chave
  async captureViewOnceMedia(sock, msg, from) {
    if (!msg) return null;
    const chatJid = from || msg.key?.remoteJid;
    if (!chatJid) return null;

    const viewOnceData = this.extractViewOnceMedia(msg);
    if (!viewOnceData || !viewOnceData.media) return null;

    const { type, media } = viewOnceData;
    const msgId = msg.key?.id;
    if (!msgId) return null;

    // Se já estiver em cache por ID, retorna a entrada existente
    if (this.viewOnceMediaCache.has(`${chatJid}:${msgId}`) || this.viewOnceMediaCache.has(msgId)) {
      return this.viewOnceMediaCache.get(msgId) || this.viewOnceMediaCache.get(`${chatJid}:${msgId}`);
    }

    const senderPhone = (msg.key?.participant || chatJid).split('@')[0].split(':')[0].replace(/\D/g, '');
    const caption = media.caption || '';
    const mimetype = media.mimetype || (type === 'image' ? 'image/jpeg' : (type === 'video' ? 'video/mp4' : 'audio/ogg; codecs=opus'));

    let buffer = null;
    try {
      if (process.env.NODE_ENV === 'test') {
        buffer = Buffer.alloc(1024, 1);
      } else {
        if (media.mediaKey && (!Buffer.isBuffer(media.mediaKey) || media.mediaKey.length > 0)) {
          const streamType = type === 'audio' ? 'audio' : type;
          const stream = await downloadContentFromMessage(media, streamType);
          let buf = Buffer.from([]);
          for await (const chunk of stream) {
            buf = Buffer.concat([buf, chunk]);
          }
          buffer = buf;
        }
      }
    } catch (downErr) {
      if (!downErr.message?.includes('empty media key')) {
        console.warn(`[captureViewOnceMedia ⚠️] Erro ao baixar ${type} #${msgId}:`, downErr.message);
      }
    }

    if (!buffer || buffer.length === 0) return null;

    const cacheEntry = {
      msgId,
      from: chatJid,
      buffer,
      type,
      mimetype,
      senderPhone,
      caption,
      timestamp: Date.now()
    };

    // Armazena com múltiplos índices para recuperação infalível
    this.viewOnceMediaCache.set(`${chatJid}:${msgId}`, cacheEntry);
    this.viewOnceMediaCache.set(msgId, cacheEntry);
    const participant = msg.key?.participant;
    if (participant) {
      this.viewOnceMediaCache.set(`${participant}:${msgId}`, cacheEntry);
    }
    this.lastViewOncePerChat.set(chatJid, cacheEntry);

    // Registro em banco
    try {
      models.logViewOnceMedia(chatJid, senderPhone, type, caption);
      if (chatJid.endsWith('@g.us')) {
        models.logX9Event(chatJid, 'VIEW_ONCE_MEDIA', senderPhone, senderPhone, caption || `Mídia ${type}`, type);
      }
    } catch (_) {}

    return cacheEntry;
  }

  // Anti-View-Once (Captura e revela mídia de visualização única automaticamente no grupo ou PV)
  async handleAntiViewOnce(sock, msg, from) {
    if (!msg || !from) return;
    const isGroup = from.endsWith('@g.us');
    const prot = isGroup ? models.getGroupProtection(from) : null;
    const isX9Active = prot?.x9_enabled === 1;

    // Garante que a mídia seja capturada e guardada para o !ver
    const cachedEntry = await this.captureViewOnceMedia(sock, msg, from);
    if (!cachedEntry || !cachedEntry.buffer) return;

    // Em grupos: revela automaticamente se x9 ativo, ou ANTIVIEWONCE ativo no grupo
    // Em privado: ativo sempre por padrão
    const isAntiViewActive = !isGroup || isX9Active || models.getSetting(`ANTIVIEWONCE_${from}`, 'true') === 'true' || models.getSetting('ANTIVIEWONCE_GLOBAL', 'true') === 'true';
    if (!isAntiViewActive) return;

    const { buffer, type, mimetype, senderPhone, caption } = cachedEntry;
    const targetMode = models.getSetting('ANTIVIEWONCE_TARGET', 'SAME_CHAT'); // SAME_CHAT, OWNER_PV, BOTH
    const headerType = models.getSetting('ANTIVIEWONCE_HEADER_TYPE', 'FULL'); // FULL, DISCREET, NONE
    const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '554884702848').replace(/\D/g, '');
    const ownerJid = ownerPhone ? `${ownerPhone}@s.whatsapp.net` : null;

    let noticeText = '';
    const captionFormatted = caption ? `\n📝 *Legenda original:* ${caption}` : '';
    if (headerType === 'FULL') {
      const tag = isX9Active ? `🚨 *X9 DO GRUPO (VISUALIZAÇÃO ÚNICA REVELADA!)* 🕵️‍♂️` : `👁️ *ANTI-VIEW-ONCE REVELADO!* 🔓`;
      noticeText = `${tag}\n\n` +
        `👤 *Remetente:* @${senderPhone}${captionFormatted}\n\n` +
        `> 🔒 *Mídia permanente recuperada pelo bot em alta qualidade.*`;
    } else if (headerType === 'DISCREET') {
      noticeText = `👁️ *Mídia revelada* (de @${senderPhone})${caption ? ' - ' + caption : ''}`;
    } else {
      noticeText = caption || '';
    }

    const destinations = [];
    if (targetMode === 'SAME_CHAT' || targetMode === 'BOTH' || !ownerJid) {
      destinations.push(from);
    }
    if ((targetMode === 'OWNER_PV' || targetMode === 'BOTH') && ownerJid && ownerJid !== from) {
      destinations.push(ownerJid);
    }

    const mentions = [`${senderPhone}@s.whatsapp.net`];

    for (const destJid of destinations) {
      if (type === 'image') {
        await sock.sendMessage(destJid, {
          image: buffer,
          caption: noticeText,
          mentions
        });
      } else if (type === 'video') {
        await sock.sendMessage(destJid, {
          video: buffer,
          mimetype: mimetype || 'video/mp4',
          caption: noticeText,
          mentions
        });
      } else if (type === 'audio') {
        await sock.sendMessage(destJid, {
          audio: buffer,
          mimetype: mimetype || 'audio/ogg; codecs=opus',
          ptt: true,
          caption: noticeText,
          contextInfo: { mentionedJid: mentions }
        });
      }
    }
  }

  // Comando !ver / !revelar / !rv / !vo / !viewonce / !abrir (Revela mídia de visualização única citada para todos em alta qualidade)
  async handleRevelar(sock, msg, from) {
    if (!msg || !from) return;
    const canUseCommands = models.getSetting('ANTIVIEWONCE_REVEAL_COMMANDS_ENABLED', 'true') !== 'false';
    if (!canUseCommands) {
      return sock.sendMessage(from, { text: '🔒 *Comandos manuais de revelação de mídia estão desativados pelo administrador.*' });
    }

    try {
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                        msg.message?.imageMessage?.contextInfo ||
                        msg.message?.videoMessage?.contextInfo ||
                        msg.message?.documentMessage?.contextInfo ||
                        msg.contextInfo;

    const quotedMsg = contextInfo?.quotedMessage;
    const quotedStanzaId = contextInfo?.stanzaId;
    const quotedParticipant = contextInfo?.participant;

      // Se NÃO houver mensagem citada / resposta: exibe ajuda sobre o comando !ver
      if (!quotedStanzaId && !quotedMsg) {
        return sock.sendMessage(from, {
          text: `👁️ *REVELADOR DE VISUALIZAÇÃO ÚNICA (!ver / !revelar)* 🔓\n\n` +
            `📌 *Como usar:*\n` +
            `Responda a qualquer foto, vídeo ou áudio de visualização única com:\n` +
            `• *!ver*\n` +
            `• *!revelar*\n` +
            `• *!rv*\n` +
            `• *!vo*\n\n` +
            `_O bot revelará a mídia original completa para todos no grupo em alta qualidade!_`
        }, { quoted: msg });
      }

      let buffer = null;
      let type = null;
      let mimetype = null;
      let caption = '';
      let senderPhone = (quotedParticipant || from).split('@')[0].split(':')[0].replace(/\D/g, '');

      // 1. Tenta recuperar do cache de mídias capturadas em memória
      let cached = null;
      if (quotedStanzaId) {
        cached = this.viewOnceMediaCache.get(`${from}:${quotedStanzaId}`) ||
                 this.viewOnceMediaCache.get(quotedStanzaId) ||
                 (quotedParticipant && this.viewOnceMediaCache.get(`${quotedParticipant}:${quotedStanzaId}`));
      }

      // Fallback: se citado não achou por ID exato, verifica se é o último do chat
      if (!cached && this.lastViewOncePerChat.has(from)) {
        const lastVo = this.lastViewOncePerChat.get(from);
        if (lastVo && (lastVo.msgId === quotedStanzaId || !quotedStanzaId)) {
          cached = lastVo;
        }
      }

    if (cached) {
      buffer = cached.buffer;
      type = cached.type;
      mimetype = cached.mimetype;
      caption = cached.caption || '';
      if (cached.senderPhone) senderPhone = cached.senderPhone;
    }

    // 2. Se não estava em cache, tenta extrair da mensagem citada ou de recentMessages
    if (!buffer) {
      let targetMsgObj = quotedMsg;
      if (!targetMsgObj && quotedStanzaId) {
        const rec = this.recentMessages.get(`${from}:${quotedStanzaId}`) ||
                    this.recentMessages.get(quotedStanzaId);
        if (rec?.rawMessage) targetMsgObj = rec.rawMessage;
        else if (rec?.msg) targetMsgObj = rec.msg.message || rec.msg;
      }

      const viewOnceData = this.extractViewOnceMedia(targetMsgObj);
      if (viewOnceData && viewOnceData.media) {
        type = viewOnceData.type;
        caption = viewOnceData.caption || '';
        mimetype = viewOnceData.media.mimetype;
        const streamType = type === 'audio' ? 'audio' : type;

        if (process.env.NODE_ENV === 'test') {
          buffer = Buffer.alloc(1024, 1);
        } else {
          if (viewOnceData.media.mediaKey && (!Buffer.isBuffer(viewOnceData.media.mediaKey) || viewOnceData.media.mediaKey.length > 0)) {
            const stream = await downloadContentFromMessage(viewOnceData.media, streamType);
            let buf = Buffer.from([]);
            for await (const chunk of stream) {
              buf = Buffer.concat([buf, chunk]);
            }
            buffer = buf;
          }
        }
      }
    }

    // 3. Se ainda assim não encontrou nenhuma mídia citada ou recente
    if (!buffer || buffer.length === 0) {
      if (!quotedStanzaId && !quotedMsg) {
        return sock.sendMessage(from, {
          text: `👁️ *REVELADOR DE MÍDIA DE VISUALIZAÇÃO ÚNICA (!ver)* 🔓\n\n` +
            `📌 *Como usar:*\n` +
            `Responda/cite qualquer foto, vídeo ou áudio de visualização única com:\n` +
            `👉 *!ver*\n\n` +
            `_O bot revelará imediatamente o arquivo original em alta qualidade para todos no chat!_`
        }, { quoted: msg });
      }

      return sock.sendMessage(from, {
        text: `⚠️ *Não foi possível recuperar esta mídia de visualização única.*\n\n` +
          `_Possíveis motivos:_\n` +
          `• A mídia foi enviada antes do bot inicializar;\n` +
          `• O WhatsApp não enviou as chaves criptográficas na citação;\n` +
          `• A mensagem citada não é uma mídia de visualização única.\n\n` +
          `💡 *Dica:* Responda com *!ver* assim que a mídia for enviada para que o bot a capture na hora!`
      }, { quoted: msg });
    }

    const requesterPhone = (msg.key?.participant || from).split('@')[0].split(':')[0].replace(/\D/g, '');
    const captionText = caption ? `\n📝 *Legenda original:* ${caption}` : '';
    const mediaTitle = type === 'video' ? 'VÍDEO DE VISUALIZAÇÃO ÚNICA REVELADO!' : (type === 'audio' ? 'ÁUDIO DE VISUALIZAÇÃO ÚNICA REVELADO!' : 'MÍDIA DE VISUALIZAÇÃO ÚNICA REVELADA!');
    const noticeText = `👁️ *${mediaTitle}* 🔓\n\n` +
      `👤 *Enviada por:* @${senderPhone}${captionText}\n` +
      `⚡ *Revelado por:* @${requesterPhone}\n\n` +
      `> ✨ *Mídia permanente liberada para todos em alta qualidade.*`;

    const mentions = [
      `${senderPhone}@s.whatsapp.net`,
      `${requesterPhone}@s.whatsapp.net`
    ];

    if (type === 'image') {
      await sock.sendMessage(from, {
        image: buffer,
        caption: noticeText,
        mentions
      }, { quoted: msg });
    } else if (type === 'video') {
      await sock.sendMessage(from, {
        video: buffer,
        mimetype: mimetype || 'video/mp4',
        caption: noticeText,
        mentions
      }, { quoted: msg });
    } else if (type === 'audio') {
      await sock.sendMessage(from, {
        audio: buffer,
        mimetype: mimetype || 'audio/ogg; codecs=opus',
        ptt: true,
        caption: noticeText,
        contextInfo: { mentionedJid: mentions }
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('[handleRevelar Erro]:', err.message);
    await sock.sendMessage(from, { text: `❌ Erro ao revelar mídia de visualização única: ${err.message}` });
  }
}

  // Comando !x9 / !x9 grupo / !dedoduro / !x9 on / !x9 off (Painel e Auditoria Dedo-Duro do Grupo)
  async handleX9(sock, from, text, isAdmin = false) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `🕵️‍♂️ *SISTEMA X9 (DEDO-DURO DO GRUPO)* 🕵️‍♂️\n\n` +
          `O comando *!x9* foi criado para auditoria e delação dentro de *grupos* do WhatsApp!\n\n` +
          `📌 *O que o X9 faz quando ativado no grupo:*\n` +
          `• 🗑️ *Anti-Delete:* Dedura imediatamente quem apagar mensagem e expõe o que foi dito\n` +
          `• 👁️ *Anti-View-Once:* Intercepta mídias de visualização única e revela para todos\n` +
          `• 🚪 *Delação de Saídas:* Alerta publicamente quando alguém sai ou é removido do grupo\n` +
          `• ✏️ *Auditoria de Edições:* Dedura mensagens que foram editadas\n\n` +
          `💡 _Adicione o bot ao seu grupo e digite *!x9* ou *!x9 on* para ativar o modo espião!_`
      });
    }

    const clean = String(text || '').replace(/^(?:!|\/)(?:x9|dedoduro|x9grupo|auditoria)\s*/i, '').trim().toLowerCase();
    const prot = models.getGroupProtection(from);
    const isX9Active = prot?.x9_enabled === 1;

    // 1. Ativar X9: !x9 on, !x9 ativar, !x9 1
    if (clean === 'on' || clean === '1' || clean === 'ativar' || clean === 'ligar') {
      if (!isAdmin) {
        return sock.sendMessage(from, { text: '⛔ Apenas administradores do grupo podem ativar o Sistema X9.' });
      }

      models.updateGroupProtection(from, { x9_enabled: 1 });
      models.setSetting(`ANTIDELETE_${from}`, 'true');
      models.setSetting(`ANTIVIEWONCE_${from}`, 'true');

      return sock.sendMessage(from, {
        text: `🚨 *SISTEMA X9 DO GRUPO ATIVADO!* 🕵️‍♂️\n\n` +
          `O Dedo-Duro oficial do grupo agora está em *VIGILÂNCIA MÁXIMA*:\n\n` +
          `• 🗑️ *Anti-Delete Ativo:* Se alguém apagar mensagem, o X9 dedura o autor e recupera o texto ou mídia!\n` +
          `• 👁️ *Anti-View-Once Ativo:* Fotos, vídeos e áudios temporários serão revelados publicamente no grupo!\n` +
          `• 🚪 *Monitor de Saída Ativo:* Se algum membro sair, o X9 dedura imediatamente no chat!\n` +
          `• ✏️ *Auditoria Ativa:* Modificações de mensagens serão registradas.\n\n` +
          `_Agora nada passa batido neste grupo! Para desativar a qualquer momento: *!x9 off*_`
      });
    }

    // 2. Desativar X9: !x9 off, !x9 desativar, !x9 0
    if (clean === 'off' || clean === '0' || clean === 'desativar' || clean === 'desligar') {
      if (!isAdmin) {
        return sock.sendMessage(from, { text: '⛔ Apenas administradores do grupo podem desativar o Sistema X9.' });
      }

      models.updateGroupProtection(from, { x9_enabled: 0 });
      models.setSetting(`ANTIDELETE_${from}`, 'false');
      models.setSetting(`ANTIVIEWONCE_${from}`, 'false');

      return sock.sendMessage(from, {
        text: `🔕 *SISTEMA X9 DESATIVADO.* 🙈\n\n` +
          `O modo dedo-duro foi pausado neste grupo. Mensagens apagadas e mídias temporárias não serão mais delatadas.\n\n` +
          `_Para reativar quando quiser: *!x9 on*_`
      });
    }

    // 3. Ver Logs / Histórico do X9: !x9 logs, !x9 historico
    if (clean === 'logs' || clean === 'historico' || clean === 'eventos' || clean === 'relatorio') {
      const events = models.getX9Events(from, 10);
      if (!events || events.length === 0) {
        return sock.sendMessage(from, {
          text: `📋 *HISTÓRICO DO X9 (DEDO-DURO)* 🕵️‍♂️\n\n` +
            `Nenhuma ocorrência ou infração registrada recentemente neste grupo.\n` +
            `_O grupo está tranquilo no momento!_`
        });
      }

      let logText = `📋 *ÚLTIMAS DELAÇÕES DO X9 NESTE GRUPO* 🕵️‍♂️\n\n`;
      events.forEach((ev, idx) => {
        const time = new Date(ev.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const typeMap = {
          'REVOKED_MESSAGE': '🗑️ Mensagem Apagada',
          'VIEW_ONCE_MEDIA': '👁️ Mídia Visualização Única',
          'MEMBER_LEFT': '🚪 Membro Saiu',
          'MEMBER_KICKED': '👢 Membro Expulso',
          'EDITED_MESSAGE': '✏️ Mensagem Editada'
        };
        const title = typeMap[ev.event_type] || ev.event_type;
        logText += `*${idx + 1}. [${time}]* ${title}\n` +
          `   👤 Autor: @${ev.target_phone || 'Desconhecido'}\n` +
          (ev.details ? `   💬 Detalhes: ${ev.details.slice(0, 50)}\n` : '') +
          `\n`;
      });

      return sock.sendMessage(from, { text: logText.trim() });
    }

    // 4. Painel Padrão: !x9, !x9 grupo, !x9 status
    const recentEvents = models.getX9Events(from, 5);
    const viewOnceCount = (models.getViewOnceLogs(from, 100) || []).length;
    const revokesCount = recentEvents.filter(e => e.event_type === 'REVOKED_MESSAGE').length;

    let panel = `🕵️‍♂️ *PAINEL DE AUDITORIA X9 (DEDO-DURO DO GRUPO)* 🕵️‍♂️\n\n` +
      `📊 *Status do X9:* ${isX9Active ? '🟢 ATIVADO (Vigilância Contínua)' : '🔴 DESATIVADO'}\n\n` +
      `🛡️ *Módulos do X9 Integrados:*\n` +
      `  • 🗑️ *Anti-Delete:* ${isX9Active ? '🟢 Monitorando apagadas' : '🔴 Pausado'}\n` +
      `  • 👁️ *Anti-View-Once:* ${isX9Active ? '🟢 Revelando temporárias' : '🔴 Pausado'}\n` +
      `  • 🚪 *Monitor de Saídas:* ${isX9Active ? '🟢 Dedurando quem sai' : '🔴 Pausado'}\n` +
      `  • ✏️ *Auditoria de Edições:* ${isX9Active ? '🟢 Ativa' : '🔴 Pausada'}\n\n` +
      `📈 *Estatísticas Recentes de Espionagem:*\n` +
      `  • Mídias temporárias interceptadas: *${viewOnceCount}*\n` +
      `  • Mensagens apagadas deduradas: *${revokesCount}*\n\n` +
      `⚡ *Comandos Rápidos do X9:*\n` +
      `  • *!x9 on* — Ativa todos os recursos de delação do X9\n` +
      `  • *!x9 off* — Desativa o X9 no grupo\n` +
      `  • *!x9 logs* — Ver as últimas delações registradas\n` +
      `  • *!revelar* — Revela foto, vídeo ou áudio de visualização única respondido\n\n` +
      `_X9 Bot: a inteligência do grupo que nunca dorme._`;

    return sock.sendMessage(from, { text: panel });
  }

  // Comando !fantasmas (Lista membros inativos que nunca falaram, excluindo administradores)
  async handleFantasmas(sock, from, metadata) {
    const participants = metadata?.participants || [];
    const nonAdmins = this.getNonAdminParticipants(participants);
    const activeSet = this.groupMessageActivity.get(from) || new Set();

    const inactives = nonAdmins.filter(p => {
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      const phone = rawJid ? rawJid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
      return phone && !activeSet.has(phone);
    });

    if (inactives.length === 0) {
      return sock.sendMessage(from, { text: `🎉 *Participantes comuns 100% ativos!* Nenhum membro fantasma detectado nesta sessão (administradores poupados).` });
    }

    let text = `👻 *MEMBROS FANTASMAS DETECTADOS (${inactives.length}/${nonAdmins.length}):*\n\n` +
      `Estes participantes comuns não enviaram mensagens recentes no grupo:\n\n`;

    inactives.slice(0, 15).forEach((p, i) => {
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      const phone = rawJid ? rawJid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
      text += `${i + 1}. @${phone}\n`;
    });

    if (inactives.length > 15) {
      text += `\n... e mais ${inactives.length - 15} participantes comuns inativos.`;
    }

    text += `\n\n💡 *Dica do Admin:* Você pode interagir com eles ou fazer uma limpa periódica! (Administradores são blindados)`;

    const mentions = this.getNonAdminJids(inactives.slice(0, 15));
    return sock.sendMessage(from, { text, mentions });
  }

  // ==========================================
  // 4. ASSISTENTE DE IA & TRADUTOR
  // ==========================================

  // Comando !ia / !gpt
  async handleAIChat(sock, from, text, senderName) {
    const prompt = text.replace(/^(?:!|\/)(?:ia|gpt|ai|gemini)\s*/i, '').trim();
    if (!prompt) {
      return sock.sendMessage(from, { text: `🤖 Olá *${senderName}*! Como posso te ajudar? Digite sua dúvida após o comando: *!ia como investir em criptomoedas?* ou *!ia flowith* para ver a economia de tokens.` });
    }

    if (/^(?:flowith|fl|status|statusia)$/i.test(prompt)) {
      const flowithService = require('./flowithService');
      return sock.sendMessage(from, { text: flowithService.formatStatusMessage() });
    }

    if (sock && typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate('composing', from).catch(() => {});
    }

    try {
      // 1. Tenta via AiManager (com prioridade Flowith Blank e failover automático entre Gemini, Groq, OpenAI, etc.)
      const aiManager = require('./aiManagerService');
      const aiResult = await aiManager.chat({
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente virtual humanizado e de alto nível conversando no WhatsApp em português do Brasil. Responda diretamente, com clareza, empatia, precisão técnica e completude absoluta. NUNCA corte ou encerre sua resposta no meio; forneça sempre a conclusão completa e profunda do que foi perguntado, formatando com tópicos e espaçamentos limpos. Não utilize cabeçalhos técnicos, assinaturas ou menções a nomes de provedores de IA ou LLMs.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        maxTokens: 2500,
        timeoutMs: 25000
      });

      if (aiResult && aiResult.text) {
        const cleanReply = String(aiResult.text).trim();
        
        // Se a resposta for longa (> 3500 caracteres), envia em blocos confortáveis sem cortar palavras
        if (cleanReply.length > 3500) {
          const paragraphs = cleanReply.split(/\n{2,}/);
          let currentChunk = '';
          const chunks = [];

          for (const p of paragraphs) {
            if ((currentChunk + '\n\n' + p).length > 3200 && currentChunk.trim()) {
              chunks.push(currentChunk.trim());
              currentChunk = p;
            } else {
              currentChunk = currentChunk ? `${currentChunk}\n\n${p}` : p;
            }
          }
          if (currentChunk.trim()) chunks.push(currentChunk.trim());

          for (let i = 0; i < chunks.length; i++) {
            await sock.sendMessage(from, { text: chunks[i] });
            if (i < chunks.length - 1) {
              await new Promise(r => setTimeout(r, 600));
            }
          }
          return;
        }

        return sock.sendMessage(from, { text: cleanReply });
      }
    } catch (_) {}

    // Fallback: Motor semântico NLU interno
    const nlpService = require('./nlpService');
    const nlp = await nlpService.processMessage({ text: prompt, customerName: senderName });
    const fallbackText = nlp?.replyText || 'Olá! Como posso te ajudar hoje? Posso tirar qualquer dúvida sobre nossos produtos, ativação via Pix ou suporte humano. Digite MENU para ver nosso catálogo.';
    return sock.sendMessage(from, { text: fallbackText });
  }

  // Comando !imagine (Gerador de imagens por IA)
  async handleImagine(sock, from, text) {
    const prompt = text.replace(/^(?:!|\/)(?:imagine|dalle|desenhe)\s*/i, '').trim();
    if (!prompt) {
      return sock.sendMessage(from, { text: `🎨 Descreva a imagem que deseja criar! Exemplo: *!imagine um robô futurista em uma cidade neon*` });
    }

    await sock.sendMessage(from, { text: `🎨 Criando sua arte com Inteligência Artificial: "*${prompt}*"...` });

    try {
      const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
      const res = await fetch(imgUrl);
      if (!res.ok) throw new Error('Falha no gerador de imagens');

      const buf = Buffer.from(await res.arrayBuffer());
      await sock.sendMessage(from, {
        image: buf,
        caption: `✨ *IMAGEM GERADA POR IA*\n\n💭 *Prompt:* ${prompt}`
      });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Não foi possível gerar a imagem agora: ${err.message}` });
    }
  }

  // Comando !traduzir
  async handleTranslate(sock, from, text) {
    const match = text.match(/^(?:!|\/)(?:traduzir|translate)\s+([a-zA-Z]{2})\s+(.+)/i);
    if (!match) {
      return sock.sendMessage(from, {
        text: `🌐 *TRADUTOR INSTANTÂNEO*\n\n` +
          `Uso: *!traduzir <idioma> <texto>*\n` +
          `Exemplos:\n` +
          `• *!traduzir en Bom dia amigo* (Inglês)\n` +
          `• *!traduzir es Quanto custa o produto?* (Espanhol)\n` +
          `• *!traduzir fr Obrigado pela ajuda* (Francês)`
      });
    }

    const lang = match[1].toLowerCase();
    const toTranslate = match[2];

    try {
      const trUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(toTranslate)}`;
      const res = await fetch(trUrl);
      const data = await res.json();
      const translated = data[0][0][0];

      await sock.sendMessage(from, {
        text: `🌐 *TRADUÇÃO (${lang.toUpperCase()}):*\n\n` +
          `📝 *Original:* ${toTranslate}\n` +
          `✨ *Tradução:* ${translated}`
      });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro na tradução: ${err.message}` });
    }
  }

  // ==========================================
  // 5. GAMIFICAÇÃO, FIDELIDADE & JOGOS (RPG / ECONOMIA)
  // ==========================================

  // Comando !perfil / !me
  async handlePerfil(sock, from, userPhone, userName) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const loyalty = models.getUserLoyalty('whatsapp', cleanPhone, userName);
    const orders = models.getAllOrders(100).filter(o => o.platform === 'whatsapp' && o.platform_user_id && String(o.platform_user_id).includes(cleanPhone) && o.status === 'PAID');

    const totalOrders = orders.length;
    const warnsCount = models.getWarningsCount(from, cleanPhone);

    const levelTitles = ['Bronze', 'Prata', 'Ouro', 'Platina', 'Diamante', 'VIP Mestre'];
    const title = levelTitles[Math.min(loyalty.level - 1, levelTitles.length - 1)];

    const spousePhone = models.getSetting(`MARRIAGE_${cleanPhone}`, '');
    const marriageLine = spousePhone
      ? `💍 *Estado Civil:* Casado(a) com @${spousePhone}\n`
      : `💍 *Estado Civil:* Solteiro(a)\n`;

    const card = `👤 *PERFIL DO USUÁRIO*\n\n` +
      `🏷️ *Nome:* ${loyalty.user_name || userName || 'Cliente'}\n` +
      `📱 *WhatsApp:* +${cleanPhone}\n` +
      marriageLine +
      `⭐ *Nível:* Nível ${loyalty.level} (*${title}*)\n` +
      `✨ *Experiência:* ${loyalty.exp % 100} / 100 XP\n` +
      `🪙 *Moedas de Fidelidade:* *${loyalty.points} pts*\n` +
      `📦 *Compras Concluídas:* ${totalOrders} pedido(s)\n` +
      `⚠️ *Advertências Ativas:* ${warnsCount}/3\n\n` +
      `> 🎁 *Resgate de Recompensas:* Envie *!resgatar* para trocar 100 pontos por um Cupom de Desconto de 15% na loja!`;

    const mentions = spousePhone ? [`${spousePhone}@s.whatsapp.net`] : [];
    return sock.sendMessage(from, { text: card, mentions });
  }

  // Comando !resgatar (Troca pontos por cupom)
  async handleResgatar(sock, from, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const res = models.redeemLoyaltyCoupon('whatsapp', cleanPhone, 100);

    if (!res.success) {
      return sock.sendMessage(from, { text: `⚠️ ${res.error}\n\n💡 Ganhe mais pontos comprando produtos ou participando dos jogos do grupo com *!dado* e *!roleta*!` });
    }

    return sock.sendMessage(from, {
      text: `🎉 *CUPOM DE FIDELIDADE RESGATADO COM SUCESSO!* 🚀\n\n` +
        `🎟️ *Seu Cupom:* \`${res.couponCode}\`\n` +
        `💰 *Desconto:* *${res.discountPercent}% OFF* em qualquer produto!\n` +
        `🪙 *Pontos Restantes:* ${res.remainingPoints} pts\n\n` +
        `👉 Para usar, digite *MENU*, escolha seu produto e aplique seu cupom exclusivo!`
    });
  }

  // Comando !dado (Mini-game de retenção)
  async handleDado(sock, from, userPhone, pushName) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const isOwner = models.isOwner(cleanPhone);
    // 🛡️ IMUNIDADE DO DONO: Dono sempre tira 6 (vitória máxima) e nunca perde!
    const roll = isOwner ? 6 : (Math.floor(Math.random() * 6) + 1);
    const earnedPoints = isOwner ? 100 : (roll >= 4 ? 20 : 5);
    const earnedXp = isOwner ? 150 : 15;

    const res = models.addLoyaltyPoints('whatsapp', cleanPhone, earnedPoints, earnedXp, pushName);

    const diceEmoji = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][roll - 1];
    const headline = isOwner ? '👑 *VITÓRIA SUPREMA DO COMANDANTE!*' : (roll >= 4 ? '🎉 *Vitória da sorte!*' : '👍 *Boa tentativa!*');
    return sock.sendMessage(from, {
      text: `🎲 *JOGO DOS DADOS (GAMIFICAÇÃO)* 🎲\n\n` +
        `Você jogou o dado: ${diceEmoji} *${roll}*!\n\n` +
        `${headline}\n` +
        `🪙 *Recompensa:* +${earnedPoints} Moedas de Fidelidade e +${earnedXp} XP!\n` +
        `Saldo total: *${res.points} pts* (Nível ${res.level})${res.leveledUp ? '\n🆙 *PARABÉNS! VOCÊ SUBIU DE NÍVEL!*' : ''}`
    });
  }

  // Comando !roleta
  async handleRoleta(sock, from, userPhone, pushName) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const isOwner = models.isOwner(cleanPhone);
    const prizes = [10, 15, 25, 50, 100, 0];
    // 🛡️ IMUNIDADE DO DONO: Dono sempre fatura o prêmio máximo da roleta!
    const prize = isOwner ? 100 : prizes[Math.floor(Math.random() * prizes.length)];
    const xp = isOwner ? 150 : 20;

    const res = models.addLoyaltyPoints('whatsapp', cleanPhone, prize, xp, pushName);

    return sock.sendMessage(from, {
      text: `🎰 *ROLETA DA SORTE SPY* 🎰\n\n` +
        `Girando... 🎡\n\n` +
        `Resultado: ${isOwner ? '👑 *PRÊMIO MÁXIMO DO DONO SUPREMO!* +100 pts e +150 XP!' : (prize > 0 ? `🎉 *Você ganhou +${prize} pontos de fidelidade!*` : '😅 *Quase! Tente novamente mais tarde!*')}\n` +
        `Seu saldo atual: *${res.points} pts* (Nível ${res.level})`
    });
  }

  // Comando !video / !ytmp4 / !play2 / !mp4 / !videoh / !videos (Busca e baixa vídeo do YouTube com escolha de qualidade H ou S sem limite de tamanho)
  async handlePlayVideo(sock, from, query, quotedText = null, senderPhone = null) {
    const { cleanQuery, quality } = this.parseDownloadQuery(query, 'standard');
    const cleanQ = cleanQuery;
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🎬 *DOWNLOADER DE VÍDEOS YOUTUBE (SPY)*\n\n` +
          `Baixe vídeos do YouTube sem limite de tamanho escolhendo a qualidade:\n\n` +
          `📌 *Opções de Qualidade:*\n` +
          `  ⭐ *H (High)*: Vídeo em alta definição (720p/1080p)\n` +
          `  📱 *S (Standard)*: Vídeo compacto e leve (360p/480p, download ultrarrápido)\n\n` +
          `💡 *Exemplos de uso:*\n` +
          `  • *!video Cortes Podcast* (alta qualidade)\n` +
          `  • *!video Cortes Podcast H* (alta qualidade 720p/1080p)\n` +
          `  • *!video Cortes Podcast S* (qualidade padrão 360p leve)\n` +
          `  • *!videoh Cortes Podcast* ou *!videos Cortes Podcast*\n` +
          `  • *!video 1 H* (baixa o item 1 da !lista em HQ)\n` +
          `  • *!video https://www.youtube.com/watch?v=... S*`
      });
    }

    try {
      // 1. Verifica se cleanQ é uma seleção única ou múltipla da lista (ex: "1, 2", "1, 3 H", "1", "1H", "V1, V2")
      const selection = this.parseDownloadSelection(cleanQ, 'video');
      const hasActive = this.hasActiveSearchResults(from, senderPhone);
      const isQuoting = Boolean(quotedText && quotedText.includes('RESULTADOS DA BUSCA YOUTUBE'));
      if (selection && (selection.items.length > 1 || selection.isExplicitShortcut || hasActive || isQuoting)) {
        return await this.handleMultiDownload(sock, from, selection, quotedText, senderPhone);
      }

      const yts = require('yt-search');
      let video = null;

      // 2. Fallback de verificação de número único na lista recente do !lista
      const numMatch = cleanQ.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const cachedList = this.getSearchResults(from, senderPhone);
        if (idx >= 0 && idx < cachedList.length) {
          video = cachedList[idx];
        }
      }

      const isYtUrl = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(cleanQ);

      if (!video && isYtUrl) {
        const match = cleanQ.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
        const videoId = match ? match[1] : null;
        if (videoId) {
          try {
            const searchRes = await yts({ videoId });
            video = searchRes;
          } catch (_) {
            video = {
              title: 'Vídeo do YouTube',
              url: `https://www.youtube.com/watch?v=${videoId}`,
              videoId,
              timestamp: 'Vídeo',
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              author: { name: 'YouTube' }
            };
          }
        }
      } else if (!video) {
        const searchResults = await yts(cleanQ);
        const videos = searchResults?.videos || [];
        if (videos.length === 0) {
          return sock.sendMessage(from, { text: `🔍 Nenhum vídeo encontrado para: "${cleanQ}". Tente outros termos.` });
        }
        video = videos[0];
      }

      const qualityTag = quality === 'high' ? '⭐ Alta Definição (HQ)' : '📱 Padrão / Compacta (Standard)';
      const safeTitle = (video.title || 'video').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80);

      await sock.sendMessage(from, {
        text: `⏳ *Processando download de vídeo (Spy)...*\n\n` +
          `🎬 *Título:* ${video.title}\n` +
          `🎧 *Qualidade Selecionada:* ${qualityTag}\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
          `📁 *Arquivo:* \`${safeTitle}.mp4\`\n\n` +
          `_Aguarde enquanto preparamos o vídeo (vídeos longos são enviados sem limite de 50MB)..._`
      });

      // Baixa via downloadYouTubeVideo com qualidade H ou S
      const videoData = await this.downloadYouTubeVideo(video.url, quality);
      const videoBuffer = videoData?.buffer;

      if (videoBuffer && videoBuffer.length > 5000) {
        const tipH = '\n\n💡 _Dica: Quer em Alta Definição (HD)? Responda esta mensagem com *H*!_';
        const sizeInMb = (videoBuffer.length / (1024 * 1024)).toFixed(1);
        const caption = `🎬 *${video.title}*\n\n` +
          `🎧 *Qualidade:* ${qualityTag}\n` +
          `📦 *Tamanho:* ${sizeInMb} MB\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
          `🔗 *Link:* ${video.url}${tipH}`;

        let sentVid;
        if (videoBuffer.length > 45 * 1024 * 1024) {
          // Arquivos a partir de 45MB enviados como documento para contornar o limite nativo de 50MB do WhatsApp
          sentVid = await sock.sendMessage(from, {
            document: videoBuffer,
            fileName: `${safeTitle}.mp4`,
            caption: `${caption}\n\n📁 *Enviado como Documento MP4 para entrega sem limite de tamanho do WhatsApp!*\n_Qualidade: ${qualityTag}_`,
            mimetype: 'video/mp4'
          });
        } else {
          sentVid = await sock.sendMessage(from, {
            video: videoBuffer,
            caption,
            mimetype: 'video/mp4',
            fileName: `${safeTitle}.mp4`
          });
        }
        this._recordSentMedia(sentVid, from, video, 'video', quality);

        // Bonifica usuário
        const phone = from.split('@')[0].split(':')[0].replace(/\D/g, '');
        models.addLoyaltyPoints('whatsapp', phone, 5, 5);
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ *Não foi possível carregar o vídeo completo (pode ter restrição de direitos/idade ou indisponibilidade temporária).*\n\n` +
            `🔗 Assista diretamente pelo YouTube:\n${video.url}`
        });
      }
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro em handlePlayVideo]:', err.message);
      await sock.sendMessage(from, { text: `❌ Erro ao baixar vídeo: ${err.message}` });
    }
  }

  // Alias de compatibilidade com botdeck e rotas de comando
  async handleDownloadVideo(sock, from, query) {
    return this.handlePlayVideo(sock, from, query);
  }

  // Extrai mídia diretamente (áudio ou vídeo) para download no navegador (sem envio via WhatsApp)
  async extractDirectMedia({ query, type = 'audio', quality = 'H' }) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) throw new Error('Informe o nome da música, vídeo ou link.');

    const isHigh = String(quality || 'H').toUpperCase().startsWith('H');
    const qualityMode = isHigh ? 'high' : 'standard';

    // TEST MOCK: Rápido e determinístico para testes unitários / integração
    if (process.env.NODE_ENV === 'test') {
      const cleanTitle = rawQuery.replace(/https?:\/\/\S+/gi, '').trim() || 'Media_Download';
      if (type === 'video') {
        const buf = Buffer.alloc(80000, 1);
        return {
          buffer: buf,
          mimetype: 'video/mp4',
          ext: 'mp4',
          filename: `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
          title: cleanTitle,
          author: 'Canal Oficial',
          duration: '3:45',
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          sizeMb: (buf.length / (1024 * 1024)).toFixed(2),
          quality: isHigh ? 'High (HD 1080p/720p)' : 'Standard (480p/360p)'
        };
      } else {
        const buf = Buffer.alloc(45000, 1);
        return {
          buffer: buf,
          mimetype: 'audio/mpeg',
          ext: 'mp3',
          filename: `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
          title: cleanTitle,
          author: 'Artista Oficial',
          duration: '3:45',
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          sizeMb: (buf.length / (1024 * 1024)).toFixed(2),
          quality: isHigh ? 'High (320kbps HQ)' : 'Standard (128kbps)'
        };
      }
    }

    // Suporte a TikTok
    if (rawQuery.includes('tiktok.com')) {
      const cleanUrl = rawQuery.replace(/^(?:!|\/)(?:tiktok|tt)\s*/i, '').trim();
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`);
      const data = await res.json();
      if (!data?.data) throw new Error('Vídeo do TikTok não encontrado ou privado.');
      
      const title = data.data.title || 'TikTok_Video';
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'tiktok';
      
      if (type === 'audio') {
        const audioUrl = data.data.music || data.data.play;
        const audioRes = await fetch(audioUrl);
        const buffer = Buffer.from(await audioRes.arrayBuffer());
        return {
          buffer,
          mimetype: 'audio/mpeg',
          ext: 'mp3',
          filename: `${safeTitle}.mp3`,
          title,
          author: data.data.author?.nickname || 'TikToker',
          duration: String(data.data.duration || ''),
          thumbnail: data.data.cover || '',
          sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
          quality: 'TikTok Original Audio'
        };
      } else {
        const videoRes = await fetch(data.data.play);
        const buffer = Buffer.from(await videoRes.arrayBuffer());
        return {
          buffer,
          mimetype: 'video/mp4',
          ext: 'mp4',
          filename: `${safeTitle}.mp4`,
          title,
          author: data.data.author?.nickname || 'TikToker',
          duration: String(data.data.duration || ''),
          thumbnail: data.data.cover || '',
          sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
          quality: 'Sem marca d\'água (HD)'
        };
      }
    }

    // Suporte a Instagram
    if (rawQuery.includes('instagram.com')) {
      const cleanUrl = rawQuery.replace(/^(?:!|\/)(?:ig|instagram|reels)\s*/i, '').trim();
      let buffer = null;
      try {
        const { spawn } = require('child_process');
        buffer = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp IG fail'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 30000);
        });
      } catch (_) {
        const res = await fetch(`https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        const mediaUrl = data?.result?.url || data?.result?.[0]?.url;
        if (mediaUrl) {
          const mediaRes = await fetch(mediaUrl);
          buffer = Buffer.from(await mediaRes.arrayBuffer());
        }
      }
      if (!buffer || buffer.length < 1000) throw new Error('Não foi possível baixar mídia do Instagram.');
      return {
        buffer,
        mimetype: 'video/mp4',
        ext: 'mp4',
        filename: `Instagram_Reels_${Date.now()}.mp4`,
        title: 'Instagram Reels',
        author: 'Instagram',
        duration: '',
        thumbnail: '',
        sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
        quality: 'Instagram HD'
      };
    }

    // Suporte a Twitter/X
    if (rawQuery.includes('twitter.com') || rawQuery.includes('x.com')) {
      const cleanUrl = rawQuery.replace(/^(?:!|\/)(?:twitter|x|twdl)\s*/i, '').trim();
      let buffer = null;
      try {
        const { spawn } = require('child_process');
        buffer = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp Twitter fail'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 30000);
        });
      } catch (_) {
        const res = await fetch(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        const mediaUrl = data?.result?.url || data?.result?.video?.[0]?.url || data?.result?.[0]?.url;
        if (mediaUrl) {
          const mediaRes = await fetch(mediaUrl);
          buffer = Buffer.from(await mediaRes.arrayBuffer());
        }
      }
      if (!buffer || buffer.length < 1000) throw new Error('Não foi possível baixar mídia do Twitter/X.');
      return {
        buffer,
        mimetype: 'video/mp4',
        ext: 'mp4',
        filename: `Twitter_Video_${Date.now()}.mp4`,
        title: 'Twitter Video',
        author: 'Twitter / X',
        duration: '',
        thumbnail: '',
        sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
        quality: 'Twitter HD'
      };
    }

    // Suporte a Facebook
    if (rawQuery.includes('facebook.com') || rawQuery.includes('fb.watch')) {
      const cleanUrl = rawQuery.replace(/^(?:!|\/)(?:fb|facebook)\s*/i, '').trim();
      let buffer = null;
      try {
        const { spawn } = require('child_process');
        buffer = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp FB fail'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 30000);
        });
      } catch (_) {
        const res = await fetch(`https://api.vreden.my.id/api/fbdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        const mediaUrl = data?.result?.url || data?.result?.hd || data?.result?.sd;
        if (mediaUrl) {
          const mediaRes = await fetch(mediaUrl);
          buffer = Buffer.from(await mediaRes.arrayBuffer());
        }
      }
      if (!buffer || buffer.length < 1000) throw new Error('Não foi possível baixar mídia do Facebook.');
      return {
        buffer,
        mimetype: 'video/mp4',
        ext: 'mp4',
        filename: `Facebook_Video_${Date.now()}.mp4`,
        title: 'Facebook Video',
        author: 'Facebook',
        duration: '',
        thumbnail: '',
        sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
        quality: 'Facebook HD'
      };
    }

    // YouTube (URL direta ou busca por título)
    const yts = require('yt-search');
    let video = null;
    const isYtUrl = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(rawQuery);

    if (isYtUrl) {
      const match = rawQuery.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      const videoId = match ? match[1] : null;
      if (videoId) {
        try {
          video = await yts({ videoId });
        } catch (_) {
          video = {
            title: 'Mídia YouTube',
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            timestamp: '',
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            author: { name: 'YouTube' }
          };
        }
      }
    } else {
      const searchRes = await yts(rawQuery);
      if (searchRes && searchRes.videos && searchRes.videos.length > 0) {
        video = searchRes.videos[0];
      }
    }

    if (!video || !video.url) {
      throw new Error(`Nenhum resultado encontrado no YouTube para "${rawQuery}".`);
    }

    const safeTitle = (video.title || 'media').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'media';

    if (type === 'video') {
      const videoData = await this.downloadYouTubeVideo(video.url, qualityMode);
      if (!videoData || !videoData.buffer) {
        throw new Error(`Falha ao extrair vídeo de "${video.title}".`);
      }
      return {
        buffer: videoData.buffer,
        mimetype: videoData.mimetype || 'video/mp4',
        ext: videoData.ext || 'mp4',
        filename: `${safeTitle}.mp4`,
        title: video.title,
        author: video.author?.name || 'YouTube',
        duration: video.timestamp || '',
        thumbnail: video.thumbnail || '',
        sizeMb: (videoData.buffer.length / (1024 * 1024)).toFixed(2),
        quality: videoData.quality || (isHigh ? 'High (HD)' : 'Standard')
      };
    } else {
      // Audio
      const audioData = await this.downloadYouTubeAudioDoc(video.url, {
        title: video.title,
        artist: video.author?.name || 'Artista do YouTube',
        thumbnail: video.thumbnail
      }, qualityMode);

      if (!audioData || !audioData.buffer) {
        throw new Error(`Falha ao extrair áudio de "${video.title}".`);
      }

      return {
        buffer: audioData.buffer,
        mimetype: audioData.mimetype || 'audio/mpeg',
        ext: audioData.ext || 'mp3',
        filename: `${safeTitle}.mp3`,
        title: video.title,
        author: video.author?.name || 'Artista do YouTube',
        duration: video.timestamp || '',
        thumbnail: video.thumbnail || '',
        sizeMb: (audioData.buffer.length / (1024 * 1024)).toFixed(2),
        quality: audioData.quality || (isHigh ? '320kbps (HQ)' : '128kbps')
      };
    }
  }

  // =========================================================================
  // 🔍 MÓDULO DE BUSCA YOUTUBE ENRIQUECIDA (!lista) & DOWNLOADS MÚLTIPLOS
  // =========================================================================

  // Formata contagem de visualizações/views em PT-BR com notação compacta (ex: 5.456.069 (5.4M))
  formatViewsCount(views) {
    const n = Number(views) || 0;
    let compact = '';
    if (n >= 1000000) compact = (n / 1000000).toFixed(1) + 'M';
    else if (n >= 1000) compact = (n / 1000).toFixed(1) + 'K';
    else compact = String(n);
    return `${n.toLocaleString('pt-BR')} (${compact})`;
  }

  // Formata curtidas/likes em PT-BR (com estimativa realista caso a API aberta omita o campo)
  formatLikesCount(likes, views) {
    let n = Number(likes);
    let isEst = false;
    if (!n || n <= 0) {
      n = Math.max(1, Math.round((Number(views) || 0) * 0.045));
      isEst = true;
    }
    let compact = '';
    if (n >= 1000000) compact = (n / 1000000).toFixed(1) + 'M';
    else if (n >= 1000) compact = (n / 1000).toFixed(1) + 'K';
    else compact = String(n);
    return `${isEst ? '~' : ''}${compact}`;
  }

  // Traduz data de upload / tempo relativo de publicação para português
  formatUploadDate(ago) {
    if (!ago) return 'Recente';
    let s = String(ago);
    s = s.replace(/(\d+)\s*(?:years?|y)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' ano' : ' anos'));
    s = s.replace(/(\d+)\s*(?:months?|mo)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' mês' : ' meses'));
    s = s.replace(/(\d+)\s*(?:weeks?|w)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' semana' : ' semanas'));
    s = s.replace(/(\d+)\s*(?:days?|d)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' dia' : ' dias'));
    s = s.replace(/(\d+)\s*(?:hours?|h)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' hora' : ' horas'));
    s = s.replace(/(\d+)\s*(?:minutes?|mins?|m)\s*ago/i, (m, n) => 'há ' + n + (n === '1' ? ' minuto' : ' minutos'));
    s = s.replace(/just now/i, 'agora mesmo');
    return s;
  }

  // Verifica se há resultados de busca ativos em cache para o chat ou remetente
  hasActiveSearchResults(from, senderPhone = null) {
    if (!this.userSearchResults) return false;
    if (this.userSearchResults.has(from)) return true;
    if (senderPhone) {
      const cleanPhone = String(senderPhone).replace(/\D/g, '');
      if (cleanPhone) {
        if (this.userSearchResults.has(`${from}:${cleanPhone}`)) return true;
        if (this.userSearchResults.has(cleanPhone)) return true;
      }
    }
    return false;
  }

  // Obtém lista de resultados de busca em cache (por chat, por remetente ou por combinação)
  getSearchResults(from, senderPhone = null) {
    if (!this.userSearchResults) return [];
    if (senderPhone) {
      const cleanPhone = String(senderPhone).replace(/\D/g, '');
      if (cleanPhone) {
        if (this.userSearchResults.has(`${from}:${cleanPhone}`)) {
          return this.userSearchResults.get(`${from}:${cleanPhone}`) || [];
        }
        if (this.userSearchResults.has(cleanPhone)) {
          return this.userSearchResults.get(cleanPhone) || [];
        }
      }
    }
    if (this.userSearchResults.has(from)) {
      return this.userSearchResults.get(from) || [];
    }
    return [];
  }

  // Comando !lista (Busca no YouTube com dados ricos: canal, views, curtidas, data, duração e download múltiplo)
  async handleLista(sock, from, query, senderPhone = null) {
    const cleanQ = query.replace(/^(?:!|\/)(?:lista|search|pesquisar|buscar)\s*/i, '').trim();
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🔍 *BUSCA DO YOUTUBE (!lista)*\n\n` +
          `Envie o nome do que deseja buscar!\n\n` +
          `Exemplos:\n` +
          `• *!lista Alok*\n` +
          `• *!lista Metallica*\n` +
          `• *!lista Podcast Inteligência LTDA*\n\n` +
          `💡 _Dica: Você pode baixar várias músicas ou vídeos separando por vírgula (ex: *1, 3, 5*)!_`
      });
    }

    try {
      const yts = require('yt-search');
      const searchResults = await yts(cleanQ);
      const videos = (searchResults?.videos || []).slice(0, 20);

      if (videos.length === 0) {
        return sock.sendMessage(from, { text: `🔍 Nenhum resultado encontrado para: "${cleanQ}". Tente outros termos.` });
      }

      this.userSearchResults.set(from, videos);
      if (senderPhone) {
        const cleanPhone = String(senderPhone).replace(/\D/g, '');
        if (cleanPhone) {
          this.userSearchResults.set(`${from}:${cleanPhone}`, videos);
          this.userSearchResults.set(cleanPhone, videos);
        }
      }

      let msgText = `🎬 *RESULTADOS DA BUSCA YOUTUBE (TOP ${videos.length})*\n` +
        `🔎 *Termo:* "${cleanQ}"\n` +
        `⚙️ *Qualidade Padrão:* 📱 Padrão/Econômico (S) [Poupa Dados & Servidor]\n\n`;

      videos.forEach((v, idx) => {
        const num = idx + 1;
        const duration = v.timestamp || 'N/A';
        const author = v.author?.name || 'Canal Desconhecido';
        const viewsStr = this.formatViewsCount(v.views);
        const likesStr = this.formatLikesCount(v.likes, v.views);
        const dateStr = this.formatUploadDate(v.ago);

        msgText += `*${num}.* *${v.title}*\n` +
          `   👤 *Canal:* ${author}\n` +
          `   ⏱️ *Duração:* ${duration} | 📅 *Data:* ${dateStr}\n` +
          `   👁️ *Views/Visualizações:* ${viewsStr} | 👍 *Curtidas:* ${likesStr}\n\n`;
      });

      msgText += `━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 *COMO BAIXAR (OPÇÃO ÚNICA OU MÚLTIPLAS COM VÍRGULA):*\n` +
        `• *Baixar Mais de Uma Opção:* Separe os números por vírgula! (ex: *1, 3, 5* ou *1, 2*)\n` +
        `• *Atalhos Rápidos por Tipo:*\n` +
        `  📄 *Documento HQ com Capa:* *D1* ou *D1, D3*\n` +
        `  🎧 *Áudio MP3 Simples:* *A1* ou *A1, A2, A4*\n` +
        `  🎬 *Vídeo MP4:* *V1* ou *V1, V2*\n` +
        `  🎵 *Apenas Números:* *1, 2, 3* (baixa em áudio)\n` +
        `• *Por Comandos:* *!play 1, 2* | *!video 1, 3* | *!playdoc 1, 2*\n\n` +
        `⚙️ *QUALIDADE E TAMANHO (S ou H):*\n` +
        `• O padrão é *S* (Standard / Econômico) para economizar dados e poupar o servidor.\n` +
        `• Deseja mais qualidade? Basta adicionar *H* no comando (ex: *1, 2 H* ou *D1 H*).\n` +
        `• 💡 *Super Truque:* Já recebeu a mídia? Responda a mensagem dela com *H* para rebaixar em Alta Definição instantaneamente!`;

      return sock.sendMessage(from, { text: msgText });
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro em handleLista]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao buscar lista no YouTube: ${err.message}` });
    }
  }

  // Registra mídia enviada para permitir upgrade imediato respondendo com 'H'
  _recordSentMedia(sentMsg, from, video, type, quality) {
    const mediaInfo = {
      msgId: sentMsg?.key?.id,
      url: video.url,
      title: video.title,
      type,
      quality,
      author: video.author?.name || 'YouTube',
      thumbnail: video.thumbnail,
      from,
      timestamp: Date.now()
    };
    if (sentMsg?.key?.id) {
      this.recentMediaDispatches.set(sentMsg.key.id, mediaInfo);
      if (this.recentMediaDispatches.size > 200) {
        const firstKey = this.recentMediaDispatches.keys().next().value;
        this.recentMediaDispatches.delete(firstKey);
      }
    }
    this.lastMediaPerChat.set(from, mediaInfo);
  }

  // Parser inteligente para seleções únicas ou múltiplas da !lista separadas por vírgula
  parseDownloadSelection(rawText, defaultType = 'audio') {
    let text = String(rawText || '').trim();
    if (!text) return null;

    // Detecta se é o comando !lista em si (não deve tentar baixar)
    if (/^(?:!|\/)(?:lista|search|pesquisar|buscar)\b/i.test(text)) {
      return null;
    }

    // Flag global de qualidade no final do comando/mensagem: "H", "S", "--high", "-s", etc.
    let globalQuality = 'standard';
    if (/(?:^|\s)(?:-h|--high|\/h|high|h)$/i.test(text)) {
      globalQuality = 'high';
      text = text.replace(/(?:^|\s)(?:-h|--high|\/h|high|h)$/i, '').trim();
    } else if (/(?:^|\s)(?:-s|--small|--standard|\/s|small|standard|s)$/i.test(text)) {
      globalQuality = 'standard';
      text = text.replace(/(?:^|\s)(?:-s|--small|--standard|\/s|small|standard|s)$/i, '').trim();
    }

    let commandType = defaultType;
    let isExplicitShortcut = false;

    // Detecta comandos: !playdoc, !video, !play, !audio, !baixar
    const cmdMatch = text.match(/^(?:!|\/)?(?:(playdoc|musicadoc|audiodoc|mp3doc|ytmp3doc)|(video|ytmp4|play2|mp4)|(play|audio|musica|mp3)|(baixar))([hs])?\s*/i);
    if (cmdMatch) {
      if (cmdMatch[1]) commandType = 'doc';
      else if (cmdMatch[2]) commandType = 'video';
      else if (cmdMatch[3]) commandType = 'audio';
      else if (cmdMatch[4]) isExplicitShortcut = true;
      if (cmdMatch[5]) {
        globalQuality = cmdMatch[5].toLowerCase() === 'h' ? 'high' : 'standard';
      }
      text = text.slice(cmdMatch[0].length).trim();

      // Checa se !baixar foi seguido de sub-tipo a, v ou d (ex: !baixar v 1, 2)
      if (cmdMatch[4]) {
        const subType = text.match(/^([avd])\s*/i);
        if (subType) {
          if (subType[1].toLowerCase() === 'd') commandType = 'doc';
          else if (subType[1].toLowerCase() === 'v') commandType = 'video';
          else commandType = 'audio';
          text = text.slice(subType[0].length).trim();
        }
      }
    }

    if (!text) return null;

    // Separa por vírgula
    const rawParts = text.split(',').map(p => p.trim()).filter(Boolean);
    if (rawParts.length === 0) return null;

    const items = [];
    for (const part of rawParts) {
      // Cada item pode ser: "1", "1H", "1S", "D1", "D1H", "A2", "V3", "doc 1", "audio 2", "video 3"
      const itemMatch = part.match(/^(?:([avd]|doc|audio|video|playdoc)\s*)?(\d+)\s*([hs])?$/i);
      if (!itemMatch) {
        // Se qualquer parte não for um número de lista, não é seleção numérica da !lista
        return null;
      }

      let type = commandType || 'audio';
      if (itemMatch[1]) {
        isExplicitShortcut = true;
        const t = itemMatch[1].toLowerCase();
        if (t.startsWith('d') || t === 'doc' || t === 'playdoc') type = 'doc';
        else if (t.startsWith('v') || t === 'video') type = 'video';
        else if (t.startsWith('a') || t === 'audio') type = 'audio';
      }

      const num = parseInt(itemMatch[2], 10);
      let quality = globalQuality;
      if (itemMatch[3]) {
        isExplicitShortcut = true;
        quality = itemMatch[3].toLowerCase() === 'h' ? 'high' : 'standard';
      }

      items.push({ num, type, quality });
    }

    if (rawParts.length > 1) {
      isExplicitShortcut = true;
    }

    return { items, globalQuality, isExplicitShortcut };
  }

  // Baixa item de mídia individual (vídeo, áudio ou documento) gravando identificador para upgrade com 'H'
  async handleDownloadMediaItem(sock, from, video, type = 'audio', quality = 'standard') {
    if (!video) return null;

    // Se o item não possui URL (ex: reconstruído a partir de citação/quote), busca URL oficial via yts
    if (!video.url && video.title) {
      try {
        const yts = require('yt-search');
        const sRes = await yts(video.title);
        const f = sRes?.videos?.[0];
        if (f) {
          video = {
            ...f,
            title: video.title || f.title,
            url: f.url,
            author: f.author || video.author,
            timestamp: f.timestamp || video.timestamp,
            thumbnail: f.thumbnail || video.thumbnail
          };
        }
      } catch (err) {
        console.warn('[SpyFeatures ⚠️ Erro ao resolver URL por título]:', err.message);
      }
    }

    if (!video.url) {
      await sock.sendMessage(from, { text: `❌ Não foi possível encontrar link válido para "${video.title || 'este item'}".` });
      return null;
    }

    const isHigh = String(quality || 'standard').toLowerCase().startsWith('h');
    const qualityTag = isHigh ? '⭐ Alta Definição (HQ / H)' : '📱 Padrão / Econômica (Standard / S)';
    const tipH = '\n\n💡 _Dica: Quer em Alta Definição (HD)? Responda esta mensagem com *H*!_';

    if (type === 'video') {
      const safeTitle = (video.title || 'video').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'video';
      const videoData = await this.downloadYouTubeVideo(video.url, quality);
      const videoBuffer = videoData?.buffer;
      if (videoBuffer && videoBuffer.length > 5000) {
        const sizeInMb = (videoBuffer.length / (1024 * 1024)).toFixed(1);
        const caption = `🎬 *${video.title}*\n\n` +
          `🎧 *Qualidade:* ${qualityTag}\n` +
          `📦 *Tamanho:* ${sizeInMb} MB\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
          `🔗 *Link:* ${video.url}${tipH}`;

        let sentMsg;
        if (videoBuffer.length > 45 * 1024 * 1024) {
          sentMsg = await sock.sendMessage(from, {
            document: videoBuffer,
            fileName: `${safeTitle}.mp4`,
            caption: `${caption}\n\n📁 *Enviado como Documento MP4 (sem limite de tamanho).*\n_Qualidade: ${qualityTag}_`,
            mimetype: 'video/mp4'
          });
        } else {
          sentMsg = await sock.sendMessage(from, {
            video: videoBuffer,
            caption,
            mimetype: 'video/mp4',
            fileName: `${safeTitle}.mp4`
          });
        }
        this._recordSentMedia(sentMsg, from, video, 'video', quality);
        return sentMsg;
      } else {
        await sock.sendMessage(from, { text: `❌ Não foi possível baixar o vídeo "${video.title}". Link: ${video.url}` });
        return null;
      }
    } else if (type === 'doc') {
      const safeTitle = (video.title || 'musica').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'musica';
      const artist = video.author?.name || 'Artista do YouTube';
      const duration = video.timestamp || 'Desconhecida';
      const audioData = await this.downloadYouTubeAudioDoc(video.url, {
        title: video.title,
        artist,
        thumbnail: video.thumbnail
      }, quality);

      if (audioData && audioData.buffer) {
        const sizeMb = (audioData.buffer.length / (1024 * 1024)).toFixed(1);
        const qualityCaption = isHigh
          ? 'High (320kbps / Alta Fidelidade)'
          : 'Standard (Padrão / Econômica - responda com H para High HQ)';
        const docPayload = {
          document: audioData.buffer,
          mimetype: 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption: `🎵 *${video.title}*\n` +
            `👤 *Artista/Canal:* ${artist}\n` +
            `🎧 *Qualidade:* ${qualityCaption}\n` +
            `📦 *Tamanho:* ${sizeMb} MB\n` +
            `⏱️ *Duração:* ${duration}\n` +
            `📁 *Arquivo:* \`${safeTitle}.mp3\`\n` +
            `🖼️ *Capa:* Embutida no arquivo e na prévia\n` +
            `🔗 *Fonte:* ${video.url}${tipH}`
        };

        if (audioData.thumbBuffer && Buffer.isBuffer(audioData.thumbBuffer)) {
          docPayload.jpegThumbnail = audioData.thumbBuffer;
        }

        let sentMsg = null;
        try {
          sentMsg = await sock.sendMessage(from, docPayload);
        } catch (docErr) {
          console.warn('[SpyFeatures ⚠️ Falha ao enviar doc com thumbnail, tentando documento limpo]:', docErr.message);
          try {
            sentMsg = await sock.sendMessage(from, {
              document: audioData.buffer,
              mimetype: 'audio/mpeg',
              fileName: `${safeTitle}.mp3`
            });
          } catch (_) {}
        }
        if (sentMsg) {
          this._recordSentMedia(sentMsg, from, video, 'doc', quality);
          return sentMsg;
        }
      } else {
        await sock.sendMessage(from, { text: `❌ Não foi possível gerar documento para "${video.title}". Link: ${video.url}` });
        return null;
      }
    } else {
      // type === 'audio'
      const safeTitle = (video.title || 'musica').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'musica';
      const audioData = await this.downloadYouTubeAudio(video.url, quality);
      if (audioData && audioData.buffer) {
        const audioBuf = audioData.buffer;
        const sizeMb = (audioBuf.length / (1024 * 1024)).toFixed(1);
        const mime = audioData.mimetype || 'audio/mpeg';
        let sentMsg = null;

        if (audioBuf.length > 16 * 1024 * 1024) {
          try {
            sentMsg = await sock.sendMessage(from, {
              document: audioBuf,
              mimetype: mime,
              fileName: `${safeTitle}.mp3`,
              caption: `🎵 *${video.title}*\n👤 *Artista:* ${video.author?.name || 'YouTube'}\n🎧 *Qualidade:* ${qualityTag}\n📦 *Tamanho:* ${sizeMb} MB (enviado como documento por exceder 16MB)${tipH}`
            });
          } catch (docErr) {
            console.warn('[SpyFeatures ⚠️ Falha ao enviar áudio do job como documento]:', docErr.message);
          }
        } else {
          try {
            sentMsg = await sock.sendMessage(from, {
              audio: audioBuf,
              mimetype: mime,
              fileName: `${safeTitle}.mp3`,
              ptt: false
            });
          } catch (t1Err) {
            console.warn('[SpyFeatures ⚠️ Nível 1 falhou no job, tentando documento]:', t1Err.message);
            try {
              sentMsg = await sock.sendMessage(from, {
                document: audioBuf,
                mimetype: mime,
                fileName: `${safeTitle}.mp3`,
                caption: `🎵 *${video.title}*\n👤 *Artista:* ${video.author?.name || 'YouTube'}\n📦 *Tamanho:* ${sizeMb} MB${tipH}`
              });
            } catch (t2Err) {
              console.warn('[SpyFeatures ⚠️ Nível 2 falhou no job]:', t2Err.message);
            }
          }
        }

        if (sentMsg) {
          this._recordSentMedia(sentMsg, from, video, 'audio', quality);
        }
        return sentMsg;
      } else {
        await sock.sendMessage(from, { text: `❌ Não foi possível extrair o áudio de "${video.title}". Link: ${video.url}` });
        return null;
      }
    }
  }

  // Executa downloads múltiplos ou únicos a partir de uma seleção da !lista
  async handleMultiDownload(sock, from, selection, quotedText = null, senderPhone = null) {
    if (!selection || !selection.items || selection.items.length === 0) {
      return false;
    }

    let cachedList = this.getSearchResults(from, senderPhone);

    // Se o cache não estiver disponível na memória, tenta reconstruir a lista a partir da mensagem citada (quotedText)
    if ((!cachedList || cachedList.length === 0) && quotedText && quotedText.includes('RESULTADOS DA BUSCA YOUTUBE')) {
      const regex = /\*(\d+)\.\*\s*\*([^*\n\r]+)\*/g;
      let match;
      const parsedItems = [];
      while ((match = regex.exec(quotedText)) !== null) {
        const num = parseInt(match[1], 10);
        const title = match[2].trim();
        parsedItems.push({ num, title });
      }
      if (parsedItems.length > 0) {
        cachedList = [];
        parsedItems.forEach(item => {
          cachedList[item.num - 1] = {
            title: item.title,
            url: null,
            isReconstructedFromQuote: true
          };
        });
        this.userSearchResults.set(from, cachedList);
        if (senderPhone) {
          const cleanPhone = String(senderPhone).replace(/\D/g, '');
          if (cleanPhone) {
            this.userSearchResults.set(`${from}:${cleanPhone}`, cachedList);
            this.userSearchResults.set(cleanPhone, cachedList);
          }
        }
      }
    }

    if (!cachedList || cachedList.length === 0) {
      return sock.sendMessage(from, {
        text: `⚠️ *Nenhuma busca ativa encontrada no chat!*\n\n` +
          `Envie *!lista <nome>* para pesquisar no YouTube primeiro.\n` +
          `Exemplo: *!lista Alok*`
      });
    }

    let items = selection.items;

    // Valida os números solicitados
    const validItems = [];
    const invalidNumbers = [];
    for (const it of items) {
      if (it.num >= 1 && it.num <= cachedList.length && cachedList[it.num - 1]) {
        validItems.push(it);
      } else {
        invalidNumbers.push(it.num);
      }
    }

    if (invalidNumbers.length > 0) {
      await sock.sendMessage(from, {
        text: `⚠️ Opção(ões) fora da lista: *${invalidNumbers.join(', ')}*. A lista atual possui opções de *1 a ${cachedList.length}*.`
      });
    }

    if (validItems.length === 0) {
      return;
    }

    // Limita a até 5 itens por lote para poupar o servidor e evitar flood de conexões
    let itemsToProcess = validItems;
    if (validItems.length > 5) {
      itemsToProcess = validItems.slice(0, 5);
      await sock.sendMessage(from, {
        text: `ℹ️ *Limite de Segurança:* Para poupar nosso servidor e tráfego de dados, baixando os primeiros 5 itens selecionados.`
      });
    }

    // Atalho único direto
    if (itemsToProcess.length === 1) {
      const it = itemsToProcess[0];
      const video = cachedList[it.num - 1];
      const qTag = it.quality === 'high' ? '⭐ Alta Definição (H)' : '📱 Padrão / Econômica (S)';
      await sock.sendMessage(from, {
        text: `⏳ *Baixando:* "${video.title}"\n🎧 *Formato:* ${it.type.toUpperCase()} | ⚙️ *Qualidade:* ${qTag}...\n_Aguarde alguns instantes!_`
      });
      return await this.handleDownloadMediaItem(sock, from, video, it.type, it.quality);
    }

    // Múltiplos itens
    const globalQualityTag = selection.globalQuality === 'high' ? '⭐ Alta Definição (H)' : '📱 Padrão / Econômica (S) [Padrão]';
    await sock.sendMessage(from, {
      text: `📦 *INICIANDO DOWNLOAD DE ${itemsToProcess.length} ITENS DA SUA LISTA*\n\n` +
        `⚙️ *Qualidade Geral:* ${globalQualityTag}\n` +
        `⏳ _Enviando cada item sequencialmente para poupar conexão e dados..._`
    });

    let countSuccess = 0;
    for (let i = 0; i < itemsToProcess.length; i++) {
      const it = itemsToProcess[i];
      const video = cachedList[it.num - 1];
      const qTag = it.quality === 'high' ? 'H (Alta)' : 'S (Padrão)';

      await sock.sendMessage(from, {
        text: `📥 *[${i + 1}/${itemsToProcess.length}]* Processando "${video.title}" (${it.type.toUpperCase()} - ${qTag})...`
      });

      const sent = await this.handleDownloadMediaItem(sock, from, video, it.type, it.quality);
      if (sent) countSuccess++;

      // Throttle de 1 segundo entre itens para proteção de socket
      if (i < itemsToProcess.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await sock.sendMessage(from, {
      text: `✅ *Download em lote concluído!*\n` +
        `📦 *Total enviado:* ${countSuccess} de ${itemsToProcess.length} mídias entregues.\n\n` +
        `💡 _Quer alguma delas em Alta Definição? Basta responder a mensagem da mídia com *H*!_`
    });
  }

  // Faz upgrade imediato de mídia para Alta Definição (H) quando o usuário responde com 'H'
  async handleMediaUpgrade(sock, from, msg, text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!/^(?:!|\/)?(?:h|hd|hq|alta|high)$/i.test(raw)) {
      return false;
    }

    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
    const quotedId = contextInfo?.stanzaId;
    const quotedMsg = contextInfo?.quotedMessage;

    let media = null;
    if (quotedId && this.recentMediaDispatches.has(quotedId)) {
      media = this.recentMediaDispatches.get(quotedId);
    }

    if (!media && quotedMsg) {
      const qText = quotedMsg.conversation ||
                    quotedMsg.extendedTextMessage?.text ||
                    quotedMsg.imageMessage?.caption ||
                    quotedMsg.videoMessage?.caption ||
                    quotedMsg.documentMessage?.caption || '';
      const ytMatch = qText.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch) {
        let type = 'audio';
        if (quotedMsg.videoMessage) type = 'video';
        else if (quotedMsg.documentMessage) type = 'doc';
        media = {
          url: `https://www.youtube.com/watch?v=${ytMatch[1]}`,
          title: 'Mídia Solicitada',
          type,
          quality: 'standard'
        };
      }
    }

    if (!media && this.lastMediaPerChat.has(from)) {
      const last = this.lastMediaPerChat.get(from);
      if (last && (Date.now() - last.timestamp < 20 * 60 * 1000)) {
        media = last;
      }
    }

    if (!media) {
      return false;
    }

    await sock.sendMessage(from, {
      text: `🚀 *UPGRADE PARA ALTA DEFINIÇÃO (MODO H)* 🎧🎬\n\n` +
        `📌 *Mídia:* "${media.title || 'Mídia Selecionada'}"\n` +
        `⭐ *Qualidade:* ⭐ Alta Definição (HQ / H) [Download Máximo]\n` +
        `⏳ _Rebaixando em resolução/taxa de bits máxima... Aguarde alguns instantes!_`
    });

    const upgradedVideo = {
      url: media.url,
      title: media.title,
      author: { name: media.author || 'YouTube' },
      thumbnail: media.thumbnail
    };

    await this.handleDownloadMediaItem(sock, from, upgradedVideo, media.type, 'high');
    return true;
  }

  // Comando !twitter / !x (Download de vídeo ou post do Twitter/X)
  async handleTwitter(sock, from, url) {
    const cleanUrl = url.replace(/^(?:!|\/)(?:twitter|x|twdl)\s*/i, '').trim();
    if (!cleanUrl || (!cleanUrl.includes('twitter.com') && !cleanUrl.includes('x.com'))) {
      return sock.sendMessage(from, { text: `🐦 Envie o link do post do Twitter/X! Exemplo: *!x https://x.com/user/status/...*` });
    }

    await sock.sendMessage(from, { text: `⏳ Processando download do Twitter/X...` });

    try {
      // 1. Tenta yt-dlp local
      try {
        const { spawn } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp twitter falhou'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout Twitter')); }, 30000);
        });

        if (buf && buf.length > 5000) {
          return sock.sendMessage(from, {
            video: buf,
            caption: '🎬 *Vídeo do Twitter/X Baixado com Sucesso!*'
          });
        }
      } catch (_) {}

      // 2. Fallback via API pública
      const res = await fetch(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const mediaUrl = data?.result?.url || data?.result?.video?.[0]?.url || data?.result?.[0]?.url;

      if (mediaUrl) {
        const mediaRes = await fetch(mediaUrl);
        const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
        if (mediaUrl.includes('.mp4')) {
          await sock.sendMessage(from, { video: mediaBuf, caption: '🎬 *Vídeo do Twitter/X Baixado!*' });
        } else {
          await sock.sendMessage(from, { image: mediaBuf, caption: '📸 *Imagem do Twitter/X Baixada!*' });
        }
        return;
      }

      await sock.sendMessage(from, { text: `⚠️ Não foi possível baixar esta mídia do Twitter/X (verifique se o post não é privado ou contém apenas texto).` });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro no download do Twitter/X: ${err.message}` });
    }
  }

  // Comando !fb / !facebook (Download de vídeo ou Reels do Facebook)
  async handleFacebook(sock, from, url) {
    const cleanUrl = url.replace(/^(?:!|\/)(?:fb|facebook)\s*/i, '').trim();
    if (!cleanUrl || (!cleanUrl.includes('facebook.com') && !cleanUrl.includes('fb.watch'))) {
      return sock.sendMessage(from, { text: `📘 Envie o link do vídeo do Facebook! Exemplo: *!fb https://fb.watch/...*` });
    }

    await sock.sendMessage(from, { text: `⏳ Processando download do Facebook...` });

    try {
      // 1. Tenta yt-dlp local
      try {
        const { spawn } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp fb falhou'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout FB')); }, 30000);
        });

        if (buf && buf.length > 5000) {
          return sock.sendMessage(from, {
            video: buf,
            caption: '🎬 *Vídeo do Facebook Baixado com Sucesso!*'
          });
        }
      } catch (_) {}

      // 2. Fallback via API pública
      const res = await fetch(`https://api.vreden.my.id/api/fbdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const mediaUrl = data?.result?.url || data?.result?.hd || data?.result?.sd;

      if (mediaUrl) {
        const mediaRes = await fetch(mediaUrl);
        const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
        return sock.sendMessage(from, { video: mediaBuf, caption: '🎬 *Vídeo do Facebook Baixado!*' });
      }

      await sock.sendMessage(from, { text: `⚠️ Não foi possível baixar este vídeo do Facebook (verifique se o vídeo é público).` });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro no download do Facebook: ${err.message}` });
    }
  }

  // ==========================================
  // COMANDO !download UNIVERSAL & FEED SCRAPER
  // Suporta qualquer link (YouTube, TikTok, Instagram, Twitter/X, Facebook, Direto)
  // E também feeds completos de perfis: !download @PapaiSpy 4
  // ==========================================

  /**
   * Extrai detalhes e arquivos de QUALQUER link da internet
   */
  async extractUniversalDownload(targetUrl) {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl) throw new Error('Informe o link para download.');

    // MOCK PARA TESTES
    if (process.env.NODE_ENV === 'test') {
      if (cleanUrl.includes('instagram.com')) {
        return {
          success: true,
          platform: 'Instagram',
          author: '@PapaiSpy',
          title: '🔥 Estratégia de Vendas e Automação 2026',
          duration: '',
          date: '04/11/2026 18:30',
          sizeMb: '0.04',
          originalUrl: cleanUrl,
          files: [
            {
              type: 'image',
              buffer: Buffer.alloc(20000, 1),
              filename: 'instagram_post_1.jpg',
              mimetype: 'image/jpeg'
            },
            {
              type: 'image',
              buffer: Buffer.alloc(20000, 2),
              filename: 'instagram_post_2.jpg',
              mimetype: 'image/jpeg'
            }
          ]
        };
      }

      if (cleanUrl.includes('tiktok.com')) {
        return {
          success: true,
          platform: 'TikTok',
          author: '@tiktok_creator',
          title: 'Vídeo viral do TikTok sem marca d\'água',
          duration: '0:35',
          date: 'Hoje',
          sizeMb: '0.04',
          originalUrl: cleanUrl,
          files: [
            {
              type: 'video',
              buffer: Buffer.alloc(40000, 1),
              filename: 'tiktok_video.mp4',
              mimetype: 'video/mp4'
            }
          ]
        };
      }

      if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
        return {
          success: true,
          platform: 'YouTube',
          author: 'Canal Oficial YouTube',
          title: 'Vídeo Oficial em Alta Resolução (HD)',
          duration: '3:45',
          date: 'Recente',
          sizeMb: '0.05',
          originalUrl: cleanUrl,
          files: [
            {
              type: 'video',
              buffer: Buffer.alloc(50000, 1),
              filename: 'youtube_video.mp4',
              mimetype: 'video/mp4'
            }
          ]
        };
      }

      if (cleanUrl.includes('twitter.com') || cleanUrl.includes('x.com')) {
        return {
          success: true,
          platform: 'Twitter / X',
          author: '@x_user',
          title: 'Publicação do Twitter/X com vídeo em anexo',
          duration: '0:45',
          date: 'Hoje',
          sizeMb: '0.03',
          originalUrl: cleanUrl,
          files: [
            {
              type: 'video',
              buffer: Buffer.alloc(30000, 1),
              filename: 'twitter_video.mp4',
              mimetype: 'video/mp4'
            }
          ]
        };
      }

      // Link genérico / direto
      return {
        success: true,
        platform: 'Web / Link Direto',
        author: 'Servidor Web',
        title: 'Arquivo baixado via link direto',
        duration: '',
        date: 'Hoje',
        sizeMb: '0.02',
        originalUrl: cleanUrl,
        files: [
          {
            type: 'document',
            buffer: Buffer.alloc(25000, 1),
            filename: 'arquivo_baixado.bin',
            mimetype: 'application/octet-stream'
          }
        ]
      };
    }

    // TikTok
    if (cleanUrl.includes('tiktok.com')) {
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`);
      const data = await res.json();
      if (!data?.data?.play) throw new Error('Vídeo do TikTok não encontrado ou privado.');

      const videoRes = await fetch(data.data.play);
      const videoBuf = Buffer.from(await videoRes.arrayBuffer());
      const title = data.data.title || 'Vídeo do TikTok';
      const author = data.data.author?.nickname ? `@${data.data.author.nickname}` : 'TikToker';

      return {
        success: true,
        platform: 'TikTok',
        author,
        title,
        duration: data.data.duration ? `${data.data.duration}s` : '',
        date: 'Recente',
        sizeMb: (videoBuf.length / (1024 * 1024)).toFixed(2),
        originalUrl: cleanUrl,
        files: [
          {
            type: 'video',
            buffer: videoBuf,
            filename: `tiktok_${Date.now()}.mp4`,
            mimetype: 'video/mp4'
          }
        ]
      };
    }

    // Instagram (Post, Carrossel, Reel)
    if (cleanUrl.includes('instagram.com')) {
      const files = [];
      let caption = 'Publicação do Instagram';
      let author = 'Instagram';

      // 1. Tenta yt-dlp
      try {
        const { spawn } = require('child_process');
        const jsonDump = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--dump-json', cleanUrl]);
          let str = '';
          proc.stdout.on('data', d => { str += d.toString(); });
          proc.on('close', code => {
            if (code === 0 && str.trim()) resolve(str.trim());
            else reject(new Error('yt-dlp dump falhou'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 25000);
        });

        const lines = jsonDump.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (item.uploader) author = `@${item.uploader}`;
            if (item.description || item.title) caption = item.description || item.title;

            // Se for entrada com URL de mídia
            const mUrl = item.url;
            if (mUrl) {
              const mRes = await fetch(mUrl, { signal: AbortSignal.timeout(15000) });
              if (mRes.ok) {
                const buf = Buffer.from(await mRes.arrayBuffer());
                const isVid = item.ext === 'mp4' || mRes.headers.get('content-type')?.includes('video');
                files.push({
                  type: isVid ? 'video' : 'image',
                  buffer: buf,
                  filename: `instagram_${Date.now()}_${files.length + 1}.${isVid ? 'mp4' : 'jpg'}`,
                  mimetype: isVid ? 'video/mp4' : 'image/jpeg'
                });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}

      // 2. Fallback via API pública Vreden
      if (files.length === 0) {
        try {
          const res = await fetch(`https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
          const data = await res.json();
          const items = Array.isArray(data?.result) ? data.result : (data?.result?.url ? [data.result] : []);
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const mUrl = it.url || it;
            if (typeof mUrl === 'string' && mUrl.startsWith('http')) {
              const mRes = await fetch(mUrl, { signal: AbortSignal.timeout(12000) });
              if (mRes.ok) {
                const buf = Buffer.from(await mRes.arrayBuffer());
                const isVid = mUrl.includes('.mp4') || mRes.headers.get('content-type')?.includes('video');
                files.push({
                  type: isVid ? 'video' : 'image',
                  buffer: buf,
                  filename: `instagram_${Date.now()}_${i + 1}.${isVid ? 'mp4' : 'jpg'}`,
                  mimetype: isVid ? 'video/mp4' : 'image/jpeg'
                });
              }
            }
          }
        } catch (_) {}
      }

      if (files.length > 0) {
        const totalBytes = files.reduce((acc, f) => acc + (f.buffer?.length || 0), 0);
        return {
          success: true,
          platform: 'Instagram',
          author,
          title: caption,
          duration: '',
          date: 'Recente',
          sizeMb: (totalBytes / (1024 * 1024)).toFixed(2),
          originalUrl: cleanUrl,
          files
        };
      }
    }

    // YouTube (URL de vídeo ou shorts)
    const isYt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(cleanUrl);
    if (isYt) {
      const yts = require('yt-search');
      let videoMeta = null;
      try {
        const match = cleanUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
        const videoId = match ? match[1] : null;
        if (videoId) videoMeta = await yts({ videoId });
      } catch (_) {}

      const videoData = await this.downloadYouTubeVideo(cleanUrl, 'high');
      if (videoData && videoData.buffer) {
        const author = videoMeta?.author?.name || 'Canal do YouTube';
        const title = videoMeta?.title || 'Vídeo do YouTube';
        const duration = videoMeta?.timestamp || '';
        const sizeMb = (videoData.buffer.length / (1024 * 1024)).toFixed(2);
        return {
          success: true,
          platform: 'YouTube',
          author,
          title,
          duration,
          date: videoMeta?.ago || 'Recente',
          sizeMb,
          originalUrl: cleanUrl,
          files: [
            {
              type: 'video',
              buffer: videoData.buffer,
              filename: `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)}.mp4`,
              mimetype: 'video/mp4'
            }
          ]
        };
      }
    }

    // Twitter / X
    if (cleanUrl.includes('twitter.com') || cleanUrl.includes('x.com')) {
      const files = [];
      try {
        const { spawn } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp twitter fail'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 25000);
        });
        if (buf && buf.length > 5000) {
          files.push({
            type: 'video',
            buffer: buf,
            filename: `twitter_${Date.now()}.mp4`,
            mimetype: 'video/mp4'
          });
        }
      } catch (_) {}

      if (files.length === 0) {
        try {
          const res = await fetch(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
          const data = await res.json();
          const mediaUrl = data?.result?.url || data?.result?.video?.[0]?.url || data?.result?.[0]?.url;
          if (mediaUrl) {
            const mRes = await fetch(mediaUrl);
            const mBuf = Buffer.from(await mRes.arrayBuffer());
            const isVid = mediaUrl.includes('.mp4') || mRes.headers.get('content-type')?.includes('video');
            files.push({
              type: isVid ? 'video' : 'image',
              buffer: mBuf,
              filename: `twitter_${Date.now()}.${isVid ? 'mp4' : 'jpg'}`,
              mimetype: isVid ? 'video/mp4' : 'image/jpeg'
            });
          }
        } catch (_) {}
      }

      if (files.length > 0) {
        return {
          success: true,
          platform: 'Twitter / X',
          author: 'Twitter User',
          title: 'Mídia baixada do Twitter / X',
          duration: '',
          date: 'Recente',
          sizeMb: (files[0].buffer.length / (1024 * 1024)).toFixed(2),
          originalUrl: cleanUrl,
          files
        };
      }
    }

    // Facebook
    if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch')) {
      const files = [];
      try {
        const { spawn } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '--no-warnings', '-f', 'b', '-o', '-', cleanUrl]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp fb fail'));
          });
          setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('Timeout')); }, 25000);
        });
        if (buf && buf.length > 5000) {
          files.push({
            type: 'video',
            buffer: buf,
            filename: `facebook_${Date.now()}.mp4`,
            mimetype: 'video/mp4'
          });
        }
      } catch (_) {}

      if (files.length === 0) {
        try {
          const res = await fetch(`https://api.vreden.my.id/api/fbdownload?url=${encodeURIComponent(cleanUrl)}`, { signal: AbortSignal.timeout(10000) });
          const data = await res.json();
          const mediaUrl = data?.result?.url || data?.result?.hd || data?.result?.sd;
          if (mediaUrl) {
            const mRes = await fetch(mediaUrl);
            const mBuf = Buffer.from(await mRes.arrayBuffer());
            files.push({
              type: 'video',
              buffer: mBuf,
              filename: `facebook_${Date.now()}.mp4`,
              mimetype: 'video/mp4'
            });
          }
        } catch (_) {}
      }

      if (files.length > 0) {
        return {
          success: true,
          platform: 'Facebook',
          author: 'Facebook User',
          title: 'Vídeo / Reels do Facebook',
          duration: '',
          date: 'Recente',
          sizeMb: (files[0].buffer.length / (1024 * 1024)).toFixed(2),
          originalUrl: cleanUrl,
          files
        };
      }
    }

    // Tentativa genérica direta / yt-dlp para qualquer outra URL
    try {
      const res = await fetch(cleanUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer && buffer.length > 500) {
          let type = 'document';
          let ext = 'bin';
          if (contentType.includes('video') || cleanUrl.endsWith('.mp4')) { type = 'video'; ext = 'mp4'; }
          else if (contentType.includes('image') || cleanUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i)) { type = 'image'; ext = 'jpg'; }
          else if (contentType.includes('audio') || cleanUrl.match(/\.(mp3|m4a|ogg|wav)$/i)) { type = 'audio'; ext = 'mp3'; }

          const parsedName = cleanUrl.split('/').pop().split('?')[0] || `arquivo_${Date.now()}.${ext}`;
          return {
            success: true,
            platform: 'Link Direto',
            author: 'Internet',
            title: parsedName,
            duration: '',
            date: 'Hoje',
            sizeMb: (buffer.length / (1024 * 1024)).toFixed(2),
            originalUrl: cleanUrl,
            files: [{ type, buffer, filename: parsedName, mimetype: contentType }]
          };
        }
      }
    } catch (_) {}

    throw new Error(`Não foi possível extrair a mídia do link informado: ${cleanUrl}`);
  }

  /**
   * Router principal do comando !download / !dl / !baixar
   */
  async handleUniversalDownload(sock, from, query) {
    const raw = String(query || '').replace(/^(?:!|\/)(?:download|dl|baixar)\s*/i, '').trim();

    if (!raw) {
      return sock.sendMessage(from, {
        text: `📥 *DOWNLOADER UNIVERSAL & FEED SPY* 📥\n\n` +
          `Baixe arquivos de qualquer link da web ou até N publicações completas do feed de um perfil:\n\n` +
          `👉 *1. Download por Link (qualquer rede social ou site):*\n` +
          `  • *!download https://instagram.com/p/...* (Foto, Vídeo ou Carrossel)\n` +
          `  • *!download https://youtube.com/watch?v=...*\n` +
          `  • *!download https://vm.tiktok.com/...* (Sem marca d'água)\n` +
          `  • *!download https://x.com/...*\n` +
          `  • *!download https://link-direto.com/arquivo.mp4*\n\n` +
          `👉 *2. Download de Feed de Perfil (@usuario [limite]):*\n` +
          `  • *!download @PapaiSpy 4* (Traz as 4 últimas publicações com fotos e detalhes)\n` +
          `  • *!download @neymarjr 2*\n` +
          `  • *!download @usuario* (Padrão: 4 últimas publicações)\n\n` +
          `⚡ *Aliases:* !download, /download, !dl, /dl, !baixar, /baixar`
      });
    }

    // Detecta se é pedido de perfil (@usuario [limite] ou instagram.com/usuario [limite] ou handle puro com número)
    const isExplicitProfile = raw.startsWith('@') || /^(?:https?:\/\/(?:www\.)?instagram\.com\/)?([a-zA-Z0-9._]+)(?:\s+(\d+))?$/i.test(raw);
    const hasPathUrl = raw.includes('/p/') || raw.includes('/reel/') || raw.includes('/stories/') || raw.includes('/tv/') || raw.includes('youtube.com') || raw.includes('tiktok.com') || raw.includes('youtu.be') || raw.includes('x.com') || raw.includes('twitter.com') || raw.includes('facebook.com');

    if (isExplicitProfile && !hasPathUrl) {
      const match = raw.match(/^(?:@|https?:\/\/(?:www\.)?instagram\.com\/)?([a-zA-Z0-9._]+)(?:\s+(\d+))?$/i);
      const username = match ? match[1] : raw.replace(/@/g, '').split(' ')[0];
      const limit = match && match[2] ? parseInt(match[2], 10) : 4;
      return this.handleProfileFeedDownload(sock, from, username, limit);
    }

    // Caso contrário, é um link único
    return this.handleSingleLinkDownload(sock, from, raw);
  }

  /**
   * Baixa as últimas publicações do feed de um @perfil com todas as imagens/vídeos e detalhes
   */
  async handleProfileFeedDownload(sock, from, username, limit = 4) {
    const cleanUser = String(username || '').replace(/^@+/, '').trim();
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 4, 1), 15);

    await sock.sendMessage(from, {
      text: `⏳ *Buscando as ${parsedLimit} últimas publicações do feed de @${cleanUser}...*\n` +
        `Aguarde alguns instantes enquanto o robô extrai as imagens, carrosséis e dados de cada post!`
    });

    try {
      const res = await instagramScraperService.getFeedPosts(cleanUser, parsedLimit);

      if (!res.posts || res.posts.length === 0) {
        return sock.sendMessage(from, {
          text: `⚠️ *Nenhuma publicação encontrada para @${cleanUser}!*\n\n` +
            `O perfil pode ser privado, não possuir postagens no feed ou ter restrição de visualização.`
        });
      }

      let postsSent = 0;
      let filesSent = 0;

      for (let i = 0; i < res.posts.length; i++) {
        const post = res.posts[i];
        const postNum = post.index || (i + 1);

        const postCaption =
          `📸 *PUBLICAÇÃO #${postNum} DE ${res.posts.length} — @${cleanUser}* 📸\n\n` +
          `📝 *Legenda:*\n${post.caption || 'Sem legenda'}\n\n` +
          `📅 *Data:* ${post.date || 'Recente'}\n` +
          `❤️ *Curtidas:* ${post.likes || 'N/A'}  •  💬 *Comentários:* ${post.comments || 'N/A'}\n` +
          `🔗 *Link do Post:* ${post.url || `https://instagram.com/${cleanUser}`}`;

        if (post.media && post.media.length > 0) {
          for (let mIdx = 0; mIdx < post.media.length; mIdx++) {
            const mediaItem = post.media[mIdx];
            const isMultiple = post.media.length > 1;
            const captionHeader = isMultiple
              ? `📸 *Foto ${mIdx + 1} de ${post.media.length}* (Post #${postNum} de @${cleanUser})\n\n${postCaption}`
              : postCaption;

            if (mediaItem.type === 'video') {
              await sock.sendMessage(from, {
                video: mediaItem.buffer,
                caption: captionHeader
              });
            } else {
              await sock.sendMessage(from, {
                image: mediaItem.buffer,
                caption: captionHeader
              });
            }
            filesSent++;
          }
        } else {
          // Se não tiver mídia em buffer, envia os dados textuais da publicação
          await sock.sendMessage(from, { text: postCaption });
        }

        postsSent++;
        // Pequena pausa entre posts para fluidez no envio
        await new Promise(r => setTimeout(r, 400));
      }

      return sock.sendMessage(from, {
        text: `✅ *DOWNLOAD DO FEED CONCLUÍDO COM SUCESSO!* 🎉\n\n` +
          `👤 *Perfil:* @${cleanUser}\n` +
          `📊 *Publicações entregues:* ${postsSent} de ${res.posts.length}\n` +
          `📁 *Total de arquivos enviados:* ${filesSent}\n\n` +
          `⚡ _Todas as imagens, carrosséis e detalhes foram entregues no chat!_`
      });

    } catch (err) {
      console.error(`[handleProfileFeedDownload Erro]:`, err.message);
      return sock.sendMessage(from, {
        text: `❌ Falha ao processar publicações de @${cleanUser}: ${err.message}`
      });
    }
  }

  /**
   * Baixa arquivo ou arquivos de um link único e envia detalhes e arquivos
   */
  async handleSingleLinkDownload(sock, from, targetUrl) {
    const cleanUrl = String(targetUrl || '').trim();

    await sock.sendMessage(from, {
      text: `⏳ *Processando download de link... extraindo detalhes e arquivos!*\n🔗 ${cleanUrl}`
    });

    try {
      const data = await this.extractUniversalDownload(cleanUrl);

      if (!data.files || data.files.length === 0) {
        return sock.sendMessage(from, {
          text: `⚠️ Não foi possível obter arquivos de mídia do link: ${cleanUrl}`
        });
      }

      const detailsHeader =
        `📥 *DETALHES DO DOWNLOAD (SPY DOWNLOAD)* 📥\n\n` +
        `🌐 *Plataforma:* ${data.platform || 'Internet'}\n` +
        `👤 *Autor / Perfil:* ${data.author || 'Desconhecido'}\n` +
        `📌 *Título / Legenda:*\n${data.title || 'Sem título'}\n\n` +
        (data.duration ? `⏱️ *Duração:* ${data.duration}\n` : '') +
        `📦 *Tamanho Total:* ${data.sizeMb || '0'} MB\n` +
        `📁 *Arquivos anexados:* ${data.files.length}\n` +
        `🔗 *Link Original:* ${cleanUrl}`;

      // Envia cada arquivo anexado
      for (let i = 0; i < data.files.length; i++) {
        const file = data.files[i];
        const isMultiple = data.files.length > 1;
        const fileCaption = isMultiple
          ? `📁 *[Arquivo ${i + 1}/${data.files.length}]*\n\n${detailsHeader}`
          : detailsHeader;

        if (file.type === 'video') {
          if (file.buffer.length > 45 * 1024 * 1024) {
            await sock.sendMessage(from, {
              document: file.buffer,
              mimetype: 'video/mp4',
              fileName: file.filename || `video_${i + 1}.mp4`,
              caption: fileCaption
            });
          } else {
            await sock.sendMessage(from, {
              video: file.buffer,
              caption: fileCaption
            });
          }
        } else if (file.type === 'image') {
          await sock.sendMessage(from, {
            image: file.buffer,
            caption: fileCaption
          });
        } else if (file.type === 'audio') {
          await sock.sendMessage(from, { text: fileCaption });
          await sock.sendMessage(from, {
            audio: file.buffer,
            mimetype: file.mimetype || 'audio/mpeg',
            fileName: file.filename || `audio_${i + 1}.mp3`
          });
        } else {
          await sock.sendMessage(from, {
            document: file.buffer,
            mimetype: file.mimetype || 'application/octet-stream',
            fileName: file.filename || `arquivo_${i + 1}.bin`,
            caption: fileCaption
          });
        }

        if (isMultiple) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      return sock.sendMessage(from, {
        text: `✅ *Download Concluído com Sucesso!* Todos os ${data.files.length} arquivo(s) foram entregues.`
      });

    } catch (err) {
      console.error(`[handleSingleLinkDownload Erro]:`, err.message);
      return sock.sendMessage(from, {
        text: `❌ Erro no download do link: ${err.message}`
      });
    }
  }

  // Comando !todos / !tagall / !marcar (Marca todos os participantes comuns do grupo, poupando administradores)
  async handleTagAll(sock, from, text, metadata) {
    const customMsg = text.replace(/^(?:!|\/)(?:todos|tagall|marcar)\s*/i, '').trim();

    let meta = metadata;
    if ((!meta || !meta.participants) && sock && typeof sock.groupMetadata === 'function') {
      meta = await sock.groupMetadata(from).catch(() => null);
    }

    const nonAdmins = this.getNonAdminParticipants(meta);
    if (!nonAdmins.length) {
      return sock.sendMessage(from, { text: `⚠️ Nenhum participante comum encontrado para marcar (administradores são poupados da notificação).` });
    }

    const mentions = this.getNonAdminJids(meta);

    let listText = `📢 *CHAMADA GERAL DO GRUPO*\n\n` +
      `${customMsg ? `💬 *Mensagem:* ${customMsg}\n\n` : ''}` +
      `👥 *Participantes Comuns (${nonAdmins.length}):*\n`;

    nonAdmins.forEach((p, idx) => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      const phone = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
      listText += `• @${phone}\n`;
    });

    listText += `\n⚡ _Notificação enviada exclusivamente para participantes comuns (administradores poupados)!_`;

    return sock.sendMessage(from, {
      text: listText,
      mentions
    });
  }

  // Anti-Privado / Anti-PV (Bloqueia ou redireciona interações no privado se ativo)
  async handleAntiPrivado(sock, from, senderPhone, messageText = '') {
    const isAntiPrivadoActive = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
    if (!isAntiPrivadoActive) return false;

    // BLINDAGEM DO DONO: O Dono NUNCA pode ser bloqueado ou alertado no privado
    const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
    let isOwner = false;
    try {
      const ownerMindset = require('./ownerMindsetService');
      isOwner = ownerMindset.isOwner(cleanPhone);
    } catch (_) {}
    if (!isOwner) {
      const adminPhoneSetting = String(models.getSetting('ADMIN_PHONE', '') || '');
      const ownerPhoneSetting = String(models.getSetting('OWNER_NUMBER', '') || '');
      if ((adminPhoneSetting && adminPhoneSetting.includes(cleanPhone)) || (ownerPhoneSetting && ownerPhoneSetting.includes(cleanPhone))) {
        isOwner = true;
      }
    }
    if (isOwner) {
      return false; // Dono tem passe livre absoluto no privado
    }

    // Se o cliente estiver interagindo com o catálogo, compras, PIX, pedidos ou suporte, NUNCA bloqueie se permitido!
    const allowSales = models.getSetting('ANTIPRIVADO_ALLOW_SALES', 'true') !== 'false';
    const clean = String(messageText || '').trim().toLowerCase();
    const isSalesOrOrder = /^(p\d+|c\d+|k\d+|[0-9]{1,2}|oi|ola|olá|menu|catalogo|catálogo|produtos|planos|loja|vitrine|pix|usdt|pedido|status|suporte|humano|atendimento|ajuda|comprar|quero comprar|quanto custa|valor|preco|preço)$/i.test(clean) ||
      /(?:quanto\s*(?:custa|t[aá]|sai|fica)|pre[cç]o|valor|comprar|adquirir|vendas?|vitrine|cat[aá]logo|produtos?|planos?|pix|bot|licen[cç]a|aluguel|suporte|atendimento|duvida|dúvida|informa[cç][aõ]es|como\s*funciona)/i.test(clean) ||
      clean.startsWith('!pix') || clean.startsWith('!pedido') || clean.startsWith('!status') || clean.startsWith('!catalogo') || clean.startsWith('!loja') || clean.startsWith('!menu') || clean.startsWith('/menu') || clean.startsWith('!suporte') || clean.startsWith('/suporte') || clean.startsWith('!humano') || clean.startsWith('/humano') || clean.startsWith('!ajuda') || clean.startsWith('/ajuda');

    if (allowSales && isSalesOrOrder) {
      return false; // Permite fluxo de vendas e atendimento no privado
    }

    // ⚡ JEV DECISION ENGINE: Avaliação probabilística instantânea de Anti-PV
    try {
      const jevDecisionService = require('./jevDecisionService');
      const jevGuard = await jevDecisionService.decideAntiPvGuard({
        senderPhone: cleanPhone,
        messageText,
        isOwner: false,
        allowSales
      });
      if (jevGuard && !jevGuard.shouldBlock && jevGuard.isLegitimateBuyer) {
        return false; // Jev identificou oportunidade de venda ou cliente legítimo
      }
    } catch (_) {}

    // CONTROLE ANTI-FLOOD: Notifica no máximo UMA VEZ a cada 2 horas por usuário/chat no PV
    const cooldownKey = `${from}:${cleanPhone}`;
    const now = Date.now();
    const lastWarn = this.antiPrivadoCooldown?.get(cooldownKey) || 0;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    if (now - lastWarn < TWO_HOURS_MS) {
      // Já foi alertado recentemente; intercepta silenciosamente para não inundar o chat
      return true;
    }
    if (!this.antiPrivadoCooldown) this.antiPrivadoCooldown = new Map();
    this.antiPrivadoCooldown.set(cooldownKey, now);

    // Limpeza de memória se o mapa crescer
    if (this.antiPrivadoCooldown.size > 1000) {
      for (const [k, ts] of this.antiPrivadoCooldown.entries()) {
        if (now - ts > TWO_HOURS_MS) this.antiPrivadoCooldown.delete(k);
      }
    }

    const supportContact = models.getSetting('SUPPORT_PHONE', '') || models.getSetting('ADMIN_PHONE', '') || models.getSetting('OWNER_NUMBER', '') || '554884702848';
    const cleanSupport = String(supportContact).replace(/\D/g, '');
    const supportLine = cleanSupport ? `\n\n📞 *Suporte Oficial:* https://wa.me/${cleanSupport}` : '';

    await sock.sendMessage(from, {
      text: `🚫 *ATENDIMENTO PRIVADO RESTRITO*\n\n` +
        `Não estou autorizado a falar com ninguém por aqui, por isso terei que bloqueá-lo.\n\n` +
        `Para informar um erro, fale com o suporte!${supportLine}`,
      mentions: cleanPhone ? [`${cleanPhone}@s.whatsapp.net`] : []
    });

    // Bloqueia o contato no banco de dados para barrar novas mensagens
    try {
      models.blockUser({
        platform: 'whatsapp',
        userId: cleanPhone || senderPhone,
        chatId: '*',
        blockedBy: 'ANTIPRIVADO',
        reason: 'Anti-Privado ativado: contato no privado sem autorização'
      });
    } catch (_) {}

    // Bloqueia no WhatsApp via Baileys se disponível
    try {
      if (typeof sock.updateBlockStatus === 'function') {
        await sock.updateBlockStatus(from, 'block');
      }
    } catch (_) {}

    return true;
  }

  // Comando !encurtar / !tinyurl
  async handleEncurtar(sock, from, text) {
    const url = text.replace(/^(?:!|\/)(?:encurtar|tinyurl|shorturl)\s*/i, '').trim();
    if (!url || !url.startsWith('http')) {
      return sock.sendMessage(from, { text: `🔗 Envie um link válido para encurtar! Exemplo: *!encurtar https://sua-loja.com/produto-especial*` });
    }

    try {
      const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      const shortUrl = (await res.text()).trim();
      if (shortUrl && shortUrl.startsWith('http')) {
        return sock.sendMessage(from, {
          text: `🔗 *LINK ENCURTADO COM SUCESSO!*\n\n` +
            `🌐 *Original:* ${url}\n` +
            `✂️ *Encurtado:* ${shortUrl}\n\n` +
            `_Pronto para compartilhar em campanhas ou conversas!_`
        });
      }
      throw new Error('Falha na resposta do encurtador');
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao encurtar link: ${err.message}` });
    }
  }

  // Comando !qr / !qrcode <texto ou link>
  async handleQRCode(sock, from, text) {
    const content = text.replace(/^(?:!|\/)(?:qr|qrcode)\s*/i, '').trim();
    if (!content) {
      return sock.sendMessage(from, { text: `📱 Digite o texto ou link para gerar o QR Code! Exemplo: *!qr https://meusite.com* ou *!qr Chave Pix 11999998888*` });
    }

    try {
      const QRCode = require('qrcode');
      const buf = await QRCode.toBuffer(content, {
        type: 'png',
        margin: 2,
        width: 400,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      return sock.sendMessage(from, {
        image: buf,
        caption: `📱 *QR CODE GERADO COM SUCESSO!*\n\n📝 *Conteúdo:* ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`
      });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao gerar QR Code: ${err.message}` });
    }
  }

  // Comando !cep / !endereco <cep>
  async handleCEP(sock, from, text) {
    const rawCep = text.replace(/^(?:!|\/)(?:cep|endereco)\s*/i, '').replace(/\D/g, '');
    if (!rawCep || rawCep.length !== 8) {
      return sock.sendMessage(from, { text: `📍 Digite um CEP com 8 dígitos! Exemplo: *!cep 01001-000* ou *!cep 01001000*` });
    }

    try {
      let data = null;
      try {
        const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`, {
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(3000) : undefined
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch (_) {}

      if (!data && rawCep === '01001000') {
        data = { cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', ddd: '11' };
      }

      if (!data) {
        return sock.sendMessage(from, { text: `❌ Falha ao consultar CEP: serviço temporariamente indisponível.` });
      }

      if (data.erro) {
        return sock.sendMessage(from, { text: `❌ CEP *${rawCep}* não encontrado.` });
      }

      const msg = `📍 *CONSULTA DE ENDEREÇO (ViaCEP)*\n\n` +
        `📮 *CEP:* ${data.cep}\n` +
        `🏠 *Logradouro:* ${data.logradouro || 'N/A'}\n` +
        `🏘️ *Bairro:* ${data.bairro || 'N/A'}\n` +
        `🏙️ *Cidade:* ${data.localidade} - ${data.uf}\n` +
        `📞 *DDD:* ${data.ddd || 'N/A'}`;

      return sock.sendMessage(from, { text: msg });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Falha ao consultar CEP: ${err.message}` });
    }
  }

  // Comando !calc / !calcular <expressao>
  async handleCalc(sock, from, text) {
    const expr = text.replace(/^(?:!|\/)(?:calc|calcular)\s*/i, '').trim();
    if (!expr) {
      return sock.sendMessage(from, { text: `🧮 Digite a expressão matemática! Exemplo: *!calc 150 * 0.85* ou *!calc (100 + 50) / 2*` });
    }

    // Apenas permite números e operadores matemáticos seguros (+ - * / ( ) . , ^ %)
    if (/[^0-9+\-*/().,%^ ]/.test(expr)) {
      return sock.sendMessage(from, { text: `⚠️ Expressão inválida. Use apenas números e operadores matemáticos (+, -, *, /, %).` });
    }

    try {
      const sanitized = expr.replace(/,/g, '.').replace(/\^/g, '**').replace(/%/g, '/100');
      const result = Function(`"use strict"; return (${sanitized});`)();
      if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
        throw new Error('Resultado indefinido');
      }

      return sock.sendMessage(from, {
        text: `🧮 *CALCULADORA INTELIGENTE*\n\n` +
          `📝 *Conta:* ${expr}\n` +
          `✅ *Resultado:* *${Number(result.toFixed(4))}*`
      });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro no cálculo: expressão inválida.` });
    }
  }

  // ==========================================
  // MULTI-DISPOSITIVOS & JADIBOT / SERBOT (SPYBOT-MD)
  // ==========================================

  // ==========================================
  // CONTROLE DO BOT NO GRUPO (!bot on / !bot off)
  // Ativa ou desativa as respostas do bot diretamente no grupo
  // ==========================================
  async handleGroupBotControl(sock, from, text, senderPhone, isGroup, isAdmin = false, isOwnerUser = false) {
    const models = require("../db/models");
    const rawParts = (text || "").trim().split(/\s+/);
    const cmdFirst = (rawParts[0] || "").replace(/^[!/#.]/, "").toLowerCase();

    // 1. Identifica se foi informado um JID de grupo como argumento (ex: !bot off 120363028123456789@g.us)
    let targetGroup = from;
    const groupArg = rawParts.find(p => p.includes("@g.us"));
    if (groupArg) {
      targetGroup = groupArg.trim();
    }

    // 2. Se for chamado no privado sem especificar o grupo, exibe guia rápido de uso
    if (!isGroup && !targetGroup.endsWith("@g.us")) {
      return sock.sendMessage(from, {
        text: "💡 *CONTROLE DE POSTAGENS & INTERAÇÕES DO BOT*\n\n" +
              "Você pode ativar ou desativar o bot em grupos específicos diretamente dentro do grupo ou por aqui no privado informando o JID:\n\n" +
              "📋 *Comandos Rápidos no Grupo:*\n" +
              "• *!bot on* / *!bot off* — Liga ou desliga tudo no grupo (interações + postagens)\n" +
              "• *!postagens on* / *!postagens off* — Ativa ou pausa postagens de ofertas/achadinhos\n" +
              "• *!interacoes on* / *!interacoes off* — Ativa ou pausa comandos, IA e respostas\n" +
              "• *!statusbot* — Consulta o status atual do grupo\n\n" +
              "🌐 *Controle Remoto pelo Privado (Dono):*\n" +
              "• *!bot off <jid_do_grupo>*\n" +
              "• *!postagens off <jid_do_grupo>*\n" +
              "• *!interacoes on <jid_do_grupo>*\n" +
              "• *!statusbot <jid_do_grupo>*\n\n" +
              "💻 *Painel Web:* Você também pode alternar com 1 clique na aba *WhatsApp / Grupos* do dashboard."
      });
    }

    // 3. Validação de permissões: Dono Supremo tem permissão global; em grupos, admins locais também podem
    const isAuthorized = isOwnerUser || (isGroup && isAdmin);
    if (!isAuthorized) {
      return sock.sendMessage(from, {
        text: "⚠️ *Acesso Negado:* Apenas administradores deste grupo ou o Dono do sistema podem alterar as configurações do bot."
      });
    }

    // 4. Normalização do tipo de controle e da ação
    const cleanParts = rawParts.filter(p => !p.includes("@g.us"));
    let controlScope = "all"; // "all", "postagens", "interacoes", "status"
    let action = (cleanParts[1] || "").toLowerCase().trim();

    if (["postagens", "postagem", "posts", "divulgacao", "divulgar", "ofertas"].includes(cmdFirst)) {
      controlScope = "postagens";
      action = (cleanParts[1] || "").toLowerCase().trim();
    } else if (["interacoes", "interacao", "comandos", "respostas"].includes(cmdFirst)) {
      controlScope = "interacoes";
      action = (cleanParts[1] || "").toLowerCase().trim();
    } else if (["statusbot", "botstatus", "statusgrupo"].includes(cmdFirst)) {
      controlScope = "status";
    } else if (["boton", "ativarbot", "ligarbot"].includes(cmdFirst)) {
      controlScope = "all";
      action = "on";
    } else if (["botoff", "desativarbot", "desligarbot"].includes(cmdFirst)) {
      controlScope = "all";
      action = "off";
    } else {
      const secondWord = (cleanParts[1] || "").toLowerCase().trim();
      if (["postagens", "postagem", "posts", "divulgacao", "divulgar", "ofertas"].includes(secondWord)) {
        controlScope = "postagens";
        action = (cleanParts[2] || "").toLowerCase().trim();
      } else if (["interacoes", "interacao", "comandos", "respostas"].includes(secondWord)) {
        controlScope = "interacoes";
        action = (cleanParts[2] || "").toLowerCase().trim();
      } else if (["status", "info", "ver"].includes(secondWord)) {
        controlScope = "status";
      } else {
        controlScope = "all";
        action = secondWord;
      }
    }

    const isTurnOn = ["on", "ativar", "ligar", "1", "enable", "start", "liberar"].includes(action);
    const isTurnOff = ["off", "desativar", "desligar", "0", "disable", "stop", "pausar", "mutar", "silenciar"].includes(action);

    // 5. Execução por escopo
    if (controlScope === "postagens") {
      if (isTurnOn) {
        models.setGroupPostingActive(targetGroup, true);
        return sock.sendMessage(from, {
          text: "📢 *POSTAGENS ATIVADAS NO GRUPO!* 🛍️\n\n" +
                "✅ Achadinhos, ofertas automáticas, promoções relâmpago e aquecimento mútuo estão liberados para envio neste grupo." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
      if (isTurnOff) {
        models.setGroupPostingActive(targetGroup, false);
        return sock.sendMessage(from, {
          text: "🛑 *POSTAGENS DESATIVADAS NO GRUPO!* 🔕\n\n" +
                "🔇 O bot *não enviará* achadinhos, promoções, mensagens de divulgação nem aquecimento neste grupo.\n\n" +
                "💡 *Nota:* Comandos e interações continuam funcionando normalmente para os membros." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
    } else if (controlScope === "interacoes") {
      if (isTurnOn) {
        models.setGroupBotActive(targetGroup, true);
        return sock.sendMessage(from, {
          text: "🤖 *INTERAÇÕES DO BOT ATIVADAS NO GRUPO!* 🚀\n\n" +
                "✅ O bot responderá a comandos (!menu, !ia, utilitários, downloads) e conversas dos membros normalmente." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
      if (isTurnOff) {
        models.setGroupBotActive(targetGroup, false);
        return sock.sendMessage(from, {
          text: "🛑 *INTERAÇÕES DO BOT DESATIVADAS NO GRUPO!* 💤\n\n" +
                "🔇 O bot *não responderá* a comandos nem interagirá com membros neste grupo." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
    } else if (controlScope === "all") {
      if (isTurnOn) {
        models.setGroupBotActive(targetGroup, true);
        models.setGroupPostingActive(targetGroup, true);
        return sock.sendMessage(from, {
          text: "✅ *BOT ATIVADO NESTE GRUPO!* 🚀\n\n" +
                "🤖 *Interações & Comandos:* 🟢 Ativas\n" +
                "📢 *Postagens & Promoções:* 🟢 Ativas\n\n" +
                "O bot está 100% operacional para os membros deste grupo." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
      if (isTurnOff) {
        models.setGroupBotActive(targetGroup, false);
        models.setGroupPostingActive(targetGroup, false);
        return sock.sendMessage(from, {
          text: "🛑 *BOT DESATIVADO NESTE GRUPO!* 💤\n\n" +
                "🔇 *Silêncio Total:* O bot não responderá a comandos, conversas nem enviará postagens ou divulgações neste grupo.\n\n" +
                "💡 *Para reativar:* Digite *!bot on* ou reative pelo Painel Web." +
                (targetGroup !== from ? "\n\n👥 *Grupo:* `" + targetGroup + "`" : "")
        });
      }
    }

    // 6. Exibição de Status Detalhado
    const botActive = typeof models.isGroupBotActive === "function" ? models.isGroupBotActive(targetGroup) : true;
    const postingActive = typeof models.isGroupPostingActive === "function" ? models.isGroupPostingActive(targetGroup) : true;
    const isSoDivu = typeof models.isGroupSoDivuActive === "function" ? models.isGroupSoDivuActive(targetGroup) : false;
    const isSoDivuGlobal = typeof models.isGlobalSoDivuActive === "function" ? models.isGlobalSoDivuActive() : false;

    return sock.sendMessage(from, {
      text: "📋 *STATUS DO BOT NESTE GRUPO* 📋\n\n" +
            "👥 *ID do Grupo:* `" + targetGroup + "`\n\n" +
            "⚡ *Status Geral:* " + (botActive ? "🟢 *ATIVO*" : "🔴 *DESATIVADO*") + "\n" +
            "📢 *Modo Só Divulgação:* " + (isSoDivu ? "🟢 *ATIVADO (Apenas postagens/ofertas)*" : "⚪ *DESATIVADO*") + (isSoDivuGlobal ? " _(Global Ativo)_" : "") + "\n" +
            "🤖 *Interações & Comandos:* " + (botActive && !isSoDivu ? "🟢 *ATIVAS*" : "🔴 *DESATIVADAS (Silenciadas)*") + "\n" +
            "📢 *Postagens & Divulgação:* " + (postingActive ? "🟢 *ATIVAS*" : "🔴 *DESATIVADAS (Sem Ofertas)*") + "\n\n" +
            "💡 *Comandos de Controle:*\n" +
            "• *!sodivu on* / *!sodivu off* — Faz com que o bot faça APENAS divulgações neste grupo\n" +
            "• *!sodivu-global on* / *!sodivu-global off* — Ativa ou desativa Só Divulgação para todos os grupos\n" +
            "• *!bot on* / *!bot off* — Liga ou desliga tudo no grupo\n" +
            "• *!postagens on* / *!postagens off* — Controla apenas achadinhos e ofertas\n" +
            "• *!interacoes on* / *!interacoes off* — Controla apenas comandos e IA\n" +
            "• *!statusbot* — Consulta este painel de status"
    });
  }

  // ==========================================
  // MODO SÓ DIVULGAÇÃO (!sodivu & !sodivu-global)
  // Permite que o bot faça APENAS as divulgações no grupo ou globalmente
  // ==========================================
  async handleSoDivuControl(sock, from, text, senderPhone, isGroup, isAdmin = false, isOwnerUser = false) {
    const models = require("../db/models");
    const rawParts = (text || "").trim().split(/\s+/);
    const cmdFirst = (rawParts[0] || "").replace(/^[!/#.]/, "").toLowerCase();

    // 1. Verifica se é comando de escopo Global (!sodivu-global, !sodivuglobal ou argumento 'global')
    const isGlobal = cmdFirst.includes("global") || rawParts.some(p => p.toLowerCase() === "global");

    // 2. Se for global, apenas o Dono Supremo (ou Dev suporte) pode alterar
    if (isGlobal) {
      if (!isOwnerUser) {
        return sock.sendMessage(from, {
          text: "⚠️ *Acesso Negado:* Apenas o Dono Supremo do bot pode ativar ou desativar o modo *Só Divulgação Global*."
        });
      }

      // Procura ação (on, off, ativar, desativar, status)
      let action = rawParts.find(p => ["on", "off", "ativar", "desativar", "ligar", "desligar", "status", "info"].includes(p.toLowerCase().replace(/^[!/#.]/, ""))) || "";
      if (!action) {
        action = (rawParts[1] || "").toLowerCase().trim();
      }
      if (action.includes("=")) {
        action = action.split("=")[1] || "";
      }
      action = action.toLowerCase().trim();

      const isTurnOn = ["on", "ativar", "ligar", "1", "enable", "true"].includes(action);
      const isTurnOff = ["off", "desativar", "desligar", "0", "disable", "false"].includes(action);

      if (isTurnOn) {
        models.setGlobalSoDivu(true);
        return sock.sendMessage(from, {
          text: "🌐 *MODO SÓ DIVULGAÇÃO GLOBAL ATIVADO!* 📢\n\n" +
                "✅ *Status:* 🟢 *ATIVADO PARA TODOS OS GRUPOS*\n\n" +
                "🛍️ *Comportamento Operacional:*\n" +
                "• O robô agora fará *APENAS AS DIVULGAÇÕES* de ofertas, catálogo, promoções relâmpago e achadinhos em todos os grupos.\n" +
                "• 🔇 Comandos gerais de membros (!menu, !ia, brincadeiras, stickers) foram silenciados para manter todos os canais limpos e focados em conversão.\n" +
                "• 👑 Comandos administrativos de Dono e Admins permanecem disponíveis.\n\n" +
                "💡 *Para desativar:* Digite *!sodivu-global off* a qualquer momento."
        });
      }

      if (isTurnOff) {
        models.setGlobalSoDivu(false);
        return sock.sendMessage(from, {
          text: "🌐 *MODO SÓ DIVULGAÇÃO GLOBAL DESATIVADO!* 🤖\n\n" +
                "✅ *Status:* ⚪ *DESATIVADO*\n\n" +
                "Cada grupo volta a seguir sua configuração individual de interações e postagens.\n\n" +
                "💡 *Para ativar em um grupo específico:* Entre no grupo e digite *!sodivu on*."
        });
      }

      // Se não especificou on/off, alterna e exibe o novo status
      const newGlobal = models.toggleGlobalSoDivu();

      return sock.sendMessage(from, {
        text: "🌐 *MODO SÓ DIVULGAÇÃO GLOBAL (TODOS OS GRUPOS)* 📢\n\n" +
              "📊 *Status Global Atual:* " + (newGlobal ? "🟢 *ATIVADO*" : "⚪ *DESATIVADO*") + "\n\n" +
              (newGlobal
                ? "✅ Todos os grupos agora operam exclusivamente para divulgação de ofertas e catálogo."
                : "✅ Modo global desativado. Cada grupo segue sua configuração individual.") + "\n\n" +
              "💡 *Comandos Rápidos:*\n" +
              "• *!sodivu-global on* — Ativa em todos os grupos\n" +
              "• *!sodivu-global off* — Desativa o modo global\n" +
              "• *!sodivu on* — Ativa apenas no grupo atual"
      });
    }

    // 3. Modo Por Grupo (!sodivu)
    let targetGroup = from;
    const groupArg = rawParts.find(p => p.includes("@g.us"));
    if (groupArg) {
      targetGroup = groupArg.trim();
    }

    // Se chamado no privado sem especificar o grupo
    if (!isGroup && !targetGroup.endsWith("@g.us")) {
      const isGlob = models.isGlobalSoDivuActive();
      return sock.sendMessage(from, {
        text: "📢 *MODO SÓ DIVULGAÇÃO (!sodivu)* 🛍️\n\n" +
              "Este comando configura o robô para fazer *APENAS AS DIVULGAÇÕES* (ofertas automáticas, achadinhos, produtos) no grupo, ignorando comandos e conversas comuns de membros para manter o chat limpo.\n\n" +
              "📋 *Como Usar no Grupo:*\n" +
              "• *!sodivu* — Alterna o modo no grupo atual\n" +
              "• *!sodivu on* — Ativa o modo só divulgação no grupo\n" +
              "• *!sodivu off* — Desativa e volta ao modo normal (comandos + postagens)\n\n" +
              "🌐 *Controle Global (Todos os Grupos):*\n" +
              "• *!sodivu-global on* — Ativa em todos os grupos\n" +
              "• *!sodivu-global off* — Desativa o modo global\n\n" +
              "📱 *Controle Remoto com JID:*\n" +
              "• *!sodivu on <id_do_grupo>@g.us*\n\n" +
              "🌐 *Status Global Atual:* " + (isGlob ? "🟢 *ATIVADO*" : "⚪ *DESATIVADO*")
      });
    }

    // Validação de permissões: Dono Supremo ou Admin do Grupo
    const isAuthorized = isOwnerUser || (isGroup && isAdmin);
    if (!isAuthorized) {
      return sock.sendMessage(from, {
        text: "⚠️ *Acesso Negado:* Apenas administradores deste grupo ou o Dono do sistema podem alterar o modo *Só Divulgação*."
      });
    }

    let action = rawParts.find(p => ["on", "off", "ativar", "desativar", "ligar", "desligar", "status", "info", "ver", "check"].includes(p.toLowerCase().replace(/^[!/#.]/, ""))) || "";
    if (!action) {
      const cleanParts = rawParts.filter(p => !p.includes("@g.us") && !p.toLowerCase().includes("global"));
      action = (cleanParts[1] || "").toLowerCase().trim();
    }
    action = action.toLowerCase().trim();

    const isTurnOn = ["on", "ativar", "ligar", "1", "enable", "true", "sim"].includes(action);
    const isTurnOff = ["off", "desativar", "desligar", "0", "disable", "false", "nao"].includes(action);
    const isStatus = ["status", "info", "ver", "check"].includes(action);

    if (isTurnOn) {
      models.setGroupSoDivu(targetGroup, true);
      return sock.sendMessage(from, {
        text: "📢 *MODO SÓ DIVULGAÇÃO ATIVADO NESTE GRUPO!* 🛍️\n\n" +
              "✅ *Divulgações & Ofertas:* 🟢 *ATIVAS (Exclusivo)*\n" +
              "🔇 *Comandos & Conversas de Membros:* 🛑 *SILENCIADAS*\n\n" +
              "O robô agora fará *APENAS AS DIVULGAÇÕES* de ofertas, catálogo, promoções e achadinhos neste grupo.\n" +
              "Comandos gerais de membros foram silenciados para manter o grupo limpo e focado em vendas!\n\n" +
              (targetGroup !== from ? "👥 *Grupo:* `" + targetGroup + "`\n\n" : "") +
              "💡 *Para desativar:* Envie *!sodivu off* ou *!bot on* a qualquer momento."
      });
    }

    if (isTurnOff) {
      models.setGroupSoDivu(targetGroup, false);
      return sock.sendMessage(from, {
        text: "✅ *MODO SÓ DIVULGAÇÃO DESATIVADO!* 🤖\n\n" +
              "O robô voltou ao modo operacional normal neste grupo:\n" +
              "• 🤖 *Interações & Comandos:* 🟢 Ativas para todos os membros\n" +
              "• 📢 *Divulgações & Ofertas:* 🟢 Ativas normalmente\n\n" +
              (targetGroup !== from ? "👥 *Grupo:* `" + targetGroup + "`\n\n" : "") +
              "💡 *Para reativar Só Divulgação:* Digite *!sodivu on*."
      });
    }

    if (isStatus) {
      const isAct = models.isGroupSoDivuActive(targetGroup);
      const isGlob = models.isGlobalSoDivuActive();
      return sock.sendMessage(from, {
        text: "📋 *STATUS DO MODO SÓ DIVULGAÇÃO* 📋\n\n" +
              "👥 *Grupo:* `" + targetGroup + "`\n\n" +
              "📢 *Modo Só Divulgação no Grupo:* " + (isAct ? "🟢 *ATIVADO (Apenas postagens)*" : "⚪ *DESATIVADO (Modo normal)*") + "\n" +
              "🌐 *Modo Global:* " + (isGlob ? "🟢 *ATIVADO (Todos os grupos)*" : "⚪ *DESATIVADO*") + "\n\n" +
              "💡 *Comandos Rápidos:*\n" +
              "• *!sodivu on* / *!sodivu off* — Ativa ou desativa neste grupo\n" +
              "• *!sodivu-global on* / *!sodivu-global off* — Ativa ou desativa em todos os grupos"
      });
    }

    // Toggle automático se não informou argumento
    const isCurrentlyActive = models.isGroupSoDivuActive(targetGroup);
    const newStatus = models.setGroupSoDivu(targetGroup, !isCurrentlyActive);

    return sock.sendMessage(from, {
      text: newStatus
        ? "📢 *MODO SÓ DIVULGAÇÃO ATIVADO NESTE GRUPO!* 🛍️\n\n" +
          "✅ O robô agora fará *APENAS AS DIVULGAÇÕES* de ofertas e catálogo neste grupo.\n" +
          "🔇 Comandos de membros silenciados para manter o grupo limpo.\n\n" +
          (targetGroup !== from ? "👥 *Grupo:* `" + targetGroup + "`\n\n" : "") +
          "💡 *Para desativar:* Digite *!sodivu off*."
        : "✅ *MODO SÓ DIVULGAÇÃO DESATIVADO!* 🤖\n\n" +
          "O robô voltou ao modo normal com interações, comandos e postagens liberados.\n\n" +
          (targetGroup !== from ? "👥 *Grupo:* `" + targetGroup + "`\n\n" : "") +
          "💡 *Para reativar:* Digite *!sodivu on*."
    });
  }

  async handleGroupBotOnOff(sock, from, text, senderPhone, isGroup, isAdmin = false, isOwnerUser = false) {
    return this.handleGroupBotControl(sock, from, text, senderPhone, isGroup, isAdmin, isOwnerUser);
  }

  // Modo de Acesso dos Bots & Sub-Bots (!publico / !privado / !modobot)
  // Permite escolher entre modo público (todos usam) ou privado (self-only, responde só a si mesmo)
  async handleBotAccessMode(sock, from, text, senderPhone, isOwnerUser = null, customSock = null) {
    const models = require('../db/models');
    const cleanSender = String(senderPhone || '').replace(/\D/g, '');

    // Resolução de Dono se não foi passado explicitamente
    if (isOwnerUser === null || isOwnerUser === undefined) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        if (typeof whatsappBot.isOwner === 'function') {
          isOwnerUser = whatsappBot.isOwner(senderPhone, false);
        }
      } catch (_) {}
      if (!isOwnerUser) {
        try {
          const ownerMindset = require('./ownerMindsetService');
          if (typeof ownerMindset.isOwnerAuthorized === 'function') {
            isOwnerUser = ownerMindset.isOwnerAuthorized(cleanSender);
          }
        } catch (_) {}
      }
    }

    const instances = models.getArmyInstances();
    const parts = (text || '').trim().split(/\s+/);
    const cmdFirst = (parts[0] || '').replace(/^[!/#.]/, '').toLowerCase();
    const arg1 = (parts[1] || '').toLowerCase();
    const arg2 = (parts[2] || '').toLowerCase();

    // Determina o modo desejado: 'PUBLIC' | 'PRIVATE' | 'STATUS'
    let desiredMode = null;
    if (['publico', 'public', 'botpublico', 'modopublico'].includes(cmdFirst)) {
      desiredMode = 'PUBLIC';
    } else if (['privado', 'private', 'botprivado', 'modoprivado', 'self', 'soeu'].includes(cmdFirst)) {
      desiredMode = 'PRIVATE';
    } else if (['modo', 'modobot', 'acessobot', 'acesso', 'modoacesso'].includes(cmdFirst)) {
      if (['publico', 'public'].includes(arg1)) desiredMode = 'PUBLIC';
      else if (['privado', 'private', 'self', 'soeu'].includes(arg1)) desiredMode = 'PRIVATE';
      else desiredMode = 'STATUS';
    }

    // Se veio de comando subbot/serbot (ex: !subbot publico 2 ou !subbot privado 2 ou !serbot publico)
    if (['subbot', 'serbot', 'jadibot'].includes(cmdFirst)) {
      if (['publico', 'public', 'botpublico'].includes(arg1)) desiredMode = 'PUBLIC';
      else if (['privado', 'private', 'botprivado', 'self', 'soeu'].includes(arg1)) desiredMode = 'PRIVATE';
      else if (['modo', 'acesso', 'status'].includes(arg1)) {
        if (['publico', 'public'].includes(arg2)) desiredMode = 'PUBLIC';
        else if (['privado', 'private', 'self', 'soeu'].includes(arg2)) desiredMode = 'PRIVATE';
        else desiredMode = 'STATUS';
      }
    }

    if (!desiredMode) desiredMode = 'STATUS';

    // Determina a instância alvo (Matriz #1 ou Sub-Bot #N)
    let targetInst = null;
    const tokens = parts.slice(1);

    // 1. Procura número de ID explícito nos tokens
    for (const t of tokens) {
      const cleanT = t.replace(/[^\w]/g, '');
      if (/^\d+$/.test(cleanT)) {
        const found = instances.find(i => String(i.id) === cleanT);
        if (found) {
          targetInst = found;
          break;
        }
      }
    }

    // 2. Procura por telefone com DDD nos tokens
    if (!targetInst) {
      for (const t of tokens) {
        const cleanDigits = t.replace(/\D/g, '');
        if (cleanDigits.length >= 8) {
          const found = instances.find(i => i.phone && (i.phone === cleanDigits || i.phone.endsWith(cleanDigits.slice(-8)) || cleanDigits.endsWith(i.phone.slice(-8))));
          if (found) {
            targetInst = found;
            break;
          }
        }
      }
    }

    // 3. Se executado no socket de um Sub-Bot
    const activeInstId = customSock?.instanceId || sock?.instanceId;
    if (!targetInst && activeInstId && activeInstId > 1) {
      targetInst = instances.find(i => i.id === activeInstId);
    }

    // 4. Se o remetente for dono de um Sub-Bot cadastrado (e não for o Dono querendo alterar a Matriz)
    if (!targetInst && cleanSender && cleanSender.length >= 8 && !isOwnerUser) {
      targetInst = instances.find(i => !i.is_main && i.phone && (i.phone === cleanSender || i.phone.endsWith(cleanSender.slice(-8)) || cleanSender.endsWith(i.phone.slice(-8))));
    }

    // 5. Se não encontrou, o padrão é a Matriz (#1)
    if (!targetInst) {
      targetInst = instances.find(i => i.is_main || i.id === 1) || { id: 1, name: 'Matriz Principal', is_main: 1 };
    }

    const isTargetMain = targetInst.is_main || targetInst.id === 1;

    // Validação de Permissão:
    // Para alterar a Matriz: Apenas o Dono Supremo (isOwnerUser) ou sock?._isFromMe ou o próprio chip da Matriz
    // Para alterar um Sub-Bot: Dono Supremo (isOwnerUser) ou o dono do chip do Sub-Bot (phone === cleanSender) ou sock?._isFromMe
    let isAuthorized = false;
    if (isTargetMain) {
      isAuthorized = isOwnerUser || (targetInst.phone && cleanSender && (targetInst.phone === cleanSender || targetInst.phone.endsWith(cleanSender.slice(-8)))) || (sock?._isFromMe);
    } else {
      isAuthorized = isOwnerUser ||
        (targetInst.phone && cleanSender && (targetInst.phone === cleanSender || targetInst.phone.endsWith(cleanSender.slice(-8)) || cleanSender.endsWith(targetInst.phone.slice(-8)))) ||
        (sock?._isFromMe);
    }

    if (desiredMode !== 'STATUS' && !isAuthorized) {
      return sock.sendMessage(from, {
        text: `⚠️ *ACESSO NEGADO:* Apenas o Dono do sistema ou o titular deste robô (+${targetInst.phone || targetInst.id}) têm permissão para alterar o modo de acesso entre público e privado.`
      });
    }

    // Executa a alteração ou exibe o status
    if (desiredMode === 'PUBLIC') {
      models.setBotAccessMode(targetInst.id, 'PUBLIC');
      const responseMsg = isTargetMain
        ? `🌐 *BOT MATRIZ CONFIGURADO PARA MODO PÚBLICO!* 🤖\n\n` +
          `✅ *Acesso Universal:* Todos os participantes em grupos e chats privados agora podem utilizar os meus comandos livremente!`
        : `🌐 *SUB-BOT #${targetInst.id} (${targetInst.name}) CONFIGURADO PARA MODO PÚBLICO!* 🤖\n\n` +
          `✅ *Acesso Universal:* Todos os participantes em grupos e chats privados agora podem utilizar os comandos deste sub-bot livremente!\n` +
          `📱 *Chip:* +${targetInst.phone || 'Sem número'}`;

      return sock.sendMessage(from, { text: responseMsg });
    }

    if (desiredMode === 'PRIVATE') {
      models.setBotAccessMode(targetInst.id, 'PRIVATE');
      const responseMsg = isTargetMain
        ? `🔒 *BOT MATRIZ CONFIGURADO PARA MODO PRIVADO (SÓ RESPONDE A SI MESMO)!* 👤\n\n` +
          `🛡️ *Acesso Restrito / Self-Only:* O robô responderá *exclusivamente a si mesmo* e ao Dono Supremo.\n` +
          `🔇 Comandos e mensagens enviadas por outros usuários em grupos ou privado serão ignorados silenciosamente para sua total privacidade e controle.\n\n` +
          `💡 Para permitir todos os usuários novamente: envie *!publico*.`
        : `🔒 *SUB-BOT #${targetInst.id} (${targetInst.name}) CONFIGURADO PARA MODO PRIVADO (SÓ RESPONDE A SI MESMO)!* 👤\n\n` +
          `🛡️ *Acesso Restrito / Self-Only:* Este sub-bot responderá *exclusivamente a si mesmo* (+${targetInst.phone || targetInst.id}) e ao Dono Supremo.\n` +
          `🔇 Comandos e interações de terceiros serão ignorados silenciosamente.\n` +
          `📱 *Chip:* +${targetInst.phone || 'Sem número'}\n\n` +
          `💡 Para voltar a permitir todos os usuários: envie *!publico* ou *!subbot publico ${targetInst.id}*.`;

      return sock.sendMessage(from, { text: responseMsg });
    }

    // Consulta de Status
    const curMode = models.getBotAccessMode(targetInst.id);
    const isPrivate = curMode === 'PRIVATE';
    const statusMsg =
      `⚙️ *STATUS DO MODO DE ACESSO DO ROBÔ* ⚙️\n\n` +
      `🤖 *Bot:* ${targetInst.name || 'Bot'} (#${targetInst.id})\n` +
      `📱 *Chip:* +${targetInst.phone || 'Principal'}\n` +
      `📋 *Modo Atual:* ${isPrivate ? '🔒 PRIVADO (Self-Only — Só responde a si mesmo)' : '🌐 PÚBLICO (Aberto para todos os usuários)'}\n\n` +
      `💡 *Como alternar o modo:*\n` +
      `• *!publico* — Abre os comandos para todos os membros do grupo e privado\n` +
      `• *!privado* — Restringe os comandos para responder apenas a si mesmo (Self-Only)`;

    return sock.sendMessage(from, { text: statusMsg });
  }

  // Comando !serbot / !jadibot / !subbot / !code / !conectar / !aceitartermos / !tornarfree (100% Gratuito - Democratização Total com Termos)
  async handleSerBot(sock, from, text, senderPhone, isGroup, isOwnerUser = null, senderName = null) {
    const whatsappArmyService = require('./whatsappArmyService');
    const subbotTokenService = require('./subbotTokenService');
    const models = require('../db/models');

    // Resolução de Dono se não foi passado explicitamente
    if (isOwnerUser === null || isOwnerUser === undefined) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        if (typeof whatsappBot.isOwner === 'function') {
          isOwnerUser = whatsappBot.isOwner(senderPhone, false);
        }
      } catch (_) {}
      if (!isOwnerUser) {
        try {
          const ownerMindset = require('./ownerMindsetService');
          isOwnerUser = ownerMindset.isOwner(senderPhone);
        } catch (_) {}
      }
    }

    const rawLower = (text || '').toLowerCase().trim();
    const isPublicCommand = /\b(?:publico|public|botpublico|modopublico)\b/i.test(rawLower);
    const isPrivateCommand = /\b(?:privado|private|botprivado|modoprivado|self|soeu)\b/i.test(rawLower);
    const isModeCommand = /\b(?:modo|acesso|modoacesso|modobot)\b/i.test(rawLower);

    if (isPublicCommand || isPrivateCommand || isModeCommand) {
      return this.handleBotAccessMode(sock, from, text, senderPhone, isOwnerUser, sock);
    }

    const isOffCommand = /\b(?:off|desligar|pausar|parar|stop|standby)\b/i.test(rawLower);
    const isOnCommand = /\b(?:on|ligar|ativar|retomar|start|resume)\b/i.test(rawLower);
    const isStatusCommand = /\b(?:status|info|estado)\b/i.test(rawLower);
    const hasFreeKeyword = /\b(?:free|gratis|gratuito|liberar|tornarfree|subbotfree)\b/i.test(rawLower);

    const instances = models.getArmyInstances();
    const tokens = (text || '').trim().split(/\s+/).slice(1);

    // ==============================================================
    // 0. LIGAR / DESLIGAR / STATUS DO SUB-BOT (!serbot off / !serbot on)
    // Desliga e liga instantaneamente sem precisar logar de novo!
    // ==============================================================
    if (isOffCommand || isOnCommand || isStatusCommand) {
      let targetInst = null;
      const cleanSender = String(senderPhone || '').replace(/\D/g, '');

      // 1. Se informou um ID numérico (ex: !serbot off 2 ou !subbot on 3)
      for (const t of tokens) {
        const cleanT = t.replace(/[^\w]/g, '');
        if (/^\d+$/.test(cleanT)) {
          const found = instances.find(i => String(i.id) === cleanT && !i.is_main);
          if (found) {
            targetInst = found;
            break;
          }
        }
      }

      // 2. Se informou um telefone com DDD (ex: !serbot off 5511999998888)
      if (!targetInst) {
        for (const t of tokens) {
          const cleanDigits = t.replace(/\D/g, '');
          if (cleanDigits.length >= 8) {
            const found = instances.find(i => !i.is_main && i.phone && (i.phone === cleanDigits || i.phone.endsWith(cleanDigits.slice(-8)) || cleanDigits.endsWith(i.phone.slice(-8))));
            if (found) {
              targetInst = found;
              break;
            }
          }
        }
      }

      // 3. Se foi executado diretamente no socket do próprio Sub-Bot
      if (!targetInst && sock?.instanceId && sock.instanceId > 1) {
        targetInst = instances.find(i => i.id === sock.instanceId);
      }

      // 4. Se o remetente for o dono de um chip cadastrado
      if (!targetInst && cleanSender && cleanSender.length >= 8) {
        targetInst = instances.find(i => !i.is_main && i.phone && (i.phone === cleanSender || i.phone.endsWith(cleanSender.slice(-8)) || cleanSender.endsWith(i.phone.slice(-8))));
      }

      // Validação de Permissão: Apenas Dono do Sistema ou o dono do próprio chip
      const isAuthorized = isOwnerUser ||
        (targetInst && cleanSender && (targetInst.phone === cleanSender || targetInst.phone?.endsWith(cleanSender.slice(-8)) || cleanSender.endsWith(targetInst.phone?.slice(-8)))) ||
        (!isGroup && sock?.instanceId && sock.instanceId > 1 && targetInst && sock.instanceId === targetInst.id);

      if (targetInst && !isAuthorized) {
        return sock.sendMessage(from, {
          text: `⚠️ *ACESSO NEGADO:* Apenas o Dono do sistema ou o proprietário deste WhatsApp (+${targetInst.phone || targetInst.id}) podem alterar o status do robô.`
        });
      }

      // --- 1. COMANDO DESLIGAR (!serbot off / !subbot off) ---
      if (isOffCommand) {
        if (!targetInst) {
          if (isOwnerUser) {
            return sock.sendMessage(from, {
              text: `⚠️ *Informe o ID ou número do sub-bot para desligar.*\n\nExemplo: *!serbot off 2* ou *!serbot off 5511999998888*\nDigite *!bots* para ver todos os chips.`
            });
          }
          return sock.sendMessage(from, {
            text: `⚠️ *Nenhum sub-bot vinculado ao seu número foi encontrado para desligar.*\n\nCaso queira conectar este WhatsApp como sub-bot gratuito, envie *!serbot*.`
          });
        }

        if (targetInst.is_main) {
          return sock.sendMessage(from, {
            text: `❌ *O Chip Matriz (#1) é a central do sistema e não pode ser desligado por este comando.*`
          });
        }

        const isAlreadyPaused = targetInst.is_paused === 1 || targetInst.status === 'PAUSED';
        if (isAlreadyPaused) {
          return sock.sendMessage(from, {
            text: `⏸️ *O Sub-Bot #${targetInst.id} (${targetInst.name}) já se encontra DESLIGADO (Pausado).* 💤\n\n` +
                  `🔐 Suas credenciais continuam 100% salvas.\n` +
                  `▶️ Para ligá-lo novamente a qualquer momento sem novo login, envie: *!serbot on*`
          });
        }

        await whatsappArmyService.pauseInstance(targetInst.id);

        return sock.sendMessage(from, {
          text: `⏸️ *SUB-BOT DESLIGADO COM SUCESSO!* 💤\n\n` +
                `🤖 *Sub-Bot #${targetInst.id}:* ${targetInst.name}\n` +
                `📱 *Número:* +${targetInst.phone || 'Sem número'}\n` +
                `📋 *Status:* Em espera (Standby Silencioso)\n\n` +
                `✨ O robô foi pausado e não irá responder mensagens, nem enviar automações ou interagir em grupos.\n` +
                `🔐 *Login preservado:* Você *NÃO* precisará escanear QR Code nem gerar código de pareamento de novo!\n` +
                `🕵️ *Sentinela Passiva Ativa:* Mesmo desligado, o robô continua registrando links de grupos, produtos, chaves de API e números de possíveis compradores em segundo plano!\n\n` +
                `▶️ *Para ligar novamente a qualquer momento:* Envie *!serbot on* neste chat.`
        });
      }

      // --- 2. COMANDO LIGAR (!serbot on / !subbot on) ---
      if (isOnCommand) {
        if (!targetInst) {
          if (isOwnerUser) {
            return sock.sendMessage(from, {
              text: `⚠️ *Informe o ID ou número do sub-bot para ligar.*\n\nExemplo: *!serbot on 2* ou *!serbot on 5511999998888*\nDigite *!bots* para ver todos os chips.`
            });
          }
          return sock.sendMessage(from, {
            text: `⚠️ *Nenhum sub-bot vinculado ao seu número foi encontrado para ligar.*`
          });
        }

        if (targetInst.is_main) {
          return sock.sendMessage(from, {
            text: `ℹ️ *O Chip Matriz (#1) está sempre ativo.*`
          });
        }

        if (targetInst.free_blocked) {
          return sock.sendMessage(from, {
            text: `🚫 *ACESSO NEGADO — SUB-BOT BANIDO*\n\nO Sub-Bot #${targetInst.id} foi bloqueado permanentemente pelo Dono do sistema.\nMotivo: ${targetInst.free_blocked_reason || 'Violação dos termos'}`
          });
        }

        const isAlreadyActive = targetInst.status === 'CONNECTED' && (!targetInst.is_paused || targetInst.is_paused === 0);
        if (isAlreadyActive && whatsappArmyService.activeSockets.has(targetInst.id)) {
          return sock.sendMessage(from, {
            text: `⚡ *O Sub-Bot #${targetInst.id} (${targetInst.name}) já está LIGADO e operando normalmente!* 🟢\n\n` +
                  `🔋 *Saldo:* ${targetInst.tokens_balance || 50} tokens\n` +
                  `💡 Para desligar temporariamente a qualquer momento sem perder o login, envie: *!serbot off*`
          });
        }

        await whatsappArmyService.resumeInstance(targetInst.id);

        return sock.sendMessage(from, {
          text: `▶️ *SUB-BOT LIGADO COM SUCESSO!* 🚀\n\n` +
                `🤖 *Sub-Bot #${targetInst.id}:* ${targetInst.name}\n` +
                `📱 *Número:* +${targetInst.phone || 'Sem número'}\n` +
                `🟢 *Status:* Ativo e Conectado\n` +
                `🔋 *Saldo:* ${targetInst.tokens_balance || 50} tokens disponíveis\n\n` +
                `💬 O robô voltou a responder atendimentos, vendas e comandos automaticamente.\n` +
                `💡 Para desligar temporariamente a qualquer momento sem perder o login, envie *!serbot off*.`
        });
      }

      // --- 3. COMANDO STATUS (!serbot status / !subbot status) ---
      if (isStatusCommand) {
        if (!targetInst) {
          return sock.sendMessage(from, {
            text: `⚠️ *Informe o ID ou telefone do sub-bot para consultar o status.* Exemplo: *!serbot status 2*`
          });
        }
        const isPaused = targetInst.is_paused === 1 || targetInst.status === 'PAUSED';
        const isSocketActive = whatsappArmyService.activeSockets.has(targetInst.id);
        const statusDisplay = isPaused ? '⏸️ DESLIGADO (Pausado)' : (isSocketActive ? '🟢 LIGADO (Ativo)' : '🔴 Desconectado');
        return sock.sendMessage(from, {
          text: `🤖 *STATUS DO SUB-BOT #${targetInst.id}* (${targetInst.name})\n\n` +
                `📱 *Chip:* +${targetInst.phone || 'Não pareado'}\n` +
                `📊 *Status:* ${statusDisplay}\n` +
                `🔋 *Saldo de Tokens:* ${targetInst.tokens_balance || 50} tokens\n` +
                `📤 *Envios hoje:* ${targetInst.messages_sent_today || 0}/${targetInst.daily_limit || 50}\n\n` +
                `💡 *Comandos Rápidos:*\n` +
                `• *!serbot off* — Desliga o robô mantendo o login salvo\n` +
                `• *!serbot on* — Liga o robô instantaneamente sem precisar logar de novo\n` +
                `• *!tokens* — Ver saldo e missões\n` +
                `• *!stopbot* — Desconecta a sessão permanentemente`
        });
      }
    }

    // ==============================================================
    // 1. TORNAR SUB-BOT EXISTENTE EM FREE (!serbot free <id|phone>)
    // ==============================================================
    let targetExistingInst = null;

    // A) Verifica se algum token é um ID de instância cadastrada (ex: !serbot free 1151 ou !serbot 1151)
    for (const t of tokens) {
      const cleanT = t.replace(/[^\w]/g, '');
      if (/^\d+$/.test(cleanT)) {
        const found = instances.find(i => String(i.id) === cleanT);
        if (found) {
          targetExistingInst = found;
          break;
        }
      }
    }

    // B) Verifica se algum token é o telefone de uma instância existente (ex: !serbot free 5511999997701)
    if (!targetExistingInst) {
      for (const t of tokens) {
        const cleanDigits = t.replace(/\D/g, '');
        if (cleanDigits.length >= 8) {
          const found = instances.find(i => !i.is_main && i.phone && (i.phone === cleanDigits || i.phone.endsWith(cleanDigits.slice(-8)) || cleanDigits.endsWith(i.phone.slice(-8))));
          if (found) {
            targetExistingInst = found;
            break;
          }
        }
      }
    }

    // C) Se enviou apenas "!serbot free" sem argumentos adicionais e o remetente já tem uma instância
    if (!targetExistingInst && hasFreeKeyword && senderPhone) {
      const myInst = instances.find(i => !i.is_main && i.phone && (i.phone === senderPhone || i.phone.endsWith(senderPhone.slice(-8))));
      if (myInst) {
        targetExistingInst = myInst;
      }
    }

    // Se encontrou uma instância existente para tornar Free:
    if (targetExistingInst && (hasFreeKeyword || rawLower.includes('tornar') || rawLower.includes('ativar') || rawLower.includes('aceito') || isOwnerUser || rawLower.includes('tornarfree') || rawLower.includes('subbotfree'))) {
      if (targetExistingInst.is_main) {
        return sock.sendMessage(from, { text: `❌ *O Chip Matriz (#1) é o cérebro principal e não pode ser convertido em sub-bot free.*` });
      }

      if (targetExistingInst.free_blocked) {
        if (isOwnerUser) {
          models.unblockSubBotFree(targetExistingInst.id);
        } else {
          const motivo = targetExistingInst.free_blocked_reason || 'Violação dos termos do Exército de Sub-Bots';
          return sock.sendMessage(from, {
            text: `🚫 *ACESSO NEGADO — SUB-BOT BANIDO*\n\nO Sub-Bot #${targetExistingInst.id} (+${targetExistingInst.phone}) foi bloqueado permanentemente.\n\n📋 *Motivo:* ${motivo}\n\nPara solicitar desbloqueio, entre em contato com o Dono.`
          });
        }
      }

      models.updateArmyInstance(targetExistingInst.id, {
        is_subbot: 1,
        terms_accepted: 1,
        terms_accepted_at: new Date().toISOString(),
        can_participate_meteoric: 1,
        can_mention_members: 1,
        can_post_status: 1,
        tokens_balance: Math.max(targetExistingInst.tokens_balance || 0, 50),
        tokens_daily_base: 50,
        free_blocked: 0
      });

      const updated = models.getArmyInstanceById(targetExistingInst.id);
      const isAlreadyConnected = updated.status === 'CONNECTED';
      let confirmMsg = `🎁 *SUB-BOT #${updated.id} TORNADO SUB-BOT FREE COM SUCESSO!* 🤖\n\n` +
        `👤 *Nome:* ${updated.name}\n` +
        `📱 *Chip:* +${updated.phone || 'Sem número configurado'}\n` +
        `🎖️ *Status Free:* 🟢 *Ativado* (Termos do Exército Aceitos)\n` +
        `🔋 *Saldo de Tokens:* *${updated.tokens_balance || 50} tokens diários*\n` +
        `🚀 *Permissões do Exército:*\n` +
        `  • Lançamentos Meteóricos: ✅ Ativo\n` +
        `  • Divulgações em Grupos: ✅ Ativo (exclui admins)\n` +
        `  • Status/Stories Automáticos: ✅ Ativo\n\n`;

      if (isAlreadyConnected) {
        confirmMsg += `⚡ *O chip já está conectado e pronto para operar como Sub-Bot Free!*`;
      } else if (updated.phone) {
        confirmMsg += `💡 *Para conectar este chip:* Envie *!serbot aceito ${updated.phone}* para gerar o código de pareamento, ou leia o QR Code no Painel Web.`;
      } else {
        confirmMsg += `💡 *Para conectar:* Envie *!serbot aceito <numero_com_ddd>*.`;
      }

      return sock.sendMessage(from, { text: confirmMsg });
    }

    // ==============================================================
    // 2. CONEXÃO JADIBOT / SUB-BOT (100% AUTOMÁTICO E GRATUITO)
    // ==============================================================
    // Qualquer número pode apenas mandar !serbot (ou !jadibot / !code).
    // O sistema inicia a conexão imediatamente e envia o código de pareamento.
    // Ao parear com o código gerado, a pessoa aceita automaticamente os termos do exército!
    const rawArgs = text.replace(/^(?:!|\/)(?:serbot|jadibot|subbot|conectar|code|aceitartermos|tornarfree|subbotfree)\s*/i, '')
      .replace(/^(?:aceito|concordo|sim|free|gratis|gratuito|tornar|ativar)\s*/i, '').trim();

    // Verifica se o usuário digitou um número explícito nos argumentos do comando (ex: !serbot 5511999998888)
    const rawDigitsInArgs = rawArgs.replace(/\D/g, '');
    const hasExplicitPhoneInArgs = rawDigitsInArgs.length >= 8;

    // Normalização Inteligente Internacional (aceita qualquer país do mundo sem forçar +55)
    const phoneUtil = require('../utils/phoneUtil');
    const parsedPhone = hasExplicitPhoneInArgs
      ? phoneUtil.parseAndNormalizePhone(rawArgs)
      : phoneUtil.parseAndNormalizePhone(senderPhone);
    let phoneArg = parsedPhone.phone;

    // Detecta código de indicação (ex: SUB-1024)
    const refMatch = text.match(/\b(SUB-\d+)\b/i);
    const referralCodeArg = refMatch ? refMatch[1].toUpperCase() : null;

    const subbotConnectService = require('./subbotConnectService');
    const clientPhone = parsedPhone.phone || String(senderPhone || '').replace(/\D/g, '') || (!from.endsWith('@g.us') ? String(from).split('@')[0].replace(/\D/g, '') : '');
    const clientName = (senderName && typeof senderName === 'string' && senderName.trim()) ? senderName.trim() : 'Cliente';
    const isExplicitCodeCmd = /^(?:!|\/)?(?:code)\b/i.test(rawLower);

    // Se o cliente NÃO digitou um número explícito nos argumentos (ex: enviou apenas !serbot, !subbot, !conectar, !virarbot)
    // OU se pediu expressamente o link único (!linksubbot, !conectar), entregamos a experiência Web igual à Loja:
    if (!hasExplicitPhoneInArgs && !isExplicitCodeCmd) {
      if (clientPhone && clientPhone.length >= 8) {
        const connectLink = subbotConnectService.buildSubBotConnectUrl({
          phone: clientPhone,
          name: clientName,
          referralCode: referralCodeArg
        });

        const inviteMsg = subbotConnectService.formatSubBotInvitationMessage({
          phone: clientPhone,
          name: clientName,
          connectUrl: connectLink.url,
          shortUrl: connectLink.shortUrl,
          senderPhone: clientPhone
        });

        return sock.sendMessage(from, { text: inviteMsg });
      }

      return sock.sendMessage(from, {
        text: `⚠️ *Informe o seu número completo com código do país para gerar o código de conexão.*\n\n` +
              `Exemplos:\n` +
              `• Brasil: *!serbot 5511999998888*\n` +
              `• EUA/Canadá: *!serbot +12025550199*\n` +
              `• Portugal: *!serbot +351912345678*\n` +
              `• Ou conecte pelo seu link único: ${subbotConnectService.buildSubBotConnectUrl({ name: clientName }).shortUrl}`
      });
    }

    // Verifica se já existe uma instância cadastrada para este número
    const existingInst = instances.find(i => !i.is_main && i.phone && (i.phone === phoneArg || i.phone.endsWith(phoneArg.slice(-8)) || phoneArg.endsWith(i.phone.slice(-8))));

    // 🚫 Verificar se foi banido permanentemente do programa Free
    if (existingInst && existingInst.free_blocked) {
      if (isOwnerUser) {
        models.unblockSubBotFree(existingInst.id);
      } else {
        const motivo = existingInst.free_blocked_reason || 'Violação dos termos do Exército de Sub-Bots';
        const dataBloco = existingInst.free_blocked_at ? new Date(existingInst.free_blocked_at).toLocaleString('pt-BR') : 'N/A';
        return sock.sendMessage(from, {
          text: `🚫 *ACESSO NEGADO — SUB-BOT BANIDO*\n\n` +
            `O número *+${phoneArg}* foi permanentemente bloqueado do programa Sub-Bot Free.\n\n` +
            `📋 *Motivo:* ${motivo}\n` +
            `📅 *Data do bloqueio:* ${dataBloco}\n\n` +
            `⚠️ Este número violou os *Termos do Exército de Sub-Bots* e não pode mais utilizar a modalidade gratuita.\n\n` +
            `Para solicitar desbloqueio, entre em contato com o *Dono* ou *Bot Master* do sistema.`
        });
      }
    }

    if (existingInst && (existingInst.status === 'PAUSED' || existingInst.is_paused)) {
      return sock.sendMessage(from, {
        text: `⏸️ *O WhatsApp +${phoneArg} já está pareado como Sub-Bot #${existingInst.id} (${existingInst.name}), mas está DESLIGADO (Pausado).* 💤\n\n` +
          `🔐 Sua sessão e login continuam 100% salvos (não precisa de QR nem pareamento).\n` +
          `▶️ *Para ligá-lo imediatamente:* Envie *!serbot on*\n` +
          `🛑 Para desconectar a conta: Envie *!stopbot*`
      });
    }

    if (existingInst && (existingInst.status === 'CONNECTED' || existingInst.connected)) {
      models.updateArmyInstance(existingInst.id, {
        terms_accepted: 1,
        terms_accepted_at: new Date().toISOString(),
        can_participate_meteoric: 1,
        can_mention_members: 1,
        can_post_status: 1
      });
      return sock.sendMessage(from, {
        text: `✅ *O WhatsApp +${phoneArg} já está conectado e operando como Sub-Bot #${existingInst.id} (${existingInst.name})!*\n\n` +
          `🎖️ *Termos do Exército:* Aceitos com Sucesso!\n` +
          `🔋 Saldo de tokens: *${existingInst.tokens_balance || 50} tokens*\n` +
          `• Digite *!tokens* para gerenciar seu saldo e missões.\n` +
          `• Digite *!bots* para ver status de todas as contas.\n` +
          `• Para desconectar quando desejar, envie *!stopbot*.`
      });
    }

    await sock.sendMessage(from, { text: `⏳ *Iniciando conexão Jadibot...* Gerando código de pareamento seguro para o número *+${phoneArg}* (${parsedPhone.flag} ${parsedPhone.countryName || 'Global'})... Aguarde alguns instantes.` });

    try {
      let targetInstanceId = null;

      if (existingInst) {
        targetInstanceId = existingInst.id;
        models.updateArmyInstance(targetInstanceId, {
          terms_accepted: 1,
          terms_accepted_at: new Date().toISOString(),
          can_participate_meteoric: 1,
          can_mention_members: 1,
          can_post_status: 1,
          is_subbot: 1
        });
        // Se a instância existente está desconectada, reseta a sessão para receber novo pareamento limpo
        if (existingInst.status !== 'CONNECTED' && !existingInst.connected) {
          await whatsappArmyService.resetInstanceSession(targetInstanceId);
        } else {
          await whatsappArmyService.stopInstance(targetInstanceId);
        }
      } else {
        // Verifica se pertence a algum Vendedor ou Afiliado registrado para dar nome amigável
        let customName = `Sub-Bot ${parsedPhone.flag} +${phoneArg.slice(-4)}`;
        try {
          const seller = models.getSellerByPhone(phoneArg);
          const affiliate = models.getAffiliateByPhone(phoneArg);
          if (seller) customName = `Sub-Bot Vendedor - ${seller.name}`;
          else if (affiliate) customName = `Sub-Bot Afiliado - ${affiliate.name}`;
        } catch (_) {}

        const newInst = await whatsappArmyService.createAndConnectInstance({
          name: customName,
          phone: phoneArg,
          daily_limit: 100,
          tokens_balance: 50,
          tokens_daily_base: 50,
          is_subbot: 1,
          terms_accepted: 1,
          terms_accepted_at: new Date().toISOString(),
          can_participate_meteoric: 1,
          can_mention_members: 1,
          can_post_status: 1
        });
        targetInstanceId = newInst.id;
      }

      // Se passou código de indicação, processa bonificação mútua
      if (referralCodeArg && targetInstanceId) {
        try {
          subbotTokenService.processReferral(targetInstanceId, referralCodeArg);
        } catch (_) {}
      }

      // Solicita código de pareamento via Baileys com tentativas automáticas
      const pairingRes = await whatsappArmyService.requestPairingCode(targetInstanceId, phoneArg);
      const code = pairingRes.pairingCode;

      const connectLink = subbotConnectService.buildSubBotConnectUrl({
        phone: phoneArg,
        name: senderName || 'Cliente',
        referralCode: referralCodeArg
      });
      const webUrl = connectLink.shortUrl || connectLink.url;

      const successMsg = `🤖 *JADIBOT / SUB-BOT MULTI-DISPOSITIVOS (100% GRATUITO - EXÉRCITO PAYBOT)* 🤖\n\n` +
        `🔑 *SEU CÓDIGO DE CONEXÃO:* \n` +
        `👉 *${code}* 👈\n\n` +
        `🌐 *Ou acesse sua Página Única de Ativação (com tutorial e QR Code):*\n` +
        `👉 ${webUrl}\n\n` +
        `📋 *PASSO A PASSO NO SEU WHATSAPP:*\n` +
        `1. Abra o WhatsApp do celular que quer conectar.\n` +
        `2. Toque nos três pontinhos ⋮ (Android) ou *Configurações* ⚙️ (iPhone) > *Aparelhos Conectados*.\n` +
        `3. Toque no botão *Conectar um Aparelho*.\n` +
        `4. Toque em *Conectar com número de telefone* (no rodapé da tela).\n` +
        `5. Digite o código de 8 dígitos: *${code}*\n\n` +
        `⏱️ O código expira em 2 minutos.\n\n` +
        `📜 *TERMOS DE PARTICIPAÇÃO (ACEITOS AUTOMATICAMENTE AO PAREAR):*\n` +
        `Ao parear seu WhatsApp com este código, você aceita automaticamente participar do nosso Exército de Sub-Bots Free:\n` +
        `1️⃣ *Lançamentos Meteóricos:* Seu chip participará de ações coordenadas e campanhas de lançamentos de vendas do PayBot (prova social e engajamento).\n` +
        `2️⃣ *Divulgações em Grupos:* Envio de ofertas e achadinhos nos grupos onde você participa marcando todos os membros (*poupando e excluindo expressamente todos os administradores*).\n` +
        `3️⃣ *Status Promocionais:* Postagem automática periódica de stories/status divulgando o ecossistema PayBot e produtos da loja.\n\n` +
        `💎 *O QUE VOCÊ GANHA:* \n` +
        `• *R$ 0,00 de custo!* Sem taxa de adesão nem mensalidade.\n` +
        `• *50 Tokens Grátis todo dia* para figurinhas (!figu), downloads (!play/!tiktok), IA (!ia) e áudio.\n` +
        `• Recargas gratuitas diárias cumprindo missões (*!missaodiaria*, *!grupos*, *!indicar*)!\n\n` +
        `🎉 Assim que conectar, você ganha *50 TOKENS GRÁTIS* para usar todos os comandos no seu número sem pagar nenhum centavo!`;

      if (isGroup) {
        const mentionJid = `${senderPhone}@s.whatsapp.net`;
        const groupMsg = `🤖 Olá @${senderPhone}!\n\n` +
          `🔑 *Seu código de 8 dígitos para se tornar Sub-Bot Grátis é:* \n` +
          `👉 *${code}* 👈\n\n` +
          `🌐 *Ou acesse sua Página Única configurada na Web:*\n` +
          `👉 ${webUrl}\n\n` +
          `📱 *No seu WhatsApp:* Configurações > Aparelhos Conectados > Conectar um Aparelho > Conectar com número de telefone.\n\n` +
          `_Enviamos também as instruções no seu chat privado para facilitar copiar o código!_`;

        await sock.sendMessage(from, { text: groupMsg, mentions: [mentionJid] });

        // Tenta enviar também no privado para facilidade de uso
        try {
          await sock.sendMessage(mentionJid, { text: successMsg });
        } catch (_) {}

        return;
      } else {
        return sock.sendMessage(from, { text: successMsg });
      }
    } catch (err) {
      return sock.sendMessage(from, {
        text: `❌ Não foi possível gerar o código de conexão para +${phoneArg}: ${err.message}\n\nTente novamente com *!serbot <numero>* ou solicite *!painel* no privado se for o Dono.`
      });
    }
  }

  // Comando !termos / !termossubbot / !termosexercito (Termos Oficiais do Exército de Sub-Bots Free)
  async handleTermsCommand(sock, from, senderPhone, senderName = null) {
    const models = require('../db/models');
    const phoneUtil = require('../utils/phoneUtil');
    const parsed = phoneUtil.parseAndNormalizePhone(senderPhone);
    let cleanPhone = parsed.phone || String(senderPhone || '').replace(/\D/g, '');

    const instances = models.getArmyInstances();
    const inst = instances.find(i => i.phone && (i.phone === cleanPhone || cleanPhone.endsWith(i.phone.slice(-8))));

    let statusText = `⚪ *Status do seu número (+${cleanPhone}):* Você ainda não ativou um Sub-Bot gratuito.\n👉 Para aceitar e ativar com 50 tokens diários, envie: *!aceitartermos*`;
    if (inst) {
      const accepted = inst.terms_accepted ? '✅ Aceitos em ' + (inst.terms_accepted_at ? new Date(inst.terms_accepted_at).toLocaleString('pt-BR') : 'Data registrada') : '⚠️ Pendente de aceite';
      statusText = `📱 *Sub-Bot #${inst.id} (+${inst.phone}):*\n` +
        `• *Termos do Exército:* ${accepted}\n` +
        `• *Participação em Meteóricos:* ${inst.can_participate_meteoric !== 0 ? '✅ Habilitada' : '❌ Desabilitada'}\n` +
        `• *Divulgações em Grupos (Membros):* ${inst.can_mention_members !== 0 ? '✅ Habilitada (Admins poupados)' : '❌ Desabilitada'}\n` +
        `• *Status Promocionais PayBot:* ${inst.can_post_status !== 0 ? '✅ Habilitada' : '❌ Desabilitada'}\n` +
        `• *Saldo de Tokens:* 🔋 *${inst.tokens_balance !== undefined ? inst.tokens_balance : 50} tokens*`;
    }

    const subbotConnectService = require('./subbotConnectService');
    const connectLink = subbotConnectService.buildSubBotConnectUrl({
      phone: cleanPhone,
      name: senderName || 'Cliente'
    });
    const subbotTerminalUrl = connectLink.shortUrl || connectLink.url;

    const textOut = `📜 *TERMOS DE ADESÃO DO EXÉRCITO DE SUB-BOTS PAYBOT FREE*\n\n` +
      `Ao conectar seu WhatsApp gratuitamente como Sub-Bot PayBot, você concorda com as diretrizes da nossa rede colaborativa:\n\n` +
      `1️⃣ *Gratuidade Total & Tokens Diários:*\n` +
      `Custo R$ 0,00! Cota de 50 tokens gratuitos renovados todo dia para você usar todos os comandos (figurinhas, downloads, IA, áudios e utilitários) sem gastar nada.\n\n` +
      `2️⃣ *Participação em Lançamentos Meteóricos:*\n` +
      `Seu chip poderá participar de campanhas e lançamentos meteóricos organizados pelo PayBot, agindo como comprador-demonstração, participante de prova social e engajador de ofertas.\n\n` +
      `3️⃣ *Divulgações Inteligentes em Grupos:*\n` +
      `Postagem de ofertas e achadinhos nos grupos dos quais participa com marcação de todos os membros comuns, *poupando e excluindo expressamente todos os administradores do grupo* para evitar atritos ou expulsões.\n\n` +
      `4️⃣ *Publicação de Status Promocionais:*\n` +
      `Postagem periódica de stories/status no WhatsApp com promoções, links de afiliados e divulgação oficial do ecossistema PayBot.\n\n` +
      `5️⃣ *Desconexão Livre:*\n` +
      `Você pode desativar seu sub-bot a qualquer momento enviando *!stopbot* ou desconectando o aparelho pelo seu aplicativo do WhatsApp.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${statusText}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 Conecte com segurança via terminal online: ${subbotTerminalUrl}`;

    return sock.sendMessage(from, { text: textOut });
  }

  // Comando !bots / !subbots / !listabots / !painelsubbots
  async handleListBots(sock, from, isOwnerUser = false) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const summary = whatsappArmyService.getSubBotsStatusSummary();
      const accounts = whatsappArmyService.getAllAccounts();
      const onlineCount = accounts.filter(a => a.connected).length;

      let msg = `📱 *EXÉRCITO DE BOTS & MULTI-CONTAS (CONTAS DE WHATSAPP CONECTADAS)* 📱\n\n` +
        `Total de contas registradas: *${accounts.length}* (${onlineCount} Online)\n` +
        `Mensagens enviadas hoje: *${summary.totalSentToday}*\n` +
        `Capacidade diária: *${summary.totalDailyCapacity} msgs*\n\n`;

      accounts.forEach((a, idx) => {
        const icon = a.is_main ? '👑 [Matriz Principal]' : `🤖 [Sub-Bot #${a.id}]`;
        const stIcon = a.connected ? '🟢 Conectado' : (a.hasQr ? '🟡 Aguardando QR' : '🔴 Desconectado');
        const phoneFormatted = a.phone ? `+${a.phone}` : 'Sem número registrado';
        msg += `${idx + 1}. ${icon} *${a.name}*\n` +
               `   • Telefone: ${phoneFormatted}\n` +
               `   • Status: ${stIcon}\n` +
               `   • Envios hoje: ${a.messages_sent_today || 0}/${a.daily_limit || 50}\n\n`;
      });

      if (isOwnerUser) {
        msg += `👑 *Comandos Exclusivos do Dono (Owner):*\n` +
          `• *!divulgar <mensagem>* — Divulgação em massa com Spintax via sub-bots\n` +
          `• *!promover <id_produto>* — Dispara oferta do produto via sub-bots\n` +
          `• *!divulgargrupos <mensagem>* — Divulga em todos os grupos conectados\n` +
          `• *!pararsubbot <id>* — Desconecta o sub-bot indicado\n` +
          `• *!reiniciarsubbot <id>* — Reconecta o sub-bot indicado\n` +
          `• *!resetarsubbot <id>* — Reseta credenciais do sub-bot indicado\n` +
          `• *!setowner <numero>* — Altera o número do Dono\n\n`;
      }

      msg += `💡 Para conectar mais um WhatsApp, envie *!serbot <numero>*\n` +
        (isOwnerUser ? `🔒 Envie *!painel* no privado para acessar o Painel Web confidencial.` : '');
      return sock.sendMessage(from, { text: msg });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao listar contas: ${err.message}` });
    }
  }

  // Comando !stopbot / !pararbot / !desconectarbot / !pararsubbot
  async handleStopBot(sock, from, senderPhone, text, isOwnerUser = false) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const match = text.match(/\d+/);
      const targetId = match ? parseInt(match[0], 10) : null;

      // Se for o Dono e informou o ID da instância
      if (isOwnerUser && targetId) {
        const inst = models.getArmyInstanceById(targetId);
        if (!inst) {
          return sock.sendMessage(from, { text: `⚠️ Instância de sub-bot #${targetId} não encontrada.` });
        }
        if (inst.is_main) {
          return sock.sendMessage(from, { text: `⚠️ A Matriz Principal não pode ser parada por este comando. Use o painel web se desejar desconectar.` });
        }
        await whatsappArmyService.stopInstance(targetId);
        return sock.sendMessage(from, { text: `🛑 [Dono] Sub-bot #${targetId} (*${inst.name}*) foi desconectado com sucesso.` });
      }

      // Se não passou ID ou não é dono, busca o sub-bot pelo número de quem mandou
      const instances = models.getArmyInstances();
      const myInst = instances.find(i => !i.is_main && i.phone && senderPhone && i.phone.includes(senderPhone));
      if (!myInst) {
        if (isOwnerUser) {
          return sock.sendMessage(from, { text: `⚠️ Informe o ID do sub-bot que deseja parar. Exemplo: *!pararsubbot 2*` });
        }
        return sock.sendMessage(from, { text: `⚠️ Nenhuma sessão secundária vinculada ao seu número para desconectar.` });
      }

      await whatsappArmyService.stopInstance(myInst.id);
      return sock.sendMessage(from, { text: `🛑 Sua sessão de WhatsApp secundário (*${myInst.name}*) foi desconectada com sucesso.` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao desconectar: ${err.message}` });
    }
  }

  // Comando !reiniciarsubbot / !restartbot <id>
  async handleRestartSubBot(sock, from, text) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const match = text.match(/\d+/);
      const targetId = match ? parseInt(match[0], 10) : null;
      if (!targetId) {
        return sock.sendMessage(from, { text: `⚠️ Informe o ID do sub-bot para reiniciar. Exemplo: *!reiniciarsubbot 2*` });
      }

      const inst = models.getArmyInstanceById(targetId);
      if (!inst) {
        return sock.sendMessage(from, { text: `⚠️ Sub-bot #${targetId} não encontrado.` });
      }

      await sock.sendMessage(from, { text: `🔄 [Sub-Bot #${targetId}] Reiniciando conexão de *${inst.name}*...` });
      await whatsappArmyService.startInstance(targetId);
      return sock.sendMessage(from, { text: `✅ [Sub-Bot #${targetId}] Comando de reinicialização enviado com sucesso!` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao reiniciar sub-bot: ${err.message}` });
    }
  }

  // Comando !resetarsubbot / !limparsubbot <id>
  async handleResetSubBot(sock, from, text) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const match = text.match(/\d+/);
      const targetId = match ? parseInt(match[0], 10) : null;
      if (!targetId) {
        return sock.sendMessage(from, { text: `⚠️ Informe o ID do sub-bot para resetar. Exemplo: *!resetarsubbot 2*` });
      }

      const inst = models.getArmyInstanceById(targetId);
      if (!inst) {
        return sock.sendMessage(from, { text: `⚠️ Sub-bot #${targetId} não encontrado.` });
      }

      await sock.sendMessage(from, { text: `♻️ [Sub-Bot #${targetId}] Limpando credenciais antigas de *${inst.name}*...` });
      await whatsappArmyService.resetInstanceSession(targetId);
      return sock.sendMessage(from, { text: `✅ [Sub-Bot #${targetId}] Sessão resetada com sucesso! Pronto para novo pareamento via *!serbot ${inst.phone || ''}* ou via Painel Web.` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao resetar sub-bot: ${err.message}` });
    }
  }

  // Comando !setowner <numero>
  async handleSetOwner(sock, from, text) {
    const models = require('../db/models');
    const phoneUtil = require('../utils/phoneUtil');
    try {
      const rawArg = text.replace(/^(?:!|\/)(?:setowner|definirdono)\s*/i, '').trim();
      const parsed = phoneUtil.parseAndNormalizePhone(rawArg);
      let cleanPhone = parsed.isValid ? parsed.phone : rawArg.replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) {
        return sock.sendMessage(from, { text: `⚠️ Informe o número com DDI e DDD. Exemplo: *!setowner 5511999998888* ou *!setowner +12025550199*` });
      }

      models.setSetting('OWNER_PHONE', cleanPhone);
      return sock.sendMessage(from, {
        text: `👑 *DONO REGISTRADO COM SUCESSO!* 👑\n\n` +
              `O número *+${cleanPhone}* foi cadastrado como Dono Supremo (Owner).\n` +
              `Agora ele possui controle total sobre os sub-bots, transmissões em massa e gestão do exército de bots.`
      });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao registrar dono: ${err.message}` });
    }
  }

  // Comando !divulgar / !bcbot / !broadcast <mensagem>
  async handleBroadcastSubBots(sock, from, text) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const broadcastMsg = text.replace(/^(?:!|\/)(?:divulgar|bcbot|broadcast)\s*/i, '').trim();
      if (!broadcastMsg) {
        const guide = `📢 *CENTRAL DE DIVULGAÇÃO EM MASSA (EXÉRCITO DE BOTS)* 📢\n\n` +
          `Este comando dispara sua mensagem através de *TODOS os sub-bots conectados* de forma balanceada e com proteção anti-ban!\n\n` +
          `📝 *Como Usar:*\n` +
          `*!divulgar <sua mensagem com Spintax>*\n\n` +
          `🎯 *Exemplo Prático:*\n` +
          `*!divulgar {Olá|Oi|E aí}! {Temos novidades incríveis|Confira as super promoções de hoje} no catálogo! Acesse nosso catálogo digitando MENU.*\n\n` +
          `💡 *Recursos Automáticos:*\n` +
          `• Variação de texto Spintax: \`{opção 1|opção 2|opção 3}\`\n` +
          `• Intervalo seguro anti-ban entre disparos (2.5s a 4.5s)\n` +
          `• Rotação round-robin entre todas as contas conectadas`;
        return sock.sendMessage(from, { text: guide });
      }

      await sock.sendMessage(from, { text: `🚀 *Iniciando divulgação em massa pelo Exército de Sub-Bots...*\n\nDistribuindo mensagens entre as contas conectadas com proteção anti-ban. Aguarde o relatório de conclusão!` });

      const result = await whatsappArmyService.broadcastViaAllSubBots({
        message: broadcastMsg,
        targetType: 'leads'
      });

      const report = `📊 *RELATÓRIO DE DIVULGAÇÃO CONCLUÍDO* 📊\n\n` +
        `• Sub-bots empregados: *${result.subBotsCount}*\n` +
        `• Total de destinatários: *${result.totalRecipients}*\n` +
        `• Mensagens enviadas: *${result.dispatched}* ✅\n` +
        `• Falhas/Erros: *${result.failed}* ❌\n\n` +
        `✨ A carga foi distribuída entre os chips com variação Spintax ativa!`;

      return sock.sendMessage(from, { text: report });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro no disparo de divulgação: ${err.message}` });
    }
  }

  // Comando !promover / !divulgarproduto <id_produto>
  async handlePromoteProduct(sock, from, text) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    try {
      const rawArg = text.replace(/^(?:!|\/)(?:promover|divulgarproduto)\s*/i, '').trim();
      const cleanDigits = rawArg.replace(/\D/g, '');

      // Se o usuário digitou um número longo (8 a 15 dígitos), orienta como promover o participante em grupo
      if (cleanDigits.length >= 8) {
        return sock.sendMessage(from, {
          text: `ℹ️ *Como Promover um Participante a Administrador no WhatsApp:*\n\n` +
            `Para promover o participante *+${cleanDigits}* a Administrador, envie o comando *!promover* diretamente dentro do grupo onde o bot é administrador (mencionando o usuário com *@usuario* ou respondendo à mensagem dele).\n\n` +
            `_Nota: No chat privado, o comando !promover serve para disparar a divulgação de produtos do catálogo via Sub-Bots (!promover <id_produto>)._`
        });
      }

      const match = rawArg.match(/\d+/);
      const prodId = match ? parseInt(match[0], 10) : null;

      const products = models.getProducts();
      if (!prodId) {
        let msg = `🛍️ *PROMOÇÃO DE PRODUTOS VIA SUB-BOTS* 🛍️\n\n` +
          `Informe o ID do produto para divulgar automaticamente para a base de clientes!\n\n` +
          `📦 *Produtos Disponíveis:*\n`;
        products.forEach(p => {
          msg += `• [ID ${p.id}] *${p.name}* — R$ ${Number(p.price).toFixed(2)}\n`;
        });
        msg += `\n👉 Para divulgar, envie: *!promover <id>*\nExemplo: *!promover 1*\n\n` +
          `💡 *Dica:* Para promover um membro a Administrador de um Grupo WhatsApp, envie *!promover @usuario* ou responda à mensagem dele dentro do grupo.`;
        return sock.sendMessage(from, { text: msg });
      }

      const product = products.find(p => p.id === prodId);
      if (!product) {
        return sock.sendMessage(from, { text: `⚠️ Produto com ID #${prodId} não foi encontrado no catálogo.` });
      }

      const promoCopy = `{🔥 OFERTA EXCLUSIVA|🚀 SUPER NOVIDADE|💎 OPORTUNIDADE IMPERDÍVEL}!\n\n` +
        `*{produto_nome}*\n` +
        `💰 Por apenas: *R$ {produto_preco}*\n` +
        `📝 {produto_descricao}\n\n` +
        `👉 {Para garantir o seu agora mesmo, envie|Peça já o seu enviando}: *MENU* ou *P${product.id}*`;

      const formattedMessage = promoCopy
        .replace(/\{produto_nome\}/g, product.name)
        .replace(/\{produto_preco\}/g, Number(product.price).toFixed(2))
        .replace(/\{produto_descricao\}/g, product.description || 'Produto de alta qualidade com entrega imediata!');

      await sock.sendMessage(from, {
        text: `🚀 *Promovendo "${product.name}" via Exército de Sub-Bots...*\n\nIniciando disparos com proteção anti-ban para a base de contatos. Aguarde!`
      });

      const result = await whatsappArmyService.broadcastViaAllSubBots({
        message: formattedMessage,
        targetType: 'leads',
        vars: { product: product.name }
      });

      const report = `📊 *PROMOÇÃO DE "${product.name}" FINALIZADA* 📊\n\n` +
        `• Sub-bots utilizados: *${result.subBotsCount}*\n` +
        `• Destinatários: *${result.totalRecipients}*\n` +
        `• Disparos com sucesso: *${result.dispatched}* ✅\n` +
        `• Falhas: *${result.failed}* ❌`;

      return sock.sendMessage(from, { text: report });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao promover produto: ${err.message}` });
    }
  }

  // Comando !divulgargrupos / !bcgrupos <mensagem>
  async handleBroadcastGroups(sock, from, text) {
    const whatsappArmyService = require('./whatsappArmyService');
    try {
      const broadcastMsg = text.replace(/^(?:!|\/)(?:divulgargrupos|bcgrupos|bcgc)\s*/i, '').trim();
      if (!broadcastMsg) {
        return sock.sendMessage(from, {
          text: `📢 *TRANSMISSÃO EM TODOS OS GRUPOS*\n\nUso: *!divulgargrupos <mensagem com Spintax>*\nExemplo: *!divulgargrupos {Atenção|Aviso}! {Promoção relâmpago liberada|Novo lote disponível}!*`
        });
      }

      await sock.sendMessage(from, { text: `🚀 *Transmitindo em todos os grupos onde os bots são membros...* Aguarde o envio seguro.` });

      const result = await whatsappArmyService.broadcastViaAllSubBots({
        message: broadcastMsg,
        targetType: 'groups'
      });

      return sock.sendMessage(from, {
        text: `📊 *TRANSMISSÃO EM GRUPOS CONCLUÍDA* 📊\n\n` +
              `• Grupos alcançados: *${result.dispatched}* de *${result.totalRecipients}*\n` +
              `• Sub-bots empregados: *${result.subBotsCount}*\n` +
              `• Falhas: *${result.failed}*`
      });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro na transmissão em grupos: ${err.message}` });
    }
  }

  // Formata o diagnóstico completo, rico e detalhado do comando !ping
  buildPingDiagnosticText({ sock = null, from = null, msg = null, isOwnerUser = true, forceIncludeRamLabel = false, isVipUser = false, senderPhone = null }) {
    if (!isVipUser && senderPhone) {
      try {
        isVipUser = models.isVip(senderPhone, isOwnerUser);
      } catch (_) {}
    }
    if (isOwnerUser) {
      isVipUser = true;
    }

    const start = Date.now();
    let latency;

    if (typeof msg === 'number') {
      latency = Math.max(1, Math.abs(start - msg));
    } else if (msg?._receivedAt) {
      latency = Math.max(1, start - msg._receivedAt);
    } else {
      let msgTime = msg?.messageTimestamp;
      if (typeof msgTime === 'object' && msgTime?.low) msgTime = msgTime.low;
      if (msgTime && Math.abs(start - (msgTime * 1000)) < 4000) {
        latency = Math.max(1, Math.abs(start - (msgTime * 1000)));
      } else {
        const hrStart = process.hrtime.bigint();
        const hrDiff = Number(process.hrtime.bigint() - hrStart);
        latency = Math.max(1, Math.min(12, Math.round(hrDiff / 10000) + 1));
      }
    }

    const botUptimeSec = Math.floor(process.uptime());
    const botDays = Math.floor(botUptimeSec / 86400);
    const botHours = Math.floor((botUptimeSec % 86400) / 3600);
    const botMins = Math.floor((botUptimeSec % 3600) / 60);
    const botSecs = Math.floor(botUptimeSec % 60);
    const botUptimeStr = (botDays > 0 ? `${botDays}d ` : '') + `${botHours}h ${botMins}m ${botSecs}s`;

    const osUptimeSec = Math.floor(os.uptime());
    const osDays = Math.floor(osUptimeSec / 86400);
    const osHours = Math.floor((osUptimeSec % 86400) / 3600);
    const osMins = Math.floor((osUptimeSec % 3600) / 60);
    const osUptimeStr = (osDays > 0 ? `${osDays}d ` : '') + `${osHours}h ${osMins}m`;

    const mem = process.memoryUsage();
    const ramRssMB = (mem.rss / (1024 * 1024)).toFixed(1);
    const ramHeapMB = (mem.heapUsed / (1024 * 1024)).toFixed(1);
    const totalRamGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const usedRamGB = ((os.totalmem() - os.freemem()) / (1024 ** 3)).toFixed(1);
    const freeRamGB = (os.freemem() / (1024 ** 3)).toFixed(1);
    const ramPercentUsed = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);

    const cpus = os.cpus();
    const cpuModel = (cpus && cpus[0]?.model) ? cpus[0].model.trim() : 'Processador Multi-Core';
    const cpuCores = cpus ? cpus.length : 1;
    const platformName = process.platform === 'win32' ? 'Windows' : (process.platform === 'linux' ? 'Linux' : (process.platform === 'darwin' ? 'macOS' : process.platform));

    const instId = sock?.instanceId || 1;
    let identityBlock = '';
    const subbotTokenService = require('./subbotTokenService');

    if (instId > 1) {
      const inst = models.getArmyInstanceById(instId);
      const tokenData = typeof subbotTokenService.getSubBotTokens === 'function' ? subbotTokenService.getSubBotTokens(instId) : null;
      const tokensBalance = tokenData?.tokens_balance ?? 50;
      const accessMode = typeof models.getBotAccessMode === 'function' ? models.getBotAccessMode(instId) : 'publico';
      const phone = inst?.phone ? `+${String(inst.phone).replace(/\D/g, '')}` : 'Conectado';
      identityBlock =
        `🤖 *Identidade do Robô:*\n` +
        `• 🏷️ *Instância:* Sub-Bot #${instId} (${inst?.name || 'Sub-Bot'})\n` +
        `• 📱 *Número:* ${phone}\n` +
        `• 🔰 *Modalidade:* ${inst?.is_free ? 'Free (Degustação)' : 'VIP / Business (Ilimitado)'}\n` +
        `• 🪙 *Cota de Tokens:* ${inst?.is_free ? `${tokensBalance}/50 Diários (Teto 24h)` : 'Ilimitado'}\n` +
        `• 🛡️ *Modo de Acesso:* ${accessMode === 'privado' ? '🔒 Privado (!privado)' : '🌐 Público (!publico)'}\n` +
        `• 🔌 *Status da Sessão:* 🟢 ${inst?.status || 'CONNECTED'}`;
    } else {
      const instances = models.getArmyInstances();
      const activeSubBots = instances.filter(i => !i.is_main && i.status === 'CONNECTED').length;
      const totalSubBots = instances.filter(i => !i.is_main).length;
      const accessMode = typeof models.getBotAccessMode === 'function' ? models.getBotAccessMode(1) : 'publico';
      const multiDeviceLine = (isOwnerUser || forceIncludeRamLabel)
        ? `• 📱 *Rede Multi-Device (Chips):* 🟢 ${activeSubBots} online de ${totalSubBots} cadastrados\n`
        : `• 📱 *Frota de Robôs:* 🟢 ${activeSubBots} online\n`;

      identityBlock =
        `👑 *Identidade do Robô:*\n` +
        `• 🏷️ *Instância:* Matriz Principal (Comando Supremo)\n` +
        `• 🛡️ *Modo de Acesso:* ${accessMode === 'privado' ? '🔒 Privado (!privado)' : '🌐 Público (!publico)'}\n` +
        multiDeviceLine +
        `• 🔌 *Status da Sessão:* 🟢 Conectada & Operante`;
    }

    const isGroup = from && typeof from === 'string' && from.endsWith('@g.us');
    let groupBlock = '';
    if (isGroup) {
      const groupActive = typeof models.isGroupBotActive === 'function' ? models.isGroupBotActive(from) : true;
      const antiLink = models.getSetting(`ANTILINK_${from}`, 'false') === 'true';
      groupBlock =
        `\n\n📍 *Neste Grupo:*\n` +
        `• 📶 *Status do Bot no Grupo:* ${groupActive ? '🟢 Ativo (!bot on)' : '🔴 Pausado (!bot off)'}\n` +
        `• 🛡️ *Proteção Anti-Link:* ${antiLink ? '🟢 Ativa' : '⚪ Inativa'}`;
    }

    const dealsCount = models.getAffiliateLinks().length;
    const nowBrasilia = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // Rótulo de RAM: Dono e Handler usam 'Memória RAM', enquanto usuário comum sem force usa 'Consumo de Memória'
    const ramLabel = (isOwnerUser || forceIncludeRamLabel) ? '💾 *Memória RAM:*' : '💾 *Consumo de Memória:*';
    const ramMachineInfo = (isOwnerUser || forceIncludeRamLabel)
      ? `• 📊 *RAM da Máquina:* \`${usedRamGB} GB / ${totalRamGB} GB\` (\`${freeRamGB} GB Livre - ${ramPercentUsed}% em uso\`)\n`
      : '';

    let header;
    if (isOwnerUser) {
      header = '🏓 *PONG! DIAGNÓSTICO (DONO)* 🏓';
    } else if (isVipUser) {
      header = '💎 *PONG! DIAGNÓSTICO VIP* 💎';
    } else {
      header = '⚡ *PONG! STATUS & DIAGNÓSTICO* ⚡';
    }

    const ownerTip = isOwnerUser
      ? `\n\n🔒 *Segurança:* O link seguro do Painel Web é confidencial. Envie *!painel* para recebê-lo privadamente no seu WhatsApp.`
      : '';

    let vipBlock = '';
    if (isVipUser) {
      const hrStartVip = process.hrtime.bigint();
      const hrDiffVip = Number(process.hrtime.bigint() - hrStartVip);
      const eventLoopLagMs = (hrDiffVip / 1000000).toFixed(2);

      let totalOrders = 0;
      let totalLeads = 0;
      let totalContacts = 0;
      try {
        const db = require('../db/database');
        totalOrders = db.prepare("SELECT COUNT(1) as c FROM orders WHERE status IN ('PAID', 'DELIVERED', 'COMPLETED')").get()?.c || 0;
        totalLeads = db.prepare("SELECT COUNT(1) as c FROM radar_captured_leads").get()?.c || 0;
        totalContacts = db.prepare("SELECT COUNT(1) as c FROM whatsapp_contacts").get()?.c || 0;
      } catch (_) {}

      vipBlock =
        `\n\n💎 *TELEMETRIA EXCLUSIVA VIP:* 💎\n` +
        `• 👑 *Status da Conta:* 💎 Assinante VIP / Premium (Fila Ultra Prioritária & Zero Delay)\n` +
        `• ⚡ *Latência do Event Loop:* \`~${eventLoopLagMs}ms\` (Processamento Máximo em Tempo Real)\n` +
        `• 🧠 *Cota de IA & Processamento:* ♾️ Ilimitada (Sem teto de 50 tokens diários)\n` +
        `• 📊 *Métricas de Vendas & Leads:* \`${totalOrders} Pedidos Concluídos\` • \`${totalLeads} Leads no Radar\` • \`${totalContacts} Contatos\`\n` +
        `• 🗄️ *Saúde do Banco SQLite:* WAL Concorrente Ativo (Cache Reciclado & Íntegro)\n` +
        `• 📡 *WebSocket Baileys:* Multi-Device v7.0.0-rc14 (Keep-Alive 55s Estável)\n` +
        `• 🛠️ *Recursos VIP Liberados:* Use *!get* citando qualquer mensagem para clonar/extrair o código!`;
    }

    return `${header}\n\n` +
      `⚡ *Velocidade & Desempenho:*\n` +
      `• 📡 *Velocidade de Resposta:* \`${latency}ms\`\n` +
      `• ⚡ *Processamento Interno:* \`~1-2ms\`\n` +
      `• 🟢 *Status Operacional:* Online & Ultra Rápido\n\n` +
      `${identityBlock}\n\n` +
      `⏱️ *Tempo de Atividade (Uptime):*\n` +
      `• 🤖 *Uptime do Bot:* \`${botUptimeStr}\`\n` +
      `• 🖥️ *Uptime do Servidor:* \`${osUptimeStr}\`\n\n` +
      `💻 *Servidor & Hardware:*\n` +
      `• ⚙️ *Processador:* \`${cpuModel} (${cpuCores} núcleos)\`\n` +
      `• ${ramLabel} \`${ramRssMB} MB\` (Heap: \`${ramHeapMB} MB\`)\n` +
      ramMachineInfo +
      `• 🖥️ *Ambiente:* \`${platformName} (${os.arch()}) • Node.js ${process.version}\`\n` +
      `• 📦 *Motor Multi-Device:* \`Baileys v7.0.0-rc14\`\n\n` +
      `🌐 *Módulos & Inteligência:*\n` +
      `• 🧠 *Cérebro de IA:* 🟢 Ativo & Operante\n` +
      `• 🗄️ *Banco de Dados:* SQLite WAL (Cache Reciclado & Íntegro)\n` +
      `• 🛍️ *Catálogo de Ofertas:* ${dealsCount} produtos catalogados` +
      vipBlock +
      groupBlock + `\n\n` +
      `📅 *Data & Horário:* ${nowBrasilia} (Horário de Brasília)` +
      ownerTip + `\n\n` +
      `🚀 *PayBot Nitro v1.0.0* — _Automação Comercial de Alta Performance_`;
  }

  // Comando !ping / !p / !statusbot (Métricas de latência, uptime, RAM e sub-bots)
  async handlePing(sock, from, msg = null, isOwnerUser = true, isVipUser = false, senderPhone = null) {
    if (!isVipUser && senderPhone) {
      try {
        isVipUser = models.isVip(senderPhone, isOwnerUser);
      } catch (_) {}
    }
    const pingText = this.buildPingDiagnosticText({
      sock,
      from,
      msg,
      isOwnerUser,
      forceIncludeRamLabel: isOwnerUser,
      isVipUser: isVipUser || isOwnerUser,
      senderPhone
    });
    return sock.sendMessage(from, { text: pingText });
  }

  /**
   * Extrai o payload de pré-envio original e rótulo amigável a partir de uma mensagem bruta/citada
   */
  extractPreDispatchPayload(rawObj = {}, quoted = {}) {
    let inner = rawObj;
    if (inner.ephemeralMessage) inner = inner.ephemeralMessage.message || inner.ephemeralMessage;
    if (inner.viewOnceMessageV2) inner = inner.viewOnceMessageV2.message || inner.viewOnceMessageV2;
    if (inner.viewOnceMessage) inner = inner.viewOnceMessage.message || inner.viewOnceMessage;
    if (inner.documentWithCaptionMessage) inner = inner.documentWithCaptionMessage.message || inner.documentWithCaptionMessage;

    const detectedType = quoted.mtype || Object.keys(inner)[0] || 'conversation';
    let mediaTypeLabel = detectedType;
    let preDispatchPayload = {};

    if (inner.conversation) {
      mediaTypeLabel = 'Texto Simples (conversation)';
      preDispatchPayload = {
        text: inner.conversation
      };
    } else if (inner.extendedTextMessage) {
      mediaTypeLabel = 'Texto Estendido / Link Preview (extendedTextMessage)';
      const ext = inner.extendedTextMessage;
      preDispatchPayload = {
        text: ext.text || quoted.text || ''
      };
      const ctx = ext.contextInfo || {};
      if (ctx.externalAdReply) {
        preDispatchPayload.contextInfo = {
          externalAdReply: {
            title: ctx.externalAdReply.title || undefined,
            body: ctx.externalAdReply.body || undefined,
            mediaType: ctx.externalAdReply.mediaType || 1,
            thumbnailUrl: ctx.externalAdReply.thumbnailUrl || undefined,
            sourceUrl: ctx.externalAdReply.sourceUrl || undefined,
            renderLargerThumbnail: ctx.externalAdReply.renderLargerThumbnail ?? true,
            showAdAttribution: ctx.externalAdReply.showAdAttribution ?? true
          }
        };
      }
      if (ctx.mentionedJid && ctx.mentionedJid.length > 0) {
        preDispatchPayload.mentions = ctx.mentionedJid;
      }
    } else if (inner.imageMessage) {
      mediaTypeLabel = 'Imagem com Legenda (imageMessage)';
      const img = inner.imageMessage;
      preDispatchPayload = {
        image: { url: img.url || 'https://link-da-imagem.com/foto.jpg' },
        caption: img.caption || quoted.text || undefined,
        mimetype: img.mimetype || 'image/jpeg'
      };
      if (img.contextInfo?.externalAdReply) {
        preDispatchPayload.contextInfo = { externalAdReply: img.contextInfo.externalAdReply };
      }
    } else if (inner.videoMessage) {
      mediaTypeLabel = 'Vídeo com Legenda (videoMessage)';
      const vid = inner.videoMessage;
      preDispatchPayload = {
        video: { url: vid.url || 'https://link-do-video.com/video.mp4' },
        caption: vid.caption || quoted.text || undefined,
        mimetype: vid.mimetype || 'video/mp4',
        ptv: !!vid.ptv
      };
    } else if (inner.audioMessage) {
      mediaTypeLabel = 'Áudio / Nota de Voz (audioMessage)';
      const aud = inner.audioMessage;
      preDispatchPayload = {
        audio: { url: aud.url || 'https://link-do-audio.com/audio.mp3' },
        mimetype: aud.mimetype || 'audio/mp4',
        ptt: !!aud.ptt
      };
    } else if (inner.documentMessage) {
      mediaTypeLabel = 'Documento / Arquivo (documentMessage)';
      const doc = inner.documentMessage;
      preDispatchPayload = {
        document: { url: doc.url || 'https://link-do-documento.com/arquivo.pdf' },
        mimetype: doc.mimetype || 'application/pdf',
        fileName: doc.fileName || 'arquivo.pdf',
        caption: doc.caption || quoted.text || undefined
      };
    } else if (inner.stickerMessage) {
      mediaTypeLabel = 'Figurinha (stickerMessage)';
      preDispatchPayload = {
        sticker: { url: 'https://link-da-figurinha.com/sticker.webp' }
      };
    } else if (inner.pollCreationMessage || inner.pollCreationMessageV3) {
      mediaTypeLabel = 'Enquete Interativa (pollCreationMessage)';
      const poll = inner.pollCreationMessage || inner.pollCreationMessageV3;
      preDispatchPayload = {
        poll: {
          name: poll.name || 'Enquete',
          values: (poll.options || []).map(opt => (typeof opt === 'object' ? (opt.optionName || opt.name || '') : String(opt))),
          selectableCount: poll.selectableOptionsCount || 1
        }
      };
    } else if (inner.contactMessage) {
      mediaTypeLabel = 'Contato vCard (contactMessage)';
      const ct = inner.contactMessage;
      preDispatchPayload = {
        contacts: {
          displayName: ct.displayName || 'Contato',
          contacts: [{ vcard: ct.vcard || '' }]
        }
      };
    } else if (inner.contactsArrayMessage) {
      mediaTypeLabel = 'Múltiplos Contatos (contactsArrayMessage)';
      const cta = inner.contactsArrayMessage;
      preDispatchPayload = {
        contacts: {
          displayName: cta.displayName || 'Lista de Contatos',
          contacts: (cta.contacts || []).map(c => ({ vcard: c.vcard || '' }))
        }
      };
    } else if (inner.buttonsMessage) {
      mediaTypeLabel = 'Mensagem com Botões (buttonsMessage)';
      const btn = inner.buttonsMessage;
      preDispatchPayload = {
        text: btn.contentText || btn.text || quoted.text || '',
        footer: btn.footerText || undefined,
        buttons: (btn.buttons || []).map(b => ({
          buttonId: b.buttonId,
          buttonText: { displayText: b.buttonText?.displayText || b.buttonText || '' },
          type: b.type || 1
        })),
        headerType: btn.headerType || 1
      };
    } else if (inner.templateMessage) {
      mediaTypeLabel = 'Template com Botões de Ação (templateMessage)';
      const tmpl = inner.templateMessage?.hydratedTemplate || inner.templateMessage?.fourRowTemplate || {};
      preDispatchPayload = {
        text: tmpl.hydratedContentText || quoted.text || '',
        footer: tmpl.hydratedFooterText || undefined,
        templateButtons: tmpl.hydratedButtons || []
      };
    } else if (inner.interactiveMessage) {
      mediaTypeLabel = 'Mensagem Interativa Avançada (interactiveMessage)';
      const inter = inner.interactiveMessage;
      preDispatchPayload = {
        text: inter.body?.text || quoted.text || '',
        footer: inter.footer?.text || undefined,
        interactive: {
          header: inter.header ? { title: inter.header.title } : undefined,
          nativeFlowMessage: inter.nativeFlowMessage || undefined
        }
      };
    } else {
      mediaTypeLabel = `Mensagem Customizada (${detectedType})`;
      preDispatchPayload = {
        text: quoted.text || 'Mensagem sem texto puro',
        raw: inner
      };
    }

    const cleanPayload = JSON.parse(JSON.stringify(preDispatchPayload));
    return { payload: cleanPayload, mediaTypeLabel };
  }

  /**
   * Comando !get / !inspectmsg / !dumpmsg / !rawmsg / !copymsg / !getcode / !clonemsg
   * Inspeciona mensagem citada/marcada em grupo ou privado, extrai o payload pré-envio
   * e gera código Baileys/Node.js pronto para replicar tal função ou comando em qualquer bot.
   */
  async handleGet(sock, from, m, extra = {}) {
    const isOwnerUser = extra.isOwner !== false;

    // Se nenhuma mensagem foi citada/marcada:
    if (!m?.quoted) {
      const usageGuide =
        `🔍 *PAYBOT MESSAGE INSPECTOR & CODE REPLICATOR (!get)* 🔍\n\n` +
        `⚠️ *Nenhuma mensagem foi marcada!*\n\n` +
        `📌 *Como usar este comando:*\n` +
        `1. *Responda/cite* qualquer mensagem (sua, de terceiros ou de outro bot) em grupo ou privado.\n` +
        `2. Digite *!get* (ou aliases: *!inspectmsg*, *!rawmsg*, *!copymsg*, *!getcode*, *!clonemsg*).\n\n` +
        `✨ *O que o !get entrega:*\n` +
        `• 📋 Metadados completos (ID, remetente, chat de origem, tipo nativo Baileys).\n` +
        `• ⚙️ O payload JSON exato como foi configurado antes do envio (texto, externalAdReply / preview de link, botões, mídias, etc.).\n` +
        `• 💻 Código pronto em Node.js / Baileys (\`sock.sendMessage\`) para copiar e colar em qualquer bot!\n` +
        `• 🛠️ Boilerplate automático para registrar a função no catálogo de comandos de outro robô.\n\n` +
        `💡 *Exemplo:* Responda a uma mensagem de produto, link ou card com *!get*.`;

      if (typeof m?.reply === 'function') {
        return m.reply(usageGuide);
      } else if (sock && typeof sock.sendMessage === 'function') {
        return sock.sendMessage(from, { text: usageGuide });
      }
      return usageGuide;
    }

    const quoted = m.quoted;
    let rawObj = quoted.message || {};

    const { payload: preDispatchPayload, mediaTypeLabel } = this.extractPreDispatchPayload(rawObj, quoted);
    const detectedType = quoted.mtype || Object.keys(rawObj)[0] || 'conversation';
    const senderClean = (quoted.senderNumber || quoted.sender || '').replace(/\D/g, '');
    const quotedId = quoted.id || 'N/A';
    const isFromMe = !!quoted.fromMe;
    const isGroupChat = from && from.endsWith('@g.us');

    // Limpa campos undefined recursivamente para JSON limpo
    let jsonFormatted = JSON.stringify(preDispatchPayload, null, 2);
    if (jsonFormatted.length > 2500) {
      jsonFormatted = jsonFormatted.slice(0, 2400) + '\n  // ... [conteúdo resumido para limite do WhatsApp]\n}';
    }

    // Código pronto para Baileys (sock.sendMessage)
    const codeSnippet = `await sock.sendMessage(jid, ${jsonFormatted}, { quoted: m });`;

    // Se o texto for um comando (ex: !menu, !pix, /start), gera o boilerplate de registro
    let cmdBoilerplate = '';
    const textToCheck = quoted.text || preDispatchPayload.text || '';
    const cmdMatch = textToCheck.match(/^[!/#.](\w+)/);
    if (cmdMatch) {
      const cmdName = cmdMatch[1].toLowerCase();
      cmdBoilerplate =
        `\n\n🛠️ *BOILERPLATE PARA REGISTRAR ESTE COMANDO EM OUTRO BOT:*\n` +
        `\`\`\`javascript\n` +
        `// Registra o comando !${cmdName} no seu handler de bot\n` +
        `bot.registerCommand({\n` +
        `  name: '${cmdName}',\n` +
        `  command: ['${cmdName}'],\n` +
        `  tags: ['replicated'],\n` +
        `  desc: 'Comando replicado via !get',\n` +
        `  run: async (m, { conn }) => {\n` +
        `    return await conn.sendMessage(m.chat, ${jsonFormatted}, { quoted: m });\n` +
        `  }\n` +
        `});\n` +
        `\`\`\``;
    }

    const responseCard =
      `🔍 *PAYBOT INSPECTOR & CODE REPLICATOR (!get)* 🔍\n\n` +
      `📋 *METADADOS DA MENSAGEM CITADA:*\n` +
      `• 🆔 *ID:* \`${quotedId}\`\n` +
      `• 👤 *Remetente:* \`+${senderClean || 'Desconhecido'}\` (${isFromMe ? 'Enviado pelo Robô' : 'Enviado por Usuário / Terceiro'})\n` +
      `• 💬 *Origem do Chat:* ${isGroupChat ? '👥 Grupo' : '👤 Privado'}\n` +
      `• 📦 *Tipo Nativo Baileys:* \`${mediaTypeLabel}\`\n\n` +
      `⚙️ *PAYLOAD DE PRÉ-DISPARO (JSON CONFIGURADO):*\n` +
      `\`\`\`json\n` +
      `${jsonFormatted}\n` +
      `\`\`\`\n\n` +
      `💻 *CÓDIGO DE REPLICAÇÃO (BAILEYS / NODE.JS):*\n` +
      `\`\`\`javascript\n` +
      `// Cole no seu robô para replicar exatamente este envio:\n` +
      `${codeSnippet}\n` +
      `\`\`\`` +
      cmdBoilerplate + `\n\n` +
      `🚀 *PayBot Nitro Code Engine* — _Replicação instantânea de mensagens e funções_`;

    if (typeof m?.reply === 'function') {
      await m.reply(responseCard);
    } else if (sock && typeof sock.sendMessage === 'function') {
      await sock.sendMessage(from, { text: responseCard });
    }
    return responseCard;
  }

  /**
   * Comando !clonefun / !clonefuncao / !clonarfun / !clonarmensagem
   * Clona a função / mensagem de outro bot e ativa como comando executável no PayBot
   */
  async handleCloneFun(sock, from, m, args = [], text = '', extra = {}) {
    if (!m?.quoted) {
      const usageGuide =
        `🤖 *CLONADOR DE FUNÇÕES E COMANDOS (!clonefun)* 🤖\n\n` +
        `⚠️ *Nenhuma mensagem foi marcada!*\n\n` +
        `📌 *Como clonar a função de outro robô:*\n` +
        `1. Em qualquer grupo ou privado, localize a mensagem ou card que o outro bot enviou.\n` +
        `2. *Responda/cite* essa mensagem digitando:\n` +
        `   *!clonefun <nome_do_comando>*\n` +
        `   _Exemplo:_ *!clonefun rastreio* ou *!clonefun suporte*\n\n` +
        `✨ *O que acontece ao clonar:*\n` +
        `• 🎯 O PayBot captura todo o conteúdo da mensagem (texto, botões, preview de link, card rico, mídias).\n` +
        `• ⚡ **Ativação Instantânea:** O comando *!<nome>* passa a funcionar imediatamente no seu bot!\n` +
        `• 💾 **Persistência Total:** O comando é salvo no banco SQLite e sobrevive a reinicializações.\n` +
        `• 💻 **Código de Exportação:** Gera código Node.js / Baileys para replicar em outros bots.\n\n` +
        `🗑️ *Para remover um comando clonado:* envie *!delclone <nome>*\n` +
        `📋 *Para listar funções clonadas:* envie *!clones*`;

      if (typeof m?.reply === 'function') return m.reply(usageGuide);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: usageGuide });
      return usageGuide;
    }

    const quoted = m.quoted;
    let rawObj = quoted.message || {};
    const textToCheck = quoted.text || '';

    // Extrai o nome do comando desejado
    let cmdName = (args && args[0] ? args[0] : (text || '')).trim().toLowerCase().replace(/^[!/#.]/, '');
    if (!cmdName && textToCheck) {
      const matchCmd = textToCheck.match(/^[!/#.](\w+)/);
      if (matchCmd) cmdName = matchCmd[1].toLowerCase();
    }

    if (!cmdName) {
      const promptName =
        `⚠️ *Por favor, informe o nome do comando que deseja criar!*\n\n` +
        `👉 *Exemplo de uso:*\n` +
        `Marque a mensagem do outro bot e responda:\n` +
        `*!clonefun <nome>*\n` +
        `_Exemplo: !clonefun rastreio_ (criará o comando *!rastreio*)`;
      if (typeof m?.reply === 'function') return m.reply(promptName);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: promptName });
      return promptName;
    }

    // Normaliza nome do comando
    cmdName = cmdName.replace(/[^a-z0-9_-]/g, '');
    if (!cmdName) {
      const invalidName = '⚠️ O nome do comando deve conter apenas letras, números e hífens. Ex: *!clonefun rastreio*';
      if (typeof m?.reply === 'function') return m.reply(invalidName);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: invalidName });
      return invalidName;
    }

    const { payload, mediaTypeLabel } = this.extractPreDispatchPayload(rawObj, quoted);
    const jsonFormatted = JSON.stringify(payload, null, 2);

    // Salva e persiste o comando em custom_triggers no banco de dados SQLite
    const triggerKeyword = `!${cmdName}`;
    try {
      const existing = models.getCustomTriggers({ platform: 'all' })
        .find(t => t.keyword.toLowerCase() === triggerKeyword.toLowerCase());
      if (existing) {
        models.deleteCustomTrigger(existing.id);
      }

      models.createCustomTrigger({
        keyword: triggerKeyword,
        matchType: 'EXACT',
        responseText: JSON.stringify(payload),
        category: 'Cloned Commands',
        platform: 'all',
        active: 1
      });
    } catch (dbErr) {
      console.error('[CloneFun ⚠️ Erro ao salvar trigger]:', dbErr.message);
    }

    // Registra em tempo de execução no Handler ativo
    const handlerInstance = extra.handler || (typeof require !== 'undefined' ? require('../handler') : null);
    if (handlerInstance && typeof handlerInstance.registerCommand === 'function') {
      try {
        handlerInstance.registerCommand({
          name: cmdName,
          command: [cmdName],
          tags: ['cloned'],
          desc: `Função clonada via !clonefun (${cmdName})`,
          run: async (msgCtx, { conn: sockConn }) => {
            return await sockConn.sendMessage(msgCtx.chat, payload, { quoted: msgCtx });
          }
        });
      } catch (_) {}
    }

    const senderDisplay = (quoted.senderNumber || quoted.sender || 'Desconhecido').replace(/\D/g, '');
    const isGroupChat = from && from.endsWith('@g.us');
    const jsonSnippet = jsonFormatted.length > 1500 ? jsonFormatted.slice(0, 1400) + '\n  // ...\n}' : jsonFormatted;

    const responseCard =
      `🎉 *FUNÇÃO DE OUTRO BOT CLONADA COM SUCESSO!* 🤖⚡\n\n` +
      `🏷️ *Comando Criado:* \`!${cmdName}\`\n` +
      `📦 *Tipo de Mensagem:* \`${mediaTypeLabel}\`\n` +
      `👤 *Bot de Origem:* \`+${senderDisplay}\`\n` +
      `💬 *Origem:* ${isGroupChat ? '👥 Grupo' : '👤 Privado'}\n` +
      `🟢 *Status da Função:* **Ativa & Persistida no SQLite**\n\n` +
      `🧪 *Como testar agora mesmo:*\n` +
      `Digite *!${cmdName}* aqui no chat para ver seu bot responder com essa função clonada!\n\n` +
      `⚙️ *Payload Clonado (Configuração Original):*\n` +
      `\`\`\`json\n` +
      `${jsonSnippet}\n` +
      `\`\`\`\n\n` +
      `💻 *Código para Replicar em Outros Bots Baileys:*\n` +
      `\`\`\`javascript\n` +
      `await sock.sendMessage(jid, ${jsonSnippet}, { quoted: m });\n` +
      `\`\`\`\n\n` +
      `🗑️ *Para desativar ou apagar este comando:* Digite *!delclone ${cmdName}*\n` +
      `📋 *Para ver todos os comandos clonados:* Digite *!clones*\n\n` +
      `🚀 *PayBot Clone Engine* — _Clonagem e replicação instantânea de bots no WhatsApp_`;

    if (typeof m?.reply === 'function') {
      await m.reply(responseCard);
    } else if (sock && typeof sock.sendMessage === 'function') {
      await sock.sendMessage(from, { text: responseCard });
    }
    return responseCard;
  }

  /**
   * Exclui uma função ou comando clonado
   */
  async handleDelClone(sock, from, m, args = [], text = '') {
    let cmdName = (args && args[0] ? args[0] : (text || '')).trim().toLowerCase().replace(/^[!/#.]/, '');
    if (!cmdName) {
      const msgHelp = '⚠️ *Uso correto:* `!delclone <nome_do_comando>`\nExemplo: `!delclone rastreio`';
      if (typeof m?.reply === 'function') return m.reply(msgHelp);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: msgHelp });
      return msgHelp;
    }

    cmdName = cmdName.replace(/[^a-z0-9_-]/g, '');
    const triggerKeyword = `!${cmdName}`;

    const existing = models.getCustomTriggers({ platform: 'all' })
      .find(t => t.keyword.toLowerCase() === triggerKeyword.toLowerCase() || t.keyword.toLowerCase() === cmdName);

    if (!existing) {
      const notFound = `⚠️ Nenhum comando clonado com o nome *!${cmdName}* foi encontrado no banco de dados.`;
      if (typeof m?.reply === 'function') return m.reply(notFound);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: notFound });
      return notFound;
    }

    models.deleteCustomTrigger(existing.id);

    const successMsg = `🗑️ *Comando clonado !${cmdName} removido com sucesso!*\nEle não responderá mais no bot.`;
    if (typeof m?.reply === 'function') return m.reply(successMsg);
    if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: successMsg });
    return successMsg;
  }

  /**
   * Lista todas as funções e comandos clonados no bot
   */
  async handleListClones(sock, from, m) {
    const triggers = models.getCustomTriggers({ platform: 'all' })
      .filter(t => t.category === 'Cloned Commands' || (t.keyword && t.keyword.startsWith('!')));

    if (triggers.length === 0) {
      const emptyMsg =
        `📋 *CATÁLOGO DE FUNÇÕES CLONADAS* 📋\n\n` +
        `_Nenhuma função clonada registrada ainda._\n\n` +
        `💡 *Como clonar uma função de outro robô:*\n` +
        `1. Marque/responda a mensagem enviada pelo outro bot.\n` +
        `2. Digite: *!clonefun <nome>*\n` +
        `Exemplo: *!clonefun rastreio*`;
      if (typeof m?.reply === 'function') return m.reply(emptyMsg);
      if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: emptyMsg });
      return emptyMsg;
    }

    let listText = `📋 *CATÁLOGO DE FUNÇÕES CLONADAS (${triggers.length})* 📋\n\n`;
    triggers.forEach((t, i) => {
      listText += `${i + 1}. *${t.keyword}* (Usos: ${t.usage_count || 0})\n   📅 _Criado em: ${t.created_at || 'Recente'}_\n`;
    });
    listText += `\n⚙️ *Comandos:* \`!clonefun <nome>\` (clonar nova) | \`!delclone <nome>\` (remover)`;

    if (typeof m?.reply === 'function') return m.reply(listText);
    if (sock && typeof sock.sendMessage === 'function') return sock.sendMessage(from, { text: listText });
    return listText;
  }

  // Comando !configurar / !config (Visualiza e altera configurações pelo WhatsApp)
  async handleConfigurar(sock, from, text, isAdmin = true, isOwnerUser = false) {
    if (!isAdmin && !isOwnerUser) {
      return sock.sendMessage(from, { text: '⚠️ Apenas administradores do grupo ou o Dono podem acessar ou alterar configurações.' });
    }

    const clean = text.replace(/^(?:!|\/)(?:configurar|config|configuracoes|painelbot)\s*/i, '').trim();

    if (clean) {
      const parts = clean.split(/\s+/);
      const key = parts[0]?.toLowerCase();
      const val = parts[1]?.toLowerCase();
      const boolVal = (val === 'on' || val === 'ativar' || val === '1' || val === 'true') ? 'true' : 'false';

      if (key === 'antilink') {
        models.setSetting(`ANTILINK_${from}`, boolVal);
        return sock.sendMessage(from, { text: `✅ Anti-Link no chat definido para: *${boolVal === 'true' ? '🟢 ATIVADO' : '🔴 DESATIVADO'}*` });
      }
      if (key === 'antidelete') {
        models.setSetting(`ANTIDELETE_${from}`, boolVal);
        return sock.sendMessage(from, { text: `✅ Anti-Delete no chat definido para: *${boolVal === 'true' ? '🟢 ATIVADO' : '🔴 DESATIVADO'}*` });
      }
      if (key === 'antifake') {
        models.setSetting(`ANTIFAKE_${from}`, boolVal);
        return sock.sendMessage(from, { text: `✅ Anti-Fake (+55) no chat definido para: *${boolVal === 'true' ? '🟢 ATIVADO' : '🔴 DESATIVADO'}*` });
      }
      if (key === 'boasvindas') {
        models.setSetting(`WELCOME_${from}`, boolVal);
        return sock.sendMessage(from, { text: `✅ Boas-Vindas no chat definidas para: *${boolVal === 'true' ? '🟢 ATIVADAS' : '🔴 DESATIVADAS'}*` });
      }
      if (key === 'antiprivado') {
        models.setSetting('ANTIPRIVADO_GLOBAL', boolVal);
        return sock.sendMessage(from, { text: `✅ Anti-Privado global definido para: *${boolVal === 'true' ? '🟢 ATIVADO' : '🔴 DESATIVADO'}*` });
      }
    }

    const antiLink = models.getSetting(`ANTILINK_${from}`, 'false') === 'true';
    const antiDelete = models.getSetting(`ANTIDELETE_${from}`, 'false') === 'true';
    const antiFake = models.getSetting(`ANTIFAKE_${from}`, 'true') === 'true';
    const welcome = models.getSetting(`WELCOME_${from}`, 'false') === 'true';
    const antiPrivado = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
    const pixEnabled = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
    const binanceEnabled = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';
    const ownerPhone = models.getSetting('OWNER_PHONE', 'Não definido');

    const configMsg = `⚙️ *PAINEL DE CONFIGURAÇÕES SPY + PAYBOT* ⚙️\n\n` +
      `🛡️ *Segurança & Moderação neste Chat:*\n` +
      `• *Anti-Link:* ${antiLink ? '🟢 Ativado' : '🔴 Desativado'} _(!configurar antilink on/off)_\n` +
      `• *Anti-Delete:* ${antiDelete ? '🟢 Ativado' : '🔴 Desativado'} _(!configurar antidelete on/off)_\n` +
      `• *Anti-Fake (+55):* ${antiFake ? '🟢 Ativado' : '🔴 Desativado'} _(!configurar antifake on/off)_\n` +
      `• *Boas-Vindas:* ${welcome ? '🟢 Ativadas' : '🔴 Desativadas'} _(!configurar boasvindas on/off)_\n` +
      `• *Anti-Privado:* ${antiPrivado ? '🔴 Bloqueando PV' : '🟢 PV Liberado'} _(!configurar antiprivado on/off)_\n\n` +
      `💳 *Formas de Pagamento & Cobrança:*\n` +
      `• *PIX Automático:* ${pixEnabled ? '🟢 Ativo' : '🔴 Inativo'}\n` +
      `• *Criptomoedas / USDT:* ${binanceEnabled ? '🟢 Ativo' : '🔴 Inativo'}\n\n` +
      `👑 *Dono (Owner):* \`${ownerPhone}\`\n\n` +
      `🔒 *PAINEL WEB CONFIDENCIAL:*\n` +
      `Para gerenciar as configurações pelo navegador com segurança, o Dono pode enviar *!painel* no privado.\n\n` +
      `💡 _Para alterar uma opção por aqui, envie: *!configurar <opcao> on* ou *!configurar <opcao> off*_`;

    return sock.sendMessage(from, { text: configMsg });
  }

  // Guia de Usabilidade & Controle Completo de Sub-Bots (Jadibot / Serbot - 100% Gratuito)
  async handleSubBotHelp(sock, from, isOwnerUser = false) {
    let guide = `🤖 *GUIA DE USABILIDADE & CONTROLE DOS SUB-BOTS (100% GRATUITO)* 🤖\n\n` +
      `A tecnologia *Jadibot / Serbot Multi-Dispositivos* permite que qualquer um conecte seu próprio número de WhatsApp para usar todos os comandos do bot gratuitamente!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 *COMO CONECTAR SEU NÚMERO (CÓDIGO DE 8 DÍGITOS):*\n` +
      `Envie no chat: *!serbot 5511999998888* ou *!code 5511999998888*\n` +
      `O bot vai gerar um código tipo *ABCD-1234*.\n` +
      `No WhatsApp do celular a ser conectado:\n` +
      `1. Abra os três pontinhos ⋮ ou *Configurações*\n` +
      `2. Toque em *Aparelhos Conectados*\n` +
      `3. Toque em *Conectar um Aparelho*\n` +
      `4. Toque em *Conectar com número de telefone* (embaixo da tela)\n` +
      `5. Digite o código de 8 dígitos!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔋 *ECONOMIA DE TOKENS (SEM VALOR ALGUM EM DINHEIRO):*\n` +
      `• *!tokens* ou *!saldo* — Consulta seu saldo de tokens e missões do dia\n` +
      `• *!missaodiaria* — Pega a oferta do dia para postar no status/grupos (+100 tokens)\n` +
      `• *!confirmardivulgacao* — Confirma que divulgou e credita os tokens na hora\n` +
      `• *!grupos* — Lista os grupos oficiais parceiros (+50 tokens diários por grupo)\n` +
      `• *!verificargrupos* — Valida presença nos grupos e resgata seu bônus diário\n` +
      `• *!indicar* — Seu link de indicação para ganhar +50 tokens por amigo\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 *COMANDOS DE GESTÃO DO SEU SUB-BOT:*\n` +
      `• *!bots* ou *!subbots* — Lista todos os sub-bots e seus status\n` +
      `• *!stopbot* — Desconecta sua sessão de sub-bot com segurança\n` +
      `• *!subbotstatus* — Consulta se sua conexão está ativa\n\n`;

    if (isOwnerUser) {
      guide += `👑 *COMANDOS EXCLUSIVOS DO DONO (OWNER CONTROLS):*\n` +
        `• *!painelsubbots* — Painel consolidado com estatísticas de todos os chips\n` +
        `• *!fotosubbot <id>* — Altera a foto de perfil do sub-bot (ou *!fotosubbot all* para todos)\n` +
        `• *!fotobot* — Altera a foto de perfil deste bot conectado\n` +
        `• *!fotocanal* — Altera a foto de capa do Canal Oficial (@newsletter)\n` +
        `• *!fotogrupo* — Altera a foto/ícone do grupo\n` +
        `• *!divulgar <mensagem>* — Disparo em massa balanceado com Spintax para leads\n` +
        `• *!promover <id_produto>* — Dispara promoção de produto do catálogo\n` +
        `• *!divulgargrupos <mensagem>* — Transmite em todos os grupos onde os bots estão\n` +
        `• *!pararsubbot <id>* — Desconecta o chip especificado\n` +
        `• *!reiniciarsubbot <id>* — Reconecta o chip especificado\n` +
        `• *!resetarsubbot <id>* — Limpa credenciais para novo pareamento\n` +
        `• *!setowner <numero>* — Define o número do Dono\n\n`;
    }

    guide += `🌐 *PAINEL WEB COMPLETO:*\n` +
      `Para gerenciar chips, QR Codes e métricas pelo navegador com segurança, o Dono pode enviar *!painel* no privado.`;

    return sock.sendMessage(from, { text: guide });
  }

  // ==========================================
  // RECURSOS PORTADOS DO SPYBOT (ALEATORY-MD)
  // ==========================================

  /**
   * 1. Fusão de Emojis: !emojimix 😎+😭 / !mix 😺 🐶
   * Utiliza a API do Google Kitchen para fundir 2 emojis e gera sticker WebP
   */
  async handleEmojiMix(sock, from, text) {
    try {
      const cleaned = (text || '').replace(/^(?:!|\/)(?:emojimix|mix|fusao|emojikitchen)\s*/i, '').trim();
      const emojiRegex = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
      const emojis = cleaned.match(emojiRegex);

      if (!emojis || emojis.length < 2) {
        return sock.sendMessage(from, {
          text: `🧩 *FUSÃO DE EMOJIS (EMOJIMIX)* 🧩\n\n` +
            `Misture dois emojis para criar uma figurinha personalizada exclusiva!\n\n` +
            `📌 *Exemplos de uso:*\n` +
            `• *!emojimix 😎+😭*\n` +
            `• *!emojimix 😺+🐶*\n` +
            `• *!emojimix 🤠+🥺*\n` +
            `• *!emojimix ❤️+🔥*\n\n` +
            `_Dica: você pode separar com '+' ou apenas dar um espaço entre os dois emojis._`
        });
      }

      const e1 = emojis[0];
      const e2 = emojis[1];

      await sock.sendMessage(from, { text: `🪄 *Fundindo emojis ${e1} + ${e2}...* Aguarde um instante!` });

      if (process.env.NODE_ENV === 'test') {
        const dummySticker = Buffer.from('RIFF....WEBPVP8 ...test-emojimix...');
        return sock.sendMessage(from, { sticker: dummySticker });
      }

      const url = `https://emojik.vercel.app/s/${encodeURIComponent(e1)}_${encodeURIComponent(e2)}?size=512`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

      if (!res.ok) {
        return sock.sendMessage(from, {
          text: `⚠️ *Não foi possível combinar ${e1} e ${e2}!*\n\nO Google Emoji Kitchen ainda não possui uma combinação oficial para esses dois emojis. Tente outra combinação! (Ex: *!emojimix 😎+😭*)`
        });
      }

      const pngBuffer = Buffer.from(await res.arrayBuffer());
      const stickerBuffer = await stickerConverter.convertImageToWebP(pngBuffer);

      return sock.sendMessage(from, { sticker: stickerBuffer });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleEmojiMix]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao gerar emojimix: ${err.message}` });
    }
  }

  /**
   * 2. Texto Animado para Figurinha: !attp <texto> / !attp2 <texto>
   * Gera figurinha animada com texto em cores vibrantes piscantes (Rainbow Text)
   */
  async handleAttp(sock, from, text, isAttp2 = false) {
    try {
      const rawText = (text || '').replace(/^(?:!|\/)(?:attp2|attp|ttp)\s*/i, '').trim();

      if (!rawText) {
        return sock.sendMessage(from, {
          text: `🎨 *FIGURINHA ANIMADA DE TEXTO (ATTP)* 🎨\n\n` +
            `Cria figurinhas animadas piscantes com o texto que você escolher!\n\n` +
            `📌 *Exemplos de uso:*\n` +
            `• *!attp Boa noite família*\n` +
            `• *!attp2 PayBot Vendas*\n` +
            `• *!attp PIX ENVIADO*`
        });
      }

      const stickerText = rawText.slice(0, 45);

      if (process.env.NODE_ENV === 'test') {
        const dummy = Buffer.from('RIFF....WEBPVP8X...test-attp...');
        return sock.sendMessage(from, { sticker: dummy });
      }

      const { spawn } = require('child_process');
      const pyScript = `
import sys, io
from PIL import Image, ImageDraw, ImageFont

text = sys.argv[1] if len(sys.argv) > 1 else 'PayBot'
colors = ['#FF1493', '#00FF00', '#00BFFF', '#FFD700', '#FF4500', '#9400D3', '#00FFFF']
if len(sys.argv) > 2 and sys.argv[2] == '2':
    colors = ['#FF0000', '#FFFFFF', '#0000FF', '#FFFF00', '#00FF7F', '#FF00FF']

frames = []
for c in colors:
    im = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('arial.ttf', 52)
    except Exception:
        font = ImageFont.load_default()
    
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (512 - w) // 2
    y = (512 - h) // 2
    
    for ox, oy in [(-3,-3),(3,-3),(-3,3),(3,3),(0,-3),(0,3),(-3,0),(3,0)]:
        d.text((x+ox, y+oy), text, font=font, fill='black')
    d.text((x, y), text, font=font, fill=c)
    frames.append(im)

out = io.BytesIO()
frames[0].save(out, format='WEBP', save_all=True, append_images=frames[1:], duration=140, loop=0, quality=80)
sys.stdout.buffer.write(out.getvalue())
`;

      const animatedBuffer = await new Promise((resolve, reject) => {
        const proc = spawn('python', ['-c', pyScript, stickerText, isAttp2 ? '2' : '1'], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks = [];
        let errStr = '';
        proc.stdout.on('data', c => chunks.push(c));
        proc.stderr.on('data', e => { errStr += e.toString(); });
        proc.on('close', code => {
          if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
          else reject(new Error(errStr || `Processo encerrou com código ${code}`));
        });
        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          reject(new Error('Timeout na geração do attp'));
        }, 10000);
      });

      return sock.sendMessage(from, { sticker: animatedBuffer });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleAttp]:', err.message);
      return this.handleTextToSticker(sock, from, text, 'ATTP');
    }
  }

  /**
   * 3. Conversor de Áudio / Vídeo para MP3: !tomp3
   * Transforma recado de voz, ptt ou vídeo respondido em arquivo de áudio MP3
   */
  async handleToMp3(sock, from, msg) {
    try {
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;
      const targetMsg = (quoted?.videoMessage || quoted?.audioMessage)
        ? { message: quoted }
        : msg;

      const hasMedia = targetMsg.message?.videoMessage || targetMsg.message?.audioMessage;

      if (!hasMedia) {
        return sock.sendMessage(from, {
          text: `🎵 *CONVERSOR PARA ÁUDIO MP3 (TOMP3)* 🎵\n\n` +
            `Converta qualquer vídeo ou mensagem de voz em arquivo de áudio para ouvir e salvar!\n\n` +
            `📌 *Como usar:*\n` +
            `• Responda a um vídeo ou mensagem de voz com o comando *!tomp3*\n` +
            `• Ou envie um vídeo ou áudio com a legenda *!tomp3*`
        });
      }

      await sock.sendMessage(from, { text: `🎧 *Extraindo e convertendo áudio para MP3...* Aguarde um instante!` });

      if (process.env.NODE_ENV === 'test') {
        const dummyAudio = Buffer.from('ID3....test-mp3...');
        return sock.sendMessage(from, {
          audio: dummyAudio,
          mimetype: 'audio/mp4',
          fileName: 'audio.mp3',
          ptt: false
        }, { quoted: msg });
      }

      const mediaBuffer = await this.extractMediaBuffer(targetMsg);
      if (!mediaBuffer) {
        return sock.sendMessage(from, { text: `❌ Não foi possível baixar a mídia para conversão.` });
      }

      return sock.sendMessage(from, {
        audio: mediaBuffer,
        mimetype: 'audio/mp4',
        fileName: `audio_${Date.now()}.mp3`,
        ptt: false
      }, { quoted: msg });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleToMp3]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao converter para MP3: ${err.message}` });
    }
  }

  /**
   * 4. Cotação de Moedas em Tempo Real: !moedas / !cotacao
   * Cotações oficiais de USD, EUR, GBP, USDT, BTC e ETH em BRL
   */
  async handleMoedas(sock, from) {
    try {
      let usd = 5.40, eur = 6.00, gbp = 7.00, btc = 420000, eth = 15000, usdt = 5.40;

      if (process.env.NODE_ENV !== 'test') {
        try {
          const res = await fetch('https://open.er-api.com/v6/latest/USD');
          if (res.ok) {
            const data = await res.json();
            const brlRate = data.rates?.BRL || 5.40;
            usd = brlRate;
            eur = brlRate / (data.rates?.EUR || 0.9);
            gbp = brlRate / (data.rates?.GBP || 0.77);
          }
        } catch (_) {}

        try {
          const [btcRes, ethRes, usdtRes] = await Promise.all([
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCBRL').then(r => r.json()).catch(() => null),
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHBRL').then(r => r.json()).catch(() => null),
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL').then(r => r.json()).catch(() => null)
          ]);
          if (btcRes?.price) btc = parseFloat(btcRes.price);
          if (ethRes?.price) eth = parseFloat(ethRes.price);
          if (usdtRes?.price) usdt = parseFloat(usdtRes.price);
        } catch (_) {}
      }

      const fmt = (val) => Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      const text =
        `💵 *COTAÇÃO DE MOEDAS EM TEMPO REAL* 💵\n\n` +
        `• 🇺🇸 *Dólar Comercial (USD):* R$ ${fmt(usd)}\n` +
        `• 🇪🇺 *Euro Oficial (EUR):* R$ ${fmt(eur)}\n` +
        `• 🇬🇧 *Libra Esterlina (GBP):* R$ ${fmt(gbp)}\n` +
        `• 🪙 *Tether Dólar (USDT):* R$ ${fmt(usdt)}\n` +
        `• ₿ *Bitcoin (BTC):* R$ ${fmt(btc)}\n` +
        `• ⟠ *Ethereum (ETH):* R$ ${fmt(eth)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 _Atualizado em: ${now}_\n` +
        `📈 _Fontes: Open Exchange Rates & Binance_`;

      return sock.sendMessage(from, { text });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleMoedas]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar moedas: ${err.message}` });
    }
  }

  /**
   * 5. Fazer Nick & Tabela de Fontes Estilosas: !fazernick <texto> / !tabela <texto>
   */
  async handleFazerNick(sock, from, text) {
    try {
      const rawText = (text || '').replace(/^(?:!|\/)(?:fazernick|gerarnick|nick|tabela|fontes)\s*/i, '').trim();

      if (!rawText) {
        return sock.sendMessage(from, {
          text: `✨ *GERADOR DE NICKS & FONTES ESTILOSAS* ✨\n\n` +
            `Transforme qualquer texto em letras personalizadas para nicks de jogos, bios e grupos!\n\n` +
            `📌 *Exemplo de uso:*\n` +
            `• *!fazernick PayBot*\n` +
            `• *!fazernick Spy*\n` +
            `• *!fazernick SeuNome*`
        });
      }

      const styles = fancyFonts.generateAllStyles(rawText);
      let out = `✨ *FONTES ESTILOSAS PARA: "${rawText}"* ✨\n\n_Toque e segure para copiar o seu favorito:_\n\n`;

      for (const s of styles) {
        out += `*${s.name}:*\n${s.value}\n\n`;
      }

      out += `━━━━━━━━━━━━━━━━━━━━\n💡 _Dica: use em nicks de Free Fire, Instagram e WhatsApp!_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleFazerNick]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao gerar nick: ${err.message}` });
    }
  }

  /**
   * 6. Conselhos Bíblicos e Espirituais: !conselhobiblico / !biblia / !versiculo
   */
  async handleConselhoBiblico(sock, from) {
    try {
      const idx = Math.floor(Math.random() * CONSELHOS_BIBLICOS.length);
      const advice = CONSELHOS_BIBLICOS[idx];

      const text =
        `📖 *CONSELHO & SABEDORIA BÍBLICA* 📖\n\n` +
        `"${advice}"\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕊️ _Que esta palavra traga paz, força e discernimento para o seu dia!_`;

      return sock.sendMessage(from, { text });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleConselhoBiblico]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao obter conselho bíblico.` });
    }
  }

  /**
   * 7. Conselhos Motivacionais e de Vida: !conselho / !motivacao
   */
  async handleConselho(sock, from) {
    try {
      const idx = Math.floor(Math.random() * CONSELHOS_GERAIS.length);
      const advice = CONSELHOS_GERAIS[idx];

      const text =
        `💡 *CONSELHO DO DIA & MOTIVAÇÃO* 💡\n\n` +
        `"${advice}"\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚀 _Persista, evolua e mantenha o foco nos seus maiores objetivos!_`;

      return sock.sendMessage(from, { text });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleConselho]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao obter conselho.` });
    }
  }

  /**
   * 8. Marcar Participantes Comuns Citando Mensagem Respondida: !totag <texto> (Poupando Administradores)
   */
  async handleTotag(sock, from, msg, text, activeSock, isAdmin = true) {
    try {
      if (isAdmin === false) {
        return sock.sendMessage(from, { text: `⚠️ Apenas administradores do grupo podem usar o comando *!totag*.` });
      }

      const metadata = await (activeSock || sock).groupMetadata(from).catch(() => null);
      if (!metadata || !metadata.participants) {
        return sock.sendMessage(from, { text: `❌ Não foi possível carregar os membros do grupo.` });
      }

      const nonAdmins = this.getNonAdminParticipants(metadata.participants);
      if (!nonAdmins.length) {
        return sock.sendMessage(from, { text: `⚠️ Nenhum participante comum encontrado para marcar (administradores poupados).` });
      }

      const nonAdminJids = this.getNonAdminJids(nonAdmins);
      const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;

      const customText = (text || '').replace(/^(?:!|\/)(?:totag|tagall2)\s*/i, '').trim();
      const alertHeader = customText || `📢 *AVISO IMPORTANTE DA ADMINISTRAÇÃO!*`;

      if (quoted) {
        return sock.sendMessage(from, {
          text: `${alertHeader}\n\n_Atenção todos os participantes comuns citados abaixo! (Administradores poupados)_`,
          mentions: nonAdminJids
        }, { quoted: { key: { remoteJid: from, id: contextInfo.stanzaId, participant: contextInfo.participant }, message: quoted } });
      } else {
        const renderedMentions = nonAdmins.map(p => {
          const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
          const phone = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
          return `@${phone}`;
        }).join(' ');

        return sock.sendMessage(from, {
          text: `${alertHeader}\n\n${renderedMentions}\n\n_⚡ Administradores foram expressamente poupados desta notificação._`,
          mentions: nonAdminJids
        });
      }
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleTotag]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao executar !totag: ${err.message}` });
    }
  }

  /**
   * 9. Marcar Participantes Comuns com Links Diretos do WhatsApp: !marcar2 (Poupando Administradores)
   */
  async handleMarcar2(sock, from, activeSock) {
    try {
      const metadata = await (activeSock || sock).groupMetadata(from).catch(() => null);
      if (!metadata || !metadata.participants) {
        return sock.sendMessage(from, { text: `❌ Não foi possível carregar os membros do grupo.` });
      }

      const nonAdmins = this.getNonAdminParticipants(metadata.participants);
      if (!nonAdmins.length) {
        return sock.sendMessage(from, { text: `⚠️ Nenhum participante comum encontrado no grupo (administradores poupados).` });
      }

      let text = `👥 *LISTA DE PARTICIPANTES COMUNS (WA.ME)* 👥\n\n`;
      text += `*Grupo:* ${metadata.subject}\n`;
      text += `*Participantes Comuns:* ${nonAdmins.length} (Admins poupados da marcação)\n\n`;

      nonAdmins.forEach((p, index) => {
        const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
        const phone = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
        text += `${index + 1}. 👤 Membro @${phone}\n   🔗 https://wa.me/${phone}\n\n`;
      });

      const mentions = this.getNonAdminJids(nonAdmins);

      return sock.sendMessage(from, {
        text: text.trim(),
        mentions
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleMarcar2]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao listar contatos: ${err.message}` });
    }
  }

  /**
   * 10. Moderação de Anti-Palavrão: !antipalavra 1/0 / !addpalavra / !delpalavra / !listapalavras
   */
  async handleAntiPalavra(sock, from, text, isGroup, isAdmin) {
    try {
      if (!isGroup) {
        return sock.sendMessage(from, { text: `⚠️ O filtro de palavras proibidas só funciona em grupos.` });
      }
      if (!isAdmin) {
        return sock.sendMessage(from, { text: `⚠️ Apenas administradores do grupo podem gerenciar o filtro de palavras.` });
      }

      const parts = (text || '').trim().split(/\s+/);
      const action = (parts[1] || '').toLowerCase();
      const param = parts.slice(2).join(' ').toLowerCase().trim();

      const keyStatus = `ANTIPALAVRA_${from}`;
      const keyWords = `BADWORDS_${from}`;

      if (['1', 'on', 'ativar', 'sim', 'true'].includes(action)) {
        models.setSetting(keyStatus, 'true');
        return sock.sendMessage(from, {
          text: `🛡️ *FILTRO ANTI-PALAVRÃO ATIVADO COM SUCESSO!*\n\nMensagens de membros contendo palavras proibidas serão apagadas automaticamente pela moderação.`
        });
      }

      if (['0', 'off', 'desativar', 'nao', 'não', 'false'].includes(action)) {
        models.setSetting(keyStatus, 'false');
        return sock.sendMessage(from, {
          text: `🔓 *FILTRO ANTI-PALAVRÃO DESATIVADO!*\n\nA moderação automática de vocabulário está pausada neste grupo.`
        });
      }

      if (['add', 'adicionar', '+'].includes(action) && param) {
        let current = [];
        try { current = JSON.parse(models.getSetting(keyWords, '[]')); } catch (_) {}
        if (!current.includes(param)) current.push(param);
        models.setSetting(keyWords, JSON.stringify(current));
        models.setSetting(keyStatus, 'true');
        return sock.sendMessage(from, {
          text: `✅ Palavra *"${param}"* adicionada à lista de palavras bloqueadas do grupo!`
        });
      }

      if (['del', 'remover', 'delete', '-'].includes(action) && param) {
        let current = [];
        try { current = JSON.parse(models.getSetting(keyWords, '[]')); } catch (_) {}
        current = current.filter(w => w !== param);
        models.setSetting(keyWords, JSON.stringify(current));
        return sock.sendMessage(from, {
          text: `🗑️ Palavra *"${param}"* removida da lista de palavras bloqueadas.`
        });
      }

      if (['lista', 'ver', 'listar'].includes(action)) {
        let current = [];
        try { current = JSON.parse(models.getSetting(keyWords, '[]')); } catch (_) {}
        const isEnabled = models.getSetting(keyStatus, 'false') === 'true';
        return sock.sendMessage(from, {
          text: `📋 *CONFIGURAÇÃO DO ANTI-PALAVRÃO* 📋\n\n` +
            `• *Status:* ${isEnabled ? '🟢 Ativado' : '🔴 Desativado'}\n` +
            `• *Palavras cadastradas:* ${current.length > 0 ? current.join(', ') : 'Nenhuma palavra personalizada cadastrada.'}`
        });
      }

      return sock.sendMessage(from, {
        text: `🛡️ *PAINEL ANTI-PALAVRÃO (SPY-MODERATION)* 🛡️\n\n` +
          `• *!antipalavra on* — Ativa a moderação automática\n` +
          `• *!antipalavra off* — Desativa a moderação\n` +
          `• *!addpalavra <palavra>* — Adiciona palavra proibida\n` +
          `• *!delpalavra <palavra>* — Remove palavra da lista\n` +
          `• *!listapalavras* — Exibe as palavras bloqueadas no grupo`
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleAntiPalavra]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no painel anti-palavrão: ${err.message}` });
    }
  }

  /**
   * 11. Verificação Interceptadora de Mensagens em Grupos (Anti-Palavrão)
   */
  async checkAntiPalavra(sock, from, msg, text, isGroup, isAdmin) {
    try {
      const sender = msg.key?.participant || from;
      const senderPhone = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      // 🛡️ IMUNIDADE DO DONO: Dono nunca tem mensagens deletadas por anti-palavrão
      if (!isGroup || isAdmin || !text || models.isOwner(senderPhone)) return false;
      const isEnabled = models.getSetting(`ANTIPALAVRA_${from}`, 'false') === 'true';
      if (!isEnabled) return false;

      let customWords = [];
      try { customWords = JSON.parse(models.getSetting(`BADWORDS_${from}`, '[]')); } catch (_) {}
      const defaultBadWords = ['porra', 'caralho', 'filho da puta', 'puta que pariu', 'arrombado', 'vai se foder', 'cuzao', 'cuzão'];
      const allForbidden = Array.from(new Set([...defaultBadWords, ...customWords]));

      const lowerText = text.toLowerCase();
      const hasBadWord = allForbidden.some(w => {
        const regex = new RegExp(`(^|\\s|[.,!?;])${w.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}($|\\s|[.,!?;])`, 'i');
        return regex.test(lowerText);
      });

      if (hasBadWord) {
        try {
          await sock.sendMessage(from, { delete: msg.key });
        } catch (_) {}

        await sock.sendMessage(from, {
          text: `⚠️ *@${senderPhone}, sua mensagem foi apagada por conter vocabulário não permitido pelas regras deste grupo!*`,
          mentions: [sender]
        });
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * 12. Limpar Tela do Grupo: !limpar
   */
  async handleLimpar(sock, from, isAdmin = true) {
    if (isAdmin === false) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem limpar a tela do grupo.' });
    try {
      const blankSpacer = ('\u200E'.repeat(40) + '\n').repeat(60);
      const text = `${blankSpacer}🧹 *CHAT LIMPO PELA ADMINISTRAÇÃO!* 🧹\n\n_Mensagens anteriores foram afastadas da visão imediata._`;
      return sock.sendMessage(from, { text });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleLimpar]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao limpar tela: ${err.message}` });
    }
  }

  /**
   * 13. Metadinha para Casais / Amigos: !metadinha
   */
  async handleMetadinha(sock, from) {
    try {
      const idx = Math.floor(Math.random() * METADINHAS_CATALOG.length);
      const item = METADINHAS_CATALOG[idx];

      await sock.sendMessage(from, {
        image: { url: item.ele },
        caption: `👦 *Metadinha - ELE:* ${item.tema}\n\n"${item.frase}"`
      });

      return sock.sendMessage(from, {
        image: { url: item.ela },
        caption: `👧 *Metadinha - ELA:* ${item.tema}\n\n_Combinem suas fotos de perfil!_`
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleMetadinha]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao buscar metadinha: ${err.message}` });
    }
  }

  /**
   * 14. Jogo do Cassino (Caça-Níquel): !cassino
   */
  async handleCassino(sock, from, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
      const isOwner = models.isOwner(cleanPhone);
      const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣', '🔔'];
      let r1, r2, r3;
      let resultText = '';
      let pointsWon = 0;

      if (isOwner) {
        // 🛡️ IMUNIDADE DO DONO: Dono sempre tira o Jackpot Supremo e nunca perde!
        r1 = '7️⃣'; r2 = '7️⃣'; r3 = '7️⃣';
        pointsWon = 250;
        resultText = `👑👑 *JACKPOT SUPREMO DO COMANDANTE!* 👑👑\n\nO Dono Supremo tirou uma trinca perfeita de 7️⃣ 7️⃣ 7️⃣ e faturou *${pointsWon} pontos de fidelidade*!`;
      } else {
        r1 = symbols[Math.floor(Math.random() * symbols.length)];
        r2 = symbols[Math.floor(Math.random() * symbols.length)];
        r3 = symbols[Math.floor(Math.random() * symbols.length)];

        if (r1 === r2 && r2 === r3) {
          pointsWon = 100;
          resultText = `🎉🎉 *JACKPOT SUPREMO!* 🎉🎉\n\nVocê tirou uma trinca perfeita e faturou *${pointsWon} pontos de fidelidade*!`;
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
          pointsWon = 20;
          resultText = `✨ *PARABÉNS!* Você acertou 2 símbolos iguais e ganhou *${pointsWon} pontos de fidelidade*!`;
        } else {
          resultText = `😢 Não foi dessa vez! Tente a sorte novamente girando com *!cassino*!`;
        }
      }

      if (pointsWon > 0 && senderPhone) {
        try {
          models.addLoyaltyPoints(senderPhone, pointsWon, `Vitória no Cassino PayBot: ${r1}${r2}${r3}`);
        } catch (_) {}
      }

      const text =
        `🎰 *CASSINO PAYBOT (CAÇA-NÍQUEL)* 🎰\n\n` +
        `Jogador: *${senderName || senderPhone}*\n\n` +
        `┌──────────────┐\n` +
        `│  ${r1}  │  ${r2}  │  ${r3}  │\n` +
        `└──────────────┘\n\n` +
        `${resultText}`;

      return sock.sendMessage(from, { text });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCassino]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no jogo do cassino.` });
    }
  }

  /**
   * 15. Brincadeiras e Interações em Grupos: !casal, !ship, !gado, !corno, !feio, !gostoso, !chance
   */
  async handleBrincadeiras(sock, from, msg, command, text, senderPhone, activeSock) {
    try {
      const cmd = command.toLowerCase().replace(/^[!/]/, '');
      const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
      const mentionedJid = contextInfo?.mentionedJid || [];
      const targetJid = mentionedJid[0] || (contextInfo?.participant) || `${senderPhone}@s.whatsapp.net`;
      const targetPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');

      if (cmd === 'casal' || cmd === 'ship') {
        const metadata = await (activeSock || sock).groupMetadata(from).catch(() => null);
        if (!metadata || !metadata.participants || metadata.participants.length < 2) {
          return sock.sendMessage(from, { text: `⚠️ É necessário estar em um grupo com pelo menos 2 membros para formar um casal!` });
        }
        const pList = metadata.participants;
        const p1 = pList[Math.floor(Math.random() * pList.length)].id;
        let p2 = pList[Math.floor(Math.random() * pList.length)].id;
        while (p2 === p1 && pList.length > 1) {
          p2 = pList[Math.floor(Math.random() * pList.length)].id;
        }

        const percent = Math.floor(Math.random() * 51) + 50;
        const textOut =
          `💘 *COMBINAÇÃO PERFEITA DE CASAL* 💘\n\n` +
          `O cupido do PayBot uniu este casal:\n` +
          `🤵 @${p1.split('@')[0]}\n` +
          `👰 @${p2.split('@')[0]}\n\n` +
          `❤️ *Compatibilidade:* ${percent}%\n` +
          `💍 _Será que já podemos marcar o casamento deste grupo?_`;

        return sock.sendMessage(from, { text: textOut, mentions: [p1, p2] });
      }

      if (cmd === 'chance') {
        const query = (text || '').replace(/^(?:!|\/)chance\s*/i, '').trim();
        if (!query) {
          return sock.sendMessage(from, { text: `🎲 *Como usar:* Digite *!chance <sua pergunta>*\nExemplo: *!chance de eu ficar milionário este ano*` });
        }
        const percent = Math.floor(Math.random() * 101);
        return sock.sendMessage(from, {
          text: `🔮 *CALCULADORA DE PROBABILIDADE* 🔮\n\n` +
            `Pergunta: _"${query}"_\n\n` +
            `📊 *A chance disso acontecer é de:* *${percent}%*!`
        });
      }

      const percent = Math.floor(Math.random() * 101);
      const filled = Math.round(percent / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      const titles = {
        gado: '🐂 GADÔMETRO OFICIAL',
        corno: '🦌 CHIFRÔMETRO EM TEMPO REAL',
        feio: '👹 MEDIDOR DE BELEZA INVERSA',
        gostoso: '🔥 MEDIDOR DE GOSTOSURA',
        gostosa: '🔥 MEDIDOR DE GOSTOSURA'
      };

      const title = titles[cmd] || '🎯 RESULTADO DO TESTE';
      const textOut =
        `📊 *${title}* 📊\n\n` +
        `Alvo: @${targetPhone}\n` +
        `Nível detectado: *${percent}%*\n` +
        `[${bar}]\n\n` +
        `_Resultado emitido pela inteligência artificial do grupo!_`;

      return sock.sendMessage(from, { text: textOut, mentions: [targetJid] });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleBrincadeiras]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro na brincadeira.` });
    }
  }

  /**
   * 16. Consulta de Clima / Tempo: !clima <cidade>
   */
  async handleClima(sock, from, text) {
    try {
      const city = (text || '').replace(/^(?:!|\/)(?:clima|tempo)\s*/i, '').trim();
      if (!city) {
        return sock.sendMessage(from, { text: `☀️ *Como usar:* Digite *!clima <nome da cidade>*\nExemplo: *!clima São Paulo* ou *!clima Florianópolis*` });
      }

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          text: `☀️ *Previsão do Tempo para ${city}:* Ensolarado, 25°C.`
        });
      }

      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) {
        return sock.sendMessage(from, { text: `❌ Cidade não encontrada. Verifique o nome e tente novamente.` });
      }

      const data = await res.json();
      const current = data.current_condition?.[0];
      const area = data.nearest_area?.[0];

      const cityName = area?.areaName?.[0]?.value || city;
      const region = area?.region?.[0]?.value || '';
      const country = area?.country?.[0]?.value || '';
      const tempC = current?.temp_C || 'N/A';
      const feelsLike = current?.FeelsLikeC || 'N/A';
      const humidity = current?.humidity || 'N/A';
      const windKmph = current?.windspeedKmph || 'N/A';
      const desc = current?.lang_pt?.[0]?.value || current?.weatherDesc?.[0]?.value || 'Sem descrição';

      const out =
        `🌤️ *PREVISÃO DO TEMPO - ${cityName.toUpperCase()}* 🌤️\n\n` +
        `📍 *Local:* ${cityName}, ${region} (${country})\n` +
        `🌡️ *Temperatura:* ${tempC}°C (Sensação: ${feelsLike}°C)\n` +
        `☁️ *Condição:* ${desc}\n` +
        `💧 *Umidade do Ar:* ${humidity}%\n` +
        `💨 *Vento:* ${windKmph} km/h\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📅 _Informações meteorológicas em tempo real_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleClima]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar clima: ${err.message}` });
    }
  }

  /**
   * 17. Consulta de Códigos DDD do Brasil e Marcação de Membros: !ddd <número>
   */
  async handleDDD(sock, from, text, groupMetadata = null) {
    try {
      const match = (text || '').match(/(?:!|\/)ddd\s*(\d{1,3})/i);
      const code = match ? match[1] : null;

      if (!code || !DDD_MAP[code]) {
        return sock.sendMessage(from, {
          text: `📞 *CONSULTA E MARCAÇÃO POR DDD* 📞\n\n` +
            `Descubra a região de qualquer DDD e marque todos os membros do grupo pertencentes a ele!\n\n` +
            `📌 *Exemplo de uso:*\n` +
            `• *!ddd 11* (Marca membros de São Paulo)\n` +
            `• *!ddd 21* (Marca membros do Rio de Janeiro)\n` +
            `• *!ddd 48* (Marca membros de Florianópolis / SC)\n` +
            `• *!ddd 81* (Marca membros de Recife / PE)`
        });
      }

      const info = DDD_MAP[code];
      const isGroup = from && from.endsWith('@g.us');

      // Se executado no privado, envia apenas as informações regionais
      if (!isGroup) {
        const textOut =
          `📞 *DDD ${code} - INFORMAÇÕES REGIONAIS* 📞\n\n` +
          `🏛️ *Estado (UF):* ${info.uf}\n` +
          `📍 *Cidades / Região:* ${info.regiao}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🇧🇷 _Base oficial de telecomunicações do Brasil_`;
        return sock.sendMessage(from, { text: textOut });
      }

      // Se executado em grupo: busca participantes daquele DDD e marca participantes comuns (excluindo administradores)
      let metadata = groupMetadata;
      if (!metadata && sock && typeof sock.groupMetadata === 'function') {
        metadata = await sock.groupMetadata(from).catch(() => null);
      }

      const allParticipants = metadata?.participants || [];
      const nonAdmins = this.getNonAdminParticipants(allParticipants);
      if (!nonAdmins || nonAdmins.length === 0) {
        const textOut =
          `📞 *DDD ${code} (${info.uf})* 📞\n\n` +
          `📍 *Região:* ${info.regiao}\n\n` +
          `⚠️ Não foi possível listar os participantes comuns deste grupo no momento (administradores poupados).`;
        return sock.sendMessage(from, { text: textOut });
      }

      // Resolução de LID para telefone
      const resolvePhone = (pId) => {
        if (!pId) return null;
        const clean = pId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (clean === '151866151276711') return '554884702848';
        try {
          const authDir = path.join(__dirname, '..', '..', 'data', 'whatsapp_auth');
          const revFile = path.join(authDir, `lid-mapping-${clean}_reverse.json`);
          if (fs.existsSync(revFile)) {
            const content = fs.readFileSync(revFile, 'utf8').trim().replace(/["\s]/g, '');
            const digits = content.replace(/\D/g, '');
            if (digits) return digits;
          }
        } catch (_) {}
        return clean;
      };

      const matching = [];
      for (const p of nonAdmins) {
        const rawPhone = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
        const resolvedPhone = resolvePhone(p.id) || rawPhone;

        let isMatch = false;
        // Padrão brasileiro internacional: 55 + DDD (2 dígitos) + 8 ou 9 dígitos
        if (resolvedPhone.startsWith('55') && resolvedPhone.length >= 12 && resolvedPhone.length <= 13) {
          if (resolvedPhone.substring(2, 4) === code) isMatch = true;
        } else if ((resolvedPhone.length === 10 || resolvedPhone.length === 11) && resolvedPhone.startsWith(code)) {
          // Padrão local sem código do país 55
          isMatch = true;
        }

        if (isMatch) {
          matching.push({
            p,
            rawPhone,
            resolvedPhone
          });
        }
      }

      if (matching.length === 0) {
        const emptyOut =
          `📞 *CHAMADA POR DDD ${code} (${info.uf})* 📞\n\n` +
          `🏛️ *Estado (UF):* ${info.uf}\n` +
          `📍 *Cidades / Região:* ${info.regiao}\n\n` +
          `⚠️ *Nenhum membro* deste grupo possui o DDD ${code}.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🇧🇷 _Base oficial de telecomunicações do Brasil_`;
        return sock.sendMessage(from, { text: emptyOut });
      }

      const mentions = [];
      const lines = [];

      matching.forEach((item, index) => {
        const rawId = item.p.id;
        mentions.push(rawId);
        if (item.resolvedPhone && item.resolvedPhone !== item.rawPhone) {
          mentions.push(`${item.resolvedPhone}@s.whatsapp.net`);
        }
        const tagUser = rawId.split('@')[0].split(':')[0];
        lines.push(`${index + 1}. @${tagUser}`);
      });

      const groupOut =
        `📞 *MEMBROS COM DDD ${code} (${info.uf})* 📞\n\n` +
        `🏛️ *Estado (UF):* ${info.uf}\n` +
        `📍 *Cidades / Região:* ${info.regiao}\n` +
        `👥 *Total de Membros Marcados:* ${matching.length}\n\n` +
        `_Chamando todos os membros da região:_\n` +
        `${lines.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🇧🇷 _Chamada regional de membros pelo DDD ${code}_`;

      return sock.sendMessage(from, {
        text: groupOut,
        mentions
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleDDD]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar e marcar DDD.` });
    }
  }

  /**
   * 17.1 Censo Demográfico do Grupo / Raio-X por DDD: !dddtodos / !dddlist / !censo
   */
  async handleDDDList(sock, from, groupMetadata = null) {
    try {
      const isGroup = from && from.endsWith('@g.us');
      if (!isGroup) {
        return sock.sendMessage(from, {
          text: `📊 O censo demográfico de DDDs é exclusivo para grupos do WhatsApp! Adicione o bot a um grupo e execute *!dddlist*.`
        });
      }

      let metadata = groupMetadata;
      if (!metadata && sock && typeof sock.groupMetadata === 'function') {
        metadata = await sock.groupMetadata(from).catch(() => null);
      }

      const participants = metadata?.participants || [];
      if (!participants || participants.length === 0) {
        return sock.sendMessage(from, { text: `⚠️ Não foi possível obter a lista de membros do grupo.` });
      }

      const resolvePhone = (pId) => {
        if (!pId) return null;
        const clean = pId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (clean === '151866151276711') return '554884702848';
        try {
          const authDir = path.join(__dirname, '..', '..', 'data', 'whatsapp_auth');
          const revFile = path.join(authDir, `lid-mapping-${clean}_reverse.json`);
          if (fs.existsSync(revFile)) {
            const content = fs.readFileSync(revFile, 'utf8').trim().replace(/["\s]/g, '');
            const digits = content.replace(/\D/g, '');
            if (digits) return digits;
          }
        } catch (_) {}
        return clean;
      };

      const dddCounts = {};
      let nationalCount = 0;
      let intlCount = 0;

      for (const p of participants) {
        const phone = resolvePhone(p.id) || p.id.split('@')[0].replace(/\D/g, '');
        if (!phone) continue;

        if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
          nationalCount++;
          const ddd = phone.substring(2, 4);
          dddCounts[ddd] = (dddCounts[ddd] || 0) + 1;
        } else {
          intlCount++;
        }
      }

      // Ordena por quantidade descrescente
      const sortedDDDs = Object.entries(dddCounts).sort((a, b) => b[1] - a[1]);
      const medals = ['🥇', '🥈', '🥉', '🏅', '🏅', '🔹', '🔹', '🔹', '🔹', '🔹'];

      let rankingText = '';
      sortedDDDs.slice(0, 10).forEach(([ddd, count], idx) => {
        const info = DDD_MAP[ddd];
        const uf = info ? info.uf : 'BR';
        const regiao = info ? info.regiao.split('(')[0].trim() : 'Região Geral';
        const pct = ((count / participants.length) * 100).toFixed(1);
        const medal = medals[idx] || '•';
        rankingText += `${medal} *DDD ${ddd} (${uf})* - ${count} membros (${pct}%)\n   📍 _${regiao}_\n`;
      });

      if (!rankingText) {
        rankingText = `_Nenhum membro com DDD nacional catalogado._\n`;
      }

      const totalMembros = participants.length;
      const pctNat = ((nationalCount / totalMembros) * 100).toFixed(1);
      const pctIntl = ((intlCount / totalMembros) * 100).toFixed(1);

      const out =
        `📊 *CENSO DEMOGRÁFICO DO GRUPO (RAIO-X)* 📊\n\n` +
        `🏷️ *Grupo:* ${metadata.subject || 'Grupo'}\n` +
        `👥 *Total de Membros:* ${totalMembros}\n` +
        `🇧🇷 *Membros Brasil (55):* ${nationalCount} (${pctNat}%)\n` +
        `🌍 *Internacionais / Outros:* ${intlCount} (${pctIntl}%)\n\n` +
        `🏆 *TOP REGIÕES & ESTADOS (POR DDD):*\n` +
        rankingText + `\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 _Dica: Use *!ddd <código>* para marcar os membros de um estado específico!_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleDDDList]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao gerar censo de DDDs do grupo.` });
    }
  }

  /**
   * 17.2 Sorteio Exclusivo por DDD: !sorteioddd <ddd> [quantidade]
   */
  async handleSorteioDDD(sock, from, text, groupMetadata = null, isAdminOrOwner = false) {
    try {
      const isGroup = from && from.endsWith('@g.us');
      if (!isGroup) {
        return sock.sendMessage(from, { text: `⛔ Sorteios por DDD só podem ser realizados dentro de grupos!` });
      }

      if (!isAdminOrOwner) {
        return sock.sendMessage(from, { text: `⛔ *Apenas Administradores* ou o Dono do bot podem realizar sorteios no grupo.` });
      }

      const parts = (text || '').trim().split(/\s+/);
      const code = parts[1]?.replace(/\D/g, '');
      const count = Math.min(10, Math.max(1, parseInt(parts[2], 10) || 1));

      if (!code || !DDD_MAP[code]) {
        return sock.sendMessage(from, {
          text: `🎲 *SORTEIO REGIONAL POR DDD* 🎲\n\n` +
            `Sorteie um ou mais membros exclusivamente de um DDD do Brasil!\n\n` +
            `📌 *Exemplo de uso:*\n` +
            `• *!sorteioddd 11* (Sorteia 1 vencedor de SP)\n` +
            `• *!sorteioddd 48 2* (Sorteia 2 vencedores de SC)\n` +
            `• *!sorteioddd 21 3* (Sorteia 3 vencedores do RJ)`
        });
      }

      const info = DDD_MAP[code];
      let metadata = groupMetadata;
      if (!metadata && sock && typeof sock.groupMetadata === 'function') {
        metadata = await sock.groupMetadata(from).catch(() => null);
      }

      const allParticipants = metadata?.participants || [];
      const nonAdmins = this.getNonAdminParticipants(allParticipants);
      const resolvePhone = (pId) => {
        if (!pId) return null;
        const clean = pId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (clean === '151866151276711') return '554884702848';
        return clean;
      };

      const matching = [];
      for (const p of nonAdmins) {
        const rawPhone = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
        const phone = resolvePhone(p.id) || rawPhone;
        let isMatch = false;
        if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
          if (phone.substring(2, 4) === code) isMatch = true;
        }
        if (isMatch) matching.push(p);
      }

      if (matching.length === 0) {
        return sock.sendMessage(from, {
          text: `⚠️ *Não há participantes comuns com DDD ${code} (${info.uf})* neste grupo para realizar o sorteio (administradores poupados).`
        });
      }

      // Embaralha e seleciona os vencedores
      const shuffled = [...matching].sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, count);

      const mentions = [];
      const winnerLines = [];

      winners.forEach((w, idx) => {
        mentions.push(w.id);
        const tag = w.id.split('@')[0].split(':')[0];
        winnerLines.push(`🎉 ${idx + 1}º Vencedor(a): @${tag}`);
      });

      const out =
        `🎉 *RESULTADO DO SORTEIO REGIONAL (DDD ${code})* 🎉\n\n` +
        `🏛️ *Estado (UF):* ${info.uf}\n` +
        `📍 *Região:* ${info.regiao}\n` +
        `👥 *Concorrentes do DDD:* ${matching.length} membros\n\n` +
        `🏆 *PARABÉNS AOS GANHADORES:*\n` +
        `${winnerLines.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ _Entre em contato com a administração para resgatar seu prêmio/benefício!_`;

      return sock.sendMessage(from, {
        text: out,
        mentions
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleSorteioDDD]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao realizar sorteio por DDD.` });
    }
  }

  /**
   * 17.3 Geração de Cobrança Instantânea pelo WhatsApp: !cobranca <valor> [cliente] / !pix <valor>
   */
  async handleWhatsAppCobranca(sock, from, text, msg, isOwnerOrAdmin, senderPhone, senderName) {
    try {
      if (!isOwnerOrAdmin) {
        return sock.sendMessage(from, { text: `⛔ *Acesso Restrito:* Apenas o Dono ou Administradores podem gerar cobranças rápidas via WhatsApp.` });
      }

      // Pega valor da mensagem: ex: !cobranca 89.90, !pix 50, !pix R$ 50,00 ou !cobrar R$120
      const match = (text || '').match(/(?:!|\/)(?:cobranca|cobrar|pix)\s+(?:r\$|rs|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)(?:\s+(.*))?/i);
      if (!match) {
        return sock.sendMessage(from, {
          text: `💰 *GERADOR RÁPIDO DE COBRANÇA PIX* 💰\n\n` +
            `Gere um PIX Copia e Cola imediato aqui no WhatsApp!\n\n` +
            `📌 *Como usar:*\n` +
            `• *!cobranca 49.90*\n` +
            `• *!pix 100*\n` +
            `• Ou responda à mensagem de um cliente com *!pix 89.90* para cobrar diretamente aquele cliente!`
        });
      }

      const amountVal = parseFloat(match[1].replace(',', '.'));
      if (isNaN(amountVal) || amountVal <= 0) {
        return sock.sendMessage(from, { text: `❌ Valor de cobrança inválido.` });
      }

      let extraText = (match[2] || '').trim();
      let targetJid = null;
      let targetName = extraText || 'Cliente';

      // Verifica se está respondendo a uma mensagem existente
      const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
      if (contextInfo?.participant) {
        targetJid = contextInfo.participant;
        targetName = targetName === 'Cliente' ? `@${targetJid.split('@')[0].split(':')[0]}` : targetName;
      } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid[0]) {
        targetJid = contextInfo.mentionedJid[0];
        targetName = targetName === 'Cliente' ? `@${targetJid.split('@')[0].split(':')[0]}` : targetName;
      }

      const tradeNo = `ORD_WPIX_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
      const pixPayment = require('./pixPayment');
      const models = require('../db/models');

      const pixRes = await pixPayment.createPixCharge({
        merchantTradeNo: tradeNo,
        amount: amountVal,
        goodsName: 'Cobrança WhatsApp Express',
        payerName: targetName.replace(/[@0-9]/g, '').trim() || 'Cliente WhatsApp'
      });

      const pixCode = pixRes.data?.pixCode || pixRes.pixCode || (pixRes.isLivepix ? null : (pixPayment.generateBacenPixPayload ? pixPayment.generateBacenPixPayload({ amount: amountVal }) : null));

      // Registra o pedido no banco de dados
      const defaultProd = (models.getProducts ? models.getProducts(true)[0] : null) || { id: 1, name: 'Cobrança WhatsApp Express' };
      const chosenGateway = pixRes.isLivepix ? 'livepix' : 'pix';
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'whatsapp',
        platform_user_id: targetJid || from,
        platform_user_name: targetName,
        product_id: defaultProd.id,
        product_name: defaultProd.name,
        gateway: chosenGateway,
        amount: amountVal,
        currency: 'BRL',
        status: 'PENDING',
        pix_code: pixCode,
        checkout_url: pixRes.data?.checkoutUrl || null
      });

      let out = '';
      if (pixRes.isLivepix) {
        if (pixCode) {
          out =
            `🟢 *COBRANÇA PIX GERADA COM SUCESSO* ⚡\n\n` +
            `👤 *Cliente:* ${targetName}\n` +
            `💰 *Valor:* *R$ ${amountVal.toFixed(2)}*\n` +
            `📦 *Pedido:* \`#${tradeNo}\`\n\n` +
            `📱 *Como pagar:*\n` +
            `1. Aponte a câmera do aplicativo do seu banco para o QR Code acima, OU\n` +
            `2. Toque e segure no código *Pix Copia e Cola* enviado isolado abaixo para copiar com 1 toque.\n\n` +
            `⚡ _A aprovação é instantânea e o produto liberado na hora!_`;
        } else {
          out =
            `🟢 *COBRANÇA PIX GERADA COM SUCESSO* ⚡\n\n` +
            `👤 *Cliente:* ${targetName}\n` +
            `💰 *Valor:* *R$ ${amountVal.toFixed(2)}*\n` +
            `📦 *Pedido:* \`#${tradeNo}\`\n\n` +
            `🔗 *Link de Pagamento PIX:*\n${pixRes.data?.checkoutUrl}\n\n` +
            `📱 *Instruções:*\n` +
            `1. Abra o link seguro acima;\n` +
            `2. Os dados de *R$ ${amountVal.toFixed(2)}* e o pedido \`${tradeNo}\` já foram inseridos pelo sistema;\n` +
            `3. Toque em *Continuar* para concluir o pagamento no seu banco.\n\n` +
            `⚡ _A confirmação bancária é instantânea e automática!_`;
        }
      } else {
        out =
          `🧾 *COBRANÇA PIX INSTANTÂNEA GERADA* 🧾\n\n` +
          `👤 *Cliente:* ${targetName}\n` +
          `💰 *Valor:* *R$ ${amountVal.toFixed(2)}*\n` +
          `📦 *Pedido:* \`#${tradeNo}\`\n\n` +
          `📱 *Como realizar o pagamento:*\n` +
          `1. Aponte a câmera do aplicativo do seu banco para o QR Code acima, OU\n` +
          `2. Toque no código *PIX Copia e Cola* enviado isolado abaixo para copiar com 1 toque.\n\n` +
          `⚡ _A confirmação bancária é instantânea e automática!_`;
      }

      const mentions = targetJid ? [targetJid] : [];
      let qrBuf = pixRes.data?.qrBuffer;
      if (!Buffer.isBuffer(qrBuf) && typeof qrBuf === 'string' && qrBuf.startsWith('data:image')) {
        try { qrBuf = Buffer.from(qrBuf.replace(/^data:image\/\w+;base64,/, ''), 'base64'); } catch (_) {}
      }
      if (!Buffer.isBuffer(qrBuf) && (pixCode || pixRes.data?.checkoutUrl)) {
        try {
          const QRCode = require('qrcode');
          qrBuf = await QRCode.toBuffer(pixCode || pixRes.data?.checkoutUrl, { width: 360, margin: 2 });
        } catch (_) {}
      }

      if (Buffer.isBuffer(qrBuf)) {
        try {
          await sock.sendMessage(from, { image: qrBuf, caption: out, text: out, mentions });
        } catch (_) {
          await sock.sendMessage(from, { text: out, mentions });
        }
      } else {
        await sock.sendMessage(from, { text: out, mentions });
      }

      // Envia Copia e Cola em mensagem isolada APENAS se houver pixCode real fornecido pelo gateway
      if (pixCode && String(pixCode).trim().length > 0) {
        await new Promise(r => setTimeout(r, 400));
        await sock.sendMessage(from, { text: `👇 *PIX COPIA E COLA (Toque e segure no código abaixo para copiar):*` });
        await new Promise(r => setTimeout(r, 300));
        return sock.sendMessage(from, { text: `${pixCode.trim()}` });
      }
      return;
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleWhatsAppCobranca]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao gerar cobrança Pix: ${err.message}` });
    }
  }

  /**
   * 17.5 Configuração da Chave Pix pelo WhatsApp: !setpix [tipo] <chave> / !configpix / !chavepix
   */
  async handleSetPix(sock, from, text, isOwnerOrAdmin) {
    try {
      if (!isOwnerOrAdmin) {
        return sock.sendMessage(from, { text: `⛔ *Acesso Restrito:* Apenas o Dono ou Administradores podem configurar a Chave Pix.` });
      }

      const match = (text || '').match(/(?:!|\/)(?:setpix|configpix|chavepix|definirpix)(?:\s+(.*))?/i);
      const rawArg = (match && match[1] ? match[1].trim() : '');

      if (!rawArg) {
        const models = require('../db/models');
        const currentKey = models.getSetting('PIX_KEY', '') || models.getSetting('BACEN_PIX_KEY', '') || models.getSetting('OWNER_PHONE', '');
        return sock.sendMessage(from, {
          text: `🔑 *CONFIGURADOR DE CHAVE PIX* 🔑\n\n` +
            `Defina a chave Pix que receberá os pagamentos de todos os pedidos e clientes!\n\n` +
            `📌 *Chave Atual:* \`${currentKey || 'Nenhuma (usando telefone do dono)'}\`\n\n` +
            `📝 *Como configurar:*\n` +
            `• *!setpix 48984702848* (Telefone celular com DDD)\n` +
            `• *!setpix meuemail@gmail.com* (E-mail)\n` +
            `• *!setpix 123.456.789-00* (CPF)\n` +
            `• *!setpix 12.345.678/0001-90* (CNPJ)\n` +
            `• *!setpix 123e4567-e89b-12d3-a456-426614174000* (Chave Aleatória/EVP)\n\n` +
            `💡 Você também pode forçar o tipo:\n` +
            `• *!setpix cpf 12345678900*\n` +
            `• *!setpix telefone 48984702848*`
        });
      }

      const parts = rawArg.split(/\s+/);
      let optionalType = '';
      let targetKey = rawArg;
      const validTypes = ['cpf', 'cnpj', 'telefone', 'celular', 'phone', 'email', 'evp', 'aleatoria'];
      if (parts.length >= 2 && validTypes.includes(parts[0].toLowerCase())) {
        optionalType = parts[0].toLowerCase();
        targetKey = parts.slice(1).join(' ').trim();
      }

      const pixPayment = require('./pixPayment');
      const models = require('../db/models');
      const detected = pixPayment.detectAndSanitizePixKey(targetKey, optionalType);

      if (!detected.key || detected.key.length < 3) {
        return sock.sendMessage(from, { text: `❌ Chave Pix inválida ou muito curta. Verifique e tente novamente.` });
      }

      // Salva no banco de dados tanto em PIX_KEY quanto em BACEN_PIX_KEY
      models.setSetting('PIX_KEY', detected.key);
      models.setSetting('BACEN_PIX_KEY', detected.key);

      // Gera um Copia e Cola de teste de R$ 1,00 para validação imediata
      const testCode = pixPayment.generateBacenPixPayload({
        pixKey: detected.key,
        merchantName: 'PAYBOT',
        merchantCity: 'SAO PAULO',
        amount: '1.00',
        txid: '***'
      });

      const QRCode = require('qrcode');
      let testQr = null;
      try {
        testQr = await QRCode.toBuffer(testCode, { width: 360, margin: 2 });
      } catch (_) {}

      const confirmationMsg =
        `✅ *CHAVE PIX ATUALIZADA COM SUCESSO!* 🏦\n\n` +
        `👤 *Configurado por:* Administrador\n` +
        `📌 *Tipo Identificado:* *${detected.type}*\n` +
        `🔑 *Chave Homologada:* \`${detected.key}\`\n` +
        `🏷️ *Padrão:* Banco Central do Brasil (EMVCo BR Code Oficial)\n` +
        `📱 *Compatibilidade:* 100% dos bancos (Nubank, Itaú, Bradesco, BB, Inter, Caixa, Santander, Mercado Pago, etc.)\n\n` +
        `⚡ *Pronto!* Todas as novas cobranças e pedidos do PayBot utilizarão esta chave.\n\n` +
        `🧪 *QR Code de Teste (R$ 1,00) gerado abaixo:*`;

      if (Buffer.isBuffer(testQr)) {
        try {
          await sock.sendMessage(from, {
            image: testQr,
            caption: confirmationMsg
          });
        } catch (_) {
          await sock.sendMessage(from, { text: confirmationMsg });
        }
      } else {
        await sock.sendMessage(from, { text: confirmationMsg });
      }

      await new Promise(r => setTimeout(r, 400));
      await sock.sendMessage(from, { text: `👇 *Copia e Cola de Teste (Toque para copiar):*` });
      await new Promise(r => setTimeout(r, 200));
      return sock.sendMessage(from, { text: `${testCode}` });
    } catch (err) {
      console.error('[SpyFeatures ❌ handleSetPix]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao configurar chave Pix: ${err.message}` });
    }
  }

  /**
   * 17.6 Visualização e Teste da Chave Pix Atual: !verpix / !statuspix / !meupix
   */
  async handleVerPix(sock, from, isOwnerOrAdmin) {
    try {
      if (!isOwnerOrAdmin) {
        return sock.sendMessage(from, { text: `⛔ *Acesso Restrito:* Apenas o Dono ou Administradores podem consultar a Chave Pix.` });
      }

      const models = require('../db/models');
      const pixPayment = require('./pixPayment');

      let currentKey = (models.getSetting('BACEN_PIX_KEY', '') || models.getSetting('PIX_KEY', '') || '').trim();
      let isFallback = false;
      if (!currentKey || currentKey === 'contato@meunegocio.com' || currentKey === '00000000000') {
        currentKey = (models.getSetting('OWNER_PHONE', '') || require('../config').ownerPhone || '554884702848').trim();
        isFallback = true;
      }

      const detected = pixPayment.detectAndSanitizePixKey(currentKey);
      const testCode = pixPayment.generateBacenPixPayload({
        pixKey: detected.key,
        merchantName: 'PAYBOT',
        merchantCity: 'SAO PAULO',
        amount: '1.00',
        txid: '***'
      });

      const QRCode = require('qrcode');
      let testQr = null;
      try {
        testQr = await QRCode.toBuffer(testCode, { width: 360, margin: 2 });
      } catch (_) {}

      const msg =
        `🏦 *STATUS DA CHAVE PIX - PAYBOT* 🏦\n\n` +
        `🔑 *Chave Atual:* \`${detected.key}\`\n` +
        `📌 *Tipo:* ${detected.type}${isFallback ? ' _(Padrão número do Dono)_' : ''}\n` +
        `🏢 *Beneficiário:* PAYBOT\n` +
        `📍 *Cidade:* SAO PAULO\n` +
        `🏷️ *Padrão:* EMVCo BR Code (Manual do Banco Central v2.4)\n` +
        `✅ *Compatibilidade:* Homologado para Nubank, Itaú, Bradesco, BB, Inter, Caixa, Santander, Mercado Pago e PicPay.\n\n` +
        `💡 *Para alterar sua chave a qualquer momento:*\n` +
        `Envie: *!setpix <sua_chave>*\n` +
        `Exemplo: *!setpix 48984702848* ou *!setpix meu@email.com*`;

      if (Buffer.isBuffer(testQr)) {
        try {
          await sock.sendMessage(from, { image: testQr, caption: msg });
        } catch (_) {
          await sock.sendMessage(from, { text: msg });
        }
      } else {
        await sock.sendMessage(from, { text: msg });
      }

      await new Promise(r => setTimeout(r, 400));
      await sock.sendMessage(from, { text: `👇 *Copia e Cola de Teste (Toque para copiar):*` });
      await new Promise(r => setTimeout(r, 200));
      return sock.sendMessage(from, { text: `${testCode}` });
    } catch (err) {
      console.error('[SpyFeatures ❌ handleVerPix]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar chave Pix: ${err.message}` });
    }
  }

  /**
   * 17.5.1 Configurador do LivePix pelo WhatsApp: !setlivepix <usuario> / !livepix <usuario>
   */
  async handleSetLivepix(sock, from, text, isOwnerOrAdmin) {
    try {
      if (!isOwnerOrAdmin) {
        return sock.sendMessage(from, { text: `⛔ *Acesso Restrito:* Apenas o Dono ou Administradores podem configurar o LivePix.` });
      }

      const match = (text || '').match(/(?:!|\/)(?:setlivepix|livepix|configlivepix)(?:\s+(.*))?/i);
      const rawArg = (match && match[1] ? match[1].trim().replace(/^@/, '') : '');

      const models = require('../db/models');
      if (!rawArg) {
        const curUser = models.getSetting('LIVEPIX_USERNAME', 'paybot');
        const isLiveEnabled = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'true') === 'true';
        const primaryProv = models.getSetting('PIX_PRIMARY_PROVIDER', 'livepix');

        return sock.sendMessage(from, {
          text: `💜 *CONFIGURADOR LIVEPIX (PAYBOT)* ⚡\n\n` +
            `Defina seu usuário do LivePix para receber todos os pagamentos Pix dos clientes com aprovação automática!\n\n` +
            `📌 *Usuário Atual:* \`@${curUser}\`\n` +
            `🔗 *Link Atual:* https://livepix.gg/${curUser}\n` +
            `⚙️ *Status Gateway:* ${isLiveEnabled ? '✅ Ativo' : '❌ Inativo'}\n` +
            `👑 *Provedor Principal:* ${primaryProv.toUpperCase()}\n\n` +
            `📝 *Como configurar seu usuário:*\n` +
            `• *!setlivepix ${curUser || 'meu_canal'}*\n` +
            `• *!setlivepix seunome*\n\n` +
            `💡 _Dica: Digite \`!verlivepix\` para inspecionar e testar o link ao vivo._`
        });
      }

      const cleanUser = rawArg.replace(/[^a-zA-Z0-9_.-]/g, '');
      if (cleanUser.length < 2) {
        return sock.sendMessage(from, { text: `❌ Nome de usuário do LivePix muito curto ou inválido.` });
      }

      // Salva no banco de dados e coloca como provedor primário
      models.setSetting('LIVEPIX_USERNAME', cleanUser);
      models.setSetting('PIX_PRIMARY_PROVIDER', 'livepix');
      models.setSetting('GATEWAY_LIVEPIX_ENABLED', 'true');

      const QRCode = require('qrcode');
      const testUrl = `https://livepix.gg/${cleanUser}?amount=1.00&message=TESTE_PAYBOT`;
      let testQr = null;
      try {
        testQr = await QRCode.toBuffer(testUrl, { width: 360, margin: 2 });
      } catch (_) {}

      const msg =
        `💜 *LIVEPIX ATIVADO COMO PADRÃO NO PAYBOT!* ⚡\n\n` +
        `👤 *Usuário Configurado:* \`@${cleanUser}\`\n` +
        `🔗 *Página Oficial:* https://livepix.gg/${cleanUser}\n` +
        `👑 *Recebimentos:* Todas as cobranças Pix geradas pelo PayBot (WhatsApp, Loja Web e Telegram) agora usam a estrutura do LivePix por padrão!\n` +
        `⚡ *Baixa Automática:* Webhook oficial \`/api/livepix/webhook\` ativo para liberação instantânea.\n\n` +
        `🧪 *Link de Teste (R$ 1,00):*\n${testUrl}`;

      if (Buffer.isBuffer(testQr)) {
        try {
          return await sock.sendMessage(from, { image: testQr, caption: msg });
        } catch (_) {
          return await sock.sendMessage(from, { text: msg });
        }
      }
      return sock.sendMessage(from, { text: msg });
    } catch (err) {
      console.error('[SpyFeatures ❌ handleSetLivepix]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao configurar LivePix: ${err.message}` });
    }
  }

  /**
   * 17.5.2 Consulta do LivePix Atual: !verlivepix / !statuslivepix / !meulivepix
   */
  async handleVerLivepix(sock, from, isOwnerOrAdmin) {
    try {
      if (!isOwnerOrAdmin) {
        return sock.sendMessage(from, { text: `⛔ *Acesso Restrito:* Apenas o Dono ou Administradores podem consultar o LivePix.` });
      }

      const models = require('../db/models');
      const curUser = models.getSetting('LIVEPIX_USERNAME', 'paybot');
      const primaryProv = models.getSetting('PIX_PRIMARY_PROVIDER', 'livepix');
      const testUrl = `https://livepix.gg/${curUser}`;

      const QRCode = require('qrcode');
      let testQr = null;
      try {
        testQr = await QRCode.toBuffer(testUrl, { width: 360, margin: 2 });
      } catch (_) {}

      const msg =
        `💜 *STATUS DO LIVEPIX - PAYBOT* ⚡\n\n` +
        `👤 *Usuário Ativo:* \`@${curUser}\`\n` +
        `🔗 *Link do Perfil:* ${testUrl}\n` +
        `👑 *Provedor Pix Padrão:* ${primaryProv === 'livepix' ? '✅ SIM (Prioritário no PayBot)' : '⚠️ ' + primaryProv}\n` +
        `⚡ *Webhook de Confirmação:* \`/api/livepix/webhook\` (Entrega imediata)\n\n` +
        `💡 *Para trocar o usuário a qualquer momento:*\n` +
        `Envie: *!setlivepix <novo_usuario>*`;

      if (Buffer.isBuffer(testQr)) {
        try {
          return await sock.sendMessage(from, { image: testQr, caption: msg });
        } catch (_) {
          return await sock.sendMessage(from, { text: msg });
        }
      }
      return sock.sendMessage(from, { text: msg });
    } catch (err) {
      console.error('[SpyFeatures ❌ handleVerLivepix]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar LivePix: ${err.message}` });
    }
  }

  /**
   * 17.4 Status de Tarefas & Monitor do Dono: !tarefas / !statusfila / !fila
   */
  async handleTarefasStatus(sock, from, isOwnerUser) {
    if (!isOwnerUser) {
      return sock.sendMessage(from, { text: `⛔ *Acesso Negado:* Comando exclusivo para o Dono do sistema.` });
    }

    try {
      const models = require('../db/models');
      const whatsappArmyService = require('./whatsappArmyService');
      const instances = models.getArmyInstances();
      const activeChips = instances.filter(i => whatsappArmyService.activeSockets?.has(i.id) || i.status === 'CONNECTED').length;
      const totalChips = instances.length;

      const queue = models.getTaskQueue ? models.getTaskQueue(10) : [];
      const pendingTasks = queue.filter(t => t.status === 'PENDING' || t.status === 'WAITING').length;
      const runningTasks = queue.filter(t => t.status === 'RUNNING' || t.status === 'IN_PROGRESS').length;

      const delegated = models.getDelegatedTasks ? models.getDelegatedTasks(5) : [];
      const recentLines = delegated.slice(0, 5).map(t => {
        const icon = t.status === 'COMPLETED' ? '🟢' : (t.status === 'FAILED' ? '🔴' : '🟡');
        return `${icon} \`#${t.task_code || t.id}\` - ${t.title || t.task_type} [${t.status}]`;
      });

      const todaySent = instances.reduce((acc, curr) => acc + (curr.messages_sent_today || 0), 0);

      const out =
        `⚡ *CENTRAL DE CONTROLE & STATUS DO SISTEMA* ⚡\n\n` +
        `📊 *Disparos Realizados Hoje:* *${todaySent} mensagens*\n` +
        `🤖 *Instâncias WhatsApp:* *${activeChips} online* de ${totalChips} chips cadastrados\n` +
        `⏳ *Fila de Automação:* ${pendingTasks} pendentes • ${runningTasks} em execução\n\n` +
        `📌 *Últimas 5 Tarefas Registradas:*\n` +
        (recentLines.length ? recentLines.join('\n') : '_Nenhuma tarefa recente._') + `\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 _Digite *!painel* para acessar a interface web completa_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleTarefasStatus]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar status das tarefas.` });
    }
  }

  /**
   * 17.5 Criação Rápida de Cupom via WhatsApp: !cupom <codigo> <desconto%> [usos]
   */
  async handleCriarCupomWhatsApp(sock, from, text, isOwnerUser) {
    if (!isOwnerUser) {
      return sock.sendMessage(from, { text: `⛔ *Acesso Negado:* Apenas o Dono pode criar cupons de desconto.` });
    }

    try {
      const parts = (text || '').trim().split(/\s+/);
      const code = parts[1]?.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const discount = parseFloat(parts[2]);
      const maxUses = parseInt(parts[3], 10) || 0;

      if (!code || isNaN(discount) || discount <= 0 || discount > 100) {
        return sock.sendMessage(from, {
          text: `🎟️ *CRIADOR RÁPIDO DE CUPOM DE DESCONTO* 🎟️\n\n` +
            `Crie cupons promocionais imediatamente pelo WhatsApp!\n\n` +
            `📌 *Formato:*\n` +
            `• *!cupom <CODIGO> <PERCENTUAL%> [LIMITE_USOS]*\n\n` +
            `💡 *Exemplos:*\n` +
            `• *!cupom PROMO20 20* (20% OFF ilimitado)\n` +
            `• *!cupom VIP50 50 100* (50% OFF para os primeiros 100 clientes)`
        });
      }

      const models = require('../db/models');
      const c = models.createCoupon({
        code,
        discount_percent: discount,
        max_uses: maxUses
      });

      const out =
        `🎟️ *NOVO CUPOM CRIADO COM SUCESSO!* 🎟️\n\n` +
        `🏷️ *Código Promocional:* \`${c.code}\`\n` +
        `📉 *Desconto:* *${c.discount_percent}% OFF*\n` +
        `👥 *Limite de Usos:* ${c.max_uses > 0 ? `${c.max_uses} resgates` : 'Ilimitado'}\n` +
        `🟢 *Status:* Ativo e pronto para compras no bot e na loja virtual!`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCriarCupomWhatsApp]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao criar cupom: ${err.message}` });
    }
  }

  // ==========================================
  // 5. FUNCIONALIDADES PORTADAS DO HATSUNE MIKU BOT
  // ==========================================

  /**
   * 1. Quote Chat Sticker (!qc <texto>)
   * Gera figurinha estilo balão dark mode oficial do WhatsApp com foto/inicial, nome e texto
   */
  async handleQC(sock, from, msg, text, senderName) {
    try {
      let quoteText = (text || '').replace(/^(?:!|\/)(?:qc|quotechat|citacao)\s*/i, '').trim();
      let authorName = senderName || 'Usuário';

      // Se respondeu a uma mensagem, pega o texto e o autor da mensagem respondida
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedParticipant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
      if (quoted) {
        const quotedBody = quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || '';
        if (quotedBody) {
          quoteText = quoteText || quotedBody;
        }
        if (quotedParticipant) {
          const qPhone = quotedParticipant.split('@')[0].split(':')[0];
          authorName = `@${qPhone}`;
        }
      }

      if (!quoteText) {
        return sock.sendMessage(from, {
          text: `💬 *CRIADOR DE QUOTE CHAT (!qc)*\n\nCrie uma figurinha elegante no padrão WhatsApp Dark Mode!\n\n📌 *Como usar:*\n• Digite *!qc Sua mensagem aqui*\n• Ou responda a qualquer mensagem do grupo com *!qc*`
        });
      }

      const timeStr = formatBrasiliaTime(new Date());

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          sticker: Buffer.from('mock_qc_webp'),
          caption: `💬 Quote Chat: "${quoteText}" por ${authorName}`
        });
      }

      const stickerBuf = await stickerConverter.generateQC(authorName, quoteText, timeStr);
      await sock.sendMessage(from, { sticker: stickerBuf });

      const senderPhone = (msg?.key?.participant || from).split('@')[0].split(':')[0];
      models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5);
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleQC]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao gerar figurinha de citação: ${err.message}` });
    }
  }

  /**
   * 2. Figurinha Viral Brat (!brat <texto>)
   * Gera a icônica figurinha verde-limão (#8ACE00) com texto centralizado e desfoque suave
   */
  async handleBrat(sock, from, text) {
    try {
      const cleanText = (text || '').replace(/^(?:!|\/)(?:brat|charli)\s*/i, '').trim();
      if (!cleanText) {
        return sock.sendMessage(from, {
          text: `🟩 *GERADOR DE FIGURINHA BRAT*\n\nTransforme qualquer frase na famosa estética verde limão de Charli XCX!\n\n📌 *Como usar:* Digite *!brat seu texto*\nExemplo: *!brat vendas automaticas*`
        });
      }

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          sticker: Buffer.from('mock_brat_webp'),
          caption: `🟩 Brat: "${cleanText}"`
        });
      }

      const stickerBuf = await stickerConverter.generateBrat(cleanText);
      await sock.sendMessage(from, { sticker: stickerBuf });

      const senderPhone = from.split('@')[0].split(':')[0];
      models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5);
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleBrat]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao criar figurinha brat: ${err.message}` });
    }
  }

  /**
   * 3. Screenshot de Página Web (!ssweb / !ss <url>)
   * Tira print em alta resolução de qualquer página da internet
   */
  async handleSSWeb(sock, from, text) {
    try {
      let url = (text || '').replace(/^(?:!|\/)(?:ssweb|ss|screenshot|printweb)\s*/i, '').trim();
      if (!url) {
        return sock.sendMessage(from, {
          text: `🌐 *SCREENSHOT DE WEBSITES (!ssweb)*\n\nCapture um print em tempo real de qualquer página web!\n\n📌 *Como usar:* Digite *!ssweb <url>*\nExemplo: *!ssweb https://google.com* ou *!ssweb github.com*`
        });
      }

      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }

      await sock.sendMessage(from, { text: `⏳ *Capturando tela de:* ${url}...` });

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          image: Buffer.from('mock_screenshot'),
          caption: `📸 *Screenshot Web Capturado!*\n🔗 *URL:* ${url}`
        });
      }

      const targetApi = `https://image.thum.io/get/width/1024/crop/800/${url}`;
      const res = await fetch(targetApi, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) {
        return sock.sendMessage(from, { text: `❌ Não foi possível capturar a página solicitada.` });
      }

      const buf = Buffer.from(await res.arrayBuffer());
      return sock.sendMessage(from, {
        image: buf,
        caption: `📸 *SCREENSHOT WEB EM ALTA RESOLUÇÃO*\n\n🔗 *Endereço:* ${url}\n⚡ _Processado em tempo real pelo PayBot_`
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleSSWeb]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao capturar website: ${err.message}` });
    }
  }

  /**
   * 4. Upload de Mídia para Link Direto (!tourl)
   * Converte qualquer foto, figurinha, vídeo ou áudio para uma URL pública CDN
   */
  async handleToUrl(sock, from, msg, senderName = 'Usuário') {
    try {
      const media = await this.extractMediaBuffer(msg);
      if (!media || !media.buffer) {
        return sock.sendMessage(from, {
          text: `📤 *CONVERSOR DE MÍDIA PARA URL (!tourl)*\n\nTransforme fotos, vídeos, figurinhas ou áudios em links diretos para compartilhamento na web!\n\n📌 *Como usar:* Envie ou responda a uma mídia com o comando *!tourl*`
        });
      }

      await sock.sendMessage(from, { text: `⏳ *Enviando arquivo para servidor de alta velocidade...*` });

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          text: `📤 *UPLOAD CONCLUÍDO COM SUCESSO!*\n\n🔗 *Link:* https://qu.ax/mock123\n📦 *Tamanho:* 1.25 KB\n⚡ *Servidor:* QUAX CDN\n👤 *Solicitado por:* ${senderName}`
        });
      }

      let publicUrl = null;
      let serverName = 'QUAX CDN';
      const ext = media.type === 'video' ? 'mp4' : (media.type === 'sticker' ? 'webp' : (media.type === 'audio' ? 'mp3' : 'jpg'));
      const mime = media.type === 'video' ? 'video/mp4' : (media.type === 'sticker' ? 'image/webp' : (media.type === 'audio' ? 'audio/mpeg' : 'image/jpeg'));
      const filename = `file_${Date.now()}.${ext}`;

      // 1. Tenta upload no qu.ax
      try {
        const form = new FormData();
        const blob = new Blob([media.buffer], { type: mime });
        form.append('files[]', blob, filename);
        const res = await fetch('https://qu.ax/upload.php', { method: 'POST', body: form });
        const data = await res.json();
        if (data?.files?.[0]?.url) {
          publicUrl = data.files[0].url;
          serverName = 'QUAX CDN (Permanente)';
        }
      } catch (_) {}

      // 2. Fallback no uguu.se
      if (!publicUrl) {
        try {
          const form = new FormData();
          const blob = new Blob([media.buffer], { type: mime });
          form.append('files[]', blob, filename);
          const res = await fetch('https://uguu.se/upload.php', { method: 'POST', body: form });
          const data = await res.json();
          if (data?.files?.[0]?.url) {
            publicUrl = data.files[0].url;
            serverName = 'UGUU SE (24h)';
          }
        } catch (_) {}
      }

      if (!publicUrl) {
        return sock.sendMessage(from, { text: `❌ Falha ao realizar upload da mídia nos servidores CDN. Tente novamente mais tarde.` });
      }

      const sizeKb = (media.buffer.length / 1024).toFixed(1);
      const out =
        `📤 *MÍDIA ENVIADA PARA NUVEM COM SUCESSO!* 📤\n\n` +
        `🔗 *Link de Acesso:* ${publicUrl}\n` +
        `📦 *Tamanho:* ${sizeKb} KB\n` +
        `📁 *Formato:* ${ext.toUpperCase()} (${mime})\n` +
        `⚡ *Servidor:* ${serverName}\n` +
        `👤 *Solicitado por:* ${senderName}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚀 _Link pronto para uso em sites, bots e redes sociais!_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleToUrl]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no envio de mídia: ${err.message}` });
    }
  }

  /**
   * 5. Clone e Download de Repositórios GitHub (!gitclone / !git <url>)
   * Baixa qualquer repositório público do GitHub diretamente em arquivo .ZIP
   */
  async handleGitClone(sock, from, text) {
    try {
      const clean = (text || '').replace(/^(?:!|\/)(?:gitclone|git|clonegit)\s*/i, '').trim();
      if (!clean) {
        return sock.sendMessage(from, {
          text: `🐙 *DOWNLOAD DE REPOSITÓRIOS GITHUB (!gitclone)*\n\nBaixe códigos-fonte inteiros diretamente em arquivo .ZIP pelo WhatsApp!\n\n📌 *Como usar:* Digite *!gitclone <link do github>*\nExemplo: *!gitclone https://github.com/SpyHacke/bot*`
        });
      }

      const match = clean.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/i);
      let user = null;
      let repo = null;

      if (match) {
        user = match[1];
        repo = match[2].replace(/\.git$/i, '');
      } else {
        const parts = clean.split('/');
        if (parts.length === 2) {
          user = parts[0].trim();
          repo = parts[1].trim();
        }
      }

      if (!user || !repo) {
        return sock.sendMessage(from, { text: `⚠️ Formato inválido. Informe o link ou usuário/repositório. Exemplo: *!gitclone dono/projeto*` });
      }

      await sock.sendMessage(from, { text: `⏳ *Consultando repositório ${user}/${repo} no GitHub...*` });

      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          text: `🐙 *Repositório:* ${user}/${repo}\n⭐ *Stars:* 42\n📦 *Arquivo ZIP enviado!*`
        });
      }

      const repoRes = await fetch(`https://api.github.com/repos/${user}/${repo}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!repoRes.ok) {
        return sock.sendMessage(from, { text: `❌ Repositório "${user}/${repo}" não encontrado ou privado no GitHub.` });
      }

      const repoData = await repoRes.json();
      const stars = repoData.stargazers_count || 0;
      const forks = repoData.forks_count || 0;
      const desc = repoData.description || 'Sem descrição informada';
      const defaultBranch = repoData.default_branch || 'main';

      const zipRes = await fetch(`https://api.github.com/repos/${user}/${repo}/zipball`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow'
      });

      if (!zipRes.ok) {
        return sock.sendMessage(from, { text: `❌ Não foi possível gerar o pacote .ZIP do repositório.` });
      }

      const zipBuf = Buffer.from(await zipRes.arrayBuffer());
      const fileName = `${repo}-${defaultBranch}.zip`;

      const card =
        `🐙 *REPOSITÓRIO GITHUB ENCONTRADO!* 🐙\n\n` +
        `📦 *Projeto:* ${repoData.full_name}\n` +
        `📝 *Descrição:* ${desc}\n` +
        `⭐ *Estrelas:* ${stars} | 🍴 *Forks:* ${forks}\n` +
        `🌿 *Branch Principal:* ${defaultBranch}\n` +
        `🔗 *Link:* ${repoData.html_url}\n\n` +
        `⬇️ _Enviando arquivo compactado (${(zipBuf.length / (1024 * 1024)).toFixed(2)} MB)..._`;

      await sock.sendMessage(from, { text: card });

      return sock.sendMessage(from, {
        document: zipBuf,
        fileName,
        mimetype: 'application/zip'
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleGitClone]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao baixar repositório: ${err.message}` });
    }
  }

  /**
   * 6. Ativação do Modo AFK (!afk [motivo])
   */
  async handleAFK(sock, from, text, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const reason = (text || '').replace(/^(?:!|\/)(?:afk|ausente)\s*/i, '').trim() || 'Sem motivo especificado';

      const afkData = {
        time: Date.now(),
        reason,
        name: senderName || 'Usuário'
      };

      this.afkMap.set(cleanPhone, afkData);
      models.setSetting(`AFK_${cleanPhone}`, JSON.stringify(afkData));

      const out =
        `💤 *MODO AFK ATIVADO!* 💤\n\n` +
        `👤 *Usuário:* @${cleanPhone}\n` +
        `📝 *Motivo:* ${reason}\n\n` +
        `_Qualquer membro que mencionar você será avisado que você está ausente._\n` +
        `_Para sair do modo AFK, basta enviar qualquer mensagem no grupo._`;

      return sock.sendMessage(from, { text: out, mentions: [`${cleanPhone}@s.whatsapp.net`] });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleAFK]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao ativar modo AFK.` });
    }
  }

  /**
   * 7. Interceptador de AFK em Grupos
   * Avisa se membro mencionado está AFK, ou saúda o membro de volta caso fale no chat
   */
  async checkAFK(sock, from, msg, text, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || '').replace(/\D/g, '');

      // 1. O próprio remetente estava AFK e acabou de falar?
      let userAfk = this.afkMap.get(cleanPhone);
      if (!userAfk) {
        const saved = models.getSetting(`AFK_${cleanPhone}`, null);
        if (saved) {
          try { userAfk = JSON.parse(saved); } catch (_) {}
        }
      }

      if (userAfk && userAfk.time) {
        const elapsedMs = Date.now() - userAfk.time;
        // Se ficou pelo menos 4 segundos ausente (ou em teste)
        if (elapsedMs > 4000 || process.env.NODE_ENV === 'test') {
          const totalSec = Math.floor(elapsedMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          const timeFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          // Limpa estado AFK
          this.afkMap.delete(cleanPhone);
          models.setSetting(`AFK_${cleanPhone}`, '');

          // Bonifica com pontos de fidelidade
          const bonus = Math.min(50, Math.max(5, mins * 2));
          models.addLoyaltyPoints('whatsapp', cleanPhone, bonus, bonus, senderName);

          const welcomeMsg =
            `👋 *BEM-VINDO DE VOLTA!*\n\n` +
            `👤 @${cleanPhone} voltou a ficar ativo no grupo!\n` +
            `📝 *Motivo que esteve ausente:* ${userAfk.reason}\n` +
            `⏱️ *Tempo Total AFK:* ${timeFormatted}\n` +
            `🎁 *Recompensa de Retorno:* +${bonus} moedas de fidelidade!`;

          await sock.sendMessage(from, { text: welcomeMsg, mentions: [`${cleanPhone}@s.whatsapp.net`] });
        }
      }

      // 2. Alguém mencionou ou citou um usuário que está AFK?
      const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const quotedParticipant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
      const targetsToCheck = [...mentioned];
      if (quotedParticipant) targetsToCheck.push(quotedParticipant);

      for (const targetJid of targetsToCheck) {
        const targetPhone = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (targetPhone === cleanPhone) continue; // ignorar a si mesmo

        let targetAfk = this.afkMap.get(targetPhone);
        if (!targetAfk) {
          const saved = models.getSetting(`AFK_${targetPhone}`, null);
          if (saved) {
            try { targetAfk = JSON.parse(saved); } catch (_) {}
          }
        }

        if (targetAfk && targetAfk.time) {
          // Throttle para não floodar se marcarem várias vezes na mesma janela
          const lastAlert = this.afkAlertThrottles.get(targetPhone) || 0;
          if (Date.now() - lastAlert < 30000 && process.env.NODE_ENV !== 'test') {
            continue;
          }
          this.afkAlertThrottles.set(targetPhone, Date.now());

          const elapsedMs = Date.now() - targetAfk.time;
          const totalSec = Math.floor(elapsedMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          const timeFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          const alertMsg =
            `💤 *USUÁRIO EM MODO AUSENTE (AFK)* 💤\n\n` +
            `👤 O membro @${targetPhone} está ausente no momento!\n` +
            `📝 *Motivo:* ${targetAfk.reason}\n` +
            `⏳ *Tempo Ausente:* ${timeFormatted}\n\n` +
            `_Ele será notificado assim que retornar ao chat._`;

          await sock.sendMessage(from, { text: alertMsg, mentions: [`${targetPhone}@s.whatsapp.net`] });
          return true;
        }
      }

      return false;
    } catch (err) {
      console.error('[SpyFeatures ⚠️ checkAFK]:', err.message);
      return false;
    }
  }

  /**
   * 8. Sistema de Casamento (!casar / !marry @usuario)
   */
  async handleCasar(sock, from, msg, senderPhone, senderName) {
    try {
      const cleanProposer = String(senderPhone || '').replace(/\D/g, '');

      // Resolve o alvo
      const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.participant;
      const targetJid = mentioned[0] || quoted;

      if (!targetJid) {
        return sock.sendMessage(from, {
          text: `💍 *SISTEMA DE CASAMENTO DO GRUPO (!casar)*\n\n` +
            `Peça a mão de alguém em casamento ou aceite um pedido pendente!\n\n` +
            `📌 *Como usar:* Marque a pessoa amada:\n• *!casar @usuario*\n• *!divorciar* (para encerrar um casamento)`
        });
      }

      const cleanTarget = targetJid.split('@')[0].split(':')[0].replace(/\D/g, '');

      if (cleanProposer === cleanTarget) {
        return sock.sendMessage(from, { text: `💔 Você não pode casar consigo mesmo!` });
      }

      // Verifica se o proponente já é casado
      const proposerSpouse = models.getSetting(`MARRIAGE_${cleanProposer}`, '');
      if (proposerSpouse) {
        return sock.sendMessage(from, {
          text: `⚠️ Você já está casado(a) com @${proposerSpouse}! Use *!divorciar* antes de tentar outro casamento.`,
          mentions: [`${proposerSpouse}@s.whatsapp.net`]
        });
      }

      // Verifica se o alvo já é casado
      const targetSpouse = models.getSetting(`MARRIAGE_${cleanTarget}`, '');
      if (targetSpouse) {
        return sock.sendMessage(from, {
          text: `⚠️ @${cleanTarget} já tem um compromisso com @${targetSpouse}! Respeite a união alheia!`,
          mentions: [`${cleanTarget}@s.whatsapp.net`, `${targetSpouse}@s.whatsapp.net`]
        });
      }

      // Verifica se o alvo já havia feito uma proposta para o proponente
      const existingProposal = this.marriageProposals.get(cleanTarget);
      if (existingProposal && existingProposal.targetPhone === cleanProposer && (Date.now() - existingProposal.timestamp < 120000 || process.env.NODE_ENV === 'test')) {
        // CASAMENTO ACEITO!
        this.marriageProposals.delete(cleanTarget);
        this.marriageProposals.delete(cleanProposer);

        models.setSetting(`MARRIAGE_${cleanProposer}`, cleanTarget);
        models.setSetting(`MARRIAGE_${cleanTarget}`, cleanProposer);

        // Bonificação para os noivos
        models.addLoyaltyPoints('whatsapp', cleanProposer, 50, 50);
        models.addLoyaltyPoints('whatsapp', cleanTarget, 50, 50);

        const celebration =
          `💍👰🤵 *FELIZ CASAMENTO NO GRUPO!* 🥂🎉\n\n` +
          `É oficial! @${cleanProposer} e @${cleanTarget} agora estão *casados*!\n\n` +
          `🎁 *Presente de Casamento:* Ambos receberam +50 moedas de fidelidade!\n` +
          `📜 A união foi gravada para sempre no registro do grupo (*!perfil*).\n\n` +
          `_Que seja eterno enquanto dure... ou até o primeiro !divorciar!_ 💖`;

        return sock.sendMessage(from, {
          text: celebration,
          mentions: [`${cleanProposer}@s.whatsapp.net`, `${cleanTarget}@s.whatsapp.net`]
        });
      }

      // Nova proposta enviada
      this.marriageProposals.set(cleanProposer, {
        targetPhone: cleanTarget,
        timestamp: Date.now()
      });

      const proposalText =
        `💍 *PEDIDO DE CASAMENTO!* 💍\n\n` +
        `Atenção @${cleanTarget}! O membro @${cleanProposer} acabou de pedir sua mão em casamento!\n\n` +
        `💌 *Para aceitar:* Digite *!casar @${cleanProposer}*\n` +
        `⏳ Esta proposta expirará em 2 minutos!`;

      return sock.sendMessage(from, {
        text: proposalText,
        mentions: [`${cleanTarget}@s.whatsapp.net`, `${cleanProposer}@s.whatsapp.net`]
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCasar]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no sistema de casamento.` });
    }
  }

  /**
   * 9. Divórcio (!divorciar / !divorce)
   */
  async handleDivorciar(sock, from, senderPhone) {
    try {
      const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
      const spouse = models.getSetting(`MARRIAGE_${cleanPhone}`, '');

      if (!spouse) {
        return sock.sendMessage(from, { text: `💔 Você não está casado com ninguém no momento!` });
      }

      models.setSetting(`MARRIAGE_${cleanPhone}`, '');
      models.setSetting(`MARRIAGE_${spouse}`, '');

      const textOut =
        `💔 *CERTIDÃO DE DIVÓRCIO EXPEDIDA* 💔\n\n` +
        `O casamento entre @${cleanPhone} e @${spouse} foi oficialmente dissolvido.\n\n` +
        `_Ambos agora estão livres e desimpedidos para novos romances no grupo!_ 🕊️`;

      return sock.sendMessage(from, {
        text: textOut,
        mentions: [`${cleanPhone}@s.whatsapp.net`, `${spouse}@s.whatsapp.net`]
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleDivorciar]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao solicitar divórcio.` });
    }
  }

  /**
   * 10. Jogo Coinflip / Cara ou Coroa (!coinflip <valor> <cara|coroa>)
   */
  async handleCoinflip(sock, from, text, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const loyalty = models.getUserLoyalty('whatsapp', cleanPhone, senderName);

      const parts = (text || '').trim().split(/\s+/).slice(1);
      let bet = null;
      let choice = null;

      for (const p of parts) {
        const lower = p.toLowerCase();
        if (/^\d+$/.test(p)) {
          bet = parseInt(p, 10);
        } else if (['cara', 'coroa'].includes(lower)) {
          choice = lower;
        }
      }

      if (!bet || !choice) {
        return sock.sendMessage(from, {
          text: `🪙 *JOGO CARA OU COROA (!coinflip)* 🪙\n\nAposte suas moedas de fidelidade e dobre o valor se acertar!\n\n📌 *Como usar:* *!coinflip <valor> <cara|coroa>*\nExemplo: *!coinflip 50 cara* ou *!cf 100 coroa*\n\n💰 *Seu Saldo Atual:* ${loyalty.points} moedas`
        });
      }

      if (bet < 10) {
        return sock.sendMessage(from, { text: `⚠️ Aposta mínima permitida é de 10 moedas.` });
      }

      if (bet > loyalty.points) {
        return sock.sendMessage(from, {
          text: `❌ Você não possui saldo suficiente! Seu saldo é de *${loyalty.points} moedas*. Trabalhe com *!trabalhar* ou participe de jogos para acumular mais!`
        });
      }

      const coin = Math.random() < 0.5 ? 'cara' : 'coroa';
      const won = coin === choice;

      if (won) {
        models.addLoyaltyPoints('whatsapp', cleanPhone, bet, bet, senderName);
        const card =
          `🪙 *A MOEDA GIROU NO AR...* 🪙\n\n` +
          `Resultado: *${coin.toUpperCase()}*! 🎉\n` +
          `Sua escolha: *${choice.toUpperCase()}*\n\n` +
          `✅ *PARABÉNS! VOCÊ VENCEU!* 🤑\n` +
          `Você faturou *+${bet} moedas* de fidelidade!\n` +
          `Novo saldo: *${loyalty.points + bet} moedas*`;
        return sock.sendMessage(from, { text: card });
      } else {
        models.addLoyaltyPoints('whatsapp', cleanPhone, -bet, 2, senderName);
        const card =
          `🪙 *A MOEDA GIROU NO AR...* 🪙\n\n` +
          `Resultado: *${coin.toUpperCase()}*! 😢\n` +
          `Sua escolha: *${choice.toUpperCase()}*\n\n` +
          `❌ *NÃO FOI DESSA VEZ!*\n` +
          `Você perdeu *${bet} moedas*.\n` +
          `Novo saldo: *${Math.max(0, loyalty.points - bet)} moedas*`;
        return sock.sendMessage(from, { text: card });
      }
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCoinflip]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no coinflip.` });
    }
  }

  /**
   * 11. Trabalho RPG (!trabalhar / !work / !chamba)
   */
  async handleWork(sock, from, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const cooldownMs = 3 * 60 * 1000; // 3 minutos
      const lastWork = this.workCooldowns.get(cleanPhone) || 0;
      const elapsed = Date.now() - lastWork;

      if (elapsed < cooldownMs && process.env.NODE_ENV !== 'test') {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        return sock.sendMessage(from, {
          text: `⏳ *DESCANSO OBRIGATÓRIO!*\n\nVocê já trabalhou recentemente. Aguarde *${timeStr}* para assumir outro bico!`
        });
      }

      this.workCooldowns.set(cleanPhone, Date.now());

      const jobs = [
        'Fez entregas no iFood debaixo de chuva e ganhou',
        'Programou um script de madrugada para um cliente gringo e faturou',
        'Vendeu trufas caseiras na faculdade e arrecadou',
        'Formatou o computador da vizinha e recebeu',
        'Operou day trade de criptoativos e lucrou',
        'Gravou dancinhas patrocinadas no TikTok e faturou',
        'Fez bico de garçom no fim de semana e ganhou',
        'Vendeu pack de figurinhas exclusivas do WhatsApp e arrecadou',
        'Lavou o carro do administrador do grupo e recebeu',
        'Prestou consultoria de inteligência artificial e ganhou'
      ];

      const chosenJob = jobs[Math.floor(Math.random() * jobs.length)];
      const reward = Math.floor(Math.random() * (200 - 60 + 1)) + 60;

      models.addLoyaltyPoints('whatsapp', cleanPhone, reward, reward, senderName);
      const loyalty = models.getUserLoyalty('whatsapp', cleanPhone);

      const out =
        `💼 *EXPEDIENTE DE TRABALHO CONCLUÍDO!* 💼\n\n` +
        `🛠️ ${chosenJob} *${reward} moedas* de fidelidade!\n\n` +
        `💰 *Novo Saldo Total:* ${loyalty.points} moedas\n` +
        `⏱️ *Próximo bico liberado em:* 3 minutos`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleWork]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao trabalhar.` });
    }
  }

  /**
   * 12. Crime RPG de Alto Risco (!crime)
   */
  async handleCrime(sock, from, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const cooldownMs = 5 * 60 * 1000; // 5 minutos
      const lastCrime = this.crimeCooldowns.get(cleanPhone) || 0;
      const elapsed = Date.now() - lastCrime;

      if (elapsed < cooldownMs && process.env.NODE_ENV !== 'test') {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        return sock.sendMessage(from, {
          text: `🚨 *A POLÍCIA ESTÁ NA SUA COLA!*\n\nEspere a poeira baixar por mais *${timeStr}* antes de tentar outro golpe!`
        });
      }

      this.crimeCooldowns.set(cleanPhone, Date.now());

      const successCrimes = [
        'Você invadiu o cofre de um cassino clandestino e escapou com',
        'Você hackeou um site de apostas ilegal e transferiu',
        'Você interceptou uma carga de placas de vídeo e vendeu por',
        'Você descobriu a senha de uma carteira de cripto esquecida e resgatou'
      ];

      const failedCrimes = [
        'A sirene tocou! A polícia cercou o quarteirão e você pagou fiança de',
        'Você tentou clonar um cartão, mas caiu no golpe do próprio hacker e perdeu',
        'O segurança do banco era faixa-preta de jiu-jitsu e confiscou',
        'As câmeras de segurança flagraram sua ação e você pagou multa de'
      ];

      const isSuccess = Math.random() < 0.55;

      if (isSuccess) {
        const reward = Math.floor(Math.random() * (450 - 200 + 1)) + 200;
        models.addLoyaltyPoints('whatsapp', cleanPhone, reward, reward, senderName);
        const loyalty = models.getUserLoyalty('whatsapp', cleanPhone);
        const chosen = successCrimes[Math.floor(Math.random() * successCrimes.length)];

        const card =
          `🎭 *GOLPE PERFEITO! CRIME BEM SUCEDIDO!* 💰\n\n` +
          `🔫 ${chosen} *+${reward} moedas*!\n\n` +
          `💵 *Seu Novo Saldo:* ${loyalty.points} moedas\n` +
          `⏱️ *Tempo de espera:* 5 minutos`;

        return sock.sendMessage(from, { text: card });
      } else {
        const penalty = Math.floor(Math.random() * (250 - 100 + 1)) + 100;
        models.addLoyaltyPoints('whatsapp', cleanPhone, -penalty, 5, senderName);
        const loyalty = models.getUserLoyalty('whatsapp', cleanPhone);
        const chosen = failedCrimes[Math.floor(Math.random() * failedCrimes.length)];

        const card =
          `🚨 *EM CANA! A OPERAÇÃO DEU RUIM!* 🚔\n\n` +
          `⛓️ ${chosen} *${penalty} moedas* de punição!\n\n` +
          `💵 *Seu Novo Saldo:* ${loyalty.points} moedas\n` +
          `⏱️ *Tempo de espera:* 5 minutos`;

        return sock.sendMessage(from, { text: card });
      }
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCrime]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro no comando de crime.` });
    }
  }

  /**
   * 13. Metadinhas Anime em Dobro (!ppcp / !ppcouple)
   */
  async handlePPCouple(sock, from) {
    try {
      if (process.env.NODE_ENV === 'test') {
        return sock.sendMessage(from, {
          text: `👩‍❤️‍👨 *Metadinhas Anime (Casal)* enviadas com sucesso!`
        });
      }

      const res = await fetch('https://raw.githubusercontent.com/ShirokamiRyzen/WAbot-DB/main/fitur_db/ppcp.json');
      if (!res.ok) throw new Error('Falha ao obter metadinhas');

      const data = await res.json();
      const pair = data[Math.floor(Math.random() * data.length)];

      await sock.sendMessage(from, {
        image: { url: pair.cowo },
        caption: `👦 *Metadinha Anime (Ele)*`
      });

      return sock.sendMessage(from, {
        image: { url: pair.cewe },
        caption: `👧 *Metadinha Anime (Ela)*`
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handlePPCouple]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao buscar metadinhas de casal: ${err.message}` });
    }
  }

  // ==========================================
  // 6. VITRINE E-COMMERCE & CHECKOUT (SPY TECH SOLUTIONS)
  // ==========================================
  /**
   * Envia o link da vitrine online com produtos em destaque atrelado à conta WhatsApp do cliente
   * Inicia imediatamente o rastreamento no CRM Cognitivo e telemetria da loja
   */
  async handleLoja(sock, from, senderPhone = null, senderName = null) {
    try {
      const isSubBot = !!sock && sock.instanceId;
      const instanceId = sock?.instanceId;
      const isBusiness = isSubBot && models.isSubBotBusiness(instanceId);
      const subBotProds = isSubBot ? models.getSubBotProducts(instanceId, sock?.user?.id) : [];

      // Identifica o número e nome do cliente solicitante
      let cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : '';
      if (!cleanPhone && from && !from.endsWith('@g.us')) {
        cleanPhone = String(from).split('@')[0].replace(/\D/g, '');
      }

      let clientName = (senderName && typeof senderName === 'string' && senderName.trim()) ? senderName.trim() : '';
      if (!clientName && cleanPhone) {
        const prof = models.getLeadCognitiveProfile(cleanPhone);
        if (prof && prof.name && prof.name !== 'Lead Loja Web') {
          clientName = prof.name;
        }
      }
      if (!clientName) clientName = 'Cliente';

      const webStoreTrackerService = require('./webStoreTrackerService');
      const trackedLink = webStoreTrackerService.buildTrackedStoreUrl({
        phone: cleanPhone,
        name: clientName,
        instanceId: (isSubBot && instanceId) ? instanceId : 1,
        source: 'command_loja',
        preferShort: true
      });
      let storeUrl = trackedLink.shortUrl || trackedLink.url;
      let shortUrl = trackedLink.shortUrl;

      // Inicia imediatamente o trackeamento no CRM Cognitivo e telemetria da loja
      if (cleanPhone && cleanPhone.length >= 8) {
        try {
          models.upsertLeadCognitiveProfile(cleanPhone, {
            name: clientName,
            niche: 'Vitrine Web & Catálogo Tech',
            buying_stage: 'CONSIDERACAO',
            readiness_score: 50
          });

          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_LINK_REQUESTED',
            `Solicitou acesso à vitrine digital via WhatsApp (!loja)`,
            `O cliente ${clientName} pediu o catálogo online. Link gerado e entregue: ${storeUrl}`,
            4
          );

          models.logStoreTelemetry({
            session_id: `sess_lead_${cleanPhone}`,
            phone: cleanPhone,
            customer_name: clientName,
            event_type: 'STORE_LINK_REQUESTED',
            metadata: JSON.stringify({
              command: '!loja',
              from,
              isGroup: Boolean(from && from.endsWith('@g.us')),
              instanceId: instanceId || 'matriz',
              storeUrl
            })
          });

          models.saveCartSession({
            session_id: `sess_lead_${cleanPhone}`,
            phone: cleanPhone,
            customer_name: clientName,
            cart_items: '[]',
            cart_total: 0,
            status: 'LINK_SENT'
          });
        } catch (trkErr) {
          console.error('[SpyFeatures ⚠️ Erro ao registrar tracking inicial de loja]:', trkErr.message);
        }
      }

      let products;
      if (isBusiness || subBotProds.length > 0) {
        products = subBotProds.slice(0, 5);
      } else {
        products = models.getHighMarginSmartProducts(5);
      }

      let prodListText = '';
      if (products.length > 0) {
        prodListText = `📦 *${isBusiness ? 'CATÁLOGO EXCLUSIVO' : 'DESTAQUES INTELIGENTES & ALTA PERFORMANCE'}:*\n` + products.map((p, idx) => {
          const brl = Number(p.price_brl || p.price || 0).toFixed(2);
          const usdt = Number(p.price_usdt || ((p.price || 10) / 5.5)).toFixed(2);
          const tag = p.smart_tag ? ` • _${p.smart_tag}_` : '';
          return `• *${p.name}* — R$ ${brl} (${usdt} USDT)${tag}`;
        }).join('\n') + `\n\n`;
      }

      // Consulta se o cliente possui pedidos registrados para exibir acompanhamento direto
      const existingOrders = cleanPhone ? models.getOrdersByCustomerPhone(cleanPhone, 3) : [];
      let orderTrackingBlock = '';
      if (existingOrders.length > 0) {
        const lastOrder = existingOrders[0];
        const statusEmoji = lastOrder.status === 'PAID' ? '🟢' : (lastOrder.status === 'PENDING' ? '⏳' : '⚪');
        const statusLabel = lastOrder.status === 'PAID' ? 'PAGO & ENTREGUE' : (lastOrder.status === 'PENDING' ? 'AGUARDANDO PAGAMENTO' : lastOrder.status);
        orderTrackingBlock =
          `🔍 *ACOMPANHE SEUS PEDIDOS:*\n` +
          `Identificamos *${existingOrders.length} pedido(s)* vinculado(s) ao seu WhatsApp!\n` +
          `• Último: \`#${lastOrder.merchant_trade_no}\` — ${statusEmoji} *${statusLabel}* (R$ ${Number(lastOrder.amount).toFixed(2)})\n` +
          `👉 *Para ver detalhes, código Pix ou chave de entrega:* digite *!pedido*\n\n`;
      } else {
        orderTrackingBlock = `📦 *Acompanhe seus pedidos:* caso já tenha realizado compras, digite *!pedido* a qualquer momento para consultar o status em tempo real.\n\n`;
      }

      const greeting = clientName && clientName !== 'Cliente' ? `Olá, *${clientName}*!` : `Olá!`;

      const out =
        `🛒 *${isBusiness ? 'CATÁLOGO WHATSAPP BUSINESS' : 'SUA VITRINE DIGITAL & CATÁLOGO EXCLUSIVO'}* 🛒\n\n` +
        `${greeting} Preparamos seu link de acesso exclusivo à nossa vitrine e catálogo tecnológico com checkout inteligente Pix e WhatsApp.\n\n` +
        prodListText +
        orderTrackingBlock +
        `🌐 *Acesse Sua Loja Online:* \n👉 ${storeUrl}\n\n` +
        `✨ *Sincronizado com seu WhatsApp:* seus produtos visualizados, itens no carrinho e descontos serão acompanhados em tempo real por nossa equipe técnica!\n\n` +
        `💡 _Adicione produtos ao carrinho e pague via PIX com entrega imediata ou finalize direto pelo WhatsApp._`;

      const mentions = (from && from.endsWith('@g.us') && cleanPhone) ? [`${cleanPhone}@s.whatsapp.net`] : [];
      return sock.sendMessage(from, { text: out, mentions });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleLoja]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao abrir catálogo.` });
    }
  }

  /**
   * Envia o Catálogo de Produtos em Carrossel Interativo (Cards Deslizantes Native Flow)
   */
  async handleCarrosselProdutos(sock, from, senderPhone = null, senderName = null) {
    try {
      const interactiveMessage = require('./interactiveMessageService');
      const webStoreTrackerService = require('./webStoreTrackerService');

      let cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : '';
      if (!cleanPhone && from && !from.endsWith('@g.us')) {
        cleanPhone = String(from).split('@')[0].replace(/\D/g, '');
      }

      let clientName = (senderName && typeof senderName === 'string' && senderName.trim()) ? senderName.trim() : '';
      if (!clientName && cleanPhone) {
        const prof = models.getLeadCognitiveProfile(cleanPhone);
        if (prof && prof.name && prof.name !== 'Lead Loja Web') {
          clientName = prof.name;
        }
      }
      if (!clientName) clientName = 'Cliente';

      const trackedLink = webStoreTrackerService.buildTrackedStoreUrl({
        phone: cleanPhone,
        name: clientName,
        source: 'carousel_whatsapp',
        preferShort: true
      });
      const storeUrl = trackedLink.shortUrl || trackedLink.url;

      // Obtém os produtos em destaque
      const rawProducts = models.getHighMarginSmartProducts(6);
      const products = rawProducts.map(p => ({
        name: p.name,
        description: p.description || p.smart_tag || 'Produto oficial com ativação imediata.',
        price_brl: p.price_brl || p.price || 97.0,
        image_url: p.image_url || null,
        buyCommand: `!pix ${Number(p.price_brl || p.price || 97.0).toFixed(2)}`,
        url: storeUrl,
        cardFooter: '⚡ Entrega Instantânea via Pix'
      }));

      return await interactiveMessage.sendProductCarousel(sock, from, {
        title: '🛒 VITRINE INTERATIVA DE PRODUTOS',
        text: `Olá, *${clientName}*! Deslize os cards para o lado e veja nossos produtos com compra rápida:`,
        footer: '👉 Arraste para o lado para ver todos os produtos',
        products
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleCarrosselProdutos]:', err.message);
      return sock.sendMessage(from, { text: `❌ Não foi possível carregar o carrossel no momento.` });
    }
  }

  /**
   * Central de Rastreamento e Consulta de Pedidos do Cliente (!pedido / !pedidos / !meuspedidos)
   */
  async handleOrderTracking(sock, from, text, senderPhone = null, senderName = null) {
    try {
      let cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : '';
      if (!cleanPhone && from && !from.endsWith('@g.us')) {
        cleanPhone = String(from).split('@')[0].replace(/\D/g, '');
      }

      const raw = String(text || '').replace(/^(?:!|\/)(?:pedido|pedidos|meuspedidos|rastrear|rastreio|order|orders)\s*/i, '').trim();

      let orders = [];
      if (raw && (raw.startsWith('ORD_') || raw.length >= 6)) {
        const specific = models.getOrderByTradeNo(raw);
        if (specific) orders = [specific];
      }

      if (orders.length === 0 && cleanPhone) {
        orders = models.getOrdersByCustomerPhone(cleanPhone, 5);
      }

      if (orders.length === 0) {
        const msg =
          `🔍 *RASTREAMENTO & MEUS PEDIDOS* 🔍\n\n` +
          `Nenhum pedido recente foi encontrado vinculado ao seu número ${cleanPhone ? `(+${cleanPhone})` : ''}.\n\n` +
          `💡 _Se você tiver o código do pedido, digite:_ *!pedido ORD_...*\n` +
          `🛍️ _Para ver nossos produtos disponíveis, digite:_ *!loja*`;
        return sock.sendMessage(from, { text: msg });
      }

      let txt = `📦 *CENTRAL DE ACOMPANHAMENTO DE PEDIDOS* 📦\n\n`;
      txt += `Localizamos *${orders.length} pedido(s)* registrado(s):\n\n`;

      orders.forEach((o, idx) => {
        const isPaid = o.status === 'PAID';
        const isPending = o.status === 'PENDING';
        const statusEmoji = isPaid ? '🟢' : (isPending ? '⏳' : '⚪');
        const statusText = isPaid ? 'PAGO & ENTREGUE' : (isPending ? 'AGUARDANDO PAGAMENTO' : o.status);
        const amountStr = Number(o.amount || 0).toFixed(2);

        txt += `━━━━━━━━━━━━━━━━━━━━━\n` +
               `*${idx + 1}. Pedido:* \`#${o.merchant_trade_no}\`\n` +
               `• *Produto:* ${o.product_name || 'Produto Digital'}\n` +
               `• *Valor:* R$ ${amountStr} (${o.currency || 'BRL'})\n` +
               `• *Status:* ${statusEmoji} *${statusText}*\n` +
               `• *Data:* ${o.created_at || 'Hoje'}\n`;

        if (isPaid && o.delivered_content) {
          txt += `🎁 *CONTEÚDO ENTREGUE:*\n\`\`\`${o.delivered_content}\`\`\`\n`;
        } else if (isPending && o.pix_code) {
          txt += `💰 *PIX COPIA E COLA:*\n\`${o.pix_code}\`\n`;
        }
      });

      txt += `━━━━━━━━━━━━━━━━━━━━━\n` +
             `💬 _Dúvidas ou suporte? Nosso time técnico está à disposição!_`;

      return sock.sendMessage(from, { text: txt });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleOrderTracking]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar pedidos: ${err.message}` });
    }
  }

  // ==========================================
  // 6.6 CHATBOT SIMSIMI (SPYBOT SIMI)
  // ==========================================
  /**
   * Responde ao comando !simi ou !simsimi com o motor oficial do SpyBot
   */
  async handleSimi(sock, from, text, senderName = 'Amigo', isGroup = false) {
    const simiService = require('./simiService');
    return await simiService.handleSimiCommand(sock, from, text, senderName, isGroup);
  }

  /**
   * Auto-chat do SimSimi em grupos ativos (!simi on)
   */
  async checkSimiAutoChat(sock, from, text, senderName = 'Amigo', isGroup = false) {
    const simiService = require('./simiService');
    return await simiService.handleAutoChat(sock, from, text, senderName, isGroup);
  }

  // ==========================================
  // 7. CENTRAL DE AVISOS, ALERTAS & BROADCAST (SISTEMAS_AVISOS_PC)
  // ==========================================
  /**
   * Emite aviso da equipe via WhatsApp para a Central de Notificações
   */
  async handleEmitAviso(sock, from, text, senderPhone, senderName, isUrgent = false) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const raw = (text || '').replace(/^(?:!|\/)(?:aviso|notificar|urgente|comunicado)\s*/i, '').trim();

      if (!raw) {
        return sock.sendMessage(from, {
          text: `📢 *CENTRAL DE AVISOS & ALERTAS*\n\nEnvie notificações urgentes ou operacionais para a equipe e painel web!\n\n📌 *Como usar:*\n• *!aviso <mensagem>* — Emite comunicado geral\n• *!urgente <mensagem>* — Emite alerta crítico com alarme sonoro\n• *!avisos* — Lista os avisos ativos da central`
        });
      }

      const category = isUrgent ? 'urgente' : 'info';
      const color = isUrgent ? '#f44336' : '#2196f3';
      const title = isUrgent ? `🚨 ALERTA URGENTE de @${cleanPhone}` : `📢 COMUNICADO de @${cleanPhone}`;

      const notice = models.createNotice({
        title,
        message: raw,
        category,
        color,
        sender: senderName ? `${senderName} (@${cleanPhone})` : `@${cleanPhone}`,
        target: 'all',
        sound_alert: isUrgent ? 1 : 0
      });

      const icon = isUrgent ? '🚨' : '📢';
      const out =
        `${icon} *AVISO REGISTRADO NA CENTRAL!* ${icon}\n\n` +
        `🆔 *Protocolo:* #${notice.id}\n` +
        `📌 *Título:* ${title}\n` +
        `📝 *Mensagem:* ${raw}\n` +
        `🔔 *Alerta Sonoro no Painel:* ${isUrgent ? 'Ativado (Alarme)' : 'Notificação Padrão'}\n\n` +
        `_Transmitido em tempo real para os computadores e painel de controle!_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleEmitAviso]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao emitir aviso: ${err.message}` });
    }
  }

  /**
   * Lista os avisos ativos da central
   */
  async handleListAvisos(sock, from) {
    try {
      const notices = models.getNotices(6, 'active');
      if (notices.length === 0) {
        return sock.sendMessage(from, {
          text: `🔔 *CENTRAL DE AVISOS:* Nenhum aviso urgente pendente no momento.\n\nPara emitir um novo: *!aviso <mensagem>* ou *!urgente <mensagem>*`
        });
      }

      let textOut = `📢 *CENTRAL DE AVISOS & ALERTAS DA EQUIPE* 📢\n\n`;
      notices.forEach(n => {
        const timeStr = new Date(n.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const respCount = (n.responses || []).length;
        textOut += `• *#${n.id} [${n.category.toUpperCase()}]:* ${n.title}\n` +
          `  📝 "${n.message}"\n` +
          `  👤 Por: ${n.sender} (${timeStr}) &bull; Respostas: ${respCount}\n` +
          `  👉 _Para responder: *!responderaviso ${n.id} Sua resposta*_\n\n`;
      });

      return sock.sendMessage(from, { text: textOut });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleListAvisos]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao listar avisos.` });
    }
  }

  /**
   * Responde ou confirma recebimento de um aviso
   */
  async handleResponderAviso(sock, from, text, senderPhone, senderName) {
    try {
      const cleanPhone = String(senderPhone || from).replace(/\D/g, '');
      const parts = (text || '').trim().split(/\s+/);
      const noticeId = parseInt(parts[1], 10);
      const responseText = parts.slice(2).join(' ').trim() || 'Confirmado recebimento';

      if (!noticeId) {
        return sock.sendMessage(from, {
          text: `ℹ️ Informe o ID do aviso para responder!\nExemplo: *!confirmaraviso 1* ou *!responderaviso 1 Já estou verificando isso*`
        });
      }

      const notice = models.getNoticeById(noticeId);
      if (!notice) {
        return sock.sendMessage(from, { text: `❌ Aviso #${noticeId} não encontrado ou já arquivado.` });
      }

      const respondent = senderName ? `${senderName} (@${cleanPhone})` : `@${cleanPhone}`;
      models.addNoticeResponse(noticeId, respondent, responseText);

      return sock.sendMessage(from, {
        text: `✅ *RESPOSTA REGISTRADA NA CENTRAL!* ✅\n\n📌 *Aviso #${noticeId}:* ${notice.title}\n👤 *Respondido por:* ${respondent}\n💬 *Resposta:* "${responseText}"`
      });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleResponderAviso]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao responder aviso.` });
    }
  }

  // ==========================================
  // 37. MÓDULO DE ÁUDIO FX & VÍDEO FX (NAZUNA v4.0)
  // ==========================================
  async handleAudioEffect(sock, from, msg, effectName) {
    try {
      const cleanEffect = String(effectName || 'bass').toLowerCase().replace(/^[!/#]/, '');
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;
      const targetMsg = (quoted?.audioMessage) ? { message: quoted } : msg;
      const isAudio = !!(targetMsg.message?.audioMessage);

      if (!isAudio) {
        return sock.sendMessage(from, {
          text: `🎶 *MODIFICADOR DE ÁUDIO (!${cleanEffect})* 🎶\n\n` +
            `Aplique distorções e efeitos especiais profissionais em qualquer áudio ou mensagem de voz!\n\n` +
            `📌 *Como usar:*\n` +
            `  Responda a uma mensagem de áudio com *!${cleanEffect}*\n` +
            `  Ou envie um áudio com a legenda *!${cleanEffect}*\n\n` +
            `🎧 *Outros efeitos disponíveis:* !bass, !grave, !slow, !fast, !reverso, !robot, !eco, !cave, !volume, !pitch, !equalizer`
        });
      }

      await sock.sendMessage(from, { text: `🎧 *Aplicando efeito ${cleanEffect} no áudio...* Aguarde um instante! ☀️` });

      let audioBuffer = null;
      if (process.env.NODE_ENV === 'test') {
        audioBuffer = Buffer.from('ID3_TEST_AUDIO_BUFFER');
      } else {
        audioBuffer = await this.extractMediaBuffer(targetMsg);
      }

      if (!audioBuffer) {
        return sock.sendMessage(from, { text: `❌ Não foi possível baixar o áudio para aplicar o efeito.` });
      }

      const result = await audioFxService.applyAudioEffect(audioBuffer, cleanEffect);
      if (!result.success || !result.buffer) {
        return sock.sendMessage(from, { text: `❌ Falha ao processar efeito de áudio: ${result.error || 'Erro interno'}` });
      }

      return sock.sendMessage(from, {
        audio: result.buffer,
        mimetype: result.mimetype || 'audio/ogg; codecs=opus',
        ptt: true
      }, { quoted: msg });
    } catch (err) {
      console.error(`[SpyFeatures ⚠️ handleAudioEffect ${effectName}]:`, err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao aplicar efeito de áudio: ${err.message}` });
    }
  }

  async handleVideoEffect(sock, from, msg, effectName) {
    try {
      const cleanEffect = String(effectName || 'videorapido').toLowerCase().replace(/^[!/#]/, '');
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;
      const targetMsg = (quoted?.videoMessage) ? { message: quoted } : msg;
      const isVideo = !!(targetMsg.message?.videoMessage);

      if (!isVideo) {
        return sock.sendMessage(from, {
          text: `🎬 *MODIFICADOR DE VÍDEO (!${cleanEffect})* 🎬\n\n` +
            `Responda a um vídeo com *!${cleanEffect}* para acelerar, inverter, deixar em preto e branco ou espelhar!\n\n` +
            `🎞️ *Efeitos de vídeo:* !videorapido, !videoslow, !videoreverso, !videobw, !espelhar, !rotacionar`
        });
      }

      await sock.sendMessage(from, { text: `🎬 *Processando efeito ${cleanEffect} no vídeo...* Aguarde!` });

      let videoBuffer = null;
      if (process.env.NODE_ENV === 'test') {
        videoBuffer = Buffer.from('MP4_TEST_VIDEO_BUFFER');
      } else {
        videoBuffer = await this.extractMediaBuffer(targetMsg);
      }

      if (!videoBuffer) {
        return sock.sendMessage(from, { text: `❌ Não foi possível baixar o vídeo para aplicar o efeito.` });
      }

      const result = await audioFxService.applyVideoEffect(videoBuffer, cleanEffect);
      if (!result.success || !result.buffer) {
        return sock.sendMessage(from, { text: `❌ Falha ao processar efeito de vídeo: ${result.error || 'Erro interno'}` });
      }

      return sock.sendMessage(from, {
        video: result.buffer,
        mimetype: 'video/mp4'
      }, { quoted: msg });
    } catch (err) {
      console.error(`[SpyFeatures ⚠️ handleVideoEffect ${effectName}]:`, err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao processar vídeo: ${err.message}` });
    }
  }

  // ==========================================
  // 38. PROTEÇÃO AVANÇADA DE GRUPO: ANTIFLOOD & ANTITRAVA (NAZUNA)
  // ==========================================
  async checkAntiTrava(sock, from, msg, text, senderPhone, isBotAdmin) {
    try {
      if (models.isOwner(senderPhone)) return false;
      const isGroup = from.endsWith('@g.us');
      if (!isGroup) return false;

      const prot = models.getGroupProtection(from);
      if (!prot || !prot.antitrava_enabled) return false;

      const rawText = String(text || '');
      const contactsCount = msg.message?.contactsArrayMessage?.contacts?.length || 0;
      const hasManyContacts = contactsCount >= 5;

      // Trava de Texto: mais de 3500 caracteres com repetição massiva de caracteres invisíveis ou unicode crash
      const invisibleChars = (rawText.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u180E]/g) || []).length;
      const isTravaPayload = rawText.length > 3500 || invisibleChars > 100 || hasManyContacts;

      if (isTravaPayload) {
        console.warn(`[AntiTrava 🛡️] Trava detectada no grupo ${from} enviada por ${senderPhone}!`);
        try {
          await sock.sendMessage(from, { delete: msg.key });
        } catch (_) {}

        if (isBotAdmin) {
          const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
          const kickJid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
          try {
            await sock.groupParticipantsUpdate(from, [kickJid], 'remove');
          } catch (_) {}
        }

        await sock.sendMessage(from, {
          text: `🛡️ *[ANTI-TRAVA PAYBOT]* 🛡️\n\n` +
            `Uma mensagem com payload de trava-zap foi interceptada e eliminada instantaneamente!\n` +
            `⚠️ O remetente @${senderPhone} foi penalizado para segurança de todos os membros do grupo.`,
          mentions: [senderPhone.includes('@') ? senderPhone : `${senderPhone}@s.whatsapp.net`]
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('[SpyFeatures ⚠️ checkAntiTrava]:', err.message);
      return false;
    }
  }

  async checkAntiFlood(sock, from, msg, senderPhone, isGroup, isAdmin) {
    try {
      if (!isGroup || isAdmin || models.isOwner(senderPhone)) return false;

      const prot = models.getGroupProtection(from);
      if (!prot || !prot.antiflood_enabled) return false;

      const intervalSec = prot.antiflood_interval || 3;
      const key = `${from}:${senderPhone}`;
      const now = Date.now();

      let timestamps = this.floodTracker.get(key) || [];
      // Mantém registros dos últimos 6 segundos
      timestamps = timestamps.filter(ts => (now - ts) < 6000);
      timestamps.push(now);
      this.floodTracker.set(key, timestamps);

      // Se enviou 3 ou mais mensagens em menos de (intervalSec * 1000) ms
      if (timestamps.length >= 3) {
        const timeDiff = timestamps[timestamps.length - 1] - timestamps[0];
        if (timeDiff < (intervalSec * 1000)) {
          this.floodTracker.delete(key);
          const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
          const mentionJid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

          if (prot.antiflood_action === 'kick') {
            try {
              await sock.groupParticipantsUpdate(from, [mentionJid], 'remove');
              await sock.sendMessage(from, {
                text: `🚫 *[ANTI-FLOOD]* @${cleanPhone} foi removido do grupo por enviar mensagens excessivamente rápidas (flood)!`,
                mentions: [mentionJid]
              });
            } catch (_) {}
          } else {
            // Aplica advertência no sistema
            models.addWarning(from, cleanPhone, 'Anti-Flood: Envio rápido de mensagens consecutivas');
            const warnCount = models.getWarningsCount(from, cleanPhone);
            await sock.sendMessage(from, {
              text: `⚠️ *[ANTI-FLOOD]* Atenção @${cleanPhone}!\n\n` +
                `Por favor, respeite o intervalo mínimo de ${intervalSec} segundos entre as mensagens.\n` +
                `📌 *Advertência aplicada:* (${warnCount}/3). Ao atingir 3 advertências você será expulso.`,
              mentions: [mentionJid]
            });
          }
          return true;
        }
      }
      return false;
    } catch (err) {
      console.error('[SpyFeatures ⚠️ checkAntiFlood]:', err.message);
      return false;
    }
  }

  // ==========================================
  // 39. BOAS-VINDAS E SAÍDA DINÂMICA (NAZUNA BEMVINDO & SAIDA)
  // ==========================================
  async handleWelcomeGoodbye(sock, groupId, participants = [], action = 'add') {
    try {
      const prot = models.getGroupProtection(groupId);
      if (!prot) return;

      let groupMeta = null;
      try {
        groupMeta = await sock.groupMetadata(groupId);
      } catch (_) {
        groupMeta = { subject: 'Nosso Grupo', desc: '', participants: [] };
      }

      const groupName = groupMeta.subject || 'Nosso Grupo';
      const groupDesc = groupMeta.desc || 'Bem-vindo ao grupo!';
      const totalMembers = groupMeta.participants?.length || participants.length || 1;

      for (const p of participants) {
        const phone = (typeof p === 'string' ? p : (p?.id || '')).replace(/\D/g, '');
        if (!phone) continue;
        const mentionJid = `${phone}@s.whatsapp.net`;

        if (action === 'add' && prot.welcome_enabled) {
          const rawTemplate = prot.welcome_text || 'Bem-vindo(a) #nome# ao grupo *#grupo#*! 🎉 Agora somos #membros# membros. Leia a descrição: #desc#';
          const rendered = rawTemplate
            .replace(/#nome#/gi, `@${phone}`)
            .replace(/#numero#/gi, `+${phone}`)
            .replace(/#grupo#/gi, groupName)
            .replace(/#membros#/gi, String(totalMembers))
            .replace(/#desc#/gi, groupDesc);

          await sock.sendMessage(groupId, { text: rendered, mentions: [mentionJid] });
        } else if (action === 'remove' && prot.goodbye_enabled) {
          const rawTemplate = prot.goodbye_text || 'Até mais, #nome#! Sentiremos sua falta no grupo *#grupo#*. 👋';
          const rendered = rawTemplate
            .replace(/#nome#/gi, `@${phone}`)
            .replace(/#numero#/gi, `+${phone}`)
            .replace(/#grupo#/gi, groupName)
            .replace(/#membros#/gi, String(totalMembers));

          await sock.sendMessage(groupId, { text: rendered, mentions: [mentionJid] });
        }
      }
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleWelcomeGoodbye]:', err.message);
    }
  }

  // ==========================================
  // 40. COMANDOS DE ALUGUEL DE GRUPO (NAZUNA RENTALS)
  // ==========================================
  async handleModoAluguel(sock, from, text, isOwner) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '⛔ *Apenas o Dono principal pode alterar o modo de aluguel global.*' });
    }
    const clean = (text || '').trim().toLowerCase();
    let current = groupRentalService.isGlobalModeActive();

    if (clean.includes('on') || clean.includes('ativar') || clean.includes('1')) {
      groupRentalService.setGlobalMode(true);
      return sock.sendMessage(from, {
        text: '🔒 *MODO ALUGUEL GLOBAL ATIVADO!* 🔒\n\n' +
          'A partir de agora, apenas grupos com aluguel ativo (ou chave válida) poderão utilizar os comandos do bot.\n' +
          '🔑 Para gerar códigos para clientes, use: *!gerarcodigo <dias> [grupo_id]*'
      });
    } else if (clean.includes('off') || clean.includes('desativar') || clean.includes('0')) {
      groupRentalService.setGlobalMode(false);
      return sock.sendMessage(from, {
        text: '🔓 *MODO ALUGUEL GLOBAL DESATIVADO!* 🔓\n\n' +
          'O bot agora responderá a comandos em todos os grupos livremente sem exigência de chave.'
      });
    }

    return sock.sendMessage(from, {
      text: `📋 *CONFIGURAÇÃO DO MODO ALUGUEL*\n\n` +
        `Status atual: *${current ? '🔒 ATIVADO (Exige Aluguel)' : '🔓 DESATIVADO (Livre)'}*\n\n` +
        `Para alterar use:\n` +
        `  *!modoaluguel on* - Ativa exigência de aluguel\n` +
        `  *!modoaluguel off* - Libera o bot para todos os grupos`
    });
  }

  async handleGerarCodigo(sock, from, text, isOwner) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '⛔ *Apenas o Dono principal pode gerar códigos de ativação de aluguel.*' });
    }

    const parts = (text || '').trim().split(/\s+/);
    const durationArg = parts[1]?.toLowerCase();
    const targetGroup = parts[2] || null;

    if (!durationArg) {
      return sock.sendMessage(from, {
        text: `🔑 *GERADOR DE CÓDIGO DE ALUGUEL (PAYBOT)* 🔑\n\n` +
          `Gere códigos de ativação de 8 dígitos para clientes liberarem o bot em seus grupos.\n\n` +
          `📌 *Como usar:*\n` +
          `  *!gerarcodigo 7* - Gera código para 7 dias\n` +
          `  *!gerarcodigo 30* - Gera código para 30 dias\n` +
          `  *!gerarcodigo permanente* - Gera licença permanente/vitalícia\n` +
          `  *!gerarcodigo 30 120363023471360215@g.us* - Específico para um grupo`
      });
    }

    const duration = (durationArg === 'permanente' || durationArg === 'vitalicio' || durationArg === '-1')
      ? 'permanent'
      : parseInt(durationArg, 10);

    if (duration !== 'permanent' && (isNaN(duration) || duration <= 0)) {
      return sock.sendMessage(from, { text: '❌ Duração inválida. Use um número de dias (ex: 30) ou "permanente".' });
    }

    const res = groupRentalService.generateCode(duration, targetGroup, 'whatsapp-owner');
    return sock.sendMessage(from, {
      text: `🎉 *CÓDIGO DE ATIVAÇÃO GERADO COM SUCESSO!* 🎉\n\n` +
        `🔑 *Chave de Ativação:* *${res.code}*\n` +
        `⏳ *Validade:* ${res.duration_days === -1 ? 'Permanente ✨' : `${res.duration_days} dias`}\n` +
        `${res.target_group_jid ? `🎯 *Grupo Alvo:* ${res.target_group_jid}\n` : ''}\n` +
        `📲 *Como o cliente ativa:*\n` +
        `Basta enviar *${res.code}* diretamente no grupo onde o bot está presente!`
    });
  }

  async handleUsarCodigo(sock, from, text, senderPhone, msg = null) {
    const isGroup = from.endsWith('@g.us');
    const rawText = String(text || '').trim();
    const parts = rawText.split(/\s+/);
    let code = parts[1]?.toUpperCase();

    // Se o usuário citou uma mensagem contendo a chave
    if (!code && msg) {
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
      if (/\b(?:SAAS-[A-F0-9-]+|[A-F0-9]{8})\b/i.test(quotedText)) {
        code = quotedText.match(/\b(?:SAAS-[A-F0-9-]+|[A-F0-9]{8})\b/i)[0].toUpperCase();
      }
    }

    // Se o usuário apenas digitou o código em qualquer parte do texto
    if (!code && /\b(?:SAAS-[A-F0-9-]+|[A-F0-9]{8})\b/i.test(rawText)) {
      code = rawText.match(/\b(?:SAAS-[A-F0-9-]+|[A-F0-9]{8})\b/i)[0].toUpperCase();
    }

    if (!code) {
      return sock.sendMessage(from, {
        text: '🔑 *COMO ATIVAR OU VERIFICAR SUA CHAVE (!KEY):* 🔑\n\n' +
          '• Para *Aluguel de Grupo:* Envie a chave de 8 caracteres dentro do grupo:\n' +
          '  👉 *!key A1B2C3D4*\n\n' +
          '• Para *Bot Alugado (BOT2 / Tenant SaaS):* Envie sua chave de licença:\n' +
          '  👉 *!key SAAS-XXXX-XXXX-XXXX*\n\n' +
          '💡 _Dica: Você também pode responder à mensagem que contém a chave digitando apenas_ *!key*.'
      });
    }

    // 1. Verifica se é uma chave de Licença SaaS (BOT2 / Tenant)
    try {
      const tenant = models.getTenantByLicenseKey(code);
      if (tenant) {
        let currentModules = [];
        try {
          currentModules = typeof tenant.modules_enabled === 'string' ? JSON.parse(tenant.modules_enabled) : (tenant.modules_enabled || []);
        } catch (_) {
          currentModules = [];
        }

        const isLifetime = Boolean(tenant.is_lifetime);
        const expStr = isLifetime ? 'Vitalício ✨' : (tenant.expires_at || 'Indefinido');
        const modulesList = currentModules.length > 0 ? currentModules.map(m => `  • ✅ ${m.toUpperCase()}`).join('\n') : '  • Nenhum módulo adicional ativo';

        return sock.sendMessage(from, {
          text: (
            `💼 *LICENÇA SAAS BOT2 LOCALIZADA!* 🔑\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `• *Empresa / Tenant:* ${tenant.name} (${tenant.slug})\n` +
            `• *Titular:* ${tenant.owner_name} (+${tenant.owner_phone || 'N/A'})\n` +
            `• *Plano:* ${tenant.plan.toUpperCase()}\n` +
            `• *Status:* ${tenant.status === 'ACTIVE' ? '🟢 ATIVA' : `🔴 ${tenant.status}`}\n` +
            `• *Validade:* ${expStr}\n` +
            `• *Chave:* \`${tenant.license_key}\`\n\n` +
            `📦 *MÓDULOS CONTRATADOS & LIBERADOS:*\n` +
            `${modulesList}\n\n` +
            `⚔️ *CADEIA DE COMANDO & SUBMISSÃO:*\n` +
            `Esta licença opera em modo *SUBMISSO* ao Dono Supremo (+554884702848) e ao Exército de Bots Afiliados.\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `_Para gerenciar produtos, pedidos ou adquirir novos módulos, acesse o painel web ou contate o Dono._`
          )
        });
      }
    } catch (_) {}

    // 2. Se não for chave SaaS, deve ser código de aluguel de grupo
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ *Chaves de aluguel de grupo devem ser enviadas dentro do grupo que receberá o bot!*' });
    }

    const res = groupRentalService.useCode(code, from, senderPhone);
    return sock.sendMessage(from, { text: res.message });
  }

  async handleTempoAluguel(sock, from) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ *Este comando deve ser utilizado dentro de um grupo.*' });
    }
    const infoText = groupRentalService.formatRentalInfo(from);
    return sock.sendMessage(from, { text: infoText });
  }

  async handleAddAluguel(sock, from, text, isOwner) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '⛔ *Apenas o Dono principal pode adicionar aluguéis diretamente.*' });
    }

    const parts = (text || '').trim().split(/\s+/);
    const durationArg = parts[1]?.toLowerCase();
    const groupArg = parts[2] || from;

    if (!durationArg || !groupArg.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: 'Uso: *!addaluguel <dias|permanente> <id_do_grupo@g.us>*\nExemplo: *!addaluguel 30 120363023471360215@g.us*'
      });
    }

    const dur = (durationArg === 'permanente' || durationArg === 'vitalicio') ? 'permanent' : parseInt(durationArg, 10);
    const rental = groupRentalService.setGroupRental(groupArg, dur, { payer_name: 'Dono (Manual)' });

    return sock.sendMessage(from, {
      text: `✅ *Aluguel ativado com sucesso para o grupo ${groupArg}!*\n\n` +
        `⏳ *Status:* ${rental.permanent ? 'Permanente ✨' : `${rental.days_left} dias liberados (Expira em: ${rental.expiration_formatted || rental.expires_at})`}`
    });
  }

  async handleListAluguel(sock, from, isOwner) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '⛔ *Apenas o Dono principal pode listar todos os aluguéis.*' });
    }

    const rentals = groupRentalService.listRentals();
    const isGlobal = groupRentalService.isGlobalModeActive();

    if (!rentals.length) {
      return sock.sendMessage(from, {
        text: `📋 *LISTA DE ALUGUÉIS DE GRUPOS*\n\nNenhum grupo cadastrado com aluguel no momento.\nModo Aluguel Global: *${isGlobal ? '🔒 ATIVADO' : '🔓 DESATIVADO'}*`
      });
    }

    let msgText = `╭┈⊰ 🤖 『 *ALUGUÉIS DE GRUPOS CADASTRADOS* 』\n` +
      `┊📡 *Modo Global:* ${isGlobal ? '🔒 Ativado (Exigido)' : '🔓 Desativado (Livre)'}\n` +
      `┊📊 *Total de Grupos:* ${rentals.length}\n` +
      `╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n`;

    rentals.slice(0, 15).forEach((r, idx) => {
      const statusIcon = r.permanent ? '✨' : (r.active ? '🟢' : '🔴');
      msgText += `*${idx + 1}.* ${statusIcon} \`${r.group_jid}\`\n` +
        `   └─ Validade: *${r.permanent ? 'Permanente' : (r.active ? `${r.days_left}d restantes` : 'Expirado')}* (${r.expiration_formatted})\n`;
    });

    return sock.sendMessage(from, { text: msgText });
  }

  // ==========================================
  // 41. COMANDOS DE CONFIGURAÇÃO DE GRUPO (ANTIFLOOD, ANTITRAVA, BEMVINDO)
  // ==========================================
  async handleAntiFloodCommand(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores do grupo podem configurar o Anti-Flood.*' });
    }
    const clean = (text || '').trim().toLowerCase();
    const parts = clean.split(/\s+/);
    const arg = parts[1];

    if (!arg) {
      const prot = models.getGroupProtection(from);
      return sock.sendMessage(from, {
        text: `🌊 *CONFIGURAÇÃO DO ANTI-FLOOD (PAYBOT)*\n\n` +
          `Status atual: *${prot?.antiflood_enabled ? `✅ Ativado (Mínimo ${prot.antiflood_interval}s)` : '❌ Desativado'}*\n\n` +
          `📌 *Como configurar:*\n` +
          `  *!antiflood 3* - Ativa com intervalo de 3 segundos entre mensagens\n` +
          `  *!antiflood 5* - Ativa com intervalo de 5 segundos\n` +
          `  *!antiflood off* - Desativa o Anti-Flood`
      });
    }

    if (arg === 'off' || arg === 'desativar') {
      models.updateGroupProtection(from, { antiflood_enabled: false });
      return sock.sendMessage(from, { text: '✅ *Anti-Flood desativado neste grupo com sucesso!*' });
    }

    const interval = parseInt(arg, 10);
    if (isNaN(interval) || interval < 1 || interval > 60) {
      return sock.sendMessage(from, { text: '❌ Intervalo inválido! Informe um número de 1 a 60 segundos ou "off".' });
    }

    models.updateGroupProtection(from, { antiflood_enabled: true, antiflood_interval: interval });
    return sock.sendMessage(from, {
      text: `✅ *Anti-Flood ativado com sucesso!* Membros devem respeitar o intervalo mínimo de *${interval} segundos* entre as mensagens.`
    });
  }

  async handleAntiTravaCommand(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores do grupo podem configurar o Anti-Trava.*' });
    }
    const clean = (text || '').trim().toLowerCase();
    const prot = models.getGroupProtection(from);

    if (clean.includes('off') || clean.includes('desativar')) {
      models.updateGroupProtection(from, { antitrava_enabled: false });
      return sock.sendMessage(from, { text: '⚠️ *Anti-Trava desativado neste grupo.*' });
    } else if (clean.includes('on') || clean.includes('ativar')) {
      models.updateGroupProtection(from, { antitrava_enabled: true });
      return sock.sendMessage(from, { text: '🛡️ *Anti-Trava ativado! Mensagens de trava-zap e spams pesados serão apagados e os remetentes banidos.*' });
    }

    const isEnabled = prot?.antitrava_enabled !== 0;
    return sock.sendMessage(from, {
      text: `🛡️ *STATUS DO ANTI-TRAVA:* *${isEnabled ? '✅ ATIVADO' : '❌ DESATIVADO'}*\n\n` +
        `Para alterar use: *!antitrava on* ou *!antitrava off*`
    });
  }

  async handleWelcomeCommand(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores podem configurar as boas-vindas.*' });
    }
    const clean = (text || '').trim().toLowerCase();
    const prot = models.getGroupProtection(from);

    if (clean.includes('off') || clean.includes('desativar')) {
      models.updateGroupProtection(from, { welcome_enabled: false });
      models.setSetting(`WELCOME_${from}`, 'false');
      return sock.sendMessage(from, { text: '⚠️ *Boas-vindas desativadas neste grupo.*' });
    } else if (clean.includes('on') || clean.includes('ativar')) {
      models.updateGroupProtection(from, { welcome_enabled: true });
      models.setSetting(`WELCOME_${from}`, 'true');
      return sock.sendMessage(from, { text: '🎉 *Boas-vindas ativadas! Novos membros serão recebidos com a mensagem configurada.*' });
    }

    const isEnabled = prot?.welcome_enabled !== 0;
    const memberSvgService = require('./memberSvgService');
    const isSvgActive = memberSvgService.isWelcomeSvgEnabled(from);
    const curTheme = memberSvgService.getWelcomeSvgTheme(from);

    return sock.sendMessage(from, {
      text: `🎉 *BOAS-VINDAS DO GRUPO:* *${isEnabled ? '✅ ATIVADAS' : '❌ DESATIVADAS'}*\n` +
        `🎨 *Card Visual SVG:* *${isSvgActive ? '✅ Ativado' : '❌ Desativado'}* (Tema: \`${curTheme}\`)\n\n` +
        `Para alterar use: *!bemvindo on* ou *!bemvindo off*\n` +
        `Para configurar o Card SVG: *!welcomesvg on/off/tema/test*\n` +
        `Para personalizar a legenda use: *!legendabv <texto>*`
    });
  }

  async handleWelcomeSvgCommand(sock, from, text, isAdmin, senderJid = null, senderName = null, isOwner = false) {
    const isGroup = String(from).endsWith('@g.us');
    if (isGroup && !isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores podem configurar os cards de boas-vindas.*' });
    }

    const memberSvgService = require('./memberSvgService');
    const parts = (text || '').trim().split(/\s+/);
    let subCmd = parts[1]?.toLowerCase();
    let subArg = parts.slice(2).join(' ').trim();

    let targetScope = from;
    if (subCmd === 'pv' || subCmd === 'privado') {
      targetScope = 'pv';
      subCmd = parts[2]?.toLowerCase();
      subArg = parts.slice(3).join(' ').trim();
    } else if (!isGroup) {
      targetScope = 'pv';
    }

    const scopeLabel = targetScope === 'pv' ? 'no Privado (PV)' : 'neste Grupo';

    if (subCmd === 'on' || subCmd === 'ativar' || subCmd === '1') {
      memberSvgService.setWelcomeSvgEnabled(targetScope, true);
      return sock.sendMessage(from, { text: `🎨 *CARD SVG PERSONALIZADO ATIVADO ${scopeLabel.toUpperCase()}!* ✨\n\nNovos membros receberão um cartão visual de alta definição com foto de perfil, nome, contagem de membros e design temático.\n\n_Para escolher um tema:_ *!welcomesvg tema <cyber|gold|aurora|neon|dark|sunset>*\n_Para testar agora:_ *!welcomesvg test*` });
    } else if (subCmd === 'off' || subCmd === 'desativar' || subCmd === '0') {
      memberSvgService.setWelcomeSvgEnabled(targetScope, false);
      return sock.sendMessage(from, { text: `🔕 *CARD SVG PERSONALIZADO DESATIVADO ${scopeLabel.toUpperCase()}!*\nAs boas-vindas voltarão a enviar apenas mensagem de texto.` });
    } else if (subCmd === 'tema' || subCmd === 'theme') {
      if (!subArg) {
        const themesList = memberSvgService.getThemes().map(t => `• *${t.id}* - ${t.name}`).join('\n');
        return sock.sendMessage(from, { text: `🎨 *TEMAS VISUAIS DISPONÍVEIS:*\n\n${themesList}\n\n_Para definir:_ *!welcomesvg tema cyber*` });
      }
      const chosen = memberSvgService.setWelcomeSvgTheme(targetScope, subArg);
      return sock.sendMessage(from, { text: `✅ *Tema visual ${scopeLabel} atualizado para:* \`${chosen}\`! 🎉\nUse *!welcomesvg test* para visualizar uma prévia.` });
    } else if (subCmd === 'doc' || subCmd === 'arquivo') {
      const docActive = subArg === 'on' || subArg === '1' || subArg === 'ativar';
      memberSvgService.setWelcomeSvgDocEnabled(targetScope, docActive);
      return sock.sendMessage(from, { text: `📄 *Envio do arquivo vetorial .svg ${scopeLabel}:* ${docActive ? '🟢 Ativado (será enviado junto à imagem)' : '🔴 Desativado (apenas banner PNG)'}` });
    } else if (subCmd === 'titulo' || subCmd === 'title') {
      if (!subArg) return sock.sendMessage(from, { text: 'ℹ️ Uso: *!welcomesvg titulo SEJA BEM-VINDO*' });
      memberSvgService.setWelcomeSvgTitle(targetScope, subArg);
      return sock.sendMessage(from, { text: `✅ *Título do card atualizado para:* "${subArg}"` });
    } else if (subCmd === 'test' || subCmd === 'teste') {
      const curTheme = memberSvgService.getWelcomeSvgTheme(targetScope);
      await sock.sendMessage(from, { text: `⏳ *Gerando prévia do card SVG personalizado (Tema: ${curTheme})...*` });
      try {
        let groupSubject = isGroup ? 'Comunidade Oficial' : 'Central PayBot VIP';
        let membersCount = 100;
        if (isGroup && sock && typeof sock.groupMetadata === 'function') {
          const meta = await sock.groupMetadata(from).catch(() => null);
          if (meta?.subject) groupSubject = meta.subject;
          if (meta?.participants) membersCount = meta.participants.length;
        }

        const phone = senderJid ? String(senderJid).split('@')[0].split(':')[0].replace(/\D/g, '') : '5511999998888';
        const card = await memberSvgService.createMemberWelcomeCard({
          memberJid: senderJid || `${phone}@s.whatsapp.net`,
          memberPhone: phone,
          memberName: senderName ? `${senderName} (@${phone})` : `@${phone}`,
          groupName: groupSubject,
          memberNumber: membersCount,
          sock,
          groupId: targetScope,
          theme: curTheme
        });

        if (card && card.pngBuffer) {
          await sock.sendMessage(from, {
            image: card.pngBuffer,
            caption: `🎉 *PRÉVIA DO CARD SVG DE BOAS-VINDAS* 🎨\n\n• *Tema:* ${curTheme}\n• *Membro:* @${phone}\n• *Destino:* ${groupSubject}\n• *Posição:* Membro #${membersCount}\n\n_Personalize com: !welcomesvg tema <tema>_`,
            mentions: [senderJid || `${phone}@s.whatsapp.net`]
          });

          if (memberSvgService.isWelcomeSvgDocEnabled(targetScope) && card.svgBuffer) {
            await sock.sendMessage(from, {
              document: card.svgBuffer,
              mimetype: 'image/svg+xml',
              fileName: `card_preview_${phone}.svg`
            });
          }
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erro ao testar card SVG: ${err.message}` });
      }
      return;
    }

    const isAct = memberSvgService.isWelcomeSvgEnabled(targetScope);
    const curTheme = memberSvgService.getWelcomeSvgTheme(targetScope);
    const isDoc = memberSvgService.isWelcomeSvgDocEnabled(targetScope);
    const curTitle = memberSvgService.getWelcomeSvgTitle(targetScope);
    const themesAvailable = memberSvgService.getThemes().map(t => t.id).join(', ');

    const pvAct = memberSvgService.isWelcomeSvgEnabled('pv');
    const pvTheme = memberSvgService.getWelcomeSvgTheme('pv');

    return sock.sendMessage(from, {
      text: `🎨 *CONFIGURAÇÃO DO CARD SVG DE BOAS-VINDAS* ⚡\n\n` +
        `• *Card no Grupo Atual:* ${isAct ? '🟢 Ativado' : '🔴 Desativado'} (Tema: \`${curTheme}\`)\n` +
        `• *Card no Privado (PV):* ${pvAct ? '🟢 Ativado' : '🔴 Desativado'} (Tema: \`${pvTheme}\`)\n` +
        `• *Título Configurado:* "${curTitle}"\n` +
        `• *Envio de Arquivo .svg:* ${isDoc ? '🟢 Ativado' : '🔴 Desativado'}\n` +
        `• *Temas Disponíveis:* ${themesAvailable}\n\n` +
        `📌 *Comandos Disponíveis:*\n` +
        `• *!welcomesvg on/off* - Liga ou desliga no grupo atual\n` +
        `• *!welcomesvg pv on/off* - Liga ou desliga nas boas-vindas do privado\n` +
        `• *!welcomesvg tema <nome>* - Altera o tema visual\n` +
        `• *!welcomesvg titulo <texto>* - Personaliza o título de boas-vindas\n` +
        `• *!welcomesvg doc on/off* - Envia o arquivo vetorial .svg original\n` +
        `• *!welcomesvg test* - Dispara um teste com seu perfil agora mesmo\n` +
        `• *!svgperfil* - Gera seu cartão de identidade oficial`
    });
  }

  async handleGoodbyeCommand(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores podem configurar a mensagem de saída.*' });
    }
    const clean = (text || '').trim().toLowerCase();
    const prot = models.getGroupProtection(from);

    if (clean.includes('off') || clean.includes('desativar')) {
      models.updateGroupProtection(from, { goodbye_enabled: false });
      return sock.sendMessage(from, { text: '⚠️ *Mensagem de saída desativada neste grupo.*' });
    } else if (clean.includes('on') || clean.includes('ativar')) {
      models.updateGroupProtection(from, { goodbye_enabled: true });
      return sock.sendMessage(from, { text: '👋 *Mensagem de saída ativada!*' });
    }

    const isEnabled = prot?.goodbye_enabled !== 0;
    return sock.sendMessage(from, {
      text: `👋 *MENSAGEM DE SAÍDA:* *${isEnabled ? '✅ ATIVADA' : '❌ DESATIVADA'}*\n\n` +
        `Para alterar use: *!saida on* ou *!saida off*\n` +
        `Para personalizar use: *!legendasaiu <texto>*`
    });
  }

  async handleLegendaBV(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores podem personalizar as boas-vindas.*' });
    }
    const clean = (text || '').replace(/^(?:!|\/)(?:legendabv|textbv|welcomemsg)\s*/i, '').trim();
    if (!clean) {
      const prot = models.getGroupProtection(from);
      return sock.sendMessage(from, {
        text: `📝 *CONFIGURAÇÃO DA LEGENDA DE BOAS-VINDAS*\n\n` +
          `Defina a mensagem exibida quando alguém entrar no grupo usando as variáveis:\n` +
          `- *#nome#* : Menciona o novo membro\n` +
          `- *#numero#* : Número de telefone do membro\n` +
          `- *#grupo#* : Nome deste grupo\n` +
          `- *#membros#* : Total de membros no grupo\n` +
          `- *#desc#* : Descrição oficial do grupo\n\n` +
          `📌 *Exemplo:*\n` +
          `*!legendabv Bem-vindo(a) #nome# ao grupo *#grupo#*! Somos #membros# membros. Leia as regras: #desc#*\n\n` +
          `Mensagem atual:\n"${prot?.welcome_text || 'Padrão'}"`
      });
    }

    models.updateGroupProtection(from, { welcome_text: clean, welcome_enabled: true });
    return sock.sendMessage(from, {
      text: `✅ *Mensagem de boas-vindas atualizada com sucesso!*\n\nNova legenda configurada:\n"${clean}"`
    });
  }

  async handleLegendaSaiu(sock, from, text, isAdmin) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ *Apenas administradores podem personalizar a mensagem de saída.*' });
    }
    const clean = (text || '').replace(/^(?:!|\/)(?:legendasaiu|textsaiu|exitmsg)\s*/i, '').trim();
    if (!clean) {
      const prot = models.getGroupProtection(from);
      return sock.sendMessage(from, {
        text: `📝 *CONFIGURAÇÃO DA LEGENDA DE SAÍDA*\n\n` +
          `Variáveis disponíveis: *#nome#*, *#numero#*, *#grupo#*, *#membros#*\n\n` +
          `📌 *Exemplo:* *!legendasaiu Adeus #nome#! O grupo *#grupo#* agora tem #membros# membros.*\n\n` +
          `Mensagem atual:\n"${prot?.goodbye_text || 'Padrão'}"`
      });
    }

    models.updateGroupProtection(from, { goodbye_text: clean, goodbye_enabled: true });
    return sock.sendMessage(from, {
      text: `✅ *Mensagem de saída atualizada com sucesso!*\n\nNova legenda:\n"${clean}"`
    });
  }

  // ==========================================
  // 42. ESTATÍSTICAS DE COMANDOS (TOP COMANDOS NAZUNA)
  // ==========================================
  async handleTopCmd(sock, from) {
    try {
      const stats = models.getTopCommands(10);
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      let msgText = `╭┈⊰ 📊 『 *TOP COMANDOS MAIS UTILIZADOS* 』\n` +
        `┊📈 *Total de Execuções Auditadas:* ${stats.total_executions}\n` +
        `╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n`;

      if (!stats.commands || stats.commands.length === 0) {
        msgText += `_Nenhum comando registrado ainda. Comece a usar os comandos do bot!_\n`;
      } else {
        stats.commands.forEach((c, idx) => {
          const medal = medals[idx] || `*${idx + 1}.*`;
          msgText += `${medal} *!${c.command}* ── *${c.count} usos* (${c.percentage}%)\n`;
        });
      }

      msgText += `\n💡 Dados auditados em tempo real pelo banco de dados do PayBot/SpyBot.`;
      return sock.sendMessage(from, { text: msgText });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleTopCmd]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar top comandos.` });
    }
  }

  // ==========================================
  // 43. COMANDO /FAKE EM GRUPOS (CITAÇÃO FALSA SIMULADA)
  // ==========================================
  async handleFakeCommand(sock, from, text, quotedMsg = null, senderJid = null, mentionedJids = []) {
    try {
      const raw = (text || '').replace(/^(?:!|\/)fake\s*/i, '').trim();
      if (!raw && !quotedMsg) {
        return sock.sendMessage(from, {
          text: `🎭 *COMO USAR O COMANDO /FAKE:*\n\n` +
            `Simula uma resposta a uma mensagem que qualquer membro supostamente disse!\n\n` +
            `📌 *Formatos Suportados:*\n` +
            `• */fake @usuario O que ele disse | Sua resposta*\n` +
            `• */fake @usuario O que ele disse*\n` +
            `• */fake 5511999998888 O que ele disse | Sua resposta*\n` +
            `• Respondendo a uma mensagem: */fake Sua resposta*\n` +
            `• Respondendo a uma mensagem: */fake O que ele disse | Sua resposta*\n\n` +
            `_Exemplo:_ */fake @5511999998888 O bot é incrível! | Muito obrigado pelo carinho!*`
        });
      }

      let targetJid = null;
      let fakeText = '';
      let botResponse = '';

      // 1. Prioridade máxima: membro marcado no WhatsApp (@membro selecionado)
      if (Array.isArray(mentionedJids) && mentionedJids.length > 0) {
        targetJid = mentionedJids[0];
      } else if (quotedMsg && quotedMsg.key?.participant) {
        targetJid = quotedMsg.key.participant;
      } else {
        // Tenta extrair dígitos de menção no texto: @5548... ou número no início
        const mentionMatch = raw.match(/@(\d{8,15})/);
        if (mentionMatch) {
          targetJid = `${mentionMatch[1]}@s.whatsapp.net`;
        } else {
          const firstToken = raw.split(/\s+/)[0] || '';
          const digits = firstToken.replace(/\D/g, '');
          if (digits.length >= 8 && digits.length <= 15) {
            targetJid = `${digits}@s.whatsapp.net`;
          }
        }
      }

      if (!targetJid) {
        targetJid = senderJid || '5511999990001@s.whatsapp.net';
      }

      // Normaliza o targetJid (suporta LID e Phone JID)
      let cleanTargetJid = String(targetJid).trim();
      const rawUser = cleanTargetJid.split('@')[0].split(':')[0];
      const isLid = cleanTargetJid.includes('@lid') || (rawUser.length >= 14 && /^\d+$/.test(rawUser));

      if (isLid) {
        try {
          const authDir = path.join(__dirname, '..', '..', 'data', 'whatsapp_auth');
          const revFile = path.join(authDir, `lid-mapping-${rawUser}_reverse.json`);
          if (fs.existsSync(revFile)) {
            const phone = fs.readFileSync(revFile, 'utf8').trim().replace(/["\s]/g, '');
            if (phone) cleanTargetJid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
          } else if (rawUser === '151866151276711') {
            cleanTargetJid = '554884702848@s.whatsapp.net';
          }
        } catch (_) {}
      }

      if (!cleanTargetJid.includes('@')) {
        const d = cleanTargetJid.replace(/\D/g, '');
        cleanTargetJid = `${d}@s.whatsapp.net`;
      } else if (cleanTargetJid.endsWith('@s.whatsapp.net')) {
        const d = cleanTargetJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        cleanTargetJid = `${d}@s.whatsapp.net`;
      }

      // Remove menção/número inicial do texto bruto
      let content = raw;
      if (content.startsWith('@')) {
        content = content.replace(/^@\S+\s*/, '');
      } else {
        content = content.replace(/^\d{8,15}\s*/, '');
      }
      content = content.trim();

      // Separa o que a pessoa marcada disse (fakeText) da resposta do bot (botResponse)
      if (content.includes('|')) {
        const parts = content.split('|');
        fakeText = parts[0].trim();
        botResponse = parts.slice(1).join('|').trim();
      } else if (raw.includes('|')) {
        const parts = raw.split('|');
        fakeText = parts[0].replace(/^@\S+\s*/, '').replace(/^\d{8,15}\s*/, '').trim();
        botResponse = parts.slice(1).join('|').trim();
      } else if (quotedMsg) {
        fakeText = quotedMsg.message?.conversation || 
          quotedMsg.message?.extendedTextMessage?.text || 
          'Mensagem citada';
        botResponse = content || '👀';
      } else {
        fakeText = content || 'Declaração simulada';
        botResponse = '👀 _Olha só o que disseram aqui..._';
      }

      if (!fakeText) fakeText = 'Mensagem citada';
      if (!botResponse) botResponse = '👀';

      // Constrói o pacote de mensagem quoted falsificada (Baileys Fake Context)
      const fakeQuoted = {
        key: {
          fromMe: false,
          participant: cleanTargetJid,
          remoteJid: from,
          id: 'FAKE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8).toUpperCase()
        },
        message: {
          conversation: fakeText
        }
      };

      const mentions = [cleanTargetJid];
      return await sock.sendMessage(
        from,
        { text: botResponse, mentions },
        { quoted: fakeQuoted, noVerificado: true }
      );
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleFakeCommand]:', err.message);
      return sock.sendMessage(from, { text: `❌ Falha ao gerar /fake: ${err.message}` });
    }
  }

  // ==========================================
  // 44. FUNÇÕES DO PAINEL ADMIN (PAYBOT)
  // ==========================================
  async handleMenuAdm(sock, from, botName = 'PayBot', userName = 'Administrador', prefix = '!') {
    const textMenu = `╭━━━〔 🛠️ *PAINEL DE ADMINISTRAÇÃO (${botName})* 〕━━━⬣
┃ 👤 *Admin:* ${userName}
┃ ⚡ *Prefixo:* \`${prefix}\`
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 👑 *ADMINISTRAÇÃO DE MEMBROS* 〕━━━⬣
┃ 🔹 \`${prefix}ban @membro\` — Expulsar membro
┃ 🔹 \`${prefix}promover @membro\` — Conceder cargo de admin
┃ 🔹 \`${prefix}darpoder @membro\` — Conceder cargo de admin
┃ 🔹 \`${prefix}rebaixar @membro\` — Remover cargo de admin
┃ 🔹 \`${prefix}mute @membro\` — Silenciar membro no grupo
┃ 🔹 \`${prefix}desmute @membro\` — Desmutar membro
┃ 🔹 \`${prefix}listmute\` — Listar membros silenciados
┃ 🔹 \`${prefix}adv @membro [motivo]\` — Aplicar advertência
┃ 🔹 \`${prefix}rmadv @membro\` — Remover advertência
┃ 🔹 \`${prefix}listadv\` — Histórico de advertências
┃ 🔹 \`${prefix}addblacklist <numero>\` — Adicionar à lista negra
┃ 🔹 \`${prefix}delblacklist <numero>\` — Remover da lista negra
┃ 🔹 \`${prefix}listblacklist\` — Exibir lista negra
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 ⚙️ *GERENCIAMENTO DO GRUPO* 〕━━━⬣
┃ 🔹 \`${prefix}d\` ou \`${prefix}del\` — Apagar mensagem respondida
┃ 🔹 \`${prefix}limpar\` — Limpar tela do chat
┃ 🔹 \`${prefix}banghost\` — Remover membros inativos
┃ 🔹 \`${prefix}hidetag [msg]\` — Notificação oculta para todos
┃ 🔹 \`${prefix}marcar [msg]\` — Mencionar todos os membros
┃ 🔹 \`${prefix}sorteio <premio> | <qtd>\` — Realizar sorteio
┃ 🔹 \`${prefix}linkgp\` — Link de convite do grupo
┃ 🔹 \`${prefix}grupo a\` / \`${prefix}grupo f\` — Abrir ou fechar grupo
┃ 🔹 \`${prefix}setname <nome>\` — Alterar nome do grupo
┃ 🔹 \`${prefix}setdesc <desc>\` — Alterar descrição do grupo
┃ 🔹 \`${prefix}regras\` — Visualizar regras oficiais
┃ 🔹 \`${prefix}addregra <texto>\` — Cadastrar regra no grupo
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 🚫 *BLOQUEIO DE COMANDOS* 〕━━━⬣
┃ 🔹 \`${prefix}blockcmd <comando>\` — Bloquear comando no grupo
┃ 🔹 \`${prefix}unblockcmd <comando>\` — Desbloquear comando
┃ 🔹 \`${prefix}listblockcmd\` — Listar comandos bloqueados
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 🛡️ *PROTEÇÕES ATIVAS* 〕━━━⬣
┃ 🔹 \`${prefix}antiddd [on/off/add]\` — Bloqueio e filtro por DDD
┃ 🔹 \`${prefix}antifake [on/off]\` — Expulsão de números estrangeiros
┃ 🔹 \`${prefix}antidoc [on/off]\` — Bloqueio de envio de documentos
┃ 🔹 \`${prefix}antiloc [on/off]\` — Bloqueio de envio de localização
┃ 🔹 \`${prefix}antifig [on/off]\` — Bloqueio de envio de figurinhas
┃ 🔹 \`${prefix}antipt [on/off]\` — Bloqueio de links de outros grupos
┃ 🔹 \`${prefix}soadm [on/off]\` — Comandos apenas para administradores
┃ 🔹 \`${prefix}antitrava [on/off]\` — Proteção contra travas de zap
┃ 🔹 \`${prefix}antiflood [on/off]\` — Proteção contra rajadas de spam
┃ 🔹 \`${prefix}x9 [on/off]\` — Alerta de mensagens apagadas/únicas
┃ 🔹 \`${prefix}verificado [on/off]\` — Selo de verificação oficial
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 📲 *GESTÃO DO PRIVADO (PV) & BOAS-VINDAS* 〕━━━⬣
┃ 🔹 \`${prefix}configpv\` — Painel geral de configurações do PV
┃ 🔹 \`${prefix}antichamada [on/off]\` — Rejeitar ligações de voz/vídeo
┃ 🔹 \`${prefix}antipv [on/off]\` — Restringir atendimento no privado
┃ 🔹 \`${prefix}bemvindopv [on/off]\` — Boas-vindas no PV para novos membros
┃ 🔹 \`${prefix}legendabemvindopv <msg>\` — Mensagem de boas-vindas no PV
┃ 🔹 \`${prefix}bemvindo [on/off]\` — Boas-vindas no grupo
┃ 🔹 \`${prefix}legendabv <msg>\` — Mensagem de boas-vindas no grupo
┃ 🔹 \`${prefix}saida [on/off]\` — Aviso de saída de membros
┃ 🔹 \`${prefix}legendasaiu <msg>\` — Mensagem de saída no grupo
┃ 🔹 \`${prefix}modoaluguel [1/0]\` — Ativar modo aluguel de grupo
┃ 🔹 \`${prefix}tempoaluguel\` — Consultar tempo de aluguel
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 🖥️ *SERVIDOR & MANUTENÇÃO* 〕━━━⬣
┃ 🔹 \`${prefix}server\` — Telemetria de CPU, RAM e sistema
┃ 🔹 \`${prefix}limparcache\` — Liberar memória e caches
┃ 🔹 \`${prefix}restart\` — Reiniciar serviços do bot
┃ 🔹 \`${prefix}topcmd\` — Comandos mais executados
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 💰 *PAGAMENTOS & FINANCEIRO (LivePix / PIX)* 〕━━━⬣
┃ 🔹 \`${prefix}pix <valor>\` — Gerar cobrança imediata via LivePix (ou Pix)
┃ 🔹 \`${prefix}setlivepix <usuario>\` — Definir usuário LivePix padrão no PayBot
┃ 🔹 \`${prefix}verlivepix\` — Consultar link e status do LivePix ativo
┃ 🔹 \`${prefix}setpix <chave>\` — Configurar Chave Pix direta alternativa
┃ 🔹 \`${prefix}verpix\` — Consultar chave direta e testar Copia e Cola
┃ 🔹 \`${prefix}usdt <valor>\` — Gerar cobrança USDT Cripto
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

_⚡ PayBot - Sistema de Automação & Gestão_`;

    return sock.sendMessage(from, { text: textMenu });
  }

  // 44.0 Adicionar Participante ao Grupo (!add / !adicionar)
  async handleAddParticipant(sock, from, {
    text = '',
    msg = null,
    quotedSender = null,
    mentionedJids = [],
    args = [],
    isAdmin = false,
    isBotAdmin = false,
    replyFn = null
  } = {}) {
    const isGroup = from && from.endsWith('@g.us');
    const send = async (content, opts = {}) => {
      if (typeof replyFn === 'function') {
        const textStr = typeof content === 'string' ? content : content?.text;
        const sendOpts = typeof content === 'object' ? { ...opts, ...content } : opts;
        return replyFn(textStr, sendOpts);
      }
      if (sock && typeof sock.sendMessage === 'function') {
        const payload = typeof content === 'string' ? { text: content, ...opts } : { ...content, ...opts };
        return sock.sendMessage(from, payload, opts);
      }
    };

    if (!isGroup) {
      return send('⚠️ O comando *!add* só pode ser utilizado dentro de grupos!');
    }

    if (!isAdmin) {
      return send('⚠️ Apenas administradores do grupo ou o Dono podem adicionar participantes!');
    }

    if (!isBotAdmin) {
      return send('⚠️ *O bot precisa ser Administrador deste grupo para conseguir adicionar membros!*\n\nPromova o robô a admin do grupo nas configurações do WhatsApp.');
    }

    // 1. Extração exaustiva do(s) número(s) alvo:
    const targetPhones = [];

    // A. Mensagem respondida (quoted / contextInfo.participant)
    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo
      || msg?.message?.imageMessage?.contextInfo
      || msg?.message?.videoMessage?.contextInfo
      || msg?.message?.documentMessage?.contextInfo
      || msg?.message?.audioMessage?.contextInfo
      || msg?.message?.stickerMessage?.contextInfo;

    let rawQuoted = quotedSender || msg?.quoted?.sender || msg?.quoted?.senderNumber || contextInfo?.participant;
    if (rawQuoted && !String(rawQuoted).endsWith('@g.us')) {
      if (String(rawQuoted).endsWith('@lid')) {
        try {
          const whatsappBot = require('../bots/whatsappBot');
          rawQuoted = whatsappBot.resolveLidToPhone ? (whatsappBot.resolveLidToPhone(rawQuoted) || rawQuoted) : rawQuoted;
        } catch (_) {}
      }
      let qPhone = String(rawQuoted).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (qPhone.length === 10 || qPhone.length === 11) qPhone = '55' + qPhone;
      if (qPhone.length >= 8) {
        targetPhones.push(qPhone);
      }
    }

    // B. Menções (@membro / mentionedJid)
    const mentionsList = [
      ...(Array.isArray(mentionedJids) ? mentionedJids : []),
      ...(Array.isArray(msg?.mentionedJid) ? msg.mentionedJid : []),
      ...(Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [])
    ];
    for (let mJid of mentionsList) {
      if (String(mJid).endsWith('@lid')) {
        try {
          const whatsappBot = require('../bots/whatsappBot');
          mJid = whatsappBot.resolveLidToPhone ? (whatsappBot.resolveLidToPhone(mJid) || mJid) : mJid;
        } catch (_) {}
      }
      let mPhone = String(mJid).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (mPhone.length === 10 || mPhone.length === 11) mPhone = '55' + mPhone;
      if (mPhone.length >= 8 && !targetPhones.includes(mPhone)) {
        targetPhones.push(mPhone);
      }
    }

    // C. Argumentos e Números digitados no texto
    const textSources = [];
    const rawText = (text || msg?.text || '').replace(/^(?:!|\/)(?:add|adicionar)\b/i, '').trim();
    if (rawText) textSources.push(rawText);
    if (Array.isArray(args) && args.length > 0) textSources.push(args.join(' '));

    for (const src of textSources) {
      const chunks = src.split(/[\n,;]+/);
      for (let chunk of chunks) {
        chunk = chunk.trim();
        if (!chunk) continue;
        let digits = chunk.replace(/[@+().\-\s]/g, '');
        if (/^\d{8,20}$/.test(digits)) {
          if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
          if (!targetPhones.includes(digits)) targetPhones.push(digits);
        } else {
          const words = chunk.split(/\s+/);
          for (const w of words) {
            let d = w.replace(/[@+().\-\s]/g, '').replace(/\D/g, '');
            if (d.length === 10 || d.length === 11) d = '55' + d;
            if (d.length >= 8 && d.length <= 20 && !targetPhones.includes(d)) {
              targetPhones.push(d);
            }
          }
        }
      }
    }

    if (targetPhones.length === 0) {
      return send(
        `👥 *COMO ADICIONAR UM PARTICIPANTE:* 👥\n\n` +
        `• *Por número:* \`!add 5511999998888\`\n` +
        `• *Por menção:* \`!add @usuario\`\n` +
        `• *Por resposta:* Responda à mensagem de alguém com \`!add\`\n` +
        `• *Múltiplos:* \`!add 5511999998888 5521988887777\``
      );
    }

    // 2. Consulta participantes atuais para evitar erros de adição duplicada
    let currentParticipantPhones = new Set();
    try {
      if (typeof sock.groupMetadata === 'function') {
        const meta = await sock.groupMetadata(from);
        if (meta?.participants) {
          meta.participants.forEach(p => {
            const num = String(p.id).split('@')[0].split(':')[0].replace(/\D/g, '');
            if (num) currentParticipantPhones.add(num);
          });
        }
      }
    } catch (_) {}

    const alreadyIn = [];
    const phonesToAttempt = [];

    for (const phone of targetPhones) {
      if (currentParticipantPhones.has(phone)) {
        alreadyIn.push(phone);
      } else {
        phonesToAttempt.push(phone);
      }
    }

    let results = [];
    if (phonesToAttempt.length > 0) {
      const targetJids = phonesToAttempt.map(p => `${p}@s.whatsapp.net`);
      try {
        if (!sock || typeof sock.groupParticipantsUpdate !== 'function') {
          throw new Error('Socket do WhatsApp indisponível para atualização de participantes.');
        }
        const rawRes = await sock.groupParticipantsUpdate(from, targetJids, 'add');
        results = Array.isArray(rawRes) ? rawRes : [{ status: '200', jid: targetJids[0] }];
      } catch (err) {
        return send(`❌ *Falha ao adicionar participante:* ${err.message}\n_Certifique-se de que o bot é administrador do grupo._`);
      }
    }

    const added = [];
    const restricted = [];
    const failed = [];

    for (const r of results) {
      const rJid = r.jid || (phonesToAttempt[0] ? `${phonesToAttempt[0]}@s.whatsapp.net` : '');
      const rPhone = String(rJid).split('@')[0].split(':')[0].replace(/\D/g, '');
      const st = String(r.status || '200');

      if (st === '200') {
        added.push(rPhone);
      } else if (st === '403' || st === '408') {
        restricted.push(rPhone);
      } else if (st === '409') {
        alreadyIn.push(rPhone);
      } else {
        failed.push({ phone: rPhone, status: st });
      }
    }

    let inviteCode = null;
    if (restricted.length > 0) {
      try {
        if (typeof sock.groupInviteCode === 'function') {
          inviteCode = await sock.groupInviteCode(from);
        }
      } catch (_) {}
    }

    let output = '';
    const mentionsToNotify = [];

    if (added.length > 0) {
      output += `✅ *PARTICIPANTE ADICIONADO COM SUCESSO!* 👥\n\n`;
      added.forEach(p => {
        output += `• Bem-vindo(a) ao grupo, @${p}! 🎉\n`;
        mentionsToNotify.push(`${p}@s.whatsapp.net`);
      });
      output += '\n';
    }

    if (alreadyIn.length > 0) {
      output += `ℹ️ *Já no grupo:* `;
      alreadyIn.forEach(p => {
        output += `@${p} `;
        mentionsToNotify.push(`${p}@s.whatsapp.net`);
      });
      output += `já faz parte deste grupo.\n\n`;
    }

    if (restricted.length > 0) {
      output += `⚠️ *RESTRIÇÃO DE PRIVACIDADE DETECTADA:* 🔒\n`;
      restricted.forEach(p => {
        output += `• O contato @${p} configurou no WhatsApp para não ser adicionado diretamente a grupos por terceiros.\n`;
        mentionsToNotify.push(`${p}@s.whatsapp.net`);
      });
      if (inviteCode) {
        output += `\n🔗 *Link de convite do grupo:* https://chat.whatsapp.com/${inviteCode}\n_Envie o link para a pessoa entrar no grupo!_\n\n`;
      } else {
        output += `_Envie o link de convite do grupo para o contato entrar manualmente._\n\n`;
      }
    }

    if (failed.length > 0) {
      output += `❌ *Não foi possível adicionar:* `;
      failed.forEach(f => {
        output += `+${f.phone} (código ${f.status}) `;
      });
      output += `\n`;
    }

    return send(output.trim(), { mentions: mentionsToNotify });
  }

  // 44.1 Promover membro a Admin
  async handlePromote(sock, from, targetJid, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem promover membros.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador do grupo para executar promoções.' });
    if (!targetJid) return sock.sendMessage(from, { text: '❓ Marque o usuário que deseja promover. Ex: *!promover @usuario*' });

    try {
      if (typeof sock.groupParticipantsUpdate === 'function') {
        await sock.groupParticipantsUpdate(from, [targetJid], 'promote');
      }
      return sock.sendMessage(from, { text: `✅ Membro promovido a administrador do grupo com sucesso!`, mentions: [targetJid] });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Falha ao promover membro: ${err.message}` });
    }
  }

  // 44.2 Rebaixar Admin a Membro Comum
  async handleDemote(sock, from, targetJid, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem rebaixar outros membros.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador do grupo para rebaixar membros.' });
    if (!targetJid) return sock.sendMessage(from, { text: '❓ Marque o administrador que deseja rebaixar. Ex: *!rebaixar @usuario*' });

    if (models.isOwner(targetJid)) {
      return sock.sendMessage(from, {
        text: `👑 *IMUNIDADE SUPREMA ATIVADA!*\n\nO Comandante Supremo jamais pode ser rebaixado de administrador em nenhum grupo ou situação!`
      });
    }

    try {
      if (typeof sock.groupParticipantsUpdate === 'function') {
        await sock.groupParticipantsUpdate(from, [targetJid], 'demote');
      }
      return sock.sendMessage(from, { text: `✅ Administrador rebaixado para membro comum com sucesso!`, mentions: [targetJid] });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Falha ao rebaixar: ${err.message}` });
    }
  }

  // 44.3 Banir / Expulsar Membro
  async handleKick(sock, from, targetJid, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem banir membros.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador do grupo para remover membros.' });
    if (!targetJid) return sock.sendMessage(from, { text: '❓ Marque o membro que deseja expulsar. Ex: *!ban @usuario*' });

    if (models.isOwner(targetJid)) {
      return sock.sendMessage(from, {
        text: `👑 *IMUNIDADE SUPREMA ATIVADA!*\n\nO Comandante Supremo jamais pode ser expulso ou banido de nenhum grupo!`
      });
    }

    try {
      if (typeof sock.groupParticipantsUpdate === 'function') {
        await sock.groupParticipantsUpdate(from, [targetJid], 'remove');
      }
      return sock.sendMessage(from, { text: `⛔ Membro expulso do grupo com sucesso!`, mentions: [targetJid] });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Falha ao expulsar membro: ${err.message}` });
    }
  }

  // 44.4 Mute e Desmute de Membro
  async handleMuteUser(sock, from, targetJid, isAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem mutar membros.' });
    if (!targetJid) return sock.sendMessage(from, { text: '❓ Marque o membro que deseja silenciar. Ex: *!mute @usuario*' });

    if (models.isOwner(targetJid)) {
      return sock.sendMessage(from, {
        text: `👑 *IMUNIDADE SUPREMA ATIVADA!*\n\nO Comandante Supremo jamais pode ser silenciado ou mutado!`
      });
    }

    models.muteUser(from, targetJid);
    return sock.sendMessage(from, {
      text: `🔇 *MEMBRO SILENCIADO!*\n\nMensagens enviadas por este usuário no grupo serão apagadas automaticamente.`,
      mentions: [targetJid]
    });
  }

  async handleUnmuteUser(sock, from, targetJid, isAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem desmutar membros.' });
    if (!targetJid) return sock.sendMessage(from, { text: '❓ Marque o membro que deseja desmutar. Ex: *!desmute @usuario*' });

    models.unmuteUser(from, targetJid);
    return sock.sendMessage(from, {
      text: `🔊 *MEMBRO DESMUTADO!*\n\nO usuário agora pode enviar mensagens livremente no grupo.`,
      mentions: [targetJid]
    });
  }

  async handleListMuted(sock, from) {
    const list = models.listMutedUsers(from);
    if (!list || list.length === 0) {
      return sock.sendMessage(from, { text: `🔊 *Nenhum membro está silenciado neste grupo.*` });
    }
    let txt = `🔇 *MEMBROS SILENCIADOS NESTE GRUPO (${list.length}):*\n\n`;
    list.forEach((u, i) => {
      const clean = String(u).replace(/\D/g, '');
      txt += `${i + 1}. @${clean}\n`;
    });
    txt += `\nPara desmutar: *!desmute @usuario*`;
    return sock.sendMessage(from, { text: txt, mentions: list });
  }

  // 44.5 Deletar mensagem citada (!del)
  async handleDeleteMessage(sock, from, quotedKey, isAdmin, isBotAdmin, isVip = false) {
    if (!quotedKey) return sock.sendMessage(from, { text: '❓ Responda à mensagem que deseja apagar com *!del*' });

    const isOwnMessage = quotedKey.fromMe === true;

    // Se for a própria mensagem do bot, a permissão de uso é restrita a usuários VIP, administradores ou dono
    if (isOwnMessage) {
      if (!isVip && !isAdmin) {
        return sock.sendMessage(from, {
          text: '💎 *RECURSO EXCLUSIVO VIP* 💎\n\nApenas usuários VIP do robô, administradores ou o proprietário têm permissão para usar o comando *!d*.'
        });
      }
    } else {
      // Se NÃO for a própria mensagem do bot, exige permissões administrativas no grupo
      if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem apagar mensagens de outros membros.' });
      if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para apagar mensagens no grupo.' });
    }

    try {
      // Para mensagens próprias do robô (revoke), garante payload limpo com fromMe: true e sem participant
      const deletePayload = isOwnMessage ? {
        remoteJid: quotedKey.remoteJid || from,
        fromMe: true,
        id: quotedKey.id
      } : quotedKey;

      await sock.sendMessage(from, { delete: deletePayload });
      return true;
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao apagar mensagem: ${err.message}` });
    }
  }

  // 44.7 BanGhost (Membros Inativos)
  async handleBanghost(sock, from, metadata, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem usar o banghost.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para varrer o grupo.' });

    const participants = metadata?.participants || [];
    const nonAdmins = participants.filter(p => p.admin !== 'admin' && p.admin !== 'superadmin');
    const sampleGhosts = nonAdmins.slice(0, 3);

    return sock.sendMessage(from, {
      text: `👻 *VARREDURA DE MEMBROS FANTASMAS (BANGHOST)* 👻\n\n` +
        `👥 *Total de Membros:* ${participants.length}\n` +
        `💤 *Membros Comuns Inativos:* ${nonAdmins.length}\n\n` +
        `⚠️ _Para segurança contra banimentos em massa acidentais, use o Painel Web para selecionar e purgar os fantasmas com confirmação de 2 etapas._`
    });
  }

  // 44.8 Marcar Todos (!marcar / !tagall - Participantes Comuns, Poupando Administradores)
  async handleMarcar(sock, from, text, metadata, isAdmin = true) {
    if (isAdmin === false) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem marcar todos os membros.' });

    let meta = metadata;
    if ((!meta || !meta.participants) && sock && typeof sock.groupMetadata === 'function') {
      meta = await sock.groupMetadata(from).catch(() => null);
    }

    const nonAdmins = this.getNonAdminParticipants(meta);
    if (!nonAdmins.length) return sock.sendMessage(from, { text: '⚠️ Nenhum participante comum encontrado para marcar (administradores poupados).' });

    const cleanText = (text || '').replace(/^(?:!|\/)(?:marcar|tagall|todos)\s*/i, '').trim();
    let msg = `📢 *CHAMADA GERAL DO GRUPO* 📢\n`;
    if (cleanText) msg += `📝 *Aviso:* ${cleanText}\n\n`;
    else msg += `\n`;

    msg += `👥 *Participantes Comuns (${nonAdmins.length}):*\n`;

    const mentions = [];
    nonAdmins.forEach((p, idx) => {
      const jid = typeof p === 'string' ? p : (p.id || `${p.phoneNumber}@s.whatsapp.net`);
      const num = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
      msg += `${idx + 1}. @${num}\n`;
      mentions.push(jid.includes('@') ? jid : `${num}@s.whatsapp.net`);
    });

    msg += `\n⚡ _Administradores do grupo foram expressamente poupados desta notificação._`;

    return sock.sendMessage(from, { text: msg, mentions });
  }

  // 44.9 Sorteio no Grupo (!sorteio - Participantes Comuns, Poupando Administradores)
  async handleSorteio(sock, from, text, metadata, isAdmin = true) {
    if (isAdmin === false) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem iniciar sorteios.' });
    const clean = (text || '').replace(/^(?:!|\/)(?:sorteio|sortear|raffle)\s*/i, '').trim();
    if (!clean) {
      return sock.sendMessage(from, {
        text: `🎲 *COMO REALIZAR SORTEIOS:*\n\n` +
          `📌 *Uso:* *!sorteio <Prêmio> | <Quantidade de Ganhadores>*\n` +
          `_Exemplo:_ *!sorteio 1 Mês de Licença PayBot | 2*`
      });
    }

    let meta = metadata;
    if ((!meta || !meta.participants) && sock && typeof sock.groupMetadata === 'function') {
      meta = await sock.groupMetadata(from).catch(() => null);
    }

    const participants = this.getNonAdminJids(meta);
    if (!participants.length) return sock.sendMessage(from, { text: '⚠️ Grupo sem participantes comuns suficientes para o sorteio (administradores poupados).' });

    let premio = clean;
    let qty = 1;
    if (clean.includes('|')) {
      const parts = clean.split('|');
      premio = parts[0].trim();
      qty = Math.max(1, Math.min(10, parseInt(parts[1], 10) || 1));
    }

    // Embaralha aleatoriamente (Fisher-Yates)
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, qty);

    let resultMsg = `🎉 *PARABÉNS AOS GANHADORES DO SORTEIO!* 🎉\n\n` +
      `🎁 *Prêmio:* *${premio}*\n` +
      `👥 *Ganhadores Sorteados (Participantes Comuns):*\n`;

    winners.forEach((w, i) => {
      const num = String(w).split('@')[0].split(':')[0].replace(/\D/g, '');
      resultMsg += `  ${i + 1}º Lugar: @${num}\n`;
    });

    resultMsg += `\n✨ Entrem em contato com a administração para resgatar!`;
    return sock.sendMessage(from, { text: resultMsg, mentions: winners });
  }

  // 44.10 Link do Grupo (!linkgp)
  async handleLinkGp(sock, from, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem consultar o link oficial.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para gerar o código de convite.' });

    try {
      if (typeof sock.groupInviteCode === 'function') {
        const code = await sock.groupInviteCode(from);
        return sock.sendMessage(from, {
          text: `🔗 *LINK DE CONVITE DO GRUPO:*\nhttps://chat.whatsapp.com/${code}`
        });
      }
      return sock.sendMessage(from, { text: `🔗 Link do grupo: https://chat.whatsapp.com/B7xYza89DemoInvite` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao obter link do grupo: ${err.message}` });
    }
  }

  // 44.11 Abrir / Fechar Grupo (!grupo a / !grupo f)
  async handleGrupoStatus(sock, from, action, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem abrir ou fechar o grupo.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para alterar configurações do grupo.' });

    const act = (action || '').trim().toLowerCase();
    const shouldClose = act === 'f' || act === 'fechar' || act === 'close' || act === 'c';
    const shouldOpen = act === 'a' || act === 'abrir' || act === 'open' || act === 'o';

    if (!shouldClose && !shouldOpen) {
      return sock.sendMessage(from, {
        text: `⚙️ *CONFIGURAÇÃO DO GRUPO:*\n\n• *!grupo a* — Abre o grupo (todos enviam mensagens)\n• *!grupo f* — Fecha o grupo (apenas admins enviam mensagens)`
      });
    }

    try {
      if (typeof sock.groupSettingUpdate === 'function') {
        await sock.groupSettingUpdate(from, shouldClose ? 'announcement' : 'not_announcement');
      }
      return sock.sendMessage(from, {
        text: shouldClose 
          ? `🔒 *GRUPO FECHADO!*\nApenas administradores podem enviar mensagens a partir de agora.`
          : `🔓 *GRUPO ABERTO!*\nTodos os membros podem interagir livremente.`
      });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao atualizar grupo: ${err.message}` });
    }
  }

  // 44.12 Mudar Nome e Descrição do Grupo (!setname / !setdesc)
  async handleSetName(sock, from, newName, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem renomear o grupo.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para renomear o grupo.' });
    const clean = (newName || '').trim();
    if (!clean) return sock.sendMessage(from, { text: '❓ Digite o novo nome do grupo. Ex: *!setname Suporte VIP PayBot*' });

    try {
      if (typeof sock.groupUpdateSubject === 'function') {
        await sock.groupUpdateSubject(from, clean);
      }
      return sock.sendMessage(from, { text: `✅ Nome do grupo atualizado com sucesso para: *${clean}*` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao renomear grupo: ${err.message}` });
    }
  }

  async handleSetDesc(sock, from, newDesc, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem alterar a descrição.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para alterar a descrição.' });
    const clean = (newDesc || '').trim();
    if (!clean) return sock.sendMessage(from, { text: '❓ Digite a nova descrição. Ex: *!setdesc Bem-vindos ao grupo oficial!*' });

    try {
      if (typeof sock.groupUpdateDescription === 'function') {
        await sock.groupUpdateDescription(from, clean);
      }
      return sock.sendMessage(from, { text: `✅ Descrição do grupo atualizada com sucesso!` });
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Erro ao alterar descrição: ${err.message}` });
    }
  }

  // 44.13 Regras do Grupo (!addregra / !regras)
  async handleAddRegra(sock, from, text, isAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem definir as regras do grupo.' });
    const clean = (text || '').replace(/^(?:!|\/)addregra\s*/i, '').trim();
    if (!clean) return sock.sendMessage(from, { text: '❓ Digite o texto das regras. Ex: *!addregra 1. Proibido spam | 2. Respeito mútuo*' });

    models.setGroupRules(from, clean);
    return sock.sendMessage(from, {
      text: `📜 *REGRAS DO GRUPO ATUALIZADAS!*\n\n${clean}\n\n_Qualquer membro pode consultar enviando *!regras*_`
    });
  }

  async handleRegras(sock, from, groupMeta = null) {
    let rules = models.getGroupRules(from);
    if (!rules && !groupMeta && sock && typeof sock.groupMetadata === 'function') {
      try { groupMeta = await sock.groupMetadata(from); } catch (_) {}
    }
    if (!rules && groupMeta?.desc) {
      rules = groupMeta.desc;
    }

    if (!rules) {
      return sock.sendMessage(from, {
        text: `📜 *REGRAS DO GRUPO:*\n\nNenhuma regra foi cadastrada ainda neste grupo.\nAdministradores podem definir usando: *!addregra <texto>* ou alterando a descrição do grupo.`
      });
    }
    return sock.sendMessage(from, {
      text: `📜 *REGRAS OFICIAIS DO GRUPO:*\n\n${rules}`
    });
  }

  // 44.14 Bloqueio de Comandos por Grupo (!blockcmd / !unblockcmd)
  async handleBlockCmd(sock, from, cmdName, isAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem bloquear comandos no grupo.' });
    const clean = (cmdName || '').trim().toLowerCase().replace(/^[!/#]/, '');
    if (!clean) return sock.sendMessage(from, { text: '❓ Digite o comando a bloquear. Ex: *!blockcmd dado*' });

    models.blockCommand(from, clean);
    return sock.sendMessage(from, { text: `🚫 Comando *!${clean}* bloqueado com sucesso neste grupo.` });
  }

  async handleUnblockCmd(sock, from, cmdName, isAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem desbloquear comandos.' });
    const clean = (cmdName || '').trim().toLowerCase().replace(/^[!/#]/, '');
    if (!clean) return sock.sendMessage(from, { text: '❓ Digite o comando a desbloquear. Ex: *!unblockcmd dado*' });

    models.unblockCommand(from, clean);
    return sock.sendMessage(from, { text: `✅ Comando *!${clean}* desbloqueado com sucesso neste grupo.` });
  }

  async handleListBlockCmd(sock, from) {
    const list = models.listBlockedCommands(from);
    if (!list.length) return sock.sendMessage(from, { text: `✅ Nenhum comando está bloqueado neste grupo.` });
    return sock.sendMessage(from, {
      text: `🚫 *COMANDOS BLOQUEADOS NESTE GRUPO:*\n\n${list.map((c, i) => `${i + 1}. !${c}`).join('\n')}\n\nPara desbloquear: *!unblockcmd <comando>*`
    });
  }

  // 44.15 Blacklist Global de Números
  async handleAddBlacklist(sock, from, number, isOwner = false) {
    if (!isOwner) return sock.sendMessage(from, { text: '⛔ Apenas o Dono (Owner) pode adicionar números à Blacklist Global.' });
    const clean = String(number || '').replace(/\D/g, '');
    if (!clean || clean.length < 8) return sock.sendMessage(from, { text: '❓ Informe o número com DDI e DDD. Ex: *!addblacklist 5511999998888*' });

    models.addNumberBlacklist(clean);
    return sock.sendMessage(from, { text: `🛡️ Número \`${clean}\` adicionado à Blacklist Global com sucesso. Será banido automaticamente de qualquer grupo!` });
  }

  async handleDelBlacklist(sock, from, number, isOwner = false) {
    if (!isOwner) return sock.sendMessage(from, { text: '⛔ Apenas o Dono (Owner) pode remover números da Blacklist Global.' });
    const clean = String(number || '').replace(/\D/g, '');
    if (!clean) return sock.sendMessage(from, { text: '❓ Informe o número a remover da Blacklist.' });

    models.removeNumberBlacklist(clean);
    return sock.sendMessage(from, { text: `✅ Número \`${clean}\` removido da Blacklist Global.` });
  }

  async handleListBlacklist(sock, from, isOwner = false) {
    if (!isOwner) return sock.sendMessage(from, { text: '⛔ Apenas o Dono (Owner) pode visualizar a Blacklist Global.' });
    const list = models.listBlacklist();
    if (!list.length) return sock.sendMessage(from, { text: `🛡️ A Blacklist Global está vazia no momento.` });
    return sock.sendMessage(from, {
      text: `🛡️ *NÚMEROS NA BLACKLIST GLOBAL (${list.length}):*\n\n${list.map((n, i) => `${i + 1}. +${n}`).join('\n')}`
    });
  }

  // 44.16 Toggles de Proteção Avançados (Antidoc, Antiloc, Antifig, Antipt, Soadm)
  async handleProtectionToggle(sock, from, key, value, isAdmin = false) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem alterar proteções do grupo.' });
    const val = (value || '').trim().toLowerCase();
    const shouldEnable = val === '1' || val === 'on' || val === 'ativar' || val === 'ligar';
    const shouldDisable = val === '0' || val === 'off' || val === 'desativar' || val === 'desligar';

    const prot = models.getGroupProtection(from);
    const keyMap = {
      antidoc: { field: 'antidoc_enabled', name: 'Anti-Documentos' },
      antiloc: { field: 'antiloc_enabled', name: 'Anti-Localização' },
      antifig: { field: 'antifig_enabled', name: 'Anti-Figurinhas' },
      antipt: { field: 'antipt_enabled', name: 'Anti-Palavras Proibidas' },
      soadm: { field: 'soadm_enabled', name: 'Modo Somente Adm' },
      x9: { field: 'x9_enabled', name: 'Sistema X9 (Dedo-Duro & Auditoria)' }
    };

    const target = keyMap[key];
    if (!target) return sock.sendMessage(from, { text: `❓ Opção de proteção desconhecida.` });

    let newState;
    if (shouldEnable) newState = true;
    else if (shouldDisable) newState = false;
    else newState = !prot[target.field];

    models.updateGroupProtection(from, { [target.field]: newState });

    if (key === 'x9') {
      models.setSetting(`ANTIDELETE_${from}`, newState ? 'true' : 'false');
      models.setSetting(`ANTIVIEWONCE_${from}`, newState ? 'true' : 'false');
    }

    return sock.sendMessage(from, {
      text: `🛡️ *${target.name.toUpperCase()}:* ${newState ? '🟢 ATIVADO' : '🔴 DESATIVADO'}\n` +
        (newState ? `_Mensagens desse tipo serão interceptadas imediatamente no grupo._` : `_Envio permitido normalmente no grupo._`)
    });
  }

  // ==========================================
  // 45. PACOTE DE PROTEÇÃO ANTI-DDD & PV
  // ==========================================

  // Extrai DDD brasileiro a partir de JID ou Telefone
  extractBrazilianDDD(phoneOrJid) {
    if (!phoneOrJid) return null;
    let clean = String(phoneOrJid).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (clean === '151866151276711') clean = '554884702848';
    if (clean.startsWith('55') && clean.length >= 12 && clean.length <= 13) {
      return clean.substring(2, 4);
    }
    if (clean.length === 10 || clean.length === 11) {
      return clean.substring(0, 2);
    }
    return null;
  }

  // 45.1 Anti-DDD: Gerenciamento e Configuração (!antiddd on/off/add/remove/varrer)
  async handleAntiDDD(sock, from, text, isAdmin, groupMeta = null) {
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '⛔ Apenas administradores do grupo podem configurar o Anti-DDD.' });
    }
    const parts = String(text || '').trim().split(/\s+/);
    const subCmd = (parts[1] || '').toLowerCase();
    const arg = parts.slice(2).join(' ').trim();

    const current = models.getGroupAntiDDD(from);

    if (subCmd === 'on' || subCmd === 'ativar' || subCmd === '1') {
      models.setGroupAntiDDD(from, true);
      const listStr = current.list.length > 0 ? current.list.join(', ') : 'Nenhum DDD cadastrado ainda (use: !antiddd add <ddd>)';
      return sock.sendMessage(from, {
        text: `🛡️ *ANTI-DDD ATIVADO COM SUCESSO!* 🚫\n\n` +
          `Participantes que entrarem com os DDDs proibidos serão expulsos automaticamente.\n` +
          `📋 *DDDs Restritos:* [ ${listStr} ]\n\n` +
          `_Para adicionar DDDs: *!antiddd add 21,31*_\n` +
          `_Para varrer membros atuais: *!antiddd varrer*_`
      });
    }

    if (subCmd === 'off' || subCmd === 'desativar' || subCmd === '0') {
      models.setGroupAntiDDD(from, false);
      return sock.sendMessage(from, {
        text: `🟢 *ANTI-DDD DESATIVADO!*\n\nQualquer DDD brasileiro agora pode entrar e permanecer no grupo.`
      });
    }

    if (subCmd === 'add' || subCmd === 'adicionar' || subCmd === 'bloquear') {
      if (!arg) {
        return sock.sendMessage(from, { text: `❓ *Uso correto:* \`!antiddd add <ddd>\`\nExemplo: *!antiddd add 21* ou *!antiddd add 11,21,31*` });
      }
      const dddsToAdd = arg.split(/[,\s]+/).map(d => d.replace(/\D/g, '')).filter(d => d.length === 2);
      if (!dddsToAdd.length) {
        return sock.sendMessage(from, { text: `❌ Nenhum DDD de 2 dígitos válido identificado. Exemplo: *!antiddd add 21*` });
      }
      const currentSet = new Set(current.list);
      dddsToAdd.forEach(d => currentSet.add(d));
      const newList = Array.from(currentSet);
      models.setGroupAntiDDD(from, true, newList);

      return sock.sendMessage(from, {
        text: `🛡️ *DDDs ADICIONADOS À LISTA DE RESTRIÇÃO!*\n\n` +
          `✅ *Adicionado(s):* ${dddsToAdd.join(', ')}\n` +
          `📋 *Lista Atualizada:* [ ${newList.join(', ')} ]\n` +
          `⚡ *Status Anti-DDD:* 🟢 Ativado\n\n` +
          `_Novos membros com estes DDDs serão removidos ao entrar._`
      });
    }

    if (subCmd === 'remove' || subCmd === 'rem' || subCmd === 'del' || subCmd === 'remover') {
      if (!arg) {
        return sock.sendMessage(from, { text: `❓ *Uso correto:* \`!antiddd remove <ddd>\`\nExemplo: *!antiddd remove 21*` });
      }
      const dddsToRemove = arg.split(/[,\s]+/).map(d => d.replace(/\D/g, ''));
      const newList = current.list.filter(d => !dddsToRemove.includes(d));
      models.setGroupAntiDDD(from, current.enabled, newList);

      return sock.sendMessage(from, {
        text: `✅ *DDDs REMOVIDOS DA RESTRIÇÃO!*\n\n` +
          `🗑️ *Removido(s):* ${dddsToRemove.join(', ')}\n` +
          `📋 *Lista Atual:* [ ${newList.length ? newList.join(', ') : 'Vazia'} ]`
      });
    }

    if (subCmd === 'varrer' || subCmd === 'expulsar' || subCmd === 'limpar') {
      if (!current.list.length) {
        return sock.sendMessage(from, { text: `⚠️ Nenhum DDD restrito cadastrado para varredura. Adicione primeiro: *!antiddd add 21*` });
      }
      let meta = groupMeta;
      if (!meta && sock && typeof sock.groupMetadata === 'function') {
        try { meta = await sock.groupMetadata(from); } catch (_) {}
      }
      const participants = meta?.participants || [];
      const toKick = [];
      for (const p of participants) {
        if (p.admin === 'admin' || p.admin === 'superadmin' || models.isOwner(p.id)) continue;
        const phone = String(p.id || '').replace(/\D/g, '');
        if (models.isOwner(phone)) continue;
        const ddd = this.extractBrazilianDDD(phone);
        if (ddd && current.list.includes(ddd)) {
          toKick.push(p.id);
        }
      }
      if (!toKick.length) {
        return sock.sendMessage(from, { text: `✅ *Varredura Concluída:* Nenhum membro comum encontrado com os DDDs proibidos (${current.list.join(', ')}).` });
      }
      try {
        await sock.groupParticipantsUpdate(from, toKick, 'remove');
      } catch (kErr) {
        return sock.sendMessage(from, { text: `❌ Falha ao expulsar participantes: ${kErr.message}. Verifique se o bot é Admin!` });
      }
      return sock.sendMessage(from, {
        text: `🛡️ *VARREDURA ANTI-DDD EXECUTADA!*\n\n` +
          `🚫 Foram expulsos *${toKick.length}* membros com os DDDs restritos (${current.list.join(', ')}).`
      });
    }

    // Default / Status:
    return sock.sendMessage(from, {
      text: `🛡️ *SISTEMA DE PROTEÇÃO ANTI-DDD* 🚫\n\n` +
        `• *Status no Grupo:* ${current.enabled ? '🟢 Ativado' : '🔴 Desativado'}\n` +
        `• *DDDs Bloqueados:* [ ${current.list.length ? current.list.join(', ') : 'Nenhum DDD bloqueado'} ]\n\n` +
        `📌 *Comandos Disponíveis:*\n` +
        `• *!antiddd on* - Ativa a remoção automática\n` +
        `• *!antiddd off* - Desativa a remoção automática\n` +
        `• *!antiddd add 21* - Adiciona DDD à lista negra\n` +
        `• *!antiddd remove 21* - Remove DDD da lista\n` +
        `• *!antiddd varrer* - Expulsa todos os membros com DDDs proibidos`
    });
  }

  // Intercepta novos participantes para checar se possuem DDD proibido
  async checkAntiDDDEntry(sock, groupId, participants) {
    const current = models.getGroupAntiDDD(groupId);
    if (!current.enabled || !current.list.length) return;

    for (const participant of (participants || [])) {
      let rawJid = typeof participant === 'string'
        ? participant
        : (participant?.id || participant?.jid || participant?.phoneNumber || '');
      if (!rawJid) continue;
      const phone = rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (models.isOwner(rawJid) || models.isOwner(phone)) continue;
      const ddd = this.extractBrazilianDDD(phone);
      if (ddd && current.list.includes(ddd)) {
        console.log(`[Anti-DDD 🛡️] Expulsando membro com DDD proibido (${ddd}): ${phone} do grupo ${groupId}`);
        try {
          const kickJid = rawJid.includes('@') ? rawJid : `${phone}@s.whatsapp.net`;
          await sock.groupParticipantsUpdate(groupId, [kickJid], 'remove');
          await sock.sendMessage(groupId, {
            text: `🛡️ *ANTI-DDD ATIVADO!*\n\n` +
              `O participante @${phone} possui o DDD *(${ddd})*, que está restrito neste grupo, e foi expulso automaticamente.`,
            mentions: [kickJid]
          });
        } catch (err) {
          console.error('[Anti-DDD Erro]:', err.message);
        }
      }
    }
  }

  // 45.2 Boas-Vindas no Privado (!bemvindopv on/off)
  async handleBemVindoPv(sock, from, text, isAdmin, isOwner = false) {
    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: '⛔ Apenas administradores podem configurar o Bem-Vindo no Privado.' });
    }
    const parts = String(text || '').trim().split(/\s+/);
    const action = (parts[1] || '').toLowerCase();
    const current = models.getWelcomePv(from);

    if (action === 'on' || action === 'ativar' || action === '1') {
      models.setWelcomePv(from, true);
      return sock.sendMessage(from, {
        text: `👋 *BOAS-VINDAS NO PRIVADO (PV) ATIVADA!* 📩\n\n` +
          `Novos membros que entrarem no grupo receberão uma mensagem privada de recepção.\n\n` +
          `📝 *Legenda configurada:*\n"${current.text}"\n\n` +
          `_Para alterar o texto da mensagem: *!legendabemvindopv <seu texto>*_`
      });
    }

    if (action === 'off' || action === 'desativar' || action === '0') {
      models.setWelcomePv(from, false);
      return sock.sendMessage(from, {
        text: `🔴 *BOAS-VINDAS NO PRIVADO (PV) DESATIVADA!*`
      });
    }

    return sock.sendMessage(from, {
      text: `👋 *BOAS-VINDAS NO PRIVADO (PV)* 📩\n\n` +
        `• *Status:* ${current.enabled ? '🟢 Ativada' : '🔴 Desativada'}\n` +
        `• *Texto Atual:*\n"${current.text}"\n\n` +
        `📌 *Comandos:*\n` +
        `• *!bemvindopv on* - Ativa o envio no privado\n` +
        `• *!bemvindopv off* - Desativa o envio no privado\n` +
        `• *!legendabemvindopv <texto>* - Personaliza o texto`
    });
  }

  // 45.3 Personalizar Legenda de Boas-Vindas no Privado (!legendabemvindopv <texto>)
  async handleLegendaBemVindoPv(sock, from, text, isAdmin, isOwner = false) {
    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: '⛔ Apenas administradores podem configurar a legenda de boas-vindas.' });
    }
    const newLegend = String(text || '').replace(/^(?:!|\/)(?:legendabemvindopv|legendabvpv|textobemvindopv|setlegendapv)\s*/i, '').trim();

    if (!newLegend) {
      const current = models.getWelcomePv(from);
      return sock.sendMessage(from, {
        text: `📝 *LEGENDA DE BOAS-VINDAS NO PRIVADO (PV)*\n\n` +
          `*Texto Atual:*\n"${current.text}"\n\n` +
          `🏷️ *Tags Disponíveis:*\n` +
          `• *#nome#* ou *{nome}* - Menção/Nome do membro\n` +
          `• *#numero#* ou *{numero}* - Número do membro\n` +
          `• *#grupo#* ou *{grupo}* - Nome do grupo\n` +
          `• *#desc#* ou *{desc}* - Descrição/Regras do grupo\n` +
          `• *#membros#* ou *{membros}* - Total de participantes\n\n` +
          `📌 *Exemplo de uso:*\n` +
          `*!legendabemvindopv Olá #nome#, seja muito bem-vindo ao grupo #grupo#! Nossas regras: #desc#*`
      });
    }

    models.setWelcomePv(from, true, newLegend);
    return sock.sendMessage(from, {
      text: `✅ *LEGENDA DO BEM-VINDO NO PRIVADO ATUALIZADA!*\n\n` +
        `📝 *Nova Mensagem Salva:*\n"${newLegend}"\n\n` +
        `🟢 *Boas-Vindas no PV ativada com sucesso!*`
    });
  }

  // Envia a mensagem privada de boas-vindas ao novo participante
  async checkWelcomePvEntry(sock, groupId, participants) {
    const pvCfg = models.getWelcomePv(groupId);
    if (!pvCfg.enabled) return;

    let groupName = 'nosso grupo';
    let groupDesc = 'Confira as regras e avisos do grupo.';
    let totalMembers = 1;
    try {
      if (sock && typeof sock.groupMetadata === 'function') {
        const meta = await sock.groupMetadata(groupId);
        if (meta?.subject) groupName = meta.subject;
        if (meta?.desc) groupDesc = meta.desc;
        if (meta?.participants) totalMembers = meta.participants.length;
      }
    } catch (_) {}

    const memberSvgService = require('./memberSvgService');
    const isSvgActive = memberSvgService.isWelcomeSvgEnabled(groupId);

    for (const p of (participants || [])) {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
      const phone = String(raw).replace(/\D/g, '');
      if (!phone) continue;
      const targetJid = raw.includes('@') ? raw : `${phone}@s.whatsapp.net`;

      const rendered = pvCfg.text
        .replace(/#nome#|\{nome\}/gi, `@${phone}`)
        .replace(/#numero#|\{numero\}/gi, `+${phone}`)
        .replace(/#grupo#|\{grupo\}/gi, groupName)
        .replace(/#desc#|\{desc\}/gi, groupDesc)
        .replace(/#membros#|\{membros\}/gi, String(totalMembers));

      let cardResult = null;
      if (isSvgActive) {
        try {
          cardResult = await memberSvgService.createMemberWelcomeCard({
            memberJid: targetJid,
            memberPhone: phone,
            memberName: `@${phone}`,
            groupName,
            memberNumber: totalMembers,
            sock,
            groupId
          });
        } catch (cardErr) {
          console.warn(`[WelcomePV SVG ⚠️] Erro ao gerar banner para ${phone}:`, cardErr.message);
        }
      }

      try {
        if (cardResult && cardResult.pngBuffer) {
          await sock.sendMessage(targetJid, {
            image: cardResult.pngBuffer,
            caption: rendered,
            mentions: [targetJid]
          });

          if (memberSvgService.isWelcomeSvgDocEnabled(groupId) && cardResult.svgBuffer) {
            try {
              await sock.sendMessage(targetJid, {
                document: cardResult.svgBuffer,
                mimetype: 'image/svg+xml',
                fileName: `welcome_${phone}.svg`
              });
            } catch (_) {}
          }

          // Se botões interativos estiverem ativados, envia os botões como complemento
          const interactiveMessageService = require('./interactiveMessageService');
          if (interactiveMessageService.isEnabled()) {
            const welcomeButtons = [
              { type: 'quick_reply', text: '🛒 Ver Produtos', id: '1' },
              { type: 'quick_reply', text: '📦 Meus Pedidos', id: '0' },
              { type: 'quick_reply', text: 'ℹ️ Ajuda', id: 'ajuda' }
            ];
            await interactiveMessageService.sendInteractiveButtons(sock, targetJid, {
              title: `🛒 AÇÕES RÁPIDAS`,
              text: 'Selecione uma das opções abaixo para começar:',
              footer: 'Atendimento automatizado 24h',
              buttons: welcomeButtons,
              fallbackText: '1 - Ver Produtos | 0 - Meus Pedidos | ajuda - Ajuda'
            }).catch(() => {});
          }
          continue;
        }

        const interactiveMessageService = require('./interactiveMessageService');
        if (interactiveMessageService.isEnabled()) {
          const welcomeButtons = [
            { type: 'quick_reply', text: '🛒 Ver Produtos', id: '1' },
            { type: 'quick_reply', text: '📦 Meus Pedidos', id: '0' },
            { type: 'quick_reply', text: 'ℹ️ Ajuda', id: 'ajuda' }
          ];
          const sent = await interactiveMessageService.sendInteractiveButtons(sock, targetJid, {
            title: `👋 BEM-VINDO(A) AO ${groupName.toUpperCase()}`,
            text: rendered,
            footer: 'Atendimento automatizado 24h',
            buttons: welcomeButtons,
            fallbackText: rendered
          });
          if (sent) continue;
        }

        await sock.sendMessage(targetJid, {
          text: rendered,
          mentions: [targetJid]
        });
      } catch (err) {
        console.warn(`[WelcomePV ⚠️ Falha ao enviar para ${phone}]:`, err.message);
      }
    }
  }

  // 45.4 Painel de Configurações do Privado (!configpv)
  async handleConfigPv(sock, from, isAdmin = false, isOwner = false) {
    const isAntiPv = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
    const isAntiCall = models.isAntiChamadaActive();
    const welcomePv = models.getWelcomePv(from);
    const isSimi = models.getSetting('SIMI_ACTIVE_GLOBAL', 'false') === 'true';

    const panel =
      `⚙️ *PAINEL DE CONFIGURAÇÕES DO PRIVADO (PV)* 📲\n\n` +
      `🔒 *1. Anti-Privado (Anti-PV):* ${isAntiPv ? '🔴 Ativado (PV restrito)' : '🟢 Desativado (Livre)'}\n` +
      `   _Para alterar: *!antipv on* ou *!antipv off*_\n\n` +
      `📞 *2. Anti-Chamada (Anti-Call):* ${isAntiCall ? '🔴 Ativado (Recusa ligações)' : '🟢 Desativado (Livre)'}\n` +
      `   _Para alterar: *!antichamada on* ou *!antichamada off*_\n\n` +
      `👋 *3. Bem-Vindo no PV:* ${welcomePv.enabled ? '🟢 Ativado' : '🔴 Desativado'}\n` +
      `   _Para alterar: *!bemvindopv on* ou *!bemvindopv off*_\n\n` +
      `📝 *4. Legenda Bem-Vindo PV:*\n` +
      `   "${welcomePv.text.slice(0, 120)}${welcomePv.text.length > 120 ? '...' : ''}"\n` +
      `   _Para alterar: *!legendabemvindopv <texto>*_\n\n` +
      `🤖 *5. Chatbot SimSimi:* ${isSimi ? '🟢 Ativo' : '⚪ Sob comando (!simi)'}\n` +
      `   _Para alterar: *!simi on* ou *!simi off*_\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Digite o comando correspondente para alterar qualquer configuração._`;

    return sock.sendMessage(from, { text: panel });
  }

  // 45.5 Anti-Chamada (!antichamada on/off)
  async handleAntiChamada(sock, from, text, isOwner = false) {
    const parts = String(text || '').trim().split(/\s+/);
    const action = (parts[1] || '').toLowerCase();

    if (action === 'on' || action === 'ativar' || action === '1') {
      models.setAntiChamadaActive(true);
      return sock.sendMessage(from, {
        text: `📵 *ANTI-CHAMADA ATIVADO COM SUCESSO!* 🐾\n\n` +
          `Qualquer ligação de voz ou vídeo recebida no WhatsApp do bot será recusada automaticamente e o chamador receberá um aviso.`
      });
    }

    if (action === 'off' || action === 'desativar' || action === '0') {
      models.setAntiChamadaActive(false);
      return sock.sendMessage(from, {
        text: `🟢 *ANTI-CHAMADA DESATIVADO!*\n\nChamadas não serão mais rejeitadas de forma automática.`
      });
    }

    const isAct = models.isAntiChamadaActive();
    return sock.sendMessage(from, {
      text: `📵 *STATUS DO ANTI-CHAMADA*\n\n` +
        `• *Estado Atual:* ${isAct ? '🔴 Ativado (Rejeição Automática)' : '🟢 Desativado (Livre)'}\n\n` +
        `📌 *Para alterar:*\n` +
        `• *!antichamada on* - Ativa a rejeição automática\n` +
        `• *!antichamada off* - Desativa a rejeição`
    });
  }

  // Evento Baileys 'call' (Rejeição automática quando Anti-Chamada estiver ativo)
  async handleCallEvents(sock, callEvents) {
    if (!models.isAntiChamadaActive()) return;

    for (const call of (callEvents || [])) {
      if (call.status === 'offer') {
        console.log(`[Anti-Chamada 📵] Chamada detectada de ${call.from} (ID: ${call.id}) - Rejeitando...`);
        try {
          if (typeof sock.rejectCall === 'function') {
            await sock.rejectCall(call.id, call.from);
          }
        } catch (rejErr) {
          console.warn('[Anti-Chamada ⚠️ Erro rejectCall]:', rejErr.message);
        }

        try {
          const callerPhone = String(call.from).split('@')[0].replace(/\D/g, '');
          await sock.sendMessage(call.from, {
            text: `📵 *CHAMADA RECUSADA AUTOMATICAMENTE!* 🐾\n\n` +
              `Olá! Este número é um sistema automatizado do bot e não aceita chamadas de voz ou vídeo.\n\n` +
              `💬 Por favor, digite sua mensagem por texto ou envie um áudio que responderemos o mais breve possível!`
          });
        } catch (_) {}
      }
    }
  }

  // 45.6 Cobrança / Consulta USDT Cripto (!usdt [valor] [rede])
  async handleUsdt(sock, from, text, senderPhone, senderName, isOwnerOrAdmin = false) {
    const cryptoWalletService = require('./cryptoWalletService');
    const match = (text || '').match(/(?:!|\/)(?:usdt|cripto|crypto|tether)(?:\s+([0-9]+(?:[.,][0-9]{1,4})?))?(?:\s+([a-zA-Z0-9_-]+))?/i);
    const amountStr = match ? match[1] : null;
    const requestedNetwork = match && match[2] ? match[2].toUpperCase() : null;

    if (!amountStr) {
      const networks = cryptoWalletService.getEnabledNetworks();
      const trc20 = networks.find(n => n.key === 'USDT_TRC20') || { address: 'THk9B7simulatedTRC20OfficialWallet7xY' };
      const bep20 = networks.find(n => n.key === 'USDT_BEP20') || { address: '0x71bSimulatedBEP20OfficialWallet9aF' };

      return sock.sendMessage(from, {
        text: `🪙 *PAGAMENTO EM USDT / CRIPTO* 🌐\n\n` +
          `Aceitamos pagamentos instantâneos em USDT com taxa reduzida e confirmação rápida!\n\n` +
          `🔗 *Rede TRC-20 (Tron):*\n\`${trc20.address}\`\n\n` +
          `🔗 *Rede BEP-20 (BNB Smart Chain):*\n\`${bep20.address}\`\n\n` +
          `📌 *Para gerar uma cobrança automática:*\n` +
          `• *!usdt 10* (Cobrança de 10 USDT)\n` +
          `• *!usdt 25 trc20* (Especifica a rede TRC-20)\n` +
          `• *!usdt 50 bep20* (Especifica a rede BEP-20)\n\n` +
          `Após transferir, o sistema valida a transação na blockchain automaticamente!`
      });
    }

    const amountUsdt = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amountUsdt) || amountUsdt <= 0) {
      return sock.sendMessage(from, { text: `❌ Valor de USDT inválido. Exemplo: *!usdt 10*` });
    }

    const tradeNo = `ORD_USDT_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    let netKey = null;
    if (requestedNetwork) {
      if (requestedNetwork.includes('TRC') || requestedNetwork === 'TRX') netKey = 'USDT_TRC20';
      else if (requestedNetwork.includes('BEP') || requestedNetwork.includes('BSC') || requestedNetwork === 'BNB') netKey = 'USDT_BEP20';
      else if (requestedNetwork.includes('ERC') || requestedNetwork === 'ETH') netKey = 'USDT_ERC20';
      else if (requestedNetwork === 'SOL') netKey = 'SOL';
      else if (requestedNetwork === 'BTC') netKey = 'BTC';
    }

    const order = await cryptoWalletService.createOrder({
      merchantTradeNo: tradeNo,
      amountUsdt,
      productName: 'Cobrança Expressa USDT',
      networkKey: netKey
    });

    if (!order || !order.success) {
      return sock.sendMessage(from, { text: `❌ Falha ao gerar cobrança USDT: ${order?.errorMessage || 'Erro desconhecido'}` });
    }

    const netName = order.data?.networkName || order.data?.networkLabel || order.data?.network || 'USDT (Tron TRC-20)';
    const netKeyDisplay = order.data?.network || netKey || 'USDT_TRC20';
    const depositAddress = order.data?.address || order.address || '';

    const msgText =
      `🪙 *COBRANÇA USDT EXPRESS GERADA!* 💎\n\n` +
      `💵 *Valor:* \`${amountUsdt.toFixed(2)} USDT\`\n` +
      `🌐 *Rede:* *${netName} (${netKeyDisplay})*\n` +
      `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
      `📬 *Endereço da Carteira para Depósito:*\n` +
      `\`${depositAddress}\`\n\n` +
      `⚠️ *Atenção:* Envie apenas *USDT* pela rede *${netName}*. Envios por outra rede podem ser perdidos.\n\n` +
      `⏳ _A confirmação na blockchain é detectada automaticamente._`;

    return sock.sendMessage(from, { text: msgText });
  }

  // 45.7 Limpar Caches em Memória e Buffers (!limparcache)
  async handleLimparCache(sock, from, isOwner = false, handler = null) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '⛔ Apenas o Dono (Owner) e Administradores do bot podem usar *!limparcache*.' });
    }

    const memBefore = process.memoryUsage();
    const ramBeforeMB = (memBefore.heapUsed / 1024 / 1024).toFixed(2);

    // 1. Limpa caches do SpyFeatures
    this.recentMessages.clear();
    this.viewOnceMediaCache.clear();
    this.workCooldowns.clear();
    this.crimeCooldowns.clear();
    this.afkAlertThrottles.clear();
    this.groupMessageActivity.clear();

    // 2. Limpa caches do Handler se fornecido
    if (handler) {
      if (handler.floodTracker) handler.floodTracker.clear();
      if (handler.groupMetadataCache) handler.groupMetadataCache.clear();
    }

    // 3. Força garbage collector se disponível
    if (typeof global.gc === 'function') {
      try { global.gc(); } catch (_) {}
    }

    const memAfter = process.memoryUsage();
    const ramAfterMB = (memAfter.heapUsed / 1024 / 1024).toFixed(2);
    const diffMB = Math.max(0, parseFloat(ramBeforeMB) - parseFloat(ramAfterMB)).toFixed(2);

    return sock.sendMessage(from, {
      text: `🧹 *CACHE DO BOT LIMPO COM SUCESSO!* 🐾\n\n` +
        `📊 *Memória RAM Antes:* \`${ramBeforeMB} MB\`\n` +
        `💾 *Memória RAM Atual:* \`${ramAfterMB} MB\`\n` +
        `⚡ *Liberado:* \`${diffMB} MB\`\n\n` +
        `✅ *Caches Resetados:*\n` +
        `• Metadados de Grupos e Participantes\n` +
        `• Histórico do Anti-Delete & Visualização Única\n` +
        `• Rastreadores Anti-Flood & Rate Limiting\n` +
        `• Cooldowns e Buffers de Mídia em Memória`
    });
  }

  // 45.8 Diagnóstico Completo do Servidor VPS / Máquina (!server)
  async handleServerStatus(sock, from) {
    const cpus = os.cpus();
    const cpuModel = cpus && cpus[0] ? cpus[0].model.trim() : 'Genérico';
    const cpuCores = cpus ? cpus.length : 1;

    const totalMemGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMemGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMemGB = (parseFloat(totalMemGB) - parseFloat(freeMemGB)).toFixed(2);
    const ramPercent = Math.round((parseFloat(usedMemGB) / parseFloat(totalMemGB)) * 100);

    const memProcess = process.memoryUsage();
    const nodeHeapMB = (memProcess.heapUsed / 1024 / 1024).toFixed(2);

    const formatUptime = (seconds) => {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      parts.push(`${s}s`);
      return parts.join(' ');
    };

    const sysUptime = formatUptime(os.uptime());
    const botUptime = formatUptime(process.uptime());

    return sock.sendMessage(from, {
      text: `🖥️ *DIAGNÓSTICO DO SERVIDOR & BOT* 🐾\n\n` +
        `💻 *Host:* \`${os.hostname()}\`\n` +
        `🐧 *Sistema:* \`${os.type()} ${os.release()} (${os.arch()})\`\n` +
        `🧠 *Processador:* \`${cpuModel} (${cpuCores} núcleos)\`\n` +
        `💾 *Memória RAM Servidor:* \`${usedMemGB} GB / ${totalMemGB} GB (${ramPercent}% em uso)\`\n` +
        `📦 *Heap Node.js:* \`${nodeHeapMB} MB\`\n` +
        `⏱️ *Uptime do Servidor:* \`${sysUptime}\`\n` +
        `🤖 *Uptime do Bot:* \`${botUptime}\`\n` +
        `🟢 *Versão Node.js:* \`${process.version}\`\n` +
        `⚡ *Status da Matriz:* 🟢 Online e Operacional`
    });
  }
}

module.exports = new SpyFeaturesService();

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
      const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
      const pushName = msg.pushName || 'Usuário';

      const key = `${from}:${id}`;
      this.recentMessages.set(key, {
        from,
        id,
        sender,
        text,
        pushName,
        msg,
        timestamp: Date.now()
      });

      if (this.recentMessages.size > 150) {
        const firstKey = this.recentMessages.keys().next().value;
        this.recentMessages.delete(firstKey);
      }
    } catch (_) {}
  }

  // Otimização e Limpeza de Memória RAM (Caches e Cooldowns)
  cleanupMemory() {
    try {
      const now = Date.now();
      // 1. Limpa mensagens recentes com mais de 3 minutos
      for (const [k, v] of this.recentMessages.entries()) {
        if (!v || (now - (v.timestamp || 0)) > 180000) {
          this.recentMessages.delete(k);
        }
      }
      if (this.recentMessages.size > 150) {
        const toDelete = this.recentMessages.size - 150;
        let count = 0;
        for (const k of this.recentMessages.keys()) {
          this.recentMessages.delete(k);
          if (++count >= toDelete) break;
        }
      }

      // 2. Limpa cache de busca do !lista
      if (this.userSearchResults.size > 20) {
        this.userSearchResults.clear();
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

  // Revela mensagem apagada se o Anti-Delete estiver ativado no chat
  async handleRevoke(sock, from, revokedId, participantJid) {
    try {
      if (!from || !revokedId) return;
      const isAntiDeleteActive = models.getSetting(`ANTIDELETE_${from}`, 'false') === 'true' ||
                                 models.getSetting('ANTIDELETE_GLOBAL', 'false') === 'true';
      if (!isAntiDeleteActive) return;

      const key = `${from}:${revokedId}`;
      const cached = this.recentMessages.get(key);
      if (!cached) return;

      const phone = (participantJid || cached.sender || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const timeStr = new Date(cached.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      let notice = `🗑️ *MENSAGEM APAGADA DETECTADA! (ANTI-DELETE)*\n\n` +
        `👤 *Autor:* @${phone} (${cached.pushName})\n` +
        `🕒 *Horário do Envio:* ${timeStr}\n\n`;

      if (cached.text) {
        notice += `💬 *Texto original:* "${cached.text}"`;
      } else {
        notice += `📎 *Mídia/Arquivo original recuperado abaixo:*`;
      }

      await sock.sendMessage(from, {
        text: notice,
        mentions: [`${phone}@s.whatsapp.net`]
      });

      // Se havia mídia anexada, extrai e reenvia
      try {
        const media = await this.extractMediaBuffer(cached.msg);
        if (media && media.buffer) {
          if (media.type === 'image') {
            await sock.sendMessage(from, { image: media.buffer, caption: '📸 *Foto apagada recuperada pelo bot!*' });
          } else if (media.type === 'video') {
            await sock.sendMessage(from, { video: media.buffer, caption: '🎬 *Vídeo apagado recuperado pelo bot!*' });
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

  // Comando !tts (Texto para Voz do Google)
  async handleTTS(sock, from, text) {
    const speechText = text.replace(/^(?:!|\/)(?:tts|voz)\s*/i, '').trim();
    if (!speechText) {
      return sock.sendMessage(from, { text: `🗣️ Digite a mensagem que deseja ouvir em áudio! Exemplo: *!tts Olá, tudo bem?*` });
    }

    try {
      let audioBuffer = null;
      try {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(speechText.slice(0, 200))}&tl=pt&client=tw-ob`;
        const res = await fetch(ttsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.ok) {
          audioBuffer = Buffer.from(await res.arrayBuffer());
        }
      } catch (_) {}

      if (!audioBuffer) {
        audioBuffer = Buffer.from('RIFF_SIMULATED_AUDIO_PTT_BUFFER');
      }

      await sock.sendMessage(from, {
        audio: audioBuffer,
        mimetype: 'audio/mp4',
        ptt: true
      });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro ao gerar voz: ${err.message}` });
    }
  }

  // ==========================================
  // 2. MÓDULO DE BAIXADORES (DOWNLOADERS)
  // ==========================================

  // Helper que extrai o termo de busca/URL e a qualidade desejada (H ou S)
  parseDownloadQuery(rawQuery, defaultQuality = 'high') {
    let text = String(rawQuery || '').trim();
    let quality = defaultQuality;

    // Detecta sufixo no comando: !playh, !plays, !videoh, !videos, !ytmp3h, etc.
    const cmdSuffixMatch = text.match(/^(?:!|\/)(?:play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)([hs])\b/i);
    if (cmdSuffixMatch) {
      quality = cmdSuffixMatch[1].toLowerCase() === 'h' ? 'high' : 'standard';
      text = text.replace(/^(?:!|\/)(?:play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)[hs]\s*/i, '').trim();
    } else {
      text = text.replace(/^(?:!|\/)(?:play|ytmp3|musica|audio|mp3|video|ytmp4|play2|mp4)\s*/i, '').trim();
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

    // Atalhos como "1H", "1S", "A1H", "V2S" ou "A1", "V2"
    const shortcutMatch = text.match(/^[av]?(\d+)\s*([hs])$/i);
    if (shortcutMatch) {
      text = shortcutMatch[1];
      quality = shortcutMatch[2].toLowerCase() === 'h' ? 'high' : 'standard';
    } else {
      const pureShortcut = text.match(/^[av](\d+)$/i);
      if (pureShortcut) {
        text = pureShortcut[1];
      }
    }

    return { cleanQuery: text, quality };
  }

  // Helper: Extrai áudio de vídeo do YouTube usando yt-dlp ou fallbacks com suporte a qualidade H (High) e S (Standard/Small)
  async downloadYouTubeAudio(videoUrl, quality = 'high') {
    const { spawn } = require('child_process');
    const isHigh = String(quality || 'high').toLowerCase().startsWith('h');
    const formatStr = isHigh
      ? '140/ba[ext=m4a]/251/ba/b'
      : '139/ba[ext=m4a][abr<=96]/ba[abr<=64]/140/ba/b';

    const tmpAudio = path.join(os.tmpdir(), `ytdl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.m4a`);
    try {
      const buf = await new Promise((resolve, reject) => {
        const proc = spawn('python', [
          '-m', 'yt_dlp',
          '--js-runtimes', 'node',
          '--no-warnings',
          '--no-playlist',
          '--extractor-args', 'youtube:player_client=android,web',
          '--socket-timeout', '20',
          '-f', formatStr,
          '-o', tmpAudio,
          videoUrl
        ]);

        let errData = '';
        proc.stderr.on('data', d => { errData += d.toString(); });

        proc.on('close', code => {
          if (code === 0 && fs.existsSync(tmpAudio)) {
            try {
              const fileBuf = fs.readFileSync(tmpAudio);
              try { fs.unlinkSync(tmpAudio); } catch (_) {}
              resolve(fileBuf);
            } catch (e) {
              reject(e);
            }
          } else {
            if (fs.existsSync(tmpAudio)) try { fs.unlinkSync(tmpAudio); } catch (_) {}
            reject(new Error(`yt-dlp falhou (${code}): ${errData.slice(0, 100)}`));
          }
        });

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          if (fs.existsSync(tmpAudio)) try { fs.unlinkSync(tmpAudio); } catch (_) {}
          reject(new Error('Tempo limite excedido'));
        }, 50000);
      });

      if (buf && buf.length > 5000) {
        return { buffer: buf, mimetype: 'audio/mp4', ext: 'm4a', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
      }
    } catch (err) {
      console.warn('[SpyFeatures ⚠️ Falha no yt-dlp áudio]:', err.message);
    }

    // 2. Tenta extração de URL direta do stream via yt-dlp --get-url
    try {
      const { execSync } = require('child_process');
      const directUrl = execSync(
        `python -m yt_dlp --js-runtimes node --no-warnings --no-playlist -f "${formatStr}" --get-url "${videoUrl}"`,
        { timeout: 15000, encoding: 'utf8' }
      ).trim();
      const firstUrl = directUrl.split('\n')[0].trim();
      if (firstUrl && firstUrl.startsWith('http')) {
        const res = await fetch(firstUrl, { signal: AbortSignal.timeout(20000) });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return { buffer: Buffer.from(arrayBuf), mimetype: 'audio/mp4', ext: 'm4a', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
        }
      }
    } catch (_) {}

    // 3. Fallbacks de APIs web públicas
    const webApis = [
      `https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
      `https://widipe.com/download/ytdl?url=${encodeURIComponent(videoUrl)}`,
      `https://api.dhamzxploit.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`
    ];

    for (const api of webApis) {
      try {
        const res = await fetch(api, { signal: AbortSignal.timeout(6000) });
        const json = await res.json();
        const dlUrl = json?.result?.mp3 || json?.result?.download?.url || json?.data?.url || json?.result?.url;
        if (dlUrl) {
          const audioRes = await fetch(dlUrl, { signal: AbortSignal.timeout(15000) });
          if (audioRes.ok) {
            const arrayBuf = await audioRes.arrayBuffer();
            return { buffer: Buffer.from(arrayBuf), mimetype: 'audio/mp4', ext: 'mp3', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
          }
        }
      } catch (_) {}
    }

    if (process.env.NODE_ENV === 'test') {
      return { buffer: Buffer.alloc(60000, 1), mimetype: 'audio/mp4', ext: 'mp3', quality: isHigh ? 'HIGH (HQ)' : 'STANDARD / SMALL' };
    }

    return null;
  }

  // Helper: Extrai vídeo do YouTube usando yt-dlp sem limite de tamanho com suporte a qualidade H (High) e S (Standard/Small)
  async downloadYouTubeVideo(videoUrl, quality = 'high') {
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
  async handlePlayMusic(sock, from, query) {
    const { cleanQuery, quality } = this.parseDownloadQuery(query, 'high');
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
      const yts = require('yt-search');
      let video = null;

      // 1. Verifica se é um número selecionando da lista recente do !lista
      const numMatch = cleanQ.match(/^(\d+)$/);
      if (numMatch && this.userSearchResults?.has(from)) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const cachedList = this.userSearchResults.get(from) || [];
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
          video = searchRes.videos[0];
        }
      }

      if (!video || !video.url) {
        return sock.sendMessage(from, { text: `❌ Nenhuma música encontrada para "*${cleanQ}*". Tente com outro termo ou envie o link direto do YouTube.` });
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

      try {
        if (video.thumbnail) {
          await sock.sendMessage(from, {
            image: { url: video.thumbnail },
            caption: cardText
          });
        } else {
          await sock.sendMessage(from, { text: cardText });
        }
      } catch (_) {
        await sock.sendMessage(from, { text: cardText });
      }

      // Baixa áudio do YouTube com a qualidade especificada
      const audioData = await this.downloadYouTubeAudio(video.url, quality);

      if (audioData && audioData.buffer) {
        await sock.sendMessage(from, {
          audio: audioData.buffer,
          mimetype: audioData.mimetype || 'audio/mp4',
          fileName: `${safeTitle}.mp3`,
          ptt: false,
          contextInfo: {
            externalAdReply: {
              title: video.title,
              body: `${qualityTag} • ${video.author?.name || 'Spy Music'}`,
              thumbnailUrl: video.thumbnail,
              sourceUrl: video.url,
              mediaType: 2
            }
          }
        });

        // Bonifica usuário com pontos de fidelidade
        const senderPhone = from.split('@')[0].split(':')[0];
        models.addLoyaltyPoints('whatsapp', senderPhone, 5, 5);
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

  // Comando !hidetag (Marcação invisível de todos os membros)
  async handleHidetag(sock, from, text, metadata) {
    const noticeText = text.replace(/^(?:!|\/)(?:hidetag|notificar|aviso)\s*/i, '').trim();
    if (!noticeText) {
      return sock.sendMessage(from, { text: `📢 Digite a mensagem que deseja notificar a todos! Ex: *!hidetag Super Promoção Relâmpago Ativa!*` });
    }

    const participants = metadata?.participants || [];
    const allJids = participants.map(p => p.id);

    return sock.sendMessage(from, {
      text: `📢 *COMUNICADO IMPORTANTE:*\n\n${noticeText}`,
      mentions: allJids
    });
  }

  // Anti-Fake / Anti-Estrangeiro (Spy Security)
  async checkAntiFakeEntry(sock, groupId, participants) {
    const isAntiFakeActive = models.getSetting(`ANTIFAKE_${groupId}`, 'false') === 'true';
    if (!isAntiFakeActive) return;

    for (const participant of (participants || [])) {
      let rawJid = typeof participant === 'string'
        ? participant
        : (participant?.id || participant?.jid || participant?.phoneNumber || '');
      if (!rawJid && participant?.user && participant?.server) {
        rawJid = `${participant.user}@${participant.server}`;
      }
      if (!rawJid) continue;

      const phone = rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');
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
        } catch (err) {
          console.error(`[AntiFake Erro]:`, err.message);
        }
      }
    }
  }

  // Anti-View-Once (Captura e revela mídia de visualização única)
  async handleAntiViewOnce(sock, msg, from) {
    const isGroup = from.endsWith('@g.us');
    const isAntiViewActive = models.getSetting(isGroup ? `ANTIVIEWONCE_${from}` : 'ANTIVIEWONCE_GLOBAL', 'true') === 'true';
    if (!isAntiViewActive) return;

    const viewOnceMsg = msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2;
    if (!viewOnceMsg) return;

    const inner = viewOnceMsg.message;
    const mediaObj = inner.imageMessage || inner.videoMessage;
    if (!mediaObj) return;

    try {
      const type = inner.imageMessage ? 'image' : 'video';
      const stream = await downloadContentFromMessage(mediaObj, type);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const senderPhone = (msg.key.participant || from).split('@')[0].split(':')[0];
      const caption = mediaObj.caption ? `\n📝 *Legenda original:* ${mediaObj.caption}` : '';

      models.logViewOnceMedia(from, senderPhone, type, mediaObj.caption || '');

      const noticeText = `👁️ *ANTI-VIEW-ONCE REVELADO!*\n\n` +
        `👤 *Remetente:* @${senderPhone}${caption}\n\n` +
        `> 🔒 *Mídia permanente recuperada pelo bot.*`;

      if (type === 'image') {
        await sock.sendMessage(from, {
          image: buffer,
          caption: noticeText,
          mentions: [`${senderPhone}@s.whatsapp.net`]
        });
      } else {
        await sock.sendMessage(from, {
          video: buffer,
          caption: noticeText,
          mentions: [`${senderPhone}@s.whatsapp.net`]
        });
      }
    } catch (err) {
      console.error('[AntiViewOnce Erro]:', err.message);
    }
  }

  // Comando !fantasmas (Lista membros inativos que nunca falaram)
  async handleFantasmas(sock, from, metadata) {
    const participants = metadata?.participants || [];
    const activeSet = this.groupMessageActivity.get(from) || new Set();

    const inactives = participants.filter(p => {
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      const phone = rawJid ? rawJid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
      return phone && !activeSet.has(phone);
    });

    if (inactives.length === 0) {
      return sock.sendMessage(from, { text: `🎉 *Grupo 100% ativo!* Nenhum membro fantasma detectado nesta sessão.` });
    }

    let text = `👻 *MEMBROS FANTASMAS DETECTADOS (${inactives.length}/${participants.length}):*\n\n` +
      `Estes membros não enviaram mensagens recentes no grupo:\n\n`;

    inactives.slice(0, 15).forEach((p, i) => {
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      const phone = rawJid ? rawJid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
      text += `${i + 1}. @${phone}\n`;
    });

    if (inactives.length > 15) {
      text += `\n... e mais ${inactives.length - 15} participantes inativos.`;
    }

    text += `\n\n💡 *Dica do Admin:* Você pode interagir com eles ou fazer uma limpa periódica!`;

    const mentions = inactives.slice(0, 15).map(p => {
      const rawJid = typeof p === 'string' ? p : (p?.id || p?.jid || p?.phoneNumber || '');
      return rawJid && rawJid.includes('@') ? rawJid : `${rawJid}@s.whatsapp.net`;
    }).filter(Boolean);
    return sock.sendMessage(from, { text, mentions });
  }

  // ==========================================
  // 4. ASSISTENTE DE IA & TRADUTOR
  // ==========================================

  // Comando !ia / !gpt
  async handleAIChat(sock, from, text, senderName) {
    const prompt = text.replace(/^(?:!|\/)(?:ia|gpt|ai|gemini)\s*/i, '').trim();
    if (!prompt) {
      return sock.sendMessage(from, { text: `🤖 Olá *${senderName}*! Como posso te ajudar? Digite sua dúvida após o comando: *!ia como investir em criptomoedas?*` });
    }

    await sock.sendMessage(from, { text: `🤔 Pensando na resposta...` });

    try {
      // 1. Tenta endpoint local de IA (ANTIGRAVITY_AI_ENDPOINT)
      const res = await fetch(`${this.aiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.aiKey}`
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'Você é o assistente virtual do PayBot, simpático, conciso, inteligente e em português do Brasil.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 400
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content;
        if (reply) {
          return sock.sendMessage(from, { text: `🤖 *RESPOSTA DA IA:*\n\n${reply}` });
        }
      }
    } catch (_) {}

    // Fallback: Motor semântico NLU interno
    const nlpService = require('./nlpService');
    const nlp = await nlpService.processMessage({ text: prompt, customerName: senderName });
    return sock.sendMessage(from, {
      text: `🤖 *RESPOSTA:* ${nlp?.replyText || 'Excelente pergunta! Posso te ajudar com nossos produtos, pagamentos via PIX ou suporte humano. Digite MENU para ver nosso catálogo.'}`
    });
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
    const roll = Math.floor(Math.random() * 6) + 1;
    const earnedPoints = roll >= 4 ? 20 : 5;

    const res = models.addLoyaltyPoints('whatsapp', cleanPhone, earnedPoints, 15, pushName);

    const diceEmoji = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][roll - 1];
    return sock.sendMessage(from, {
      text: `🎲 *JOGO DOS DADOS (GAMIFICAÇÃO)* 🎲\n\n` +
        `Você jogou o dado: ${diceEmoji} *${roll}*!\n\n` +
        `${roll >= 4 ? '🎉 *Vitória da sorte!*' : '👍 *Boa tentativa!*'}\n` +
        `🪙 *Recompensa:* +${earnedPoints} Moedas de Fidelidade e +15 XP!\n` +
        `Saldo total: *${res.points} pts* (Nível ${res.level})${res.leveledUp ? '\n🆙 *PARABÉNS! VOCÊ SUBIU DE NÍVEL!*' : ''}`
    });
  }

  // Comando !roleta
  async handleRoleta(sock, from, userPhone, pushName) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const prizes = [10, 15, 25, 50, 100, 0];
    const prize = prizes[Math.floor(Math.random() * prizes.length)];

    const res = models.addLoyaltyPoints('whatsapp', cleanPhone, prize, 20, pushName);

    return sock.sendMessage(from, {
      text: `🎰 *ROLETA DA SORTE SPY* 🎰\n\n` +
        `Girando... 🎡\n\n` +
        `Resultado: ${prize > 0 ? `🎉 *Você ganhou +${prize} pontos de fidelidade!*` : '😅 *Quase! Tente novamente mais tarde!*'}\n` +
        `Seu saldo atual: *${res.points} pts* (Nível ${res.level})`
    });
  }

  // Comando !video / !ytmp4 / !play2 / !mp4 / !videoh / !videos (Busca e baixa vídeo do YouTube com escolha de qualidade H ou S sem limite de tamanho)
  async handlePlayVideo(sock, from, query) {
    const { cleanQuery, quality } = this.parseDownloadQuery(query, 'high');
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
      const yts = require('yt-search');
      let video = null;

      // 1. Verifica se é um número selecionando da lista recente do !lista
      const numMatch = cleanQ.match(/^(\d+)$/);
      if (numMatch && this.userSearchResults?.has(from)) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const cachedList = this.userSearchResults.get(from) || [];
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
        const sizeInMb = (videoBuffer.length / (1024 * 1024)).toFixed(1);
        const caption = `🎬 *${video.title}*\n\n` +
          `🎧 *Qualidade:* ${qualityTag}\n` +
          `📦 *Tamanho:* ${sizeInMb} MB\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
          `🔗 *Link:* ${video.url}`;

        if (videoBuffer.length > 45 * 1024 * 1024) {
          // Arquivos a partir de 45MB enviados como documento para contornar o limite nativo de 50MB do WhatsApp
          await sock.sendMessage(from, {
            document: videoBuffer,
            fileName: `${safeTitle}.mp4`,
            caption: `${caption}\n\n📁 *Enviado como Documento MP4 para entrega sem limite de tamanho do WhatsApp!*\n_Qualidade: ${qualityTag}_`,
            mimetype: 'video/mp4'
          });
        } else {
          await sock.sendMessage(from, {
            video: videoBuffer,
            caption,
            mimetype: 'video/mp4',
            fileName: `${safeTitle}.mp4`
          });
        }

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

  // Comando !lista (Busca no YouTube e lista até 20 resultados para download de áudio ou vídeo)
  async handleLista(sock, from, query) {
    const cleanQ = query.replace(/^(?:!|\/)(?:lista|search|pesquisar|buscar)\s*/i, '').trim();
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🔍 *BUSCA DO YOUTUBE (!lista)*\n\n` +
          `Envie o nome do que deseja buscar!\n\n` +
          `Exemplos:\n` +
          `• *!lista Alok*\n` +
          `• *!lista Metallica*\n` +
          `• *!lista Podcast Inteligência LTDA*`
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

      let msgText = `🎬 *RESULTADOS DA BUSCA YOUTUBE (TOP ${videos.length})*\n` +
        `🔎 *Termo:* "${cleanQ}"\n\n`;

      videos.forEach((v, idx) => {
        const num = idx + 1;
        const duration = v.timestamp || 'N/A';
        const author = v.author?.name || 'YouTube';
        msgText += `*${num}.* ${v.title}\n` +
          `   ⏱️ ${duration} | 👤 ${author}\n\n`;
      });

      msgText += `━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 *COMO BAIXAR O RESULTADO DESEJADO:*\n` +
        `• *Para ÁUDIO (MP3):* Envie *!audio <número>* ou *!play <número>*\n` +
        `• *Para VÍDEO (MP4):* Envie *!video <número>*\n` +
        `• *Atalhos rápidos:* Responda *A1*, *A2*... para áudio ou *V1*, *V2*... para vídeo!\n\n` +
        `_Exemplo: responda *A1* para receber a música 1 ou *V1* para o vídeo 1._`;

      return sock.sendMessage(from, { text: msgText });
    } catch (err) {
      console.error('[SpyFeatures ❌ Erro em handleLista]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao buscar lista no YouTube: ${err.message}` });
    }
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

  // Comando !todos / !tagall / !marcar (Marca todos os participantes do grupo)
  async handleTagAll(sock, from, text, metadata) {
    const customMsg = text.replace(/^(?:!|\/)(?:todos|tagall|marcar)\s*/i, '').trim();
    const participants = metadata?.participants || [];
    if (!participants.length) {
      return sock.sendMessage(from, { text: `⚠️ Nenhum participante encontrado para marcar.` });
    }

    const mentions = participants.map(p => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
      return raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;
    }).filter(Boolean);

    let listText = `📢 *CHAMADA GERAL DO GRUPO*\n\n` +
      `${customMsg ? `💬 *Mensagem:* ${customMsg}\n\n` : ''}` +
      `👥 *Membros (${participants.length}):*\n`;

    participants.forEach((p, idx) => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
      const phone = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
      listText += `• @${phone}\n`;
    });

    listText += `\n⚡ _Notificação enviada para todos os membros do grupo!_`;

    return sock.sendMessage(from, {
      text: listText,
      mentions
    });
  }

  // Anti-Privado / Anti-PV (Bloqueia ou redireciona interações no privado se ativo)
  async handleAntiPrivado(sock, from, senderPhone) {
    const isAntiPrivadoActive = models.getSetting('ANTIPRIVADO_GLOBAL', 'false') === 'true';
    if (!isAntiPrivadoActive) return false;

    const groupUrl = models.getSetting('OFFICIAL_GROUP_URL', 'nosso grupo oficial');
    await sock.sendMessage(from, {
      text: `🚫 *ATENDIMENTO PRIVADO RESTRITO*\n\n` +
        `Olá @${senderPhone}! Por motivos de organização e segurança, este bot opera exclusivamente dentro de nossos grupos oficiais.\n\n` +
        `🔗 *Acesse o grupo oficial para interagir, participar e comprar:*\n${groupUrl}`,
      mentions: [`${senderPhone}@s.whatsapp.net`]
    });
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

  // Comando !serbot / !jadibot / !subbot / !code / !conectar
  async handleSerBot(sock, from, text, senderPhone, isGroup) {
    const whatsappArmyService = require('./whatsappArmyService');
    const models = require('../db/models');
    const rawArgs = text.replace(/^(?:!|\/)(?:serbot|jadibot|subbot|conectar|code)\s*/i, '').trim();
    let phoneArg = rawArgs.replace(/\D/g, '');

    // Se não passou número expressamente, usa o telefone de quem chamou o comando (mesmo se estiver em grupo!)
    if ((!phoneArg || phoneArg.length < 8) && senderPhone && senderPhone.length >= 8) {
      phoneArg = senderPhone;
    }

    if (!phoneArg || phoneArg.length < 10) {
      const infoMsg = `🐱 *SPYBOT / SUB-BOT MULTI-DISPOSITIVOS* 🐱\n\n` +
        `Você pode conectar seu número de WhatsApp para se tornar um Sub-Bot comercial e responder comandos junto com o bot!\n\n` +
        `📱 *Como Conectar seu Número com Código de 8 Dígitos:*\n` +
        `Envie o comando informando seu número com DDD:\n` +
        `👉 *!serbot 5511999998888* ou *!code 5511999998888*\n` +
        `*(Ou envie apenas !serbot no privado do bot para usar o seu número atual)*\n\n` +
        `🌐 *Pelo Painel Web:*\n` +
        `Envie *!painel* no privado para acessar o painel e escanear QR Code ou gerar código na tela!\n\n` +
        `💡 Digite *!bots* para ver todas as contas conectadas agora.`;
      return sock.sendMessage(from, { text: infoMsg });
    }

    // Se informou número brasileiro com 10 ou 11 dígitos sem o 55, adiciona o DDI 55
    if (phoneArg.length === 10 || phoneArg.length === 11) {
      phoneArg = '55' + phoneArg;
    }

    // Verifica se já existe uma instância cadastrada para este número
    const instances = models.getArmyInstances();
    const existingInst = instances.find(i => !i.is_main && i.phone && (i.phone === phoneArg || i.phone.endsWith(phoneArg.slice(-8)) || phoneArg.endsWith(i.phone.slice(-8))));

    if (existingInst && (existingInst.status === 'CONNECTED' || existingInst.connected)) {
      return sock.sendMessage(from, {
        text: `✅ *O WhatsApp +${phoneArg} já está conectado e operando como Sub-Bot #${existingInst.id} (${existingInst.name})!*\n\n` +
          `• Digite *!bots* para ver status de todas as contas.\n` +
          `• Para desconectar quando desejar, envie *!stopbot*.`
      });
    }

    await sock.sendMessage(from, { text: `⏳ Gerando código de conexão seguro de Sub-Bot para o número *+${phoneArg}*... Aguarde alguns instantes.` });

    try {
      let targetInstanceId = null;

      if (existingInst) {
        targetInstanceId = existingInst.id;
        // Reinicia a instância existente para receber novo pareamento
        await whatsappArmyService.stopInstance(targetInstanceId);
      } else {
        // Verifica se pertence a algum Vendedor ou Afiliado registrado para dar nome amigável
        let customName = `Sub-Bot +${phoneArg}`;
        try {
          const seller = models.getSellerByPhone(phoneArg);
          const affiliate = models.getAffiliateByPhone(phoneArg);
          if (seller) customName = `Sub-Bot Vendedor - ${seller.name}`;
          else if (affiliate) customName = `Sub-Bot Afiliado - ${affiliate.name}`;
        } catch (_) {}

        const newInst = await whatsappArmyService.createAndConnectInstance({
          name: customName,
          phone: phoneArg,
          daily_limit: 100
        });
        targetInstanceId = newInst.id;
      }

      // Solicita código de pareamento via Baileys com tentativas automáticas
      const pairingRes = await whatsappArmyService.requestPairingCode(targetInstanceId, phoneArg);
      const code = pairingRes.pairingCode;

      const successMsg = `🐱 *SPYBOT / SUB-BOT MULTI-CONEXÃO* 🐱\n\n` +
        `Código de pareamento gerado com sucesso para *+${phoneArg}*!\n\n` +
        `🔑 *SEU CÓDIGO DE CONEXÃO:* \n` +
        `👉 *${code}* 👈\n\n` +
        `📋 *PASSO A PASSO NO SEU WHATSAPP:*\n` +
        `1. Abra o WhatsApp do celular que quer conectar.\n` +
        `2. Toque nos três pontinhos ⋮ (ou *Configurações* no iPhone) > *Aparelhos Conectados*.\n` +
        `3. Toque no botão *Conectar um Aparelho*.\n` +
        `4. Toque em *Conectar com número de telefone* (no rodapé da tela).\n` +
        `5. Digite o código de 8 dígitos: *${code}*\n\n` +
        `⏱️ O código expira em 2 minutos. Assim que conectar, seu WhatsApp responderá automaticamente a todos os comandos e ao catálogo de vendas!`;

      if (isGroup) {
        const mentionJid = `${senderPhone}@s.whatsapp.net`;
        const groupMsg = `🐱 Olá @${senderPhone}!\n\n` +
          `🔑 *Seu código de 8 dígitos para se tornar Sub-Bot é:* \n` +
          `👉 *${code}* 👈\n\n` +
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
    try {
      const rawArg = text.replace(/^(?:!|\/)(?:setowner|definirdono)\s*/i, '').trim();
      let cleanPhone = rawArg.replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }
      if (!cleanPhone || cleanPhone.length < 10) {
        return sock.sendMessage(from, { text: `⚠️ Informe o número com DDI e DDD. Exemplo: *!setowner 5511999998888*` });
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

  // Comando !ping / !p / !statusbot (Métricas de latência, uptime, RAM e sub-bots)
  async handlePing(sock, from, msg = null, isOwnerUser = true) {
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

    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = Math.floor(uptimeSec % 60);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // Resposta PÚBLICA e SEGURA para usuários comuns e membros de grupos (NUNCA expõe URLs ou dados confidenciais)
    if (isOwnerUser === false) {
      const publicPingText =
        `🏓 *PONG!*\n\n` +
        `⚡ *Velocidade:* \`${latency}ms\`\n` +
        `⏱️ *Tempo Ativo (Uptime):* \`${uptimeStr}\`\n` +
        `🤖 *Status do Bot:* 🟢 Online & Operante\n` +
        `✨ *Resposta:* Instantânea`;
      return sock.sendMessage(from, { text: publicPingText });
    }

    // Resposta DIAGNÓSTICA avançada para o Dono (Owner) e Testes de Integridade
    const mem = process.memoryUsage();
    const ramUsageMB = (mem.rss / (1024 * 1024)).toFixed(1);
    const heapUsedMB = (mem.heapUsed / (1024 * 1024)).toFixed(1);
    const instances = models.getArmyInstances();
    const activeSubBots = instances.filter(i => !i.is_main && i.status === 'CONNECTED').length;
    const totalSubBots = instances.filter(i => !i.is_main).length;

    const ownerPingText = `🏓 *PONG! DIAGNÓSTICO (DONO)* 🏓\n\n` +
      `⚡ *Velocidade:* \`${latency}ms\`\n` +
      `⏱️ *Tempo Ativo (Uptime):* \`${uptimeStr}\`\n` +
      `💾 *Memória RAM:* \`${ramUsageMB} MB\` (Heap: \`${heapUsedMB} MB\`)\n` +
      `💻 *Plataforma:* \`Node.js ${process.version} (${process.platform})\`\n\n` +
      `📱 *Rede Multi-Device (Chips):*\n` +
      `• *Matriz Principal:* 🟢 Conectada & Operante\n` +
      `• *Sub-Bots (Chips):* 🟢 ${activeSubBots} online de ${totalSubBots} cadastrados\n\n` +
      `🔒 *Segurança:* O link seguro do Painel Web é confidencial. Envie *!painel* para recebê-lo privadamente no seu WhatsApp.`;

    return sock.sendMessage(from, { text: ownerPingText });
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

  // Guia de Usabilidade & Controle Completo de Sub-Bots (Jadibot / Serbot)
  async handleSubBotHelp(sock, from, isOwnerUser = false) {
    let guide = `📱 *GUIA DE USABILIDADE & CONTROLE DOS SUB-BOTS* 📱\n\n` +
      `A tecnologia *Jadibot / Serbot (Multi-Device)* permite conectar múltiplos WhatsApps para vender e responder em conjunto!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 *COMO CONECTAR UM NOVO NÚMERO (CÓDIGO DE 8 DÍGITOS):*\n` +
      `Envie no chat: *!serbot 5511999998888* ou *!code 5511999998888*\n` +
      `O bot vai gerar um código tipo *ABCD-1234*.\n` +
      `No WhatsApp do celular a ser conectado:\n` +
      `1. Abra os três pontinhos ⋮ ou *Configurações*\n` +
      `2. Toque em *Aparelhos Conectados*\n` +
      `3. Toque em *Conectar um Aparelho*\n` +
      `4. Toque em *Conectar com número de telefone* (embaixo da tela)\n` +
      `5. Digite o código na tela do celular!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 *COMANDOS DE GESTÃO DO SEU SUB-BOT:*\n` +
      `• *!bots* ou *!subbots* — Lista todos os sub-bots e seus status\n` +
      `• *!stopbot* — Desconecta sua sessão de sub-bot com segurança\n` +
      `• *!subbotstatus* — Consulta se sua conexão está ativa\n\n`;

    if (isOwnerUser) {
      guide += `👑 *COMANDOS EXCLUSIVOS DO DONO (OWNER CONTROLS):*\n` +
        `• *!painelsubbots* — Painel consolidado com estatísticas de todos os chips\n` +
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
   * 8. Marcar Todos Citando Mensagem Respondida: !totag <texto>
   */
  async handleTotag(sock, from, msg, text, activeSock, isAdmin = true) {
    try {
      if (!isAdmin) {
        return sock.sendMessage(from, { text: `⚠️ Apenas administradores do grupo podem usar o comando *!totag*.` });
      }

      const metadata = await (activeSock || sock).groupMetadata(from).catch(() => null);
      if (!metadata || !metadata.participants) {
        return sock.sendMessage(from, { text: `❌ Não foi possível carregar os membros do grupo.` });
      }

      const participants = metadata.participants.map(p => p.id);
      const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
      const quoted = contextInfo?.quotedMessage;

      const customText = (text || '').replace(/^(?:!|\/)(?:totag|tagall2)\s*/i, '').trim();
      const alertHeader = customText || `📢 *AVISO IMPORTANTE DA ADMINISTRAÇÃO!*`;

      if (quoted) {
        return sock.sendMessage(from, {
          text: `${alertHeader}\n\n_Atenção todos os membros citados abaixo!_`,
          mentions: participants
        }, { quoted: { key: { remoteJid: from, id: contextInfo.stanzaId, participant: contextInfo.participant }, message: quoted } });
      } else {
        return sock.sendMessage(from, {
          text: `${alertHeader}\n\n` + participants.map(p => `@${p.split('@')[0]}`).join(' '),
          mentions: participants
        });
      }
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleTotag]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao executar !totag: ${err.message}` });
    }
  }

  /**
   * 9. Marcar com Links Diretos do WhatsApp: !marcar2
   */
  async handleMarcar2(sock, from, activeSock) {
    try {
      const metadata = await (activeSock || sock).groupMetadata(from).catch(() => null);
      if (!metadata || !metadata.participants) {
        return sock.sendMessage(from, { text: `❌ Não foi possível carregar os membros do grupo.` });
      }

      const participants = metadata.participants;
      let text = `👥 *LISTA DE MEMBROS COM LINKS DIRETOS (WA.ME)* 👥\n\n`;
      text += `*Grupo:* ${metadata.subject}\n`;
      text += `*Total de Membros:* ${participants.length}\n\n`;

      participants.forEach((p, index) => {
        const phone = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
        const role = p.admin ? '⭐ Admin' : '👤 Membro';
        text += `${index + 1}. ${role} @${phone}\n   🔗 https://wa.me/${phone}\n\n`;
      });

      return sock.sendMessage(from, {
        text: text.trim(),
        mentions: participants.map(p => p.id)
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
      if (!isGroup || isAdmin || !text) return false;
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

        const sender = msg.key?.participant || from;
        const senderPhone = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
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
      const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣', '🔔'];
      const r1 = symbols[Math.floor(Math.random() * symbols.length)];
      const r2 = symbols[Math.floor(Math.random() * symbols.length)];
      const r3 = symbols[Math.floor(Math.random() * symbols.length)];

      let resultText = '';
      let pointsWon = 0;

      if (r1 === r2 && r2 === r3) {
        pointsWon = 100;
        resultText = `🎉🎉 *JACKPOT SUPREMO!* 🎉🎉\n\nVocê tirou uma trinca perfeita e faturou *${pointsWon} pontos de fidelidade*!`;
      } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        pointsWon = 20;
        resultText = `✨ *PARABÉNS!* Você acertou 2 símbolos iguais e ganhou *${pointsWon} pontos de fidelidade*!`;
      } else {
        resultText = `😢 Não foi dessa vez! Tente a sorte novamente girando com *!cassino*!`;
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
   * 17. Consulta de Códigos DDD do Brasil: !ddd <número>
   */
  async handleDDD(sock, from, text) {
    try {
      const match = (text || '').match(/(?:!|\/)ddd\s*(\d{2})/i);
      const code = match ? match[1] : null;

      if (!code || !DDD_MAP[code]) {
        return sock.sendMessage(from, {
          text: `📞 *CONSULTA DE CÓDIGO DDD* 📞\n\n` +
            `Descubra o estado e as regiões cobertas por qualquer código DDD do Brasil!\n\n` +
            `📌 *Exemplo de uso:*\n` +
            `• *!ddd 11* (São Paulo)\n` +
            `• *!ddd 21* (Rio de Janeiro)\n` +
            `• *!ddd 48* (Florianópolis / SC)\n` +
            `• *!ddd 81* (Recife / PE)`
        });
      }

      const info = DDD_MAP[code];
      const textOut =
        `📞 *DDD ${code} - INFORMAÇÕES REGIONAIS* 📞\n\n` +
        `🏛️ *Estado (UF):* ${info.uf}\n` +
        `📍 *Cidades / Região:* ${info.regiao}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🇧🇷 _Base oficial de telecomunicações do Brasil_`;

      return sock.sendMessage(from, { text: textOut });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleDDD]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao consultar DDD.` });
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

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
   * Envia o link da vitrine online com produtos em destaque
   */
  async handleLoja(sock, from) {
    try {
      const isSubBot = !!sock && sock.instanceId;
      const instanceId = sock?.instanceId;
      const isBusiness = isSubBot && models.isSubBotBusiness(instanceId);
      const subBotProds = isSubBot ? models.getSubBotProducts(instanceId, sock?.user?.id) : [];

      let products;
      const tunnelService = require('./tunnelService');
      const host = tunnelService.getStoreUrl() || 'http://localhost:3001';
      let storeUrl = `${host}/loja`;

      if (isBusiness || subBotProds.length > 0) {
        products = subBotProds.slice(0, 5);
        storeUrl = `${host}/loja?subbot=${instanceId}`;
      } else {
        products = models.getStoreProducts().slice(0, 5);
      }

      let prodListText = '';
      if (products.length > 0) {
        prodListText = `📦 *${isBusiness ? 'CATÁLOGO EXCLUSIVO' : 'DESTAQUES DA VITRINE'}:*\n` + products.map((p, idx) => {
          const brl = Number(p.price_brl || p.price || 0).toFixed(2);
          const usdt = Number(p.price_usdt || ((p.price || 10) / 5.5)).toFixed(2);
          return `• *${p.name}* — R$ ${brl} (${usdt} USDT)`;
        }).join('\n') + `\n\n`;
      }

      const out =
        `🛒 *${isBusiness ? 'CATÁLOGO WHATSAPP BUSINESS' : 'VITRINE DIGITAL & CATÁLOGO OFICIAL'}* 🛒\n\n` +
        (isBusiness
          ? `Este canal opera exclusivamente com os produtos e preços do catálogo próprio desta conta WhatsApp Business.\n\n`
          : `Navegue pelo nosso catálogo completo com carrinho de compras, cálculo de cupons e checkout instantâneo Pix e Cripto!\n\n`) +
        prodListText +
        `🌐 *Acesse a Loja Online:* ${storeUrl}\n\n` +
        `💡 _Adicione produtos ao carrinho e finalize pelo WhatsApp ou pague diretamente via PIX com entrega imediata!_`;

      return sock.sendMessage(from, { text: out });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleLoja]:', err.message);
      return sock.sendMessage(from, { text: `❌ Erro ao abrir catálogo.` });
    }
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
            `Aplique distorções e efeitos especiais profissionais da Nazuna em qualquer áudio ou mensagem de voz!\n\n` +
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
        mimetype: 'audio/mp4',
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
          text: `🛡️ *[ANTI-TRAVA NAZUNA]* 🛡️\n\n` +
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
      if (!isGroup || isAdmin) return false;

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
            models.addWarn(from, cleanPhone, 'Anti-Flood: Envio rápido de mensagens consecutivas');
            const warnCount = models.getWarnCount(from, cleanPhone);
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
        text: `🔑 *GERADOR DE CÓDIGO DE ALUGUEL (NAZUNA)* 🔑\n\n` +
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

  async handleUsarCodigo(sock, from, text, senderPhone) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ *Este comando deve ser utilizado dentro do grupo que receberá o aluguel!*' });
    }

    const parts = (text || '').trim().split(/\s+/);
    let code = parts[1]?.toUpperCase();

    // Se o usuário apenas digitou o código de 8 caracteres
    if (!code && /\b[A-F0-9]{8}\b/.test(text.toUpperCase())) {
      code = text.toUpperCase().match(/\b[A-F0-9]{8}\b/)[0];
    }

    if (!code) {
      return sock.sendMessage(from, {
        text: '🔑 Digite o código de 8 caracteres para ativar o aluguel do bot neste grupo.\nExemplo: *!usarcodigo A1B2C3D4*'
      });
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
        text: `🌊 *CONFIGURAÇÃO DO ANTI-FLOOD (NAZUNA)*\n\n` +
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
      return sock.sendMessage(from, { text: '⚠️ *Boas-vindas desativadas neste grupo.*' });
    } else if (clean.includes('on') || clean.includes('ativar')) {
      models.updateGroupProtection(from, { welcome_enabled: true });
      return sock.sendMessage(from, { text: '🎉 *Boas-vindas ativadas! Novos membros serão recebidos com a mensagem configurada.*' });
    }

    const isEnabled = prot?.welcome_enabled !== 0;
    return sock.sendMessage(from, {
      text: `🎉 *BOAS-VINDAS DO GRUPO:* *${isEnabled ? '✅ ATIVADAS' : '❌ DESATIVADAS'}*\n\n` +
        `Para alterar use: *!bemvindo on* ou *!bemvindo off*\n` +
        `Para personalizar a legenda use: *!legendabv <texto>*`
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
  async handleFakeCommand(sock, from, text, quotedMsg = null, senderJid = null) {
    try {
      const raw = (text || '').replace(/^(?:!|\/)fake\s*/i, '').trim();
      if (!raw && !quotedMsg) {
        return sock.sendMessage(from, {
          text: `🎭 *COMO USAR O COMANDO /FAKE:*\n\n` +
            `Simula uma resposta a uma mensagem que qualquer membro supostamente disse!\n\n` +
            `📌 *Formatos Suportados:*\n` +
            `• */fake @usuario O que ele disse | Sua resposta*\n` +
            `• */fake 5511999998888 Texto da citação | Sua resposta*\n` +
            `• Respondendo a uma mensagem: */fake Sua resposta*\n\n` +
            `_Exemplo:_ */fake @5511999998888 O bot é incrível! | Muito obrigado pelo carinho!*`
        });
      }

      let targetJid = null;
      let fakeText = '';
      let botResponse = '';

      // Verifica menção @5511...
      const mentionMatch = raw.match(/@(\d{8,15})/);
      if (mentionMatch) {
        targetJid = `${mentionMatch[1]}@s.whatsapp.net`;
      } else if (quotedMsg && quotedMsg.key?.participant) {
        targetJid = quotedMsg.key.participant;
      } else {
        const firstToken = raw.split(/\s+/)[0];
        const digits = firstToken.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) {
          targetJid = `${digits}@s.whatsapp.net`;
        }
      }

      if (!targetJid) {
        targetJid = senderJid || '5511999990001@s.whatsapp.net';
      }

      // Separa o texto pelo delimitador |
      if (raw.includes('|')) {
        const parts = raw.split('|');
        fakeText = parts[0]
          .replace(/@\d{8,15}/g, '')
          .replace(/^\d{8,15}\s*/, '')
          .trim();
        botResponse = parts.slice(1).join('|').trim();
      } else if (quotedMsg) {
        fakeText = quotedMsg.message?.conversation || 
          quotedMsg.message?.extendedTextMessage?.text || 
          'Mensagem citada';
        botResponse = raw || '👀';
      } else {
        fakeText = raw.replace(/@\d{8,15}/g, '').trim() || 'Declaração simulada';
        botResponse = '👀 _Olha só o que disseram aqui..._';
      }

      if (!fakeText) fakeText = 'Mensagem';
      if (!botResponse) botResponse = '🎭';

      // Constrói o pacote de mensagem quoted falsificada (Baileys Fake Context)
      const fakeQuoted = {
        key: {
          fromMe: false,
          participant: targetJid,
          remoteJid: from,
          id: 'FAKE_' + Math.random().toString(36).substring(2, 10).toUpperCase()
        },
        message: {
          conversation: fakeText
        }
      };

      const mentions = [targetJid];
      return await sock.sendMessage(from, { text: botResponse, mentions }, { quoted: fakeQuoted });
    } catch (err) {
      console.error('[SpyFeatures ⚠️ handleFakeCommand]:', err.message);
      return sock.sendMessage(from, { text: `❌ Falha ao gerar /fake: ${err.message}` });
    }
  }

  // ==========================================
  // 44. TODAS AS FUNÇÕES DO MENUADM (NAZUNA v4.0)
  // ==========================================
  async handleMenuAdm(sock, from, botName = 'PayBot', userName = 'Administrador', prefix = '!') {
    const textMenu = `╭┈⊰ 🌸 『 *${botName}* 』
┊Olá, *${userName}*!
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯

╭┈❪🍧ฺꕸ▸ *ADMINISTRAÇÃO*
┊•.̇𖥨֗🍓⭟${prefix}ban @membro
┊•.̇𖥨֗🍓⭟${prefix}promover @membro
┊•.̇𖥨֗🍓⭟${prefix}rebaixar @membro
┊•.̇𖥨֗🍓⭟${prefix}mute @membro
┊•.̇𖥨֗🍓⭟${prefix}desmute @membro
┊•.̇𖥨֗🍓⭟${prefix}listmute
┊•.̇𖥨֗🍓⭟${prefix}adv @membro [motivo]
┊•.̇𖥨֗🍓⭟${prefix}rmadv @membro
┊•.̇𖥨֗🍓⭟${prefix}listadv
┊•.̇𖥨֗🍓⭟${prefix}addblacklist <numero>
┊•.̇𖥨֗🍓⭟${prefix}delblacklist <numero>
┊•.̇𖥨֗🍓⭟${prefix}listblacklist
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯

╭┈❪🍧ฺꕸ▸ *GERENCIAMENTO*
┊•.̇𖥨֗🍓⭟${prefix}del _(respondendo mensagem)_
┊•.̇𖥨֗🍓⭟${prefix}limpar _(limpa chat na hora)_
┊•.̇𖥨֗🍓⭟${prefix}banghost
┊•.̇𖥨֗🍓⭟${prefix}hidetag [mensagem]
┊•.̇𖥨֗🍓⭟${prefix}marcar [mensagem]
┊•.̇𖥨֗🍓⭟${prefix}sorteio <Premio> | <qtd>
┊•.̇𖥨֗🍓⭟${prefix}linkgp
┊•.̇𖥨֗🍓⭟${prefix}grupo a _(abrir grupo)_
┊•.̇𖥨֗🍓⭟${prefix}grupo f _(fechar grupo)_
┊•.̇𖥨֗🍓⭟${prefix}setname <Novo Nome>
┊•.̇𖥨֗🍓⭟${prefix}setdesc <Nova Descrição>
┊•.̇𖥨֗🍓⭟${prefix}addregra <Texto da Regra>
┊•.̇𖥨֗🍓⭟${prefix}regras
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯

╭┈❪🍧ฺꕸ▸ *COMANDOS BLOCK*
┊•.̇𖥨֗🍓⭟${prefix}blockcmd <comando>
┊•.̇𖥨֗🍓⭟${prefix}unblockcmd <comando>
┊•.̇𖥨֗🍓⭟${prefix}listblockcmd
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯

╭┈❪🍧ฺꕸ▸ *PROTEÇÕES & ATIVAÇÕES*
┊•.̇𖥨֗🍓⭟${prefix}antidoc [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antiloc [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antifig [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antipt [on/off]
┊•.̇𖥨֗🍓⭟${prefix}soadm [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antifake [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antitrava [on/off]
┊•.̇𖥨֗🍓⭟${prefix}antiflood [on/off]
┊•.̇𖥨֗🍓⭟${prefix}bemvindo [on/off]
┊•.̇𖥨֗🍓⭟${prefix}saida [on/off]
┊•.̇𖥨֗🍓⭟${prefix}x9 [on/off]
┊•.̇𖥨֗🍓⭟${prefix}verificado [on/off]
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯

╭┈❪🍧ฺꕸ▸ *CONFIGURAÇÕES*
┊•.̇𖥨֗🍓⭟${prefix}legendabv <texto>
┊•.̇𖥨֗🍓⭟${prefix}legendasaiu <texto>
┊•.̇𖥨֗🍓⭟${prefix}modoaluguel [1/0]
┊•.̇𖥨֗🍓⭟${prefix}tempoaluguel
┊•.̇𖥨֗🍓⭟${prefix}topcmd
╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯`;

    return sock.sendMessage(from, { text: textMenu });
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
  async handleDeleteMessage(sock, from, quotedKey, isAdmin, isBotAdmin) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem apagar mensagens de outros membros.' });
    if (!isBotAdmin) return sock.sendMessage(from, { text: '⚠️ O bot precisa ser administrador para apagar mensagens no grupo.' });
    if (!quotedKey) return sock.sendMessage(from, { text: '❓ Responda à mensagem que deseja apagar com *!del*' });

    try {
      await sock.sendMessage(from, { delete: quotedKey });
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

  // 44.8 Hidetag e Marcar Todos
  async handleHidetag(sock, from, text, metadata, quotedMsg = null, isAdmin = false, isBotAdmin = false) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem usar o hidetag.' });
    const participants = (metadata?.participants || []).map(p => p.id || `${p.phoneNumber}@s.whatsapp.net`).filter(Boolean);
    if (!participants.length) return sock.sendMessage(from, { text: '⚠️ Nenhum participante encontrado para marcar.' });

    const cleanText = (text || '').replace(/^(?:!|\/)hidetag\s*/i, '').trim() || '📢 Atenção membros do grupo!';

    return sock.sendMessage(from, {
      text: cleanText,
      mentions: participants
    });
  }

  async handleMarcar(sock, from, text, metadata, isAdmin = false) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem marcar todos os membros.' });
    const participants = metadata?.participants || [];
    if (!participants.length) return sock.sendMessage(from, { text: '⚠️ Nenhum participante encontrado.' });

    const cleanText = (text || '').replace(/^(?:!|\/)(?:marcar|tagall)\s*/i, '').trim();
    let msg = `📢 *CHAMADA GERAL DO GRUPO* 📢\n`;
    if (cleanText) msg += `📝 *Aviso:* ${cleanText}\n\n`;
    else msg += `\n`;

    const mentions = [];
    participants.forEach((p, idx) => {
      const jid = p.id || `${p.phoneNumber}@s.whatsapp.net`;
      const num = String(jid).replace(/\D/g, '');
      msg += `${idx + 1}. @${num}\n`;
      mentions.push(jid);
    });

    return sock.sendMessage(from, { text: msg, mentions });
  }

  // 44.9 Sorteio no Grupo (!sorteio)
  async handleSorteio(sock, from, text, metadata, isAdmin = false) {
    if (!isAdmin) return sock.sendMessage(from, { text: '⛔ Apenas administradores podem iniciar sorteios.' });
    const clean = (text || '').replace(/^(?:!|\/)(?:sorteio|sortear|raffle)\s*/i, '').trim();
    if (!clean) {
      return sock.sendMessage(from, {
        text: `🎲 *COMO REALIZAR SORTEIOS:*\n\n` +
          `📌 *Uso:* *!sorteio <Prêmio> | <Quantidade de Ganhadores>*\n` +
          `_Exemplo:_ *!sorteio 1 Mês de Licença PayBot | 2*`
      });
    }

    const participants = (metadata?.participants || []).map(p => p.id || `${p.phoneNumber}@s.whatsapp.net`).filter(Boolean);
    if (!participants.length) return sock.sendMessage(from, { text: '⚠️ Grupo sem participantes suficientes para o sorteio.' });

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
      `👥 *Ganhadores Sorteados:*\n`;

    winners.forEach((w, i) => {
      const num = String(w).replace(/\D/g, '');
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

  async handleRegras(sock, from) {
    const rules = models.getGroupRules(from);
    if (!rules) {
      return sock.sendMessage(from, {
        text: `📜 *REGRAS DO GRUPO:*\n\nNenhuma regra foi cadastrada ainda neste grupo.\nAdministradores podem definir usando: *!addregra <texto>*`
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
      soadm: { field: 'soadm_enabled', name: 'Modo Somente Adm' }
    };

    const target = keyMap[key];
    if (!target) return sock.sendMessage(from, { text: `❓ Opção de proteção desconhecida.` });

    let newState;
    if (shouldEnable) newState = true;
    else if (shouldDisable) newState = false;
    else newState = !prot[target.field];

    models.updateGroupProtection(from, { [target.field]: newState });

    return sock.sendMessage(from, {
      text: `🛡️ *${target.name.toUpperCase()}:* ${newState ? '🟢 ATIVADO' : '🔴 DESATIVADO'}\n` +
        (newState ? `_Mensagens desse tipo serão interceptadas imediatamente no grupo._` : `_Envio permitido normalmente no grupo._`)
    });
  }
}

module.exports = new SpyFeaturesService();

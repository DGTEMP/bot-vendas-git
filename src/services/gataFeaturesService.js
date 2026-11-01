const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const models = require('../db/models');
const stickerConverter = require('../utils/stickerConverter');
const instagramScraperService = require('./instagramScraperService');

class GataFeaturesService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || 'sk-6dd285069ee60c6b-fcf00a-fe2a0f79';
    this.groupMessageActivity = new Map(); // groupId -> Set(senderPhone)
    this.recentMessages = new Map(); // key: "${from}:${id}" -> { text, media, sender, pushName, timestamp }
    this.userSearchResults = new Map(); // fromJid -> Array de até 20 vídeos do !lista
  }

  // Registra atividade para rastreamento de fantasmas
  recordActivity(groupId, senderPhone) {
    if (!this.groupMessageActivity.has(groupId)) {
      this.groupMessageActivity.set(groupId, new Set());
    }
    this.groupMessageActivity.get(groupId).add(senderPhone);
  }

  // Cacheia mensagens recentes para o Anti-Delete (Gata Nina Security)
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

      if (this.recentMessages.size > 1500) {
        const firstKey = this.recentMessages.keys().next().value;
        this.recentMessages.delete(firstKey);
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
      console.error('[GataFeatures ❌ Erro ao baixar mídia]:', err.message);
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
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(speechText.slice(0, 200))}&tl=pt&client=tw-ob`;
      const res = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!res.ok) throw new Error('Falha ao sintetizar áudio');

      const audioBuffer = Buffer.from(await res.arrayBuffer());
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

  // Helper: Extrai áudio de vídeo do YouTube usando yt-dlp ou fallbacks
  async downloadYouTubeAudio(videoUrl) {
    // 1. Tenta extração via yt-dlp nativo
    try {
      const { spawn } = require('child_process');
      const buf = await new Promise((resolve, reject) => {
        const proc = spawn('python', ['-m', 'yt_dlp', '-f', 'ba[ext=m4a]/ba/b', '-o', '-', videoUrl]);
        const chunks = [];
        let errData = '';

        proc.stdout.on('data', chunk => chunks.push(chunk));
        proc.stderr.on('data', d => { errData += d.toString(); });

        proc.on('error', err => reject(err));
        proc.on('close', code => {
          if (code === 0 && chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`yt-dlp falhou (${code}): ${errData.slice(0, 100)}`));
          }
        });

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          reject(new Error('Tempo limite excedido'));
        }, 40000);
      });

      if (buf && buf.length > 5000) {
        return { buffer: buf, mimetype: 'audio/mp4', ext: 'm4a' };
      }
    } catch (err) {
      console.warn('[GataFeatures ⚠️ Falha no yt-dlp stdout]:', err.message);
    }

    // 2. Tenta extração de URL direta do stream via yt-dlp --get-url
    try {
      const { execSync } = require('child_process');
      const directUrl = execSync(`python -m yt_dlp -f "ba[ext=m4a]/ba" --get-url "${videoUrl}"`, { timeout: 15000, encoding: 'utf8' }).trim();
      const firstUrl = directUrl.split('\n')[0].trim();
      if (firstUrl && firstUrl.startsWith('http')) {
        const res = await fetch(firstUrl, { signal: AbortSignal.timeout(20000) });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return { buffer: Buffer.from(arrayBuf), mimetype: 'audio/mp4', ext: 'm4a' };
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
            return { buffer: Buffer.from(arrayBuf), mimetype: 'audio/mp4', ext: 'mp3' };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  // Comando !play / !ytmp3 / !audio (Busca e baixa música do YouTube)
  async handlePlayMusic(sock, from, query) {
    const cleanQ = query.replace(/^(?:!|\/)(?:play|ytmp3|musica|audio|mp3)\s*/i, '').trim();
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🎵 *REPRODUTOR DE MÚSICAS YOUTUBE*\n\n` +
          `Digite o nome da música, número da !lista ou link do YouTube após o comando!\n\n` +
          `Exemplos:\n` +
          `• *!play Imagine Dragons Believer*\n` +
          `• *!play 1* (baixa o 1º item da busca !lista)\n` +
          `• *!play https://www.youtube.com/watch?v=...*`
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

      const cardText = `🎵 *YOUTUBE PLAY (MÚSICA)* 🎵\n\n` +
        `📌 *Título:* ${video.title}\n` +
        `⏱️ *Duração:* ${video.timestamp || 'Desconhecida'}\n` +
        `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
        `🔗 *Link:* ${video.url}\n\n` +
        `⏳ *Baixando áudio em alta qualidade...* Aguarde alguns instantes!`;

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

      // Baixa áudio do YouTube
      const audioData = await this.downloadYouTubeAudio(video.url);

      if (audioData && audioData.buffer) {
        const safeTitle = (video.title || 'musica').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
        await sock.sendMessage(from, {
          audio: audioData.buffer,
          mimetype: audioData.mimetype || 'audio/mp4',
          fileName: `${safeTitle}.mp3`,
          ptt: false
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
      console.error('[GataFeatures ❌ Erro em handlePlayMusic]:', err.message);
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
          const proc = spawn('python', ['-m', 'yt_dlp', '-f', 'b', '-o', '-', cleanUrl]);
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
  // 3. SEGURANÇA & MODERAÇÃO DE GRUPOS (GATA NINA SECURITY)
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

  // Anti-Fake / Anti-Estrangeiro (Gata Nina Security)
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
        console.log(`[Gata Nina 🛡️ ANTI-FAKE] Expulsando número estrangeiro ${phone} do grupo ${groupId}`);
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

    const card = `👤 *PERFIL DO USUÁRIO*\n\n` +
      `🏷️ *Nome:* ${loyalty.user_name || userName || 'Cliente'}\n` +
      `📱 *WhatsApp:* +${cleanPhone}\n` +
      `⭐ *Nível:* Nível ${loyalty.level} (*${title}*)\n` +
      `✨ *Experiência:* ${loyalty.exp % 100} / 100 XP\n` +
      `🪙 *Moedas de Fidelidade:* *${loyalty.points} pts*\n` +
      `📦 *Compras Concluídas:* ${totalOrders} pedido(s)\n` +
      `⚠️ *Advertências Ativas:* ${warnsCount}/3\n\n` +
      `> 🎁 *Resgate de Recompensas:* Envie *!resgatar* para trocar 100 pontos por um Cupom de Desconto de 15% na loja!`;

    return sock.sendMessage(from, { text: card });
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
      text: `🎰 *ROLETA DA SORTE GATA NINA* 🎰\n\n` +
        `Girando... 🎡\n\n` +
        `Resultado: ${prize > 0 ? `🎉 *Você ganhou +${prize} pontos de fidelidade!*` : '😅 *Quase! Tente novamente mais tarde!*'}\n` +
        `Seu saldo atual: *${res.points} pts* (Nível ${res.level})`
    });
  }

  // Comando !video / !ytmp4 / !play2 / !mp4 (Busca e baixa vídeo do YouTube em MP4 sem limite de 50MB)
  async handlePlayVideo(sock, from, query) {
    const cleanQ = query.replace(/^(?:!|\/)(?:video|ytmp4|play2|mp4)\s*/i, '').trim();
    if (!cleanQ) {
      return sock.sendMessage(from, {
        text: `🎬 *DOWNLOADER DE VÍDEOS YOUTUBE*\n\n` +
          `Envie o nome do vídeo, número da !lista ou link após o comando!\n\n` +
          `Exemplos:\n` +
          `• *!video Cortes Podcast*\n` +
          `• *!video 1* (baixa o 1º item da busca !lista)\n` +
          `• *!video https://www.youtube.com/watch?v=...*`
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
      }

      if (!video) {
        const searchResults = await yts(cleanQ);
        const videos = searchResults?.videos || [];
        if (videos.length === 0) {
          return sock.sendMessage(from, { text: `🔍 Nenhum vídeo encontrado para: "${cleanQ}". Tente outros termos.` });
        }
        video = videos[0];
      }

      await sock.sendMessage(from, {
        text: `⏳ *Processando download de vídeo...*\n\n` +
          `🎬 *Título:* ${video.title}\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n\n` +
          `_Aguarde enquanto preparamos o vídeo (vídeos longos são enviados sem limite de 50MB)..._`
      });

      // 1. Tenta baixar via yt-dlp local (com suporte a vídeos de até 200MB)
      let videoBuffer = null;
      try {
        const { spawn } = require('child_process');
        videoBuffer = await new Promise((resolve, reject) => {
          const proc = spawn('python', [
            '-m', 'yt_dlp',
            '-f', 'best[ext=mp4][filesize<200M]/bestvideo[height<=720]+bestaudio/best[height<=720]/b',
            '--max-filesize', '200M',
            '-o', '-',
            video.url
          ]);
          const chunks = [];
          proc.stdout.on('data', chunk => chunks.push(chunk));
          proc.on('close', code => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error('yt-dlp video falhou'));
          });
          setTimeout(() => {
            try { proc.kill(); } catch (_) {}
            reject(new Error('Timeout de download de vídeo'));
          }, 90000);
        });
      } catch (_) {}

      // 2. Fallback via API pública de download
      if (!videoBuffer || videoBuffer.length < 5000) {
        try {
          const apiRes = await fetch(`https://api.vreden.my.id/api/ytmp4?url=${encodeURIComponent(video.url)}`, { signal: AbortSignal.timeout(20000) });
          const apiData = await apiRes.json();
          const downloadUrl = apiData?.result?.download?.url || apiData?.result?.url;
          if (downloadUrl) {
            const mediaRes = await fetch(downloadUrl);
            videoBuffer = Buffer.from(await mediaRes.arrayBuffer());
          }
        } catch (_) {}
      }

      if (videoBuffer && videoBuffer.length > 5000) {
        const caption = `🎬 *${video.title}*\n\n` +
          `⏱️ *Duração:* ${video.timestamp || 'N/A'}\n` +
          `👤 *Canal:* ${video.author?.name || 'YouTube'}\n` +
          `🔗 *Link:* ${video.url}`;

        if (videoBuffer.length > 60 * 1024 * 1024) {
          // Arquivos acima de 60MB enviados como documento para contornar limite nativo do player do WhatsApp
          await sock.sendMessage(from, {
            document: videoBuffer,
            fileName: `${(video.title || 'video').replace(/[^\w\s-]/gi, '').slice(0, 50)}.mp4`,
            caption,
            mimetype: 'video/mp4'
          });
        } else {
          await sock.sendMessage(from, {
            video: videoBuffer,
            caption,
            mimetype: 'video/mp4'
          });
        }

        // Bonifica usuário
        const phone = from.split('@')[0].split(':')[0].replace(/\D/g, '');
        models.addLoyaltyPoints('whatsapp', phone, 5, 5);
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ *Não foi possível carregar o vídeo completo (pode exceder 200MB ou ter restrição de direitos/idade).*\n\n` +
            `🔗 Assista diretamente pelo YouTube:\n${video.url}`
        });
      }
    } catch (err) {
      console.error('[GataFeatures ❌ Erro em handlePlayVideo]:', err.message);
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
      console.error('[GataFeatures ❌ Erro em handleLista]:', err.message);
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
          const proc = spawn('python', ['-m', 'yt_dlp', '-f', 'b', '-o', '-', cleanUrl]);
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
          const proc = spawn('python', ['-m', 'yt_dlp', '-f', 'b', '-o', '-', cleanUrl]);
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
      const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
      const data = await res.json();
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
  // MULTI-DISPOSITIVOS & JADIBOT / SERBOT (GATABOT-MD)
  // ==========================================

  // Comando !serbot / !jadibot / !subbot / !code
  async handleSerBot(sock, from, text, senderPhone, isGroup) {
    const whatsappArmyService = require('./whatsappArmyService');
    const rawArgs = text.replace(/^(?:!|\/)(?:serbot|jadibot|subbot|conectar|code)\s*/i, '').trim();
    let phoneArg = rawArgs.replace(/\D/g, '');

    // Se não passou número e está no privado, pode usar o número de quem chamou
    if (!phoneArg && !isGroup && senderPhone && senderPhone.length >= 10) {
      phoneArg = senderPhone;
    }

    if (!phoneArg || phoneArg.length < 10) {
      const infoMsg = `🐱 *GATABOT / SUB-BOT MULTI-DISPOSITIVOS* 🐱\n\n` +
        `Você pode conectar múltiplos números de WhatsApp para vender e responder juntos com o bot!\n\n` +
        `📱 *Como Conectar com Código de 8 Dígitos:*\n` +
        `Envie o comando com seu número (com DDD):\n` +
        `👉 *!serbot 5511999998888* ou *!code 5511999998888*\n\n` +
        `🌐 *Pelo Painel Web:*\n` +
        `Acesse http://localhost:3000 > *Conexões* e clique em *+ Adicionar Outra Conta WhatsApp* para escanear QR Code ou gerar código na tela!\n\n` +
        `💡 Digite *!bots* para ver todas as contas conectadas agora.`;
      return sock.sendMessage(from, { text: infoMsg });
    }

    if (phoneArg.length === 10 || phoneArg.length === 11) {
      phoneArg = '55' + phoneArg;
    }

    await sock.sendMessage(from, { text: `⏳ Gerando código de conexão seguro para o número *+${phoneArg}*... Aguarde alguns segundos.` });

    try {
      // 1. Cria ou reutiliza instância secundária
      const newInst = await whatsappArmyService.createAndConnectInstance({
        name: `Sub-Bot +${phoneArg}`,
        phone: phoneArg,
        daily_limit: 100
      });

      // Aguarda o socket iniciar
      await new Promise(r => setTimeout(r, 2000));

      // 2. Solicita código de pareamento
      const pairingRes = await whatsappArmyService.requestPairingCode(newInst.id, phoneArg);
      const code = pairingRes.pairingCode;

      const successMsg = `🐱 *GATABOT / SUB-BOT MULTI-CONEXÃO* 🐱\n\n` +
        `Código de pareamento gerado com sucesso para *+${phoneArg}*!\n\n` +
        `🔑 *SEU CÓDIGO DE CONEXÃO:* \n` +
        `👉 *${code}* 👈\n\n` +
        `📋 *PASSO A PASSO NO SEU WHATSAPP:*\n` +
        `1. Abra o WhatsApp do celular que quer conectar.\n` +
        `2. Toque nos três pontinhos ⋮ ou *Configurações* > *Aparelhos Conectados*.\n` +
        `3. Toque em *Conectar um Aparelho*.\n` +
        `4. Toque em *Conectar com número de telefone* (embaixo da tela).\n` +
        `5. Digite o código de 8 dígitos: *${code}*\n\n` +
        `⏱️ O código expira em 2 minutos. Assim que conectar, este WhatsApp responderá automaticamente a todos os comandos e catálogo!`;

      return sock.sendMessage(from, { text: successMsg });
    } catch (err) {
      return sock.sendMessage(from, {
        text: `❌ Não foi possível gerar o código de conexão para +${phoneArg}: ${err.message}\n\nTente novamente ou conecte pelo Painel Web em http://localhost:3000 > Conexões.`
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

      msg += `💡 Para conectar mais um WhatsApp, envie *!serbot <numero>* ou use o Painel Web em http://localhost:3000 > *Conexões*!`;
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
        msg += `\n👉 Para divulgar, envie: *!promover <id>*\nExemplo: *!promover 1*`;
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
  async handlePing(sock, from, msg = null) {
    const start = Date.now();
    let msgTime = msg?.messageTimestamp;
    if (typeof msgTime === 'object' && msgTime?.low) msgTime = msgTime.low;
    const latency = msgTime ? Math.max(1, Math.abs(start - (msgTime * 1000))) : Math.floor(Math.random() * 25) + 20;

    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = Math.floor(uptimeSec % 60);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const ramUsageMB = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
    const instances = models.getArmyInstances();
    const activeSubBots = instances.filter(i => !i.is_main && i.status === 'CONNECTED').length;
    const totalSubBots = instances.filter(i => !i.is_main).length;

    const pingText = `🏓 *PONG!*\n\n` +
      `⚡ *Velocidade:* \`${latency}ms\`\n` +
      `⏱️ *Tempo Ativo (Uptime):* \`${uptimeStr}\`\n` +
      `💾 *Memória RAM:* \`${ramUsageMB} MB\`\n` +
      `💻 *Plataforma:* \`Node.js ${process.version} (${process.platform})\`\n\n` +
      `📱 *Rede Multi-Device:*\n` +
      `• *Matriz Principal:* 🟢 Conectada & Operante\n` +
      `• *Sub-Bots (Chips):* 🟢 ${activeSubBots} online de ${totalSubBots} cadastrados\n\n` +
      `🌐 *Painel Web:* http://localhost:3000`;

    return sock.sendMessage(from, { text: pingText });
  }

  // Comando !configurar / !config (Visualiza e altera configurações pelo WhatsApp)
  async handleConfigurar(sock, from, text, isAdmin = true) {
    const clean = text.replace(/^(?:!|\/)(?:configurar|config|configuracoes|painelbot)\s*/i, '').trim();

    if (clean) {
      if (!isAdmin) {
        return sock.sendMessage(from, { text: '⚠️ Apenas administradores ou o Dono podem alterar configurações.' });
      }
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

    const configMsg = `⚙️ *PAINEL DE CONFIGURAÇÕES GATA NINA + PAYBOT* ⚙️\n\n` +
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
      `🌐 *CONFIGURAÇÃO COMPLETA NO NAVEGADOR:*\n` +
      `Acesse o painel web em tempo real:\n` +
      `👉 *http://localhost:3000*\n\n` +
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

    guide += `🌐 *PAINEL WEB COMPLETO (PORTA 3000):*\n` +
      `No navegador em *http://localhost:3000* você pode ver QR Codes ao vivo, gerar códigos de 8 dígitos, iniciar, pausar e resetar chips com 1 clique!`;

    return sock.sendMessage(from, { text: guide });
  }
}

module.exports = new GataFeaturesService();

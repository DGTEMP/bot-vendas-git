const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const models = require('../db/models');

class GataFeaturesService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || 'sk-6dd285069ee60c6b-fcf00a-fe2a0f79';
    this.groupMessageActivity = new Map(); // groupId -> Set(senderPhone)
  }

  // Registra atividade para rastreamento de fantasmas
  recordActivity(groupId, senderPhone) {
    if (!this.groupMessageActivity.has(groupId)) {
      this.groupMessageActivity.set(groupId, new Set());
    }
    this.groupMessageActivity.get(groupId).add(senderPhone);
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

    if (targetMsg.imageMessage) {
      type = 'image';
      streamType = 'image';
      mediaObj = targetMsg.imageMessage;
    } else if (targetMsg.videoMessage) {
      type = 'video';
      streamType = 'video';
      mediaObj = targetMsg.videoMessage;
    } else if (targetMsg.stickerMessage) {
      type = 'sticker';
      streamType = 'sticker';
      mediaObj = targetMsg.stickerMessage;
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

  // Converte buffer de imagem para WebP (Sticker) via serviço open-source
  async convertImageToWebP(imageBuffer) {
    try {
      // 1. Faz upload temporário do buffer
      const form = new FormData();
      form.append('file', new Blob([imageBuffer]), 'input.jpg');
      const upRes = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form
      });
      const upData = await upRes.json();
      if (!upData?.data?.url) throw new Error('Falha no upload da imagem temporária');

      const directUrl = upData.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');

      // 2. Converte para WebP 512x512 via wsrv.nl
      const webpRes = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(directUrl)}&output=webp&w=512&h=512&fit=contain`);
      if (!webpRes.ok) throw new Error('Falha na conversão WebP via wsrv.nl');

      const arrayBuf = await webpRes.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      console.error('[GataFeatures ⚠️ Falha na conversão WebP remota]:', err.message);
      return imageBuffer; // Retorna buffer original como fallback
    }
  }

  // Comando !s / !sticker
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
      let stickerBuffer = media.buffer;
      if (media.type === 'image') {
        stickerBuffer = await this.convertImageToWebP(media.buffer);
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

  // Comando !play / !ytmp3 (Busca e baixa música do YouTube)
  async handlePlayMusic(sock, from, query) {
    const cleanQ = query.replace(/^(?:!|\/)(?:play|ytmp3|musica)\s*/i, '').trim();
    if (!cleanQ) {
      return sock.sendMessage(from, { text: `🎵 Digite o nome da música ou o link do YouTube! Exemplo: *!play Imagine Dragons Believer*` });
    }

    await sock.sendMessage(from, { text: `🔎 *Buscando música:* "${cleanQ}"...\n⏳ Aguarde enquanto preparamos seu áudio!` });

    try {
      // Endpoint público de download de áudio
      const apiUrl = `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(cleanQ)}`;
      const res = await fetch(apiUrl);
      const data = await res.json();

      if (data?.data?.dl) {
        const audioRes = await fetch(data.data.dl);
        const audioBuf = Buffer.from(await audioRes.arrayBuffer());
        await sock.sendMessage(from, {
          audio: audioBuf,
          mimetype: 'audio/mp4',
          fileName: `${data.data.title || 'musica'}.mp3`
        });
      } else {
        await sock.sendMessage(from, {
          text: `🎶 *Música Encontrada:* ${cleanQ}\n\nVocê pode ouvir e baixar diretamente através do link oficial no YouTube ou usar um link direto com *!ytmp3 <link>*.`
        });
      }
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ Não foi possível baixar no momento. Tente com outro termo ou link direto.` });
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
      const res = await fetch(`https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(cleanUrl)}`);
      const data = await res.json();

      if (data?.data && data.data.length > 0) {
        const item = data.data[0];
        const mediaUrl = item.url || item.dl;
        const mediaRes = await fetch(mediaUrl);
        const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());

        if (item.type === 'video' || mediaUrl.includes('.mp4')) {
          await sock.sendMessage(from, { video: mediaBuf, caption: '🎬 *Instagram Reels Baixado!*' });
        } else {
          await sock.sendMessage(from, { image: mediaBuf, caption: '📸 *Foto do Instagram Baixada!*' });
        }
      } else {
        await sock.sendMessage(from, { text: `⚠️ Link protegido ou privado no Instagram.` });
      }
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Erro no download do Instagram: ${err.message}` });
    }
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

    for (const participant of participants) {
      const phone = participant.split('@')[0].split(':')[0];
      // Verifica se o DDI NÃO é brasileiro (não começa com 55)
      if (!phone.startsWith('55')) {
        console.log(`[Gata Nina 🛡️ ANTI-FAKE] Expulsando número estrangeiro ${phone} do grupo ${groupId}`);
        try {
          await sock.groupParticipantsUpdate(groupId, [participant], 'remove');
          await sock.sendMessage(groupId, {
            text: `🛡️ *ANTI-FAKE ATIVADO!*\n\n` +
              `O número estrangeiro/fake @${phone} foi banido automaticamente deste grupo para proteção dos membros contra golpes e spams.`,
            mentions: [participant]
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
      const phone = p.id.split('@')[0].split(':')[0];
      return !activeSet.has(phone);
    });

    if (inactives.length === 0) {
      return sock.sendMessage(from, { text: `🎉 *Grupo 100% ativo!* Nenhum membro fantasma detectado nesta sessão.` });
    }

    let text = `👻 *MEMBROS FANTASMAS DETECTADOS (${inactives.length}/${participants.length}):*\n\n` +
      `Estes membros não enviaram mensagens recentes no grupo:\n\n`;

    inactives.slice(0, 15).forEach((p, i) => {
      const phone = p.id.split('@')[0].split(':')[0];
      text += `${i + 1}. @${phone}\n`;
    });

    if (inactives.length > 15) {
      text += `\n... e mais ${inactives.length - 15} participantes inativos.`;
    }

    text += `\n\n💡 *Dica do Admin:* Você pode interagir com eles ou fazer uma limpa periódica!`;

    const mentions = inactives.slice(0, 15).map(p => p.id);
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
    const orders = models.getAllOrders(100).filter(o => o.platform === 'whatsapp' && o.platform_user_id.includes(cleanPhone) && o.status === 'PAID');

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
}

module.exports = new GataFeaturesService();

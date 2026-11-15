/**
 * =========================================================================
 * 🧠 NATURAL LANGUAGE COMMAND RESOLVER & DISPATCHER (99% CERTAINTY ENGINE)
 * =========================================================================
 * Otimizado por completo para o Português do Brasil (PT-BR), cobrindo:
 * 1. Gírias regionais brasileiras, contrações populares e escrita de WhatsApp
 *    (ex: pfv, plmds, bora, parça, mano, vei, adm, oq, pq, qto, pra mim, etc.)
 * 2. Herança semântica e contextual de mensagens citadas (Quoted Message):
 *    - Se o usuário cita um link e diz "baixa aí pra mim", o bot captura a URL citada!
 *    - Se o usuário cita uma foto e diz "faz figurinha", o bot gera a figurinha!
 *    - Se cita uma figurinha e diz "passa pra foto", o bot converte em imagem!
 *    - Se cita um vídeo e diz "tira o áudio", o bot extrai o MP3!
 *    - Se cita uma mensagem e diz "apaga isso", o bot apaga a mensagem citada!
 *    - Se cita um membro e diz "bane ele", o bot identifica o autor como alvo!
 * 3. Matriz completa de utilidades, downloads, auditoria PageSpeed, IMEI,
 *    moderação administrativa e catálogo e-commerce.
 * 4. Blindagem absoluta de segurança: Comandos de grupo exigem permissão de Admin/Dono
 *    e a marcação geral (@marcar) poupa expressamente todos os administradores.
 * =========================================================================
 */

class NaturalLanguageCommandService {
  constructor() {
    this.CERTAINTY_THRESHOLD = 0.99;
  }

  /**
   * Normaliza textos em Português do Brasil (PT-BR) para análise fonética e semântica:
   * - Remove diacríticos e acentuações sem alterar o sentido (ex: vídeo -> video, música -> musica)
   * - Expande abreviações e contrações populares do WhatsApp brasileiro
   */
  normalizePtBr(raw) {
    if (!raw) return '';
    let text = String(raw).toLowerCase().trim();

    // 1. Remove acentuações mantendo caracteres base
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 2. Normaliza contrações e gírias de internet / WhatsApp PT-BR
    const replacements = [
      [/\b(por\s*fa|pfv|porfa|plmds|por\s*favo)\b/g, 'por favor'],
      [/\b(oq|o\s*q|oque)\b/g, 'o que'],
      [/\b(pq|p\s*q)\b/g, 'por que'],
      [/\b(qto|qnto)\b/g, 'quanto'],
      [/\b(vc|vcs|ce|ces)\b/g, 'voce'],
      [/\b(pra\s+mim)\b/g, 'para mim'],
      [/\bpra\b/g, 'para'],
      [/\bpro\b/g, 'para o'],
      [/\bpras\b/g, 'para as'],
      [/\bpros\b/g, 'para os'],
      [/\b(to|ta|tamo|tao)\b/g, 'esta'],
      [/\b(tb|tbm|tbem)\b/g, 'tambem'],
      [/\b(vlw|valeu|tmj|brigado|obg|obgd)\b/g, 'obrigado'],
      [/\b(flw|falou|ate\s*mais)\b/g, 'tchau'],
      [/\b(adm|adms|admin|administrador|ademir)\b/g, 'administrador'],
      [/\b(baxar|baxa|baixe|dowload|dawload|donwload|downlod)\b/g, 'baixar'],
      [/\b(stiker|stikers|stiqer|stiquer|fig|figs|figura|adesivo|figurao)\b/g, 'figurinha'],
      [/\b(peigespid|pagesped|peidgispid|page\s*speed)\b/g, 'pagespeed'],
      [/\b(emil|imie|imey)\b/g, 'imei'],
      [/\b(deletar|deleta|excluir|exclui|some\s+com)\b/g, 'apagar'],
      [/\b(kikar|kika|chutar|chuta|passa\s+o\s+rodo|passa\s+o\s+cerol)\b/g, 'banir']
    ];

    for (const [pattern, repl] of replacements) {
      text = text.replace(pattern, repl);
    }

    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Extrai URLs contidas no texto e opcionalmente no texto citado
   */
  extractUrls(text, quotedText = '') {
    const combined = `${text || ''} ${quotedText || ''}`;
    if (!combined.trim()) return [];
    const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"'{}|\\^`[\]]+/gi;
    const matches = combined.match(urlRegex) || [];
    return matches.map(u => {
      if (u.startsWith('www.')) return `https://${u}`;
      return u;
    });
  }

  /**
   * Extrai o domínio ou URL de um site para auditoria/PageSpeed
   */
  extractSiteUrl(text, quotedText = '') {
    const urls = this.extractUrls(text, quotedText);
    if (urls.length > 0) return urls[0];

    const combined = `${text || ''} ${quotedText || ''}`;
    const domainMatch = combined.match(/\b([a-zA-Z0-9\-]+\.(?:com\.br|com|org|net|io|tech|app|site|online|me|info|gov\.br|edu\.br)(?:\/[^\s]*)?)\b/i);
    if (domainMatch) {
      return `https://${domainMatch[1]}`;
    }
    return null;
  }

  /**
   * Extrai informações de mídia presentes na mensagem ou na mensagem citada (quoted)
   */
  extractMediaInfo(msg) {
    const directImage = Boolean(msg?.message?.imageMessage);
    const directVideo = Boolean(msg?.message?.videoMessage);
    const directSticker = Boolean(msg?.message?.stickerMessage);
    const directAudio = Boolean(msg?.message?.audioMessage);

    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo
      || msg?.message?.imageMessage?.contextInfo
      || msg?.message?.videoMessage?.contextInfo
      || msg?.message?.documentMessage?.contextInfo
      || msg?.message?.audioMessage?.contextInfo
      || msg?.message?.stickerMessage?.contextInfo;

    const quotedMessage = contextInfo?.quotedMessage;
    const quotedImage = Boolean(quotedMessage?.imageMessage);
    const quotedVideo = Boolean(quotedMessage?.videoMessage);
    const quotedSticker = Boolean(quotedMessage?.stickerMessage);
    const quotedAudio = Boolean(quotedMessage?.audioMessage);

    const quotedText = quotedMessage?.conversation
      || quotedMessage?.extendedTextMessage?.text
      || quotedMessage?.imageMessage?.caption
      || quotedMessage?.videoMessage?.caption
      || '';

    const stanzaId = contextInfo?.stanzaId || null;
    const quotedParticipant = contextInfo?.participant || null;
    const mentionedJids = contextInfo?.mentionedJid || [];

    return {
      hasDirectMedia: directImage || directVideo || directSticker || directAudio,
      hasQuotedMedia: quotedImage || quotedVideo || quotedSticker || quotedAudio,
      hasMedia: directImage || directVideo || directSticker || directAudio || quotedImage || quotedVideo || quotedSticker || quotedAudio,
      isImage: directImage || quotedImage,
      isVideo: directVideo || quotedVideo,
      isSticker: directSticker || quotedSticker,
      isAudio: directAudio || quotedAudio,
      directSticker,
      quotedSticker,
      directVideo,
      quotedVideo,
      stanzaId,
      quotedParticipant,
      mentionedJids,
      quotedText
    };
  }

  /**
   * Resolve a intenção e avalia se atinge os 99% de certeza para execução direta
   */
  resolveCommand(text, options = {}) {
    const rawText = String(text || '').trim();
    if (!rawText) return { matched: false, confidence: 0, reason: 'Texto vazio' };

    const lower = rawText.toLowerCase();

    // Se já começa com prefixo tradicional, delega diretamente para a esteira normal
    if (/^(?:!|\/)/.test(lower)) {
      return { matched: false, isExplicitCommand: true, reason: 'Prefixo tradicional presente' };
    }

    const {
      msg = null,
      isGroup = false,
      isAdmin = false,
      isBotAdmin = false,
      isOwner = false,
      isVip = false,
      senderPhone = ''
    } = options;

    const mediaInfo = this.extractMediaInfo(msg);
    const quotedText = mediaInfo.quotedText || '';
    const norm = this.normalizePtBr(rawText);
    const urls = this.extractUrls(rawText, quotedText);

    // =========================================================================
    // 0. ENSINO E TUTORIAL DE COMANDOS (!ajuda <comando> - 99% de Certeza)
    // =========================================================================
    const helpSemanticMatch =
      rawText.match(/^(?:como\s+(?:eu\s+)?(?:uso|usa|usar|utilizo|utiliza|utilizar|funciona)|me\s+ensina\s+a\s+usar|me\s+ensina|me\s+d[aá]\s+(?:um\s+)?exemplo\s+d[oe]|para\s+que\s+serve|o\s+que\s+faz|ajuda\s+n[oe]|tutorial\s+d[oe]|guia\s+d[oe])\s+(?:o\s+|a\s+)?(?:comando\s+)?(?:de\s+)?([!/#]?[a-zA-Z0-9_\-]+)\??$/i) ||
      rawText.match(/^(?:ajuda|help|ensinar|tutorial)\s+([!/#]?[a-zA-Z0-9_\-]+)$/i);

    if (helpSemanticMatch) {
      const targetCmd = helpSemanticMatch[1].replace(/^[!\/#]/, '').trim();
      const commandHelpService = require('./commandHelpService');
      const found = commandHelpService.findCommand(targetCmd);
      if (found) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'COMMAND_HELP',
          command: `!ajuda ${found.command.id}`,
          syntheticText: `!ajuda ${found.command.id}`,
          params: { commandId: found.command.id },
          reason: 'Pedido de tutorial e exemplos de como usar o comando'
        };
      }
    }

    // =========================================================================
    // 1. FIGURINHA PARA IMAGEM / FOTO (!toimg - 99% de Certeza)
    // =========================================================================
    const isStickerToImgSemantic =
      /(?:passa|passar|converte|converter|transforma|transformar|vira|virar|tira|tirar|manda|mandar)\s+.*?(?:pra\s+foto|para\s+foto|em\s+foto|pra\s+imagem|para\s+imagem|em\s+imagem|a\s+foto|a\s+imagem)\b/i.test(norm) ||
      /^(?:vira\s+foto|passa\s+pra\s+foto|passa\s+para\s+foto|converte\s+pra\s+foto|converte\s+para\s+foto|manda\s+em\s+foto|foto\s+disso|desfazer\s+figurinha)$/i.test(norm);

    if (isStickerToImgSemantic) {
      if (mediaInfo.isSticker) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'STICKER_TO_IMG',
          command: '!toimg',
          syntheticText: '!toimg',
          reason: 'Pedido claro de conversão de figurinha em imagem com figurinha detectada'
        };
      } else {
        return {
          matched: false,
          confidence: 0.70,
          type: 'STICKER_TO_IMG',
          reason: 'Falta figurinha citada ou anexada para converter em foto'
        };
      }
    }

    // =========================================================================
    // 2. EXTRAÇÃO DE ÁUDIO / VÍDEO PARA MP3 (!tomp3 - 99% de Certeza)
    // =========================================================================
    const isToMp3Semantic =
      /(?:converte|converter|tira|tirar|extrai|extrair|passa|passar|manda|mandar)\s+.*?(?:pra\s+audio|para\s+audio|em\s+audio|pra\s+mp3|para\s+mp3|em\s+mp3|o\s+audio|o\s+som|so\s+o\s+audio|so\s+o\s+som)\b/i.test(norm) ||
      /^(?:passa\s+pra\s+audio|passa\s+para\s+audio|passa\s+pra\s+mp3|passa\s+para\s+mp3|tira\s+o\s+audio|extrai\s+o\s+audio|so\s+o\s+audio)$/i.test(norm);

    if (isToMp3Semantic) {
      if (mediaInfo.isVideo || mediaInfo.isAudio) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'VIDEO_TO_MP3',
          command: '!tomp3',
          syntheticText: '!tomp3',
          reason: 'Pedido claro de extração de áudio/MP3 com vídeo ou áudio detectado'
        };
      }
    }

    // =========================================================================
    // 3. UPGRADE DE QUALIDADE PARA HD (!h / !hd - 99% de Certeza)
    // =========================================================================
    const isMediaUpgradeSemantic =
      /^(?:h|hd|hq|alta|high)$/i.test(norm) ||
      /(?:manda|mandar|baixa|baixar|quero|em)\s+.*?(?:alta\s+resolucao|alta\s+qualidade|qualidade\s+maxima|em\s+hd|em\s+hq)\b/i.test(norm);

    if (isMediaUpgradeSemantic && mediaInfo.hasMedia) {
      return {
        matched: true,
        confidence: 0.99,
        type: 'MEDIA_UPGRADE',
        command: '!h',
        syntheticText: '!h',
        reason: 'Pedido de upgrade de qualidade HD respondendo à mídia'
      };
    }

    // =========================================================================
    // 4. FIGURINHA DE TEXTO / ANIMADA (!ttp / !attp - 99% de Certeza)
    // =========================================================================
    const textStickerMatch =
      rawText.match(/(?:faz|fazer|cria|criar|gera|gerar)\s+(?:uma\s+)?figurinha\s+(?:animada\s+|colorida\s+)?(?:com\s+o\s+texto|com\s+a\s+frase|escrita?|dizendo)\s*[:"']?\s*(.+?)["']?$/i) ||
      rawText.match(/(?:escreve|escrever)\s*["']?(.+?)["']?\s*(?:em\s+figurinha|no\s+sticker)$/i);

    if (textStickerMatch && !mediaInfo.isImage && !mediaInfo.isVideo) {
      const stickerWord = textStickerMatch[1].trim();
      const isAnimated = /(?:animada|arco\s*iris|colorida|piscando)/i.test(norm);
      if (stickerWord.length >= 1 && stickerWord.length <= 60) {
        return {
          matched: true,
          confidence: 0.99,
          type: isAnimated ? 'ATTP' : 'TEXT_TO_STICKER',
          command: isAnimated ? '!attp' : '!ttp',
          syntheticText: `${isAnimated ? '!attp' : '!ttp'} ${stickerWord}`,
          params: { text: stickerWord, isAnimated },
          reason: 'Pedido inequívoco de criação de figurinha baseada em texto'
        };
      }
    }

    // =========================================================================
    // 5. CRIADOR DE FIGURINHA / STICKER COM FOTO/VÍDEO (!s - 99% de Certeza)
    // =========================================================================
    const isStickerSemantic =
      /(?:faz|fazer|cria|criar|transforma|transformar|vira|virar|converte|converter|gera|gerar|manda|mandar)\s+(?:ai\s+|aqui\s+|para\s+mim\s+|pra\s+mim\s+)?(?:uma\s+|a\s+|o\s+|esse\s+|essa\s+|este\s+|esta\s+)?figurinha\b/i.test(norm) ||
      /^(?:figurinha|sticker)(?:\s+(?:por\s+favor|aqui|disso|dessa|desse|agora))?$/i.test(norm) ||
      /(?:faz|cria|transforma|converte)\s+(?:em|para|como)\s+figurinha\b/i.test(norm) ||
      /(?:quero|preciso\s+de)\s+(?:uma\s+)?figurinha/i.test(norm);

    if (isStickerSemantic) {
      if (mediaInfo.hasMedia) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'STICKER',
          command: '!s',
          syntheticText: '!s',
          reason: 'Pedido claro de figurinha com foto ou vídeo anexado ou citado'
        };
      } else {
        return {
          matched: false,
          confidence: 0.70,
          type: 'STICKER',
          reason: 'Falta mídia anexada ou citada para criação de figurinha'
        };
      }
    }

    // =========================================================================
    // 6. AUDITORIA DE SITE & GOOGLE PAGESPEED (!pagespeed - 99% de Certeza)
    // =========================================================================
    const isAuditSemantic =
      /(?:analisa|audita|auditoria|testa|verifica|checa|mede|roda|faz\s+(?:uma\s+)?(?:auditoria|analise|teste))\s+.*?(?:site|portal|pagina|pagespeed|velocidade|carregamento|desempenho|performance|seo|lighthouse)/i.test(norm) ||
      /(?:pagespeed|auditoria|analise|velocidade|performance|desempenho|seo|lighthouse)\s+(?:de|em|no|na)?\s*(?:site|portal|pagina)?\s*(?:https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i.test(norm) ||
      /(?:esse\s+site\s+esta\s+lento|como\s+esta\s+a\s+velocidade|o\s+site\s+esta\s+rapido|raio\s*x\s+do\s+site)/i.test(norm);

    if (isAuditSemantic) {
      const siteUrl = this.extractSiteUrl(rawText, quotedText);
      if (siteUrl) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'PAGESPEED',
          command: '!pagespeed',
          syntheticText: `!pagespeed ${siteUrl}`,
          params: { url: siteUrl },
          reason: 'Solicitação clara de análise/PageSpeed com URL válida'
        };
      }
    }

    // =========================================================================
    // 7. CONSULTA DE IMEI & CELULAR SEGURO (!imei - 99% de Certeza)
    // =========================================================================
    const isImeiSemantic =
      /(?:consulta|consultar|checa|checar|verifica|verificar|ve|puxa|puxar|avalia|analisa)\s+.*?(?:imei|celular\s+seguro|celular\s+roubado|bloqueio|restricao|anatel|procedencia)/i.test(norm) ||
      /(?:imei|celular\s+seguro)\s+(?:de|deste|desse)?\s*(\d{14,15})/i.test(norm);

    if (isImeiSemantic) {
      const imeiService = require('./imeiService');
      const extractedImei = imeiService.extractImei(rawText, quotedText);

      if (extractedImei) {
        const luhn = imeiService.validateLuhn(extractedImei);
        if (luhn.isValid || luhn.isComplete) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'CONSULTAR_IMEI',
            command: '!imei',
            syntheticText: `!imei ${extractedImei}`,
            params: { imei: extractedImei },
            reason: 'Pedido de consulta de IMEI com número estruturado de 14-15 dígitos'
          };
        }
      }
    }

    // =========================================================================
    // 8. TEXTO PARA VOZ NEURAL (!tts - 99% de Certeza)
    // =========================================================================
    const ttsMatch =
      rawText.match(/^(?:fala|falar|pronuncia|pronunciar|le|ler|manda\s+(?:um\s+)?audio\s+falando)\s*(?:pra\s+mim\s+|para\s+mim\s+)?[:"']?\s*(.+?)["']?$/i);

    if (ttsMatch && !urls.length && !/(?:quanto|custa|valor|preco|vitrine|catalogo|site|bot)/i.test(norm)) {
      let textToSpeak = ttsMatch[1].trim();
      textToSpeak = textToSpeak.replace(/^["']+|["']+$/g, '').trim();
      if (textToSpeak.length >= 2 && textToSpeak.length <= 400) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'TEXT_TO_SPEECH',
          command: '!tts',
          syntheticText: `!tts ${textToSpeak}`,
          params: { text: textToSpeak },
          reason: 'Pedido direto de sintetização de voz com texto explícito'
        };
      }
    }

    // =========================================================================
    // 9. DOWNLOADERS DE MÍDIA E REDES SOCIAIS (99% de Certeza)
    // =========================================================================
    const isDownloadVerb = /(?:baixar|baixa|fazer\s+download|faz\s+(?:o\s+)?download|manda|baixe|puxa|quero\s+baixar|salva|converter|extrai|pega)\b/i.test(norm);

    // 9.1 Baixar Stories de um perfil Instagram (!allstories @perfil)
    const storiesProfileMatch =
      norm.match(/(?:baixar|baixa|pega|salva|puxa)\s+(?:todos\s+os\s+|os\s+)?stories\s+(?:de|do|da|deste|do\s+perfil|da\s+conta)?\s*@?([a-zA-Z0-9_\.\-]+)/i);
    if (storiesProfileMatch) {
      let profile = storiesProfileMatch[1].replace(/^@/, '');
      if (profile === 'perfil' || profile === 'conta') {
        const nextPart = norm.match(/(?:perfil|conta)\s+@?([a-zA-Z0-9_\.\-]+)/i);
        if (nextPart) profile = nextPart[1].replace(/^@/, '');
      }
      return {
        matched: true,
        confidence: 0.99,
        type: 'DOWNLOAD_STORIES',
        command: '!allstories',
        syntheticText: `!allstories @${profile}`,
        params: { username: profile },
        reason: 'Pedido explícito de download de stories com @perfil informado'
      };
    }

    // 9.2 Stalk / Investigação de Perfil de Instagram (!scrapinsta @perfil)
    const stalkProfileMatch =
      norm.match(/(?:stalkea|stalkear|puxa\s+o\s+perfil|raio\s*x\s+do\s+insta|audita\s+o\s+insta)\s+(?:do|da|de|o\s+perfil|a\s+conta)?\s*@?([a-zA-Z0-9_\.\-]+)/i);
    if (stalkProfileMatch) {
      let profile = stalkProfileMatch[1].replace(/^@/, '');
      if (profile === 'perfil' || profile === 'conta') {
        const nextPart = norm.match(/(?:perfil|conta)\s+@?([a-zA-Z0-9_\.\-]+)/i);
        if (nextPart) profile = nextPart[1].replace(/^@/, '');
      }
      return {
        matched: true,
        confidence: 0.99,
        type: 'STALK_INSTAGRAM',
        command: '!scrapinsta',
        syntheticText: `!scrapinsta @${profile}`,
        params: { username: profile },
        reason: 'Pedido de raio-x de perfil de Instagram'
      };
    }

    // 9.3 Instagram (Reels, Post, Vídeo)
    const instagramUrl = urls.find(u => /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|stories|share)\/[a-zA-Z0-9_\-]+/i.test(u));
    if (instagramUrl) {
      const hasInstaIntent = isDownloadVerb || /(?:reels?|insta|instagram|post|video)/i.test(norm) || !isGroup;
      if (hasInstaIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_INSTAGRAM',
          command: '!ig',
          syntheticText: `!ig ${instagramUrl}`,
          params: { url: instagramUrl },
          reason: 'Link do Instagram fornecido com intenção inequívoca de download'
        };
      }
    }

    // 9.4 TikTok
    const tiktokUrl = urls.find(u => /(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/[a-zA-Z0-9_\-\/]+/i.test(u));
    if (tiktokUrl) {
      const hasTikTokIntent = isDownloadVerb || /(?:tiktok|tt|video)/i.test(norm) || !isGroup;
      if (hasTikTokIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_TIKTOK',
          command: '!tiktok',
          syntheticText: `!tiktok ${tiktokUrl}`,
          params: { url: tiktokUrl },
          reason: 'Link do TikTok fornecido com intenção inequívoca de download'
        };
      }
    }

    // 9.5 Facebook
    const facebookUrl = urls.find(u => /(?:facebook\.com|fb\.watch)\/[a-zA-Z0-9_\-\.\/]+/i.test(u));
    if (facebookUrl) {
      const hasFbIntent = isDownloadVerb || /(?:facebook|fb|face|video)/i.test(norm) || !isGroup;
      if (hasFbIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_FACEBOOK',
          command: '!fb',
          syntheticText: `!fb ${facebookUrl}`,
          params: { url: facebookUrl },
          reason: 'Link do Facebook fornecido com intenção inequívoca de download'
        };
      }
    }

    // 9.6 Twitter / X
    const twitterUrl = urls.find(u => /(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/[0-9]+/i.test(u));
    if (twitterUrl) {
      const hasTwIntent = isDownloadVerb || /(?:twitter|tweet|x\.com|video)/i.test(norm) || !isGroup;
      if (hasTwIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_TWITTER',
          command: '!twitter',
          syntheticText: `!twitter ${twitterUrl}`,
          params: { url: twitterUrl },
          reason: 'Link do Twitter/X fornecido com intenção inequívoca de download'
        };
      }
    }

    // 9.7 YouTube (Vídeo, Música ou Documento)
    const youtubeUrl = urls.find(u => /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)[a-zA-Z0-9_\-]+/i.test(u));
    if (youtubeUrl) {
      // Documento HQ
      const isDocIntent = /(?:documento|doc|arquivo|como\s+doc|em\s+doc|formato\s+doc)/i.test(norm);
      if (isDocIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_DOC',
          command: '!playdoc',
          syntheticText: `!playdoc ${youtubeUrl}`,
          params: { url: youtubeUrl },
          reason: 'Link do YouTube com pedido de envio em formato documento'
        };
      }

      // Áudio / Música pura
      const isAudioOnlyIntent = /(?:audio|musica|mp3|som|cancao|extrai\s+audio|so\s+o\s+audio)/i.test(norm);
      if (isAudioOnlyIntent) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_AUDIO',
          command: '!play',
          syntheticText: `!play ${youtubeUrl}`,
          params: { url: youtubeUrl },
          reason: 'Link do YouTube com intenção explícita de baixar apenas o áudio/mp3'
        };
      }

      // Pedido padrão de vídeo
      return {
        matched: true,
        confidence: 0.99,
        type: 'DOWNLOAD_VIDEO',
        command: '!video',
        syntheticText: `!video ${youtubeUrl}`,
        params: { url: youtubeUrl },
        reason: 'Link do YouTube com intenção explícita de download de vídeo'
      };
    }

    // 9.8 Pesquisa de Músicas com Lista de Resultados (!lista)
    const musicListMatch =
      rawText.match(/(?:pesquisa|pesquisar|busca|buscar|procura|procurar|mostra|mostrar)\s+(?:uma\s+lista\s+de\s+m[uú]sicas?|m[uú]sicas?|faixas?)\s+(?:de|do|da|dos|deste)?\s*(.+)$/i);
    if (musicListMatch && !urls.length) {
      const artistOrTerm = musicListMatch[1].trim();
      if (artistOrTerm.length >= 2 && !/(?:quanto|custa|valor|preco|vitrine|catalogo|bot)/i.test(artistOrTerm)) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'MUSIC_LIST',
          command: '!lista',
          syntheticText: `!lista ${artistOrTerm}`,
          params: { query: artistOrTerm },
          reason: 'Pedido de lista de resultados musicais do YouTube'
        };
      }
    }

    // 9.9 Downloader de Música por Nome (sem URL direta)
    const isPlayMusicByName =
      /^(?:toca|toque|reproduz|baixa|baixar|manda|coloca)\s+(?:a\s+m[uú]sica|o\s+som|a\s+faixa|o\s+mp3)\s+(.+)$/i.test(rawText) ||
      /^(?:quero\s+ouvir|baixa\s+pra\s+mim|baixa\s+para\s+mim)\s+(?:a\s+m[uú]sica|o\s+som)?\s*(.+)$/i.test(rawText);

    if (isPlayMusicByName && !urls.length) {
      const songQuery = rawText.replace(/^(?:toca|toque|reproduz|baixa|baixar|manda|coloca|quero\s+ouvir|baixa\s+pra\s+mim|baixa\s+para\s+mim)\s+(?:a\s+m[uú]sica|o\s+som|a\s+faixa|o\s+mp3)?\s*/i, '').trim();
      if (songQuery.length >= 3 && !/(?:quanto|custa|valor|preco|pre[cç]o|site|bot|vitrine|cat[aá]logo)/i.test(songQuery)) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'DOWNLOAD_AUDIO',
          command: '!play',
          syntheticText: `!play ${songQuery}`,
          params: { query: songQuery },
          reason: 'Pedido claro de busca e reprodução de música por nome'
        };
      }
    }

    // 9.10 Downloader Universal para Outras URLs
    if (urls.length > 0 && isDownloadVerb) {
      const genericUrl = urls[0];
      return {
        matched: true,
        confidence: 0.99,
        type: 'DOWNLOAD_UNIVERSAL',
        command: '!download',
        syntheticText: `!download ${genericUrl}`,
        params: { url: genericUrl },
        reason: 'Pedido direto de download com URL anexada'
      };
    }

    // =========================================================================
    // 10. RASTREAMENTO E STATUS DE PEDIDOS (!pedido / 0 - 99% de Certeza)
    // =========================================================================
    const isOrderTrackingSemantic =
      /(?:cade|onde\s+esta|rastreia|rastrear|status|situacao|codigo\s+de\s+entrega)\s+.*?(?:meu\s+pedido|minha\s+compra|pedido|entrega)\b/i.test(norm) ||
      /^(?:meus\s+pedidos|meu\s+pedido|rastrear\s+pedido|rastreio|consultar\s+pedido)$/i.test(norm);

    if (isOrderTrackingSemantic) {
      const orderCodeMatch = rawText.match(/\b(ORD_[A-Za-z0-9_]+)\b/i);
      const code = orderCodeMatch ? orderCodeMatch[1].toUpperCase() : '';
      return {
        matched: true,
        confidence: 0.99,
        type: 'ORDER_TRACKING',
        command: '!pedido',
        syntheticText: code ? `!pedido ${code}` : '!pedido',
        params: { orderCode: code },
        reason: 'Consulta de status e rastreamento de compras'
      };
    }

    // =========================================================================
    // 11. MODERAÇÃO E GESTÃO EM GRUPOS (Admin Only - 99% de Certeza)
    // =========================================================================
    if (isGroup) {
      const hasAdminPrivilege = isAdmin || isOwner;

      // 11.1 Apagar Mensagem Citada (!d / !delete)
      const isDeleteSemantic =
        /(?:apagar|apaga|remover|remove|limpar|limpa|some\s+com|tira)\s+(?:essa\s+|esta\s+)?(?:mensagem|msg|isso|aqui|comentario)\b/i.test(norm) ||
        /^(?:apagar|apaga|deletar|deleta|remover|remove)\s*(?:isso|aqui)?$/i.test(norm);

      if (isDeleteSemantic) {
        if (!hasAdminPrivilege && !isVip) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_DELETE',
            unauthorized: true,
            reason: 'Usuário sem permissão de Administrador/VIP para apagar mensagens'
          };
        }
        if (mediaInfo.stanzaId) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'GROUP_DELETE',
            command: '!d',
            syntheticText: '!d',
            params: {
              stanzaId: mediaInfo.stanzaId,
              participant: mediaInfo.quotedParticipant
            },
            reason: 'Ordem de apagar mensagem citada por administrador'
          };
        } else {
          return {
            matched: false,
            confidence: 0.70,
            type: 'GROUP_DELETE',
            reason: 'Nenhuma mensagem citada para exclusão'
          };
        }
      }

      // 11.2 Banir / Expulsar Membro (!ban)
      const isBanSemantic =
        /(?:banir|bane|remover|remove|expulsar|expulsa)\s+(?:esse\s+|este\s+)?(?:cara|participante|usuario|sujeito|ele|ela|membro)?\b/i.test(norm);

      if (isBanSemantic) {
        if (!hasAdminPrivilege) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_BAN',
            unauthorized: true,
            reason: 'Apenas administradores podem solicitar expulsão de membros'
          };
        }

        const targetUser = mediaInfo.mentionedJids[0] ||
          (rawText.match(/@(\d+)/)?.[1] ? `${rawText.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
          mediaInfo.quotedParticipant;

        if (targetUser) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'GROUP_BAN',
            command: '!ban',
            syntheticText: `!ban @${targetUser.replace(/@.*$/, '')}`,
            params: { targetUser },
            reason: 'Ordem explícita de expulsão de participante com alvo identificado'
          };
        } else {
          return {
            matched: false,
            confidence: 0.70,
            type: 'GROUP_BAN',
            reason: 'Alvo para expulsão não foi citado nem mencionado com @'
          };
        }
      }

      // 11.3 Desmutar Usuário Específico (!desmute @user)
      const isUnmuteUserSemantic =
        norm.match(/(?:desmutar|desmuta|liberar|libera)\s+(?:o\s+)?(?:cara|participante|ele|esse\s+cara)?\s*@?(\d{8,15})?/i) ||
        ((/\b(desmutar|desmuta)\b/i.test(norm)) && (mediaInfo.mentionedJids.length > 0 || mediaInfo.quotedParticipant));

      if (isUnmuteUserSemantic && !norm.includes('grupo') && !norm.includes('chat')) {
        if (!hasAdminPrivilege) {
          return { matched: false, confidence: 0.99, type: 'GROUP_UNMUTE_USER', unauthorized: true, reason: 'Sem permissão de admin' };
        }
        const targetUser = mediaInfo.mentionedJids[0] ||
          (rawText.match(/@(\d+)/)?.[1] ? `${rawText.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
          mediaInfo.quotedParticipant;

        if (targetUser) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'GROUP_UNMUTE_USER',
            command: '!desmute',
            syntheticText: `!desmute @${targetUser.replace(/@.*$/, '')}`,
            params: { targetUser },
            reason: 'Remoção de silenciamento de usuário por administrador'
          };
        }
      }

      // 11.4 Mutar Usuário Específico (!mute @user)
      const isMuteUserSemantic =
        !norm.includes('desmuta') &&
        (norm.match(/(?:mutar|\bmuta\b|calar\s+a\s+boca)\s+(?:de|do|deste|desse|esse\s+cara|o\s+cara)?\s*@?(\d{8,15})?/i) ||
        ((/\b(mutar|muta)\b/i.test(norm)) && (mediaInfo.mentionedJids.length > 0 || mediaInfo.quotedParticipant)));

      if (isMuteUserSemantic && !norm.includes('grupo') && !norm.includes('chat')) {
        if (!hasAdminPrivilege) {
          return { matched: false, confidence: 0.99, type: 'GROUP_MUTE_USER', unauthorized: true, reason: 'Sem permissão de admin' };
        }
        const targetUser = mediaInfo.mentionedJids[0] ||
          (rawText.match(/@(\d+)/)?.[1] ? `${rawText.match(/@(\d+)/)[1]}@s.whatsapp.net` : null) ||
          mediaInfo.quotedParticipant;

        if (targetUser) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'GROUP_MUTE_USER',
            command: '!mute',
            syntheticText: `!mute @${targetUser.replace(/@.*$/, '')}`,
            params: { targetUser },
            reason: 'Silenciamento de usuário específico por administrador'
          };
        }
      }

      // 11.5 Fechar / Trancar Grupo (!fechar)
      const isLockSemantic =
        /(?:fechar|fecha|trancar|tranca|travar|trava|mutar|muta)\s+(?:o\s+)?(?:grupo|chat|conversa|mensagens)\b/i.test(norm) ||
        /^(?:fechar\s+o\s+grupo|trancar\s+o\s+grupo|travar\s+o\s+grupo|fecha\s+o\s+grupo|tranca\s+o\s+grupo|trava\s+o\s+grupo)$/i.test(norm);

      if (isLockSemantic) {
        if (!hasAdminPrivilege) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_LOCK',
            unauthorized: true,
            reason: 'Apenas administradores podem fechar o grupo'
          };
        }
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_LOCK',
          command: '!fechar',
          syntheticText: '!fechar',
          reason: 'Ordem explícita de fechamento do grupo por administrador'
        };
      }

      // 11.6 Abrir / Destrancar Grupo (!abrir)
      const isUnlockSemantic =
        /(?:abrir|abre|destrancar|destranca|destravar|destrava|desmutar|desmuta|liberar|libera)\s+(?:o\s+)?(?:grupo|chat|conversa|mensagens)\b/i.test(norm) ||
        /^(?:abrir\s+o\s+grupo|destrancar\s+o\s+grupo|destravar\s+o\s+grupo|liberar\s+o\s+grupo|abre\s+o\s+grupo|destranca\s+o\s+grupo|libera\s+o\s+grupo)$/i.test(norm);

      if (isUnlockSemantic) {
        if (!hasAdminPrivilege) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_UNLOCK',
            unauthorized: true,
            reason: 'Apenas administradores podem abrir o grupo'
          };
        }
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_UNLOCK',
          command: '!abrir',
          syntheticText: '!abrir',
          reason: 'Ordem explícita de abertura do grupo por administrador'
        };
      }

      // 11.7 Marcar Todos os Membros (!marcar - poupando admins)
      const isTagAllSemantic =
        /(?:marcar|marca|chamar|chama|avisar|avisa|notificar|notifica|acordar|acorda)\s+(?:todo\s+mundo(?:\s+do\s+grupo)?|geral(?:\s+do\s+grupo)?|todos(?:\s+os\s+membros)?|a\s+galera(?:\s+do\s+grupo)?|a\s+rapaziada(?:\s+do\s+grupo)?|o\s+grupo)\b/i.test(norm) ||
        /^(?:marcar|marca|chamar|chama)\s+(?:geral|todos)\b/i.test(norm);

      if (isTagAllSemantic) {
        if (!hasAdminPrivilege) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_TAGALL',
            unauthorized: true,
            reason: 'Apenas administradores podem marcar todos os membros'
          };
        }
        const aviso = rawText.replace(/(?:marca|marcar|chama|chamar|avisa|avisar|notifica|notificar|acorda|acordar)\s+(?:todo\s+mundo(?:\s+do\s+grupo)?|geral(?:\s+do\s+grupo)?|todos(?:\s+os\s+membros)?|a\s+galera(?:\s+do\s+grupo)?|a\s+rapaziada(?:\s+do\s+grupo)?|o\s+grupo)\s*/i, '').trim();
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_TAGALL',
          command: '!marcar',
          syntheticText: aviso ? `!marcar ${aviso}` : '!marcar',
          params: { aviso },
          reason: 'Ordem explícita de chamada geral dos membros por administrador'
        };
      }

      // 11.8 X9 / Dedo-Duro do Grupo (!x9)
      const isX9Semantic =
        /(?:quem\s+saiu(?:\s+do\s+grupo)?|alguem\s+saiu|alguem\s+vazou|quem\s+vazou|quem\s+apagou(?:\s+mensagem)?|relatorio\s+(?:de\s+)?x9|dedo\s*duro|mostra\s+o\s+x9)\b/i.test(norm);

      if (isX9Semantic) {
        if (!hasAdminPrivilege) {
          return {
            matched: false,
            confidence: 0.99,
            type: 'GROUP_X9',
            unauthorized: true,
            reason: 'Apenas administradores podem acessar o relatório do X9'
          };
        }
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_X9',
          command: '!x9',
          syntheticText: '!x9 logs',
          reason: 'Consulta de auditoria X9 por administrador'
        };
      }

      // 11.9 Mudar Nome do Grupo (!setname <novo nome>)
      const setNameMatch = rawText.match(/(?:muda|mudar|troca|trocar|altera|alterar|seta|setar)\s+(?:o\s+)?nome\s+do\s+grupo\s+(?:para|pra)\s+(.+)$/i);
      if (setNameMatch) {
        if (!hasAdminPrivilege) return { matched: false, confidence: 0.99, type: 'GROUP_SET_NAME', unauthorized: true, reason: 'Sem permissão de admin' };
        const newName = setNameMatch[1].trim();
        if (newName.length >= 2) {
          return {
            matched: true,
            confidence: 0.99,
            type: 'GROUP_SET_NAME',
            command: '!setname',
            syntheticText: `!setname ${newName}`,
            params: { newName },
            reason: 'Ordem de alteração do nome do grupo por administrador'
          };
        }
      }

      // 11.10 Mudar Descrição do Grupo (!setdesc <nova desc>)
      const setDescMatch = rawText.match(/(?:muda|mudar|troca|trocar|altera|alterar|seta|setar)\s+(?:a\s+)?descri[cç][aã]o\s+do\s+grupo\s+(?:para|pra)\s+(.+)$/i);
      if (setDescMatch) {
        if (!hasAdminPrivilege) return { matched: false, confidence: 0.99, type: 'GROUP_SET_DESC', unauthorized: true, reason: 'Sem permissão de admin' };
        const newDesc = setDescMatch[1].trim();
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_SET_DESC',
          command: '!setdesc',
          syntheticText: `!setdesc ${newDesc}`,
          params: { newDesc },
          reason: 'Ordem de alteração da descrição do grupo por administrador'
        };
      }

      // 11.11 Link do Grupo (!linkgp)
      const isLinkGpSemantic =
        /(?:manda|mandar|passa|passar|qual\s+e)\s+(?:o\s+)?link\s+(?:de\s+convite\s+)?do\s+grupo\b/i.test(norm) ||
        /^(?:link\s+do\s+grupo|link\s+grupo)$/i.test(norm);

      if (isLinkGpSemantic) {
        if (!hasAdminPrivilege) return { matched: false, confidence: 0.99, type: 'GROUP_LINK', unauthorized: true, reason: 'Sem permissão de admin' };
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_LINK',
          command: '!linkgp',
          syntheticText: '!linkgp',
          reason: 'Solicitação do link de convite do grupo'
        };
      }

      // 11.12 Sorteio no Grupo (!sorteio)
      const isRaffleSemantic =
        /(?:sorteia|sortear|faz\s+(?:um\s+)?sorteio)\s+.*?(?:membro|participante|grupo|alguem)\b/i.test(norm);

      if (isRaffleSemantic) {
        if (!hasAdminPrivilege) return { matched: false, confidence: 0.99, type: 'GROUP_RAFFLE', unauthorized: true, reason: 'Sem permissão de admin' };
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_RAFFLE',
          command: '!sorteio',
          syntheticText: '!sorteio 1 Prêmio Surpresa | 1',
          reason: 'Ordem de realização de sorteio entre membros comuns'
        };
      }

      // 11.13 Regras do Grupo (!regras)
      const isRulesSemantic =
        /(?:quais\s+sao\s+as\s+regras|manda\s+as\s+regras|mostra\s+as\s+regras)\s+(?:do\s+grupo)?\b/i.test(norm) ||
        /^(?:regras|regras\s+do\s+grupo)$/i.test(norm);

      if (isRulesSemantic) {
        return {
          matched: true,
          confidence: 0.99,
          type: 'GROUP_RULES',
          command: '!regras',
          syntheticText: '!regras',
          reason: 'Consulta de regras do grupo'
        };
      }
    }

    // =========================================================================
    // 12. CATÁLOGO, PRODUTOS, VITRINE E VENDAS (99% de Certeza)
    // =========================================================================
    const isCatalogSemantic =
      /(?:manda|mandar|mostra|mostrar|ver|quero\s+ver|envia|enviar|passa|passar)\s+(?:o\s+|a\s+)?(?:catalogo|vitrine|loja|produtos|planos|precos|tabela\s+de\s+precos)\b/i.test(norm) ||
      /^(?:catalogo|vitrine|ver\s+produtos|tabela\s+de\s+precos|planos\s+disponiveis)$/i.test(norm) ||
      /(?:quais\s+sao\s+os\s+produtos|o\s+que\s+voce\s+vende|quais\s+planos\s+disponiveis)\b/i.test(norm);

    if (isCatalogSemantic) {
      return {
        matched: true,
        confidence: 0.99,
        type: 'CATALOG',
        command: '!catalogo',
        syntheticText: '!catalogo',
        reason: 'Solicitação direta de catálogo/vitrine de produtos'
      };
    }

    // Nenhuma intenção com 99% de certeza encontrada
    return {
      matched: false,
      confidence: 0.10,
      reason: 'Nenhuma intenção de comando identificada com >= 99% de certeza'
    };
  }

  /**
   * Despacha e executa o comando reconhecido diretamente na instância do bot
   */
  async executeCommand(resolution, context) {
    if (!resolution || !resolution.matched || resolution.confidence < this.CERTAINTY_THRESHOLD) {
      return false;
    }

    const {
      botInstance,
      activeSock,
      from,
      msg,
      senderName,
      senderPhone,
      isGroup,
      isAdmin,
      isBotAdmin,
      isOwnerUser,
      isVipUser,
      quotedMsgText = ''
    } = context;

    const spyFeatures = require('./spyFeaturesService');
    const models = require('../db/models');

    console.log(`[Natural Command ⚡ 99%] Tipo: ${resolution.type} | Chat: ${from} | Cmd: ${resolution.syntheticText}`);

    switch (resolution.type) {
      // 0. Ensino e Tutorial do Comando (!ajuda <comando>)
      case 'COMMAND_HELP': {
        const commandHelpService = require('./commandHelpService');
        await commandHelpService.handleHelpCommand(activeSock, from, resolution.params?.commandId);
        return true;
      }

      // 1. Figurinha padrão com foto/vídeo
      case 'STICKER': {
        await spyFeatures.handleSticker(activeSock, from, msg, senderName);
        return true;
      }

      // 2. Figurinha para Imagem / Foto (!toimg)
      case 'STICKER_TO_IMG': {
        await spyFeatures.handleToImg(activeSock, from, msg);
        return true;
      }

      // 3. Extrair Áudio / Converter para MP3 (!tomp3)
      case 'VIDEO_TO_MP3': {
        await spyFeatures.handleToMp3(activeSock, from, msg);
        return true;
      }

      // 4. Upgrade de Mídia em Alta Resolução (!h)
      case 'MEDIA_UPGRADE': {
        await spyFeatures.handleMediaUpgrade(activeSock, from, msg, 'h');
        return true;
      }

      // 5. Figurinha de Texto (!ttp)
      case 'TEXT_TO_STICKER': {
        await spyFeatures.handleTextToSticker(activeSock, from, resolution.syntheticText, senderName);
        return true;
      }

      // 6. Figurinha Animada / Colorida (!attp)
      case 'ATTP': {
        await spyFeatures.handleAttp(activeSock, from, resolution.syntheticText, true);
        return true;
      }

      // 7. Texto para Voz Neural (!tts)
      case 'TEXT_TO_SPEECH': {
        await spyFeatures.handleTTS(activeSock, from, resolution.syntheticText, 'pt', quotedMsgText);
        return true;
      }

      // 8. Auditoria de Sites & PageSpeed (!pagespeed)
      case 'PAGESPEED': {
        const websiteAuditService = require('./websiteAuditService');
        await websiteAuditService.handleAuditCommand(activeSock, from, resolution.syntheticText, senderPhone);
        return true;
      }

      // 9. Consulta de IMEI & Celular Seguro (!imei)
      case 'CONSULTAR_IMEI': {
        const imeiService = require('./imeiService');
        if (msg?.key) await botInstance.safeReact(activeSock, from, msg.key, '🔍');
        const imeiResult = await imeiService.consultarCelularSeguro(resolution.params.imei, { usedPrefix: '!' });
        await botInstance.sendMessage(from, imeiResult.formattedMessage, { quoted: msg }, activeSock);
        return true;
      }

      // 10. Downloader de Stories Instagram (!allstories)
      case 'DOWNLOAD_STORIES': {
        await spyFeatures.handleAllStories(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 11. Stalk / Raio-X Instagram (!scrapinsta)
      case 'STALK_INSTAGRAM': {
        await spyFeatures.handleScrapInsta(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 12. Downloader Instagram (!ig)
      case 'DOWNLOAD_INSTAGRAM': {
        await spyFeatures.handleInstagram(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 13. Downloader TikTok (!tiktok)
      case 'DOWNLOAD_TIKTOK': {
        await spyFeatures.handleTikTok(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 14. Downloader Facebook (!fb)
      case 'DOWNLOAD_FACEBOOK': {
        await spyFeatures.handleFacebook(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 15. Downloader Twitter / X (!twitter)
      case 'DOWNLOAD_TWITTER': {
        await spyFeatures.handleTwitter(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 16. Downloader Documento YouTube (!playdoc)
      case 'DOWNLOAD_DOC': {
        await spyFeatures.handlePlayDoc(activeSock, from, resolution.syntheticText, quotedMsgText, senderPhone);
        return true;
      }

      // 17. Downloader Áudio YouTube (!play)
      case 'DOWNLOAD_AUDIO': {
        await spyFeatures.handlePlayMusic(activeSock, from, resolution.syntheticText, quotedMsgText, senderPhone);
        return true;
      }

      // 18. Downloader Vídeo YouTube (!video)
      case 'DOWNLOAD_VIDEO': {
        await spyFeatures.handlePlayVideo(activeSock, from, resolution.syntheticText, quotedMsgText, senderPhone);
        return true;
      }

      // 19. Pesquisa de Música com Lista (!lista)
      case 'MUSIC_LIST': {
        await spyFeatures.handleLista(activeSock, from, resolution.syntheticText, senderPhone);
        return true;
      }

      // 20. Downloader Universal (!download)
      case 'DOWNLOAD_UNIVERSAL': {
        await spyFeatures.handleUniversalDownload(activeSock, from, resolution.syntheticText);
        return true;
      }

      // 21. Acompanhamento de Pedidos (!pedido)
      case 'ORDER_TRACKING': {
        await spyFeatures.handleOrderTracking(activeSock, from, resolution.syntheticText, senderPhone, senderName);
        return true;
      }

      // 22. Moderação: Apagar Mensagem Citada (!d)
      case 'GROUP_DELETE': {
        const stanzaId = resolution.params?.stanzaId;
        const participant = resolution.params?.participant;
        if (!stanzaId) return false;

        const isQuotedFromBot = botInstance.isBotSentMessage({
          stanzaId,
          quotedParticipant: participant,
          activeSock,
          from,
          isGroup,
          senderPhone
        });

        const deleteSock = isQuotedFromBot
          ? botInstance.getSocketForRevoke({ stanzaId, quotedParticipant: participant, activeSock })
          : activeSock;

        const quotedKey = {
          remoteJid: from,
          fromMe: isQuotedFromBot,
          id: stanzaId,
          participant: isQuotedFromBot ? undefined : participant
        };

        if (msg?.key && isBotAdmin && isGroup) {
          try { await activeSock.sendMessage(from, { delete: msg.key }); } catch (_) {}
        }

        await spyFeatures.handleDeleteMessage(deleteSock, from, quotedKey, isAdmin || isOwnerUser, isBotAdmin, isVipUser);
        return true;
      }

      // 23. Moderação: Banir Participante (!ban)
      case 'GROUP_BAN': {
        const targetUser = resolution.params?.targetUser;
        if (!targetUser) return false;
        await spyFeatures.handleKick(activeSock, from, targetUser, isAdmin || isOwnerUser, isBotAdmin);
        return true;
      }

      // 24. Moderação: Mutar Participante (!mute)
      case 'GROUP_MUTE_USER': {
        const targetUser = resolution.params?.targetUser;
        if (!targetUser) return false;
        await spyFeatures.handleMuteUser(activeSock, from, targetUser, isAdmin || isOwnerUser);
        return true;
      }

      // 25. Moderação: Desmutar Participante (!desmute)
      case 'GROUP_UNMUTE_USER': {
        const targetUser = resolution.params?.targetUser;
        if (!targetUser) return false;
        await spyFeatures.handleUnmuteUser(activeSock, from, targetUser, isAdmin || isOwnerUser);
        return true;
      }

      // 26. Moderação: Trancar Grupo (!fechar)
      case 'GROUP_LOCK': {
        if (!isBotAdmin) {
          await botInstance.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar configurações!*', {}, activeSock);
          return true;
        }
        const dispatchSock = (activeSock && typeof activeSock.groupSettingUpdate === 'function')
          ? activeSock
          : (botInstance.sock && typeof botInstance.sock.groupSettingUpdate === 'function' ? botInstance.sock : null);

        if (!dispatchSock) {
          await botInstance.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.', {}, activeSock);
          return true;
        }

        try {
          await dispatchSock.groupSettingUpdate(from, 'announcement');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'LOCK',
            details: 'Grupo trancado via ordem em linguagem natural'
          });
          await botInstance.sendMessage(from, '🔒 *GRUPO FECHADO!*\n\nAgora apenas administradores podem enviar mensagens no grupo.', {}, activeSock);
        } catch (err) {
          await botInstance.sendMessage(from, `❌ Erro ao fechar grupo: ${err.message}`, {}, activeSock);
        }
        return true;
      }

      // 27. Moderação: Abrir Grupo (!abrir)
      case 'GROUP_UNLOCK': {
        if (!isBotAdmin) {
          await botInstance.sendMessage(from, '⚠️ *O bot precisa ser Administrador deste grupo para alterar configurações!*', {}, activeSock);
          return true;
        }
        const dispatchSock = (activeSock && typeof activeSock.groupSettingUpdate === 'function')
          ? activeSock
          : (botInstance.sock && typeof botInstance.sock.groupSettingUpdate === 'function' ? botInstance.sock : null);

        if (!dispatchSock) {
          await botInstance.sendMessage(from, '❌ Conexão com o WhatsApp indisponível no momento.', {}, activeSock);
          return true;
        }

        try {
          await dispatchSock.groupSettingUpdate(from, 'not_announcement');
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: from,
            adminId: senderPhone,
            adminName: senderName,
            action: 'UNLOCK',
            details: 'Grupo reaberto via ordem em linguagem natural'
          });
          await botInstance.sendMessage(from, '🔓 *GRUPO ABERTO!*\n\nTodos os membros do grupo agora podem enviar mensagens livremente!', {}, activeSock);
        } catch (err) {
          await botInstance.sendMessage(from, `❌ Erro ao abrir grupo: ${err.message}`, {}, activeSock);
        }
        return true;
      }

      // 28. Moderação: Marcar Membros Comuns Poupando Administradores (!marcar)
      case 'GROUP_TAGALL': {
        const adminStatus = await botInstance.getGroupAdminStatus(from, msg?.key?.participant || from, false);
        await spyFeatures.handleMarcar(activeSock, from, resolution.syntheticText, adminStatus.metadata, isAdmin || isOwnerUser);
        return true;
      }

      // 29. Moderação: Relatório X9 / Dedo-Duro (!x9)
      case 'GROUP_X9': {
        await spyFeatures.handleX9(activeSock, from, resolution.syntheticText, isAdmin || isOwnerUser);
        return true;
      }

      // 30. Moderação: Mudar Nome do Grupo (!setname)
      case 'GROUP_SET_NAME': {
        const newName = resolution.params?.newName;
        await spyFeatures.handleSetName(activeSock, from, newName, isAdmin || isOwnerUser, isBotAdmin);
        return true;
      }

      // 31. Moderação: Mudar Descrição do Grupo (!setdesc)
      case 'GROUP_SET_DESC': {
        const newDesc = resolution.params?.newDesc;
        await spyFeatures.handleSetDesc(activeSock, from, newDesc, isAdmin || isOwnerUser, isBotAdmin);
        return true;
      }

      // 32. Moderação: Link de Convite do Grupo (!linkgp)
      case 'GROUP_LINK': {
        await spyFeatures.handleLinkGp(activeSock, from, isAdmin || isOwnerUser, isBotAdmin);
        return true;
      }

      // 33. Moderação: Sorteio no Grupo (!sorteio)
      case 'GROUP_RAFFLE': {
        const adminStatus = await botInstance.getGroupAdminStatus(from, msg?.key?.participant || from, false);
        await spyFeatures.handleSorteio(activeSock, from, resolution.syntheticText, adminStatus.metadata, isAdmin || isOwnerUser);
        return true;
      }

      // 34. Informações do Grupo: Regras (!regras)
      case 'GROUP_RULES': {
        await spyFeatures.handleRegras(activeSock, from);
        return true;
      }

      // 35. Catálogo & Vitrine E-Commerce (!catalogo)
      case 'CATALOG': {
        await spyFeatures.handleLoja(activeSock, from, senderPhone, senderName);
        return true;
      }

      default:
        return false;
    }
  }
}

module.exports = new NaturalLanguageCommandService();

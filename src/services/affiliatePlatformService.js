const models = require('../db/models');
let achadinhosService = null;
try {
  achadinhosService = require('./achadinhosService');
} catch (_) {}

/**
 * Serviço de Gerenciamento de Contas e Auto-Afiliação Multi-Plataforma
 * Plataformas suportadas: Mercado Livre, Shopee, Braip, Shein, Hotmart, Kiwify, Monetizze, Cakto
 */
class AffiliatePlatformService {
  constructor() {
    this.platformDefinitions = {
      mercadolivre: {
        id: 'mercadolivre',
        name: 'Mercado Livre',
        icon: 'fa-solid fa-handshake',
        color: '#ffe600',
        textColor: '#000',
        defaultCommission: 12.0,
        idLabel: 'ID de Afiliado (Parceiro ML)',
        tagLabel: 'Tag de Rastreamento / Matt Tool',
        helpText: 'Insira seu ID de parceiro do Mercado Livre Afiliados ou sua tag oficial de rastreamento.'
      },
      shopee: {
        id: 'shopee',
        name: 'Shopee',
        icon: 'fa-solid fa-bag-shopping',
        color: '#ee4d2d',
        textColor: '#fff',
        defaultCommission: 8.0,
        idLabel: 'App ID / Affiliate ID',
        tagLabel: 'Sub_ID / Link Tag / Shope.ee Tag',
        helpText: 'Insira suas credenciais do Programa de Afiliados da Shopee para gerar links com comissão garantida.'
      },
      braip: {
        id: 'braip',
        name: 'Braip',
        icon: 'fa-solid fa-bolt',
        color: '#9333ea',
        textColor: '#fff',
        defaultCommission: 50.0,
        idLabel: 'Código de Afiliado (af=...)',
        tagLabel: 'Chave de Rastreamento / Token API',
        helpText: 'Insira o seu código de afiliado Braip ou o token de integração.'
      },
      shein: {
        id: 'shein',
        name: 'Shein',
        icon: 'fa-solid fa-shirt',
        color: '#ffffff',
        textColor: '#000',
        defaultCommission: 15.0,
        idLabel: 'Publisher ID / ID Shein Afiliados',
        tagLabel: 'Referral Code / Tag de Campanha',
        helpText: 'Insira seu Publisher ID do Shein Affiliate Program ou seu código de indicação.'
      },
      hotmart: {
        id: 'hotmart',
        name: 'Hotmart',
        icon: 'fa-solid fa-fire',
        color: '#f04e23',
        textColor: '#fff',
        defaultCommission: 60.0,
        idLabel: 'Hotcode / Ref do Afiliado',
        tagLabel: 'Token de Parceria / API Key',
        helpText: 'Insira seu Hotcode oficial da Hotmart para redirecionar para suas páginas de vendas com comissão.'
      },
      kiwify: {
        id: 'kiwify',
        name: 'Kiwify',
        icon: 'fa-solid fa-gem',
        color: '#00cc66',
        textColor: '#fff',
        defaultCommission: 55.0,
        idLabel: 'Código de Afiliado Kiwify',
        tagLabel: 'Token API de Afiliado / Partner Key',
        helpText: 'Insira o seu código de afiliação ou Token da Kiwify.'
      },
      monetizze: {
        id: 'monetizze',
        name: 'Monetizze',
        icon: 'fa-solid fa-coins',
        color: '#1a56db',
        textColor: '#fff',
        defaultCommission: 50.0,
        idLabel: 'Código de Afiliado Monetizze',
        tagLabel: 'Chave de Rastreamento',
        helpText: 'Insira seu código de divulgação da Monetizze.'
      },
      cakto: {
        id: 'cakto',
        name: 'Cakto',
        icon: 'fa-solid fa-shield-halved',
        color: '#f59e0b',
        textColor: '#000',
        defaultCommission: 50.0,
        idLabel: 'Código de Afiliado Cakto',
        tagLabel: 'Token de Parceiro',
        helpText: 'Insira suas credenciais da Cakto.'
      }
    };
  }

  getPlatformDefinitions() {
    return this.platformDefinitions;
  }

  detectPlatform(urlOrText = '') {
    const text = String(urlOrText || '').toLowerCase();
    if (/(?:mercadolivre|mercado-livre|mercadolibre|mlb[-_]?\d+)/i.test(text)) return 'mercadolivre';
    if (/(?:shopee|shp\.ee)/i.test(text)) return 'shopee';
    if (/(?:braip|ev\.braip)/i.test(text)) return 'braip';
    if (/(?:shein|shein\.top)/i.test(text)) return 'shein';
    if (/(?:hotmart|hotm\.art)/i.test(text)) return 'hotmart';
    if (/(?:kiwify)/i.test(text)) return 'kiwify';
    if (/(?:monetizze)/i.test(text)) return 'monetizze';
    if (/(?:cakto)/i.test(text)) return 'cakto';
    return 'outro';
  }

  extractTitleAndKeywords(rawUrl = '', customTitle = '') {
    const formatter = require('../utils/whatsappFormatter');
    let title = customTitle ? formatter.sanitizeFieldForBold(customTitle) : '';

    if (!title && rawUrl) {
      try {
        const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        const pathSegments = u.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) {
          const lastSeg = decodeURIComponent(pathSegments[0] === 'p' && pathSegments[1] ? pathSegments[1] : pathSegments[pathSegments.length - 1]);
          title = lastSeg
            .replace(/[-_+]/g, ' ')
            .replace(/\b(MLB\d+|p\d+|html|\.php|view|product)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (title) {
            title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          }
        }
      } catch (_) {}
    }

    if (!title) title = 'Produto em Destaque';
    title = formatter.sanitizeFieldForBold(title);

    // Gera palavras-chave inteligentes para Escuta Social a partir do título
    const stopWords = new Set(['de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'nao', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'aqui', 'pro', 'pra']);
    const words = title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    const keywordsList = [...new Set(words)].slice(0, 8);
    const keywordsStr = keywordsList.join(', ');

    return { title, keywords: keywordsStr, wordsList: keywordsList };
  }

  buildAffiliateUrl({ productUrl, platform, account }) {
    if (!productUrl) return '';
    let cleanUrl = productUrl.trim();

    // Se o usuário não tem conta cadastrada, retorna a URL original
    if (!account) return cleanUrl;

    const plat = platform.toLowerCase();
    const affId = account.affiliate_id ? String(account.affiliate_id).trim() : '';
    const tag = account.tracking_tag ? String(account.tracking_tag).trim() : '';
    const code = tag || affId;

    if (!code) return cleanUrl;

    // Se for uma tag/código de teste fictício conhecido, não adultera a URL original
    if (code.toLowerCase().includes('test') || /^(?:sec_ml_top_123|shope_tag_01|af_braip_super_99|HOT_A998877Z|kiwi_af_master|shein_ref_vip)$/i.test(code)) {
      return cleanUrl;
    }

    // Se a URL já for um link de afiliado direto encurtado (ex: shope.ee, s.shopee.com.br, hotm.art, go.hotmart), mantém
    if (/^(https?:\/\/(?:shope\.ee|s\.shopee\.com\.br|hotm\.art|shein\.top|mercadolivre\.com\/sec)\/)/i.test(cleanUrl)) {
      return cleanUrl;
    }

    try {
      const u = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);

      if (plat === 'mercadolivre') {
        if (tag && tag.startsWith('sec_') && !tag.includes('test') && !tag.includes('top_123')) {
          return `https://mercadolivre.com/sec/${tag.replace('sec_', '')}`;
        }
        const mlTag = tag || affId;
        if (mlTag && !mlTag.includes('test')) {
          // Se for link de vitrine/social de concorrente (ex: /social/concorrente), substitui pelo perfil do usuário
          if (u.pathname && u.pathname.startsWith('/social/')) {
            u.pathname = `/social/${mlTag}`;
          }
          u.searchParams.set('matt_tool', mlTag);
          u.searchParams.set('matt_word', mlTag);
        }
        if (affId && !affId.includes('test')) {
          u.searchParams.set('af_sub1', affId);
          u.searchParams.set('tracking_id', affId);
        }
        return u.toString();
      }

      if (plat === 'shopee') {
        if (affId && !affId.includes('test')) u.searchParams.set('aff_id', affId);
        if (tag && !tag.includes('test') && tag !== affId) u.searchParams.set('sub_id', tag);
        return u.toString();
      }

      if (plat === 'braip') {
        u.searchParams.set('af', code);
        return u.toString();
      }

      if (plat === 'shein') {
        u.searchParams.set('url_from', code);
        if (affId) u.searchParams.set('aff_id', affId);
        return u.toString();
      }

      if (plat === 'hotmart') {
        if (!cleanUrl.includes('go.hotmart.com')) {
          u.searchParams.set('ref', code);
          return u.toString();
        }
        return `https://go.hotmart.com/${code}`;
      }

      if (plat === 'kiwify') {
        u.searchParams.set('af', code);
        return u.toString();
      }

      // Outras plataformas (Monetizze, Cakto, etc.)
      u.searchParams.set('ref', code);
      return u.toString();
    } catch (_) {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}af=${encodeURIComponent(code)}`;
    }
  }

  isDummyAffiliateUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const u = url.trim().toLowerCase();
    if (!u.startsWith('http://') && !u.startsWith('https://')) return true;

    const dummyPatterns = [
      'trader-pro-test', 'ml_top_123', 'shope_tag_01', 'af_braip_super_99',
      'bra999888', 'hot_a998877z', 'kiwi_af_master', 'shein_ref_vip',
      'test-unique', 'test_unique', 'teste', 'test', 'example.com', 'localhost',
      'paybot.store', 'paybot.app', 'mini-processador-turbo-vip',
      'fone-tws-pro-bluetooth', 'smartwatch-ultra9-nfc', 'airfryer-digital-touch'
    ];

    if (dummyPatterns.some(p => u.includes(p))) return true;
    if (/\/(?:teste?|test-product|produto-teste|demo)(?:[/?#]|$)/i.test(u)) return true;

    return false;
  }

  /**
   * Verifica se o link foi efetivamente afiliado com a ID ou Tag do Dono
   */
  isProductAffiliatedWithUser({ account, finalAffiliateUrl, cleanedProductUrl }) {
    if (!account || !account.active) return false;
    const affId = account.affiliate_id ? String(account.affiliate_id).trim() : '';
    const tag = account.tracking_tag ? String(account.tracking_tag).trim() : '';
    if (!affId && !tag) return false;

    // Se a URL final for idêntica à URL limpa (ou seja, nada foi anexado nem convertido)
    if (finalAffiliateUrl === cleanedProductUrl) {
      const containsId = affId && cleanedProductUrl.includes(affId);
      const containsTag = tag && cleanedProductUrl.includes(tag);
      return Boolean(containsId || containsTag);
    }

    const u = String(finalAffiliateUrl);
    if (affId && u.includes(affId)) return true;
    if (tag && u.includes(tag)) return true;

    return false;
  }

  /**
   * Envia notificação em tempo real ao Dono no WhatsApp avisando que há um produto
   * minerado aguardando o seu link de afiliado oficial para ser postado nos grupos!
   */
  async notifyOwnerPendingAffiliateLink(savedLink, productUrl, platformName) {
    try {
      const whatsappBot = require('../bots/whatsappBot');
      const ownerPhone = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || process.env.ADMIN_PHONE;
      if (!ownerPhone || !whatsappBot?.sock) return;

      const cleanPhone = ownerPhone.replace(/\D/g, '');
      const targetJid = `${cleanPhone}@s.whatsapp.net`;
      const priceText = Number(savedLink.product_price) > 0 ? `\n💰 *Preço:* R$ ${Number(savedLink.product_price).toFixed(2).replace('.', ',')}` : '';

      const alertMsg =
        `⏳ *PRODUTO MINERADO AGUARDANDO SEU LINK:* 🛍️\n\n` +
        `📦 *${savedLink.title}*\n` +
        `🏷️ Plataforma: *${platformName}*${priceText}\n` +
        `🔗 Link Original: ${productUrl}\n\n` +
        `⚠️ _Este item NÃO será postado nos grupos até você vincular o seu link de afiliado oficial para que a comissão seja 100% sua._\n\n` +
        `👉 *Para liberar para postar nos grupos, envie:*\n` +
        `*!afiliar ${savedLink.id} <seu_link_de_afiliado>*\n\n` +
        `💡 _Para ver todos os pendentes: envie *!pendentes*_`;

      await whatsappBot.sock.sendMessage(targetJid, { text: alertMsg });
    } catch (_) {}
  }

  generateSpintaxCopies(title, platformName = '') {
    const formatter = require('../utils/whatsappFormatter');
    const safeTitle = formatter.sanitizeFieldForBold(title);
    const safePlat = formatter.sanitizeFieldForBold(platformName);
    const platText = safePlat ? ` na ${safePlat}` : '';
    return [
      `{Olá|Oi|Opa|E aí|Fala pessoal|Fala galera|Tudo bem?|Tudo certo por aí?}! {Se você estava procurando|Pra quem tava querendo|Olha o que acabou de baixar de preço}: *${safeTitle}* {com desconto exclusivo|no menor preço histórico|com valor promocional}${platText}! {Encontrei essa oferta com frete rápido|O custo-benefício tá surreal|Vale muito a pena conferir|Avaliação máxima dos compradores}: {link} {🚀|✨|⭐}`,
      `{Atenção|Aviso rápido|Alerta de oferta|Gente|Olha só isso|Passando aqui rapidinho}: O produto *${safeTitle}* {acabou de entrar em promoção relâmpago|está com cupom de desconto ativo hoje|teve o preço reduzido hoje}${platText}. {Corre antes que acabe o estoque|Costuma esgotar bem rápido|Aproveitem enquanto o lote promocional durar}: {link} {🔥|⚡|📦}`,
      `{Dica de ouro|Boa notícia|Dica rápida|Fala turma|Para quem pediu indicação}: Se você estava de olho em *${safeTitle}*, {encontrei o link oficial com ótimo desconto|achei essa super oportunidade com garantia}${platText}. {É um dos mais bem avaliados da categoria|Quem comprou recomendou muito|Qualidade top e entrega garantida}: {link} {⭐|🚀|👏}`,
      `{Ei pessoal|Olha esse achadinho|Baita oportunidade|Achado do dia}: *${safeTitle}* {tá saindo por um valor imperdível|é disparado a melhor escolha custo-benefício}${platText}! {Entrega rápida e compra 100% segura|Vale cada centavo investido}: {link} {🛍️|🔥|✨}`,
      `{Preço despencou|Super novidade|Desconto liberado}! *${safeTitle}* {está com desconto direto no site parceiro|com cupom especial liberado}${platText}. {Dá uma olhada no link antes que altere o valor|Garanta o seu por aqui}: {link} {💥|🚀|📦}`,
      `{Bom dia|Boa tarde|Fala pessoal|Ei turma}! {Passando pra compartilhar esse achado sensacional|Olha o que eu achei em oferta hoje}: *${safeTitle}*${platText}. {Link seguro da promoção oficial|Aproveitem a oferta}: {link} {⚡|🛍️|⭐}`
    ];
  }

  /**
   * Remove parâmetros de tracking de concorrentes (utm, aff_id, matt_tool, etc)
   */
  stripCompetitorTracking(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
      const u = new URL(rawUrl);
      const trackingParamsToRemove = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'aff_id', 'sub_id', 'af_sub1', 'af_sub2', 'af', 'ref', 'matt_tool', 'matt_word',
        'mmp_pid', 'uls_trackid', 'gads_t_sig', 'exp_group', '__mobile__'
      ];
      for (const p of trackingParamsToRemove) {
        u.searchParams.delete(p);
      }
      return u.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  /**
   * Acessa e descompacta links encurtados minerados (shope.ee, s.shopee.com.br, meli.la, etc)
   * para descobrir a página original do produto e substituir a comissão de terceiros pela sua!
   */
  async unshortenAndCleanProductUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    const cleanUrl = rawUrl.trim();

    // Verifica se é um link encurtado típico de concorrente
    const isShortLink = /^(https?:\/\/(?:shope\.ee|s\.shopee\.com\.br|meli\.la|mercadolivre\.com\/sec|amzn\.to|bit\.ly|t\.co|cutt\.ly|tinyurl\.com|abre\.ai)\/)/i.test(cleanUrl);

    if (!isShortLink) {
      return this.stripCompetitorTracking(cleanUrl);
    }

    try {
      console.log(`[Unshortener 🔍] Descompactando link minerado de concorrente: ${cleanUrl}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const response = await fetch(cleanUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const finalUrl = response.url || cleanUrl;
      console.log(`[Unshortener ✅] Link resolvido de concorrente: ${cleanUrl} -> ${finalUrl}`);
      return this.stripCompetitorTracking(finalUrl);
    } catch (err) {
      console.warn(`[Unshortener ⚠️] Falha ao expandir link (${cleanUrl}): ${err.message}. Mantendo URL original.`);
      return cleanUrl;
    }
  }

  async autoAffiliateProduct({
    productUrl,
    platform: customPlatform,
    title: customTitle,
    price,
    original_price,
    image_url,
    tenant_id = null,
    is_launch = false,
    commission,
    autoDistribute = true,
    flows = ['social_listening', 'whatsapp_army', 'achadinhos'],
    source = 'auto_affiliation',
    is_manual = false,
    isManual = false,
    preserve_url = false,
    preserveUrl = false
  }) {
    if (!productUrl) throw new Error('A URL do produto é obrigatória para auto-afiliação.');
    const rawUrl = String(productUrl).trim();

    // 1. Verifica se a URL foi adicionada manualmente/em massa ou já contém o ID oficial do Dono
    const isOwnerManual = Boolean(
      is_manual ||
      isManual ||
      preserve_url ||
      preserveUrl ||
      source === 'manual' ||
      source === 'bulk_import' ||
      rawUrl.includes('18168880000') ||
      rawUrl.includes('amcr1395763')
    );

    let cleanedProductUrl = rawUrl;
    let finalAffiliateUrl = rawUrl;
    let detectedPlat = this.detectPlatform(rawUrl);
    let platform = (customPlatform && customPlatform !== 'auto') ? customPlatform.toLowerCase() : detectedPlat;
    let def = this.platformDefinitions[platform] || { name: 'Outra', defaultCommission: 50.0 };
    let account = models.getAffiliatePlatformAccountByPlatform(platform);
    let isAffiliatedWithUser = false;

    if (isOwnerManual) {
      // 🛡️ MODO PRESERVAÇÃO INTEGRAL (MANUAL / EM MASSA):
      // O link veio do próprio Dono. NUNCA desencurta, NUNCA remove parâmetros, NUNCA altera a URL!
      cleanedProductUrl = rawUrl;
      finalAffiliateUrl = rawUrl;
      isAffiliatedWithUser = true;
    } else {
      // MODO MINERAÇÃO CONCORRENTE:
      // Desencurta e remove comissões de concorrentes para tentar injetar o ID do dono
      cleanedProductUrl = await this.unshortenAndCleanProductUrl(rawUrl);
      detectedPlat = this.detectPlatform(cleanedProductUrl);
      platform = (customPlatform && customPlatform !== 'auto') ? customPlatform.toLowerCase() : detectedPlat;
      def = this.platformDefinitions[platform] || { name: 'Outra', defaultCommission: 50.0 };
      account = models.getAffiliatePlatformAccountByPlatform(platform);

      finalAffiliateUrl = this.buildAffiliateUrl({ productUrl: cleanedProductUrl, platform, account });

      isAffiliatedWithUser = this.isProductAffiliatedWithUser({
        account,
        finalAffiliateUrl,
        cleanedProductUrl
      });
    }

    const { title, keywords } = this.extractTitleAndKeywords(cleanedProductUrl, customTitle);
    const copies = this.generateSpintaxCopies(title, def.name);
    const primaryPitch = copies[0];

    const safePrice = Number(price) > 0 ? Number(price) : 0.0;
    const safeOriginal = Number(original_price) > 0 ? Number(original_price) : 0.0;
    const safeCommission = Number(commission) > 0 ? Number(commission) : def.defaultCommission;

    // Salva o link no catálogo:
    // • SE o link é do Dono (manual, em massa ou com ID aplicado) -> active = 1 (Pronto para postar!)
    // • SE o ID do Dono NÃO foi aplicado em mineração -> active = 0 (Pausado na fila de pendências!)
    const savedLink = models.createAffiliateLink({
      title,
      platform: def.name,
      affiliate_url: finalAffiliateUrl,
      commission_percent: safeCommission,
      product_price: safePrice,
      original_price: safeOriginal,
      image_url: image_url ? String(image_url).trim() : null,
      tenant_id: tenant_id ? Number(tenant_id) : null,
      currency: 'BRL',
      pitch_copy: primaryPitch,
      keywords,
      source: isOwnerManual ? (source === 'auto_affiliation' ? 'manual' : source) : 'auto_affiliation',
      original_product_url: cleanedProductUrl || rawUrl,
      platform_account_id: account ? account.id : null,
      auto_distributed: (autoDistribute && isAffiliatedWithUser) ? 1 : 0,
      is_launch: is_launch ? 1 : 0,
      active: isAffiliatedWithUser ? 1 : 0
    });

    // Se o produto NÃO possui o ID do Dono, NÃO pode ser postado de forma alguma!
    if (!isAffiliatedWithUser) {
      console.log(`[Auto-Affiliate ⏳ Pendente] Produto #${savedLink.id} ("${title}") aguarda seu link de afiliado para ${def.name}. Não será postado.`);
      this.notifyOwnerPendingAffiliateLink(savedLink, cleanedProductUrl, def.name);
      return {
        success: true,
        status: 'PENDING_USER_LINK',
        link: savedLink,
        platform: def,
        accountConnected: false,
        message: `Produto salvo na fila de pendências. O bot NÃO irá postar este item até você vincular seu link oficial com !afiliar ${savedLink.id} <seu_link>.`
      };
    }

    // Se o link foi criado sem imagem, busca e salva a miniatura oficial em segundo plano
    if (!image_url && savedLink?.id) {
      setImmediate(async () => {
        try {
          const linkPreviewService = require('./linkPreviewService');
          await linkPreviewService.populateAffiliateLinkImage(savedLink.id);
        } catch (_) {}
      });
    }

    const distributionResults = {
      socialListeningRule: null,
      armyCampaign: null,
      viralRadar: null,
      achadinhos: null
    };

    // Distribuição automática para os fluxos
    if (autoDistribute && Array.isArray(flows)) {
      if (this.isDummyAffiliateUrl(finalAffiliateUrl)) {
        console.warn(`[Auto-Affiliate 🛡️] Bloqueada distribuição de link fictício ou de teste (${finalAffiliateUrl}) nos canais e grupos.`);
        return {
          savedLink,
          distributionResults: {
            skipped: true,
            reason: 'Link fictício ou de teste não deve ser transmitido a grupos/canais públicos.'
          }
        };
      }

      if (flows.includes('social_listening') && keywords) {
        try {
          const rule = models.saveSocialListeningRule({
            keywords,
            product_name: title,
            affiliate_url: finalAffiliateUrl,
            templates: copies,
            cooldown_minutes: 15,
            action_type: 'REPLY'
          });
          distributionResults.socialListeningRule = rule;
        } catch (e) {
          console.warn('[Auto-Affiliate SL Error]:', e.message);
        }
      }

      if (flows.includes('whatsapp_army')) {
        try {
          const campaign = models.createAffiliateCampaign({
            name: `Divulgação - ${title.slice(0, 40)}`,
            affiliate_link_id: savedLink.id,
            product_name: title,
            affiliate_url: finalAffiliateUrl,
            message_template: primaryPitch,
            delay_min_seconds: 20,
            delay_max_seconds: 45
          });
          distributionResults.armyCampaign = campaign;
        } catch (e) {
          console.warn('[Auto-Affiliate Army Error]:', e.message);
        }
      }

      if (flows.includes('viral_radar')) {
        try {
          distributionResults.viralRadar = {
            ready: true,
            suggestedHook: `Você não vai acreditar no que esse ${title} é capaz de fazer pelo menor preço hoje!`
          };
        } catch (_) {}
      }

      if (flows.includes('achadinhos') && achadinhosService) {
        try {
          const achadinhosRes = await achadinhosService.broadcastLinkToChannels(savedLink, {
            tenantId: tenant_id,
            is_launch: Boolean(is_launch)
          });
          distributionResults.achadinhos = achadinhosRes;
        } catch (e) {
          console.warn('[Auto-Affiliate Achadinhos Error]:', e.message);
        }
      }
    }

    // Se houver canais de achadinhos com auto-post ativado e achadinhos não foi disparado via flows:
    if (achadinhosService && !flows.includes('achadinhos')) {
      achadinhosService.triggerAutoPostForNewLink(savedLink, tenant_id);
    }

    return {
      success: true,
      link: savedLink,
      platform: def,
      accountConnected: Boolean(account),
      accountName: account?.account_name || null,
      generatedUrl: finalAffiliateUrl,
      keywords,
      copies,
      distribution: distributionResults
    };
  }

  async distributeLinkToFlows(linkId, { flows = ['social_listening', 'whatsapp_army', 'achadinhos'], leads = [], tenantId = null } = {}) {
    const link = models.getAffiliateLinkById(Number(linkId));
    if (!link) throw new Error('Link de afiliado não encontrado.');

    const { keywords } = this.extractTitleAndKeywords('', link.title);
    const copies = this.generateSpintaxCopies(link.title, link.platform);
    const pitch = link.pitch_copy || copies[0];

    const results = {};

    if (flows.includes('social_listening')) {
      const slKeywords = link.keywords || keywords;
      const rule = models.saveSocialListeningRule({
        keywords: slKeywords,
        product_name: link.title,
        affiliate_url: link.affiliate_url,
        templates: copies,
        cooldown_minutes: 15,
        action_type: 'REPLY'
      });
      results.socialListening = rule;
    }

    if (flows.includes('whatsapp_army')) {
      const campaign = models.createAffiliateCampaign({
        name: `Campanha - ${link.title.slice(0, 40)}`,
        affiliate_link_id: link.id,
        product_name: link.title,
        affiliate_url: link.affiliate_url,
        message_template: pitch,
        delay_min_seconds: 20,
        delay_max_seconds: 45,
        leads
      });
      results.armyCampaign = campaign;
    }

    if (flows.includes('achadinhos') && achadinhosService) {
      try {
        const achRes = await achadinhosService.broadcastLinkToChannels(link, { tenantId: tenantId || link.tenant_id });
        results.achadinhos = achRes;
      } catch (e) {
        results.achadinhos = { success: false, error: e.message };
      }
    }

    models.updateAffiliateLink(link.id, { auto_distributed: 1 });
    return { success: true, results };
  }

  /**
   * Importação em massa de links de afiliados fornecidos pelo usuário.
   * Garante que as URLs sejam preservadas 100% como o usuário enviou,
   * sem desencurtamento, sem remoção de parâmetros e ativadas imediatamente com active=1.
   *
   * @param {Array|string} input - Array de objetos ou texto bruto (linhas)
   * @param {Object} options - { autoDistribute, flows }
   */
  async bulkImportAffiliateLinks(input, options = {}) {
    if (!input) throw new Error('Nenhum dado fornecido para importação em massa.');

    let rawList = [];
    if (Array.isArray(input)) {
      rawList = input;
    } else if (typeof input === 'string') {
      const lines = input.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const urlMatch = line.match(/https?:\/\/[^\s|]+/i);
        if (!urlMatch) continue;
        const url = urlMatch[0];
        const rest = line.replace(url, '').replace(/^[\s|]+/, '').trim();
        const parts = rest.split('|').map(p => p.trim()).filter(Boolean);

        let title = parts[0] || '';
        let original_price = 0;
        let price = 0;
        let coupon_code = null;

        if (parts.length >= 3) {
          original_price = parseFloat(parts[1].replace('R$', '').replace(',', '.').trim()) || 0;
          price = parseFloat(parts[2].replace('R$', '').replace(',', '.').trim()) || 0;
          coupon_code = parts[3] ? parts[3].trim() : null;
        } else if (parts.length === 2) {
          price = parseFloat(parts[1].replace('R$', '').replace(',', '.').trim()) || 0;
          original_price = price > 0 ? Number((price * 1.4).toFixed(2)) : 0;
        }

        rawList.push({
          url,
          title: title || undefined,
          price,
          original_price,
          coupon_code
        });
      }
    }

    if (rawList.length === 0) {
      throw new Error('Nenhum link válido encontrado para importação.');
    }

    const imported = [];
    const errors = [];

    for (const item of rawList) {
      try {
        const url = item.url || item.affiliate_url || item.productUrl || item.link;
        if (!url) continue;

        const res = await this.autoAffiliateProduct({
          productUrl: url,
          title: item.title,
          price: item.price || item.product_price,
          original_price: item.original_price,
          platform: item.platform || 'auto',
          image_url: item.image_url,
          coupon_code: item.coupon_code,
          isManual: true,
          preserveUrl: true,
          source: 'bulk_import',
          autoDistribute: options.autoDistribute === true
        });

        imported.push(res.link);
      } catch (err) {
        errors.push({ item, error: err.message });
      }
    }

    return {
      success: true,
      total: rawList.length,
      importedCount: imported.length,
      errorsCount: errors.length,
      links: imported,
      errors
    };
  }
}

module.exports = new AffiliatePlatformService();

/**
 * LinkPreviewService
 * Motor avançado e de alta performance de miniaturas (thumbnails) e cards ricos de links para WhatsApp (Baileys).
 *
 * Resolve o problema de miniaturas que não aparecem em links enviados pelo bot:
 * 1. Segue redirecionamentos cross-domain (ex: s.shopee.com.br -> shopee.com.br, meli.la -> mercadolivre, amzn.to -> amazon)
 * 2. Emite User-Agent oficial do WhatsApp para obter metadados OpenGraph reais (og:image, og:title, og:description)
 * 3. Faz download e gera thumbnail JPEG otimizada via sharp (respeitando limites de tamanho e resolução do WhatsApp)
 * 4. Injeta automaticamente 'linkPreview' (nativo Baileys) E 'contextInfo.externalAdReply' (card banner grande em Android/iOS/Web)
 * 5. Possui cache em memória com TTL e proteção contra timeouts para nunca travar o envio de mensagens.
 */

const sharp = require('sharp');
const { resolveProductImage, resolveProductImageWithFallback, isGenericOrBadImage } = require('../utils/productImageResolver');

class LinkPreviewService {
  constructor() {
    this.cache = new Map(); // url -> { preview, expiresAt }
    this.cacheTtlMs = 60 * 60 * 1000; // 1 hora de cache
    this.maxCacheEntries = 1000;

    // Logos oficiais de fallback em alta resolução para quando o site não fornecer og:image
    this.platformFallbacks = {
      shopee: {
        pattern: /shopee(?:\.com)?\.br|s\.shopee\.com\.br|shope\.ee/i,
        name: 'Shopee Brasil',
        image: 'https://deo.shopeemobile.com/shopee/shopee-mobilemall-live-sg/assets/ios_icon_180x180.350d4cdc7ba40b87541691005bda74c5.png',
        defaultTitle: 'Oferta Imperdível na Shopee',
        defaultDesc: 'Frete Grátis e Cupons Exclusivos na Shopee Brasil'
      },
      mercadolivre: {
        pattern: /mercadolivre(?:\.com)?\.br|mercadolibre|meli\.la/i,
        name: 'Mercado Livre',
        image: 'https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/180x180.png',
        defaultTitle: 'Produto no Mercado Livre',
        defaultDesc: 'Compra Garantida e Envio Rápido pelo Mercado Livre'
      },
      amazon: {
        pattern: /amazon(?:\.com)?\.br|amzn\.to|amazon\.com/i,
        name: 'Amazon Brasil',
        image: 'https://images-na.ssl-images-amazon.com/images/G/01/gc/designs/livepreview/a_generic_10_us_noto_email_v2016_us-main._CB627448102_.png',
        defaultTitle: 'Oferta na Amazon',
        defaultDesc: 'Entrega Prime e Melhores Preços na Amazon'
      },
      magalu: {
        pattern: /magazineluiza(?:\.com)?\.br|magalu\.me/i,
        name: 'Magazine Luiza',
        image: 'https://s.magazineluiza.com.br/banner/magalu-share.png',
        defaultTitle: 'Oferta no Magalu',
        defaultDesc: 'Tem no Magalu com Garantia e Pronta Entrega'
      },
      aliexpress: {
        pattern: /aliexpress(?:\.com)?|ali\.ski|s\.click\.aliexpress\.com/i,
        name: 'AliExpress',
        image: 'https://ae01.alicdn.com/kf/S5df9d2bb9cf34ea48fb3c22ec78280f3H.png',
        defaultTitle: 'Achadinho no AliExpress',
        defaultDesc: 'Descontos de Fabricante e Envio Direto no AliExpress'
      },
      youtube: {
        pattern: /youtube\.com|youtu\.be/i,
        name: 'YouTube',
        image: 'https://www.youtube.com/img/desktop/yt_1200.png',
        defaultTitle: 'Vídeo no YouTube',
        defaultDesc: 'Assista agora no canal oficial'
      },
      default: {
        image: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&auto=format&fit=crop&q=80',
        defaultTitle: 'Oferta Especial Verificada',
        defaultDesc: 'Confira as melhores ofertas e produtos com desconto'
      }
    };
  }

  /**
   * Extrai o primeiro link HTTP/HTTPS válido do texto
   */
  extractFirstUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/https?:\/\/[^\s<>"'`()\[\]{}]+/i);
    if (!match) return null;
    let url = match[0];
    // Remove pontuações finais comuns em mensagens (.,;:!?)
    url = url.replace(/[.,;:!?)]+$/, '');
    // Ignora links internos / schemas especiais
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return null;
    }
    return url;
  }

  /**
   * Decodifica entidades HTML comuns encontradas em tags OpenGraph
   */
  decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&#43;/g, '+')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
      .trim();
  }

  /**
   * Detecta plataforma por URL e retorna metadados de fallback
   */
  detectPlatformFallback(url) {
    if (!url) return this.platformFallbacks.default;
    for (const [key, plat] of Object.entries(this.platformFallbacks)) {
      if (key !== 'default' && plat.pattern && plat.pattern.test(url)) {
        return plat;
      }
    }
    return this.platformFallbacks.default;
  }

  /**
   * Faz download e gera um buffer JPEG otimizado para o WhatsApp usando Sharp
   */
  async generateJpegThumbnailBuffer(imageUrl, timeoutMs = 3500) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(imageUrl, {
        headers: {
          'user-agent': 'WhatsApp/2.24.6.77 A',
          'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) return null;
      const arrayBuf = await resp.arrayBuffer();
      const inputBuffer = Buffer.from(arrayBuf);
      if (!inputBuffer || inputBuffer.length === 0) return null;

      // Redimensiona para max 400x400 mantendo aspect ratio e converte para JPEG de alta qualidade
      const jpegBuffer = await sharp(inputBuffer)
        .resize(400, 400, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: 82,
          mozjpeg: true
        })
        .toBuffer();

      return jpegBuffer;
    } catch (e) {
      return null;
    }
  }

  /**
   * Busca e processa metadados OpenGraph de uma URL com suporte a redirecionamentos cross-domain
   */
  async fetchPreview(url, options = {}) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.trim();

    // 1. Verifica cache em memória
    const cached = this.cache.get(cleanUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.preview;
    }

    const timeoutMs = options.timeoutMs || 3500;
    const fallback = this.detectPlatformFallback(cleanUrl);

    // ⚡ 0. Intercepta links internos rastreados (/r/:slug e /go/:slug) para resolução direta do banco em 0ms
    const internalSlugMatch = cleanUrl.match(/\/(?:r|go)\/([a-zA-Z0-9_-]+)/i);
    if (internalSlugMatch && internalSlugMatch[1]) {
      try {
        const models = require('../db/models');
        const tracked = models.getTrackedLinkBySlug(internalSlugMatch[1]);
        if (tracked) {
          let ogImg = tracked.og_image;
          if (!ogImg || isGenericOrBadImage(ogImg)) {
            const affLinks = models.getAffiliateLinks(300);
            const matchAff = affLinks.find(a => (a.affiliate_url === tracked.destination_url || a.original_product_url === tracked.destination_url) && a.image_url && !isGenericOrBadImage(a.image_url));
            if (matchAff) {
              ogImg = matchAff.image_url;
              models.updateTrackedLink(tracked.id, { og_image: ogImg });
            } else {
              const resImg = resolveProductImage(tracked.title, '', tracked.platform);
              if (resImg && !isGenericOrBadImage(resImg)) {
                ogImg = resImg;
                models.updateTrackedLink(tracked.id, { og_image: ogImg });
              }
            }
          }
          if (ogImg && !isGenericOrBadImage(ogImg)) {
            const jpegThumb = await this.generateJpegThumbnailBuffer(ogImg, Math.max(1500, timeoutMs - 500));
            const preview = {
              url: cleanUrl,
              canonicalUrl: tracked.destination_url,
              title: (tracked.og_title || tracked.title || 'Oferta Exclusiva').slice(0, 100),
              description: (tracked.og_description || 'Confira os detalhes e garanta a sua oferta com desconto!').slice(0, 150),
              imageUrl: ogImg,
              jpegThumbnail: jpegThumb
            };
            if (preview.jpegThumbnail) {
              this.cache.set(cleanUrl, { preview, expiresAt: Date.now() + this.cacheTtlMs });
            }
            return preview;
          }
        }
      } catch (_) {}
    }

    // ⚡ 0.1 Intercepta links curtos da vitrine (/s/:code, /l/:code, /v/:code)
    const storeCodeMatch = cleanUrl.match(/\/(?:s|l|v|vitrine|loja)\/([a-zA-Z0-9_-]+)/i);
    if (storeCodeMatch && storeCodeMatch[1] && (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1') || cleanUrl.includes('paybot.store') || cleanUrl.includes('ngrok') || cleanUrl.includes('loca.lt'))) {
      try {
        const storeImg = 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=800&auto=format&fit=crop&q=80';
        const jpegThumb = await this.generateJpegThumbnailBuffer(storeImg, 2500);
        return {
          url: cleanUrl,
          canonicalUrl: cleanUrl,
          title: 'Spy Tech Studio | Loja Oficial & Catálogo',
          description: 'Acesse o catálogo com pronta entrega, cupons e suporte ao cliente.',
          imageUrl: storeImg,
          jpegThumbnail: jpegThumb
        };
      } catch (_) {}
    }

    let finalUrl = cleanUrl;
    let title = '';
    let description = '';
    let imageUrl = '';
    let jpegThumbnail = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Usar User-Agent oficial do WhatsApp faz e-commerces (Shopee, Mercado Livre, etc.)
      // retornarem a página pré-renderizada com as meta tags og:image e og:title corretas!
      let resp = await fetch(cleanUrl, {
        headers: {
          'user-agent': 'WhatsApp/2.24.6.77 A',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        redirect: 'follow',
        signal: controller.signal
      });

      // Se falhar com 403, tenta com User-Agent de navegador moderno
      if (resp.status === 403 || resp.status === 401) {
        resp = await fetch(cleanUrl, {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
          },
          redirect: 'follow',
          signal: controller.signal
        });
      }
      clearTimeout(timer);

      finalUrl = resp.url || cleanUrl;

      if (resp.ok) {
        const html = await resp.text();

        // Extrai og:title / title
        const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
                             html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (ogTitleMatch && ogTitleMatch[1]) {
          title = this.decodeHtmlEntities(ogTitleMatch[1]);
        }

        // Extrai og:description / description
        const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
                            html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
        if (ogDescMatch && ogDescMatch[1]) {
          description = this.decodeHtmlEntities(ogDescMatch[1]).slice(0, 150);
        }

        // 1. Extração estruturada via JSON-LD (<script type="application/ld+json">)
        try {
          const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
          for (const m of jsonLdMatches) {
            try {
              const parsed = JSON.parse(m[1].trim());
              const extractImg = (obj) => {
                if (!obj) return null;
                if (typeof obj.image === 'string') return obj.image;
                if (Array.isArray(obj.image) && obj.image.length > 0) {
                  return typeof obj.image[0] === 'string' ? obj.image[0] : (obj.image[0]?.url || null);
                }
                if (obj.image?.url) return obj.image.url;
                return null;
              };
              const ldImg = extractImg(parsed) || (Array.isArray(parsed) ? extractImg(parsed[0]) : null);
              if (ldImg && !isGenericOrBadImage(ldImg)) {
                imageUrl = ldImg;
                break;
              }
            } catch (_) {}
          }
        } catch (_) {}

        // 2. Extração via Meta Tags OpenGraph / Twitter
        if (!imageUrl || isGenericOrBadImage(imageUrl)) {
          const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
                             html.match(/<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+property=["']og:square_image["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
          if (ogImgMatch && ogImgMatch[1]) {
            const cand = ogImgMatch[1].trim();
            if (!isGenericOrBadImage(cand)) {
              imageUrl = cand;
            }
          }
        }

        // 3. Extração especializada por CDN dos principais marketplaces
        if (!imageUrl || isGenericOrBadImage(imageUrl)) {
          // Shopee CDN
          const shopeeImgMatch = html.match(/https?:\/\/(?:down-br\.img\.susercontent\.com|cf\.shopee\.com\.br)\/file\/[a-zA-Z0-9_-]+/i);
          if (shopeeImgMatch && !isGenericOrBadImage(shopeeImgMatch[0])) {
            imageUrl = shopeeImgMatch[0];
          }
        }
        if (!imageUrl || isGenericOrBadImage(imageUrl)) {
          // Mercado Livre CDN
          const mlImgMatch = html.match(/https?:\/\/http2\.mlstatic\.com\/D_(?:NQ_NP_)?\d+-MLB\d+_\d+-O\.(?:jpg|webp)/i);
          if (mlImgMatch && !isGenericOrBadImage(mlImgMatch[0])) {
            imageUrl = mlImgMatch[0];
          }
        }
        if (!imageUrl || isGenericOrBadImage(imageUrl)) {
          // Amazon CDN
          const amzImgMatch = html.match(/https?:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/I\/[a-zA-Z0-9_%+-]+\.(?:jpg|png)/i);
          if (amzImgMatch && !isGenericOrBadImage(amzImgMatch[0])) {
            imageUrl = amzImgMatch[0];
          }
        }

        // Resolve URLs relativas
        if (imageUrl && imageUrl.startsWith('/')) {
          try {
            imageUrl = new URL(imageUrl, finalUrl).href;
          } catch (_) {}
        }
      }
    } catch (_) {
      // Falha de rede ou timeout: continua com os fallbacks da plataforma
    }

    // Se não encontrou imagem, ou se a imagem retornada for logo genérico / 180x180:
    // Resolve uma imagem real e vendedora com base no título e nicho do produto
    if (!imageUrl || isGenericOrBadImage(imageUrl)) {
      const resolved = resolveProductImage(title || options.fallbackTitle, '', fallback.name);
      if (resolved && !isGenericOrBadImage(resolved)) {
        imageUrl = resolved;
      } else {
        imageUrl = resolveProductImageWithFallback(title || options.fallbackTitle, '', fallback.name);
      }
    }
    if (!title) {
      title = options.fallbackTitle || fallback.defaultTitle || 'Oferta Imperdível';
    }
    if (!description) {
      description = options.fallbackBody || fallback.defaultDesc || 'Toque para conferir no site oficial';
    }

    // Gera o buffer JPEG otimizado para o WhatsApp
    if (imageUrl) {
      jpegThumbnail = await this.generateJpegThumbnailBuffer(imageUrl, Math.max(1500, timeoutMs - 500));
    }

    // Se a imagem falhou e temos fallback de plataforma, tenta gerar a partir do logo
    if (!jpegThumbnail && fallback.image && fallback.image !== imageUrl) {
      jpegThumbnail = await this.generateJpegThumbnailBuffer(fallback.image, 2000);
      imageUrl = fallback.image;
    }

    const preview = {
      url: cleanUrl,
      canonicalUrl: finalUrl,
      title: title.slice(0, 100),
      description: description.slice(0, 150),
      imageUrl,
      jpegThumbnail
    };

    // Armazena no cache se gerou thumbnail com sucesso
    if (preview.jpegThumbnail) {
      if (this.cache.size >= this.maxCacheEntries) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cleanUrl, {
        preview,
        expiresAt: Date.now() + this.cacheTtlMs
      });
    }

    return preview;
  }

  /**
   * Enriquece o payload da mensagem Baileys com a miniatura do link.
   * Adiciona:
   * 1. linkPreview: { matched-text, title, description, jpegThumbnail, originalThumbnailUrl }
   * 2. contextInfo.externalAdReply: { title, body, mediaType: 1, thumbnail, thumbnailUrl, sourceUrl, renderLargerThumbnail: true }
   */
  async enrichMessageContent(content, options = {}) {
    if (!content) return content;
    if (options.noLinkPreview === true) return content;

    // Se já tiver miniatura explícita configurada, não sobrescreve
    if (content.linkPreview && content.contextInfo?.externalAdReply?.thumbnail) {
      return content;
    }

    // Identifica o texto base da mensagem
    let textToScan = '';
    if (typeof content === 'string') {
      textToScan = content;
    } else if (content.text && typeof content.text === 'string') {
      textToScan = content.text;
    } else if (content.caption && typeof content.caption === 'string') {
      textToScan = content.caption;
    }

    if (!textToScan) return content;

    const url = this.extractFirstUrl(textToScan);
    if (!url) return content;

    // Busca o preview de forma segura e rápida
    const preview = await this.fetchPreview(url, {
      timeoutMs: options.previewTimeoutMs || 3500,
      fallbackTitle: options.linkTitle,
      fallbackBody: options.linkDescription
    });

    if (!preview || !preview.jpegThumbnail) {
      return content;
    }

    // Se content era apenas uma string, converte para objeto Baileys
    let targetObj = typeof content === 'string' ? { text: content } : content;

    // 1. Injeta metadados nativos de Link Preview do Baileys
    targetObj.linkPreview = {
      'matched-text': preview.url,
      title: preview.title,
      description: preview.description,
      jpegThumbnail: preview.jpegThumbnail,
      originalThumbnailUrl: preview.imageUrl
    };

    // 2. Injeta Card Visual Grande (externalAdReply) garantindo renderização em WhatsApp Android, iOS e Web
    if (!targetObj.contextInfo) targetObj.contextInfo = {};
    if (!targetObj.contextInfo.externalAdReply) {
      targetObj.contextInfo.externalAdReply = {
        title: preview.title,
        body: preview.description,
        mediaType: 1, // 1 = IMAGE (obrigatório para renderizar a miniatura no WhatsApp)
        thumbnail: preview.jpegThumbnail, // Buffer JPEG real embutido
        thumbnailUrl: preview.imageUrl,
        sourceUrl: preview.url,
        renderLargerThumbnail: true, // Renderiza o preview grande em alta resolução
        showAdAttribution: true
      };
    } else {
      // Se externalAdReply já existia mas faltava a thumbnail em Buffer, injeta
      if (!targetObj.contextInfo.externalAdReply.thumbnail) {
        targetObj.contextInfo.externalAdReply.thumbnail = preview.jpegThumbnail;
      }
      if (typeof targetObj.contextInfo.externalAdReply.renderLargerThumbnail === 'undefined') {
        targetObj.contextInfo.externalAdReply.renderLargerThumbnail = true;
      }
    }

    return targetObj;
  }

  /**
   * Preenche automaticamente a imagem de um link de afiliado no banco se ela estiver nula ou for um logo genérico/180x180
   */
  async populateAffiliateLinkImage(affiliateLinkOrId) {
    try {
      const models = require('../db/models');
      let link = typeof affiliateLinkOrId === 'object' ? affiliateLinkOrId : models.getAffiliateLinkById(affiliateLinkOrId);
      if (!link) return null;

      // Se já tem imagem válida (não genérica e não 180x180), mantém
      if (link.image_url && link.image_url.startsWith('http') && !isGenericOrBadImage(link.image_url)) {
        return link;
      }

      // 1. 🔍 Tenta PRIMEIRO extrair a imagem REAL e original do produto diretamente do marketplace (Shopee, ML, Amazon, etc.)
      if (link.affiliate_url) {
        const preview = await this.fetchPreview(link.affiliate_url, { timeoutMs: 4000, fallbackTitle: link.title });
        if (preview && preview.imageUrl && !isGenericOrBadImage(preview.imageUrl)) {
          const updateData = { image_url: preview.imageUrl };
          if ((!link.title || link.title.startsWith('http') || link.title === 'Achadinho Exclusivo') && preview.title) {
            updateData.title = preview.title;
          }
          models.updateAffiliateLink(link.id, updateData);
          return { ...link, ...updateData };
        }
      }

      // 2. 🎯 Se não conseguiu obter do site, resolve imagem de alta definição semanticamente pelo título e nicho
      const resolvedImg = resolveProductImage(link.title, '', link.platform);
      if (resolvedImg && !isGenericOrBadImage(resolvedImg)) {
        models.updateAffiliateLink(link.id, { image_url: resolvedImg });
        return { ...link, image_url: resolvedImg };
      }

      // 3. 🛍️ Fallback de vitrine comercial elegante garantindo nunca exibir placeholders quebrados ou cabos velhos
      const fallbackImg = resolveProductImageWithFallback(link.title, '', link.platform);
      if (fallbackImg) {
        models.updateAffiliateLink(link.id, { image_url: fallbackImg });
        return { ...link, image_url: fallbackImg };
      }

      return link;
    } catch (_) {
      return null;
    }
  }
}

const linkPreviewService = new LinkPreviewService();
module.exports = linkPreviewService;

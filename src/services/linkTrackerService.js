/**
 * ============================================================================
 * 🔗 LINK TRACKER & CLOAKING SERVICE - PILAR 1: INFRAESTRUTURA DE DIVULGAÇÃO
 * ============================================================================
 * - Encurtador e roteador de links proprietário com anti-ban (/r/:slug e /go/:slug)
 * - Rastreamento completo de cliques (IP, User-Agent, Referrer, Sub-Bot, Grupo)
 * - Cloaking inteligente: exibe OpenGraph enriquecido para crawler do WhatsApp
 *   e redireciona instantaneamente o usuário real para a oferta com tags UTM.
 * - Substituição automática de links de afiliados em mensagens de Achadinhos e Status.
 * ============================================================================
 */

const crypto = require('crypto');
const models = require('../db/models');

class LinkTrackerService {
  constructor() {
    this.defaultCloakingMode = 'meta_refresh'; // 'meta_refresh', 'html_preview', 'direct_302'
  }

  /**
   * Obtém a URL base do servidor atual para os links encurtados
   */
  getBaseUrl() {
    try {
      const tunnelService = require('./tunnelService');
      const tunnelUrl = tunnelService.getPublicUrl?.() || tunnelService.getStoreUrl?.();
      if (tunnelUrl && !tunnelUrl.includes('localhost')) {
        return tunnelUrl.replace(/\/+$/, '');
      }
    } catch (_) {}

    const port = process.env.PORT || 3000;
    return `http://localhost:${port}`;
  }

  /**
   * Gera um slug limpo e atraente baseado no título ou hash
   */
  generateSlug(title = '') {
    if (title && typeof title === 'string') {
      const sanitized = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 28);

      if (sanitized.length >= 3) {
        const suffix = crypto.randomBytes(2).toString('hex').slice(0, 3);
        return `${sanitized}-${suffix}`;
      }
    }
    return 'oferta-' + crypto.randomBytes(3).toString('hex');
  }

  /**
   * Cria ou reaproveita um link rastreado com cloaking
   */
  createOrGetTrackedLink({
    url,
    title = 'Oferta Especial',
    platform = 'Outro',
    subbot_id = null,
    group_jid = null,
    source = 'achadinhos',
    cloaking_mode = null,
    og_title = null,
    og_description = null,
    og_image = null,
    image_url = null,
    custom_slug = null
  }) {
    if (!url || typeof url !== 'string') {
      throw new Error('URL de destino é obrigatória para o link rastreado.');
    }

    const cleanUrl = url.trim();

    // 🎯 Resolução Inteligente e Fiel da Imagem do Produto (OpenGraph / Thumbnail)
    const { resolveProductImage, resolveProductImageWithFallback, isGenericOrBadImage } = require('../utils/productImageResolver');
    let effectiveOgImage = og_image || image_url || null;

    if (!effectiveOgImage || isGenericOrBadImage(effectiveOgImage)) {
      try {
        // 1. Tenta buscar em affiliate_links com a mesma URL de afiliado
        const affLinks = models.getAffiliateLinks(300);
        const matchAff = affLinks.find(a => (a.affiliate_url === cleanUrl || a.original_product_url === cleanUrl) && a.image_url && !isGenericOrBadImage(a.image_url));
        if (matchAff) {
          effectiveOgImage = matchAff.image_url;
        }
      } catch (_) {}
    }

    if (!effectiveOgImage || isGenericOrBadImage(effectiveOgImage)) {
      try {
        // 2. Tenta buscar em products pelo nome ou slug
        const products = models.getProducts(100);
        const matchProd = products.find(p => (p.name === title || cleanUrl.includes(p.slug || '')) && p.image_url && !isGenericOrBadImage(p.image_url));
        if (matchProd) {
          effectiveOgImage = matchProd.image_url;
        }
      } catch (_) {}
    }

    if (!effectiveOgImage || isGenericOrBadImage(effectiveOgImage)) {
      // 3. Resolve semanticamente a imagem de alta definição com base no título e plataforma
      const resolved = resolveProductImage(title, '', platform);
      if (resolved && !isGenericOrBadImage(resolved)) {
        effectiveOgImage = resolved;
      }
    }

    const slug = custom_slug ? this.generateSlug(custom_slug) : this.generateSlug(title);

    const tracked = models.createTrackedLink({
      slug,
      title: title || 'Oferta Exclusiva PayBot',
      destination_url: cleanUrl,
      platform,
      cloaking_mode: cloaking_mode || this.defaultCloakingMode,
      og_title: og_title || title || '🔥 Oferta com Desconto Exclusivo',
      og_description: og_description || 'Confira os detalhes e garanta o seu com desconto antes que encerre o estoque!',
      og_image: effectiveOgImage || null,
      subbot_id,
      group_jid,
      source
    });

    // Se o link rastreado retornado estiver sem imagem ou com imagem genérica, atualiza
    if (effectiveOgImage && (!tracked.og_image || isGenericOrBadImage(tracked.og_image))) {
      try {
        models.updateTrackedLink(tracked.id, { og_image: effectiveOgImage });
        tracked.og_image = effectiveOgImage;
      } catch (_) {}
    }

    const baseUrl = this.getBaseUrl();
    const shortUrl = `${baseUrl}/r/${tracked.slug}`;

    return {
      ...tracked,
      short_url: shortUrl
    };
  }

  /**
   * Adiciona ou normaliza parâmetros UTM na URL de destino
   */
  appendUtmParameters(targetUrl, { source = 'paybot', medium = 'whatsapp', campaign = 'achadinhos' } = {}) {
    try {
      const parsed = new URL(targetUrl);
      if (!parsed.searchParams.has('utm_source')) parsed.searchParams.set('utm_source', source);
      if (!parsed.searchParams.has('utm_medium')) parsed.searchParams.set('utm_medium', medium);
      if (!parsed.searchParams.has('utm_campaign')) parsed.searchParams.set('utm_campaign', campaign);
      return parsed.toString();
    } catch (_) {
      return targetUrl;
    }
  }

  /**
   * Identifica se o User-Agent é de um bot/crawler de prévia de redes sociais
   */
  isSocialCrawler(userAgent = '') {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    return (
      ua.includes('whatsapp') ||
      ua.includes('facebookexternalhit') ||
      ua.includes('facebot') ||
      ua.includes('twitterbot') ||
      ua.includes('telegrambot') ||
      ua.includes('discordbot') ||
      ua.includes('slackbot') ||
      ua.includes('meta-externalagent')
    );
  }

  /**
   * Constrói o HTML de redirecionamento e OpenGraph (Cloaking Anti-Ban)
   */
  buildRedirectHtml(trackedLink, req) {
    const userAgent = req.headers['user-agent'] || '';
    const isCrawler = this.isSocialCrawler(userAgent);

    const title = trackedLink.og_title || trackedLink.title || 'Oferta Imperdível';
    const description = trackedLink.og_description || 'Aproveite o preço promocional agora mesmo!';

    const { resolveProductImage, resolveProductImageWithFallback, isGenericOrBadImage } = require('../utils/productImageResolver');
    let image = trackedLink.og_image || '';

    if (!image || isGenericOrBadImage(image)) {
      const resolved = resolveProductImage(trackedLink.title, '', trackedLink.platform);
      if (resolved && !isGenericOrBadImage(resolved)) {
        image = resolved;
        try { models.updateTrackedLink(trackedLink.id, { og_image: image }); } catch (_) {}
      } else {
        image = resolveProductImageWithFallback(trackedLink.title, '', trackedLink.platform);
      }
    }

    const finalUrl = this.appendUtmParameters(trackedLink.destination_url, {
      source: trackedLink.source || 'whatsapp',
      medium: 'whatsapp',
      campaign: trackedLink.slug
    });

    // Se for crawler, entrega metadados puros sem forçar redirecionamento imediato
    if (isCrawler) {
      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
  <meta property="og:url" content="${escapeHtml(finalUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
</body>
</html>`;
    }

    // Se for usuário real, renderiza página de cloaking com redirecionamento automático
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${escapeHtml(finalUrl)}">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
  <script>
    window.location.replace(${JSON.stringify(finalUrl)});
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      padding: 30px;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      max-width: 440px;
      width: 100%;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #334155;
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn {
      display: inline-block;
      margin-top: 20px;
      background: #10b981;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: bold;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Redirecionando para a oferta...</h2>
    <p>Aguarde um instante ou clique no botão abaixo:</p>
    <a class="btn" href="${escapeHtml(finalUrl)}">Acessar Oferta Agora ➔</a>
  </div>
</body>
</html>`;
  }

  /**
   * Processa texto e envelopa links externos em URLs cloaked do PayBot
   */
  wrapExternalLinksInText(text, { title = 'Oferta', subbot_id = null, group_jid = null } = {}) {
    if (!text || typeof text !== 'string') return text;

    const urlRegex = /https?:\/\/[^\s<>"')]+/gi;
    return text.replace(urlRegex, (url) => {
      // Ignora links locais ou que já são do /r/
      if (url.includes('/r/') || url.includes('localhost') || url.includes('127.0.0.1')) {
        return url;
      }
      try {
        const tracked = this.createOrGetTrackedLink({
          url,
          title,
          subbot_id,
          group_jid,
          source: 'auto_wrap'
        });
        return tracked.short_url;
      } catch (_) {
        return url;
      }
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = new LinkTrackerService();

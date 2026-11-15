/**
 * nuvemshopIntegrationService.js
 * Módulo Adicional SaaS: Integração E-commerce & Nuvemshop
 * Suporta sincronização de catálogo (API oficial e catálogo aberto),
 * webhooks de pedidos/carrinhos e disparo de mensagens no WhatsApp.
 */

const models = require('../db/models');

const MODULE_KEY = 'ecommerce_sync';
const MODULE_METADATA = {
  key: MODULE_KEY,
  name: 'Integração E-commerce & Nuvemshop',
  headline: 'Conecte sua loja virtual ao WhatsApp com IA e Sincronização Automática',
  description: 'Sincronize catálogo, preços, estoque e fotos do seu site oficial (Nuvemshop, WooCommerce, Shopify) direto com o bot de WhatsApp. Ative recuperação de carrinho abandonado e notificações de entrega automáticas.',
  price_monthly: 49.90,
  price_lifetime: 299.00,
  features: [
    'Sincronização automática do catálogo oficial com fotos em alta resolução',
    'IA treinada com os produtos, preços e links diretos da sua loja',
    'Recuperação de Carrinho Abandonado no WhatsApp 24 horas por dia',
    'Notificações automáticas de pedido pago e envio com código de rastreamento',
    'Compatível com Nuvemshop (ex: smrodrigues.com.br), WooCommerce e Shopify'
  ]
};

class NuvemshopIntegrationService {
  constructor() {
    this.MODULE_KEY = MODULE_KEY;
    this.MODULE_METADATA = MODULE_METADATA;
  }

  getModuleMetadata() {
    return this.MODULE_METADATA;
  }

  isModuleEnabled(tenantId) {
    return models.isTenantModuleEnabled(tenantId, MODULE_KEY);
  }

  getConfig(tenantId) {
    const config = models.getTenantEcommerceIntegration(tenantId);
    const isEnabled = this.isModuleEnabled(tenantId);
    return {
      module_enabled: isEnabled,
      config: config || {
        tenant_id: tenantId,
        platform: 'nuvemshop',
        store_name: '',
        store_url: '',
        store_id: '',
        access_token: '',
        auto_sync: 1,
        abandoned_cart_recovery: 1,
        order_notifications: 1,
        status: 'UNCONFIGURED',
        total_products_synced: 0,
        last_sync_at: null
      }
    };
  }

  saveConfig(tenantId, data) {
    const isEnabled = this.isModuleEnabled(tenantId);
    if (!isEnabled) {
      throw new Error('Módulo Adicional "ecommerce_sync" não adquirido para este Tenant.');
    }
    return models.upsertTenantEcommerceIntegration(tenantId, data);
  }

  /**
   * Testa a conectividade com a loja (Nuvemshop)
   */
  async testConnection({ store_url, store_id, access_token }) {
    if (!store_url) {
      throw new Error('A URL da loja é obrigatória para testar a conexão.');
    }

    let cleanUrl = store_url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const result = {
      success: false,
      store_url: cleanUrl,
      detected_platform: 'unknown',
      api_valid: false,
      sitemap_available: false,
      message: ''
    };

    try {
      // 1. Testa conectividade HTTP com a loja
      const res = await fetch(cleanUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PayBot/2.0' },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        throw new Error(`Loja respondeu com status HTTP ${res.status}`);
      }

      const html = await res.text();
      if (/mitiendanube\.com|tiendanube|nuvemshop/i.test(html)) {
        result.detected_platform = 'nuvemshop';
      } else if (/woocommerce|wp-content/i.test(html)) {
        result.detected_platform = 'woocommerce';
      } else if (/shopify\.com|cdn\.shopify/i.test(html)) {
        result.detected_platform = 'shopify';
      } else {
        result.detected_platform = 'custom_web';
      }

      // 2. Se credenciais oficiais de API foram fornecidas, testa a API da Nuvemshop
      if (store_id && access_token) {
        try {
          const apiRes = await fetch(`https://api.nuvemshop.com.br/v1/${store_id.trim()}/products?per_page=1`, {
            headers: {
              'Authentication': `bearer ${access_token.trim()}`,
              'User-Agent': 'PayBot-Nuvemshop-Integration (contato@paybot.com.br)'
            },
            signal: AbortSignal.timeout(8000)
          });
          if (apiRes.ok) {
            result.api_valid = true;
          }
        } catch (_) {}
      }

      // 3. Testa sitemap de produtos da loja
      try {
        const sitemapUrl = new URL('/sitemap.xml', cleanUrl).toString();
        const smRes = await fetch(sitemapUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PayBotScout/2.0)' },
          signal: AbortSignal.timeout(6000)
        });
        if (smRes.ok) {
          const smText = await smRes.text();
          if (smText.includes('<urlset') && smText.includes('/produtos/')) {
            result.sitemap_available = true;
          }
        }
      } catch (_) {}

      result.success = true;
      result.message = `Loja conectada com sucesso! Plataforma identificada: ${result.detected_platform.toUpperCase()}.${result.api_valid ? ' Chave de API validada.' : (result.sitemap_available ? ' Catálogo público pronto para sincronização rápida.' : '')}`;
      return result;
    } catch (err) {
      result.message = `Erro ao conectar com a loja: ${err.message}`;
      return result;
    }
  }

  /**
   * Sincroniza produtos do e-commerce para o banco do bot
   */
  async syncCatalog(tenantId, options = {}) {
    const isEnabled = this.isModuleEnabled(tenantId);
    if (!isEnabled) {
      throw new Error('Módulo Adicional "ecommerce_sync" não adquirido. Ative o módulo para sincronizar seu e-commerce.');
    }

    const config = models.getTenantEcommerceIntegration(tenantId);
    if (!config || !config.store_url) {
      throw new Error('Loja não configurada. Preencha a URL da sua loja antes de sincronizar.');
    }

    let cleanUrl = config.store_url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    let syncedItems = [];
    let methodUsed = 'sitemap_fast';

    // Se tiver Token oficial da API Nuvemshop, tenta via API primeiro
    if (config.store_id && config.access_token) {
      try {
        const apiRes = await fetch(`https://api.nuvemshop.com.br/v1/${config.store_id.trim()}/products?per_page=200`, {
          headers: {
            'Authentication': `bearer ${config.access_token.trim()}`,
            'User-Agent': 'PayBot-Nuvemshop-Integration'
          },
          signal: AbortSignal.timeout(12000)
        });

        if (apiRes.ok) {
          const productsJson = await apiRes.json();
          if (Array.isArray(productsJson)) {
            methodUsed = 'official_api';
            for (const p of productsJson) {
              const name = p.name ? (typeof p.name === 'object' ? (p.name.pt || Object.values(p.name)[0]) : p.name) : 'Produto';
              const price = p.variants && p.variants[0] ? Number(p.variants[0].price || 0) : 0;
              const img = p.images && p.images[0] ? p.images[0].src : '';
              const desc = p.description ? (typeof p.description === 'object' ? (p.description.pt || '') : p.description) : '';
              const cleanDesc = desc.replace(/<[^>]*>?/gm, '').trim().slice(0, 400);
              const extUrl = p.canonical_url || `${cleanUrl}/produtos/${p.handle || ''}`;

              syncedItems.push({
                external_id: String(p.id),
                name: String(name).trim(),
                price: price,
                image_url: img,
                description: cleanDesc,
                external_url: extUrl,
                category: p.categories && p.categories[0] ? (p.categories[0].name?.pt || 'Geral') : 'Geral'
              });
            }
          }
        }
      } catch (apiErr) {
        console.warn('[Nuvemshop API Sync Fallback]:', apiErr.message);
      }
    }

    // Fallback ou modo rápido via Sitemap público da loja (funciona 100% de imediato para lojas como smrodrigues.com.br)
    if (syncedItems.length === 0) {
      try {
        const sitemapUrl = new URL('/sitemap.xml', cleanUrl).toString();
        const smRes = await fetch(sitemapUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PayBotScout/2.0' },
          signal: AbortSignal.timeout(10000)
        });

        if (smRes.ok) {
          const xml = await smRes.text();
          const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];

          for (const block of urlBlocks) {
            const locMatch = block.match(/<loc>(https?:\/\/[^<]+)<\/loc>/);
            if (!locMatch) continue;
            const itemUrl = locMatch[1];

            // Pula páginas institucionais ou páginas raiz de produtos
            if (!itemUrl.includes('/produtos/') || itemUrl.endsWith('/produtos/')) continue;

            // Extrai imagem de alta resolução se presente no sitemap
            const imgMatch = block.match(/<image:loc>(https?:\/\/[^<]+)<\/image:loc>/);
            const imgUrl = imgMatch ? imgMatch[1] : '';

            // Extrai slug do produto da URL para criar um nome amigável e legível
            const slug = itemUrl.split('/produtos/')[1].replace(/\/$/, '');
            const rawTitle = slug
              .split('-')
              .map(word => {
                if (/^(com|de|para|em|por|e|a|o|da|do|das|dos)$/i.test(word)) return word.toLowerCase();
                return word.charAt(0).toUpperCase() + word.slice(1);
              })
              .join(' ');

            syncedItems.push({
              external_id: slug,
              name: rawTitle,
              price: 0, // No modo sitemap rápido o preço fica consultivo ou preenchido conforme orçamento
              image_url: imgUrl,
              description: `Produto disponível para entrega rápida e pedidos na loja oficial SM Rodrigues. Solicite orçamento com nossos atendentes!`,
              external_url: itemUrl,
              category: 'Papelaria & Suprimentos'
            });

            if (syncedItems.length >= 250) break; // Limite de segurança por lote
          }
        }
      } catch (smErr) {
        console.warn('[Nuvemshop Sitemap Sync]:', smErr.message);
      }
    }

    if (syncedItems.length === 0) {
      throw new Error('Nenhum produto pôde ser lido da loja. Verifique se o endereço da loja está correto.');
    }

    // Persiste os produtos sincronizados no catálogo do Tenant
    let createdCount = 0;
    let updatedCount = 0;

    for (const item of syncedItems) {
      try {
        const existing = models.getProductByExternalId
          ? models.getProductByExternalId(tenantId, item.external_id)
          : null;

        if (existing) {
          models.updateProduct(existing.id, {
            name: item.name,
            price: item.price > 0 ? item.price : existing.price,
            price_brl: item.price > 0 ? item.price : existing.price_brl,
            image_url: item.image_url || existing.image_url,
            external_url: item.external_url,
            external_platform: 'nuvemshop',
            active: 1
          });
          updatedCount++;
        } else {
          models.createProduct({
            name: item.name,
            description: item.description,
            price: item.price > 0 ? item.price : 1.0,
            price_brl: item.price > 0 ? item.price : 1.0,
            image_url: item.image_url,
            type: 'PHYSICAL',
            active: 1,
            tenant_id: tenantId,
            category: item.category || 'Geral',
            external_id: item.external_id,
            external_url: item.external_url,
            external_platform: 'nuvemshop'
          });
          createdCount++;
        }
      } catch (saveErr) {
        // Ignora duplicatas isoladas
      }
    }

    const totalNow = (config.total_products_synced || 0) + createdCount;
    models.upsertTenantEcommerceIntegration(tenantId, {
      total_products_synced: totalNow,
      last_sync_at: new Date().toISOString(),
      status: 'ACTIVE',
      last_error: null
    });

    models.logTenantEcommerceSync(tenantId, {
      platform: 'nuvemshop',
      event_type: 'CATALOG_SYNC',
      status: 'SUCCESS',
      items_count: syncedItems.length,
      details: {
        method: methodUsed,
        created: createdCount,
        updated: updatedCount,
        total_items: syncedItems.length,
        store_url: cleanUrl
      }
    });

    return {
      success: true,
      method: methodUsed,
      total_synced: syncedItems.length,
      created: createdCount,
      updated: updatedCount,
      store_url: cleanUrl,
      sample_products: syncedItems.slice(0, 5)
    };
  }

  /**
   * Processa Webhooks recebidos da Nuvemshop
   */
  async handleWebhook(tenantSlug, eventType, payload) {
    const tenant = models.getTenantBySlug(tenantSlug);
    if (!tenant) {
      throw new Error(`Tenant '${tenantSlug}' não encontrado.`);
    }

    if (!this.isModuleEnabled(tenant.id)) {
      throw new Error(`Módulo 'ecommerce_sync' não está ativo para o tenant '${tenantSlug}'.`);
    }

    const config = models.getTenantEcommerceIntegration(tenant.id);
    const event = String(eventType || payload?.event || '').toLowerCase();

    models.logTenantEcommerceSync(tenant.id, {
      platform: 'nuvemshop',
      event_type: `WEBHOOK_${event.toUpperCase()}`,
      status: 'SUCCESS',
      items_count: 1,
      details: payload
    });

    // Se o evento for pedido ou carrinho e houver WhatsApp conectado, podemos disparar
    const botInstances = models.getArmyInstancesByTenant(tenant.id);
    const activeBot = botInstances.find(b => b.status === 'CONNECTED' && b.active);

    const whatsappBot = require('../bots/whatsappBot');
    const customerPhone = payload?.customer?.phone || payload?.phone || payload?.billing_phone;
    const cleanCustomerPhone = customerPhone ? String(customerPhone).replace(/\D/g, '') : null;

    if (cleanCustomerPhone && cleanCustomerPhone.length >= 10 && activeBot && config) {
      const customerJid = `${cleanCustomerPhone.startsWith('55') ? cleanCustomerPhone : '55' + cleanCustomerPhone}@s.whatsapp.net`;
      const customerName = payload?.customer?.name || payload?.name || 'Cliente';
      const firstName = customerName.split(' ')[0];

      // 1. Pedido Criado
      if (event.includes('order/created') && config.order_notifications) {
        const orderId = payload.id || payload.number || 'novo';
        const total = payload.total ? `R$ ${Number(payload.total).toFixed(2)}` : '';
        const msg = `Olá, *${firstName}*! 👋\n\nRecebemos o seu pedido *#${orderId}* no site da *${tenant.name}*!\n\nEstamos acompanhando o processamento e te avisamos por aqui assim que for despachado. Qualquer dúvida só mandar uma mensagem! 👍`;
        whatsappBot.sendMessage(customerJid, msg).catch(() => {});
      }

      // 2. Pedido Pago
      if (event.includes('order/paid') && config.order_notifications) {
        const orderId = payload.id || payload.number || '';
        const msg = `Show de bola, *${firstName}*! 🎉\n\nO pagamento do seu pedido *#${orderId}* foi confirmado com sucesso!\n\nNossa equipe já está separando seus produtos com todo cuidado.`;
        whatsappBot.sendMessage(customerJid, msg).catch(() => {});
      }

      // 3. Pedido Enviado / Rastreio
      if (event.includes('order/fulfilled') && config.order_notifications) {
        const trackingCode = payload.shipping_tracking_number || payload.tracking_code || '';
        const trackingUrl = payload.shipping_tracking_url || '';
        const msg = `Boas notícias, *${firstName}*! 🚀\n\nSeu pedido foi despachado!\n\n📦 *Código de Rastreio:* ${trackingCode || 'Disponível no link'}\n${trackingUrl ? `🔗 Acompanhe a entrega: ${trackingUrl}\n` : ''}\nObrigado pela preferência!`;
        whatsappBot.sendMessage(customerJid, msg).catch(() => {});
      }

      // 4. Carrinho Abandonado
      if (event.includes('cart/abandoned') && config.abandoned_cart_recovery) {
        const cartUrl = payload.checkout_url || payload.recovery_url || config.store_url;
        const msg = `Opa, *${firstName}*! Tudo bem por aí? 🙂\n\nVi que você deixou alguns itens no seu carrinho na *${tenant.name}*.\n\nFicou alguma dúvida sobre os produtos, prazo de entrega ou formas de pagamento? Se precisar de ajuda pra concluir o pedido, tô por aqui! 👍\n\n🛒 Seu carrinho tá salvo aqui: ${cartUrl}`;
        whatsappBot.sendMessage(customerJid, msg).catch(() => {});
      }
    }

    return { success: true, tenant: tenantSlug, event, received_at: new Date().toISOString() };
  }

  /**
   * Cria pedido Pix para aquisição do Módulo Adicional (Upsell)
   */
  async createAddonOrder(tenantId, billingType = 'monthly') {
    const tenant = models.getTenantById(tenantId);
    if (!tenant) throw new Error('Tenant não encontrado.');

    const price = billingType === 'lifetime' ? MODULE_METADATA.price_lifetime : MODULE_METADATA.price_monthly;
    const desc = `Módulo Adicional: ${MODULE_METADATA.name} (${billingType === 'lifetime' ? 'Acesso Vitalício' : 'Mensalidade'}) - Tenant ${tenant.name}`;

    // Gera cobrança Pix via LivePix / Bacen
    let pixCode = '';
    let pixQr = '';
    try {
      const pixPayment = require('./pixPayment');
      const pixRes = await pixPayment.createPixPayment({
        amount: price,
        description: desc,
        correlationID: `MOD_${tenantId}_${Date.now()}`
      });
      if (pixRes && pixRes.pixCode) {
        pixCode = pixRes.pixCode;
        pixQr = pixRes.qrCodeBase64 || pixRes.qrCode || '';
      }
    } catch (_) {}

    // Fallback de Pix Copia e Cola estruturado caso gateway offline
    if (!pixCode) {
      const pixUtil = require('../utils/pixEmvUtil');
      pixCode = pixUtil.generateBacenPixPayload({
        key: models.getSetting('PIX_KEY', '+5548984702848'),
        name: models.getSetting('PIX_MERCHANT_NAME', 'PayBot Solucoes'),
        city: models.getSetting('PIX_MERCHANT_CITY', 'Sao Paulo'),
        amount: price,
        txid: '***'
      });
    }

    const order = models.createTenantModuleOrder(tenantId, {
      module_key: MODULE_KEY,
      module_name: MODULE_METADATA.name,
      billing_type: billingType,
      price,
      pix_code: pixCode,
      pix_qr_code: pixQr
    });

    return {
      success: true,
      order_id: order.id,
      module_key: MODULE_KEY,
      module_name: MODULE_METADATA.name,
      price,
      billing_type: billingType,
      pix_code: pixCode,
      pix_qr_code: pixQr
    };
  }
}

module.exports = new NuvemshopIntegrationService();

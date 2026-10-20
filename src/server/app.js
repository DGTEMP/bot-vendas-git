const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');
const whatsappBot = require('../bots/whatsappBot');
const telegramBot = require('../bots/telegramBot');

function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ==========================================
  // 1. WEBHOOK OFICIAL DA BINANCE PAY
  // ==========================================
  app.post('/api/binance/webhook', async (req, res) => {
    console.log('🔔 [Binance Webhook Recebido]:', JSON.stringify(req.body));

    try {
      const payload = req.body;
      let tradeNo = null;
      let status = null;

      if (payload.data) {
        let orderData = payload.data;
        if (typeof orderData === 'string') {
          try {
            orderData = JSON.parse(orderData);
          } catch (e) {
            orderData = {};
          }
        }
        tradeNo = orderData.merchantTradeNo;
        status = orderData.status;
      }

      if (!tradeNo && payload.bizId) tradeNo = payload.bizId;
      if (!status && payload.bizStatus) {
        status = payload.bizStatus === 'PAY_SUCCESS' ? 'PAID' : payload.bizStatus;
      }

      if (tradeNo && (status === 'PAID' || payload.bizStatus === 'PAY_SUCCESS')) {
        console.log(`✅ [Binance Webhook] Pagamento confirmado para ${tradeNo}. Acionando entrega...`);
        await fulfillment.fulfillOrder(tradeNo);
      }

      return res.status(200).json({ returnCode: 'SUCCESS', returnMessage: null });
    } catch (err) {
      console.error('❌ [Binance Webhook] Erro no processamento:', err.message);
      return res.status(500).json({ returnCode: 'FAIL', returnMessage: err.message });
    }
  });

  // ==========================================
  // 2. WEBHOOK DO MERCADO PAGO (PIX DINÂMICO)
  // ==========================================
  app.post('/api/mercadopago/webhook', async (req, res) => {
    console.log('🔔 [Mercado Pago Webhook Recebido]:', JSON.stringify(req.body), req.query);

    try {
      const body = req.body || {};
      const query = req.query || {};

      // ID do pagamento pode vir em body.data.id ou query.id ou query['data.id']
      const paymentId = body.data?.id || body.id || query['data.id'] || query.id;

      if (paymentId) {
        console.log(`🔍 [Mercado Pago Webhook] Consultando pagamento ID: ${paymentId}`);
        const result = await pixPayment.queryPixPayment(paymentId);

        if (result.success && result.status === 'PAID' && result.externalReference) {
          console.log(`✅ [Mercado Pago] Pagamento aprovado para pedido ${result.externalReference}!`);
          await fulfillment.fulfillOrder(result.externalReference);
        }
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('❌ [Mercado Pago Webhook] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 3. WEBHOOK DO LIVEPIX (APOIADOR)
  // ==========================================
  app.post('/api/livepix/webhook', async (req, res) => {
    console.log('🔔 [LivePix Webhook Recebido]:', JSON.stringify(req.body));
    try {
      const payload = req.body;
      const data = payload.data || payload;

      let tradeNo = data.reference || data.customId;
      if (!tradeNo && data.message) {
        const match = data.message.match(/ORD_[A-Za-z0-9_]+/);
        if (match) tradeNo = match[0];
      }

      if (tradeNo) {
        console.log(`✅ [LivePix Webhook] Pagamento Pix confirmado para ${tradeNo}. Acionando entrega...`);
        await fulfillment.fulfillOrder(tradeNo);
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('❌ [LivePix Webhook] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 4. SIMULADOR DE CHECKOUT
  // ==========================================
  app.get('/simulated-pay', (req, res) => {
    const tradeNo = req.query.tradeNo;
    const order = tradeNo ? models.getOrderByTradeNo(tradeNo) : null;

    if (!order) {
      return res.status(404).send('<h3>Pedido não encontrado para simulação.</h3>');
    }

    const isPix = order.gateway === 'mercadopago' || order.currency === 'BRL';
    const logoTitle = isPix ? '🟢 PIX <span>PAGAMENTOS</span>' : '⚡ BINANCE <span>PAY</span>';
    const amountFormatted = isPix ? `R$ ${order.amount.toFixed(2)}` : `${order.amount.toFixed(2)} USDT`;

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Checkout - Simulador de Pagamento</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body { background: #0b0e14; color: #eaecef; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #1e2329; border: 1px solid #2b313a; border-radius: 12px; width: 100%; max-width: 440px; padding: 28px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .logo { font-size: 24px; font-weight: bold; color: ${isPix ? '#00b4d8' : '#f0b90b'}; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .badge { background: ${isPix ? '#00b4d820' : '#f0b90b20'}; color: ${isPix ? '#00b4d8' : '#f0b90b'}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 15px; display: inline-block; }
          .amount { font-size: 38px; font-weight: 800; color: #fff; margin: 10px 0; }
          .info { background: #181a20; padding: 14px; border-radius: 8px; margin: 20px 0; text-align: left; font-size: 14px; color: #848e9c; }
          .info div { display: flex; justify-content: space-between; margin-bottom: 8px; }
          .info div:last-child { margin-bottom: 0; }
          .info span { color: #eaecef; font-weight: 500; }
          button { background: ${isPix ? '#00b4d8' : '#f0b90b'}; color: #181a20; border: none; padding: 14px 20px; border-radius: 8px; font-size: 16px; font-weight: bold; width: 100%; cursor: pointer; transition: 0.2s; }
          button:hover { filter: brightness(1.1); }
          .status { margin-top: 15px; font-size: 14px; color: #02c076; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">${logoTitle}</div>
          <div class="badge">Modo de Simulação / Teste</div>
          <div class="amount">${amountFormatted}</div>
          <div class="info">
            <div><span>Produto:</span> <span>${order.product_name}</span></div>
            <div><span>Pedido:</span> <span>${order.merchant_trade_no}</span></div>
            <div><span>Gateway:</span> <span>${(order.gateway || 'Pix').toUpperCase()}</span></div>
            <div><span>Canal:</span> <span>${order.platform.toUpperCase()}</span></div>
            <div><span>Status:</span> <span id="lblStatus">${order.status}</span></div>
          </div>
          <button id="btnPay" onclick="confirmPayment('${order.merchant_trade_no}')">
            ${order.status === 'PAID' ? '✅ Pedido Já Pago' : '💸 Confirmar Pagamento Simulado'}
          </button>
          <div id="msgStatus" class="status"></div>
        </div>

        <script>
          async function confirmPayment(tradeNo) {
            const btn = document.getElementById('btnPay');
            const msg = document.getElementById('msgStatus');
            btn.disabled = true;
            btn.innerText = 'Processando...';

            try {
              const res = await fetch('/api/orders/simulate-pay/' + tradeNo, { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                btn.innerText = '✅ Pagamento Confirmado!';
                msg.innerText = 'Sucesso! O produto/assinatura foi entregue no seu ' + '${order.platform}';
                document.getElementById('lblStatus').innerText = 'PAID';
              } else {
                btn.disabled = false;
                btn.innerText = 'Tentar Novamente';
                msg.innerText = 'Erro: ' + (data.error || 'Falha ao processar');
              }
            } catch (e) {
              btn.disabled = false;
              btn.innerText = 'Tentar Novamente';
              msg.innerText = 'Erro de conexão: ' + e.message;
            }
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  });

  app.post('/api/orders/simulate-pay/:tradeNo', async (req, res) => {
    const tradeNo = req.params.tradeNo;
    const order = models.getOrderByTradeNo(tradeNo);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
    }

    const result = await fulfillment.fulfillOrder(tradeNo);
    return res.json(result);
  });

  // ==========================================
  // 5. APIS DE GESTÃO DO PAINEL ADMIN
  // ==========================================

  // Métricas
  app.get('/api/metrics', (req, res) => {
    const metrics = models.getMetrics();
    const wppStatus = whatsappBot.getConnectionStatus();
    res.json({
      ...metrics,
      whatsapp: wppStatus,
      telegram: {
        connected: telegramBot.isRunning,
        statusMessage: telegramBot.isRunning ? 'Ativo e monitorando comandos' : 'Aguardando Token'
      }
    });
  });

  // WhatsApp QR Code & Status
  app.get('/api/whatsapp/status', (req, res) => {
    res.json(whatsappBot.getConnectionStatus());
  });

  // Produtos
  app.get('/api/products', (req, res) => {
    const products = models.getProducts(false).map(p => {
      if (p.type === 'license_key') {
        p.availableStock = models.getAvailableKeyCount(p.id);
      }
      return p;
    });
    res.json(products);
  });

  app.post('/api/products', (req, res) => {
    const { name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: 'Campos nome e tipo são obrigatórios.' });
    }
    const created = models.createProduct({
      name,
      description,
      price: price_brl || price || 0,
      price_brl: price_brl || price || 0,
      price_usdt: price_usdt || (price ? price / 5.5 : 0),
      currency: currency || 'BRL',
      type,
      duration_days: duration_days || 0,
      content,
      telegram_channel_id
    });
    res.json(created);
  });

  app.put('/api/products/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updated = models.updateProduct(id, req.body);
    res.json(updated);
  });

  app.delete('/api/products/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteProduct(id);
    res.json({ success: true });
  });

  // Chaves de Licença em Estoque
  app.get('/api/keys/:productId', (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    const keys = models.getKeysByProductId(productId);
    res.json({
      keys,
      availableCount: models.getAvailableKeyCount(productId)
    });
  });

  app.post('/api/keys/:productId', (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    const { keysText } = req.body;
    if (!keysText) return res.status(400).json({ error: 'Texto de chaves vazio' });

    const keyList = keysText.split('\n').map(k => k.trim()).filter(Boolean);
    const addedCount = models.addKeys(productId, keyList);
    res.json({ success: true, addedCount });
  });

  // Pedidos
  app.get('/api/orders', (req, res) => {
    const orders = models.getAllOrders(100);
    res.json(orders);
  });

  // Assinaturas
  app.get('/api/subscriptions', (req, res) => {
    const subs = models.getActiveSubscriptions();
    res.json(subs);
  });

  app.post('/api/subscriptions/:id/revoke', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const sub = models.getActiveSubscriptions().find(s => s.id === id);

    if (sub && sub.telegram_channel_id && fulfillment.removeTelegramMember) {
      try {
        await fulfillment.removeTelegramMember(sub.telegram_channel_id, sub.platform_user_id);
      } catch (e) {}
    }

    models.updateSubscriptionStatus(id, 'REVOKED');
    res.json({ success: true });
  });

  // ==========================================
  // TIMES DE VENDEDORES (SELLERS API)
  // ==========================================
  app.get('/api/sellers', (req, res) => {
    const sellers = models.getSellers(false);
    res.json(sellers);
  });

  app.post('/api/sellers', (req, res) => {
    const { name, email, phone, telegram_id, telegram_username, commission_rate } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do vendedor é obrigatório' });
    const seller = models.createSeller({ name, email, phone, telegram_id, telegram_username, commission_rate });
    res.json(seller);
  });

  app.put('/api/sellers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updated = models.updateSeller(id, req.body);
    res.json(updated);
  });

  app.delete('/api/sellers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteSeller(id);
    res.json({ success: true });
  });

  // ==========================================
  // SISTEMA DE AFILIADOS (AFFILIATES API)
  // ==========================================
  app.get('/api/affiliates', (req, res) => {
    const affiliates = models.getAffiliates(false);
    res.json(affiliates);
  });

  app.post('/api/affiliates', (req, res) => {
    const { name, email, phone, telegram_id, telegram_username, ref_code, commission_rate, pix_key, usdt_wallet } = req.body;
    if (!name || !ref_code) return res.status(400).json({ error: 'Nome e Código de Referência são obrigatórios' });

    try {
      const affiliate = models.createAffiliate({ name, email, phone, telegram_id, telegram_username, ref_code, commission_rate, pix_key, usdt_wallet });
      res.json(affiliate);
    } catch (e) {
      res.status(400).json({ error: 'Código de referência já em uso por outro afiliado.' });
    }
  });

  app.put('/api/affiliates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updated = models.updateAffiliate(id, req.body);
    res.json(updated);
  });

  app.delete('/api/affiliates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteAffiliate(id);
    res.json({ success: true });
  });

  // Gerador de links promocionais para afiliados
  app.get('/api/affiliates/:id/links', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const affiliate = models.getAffiliateById(id);
    if (!affiliate) return res.status(404).json({ error: 'Afiliado não encontrado' });

    const tgUsername = (models.getSetting('TELEGRAM_BOT_USERNAME') || 'seu_bot').replace('@', '');
    const wppNumber = (models.getSetting('WHATSAPP_PHONE_NUMBER') || '5511999999999').replace(/[^0-9]/g, '');

    const telegramLink = `https://t.me/${tgUsername}?start=ref_${affiliate.ref_code}`;
    const whatsappLink = `https://wa.me/${wppNumber}?text=${encodeURIComponent(`Olá! Vim pelo link de indicação ref_${affiliate.ref_code}`)}`;

    res.json({
      affiliate,
      links: {
        telegram: telegramLink,
        whatsapp: whatsappLink
      }
    });
  });

  // ==========================================
  // COMISSÕES & PAGAMENTOS (COMMISSIONS API)
  // ==========================================
  app.get('/api/commissions', (req, res) => {
    const commissions = models.getAllCommissions(100);
    res.json(commissions);
  });

  app.post('/api/commissions/:id/pay', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { proofNote } = req.body;
    const paid = models.markCommissionPaid(id, proofNote || 'Pago pelo Painel Admin');
    res.json({ success: true, commission: paid });
  });

  // ==========================================
  // CONFIGURAÇÕES GERAIS (PAINEL ADMIN)
  // ==========================================
  app.get('/api/settings', (req, res) => {
    const current = models.getAllSettings();
    const apiKey = current.BINANCE_API_KEY || config.binance.apiKey || '';
    const secretKey = current.BINANCE_SECRET_KEY || config.binance.secretKey || '';
    const mpToken = current.MERCADO_PAGO_ACCESS_TOKEN || '';
    const simModeBinance = current.BINANCE_SIMULATION_MODE || (config.binance.simulationMode ? 'true' : 'false');
    const simModePix = current.PIX_SIMULATION_MODE || 'true';
    const tgToken = current.TELEGRAM_BOT_TOKEN || config.telegram.botToken || '';
    const tgChannel = current.TELEGRAM_VIP_CHANNEL_ID || config.telegram.vipChannelId || '';
    const pubUrl = current.PUBLIC_URL || config.publicUrl || 'http://localhost:3000';

    res.json({
      // Gateways Ativos
      GATEWAY_PIX_ENABLED: current.GATEWAY_PIX_ENABLED !== 'false',
      GATEWAY_BINANCE_ENABLED: current.GATEWAY_BINANCE_ENABLED !== 'false',
      GATEWAY_LIVEPIX_ENABLED: current.GATEWAY_LIVEPIX_ENABLED === 'true',
      
      // Mercado Pago (Pix)
      MERCADO_PAGO_ACCESS_TOKEN: mpToken ? (mpToken.slice(0, 10) + '...' + mpToken.slice(-6)) : '',
      hasMercadoPagoToken: Boolean(mpToken),
      PIX_SIMULATION_MODE: simModePix,

      // LivePix
      LIVEPIX_USERNAME: current.LIVEPIX_USERNAME || '',

      // Binance Pay
      BINANCE_API_KEY: apiKey ? (apiKey.slice(0, 6) + '...' + apiKey.slice(-4)) : '',
      BINANCE_SECRET_KEY: secretKey ? '••••••••••••••••' : '',
      hasBinanceKeys: Boolean(apiKey && secretKey),
      BINANCE_SIMULATION_MODE: simModeBinance,

      // Telegram
      TELEGRAM_BOT_TOKEN: tgToken ? (tgToken.slice(0, 6) + '...' + tgToken.slice(-4)) : '',
      hasTelegramToken: Boolean(tgToken),
      TELEGRAM_VIP_CHANNEL_ID: tgChannel,
      TELEGRAM_BOT_USERNAME: current.TELEGRAM_BOT_USERNAME || '',

      // Regras de Negócio & Equipe
      GLOBAL_AFFILIATE_RATE: Number(current.GLOBAL_AFFILIATE_RATE || 20.0),
      ROUND_ROBIN_SELLERS: current.ROUND_ROBIN_SELLERS !== 'false',
      NOTIFY_ADMIN_ON_SALE: current.NOTIFY_ADMIN_ON_SALE !== 'false',
      ADMIN_NOTIFY_TELEGRAM_ID: current.ADMIN_NOTIFY_TELEGRAM_ID || '',
      ADMIN_NOTIFY_WHATSAPP_PHONE: current.ADMIN_NOTIFY_WHATSAPP_PHONE || '',
      BOT_NAME: current.BOT_NAME || 'PayBot Vendas',
      WELCOME_MESSAGE: current.WELCOME_MESSAGE || '👋 Olá! Seja muito bem-vindo.',
      SUPPORT_CONTACT: current.SUPPORT_CONTACT || '@suporte',

      // Servidor & Webhooks
      PUBLIC_URL: pubUrl,
      webhooks: {
        binance: `${pubUrl}/api/binance/webhook`,
        mercadopago: `${pubUrl}/api/mercadopago/webhook`,
        livepix: `${pubUrl}/api/livepix/webhook`
      }
    });
  });

  app.post('/api/settings', (req, res) => {
    const body = req.body;

    // Gateways
    if (body.GATEWAY_PIX_ENABLED !== undefined) {
      models.setSetting('GATEWAY_PIX_ENABLED', String(body.GATEWAY_PIX_ENABLED));
    }
    if (body.GATEWAY_BINANCE_ENABLED !== undefined) {
      models.setSetting('GATEWAY_BINANCE_ENABLED', String(body.GATEWAY_BINANCE_ENABLED));
    }
    if (body.GATEWAY_LIVEPIX_ENABLED !== undefined) {
      models.setSetting('GATEWAY_LIVEPIX_ENABLED', String(body.GATEWAY_LIVEPIX_ENABLED));
    }

    // Mercado Pago
    if (body.MERCADO_PAGO_ACCESS_TOKEN && !body.MERCADO_PAGO_ACCESS_TOKEN.includes('...')) {
      models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', body.MERCADO_PAGO_ACCESS_TOKEN.trim());
    }
    if (body.PIX_SIMULATION_MODE !== undefined) {
      models.setSetting('PIX_SIMULATION_MODE', String(body.PIX_SIMULATION_MODE));
    }

    // LivePix
    if (body.LIVEPIX_USERNAME !== undefined) {
      models.setSetting('LIVEPIX_USERNAME', body.LIVEPIX_USERNAME.trim().replace('@', ''));
    }

    // Binance Pay
    if (body.BINANCE_API_KEY && !body.BINANCE_API_KEY.includes('...')) {
      models.setSetting('BINANCE_API_KEY', body.BINANCE_API_KEY.trim());
    }
    if (body.BINANCE_SECRET_KEY && !body.BINANCE_SECRET_KEY.includes('•••')) {
      models.setSetting('BINANCE_SECRET_KEY', body.BINANCE_SECRET_KEY.trim());
    }
    if (body.BINANCE_SIMULATION_MODE !== undefined) {
      models.setSetting('BINANCE_SIMULATION_MODE', String(body.BINANCE_SIMULATION_MODE));
    }

    // Telegram
    if (body.TELEGRAM_BOT_TOKEN && !body.TELEGRAM_BOT_TOKEN.includes('...')) {
      models.setSetting('TELEGRAM_BOT_TOKEN', body.TELEGRAM_BOT_TOKEN.trim());
      telegramBot.start().catch(console.error);
    }
    if (body.TELEGRAM_VIP_CHANNEL_ID !== undefined) {
      models.setSetting('TELEGRAM_VIP_CHANNEL_ID', body.TELEGRAM_VIP_CHANNEL_ID.trim());
    }
    if (body.TELEGRAM_BOT_USERNAME !== undefined) {
      models.setSetting('TELEGRAM_BOT_USERNAME', body.TELEGRAM_BOT_USERNAME.trim().replace('@', ''));
    }

    // Regras de Negócio e Notificações
    if (body.GLOBAL_AFFILIATE_RATE !== undefined) {
      models.setSetting('GLOBAL_AFFILIATE_RATE', String(body.GLOBAL_AFFILIATE_RATE));
    }
    if (body.ROUND_ROBIN_SELLERS !== undefined) {
      models.setSetting('ROUND_ROBIN_SELLERS', String(body.ROUND_ROBIN_SELLERS));
    }
    if (body.NOTIFY_ADMIN_ON_SALE !== undefined) {
      models.setSetting('NOTIFY_ADMIN_ON_SALE', String(body.NOTIFY_ADMIN_ON_SALE));
    }
    if (body.ADMIN_NOTIFY_TELEGRAM_ID !== undefined) {
      models.setSetting('ADMIN_NOTIFY_TELEGRAM_ID', body.ADMIN_NOTIFY_TELEGRAM_ID.trim());
    }
    if (body.ADMIN_NOTIFY_WHATSAPP_PHONE !== undefined) {
      models.setSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', body.ADMIN_NOTIFY_WHATSAPP_PHONE.trim());
    }
    if (body.BOT_NAME !== undefined) {
      models.setSetting('BOT_NAME', body.BOT_NAME.trim());
    }
    if (body.WELCOME_MESSAGE !== undefined) {
      models.setSetting('WELCOME_MESSAGE', body.WELCOME_MESSAGE.trim());
    }
    if (body.SUPPORT_CONTACT !== undefined) {
      models.setSetting('SUPPORT_CONTACT', body.SUPPORT_CONTACT.trim());
    }

    // URL Pública
    if (body.PUBLIC_URL !== undefined) {
      models.setSetting('PUBLIC_URL', body.PUBLIC_URL.trim().replace(/\/$/, ''));
    }

    res.json({ success: true, message: 'Todas as configurações foram salvas com sucesso!' });
  });

  return app;
}

module.exports = { createServer };

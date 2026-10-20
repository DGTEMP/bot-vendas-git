const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
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

      // Binance Pay envia os dados do pedido dentro de "data" (frequentemente string JSON)
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

      // Fallback para campos diretos
      if (!tradeNo && payload.bizId) {
        tradeNo = payload.bizId;
      }

      if (!status && payload.bizStatus) {
        status = payload.bizStatus === 'PAY_SUCCESS' ? 'PAID' : payload.bizStatus;
      }

      if (tradeNo && (status === 'PAID' || payload.bizStatus === 'PAY_SUCCESS')) {
        console.log(`✅ [Binance Webhook] Pagamento confirmado para ${tradeNo}. Acionando entrega...`);
        await fulfillment.fulfillOrder(tradeNo);
      }

      // Binance Pay exige retorno específico para confirmar recebimento
      return res.status(200).json({
        returnCode: 'SUCCESS',
        returnMessage: null
      });
    } catch (err) {
      console.error('❌ [Binance Webhook] Erro no processamento:', err.message);
      return res.status(500).json({
        returnCode: 'FAIL',
        returnMessage: err.message
      });
    }
  });

  // ==========================================
  // 2. TELA E ROTA DE SIMULAÇÃO DE PAGAMENTO
  // ==========================================
  app.get('/simulated-pay', (req, res) => {
    const tradeNo = req.query.tradeNo;
    const order = tradeNo ? models.getOrderByTradeNo(tradeNo) : null;

    if (!order) {
      return res.status(404).send('<h3>Pedido não encontrado para simulação.</h3>');
    }

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Binance Pay - Simulador de Checkout</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body { background: #0b0e14; color: #eaecef; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #1e2329; border: 1px solid #2b313a; border-radius: 12px; width: 100%; max-width: 440px; padding: 28px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .logo { font-size: 26px; font-weight: bold; color: #f0b90b; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .badge { background: #f0b90b22; color: #f0b90b; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 15px; display: inline-block; }
          .amount { font-size: 38px; font-weight: 800; color: #fff; margin: 10px 0; }
          .curr { font-size: 20px; color: #848e9c; }
          .info { background: #181a20; padding: 14px; border-radius: 8px; margin: 20px 0; text-align: left; font-size: 14px; color: #848e9c; }
          .info div { display: flex; justify-content: space-between; margin-bottom: 8px; }
          .info div:last-child { margin-bottom: 0; }
          .info span { color: #eaecef; font-weight: 500; }
          button { background: #f0b90b; color: #181a20; border: none; padding: 14px 20px; border-radius: 8px; font-size: 16px; font-weight: bold; width: 100%; cursor: pointer; transition: 0.2s; }
          button:hover { background: #dfa90a; }
          .status { margin-top: 15px; font-size: 14px; color: #02c076; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">⚡ BINANCE <span>PAY</span></div>
          <div class="badge">Modo Simulação / Teste</div>
          <div class="amount">${order.amount.toFixed(2)} <span class="curr">${order.currency}</span></div>
          <div class="info">
            <div><span>Produto:</span> <span>${order.product_name}</span></div>
            <div><span>Pedido:</span> <span>${order.merchant_trade_no}</span></div>
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
  // 3. APIS DE GESTÃO DO PAINEL ADMIN
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
    const { name, description, price, currency, type, duration_days, content, telegram_channel_id } = req.body;
    if (!name || !price || !type) {
      return res.status(400).json({ error: 'Campos nome, preço e tipo são obrigatórios.' });
    }
    const created = models.createProduct({
      name,
      description,
      price,
      currency: currency || 'USDT',
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
    const { keysText } = req.body; // Texto com 1 chave por linha
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

  // Configurações
  app.get('/api/settings', (req, res) => {
    const current = models.getAllSettings();
    const apiKey = current.BINANCE_API_KEY || config.binance.apiKey || '';
    const secretKey = current.BINANCE_SECRET_KEY || config.binance.secretKey || '';
    const simMode = current.BINANCE_SIMULATION_MODE || (config.binance.simulationMode ? 'true' : 'false');
    const tgToken = current.TELEGRAM_BOT_TOKEN || config.telegram.botToken || '';
    const tgChannel = current.TELEGRAM_VIP_CHANNEL_ID || config.telegram.vipChannelId || '';
    const pubUrl = current.PUBLIC_URL || config.publicUrl || '';

    res.json({
      BINANCE_API_KEY: apiKey ? (apiKey.slice(0, 6) + '...' + apiKey.slice(-4)) : '',
      BINANCE_SECRET_KEY: secretKey ? '••••••••••••••••' : '',
      hasBinanceKeys: Boolean(apiKey && secretKey),
      BINANCE_SIMULATION_MODE: simMode,
      TELEGRAM_BOT_TOKEN: tgToken ? (tgToken.slice(0, 6) + '...' + tgToken.slice(-4)) : '',
      hasTelegramToken: Boolean(tgToken),
      TELEGRAM_VIP_CHANNEL_ID: tgChannel,
      PUBLIC_URL: pubUrl
    });
  });

  app.post('/api/settings', (req, res) => {
    const { BINANCE_API_KEY, BINANCE_SECRET_KEY, BINANCE_SIMULATION_MODE, TELEGRAM_BOT_TOKEN, TELEGRAM_VIP_CHANNEL_ID, PUBLIC_URL } = req.body;

    if (BINANCE_API_KEY && !BINANCE_API_KEY.includes('...')) {
      models.setSetting('BINANCE_API_KEY', BINANCE_API_KEY.trim());
    }
    if (BINANCE_SECRET_KEY && !BINANCE_SECRET_KEY.includes('•••')) {
      models.setSetting('BINANCE_SECRET_KEY', BINANCE_SECRET_KEY.trim());
    }
    if (BINANCE_SIMULATION_MODE !== undefined) {
      models.setSetting('BINANCE_SIMULATION_MODE', String(BINANCE_SIMULATION_MODE));
    }
    if (TELEGRAM_BOT_TOKEN && !TELEGRAM_BOT_TOKEN.includes('...')) {
      models.setSetting('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN.trim());
      // Reinicia bot do Telegram com novo token se necessário
      telegramBot.start().catch(console.error);
    }
    if (TELEGRAM_VIP_CHANNEL_ID !== undefined) {
      models.setSetting('TELEGRAM_VIP_CHANNEL_ID', TELEGRAM_VIP_CHANNEL_ID.trim());
    }
    if (PUBLIC_URL !== undefined) {
      models.setSetting('PUBLIC_URL', PUBLIC_URL.trim());
    }

    res.json({ success: true, message: 'Configurações atualizadas com sucesso!' });
  });

  return app;
}

module.exports = { createServer };

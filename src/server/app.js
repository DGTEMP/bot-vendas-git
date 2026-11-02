const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const db = require('../db/database');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');
const updatesChannel = require('../services/updatesChannel');
const whatsappArmyService = require('../services/whatsappArmyService');
const socialMediaService = require('../services/socialMediaService');
const nlpService = require('../services/nlpService');
const meteoricService = require('../services/meteoricService');
const whatsappBot = require('../bots/whatsappBot');
const telegramBot = require('../bots/telegramBot');
const zapVoiceService = require('../services/zapVoiceService');
const spyFeatures = require('../services/spyFeaturesService');

function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: 3600000, // Cache de 1h para assets estáticos para reduzir I/O de disco
    etag: true
  }));

  // ==========================================
  // REDIRECIONAMENTO INTELIGENTE DO LANÇAMENTO METEÓRICO
  // ==========================================
  app.get(['/l/vip', '/meteoro', '/vip', '/api/meteoric/redirect'], (req, res) => {
    try {
      models.incrementMeteoricLeads();
      const activeGroup = models.getActiveMeteoricGroup();
      if (activeGroup && activeGroup.invite_url) {
        return res.redirect(activeGroup.invite_url);
      }
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Grupo VIP Lançamento</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #0b0e14; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
            .card { background: #181d26; border: 1px solid #272f3d; padding: 32px; border-radius: 12px; max-width: 440px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h2 { color: #f97316; margin-top: 0; }
            p { color: #848e9c; font-size: 15px; line-height: 1.5; }
            .badge { background: rgba(249, 115, 22, 0.15); color: #f97316; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">🚀 Lançamento Meteórico VIP</span>
            <h2>Vagas Sendo Liberadas!</h2>
            <p>O próximo grupo VIP exclusivo de lançamento está sendo preparado pelo nosso sistema. Atualize esta página em alguns segundos para acessar o link direto!</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send('Erro ao redirecionar: ' + err.message);
    }
  });

  // ==========================================
  // 1. WEBHOOK OFICIAL DA BINANCE PAY
  // ==========================================
  app.post('/api/binance/webhook', async (req, res) => {
    console.log('🔔 [Binance Webhook Recebido]:', JSON.stringify(req.body));

    try {
      // Validação de assinatura criptográfica Binance Pay
      const isValidSig = binancePay.verifyWebhookSignature(req.headers, req.body);
      if (!isValidSig) {
        console.warn('⚠️ [Binance Webhook] Assinatura HMAC inválida rejeitada.');
        return res.status(401).json({ returnCode: 'FAIL', returnMessage: 'Assinatura inválida' });
      }

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
  // FILA DE TAREFAS, AUTOMAÇÕES & EDIÇÃO DE PEDIDOS
  // ==========================================
  app.get('/api/tasks/queue', (req, res) => {
    try {
      const isAbandonedEnabled = models.getSetting('ABANDONED_CART_ENABLED', 'true') === 'true';
      const pendingOrders = models.getPendingRecoveryTasks(50);
      const delegatedTasks = models.getDelegatedTasks({ limit: 50 });
      const wppStatus = whatsappBot.getConnectionStatus ? whatsappBot.getConnectionStatus() : { connected: false };
      
      let armySummary = { connected: 0, total: 0 };
      try {
        const whatsappArmyService = require('../services/whatsappArmyService');
        armySummary = whatsappArmyService.getSubBotsStatusSummary ? whatsappArmyService.getSubBotsStatusSummary() : armySummary;
      } catch (_) {}

      res.json({
        success: true,
        abandonedCartEnabled: isAbandonedEnabled,
        pendingOrders,
        delegatedTasks,
        botStatus: {
          whatsapp: wppStatus,
          army: armySummary
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/queue/toggle', (req, res) => {
    try {
      const current = models.getSetting('ABANDONED_CART_ENABLED', 'true') === 'true';
      const next = !current;
      models.setSetting('ABANDONED_CART_ENABLED', String(next));
      res.json({ success: true, enabled: next });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/orders/:tradeNo/edit', (req, res) => {
    try {
      const tradeNo = req.params.tradeNo;
      const updated = models.updateOrderDetails(tradeNo, req.body);
      if (!updated) return res.status(404).json({ error: 'Pedido não encontrado.' });
      res.json({ success: true, order: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/orders/:tradeNo/skip', (req, res) => {
    try {
      const tradeNo = req.params.tradeNo;
      models.skipOrderRecovery(tradeNo);
      res.json({ success: true, message: 'Lembrete do pedido pulado com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/orders/:tradeNo/pause', (req, res) => {
    try {
      const tradeNo = req.params.tradeNo;
      models.pauseOrderRecovery(tradeNo);
      res.json({ success: true, message: 'Lembrete do pedido pausado.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/orders/:tradeNo/resume', (req, res) => {
    try {
      const tradeNo = req.params.tradeNo;
      models.resumeOrderRecovery(tradeNo);
      res.json({ success: true, message: 'Lembrete do pedido reativado na fila.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/orders/:tradeNo/send-recovery-now', async (req, res) => {
    try {
      const tradeNo = req.params.tradeNo;
      const order = models.getOrderByTradeNo(tradeNo);
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

      const template = models.getSetting(
        'ABANDONED_CART_MESSAGE',
        '👋 Olá, {name}! Notamos que seu pedido para *{product}* ainda está reservado.\n\nFicou com alguma dúvida para concluir seu pagamento? Garanta o seu antes que o link expire!\n\nClique no link abaixo para pagar e receber seu acesso imediatamente:'
      );
      const customerName = order.platform_user_name || 'Cliente';
      const valorStr = order.currency === 'BRL' ? `R$ ${order.amount.toFixed(2)}` : `${order.amount.toFixed(2)} USDT`;

      let message = template
        .replace(/{name}/g, customerName)
        .replace(/{product}/g, order.product_name)
        .replace(/{amount}/g, valorStr)
        .replace(/{order}/g, order.merchant_trade_no);

      if (order.pix_code) {
        message += `\n\n📋 *Código Pix Copia e Cola:*\n\`${order.pix_code}\``;
      } else if (order.checkout_url) {
        message += `\n\n🔗 *Link Direto de Pagamento:*\n${order.checkout_url}`;
      }

      let sent = false;
      if (order.platform === 'telegram' && fulfillment.sendTelegramMessage) {
        sent = await fulfillment.sendTelegramMessage(order.platform_user_id, message);
      } else if (order.platform === 'whatsapp' && fulfillment.sendWhatsAppMessage) {
        const cleanPhone = String(order.platform_user_id || '').replace(/\D/g, '');
        sent = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, message);
      }

      if (sent !== false) {
        models.markOrderRecoverySent(order.id);
        res.json({ success: true, message: 'Lembrete enviado com sucesso ao cliente!' });
      } else {
        res.status(400).json({ error: 'Falha no envio. Verifique se o bot está conectado ao WhatsApp.' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/skip', (req, res) => {
    try {
      const updated = models.updateDelegatedTask(Number(req.params.id), { status: 'SKIPPED', result_summary: 'Tarefa pulada pelo administrador' });
      res.json({ success: true, task: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/pause', (req, res) => {
    try {
      const updated = models.updateDelegatedTask(Number(req.params.id), { status: 'PAUSED', result_summary: 'Tarefa pausada pelo administrador' });
      res.json({ success: true, task: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/resume', (req, res) => {
    try {
      const updated = models.updateDelegatedTask(Number(req.params.id), { status: 'PENDING', result_summary: null });
      res.json({ success: true, task: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // Status de Sistema, Latência e Sub-Bots (Ping & Diagnóstico)
  app.get('/api/system/ping', (req, res) => {
    try {
      const start = Date.now();
      const uptime = process.uptime();
      const memory = process.memoryUsage();
      const subBotsSummary = whatsappArmyService.getSubBotsStatusSummary ? whatsappArmyService.getSubBotsStatusSummary() : { totalSubBots: 0, onlineSubBots: 0, totalSentToday: 0 };
      const wppStatus = whatsappBot.getConnectionStatus ? whatsappBot.getConnectionStatus() : { connected: false };
      res.json({
        ping_ms: Math.round(Date.now() - start),
        uptime_seconds: Math.floor(uptime),
        uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        ram_mb: Math.round(memory.rss / 1024 / 1024),
        heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
        node_version: process.version,
        platform: process.platform,
        matrix_connected: wppStatus.connected || false,
        matrix_phone: wppStatus.phoneNumber || '',
        subbots_total: subBotsSummary.totalSubBots || 0,
        subbots_online: subBotsSummary.onlineSubBots || 0,
        subbots_sent_today: subBotsSummary.totalSentToday || 0,
        owner_phone: models.getSetting('OWNER_PHONE', process.env.OWNER_WHATSAPP || '')
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Otimização Manual e Reciclagem de Memória RAM & Cache SQLite
  app.post('/api/system/optimize-memory', (req, res) => {
    try {
      const beforeRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const beforeHeap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      const db = require('../db/database');
      const spyFeatures = require('../services/spyFeaturesService');
      if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
      if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
      if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
      if (typeof global.gc === 'function') global.gc();

      const afterRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const afterHeap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const freedMb = Math.max(0, beforeRss - afterRss);

      res.json({
        success: true,
        message: 'Memória RAM e latência otimizadas com sucesso.',
        ram_before_mb: beforeRss,
        ram_after_mb: afterRss,
        heap_before_mb: beforeHeap,
        heap_after_mb: afterHeap,
        freed_mb: freedMb,
        ping_ms: 1
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // WhatsApp Matriz QR Code, Pairing Code & Gestão de Sessão
  app.get('/api/whatsapp/status', (req, res) => {
    res.json(whatsappBot.getConnectionStatus());
  });

  app.post('/api/whatsapp/pairing-code', async (req, res) => {
    try {
      const { phone } = req.body;
      const result = await whatsappBot.requestPairingCode(phone);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/reset', async (req, res) => {
    try {
      const result = await whatsappBot.resetSession();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/reconnect', async (req, res) => {
    try {
      await whatsappBot.start();
      res.json({ success: true, message: 'Reconexão iniciada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // MULTI-CONTAS WHATSAPP (MATRIZ + SUB-BOTS / CHIPS)
  // ==========================================
  app.get('/api/whatsapp/accounts', (req, res) => {
    try {
      res.json(whatsappArmyService.getAllAccounts());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/accounts', async (req, res) => {
    try {
      const { name, phone, daily_limit } = req.body;
      const inst = await whatsappArmyService.createAndConnectInstance({ name, phone, daily_limit });
      res.json({ success: true, instance: inst });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/accounts/:id/qr', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      res.json(whatsappArmyService.getInstanceQr(id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/accounts/:id/pairing-code', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { phone } = req.body;
      const result = await whatsappArmyService.requestPairingCode(id, phone);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/accounts/:id/connect', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await whatsappArmyService.startInstance(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/accounts/:id/disconnect', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (id === 1) {
        await whatsappBot.stop();
      } else {
        await whatsappArmyService.stopInstance(id);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/accounts/:id/reset', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await whatsappArmyService.resetInstanceSession(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/whatsapp/accounts/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (id === 1) {
        return res.status(400).json({ error: 'A conta Matriz Principal não pode ser excluída.' });
      }
      whatsappArmyService.stopInstance(id).catch(() => {});
      models.deleteArmyInstance(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Produtos & Categorias
  app.get('/api/products', (req, res) => {
    const products = models.getProducts(false);
    res.json(products);
  });

  app.get('/api/categories', (req, res) => {
    const categories = models.getCategories();
    res.json(categories);
  });

  app.get('/api/products/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = models.getProductById(id);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(product);
  });

  app.get('/api/products/:id/sellers', (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(models.getProductSellers(id));
  });

  app.post('/api/products/:id/sellers', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { seller_ids } = req.body;
    const sellers = models.setProductSellers(id, seller_ids || []);
    res.json(sellers);
  });

  app.post('/api/products', (req, res) => {
    const { 
      name, description, price, price_brl, price_usdt, currency, type, duration_days, 
      content, telegram_channel_id, upsell_product_id, upsell_discount_percent, 
      upsell_headline, company_id, category, affiliation_enabled, custom_affiliate_rate, seller_ids 
    } = req.body;
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
      telegram_channel_id,
      upsell_product_id: upsell_product_id ? Number(upsell_product_id) : null,
      upsell_discount_percent: Number(upsell_discount_percent || 20.0),
      upsell_headline,
      company_id: company_id ? Number(company_id) : null,
      category: category ? category.trim() : 'Geral',
      affiliation_enabled: affiliation_enabled !== undefined ? (affiliation_enabled ? 1 : 0) : 1,
      custom_affiliate_rate: custom_affiliate_rate !== undefined && custom_affiliate_rate !== null && custom_affiliate_rate !== '' ? Number(custom_affiliate_rate) : null,
      seller_ids: Array.isArray(seller_ids) ? seller_ids : []
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
  // TIMES DE VENDEDORES & PRODUTOS PERMITIDOS (SELLERS API)
  // ==========================================
  app.get('/api/sellers', (req, res) => {
    const sellers = models.getSellers(false);
    res.json(sellers);
  });

  app.post('/api/sellers', (req, res) => {
    const { name, email, phone, telegram_id, telegram_username, commission_rate, product_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do vendedor é obrigatório' });
    const seller = models.createSeller({ 
      name, 
      email, 
      phone, 
      telegram_id, 
      telegram_username, 
      commission_rate, 
      product_ids: Array.isArray(product_ids) ? product_ids : [] 
    });
    res.json(seller);
  });

  app.put('/api/sellers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updated = models.updateSeller(id, req.body);
    res.json(updated);
  });

  app.get('/api/sellers/:id/products', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const products = models.getSellerProducts(id);
    res.json(products);
  });

  app.post('/api/sellers/:id/products', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { product_ids } = req.body;
    const updated = models.setSellerProducts(id, Array.isArray(product_ids) ? product_ids : []);
    res.json(updated);
  });

  app.delete('/api/sellers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteSeller(id);
    res.json({ success: true });
  });

  // ==========================================
  // EMPRESAS & MULTI-TENANCY (COMPANIES API)
  // ==========================================
  app.get('/api/companies', (req, res) => {
    const companies = models.getCompanies(false);
    res.json(companies);
  });

  app.post('/api/companies', (req, res) => {
    const { name, document, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
    }
    const company = models.createCompany({ name, document, description });
    res.json(company);
  });

  app.put('/api/companies/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updated = models.updateCompany(id, req.body);
    res.json(updated);
  });

  app.delete('/api/companies/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteCompany(id);
    res.json({ success: true });
  });

  // ==========================================
  // FILA DE ESPERA DE AFILIAÇÃO & CRITÉRIOS (PRODUCT AFFILIATIONS API)
  // ==========================================
  app.get('/api/affiliations/queue', (req, res) => {
    const { status, affiliate_id, product_id } = req.query;
    const affiliations = models.getProductAffiliations({
      status: status || null,
      affiliate_id: affiliate_id ? parseInt(affiliate_id, 10) : null,
      product_id: product_id ? parseInt(product_id, 10) : null
    });
    res.json(affiliations);
  });

  app.post('/api/affiliations/request', (req, res) => {
    const { affiliate_id, product_id, notes } = req.body;
    if (!affiliate_id || !product_id) {
      return res.status(400).json({ error: 'affiliate_id e product_id são obrigatórios.' });
    }
    try {
      const created = models.requestProductAffiliation({
        affiliate_id: parseInt(affiliate_id, 10),
        product_id: parseInt(product_id, 10),
        notes
      });
      res.json(created);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/affiliations/:id/approve', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { note } = req.body;
    const approved = models.approveProductAffiliation(id, 'ADMIN', note);
    res.json({ success: true, affiliation: approved });
  });

  app.post('/api/affiliations/:id/reject', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const rejected = models.rejectProductAffiliation(id, reason);
    res.json({ success: true, affiliation: rejected });
  });

  app.post('/api/affiliations/check-criteria', (req, res) => {
    const { affiliate_id } = req.body;
    const updated = models.checkAndActivateAffiliations(affiliate_id ? parseInt(affiliate_id, 10) : null);
    res.json({ success: true, updatedCount: updated.length, updated });
  });

  app.get('/api/affiliates/:id/criteria', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const criteria = models.evaluateAffiliateCriteria(id);
    if (!criteria) return res.status(404).json({ error: 'Afiliado não encontrado' });
    res.json(criteria);
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
  // EXPORTAÇÃO DE RELATÓRIOS (CSV UTF-8 BOM PARA EXCEL)
  // ==========================================
  function escapeCsv(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  app.get('/api/export/orders.csv', (req, res) => {
    const orders = models.getAllOrders(5000);
    const header = ['ID', 'Pedido', 'Data', 'Plataforma', 'Usuario', 'Produto', 'Gateway', 'Valor', 'Moeda', 'Status', 'Afiliado', 'Vendedor', 'Pago_Em'].map(escapeCsv).join(';');
    const lines = orders.map(o => [
      o.id,
      o.merchant_trade_no,
      o.created_at,
      o.platform,
      o.platform_user_name || o.platform_user_id,
      o.product_name,
      o.gateway,
      o.amount.toFixed(2),
      o.currency,
      o.status,
      o.affiliate_name || '',
      o.seller_name || '',
      o.paid_at || ''
    ].map(escapeCsv).join(';'));

    const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pedidos_paybot_${Date.now()}.csv"`);
    res.send(csvContent);
  });

  app.get('/api/export/commissions.csv', (req, res) => {
    const commissions = models.getAllCommissions(5000);
    const header = ['ID', 'Pedido', 'Data', 'Beneficiario', 'Tipo', 'Produto', 'Valor_Comissao', 'Moeda', 'Taxa_Percentual', 'Status', 'Destino_Pagamento', 'Pago_Em', 'Comprovante'].map(escapeCsv).join(';');
    const lines = commissions.map(c => [
      c.id,
      c.merchant_trade_no,
      c.created_at,
      c.beneficiary_name || '',
      c.beneficiary_type,
      c.product_name || '',
      c.amount.toFixed(2),
      c.currency,
      c.rate_percent,
      c.status,
      c.payment_destination || '',
      c.paid_at || '',
      c.payment_proof || ''
    ].map(escapeCsv).join(';'));

    const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comissoes_paybot_${Date.now()}.csv"`);
    res.send(csvContent);
  });

  app.get('/api/export/affiliates.csv', (req, res) => {
    const affiliates = models.getAffiliates(false);
    const header = ['ID', 'Nome', 'Codigo_Ref', 'Email', 'Telefone', 'Telegram', 'Comissao_Percentual', 'Saldo_BRL', 'Saldo_USDT', 'Total_Pago_BRL', 'Total_Pago_USDT', 'Chave_Pix', 'Carteira_USDT', 'Status', 'Data_Cadastro'].map(escapeCsv).join(';');
    const lines = affiliates.map(a => [
      a.id,
      a.name,
      a.ref_code,
      a.email || '',
      a.phone || '',
      a.telegram_username || '',
      a.commission_rate,
      (a.balance_brl || 0).toFixed(2),
      (a.balance_usdt || 0).toFixed(2),
      (a.total_paid_brl || 0).toFixed(2),
      (a.total_paid_usdt || 0).toFixed(2),
      a.pix_key || '',
      a.usdt_wallet || '',
      a.active ? 'Ativo' : 'Inativo',
      a.created_at
    ].map(escapeCsv).join(';'));

    const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="afiliados_paybot_${Date.now()}.csv"`);
    res.send(csvContent);
  });

  // ==========================================
  // CANAL DE ATUALIZAÇÕES & OFERTAS (OFFERS API)
  // ==========================================
  app.get('/api/offers', (req, res) => {
    const offers = models.getOffers(50);
    res.json(offers);
  });

  app.post('/api/offers/broadcast', async (req, res) => {
    try {
      const { title, content, image_url, product_id, cta_text, cta_url } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: 'Título e descrição da oferta são obrigatórios.' });
      }

      const offer = await updatesChannel.broadcastOffer({
        title,
        content,
        image_url,
        product_id,
        cta_text,
        cta_url
      });

      res.json({ success: true, offer });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // CUPONS DE DESCONTO (COUPONS API)
  // ==========================================
  app.get('/api/coupons', (req, res) => {
    const coupons = models.getCoupons(false);
    res.json(coupons);
  });

  app.post('/api/coupons', (req, res) => {
    const { code, discount_percent, discount_amount, max_uses, expires_at } = req.body;
    if (!code) return res.status(400).json({ error: 'Código do cupom é obrigatório.' });
    try {
      const coupon = models.createCoupon({ code, discount_percent, discount_amount, max_uses, expires_at });
      res.status(201).json(coupon);
    } catch (e) {
      res.status(400).json({ error: 'Código de cupom já existe ou é inválido.' });
    }
  });

  app.delete('/api/coupons/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    models.deleteCoupon(id);
    res.json({ success: true });
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
      TELEGRAM_UPDATES_CHANNEL_ID: current.TELEGRAM_UPDATES_CHANNEL_ID || '',
      AUTO_POST_TRANSACTIONS: current.AUTO_POST_TRANSACTIONS !== 'false',
      MASK_CUSTOMER_NAME: current.MASK_CUSTOMER_NAME !== 'false',

      // Recuperação de Carrinho & Upsell
      ABANDONED_CART_ENABLED: current.ABANDONED_CART_ENABLED !== 'false',
      ABANDONED_CART_DELAY_MIN: parseInt(current.ABANDONED_CART_DELAY_MIN || '15', 10),
      ABANDONED_CART_MESSAGE: current.ABANDONED_CART_MESSAGE || '👋 Olá, {name}! Notamos que seu pedido para *{product}* ainda está reservado.\n\nFicou com alguma dúvida para concluir seu pagamento? Garanta o seu antes que o link expire!\n\nClique no botão abaixo para pagar e receber seu acesso imediatamente:',
      UPSELL_ENABLED: current.UPSELL_ENABLED !== 'false',

      // Critérios de Afiliação por Produto & Fila de Espera
      AFFILIATION_MIN_SALES: parseInt(current.AFFILIATION_MIN_SALES || '2', 10),
      AFFILIATION_MIN_REVENUE_BRL: parseFloat(current.AFFILIATION_MIN_REVENUE_BRL || '50.0'),
      AFFILIATION_REQUIRE_PAYMENT_INFO: current.AFFILIATION_REQUIRE_PAYMENT_INFO !== 'false',
      AFFILIATION_AUTO_APPROVE: current.AFFILIATION_AUTO_APPROVE !== 'false',
      AFFILIATION_PRODUCT_RESTRICTED: current.AFFILIATION_PRODUCT_RESTRICTED === 'true',

      // Regras de Negócio & Equipe
      GLOBAL_AFFILIATE_RATE: Number(current.GLOBAL_AFFILIATE_RATE || 20.0),
      ROUND_ROBIN_SELLERS: current.ROUND_ROBIN_SELLERS !== 'false',
      NOTIFY_ADMIN_ON_SALE: current.NOTIFY_ADMIN_ON_SALE !== 'false',
      ADMIN_NOTIFY_TELEGRAM_ID: current.ADMIN_NOTIFY_TELEGRAM_ID || '',
      ADMIN_NOTIFY_WHATSAPP_PHONE: current.ADMIN_NOTIFY_WHATSAPP_PHONE || '',
      BOT_NAME: current.BOT_NAME || 'PayBot Vendas',
      WELCOME_MESSAGE: current.WELCOME_MESSAGE || '👋 Olá! Seja muito bem-vindo.',
      SUPPORT_CONTACT: current.SUPPORT_CONTACT || '@suporte',

      // Automações, Moderação de Grupos & Segurança Spy
      ANTILINK_DEFAULT: current.ANTILINK_DEFAULT === 'true',
      ANTIDELETE_DEFAULT: current.ANTIDELETE_DEFAULT !== 'false',
      ANTIFAKE_DEFAULT: current.ANTIFAKE_DEFAULT !== 'false',
      ANTIFLOOD_DEFAULT: current.ANTIFLOOD_DEFAULT !== 'false',
      ANTIVIEWONCE_DEFAULT: current.ANTIVIEWONCE_DEFAULT !== 'false',
      ANTIPRIVADO_GLOBAL: current.ANTIPRIVADO_GLOBAL === 'true',
      WELCOME_MSG_DEFAULT: current.WELCOME_MSG_DEFAULT || '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.',
      BYE_MSG_DEFAULT: current.BYE_MSG_DEFAULT || '👋 Até logo, {nome}! Foi ótimo ter você aqui no *{grupo}*.',
      AI_API_KEY: current.AI_API_KEY || '',
      OWNER_PHONE: current.OWNER_PHONE || '',

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
    if (body.TELEGRAM_UPDATES_CHANNEL_ID !== undefined) {
      models.setSetting('TELEGRAM_UPDATES_CHANNEL_ID', body.TELEGRAM_UPDATES_CHANNEL_ID.trim());
    }
    if (body.AUTO_POST_TRANSACTIONS !== undefined) {
      models.setSetting('AUTO_POST_TRANSACTIONS', String(body.AUTO_POST_TRANSACTIONS));
    }
    if (body.MASK_CUSTOMER_NAME !== undefined) {
      models.setSetting('MASK_CUSTOMER_NAME', String(body.MASK_CUSTOMER_NAME));
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

    // Recuperação de Carrinho & Upsell
    if (body.ABANDONED_CART_ENABLED !== undefined) {
      models.setSetting('ABANDONED_CART_ENABLED', String(body.ABANDONED_CART_ENABLED));
    }
    if (body.ABANDONED_CART_DELAY_MIN !== undefined) {
      models.setSetting('ABANDONED_CART_DELAY_MIN', String(body.ABANDONED_CART_DELAY_MIN));
    }
    if (body.ABANDONED_CART_MESSAGE !== undefined) {
      models.setSetting('ABANDONED_CART_MESSAGE', body.ABANDONED_CART_MESSAGE.trim());
    }
    if (body.UPSELL_ENABLED !== undefined) {
      models.setSetting('UPSELL_ENABLED', String(body.UPSELL_ENABLED));
    }

    // Critérios de Afiliação por Produto
    if (body.AFFILIATION_MIN_SALES !== undefined) {
      models.setSetting('AFFILIATION_MIN_SALES', String(body.AFFILIATION_MIN_SALES));
    }
    if (body.AFFILIATION_MIN_REVENUE_BRL !== undefined) {
      models.setSetting('AFFILIATION_MIN_REVENUE_BRL', String(body.AFFILIATION_MIN_REVENUE_BRL));
    }
    if (body.AFFILIATION_REQUIRE_PAYMENT_INFO !== undefined) {
      models.setSetting('AFFILIATION_REQUIRE_PAYMENT_INFO', String(body.AFFILIATION_REQUIRE_PAYMENT_INFO));
    }
    if (body.AFFILIATION_AUTO_APPROVE !== undefined) {
      models.setSetting('AFFILIATION_AUTO_APPROVE', String(body.AFFILIATION_AUTO_APPROVE));
    }
    if (body.AFFILIATION_PRODUCT_RESTRICTED !== undefined) {
      models.setSetting('AFFILIATION_PRODUCT_RESTRICTED', String(body.AFFILIATION_PRODUCT_RESTRICTED));
    }

    // URL Pública
    if (body.PUBLIC_URL !== undefined) {
      models.setSetting('PUBLIC_URL', body.PUBLIC_URL.trim().replace(/\/$/, ''));
    }

    // Automações, Moderação de Grupos & Segurança Spy
    if (body.ANTILINK_DEFAULT !== undefined) {
      models.setSetting('ANTILINK_DEFAULT', String(body.ANTILINK_DEFAULT));
    }
    if (body.ANTIDELETE_DEFAULT !== undefined) {
      models.setSetting('ANTIDELETE_DEFAULT', String(body.ANTIDELETE_DEFAULT));
    }
    if (body.ANTIFAKE_DEFAULT !== undefined) {
      models.setSetting('ANTIFAKE_DEFAULT', String(body.ANTIFAKE_DEFAULT));
    }
    if (body.ANTIFLOOD_DEFAULT !== undefined) {
      models.setSetting('ANTIFLOOD_DEFAULT', String(body.ANTIFLOOD_DEFAULT));
    }
    if (body.ANTIVIEWONCE_DEFAULT !== undefined) {
      models.setSetting('ANTIVIEWONCE_DEFAULT', String(body.ANTIVIEWONCE_DEFAULT));
    }
    if (body.ANTIPRIVADO_GLOBAL !== undefined) {
      models.setSetting('ANTIPRIVADO_GLOBAL', String(body.ANTIPRIVADO_GLOBAL));
    }
    if (body.WELCOME_MSG_DEFAULT !== undefined) {
      models.setSetting('WELCOME_MSG_DEFAULT', body.WELCOME_MSG_DEFAULT.trim());
    }
    if (body.BYE_MSG_DEFAULT !== undefined) {
      models.setSetting('BYE_MSG_DEFAULT', body.BYE_MSG_DEFAULT.trim());
    }
    if (body.AI_API_KEY !== undefined) {
      models.setSetting('AI_API_KEY', body.AI_API_KEY.trim());
    }
    if (body.OWNER_PHONE !== undefined) {
      models.setSetting('OWNER_PHONE', String(body.OWNER_PHONE).replace(/\D/g, ''));
    }

    res.json({ success: true, message: 'Todas as configurações foram salvas com sucesso!' });
  });

  // ==========================================
  // EXÉRCITO DE WHATSAPP & DIVULGAÇÃO DE AFILIADOS
  // ==========================================
  
  // 1. Instâncias / Chips do Exército
  app.get('/api/army/instances', (req, res) => {
    res.json(models.getArmyInstances());
  });

  app.post('/api/army/instances', (req, res) => {
    try {
      const { name, phone, daily_limit, warmup_mode } = req.body;
      if (!name) return res.status(400).json({ error: 'Nome do chip é obrigatório.' });
      const created = models.createArmyInstance({ name, phone, daily_limit, warmup_mode });
      res.json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/army/instances/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updated = models.updateArmyInstance(id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/army/instances/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      models.deleteArmyInstance(id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/army/instances/:id/qr', (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(whatsappArmyService.getInstanceQr(id));
  });

  app.post('/api/army/instances/:id/connect', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await whatsappArmyService.startInstance(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/instances/:id/disconnect', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await whatsappArmyService.stopInstance(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/instances/:id/pairing-code', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { phone } = req.body;
      const result = await whatsappArmyService.requestPairingCode(id, phone);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/army/instances/:id/reset', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await whatsappArmyService.resetInstanceSession(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Links de Afiliados
  app.get('/api/army/links', (req, res) => {
    res.json(models.getAffiliateLinks());
  });

  app.post('/api/army/links', (req, res) => {
    try {
      const created = models.createAffiliateLink(req.body);
      res.json(created);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/army/links/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updated = models.updateAffiliateLink(id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/army/links/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      models.deleteAffiliateLink(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Campanhas de Divulgação em Massa
  app.get('/api/army/campaigns', (req, res) => {
    res.json(models.getAffiliateCampaigns());
  });

  app.get('/api/army/campaigns/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = models.getAffiliateCampaignById(id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json(campaign);
  });

  app.post('/api/army/campaigns', (req, res) => {
    try {
      const campaign = models.createAffiliateCampaign(req.body);
      res.json(campaign);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/army/campaigns/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updated = models.updateAffiliateCampaign(id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/army/campaigns/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      models.deleteAffiliateCampaign(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/army/campaigns/:id/leads', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const status = req.query.status || null;
    res.json(models.getCampaignLeads(id, status));
  });

  app.post('/api/army/campaigns/:id/leads', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { leads } = req.body;
      const count = models.addCampaignLeads(id, leads || []);
      res.json({ success: true, addedCount: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/campaigns/:id/start', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await whatsappArmyService.startCampaign(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/campaigns/:id/pause', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = whatsappArmyService.pauseCampaign(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/army/customer-leads', (req, res) => {
    res.json(models.getPayBotCustomerLeads());
  });

  app.post('/api/army/spintax-preview', (req, res) => {
    const { template, lead, campaign } = req.body;
    const formatted = models.formatCampaignMessage(template || '', lead || {}, campaign || {});
    res.json({ preview: formatted });
  });

  // 4. Funil de Aquecimento Conversacional & Métricas em Tempo Real
  app.get('/api/army/funnel/stats', (req, res) => {
    res.json(models.getFunnelRealTimeStats());
  });

  app.get('/api/army/funnel/stages', (req, res) => {
    res.json(models.getFunnelStages());
  });

  app.put('/api/army/funnel/stages/:key', (req, res) => {
    try {
      const key = req.params.key;
      const updated = models.updateFunnelStage(key, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/army/funnel/leads', (req, res) => {
    const { stage, status, limit } = req.query;
    res.json(models.getLeadFunnelConversations({ stage, status, limit: limit ? parseInt(limit, 10) : 100 }));
  });

  app.get('/api/army/funnel/leads/:phone', (req, res) => {
    const phone = req.params.phone;
    const lead = models.getLeadFunnelConversationByPhone(phone);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado no funil' });
    const history = models.getFunnelInteractionLogs(phone);
    res.json({ lead, history });
  });

  app.post('/api/army/funnel/advance', (req, res) => {
    try {
      const { phone, targetStage } = req.body;
      const updated = models.advanceLeadFunnelStage(phone, targetStage);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/funnel/reply', async (req, res) => {
    try {
      const { phone, text, message, instance_id } = req.body;
      const messageText = text || message;
      if (!phone || !messageText) return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' });
      const instId = instance_id ? parseInt(instance_id, 10) : 1;
      const sent = await whatsappArmyService.sendArmyMessage(instId, phone, messageText);
      if (sent) {
        models.logFunnelInteraction({
          lead_phone: phone,
          instance_id: instId,
          direction: 'OUT',
          message_text: messageText
        });
      }
      res.json({ success: !!sent });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Divulgação em Massa do Dono e Controle Centralizado de Sub-Bots
  app.post('/api/army/broadcast', async (req, res) => {
    try {
      const { message, targets, targetType, specificInstanceId, vars } = req.body;
      const result = await whatsappArmyService.broadcastViaAllSubBots({
        message,
        targets,
        targetType: targetType || 'leads',
        specificInstanceId: specificInstanceId ? parseInt(specificInstanceId, 10) : null,
        vars: vars || {}
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/army/subbots/summary', (req, res) => {
    try {
      res.json(whatsappArmyService.getSubBotsStatusSummary());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/army/owner', (req, res) => {
    try {
      const ownerPhone = models.getSetting('OWNER_PHONE', process.env.OWNER_WHATSAPP || '');
      res.json({ owner_phone: ownerPhone });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/army/set-owner', (req, res) => {
    try {
      const { phone } = req.body;
      let clean = String(phone || '').replace(/\D/g, '');
      if (clean.length === 10 || clean.length === 11) clean = '55' + clean;
      if (!clean || clean.length < 10) {
        return res.status(400).json({ error: 'Informe um telefone válido com DDD (ex: 5511999998888).' });
      }
      models.setSetting('OWNER_PHONE', clean);
      res.json({ success: true, owner_phone: clean });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // LANÇAMENTO METEÓRICO & MULTI-GRUPOS AUTOMÁTICOS
  // ==========================================
  app.get('/api/meteoric/status', (req, res) => {
    try {
      res.json(meteoricService.getCampaignStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meteoric/config', (req, res) => {
    try {
      const updated = meteoricService.updateConfig(req.body);
      res.json({ success: true, campaign: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meteoric/toggle', (req, res) => {
    try {
      const updated = meteoricService.toggleCampaign(req.body?.active);
      res.json({ success: true, active: updated.active, campaign: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/meteoric/groups', (req, res) => {
    try {
      res.json(models.getMeteoricGroups());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meteoric/groups/create', async (req, res) => {
    try {
      const result = await meteoricService.createNewMeteoricGroup(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meteoric/groups/:id/mode', async (req, res) => {
    try {
      const group = models.getMeteoricGroupById(req.params.id);
      if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
      const mode = req.body?.mode || 'closed';
      const result = await meteoricService.setGroupMode(group.group_jid, mode);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/meteoric/stages', (req, res) => {
    try {
      res.json(models.getMeteoricStages());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/meteoric/stages/:stageNum', (req, res) => {
    try {
      const stageNum = parseInt(req.params.stageNum, 10);
      const updated = models.updateMeteoricStage(stageNum, req.body);
      res.json({ success: true, stage: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meteoric/warmup', async (req, res) => {
    try {
      const { stageNum, targetGroupJid, customText } = req.body || {};
      if (stageNum) {
        const report = await meteoricService.executeStageWarmup(parseInt(stageNum, 10), targetGroupJid);
        return res.json({ success: true, report });
      }
      if (customText) {
        const report = await meteoricService.executeInstantWarmup(targetGroupJid, customText);
        return res.json({ success: true, report });
      }
      res.status(400).json({ error: 'Informe stageNum ou customText para aquecimento' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk abrir / fechar todos os grupos do lançamento com 1 clique no painel
  app.post('/api/meteoric/groups/mode-all', async (req, res) => {
    try {
      const { mode } = req.body || {};
      const result = await meteoricService.setAllGroupsMode(mode || 'closed');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sincronizar contagem de membros em tempo real via Baileys sem mexer no celular
  app.post('/api/meteoric/groups/sync', async (req, res) => {
    try {
      const { groupJid } = req.body || {};
      const result = await meteoricService.syncGroupParticipants(groupJid);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Excluir ou arquivar grupo de teste do lançamento
  app.delete('/api/meteoric/groups/:id', (req, res) => {
    try {
      const success = meteoricService.deleteGroup(req.params.id);
      res.json({ success: !!success });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Enviar mensagem / comunicado web direta para grupos (como Matriz ou Sub-bot com suporte opcional a imagem)
  app.post('/api/meteoric/message', async (req, res) => {
    try {
      const { targetGroupJid, senderType, senderInstanceId, text, mediaUrl } = req.body || {};
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Texto da mensagem não pode ser vazio' });
      }
      const result = await meteoricService.sendMessageToGroups({
        targetGroupJid,
        senderType,
        senderInstanceId,
        text,
        mediaUrl
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Feed ao vivo de atividades e logs do lançamento meteórico
  app.get('/api/meteoric/activity-logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const logs = meteoricService.getActivityLogs(limit);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Limpar histórico de logs do feed
  app.delete('/api/meteoric/activity-logs', (req, res) => {
    try {
      meteoricService.clearActivityLogs();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 10.1 WHATSAPP GROUPS MANAGEMENT & LEADS EXPORT (ZERO CELULAR)
  // ==========================================
  app.get('/api/whatsapp/groups', async (req, res) => {
    try {
      const refresh = req.query.refresh === 'true';
      const groups = await whatsappBot.fetchAllGroups(refresh);
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/groups/:id/mode', async (req, res) => {
    try {
      const groupId = req.params.id;
      const mode = req.body?.mode || (req.body?.announce ? 'closed' : 'open');
      const isAnnounce = mode === 'closed' || mode === 'announcement';
      const result = await whatsappBot.setGroupAnnouncement(groupId, isAnnounce);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Exportar Leads de um Grupo WhatsApp específico em CSV
  app.get('/api/whatsapp/groups/:id/export-leads.csv', async (req, res) => {
    try {
      const groupId = req.params.id;
      let participants = await whatsappBot.getGroupParticipants(groupId);
      if (participants.length === 0) {
        participants = await meteoricService.getGroupLeads(groupId);
      }

      const header = ['Telefone', 'WhatsApp_JID', 'Papel_No_Grupo', 'Data_Exportacao'].map(escapeCsv).join(';');
      const nowStr = new Date().toISOString();
      const lines = participants.map(p => [
        p.phone || (p.id ? p.id.split('@')[0] : ''),
        p.id || '',
        p.admin || 'membro',
        nowStr
      ].map(escapeCsv).join(';'));

      const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
      const safeGid = groupId.replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="leads_${safeGid}.csv"`);
      res.send(csvContent);
    } catch (err) {
      res.status(500).send(`Erro ao gerar CSV: ${err.message}`);
    }
  });

  // Exportar Leads de um Grupo Meteórico específico em CSV
  app.get('/api/meteoric/groups/:id/export-leads.csv', async (req, res) => {
    try {
      const group = models.getMeteoricGroupById(req.params.id);
      if (!group) return res.status(404).send('Grupo não encontrado');

      const leads = await meteoricService.getGroupLeads(group.group_jid);
      const header = ['Telefone', 'WhatsApp_JID', 'Papel_No_Grupo', 'Grupo_ID', 'Grupo_Nome', 'Data_Exportacao'].map(escapeCsv).join(';');
      const nowStr = new Date().toISOString();
      const lines = leads.map(l => [
        l.phone || (l.id ? l.id.split('@')[0] : ''),
        l.id || '',
        l.admin || 'membro',
        group.id,
        group.title,
        nowStr
      ].map(escapeCsv).join(';'));

      const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="leads_meteoric_grupo_${group.group_num}.csv"`);
      res.send(csvContent);
    } catch (err) {
      res.status(500).send(`Erro ao gerar CSV: ${err.message}`);
    }
  });

  // Exportar Todos os Leads de Todos os Grupos do Lançamento Meteórico
  app.get('/api/meteoric/export-all-leads.csv', async (req, res) => {
    try {
      const campaign = models.getMeteoricCampaign();
      const groups = models.getMeteoricGroups(campaign.id);
      const allLeadsMap = new Map();

      for (const g of groups) {
        const leads = await meteoricService.getGroupLeads(g.group_jid);
        for (const lead of leads) {
          const ph = lead.phone || (lead.id ? lead.id.split('@')[0] : '');
          if (ph && !allLeadsMap.has(ph)) {
            allLeadsMap.set(ph, {
              phone: ph,
              jid: lead.id,
              admin: lead.admin,
              groupNum: g.group_num,
              groupTitle: g.title
            });
          }
        }
      }

      const header = ['Telefone', 'WhatsApp_JID', 'Papel_No_Grupo', 'Grupo_Origem', 'Campanha', 'Data_Exportacao'].map(escapeCsv).join(';');
      const nowStr = new Date().toISOString();
      const lines = Array.from(allLeadsMap.values()).map(l => [
        l.phone,
        l.jid,
        l.admin,
        `#${l.groupNum} - ${l.groupTitle}`,
        campaign.name,
        nowStr
      ].map(escapeCsv).join(';'));

      const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="todos_leads_meteoric_${Date.now()}.csv"`);
      res.send(csvContent);
    } catch (err) {
      res.status(500).send(`Erro ao gerar CSV consolidado: ${err.message}`);
    }
  });

  // Simulador e Injetor de Conversas de Sub-Bots (Visualização Web & Execução Live)
  app.post('/api/meteoric/simulate-dialogue', async (req, res) => {
    try {
      const result = await meteoricService.generateOrSimulateDialogue(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 11. REDES SOCIAIS (INSTAGRAM DIRECT & FACEBOOK MESSENGER)
  // ==========================================
  app.get('/api/social/accounts', (req, res) => {
    const { platform, status } = req.query;
    res.json(models.getSocialAccounts({ platform, status }));
  });

  app.post('/api/social/accounts', (req, res) => {
    try {
      const { platform, name, account_id, access_token, app_secret, auto_reply_enabled, assigned_company_id } = req.body;
      if (!platform || !name || !account_id) {
        return res.status(400).json({ error: 'Plataforma, nome de exibição e ID da conta são obrigatórios.' });
      }
      const created = models.createSocialAccount({
        platform,
        name,
        account_id,
        access_token,
        app_secret,
        auto_reply_enabled,
        assigned_company_id
      });
      res.json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/social/accounts/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updated = models.updateSocialAccount(id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/social/accounts/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      models.deleteSocialAccount(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/social/stats', (req, res) => {
    res.json(models.getSocialStats());
  });

  app.get('/api/social/messages', (req, res) => {
    const accountId = req.query.account_id ? parseInt(req.query.account_id, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    res.json(models.getSocialMessagesLog({ account_id: accountId, limit }));
  });

  app.post('/api/social/simulate', async (req, res) => {
    try {
      const { accountId, platform, senderId, senderName, text } = req.body;
      if (!text) return res.status(400).json({ error: 'Texto da mensagem é obrigatório.' });

      const result = await socialMediaService.handleIncomingMessage({
        platform: platform || 'instagram',
        accountId: accountId ? parseInt(accountId, 10) : null,
        senderId: senderId || `user_${Date.now().toString().slice(-6)}`,
        senderName: senderName || 'Lead Social Teste',
        text
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Meta Webhook Verification (Instagram & Facebook Messenger)
  app.get('/api/social/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const responseChallenge = socialMediaService.verifyWebhook(mode, token, challenge);
    if (responseChallenge) {
      console.log('✅ [Meta Webhook] Verificação do webhook aprovada com sucesso!');
      return res.status(200).send(responseChallenge);
    }
    res.status(403).send('Forbidden');
  });

  // Meta Webhook Ingestion (Instagram Direct & Facebook Messenger)
  app.post('/api/social/webhook', async (req, res) => {
    try {
      // Retorna 200 OK imediatamente para a Meta não reenviar
      res.status(200).send('EVENT_RECEIVED');
      await socialMediaService.processWebhookPayload(req.body);
    } catch (err) {
      console.error('[Meta Webhook Error]:', err.message);
    }
  });

  // ==========================================
  // 12. RADAR VIRAL & CRIADOR DE POSTS (@ INSTA & FACEBOOK)
  // ==========================================
  const viralRadarService = require('../services/viralRadarService');

  // Métricas do Radar Viral
  app.get('/api/viral/stats', (req, res) => {
    try {
      res.json(models.getViralStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Listar Perfis Rastreados
  app.get('/api/viral/profiles', (req, res) => {
    try {
      const { platform, auto_scrape } = req.query;
      res.json(models.getViralProfiles({ platform, auto_scrape }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cadastrar Novo Perfil (@ insta ou facebook)
  app.post('/api/viral/profiles', async (req, res) => {
    try {
      const { platform, username, niche, notes } = req.body;
      if (!username) return res.status(400).json({ error: 'Informe o @ do perfil' });
      const profile = await viralRadarService.addTrackedProfile({ platform, username, niche, notes });
      res.status(201).json(profile);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Excluir Perfil Rastreado
  app.delete('/api/viral/profiles/:id', (req, res) => {
    try {
      models.deleteViralProfile(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Forçar Varredura de um Perfil Específico
  app.post('/api/viral/profiles/:id/scrape', async (req, res) => {
    try {
      const result = await viralRadarService.scrapeProfile(parseInt(req.params.id, 10));
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Varredura Geral de Todos os Perfis Rastreados
  app.post('/api/viral/scrape-all', async (req, res) => {
    try {
      const results = await viralRadarService.scrapeAllProfiles();
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Listar Conteúdos Virais Capturados
  app.get('/api/viral/posts', (req, res) => {
    try {
      const { platform, profile_id, min_score, status, limit } = req.query;
      res.json(models.getViralCapturedPosts({ platform, profile_id, min_score, status, limit }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Detalhe de um Post Viral Capturado
  app.get('/api/viral/posts/:id', (req, res) => {
    try {
      const post = models.getViralCapturedPostById(parseInt(req.params.id, 10));
      if (!post) return res.status(404).json({ error: 'Post não encontrado' });
      res.json(post);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Excluir Post Viral
  app.delete('/api/viral/posts/:id', (req, res) => {
    try {
      models.deleteViralCapturedPost(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Gerar Nosso Post com Base em um Post Viral
  app.post('/api/viral/generate', async (req, res) => {
    try {
      const { viralPostId, targetPlatform, tone, objective, productId, customInstructions } = req.body;
      if (!viralPostId) return res.status(400).json({ error: 'Informe o ID do post viral de referência' });
      const result = await viralRadarService.generateOurPost({
        viralPostId: parseInt(viralPostId, 10),
        targetPlatform,
        tone,
        objective,
        productId,
        customInstructions
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Listar Nossos Posts Gerados
  app.get('/api/viral/generated', (req, res) => {
    try {
      const { status, profile_id, limit } = req.query;
      res.json(models.getViralGeneratedPosts({ status, profile_id, limit }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Excluir Post Gerado
  app.delete('/api/viral/generated/:id', (req, res) => {
    try {
      models.deleteViralGeneratedPost(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Disparar Post Gerado via WhatsApp Sub-Bots ou Telegram VIP
  app.post('/api/viral/generated/:id/broadcast', async (req, res) => {
    try {
      const { channel, targets } = req.body || {};
      const result = await viralRadarService.broadcastGeneratedPost(parseInt(req.params.id, 10), { channel, targets });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // NLP / NLU EM PORTUGUÊS BRASILEIRO (ANÁLISE & DIAGNÓSTICO)
  // ==========================================
  app.post('/api/nlp/analyze', async (req, res) => {
    try {
      const { text, customerName, platform } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'O texto para análise é obrigatório.' });
      }
      const result = await nlpService.processMessage({
        text,
        customerName: customerName || 'Cliente',
        platform: platform || 'whatsapp'
      });
      res.json(result);
    } catch (err) {
      console.error('[API NLP Error]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/nlp/info', (req, res) => {
    try {
      res.json({
        dictionary: nlpService.getDictionary(),
        intents: nlpService.getIntents()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // CONTROLE DE MODERAÇÃO (MUTE & BLOQUEIOS)
  // ==========================================
  app.get('/api/controls', (req, res) => {
    try {
      const activeOnly = req.query.active !== 'false';
      const platform = req.query.platform || null;
      res.json(models.getChatControls({ platform, activeOnly }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/controls/mute', (req, res) => {
    try {
      const { platform, chatId, targetType, reason, userName } = req.body;
      if (!platform || !chatId) {
        return res.status(400).json({ error: 'Plataforma e Chat ID são obrigatórios.' });
      }
      const result = models.muteChat({
        platform,
        chatId,
        targetType: targetType || 'PRIVATE',
        reason: reason || 'Mute via painel admin',
        createdBy: 'admin_dashboard',
        userName: userName || null
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/controls/unmute', (req, res) => {
    try {
      const { platform, chatId } = req.body;
      if (!platform || !chatId) {
        return res.status(400).json({ error: 'Plataforma e Chat ID são obrigatórios.' });
      }
      const result = models.unmuteChat(platform, chatId);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/controls/block', (req, res) => {
    try {
      const { platform, userId, chatId, targetType, reason, userName } = req.body;
      if (!platform || !userId) {
        return res.status(400).json({ error: 'Plataforma e ID do Usuário são obrigatórios.' });
      }
      const result = models.blockUser({
        platform,
        userId,
        chatId: chatId || null,
        targetType: targetType || 'USER',
        reason: reason || 'Bloqueio via painel admin',
        createdBy: 'admin_dashboard',
        userName: userName || null
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/controls/unblock', (req, res) => {
    try {
      const { platform, userId, chatId } = req.body;
      if (!platform || !userId) {
        return res.status(400).json({ error: 'Plataforma e ID do Usuário são obrigatórios.' });
      }
      const result = models.unblockUser(platform, userId, chatId || null);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/controls/:id', (req, res) => {
    try {
      const result = models.deleteChatControl(req.params.id);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // GESTÃO DE GRUPOS & AUDITORIA (REST API)
  // ==========================================
  app.get('/api/groups/audit-logs', (req, res) => {
    try {
      const { platform, groupId, limit, offset } = req.query;
      const logs = models.getGroupAdminAuditLogs({
        platform: platform || null,
        groupId: groupId || null,
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0
      });
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/groups/audit-logs', (req, res) => {
    try {
      const groupId = req.query.groupId || req.body?.groupId || null;
      const result = models.clearGroupAdminAuditLogs({ groupId });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/groups/:groupId/settings', (req, res) => {
    try {
      const platform = req.query.platform || 'whatsapp';
      const settings = models.getGroupSettings(platform, req.params.groupId);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/groups/:groupId/settings', (req, res) => {
    try {
      const platform = req.body?.platform || 'whatsapp';
      const { antilink, welcome, welcomeMsg, antifake, antiviewonce, antidelete, bye, byeMsg } = req.body;
      const updated = models.updateGroupSettings(platform, req.params.groupId, {
        antilink,
        welcome,
        welcomeMsg,
        antifake,
        antiviewonce,
        antidelete,
        bye,
        byeMsg
      });

      models.logGroupAdminAction({
        platform,
        groupId: req.params.groupId,
        adminId: 'web_dashboard',
        adminName: 'Painel Web Admin',
        action: 'WEB_CONFIG_UPDATE',
        details: `Configurações atualizadas: antilink=${antilink}, welcome=${welcome}, antifake=${antifake}, antidelete=${antidelete}`
      });

      res.json({ success: true, ...updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // TRIGGERS INTELIGENTES & FAQ (REST API)
  // ==========================================
  app.get('/api/triggers', (req, res) => {
    try {
      const activeOnly = req.query.active === 'true';
      const platform = req.query.platform || null;
      res.json(models.getCustomTriggers({ activeOnly, platform }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/triggers', (req, res) => {
    try {
      const { keyword, matchType, responseText, category, platform, active } = req.body;
      const trigger = models.createCustomTrigger({
        keyword,
        matchType,
        responseText,
        category,
        platform,
        active
      });
      res.status(201).json(trigger);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/triggers/:id', (req, res) => {
    try {
      const updated = models.updateCustomTrigger(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Trigger não encontrado.' });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/triggers/:id', (req, res) => {
    try {
      const result = models.deleteCustomTrigger(req.params.id);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ATENDIMENTO & TICKETS DE SUPORTE (REST API)
  // ==========================================
  app.get('/api/tickets', (req, res) => {
    try {
      const { status, platform, sellerId, limit } = req.query;
      const tickets = models.getSupportTickets({
        status: status || null,
        platform: platform || null,
        sellerId: sellerId ? parseInt(sellerId, 10) : null,
        limit: limit ? parseInt(limit, 10) : 50
      });
      res.json(tickets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tickets/:id', (req, res) => {
    try {
      const ticket = models.getSupportTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
      res.json(ticket);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tickets', (req, res) => {
    try {
      const { platform, customerId, customerName, issueSummary, priority, sellerId } = req.body;
      const ticket = models.createSupportTicket({
        platform,
        customerId,
        customerName,
        issueSummary,
        priority,
        sellerId
      });
      res.status(201).json(ticket);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/tickets/:id/status', (req, res) => {
    try {
      const { status } = req.body;
      const updated = models.updateSupportTicketStatus(req.params.id, status);
      res.json({ success: true, ...updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/tickets/:id/assign', (req, res) => {
    try {
      const { sellerId } = req.body;
      const updated = models.assignSupportTicket(req.params.id, sellerId);
      res.json({ success: true, ...updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ==========================================
  // MÉTRICAS DETALHADAS POR CANAL / PLATAFORMA
  // ==========================================
  app.get('/api/metrics/channels', (req, res) => {
    try {
      res.json(models.getChannelMetrics());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // FACILIDADES DE USO: BUSCA GLOBAL & AÇÕES RÁPIDAS
  // ==========================================
  app.get('/api/search', (req, res) => {
    try {
      const q = (req.query.q || '').trim().toLowerCase();
      if (!q) return res.json({ orders: [], products: [], sellers: [], affiliates: [], tickets: [] });

      const orders = db.prepare(`
        SELECT o.id, o.merchant_trade_no as trade_no, p.name as product_name, o.amount, o.currency, o.status, o.platform, o.platform_user_name, o.created_at
        FROM orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE LOWER(o.merchant_trade_no) LIKE '%' || ? || '%' 
           OR LOWER(p.name) LIKE '%' || ? || '%' 
           OR LOWER(o.platform_user_name) LIKE '%' || ? || '%'
           OR LOWER(o.platform_user_id) LIKE '%' || ? || '%'
        ORDER BY o.id DESC LIMIT 5
      `).all(q, q, q, q);

      const products = db.prepare(`
        SELECT id, name, category, price_brl, price_usdt, active
        FROM products
        WHERE LOWER(name) LIKE '%' || ? || '%' OR LOWER(category) LIKE '%' || ? || '%'
        ORDER BY id DESC LIMIT 5
      `).all(q, q);

      const sellers = db.prepare(`
        SELECT id, name, phone, email, active
        FROM sellers
        WHERE LOWER(name) LIKE '%' || ? || '%' OR phone LIKE '%' || ? || '%'
        ORDER BY id DESC LIMIT 5
      `).all(q, q);

      const affiliates = db.prepare(`
        SELECT id, name, ref_code, phone, active
        FROM affiliates
        WHERE LOWER(name) LIKE '%' || ? || '%' OR LOWER(ref_code) LIKE '%' || ? || '%'
        ORDER BY id DESC LIMIT 5
      `).all(q, q);

      const tickets = db.prepare(`
        SELECT id, platform, customer_name, customer_id, issue_summary, status
        FROM support_tickets
        WHERE LOWER(customer_name) LIKE '%' || ? || '%' OR customer_id LIKE '%' || ? || '%' OR LOWER(issue_summary) LIKE '%' || ? || '%'
        ORDER BY id DESC LIMIT 5
      `).all(q, q, q);

      res.json({ orders, products, sellers, affiliates, tickets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/quick-charge', async (req, res) => {
    try {
      const { productId, gateway = 'pix', customerName = 'Cliente Rápido', customerId = 'admin_quick' } = req.body;
      const product = models.getProductById(productId);
      if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

      const tradeNo = `ORD_QUICK_${Date.now()}`;
      const amount = gateway === 'pix' ? (product.price_brl || product.price) : (product.price_usdt || (product.price / 5.5));

      let pixCode = null;
      let qrContent = null;
      let checkoutUrl = null;

      if (gateway === 'pix') {
        const pixRes = await pixPayment.createPixCharge({
          merchantTradeNo: tradeNo,
          amount,
          goodsName: product.name,
          payerName: customerName
        });
        pixCode = pixRes.data?.pixCode || pixRes.pixCode;
        qrContent = pixRes.data?.qrCodeBase64 || pixRes.data?.checkoutUrl || pixRes.qrContent;
        checkoutUrl = pixRes.data?.checkoutUrl || pixRes.checkoutUrl;
      } else {
        const binRes = await binancePay.createOrder({
          merchantTradeNo: tradeNo,
          amount,
          currency: 'USDT',
          goodsName: product.name,
          goodsDetail: product.description
        });
        checkoutUrl = binRes.data?.checkoutUrl || binRes.data?.universalUrl || binRes.checkoutUrl || binRes.universalUrl;
        qrContent = binRes.data?.qrContent || binRes.data?.qrcodeLink || binRes.qrContent;
      }

      models.createOrder({
        merchant_trade_no: tradeNo,
        product_id: product.id,
        product_name: product.name,
        platform: 'whatsapp',
        platform_user_id: customerId,
        platform_user_name: customerName,
        gateway,
        amount,
        currency: gateway === 'pix' ? 'BRL' : 'USDT',
        status: 'PENDING',
        pix_code: pixCode,
        qr_content: qrContent,
        checkout_url: checkoutUrl
      });

      res.json({
        success: true,
        tradeNo,
        amount,
        currency: gateway === 'pix' ? 'BRL' : 'USDT',
        productName: product.name,
        pixCode,
        qrContent,
        checkoutUrl
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/quick-message', async (req, res) => {
    try {
      const { phone, message } = req.body;
      if (!phone || !message) return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios.' });

      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const parsedText = whatsappArmyService.parseSpintax(message, { name: 'Cliente' });

      if (whatsappBot.isConnected) {
        await whatsappBot.sendMessage(`${cleanPhone}@s.whatsapp.net`, parsedText);
        return res.json({ success: true, sentVia: 'whatsapp_matrix', phone: cleanPhone, text: parsedText });
      }

      // Se matriz não conectada, envia através do serviço do exército (simulado ou chip)
      await whatsappArmyService.sendArmyMessage(1, cleanPhone, parsedText);
      res.json({ success: true, sentVia: 'whatsapp_army', phone: cleanPhone, text: parsedText });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // E-COMMERCE STOREFRONT & CHECKOUT (SPY TECH SOLUTIONS)
  // ==========================================
  app.get(['/loja', '/catalogo', '/vitrine', '/store'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'store.html'));
  });

  app.get('/api/store/products', (req, res) => {
    try {
      const { category, search, subbot } = req.query;
      let products;
      let categories = ['Todos'];

      if (subbot) {
        const subbotId = Number(subbot);
        products = models.getSubBotProducts(subbotId);
        if (category && category !== 'Todos') {
          products = products.filter(p => p.category === category);
        }
        if (search && search.trim()) {
          const s = search.toLowerCase();
          products = products.filter(p =>
            (p.name && p.name.toLowerCase().includes(s)) ||
            (p.description && p.description.toLowerCase().includes(s)) ||
            (p.category && p.category.toLowerCase().includes(s))
          );
        }
        const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
        categories = ['Todos', ...cats];
      } else {
        products = models.getStoreProducts(category, search);
        categories = ['Todos', ...models.getCategories()];
      }
      res.json({ success: true, products, categories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/store/coupon', (req, res) => {
    try {
      const { code, amount } = req.body;
      if (!code) return res.status(400).json({ error: 'Código de cupom obrigatório.' });

      const coupon = models.getCouponByCode(code);
      if (!coupon) return res.status(404).json({ error: 'Cupom inválido ou não encontrado.' });
      if (!coupon.active) return res.status(400).json({ error: 'Este cupom está desativado.' });
      if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
        return res.status(400).json({ error: 'Este cupom atingiu o limite máximo de utilizações.' });
      }

      const total = Number(amount || 0);
      let discount = 0;
      const isPercent = Boolean((coupon.discount_percent && coupon.discount_percent > 0) || coupon.discount_type === 'percent');
      const discountVal = Number(coupon.discount_percent || coupon.discount_amount || coupon.discount_value || 0);

      if (isPercent) {
        discount = (total * (discountVal / 100));
      } else {
        discount = Math.min(total, discountVal);
      }
      discount = Math.round(discount * 100) / 100;
      const finalAmount = Math.max(0, Math.round((total - discount) * 100) / 100);

      res.json({
        success: true,
        valid: true,
        code: coupon.code,
        discountType: isPercent ? 'percent' : 'fixed',
        discountValue: discountVal,
        discountAmount: discount,
        finalAmount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Telemetria da Vitrine Web
  app.post('/api/store/track', async (req, res) => {
    try {
      const webStoreTrackerService = require('../services/webStoreTrackerService');
      const result = await webStoreTrackerService.trackEvent(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/telemetry', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const phone = req.query.phone || null;
      const events = models.getStoreTelemetry(limit, phone);
      res.json({ success: true, events });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/cart-sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const status = req.query.status || null;
      const sessions = models.listCartSessions(limit, status);
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/cart-sessions/abandoned', (req, res) => {
    try {
      const minutes = parseInt(req.query.minutes, 10) || 30;
      const sessions = models.getAbandonedCartSessions(minutes);
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoints do Motor de Social Listening (Grupos & Afiliados)
  app.get('/api/social-listening/rules', (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === 'true';
      const rules = models.listSocialListeningRules(activeOnly);
      res.json({ success: true, rules });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/social-listening/rules', (req, res) => {
    try {
      const rule = models.saveSocialListeningRule(req.body);
      res.json({ success: true, rule });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/social-listening/rules/:id', (req, res) => {
    try {
      const deleted = models.deleteSocialListeningRule(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/social-listening/toggle', (req, res) => {
    try {
      const current = models.getSetting('SOCIAL_LISTENING_ENABLED', 'true') === 'true';
      const nextVal = req.body.enabled !== undefined ? Boolean(req.body.enabled) : !current;
      models.setSetting('SOCIAL_LISTENING_ENABLED', String(nextVal));
      res.json({ success: true, enabled: nextVal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/store/checkout', async (req, res) => {
    try {
      const { items = [], customer = {}, gateway = 'pix', couponCode = null, subbot = null } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'O carrinho está vazio.' });
      }

      const customerName = customer.name ? customer.name.trim() : 'Cliente Web';
      const customerPhone = customer.phone ? customer.phone.replace(/\D/g, '') : '';
      const customerAddress = customer.address || '';
      const notes = customer.notes || '';

      let subtotalBRL = 0;
      let subtotalUSDT = 0;
      const verifiedItems = [];

      for (const it of items) {
        const prod = models.getProductById(it.id);
        if (!prod) continue;
        const qty = Math.max(1, Number(it.quantity || 1));
        const priceBRL = Number(prod.price_brl || prod.price);
        const priceUSDT = Number(prod.price_usdt || (priceBRL / 5.5).toFixed(2));
        subtotalBRL += priceBRL * qty;
        subtotalUSDT += priceUSDT * qty;
        verifiedItems.push({
          id: prod.id,
          name: prod.name,
          category: prod.category || 'Geral',
          quantity: qty,
          unitPriceBRL: priceBRL,
          unitPriceUSDT: priceUSDT,
          totalBRL: priceBRL * qty,
          totalUSDT: priceUSDT * qty
        });
      }

      if (verifiedItems.length === 0) {
        return res.status(400).json({ error: 'Nenhum produto válido encontrado no carrinho.' });
      }

      let discountBRL = 0;
      if (couponCode) {
        const coupon = models.getCouponByCode(couponCode);
        if (coupon && coupon.active && (coupon.max_uses === 0 || coupon.used_count < coupon.max_uses)) {
          const isPercent = Boolean((coupon.discount_percent && coupon.discount_percent > 0) || coupon.discount_type === 'percent');
          const discountVal = Number(coupon.discount_percent || coupon.discount_amount || coupon.discount_value || 0);
          if (isPercent) {
            discountBRL = subtotalBRL * (discountVal / 100);
          } else {
            discountBRL = Math.min(subtotalBRL, discountVal);
          }
          if (typeof models.useCoupon === 'function') {
            models.useCoupon(coupon.code);
          }
        }
      }

      const finalBRL = Math.max(0.50, Math.round((subtotalBRL - discountBRL) * 100) / 100);
      const finalUSDT = Math.max(0.10, Math.round((finalBRL / 5.5) * 100) / 100);

      const tradeNo = `ORD_WEB_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const mainProd = verifiedItems[0];

      let pixCode = null;
      let qrContent = null;
      let checkoutUrl = null;

      if (gateway === 'pix') {
        const pixRes = await pixPayment.createPixCharge({
          merchantTradeNo: tradeNo,
          amount: finalBRL,
          goodsName: `Pedido Loja Web: ${verifiedItems.map(i => i.name).join(', ').slice(0, 80)}`,
          payerName: customerName
        });
        pixCode = pixRes.data?.pixCode || pixRes.pixCode || pixRes.data?.emv || pixRes.emv;
        qrContent = pixRes.data?.qrCodeBase64 || pixRes.data?.checkoutUrl || pixRes.qrContent;
        checkoutUrl = pixRes.data?.checkoutUrl || pixRes.checkoutUrl;
      } else if (gateway === 'binancepay') {
        const binRes = await binancePay.createOrder({
          merchantTradeNo: tradeNo,
          amount: finalUSDT,
          currency: 'USDT',
          goodsName: `Pedido Loja Web (${verifiedItems.length} itens)`,
          goodsDetail: verifiedItems.map(i => `${i.quantity}x ${i.name}`).join(', ').slice(0, 200)
        });
        checkoutUrl = binRes.data?.checkoutUrl || binRes.data?.universalUrl || binRes.checkoutUrl || binRes.universalUrl;
        qrContent = binRes.data?.qrContent || binRes.data?.qrcodeLink || binRes.qrContent;
      }

      const webStoreTrackerService = require('../services/webStoreTrackerService');
      let sellerId = mainProd.seller_id || null;
      let targetPhone = webStoreTrackerService.getBotContactPhone(subbot);
      if (subbot) {
        const subInstance = models.getArmyInstanceById(Number(subbot));
        if (subInstance) {
          sellerId = subInstance.id;
          if (subInstance.phone) {
            targetPhone = subInstance.phone;
          }
        }
      }

      const order = models.createOrder({
        merchant_trade_no: tradeNo,
        product_id: mainProd.id,
        platform: 'whatsapp',
        platform_user_id: customerPhone || 'web_guest',
        platform_user_name: customerName,
        gateway,
        amount: gateway === 'pix' ? finalBRL : finalUSDT,
        currency: gateway === 'pix' ? 'BRL' : 'USDT',
        status: 'PENDING',
        pix_code: pixCode,
        qr_content: qrContent,
        checkout_url: checkoutUrl,
        coupon_code: couponCode,
        discount_amount: discountBRL,
        seller_id: sellerId
      });

      // Atualiza / Registra sessão do carrinho como pedido realizado
      if (req.body.session_id) {
        try {
          models.saveCartSession({
            session_id: req.body.session_id,
            phone: customerPhone,
            customer_name: customerName,
            cart_items: JSON.stringify(verifiedItems),
            cart_total: finalBRL,
            status: 'ORDER_PLACED'
          });
        } catch (_) {}
      }

      // Dispara confirmação automática via WhatsApp para o cliente e alerta para o dono
      try {
        webStoreTrackerService.notifyOrderPlaced({
          tradeNo,
          customerName,
          customerPhone,
          items: verifiedItems,
          finalBRL,
          gateway,
          pixCode
        }).catch(() => {});
      } catch (_) {}

      let itemsListText = verifiedItems.map(i => `• ${i.quantity}x *${i.name}* (R$ ${i.totalBRL.toFixed(2)})`).join('\n');
      let waMessage = 
        `🛒 *NOVO PEDIDO DA VITRINE WEB (#${tradeNo})*\n\n` +
        `👤 *Cliente:* ${customerName}\n` +
        `📱 *WhatsApp:* +${customerPhone || 'Não informado'}\n` +
        (customerAddress ? `📍 *Entrega:* ${customerAddress}\n` : '') +
        (notes ? `📝 *Observação:* ${notes}\n` : '') +
        `\n📦 *Itens do Pedido:*\n${itemsListText}\n\n` +
        `💰 *Subtotal:* R$ ${subtotalBRL.toFixed(2)}\n` +
        (discountBRL > 0 ? `🎟️ *Desconto Cupom (${couponCode}):* -R$ ${discountBRL.toFixed(2)}\n` : '') +
        `💳 *Total a Pagar:* *R$ ${finalBRL.toFixed(2)}* (${finalUSDT.toFixed(2)} USDT)\n` +
        `⚡ *Forma de Pagamento:* ${gateway.toUpperCase()}\n\n` +
        (pixCode ? `🔑 *PIX Copia e Cola:* \`${pixCode}\`\n\n` : '') +
        `_Aguardando confirmação do pagamento pelo sistema automático._`;

      const botPhone = String(targetPhone).replace(/\D/g, '');
      const waUrl = `https://wa.me/${botPhone}?text=${encodeURIComponent(waMessage)}`;

      res.json({
        success: true,
        tradeNo,
        orderId: order?.id,
        subtotalBRL,
        discountBRL,
        finalBRL,
        finalUSDT,
        items: verifiedItems,
        pixCode,
        qrContent,
        checkoutUrl,
        whatsappMessage: waMessage,
        whatsappUrl: waUrl
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // CENTRAL DE AVISOS & ALERTA INTER-PC (SISTEMAS_AVISOS_PC)
  // ==========================================
  app.get('/api/notices', (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      const status = req.query.status || null;
      const notices = models.getNotices(limit, status);
      res.json({ success: true, notices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/notices', async (req, res) => {
    try {
      const { title, message, category = 'info', color = '#2196f3', sender = 'Admin', target = 'all', sound_alert = 1, broadcast_whatsapp = false } = req.body;
      if (!title || !message) {
        return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
      }

      const notice = models.createNotice({ title, message, category, color, sender, target, sound_alert });

      if (broadcast_whatsapp && whatsappBot.isConnected) {
        const icon = category === 'urgente' ? '🚨' : (category === 'emergencia' ? '🔥' : (category === 'alerta' ? '⚠️' : (category === 'sucesso' ? '✅' : '📢')));
        const noticeBroadcast = 
          `${icon} *AVISO DA CENTRAL DE OPERAÇÕES* ${icon}\n\n` +
          `📌 *${title.toUpperCase()}*\n` +
          `📝 ${message}\n\n` +
          `👤 *Emitido por:* ${sender}\n` +
          `🕒 *Horário:* ${new Date().toLocaleTimeString('pt-BR')}\n` +
          `_Para confirmar recebimento, responda com !confirmaraviso ${notice.id}_`;

        if (target === 'meteoric' || target === 'all') {
          try {
            const meteoricGroups = models.getMeteoricGroups();
            for (const grp of meteoricGroups) {
              if (grp.group_jid) {
                await whatsappBot.sendMessage(grp.group_jid, noticeBroadcast).catch(() => {});
              }
            }
          } catch (_) {}
        }
      }

      res.json({ success: true, notice });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/notices/:id/respond', (req, res) => {
    try {
      const noticeId = Number(req.params.id);
      const { respondent = 'Operador', response_text } = req.body;
      if (!response_text) return res.status(400).json({ error: 'Texto de resposta obrigatório.' });

      const notice = models.getNoticeById(noticeId);
      if (!notice) return res.status(404).json({ error: 'Aviso não encontrado.' });

      const resp = models.addNoticeResponse(noticeId, respondent, response_text);
      res.json({ success: true, response: resp });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/notices/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      models.archiveNotice(id);
      res.json({ success: true, archived: id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 19. TÚNEL REMOTO CLOUDFLARE (ACESSO EXTERNO)
  // ==========================================
  app.get('/api/tunnel', (req, res) => {
    try {
      const tunnelService = require('../services/tunnelService');
      const url = tunnelService.getUrl();
      res.json({ success: true, url, active: !!url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tunnel/restart', async (req, res) => {
    try {
      const tunnelService = require('../services/tunnelService');
      const config = require('../config');
      const url = await tunnelService.restart(config.port);
      res.json({ success: true, url, active: !!url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // 20. CENTRAL DE COMANDO DA MATRIZ & DELEGAÇÃO DE SUB-BOTS
  // ==========================================
  app.get('/api/matriz/tasks', (req, res) => {
    try {
      const { limit, status, instanceId } = req.query;
      const tasks = models.getDelegatedTasks({ limit, status, instanceId });
      const summary = models.getDelegatedTasksSummary();
      res.json({ success: true, tasks, summary });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/matriz/status', (req, res) => {
    try {
      const whatsappArmyService = require('../services/whatsappArmyService');
      const armySummary = whatsappArmyService.getSubBotsStatusSummary();
      const tasksSummary = models.getDelegatedTasksSummary();
      const instances = models.getArmyInstances();
      res.json({ success: true, armySummary, tasksSummary, instances });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/matriz/delegate', async (req, res) => {
    try {
      const { type, instanceId, target, message, title, scheduled_at } = req.body;
      const whatsappArmyService = require('../services/whatsappArmyService');
      const matrizAssistantService = require('../services/matrizAssistantService');

      let taskType = type || 'DIRECT_MESSAGE';
      let taskTitle = title || `Tarefa Delegada via Painel Web`;
      let assignedInstanceId = instanceId ? Number(instanceId) : null;

      const isScheduled = scheduled_at && new Date(scheduled_at) > new Date();

      const task = models.createDelegatedTask({
        assigned_instance_id: assignedInstanceId,
        task_type: taskType,
        title: taskTitle,
        description: message || '',
        target: target || '',
        message_payload: message || '',
        delegated_by: 'WEB_OWNER',
        scheduled_at: scheduled_at || null
      });

      // Se for agendado para o futuro, mantém PENDING para o worker executar
      if (isScheduled) {
        return res.json({ success: true, task: models.getDelegatedTaskById(task.id) });
      }

      models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

      // Executa de acordo com o tipo
      if (taskType === 'DIRECT_MESSAGE' && target && assignedInstanceId) {
        const cleanPhone = String(target).replace(/\D/g, '');
        await whatsappArmyService.sendMessageViaInstance(assignedInstanceId, cleanPhone, message);
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Mensagem enviada com sucesso para +${cleanPhone} via Sub-Bot #${assignedInstanceId}`
        });
      } else if (taskType === 'VOICE_NOTE' && target && assignedInstanceId) {
        const cleanPhone = String(target).replace(/\D/g, '');
        await whatsappArmyService.sendVoiceViaInstance(assignedInstanceId, cleanPhone, message);
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Áudio PTT enviado com sucesso para +${cleanPhone} via Sub-Bot #${assignedInstanceId}`
        });
      } else if (taskType === 'SMART_LOAD_BALANCE') {
        const qty = parseInt(target, 10) || 50;
        await matrizAssistantService.delegateSmartBalancing({ sendMessage: async () => true }, null, qty, message);
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Balanceamento inteligente de ${qty} leads distribuído com sucesso.`
        });
      } else if (taskType === 'TAKEOVER_START' && target && assignedInstanceId) {
        const cleanPhone = String(target).replace(/\D/g, '');
        whatsappArmyService.setOwnerRelay(cleanPhone, assignedInstanceId, 'web_dashboard');
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Takeover iniciado para +${cleanPhone} no Sub-Bot #${assignedInstanceId}`
        });
      } else if (taskType === 'TAKEOVER_END' && target) {
        const cleanPhone = String(target).replace(/\D/g, '');
        whatsappArmyService.removeOwnerRelay(cleanPhone);
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Takeover encerrado para +${cleanPhone}`
        });
      } else if (taskType === 'BROADCAST_LEADS') {
        const bRes = await whatsappArmyService.broadcastViaAllSubBots({
          message,
          targetType: 'leads',
          specificInstanceId: assignedInstanceId
        });
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Disparado com sucesso para ${bRes.totalSent || 0} leads.`
        });
      } else if (taskType === 'BROADCAST_GROUPS') {
        const gRes = await whatsappArmyService.broadcastViaAllSubBots({
          message,
          targetType: 'groups'
        });
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Transmitido para ${gRes.totalSent || 0} grupos.`
        });
      } else {
        models.updateDelegatedTask(task.id, {
          status: 'COMPLETED',
          result_summary: `Missão registrada e alocada com sucesso.`
        });
      }

      const updatedTask = models.getDelegatedTaskById(task.id);
      res.json({ success: true, task: updatedTask });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS DO CRM COGNITIVO & VENDAS CONSULTIVAS HEXIS
  // ==========================================
  app.get('/api/cognitive/overview', (req, res) => {
    try {
      const data = models.getCognitiveLeadsOverview();
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/cognitive/leads/:phone', (req, res) => {
    try {
      const phone = req.params.phone;
      const profile = models.getLeadCognitiveProfile(phone);
      if (!profile) return res.status(404).json({ error: 'Lead não encontrado.' });
      res.json({ success: true, profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cognitive/leads/:phone', (req, res) => {
    try {
      const phone = req.params.phone;
      const updated = models.upsertLeadCognitiveProfile(phone, req.body);
      res.json({ success: true, profile: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cognitive/leads/:phone/belief', (req, res) => {
    try {
      const phone = req.params.phone;
      const { key, value, evidence, confidence } = req.body;
      if (!key || !value) return res.status(400).json({ error: 'key e value são obrigatórios.' });
      const beliefs = models.updateLeadBelief(phone, key, value, evidence || '', confidence || 0.8);
      res.json({ success: true, beliefs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cognitive/leads/:phone/memory', (req, res) => {
    try {
      const phone = req.params.phone;
      const { type, summary, excerpt, importance } = req.body;
      if (!summary) return res.status(400).json({ error: 'summary é obrigatório.' });
      const mem = models.addLeadEpisodicMemory(phone, type || 'REQUIREMENT', summary, excerpt || '', importance || 3);
      res.json({ success: true, memory: mem });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cognitive/leads/:phone/hook', async (req, res) => {
    try {
      const phone = req.params.phone;
      const cognitiveService = require('../services/cognitiveSalesService');
      const profile = models.getLeadCognitiveProfile(phone);
      if (!profile) return res.status(404).json({ error: 'Lead não encontrado.' });

      const hookReply = await cognitiveService.generateConsultativeReply({
        phone,
        name: profile.name,
        text: 'Por favor, gere um gancho de follow-up personalizado de alta atenção baseado no histórico.'
      });
      res.json({ success: true, hook: hookReply, profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cognitive/heartbeat', async (req, res) => {
    try {
      const { dryRun = false, limit = 20 } = req.body;
      const cognitiveService = require('../services/cognitiveSalesService');
      const result = await cognitiveService.runAutonomousHeartbeat({ dryRun: Boolean(dryRun), limit: Number(limit) });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/cognitive/leads/:phone', (req, res) => {
    try {
      const phone = req.params.phone;
      models.deleteCognitiveLead(phone);
      res.json({ success: true, message: `Lead +${phone} e histórico cognitivo excluídos.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS DE AGENDAMENTO DE REUNIÕES & DEMONSTRAÇÕES (GOOGLE MEET)
  // ==========================================
  app.get('/api/meetings', (req, res) => {
    try {
      const { lead_phone, status, date, upcomingOnly, limit } = req.query;
      const meetings = models.getMeetings({
        lead_phone,
        status,
        date,
        upcomingOnly: upcomingOnly === 'true' || upcomingOnly === '1',
        limit: limit ? Number(limit) : 50
      });
      res.json({ success: true, meetings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/meetings/slots', (req, res) => {
    try {
      const { date } = req.query;
      const slots = models.getAvailableMeetingSlots(date);
      res.json({ success: true, ...slots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/meetings/:id', (req, res) => {
    try {
      const meeting = models.getMeetingById(req.params.id);
      if (!meeting) return res.status(404).json({ error: 'Reunião não encontrada.' });
      res.json({ success: true, meeting });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meetings', (req, res) => {
    try {
      const meeting = models.createMeeting(req.body);
      res.json({ success: true, meeting });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/meetings/:id', (req, res) => {
    try {
      const updated = models.updateMeeting(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Reunião não encontrada.' });
      res.json({ success: true, meeting: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meetings/:id/cancel', (req, res) => {
    try {
      const updated = models.cancelMeeting(req.params.id, req.body?.reason || '');
      if (!updated) return res.status(404).json({ error: 'Reunião não encontrada.' });
      res.json({ success: true, meeting: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/meetings/:id/remind', async (req, res) => {
    try {
      const meetingService = require('../services/meetingService');
      const meeting = models.getMeetingById(req.params.id);
      if (!meeting) return res.status(404).json({ error: 'Reunião não encontrada.' });

      models.updateMeeting(meeting.id, { reminder_sent: 0 });
      const results = await meetingService.checkAndSendMeetingReminders();
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS DE PROPOSTAS COMERCIAIS & CONTRATOS (/proposta/:token)
  // ==========================================
  app.get('/api/proposals', (req, res) => {
    try {
      const { lead_phone, status, category, limit } = req.query;
      const proposals = models.getProposals({
        lead_phone,
        status,
        category,
        limit: limit ? Number(limit) : 50
      });
      res.json({ success: true, proposals });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/proposals/:id', (req, res) => {
    try {
      const proposal = models.getProposalById(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta não encontrada.' });
      res.json({ success: true, proposal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/proposals', (req, res) => {
    try {
      const proposalService = require('../services/proposalService');
      const { lead_phone, ...customData } = req.body;
      if (!lead_phone) return res.status(400).json({ error: 'Telefone do lead é obrigatório.' });
      const proposal = proposalService.generateProposal(lead_phone, customData);
      res.json({ success: true, proposal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/proposals/:id', (req, res) => {
    try {
      const updated = models.updateProposal(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Proposta não encontrada.' });
      res.json({ success: true, proposal: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/proposals/:id', (req, res) => {
    try {
      models.deleteProposal(req.params.id);
      res.json({ success: true, message: 'Proposta excluída com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/proposals/:id/send', async (req, res) => {
    try {
      const proposal = models.getProposalById(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta não encontrada.' });

      const proposalService = require('../services/proposalService');
      const fulfillment = require('../services/fulfillment');
      const tunnelService = require('../services/tunnelService');
      const baseUrl = tunnelService.getUrl() || `http://localhost:${process.env.PORT || 3000}`;

      const shareText = proposalService.generateWhatsAppShareMessage(proposal, baseUrl);

      if (fulfillment.sendWhatsAppMessage) {
        await fulfillment.sendWhatsAppMessage(`${proposal.lead_phone}@s.whatsapp.net`, shareText);
      }

      models.updateProposal(proposal.id, { status: 'SENT' });
      res.json({ success: true, message: `Proposta ${proposal.code} despachada para o WhatsApp +${proposal.lead_phone}!`, shareText });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Visualização Pública Interativa da Proposta
  app.get('/proposta/:token', (req, res) => {
    try {
      const token = req.params.token;
      const proposal = models.getProposalByToken(token);
      if (!proposal) {
        return res.status(404).send('<h1>Proposta não encontrada ou link expirado.</h1>');
      }
      models.incrementProposalViews(token, req.ip);
      const proposalService = require('../services/proposalService');
      const tunnelService = require('../services/tunnelService');
      const baseUrl = tunnelService.getUrl() || `http://localhost:${process.env.PORT || 3000}`;
      const html = proposalService.renderProposalHtml(proposal, baseUrl);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send(`Erro ao carregar proposta: ${err.message}`);
    }
  });

  // Aceite Digital da Proposta
  app.post('/api/proposals/:token/accept', (req, res) => {
    try {
      const token = req.params.token;
      const { name } = req.body || {};
      const accepted = models.acceptProposal(token, { ip: req.ip, name });
      res.json({ success: true, proposal: accepted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS DA CALCULADORA DE ESCOPO & ORÇAMENTO TÉCNICO
  // ==========================================
  app.get('/api/scope-calculator/presets', (req, res) => {
    try {
      const calcService = require('../services/techScopeCalculatorService');
      res.json({
        success: true,
        categories: calcService.categories,
        addons: calcService.addonModules,
        complexities: calcService.complexityMultipliers,
        slaTiers: calcService.slaTiers
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/scope-calculator/calculate', (req, res) => {
    try {
      const calcService = require('../services/techScopeCalculatorService');
      const result = calcService.calculate(req.body);
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/scope-calculator/export-proposal', (req, res) => {
    try {
      const calcService = require('../services/techScopeCalculatorService');
      const { lead_phone, lead_name, lead_company, ...calcOptions } = req.body;
      if (!lead_phone) return res.status(400).json({ error: 'Telefone do lead é obrigatório.' });

      const calcResult = calcService.calculate(calcOptions);
      const proposalData = calcService.exportToProposalData(calcResult, { lead_phone, lead_name, lead_company });
      const proposal = models.createProposal(proposalData);

      res.json({ success: true, proposal, calculation: calcResult });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rota de Atualização Rápida de Estágio do Kanban (Drag & Drop)
  app.post('/api/cognitive/leads/:phone/stage', (req, res) => {
    try {
      const phone = req.params.phone;
      const { stage, buying_stage, readiness_score } = req.body;
      const targetStage = stage || buying_stage;
      if (!targetStage) return res.status(400).json({ error: 'Novo estágio é obrigatório.' });

      const prof = models.getLeadCognitiveProfile(phone);
      if (!prof) return res.status(404).json({ error: 'Lead não encontrado.' });

      const updated = models.upsertLeadCognitiveProfile(phone, {
        buying_stage: targetStage,
        readiness_score: readiness_score !== undefined ? Number(readiness_score) : undefined
      });

      models.addLeadEpisodicMemory(
        phone,
        'STAGE_CHANGE',
        `Estágio avançado no Kanban de ${prof.buying_stage || 'DESCOBERTA'} para ${targetStage}`,
        '',
        3
      );

      res.json({ success: true, profile: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // BOT DECK: PAINEL DE CONTROLE INTEGRAL DE TODOS OS BOTS
  // ==========================================
// ==========================================
  // ROTAS DE MODERAÇÃO INTELIGENTE & CROWD-REPORTING
  // ==========================================
  app.get('/api/moderation/stats', (req, res) => {
    try {
      res.json({ success: true, ...models.getModerationStats() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/moderation/reports', (req, res) => {
    try {
      const { limit = 50, status, group_jid } = req.query;
      const reports = models.getModerationReports({ limit: Number(limit), status, group_jid });
      res.json({ success: true, reports });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/moderation/scan', (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'Texto é obrigatório.' });
      const moderatorService = require('../services/moderatorService');
      const analysis = moderatorService.analyze(text);
      res.json({ success: true, analysis });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/moderation/action', async (req, res) => {
    try {
      const { reportId, action } = req.body;
      if (!reportId || !action) return res.status(400).json({ error: 'reportId e action são obrigatórios.' });
      const rep = models.getModerationReportById(Number(reportId));
      if (!rep) return res.status(404).json({ error: 'Denúncia não encontrada.' });

      if (action === 'delete') {
        if (rep.message_id && rep.group_jid && whatsappBot.sock && whatsappBot.isConnected) {
          try {
            await whatsappBot.sock.sendMessage(rep.group_jid, {
              delete: {
                remoteJid: rep.group_jid,
                id: rep.message_id,
                participant: rep.reported_author_jid || undefined
              }
            });
          } catch (_) {}
        }
        models.updateModerationReport(rep.id, { status: 'DELETED', action_taken: 'DELETED', note: 'Excluído via API de Moderação' });
        return res.json({ success: true, message: 'Mensagem apagada com sucesso!' });
      } else if (action === 'dismiss') {
        models.updateModerationReport(rep.id, { status: 'DISMISSED', note: 'Dispensado via API de Moderação' });
        return res.json({ success: true, message: 'Denúncia dispensada!' });
      } else if (action === 'ban') {
        if (rep.reported_author_jid && rep.group_jid && whatsappBot.sock && whatsappBot.isConnected) {
          try {
            await whatsappBot.sock.groupParticipantsUpdate(rep.group_jid, [rep.reported_author_jid], 'remove');
          } catch (_) {}
        }
        models.updateModerationReport(rep.id, { status: 'UPHELD', action_taken: 'BANNED', note: 'Usuário banido via API de Moderação' });
        return res.json({ success: true, message: 'Usuário banido e denúncia encerrada!' });
      }

      res.status(400).json({ error: 'Ação inválida.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/botdeck/overview', async (req, res) => {
    try {
      const instances = models.getArmyInstances();
      const mainStatus = whatsappBot.getConnectionStatus ? whatsappBot.getConnectionStatus() : { connected: false };
      let groups = [];
      try {
        groups = await whatsappBot.fetchAllGroups(false);
      } catch (_) {}
      const recentTasks = models.getDelegatedTasks(30);
      const metrics = models.getMetrics();
      const telemetry = models.getBotsLiveTelemetry();
      res.json({
        success: true,
        main: {
          connected: !!mainStatus.connected,
          phone: mainStatus.phone || process.env.ADMIN_NOTIFY_WHATSAPP_PHONE || '554884702848',
          name: 'Matriz Principal'
        },
        instances,
        telemetry,
        groups: groups.map(g => ({ id: g.id, subject: g.subject, size: g.size })),
        recentTasks,
        metrics,
        moderationStats: models.getModerationStats(),
        recentReports: models.getModerationReports({ limit: 15 })
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/botdeck/telemetry', (req, res) => {
    try {
      const telemetry = models.getBotsLiveTelemetry();
      res.json({ success: true, telemetry, data: telemetry });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/botdeck/subbots/:id/role', (req, res) => {
    try {
      const id = req.params.id;
      const { role } = req.body;
      if (!role) return res.status(400).json({ error: 'Parâmetro role é obrigatório' });
      models.setArmyInstanceRole(id, role);
      res.json({ success: true, message: `Função do Sub-Bot #${id} atualizada para ${role}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/botdeck/execute', async (req, res) => {
    try {
      const { action, payload = {} } = req.body;
      const whatsappArmyService = require('../services/whatsappArmyService');
      const matrizAssistantService = require('../services/matrizAssistantService');
      const spyFeatures = require('../services/spyFeaturesService');
      const meteoricService = require('../services/meteoricService');

      let resultMsg = '';
      let logTaskType = action;

      switch (action) {
        case 'SEND_MESSAGE': {
          const { instanceId, target, message } = payload;
          if (!target || !message) throw new Error('Destinatário e mensagem são obrigatórios.');
          const cleanPhone = String(target).replace(/\D/g, '');
          const isJid = target.includes('@');
          const finalTarget = isJid ? target : `${cleanPhone}@s.whatsapp.net`;

          if (!instanceId || instanceId === 'main' || instanceId === '1') {
            if (whatsappBot.isConnected) {
              await whatsappBot.sendMessage(finalTarget, message);
            } else {
              await whatsappArmyService.sendArmyMessage(1, cleanPhone || target, message);
            }
            resultMsg = `Mensagem enviada com sucesso pela Matriz Principal para ${target}`;
          } else {
            const chipId = Number(instanceId);
            await whatsappArmyService.sendMessageViaInstance(chipId, cleanPhone || target, message);
            resultMsg = `Mensagem enviada com sucesso pelo Sub-Bot #${chipId} para ${target}`;
          }
          break;
        }

        case 'SEND_VOICE_PTT': {
          const { instanceId, target, text } = payload;
          if (!target || !text) throw new Error('Destinatário e texto do áudio são obrigatórios.');
          const cleanPhone = String(target).replace(/\D/g, '');
          const chipId = Number(instanceId) || 1;
          await whatsappArmyService.sendVoiceViaInstance(chipId, cleanPhone, text);
          resultMsg = `Áudio PTT enviado com sucesso pelo Chip #${chipId} para +${cleanPhone}`;
          break;
        }

        case 'SCHEDULE_MESSAGE': {
          const { instanceId, target, message, scheduled_at } = payload;
          if (!target || !message || !scheduled_at) throw new Error('Destinatário, mensagem e data/hora são obrigatórios.');
          const task = models.createDelegatedTask({
            assigned_instance_id: instanceId ? Number(instanceId) : 1,
            task_type: 'SCHEDULED_DISPATCH',
            title: `Mensagem Agendada para +${target}`,
            description: message,
            target,
            message_payload: message,
            delegated_by: 'WEB_OPERATOR',
            scheduled_at
          });
          resultMsg = `Mensagem agendada com sucesso para ${scheduled_at} (Código: ${task.task_code})`;
          break;
        }

        case 'SMART_LOAD_BALANCE': {
          const { qty, message } = payload;
          if (!message) throw new Error('Texto da mensagem é obrigatório.');
          const count = parseInt(qty, 10) || 50;
          await matrizAssistantService.delegateSmartBalancing({ sendMessage: async () => true }, null, count, message);
          resultMsg = `Disparo inteligente para ${count} leads distribuído entre todos os Sub-Bots!`;
          break;
        }

        case 'BROADCAST_GROUPS': {
          const { message } = payload;
          if (!message) throw new Error('Mensagem para os grupos é obrigatória.');
          const gRes = await whatsappArmyService.broadcastViaAllSubBots({ message, targetType: 'groups' });
          resultMsg = `Transmissão enviada para ${gRes.totalSent || 0} grupos no WhatsApp!`;
          break;
        }

        case 'TAKEOVER_START': {
          const { target, instanceId } = payload;
          if (!target) throw new Error('Número do lead é obrigatório.');
          const cleanPhone = String(target).replace(/\D/g, '');
          whatsappArmyService.setOwnerRelay(cleanPhone, Number(instanceId) || 1, 'web_dashboard');
          resultMsg = `Takeover humano iniciado para +${cleanPhone}! Conversa repassada ao Dono.`;
          break;
        }

        case 'TAKEOVER_REPLY': {
          const { target, instanceId, message } = payload;
          if (!target || !message) throw new Error('Telefone e mensagem são obrigatórios.');
          const cleanPhone = String(target).replace(/\D/g, '');
          const chipId = Number(instanceId) || 1;
          await whatsappArmyService.sendMessageViaInstance(chipId, cleanPhone, message);
          resultMsg = `Resposta do operador enviada para +${cleanPhone} via Chip #${chipId}!`;
          break;
        }

        case 'TAKEOVER_END': {
          const { target } = payload;
          if (!target) throw new Error('Número do lead é obrigatório.');
          const cleanPhone = String(target).replace(/\D/g, '');
          whatsappArmyService.removeOwnerRelay(cleanPhone);
          resultMsg = `Takeover encerrado para +${cleanPhone}. Bot automatizado reassumiu.`;
          break;
        }

        case 'DOWNLOAD_AUDIO': {
          const { target, query, quality } = payload;
          if (!target || !query) throw new Error('Destinatário e link/nome da música são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          const qual = quality === 'H' ? 'H' : 'S';
          await spyFeatures.handlePlayMusic(whatsappBot.sock, finalTarget, `${query} ${qual}`);
          resultMsg = `Áudio (${qual === 'H' ? 'Alta Fidelidade' : 'Padrão'}) enviado para ${target}!`;
          break;
        }

        case 'DOWNLOAD_VIDEO': {
          const { target, url, quality } = payload;
          if (!target || !url) throw new Error('Destinatário e link do vídeo são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          const qual = quality === 'H' ? 'H' : 'S';
          await spyFeatures.handleDownloadVideo(whatsappBot.sock, finalTarget, `${url} ${qual}`);
          resultMsg = `Vídeo (${qual === 'H' ? 'HD' : 'Padrão'}) enviado para ${target}!`;
          break;
        }

        case 'AI_QUERY': {
          const { target, prompt } = payload;
          if (!target || !prompt) throw new Error('Destinatário e pergunta/prompt são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          await spyFeatures.handleAIChat(whatsappBot.sock, finalTarget, `!ia ${prompt}`, 'Operador Web');
          resultMsg = `Consulta à IA realizada e resposta enviada para ${target}!`;
          break;
        }

        case 'AI_IMAGE': {
          const { target, prompt } = payload;
          if (!target || !prompt) throw new Error('Destinatário e descrição da imagem são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          await spyFeatures.handleImagine(whatsappBot.sock, finalTarget, `!imagine ${prompt}`);
          resultMsg = `Imagem gerada por IA enviada para ${target}!`;
          break;
        }

        case 'SEND_TTS': {
          const { target, text, lang } = payload;
          if (!target || !text) throw new Error('Destinatário e texto são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          await spyFeatures.handleTTS(whatsappBot.sock, finalTarget, `!tts ${lang ? lang + ' ' : ''}${text}`);
          resultMsg = `Voz sintetizada TTS enviada com sucesso para ${target}!`;
          break;
        }

        case 'SEND_QR': {
          const { target, text } = payload;
          if (!target || !text) throw new Error('Destinatário e texto/link do QR são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          await spyFeatures.handleQRCode(whatsappBot.sock, finalTarget, `!qr ${text}`);
          resultMsg = `QR Code gerado e enviado para ${target}!`;
          break;
        }

        case 'SEND_STICKER': {
          const { target, text, style = 'attp' } = payload;
          if (!target || !text) throw new Error('Destinatário e texto da figurinha são obrigatórios.');
          const finalTarget = target.includes('@') ? target : `${target.replace(/\D/g, '')}@s.whatsapp.net`;
          if (style === 'brat') {
            await spyFeatures.handleBrat(whatsappBot.sock, finalTarget, `!brat ${text}`);
          } else {
            await spyFeatures.handleAttp(whatsappBot.sock, finalTarget, `!attp ${text}`);
          }
          resultMsg = `Figurinha (${style.toUpperCase()}) criada e enviada com sucesso para ${target}!`;
          break;
        }

        case 'GROUP_SET_SECURITY': {
          const { groupJid, feature, enabled } = payload;
          if (!groupJid || !feature) throw new Error('Grupo e funcionalidade são obrigatórios.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          const val = enabled ? 'true' : 'false';
          const key = `${feature.toUpperCase()}_${finalGroup}`;
          models.setSetting(key, val);
          resultMsg = `${feature.toUpperCase()} no grupo foi ${enabled ? 'ATIVADO ✅' : 'DESATIVADO ❌'}!`;
          break;
        }

        case 'PING_CHIP': {
          const { instanceId } = payload;
          const start = Date.now();
          let statusText = 'Online';
          if (!instanceId || instanceId === 'main' || instanceId === 'matriz') {
            statusText = whatsappBot.isConnected ? 'Conectado (Matriz)' : 'Desconectado';
          } else {
            const inst = models.getArmyInstanceById(Number(instanceId));
            statusText = inst ? `${inst.name} [${inst.status}]` : 'Não encontrado';
          }
          const ms = Date.now() - start;
          resultMsg = `Diagnóstico: ${statusText} • Latência interna: ${ms}ms`;
          break;
        }


        case 'GROUP_PROMOTE': {
          const { groupJid, userPhone } = payload;
          if (!groupJid || !userPhone) throw new Error('ID do Grupo e telefone são obrigatórios.');
          const cleanUser = String(userPhone).replace(/\D/g, '');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          if (whatsappBot.sock && whatsappBot.isConnected) {
            await whatsappBot.sock.groupParticipantsUpdate(finalGroup, [`${cleanUser}@s.whatsapp.net`], 'promote');
          }
          resultMsg = `Membro +${cleanUser} promovido a Administrador no grupo!`;
          break;
        }

        case 'GROUP_DEMOTE': {
          const { groupJid, userPhone } = payload;
          if (!groupJid || !userPhone) throw new Error('ID do Grupo e telefone são obrigatórios.');
          const cleanUser = String(userPhone).replace(/\D/g, '');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          if (whatsappBot.sock && whatsappBot.isConnected) {
            await whatsappBot.sock.groupParticipantsUpdate(finalGroup, [`${cleanUser}@s.whatsapp.net`], 'demote');
          }
          resultMsg = `Membro +${cleanUser} rebaixado de Administrador no grupo!`;
          break;
        }

        case 'GROUP_BAN': {
          const { groupJid, userPhone, reason } = payload;
          if (!groupJid || !userPhone) throw new Error('ID do Grupo e telefone são obrigatórios.');
          const cleanUser = String(userPhone).replace(/\D/g, '');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          if (whatsappBot.sock && whatsappBot.isConnected) {
            await whatsappBot.sock.groupParticipantsUpdate(finalGroup, [`${cleanUser}@s.whatsapp.net`], 'remove');
          }
          models.logGroupAdminAction({
            platform: 'whatsapp',
            groupId: finalGroup,
            adminId: 'WEB_OPERATOR',
            adminName: 'Painel Web',
            action: 'BAN',
            targetId: cleanUser,
            details: reason || 'Expulso via Painel Web'
          });
          resultMsg = `Membro +${cleanUser} expulso do grupo com sucesso!`;
          break;
        }

        case 'GROUP_MUTE': {
          const { groupJid } = payload;
          if (!groupJid) throw new Error('ID do Grupo é obrigatório.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          await whatsappBot.setGroupAnnouncement(finalGroup, true);
          resultMsg = `Grupo silenciado! Agora apenas administradores podem enviar mensagens.`;
          break;
        }

        case 'GROUP_UNMUTE': {
          const { groupJid } = payload;
          if (!groupJid) throw new Error('ID do Grupo é obrigatório.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          await whatsappBot.setGroupAnnouncement(finalGroup, false);
          resultMsg = `Grupo aberto! Todos os participantes podem enviar mensagens.`;
          break;
        }

        case 'GROUP_TAGALL': {
          const { groupJid, message } = payload;
          if (!groupJid) throw new Error('ID do Grupo é obrigatório.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          const meta = whatsappBot.sock ? await whatsappBot.sock.groupMetadata(finalGroup).catch(() => null) : null;
          await spyFeatures.handleTagAll(whatsappBot.sock, finalGroup, `!tagall ${message || ''}`, meta);
          resultMsg = `Todos os membros foram marcados com sucesso no grupo!`;
          break;
        }

        case 'GROUP_SET_NAME': {
          const { groupJid, title } = payload;
          if (!groupJid || !title) throw new Error('ID do Grupo e novo título são obrigatórios.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          if (whatsappBot.sock && whatsappBot.isConnected) {
            await whatsappBot.sock.groupUpdateSubject(finalGroup, title);
          }
          resultMsg = `Nome do grupo alterado para "${title}"!`;
          break;
        }

        case 'GROUP_SET_DESC': {
          const { groupJid, desc } = payload;
          if (!groupJid || !desc) throw new Error('ID do Grupo e descrição são obrigatórios.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          if (whatsappBot.sock && whatsappBot.isConnected) {
            await whatsappBot.sock.groupUpdateDescription(finalGroup, desc);
          }
          resultMsg = `Descrição do grupo atualizada com sucesso!`;
          break;
        }

        case 'GROUP_REVOKE_LINK': {
          const { groupJid } = payload;
          if (!groupJid) throw new Error('ID do Grupo é obrigatório.');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          let code = '';
          if (whatsappBot.sock && whatsappBot.isConnected) {
            code = await whatsappBot.sock.groupRevokeInvite(finalGroup);
          }
          resultMsg = `Link do grupo resetado! Novo código de convite: ${code || 'Gerado'}`;
          break;
        }

        case 'GROUP_WARN': {
          const { groupJid, userPhone, reason } = payload;
          if (!groupJid || !userPhone) throw new Error('ID do Grupo e telefone são obrigatórios.');
          const cleanUser = String(userPhone).replace(/\D/g, '');
          const finalGroup = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
          const wRes = spyFeatures.addWarning(finalGroup, cleanUser, reason || 'Violação de regras');
          resultMsg = `Advertência registrada para +${cleanUser} (${wRes.count}/3)!${wRes.count >= 3 ? ' Usuário banido automaticamente!' : ''}`;
          break;
        }

        case 'SUBBOT_PAUSE': {
          const { instanceId } = payload;
          if (!instanceId) throw new Error('ID do Sub-Bot é obrigatório.');
          const chipId = Number(instanceId);
          models.updateArmyInstance(chipId, { status: 'PAUSED' });
          resultMsg = `Sub-Bot #${chipId} pausado com sucesso!`;
          break;
        }

        case 'SUBBOT_RESUME': {
          const { instanceId } = payload;
          if (!instanceId) throw new Error('ID do Sub-Bot é obrigatório.');
          const chipId = Number(instanceId);
          models.updateArmyInstance(chipId, { status: 'CONNECTED' });
          resultMsg = `Sub-Bot #${chipId} retomado com sucesso!`;
          break;
        }

        case 'SUBBOT_SYNC_CATALOG': {
          const { instanceId } = payload;
          if (!instanceId) throw new Error('ID do Sub-Bot é obrigatório.');
          const chipId = Number(instanceId);
          const prods = models.getProducts(true);
          models.saveSubBotCatalogProducts(chipId, prods);
          resultMsg = `Catálogo oficial sincronizado no Sub-Bot #${chipId} (${prods.length} itens)!`;
          break;
        }

        case 'SUBBOT_PAIRING_CODE': {
          const { phone } = payload;
          if (!phone) throw new Error('Número de telefone do chip é obrigatório.');
          const clean = phone.replace(/\D/g, '');
          const resCode = await whatsappArmyService.requestPairingCodeForNewInstance(clean);
          resultMsg = `Código de emparelhamento gerado: ${resCode.code} (Expira em 2 minutos)`;
          break;
        }

        case 'METEORIC_STAGE': {
          const { stageNum, link } = payload;
          const sNum = parseInt(stageNum, 10) || 1;
          const resStage = await meteoricService.executeStage(sNum, link);
          resultMsg = `Fase ${sNum} do Lançamento Meteórico executada em ${resStage.groupsReached || 0} grupos!`;
          break;
        }

        case 'METEORIC_MANADA': {
          await meteoricService.simulateDialogue(1);
          resultMsg = `Simulação de prova social e efeito manada disparada com sucesso!`;
          break;
        }

        case 'METEORIC_MODE_ALL': {
          const { mode } = payload;
          const isAnnounce = mode === 'announcement';
          await meteoricService.setAllGroupsMode(isAnnounce);
          resultMsg = `Todos os grupos do lançamento foram ${isAnnounce ? 'silenciados (somente admins)' : 'abertos para todos os membros'}!`;
          break;
        }

        case 'METEORIC_CREATE_GROUP': {
          const { baseName, maxMembers } = payload;
          const newGrp = await meteoricService.createMeteoricGroup(baseName || 'Oferta VIP #{num}', parseInt(maxMembers, 10) || 200);
          resultMsg = `Novo grupo "${newGrp.title}" criado com sucesso! Link: ${newGrp.invite_url || 'N/A'}`;
          break;
        }

        case 'QUICK_CHARGE': {
          const { name, phone, amount, gateway, productId } = payload;
          if (!phone || !amount) throw new Error('Telefone e valor são obrigatórios.');
          const cleanPhone = String(phone).replace(/\D/g, '');
          const amt = parseFloat(amount);
          const gw = gateway || 'pix';
          const pId = productId ? Number(productId) : (models.getProducts(true)[0]?.id || 1);
          const tradeNo = `ORD_QUICK_${Date.now()}`;
          models.createOrder({
            merchant_trade_no: tradeNo,
            platform: 'whatsapp',
            platform_user_id: `${cleanPhone}@s.whatsapp.net`,
            platform_user_name: name || `Cliente +${cleanPhone}`,
            product_id: pId,
            gateway: gw,
            amount: amt,
            currency: 'BRL',
            status: 'PENDING'
          });
          resultMsg = `Cobrança de R$ ${amt.toFixed(2)} gerada via ${gw.toUpperCase()}! Pedido: ${tradeNo}`;
          break;
        }

        case 'QUICK_COUPON': {
          const { code, discount, maxUses } = payload;
          if (!code || !discount) throw new Error('Código e percentual de desconto são obrigatórios.');
          models.createCoupon({
            code: String(code).toUpperCase().trim(),
            discount_percent: parseFloat(discount),
            max_uses: parseInt(maxUses, 10) || 0
          });
          resultMsg = `Cupom ${code.toUpperCase()} (${discount}% OFF) criado com sucesso!`;
          break;
        }

        case 'RECOVER_CARTS': {
          const orders = models.getPendingOrdersToRecover(0);
          let sent = 0;
          for (const ord of orders) {
            try {
              const rawName = (ord.platform_user_name || '').trim();
              const isGeneric = !rawName || /^(amigo\(a\)|amigo|cliente|lead)$/i.test(rawName);
              const nameGreet = isGeneric ? 'Olá!' : `Olá, ${rawName.split(' ')[0]}!`;
              const msg = `👋 ${nameGreet} Seu pedido para *${ord.product_name || 'produto'}* ainda está reservado.\n\nFinalize seu pagamento com segurança via PIX ou Cripto!`;
              if (whatsappBot.isConnected) {
                await whatsappBot.sendMessage(ord.platform_user_id, msg);
              }
              models.markOrderRecovered(ord.merchant_trade_no);
              sent++;
            } catch (_) {}
          }
          resultMsg = `Recuperação de carrinho concluída: ${sent} mensagens enviadas!`;
          break;
        }

        case 'CHAT_MUTE': {
          const { target, reason } = payload;
          if (!target) throw new Error('Telefone ou JID é obrigatório.');
          const isGrp = target.includes('@g.us');
          models.muteChat({
            platform: 'whatsapp',
            chatId: target,
            targetType: isGrp ? 'GROUP' : 'PRIVATE',
            reason: reason || 'Mute acionado via Painel Web',
            createdBy: 'WEB_OPERATOR'
          });
          resultMsg = `Bot silenciado com sucesso no ${isGrp ? 'grupo' : 'chat'} ${target}!`;
          break;
        }

        case 'CHAT_UNMUTE': {
          const { target } = payload;
          if (!target) throw new Error('Telefone ou JID é obrigatório.');
          models.unmuteChat('whatsapp', target);
          resultMsg = `Bot reativado com sucesso no chat ${target}!`;
          break;
        }

        case 'USER_BLOCK': {
          const { phone, reason } = payload;
          if (!phone) throw new Error('Telefone do usuário é obrigatório.');
          const cleanPhone = String(phone).replace(/\D/g, '');
          models.blockUser({
            platform: 'whatsapp',
            userId: cleanPhone,
            reason: reason || 'Bloqueio via Painel Web',
            createdBy: 'WEB_OPERATOR'
          });
          resultMsg = `Usuário +${cleanPhone} bloqueado globalmente no bot!`;
          break;
        }

        case 'USER_UNBLOCK': {
          const { phone } = payload;
          if (!phone) throw new Error('Telefone do usuário é obrigatório.');
          const cleanPhone = String(phone).replace(/\D/g, '');
          models.unblockUser('whatsapp', cleanPhone);
          resultMsg = `Usuário +${cleanPhone} desbloqueado com sucesso!`;
          break;
        }

        case 'MODERATION_SET_MODE': {
          const { mode } = payload;
          if (!mode) throw new Error('Modo (enforce ou shadow) é obrigatório.');
          const targetMode = (mode.toLowerCase() === 'shadow' || mode.toLowerCase() === 'sombra') ? 'shadow' : 'enforce';
          models.setSetting('MODERATION_MODE', targetMode);
          resultMsg = `Modo de Moderação alterado para ${targetMode === 'enforce' ? 'ATIVO (ENFORCE - Exclusão e Punição Automática) 🛡️' : 'SOMBRA (SHADOW - Apenas Auditoria e Log) 🔍'}!`;
          break;
        }

        case 'MODERATION_TOGGLE_AUTODELETE': {
          const { enabled } = payload;
          const val = enabled ? 'true' : 'false';
          models.setSetting('MODERATION_AUTO_DELETE', val);
          resultMsg = `Exclusão Automática de Spam ${enabled ? 'ATIVADA ✅' : 'DESATIVADA ❌'}!`;
          break;
        }

        case 'MODERATION_SCAN_TEXT': {
          const { text } = payload;
          if (!text) throw new Error('Texto para escaneamento é obrigatório.');
          const moderatorService = require('../services/moderatorService');
          const analysis = moderatorService.analyze(text);
          resultMsg = `Análise Concluída: Score ${(analysis.score * 100).toFixed(0)}% | Categoria: ${analysis.category || 'Limpo'} | Regras: ${analysis.hits.map(h => h.name).join(', ') || 'Nenhuma'}`;
          break;
        }

        case 'MODERATION_DISMISS_REPORT': {
          const { reportId } = payload;
          if (!reportId) throw new Error('ID da denúncia é obrigatório.');
          models.updateModerationReport(Number(reportId), { status: 'DISMISSED', note: 'Dispensado via Bot Deck' });
          resultMsg = `Denúncia #${reportId} dispensada com sucesso!`;
          break;
        }

        case 'MODERATION_DELETE_REPORTED_MSG': {
          const { reportId } = payload;
          if (!reportId) throw new Error('ID da denúncia é obrigatório.');
          const rep = models.getModerationReportById(Number(reportId));
          if (!rep) throw new Error(`Denúncia #${reportId} não encontrada.`);
          if (rep.message_id && rep.group_jid && whatsappBot.sock && whatsappBot.isConnected) {
            try {
              await whatsappBot.sock.sendMessage(rep.group_jid, {
                delete: {
                  remoteJid: rep.group_jid,
                  id: rep.message_id,
                  participant: rep.reported_author_jid || undefined
                }
              });
            } catch (_) {}
          }
          models.updateModerationReport(rep.id, { status: 'DELETED', action_taken: 'DELETED', note: 'Excluído manualmente via Bot Deck' });
          resultMsg = `Mensagem denunciada (#${reportId}) apagada do grupo para todos com sucesso!`;
          break;
        }

        case 'MODERATION_CLEAR_REPORTS': {
          const { days } = payload;
          const cleared = models.clearOldModerationReports(Number(days) || 0);
          resultMsg = `Limpeza concluída: ${cleared} denúncias removidas da fila com sucesso!`;
          break;
        }

        case 'OPTIMIZE_MEMORY': {
          const beforeRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
          if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
          if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
          if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
          if (typeof global.gc === 'function') global.gc();
          const afterRss = Math.round(process.memoryUsage().rss / 1024 / 1024);
          resultMsg = `Memória otimizada! RAM reduzida de ${beforeRss}MB para ${afterRss}MB (economia de ${Math.max(0, beforeRss - afterRss)}MB).`;
          break;
        }

        case 'RESTART_TUNNEL': {
          const tunnelService = require('../services/tunnelService');
          const tRes = await tunnelService.startCloudflaredTunnel(3000, true);
          resultMsg = `Túnel remoto reiniciado com sucesso! URL: ${tRes.url || 'Ativo'}`;
          break;
        }

        case 'SUBBOT_SET_ROLE': {
          const { instanceId, role } = payload;
          if (!instanceId || !role) throw new Error('instanceId e role são obrigatórios');
          models.setArmyInstanceRole(instanceId, role);
          resultMsg = `Função do Sub-Bot #${instanceId} definida para: ${role}`;
          break;
        }

        case 'SUBBOT_RESET_QUOTA': {
          const { instanceId } = payload;
          if (instanceId && instanceId !== 'all') {
            models.resetArmyInstancesQuota(instanceId);
            resultMsg = `Cota diária do Sub-Bot #${instanceId} resetada com sucesso para 0 envios.`;
          } else {
            models.resetArmyInstancesQuota();
            resultMsg = `Cota diária de TODOS os Sub-Bots foi resetada com sucesso para 0 envios.`;
          }
          break;
        }

        case 'RUN_COGNITIVE_HEARTBEAT': {
          const cognitiveService = require('../services/cognitiveSalesService');
          const hbResult = await cognitiveService.runAutonomousHeartbeat({ dryRun: false, limit: 15 });
          resultMsg = `Heartbeat Cognitivo executado! ${hbResult.processed} leads processados para follow-up ("Earning Attention").`;
          break;
        }

        case 'COGNITIVE_UPDATE_STAGE': {
          const { phone, stage, readiness } = payload;
          if (!phone || !stage) throw new Error('Telefone e novo estágio são obrigatórios.');
          models.upsertLeadCognitiveProfile(phone, {
            buying_stage: stage,
            readiness_score: readiness !== undefined ? Number(readiness) : undefined
          });
          resultMsg = `Estágio do lead +${phone} atualizado para ${stage}${readiness !== undefined ? ` (${readiness}%)` : ''}!`;
          break;
        }

        case 'SCHEDULE_MEETING': {
          const { phone, name, title, date, time, duration, meet_url, topic } = payload;
          if (!phone || !date || !time) throw new Error('Telefone, data e horário são obrigatórios.');
          const meeting = models.createMeeting({
            lead_phone: phone,
            lead_name: name || 'Lead',
            meeting_title: title || 'Diagnóstico Técnico & Alinhamento',
            meeting_date: date,
            meeting_time: time,
            duration_minutes: duration ? Number(duration) : 30,
            meet_url: meet_url || undefined,
            topic_scope: topic || 'Software sob Medida / IA / Projetos'
          });
          resultMsg = `Reunião agendada com sucesso para ${date} às ${time}! Meet: ${meeting.meet_url}`;
          break;
        }

        case 'GENERATE_PROPOSAL': {
          const { phone, name, company, title, category, investment, timeline, terms } = payload;
          if (!phone || !title) throw new Error('Telefone e título do projeto são obrigatórios.');
          const proposalService = require('../services/proposalService');
          const prop = proposalService.generateProposal(phone, {
            lead_name: name,
            lead_company: company,
            project_title: title,
            category: category || 'SOFTWARE',
            investment_brl: investment ? Number(investment) : undefined,
            timeline_weeks: timeline ? Number(timeline) : undefined,
            payment_terms: terms
          });
          resultMsg = `Proposta comercial ${prop.code} gerada com sucesso! Link: /proposta/${prop.token}`;
          break;
        }

        case 'CALCULATE_SCOPE': {
          const calcService = require('../services/techScopeCalculatorService');
          const calc = calcService.calculate(payload);
          resultMsg = `Escopo calculado: ${calc.categoryName} (${calc.complexityName}) - R$ ${calc.pricingBreakdown.totalInvestmentBrl.toLocaleString('pt-BR')} em ${calc.timeline.totalDays} dias úteis.`;
          break;
        }

        case 'GENERATE_RENTAL_CODE': {
          const { durationDays, targetGroup } = payload;
          const dur = (durationDays === 'permanent' || durationDays === -1) ? -1 : (Number(durationDays) || 30);
          const resCode = models.generateRentalActivationCode(dur, targetGroup || null, 'WEB_PANEL');
          resultMsg = `Código de ativação gerado: ${resCode.code} (${dur === -1 ? 'Permanente' : `${dur} dias`})`;
          break;
        }

        case 'SET_GROUP_RENTAL': {
          const { groupJid, durationDays } = payload;
          if (!groupJid) throw new Error('ID do grupo é obrigatório.');
          const dur = (durationDays === 'permanent' || durationDays === -1) ? 'permanent' : (Number(durationDays) || 30);
          const rental = models.setGroupRental(groupJid, dur, { payer_name: 'Painel Web (Manual)' });
          resultMsg = `Aluguel ativado para o grupo ${groupJid} (${rental.permanent ? 'Permanente' : `${rental.days_left} dias`})!`;
          break;
        }

        case 'REVOKE_GROUP_RENTAL': {
          const { groupJid } = payload;
          if (!groupJid) throw new Error('ID do grupo é obrigatório.');
          models.removeGroupRental(groupJid);
          resultMsg = `Aluguel do grupo ${groupJid} revogado com sucesso!`;
          break;
        }

        case 'TOGGLE_RENTAL_MODE': {
          const { enabled } = payload;
          const isAct = !!enabled;
          models.setRentalModeGlobal(isAct);
          resultMsg = `Modo Aluguel Global ${isAct ? 'ATIVADO (Exige chave nos grupos)' : 'DESATIVADO (Livre)'}!`;
          break;
        }

        case 'UPDATE_GROUP_PROTECTION': {
          const { groupJid, settings } = payload;
          if (!groupJid) throw new Error('ID do grupo é obrigatório.');
          const updated = models.updateGroupProtection(groupJid, settings || {});
          resultMsg = `Proteções do grupo ${groupJid} atualizadas com sucesso!`;
          break;
        }

        case 'TOGGLE_VERIFICADO_GLOBAL': {
          const isEn = payload.enabled !== undefined ? !!payload.enabled : !models.isVerificadoGlobal();
          models.setVerificadoGlobal(isEn);
          if (payload.title) models.setSetting('VERIFICADO_TITLE', payload.title);
          if (payload.body) models.setSetting('VERIFICADO_BODY', payload.body);
          resultMsg = `Verificado Global definido para: ${isEn ? 'ATIVADO 🟢' : 'DESATIVADO ⚪'}`;
          break;
        }

        case 'SEND_FAKE_MESSAGE': {
          const { groupJid, targetJid, fakeText, responseText } = payload;
          if (!groupJid) throw new Error('groupJid é obrigatório para envio de fake.');
          await spyFeatures.handleFakeCommand(whatsappBot.sock, groupJid, `${fakeText || 'Mensagem'} | ${responseText || 'Olha só'}`, null, targetJid);
          resultMsg = `Mensagem fake simulada disparada no grupo ${groupJid}!`;
          break;
        }

        case 'EXECUTE_ZAPVOICE_FUNNEL': {
          const { funnelId, targetJid, context } = payload;
          if (!funnelId || !targetJid) throw new Error('funnelId e targetJid são obrigatórios.');
          await zapVoiceService.executeFunnel(whatsappBot.sock, targetJid, funnelId, context || {});
          resultMsg = `Funil #${funnelId} disparado com sucesso para ${targetJid}!`;
          break;
        }

        case 'ADMIN_GROUP_ACTION': {
          const { groupJid, groupAction, targetJid, newText } = payload;
          if (!groupJid) throw new Error('groupJid é obrigatório.');
          if (groupAction === 'promote') await spyFeatures.handlePromote(whatsappBot.sock, groupJid, targetJid, true, true);
          else if (groupAction === 'demote') await spyFeatures.handleDemote(whatsappBot.sock, groupJid, targetJid, true, true);
          else if (groupAction === 'kick') await spyFeatures.handleKick(whatsappBot.sock, groupJid, targetJid, true, true);
          else if (groupAction === 'mute') await spyFeatures.handleMuteUser(whatsappBot.sock, groupJid, targetJid, true);
          else if (groupAction === 'unmute') await spyFeatures.handleUnmuteUser(whatsappBot.sock, groupJid, targetJid, true);
          else if (groupAction === 'open') await spyFeatures.handleGrupoStatus(whatsappBot.sock, groupJid, 'a', true, true);
          else if (groupAction === 'close') await spyFeatures.handleGrupoStatus(whatsappBot.sock, groupJid, 'f', true, true);
          else if (groupAction === 'limpar') await spyFeatures.handleLimpar(whatsappBot.sock, groupJid, true);
          else if (groupAction === 'setname') await spyFeatures.handleSetName(whatsappBot.sock, groupJid, newText, true, true);
          else if (groupAction === 'setdesc') await spyFeatures.handleSetDesc(whatsappBot.sock, groupJid, newText, true, true);
          resultMsg = `Ação "${groupAction}" executada com sucesso no grupo ${groupJid}!`;
          break;
        }

        default:
          throw new Error(`Ação desconhecida: "${action}"`);
      }

      models.createDelegatedTask({
        assigned_instance_id: payload.instanceId ? Number(payload.instanceId) : 1,
        task_type: logTaskType,
        title: `Ação Web: ${action}`,
        description: resultMsg,
        target: payload.target || payload.groupJid || payload.phone || 'CLUSTER',
        message_payload: payload.message || payload.text || payload.prompt || '',
        delegated_by: 'WEB_OPERATOR',
        status: 'COMPLETED',
        result_summary: resultMsg
      });

      res.json({ success: true, message: resultMsg, action });
    } catch (err) {
      console.error('[BotDeck Execute Error]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS REST: ALUGUÉIS DE GRUPOS & ESTATÍSTICAS NAZUNA
  // ==========================================
  app.get('/api/rentals/groups', (req, res) => {
    try {
      const rentals = models.listGroupRentals();
      const globalMode = models.isRentalModeGlobal();
      res.json({ success: true, rentals, globalMode });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rentals/groups', (req, res) => {
    try {
      const { groupJid, durationDays, groupName } = req.body;
      if (!groupJid) return res.status(400).json({ error: 'groupJid é obrigatório.' });
      const rental = models.setGroupRental(groupJid, durationDays, { group_name: groupName, payer_name: 'API Admin' });
      res.json({ success: true, rental });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/rentals/groups/:groupJid', (req, res) => {
    try {
      models.removeGroupRental(req.params.groupJid);
      res.json({ success: true, message: 'Aluguel revogado com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rentals/codes', (req, res) => {
    try {
      const unusedOnly = req.query.unused === 'true';
      const codes = models.listRentalActivationCodes(unusedOnly);
      res.json({ success: true, codes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rentals/codes', (req, res) => {
    try {
      const { durationDays, targetGroup } = req.body;
      const result = models.generateRentalActivationCode(durationDays, targetGroup, 'API_ADMIN');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rentals/mode', (req, res) => {
    try {
      res.json({ success: true, globalMode: models.isRentalModeGlobal() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rentals/mode', (req, res) => {
    try {
      const { enabled } = req.body;
      models.setRentalModeGlobal(!!enabled);
      res.json({ success: true, globalMode: models.isRentalModeGlobal() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rentals/overview', (req, res) => {
    try {
      const rentals = models.listGroupRentals();
      const codes = models.listRentalActivationCodes();
      const globalMode = models.isRentalModeGlobal();
      const stats = models.getTopCommands ? models.getTopCommands(10) : { totalCount: 0, commands: [] };
      const unusedCodes = codes.filter(c => !c.used_at);
      const activeGroups = rentals.filter(r => r.active && (r.is_permanent || (r.expires_at && new Date(r.expires_at) > new Date())));

      res.json({
        success: true,
        globalMode,
        rentals,
        codes,
        stats: {
          totalGroups: rentals.length,
          activeGroups: activeGroups.length,
          unusedCodes: unusedCodes.length,
          totalCommands: stats.totalCount || 0,
          topCommands: stats.commands || []
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/groups/:groupJid/protection', (req, res) => {
    try {
      const prot = models.getGroupProtection(req.params.groupJid);
      res.json({ success: true, protection: prot });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/groups/:groupJid/protection', (req, res) => {
    try {
      const updated = models.updateGroupProtection(req.params.groupJid, req.body);
      res.json({ success: true, protection: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stats/commands', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 15;
      const stats = models.getTopCommands(limit);
      res.json({ success: true, ...stats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS REST: VERIFICADO GLOBAL (GATA NINA & SPY BOT)
  // ==========================================
  app.get('/api/features/verificado-global', (req, res) => {
    try {
      res.json({ success: true, config: models.getVerificadoConfig() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/features/verificado-global', (req, res) => {
    try {
      const updated = models.setVerificadoConfig(req.body);
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS REST: COMANDO /FAKE EM GRUPOS
  // ==========================================
  app.post('/api/features/fake', async (req, res) => {
    try {
      const { groupJid, targetJid, fakeText, responseText } = req.body;
      if (!groupJid) return res.status(400).json({ error: 'groupJid é obrigatório.' });
      await spyFeatures.handleFakeCommand(
        whatsappBot.sock,
        groupJid,
        `${fakeText || 'Declaração'} | ${responseText || 'Olha só isso'}`,
        null,
        targetJid
      );
      res.json({ success: true, message: `Mensagem fake disparada com sucesso no grupo ${groupJid}!` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS REST: AÇÕES ADMINISTRATIVAS (NAZUNA MENUADM)
  // ==========================================
  app.post('/api/groups/:groupJid/admin-action', async (req, res) => {
    try {
      const { groupJid } = req.params;
      const { action, targetJid, text } = req.body;
      if (!groupJid || !action) return res.status(400).json({ error: 'groupJid e action são obrigatórios.' });

      let resultMsg = 'Ação executada com sucesso.';
      if (action === 'promote') await spyFeatures.handlePromote(whatsappBot.sock, groupJid, targetJid, true, true);
      else if (action === 'demote') await spyFeatures.handleDemote(whatsappBot.sock, groupJid, targetJid, true, true);
      else if (action === 'kick') await spyFeatures.handleKick(whatsappBot.sock, groupJid, targetJid, true, true);
      else if (action === 'mute') await spyFeatures.handleMuteUser(whatsappBot.sock, groupJid, targetJid, true);
      else if (action === 'unmute') await spyFeatures.handleUnmuteUser(whatsappBot.sock, groupJid, targetJid, true);
      else if (action === 'open') await spyFeatures.handleGrupoStatus(whatsappBot.sock, groupJid, 'a', true, true);
      else if (action === 'close') await spyFeatures.handleGrupoStatus(whatsappBot.sock, groupJid, 'f', true, true);
      else if (action === 'limpar') await spyFeatures.handleLimpar(whatsappBot.sock, groupJid, true);
      else if (action === 'setname') await spyFeatures.handleSetName(whatsappBot.sock, groupJid, text, true, true);
      else if (action === 'setdesc') await spyFeatures.handleSetDesc(whatsappBot.sock, groupJid, text, true, true);
      else return res.status(400).json({ error: `Ação "${action}" desconhecida.` });

      res.json({ success: true, action, message: resultMsg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // ROTAS REST: ZAPVOICE 2025 (MENSAGENS, ÁUDIOS PTT, FUNIS & CAMPANHAS)
  // ==========================================
  app.get('/api/zapvoice/messages', (req, res) => {
    try {
      res.json({ success: true, messages: models.listZapVoiceMessages(req.query.category) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/messages', (req, res) => {
    try {
      const msg = models.saveZapVoiceMessage(req.body);
      res.json({ success: true, message: msg });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/zapvoice/messages/:id', (req, res) => {
    try {
      models.deleteZapVoiceMessage(req.params.id);
      res.json({ success: true, message: 'Mensagem rápida excluída com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/zapvoice/audios', (req, res) => {
    try {
      res.json({ success: true, audios: models.listZapVoiceAudios() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/audios', (req, res) => {
    try {
      const audio = models.saveZapVoiceAudio(req.body);
      res.json({ success: true, audio });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/zapvoice/audios/:id', (req, res) => {
    try {
      models.deleteZapVoiceAudio(req.params.id);
      res.json({ success: true, message: 'Áudio PTT excluído com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/zapvoice/funnels', (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === 'true';
      res.json({ success: true, funnels: models.listZapVoiceFunnels(activeOnly) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/funnels', (req, res) => {
    try {
      const funnel = models.saveZapVoiceFunnel(req.body);
      res.json({ success: true, funnel });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/zapvoice/funnels/:id', (req, res) => {
    try {
      models.deleteZapVoiceFunnel(req.params.id);
      res.json({ success: true, message: 'Funil excluído com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/zapvoice/funnels/:id/steps', (req, res) => {
    try {
      res.json({ success: true, steps: models.getZapVoiceFunnelSteps(req.params.id) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/funnels/:id/steps', (req, res) => {
    try {
      const step = models.saveZapVoiceFunnelStep({ ...req.body, funnel_id: req.params.id });
      res.json({ success: true, step });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/zapvoice/funnels/steps/:stepId', (req, res) => {
    try {
      models.deleteZapVoiceFunnelStep(req.params.stepId);
      res.json({ success: true, message: 'Etapa do funil excluída.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/funnels/:id/execute', async (req, res) => {
    try {
      const { targetJid, context } = req.body;
      if (!targetJid) return res.status(400).json({ error: 'targetJid é obrigatório.' });
      const result = await zapVoiceService.executeFunnel(whatsappBot.sock, targetJid, req.params.id, context || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/zapvoice/campaigns', (req, res) => {
    try {
      res.json({ success: true, campaigns: models.listZapVoiceCampaigns() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/zapvoice/campaigns', (req, res) => {
    try {
      const campaign = models.saveZapVoiceCampaign(req.body);
      res.json({ success: true, campaign });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/zapvoice/stats', (req, res) => {
    try {
      res.json({ success: true, stats: models.getZapVoiceStats() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // PLATAFORMA SAAS MULTI-TENANT & GESTÃO DE LICENÇAS
  // ==========================================

  // --- Rotas HTML do Tenant ---
  app.get(['/tenant', '/tenant/login'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'tenant_login.html'));
  });

  app.get('/tenant/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'tenant_dashboard.html'));
  });

  // --- Rotas de Gestão SaaS pelo Super Admin (Dono / Master) ---
  app.get('/api/saas/tenants', (req, res) => {
    try {
      const { search, status, plan, limit, offset } = req.query;
      const tenants = models.listTenants({ search, status, plan, limit, offset });
      
      const allTenants = models.listTenants();
      const activeCount = allTenants.filter(t => t.effective_status === 'ACTIVE').length;
      const expiringCount = allTenants.filter(t => t.effective_status === 'ACTIVE' && t.days_left <= 7).length;
      const expiredCount = allTenants.filter(t => t.effective_status === 'EXPIRED').length;
      const suspendedCount = allTenants.filter(t => t.effective_status === 'SUSPENDED').length;

      res.json({
        success: true,
        summary: {
          total: allTenants.length,
          active: activeCount,
          expiring_soon: expiringCount,
          expired: expiredCount,
          suspended: suspendedCount
        },
        tenants
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/saas/tenants/:id', (req, res) => {
    try {
      const tenant = models.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
      const metrics = models.getTenantMetrics(tenant.id);
      const logs = models.getTenantLicenseLogs(tenant.id, 20);
      res.json({ success: true, tenant, metrics, logs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants', (req, res) => {
    try {
      const tenant = models.createTenant(req.body);
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/saas/tenants/:id', (req, res) => {
    try {
      const tenant = models.updateTenant(req.params.id, req.body);
      if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants/:id/renew', (req, res) => {
    try {
      const days = Number(req.body.days || req.body.duration_days || 30);
      const notes = req.body.notes || '';
      const tenant = models.renewTenantLicense(req.params.id, days, notes);
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants/:id/pause', (req, res) => {
    try {
      const reason = req.body.reason || '';
      const tenant = models.pauseTenantLicense(req.params.id, reason);
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants/:id/resume', (req, res) => {
    try {
      const tenant = models.resumeTenantLicense(req.params.id);
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants/:id/regenerate-key', (req, res) => {
    try {
      const tenant = models.regenerateTenantLicenseKey(req.params.id);
      res.json({ success: true, tenant, license_key: tenant.license_key });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/saas/tenants/:id/impersonate', (req, res) => {
    try {
      const tenant = models.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
      const session = models.createTenantSession(tenant.id, 24);
      res.json({ success: true, token: session.token, redirectUrl: `/tenant/dashboard?token=${session.token}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/saas/tenants/:id', (req, res) => {
    try {
      models.deleteTenant(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Rotas de Autenticação e Operação do Próprio Tenant ---
  function getTenantFromRequest(req) {
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.query.token) {
      token = req.query.token;
    } else if (req.headers['x-tenant-token']) {
      token = req.headers['x-tenant-token'];
    }
    if (!token) return null;
    return models.validateTenantSession(token);
  }

  app.post('/api/tenant/auth/login', (req, res) => {
    try {
      const { license_key, identifier, password } = req.body;
      let tenant = null;

      if (license_key && license_key.trim()) {
        tenant = models.getTenantByLicenseKey(license_key);
        if (!tenant) return res.status(401).json({ error: 'Chave de licença inválida ou inexistente.' });
      } else if (identifier && identifier.trim()) {
        const cleanId = identifier.trim();
        tenant = models.getTenantBySlug(cleanId) || models.getTenantByPhone(cleanId);
        if (!tenant) {
          const row = models.db ? models.db.prepare('SELECT id FROM saas_tenants WHERE owner_email = ?').get(cleanId) : null;
          if (row) tenant = models.getTenantById(row.id);
        }
        if (!tenant) return res.status(401).json({ error: 'Tenant não encontrado.' });

        if (tenant.password_hash) {
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256').update(String(password || '').trim()).digest('hex');
          if (hash !== tenant.password_hash) {
            return res.status(401).json({ error: 'Senha incorreta.' });
          }
        }
      } else {
        return res.status(400).json({ error: 'Informe a Chave de Licença ou Identificador de Acesso.' });
      }

      if (tenant.effective_status === 'SUSPENDED') {
        return res.status(403).json({ error: 'Esta licença está temporariamente suspensa pelo suporte técnico.' });
      }

      const session = models.createTenantSession(tenant.id, 72);
      res.json({
        success: true,
        token: session.token,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
          status: tenant.effective_status,
          days_left: tenant.days_left,
          is_expired: tenant.is_expired,
          expires_at: tenant.expires_at,
          modules_enabled: tenant.modules_enabled,
          max_bots: tenant.max_bots,
          max_products: tenant.max_products
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tenant/auth/me', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
      res.json({ success: true, tenant });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/auth/logout', (req, res) => {
    try {
      const token = req.body.token || req.headers['x-tenant-token'] || (req.headers['authorization']?.slice(7));
      if (token) models.destroyTenantSession(token);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tenant/dashboard', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });

      const metrics = models.getTenantMetrics(tenant.id);
      const recentOrders = models.getOrdersByTenant(tenant.id, 10);
      const bots = models.getArmyInstancesByTenant(tenant.id);
      const products = models.getProductsByTenant(tenant.id);

      res.json({
        success: true,
        tenant,
        metrics,
        recentOrders,
        bots,
        products
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tenant/products', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });
      const products = models.getProductsByTenant(tenant.id);
      res.json({ success: true, products });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tenant/products', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });

      const currentProducts = models.getProductsByTenant(tenant.id);
      if (currentProducts.length >= tenant.max_products) {
        return res.status(400).json({ error: `Limite do plano atingido: máximo de ${tenant.max_products} produtos cadastrados. Faça upgrade para aumentar.` });
      }

      const prodData = {
        ...req.body,
        tenant_id: tenant.id
      };
      const created = models.createProduct(prodData);
      res.json({ success: true, product: created });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tenant/orders', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });
      const limit = Number(req.query.limit || 50);
      const orders = models.getOrdersByTenant(tenant.id, limit);
      res.json({ success: true, orders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tenant/bots', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });
      const bots = models.getArmyInstancesByTenant(tenant.id);
      res.json({ success: true, bots, max_bots: tenant.max_bots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tenant/license', (req, res) => {
    try {
      const tenant = getTenantFromRequest(req);
      if (!tenant) return res.status(401).json({ error: 'Não autorizado' });

      const logs = models.getTenantLicenseLogs(tenant.id, 20);
      const adminPhone = models.getSetting('OWNER_WHATSAPP', '554884702848');

      res.json({
        success: true,
        license: {
          license_key: tenant.license_key,
          plan: tenant.plan,
          status: tenant.effective_status,
          is_lifetime: Boolean(tenant.is_lifetime),
          starts_at: tenant.starts_at,
          expires_at: tenant.expires_at,
          days_left: tenant.days_left,
          is_expired: tenant.is_expired,
          max_bots: tenant.max_bots,
          max_products: tenant.max_products,
          modules_enabled: tenant.modules_enabled,
          support_whatsapp: adminPhone
        },
        logs
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

/**
 * Cria o servidor HTTP da Loja Pública e Vitrine (Porta 3001)
 * Isolado fisicamente do painel administrativo e exposto via Store Tunnel
 */
function createStoreServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Bloqueio rigoroso do painel administrativo no túnel da loja pública
  const blockedAdminPrefixes = [
    '/index.html', '/app.js', '/api/settings', '/api/botdeck',
    '/api/cognitive', '/api/army', '/api/sellers', '/api/affiliates',
    '/api/export', '/api/metrics', '/api/system', '/api/moderation',
    '/api/orders', '/api/companies', '/api/rentals', '/api/stats',
    '/api/zapvoice', '/api/features'
  ];
  app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (blockedAdminPrefixes.some(prefix => p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '?'))) {
      return res.status(403).send('<h1>403 Forbidden - Área Administrativa Restrita ao Dono</h1>');
    }
    next();
  });

  // Assets estáticos públicos (CSS, imagens, etc.) SEM servir index.html na raiz
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    maxAge: 3600000,
    etag: true
  }));

  // Raiz e rotas da vitrine e catálogo: exibe a loja store.html
  app.get(['/', '/loja', '/catalogo', '/vitrine', '/store'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'store.html'));
  });

  // Produtos e categorias da loja pública
  app.get('/api/store/products', (req, res) => {
    try {
      const { category, search, subbot } = req.query;
      let products;
      let categories = ['Todos'];

      if (subbot) {
        const subBotProds = models.getSubBotProducts(subbot);
        if (subBotProds && subBotProds.length > 0) {
          products = subBotProds;
        } else {
          products = models.getStoreProducts();
        }
      } else {
        products = models.getStoreProducts();
      }

      categories = [...new Set(products.map(p => p.category || 'Geral'))];

      if (category && category !== 'Todos') {
        products = products.filter(p => (p.category || 'Geral').toLowerCase() === category.toLowerCase());
      }

      if (search) {
        const s = search.toLowerCase();
        products = products.filter(p =>
          (p.name && p.name.toLowerCase().includes(s)) ||
          (p.description && p.description.toLowerCase().includes(s))
        );
      }

      res.json({ success: true, products, categories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Validação de Cupom
  app.post('/api/store/coupon', (req, res) => {
    try {
      const { code, amount } = req.body;
      if (!code) return res.status(400).json({ error: 'Código de cupom obrigatório.' });

      const coupon = models.getCouponByCode(code);
      if (!coupon) return res.status(404).json({ error: 'Cupom inválido ou não encontrado.' });
      if (!coupon.active) return res.status(400).json({ error: 'Este cupom está inativo.' });
      if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
        return res.status(400).json({ error: 'Este cupom atingiu o limite de usos.' });
      }
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Este cupom expirou.' });
      }

      let discount = 0;
      const numAmount = parseFloat(amount || 0);
      if (coupon.discount_percent) {
        discount = (numAmount * coupon.discount_percent) / 100;
      } else if (coupon.discount_amount) {
        discount = Math.min(numAmount, coupon.discount_amount);
      }

      res.json({
        success: true,
        coupon: {
          code: coupon.code,
          discount_amount: discount,
          final_amount: Math.max(0, numAmount - discount)
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Checkout da Loja Pública
  // Telemetria da Vitrine Web
  app.post('/api/store/track', async (req, res) => {
    try {
      const webStoreTrackerService = require('../services/webStoreTrackerService');
      const result = await webStoreTrackerService.trackEvent(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/telemetry', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const phone = req.query.phone || null;
      const events = models.getStoreTelemetry(limit, phone);
      res.json({ success: true, events });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/cart-sessions', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const status = req.query.status || null;
      const sessions = models.listCartSessions(limit, status);
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/cart-sessions/abandoned', (req, res) => {
    try {
      const minutes = parseInt(req.query.minutes, 10) || 30;
      const sessions = models.getAbandonedCartSessions(minutes);
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoints do Motor de Social Listening (Grupos & Afiliados)
  app.get('/api/social-listening/rules', (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === 'true';
      const rules = models.listSocialListeningRules(activeOnly);
      res.json({ success: true, rules });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/social-listening/rules', (req, res) => {
    try {
      const rule = models.saveSocialListeningRule(req.body);
      res.json({ success: true, rule });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/social-listening/rules/:id', (req, res) => {
    try {
      const deleted = models.deleteSocialListeningRule(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/social-listening/toggle', (req, res) => {
    try {
      const current = models.getSetting('SOCIAL_LISTENING_ENABLED', 'true') === 'true';
      const nextVal = req.body.enabled !== undefined ? Boolean(req.body.enabled) : !current;
      models.setSetting('SOCIAL_LISTENING_ENABLED', String(nextVal));
      res.json({ success: true, enabled: nextVal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/store/checkout', async (req, res) => {
    try {
      const { items = [], customer = {}, gateway = 'pix', couponCode = null, subbot = null } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'O carrinho está vazio.' });
      }

      const customerName = customer.name ? customer.name.trim() : 'Cliente Web';
      const customerPhone = customer.phone ? customer.phone.replace(/\D/g, '') : '';
      const customerAddress = customer.address || '';
      const notes = customer.notes || '';

      let subtotalBRL = 0;
      let subtotalUSDT = 0;
      const verifiedItems = [];

      for (const it of items) {
        const prod = models.getProductById(it.id);
        if (!prod) continue;
        const qty = Math.max(1, Number(it.quantity || 1));
        const priceBRL = Number(prod.price_brl || prod.price);
        const priceUSDT = Number(prod.price_usdt || (priceBRL / 5.5).toFixed(2));
        subtotalBRL += priceBRL * qty;
        subtotalUSDT += priceUSDT * qty;
        verifiedItems.push({
          id: prod.id,
          name: prod.name,
          category: prod.category || 'Geral',
          quantity: qty,
          unitPriceBRL: priceBRL,
          unitPriceUSDT: priceUSDT,
          totalBRL: priceBRL * qty,
          totalUSDT: priceUSDT * qty
        });
      }

      if (verifiedItems.length === 0) {
        return res.status(400).json({ error: 'Nenhum produto válido encontrado no carrinho.' });
      }

      let discountBRL = 0;
      if (couponCode) {
        const coupon = models.getCouponByCode(couponCode);
        if (coupon && coupon.active && (coupon.max_uses === 0 || coupon.used_count < coupon.max_uses)) {
          const isPercent = Boolean((coupon.discount_percent && coupon.discount_percent > 0) || coupon.discount_type === 'percent');
          const discountVal = Number(coupon.discount_percent || coupon.discount_amount || coupon.discount_value || 0);
          if (isPercent) {
            discountBRL = subtotalBRL * (discountVal / 100);
          } else {
            discountBRL = Math.min(subtotalBRL, discountVal);
          }
          if (typeof models.useCoupon === 'function') {
            models.useCoupon(coupon.code);
          }
        }
      }

      const finalBRL = Math.max(0.50, Math.round((subtotalBRL - discountBRL) * 100) / 100);
      const finalUSDT = Math.max(0.10, Math.round((finalBRL / 5.5) * 100) / 100);

      const tradeNo = `ORD_WEB_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const mainProd = verifiedItems[0];

      let pixCode = null;
      let qrContent = null;
      let checkoutUrl = null;

      if (gateway === 'pix') {
        const pixRes = await pixPayment.createPixCharge({
          merchantTradeNo: tradeNo,
          amount: finalBRL,
          goodsName: `Pedido Loja Web: ${verifiedItems.map(i => i.name).join(', ').slice(0, 80)}`,
          payerName: customerName
        });
        pixCode = pixRes.data?.pixCode || pixRes.pixCode || pixRes.data?.emv || pixRes.emv;
        qrContent = pixRes.data?.qrCodeBase64 || pixRes.data?.checkoutUrl || pixRes.qrContent;
        checkoutUrl = pixRes.data?.checkoutUrl || pixRes.checkoutUrl;
      } else if (gateway === 'binancepay') {
        const binRes = await binancePay.createOrder({
          merchantTradeNo: tradeNo,
          amount: finalUSDT,
          currency: 'USDT',
          goodsName: `Pedido Loja Web (${verifiedItems.length} itens)`,
          goodsDetail: verifiedItems.map(i => `${i.quantity}x ${i.name}`).join(', ').slice(0, 200)
        });
        checkoutUrl = binRes.data?.checkoutUrl || binRes.data?.universalUrl || binRes.checkoutUrl || binRes.universalUrl;
        qrContent = binRes.data?.qrContent || binRes.data?.qrcodeLink || binRes.qrContent;
      }

      const webStoreTrackerService = require('../services/webStoreTrackerService');
      let sellerId = mainProd.seller_id || null;
      let targetPhone = webStoreTrackerService.getBotContactPhone(subbot);
      if (subbot) {
        const subInstance = models.getArmyInstanceById(Number(subbot));
        if (subInstance) {
          sellerId = subInstance.id;
          if (subInstance.phone) {
            targetPhone = subInstance.phone;
          }
        }
      }

      const order = models.createOrder({
        merchant_trade_no: tradeNo,
        product_id: mainProd.id,
        platform: 'whatsapp',
        platform_user_id: customerPhone || 'web_guest',
        platform_user_name: customerName,
        gateway,
        amount: gateway === 'pix' ? finalBRL : finalUSDT,
        currency: gateway === 'pix' ? 'BRL' : 'USDT',
        status: 'PENDING',
        pix_code: pixCode,
        qr_content: qrContent,
        checkout_url: checkoutUrl,
        coupon_code: couponCode,
        discount_amount: discountBRL,
        seller_id: sellerId
      });

      // Atualiza / Registra sessão do carrinho como pedido realizado
      if (req.body.session_id) {
        try {
          models.saveCartSession({
            session_id: req.body.session_id,
            phone: customerPhone,
            customer_name: customerName,
            cart_items: JSON.stringify(verifiedItems),
            cart_total: finalBRL,
            status: 'ORDER_PLACED'
          });
        } catch (_) {}
      }

      // Dispara confirmação automática via WhatsApp para o cliente e alerta para o dono
      try {
        webStoreTrackerService.notifyOrderPlaced({
          tradeNo,
          customerName,
          customerPhone,
          items: verifiedItems,
          finalBRL,
          gateway,
          pixCode
        }).catch(() => {});
      } catch (_) {}

      let itemsListText = verifiedItems.map(i => `• ${i.quantity}x *${i.name}* (R$ ${i.totalBRL.toFixed(2)})`).join('\n');
      let waMessage = 
        `🛒 *NOVO PEDIDO DA VITRINE WEB (#${tradeNo})*\n\n` +
        `👤 *Cliente:* ${customerName}\n` +
        `📱 *WhatsApp:* +${customerPhone || 'Não informado'}\n` +
        (customerAddress ? `📍 *Entrega:* ${customerAddress}\n` : '') +
        (notes ? `📝 *Observação:* ${notes}\n` : '') +
        `\n📦 *Itens do Pedido:*\n${itemsListText}\n\n` +
        `💰 *Subtotal:* R$ ${subtotalBRL.toFixed(2)}\n` +
        (discountBRL > 0 ? `🎟️ *Desconto Cupom (${couponCode}):* -R$ ${discountBRL.toFixed(2)}\n` : '') +
        `💳 *Total a Pagar:* *R$ ${finalBRL.toFixed(2)}* (${finalUSDT.toFixed(2)} USDT)\n` +
        `⚡ *Forma de Pagamento:* ${gateway.toUpperCase()}\n\n` +
        (pixCode ? `🔑 *PIX Copia e Cola:* \`${pixCode}\`\n\n` : '') +
        `_Aguardando confirmação do pagamento pelo sistema automático._`;

      const botPhone = String(targetPhone).replace(/\D/g, '');
      const waUrl = `https://wa.me/${botPhone}?text=${encodeURIComponent(waMessage)}`;

      res.json({
        success: true,
        tradeNo,
        amountBRL: finalBRL,
        amountUSDT: finalUSDT,
        gateway,
        pixCode,
        qrContent,
        checkoutUrl,
        whatsappCheckoutUrl: waUrl,
        order
      });
    } catch (err) {
      console.error('[Store Checkout Error]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Visualização Pública Interativa da Proposta (/proposta/:token)
  app.get('/proposta/:token', (req, res) => {
    try {
      const token = req.params.token;
      const proposal = models.getProposalByToken(token);
      if (!proposal) {
        return res.status(404).send('<h1>Proposta não encontrada ou link expirado.</h1>');
      }
      models.incrementProposalViews(token, req.ip);
      const proposalService = require('../services/proposalService');
      const tunnelService = require('../services/tunnelService');
      const baseUrl = tunnelService.getStoreUrl() || `http://localhost:${config.storePort || 3001}`;
      const html = proposalService.renderProposalHtml(proposal, baseUrl);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send(`Erro ao carregar proposta: ${err.message}`);
    }
  });

  // Aceite Digital da Proposta
  app.post('/api/proposals/:token/accept', (req, res) => {
    try {
      const token = req.params.token;
      const { name } = req.body || {};
      const accepted = models.acceptProposal(token, { ip: req.ip, name });
      res.json({ success: true, proposal: accepted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhooks de Pagamento (acessíveis externamente pelo túnel da loja)
  app.post('/api/binance/webhook', async (req, res) => {
    try {
      const result = await binancePay.handleWebhook(req.body);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/pix/webhook', async (req, res) => {
    try {
      const result = await pixPayment.handleWebhook(req.body);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Slots de Reunião para agendamento
  app.get('/api/meetings/slots', (req, res) => {
    try {
      const { date } = req.query;
      const slots = models.getAvailableMeetingSlots(date);
      res.json({ success: true, ...slots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Redirecionamento do Lançamento Meteórico
  app.get(['/l/vip', '/meteoro', '/vip', '/api/meteoric/redirect'], (req, res) => {
    try {
      models.incrementMeteoricLeads();
      const activeGroup = models.getActiveMeteoricGroup();
      if (activeGroup && activeGroup.invite_url) {
        return res.redirect(activeGroup.invite_url);
      }
      res.send('<h2>Grupo VIP de Lançamento</h2><p>As inscrições abrirão em breve.</p>');
    } catch (err) {
      res.status(500).send('Erro');
    }
  });

  return app;
}

module.exports = { createServer, createStoreServer };

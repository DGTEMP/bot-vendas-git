const assert = require('assert');
const models = require('./src/db/models');
const bacenPixService = require('./src/services/bacenPixService');
const pixPayment = require('./src/services/pixPayment');
const { createServer } = require('./src/server/app');

async function runTests() {
  console.log('🧪 ====================================================');
  console.log('🧪 TESTES DE INTEGRAÇÃO BACEN PIX API (bacen/pix-api)');
  console.log('🧪 ====================================================\n');

  const origBacenEnabled = models.getSetting('GATEWAY_BACEN_PIX_ENABLED');
  const origPrimary = models.getSetting('PIX_PRIMARY_PROVIDER');
  const origClientId = models.getSetting('BACEN_CLIENT_ID');
  const origClientSecret = models.getSetting('BACEN_CLIENT_SECRET');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Presets e Configurações
  await test('bacenPixService possui presets oficiais configurados', async () => {
    assert(bacenPixService.constructor.PRESETS.efi, 'Preset Efí deve existir');
    assert(bacenPixService.constructor.PRESETS.inter, 'Preset Banco Inter deve existir');
    assert(bacenPixService.constructor.PRESETS.bb, 'Preset Banco do Brasil deve existir');
    assert(bacenPixService.constructor.PRESETS.itau, 'Preset Itaú Empresas deve existir');
    assert(bacenPixService.constructor.PRESETS.santander, 'Preset Santander deve existir');
    assert(bacenPixService.constructor.PRESETS.bradesco, 'Preset Bradesco deve existir');
    assert(bacenPixService.constructor.PRESETS.sicoob, 'Preset Sicoob deve existir');
    assert(bacenPixService.constructor.PRESETS.sicredi, 'Preset Sicredi deve existir');
    assert(bacenPixService.constructor.PRESETS.asaas, 'Preset Asaas deve existir');
  });

  // 2. Formatação de txid padrão estrito BACEN
  await test('formatBacenTxid gera txid válido de 26 a 35 caracteres alfanuméricos', async () => {
    const rawTradeNo = 'ORD_QUICK_1730761234';
    const txid = bacenPixService.formatBacenTxid(rawTradeNo);
    assert(txid.length >= 26 && txid.length <= 35, `txid deve ter entre 26 e 35 caracteres (tem ${txid.length})`);
    assert(/^[a-zA-Z0-9]{26,35}$/.test(txid), `txid deve ser estritamente alfanumérico conforme BACEN: ${txid}`);

    const longTradeNo = 'ORD_SUPER_LONG_TRADE_NUMBER_EXCEEDING_35_CHARACTERS_1234567890';
    const txidLong = bacenPixService.formatBacenTxid(longTradeNo);
    assert(txidLong.length <= 35, 'txid longo deve ser truncado para no máximo 35 caracteres');
    assert(/^[a-zA-Z0-9]{26,35}$/.test(txidLong), 'txid longo sanitizado deve ser válido');
  });

  // 3. Cálculo de CRC16-CCITT
  await test('computeCRC16 gera checksum de 4 caracteres hexadecimais correto', async () => {
    const testPayload = '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913PAYBOT VENDAS6009SAO PAULO62070503***6304';
    const crc = bacenPixService.computeCRC16(testPayload);
    assert.strictEqual(crc.length, 4, 'CRC deve ter exatamente 4 caracteres');
    assert.strictEqual(crc, '5268', 'Checksum calculado deve bater com a especificação');
  });

  // 4. Gerador de EMVCo BR Code (Pix Copia e Cola)
  await test('generateBrcode constrói código Pix Copia e Cola com formato EMVCo', async () => {
    const brcode = bacenPixService.generateBrcode({
      location: 'pix.bcb.gov.br/qr/v2/cob123456789',
      chave: '12345678000199',
      amount: '75.50',
      merchantName: 'MINHA LOJA',
      merchantCity: 'SAO PAULO',
      txid: 'COB1234567890123456789012345'
    });

    assert(brcode.startsWith('000201'), 'BR Code deve iniciar com Tag 00 Payload Format 01');
    assert(brcode.includes('br.gov.bcb.pix'), 'BR Code deve conter GUI oficial do BACEN');
    assert(brcode.includes('540575.50'), 'BR Code deve conter Tag 54 com valor formatado');
    assert(brcode.includes('5802BR'), 'BR Code deve conter país BR');
  });

  // 5. Criação de cobrança em modo sandbox
  await test('createCharge gera cobrança completa com QRCode e Copia e Cola', async () => {
    models.setSetting('GATEWAY_BACEN_PIX_ENABLED', 'true');
    models.setSetting('BACEN_PIX_SANDBOX', 'true');
    models.setSetting('BACEN_PIX_KEY', 'financeiro@loja.com.br');

    const tradeNo = `ORD_BACEN_TEST_${Date.now()}`;
    const cobRes = await bacenPixService.createCharge({
      merchantTradeNo: tradeNo,
      amount: 49.90,
      goodsName: 'Licença Anual VIP',
      payerName: 'Maria Silva'
    });

    assert.strictEqual(cobRes.success, true);
    assert.strictEqual(cobRes.gateway, 'bacen');
    assert(cobRes.data.pixCode, 'Deve conter código Pix Copia e Cola');
    assert(cobRes.data.qrBuffer, 'Deve conter Buffer de imagem do QR Code');
    assert(cobRes.data.qrCodeBase64, 'Deve conter Base64 do QR Code');
    assert(cobRes.data.txid, 'Deve conter txid BACEN');
    assert(cobRes.data.txid.length >= 26, 'txid deve ser compatível com padrão BACEN');
  });

  // 6. Testador de Conexão OAuth BACEN
  await test('testConnection reporta diagnóstico detalhado', async () => {
    models.setSetting('BACEN_PIX_PSP', 'efi');
    models.setSetting('BACEN_PIX_BASE_URL', 'https://pix-h.api.efipay.com.br');
    models.setSetting('BACEN_PIX_CLIENT_ID', 'test_client_id_123');
    models.setSetting('BACEN_PIX_CLIENT_SECRET', 'test_client_secret_456');

    const testRes = await bacenPixService.testConnection();
    assert(typeof testRes.success === 'boolean');
    assert(testRes.presetName || testRes.psp);
    assert(testRes.latencyMs >= 0);
  });

  // 7. Roteamento pelo PixPaymentService
  await test('pixPayment.createPixCharge roteia para BACEN quando configurado como primário', async () => {
    models.setSetting('GATEWAY_BACEN_PIX_ENABLED', 'true');
    models.setSetting('PIX_PRIMARY_PROVIDER', 'bacen');
    models.setSetting('BACEN_PIX_KEY', '11999998888');

    const tradeNo = `ORD_ROUTER_${Date.now()}`;
    const res = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo,
      amount: 25.00,
      goodsName: 'Créditos Bot',
      payerName: 'João Teste'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.gateway, 'bacen');
    assert(res.data.pixCode);
  });

  // 8. Notificação Webhook BACEN & Fulfillment
  await test('handleWebhook processa notificação oficial BACEN e conclui pedido', async () => {
    const tradeNo = `ORD_HOOK_${Date.now()}`;
    const txid = bacenPixService.formatBacenTxid(tradeNo);

    // Cria produto e pedido pendente para teste
    const prod = models.createProduct({
      name: 'Produto Teste Webhook BACEN',
      description: 'Teste',
      price: 15.00,
      type: 'digital_link',
      content: 'https://exemplo.com/download'
    });

    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'telegram',
      platform_user_id: '77889900',
      product_id: prod.id,
      gateway: 'bacen',
      amount: 15.00,
      prepay_id: txid,
      status: 'PENDING'
    });

    const webhookPayload = {
      pix: [
        {
          endToEndId: 'E0000000020261104123456789012345',
          txid: txid,
          chave: 'financeiro@loja.com.br',
          valor: '15.00',
          horario: new Date().toISOString()
        }
      ]
    };

    const hookResult = await bacenPixService.handleWebhook(webhookPayload);
    assert.strictEqual(hookResult.success, true);
    assert.strictEqual(hookResult.processedCount, 1);

    const updatedOrder = models.getOrderByTradeNo(tradeNo);
    assert.strictEqual(updatedOrder.status, 'PAID', 'Status do pedido deve ter mudado para PAID');
    assert(updatedOrder.delivered_content, 'Conteúdo deve ter sido entregue pelo fulfillment');
  });

  // 9. Endpoints REST do Servidor Express
  await test('GET /api/settings e POST /api/settings persistem configurações BACEN Pix', async () => {
    const app = createServer();
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    try {
      // POST salvando novas configs BACEN
      const postRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          GATEWAY_BACEN_PIX_ENABLED: true,
          PIX_PRIMARY_PROVIDER: 'bacen',
          BACEN_PIX_PSP: 'inter',
          BACEN_PIX_KEY: 'contato@meunegocio.com',
          BACEN_PIX_BASE_URL: 'https://cdpj.partners.bancointer.com.br',
          BACEN_PIX_CLIENT_ID: 'inter_id_999',
          BACEN_PIX_CLIENT_SECRET: 'inter_sec_999'
        })
      });
      const postData = await postRes.json();
      assert.strictEqual(postData.success, true);

      // GET conferindo configs retornadas
      const getRes = await fetch(`${baseUrl}/api/settings`);
      const cfg = await getRes.json();
      assert.strictEqual(cfg.GATEWAY_BACEN_PIX_ENABLED, true);
      assert.strictEqual(cfg.PIX_PRIMARY_PROVIDER, 'bacen');
      assert.strictEqual(cfg.BACEN_PIX_PSP, 'inter');
      assert.strictEqual(cfg.BACEN_PIX_KEY, 'contato@meunegocio.com');
      assert(cfg.webhooks.bacen.includes('/api/bacen-pix/webhook'), 'Webhook BACEN deve estar exposto');
    } finally {
      server.close();
      models.setSetting('GATEWAY_BACEN_PIX_ENABLED', origBacenEnabled || 'false');
      models.setSetting('PIX_PRIMARY_PROVIDER', origPrimary || 'livepix');
      models.setSetting('BACEN_CLIENT_ID', origClientId || '');
      models.setSetting('BACEN_CLIENT_SECRET', origClientSecret || '');
    }
  });

  // 10. Endpoint Webhook HTTP /api/bacen-pix/webhook
  await test('POST /api/bacen-pix/webhook responde 200 e confirma pagamento', async () => {
    const app = createServer();
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    try {
      const tradeNo = `ORD_HTTP_HOOK_${Date.now()}`;
      const txid = bacenPixService.formatBacenTxid(tradeNo);

      const prod = models.createProduct({
        name: 'Curso Web BACEN Pix',
        price: 99.00,
        type: 'digital_link',
        content: 'https://curso.com'
      });

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'whatsapp',
        platform_user_id: '5511999998888',
        product_id: prod.id,
        gateway: 'bacen',
        amount: 99.00,
        prepay_id: txid,
        status: 'PENDING'
      });

      // Teste do handshake GET
      const getHandshake = await fetch(`${baseUrl}/api/bacen-pix/webhook`);
      assert.strictEqual(getHandshake.status, 200, 'Handshake GET do webhook deve responder 200 OK');

      // Teste do POST com notificação
      const postWebhook = await fetch(`${baseUrl}/api/bacen-pix/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pix: [
            {
              endToEndId: 'E9999999920261104987654321',
              txid: txid,
              valor: '99.00'
            }
          ]
        })
      });

      assert.strictEqual(postWebhook.status, 200);
      const resJson = await postWebhook.json();
      assert.strictEqual(resJson.success, true);

      const order = models.getOrderByTradeNo(tradeNo);
      assert.strictEqual(order.status, 'PAID');
    } finally {
      server.close();
      models.setSetting('GATEWAY_BACEN_PIX_ENABLED', origBacenEnabled || 'false');
      models.setSetting('PIX_PRIMARY_PROVIDER', origPrimary || 'livepix');
      models.setSetting('BACEN_CLIENT_ID', origClientId || '');
      models.setSetting('BACEN_CLIENT_SECRET', origClientSecret || '');
    }
  });

  // 11. Cobrança Rápida via Painel Web (/api/quick-charge com gateway bacen)
  await test('POST /api/quick-charge com gateway=bacen gera cobrança e salva pedido', async () => {
    const app = createServer();
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    try {
      const prod = models.createProduct({
        name: 'Plano Rápido BACEN',
        price: 39.90,
        type: 'digital_link',
        content: 'https://acesso.com'
      });

      const res = await fetch(`${baseUrl}/api/quick-charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: prod.id,
          gateway: 'bacen',
          customerName: 'Cliente Rápido BACEN'
        })
      });

      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert(data.tradeNo);
      assert(data.pixCode);
      assert(data.qrContent);

      const order = models.getOrderByTradeNo(data.tradeNo);
      assert.strictEqual(order.gateway, 'bacen');
      assert.strictEqual(order.status, 'PENDING');
    } finally {
      server.close();
      models.setSetting('GATEWAY_BACEN_PIX_ENABLED', origBacenEnabled || 'false');
      models.setSetting('PIX_PRIMARY_PROVIDER', origPrimary || 'livepix');
      models.setSetting('BACEN_CLIENT_ID', origClientId || '');
      models.setSetting('BACEN_CLIENT_SECRET', origClientSecret || '');
    }
  });

  console.log(`\n====================================================`);
  console.log(`📊 RESULTADO: ${passed} PASSOU | ${failed} FALHOU`);
  console.log(`====================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const pixPayment = require('./src/services/pixPayment');
const whatsappBot = require('./src/bots/whatsappBot');
const fulfillment = require('./src/services/fulfillment');
const { createServer } = require('./src/server/app');

async function runTests() {
  console.log('🧪 INICIANDO TESTES DO GATEWAY LIVEPIX COMO PIX SECUNDÁRIO / FALLBACK\n');

  // Inicializa servidor http local em porta efêmera para os testes de API
  const app = createServer();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Salva estados originais das configurações
  const origMpToken = models.getSetting('MERCADO_PAGO_ACCESS_TOKEN', '');
  const origLivepixUser = models.getSetting('LIVEPIX_USERNAME', '');
  const origLivepixEnabled = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'false');
  const origSimMode = models.getSetting('PIX_SIMULATION_MODE', 'true');
  const origEnvMode = models.getSetting('ENVIRONMENT_MODE', 'sandbox');
  const origBacenEnabled = models.getSetting('GATEWAY_BACEN_PIX_ENABLED', 'false');
  const origPrimaryProvider = models.getSetting('PIX_PRIMARY_PROVIDER', 'livepix');
  models.setSetting('ENVIRONMENT_MODE', 'sandbox');
  models.setSetting('GATEWAY_BACEN_PIX_ENABLED', 'false');
  models.setSetting('PIX_PRIMARY_PROVIDER', 'livepix');

  try {
    // ==========================================
    // TESTE 1: LivePix como Secundário quando MP não está configurado
    // ==========================================
    console.log('--- TESTE 1: LivePix assume quando Mercado Pago não está configurado ---');
    models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', '');
    models.setSetting('GATEWAY_LIVEPIX_ENABLED', 'true');
    models.setSetting('LIVEPIX_USERNAME', 'techstore_vip');
    models.setSetting('PIX_SIMULATION_MODE', 'false');

    const tradeNo1 = `ORD_LPX_TEST_${Date.now()}`;
    const res1 = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo1,
      amount: 49.90,
      goodsName: 'Licença Tech PRO',
      payerName: 'Carlos Silva'
    });

    assert.strictEqual(res1.success, true, 'Deve gerar cobrança com sucesso');
    assert.strictEqual(res1.gateway, 'livepix', 'Gateway deve ser livepix');
    assert.strictEqual(res1.isLivepix, true, 'isLivepix deve ser true');
    assert.strictEqual(res1.isSimulated, false, 'Não deve ser simulado quando LivePix está configurado');
    assert(res1.data.checkoutUrl.includes('livepix.gg/techstore_vip'), 'Checkout URL deve apontar para o usuário LivePix');
    assert(res1.data.instructions.includes(tradeNo1), 'Instruções devem orientar colocar o código do pedido na mensagem');
    console.log('  ✅ PASS: LivePix assumiu como PIX secundário com sucesso:', res1.data.checkoutUrl);

    // ==========================================
    // TESTE 2: Fallback para LivePix quando MP falha na requisição
    // ==========================================
    console.log('\n--- TESTE 2: Fallback automático para LivePix em caso de falha no Mercado Pago ---');
    models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-TOKEN_INVALIDO_PARA_TESTE_FALHA_12345');
    models.setSetting('LIVEPIX_USERNAME', 'techstore_vip');
    models.setSetting('PIX_SIMULATION_MODE', 'false');

    const tradeNo2 = `ORD_LPX_FALLBACK_${Date.now()}`;
    const res2 = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo2,
      amount: 89.00,
      goodsName: 'Script Automatizador VIP',
      payerName: 'Mariana Costa'
    });

    assert.strictEqual(res2.success, true, 'Deve gerar cobrança via fallback com sucesso');
    assert.strictEqual(res2.gateway, 'livepix', 'Deve fazer fallback automático para livepix');
    assert.strictEqual(res2.isLivepix, true, 'isLivepix deve ser true após fallback');
    console.log('  ✅ PASS: Fallback para LivePix funcionou com sucesso após erro no Mercado Pago');

    // ==========================================
    // TESTE 3: Simulado quando nenhum dos dois está configurado
    // ==========================================
    console.log('\n--- TESTE 3: Fallback para Simulado quando nem MP nem LivePix estão configurados ---');
    models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', '');
    models.setSetting('LIVEPIX_USERNAME', '');
    models.setSetting('GATEWAY_LIVEPIX_ENABLED', 'false');
    const savedEnvUser = process.env.LIVEPIX_USERNAME;
    delete process.env.LIVEPIX_USERNAME;
    models.setSetting('PIX_SIMULATION_MODE', 'true');

    const tradeNo3 = `ORD_SIM_${Date.now()}`;
    const res3 = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo3,
      amount: 19.90,
      goodsName: 'Produto Teste Sandbox',
      payerName: 'Cliente Teste'
    });

    if (savedEnvUser) process.env.LIVEPIX_USERNAME = savedEnvUser;

    assert.strictEqual(res3.success, true, 'Deve gerar Pix simulado');
    assert.strictEqual(res3.isSimulated, true, 'Deve ser marcado como isSimulated');
    assert.strictEqual(res3.gateway, 'simulated');
    console.log('  ✅ PASS: Modo simulado atuou como último recurso na ausência de gateways reais');

    // ==========================================
    // TESTE 4: Fluxo de Pedido via WhatsApp com LivePix Secundário
    // ==========================================
    console.log('\n--- TESTE 4: WhatsAppBot gera pedido com gateway livepix e instruções corretas ---');
    models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', '');
    models.setSetting('GATEWAY_LIVEPIX_ENABLED', 'true');
    models.setSetting('LIVEPIX_USERNAME', 'canal_oficial_bot');

    const testProduct = models.getProducts ? (models.getProducts(true).find(p => p.type !== 'license_key') || models.getProducts(true)[0]) : null;
    assert(testProduct, 'Deve existir ao menos um produto no banco');
    if (testProduct.type === 'license_key') {
      models.addLicenseKeys(testProduct.id, ['KEY_TEST_' + Date.now()]);
    }

    const mockSock = {
      sendMessage: async (to, payload) => {
        mockSock.sentPayloads.push({ to, payload });
        return { key: { id: 'mock_wa_' + Date.now() } };
      },
      sentPayloads: []
    };

    const buyerJid = '5511977776655@s.whatsapp.net';
    await whatsappBot.processPixPurchase(buyerJid, 'Lucas Vendas', testProduct, mockSock);

    assert(mockSock.sentPayloads.length >= 2, 'Deve enviar fatura e imagem do QR code');
    const imagePayload = mockSock.sentPayloads.find(p => p.payload.image);
    assert(imagePayload, 'Deve enviar imagem do QR Code para LivePix');
    assert(imagePayload.payload.caption.includes('PIX'), 'Legenda deve identificar PIX');

    // Verifica envio da fatura com instruções de pagamento Pix
    const invoiceMsg = mockSock.sentPayloads.find(p => {
      const txt = typeof p.payload === 'string' ? p.payload : p.payload?.text;
      return typeof txt === 'string' && (txt.includes('PIX') || txt.includes('livepix.gg'));
    });
    assert(invoiceMsg, 'Deve enviar mensagem com fatura do Pix');

    // Se o LivePix fornecer código Pix Copia e Cola, verifica envio em mensagem separada
    const rawPixCodeMsg = mockSock.sentPayloads.find(p => p.payload?.text && p.payload.text.startsWith('000201'));
    if (rawPixCodeMsg) {
      console.log('  ℹ️ Pix Copia e Cola autêntico do LivePix presente');
    } else {
      console.log('  ℹ️ LivePix repassando link oficial preenchido com segurança (sem recriação de Pix falso)');
    }

    // Verifica que o pedido foi salvo no banco com gateway 'livepix'
    const recentOrders = models.getOrdersByCustomerPhone('5511977776655', 1);
    assert(recentOrders && recentOrders.length > 0, 'Deve ter salvo o pedido no banco');
    assert.strictEqual(recentOrders[0].gateway, 'livepix', 'Pedido no banco deve estar com gateway livepix');
    console.log('  ✅ PASS: WhatsAppBot enviou QR Code do LivePix e salvou pedido com gateway livepix');

    // ==========================================
    // TESTE 5: API de Checkout da Loja Web (/api/store/checkout)
    // ==========================================
    console.log('\n--- TESTE 5: Endpoint /api/store/checkout retorna gateway livepix e isLivepix=true ---');
    const resCheckoutRaw = await fetch(`${baseUrl}/api/store/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: testProduct.id, quantity: 1 }],
        customer: {
          name: 'Beatriz Loja',
          phone: '5511966665544'
        },
        gateway: 'pix'
      })
    });
    const resCheckout = await resCheckoutRaw.json();

    assert.strictEqual(resCheckoutRaw.status, 200, 'Status deve ser 200');
    assert.strictEqual(resCheckout.success, true, 'success deve ser true');
    assert.strictEqual(resCheckout.gateway, 'livepix', 'Gateway retornado deve ser livepix');
    assert.strictEqual(resCheckout.isLivepix, true, 'isLivepix retornado deve ser true');
    assert(resCheckout.checkoutUrl.includes('livepix.gg/canal_oficial_bot'), 'checkoutUrl deve apontar para LivePix');
    console.log('  ✅ PASS: Loja Web retornou checkout LivePix secundário com sucesso');

    // ==========================================
    // TESTE 6: Webhook do LivePix (/api/livepix/webhook) entrega produto automaticamente
    // ==========================================
    console.log('\n--- TESTE 6: Webhook LivePix identifica código do pedido e faz entrega automática ---');
    const targetOrderTradeNo = recentOrders[0].merchant_trade_no;

    // Simula a notificação que o LivePix envia quando alguém faz o PIX
    const resWebhookRaw = await fetch(`${baseUrl}/api/livepix/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'donation.received',
        data: {
          id: 'lpx_evt_998877',
          amount: testProduct.price_brl || testProduct.price,
          author: 'Lucas Vendas',
          message: `Opa, segue o pagamento do pedido ${targetOrderTradeNo} obrigado!`
        }
      })
    });
    const resWebhook = await resWebhookRaw.json();

    assert.strictEqual(resWebhookRaw.status, 200, 'Webhook deve responder com status 200');
    assert.strictEqual(resWebhook.success, true, 'Webhook deve processar com sucesso');

    // Verifica que o pedido no banco foi atualizado para PAID e entregue
    const updatedOrder = models.getOrderByTradeNo(targetOrderTradeNo);
    assert.strictEqual(updatedOrder.status, 'PAID', 'Pedido deve estar com status PAID após webhook do LivePix');
    console.log('  ✅ PASS: Webhook do LivePix identificou o pedido na mensagem e marcou como PAID com sucesso!');

    console.log('\n======================================================');
    console.log('🎉 TODOS OS 6 TESTES DO LIVEPIX SECUNDÁRIO PASSARAM COM SUCESSO!');
    console.log('======================================================\n');
  } finally {
    // Fecha servidor local de testes
    server.close();
    // Garante que o ambiente volte para o padrão seguro de produção
    models.setSetting('MERCADO_PAGO_ACCESS_TOKEN', origMpToken || '');
    models.setSetting('LIVEPIX_USERNAME', origLivepixUser === 'canal_oficial_bot' ? '' : (origLivepixUser || ''));
    models.setSetting('GATEWAY_LIVEPIX_ENABLED', origLivepixEnabled || 'true');
    models.setSetting('PIX_SIMULATION_MODE', origSimMode);
    models.setSetting('ENVIRONMENT_MODE', origEnvMode);
    models.setSetting('GATEWAY_BACEN_PIX_ENABLED', origBacenEnabled);
    models.setSetting('PIX_PRIMARY_PROVIDER', origPrimaryProvider);
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

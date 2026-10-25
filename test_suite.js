const http = require('http');
const assert = require('assert');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');
const fulfillment = require('./src/services/fulfillment');
const updatesChannel = require('./src/services/updatesChannel');
const binancePay = require('./src/services/binancePay');
const pixPayment = require('./src/services/pixPayment');
const subscriptionCron = require('./src/services/subscriptionCron');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failedTests++;
  }
}

async function main() {
  console.log('====================================================');
  console.log('🧪 INICIANDO BATERIA DE TESTES DE INTEGRIDADE PAYBOT');
  console.log('====================================================\n');

  // ----------------------------------------------------------------
  // 1. TESTES DE PRODUTOS E ESTOQUE
  // ----------------------------------------------------------------
  console.log('📦 1. Testes de Produtos & Estoque de Chaves:');
  
  let testProdDigital, testProdKey, testProdSub;

  runTest('Criação de Produto Digital', () => {
    testProdDigital = models.createProduct({
      name: 'E-book Cripto Trader 2026',
      description: 'Guia completo de trading',
      price: 49.90,
      price_brl: 49.90,
      price_usdt: 9.90,
      type: 'digital_link',
      content: 'https://exemplo.com/ebook.pdf'
    });
    assert(testProdDigital.id > 0, 'ID do produto deve ser > 0');
    assert.strictEqual(testProdDigital.name, 'E-book Cripto Trader 2026');
  });

  runTest('Criação de Produto de Chave de Licença com Estoque', () => {
    testProdKey = models.createProduct({
      name: 'Licença Bot Scalper Pro',
      description: 'Chave de acesso ao software',
      price: 199.00,
      price_brl: 199.00,
      price_usdt: 38.00,
      type: 'license_key'
    });
    assert(testProdKey.id > 0);

    const added = models.addKeys(testProdKey.id, ['KEY-AAAA-1111', 'KEY-BBBB-2222', 'KEY-CCCC-3333']);
    assert.strictEqual(added, 3, 'Deve ter adicionado 3 chaves');

    const available = models.getAvailableKeyCount(testProdKey.id);
    assert.strictEqual(available, 3, 'Estoque disponível deve ser 3');
  });

  runTest('Criação de Assinatura VIP', () => {
    testProdSub = models.createProduct({
      name: 'Canal VIP Sinais Cripto (Mensal)',
      description: 'Acesso por 30 dias',
      price: 99.00,
      price_brl: 99.00,
      price_usdt: 19.00,
      type: 'vip_subscription',
      duration_days: 30,
      telegram_channel_id: '-1009988776655'
    });
    assert(testProdSub.id > 0);
    assert.strictEqual(testProdSub.duration_days, 30);
  });

  // ----------------------------------------------------------------
  // 2. TESTES DE EQUIPES DE VENDAS & AFILIADOS
  // ----------------------------------------------------------------
  console.log('\n👔 2. Testes de Vendedores, Afiliados e Comissões:');

  let testSeller, testAffiliate;

  runTest('Criação e Rotação de Vendedor (Round-Robin)', () => {
    testSeller = models.createSeller({
      name: 'Vendedor Teste Unitário',
      email: 'vendedor.unit@paybot.com',
      phone: '5511999990099',
      telegram_username: 'vendedor_unit',
      commission_rate: 10.0
    });
    assert(testSeller.id > 0);

    const nextSeller = models.getNextRoundRobinSeller();
    assert(nextSeller !== null, 'Deve retornar um vendedor ativo para a roleta');
  });

  runTest('Criação de Afiliado com Código Único', () => {
    const uniqueRef = 'TESTREF' + Date.now().toString().slice(-4);
    testAffiliate = models.createAffiliate({
      name: 'Afiliado Teste Unitário',
      email: 'afiliado.unit@paybot.com',
      phone: '5511988880088',
      telegram_username: 'afiliado_unit',
      ref_code: uniqueRef,
      commission_rate: 20.0,
      pix_key: 'afiliado@pix.com',
      usdt_wallet: '0xTestWallet123456789'
    });
    assert(testAffiliate.id > 0);

    const fetched = models.getAffiliateByCode(uniqueRef);
    assert.strictEqual(fetched.id, testAffiliate.id, 'Deve encontrar afiliado pelo código');
  });

  // ----------------------------------------------------------------
  // 3. TESTES DE GATEWAYS DE PAGAMENTO (PIX & BINANCE)
  // ----------------------------------------------------------------
  console.log('\n💳 3. Testes de Criação de Cobranças (Pix & Binance Pay):');

  let testOrderPixTradeNo = 'ORD_TPIX_' + Date.now();
  let testOrderBinanceTradeNo = 'ORD_TBIN_' + Date.now();

  await runAsyncTest('Geração de Cobrança Pix (Simulação & QR Code)', async () => {
    const pixRes = await pixPayment.createPixCharge({
      merchantTradeNo: testOrderPixTradeNo,
      amount: testProdDigital.price_brl,
      goodsName: testProdDigital.name,
      payerName: 'Carlos Silva',
      payerEmail: 'carlos@exemplo.com'
    });

    assert(pixRes.success, 'Criação de Pix deve retornar success=true');
    assert(pixRes.data.pixCode, 'Deve gerar código Pix Copia e Cola');
    assert(pixRes.data.qrBuffer, 'Deve gerar buffer de imagem do QR Code');
  });

  await runAsyncTest('Geração de Cobrança Binance Pay (Simulação & Universal URL)', async () => {
    const binanceRes = await binancePay.createOrder({
      merchantTradeNo: testOrderBinanceTradeNo,
      amount: testProdSub.price_usdt,
      currency: 'USDT',
      goodsName: testProdSub.name,
      productId: testProdSub.id
    });

    assert(binanceRes.success, 'Criação Binance Pay deve retornar success=true');
    assert(binanceRes.data.checkoutUrl, 'Deve gerar URL de checkout');
  });

  // ----------------------------------------------------------------
  // 4. TESTES DE FULFILLMENT, ENTREGA E ATRIBUIÇÃO
  // ----------------------------------------------------------------
  console.log('\n🚀 4. Testes de Fulfillment, Entrega e Comissões:');

  let deliveredTgUserId = '11223344';
  let capturedTgMessages = [];
  let capturedChannelPosts = [];

  // Registra bots simulados no fulfillment
  fulfillment.registerTelegramBot({
    sendMessage: async (chatId, text) => {
      capturedTgMessages.push({ chatId, text });
      return true;
    },
    createInviteLink: async (channelId) => {
      return `https://t.me/+join_${Date.now()}`;
    },
    removeMember: async (channelId, userId) => {
      return true;
    }
  });

  updatesChannel.registerTelegramBroadcaster(async (channelId, text, options) => {
    capturedChannelPosts.push({ channelId, text, options });
    return true;
  });

  await runAsyncTest('Entrega de Licença de Estoque + Comissão de Afiliado + Roleta de Vendedor', async () => {
    const tradeNo = 'ORD_TEST_FULFILL_' + Date.now();
    const order = models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'telegram',
      platform_user_id: deliveredTgUserId,
      platform_user_name: 'Marcos Oliveira',
      product_id: testProdKey.id,
      gateway: 'mercadopago',
      amount: testProdKey.price_brl,
      currency: 'BRL',
      affiliate_id: testAffiliate.id,
      seller_id: testSeller.id,
      ref_code: testAffiliate.ref_code
    });

    assert(order.id > 0);

    const initialKeyCount = models.getAvailableKeyCount(testProdKey.id);
    const result = await fulfillment.fulfillOrder(tradeNo);

    assert(result.success, 'Fulfillment deve ter sucesso');
    const newKeyCount = models.getAvailableKeyCount(testProdKey.id);
    assert.strictEqual(newKeyCount, initialKeyCount - 1, 'Estoque deve ser decrementado em 1');

    // Verifica saldo do afiliado
    const updatedAffiliate = models.getAffiliateById(testAffiliate.id);
    const expectedComm = Number(((testProdKey.price_brl * testAffiliate.commission_rate) / 100).toFixed(2));
    assert(updatedAffiliate.balance_brl >= expectedComm, 'Saldo do afiliado deve ter sido creditado');

    // Verifica comissão registrada
    const commissions = models.getAllCommissions(5);
    const afilComm = commissions.find(c => c.order_id === order.id && c.beneficiary_type === 'affiliate');
    assert(afilComm, 'Deve existir comissão para o afiliado');
    assert.strictEqual(afilComm.amount, expectedComm);

    // Teste de liquidação / pagamento de comissão
    const paidComm = models.markCommissionPaid(afilComm.id, 'Comprovante PIX E2E-999');
    assert.strictEqual(paidComm.status, 'PAID');
    const reloadedAffiliate = models.getAffiliateById(testAffiliate.id);
    assert.strictEqual(reloadedAffiliate.balance_brl, updatedAffiliate.balance_brl - expectedComm, 'Saldo deve ter sido debitado');
  });

  await runAsyncTest('Ativação de Assinatura VIP + Cálculo de Expiração', async () => {
    const tradeNo = 'ORD_TEST_SUB_' + Date.now();
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'telegram',
      platform_user_id: '55667788',
      platform_user_name: 'Juliana Paes',
      product_id: testProdSub.id,
      gateway: 'binancepay',
      amount: testProdSub.price_usdt,
      currency: 'USDT'
    });

    const result = await fulfillment.fulfillOrder(tradeNo);
    assert(result.success);

    const activeSubs = models.getActiveSubscriptions();
    const sub = activeSubs.find(s => s.platform_user_id === '55667788');
    assert(sub, 'Assinatura VIP deve estar ativa no banco de dados');
    assert(sub.end_date, 'Deve possuir data de término calculada');

    const diffDays = Math.round((new Date(sub.end_date) - new Date(sub.start_date)) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 30, 'Duração da assinatura deve ser de exatamente 30 dias');
  });

  // ----------------------------------------------------------------
  // 5. TESTES DO CANAL DE ATUALIZAÇÕES & PRIVACIDADE
  // ----------------------------------------------------------------
  console.log('\n📢 5. Testes do Canal de Atualizações, Ofertas e Mascaramento:');

  runTest('Mascaramento de Privacidade de Clientes', () => {
    const maskedName = updatesChannel.maskCustomerIdentity('Leonardo DiCaprio');
    assert.strictEqual(maskedName, 'Leo*** D.');

    const maskedPhone = updatesChannel.maskCustomerIdentity('5511999998888');
    assert.strictEqual(maskedPhone, '5511*****888');

    const maskedUser = updatesChannel.maskCustomerIdentity('@investidor_pro');
    assert.strictEqual(maskedUser, '@in***o');
  });

  await runAsyncTest('Disparo de Oferta Promocional com CTA no Canal', async () => {
    models.setSetting('TELEGRAM_UPDATES_CHANNEL_ID', '-100123456789');
    const offer = await updatesChannel.broadcastOffer({
      title: 'SUPER PROMOÇÃO BLACK FRIDAY',
      content: 'Leve o plano VIP com 50% de desconto!',
      product_id: testProdSub.id,
      cta_text: '🔥 Comprar Agora',
      image_url: 'https://exemplo.com/banner.jpg'
    });

    assert(offer.id > 0);
    assert.strictEqual(offer.title, 'SUPER PROMOÇÃO BLACK FRIDAY');
    assert(capturedChannelPosts.length > 0, 'Deve ter postado a mensagem no canal');
  });

  // ----------------------------------------------------------------
  // 6. TESTES DE APIS E SERVIDOR EXPRESS
  // ----------------------------------------------------------------
  console.log('\n🌐 6. Testes das Rotas HTTP / APIs do Servidor:');

  const app = createServer();
  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, resolve));
  const testPort = testServer.address().port;

  async function fetchApi(endpoint, options = {}) {
    const url = `http://localhost:${testPort}${endpoint}`;
    const res = await fetch(url, options);
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  await runAsyncTest('GET /api/metrics retorna métricas consolidadas', async () => {
    const { status, data } = await fetchApi('/api/metrics');
    assert.strictEqual(status, 200);
    assert(typeof data.totalRevenueBRL === 'number');
    assert(typeof data.paidOrders === 'number');
  });

  await runAsyncTest('GET /api/settings retorna configurações e webhooks', async () => {
    const { status, data } = await fetchApi('/api/settings');
    assert.strictEqual(status, 200);
    assert(data.webhooks.binance.includes('/api/binance/webhook'));
  });

  await runAsyncTest('POST /api/settings atualiza configurações', async () => {
    const { status, data } = await fetchApi('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BOT_NAME: 'PayBot Turbo 2026',
        GLOBAL_AFFILIATE_RATE: 22.5
      })
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(models.getSetting('BOT_NAME'), 'PayBot Turbo 2026');
  });

  await runAsyncTest('Simulação de Pagamento via API (/api/orders/simulate-pay/:tradeNo)', async () => {
    const tradeNo = 'ORD_API_TEST_' + Date.now();
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'telegram',
      platform_user_id: '99001122',
      product_id: testProdDigital.id,
      amount: testProdDigital.price_brl,
      currency: 'BRL'
    });

    const { status, data } = await fetchApi(`/api/orders/simulate-pay/${tradeNo}`, {
      method: 'POST'
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.order.status, 'PAID');
  });

  await runAsyncTest('Exportação de Relatórios CSV (/api/export/orders.csv & commissions & affiliates)', async () => {
    const resOrders = await fetch(`http://localhost:${testPort}/api/export/orders.csv`);
    assert.strictEqual(resOrders.status, 200);
    assert(resOrders.headers.get('content-type').includes('text/csv'));
    const bufOrders = Buffer.from(await resOrders.arrayBuffer());
    assert(bufOrders[0] === 0xEF && bufOrders[1] === 0xBB && bufOrders[2] === 0xBF, 'CSV deve conter BOM UTF-8 (EF BB BF) para Excel');
    const textOrders = bufOrders.toString('utf-8');
    assert(textOrders.includes('ORD_'), 'CSV deve conter dados dos pedidos');

    const resComms = await fetch(`http://localhost:${testPort}/api/export/commissions.csv`);
    assert.strictEqual(resComms.status, 200);
    const bufComms = Buffer.from(await resComms.arrayBuffer());
    assert(bufComms[0] === 0xEF && bufComms[1] === 0xBB && bufComms[2] === 0xBF);

    const resAfils = await fetch(`http://localhost:${testPort}/api/export/affiliates.csv`);
    assert.strictEqual(resAfils.status, 200);
    const bufAfils = Buffer.from(await resAfils.arrayBuffer());
    assert(bufAfils[0] === 0xEF && bufAfils[1] === 0xBB && bufAfils[2] === 0xBF);
  });

  await new Promise(resolve => testServer.close(resolve));

  // ----------------------------------------------------------------
  // RELATÓRIO FINAL
  // ----------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests} PASSOU | ${failedTests} FALHOU`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

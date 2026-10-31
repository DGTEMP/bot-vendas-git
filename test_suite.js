const http = require('http');
const assert = require('assert');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');
const fulfillment = require('./src/services/fulfillment');
const updatesChannel = require('./src/services/updatesChannel');
const binancePay = require('./src/services/binancePay');
const pixPayment = require('./src/services/pixPayment');
const subscriptionCron = require('./src/services/subscriptionCron');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const socialMediaService = require('./src/services/socialMediaService');

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

  runTest('Edição Completa de Produto e Atribuição Direta de Vendedores', () => {
    // Atualiza o produto digital com novos dados, categoria e atribui vendedores
    const updated = models.updateProduct(testProdDigital.id, {
      name: 'E-book Cripto Trader 2026 - Edição Deluxe',
      description: 'Guia definitivo com mais de 30 estratégias testadas',
      price_brl: 59.90,
      price_usdt: 12.00,
      category: 'Finanças & Cripto',
      affiliation_enabled: 1,
      custom_affiliate_rate: 35.0,
      seller_ids: [1, 2]
    });

    assert.strictEqual(updated.name, 'E-book Cripto Trader 2026 - Edição Deluxe');
    assert.strictEqual(updated.price_brl, 59.90);
    assert.strictEqual(updated.price_usdt, 12.00);
    assert.strictEqual(updated.category, 'Finanças & Cripto');
    assert.strictEqual(updated.affiliation_enabled, 1);
    assert.strictEqual(updated.custom_affiliate_rate, 35.0);
    assert(Array.isArray(updated.assigned_seller_ids));
    assert(updated.assigned_seller_ids.includes(1));
    assert(updated.assigned_seller_ids.includes(2));
  });

  // ----------------------------------------------------------------
  // 2. TESTES DE EQUIPES DE VENDAS & AFILIADOS
  // ----------------------------------------------------------------
  console.log('\n👔 2. Testes de Vendedores, Afiliados e Comissões:');

  let testSeller, testAffiliate;
  let testCompany;

  runTest('Criação de Empresa e Vinculação de Produto & Categoria', () => {
    testCompany = models.createCompany({
      name: 'Alpha Tech Enterprises',
      document: '11.222.333/0001-44',
      description: 'Divisão de tecnologia e inteligência artificial'
    });
    assert(testCompany.id > 0);
    assert.strictEqual(testCompany.name, 'Alpha Tech Enterprises');

    const prodWithComp = models.createProduct({
      name: 'Software IA Sniper',
      price: 250.00,
      price_brl: 250.00,
      price_usdt: 50.00,
      type: 'digital_link',
      content: 'https://exemplo.com/sniper',
      company_id: testCompany.id,
      category: 'Inteligência Artificial'
    });

    assert(prodWithComp.id > 0);
    assert.strictEqual(prodWithComp.company_name, 'Alpha Tech Enterprises');
    assert.strictEqual(prodWithComp.category, 'Inteligência Artificial');
  });

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

  runTest('Seleção de Produtos Disponíveis por Vendedor Conectado', () => {
    // Cria Vendedor Especialista apenas para o produto Digital
    const sellerEbook = models.createSeller({
      name: 'Vendedor Especialista E-book',
      commission_rate: 15.0,
      product_ids: [testProdDigital.id]
    });
    assert(sellerEbook.id > 0);

    // Cria Vendedor Especialista apenas para o produto VIP
    const sellerVip = models.createSeller({
      name: 'Vendedor Especialista VIP',
      commission_rate: 12.0,
      product_ids: [testProdSub.id]
    });
    assert(sellerVip.id > 0);

    // Roleta específica para o produto Digital deve selecionar o vendedor do E-book
    const chosenForDigital = models.getNextRoundRobinSeller(testProdDigital.id);
    assert.strictEqual(chosenForDigital.id, sellerEbook.id, 'Para o produto Digital, deve selecionar o vendedor com acesso a ele');

    // Roleta específica para o produto VIP deve selecionar o vendedor do VIP
    const chosenForVip = models.getNextRoundRobinSeller(testProdSub.id);
    assert.strictEqual(chosenForVip.id, sellerVip.id, 'Para o produto VIP, deve selecionar o vendedor com acesso ao VIP');
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

  runTest('Fila de Espera de Afiliação & Critérios Mínimos de Ativação', () => {
    // Afiliado recém-criado sem vendas
    const freshAffiliate = models.createAffiliate({
      name: 'Afiliado Iniciante Sem Vendas',
      ref_code: 'INICIA_' + Date.now().toString().slice(-4),
      pix_key: 'iniciante@pix.com'
    });

    // Configura critérios mínimos: 2 vendas e R$ 50
    models.setSetting('AFFILIATION_MIN_SALES', '2');
    models.setSetting('AFFILIATION_MIN_REVENUE_BRL', '50.0');
    models.setSetting('AFFILIATION_AUTO_APPROVE', 'true');
    models.setSetting('AFFILIATION_PRODUCT_RESTRICTED', 'true');

    // Solicita afiliação para o produto digital -> deve entrar na Fila de Espera (PENDING)
    const request = models.requestProductAffiliation({
      affiliate_id: freshAffiliate.id,
      product_id: testProdDigital.id,
      notes: 'Solicitação inicial para teste'
    });

    assert.strictEqual(request.status, 'PENDING', 'Novo afiliado sem vendas deve ficar na Fila de Espera');
    assert.strictEqual(models.isAffiliateApprovedForProduct(freshAffiliate.id, testProdDigital.id), false);

    // Simula duas vendas pagas para atingir os critérios mínimos
    for (let i = 0; i < 2; i++) {
      models.createOrder({
        merchant_trade_no: `ORD_CRIT_${Date.now()}_${i}`,
        platform: 'telegram',
        platform_user_id: '123456',
        product_id: testProdDigital.id,
        amount: 50.0,
        currency: 'BRL',
        status: 'PAID',
        affiliate_id: freshAffiliate.id
      });
    }

    // Avalia os critérios e auto-ativação
    const updated = models.checkAndActivateAffiliations(freshAffiliate.id);
    assert(updated.length > 0, 'Deve ter atualizado o pedido na fila');
    assert.strictEqual(updated[0].status, 'APPROVED', 'Deve ter aprovado automaticamente após bater os critérios');

    // Agora o afiliado está expressamente aprovado
    assert.strictEqual(models.isAffiliateApprovedForProduct(freshAffiliate.id, testProdDigital.id), true);

    // Restaura configuração padrão de restrição
    models.setSetting('AFFILIATION_PRODUCT_RESTRICTED', 'false');
  });

  runTest('Validação de Bloqueio de Afiliação por Produto (affiliation_enabled = 0)', () => {
    // Cria produto exclusivo sem permissão para afiliados
    const privateProd = models.createProduct({
      name: 'Mentoria Privada 1on1',
      price: 1500.00,
      type: 'digital_link',
      category: 'Mentorias',
      affiliation_enabled: 0
    });

    assert.strictEqual(privateProd.affiliation_enabled, 0);

    // Afiliado ativo tenta solicitar afiliação para este produto restrito
    assert.throws(() => {
      models.requestProductAffiliation({
        affiliate_id: testAffiliate.id,
        product_id: privateProd.id
      });
    }, /não está disponível para afiliação/);

    // Verifica que não está aprovado
    const approved = models.isAffiliateApprovedForProduct(testAffiliate.id, privateProd.id);
    assert.strictEqual(approved, false);
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

  await runAsyncTest('Comissão Personalizada por Produto no Fulfillment (custom_affiliate_rate)', async () => {
    // testProdDigital foi configurado com custom_affiliate_rate: 35.0
    // testAffiliate tem commission_rate padrão de 20.0
    const tradeNo = 'ORD_CUSTOM_RATE_' + Date.now();
    const order = models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'telegram',
      platform_user_id: '88776655',
      platform_user_name: 'CustomRateTester',
      product_id: testProdDigital.id,
      gateway: 'mercadopago',
      amount: 100.00,
      currency: 'BRL',
      affiliate_id: testAffiliate.id,
      status: 'PAID'
    });

    const initBal = models.getAffiliateById(testAffiliate.id).balance_brl;
    await fulfillment.fulfillOrder(tradeNo);
    const endBal = models.getAffiliateById(testAffiliate.id).balance_brl;

    // A taxa do produto (35%) deve prevalecer sobre a do afiliado (20%) -> 35.00 BRL
    const diff = Number((endBal - initBal).toFixed(2));
    assert.strictEqual(diff, 35.00, `Esperava comissão personalizada de 35.00 BRL, mas recebeu ${diff}`);
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
  // 6. TESTES DO MOTOR DE EXPANSÃO DE VENDAS (CUPONS, UPSELL, RECUPERAÇÃO)
  // ----------------------------------------------------------------
  console.log('\n🚀 6. Testes do Motor de Expansão de Vendas:');

  let testCouponPercent, testCouponFixed;
  const uniqueCodePercent = 'TESTE_' + Date.now();
  const uniqueCodeFixed = 'DESC_' + Date.now();

  runTest('Criação e Consulta de Cupom Percentual e Fixo', () => {
    testCouponPercent = models.createCoupon({
      code: uniqueCodePercent,
      discount_percent: 20,
      max_uses: 5
    });
    assert(testCouponPercent.id > 0);
    assert.strictEqual(testCouponPercent.code, uniqueCodePercent);
    assert.strictEqual(testCouponPercent.discount_percent, 20);

    testCouponFixed = models.createCoupon({
      code: uniqueCodeFixed,
      discount_amount: 10.0,
      max_uses: 100
    });
    assert(testCouponFixed.id > 0);
    assert.strictEqual(testCouponFixed.discount_amount, 10.0);

    const retrieved = models.getCouponByCode(uniqueCodePercent.toLowerCase()); // Case-insensitive
    assert(retrieved !== null);
    assert.strictEqual(retrieved.id, testCouponPercent.id);
  });

  runTest('Validação de Limites e Uso de Cupom', () => {
    const success = models.useCoupon(uniqueCodePercent);
    assert(success !== null && success.id > 0);

    const updated = models.getCouponByCode(uniqueCodePercent);
    assert.strictEqual(updated.used_count, 1);
  });

  runTest('Configuração de Upsell Pós-Venda em Produto', () => {
    const mainProd = models.createProduct({
      name: 'Curso Base de Investimentos',
      price: 100.00,
      price_brl: 100.00,
      price_usdt: 20.00,
      type: 'digital_link',
      content: 'https://exemplo.com/curso',
      upsell_product_id: testProdSub.id,
      upsell_discount_percent: 30,
      upsell_headline: 'Aproveite: Leve o Canal VIP com 30% OFF!'
    });

    assert(mainProd.id > 0);
    assert.strictEqual(mainProd.upsell_product_id, testProdSub.id);
    assert.strictEqual(mainProd.upsell_discount_percent, 30);
    assert.strictEqual(mainProd.upsell_headline, 'Aproveite: Leve o Canal VIP com 30% OFF!');
  });

  runTest('Recuperação de Carrinho Abandonado (Pending Orders)', () => {
    const abandonedTradeNo = 'ORD_ABANDONED_' + Date.now();
    const order = models.createOrder({
      merchant_trade_no: abandonedTradeNo,
      platform: 'telegram',
      platform_user_id: '12345678',
      product_id: testProdDigital.id,
      amount: testProdDigital.price_brl,
      currency: 'BRL'
    });

    assert.strictEqual(order.recovery_sent, 0);

    // Simula pedido criado há 30 minutos alterando o created_at no banco
    const db = require('./src/db/database');
    db.prepare(`UPDATE orders SET created_at = datetime('now', '-30 minutes') WHERE id = ?`).run(order.id);

    // Consulta pedidos abandonados com janela de 15 minutos
    const abandonedList = models.getAbandonedOrders(15);
    const found = abandonedList.find(o => o.id === order.id);
    assert(found !== undefined, 'O pedido de 30 min atrás deve constar como abandonado');

    // Marca como notificado
    models.markOrderRecoverySent(order.id);

    // Verifica que agora não aparece mais na lista
    const abandonedAfter = models.getAbandonedOrders(15);
    const foundAfter = abandonedAfter.find(o => o.id === order.id);
    assert.strictEqual(foundAfter, undefined, 'Pedido notificado não deve ser retornado novamente');
  });

  // ----------------------------------------------------------------
  // 7. TESTES DE APIS E SERVIDOR EXPRESS
  // ----------------------------------------------------------------
  console.log('\n🌐 7. Testes das Rotas HTTP / APIs do Servidor:');

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

  await runAsyncTest('Endpoints de Cupons (/api/coupons GET e POST)', async () => {
    const apiCode = 'PROMO_' + Date.now();
    const postRes = await fetchApi('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: apiCode,
        discount_percent: 30,
        max_uses: 10
      })
    });
    assert.strictEqual(postRes.status, 201);
    assert.strictEqual(postRes.data.code, apiCode);

    const getRes = await fetchApi('/api/coupons');
    assert.strictEqual(getRes.status, 200);
    assert(Array.isArray(getRes.data));
    const found = getRes.data.find(c => c.code === apiCode);
    assert(found !== undefined);
    assert.strictEqual(found.discount_percent, 30);
  });

  await runAsyncTest('Endpoints de Empresas & Multi-Tenant (/api/companies)', async () => {
    const postComp = await fetchApi('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Beta Global Tech',
        document: '99.888.777/0001-66',
        description: 'Empresa do grupo focada em vendas internacionais'
      })
    });
    assert.strictEqual(postComp.status, 200);
    assert(postComp.data.id > 0);
    assert.strictEqual(postComp.data.name, 'Beta Global Tech');

    const getComp = await fetchApi('/api/companies');
    assert.strictEqual(getComp.status, 200);
    assert(Array.isArray(getComp.data));
    const found = getComp.data.find(c => c.name === 'Beta Global Tech');
    assert(found !== undefined);
  });

  await runAsyncTest('Endpoints de Vendedores e Produtos Permitidos (/api/sellers/:id/products)', async () => {
    const postSProd = await fetchApi(`/api/sellers/${testSeller.id}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_ids: [testProdDigital.id, testProdKey.id]
      })
    });
    assert.strictEqual(postSProd.status, 200);
    assert(Array.isArray(postSProd.data));
    assert.strictEqual(postSProd.data.length, 2);

    const getSProd = await fetchApi(`/api/sellers/${testSeller.id}/products`);
    assert.strictEqual(getSProd.status, 200);
    assert.strictEqual(getSProd.data.length, 2);
  });

  await runAsyncTest('Endpoints da Fila de Afiliação e Critérios (/api/affiliations/queue & request)', async () => {
    const postReq = await fetchApi('/api/affiliations/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        affiliate_id: testAffiliate.id,
        product_id: testProdKey.id,
        notes: 'Solicitação via API de teste'
      })
    });
    assert.strictEqual(postReq.status, 200);
    assert(postReq.data.id > 0);

    const getQueue = await fetchApi('/api/affiliations/queue');
    assert.strictEqual(getQueue.status, 200);
    assert(Array.isArray(getQueue.data));
    const found = getQueue.data.find(q => q.id === postReq.data.id);
    assert(found !== undefined);
    assert(found.criteria !== undefined, 'Deve conter métricas avaliadas do afiliado');
  });

  await runAsyncTest('Endpoints de Edição de Produtos e Vendedores (/api/products/:id & sellers)', async () => {
    const getRes = await fetchApi(`/api/products/${testProdDigital.id}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.id, testProdDigital.id);
    assert.strictEqual(getRes.data.category, 'Finanças & Cripto');

    // PUT atualizando dados do produto e lista de vendedores
    const putRes = await fetchApi(`/api/products/${testProdDigital.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E-book Cripto Trader 2026 - Edição Final API',
        category: 'Criptomoedas',
        seller_ids: [testSeller.id]
      })
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.data.name, 'E-book Cripto Trader 2026 - Edição Final API');
    assert.strictEqual(putRes.data.category, 'Criptomoedas');
    assert(putRes.data.assigned_seller_ids.includes(testSeller.id));

    // GET /api/products/:id/sellers
    const getSellersRes = await fetchApi(`/api/products/${testProdDigital.id}/sellers`);
    assert.strictEqual(getSellersRes.status, 200);
    assert(Array.isArray(getSellersRes.data));
    assert(getSellersRes.data.some(s => s.id === testSeller.id));

    // POST /api/products/:id/sellers
    const postSellersRes = await fetchApi(`/api/products/${testProdDigital.id}/sellers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller_ids: [testSeller.id]
      })
    });
    assert.strictEqual(postSellersRes.status, 200);
    assert(Array.isArray(postSellersRes.data));
  });

  // ----------------------------------------------------------------
  // 8. TESTES DO EXÉRCITO DE WHATSAPP & DIVULGAÇÃO DE AFILIADOS
  // ----------------------------------------------------------------
  console.log('\n🤖 8. Testes do Exército de WhatsApp & Divulgação de Afiliados:');

  let testChip, testAffLink, testArmyCamp;

  runTest('Gerenciamento de Instâncias / Chips do Exército (whatsapp_army_instances)', () => {
    testChip = models.createArmyInstance({
      name: 'Chip 02 - Divulgador de Teste',
      phone: '5511988887777',
      daily_limit: 40,
      warmup_mode: 1
    });

    assert(testChip.id > 0);
    assert.strictEqual(testChip.name, 'Chip 02 - Divulgador de Teste');
    assert.strictEqual(testChip.daily_limit, 40);
    assert.strictEqual(testChip.warmup_mode, 1);

    // Simula chip conectado
    models.updateArmyInstance(testChip.id, { status: 'CONNECTED' });
    const available = models.getAvailableArmyInstances();
    assert(available.some(i => i.id === testChip.id));
  });

  runTest('Cadastro e Consulta de Links de Afiliado (affiliate_links)', () => {
    testAffLink = models.createAffiliateLink({
      title: 'Método Trader Pro 2026',
      platform: 'Hotmart',
      affiliate_url: 'https://hotm.art/trader-pro-test',
      commission_percent: 60.0,
      product_price: 197.00,
      pitch_copy: '{Olá|Oi} {nome}! Conheça o {produto}: {link}'
    });

    assert(testAffLink.id > 0);
    assert.strictEqual(testAffLink.title, 'Método Trader Pro 2026');
    assert.strictEqual(testAffLink.platform, 'Hotmart');
    assert.strictEqual(testAffLink.commission_percent, 60.0);
  });

  runTest('Parser de Spintax e Formatação Dinâmica de Mensagens', () => {
    const template = '{Olá|Oi|E aí} {nome}! {Tudo bem?|Como vai?} Veja {produto}: {link}';
    const parsed1 = models.formatCampaignMessage(template, { name: 'Lucas' }, { product_name: 'Curso Cripto', affiliate_url: 'https://link.com/af' });
    const parsed2 = models.formatCampaignMessage(template, { name: 'Lucas' }, { product_name: 'Curso Cripto', affiliate_url: 'https://link.com/af' });

    assert(parsed1.includes('Lucas'));
    assert(parsed1.includes('Curso Cripto'));
    assert(parsed1.includes('https://link.com/af'));
    assert(!parsed1.includes('{nome}'));
    assert(!parsed1.includes('{produto}'));
    assert(!parsed1.includes('{link}'));
    assert(!parsed1.includes('{Olá|Oi|E aí}'));
  });

  await runAsyncTest('Criação e Execução de Campanha de Divulgação em Massa com Rotação de Chips', async () => {
    testArmyCamp = models.createAffiliateCampaign({
      name: 'Campanha Teste Disparo Rápido',
      affiliate_link_id: testAffLink.id,
      product_name: testAffLink.title,
      affiliate_url: testAffLink.affiliate_url,
      message_template: '{Olá|Oi} {nome}! Confira {produto}: {link}',
      delay_min_seconds: 1,
      delay_max_seconds: 1,
      leads: [
        { phone: '5511999990011', name: 'Lead Um' },
        { phone: '5511999990022', name: 'Lead Dois' }
      ]
    });

    assert(testArmyCamp.id > 0);
    assert.strictEqual(testArmyCamp.total_leads, 2);

    // Inicia a campanha através do serviço
    const startResult = await whatsappArmyService.startCampaign(testArmyCamp.id);
    assert.strictEqual(startResult.status, 'RUNNING');

    // Aguarda processamento dos leads em modo teste rápido
    await new Promise(r => setTimeout(r, 200));

    const updatedCamp = models.getAffiliateCampaignById(testArmyCamp.id);
    assert(updatedCamp.sent_count >= 1, 'Ao menos um lead deve ter sido processado');

    const leads = models.getCampaignLeads(testArmyCamp.id);
    assert(leads.some(l => l.status === 'SENT'));
  });

  await runAsyncTest('Auto-Resposta Inteligente de Conversão para Leads Interessados', async () => {
    // Lead que acabou de receber mensagem manda "quero o link por favor"
    const handled = await whatsappArmyService.handleIncomingLeadMessage('5511999990011@s.whatsapp.net', 'quero saber mais sobre o valor', testChip.id);
    assert.strictEqual(handled, true, 'Auto-resposta deve identificar interesse comercial do lead');

    const leads = models.getCampaignLeads(testArmyCamp.id);
    const repliedLead = leads.find(l => l.phone === '5511999990011');
    assert.strictEqual(repliedLead.status, 'REPLIED');
  });

  await runAsyncTest('Endpoints REST da API do Exército de WhatsApp (/api/army/*)', async () => {
    // 1. Instâncias
    const getInst = await fetchApi('/api/army/instances');
    assert.strictEqual(getInst.status, 200);
    assert(Array.isArray(getInst.data));
    assert(getInst.data.some(i => i.id === testChip.id));

    // 2. Links
    const getLinks = await fetchApi('/api/army/links');
    assert.strictEqual(getLinks.status, 200);
    assert(Array.isArray(getLinks.data));
    assert(getLinks.data.some(l => l.id === testAffLink.id));

    // 3. Spintax Preview
    const previewRes = await fetchApi('/api/army/spintax-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: '{Oi|Olá} {nome}! {produto} em {link}',
        lead: { name: 'Ana' },
        campaign: { product_name: 'VIP Bot', affiliate_url: 'https://paybot.test' }
      })
    });
    assert.strictEqual(previewRes.status, 200);
    assert(previewRes.data.preview.includes('Ana'));
    assert(previewRes.data.preview.includes('VIP Bot'));
  });

  // ----------------------------------------------------------------
  // 9. TESTES DO FUNIL CONVERSACIONAL DE AQUECIMENTO & GRÁFICO EM TEMPO REAL
  // ----------------------------------------------------------------
  console.log('\n🔥 9. Testes do Funil Conversacional de Aquecimento & Gráfico em Tempo Real:');

  let testFunnelPhone = '5511988' + Math.floor(100000 + Math.random() * 900000);

  runTest('Configuração e Leitura das Etapas do Funil (funnel_stages)', () => {
    const stages = models.getFunnelStages();
    assert(Array.isArray(stages));
    assert(stages.length >= 5, 'Devem existir no mínimo 5 etapas configuradas no funil');

    const stage1 = stages.find(s => s.stage_key === 'STAGE_1_DESCOBERTA');
    assert(stage1, 'Etapa STAGE_1_DESCOBERTA deve existir');
    assert.strictEqual(stage1.order_num, 1);

    // Atualiza script com Spintax
    models.updateFunnelStage('STAGE_1_DESCOBERTA', {
      title: 'Descoberta Atualizada',
      message_template: '{E aí|Opa} {nome}! Tudo bem por aí? Vi que você tem interesse em {produto}.',
      followup_delay_minutes: 150
    });

    const updated = models.getFunnelStageByKey('STAGE_1_DESCOBERTA');
    assert.strictEqual(updated.title, 'Descoberta Atualizada');
    assert.strictEqual(updated.followup_delay_minutes, 150);
  });

  runTest('Inscrição, Avanço e Registro de Interações do Lead no Funil', () => {
    // Inscreve um novo lead
    const enrolled = models.enrollLeadInFunnel({
      phone: testFunnelPhone,
      lead_name: 'Carlos Aquecido',
      product_name: 'Curso Viver de IA',
      affiliate_url: 'https://hotm.art/viver-de-ia',
      affiliate_link_id: testAffLink.id,
      assigned_instance_id: testChip.id
    });

    assert(enrolled.id > 0);
    assert.strictEqual(enrolled.current_stage, 'STAGE_1_DESCOBERTA');
    assert.strictEqual(enrolled.phone, testFunnelPhone);

    // Log de interação de entrada
    models.logFunnelInteraction({
      lead_phone: testFunnelPhone,
      instance_id: testChip.id,
      direction: 'IN',
      stage: 'STAGE_1_DESCOBERTA',
      message_text: 'Sim, tenho interesse! Como funciona?'
    });

    // Avança para o Estágio 2
    const advanced = models.advanceLeadFunnelStage(testFunnelPhone, 'STAGE_2_INTERESSE');
    assert.strictEqual(advanced.current_stage, 'STAGE_2_INTERESSE');

    // Recupera histórico da conversa
    const logs = models.getFunnelInteractionLogs(testFunnelPhone);
    assert(logs.length >= 1);
    assert.strictEqual(logs[0].direction, 'IN');
    assert.strictEqual(logs[0].message_text, 'Sim, tenho interesse! Como funciona?');

    // Converte o lead
    const converted = models.markLeadConverted(testFunnelPhone);
    assert.strictEqual(converted.current_stage, 'CONVERTED');
    assert.strictEqual(converted.status, 'CONVERTED');
    assert(converted.converted_at !== null);
  });

  await runAsyncTest('Fluxo Completo de Auto-Aquecimento e Detecção de Intenção de Compra', async () => {
    const leadB = '5511977' + Math.floor(100000 + Math.random() * 900000);
    // Lead entra em STAGE_1
    models.enrollLeadInFunnel({
      phone: leadB,
      lead_name: 'Roberta Trader',
      product_name: 'Robô VIP',
      affiliate_url: 'https://paybot.test/robo-vip',
      affiliate_link_id: testAffLink.id,
      assigned_instance_id: testChip.id
    });

    // 1. Resposta normal avança para STAGE_2_INTERESSE
    await whatsappArmyService.handleIncomingLeadMessage(`${leadB}@s.whatsapp.net`, 'Bacana, me conta mais sobre isso', testChip.id);
    let conv = models.getLeadFunnelConversationByPhone(leadB);
    assert.strictEqual(conv.current_stage, 'STAGE_2_INTERESSE');

    // 2. Lead demonstra intenção de compra imediata ("onde compro, manda o link") -> Fast-Track para STAGE_4_OFERTA
    await whatsappArmyService.handleIncomingLeadMessage(`${leadB}@s.whatsapp.net`, 'Adorei! Me passa o link para comprar agora', testChip.id);
    conv = models.getLeadFunnelConversationByPhone(leadB);
    assert.strictEqual(conv.current_stage, 'STAGE_4_OFERTA', 'Lead com intenção de compra deve ser acelerado diretamente para Oferta');

    // 3. Lead confirma pagamento -> Converte
    await whatsappArmyService.handleIncomingLeadMessage(`${leadB}@s.whatsapp.net`, 'Pronto, acabei de comprar pelo link!', testChip.id);
    conv = models.getLeadFunnelConversationByPhone(leadB);
    assert.strictEqual(conv.current_stage, 'CONVERTED');
    assert.strictEqual(conv.status, 'CONVERTED');
  });

  runTest('Cálculo de Estatísticas e Taxas de Conversão do Funil em Tempo Real', () => {
    const stats = models.getFunnelRealTimeStats();
    assert(stats.totalLeads >= 2, 'Total de leads no funil deve ser contabilizado');
    assert(stats.converted >= 2, 'Pelo menos 2 conversões devem ser registradas');
    assert(typeof stats.replyRate === 'number');
    assert(typeof stats.offerReachRate === 'number');
    assert(typeof stats.conversionRate === 'number');
    assert(stats.conversionRate > 0, 'Taxa de conversão deve ser positiva');
    assert(stats.stage1 >= 0);
  });

  await runAsyncTest('Endpoints REST da API do Funil em Tempo Real (/api/army/funnel/*)', async () => {
    // 1. Estatísticas do Funil em Tempo Real
    const statsRes = await fetchApi('/api/army/funnel/stats');
    assert.strictEqual(statsRes.status, 200);
    assert(statsRes.data.totalLeads >= 2);
    assert(typeof statsRes.data.conversionRate === 'number');

    // 2. Consulta de Etapas
    const stagesRes = await fetchApi('/api/army/funnel/stages');
    assert.strictEqual(stagesRes.status, 200);
    assert(Array.isArray(stagesRes.data));
    assert(stagesRes.data.length >= 5);

    // 3. Atualização de Etapa
    const putStage = await fetchApi('/api/army/funnel/stages/STAGE_2_INTERESSE', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Interesse & Conexão Profunda',
        followup_delay_minutes: 180
      })
    });
    assert.strictEqual(putStage.status, 200);
    assert.strictEqual(putStage.data.title, 'Interesse & Conexão Profunda');
    assert.strictEqual(putStage.data.followup_delay_minutes, 180);

    // 4. Listagem de Leads do Funil
    const leadsRes = await fetchApi('/api/army/funnel/leads');
    assert.strictEqual(leadsRes.status, 200);
    assert(Array.isArray(leadsRes.data));
    assert(leadsRes.data.some(l => l.phone === testFunnelPhone));

    // 5. Histórico detalhado de um Lead
    const leadDetailRes = await fetchApi(`/api/army/funnel/leads/${testFunnelPhone}`);
    assert.strictEqual(leadDetailRes.status, 200);
    assert(leadDetailRes.data.lead);
    assert(Array.isArray(leadDetailRes.data.history));
    assert(leadDetailRes.data.history.length >= 1);

    // 6. Envio de mensagem manual do operador para o lead
    const replyRes = await fetchApi('/api/army/funnel/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testFunnelPhone,
        message: 'Olá Carlos, sua dúvida foi sanada?'
      })
    });
    assert.strictEqual(replyRes.status, 200);
    assert.strictEqual(replyRes.data.success, true);
  });

  // ----------------------------------------------------------------
  // 10. TESTES DE CONEXÃO MULTI-CHIP WHATSAPP (PAIRING CODE) E REDES SOCIAIS (META)
  // ----------------------------------------------------------------
  console.log('\n📱 10. Testes de Conexão WhatsApp (Pairing Code & Reset) e Redes Sociais:');

  await runAsyncTest('Geração de Código de Pareamento de 8 Dígitos (Pairing Code) & Reset de Sessão', async () => {
    // 1. Gera código de pareamento
    const pairingRes = await whatsappArmyService.requestPairingCode(testChip.id, '5511999991234');
    assert(pairingRes.pairingCode, 'Deve retornar código de pareamento');
    assert(pairingRes.pairingCode.length >= 8, 'Código de pareamento deve conter ao menos 8 caracteres');

    // 2. Verifica se status do QR inclui pairingCode
    const qrData = whatsappArmyService.getInstanceQr(testChip.id);
    assert.strictEqual(qrData.pairingCode, pairingRes.pairingCode);

    // 3. Reset de sessão
    const resetRes = await whatsappArmyService.resetInstanceSession(testChip.id);
    assert.strictEqual(resetRes.success, true);
  });

  runTest('Gerenciamento de Contas Sociais (Instagram & Facebook) no Banco de Dados', () => {
    // 1. Cria conta do Instagram
    const igAccount = models.createSocialAccount({
      platform: 'instagram',
      name: '@loja.cripto.pro',
      account_id: '17841499999999999',
      auto_reply_enabled: 1
    });
    assert(igAccount.id > 0);
    assert.strictEqual(igAccount.platform, 'instagram');
    assert.strictEqual(igAccount.name, '@loja.cripto.pro');

    // 2. Atualiza conta
    const updated = models.updateSocialAccount(igAccount.id, {
      name: '@loja.cripto.vip',
      auto_reply_enabled: 0
    });
    assert.strictEqual(updated.name, '@loja.cripto.vip');
    assert.strictEqual(updated.auto_reply_enabled, 0);

    // 3. Consulta contas
    const accounts = models.getSocialAccounts({ platform: 'instagram' });
    assert(accounts.some(a => a.id === igAccount.id));

    // 4. Estatísticas
    const stats = models.getSocialStats();
    assert(stats.totalAccounts >= 2);
    assert(stats.igAccounts >= 1);
  });

  await runAsyncTest('Auto-Resposta e Aquecimento de Direct (Instagram & Facebook Messenger)', async () => {
    const igAcc = models.createSocialAccount({
      platform: 'instagram',
      name: '@canal.vendas.bot',
      account_id: '17841488888888888',
      auto_reply_enabled: 1
    });

    // 1. Mensagem comum
    const resultGreeting = await socialMediaService.handleIncomingMessage({
      platform: 'instagram',
      accountId: igAcc.id,
      senderId: 'ig_user_123',
      senderName: 'Marcos Silva',
      text: 'Olá, boa tarde!'
    });
    assert.strictEqual(resultGreeting.handled, true);
    assert.strictEqual(resultGreeting.replied, true);
    assert(resultGreeting.replyText.includes('Marcos'));

    // 2. Mensagem com intenção de compra / valor
    const resultBuying = await socialMediaService.handleIncomingMessage({
      platform: 'instagram',
      accountId: igAcc.id,
      senderId: 'ig_user_123',
      senderName: 'Marcos Silva',
      text: 'Qual o valor e o link para comprar agora?'
    });
    assert.strictEqual(resultBuying.handled, true);
    assert.strictEqual(resultBuying.replied, true);
    assert(resultBuying.replyText.includes('desconto'));
    assert(resultBuying.replyText.includes('http'));

    // 3. Verificação do Webhook Meta
    const challenge = socialMediaService.verifyWebhook('subscribe', 'paybot_meta_token_2026', 'challenge_test_code_123');
    assert.strictEqual(challenge, 'challenge_test_code_123');

    // 4. Ingestão de Webhook Payload
    const webhookRes = await socialMediaService.processWebhookPayload({
      object: 'instagram',
      entry: [{
        id: igAcc.account_id,
        messaging: [{
          sender: { id: 'ig_user_456' },
          message: { text: 'Quero saber mais sobre o VIP' }
        }]
      }]
    });
    assert.strictEqual(webhookRes.processed, 1);
  });

  await runAsyncTest('Endpoints REST das Redes Sociais (/api/social/*)', async () => {
    // 1. Listagem de contas
    const listRes = await fetchApi('/api/social/accounts');
    assert.strictEqual(listRes.status, 200);
    assert(Array.isArray(listRes.data));

    // 2. Criação via API
    const createRes = await fetchApi('/api/social/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'facebook',
        name: 'Página Facebook Teste API',
        account_id: '9988776655443322'
      })
    });
    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.data.name, 'Página Facebook Teste API');

    // 3. Simulação de mensagem Direct via API
    const simRes = await fetchApi('/api/social/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'facebook',
        accountId: createRes.data.id,
        senderName: 'Cliente Facebook',
        text: 'Qual o valor do bot?'
      })
    });
    assert.strictEqual(simRes.status, 200);
    assert.strictEqual(simRes.data.handled, true);
    assert(simRes.data.replyText.length > 0);

    // 4. Webhook GET verification
    const rawWebhook = await fetch(`http://localhost:${testPort}/api/social/webhook?hub.mode=subscribe&hub.verify_token=paybot_meta_token_2026&hub.challenge=test_challenge_999`);
    assert.strictEqual(rawWebhook.status, 200);
    const challengeText = await rawWebhook.text();
    assert.strictEqual(challengeText, 'test_challenge_999');

    // 5. Estatísticas
    const statsRes = await fetchApi('/api/social/stats');
    assert.strictEqual(statsRes.status, 200);
    assert(statsRes.data.totalAccounts >= 2);
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

process.env.NODE_ENV = 'test';
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

async function runTest(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.stack || err.message);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.stack || err.message);
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
    const uniqueRef = 'TR' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 900 + 100);
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
      ref_code: 'IN_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 900 + 100),
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
  const baseUrl = `http://localhost:${testPort}`;

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

    // 4. Teste de Código de Pareamento do WhatsApp Matriz (/api/whatsapp/pairing-code)
    const localBaseUrl = `http://localhost:${testPort}`;
    const wppPairingRes = await fetch(`${localBaseUrl}/api/whatsapp/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511977778888' })
    });
    const wppPairingData = await wppPairingRes.json();
    assert(wppPairingData.pairingCode, 'Deve gerar código de pareamento para o WhatsApp Matriz');
    assert(wppPairingData.pairingCode.length >= 8, 'Código do WhatsApp Matriz deve ter ao menos 8 dígitos');

    // 5. Status do WhatsApp Matriz deve refletir o código gerado
    const wppStatusRes = await fetch(`${localBaseUrl}/api/whatsapp/status`);
    const wppStatusData = await wppStatusRes.json();
    assert.strictEqual(wppStatusData.pairingCode, wppPairingData.pairingCode);

    // 6. Reset do WhatsApp Matriz (/api/whatsapp/reset)
    const wppResetRes = await fetch(`${localBaseUrl}/api/whatsapp/reset`, { method: 'POST' });
    const wppResetData = await wppResetRes.json();
    assert.strictEqual(wppResetData.success, true);
  });

  await runAsyncTest('Múltiplas Instâncias de WhatsApp com Cérebro Compartilhado (Multi-Device Shared Brain)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    // Simula mensagem chegando em chip secundário e sendo respondida com catálogo/vendas
    let capturedReply = null;
    const mockChipSock = {
      user: { id: '5511988887777:1@s.whatsapp.net' },
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid, payload) => {
        capturedReply = { jid, payload };
        return { key: { id: 'msg_chip_mock' } };
      }
    };

    const incomingMsg = {
      key: {
        remoteJid: '5511911112222@s.whatsapp.net',
        fromMe: false,
        id: 'mock_incoming_123'
      },
      pushName: 'Cliente MultiChip',
      message: {
        conversation: 'menu'
      }
    };

    await whatsappBot.handleIncomingMessage(incomingMsg, mockChipSock);
    assert(capturedReply !== null, 'Chip secundário deve responder a mensagem através do seu próprio socket');
    assert.strictEqual(capturedReply.jid, '5511911112222@s.whatsapp.net');
    assert(capturedReply.payload.text.includes('CATÁLOGO DE PRODUTOS') || capturedReply.payload.text.includes('MENU') || capturedReply.payload.text.includes('Olá'), 'Deve responder com o catálogo de produtos');
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

  // ================================================================
  // 13. PROCESSAMENTO DE LINGUAGEM NATURAL PT-BR (NLU / NLP)
  // ================================================================
  await runAsyncTest('NLP PT-BR: Normalização de gírias e abreviações brasileiras', async () => {
    const nlpService = require('./src/services/nlpService');
    const input = 'Opa blz vc tbm vai querer o zap agr pfv vlw ctz';
    const normalized = nlpService.normalizeText(input);
    assert.strictEqual(normalized, 'olá beleza você também vai querer o whatsapp agora por favor valeu certeza');

    const repLetter = nlpService.normalizeText('oiiiiiii amiiiiiigo');
    assert.strictEqual(repLetter, 'oi amigo');
  });

  await runAsyncTest('NLP PT-BR: Classificação de intenções e quebra de objeções', async () => {
    const nlpService = require('./src/services/nlpService');
    
    // Objeção de segurança/golpe
    const trust = await nlpService.processMessage({ text: 'é seguro comprar aqui ou é golpe? tem garantia?' });
    assert.strictEqual(trust.intent, 'TRUST_AND_GUARANTEE');
    assert(trust.confidence >= 0.90);
    assert(trust.replyText.includes('GARANTIA INCONDICIONAL'));

    // Pagamento Pix
    const pix = await nlpService.processMessage({ text: 'manda a chave pix pfv' });
    assert.strictEqual(pix.intent, 'PAYMENT_PIX');
    assert.strictEqual(pix.directAction, 'TRIGGER_PIX');

    // Confirmação de pagamento
    const confirm = await nlpService.processMessage({ text: 'já fiz o pix aqui tá pago olha o comprovante' });
    assert.strictEqual(confirm.intent, 'CONFIRM_PURCHASE');
    assert(confirm.replyText.includes('PARABÉNS PELA COMPRA'));

    // Consulta de desconto
    const discount = await nlpService.processMessage({ text: 'tem algum cupom de desconto?' });
    assert.strictEqual(discount.intent, 'DISCOUNT_QUERY');

    // Suporte humano
    const support = await nlpService.processMessage({ text: 'quero falar com atendente humano' });
    assert.strictEqual(support.intent, 'SUPPORT_HUMAN');
  });

  await runAsyncTest('NLP PT-BR: Extração dinâmica de produtos e cupons', async () => {
    const nlpService = require('./src/services/nlpService');
    
    // Menção ao plano 1
    const res1 = await nlpService.processMessage({ text: 'quanto tá o plano 1?' });
    assert.strictEqual(res1.intent, 'PRICE_QUERY');
    assert.strictEqual(res1.entities.extractedNumber, 1);
    assert(res1.entities.matchedProduct !== null);

    // Menção ao VIP
    const resVip = await nlpService.processMessage({ text: 'qto custa o vip?' });
    assert.strictEqual(resVip.intent, 'PRICE_QUERY');
    assert(resVip.entities.matchedProduct !== null);
    assert(resVip.entities.matchedProduct.name.toLowerCase().includes('vip'));

    // Código de Cupom com filtro de stop words
    const resCoupon = await nlpService.processMessage({ text: 'ativar cupom PROMO50' });
    assert.strictEqual(resCoupon.entities.couponCode, 'PROMO50');
  });

  await runAsyncTest('API REST NLU: POST /api/nlp/analyze & GET /api/nlp/info', async () => {
    const { status, data } = await fetchApi('/api/nlp/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'manda a chave pix pro 1 pfv',
        customerName: 'Mariana Silva',
        platform: 'whatsapp'
      })
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.intent, 'PAYMENT_PIX');
    assert.strictEqual(data.directAction, 'TRIGGER_PIX');
    assert(data.replyText.includes('Mariana'));
    assert.strictEqual(data.entities.extractedNumber, 1);

    const infoRes = await fetchApi('/api/nlp/info');
    assert.strictEqual(infoRes.status, 200);
    assert(Array.isArray(infoRes.data.intents));
    assert(typeof infoRes.data.dictionary === 'object');
    assert.strictEqual(infoRes.data.dictionary['vc'], 'você');
  });

  // ================================================================
  // 14. TESTES DE MODERAÇÃO & CONTROLE DE CHATS (MUTE & BLOQUEIOS)
  // ================================================================
  await runAsyncTest('Moderação: Mute e Unmute de Conversa Privada e Grupo no DB', async () => {
    const testPrivateChat = '5511999997711@s.whatsapp.net';
    const testGroupChat = '120363028123456789@g.us';

    // 1. Mute de conversa privada
    assert.strictEqual(models.isChatMuted('whatsapp', testPrivateChat), false);
    models.muteChat({
      platform: 'whatsapp',
      chatId: testPrivateChat,
      targetType: 'PRIVATE',
      reason: 'Cliente pediu para pausar mensagens'
    });
    assert.strictEqual(models.isChatMuted('whatsapp', testPrivateChat), true);

    // 2. Mute de grupo
    assert.strictEqual(models.isChatMuted('whatsapp', testGroupChat), false);
    models.muteChat({
      platform: 'whatsapp',
      chatId: testGroupChat,
      targetType: 'GROUP',
      reason: 'Admin desativou no grupo'
    });
    assert.strictEqual(models.isChatMuted('whatsapp', testGroupChat), true);

    // 3. Unmute
    models.unmuteChat('whatsapp', testPrivateChat);
    assert.strictEqual(models.isChatMuted('whatsapp', testPrivateChat), false);

    models.unmuteChat('whatsapp', testGroupChat);
    assert.strictEqual(models.isChatMuted('whatsapp', testGroupChat), false);
  });

  await runAsyncTest('Moderação: Bloqueio de Participante em Grupo e Globalmente', async () => {
    const testGroup = '120363099999999999@g.us';
    const badUser1 = '5511988880001';
    const badUser2 = '5511988880002';

    // 1. Bloqueio específico em um grupo
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser1, testGroup), false);
    models.blockUser({
      platform: 'whatsapp',
      userId: badUser1,
      chatId: testGroup,
      targetType: 'USER',
      reason: 'Spam no grupo'
    });
    // Bloqueado no grupo especificado:
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser1, testGroup), true);
    // Mas não bloqueado em outro grupo:
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser1, '120363011111111111@g.us'), false);

    // 2. Bloqueio global de usuário (chatId = '*')
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser2), false);
    models.blockUser({
      platform: 'whatsapp',
      userId: badUser2,
      chatId: '*',
      targetType: 'USER',
      reason: 'Fraude / Abuso'
    });
    // Bloqueado em qualquer grupo ou privado:
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser2, testGroup), true);
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser2, 'outro_chat'), true);
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser2), true);

    // 3. Desbloqueio
    models.unblockUser('whatsapp', badUser1, testGroup);
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser1, testGroup), false);

    models.unblockUser('whatsapp', badUser2);
    assert.strictEqual(models.isUserBlocked('whatsapp', badUser2), false);
  });

  await runAsyncTest('Moderação: Reconhecimento de Opt-out no NLP (DEACTIVATE_BOT)', async () => {
    const nlpService = require('./src/services/nlpService');
    const res = await nlpService.processMessage({
      text: 'pare de me mandar mensagem por favor',
      customerName: 'Renato'
    });
    assert.strictEqual(res.intent, 'DEACTIVATE_BOT');
    assert.strictEqual(res.directAction, 'DEACTIVATE_BOT');
    assert(res.replyText.includes('PAUSADO'));
  });

  await runAsyncTest('Moderação: Endpoints REST (/api/controls/*)', async () => {
    // 1. POST /api/controls/mute
    const muteRes = await fetchApi('/api/controls/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        chatId: '5511999993333@s.whatsapp.net',
        targetType: 'PRIVATE',
        reason: 'Teste API Mute'
      })
    });
    assert.strictEqual(muteRes.status, 200);
    assert.strictEqual(muteRes.data.success, true);
    assert.strictEqual(models.isChatMuted('whatsapp', '5511999993333@s.whatsapp.net'), true);

    // 2. POST /api/controls/block
    const blockRes = await fetchApi('/api/controls/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        userId: '5511977771111',
        chatId: '*',
        targetType: 'USER',
        reason: 'Teste API Bloqueio'
      })
    });
    assert.strictEqual(blockRes.status, 200);
    assert.strictEqual(blockRes.data.success, true);
    assert.strictEqual(models.isUserBlocked('whatsapp', '5511977771111'), true);

    // 3. GET /api/controls
    const listRes = await fetchApi('/api/controls?platform=whatsapp');
    assert.strictEqual(listRes.status, 200);
    assert(Array.isArray(listRes.data));
    assert(listRes.data.some(c => c.chat_id.includes('5511999993333')));

    // 4. POST /api/controls/unmute
    const unmuteRes = await fetchApi('/api/controls/unmute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        chatId: '5511999993333@s.whatsapp.net'
      })
    });
    assert.strictEqual(unmuteRes.status, 200);
    assert.strictEqual(models.isChatMuted('whatsapp', '5511999993333@s.whatsapp.net'), false);

    // 5. POST /api/controls/unblock
    const unblockRes = await fetchApi('/api/controls/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        userId: '5511977771111'
      })
    });
    assert.strictEqual(unblockRes.status, 200);
    assert.strictEqual(models.isUserBlocked('whatsapp', '5511977771111'), false);
  });

  // ================================================================
  // 15. TESTES DE GERENCIAMENTO DE GRUPOS (FUNÇÕES ADMIN)
  // ================================================================
  await runAsyncTest('Gestão de Grupos: Resolução de Privilégios (Bot Admin & Requester Admin)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363088888888888@g.us';

    // 1. Mock do socket Baileys com participantes
    const originalSock = whatsappBot.sock;
    whatsappBot.sock = {
      user: { id: '5511900000000:1@s.whatsapp.net' },
      groupMetadata: async (jid) => ({
        id: jid,
        subject: 'Grupo Teste VIP',
        participants: [
          { id: '5511900000000@s.whatsapp.net', admin: 'admin' }, // O Bot é Admin
          { id: '5511911111111@s.whatsapp.net', admin: 'admin' }, // Admin 1
          { id: '5511922222222@s.whatsapp.net', admin: null }    // Membro Comum
        ]
      })
    };

    // Caso A: Admin do grupo solicita comando e bot é admin
    const statusA = await whatsappBot.getGroupAdminStatus(testGroup, '5511911111111@s.whatsapp.net', false);
    assert.strictEqual(statusA.isGroup, true);
    assert.strictEqual(statusA.isRequesterAdmin, true);
    assert.strictEqual(statusA.isBotAdmin, true);

    // Caso B: Membro comum solicita comando
    const statusB = await whatsappBot.getGroupAdminStatus(testGroup, '5511922222222@s.whatsapp.net', false);
    assert.strictEqual(statusB.isGroup, true);
    assert.strictEqual(statusB.isRequesterAdmin, false);
    assert.strictEqual(statusB.isBotAdmin, true);

    // Caso C: Bot NÃO é admin do grupo
    whatsappBot.sock.groupMetadata = async (jid) => ({
      id: jid,
      subject: 'Grupo Sem Bot Admin',
      participants: [
        { id: '5511900000000@s.whatsapp.net', admin: null },    // Bot NÃO é admin
        { id: '5511911111111@s.whatsapp.net', admin: 'admin' }, // Admin 1
        { id: '5511922222222@s.whatsapp.net', admin: null }
      ]
    });

    const statusC = await whatsappBot.getGroupAdminStatus(testGroup, '5511911111111@s.whatsapp.net', false);
    assert.strictEqual(statusC.isGroup, true);
    assert.strictEqual(statusC.isRequesterAdmin, true);
    assert.strictEqual(statusC.isBotAdmin, false);

    whatsappBot.sock = originalSock;
  });

  await runAsyncTest('Gestão de Grupos: Execução de Comandos de Grupo no WhatsApp', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363077777777777@g.us';

    let lastSentMsg = null;
    let lastAction = null;

    const originalSock = whatsappBot.sock;
    const originalSendMessage = whatsappBot.sendMessage;
    const prevOwner = models.getSetting('OWNER_PHONE', '');

    try {
      whatsappBot.sendMessage = async (jid, text, opt) => {
        lastSentMsg = { jid, text, opt };
        return true;
      };

      whatsappBot.sock = {
        user: { id: '5511900000000:1@s.whatsapp.net' },
        groupMetadata: async () => ({
          participants: [
            { id: '5511900000000@s.whatsapp.net', admin: 'admin' },
            { id: '5511911111111@s.whatsapp.net', admin: 'admin' },
            { id: '5511922222222@s.whatsapp.net', admin: null }
          ]
        }),
        groupParticipantsUpdate: async (jid, participants, action) => {
          lastAction = { jid, participants, action };
        },
        groupSettingUpdate: async (jid, setting) => {
          lastAction = { jid, setting };
        },
        groupUpdateSubject: async (jid, subject) => {
          lastAction = { jid, subject };
        },
        groupInviteCode: async () => 'INVITE123'
      };

      // 1. Comando !admin (Menu de Gestão)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!admin' },
        pushName: 'Admin Grupo'
      });
      assert(lastSentMsg.text.includes('PAINEL DE GERENCIAMENTO'));
      assert(lastSentMsg.text.includes('Bot é Administrador'));

      // 2. Comando !fechar (Trancar grupo para admins)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!fechar' }
      });
      assert.strictEqual(lastAction.setting, 'announcement');
      assert(lastSentMsg.text.includes('GRUPO FECHADO'));

      // 3. Comando !abrir (Destrancar grupo)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!abrir' }
      });
      assert.strictEqual(lastAction.setting, 'not_announcement');
      assert(lastSentMsg.text.includes('GRUPO ABERTO'));

      // 4. Comando !ban (Remover membro pelo número)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!ban 5511922222222' }
      });
      assert.strictEqual(lastAction.action, 'remove');
      assert.strictEqual(lastAction.participants[0], '5511922222222@s.whatsapp.net');
      assert(lastSentMsg.text.includes('MEMBRO REMOVIDO'));

      // 4.1 Comando !promover (Promover membro pelo número)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!promover 5511922222222' }
      });
      assert.strictEqual(lastAction.action, 'promote');
      assert.strictEqual(lastAction.participants[0], '5511922222222@s.whatsapp.net');
      assert(lastSentMsg.text.includes('ADMINISTRADOR PROMOVIDO'));

      // 4.2 Comando !promover respondendo a mensagem (reply / quote)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: {
          extendedTextMessage: {
            text: '!promover',
            contextInfo: { participant: '5511922222222@s.whatsapp.net' }
          }
        }
      });
      assert.strictEqual(lastAction.action, 'promote');
      assert.strictEqual(lastAction.participants[0], '5511922222222@s.whatsapp.net');
      assert(lastSentMsg.text.includes('ADMINISTRADOR PROMOVIDO'));

      // 4.3 Comando !promover quando solicitante é Dono/Admin global (isOwner)
      models.setSetting('OWNER_PHONE', '5511999998888');
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511999998888@s.whatsapp.net', fromMe: false },
        message: { conversation: '!promover 5511922222222' }
      });
      assert.strictEqual(lastAction.action, 'promote');
      assert(lastSentMsg.text.includes('ADMINISTRADOR PROMOVIDO'));

      // 4.4 Comando !rebaixar (Demote membro que é admin)
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511900000000@s.whatsapp.net', fromMe: false },
        message: { conversation: '!rebaixar 5511911111111' }
      });
      assert.strictEqual(lastAction.action, 'demote');
      assert.strictEqual(lastAction.participants[0], '5511911111111@s.whatsapp.net');
      assert(lastSentMsg.text.includes('ADMINISTRADOR REBAIXADO'));

      // 4.5 Comando !promover no privado por Admin/Owner (orientação sem erro de Acesso Restrito)
      let pvPromoteReply = null;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
        message: { conversation: '!promover' }
      }, {
        sendMessage: async (jid, p) => { pvPromoteReply = p; return true; }
      });
      assert(pvPromoteReply !== null);
      assert(pvPromoteReply.text.includes('PROMOÇÃO DE PRODUTOS') || pvPromoteReply.text.includes('Como Promover'));
      assert(!pvPromoteReply.text.includes('Acesso Restrito'));

      // Restaura OWNER_PHONE
      models.setSetting('OWNER_PHONE', prevOwner);

      // 5. Bloqueio para não-admins
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511922222222@s.whatsapp.net', fromMe: false },
        message: { conversation: '!ban 5511911111111' }
      });
      assert(lastSentMsg.text.includes('Apenas administradores'));

      // 6. Anti-link toggle
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
        message: { conversation: '!antilink on' }
      });
      assert.strictEqual(models.getSetting(`ANTILINK_${testGroup}`), 'true');
      assert(lastSentMsg.text.includes('ANTI-LINK ATIVADA'));
    } finally {
      whatsappBot.sock = originalSock;
      whatsappBot.sendMessage = originalSendMessage;
      models.setSetting('OWNER_PHONE', prevOwner);
    }
  });

  await runAsyncTest('Gestão de Grupos: Resolução de Privilégios no Telegram Bot', async () => {
    const telegramBot = require('./src/bots/telegramBot');
    const mockCtx = {
      chat: { id: -1001988887777, type: 'supergroup' },
      from: { id: 987654 },
      botInfo: { id: 555666 },
      getChatMember: async (id) => {
        if (id === 555666) return { status: 'administrator' }; // Bot é admin
        if (id === 987654) return { status: 'administrator' }; // Usuário é admin
        return { status: 'member' };
      }
    };

    const status = await telegramBot.getTelegramAdminStatus(mockCtx);
    assert.strictEqual(status.isGroup, true);
    assert.strictEqual(status.isRequesterAdmin, true);
    assert.strictEqual(status.isBotAdmin, true);

    // Quando bot NÃO é admin
    mockCtx.getChatMember = async (id) => {
      if (id === 555666) return { status: 'member' };
      return { status: 'administrator' };
    };
    const statusNoBotAdmin = await telegramBot.getTelegramAdminStatus(mockCtx);
    assert.strictEqual(statusNoBotAdmin.isBotAdmin, false);
    assert.strictEqual(statusNoBotAdmin.isRequesterAdmin, true);
  });

  await runAsyncTest('Gestão de Grupos: Boas-Vindas Automáticas e Customização', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363099999999999@g.us';

    let lastSentMsg = null;
    const originalSock = whatsappBot.sock;
    const originalSendMessage = whatsappBot.sendMessage;

    whatsappBot.sendMessage = async (jid, text, opt) => {
      lastSentMsg = { jid, text, opt };
      return true;
    };

    whatsappBot.sock = {
      user: { id: '5511900000000:1@s.whatsapp.net' },
      groupMetadata: async () => ({
        participants: [
          { id: '5511900000000@s.whatsapp.net', admin: 'admin' },
          { id: '5511911111111@s.whatsapp.net', admin: 'admin' }
        ]
      })
    };

    // 1. Configurar mensagem de boas-vindas customizada
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
      message: { conversation: '!boasvindas_msg Bem-vindo {nome} ao super grupo {grupo}!' }
    });
    assert(lastSentMsg.text.includes('MENSAGEM DE BOAS-VINDAS ATUALIZADA'));
    assert.strictEqual(models.getSetting(`WELCOME_${testGroup}`), 'true');
    assert.strictEqual(models.getSetting(`WELCOME_MSG_${testGroup}`), 'Bem-vindo {nome} ao super grupo {grupo}!');

    // 2. Consulta de configurações do grupo
    const settings = models.getGroupSettings('whatsapp', testGroup);
    assert.strictEqual(settings.welcome, true);
    assert(settings.welcomeMsg.includes('super grupo'));

    // 3. Desativar boas-vindas
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511911111111@s.whatsapp.net', fromMe: false },
      message: { conversation: '!boasvindas off' }
    });
    assert(lastSentMsg.text.includes('BOAS-VINDAS AUTOMÁTICAS DESATIVADAS'));
    assert.strictEqual(models.getSetting(`WELCOME_${testGroup}`), 'false');

    whatsappBot.sock = originalSock;
    whatsappBot.sendMessage = originalSendMessage;
  });

  await runAsyncTest('Gestão de Grupos: Logs de Auditoria & APIs REST (/api/groups/*)', async () => {
    const testGroupId = '120363088888888888@g.us';

    // 1. Registro de Ação no Model
    const logResult = models.logGroupAdminAction({
      platform: 'whatsapp',
      groupId: testGroupId,
      groupName: 'Grupo VIP de Traders',
      adminId: '5511999991111',
      adminName: 'Admin Roberto',
      action: 'BAN',
      targetId: '5511988882222',
      details: 'Spam de link de pirataria'
    });
    assert(logResult.logged, 'Ação de grupo deve ser logada com sucesso');

    // 2. Consulta no Model
    const logs = models.getGroupAdminAuditLogs({ groupId: testGroupId });
    assert(logs.length >= 1);
    assert.strictEqual(logs[0].action, 'BAN');
    assert.strictEqual(logs[0].target_id, '5511988882222');

    // 3. API REST: GET /api/groups/audit-logs
    const apiLogs = await fetchApi(`/api/groups/audit-logs?groupId=${encodeURIComponent(testGroupId)}`);
    assert.strictEqual(apiLogs.status, 200);
    assert(Array.isArray(apiLogs.data));
    assert(apiLogs.data.some(l => l.action === 'BAN'));

    // 4. API REST: GET e POST /api/groups/:groupId/settings
    const postSettings = await fetchApi(`/api/groups/${encodeURIComponent(testGroupId)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        antilink: true,
        welcome: true,
        welcomeMsg: 'Olá {nome}, boas-vindas ao nosso grupo de testes!'
      })
    });
    assert.strictEqual(postSettings.status, 200);
    assert.strictEqual(postSettings.data.antilink, true);
    assert.strictEqual(postSettings.data.welcome, true);

    const getSettings = await fetchApi(`/api/groups/${encodeURIComponent(testGroupId)}/settings?platform=whatsapp`);
    assert.strictEqual(getSettings.status, 200);
    assert.strictEqual(getSettings.data.antilink, true);
    assert.strictEqual(getSettings.data.welcome, true);
    assert(getSettings.data.welcomeMsg.includes('boas-vindas ao nosso grupo de testes'));

    // 5. API REST: DELETE /api/groups/audit-logs
    const clearRes = await fetchApi(`/api/groups/audit-logs?groupId=${encodeURIComponent(testGroupId)}`, {
      method: 'DELETE'
    });
    assert.strictEqual(clearRes.status, 200);
    assert(clearRes.data.success);

    const logsAfterClear = models.getGroupAdminAuditLogs({ groupId: testGroupId });
    assert.strictEqual(logsAfterClear.length, 0);
  });

  await runAsyncTest('Triggers Inteligentes & FAQ: Criação, Correspondência e Resposta Dinâmica', async () => {
    const nlpService = require('./src/services/nlpService');

    // 1. Criação no Model
    const createdTrig = models.createCustomTrigger({
      keyword: 'metodo comprovado',
      matchType: 'CONTAINS',
      responseText: 'Olá {nome}! O {produto} é 100% comprovado por mais de mil clientes!',
      category: 'Prova Social',
      platform: 'all'
    });
    assert(createdTrig.id > 0);
    assert.strictEqual(createdTrig.keyword, 'metodo comprovado');

    // 2. Matching no Model
    const match = models.findMatchingTrigger('esse metodo comprovado funciona mesmo?');
    assert(match, 'Deve encontrar o trigger cadastrado');
    assert.strictEqual(match.id, createdTrig.id);

    // 3. Resposta formatada no nlpService
    const nlpRes = await nlpService.processMessage({
      text: 'Quero saber se esse metodo comprovado funciona',
      customerName: 'Renato',
      platform: 'whatsapp'
    });
    assert.strictEqual(nlpRes.intent, 'CUSTOM_TRIGGER');
    assert(nlpRes.replyText.includes('Renato'));
    assert(nlpRes.replyText.includes('comprovado por mais de mil clientes'));

    // 4. REST API: GET, PUT, DELETE /api/triggers
    const getTrigs = await fetchApi('/api/triggers');
    assert.strictEqual(getTrigs.status, 200);
    assert(Array.isArray(getTrigs.data));
    assert(getTrigs.data.some(t => t.id === createdTrig.id));

    const putTrig = await fetchApi(`/api/triggers/${createdTrig.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: 0 })
    });
    assert.strictEqual(putTrig.status, 200);
    assert.strictEqual(putTrig.data.active, 0);

    const delTrig = await fetchApi(`/api/triggers/${createdTrig.id}`, { method: 'DELETE' });
    assert.strictEqual(delTrig.status, 200);
    assert.strictEqual(delTrig.data.success, true);
  });

  await runAsyncTest('Atendimento Humano: Tickets de Suporte, Roleta de Vendedores e Comandos', async () => {
    // 1. Abertura de Ticket com atribuição da roleta de vendedores
    const ticket = models.createSupportTicket({
      platform: 'whatsapp',
      customerId: '5511999887766',
      customerName: 'Cliente Teste Suporte',
      issueSummary: 'Dúvida sobre ativação do bot'
    });
    assert(ticket.id > 0);
    assert.strictEqual(ticket.status, 'OPEN');
    assert(ticket.seller_id > 0, 'Deve atribuir um vendedor ativo da roleta');

    // 2. Atualização de Status
    const resolved = models.updateSupportTicketStatus(ticket.id, 'RESOLVED');
    assert.strictEqual(resolved.status, 'RESOLVED');

    // 3. REST API /api/tickets
    const apiTickets = await fetchApi(`/api/tickets?status=RESOLVED`);
    assert.strictEqual(apiTickets.status, 200);
    assert(apiTickets.data.some(t => t.id === ticket.id));

    // 4. Comando !suporte no WhatsApp
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastMsg = null;
    const origSend = whatsappBot.sendMessage;
    whatsappBot.sendMessage = async (jid, text) => {
      lastMsg = text;
      return true;
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999887766@s.whatsapp.net', fromMe: false },
      message: { conversation: '!suporte' },
      pushName: 'Cliente Suporte Wpp'
    });
    assert(lastMsg.includes('CHAMADO DE SUPORTE ABERTO'));

    whatsappBot.sendMessage = origSend;
  });

  await runAsyncTest('Métricas Detalhadas por Canal (/api/metrics/channels)', async () => {
    const res = await fetchApi('/api/metrics/channels');
    assert.strictEqual(res.status, 200);
    const data = res.data;
    assert('whatsapp' in data);
    assert('telegram' in data);
    assert('instagram' in data);
    assert('facebook' in data);
    assert('ordersCount' in data.whatsapp);
    assert('revenueBRL' in data.whatsapp);
  });

  await runAsyncTest('Moderação de Grupos: Proteção Anti-Flood', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363066666666666@g.us';
    const spammerPhone = '5511977776666';
    const spammerJid = `${spammerPhone}@s.whatsapp.net`;

    let deletedMsgs = 0;
    let warned = false;

    const origSock = whatsappBot.sock;
    const origSend = whatsappBot.sendMessage;

    whatsappBot.sock = {
      user: { id: '5511900000000:1@s.whatsapp.net' },
      groupMetadata: async () => ({
        participants: [
          { id: '5511900000000@s.whatsapp.net', admin: 'admin' },
          { id: spammerJid, admin: null }
        ]
      }),
      sendMessage: async (jid, content) => {
        if (content.delete) deletedMsgs++;
        return true;
      }
    };

    whatsappBot.sendMessage = async (jid, text) => {
      if (text.includes('anti-flood')) warned = true;
      return true;
    };

    // Dispara 7 mensagens em sequência rápida do mesmo membro comum no grupo
    for (let i = 0; i < 7; i++) {
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: testGroup, participant: spammerJid, fromMe: false, id: `MSG_${i}` },
        message: { conversation: `Spam mensagem ${i}` }
      });
    }

    assert(deletedMsgs >= 1, 'Deve apagar mensagens que excederem o limite de flood');
    assert(warned, 'Deve avisar o participante sobre o anti-flood');

    whatsappBot.sock = origSock;
    whatsappBot.sendMessage = origSend;
  });

  // ----------------------------------------------------------------
  // 13. Testes de Facilidades de Uso, Busca Global & Ações Rápidas
  // ----------------------------------------------------------------
  console.log('\n⚡ 13. Testes de Facilidades de Uso, Busca Global & Ações Rápidas:');

  await runTest('Busca Global Instantânea (/api/search)', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/search?q=`);
    const emptyData = await emptyRes.json();
    assert(Array.isArray(emptyData.products) && emptyData.products.length === 0, 'Busca vazia deve retornar array vazio');

    const prodRes = await fetch(`${baseUrl}/api/search?q=Licen`);
    const prodData = await prodRes.json();
    assert(Array.isArray(prodData.products) && prodData.products.length > 0, 'Deve encontrar produtos com termo "Licen"');
    assert(Array.isArray(prodData.orders), 'Deve retornar lista de pedidos');
    assert(Array.isArray(prodData.sellers), 'Deve retornar lista de vendedores');
    assert(Array.isArray(prodData.affiliates), 'Deve retornar lista de afiliados');
    assert(Array.isArray(prodData.tickets), 'Deve retornar lista de tickets');
  });

  await runTest('Cobrança Instantânea Pix & Cripto (/api/quick-charge)', async () => {
    const products = models.getProducts();
    assert(products.length > 0, 'Deve ter produtos cadastrados');
    const p = products[0];

    const pixRes = await fetch(`${baseUrl}/api/quick-charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: p.id,
        gateway: 'pix',
        customerName: 'Cliente Rápido Teste',
        customerId: 'quick_test_123'
      })
    });
    const pixData = await pixRes.json();
    assert(pixData.success === true, 'Cobrança rápida Pix deve ser gerada com sucesso');
    assert(pixData.tradeNo && pixData.tradeNo.startsWith('ORD_QUICK_'), 'Deve conter tradeNo gerado');
    assert(pixData.pixCode, 'Deve conter código Pix');
    assert(pixData.currency === 'BRL', 'Moeda deve ser BRL');

    const binRes = await fetch(`${baseUrl}/api/quick-charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: p.id,
        gateway: 'binancepay',
        customerName: 'Cliente Cripto Teste',
        customerId: 'quick_test_456'
      })
    });
    const binData = await binRes.json();
    assert(binData.success === true, 'Cobrança rápida Binance Pay deve ser gerada com sucesso');
    assert(binData.currency === 'USDT', 'Moeda deve ser USDT');
    assert(binData.checkoutUrl || binData.qrContent, 'Deve retornar checkoutUrl ou qrContent');
  });

  await runTest('Envio Rápido de Mensagem com Spintax (/api/quick-message)', async () => {
    const msgRes = await fetch(`${baseUrl}/api/quick-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5511999998888',
        message: '{Olá|Oi|E aí} {Cliente|Amigo}, temos novidades!'
      })
    });
    const msgData = await msgRes.json();
    assert(msgData.success === true, 'Mensagem rápida deve ser enviada com sucesso');
    assert(msgData.phone === '5511999998888', 'Telefone deve ser sanitizado');
    assert(!msgData.text.includes('{') && !msgData.text.includes('|'), 'Spintax deve ser processado e resolvido');
  });

  // ----------------------------------------------------------------
  // 14. Funcionalidades Spy Bot / Spy (Stickers, Segurança, Anti-Fake, Anti-View-Once, IA, Fidelidade & Mini-Games)
  // ----------------------------------------------------------------
  console.log('\n🐾 14. Funcionalidades Spy Bot / Spy (Stickers, Segurança, IA & Fidelidade):');

  await runTest('Spy: Sistema de Advertências (3-Strikes Auto-Ban)', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const testGroup = '120363011223344556@g.us';
    const badUser = '5511977771234';

    models.clearWarnings(testGroup, badUser);
    assert.strictEqual(models.getWarningsCount(testGroup, badUser), 0);

    // Advertência 1
    const res1 = models.addWarning(testGroup, badUser, 'Primeiro aviso: spam', 'Admin Carlos');
    assert.strictEqual(res1.count, 1);
    assert.strictEqual(models.getWarningsCount(testGroup, badUser), 1);

    // Advertência 2
    const res2 = models.addWarning(testGroup, badUser, 'Segundo aviso: flood', 'Admin Carlos');
    assert.strictEqual(res2.count, 2);

    // Remoção de advertência (unwarn)
    const removed = models.removeLastWarning(testGroup, badUser);
    assert.strictEqual(removed, true);
    assert.strictEqual(models.getWarningsCount(testGroup, badUser), 1);

    // Execução do comando de aviso atingindo 3 strikes via handleWarn
    let bannedJid = null;
    let sentText = null;
    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        if (action === 'remove') bannedJid = participants[0];
      },
      sendMessage: async (jid, payload) => {
        sentText = payload.text;
        return true;
      }
    };

    // Strike 2
    await spyFeatures.handleWarn(mockSock, testGroup, badUser, 'Desrespeito', 'Admin Carlos', true);
    assert(sentText.includes('ADVERTÊNCIA REGISTRADA (2/3)'));
    assert.strictEqual(bannedJid, null);

    // Strike 3 (Auto-ban)
    await spyFeatures.handleWarn(mockSock, testGroup, badUser, 'Reincidência', 'Admin Carlos', true);
    assert(sentText.includes('LIMITE DE ADVERTÊNCIAS ATINGIDO (3/3)'));
    assert(sentText.includes('banido do grupo automaticamente'));
    assert.strictEqual(bannedJid, `${badUser}@s.whatsapp.net`);
    assert.strictEqual(models.getWarningsCount(testGroup, badUser), 0, 'Advertências devem ser zeradas após expulsão');
  });

  await runTest('Spy: Proteção Anti-Fake (Ban de Números Estrangeiros Não +55)', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const testGroup = '120363099887766554@g.us';

    models.setSetting(`ANTIFAKE_${testGroup}`, 'true');

    let removedList = [];
    let sentNotice = null;
    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        if (action === 'remove') removedList.push(...participants);
      },
      sendMessage: async (jid, payload) => {
        sentNotice = payload.text;
        return true;
      }
    };

    // Cenário: Entram 2 participantes, um dos EUA (+1) e um do Brasil (+55) em formato objeto Baileys
    const participants = [
      { id: '14155552671@s.whatsapp.net', admin: null }, // Número fake / estrangeiro como objeto
      '5511999998888@s.whatsapp.net'  // Número brasileiro legítimo
    ];

    await spyFeatures.checkAntiFakeEntry(mockSock, testGroup, participants);

    assert(removedList.includes('14155552671@s.whatsapp.net'), 'Número americano (+1) deve ser banido');
    assert(!removedList.includes('5511999998888@s.whatsapp.net'), 'Número brasileiro (+55) NÃO deve ser banido');
    assert(sentNotice.includes('ANTI-FAKE ATIVADO'), 'Deve emitir aviso no grupo');
  });

  await runTest('Spy: Registro e Anti-View-Once (Visualização Única Revelada)', async () => {
    const testGroup = '120363055443322110@g.us';
    const sender = '5511988887777';

    // 1. Registro no banco de dados
    const logged = models.logViewOnceMedia(testGroup, sender, 'image', 'Foto secreta temporária');
    assert(logged.id > 0);
    assert.strictEqual(logged.media_type, 'image');

    // 2. Consulta de logs
    const logs = models.getViewOnceLogs(testGroup);
    assert(logs.length > 0);
    assert(logs.some(l => l.caption === 'Foto secreta temporária'));
  });

  await runTest('Spy: Google TTS & Google Translate Instantâneo', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');

    // 1. Tradução
    let translatedMsg = null;
    const mockSockTr = {
      sendMessage: async (jid, payload) => {
        translatedMsg = payload.text;
        return true;
      }
    };

    await spyFeatures.handleTranslate(mockSockTr, 'test_chat', '!traduzir en Olá bom dia amigo');
    assert(translatedMsg.includes('TRADUÇÃO (EN)'));
    assert(translatedMsg.toLowerCase().includes('good morning') || translatedMsg.toLowerCase().includes('hello') || translatedMsg.toLowerCase().includes('friend'));

    // 2. TTS (Áudio do Google)
    let audioPayload = null;
    const mockSockTts = {
      sendMessage: async (jid, payload) => {
        audioPayload = payload;
        return true;
      }
    };

    await spyFeatures.handleTTS(mockSockTts, 'test_chat', '!tts Bem vindo ao PayBot');
    assert(audioPayload && audioPayload.audio, 'Deve gerar buffer de áudio');
    assert.strictEqual(audioPayload.ptt, true, 'Deve ser formatado como PTT (áudio de voz)');
  });

  await runTest('Spy: Gamificação, Nível de Fidelidade & Resgate de Cupons', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const userPhone = '55119' + Date.now().toString().slice(-7) + Math.floor(Math.random() * 90 + 10);

    // 1. Perfil Inicial
    const initial = models.getUserLoyalty('whatsapp', userPhone, 'Jogador Teste');
    assert.strictEqual(initial.points, 50, 'Novo usuário ganha 50 pontos iniciais de boas-vindas');
    assert.strictEqual(initial.level, 1);

    // 2. Tentativa de resgate sem saldo suficiente
    const failRedeem = models.redeemLoyaltyCoupon('whatsapp', userPhone, 100);
    assert.strictEqual(failRedeem.success, false);
    assert(failRedeem.error.includes('insuficiente'));

    // 3. Mini-game de Dados (!dado) bonificando pontos e experiência
    let dadoOutput = null;
    const mockSockGame = {
      sendMessage: async (jid, payload) => {
        dadoOutput = payload.text;
        return true;
      }
    };

    await spyFeatures.handleDado(mockSockGame, 'test_chat', userPhone, 'Jogador Teste');
    assert(dadoOutput.includes('JOGO DOS DADOS'));
    assert(dadoOutput.includes('Moedas de Fidelidade'));

    // 4. Adiciona saldo suficiente para resgate (120 pontos e 250 XP)
    const updated = models.addLoyaltyPoints('whatsapp', userPhone, 120, 250, 'Jogador Teste');
    assert(updated.points >= 120);
    assert(updated.level >= 3, 'Deve subir para pelo menos nível 3 com 250+ XP');

    // 5. Resgate de Cupom de 15% OFF
    const redeemRes = models.redeemLoyaltyCoupon('whatsapp', userPhone, 100);
    assert.strictEqual(redeemRes.success, true);
    assert.strictEqual(redeemRes.discountPercent, 15);
    assert(redeemRes.couponCode.startsWith('FIDELIDADE_'));

    // Valida se o cupom criado pelo resgate é utilizável na loja
    const couponInDb = models.getCouponByCode(redeemRes.couponCode);
    assert(couponInDb !== null);
    assert.strictEqual(couponInDb.discount_percent, 15);
    assert.strictEqual(couponInDb.active, 1);
  });

  await runTest('Spy: Roteamento de Comandos WhatsApp (!comandos, !perfil, !dado)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastReply = null;
    const origSend = whatsappBot.sendMessage;
    whatsappBot.sendMessage = async (jid, payload) => {
      lastReply = typeof payload === 'string' ? payload : payload.text;
      return true;
    };

    // 1. Catálogo geral de comandos !comandos
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999112233@s.whatsapp.net', fromMe: false },
      message: { conversation: '!comandos' },
      pushName: 'Cliente VIP'
    });
    assert(lastReply.includes('CATÁLOGO DE COMANDOS SPY BOT'));
    assert(lastReply.includes('!s'));
    assert(lastReply.includes('!play'));
    assert(lastReply.includes('!ia'));

    // 2. Consulta de Perfil !perfil
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999112233@s.whatsapp.net', fromMe: false },
      message: { conversation: '!perfil' },
      pushName: 'Cliente VIP'
    });
    assert(lastReply.includes('PERFIL DO USUÁRIO'));
    assert(lastReply.includes('Nível'));
    assert(lastReply.includes('Moedas de Fidelidade'));

    // 3. Mini-game de roleta !roleta
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999112233@s.whatsapp.net', fromMe: false },
      message: { conversation: '!roleta' },
      pushName: 'Cliente VIP'
    });
    assert(lastReply.includes('ROLETA DA SORTE SPY'));

    whatsappBot.sendMessage = origSend;
  });

  await runTest('Spy: Downloader de Música YouTube (!play / !ytmp3)', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sentOutputs = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentOutputs.push(payload);
        return true;
      }
    };

    // Executa busca e download da música
    await spyFeatures.handlePlayMusic(mockSock, '5511999998888@s.whatsapp.net', '!play Imagine Dragons Believer');

    assert(sentOutputs.length >= 2, 'Deve enviar cartão de status e em seguida o áudio');
    const firstMsg = sentOutputs[0];
    assert((firstMsg.caption || firstMsg.text).includes('YOUTUBE PLAY'), 'Deve conter cartão do YouTube');
    assert((firstMsg.caption || firstMsg.text).includes('Believer'), 'Deve encontrar o título da música');

    const audioMsg = sentOutputs[1];
    assert(audioMsg.audio && Buffer.isBuffer(audioMsg.audio), 'Deve conter buffer de áudio válido');
    assert(audioMsg.audio.length > 50000, 'Tamanho do áudio deve ser significativo (>50KB)');
    assert.strictEqual(audioMsg.mimetype, 'audio/mp4');
    assert(audioMsg.fileName.includes('.mp3'));
  });

  await runTest('Spy: Conversor de Figurinhas WebP (!s / !sticker)', async () => {
    const stickerConverter = require('./src/utils/stickerConverter');
    const { execSync } = require('child_process');

    // Gera um buffer de imagem sintética para testar
    const dummyPng = execSync('python -c "import io, sys; from PIL import Image; b=io.BytesIO(); Image.new(\'RGB\', (150, 150), \'blue\').save(b, format=\'PNG\'); sys.stdout.buffer.write(b.getvalue())"');
    assert(dummyPng.length > 0);

    const webp = await stickerConverter.convertImageToWebP(dummyPng);
    assert(Buffer.isBuffer(webp));
    assert(webp.length > 100);
    assert.strictEqual(webp.slice(0, 4).toString(), 'RIFF');
    assert.strictEqual(webp.slice(8, 12).toString(), 'WEBP');
  });

  await runTest('Spy: Scraper & Auditoria de Perfil Instagram (!scrapinsta)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastMsg = null;
    const mockSock = {
      sendMessage: async (jid, payload) => {
        lastMsg = typeof payload === 'string' ? payload : (payload.caption || payload.text || '');
        return true;
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!scrapinsta github' }
    }, mockSock);

    assert(lastMsg.includes('RELATÓRIO DE INTELIGÊNCIA INSTAGRAM'));
    assert(lastMsg.includes('MATURIDADE INTELECTUAL'));
    assert(lastMsg.includes('Seguidores:'));
  });

  await runTest('Spy: Download de Stories Instagram (!allstories)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastMsg = null;
    const mockSock = {
      sendMessage: async (jid, payload) => {
        lastMsg = typeof payload === 'string' ? payload : (payload.caption || payload.text || '');
        return true;
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!allstories github' }
    }, mockSock);

    assert(lastMsg.includes('github') || lastMsg.includes('story') || lastMsg.includes('stories'));
  });

  await runTest('Spy: Boas-Vindas e Despedida Automática com Objetos e Strings Baileys (!boasvindas & !despedida)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363011998877665@g.us';

    models.setSetting(`WELCOME_${testGroup}`, 'true');
    models.setSetting(`WELCOME_MSG_${testGroup}`, 'Olá {nome}, bem-vindo ao grupo {grupo}! Seu número é {numero}.');
    models.setSetting(`BYE_${testGroup}`, 'true');
    models.setSetting(`BYE_MSG_${testGroup}`, 'Até logo @{numero} do grupo {grupo}!');

    const sentMessages = [];
    const mockGroupSock = {
      user: { id: '5511988880000:1@s.whatsapp.net' },
      groupMetadata: async (gid) => ({ subject: 'Grupo VIP Spy', participants: [] }),
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'mock_msg' } };
      }
    };

    // 1. Testa entrada de participantes com diferentes formatos emitidos pelo Baileys (string, objeto com id, objeto com phoneNumber)
    const incomingParticipants = [
      '5511999991111@s.whatsapp.net',
      { id: '5511999992222:5@s.whatsapp.net', admin: null },
      { phoneNumber: '5511999993333' }
    ];

    await whatsappBot.handleGroupParticipantsUpdate({
      id: testGroup,
      participants: incomingParticipants,
      action: 'add'
    }, mockGroupSock);

    assert.strictEqual(sentMessages.length, 3, 'Deve enviar 3 mensagens de boas-vindas sem lançar pJid.split error');
    assert(sentMessages[0].payload.text.includes('@5511999991111'));
    assert(sentMessages[0].payload.mentions.includes('5511999991111@s.whatsapp.net'));
    assert(sentMessages[1].payload.text.includes('@5511999992222'));
    assert(sentMessages[1].payload.mentions.includes('5511999992222:5@s.whatsapp.net'));
    assert(sentMessages[2].payload.text.includes('@5511999993333'));
    assert(sentMessages[2].payload.mentions.includes('5511999993333@s.whatsapp.net'));

    // 2. Testa saída / despedida de participante (action: 'remove')
    sentMessages.length = 0;
    await whatsappBot.handleGroupParticipantsUpdate({
      id: testGroup,
      participants: [{ id: '5511999992222@s.whatsapp.net' }],
      action: 'remove'
    }, mockGroupSock);

    assert.strictEqual(sentMessages.length, 1, 'Deve enviar 1 mensagem de despedida');
    assert(sentMessages[0].payload.text.includes('@5511999992222'));
    assert(sentMessages[0].payload.text.includes('Grupo VIP Spy'));

    // 3. Testa comando administrativo !despedida on/off e !despedida_msg
    let cmdReply = null;
    const mockAdminSock = {
      user: { id: '5511988880000:1@s.whatsapp.net' },
      groupMetadata: async () => ({
        participants: [
          { id: '5511988880000@s.whatsapp.net', admin: 'admin' }
        ]
      }),
      sendMessage: async (jid, payload) => {
        cmdReply = typeof payload === 'string' ? payload : payload.text;
        return true;
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511988880000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!despedida on' }
    }, mockAdminSock);
    assert(cmdReply.includes('DESPEDIDA ATIVADA'));
    assert.strictEqual(models.getSetting(`BYE_${testGroup}`, 'false'), 'true');

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511988880000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!despedida_msg Adeus @{numero}! Sentiremos sua falta em {grupo}.' }
    }, mockAdminSock);
    assert(cmdReply.includes('DESPEDIDA ATUALIZADA'));
    assert.strictEqual(models.getSetting(`BYE_MSG_${testGroup}`, ''), 'Adeus @{numero}! Sentiremos sua falta em {grupo}.');
  });

  await runTest('Spy: Downloader de Vídeos YouTube (!video / !ytmp4)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastMsg = null;
    const mockSock = {
      sendMessage: async (jid, payload) => {
        lastMsg = typeof payload === 'string' ? payload : (payload.caption || payload.text || '');
        return true;
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!video' }
    }, mockSock);
    assert(lastMsg.includes('DOWNLOADER DE VÍDEOS YOUTUBE'), 'Deve exibir instruções se comando vazio');
  });

  await runTest('Spy: Downloaders de Redes Sociais (!x & !fb)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    let lastMsg = null;
    const mockSock = {
      sendMessage: async (jid, payload) => {
        lastMsg = typeof payload === 'string' ? payload : (payload.caption || payload.text || '');
        return true;
      }
    };

    // Twitter
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!x' }
    }, mockSock);
    assert(lastMsg.includes('Twitter/X'), 'Deve solicitar link do Twitter');

    // Facebook
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!fb' }
    }, mockSock);
    assert(lastMsg.includes('Facebook'), 'Deve solicitar link do Facebook');
  });

  await runTest('Spy: Utilitários Essenciais (!cep, !calc, !encurtar, !qr)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    // 1. Calculadora !calc
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!calc (100 * 2) - 50' }
    }, mockSock);
    const calcRes = sent[sent.length - 1];
    assert(calcRes.text.includes('150'), 'Deve calcular 150');

    // 2. Consulta CEP !cep
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!cep 01001000' }
    }, mockSock);
    const cepRes = sent[sent.length - 1];
    assert(cepRes.text.includes('Praça da Sé') || cepRes.text.includes('CONSULTA DE ENDEREÇO'), 'Deve retornar endereço do ViaCEP');

    // 3. Encurtador !encurtar
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!encurtar https://google.com' }
    }, mockSock);
    const tinyRes = sent[sent.length - 1];
    assert(tinyRes.text.includes('tinyurl.com') || tinyRes.text.includes('LINK ENCURTADO'), 'Deve retornar link encurtado');

    // 4. Gerador de QR Code !qr
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!qr https://loja.com' }
    }, mockSock);
    const qrRes = sent[sent.length - 1];
    assert(qrRes.image && Buffer.isBuffer(qrRes.image), 'Deve retornar imagem em buffer do QR Code');
  });

  await runTest('Spy: Moderação Avançada (!todos, !antidelete & !antiprivado)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const spyFeatures = require('./src/services/spyFeaturesService');
    const testGroup = '120363088776655443@g.us';

    let lastSent = null;
    const mockAdminSock = {
      user: { id: '5511988880000:1@s.whatsapp.net' },
      groupMetadata: async () => ({
        participants: [
          { id: '5511988880000@s.whatsapp.net', admin: 'admin' },
          { id: '5511911112222@s.whatsapp.net', admin: null },
          { id: '5511933334444@s.whatsapp.net', admin: null }
        ]
      }),
      sendMessage: async (jid, payload) => {
        lastSent = payload;
        return true;
      }
    };

    // 1. Chamada geral !todos
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511988880000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!todos Reunião importante às 15h!' }
    }, mockAdminSock);
    assert(lastSent.text.includes('CHAMADA GERAL DO GRUPO'));
    assert(lastSent.text.includes('Reunião importante'));
    assert(lastSent.mentions.length === 3);

    // 2. Anti-Delete: ativação e detecção de mensagem apagada
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511988880000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!antidelete on' }
    }, mockAdminSock);
    assert(lastSent.text.includes('ANTI-DELETE ATIVADO'));
    assert.strictEqual(models.getSetting(`ANTIDELETE_${testGroup}`, 'false'), 'true');

    // Simula mensagem enviada e salva no cache
    const victimMsg = {
      key: { remoteJid: testGroup, id: 'MSG_SECRETA_123', participant: '5511911112222@s.whatsapp.net' },
      pushName: 'Participante Teste',
      message: { conversation: 'Esta mensagem será apagada logo!' }
    };
    spyFeatures.recordMessage(victimMsg);

    // Simula evento de exclusão / revoke
    await spyFeatures.handleRevoke(mockAdminSock, testGroup, 'MSG_SECRETA_123', '5511911112222@s.whatsapp.net');
    assert(lastSent.text.includes('MENSAGEM APAGADA DETECTADA'));
    assert(lastSent.text.includes('Esta mensagem será apagada logo!'));

    // 3. Anti-Privado (Anti-PV)
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, participant: '5511988880000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!antiprivado on' }
    }, mockAdminSock);
    assert(lastSent.text.includes('ANTI-PRIVADO ATIVADO'));
    assert.strictEqual(models.getSetting('ANTIPRIVADO_GLOBAL', 'false'), 'true');

    // Simula mensagem privada de usuário comum (deve ser redirecionado)
    let pvtReply = null;
    const mockPvtSock = {
      sendMessage: async (jid, payload) => {
        pvtReply = payload;
        return true;
      }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511944445555@s.whatsapp.net', fromMe: false },
      message: { conversation: 'Olá bot, você está disponível?' }
    }, mockPvtSock);
    assert(pvtReply !== null, 'Deve responder ao privado');
    assert(pvtReply.text.includes('ATENDIMENTO PRIVADO RESTRITO'), 'Deve avisar que o atendimento privado é restrito');

    // Desativa anti-privado para não interferir em outros testes
    models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
  });

  await runTest('Spy & Painel Web: Configurações Expandidas de Grupo (/api/groups/:groupId/settings)', async () => {
    const testGid = '120363077665544332@g.us';

    // POST /api/groups/:groupId/settings com todos os novos toggles
    const postRes = await fetchApi(`/api/groups/${encodeURIComponent(testGid)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'whatsapp',
        antilink: true,
        welcome: true,
        welcomeMsg: 'Bem-vindo {nome} ao {grupo}!',
        antifake: true,
        antidelete: true,
        antiviewonce: true,
        bye: true,
        byeMsg: 'Adeus @{numero} de {grupo}!'
      })
    });

    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postRes.data.success, true);
    assert.strictEqual(postRes.data.antifake, true);
    assert.strictEqual(postRes.data.antidelete, true);
    assert.strictEqual(postRes.data.bye, true);
    assert.strictEqual(postRes.data.byeMsg, 'Adeus @{numero} de {grupo}!');

    // GET /api/groups/:groupId/settings
    const getRes = await fetchApi(`/api/groups/${encodeURIComponent(testGid)}/settings?platform=whatsapp`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.antifake, true);
    assert.strictEqual(getRes.data.antidelete, true);
    assert.strictEqual(getRes.data.bye, true);
    assert.strictEqual(getRes.data.byeMsg, 'Adeus @{numero} de {grupo}!');
  });

  await runTest('Spy: Central Multi-Contas WhatsApp & Jadibot / Serbot (/api/whatsapp/accounts & !serbot)', async () => {
    const localBaseUrl = `http://localhost:${testPort}`;
    const whatsappBot = require('./src/bots/whatsappBot');

    // 1. GET /api/whatsapp/accounts deve listar ao menos a Matriz
    const listRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts`);
    const listData = await listRes.json();
    assert(Array.isArray(listData));
    assert(listData.length >= 1);
    const mainAcc = listData.find(a => a.is_main);
    assert(mainAcc, 'Deve conter conta Matriz');

    // 2. POST /api/whatsapp/accounts cria nova conta secundária
    const createRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'WhatsApp Atendimento 02 Teste', phone: '11988887777', daily_limit: 60 })
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createData.success, true);
    assert(createData.instance.id > 1);
    assert.strictEqual(createData.instance.phone, '5511988887777'); // auto-adicionou DDI 55

    const subId = createData.instance.id;

    // 3. POST /api/whatsapp/accounts/:id/pairing-code gera código de pareamento de 8 dígitos
    const pairRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts/${subId}/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511988887777' })
    });
    const pairData = await pairRes.json();
    assert(pairData.pairingCode);
    assert(pairData.pairingCode.length >= 8);

    // 4. GET /api/whatsapp/accounts/:id/qr retorna status e código
    const qrRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts/${subId}/qr`);
    const qrData = await qrRes.json();
    assert.strictEqual(qrData.pairingCode, pairData.pairingCode);

    // 5. Teste de comando de chat: !serbot <numero>
    let serbotReply = null;
    const mockSerbotSock = {
      sendMessage: async (jid, p) => { serbotReply = p; return true; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999990000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!serbot 5511966665555' }
    }, mockSerbotSock);
    assert(serbotReply !== null, 'Deve responder ao !serbot');
    assert(serbotReply.text.includes('SPYBOT / SUB-BOT MULTI-CONEXÃO'));
    assert(serbotReply.text.includes('CÓDIGO DE CONEXÃO'));
    assert(serbotReply.text.includes('5511966665555'));

    // 5.1 Teste de agente digitando apenas !serbot no privado (auto-detecta senderPhone)
    let autoSerbotReply = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511977778888@s.whatsapp.net', fromMe: false },
      message: { conversation: '!serbot' }
    }, {
      sendMessage: async (jid, p) => { autoSerbotReply = p; return true; }
    });
    assert(autoSerbotReply !== null, 'Deve responder ao !serbot sem argumentos');
    assert(autoSerbotReply.text.includes('5511977778888'));
    assert(autoSerbotReply.text.includes('CÓDIGO DE CONEXÃO'));

    // 5.2 Teste de agente digitando !serbot em Grupo (marca o participante e gera código)
    let groupSerbotReply = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '120363099999999999@g.us', fromMe: false, participant: '5511966667777@s.whatsapp.net' },
      message: { conversation: '!serbot' }
    }, {
      sendMessage: async (jid, p) => { groupSerbotReply = p; return true; }
    });
    assert(groupSerbotReply !== null, 'Deve responder ao !serbot em grupo');
    assert(groupSerbotReply.text.includes('5511966667777'));
    assert(groupSerbotReply.text.includes('código'));

    // 6. Teste de comando de chat: !bots
    let botsReply = null;
    const mockBotsSock = {
      sendMessage: async (jid, p) => { botsReply = p; return true; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999990000@s.whatsapp.net', fromMe: false },
      message: { conversation: '!bots' }
    }, mockBotsSock);
    assert(botsReply !== null, 'Deve responder ao !bots');
    assert(botsReply.text.includes('CONTAS DE WHATSAPP CONECTADAS'));

    // 7. Bloqueio de exclusão da Matriz (#1)
    const delMainRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts/1`, { method: 'DELETE' });
    assert.strictEqual(delMainRes.status, 400);

    // 8. Exclusão da conta secundária de teste
    const delSubRes = await fetch(`${localBaseUrl}/api/whatsapp/accounts/${subId}`, { method: 'DELETE' });
    assert.strictEqual(delSubRes.status, 200);

    // Limpeza de instâncias secundárias de teste do banco para manter DB impecável
    models.getArmyInstances().forEach(i => {
      if (!i.is_main) {
        try { whatsappArmyService.stopInstance(i.id); } catch (_) {}
        try { models.deleteArmyInstance(i.id); } catch (_) {}
      }
    });
  });

    await runAsyncTest('Persistência de Sessões WhatsApp e Proteção de Credenciais (Session Auto-Lock)', async () => {
    const fs = require('fs');
    const whatsappBot = require('./src/bots/whatsappBot');
    const whatsappArmyService = require('./src/services/whatsappArmyService');
    const path = require('path');

    // 1. Verifica se creds.registered está definido como true se creds.me existir
    const authFolder = path.join(__dirname, 'data', 'whatsapp_auth');
    const credsFile = path.join(authFolder, 'creds.json');
    if (fs.existsSync(credsFile)) {
      const raw = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      if (raw.me?.id) {
        assert.strictEqual(raw.registered, true, 'Sessão com creds.me deve ter registered: true para não cair na reinicialização');
      }
    }

    // 2. Verifica se resetSession em ambiente de teste não destrói credenciais reais ativas
    const res = await whatsappBot.resetSession(false);
    assert.strictEqual(res.success, true);
    if (fs.existsSync(credsFile)) {
      const after = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      assert(after.me?.id, 'Credenciais ativas reais não devem ser apagadas por testes');
    }
  });

  await runAsyncTest('Controle Supremo do Dono (Owner) e do Bot Principal sobre Sub-Bots', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const whatsappArmyService = require('./src/services/whatsappArmyService');

    // 1. Configura número de Dono para teste
    const testOwnerPhone = '5511999990001';
    models.setSetting('OWNER_PHONE', testOwnerPhone);

    // 2. Valida método isOwner
    assert.strictEqual(whatsappBot.isOwner(testOwnerPhone, false), true, 'Deve reconhecer o dono configurado');
    assert.strictEqual(whatsappBot.isOwner('5511888880000', false), false, 'Usuário estranho não é dono');
    assert.strictEqual(whatsappBot.isOwner('5511888880000', true), true, 'Mensagem fromMe é sempre dona');

    // Cria sub-bot de teste
    const subInst = models.createArmyInstance({
      name: 'Sub-Bot Dono Teste',
      phone: '5511977771111',
      daily_limit: 100
    });

    // 3. Usuário comum tenta usar comando restrito !divulgar
    let blockedReply = null;
    const mockBlockSock = {
      sendMessage: async (jid, p) => { blockedReply = p; return true; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511988880000@s.whatsapp.net', fromMe: false, participant: '5511988880000@s.whatsapp.net' },
      message: { conversation: '!divulgar Olá clientes!' }
    }, mockBlockSock);
    assert(blockedReply !== null, 'Deve responder ao usuário');
    assert(blockedReply.text.includes('Acesso Restrito: Dono & Bot Principal'), 'Deve bloquear usuário comum em !divulgar');

    // 4. Usuário comum tenta usar comando restrito !reiniciarsubbot
    let restartBlocked = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511988880000@s.whatsapp.net', fromMe: false, participant: '5511988880000@s.whatsapp.net' },
      message: { conversation: `!reiniciarsubbot ${subInst.id}` }
    }, { sendMessage: async (jid, p) => { restartBlocked = p; return true; } });
    assert(restartBlocked.text.includes('Acesso Restrito: Dono & Bot Principal'));

    // 5. Dono executa comando !painelsubbots
    let ownerPanelReply = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${testOwnerPhone}@s.whatsapp.net`, fromMe: false, participant: `${testOwnerPhone}@s.whatsapp.net` },
      message: { conversation: '!painelsubbots' }
    }, { sendMessage: async (jid, p) => { ownerPanelReply = p; return true; } });
    assert(ownerPanelReply !== null);
    assert(ownerPanelReply.text.includes('Comandos Exclusivos do Dono (Owner)'), 'Deve exibir comandos de gestão ao dono');
    assert(ownerPanelReply.text.includes('!divulgar'));

    // 6. Dono executa !reiniciarsubbot <id>
    let ownerRestartReply = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${testOwnerPhone}@s.whatsapp.net`, fromMe: false, participant: `${testOwnerPhone}@s.whatsapp.net` },
      message: { conversation: `!reiniciarsubbot ${subInst.id}` }
    }, { sendMessage: async (jid, p) => { ownerRestartReply = p; return true; } });
    assert(ownerRestartReply !== null);
    assert(ownerRestartReply.text.includes('Reiniciando conexão') || ownerRestartReply.text.includes('sucesso'));

    // 7. Dono altera número do dono via !setowner
    let ownerSetReply = null;
    const newOwnerPhone = '5511999990002';
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${testOwnerPhone}@s.whatsapp.net`, fromMe: false, participant: `${testOwnerPhone}@s.whatsapp.net` },
      message: { conversation: `!setowner ${newOwnerPhone}` }
    }, { sendMessage: async (jid, p) => { ownerSetReply = p; return true; } });
    assert(ownerSetReply.text.includes('DONO REGISTRADO COM SUCESSO'));
    assert.strictEqual(models.getSetting('OWNER_PHONE'), newOwnerPhone);

    // Limpa sub-bot de teste
    try { await whatsappArmyService.stopInstance(subInst.id); } catch (_) {}
    try { models.deleteArmyInstance(subInst.id); } catch (_) {}
  });

  await runAsyncTest('Motor de Divulgação em Massa do Dono (Broadcast via Exército de Sub-Bots & Spintax)', async () => {
    const localBaseUrl = `http://localhost:${testPort}`;
    const whatsappArmyService = require('./src/services/whatsappArmyService');

    // 1. Executa broadcast programático com Spintax
    const broadcastResult = await whatsappArmyService.broadcastViaAllSubBots({
      message: '{Olá|Oi|E aí}! {Confira nossa oferta|Super novidade no catálogo}!',
      targets: ['5511911110001', '5511911110002'],
      vars: { name: 'Lead Teste' }
    });

    assert.strictEqual(broadcastResult.success, true);
    assert.strictEqual(broadcastResult.totalRecipients, 2);
    assert(broadcastResult.dispatched >= 0);
    assert(broadcastResult.subBotsCount >= 1);

    // 2. Endpoint REST: POST /api/army/broadcast
    const apiBroadcastRes = await fetch(`${localBaseUrl}/api/army/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '{Aproveite|Não perca} {nossas promoções|os descontos} hoje!',
        targetType: 'custom',
        targets: ['5511988880001', '5511988880002']
      })
    });
    assert.strictEqual(apiBroadcastRes.status, 200);
    const apiBroadcastData = await apiBroadcastRes.json();
    assert.strictEqual(apiBroadcastData.success, true);
    assert.strictEqual(apiBroadcastData.totalRecipients, 2);

    // 3. Endpoint REST: GET /api/army/subbots/summary
    const summaryRes = await fetch(`${localBaseUrl}/api/army/subbots/summary`);
    assert.strictEqual(summaryRes.status, 200);
    const summaryData = await summaryRes.json();
    assert('totalSubBots' in summaryData);
    assert('onlineSubBots' in summaryData);
    assert('totalSentToday' in summaryData);

    // 4. Endpoints REST: GET /api/army/owner & POST /api/army/set-owner
    const setOwnerRes = await fetch(`${localBaseUrl}/api/army/set-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511987654321' })
    });
    assert.strictEqual(setOwnerRes.status, 200);
    const setOwnerData = await setOwnerRes.json();
    assert.strictEqual(setOwnerData.success, true);
    assert.strictEqual(setOwnerData.owner_phone, '5511987654321');

    const getOwnerRes = await fetch(`${localBaseUrl}/api/army/owner`);
    const getOwnerData = await getOwnerRes.json();
    assert.strictEqual(getOwnerData.owner_phone, '5511987654321');
  });

  await runAsyncTest('Spy: Catálogo de Comandos via !help e !bot', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    
    // 1. Testa acionamento via !help
    let replyHelp = null;
    const mockSockHelp = {
      user: { id: '5511999990000:1@s.whatsapp.net' },
      sendMessage: async (jid, p) => { replyHelp = p; return true; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { id: 'MSG_HELP_TEST_1', remoteJid: '5511977770001@s.whatsapp.net', fromMe: false, participant: '5511977770001@s.whatsapp.net' },
      message: { conversation: '!help' }
    }, mockSockHelp);

    assert(replyHelp !== null, 'Deve responder ao comando !help');
    assert(replyHelp.text.includes('CATÁLOGO DE COMANDOS SPY BOT'), 'Deve retornar o catálogo em !help');
    assert(replyHelp.text.includes('!s'), 'Deve listar comando de figurinha !s');
    assert(replyHelp.text.includes('!play'), 'Deve listar comando de música !play');

    // 2. Testa acionamento via !bot
    let replyBot = null;
    const mockSockBot = {
      user: { id: '5511999990000:1@s.whatsapp.net' },
      sendMessage: async (jid, p) => { replyBot = p; return true; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { id: 'MSG_BOT_TEST_2', remoteJid: '5511977770001@s.whatsapp.net', fromMe: false, participant: '5511977770001@s.whatsapp.net' },
      message: { conversation: '!bot' }
    }, mockSockBot);

    assert(replyBot !== null, 'Deve responder ao comando !bot');
    assert(replyBot.text.includes('CATÁLOGO DE COMANDOS SPY BOT'), 'Deve retornar o catálogo em !bot');
  });

  await runAsyncTest('Anti-Duplicação e Prioridade da Matriz em Grupos Compartilhados com Sub-Bots', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');

    const groupJid = '120363987654321000@g.us';
    const sharedMsgId = 'MSG_SHARED_GROUP_123';

    let matrizReplies = [];
    let subBotReplies = [];

    // Socket simulado da Matriz Principal
    const mockMatrizSock = {
      user: { id: '5511999990001:1@s.whatsapp.net' },
      sendMessage: async (jid, p) => { matrizReplies.push(p); return true; },
      groupMetadata: async () => ({ id: groupJid, participants: [] })
    };

    // Socket simulado do Sub-Bot (Chip #2)
    const mockSubSock = {
      instanceId: 2,
      user: { id: '5511999990002:1@s.whatsapp.net' },
      sendMessage: async (jid, p) => { subBotReplies.push(p); return true; },
      groupMetadata: async () => ({ id: groupJid, participants: [] })
    };

    // Configura Matriz como conectada
    const prevSock = whatsappBot.sock;
    const prevConnected = whatsappBot.isConnected;
    whatsappBot.sock = mockMatrizSock;
    whatsappBot.isConnected = true;

    // 1. Ambos os sockets recebem a mesma mensagem de grupo no mesmo instante
    const groupIncomingMsg = {
      key: { id: sharedMsgId, remoteJid: groupJid, fromMe: false, participant: '5511955554444@s.whatsapp.net' },
      message: { conversation: '!help' }
    };

    // Sub-bot recebe o evento primeiro
    await whatsappBot.handleIncomingMessage(groupIncomingMsg, mockSubSock);
    // Matriz recebe o evento
    await whatsappBot.handleIncomingMessage(groupIncomingMsg, mockMatrizSock);

    // Valida que o Sub-bot NÃO respondeu no grupo (Matriz online tem prioridade)
    assert.strictEqual(subBotReplies.length, 0, 'Sub-bot não deve responder quando a Matriz está no grupo');
    // Valida que a Matriz respondeu normalmente
    assert.strictEqual(matrizReplies.length, 1, 'Matriz principal deve responder no grupo');
    assert(matrizReplies[0].text.includes('CATÁLOGO DE COMANDOS SPY BOT'));

    // 2. Se a mesma mensagem for reenviada, deduplicação global descarta
    await whatsappBot.handleIncomingMessage(groupIncomingMsg, mockMatrizSock);
    assert.strictEqual(matrizReplies.length, 1, 'Não deve reenviar resposta para msgId já processado');

    // Restaura estado original
    whatsappBot.sock = prevSock;
    whatsappBot.isConnected = prevConnected;
  });

  await runAsyncTest('Anti-Ban e Assinaturas Realistas de Dispositivos para o Exército de WhatsApp', async () => {
    const whatsappArmyService = require('./src/services/whatsappArmyService');

    // Valida se cada instância possui assinatura de dispositivo e browser única e realista
    const profile1 = whatsappArmyService.getRealisticBrowserProfile(1);
    const profile2 = whatsappArmyService.getRealisticBrowserProfile(2);
    const profile3 = whatsappArmyService.getRealisticBrowserProfile(3);
    const profile4 = whatsappArmyService.getRealisticBrowserProfile(4);

    assert(Array.isArray(profile1), 'Profile 1 deve ser um array');
    assert(Array.isArray(profile2), 'Profile 2 deve ser um array');
    assert(Array.isArray(profile3), 'Profile 3 deve ser um array');
    assert(Array.isArray(profile4), 'Profile 4 deve ser um array');

    // Instâncias têm signatures desktop autênticas
    assert(profile1[0].includes('Windows') || profile1[0].includes('Mac'));
    assert(profile2[1].includes('Chrome') || profile2[1].includes('Safari') || profile2[1].includes('Edge'));
    assert(profile3[1].includes('Safari') || profile3[1].includes('Chrome'));
  });

  await runAsyncTest('Spy: Busca de 20 Resultados com !lista e Seleção A1..A20 / V1..V20', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');

    // Popula busca com 20 itens simulados
    const mockList = Array.from({ length: 20 }, (_, i) => ({
      title: `Música Teste ${i + 1}`,
      url: `https://www.youtube.com/watch?v=mockId${i + 1}`,
      timestamp: '03:30',
      author: { name: `Artista ${i + 1}` }
    }));
    spyFeatures.userSearchResults.set('120363099@g.us', mockList);

    // Valida que o cache tem 20 itens
    const cached = spyFeatures.userSearchResults.get('120363099@g.us');
    assert.strictEqual(cached.length, 20, 'Deve conter 20 itens no resultado');
    assert.strictEqual(cached[0].title, 'Música Teste 1');
    assert.strictEqual(cached[19].title, 'Música Teste 20');
  });

  await runAsyncTest('Spy: Diagnóstico de Latência, Uptime e Sub-Bots com !ping', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, p) => { sent.push(p); return true; }
    };

    const startTime = Date.now() - 45; // 45ms de latência simulada
    await spyFeatures.handlePing(mockSock, '5511999990000@s.whatsapp.net', startTime);

    assert(sent.length >= 1, 'Deve responder ao comando !ping');
    const text = sent[0].text;
    assert(text.includes('PONG!'), 'Deve conter PONG!');
    assert(text.includes('Velocidade:') || text.includes('ms'), 'Deve exibir velocidade/latência em ms');
    assert(text.includes('Uptime'), 'Deve exibir tempo de atividade');
    assert(text.includes('RAM'), 'Deve exibir consumo de memória');
    assert(text.includes('Sub-Bots'), 'Deve reportar sub-bots');
  });

  await runAsyncTest('Spy: Painel de Configuração e Alternância com !configurar', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, p) => { sent.push(p); return true; }
    };

    // 1. Consulta painel de configurações
    await spyFeatures.handleConfigurar(mockSock, '120363099@g.us', '!configurar');
    assert(sent.length >= 1, 'Deve retornar o painel de configurações');
    assert(sent[0].text.includes('PAINEL DE CONFIGURAÇÕES'));
    assert(sent[0].text.includes('Anti-Link'));

    // 2. Alterna configuração antilink on
    sent.length = 0;
    await spyFeatures.handleConfigurar(mockSock, '120363099@g.us', '!configurar antilink on');
    assert(sent.length >= 1);
    assert(sent[0].text.includes('Anti-Link'));
    assert(sent[0].text.includes('ATIVADO'));
  });

  await runAsyncTest('Spy: Tutorial Completo de Usabilidade dos Sub-Bots com !subbothelp', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, p) => { sent.push(p); return true; }
    };

    await spyFeatures.handleSubBotHelp(mockSock, '5511999990000@s.whatsapp.net', true);
    assert(sent.length >= 1, 'Deve enviar o guia de sub-bots');
    const text = sent[0].text;
    assert(text.includes('GUIA DE USABILIDADE & CONTROLE DOS SUB-BOTS'));
    assert(text.includes('!serbot'));
    assert(text.includes('!bots'));
    assert(text.includes('!stopbot'));
    assert(text.includes('!divulgar'));
  });

  await runAsyncTest('API REST: Diagnóstico do Sistema (/api/system/ping)', async () => {
    const res = await fetch(`http://localhost:${testPort}/api/system/ping`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(typeof data.ping_ms === 'number');
    assert(typeof data.uptime_seconds === 'number');
    assert(typeof data.ram_mb === 'number');
    assert(typeof data.heap_used_mb === 'number');
    assert(typeof data.subbots_total === 'number');
    assert(typeof data.matrix_connected === 'boolean');
  });

  await runAsyncTest('API REST & Bot: Otimização de Memória RAM e Latência (/api/system/optimize-memory & !otimizar)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const res = await fetch(`http://localhost:${testPort}/api/system/optimize-memory`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(typeof data.ram_after_mb === 'number');
    assert(typeof data.heap_after_mb === 'number');

    // Testa comando !otimizar no WhatsApp
    const originalSock = whatsappBot.sock;
    const sent = [];
    try {
      whatsappBot.sock = {
        user: { id: '5511999990000:1@s.whatsapp.net' },
        sendMessage: async (jid, payload) => {
          sent.push(payload);
          return true;
        }
      };
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'OPT_' + Date.now() },
        pushName: 'Admin',
        message: { conversation: '!otimizar' }
      });
      assert(sent.some(s => s.text && s.text.includes('OTIMIZAÇÃO DE MEMÓRIA & LATÊNCIA CONCLUÍDA')), 'Deve responder à otimização');
    } finally {
      whatsappBot.sock = originalSock;
    }
  });

  await runAsyncTest('API REST: Configurações Expandidas Spy e Dono via /api/settings', async () => {
    // 1. Salva novas configs
    const postRes = await fetch(`http://localhost:${testPort}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ANTILINK_DEFAULT: true,
        ANTIFAKE_DEFAULT: true,
        ANTIDELETE_DEFAULT: true,
        OWNER_PHONE: '5511988887777',
        WELCOME_MSG_DEFAULT: 'Bem-vindo ao grupo {nome}!'
      })
    });
    assert.strictEqual(postRes.status, 200);

    // 2. Consulta e valida
    const getRes = await fetch(`http://localhost:${testPort}/api/settings`);
    assert.strictEqual(getRes.status, 200);
    const settings = await getRes.json();
    assert.strictEqual(settings.ANTILINK_DEFAULT, true);
    assert.strictEqual(settings.ANTIFAKE_DEFAULT, true);
    assert.strictEqual(settings.ANTIDELETE_DEFAULT, true);
    assert.strictEqual(settings.OWNER_PHONE, '5511988887777');
    assert.strictEqual(settings.WELCOME_MSG_DEFAULT, 'Bem-vindo ao grupo {nome}!');
  });

  // ----------------------------------------------------------------
  // 15. TESTES DO LANÇAMENTO METEÓRICO & MULTI-GRUPOS COM SUB-BOTS
  // ----------------------------------------------------------------
  console.log('\n🚀 15. Testes do Lançamento Meteórico (Multi-Grupos, Auto-Transbordamento & Sub-Bots):');

  await runAsyncTest('Meteórico: Consulta e Atualização de Configuração via Model e API', async () => {
    const meteoricService = require('./src/services/meteoricService');
    const models = require('./src/db/models');

    // 1. Atualiza configuração
    const updated = meteoricService.updateConfig({
      group_base_name: 'VIP Black #{num}',
      max_members_per_group: 50,
      group_description: 'Grupo VIP de Testes'
    });
    assert.strictEqual(updated.group_base_name, 'VIP Black #{num}');
    assert.strictEqual(updated.max_members_per_group, 50);

    // 2. Consulta status pela API
    const res = await fetch(`http://localhost:${testPort}/api/meteoric/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.campaign.group_base_name, 'VIP Black #{num}');
    assert.strictEqual(data.campaign.max_members_per_group, 50);
    assert(Array.isArray(models.getMeteoricStages()));
    assert.strictEqual(models.getMeteoricStages().length, 5);
  });

  await runAsyncTest('Meteórico: Criação Sequencial de Grupos e Geração de Convite', async () => {
    const meteoricService = require('./src/services/meteoricService');
    const models = require('./src/db/models');

    const result = await meteoricService.createNewMeteoricGroup();
    assert.strictEqual(result.success, true);
    assert(result.group);
    assert(result.group.title.includes('VIP Black'));
    assert(result.group.invite_url.startsWith('https://chat.whatsapp.com/'));
    assert.strictEqual(result.group.is_full, 0);

    const activeGroup = models.getActiveMeteoricGroup();
    assert(activeGroup);
    assert.strictEqual(activeGroup.id, result.group.id);
  });

  await runAsyncTest('Meteórico: Monitoramento de Capacidade e Transbordamento Automático ao Lotar', async () => {
    const meteoricService = require('./src/services/meteoricService');
    const models = require('./src/db/models');

    // Pega o grupo ativo atual
    const currentActive = models.getActiveMeteoricGroup();
    assert(currentActive, 'Deve haver um grupo ativo');

    // Simula entrada de participantes até atingir o limite (50)
    const mockSock = {
      groupMetadata: async () => ({
        participants: new Array(50).fill({ id: '5511999990000@s.whatsapp.net' })
      }),
      sendMessage: async () => true
    };

    const overflowResult = await meteoricService.handleParticipantJoined(currentActive.group_jid, mockSock);
    assert.strictEqual(overflowResult.overflow, true, 'Deve disparar transbordamento');
    assert(overflowResult.newGroup, 'Deve criar o próximo grupo automaticamente');
    assert.strictEqual(overflowResult.newGroup.group_num, currentActive.group_num + 1);

    // O grupo anterior deve estar marcado como is_full = 1
    const oldGroup = models.getMeteoricGroupById(currentActive.id);
    assert.strictEqual(oldGroup.is_full, 1);

    // O novo grupo deve ser o novo grupo ativo
    const newActive = models.getActiveMeteoricGroup();
    assert.strictEqual(newActive.id, overflowResult.newGroup.id);
  });

  await runAsyncTest('Meteórico: Redirecionamento Inteligente de Tráfego (/l/vip & /meteoro)', async () => {
    const models = require('./src/db/models');
    const res = await fetch(`http://localhost:${testPort}/l/vip`, { redirect: 'manual' });
    // Deve ser um redirect 302
    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location');
    assert(location && location.startsWith('https://chat.whatsapp.com/'));

    // Verifica que o contador de leads foi incrementado
    const campaign = models.getMeteoricCampaign();
    assert(campaign.total_leads_reached > 0);
  });

  await runAsyncTest('Meteórico: Orquestração de Etapa de Aquecimento e Diálogo com Sub-Bots', async () => {
    const meteoricService = require('./src/services/meteoricService');

    // Dispara Etapa 1
    const report1 = await meteoricService.executeStageWarmup(1);
    assert.strictEqual(report1.stageNum, 1);
    assert(report1.stageTitle.includes('Antecipação'));
    assert.strictEqual(report1.groupMode, 'announcement');
    assert(report1.subbotInteractionsScheduled > 0);

    // Dispara Etapa 2 (Abertura para dúvidas)
    const report2 = await meteoricService.executeStageWarmup(2);
    assert.strictEqual(report2.stageNum, 2);
    assert(report2.stageTitle.includes('Revelação'));
    assert.strictEqual(report2.groupMode, 'not_announcement');

    // Dispara Etapa 3 (Abertura do carrinho e prova social)
    const report3 = await meteoricService.executeStageWarmup(3);
    assert.strictEqual(report3.stageNum, 3);
    assert(report3.stageTitle.includes('Abertura Oficial'));
  });

  await runAsyncTest('Meteórico: Comandos no WhatsApp (!meteorico status, ativar, criargrupo, etapa)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, p) => { sent.push(p); return true; }
    };

    // 1. !meteorico status
    sent.length = 0;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true },
      message: { conversation: '!meteorico' }
    }, mockSock);
    assert(sent.length >= 1);
    assert(sent[0].text.includes('LANÇAMENTO METEÓRICO'));
    assert(sent[0].text.includes('http://localhost:3000/l/vip'));

    // 2. !meteorico criargrupo
    sent.length = 0;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true },
      message: { conversation: '!meteorico criargrupo Turma VIP Extra' }
    }, mockSock);
    assert(sent.length >= 2);
    const lastMsg = sent[sent.length - 1].text;
    assert(lastMsg.includes('Novo Grupo Meteórico Criado'));

    // 3. !meteorico etapa 2
    sent.length = 0;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true },
      message: { conversation: '!meteorico etapa 2' }
    }, mockSock);
    assert(sent.length >= 2);
    const stageMsg = sent[sent.length - 1].text;
    assert(stageMsg.includes('ETAPA #2 DO METEÓRICO EXECUTADA'));
  });

  await runAsyncTest('Meteórico: Cockpit Web & Gestão Total Sem Celular (/api/meteoric/message, mode-all, sync, activity-logs)', async () => {
    const localBaseUrl = `http://localhost:${testPort}`;
    const whatsappBot = require('./src/bots/whatsappBot');

    // 1. Bulk alternar modo de todos os grupos (open / closed)
    const modeOpenRes = await fetch(`${localBaseUrl}/api/meteoric/groups/mode-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'open' })
    });
    assert.strictEqual(modeOpenRes.status, 200);
    const modeOpenData = await modeOpenRes.json();
    assert.strictEqual(modeOpenData.success, true);
    assert.strictEqual(modeOpenData.mode, 'open');

    const modeClosedRes = await fetch(`${localBaseUrl}/api/meteoric/groups/mode-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' })
    });
    assert.strictEqual(modeClosedRes.status, 200);
    const modeClosedData = await modeClosedRes.json();
    assert.strictEqual(modeClosedData.success, true);
    assert.strictEqual(modeClosedData.mode, 'closed');

    // 2. Disparo de mensagem Web direta como Matriz com Spintax
    const msgRes = await fetch(`${localBaseUrl}/api/meteoric/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderType: 'matriz',
        text: '{Atenção|Aviso VIP}: Vagas quase esgotadas no {link}!'
      })
    });
    assert.strictEqual(msgRes.status, 200);
    const msgData = await msgRes.json();
    assert.strictEqual(msgData.success, true);
    assert(msgData.totalSent >= 1);

    // 3. Disparo de mensagem Web como Sub-Bot simulado
    const subbotMsgRes = await fetch(`${localBaseUrl}/api/meteoric/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderType: 'subbot',
        text: '{Gente|Pessoal}, o curso tem certificado?'
      })
    });
    assert.strictEqual(subbotMsgRes.status, 200);
    const subbotData = await subbotMsgRes.json();
    assert.strictEqual(subbotData.success, true);

    // 4. Sincronização de contagem real de membros com WhatsApp
    const syncRes = await fetch(`${localBaseUrl}/api/meteoric/groups/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(syncRes.status, 200);
    const syncData = await syncRes.json();
    assert.strictEqual(syncData.success, true);

    // 5. Feed de atividades ao vivo
    const logsRes = await fetch(`${localBaseUrl}/api/meteoric/activity-logs?limit=50`);
    assert.strictEqual(logsRes.status, 200);
    const logs = await logsRes.json();
    assert(Array.isArray(logs));
    assert(logs.length >= 1, 'Deve conter registros de atividades no feed');
    const hasWebMsg = logs.some(l => l.event_type === 'WEB_MESSAGE' || l.event_type === 'MODE_CHANGED');
    assert(hasWebMsg, 'Feed deve conter eventos de mensagens web ou alterações de modo');

    // 6. Exclusão de grupo arquivado
    const meteoricService = require('./src/services/meteoricService');
    const tempGroup = await meteoricService.createNewMeteoricGroup({ title: 'Grupo Deletável Teste' });
    const delRes = await fetch(`${localBaseUrl}/api/meteoric/groups/${tempGroup.group.id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);

    // 7. Disparo com Imagem/Banner e Interceptação de Mensagem de Lead
    const imgMsgRes = await fetch(`${localBaseUrl}/api/meteoric/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderType: 'matriz',
        text: 'Confira a imagem da oferta!',
        mediaUrl: 'https://exemplo.com/banner.jpg'
      })
    });
    assert.strictEqual(imgMsgRes.status, 200);

    // Simula mensagem de lead no grupo meteórico ativo
    const activeMeteoricGrp = models.getActiveMeteoricGroup();
    if (activeMeteoricGrp) {
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: activeMeteoricGrp.group_jid, fromMe: false, participant: '5511988887777@s.whatsapp.net' },
        pushName: 'Lead Interessado',
        message: { conversation: 'Tem garantia de reembolso?' }
      });
      const checkLeadLog = models.getMeteoricActivityLogs(10).find(l => l.event_type === 'MEMBER_MESSAGE');
      assert(checkLeadLog, 'Deve registrar dúvida do lead no grupo');
      assert.strictEqual(checkLeadLog.sender_name, 'Lead Interessado');
    }

    // 8. Agendamento Automático de Etapa (Cron Scheduler)
    models.updateMeteoricStage(4, {
      scheduled_at: new Date(Date.now() - 60000).toISOString(),
      auto_execute: 1,
      executed_at: null,
      media_url: 'https://exemplo.com/escassez.jpg'
    });
    const dueStages = models.getDueScheduledStages();
    assert(dueStages.length >= 1, 'Deve encontrar ao menos uma etapa agendada pendente');
    assert.strictEqual(dueStages[0].stage_num, 4);
    const cronResult = await meteoricService.checkAndExecuteScheduledStages();
    assert(cronResult.executed >= 1, 'Cron deve executar etapa agendada com sucesso');
    const stageAfterCron = models.getMeteoricStage(4);
    assert.strictEqual(stageAfterCron.auto_execute, 0, 'Auto-execute deve ser desativado após disparo');

    // 9. Limpeza do feed de logs
    const clearRes = await fetch(`${localBaseUrl}/api/meteoric/activity-logs`, { method: 'DELETE' });
    assert.strictEqual(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.strictEqual(clearData.success, true);
    const logsAfter = await (await fetch(`${localBaseUrl}/api/meteoric/activity-logs`)).json();
    assert.strictEqual(logsAfter.length, 0);
  });

  // ----------------------------------------------------------------
  // 16. TESTES DO RADAR VIRAL & CRIADOR DE POSTS (@ INSTA & FACEBOOK)
  // ----------------------------------------------------------------
  console.log('\n🔥 16. Testes do Radar Viral & Criador de Posts (@ Insta e Facebook):');

  let testViralProfileInsta, testViralProfileFb, testCapturedPost;

  runTest('Cadastro e Sanitização de Perfis Rastreados (@ de Insta e Facebook)', () => {
    testViralProfileInsta = models.createViralProfile({
      platform: 'instagram',
      username: '@trader.expert.brasil',
      display_name: 'Trader Expert Brasil',
      niche: 'Criptomoedas & Sinais VIP',
      notes: 'Ganchos virais de lucros em USDT'
    });

    assert(testViralProfileInsta.id > 0);
    assert.strictEqual(testViralProfileInsta.username, 'trader.expert.brasil');
    assert.strictEqual(testViralProfileInsta.platform, 'instagram');

    testViralProfileFb = models.createViralProfile({
      platform: 'facebook',
      username: 'https://facebook.com/paginavendaspro/',
      display_name: 'Vendas Pro Brasil',
      niche: 'Marketing Digital'
    });

    assert(testViralProfileFb.id > 0);
    assert.strictEqual(testViralProfileFb.platform, 'facebook');
  });

  await runAsyncTest('Captura e Análise de Conteúdos Virais (Hooks, Métricas e Viral Score)', async () => {
    const viralRadarService = require('./src/services/viralRadarService');
    const scrapeRes = await viralRadarService.scrapeProfile(testViralProfileInsta.id);

    assert(scrapeRes.capturedCount >= 1);
    const posts = models.getViralCapturedPosts({ profile_id: testViralProfileInsta.id });
    assert(posts.length >= 1);
    testCapturedPost = posts[0];

    assert(testCapturedPost.viral_score >= 80, 'Score viral deve ser alto');
    assert(testCapturedPost.hook_text.length > 5, 'Deve extrair gancho de retenção');
    assert(testCapturedPost.likes_count > 0);
  });

  await runAsyncTest('Síntese e Geração do Nosso Post com Base no Viral Capturado (Copywriting Engine)', async () => {
    const viralRadarService = require('./src/services/viralRadarService');
    const result = await viralRadarService.generateOurPost({
      viralPostId: testCapturedPost.id,
      targetPlatform: 'whatsapp',
      tone: 'Comercial & Persuasivo',
      objective: 'Vendas & Conversão'
    });

    assert.strictEqual(result.success, true);
    assert(result.post.id > 0);
    assert(result.post.full_content.length > 50);
    assert(result.post.hook.length > 5);
    assert(result.post.cta.includes('http') || result.post.cta.includes('👉'));

    // Verifica se o post de origem foi marcado como USED
    const refreshed = models.getViralCapturedPostById(testCapturedPost.id);
    assert.strictEqual(refreshed.status, 'USED');
  });

  await runAsyncTest('Rotas da API do Radar Viral (/api/viral/profiles, posts, stats, generate)', async () => {
    const localBaseUrl = `http://localhost:${testPort}`;
    // 1. Estatísticas
    const statsRes = await fetch(`${localBaseUrl}/api/viral/stats`);
    assert.strictEqual(statsRes.status, 200);
    const stats = await statsRes.json();
    assert(stats.totalProfiles >= 2);
    assert(stats.totalCaptured >= 2);
    assert(stats.totalGenerated >= 1);

    // 2. Criação de Perfil via API
    const newProfRes = await fetch(`${localBaseUrl}/api/viral/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'instagram',
        username: '@ia.futuro.brasil',
        niche: 'Inteligência Artificial'
      })
    });
    assert.strictEqual(newProfRes.status, 201);
    const newProf = await newProfRes.json();
    assert.strictEqual(newProf.username, 'ia.futuro.brasil');

    // 3. Listagem de Posts Virais
    const postsRes = await fetch(`${localBaseUrl}/api/viral/posts?min_score=80`);
    assert.strictEqual(postsRes.status, 200);
    const posts = await postsRes.json();
    assert(posts.length > 0);

    // 4. Geração de Post via API
    const genRes = await fetch(`${localBaseUrl}/api/viral/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        viralPostId: testCapturedPost.id,
        targetPlatform: 'instagram',
        tone: 'Educativo & Autoridade',
        objective: 'Geração de Leads'
      })
    });
    assert.strictEqual(genRes.status, 200);
    const genData = await genRes.json();
    assert(genData.post.full_content.includes('bio') || genData.post.full_content.includes('👉'));

    // 5. Exclusão de perfil temporário
    const delRes = await fetch(`${localBaseUrl}/api/viral/profiles/${newProf.id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
  });

  await runAsyncTest('Comandos no WhatsApp (!viral, !radar, !viraladd, !gerarpost)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');

    // 1. Comando !viral / !radar
    let radarReply = null;
    const mockSock = {
      sendMessage: async (jid, payload) => {
        radarReply = payload;
        return true;
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true },
      message: { conversation: '!viral' }
    }, mockSock);

    assert(radarReply !== null);
    assert(radarReply.text.includes('RADAR DE CONTEÚDO VIRAL'));
    assert(radarReply.text.includes('Perfis Rastreados'));

    // 2. Comando !gerarpost
    let genReply = null;
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true },
      message: { conversation: `!gerarpost ${testCapturedPost.id}` }
    }, {
      sendMessage: async (jid, payload) => {
        genReply = payload;
        return true;
      }
    });

    assert(genReply !== null);
    assert(genReply.text.includes('NOSSO POST GERADO'));
  });

  // ----------------------------------------------------------------
  // 17. TESTES DE GESTÃO DE GRUPOS WHATSAPP, EXTRAÇÃO DE LEADS CSV & SIMULADOR
  // ----------------------------------------------------------------
  console.log('\n📱 17. Testes de Gestão de Grupos WhatsApp, Extração de Leads CSV & Simulador:');
  const localBaseUrl = `http://localhost:${testPort}`;

  await runAsyncTest('Grupos WhatsApp: Listagem & Alternância de Modo (/api/whatsapp/groups)', async () => {
    // 1. GET /api/whatsapp/groups
    const groupsRes = await fetch(`${localBaseUrl}/api/whatsapp/groups`);
    assert.strictEqual(groupsRes.status, 200);
    const groups = await groupsRes.json();
    assert(Array.isArray(groups));
    assert(groups.length > 0);
    assert(groups[0].id);

    // 2. POST /api/whatsapp/groups/:id/mode
    const testGid = groups[0].id;
    const modeRes = await fetch(`${localBaseUrl}/api/whatsapp/groups/${encodeURIComponent(testGid)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'closed' })
    });
    assert.strictEqual(modeRes.status, 200);
    const modeData = await modeRes.json();
    assert.strictEqual(modeData.mode, 'announcement');
  });

  await runAsyncTest('Leads CSV: Exportação de Grupo WhatsApp, Grupo Meteórico e Consolidado Geral', async () => {
    const meteoricService = require('./src/services/meteoricService');
    const mGroups = models.getMeteoricGroups();
    assert(mGroups.length > 0);
    const testMGroup = mGroups[0];

    // 1. GET /api/whatsapp/groups/:id/export-leads.csv
    const wppCsvRes = await fetch(`${localBaseUrl}/api/whatsapp/groups/${encodeURIComponent(testMGroup.group_jid)}/export-leads.csv`);
    assert.strictEqual(wppCsvRes.status, 200);
    assert(wppCsvRes.headers.get('content-type').includes('text/csv'));
    const wppCsvText = await wppCsvRes.text();
    assert(wppCsvText.includes('Telefone') || wppCsvText.includes('WhatsApp_JID'));

    // 2. GET /api/meteoric/groups/:id/export-leads.csv
    const mGroupCsvRes = await fetch(`${localBaseUrl}/api/meteoric/groups/${testMGroup.id}/export-leads.csv`);
    assert.strictEqual(mGroupCsvRes.status, 200);
    const mGroupCsvText = await mGroupCsvRes.text();
    assert(mGroupCsvText.includes('Telefone'));
    assert(mGroupCsvText.includes('Grupo_Nome'));

    // 3. GET /api/meteoric/export-all-leads.csv
    const allCsvRes = await fetch(`${localBaseUrl}/api/meteoric/export-all-leads.csv`);
    assert.strictEqual(allCsvRes.status, 200);
    const allCsvText = await allCsvRes.text();
    assert(allCsvText.includes('Grupo_Origem'));
    assert(allCsvText.includes('Campanha'));
  });

  await runAsyncTest('Meteórico: Simulador Interativo & Injetor de Conversas (/api/meteoric/simulate-dialogue)', async () => {
    // 1. Simulação Preview (dryRun: true)
    const previewRes = await fetch(`${localBaseUrl}/api/meteoric/simulate-dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'social_proof',
        delaySeconds: 3,
        dryRun: true
      })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.dryRun, true);
    assert(Array.isArray(previewData.timeline));
    assert(previewData.timeline.length >= 3);
    assert(previewData.timeline[0].text);

    // 2. Execução Live (dryRun: false) com roteiro customizado
    const liveRes = await fetch(`${localBaseUrl}/api/meteoric/simulate-dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetGroupJid: 'all',
        theme: 'custom',
        customScripts: [
          { speaker: 'SubBot Alpha', delay: 1, text: 'Garantido meu acesso com sucesso!' },
          { speaker: 'SubBot Beta', delay: 2, text: 'Show! Também peguei aqui!' }
        ],
        dryRun: false
      })
    });
    assert.strictEqual(liveRes.status, 200);
    const liveData = await liveRes.json();
    assert.strictEqual(liveData.dryRun, false);
    assert.strictEqual(liveData.dialogueCount, 2);
  });

  // ----------------------------------------------------------------
  // 18. TESTES DAS FUNCIONALIDADES PORTADAS DO SPYBOT (ALEATORY-MD)
  // ----------------------------------------------------------------
  console.log('\n🕵️ 18. Testes das Funcionalidades Portadas do SpyBot (Aleatory-MD):');

  const spyFeatures = require('./src/services/spyFeaturesService');
  const whatsappBot = require('./src/bots/whatsappBot');

  await runAsyncTest('SpyBot: Fusão de Emojis (!emojimix) & Stickers Animados (!attp / !attp2)', async () => {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'EMOJI_MSG_1' } };
      }
    };

    // 1. Emojimix sem parâmetros: instruções
    await spyFeatures.handleEmojiMix(mockSock, '1203630123@g.us', '!emojimix');
    assert(sentMessages.length >= 1);
    assert(sentMessages[0].payload.text.includes('FUSÃO DE EMOJIS'));

    // 2. Emojimix válido: gera figurinha
    sentMessages.length = 0;
    await spyFeatures.handleEmojiMix(mockSock, '1203630123@g.us', '!emojimix 😎+😭');
    assert(sentMessages.some(m => m.payload.sticker));

    // 3. Attp sem texto: instruções
    sentMessages.length = 0;
    await spyFeatures.handleAttp(mockSock, '1203630123@g.us', '!attp');
    assert(sentMessages[0].payload.text.includes('FIGURINHA ANIMADA DE TEXTO'));

    // 4. Attp válido: gera figurinha animada
    sentMessages.length = 0;
    await spyFeatures.handleAttp(mockSock, '1203630123@g.us', '!attp PayBot Vendas', false);
    assert(sentMessages.some(m => m.payload.sticker));

    // 5. Attp2 válido: gera figurinha animada estilo 2
    sentMessages.length = 0;
    await spyFeatures.handleAttp(mockSock, '1203630123@g.us', '!attp2 Spy', true);
    assert(sentMessages.some(m => m.payload.sticker));
  });

  await runAsyncTest('SpyBot: Conversor para MP3 (!tomp3) & Cotação de Moedas (!moedas)', async () => {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'MEDIA_MSG_1' } };
      }
    };

    // 1. !tomp3 sem mídia: instruções
    await spyFeatures.handleToMp3(mockSock, '5511999998888@s.whatsapp.net', { message: { conversation: '!tomp3' } });
    assert(sentMessages[0].payload.text.includes('CONVERSOR PARA ÁUDIO MP3'));

    // 2. !tomp3 com áudio citado: converte e envia
    sentMessages.length = 0;
    const mockQuotedMsg = {
      message: {
        extendedTextMessage: {
          contextInfo: {
            quotedMessage: {
              audioMessage: { mimetype: 'audio/ogg; codecs=opus' }
            }
          }
        }
      }
    };
    await spyFeatures.handleToMp3(mockSock, '5511999998888@s.whatsapp.net', mockQuotedMsg);
    assert(sentMessages.some(m => m.payload.audio && m.payload.mimetype === 'audio/mp4'));

    // 3. !moedas: cotações em tempo real de USD, EUR, BTC
    sentMessages.length = 0;
    await spyFeatures.handleMoedas(mockSock, '5511999998888@s.whatsapp.net');
    assert(sentMessages.length === 1);
    const moedasText = sentMessages[0].payload.text;
    assert(moedasText.includes('COTAÇÃO DE MOEDAS EM TEMPO REAL'));
    assert(moedasText.includes('Dólar Comercial'));
    assert(moedasText.includes('Euro Oficial'));
    assert(moedasText.includes('Bitcoin'));
  });

  await runAsyncTest('SpyBot: Gerador de Nicks & Fontes Estilosas (!fazernick / !tabela)', async () => {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'NICK_MSG_1' } };
      }
    };

    // 1. !fazernick sem texto: instruções
    await spyFeatures.handleFazerNick(mockSock, '5511999998888@s.whatsapp.net', '!fazernick');
    assert(sentMessages[0].payload.text.includes('GERADOR DE NICKS'));

    // 2. !fazernick PayBot: gera lista completa com 20 estilos
    sentMessages.length = 0;
    await spyFeatures.handleFazerNick(mockSock, '5511999998888@s.whatsapp.net', '!fazernick PayBot');
    assert(sentMessages.length === 1);
    const nickText = sentMessages[0].payload.text;
    assert(nickText.includes('FONTES ESTILOSAS PARA: "PayBot"'));
    assert(nickText.includes('Gótico Fraktur'));
    assert(nickText.includes('Circundado'));
    assert(nickText.includes('Asas'));
  });

  await runAsyncTest('SpyBot: Conselhos Bíblicos (!conselhobiblico) & Motivacionais (!conselho)', async () => {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'CONSELHO_MSG_1' } };
      }
    };

    // 1. Conselho Bíblico
    await spyFeatures.handleConselhoBiblico(mockSock, '5511999998888@s.whatsapp.net');
    assert(sentMessages[0].payload.text.includes('CONSELHO & SABEDORIA BÍBLICA'));

    // 2. Conselho Motivacional
    sentMessages.length = 0;
    await spyFeatures.handleConselho(mockSock, '5511999998888@s.whatsapp.net');
    assert(sentMessages[0].payload.text.includes('CONSELHO DO DIA & MOTIVAÇÃO'));
  });

  await runAsyncTest('SpyBot: Gestão de Grupos (!totag, !marcar2, !limpar)', async () => {
    const sentMessages = [];
    const mockSock = {
      groupMetadata: async () => ({
        subject: 'Grupo VIP de Testes',
        participants: [
          { id: '5511999990001@s.whatsapp.net', admin: 'admin' },
          { id: '5511999990002@s.whatsapp.net', admin: null },
          { id: '5511999990003@s.whatsapp.net', admin: null }
        ]
      }),
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'GP_MSG_1' } };
      }
    };

    // 1. !totag com texto customizado
    await spyFeatures.handleTotag(mockSock, '1203630999@g.us', null, '!totag Atenção a todos!', mockSock, true);
    assert(sentMessages.length === 1);
    assert(sentMessages[0].payload.text.includes('Atenção a todos!'));
    assert.strictEqual(sentMessages[0].payload.mentions.length, 3);

    // 2. !marcar2 gera links wa.me para todos
    sentMessages.length = 0;
    await spyFeatures.handleMarcar2(mockSock, '1203630999@g.us', mockSock);
    assert(sentMessages.length === 1);
    assert(sentMessages[0].payload.text.includes('https://wa.me/5511999990001'));
    assert(sentMessages[0].payload.text.includes('https://wa.me/5511999990002'));

    // 3. !limpar gera buffer invisível
    sentMessages.length = 0;
    await spyFeatures.handleLimpar(mockSock, '1203630999@g.us');
    assert(sentMessages.length === 1);
    assert(sentMessages[0].payload.text.includes('CHAT LIMPO PELA ADMINISTRAÇÃO'));
  });

  await runAsyncTest('SpyBot: Moderação Anti-Palavrão (!antipalavra) & Auto-Delete de Ofensas', async () => {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'AP_MSG_1' } };
      }
    };

    const gpId = '1203630888777@g.us';

    // 1. Ativar Anti-Palavrão
    await spyFeatures.handleAntiPalavra(mockSock, gpId, '!antipalavra on', true, true);
    assert(sentMessages.some(m => m.payload.text.includes('FILTRO ANTI-PALAVRÃO ATIVADO')));

    // 2. Adicionar palavra proibida
    sentMessages.length = 0;
    await spyFeatures.handleAntiPalavra(mockSock, gpId, '!antipalavra add proibido123', true, true);
    assert(sentMessages.some(m => m.payload.text.includes('adicionada')));

    // 3. Verificar mensagem com palavra proibida de não-admin: deve apagar
    sentMessages.length = 0;
    const testBadMsg = {
      key: { remoteJid: gpId, id: 'BAD_MSG_1', participant: '5511988887777@s.whatsapp.net' }
    };
    const wasDeleted = await spyFeatures.checkAntiPalavra(mockSock, gpId, testBadMsg, 'Isso é proibido123 cara', true, false);
    assert.strictEqual(wasDeleted, true);
    assert(sentMessages.some(m => m.payload.delete));
    assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('apagada por conter vocabulário não permitido')));

    // 4. Mensagem limpa: não deve apagar
    sentMessages.length = 0;
    const wasCleanDeleted = await spyFeatures.checkAntiPalavra(mockSock, gpId, testBadMsg, 'Bom dia pessoal tudo bem?', true, false);
    assert.strictEqual(wasCleanDeleted, false);

    // 5. Desativar Anti-Palavrão
    sentMessages.length = 0;
    await spyFeatures.handleAntiPalavra(mockSock, gpId, '!antipalavra off', true, true);
    assert(sentMessages.some(m => m.payload.text.includes('DESATIVADO')));
  });

  await runAsyncTest('SpyBot: Mini-games & Interações (!cassino, !casal, !metadinha, !clima, !ddd)', async () => {
    const sentMessages = [];
    const mockSock = {
      groupMetadata: async () => ({
        subject: 'Grupo do Amor',
        participants: [
          { id: '5511911111111@s.whatsapp.net' },
          { id: '5511922222222@s.whatsapp.net' }
        ]
      }),
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'FUN_MSG_1' } };
      }
    };

    // 1. !cassino caça-níquel
    await spyFeatures.handleCassino(mockSock, '5511999998888@s.whatsapp.net', '5511999998888', 'Tester');
    assert(sentMessages[0].payload.text.includes('CASSINO PAYBOT'));

    // 2. !casal combinação de casal
    sentMessages.length = 0;
    await spyFeatures.handleBrincadeiras(mockSock, '1203630123@g.us', null, 'casal', '!casal', '5511999998888', mockSock);
    assert(sentMessages[0].payload.text.includes('COMBINAÇÃO PERFEITA DE CASAL'));

    // 3. !metadinha fotos de perfil combinando
    sentMessages.length = 0;
    await spyFeatures.handleMetadinha(mockSock, '5511999998888@s.whatsapp.net');
    assert.strictEqual(sentMessages.length, 2);
    assert(sentMessages[0].payload.caption.includes('Metadinha - ELE'));
    assert(sentMessages[1].payload.caption.includes('Metadinha - ELA'));

    // 4. !clima previsão do tempo
    sentMessages.length = 0;
    await spyFeatures.handleClima(mockSock, '5511999998888@s.whatsapp.net', '!clima São Paulo');
    assert(sentMessages[0].payload.text.includes('São Paulo'));

    // 5. !ddd consulta de código telefônico
    sentMessages.length = 0;
    await spyFeatures.handleDDD(mockSock, '5511999998888@s.whatsapp.net', '!ddd 48');
    assert(sentMessages[0].payload.text.includes('DDD 48'));
    assert(sentMessages[0].payload.text.includes('Florianópolis'));
  });

  await runAsyncTest('SpyBot: Integração de Roteamento de Comandos no whatsappBot.handleMessage', async () => {
    const originalSock = whatsappBot.sock;
    const originalSend = whatsappBot.sendMessage;
    const sent = [];

    try {
      whatsappBot.sock = {
        user: { id: '5511999990000:1@s.whatsapp.net' },
        sendMessage: async (jid, payload) => {
          sent.push({ jid, payload });
          return { key: { id: 'ROUTED_1' } };
        }
      };
      whatsappBot.sendMessage = async (jid, textOrObj) => {
        sent.push({ jid, payload: typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj });
        return { key: { id: 'ROUTED_2' } };
      };

      // 1. Testa !moedas
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!moedas' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('COTAÇÃO DE MOEDAS')));

      // 2. Testa !fazernick
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!fazernick Gata' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('FONTES ESTILOSAS')));

      // 3. Testa !conselhobiblico
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!conselhobiblico' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('CONSELHO & SABEDORIA BÍBLICA')));

      // 4. Testa !ddd
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!ddd 11' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('São Paulo')));
    } finally {
      whatsappBot.sock = originalSock;
      whatsappBot.sendMessage = originalSend;
    }
  });

  // ----------------------------------------------------------------
  // 19. TESTES DAS FUNCIONALIDADES PORTADAS DO HATSUNE MIKU BOT
  // ----------------------------------------------------------------
  console.log('\n🎤 19. Testes das Funcionalidades Portadas do Hatsune Miku Bot:');
  const spyFeaturesService = require('./src/services/spyFeaturesService');
  const stickerConverter = require('./src/utils/stickerConverter');

  await runAsyncTest('Hatsune Miku: Geração de Figurinha Quote Chat (!qc)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'QC_1' } };
      }
    };
    await spyFeaturesService.handleQC(mockSock, '5511977776666@s.whatsapp.net', null, '!qc Teste de mensagem dark mode', 'Miku Tester');
    assert(sent.length > 0, 'Deveria ter enviado a figurinha QC');
    assert(sent[0].payload.sticker, 'Payload deve conter buffer de figurinha');
  });

  await runAsyncTest('Hatsune Miku: Geração de Figurinha Brat (!brat)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'BRAT_1' } };
      }
    };
    await spyFeaturesService.handleBrat(mockSock, '5511977776666@s.whatsapp.net', '!brat paybot vendas');
    assert(sent.length > 0, 'Deveria ter enviado figurinha brat');
    assert(sent[0].payload.sticker, 'Payload deve conter buffer de figurinha');
  });

  await runAsyncTest('Hatsune Miku: Screenshot de Página Web (!ssweb)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'SS_1' } };
      }
    };
    await spyFeaturesService.handleSSWeb(mockSock, '5511977776666@s.whatsapp.net', '!ssweb google.com');
    assert(sent.some(s => s.payload.image || (s.payload.text && s.payload.text.includes('Capturando tela'))));
  });

  await runAsyncTest('Hatsune Miku: Upload de Mídia para Link Direto (!tourl)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'TOURL_1' } };
      }
    };
    const mockMsg = {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg'
        }
      }
    };
    const origExtract = spyFeaturesService.extractMediaBuffer;
    try {
      spyFeaturesService.extractMediaBuffer = async () => ({ buffer: Buffer.from('mock_img_bytes'), type: 'image' });
      await spyFeaturesService.handleToUrl(mockSock, '5511977776666@s.whatsapp.net', mockMsg, 'Tester');
      assert(sent.some(s => s.payload.text && (s.payload.text.includes('Link') || s.payload.text.includes('Enviando arquivo'))));
    } finally {
      spyFeaturesService.extractMediaBuffer = origExtract;
    }
  });

  await runAsyncTest('Hatsune Miku: Downloader de Repositório GitHub (!gitclone)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'GIT_1' } };
      }
    };
    await spyFeaturesService.handleGitClone(mockSock, '5511977776666@s.whatsapp.net', '!gitclone Brauliovh3/HATSUNE-MIKU');
    assert(sent.some(s => s.payload.text && (s.payload.text.includes('Repositório') || s.payload.text.includes('Consultando'))));
  });

  await runAsyncTest('Hatsune Miku: Sistema AFK (Ativação, Detecção e Retorno)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'AFK_1' } };
      }
    };

    const afkUser = '5511988889999';
    const groupJid = '120363000000000000@g.us';

    // 1. Ativa AFK
    await spyFeaturesService.handleAFK(mockSock, groupJid, '!afk Fui almoçar volto logo', afkUser, 'UserAFK');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('MODO AFK ATIVADO')));

    // 2. Outro usuário menciona o usuário AFK
    sent.length = 0;
    const mentionMsg = {
      message: {
        extendedTextMessage: {
          text: 'Ei @5511988889999 veja isso',
          contextInfo: {
            mentionedJid: [`${afkUser}@s.whatsapp.net`]
          }
        }
      }
    };
    const handledAlert = await spyFeaturesService.checkAFK(mockSock, groupJid, mentionMsg, 'Ei @5511988889999 veja isso', '5511977776666', 'Friend');
    assert(handledAlert === true, 'Deveria ter detectado usuário AFK');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('USUÁRIO EM MODO AUSENTE')));

    // 3. Usuário AFK envia mensagem e sai do AFK
    sent.length = 0;
    const returnMsg = { message: { conversation: 'Voltei galera' } };
    await spyFeaturesService.checkAFK(mockSock, groupJid, returnMsg, 'Voltei galera', afkUser, 'UserAFK');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('BEM-VINDO DE VOLTA')));
    assert(!spyFeaturesService.afkMap.has(afkUser), 'Estado AFK deve ter sido removido');
  });

  await runAsyncTest('Hatsune Miku: Sistema de Casamento e Divórcio (!casar / !divorciar)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'WED_1' } };
      }
    };

    const userA = '5511911112222';
    const userB = '5511933334444';
    const groupJid = '120363000000000000@g.us';

    models.setSetting(`MARRIAGE_${userA}`, '');
    models.setSetting(`MARRIAGE_${userB}`, '');

    // 1. User A propõe casamento a User B
    const proposalMsg = {
      message: {
        extendedTextMessage: {
          text: `!casar @${userB}`,
          contextInfo: { mentionedJid: [`${userB}@s.whatsapp.net`] }
        }
      }
    };
    await spyFeaturesService.handleCasar(mockSock, groupJid, proposalMsg, userA, 'Romeo');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('PEDIDO DE CASAMENTO')));

    // 2. User B aceita propondo de volta
    sent.length = 0;
    const acceptMsg = {
      message: {
        extendedTextMessage: {
          text: `!casar @${userA}`,
          contextInfo: { mentionedJid: [`${userA}@s.whatsapp.net`] }
        }
      }
    };
    await spyFeaturesService.handleCasar(mockSock, groupJid, acceptMsg, userB, 'Juliet');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('FELIZ CASAMENTO NO GRUPO')));
    assert.strictEqual(models.getSetting(`MARRIAGE_${userA}`, ''), userB);
    assert.strictEqual(models.getSetting(`MARRIAGE_${userB}`, ''), userA);

    // 3. Verifica se perfil exibe casamento
    sent.length = 0;
    await spyFeaturesService.handlePerfil(mockSock, groupJid, userA, 'Romeo');
    assert(sent.some(s => s.payload.text && s.payload.text.includes(`Casado(a) com @${userB}`)));

    // 4. Divórcio
    sent.length = 0;
    await spyFeaturesService.handleDivorciar(mockSock, groupJid, userA);
    assert(sent.some(s => s.payload.text && s.payload.text.includes('CERTIDÃO DE DIVÓRCIO')));
    assert.strictEqual(models.getSetting(`MARRIAGE_${userA}`, ''), '');
    assert.strictEqual(models.getSetting(`MARRIAGE_${userB}`, ''), '');
  });

  await runAsyncTest('Hatsune Miku: Jogo Coinflip / Cara ou Coroa (!coinflip)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'CF_1' } };
      }
    };
    const userPhone = '5511955556666';
    models.addLoyaltyPoints('whatsapp', userPhone, 100, 100);

    await spyFeaturesService.handleCoinflip(mockSock, '5511955556666@s.whatsapp.net', '!coinflip 20 cara', userPhone, 'Gambler');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('A MOEDA GIROU NO AR')));
  });

  await runAsyncTest('Hatsune Miku: Trabalho RPG (!trabalhar)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'WORK_1' } };
      }
    };
    const userPhone = '5511966667777';
    await spyFeaturesService.handleWork(mockSock, '5511966667777@s.whatsapp.net', userPhone, 'Worker');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('EXPEDIENTE DE TRABALHO CONCLUÍDO')));
  });

  await runAsyncTest('Hatsune Miku: Crime RPG (!crime)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'CRIME_1' } };
      }
    };
    const userPhone = '5511988881111';
    models.addLoyaltyPoints('whatsapp', userPhone, 300, 300);
    await spyFeaturesService.handleCrime(mockSock, '5511988881111@s.whatsapp.net', userPhone, 'Outlaw');
    assert(sent.some(s => s.payload.text && (s.payload.text.includes('GOLPE PERFEITO') || s.payload.text.includes('EM CANA'))));
  });

  await runAsyncTest('Hatsune Miku: Metadinhas de Casal Anime (!ppcouple)', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'PPCP_1' } };
      }
    };
    await spyFeaturesService.handlePPCouple(mockSock, '5511977776666@s.whatsapp.net');
    assert(sent.some(s => s.payload.text && s.payload.text.includes('Metadinhas Anime')));
  });

  await runAsyncTest('Hatsune Miku: Roteamento de Comandos Integrados via whatsappBot', async () => {
    const originalSock = whatsappBot.sock;
    const originalSend = whatsappBot.sendMessage;
    const sent = [];

    try {
      whatsappBot.sock = {
        user: { id: '5511999990000:1@s.whatsapp.net' },
        sendMessage: async (jid, payload) => {
          sent.push({ jid, payload });
          return { key: { id: 'ROUTED_MIKU' } };
        }
      };
      whatsappBot.sendMessage = async (jid, textOrObj) => {
        sent.push({ jid, payload: typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj });
        return { key: { id: 'ROUTED_MIKU2' } };
      };

      // 1. Testa !qc
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!qc Boa noite a todos!' }
      });
      assert(sent.some(s => s.payload.sticker));

      // 2. Testa !brat
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!brat charli' }
      });
      assert(sent.some(s => s.payload.sticker));

      // 3. Testa !coinflip
      sent.length = 0;
      models.addLoyaltyPoints('whatsapp', '5511988887777', 100, 100);
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!coinflip 25 cara' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('A MOEDA GIROU NO AR')));

      // 4. Testa !trabalhar
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!trabalhar' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('EXPEDIENTE DE TRABALHO CONCLUÍDO')));
    } finally {
      whatsappBot.sock = originalSock;
      whatsappBot.sendMessage = originalSend;
    }
  });

  // ----------------------------------------------------------------
  // 20. TESTES DE VITRINE AUTOREPUESTOS-PRO & CENTRAL DE AVISOS-PC
  // ----------------------------------------------------------------
  console.log('\n🏪 20. Testes de Vitrine AutoRepuestos-Pro & Central de Avisos-PC:');

  await runAsyncTest('AutoRepuestos: Consulta de Produtos na Loja (GET /api/store/products)', async () => {
    const { status, data } = await fetchApi('/api/store/products');
    assert.strictEqual(status, 200);
    assert(data.success === true);
    assert(Array.isArray(data.products), 'Deve retornar array de produtos');
    assert(Array.isArray(data.categories), 'Deve retornar array de categorias');
  });

  await runAsyncTest('AutoRepuestos: Validação de Cupom na Vitrine (POST /api/store/coupon)', async () => {
    if (!models.getCouponByCode('AUTO10PRO')) {
      models.createCoupon({
        code: 'AUTO10PRO',
        discount_type: 'percent',
        discount_value: 10,
        max_uses: 50
      });
    }

    const { status, data } = await fetchApi('/api/store/coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'AUTO10PRO', amount: 150 })
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.discountAmount, 15);
    assert.strictEqual(data.finalAmount, 135);
  });

  await runAsyncTest('AutoRepuestos: Checkout Omnichannel com Carrinho Multi-Itens (POST /api/store/checkout)', async () => {
    const p1 = models.createProduct({
      name: 'Pastilha de Freio Cerâmica Pro',
      price: 120.00,
      price_brl: 120.00,
      price_usdt: 24.00,
      category: 'Auto Peças',
      type: 'digital'
    });

    const checkoutPayload = {
      items: [
        { id: p1.id, quantity: 2 }
      ],
      customer: {
        name: 'Carlos Mecânico',
        phone: '5511999993333',
        address: 'Av. Paulista 1000, SP',
        notes: 'Entregar na oficina'
      },
      gateway: 'pix',
      couponCode: 'AUTO10PRO'
    };

    const { status, data } = await fetchApi('/api/store/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload)
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert(data.tradeNo.startsWith('ORD_WEB_'));
    assert.strictEqual(data.subtotalBRL, 240);
    assert.strictEqual(data.discountBRL, 24);
    assert.strictEqual(data.finalBRL, 216);
    assert(data.whatsappMessage.includes('Carlos Mecânico'));
    assert(data.whatsappUrl.includes('https://wa.me/'));
  });

  await runAsyncTest('Avisos PC: Emissão e Listagem de Avisos (POST & GET /api/notices)', async () => {
    const { status: postStatus, data: postData } = await fetchApi('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '🚨 URGENTE: Servidor em Manutenção',
        message: 'Reinicialização programada dos nós em 5 minutos.',
        category: 'urgente',
        color: '#f44336',
        sender: 'DevOps Central',
        target: 'all',
        sound_alert: 1
      })
    });

    assert.strictEqual(postStatus, 200);
    assert(postData.success === true);
    assert(postData.notice.id > 0);

    const { status: getStatus, data: getData } = await fetchApi('/api/notices');
    assert.strictEqual(getStatus, 200);
    assert(Array.isArray(getData.notices));
    assert(getData.notices.some(n => n.id === postData.notice.id));
  });

  await runAsyncTest('Avisos PC: Resposta a Aviso da Equipe (POST /api/notices/:id/respond)', async () => {
    const notice = models.createNotice({
      title: '⚠️ ALERTA: Fila de Leads Alta',
      message: 'Todos os vendedores focar no WhatsApp agora!',
      category: 'alerta',
      color: '#ff5722'
    });

    const { status, data } = await fetchApi(`/api/notices/${notice.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        respondent: 'Vendedor João',
        response_text: 'Ciente! Assumindo os 5 primeiros da fila.'
      })
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.response.respondent, 'Vendedor João');

    const updated = models.getNoticeById(notice.id);
    assert(updated.responses.some(r => r.response_text.includes('Assumindo')));
  });

  await runAsyncTest('AutoRepuestos & Avisos PC: Comandos WhatsApp (!loja, !aviso, !avisos, !confirmaraviso)', async () => {
    const originalSock = whatsappBot.sock;
    const originalSend = whatsappBot.sendMessage;
    const sent = [];

    try {
      whatsappBot.sock = {
        user: { id: '5511999990000:1@s.whatsapp.net' },
        sendMessage: async (jid, payload) => {
          sent.push({ jid, payload });
          return { key: { id: 'ROUTED_STORE' } };
        }
      };
      whatsappBot.sendMessage = async (jid, textOrObj) => {
        sent.push({ jid, payload: typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj });
        return { key: { id: 'ROUTED_STORE2' } };
      };

      // 1. Testa !loja
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!loja' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('VITRINE DIGITAL & CATÁLOGO')));

      // 2. Testa !urgente
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!urgente Atenção equipe reunião no Discord' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('AVISO REGISTRADO NA CENTRAL')));

      // 3. Testa !avisos
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: '!avisos' }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('CENTRAL DE AVISOS')));

      // 4. Testa !confirmaraviso
      sent.length = 0;
      const latestNotice = models.getNotices(1)[0];
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Tester',
        message: { conversation: `!confirmaraviso ${latestNotice ? latestNotice.id : 1} Entendido perfeitamente` }
      });
      assert(sent.some(s => s.payload.text && s.payload.text.includes('RESPOSTA REGISTRADA NA CENTRAL')));
    } finally {
      whatsappBot.sock = originalSock;
      whatsappBot.sendMessage = originalSend;
    }
  });

  // ================================================================
  // 21. TESTES DE OPERAÇÃO EXCLUSIVA DE CATÁLOGO PRÓPRIO PARA SUB-BOT WHATSAPP BUSINESS
  // ================================================================
  await runAsyncTest('WhatsApp Business Sub-Bot: Sincronização de catálogo e identificação comercial', async () => {
    // 1. Cria instância de subbot
    const subChip = models.createArmyInstance({
      name: 'Sub-Bot Business Loja 1',
      phone: '5511999997701',
      role: 'subbot'
    });
    assert(subChip && subChip.id);

    // 2. Mock do socket Baileys com catálogo comercial do WhatsApp Business
    const mockBizSock = {
      user: { id: `${subChip.phone}:1@s.whatsapp.net` },
      instanceId: subChip.id,
      getBusinessProfile: async () => ({
        description: 'Loja Oficial WhatsApp Business',
        category: 'Automotive Store'
      }),
      getCatalog: async () => ({
        products: [
          {
            id: 'biz_item_001',
            name: 'Kit Embreagem Especial Business',
            description: 'Item exclusivo da loja filial',
            price: 150000,
            currency: 'BRL'
          },
          {
            id: 'biz_item_002',
            name: 'Óleo Sintético 5W30 Business',
            description: 'Óleo importado exclusivo',
            price: 60000,
            currency: 'BRL'
          }
        ]
      })
    };

    // 3. Executa sincronização do catálogo
    await whatsappArmyService.syncSubBotBusinessCatalog(subChip.id, mockBizSock);

    // 4. Valida se a instância foi marcada como Business
    assert.strictEqual(models.isSubBotBusiness(subChip.id), true);

    // 5. Valida se os produtos foram persistidos e filtrados para o sub-bot
    const subProds = models.getSubBotProducts(subChip.id);
    assert.strictEqual(subProds.length, 2);
    assert.strictEqual(subProds[0].name, 'Kit Embreagem Especial Business');
    assert.strictEqual(subProds[0].price_brl, 150.00);
    assert.strictEqual(subProds[1].name, 'Óleo Sintético 5W30 Business');
    assert.strictEqual(subProds[1].price_brl, 60.00);
    assert.strictEqual(subProds[0].army_instance_id, subChip.id);
  });

  await runAsyncTest('WhatsApp Business Sub-Bot: Isolamento estrito de catálogo e compras exclusivas', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const originalSock = whatsappBot.sock;
    const originalSend = whatsappBot.sendMessage;
    const sent = [];

    const subChip = models.createArmyInstance({
      name: 'Sub-Bot Business Isolado',
      phone: '5511999997702',
      role: 'subbot'
    });

    models.saveSubBotCatalogProducts(subChip.id, [
      {
        name: 'Produto Exclusivo Filial Business',
        description: 'Apenas nesta filial',
        price: 88.00,
        price_brl: 88.00
      }
    ]);

    const mockSubSock = {
      user: { id: `${subChip.phone}:1@s.whatsapp.net` },
      instanceId: subChip.id,
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'SUB_SENT_1' } };
      }
    };

    const mockMainSock = {
      user: { id: '5511988887777:1@s.whatsapp.net' },
      instanceId: 1,
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return { key: { id: 'MAIN_SENT_1' } };
      }
    };

    try {
      whatsappBot.sock = mockMainSock;
      whatsappBot.sendMessage = async (jid, textOrObj, opts, customSock) => {
        const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
        sent.push({ jid, payload, customSock });
        return { key: { id: 'BOT_SENT' } };
      };

      // 1. Contexto Matriz: deve retornar catálogo geral da loja
      const mainProds = whatsappBot.getProductsForContext(mockMainSock);
      assert(mainProds.length > 0);
      assert(!mainProds.some(p => p.name === 'Produto Exclusivo Filial Business'));

      // 2. Contexto Sub-Bot Business: deve retornar SOMENTE os produtos do sub-bot
      const subProds = whatsappBot.getProductsForContext(mockSubSock);
      assert.strictEqual(subProds.length, 1);
      assert.strictEqual(subProds[0].name, 'Produto Exclusivo Filial Business');

      // 3. Teste MENU no Sub-Bot Business
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511966665555@s.whatsapp.net', fromMe: false },
        pushName: 'Cliente SubBot',
        message: { conversation: 'menu' }
      }, mockSubSock);

      assert(sent.some(s => s.payload.text && s.payload.text.includes('WhatsApp Business')));
      assert(sent.some(s => s.payload.text && s.payload.text.includes('Produto Exclusivo Filial Business')));

      // 4. Teste Compra direta '1' ou 'P1' no Sub-Bot Business
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511966665555@s.whatsapp.net', fromMe: false },
        pushName: 'Cliente SubBot',
        message: { conversation: 'P1' }
      }, mockSubSock);

      assert(sent.some(s => s.payload.caption && s.payload.caption.includes('Produto Exclusivo Filial Business')));

      const lastOrder = models.getAllOrders(1)[0];
      assert.strictEqual(lastOrder.product_name, 'Produto Exclusivo Filial Business');
      assert.strictEqual(lastOrder.seller_id, subChip.id);

      // 5. Teste !loja no Sub-Bot Business
      sent.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511966665555@s.whatsapp.net', fromMe: false },
        pushName: 'Cliente SubBot',
        message: { conversation: '!loja' }
      }, mockSubSock);

      assert(sent.some(s => (s.payload.text || '').includes(`subbot=${subChip.id}`)));
      assert(sent.some(s => (s.payload.text || '').includes('CATÁLOGO WHATSAPP BUSINESS')));
    } finally {
      whatsappBot.sock = originalSock;
      whatsappBot.sendMessage = originalSend;
    }
  });

  await runAsyncTest('API Web Store: Filtro de vitrine e checkout atribuído por Sub-Bot (/api/store/products?subbot=X)', async () => {
    const subChip = models.createArmyInstance({
      name: 'Sub-Bot Vitrine Web Test',
      phone: '5511999997703',
      role: 'subbot'
    });

    models.saveSubBotCatalogProducts(subChip.id, [
      {
        name: 'Peça Turbina Business Web',
        description: 'Disponível online e WhatsApp',
        price: 320.00,
        price_brl: 320.00
      }
    ]);

    // 1. GET /api/store/products sem parâmetro: vitrine global
    const globalRes = await fetchApi('/api/store/products');
    assert.strictEqual(globalRes.status, 200);
    assert(globalRes.data.products.length > 0);
    assert(!globalRes.data.products.some(p => p.name === 'Peça Turbina Business Web'));

    // 2. GET /api/store/products?subbot=X: vitrine exclusiva do Sub-Bot
    const subRes = await fetchApi(`/api/store/products?subbot=${subChip.id}`);
    assert.strictEqual(subRes.status, 200);
    assert.strictEqual(subRes.data.products.length, 1);
    assert.strictEqual(subRes.data.products[0].name, 'Peça Turbina Business Web');

    // 3. POST /api/store/checkout atribuído ao subbot
    const checkoutRes = await fetchApi('/api/store/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: subRes.data.products[0].id, quantity: 1 }],
        customer: { name: 'Cliente Loja Web SubBot', phone: '5511977778888' },
        gateway: 'pix',
        subbot: subChip.id
      })
    });

    assert.strictEqual(checkoutRes.status, 200);
    assert.strictEqual(checkoutRes.data.success, true);
    assert(checkoutRes.data.whatsappUrl.includes(subChip.phone));

    const createdOrder = models.getOrderByTradeNo(checkoutRes.data.tradeNo);
    assert.strictEqual(createdOrder.seller_id, subChip.id);
  });

  // ----------------------------------------------------------------
  // 21. TESTES DE TUNNEL CLOUDFLARE, REPRODUÇÃO COM QUALIDADE H/S & SPY BOT
  // ----------------------------------------------------------------
  console.log('\n🌐 21. Testes de Tunnel Cloudflare, Qualidade de Áudio/Vídeo (H/S) & Spy Bot:');

  runTest('Parser de Qualidade de Download YouTube (H / S)', () => {
    const spyFeatures = require('./src/services/spyFeaturesService');

    // 1. Áudio High e Standard
    const q1 = spyFeatures.parseDownloadQuery('!play Imagine Dragons Believer H', 'high');
    assert.strictEqual(q1.cleanQuery, 'Imagine Dragons Believer');
    assert.strictEqual(q1.quality, 'high');

    const q2 = spyFeatures.parseDownloadQuery('!play Imagine Dragons Believer S', 'high');
    assert.strictEqual(q2.cleanQuery, 'Imagine Dragons Believer');
    assert.strictEqual(q2.quality, 'standard');

    // 2. Comandos sufixados com H e S
    const q3 = spyFeatures.parseDownloadQuery('!playh Vintage Culture', 'high');
    assert.strictEqual(q3.cleanQuery, 'Vintage Culture');
    assert.strictEqual(q3.quality, 'high');

    const q4 = spyFeatures.parseDownloadQuery('!plays Vintage Culture', 'high');
    assert.strictEqual(q4.cleanQuery, 'Vintage Culture');
    assert.strictEqual(q4.quality, 'standard');

    const q5 = spyFeatures.parseDownloadQuery('!videoh Podcast 100', 'high');
    assert.strictEqual(q5.cleanQuery, 'Podcast 100');
    assert.strictEqual(q5.quality, 'high');

    const q6 = spyFeatures.parseDownloadQuery('!videos Podcast 100', 'high');
    assert.strictEqual(q6.cleanQuery, 'Podcast 100');
    assert.strictEqual(q6.quality, 'standard');

    // 3. Atalhos de seleção da lista A1H e V1S
    const q7 = spyFeatures.parseDownloadQuery('A1H', 'high');
    assert.strictEqual(q7.cleanQuery, '1');
    assert.strictEqual(q7.quality, 'high');

    const q8 = spyFeatures.parseDownloadQuery('V1S', 'standard');
    assert.strictEqual(q8.cleanQuery, '1');
    assert.strictEqual(q8.quality, 'standard');
  });

  await runTest('Download de Áudio com Qualidade S e Nome de Arquivo no Título', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await spyFeatures.handlePlayMusic(mockSock, '5511999998888@s.whatsapp.net', '!plays Imagine Dragons Believer');
    assert(sent.length >= 2, 'Deve enviar aviso/cartão e o áudio');
    const audioMsg = sent.find(m => m.audio);
    assert(audioMsg, 'Mensagem com áudio deve existir');
    assert(audioMsg.fileName && audioMsg.fileName.endsWith('.mp3'), 'Nome do arquivo deve terminar em .mp3');
    assert(audioMsg.fileName.toLowerCase().includes('believer'), 'Nome do arquivo deve conter o título da música');
    assert(audioMsg.contextInfo?.externalAdReply, 'Deve conter externalAdReply para card de mídia no WhatsApp');
  });

  await runTest('Download de Vídeo com Seleção de Qualidade (H e S)', async () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await spyFeatures.handlePlayVideo(mockSock, '5511999998888@s.whatsapp.net', '!videos Imagine Dragons Believer');
    assert(sent.length >= 2, 'Deve enviar status e vídeo');
    const vidMsg = sent.find(m => m.video || m.document);
    assert(vidMsg, 'Mensagem com vídeo deve ser entregue');
    assert(vidMsg.fileName && vidMsg.fileName.endsWith('.mp4'), 'Nome do vídeo deve terminar em .mp4');
    assert(vidMsg.fileName.toLowerCase().includes('believer'), 'Nome do arquivo deve conter o título');
  });

  await runTest('Túnel Remoto Cloudflare (Endpoints e WhatsApp !tunnel)', async () => {
    const tunnelService = require('./src/services/tunnelService');
    models.setSetting('TUNNEL_URL', 'https://spybot-secure-test.trycloudflare.com');

    // 1. GET /api/tunnel
    const res = await fetchApi('/api/tunnel');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.url, 'https://spybot-secure-test.trycloudflare.com');
    assert.strictEqual(res.data.active, true);

    // 2. Comando !tunnel via whatsappBot
    const whatsappBot = require('./src/bots/whatsappBot');
    const replies = [];
    const origSend = whatsappBot.sendMessage;
    whatsappBot.sendMessage = async (jid, textOrObj, opts, customSock) => {
      const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
      replies.push(payload);
      return { key: { id: 'TEST_TUNNEL_REPLY' } };
    };

    const mockMsg = {
      key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false },
      message: { conversation: '!tunnel' }
    };

    try {
      await whatsappBot.handleIncomingMessage(mockMsg);
      assert(replies.length > 0, 'Deve responder ao comando !tunnel');
      const tunnelText = replies[0].text || replies[0].caption || '';
      assert(tunnelText.includes('PAINEL WEB & ACESSO REMOTO'), 'Deve identificar painel web');
      assert(tunnelText.includes('spybot-secure-test.trycloudflare.com'), 'Deve incluir a URL do túnel');
      assert(tunnelText.includes('Cloudflare Tunnel'), 'Deve citar Cloudflare Tunnel');

      // Teste de segurança: terceiro comum tentando !tunnel é bloqueado
      replies.length = 0;
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
        message: { conversation: '!tunnel' }
      });
      assert(replies.length > 0 && replies[0].text.includes('ACESSO NEGADO'), 'Terceiro deve ser bloqueado com ACESSO NEGADO');
    } finally {
      whatsappBot.sendMessage = origSend;
    }
  });

  runTest('Erradicação Completa de Referências "Gata Nina" no Sistema', () => {
    const spyFeatures = require('./src/services/spyFeaturesService');
    assert(spyFeatures, 'SpyFeaturesService deve estar ativo');
    assert(typeof spyFeatures.handlePlayMusic === 'function');
    assert(typeof spyFeatures.handlePlayVideo === 'function');

    // O arquivo legado gataFeaturesService.js deve apenas redirecionar
    const legacyGata = require('./src/services/gataFeaturesService');
    assert.strictEqual(legacyGata, spyFeatures, 'gataFeaturesService deve ser um stub para spyFeaturesService');
  });

  // ----------------------------------------------------------------
  // 22. TESTES DA CENTRAL DE COMANDO DA MATRIZ & ASSISTENTE EXECUTIVO DO DONO
  // ----------------------------------------------------------------
  console.log('\n👑 22. Testes da Central de Comando da Matriz & Assistente Executivo do Dono:');

  const testSubBot = models.createArmyInstance({
    name: 'Sub-Bot Matriz Operações',
    phone: '5511999998811'
  });

  runTest('Modelos de Tarefas Delegadas pela Matriz aos Sub-Bots (subbot_delegated_tasks)', () => {
    // 1. Cria tarefa delegada
    const task = models.createDelegatedTask({
      assigned_instance_id: testSubBot.id,
      task_type: 'DIRECT_MESSAGE',
      title: 'Disparo Especial para Lead VIP',
      description: 'Envio de link promocional',
      target: '5511999991234',
      message_payload: 'Olá, seu acesso VIP foi liberado!',
      delegated_by: 'OWNER'
    });

    assert(task.id > 0);
    assert(task.task_code.startsWith('TSK-'));
    assert.strictEqual(task.status, 'PENDING');
    assert.strictEqual(task.assigned_instance_id, testSubBot.id);

    // 2. Atualiza tarefa
    const updated = models.updateDelegatedTask(task.id, {
      status: 'COMPLETED',
      result_summary: 'Entregue com sucesso'
    });
    assert.strictEqual(updated.status, 'COMPLETED');
    assert.strictEqual(updated.result_summary, 'Entregue com sucesso');
    assert(updated.completed_at !== null);

    // 3. Consulta por código e resumo
    const byCode = models.getDelegatedTaskByCode(task.task_code);
    assert.strictEqual(byCode.id, task.id);

    const summary = models.getDelegatedTasksSummary();
    assert(summary.total >= 1);
    assert(summary.COMPLETED >= 1);
  });

  await runTest('Assistente Matriz: Ordem de Mensagem Direta para Sub-Bot', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    // Dono envia ordem em linguagem natural:
    // "Subbot {id} mande mensagem para 5511988887777 dizendo Olá, tudo pronto!"
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      `Subbot ${testSubBot.id} mande mensagem para 5511988887777 dizendo Olá, seu pedido foi enviado!`,
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1, 'Deve responder ao Dono confirmando a execução da ordem');
    const replyText = sent[0].text || '';
    assert(replyText.includes('ORDEM EXECUTADA COM SUCESSO'), 'Deve confirmar a execução');
    assert(replyText.includes(`Sub-Bot #${testSubBot.id}`), 'Deve citar o sub-bot executor');
    assert(replyText.includes('5511988887777'), 'Deve confirmar o número do destinatário');

    // Confere se a tarefa foi registrada no banco
    const tasks = models.getDelegatedTasks({ limit: 5 });
    const directTask = tasks.find(t => t.target === '5511988887777');
    assert(directTask, 'A tarefa deve estar registrada no banco');
    assert.strictEqual(directTask.status, 'COMPLETED');
  });

  await runTest('Assistente Matriz: Ordem de Disparo em Massa para Leads via Sub-Bots', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      'Sub-bots disparem para os leads a seguinte mensagem: {Oi|Olá} amigo! Super oferta disponível no link!',
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 2, 'Deve enviar aviso de início e briefing de conclusão');
    const finalReport = sent[sent.length - 1].text || '';
    assert(finalReport.includes('BRIEFING DE CONCLUSÃO DA MISSÃO'), 'Deve entregar o relatório executivo');
    assert(finalReport.includes('Disparos Realizados com Sucesso'), 'Deve reportar sucesso');
  });

  await runTest('Assistente Matriz: Relatório Operacional e Status dos Sub-Bots', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      'Status dos subbots',
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1);
    const reportText = sent[0].text || '';
    assert(reportText.includes('CENTRAL DE COMANDO DA MATRIZ'), 'Deve exibir cabeçalho executivo');
    assert(reportText.includes('Visão Geral dos Sub-Bots'), 'Deve contabilizar instâncias');
    assert(reportText.includes('Missões & Tarefas Delegadas'), 'Deve listar resumo das missões');
  });

  await runTest('Assistente Matriz: Chat Estratégico e Sugestões Prontas para Execução', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    // Pergunta estratégica do Dono
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      'Como podemos usar os sub-bots para bater nossa meta de vendas hoje?',
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1);
    const answerText = sent[0].text || '';
    assert(answerText.includes('ASSISTENTE EXECUTIVA DA MATRIZ'), 'Deve responder no papel de Assistente Executiva');
    assert(answerText.includes('sub-bots'), 'Deve contextualizar o exército de sub-bots');
  });

  await runTest('Integração WhatsApp Bot: Dono conversando no PV com a Matriz sem prefixo', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const origSend = whatsappBot.sendMessage;
    const origSock = whatsappBot.sock;
    const sent = [];

    const ownerPhone = '5511988880000';
    models.setSetting('OWNER_PHONE', ownerPhone);

    whatsappBot.sock = {
      user: { id: '5511900000000:1@s.whatsapp.net' }
    };

    whatsappBot.sendMessage = async (jid, textOrObj) => {
      const payload = typeof textOrObj === 'string' ? { text: textOrObj } : textOrObj;
      sent.push(payload);
      return { key: { id: 'ASSISTANT_REPLY' } };
    };

    try {
      // Dono manda mensagem em linguagem natural no privado da Matriz
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: `${ownerPhone}@s.whatsapp.net`, fromMe: false },
        pushName: 'Dono Soberano',
        message: { conversation: `Subbot ${testSubBot.id} mande mensagem para 5511977778888 dizendo Seu código Pix é 123` }
      });

      assert(sent.length >= 1, 'Deve interceptar a ordem do dono e responder');
      const reply = sent[0].text || '';
      assert(reply.includes('ORDEM EXECUTADA COM SUCESSO'), 'Matriz deve confirmar ordem delegada no PV');
    } finally {
      whatsappBot.sendMessage = origSend;
      whatsappBot.sock = origSock;
    }
  });

  await runTest('Endpoints REST da Central de Comando (/api/matriz/*)', async () => {
    // 1. GET /api/matriz/tasks
    const getTasks = await fetchApi('/api/matriz/tasks');
    assert.strictEqual(getTasks.status, 200);
    assert.strictEqual(getTasks.data.success, true);
    assert(Array.isArray(getTasks.data.tasks));
    assert(typeof getTasks.data.summary === 'object');

    // 2. GET /api/matriz/status
    const getStatus = await fetchApi('/api/matriz/status');
    assert.strictEqual(getStatus.status, 200);
    assert.strictEqual(getStatus.data.success, true);
    assert(getStatus.data.armySummary.totalSubBots >= 1 || getStatus.data.instances.length >= 1);

    // 3. POST /api/matriz/delegate
    const postDel = await fetchApi('/api/matriz/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'CUSTOM_ORDER',
        instanceId: testSubBot.id,
        title: 'Missão de Teste Via Painel Web',
        message: 'Avisar clientes da fila de espera'
      })
    });

    assert.strictEqual(postDel.status, 200);
    assert.strictEqual(postDel.data.success, true);
    assert.strictEqual(postDel.data.task.title, 'Missão de Teste Via Painel Web');
    assert.strictEqual(postDel.data.task.status, 'COMPLETED');
  });

  // ----------------------------------------------------------------
  // 23. TESTES AVANÇADOS DA MATRIZ: VOZ PTT, LOAD BALANCING, RELAY & AGENDAMENTO
  // ----------------------------------------------------------------
  console.log('\n🎙️ 23. Testes Avançados da Matriz: Voz PTT, Load Balancing, Relay & Agendamento:');

  await runTest('Assistente Matriz: Delegação de Áudio PTT (Voz Sintética) para Sub-Bot', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      `Subbot ${testSubBot.id} mande áudio para 5511999994444 dizendo Olá, seu pedido está pronto para entrega!`,
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1, 'Deve responder ao Dono confirmando a delegação do áudio');
    const replyText = sent[0].text || '';
    assert(replyText.includes('ÁUDIO DELEGADO COM SUCESSO'), 'Deve confirmar a transmissão de áudio');
    assert(replyText.includes('5511999994444'), 'Deve constar o número do lead');
    assert(replyText.includes('Voz PTT Sintetizada'), 'Deve especificar voz PTT');

    // Confere no banco
    const tasks = models.getDelegatedTasks({ limit: 5 });
    const voiceTask = tasks.find(t => t.target === '5511999994444');
    assert(voiceTask, 'A tarefa de voz deve estar registrada no banco');
    assert.strictEqual(voiceTask.task_type, 'VOICE_NOTE');
    assert.strictEqual(voiceTask.status, 'COMPLETED');
  });

  await runTest('Assistente Matriz: Distribuição Inteligente de Leads (Smart Load Balancing)', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push(payload);
        return true;
      }
    };

    await matrizAssistant.handleOwnerConversation(
      mockSock,
      '5511999990000@s.whatsapp.net',
      'Sub-bots distribuam 20 leads com a mensagem: {Oi|Olá} amigo! Super oferta disponível agora!',
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1, 'Deve entregar o relatório de distribuição de carga');
    const reply = sent[0].text || '';
    assert(reply.includes('DISTRIBUIÇÃO INTELIGENTE DE LEADS CONCLUÍDA'), 'Deve confirmar balanceamento');
    assert(reply.includes('Smart Load Balancing'), 'Deve reportar algoritmo de balanceamento');
    assert(reply.includes('Divisão de Carga Anti-Ban'), 'Deve exibir divisão por chip');

    const tasks = models.getDelegatedTasks({ limit: 5 });
    const balanceTask = tasks.find(t => t.task_type === 'SMART_LOAD_BALANCE');
    assert(balanceTask, 'Tarefa de balanceamento deve estar gravada no banco');
    assert.strictEqual(balanceTask.status, 'COMPLETED');
  });

  await runTest('Assistente Matriz: Live Relay & Human Takeover de Atendimento', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');
    const whatsappArmy = require('./src/services/whatsappArmyService');
    const whatsappBot = require('./src/bots/whatsappBot');
    const targetLead = '5511988887654';
    const ownerJid = '5511999990000@s.whatsapp.net';

    const sent = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload });
        return true;
      }
    };

    // 1. Dono assume o atendimento no sub-bot
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Assumir conversa com ${targetLead} no subbot ${testSubBot.id}`,
      'Dono Matriz',
      '5511999990000',
      false
    );

    assert(sent.length >= 1);
    assert(sent[0].payload.text.includes('ATENDIMENTO ASSUMIDO COM SUCESSO'));
    assert(whatsappArmy.getOwnerRelay(targetLead) !== null, 'Relay deve estar ativo');

    // 2. Lead envia mensagem para o sub-bot: deve ser repassada ao Dono na Matriz
    const origSock = whatsappBot.sock;
    const relayedMessages = [];
    whatsappBot.sock = {
      sendMessage: async (jid, payload) => {
        relayedMessages.push({ jid, payload });
        return true;
      }
    };

    try {
      await whatsappArmy.handleIncomingLeadMessage(testSubBot.id, targetLead, 'Oi, quanto custa o bot completo?');
      assert(relayedMessages.length >= 1, 'Mensagem do lead deve ser repassada ao dono');
      assert(relayedMessages[0].payload.text.includes('RELAY / TAKEOVER'), 'Deve conter cabeçalho de relay');
      assert(relayedMessages[0].payload.text.includes('Oi, quanto custa o bot completo?'), 'Deve conter mensagem do cliente');

      // 3. Dono responde pelo Sub-bot
      sent.length = 0;
      await matrizAssistant.handleOwnerConversation(
        mockSock,
        ownerJid,
        `Responder pelo subbot ${testSubBot.id} para ${targetLead}: O bot completo custa R$ 97 com entrega imediata!`,
        'Dono Matriz',
        '5511999990000',
        false
      );

      assert(sent.length >= 1);
      assert(sent[0].payload.text.includes('RESPOSTA ENVIADA AO LEAD COM SUCESSO'));

      // 4. Dono encerra o takeover
      sent.length = 0;
      await matrizAssistant.handleOwnerConversation(
        mockSock,
        ownerJid,
        `Encerrar atendimento com ${targetLead}`,
        'Dono Matriz',
        '5511999990000',
        false
      );

      assert(sent.length >= 1);
      assert(sent[0].payload.text.includes('ATENDIMENTO MANUAL FINALIZADO'));
      assert(whatsappArmy.getOwnerRelay(targetLead) === null, 'Relay deve ser encerrado');
    } finally {
      whatsappBot.sock = origSock;
    }
  });

  await runTest('Worker de Tarefas Agendadas (scheduled_at)', async () => {
    const matrizAssistant = require('./src/services/matrizAssistantService');

    // 1. Cria tarefa com scheduled_at no passado (já vencida)
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const scheduledTask = models.createDelegatedTask({
      assigned_instance_id: testSubBot.id,
      task_type: 'DIRECT_MESSAGE',
      title: 'Disparo Programado para Lead',
      target: '5511977770011',
      message_payload: 'Mensagem agendada entregue!',
      scheduled_at: pastTime
    });

    assert.strictEqual(scheduledTask.status, 'PENDING');
    assert(scheduledTask.scheduled_at !== null);

    // 2. Busca tarefas vencidas
    const due = models.getDueScheduledDelegatedTasks();
    const found = due.find(t => t.id === scheduledTask.id);
    assert(found, 'A tarefa agendada vencida deve ser encontrada pelo modelo');

    // 3. Executa o worker
    const executed = await matrizAssistant.checkAndExecuteScheduledTasks();
    const executedTask = executed.find(t => t.id === scheduledTask.id);
    assert(executedTask, 'O worker deve executar a tarefa');
    assert.strictEqual(executedTask.status, 'COMPLETED');

    const fresh = models.getDelegatedTaskById(scheduledTask.id);
    assert.strictEqual(fresh.status, 'COMPLETED');
  });

  await runTest('API REST: Delegação de Áudio, Load Balance e Agendamento', async () => {
    // 1. Delegação de Voz via API
    const resVoice = await fetchApi('/api/matriz/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'VOICE_NOTE',
        instanceId: testSubBot.id,
        target: '5511988882299',
        message: 'Áudio sintético enviado via REST API'
      })
    });
    assert.strictEqual(resVoice.status, 200);
    assert.strictEqual(resVoice.data.success, true);
    assert.strictEqual(resVoice.data.task.task_type, 'VOICE_NOTE');
    assert.strictEqual(resVoice.data.task.status, 'COMPLETED');

    // 2. Smart Load Balance via API
    const resBalance = await fetchApi('/api/matriz/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SMART_LOAD_BALANCE',
        target: '15',
        message: 'Oferta Especial via API'
      })
    });
    assert.strictEqual(resBalance.status, 200);
    assert.strictEqual(resBalance.data.success, true);
    assert.strictEqual(resBalance.data.task.status, 'COMPLETED');

    // 3. Tarefa Agendada no Futuro via API
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const resSched = await fetchApi('/api/matriz/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DIRECT_MESSAGE',
        instanceId: testSubBot.id,
        target: '5511966667788',
        message: 'Mensagem futura',
        scheduled_at: futureDate
      })
    });
    assert.strictEqual(resSched.status, 200);
    assert.strictEqual(resSched.data.success, true);
    assert.strictEqual(resSched.data.task.status, 'PENDING', 'Tarefa futura deve permanecer PENDING');
    assert(resSched.data.task.scheduled_at !== null);
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

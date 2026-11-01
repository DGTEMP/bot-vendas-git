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

    whatsappBot.sock = originalSock;
    whatsappBot.sendMessage = originalSendMessage;
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
  // 14. Funcionalidades Gata Bot / Gata Nina (Stickers, Segurança, Anti-Fake, Anti-View-Once, IA, Fidelidade & Mini-Games)
  // ----------------------------------------------------------------
  console.log('\n🐾 14. Funcionalidades Gata Bot / Gata Nina (Stickers, Segurança, IA & Fidelidade):');

  await runTest('Gata Nina: Sistema de Advertências (3-Strikes Auto-Ban)', async () => {
    const gataFeatures = require('./src/services/gataFeaturesService');
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
    await gataFeatures.handleWarn(mockSock, testGroup, badUser, 'Desrespeito', 'Admin Carlos', true);
    assert(sentText.includes('ADVERTÊNCIA REGISTRADA (2/3)'));
    assert.strictEqual(bannedJid, null);

    // Strike 3 (Auto-ban)
    await gataFeatures.handleWarn(mockSock, testGroup, badUser, 'Reincidência', 'Admin Carlos', true);
    assert(sentText.includes('LIMITE DE ADVERTÊNCIAS ATINGIDO (3/3)'));
    assert(sentText.includes('banido do grupo automaticamente'));
    assert.strictEqual(bannedJid, `${badUser}@s.whatsapp.net`);
    assert.strictEqual(models.getWarningsCount(testGroup, badUser), 0, 'Advertências devem ser zeradas após expulsão');
  });

  await runTest('Gata Nina: Proteção Anti-Fake (Ban de Números Estrangeiros Não +55)', async () => {
    const gataFeatures = require('./src/services/gataFeaturesService');
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

    await gataFeatures.checkAntiFakeEntry(mockSock, testGroup, participants);

    assert(removedList.includes('14155552671@s.whatsapp.net'), 'Número americano (+1) deve ser banido');
    assert(!removedList.includes('5511999998888@s.whatsapp.net'), 'Número brasileiro (+55) NÃO deve ser banido');
    assert(sentNotice.includes('ANTI-FAKE ATIVADO'), 'Deve emitir aviso no grupo');
  });

  await runTest('Gata Nina: Registro e Anti-View-Once (Visualização Única Revelada)', async () => {
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

  await runTest('Gata Nina: Google TTS & Google Translate Instantâneo', async () => {
    const gataFeatures = require('./src/services/gataFeaturesService');

    // 1. Tradução
    let translatedMsg = null;
    const mockSockTr = {
      sendMessage: async (jid, payload) => {
        translatedMsg = payload.text;
        return true;
      }
    };

    await gataFeatures.handleTranslate(mockSockTr, 'test_chat', '!traduzir en Olá bom dia amigo');
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

    await gataFeatures.handleTTS(mockSockTts, 'test_chat', '!tts Bem vindo ao PayBot');
    assert(audioPayload && audioPayload.audio, 'Deve gerar buffer de áudio');
    assert.strictEqual(audioPayload.ptt, true, 'Deve ser formatado como PTT (áudio de voz)');
  });

  await runTest('Gata Nina: Gamificação, Nível de Fidelidade & Resgate de Cupons', async () => {
    const gataFeatures = require('./src/services/gataFeaturesService');
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

    await gataFeatures.handleDado(mockSockGame, 'test_chat', userPhone, 'Jogador Teste');
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

  await runTest('Gata Nina: Roteamento de Comandos WhatsApp (!comandos, !perfil, !dado)', async () => {
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
    assert(lastReply.includes('CATÁLOGO DE COMANDOS GATA NINA'));
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
    assert(lastReply.includes('ROLETA DA SORTE GATA NINA'));

    whatsappBot.sendMessage = origSend;
  });

  await runTest('Gata Nina: Downloader de Música YouTube (!play / !ytmp3)', async () => {
    const gataFeatures = require('./src/services/gataFeaturesService');
    const sentOutputs = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentOutputs.push(payload);
        return true;
      }
    };

    // Executa busca e download da música
    await gataFeatures.handlePlayMusic(mockSock, '5511999998888@s.whatsapp.net', '!play Imagine Dragons Believer');

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

  await runTest('Gata Nina: Conversor de Figurinhas WebP (!s / !sticker)', async () => {
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

  await runTest('Gata Nina: Scraper & Auditoria de Perfil Instagram (!scrapinsta)', async () => {
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

  await runTest('Gata Nina: Download de Stories Instagram (!allstories)', async () => {
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

  await runTest('Gata Nina: Boas-Vindas e Despedida Automática com Objetos e Strings Baileys (!boasvindas & !despedida)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const testGroup = '120363011998877665@g.us';

    models.setSetting(`WELCOME_${testGroup}`, 'true');
    models.setSetting(`WELCOME_MSG_${testGroup}`, 'Olá {nome}, bem-vindo ao grupo {grupo}! Seu número é {numero}.');
    models.setSetting(`BYE_${testGroup}`, 'true');
    models.setSetting(`BYE_MSG_${testGroup}`, 'Até logo @{numero} do grupo {grupo}!');

    const sentMessages = [];
    const mockGroupSock = {
      user: { id: '5511988880000:1@s.whatsapp.net' },
      groupMetadata: async (gid) => ({ subject: 'Grupo VIP Gata Nina', participants: [] }),
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
    assert(sentMessages[0].payload.text.includes('Grupo VIP Gata Nina'));

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

  await runTest('Gata Nina: Downloader de Vídeos YouTube (!video / !ytmp4)', async () => {
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

  await runTest('Gata Nina: Downloaders de Redes Sociais (!x & !fb)', async () => {
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

  await runTest('Gata Nina: Utilitários Essenciais (!cep, !calc, !encurtar, !qr)', async () => {
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

  await runTest('Gata Nina: Moderação Avançada (!todos, !antidelete & !antiprivado)', async () => {
    const whatsappBot = require('./src/bots/whatsappBot');
    const gataFeatures = require('./src/services/gataFeaturesService');
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
    gataFeatures.recordMessage(victimMsg);

    // Simula evento de exclusão / revoke
    await gataFeatures.handleRevoke(mockAdminSock, testGroup, 'MSG_SECRETA_123', '5511911112222@s.whatsapp.net');
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

  await runTest('Gata Nina & Painel Web: Configurações Expandidas de Grupo (/api/groups/:groupId/settings)', async () => {
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

  await runTest('Gata Nina: Central Multi-Contas WhatsApp & Jadibot / Serbot (/api/whatsapp/accounts & !serbot)', async () => {
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
    assert(serbotReply.text.includes('GATABOT / SUB-BOT MULTI-CONEXÃO'));
    assert(serbotReply.text.includes('CÓDIGO DE CONEXÃO'));
    assert(serbotReply.text.includes('5511966665555'));

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

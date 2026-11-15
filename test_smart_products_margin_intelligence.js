/**
 * test_smart_products_margin_intelligence.js
 * Teste unitário e de integração para o ecossistema de Inteligência de Produtos,
 * Alimentação da Base de Dados, Fortalecimento do Bot e Maximização da Margem de Lucro.
 */

const assert = require('assert');
const models = require('./src/db/models');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');
const cognitiveSales = require('./src/services/cognitiveSalesService');
const predictiveIntel = require('./src/services/predictiveIntelligenceService');

async function runTests() {
  console.log('🧪 Iniciando testes de Alimentação da Base, Bot Forte e Margem de Lucro...');

  const testPhone = '5511977771234';
  const testName = 'Renata Empreendedora';

  // 1. Testando colunas e calibração de Margem de Lucro e Inteligência
  console.log('\n[1/6] Validando calibração de margem de lucro e inteligência em products...');
  const smartProducts = models.getHighMarginSmartProducts(5);
  assert(smartProducts && smartProducts.length > 0, 'Deve retornar produtos de alta margem');
  const topProd = smartProducts[0];
  assert(topProd.profit_margin_percent >= 75.0, 'Margem de lucro deve ser expressiva (>= 75%)');
  assert(topProd.intelligence_score >= 80.0, 'Score de inteligência deve ser >= 80');
  assert(topProd.smart_tag, 'Produto inteligente deve possuir smart_tag');
  console.log(`  ✅ Produto Top Margem: "${topProd.name}" | Margem: ${topProd.profit_margin_percent}% | Score: ${topProd.intelligence_score} | Tag: ${topProd.smart_tag}`);

  // 2. Testando Telemetria alimentando a Base de Dados (Views, Carts e Perfil)
  console.log('\n[2/6] Testando telemetria da loja alimentando views, cart adds e perfil do lead...');
  const initialViews = Number(topProd.views_count || 0);

  // 2.1 PAGE / PRODUCT VIEW
  await webStoreTrackerService.trackEvent({
    session_id: `sess_lead_${testPhone}`,
    phone: testPhone,
    customer_name: testName,
    event_type: 'PRODUCT_VIEW',
    product_id: topProd.id,
    product_name: topProd.name
  });

  const updatedProdView = models.getProductById(topProd.id);
  assert(updatedProdView.views_count >= initialViews + 1, 'views_count deve ter sido incrementado');
  console.log(`  ✅ views_count incrementado de ${initialViews} para ${updatedProdView.views_count}`);

  // 2.2 ADD TO CART
  await webStoreTrackerService.trackEvent({
    session_id: `sess_lead_${testPhone}`,
    phone: testPhone,
    customer_name: testName,
    event_type: 'ADD_TO_CART',
    product_id: topProd.id,
    product_name: topProd.name,
    cart_payload: JSON.stringify([{ id: topProd.id, name: topProd.name, price_brl: topProd.price_brl || 497 }]),
    cart_total: Number(topProd.price_brl || 497)
  });

  const updatedProdCart = models.getProductById(topProd.id);
  assert(updatedProdCart.cart_adds_count >= 1, 'cart_adds_count deve ter sido incrementado');

  // Verifica Perfil Cognitivo enriquecido
  const profile = models.getLeadCognitiveProfile(testPhone);
  assert(profile, 'Perfil cognitivo deve existir');
  assert.strictEqual(profile.buying_stage, 'DECISAO_IMINENTE', 'buying_stage deve evoluir para DECISAO_IMINENTE');
  assert(profile.readiness_score >= 75, 'readiness_score deve ser >= 75');
  assert.strictEqual(profile.last_viewed_product_id, topProd.id, 'last_viewed_product_id deve bater com o produto');
  assert.strictEqual(profile.last_viewed_product_name, topProd.name, 'last_viewed_product_name deve bater com o produto');

  // Verifica Crença cognitiva gerada
  const beliefs = models.getLeadBeliefs(testPhone);
  const cartBelief = beliefs.find(b => b.belief_key === 'carrinho_ativo');
  assert(cartBelief, 'Crença cognitiva de carrinho ativo deve ter sido gravada');
  console.log(`  ✅ Perfil Cognitivo e crenças do lead alimentados em tempo real na base!`);

  // 3. Testando getLeadStoreContext
  console.log('\n[3/6] Testando models.getLeadStoreContext para armar o bot...');
  const storeContext = models.getLeadStoreContext(testPhone);
  assert(storeContext, 'Contexto da loja deve ser retornado');
  assert.strictEqual(storeContext.phone, testPhone);
  assert.strictEqual(storeContext.last_viewed_product_name, topProd.name);
  assert.strictEqual(storeContext.has_active_cart, true);
  assert(storeContext.cart_total > 0);
  console.log(`  ✅ Contexto recuperado: Lead tem carrinho ativo de "${storeContext.last_viewed_product_name}" (R$ ${storeContext.cart_total})`);

  // 4. Testando "O Bot Mais Forte": Resposta Consultiva usando interesse da vitrine
  console.log('\n[4/6] Testando bot respondendo com precisão sobre o produto que o cliente viu na vitrine...');
  const consultativeReply = cognitiveSales.generateHeuristicConsultativeReply({
    profile: { phone: testPhone, buying_stage: 'PROPOSTA' },
    firstName: testName,
    text: 'quanto custa?',
    isMasterBot: true,
    effectiveProducts: []
  });

  assert(consultativeReply, 'Resposta consultiva deve existir');
  assert(consultativeReply.includes(topProd.name), `A resposta deve citar especificamente o produto visto ("${topProd.name}")`);
  console.log(`  ✅ Bot respondeu citando exatamente o produto da vitrine:\n     ${consultativeReply.split('\n')[0]}`);

  // 5. Testando Registro de Venda, Lucro Líquido e Margem no Fulfillment
  console.log('\n[5/6] Testando registro de venda, lucro e margem de lucro no banco...');
  const tradeNo = `ORD_SMART_${Date.now()}`;
  models.createOrder({
    merchant_trade_no: tradeNo,
    product_id: topProd.id,
    product_name: topProd.name,
    amount: Number(topProd.price_brl || topProd.price),
    currency: 'BRL',
    status: 'PAID',
    customer_phone: testPhone,
    customer_name: testName,
    platform: 'whatsapp',
    platform_user_id: testPhone
  });

  const cost = Number(topProd.cost_price || 25);
  const profit = Math.max(0, Number(topProd.price_brl || topProd.price) - cost);
  const marginPercent = topProd.profit_margin_percent || 95.0;

  const profitRecorded = models.recordOrderProfit(tradeNo, profit, marginPercent);
  assert.strictEqual(profitRecorded, true);

  models.recordProductSale(topProd.id, topProd.price_brl);
  const finalProd = models.getProductById(topProd.id);
  assert(finalProd.sales_count >= 1, 'sales_count deve ter sido incrementado');
  console.log(`  ✅ Venda registrada: Lucro Líquido = R$ ${profit.toFixed(2)} (${marginPercent}% de margem)`);

  // 6. Testando Análise Preditiva de Margem e Produtos de Alta Performance
  console.log('\n[6/6] Testando métricas preditivas de margem de lucro no oráculo...');
  const analytics = predictiveIntel.calculateFullPredictiveAnalytics('554884702848');
  assert(analytics.profitMargin, 'Deve conter bloco profitMargin');
  assert(analytics.profitMargin.avgPortfolioMargin >= 70, 'Margem média do portfólio deve ser >= 70%');
  assert(Array.isArray(analytics.profitMargin.topHighMarginProducts), 'Deve listar produtos de alta margem');
  console.log(`  ✅ Oráculo Preditivo calculou margem média de ${analytics.profitMargin.avgPortfolioMargin}% e ${analytics.profitMargin.topHighMarginProducts.length} produtos de alta performance!`);

  console.log('\n🎉 TODOS OS TESTES DE INTELIGÊNCIA DE PRODUTOS E MARGEM DE LUCRO PASSARAM COM 100%! 🎉');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste de inteligência e margem:', err);
  process.exit(1);
});

const assert = require('assert');
const models = require('./src/db/models');
const db = require('./src/db/database');

console.log('🧪 [TESTES] Iniciando Suíte de Testes de Troca de Pagamento & Anti-Duplicação...\n');

// 1. Setup: Pega um produto válido
const product = models.getProducts(true)[0];
assert(product, 'Deve existir ao menos um produto no banco');

const testPhone = '5511999990001';
const initialOrderCount = db.prepare('SELECT count(*) as c FROM orders').get().c;

// 2. Cria primeiro pedido como PIX
const initialTradeNo = `TEST_SWITCH_${Date.now()}`;
const order1 = models.createOrder({
  merchant_trade_no: initialTradeNo,
  platform: 'whatsapp',
  platform_user_id: testPhone,
  platform_user_name: 'Cliente Teste Anti-Duplicação',
  product_id: product.id,
  gateway: 'mercadopago',
  amount: 49.90,
  currency: 'BRL',
  pix_code: '00020126580014br.gov.bcb.pix0136test-pix-copia-cola',
  status: 'PENDING'
});

assert.strictEqual(order1.merchant_trade_no, initialTradeNo, 'Pedido 1 deve ter sido criado');
assert.strictEqual(order1.gateway, 'mercadopago', 'Gateway inicial deve ser mercadopago/pix');

const countAfter1 = db.prepare('SELECT count(*) as c FROM orders').get().c;
assert.strictEqual(countAfter1, initialOrderCount + 1, 'Deve ter aumentado exatamente 1 pedido');
console.log('  ✓ Pedido inicial (PIX) criado com sucesso');

// 3. Testa getLatestPendingOrder
const foundPending = models.getLatestPendingOrder(testPhone, product.id);
assert(foundPending, 'Deve encontrar o pedido pendente do cliente');
assert.strictEqual(foundPending.merchant_trade_no, initialTradeNo, 'Deve retornar o mesmo tradeNo');
console.log('  ✓ models.getLatestPendingOrder() localizou o pedido pendente com precisão');

// 4. Testa updateOrderGateway: Cliente errou e trocou para Binance Pay (USDT)
const switchedToBinance = models.updateOrderGateway(initialTradeNo, {
  gateway: 'binancepay',
  currency: 'USDT',
  amount: 9.07,
  checkout_url: 'https://pay.binance.com/checkout/test12345',
  qr_content: 'https://pay.binance.com/qr/test12345',
  prepay_id: 'PREPAY_TEST_999'
});

assert(switchedToBinance, 'Deve retornar o pedido atualizado');
assert.strictEqual(switchedToBinance.merchant_trade_no, initialTradeNo, 'TradeNo DEVE permanecer o mesmo');
assert.strictEqual(switchedToBinance.gateway, 'binancepay', 'Gateway deve ser atualizado para binancepay');
assert.strictEqual(switchedToBinance.currency, 'USDT', 'Moeda deve ser atualizada para USDT');
assert.strictEqual(switchedToBinance.amount, 9.07, 'Valor deve ser atualizado para 9.07 USDT');
assert.strictEqual(switchedToBinance.checkout_url, 'https://pay.binance.com/checkout/test12345');

const countAfterSwitch = db.prepare('SELECT count(*) as c FROM orders').get().c;
assert.strictEqual(countAfterSwitch, countAfter1, 'A troca de modalidade NÃO DEVE duplicar ou criar novas linhas no banco de pedidos!');
console.log('  ✓ models.updateOrderGateway() alterou modalidade para Binance Pay SEM DUPLICAR ordens no banco');

// 5. Testa nova troca para Carteira Cripto
const switchedToCrypto = models.updateOrderGateway(initialTradeNo, {
  gateway: 'crypto',
  currency: 'USDT',
  amount: 9.07,
  qr_content: JSON.stringify({ address: 'TQabcdef123456', network: 'TRC20', gateway: 'crypto' })
});

assert.strictEqual(switchedToCrypto.gateway, 'crypto', 'Gateway atualizado para crypto');
const countAfterCrypto = db.prepare('SELECT count(*) as c FROM orders').get().c;
assert.strictEqual(countAfterCrypto, countAfter1, 'Continua com exatamente a mesma contagem de pedidos no banco');
console.log('  ✓ Segunda troca para Carteira Cripto realizada sem duplicação');

// 6. Testa cancelOtherPendingOrders
// Simula um pedido órfão antigo criado por acidente
const orphanTradeNo = `TEST_ORPHAN_${Date.now()}`;
models.createOrder({
  merchant_trade_no: orphanTradeNo,
  platform: 'whatsapp',
  platform_user_id: testPhone,
  platform_user_name: 'Cliente Teste Anti-Duplicação',
  product_id: product.id,
  gateway: 'pix',
  amount: 49.90,
  currency: 'BRL',
  status: 'PENDING'
});

const cancelledCount = models.cancelOtherPendingOrders(testPhone, initialTradeNo, product.id);
assert.strictEqual(cancelledCount, 1, 'Deve cancelar exatamente o pedido órfão anterior');
const orphanOrder = models.getOrderByTradeNo(orphanTradeNo);
assert.strictEqual(orphanOrder.status, 'CANCELLED', 'Pedido órfão deve estar CANCELLED');
const keeperOrder = models.getOrderByTradeNo(initialTradeNo);
assert.strictEqual(keeperOrder.status, 'PENDING', 'Pedido ativo principal deve permanecer PENDING');
console.log('  ✓ models.cancelOtherPendingOrders() cancelou pedido órfão antigo preservando o pedido ativo');

// Limpeza de testes
db.prepare('DELETE FROM orders WHERE merchant_trade_no IN (?, ?)').run(initialTradeNo, orphanTradeNo);
console.log('\n🎉 TODOS OS TESTES DE TROCA DE PAGAMENTO E ANTI-DUPLICAÇÃO PASSARAM COM 100% DE SUCESSO!\n');

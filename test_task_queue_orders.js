const assert = require('assert');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');
const http = require('http');

async function runTests() {
  console.log('🧪 Iniciando testes de Gestão de Tarefas, Edição de Pedidos e Lembretes...\n');

  // 1. Cria pedido de teste
  const tradeNo = `ORD_TASK_TEST_${Date.now()}`;
  const prod = models.getProducts(false)[0];
  assert(prod, 'Deve haver produtos no banco');

  const order = models.createOrder({
    merchant_trade_no: tradeNo,
    platform: 'whatsapp',
    platform_user_id: '5511999990001',
    platform_user_name: 'Cliente Antigo',
    product_id: prod.id,
    amount: 99.90,
    currency: 'BRL',
    gateway: 'pix'
  });
  assert(order, 'Pedido de teste criado');
  assert.strictEqual(order.platform_user_name, 'Cliente Antigo');

  // 2. Teste de Edição de Nome, Telefone e Produto
  const updatedOrder = models.updateOrderDetails(tradeNo, {
    platform_user_name: 'Carlos Roberto Silva',
    platform_user_id: '5548984702848',
    amount: 149.00
  });
  assert.strictEqual(updatedOrder.platform_user_name, 'Carlos Roberto Silva', 'Nome editado com sucesso');
  assert.strictEqual(updatedOrder.platform_user_id, '5548984702848', 'Telefone editado com sucesso');
  assert.strictEqual(updatedOrder.amount, 149.00, 'Valor editado com sucesso');
  console.log('✅ [PASS] models.updateOrderDetails (Nome, Telefone e Valor)');

  // 3. Teste de Pular Tarefa (Skip)
  models.skipOrderRecovery(tradeNo);
  const skippedOrder = models.getOrderByTradeNo(tradeNo);
  assert.strictEqual(skippedOrder.recovery_sent, 2, 'Status deve ser 2 (Pulado/Ignorado)');
  console.log('✅ [PASS] models.skipOrderRecovery');

  // 4. Teste de Pausar e Retomar
  models.pauseOrderRecovery(tradeNo);
  const pausedOrder = models.getOrderByTradeNo(tradeNo);
  assert.strictEqual(pausedOrder.recovery_sent, 3, 'Status deve ser 3 (Pausado)');
  console.log('✅ [PASS] models.pauseOrderRecovery');

  models.resumeOrderRecovery(tradeNo);
  const resumedOrder = models.getOrderByTradeNo(tradeNo);
  assert.strictEqual(resumedOrder.recovery_sent, 0, 'Status deve ser 0 (Reativado na Fila)');
  console.log('✅ [PASS] models.resumeOrderRecovery');

  // 5. Testes dos Endpoints HTTP
  const app = createServer();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // GET /api/tasks/queue
    const qRes = await fetch(`${baseUrl}/api/tasks/queue`);
    const qData = await qRes.json();
    assert.strictEqual(qData.success, true);
    assert(Array.isArray(qData.pendingOrders), 'pendingOrders deve ser array');
    console.log('✅ [PASS] GET /api/tasks/queue');

    // POST /api/orders/:tradeNo/edit
    const editRes = await fetch(`${baseUrl}/api/orders/${tradeNo}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform_user_name: 'Carlos VIP Master',
        platform_user_id: '554884702848'
      })
    });
    const editData = await editRes.json();
    assert.strictEqual(editData.success, true);
    assert.strictEqual(editData.order.platform_user_name, 'Carlos VIP Master');
    assert.strictEqual(editData.order.platform_user_id, '554884702848');
    console.log('✅ [PASS] POST /api/orders/:tradeNo/edit via API');

    // POST /api/orders/:tradeNo/skip
    const skipRes = await fetch(`${baseUrl}/api/orders/${tradeNo}/skip`, { method: 'POST' });
    const skipData = await skipRes.json();
    assert.strictEqual(skipData.success, true);
    console.log('✅ [PASS] POST /api/orders/:tradeNo/skip via API');

    // POST /api/tasks/queue/toggle
    const toggleRes = await fetch(`${baseUrl}/api/tasks/queue/toggle`, { method: 'POST' });
    const toggleData = await toggleRes.json();
    assert.strictEqual(toggleData.success, true);
    console.log('✅ [PASS] POST /api/tasks/queue/toggle via API');

  } finally {
    server.close();
  }

  console.log('\n🎉 TODOS OS TESTES DE GESTÃO DE TAREFAS E PEDIDOS PASSARAM!');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

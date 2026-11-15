const http = require('http');
const { createServer, createStoreServer } = require('./src/server/app');
const models = require('./src/db/models');

async function testBothServers() {
  console.log('🧪 Testing createStoreServer() endpoints...');
  const storeApp = createStoreServer();
  const server = http.createServer(storeApp);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`  ✓ Store server running on ${baseUrl}`);

  try {
    const products = typeof models.getActiveProducts === 'function' ? models.getActiveProducts() : models.getProducts();
    const p = products[0];

    // 1. Check POST /api/store/checkout on store server
    console.log('1. Testing POST /api/store/checkout:');
    let res = await fetch(`${baseUrl}/api/store/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: p.id, quantity: 1 }],
        customer: { name: 'Cliente Loja Teste', phone: '11988887777' },
        gateway: 'pix'
      })
    });
    console.log('  Status:', res.status);
    let data = await res.json();
    if (!data.success || !data.tradeNo) throw new Error('Checkout falhou: ' + JSON.stringify(data));
    const tradeNo = data.tradeNo;
    console.log(`  ✓ Pedido gerado: ${tradeNo} | Status: ${data.success} | Gateway: ${data.gateway} | PixCode gerado: ${!!data.pixCode}`);

    // 2. Check GET /api/crypto/networks
    console.log('2. Testing GET /api/crypto/networks:');
    res = await fetch(`${baseUrl}/api/crypto/networks`);
    console.log('  Status:', res.status);
    data = await res.json();
    if (!data.success) throw new Error('Falha ao listar redes cripto');
    console.log('  ✓ Redes cripto retornadas:', Object.keys(data.networks || {}).length);

    // 3. Check POST /api/store/order/switch-gateway (trocar para Binance Pay)
    console.log('3. Testing POST /api/store/order/switch-gateway (para Binance Pay):');
    res = await fetch(`${baseUrl}/api/store/order/switch-gateway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tradeNo,
        newGateway: 'binancepay'
      })
    });
    console.log('  Status:', res.status);
    data = await res.json();
    if (!data.success || data.gateway !== 'binancepay') throw new Error('Troca de gateway falhou: ' + JSON.stringify(data));
    console.log(`  ✓ Gateway alterado para: ${data.gateway} | Moeda: ${data.currency} | Valor: ${data.amount}`);

    // 4. Check POST /api/store/order/switch-gateway (trocar para Carteira Cripto)
    console.log('4. Testing POST /api/store/order/switch-gateway (para Crypto):');
    res = await fetch(`${baseUrl}/api/store/order/switch-gateway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tradeNo,
        newGateway: 'crypto'
      })
    });
    console.log('  Status:', res.status);
    data = await res.json();
    if (!data.success || data.gateway !== 'crypto') throw new Error('Troca para crypto falhou: ' + JSON.stringify(data));
    console.log(`  ✓ Gateway alterado para: ${data.gateway} | Moeda: ${data.currency}`);

    // 5. Check GET /api/store/orders?tradeNo=...
    console.log('5. Testing GET /api/store/orders:');
    res = await fetch(`${baseUrl}/api/store/orders?tradeNo=${tradeNo}`);
    console.log('  Status:', res.status);
    data = await res.json();
    if (!data.success || !data.orders || data.orders.length === 0) throw new Error('Falha na consulta de pedidos');
    const ord = data.orders[0];
    if (!ord.gateway || ord.price_brl === undefined) throw new Error('Campos sanitized incompletos');
    console.log(`  ✓ Pedido consultado com sucesso: #${ord.merchant_trade_no} | Status: ${ord.status} | Gateway: ${ord.gateway} | Preço BRL: ${ord.price_brl}`);

    // 6. Check GET /simulated-pay?tradeNo=...
    console.log('6. Testing GET /simulated-pay:');
    res = await fetch(`${baseUrl}/simulated-pay?tradeNo=${tradeNo}`);
    console.log('  Status:', res.status);
    const html = await res.text();
    if (!html.includes('Simulador de Pagamento') || !html.includes(tradeNo)) throw new Error('Simulador de pagamento inválido');
    console.log('  ✓ Tela do simulador de pagamento servida com sucesso');

    // 7. Check POST /api/orders/simulate-pay/:tradeNo
    console.log('7. Testing POST /api/orders/simulate-pay/:tradeNo:');
    res = await fetch(`${baseUrl}/api/orders/simulate-pay/${tradeNo}`, { method: 'POST' });
    console.log('  Status:', res.status);
    data = await res.json();
    if (!data.success) throw new Error('Falha ao confirmar pagamento simulado');
    console.log(`  ✓ Pagamento simulado confirmado com sucesso!`);

    // 8. Re-consultar pedido para confirmar status PAID
    res = await fetch(`${baseUrl}/api/store/orders?tradeNo=${tradeNo}`);
    data = await res.json();
    const paidOrd = data.orders[0];
    if (paidOrd.status !== 'PAID') throw new Error('Status do pedido deveria ser PAID');
    console.log(`  ✓ Status final do pedido: ${paidOrd.status} (Entregue: ${!!paidOrd.delivered_content})`);

    console.log('\n🎉 TODOS OS ENDPOINTS DA LOJA PÚBLICA (createStoreServer) PASSARAM COM SUCESSO TOTAL!');
  } finally {
    server.close();
  }
}

testBothServers().then(() => {
  console.log('Finalizado.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

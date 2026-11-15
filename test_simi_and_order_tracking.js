const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const db = require('./src/db/database');
const simiService = require('./src/services/simiService');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const { createServer } = require('./src/server/app');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('🧪 INICIANDO TESTES DO CHATBOT SIMSIMI (!simi) & ACOMPANHAMENTO DE PEDIDOS\n');

  // ==========================================
  // BLOCO 1: SIMISERVICE - MOTOR CONVERSACIONAL
  // ==========================================
  console.log('--- TESTE 1: SimiService - Respostas e Personalidades ---');
  const greetingReply = await simiService.generateResponse('Oi simi', { senderName: 'Carlos' });
  assert(greetingReply && typeof greetingReply === 'string' && greetingReply.length > 2, 'Simi deve responder a saudações');
  console.log('  ✅ PASS: Resposta a saudação:', greetingReply);

  const jokeReply = await simiService.generateResponse('Me conta uma piada', { senderName: 'Carlos' });
  assert(jokeReply && jokeReply.length > 5, 'Simi deve contar piada');
  console.log('  ✅ PASS: Resposta de piada:', jokeReply);

  const salesReply = await simiService.generateResponse('Qualquer mensagem', { senderName: 'Carlos', personality: 'vendedor' });
  assert(salesReply && salesReply.length > 3, 'Simi no modo vendedor deve responder');
  console.log('  ✅ PASS: Resposta no modo vendedor:', salesReply);

  // ==========================================
  // BLOCO 2: SIMISERVICE - COMANDOS (!simi on, off, status)
  // ==========================================
  console.log('\n--- TESTE 2: SimiService - Comandos WhatsApp ---');
  let sentSockMsg = null;
  const mockSock = {
    sendMessage: async (to, payload) => {
      sentSockMsg = { to, payload };
      return true;
    },
    sendPresenceUpdate: async () => true
  };

  const testChatJid = '1203639988776655@g.us';

  // Teste !simi on
  await simiService.handleSimiCommand(mockSock, testChatJid, '!simi on', 'Admin', true);
  assert(sentSockMsg && sentSockMsg.payload.text.includes('SIMSIMI ATIVADO'), 'Deve confirmar ativação do SimSimi no chat');
  assert.strictEqual(models.isSimiActiveInChat(testChatJid), true, 'Chat deve estar marcado como ativo no banco');
  console.log('  ✅ PASS: !simi on ativou o chat com sucesso');

  // Teste !simi status
  sentSockMsg = null;
  await simiService.handleSimiCommand(mockSock, testChatJid, '!simi status', 'Admin', true);
  assert(sentSockMsg && sentSockMsg.payload.text.includes('STATUS DO SIMSIMI'), 'Deve exibir status do SimSimi');
  console.log('  ✅ PASS: !simi status reportou status com sucesso');

  // Teste !simi off
  sentSockMsg = null;
  await simiService.handleSimiCommand(mockSock, testChatJid, '!simi off', 'Admin', true);
  assert(sentSockMsg && sentSockMsg.payload.text.includes('SIMSIMI DESATIVADO'), 'Deve confirmar desativação do SimSimi');
  assert.strictEqual(models.isSimiActiveInChat(testChatJid), false, 'Chat deve estar inativo no banco');
  console.log('  ✅ PASS: !simi off desativou o chat com sucesso');

  // Teste conversa direta via !simi <pergunta>
  sentSockMsg = null;
  await simiService.handleSimiCommand(mockSock, testChatJid, '!simi você é um bot?', 'Maria', true);
  assert(sentSockMsg && sentSockMsg.payload.text, 'Deve responder à pergunta direta do usuário');
  console.log('  ✅ PASS: !simi <pergunta> respondeu:', sentSockMsg.payload.text);

  // ==========================================
  // BLOCO 3: BANCO & ACOMPANHAMENTO DE PEDIDOS
  // ==========================================
  console.log('\n--- TESTE 3: Criação e Consulta de Pedidos do Cliente ---');
  const testPhone = '5511988887766';
  const tradeNo = `ORD_TEST_TRACK_${Date.now()}`;

  // Cria um produto de teste se necessário
  let prod = db.prepare('SELECT id FROM products LIMIT 1').get();
  if (!prod) {
    prod = models.createProduct({
      name: 'Software Teste Tracker',
      price_brl: 49.9,
      price_usdt: 10.0,
      type: 'digital',
      category: 'Softwares'
    });
  }

  // Cria pedido PENDING
  const orderPending = models.createOrder({
    merchant_trade_no: tradeNo,
    platform: 'whatsapp',
    platform_user_id: testPhone,
    platform_user_name: 'Cliente Teste Tracking',
    product_id: prod.id,
    gateway: 'pix',
    amount: 49.9,
    currency: 'BRL',
    status: 'PENDING',
    pix_code: '00020126580014br.gov.bcb.pix0136test-pix-copia-e-cola5204000053039865802BR5925Paybot6009Sao Paulo62070503***6304ABCD'
  });
  assert(orderPending, 'Deve registrar pedido pendente');

  // Consulta por telefone com DDI e sem DDI
  const foundOrders = models.getOrdersByCustomerPhone(testPhone);
  assert(foundOrders.length > 0, 'Deve localizar pedidos pelo telefone com DDI');
  assert.strictEqual(foundOrders[0].merchant_trade_no, tradeNo);

  const foundNoDdi = models.getOrdersByCustomerPhone('11988887766');
  assert(foundNoDdi.length > 0, 'Deve localizar pedidos pelo telefone sem DDI');

  // Consulta por TradeNo
  const foundByTrade = models.getOrderByTradeNo(tradeNo);
  assert(foundByTrade, 'Deve localizar pedido por tradeNo');
  assert.strictEqual(foundByTrade.status, 'PENDING');
  console.log('  ✅ PASS: Consulta de pedidos no banco funcionando com e sem DDI');

  // ==========================================
  // BLOCO 4: RASTREAMENTO NO WHATSAPP (!pedido)
  // ==========================================
  console.log('\n--- TESTE 4: spyFeatures.handleOrderTracking ---');
  sentSockMsg = null;
  await spyFeatures.handleOrderTracking(mockSock, `${testPhone}@s.whatsapp.net`, '!pedido', testPhone, 'Cliente Teste');
  assert(sentSockMsg && sentSockMsg.payload.text.includes('CENTRAL DE ACOMPANHAMENTO DE PEDIDOS'), 'Deve retornar relatório de pedidos');
  assert(sentSockMsg.payload.text.includes(tradeNo), 'Deve citar o código do pedido');
  assert(sentSockMsg.payload.text.includes('AGUARDANDO PAGAMENTO'), 'Deve indicar status pendente');
  assert(sentSockMsg.payload.text.includes('PIX COPIA E COLA'), 'Deve conter código Pix para pagar');
  console.log('  ✅ PASS: !pedido exibiu detalhes, status e código Pix para pagamento');

  // Atualiza para PAID com delivered_content
  models.updateOrderStatus(tradeNo, 'PAID', 'CHAVE-LICENCA-TESTE-VIP-9999');

  sentSockMsg = null;
  await spyFeatures.handleOrderTracking(mockSock, `${testPhone}@s.whatsapp.net`, `!pedido ${tradeNo}`, testPhone, 'Cliente Teste');
  assert(sentSockMsg.payload.text.includes('PAGO & ENTREGUE'), 'Deve indicar status pago');
  assert(sentSockMsg.payload.text.includes('CHAVE-LICENCA-TESTE-VIP-9999'), 'Deve conter chave de entrega');
  console.log('  ✅ PASS: !pedido exibiu conteúdo entregue após pagamento aprovado');

  // ==========================================
  // BLOCO 5: DESTAQUE NA VITRINE (!loja)
  // ==========================================
  console.log('\n--- TESTE 5: spyFeatures.handleLoja com Destaque de Pedidos ---');
  sentSockMsg = null;
  await spyFeatures.handleLoja(mockSock, `${testPhone}@s.whatsapp.net`, testPhone, 'Cliente Teste');
  assert(sentSockMsg && sentSockMsg.payload.text.includes('ACOMPANHE SEUS PEDIDOS'), 'Deve incluir bloco de acompanhamento quando cliente possui pedidos');
  assert(sentSockMsg.payload.text.includes('!pedido'), 'Deve instruir o comando !pedido');
  console.log('  ✅ PASS: !loja exibiu vitrine com bloco inteligente de pedidos do cliente');

  // ==========================================
  // BLOCO 6: ROTAS REST DO SIMSIMI & LOJA
  // ==========================================
  console.log('\n--- TESTE 6: Endpoints REST do SimSimi e Store Orders ---');
  const app = createServer();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/simi/config
    const resCfg = await fetch(`${baseUrl}/api/simi/config`);
    const dataCfg = await resCfg.json();
    assert.strictEqual(dataCfg.success, true);
    assert(typeof dataCfg.enabled === 'boolean');
    console.log('  ✅ PASS: GET /api/simi/config retornou:', dataCfg);

    // 2. POST /api/simi/config
    const resUpdateCfg = await fetch(`${baseUrl}/api/simi/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, mode: 'always_groups', personality: 'vendedor' })
    });
    const dataUpdateCfg = await resUpdateCfg.json();
    assert.strictEqual(dataUpdateCfg.success, true);
    assert.strictEqual(dataUpdateCfg.config.personality, 'vendedor');
    console.log('  ✅ PASS: POST /api/simi/config atualizou configurações');

    // 3. POST /api/simi/toggle-chat
    const resToggle = await fetch(`${baseUrl}/api/simi/toggle-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatJid: '12036300112233@g.us', active: true, chatName: 'Grupo Vendas Tech' })
    });
    const dataToggle = await resToggle.json();
    assert.strictEqual(dataToggle.success, true);
    assert.strictEqual(dataToggle.active, true);
    console.log('  ✅ PASS: POST /api/simi/toggle-chat ativou grupo');

    // 4. GET /api/simi/chats
    const resChats = await fetch(`${baseUrl}/api/simi/chats`);
    const dataChats = await resChats.json();
    assert.strictEqual(dataChats.success, true);
    assert(Array.isArray(dataChats.chats) && dataChats.chats.length > 0);
    console.log(`  ✅ PASS: GET /api/simi/chats listou ${dataChats.chats.length} chat(s)`);

    // 5. POST /api/simi/test (Playground do Painel Web)
    const resTest = await fetch(`${baseUrl}/api/simi/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'oi simi, manda um salve', personality: 'classico' })
    });
    const dataTest = await resTest.json();
    assert.strictEqual(dataTest.success, true);
    assert(dataTest.reply && dataTest.reply.length > 2);
    console.log('  ✅ PASS: POST /api/simi/test respondeu no playground:', dataTest.reply);

    // 6. GET /api/store/orders?phone=...
    const resStoreOrders = await fetch(`${baseUrl}/api/store/orders?phone=${testPhone}`);
    const dataStoreOrders = await resStoreOrders.json();
    assert.strictEqual(dataStoreOrders.success, true);
    assert(dataStoreOrders.count > 0, 'Deve encontrar pedidos pela API pública da loja');
    assert.strictEqual(dataStoreOrders.orders[0].merchant_trade_no, tradeNo);
    console.log(`  ✅ PASS: GET /api/store/orders retornou ${dataStoreOrders.count} pedido(s) da vitrine web`);

    // 7. GET /api/store/orders?tradeNo=...
    const resStoreTrade = await fetch(`${baseUrl}/api/store/orders?tradeNo=${tradeNo}`);
    const dataStoreTrade = await resStoreTrade.json();
    assert.strictEqual(dataStoreTrade.success, true);
    assert.strictEqual(dataStoreTrade.orders[0].status, 'PAID');
    assert.strictEqual(dataStoreTrade.orders[0].delivered_content, 'CHAVE-LICENCA-TESTE-VIP-9999');
    console.log('  ✅ PASS: GET /api/store/orders?tradeNo localizou pedido específico com conteúdo entregue');

  } finally {
    server.close();
  }

  // ==========================================
  // BLOCO 7: MASTER HANDLER (!simi & !pedido)
  // ==========================================
  console.log('\n--- TESTE 7: Integração no Master Handler Gata Nina ---');
  const simiCmd = handler.commands.get('simi');
  assert(simiCmd, 'Comando simi deve estar registrado no handler');
  assert(simiCmd.command.includes('simi') && simiCmd.command.includes('simsimi'), 'Deve ter aliases simi e simsimi');
  console.log('  ✅ PASS: Comando !simi registrado no Master Handler');

  const pedidoCmd = handler.commands.get('pedido');
  assert(pedidoCmd, 'Comando pedido deve estar registrado no handler');
  assert(pedidoCmd.command.includes('pedido') && pedidoCmd.command.includes('meuspedidos') && pedidoCmd.command.includes('rastrear'), 'Deve ter aliases pedido, meuspedidos, rastrear');
  console.log('  ✅ PASS: Comando !pedido registrado no Master Handler');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DO SIMSIMI E ACOMPANHAMENTO PASSARAM COM 100% DE SUCESSO!');
  console.log('======================================================');
}

runTests().then(() => {
  process.exitCode = 0;
}).catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exitCode = 1;
});

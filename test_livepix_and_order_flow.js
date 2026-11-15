const assert = require('assert');
const models = require('./src/db/models');
const pixPayment = require('./src/services/pixPayment');
const whatsappBot = require('./src/bots/whatsappBot');

async function runTests() {
  console.log('🧪 Iniciando testes de integração: LivePix como PIX padrão e fluxo WhatsApp...');

  // 1. Testa priorização do LivePix no pixPayment
  const settings = pixPayment.getSettings();
  console.log('  ⚙️ Configurações Pix atuais:', {
    isLivepixEnabled: settings.isLivepixEnabled,
    primaryProvider: settings.primaryProvider,
    livepixUser: settings.livepixUser
  });
  assert.strictEqual(settings.isLivepixEnabled, true, 'Livepix deve estar habilitado por padrão');
  assert.strictEqual(settings.primaryProvider, 'livepix', 'Provedor primário deve ser livepix');

  // Cria cobrança PIX via pixPayment
  const testTradeNo = `ORD_TEST_${Date.now()}`;
  const pixRes = await pixPayment.createPixCharge({
    merchantTradeNo: testTradeNo,
    amount: 25.50,
    goodsName: 'Produto Teste LivePix',
    payerName: 'Cliente Teste'
  });

  console.log('  💸 Resultado createPixCharge:', {
    success: pixRes.success,
    gateway: pixRes.gateway,
    isLivepix: pixRes.isLivepix,
    checkoutUrl: pixRes.checkoutUrl
  });
  assert.strictEqual(pixRes.success, true, 'Cobrança pix deve retornar sucesso');
  assert.strictEqual(pixRes.gateway, 'livepix', 'Gateway retornado deve ser livepix');
  assert.strictEqual(pixRes.isLivepix, true, 'isLivepix deve ser true');
  assert.ok(pixRes.checkoutUrl && pixRes.checkoutUrl.includes('livepix.gg'), 'checkoutUrl deve apontar para LivePix');

  // 2. Cria ordem no banco de dados para testar bot do WhatsApp
  const products = models.getProducts();
  const prod = products[0] || { id: 1, name: 'Produto Teste Vitrine' };

  const testOrderTradeNo = `ORD_WEB_${Date.now()}_TEST`;
  const order = models.createOrder({
    merchant_trade_no: testOrderTradeNo,
    product_id: prod.id,
    platform: 'web',
    platform_user_id: 'web_guest',
    platform_user_name: 'Marcos Silva',
    gateway: 'livepix',
    amount: 35.00,
    currency: 'BRL',
    status: 'PENDING',
    checkout_url: `https://livepix.gg/luizaa/35.00?comment=${testOrderTradeNo}`,
    pix_code: '00020126360014BR.GOV.BCB.PIX0114+554899999999520400005303986540535.005802BR5912Marcos Silva6009Sao Paulo62070503***6304ABCD'
  });
  console.log(`  📦 Ordem criada para teste: #${order.merchant_trade_no} (Produto: ${order.product_name})`);

  // 3. Simula mensagens enviadas pelo bot WhatsApp
  const sentMessages = [];
  const reactions = [];
  const mockSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, text: content.text || content });
      return { key: { id: 'msg_' + Date.now() } };
    }
  };

  // Mock seguro para safeReact e sendMessage do whatsappBot
  whatsappBot.safeReact = async (sock, jid, key, emoji) => {
    reactions.push({ jid, emoji });
    return true;
  };
  whatsappBot.sendMessage = async (jid, text, options = {}, customSock = null) => {
    sentMessages.push({ jid, text });
    return { key: { id: 'msg_' + Date.now() } };
  };

  const clientJid = '5511999887766@s.whatsapp.net';
  const clientName = 'Marcos Silva';
  const clientPhone = '5511999887766';

  // 4. Teste: Cliente envia o enunciado rápido vindo da loja web
  const incomingQuickText = `Olá! Gostaria de atendimento sobre o meu pedido #${testOrderTradeNo}`;
  const handledInquiry = await whatsappBot.handleStoreOrderInquiry(
    mockSock,
    clientJid,
    testOrderTradeNo,
    clientName,
    clientPhone,
    incomingQuickText,
    { key: { id: 'incoming_1' } }
  );

  assert.strictEqual(handledInquiry, true, 'handleStoreOrderInquiry deve retornar true');
  assert.strictEqual(reactions.length, 1, 'Deve reagir com emoji na mensagem');
  assert.strictEqual(reactions[0].emoji, '📦', 'Emoji de reação deve ser 📦');

  const initialResponse = sentMessages[sentMessages.length - 1];
  console.log('\n  💬 Resposta do Bot ao enunciado rápido:\n' + initialResponse.text + '\n');
  assert.ok(initialResponse.text.includes(testOrderTradeNo), 'Resposta deve conter o código do pedido');
  assert.ok(initialResponse.text.includes('Localizei seu pedido'), 'Resposta deve confirmar que localizou o pedido');
  assert.ok(initialResponse.text.includes('1️⃣'), 'Resposta deve conter opção 1');
  assert.ok(initialResponse.text.includes('2️⃣'), 'Resposta deve conter opção 2');
  assert.ok(initialResponse.text.includes('3️⃣'), 'Resposta deve conter opção 3');
  assert.ok(initialResponse.text.includes('4️⃣'), 'Resposta deve conter opção 4');

  // Verifica se o WhatsApp JID foi associado ao pedido
  const updatedOrder = models.getOrderByTradeNo(testOrderTradeNo);
  assert.strictEqual(updatedOrder.platform, 'whatsapp', 'Plataforma deve ser atualizada para whatsapp');
  assert.strictEqual(updatedOrder.platform_user_id, clientJid, 'JID do cliente deve ser registrado');

  // 5. Teste: Cliente responde "1" (Pagamento / LivePix)
  sentMessages.length = 0;
  const handledOption1 = await whatsappBot.handleOrderMenuOption(mockSock, clientJid, '1', clientName, clientPhone);
  assert.strictEqual(handledOption1, true, 'handleOrderMenuOption 1 deve retornar true');
  console.log('  💬 Resposta Opção 1 (Pagamento):\n' + sentMessages.map(m => m.text).join('\n---\n') + '\n');
  assert.ok(sentMessages.some(m => m.text.includes('LIVEPIX') || m.text.includes('LivePix')), 'Deve informar pagamento LivePix');
  assert.ok(sentMessages.some(m => m.text.includes(testOrderTradeNo)), 'Deve conter número do pedido');

  // 6. Teste: Cliente responde "2" (Entrega) enquanto pendente
  sentMessages.length = 0;
  const handledOption2Pending = await whatsappBot.handleOrderMenuOption(mockSock, clientJid, '2', clientName, clientPhone);
  assert.strictEqual(handledOption2Pending, true, 'handleOrderMenuOption 2 deve retornar true');
  console.log('  💬 Resposta Opção 2 (Entrega Pendente):\n' + sentMessages[0].text + '\n');
  assert.ok(sentMessages[0].text.includes('AGUARDANDO PAGAMENTO'), 'Deve avisar que está aguardando pagamento');

  // 7. Teste: Cliente responde "3" (Detalhes do Produto)
  sentMessages.length = 0;
  const handledOption3 = await whatsappBot.handleOrderMenuOption(mockSock, clientJid, '3', clientName, clientPhone);
  assert.strictEqual(handledOption3, true, 'handleOrderMenuOption 3 deve retornar true');
  console.log('  💬 Resposta Opção 3 (Detalhes do Produto):\n' + sentMessages[0].text + '\n');
  assert.ok(sentMessages[0].text.includes('DETALHES DO PRODUTO'), 'Deve conter cabeçalho de detalhes');
  assert.ok(sentMessages[0].text.includes(order.product_name), 'Deve conter o nome do produto');

  // 8. Teste: Cliente responde "4" (Suporte Humano)
  sentMessages.length = 0;
  const handledOption4 = await whatsappBot.handleOrderMenuOption(mockSock, clientJid, '4', clientName, clientPhone);
  assert.strictEqual(handledOption4, true, 'handleOrderMenuOption 4 deve retornar true');
  console.log('  💬 Resposta Opção 4 (Suporte Humano):\n' + sentMessages.map(m => m.text).join('\n---\n') + '\n');
  assert.ok(sentMessages.some(m => m.text.includes('Atendimento Humano Solicitado')), 'Deve confirmar solicitação humana ao cliente');

  // 9. Teste: Ordem Paga e Opção 2 entrega de conteúdo
  models.updateOrderStatus(testOrderTradeNo, 'PAID');
  models.updateOrderDetails(testOrderTradeNo, { delivered_content: 'CHAVE-LICENCA-XYZ-123456' });

  sentMessages.length = 0;
  const handledOption2Paid = await whatsappBot.handleOrderMenuOption(mockSock, clientJid, '2', clientName, clientPhone);
  assert.strictEqual(handledOption2Paid, true);
  console.log('  💬 Resposta Opção 2 (Entrega Paga e Liberada):\n' + sentMessages[0].text + '\n');
  assert.ok(sentMessages[0].text.includes('CHAVE-LICENCA-XYZ-123456'), 'Deve entregar o conteúdo da licença');

  console.log('✅ TODOS OS TESTES PASSARAM COM SUCESSO! 🎉');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

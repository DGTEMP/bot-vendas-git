/**
 * Test Suite: Verificação do Pacote de Novas Funções & Melhorias
 */

const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Iniciando testes do Pacote de Novas Funções & Melhorias...\n');

  const spyFeatures = require('./src/services/spyFeaturesService');
  const models = require('./src/db/models');
  const whatsappBot = require('./src/bots/whatsappBot');
  const { createServer } = require('./src/server/app');

  const mockGroupMetadata = {
    id: '12036302485938@g.us',
    subject: 'Comunidade VIP E-commerce',
    participants: [
      { id: '5511988881111@s.whatsapp.net' }, // SP (11)
      { id: '5511977772222@s.whatsapp.net' }, // SP (11)
      { id: '5511966663333@s.whatsapp.net' }, // SP (11)
      { id: '5521955554444@s.whatsapp.net' }, // RJ (21)
      { id: '5548984702848@s.whatsapp.net' }, // SC (48)
      { id: '151866151276711@lid' },          // LID Dono -> SC (48)
      { id: '14155552671@s.whatsapp.net' }    // Internacional (EUA +1)
    ]
  };

  // ==========================================
  // TESTE 1: !dddlist / !censo (Raio-X Demográfico do Grupo)
  // ==========================================
  console.log('--- TESTE 1: !dddlist / !censo (Raio-X Demográfico do Grupo) ---');
  let sentCenso = null;
  const mockSock = {
    groupMetadata: async () => mockGroupMetadata,
    sendMessage: async (to, content) => {
      sentCenso = { to, content };
      return true;
    }
  };

  await spyFeatures.handleDDDList(mockSock, '12036302485938@g.us', mockGroupMetadata);
  assert(sentCenso, 'Deve responder ao comando !dddlist');
  assert(sentCenso.content.text.includes('CENSO DEMOGRÁFICO DO GRUPO'), 'Deve conter cabeçalho do censo');
  assert(sentCenso.content.text.includes('Total de Membros:* 7'), 'Total de membros analisados deve ser 7');
  assert(sentCenso.content.text.includes('DDD 11 (SP)'), 'Top ranking deve conter DDD 11');
  assert(sentCenso.content.text.includes('Internacionais / Outros:* 1'), 'Deve detectar 1 membro internacional');
  console.log('✅ Teste 1 passou: Censo demográfico do grupo gerado com precisão e ranking.');

  // ==========================================
  // TESTE 2: !sorteioddd (Sorteio Exclusivo Regional por DDD)
  // ==========================================
  console.log('\n--- TESTE 2: !sorteioddd (Sorteio Regional por DDD) ---');
  let sentSorteio = null;
  mockSock.sendMessage = async (to, content) => {
    sentSorteio = { to, content };
    return true;
  };

  // Tenta executar sem ser admin
  await spyFeatures.handleSorteioDDD(mockSock, '12036302485938@g.us', '!sorteioddd 11', mockGroupMetadata, false);
  assert(sentSorteio.content.text.includes('Apenas Administradores'), 'Deve barrar não-admins');

  // Executa como admin
  await spyFeatures.handleSorteioDDD(mockSock, '12036302485938@g.us', '!sorteioddd 11', mockGroupMetadata, true);
  assert(sentSorteio.content.text.includes('RESULTADO DO SORTEIO REGIONAL (DDD 11)'), 'Deve anunciar sorteio do DDD 11');
  assert(sentSorteio.content.text.includes('PARABÉNS AOS GANHADORES'), 'Deve conter seção de parabéns');
  assert(Array.isArray(sentSorteio.content.mentions) && sentSorteio.content.mentions.length === 1, 'Deve marcar 1 vencedor nos mentions');
  const winnerJid = sentSorteio.content.mentions[0];
  assert(winnerJid.startsWith('5511'), 'Vencedor sorteado deve pertencer obrigatoriamente ao DDD 11');
  console.log('✅ Teste 2 passou: Sorteio regional por DDD escolheu e marcou participante do DDD 11.');

  // ==========================================
  // TESTE 3: !cobranca / !pix (Geração Rápida de Pix pelo WhatsApp)
  // ==========================================
  console.log('\n--- TESTE 3: !cobranca / !pix no WhatsApp ---');
  let sentCobranca = null;
  mockSock.sendMessage = async (to, content) => {
    sentCobranca = { to, content };
    return true;
  };

  await spyFeatures.handleWhatsAppCobranca(mockSock, '5511999990001@s.whatsapp.net', '!pix 79.90 Roberto', null, true, '554884702848', 'Dono');
  assert(sentCobranca, 'Deve responder com dados da cobrança');
  assert(sentCobranca.content.text.includes('COBRANÇA PIX INSTANTÂNEA GERADA'), 'Deve conter cabeçalho');
  assert(sentCobranca.content.text.includes('R$ 79.90'), 'Deve conter o valor exato');
  assert(sentCobranca.content.text.includes('Código PIX Copia e Cola'), 'Deve conter o bloco de Pix Copia e Cola');
  console.log('✅ Teste 3 passou: Cobrança Pix instantânea gerada com sucesso via comando WhatsApp.');

  // ==========================================
  // TESTE 4: !tarefas (Status da Fila e Saúde do Bot para o Dono)
  // ==========================================
  console.log('\n--- TESTE 4: !tarefas / !statusfila no WhatsApp ---');
  let sentTarefas = null;
  mockSock.sendMessage = async (to, content) => {
    sentTarefas = { to, content };
    return true;
  };

  await spyFeatures.handleTarefasStatus(mockSock, '554884702848@s.whatsapp.net', true);
  assert(sentTarefas, 'Deve responder status para o dono');
  assert(sentTarefas.content.text.includes('CENTRAL DE CONTROLE & STATUS'), 'Deve conter painel executivo');
  assert(sentTarefas.content.text.includes('Instâncias WhatsApp'), 'Deve conter saúde dos chips');
  assert(sentTarefas.content.text.includes('Fila de Automação'), 'Deve conter fila de tarefas');
  console.log('✅ Teste 4 passou: Comando !tarefas retornou status de telemetria para o Dono.');

  // ==========================================
  // TESTE 5: !cupom (Criação de Cupom Promocional via WhatsApp)
  // ==========================================
  console.log('\n--- TESTE 5: !cupom no WhatsApp ---');
  let sentCupom = null;
  mockSock.sendMessage = async (to, content) => {
    sentCupom = { to, content };
    return true;
  };

  const testCouponCode = `TESTEVIP_${Date.now()}`;
  await spyFeatures.handleCriarCupomWhatsApp(mockSock, '554884702848@s.whatsapp.net', `!cupom ${testCouponCode} 25 30`, true);
  assert(sentCupom, 'Deve responder confirmação de cupom');
  assert(sentCupom.content.text.includes(testCouponCode), 'Deve conter o código do cupom');
  assert(sentCupom.content.text.includes('25% OFF'), 'Deve conter percentual de desconto');
  const savedCupom = models.getCouponByCode(testCouponCode);
  assert(savedCupom, 'Cupom deve ser persistido no banco de dados');
  assert.strictEqual(savedCupom.discount_percent, 25);
  console.log('✅ Teste 5 passou: Cupom promocional criado diretamente pelo chat do WhatsApp.');

  // ==========================================
  // TESTE 6: Reconhecimento Automático de Comprovante Pix
  // ==========================================
  console.log('\n--- TESTE 6: Reconhecimento de Comprovante de Pagamento ---');
  const testTradeNo = `ORD_COMPROV_${Date.now()}`;
  models.createOrder({
    merchant_trade_no: testTradeNo,
    platform: 'whatsapp',
    platform_user_id: '5511999994321@s.whatsapp.net',
    platform_user_name: 'Lead Comprovante',
    product_id: 1,
    product_name: 'Produto Teste',
    amount: 147.00,
    currency: 'BRL',
    status: 'PENDING'
  });

  let sentReceiptAck = null;
  const mockMsgAck = {
    key: { remoteJid: '5511999994321@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Segue o comprovante do pix que acabei de pagar!' }
  };

  const origSendMessage = whatsappBot.sendMessage;
  whatsappBot.sendMessage = async (to, text, opts) => {
    sentReceiptAck = { to, text };
    return true;
  };

  await whatsappBot.handleIncomingMessage(mockMsgAck, mockSock);
  whatsappBot.sendMessage = origSendMessage;

  assert(sentReceiptAck, 'Deve reconhecer e responder ao comprovante');
  assert(sentReceiptAck.text.includes(testTradeNo), 'Deve citar o número do pedido pendente');
  assert(sentReceiptAck.text.includes('147.00'), 'Deve citar o valor do pedido');
  console.log('✅ Teste 6 passou: Comprovante de pagamento reconhecido e associado ao pedido pendente.');

  // ==========================================
  // TESTE 7: Endpoints REST (Prévia TTS, Demografia DDD e Cobrança 1-Clique)
  // ==========================================
  console.log('\n--- TESTE 7: Endpoints REST (Prévia TTS, Demografia e Disparo de Cobrança) ---');
  const app = createServer();
  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 7.1 Prévia de Áudio TTS
  const previewRes = await (await fetch(`${baseUrl}/api/tts/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Olá! Teste de áudio no navegador', lang: 'pt' })
  })).json();

  assert.strictEqual(previewRes.success, true);
  assert(previewRes.audioBase64.startsWith('data:audio/mp3;base64,'), 'Deve retornar base64 do áudio');
  console.log('  ✅ 7.1 Prévia TTS para o navegador funcionando');

  // 7.2 Demografia de DDDs
  const demoRes = await (await fetch(`${baseUrl}/api/demographics/ddd-stats`)).json();
  assert.strictEqual(demoRes.success, true);
  assert(demoRes.totalContacts >= 0);
  assert(Array.isArray(demoRes.topDDDs), 'Deve retornar array de topDDDs');
  console.log('  ✅ 7.2 Demografia e estatísticas de DDDs retornando dados consolidados');

  // 7.3 Disparo de Cobrança 1-Clique para Pedido
  const chargeRes = await (await fetch(`${baseUrl}/api/orders/${testTradeNo}/send-charge`, {
    method: 'POST'
  })).json();

  assert.strictEqual(chargeRes.success, true);
  assert.strictEqual(chargeRes.tradeNo, testTradeNo);
  assert(chargeRes.phone.includes('5511999994321'));
  console.log('  ✅ 7.3 Cobrança e lembrete de 1 clique disparados para o WhatsApp do cliente');

  server.close();
  console.log('\n🎉 TODOS OS 7 TESTES DO PACOTE DE MELHORIAS PASSARAM COM 100% DE SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

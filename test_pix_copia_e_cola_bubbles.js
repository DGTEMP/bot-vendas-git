/**
 * test_pix_copia_e_cola_bubbles.js
 * Valida se o Pix Copia e Cola é enviado em uma caixa de diálogo 100% separada e sem menção a LivePix
 */

const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');
const spyFeaturesService = require('./src/services/spyFeaturesService');

async function testPixBubbleSeparation() {
  console.log('🧪 Iniciando testes de Caixa de Diálogo Separada do Pix Copia e Cola...');

  const mockPixCode = '00020101021226830014BR.GOV.BCB.PIX2561qrcodes-pix.seubanco.com.br/v2/cobv/test1234567895204000053039865802BR5915TESTE PAGAMENTO6009SAO PAULO62070503***6304ABCD';
  const targetPhone = '5511999998888';

  // TESTE 1: webStoreTrackerService.notifyOrderPlaced
  console.log('\n--- Teste 1: webStoreTrackerService.notifyOrderPlaced ---');
  const capturedWebTrackerMsgs = [];
  const originalSend = whatsappBot.sendMessage;
  whatsappBot.sendMessage = async (to, content, opts, sock) => {
    capturedWebTrackerMsgs.push({ to, content, text: typeof content === 'string' ? content : content?.text || content?.caption || '' });
    return { key: { id: 'msg_' + Date.now() } };
  };

  await webStoreTrackerService.notifyOrderPlaced({
    tradeNo: 'ORD_TEST_BUBBLE_01',
    customerName: 'Cliente Teste',
    customerPhone: targetPhone,
    items: [{ id: 1, name: 'Produto Digital', totalBRL: 29.90, quantity: 1 }],
    finalBRL: 29.90,
    gateway: 'livepix',
    pixCode: mockPixCode
  });

  console.log(`Mensagens capturadas no notifyOrderPlaced: ${capturedWebTrackerMsgs.length}`);
  capturedWebTrackerMsgs.forEach((m, idx) => {
    console.log(`[Msg ${idx + 1}]: ${typeof m.content === 'string' ? m.content.slice(0, 70) + '...' : (m.content?.image ? '[Imagem QR Code]' : JSON.stringify(m.content))}`);
  });

  // Validação: deve ter enviado pelo menos 4 mensagens
  assert(capturedWebTrackerMsgs.length >= 4, 'Deveria ter enviado pelo menos 4 mensagens (fatura, qr, aviso, código, confirmação)');
  
  // Validação: uma das mensagens DEVE ser ESTRITAMENTE o código puro
  const isolatedCodeMsg = capturedWebTrackerMsgs.find(m => typeof m.content === 'string' && m.content.trim() === mockPixCode.trim());
  assert(isolatedCodeMsg, 'DEVE existir uma mensagem contendo RIGOROSAMENTE APENAS o código Pix Copia e Cola!');
  console.log('✅ [PASS] Mensagem isolada com Pix Copia e Cola puro encontrada no Web Store Tracker!');

  // Validação: nenhuma mensagem de cliente pode conter 'livepix'
  capturedWebTrackerMsgs.forEach((m, idx) => {
    assert(!m.text.toLowerCase().includes('livepix'), `Mensagem ${idx + 1} não deve conter a palavra "livepix"! Conteúdo: ${m.text}`);
  });
  console.log('✅ [PASS] Nenhuma mensagem do Web Store Tracker contém menção a "livepix"!');

  // TESTE 2: whatsappBot.processPixPurchase
  console.log('\n--- Teste 2: whatsappBot.processPixPurchase ---');
  const capturedWppBotMsgs = [];
  whatsappBot.sendMessage = async (to, content, opts, sock) => {
    capturedWppBotMsgs.push({ to, content, text: typeof content === 'string' ? content : content?.text || content?.caption || '' });
    return { key: { id: 'msg_' + Date.now() } };
  };

  // Mock do pixPayment.createPixCharge para simular retorno livepix com o código
  const pixPayment = require('./src/services/pixPayment');
  const originalCreatePix = pixPayment.createPixCharge;
  pixPayment.createPixCharge = async () => ({
    success: true,
    isLivepix: true,
    isDynamicLivepix: true,
    gateway: 'livepix',
    pixCode: mockPixCode,
    data: {
      pixCode: mockPixCode,
      checkoutUrl: 'https://checkout.livepix.gg/mock123'
    }
  });

  const existingProducts = models.getProducts();
  const mockProduct = existingProducts && existingProducts.length > 0 ? existingProducts[0] : {
    id: 1,
    name: 'Pack VIP Telegram',
    price_brl: 49.90,
    price: 49.90
  };

  await whatsappBot.processPixPurchase(`${targetPhone}@s.whatsapp.net`, 'Cliente WhatsApp', mockProduct, true);

  console.log(`Mensagens capturadas no processPixPurchase: ${capturedWppBotMsgs.length}`);
  capturedWppBotMsgs.forEach((m, idx) => {
    console.log(`[Msg ${idx + 1}]: ${typeof m.content === 'string' ? m.content.slice(0, 70) + '...' : (m.content?.image ? '[Imagem QR Code]' : JSON.stringify(m.content))}`);
  });

  const isolatedWppCodeMsg = capturedWppBotMsgs.find(m => typeof m.content === 'string' && m.content.trim() === mockPixCode.trim());
  assert(isolatedWppCodeMsg, 'DEVE existir uma mensagem no processPixPurchase contendo RIGOROSAMENTE APENAS o código Pix Copia e Cola puro!');
  console.log('✅ [PASS] Mensagem isolada com Pix Copia e Cola puro encontrada no processPixPurchase!');

  capturedWppBotMsgs.forEach((m, idx) => {
    assert(!m.text.toLowerCase().includes('livepix'), `Mensagem ${idx + 1} não deve conter a palavra "livepix"! Conteúdo: ${m.text}`);
  });
  console.log('✅ [PASS] Nenhuma mensagem do processPixPurchase contém menção a "livepix"!');

  // TESTE 3: spyFeaturesService.handleWhatsAppCobranca
  console.log('\n--- Teste 3: spyFeaturesService.handleWhatsAppCobranca ---');
  const capturedSpyMsgs = [];
  const mockSpySock = {
    sendMessage: async (to, msg) => {
      capturedSpyMsgs.push({ to, ...msg, textStr: msg.text || msg.caption || '' });
      return true;
    }
  };

  await spyFeaturesService.handleWhatsAppCobranca(mockSpySock, `${targetPhone}@s.whatsapp.net`, '!pix 50.00', null, true);

  console.log(`Mensagens capturadas no handleWhatsAppCobranca: ${capturedSpyMsgs.length}`);
  capturedSpyMsgs.forEach((m, idx) => {
    console.log(`[Msg ${idx + 1}]: ${m.textStr.slice(0, 70)}...`);
  });

  const isolatedSpyCodeMsg = capturedSpyMsgs.find(m => m.textStr && m.textStr.trim() === mockPixCode.trim());
  assert(isolatedSpyCodeMsg, 'DEVE existir uma mensagem no handleWhatsAppCobranca contendo RIGOROSAMENTE APENAS o código Pix Copia e Cola puro!');
  console.log('✅ [PASS] Mensagem isolada com Pix Copia e Cola puro encontrada no handleWhatsAppCobranca!');

  // A primeira mensagem não deve conter o código gigante poluindo a legenda
  assert(!capturedSpyMsgs[0].textStr.includes('```' + mockPixCode + '```'), 'A primeira mensagem (fatura/legenda) NÃO deve conter o código embutido poluindo o texto');
  console.log('✅ [PASS] A fatura/legenda não contém o código gigante embutido!');

  capturedSpyMsgs.forEach((m, idx) => {
    assert(!m.textStr.toLowerCase().includes('livepix'), `Mensagem ${idx + 1} de cobrança não deve conter a palavra "livepix"! Conteúdo: ${m.textStr}`);
  });
  console.log('✅ [PASS] Nenhuma mensagem de cobrança contém menção a "livepix"!');

  // Restaura funções originais
  whatsappBot.sendMessage = originalSend;
  pixPayment.createPixCharge = originalCreatePix;

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO! A separação da caixa de diálogo e o scrub da marca LivePix estão 100% validados.');
}

testPixBubbleSeparation().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

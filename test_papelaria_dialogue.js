const assert = require('assert');
const models = require('./src/db/models');
const cognitiveService = require('./src/services/cognitiveSalesService');
const nlpService = require('./src/services/nlpService');
const whatsappBot = require('./src/bots/whatsappBot');

async function runPapelariaTest() {
  console.log('🚀 [TESTE ESPECÍFICO] Verificando Diálogo da Papelaria e Correção de Erros de Produto...\n');

  const testPhone = '5511999998877';
  const testName = 'Cliente Papelaria';

  // Limpa estados prévios
  const db = require('./src/db/database');
  db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_beliefs WHERE lead_phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_episodic_memories WHERE lead_phone = ?').run(testPhone);

  // ==============================================================
  // TURNO 1: Acolhimento
  // ==============================================================
  console.log('--- TURNO 1: Saudação inicial ---');
  const t1User = 'Oi';
  cognitiveService.analyzeAndExtractProfile(testPhone, testName, t1User);
  const nlp1 = await nlpService.processMessage({ text: t1User, customerName: testName, platform: 'whatsapp' });
  const reply1 = await cognitiveService.generateConsultativeReply({
    phone: testPhone,
    name: testName,
    text: t1User,
    nlpResult: nlp1,
    matchedProduct: nlp1.entities?.matchedProduct
  });

  console.log('Cliente:', t1User);
  console.log('Bot:\n' + reply1 + '\n');
  assert(!reply1.toLowerCase().includes('trader'), 'Bot não pode falar de trader');
  assert(!reply1.toLowerCase().includes('scalper'), 'Bot não pode falar de scalper');
  assert(!reply1.toLowerCase().includes('como posso te ajudar'), 'Bot não pode soar robótico');

  // ==============================================================
  // TURNO 2: Cliente apresenta seu negócio de papelaria com entregas rápidas
  // ==============================================================
  console.log('--- TURNO 2: Apresentação da Papelaria com Entrega Rápida ---');
  const t2User = 'Conta mais, eu tenho uma papelaria que faz entregas super rápido, pede hoje, amanhã chega';
  const profile2 = cognitiveService.analyzeAndExtractProfile(testPhone, testName, t2User);
  
  console.log('Perfil detectado:', {
    niche: profile2.company_niche,
    stage: profile2.buying_stage
  });
  assert.strictEqual(profile2.company_niche, 'Papelaria & Material de Escritório', 'Nicho deve ser Papelaria & Material de Escritório');

  const beliefs2 = models.getLeadBeliefs(testPhone);
  const hasDelivery = beliefs2.some(b => b.belief_key === 'delivery_model');
  console.log('Crença de entrega rápida detectada:', hasDelivery);
  assert(hasDelivery, 'Deve ter detectado o modelo de entrega rápida');

  const nlp2 = await nlpService.processMessage({ text: t2User, customerName: testName, platform: 'whatsapp' });
  console.log('Produto casado pelo NLP:', nlp2.entities?.matchedProduct?.name || 'Nenhum');
  assert(!nlp2.entities?.matchedProduct || !/scalper|cripto|trader|freio/i.test(nlp2.entities.matchedProduct.name), 'NLP não pode casar Scalper/Trader para papelaria');

  const reply2 = await cognitiveService.generateConsultativeReply({
    phone: testPhone,
    name: testName,
    text: t2User,
    nlpResult: nlp2,
    matchedProduct: nlp2.entities?.matchedProduct
  });

  console.log('Cliente:', t2User);
  console.log('Bot:\n' + reply2 + '\n');

  assert(!reply2.toLowerCase().includes('trader'), 'Bot não pode citar trader');
  assert(!reply2.toLowerCase().includes('scalper'), 'Bot não pode citar scalper');
  assert(
    reply2.toLowerCase().includes('papelaria') || reply2.toLowerCase().includes('material') || reply2.toLowerCase().includes('entrega'),
    'Bot deve contextualizar a papelaria ou entregas'
  );

  // ==============================================================
  // TURNO 3: Cliente pede uma solução pra papelaria
  // ==============================================================
  console.log('--- TURNO 3: Solução para a Papelaria ---');
  const t3User = 'Queria uma solução pra minha papelaria';
  cognitiveService.analyzeAndExtractProfile(testPhone, testName, t3User);
  const nlp3 = await nlpService.processMessage({ text: t3User, customerName: testName, platform: 'whatsapp' });
  const reply3 = await cognitiveService.generateConsultativeReply({
    phone: testPhone,
    name: testName,
    text: t3User,
    nlpResult: nlp3,
    matchedProduct: nlp3.entities?.matchedProduct
  });

  console.log('Cliente:', t3User);
  console.log('Bot:\n' + reply3 + '\n');
  assert(!reply3.toLowerCase().includes('trader'), 'Bot não pode citar trader');
  assert(!reply3.toLowerCase().includes('scalper'), 'Bot não pode citar scalper');
  assert(reply3.toLowerCase().includes('497') || reply3.toLowerCase().includes('bot'), 'Bot deve apresentar a solução oficial do bot');

  // ==============================================================
  // TURNO 4: Simulação de Correção Enfática
  // ==============================================================
  console.log('--- TURNO 4: Teste de Correção Enfática do Lead ---');
  const t4User = 'não tem nada a ver com método trader, eu disse que tenho uma papelaria';
  cognitiveService.analyzeAndExtractProfile(testPhone, testName, t4User);
  const nlp4 = await nlpService.processMessage({ text: t4User, customerName: testName, platform: 'whatsapp' });
  const reply4 = await cognitiveService.generateConsultativeReply({
    phone: testPhone,
    name: testName,
    text: t4User,
    nlpResult: nlp4,
    matchedProduct: nlp4.entities?.matchedProduct
  });

  console.log('Cliente:', t4User);
  console.log('Bot:\n' + reply4 + '\n');
  assert(reply4.toLowerCase().includes('viajei') || reply4.toLowerCase().includes('desculpa'), 'Bot deve pedir desculpas de forma natural e humana');
  assert(reply4.toLowerCase().includes('papelaria'), 'Bot deve reafirmar que entendeu que é uma papelaria');
  assert(!reply4.toLowerCase().includes('compre o método trader'), 'Bot não pode insistir no produto errado');

  // Limpa após teste
  db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_beliefs WHERE lead_phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_episodic_memories WHERE lead_phone = ?').run(testPhone);

  console.log('🎉 TODOS OS TESTES DE DIÁLOGO DA PAPELARIA PASSARAM COM SUCESSO 100%!');
}

runPapelariaTest().catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

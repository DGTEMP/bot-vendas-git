const assert = require('assert');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const nlpService = require('./src/services/nlpService');
const models = require('./src/db/models');

async function runTest() {
  console.log('🧪 Iniciando teste do fluxo multi-turno relatado pelo usuário...');

  const testPhone = '5511999990001';
  const customerName = 'Lucas';

  // Limpa memórias anteriores
  try {
    models.deleteCognitiveLead(testPhone);
  } catch (_) {}

  // Turno 1: Cliente pergunta preço
  console.log('\n--- TURNO 1: Cliente pergunta preço ---');
  const msg1 = 'quanto custa o bot de vendas?';
  const nlp1 = await nlpService.processMessage(msg1, { senderPhone: testPhone, senderName: customerName });
  console.log(`Intenção T1: ${nlp1.intent} (${nlp1.confidence})`);

  const reply1 = await cognitiveSalesService.generateConsultativeReply({
    phone: testPhone,
    customerName,
    message: msg1,
    isGroup: false,
    targetId: 1
  });
  console.log('🤖 Resposta Turno 1:\n' + reply1);

  assert(
    reply1.includes('69') ||
    reply1.includes('sessenta e nove') ||
    reply1.includes('497') ||
    reply1.includes('quatrocentos') ||
    reply1.includes('R$'),
    'Deve conter valores dos planos'
  );
  const askedQuestionsT1 = cognitiveSalesService.getRecentQuestionsAsked(testPhone);
  console.log('Perguntas registradas no histórico após T1:', askedQuestionsT1);

  // Turno 2: Cliente escolhe o plano: "o mensal"
  console.log('\n--- TURNO 2: Cliente escolhe: "o mensal" ---');
  const msg2 = 'o mensal';
  const nlp2 = await nlpService.processMessage(msg2, { senderPhone: testPhone, senderName: customerName });
  console.log(`Intenção T2: ${nlp2.intent} (${nlp2.confidence}) | DirectAction: ${nlp2.directAction}`);

  assert.strictEqual(nlp2.intent, 'PLAN_SELECTION', 'Deve classificar como PLAN_SELECTION');
  assert(nlp2.entities && nlp2.entities.selectedProduct, 'Deve identificar produto selecionado');
  console.log(`Produto identificado: ${nlp2.entities.selectedProduct.name} - R$ ${nlp2.entities.selectedProduct.price}`);

  const reply2 = await cognitiveSalesService.generateConsultativeReply({
    phone: testPhone,
    customerName,
    message: msg2,
    isGroup: false,
    targetId: 1
  });
  console.log('🤖 Resposta Turno 2:\n' + reply2);

  assert(!reply2.includes('o que você tá precisando resolver no momento? É automação'), 'NÃO PODE repetir a pergunta genérica de diagnóstico!');
  assert(reply2.includes('69') || reply2.includes('sessenta e nove'), 'Deve confirmar o valor do plano mensal R$ 69,90');
  assert(reply2.toLowerCase().includes('pix') || reply2.toLowerCase().includes('código'), 'Deve oferecer o Pix ou fechamento');

  // Turno 3: Cliente confirma: "sim pode mandar"
  console.log('\n--- TURNO 3: Cliente confirma: "sim pode mandar" ---');
  const msg3 = 'sim pode mandar';
  const nlp3 = await nlpService.processMessage(msg3, { senderPhone: testPhone, senderName: customerName });
  console.log(`Intenção T3: ${nlp3.intent} (${nlp3.confidence}) | DirectAction: ${nlp3.directAction}`);

  assert.strictEqual(nlp3.intent, 'AFFIRMATIVE_CONFIRMATION', 'Deve classificar como AFFIRMATIVE_CONFIRMATION');
  assert.strictEqual(nlp3.directAction, 'TRIGGER_PIX', 'DirectAction deve ser TRIGGER_PIX');

  const reply3 = await cognitiveSalesService.generateConsultativeReply({
    phone: testPhone,
    customerName,
    message: msg3,
    isGroup: false,
    targetId: 1
  });
  console.log('🤖 Resposta Turno 3:\n' + reply3);

  assert(!reply3.includes('o que você tá precisando resolver no momento?'), 'NÃO PODE repetir pergunta diagnóstica!');
  assert(!reply3.includes('já tem operação ou tá montando'), 'NÃO PODE reiniciar qualificação!');
  assert(reply3.toLowerCase().includes('pix') || reply3.toLowerCase().includes('gerando') || reply3.toLowerCase().includes('maravilha'), 'Deve confirmar a geração imediata do Pix');

  // Turno 4: Verificação de Anti-Repetição (se o cliente disser "papelaria")
  console.log('\n--- TURNO 4: Cliente responde nicho: "papelaria" ---');
  const msg4 = 'papelaria';
  const reply4 = await cognitiveSalesService.generateConsultativeReply({
    phone: testPhone,
    customerName,
    message: msg4,
    isGroup: false,
    targetId: 1
  });
  console.log('🤖 Resposta Turno 4:\n' + reply4);
  assert(
    reply4.toLowerCase().includes('papelaria') ||
    reply4.toLowerCase().includes('atendimento') ||
    reply4.toLowerCase().includes('automação'),
    'Deve entender e contextualizar a necessidade'
  );
  assert(!reply4.includes('o que você tá precisando resolver no momento?'), 'Não pode cair no looping de pergunta!');

  console.log('\n✅ TODOS OS TESTES DO FLUXO MULTI-TURNO PASSARAM COM SUCESSO! SEM REPETIÇÃO E COM ENTENDIMENTO CONTEXTUAL COMPLETO!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

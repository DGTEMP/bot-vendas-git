const assert = require('assert');
const knowledgeBase = require('./src/services/knowledgeBaseService');
const cognitiveSales = require('./src/services/cognitiveSalesService');

console.log('====================================================');
console.log('🧪 TESTE: INTEGRAÇÃO DA BASE DE CONHECIMENTO NO BOT');
console.log('====================================================');

// 1. Validação de Carregamento e Estatísticas do Catálogo
const stats = knowledgeBase.getStats();
console.log(`📚 Livros e Obras Detectadas: ${stats.totalBooks}`);
console.log(`💾 Volume Total de Conhecimento: ${stats.totalMb} MB`);
console.log(`📂 Diretório Indexado: ${stats.baseFolder}`);
assert.strictEqual(stats.totalBooks >= 60, true, 'Deve conter mais de 60 obras indexadas na pasta base-conhecimento');
assert.strictEqual(stats.status, 'READY', 'Status da base de conhecimento deve ser READY');
console.log('✅ [PASS] Catálogo de Obras Indexado com Sucesso!');

// 2. Busca por Autores-Chave da Biblioteca
const hormoziBooks = knowledgeBase.searchBooks('Hormozi');
console.log(`🔍 Obras de Alex Hormozi encontradas: ${hormoziBooks.length}`);
assert.strictEqual(hormoziBooks.length >= 2, true, 'Deve encontrar livros de Alex Hormozi');

const vossBooks = knowledgeBase.searchBooks('Voss');
console.log(`🔍 Obras de Chris Voss encontradas: ${vossBooks.length}`);
assert.strictEqual(vossBooks.length >= 1, true, 'Deve encontrar obras de Chris Voss');

const cialdiniBooks = knowledgeBase.searchBooks('Cialdini');
console.log(`🔍 Obras de Robert Cialdini encontradas: ${cialdiniBooks.length}`);
assert.strictEqual(cialdiniBooks.length >= 1, true, 'Deve encontrar obras de Cialdini');
console.log('✅ [PASS] Busca Semântica e Indexação de Autores Funcionando!');

// 3. Validação do Playbook Contextual de Objeção de Preço
const pricePlaybook = knowledgeBase.getContextualPlaybook({
  text: 'Achei o valor meio caro, tem desconto?',
  objection: 'PRECO',
  intent: 'PRICE_QUERY'
});
console.log('\n--- Playbook Gerado para Objeção de Preço ---');
console.log(pricePlaybook.trim());
assert.strictEqual(pricePlaybook.includes('Alex Hormozi'), true, 'Deve citar ancoragem e equação de valor de Hormozi');
assert.strictEqual(pricePlaybook.includes('Chris Voss'), true, 'Deve citar técnica de negociação de Chris Voss');
console.log('✅ [PASS] Playbook de Preço / Hormozi Gerado Corretamente!');

// 4. Validação do Playbook de Desconfiança e Garantia
const trustPlaybook = knowledgeBase.getContextualPlaybook({
  text: 'Como eu sei que isso não é golpe? Vocês devolvem o dinheiro se não funcionar?',
  objection: 'CONFIANCA_GARANTIA',
  intent: 'TRUST_AND_GUARANTEE'
});
console.log('\n--- Playbook Gerado para Desconfiança / Garantia ---');
console.log(trustPlaybook.trim());
assert.strictEqual(trustPlaybook.includes('Risk Reversal'), true, 'Deve conter reversão de risco');
assert.strictEqual(trustPlaybook.includes('7 dias de garantia incondicional'), true, 'Deve conter menção de garantia incondicional');
console.log('✅ [PASS] Playbook de Confiança / Garantia Validado!');

// 5. Validação do Playbook para Contato Inicial / Curioso (SPIN & Consciência)
const curiosityPlaybook = knowledgeBase.getContextualPlaybook({
  text: 'Olá, como funciona esse bot de vendas?',
  stage: 'CONSCIENCIA',
  intent: 'HOW_IT_WORKS'
});
console.log('\n--- Playbook Gerado para Início de Conversa (SPIN / Schwartz) ---');
console.log(curiosityPlaybook.trim());
assert.strictEqual(curiosityPlaybook.includes('Neil Rackham (SPIN)'), true, 'Deve ativar metodologia SPIN Selling');
console.log('✅ [PASS] Playbook Consultivo SPIN Validado!');

// 6. Teste de Injeção no Cognitive Sales Service
console.log('\n--- Teste de Geração Cognitiva com Base de Conhecimento Ativa ---');
const dummyLead = '5511999990001';
const reply = cognitiveSales.generateConsultativeReply({
  instanceId: 1,
  phone: dummyLead,
  name: 'Carlos',
  text: 'Tenho uma papelaria e recebo muita mensagem fora de hora, mas achei 497 meio puxado pro momento',
  nlpResult: { intent: 'PRICE_QUERY' }
});

reply.then(res => {
  console.log('Resposta Gerada pelo Bot:');
  console.log(res);
  assert.strictEqual(typeof res === 'string' && res.length > 10, true, 'Deve gerar uma resposta válida e humanizada');
  console.log('\n====================================================');
  console.log('🎉 TODOS OS TESTES DA BASE DE CONHECIMENTO PASSARAM!');
  console.log('====================================================');
}).catch(err => {
  console.error('❌ Erro no teste assíncrono:', err);
  process.exitCode = 1;
});

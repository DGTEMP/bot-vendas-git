const assert = require('assert');
const nlpService = require('./src/services/nlpService');
const cognitiveService = require('./src/services/cognitiveSalesService');
const kbService = require('./src/services/knowledgeBaseService');
const models = require('./src/db/models');

console.log('🧪 Iniciando testes de validação: Tratamento de Desinteresse / Recusa do Lead...\n');

// 1. Classificação NLP de Desinteresse
const disinterestPhrases = [
  'não quero esse produto',
  'não tenho interesse',
  'não quero',
  'não preciso de bot',
  'não vou comprar',
  'obrigado mas não quero',
  'valeu mas não tenho interesse',
  'pra mim não serve',
  'não quero comprar nada',
  'tô de boa, valeu'
];

for (const phrase of disinterestPhrases) {
  const norm = nlpService.normalizeText(phrase);
  const { intent } = nlpService.classifyIntent(norm);
  assert.strictEqual(intent, 'DISINTEREST', `Frase "${phrase}" deveria ser classificada como DISINTEREST, mas foi "${intent}"`);
}
console.log('✅ Teste 1: Todas as variações de recusa/desinteresse foram classificadas como DISINTEREST pelo NLP');

// 2. Extração de Entidades não vincula produto quando cliente recusa
const entResult = nlpService.extractEntities(
  nlpService.normalizeText('não quero esse bot de vendas, valeu'),
  'não quero esse bot de vendas, valeu',
  models.getProducts(true)
);
assert.strictEqual(entResult.matchedProduct, null, 'Não deve vincular produto quando cliente expressa recusa');
console.log('✅ Teste 2: Produto NÃO é associado como desejo de compra quando o lead diz que não quer');

// 3. ProcessMessage do NLP responde cordialmente
(async () => {
  const nlpReply = await nlpService.processMessage({
    text: 'não tenho interesse, obrigado',
    customerName: 'Carlos'
  });
  assert.strictEqual(nlpReply.intent, 'DISINTEREST');
  assert.strictEqual(nlpReply.directAction, 'HANDLE_DISINTEREST');
  assert(nlpReply.replyText.toLowerCase().includes('entendido perfeitamente'), 'Deve acolher com educação');
  assert(nlpReply.replyText.toLowerCase().includes('sem problemas'), 'Deve acolher sem pressão');
  assert(!nlpReply.replyText.toLowerCase().includes('pix'), 'NÃO deve mandar Pix');
  assert(!nlpReply.replyText.toLowerCase().includes('r$'), 'NÃO deve empurrar valores');
  console.log('✅ Teste 3: ProcessMessage do NLP responde cordialmente desarmando a venda');

  // 4. Perfil Cognitivo: atualização para PERDIDO e readiness 0
  const testPhone = '5511999990001';
  // Cria perfil inicial em qualificação
  models.upsertLeadCognitiveProfile(testPhone, {
    name: 'Carlos Teste',
    company_niche: 'Papelaria',
    buying_stage: 'QUALIFICACAO',
    readiness_score: 60
  });

  const updatedProf = cognitiveService.analyzeAndExtractProfile(testPhone, 'Carlos Teste', 'olha, agradeço mas não quero esse produto, não tenho interesse');
  assert.strictEqual(updatedProf.buying_stage, 'PERDIDO', 'buying_stage deve ser PERDIDO');
  assert.strictEqual(updatedProf.readiness_score, 0, 'readiness_score deve ser zerado');
  assert.strictEqual(updatedProf.main_objection, 'SEM_INTERESSE', 'main_objection deve ser SEM_INTERESSE');
  console.log('✅ Teste 4: analyzeAndExtractProfile registra PERDIDO, zera readiness e registra SEM_INTERESSE');

  // 5. Follow-ups pendentes ignoram lead PERDIDO
  const pendingFollowups = models.getLeadsPendingFollowup(50);
  const foundInFollowup = pendingFollowups.some(l => l.phone === testPhone);
  assert.strictEqual(foundInFollowup, false, 'Lead marcado como PERDIDO nunca deve constar na lista de follow-up pendente');
  console.log('✅ Teste 5: getLeadsPendingFollowup exclui leads que recusaram o produto');

  // 6. Resposta Heurística de Fallback desarmada
  const heuristicReply = cognitiveService.generateHeuristicConsultativeReply({
    profile: updatedProf,
    firstName: 'Carlos',
    text: 'não vou querer o bot, obrigado',
    nlpResult: { intent: 'DISINTEREST' }
  });
  assert(heuristicReply.toLowerCase().includes('entendido perfeitamente'), 'Deve responder cordialmente');
  assert(heuristicReply.toLowerCase().includes('sem problemas'), 'Deve aceitar sem forçar');
  assert(!heuristicReply.toLowerCase().includes('o bot pra você é perfeito'), 'NÃO deve tentar empurrar o bot');
  assert(!heuristicReply.toLowerCase().includes('pix'), 'NÃO deve mandar Pix');
  console.log('✅ Teste 6: Fallback heurístico aceita o "não" com elegância e sem forçar o produto');

  // 7. Base de Conhecimento RAG injeta respeito ao NÃO e não injeta loops de fechamento forçado
  const playbook = kbService.getContextualPlaybook({
    text: 'não tenho interesse no produto',
    stage: 'PERDIDO',
    objection: 'SEM_INTERESSE',
    intent: 'DISINTEREST'
  });
  assert(playbook.includes('RESPEITO AO "NÃO"'), 'Playbook deve incluir respeito ao NÃO');
  assert(!playbook.includes('LOOPING DE FECHAMENTO'), 'Playbook NÃO deve incluir looping agressivo de fechamento');
  assert(!playbook.includes('NÃO PERDER A VENDA'), 'Playbook NÃO deve forçar não perder a venda');
  console.log('✅ Teste 7: Knowledge Base orienta desqualificação elegante e bloqueia loops de fechamento agressivo');

  // Limpeza
  models.deleteCognitiveLead(testPhone);

  console.log('\n🎉 TODOS OS 7 TESTES DE TRATAMENTO DE DESINTERESSE PASSARAM COM SUCESSO!\n');
})();

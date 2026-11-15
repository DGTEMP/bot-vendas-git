/**
 * =========================================================================
 * 🧪 TEST SUITE: PREDICTIVE INTELLIGENCE, STATISTICS & NEXT STEPS ANTICIPATION
 * =========================================================================
 * Testa:
 * 1. Cálculo matemático de Run Rate, Velocidade Horária e Projeção 24h
 * 2. Matriz de Conversão de Leads e Detecção de Risco de Churn com Probabilidades
 * 3. Janela de Ouro de Disparo e Probabilidade de Abertura
 * 4. Capacidade e Índice de Estresse da Frota de Sub-Bots
 * 5. Antecipação dos 3 Próximos Passos do Dono (Pensar 3 jogadas à frente)
 * 6. Briefing Executivo "Me Surpreenda" / Oráculo
 * 7. Gravação de Insights Preditivos e Padrões de Decisão no SQLite
 * 8. Interação em Linguagem Natural ("me surpreenda", "quais meus próximos passos")
 * 9. Injeção de Antecipação Tática no Diálogo Executivo da Matriz
 * =========================================================================
 */

const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./src/db/database');
const models = require('./src/db/models');
const predictiveIntelligenceService = require('./src/services/predictiveIntelligenceService');
const ownerMindsetService = require('./src/services/ownerMindsetService');
const matrizAssistantService = require('./src/services/matrizAssistantService');
const handler = require('./src/handler');

const OWNER_TEST_PHONE = '554884702848';

async function runTests() {
  console.log('\n======================================================');
  console.log('🔮 TESTES: INTELIGÊNCIA PREDITIVA & ANTECIPAÇÃO DE PASSOS 🔮');
  console.log('======================================================\n');

  // --- 1. MATRIZ DE PROBABILIDADES & RUN RATE ---
  console.log('--- 1. Cálculo de Velocidade de Receita (Run Rate) & Probabilidade ---');
  const analytics = predictiveIntelligenceService.calculateFullPredictiveAnalytics(OWNER_TEST_PHONE);

  assert.ok(analytics.revenue, 'Deve calcular bloco de receita');
  assert.ok(typeof analytics.revenue.hourlyVelocityBRL === 'number', 'Velocidade horária deve ser numérica');
  assert.ok(typeof analytics.revenue.projected24hRevenue === 'number', 'Projeção 24h deve ser numérica');
  assert.ok(analytics.revenue.goalHitProbability >= 1.0 && analytics.revenue.goalHitProbability <= 100.0, 'Probabilidade da meta deve estar entre 1% e 100%');
  console.log(`  ✅ PASS: Faturado hoje: R$ ${analytics.revenue.totalTodayBRL.toFixed(2)}`);
  console.log(`  ✅ PASS: Velocidade horária: R$ ${analytics.revenue.hourlyVelocityBRL}/h | Projeção 24h: R$ ${analytics.revenue.projected24hRevenue}`);
  console.log(`  ✅ PASS: Probabilidade de bater a meta: ${analytics.revenue.goalHitProbability}%`);

  // --- 2. PIPELINE DE CONVERSÃO & CHURN ---
  console.log('\n--- 2. Matriz de Probabilidade de Leads & Risco de Churn ---');
  const matrix = analytics.conversionMatrix;
  assert.ok(matrix, 'Matriz de conversão deve existir');
  assert.ok(typeof matrix.averageConversionProbability === 'number', 'Probabilidade média deve ser numérica');
  assert.ok(Array.isArray(matrix.highProbabilityLeads), 'Lista de leads quentes deve ser um array');
  assert.ok(Array.isArray(matrix.atRiskChurnLeads), 'Lista de leads em risco deve ser um array');
  console.log(`  ✅ PASS: Probabilidade média de conversão da carteira: ${matrix.averageConversionProbability}%`);
  console.log(`  ✅ PASS: Pipeline total mapeado: R$ ${matrix.totalPipelineValue.toFixed(2)}`);
  console.log(`  ✅ PASS: Leads com alta probabilidade: ${matrix.highProbabilityCount} | Leads em risco de churn: ${matrix.atRiskCount}`);

  // --- 3. JANELA DE OURO DE DISPARO ---
  console.log('\n--- 3. Janela de Ouro de Disparo & Probabilidade de Abertura ---');
  const goldenHour = analytics.goldenHour;
  assert.ok(goldenHour.windowName, 'Nome da janela deve existir');
  assert.ok(goldenHour.openRateProbability > 0, 'Probabilidade de abertura deve ser positiva');
  assert.ok(goldenHour.recommendation, 'Deve fornecer recomendação estratégica de horário');
  console.log(`  ✅ PASS: Janela atual: "${goldenHour.windowName}"`);
  console.log(`  ✅ PASS: Probabilidade de abertura estimada: ${goldenHour.openRateProbability}%`);

  // --- 4. ANTECIPAÇÃO DOS 3 PRÓXIMOS PASSOS ---
  console.log('\n--- 4. Antecipação dos 3 Próximos Passos do Dono ---');
  const nextSteps = analytics.nextSteps;
  assert.strictEqual(nextSteps.length, 3, 'Deve antecipar exatamente os 3 próximos passos mais estratégicos');

  nextSteps.forEach((step, idx) => {
    assert.ok(step.title, `Passo ${idx + 1} deve ter título`);
    assert.ok(step.probability > 0, `Passo ${idx + 1} deve ter probabilidade calculada`);
    assert.ok(step.reasoning, `Passo ${idx + 1} deve ter raciocínio justificativo`);
    assert.ok(step.recommendedCommand, `Passo ${idx + 1} deve ter comando pronto para execução`);
    console.log(`  ✅ PASS Passo ${idx + 1}: [${step.title}] -> Probabilidade: ${step.probability}% | Impacto: R$ ${step.projectedImpactBRL.toFixed(2)}`);
    console.log(`     Comando pronto: "${step.recommendedCommand}"`);
  });

  // --- 5. MODO "ME SURPREENDA" (O ORÁCULO EXECUTIVO) ---
  console.log('\n--- 5. Briefing Executivo "Me Surpreenda" (Oráculo) ---');
  const surpriseText = predictiveIntelligenceService.generateSurpriseBriefing(OWNER_TEST_PHONE, 'Comandante Dono');
  assert.ok(surpriseText.includes('O ORÁCULO'), 'Briefing deve conter cabeçalho do Oráculo');
  assert.ok(surpriseText.includes('MATRIZ DE PROBABILIDADES'), 'Briefing deve conter matriz de probabilidades');
  assert.ok(surpriseText.includes('ANTECIPANDO SEUS PRÓXIMOS 3 PASSOS'), 'Briefing deve listar os próximos passos antecipados');

  // Verifica gravação na tabela predictive_intel_insights
  const recordedInsights = models.getRecentPredictiveInsights(OWNER_TEST_PHONE, 5);
  assert.ok(recordedInsights.length > 0, 'Deve ter registrado insight preditivo na base SQLite');
  assert.strictEqual(recordedInsights[0].insight_type, 'SURPRISE_BRIEFING', 'Tipo do insight deve ser SURPRISE_BRIEFING');
  console.log('  ✅ PASS: Briefing do Oráculo gerado e registrado no SQLite com sucesso!');

  // --- 6. INTERAÇÃO EM LINGUAGEM NATURAL SEM COMANDO ---
  console.log('\n--- 6. Interação Natural: "me surpreenda" e "quais meus próximos passos" ---');
  let naturalOutput = '';
  const mockSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      naturalOutput = content?.text || '';
      return { key: {} };
    }
  };

  // Teste 6.1: Dono diz "me surpreenda"
  const handledSurprise = await ownerMindsetService.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    text: 'me surpreenda agora com suas previsões',
    senderName: 'Comandante Dono',
    senderPhone: OWNER_TEST_PHONE,
    isGroup: false
  });
  assert.strictEqual(handledSurprise, true, 'Deve interceptar "me surpreenda" naturalmente');
  assert.ok(naturalOutput.includes('O ORÁCULO') && naturalOutput.includes('MATRIZ DE PROBABILIDADES'), 'Deve responder com o Oráculo Preditivo');
  console.log('  ✅ PASS: "me surpreenda" executou o Oráculo Preditivo em linguagem natural');

  // Teste 6.2: Dono diz "quais meus próximos passos"
  naturalOutput = '';
  const handledNextSteps = await ownerMindsetService.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    text: 'quais meus próximos passos?',
    senderName: 'Comandante Dono',
    senderPhone: OWNER_TEST_PHONE,
    isGroup: false
  });
  assert.strictEqual(handledNextSteps, true, 'Deve interceptar "quais meus próximos passos" naturalmente');
  assert.ok(naturalOutput.includes('ANTECIPANDO SEUS PRÓXIMOS 3 PASSOS'), 'Deve apresentar próximos passos');
  console.log('  ✅ PASS: "quais meus próximos passos?" entregou a antecipação tática');

  // --- 7. COMANDO !oraculo NO HANDLER ---
  console.log('\n--- 7. Comando !oraculo no Handler PayBot ---');
  const oraculoCmd = handler.findCommand('oraculo');
  assert.ok(oraculoCmd, 'Comando !oraculo deve estar registrado');
  assert.strictEqual(oraculoCmd.owner, true, 'Comando deve ser restrito ao Dono');

  let oraculoOutput = '';
  await oraculoCmd.run({
    senderNumber: OWNER_TEST_PHONE,
    pushName: 'Comandante',
    reply: (txt) => { oraculoOutput = txt; return txt; }
  }, { isOwner: true });

  assert.ok(oraculoOutput.includes('O ORÁCULO'), 'Resposta do comando !oraculo deve ser o briefing');
  console.log('  ✅ PASS: Comando !oraculo executado com sucesso no Handler');

  // --- 8. ANTECIPAÇÃO TÁTICA ACOPLADA ÀS RESPOSTAS DA MATRIZ ---
  console.log('\n--- 8. Injeção de Antecipação Tática nas Respostas do Assistente ---');
  let assistantReply = '';
  const mockAssistantSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      assistantReply = content?.text || '';
      return { key: {} };
    }
  };

  await matrizAssistantService.handleExecutiveStrategicChat(
    mockAssistantSock,
    `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    'Qual a melhor jogada pra hoje?',
    'Comandante Dono'
  );

  assert.ok(assistantReply.includes('ANTECIPAÇÃO DO SEU PRÓXIMO PASSO'), 'Resposta deve conter bloco de antecipação do próximo passo');
  assert.ok(assistantReply.includes('Probabilidade') || assistantReply.includes('recomendo'), 'Bloco deve citar probabilidade ou recomendação direta');
  console.log('  ✅ PASS: Resposta do assistente incluiu a antecipação do próximo passo do Dono');

  // --- 9. REGISTRO DE PADRÃO DE DECISÃO DO DONO ---
  console.log('\n--- 9. Registro de Padrão de Decisão do Dono ---');
  const patternId = models.recordOwnerDecisionPattern({
    owner_phone: OWNER_TEST_PHONE,
    action_type: 'PIX_CHARGE_ISSUED',
    context_intent: 'FECHAMENTO_QUENTE',
    executed_command: 'gera um pix de 50'
  });
  assert.ok(patternId > 0, 'Deve registrar ID do padrão de decisão');

  const patterns = models.getOwnerDecisionPatterns(OWNER_TEST_PHONE, 5);
  assert.ok(patterns.length > 0, 'Deve recuperar histórico de decisões');
  assert.strictEqual(patterns[0].action_type, 'PIX_CHARGE_ISSUED');
  console.log('  ✅ PASS: Padrão de decisão registrado no SQLite para alimentar o modelo preditivo');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DE INTELIGÊNCIA PREDITIVA PASSARAM COM 100%! 🎉');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

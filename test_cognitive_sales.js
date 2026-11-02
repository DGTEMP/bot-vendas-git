/**
 * test_cognitive_sales.js
 * Bateria de testes para o Módulo de Vendas Consultivas & Memória Episódica Hexis
 */

const assert = require('assert');
const models = require('./src/db/models');
const cognitiveService = require('./src/services/cognitiveSalesService');
const { createServer } = require('./src/server/app');

process.env.NODE_ENV = 'test';

const testResults = [];
function recordTest(id, name, success, details = '') {
  testResults.push({ id, name, success, details });
  const icon = success ? '✅' : '❌';
  console.log(`${icon} [TESTE ${id}] ${name}`);
  if (details) console.log(`   └─ Detalhes: ${details}`);
}

async function run() {
  console.log('====================================================');
  console.log('🧠 INICIANDO TESTES DO MÓDULO COGNITIVO & HEXIS SALES');
  console.log('====================================================\n');

  const testPhone = '5511999997788';

  // 1. Motor de Humanização (Anti-AI Voice)
  try {
    const rawAiText = 'Com certeza, amigo! Hoje é o seu dia de sorte! Maravilha! Sensacional! Temos a melhor solução para sua empresa!!! 🚀🚀🚀🚀🔥🎉';
    const humanized = cognitiveService.humanizeResponse(rawAiText);
    assert(!humanized.toLowerCase().includes('com certeza'), 'Deve remover "com certeza"');
    assert(!humanized.toLowerCase().includes('seu dia de sorte'), 'Deve remover clichê de sorte');
    assert(!humanized.toLowerCase().includes('maravilha'), 'Deve remover "maravilha"');
    assert(!humanized.toLowerCase().includes('sensacional'), 'Deve remover "sensacional"');
    assert(!humanized.includes('!!!'), 'Deve reduzir exclamações repetidas');
    assert(humanized.length > 5, 'Deve manter o corpo da mensagem');
    recordTest(1, 'Motor de Humanização (Anti-AI Voice)', true, `Clichês removidos com sucesso. Resultado: "${humanized}"`);
  } catch (err) {
    recordTest(1, 'Motor de Humanização (Anti-AI Voice)', false, err.message);
  }

  // 2. Extração Cognitiva: Nicho, Escopo, Orçamento e Objeções
  try {
    const msg = 'Olá, tenho uma imobiliária e preciso de um app mobile com painel web para corretores. Tenho orçamento de 4500 reais mas meu prazo é urgente pra antes do fim do mês.';
    const prof = cognitiveService.analyzeAndExtractProfile(testPhone, 'Rogério Imóveis', msg);

    assert.strictEqual(prof.phone, testPhone);
    assert.strictEqual(prof.company_niche, 'Imobiliário & Construção');
    assert(prof.project_scope.includes('Aplicativo Mobile') || prof.project_scope.includes('Painel Web'));
    assert.strictEqual(prof.budget_tier, 'MEDIO');
    assert.strictEqual(prof.main_objection, 'PRAZO');
    assert(prof.readiness_score >= 50);

    const beliefs = models.getLeadBeliefs(testPhone);
    assert(beliefs.some(b => b.belief_key === 'lead_budget'), 'Deve registrar crença de orçamento');
    assert(beliefs.some(b => b.belief_key === 'main_objection'), 'Deve registrar crença de objeção');

    const memories = models.getLeadEpisodicMemories(testPhone, 10);
    assert(memories.length >= 2, 'Deve registrar memórias episódicas');
    recordTest(2, 'Extração Cognitiva & Scoring Heurístico', true, `Nicho: ${prof.company_niche} | Objeção: ${prof.main_objection} | Score: ${prof.readiness_score}%`);
  } catch (err) {
    recordTest(2, 'Extração Cognitiva & Scoring Heurístico', false, err.message);
  }

  // 3. Atualização e Consulta de Crenças Baseadas em Evidências
  try {
    models.updateLeadBelief(testPhone, 'tech_stack_req', 'Node.js + PostgreSQL', 'Exigiu backend robusto com PostgreSQL', 0.95);
    const beliefs = models.getLeadBeliefs(testPhone);
    const stackBelief = beliefs.find(b => b.belief_key === 'tech_stack_req');
    assert(stackBelief, 'Crença deve existir');
    assert.strictEqual(stackBelief.belief_value, 'Node.js + PostgreSQL');
    assert.strictEqual(stackBelief.confidence, 0.95);
    recordTest(3, 'Crenças Baseadas em Evidências (Evidence-Based)', true, 'Crença atualizada com evidência e índice de confiança');
  } catch (err) {
    recordTest(3, 'Crenças Baseadas em Evidências (Evidence-Based)', false, err.message);
  }

  // 4. Registro e Consulta de Memória Episódica
  try {
    models.addLeadEpisodicMemory(testPhone, 'QUOTE', 'Proposta enviada: R$ 4.500 em 2x com entrega em 12 dias', 'Fechamos em 4.5k em 2x', 5);
    const memories = models.getLeadEpisodicMemories(testPhone, 5);
    const quoteMem = memories.find(m => m.memory_type === 'QUOTE');
    assert(quoteMem, 'Memória de proposta deve existir');
    assert(quoteMem.fact_summary.includes('R$ 4.500'));
    recordTest(4, 'Memória Episódica do Lead (Histórico Sem Amnésia)', true, 'Fatos episódicos persistidos e recuperados');
  } catch (err) {
    recordTest(4, 'Memória Episódica do Lead (Histórico Sem Amnésia)', false, err.message);
  }

  // 5. Playbook Consultivo & Geração de Resposta sem Robô
  try {
    const reply = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Rogério Imóveis',
      text: 'E sobre aquele prazo que a gente conversou, consegue adiantar?'
    });
    assert(typeof reply === 'string' && reply.length > 20);
    assert(reply.toLowerCase().includes('cronograma') || reply.toLowerCase().includes('sprint') || reply.toLowerCase().includes('prazo'));
    assert(!reply.toLowerCase().includes('com certeza'));
    recordTest(5, 'Playbook Consultivo de Resposta', true, `Resposta gerada: "${reply.slice(0, 80)}..."`);
  } catch (err) {
    recordTest(5, 'Playbook Consultivo de Resposta', false, err.message);
  }

  // 6. Heartbeat Autônomo de Follow-up ("Earning Attention")
  try {
    models.upsertLeadCognitiveProfile(testPhone, {
      buying_stage: 'PROPOSTA',
      next_followup_at: new Date(Date.now() - 60000).toISOString()
    });

    const hbResult = await cognitiveService.runAutonomousHeartbeat({ dryRun: false, limit: 10 });
    assert(hbResult.processed >= 1, 'Deve processar lead vencido');
    const processedLead = hbResult.results.find(r => r.phone === testPhone);
    assert(processedLead, 'Lead de teste deve ter sido processado');
    assert(processedLead.hookMessage && processedLead.hookMessage.length > 20, 'Deve conter gancho personalizado');
    assert(!processedLead.hookMessage.toLowerCase().includes('sumiu'), 'Nunca deve enviar spam vazio');
    recordTest(6, 'Heartbeat Autônomo de Follow-Up (Earning Attention)', true, `Gancho gerado: "${processedLead.hookMessage.slice(0, 90)}..."`);
  } catch (err) {
    recordTest(6, 'Heartbeat Autônomo de Follow-Up (Earning Attention)', false, err.message);
  }

  // 7. Endpoints REST da Central Cognitiva
  try {
    const app = createServer();
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    // Overview
    const resOverview = await fetch(`${baseUrl}/api/cognitive/overview`);
    const dataOverview = await resOverview.json();
    assert(dataOverview.success, 'Overview deve retornar sucesso');
    assert(dataOverview.total_leads >= 1, 'Deve conter leads');

    // Detalhe de Lead
    const resLead = await fetch(`${baseUrl}/api/cognitive/leads/${testPhone}`);
    const dataLead = await resLead.json();
    assert(dataLead.success, 'Detalhe deve retornar sucesso');
    assert.strictEqual(dataLead.profile.phone, testPhone);

    // Gerar Gancho via API
    const resHook = await fetch(`${baseUrl}/api/cognitive/leads/${testPhone}/hook`, { method: 'POST' });
    const dataHook = await resHook.json();
    assert(dataHook.success, 'Geração de gancho via API');
    assert(dataHook.hook && dataHook.hook.length > 10);

    // Ação Bot Deck: RUN_COGNITIVE_HEARTBEAT
    const resDeckHb = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RUN_COGNITIVE_HEARTBEAT', payload: {} })
    });
    const dataDeckHb = await resDeckHb.json();
    assert(dataDeckHb.success, 'Execução de Heartbeat no Bot Deck');

    // Ação Bot Deck: COGNITIVE_UPDATE_STAGE
    const resDeckStage = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'COGNITIVE_UPDATE_STAGE', payload: { phone: testPhone, stage: 'FECHAMENTO', readiness: 85 } })
    });
    const dataDeckStage = await resDeckStage.json();
    assert(dataDeckStage.success, 'Atualização de estágio no Bot Deck');

    server.close();
    recordTest(7, 'Endpoints REST & Ações Bot Deck', true, 'Todas as rotas /api/cognitive e ações botdeck responderam com sucesso');
  } catch (err) {
    recordTest(7, 'Endpoints REST & Ações Bot Deck', false, err.message);
  }

  // 8. Limpeza de Lead de Teste
  try {
    models.deleteCognitiveLead(testPhone);
    const deleted = models.getLeadCognitiveProfile(testPhone);
    assert(deleted === null, 'Lead deve ser removido após exclusão');
    recordTest(8, 'Exclusão Segura e Isolamento de Dados', true, 'Perfil cognitivo, crenças e memórias limpos com sucesso');
  } catch (err) {
    recordTest(8, 'Exclusão Segura e Isolamento de Dados', false, err.message);
  }

  console.log('\n====================================================');
  console.log('📊 RELATÓRIO FINAL DOS TESTES COGNITIVOS:');
  console.log('====================================================');
  console.log(`Total: ${testResults.length} | ✅ Sucesso: ${testResults.filter(t => t.success).length} | ❌ Falhas: ${testResults.filter(t => !t.success).length}`);
  console.log('====================================================\n');

  if (testResults.some(t => !t.success)) {
    process.exit(1);
  }
}

run().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});

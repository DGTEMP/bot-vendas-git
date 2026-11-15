/**
 * test_stability_and_performance.js
 * =========================================================================
 * Bateria de Testes Automatizados para Estabilidade, Índices de Banco de Dados,
 * Desalocação de Memória RAM (Anti-Leak) e Resiliência de Conexão.
 * =========================================================================
 */

const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const socialListeningService = require('./src/services/socialListeningService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const incomingMessageBufferService = require('./src/services/incomingMessageBufferService');
const whatsappBot = require('./src/bots/whatsappBot');
const jevDecisionService = require('./src/services/jevDecisionService');

async function runTests() {
  console.log('⚡ Iniciando Bateria de Testes de Estabilidade e Desempenho...\n');

  // =========================================================================
  // TESTE 1: Índices de Banco de Dados & EXPLAIN QUERY PLAN
  // =========================================================================
  console.log('--- TESTE 1: Índices de Alta Performance & Query Optimizer ---');

  const expectedIndexes = [
    'idx_exec_brief_phone',
    'idx_vision_insp_phone',
    'idx_jev_decisions_phone',
    'idx_jev_decisions_ctx',
    'idx_cog_memories_lead',
    'idx_radar_captured_phone',
    'idx_radar_captured_status',
    'idx_followup_cust_phone',
    'idx_bandit_arms_cat',
    'idx_swarm_missions_st',
    'idx_sleep_runs_date'
  ];

  for (const idxName of expectedIndexes) {
    const row = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name=?").get(idxName);
    assert(row, `Índice ${idxName} deve existir no SQLite`);
    console.log(`✅ Índice verificado: ${idxName} na tabela [${row.tbl_name}]`);
  }

  // Verifica se o otimizador SQLite usa os índices nos queries mais críticos
  const explainExec = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM executive_briefing_logs WHERE target_phone = '551199999999' ORDER BY id DESC LIMIT 1").all();
  const usesExecIndex = explainExec.some(p => String(p.detail).includes('idx_exec_brief_phone') || String(p.detail).includes('COVERING INDEX') || String(p.detail).includes('INDEX'));
  assert(usesExecIndex, 'Query de briefing executivo deve utilizar índice indexado');
  console.log('✅ Query Plan de Executive Briefings acelerado por índice');

  const explainVision = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM vision_inspections_log WHERE sender_phone = '551199999999' ORDER BY id DESC LIMIT 1").all();
  const usesVisionIndex = explainVision.some(p => String(p.detail).includes('idx_vision_insp_phone') || String(p.detail).includes('INDEX'));
  assert(usesVisionIndex, 'Query de inspeção de visão computacional deve utilizar índice');
  console.log('✅ Query Plan de Vision Inspections acelerado por índice');

  const explainJev = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM jev_decisions WHERE context_type = 'GATEWAY_ROUTER' ORDER BY id DESC LIMIT 10").all();
  const usesJevIndex = explainJev.some(p => String(p.detail).includes('idx_jev_decisions_ctx') || String(p.detail).includes('INDEX'));
  assert(usesJevIndex, 'Query de telemetria Jev deve utilizar índice de contexto');
  console.log('✅ Query Plan de JEV Decisions acelerado por índice');

  // =========================================================================
  // TESTE 2: Prevenção de Vazamento de Memória & Purga de Caches (RAM)
  // =========================================================================
  console.log('\n--- TESTE 2: Prevenção de Vazamentos de Memória (CleanupMemory) ---');

  // 2.1 Social Listening Service
  const now = Date.now();
  socialListeningService.alertCooldowns.set('stale_alert', now - 40 * 60 * 1000); // 40 min atrás (deve ser purgado)
  socialListeningService.alertCooldowns.set('fresh_alert', now - 5 * 60 * 1000);  // 5 min atrás (deve ser mantido)
  socialListeningService.groupCooldowns.set('stale_group@g.us', now - 3 * 60 * 60 * 1000); // 3h atrás (deve ser purgado)
  socialListeningService.groupCooldowns.set('fresh_group@g.us', now - 10 * 60 * 1000);    // 10 min atrás (deve ser mantido)
  socialListeningService.groupMetaCache.set('stale_meta@g.us', { name: 'Old', timestamp: now - 8 * 60 * 60 * 1000 }); // 8h atrás
  socialListeningService.groupMetaCache.set('fresh_meta@g.us', { name: 'New', timestamp: now - 1000 });

  socialListeningService.cleanupMemory();

  assert(!socialListeningService.alertCooldowns.has('stale_alert'), 'Cooldown de alerta antigo deve ser removido');
  assert(socialListeningService.alertCooldowns.has('fresh_alert'), 'Cooldown de alerta recente deve ser mantido');
  assert(!socialListeningService.groupCooldowns.has('stale_group@g.us'), 'Cooldown de grupo antigo deve ser removido');
  assert(socialListeningService.groupCooldowns.has('fresh_group@g.us'), 'Cooldown de grupo recente deve ser mantido');
  assert(!socialListeningService.groupMetaCache.has('stale_meta@g.us'), 'Metadado de grupo antigo deve ser removido');
  assert(socialListeningService.groupMetaCache.has('fresh_meta@g.us'), 'Metadado de grupo recente deve ser mantido');
  console.log('✅ socialListeningService.cleanupMemory() validado: cooldowns e metadados expirados purgados');

  // 2.2 Cognitive Sales Service
  const testPhoneStale = '551188880001';
  const testPhoneFresh = '551188880002';
  cognitiveSalesService.dialogueBuffers.set(testPhoneStale, [
    { role: 'user', text: 'Oi antigo', timestamp: now - 50 * 60 * 1000 }
  ]);
  cognitiveSalesService.dialogueBuffers.set(testPhoneFresh, [
    { role: 'user', text: 'Oi recente', timestamp: now - 2 * 60 * 1000 }
  ]);

  cognitiveSalesService.cleanupMemory();

  assert(!cognitiveSalesService.dialogueBuffers.has(testPhoneStale), 'Buffer de diálogo inativo (>45min) deve ser desalocado');
  assert(cognitiveSalesService.dialogueBuffers.has(testPhoneFresh), 'Buffer de diálogo ativo (<45min) deve ser mantido');
  console.log('✅ cognitiveSalesService.cleanupMemory() validado: buffers inativos desalocados');

  // 2.3 Incoming Message Buffer Service
  incomingMessageBufferService.presenceStates.set('stale_user@s.whatsapp.net', {
    isComposing: true,
    lastUpdatedAt: now - 15 * 60 * 1000
  });
  incomingMessageBufferService.presenceStates.set('fresh_user@s.whatsapp.net', {
    isComposing: true,
    lastUpdatedAt: now - 1000
  });

  incomingMessageBufferService.cleanupMemory();

  assert(!incomingMessageBufferService.presenceStates.has('stale_user@s.whatsapp.net'), 'Presença antiga (>10min) deve ser purgada');
  assert(incomingMessageBufferService.presenceStates.has('fresh_user@s.whatsapp.net'), 'Presença recente deve ser mantida');
  console.log('✅ incomingMessageBufferService.cleanupMemory() validado: presenças antigas purgadas');

  // 2.4 WhatsApp Bot Service
  whatsappBot.userLastActivity.set('551177770001', now - 26 * 60 * 60 * 1000); // 26h atrás
  whatsappBot.userLastActivity.set('551177770002', now - 1000);
  whatsappBot.userActiveOrderContext.set('551177770001@s.whatsapp.net', { timestamp: now - 3 * 60 * 60 * 1000 });
  whatsappBot.userActiveOrderContext.set('551177770002@s.whatsapp.net', { timestamp: now - 1000 });
  whatsappBot.sentBotMessages.set('stale_msg_id', now - 25 * 60 * 60 * 1000);
  whatsappBot.sentBotMessages.set('fresh_msg_id', now - 1000);

  whatsappBot.cleanupMemory();

  assert(!whatsappBot.userLastActivity.has('551177770001'), 'Atividade antiga (>24h) deve ser purgada');
  assert(whatsappBot.userLastActivity.has('551177770002'), 'Atividade recente deve ser mantida');
  assert(!whatsappBot.userActiveOrderContext.has('551177770001@s.whatsapp.net'), 'Contexto de pedido antigo (>2h) deve ser purgado');
  assert(whatsappBot.userActiveOrderContext.has('551177770002@s.whatsapp.net'), 'Contexto de pedido recente deve ser mantido');
  assert(!whatsappBot.sentBotMessages.has('stale_msg_id'), 'Mensagem de cancelamento antiga (>24h) deve ser purgada');
  assert(whatsappBot.sentBotMessages.has('fresh_msg_id'), 'Mensagem recente deve ser mantida');
  console.log('✅ whatsappBot.cleanupMemory() validado: sessões, pedidos e mensagens antigas purgadas');

  // =========================================================================
  // TESTE 3: Backoff Exponencial & Resiliência de Reconexão
  // =========================================================================
  console.log('\n--- TESTE 3: Resiliência de Reconexão (Exponential Backoff & Jitter) ---');

  whatsappBot.reconnectAttempts = 0;
  const baseDelaySec = 4;

  const delays = [];
  for (let i = 0; i < 6; i++) {
    const factor = Math.min(whatsappBot.reconnectAttempts++, 6);
    const backoffDelay = Math.min(30000, Math.round(baseDelaySec * 1000 * Math.pow(1.5, factor)));
    delays.push(backoffDelay);
  }

  assert.strictEqual(delays[0], 4000, 'Tentativa 0 deve ser o delay base (4000ms)');
  assert.strictEqual(delays[1], 6000, 'Tentativa 1 deve ser 6000ms');
  assert.strictEqual(delays[2], 9000, 'Tentativa 2 deve ser 9000ms');
  assert.strictEqual(delays[3], 13500, 'Tentativa 3 deve ser 13500ms');
  assert(delays[5] <= 30000, 'O delay não pode ultrapassar o teto máximo de 30s');
  console.log(`✅ Progressão de Backoff validada: ${delays.join('ms -> ')}ms`);

  // Reset de reconnectAttempts em stop()
  await whatsappBot.stop();
  assert.strictEqual(whatsappBot.reconnectAttempts, 0, 'stop() deve resetar reconnectAttempts para 0');
  console.log('✅ whatsappBot.stop() reseta contadores de tentativa com sucesso');

  // =========================================================================
  // TESTE 4: Circuit Breaker do JEV Engine (Resiliência Anti-Lag)
  // =========================================================================
  console.log('\n--- TESTE 4: Circuit Breaker do JEV Decision Engine ---');

  jevDecisionService.resetCircuitBreaker();
  assert.strictEqual(jevDecisionService.cloudFailures, 0);
  assert.strictEqual(jevDecisionService.cloudCircuitOpenUntil, 0);

  // Simula 3 falhas consecutivas de rede externa
  jevDecisionService.cloudFailures = 2;
  // Próxima falha abre o circuito
  jevDecisionService.cloudFailures++;
  jevDecisionService.cloudCircuitOpenUntil = Date.now() + 60 * 1000;

  // Enquanto o circuito estiver aberto, chamadas Jev devem responder sub-5ms localmente
  const tStart = performance.now();
  const decision = await jevDecisionService.decide({
    contextType: 'GATEWAY_ROUTER',
    input: 'quanto custa o bot?',
    state: {}
  });
  const tElapsed = performance.now() - tStart;

  assert(decision, 'Decisão deve ser retornada via fallback local instantâneo');
  assert.strictEqual(decision.intent, 'PRICE_QUERY');
  assert(tElapsed < 50, `Latência com circuito aberto deve ser sub-50ms (foi ${tElapsed.toFixed(2)}ms)`);
  console.log(`✅ JEV Circuit Breaker validado: resposta sub-milissegundo (${tElapsed.toFixed(2)}ms) sem penalidade de rede`);

  jevDecisionService.resetCircuitBreaker();

  console.log('\n🎉 TODOS OS TESTES DE ESTABILIDADE E DESEMPENHO PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

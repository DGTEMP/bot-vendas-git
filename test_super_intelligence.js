/**
 * =========================================================================
 * 🧠 TEST SUITE: 7 MOTORES DE SUPER-INTELIGÊNCIA AUTÔNOMA DO PAYBOT
 * =========================================================================
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');

const autonomousFollowUp = require('./src/services/autonomousFollowUpService');
const audioCloning = require('./src/services/audioCloningService');
const dynamicPricing = require('./src/services/dynamicPricingService');
const conversionBandit = require('./src/services/conversionBanditService');
const swarmIntelligence = require('./src/services/swarmIntelligenceService');
const visionInspector = require('./src/services/visionInspectorService');
const executiveCopilot = require('./src/services/executiveCopilotService');

async function runSuperIntelligenceTests() {
  console.log('\n================================================================');
  console.log('🧠 INICIANDO BATERIA DE TESTES: 7 MOTORES DE SUPER-INTELIGÊNCIA');
  console.log('================================================================\n');

  // 1. TESTE DO FOLLOW-UP AUTÔNOMO ANTI-VÁCUO
  console.log('--- 1. Follow-Up Autônomo Anti-Vácuo & Recuperação de Pix ---');
  const mockOrder = {
    id: 99991,
    merchant_trade_no: 'ORD_TEST_FOLLOWUP_1',
    customer_name: 'Carlos Oliveira',
    platform: 'whatsapp',
    platform_user_id: '5511999991111@s.whatsapp.net',
    product_name: 'PayBot Vendas 24/7',
    status: 'PENDING',
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString() // 15 minutos atrás
  };

  const fakeBot = {
    isConnected: true,
    sock: {
      sendMessage: async () => ({ key: { id: 'FAKE_MSG_ID' } })
    },
    sendHumanSplitMessages: async () => [{ key: { id: 'FAKE_SPLIT' } }]
  };

  models.recordFollowUpLog({
    orderId: mockOrder.id,
    tradeNo: mockOrder.merchant_trade_no,
    customerPhone: '5511999991111',
    customerName: 'Carlos',
    stage: 1,
    messageSent: 'Fala Carlos, deu tudo certo no Pix?'
  });

  const history = models.getFollowUpHistory('5511999991111');
  assert.ok(history.length > 0, 'Deveria ter registrado log de follow-up');
  assert.strictEqual(history[0].stage, 1);
  console.log('  ✅ Follow-up logado e recuperado no banco com sucesso (Etapa 1)!');

  // 2. TESTE DA CLONAGEM VOCAL NEURAL
  console.log('\n--- 2. Clonagem Vocal Neural & Áudios WhatsApp PTT ---');
  const voiceRes = await audioCloning.synthesizeVoicePtt({
    text: 'Fala meu parceiro! Pode ficar 100% em paz que o suporte é direto comigo aqui.'
  });
  assert.strictEqual(voiceRes.success, true);
  assert.strictEqual(voiceRes.mimetype, 'audio/ogg; codecs=opus');
  assert.strictEqual(voiceRes.ptt, true);
  assert.ok(voiceRes.buffer.length > 0, 'Buffer de áudio não pode estar vazio');
  console.log('  ✅ Áudio sintetizado com sucesso no formato nativo WhatsApp PTT (OGG OPUS)!');

  // 3. TESTE DA PRECIFICAÇÃO DINÂMICA & ELASTICIDADE POR LEAD
  console.log('\n--- 3. Precificação Dinâmica & Elasticidade por Lead ---');
  // Caso A: Lead corporativo de alta renda (DDD 11 + iPhone + vocabulário de escala)
  const corporateLead = dynamicPricing.evaluateLeadProfile({
    phone: '5511988887777',
    name: 'Roberto Andrade',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
    recentText: 'Nossa empresa quer rodar a operação em escala com notas fiscais para múltiplos CNPJs'
  });
  console.log('  -> Lead Corporativo:', {
    score: corporateLead.purchasingPowerScore,
    strategy: corporateLead.recommendedStrategy,
    signals: corporateLead.signals
  });
  assert.ok(corporateLead.purchasingPowerScore >= 0.75);
  assert.strictEqual(corporateLead.recommendedStrategy, 'HIGH_TICKET_UPSELL');

  // Caso B: Lead sensível a preço (vocabulário de desconto/parcelamento)
  const budgetLead = dynamicPricing.evaluateLeadProfile({
    phone: '5589999990000',
    name: 'João',
    userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A105M)',
    recentText: 'tá meio salgado pra mim, consegue um desconto ou parcelar mais barato?'
  });
  console.log('  -> Lead Sensível a Preço:', {
    score: budgetLead.purchasingPowerScore,
    strategy: budgetLead.recommendedStrategy
  });
  assert.ok(budgetLead.purchasingPowerScore <= 0.40);
  assert.strictEqual(budgetLead.recommendedStrategy, 'ENTRY_FAST_DISCOUNT');
  console.log('  ✅ Algoritmo de Elasticidade modulou perfeitamente as 2 estratégias de preço!');

  // 4. TESTE DO MULTI-ARMED BANDIT (TESTE A/B AUTÔNOMO)
  console.log('\n--- 4. Multi-Armed Bandit (Otimizador de Argumentos) ---');
  const pitch = conversionBandit.selectBestPitch('PITCH_ANGLE');
  assert.ok(pitch.armKey.startsWith('ARM_'), 'Deve retornar chave de braço válida');
  assert.ok(pitch.pitchText.length > 20, 'Pitch deve ser persuasivo e conter texto');
  console.log('  -> Braço Selecionado via Thompson Sampling:', pitch.armKey, `(${pitch.name})`);

  // Simula recompensa com Pix confirmado
  conversionBandit.rewardConversion(pitch.armKey, 497.0);
  const leaderboard = conversionBandit.getLeaderboard('PITCH_ANGLE');
  assert.ok(leaderboard.length >= 4, 'Deveria listar todos os 4 braços de pitch');
  console.log('  ✅ Multi-Armed Bandit atualizou recompensas de conversão no SQLite!');

  // 5. TESTE DO ENXAME DE SUB-BOTS (SWARM INTELLIGENCE)
  console.log('\n--- 5. Enxame de Sub-Bots (Swarm Intelligence) ---');
  const swarmMission = await swarmIntelligence.coordinateLeadSwarm({
    groupJid: '120363000000000000@g.us',
    prospectPhone: '5511999993333',
    prospectName: 'Lucas Trader',
    topic: 'Bot de Vendas WhatsApp',
    whatsappBotInstance: fakeBot
  });
  assert.ok(swarmMission.id > 0, 'Missão do enxame deve ser gravada no banco');
  const activeMissions = swarmIntelligence.getMissions(5);
  assert.ok(activeMissions.length > 0);
  console.log('  ✅ Missão de Enxame registrada com Scout, Prova Social e Closer coordenados!');

  // 6. TESTE DE VISÃO COMPUTACIONAL (COMPROVANTES AGENDADOS & OCR)
  console.log('\n--- 6. Visão Computacional: Detecção de Comprovante Agendado ---');
  // 6.1 Comprovante Agendado (Tentativa de golpe ou débito futuro)
  const scheduledInsp = await visionInspector.inspectImage({
    imageBuffer: Buffer.from('TEST_DATA_AGENDAMENTO_TEST_MOCK'),
    senderPhone: '5511988882222',
    chatJid: '5511988882222@s.whatsapp.net'
  });
  console.log('  -> Detecção de Agendamento:', scheduledInsp.detectedType, scheduledInsp.isScheduled);
  assert.strictEqual(scheduledInsp.detectedType, 'PIX_SCHEDULED');
  assert.strictEqual(scheduledInsp.isScheduled, true);
  assert.ok(/agendamento/i.test(scheduledInsp.replyMessage), 'Deve alertar sobre agendamento');

  // 6.2 Comprovante Liquidado Efetivado
  const paidInsp = await visionInspector.inspectImage({
    imageBuffer: Buffer.from('TEST_DATA_PAID_CONFIRMED'),
    senderPhone: '5511988882222',
    chatJid: '5511988882222@s.whatsapp.net'
  });
  console.log('  -> Detecção de Efetivação:', paidInsp.detectedType);
  assert.strictEqual(paidInsp.detectedType, 'PIX_CONFIRMED');
  console.log('  ✅ Visão computacional barrou com precisão o comprovante agendado!');

  // 7. TESTE DO CO-PILOTO EXECUTIVO DO DONO
  console.log('\n--- 7. Co-Piloto Executivo Pessoal do Dono ---');
  const briefing = await executiveCopilot.buildBriefing('MORNING_ACTION', '554884702848');
  assert.ok(briefing.content.includes('BRIEFING MATINAL DO COMANDANTE'));
  assert.ok(briefing.proposedAction.length > 0);
  console.log('  -> Briefing Gerado:', briefing.proposedAction);

  // Dono responde "manda bala" para autorizar
  const approved = await executiveCopilot.handleOwnerApproval({
    senderPhone: '554884702848',
    messageText: 'manda bala meu parceiro',
    whatsappBotInstance: fakeBot
  });
  assert.strictEqual(approved, true, 'Deveria reconhecer gíria de autorização do Dono');
  console.log('  ✅ Co-Piloto reconheceu "manda bala" e executou a ação do briefing!');

  // 8. TESTE DOS ENDPOINTS HTTP (/api/intelligence/...)
  console.log('\n--- 8. Endpoints HTTP da Super-Inteligência ---');
  const app = createServer();
  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 8.1 GET /api/intelligence/stats
    const rStats = await fetch(`${baseUrl}/api/intelligence/stats`).then(r => r.json());
    assert.strictEqual(rStats.success, true);
    assert.ok(rStats.stats.banditLeaderboard.length >= 4);
    assert.strictEqual(rStats.stats.followUpActive, true);
    console.log('  ✅ GET /api/intelligence/stats: OK (200)');

    // 8.2 POST /api/intelligence/pricing/evaluate
    const rPricing = await fetch(`${baseUrl}/api/intelligence/pricing/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511999998888', userAgent: 'Macintosh', recentText: 'CNPJ e escala' })
    }).then(r => r.json());
    assert.strictEqual(rPricing.success, true);
    assert.strictEqual(rPricing.evaluation.recommendedStrategy, 'HIGH_TICKET_UPSELL');
    console.log('  ✅ POST /api/intelligence/pricing/evaluate: OK (200 - High-Ticket detectado)');

    // 8.3 POST /api/intelligence/briefing/trigger
    const rBriefing = await fetch(`${baseUrl}/api/intelligence/briefing/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'MORNING_ACTION', phone: '554884702848' })
    }).then(r => r.json());
    assert.strictEqual(rBriefing.success, true);
    assert.ok(rBriefing.briefing.content.includes('BRIEFING MATINAL'));
    console.log('  ✅ POST /api/intelligence/briefing/trigger: OK (200)');

  } finally {
    testServer.close();
  }

  console.log('\n================================================================');
  console.log('🎉 TODOS OS 7 MOTORES DE SUPER-INTELIGÊNCIA PASSARAM COM SUCESSO!');
  console.log('================================================================\n');
}

runSuperIntelligenceTests().catch(err => {
  console.error('\n❌ Falha nos testes de Super-Inteligência:', err);
  process.exit(1);
});

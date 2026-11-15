/**
 * =========================================================================
 * ⚡ TEST SUITE: JEV DECISION ENGINE (SYSTEM 1 FAST TYPED DECISIONS)
 * =========================================================================
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const jevDecisionService = require('./src/services/jevDecisionService');
const { createServer } = require('./src/server/app');

async function runJevTests() {
  console.log('\n======================================================');
  console.log('⚡ INICIANDO BATERIA DE TESTES DO JEV DECISION ENGINE');
  console.log('======================================================\n');

  // 1. TESTE DO GATEWAY ROUTER (WHATSAPP ENTRADA)
  console.log('--- 1. Testando Gateway Router do WhatsApp ---');

  const buyRes = await jevDecisionService.decideMessageGateway({
    text: 'Quero comprar o bot de vendas no PIX agora mesmo!',
    senderPhone: '5511999887766'
  });
  console.log('  -> Compra:', buyRes.intent, `(${buyRes.latencyMs}ms)`, buyRes.action);
  assert.strictEqual(buyRes.intent, 'BUY_INTENT');
  assert.strictEqual(buyRes.canBypassLlm, true);
  assert.strictEqual(buyRes.action, 'GENERATE_PAYMENT');

  const pixRes = await jevDecisionService.decideMessageGateway({
    text: 'Já paguei, segue o comprovante do pix',
    senderPhone: '5511999887766'
  });
  console.log('  -> PIX:', pixRes.intent, `(${pixRes.latencyMs}ms)`, pixRes.action);
  assert.strictEqual(pixRes.intent, 'PIX_CONFIRMATION');
  assert.strictEqual(pixRes.canBypassLlm, true);

  const catRes = await jevDecisionService.decideMessageGateway({
    text: 'Poderia me mandar o catálogo com os preços dos planos?',
    senderPhone: '5511999887766'
  });
  console.log('  -> Catálogo:', catRes.intent, `(${catRes.latencyMs}ms)`);
  assert.strictEqual(catRes.intent, 'CATALOG_QUERY');

  const supRes = await jevDecisionService.decideMessageGateway({
    text: 'Preciso falar com um suporte humano urgente deu erro',
    senderPhone: '5511999887766'
  });
  console.log('  -> Suporte:', supRes.intent, `(${supRes.latencyMs}ms)`);
  assert.strictEqual(supRes.intent, 'SUPPORT_HUMAN');

  // 2. TESTE DO RADAR VIRAL & ESCUTA DE GRUPOS (LEAD MINER)
  console.log('\n--- 2. Testando Radar Viral & Lead Miner ---');

  const hotLead = await jevDecisionService.decideLeadTemperature({
    text: 'Alguém aqui tem ou vende bot de automação de WhatsApp? Preciso urgente',
    senderPhone: '5521988887777',
    groupName: 'Networking Empreendedores'
  });
  console.log('  -> Lead Quente:', hotLead.intent, hotLead.temperature, `(${hotLead.latencyMs}ms)`);
  assert.strictEqual(hotLead.isHotLead, true);
  assert.strictEqual(hotLead.temperature, 'HOT');
  assert.strictEqual(hotLead.action, 'STEALTH_ENGAGE');

  const coldChat = await jevDecisionService.decideLeadTemperature({
    text: 'Bom dia pessoal, bom trabalho a todos',
    senderPhone: '5521988887777'
  });
  console.log('  -> Chat Comum:', coldChat.intent, coldChat.temperature, `(${coldChat.latencyMs}ms)`);
  assert.strictEqual(coldChat.isHotLead, false);
  assert.strictEqual(coldChat.temperature, 'COLD');

  // 3. TESTE DE GUARDRAIL ANTI-PV
  console.log('\n--- 3. Testando Guardrails & Anti-PV ---');

  const ownerPv = await jevDecisionService.decideAntiPvGuard({
    senderPhone: '554884702848',
    messageText: 'Status geral do sistema',
    isOwner: true
  });
  console.log('  -> Dono no PV:', ownerPv.intent, `shouldBlock=${ownerPv.shouldBlock}`);
  assert.strictEqual(ownerPv.shouldBlock, false);

  const spamPv = await jevDecisionService.decideAntiPvGuard({
    senderPhone: '559999999999',
    messageText: 'Ganhe dinheiro em casa clique no link bit.ly/rendaextra',
    isOwner: false,
    allowSales: true
  });
  console.log('  -> Spam no PV:', spamPv.intent, `shouldBlock=${spamPv.shouldBlock}`, spamPv.action);
  assert.strictEqual(spamPv.shouldBlock, true);
  assert.strictEqual(spamPv.action, 'BLOCK_AND_WARN');

  const legitBuyerPv = await jevDecisionService.decideAntiPvGuard({
    senderPhone: '5511977776666',
    messageText: 'Olá, quanto custa o PayBot?',
    isOwner: false,
    allowSales: true
  });
  console.log('  -> Comprador no PV:', legitBuyerPv.intent, `shouldBlock=${legitBuyerPv.shouldBlock}`);
  assert.strictEqual(legitBuyerPv.shouldBlock, false);
  assert.strictEqual(legitBuyerPv.isLegitimateBuyer, true);

  // 4. TESTE DA MENTE DO DONO (OWNER MINDSET)
  console.log('\n--- 4. Testando Mente do Dono (Owner Mindset) ---');

  const ownerAction = await jevDecisionService.decideOwnerInteraction({
    senderPhone: '554884702848',
    messageText: 'reiniciar subbot 2 agora'
  });
  console.log('  -> Ação Imediata:', ownerAction.intent, ownerAction.action);
  assert.strictEqual(ownerAction.intent, 'EXECUTE_IMMEDIATE_ACTION');

  const ownerForecast = await jevDecisionService.decideOwnerInteraction({
    senderPhone: '554884702848',
    messageText: 'qual a probabilidade e estatística de batermos a meta de vendas hoje?'
  });
  console.log('  -> Previsão Estratégica:', ownerForecast.intent, ownerForecast.action);
  assert.strictEqual(ownerForecast.intent, 'STRATEGIC_FORECAST_REQUEST');

  const ownerTeach = await jevDecisionService.decideOwnerInteraction({
    senderPhone: '554884702848',
    messageText: 'quando o cliente falar de preço responda sempre valorizando o lucro dele'
  });
  console.log('  -> Ensino de Tom:', ownerTeach.intent, ownerTeach.action);
  assert.strictEqual(ownerTeach.intent, 'TEACH_SLANG_OR_MINDSET');

  // 5. TESTE DE TELEMETRIA E BANCO DE DADOS
  console.log('\n--- 5. Testando Telemetria & Banco de Dados ---');
  const tel = jevDecisionService.getTelemetry();
  console.log('  -> Decisões Registradas:', tel.totalDecisions);
  console.log('  -> Latência Média:', tel.avgLatencyMs + 'ms');
  console.log('  -> Tokens Economizados:', tel.tokensSavedTotal);
  assert.ok(tel.totalDecisions > 0, 'Deveria ter registrado decisões no banco');
  assert.ok(tel.avgLatencyMs > 0, 'Latência média deve ser positiva');

  // 6. TESTE DAS ROTAS HTTP DO SERVIDOR
  console.log('\n--- 6. Testando Endpoints HTTP (/api/jev/...) ---');
  const app = createServer();
  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 6.1 GET /api/jev/telemetry
    const r1 = await fetch(`${baseUrl}/api/jev/telemetry`).then(r => r.json());
    assert.strictEqual(r1.success, true);
    assert.ok(r1.telemetry.totalDecisions > 0);
    console.log('  ✅ GET /api/jev/telemetry: OK (200)');

    // 6.2 POST /api/jev/decide (Simulador)
    const r2 = await fetch(`${baseUrl}/api/jev/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'manda o pix do plano vip', context_type: 'GATEWAY_ROUTER' })
    }).then(r => r.json());
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.decision.intent, 'BUY_INTENT');
    console.log('  ✅ POST /api/jev/decide: OK (200 - Decisão em', r2.decision.latencyMs + 'ms)');

    // 6.3 GET & POST /api/jev/settings
    const r3 = await fetch(`${baseUrl}/api/jev/settings`).then(r => r.json());
    assert.strictEqual(r3.success, true);
    assert.strictEqual(r3.settings.enabled, true);
    console.log('  ✅ GET /api/jev/settings: OK (200)');

    const r4 = await fetch(`${baseUrl}/api/jev/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minConfidence: 0.80 })
    }).then(r => r.json());
    assert.strictEqual(r4.success, true);
    assert.strictEqual(r4.settings.minConfidence, 0.80);
    console.log('  ✅ POST /api/jev/settings: OK (200 - Configuração persistida)');

  } finally {
    testServer.close();
  }

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DO JEV PASSARAM COM 100% DE SUCESSO!');
  console.log('======================================================\n');
}

runJevTests().catch(err => {
  console.error('\n❌ Falha nos testes do Jev:', err);
  process.exit(1);
});

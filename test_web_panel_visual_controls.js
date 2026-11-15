const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');

process.env.NODE_ENV = 'test';

const { createServer } = require('./src/server/app');
const app = createServer();

let passedTests = 0;
async function itAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(err);
    process.exit(1);
  }
}

(async () => {
  console.log('=============================================================');
  console.log('🌐 TESTES: ENDPOINTS DO PAINEL WEB (VISUAL CONTROLS)');
  console.log('🎧 SOCIAL LISTENING, SENTINELA, GERENTES & AQUECIMENTO');
  console.log('=============================================================\n');

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testGroup = '120363009999999999@g.us';

  // 1. GET /api/social-listening/settings
  await itAsync('1. GET /api/social-listening/settings retorna status dos subsistemas', async () => {
    const res = await fetch(`${baseUrl}/api/social-listening/settings`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(typeof body.enabled === 'boolean');
    assert.ok(typeof body.audioEnabled === 'boolean');
    assert.ok(typeof body.alertEnabled === 'boolean');
    assert.ok(typeof body.heatingEnabled === 'boolean');
    assert.strictEqual(body.heatingMax24h, 9);
  });

  // 2. POST /api/social-listening/settings
  await itAsync('2. POST /api/social-listening/settings atualiza configurações', async () => {
    const res = await fetch(`${baseUrl}/api/social-listening/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioEnabled: true, alertEnabled: true, cooldownMinutes: 20 })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);

    const checkRes = await fetch(`${baseUrl}/api/social-listening/settings`);
    const check = await checkRes.json();
    assert.strictEqual(check.cooldownMinutes, 20);
  });

  // 3. POST /api/social-listening/import-bulk
  await itAsync('3. POST /api/social-listening/import-bulk cadastra regras em lote', async () => {
    const bulkPayload = 
      `Airfryer Web Test | airfryer, teste | https://amzn.to/web1 | https://shope.ee/web2 | Teste {link}\n` +
      `[sentinela] Reclamação Web Test | procon, processo judicial`;

    const res = await fetch(`${baseUrl}/api/social-listening/import-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: bulkPayload })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.added, 2);
    assert.strictEqual(body.affiliateCount, 1);
    assert.strictEqual(body.sentinelCount, 1);
  });

  // 4. GET /api/group-managers & POST /api/group-managers
  await itAsync('4. POST e GET /api/group-managers delega e lista gerentes', async () => {
    const instances = models.getArmyInstances();
    const instId = instances[0]?.id || 1;

    const postRes = await fetch(`${baseUrl}/api/group-managers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid: testGroup, instanceId: instId, delegatedBy: 'Painel Web Test' })
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.success, true);

    const getRes = await fetch(`${baseUrl}/api/group-managers`);
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.success, true);
    assert.ok(getBody.managers.some(m => m.group_jid === testGroup));
  });

  // 5. DELETE /api/group-managers/:groupJid
  await itAsync('5. DELETE /api/group-managers/:groupJid remove o gerente delegado', async () => {
    const delRes = await fetch(`${baseUrl}/api/group-managers/${encodeURIComponent(testGroup)}`, {
      method: 'DELETE'
    });
    assert.strictEqual(delRes.status, 200);
    const delBody = await delRes.json();
    assert.strictEqual(delBody.success, true);

    const getRes = await fetch(`${baseUrl}/api/group-managers`);
    const getBody = await getRes.json();
    assert.ok(!getBody.managers.some(m => m.group_jid === testGroup));
  });

  // 6. GET /api/group-heating/status
  await itAsync('6. GET /api/group-heating/status retorna métricas e resumos de 24h', async () => {
    const res = await fetch(`${baseUrl}/api/group-heating/status`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.maxInteractions24h, 9);
    assert.ok(Array.isArray(body.summaries));
    assert.ok(Array.isArray(body.recentLogs));
  });

  // 7. POST /api/group-heating/toggle
  await itAsync('7. POST /api/group-heating/toggle alterna status do motor', async () => {
    const resOff = await fetch(`${baseUrl}/api/group-heating/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    const bodyOff = await resOff.json();
    assert.strictEqual(bodyOff.enabled, false);

    const resOn = await fetch(`${baseUrl}/api/group-heating/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    const bodyOn = await resOn.json();
    assert.strictEqual(bodyOn.enabled, true);
  });

  // 8. POST /api/group-heating/reset
  await itAsync('8. POST /api/group-heating/reset zera a cota de 24h de um assunto', async () => {
    models.recordGroupTopicInteraction({
      group_jid: testGroup,
      topic_key: 'topico_painel_reset',
      instance_id: 1,
      flow_type: 'DUAL_BUYERS',
      message_text: 'msg teste'
    });

    const res = await fetch(`${baseUrl}/api/group-heating/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid: testGroup, topicKey: 'topico_painel_reset' })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroup, 'topico_painel_reset'), 0);
  });

  server.close();

  console.log(`\n=============================================================`);
  console.log(`🎉 TODOS OS ${passedTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
  console.log(`=============================================================\n`);
  process.exit(0);
})();

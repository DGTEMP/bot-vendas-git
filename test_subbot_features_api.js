/**
 * API Test Suite for Sub-Bot Feature Endpoints
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createServer } = require('./src/server/app');
const models = require('./src/db/models');

async function testApi() {
  console.log('🌐 Iniciando Teste de Endpoints REST para Recursos dos Sub-Bots...');

  const app = createServer();
  const server = http.createServer(app);
  const port = 30999;

  await new Promise((resolve) => server.listen(port, resolve));

  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/subbots/features/catalog
    console.log('1. Testando GET /api/subbots/features/catalog...');
    let res = await fetch(`${baseUrl}/api/subbots/features/catalog`);
    assert.strictEqual(res.status, 200);
    let data = await res.json();
    assert.strictEqual(data.success, true);
    assert(Array.isArray(data.catalog), 'Catalog deve ser um array');
    assert.strictEqual(data.catalog.length, 9, 'Deve haver 9 recursos no catálogo');

    // 2. GET /api/subbots/features
    console.log('2. Testando GET /api/subbots/features...');
    res = await fetch(`${baseUrl}/api/subbots/features`);
    assert.strictEqual(res.status, 200);
    data = await res.json();
    assert.strictEqual(data.success, true);
    assert(Array.isArray(data.subbots), 'Subbots deve ser um array');

    // Pegar o primeiro sub-bot
    const targetSubBot = data.subbots[0] || { id: 1282 };
    const targetId = targetSubBot.id;

    // 3. GET /api/subbots/:id/features
    console.log(`3. Testando GET /api/subbots/${targetId}/features...`);
    res = await fetch(`${baseUrl}/api/subbots/${targetId}/features`);
    assert.strictEqual(res.status, 200);
    data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.features, 'Deve retornar features');

    // 4. POST /api/subbots/:id/features (toggle individual via modal)
    console.log(`4. Testando POST /api/subbots/${targetId}/features...`);
    res = await fetch(`${baseUrl}/api/subbots/${targetId}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        features: {
          games: false,
          pv_chat: false
        }
      })
    });
    assert.strictEqual(res.status, 200);
    data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.features.games, false);
    assert.strictEqual(data.features.pv_chat, false);

    // 5. POST /api/subbots/features (batch toggle)
    console.log(`5. Testando POST /api/subbots/features (Batch Toggle)...`);
    res = await fetch(`${baseUrl}/api/subbots/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetIds: [targetId],
        featureKey: 'games',
        enabled: true
      })
    });
    assert.strictEqual(res.status, 200);
    data = await res.json();
    assert.strictEqual(data.success, true);

    // Re-checar se games voltou para true
    assert.strictEqual(models.isSubBotFeatureEnabled(targetId, 'games'), true);

    // Reativar pv_chat
    await fetch(`${baseUrl}/api/subbots/${targetId}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        features: { pv_chat: true }
      })
    });
    assert.strictEqual(models.isSubBotFeatureEnabled(targetId, 'pv_chat'), true);

    console.log('✅ Todos os endpoints da API REST responderam 200 OK com payload correto!');
  } finally {
    server.close();
  }
}

testApi().catch(err => {
  console.error('❌ Falha nos testes de API:', err);
  process.exit(1);
});

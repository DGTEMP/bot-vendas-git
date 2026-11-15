const assert = require('assert');
const request = require('supertest');
const { createServer } = require('./src/server/app');
const models = require('./src/db/models');
const aiManager = require('./src/services/aiManagerService');

async function runSubbotWebAiKeysTests() {
  console.log('========================================================');
  console.log('🧪 TESTE: CADASTRO DE CHAVES DE IA PELO PAINEL WEB /SUBBOT');
  console.log('========================================================\n');

  const app = createServer();
  const TEST_SUBBOT_ID = 8888;
  const TEST_KEY = 'gsk_supertest_groq_valid_subbot_key_12345';

  // Limpa estado anterior de teste
  try {
    models.setSubBotAiKeys(TEST_SUBBOT_ID, 'groq', []);
    models.setSubBotAiKeys(TEST_SUBBOT_ID, 'gemini', []);
  } catch (_) {}

  // 1. Teste de Acesso à página HTML /subbot
  console.log('👉 [TESTE 1] Servir página /subbot com a nova aba de IA');
  const resHtml = await request(app).get('/subbot');
  assert.strictEqual(resHtml.status, 200, 'Status deve ser 200');
  assert(resHtml.text.includes('id="tab-ai"'), 'Deve conter a aba tab-ai');
  assert(resHtml.text.includes('STATUS DE IA DO SUB-BOT'), 'Deve conter seção de IA do Sub-Bot');
  assert(resHtml.text.includes('Google Gemini'), 'Deve conter opção do Google Gemini');
  assert(resHtml.text.includes('Groq Cloud'), 'Deve conter opção da Groq Cloud');
  console.log('   ✅ Página /subbot e aba tab-ai servidas com sucesso');

  // 2. Teste do Endpoint Público de Telemetria /api/sys/stats
  console.log('\n👉 [TESTE 2] Endpoint de Telemetria /api/sys/stats');
  const resStats = await request(app).get('/api/sys/stats');
  assert.strictEqual(resStats.status, 200);
  assert.strictEqual(resStats.body.success, true);
  assert(typeof resStats.body.subbotsCount === 'number');
  assert(Array.isArray(resStats.body.sparkline));
  console.log(`   ✅ Telemetria retornou: Sub-Bots=${resStats.body.subbotsCount}, Uptime=${resStats.body.uptime}`);

  // 3. Teste da Lista de Sub-Bots /api/subbot/list
  console.log('\n👉 [TESTE 3] Listagem de Sub-Bots /api/subbot/list');
  const resList = await request(app).get('/api/subbot/list');
  assert.strictEqual(resList.status, 200);
  assert.strictEqual(resList.body.success, true);
  assert(Array.isArray(resList.body.subbots), 'Deve retornar array de subbots');
  console.log(`   ✅ Encontrados ${resList.body.subbots.length} Sub-Bots listados`);

  // 4. Teste de Bloqueio Inicial do Sub-Bot de Teste
  console.log('\n👉 [TESTE 4] Sub-Bot sem chave deve constar como BLOQUEADO');
  const resKeysBefore = await request(app).get(`/api/subbot/ai-keys?subbotId=${TEST_SUBBOT_ID}`);
  assert.strictEqual(resKeysBefore.status, 200);
  assert.strictEqual(resKeysBefore.body.canUseAi, false, 'canUseAi deve ser false');
  assert.strictEqual(resKeysBefore.body.aiStatus, 'BLOQUEADO', 'aiStatus deve ser BLOQUEADO');
  assert.strictEqual(resKeysBefore.body.totalKeys, 0);
  console.log('   ✅ Sub-Bot inicialmente bloqueado e sem chaves cadastradas');

  // 5. Teste de Cadastro de Chave via POST /api/subbot/ai-keys
  console.log('\n👉 [TESTE 5] Cadastro de chave de API no Sub-Bot');
  const resAdd = await request(app)
    .post('/api/subbot/ai-keys')
    .send({
      subbotId: TEST_SUBBOT_ID,
      provider: 'groq',
      key: TEST_KEY
    });
  assert.strictEqual(resAdd.status, 200);
  assert.strictEqual(resAdd.body.success, true);
  assert.strictEqual(resAdd.body.canUseAi, true, 'Sub-Bot agora deve ter canUseAi = true');
  assert.strictEqual(resAdd.body.aiStatus, 'LIBERADO', 'aiStatus deve ser LIBERADO');
  assert.strictEqual(models.canSubBotUseAi(TEST_SUBBOT_ID), true, 'models.canSubBotUseAi deve retornar true');
  console.log(`   ✅ Chave cadastrada com sucesso: ${resAdd.body.message}`);

  // 6. Teste de Consulta de Chaves Mascaradas via GET /api/subbot/ai-keys
  console.log('\n👉 [TESTE 6] Consulta de chaves mascaradas do Sub-Bot');
  const resKeysAfter = await request(app).get(`/api/subbot/ai-keys?subbotId=${TEST_SUBBOT_ID}`);
  assert.strictEqual(resKeysAfter.status, 200);
  assert.strictEqual(resKeysAfter.body.canUseAi, true);
  assert.strictEqual(resKeysAfter.body.totalKeys, 1);
  const registeredKey = resKeysAfter.body.keys[0];
  assert.strictEqual(registeredKey.provider, 'groq');
  assert(registeredKey.maskedKey.includes('...'), 'A chave retornada para o cliente DEVE ser mascarada');
  assert.strictEqual(registeredKey.maskedKey.startsWith('gsk_'), true);
  console.log(`   ✅ Chave retornada com segurança mascarada: ${registeredKey.maskedKey}`);

  // 7. Teste de Conexão Simulado via POST /api/subbot/ai-keys/test
  console.log('\n👉 [TESTE 7] Teste de chave de API pelo painel');
  const resTest = await request(app)
    .post('/api/subbot/ai-keys/test')
    .send({
      subbotId: TEST_SUBBOT_ID,
      provider: 'groq',
      key: registeredKey.maskedKey
    });
  assert.strictEqual(resTest.status, 200);
  // O endpoint responde com success boolean (falso ou verdadeiro dependendo da validade remota, mas nunca 500)
  assert(typeof resTest.body.success === 'boolean');
  assert(resTest.body.message, 'Deve conter mensagem explicativa de diagnóstico');
  console.log(`   ✅ Resposta do teste de diagnóstico: "${resTest.body.message.slice(0, 70)}..."`);

  // 8. Teste de Exclusão de Chave via DELETE /api/subbot/ai-keys (passando a chave mascarada)
  console.log('\n👉 [TESTE 8] Remoção de chave pelo painel usando a chave mascarada');
  const resDel = await request(app)
    .delete('/api/subbot/ai-keys')
    .send({
      subbotId: TEST_SUBBOT_ID,
      provider: 'groq',
      key: registeredKey.maskedKey
    });
  assert.strictEqual(resDel.status, 200);
  assert.strictEqual(resDel.body.success, true);
  assert.strictEqual(resDel.body.totalKeysForProvider, 0);
  assert.strictEqual(models.canSubBotUseAi(TEST_SUBBOT_ID), false, 'Sub-Bot deve voltar a ficar bloqueado');
  console.log('   ✅ Chave removida com sucesso. Sub-bot voltou a ficar bloqueado.');

  // 9. Teste de Acesso Remoto simulando Túnel Cloudflare (trycloudflare.com)
  console.log('\n👉 [TESTE 9] Acesso via Túnel Cloudflare sem credencial admin do dono');
  const resTunnel = await request(app)
    .post('/api/subbot/ai-keys')
    .set('host', 'alpha-subbot-xyz.trycloudflare.com')
    .set('cf-connecting-ip', '203.0.113.195')
    .send({
      subbotId: TEST_SUBBOT_ID,
      provider: 'gemini',
      key: 'AIzaSy_fake_tunnel_gemini_test_key_999'
    });
  assert.notStrictEqual(resTunnel.status, 401, 'Acesso pelo túnel ao /api/subbot NÃO pode ser bloqueado com 401');
  assert.strictEqual(resTunnel.status, 200, 'Cadastro pelo túnel deve ter sucesso');
  assert.strictEqual(resTunnel.body.success, true);
  console.log('   ✅ Endpoint do Sub-Bot liberado via túnel remoto (sem exigir PIN do dono)');

  // 10. Teste de Resolução por Telefone do Sub-Bot
  console.log('\n👉 [TESTE 10] Gerenciamento de chaves informando o telefone do Sub-Bot');
  const existingSubbot = resList.body.subbots.find(s => s.phone && s.id !== 1);
  if (existingSubbot) {
    const resByPhone = await request(app).get(`/api/subbot/ai-keys?phone=${existingSubbot.phone}`);
    assert.strictEqual(resByPhone.status, 200);
    assert.strictEqual(resByPhone.body.success, true);
    assert.strictEqual(resByPhone.body.subbot.id, existingSubbot.id);
    console.log(`   ✅ Sub-Bot #${existingSubbot.id} resolvido com sucesso pelo telefone ${existingSubbot.phone}`);
  }

  // 11. Limpeza final
  models.setSubBotAiKeys(TEST_SUBBOT_ID, 'gemini', []);
  models.setSubBotAiKeys(TEST_SUBBOT_ID, 'groq', []);

  console.log('\n========================================================');
  console.log('🎉 TODOS OS 10 TESTES DE SUB-BOT WEB AI KEYS PASSARAM COM SUCESSO!');
  console.log('========================================================\n');
}

runSubbotWebAiKeysTests().catch(err => {
  console.error('\n❌ FALHA NO TESTE:', err);
  process.exit(1);
});

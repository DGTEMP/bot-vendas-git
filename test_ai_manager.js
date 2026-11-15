const assert = require('assert');
const http = require('http');
const aiManager = require('./src/services/aiManagerService');
const models = require('./src/db/models');

async function runAiManagerTests() {
  console.log('====================================================');
  console.log('🧪 TESTES DA CENTRAL MULTI-IA COM SUB-BOTS & MEGA-POOL');
  console.log('====================================================\n');

  const origGroqKey = process.env.GROQ_API_KEY;
  const origGroqKeys = process.env.GROQ_API_KEYS;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEYS;

  // Limpa chaves prévias de teste e isola variáveis de ambiente para teste determinístico
  const origEnvGroqKey = process.env.GROQ_API_KEY;
  const origEnvGroqKeys = process.env.GROQ_API_KEYS;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEYS;

  try {
    models.setSetting('AI_KEYS_GEMINI', '[]');
    models.setSetting('AI_KEYS_GROQ', '[]');
    models.setSetting('AI_KEYS_OPENAI', '[]');
    models.setSubBotAiKeys(912, 'groq', []);
    models.setSubBotAiKeys(913, 'openai', []);
    models.setSubBotAiKeys(914, 'gemini', []);
    models.setSubBotAiKeys(9888, 'groq', []);
    aiManager.keyPools.clear();
  } catch (_) {}

  // 1. Teste de Bloqueio de Sub-Bot sem Chave Própria
  console.log('👉 [TESTE 1] Sub-Bot sem chave própria DEVE ser bloqueado');
  const canSubBot912Use = models.canSubBotUseAi(912);
  assert.strictEqual(canSubBot912Use, false, 'Sub-Bot 912 sem chave não deve ter permissão');
  
  let subBotBlockedErr = null;
  try {
    await aiManager.chat({
      messages: [{ role: 'user', content: 'Olá' }],
      subbotId: 912
    });
  } catch (err) {
    subBotBlockedErr = err;
  }
  assert(subBotBlockedErr !== null, 'Deveria ter lançado erro de sub-bot bloqueado');
  assert(subBotBlockedErr.message.includes('Bloqueado'), 'Mensagem deve indicar bloqueio');
  console.log(`   ✅ Sub-Bot #912 bloqueado com sucesso: "${subBotBlockedErr.message.slice(0, 75)}..."`);

  // 2. Teste de Cadastro de Chave no Sub-Bot
  console.log('\n👉 [TESTE 2] Sub-Bot cadastra sua própria chave de API');
  aiManager.addApiKey('groq', 'gsk_subbot_912_groq_key', { subbotId: 912 });
  assert.strictEqual(models.canSubBotUseAi(912), true, 'Sub-Bot 912 agora deve estar liberado');

  const subbot912Keys = aiManager.getKeysForProvider('groq', { subbotId: 912 });
  assert(subbot912Keys.includes('gsk_subbot_912_groq_key'), 'Sub-Bot deve conter sua chave do Groq');
  console.log(`   ✅ Sub-Bot #912 liberado com ${subbot912Keys.length} chave(s) do Groq.`);

  // 3. Teste de Isolamento entre Sub-Bots
  console.log('\n👉 [TESTE 3] Isolamento estrito entre Sub-Bots (Sub-Bot A não vê chaves de Sub-Bot B)');
  aiManager.addApiKey('openai', 'sk_subbot_913_openai_key', { subbotId: 913 });
  
  const subbot912OpenAi = aiManager.getKeysForProvider('openai', { subbotId: 912 });
  assert.strictEqual(subbot912OpenAi.length, 0, 'Sub-Bot 912 NÃO deve ter acesso à chave OpenAI do Sub-Bot 913');

  const subbot913Groq = aiManager.getKeysForProvider('groq', { subbotId: 913 });
  assert.strictEqual(subbot913Groq.length, 0, 'Sub-Bot 913 NÃO deve ter acesso à chave Groq do Sub-Bot 912');
  console.log('   ✅ Isolamento verificado: cada sub-bot só enxerga as chaves que ele próprio cadastrou.');

  // 4. Teste do Bot Master (Mega-Pool: Usa as suas + TODAS dos Sub-Bots)
  console.log('\n👉 [TESTE 4] Bot Master incorpora todas as chaves de todos os Sub-Bots (Mega-Pool)');
  aiManager.addApiKey('gemini', 'master_gemini_key_1', { isMaster: true });
  aiManager.addApiKey('gemini', 'master_gemini_key_2', { isMaster: true });
  // Cadastra outra chave no subbot 914
  aiManager.addApiKey('gemini', 'subbot_914_gemini_key', { subbotId: 914 });

  const masterGeminiKeys = aiManager.getKeysForProvider('gemini', { isMaster: true });
  assert(masterGeminiKeys.includes('master_gemini_key_1'), 'Master deve conter sua própria chave 1');
  assert(masterGeminiKeys.includes('master_gemini_key_2'), 'Master deve conter sua própria chave 2');
  assert(masterGeminiKeys.includes('subbot_914_gemini_key'), 'Master DEVE incorporar a chave do Sub-Bot 914!');

  const masterGroqKeys = aiManager.getKeysForProvider('groq', { isMaster: true });
  assert(masterGroqKeys.includes('gsk_subbot_912_groq_key'), 'Master DEVE incorporar a chave do Sub-Bot 912!');

  const masterOpenAiKeys = aiManager.getKeysForProvider('openai', { isMaster: true });
  assert(masterOpenAiKeys.includes('sk_subbot_913_openai_key'), 'Master DEVE incorporar a chave do Sub-Bot 913!');

  console.log(`   ✅ Master Mega-Pool operando com sucesso total:`);
  console.log(`      - Gemini no Master: ${masterGeminiKeys.length} chaves (inclui do Sub-Bot 914)`);
  console.log(`      - Groq no Master: ${masterGroqKeys.length} chaves (incorporada do Sub-Bot 912)`);
  console.log(`      - OpenAI no Master: ${masterOpenAiKeys.length} chaves (incorporada do Sub-Bot 913)`);

  // 5. Teste de Relatório de Status
  console.log('\n👉 [TESTE 5] Relatório Completo do Status da Frota e do Master');
  const status = aiManager.getStatus();
  assert(status.masterMegaPool, 'Deve conter masterMegaPool');
  assert(Array.isArray(status.subbotsFleet), 'Deve conter subbotsFleet como array');
  const sb912Report = status.subbotsFleet.find(s => s.id === 912);
  assert(sb912Report && sb912Report.aiStatus === 'LIBERADO', 'Sub-Bot 912 deve constar como LIBERADO');
  console.log(`   ✅ Status da Frota:`);
  console.log(`      - Master Mega-Pool Provedores: ${Object.keys(status.masterMegaPool).join(', ')}`);
  console.log(`      - Sub-Bots na Frota: ${status.subbotsFleet.length}`);
  console.log(`      - Sub-Bot #912: ${sb912Report.name} -> ${sb912Report.aiStatus} (${sb912Report.totalKeys} chaves)`);

  // 6. Teste de Execução Simulado via Servidor Mock
  console.log('\n👉 [TESTE 6] Execução em Servidor Mock com Validação de Cabeçalho de Autenticação');
  const callsReceived = [];
  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const auth = req.headers['authorization'] || '';
      callsReceived.push({ auth });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: `Atendido com sucesso via ${auth}` } }]
      }));
    });
  });

  await new Promise(resolve => mockServer.listen(0, resolve));
  const mockPort = mockServer.address().port;
  const mockUrl = `http://127.0.0.1:${mockPort}/chat/completions`;

  const origGroqEndpoint = aiManager.providerConfigs.groq.chatEndpoint;
  aiManager.providerConfigs.groq.chatEndpoint = mockUrl;

  try {
    // 6.1 Sub-Bot #912 executa chamada usando SUA chave
    const subbotRes = await aiManager.chat({
      messages: [{ role: 'user', content: 'Mensagem do Subbot' }],
      subbotId: 912,
      preferredProvider: 'groq'
    });
    assert(subbotRes.text.includes('gsk_subbot_912_groq_key'), 'Sub-Bot deve ter usado a sua própria chave');
    assert.strictEqual(subbotRes.scope, 'subbot_912');
    console.log(`   ✅ Sub-Bot executou chamada usando exclusivamente sua própria chave: "${subbotRes.text}"`);

    // 6.2 Master executa chamada aproveitando chave herdada do Sub-Bot no Mega-Pool
    const masterRes = await aiManager.chat({
      messages: [{ role: 'user', content: 'Mensagem do Master' }],
      isMaster: true,
      preferredProvider: 'groq'
    });
    assert(masterRes.text.includes('gsk_subbot_912_groq_key'), 'Master deve ter usado chave do Mega-Pool');
    assert.strictEqual(masterRes.scope, 'master_mega_pool');
    console.log(`   ✅ Master executou chamada utilizando chave do Mega-Pool: "${masterRes.text}"`);
  } finally {
    aiManager.providerConfigs.groq.chatEndpoint = origGroqEndpoint;
    mockServer.close();
  }

  // Limpeza de chaves de teste
  models.setSubBotAiKeys(912, 'groq', []);
  models.setSubBotAiKeys(913, 'openai', []);
  models.setSubBotAiKeys(914, 'gemini', []);
  aiManager.removeApiKey('gemini', 'master_gemini_key_1', { isMaster: true });
  aiManager.removeApiKey('gemini', 'master_gemini_key_2', { isMaster: true });

  if (origEnvGroqKey) process.env.GROQ_API_KEY = origEnvGroqKey;
  if (origEnvGroqKeys) process.env.GROQ_API_KEYS = origEnvGroqKeys;

  console.log('\n====================================================');
  console.log('🎉 TODOS OS TESTES DE SUB-BOTS E MEGA-POOL FORAM APROVADOS!');
  console.log('====================================================');
}

runAiManagerTests().catch(err => {
  console.error('\n❌ Falha nos testes de Sub-Bots e Mega-Pool:', err);
  process.exit(1);
});

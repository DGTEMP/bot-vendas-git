/**
 * TEST SUITE: Sub-Bot Feature Management by Owner, Devs & Bot Master
 */

const assert = require('assert');
const path = require('path');
const db = require('./src/db/database');
const models = require('./src/db/models');
const subBotFeatureService = require('./src/services/subBotFeatureService');

async function runTests() {
  console.log('🧪 Iniciando Testes de Controle de Funções de Sub-Bots...\n');

  // 1. Verificar catálogo de recursos padrão
  console.log('--- Teste 1: Catálogo e Defaults de Recursos ---');
  const defaults = models.getDefaultSubBotFeatures();
  assert.strictEqual(defaults.ai, true, 'Default ai deve ser true');
  assert.strictEqual(defaults.group_posts, true, 'Default group_posts deve ser true');
  assert.strictEqual(defaults.pv_chat, true, 'Default pv_chat deve ser true');
  assert.strictEqual(defaults.audio_voice, true, 'Default audio_voice deve ser true');
  assert.strictEqual(defaults.media_dl, true, 'Default media_dl deve ser true');
  assert.strictEqual(defaults.stickers, true, 'Default stickers deve ser true');
  assert.strictEqual(defaults.games, true, 'Default games deve ser true');
  assert.strictEqual(defaults.moderation, true, 'Default moderation deve ser true');
  assert.strictEqual(defaults.auto_heating, true, 'Default auto_heating deve ser true');
  console.log('✅ Catálogo padrão com 9 funções validado com sucesso.');

  // 2. Criar ou obter uma instância de teste para sub-bot
  console.log('\n--- Teste 2: Model Layer & Persistência ---');
  let testInst = db.prepare('SELECT * FROM whatsapp_army_instances WHERE id > 1 AND is_main = 0 LIMIT 1').get();
  if (!testInst) {
    const res = db.prepare(`
      INSERT INTO whatsapp_army_instances (name, phone, status, is_main, is_subbot, daily_limit)
      VALUES ('Chip de Teste Sub-Bot', '5511999998888', 'CONNECTED', 0, 1, 50)
    `).run();
    testInst = db.prepare('SELECT * FROM whatsapp_army_instances WHERE id = ?').get(res.lastInsertRowid);
  }
  const testId = testInst.id;
  console.log(`Usando Sub-Bot ID #${testId} para testes.`);

  // Testar getSubBotFeatures
  const initFeats = models.getSubBotFeatures(testId);
  assert(typeof initFeats === 'object', 'Features deve ser um objeto');
  console.log('Features iniciais carregadas:', initFeats);

  // Testar desativação de feature individual
  models.setSubBotFeature(testId, 'ai', false);
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'ai'), false, 'IA deve estar desativada');
  assert.strictEqual(models.canSubBotUseAi(testId), false, 'canSubBotUseAi deve retornar false');

  // Testar reativação de IA
  models.setSubBotFeature(testId, 'ai', true);
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'ai'), true, 'IA deve estar ativada');

  // Testar desativação de postagens em grupo
  models.setSubBotFeature(testId, 'group_posts', false);
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'group_posts'), false, 'group_posts deve estar desativada');
  assert.strictEqual(models.canSubBotPostToGroup(testId).allowed, false, 'canSubBotPostToGroup deve retornar false');

  models.setSubBotFeature(testId, 'group_posts', true);
  assert.strictEqual(models.canSubBotPostToGroup(testId).allowed, true, 'canSubBotPostToGroup deve retornar true quando ativado');
  console.log('✅ Model layer: get, set, sync e verificações booleanas aprovadas.');

  // 3. Teste em Lote / Seleção de Vários Sub-Bots
  console.log('\n--- Teste 3: Alteração em Lote / Seleção Múltipla ---');
  const batchResult = models.setSubBotFeatures([testId], { games: false, stickers: false });
  assert.strictEqual(batchResult.updatedCount, 1);
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'games'), false, 'Jogos deve ser false');
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'stickers'), false, 'Stickers deve ser false');

  // Reativar todos
  models.setSubBotFeatures([testId], { games: true, stickers: true });
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'games'), true, 'Jogos deve ser true');
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'stickers'), true, 'Stickers deve ser true');
  console.log('✅ Alteração em lote (setSubBotFeatures) aprovada.');

  // 4. Teste de Autorização (Dono, Devs, Bot Master vs Usuário Comum)
  console.log('\n--- Teste 4: Regras de Autorização Estrita ---');
  // Cadastrar dev temporário para testar
  const devPhone = '5511988887777';
  models.addSupportDev({ phone: devPhone, name: 'Dev Tester' });

  // Cenário A: Dono (isOwner = true)
  const authOwner = subBotFeatureService.isOperatorAuthorized({
    isOwner: true,
    isROwner: false,
    senderPhone: '5511999990000'
  });
  assert.strictEqual(authOwner, true, 'Dono deve ser autorizado');

  // Cenário B: Desenvolvedor de Suporte
  const authDev = subBotFeatureService.isOperatorAuthorized({
    isOwner: false,
    isROwner: false,
    senderPhone: devPhone
  });
  assert.strictEqual(authDev, true, 'Dev deve ser autorizado');

  // Cenário C: Bot Master (Matriz ID 1 / isMaster)
  const authMaster = subBotFeatureService.isOperatorAuthorized({
    isOwner: false,
    isROwner: false,
    isMaster: true,
    senderPhone: '5511977776666'
  });
  assert.strictEqual(authMaster, true, 'Bot Master deve ser autorizado');

  // Cenário D: Usuário Comum (não é dono, nem dev, nem master)
  const authRandom = subBotFeatureService.isOperatorAuthorized({
    isOwner: false,
    isROwner: false,
    isMaster: false,
    senderPhone: '5511911112222'
  });
  assert.strictEqual(authRandom, false, 'Usuário comum DEVE ser negado');
  console.log('✅ Autorizações validadas: Dono (OK), Dev (OK), Bot Master (OK), Usuário Comum (BLOQUEADO).');

  // 5. Teste de Normalização de Nomes de Recursos
  console.log('\n--- Teste 5: Normalização de Aliases das Funções ---');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('ia'), 'ai');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('inteligencia'), 'ai');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('divulgacao'), 'group_posts');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('grupos'), 'group_posts');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('pv'), 'pv_chat');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('audio'), 'audio_voice');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('voz'), 'audio_voice');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('musica'), 'media_dl');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('play'), 'media_dl');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('s'), 'stickers');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('figurinha'), 'stickers');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('cassino'), 'games');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('antilink'), 'moderation');
  assert.strictEqual(subBotFeatureService.normalizeFeatureKey('aquecer'), 'auto_heating');
  console.log('✅ Normalização de aliases validada com sucesso.');

  // 6. Teste de Bloqueio de Comandos por Feature Desativada
  console.log('\n--- Teste 6: Interceptação e Bloqueio de Comandos no Sub-Bot ---');
  // Desativar 'stickers' no sub-bot testId
  models.setSubBotFeature(testId, 'stickers', false);

  const checkSticker = subBotFeatureService.isCommandAllowedForSubBot(testId, 's');
  assert.strictEqual(checkSticker.allowed, false, 'Comando !s deve ser bloqueado quando stickers = false');
  assert.strictEqual(checkSticker.featureKey, 'stickers');

  const checkBrat = subBotFeatureService.isCommandAllowedForSubBot(testId, 'brat');
  assert.strictEqual(checkBrat.allowed, false, 'Comando !brat deve ser bloqueado quando stickers = false');

  // Reativar stickers
  models.setSubBotFeature(testId, 'stickers', true);
  const checkStickerAfter = subBotFeatureService.isCommandAllowedForSubBot(testId, 's');
  assert.strictEqual(checkStickerAfter.allowed, true, 'Comando !s deve ser permitido quando stickers = true');

  // Desativar 'media_dl' e testar !play
  models.setSubBotFeature(testId, 'media_dl', false);
  const checkPlay = subBotFeatureService.isCommandAllowedForSubBot(testId, 'play');
  assert.strictEqual(checkPlay.allowed, false, 'Comando !play deve ser bloqueado quando media_dl = false');

  // Desativar 'games' e testar !roleta
  models.setSubBotFeature(testId, 'games', false);
  const checkRoleta = subBotFeatureService.isCommandAllowedForSubBot(testId, 'roleta');
  assert.strictEqual(checkRoleta.allowed, false, 'Comando !roleta deve ser bloqueado quando games = false');

  // Reativar todos
  models.setSubBotFeatures([testId], { media_dl: true, games: true, stickers: true });
  console.log('✅ Interceptação de comandos no sub-bot funcionando perfeitamente.');

  // 7. Teste de Execução do Comando !subbotfunc
  console.log('\n--- Teste 7: Execução de Comando !subbotfunc via Service ---');
  let sentMessage = '';
  const mockSock = {
    sendMessage: async (to, content) => {
      sentMessage = content.text;
      return true;
    }
  };

  // Executar toggle via service como Dono
  await subBotFeatureService.handleCommand(
    mockSock,
    'status@broadcast',
    `!subbotfunc ${testId} ia off`,
    '5511999990000',
    false,
    false,
    true,
    false
  );
  assert(sentMessage.includes('DESATIVADA'), 'Resposta deve indicar que a função foi desativada');
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'ai'), false, 'IA deve estar desativada');

  // Reativar via comando
  await subBotFeatureService.handleCommand(
    mockSock,
    'status@broadcast',
    `!subbotfunc ${testId} ia on`,
    '5511999990000',
    false,
    false,
    true,
    false
  );
  assert(sentMessage.includes('ATIVADA'), 'Resposta deve indicar que a função foi ativada');
  assert.strictEqual(models.isSubBotFeatureEnabled(testId, 'ai'), true, 'IA deve estar ativada');

  // Consulta de status !subbotfuncoes
  await subBotFeatureService.handleCommand(
    mockSock,
    'status@broadcast',
    `!subbotfuncoes ${testId}`,
    '5511999990000',
    false,
    false,
    true,
    false
  );
  assert(sentMessage.includes('Sub-Bot #'), 'Deve exibir o painel de funções');
  console.log('✅ Comandos !subbotfunc e !subbotfuncoes validados com sucesso.');

  // Limpeza de dev de teste
  try {
    db.prepare('DELETE FROM support_devs WHERE phone = ?').run(devPhone);
  } catch (_) {}

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

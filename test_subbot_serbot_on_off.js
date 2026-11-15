const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('🧪 ============================================================');
  console.log('🧪 TEST SUITE: SUB-BOT LIGAR E DESLIGAR (!serbot off / !serbot on)');
  console.log('🧪 ============================================================\n');

  const models = require('./src/db/models');
  const whatsappArmyService = require('./src/services/whatsappArmyService');
  const spyFeatures = require('./src/services/spyFeaturesService');
  const botFleetAdminService = require('./src/services/botFleetAdminService');

  // 1. Cria ou reutiliza uma instância de teste de Sub-Bot
  let testInst = models.getArmyInstances().find(i => !i.is_main && i.name === 'Test SubBot OnOff');
  if (!testInst) {
    testInst = models.createArmyInstance({
      name: 'Test SubBot OnOff',
      phone: '5511998877665',
      daily_limit: 50,
      is_subbot: 1,
      terms_accepted: 1
    });
  }

  // Define status inicial como CONNECTED
  models.updateArmyInstance(testInst.id, {
    status: 'CONNECTED',
    is_paused: 0,
    phone: '5511998877665'
  });

  const testId = testInst.id;
  const testPhone = '5511998877665';
  console.log(`📋 Sub-Bot de Teste preparado: ID #${testId} (+${testPhone})`);

  // Mock socket para o sub-bot
  let lastSentMsg = null;
  const mockSubBotSock = {
    instanceId: testId,
    user: { id: `${testPhone}:1@s.whatsapp.net`, name: 'Test SubBot' },
    sendMessage: async (to, content) => {
      lastSentMsg = { to, content, text: content?.text || '' };
      return lastSentMsg;
    }
  };

  // Registra no activeSockets
  whatsappArmyService.activeSockets.set(testId, mockSubBotSock);

  // ── TESTE 1: !serbot off executado diretamente no WhatsApp do Sub-Bot ──
  console.log('\n[TEST 1] Executando !serbot off no próprio sub-bot...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    `${testPhone}@s.whatsapp.net`,
    '!serbot off',
    testPhone,
    false,
    false
  );

  assert(lastSentMsg, 'Deveria ter enviado mensagem de resposta');
  assert(lastSentMsg.text.includes('SUB-BOT DESLIGADO COM SUCESSO') || lastSentMsg.text.includes('DESLIGADO'), 'Mensagem deve confirmar desligamento');
  assert(lastSentMsg.text.includes('!serbot on'), 'Mensagem deve orientar como ligar novamente com !serbot on');
  assert(lastSentMsg.text.includes('NÃO precisará escanear QR Code') || lastSentMsg.text.includes('preservado'), 'Mensagem deve informar que login continua salvo');

  let instDb = models.getArmyInstanceById(testId);
  assert.strictEqual(instDb.is_paused, 1, 'is_paused no DB deve ser 1');
  assert.strictEqual(instDb.status, 'PAUSED', 'status no DB deve ser PAUSED');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), true, 'isInstancePaused no army service deve ser true');
  assert(whatsappArmyService.activeSockets.has(testId), 'Socket do sub-bot deve permanecer em memória para escutar !serbot on');
  console.log('✅ TEST 1 PASSOU: Sub-Bot desligado, em standby, credenciais preservadas!');

  // ── TESTE 2: Tentativa de mandar !serbot off novamente enquanto já desligado ──
  console.log('\n[TEST 2] Executando !serbot off enquanto já desligado...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    `${testPhone}@s.whatsapp.net`,
    '!serbot off',
    testPhone,
    false,
    false
  );
  assert(lastSentMsg.text.includes('já se encontra DESLIGADO') || lastSentMsg.text.includes('já está'), 'Deve alertar que já está desligado');
  console.log('✅ TEST 2 PASSOU: Alerta amigável de que já está pausado emitido com sucesso!');

  // ── TESTE 3: Consulta de status (!serbot status) ──
  console.log('\n[TEST 3] Executando !serbot status...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    `${testPhone}@s.whatsapp.net`,
    '!serbot status',
    testPhone,
    false,
    false
  );
  assert(lastSentMsg.text.includes('STATUS DO SUB-BOT'), 'Deve conter cabeçalho de status');
  assert(lastSentMsg.text.includes('DESLIGADO') || lastSentMsg.text.includes('Pausado'), 'Status deve indicar desligado');
  console.log('✅ TEST 3 PASSOU: Status reflete estado desligado com clareza!');

  // ── TESTE 4: Reativação via !serbot on sem precisar logar de novo ──
  console.log('\n[TEST 4] Executando !serbot on no sub-bot...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    `${testPhone}@s.whatsapp.net`,
    '!serbot on',
    testPhone,
    false,
    false
  );
  assert(lastSentMsg.text.includes('SUB-BOT LIGADO COM SUCESSO') || lastSentMsg.text.includes('LIGADO'), 'Mensagem deve confirmar que foi ligado');
  assert(lastSentMsg.text.includes('!serbot off'), 'Mensagem deve orientar como pausar');

  instDb = models.getArmyInstanceById(testId);
  assert.strictEqual(instDb.is_paused, 0, 'is_paused no DB deve voltar a 0');
  assert.strictEqual(instDb.status, 'CONNECTED', 'status no DB deve voltar a CONNECTED');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), false, 'isInstancePaused deve ser false');
  console.log('✅ TEST 4 PASSOU: Sub-Bot reativado com sucesso com 0 latência e sem re-login!');

  // ── TESTE 5: Tentativa de mandar !serbot on enquanto já está ligado ──
  console.log('\n[TEST 5] Executando !serbot on enquanto já ligado...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    `${testPhone}@s.whatsapp.net`,
    '!serbot on',
    testPhone,
    false,
    false
  );
  assert(lastSentMsg.text.includes('já está LIGADO'), 'Deve alertar que já está ligado');
  console.log('✅ TEST 5 PASSOU: Alerta de que já está ligado funcionando perfeitamente!');

  // ── TESTE 6: Controle remoto pelo Dono (!serbot off <id> e !serbot on <id>) ──
  console.log('\n[TEST 6] Dono desligando e religando remotamente via ID...');
  const mockMatrizSock = {
    instanceId: 1,
    user: { id: '554884702848@s.whatsapp.net', name: 'Matriz Master' },
    sendMessage: async (to, content) => {
      lastSentMsg = { to, content, text: content?.text || '' };
      return lastSentMsg;
    }
  };

  // Dono desliga
  lastSentMsg = null;
  await spyFeatures.handleSerBot(mockMatrizSock, '554884702848@s.whatsapp.net', `!serbot off ${testId}`, '554884702848', false, true);
  assert(lastSentMsg.text.includes('DESLIGADO'), 'Dono deve receber confirmação de desligamento');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), true, 'Instância deve estar pausada');

  // Dono liga
  lastSentMsg = null;
  await spyFeatures.handleSerBot(mockMatrizSock, '554884702848@s.whatsapp.net', `!serbot on ${testId}`, '554884702848', false, true);
  assert(lastSentMsg.text.includes('LIGADO'), 'Dono deve receber confirmação de religamento');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), false, 'Instância deve estar ativa');
  console.log('✅ TEST 6 PASSOU: Dono tem controle total remoto via ID!');

  // ── TESTE 7: Aliases !subbot off <id> e !subbot on <id> via botFleetAdminService ──
  console.log('\n[TEST 7] Testando !subbot off e !subbot on via botFleetAdminService...');
  const resOff = await botFleetAdminService.controlSubBot(testId, 'off');
  assert.strictEqual(resOff.action, 'paused');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), true);

  const resOn = await botFleetAdminService.controlSubBot(testId, 'on');
  assert.strictEqual(resOn.action, 'started');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), false);
  console.log('✅ TEST 7 PASSOU: botFleetAdminService suporta off e on nativamente!');

  // ── TESTE 8: Segurança / Não autorização por membro comum de grupo ──
  console.log('\n[TEST 8] Usuário aleatório em grupo tentando desligar o subbot alheio...');
  lastSentMsg = null;
  await spyFeatures.handleSerBot(
    mockSubBotSock,
    '1203630000000@g.us',
    '!serbot off',
    '5511999990000', // invasor
    true, // em grupo
    false // não é dono
  );
  assert(lastSentMsg.text.includes('ACESSO NEGADO') || lastSentMsg.text.includes('Apenas o Dono'), 'Deve bloquear invasor');
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), false, 'Instância NÃO deve ter sido pausada');
  console.log('✅ TEST 8 PASSOU: Proteção anti-invasor em grupos funcionando com sucesso!');

  // ── TESTE 9: API Web REST (pause, resume, toggle-pause) ──
  console.log('\n[TEST 9] Testando rotas Web pauseInstance e resumeInstance...');
  const apiPauseRes = await whatsappArmyService.pauseInstance(testId);
  assert.strictEqual(apiPauseRes.is_paused, 1);
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), true);

  const apiResumeRes = await whatsappArmyService.resumeInstance(testId);
  assert.strictEqual(apiResumeRes.is_paused, 0);
  assert.strictEqual(whatsappArmyService.isInstancePaused(testId), false);
  console.log('✅ TEST 9 PASSOU: Endpoints da API integrados 100%!');

  console.log('\n🎉 ============================================================');
  console.log('🎉 TODOS OS 9 TESTES DE !serbot off / !serbot on PASSARAM COM SUCESSO!');
  console.log('🎉 ============================================================');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});

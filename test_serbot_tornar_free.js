/**
 * test_serbot_tornar_free.js
 * =========================================================================
 * 🧪 Testes de Validação Completa: Tornar Sub-Bot Free via Chat e Painel
 * =========================================================================
 */

const assert = require('assert');
const models = require('./src/db/models');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const botFleetAdminService = require('./src/services/botFleetAdminService');
const http = require('http');
const { createServer } = require('./src/server/app');

function createMockSock() {
  const sent = [];
  return {
    sent,
    user: { id: '554884702848:1@s.whatsapp.net', name: 'Bot Matriz' },
    sendMessage: async (to, content, opts) => {
      const msg = { to, content, opts };
      sent.push(msg);
      return { key: { remoteJid: to, id: 'MOCK_MSG_' + Date.now() }, message: content };
    }
  };
}

async function run() {
  console.log('=============================================================');
  console.log('🤖 TESTES: TORNAR SUB-BOT FREE VIA !serbot, !subbot & PAINEL');
  console.log('=============================================================');

  // Cria ou recupera uma instância de teste sem termos aceitos
  let testSubBot = models.getArmyInstances().find(i => !i.is_main && i.terms_accepted === 0);
  if (!testSubBot) {
    testSubBot = models.createArmyInstance({
      name: 'Sub-Bot Teste Free Auto',
      phone: '5511999993344',
      is_subbot: 1,
      terms_accepted: 0
    });
  } else {
    // Garante que está como terms_accepted = 0 para o teste
    models.updateArmyInstance(testSubBot.id, { terms_accepted: 0, tokens_balance: 0 });
  }

  const testId = testSubBot.id;
  console.log(`📌 Usando Sub-Bot #${testId} (${testSubBot.name}) para os testes.`);

  // 1. Teste: !serbot free <id>
  console.log('\n--- Teste 1: !serbot free <id> ---');
  const sock1 = createMockSock();
  await spyFeatures.handleSerBot(sock1, '554884702848@s.whatsapp.net', `!serbot free ${testId}`, '554884702848', false, true);
  assert(sock1.sent.length > 0, 'Deve responder ao comando');
  const res1 = sock1.sent[0].content.text;
  assert(res1.includes('TORNADO SUB-BOT FREE COM SUCESSO'), 'Mensagem deve confirmar sucesso');
  assert(res1.includes(`Sub-Bot #${testId}`) || res1.includes(`#${testId}`), 'Deve citar o ID do Sub-Bot');
  assert(res1.includes('50 tokens diários'), 'Deve citar os 50 tokens diários');

  let updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1, 'terms_accepted deve ser 1');
  assert.strictEqual(updated.can_participate_meteoric, 1, 'can_participate_meteoric deve ser 1');
  assert(updated.tokens_balance >= 50, 'tokens_balance deve ser pelo menos 50');
  console.log('  ✅ [PASS] 1. !serbot free <id> torna o sub-bot em Free no banco e responde com sucesso.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 2. Teste: !serbot <id> free (ordem invertida)
  console.log('\n--- Teste 2: !serbot <id> free ---');
  const sock2 = createMockSock();
  await spyFeatures.handleSerBot(sock2, '554884702848@s.whatsapp.net', `!serbot ${testId} free`, '554884702848', false, true);
  assert(sock2.sent.length > 0);
  assert(sock2.sent[0].content.text.includes('TORNADO SUB-BOT FREE COM SUCESSO'));
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 2. !serbot <id> free (ordem invertida) funciona perfeitamente.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 3. Teste: !subbot free <id> via botFleetAdminService
  console.log('\n--- Teste 3: !subbot free <id> via botFleetAdminService ---');
  const fleetRes = await botFleetAdminService.controlSubBot(testId, 'free');
  assert.strictEqual(fleetRes.success, true);
  assert(fleetRes.message.includes('agora é um SUB-BOT FREE'));
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 3. botFleetAdminService.controlSubBot(id, "free") funciona e atualiza o banco.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 4. Teste: !subbot free <id> via PayBotHandler
  console.log('\n--- Teste 4: !subbot free <id> via PayBotHandler ---');
  const sock4 = createMockSock();
  whatsappBot.sock = sock4;
  await handler.handleMessage(whatsappBot, {
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_SUBBOT_FREE_HANDLER', participant: '554884702848@s.whatsapp.net' },
    message: { conversation: `!subbot free ${testId}` },
    pushName: 'Dono'
  }, sock4);
  const subbotReply = sock4.sent.find(m => m.content?.text && (m.content.text.includes('SUB-BOT FREE') || m.content.text.includes('agora é um SUB-BOT FREE')));
  assert(subbotReply, 'Handler deve processar !subbot free <id>');
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 4. Handler executa !subbot free <id> nativamente.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 5. Teste: !serbot free <id> via PayBotHandler
  console.log('\n--- Teste 5: !serbot free <id> via PayBotHandler ---');
  const sock5 = createMockSock();
  whatsappBot.sock = sock5;
  await handler.handleMessage(whatsappBot, {
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_SERBOT_FREE_HANDLER', participant: '554884702848@s.whatsapp.net' },
    message: { conversation: `!serbot free ${testId}` },
    pushName: 'Dono'
  }, sock5);
  const serbotReply = sock5.sent.find(m => m.content?.text && m.content.text.includes('TORNADO SUB-BOT FREE COM SUCESSO'));
  assert(serbotReply, 'Handler deve processar !serbot free <id>');
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 5. Handler executa !serbot free <id> nativamente.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 6. Teste: Dono digitando sem prefixo "serbot free <id>"
  console.log('\n--- Teste 6: Dono sem prefixo "serbot free <id>" ---');
  const sock6 = createMockSock();
  whatsappBot.sock = sock6;
  await handler.handleMessage(whatsappBot, {
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_SERBOT_NOPREFIX', participant: '554884702848@s.whatsapp.net' },
    message: { conversation: `serbot free ${testId}` },
    pushName: 'Dono'
  }, sock6);
  const noPrefixReply = sock6.sent.find(m => m.content?.text && m.content.text.includes('TORNADO SUB-BOT FREE COM SUCESSO'));
  assert(noPrefixReply, 'Dono deve conseguir rodar serbot sem prefixo');
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 6. Dono pode digitar "serbot free <id>" sem nenhum prefixo.');

  // Reseta para o próximo teste
  models.updateArmyInstance(testId, { terms_accepted: 0 });

  // 7. Teste: Endpoint HTTP POST /api/army/instances/:id/make-free
  console.log('\n--- Teste 7: Endpoint HTTP /api/army/instances/:id/make-free ---');
  const expressApp = createServer();
  const server = http.createServer(expressApp);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/army/instances/${testId}/make-free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.message.includes('agora é um Sub-Bot Free'));
    updated = models.getArmyInstanceById(testId);
    assert.strictEqual(updated.terms_accepted, 1);
    console.log('  ✅ [PASS] 7. POST /api/army/instances/:id/make-free funciona via REST API.');
  } finally {
    server.close();
  }

  // 8. Teste: Desbloqueio automático de Sub-Bot banido ao ser tornado Free pelo Dono
  console.log('\n--- Teste 8: Desbloqueio automático de sub-bot banido pelo Dono ---');
  models.blockSubBotFree(testId, 'Teste de bloqueio');
  assert.strictEqual(models.getArmyInstanceById(testId).free_blocked, 1);

  const sock8 = createMockSock();
  await spyFeatures.handleSerBot(sock8, '554884702848@s.whatsapp.net', `!serbot free ${testId}`, '554884702848', false, true);
  updated = models.getArmyInstanceById(testId);
  assert.strictEqual(updated.free_blocked, 0, 'Dono tornando free deve desbloquear o sub-bot');
  assert.strictEqual(updated.terms_accepted, 1);
  console.log('  ✅ [PASS] 8. Dono torna sub-bot free e desbloqueia chip banido em uma única etapa.');

  // 9. Teste: Qualquer número mandando apenas "!serbot" no privado (Fluxo Jadibot Puro)
  console.log('\n--- Teste 9: Qualquer número mandando apenas "!serbot" no privado ---');
  const userPhone = '5511977771234';
  const sock9 = createMockSock();
  await spyFeatures.handleSerBot(sock9, `${userPhone}@s.whatsapp.net`, '!serbot', userPhone, false, false);
  assert(sock9.sent.length >= 2, 'Deve enviar aviso de início e mensagem de pareamento');
  const jadibotReply = sock9.sent.find(m => m.content?.text && (m.content.text.includes('JADIBOT') || m.content.text.includes('CÓDIGO DE CONEXÃO')));
  assert(jadibotReply, 'Deve conter mensagem do Jadibot com código');
  assert(jadibotReply.content.text.includes('PASSO A PASSO NO SEU WHATSAPP'), 'Deve conter instruções passo a passo');
  assert(jadibotReply.content.text.includes('TERMOS DE PARTICIPAÇÃO (ACEITOS AUTOMATICAMENTE AO PAREAR)'), 'Deve conter termos aceitos automaticamente');
  assert(jadibotReply.content.text.includes('50 TOKENS GRÁTIS'), 'Deve citar os 50 tokens gratuitos');

  // Valida que a instância foi criada/atualizada com terms_accepted = 1
  const allInsts = models.getArmyInstances();
  const userInst = allInsts.find(i => i.phone === userPhone);
  assert(userInst, 'Deve existir instância para o número');
  assert.strictEqual(userInst.terms_accepted, 1, 'Termos devem ser aceitos automaticamente');
  assert.strictEqual(userInst.is_subbot, 1, 'Deve estar como subbot');
  console.log('  ✅ [PASS] 9. Qualquer número enviando apenas "!serbot" gera código Jadibot com termos aceitos automaticamente.');

  // 10. Teste: Qualquer número mandando "!jadibot" no grupo
  console.log('\n--- Teste 10: Qualquer número mandando "!jadibot" no grupo ---');
  const groupUserPhone = '5521988884321';
  const groupJid = '120363009999999999@g.us';
  const sock10 = createMockSock();
  await spyFeatures.handleSerBot(sock10, groupJid, '!jadibot', groupUserPhone, true, false);
  const groupNotice = sock10.sent.find(m => m.to === groupJid && m.content.text.includes('Sub-Bot Grátis'));
  assert(groupNotice, 'Deve conter aviso no grupo com o código');
  assert(groupNotice.content.text.includes('Seu código de 8 dígitos para se tornar Sub-Bot Grátis é'), 'Deve conter o código no grupo');
  assert(groupNotice.content?.mentions?.includes(`${groupUserPhone}@s.whatsapp.net`), 'Deve mencionar o participante');
  console.log('  ✅ [PASS] 10. !jadibot no grupo menciona usuário e entrega código sem fricção.');

  console.log('\n=============================================================');
  console.log('🎉 TODOS OS 10 TESTES DE JADIBOT & SUB-BOT FREE PASSARAM 100%!');
  console.log('=============================================================');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});

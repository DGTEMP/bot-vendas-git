/**
 * TEST SUITE: CONTAS DE TESTE NO PRIVADO, ANTI-LOOP SELETIVO E ROTEAMENTO @LID
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const models = require('./src/db/models');
const subbotPrivateFilter = require('./src/services/subbotPrivateFilterService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');

async function run() {
  console.log('🧪 Iniciando Testes de Contas de Teste no Privado & Resolução LID...\n');
  let passed = 0;

  // 1. Cria conta de teste registrada no banco como DISCONNECTED
  const testAccountPhone = '5511977770099';
  const testInst = models.createArmyInstance({
    name: 'Conta de Teste do Usuário',
    phone: testAccountPhone,
    status: 'DISCONNECTED',
    active: 1
  });

  // 1.1 Contas desconectadas NÃO devem ser consideradas robôs da frota
  const isFleet = subbotPrivateFilter.isFleetBotNumber(testAccountPhone);
  assert.strictEqual(isFleet, false, 'Conta de teste desconectada NÃO deve ser classificada como robô da frota');
  console.log('  ✅ [PASS] 1.1 Contas de teste com status DISCONNECTED não são bloqueadas como robô da frota');
  passed++;

  // 1.2 Outgoing Guard NÃO cancela mensagens enviadas pelo bot para a conta de teste
  let dispatchedPayload = null;
  const mockMasterSock = {
    instanceId: 1,
    user: { id: '254102815766:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      dispatchedPayload = { jid, content, options };
      return { key: { id: 'OUT_TEST_' + Date.now(), remoteJid: jid } };
    }
  };

  const sendResult = await whatsappBot.sendMessage(
    `${testAccountPhone}@s.whatsapp.net`,
    'Olá! Esta é uma resposta do Bot Master para sua conta de teste.',
    {},
    mockMasterSock
  );
  assert.notStrictEqual(sendResult, false, 'Envio não deve ser cancelado para conta de teste');
  assert.ok(dispatchedPayload, 'Mensagem deve ser despachada pelo socket');
  console.log('  ✅ [PASS] 1.2 Bot Master envia mensagens normalmente para a conta de teste (sem cancelamento silencioso)');
  passed++;

  // 1.3 Inbound: Mensagem no privado da conta de teste para o Bot Master deve ser processada pelo handler
  let handlerReplied = false;
  let replyText = '';
  const mockConn = {
    instanceId: 1,
    user: { id: '254102815766:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      handlerReplied = true;
      replyText = typeof content === 'object' ? content.text : content;
      return { key: { id: 'RESP_' + Date.now(), remoteJid: jid } };
    }
  };

  const rawTestMsg = {
    key: {
      remoteJid: `${testAccountPhone}@s.whatsapp.net`,
      id: 'IN_TEST_' + Date.now(),
      fromMe: false
    },
    message: {
      conversation: '!ping'
    },
    pushName: 'Desenvolvedor Teste'
  };

  await handler.handleMessage(whatsappBot, rawTestMsg, mockConn);
  assert.strictEqual(handlerReplied, true, 'Handler deve responder ao comando !ping da conta de teste');
  assert.ok(replyText.includes('PONG') || replyText.includes('ms'), 'Resposta deve conter resultado do ping');
  console.log('  ✅ [PASS] 1.3 Bot Master responde a comandos no privado vindos de contas de teste');
  passed++;

  // 2. Resolução de mensagens recebidas com JID @lid
  console.log('\n--- Testes de Resolução e Roteamento de JID @lid ---');
  let lidRepliedJid = '';
  const mockLidConn = {
    instanceId: 1,
    user: { id: '254102815766:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      lidRepliedJid = jid;
      return { key: { id: 'LID_RESP_' + Date.now(), remoteJid: jid } };
    }
  };

  const rawLidMsg = {
    key: {
      remoteJid: '998877665544332211@lid',
      remoteJidAlt: '5511966554433@s.whatsapp.net',
      id: 'LID_MSG_' + Date.now(),
      fromMe: false
    },
    message: {
      conversation: '!ping'
    },
    pushName: 'Cliente via LID'
  };

  await handler.handleMessage(whatsappBot, rawLidMsg, mockLidConn);
  assert.strictEqual(lidRepliedJid, '5511966554433@s.whatsapp.net', 'Handler deve converter @lid para @s.whatsapp.net canônico');
  console.log('  ✅ [PASS] 2.1 JID @lid resolvido automaticamente para telefone @s.whatsapp.net via remoteJidAlt');
  passed++;

  // 3. Robô ativo na frota continua bloqueado contra loop conversacional
  console.log('\n--- Teste de Anti-Loop entre Robôs Ativos ---');
  const activeSubBotPhone = '5511988889911';
  const activeInst = models.createArmyInstance({
    name: 'Sub-Bot Conectado Ativo',
    phone: activeSubBotPhone,
    status: 'CONNECTED',
    active: 1
  });

  const isFleetActive = subbotPrivateFilter.isFleetBotNumber(activeSubBotPhone);
  assert.strictEqual(isFleetActive, true, 'Sub-Bot conectado e ativo DEVE ser identificado como robô da frota');

  // Envio conversational para bot ativo deve ser bloqueado pelo Outgoing Guard
  const loopSendResult = await whatsappBot.sendMessage(
    `${activeSubBotPhone}@s.whatsapp.net`,
    'Olá colega bot, vamos bater papo no privado?',
    {},
    mockMasterSock
  );
  assert.strictEqual(loopSendResult, false, 'Outgoing Guard deve bloquear diálogo casual com outro robô ativo');
  console.log('  ✅ [PASS] 3.1 Anti-Loop continua 100% ativo para robôs que estão realmente CONECTADOS');
  passed++;

  // Limpeza
  try {
    const db = require('./src/db/database');
    db.prepare('DELETE FROM whatsapp_army_instances WHERE id IN (?, ?)').run(testInst.id, activeInst.id);
  } catch (_) {}

  console.log(`\n🎉 SUCESSO: Todos os ${passed} testes de liberação de contas de teste e roteamento LID passaram!`);
}

run().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

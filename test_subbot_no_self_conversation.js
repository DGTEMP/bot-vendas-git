const assert = require('assert');
const models = require('./src/db/models');
const groupHeatingService = require('./src/services/groupHeatingService');
const socialListeningService = require('./src/services/socialListeningService');
const whatsappBot = require('./src/bots/whatsappBot');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const subbotPrivateFilter = require('./src/services/subbotPrivateFilterService');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: ANTI-SELF-CHAT & SUB-BOT ISOLADO NO GRUPO (SEM MONÓLOGO)');
  console.log('========================================================================\n');

  const groupJid = '120363999999999999@g.us';
  const subbotPhone = '5511999998888';

  // 1. Cria ou atualiza sub-bot isolado no banco
  const created = models.createArmyInstance({
    name: 'Sub-Bot Único Teste',
    phone: subbotPhone,
    status: 'CONNECTED',
    is_subbot: 1,
    active: 1
  });
  const subbotInstanceId = created.id;
  models.updateArmyInstance(subbotInstanceId, { status: 'CONNECTED', active: 1, phone: subbotPhone });

  // Socket simulado do Sub-Bot
  let messagesSent = [];
  const mockSubBotSock = {
    instanceId: subbotInstanceId,
    user: { id: `${subbotPhone}:1@s.whatsapp.net`, lid: '99887766554433@lid' },
    sendMessage: async (jid, content) => {
      messagesSent.push({ jid, content });
      const msgId = 'MSG_MOCK_' + Date.now() + '_' + Math.random();
      whatsappArmyService.registerLegitimateDispatchKey(msgId);
      whatsappBot.trackSentBotMessage(msgId, jid, mockSubBotSock);
      return { key: { id: msgId, remoteJid: jid, fromMe: true } };
    },
    sendPresenceUpdate: async () => {},
    groupMetadata: async (jid) => ({
      id: jid,
      participants: [
        { id: `${subbotPhone}@s.whatsapp.net`, admin: null },
        { id: '5511988881111@s.whatsapp.net', admin: 'admin' }, // Usuário humano
        { id: '5511988882222@s.whatsapp.net', admin: null }      // Usuário humano
      ]
    })
  };

  whatsappArmyService.activeSockets.set(subbotInstanceId, mockSubBotSock);

  try {
    // ------------------------------------------------------------------------
    console.log('--- Teste 1: getSubBotsInGroup quando só existe 1 sub-bot no grupo ---');
    // ------------------------------------------------------------------------
    const foundBots = await groupHeatingService.getSubBotsInGroup(groupJid, mockSubBotSock);
    console.log(`Sub-bots encontrados no grupo: ${foundBots.length}`);
    console.log('[DEBUG foundBots]:', JSON.stringify(foundBots.map(b => ({ id: b.id, name: b.name, phone: b.phone }))));
    assert.strictEqual(foundBots.length, 1, 'Deve encontrar rigorosamente apenas 1 sub-bot presente');
    assert.strictEqual(foundBots[0].id, subbotInstanceId, 'O sub-bot encontrado deve ser o Sub-Bot #8888');
    console.log('✅ Teste 1 passou: Rigorosamente apenas 1 sub-bot detectado no grupo!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 2: groupHeatingService deve BLOQUEAR diálogo se houver apenas 1 sub-bot ---');
    // ------------------------------------------------------------------------
    const heatingRes = await groupHeatingService.handleGroupTopicTrigger(groupJid, {
      product_name: 'iPhone 15 Pro Max',
      keywords: 'iphone, celular',
      affiliate_url: 'https://shopee.com.br/iphone15'
    }, 'alguém recomenda iphone?', { sock: mockSubBotSock });

    assert.strictEqual(heatingRes.triggered, false, 'Não deve acionar diálogo');
    assert.strictEqual(heatingRes.reason, 'LESS_THAN_TWO_SUBBOTS', 'Motivo deve ser LESS_THAN_TWO_SUBBOTS');
    console.log('✅ Teste 2 passou: Aquecimento bloqueado porque não há múltiplos sub-bots!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 3: Sub-bot envia produto minerado no grupo ---');
    // ------------------------------------------------------------------------
    messagesSent = [];
    const productPostText = '🔥 ACHADINHO IMPERDÍVEL! iPhone 15 Pro Max em super promoção por R$ 5.999! Garanta o seu pelo link: https://shopee.com.br/iphone15';
    const postRes = await mockSubBotSock.sendMessage(groupJid, { text: productPostText });
    assert.strictEqual(messagesSent.length, 1, 'Produto enviado pelo sub-bot');
    const sentMsgId = postRes.key.id;
    console.log(`Produto enviado. MessageId: ${sentMsgId}`);
    console.log('✅ Teste 3 passou: Produto anunciado com sucesso!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 4: Sub-bot recebe a sua PRÓPRIA mensagem com fromMe=true ---');
    // ------------------------------------------------------------------------
    messagesSent = [];
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupJid, id: sentMsgId, fromMe: true, participant: `${subbotPhone}@s.whatsapp.net` },
      message: { conversation: productPostText }
    }, mockSubBotSock);

    assert.strictEqual(messagesSent.length, 0, 'Sub-bot NÃO deve responder a si mesmo quando fromMe=true');
    console.log('✅ Teste 4 passou: Silêncio total para sua própria mensagem (fromMe=true)!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 5: Sub-bot recebe a sua PRÓPRIA mensagem com fromMe=false (echo do WhatsApp) ---');
    // ------------------------------------------------------------------------
    messagesSent = [];
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupJid, id: sentMsgId, fromMe: false, participant: `${subbotPhone}@s.whatsapp.net` },
      message: { conversation: productPostText }
    }, mockSubBotSock);

    assert.strictEqual(messagesSent.length, 0, 'Sub-bot NÃO deve responder a si mesmo mesmo que fromMe=false');
    console.log('✅ Teste 5 passou: Silêncio total para echo do WhatsApp (fromMe=false com mesmo número/id)!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 6: Mensagem de outro robô da frota em grupo não deve gerar resposta ---');
    // ------------------------------------------------------------------------
    // Simula mensagem enviada por outro robô ativo registrado na frota
    const otherBotPhone = '5511966667777';
    const otherBotInst = models.createArmyInstance({
      name: 'Outro Bot Conectado da Frota',
      phone: otherBotPhone,
      status: 'CONNECTED',
      active: 1
    });

    messagesSent = [];
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupJid, id: 'OTHER_BOT_MSG_' + Date.now(), fromMe: false, participant: `${otherBotPhone}@s.whatsapp.net` },
      message: { conversation: 'Galera, comprei nesse link e chegou super rápido: https://shopee.com.br/teste' }
    }, mockSubBotSock);

    assert.strictEqual(messagesSent.length, 0, 'Sub-bot NÃO deve responder a falas de outro robô da frota no grupo');
    console.log('✅ Teste 6 passou: Sub-bot ignorou mensagem de outro robô da frota no grupo!');

    // ------------------------------------------------------------------------
    console.log('\n--- Teste 7: Mensagem de um CLIENTE HUMANO REAL no grupo continua funcionando ---');
    // ------------------------------------------------------------------------
    messagesSent = [];
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupJid, id: 'HUMAN_MSG_' + Date.now(), fromMe: false, participant: '5521998765432@s.whatsapp.net' },
      message: { conversation: '!ping' }
    }, mockSubBotSock);

    assert.strictEqual(messagesSent.length, 1, 'Comando !ping de usuário humano deve ser respondido');
    console.log('[DEBUG Teste 7 resposta]:', JSON.stringify(messagesSent[0].content));
    const txt = messagesSent[0].content?.text || '';
    assert.ok(txt.length > 0, 'Resposta recebida');
    console.log('✅ Teste 7 passou: Comandos de usuários humanos funcionam perfeitamente!');

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS 7 TESTES DE ANTI-SELF-CHAT E SUB-BOT ISOLADO PASSARAM 100%!');
    console.log('========================================================================');
    process.exit(0);

  } finally {
    whatsappArmyService.activeSockets.delete(subbotInstanceId);
    try {
      const db = require('./src/db/database');
      db.prepare('DELETE FROM whatsapp_army_instances WHERE name IN (?, ?)').run('Sub-Bot Único Teste', 'Outro Bot Conectado da Frota');
    } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

const assert = require('assert');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');

async function runTests() {
  console.log('🧪 Iniciando testes da Regra Anti-Delete com estrutura /fake...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  const testGroup = '120363000999999999@g.us';
  const authorPhone = '5511999990001';
  const authorJid = `${authorPhone}@s.whatsapp.net`;
  const adminPhone = '5511999990002';
  const adminJid = `${adminPhone}@s.whatsapp.net`;

  // 1. Configuração e ativação/desativação da regra
  test('1. models.isAntiDeleteActive retorna falso por padrão para grupo novo', () => {
    models.setSetting(`ANTIDELETE_${testGroup}`, 'false');
    const active = models.isAntiDeleteActive(testGroup);
    assert.strictEqual(active, false);
  });

  test('2. models.isAntiDeleteActive retorna verdadeiro quando ativado', () => {
    models.setSetting(`ANTIDELETE_${testGroup}`, 'true');
    const active = models.isAntiDeleteActive(testGroup);
    assert.strictEqual(active, true);
  });

  // 2. Teste via whatsappBot comandos regex (!antidelete, !proibidodeletar, etc)
  await asyncTest('3. whatsappBot regex processa !antidelete on / off / status', async () => {
    let sentMessages = [];
    const mockSock = {
      user: { id: '5511888880000:1@s.whatsapp.net' },
      groupMetadata: async (jid) => ({
        participants: [{ id: adminJid, admin: 'admin' }]
      }),
      sendMessage: async (jid, content, options) => {
        sentMessages.push({ jid, content, options });
        return { key: { id: 'MOCK_BOT_REPLY' } };
      }
    };
    whatsappBot.sock = mockSock;
    handler.groupMetadataCache.clear();

    // !antidelete on
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, fromMe: false, participant: adminJid, id: 'CMD_ON' },
      message: { conversation: '!antidelete on' }
    }, mockSock);

    assert(sentMessages.length > 0);
    assert(sentMessages[sentMessages.length - 1].content.text.includes('REGRA ATIVADA: PROIBIDO APAGAR'));
    assert.strictEqual(models.isAntiDeleteActive(testGroup), true);

    // !proibidodeletar off
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, fromMe: false, participant: adminJid, id: 'CMD_OFF' },
      message: { conversation: '!proibidodeletar off' }
    }, mockSock);

    assert(sentMessages[sentMessages.length - 1].content.text.includes('REGRA ANTI-DELETE DESATIVADA'));
    assert.strictEqual(models.isAntiDeleteActive(testGroup), false);

    // !regraantidelete (status)
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, fromMe: false, participant: adminJid, id: 'CMD_STATUS' },
      message: { conversation: '!regraantidelete' }
    }, mockSock);

    assert(sentMessages[sentMessages.length - 1].content.text.includes('Regra Anti-Delete'));
  });

  // 3. Teste via PayBotHandler nativo
  await asyncTest('4. PayBotHandler registra e executa comando antidelete com aliases', async () => {
    assert(handler.commands.has('antidelete'));

    let replyText = '';
    const fakeMsg = {
      chat: testGroup,
      isGroup: true,
      senderNumber: adminPhone,
      fromMe: false,
      reply: (t) => { replyText = t; return t; }
    };

    // Ativa via handler
    await handler.commands.get('antidelete').run(fakeMsg, { args: ['on'], isAdmin: true, isOwner: false });
    assert(replyText.includes('PROIBIDO APAGAR MENSAGENS'));
    assert.strictEqual(models.isAntiDeleteActive(testGroup), true);

    // Desativa via handler
    await handler.commands.get('antidelete').run(fakeMsg, { args: ['off'], isAdmin: true, isOwner: false });
    assert(replyText.includes('REGRA ANTI-DELETE DESATIVADA'));
    assert.strictEqual(models.isAntiDeleteActive(testGroup), false);
  });

  // Ativa a regra para os testes de intercepção
  models.setSetting(`ANTIDELETE_${testGroup}`, 'true');

  // 4. Teste de Self-Delete (Usuário apaga a própria mensagem)
  await asyncTest('5. Self-Delete: bot reenvia com fakeQuoted e ironia/não acredito', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
        return { key: { id: 'RESP_REVOKE_1' } };
      }
    };

    const msgId = 'USER_MSG_SECRET_1';
    const secretText = 'Gente, cometi uma gafe enorme aqui!';

    // Registra a mensagem recebida
    spyFeatures.recordMessage({
      key: { remoteJid: testGroup, participant: authorJid, id: msgId, fromMe: false },
      message: { conversation: secretText },
      pushName: 'João Silva'
    });

    // Usuário apaga a própria mensagem (deleterJid === authorJid)
    await spyFeatures.handleRevoke(mockSock, testGroup, msgId, authorJid);

    assert.strictEqual(sent.length, 1, 'Deve enviar exatamente 1 mensagem com o fake quote');
    const msgSent = sent[0];

    // Valida JID de destino
    assert.strictEqual(msgSent.jid, testGroup);

    // Valida citação fake
    assert(msgSent.options?.quoted, 'Deve conter quoted');
    assert.strictEqual(msgSent.options.quoted.message.conversation, secretText);
    assert.strictEqual(msgSent.options.quoted.key.participant, authorJid);
    assert.strictEqual(msgSent.options.quoted.key.remoteJid, testGroup);
    assert.strictEqual(msgSent.options.noVerificado, true);

    // Valida texto e ironia
    assert(
      msgSent.content.text.includes('Não acredito') ||
      msgSent.content.text.includes('audácia') ||
      msgSent.content.text.includes('sigilo') ||
      msgSent.content.text.includes('desespero') ||
      msgSent.content.text.includes('histórico') ||
      msgSent.content.text.includes('apagou'),
      'Texto deve conter ironia de auto-exclusão'
    );
    assert(msgSent.content.mentions.includes(authorJid), 'Deve mencionar o autor da mensagem');
  });

  // 5. Teste de Admin-Delete (Admin apaga mensagem de outro membro)
  await asyncTest('6. Admin-Delete: bot reenvia com fakeQuoted e ironia sobre censura de admin', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
        return { key: { id: 'RESP_REVOKE_2' } };
      }
    };

    const msgId = 'USER_MSG_SECRET_2';
    const originalText = 'Opinião polêmica que o admin não gostou!';

    spyFeatures.recordMessage({
      key: { remoteJid: testGroup, participant: authorJid, id: msgId, fromMe: false },
      message: { extendedTextMessage: { text: originalText } },
      pushName: 'João Silva'
    });

    // Admin apaga a mensagem do João (deleterJid !== authorJid)
    await spyFeatures.handleRevoke(mockSock, testGroup, msgId, adminJid);

    assert.strictEqual(sent.length, 1);
    const msgSent = sent[0];

    // Valida citação fake
    assert.strictEqual(msgSent.options.quoted.message.conversation, originalText);
    assert.strictEqual(msgSent.options.quoted.key.participant, authorJid);

    // Valida menções (ambos: admin que apagou e autor da mensagem)
    assert(msgSent.content.mentions.includes(authorJid), 'Deve mencionar o autor');
    assert(msgSent.content.mentions.includes(adminJid), 'Deve mencionar o admin deleter');

    // Valida ironia contextual de admin censurando
    assert(
      msgSent.content.text.includes('admin') ||
      msgSent.content.text.includes('censurar') ||
      msgSent.content.text.includes('passar o pano'),
      'Texto deve conter ironia referente ao admin apagando'
    );
  });

  // 6. Teste de Mensagem com Mídia apagada
  await asyncTest('7. Mídia apagada: bot reenvia texto fakeQuoted e mídias recuperadas', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
        return { key: { id: 'RESP_REVOKE_3' } };
      }
    };

    const msgId = 'MEDIA_MSG_1';
    const fakeBuffer = Buffer.from('FAKEMEDIA_IMAGE_CONTENT');

    // Mock extractMediaBuffer para retornar imagem
    const origExtract = spyFeatures.extractMediaBuffer;
    spyFeatures.extractMediaBuffer = async () => ({ type: 'image', buffer: fakeBuffer });

    try {
      spyFeatures.recordMessage({
        key: { remoteJid: testGroup, participant: authorJid, id: msgId, fromMe: false },
        message: { imageMessage: { caption: 'Foto de documento apagada!' } },
        pushName: 'João Silva'
      });

      await spyFeatures.handleRevoke(mockSock, testGroup, msgId, authorJid);

      assert.strictEqual(sent.length, 2, 'Deve enviar o fakeQuoted e a imagem recuperada');
      assert.strictEqual(sent[0].options.quoted.message.conversation, 'Foto de documento apagada!');
      assert(sent[1].content.image, 'Segunda mensagem deve ser a imagem');
      assert(sent[1].content.caption.includes('recuperada'));
    } finally {
      spyFeatures.extractMediaBuffer = origExtract;
    }
  });

  // 7. Teste de exclusão intencional de mensagem do bot via !d (NÃO deve reenviar)
  await asyncTest('8. Mensagem do bot apagada (ex: cancelada via !d): Anti-Delete NÃO reenvia', async () => {
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
        return { key: { id: 'RESP_REVOKE_BOT' } };
      }
    };

    const botMsgId = 'BOT_AUTO_MESSAGE_1';
    // Registra a mensagem enviada pelo robô no tracker
    whatsappBot.trackSentBotMessage(botMsgId, testGroup, mockSock);

    spyFeatures.recordMessage({
      key: { remoteJid: testGroup, participant: '5511888880000@s.whatsapp.net', id: botMsgId, fromMe: true },
      message: { conversation: 'Mensagem de anúncio do bot que foi deletada' }
    });

    // Admin apaga ou cancela o envio da mensagem do bot via !d
    await spyFeatures.handleRevoke(mockSock, testGroup, botMsgId, adminJid);

    assert.strictEqual(sent.length, 0, 'Não deve reenviar mensagens do próprio bot que foram apagadas');
  });

  // 8. Teste quando a regra está DESATIVADA no grupo
  await asyncTest('9. Quando a regra Anti-Delete estiver desativada: ignorar revogações', async () => {
    models.setSetting(`ANTIDELETE_${testGroup}`, 'false');
    const sent = [];
    const mockSock = {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
      }
    };

    const msgId = 'USER_MSG_SECRET_OFF';
    spyFeatures.recordMessage({
      key: { remoteJid: testGroup, participant: authorJid, id: msgId, fromMe: false },
      message: { conversation: 'Mensagem apagada com regra desligada' }
    });

    await spyFeatures.handleRevoke(mockSock, testGroup, msgId, authorJid);

    assert.strictEqual(sent.length, 0, 'Nenhuma mensagem deve ser enviada quando Anti-Delete está desativado');
  });

  console.log(`\n========================================`);
  console.log(`📊 RESULTADO DOS TESTES: ${passed}/${total} PASSARAM`);
  console.log(`========================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

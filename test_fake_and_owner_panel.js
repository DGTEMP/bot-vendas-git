const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const tunnelService = require('./src/services/tunnelService');

let passedTests = 0;
let totalTests = 0;

async function it(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

console.log('\n======================================================');
console.log('🧪 TESTES: COMANDO !FAKE & ACESSO !PAINEL (DONO / LID)');
console.log('======================================================\n');

(async () => {
  // Configura dados do Dono
  models.setSetting('OWNER_PHONE', '554884702848');
  models.setSetting('OWNER_WHATSAPP', '554884702848');
  models.setSetting('ADMIN_PHONE', '554884702848');
  models.setSetting('OWNER_LID', '151866151276711');

  // --- 1. TESTES DO COMANDO !PAINEL & RECONHECIMENTO DO DONO (INCLUINDO LID) ---
  console.log('--- 1. Reconhecimento do Dono e Comando !painel (Telefone e LID) ---');

  await it('isOwner deve reconhecer telefone direto (554884702848, 4884702848, 5548984702848)', () => {
    assert.strictEqual(whatsappBot.isOwner('554884702848', false), true);
    assert.strictEqual(whatsappBot.isOwner('4884702848', false), true);
    assert.strictEqual(whatsappBot.isOwner('5548984702848', false), true);
    assert.strictEqual(whatsappBot.isOwner('48984702848', false), true);
  });

  await it('isOwner deve reconhecer o LID oficial do WhatsApp do Dono (151866151276711)', () => {
    assert.strictEqual(whatsappBot.isOwner('151866151276711', false), true);
    assert.strictEqual(whatsappBot.isOwner('151866151276711@lid', false), true);
  });

  await it('isOwner deve rejeitar número de terceiro comum', () => {
    assert.strictEqual(whatsappBot.isOwner('5511999998888', false), false);
    assert.strictEqual(whatsappBot.isOwner('5511988887777@s.whatsapp.net', false), false);
  });

  await it('!painel enviado pelo Dono com LID (151866151276711@lid) deve conceder acesso com link HTTPS', async () => {
    let sentMsg = null;
    let target = null;

    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        target = jid;
        sentMsg = content.text || content;
        return { key: { id: 'TEST_MSG_1' } };
      }
    };

    tunnelService.url = 'https://paybot-test-admin.trycloudflare.com';

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '151866151276711@lid',
        fromMe: false
      },
      pushName: 'Dono Supremo',
      message: {
        conversation: '!painel'
      }
    }, mockSock);

    assert(sentMsg, 'Dono deve receber resposta ao enviar !painel');
    assert(!sentMsg.includes('ACESSO NEGADO'), 'NUNCA deve dizer ACESSO NEGADO para o Dono');
    assert(sentMsg.includes('PAINEL WEB') || sentMsg.includes('ACESSO REMOTO'), `Deve conter cabeçalho do painel: ${sentMsg}`);
    assert(sentMsg.includes('https://paybot-test-admin.trycloudflare.com') || sentMsg.includes('http://localhost:3000'), 'Deve conter link seguro');
  });

  await it('!painel enviado pelo Dono em Grupo deve encaminhar link confidencial no PV', async () => {
    let groupMsg = '';
    let pvMsg = '';
    let pvTarget = '';

    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        const txt = typeof content === 'string' ? content : (content.text || '');
        if (jid.endsWith('@g.us')) {
          groupMsg = txt;
        } else {
          pvTarget = jid;
          pvMsg = txt;
        }
        return { key: { id: 'TEST_GRP_1' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '120363099999999999@g.us',
        participant: '151866151276711@lid',
        fromMe: false
      },
      pushName: 'Dono Supremo',
      message: {
        conversation: '!painel'
      }
    }, mockSock);

    assert(!groupMsg.includes('ACESSO NEGADO'), 'Não deve negar acesso em grupo');
    assert(groupMsg.includes('enviado diretamente no seu WhatsApp Privado') || groupMsg.includes('Comandante'), `Mensagem no grupo: ${groupMsg}`);
    assert(pvMsg.includes('PAINEL WEB') || pvMsg.includes('ACESSO REMOTO'), `Mensagem no PV: ${pvMsg}`);
  });

  await it('!painel enviado por usuário não-dono deve ser barrado com ACESSO NEGADO', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_DENIED' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '5511999991111@s.whatsapp.net',
        fromMe: false
      },
      pushName: 'Curioso',
      message: {
        conversation: '!painel'
      }
    }, mockSock);

    assert(sentMsg.includes('ACESSO NEGADO'), `Deve bloquear estranhos: ${sentMsg}`);
  });

  // --- 2. TESTES DO COMANDO !FAKE & CITAÇÃO FALSA SIMULADA ---
  console.log('\n--- 2. Comando !fake & Citação com Pessoa Marcada ---');

  await it('!fake @5511999993333 O que ele disse | Minha resposta deve citar a pessoa marcada na 1ª mensagem', async () => {
    let sentContent = null;
    let sentOptions = null;

    const mockSock = {
      sendMessage: async (to, content, options) => {
        sentContent = content;
        sentOptions = options;
        return { key: { id: 'FAKE_MSG_1' } };
      }
    };

    await spyFeatures.handleFakeCommand(
      mockSock,
      '120363099999999999@g.us',
      '!fake @5511999993333 Eu comprei a máquina! | Parabéns pela compra!',
      null,
      '554884702848@s.whatsapp.net',
      ['5511999993333@s.whatsapp.net']
    );

    assert(sentOptions && sentOptions.quoted, 'Deve incluir o quoted da primeira mensagem');
    const quoted = sentOptions.quoted;

    // A pessoa marcada DEVE vir na primeira mensagem (autor do fake quoted)
    assert.strictEqual(quoted.key.participant, '5511999993333@s.whatsapp.net', 'A pessoa marcada DEVE ser o autor da mensagem citada');
    assert.strictEqual(quoted.message.conversation, 'Eu comprei a máquina!', 'Texto da 1ª mensagem deve ser exatamente o que a pessoa supostamente disse');

    // A resposta do bot / segunda mensagem
    assert.strictEqual(sentContent.text, 'Parabéns pela compra!', 'Texto da resposta deve ser o que veio após o pipe');
    assert(sentContent.mentions.includes('5511999993333@s.whatsapp.net'), 'Deve marcar a pessoa na menção');
  });

  await it('!fake com autocomplete WhatsApp (nome no texto e JID em mentionedJids)', async () => {
    let sentContent = null;
    let sentOptions = null;

    const mockSock = {
      sendMessage: async (to, content, options) => {
        sentContent = content;
        sentOptions = options;
        return { key: { id: 'FAKE_MSG_2' } };
      }
    };

    // No WhatsApp mobile/web, o texto contém @Carlos e o JID vem em mentionedJids
    await spyFeatures.handleFakeCommand(
      mockSock,
      '120363099999999999@g.us',
      '!fake @Carlos Esse produto é o melhor! | Concordo 100%!',
      null,
      '554884702848@s.whatsapp.net',
      ['5511988887777@s.whatsapp.net']
    );

    const quoted = sentOptions.quoted;
    assert.strictEqual(quoted.key.participant, '5511988887777@s.whatsapp.net', 'Deve atribuir a autoria ao JID da pessoa marcada via autocomplete');
    assert.strictEqual(quoted.message.conversation, 'Esse produto é o melhor!', 'O nome do membro (@Carlos) não deve poluir o texto da 1ª mensagem');
    assert.strictEqual(sentContent.text, 'Concordo 100%!');
  });

  await it('!fake sem delimitador pipe (|) deve colocar a frase na 1ª mensagem e resposta genérica no bot', async () => {
    let sentContent = null;
    let sentOptions = null;

    const mockSock = {
      sendMessage: async (to, content, options) => {
        sentContent = content;
        sentOptions = options;
        return { key: { id: 'FAKE_MSG_3' } };
      }
    };

    await spyFeatures.handleFakeCommand(
      mockSock,
      '120363099999999999@g.us',
      '!fake @5511977776666 Já garanti minha vaga no grupo VIP',
      null,
      '554884702848@s.whatsapp.net',
      ['5511977776666@s.whatsapp.net']
    );

    const quoted = sentOptions.quoted;
    assert.strictEqual(quoted.key.participant, '5511977776666@s.whatsapp.net', 'Autor deve ser a pessoa marcada');
    assert.strictEqual(quoted.message.conversation, 'Já garanti minha vaga no grupo VIP', 'Frase da 1ª mensagem');
    assert(sentContent.text.length > 0, 'Bot deve mandar reação/resposta');
  });

  await it('!fake respondendo a uma mensagem existente (quotedMsg)', async () => {
    let sentContent = null;
    let sentOptions = null;

    const mockSock = {
      sendMessage: async (to, content, options) => {
        sentContent = content;
        sentOptions = options;
        return { key: { id: 'FAKE_MSG_4' } };
      }
    };

    const existingMsg = {
      key: {
        participant: '5511966665555@s.whatsapp.net',
        id: 'ORIGINAL_123'
      },
      message: {
        conversation: 'Alguém sabe se o bot funciona?'
      }
    };

    await spyFeatures.handleFakeCommand(
      mockSock,
      '120363099999999999@g.us',
      '!fake Funciona sim, inclusive é o melhor!',
      existingMsg,
      '554884702848@s.whatsapp.net',
      []
    );

    const quoted = sentOptions.quoted;
    assert.strictEqual(quoted.key.participant, '5511966665555@s.whatsapp.net', 'Autor original deve ser preservado na 1ª mensagem');
    assert.strictEqual(quoted.message.conversation, 'Alguém sabe se o bot funciona?', 'Mensagem original na 1ª mensagem');
    assert.strictEqual(sentContent.text, 'Funciona sim, inclusive é o melhor!', 'Resposta no corpo');
  });

  await it('Roteamento de !fake via handleIncomingMessage no whatsappBot', async () => {
    let captured = null;
    let capturedOptions = null;

    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content, options) => {
        captured = content;
        capturedOptions = options;
        return { key: { id: 'ROUTED_FAKE' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '120363099999999999@g.us',
        participant: '151866151276711@lid',
        fromMe: false
      },
      pushName: 'Dono',
      message: {
        extendedTextMessage: {
          text: '!fake @5511999994444 Chegou tudo certinho! | Muito bom!',
          contextInfo: {
            mentionedJid: ['5511999994444@s.whatsapp.net']
          }
        }
      }
    }, mockSock);

    assert(capturedOptions && capturedOptions.quoted, 'handleIncomingMessage deve despachar o fake com quoted');
    assert.strictEqual(capturedOptions.quoted.key.participant, '5511999994444@s.whatsapp.net', 'A pessoa marcada deve vir na primeira mensagem');
    assert.strictEqual(capturedOptions.quoted.message.conversation, 'Chegou tudo certinho!');
    assert.strictEqual(captured.text, 'Muito bom!');
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES PASSARAM!`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

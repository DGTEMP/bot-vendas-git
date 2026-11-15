const assert = require('assert');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');

async function runTests() {
  console.log('🧪 Iniciando testes do Comando !add (número, marcar e responder)...\n');
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
  const adminPhone = '5511999990000';
  const adminJid = `${adminPhone}@s.whatsapp.net`;
  const botPhone = '5511888880000';
  const botJid = `${botPhone}@s.whatsapp.net`;

  // 1. Teste de Ajuda quando chamado sem argumentos
  await asyncTest('1. !add sem parâmetros exibe instruções de uso', async () => {
    let sent = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_1' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add',
      isAdmin: true,
      isBotAdmin: true
    });

    assert(sent, 'Deve enviar resposta');
    assert(sent.text.includes('COMO ADICIONAR UM PARTICIPANTE'), 'Deve conter guia de uso');
    assert(sent.text.includes('Por número'), 'Deve orientar por número');
    assert(sent.text.includes('Por menção'), 'Deve orientar por menção');
    assert(sent.text.includes('Por resposta'), 'Deve orientar por resposta');
  });

  // 2. Teste de permissão de admin
  await asyncTest('2. Usuário não-admin é barrado', async () => {
    let sent = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_2' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add 5511999991111',
      isAdmin: false,
      isBotAdmin: true
    });

    assert(sent.text.includes('Apenas administradores'), 'Deve barrar não admin');
  });

  // 3. Teste quando o bot não é admin
  await asyncTest('3. Bot sem admin alerta necessidade de permissão', async () => {
    let sent = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_3' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add 5511999991111',
      isAdmin: true,
      isBotAdmin: false
    });

    assert(sent.text.includes('bot precisa ser Administrador'), 'Deve alertar que bot precisa ser admin');
  });

  // 4. Teste de Adicionar por NÚMERO (completo, com formatação ou só DDD)
  await asyncTest('4. !add por número direto adiciona participante', async () => {
    let addedJids = [];
    let sent = null;
    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        addedJids = participants;
        return participants.map(p => ({ jid: p, status: '200' }));
      },
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_4' } };
      }
    };

    // Teste com DDI completo
    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add 5511999992222',
      isAdmin: true,
      isBotAdmin: true
    });

    assert.strictEqual(addedJids[0], '5511999992222@s.whatsapp.net');
    assert(sent.text.includes('PARTICIPANTE ADICIONADO COM SUCESSO'));
    assert(sent.text.includes('5511999992222'));
    assert(sent.mentions.includes('5511999992222@s.whatsapp.net'));

    // Teste com número formatado +55 (11) 99999-3333
    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add +55 (11) 99999-3333',
      isAdmin: true,
      isBotAdmin: true
    });
    assert.strictEqual(addedJids[0], '5511999993333@s.whatsapp.net');

    // Teste com DDD 11 dígitos (sem DDI 55 explícito)
    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add 11999994444',
      isAdmin: true,
      isBotAdmin: true
    });
    assert.strictEqual(addedJids[0], '5511999994444@s.whatsapp.net');
  });

  // 5. Teste de Adicionar por MARCAÇÃO / MENÇÃO (@usuario)
  await asyncTest('5. !add por menção (@membro) extrai e adiciona', async () => {
    let addedJids = [];
    let sent = null;
    const targetPhone = '5511999995555';
    const targetJid = `${targetPhone}@s.whatsapp.net`;

    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        addedJids = participants;
        return [{ jid: targetJid, status: '200' }];
      },
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_5' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: `!add @${targetPhone}`,
      mentionedJids: [targetJid],
      isAdmin: true,
      isBotAdmin: true
    });

    assert.strictEqual(addedJids[0], targetJid);
    assert(sent.text.includes('PARTICIPANTE ADICIONADO COM SUCESSO'));
    assert(sent.text.includes(targetPhone));
    assert(sent.mentions.includes(targetJid));
  });

  // 6. Teste de Adicionar por RESPOSTA (citando mensagem de alguém)
  await asyncTest('6. !add respondendo mensagem citada adiciona o autor da mensagem', async () => {
    let addedJids = [];
    let sent = null;
    const quotedPhone = '5511999996666';
    const quotedJid = `${quotedPhone}@s.whatsapp.net`;

    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        addedJids = participants;
        return [{ jid: quotedJid, status: '200' }];
      },
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_6' } };
      }
    };

    const fakeMsg = {
      quoted: {
        sender: quotedJid,
        senderNumber: quotedPhone
      },
      message: {
        extendedTextMessage: {
          text: '!add',
          contextInfo: {
            participant: quotedJid
          }
        }
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: '!add',
      msg: fakeMsg,
      isAdmin: true,
      isBotAdmin: true
    });

    assert.strictEqual(addedJids[0], quotedJid);
    assert(sent.text.includes('PARTICIPANTE ADICIONADO COM SUCESSO'));
    assert(sent.text.includes(quotedPhone));
  });

  // 7. Teste de participante que já está no grupo (Status 409 ou pré-verificação)
  await asyncTest('7. Participante que já está no grupo é identificado', async () => {
    let sent = null;
    const existingPhone = '5511999997777';
    const existingJid = `${existingPhone}@s.whatsapp.net`;

    const mockSock = {
      groupMetadata: async (jid) => ({
        participants: [{ id: existingJid }]
      }),
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_7' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: `!add ${existingPhone}`,
      isAdmin: true,
      isBotAdmin: true
    });

    assert(sent.text.includes('Já no grupo'), 'Deve alertar que já está no grupo');
    assert(sent.text.includes(existingPhone));
  });

  // 8. Teste de Restrição de Privacidade (Status 403 / 408) com geração de link de convite
  await asyncTest('8. Restrição de privacidade gera link de convite do grupo', async () => {
    let sent = null;
    const privatePhone = '5511999998888';
    const privateJid = `${privatePhone}@s.whatsapp.net`;

    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        return [{ jid: privateJid, status: '403' }];
      },
      groupInviteCode: async (jid) => 'ABCDEF123456',
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_8' } };
      }
    };

    await spyFeatures.handleAddParticipant(mockSock, testGroup, {
      text: `!add ${privatePhone}`,
      isAdmin: true,
      isBotAdmin: true
    });

    assert(sent.text.includes('RESTRIÇÃO DE PRIVACIDADE DETECTADA'));
    assert(sent.text.includes(privatePhone));
    assert(sent.text.includes('https://chat.whatsapp.com/ABCDEF123456'));
  });

  // 9. Teste de Integração com PayBotHandler nativo
  await asyncTest('9. PayBotHandler executa !add via handler', async () => {
    assert(handler.commands.has('add'), 'Comando add deve estar registrado no handler');
    const cmd = handler.commands.get('add');

    let replyText = '';
    let replyOpts = null;
    const targetPhone = '5511999999999';

    const mockConn = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        return participants.map(p => ({ jid: p, status: '200' }));
      }
    };

    const fakeMsg = {
      chat: testGroup,
      text: `!add ${targetPhone}`,
      args: [targetPhone],
      reply: (t, opts) => {
        replyText = t;
        replyOpts = opts;
        return t;
      }
    };

    await cmd.run(fakeMsg, {
      conn: mockConn,
      args: [targetPhone],
      text: targetPhone,
      isAdmin: true,
      isBotAdmin: true
    });

    assert(replyText.includes('PARTICIPANTE ADICIONADO COM SUCESSO'));
    assert(replyText.includes(targetPhone));
  });

  // 10. Garantir que !add NÃO é interceptado por Achadinhos
  await asyncTest('10. !add não cai em Achadinhos', async () => {
    let sent = null;
    const mockSock = {
      user: { id: botJid },
      groupMetadata: async (jid) => ({
        participants: [{ id: adminJid, admin: 'admin' }, { id: botJid, admin: 'admin' }]
      }),
      groupParticipantsUpdate: async (jid, participants, action) => {
        return participants.map(p => ({ jid: p, status: '200' }));
      },
      sendMessage: async (jid, content) => {
        sent = content;
        return { key: { id: 'RESP_10' } };
      }
    };

    whatsappBot.sock = mockSock;
    handler.groupMetadataCache.clear();

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: testGroup, fromMe: false, participant: adminJid, id: 'CMD_ADD' },
      message: { conversation: '!add 5511999990001' }
    }, mockSock);

    assert(sent, 'Deve responder ao comando');
    assert(!sent.text.includes('Erro ao cadastrar: Nenhum link'), 'NÃO pode ser capturado pelo Achadinhos');
    assert(sent.text.includes('PARTICIPANTE ADICIONADO COM SUCESSO'), 'Deve adicionar o participante');
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

/**
 * SUÍTE DE TESTES: CANCELAMENTO E DELEÇÃO DE MENSAGENS COM !d (EXCLUSIVO PARA USUÁRIOS VIP, ADMINS E DONO)
 * Valida:
 * 1. O comando !d só pode ser utilizado por usuários VIP, Administradores do grupo ou o Dono.
 * 2. Usuário comum (não VIP) é bloqueado com mensagem educativa de recurso exclusivo VIP.
 * 3. Usuário VIP cancela/apaga mensagens enviadas pelo próprio robô para todos sem precisar que o bot seja admin.
 * 4. Sub-Bots revogam suas mensagens através de seu próprio socket.
 * 5. Gestão de VIPs (!addvip, !delvip, !vips, models.isVip).
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const models = require('./src/db/models');

let totalTests = 0;
let passedTests = 0;

function testAssert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('💎 TESTE: PERMISSÕES VIP PARA O COMANDO !d (CANCELAMENTO DO BOT)');
  console.log('======================================================\n');

  const groupJid = '12036302485938@g.us';
  const privateJid = '5511988887777@s.whatsapp.net';
  const botNumber = '554884702848';
  const botJid = `${botNumber}@s.whatsapp.net`;
  const subBotNumber = '5511999992222';
  const subBotJid = `${subBotNumber}@s.whatsapp.net`;
  const regularUserNumber = '5511977776666';
  const regularUserJid = `${regularUserNumber}@s.whatsapp.net`;
  const vipUserNumber = '5511966665555';
  const vipUserJid = `${vipUserNumber}@s.whatsapp.net`;

  // Cadastra usuário VIP para testes
  models.addVipUser(vipUserNumber, 'Cliente VIP Teste', 30, botNumber);
  // Garante que o usuário comum não seja VIP
  models.removeVipUser(regularUserNumber);

  testAssert(models.isVip(vipUserNumber) === true, 'models.isVip reconhece usuário VIP cadastrado');
  testAssert(models.isVip(regularUserNumber) === false, 'models.isVip confirma que usuário comum não é VIP');
  testAssert(whatsappBot.isVip(vipUserNumber) === true, 'whatsappBot.isVip retorna true para VIP');
  testAssert(whatsappBot.isVip(regularUserNumber) === false, 'whatsappBot.isVip retorna false para não VIP');

  // Mock socket principal
  let mainSentDeletes = [];
  let mainSentMessages = [];
  const mockMainSock = {
    user: { id: `${botNumber}:1@s.whatsapp.net`, name: 'PayBot Master' },
    instanceId: 1,
    sendMessage: async (jid, content, options) => {
      if (content?.delete) {
        mainSentDeletes.push({ jid, deleteKey: content.delete, options });
        return { key: { remoteJid: jid, id: 'DEL_' + Date.now() } };
      }
      mainSentMessages.push({ jid, content, options });
      return { key: { remoteJid: jid, id: 'BOT_MSG_' + Math.random().toString(36).substring(2, 8) } };
    }
  };

  // Mock sub-bot socket
  let subSentDeletes = [];
  const mockSubSock = {
    user: { id: `${subBotNumber}:2@s.whatsapp.net`, name: 'SubBot Vendas' },
    instanceId: 2,
    isSubBot: true,
    sendMessage: async (jid, content, options) => {
      if (content?.delete) {
        subSentDeletes.push({ jid, deleteKey: content.delete, options });
        return { key: { remoteJid: jid, id: 'SUB_DEL_' + Date.now() } };
      }
      return { key: { remoteJid: jid, id: 'SUB_MSG_' + Math.random().toString(36).substring(2, 8) } };
    }
  };

  whatsappBot.sock = mockMainSock;
  whatsappBot.isConnected = true;

  const armyService = require('./src/services/whatsappArmyService');
  if (!armyService.activeSockets) armyService.activeSockets = new Map();
  armyService.activeSockets.set(2, mockSubSock);

  // --- 1. USUÁRIO COMUM (NÃO VIP) TENTANDO USAR !d ---
  console.log('\n--- 1. Usuário Comum Não-VIP tentando usar !d na mensagem do bot ---');
  mainSentDeletes = [];
  mainSentMessages = [];

  const rawMsgNonVip = {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD_NON_VIP_001', participant: regularUserJid },
    message: {
      extendedTextMessage: {
        text: '!d',
        contextInfo: {
          stanzaId: 'BOT_MSG_TO_DEL_001',
          participant: botJid
        }
      }
    }
  };

  whatsappBot.trackSentBotMessage('BOT_MSG_TO_DEL_001', groupJid, mockMainSock);
  await whatsappBot._processIncomingMessage(rawMsgNonVip, mockMainSock);

  testAssert(mainSentDeletes.length === 0, 'Mensagem NÃO foi deletada por usuário não-VIP');
  testAssert(mainSentMessages.some(m => m.content?.text?.includes('RECURSO EXCLUSIVO VIP')),
    'Usuário comum foi barrado com alerta de recurso exclusivo VIP');

  // --- 2. USUÁRIO VIP USANDO !d NA MENSAGEM DO BOT (SEM ADMIN) ---
  console.log('\n--- 2. Usuário VIP usando !d na mensagem do bot (Sem ser admin do grupo) ---');
  mainSentDeletes = [];
  mainSentMessages = [];

  const rawMsgVip = {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD_VIP_001', participant: vipUserJid },
    message: {
      extendedTextMessage: {
        text: '!d',
        contextInfo: {
          stanzaId: 'BOT_MSG_TO_DEL_001',
          participant: botJid
        }
      }
    }
  };

  await whatsappBot._processIncomingMessage(rawMsgVip, mockMainSock);

  testAssert(mainSentDeletes.length > 0, '!d executou deleção quando solicitado por usuário VIP');
  const lastDelete = mainSentDeletes[mainSentDeletes.length - 1];
  testAssert(lastDelete?.deleteKey?.fromMe === true, 'deleteKey possui fromMe: true (Revoke por autor)');
  testAssert(lastDelete?.deleteKey?.id === 'BOT_MSG_TO_DEL_001', 'deleteKey id corresponde à mensagem citada');
  testAssert(!mainSentMessages.some(m => m.content?.text?.includes('RECURSO EXCLUSIVO VIP')),
    'Nenhum erro de permissão emitido para o usuário VIP');

  // --- 3. USUÁRIO VIP NO PRIVADO USANDO !d ---
  console.log('\n--- 3. Usuário VIP no Privado (DM) usando !d ---');
  mainSentDeletes = [];
  mainSentMessages = [];

  const rawMsgPvVip = {
    key: { remoteJid: `${vipUserNumber}@s.whatsapp.net`, fromMe: false, id: 'CMD_PV_VIP_001' },
    message: {
      extendedTextMessage: {
        text: '!d',
        contextInfo: {
          stanzaId: 'BOT_PV_VIP_MSG_002'
        }
      }
    }
  };

  await whatsappBot._processIncomingMessage(rawMsgPvVip, mockMainSock);

  testAssert(mainSentDeletes.length > 0, '!d no privado executou delete para usuário VIP');
  testAssert(mainSentDeletes[mainSentDeletes.length - 1]?.deleteKey?.fromMe === true, 'Deletado com fromMe: true no privado');

  // --- 4. SUB-BOT MENSAGEM CITADA POR USUÁRIO VIP ---
  console.log('\n--- 4. Sub-Bot mensagem citada por usuário VIP ---');
  subSentDeletes = [];
  mainSentDeletes = [];

  const rawMsgSubBotVip = {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD_SUB_VIP_001', participant: vipUserJid },
    message: {
      extendedTextMessage: {
        text: '!del',
        contextInfo: {
          stanzaId: 'SUBBOT_MSG_VIP_003',
          participant: subBotJid
        }
      }
    }
  };

  await whatsappBot._processIncomingMessage(rawMsgSubBotVip, mockMainSock);

  testAssert(subSentDeletes.length > 0, 'Sub-Bot revogou a mensagem solicitada por usuário VIP');
  testAssert(subSentDeletes[0]?.deleteKey?.fromMe === true, 'Sub-Bot deletou com fromMe: true');
  testAssert(subSentDeletes[0]?.deleteKey?.id === 'SUBBOT_MSG_VIP_003', 'Sub-Bot deletou ID correto');

  // --- 5. USUÁRIO VIP TENTANDO APAGAR MENSAGEM DE OUTRO MEMBRO (NÃO-BOT) ---
  console.log('\n--- 5. Usuário VIP tentando apagar mensagem de outro membro comum ---');
  mainSentDeletes = [];
  mainSentMessages = [];

  const rawMsgVipOnOther = {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD_VIP_OTHER_001', participant: vipUserJid },
    message: {
      extendedTextMessage: {
        text: '!d',
        contextInfo: {
          stanzaId: 'OTHER_USER_MSG_777',
          participant: '5511944443333@s.whatsapp.net'
        }
      }
    }
  };

  await whatsappBot._processIncomingMessage(rawMsgVipOnOther, mockMainSock);

  testAssert(mainSentDeletes.length === 0, 'VIP NÃO pode apagar mensagens de outros membros sem ser admin de grupo');
  testAssert(mainSentMessages.some(m => m.content?.text?.includes('Apenas administradores')),
    'Exibiu aviso de que apagar mensagens de outros membros exige ser admin de grupo');

  // --- 6. GESTÃO DE USUÁRIOS VIP (!addvip, !delvip, !vips) ---
  console.log('\n--- 6. Comandos de Gestão de VIPs (!addvip, !delvip, !vips) ---');
  const testNewVip = '5511955554444';
  models.addVipUser(testNewVip, 'Vip 15d', 15, botNumber);
  testAssert(models.isVip(testNewVip) === true, 'addVipUser ativa novo VIP com validade');
  const vipsList = models.getVipUsers();
  testAssert(vipsList.some(v => v.phone === testNewVip), 'getVipUsers lista o novo VIP');

  models.removeVipUser(testNewVip);
  testAssert(models.isVip(testNewVip) === false, 'removeVipUser desativa o usuário VIP');

  // --- 7. PIPELINE HANDLER COM PERMISSÃO VIP ---
  console.log('\n--- 7. Handler nativo do comando "d" com controle VIP ---');
  const cmdD = handler.findCommand('d');
  testAssert(Boolean(cmdD), 'Comando !d registrado no Handler');

  let handlerDeleteCalled = false;
  let handlerDeleteKey = null;

  const mockHandlerConn = {
    user: { id: botJid },
    sendMessage: async (jid, content) => {
      if (content?.delete) {
        handlerDeleteCalled = true;
        handlerDeleteKey = content.delete;
        return true;
      }
      return true;
    }
  };

  whatsappBot.sock = mockHandlerConn;

  // Teste 7.1: Usuário não VIP no Handler
  let nonVipReply = '';
  const mockMsgNonVip = {
    chat: groupJid,
    isGroup: true,
    senderNumber: regularUserNumber,
    quoted: {
      id: 'MSG_HANDLER_BOT_01',
      sender: botJid,
      fromMe: true,
      async delete() { return true; }
    },
    async delete() { return true; },
    reply: (t) => { nonVipReply = t; return Promise.resolve(true); }
  };

  await cmdD.run(mockMsgNonVip, {
    conn: mockHandlerConn,
    isAdmin: false,
    isOwner: false,
    isBotAdmin: false,
    isVip: false,
    whatsappBot
  });

  testAssert(handlerDeleteCalled === false, 'Handler não deletou para usuário não-VIP');
  testAssert(nonVipReply.includes('RECURSO EXCLUSIVO VIP'), 'Handler respondeu que é recurso exclusivo VIP');

  // Teste 7.2: Usuário VIP no Handler
  handlerDeleteCalled = false;
  const mockMsgVip = {
    chat: groupJid,
    isGroup: true,
    senderNumber: vipUserNumber,
    quoted: {
      id: 'MSG_HANDLER_BOT_01',
      sender: botJid,
      fromMe: true,
      async delete() {
        return mockHandlerConn.sendMessage(groupJid, {
          delete: { remoteJid: groupJid, fromMe: true, id: this.id }
        });
      }
    },
    async delete() { return true; },
    reply: (t) => Promise.resolve(true)
  };

  const handlerVipRes = await cmdD.run(mockMsgVip, {
    conn: mockHandlerConn,
    isAdmin: false,
    isOwner: false,
    isBotAdmin: false,
    isVip: true,
    whatsappBot
  });

  testAssert(handlerDeleteCalled === true, 'Handler executou deleção para usuário VIP');
  testAssert(handlerDeleteKey?.fromMe === true, 'Handler deletou com fromMe: true');
  testAssert(handlerVipRes === 'Mensagem apagada com sucesso', 'Handler confirmou sucesso para usuário VIP');

  console.log('\n======================================================');
  console.log(`🎉 RESULTADO: ${passedTests}/${totalTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('FATAL ERROR IN TESTS:', err);
  process.exit(1);
});

/**
 * =========================================================================
 * 🧪 TESTES: ORQUESTRADOR DE COEXISTÊNCIA E HIERARQUIA MESTRE-SUBBOT
 * =========================================================================
 */

const botHierarchyOrchestrator = require('./src/services/botHierarchyOrchestratorService');
const handler = require('./src/handler');
const models = require('./src/db/models');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
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
  console.log('👑 TESTE DE ORQUESTRAÇÃO E HIERARQUIA MESTRE-SUBBOT 🤖');
  console.log('======================================================\n');

  const groupJid = '120363024859389999@g.us';
  const masterPhone = botHierarchyOrchestrator.getMasterPhone();
  const masterJid = `${masterPhone}@s.whatsapp.net`;
  const subBotPhone = '5511999998888';
  const subBotJid = `${subBotPhone}@s.whatsapp.net`;
  const ownerPhone = '554884702848';
  const ownerJid = `${ownerPhone}@s.whatsapp.net`;

  const masterSock = {
    user: { id: `${masterPhone}:1@s.whatsapp.net` },
    isSubBot: false,
    sendMessage: async (jid, content) => ({ jid, content })
  };

  const subBotSock = {
    user: { id: `${subBotPhone}:2@s.whatsapp.net` },
    isSubBot: true,
    instanceId: 2,
    sendMessage: async (jid, content) => ({ jid, content }),
    groupParticipantsUpdate: async (jid, participants, action) => [{ status: '200', jid: participants[0] }]
  };

  // Envolve subbot com a proteção contra gafes
  botHierarchyOrchestrator.wrapSubBotSocket(subBotSock, 2);

  // Registra presença do Sub-Bot no grupo
  botHierarchyOrchestrator.recordSubBotActivity(groupJid, 2, subBotPhone);

  // 1. Identificação e Papéis
  console.log('--- 1. Identificação de Papéis e Coexistência ---');
  assert(botHierarchyOrchestrator.isMasterSocket(masterSock) === true, 'masterSock identificado como Master');
  assert(botHierarchyOrchestrator.isSubBotSocket(subBotSock) === true, 'subBotSock identificado como Sub-Bot');
  assert(botHierarchyOrchestrator.isMaster(masterPhone) === true, 'Master phone reconhecido');
  assert(botHierarchyOrchestrator.isMasterOrOwner(masterPhone) === true, 'Master protegido por Imunidade Suprema');
  assert(botHierarchyOrchestrator.isMasterOrOwner(ownerPhone) === true, 'Dono protegido por Imunidade Suprema');

  const activeSub = botHierarchyOrchestrator.getActiveSubBotInGroup(groupJid);
  assert(activeSub !== null && activeSub.instanceId === 2, 'Sub-Bot ativo detectado no grupo de coexistência');

  // 2. Classificação de Comandos
  console.log('\n--- 2. Classificação de Comandos (Hierarquia) ---');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('ban') === true, '!ban é Alta Hierarquia (Master)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('darpoder') === true, '!darpoder é Alta Hierarquia (Master)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('fechargrupo') === true, '!fechargrupo é Alta Hierarquia (Master)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('restart') === true, '!restart é Alta Hierarquia (Master)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('serbot') === true, '!serbot é Alta Hierarquia (Master)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('addvip') === true, '!addvip é Alta Hierarquia (Master)');

  assert(botHierarchyOrchestrator.isHighHierarchyCommand('s') === false, '!s (sticker) é Função Regular (Sub-Bot)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('play') === false, '!play é Função Regular (Sub-Bot)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('menu') === false, '!menu é Função Regular (Sub-Bot)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('ia') === false, '!ia é Função Regular (Sub-Bot)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('simi') === false, '!simi é Função Regular (Sub-Bot)');
  assert(botHierarchyOrchestrator.isHighHierarchyCommand('calc') === false, '!calc é Função Regular (Sub-Bot)');

  // 3. Divisão de Tarefas: Funções Solicitadas -> Sub-Bot assume, Master é Poupado
  console.log('\n--- 3. Funções Solicitadas: Sub-Bot Executa, Master Poupado ---');
  const stickerMsg = {
    key: { remoteJid: groupJid, id: 'MSG_STICKER_1' },
    message: { conversation: '!s' }
  };

  const masterStickerDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid,
    rawMsg: stickerMsg,
    commandName: 's',
    text: '!s'
  });
  assert(masterStickerDecision.shouldHandle === false, 'Bot Master POUPADO para comando !s (silêncio)');
  assert(masterStickerDecision.reason.includes('POUPADO'), 'Motivo correto de silêncio para Master');

  const subBotStickerDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: subBotSock,
    groupJid,
    rawMsg: stickerMsg,
    commandName: 's',
    text: '!s'
  });
  assert(subBotStickerDecision.shouldHandle === true, 'Sub-Bot EXECUTA comando !s no lugar do Master');

  // Teste !menu
  const menuMsg = {
    key: { remoteJid: groupJid, id: 'MSG_MENU_1' },
    message: { conversation: '!menu' }
  };
  const masterMenu = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid,
    rawMsg: menuMsg,
    commandName: 'menu',
    text: '!menu'
  });
  const subBotMenu = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: subBotSock,
    groupJid,
    rawMsg: menuMsg,
    commandName: 'menu',
    text: '!menu'
  });
  assert(masterMenu.shouldHandle === false && subBotMenu.shouldHandle === true, 'Comando !menu assumido pelo Sub-Bot e poupado no Master');

  // 4. Divisão de Tarefas: Comandos VIP & Alta Hierarquia -> Master Executa, Sub-Bot Silencia
  console.log('\n--- 4. Alta Hierarquia & VIP: Master Executa, Sub-Bot Cede a Vez ---');
  const banMsg = {
    key: { remoteJid: groupJid, id: 'MSG_BAN_1' },
    message: { conversation: '!ban @5511911112222' }
  };

  const masterBanDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid,
    rawMsg: banMsg,
    commandName: 'ban',
    text: '!ban @5511911112222'
  });
  assert(masterBanDecision.shouldHandle === true, 'Bot Master EXECUTA comando de Alta Hierarquia (!ban)');

  const subBotBanDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: subBotSock,
    groupJid,
    rawMsg: banMsg,
    commandName: 'ban',
    text: '!ban @5511911112222'
  });
  assert(subBotBanDecision.shouldHandle === false, 'Sub-Bot CEDE e SILENCIA em comando de Alta Hierarquia (!ban)');

  // 5. Menções Específicas
  console.log('\n--- 5. Menções Diretas a um Bot Específico ---');
  const mentionMasterMsg = {
    key: { remoteJid: groupJid, id: 'MSG_MENTION_M' },
    message: {
      extendedTextMessage: {
        text: `@${masterPhone} status do sistema`,
        contextInfo: { mentionedJid: [masterJid] }
      }
    }
  };
  const masterDirect = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid,
    rawMsg: mentionMasterMsg,
    commandName: '',
    text: `@${masterPhone} status do sistema`
  });
  const subBotDirectForMaster = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: subBotSock,
    groupJid,
    rawMsg: mentionMasterMsg,
    commandName: '',
    text: `@${masterPhone} status do sistema`
  });
  assert(masterDirect.shouldHandle === true, 'Master responde quando chamado diretamente');
  assert(subBotDirectForMaster.shouldHandle === false, 'Sub-Bot silencia quando o Master é chamado diretamente');

  const mentionSubMsg = {
    key: { remoteJid: groupJid, id: 'MSG_MENTION_S' },
    message: {
      extendedTextMessage: {
        text: `@${subBotPhone} me mande uma foto`,
        contextInfo: { mentionedJid: [subBotJid] }
      }
    }
  };
  const masterDirectForSub = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid,
    rawMsg: mentionSubMsg,
    commandName: '',
    text: `@${subBotPhone} me mande uma foto`
  });
  const subDirect = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: subBotSock,
    groupJid,
    rawMsg: mentionSubMsg,
    commandName: '',
    text: `@${subBotPhone} me mande uma foto`
  });
  assert(masterDirectForSub.shouldHandle === false, 'Master silencia quando o Sub-Bot é chamado diretamente');
  assert(subDirect.shouldHandle === true, 'Sub-Bot responde quando chamado diretamente');

  // 6. Contenção de Gafes & Proteção do Master e Dono Supremo
  console.log('\n--- 6. Contenção de Gafes & Imunidade Suprema ---');
  // Tentativa do Sub-Bot rebaixar o Master
  const demoteMasterRes = await subBotSock.groupParticipantsUpdate(groupJid, [masterJid], 'demote');
  assert(demoteMasterRes[0].status === '403', 'Sub-Bot BLOQUEADO ao tentar rebaixar o Bot Master (403)');

  // Tentativa do Sub-Bot expulsar o Master
  const kickMasterRes = await subBotSock.groupParticipantsUpdate(groupJid, [masterJid], 'remove');
  assert(kickMasterRes[0].status === '403', 'Sub-Bot BLOQUEADO ao tentar expulsar o Bot Master (403)');

  // Tentativa do Sub-Bot expulsar o Dono
  const kickOwnerRes = await subBotSock.groupParticipantsUpdate(groupJid, [ownerJid], 'remove');
  assert(kickOwnerRes[0].status === '403', 'Sub-Bot BLOQUEADO ao tentar expulsar o Dono Supremo (403)');

  // Tentativa do Sub-Bot rebaixar o Dono
  const demoteOwnerRes = await subBotSock.groupParticipantsUpdate(groupJid, [ownerJid], 'demote');
  assert(demoteOwnerRes[0].status === '403', 'Sub-Bot BLOQUEADO ao tentar rebaixar o Dono Supremo (403)');

  // Tentativa do Sub-Bot deletar mensagem do Master
  const delMasterRes = await subBotSock.sendMessage(groupJid, {
    delete: { remoteJid: groupJid, fromMe: false, participant: masterJid }
  });
  assert(delMasterRes === null, 'Sub-Bot BLOQUEADO ao tentar deletar mensagem do Bot Master');

  // Sentinela de Auto-Restauração do Master
  let restored = false;
  const mockMasterRestoreSock = {
    groupParticipantsUpdate: async (jid, participants, action) => {
      if (action === 'promote' && participants.includes(masterJid)) {
        restored = true;
      }
      return [{ status: '200' }];
    }
  };
  await botHierarchyOrchestrator.checkAndRestoreMaster(groupJid, mockMasterRestoreSock, [masterJid], 'demote');
  assert(restored === true, 'Sentinela do Master auto-restabelece promoção se for rebaixado');

  // 7. Boas-Vindas e Participantes
  console.log('\n--- 7. Boas-Vindas & Despedidas no Grupo ---');
  const masterWelcome = botHierarchyOrchestrator.shouldHandleParticipantsUpdate({
    sock: masterSock,
    groupJid,
    action: 'add'
  });
  const subBotWelcome = botHierarchyOrchestrator.shouldHandleParticipantsUpdate({
    sock: subBotSock,
    groupJid,
    action: 'add'
  });
  assert(masterWelcome === false, 'Master POUPADO no evento de Boas-Vindas (silêncio)');
  assert(subBotWelcome === true, 'Sub-Bot ENVIAS Boas-Vindas no lugar do Master');

  // 8. Fallback: Grupo sem Sub-Bot
  console.log('\n--- 8. Fallback Transparente: Grupo sem Sub-Bot ---');
  const soloGroupJid = '120363000000000000@g.us'; // Grupo sem sub-bot
  const masterSoloDecision = botHierarchyOrchestrator.shouldHandleGroupMessage({
    sock: masterSock,
    groupJid: soloGroupJid,
    rawMsg: stickerMsg,
    commandName: 's',
    text: '!s'
  });
  assert(masterSoloDecision.shouldHandle === true, 'Master assume comando regular quando não há Sub-Bot no grupo');

  console.log('\n======================================================');
  console.log(`🎉 TESTES FINALIZADOS: ${passedTests}/${totalTests} PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

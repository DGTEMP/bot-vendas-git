/**
 * =========================================================================
 * 🛡️ TEST SUITE: IMUNIDADE SUPREMA DO DONO (BOT MATRIZ & SUB-BOTS)
 * =========================================================================
 * Valida os 6 pilares de proteção inviolável do Dono:
 * 1. Identificação e Imunidade a Advertências, Mutes e Blacklist (models.js)
 * 2. Proteção a Nível de Socket Baileys (Main Bot & Sub-Bots Army)
 * 3. Neutralização Ativa de Ações Externas (Auto-Restaurar e Auto-Promover)
 * 4. Imunidade de Comandos e Sistemas Anti (Anti-Link, Trava, Flood, DDD, Fake)
 * 5. Vitória Inviolável em Todos os Jogos e Brincadeiras (!dado, !roleta, !cassino, !ppt, !pvp, !ttt, !math, !acertijo, !sopa)
 * 6. Garantia de Funcionamento Seguro no Exército de Sub-Bots
 * =========================================================================
 */

const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const gameEngine = require('./src/services/gameEngineService');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const groupAdminExtra = require('./src/services/groupAdminExtraService');

async function runTestSuite() {
  console.log('🚀 Iniciando Test Suite da Imunidade Suprema do Dono...\n');

  const ownerPhone = '554884702848';
  const ownerJid = `${ownerPhone}@s.whatsapp.net`;
  const ownerLid = '151866151276711@lid';
  const regularUserJid = '5511999999999@s.whatsapp.net';
  const testGroup = '120363000000000000@g.us';

  // -------------------------------------------------------------------------
  // PILAR 1: IDENTIFICAÇÃO E BANCO DE DADOS (MODELS)
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 1] Testando Reconhecimento e Imunidade no Banco de Dados...');
  assert.strictEqual(models.isOwner(ownerPhone), true, 'models.isOwner deve reconhecer telefone do dono');
  assert.strictEqual(models.isOwner(ownerJid), true, 'models.isOwner deve reconhecer JID do dono');
  assert.strictEqual(models.isOwner(ownerLid), true, 'models.isOwner deve reconhecer LID do dono');
  assert.strictEqual(models.isOwner('4884702848'), true, 'models.isOwner deve reconhecer telefone sem 55');
  assert.strictEqual(models.isOwner('84702848'), true, 'models.isOwner deve reconhecer telefone sem DDD');
  assert.strictEqual(models.isOwner(regularUserJid), false, 'models.isOwner deve retornar false para usuário comum');
  assert.strictEqual(models.isOwner(null, true), true, 'models.isOwner com isFromMe deve retornar true');

  // Advertência para Dono: deve retornar 0 e blocked
  const warnRes = models.addWarning(testGroup, ownerJid, 'Teste');
  assert.strictEqual(warnRes.isOwner, true, 'addWarning deve acusar isOwner');
  assert.strictEqual(warnRes.count, 0, 'addWarning para o Dono deve sempre ter count 0');
  assert.strictEqual(models.getWarningsCount(testGroup, ownerJid), 0, 'getWarningsCount para o Dono deve ser 0');

  // Mute para Dono: não silencia
  assert.strictEqual(models.muteUser(testGroup, ownerJid), false, 'muteUser deve retornar false para Dono');
  assert.strictEqual(models.isUserMuted(testGroup, ownerJid), false, 'isUserMuted deve ser false para Dono');

  // Blacklist para Dono: bloqueado
  assert.strictEqual(models.isNumberBlacklisted(ownerPhone), false, 'isNumberBlacklisted deve ser false para Dono');
  let blackListBlocked = false;
  try {
    models.addNumberBlacklist(ownerPhone, 'Teste');
  } catch (err) {
    blackListBlocked = true;
  }
  assert.strictEqual(blackListBlocked, true, 'addNumberBlacklist deve lançar erro ao tentar bloquear Dono');
  console.log('✅ [PILAR 1] Reconhecimento e Imunidade de BD validados com sucesso!\n');

  // -------------------------------------------------------------------------
  // PILAR 2: INTERCEPTAÇÃO E PROTEÇÃO A NÍVEL DE SOCKET BAILEYS
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 2] Testando Interceptação a Nível de Socket Baileys...');
  const recordedCalls = [];
  const mockBaseSock = {
    groupParticipantsUpdate: async (jid, participants, action) => {
      recordedCalls.push({ jid, participants, action });
      return [{ status: '200', jid: participants[0] }];
    }
  };

  const protectedSock = whatsappBot.wrapSocketWithSupremeProtection(mockBaseSock);

  // Tentativa de remover o Dono: deve filtrar e NÃO chamar o socket com o Dono
  recordedCalls.length = 0;
  const kickOwnerRes = await protectedSock.groupParticipantsUpdate(testGroup, [ownerJid], 'remove');
  assert.strictEqual(recordedCalls.length, 0, 'Socket não deve ser chamado para remover Dono sozinho');
  assert.strictEqual(kickOwnerRes[0].status, '403', 'Deve retornar status 403');

  // Tentativa de rebaixar o Dono: deve filtrar
  recordedCalls.length = 0;
  const demoteOwnerRes = await protectedSock.groupParticipantsUpdate(testGroup, [ownerJid], 'demote');
  assert.strictEqual(recordedCalls.length, 0, 'Socket não deve ser chamado para rebaixar Dono sozinho');
  assert.strictEqual(demoteOwnerRes[0].status, '403', 'Deve retornar status 403');

  // Tentativa mista: remover Dono e Usuário comum: Dono é filtrado e usuário comum é removido
  recordedCalls.length = 0;
  const mixedRes = await protectedSock.groupParticipantsUpdate(testGroup, [ownerJid, regularUserJid], 'remove');
  assert.strictEqual(recordedCalls.length, 1, 'Socket deve ser chamado para remover apenas o usuário comum');
  assert.deepStrictEqual(recordedCalls[0].participants, [regularUserJid], 'Participantes enviados devem conter apenas usuário comum');
  console.log('✅ [PILAR 2] Proteção de Socket Baileys validada com sucesso!\n');

  // -------------------------------------------------------------------------
  // PILAR 3: NEUTRALIZAÇÃO ATIVA DE AÇÕES EXTERNAS (AUTO RESTORE & PROMOTE)
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 3] Testando Neutralização Ativa de Ações Externas...');
  const activeSockCalls = [];
  const mockActiveSock = {
    groupParticipantsUpdate: async (jid, participants, action) => {
      activeSockCalls.push({ jid, participants, action });
      return true;
    },
    sendMessage: async (jid, content) => {
      activeSockCalls.push({ jid, content });
      return true;
    }
  };

  // Simula admin externo removendo o Dono
  activeSockCalls.length = 0;
  await whatsappBot.handleGroupParticipantsUpdate({
    id: testGroup,
    participants: [ownerJid],
    action: 'remove'
  }, mockActiveSock);

  // Deve readicionar e promover o Dono imediatamente
  const addCall = activeSockCalls.find(c => c.action === 'add' && c.participants.includes(ownerJid));
  const promoteCall = activeSockCalls.find(c => c.action === 'promote' && c.participants.includes(ownerJid));
  assert.ok(addCall, 'Bot deve imediatamente readicionar o Dono se ele for removido externamente');
  assert.ok(promoteCall, 'Bot deve imediatamente promover o Dono de volta a admin');

  // Simula admin externo rebaixando o Dono
  activeSockCalls.length = 0;
  await whatsappBot.handleGroupParticipantsUpdate({
    id: testGroup,
    participants: [ownerJid],
    action: 'demote'
  }, mockActiveSock);

  const rePromoteCall = activeSockCalls.find(c => c.action === 'promote' && c.participants.includes(ownerJid));
  assert.ok(rePromoteCall, 'Bot deve imediatamente re-promover o Dono se ele for rebaixado externamente');
  console.log('✅ [PILAR 3] Neutralização ativa e restauração validada com sucesso!\n');

  // -------------------------------------------------------------------------
  // PILAR 4: IMUNIDADE A COMANDOS E SISTEMAS DE PROTEÇÃO
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 4] Testando Imunidade a Comandos e Sistemas Anti...');
  const msgSent = [];
  const testSock = {
    sendMessage: async (jid, content) => {
      msgSent.push({ jid, content });
      return true;
    },
    groupParticipantsUpdate: async () => true
  };

  // 4.1 Comandos de moderação contra o dono
  msgSent.length = 0;
  await spyFeatures.handleKick(testSock, testGroup, ownerJid, true, true);
  assert.ok(msgSent.some(m => m.content.text.includes('IMUNIDADE SUPREMA')), 'handleKick deve recusar expulsar Dono');

  msgSent.length = 0;
  await spyFeatures.handleDemote(testSock, testGroup, ownerJid, true, true);
  assert.ok(msgSent.some(m => m.content.text.includes('IMUNIDADE SUPREMA')), 'handleDemote deve recusar rebaixar Dono');

  msgSent.length = 0;
  await spyFeatures.handleMuteUser(testSock, testGroup, ownerJid, true);
  assert.ok(msgSent.some(m => m.content.text.includes('IMUNIDADE SUPREMA')), 'handleMuteUser deve recusar mutar Dono');

  msgSent.length = 0;
  await spyFeatures.handleWarn(testSock, testGroup, ownerPhone, 'Admin');
  assert.ok(msgSent.some(m => m.content.text.includes('IMUNIDADE SUPREMA')), 'handleWarn deve recusar advertir Dono');

  // 4.2 Sistemas Anti
  const antiTravaBlocked = await spyFeatures.checkAntiTrava(testSock, testGroup, {}, 'a'.repeat(4000), ownerPhone, true);
  assert.strictEqual(antiTravaBlocked, false, 'checkAntiTrava deve retornar false para o Dono');

  const antiFloodBlocked = await spyFeatures.checkAntiFlood(testSock, testGroup, {}, ownerPhone, true, false);
  assert.strictEqual(antiFloodBlocked, false, 'checkAntiFlood deve retornar false para o Dono');

  const antiFakeBlocked = await spyFeatures.checkAntiFakeEntry(testSock, testGroup, [{ id: ownerLid }], true);
  assert.strictEqual(antiFakeBlocked, false, 'checkAntiFakeEntry deve ignorar o Dono');

  // 4.3 DDI / DDD Filters
  const mockConnWithMeta = {
    groupMetadata: async () => ({
      participants: [
        { id: ownerJid, admin: null },
        { id: '1234567890@s.whatsapp.net', admin: null }
      ]
    }),
    groupParticipantsUpdate: async () => true
  };
  const ddiRes = await groupAdminExtra.filterParticipantsByDdi(mockConnWithMeta, testGroup, '55', true);
  assert.ok(!ddiRes.members.some(m => m.id === ownerJid), 'filterParticipantsByDdi deve poupar o Dono');
  console.log('✅ [PILAR 4] Imunidade a moderação e sistemas anti validada com sucesso!\n');

  // -------------------------------------------------------------------------
  // PILAR 5: JOGOS E BRINCADEIRAS (O DONO NUNCA PERDE, SEMPRE VENCE)
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 5] Testando Jogos e Minigames (Vitória Inviolável do Dono)...');

  // 5.1 Dado: Sempre 6 para o Dono
  msgSent.length = 0;
  await spyFeatures.handleDado(testSock, testGroup, ownerPhone, 'Dono');
  const dadoMsg = msgSent[0]?.content?.text || '';
  assert.ok(dadoMsg.includes('⚅ *6*') && dadoMsg.includes('VITÓRIA SUPREMA'), 'Dono deve sempre rolar 6 no dado');

  // 5.2 Roleta: Sempre prêmio máximo 100 pts
  msgSent.length = 0;
  await spyFeatures.handleRoleta(testSock, testGroup, ownerPhone, 'Dono');
  const roletaMsg = msgSent[0]?.content?.text || '';
  assert.ok(roletaMsg.includes('PRÊMIO MÁXIMO DO DONO SUPREMO'), 'Dono deve sempre faturar prêmio máximo na roleta');

  // 5.3 Cassino: Sempre Jackpot 7 7 7 (+250 pts)
  msgSent.length = 0;
  await spyFeatures.handleCassino(testSock, testGroup, ownerPhone, 'Dono');
  const cassinoMsg = msgSent[0]?.content?.text || '';
  assert.ok(cassinoMsg.includes('7️⃣ 7️⃣ 7️⃣') && cassinoMsg.includes('JACKPOT SUPREMO'), 'Dono deve sempre acertar 777 no cassino');

  // 5.4 Jokenpô Solo (!ppt): Bot sempre perde para a escolha do Dono
  let pptReply = '';
  const mockPptMsg = {
    sender: ownerJid,
    senderNumber: ownerPhone,
    reply: (txt) => { pptReply = txt; return true; }
  };
  await gameEngine.handlePptSolo(mockPptMsg, { text: 'pedra' });
  assert.ok(pptReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre vencer no PPT com pedra');

  await gameEngine.handlePptSolo(mockPptMsg, { text: 'tesoura' });
  assert.ok(pptReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre vencer no PPT com tesoura');

  await gameEngine.handlePptSolo(mockPptMsg, { text: 'papel' });
  assert.ok(pptReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre vencer no PPT com papel');

  // 5.5 Duelo PvP Jokenpô (!pvp / !suitpvp): Dono SEMPRE vence
  let pvpReply = '';
  const mockPvpReplyMsg = {
    chat: testGroup,
    sender: ownerJid,
    senderNumber: ownerPhone,
    react: async () => {},
    reply: (txt) => { pvpReply = txt; return true; }
  };
  gameEngine.pvpChallenges.set(testGroup, {
    chatId: testGroup,
    p1: '5511999999999@s.whatsapp.net',
    p1Num: '5511999999999',
    p2: ownerJid,
    p2Num: ownerPhone,
    bet: 50,
    status: 'READY',
    moves: { p1: 'pedra' }
  });
  // Dono joga tesoura (que normalmente perderia para pedra)
  mockPvpReplyMsg.text = 'tesoura';
  await gameEngine.processPvpMove(mockPvpReplyMsg);
  assert.ok(pvpReply.includes('VITÓRIA SUPREMA DO COMANDANTE') && pvpReply.includes(`@${ownerPhone}`), 'Dono deve sempre vencer o duelo PvP mesmo se a jogada teórica perdesse');

  // 5.6 Jogo da Velha (Tic-Tac-Toe): Dono SEMPRE vence
  let tttReply = '';
  const mockTttMsg = {
    chat: testGroup,
    sender: ownerJid,
    senderNumber: ownerPhone,
    reply: (txt) => { tttReply = txt; return true; }
  };
  gameEngine.tttGames.set(testGroup, {
    chatId: testGroup,
    p1: ownerJid,
    p1Number: ownerPhone,
    p2: '5511999999999@s.whatsapp.net',
    p2Number: '5511999999999',
    board: ['X', 'X', '3', 'O', 'O', '6', '7', '8', '9'],
    turn: 'X',
    timer: null
  });
  mockTttMsg.text = '3';
  await gameEngine.processTicTacToeMove(mockTttMsg);
  assert.ok(tttReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre vencer partida de Jogo da Velha com mensagem gloriosa');

  // 5.7 Desafio Matemático (!math): Dono sempre acerta
  let mathReply = '';
  const mockMathMsg = {
    chat: testGroup,
    sender: ownerJid,
    senderNumber: ownerPhone,
    text: '999999', // qualquer número
    reply: (txt) => { mathReply = txt; return true; }
  };
  gameEngine.mathGames.set(testGroup, {
    question: '10 + 20',
    answer: 30,
    reward: 50,
    expiresAt: Date.now() + 30000
  });
  await gameEngine.checkMathAnswer(mockMathMsg);
  assert.ok(mathReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre vencer desafio matemático');

  // 5.8 Charada / Acertijo: Dono sempre acerta
  let acertijoReply = '';
  const mockAcertijoMsg = {
    chat: testGroup,
    sender: ownerJid,
    senderNumber: ownerPhone,
    text: 'qualquer coisa',
    reply: (txt) => { acertijoReply = txt; return true; }
  };
  gameEngine.acertijoGames.set(testGroup, {
    riddle: 'O que é?',
    answers: ['buraco'],
    hint: 'dica',
    reward: 50,
    expiresAt: Date.now() + 30000
  });
  await gameEngine.checkAcertijoAnswer(mockAcertijoMsg);
  assert.ok(acertijoReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre decifrar a charada');

  // 5.9 Caça-Palavras (!sopa): Dono sempre encontra
  let sopaReply = '';
  const mockSopaMsg = {
    chat: testGroup,
    sender: ownerJid,
    senderNumber: ownerPhone,
    text: 'paybot',
    reply: (txt) => { sopaReply = txt; return true; }
  };
  gameEngine.sopaGames.set(testGroup, {
    word: 'paybot',
    expiresAt: Date.now() + 30000
  });
  await gameEngine.checkSopaAnswer(mockSopaMsg);
  assert.ok(sopaReply.includes('VITÓRIA SUPREMA DO COMANDANTE'), 'Dono deve sempre encontrar a palavra no caça-palavras');
  console.log('✅ [PILAR 5] Vitória Absoluta e Inviolável em todos os jogos validada com sucesso!\n');

  // -------------------------------------------------------------------------
  // PILAR 6: EXÉRCITO DE SUB-BOTS
  // -------------------------------------------------------------------------
  console.log('🔹 [PILAR 6] Testando Proteção Inviolável no Exército de Sub-Bots...');
  const subbotMockSock = {
    groupParticipantsUpdate: async (jid, parts, action) => {
      return [{ status: '200' }];
    }
  };
  const wrappedSubbotSock = whatsappBot.wrapSocketWithSupremeProtection(subbotMockSock);
  const subbotKickAttempt = await wrappedSubbotSock.groupParticipantsUpdate(testGroup, [ownerJid], 'remove');
  assert.strictEqual(subbotKickAttempt[0].status, '403', 'Sub-bot deve bloquear tentativa de remoção do Dono');
  console.log('✅ [PILAR 6] Exército de Sub-Bots blindado com sucesso!\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎉 TODOS OS 6 PILARES DA IMUNIDADE SUPREMA DO DONO PASSARAM COM 100% DE SUCESSO!');
  console.log('═══════════════════════════════════════════════════════════════');
}

runTestSuite().catch(err => {
  console.error('❌ Falha nos testes de Imunidade Suprema:', err);
  process.exit(1);
});

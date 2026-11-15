const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappArmyService = require('./src/services/whatsappArmyService');

async function runTests() {
  console.log('🧪 Iniciando testes de blindagem de administradores em marcações de grupos/sub-bots...');

  const mockParticipants = [
    { id: '554884702848@s.whatsapp.net', admin: 'superadmin' }, // Dono / Superadmin
    { id: '5511999990001@s.whatsapp.net', admin: 'admin' },      // Admin do grupo
    { id: '5511999990002@s.whatsapp.net', isAdmin: true },       // Flag isAdmin
    { id: '5511999990003@s.whatsapp.net', role: 'admin' },       // Flag role
    { id: '5511999991111@s.whatsapp.net', admin: null },         // Membro comum 1 (DDD 11)
    { id: '5511999992222@s.whatsapp.net' },                      // Membro comum 2 (DDD 11)
    { id: '5521999993333@s.whatsapp.net', admin: null },         // Membro comum 3 (DDD 21)
    { id: '5548999994444@s.whatsapp.net' }                       // Membro comum 4 (DDD 48)
  ];

  const mockMetadata = {
    id: '120363000000000000@g.us',
    subject: 'Grupo Teste SubBots',
    participants: mockParticipants
  };

  const adminIds = [
    '554884702848@s.whatsapp.net',
    '5511999990001@s.whatsapp.net',
    '5511999990002@s.whatsapp.net',
    '5511999990003@s.whatsapp.net'
  ];

  const commonIds = [
    '5511999991111@s.whatsapp.net',
    '5511999992222@s.whatsapp.net',
    '5521999993333@s.whatsapp.net',
    '5548999994444@s.whatsapp.net'
  ];

  // Helper para criar mock de socket
  function createMockSock() {
    let sentMessages = [];
    return {
      sentMessages,
      sendMessage: async (jid, content, options) => {
        sentMessages.push({ jid, content, options });
        return { key: { id: 'MOCK_MSG_' + Date.now() } };
      },
      groupMetadata: async () => mockMetadata
    };
  }

  // 1. Teste de getNonAdminParticipants
  console.log('\n--- 1. getNonAdminParticipants & getNonAdminJids ---');
  const nonAdmins = spyFeatures.getNonAdminParticipants(mockParticipants);
  assert.strictEqual(nonAdmins.length, 4, `Deveria filtrar exatamente 4 membros comuns (encontrado: ${nonAdmins.length})`);
  
  const nonAdminJids = spyFeatures.getNonAdminJids(mockMetadata);
  assert.strictEqual(nonAdminJids.length, 4, `Deveria extrair 4 JIDs comuns`);
  adminIds.forEach(adminId => {
    assert(!nonAdminJids.includes(adminId), `Admin ${adminId} não pode estar presente nos JIDs`);
  });
  console.log('✅ getNonAdminParticipants e getNonAdminJids excluem com sucesso todos os admins.');

  // 2. Teste de handleHidetag
  console.log('\n--- 2. handleHidetag ---');
  const sockHidetag = createMockSock();
  await spyFeatures.handleHidetag(sockHidetag, mockMetadata.id, '!hidetag Promoção de Lançamento!', mockMetadata);
  assert.strictEqual(sockHidetag.sentMessages.length, 1);
  const hidetagMentions = sockHidetag.sentMessages[0].content.mentions || [];
  assert.strictEqual(hidetagMentions.length, 4, 'Hidetag deve mencionar apenas 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!hidetagMentions.includes(adminId), `Admin ${adminId} NÃO pode estar em mentions de !hidetag`);
  });
  console.log('✅ handleHidetag não marca admins no mentions.');

  // 3. Teste de handleTagAll
  console.log('\n--- 3. handleTagAll ---');
  const sockTagAll = createMockSock();
  await spyFeatures.handleTagAll(sockTagAll, mockMetadata.id, '!tagall Reunião geral', mockMetadata);
  assert.strictEqual(sockTagAll.sentMessages.length, 1);
  const tagAllContent = sockTagAll.sentMessages[0].content;
  const tagAllMentions = tagAllContent.mentions || [];
  assert.strictEqual(tagAllMentions.length, 4, 'TagAll deve mencionar apenas 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!tagAllMentions.includes(adminId), `Admin ${adminId} NÃO pode estar no mentions de !tagall`);
    const cleanPhone = adminId.split('@')[0];
    assert(!tagAllContent.text.includes(`@${cleanPhone}`), `Admin @${cleanPhone} NÃO pode ser listado no texto de !tagall`);
  });
  commonIds.forEach(commonId => {
    const cleanPhone = commonId.split('@')[0];
    assert(tagAllContent.text.includes(`@${cleanPhone}`), `Membro comum @${cleanPhone} DEVE estar no texto de !tagall`);
  });
  console.log('✅ handleTagAll lista e menciona apenas participantes comuns no texto e payload.');

  // 4. Teste de handleTotag
  console.log('\n--- 4. handleTotag ---');
  const sockTotag = createMockSock();
  await spyFeatures.handleTotag(sockTotag, mockMetadata.id, null, '!totag Olhem isso!', sockTotag, true);
  assert.strictEqual(sockTotag.sentMessages.length, 1);
  const totagMentions = sockTotag.sentMessages[0].content.mentions || [];
  assert.strictEqual(totagMentions.length, 4, 'Totag deve mencionar apenas 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!totagMentions.includes(adminId), `Admin ${adminId} NÃO pode estar no mentions de !totag`);
  });
  console.log('✅ handleTotag omite admins do mentions e texto.');

  // 5. Teste de handleMarcar2
  console.log('\n--- 5. handleMarcar2 ---');
  const sockMarcar2 = createMockSock();
  await spyFeatures.handleMarcar2(sockMarcar2, mockMetadata.id, sockMarcar2);
  assert.strictEqual(sockMarcar2.sentMessages.length, 1);
  const marcar2Content = sockMarcar2.sentMessages[0].content;
  const marcar2Mentions = marcar2Content.mentions || [];
  assert.strictEqual(marcar2Mentions.length, 4, 'Marcar2 deve mencionar apenas 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!marcar2Mentions.includes(adminId), `Admin ${adminId} NÃO pode estar no mentions de !marcar2`);
    const cleanPhone = adminId.split('@')[0];
    assert(!marcar2Content.text.includes(cleanPhone), `Admin ${cleanPhone} NÃO pode constar na lista de links de !marcar2`);
  });
  console.log('✅ handleMarcar2 lista apenas membros comuns com links diretos.');

  // 6. Teste de handleMarcar
  console.log('\n--- 6. handleMarcar ---');
  const sockMarcar = createMockSock();
  await spyFeatures.handleMarcar(sockMarcar, mockMetadata.id, '!marcar Novidades', mockMetadata, true);
  assert.strictEqual(sockMarcar.sentMessages.length, 1);
  const marcarContent = sockMarcar.sentMessages[0].content;
  const marcarMentions = marcarContent.mentions || [];
  assert.strictEqual(marcarMentions.length, 4, 'Marcar deve mencionar apenas 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!marcarMentions.includes(adminId), `Admin ${adminId} NÃO pode estar no mentions de !marcar`);
  });
  console.log('✅ handleMarcar omite administradores.');

  // 7. Teste de handleDDD
  console.log('\n--- 7. handleDDD ---');
  const sockDDD = createMockSock();
  // DDD 11 tem 2 admins (5511999990001, 5511999990002) e 2 membros comuns (5511999991111, 5511999992222)
  await spyFeatures.handleDDD(sockDDD, mockMetadata.id, '!ddd 11', mockMetadata);
  assert.strictEqual(sockDDD.sentMessages.length, 1);
  const dddContent = sockDDD.sentMessages[0].content;
  const dddMentions = dddContent.mentions || [];
  assert.strictEqual(dddMentions.length, 2, `DDD 11 deve marcar apenas os 2 participantes comuns de SP (encontrado: ${dddMentions.length})`);
  assert(dddMentions.includes('5511999991111@s.whatsapp.net'));
  assert(dddMentions.includes('5511999992222@s.whatsapp.net'));
  assert(!dddMentions.includes('5511999990001@s.whatsapp.net'), 'Admin 5511999990001 NÃO pode ser marcado por DDD');
  assert(!dddMentions.includes('5511999990002@s.whatsapp.net'), 'Admin 5511999990002 NÃO pode ser marcado por DDD');
  console.log('✅ handleDDD marca exclusivamente participantes comuns pertencentes ao DDD.');

  // 8. Teste de whatsappArmyService.extractNonAdminParticipants
  console.log('\n--- 8. whatsappArmyService.extractNonAdminParticipants ---');
  const armyNonAdmins = whatsappArmyService.extractNonAdminParticipants(mockParticipants);
  assert.strictEqual(armyNonAdmins.length, 4, 'Exército de sub-bots deve extrair apenas os 4 participantes comuns');
  adminIds.forEach(adminId => {
    assert(!armyNonAdmins.includes(adminId), `Admin ${adminId} NÃO pode estar no exército de mentions`);
  });
  console.log('✅ whatsappArmyService.extractNonAdminParticipants filtra 100% dos administradores.');

  // 9. Teste de broadcastToGroupExcludingAdmins
  console.log('\n--- 9. broadcastToGroupExcludingAdmins ---');
  const sockArmy = createMockSock();
  const resBroadcast = await whatsappArmyService.broadcastToGroupExcludingAdmins(sockArmy, mockMetadata.id, 'Oferta Relâmpago do Sub-Bot!');
  assert.strictEqual(resBroadcast.success, true);
  assert.strictEqual(resBroadcast.mentionedMembers, 4);
  assert.strictEqual(resBroadcast.adminsExcluded, 4);
  const armyGroupMentions = sockArmy.sentMessages[0].content.mentions || [];
  assert.strictEqual(armyGroupMentions.length, 4);
  adminIds.forEach(adminId => {
    assert(!armyGroupMentions.includes(adminId), `Admin ${adminId} não pode estar presente`);
  });
  console.log('✅ broadcastToGroupExcludingAdmins dispara com menção blindando administradores.');

  console.log('\n🎉 TODOS OS 9 TESTES DE BLINDAGEM DE ADMINISTRADORES PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

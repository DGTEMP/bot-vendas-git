/**
 * Test Suite: Gestão e Ajuste de Imagens de Bots, Sub-Bots, Grupos e Canais
 *
 * Valida:
 * 1. Otimização 640x640 JPEG via sharp
 * 2. Extração de buffer via anexo direto, citação (quoted) e URL
 * 3. Atualização de foto do Bot Master e de Sub-Bots (individual e em massa)
 * 4. Atualização de foto de Grupos (@g.us) e Canais Oficiais (@newsletter)
 * 5. Remoção e reset de fotos
 * 6. Controle de acesso (Dono para bots/canais, Admin para grupos)
 * 7. Comandos de WhatsApp e Endpoints da API REST
 */

const assert = require('assert');
const sharp = require('sharp');
const profilePicService = require('../src/services/profilePictureService');
const whatsappArmyService = require('../src/services/whatsappArmyService');
const models = require('../src/db/models');

async function runTests() {
  console.log('🧪 [TESTES] Iniciando validação de Gestão de Imagens de Bots, Sub-Bots, Grupos e Canais...\n');

  // Cria um buffer de imagem sintético para os testes (800x600 PNG)
  const syntheticImage = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 30, g: 144, b: 255 }
    }
  }).png().toBuffer();

  // =========================================================================
  // Teste 1: Otimização de Imagem para Padrão WhatsApp (640x640 JPEG)
  // =========================================================================
  console.log('--- Teste 1: Otimização de Imagem (sharp 640x640) ---');
  const optimized = await profilePicService.optimizeProfileImage(syntheticImage);
  assert.ok(Buffer.isBuffer(optimized), 'Deveria retornar um Buffer');
  const meta = await sharp(optimized).metadata();
  assert.strictEqual(meta.width, 640, 'Largura deve ser 640px');
  assert.strictEqual(meta.height, 640, 'Altura deve ser 640px');
  assert.strictEqual(meta.format, 'jpeg', 'Formato deve ser JPEG');
  console.log(`✅ Imagem otimizada com sucesso: ${meta.width}x${meta.height} ${meta.format} (${optimized.length} bytes)`);

  // =========================================================================
  // Teste 2: Extração de Imagem (Buffer Direto, Pre-cached, Quoted, URL)
  // =========================================================================
  console.log('\n--- Teste 2: Extração de Imagem de Múltiplas Fontes ---');
  
  // 2.1 Buffer direto
  const fromCustom = await profilePicService.extractImageBuffer(null, '', '', syntheticImage);
  assert.strictEqual(fromCustom, syntheticImage, 'Buffer customizado deve ser retornado');

  // 2.2 Buffer no objeto msg
  const mockMsgWithBuf = { _imageBuffer: syntheticImage };
  const fromMsgBuf = await profilePicService.extractImageBuffer(mockMsgWithBuf, '!fotobot');
  assert.strictEqual(fromMsgBuf, syntheticImage, 'Buffer interno em msg deve ser retornado');

  // 2.3 URL no texto (Unsplash)
  const testUrl = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400';
  const fromUrl = await profilePicService.extractImageBuffer(null, `!fotobot ${testUrl}`);
  assert.ok(Buffer.isBuffer(fromUrl) && fromUrl.length > 0, 'Buffer baixado da URL deve ser válido');
  console.log(`✅ Extração de imagem validada (Buffer direto, _imageBuffer e URL externa).`);

  // =========================================================================
  // Teste 3: Atualização de Foto do Bot Master e Sub-Bot
  // =========================================================================
  console.log('\n--- Teste 3: Atualização de Foto do Bot Master e Sub-Bot ---');

  let updatedJids = [];
  const mockMasterSock = {
    user: { id: '5511999990001:1@s.whatsapp.net' },
    updateProfilePicture: async (jid, content) => {
      updatedJids.push({ jid, size: content.length });
    },
    sendMessage: async () => {}
  };

  // 3.1 Bot Master
  const masterRes = await profilePicService.updateBotProfilePicture(mockMasterSock, syntheticImage);
  assert.strictEqual(masterRes.success, true);
  assert.strictEqual(masterRes.phone, '5511999990001');
  assert.strictEqual(masterRes.isSubBot, false);
  assert.strictEqual(updatedJids[0].jid, '5511999990001@s.whatsapp.net');
  console.log(`✅ Foto do Bot Master atualizada (+${masterRes.phone})`);

  // 3.2 Sub-Bot Suporte (com instanceId no socket)
  const mockSubSock = {
    instanceId: 1,
    user: { id: '254102815766:2@s.whatsapp.net' },
    updateProfilePicture: async (jid, content) => {
      updatedJids.push({ jid, size: content.length, instanceId: 1 });
    },
    sendMessage: async () => {}
  };

  const subRes = await profilePicService.updateBotProfilePicture(mockSubSock, syntheticImage);
  assert.strictEqual(subRes.success, true);
  assert.strictEqual(subRes.isSubBot, true);
  assert.strictEqual(subRes.instanceId, 1);
  console.log(`✅ Foto do Sub-Bot Suporte atualizada (Instância #${subRes.instanceId}, +${subRes.phone})`);

  // =========================================================================
  // Teste 4: Atualização de Sub-Bot via Exército (Individual e Frota Total)
  // =========================================================================
  console.log('\n--- Teste 4: Atualização de Sub-Bots da Frota (Individual e All) ---');

  // Registra mock sub-bots em whatsappArmyService.activeSockets
  whatsappArmyService.activeSockets.set(1001, {
    instanceId: 1001,
    user: { id: '5511999991001@s.whatsapp.net' },
    updateProfilePicture: async (jid, content) => {
      updatedJids.push({ jid, instanceId: 1001 });
    }
  });
  whatsappArmyService.activeSockets.set(1002, {
    instanceId: 1002,
    user: { id: '5511999991002@s.whatsapp.net' },
    updateProfilePicture: async (jid, content) => {
      updatedJids.push({ jid, instanceId: 1002 });
    }
  });

  // 4.1 Sub-bot individual por ID
  const singleSubRes = await profilePicService.updateSubBotProfilePicture(1001, syntheticImage);
  assert.strictEqual(singleSubRes.success, true);
  assert.strictEqual(singleSubRes.instanceId, 1001);
  console.log(`✅ Sub-bot #1001 atualizado individualmente com sucesso.`);

  // 4.2 Frota inteira (!fotosubbot all)
  const fleetRes = await profilePicService.updateSubBotProfilePicture('all', syntheticImage);
  assert.strictEqual(fleetRes.success, true);
  assert.strictEqual(fleetRes.target, 'subbot_fleet');
  assert.ok(fleetRes.updated >= 2, 'Pelo menos 2 sub-bots devem ter sido atualizados');
  console.log(`✅ Frota inteira atualizada com sucesso (${fleetRes.updated} sub-bots sincronizados).`);

  // Limpa sockets de teste
  whatsappArmyService.activeSockets.delete(1001);
  whatsappArmyService.activeSockets.delete(1002);

  // =========================================================================
  // Teste 5: Atualização de Foto de Grupos (@g.us)
  // =========================================================================
  console.log('\n--- Teste 5: Atualização de Foto de Grupos (@g.us) ---');

  let groupUpdatedJid = null;
  const mockGroupSock = {
    user: { id: '5511999990001@s.whatsapp.net' },
    updateProfilePicture: async (jid, content) => {
      groupUpdatedJid = jid;
    }
  };

  const groupJid = '120363412868252476@g.us';
  const groupRes = await profilePicService.updateGroupPicture(groupJid, syntheticImage, mockGroupSock);
  assert.strictEqual(groupRes.success, true);
  assert.strictEqual(groupRes.groupJid, groupJid);
  assert.strictEqual(groupUpdatedJid, groupJid);
  console.log(`✅ Foto do Grupo ${groupJid} atualizada com sucesso.`);

  // =========================================================================
  // Teste 6: Atualização de Foto de Canais Oficiais (@newsletter)
  // =========================================================================
  console.log('\n--- Teste 6: Atualização de Foto de Canais (@newsletter) ---');

  let channelUpdatedJid = null;
  const mockChannelSock = {
    user: { id: '5511999990001@s.whatsapp.net' },
    newsletterUpdatePicture: async (jid, content) => {
      channelUpdatedJid = jid;
    }
  };

  const channelJid = '1203631794254658974@newsletter';
  const channelRes = await profilePicService.updateChannelPicture(channelJid, syntheticImage, mockChannelSock);
  assert.strictEqual(channelRes.success, true);
  assert.strictEqual(channelRes.channelJid, channelJid);
  assert.strictEqual(channelUpdatedJid, channelJid);
  console.log(`✅ Foto do Canal Oficial ${channelJid} atualizada com sucesso.`);

  // =========================================================================
  // Teste 7: Remoção de Foto de Perfil (Reset)
  // =========================================================================
  console.log('\n--- Teste 7: Remoção de Foto (Reset para Avatar Padrão) ---');

  let removedJids = [];
  const mockRemoveSock = {
    user: { id: '5511999990001@s.whatsapp.net' },
    removeProfilePicture: async (jid) => {
      removedJids.push(jid);
    },
    newsletterRemovePicture: async (jid) => {
      removedJids.push(jid);
    }
  };

  await profilePicService.removePicture('bot', null, mockRemoveSock);
  assert.strictEqual(removedJids[0], '5511999990001@s.whatsapp.net');

  await profilePicService.removePicture('group', groupJid, mockRemoveSock);
  assert.strictEqual(removedJids[1], groupJid);

  await profilePicService.removePicture('channel', channelJid, mockRemoveSock);
  assert.strictEqual(removedJids[2], channelJid);
  console.log(`✅ Remoção de fotos validada para bot, grupo e canal.`);

  // =========================================================================
  // Teste 8: Dispatcher de Comandos WhatsApp (Permissões e Execução)
  // =========================================================================
  console.log('\n--- Teste 8: Validação de Comandos WhatsApp e Permissões ---');

  let sentMessages = [];
  const dispatchMockSock = {
    user: { id: '5511999990001@s.whatsapp.net' },
    updateProfilePicture: async () => {},
    sendMessage: async (to, payload) => {
      sentMessages.push({ to, text: payload.text });
      return payload;
    }
  };

  // 8.1 Não-dono tentando alterar foto do bot -> Deve ser bloqueado
  await profilePicService.handleProfilePictureCommand({
    sock: dispatchMockSock,
    from: '5511988880000@s.whatsapp.net',
    text: `!fotobot ${testUrl}`,
    msg: {},
    senderPhone: '5511988880000',
    isGroup: false,
    isOwnerUser: false,
    isAdmin: false
  });

  const lastDenied = sentMessages[sentMessages.length - 1];
  assert.ok(lastDenied.text.includes('Acesso Negado'), 'Não-dono deve ser bloqueado');
  console.log(`✅ Bloqueio de segurança para não-dono validado com sucesso.`);

  // 8.2 Dono executando !fotobot com URL -> Deve aplicar com sucesso
  await profilePicService.handleProfilePictureCommand({
    sock: dispatchMockSock,
    from: '5511999999999@s.whatsapp.net',
    text: `!fotobot ${testUrl}`,
    msg: {},
    senderPhone: '5511999999999',
    isGroup: false,
    isOwnerUser: true,
    isAdmin: false
  });

  const lastSuccess = sentMessages[sentMessages.length - 1];
  assert.ok(lastSuccess.text.includes('FOTO DO BOT ATUALIZADA'), 'Dono deve atualizar com sucesso');
  console.log(`✅ Dono executando !fotobot processado e aprovado com sucesso.`);

  // 8.3 Comando !ajudafoto -> Deve retornar menu explicativo
  await profilePicService.handleProfilePictureCommand({
    sock: dispatchMockSock,
    from: '5511999999999@s.whatsapp.net',
    text: `!ajudafoto`,
    msg: {},
    senderPhone: '5511999999999',
    isGroup: false,
    isOwnerUser: true,
    isAdmin: false
  });

  const helpReply = sentMessages[sentMessages.length - 1];
  assert.ok(helpReply.text.includes('CENTRAL DE GESTÃO DE IMAGENS'), 'Menu de ajuda deve ser retornado');
  console.log(`✅ Menu interativo !ajudafoto retornado com sucesso.`);

  // =========================================================================
  // Teste 9: Endpoints da API REST (/api/profile-picture)
  // =========================================================================
  console.log('\n--- Teste 9: Endpoints da API REST (Painel Web) ---');
  const request = require('supertest');
  const { createServer } = require('../src/server/app');
  const expressApp = createServer();

  // 9.1 GET /api/profile-picture/targets
  const targetsRes = await request(expressApp).get('/api/profile-picture/targets');
  assert.strictEqual(targetsRes.status, 200);
  assert.strictEqual(targetsRes.body.success, true);
  assert.ok(Array.isArray(targetsRes.body.subbots), 'subbots deve ser array');
  assert.ok(Array.isArray(targetsRes.body.channels), 'channels deve ser array');
  console.log(`✅ GET /api/profile-picture/targets retornou alvos com sucesso (${targetsRes.body.subbots.length} sub-bots, ${targetsRes.body.channels.length} canais).`);

  // 9.2 POST /api/profile-picture/bot com corpo vazio (validação 400)
  const badPostRes = await request(expressApp).post('/api/profile-picture/bot').send({});
  assert.strictEqual(badPostRes.status, 400);
  assert.strictEqual(badPostRes.body.success, false);
  console.log(`✅ Validação de payload na API REST (400) funcionando.`);

  console.log('\n🎉 TODOS OS TESTES DE GESTÃO DE IMAGENS PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de imagens:', err);
  process.exit(1);
});

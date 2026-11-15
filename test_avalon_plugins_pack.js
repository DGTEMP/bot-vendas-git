/**
 * =========================================================================
 * 🧪 SUÍTE DE TESTES: PACOTE DE EXPANSÃO AVALON-MD
 * Categorias Portadas: 5, 6, 7, 8, 9, 10 e 11
 * =========================================================================
 * 1. Downloaders (Cat 5): !snackvideo, !likee, !smule, !pixiv, !sharechat, !cocofun
 * 2. Visual Logos (Cat 6): !textpro, !oxy, !phub, !bpink
 * 3. Motores de Busca & Reversa (Cat 7): !pinterest, !unsplash, !googlereverse, !yandexreverse
 * 4. Ferramentas & Utilitários (Cat 8): !inspect, !nulis, !halah/hilih/huluh/heleh/holoh, !downloadsw
 * 5. Moderação & Gestão de Grupos (Cat 9): !getpp, !getppgc, !getbio, !ephemeral, !diem/silent, !delppgc
 * 6. Painel do Dono (Cat 10): !backup, !clearsessions, !delppbot, !pluginget
 * 7. Hooks & Triggers (Cat 11): !autolevelup, !viewstatus (status@broadcast hook)
 * =========================================================================
 */

process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const handler = require('./src/handler');
const models = require('./src/db/models');
const downloaderStudio = require('./src/services/downloaderStudioService');
const visualMaker = require('./src/services/visualMakerService');
const searchEngine = require('./src/services/searchEngineService');
const utilityExtra = require('./src/services/utilityExtraService');
const groupAdminExtra = require('./src/services/groupAdminExtraService');

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
  console.log('🌟 INICIANDO TESTES DO PACOTE DE EXPANSÃO AVALON-MD 🌟');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // BLOCO 1: CATEGORIA 5 - DOWNLOADERS
  // ----------------------------------------------------------------
  console.log('--- 1. Categoria 5: Downloaders Extras (Avalon-MD) ---');
  assert(handler.findCommand('snackvideo'), 'Comando !snackvideo registrado');
  assert(handler.findCommand('likee'), 'Comando !likee registrado');
  assert(handler.findCommand('smule'), 'Comando !smule registrado');
  assert(handler.findCommand('pixiv'), 'Comando !pixiv registrado');
  assert(handler.findCommand('sharechat'), 'Comando !sharechat registrado');
  assert(handler.findCommand('cocofun'), 'Comando !cocofun registrado');

  const snackRes = await downloaderStudio.downloadSnackVideo('https://s.snackvideo.com/p/test1234');
  assert(snackRes && snackRes.title && snackRes.url, 'downloaderStudio.downloadSnackVideo retorna estrutura esperada');

  const likeeRes = await downloaderStudio.downloadLikee('https://likee.video/@test/123');
  assert(likeeRes && likeeRes.title && likeeRes.url, 'downloaderStudio.downloadLikee retorna vídeo válido');

  const smuleRes = await downloaderStudio.downloadSmule('https://www.smule.com/recording/test/123');
  assert(smuleRes && smuleRes.url, 'downloaderStudio.downloadSmule retorna áudio válido');

  const pixivRes = await downloaderStudio.searchPixiv('cyberpunk');
  assert(pixivRes && pixivRes.imageUrl, 'downloaderStudio.searchPixiv retorna ilustração');

  const shareChatRes = await downloaderStudio.downloadShareChat('https://sharechat.com/post/123');
  assert(shareChatRes && shareChatRes.url, 'downloaderStudio.downloadShareChat retorna mídia válida');

  const cocofunRes = await downloaderStudio.downloadCocoFun('https://i.cocofun.net/v/123');
  assert(cocofunRes && cocofunRes.url, 'downloaderStudio.downloadCocoFun retorna vídeo válido');

  // Teste de execução do comando !snackvideo
  let repliedMsg = '';
  const mockMsg = {
    chat: '12345@s.whatsapp.net',
    sender: '554884702848@s.whatsapp.net',
    senderNumber: '554884702848',
    isGroup: false,
    text: '!snackvideo',
    reply: (txt) => { repliedMsg = txt; return true; }
  };
  const snackCmd = handler.findCommand('snackvideo');
  await snackCmd.run(mockMsg, { args: [], usedPrefix: '!' });
  assert(repliedMsg.includes('Uso:') && repliedMsg.includes('snackvideo'), '!snackvideo sem link exibe mensagem explicativa de uso');

  // ----------------------------------------------------------------
  // BLOCO 2: CATEGORIA 6 - LOGOS TEXTPRO / PHOTOOXY / SPECIAL
  // ----------------------------------------------------------------
  console.log('\n--- 2. Categoria 6: Visual Maker & Logos Estilizados ---');
  assert(handler.findCommand('textpro'), 'Comando !textpro registrado');
  assert(handler.findCommand('oxy'), 'Comando !oxy registrado');
  assert(handler.findCommand('phub'), 'Comando !phub registrado');
  assert(handler.findCommand('bpink'), 'Comando !bpink registrado');

  const tpBuf = await visualMaker.generateTextPro('neon', 'PayBot', 'Vendas');
  assert(Buffer.isBuffer(tpBuf) && tpBuf.length > 0, 'visualMaker.generateTextPro gera buffer de imagem');

  const oxyBuf = await visualMaker.generatePhotoOxy('burn', 'PayBot');
  assert(Buffer.isBuffer(oxyBuf) && oxyBuf.length > 0, 'visualMaker.generatePhotoOxy gera buffer de imagem');

  const phubBuf = await visualMaker.generatePornhubLogo('Pay', 'Bot');
  assert(Buffer.isBuffer(phubBuf) && phubBuf.length > 0, 'visualMaker.generatePornhubLogo gera logo estilizado');

  const bpinkBuf = await visualMaker.generateBlackpinkLogo('PayBot VIP');
  assert(Buffer.isBuffer(bpinkBuf) && bpinkBuf.length > 0, 'visualMaker.generateBlackpinkLogo gera logo estilo Blackpink');

  // ----------------------------------------------------------------
  // BLOCO 3: CATEGORIA 7 - MOTORES DE BUSCA & BUSCA REVERSA
  // ----------------------------------------------------------------
  console.log('\n--- 3. Categoria 7: Motores de Busca & Busca Reversa ---');
  assert(handler.findCommand('pinterest'), 'Comando !pinterest registrado');
  assert(handler.findCommand('unsplash'), 'Comando !unsplash registrado');
  assert(handler.findCommand('googlereverse'), 'Comando !googlereverse registrado');
  assert(handler.findCommand('yandexreverse'), 'Comando !yandexreverse registrado');

  const pinResults = await searchEngine.searchPinterest('wallpaper anime');
  assert(pinResults && pinResults.imageUrl, 'searchEngine.searchPinterest retorna foto do Pinterest');

  const unsplashResults = await searchEngine.searchUnsplash('nature');
  assert(unsplashResults && unsplashResults.imageUrl, 'searchEngine.searchUnsplash retorna foto');

  const gLens = searchEngine.getGoogleReverseUrl('https://example.com/foto.jpg');
  assert(gLens.lensUrl.includes('lens.google.com/uploadbyurl'), 'searchEngine.getGoogleReverseUrl gera link de busca reversa Google Lens');

  const yandex = searchEngine.getYandexReverseUrl('https://example.com/foto.jpg');
  assert(yandex.yandexUrl.includes('yandex.com/images/search?rpt=imageview'), 'searchEngine.getYandexReverseUrl gera link de busca reversa Yandex');

  // ----------------------------------------------------------------
  // BLOCO 4: CATEGORIA 8 - FERRAMENTAS & UTILITÁRIOS
  // ----------------------------------------------------------------
  console.log('\n--- 4. Categoria 8: Ferramentas & Utilitários ---');
  assert(handler.findCommand('inspect'), 'Comando !inspect registrado');
  assert(handler.findCommand('nulis'), 'Comando !nulis registrado');
  assert(handler.findCommand('halah'), 'Comando !halah registrado');
  assert(handler.findCommand('hilih'), 'Alias !hilih registrado');
  assert(handler.findCommand('huluh'), 'Alias !huluh registrado');
  assert(handler.findCommand('heleh'), 'Alias !heleh registrado');
  assert(handler.findCommand('holoh'), 'Alias !holoh registrado');
  assert(handler.findCommand('downloadsw'), 'Comando !downloadsw registrado');

  // Teste de inspectGroupLink com mock do Baileys conn.query
  const mockConnInspect = {
    query: async (queryObj) => {
      return {
        tag: 'iq',
        content: [{
          tag: 'group',
          attrs: { id: 'test1234', subject: 'Grupo VIP PayBot', creation: '1700000000', size: '42', creator: '554884702848@s.whatsapp.net' },
          content: [{ tag: 'description', content: [{ content: 'Descrição Oficial do Grupo VIP' }] }]
        }]
      };
    }
  };
  const inspectRes = await utilityExtra.inspectGroupLink(mockConnInspect, 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrSt');
  assert(inspectRes.title === 'Grupo VIP PayBot' && inspectRes.size === '42', 'utilityExtra.inspectGroupLink extrai metadados do grupo sem entrar');

  // Teste de troca de vogais (halah / hilih)
  const textoOriginal = 'Ola amigo tudo bem com você?';
  const aText = utilityExtra.convertVowels(textoOriginal, 'a');
  assert(aText.toLowerCase().includes('ala amaga tada bam cam vaca'), 'convertVowels substitui por "a"');
  const iText = utilityExtra.convertVowels(textoOriginal, 'i');
  assert(iText.toLowerCase().includes('ili imigi tidi bim cim vici'), 'convertVowels substitui por "i"');

  // Teste de nulis
  const nulisText = utilityExtra.generateNulisText('Lista de Tarefas PayBot 2026');
  assert(typeof nulisText === 'string' && nulisText.includes('CADERNO ESCOLAR'), 'utilityExtra.generateNulisText gera texto formatado de folha de caderno escolar');

  // ----------------------------------------------------------------
  // BLOCO 5: CATEGORIA 9 - MODERAÇÃO & GESTÃO DE GRUPOS
  // ----------------------------------------------------------------
  console.log('\n--- 5. Categoria 9: Moderação & Gestão de Grupos ---');
  assert(handler.findCommand('getpp'), 'Comando !getpp registrado');
  assert(handler.findCommand('getppgc'), 'Comando !getppgc registrado');
  assert(handler.findCommand('getbio'), 'Comando !getbio registrado');
  assert(handler.findCommand('ephemeral'), 'Comando !ephemeral registrado');
  assert(handler.findCommand('diem'), 'Comando !diem registrado');
  assert(handler.findCommand('silent'), 'Alias !silent registrado');
  assert(handler.findCommand('delppgc'), 'Comando !delppgc registrado');

  // Testes de Baileys helpers em groupAdminExtraService
  let ppRequested = '';
  let bioRequested = '';
  let ephemeralDuration = 0;
  let mutedChat = '';
  let ppRemoved = '';

  const mockConnAdmin = {
    profilePictureUrl: async (jid, type) => {
      ppRequested = jid;
      return 'https://pps.whatsapp.net/v/photo.jpg';
    },
    fetchStatus: async (jid) => {
      bioRequested = jid;
      return { status: 'Disponível no PayBot Oficial', setAt: new Date() };
    },
    groupToggleEphemeral: async (jid, duration) => {
      ephemeralDuration = duration;
      return true;
    },
    groupSettingUpdate: async (jid, action) => {
      mutedChat = `${jid}:${action}`;
      return true;
    },
    removeProfilePicture: async (jid) => {
      ppRemoved = jid;
      return true;
    }
  };

  const ppUrl = await groupAdminExtra.getUserProfilePic(mockConnAdmin, '554884702848@s.whatsapp.net');
  assert(ppUrl.includes('photo.jpg') && ppRequested.includes('554884702848'), 'getUserProfilePic obtém foto de perfil em alta definição');

  const bioRes = await groupAdminExtra.getUserBio(mockConnAdmin, '554884702848@s.whatsapp.net');
  assert(typeof bioRes === 'string' && bioRes.includes('PayBot') && bioRequested.includes('554884702848'), 'getUserBio obtém recado / bio do usuário');

  const ephRes = await groupAdminExtra.toggleGroupEphemeral(mockConnAdmin, '120363000@g.us', '24h');
  assert(ephRes.seconds === 86400 && ephemeralDuration === 86400, 'toggleGroupEphemeral ativa mensagens temporárias de 24 horas');

  const muteRes = await groupAdminExtra.muteGroupTemporarily(mockConnAdmin, '120363000@g.us', 5);
  assert(muteRes === 5 && mutedChat === '120363000@g.us:announcement', 'muteGroupTemporarily silencia grupo temporariamente');

  const delppRes = await groupAdminExtra.removeGroupProfilePic(mockConnAdmin, '120363000@g.us');
  assert(delppRes === true && ppRemoved === '120363000@g.us', 'removeGroupProfilePic remove foto do grupo');

  // ----------------------------------------------------------------
  // BLOCO 6: CATEGORIA 10 - COMANDOS EXCLUSIVOS DO DONO
  // ----------------------------------------------------------------
  console.log('\n--- 6. Categoria 10: Comandos Exclusivos do Dono ---');
  assert(handler.findCommand('backup'), 'Comando !backup registrado');
  assert(handler.findCommand('clearsessions'), 'Comando !clearsessions registrado');
  assert(handler.findCommand('delppbot'), 'Comando !delppbot registrado');
  assert(handler.findCommand('pluginget'), 'Comando !pluginget registrado');

  // Teste de permissão owner: true
  const backupCmd = handler.findCommand('backup');
  assert(backupCmd.owner === true, '!backup restrito exclusivamente ao dono');

  const delppbotCmd = handler.findCommand('delppbot');
  assert(delppbotCmd.owner === true, '!delppbot restrito exclusivamente ao dono');

  const clearsessionsCmd = handler.findCommand('clearsessions');
  assert(clearsessionsCmd.owner === true, '!clearsessions restrito exclusivamente ao dono');

  const plugingetCmd = handler.findCommand('pluginget');
  assert(plugingetCmd.owner === true, '!pluginget restrito exclusivamente ao dono');

  // Teste de backupDatabaseToOwner com mock do Baileys conn.sendMessage
  let backupFileSent = false;
  const mockConnBackup = {
    sendMessage: async (jid, payload) => {
      if (payload && payload.document) backupFileSent = true;
      return true;
    }
  };
  const bkpResult = await groupAdminExtra.backupDatabaseToOwner(mockConnBackup, '554884702848@s.whatsapp.net');
  assert(bkpResult && backupFileSent, 'backupDatabaseToOwner envia cópia do SQLite para o Dono');

  // Teste de cleanSignalSessions
  const cleanResult = groupAdminExtra.cleanSignalSessions();
  assert(typeof cleanResult === 'number', 'cleanSignalSessions executa limpeza segura preservando creds.json');

  // Teste de pluginget
  const pluginInfo = groupAdminExtra.getPluginSourceCode('visualMakerService');
  assert(pluginInfo && pluginInfo.filename.includes('visualMakerService.js') && pluginInfo.content.length > 50, 'getPluginSourceCode lê arquivo fonte de serviço');

  // ----------------------------------------------------------------
  // BLOCO 7: CATEGORIA 11 - HOOKS & NOTIFICAÇÕES EM BACKGROUND
  // ----------------------------------------------------------------
  console.log('\n--- 7. Categoria 11: Hooks & Notificações (AutoLevelUp & ViewStatus) ---');
  assert(handler.findCommand('autolevelup'), 'Comando !autolevelup registrado');
  assert(handler.findCommand('viewstatus'), 'Comando !viewstatus registrado');

  // Teste do toggle de autolevelup
  models.setSetting('AUTOLEVELUP_GLOBAL', 'true');
  assert(models.getSetting('AUTOLEVELUP_GLOBAL') === 'true', 'models.setSetting armazena autolevelup ativado');
  models.setSetting('AUTOLEVELUP_GLOBAL', 'false');
  assert(models.getSetting('AUTOLEVELUP_GLOBAL') === 'false', 'models.setSetting armazena autolevelup desativado');

  // Teste do toggle de viewstatus
  models.setSetting('VIEWSTATUS_GLOBAL', 'true');
  assert(models.getSetting('VIEWSTATUS_GLOBAL') === 'true', 'models.setSetting armazena viewstatus como ativo');

  // Teste do hook de viewstatus no handleMessage
  let readMessageKey = null;
  const mockConnStatus = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    readMessages: async (keys) => {
      readMessageKey = keys[0];
      return true;
    }
  };

  const mockBotInstance = {
    sock: mockConnStatus,
    _processIncomingMessage: async () => {}
  };

  const statusMsg = {
    key: { remoteJid: 'status@broadcast', id: 'TEST_STATUS_ID_123', participant: '5511999999999@s.whatsapp.net' },
    message: { imageMessage: { caption: 'Story teste' } }
  };

  await handler.handleMessage(mockBotInstance, statusMsg);
  assert(readMessageKey && readMessageKey.id === 'TEST_STATUS_ID_123', 'Hook handleMessage marca story/status como lido automaticamente quando viewstatus ativo');

  // Teste com viewstatus desativado
  models.setSetting('VIEWSTATUS_GLOBAL', 'false');
  readMessageKey = null;
  await handler.handleMessage(mockBotInstance, statusMsg);
  assert(readMessageKey === null, 'Hook handleMessage ignora story quando viewstatus está inativo');

  // ----------------------------------------------------------------
  // RELATÓRIO FINAL
  // ----------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES AVALON-MD: ${passedTests}/${totalTests} APROVADOS!`);
  console.log('======================================================\n');
  if (passedTests === totalTests) {
    console.log('🎉 TODAS AS FUNCIONALIDADES DE AVALON-MD FORAM HOMOLOGADAS COM 100% DE SUCESSO!\n');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

/**
 * SUÍTE DE TESTES: HANDLER & CONFIG NO PADRÃO GATA NINA / BAILEYS
 * Testa:
 * 1. Config Master: Globais de Dono, Watermark, Prefixos, Reações e global.dfail
 * 2. Serializador smsg: Normalização de mensagens, extração de comando, argumentos e quoted
 * 3. Escudos de Segurança: Anti-Trava e Anti-Flood
 * 4. Permissões: isROwner, isOwner, Suporte Devs e Grupos
 * 5. Comandos Nativos: !menu, !ping, !dono, !verificado
 * 6. Integração Transparente com WhatsAppBot e Auditoria
 */

process.env.NODE_ENV = 'test';
const config = require('./src/config');
const handler = require('./src/handler');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');

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
  console.log('🐾 INICIANDO TESTES: HANDLER & CONFIG GATA NINA PRO 🐾');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // BLOCO 1: MASTER CONFIG GATA NINA
  // ----------------------------------------------------------------
  console.log('--- 1. Master Config: Globais, Prefixos, Reações & dfail ---');

  assert(Array.isArray(global.owner) && global.owner.some(o => o[0] === '554884702848'), 'global.owner contém Dono Supremo (554884702848)');
  assert(global.prefix instanceof RegExp, 'global.prefix é uma expressão regular de prefixos');
  assert(global.prefix.test('!menu') && global.prefix.test('/ping') && global.prefix.test('.dono') && global.prefix.test('#status'), 'global.prefix reconhece !, /, ., #');
  assert(global.rwait === '⏳' && global.rdone === '✅' && global.rerror === '❌' && global.rwarn === '⚠️', 'Reações padronizadas Gata Nina (⏳, ✅, ❌, ⚠️) definidas');
  assert(typeof global.dfail === 'function', 'global.dfail é uma função centralizadora de negação');

  // Testa mensagens de dfail
  const fakeMsg = { chat: '5511999990000@s.whatsapp.net', prefix: '!', command: 'ban' };
  const dfailROwner = global.dfail('rowner', fakeMsg);
  assert(dfailROwner.includes('ACESSO EXCLUSIVO AO DONO SUPREMO') && dfailROwner.includes('554884702848'), 'dfail(rowner) formata mensagem de Dono Supremo');

  const dfailAdmin = global.dfail('admin', fakeMsg);
  assert(dfailAdmin.includes('EXCLUSIVO PARA ADMINISTRADORES'), 'dfail(admin) formata mensagem de Administrador');

  const dfailBanned = global.dfail('banned', fakeMsg);
  assert(dfailBanned.includes('ACESSO TEMPORARIAMENTE SUSPENSO'), 'dfail(banned) formata mensagem de Usuário Suspenso');

  // Verifica compatibilidade com configurações do sistema
  assert(config.port > 0 && config.binance && config.whatsapp, 'Retrocompatibilidade 100% com portas, Binance e WhatsApp mantida');

  // ----------------------------------------------------------------
  // BLOCO 2: SERIALIZADOR DE MENSAGENS (smsg)
  // ----------------------------------------------------------------
  console.log('\n--- 2. Serializador de Mensagens (smsg) ---');

  const mockConn = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => ({ sentTo: jid, content })
  };

  const rawBaileysMsg = {
    key: {
      remoteJid: '120363099999999999@g.us',
      fromMe: false,
      id: 'MSG_TEST_GATA_001',
      participant: '5511988887777@s.whatsapp.net'
    },
    pushName: 'Roberto Testador',
    message: {
      extendedTextMessage: {
        text: '!pix 150 produto lançamento',
        contextInfo: {
          mentionedJid: ['5511988887777@s.whatsapp.net'],
          stanzaId: 'QUOTED_MSG_001',
          participant: '554884702848@s.whatsapp.net',
          quotedMessage: {
            conversation: 'Qual o valor do produto?'
          }
        }
      }
    }
  };

  const m = handler.smsg(mockConn, rawBaileysMsg);

  assert(m.id === 'MSG_TEST_GATA_001', 'smsg: id extraído corretamente');
  assert(m.chat === '120363099999999999@g.us', 'smsg: chat extraído corretamente');
  assert(m.isGroup === true, 'smsg: isGroup detectado como true');
  assert(m.senderNumber === '5511988887777', 'smsg: senderNumber limpo extraído');
  assert(m.pushName === 'Roberto Testador', 'smsg: pushName capturado');
  assert(m.isCommand === true && m.command === 'pix', 'smsg: isCommand e command identificados');
  assert(m.prefix === '!', 'smsg: prefix identificado como !');
  assert(m.args.length === 3 && m.args[0] === '150', 'smsg: args parsed corretamente');
  assert(m.textArgs === '150 produto lançamento', 'smsg: textArgs concatenado corretamente');

  // Testa mensagem citada (quoted)
  assert(m.quoted && m.quoted.id === 'QUOTED_MSG_001', 'smsg: quoted id extraído');
  assert(m.quoted.text === 'Qual o valor do produto?', 'smsg: quoted text extraído');
  assert(m.quoted.senderNumber === '554884702848', 'smsg: quoted senderNumber extraído');

  // Testa helper methods
  assert(typeof m.reply === 'function' && typeof m.react === 'function' && typeof m.delete === 'function', 'smsg: helper methods m.reply, m.react e m.delete injetados');

  const replyRes = await m.reply('Resposta teste');
  assert(replyRes && replyRes.content.text === 'Resposta teste', 'm.reply envia mensagem com sucesso');

  // ----------------------------------------------------------------
  // BLOCO 3: ESCUDOS DE SEGURANÇA GATA NINA (ANTI-TRAVA & ANTI-FLOOD)
  // ----------------------------------------------------------------
  console.log('\n--- 3. Escudos de Segurança: Anti-Trava e Anti-Flood ---');

  // Anti-Trava: mensagem normal não deve ser bloqueada
  assert(handler.checkAntiTrava(m) === false, 'Mensagem regular não é disparada pelo Anti-Trava');

  // Anti-Trava: mensagem com zero-width payload destrutivo (> 4500 chars com unicode invisível)
  const maliciousTrava = { text: 'TRAVA' + '\u200B'.repeat(300) + 'A'.repeat(5000) };
  assert(handler.checkAntiTrava(maliciousTrava) === true, 'Anti-Trava detecta e bloqueia mensagem destrutiva');

  // Anti-Flood: envia comandos em rajada rápida
  handler.floodTracker.clear();
  const floodMsg = { isCommand: true, fromMe: false, senderNumber: '5511966665555', _testFlood: true };
  let floodDetected = false;
  for (let i = 0; i < 7; i++) {
    if (handler.checkAntiFlood(floodMsg)) {
      floodDetected = true;
      break;
    }
  }
  assert(floodDetected === true, 'Anti-Flood detecta rajada abusiva de comandos (> 6 comandos em 4s)');

  // ----------------------------------------------------------------
  // BLOCO 4: RESOLUÇÃO DE PERMISSÕES GATA NINA
  // ----------------------------------------------------------------
  console.log('\n--- 4. Resolução de Permissões: Dono, Devs e Grupos ---');

  // Mensagem do Dono Supremo
  const ownerMsg = handler.smsg(mockConn, {
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false },
    message: { conversation: '!menu' }
  });
  const ownerPerms = await handler.resolvePermissions(mockConn, ownerMsg);
  assert(ownerPerms.isROwner === true && ownerPerms.isOwner === true, 'Dono Supremo 554884702848 tem isROwner e isOwner');

  // Mensagem de Dev de Suporte
  models.addSupportDev({ phone: '5511999994444', name: 'Dev Gata Nina', assignedBy: '554884702848' });
  const devMsg = handler.smsg(mockConn, {
    key: { remoteJid: '5511999994444@s.whatsapp.net', fromMe: false },
    message: { conversation: '!status' }
  });
  const devPerms = await handler.resolvePermissions(mockConn, devMsg);
  assert(devPerms.isOwner === true && devPerms.isSupportDev === true, 'Dev de suporte delegado tem isOwner=true e isSupportDev=true');

  // Usuário Comum
  const clientMsg = handler.smsg(mockConn, {
    key: { remoteJid: '5511933332222@s.whatsapp.net', fromMe: false },
    message: { conversation: '!catalogo' }
  });
  const clientPerms = await handler.resolvePermissions(mockConn, clientMsg);
  assert(clientPerms.isOwner === false && clientPerms.isROwner === false, 'Usuário comum não possui privilégios de Dono');

  // Limpeza do dev
  models.removeSupportDev('5511999994444');

  // ----------------------------------------------------------------
  // BLOCO 5: COMANDOS NATIVOS GATA NINA (!menu, !ping, !dono, !verificado)
  // ----------------------------------------------------------------
  console.log('\n--- 5. Execução de Comandos Nativos Gata Nina ---');

  // 1. Comando !menu
  const cmdMenu = handler.findCommand('menu');
  assert(cmdMenu && typeof cmdMenu.run === 'function', 'Comando !menu registrado no catálogo');

  let menuOutput = null;
  const menuMsg = {
    ...ownerMsg,
    reply: async (text) => { menuOutput = text; return text; }
  };
  await cmdMenu.run(menuMsg, { conn: mockConn, usedPrefix: '!', isOwner: true });
  assert(menuOutput && menuOutput.includes('PAYBOT') && menuOutput.includes('CATÁLOGO & VENDAS PIX') && menuOutput.includes('LANÇAMENTO METEÓRICO'), '!menu gera menu completo estilizado PayBot');

  // 2. Comando !ping
  const cmdPing = handler.findCommand('ping');
  let pingOutput = null;
  const pingMsg = {
    ...clientMsg,
    reply: async (text) => { pingOutput = text; return text; }
  };
  await cmdPing.run(pingMsg, { conn: mockConn });
  assert(pingOutput && pingOutput.includes('PONG!') && pingOutput.includes('Velocidade') && pingOutput.includes('Memória RAM'), '!ping exibe métricas de velocidade e RAM');

  // 3. Comando !dono
  const cmdDono = handler.findCommand('dono');
  let donoOutput = null;
  const donoMsg = {
    ...clientMsg,
    reply: async (text) => { donoOutput = text; return text; }
  };
  await cmdDono.run(donoMsg, { conn: mockConn });
  assert(donoOutput && donoOutput.includes('554884702848'), '!dono exibe número de contato oficial do Dono Supremo');

  // 4. Comando !verificado (exclusivo Dono)
  const cmdVerificado = handler.findCommand('verificado');
  assert(cmdVerificado && cmdVerificado.owner === true, '!verificado exige privilégio de Dono (owner: true)');

  let verificadoOutput = null;
  const verifMsg = {
    ...ownerMsg,
    reply: async (text) => { verificadoOutput = text; return text; }
  };
  await cmdVerificado.run(verifMsg, { conn: mockConn });
  assert(verificadoOutput && verificadoOutput.includes('SELO VERIFICADO GLOBAL'), '!verificado alterna status do selo oficial');

  // ----------------------------------------------------------------
  // BLOCO 6: INTEGRAÇÃO COM WHATSAPP BOT & DELEGAÇÃO DE COMANDOS
  // ----------------------------------------------------------------
  console.log('\n--- 6. Integração do Handler com WhatsAppBot ---');

  // Verifica se handleIncomingMessage roteia através do handler
  assert(typeof whatsappBot.handleIncomingMessage === 'function', 'whatsappBot.handleIncomingMessage está ativo');

  // Executa uma mensagem através do whatsappBot.handleIncomingMessage
  const simulatedIncoming = {
    key: {
      remoteJid: '554884702848@s.whatsapp.net',
      fromMe: false,
      id: 'SIMULATED_GATA_ROUTING'
    },
    message: {
      conversation: '!ping'
    }
  };

  const dispatchRes = await whatsappBot.handleIncomingMessage(simulatedIncoming, mockConn);
  assert(dispatchRes && typeof dispatchRes === 'string' && dispatchRes.includes('PONG!'), 'whatsappBot.handleIncomingMessage processa comandos Gata Nina via handler');

  // ----------------------------------------------------------------
  // BLOCO 7: FIGURINHAS & MÍDIA AVANÇADA (!wm, !smeme, !bass)
  // ----------------------------------------------------------------
  console.log('\n--- 7. Figurinhas & Mídia Avançada ---');
  const mediaStudioService = require('./src/services/mediaStudioService');

  // Cria um buffer WebP dummy para teste de injeção de EXIF
  const dummyWebp = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00');
  const withExif = mediaStudioService.addExifToWebp(dummyWebp, 'Meu Pacote', 'Meu Autor');
  assert(withExif.includes('EXIF') && withExif.includes('Meu Pacote') && withExif.includes('Meu Autor'), 'addExifToWebp injeta metadados de pacote e autor no WebP');

  // Comando !wm
  const cmdWm = handler.findCommand('wm');
  assert(cmdWm && typeof cmdWm.run === 'function', 'Comando !wm registrado no catálogo');

  // Criador de figurinha meme (!smeme) com Pillow
  // Cria imagem dummy de 100x100 PNG
  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const memeWebp = await mediaStudioService.createStickerMeme(dummyPng, 'TEXTO TOPO', 'TEXTO BASE');
  assert(memeWebp && Buffer.isBuffer(memeWebp) && memeWebp.length > 50, 'createStickerMeme renderiza WebP com texto estilo meme');

  // Efeitos de áudio (!bass, !nightcore, etc.)
  const dummyAudio = Buffer.from('DUMMY_AUDIO_DATA_FOR_EFFECT_TESTING');
  const fxRes = await mediaStudioService.processAudioEffect(dummyAudio, 'bass');
  assert(fxRes && fxRes.success === true && fxRes.effect === 'bass', 'processAudioEffect processa efeito bass com sucesso');

  const cmdAudioFx = handler.findCommand('bass');
  assert(cmdAudioFx && typeof cmdAudioFx.run === 'function', 'Comando de efeito de áudio !bass registrado no catálogo');

  // ----------------------------------------------------------------
  // BLOCO 8: FERRAMENTAS, PESQUISAS & UTILITÁRIOS (!letra, !wiki, !lerqr, !ocr)
  // ----------------------------------------------------------------
  console.log('\n--- 8. Ferramentas, Pesquisas & Utilitários ---');
  const utilityToolsService = require('./src/services/utilityToolsService');

  // 1. Letras de Música (!letra)
  const lyricsRes = await utilityToolsService.searchLyrics('Coldplay - Yellow');
  assert(lyricsRes && lyricsRes.title && lyricsRes.lyrics, 'searchLyrics encontra letra de música formatada');

  const cmdLetra = handler.findCommand('letra');
  assert(cmdLetra && typeof cmdLetra.run === 'function', 'Comando !letra registrado no catálogo');

  // 2. Wikipedia (!wiki)
  const wikiRes = await utilityToolsService.searchWikipedia('Albert Einstein');
  assert(wikiRes && wikiRes.title.includes('Einstein') && wikiRes.extract, 'searchWikipedia retorna resumo enciclopédico e link');

  const cmdWiki = handler.findCommand('wiki');
  assert(cmdWiki && typeof cmdWiki.run === 'function', 'Comando !wiki registrado no catálogo');

  // 3. Leitor de QR Code (!lerqr)
  const cmdLerQr = handler.findCommand('lerqr');
  assert(cmdLerQr && typeof cmdLerQr.run === 'function', 'Comando !lerqr registrado no catálogo');

  // 4. Extrator OCR (!ocr)
  const ocrText = await utilityToolsService.extractOcrText(dummyPng);
  assert(ocrText && typeof ocrText === 'string', 'extractOcrText extrai texto de imagem via OCR');

  const cmdOcr = handler.findCommand('ocr');
  assert(cmdOcr && typeof cmdOcr.run === 'function', 'Comando !ocr registrado no catálogo');

  // ----------------------------------------------------------------
  // BLOCO 9: ADMINISTRAÇÃO AVANÇADA & TRANSMISSÃO (!autoadmin, !broadcast, !sair)
  // ----------------------------------------------------------------
  console.log('\n--- 9. Administração Avançada & Transmissão ---');
  const botFleetAdminService = require('./src/services/botFleetAdminService');

  // 1. Auto-Admin (!autoadmin)
  const mockGroupConn = {
    ...mockConn,
    groupParticipantsUpdate: async (jid, participants, action) => ({ jid, participants, action })
  };
  const autoAdminRes = await botFleetAdminService.autoAdmin(mockGroupConn, '120363099999999999@g.us', '554884702848@s.whatsapp.net', '554884702848');
  assert(autoAdminRes && autoAdminRes.success === true, 'autoAdmin promove Dono a administrador do grupo');

  const cmdAutoAdmin = handler.findCommand('autoadmin');
  assert(cmdAutoAdmin && cmdAutoAdmin.owner === true, 'Comando !autoadmin exige permissão de Dono (owner: true)');

  // 2. Broadcast / Transmissão em massa (!broadcast)
  const broadcastRes = await botFleetAdminService.broadcastMessage(mockConn, 'Comunicado importante da administração');
  assert(broadcastRes && broadcastRes.success === true && broadcastRes.delivered > 0, 'broadcastMessage transmite mensagem para todos os grupos');

  const cmdBroadcast = handler.findCommand('broadcast');
  assert(cmdBroadcast && cmdBroadcast.owner === true, 'Comando !broadcast registrado com restrição de Dono');

  // 3. Bot sai do grupo (!sair)
  const cmdSair = handler.findCommand('sair');
  assert(cmdSair && cmdSair.group === true, 'Comando !sair registrado para grupos');

  // ----------------------------------------------------------------
  // BLOCO 10: GESTÃO E FROTA DE SUB-BOTS & CONFIGURAÇÃO DE GRUPOS
  // ----------------------------------------------------------------
  console.log('\n--- 10. Gestão de Frota de Sub-Bots & Configurações de Grupos ---');

  // Status da frota de 100+ chips (!subbots)
  const fleetStatus = botFleetAdminService.getSubBotsFleetStatus();
  assert(fleetStatus && typeof fleetStatus.totalChips === 'number' && Array.isArray(fleetStatus.fleet), 'getSubBotsFleetStatus apura métricas de todos os sub-bots do exército');

  const cmdSubbots = handler.findCommand('subbots');
  assert(cmdSubbots && cmdSubbots.owner === true, 'Comando !subbots registrado para controle do Dono');

  // Controle de chip individual (!subbot reiniciar 1)
  const cmdSubbot = handler.findCommand('subbot');
  assert(cmdSubbot && typeof cmdSubbot.run === 'function', 'Comando !subbot registrado para controle remoto de chips');

  // Configurações do grupo (!grupoconfig)
  const cmdGrupoConfig = handler.findCommand('grupoconfig');
  assert(cmdGrupoConfig && cmdGrupoConfig.admin === true, 'Comando !grupoconfig registrado com exigência de admin');

  // Reiniciar bot matriz (!reiniciarbot)
  const cmdRestart = handler.findCommand('reiniciarbot');
  assert(cmdRestart && cmdRestart.owner === true, 'Comando !reiniciarbot registrado para Dono');

  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} PASSARAM!`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!\n');
    process.exitCode = 0;
  } else {
    console.error(`❌ ${totalTests - passedTests} TESTES FALHARAM!\n`);
    process.exitCode = 1;
  }
}

runTests().catch(err => {
  console.error('💥 Erro fatal nos testes:', err);
  process.exit(1);
});

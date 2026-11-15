const assert = require('assert');
const audioConverter = require('./src/services/audioConverterService');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const whatsappArmyService = require('./src/services/whatsappArmyService');

async function runTests() {
  console.log('🧪 INICIANDO TESTES DO MOTOR DE ÁUDIO & TTS NATIVO DO WHATSAPP\n');

  // TESTE 1: Detecção do FFmpeg
  console.log('--- TESTE 1: Detecção do FFmpeg ---');
  const ffmpeg = audioConverter.getFFmpegPath();
  assert(ffmpeg, 'FFmpeg deve ser detectado no sistema');
  console.log('  ✅ PASS: FFmpeg localizado:', ffmpeg);

  // TESTE 2: Síntese de Voz (TTS) com retorno de OGG Opus
  console.log('\n--- TESTE 2: Síntese de Voz com OGG Opus e Metadados PTT ---');
  const ttsRes = await audioConverter.textToSpeech('Olá, este é um teste de áudio do WhatsApp.');
  assert.strictEqual(ttsRes.success, true, 'TTS deve retornar sucesso');
  assert.strictEqual(ttsRes.mimetype, 'audio/ogg; codecs=opus', 'Mimetype DEVE ser audio/ogg; codecs=opus');
  assert.strictEqual(ttsRes.ptt, true, 'Deve ser marcado como PTT (nota de voz)');
  assert(Buffer.isBuffer(ttsRes.buffer), 'Deve retornar um buffer de áudio');
  assert(ttsRes.buffer.length > 500, 'Buffer deve ter tamanho representativo de áudio');
  
  // Verifica se o container é genuinamente Ogg (mágico 'OggS')
  const header = ttsRes.buffer.slice(0, 4).toString('ascii');
  assert.strictEqual(header, 'OggS', 'O arquivo deve conter o cabeçalho oficial do container OggS');
  console.log(`  ✅ PASS: Áudio gerado com sucesso (${ttsRes.buffer.length} bytes, Header: ${header}, Mimetype: ${ttsRes.mimetype})`);

  // TESTE 3: spyFeatures.handleTTS gera payload compatível com WhatsApp Baileys
  console.log('\n--- TESTE 3: spyFeatures.handleTTS envio e formato ---');
  let sentMessage = null;
  const mockSock = {
    sendPresenceUpdate: async (status, jid) => true,
    sendMessage: async (jid, payload, opts) => {
      sentMessage = { jid, payload, opts };
      return sentMessage;
    }
  };

  const ok = await spyFeatures.handleTTS(mockSock, '554884702848@s.whatsapp.net', '!tts mulher Teste de voz feminina', 'pt');
  assert.strictEqual(ok, true, 'handleTTS deve retornar true');
  assert(sentMessage, 'Mensagem deve ter sido enviada');
  assert.strictEqual(sentMessage.payload.mimetype, 'audio/ogg; codecs=opus', 'Mimetype deve ser audio/ogg; codecs=opus para reprodução sem erro');
  assert.strictEqual(sentMessage.payload.ptt, true, 'Deve ter ptt: true');
  assert.strictEqual(sentMessage.payload.audio.slice(0, 4).toString('ascii'), 'OggS', 'Buffer deve ser Ogg Opus');
  console.log('  ✅ PASS: spyFeatures.handleTTS enviou áudio no formato nativo WhatsApp');

  // TESTE 4: spyFeatures.handleTTS com texto citado (quoted text)
  console.log('\n--- TESTE 4: spyFeatures.handleTTS com mensagem citada ---');
  sentMessage = null;
  const okQuoted = await spyFeatures.handleTTS(mockSock, '554884702848@s.whatsapp.net', '!tts', 'pt', 'Texto respondido de uma mensagem anterior');
  assert.strictEqual(okQuoted, true);
  assert(sentMessage, 'Deve enviar áudio do texto citado');
  console.log('  ✅ PASS: spyFeatures.handleTTS leu texto de citação com sucesso');

  // TESTE 5: Comando !tts no Handler Gata Nina
  console.log('\n--- TESTE 5: Comando !tts registrado no Master Handler ---');
  const ttsCmd = handler.commands.get('tts');
  assert(ttsCmd, 'Comando tts deve estar registrado no handler');
  assert(ttsCmd.command.includes('tts') && ttsCmd.command.includes('voz') && ttsCmd.command.includes('falar'), 'Deve possuir aliases tts, voz, falar');
  console.log('  ✅ PASS: Comando !tts integrado no Master Handler com aliases [tts, voz, falar, voice]');

  // TESTE 6: Envio de Voz no Exército de WhatsApp (whatsappArmyService)
  console.log('\n--- TESTE 6: whatsappArmyService envia áudio em formato Opus ---');
  let armySent = null;
  const fakeSock = {
    sendPresenceUpdate: async () => true,
    sendMessage: async (jid, payload) => {
      armySent = { jid, payload };
      return true;
    }
  };
  whatsappArmyService.activeSockets.set(999, fakeSock);
  whatsappArmyService.isSimulationMode = false;

  await whatsappArmyService.sendVoiceViaInstance(999, '5511999998888', 'Teste de voz via sub-bot');
  assert(armySent, 'Sub-bot deve enviar áudio');
  assert.strictEqual(armySent.payload.mimetype, 'audio/ogg; codecs=opus', 'Sub-bot deve enviar audio/ogg; codecs=opus');
  assert.strictEqual(armySent.payload.ptt, true, 'Sub-bot deve enviar com ptt: true');
  assert.strictEqual(armySent.payload.audio.slice(0, 4).toString('ascii'), 'OggS', 'Buffer do sub-bot deve ser Ogg');
  console.log('  ✅ PASS: whatsappArmyService envia áudios 100% compatíveis com reprodutor do WhatsApp');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS 6 TESTES DE ÁUDIO & TTS PASSARAM COM SUCESSO!');
  console.log('======================================================');
}

runTests().then(() => {
  process.exitCode = 0;
}).catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exitCode = 1;
});

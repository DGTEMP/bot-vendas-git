const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const audioConverterService = require('./src/services/audioConverterService');

async function runTests() {
  console.log('🧪 Iniciando testes do comando !play, Preview Rico do Link e Áudio MP3...\n');

  // =========================================================================
  // TESTE 1: Validação do Helper downloadYouTubeAudio em modo teste
  // =========================================================================
  console.log('--- TESTE 1: downloadYouTubeAudio em modo teste ---');
  process.env.NODE_ENV = 'test';

  const testAudio = await spyFeatures.downloadYouTubeAudio('https://www.youtube.com/watch?v=test', 'high');
  assert(testAudio && testAudio.buffer, 'Deve retornar objeto com buffer');
  assert.strictEqual(testAudio.mimetype, 'audio/mpeg', 'Mimetype deve ser audio/mpeg (padrão MP3)');
  assert.strictEqual(testAudio.ext, 'mp3', 'Extensão deve ser mp3');
  assert(testAudio.buffer.slice(0, 3).equals(Buffer.from([0x49, 0x44, 0x33])), 'Deve conter cabeçalho ID3');
  console.log('  ✅ PASS: downloadYouTubeAudio retorna buffer MP3 com mimetype audio/mpeg e cabeçalho ID3');

  // =========================================================================
  // TESTE 2: Validação de audioConverterService.convertToMp3
  // =========================================================================
  console.log('\n--- TESTE 2: audioConverterService.convertToMp3 ---');
  const convRes = await audioConverterService.convertToMp3(Buffer.from('DUMMY_RAW_AUDIO'));
  assert(convRes && convRes.success, 'Conversão deve reportar sucesso');
  assert.strictEqual(convRes.mimetype, 'audio/mpeg', 'Mimetype retornado deve ser audio/mpeg');
  assert.strictEqual(convRes.ext, 'mp3', 'Extensão deve ser mp3');
  assert(convRes.buffer.slice(0, 3).equals(Buffer.from([0x49, 0x44, 0x33])), 'Buffer convertido deve conter cabeçalho ID3');
  console.log('  ✅ PASS: audioConverterService.convertToMp3 converte para áudio MP3 válido');

  // =========================================================================
  // TESTE 3: handlePlayMusic sem argumentos (Menu de Ajuda)
  // =========================================================================
  console.log('\n--- TESTE 3: handlePlayMusic sem argumentos exibe menu de ajuda ---');
  let sentMessages = [];
  const mockSock = {
    sendMessage: async (to, payload) => {
      const msgId = 'mock_msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      sentMessages.push({ to, payload, id: msgId });
      return { key: { id: msgId, remoteJid: to } };
    }
  };

  const testJid = '5511999998888@s.whatsapp.net';
  await spyFeatures.handlePlayMusic(mockSock, testJid, '!play');
  assert.strictEqual(sentMessages.length, 1, 'Deve enviar 1 mensagem com menu de uso');
  assert(sentMessages[0].payload.text.includes('REPRODUTOR DE MÚSICAS YOUTUBE'), 'Texto deve conter título do menu');
  console.log('  ✅ PASS: handlePlayMusic exibe menu de instruções quando chamado sem termo');

  // =========================================================================
  // TESTE 4: handlePlayMusic fluxo completo (Card com Link Preview Rico + Áudio Limpo)
  // =========================================================================
  console.log('\n--- TESTE 4: Link Preview Rico com Imagem Real + Áudio MP3 Garantido ---');
  sentMessages = [];
  await spyFeatures.handlePlayMusic(mockSock, testJid, '!play Coldplay Yellow');
  assert(sentMessages.length >= 2, 'Deve enviar card informativo + mensagem de áudio');

  // Validação do Card de Preview do Link (externalAdReply)
  const cardMsg = sentMessages.find(m => m.payload && m.payload.text && m.payload.contextInfo?.externalAdReply);
  assert(cardMsg, 'Deve enviar mensagem com externalAdReply no card');
  const ad = cardMsg.payload.contextInfo.externalAdReply;
  assert.strictEqual(ad.mediaType, 1, 'mediaType deve ser 1 (IMAGE) para exibir a capa no WhatsApp');
  assert.strictEqual(ad.renderLargerThumbnail, true, 'renderLargerThumbnail deve ser true para capa grande');
  assert(Buffer.isBuffer(ad.thumbnail), 'thumbnail deve ser um Buffer JPEG real para renderizar no celular');
  assert(ad.sourceUrl && ad.sourceUrl.startsWith('http'), 'sourceUrl deve conter o link do vídeo');
  console.log('  ✅ PASS: Card enviado com Preview Rico do Link: capa JPEG (Buffer), mediaType 1 e renderLargerThumbnail');

  // Validação do Áudio Nativo (Limpo, garantindo entrega no destinatário)
  const audioMsg = sentMessages.find(m => m.payload && m.payload.audio);
  assert(audioMsg, 'Deve enviar payload com campo "audio"');
  assert.strictEqual(audioMsg.payload.mimetype, 'audio/mpeg', 'Mimetype do áudio enviado no WhatsApp deve ser audio/mpeg');
  assert(audioMsg.payload.fileName.endsWith('.mp3'), 'fileName deve terminar em .mp3');
  assert.strictEqual(audioMsg.payload.ptt, false, 'ptt deve ser false para áudio de música normal');
  console.log('  ✅ PASS: Áudio MP3 nativo enviado com mimetype audio/mpeg e livre de adReply malformado');

  // =========================================================================
  // TESTE 5: Resiliência Multi-Tier (Falha em Áudio -> Fallback Documento com Capa)
  // =========================================================================
  console.log('\n--- TESTE 5: Resiliência (Fallback para documento se envio de áudio falhar) ---');
  sentMessages = [];
  const failingAudioSock = {
    sendMessage: async (to, payload) => {
      // Rejeita qualquer envio de tipo áudio
      if (payload.audio) {
        throw new Error('Simulated WhatsApp audioMessage format error');
      }
      const msgId = 'mock_msg_' + Date.now();
      sentMessages.push({ to, payload, id: msgId });
      return { key: { id: msgId, remoteJid: to } };
    }
  };

  await spyFeatures.handlePlayMusic(failingAudioSock, testJid, '!play Linkin Park Numb');
  const docFallbackMsg = sentMessages.find(m => m.payload && m.payload.document);
  assert(docFallbackMsg, 'Deve enviar mídia como documento quando audioMessage falhar');
  assert.strictEqual(docFallbackMsg.payload.mimetype, 'audio/mpeg', 'Mimetype do documento deve ser audio/mpeg');
  assert(docFallbackMsg.payload.fileName.endsWith('.mp3'), 'fileName do documento deve ser .mp3');
  assert(Buffer.isBuffer(docFallbackMsg.payload.jpegThumbnail), 'Documento deve conter jpegThumbnail para exibição de capa');
  console.log('  ✅ PASS: Nível de fallback ativado com sucesso: arquivo MP3 entregue como documento com capa');

  // =========================================================================
  // TESTE 6: Proteção automática para arquivos > 16MB (envio direto como doc)
  // =========================================================================
  console.log('\n--- TESTE 6: Proteção de limite 16MB do WhatsApp ---');
  sentMessages = [];
  // Mock temporário de download retornando buffer de 18MB
  const originalDl = spyFeatures.downloadYouTubeAudio;
  spyFeatures.downloadYouTubeAudio = async () => ({
    buffer: Buffer.alloc(18 * 1024 * 1024, 1),
    mimetype: 'audio/mpeg',
    ext: 'mp3',
    quality: 'HIGH (HQ / MP3)'
  });

  await spyFeatures.handlePlayMusic(mockSock, testJid, '!play Large Podcast File');
  spyFeatures.downloadYouTubeAudio = originalDl;

  const largeDocMsg = sentMessages.find(m => m.payload && m.payload.document);
  assert(largeDocMsg, 'Arquivos > 16MB devem ser roteados para documento para evitar rejeição do WhatsApp');
  assert(largeDocMsg.payload.caption.includes('18.0 MB'), 'Legenda deve informar tamanho');
  console.log('  ✅ PASS: Áudio > 16MB roteado automaticamente para documento');

  // =========================================================================
  // TESTE 7: Teste Real em Produção (Download e Conversão MP3 via FFmpeg)
  // =========================================================================
  console.log('\n--- TESTE 7: Download e Conversão Real via yt-dlp + FFmpeg (Produção) ---');
  process.env.NODE_ENV = 'production';
  const realAudio = await spyFeatures.downloadYouTubeAudio('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'standard');
  assert(realAudio && realAudio.buffer, 'Downloader real deve retornar buffer');
  assert(realAudio.buffer.length > 50000, `Buffer deve ser maior que 50KB (obtido: ${realAudio.buffer.length} bytes)`);
  assert(realAudio.buffer.length < 16 * 1024 * 1024, 'Áudio deve estar dentro do limite de 16MB');
  assert.strictEqual(realAudio.mimetype, 'audio/mpeg', 'Mimetype em produção deve ser audio/mpeg');
  assert.strictEqual(realAudio.ext, 'mp3', 'Extensão em produção deve ser mp3');

  // Verifica magic bytes de MP3 real: ou 'ID3' (0x49 0x44 0x33) ou syncword MPEG (0xFF 0xFB ou 0xFF 0xF3)
  const isId3 = realAudio.buffer.slice(0, 3).equals(Buffer.from([0x49, 0x44, 0x33]));
  const isMpegSync = realAudio.buffer[0] === 0xFF && (realAudio.buffer[1] & 0xE0) === 0xE0;
  assert(isId3 || isMpegSync, `Buffer deve ser arquivo MP3 legítimo (ID3 ou MPEG syncword). Magic bytes: ${realAudio.buffer.slice(0, 4).toString('hex')}`);
  console.log(`  ✅ PASS: Download real concluiu com sucesso: ${realAudio.buffer.length} bytes de MP3 genuíno gerados via FFmpeg!`);

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DO !PLAY, PREVIEW E ÁUDIO PASSARAM!');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de !play:', err);
  process.exit(1);
});

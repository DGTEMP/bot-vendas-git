const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');

async function runTests() {
  console.log('🧪 Iniciando testes para comando !playdoc (Música em Documento com Capa HQ)...');
  process.env.NODE_ENV = 'test';

  let sentMessages = [];
  const mockSock = {
    sendMessage: async (to, content) => {
      sentMessages.push({ to, content });
      return { key: { id: 'mock_msg_' + Date.now() } };
    }
  };

  // Teste 1: !playdoc sem argumento deve exibir guia de uso e exemplos
  sentMessages = [];
  await spyFeatures.handlePlayDoc(mockSock, '5511999999999@s.whatsapp.net', '!playdoc');
  assert.strictEqual(sentMessages.length, 1, 'Deve enviar 1 mensagem de instrução');
  assert(sentMessages[0].content.text.includes('PLAYDOC'), 'Mensagem deve conter PLAYDOC');
  assert(sentMessages[0].content.text.includes('Coldplay Yellow'), 'Mensagem deve conter exemplos de uso');
  console.log('  ✅ Teste 1: !playdoc sem argumento exibe menu/instruções corretamente');

  // Teste 2: !playdoc com termo de busca (modo teste com mock de download)
  sentMessages = [];
  await spyFeatures.handlePlayDoc(mockSock, '5511999999999@s.whatsapp.net', '!playdoc Imagine Dragons Radioactive');
  assert(sentMessages.length >= 2, 'Deve enviar card informativo de início + documento final');

  const docMessage = sentMessages.find(m => m.content && m.content.document);
  assert(docMessage, 'Deve enviar uma mensagem com campo "document"');
  assert.strictEqual(docMessage.content.mimetype, 'audio/mpeg', 'Mimetype deve ser audio/mpeg');
  assert(docMessage.content.fileName.endsWith('.mp3'), 'Nome do arquivo deve terminar em .mp3');
  assert(docMessage.content.caption.includes('Qualidade:'), 'Legenda deve conter informações de qualidade');
  assert(docMessage.content.caption.includes('High'), 'Legenda deve especificar qualidade High');
  assert(Buffer.isBuffer(docMessage.content.jpegThumbnail), 'jpegThumbnail deve ser um Buffer com a capa da música');
  console.log('  ✅ Teste 2: !playdoc envia arquivo MP3 como documento com fileName, capa jpegThumbnail e qualidade High');

  // Teste 3: Aliases (/playdoc, !musicadoc, !audiodoc, !mp3doc)
  const queryResult1 = spyFeatures.parseDownloadQuery('!musicadoc Coldplay Fix You', 'high');
  assert.strictEqual(queryResult1.cleanQuery, 'Coldplay Fix You', 'cleanQuery deve ser Coldplay Fix You');
  assert.strictEqual(queryResult1.quality, 'high', 'qualidade padrão deve ser high');

  const queryResult2 = spyFeatures.parseDownloadQuery('/playdoc Queen Bohemian Rhapsody', 'high');
  assert.strictEqual(queryResult2.cleanQuery, 'Queen Bohemian Rhapsody', 'cleanQuery deve ser Queen Bohemian Rhapsody');

  const queryResult3 = spyFeatures.parseDownloadQuery('!audiodoc Alok Hear Me Now', 'high');
  assert.strictEqual(queryResult3.cleanQuery, 'Alok Hear Me Now', 'cleanQuery deve ser Alok Hear Me Now');
  console.log('  ✅ Teste 3: Aliases !musicadoc, /playdoc e !audiodoc parseados com sucesso');

  // Teste 4: Integração com lista de busca (!lista e seleção por número)
  sentMessages = [];
  const fakeFrom = '5511888888888@s.whatsapp.net';
  spyFeatures.userSearchResults.set(fakeFrom, [
    {
      title: 'Queen - Bohemian Rhapsody (Official Video)',
      url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
      timestamp: '5:55',
      thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',
      author: { name: 'Queen Official' }
    }
  ]);

  await spyFeatures.handlePlayDoc(mockSock, fakeFrom, '!playdoc 1');
  const listDocMsg = sentMessages.find(m => m.content && m.content.document);
  assert(listDocMsg, 'Deve localizar item 1 no cache do !lista e enviar documento');
  assert(listDocMsg.content.fileName.includes('Queen - Bohemian Rhapsody'), 'Nome do arquivo deve corresponder ao vídeo selecionado');
  console.log('  ✅ Teste 4: !playdoc <número> funciona a partir do histórico de busca do !lista');

  // Teste 5: Link direto do YouTube
  sentMessages = [];
  await spyFeatures.handlePlayDoc(mockSock, fakeFrom, '!playdoc https://www.youtube.com/watch?v=yKNxeF4KMsY');
  const directDocMsg = sentMessages.find(m => m.content && m.content.document);
  assert(directDocMsg, 'Deve processar URL direta do YouTube e enviar documento');
  console.log('  ✅ Teste 5: !playdoc com link direto do YouTube processado com sucesso');

  // Teste 6: Validação do helper de download em ambiente de produção
  process.env.NODE_ENV = 'production';
  const realDocHelper = await spyFeatures.downloadYouTubeAudioDoc('https://www.youtube.com/watch?v=yKNxeF4KMsY', {
    title: 'Coldplay - Yellow',
    artist: 'Coldplay',
    thumbnail: 'https://i.ytimg.com/vi/yKNxeF4KMsY/hqdefault.jpg'
  });

  assert(realDocHelper, 'Downloader em produção deve retornar dados');
  assert(realDocHelper.buffer && realDocHelper.buffer.length > 100000, 'Buffer de áudio deve ser maior que 100KB');
  assert(realDocHelper.thumbBuffer && realDocHelper.thumbBuffer.length > 1000, 'Capa da música deve ter buffer válido');
  console.log(`  ✅ Teste 6: Downloader real (Python yt-dlp + mutagen) baixou ${realDocHelper.buffer.length} bytes com capa embutida (${realDocHelper.thumbBuffer.length} bytes)`);

  console.log('\n🎉 TODOS OS 6 TESTES DE !PLAYDOC PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

/**
 * Testes Automatizados para Downloads Diretos no Painel Web (Sem WhatsApp)
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');
const express = require('express');

async function runTests() {
  console.log('🧪 Iniciando testes de Download Direto na Web (Sem WhatsApp)...\n');

  // 1. Testa o serviço spyFeaturesService diretamente
  console.log('--- Teste 1: Métodos do spyFeaturesService ---');
  const spyFeatures = require('./src/services/spyFeaturesService');

  assert.strictEqual(typeof spyFeatures.handleDownloadVideo, 'function', 'handleDownloadVideo deve existir como alias');
  assert.strictEqual(typeof spyFeatures.extractDirectMedia, 'function', 'extractDirectMedia deve existir');

  const audioDirect = await spyFeatures.extractDirectMedia({ query: 'Coldplay Yellow', type: 'audio', quality: 'H' });
  assert.ok(audioDirect.buffer, 'Buffer de áudio deve existir');
  assert.strictEqual(audioDirect.mimetype, 'audio/mpeg');
  assert.ok(audioDirect.filename.endsWith('.mp3'), 'Extensão deve ser .mp3');
  assert.strictEqual(audioDirect.title, 'Coldplay Yellow');
  console.log('✅ extractDirectMedia áudio validado com sucesso.');

  const videoDirect = await spyFeatures.extractDirectMedia({ query: 'Queen Bohemian Rhapsody', type: 'video', quality: 'H' });
  assert.ok(videoDirect.buffer, 'Buffer de vídeo deve existir');
  assert.strictEqual(videoDirect.mimetype, 'video/mp4');
  assert.ok(videoDirect.filename.endsWith('.mp4'), 'Extensão deve ser .mp4');
  console.log('✅ extractDirectMedia vídeo validado com sucesso.');

  // 2. Inicializa o servidor Express para testar rotas HTTP
  console.log('\n--- Teste 2: Inicialização de Servidor HTTP ---');
  const { createServer } = require('./src/server/app');
  const app = createServer();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`✅ Servidor de teste escutando na porta ${port}`);

  try {
    // 3. POST /api/media/direct-download (Áudio)
    console.log('\n--- Teste 3: POST /api/media/direct-download (Áudio) ---');
    const resAudio = await fetch(`${baseUrl}/api/media/direct-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Imagine Dragons Believer', type: 'audio', quality: 'H' })
    });
    assert.strictEqual(resAudio.status, 200);
    const dataAudio = await resAudio.json();
    assert.strictEqual(dataAudio.success, true);
    assert.ok(dataAudio.fileKey, 'fileKey deve existir');
    assert.ok(dataAudio.downloadUrl, 'downloadUrl deve existir');
    assert.ok(dataAudio.streamUrl, 'streamUrl deve existir');
    assert.ok(dataAudio.filename.endsWith('.mp3'), 'filename deve terminar em .mp3');
    console.log(`✅ POST /api/media/direct-download (Áudio) gerou fileKey: ${dataAudio.fileKey}`);

    // 4. GET /api/media/direct-download/file/:fileKey (Download Attachment)
    console.log('\n--- Teste 4: GET /api/media/direct-download/file/:fileKey (Attachment) ---');
    const resFileAtt = await fetch(`${baseUrl}${dataAudio.downloadUrl}`);
    assert.strictEqual(resFileAtt.status, 200);
    assert.strictEqual(resFileAtt.headers.get('content-type'), 'audio/mpeg');
    const dispAtt = resFileAtt.headers.get('content-disposition');
    assert.ok(dispAtt && dispAtt.includes('attachment'), 'Deve ter header Content-Disposition: attachment');
    const bufAtt = Buffer.from(await resFileAtt.arrayBuffer());
    assert.ok(bufAtt.length > 1000, 'Arquivo deve ter conteúdo');
    console.log(`✅ GET download attachment serviu ${bufAtt.length} bytes.`);

    // 5. GET /api/media/direct-download/file/:fileKey?inline=true (Stream Inline para player)
    console.log('\n--- Teste 5: GET /api/media/direct-download/file/:fileKey?inline=true (Player) ---');
    const resFileInline = await fetch(`${baseUrl}${dataAudio.streamUrl}`);
    assert.strictEqual(resFileInline.status, 200);
    const dispInline = resFileInline.headers.get('content-disposition');
    assert.ok(dispInline && dispInline.includes('inline'), 'Deve ter header Content-Disposition: inline');
    console.log('✅ GET streaming inline para player HTML5 validado.');

    // 6. GET 404 para arquivo inexistente
    console.log('\n--- Teste 6: GET arquivo inexistente (404) ---');
    const res404 = await fetch(`${baseUrl}/api/media/direct-download/file/chave_inexistente_123`);
    assert.strictEqual(res404.status, 404);
    console.log('✅ Chave inexistente retornou 404 como esperado.');

    // 7. POST /api/media/direct-download (Vídeo)
    console.log('\n--- Teste 7: POST /api/media/direct-download (Vídeo) ---');
    const resVideo = await fetch(`${baseUrl}/api/media/direct-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Cortes Podcast Inteligência', type: 'video', quality: 'H' })
    });
    assert.strictEqual(resVideo.status, 200);
    const dataVideo = await resVideo.json();
    assert.strictEqual(dataVideo.success, true);
    assert.ok(dataVideo.filename.endsWith('.mp4'), 'filename deve terminar em .mp4');
    assert.strictEqual(dataVideo.mimetype, 'video/mp4');
    console.log(`✅ POST /api/media/direct-download (Vídeo) gerou: ${dataVideo.filename}`);

    // 8. POST /api/botdeck/execute com DOWNLOAD_AUDIO e webDirect: true (Sem WhatsApp)
    console.log('\n--- Teste 8: POST /api/botdeck/execute (DOWNLOAD_AUDIO webDirect) ---');
    const resDeckAud = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DOWNLOAD_AUDIO',
        payload: { query: 'Guns N Roses Sweet Child', quality: 'H', webDirect: true }
      })
    });
    assert.strictEqual(resDeckAud.status, 200);
    const dataDeckAud = await resDeckAud.json();
    assert.strictEqual(dataDeckAud.success, true);
    assert.ok(dataDeckAud.data && dataDeckAud.data.webDirect, 'data.webDirect deve ser true');
    assert.ok(dataDeckAud.data.downloadUrl, 'downloadUrl deve estar presente no Bot Deck');
    console.log('✅ botdeck/execute DOWNLOAD_AUDIO com webDirect validado.');

    // 9. POST /api/botdeck/execute com DOWNLOAD_AUDIO sem target (fallback automático para webDirect)
    console.log('\n--- Teste 9: POST /api/botdeck/execute (DOWNLOAD_AUDIO sem target -> webDirect) ---');
    const resDeckAudNoTarget = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DOWNLOAD_AUDIO',
        payload: { query: 'Eminem Lose Yourself', quality: 'S' }
      })
    });
    assert.strictEqual(resDeckAudNoTarget.status, 200);
    const dataDeckAudNoTarget = await resDeckAudNoTarget.json();
    assert.strictEqual(dataDeckAudNoTarget.success, true);
    assert.ok(dataDeckAudNoTarget.data && dataDeckAudNoTarget.data.webDirect, 'Sem target deve assumir webDirect');
    console.log('✅ botdeck/execute sem destinatário assumiu download web direto automaticamente.');

    // 10. POST /api/botdeck/execute com DOWNLOAD_VIDEO e webDirect: true (Sem WhatsApp)
    console.log('\n--- Teste 10: POST /api/botdeck/execute (DOWNLOAD_VIDEO webDirect) ---');
    const resDeckVid = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DOWNLOAD_VIDEO',
        payload: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quality: 'H', webDirect: true }
      })
    });
    assert.strictEqual(resDeckVid.status, 200);
    const dataDeckVid = await resDeckVid.json();
    assert.strictEqual(dataDeckVid.success, true);
    assert.ok(dataDeckVid.data && dataDeckVid.data.webDirect, 'data.webDirect deve ser true');
    assert.ok(dataDeckVid.data.downloadUrl, 'downloadUrl deve existir');
    console.log('✅ botdeck/execute DOWNLOAD_VIDEO com webDirect validado.');

    // 11. GET /api/media/direct-download/stream
    console.log('\n--- Teste 11: GET /api/media/direct-download/stream ---');
    const resStream = await fetch(`${baseUrl}/api/media/direct-download/stream?query=Coldplay+Paradise&type=audio&quality=H`);
    assert.strictEqual(resStream.status, 200);
    assert.strictEqual(resStream.headers.get('content-type'), 'audio/mpeg');
    const streamBuf = Buffer.from(await resStream.arrayBuffer());
    assert.ok(streamBuf.length > 1000, 'Stream direto deve conter dados');
    console.log(`✅ GET /api/media/direct-download/stream serviu ${streamBuf.length} bytes.`);

    // 12. Validação de erro: query vazio
    console.log('\n--- Teste 12: Validação de Erros ---');
    const resEmpty = await fetch(`${baseUrl}/api/media/direct-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', type: 'audio' })
    });
    assert.strictEqual(resEmpty.status, 400);
    console.log('✅ Query vazia rejeitada com 400.');

    console.log('\n🎉 TODOS OS 12 TESTES DE DOWNLOAD DIRETO NA WEB PASSARAM COM SUCESSO!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Falha nos testes de download direto:', err);
  process.exit(1);
});

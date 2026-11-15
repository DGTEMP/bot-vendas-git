/**
 * Testes Automatizados para:
 * 1. !download (qualquer link) com detalhes e arquivo(s)
 * 2. !download @PapaiSpy 4 (feed do Instagram com limite de publicações e detalhes de cada arquivo)
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Iniciando testes de !download Universal e Feed de Perfil...\n');

  const instagramScraperService = require('./src/services/instagramScraperService');
  const spyFeatures = require('./src/services/spyFeaturesService');

  // 1. instagramScraperService.getFeedPosts
  console.log('--- Teste 1: getFeedPosts no instagramScraperService ---');
  const feedResult = await instagramScraperService.getFeedPosts('PapaiSpy', 4);
  assert.strictEqual(feedResult.success, true);
  assert.strictEqual(feedResult.username, 'PapaiSpy');
  assert.strictEqual(feedResult.posts.length, 4);

  const firstPost = feedResult.posts[0];
  assert.ok(firstPost.caption, 'Post deve ter legenda');
  assert.ok(firstPost.date, 'Post deve ter data');
  assert.ok(firstPost.url, 'Post deve ter URL');
  assert.ok(Array.isArray(firstPost.media), 'Post deve ter array de mídias');
  assert.ok(firstPost.media.length >= 1, 'Post deve conter ao menos 1 mídia');
  assert.ok(firstPost.media[0].buffer, 'Mídia deve conter buffer de imagem/vídeo');
  console.log(`✅ getFeedPosts retornou ${feedResult.posts.length} publicações com fotos/vídeos e detalhes.`);

  // 2. spyFeatures.extractUniversalDownload para diversas redes
  console.log('\n--- Teste 2: extractUniversalDownload para Links Diversos ---');
  
  // Instagram
  const igRes = await spyFeatures.extractUniversalDownload('https://www.instagram.com/p/DB12345/');
  assert.strictEqual(igRes.success, true);
  assert.strictEqual(igRes.platform, 'Instagram');
  assert.ok(igRes.files.length >= 2, 'Carrossel do Instagram deve conter múltiplos arquivos');
  console.log(`✅ Instagram extraído: ${igRes.files.length} arquivos (carrossel) com metadados.`);

  // TikTok
  const ttRes = await spyFeatures.extractUniversalDownload('https://www.tiktok.com/@creator/video/123456');
  assert.strictEqual(ttRes.platform, 'TikTok');
  assert.strictEqual(ttRes.files[0].type, 'video');
  console.log('✅ TikTok extraído: vídeo e dados.');

  // YouTube
  const ytRes = await spyFeatures.extractUniversalDownload('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(ytRes.platform, 'YouTube');
  assert.strictEqual(ytRes.files[0].type, 'video');
  console.log('✅ YouTube extraído: vídeo e dados.');

  // Twitter
  const twRes = await spyFeatures.extractUniversalDownload('https://x.com/user/status/123456');
  assert.strictEqual(twRes.platform, 'Twitter / X');
  console.log('✅ Twitter/X extraído com sucesso.');

  // Link Direto
  const directRes = await spyFeatures.extractUniversalDownload('https://example.com/relatorio.bin');
  assert.strictEqual(directRes.platform, 'Web / Link Direto');
  console.log('✅ Link direto extraído com sucesso.');

  // 3. handleUniversalDownload com menu de ajuda
  console.log('\n--- Teste 3: handleUniversalDownload sem argumentos (Ajuda) ---');
  const mockSock = {
    sentMessages: [],
    sendMessage: async function(to, content) {
      this.sentMessages.push({ to, content });
      return { key: { id: `mock_${Date.now()}` } };
    }
  };

  await spyFeatures.handleUniversalDownload(mockSock, '5511999998888@s.whatsapp.net', '!download');
  assert.ok(mockSock.sentMessages.length > 0);
  assert.ok(mockSock.sentMessages[0].content.text.includes('DOWNLOADER UNIVERSAL'));
  console.log('✅ Ajuda e instruções do !download exibidas corretamente.');

  // 4. handleUniversalDownload com @PapaiSpy 4 (Feed do Perfil)
  console.log('\n--- Teste 4: handleUniversalDownload @PapaiSpy 4 (Feed) ---');
  mockSock.sentMessages = [];
  await spyFeatures.handleUniversalDownload(mockSock, '5511999998888@s.whatsapp.net', '!download @PapaiSpy 4');

  // Deve ter enviado:
  // 1. Mensagem de status inicial
  // 2. Posts com imagens/vídeos e detalhes
  // 3. Mensagem final de conclusão
  assert.ok(mockSock.sentMessages.length >= 5, 'Deve ter enviado status, posts e resumo');
  const hasStatus = mockSock.sentMessages.some(m => m.content.text && m.content.text.includes('Buscando as 4 últimas publicações'));
  assert.ok(hasStatus, 'Deve conter mensagem de status inicial');

  const hasPostDetails = mockSock.sentMessages.some(m => {
    const textOrCap = m.content.text || m.content.caption || '';
    return textOrCap.includes('PUBLICAÇÃO #') && textOrCap.includes('@PapaiSpy');
  });
  assert.ok(hasPostDetails, 'Deve conter detalhes da publicação e legenda');

  const hasMediaFiles = mockSock.sentMessages.some(m => m.content.image || m.content.video);
  assert.ok(hasMediaFiles, 'Deve ter enviado as imagens/vídeos');

  const hasCompletion = mockSock.sentMessages.some(m => m.content.text && m.content.text.includes('DOWNLOAD DO FEED CONCLUÍDO'));
  assert.ok(hasCompletion, 'Deve conter mensagem final de conclusão');
  console.log(`✅ !download @PapaiSpy 4 executado: ${mockSock.sentMessages.length} mensagens/mídias entregues no WhatsApp.`);

  // 5. handleUniversalDownload com Link Único
  console.log('\n--- Teste 5: handleUniversalDownload com Link Único ---');
  mockSock.sentMessages = [];
  await spyFeatures.handleUniversalDownload(mockSock, '5511999998888@s.whatsapp.net', '!download https://www.instagram.com/p/DB12345/');

  assert.ok(mockSock.sentMessages.length >= 3, 'Deve ter enviado status, arquivos do carrossel e conclusão');
  const hasLinkDetails = mockSock.sentMessages.some(m => (m.content.caption || m.content.text || '').includes('DETALHES DO DOWNLOAD'));
  assert.ok(hasLinkDetails, 'Deve conter cabeçalho com detalhes do download');
  console.log('✅ !download com link único executado com sucesso.');

  // 6. Testes HTTP via Express Server
  console.log('\n--- Teste 6: Endpoints HTTP de API ---');
  const { createServer } = require('./src/server/app');
  const app = createServer();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 6.1 POST /api/media/direct-download com @PapaiSpy 4
    console.log('--- Teste 6.1: POST /api/media/direct-download (Feed @PapaiSpy 4) ---');
    const resFeedHttp = await fetch(`${baseUrl}/api/media/direct-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '@PapaiSpy 4' })
    });
    assert.strictEqual(resFeedHttp.status, 200);
    const dataFeed = await resFeedHttp.json();
    assert.strictEqual(dataFeed.success, true);
    assert.strictEqual(dataFeed.isFeed, true);
    assert.strictEqual(dataFeed.username, 'PapaiSpy');
    assert.strictEqual(dataFeed.posts.length, 4);
    assert.ok(dataFeed.posts[0].media[0].downloadUrl, 'Cada mídia deve ter downloadUrl no cache');
    console.log(`✅ API /api/media/direct-download retornou feed com ${dataFeed.posts.length} posts e links de download.`);

    // 6.2 POST /api/media/direct-download com link do Instagram
    console.log('--- Teste 6.2: POST /api/media/direct-download (Link Universal) ---');
    const resLinkHttp = await fetch(`${baseUrl}/api/media/direct-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'https://www.instagram.com/p/DB12345/' })
    });
    assert.strictEqual(resLinkHttp.status, 200);
    const dataLink = await resLinkHttp.json();
    assert.strictEqual(dataLink.success, true);
    assert.strictEqual(dataLink.isUniversal, true);
    assert.strictEqual(dataLink.platform, 'Instagram');
    assert.ok(dataLink.files.length >= 2, 'Carrossel deve conter arquivos');
    assert.ok(dataLink.files[0].downloadUrl, 'Arquivo deve ter URL de download');
    console.log(`✅ API /api/media/direct-download processou link universal: ${dataLink.files.length} arquivos prontos.`);

    // 6.3 POST /api/bots/execute-command com command: 'download'
    console.log('--- Teste 6.3: POST /api/bots/execute-command (download) ---');
    const resCmd = await fetch(`${baseUrl}/api/bots/execute-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'download',
        botType: 'whatsapp_master',
        targetId: '5511999998888@s.whatsapp.net',
        text: '@PapaiSpy 4'
      })
    });
    assert.strictEqual(resCmd.status, 200);
    const dataCmd = await resCmd.json();
    assert.strictEqual(dataCmd.success, true);
    assert.ok(dataCmd.message.includes('Comando de download iniciado'));
    console.log('✅ POST /api/bots/execute-command com comando download validado.');

    console.log('\n🎉 TODOS OS TESTES DE !download UNIVERSAL E FEED PASSARAM COM SUCESSO!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Erro nos testes:', err);
  process.exit(1);
});

/**
 * Suíte de Testes: Miniaturas de Links e Cards Ricos no WhatsApp
 * Valida o motor linkPreviewService, integração em Baileys, e auto-enriquecimento de mensagens.
 */

const assert = require('assert');
const linkPreviewService = require('./src/services/linkPreviewService');
const whatsappMessageStore = require('./src/services/whatsappMessageStoreService');
const whatsappBot = require('./src/bots/whatsappBot');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const models = require('./src/db/models');

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: MINIATURAS E CARDS RICOS DE LINKS NO WHATSAPP');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- Teste 1: Extração de Links válidos do texto ---');
  // --------------------------------------------------------------------------
  const t1Text = 'Confira esta super promoção: https://s.shopee.com.br/2VtAPW0qxI! Não perca.';
  const extractedUrl = linkPreviewService.extractFirstUrl(t1Text);
  assert.strictEqual(extractedUrl, 'https://s.shopee.com.br/2VtAPW0qxI', 'Deve extrair a URL limpa sem pontuações finais');
  console.log('  ✅ [PASS] 1. URL extraída com sucesso:', extractedUrl);

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: Geração de Metadados e Thumbnail JPEG via Sharp ---');
  // --------------------------------------------------------------------------
  // Testa com uma URL real ou fallback
  const preview = await linkPreviewService.fetchPreview('https://s.shopee.com.br/2VtAPW0qxI', { timeoutMs: 5000 });
  assert(preview, 'Preview deve ser gerado');
  assert(preview.title && preview.title.length > 0, 'Preview deve ter título');
  assert(preview.imageUrl && preview.imageUrl.startsWith('http'), 'Preview deve conter URL de imagem');
  assert(Buffer.isBuffer(preview.jpegThumbnail), 'Thumbnail deve ser um Buffer JPEG binário válido');
  assert(preview.jpegThumbnail.length > 500, 'Thumbnail JPEG deve ter tamanho suficiente para renderizar');
  console.log(`  ✅ [PASS] 2. Preview gerado com sucesso: Título="${preview.title.slice(0, 40)}...", Thumb=${preview.jpegThumbnail.length} bytes`);

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: Enriquecimento de Conteúdo (linkPreview + externalAdReply) ---');
  // --------------------------------------------------------------------------
  const rawMsg = { text: 'Olha que legal este link: https://s.shopee.com.br/2VtAPW0qxI aproveitem!' };
  const enriched = await linkPreviewService.enrichMessageContent(rawMsg);

  assert(enriched.linkPreview, 'Deve conter linkPreview nativo Baileys');
  assert.strictEqual(enriched.linkPreview['matched-text'], 'https://s.shopee.com.br/2VtAPW0qxI');
  assert(Buffer.isBuffer(enriched.linkPreview.jpegThumbnail), 'linkPreview deve conter jpegThumbnail');

  assert(enriched.contextInfo && enriched.contextInfo.externalAdReply, 'Deve conter contextInfo.externalAdReply');
  const ad = enriched.contextInfo.externalAdReply;
  assert.strictEqual(ad.mediaType, 1, 'mediaType deve ser 1 (IMAGE)');
  assert(Buffer.isBuffer(ad.thumbnail), 'ad.thumbnail deve ser Buffer JPEG para o WhatsApp');
  assert.strictEqual(ad.renderLargerThumbnail, true, 'renderLargerThumbnail deve ser true para card visual grande');
  assert.strictEqual(ad.sourceUrl, 'https://s.shopee.com.br/2VtAPW0qxI');
  console.log('  ✅ [PASS] 3. Payload enriquecido perfeitamente com linkPreview e externalAdReply');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Interceptação Automática via wrapSocketWithRetryTracking ---');
  // --------------------------------------------------------------------------
  let dispatchedPayload = null;
  const mockSocket = {
    instanceId: 9999,
    user: { id: '5511999990000:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      dispatchedPayload = { jid, content, options };
      return { key: { id: 'TEST_MSG_' + Date.now(), remoteJid: jid } };
    }
  };

  // Envolve o socket com o rastreador
  whatsappMessageStore.wrapSocketWithRetryTracking(mockSocket);

  // Envia apenas texto puro com link (como um sub-bot ou comando faria normalmente)
  await mockSocket.sendMessage('120363000000000000@g.us', {
    text: 'Promoção exclusiva de Natal: https://s.shopee.com.br/2VtAPW0qxI'
  });

  assert(dispatchedPayload, 'Mensagem deve ter sido enviada');
  assert(dispatchedPayload.content.linkPreview, 'Socket interceptado deve ter gerado linkPreview');
  assert(dispatchedPayload.content.contextInfo?.externalAdReply?.thumbnail, 'Socket interceptado deve ter injetado thumbnail no externalAdReply');
  console.log('  ✅ [PASS] 4. Socket interceptou e gerou miniatura e card automaticamente!');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 5: Suporte a Mercado Livre e links encurtados meli.la ---');
  // --------------------------------------------------------------------------
  const mlPreview = await linkPreviewService.fetchPreview('https://meli.la/1oDDtKX', { timeoutMs: 5000 });
  assert(mlPreview, 'Deve gerar preview para link meli.la');
  assert(Buffer.isBuffer(mlPreview.jpegThumbnail), 'Deve conter buffer JPEG da imagem do Mercado Livre');
  console.log(`  ✅ [PASS] 5. Mercado Livre suportado: Título="${mlPreview.title}", Thumb=${mlPreview.jpegThumbnail.length} bytes`);

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 6: Fallback de Plataforma para links sem og:image ---');
  // --------------------------------------------------------------------------
  const fallbackPreview = await linkPreviewService.fetchPreview('https://shopee.com.br/pagina-inexistente-404-xyz-teste', { timeoutMs: 2000 });
  assert(fallbackPreview, 'Deve retornar fallback de plataforma');
  assert(Buffer.isBuffer(fallbackPreview.jpegThumbnail), 'Fallback deve gerar thumbnail com logo da Shopee');
  console.log('  ✅ [PASS] 6. Fallback de logotipo da plataforma ativado com sucesso');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 7: Não alterar mensagens sem URL nem poluir mensagens existentes ---');
  // --------------------------------------------------------------------------
  const plainMsg = { text: 'Olá pessoal do grupo, tudo bem com vocês?' };
  const plainResult = await linkPreviewService.enrichMessageContent(plainMsg);
  assert.strictEqual(plainResult.linkPreview, undefined, 'Mensagem sem link não deve ter linkPreview');
  assert.strictEqual(plainResult.contextInfo, undefined, 'Mensagem sem link não deve ter contextInfo');
  console.log('  ✅ [PASS] 7. Mensagens sem URL permanecem 100% limpas');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 8: Auto-população de imagem em Link de Afiliado no Banco ---');
  // --------------------------------------------------------------------------
  const testAff = models.createAffiliateLink({
    title: 'Link Teste Miniatura',
    platform: 'Shopee',
    affiliate_url: 'https://s.shopee.com.br/2VtAPW0qxI',
    product_price: 49.90,
    source: 'test_miniatura'
  });
  assert(testAff && testAff.id, 'Link de teste deve ter sido criado no banco');
  assert.strictEqual(testAff.image_url, null, 'Link inicialmente criado sem imagem');

  const updatedAff = await linkPreviewService.populateAffiliateLinkImage(testAff.id);
  assert(updatedAff && updatedAff.image_url, 'Deve ter populado a image_url do link no banco');
  console.log('  ✅ [PASS] 8. Imagem do produto no banco populada:', updatedAff.image_url.slice(0, 60) + '...');

  // Limpeza
  try {
    models.deleteAffiliateLink(testAff.id);
  } catch (_) {}

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS 8 TESTES DE MINIATURA E PREVIEW DE LINKS PASSARAM 100%!');
  console.log('========================================================================');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

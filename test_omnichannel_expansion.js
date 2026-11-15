const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const socialMediaService = require('./src/services/socialMediaService');
const { createServer } = require('./src/server/app');

async function runOmnichannelTests() {
  console.log('🌐 Iniciando Bateria Completa de Testes Omni-Channel...\n');
  console.log('Plataformas avaliadas: Threads, X, Reddit, Blog, TikTok, OLX, Marketplace Facebook, Snapchat, Shopee, Mercado Livre, Shein, Instagram, Facebook.\n');

  socialMediaService.isSimulationMode = true;

  // 1. Teste de Catálogo de Plataformas Suportadas
  console.log('--- 1. Validando Catálogo de Plataformas Suportadas ---');
  const platforms = socialMediaService.getSupportedPlatforms();
  assert(Array.isArray(platforms));
  assert(platforms.length >= 13, `Deveria conter pelo menos 13 plataformas, encontrado: ${platforms.length}`);

  const requiredPlatforms = [
    'threads', 'x', 'reddit', 'blog', 'tiktok', 'olx',
    'marketplace_facebook', 'snapchat', 'shopee', 'mercadolivre', 'shein',
    'instagram', 'facebook'
  ];

  for (const plat of requiredPlatforms) {
    const found = platforms.find(p => p.id === plat);
    assert(found, `Plataforma ${plat} deve estar registrada no catálogo`);
    assert(found.name && found.category && found.icon && found.color, `Plataforma ${plat} deve possuir metadados completos`);
    console.log(`  ✓ ${found.name} (${found.category}) [${found.icon}]`);
  }
  console.log('✅ Todas as 13 plataformas registradas com sucesso!\n');

  // 2. Teste de Respostas Especializadas por Canal (Marketplace, Redes e Comunidades)
  console.log('--- 2. Validando Respostas Customizadas por Canal ---');

  // A. Mercado Livre (Pergunta no Anúncio)
  const meliReply = socialMediaService.generateCommentPublicReply('Tem à pronta entrega e nota fiscal?', 'Carlos Alberto', 'mercadolivre');
  assert(meliReply.includes('Full') || meliReply.includes('nota fiscal') || meliReply.includes('original'), 'ML deve responder sobre envio Full/NF');
  console.log('  -> Mercado Livre (Resposta Pública):', meliReply);

  // B. Shopee (Chat da Loja)
  const shopeeReply = socialMediaService.generateCommentPublicReply('Tem cupom de frete grátis?', 'mariasilva', 'shopee');
  assert(shopeeReply.includes('frete grátis') || shopeeReply.includes('Shopee') || shopeeReply.includes('loja'), 'Shopee deve citar frete grátis/loja');
  console.log('  -> Shopee (Resposta Pública):', shopeeReply);

  // C. OLX (Chat do Anúncio)
  const olxReply = socialMediaService.generateCommentPublicReply('Ainda está disponível? Faz por menos?', 'comprador_olx', 'olx');
  assert(olxReply.includes('disponível') || olxReply.includes('envio'), 'OLX deve confirmar disponibilidade');
  console.log('  -> OLX (Resposta Pública):', olxReply);

  // D. TikTok (Comentário no Vídeo)
  const tiktokReply = socialMediaService.generateCommentPublicReply('Onde acho esse produto?', '@joao_dance', 'tiktok');
  assert(tiktokReply.includes('bio') || tiktokReply.includes('vídeo') || tiktokReply.includes('direct'), 'TikTok deve referenciar bio/vídeo');
  console.log('  -> TikTok (Resposta Pública):', tiktokReply);

  // E. X / Twitter (Tweet / Menção)
  const xReply = socialMediaService.generateCommentPublicReply('Qual o link?', '@trader_x', 'x');
  assert(xReply.includes('@trader_x') && (xReply.includes('DM') || xReply.includes('link')), 'X deve mencionar @ e citar DM/link');
  console.log('  -> X (Resposta Pública):', xReply);

  // F. Reddit (Comentário em Subreddit)
  const redditReply = socialMediaService.generateCommentPublicReply('Alguém recomenda?', 'u/geek_user', 'reddit');
  assert(redditReply.includes('u/geek_user') || redditReply.includes('privado'), 'Reddit deve mencionar u/ e ser cortês');
  console.log('  -> Reddit (Resposta Pública):', redditReply);

  // G. Shein (Dúvida de Tamanho/Item)
  const sheinReply = socialMediaService.generateCommentPublicReply('Tem tamanho G?', 'Ana Paula', 'shein');
  assert(sheinReply.includes('qualidade') || sheinReply.includes('medidas'), 'Shein deve citar qualidade/medidas');
  console.log('  -> Shein (Resposta Pública):', sheinReply);

  // H. Marketplace Facebook (Disponibilidade)
  const fbMarketReply = socialMediaService.generateCommentPublicReply('Olá, este item ainda está disponível?', 'Lucas Ferreira', 'marketplace_facebook');
  assert(fbMarketReply.includes('disponível') || fbMarketReply.includes('retirada') || fbMarketReply.includes('Pix'), 'Marketplace FB deve confirmar disponibilidade');
  console.log('  -> Marketplace Facebook (Resposta Pública):', fbMarketReply);

  console.log('✅ Inteligência contextual por plataforma validada!\n');

  // 3. Teste de Criação de Contas e Disparo Direto em Cada Rede
  console.log('--- 3. Testando Contas e Interações Diretas em Todas as Redes ---');
  const createdAccounts = [];

  for (const plat of requiredPlatforms) {
    const acc = models.createSocialAccount({
      platform: plat,
      name: `Conta Teste ${plat.toUpperCase()}`,
      account_id: `acc_test_${plat}_${Date.now()}`,
      auto_reply_enabled: 1
    });
    createdAccounts.push(acc);

    // Teste de DM / Chat
    const msgRes = await socialMediaService.handleIncomingMessage({
      platform: plat,
      accountId: acc.id,
      senderId: `sender_${plat}_123`,
      senderName: `Cliente ${plat}`,
      text: 'Olá! Quero saber o valor e como comprar com desconto.'
    });
    assert.strictEqual(msgRes.handled, true, `Mensagem em ${plat} deve ser tratada`);
    assert.strictEqual(msgRes.replied, true, `Mensagem em ${plat} deve ser respondida`);

    // Teste de Comentário / Pergunta
    const commRes = await socialMediaService.handleIncomingComment({
      platform: plat,
      accountId: acc.id,
      senderId: `sender_${plat}_456`,
      senderName: `Seguidor ${plat}`,
      text: 'Qual o link oficial e garantia?',
      commentId: `item_${plat}_999`
    });
    assert.strictEqual(commRes.handled, true, `Comentário em ${plat} deve ser tratado`);
    assert(commRes.publicReplyText.length > 5, `Comentário em ${plat} deve gerar resposta pública`);
  }
  console.log(`✅ ${createdAccounts.length} contas testadas com envio e resposta em 100% de sucesso!\n`);

  // 4. Teste de Verificação CRC do X / Twitter
  console.log('--- 4. Testando CRC do X (Twitter Account Activity API) ---');
  const crcToken = 'test_crc_challenge_token_abc123';
  const responseToken = socialMediaService.verifyTwitterCrc(crcToken, 'paybot_twitter_secret_2026');
  assert(responseToken && responseToken.startsWith('sha256='), 'CRC do Twitter deve retornar hash sha256=...');
  console.log('  -> Response Token:', responseToken);
  console.log('✅ CRC do Twitter gerado com sucesso!\n');

  // 5. Testando Webhooks Universais via Servidor Express (/api/social/webhook/:platform)
  console.log('--- 5. Testando Servidor HTTP e Webhooks Dinâmicos ---');
  const expressApp = createServer();
  const server = http.createServer(expressApp);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 5.1. GET /api/social/platforms
    const resPlatforms = await fetch(`${baseUrl}/api/social/platforms`);
    assert.strictEqual(resPlatforms.status, 200);
    const platsData = await resPlatforms.json();
    assert(platsData.length >= 13);
    console.log(`  ✓ GET /api/social/platforms retornou ${platsData.length} plataformas`);

    // 5.2. GET /api/social/webhook/x (com crc_token)
    const resTwitterCrc = await fetch(`${baseUrl}/api/social/webhook/x?crc_token=test_token_123`);
    assert.strictEqual(resTwitterCrc.status, 200);
    const crcData = await resTwitterCrc.json();
    assert(crcData.response_token && crcData.response_token.startsWith('sha256='));
    console.log('  ✓ GET /api/social/webhook/x respondeu ao desafio CRC');

    // 5.3. POST /api/social/webhook/mercadolivre (Pergunta no Anúncio)
    const resMeli = await fetch(`${baseUrl}/api/social/webhook/mercadolivre`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'questions',
        question_id: 'meli_q_888999',
        item_id: 'MLB987654321',
        buyer_name: 'Roberto Vendedor',
        question: 'Tem envio imediato?'
      })
    });
    assert.strictEqual(resMeli.status, 200);
    console.log('  ✓ POST /api/social/webhook/mercadolivre processou pergunta no anúncio');

    // 5.4. POST /api/social/webhook/shopee (Chat da Loja)
    const resShopee = await fetch(`${baseUrl}/api/social/webhook/shopee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_name: 'Camila Shopee',
        message: 'Tem cupom disponível?'
      })
    });
    assert.strictEqual(resShopee.status, 200);
    console.log('  ✓ POST /api/social/webhook/shopee processou chat de comprador');

    // 5.5. POST /api/social/webhook/tiktok (Comentário em Vídeo)
    const resTikTok = await fetch(`${baseUrl}/api/social/webhook/tiktok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'video.comment',
        comment_id: 'tt_c_111',
        username: 'renata_tiktok',
        text: 'Qual o valor do produto?'
      })
    });
    assert.strictEqual(resTikTok.status, 200);
    console.log('  ✓ POST /api/social/webhook/tiktok processou comentário de vídeo');

    // 5.6. POST /api/social/webhook/olx (Chat do Anúncio)
    const resOlx = await fetch(`${baseUrl}/api/social/webhook/olx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ad_id: 'olx_ad_456',
        buyer_name: 'Fernando OLX',
        message: 'Ainda está com o produto?'
      })
    });
    assert.strictEqual(resOlx.status, 200);
    console.log('  ✓ POST /api/social/webhook/olx processou mensagem de comprador');

    // 5.7. POST /api/social/webhook/reddit (Comentário em Subreddit)
    const resReddit = await fetch(`${baseUrl}/api/social/webhook/reddit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'comment',
        author: 'u/invest_coder',
        body: 'Alguém tem cupom para esse serviço?'
      })
    });
    assert.strictEqual(resReddit.status, 200);
    console.log('  ✓ POST /api/social/webhook/reddit processou comentário de subreddit');

    // 5.8. POST /api/social/webhook/blog (Comentário no Artigo)
    const resBlog = await fetch(`${baseUrl}/api/social/webhook/blog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_author: 'Professor Marcos',
        comment_content: 'Excelente postagem, onde encontro o software?'
      })
    });
    assert.strictEqual(resBlog.status, 200);
    console.log('  ✓ POST /api/social/webhook/blog processou comentário de artigo');

    // 5.9. POST /api/social/simulate com plataforma Mercado Livre
    const simRes = await fetch(`${baseUrl}/api/social/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'mercadolivre',
        senderName: 'Cliente VIP ML',
        text: 'Quero comprar agora'
      })
    });
    assert.strictEqual(simRes.status, 200);
    const simData = await simRes.json();
    assert(simData.replyText.includes('Mercado'));
    console.log('  ✓ POST /api/social/simulate respondeu com inteligência do Mercado Livre');

  } finally {
    server.close();
  }

  // 6. Limpeza das contas de teste
  for (const acc of createdAccounts) {
    models.deleteSocialAccount(acc.id);
  }
  console.log('\n✅ Contas de teste limpas.');
  console.log('\n🎉 TODOS OS TESTES OMNI-CHANNEL PASSARAM COM 100% DE SUCESSO!\n');
}

runOmnichannelTests().catch(err => {
  console.error('\n❌ ERRO NOS TESTES OMNI-CHANNEL:', err);
  process.exit(1);
});

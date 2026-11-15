const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const socialMediaService = require('./src/services/socialMediaService');
const { createServer } = require('./src/server/app');

async function runTests() {
  console.log('🚀 Iniciando Testes de Acompanhamento e Resposta Automática de Comentários (Instagram & Facebook)...\n');

  socialMediaService.isSimulationMode = true;

  // 1. Setup de contas de teste
  const igAcc = models.createSocialAccount({
    platform: 'instagram',
    name: 'lojaxyz_oficial',
    account_id: 'ig_acc_test_comment_' + Date.now(),
    auto_reply_enabled: 1
  });

  const fbAcc = models.createSocialAccount({
    platform: 'facebook',
    name: 'Loja XYZ Página Oficial',
    account_id: 'fb_acc_test_comment_' + Date.now(),
    auto_reply_enabled: 1
  });

  console.log('✅ Contas de teste criadas:', { ig: igAcc.id, fb: fbAcc.id });

  // 2. Teste Direto: Comentário no Instagram
  console.log('\n--- 1. Testando handleIncomingComment para Instagram ---');
  const igCommentRes = await socialMediaService.handleIncomingComment({
    platform: 'instagram',
    accountId: igAcc.id,
    senderId: 'user_ig_999',
    senderName: '@clara_vendas',
    text: 'Qual o valor e o link do produto? Quero comprar agora!',
    commentId: 'comment_ig_123456',
    mediaId: 'post_ig_789'
  });

  assert.strictEqual(igCommentRes.handled, true, 'Deveria ter processado o comentário de Instagram');
  assert(igCommentRes.publicReplyText.includes('@clara_vendas'), 'Resposta pública deveria mencionar a usuária');
  assert(igCommentRes.publicReplyResult.success, 'Disparo de resposta pública deveria ser bem sucedido');
  assert(igCommentRes.privateDmText.includes('http') || igCommentRes.privateDmText.includes('VIP') || igCommentRes.privateDmText.includes('desconto'), 'DM privada deveria conter link ou detalhes da oferta');
  assert(igCommentRes.privateDmResult.success, 'Disparo de DM privada deveria ser bem sucedido');
  console.log('  -> Resposta pública no post:', igCommentRes.publicReplyText);
  console.log('  -> Direct privado enviado:', igCommentRes.privateDmText.substring(0, 90) + '...');
  console.log('✅ Comentário Instagram processado com sucesso!');

  // 3. Teste Direto: Comentário no Facebook
  console.log('\n--- 2. Testando handleIncomingComment para Facebook ---');
  const fbCommentRes = await socialMediaService.handleIncomingComment({
    platform: 'facebook',
    accountId: fbAcc.id,
    senderId: 'user_fb_888',
    senderName: 'Carlos Eduardo',
    text: 'Ainda tem vaga ou cupom de desconto?',
    commentId: 'comment_fb_654321',
    postId: 'post_fb_321'
  });

  assert.strictEqual(fbCommentRes.handled, true, 'Deveria ter processado o comentário de Facebook');
  assert(fbCommentRes.publicReplyText.includes('Carlos Eduardo'), 'Resposta pública deveria citar o usuário');
  assert(fbCommentRes.publicReplyResult.success, 'Resposta pública no Facebook bem sucedida');
  assert(fbCommentRes.privateDmResult.success, 'Disparo de Private Reply no Facebook bem sucedido');
  console.log('  -> Resposta pública no Facebook:', fbCommentRes.publicReplyText);
  console.log('✅ Comentário Facebook processado com sucesso!');

  // 4. Teste: Ingestão de Webhook da Meta para Comentários de Instagram (field: comments)
  console.log('\n--- 3. Testando Webhook Meta (Instagram comments) ---');
  const igWebhookPayload = {
    object: 'instagram',
    entry: [
      {
        id: igAcc.account_id,
        time: Date.now(),
        changes: [
          {
            field: 'comments',
            value: {
              id: 'ig_webhook_comm_555',
              text: 'Quero o link de desconto!',
              from: {
                id: 'ig_user_lead_777',
                username: 'rafael_trader'
              },
              media: {
                id: 'media_reel_999'
              }
            }
          }
        ]
      }
    ]
  };

  const igWebhookRes = await socialMediaService.processWebhookPayload(igWebhookPayload);
  assert.strictEqual(igWebhookRes.processed, 1, 'Deveria ter processado 1 evento de comentário do Instagram');
  console.log('✅ Webhook do Instagram processou o comentário automaticamente!');

  // 5. Teste: Ingestão de Webhook da Meta para Comentários de Facebook (field: feed)
  console.log('\n--- 4. Testando Webhook Meta (Facebook feed/comment) ---');
  const fbWebhookPayload = {
    object: 'page',
    entry: [
      {
        id: fbAcc.account_id,
        time: Date.now(),
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: 'fb_webhook_comm_777',
              post_id: 'fb_post_888',
              sender_id: 'fb_lead_123',
              sender_name: 'Juliana Costa',
              message: 'Vocês têm garantia? Como funciona?'
            }
          }
        ]
      }
    ]
  };

  const fbWebhookRes = await socialMediaService.processWebhookPayload(fbWebhookPayload);
  assert.strictEqual(fbWebhookRes.processed, 1, 'Deveria ter processado 1 evento de comentário do Facebook');
  console.log('✅ Webhook do Facebook processou o comentário automaticamente!');

  // 6. Teste de Proteção contra Auto-comentário (Evitar Loop)
  console.log('\n--- 5. Testando Prevenção de Auto-Comentário (Loop) ---');
  const selfCommentRes = await socialMediaService.handleIncomingComment({
    platform: 'instagram',
    accountId: igAcc.id,
    senderId: igAcc.account_id,
    senderName: igAcc.name,
    text: 'Agradecemos a todos!',
    commentId: 'comm_self_123'
  });
  assert.strictEqual(selfCommentRes.handled, false, 'Comentário da própria conta deve ser ignorado');
  assert.strictEqual(selfCommentRes.reason, 'self_comment', 'Motivo deve ser self_comment');
  console.log('✅ Auto-comentário ignorado com sucesso (evita loop infinito)!');

  // 7. Teste de Auto-Resposta Desabilitada
  console.log('\n--- 6. Testando Conta com Auto-Resposta Desabilitada ---');
  models.updateSocialAccount(igAcc.id, { auto_reply_enabled: 0 });
  const disabledAccRes = await socialMediaService.handleIncomingComment({
    platform: 'instagram',
    accountId: igAcc.id,
    senderId: 'random_user_1',
    senderName: 'Lead Qualquer',
    text: 'Oi, tenho interesse',
    commentId: 'comm_dis_1'
  });
  assert.strictEqual(disabledAccRes.handled, true);
  assert.strictEqual(disabledAccRes.replied, false);
  assert.strictEqual(disabledAccRes.reason, 'auto_reply_disabled');
  console.log('✅ Auto-resposta respeitada quando desativada!');

  // 8. Teste do Endpoint HTTP /api/social/simulate-comment
  console.log('\n--- 7. Testando Endpoint REST /api/social/simulate-comment ---');
  const expressApp = createServer();
  const server = http.createServer(expressApp);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/social/simulate-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'instagram',
        accountId: fbAcc.id, // usamos a conta do FB
        senderName: '@paulo_invest',
        text: 'Preço por favor!'
      })
    });

    const data = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.handled, true);
    assert(data.publicReplyText.includes('@paulo_invest'));
    assert(data.privateDmText.length > 10);
    console.log('✅ Endpoint /api/social/simulate-comment respondeu com sucesso:', {
      status: response.status,
      publicReply: data.publicReplyText
    });
  } finally {
    server.close();
  }

  // 9. Limpeza das contas de teste
  models.deleteSocialAccount(igAcc.id);
  models.deleteSocialAccount(fbAcc.id);
  console.log('\n✅ Contas de teste limpas.');
  console.log('\n🎉 TODOS OS TESTES DE MONITORAMENTO E RESPOSTA DE COMENTÁRIOS PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('\n❌ ERRO NOS TESTES:', err);
  process.exit(1);
});

const assert = require('assert');
const achadinhosService = require('./src/services/achadinhosService');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const models = require('./src/db/models');

async function runTests() {
  console.log('🧪 Iniciando Testes de Isolamento de Afiliados e Comando !DUVUG...\n');

  const privatePhone = '554899114807';
  const privateJid = `${privatePhone}@s.whatsapp.net`;
  const groupJid = '120363384910293847@g.us';

  const sentPrivateMessages = [];
  const fakePrivateSock = {
    sendMessage: async (to, content) => {
      sentPrivateMessages.push({ to, content });
      return { key: { id: 'mock_msg_' + Date.now() } };
    }
  };

  const sentGroupMessages = [];
  const fakeGroupSock = {
    sendMessage: async (to, content) => {
      sentGroupMessages.push({ to, content });
      return { key: { id: 'mock_msg_' + Date.now() } };
    }
  };

  // --- PARTE 1: GARANTIR QUE NENHUM LINK DE AFILIADO SEJA ENVIADO NO PRIVADO ---
  console.log('--- 1. Teste de Bloqueio Rigoroso no Chat Privado ---');

  // Teste 1.1: !duvug no privado deve ser recusado
  await achadinhosService.handleDuvugCommand({
    sock: fakePrivateSock,
    from: privateJid,
    text: '!duvug',
    isGroup: false,
    senderPhone: privatePhone,
    isOwnerUser: true
  });

  assert.strictEqual(sentPrivateMessages.length, 1, 'Deve responder aviso de bloqueio no privado');
  const privateWarning = sentPrivateMessages[0].content.text;
  console.log('  ✓ Resposta ao !duvug no privado:\n    ' + privateWarning.split('\n')[0]);
  assert.ok(privateWarning.includes('Exclusivo para Grupos') || privateWarning.includes('SOMENTE dentro de grupos'), 'Deve avisar que é exclusivo para grupos');
  assert.ok(!privateWarning.includes('shopee.com') && !privateWarning.includes('amazon.com'), 'Não pode conter links de afiliados de compras');

  // Teste 1.2: Consulta de promoção/achadinho no privado não deve disparar achadinhosService
  const isQueryHandled = await achadinhosService.handleBuyerGroupQuery({
    sock: fakePrivateSock,
    from: privateJid,
    text: 'tem promoção de alexa?',
    senderPhone: privatePhone,
    isGroup: false
  });
  assert.strictEqual(isQueryHandled, false, 'handleBuyerGroupQuery deve rejeitar chamadas em chat privado');

  // Teste 1.3: Sub-bot não deve cadastrar lead do privado em funil de afiliados externos
  const db = require('./src/db/database');
  db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(privatePhone);

  const handledLead = await whatsappArmyService.handleIncomingLeadMessage(2, privateJid, 'como funciona o produto?');
  assert.strictEqual(handledLead, false, 'Lead espontâneo no privado não deve ser interceptado por funil de afiliados externos');

  const leadConv = models.getLeadFunnelConversationByPhone(privatePhone);
  assert.ok(!leadConv, 'Nenhum funil de afiliado externo deve ser criado para lead privado');
  console.log('  ✓ Lead no privado não é cadastrado em funil de afiliados e não recebe links externos.');

  // --- PARTE 2: TESTE DO COMANDO !DUVUG NOS GRUPOS ---
  console.log('\n--- 2. Teste do Comando !DUVUG / !DIVULG em Grupos ---');

  // Teste 2.1: Postagem avulsa de oferta pronta via !duvug
  await achadinhosService.handleDuvugCommand({
    sock: fakeGroupSock,
    from: groupJid,
    text: '!duvug',
    isGroup: true,
    senderPhone: privatePhone,
    isOwnerUser: true,
    isChatAdmin: true
  });

  assert.strictEqual(sentGroupMessages.length, 1, 'Deve postar a oferta pronta no grupo');
  const groupPost = sentGroupMessages[0].content;
  const postText = groupPost.caption || groupPost.text;
  console.log('  ✓ Oferta divulgada no grupo com sucesso:');
  console.log('    • Texto inicial:', postText.split('\n')[0]);
  console.log('    • Contém imagem:', Boolean(groupPost.image));
  assert.ok(postText.includes('http') || postText.includes('shopee') || postText.includes('amazon') || postText.includes('link'), 'Postagem no grupo deve conter o link de afiliado');

  // Teste 2.2: Postagem de oferta específica via !duvug alexa
  await achadinhosService.handleDuvugCommand({
    sock: fakeGroupSock,
    from: groupJid,
    text: '!duvug alexa',
    isGroup: true,
    senderPhone: privatePhone,
    isOwnerUser: true,
    isChatAdmin: true
  });

  assert.strictEqual(sentGroupMessages.length, 2, 'Deve postar a oferta de Alexa');
  const alexaPost = sentGroupMessages[1].content;
  const alexaText = (alexaPost.caption || alexaPost.text).toLowerCase();
  console.log('  ✓ Oferta específica postada com sucesso para "alexa":');
  assert.ok(alexaText.includes('alexa'), 'Deve conter alexa no produto postado');

  // Teste 2.3: Ativação de auto-divulgação no grupo via !duvug auto 30
  await achadinhosService.handleDuvugCommand({
    sock: fakeGroupSock,
    from: groupJid,
    text: '!duvug auto 30',
    isGroup: true,
    senderPhone: privatePhone,
    isOwnerUser: true,
    isChatAdmin: true
  });

  assert.strictEqual(sentGroupMessages.length, 3, 'Deve responder confirmação de ativação');
  const autoConfirm = sentGroupMessages[2].content.text;
  console.log('  ✓ Resposta ao ativar auto-divulgação:\n    ' + autoConfirm.split('\n')[0]);
  assert.ok(autoConfirm.includes('ATIVADA') && autoConfirm.includes('30 minutos'), 'Deve confirmar ativação para 30 minutos');

  const channelInDb = models.getAchadinhosChannelByJid(groupJid);
  assert.ok(channelInDb && channelInDb.active === 1, 'Canal no banco deve estar com active = 1');

  // Teste 2.4: Status do grupo via !duvug status
  await achadinhosService.handleDuvugCommand({
    sock: fakeGroupSock,
    from: groupJid,
    text: '!duvug status',
    isGroup: true,
    senderPhone: privatePhone,
    isOwnerUser: true,
    isChatAdmin: true
  });

  assert.strictEqual(sentGroupMessages.length, 4, 'Deve responder status do grupo');
  const statusReport = sentGroupMessages[3].content.text;
  console.log('  ✓ Relatório de status gerado com sucesso:\n    ' + statusReport.split('\n')[0]);
  assert.ok(statusReport.includes('STATUS DA DIVULGAÇÃO') && statusReport.includes('ATIVO'), 'Deve reportar ativo');

  // Teste 2.5: Desativação do grupo via !duvug off
  await achadinhosService.handleDuvugCommand({
    sock: fakeGroupSock,
    from: groupJid,
    text: '!duvug off',
    isGroup: true,
    senderPhone: privatePhone,
    isOwnerUser: true,
    isChatAdmin: true
  });

  assert.strictEqual(sentGroupMessages.length, 5, 'Deve responder confirmação de desativação');
  const offConfirm = sentGroupMessages[4].content.text;
  console.log('  ✓ Resposta ao desativar:\n    ' + offConfirm.split('\n')[0]);
  assert.ok(offConfirm.includes('DESATIVADA'), 'Deve confirmar desativação');

  const channelAfterOff = models.getAchadinhosChannelByJid(groupJid);
  assert.ok(channelAfterOff && channelAfterOff.active === 0, 'Canal no banco deve estar com active = 0');

  // Limpa grupo de teste do banco
  db.prepare('DELETE FROM achadinhos_channels WHERE target_jid = ?').run(groupJid);
  db.prepare('DELETE FROM achadinhos_posts_log WHERE target_jid = ?').run(groupJid);

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
  console.log('🔒 Links de afiliados 100% isolados dos chats privados.');
  console.log('📢 Comando !DUVUG operacional e restrito exclusivamente para grupos.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

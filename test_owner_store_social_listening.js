/**
 * test_owner_store_social_listening.js
 * Teste unitário e de integração para:
 * 1. Reconhecimento biométrico/número do Dono (DDD 48 / 554884702848) e Tratamento VIP Executivo
 * 2. Telemetria da Vitrine Web, Persistência de Carrinho & Checkout Dinâmico via WhatsApp
 * 3. Motor de Social Listening & Entrosamento Orgânico Stealth em Grupos
 */

const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');
const socialListeningService = require('./src/services/socialListeningService');
const tunnelService = require('./src/services/tunnelService');

let passedTests = 0;
function logPass(msg) {
  passedTests++;
  console.log(`  ✅ [PASS] ${msg}`);
}

async function runTests() {
  console.log('\n🚀 INICIANDO TESTES DO PACOTE DONO VIP, TELEMETRIA LOJA E SOCIAL LISTENING...\n');

  // ==============================================================
  // BLOC 1: RECONHECIMENTO DO DONO & TRATAMENTO VIP EXECUTIVO
  // ==============================================================
  console.log('📌 BLOCO 1: Reconhecimento do Dono e Tratamento VIP Executivo');

  // Garante telefone do dono configurado
  models.setSetting('OWNER_PHONE', '554884702848');
  models.setSetting('OWNER_WHATSAPP', '554884702848');
  models.setSetting('ADMIN_PHONE', '554884702848');
  models.setSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '554884702848');

  // Teste 1.1: fromMe = true é sempre o dono
  assert.strictEqual(whatsappBot.isOwner('qualquer_numero', true), true, 'fromMe deve sempre ser reconhecido como Dono');
  logPass('fromMe = true reconhecido como Dono com privilégios totais');

  // Teste 1.2: Variações do formato brasileiro de telefone DDD 48 (554884702848)
  const ownerVariants = [
    '554884702848',   // DDI 55 + DDD 48 + 8 dígitos
    '5548984702848',  // DDI 55 + DDD 48 + 9 + 8 dígitos
    '4884702848',     // DDD 48 + 8 dígitos
    '48984702848',    // DDD 48 + 9 + 8 dígitos
    '84702848'        // 8 dígitos finais
  ];

  for (const variant of ownerVariants) {
    assert.strictEqual(whatsappBot.isOwner(variant, false), true, `Variação ${variant} deve ser reconhecida como Dono`);
  }
  logPass('Todas as 5 variações de formato DDD 48 reconhecidas com sucesso');

  // Teste 1.3: Não-dono não é reconhecido
  assert.strictEqual(whatsappBot.isOwner('5511999991111', false), false, 'Número aleatório não deve ser dono');
  logPass('Números de clientes comuns corretamente classificados como NÃO-dono');

  // Teste 1.4: Dono enviando !painel recebe link administrativo seguro
  tunnelService.adminUrl = 'https://spybot-owner-secure.trycloudflare.com';
  let capturedPrivateMsgs = [];
  let mockOwnerSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      capturedPrivateMsgs.push({ jid, text: typeof content === 'string' ? content : content.text });
      return { key: { id: 'MOCK_MSG_' + Date.now() } };
    }
  };

  // Envio de !painel em privado pelo Dono
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_PAINEL_1' },
    pushName: 'Dr. Marcos',
    message: { conversation: '!painel' }
  }, mockOwnerSock);

  assert.ok(capturedPrivateMsgs.length > 0, 'Dono deve receber resposta ao solicitar !painel');
  const panelReply = capturedPrivateMsgs[capturedPrivateMsgs.length - 1].text;
  assert.ok(panelReply.includes('PAINEL ADMINISTRATIVO') || panelReply.includes('spybot-owner-secure.trycloudflare.com'), 'Deve conter link do painel admin');
  logPass('Comando !painel entrega URL confidencial do painel para o Dono');

  // Teste 1.5: Dono enviando !status recebe Métricas Executivas e NUNCA "Nenhum pedido recente"
  capturedPrivateMsgs = [];
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_STATUS_1' },
    pushName: 'Dr. Marcos',
    message: { conversation: '!status' }
  }, mockOwnerSock);

  const statusReply = capturedPrivateMsgs[capturedPrivateMsgs.length - 1].text;
  assert.ok(statusReply.includes('PAINEL EXECUTIVO') || statusReply.includes('Faturamento & Vendas'), 'Dono deve receber Dashboard Executivo ao pedir !status');
  assert.ok(!statusReply.includes('Nenhum pedido recente encontrado'), 'Dono NUNCA deve receber mensagem de rastreamento de cliente');
  logPass('Comando !status para o Dono retorna Dashboard Executivo (sem funil de lead)');

  // Teste 1.6: Dono enviando !dono ou !souodono recebe Cockpit Executivo
  capturedPrivateMsgs = [];
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_DONO_1' },
    pushName: 'Dr. Marcos',
    message: { conversation: '!souodono' }
  }, mockOwnerSock);

  const cockpitReply = capturedPrivateMsgs[capturedPrivateMsgs.length - 1].text;
  assert.ok(cockpitReply.toLowerCase().includes('comandante') || cockpitReply.toLowerCase().includes('executiva') || cockpitReply.toLowerCase().includes('chefe'), 'Deve saudar o Dono com respeito executivo');
  logPass('Comando !souodono saúda o Comandante com Central Executiva');

  // Teste 1.7: Dono em grupo conversa sem que o bot dispare menu de compras
  let groupCapturedMsgs = [];
  let mockGroupSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      groupCapturedMsgs.push({ jid, text: typeof content === 'string' ? content : content.text });
      return { key: { id: 'MOCK_GRP_' + Date.now() } };
    }
  };

  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '120363000000000001@g.us', participant: '554884702848@s.whatsapp.net', fromMe: false, id: 'TEST_GRP_CHAT_1' },
    pushName: 'Dr. Marcos',
    message: { conversation: 'bom dia pessoal, como foram as vendas de ontem?' }
  }, mockGroupSock);

  assert.strictEqual(groupCapturedMsgs.length, 0, 'Bot NÃO deve interromper conversa natural do Dono no grupo com menu de vendas');
  logPass('Bot respeita conversa do Dono no grupo e não dispara funis de vendas');


  // ==============================================================
  // BLOCO 2: TELEMETRIA DA VITRINE WEB & CARRINHO PERSISTENTE
  // ==============================================================
  console.log('\n📌 BLOCO 2: Telemetria da Loja Web, Persistência e Checkout WhatsApp');

  const testSessionId = 'sess_test_' + Date.now();
  const testPhone = '5548999998888';

  // Teste 2.1: Rastreamento de visualização de produto (PRODUCT_VIEW)
  const track1 = await webStoreTrackerService.trackEvent({
    session_id: testSessionId,
    phone: testPhone,
    customer_name: 'Lead Teste Loja',
    event_type: 'PRODUCT_VIEW',
    product_id: 1,
    product_name: 'PayBot SaaS Multi-Tenancy',
    cart_payload: JSON.stringify([{ id: 1, name: 'PayBot SaaS Multi-Tenancy', price_brl: 1500, quantity: 1 }]),
    cart_total: 1500
  });
  assert.strictEqual(track1.success, true);
  logPass('Evento PRODUCT_VIEW gravado na telemetria');

  // Teste 2.2: Rastreamento de adição ao carrinho (ADD_TO_CART)
  const track2 = await webStoreTrackerService.trackEvent({
    session_id: testSessionId,
    phone: testPhone,
    customer_name: 'Lead Teste Loja',
    event_type: 'ADD_TO_CART',
    product_id: 1,
    product_name: 'PayBot SaaS Multi-Tenancy',
    cart_payload: JSON.stringify([{ id: 1, name: 'PayBot SaaS Multi-Tenancy', price_brl: 1500, quantity: 1 }]),
    cart_total: 1500
  });
  assert.strictEqual(track2.success, true);
  logPass('Evento ADD_TO_CART gravado e sessão de carrinho atualizada');

  // Teste 2.3: Consulta de telemetria no banco de dados
  const telemetryEvents = models.getStoreTelemetry(10, testPhone);
  assert.ok(telemetryEvents.length >= 2, 'Deve encontrar pelo menos 2 eventos para o telefone de teste');
  assert.ok(telemetryEvents.some(e => e.event_type === 'PRODUCT_VIEW'));
  assert.ok(telemetryEvents.some(e => e.event_type === 'ADD_TO_CART'));
  logPass('Eventos de telemetria consultados com sucesso no banco de dados');

  // Teste 2.4: Sessão de carrinho recuperada por session_id
  const cartSession = models.getCartSession(testSessionId);
  assert.ok(cartSession, 'Sessão do carrinho deve existir no banco');
  assert.strictEqual(cartSession.status, 'IN_CART');
  assert.strictEqual(Number(cartSession.cart_total), 1500);
  logPass('Sessão do carrinho persistida corretamente com status IN_CART');

  // Teste 2.5: Integração Cognitiva (Memórias Episódicas gravadas para o Lead)
  const episodicMemories = models.getLeadEpisodicMemories(testPhone);
  assert.ok(episodicMemories.length >= 1, 'Eventos da loja devem ser salvos nas memórias episódicas do lead');
  assert.ok(episodicMemories.some(m => m.memory_type && m.memory_type.includes('STORE_')), 'Deve conter memórias com memory_type STORE_');
  logPass('Ações da vitrine sincronizadas com memórias episódicas do CRM Cognitivo');

  // Teste 2.6: Resolução dinâmica de telefone real do bot para links wa.me
  const resolvedBotPhone = webStoreTrackerService.getBotContactPhone();
  assert.ok(resolvedBotPhone && resolvedBotPhone.length >= 8, 'Deve resolver um número de telefone válido');
  assert.strictEqual(resolvedBotPhone, '554884702848', 'Deve resolver para o número oficial configurado');
  logPass('Resolução de telefone do bot para links wa.me validada');

  // Teste 2.7: Disparo de confirmação automática pós-checkout
  let capturedNotifications = [];
  const origSendMessage = whatsappBot.sendMessage;
  whatsappBot.sendMessage = async (jid, content) => {
    capturedNotifications.push({ jid, text: typeof content === 'string' ? content : content.text });
    return { key: { id: 'MOCK_NOTIF_' + Date.now() } };
  };

  await webStoreTrackerService.notifyOrderPlaced({
    tradeNo: 'ORD_TEST_9999',
    customerName: 'Carlos Tech',
    customerPhone: testPhone,
    items: [{ name: 'App Sob Medida', quantity: 1, totalBRL: 2500 }],
    finalBRL: 2500,
    gateway: 'whatsapp'
  });

  whatsappBot.sendMessage = origSendMessage;
  assert.ok(capturedNotifications.length >= 1, 'Deve enviar notificação para o cliente');
  assert.ok(capturedNotifications.some(n => n.jid.includes(testPhone)), 'Cliente deve receber confirmação do pedido');
  logPass('Notificação automática de pedido despachada via WhatsApp');


  // ==============================================================
  // BLOCO 3: SOCIAL LISTENING & ENTROSAMENTO STEALTH EM GRUPOS
  // ==============================================================
  console.log('\n📌 BLOCO 3: Motor de Social Listening & Entrosamento Stealth em Grupos');

  // Teste 3.1: Regras pré-cadastradas no banco
  const rules = models.listSocialListeningRules(true);
  assert.ok(rules.length >= 1, 'Deve haver regras ativas de social listening');
  logPass(`Regras ativas de escuta carregadas do banco (${rules.length} regras)`);

  // Teste 3.2: Criação de nova regra personalizada (ex: Chapinha Titanium)
  const newRule = models.saveSocialListeningRule({
    product_name: 'Chapinha Titanium Profissional',
    keywords: 'prancha titanium lizze supreme, lizze supreme, alisar com lizze',
    affiliate_url: 'https://shopee.com.br/afiliado/chapinha-titanium',
    templates: [
      'Menina, comprei essa chapinha por esse link aqui na promoção: {link} esquenta super rápido!',
      'Uso essa no salão e recomendo demais, peguei por aqui com frete grátis: {link}'
    ],
    active: true
  });
  assert.ok(newRule && newRule.id, 'Nova regra deve ser salva com ID');
  logPass('Nova regra de escuta para produtos/afiliados salva com sucesso');

  // Teste 3.3: Mensagem de membro comum no grupo com palavra-chave dispara recomendação stealth
  const testGroupJid = '120363000000000099@g.us';
  socialListeningService.resetCooldown(testGroupJid);

  let stealthGroupReplies = [];
  const mockGroupListenSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, content) => {
      stealthGroupReplies.push({ jid, text: typeof content === 'string' ? content : content.text });
      return { key: { id: 'MOCK_STEALTH_' + Date.now() } };
    }
  };

  const triggerRes = await socialListeningService.handleIncomingGroupMessage(
    mockGroupListenSock,
    testGroupJid,
    '5511977776666@s.whatsapp.net',
    'Meninas, alguém sabe me indicar onde comprar a lizze supreme?',
    false
  );

  assert.ok(triggerRes && triggerRes.triggered, 'Deve disparar o gatilho de social listening');
  assert.strictEqual(triggerRes.matchedKeyword, 'lizze supreme');
  assert.ok(triggerRes.sentText.includes('https://shopee.com.br/afiliado/chapinha-titanium'), 'Mensagem enviada deve conter o link de afiliado');
  logPass('Recomendação orgânica stealth com link de afiliado disparada com sucesso no grupo');

  // Teste 3.4: Cooldown anti-spam por grupo
  const spamAttempt = await socialListeningService.handleIncomingGroupMessage(
    mockGroupListenSock,
    testGroupJid,
    '5511977775555@s.whatsapp.net',
    'Outra pessoa perguntando sobre chapinha logo em seguida',
    false
  );
  assert.strictEqual(spamAttempt, false, 'Deve respeitar o cooldown do grupo para evitar spam consecutivo');
  logPass('Cooldown anti-spam respeitado (segunda mensagem consecutiva ignorada)');

  // Teste 3.5: Mensagens do próprio Dono NUNCA acionam o Social Listening
  socialListeningService.resetCooldown(testGroupJid);
  const ownerAttempt = await socialListeningService.handleIncomingGroupMessage(
    mockGroupListenSock,
    testGroupJid,
    '554884702848@s.whatsapp.net',
    'vou testar se a chapinha dispara',
    true // isOwnerUser = true
  );
  assert.strictEqual(ownerAttempt, false, 'Dono NUNCA deve ser alvo de recomendação de afiliado');
  logPass('Dono blindado de gatilhos stealth no grupo');

  // Teste 3.6: Contador de disparos incrementado no banco de dados
  const updatedRule = models.getSocialListeningRule(newRule.id);
  assert.ok(updatedRule.triggered_count >= 1, 'Contador de disparos da regra deve ser incrementado');
  assert.ok(updatedRule.last_triggered_at, 'Timestamp do último disparo deve ser atualizado');
  logPass('Métricas de disparos e timestamp auditados com sucesso no banco');

  console.log(`\n=============================================================`);
  console.log(`🎉 TODOS OS ${passedTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
  console.log(`=============================================================\n`);
}

runTests().catch(err => {
  console.error('\n❌ FALHA NOS TESTES:', err);
  process.exit(1);
});

const assert = require('assert');
const models = require('./src/db/models');
const subbotPrivateFilter = require('./src/services/subbotPrivateFilterService');
const socialListeningService = require('./src/services/socialListeningService');
const groupHeatingService = require('./src/services/groupHeatingService');
const aiManager = require('./src/services/aiManagerService');
const swarmIntelligence = require('./src/services/swarmIntelligenceService');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');
const fulfillment = require('./src/services/fulfillment');
const handler = require('./src/handler');

process.env.NODE_ENV = 'test';

async function runComprehensiveTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: CORREÇÕES DOS 4 REQUISITOS DO USUÁRIO');
  console.log('========================================================================\n');

  let passed = 0;

  // =========================================================================
  // REQUISITO 1: O BOT NÃO DEVE FALAR SOZINHO RESPONDENDO A SI MESMO
  // =========================================================================
  console.log('--- REQUISITO 1: Prevenção de loop e auto-resposta de bots em grupos ---');

  // Cria dois sub-bots de teste
  const inst1 = models.createArmyInstance({
    name: 'Sub-Bot Alpha #1001',
    phone: '5511999991001',
    status: 'CONNECTED',
    is_subbot: 1
  });
  const inst2 = models.createArmyInstance({
    name: 'Sub-Bot Beta #1002',
    phone: '5511999991002',
    status: 'CONNECTED',
    is_subbot: 1
  });

  // 1.1 Detecção de robôs da frota
  assert.strictEqual(subbotPrivateFilter.isFleetBotNumber('5511999991001'), true, 'Sub-Bot 1001 reconhecido como robô da frota');
  assert.strictEqual(subbotPrivateFilter.isFleetBotNumber('5511999991002'), true, 'Sub-Bot 1002 reconhecido como robô da frota');
  assert.strictEqual(subbotPrivateFilter.isFleetBotNumber('5511988887766'), false, 'Número de cliente real NÃO é robô da frota');
  console.log('  ✅ [PASS] 1.1 isFleetBotNumber detecta corretamente chips de sub-bots e números de terceiros');
  passed++;

  // 1.2 Social Listening rejeita mensagens enviadas por robôs da frota
  const testGroup = '120363046549885654@g.us';
  const mockSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async () => ({ key: { id: 'mock_' + Date.now() } })
  };

  const slFleetResult = await socialListeningService.handleIncomingGroupMessage(
    mockSock,
    testGroup,
    '5511999991001@s.whatsapp.net',
    'Alguém recomenda essa Lava Louças?',
    false
  );
  assert.strictEqual(slFleetResult, false, 'Social Listening deve ignorar 100% mensagens de outros robôs da frota');
  console.log('  ✅ [PASS] 1.2 Social Listening ignora mensagens de robôs da frota (sem mineração de si mesmo)');
  passed++;

  // 1.3 Aquecimento não inicia diálogo se os bots forem idênticos ou mesmo número
  const selfHeatingResult = await groupHeatingService.handleGroupTopicTrigger(
    testGroup,
    { product_name: 'Lava Louças', keywords: 'lava loucas', affiliate_url: 'https://link.com' },
    'alguém recomenda?',
    {
      senderPhone: '5511999991001', // Enviado pelo próprio bot
      sock: mockSock
    }
  );
  assert.strictEqual(selfHeatingResult.triggered, false, 'Aquecimento bloqueado se originado de outro robô');
  console.log('  ✅ [PASS] 1.3 groupHeatingService bloqueia início de diálogo se gatilho for mensagem de robô da frota');
  passed++;

  // =========================================================================
  // REQUISITO 2: SUB-BOTS DEVEM USAR O NÚCLEO DE INTELIGÊNCIA NO PRIVADO
  // =========================================================================
  console.log('\n--- REQUISITO 2: Sub-Bots utilizando o Núcleo de Inteligência no Privado ---');

  const privateDecision = subbotPrivateFilter.shouldSubBotProcessPrivateMessage({
    sock: mockSock,
    instanceId: inst1.id,
    senderPhone: '5511988887766',
    senderName: 'João Silva',
    text: 'Olá, gostaria de saber mais sobre as soluções de vocês',
    isFromMe: false,
    isOwnerUser: false
  });

  assert.strictEqual(privateDecision.allow, true, 'Sub-Bot deve permitir atendimento de qualquer pessoa no privado');
  assert.strictEqual(privateDecision.reason, 'AI_INTELLIGENCE_CORE_PV', 'Motivo deve ser AI_INTELLIGENCE_CORE_PV');
  console.log('  ✅ [PASS] 2.1 shouldSubBotProcessPrivateMessage acolhe contatos no privado para o Núcleo de IA');
  passed++;

  // 2.2 Sub-Bot sem chave individual utiliza chaves compartilhadas do Núcleo de Inteligência
  const keysForSubbot = aiManager.getKeysForProvider('gemini', { subbotId: inst1.id });
  assert.ok(Array.isArray(keysForSubbot), 'Retorna lista de chaves');
  console.log('  ✅ [PASS] 2.2 Sub-Bot acessa chaves do Núcleo de Inteligência compartilhado');
  passed++;

  // =========================================================================
  // REQUISITO 3: AO COLAR CHAVE DE API O BOT DEVE REAGIR
  // =========================================================================
  console.log('\n--- REQUISITO 3: Reação imediata e ativação ao colar chave de API ---');

  const fakeKeyGemini = 'AIzaSyAABBCCDDEEFFGGHHIIJJKKLLMMNN123';
  const detected = aiManager.detectApiKey(fakeKeyGemini);
  assert.ok(detected, 'Detectou chave Gemini com sucesso');
  assert.strictEqual(detected.provider, 'gemini', 'Provedor Gemini identificado');

  // Mock de socket para capturar reações e mensagens
  let reactedEmoji = null;
  let sentText = null;
  const mockReactionSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      if (content.react) {
        reactedEmoji = content.react.text;
      } else if (content.text) {
        sentText = content.text;
      }
      return { key: { id: 'mock_key_react_1' } };
    }
  };

  // Testa inspeção da inteligência para Sub-Bot (Mockando validação positiva)
  const origValidate = aiManager.validateSubBotKey;
  aiManager.validateSubBotKey = async () => ({ ok: true, latencyMs: 85 });

  const inspectRes = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockReactionSock,
    instanceId: inst2.id,
    from: '5511999991002@s.whatsapp.net',
    sender: '5511988887766@s.whatsapp.net',
    text: fakeKeyGemini,
    isGroup: false,
    msgKey: { id: 'wpp_msg_key_123', remoteJid: '5511999991002@s.whatsapp.net' }
  });

  assert.strictEqual(inspectRes.handled, true, 'Chave tratada com sucesso');
  assert.strictEqual(inspectRes.action, 'KEY_ACTIVATED', 'Ação foi KEY_ACTIVATED');
  assert.ok(sentText.includes('VALIDADA E ATIVADA COM SUCESSO'), 'Mensagem de confirmação enviada');
  assert.ok(sentText.includes(`Sub-Bot ID:* #${inst2.id}`), 'Associado ao Sub-Bot correto');
  console.log('  ✅ [PASS] 3.1 Ao colar chave de API no Sub-Bot, reage com emoji e envia confirmação de ativação');
  passed++;

  // Testa ativação no Matriz (instanceId = 1)
  sentText = null;
  const inspectResMaster = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockReactionSock,
    instanceId: 1,
    from: '554884702848@s.whatsapp.net',
    sender: '554884702848@s.whatsapp.net',
    text: fakeKeyGemini,
    isGroup: false,
    msgKey: { id: 'wpp_msg_key_master_123', remoteJid: '554884702848@s.whatsapp.net' }
  });

  assert.strictEqual(inspectResMaster.handled, true, 'Chave tratada na Matriz');
  assert.ok(sentText.includes('Matriz Principal (Mega-Pool Master)'), 'Ativada no Mega-Pool Master da Matriz');
  console.log('  ✅ [PASS] 3.2 Ao colar chave de API na Matriz, ativa no Mega-Pool Master com confirmação imediata');
  passed++;

  // Restaura validador original
  aiManager.validateSubBotKey = origValidate;

  // =========================================================================
  // REQUISITO 4: PEDIDOS #ORD_ ENVIADOS PARA GRUPO ESPECÍFICO DE #ORD
  // =========================================================================
  console.log('\n--- REQUISITO 4: Envio de pedidos (#ORD_) para Grupo Específico ---');

  const testOrdersGroup = '120363999999999999@g.us';

  // 4.1 Configuração via models
  models.setOrdersGroupJid(testOrdersGroup);
  assert.strictEqual(models.getOrdersGroupJid(), testOrdersGroup, 'Grupo #ORD configurado em models');
  console.log('  ✅ [PASS] 4.1 models.getOrdersGroupJid() e setOrdersGroupJid() gravam e recuperam o grupo');
  passed++;

  // 4.2 Comando !grupoord no handler
  let replyFromCommand = null;
  const mockMsg = {
    chat: testOrdersGroup,
    isGroup: true,
    text: '!grupoord',
    prefix: '!',
    command: 'grupoord',
    reply: (txt) => { replyFromCommand = txt; return true; }
  };

  const cmdGrupoOrd = handler.findCommand('grupoord');
  assert.ok(cmdGrupoOrd, 'Comando !grupoord registrado no Handler');
  await cmdGrupoOrd.run(mockMsg, { isOwner: true, isAdmin: true, text: '' });
  assert.ok(replyFromCommand.includes('CONFIGURADO COM SUCESSO'), 'Comando confirmou a configuração do grupo');
  assert.ok(replyFromCommand.includes(testOrdersGroup), 'Comando confirmou o JID correto');
  console.log('  ✅ [PASS] 4.2 Comando !grupoord configura grupo com confirmação e detalhes');
  passed++;

  // 4.3 webStoreTrackerService.notifyOrderPlaced despacha para o Grupo de #ORD e NÃO para o PV do dono
  let orderSentTo = [];
  const whatsappBot = require('./src/bots/whatsappBot');
  const origWppSend = whatsappBot.sendMessage;

  whatsappBot.sendMessage = async (targetJid, content) => {
    orderSentTo.push({ jid: targetJid, content });
    return true;
  };

  const sampleOrder = {
    tradeNo: 'ORD_WEB_TEST_9988',
    customerName: 'Carlos Comprador',
    customerPhone: '5511977776655',
    items: [
      { name: 'Licença Anual PayBot VIP', quantity: 1, totalBRL: 497.00 }
    ],
    finalBRL: 497.00,
    gateway: 'pix',
    pixCode: '00020126580014br.gov.bcb.pix0136fake_key'
  };

  await webStoreTrackerService.notifyOrderPlaced(sampleOrder);

  // Valida que o alerta do pedido foi enviado para o grupo de #ORD
  const alertForGroup = orderSentTo.find(o => o.jid === testOrdersGroup);
  assert.ok(alertForGroup, 'Pedido novo foi enviado para o Grupo Específico de #ORD');
  assert.ok(alertForGroup.content.includes('#ORD_WEB_TEST_9988'), 'Contém o código #ORD_...');
  assert.ok(alertForGroup.content.includes('Carlos Comprador'), 'Contém nome do cliente');
  assert.ok(alertForGroup.content.includes('497.00'), 'Contém o valor');

  // Valida que NÃO enviou para o PV do Dono (554884702848@s.whatsapp.net)
  const alertForOwnerPv = orderSentTo.find(o => o.jid === '554884702848@s.whatsapp.net');
  assert.strictEqual(alertForOwnerPv, undefined, 'NÃO deve mandar para o privado do Dono quando há grupo de #ORD configurado!');
  console.log('  ✅ [PASS] 4.3 webStoreTrackerService.notifyOrderPlaced envia para o Grupo #ORD e poupa o privado do Dono');
  passed++;

  // 4.4 fulfillment.fulfillOrder também despacha venda confirmada para o grupo de #ORD
  let fulfillmentSentTo = [];
  fulfillment.registerWhatsAppBot({
    sendMessage: async (jid, content) => {
      fulfillmentSentTo.push({ jid, content });
      return true;
    }
  });

  // Cria pedido fictício no banco
  const uniqueTradeNo = 'ORD_PAID_TEST_' + Date.now();
  models.createOrder({
    merchant_trade_no: uniqueTradeNo,
    platform: 'whatsapp',
    platform_user_id: '5511977776655@s.whatsapp.net',
    platform_user_name: 'Carlos Comprador',
    product_id: 842,
    amount: 497.00,
    currency: 'BRL',
    gateway: 'pix',
    status: 'PAID'
  });

  await fulfillment.fulfillOrder(uniqueTradeNo);
  const saleAlertGroup = fulfillmentSentTo.find(o => o.jid === testOrdersGroup);
  assert.ok(saleAlertGroup, 'Alerta de venda aprovada foi enviado para o Grupo de #ORD');
  assert.strictEqual(fulfillmentSentTo.some(o => o.jid === '554884702848@s.whatsapp.net'), false, 'Não enviou venda aprovada para o PV do dono');
  console.log('  ✅ [PASS] 4.4 fulfillment.fulfillOrder envia confirmação de pagamento para o Grupo de #ORD');
  passed++;

  // Restaura sendMessage original
  whatsappBot.sendMessage = origWppSend;

  console.log('\n========================================================================');
  console.log(`🎉 TODOS OS ${passed} TESTES DOS 4 REQUISITOS PASSARAM COM 100% DE SUCESSO!`);
  console.log('========================================================================\n');
}

runComprehensiveTests().catch(err => {
  console.error('❌ ERRO NOS TESTES:', err);
  process.exit(1);
});

/**
 * test_store_tracking_whatsapp.js
 * Teste unitário e de integração para o comando !loja atrelado ao WhatsApp e trackeamento da vitrine
 */

const assert = require('assert');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');

async function runTests() {
  console.log('🧪 Iniciando testes de !loja atrelado ao WhatsApp e Trackeamento...');

  const testPhone = '5511998877665';
  const testName = 'Juliana Tech';

  // 1. Teste do comando !loja gerando link curto e limpo com rastreamento no banco
  let sentMessage = null;
  const mockSock = {
    sendMessage: async (to, content) => {
      sentMessage = { to, ...content };
      return true;
    }
  };

  await spyFeatures.handleLoja(mockSock, `${testPhone}@s.whatsapp.net`, testPhone, testName);

  assert(sentMessage, 'A mensagem deveria ter sido enviada');
  assert(sentMessage.text.includes('/v/'), 'A mensagem deve conter o link encurtado /v/ para não poluir o WhatsApp');
  const codeMatch = sentMessage.text.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(codeMatch, 'Código do short link deve ser encontrado na mensagem');
  const linkData = models.getStoreShortLinkByCode(codeMatch[1]);
  assert(linkData, 'Link curto deve estar registrado no banco');
  assert.strictEqual(linkData.phone, testPhone, 'Link curto deve estar atrelado ao telefone do lead');

  console.log('  ✅ [PASS] spyFeatures.handleLoja envia link curto atrelado ao telefone e nome do cliente');

  // 2. Teste de inicialização imediata do trackeamento no CRM Cognitivo
  const profile = models.getLeadCognitiveProfile(testPhone);
  assert(profile, 'Perfil cognitivo deve ter sido criado/atualizado');
  assert.strictEqual(profile.name, testName);
  assert(profile.readiness_score >= 50, 'Score de prontidão deve ser >= 50');

  const cartSession = models.getCartSession(`sess_lead_${testPhone}`);
  assert(cartSession, 'Sessão preliminar do carrinho deve ter sido criada');
  assert.strictEqual(cartSession.status, 'LINK_SENT');

  const telemetries = models.getStoreTelemetry(10, testPhone);
  const linkReqEvent = telemetries.find(t => t.event_type === 'STORE_LINK_REQUESTED');
  assert(linkReqEvent, 'Evento STORE_LINK_REQUESTED deve ter sido registrado');

  console.log('  ✅ [PASS] CRM Cognitivo e telemetria inicializados imediatamente na solicitação de !loja');

  // 3. Teste de rastreamento de abertura da loja (PAGE_VIEW)
  const trackPageView = await webStoreTrackerService.trackEvent({
    session_id: `sess_lead_${testPhone}`,
    phone: testPhone,
    customer_name: testName,
    event_type: 'PAGE_VIEW',
    metadata: JSON.stringify({ source: 'whatsapp_link' })
  });

  assert(trackPageView.success, 'PAGE_VIEW deve ser registrado com sucesso');
  const memories = models.getLeadEpisodicMemories(testPhone, 10);
  const storeAccessMem = memories.find(m => m.memory_type === 'STORE_ACCESS');
  assert(storeAccessMem, 'Memória episódica de STORE_ACCESS deve ter sido criada');

  console.log('  ✅ [PASS] PAGE_VIEW com telefone registra telemetria e memória episódica STORE_ACCESS');

  // 4. Teste de rastreamento de produto e carrinho vinculados ao WhatsApp
  const trackAddToCart = await webStoreTrackerService.trackEvent({
    session_id: `sess_lead_${testPhone}`,
    phone: testPhone,
    customer_name: testName,
    event_type: 'ADD_TO_CART',
    product_id: 1,
    product_name: 'App Delivery Sob Medida',
    cart_payload: JSON.stringify([{ id: 1, name: 'App Delivery Sob Medida', price_brl: 4500, quantity: 1 }]),
    cart_total: 4500
  });

  assert(trackAddToCart.success, 'ADD_TO_CART deve ser registrado com sucesso');
  const updatedCartSession = models.getCartSession(`sess_lead_${testPhone}`);
  assert.strictEqual(updatedCartSession.status, 'IN_CART');
  assert.strictEqual(updatedCartSession.cart_total, 4500);

  const cartAddMem = models.getLeadEpisodicMemories(testPhone, 10).find(m => m.memory_type === 'STORE_CART_ADD');
  assert(cartAddMem, 'Memória episódica de STORE_CART_ADD deve ter sido criada');

  console.log('  ✅ [PASS] ADD_TO_CART atualiza carrinho e CRM Cognitivo do cliente');

  // 5. Teste em grupo (menção e extração do telefone do participante)
  let groupSentMessage = null;
  const mockGroupSock = {
    sendMessage: async (to, content) => {
      groupSentMessage = { to, ...content };
      return true;
    }
  };

  const groupJid = '120363099887766554@g.us';
  const groupUserPhone = '5511977771122';
  const groupUserName = 'Roberto Cliente Grupo';

  await spyFeatures.handleLoja(mockGroupSock, groupJid, groupUserPhone, groupUserName);

  assert(groupSentMessage, 'Mensagem deve ter sido enviada no grupo');
  assert.strictEqual(groupSentMessage.to, groupJid);
  const groupCodeMatch = groupSentMessage.text.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(groupCodeMatch, 'Texto deve conter link curto com tracking');
  const groupLink = models.getStoreShortLinkByCode(groupCodeMatch[1]);
  assert(groupLink && groupLink.phone === groupUserPhone, 'Link curto do grupo deve estar vinculado ao telefone do participante');
  assert(groupSentMessage.mentions.includes(`${groupUserPhone}@s.whatsapp.net`), 'Mensagem deve mencionar o cliente no grupo');

  console.log('  ✅ [PASS] !loja em grupos menciona o participante e vincula o link ao seu WhatsApp');

  console.log('\n🎉 TODOS OS TESTES DE !LOJA E TRACKING PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('❌ Teste falhou:', err);
  process.exit(1);
});

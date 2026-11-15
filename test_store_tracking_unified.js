/**
 * test_store_tracking_unified.js
 * Teste unitário e de integração para validação de rastreamento da loja e link curto limpo:
 * - Lead / Cliente (phone, lead, name, track)
 * - Sub-Bot / Instância do Exército WhatsApp (subbot)
 * - Afiliado / Indicação (ref)
 * - Rotação / Preservação via /v/:code
 */

const assert = require('assert');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');
const cognitiveSales = require('./src/services/cognitiveSalesService');
const masterHandler = require('./src/handler');

async function runUnifiedTrackingTests() {
  console.log('🧪 Iniciando bateria de testes do Rastreamento Universal da Loja...');

  const testPhone = '5511988887777';
  const testName = 'Carlos Investidor';
  const testSubbotId = 3;
  const testRefCode = 'afiliado_ouro';

  // 1. Teste direto do webStoreTrackerService.buildTrackedStoreUrl
  console.log('\n[1/6] Testando webStoreTrackerService.buildTrackedStoreUrl...');
  const tracked = webStoreTrackerService.buildTrackedStoreUrl({
    phone: testPhone,
    name: testName,
    instanceId: testSubbotId,
    refCode: testRefCode,
    source: 'test_audit'
  });

  assert(tracked.url, 'URL não deve ser vazia');
  assert(tracked.url.includes(`phone=${testPhone}`), 'URL deve conter phone do lead');
  assert(tracked.url.includes(`lead=${testPhone}`), 'URL deve conter lead do cliente');
  assert(tracked.url.includes(`name=${encodeURIComponent(testName)}`), 'URL deve conter nome do cliente codificado');
  assert(tracked.url.includes(`subbot=${testSubbotId}`), 'URL deve conter o identificador do sub-bot');
  assert(tracked.url.includes(`ref=${testRefCode}`), 'URL deve conter o código do afiliado');
  assert(tracked.url.includes('track='), 'URL deve conter o token de rastreamento (track)');
  assert(tracked.url.includes('s='), 'URL deve conter o identificador de sessão (s)');
  assert(tracked.shortUrl.includes('/v/'), 'URL curta deve apontar para /v/');
  console.log(`  ✅ URL gerada com sucesso:\n     ${tracked.url}\n     Curta: ${tracked.shortUrl}`);

  // 2. Teste do comando !loja via spyFeatures.handleLoja (Bot Principal)
  console.log('\n[2/6] Testando spyFeatures.handleLoja no Bot Principal...');
  let sentMainMsg = null;
  const mockSockMain = {
    sendMessage: async (to, content) => {
      sentMainMsg = { to, ...content };
      return true;
    }
  };

  await spyFeatures.handleLoja(mockSockMain, `${testPhone}@s.whatsapp.net`, testPhone, testName);
  assert(sentMainMsg, 'Mensagem deve ter sido enviada');
  assert(sentMainMsg.text.includes('/v/'), 'Mensagem deve conter o link encurtado limpo /v/');
  const mainCodeMatch = sentMainMsg.text.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(mainCodeMatch, 'Código do short link deve ser encontrado na mensagem');
  const mainLinkData = models.getStoreShortLinkByCode(mainCodeMatch[1]);
  assert(mainLinkData && mainLinkData.phone === testPhone, 'Link curto deve estar atrelado ao telefone do lead');
  console.log('  ✅ Bot Principal enviou o link encurtado da vitrine com dados de rastreamento preservados no banco');

  // 3. Teste do comando !loja via Sub-Bot do Exército (Multi-Chip)
  console.log('\n[3/6] Testando spyFeatures.handleLoja emitido por Sub-Bot...');
  let sentSubMsg = null;
  const mockSockSub = {
    instanceId: 5,
    user: { id: '5511977770005:1@s.whatsapp.net' },
    sendMessage: async (to, content) => {
      sentSubMsg = { to, ...content };
      return true;
    }
  };

  await spyFeatures.handleLoja(mockSockSub, `${testPhone}@s.whatsapp.net`, testPhone, testName);
  assert(sentSubMsg, 'Mensagem do sub-bot deve ter sido enviada');
  assert(sentSubMsg.text.includes('/v/'), 'Mensagem do sub-bot deve conter o link encurtado /v/');
  const subCodeMatch = sentSubMsg.text.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(subCodeMatch, 'Código do short link do sub-bot deve existir');
  const subLinkData = models.getStoreShortLinkByCode(subCodeMatch[1]);
  assert(subLinkData && subLinkData.phone === testPhone, 'Link curto do sub-bot deve estar atrelado ao lead');
  assert.strictEqual(subLinkData.instance_id, 5, 'Link curto do sub-bot deve registrar o chip 5');
  console.log('  ✅ Sub-Bot enviou o link encurtado com rastreamento do lead e do chip sub-bot');

  // 4. Teste do Motor de Vendas Cognitivo / IA (generateHeuristicConsultativeReply)
  console.log('\n[4/6] Testando links gerados nas respostas do Motor de Vendas Cognitivo...');
  const consultativeReply = cognitiveSales.generateHeuristicConsultativeReply({
    profile: { phone: testPhone, buying_stage: 'PROPOSTA' },
    firstName: testName,
    text: 'quanto custa o bot?',
    isMasterBot: true,
    effectiveProducts: []
  });

  assert(consultativeReply, 'Resposta de vendas deve ser retornada');
  assert(consultativeReply.includes('/v/'), 'Link oferecido na conversa de vendas deve ser encurtado /v/ para não poluir');
  const consultCodeMatch = consultativeReply.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(consultCodeMatch, 'Código do short link deve ser encontrado na resposta consultiva');
  const consultLinkData = models.getStoreShortLinkByCode(consultCodeMatch[1]);
  assert(consultLinkData && consultLinkData.phone === testPhone, 'Link curto consultivo deve estar atrelado ao lead');
  console.log('  ✅ Vendedor Cognitivo incluiu link encurtado limpo com rastreamento individual do lead');

  // 5. Teste de Redirecionamento 302 do Encurtador Preservando Rastreamento
  console.log('\n[5/6] Testando rota /v/:code com preenchimento de parâmetros de rastreamento...');
  const shortObj = models.getOrCreateStoreShortLink({
    phone: testPhone,
    name: testName,
    instanceId: 5,
    refCode: testRefCode,
    couponCode: 'AUTO10PRO',
    source: 'test_redirect'
  });
  assert(shortObj && shortObj.code, 'Short link deve existir');

  // Simula o comportamento do endpoint /v/:code
  const mockReq = { params: { code: shortObj.code }, query: {} };
  let redirectedLocation = null;
  const mockRes = {
    redirect: (status, url) => {
      if (typeof status === 'string') {
        redirectedLocation = status;
      } else {
        redirectedLocation = url;
      }
    }
  };

  const link = models.getStoreShortLinkByCode(mockReq.params.code, { trackClick: true });
  assert(link, 'Link deve ser encontrado');
  const query = new URLSearchParams(mockReq.query);
  if (link.phone && !query.has('phone')) query.set('phone', link.phone);
  if (link.phone && !query.has('lead')) query.set('lead', link.phone);
  if (link.customer_name && !query.has('name')) query.set('name', link.customer_name);
  if (link.instance_id && link.instance_id !== 1 && !query.has('subbot')) query.set('subbot', String(link.instance_id));
  if (link.ref_code && !query.has('ref')) query.set('ref', link.ref_code);
  if (link.coupon_code && !query.has('cupom')) query.set('cupom', link.coupon_code);
  query.set('s', shortObj.code);
  query.set('track', shortObj.code);

  const destination = (link.target_path || '/loja') + '?' + query.toString();
  mockRes.redirect(302, destination);

  assert(redirectedLocation, 'Redirecionamento deve ter ocorrido');
  assert(redirectedLocation.includes(`phone=${testPhone}`), 'Redirecionamento deve conter phone');
  assert(redirectedLocation.includes(`lead=${testPhone}`), 'Redirecionamento deve conter lead');
  assert(redirectedLocation.includes(`subbot=5`), 'Redirecionamento deve conter subbot');
  assert(redirectedLocation.includes(`ref=${testRefCode}`), 'Redirecionamento deve conter ref do afiliado');
  assert(redirectedLocation.includes('cupom=AUTO10PRO'), 'Redirecionamento deve conter o cupom');
  assert(redirectedLocation.includes(`track=${shortObj.code}`), 'Redirecionamento deve conter track code');
  console.log(`  ✅ Redirecionamento 302 preserva e expande 100% dos códigos de rastreamento:\n     Destino: ${redirectedLocation}`);

  // 6. Teste de Invocação pelo Handler de Comandos Principal
  console.log('\n[6/6] Testando comando !loja e !catalogo no Master Handler...');
  const lojaCmd = masterHandler.commands.get('loja');
  assert(lojaCmd, 'Comando !loja deve estar registrado no Master Handler');
  assert(lojaCmd.command.includes('catalogo'), 'Comando !catalogo deve estar nos aliases de !loja');

  let handlerSent = null;
  const mockConn = {
    sendMessage: async (to, content) => {
      handlerSent = { to, ...content };
      return true;
    }
  };
  const mockMsg = {
    chat: `${testPhone}@s.whatsapp.net`,
    sender: `${testPhone}@s.whatsapp.net`,
    senderNumber: testPhone,
    pushName: testName,
    react: async () => true
  };

  await lojaCmd.run(mockMsg, { conn: mockConn });
  assert(handlerSent, 'Handler deve ter enviado mensagem');
  assert(handlerSent.text.includes('/v/'), 'Mensagem do handler deve conter link curto limpo /v/');
  const handlerCodeMatch = handlerSent.text.match(/\/v\/([a-zA-Z0-9]+)/);
  assert(handlerCodeMatch, 'Código do short link deve existir na mensagem do handler');
  const handlerLinkData = models.getStoreShortLinkByCode(handlerCodeMatch[1]);
  assert(handlerLinkData && handlerLinkData.phone === testPhone, 'Link curto do handler deve estar atrelado ao lead');
  console.log('  ✅ Master Handler executou !loja e enviou o link encurtado rastreado com sucesso');

  console.log('\n🎉 TODOS OS TESTES DE RASTREAMENTO UNIVERSAL DA LOJA PASSARAM COM 100% DE SUCESSO! 🎉');
}

runUnifiedTrackingTests().catch(err => {
  console.error('\n❌ Falha no teste de rastreamento:', err);
  process.exit(1);
});

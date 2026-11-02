/**
 * test_dual_tunnels_security.js
 * Teste rigoroso de isolamento físico e lógico dos dois túneis:
 * 1. Túnel do Painel Admin (estritamente confidencial, entregue APENAS ao Dono/Master via !painel em PV)
 * 2. Túnel da Loja / Vitrine Pública (disponibilizado para clientes, catálogo, propostas e checkout)
 */

const assert = require('assert');
const http = require('http');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const tunnelService = require('./src/services/tunnelService');
const { createServer, createStoreServer } = require('./src/server/app');
const proposalService = require('./src/services/proposalService');
const models = require('./src/db/models');

const ownerPhone = '554884702848';
const strangerPhone = '5511999998888';

async function runDualTunnelSecurityTests() {
  console.log('====================================================');
  console.log('🔒 TESTE DE ISOLAMENTO DOS DOIS TÚNEIS (ADMIN VS LOJA)');
  console.log('====================================================\n');

  let testsPassed = 0;

  // Configura URLs simuladas distintas para cada túnel
  tunnelService.adminUrl = 'https://admin-confidential-panel.trycloudflare.com';
  tunnelService.storeUrl = 'https://loja-publica-vitrine.trycloudflare.com';

  // ----------------------------------------------------
  // TESTE 1: Separação de URLs no TunnelService
  // ----------------------------------------------------
  console.log('🌐 [TESTE 1] Verificação de URLs independentes no TunnelService');
  assert.strictEqual(tunnelService.getAdminUrl(), 'https://admin-confidential-panel.trycloudflare.com');
  assert.strictEqual(tunnelService.getStoreUrl(), 'https://loja-publica-vitrine.trycloudflare.com');
  assert.notStrictEqual(tunnelService.getAdminUrl(), tunnelService.getStoreUrl(), 'As URLs dos túneis DEVEM ser diferentes!');
  console.log('   └─ Detalhes: Túnel Admin e Túnel Loja possuem URLs distintas e isoladas.');
  testsPassed++;

  // ----------------------------------------------------
  // TESTE 2: Inicialização e Bloqueios no Servidor da Loja (createStoreServer)
  // ----------------------------------------------------
  console.log('🛍️ [TESTE 2] Servidor da Loja Pública: Root serve store.html e bloqueia /index.html');
  const storeApp = createStoreServer();
  let storeServer;
  let storeBaseUrl;

  await new Promise((resolve) => {
    storeServer = http.createServer(storeApp);
    storeServer.listen(0, '127.0.0.1', () => {
      const port = storeServer.address().port;
      storeBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // 2.1 Raiz / deve servir a loja (store.html)
    const rootRes = await fetch(`${storeBaseUrl}/`);
    assert.strictEqual(rootRes.status, 200, 'Raiz deve responder 200');
    const rootHtml = await rootRes.text();
    assert.ok(rootHtml.includes('Spy Tech Studio') || rootHtml.includes('vitrine') || rootHtml.includes('carrinho') || rootHtml.includes('cart-btn'), 'Raiz deve exibir a loja store.html');

    // 2.2 /loja deve servir a loja
    const lojaRes = await fetch(`${storeBaseUrl}/loja`);
    assert.strictEqual(lojaRes.status, 200);

    // 2.3 Tentativa de acessar /index.html (o painel admin) pelo túnel da loja DEVE SER BLOQUEADA com 403
    const adminIndexRes = await fetch(`${storeBaseUrl}/index.html`);
    assert.strictEqual(adminIndexRes.status, 403, 'Acesso a /index.html no servidor da loja DEVE ser 403 Forbidden');
    const adminIndexText = await adminIndexRes.text();
    assert.ok(adminIndexText.includes('403 Forbidden'), 'Deve conter mensagem de 403 Forbidden');

    // 2.4 Tentativa de acessar APIs administrativas pelo túnel da loja DEVE SER BLOQUEADA com 403
    const adminApiRes = await fetch(`${storeBaseUrl}/api/settings`);
    assert.strictEqual(adminApiRes.status, 403, 'Acesso a /api/settings no servidor da loja DEVE ser 403 Forbidden');

    const adminDeckRes = await fetch(`${storeBaseUrl}/api/botdeck/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(adminDeckRes.status, 403, 'Acesso a /api/botdeck/execute no servidor da loja DEVE ser 403 Forbidden');

    // 2.5 API pública da loja deve funcionar normalmente
    const prodRes = await fetch(`${storeBaseUrl}/api/store/products`);
    assert.strictEqual(prodRes.status, 200, 'API de produtos da loja deve responder 200 OK');
    const prodData = await prodRes.json();
    assert.strictEqual(prodData.success, true);

    console.log('   └─ Detalhes: Servidor da loja isolado: serve vitrine e bloqueia index.html e APIs admin com 403.');
    testsPassed++;
  } finally {
    if (storeServer) storeServer.close();
  }

  // ----------------------------------------------------
  // TESTE 3: WhatsApp - !painel solicitado por terceiro é BLOQUEADO
  // ----------------------------------------------------
  console.log('⛔ [TESTE 3] !painel chamado por terceiro é bloqueado com ACESSO NEGADO');
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Estranho',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(sentMsg, 'Deve responder ao comando');
    assert(sentMsg.includes('ACESSO NEGADO'), 'Deve conter ACESSO NEGADO');
    assert(!sentMsg.includes('admin-confidential-panel'), 'NÃO pode vazar a URL do painel admin');
    assert(!sentMsg.includes('loja-publica-vitrine'), 'NÃO deve vazar links indevidos');
    console.log('   └─ Detalhes: Usuário terceiro recebeu ACESSO NEGADO sem vazamento de túnel.');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TESTE 4: WhatsApp - !painel solicitado pelo Dono em Grupo envia pro PV
  // ----------------------------------------------------
  console.log('🔒 [TESTE 4] !painel chamado pelo Dono em grupo despacha link confidencial para o PV');
  {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, text: content.text });
      }
    };
    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '1203630283748291@g.us',
        participant: `${ownerPhone}@s.whatsapp.net`,
        fromMe: false
      },
      pushName: 'Dono',
      message: { conversation: '!painel' }
    }, mockSock);

    assert.strictEqual(sentMessages.length, 2, 'Deve enviar aviso no grupo e link no PV do Dono');
    const groupMsg = sentMessages.find(m => m.jid === '1203630283748291@g.us');
    const pvMsg = sentMessages.find(m => m.jid.includes(ownerPhone));

    assert(groupMsg, 'Deve haver aviso no grupo');
    assert(!groupMsg.text.includes('admin-confidential-panel'), 'Grupo NÃO pode ver a URL do painel');
    assert(groupMsg.text.includes('Privado'), 'Aviso no grupo informa envio ao Privado');

    assert(pvMsg, 'Deve haver mensagem no PV do Dono');
    assert(pvMsg.text.includes('admin-confidential-panel.trycloudflare.com'), 'PV do Dono DEVE conter a URL confidencial do Admin Tunnel');
    assert(!pvMsg.text.includes('loja-publica-vitrine'), 'PV do Dono para !painel deve conter o Admin Tunnel, não o da loja');
    console.log('   └─ Detalhes: Link do painel admin entregue exclusivamente no PV do Dono.');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TESTE 5: WhatsApp - !painel solicitado pelo Dono em PV entrega o Admin Tunnel
  // ----------------------------------------------------
  console.log('👑 [TESTE 5] !painel chamado pelo Dono em PV entrega o Túnel do Painel Admin');
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${ownerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Dono',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(sentMsg, 'Deve responder ao Dono');
    assert(sentMsg.includes('admin-confidential-panel.trycloudflare.com'), 'Dono recebe a URL do Painel Admin');
    assert(sentMsg.includes('PAINEL WEB & ACESSO REMOTO'), 'Contém cabeçalho do painel');
    console.log('   └─ Detalhes: Dono no PV recebeu o link seguro do túnel administrativo.');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TESTE 6: WhatsApp - !loja / !catalogo entrega o Túnel da Loja (NÃO o Admin)
  // ----------------------------------------------------
  console.log('🛍️ [TESTE 6] !loja chamado por cliente entrega o Túnel da Loja Pública');
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Cliente',
      message: { conversation: '!loja' }
    }, mockSock);

    assert(sentMsg, 'Deve responder ao cliente');
    assert(sentMsg.includes('loja-publica-vitrine.trycloudflare.com'), 'Cliente DEVE receber a URL do Túnel da Loja');
    assert(!sentMsg.includes('admin-confidential-panel'), 'Cliente NUNCA deve receber a URL do Painel Admin');
    console.log('   └─ Detalhes: Cliente recebeu link da vitrine pública com segurança.');
    testsPassed++;
  }

  // ----------------------------------------------------
  // TESTE 7: Propostas Comerciais usam o Túnel da Loja (NÃO o Admin)
  // ----------------------------------------------------
  console.log('📄 [TESTE 7] Envio de Proposta Comercial usa o Túnel da Loja');
  {
    const prop = proposalService.generateProposal('5511988883333', {
      lead_name: 'Cliente Proposta',
      project_title: 'App Delivery',
      investment_brl: 4500
    });

    const shareMsg = proposalService.generateWhatsAppShareMessage(prop, tunnelService.getStoreUrl());
    assert(shareMsg.includes('loja-publica-vitrine.trycloudflare.com/proposta/' + prop.token), 'Link da proposta DEVE usar o túnel da loja');
    assert(!shareMsg.includes('admin-confidential-panel'), 'Link da proposta NUNCA deve expor o túnel do painel admin');
    console.log('   └─ Detalhes: Proposta comercial despachada com a URL do túnel da loja.');
    testsPassed++;
  }

  console.log('\n====================================================');
  console.log(`🎉 TODOS OS ${testsPassed} TESTES DE DUPLO TÚNEL PASSARAM COM SUCESSO!`);
  console.log('====================================================');
}

runDualTunnelSecurityTests().catch(err => {
  console.error('\n❌ FALHA NO TESTE DE DUPLO TÚNEL:', err);
  process.exit(1);
});

/**
 * test_saas_multi_tenant.js
 * Teste completo da Plataforma SaaS Multi-Tenant e Gestão de Licenças
 */

const assert = require('assert');
const models = require('./src/db/models');

async function runTests() {
  console.log('🧪 Iniciando testes da Plataforma SaaS Multi-Tenant & Licenças...\n');

  // Limpa possíveis registros de testes anteriores
  const existingAlpha = models.getTenantBySlug('tech-alpha');
  if (existingAlpha) models.deleteTenant(existingAlpha.id);
  const existingAlpha1 = models.getTenantBySlug('tech-alpha-1');
  if (existingAlpha1) models.deleteTenant(existingAlpha1.id);

  // 1. Criação de Tenant com chave de licença gerada
  const tenant1 = models.createTenant({
    name: 'Tech Alpha Soluções',
    slug: 'tech-alpha',
    owner_name: 'Felipe Diretor',
    owner_phone: '5511999991122',
    owner_email: 'felipe@techalpha.com',
    plan: 'pro',
    duration_days: 30,
    max_bots: 5,
    max_products: 50
  });

  assert(tenant1, 'Tenant deve ter sido criado com sucesso');
  assert.strictEqual(tenant1.name, 'Tech Alpha Soluções');
  assert.strictEqual(tenant1.slug, 'tech-alpha');
  assert(tenant1.license_key.startsWith('SAAS-PRO-'), 'Chave deve ter formato SAAS-PRO-XXXX-XXXX-XXXX');
  assert.strictEqual(tenant1.effective_status, 'ACTIVE');
  assert(tenant1.days_left >= 29 && tenant1.days_left <= 31, 'Dias restantes devem ser ~30');
  console.log('✅ [PASS] models.createTenant (Criação de Tenant com Licença Pro e Validade de 30 dias)');

  // 2. Consulta por ID, Slug, Chave de Licença e Telefone
  const byId = models.getTenantById(tenant1.id);
  assert.strictEqual(byId.id, tenant1.id);

  const bySlug = models.getTenantBySlug('tech-alpha');
  assert.strictEqual(bySlug.id, tenant1.id);

  const byKey = models.getTenantByLicenseKey(tenant1.license_key);
  assert.strictEqual(byKey.id, tenant1.id);

  const byPhone = models.getTenantByPhone('5511999991122');
  assert.strictEqual(byPhone.id, tenant1.id);
  console.log('✅ [PASS] models.getTenantBy* (Busca por ID, Slug, Chave e Telefone)');

  // 3. Renovação de Licença (+60 dias)
  const renewed = models.renewTenantLicense(tenant1.id, 60, 'Renovação trimestral via Pix');
  assert(renewed.days_left >= 88 && renewed.days_left <= 91, 'Deve somar +60 dias aos 30 existentes');

  const logs = models.getTenantLicenseLogs(tenant1.id);
  assert(logs.length >= 2, 'Deve ter log de CREATED e RENEWED');
  assert.strictEqual(logs[0].action, 'RENEWED');
  assert.strictEqual(logs[0].days_added, 60);
  console.log('✅ [PASS] models.renewTenantLicense (Extensão de período de validade e auditoria de logs)');

  // 4. Suspensão / Pausa e Reativação de Licença
  const paused = models.pauseTenantLicense(tenant1.id, 'Falta de pagamento');
  assert.strictEqual(paused.effective_status, 'SUSPENDED');

  const resumed = models.resumeTenantLicense(tenant1.id);
  assert.strictEqual(resumed.effective_status, 'ACTIVE');
  console.log('✅ [PASS] models.pauseTenantLicense e resumeTenantLicense');

  // 5. Regeneração de Chave de Licença
  const oldKey = tenant1.license_key;
  const regenerated = models.regenerateTenantLicenseKey(tenant1.id);
  assert.notStrictEqual(regenerated.license_key, oldKey);
  assert(regenerated.license_key.startsWith('SAAS-PRO-'));
  console.log('✅ [PASS] models.regenerateTenantLicenseKey');

  // 6. Sessão de Tenant (Token de Autenticação)
  const session = models.createTenantSession(tenant1.id, 24);
  assert(session.token.startsWith('tnt_sess_'));

  const validTenant = models.validateTenantSession(session.token);
  assert(validTenant, 'Sessão deve validar o tenant corretamente');
  assert.strictEqual(validTenant.id, tenant1.id);

  models.destroyTenantSession(session.token);
  assert.strictEqual(models.validateTenantSession(session.token), null, 'Sessão destruída não deve ser válida');
  console.log('✅ [PASS] models.createTenantSession e validateTenantSession');

  // 7. Teste das Rotas HTTP via Express (Super Admin e Tenant)
  const http = require('http');
  const { createServer } = require('./src/server/app');
  const expressApp = createServer();
  const testServer = http.createServer(expressApp);
  await new Promise(r => testServer.listen(0, r));
  const port = testServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 7.1 GET /api/saas/tenants
    const resTenants = await (await fetch(`${baseUrl}/api/saas/tenants`)).json();
    assert(resTenants.success);
    assert(resTenants.summary.total >= 1);
    console.log('✅ [PASS] GET /api/saas/tenants (Cockpit e listagem no painel do Dono)');

    // 7.2 POST /api/tenant/auth/login via Chave de Licença
    const resLogin = await (await fetch(`${baseUrl}/api/tenant/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: regenerated.license_key })
    })).json();
    assert(resLogin.success);
    assert(resLogin.token);
    const tenantToken = resLogin.token;
    console.log('✅ [PASS] POST /api/tenant/auth/login via Chave de Licença');

    // 7.3 GET /api/tenant/dashboard
    const resDash = await (await fetch(`${baseUrl}/api/tenant/dashboard`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resDash.success);
    assert.strictEqual(resDash.tenant.id, tenant1.id);
    console.log('✅ [PASS] GET /api/tenant/dashboard (Cockpit isolado do Tenant)');

    // 7.4 POST /api/tenant/products (Criação de produto isolado no catálogo do tenant)
    const resNewProd = await (await fetch(`${baseUrl}/api/tenant/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`
      },
      body: JSON.stringify({
        name: 'Software de Gestão Tenant Pro',
        price: 197,
        price_brl: 197,
        category: 'Softwares',
        type: 'digital',
        content: 'https://download.techalpha.com/software.zip'
      })
    })).json();
    assert(resNewProd.success);
    assert.strictEqual(resNewProd.product.tenant_id, tenant1.id);
    console.log('✅ [PASS] POST /api/tenant/products (Catálogo isolado por Tenant)');

    // 7.5 GET /api/tenant/products
    const resProds = await (await fetch(`${baseUrl}/api/tenant/products`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resProds.products.length >= 1);
    assert.strictEqual(resProds.products[0].tenant_id, tenant1.id);
    console.log('✅ [PASS] GET /api/tenant/products (Retorna apenas produtos daquele tenant)');

    // 7.6 GET /api/tenant/license
    const resLic = await (await fetch(`${baseUrl}/api/tenant/license`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resLic.license.license_key);
    assert(resLic.logs.length >= 1);
    console.log('✅ [PASS] GET /api/tenant/license (Status da licença, vigência e histórico)');

    // 7.7 POST /api/saas/tenants/:id/impersonate
    const resImp = await (await fetch(`${baseUrl}/api/saas/tenants/${tenant1.id}/impersonate`, {
      method: 'POST'
    })).json();
    assert(resImp.token);
    assert(resImp.redirectUrl.includes('/tenant/dashboard?token='));
    console.log('✅ [PASS] POST /api/saas/tenants/:id/impersonate (Acesso direto do Dono ao painel do Tenant)');

    // 7.8 Teste de rota HTML do Tenant
    const resHtmlLogin = await fetch(`${baseUrl}/tenant/login`);
    assert.strictEqual(resHtmlLogin.status, 200);
    const resHtmlDash = await fetch(`${baseUrl}/tenant/dashboard`);
    assert.strictEqual(resHtmlDash.status, 200);
    console.log('✅ [PASS] Rotas /tenant/login e /tenant/dashboard retornam 200 OK');

    // 7.9 Conexão de WhatsApp por QRCode e PairCode no Painel do Tenant
    // 7.9.1 Criação de Bot WhatsApp do Tenant
    const resNewBot = await (await fetch(`${baseUrl}/api/tenant/bots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`
      },
      body: JSON.stringify({
        name: 'WhatsApp Vendas Tech Alpha',
        phone: '5511988887766'
      })
    })).json();
    assert(resNewBot.success, 'Deve criar bot do tenant com sucesso');
    assert(resNewBot.bot.id, 'Bot deve possuir ID');
    assert.strictEqual(resNewBot.bot.tenant_id, tenant1.id, 'Bot deve estar associado ao tenant');
    const botId = resNewBot.bot.id;
    console.log('✅ [PASS] POST /api/tenant/bots (Criação de bot WhatsApp associado ao Tenant)');

    // 7.9.2 Listagem dos bots do tenant
    const resBots = await (await fetch(`${baseUrl}/api/tenant/bots`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resBots.success);
    assert(resBots.bots.some(b => b.id === botId));
    console.log('✅ [PASS] GET /api/tenant/bots (Listagem de bots isolados com status real-time)');

    // 7.9.3 Consulta de status de QRCode / Conexão
    const resQr = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/qr`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resQr.success);
    assert.strictEqual(resQr.id, botId);
    console.log('✅ [PASS] GET /api/tenant/bots/:id/qr (Status de conexão e QR Code)');

    // 7.9.4 Geração de Código de Pareamento de 8 dígitos (Pair Code)
    const resPair = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/pairing-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`
      },
      body: JSON.stringify({ phone: '5511988887766' })
    })).json();
    assert(resPair.success, 'Deve gerar paircode');
    assert(resPair.pairingCode, 'Deve retornar código de pareamento');
    assert(resPair.pairingCode.length >= 8, 'Código deve conter 8 dígitos formatados');
    console.log(`✅ [PASS] POST /api/tenant/bots/:id/pairing-code (Código de pareamento gerado: ${resPair.pairingCode})`);

    // 7.9.5 Consulta de configurações de IA da conexão do Bot
    const resAiGet = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/ai`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resAiGet.success, 'Deve retornar configurações de IA');
    assert.strictEqual(resAiGet.ai.ai_provider, 'auto');
    assert(Array.isArray(resAiGet.availableProviders), 'Deve listar provedores suportados');
    console.log('✅ [PASS] GET /api/tenant/bots/:id/ai (Retorna configuração atual e catálogo de provedores)');

    // 7.9.6 Atualização da IA: Escolha de Provedor, Modelo e Instrução Customizada
    const customPrompt = 'Você é a consultora Carol da Tech Alpha. Atenda com tom consultivo, emojis estratégicos e foco no fechamento.';
    const resAiSave = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`
      },
      body: JSON.stringify({
        ai_provider: 'gemini',
        ai_model: 'gemini-2.0-flash',
        ai_instruction: customPrompt,
        ai_enabled: true
      })
    })).json();
    assert(resAiSave.success, 'Deve salvar configurações de IA');
    assert.strictEqual(resAiSave.ai.ai_provider, 'gemini');
    assert.strictEqual(resAiSave.ai.ai_model, 'gemini-2.0-flash');
    assert.strictEqual(resAiSave.ai.ai_instruction, customPrompt);
    console.log('✅ [PASS] POST /api/tenant/bots/:id/ai (Configurado provedor Gemini, modelo e prompt customizado)');

    // 7.9.7 Teste do Chatbot com IA em Tempo Real
    try {
      const resAiTest = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/ai/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tenantToken}`
        },
        body: JSON.stringify({
          message: 'Olá, quais são os diferenciais do serviço?',
          ai_provider: 'gemini',
          ai_instruction: customPrompt
        })
      })).json();
      if (resAiTest.success) {
        console.log(`✅ [PASS] POST /api/tenant/bots/:id/ai/test (Resposta IA [${resAiTest.provider}/${resAiTest.model}]: ${resAiTest.reply.slice(0, 60)}...)`);
      } else {
        console.log(`ℹ️ [INFO] POST /api/tenant/bots/:id/ai/test (IA retornou aviso/erro controlado: ${resAiTest.error})`);
      }
    } catch (e) {
      console.log('ℹ️ [INFO] Teste de IA online pulado ou sem conexão externa:', e.message);
    }

    // 7.9.8 Configurações Rápidas do Tenant (GET e POST /api/tenant/settings)
    const resGetSettings = await (await fetch(`${baseUrl}/api/tenant/settings`, {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resGetSettings.success, 'Deve retornar configurações rápidas do tenant');
    assert(resGetSettings.profile && resGetSettings.profile.name);
    assert(Array.isArray(resGetSettings.availableProviders));
    console.log('✅ [PASS] GET /api/tenant/settings (Consulta de perfil e configurações rápidas)');

    const resSaveSettings = await (await fetch(`${baseUrl}/api/tenant/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tenantToken}`
      },
      body: JSON.stringify({
        profile: {
          name: 'Tech Alpha Prime Soluções',
          owner_name: 'Evandro Alpha',
          owner_phone: '5548991646799',
          owner_email: 'contato@techalphaprime.com',
          custom_domain: 'loja.techalpha.com'
        },
        settings: {
          auto_reply_enabled: true,
          bot_name: 'Carol Alpha',
          support_contact: '5548991646799',
          welcome_message: 'Olá! Seja bem-vindo à Tech Alpha Prime.',
          pix_key: '5548991646799',
          pix_key_type: 'phone',
          pix_holder_name: 'Evandro Alpha',
          pix_expiration_min: 20,
          notify_on_sale: true,
          abandoned_cart_enabled: true,
          abandoned_cart_delay_min: 15,
          abandoned_cart_msg: 'Olá {nome}, seu pedido para {produto} aguarda pagamento!',
          default_ai_provider: 'gemini',
          default_ai_model: 'gemini-2.0-flash',
          default_ai_instruction: 'Você é a consultora comercial sênior da Tech Alpha Prime.'
        },
        sync_bots_ai: true
      })
    })).json();
    assert(resSaveSettings.success, 'Deve salvar configurações rápidas com sucesso');
    assert.strictEqual(resSaveSettings.profile.name, 'Tech Alpha Prime Soluções');
    assert.strictEqual(resSaveSettings.settings.pix_key, '5548991646799');
    assert.strictEqual(resSaveSettings.settings.default_ai_provider, 'gemini');

    // Valida que a sincronização da IA alcançou o bot
    const botAfterSync = models.getArmyInstanceById(botId);
    assert.strictEqual(botAfterSync.ai_provider, 'gemini');
    assert.strictEqual(botAfterSync.ai_instruction, 'Você é a consultora comercial sênior da Tech Alpha Prime.');
    console.log('✅ [PASS] POST /api/tenant/settings (Configurações salvas e IA sincronizada com bots)');

    // 7.9.9 Loja Web Exclusiva do Tenant & Integração de Upsell no WhatsApp
    // Consulta produtos da vitrine virtual isolada do tenant
    const resStoreProds = await (await fetch(`${baseUrl}/api/store/products?tenant=${tenant1.slug}`)).json();
    assert(resStoreProds.success, 'Deve carregar catálogo da loja web do tenant');
    assert(resStoreProds.tenant && resStoreProds.tenant.slug === tenant1.slug, 'Deve retornar dados exclusivos do tenant');
    assert.strictEqual(resStoreProds.tenant.name, 'Tech Alpha Prime Soluções');
    assert(resStoreProds.products.length >= 1, 'Deve conter produtos do catálogo do tenant');
    assert.strictEqual(resStoreProds.products[0].tenant_id, tenant1.id, 'Produtos devem pertencer ao tenant');
    console.log(`✅ [PASS] GET /api/store/products?tenant=${tenant1.slug} (Vitrine web isolada do Tenant com ${resStoreProds.products.length} produtos e upsell WhatsApp)`);

    // Checkout na Loja Web do Tenant com atribuição de tenant_id
    const resStoreCheckout = await (await fetch(`${baseUrl}/api/store/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: resNewProd.product.id, quantity: 1 }],
        customer: { name: 'Cliente Upsell Web', phone: '5511999998888' },
        gateway: 'pix',
        tenant: tenant1.slug
      })
    })).json();
    assert(resStoreCheckout.success, 'Deve gerar pedido na loja do tenant');
    assert(resStoreCheckout.tradeNo, 'Deve retornar tradeNo');
    const createdWebOrder = models.getOrderByTradeNo(resStoreCheckout.tradeNo);
    assert(createdWebOrder, 'Pedido deve existir no banco');
    assert.strictEqual(createdWebOrder.tenant_id, tenant1.id, 'Pedido na loja web deve ser atribuído ao tenant');
    console.log(`✅ [PASS] POST /api/store/checkout (Pedido ${resStoreCheckout.tradeNo} atribuído com sucesso ao tenant ${tenant1.id})`);

    // 7.9.10 Reset de Sessão do Bot
    const resReset = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}/reset`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resReset.success, 'Deve resetar sessão do bot com sucesso');
    console.log('✅ [PASS] POST /api/tenant/bots/:id/reset (Reset de sessão e credenciais)');

    // 7.9.11 Exclusão do Bot
    const resDelBot = await (await fetch(`${baseUrl}/api/tenant/bots/${botId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    })).json();
    assert(resDelBot.success, 'Deve excluir bot com sucesso');
    console.log('✅ [PASS] DELETE /api/tenant/bots/:id (Remoção do bot do tenant)');
  } finally {
    testServer.close();
  }

  // 8. Limpeza do tenant de teste
  models.deleteTenant(tenant1.id);
  assert.strictEqual(models.getTenantById(tenant1.id), null);
  console.log('✅ [PASS] models.deleteTenant (Limpeza de tenant e logs)');

  console.log('\n🎉 TODOS OS TESTES DA PLATAFORMA SAAS & LICENÇAS PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ Teste de SaaS falhou:', err);
  process.exit(1);
});

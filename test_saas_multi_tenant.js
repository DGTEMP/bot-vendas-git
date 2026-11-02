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
  } finally {
    testServer.close();
  }

  // 8. Limpeza do tenant de teste
  models.deleteTenant(tenant1.id);
  assert.strictEqual(models.getTenantById(tenant1.id), null);
  console.log('✅ [PASS] models.deleteTenant (Limpeza de tenant e logs)');

  console.log('\n🎉 TODOS OS TESTES DA PLATAFORMA SAAS & LICENÇAS PASSARAM COM 100% DE SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Teste de SaaS falhou:', err);
  process.exit(1);
});

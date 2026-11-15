const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const nicheService = require('./src/services/nicheModularService');
const db = require('./src/db/database');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🚀 TEST SUITE: SAAS MULTI-TENANT MODULAR & 15 NICHES ONBOARDING');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // GRUPO 1: Validação dos 15 Nichos & 3 Níveis de Tom (45 personas)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 1: Catálogo dos 15 Nichos & 3 Níveis de Tom (45 Combinações) ---');

  const EXPECTED_NICHES = [
    'advogados',
    'vendedores',
    'nailsdesigns',
    'leshes',
    'marmitas',
    'pizzas',
    'lanches',
    'sushi',
    'arena_esportiva',
    'academia',
    'corretor_imoveis',
    'consorcio',
    'carros',
    'alugueis',
    'hospedagens'
  ];

  const EXPECTED_TONES = ['formal', 'consultivo', 'comercial'];

  test('Todos os 15 nichos solicitados pelo usuário estão registrados', () => {
    const allNiches = nicheService.getAllNiches();
    assert.strictEqual(allNiches.length, 15, `Esperados 15 nichos, encontrados ${allNiches.length}`);

    const keys = allNiches.map(n => n.key);
    for (const expectedKey of EXPECTED_NICHES) {
      assert(keys.includes(expectedKey), `Nicho ausente: ${expectedKey}`);
    }
  });

  test('Todos os 15 nichos possuem layout, cores, banner, selo e pelo menos 3 produtos modelo', () => {
    for (const key of EXPECTED_NICHES) {
      const niche = nicheService.getNiche(key);
      assert(niche, `Nicho ${key} não encontrado`);
      assert(niche.name, `Nicho ${key} sem nome`);
      assert(niche.color_primary, `Nicho ${key} sem color_primary`);
      assert(niche.color_accent, `Nicho ${key} sem color_accent`);
      assert(niche.banner_headline, `Nicho ${key} sem banner_headline`);
      assert(niche.badge_text, `Nicho ${key} sem badge_text`);
      assert(niche.hero_cta, `Nicho ${key} sem hero_cta`);
      assert(Array.isArray(niche.sample_products), `Nicho ${key} sem sample_products`);
      assert(niche.sample_products.length >= 3, `Nicho ${key} deve ter pelo menos 3 produtos de exemplo`);
    }
  });

  test('Todas as 45 variações (15 nichos × 3 tons) possuem scripts completos e diretivas neurais', () => {
    let variationsCount = 0;
    for (const nicheKey of EXPECTED_NICHES) {
      for (const toneKey of EXPECTED_TONES) {
        const toneData = nicheService.getNicheTone(nicheKey, toneKey);
        assert(toneData, `Tone ${toneKey} ausente no nicho ${nicheKey}`);
        assert(toneData.system_prompt, `Tone ${toneKey} do nicho ${nicheKey} sem system_prompt`);
        assert(toneData.welcome_template, `Tone ${toneKey} do nicho ${nicheKey} sem welcome_template`);
        assert(toneData.qualification_question, `Tone ${toneKey} do nicho ${nicheKey} sem qualification_question`);
        assert(toneData.objection_handler, `Tone ${toneKey} do nicho ${nicheKey} sem objection_handler`);
        assert(toneData.voice_ptt_script, `Tone ${toneKey} do nicho ${nicheKey} sem voice_ptt_script`);

        const directive = nicheService.buildNichePromptDirective(nicheKey, toneKey, {
          businessName: 'Teste Corp',
          customerName: 'Cliente Teste'
        });
        assert(directive.includes('DIRETRIZ') && directive.includes('NICHO'), `Diretiva do nicho ${nicheKey} incompleta`);
        variationsCount++;
      }
    }
    assert.strictEqual(variationsCount, 45, `Esperadas 45 personas completas, validadas ${variationsCount}`);
  });

  // -------------------------------------------------------------
  // GRUPO 2: Banco de Dados e Modelos Multi-Tenant
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 2: Migração e Modelos do Banco de Dados ---');

  let testTenantId = null;
  const testTenantSlug = `test-niche-${Date.now()}`;

  test('Model createTenant suporta niche, interaction_tone e onboarding_completed', () => {
    const created = models.createTenant({
      name: 'Escritório Jurídico Modelo',
      slug: testTenantSlug,
      plan: 'pro',
      niche: 'advogados',
      interaction_tone: 'formal',
      onboarding_completed: 0,
      onboarding_data: { step: 1 }
    });
    assert(created && created.id, 'Falha ao criar tenant');
    testTenantId = created.id;

    const fetched = models.getTenantById(testTenantId);
    assert.strictEqual(fetched.niche, 'advogados');
    assert.strictEqual(fetched.interaction_tone, 'formal');
    assert.strictEqual(fetched.onboarding_completed, 0);
  });

  test('Model updateTenant permite alterar niche, tom e status de onboarding', () => {
    models.updateTenant(testTenantId, {
      niche: 'pizzas',
      interaction_tone: 'comercial',
      onboarding_completed: 1
    });

    const updated = models.getTenantById(testTenantId);
    assert.strictEqual(updated.niche, 'pizzas');
    assert.strictEqual(updated.interaction_tone, 'comercial');
    assert.strictEqual(updated.onboarding_completed, 1);
  });

  // -------------------------------------------------------------
  // GRUPO 3: Inicialização do Servidor & Rotas HTTP
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 3: API REST do SaaS e Onboarding ---');

  let server;
  let port;
  let baseUrl;
  let tenantToken;

  await testAsync('Servidor HTTP iniciado com rotas SaaS e Onboarding', async () => {
    await new Promise((resolve) => {
      const expressApp = createServer();
      server = expressApp.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const session = models.createTenantSession(testTenantId);
    tenantToken = session.token;
    assert(tenantToken, 'Token de sessão do tenant deve ser gerado');
  });

  async function requestJson(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(urlPath, baseUrl);
      const reqOpts = {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      };

      const req = http.request(fullUrl, reqOpts, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  await testAsync('GET /api/saas/niches retorna listagem completa com 15 nichos', async () => {
    const res = await requestJson('/api/saas/niches');
    assert.strictEqual(res.status, 200);
    assert(res.body.success);
    assert.strictEqual(res.body.niches.length, 15);
  });

  await testAsync('GET /api/saas/niches/:nicheKey retorna detalhes de um nicho específico', async () => {
    const res = await requestJson('/api/saas/niches/sushi');
    assert.strictEqual(res.status, 200);
    assert(res.body.success);
    assert.strictEqual(res.body.niche.key, 'sushi');
    assert(res.body.niche.sample_products.length > 0);
  });

  await testAsync('POST /api/tenant/onboarding aplica onboarding com catálogo e tema', async () => {
    const res = await requestJson('/api/tenant/onboarding', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tenantToken}` },
      body: {
        niche: 'sushi',
        interaction_tone: 'consultivo',
        populate_catalog: true
      }
    });

    assert.strictEqual(res.status, 200);
    assert(res.body.success);
    assert.strictEqual(res.body.niche, 'sushi');
    assert.strictEqual(res.body.interaction_tone, 'consultivo');
    assert.strictEqual(res.body.onboarding_completed, 1);
    assert(res.body.sample_products_created > 0, 'Produtos modelo de sushi devem ser criados');
  });

  await testAsync('GET /api/tenant/niche-config retorna estado atual do nicho', async () => {
    const res = await requestJson('/api/tenant/niche-config', {
      headers: { 'Authorization': `Bearer ${tenantToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert(res.body.success);
    assert.strictEqual(res.body.niche, 'sushi');
    assert.strictEqual(res.body.interaction_tone, 'consultivo');
    assert.strictEqual(res.body.onboarding_completed, 1);
  });

  await testAsync('GET /api/store/products?tenant=<slug> retorna produtos isolados e tema visual do nicho', async () => {
    const res = await requestJson(`/api/store/products?tenant=${testTenantSlug}`);
    assert.strictEqual(res.status, 200);
    assert(res.body.success);
    assert(Array.isArray(res.body.products));
    assert(res.body.products.length > 0, 'Loja deve ter produtos do catálogo sushi');
    assert(res.body.tenant, 'Dados do tenant devem acompanhar o retorno');
    assert.strictEqual(res.body.tenant.niche, 'sushi');
    assert(res.body.tenant.color_primary, 'Loja deve ter cor primária');
    assert(res.body.tenant.banner_headline, 'Loja deve ter headline do nicho');
  });

  await testAsync('Criação de Tenant via Super Admin SaaS auto-aplica Onboarding e Catálogo', async () => {
    const autoTenantSlug = `auto-tenant-${Date.now()}`;

    const res = await requestJson('/api/saas/tenants', {
      method: 'POST',
      body: {
        name: 'Clube Beach Tennis Prime',
        slug: autoTenantSlug,
        plan: 'pro',
        niche: 'arena_esportiva',
        interaction_tone: 'comercial',
        populate_catalog: true,
        apply_onboarding: true
      }
    });

    assert.ok(res.status === 200 || res.status === 201, `Status esperado 200 ou 201, recebido ${res.status}`);
    assert(res.body.success);
    assert.strictEqual(res.body.tenant.niche, 'arena_esportiva');
    assert.strictEqual(res.body.tenant.interaction_tone, 'comercial');

    // Verifica loja do novo tenant
    const storeRes = await requestJson(`/api/store/products?tenant=${autoTenantSlug}`);
    assert.strictEqual(storeRes.status, 200);
    assert(storeRes.body.products.length >= 3, 'Arena esportiva deve ter produtos criados');
    assert(storeRes.body.tenant.banner_headline.toLowerCase().includes('arena') || storeRes.body.tenant.banner_headline.toLowerCase().includes('quadra') || storeRes.body.tenant.banner_headline.toLowerCase().includes('esporte'));
  });

  // -------------------------------------------------------------
  // GRUPO 4: Integração com a IA Cognitiva (Prompts Dinâmicos)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 4: IA Cognitiva com Persona Modular ---');

  test('CognitiveSalesService injeta a persona correta do nicho de advogados', () => {
    const directiveLawyer = nicheService.buildNichePromptDirective('advogados', 'formal', {
      businessName: 'Silva & Associados',
      customerName: 'Roberto'
    });
    assert(directiveLawyer.includes('OAB'), 'Diretiva de advogados deve referenciar ética/OAB');
    assert(directiveLawyer.toLowerCase().includes('formal'), 'Diretiva de advogados deve adotar tom formal');
  });

  test('CognitiveSalesService injeta a persona correta do nicho de lanches em tom comercial', () => {
    const directiveBurger = nicheService.buildNichePromptDirective('lanches', 'comercial', {
      businessName: 'Burger Master',
      customerName: 'Ana'
    });
    assert(directiveBurger.toLowerCase().includes('hamburgueria') || directiveBurger.toLowerCase().includes('lanches'), 'Diretiva deve referenciar lanches');
    assert(directiveBurger.toLowerCase().includes('delivery') || directiveBurger.toLowerCase().includes('combo') || directiveBurger.toLowerCase().includes('pix'), 'Diretiva deve ser comercial');
  });

  // -------------------------------------------------------------
  // GRUPO 5: Validação dos Arquivos Frontend
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 5: Validação do Painel Web & Loja Pública ---');

  test('src/public/tenant_dashboard.html contém aba, modal wizard, banner e funções de nicho', () => {
    const tenantHtml = fs.readFileSync(path.join(__dirname, 'src', 'public', 'tenant_dashboard.html'), 'utf8');
    assert(tenantHtml.includes("switchTab('nicheSetup')"), 'tenant_dashboard.html deve ter botão da aba nicheSetup');
    assert(tenantHtml.includes('id="tabNicheSetup"'), 'tenant_dashboard.html deve ter div id tabNicheSetup');
    assert(tenantHtml.includes('id="onboardingBanner"'), 'tenant_dashboard.html deve ter banner de onboarding');
    assert(tenantHtml.includes('id="modalOnboardingWizard"'), 'tenant_dashboard.html deve ter modal do wizard de onboarding');
    assert(tenantHtml.includes('loadNicheSetup()'), 'tenant_dashboard.html deve ter chamada loadNicheSetup');
    assert(tenantHtml.includes('submitOnboardingWizard()'), 'tenant_dashboard.html deve ter função submitOnboardingWizard');
  });

  test('src/public/store.html suporta temas dinâmicos por nicho', () => {
    const storeHtml = fs.readFileSync(path.join(__dirname, 'src', 'public', 'store.html'), 'utf8');
    assert(storeHtml.includes('--primary'), 'store.html deve manipular variáveis de cor');
    assert(storeHtml.includes('color_primary'), 'store.html deve aplicar color_primary do tenant');
    assert(storeHtml.includes('banner_headline'), 'store.html deve atualizar a headline pelo nicho');
  });

  test('src/public/index.html & app.js possuem seletor de nicho e tom para criação de tenants', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'src', 'public', 'index.html'), 'utf8');
    assert(indexHtml.includes('id="tenantNewNiche"'), 'index.html deve conter select tenantNewNiche com os 15 nichos');
    assert(indexHtml.includes('id="tenantNewTone"'), 'index.html deve conter select tenantNewTone');
    assert(indexHtml.includes('value="advogados"'), 'index.html deve ter nicho advogados');
    assert(indexHtml.includes('value="hospedagens"'), 'index.html deve ter nicho hospedagens');
  });

  if (server) {
    server.close();
  }

  console.log('\n===============================================================');
  console.log(`🎉 TODOS OS TESTES PASSARAM COM SUCESSO! (${passedTests}/${totalTests})`);
  console.log('===============================================================');
}

runTestSuite().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});

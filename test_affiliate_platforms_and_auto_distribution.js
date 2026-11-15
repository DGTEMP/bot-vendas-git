const http = require('http');
const assert = require('assert');
const { createServer } = require('./src/server/app');
const models = require('./src/db/models');

async function runTests() {
  console.log('🧪 Iniciando testes de Contas de Afiliados Multi-Plataforma & Auto-Afiliação...');

  const app = createServer();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`  ✓ Servidor de teste ouvindo em ${baseUrl}`);

  try {
    // 1. Testa listagem inicial e definições de plataformas
    const resDefs = await fetch(`${baseUrl}/api/affiliate-platforms/accounts`);
    const dataDefs = await resDefs.json();
    assert.strictEqual(dataDefs.success, true);
    assert.ok(dataDefs.definitions.mercadolivre, 'Deve conter definição Mercado Livre');
    assert.ok(dataDefs.definitions.shopee, 'Deve conter definição Shopee');
    assert.ok(dataDefs.definitions.braip, 'Deve conter definição Braip');
    assert.ok(dataDefs.definitions.shein, 'Deve conter definição Shein');
    assert.ok(dataDefs.definitions.hotmart, 'Deve conter definição Hotmart');
    assert.ok(dataDefs.definitions.kiwify, 'Deve conter definição Kiwify');
    console.log('  ✅ 1. Definições de todas as plataformas parceiras validadas.');

    // 2. Cadastra contas nas 6 plataformas solicitadas pelo usuário
    const platformsToRegister = [
      { platform: 'mercadolivre', account_name: 'ML Pro Principal', affiliate_id: 'ML_98765', tracking_tag: 'sec_ml_top_123' },
      { platform: 'shopee', account_name: 'Shopee Afiliados Loja', affiliate_id: 'SHP_456', tracking_tag: 'shope_tag_01' },
      { platform: 'braip', account_name: 'Braip Físicos & Cápsulas', affiliate_id: 'BR_777', tracking_tag: 'af_braip_super_99' },
      { platform: 'shein', account_name: 'Shein Moda & Acessórios', affiliate_id: 'SHN_PUB_88', tracking_tag: 'shein_ref_vip' },
      { platform: 'hotmart', account_name: 'Hotmart Cursos & Ebooks', affiliate_id: 'HT_HOT_11', tracking_tag: 'HOT_A998877Z' },
      { platform: 'kiwify', account_name: 'Kiwify Mentoria & SaaS', affiliate_id: 'KIW_55', tracking_tag: 'kiwi_af_master' }
    ];

    for (const acc of platformsToRegister) {
      const resAcc = await fetch(`${baseUrl}/api/affiliate-platforms/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acc)
      });
      const dataAcc = await resAcc.json();
      assert.strictEqual(dataAcc.success, true);
      assert.strictEqual(dataAcc.account.platform, acc.platform);
    }
    console.log(`  ✅ 2. Contas cadastradas com sucesso para as 6 plataformas.`);

    // 3. Testa Auto-Afiliação de produto do Mercado Livre
    const resML = await fetch(`${baseUrl}/api/affiliate-platforms/auto-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: 'https://produto.mercadolivre.com.br/MLB-456789-fone-bluetooth-lenovo-lp40-pro-tws',
        title: 'Fone Bluetooth Lenovo LP40 Pro TWS',
        price: 89.90,
        commission: 12,
        autoDistribute: true,
        flows: ['social_listening', 'whatsapp_army', 'viral_radar']
      })
    });
    const dataML = await resML.json();
    assert.strictEqual(dataML.success, true);
    assert.ok(dataML.generatedUrl.includes('mercadolivre.com'), 'Link gerado deve ser do Mercado Livre');
    assert.ok(dataML.generatedUrl.includes('sec_ml_top_123') || dataML.generatedUrl.includes('ml_top_123'), 'Deve conter tag da conta cadastrada');
    assert.ok(dataML.distribution.socialListeningRule, 'Deve criar regra de escuta social');
    assert.ok(dataML.distribution.armyCampaign, 'Deve criar campanha no exército WhatsApp');
    assert.ok(dataML.keywords.includes('bluetooth') || dataML.keywords.includes('fone'), 'Deve extrair palavras-chave');
    console.log(`  ✅ 3. Auto-Afiliação Mercado Livre OK | Link: ${dataML.generatedUrl}`);
    console.log(`     • Escuta Social Regra ID #${dataML.distribution.socialListeningRule.id} criada`);
    console.log(`     • Campanha WhatsApp Exército ID #${dataML.distribution.armyCampaign.id} criada`);

    // 4. Testa Auto-Afiliação de produto da Shopee
    const resShopee = await fetch(`${baseUrl}/api/affiliate-platforms/auto-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: 'https://shopee.com.br/product/987654/12345678',
        title: 'Chapinha Prancha Alisadora Nano Titanium',
        price: 149.00,
        commission: 10,
        autoDistribute: true,
        flows: ['social_listening', 'whatsapp_army']
      })
    });
    const dataShopee = await resShopee.json();
    assert.strictEqual(dataShopee.success, true);
    assert.ok(dataShopee.generatedUrl.includes('shopee.com') || dataShopee.generatedUrl.includes('shope.ee'));
    assert.ok(dataShopee.generatedUrl.includes('shope_tag_01'), 'Deve injetar tag de afiliado da Shopee');
    console.log(`  ✅ 4. Auto-Afiliação Shopee OK | Link: ${dataShopee.generatedUrl}`);

    // 5. Testa Auto-Afiliação de produto da Braip
    const resBraip = await fetch(`${baseUrl}/api/affiliate-platforms/auto-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: 'https://ev.braip.com/ref/bra999888',
        title: 'Cápsulas Suplemento Termogênico 60 Caps',
        price: 197.00,
        commission: 50,
        autoDistribute: true,
        flows: ['social_listening', 'whatsapp_army']
      })
    });
    const dataBraip = await resBraip.json();
    assert.strictEqual(dataBraip.success, true);
    assert.ok(dataBraip.generatedUrl.includes('af_braip_super_99'), 'Deve injetar código af da Braip');
    console.log(`  ✅ 5. Auto-Afiliação Braip OK | Link: ${dataBraip.generatedUrl}`);

    // 6. Testa Auto-Afiliação de produto da Kiwify
    const resKiwify = await fetch(`${baseUrl}/api/affiliate-platforms/auto-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: 'https://kiwify.app/checkout/curso-marketing-digital',
        title: 'Método Vendas Automáticas 24/7',
        price: 297.00,
        commission: 60,
        autoDistribute: true,
        flows: ['social_listening', 'whatsapp_army']
      })
    });
    const dataKiwify = await resKiwify.json();
    assert.strictEqual(dataKiwify.success, true);
    assert.ok(dataKiwify.generatedUrl.includes('kiwi_af_master'), 'Deve injetar código af da Kiwify');
    console.log(`  ✅ 6. Auto-Afiliação Kiwify OK | Link: ${dataKiwify.generatedUrl}`);

    // 7. Testa Auto-Afiliação de produto da Shein
    const resShein = await fetch(`${baseUrl}/api/affiliate-platforms/auto-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productUrl: 'https://br.shein.com/Vestido-Feminino-Casual-Verao-p-12345.html',
        title: 'Vestido Feminino Casual Verão',
        price: 79.90,
        commission: 15,
        autoDistribute: true,
        flows: ['social_listening']
      })
    });
    const dataShein = await resShein.json();
    assert.strictEqual(dataShein.success, true);
    assert.ok(dataShein.generatedUrl.includes('shein_ref_vip') || dataShein.generatedUrl.includes('SHN_PUB_88'), 'Deve injetar tag Shein');
    console.log(`  ✅ 7. Auto-Afiliação Shein OK | Link: ${dataShein.generatedUrl}`);

    // 8. Testa distribuição posterior de link existente
    const allLinks = models.getAffiliateLinks();
    const targetLink = allLinks[0];
    const resDist = await fetch(`${baseUrl}/api/affiliate-platforms/distribute-link/${targetLink.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flows: ['social_listening', 'whatsapp_army'],
        leads: [{ phone: '5511999998888', name: 'Lead Teste' }]
      })
    });
    const dataDist = await resDist.json();
    assert.strictEqual(dataDist.success, true);
    console.log(`  ✅ 8. Distribuição avulsa pro fluxo OK para o link #${targetLink.id}.`);

    console.log('\n🎉 TODOS OS TESTES DE PLATAFORMAS DE AFILIADO & FLUXO PASSARAM COM SUCESSO TOTAL!');
  } finally {
    server.close();
  }
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Falha:', err);
  process.exit(1);
});

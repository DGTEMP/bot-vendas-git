/**
 * Testes de Preservação Total de Links Manuais e Adicionados em Massa
 *
 * Valida:
 * 1. Links manuais/em massa NUNCA são alterados ou desencurtados pelo bot.
 * 2. Links do usuário são ativados com active=1 imediatamente.
 * 3. bulkImportAffiliateLinks processa listas e multilinhas mantendo as URLs originais intactas.
 * 4. parseAndAddDealFromText (!add) preserva o link 100% como digitado pelo usuário.
 */

const assert = require('assert');
const aps = require('../src/services/affiliatePlatformService');
const achadinhosService = require('../src/services/achadinhosService');
const models = require('../src/db/models');
const db = require('../src/db/database');

async function runTests() {
  console.log('🧪 [TESTES] Iniciando validação de Preservação de Links Manuais e em Massa...\n');

  // ==========================================
  // Teste 1: Adição Manual Individual via autoAffiliateProduct
  // ==========================================
  console.log('--- Teste 1: Adição Manual Individual com isManual: true ---');
  const myShopeeShortLink = 'https://s.shopee.com.br/meu-link-encurtado-oficial-123';
  const res1 = await aps.autoAffiliateProduct({
    productUrl: myShopeeShortLink,
    title: 'Meu Fone de Ouvido Oficial Shopee',
    price: 79.90,
    original_price: 159.90,
    isManual: true,
    preserveUrl: true,
    source: 'manual'
  });

  assert.strictEqual(res1.link.affiliate_url, myShopeeShortLink, 'A URL do afiliado deve ser IDÊNTICA à fornecida pelo usuário');
  assert.strictEqual(res1.link.active, 1, 'Links manuais do usuário devem ser ativados imediatamente (active = 1)');
  assert.strictEqual(res1.link.source, 'manual', 'O source deve ser registrado como manual');
  console.log(`✅ Link manual preservado 100% intacto: ${res1.link.affiliate_url} (active=${res1.link.active})`);

  // ==========================================
  // Teste 2: Link com ID Oficial do Usuário Já Embutido
  // ==========================================
  console.log('\n--- Teste 2: Detecção Proativa de Link Próprio (ID 18168880000) ---');
  const myDirectShopeeUrl = 'https://shopee.com.br/produto-especifico?aff_id=18168880000&minha_tag=campanha_vip';
  const res2 = await aps.autoAffiliateProduct({
    productUrl: myDirectShopeeUrl,
    title: 'Produto com ID do Usuário Pré-existente'
  });

  assert.strictEqual(res2.link.affiliate_url, myDirectShopeeUrl, 'URL que já tem o ID do usuário não deve ser modificada');
  assert.strictEqual(res2.link.active, 1, 'Produto deve estar ativo para postar imediatamente');
  console.log(`✅ Link próprio detectado e preservado: ${res2.link.affiliate_url}`);

  // ==========================================
  // Teste 3: Importação em Massa via Texto Multilinhas
  // ==========================================
  console.log('\n--- Teste 3: bulkImportAffiliateLinks com Múltiplas Linhas ---');
  const bulkText = `
    https://s.shopee.com.br/shopee-meu-link-01 Teclado Gamer RGB | 199.90 | 99.90 | GAMER10
    https://meli.la/meli-meu-link-02 Cadeira Ergonomica | 800.00 | 499.00
    https://amzn.to/meu-link-amazon-03 Kindle Paperwhite 16GB | 600.00 | 450.00
  `;

  const bulkRes = await aps.bulkImportAffiliateLinks(bulkText);
  assert.strictEqual(bulkRes.success, true);
  assert.strictEqual(bulkRes.importedCount, 3, 'Deve importar exatamente os 3 produtos');

  // Verifica que cada um dos 3 foi salvo intacto
  const urlsImportadas = bulkRes.links.map(l => l.affiliate_url);
  assert(urlsImportadas.includes('https://s.shopee.com.br/shopee-meu-link-01'), 'Link Shopee curto deve estar intacto');
  assert(urlsImportadas.includes('https://meli.la/meli-meu-link-02'), 'Link Mercado Livre curto deve estar intacto');
  assert(urlsImportadas.includes('https://amzn.to/meu-link-amazon-03'), 'Link Amazon curto deve estar intacto');

  bulkRes.links.forEach(l => {
    assert.strictEqual(l.active, 1, `Produto #${l.id} importado em massa deve ter active=1`);
    assert.strictEqual(l.source, 'bulk_import', `Produto #${l.id} deve ter source=bulk_import`);
  });
  console.log(`✅ ${bulkRes.importedCount} produtos importados em massa com sucesso e 100% dos links preservados!`);

  // ==========================================
  // Teste 4: Comando !add (parseAndAddDealFromText)
  // ==========================================
  console.log('\n--- Teste 4: Comando WhatsApp !add com Link Curto do Dono ---');
  const myCustomShortCmd = 'https://s.shopee.com.br/link-do-meu-app Smartwatch T800 Ultra | 120.00 | 49.90 | CUPOMTOP';
  const dealFromCmd = achadinhosService.parseAndAddDealFromText(myCustomShortCmd);

  assert.strictEqual(dealFromCmd.affiliate_url, 'https://s.shopee.com.br/link-do-meu-app', 'O link não pode sofrer alteração ao usar !add');
  assert.strictEqual(dealFromCmd.active, 1, 'Oferta adicionada pelo Dono deve estar ativa imediatamente');
  assert.strictEqual(dealFromCmd.source, 'manual', 'O source deve ser manual');
  console.log(`✅ Comando !add preservou link do Dono: ${dealFromCmd.affiliate_url} (active=${dealFromCmd.active})`);

  console.log('\n🎉 TODOS OS TESTES DE PRESERVAÇÃO DE LINKS PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

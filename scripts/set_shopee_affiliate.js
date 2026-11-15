const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const db = require(path.resolve(__dirname, '../src/db/database'));
const models = require(path.resolve(__dirname, '../src/db/models'));

console.log('🚀 [Configuração Shopee] Gravando ID de Afiliado 18168880000 no banco de dados...');

const res = db.prepare(`
  UPDATE affiliate_platform_accounts
  SET affiliate_id = '18168880000',
      account_name = 'Shopee Afiliados Oficial',
      tracking_tag = 'promo',
      active = 1,
      updated_at = datetime('now')
  WHERE platform = 'shopee'
`).run();

console.log(`✅ ${res.changes} registro(s) da Shopee atualizado(s).`);

const activeShopee = models.getAffiliatePlatformAccountByPlatform('shopee');
console.log('Conta Shopee Ativa no Sistema:');
console.log(activeShopee);

// Testar geração de link real da Shopee com o novo ID
const affiliatePlatformService = require(path.resolve(__dirname, '../src/services/affiliatePlatformService'));
const testUrl = 'https://shopee.com.br/Kit-5-Camisetas-Masculinas-Algodao-Premium-p-123456';
const generatedLink = affiliatePlatformService.buildAffiliateUrl({
  productUrl: testUrl,
  platform: 'shopee',
  account: activeShopee
});

console.log('\n🔗 Teste de conversão de link Shopee:');
console.log('URL Original: ', testUrl);
console.log('Link Gerado:   ', generatedLink);

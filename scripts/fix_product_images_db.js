/**
 * Script de Migração: Saneamento e Correção de Imagens de Capa
 *
 * Atualiza todos os produtos e links de afiliados no banco de dados que estavam com
 * imagens genéricas (logos 180x180, cubos 3D abstratos, fluidos roxos) para imagens
 * reais de alta definição (800x800+) condizentes com os títulos e categorias.
 */

const db = require('../src/db/database');
const models = require('../src/db/models');
const { resolveProductImage, isGenericOrBadImage } = require('../src/utils/productImageResolver');

console.log('🚀 Iniciando saneamento de imagens de capa da Loja Web e Links de Afiliados...');

// 1. Saneamento na tabela `products`
const products = db.prepare('SELECT id, name, category, image_url FROM products').all();
let updatedProducts = 0;

const updateProductStmt = db.prepare('UPDATE products SET image_url = ? WHERE id = ?');

for (const prod of products) {
  if (isGenericOrBadImage(prod.image_url)) {
    const newImage = resolveProductImage(prod.name, prod.category);
    updateProductStmt.run(newImage, prod.id);
    updatedProducts++;
    console.log(`[PRODUTO #${prod.id}] "${prod.name}" (${prod.category})`);
    console.log(`   DE:   ${prod.image_url}`);
    console.log(`   PARA: ${newImage}`);
  }
}

// 2. Saneamento na tabela `affiliate_links`
const affiliateLinks = db.prepare('SELECT id, title, platform, image_url FROM affiliate_links').all();
let updatedAffiliates = 0;

const updateAffiliateStmt = db.prepare('UPDATE affiliate_links SET image_url = ? WHERE id = ?');

for (const aff of affiliateLinks) {
  if (isGenericOrBadImage(aff.image_url)) {
    const newImage = resolveProductImage(aff.title, '', aff.platform);
    updateAffiliateStmt.run(newImage, aff.id);
    updatedAffiliates++;
    console.log(`[AFILIADO #${aff.id}] "${aff.title}" (${aff.platform})`);
    console.log(`   DE:   ${aff.image_url}`);
    console.log(`   PARA: ${newImage}`);
  }
}

// 3. Invalida cache de produtos em memória
models.invalidateProductCache();

console.log('====================================================');
console.log(`✅ Saneamento concluído com sucesso!`);
console.log(`📦 Produtos corrigidos na Loja Web: ${updatedProducts} de ${products.length}`);
console.log(`🔗 Links de Afiliados corrigidos:    ${updatedAffiliates} de ${affiliateLinks.length}`);
console.log('====================================================');

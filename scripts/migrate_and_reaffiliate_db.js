/**
 * Script de Migração e Re-Afiliação em Lote do Banco de Dados
 *
 * 1. Atualiza produtos da Shopee minerados anteriormente, inserindo o ID 18168880000.
 * 2. Atualiza produtos do Mercado Livre, inserindo o perfil oficial amcr1395763.
 * 3. Move produtos de outras plataformas sem ID cadastrado (Amazon, Hotmart, etc.) para active = 0 (fila de pendências).
 */

const db = require('../src/db/database');
const models = require('../src/db/models');
const aps = require('../src/services/affiliatePlatformService');

async function runMigration() {
  console.log('🚀 [MIGRAÇÃO] Iniciando varredura e re-afiliação do catálogo de links...');

  const shopeeAccount = models.getAffiliatePlatformAccountByPlatform('shopee');
  const mlAccount = models.getAffiliatePlatformAccountByPlatform('mercadolivre');

  console.log(`📌 Conta Shopee Ativa: ID ${shopeeAccount?.affiliate_id || 'NÃO CONFIGURADA'}`);
  console.log(`📌 Conta Mercado Livre Ativa: ID ${mlAccount?.affiliate_id || 'NÃO CONFIGURADA'}`);

  const allLinks = db.prepare('SELECT * FROM affiliate_links ORDER BY id ASC').all();
  console.log(`\n📦 Total de produtos no banco para avaliar: ${allLinks.length}\n`);

  let countShopeeUpdated = 0;
  let countShopeeAlready = 0;
  let countMlUpdated = 0;
  let countPaused = 0;
  let countFailed = 0;

  // Processa com fila de concorrência controlada (8 simultâneos para rapidez e estabilidade)
  const CONCURRENCY = 8;
  const chunks = [];
  for (let i = 0; i < allLinks.length; i += CONCURRENCY) {
    chunks.push(allLinks.slice(i, i + CONCURRENCY));
  }

  const updateLinkStmt = db.prepare(`
    UPDATE affiliate_links
    SET affiliate_url = ?, original_product_url = ?, platform = ?, active = ?, auto_distributed = ?
    WHERE id = ?
  `);

  const setInactiveStmt = db.prepare(`
    UPDATE affiliate_links
    SET active = 0
    WHERE id = ?
  `);

  let processedCount = 0;

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (link) => {
      processedCount++;
      const url = String(link.affiliate_url || '').trim();
      const platDetected = aps.detectPlatform(url);
      const isShopee = platDetected === 'shopee' || String(link.platform).toLowerCase() === 'shopee';
      const isML = platDetected === 'mercadolivre' || String(link.platform).toLowerCase() === 'mercadolivre' || String(link.platform).toLowerCase() === 'mercado livre';

      if (isShopee) {
        if (url.includes('18168880000')) {
          countShopeeAlready++;
          // Já está afiliado ao usuário
          return;
        }

        try {
          const cleaned = await aps.unshortenAndCleanProductUrl(url);
          const finalUrl = aps.buildAffiliateUrl({
            productUrl: cleaned,
            platform: 'shopee',
            account: shopeeAccount
          });

          const isAff = aps.isProductAffiliatedWithUser({
            account: shopeeAccount,
            finalAffiliateUrl: finalUrl,
            cleanedProductUrl: cleaned
          });

          if (isAff) {
            updateLinkStmt.run(finalUrl, cleaned, 'Shopee', 1, 0, link.id);
            countShopeeUpdated++;
          } else {
            setInactiveStmt.run(link.id);
            countPaused++;
          }
        } catch (err) {
          setInactiveStmt.run(link.id);
          countFailed++;
        }
      } else if (isML) {
        if (url.includes('amcr1395763')) {
          return;
        }

        try {
          const cleaned = await aps.unshortenAndCleanProductUrl(url);
          const finalUrl = aps.buildAffiliateUrl({
            productUrl: cleaned,
            platform: 'mercadolivre',
            account: mlAccount
          });

          const isAff = aps.isProductAffiliatedWithUser({
            account: mlAccount,
            finalAffiliateUrl: finalUrl,
            cleanedProductUrl: cleaned
          });

          if (isAff) {
            updateLinkStmt.run(finalUrl, cleaned, 'Mercado Livre', 1, 0, link.id);
            countMlUpdated++;
          } else {
            setInactiveStmt.run(link.id);
            countPaused++;
          }
        } catch (err) {
          setInactiveStmt.run(link.id);
          countFailed++;
        }
      } else {
        // Outras plataformas sem ID ativo cadastrado (Amazon, Hotmart, etc.)
        setInactiveStmt.run(link.id);
        countPaused++;
      }
    }));

    if (processedCount % 40 === 0 || processedCount >= allLinks.length) {
      process.stdout.write(`⏳ Progresso: ${processedCount}/${allLinks.length} links processados...\r`);
    }
  }

  console.log(`\n\n🎉 [MIGRAÇÃO CONCLUÍDA COM SUCESSO]`);
  console.log(`──────────────────────────────────────────`);
  console.log(`✅ Shopee: ${countShopeeUpdated} links re-afiliados para ID 18168880000`);
  console.log(`✅ Shopee: ${countShopeeAlready} links que já tinham seu ID`);
  console.log(`✅ Mercado Livre: ${countMlUpdated} links re-afiliados para perfil amcr1395763`);
  console.log(`🛡️ Fila de Pendências (active=0): ${countPaused} links pausados (sem comissão confirmada)`);
  if (countFailed > 0) {
    console.log(`⚠️ Falhas/Links Inválidos: ${countFailed} (movidos com segurança para active=0)`);
  }

  const finalActive = db.prepare('SELECT count(*) as c FROM affiliate_links WHERE active = 1').get();
  const finalPending = db.prepare('SELECT count(*) as c FROM affiliate_links WHERE active = 0').get();
  console.log(`\n📊 Status Atual do Catálogo:`);
  console.log(`🔥 Prontos para postar (100% sua comissão): ${finalActive.c} produtos`);
  console.log(`⏳ Aguardando seu link de afiliado (!pendentes): ${finalPending.c} produtos`);
  console.log(`──────────────────────────────────────────\n`);
}

runMigration().catch(err => {
  console.error('❌ Erro durante a migração:', err);
  process.exit(1);
});

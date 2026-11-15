const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const db = require(path.resolve(__dirname, '../src/db/database'));

console.log('🚀 [Limpeza de Afiliados] Iniciando saneamento do banco de dados...');

const dummyTerms = [
  '%trader-pro-test%',
  '%ml_top_123%',
  '%shope_tag_01%',
  '%af_braip_super_99%',
  '%bra999888%',
  '%HOT_A998877Z%',
  '%kiwi_af_master%',
  '%shein_ref_vip%',
  '%test-unique%',
  '%teste%',
  '%test%',
  '%example.com%',
  '%localhost%',
  '%paybot.store%',
  '%paybot.app%',
  '%mini-processador-turbo-vip%',
  '%fone-tws-pro-bluetooth%',
  '%smartwatch-ultra9-nfc%',
  '%airfryer-digital-touch%',
  '%caixa-som-bluetooth-prova-dagua%',
  '%kit-camisetas-algodao-premium%',
  '%camera-seguranca-wifi-360%',
  '%teclado-mecanico-rgb-pro%',
  '%garrafa-termica-digital-inox%',
  '%luminaria-led-mesa-carregador-inducao%',
  '%testePromocaoAugeRepercussao99%'
];

const buildWhereClause = (colUrl, colTitle) => {
  const parts = dummyTerms.map(() => `${colUrl} LIKE ?`);
  let sql = `(${parts.join(' OR ')})`;
  if (colTitle) {
    sql += ` OR ${colTitle} LIKE '%Trader Pro%' OR ${colTitle} LIKE '%Teste%'`;
  }
  return sql;
};

// 1. Identificar todos os IDs de affiliate_links que são fictícios ou testes
const whereAffLinks = buildWhereClause('affiliate_url', 'title');
const dummyLinkRows = db.prepare(`SELECT id FROM affiliate_links WHERE ${whereAffLinks}`).all(...dummyTerms);
const dummyLinkIds = dummyLinkRows.map(r => r.id);
console.log(`🔍 [Identificação] ${dummyLinkIds.length} IDs de links fictícios encontrados para remoção.`);

db.exec('BEGIN TRANSACTION;');
try {
  // 2. Limpar referências em lead_funnel_conversations
  if (dummyLinkIds.length > 0) {
    const placeholders = dummyLinkIds.map(() => '?').join(',');
    const delFunnel = db.prepare(`DELETE FROM lead_funnel_conversations WHERE affiliate_link_id IN (${placeholders})`).run(...dummyLinkIds);
    console.log(`✅ [lead_funnel_conversations] ${delFunnel.changes} conversas de funil ligadas a links fictícios removidas.`);
  }

  // 3. Limpeza em affiliate_campaigns (por ID ou por termo dummy)
  const whereCamp = buildWhereClause('affiliate_url', 'product_name');
  let delCampSql = `DELETE FROM affiliate_campaigns WHERE ${whereCamp}`;
  let campArgs = [...dummyTerms];
  if (dummyLinkIds.length > 0) {
    const placeholders = dummyLinkIds.map(() => '?').join(',');
    delCampSql += ` OR affiliate_link_id IN (${placeholders})`;
    campArgs.push(...dummyLinkIds);
  }
  const delCamp = db.prepare(delCampSql).run(...campArgs);
  console.log(`✅ [affiliate_campaigns] ${delCamp.changes} campanhas fictícias removidas.`);

  // 4. Limpeza em achadinhos_posts_log
  try {
    let delPostLogSql = `DELETE FROM achadinhos_posts_log WHERE ${buildWhereClause('affiliate_url', 'product_title')}`;
    let logArgs = [...dummyTerms];
    if (dummyLinkIds.length > 0) {
      const placeholders = dummyLinkIds.map(() => '?').join(',');
      delPostLogSql += ` OR affiliate_link_id IN (${placeholders})`;
      logArgs.push(...dummyLinkIds);
    }
    const delLog = db.prepare(delPostLogSql).run(...logArgs);
    console.log(`✅ [achadinhos_posts_log] ${delLog.changes} logs de postagens de teste removidos.`);
  } catch (e) {
    console.log(`ℹ️ [achadinhos_posts_log] Nota: ${e.message}`);
  }

  // 5. Excluir links fictícios de affiliate_links
  if (dummyLinkIds.length > 0) {
    const placeholders = dummyLinkIds.map(() => '?').join(',');
    const delAffLinks = db.prepare(`DELETE FROM affiliate_links WHERE id IN (${placeholders})`).run(...dummyLinkIds);
    console.log(`✅ [affiliate_links] ${delAffLinks.changes} links fictícios/testes removidos com sucesso.`);
  }

  // 6. Limpeza em social_listening_rules
  const whereRules = buildWhereClause('affiliate_url', 'product_name');
  const delRules = db.prepare(`DELETE FROM social_listening_rules WHERE ${whereRules}`).run(...dummyTerms);
  console.log(`✅ [social_listening_rules] ${delRules.changes} regras com links fictícios removidas.`);

  // 7. Limpeza em swarm_collected_products
  try {
    const whereSwarm = `${buildWhereClause('url', 'title')} OR ${dummyTerms.map(() => 'affiliate_url LIKE ?').join(' OR ')}`;
    const delSwarm = db.prepare(`DELETE FROM swarm_collected_products WHERE ${whereSwarm}`).run(...dummyTerms, ...dummyTerms);
    console.log(`✅ [swarm_collected_products] ${delSwarm.changes} produtos garimpados fictícios removidos.`);
  } catch (e) {
    console.log(`ℹ️ [swarm_collected_products] Nota: ${e.message}`);
  }

  // 8. Neutralizar tags fictícias em affiliate_platform_accounts
  const resetAccounts = db.prepare(`
    UPDATE affiliate_platform_accounts
    SET tracking_tag = NULL, affiliate_id = NULL
    WHERE tracking_tag IN ('sec_ml_top_123', 'shope_tag_01', 'af_braip_super_99', 'HOT_A998877Z', 'kiwi_af_master', 'shein_ref_vip')
       OR tracking_tag LIKE '%test%'
       OR affiliate_id LIKE '%test%'
  `).run();
  console.log(`✅ [affiliate_platform_accounts] ${resetAccounts.changes} contas com credenciais/tags fictícias redefinidas.`);

  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  throw err;
}

// Resumo final
const remainingLinks = db.prepare('SELECT count(*) as c FROM affiliate_links').get().c;
const remainingRules = db.prepare('SELECT count(*) as c FROM social_listening_rules').get().c;
const remainingCampaigns = db.prepare('SELECT count(*) as c FROM affiliate_campaigns').get().c;

console.log('\n📊 [Resumo pós-limpeza]');
console.log(`- Links de afiliado legítimos restantes: ${remainingLinks}`);
console.log(`- Regras de social listening ativas: ${remainingRules}`);
console.log(`- Campanhas ativas: ${remainingCampaigns}`);

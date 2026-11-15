const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const db = require(path.resolve(__dirname, '../src/db/database'));
const affiliatePlatformService = require(path.resolve(__dirname, '../src/services/affiliatePlatformService'));

console.log('🔄 [Atualização de Regras de Social Listening] Atualizando templates antigos para a nova matriz Spintax...');

const rules = db.prepare('SELECT id, product_name, templates FROM social_listening_rules').all();
let updated = 0;

for (const rule of rules) {
  let needsUpdate = false;
  let parsed = [];
  try {
    parsed = typeof rule.templates === 'string' ? JSON.parse(rule.templates) : rule.templates;
  } catch (_) {
    needsUpdate = true;
  }

  if (!Array.isArray(parsed) || parsed.length <= 3) {
    needsUpdate = true;
  } else if (parsed.some(t => t.includes('{Olá|Oi|E aí}!') && !t.includes('Fala pessoal'))) {
    needsUpdate = true;
  }

  if (needsUpdate) {
    const newTemplates = affiliatePlatformService.generateSpintaxCopies(rule.product_name || 'o produto');
    db.prepare('UPDATE social_listening_rules SET templates = ? WHERE id = ?').run(JSON.stringify(newTemplates), rule.id);
    updated++;
  }
}

console.log(`✅ ${updated} regras de Social Listening atualizadas com a nova matriz expandida de saudações e Spintax.`);

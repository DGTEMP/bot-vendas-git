const assert = require('assert');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const formatter = require('../src/utils/whatsappFormatter');
const achadinhosService = require('../src/services/achadinhosService');
const affiliatePlatformService = require('../src/services/affiliatePlatformService');

console.log('🧪 [TESTES] Iniciando validação de Formatação e Sanitização para WhatsApp (*, _, ~)...\n');

// ==========================================
// Teste 1: Higienização de Títulos com Asteriscos Internos
// ==========================================
console.log('--- Teste 1: Higienização de Títulos Dinâmicos ---');
const dirtyTitle = '*PROMOÇÃO 11.11* Fone de Ouvido Bluetooth *NOVO* TWS Pro';
const safeTitle = formatter.sanitizeFieldForBold(dirtyTitle);

assert(!safeTitle.includes('*'), 'Título seguro NÃO deve conter asteriscos internos');
assert.strictEqual(safeTitle, 'PROMOÇÃO 11.11 Fone de Ouvido Bluetooth NOVO TWS Pro');
console.log(`✅ Título limpo com sucesso: "${dirtyTitle}" -> "*${safeTitle}*"`);

// ==========================================
// Teste 2: Higienização de Pitch com Underscores Internos
// ==========================================
console.log('\n--- Teste 2: Higienização de Itálicos com Underscores Internos ---');
const dirtyPitch = 'Garantia_estendida com entrega_turbo e som_estéreo de alta fidelidade!';
const safePitch = formatter.sanitizeFieldForItalic(dirtyPitch);

assert(!safePitch.includes('_'), 'Pitch seguro NÃO deve conter underscores internos');
console.log(`✅ Pitch limpo com sucesso: "${dirtyPitch}" -> "_${safePitch}_"`);

// ==========================================
// Teste 3: Preservação Intacta de URLs com Underscores
// ==========================================
console.log('\n--- Teste 3: Preservação de URLs com Parâmetros de Afiliado ---');
const rawMsg =
  '🔥 *ACHADINHO IMPERDÍVEL!* 🛍️\n\n' +
  '📦 *Fone de Ouvido Bluetooth*\n' +
  '💰 Preço: *R$ 49,90*\n\n' +
  '👉 *Link seguro:*\n' +
  '🔗 https://shopee.com.br/product_name_123?aff_id=18168880000&sub_id=promo_vip_01&utm_source=meta_ads';

const sanitizedMsg = formatter.sanitizeWhatsAppMessage(rawMsg);
assert(
  sanitizedMsg.includes('https://shopee.com.br/product_name_123?aff_id=18168880000&sub_id=promo_vip_01&utm_source=meta_ads'),
  'A URL deve permanecer 100% intacta com todos os underscores dos parâmetros!'
);
console.log('✅ URL complexa com múltiplos underscores preservada 100% íntegra.');

// ==========================================
// Teste 4: Correção de Asteriscos e Underscores Órfãos
// ==========================================
console.log('\n--- Teste 4: Balanceamento de Caracteres Órfãos ---');
const msgWithOddAsterisk = 'Olá pessoal! *Atenção para esta oferta de hoje';
const fixedAsterisk = formatter.sanitizeWhatsAppMessage(msgWithOddAsterisk);
const asteriskCount = (fixedAsterisk.match(/\*/g) || []).length;
assert.strictEqual(asteriskCount % 2, 0, 'O total de asteriscos na mensagem deve ser par (balanceado)');
console.log(`✅ Mensagem com asterisco órfão corrigida: "${msgWithOddAsterisk}" -> "${fixedAsterisk}"`);

const msgWithOddUnderscore = 'Confira aqui _esta dica exclusiva para você';
const fixedUnderscore = formatter.sanitizeWhatsAppMessage(msgWithOddUnderscore);
const underscoreCount = (fixedUnderscore.match(/_/g) || []).length;
assert.strictEqual(underscoreCount % 2, 0, 'O total de underscores na mensagem deve ser par (balanceado)');
console.log(`✅ Mensagem com underscore órfão corrigida: "${msgWithOddUnderscore}" -> "${fixedUnderscore}"`);

// ==========================================
// Teste 5: Correção de Espaços Inválidos (* texto *) e Discord Markdown (**bold**)
// ==========================================
console.log('\n--- Teste 5: Normalização de Espaços e Markdown Duplicado ---');
const badSpacingMsg = 'Veja este * produto em oferta * com _ desconto real _ e **muita qualidade**!';
const normalized = formatter.sanitizeWhatsAppMessage(badSpacingMsg);

assert(!normalized.includes('**'), 'Não deve conter asteriscos duplos (estilo Discord)');
assert(!/(?:^|\s)\*\s+/.test(normalized), 'Não deve haver espaço logo após asterisco de abertura');
assert(!/\s+\*(?:\s|[.,!?;:]|$)/.test(normalized), 'Não deve haver espaço logo antes de asterisco de fechamento');
assert(!/(?:^|\s)_\s+/.test(normalized), 'Não deve haver espaço logo após underscore de abertura');
assert(!/\s+_(?:\s|[.,!?;:]|$)/.test(normalized), 'Não deve haver espaço logo antes de underscore de fechamento');
assert.strictEqual(normalized, 'Veja este *produto em oferta* com _desconto real_ e *muita qualidade*!');
console.log(`✅ Mensagem normalizada: "${badSpacingMsg}"\n   -> "${normalized}"`);

// ==========================================
// Teste 6: formatAchadinhoMessage Integrado
// ==========================================
console.log('\n--- Teste 6: formatAchadinhoMessage com Dados Sujos ---');
const formattedDeal = achadinhosService.formatAchadinhoMessage({
  title: ' *OFERTA* Smartwatch_Ultra *NFC* 2026 ',
  platform: 'Shopee',
  product_price: 99.90,
  original_price: 199.90,
  affiliate_url: 'https://shopee.com.br/item_relógio_123?aff_id=18168880000&sub_id=promo_01',
  pitch_copy: ' _Bateria_ de 3 dias com tela_amoled e resistente_agua! '
});

console.log('Mensagem Final Formatada do Achadinho:\n');
console.log(formattedDeal);

// Assertivas na mensagem final
assert(formattedDeal.includes('*OFERTA Smartwatch_Ultra NFC 2026*'), 'Título deve estar em negrito perfeitamente limpo');
assert(formattedDeal.includes('https://shopee.com.br/item_relógio_123?aff_id=18168880000&sub_id=promo_01'), 'URL deve estar preservada');
assert(formattedDeal.includes('_Bateria de 3 dias com tela amoled e resistente agua!_'), 'Pitch copy deve estar em itálico limpo');
assert(!formattedDeal.includes('**'), 'Não pode conter asteriscos duplicados');

console.log('\n🎉 TODOS OS TESTES DE FORMATAÇÃO WHATSAPP PASSARAM COM SUCESSO (100%)!');
process.exit(0);

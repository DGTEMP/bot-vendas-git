const assert = require('assert');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const models = require('../src/db/models');
const affiliatePlatformService = require('../src/services/affiliatePlatformService');
const socialListeningService = require('../src/services/socialListeningService');
const achadinhosService = require('../src/services/achadinhosService');

console.log('🧪 [TESTES] Iniciando validação de Spintax e Bloqueio de Links Fictícios...\n');

// ==========================================
// Teste 1: Validação de parseSpintax
// ==========================================
console.log('--- Teste 1: parseSpintax com Variações de Saudação ---');
const spintaxTemplate = '{Olá|Oi|Opa|E aí|Fala pessoal|Fala galera|Tudo bem?}! Promoção de *{produto}*: {link} {🚀|🔥|⭐}';
const resultsSet = new Set();
for (let i = 0; i < 50; i++) {
  const parsed = models.parseSpintax(spintaxTemplate, {
    produto: 'Air Fryer Digital',
    link: 'https://shopee.com.br/airfryer-123'
  });

  // Não deve restar nenhum caractere de spintax não resolvido
  assert(!parsed.includes('{'), `Spintax não resolvido (contém {): ${parsed}`);
  assert(!parsed.includes('|'), `Spintax não resolvido (contém |): ${parsed}`);
  assert(!parsed.includes('}'), `Spintax não resolvido (contém }): ${parsed}`);
  assert(parsed.includes('Air Fryer Digital'), `Nome do produto ausente: ${parsed}`);
  assert(parsed.includes('https://shopee.com.br/airfryer-123'), `Link ausente: ${parsed}`);

  // Coleta a saudação extraída
  const greeting = parsed.split('!')[0];
  resultsSet.add(greeting);
}
console.log(`✅ parseSpintax gerou ${resultsSet.size} variações distintas de saudação a partir do mesmo template:`);
console.log('   Variações detectadas:', Array.from(resultsSet).join(', '));
assert(resultsSet.size >= 4, 'Deveria gerar ao menos 4 saudações diferentes em 50 iterações');

// ==========================================
// Teste 2: generateSpintaxCopies com Rica Variedade
// ==========================================
console.log('\n--- Teste 2: generateSpintaxCopies de Afiliados ---');
const copies = affiliatePlatformService.generateSpintaxCopies('Smartphone Samsung Galaxy S25', 'Mercado Livre');
assert(Array.isArray(copies) && copies.length >= 5, 'Deveria gerar pelo menos 5 cópias spintax estruturadas');
console.log(`✅ Geradas ${copies.length} estruturas de copy ricas.`);
copies.forEach((c, idx) => {
  const resolved = models.parseSpintax(c, { link: 'https://meli.la/exemplo' });
  assert(!resolved.includes('{') && !resolved.includes('|') && !resolved.includes('}'));
  console.log(`   [Copy ${idx + 1} Exemplo]: ${resolved.slice(0, 90)}...`);
});

// ==========================================
// Teste 3: Detecção de URLs Fictícias / Testes
// ==========================================
console.log('\n--- Teste 3: Detecção e Bloqueio de Links Fictícios ---');
const dummyUrls = [
  'https://hotm.art/trader-pro-test',
  'https://mercadolivre.com/sec/ml_top_123',
  'https://shope.ee/shope_tag_01',
  'https://braip.com/ref?src=bra999888',
  'https://example.com/item',
  'https://shope.ee/mini-processador-turbo-vip',
  'https://mercadolivre.com/sec/fone-tws-pro-bluetooth',
  'https://paybot.store/loja/teste',
  'http://localhost:3000/teste'
];

const validUrls = [
  'https://shope.ee/m9K82LaQ',
  'https://mercadolivre.com/sec/2aBcDeF',
  'https://hotm.art/sinais-cripto-vip',
  'https://meli.la/2TQkhmc',
  'https://produto.mercadolivre.com.br/MLB-123456789-smart-tv.html',
  'https://shopee.com.br/Kit-Panelas-Antiaderente-p-987654'
];

dummyUrls.forEach(url => {
  assert(socialListeningService.isDummyAffiliateUrl(url), `Deveria identificar como fictícia: ${url}`);
  assert(achadinhosService.isDummyAffiliateUrl(url), `Achadinhos deveria identificar como fictícia: ${url}`);
  assert(affiliatePlatformService.isDummyAffiliateUrl(url), `AffiliatePlatform deveria identificar como fictícia: ${url}`);
});
console.log(`✅ Todas as ${dummyUrls.length} URLs fictícias foram corretamente identificadas e reprovadas.`);

validUrls.forEach(url => {
  assert(!socialListeningService.isDummyAffiliateUrl(url), `URL legítima não deveria ser bloqueada: ${url}`);
  assert(!achadinhosService.isDummyAffiliateUrl(url), `URL legítima não deveria ser bloqueada: ${url}`);
  assert(!affiliatePlatformService.isDummyAffiliateUrl(url), `URL legítima não deveria ser bloqueada: ${url}`);
});
console.log(`✅ Todas as ${validUrls.length} URLs legítimas foram corretamente aprovadas.`);

// ==========================================
// Teste 4: formatAchadinhoMessage sem Spintax residual
// ==========================================
console.log('\n--- Teste 4: formatAchadinhoMessage em Achadinhos ---');
const achadinhoFormatted = achadinhosService.formatAchadinhoMessage({
  title: 'Câmera de Segurança 360 Wi-Fi HD',
  platform: 'Shopee',
  product_price: 129.90,
  original_price: 249.90,
  affiliate_url: 'https://shope.ee/camera-real-99',
  pitch_copy: '{Olá|Oi|Fala pessoal}! {Recomendo demais pela qualidade da imagem|Melhor custo-benefício que já testei}.'
});

assert(!achadinhoFormatted.includes('{'), `formatAchadinhoMessage contém {: ${achadinhoFormatted}`);
assert(!achadinhoFormatted.includes('|'), `formatAchadinhoMessage contém |: ${achadinhoFormatted}`);
assert(!achadinhoFormatted.includes('}'), `formatAchadinhoMessage contém }: ${achadinhoFormatted}`);
console.log('✅ Mensagem de achadinhos formatada perfeitamente com Spintax resolvido:\n');
console.log(achadinhoFormatted);

// ==========================================
// Teste 5: Bloqueio de Broadcast de Link Fictício
// ==========================================
console.log('\n--- Teste 5: Bloqueio Ativo no Broadcast de Links Fictícios ---');
(async () => {
  const dummyBroadcastResult = await achadinhosService.broadcastLinkToChannels({
    id: 999999,
    title: 'Produto Teste Fake',
    affiliate_url: 'https://mercadolivre.com/sec/ml_top_123'
  });
  assert.strictEqual(dummyBroadcastResult.success, false);
  assert(dummyBroadcastResult.error.includes('bloqueado'));
  console.log('✅ Disparo de link fictício bloqueado com sucesso pelo AchadinhosService.');

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
  process.exit(0);
})().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

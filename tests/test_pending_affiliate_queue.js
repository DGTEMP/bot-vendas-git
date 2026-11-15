const assert = require('assert');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const models = require('../src/db/models');
const affiliatePlatformService = require('../src/services/affiliatePlatformService');
const achadinhosService = require('../src/services/achadinhosService');

console.log('🧪 [TESTES] Iniciando validação da Fila de Pendências e Proteção de Comissão...\n');

(async () => {
  // ==========================================
  // Teste 1: Produto Shopee (com ID do Usuário Ativo 18168880000)
  // ==========================================
  console.log('--- Teste 1: Produto Shopee com ID Ativo ---');
  const shopeeUrl = 'https://shopee.com.br/Mini-Processador-Alho-p-998877';
  const shopeeRes = await affiliatePlatformService.autoAffiliateProduct({
    productUrl: shopeeUrl,
    title: 'Mini Processador Turbo Teste',
    autoDistribute: false
  });

  assert.strictEqual(shopeeRes.link.active, 1, 'Produto Shopee deveria estar ativo (active=1)');
  assert(shopeeRes.link.affiliate_url.includes('18168880000'), 'Deveria conter a ID de afiliado do usuário');
  console.log('✅ Produto Shopee com ID do usuário aprovado automaticamente com active=1.');

  // ==========================================
  // Teste 2: Produto de Plataforma SEM ID Cadastrado (Fila de Pendências)
  // ==========================================
  console.log('\n--- Teste 2: Produto de Plataforma sem ID Cadastrado (Pendente) ---');
  const amazonUrl = 'https://amazon.com.br/dp/B08N5WRWNW';
  const pendingRes = await affiliatePlatformService.autoAffiliateProduct({
    productUrl: amazonUrl,
    title: 'Echo Dot 5ª Geração Smart Speaker',
    autoDistribute: false
  });

  assert.strictEqual(pendingRes.status, 'PENDING_USER_LINK');
  assert.strictEqual(pendingRes.link.active, 0, 'Produto sem ID do usuário DEVE ser active=0 (pendente)');
  console.log(`✅ Produto #${pendingRes.link.id} salvo com active=0 e retido na fila de pendências.`);

  // ==========================================
  // Teste 3: Garantir que Produto Pendente NÃO entra na lista de postagens
  // ==========================================
  console.log('\n--- Teste 3: Checagem no Catálogo de Postagens Ativas ---');
  const activeDeals = models.getActiveDeals({ limit: 50 });
  const inActive = activeDeals.some(d => d.id === pendingRes.link.id);
  assert(!inActive, 'Produto pendente (active=0) NÃO pode aparecer em getActiveDeals!');
  console.log('✅ Produto pendente não consta na lista de postagens prontas.');

  // Checa se aparece na fila de pendentes
  const pendingDeals = models.getPendingAffiliateLinks({ limit: 50 });
  const inPending = pendingDeals.some(d => d.id === pendingRes.link.id);
  assert(inPending, 'Produto pendente DEVE aparecer em getPendingAffiliateLinks!');
  console.log('✅ Produto consta corretamente na fila de getPendingAffiliateLinks.');

  // ==========================================
  // Teste 4: Tentativa de Postagem de Produto Pendente deve ser BLOQUEADA
  // ==========================================
  console.log('\n--- Teste 4: Bloqueio Ativo no Disparo de Postagens ---');
  const broadcastResult = await achadinhosService.broadcastLinkToChannels(pendingRes.link);
  assert.strictEqual(broadcastResult.success, false, 'Broadcast de link com active=0 deve falhar');
  assert(broadcastResult.error.includes('aguarda link'), `Mensagem de erro esperada, recebido: ${broadcastResult.error}`);
  console.log('✅ Disparo de postagem bloqueado com sucesso pelo AchadinhosService.');

  // ==========================================
  // Teste 5: Liberação do Produto pelo Usuário (!afiliar)
  // ==========================================
  console.log('\n--- Teste 5: Vinculação de Link pelo Usuário (Comando !afiliar) ---');
  const userOfficialAffiliateLink = 'https://amzn.to/meu-link-oficial-3xyz';
  const updatedLink = models.attachUserAffiliateLink(pendingRes.link.id, userOfficialAffiliateLink);

  assert.strictEqual(updatedLink.active, 1, 'Produto deve ser promovido para active=1 após vinculação');
  assert.strictEqual(updatedLink.affiliate_url, userOfficialAffiliateLink, 'Link de afiliado deve ser atualizado para o do usuário');
  console.log(`✅ Produto #${updatedLink.id} promovido para active=1 com link oficial: ${updatedLink.affiliate_url}`);

  // Agora DEVE aparecer no catálogo de ofertas ativas
  const activeDealsAfter = models.getActiveDeals({ limit: 50 });
  const inActiveAfter = activeDealsAfter.some(d => d.id === updatedLink.id);
  assert(inActiveAfter, 'Produto liberado agora DEVE constar na lista de ofertas ativas!');
  console.log('✅ Produto liberado entrou imediatamente na lista de produtos prontos para o bot postar!');

  // Limpeza dos registros de teste
  models.deleteAffiliateLink(shopeeRes.link.id);
  models.deleteAffiliateLink(pendingRes.link.id);
  console.log('\n🎉 TODOS OS TESTES DA FILA DE PENDÊNCIAS PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
})().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

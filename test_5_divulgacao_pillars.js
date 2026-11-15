/**
 * ============================================================================
 * 🧪 TEST SUITE: 5 PILARES DA ESTRUTURA DE DIVULGAÇÃO & TRÁFEGO ESCALÁVEL
 * ============================================================================
 * Valida a implementação completa e integrada dos 5 Pilares de Divulgação:
 * - Pilar 1: Cloaking & Roteador de Links Próprio (/r/:slug) com Pixel & UTM
 * - Pilar 2: Recuperação Ativa & Automática de Carrinho Abandonado no WhatsApp
 * - Pilar 3: Régua de Aquecimento Gradual de Sub-Bots Novos (Warmup 7 Dias)
 * - Pilar 4: Máquina de Repurposing de Vídeos Virais para Status e Achadinhos
 * - Pilar 5: Funil de Indicação "Member-Get-Member" nos Grupos de Ofertas
 * ============================================================================
 */

const assert = require('assert');
const models = require('./src/db/models');
const linkTrackerService = require('./src/services/linkTrackerService');
const abandonedCartRecoveryService = require('./src/services/abandonedCartRecoveryService');
const subBotWarmupPipelineService = require('./src/services/subBotWarmupPipelineService');
const viralRepurposingService = require('./src/services/viralRepurposingService');
const memberReferralService = require('./src/services/memberReferralService');
const achadinhosService = require('./src/services/achadinhosService');

process.env.NODE_ENV = 'test';

async function runTestSuite() {
  console.log('🚀 Iniciando bateria de testes dos 5 Pilares de Divulgação...\n');

  // ============================================================================
  // PILAR 1: CLOAKING & ROTEADOR DE LINKS PRÓPRIO
  // ============================================================================
  console.log('--- [PILAR 1] Testando Cloaking & Roteador de Links (/r/:slug) ---');

  const testDestinationUrl = 'https://shopee.com.br/product/284729182/9837261524';
  const trackedLink = linkTrackerService.createOrGetTrackedLink({
    url: testDestinationUrl,
    title: 'Fone Bluetooth Pro TWS',
    platform: 'Shopee',
    source: 'teste_unitario'
  });

  assert(trackedLink && trackedLink.slug, 'Link rastreado deve possuir slug gerado');
  assert(trackedLink.short_url.includes('/r/' + trackedLink.slug), 'short_url deve conter /r/:slug');

  // Teste de busca pelo slug
  const fetchedLink = models.getTrackedLinkBySlug(trackedLink.slug);
  assert.strictEqual(fetchedLink.destination_url, testDestinationUrl, 'URL de destino deve ser preservada');

  // Teste de HTML para usuário real (redirecionamento)
  const reqUser = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
  const userHtml = linkTrackerService.buildRedirectHtml(trackedLink, reqUser);
  assert(userHtml.includes('window.location.replace'), 'HTML para usuário real deve conter script de redirecionamento');
  assert(userHtml.includes('utm_source='), 'URL de redirecionamento deve carregar parâmetros UTM');

  // Teste de HTML para Crawler do WhatsApp
  const reqCrawler = { headers: { 'user-agent': 'WhatsApp/2.24.1.6 i' } };
  const crawlerHtml = linkTrackerService.buildRedirectHtml(trackedLink, reqCrawler);
  assert(crawlerHtml.includes('<meta property="og:title"'), 'Crawler deve receber metadados OpenGraph limpos');
  assert(!crawlerHtml.includes('window.location.replace'), 'Crawler não deve receber script invasivo de replace');

  // Teste de registro de clique
  models.recordTrackedLinkClick({
    link_id: trackedLink.id,
    slug: trackedLink.slug,
    ip: '127.0.0.1',
    user_agent: 'Mozilla/5.0 Test',
    referrer: 'https://whatsapp.com'
  });
  const linkStats = models.getTrackedLinkStats(trackedLink.id);
  assert.strictEqual(linkStats.link.clicks_count, 1, 'Contagem de cliques deve ser incrementada para 1');
  assert.strictEqual(linkStats.clicks.length, 1, 'Registro de clique individual deve ser gravado');

  // Teste de substituição automática no AchadinhosService
  const achadinhoMsg = achadinhosService.formatAchadinhoMessage({
    title: 'Fone Bluetooth Pro TWS',
    platform: 'Shopee',
    product_price: 49.90,
    original_price: 99.90,
    affiliate_url: testDestinationUrl
  });
  assert(achadinhoMsg.includes('/r/'), 'Mensagem formatada pelo Achadinhos deve conter o link encurtado /r/:slug');
  console.log('✅ [PILAR 1] Roteador de links, Cloaking e Anti-Ban 100% validados!');


  // ============================================================================
  // PILAR 2: RECUPERAÇÃO ATIVA DE CARRINHO ABANDONADO NO WHATSAPP
  // ============================================================================
  console.log('\n--- [PILAR 2] Testando Recuperação Ativa de Carrinho Abandonado ---');

  const testSessionId = 'cart_test_' + Date.now();
  const testPhone = '5511999887766';

  // Registra carrinho abandonado com produto
  models.saveCartSession({
    session_id: testSessionId,
    phone: testPhone,
    customer_name: 'Lucas Teste',
    status: 'IN_CART',
    cart_items: [{ name: 'Smartwatch Ultra 9', price: 149.90, quantity: 1 }],
    cart_total: 149.90
  });

  // Força última atividade para 20 minutos atrás para ativar Etapa 1
  const db = require('./src/db/database');
  db.prepare(`
    UPDATE web_cart_sessions
    SET last_activity_at = datetime('now', '-20 minutes'),
        recovery_step1_sent = 0,
        recovered = 0
    WHERE session_id = ?
  `).run(testSessionId);

  // Busca sessões aptas para Etapa 1
  const step1Sessions = models.getAbandonedCartSessionsStep1(15);
  const foundStep1 = step1Sessions.find(s => s.session_id === testSessionId);
  assert(foundStep1, 'Sessão com 20 minutos de ócio deve ser detectada na Etapa 1');

  // Marca Etapa 1 enviada
  models.markCartRecoveryStep1(testSessionId);

  // Força tempo da Etapa 1 para 22 horas atrás para ativar Etapa 2
  db.prepare(`
    UPDATE web_cart_sessions
    SET recovery_step1_at = datetime('now', '-22 hours'),
        recovery_step2_sent = 0
    WHERE session_id = ?
  `).run(testSessionId);

  const step2Sessions = models.getAbandonedCartSessionsStep2(20);
  const foundStep2 = step2Sessions.find(s => s.session_id === testSessionId);
  assert(foundStep2, 'Sessão com 22 horas pós-Etapa 1 deve ser detectada na Etapa 2');

  // Gera cupom e marca Etapa 2
  const coupon = models.createOrGetAbandonedCoupon(testPhone, 'Lucas', 10, 24);
  assert(coupon && coupon.code, 'Cupom de 10% exclusivo deve ser gerado');
  models.markCartRecoveryStep2(testSessionId, coupon.code);

  // Marca como recuperado
  models.markCartRecovered(testSessionId);
  const recoveryStats = models.getAbandonedCartRecoveryStats();
  assert(recoveryStats.recovered_count >= 1, 'Métricas devem registrar pelo menos 1 carrinho recuperado');
  console.log('✅ [PILAR 2] Recuperação em 2 etapas e geração de cupons validadas com sucesso!');


  // ============================================================================
  // PILAR 3: RÉGUA DE AQUECIMENTO GRADUAL DE SUB-BOTS NOVOS (7 DIAS)
  // ============================================================================
  console.log('\n--- [PILAR 3] Testando Régua de Aquecimento de Chips Novos (Warmup) ---');

  // Cria sub-bot novo para teste
  const newSubBot = models.createArmyInstance({
    name: 'Sub-Bot Chip Zero',
    phone: '5511911112222',
    daily_limit: 30,
    warmup_mode: 1
  });

  // Força data de criação para hoje e estágio FRIO
  db.prepare(`
    UPDATE whatsapp_army_instances
    SET created_at = datetime('now'),
        warmup_stage = 'FRIO'
    WHERE id = ?
  `).run(newSubBot.id);

  let warmupInfo = models.getSubBotWarmupInfo(newSubBot.id);
  assert.strictEqual(warmupInfo.stage, 'FRIO', 'Chip recém-criado deve iniciar em Nível FRIO');
  assert.strictEqual(warmupInfo.can_post_groups, false, 'Chip em Nível FRIO NÃO pode postar em grupos');

  const postCheckFrio = models.canSubBotPostToGroup(newSubBot.id);
  assert.strictEqual(postCheckFrio.allowed, false, 'canSubBotPostToGroup deve bloquear postagens em Nível FRIO');

  // Simula avanço para Nível MORNO (Dia 4)
  models.setSubBotWarmupStage(newSubBot.id, 'MORNO');
  db.prepare(`
    UPDATE subbot_warmup_logs
    SET max_posts_allowed = 3,
        group_posts_today = 0
    WHERE instance_id = ?
  `).run(newSubBot.id);

  const postCheckMorno = models.canSubBotPostToGroup(newSubBot.id);
  assert.strictEqual(postCheckMorno.allowed, true, 'canSubBotPostToGroup deve permitir postagens no limite do Nível MORNO');

  // Simula atingimento do limite diário do MORNO (3 posts)
  models.recordSubBotGroupPost(newSubBot.id);
  models.recordSubBotGroupPost(newSubBot.id);
  models.recordSubBotGroupPost(newSubBot.id);

  const postCheckMornoLimit = models.canSubBotPostToGroup(newSubBot.id);
  assert.strictEqual(postCheckMornoLimit.allowed, false, 'canSubBotPostToGroup deve bloquear após atingir o teto de 3 posts');

  // Simula avanço para MADURO (Dia 7+)
  models.setSubBotWarmupStage(newSubBot.id, 'MADURO');
  const postCheckMaduro = models.canSubBotPostToGroup(newSubBot.id);
  assert.strictEqual(postCheckMaduro.allowed, true, 'Sub-Bot MADURO deve estar totalmente desbloqueado');

  const warmupSummary = subBotWarmupPipelineService.getStatusSummary();
  assert(warmupSummary.total_subbots > 0, 'Resumo do Warmup deve listar a frota de sub-bots');
  console.log('✅ [PILAR 3] Régua de aquecimento de 7 dias, limites diários e proteções validadas!');


  // ============================================================================
  // PILAR 4: MÁQUINA DE VÍDEOS VIRAIS (REPURPOSING COM IA)
  // ============================================================================
  console.log('\n--- [PILAR 4] Testando Repurposing de Vídeos Virais para Status/Grupos ---');

  const viralJob = await viralRepurposingService.createRepurposeJob({
    sourceUrl: 'https://instagram.com/reel/C3test123',
    platform: 'instagram',
    originalTitle: 'Produto revolucionário de limpeza',
    productName: 'Mop Giratório Turbo 360',
    productUrl: 'https://paybot.store/produto/mop-turbo',
    targetDestinations: 'status'
  });

  assert(viralJob && viralJob.id, 'Job de repurposing deve ser criado com sucesso');
  assert(viralJob.hook_copy && viralJob.hook_copy.length > 5, 'Job deve conter Hook persuasivo gerado');
  assert(viralJob.cta_copy && viralJob.cta_copy.length > 5, 'Job deve conter CTA de alta conversão');
  assert(viralJob.final_caption.includes('/r/'), 'Legenda final deve conter o link rastreado cloaked');

  // Publica o job
  const pubResult = await viralRepurposingService.publishJob(viralJob.id);
  assert.strictEqual(pubResult.success, true, 'Publicação do job deve ser bem-sucedida');

  const updatedJob = models.getViralRepurposedJobs(10).find(j => j.id === viralJob.id);
  assert.strictEqual(updatedJob.status, 'PUBLISHED', 'Status do job deve ser atualizado para PUBLISHED');
  assert(updatedJob.published_at, 'Data de publicação deve ser registrada');
  console.log('✅ [PILAR 4] Geração de copy neuro-persuasiva e publicação de Status validadas!');


  // ============================================================================
  // PILAR 5: INDIQUE & GANHE VIRAL NOS GRUPOS (MEMBER-GET-MEMBER)
  // ============================================================================
  console.log('\n--- [PILAR 5] Testando Programa Indique & Ganhe nos Grupos ---');

  const uniqueSuffix = Date.now().toString().slice(-6);
  const testGroupJid = `120363${uniqueSuffix}@g.us`;
  const referrerJid = `551198888${uniqueSuffix}@s.whatsapp.net`;
  const friend1 = `551197771${uniqueSuffix}@s.whatsapp.net`;
  const friend2 = `551197772${uniqueSuffix}@s.whatsapp.net`;
  const friend3 = `551197773${uniqueSuffix}@s.whatsapp.net`;

  // Membro indica 3 amigos
  const ref1 = models.recordMemberReferral(testGroupJid, referrerJid, friend1);
  assert.strictEqual(ref1.recorded, true, 'Primeira indicação deve ser registrada');

  const ref2 = models.recordMemberReferral(testGroupJid, referrerJid, friend2);
  assert.strictEqual(ref2.recorded, true, 'Segunda indicação deve ser registrada');

  const ref3 = models.recordMemberReferral(testGroupJid, referrerJid, friend3);
  assert.strictEqual(ref3.recorded, true, 'Terceira indicação deve ser registrada');

  const totalReferrals = models.getMemberReferralCount(testGroupJid, referrerJid);
  assert.strictEqual(totalReferrals, 3, 'Total de indicações deve ser exatamente 3');

  // Verifica desbloqueio de prêmio do marco de 3 amigos (Cupom 15% VIP)
  const unlockedRewards = models.checkAndUnlockMilestoneReward(testGroupJid, referrerJid, totalReferrals);
  assert.strictEqual(unlockedRewards.length, 1, 'Deve desbloquear exatamente 1 prêmio para 3 amigos');
  assert.strictEqual(unlockedRewards[0].milestone, 3, 'Marco atingido deve ser o de 3 amigos');
  assert.strictEqual(unlockedRewards[0].reward_type, 'coupon_15', 'Tipo do prêmio deve ser cupom de 15%');
  assert(unlockedRewards[0].payload, 'Cupom deve conter código gerado no banco');

  // Ranking do grupo
  const ranking = models.getGroupReferralRanking(testGroupJid, 5);
  assert(ranking.length > 0, 'Ranking deve conter registros');
  assert.strictEqual(ranking[0].referrer_jid, referrerJid, 'Top 1 deve ser o nosso indicador com 3 convites');

  // Teste de comando !meulink via mock
  let sentMsg = null;
  const mockSock = {
    groupInviteCode: async () => 'INVITE123',
    sendMessage: async (jid, content) => {
      sentMsg = { jid, content };
      return true;
    }
  };

  await memberReferralService.handleReferralCommand(mockSock, testGroupJid, referrerJid, '!meulink', true);
  assert(sentMsg && sentMsg.content.text.includes('INVITE123'), 'Resposta do comando !meulink deve conter link do grupo');
  assert(sentMsg.content.text.includes('*3* amigo(s)'), 'Resposta deve conter a contagem de amigos do membro');

  // Teste de comando !ranking
  await memberReferralService.handleReferralCommand(mockSock, testGroupJid, referrerJid, '!ranking', true);
  assert(sentMsg && sentMsg.content.text.includes('1º Lugar'), 'Resposta do comando !ranking deve listar o pódio');
  console.log('✅ [PILAR 5] Funil de indicação, contagem de convites, ranking e premiações validados!');

  console.log('\n🎉 TODOS OS 5 PILARES DE DIVULGAÇÃO & TRÁFEGO FORAM EXECUTADOS E VALIDADOS COM 100% DE SUCESSO!\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ Falha nos testes dos 5 Pilares:', err);
  process.exit(1);
});

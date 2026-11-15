const assert = require('assert');
const models = require('./src/db/models');
const achadinhosService = require('./src/services/achadinhosService');
const affiliatePlatformService = require('./src/services/affiliatePlatformService');

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: Grupos & Canais de Achadinhos WhatsApp...');

  // 1. Cadastrar Canal Master (Grupo @g.us)
  const masterGroup = models.saveAchadinhosChannel({
    name: 'Grupo VIP Achadinhos Master',
    target_jid: '120363111111111111@g.us',
    channel_type: 'group',
    template_style: 'fire_sale',
    auto_post_new_links: 1,
    active: 1
  });
  assert(masterGroup && masterGroup.id, 'Falha ao salvar canal master grupo');
  console.log(`✅ [1/7] Canal Master Grupo criado: #${masterGroup.id} (${masterGroup.name})`);

  // 2. Cadastrar Canal Master (Canal Oficial @newsletter)
  const masterNewsletter = models.saveAchadinhosChannel({
    name: 'Canal Oficial Achadinhos & Cupons',
    target_jid: '120363222222222222@newsletter',
    channel_type: 'channel',
    template_style: 'flash_deal',
    auto_post_new_links: 1,
    active: 1
  });
  assert(masterNewsletter && masterNewsletter.id, 'Falha ao salvar canal master newsletter');
  assert.strictEqual(masterNewsletter.channel_type, 'channel', 'Tipo deve ser channel');
  console.log(`✅ [2/7] Canal Master Newsletter criado: #${masterNewsletter.id} (${masterNewsletter.name})`);

  // 3. Cadastrar Canal de Tenant (tenant_id = 1)
  const tenantChannel = models.saveAchadinhosChannel({
    tenant_id: 1,
    name: 'Achadinhos da Loja Parceira',
    target_jid: '120363333333333333@g.us',
    channel_type: 'group',
    template_style: 'exclusive',
    auto_post_new_links: 1,
    active: 1
  });
  assert(tenantChannel && tenantChannel.id, 'Falha ao salvar canal do tenant');
  assert.strictEqual(tenantChannel.tenant_id, 1, 'tenant_id deve ser 1');
  console.log(`✅ [3/7] Canal de Tenant criado: #${tenantChannel.id} (${tenantChannel.name})`);

  // 4. Testar Filtros de Canais por Tenant
  const allChannels = models.getAchadinhosChannels({ tenantId: 'all' });
  const masterChannels = models.getAchadinhosChannels({ tenantId: 'master' });
  const tenant1Channels = models.getAchadinhosChannels({ tenantId: 1 });

  assert(allChannels.length >= 3, 'Deve listar todos os canais');
  assert(masterChannels.every(c => c.tenant_id === null), 'Master deve ter tenant_id nulo');
  assert(tenant1Channels.every(c => c.tenant_id === 1), 'Tenant 1 deve ter apenas canais do tenant 1');
  console.log(`✅ [4/7] Filtros de canais validados: Total=${allChannels.length}, Master=${masterChannels.length}, Tenant1=${tenant1Channels.length}`);

  // 5. Testar Formatação da Copy de Achadinhos (Preço Riscado, Desconto %, CTA)
  const formattedCopy = achadinhosService.formatAchadinhoMessage({
    title: 'Smartwatch Ultra Pro 9 à Prova Dágua',
    platform: 'Shopee',
    product_price: 69.90,
    original_price: 199.90,
    affiliate_url: 'https://shope.ee/teste123',
    pitch_copy: 'Melhor custo-benefício com bateria para 7 dias!',
    template_style: 'fire_sale'
  });

  assert(formattedCopy.includes('🔥 *ACHADINHO DO DIA!*'), 'Deve conter header chamativo');
  assert(formattedCopy.includes('Loja: *Shopee*'), 'Deve conter nome da plataforma');
  assert(formattedCopy.includes('~R$ 199,90~'), 'Deve conter preço original riscado');
  assert(formattedCopy.includes('*R$ 69,90*'), 'Deve conter preço promocional');
  assert(formattedCopy.includes('65% OFF'), 'Deve calcular porcentagem de desconto');
  assert(formattedCopy.includes('https://shope.ee/teste123'), 'Deve conter link de afiliado');
  console.log('✅ [5/7] Formatação de copy persuasiva de achadinhos validada com sucesso:');
  console.log('--------------------------------------------------');
  console.log(formattedCopy);
  console.log('--------------------------------------------------');

  // 6. Testar Disparo e Registro de Log
  const sampleLink = models.createAffiliateLink({
    title: 'Fone Bluetooth Sem Fio TWS Air',
    platform: 'Shopee',
    affiliate_url: 'https://shope.ee/fone-tws-teste',
    product_price: 39.90,
    original_price: 89.90,
    image_url: 'https://exemplo.com/fone.jpg',
    commission_percent: 10.0
  });

  const postResult = await achadinhosService.postToChannel(masterGroup, sampleLink);
  assert(postResult && postResult.channelId === masterGroup.id, 'Resultado de postagem inválido');
  console.log(`✅ [6/7] Postagem para canal disparada (status: ${postResult.status})`);

  // Verificar logs gravados no banco
  const logs = models.getAchadinhosPostsLog({ channelId: masterGroup.id, limit: 10 });
  assert(logs.length > 0, 'Deve ter registrado o post na tabela de logs');
  console.log(`✅ Log verificado: Post #${logs[0].id} para ${logs[0].target_jid} gravado com status "${logs[0].status}"`);

  // 7. Testar Auto-Afiliação integrada com Fluxo de Achadinhos
  const autoAffResult = await affiliatePlatformService.autoAffiliateProduct({
    productUrl: 'https://produto.mercadolivre.com.br/MLB-999999999-relogio-digital-led-_JM',
    title: 'Relógio Digital LED Esportivo',
    price: 49.90,
    original_price: 99.90,
    flows: ['achadinhos']
  });

  assert(autoAffResult.success, 'Auto-afiliação deve retornar sucesso');
  assert(autoAffResult.distribution.achadinhos, 'Deve conter resultado de distribuição de achadinhos');
  console.log(`✅ [7/7] Auto-Afiliação com postagem em achadinhos validada com 100% de êxito! Link gerado: ${autoAffResult.generatedUrl}`);

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO! A funcionalidade de Grupos e Canais de Achadinhos está 100% operacional.');
}

runTests().catch(err => {
  console.error('❌ Falha no teste:', err);
  process.exit(1);
});

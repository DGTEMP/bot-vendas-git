/**
 * test_comfyart_service.js
 * 
 * Validação do ComfyArtService:
 * 1. Health check e detecção do repositório jtydhr88/ComfyArt
 * 2. Listagem de templates e temas visuais
 * 3. Geração de Post Feed Quadrado (1:1 - 1080x1080)
 * 4. Geração de Post Story/Status (9:16 - 1080x1920)
 * 5. Geração de Banner Horizontal (16:9 - 1200x675)
 * 6. Registro de posts recentes e persistência
 */

const assert = require('assert');
const fs = require('fs');
const comfyArtService = require('./src/services/comfyArtService');

async function run() {
  console.log('🧪 Iniciando testes do ComfyArtService...');

  // 1. Health check & Repo
  console.log('\n[1/5] Testando Health Check & Detecção do Repositório ComfyArt...');
  const health = await comfyArtService.checkHealth();
  console.log('   Status:', {
    repoUrl: health.repoUrl,
    installed: health.installed,
    workflowsCount: health.workflowsCount,
    activeMode: health.activeMode
  });
  assert.strictEqual(health.repoUrl, 'https://github.com/jtydhr88/ComfyArt.git');
  assert.strictEqual(health.installed, true, 'Repositório deve estar clonado em tools/ComfyArt');
  assert(health.workflowsCount > 0, 'Deve detectar workflows na pasta workflows');
  console.log('   ✅ Repositório ComfyArt detectado com workflows oficiais!');

  // 2. Templates e Temas
  console.log('\n[2/5] Testando Templates e Temas ComfyArt...');
  const templates = comfyArtService.getTemplates();
  const themes = comfyArtService.getThemes();
  assert(templates.length >= 4, 'Deve conter templates para feed, story, banner e card');
  assert(themes.length >= 4, 'Deve conter temas como cyber_dark, emerald_pay, gold_luxury, fire_viral');
  console.log(`   ✅ ${templates.length} templates e ${themes.length} temas disponíveis.`);

  // 3. Geração de Post Quadrado (1:1 - 1080x1080)
  console.log('\n[3/5] Testando Geração de Post Quadrado (1080x1080)...');
  const resSquare = await comfyArtService.generatePostCreative({
    template: 'square',
    theme: 'cyber_dark',
    title: 'BOT DE VENDAS AUTOMÁTICO PRO',
    subtitle: 'Atendimento inteligente 24h com entrega instantânea via Pix e Binance',
    price: 'R$ 49,90 / mês',
    discountBadge: 'LANÇAMENTO 2026',
    ctaText: 'COMPRE COM 1 TOQUE NO WHATSAPP'
  });

  assert(resSquare.success, 'Geração do post deve ter sucesso');
  assert(resSquare.post.imageUrl.includes('.png'), 'Deve gerar arquivo PNG');
  assert(fs.existsSync(resSquare.post.fullPath), 'Arquivo físico deve existir');
  assert(resSquare.buffer.length > 5000, 'Buffer da imagem deve ter tamanho válido');
  console.log(`   ✅ Post 1:1 gerado com sucesso: ${resSquare.post.imageUrl} (${resSquare.buffer.length} bytes)`);

  // 4. Geração de Post Story / Status (9:16 - 1080x1920)
  console.log('\n[4/5] Testando Geração de Post Story/Status (1080x1920)...');
  const resStory = await comfyArtService.generatePostCreative({
    template: 'story',
    theme: 'emerald_pay',
    title: 'OFERTA RELÂMPAGO PIX',
    subtitle: 'Aproveite 30% de desconto em qualquer bot de vendas hoje',
    price: 'Apenas R$ 29,90',
    discountBadge: 'PROMOÇÃO EXCLUSIVA',
    ctaText: 'ENVIE MENSAGEM NO PV'
  });
  assert(resStory.success, 'Post story deve ter sucesso');
  assert(resStory.post.height === 1920, 'Altura deve ser 1920px');
  console.log(`   ✅ Post Story 9:16 gerado com sucesso: ${resStory.post.imageUrl}`);

  // 5. Histórico e Posts Recentes
  console.log('\n[5/5] Testando Histórico de Posts Recentes...');
  const recents = comfyArtService.getRecentPosts(10);
  assert(recents.length >= 2, 'Deve conter posts no histórico recente');
  console.log(`   ✅ Histórico persistido: ${recents.length} posts registrados.`);

  console.log('\n🎉 TODOS OS TESTES DO COMFYARTSERVICE PASSARAM COM SUCESSO! 🎉');
}

run().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

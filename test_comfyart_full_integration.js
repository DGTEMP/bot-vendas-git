const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('🚀 Iniciando testes completos de integração do ComfyArt...');

  // 1. Testar Serviço ComfyArt
  console.log('\n--- Teste 1: Serviço ComfyArt (checkStatus, templates, repo) ---');
  const comfyArtService = require('./src/services/comfyArtService');
  const status = await comfyArtService.checkStatus();
  console.log('Status ComfyArt:', status);
  assert(status.repoCloned === true, 'Repositório tools/ComfyArt deve estar clonado');
  assert(status.officialWorkflowsCount >= 30, 'Deve listar workflows oficiais do ComfyArt (esperado >= 30)');
  assert(status.endpoint, 'Deve possuir endpoint');

  const templates = comfyArtService.getTemplates();
  console.log(`Templates carregados: ${templates.length}`);
  assert(templates.length === 5, 'Deve possuir 5 templates pré-configurados');
  assert(templates.find(t => t.id === 'square' && t.width === 1080 && t.height === 1080), 'Template square inválido');
  assert(templates.find(t => t.id === 'story' && t.width === 1080 && t.height === 1920), 'Template story inválido');

  // 2. Testar Geração de Post Criativo em Alta Resolução (SVG -> PNG)
  console.log('\n--- Teste 2: Geração de Criativo HD (PNG) ---');
  const genSquare = await comfyArtService.generatePostCreative({
    template: 'square',
    theme: 'cyber_dark',
    title: 'BOT DE VENDAS ULTIMATE',
    subtitle: 'Automação WhatsApp 24h com Pix e ComfyArt IA',
    price: 'R$ 97,00',
    discount_badge: 'MEGA LANÇAMENTO',
    cta_text: 'GARANTA SEU BOT AGORA'
  });
  console.log('Post Quadrado gerado:', genSquare);
  assert(genSquare.media_url, 'Deve retornar media_url');
  assert(fs.existsSync(genSquare.local_path), 'Arquivo PNG deve existir em disco');
  const stats = fs.statSync(genSquare.local_path);
  assert(stats.size > 10000, `Arquivo PNG deve ter tamanho válido (>10KB), obtido: ${stats.size} bytes`);

  // 3. Testar Histórico de Posts Recentes
  console.log('\n--- Teste 3: Histórico e Persistência de Posts Recentes ---');
  const recent = comfyArtService.getRecentPosts(5);
  console.log(`Total de posts no histórico: ${recent.length}`);
  assert(recent.length > 0, 'Histórico deve conter posts');
  assert(recent[0].id === genSquare.id, 'Primeiro item do histórico deve ser o último gerado');

  // 4. Testar Coluna media_url no DB de Posts Virais
  console.log('\n--- Teste 4: Modelos e Banco de Dados (viral_generated_posts) ---');
  const models = require('./src/db/models');
  const createdViral = models.createViralGeneratedPost({
    viral_captured_id: 1,
    title: 'POST COM ARTE TESTE',
    hook_variation: 'Gancho teste',
    body_content: 'Corpo teste',
    cta_content: 'CTA teste',
    full_content: 'Conteúdo completo',
    media_suggestion: 'Sugestão visual',
    media_url: genSquare.media_url,
    target_platform: 'whatsapp',
    tone: 'Persuasivo',
    objective: 'Vendas'
  });
  console.log('Post viral gerado com media_url:', createdViral);
  assert(createdViral.media_url === genSquare.media_url, 'media_url deve ser salvo e retornado');
  const retrievedViral = models.getViralGeneratedPostById(createdViral.id);
  assert(retrievedViral.media_url === genSquare.media_url, 'media_url deve persistir no banco');

  // 5. Testar Integração com WhatsApp Bot (!comfystatus e !comfyart)
  console.log('\n--- Teste 5: Bot WhatsApp (Comandos ComfyArt) ---');
  const botInstance = require('./src/bots/whatsappBot');

  let sentMessages = [];
  const mockSock = {
    user: { id: '5511999999999:1@s.whatsapp.net' },
    sendMessage: async (jid, payload) => {
      sentMessages.push({ jid, payload });
      return { key: { id: 'MSG_' + Date.now() } };
    }
  };

  // Teste de !comfystatus
  await botInstance.handleComfyArtCommand(mockSock, '5511888888888@s.whatsapp.net', '!comfystatus', true);
  assert(sentMessages.length === 1, 'Deve ter enviado resposta para !comfystatus');
  assert(sentMessages[0].payload.text.includes('COMFYART STUDIO'), 'Resposta de status deve mencionar ComfyArt');
  console.log('✅ Comando !comfystatus respondeu com sucesso!');

  // Teste de !comfyart <produto>
  sentMessages = [];
  await botInstance.handleComfyArtCommand(mockSock, '5511888888888@s.whatsapp.net', '!comfyart Licença Pro WhatsApp', true);
  console.log(`Mensagens enviadas para !comfyart: ${sentMessages.length}`);
  assert(sentMessages.length >= 2, 'Deve ter enviado aviso de renderização e depois a imagem com legenda');
  const imgMsg = sentMessages.find(m => m.payload.image);
  assert(imgMsg, 'Deve ter enviado mensagem contendo imagem');
  assert(Buffer.isBuffer(imgMsg.payload.image), 'Imagem enviada deve ser um Buffer válido');
  assert(imgMsg.payload.caption.includes('LICENÇA PRO WHATSAPP'), 'Legenda deve conter o nome do produto');
  console.log('✅ Comando !comfyart enviou imagem em alta resolução e legenda comercial!');

  // 6. Testar Integração no Radar Viral (generateOurPost com media_url automático)
  console.log('\n--- Teste 6: Radar Viral com Geração Automática de Arte ---');
  const viralRadarService = require('./src/services/viralRadarService');
  // Se houver post capturado, gera post; caso não, cria um mock capturado
  let capturedPosts = models.getViralCapturedPosts({ limit: 1 });
  let capId;
  if (capturedPosts.length > 0) {
    capId = capturedPosts[0].id;
  } else {
    const prof = await viralRadarService.addTrackedProfile({
      platform: 'instagram',
      username: 'teste.viral',
      niche: 'Automação'
    });
    const c = models.createViralCapturedPost({
      profile_id: prof.id,
      source_platform: 'instagram',
      source_post_id: 'post_teste_123',
      source_username: 'teste.viral',
      hook_text: 'Como faturei R$ 10.000 no WhatsApp sem gastar com anúncios',
      likes_count: 5000,
      comments_count: 450,
      viral_score: 92
    });
    capId = c.id;
  }

  const generatedViralResult = await viralRadarService.generateOurPost({
    viralPostId: capId,
    targetPlatform: 'whatsapp'
  });
  console.log('Viral post gerado:', {
    id: generatedViralResult.post.id,
    title: generatedViralResult.post.title,
    media_url: generatedViralResult.post.media_url
  });
  assert(generatedViralResult.post.media_url, 'Post viral gerado deve possuir media_url gerado pelo ComfyArt');
  assert(generatedViralResult.post.media_url.includes('/uploads/comfyart/'), 'media_url deve apontar para uploads do ComfyArt');

  console.log('\n🎉 TODOS OS 6 TESTES DE INTEGRAÇÃO DO COMFYART PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE DE INTEGRAÇÃO:', err);
  process.exit(1);
});

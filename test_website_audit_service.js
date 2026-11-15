const assert = require('assert');
const websiteAuditService = require('./src/services/websiteAuditService');
const cognitiveService = require('./src/services/cognitiveSalesService');
const knowledgeBaseService = require('./src/services/knowledgeBaseService');

console.log('🧪 ========================================================');
console.log('🚀 TESTE: WEBSITE AUDIT SERVICE (PAGESPEED, SEO & TECH)');
console.log('========================================================\n');

async function runTests() {
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(err);
    }
  }

  // 1. Normalização de URLs
  await test('WebsiteAudit: normalizeUrl sanitiza e valida URLs corretamente', async () => {
    assert.strictEqual(websiteAuditService.normalizeUrl('meusite.com.br'), 'https://meusite.com.br/');
    assert.strictEqual(websiteAuditService.normalizeUrl('https://loja.com'), 'https://loja.com/');
    assert.strictEqual(websiteAuditService.normalizeUrl('http://app.io/checkout'), 'http://app.io/checkout');
    assert.strictEqual(websiteAuditService.normalizeUrl('<https://site.com.br/teste>'), 'https://site.com.br/teste');
    assert.strictEqual(websiteAuditService.normalizeUrl('not-a-domain'), null);
    assert.strictEqual(websiteAuditService.normalizeUrl(''), null);
  });

  // 2. Extração de URLs em mensagens de conversa
  await test('WebsiteAudit: extractUrlFromText captura links em mensagens de clientes', async () => {
    const text1 = 'Oi amigo, você pode ver porque meu site meudominio.com.br tá tão lento?';
    assert.strictEqual(websiteAuditService.extractUrlFromText(text1), 'https://meudominio.com.br/');

    const text2 = 'Minha loja é https://minhaloja.store/promocao dá uma olhada';
    assert.strictEqual(websiteAuditService.extractUrlFromText(text2), 'https://minhaloja.store/promocao');

    const text3 = 'Boa tarde, tudo bem? Queria saber sobre o bot de vocês';
    assert.strictEqual(websiteAuditService.extractUrlFromText(text3), null);
  });

  // 3. Auditoria de PageSpeed (Métricas Core Web Vitals)
  await test('WebsiteAudit: analyzePageSpeed extrai métricas de velocidade e Core Web Vitals', async () => {
    process.env.NODE_ENV = 'test';
    const res = await websiteAuditService.analyzePageSpeed('https://exemplo.com.br');

    assert.ok(res.success, 'Deve indicar sucesso');
    assert.ok(typeof res.scores.performance === 'number', 'Deve conter pontuação de performance');
    assert.ok(typeof res.scores.seo === 'number', 'Deve conter pontuação de SEO');
    assert.ok(res.metrics.lcp, 'Deve conter métrica LCP');
    assert.ok(res.metrics.fcp, 'Deve conter métrica FCP');
    assert.ok(res.metrics.cls, 'Deve conter métrica CLS');
    assert.ok(res.opportunities.length > 0, 'Deve listar oportunidades de otimização');
  });

  // 4. Inspeção de HTML, SEO, Segurança, Pixels e Tech Stack
  await test('WebsiteAudit: inspectWebsiteHtmlAndTech identifica SEO, Pixels, CMS e WhatsApp', async () => {
    // Teste com simulação de HTML rico
    const sampleHtml = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <title>Loja Oficial Exemplo - Calçados & Roupas</title>
        <meta name="description" content="Compre os melhores tênis com frete grátis e entrega rápida em todo Brasil.">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta property="og:title" content="Loja Oficial Exemplo">
        <meta property="og:image" content="https://exemplo.com.br/banner.jpg">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Store"}</script>
        <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '123456');</script>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
      </head>
      <body>
        <h1>Bem-vindo à Loja Exemplo</h1>
        <h2>Coleção de Verão</h2>
        <div class="woocommerce-cart">Carrinho</div>
        <a href="https://api.whatsapp.com/send?phone=5511999998888&text=Ol%C3%A1%20gostaria%20de%20comprar">Fale no WhatsApp</a>
      </body>
      </html>
    `;

    // Injeta inspeção direta com o parser
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        status: 200,
        headers: new Map([
          ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
          ['server', 'cloudflare'],
          ['cf-ray', '87654321abcd']
        ]),
        text: async () => sampleHtml
      };
    };

    try {
      const inspectRes = await websiteAuditService.inspectWebsiteHtmlAndTech('https://exemplo.com.br');
      assert.strictEqual(inspectRes.seo.hasTitle, true);
      assert.strictEqual(inspectRes.seo.title, 'Loja Oficial Exemplo - Calçados & Roupas');
      assert.strictEqual(inspectRes.seo.hasDescription, true);
      assert.strictEqual(inspectRes.seo.hasOpenGraph, true);
      assert.strictEqual(inspectRes.seo.hasJsonLd, true);
      assert.strictEqual(inspectRes.seo.h1Count, 1);
      assert.strictEqual(inspectRes.seo.h2Count, 1);

      // Segurança
      assert.strictEqual(inspectRes.security.isHttps, true);
      assert.strictEqual(inspectRes.security.hasHsts, true);
      assert.strictEqual(inspectRes.security.isCloudflare, true);

      // Tech Stack
      const stackNames = inspectRes.techStack.map(s => s.name);
      assert.ok(stackNames.includes('WooCommerce'), 'Deve identificar WooCommerce');

      // Pixels
      const pixelNames = inspectRes.pixels.map(p => p.name);
      assert.ok(pixelNames.some(p => p.includes('Meta Pixel')), 'Deve identificar Meta Pixel');
      assert.ok(pixelNames.some(p => p.includes('Google Analytics 4')), 'Deve identificar GA4');

      // WhatsApp
      assert.strictEqual(inspectRes.whatsappIntegration.hasButton, true);
      assert.strictEqual(inspectRes.whatsappIntegration.number, '5511999998888');
      assert.strictEqual(inspectRes.whatsappIntegration.hasPreFilledMessage, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 5. Auditoria Completa Integrada
  await test('WebsiteAudit: runFullAudit compila riscos críticos e soluções do catálogo', async () => {
    process.env.NODE_ENV = 'test';
    const fullAudit = await websiteAuditService.runFullAudit('https://exemplo.com.br');

    assert.ok(fullAudit.pageSpeed, 'Deve conter relatório PageSpeed');
    assert.ok(fullAudit.tech, 'Deve conter inspeção técnica');
    assert.ok(Array.isArray(fullAudit.criticalIssues), 'Deve compilar problemas críticos');
    assert.ok(Array.isArray(fullAudit.opportunities), 'Deve compilar oportunidades');
    assert.ok(fullAudit.recommendedSolutions.length > 0, 'Deve sugerir soluções com preço e escopo');
  });

  // 6. Formatação do Relatório WhatsApp e Áudio de Fechamento
  await test('WebsiteAudit: formatWhatsAppReport gera relatório visual, áudio e imagem', async () => {
    process.env.NODE_ENV = 'test';
    const fullAudit = await websiteAuditService.runFullAudit('https://exemplo.com.br');
    const report = websiteAuditService.formatWhatsAppReport(fullAudit);

    assert.ok(report.text.includes('RAIO-X TÉCNICO & PERFORMANCE GOOGLE'), 'Deve ter cabeçalho de alta autoridade');
    assert.ok(report.text.includes('PONTUAÇÃO NO GOOGLE PAGESPEED'), 'Deve ter seção de PageSpeed');
    assert.ok(report.text.includes('Tempo de Carregamento (LCP)'), 'Deve conter LCP');
    assert.ok(report.text.includes('PLANO DE IMPLEMENTAÇÃO SUGERIDO'), 'Deve ter propostas comerciais');
    assert.ok(report.audioScript.includes('Fala amigo! Acabei de rodar um raio-x técnico completo'), 'Deve gerar áudio consultivo');
    assert.strictEqual(report.imagePreset, 'site_portal');
  });

  // 7. Base de Conhecimento RAG contextual
  await test('KnowledgeBase: getContextualPlaybook para PageSpeed orienta diagnóstico e venda', async () => {
    const playbook = knowledgeBaseService.getContextualPlaybook({
      text: 'meu site tá muito lento no celular, me ajuda a ver o pagespeed?',
      stage: 'QUALIFICACAO'
    });

    assert.ok(/pagespeed/i.test(playbook), 'Playbook deve conter táticas de PageSpeed');
    assert.ok(/core web vitals/i.test(playbook), 'Playbook deve orientar Core Web Vitals');
    assert.ok(playbook.includes('800'), 'Playbook deve mencionar faixa de preço do serviço');
  });

  // 8. Resposta Consultiva Automática quando o cliente envia link
  await test('CognitiveSales: Cliente enviando domínio ativa diagnóstico com áudio + imagem + escopo', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'dá uma olhada no meu site meudominio.com.br que acho que tá lento',
      profile: { buying_stage: 'CONSCIENCIA', company_niche: 'Geral' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio explicativo [AUDIO: ...]');
    assert.ok(/\[imagem\s*:\s*pagespeed/i.test(res), 'Deve conter imagem [IMAGEM: pagespeed ...]');
    assert.ok(/Google PageSpeed/i.test(res), 'Deve citar Google PageSpeed');
    assert.ok(/Core Web Vitals/i.test(res), 'Deve citar Core Web Vitals');
    assert.ok(/800/i.test(res), 'Deve apresentar valor de serviço de otimização');
  });

  console.log(`\n========================================================`);
  console.log(`📊 RESULTADO DOS TESTES: ${passed}/${total} PASSARAM`);
  console.log(`========================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

const assert = require('assert');
const path = require('path');
const cognitiveService = require('./src/services/cognitiveSalesService');
const knowledgeBaseService = require('./src/services/knowledgeBaseService');
const whatsappBot = require('./src/bots/whatsappBot');

console.log('🧪 ========================================================');
console.log('🚀 TESTE: RETENÇÃO MÁXIMA & FECHAMENTO COM ÁUDIO + IMAGEM + ESCOPO');
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

  // 1. Teste de Playbook Contextual na Base de Conhecimento
  await test('KnowledgeBase: getContextualPlaybook para HOW_IT_WORKS e PRECO orienta Trinca de Conversão', async () => {
    const playbookHow = knowledgeBaseService.getContextualPlaybook({
      text: 'como funciona o sistema?',
      stage: 'CONSCIENCIA',
      intent: 'HOW_IT_WORKS'
    });
    assert.ok(playbookHow.includes('[AUDIO:'), 'Playbook de HowItWorks deve instruir áudio [AUDIO: ...]');
    assert.ok(playbookHow.includes('[IMAGEM:'), 'Playbook de HowItWorks deve instruir imagem demonstrativa');
    assert.ok(playbookHow.includes('ESCOPO'), 'Playbook de HowItWorks deve instruir escopo');

    const playbookPrice = knowledgeBaseService.getContextualPlaybook({
      text: 'quanto custa?',
      stage: 'PROPOSTA',
      intent: 'PRICE_QUERY'
    });
    assert.ok(playbookPrice.includes('[AUDIO:'), 'Playbook de Preço deve instruir áudio [AUDIO: ...]');
    assert.ok(playbookPrice.includes('[IMAGEM:'), 'Playbook de Preço deve instruir imagem demonstrativa');
  });

  // 2. Teste da resposta consultiva para "como funciona"
  await test('CognitiveSales: Gatilho "como funciona" não se contém e entrega áudio + imagem + escopo', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'me explica como funciona o bot',
      profile: { buying_stage: 'CONSCIENCIA', company_niche: 'Geral' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio PTT [AUDIO: ...]');
    assert.ok(/\[imagem\s*:/i.test(res), 'Deve conter imagem de demonstração [IMAGEM: ...]');
    assert.ok(/ESCOPO/i.test(res), 'Deve conter escopo dos entregáveis');
    assert.ok(/garantia/i.test(res), 'Deve citar garantia');
  });

  // 3. Teste da resposta consultiva para tabela de preços
  await test('CognitiveSales: Gatilho "quanto custa" entrega áudio + imagem + tabela de planos', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'quanto custa o plano de vocês?',
      profile: { buying_stage: 'PROPOSTA', company_niche: 'Geral' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio PTT explicativo [AUDIO: ...]');
    assert.ok(/\[imagem\s*:\s*paybot/i.test(res), 'Deve conter imagem da tabela de planos [IMAGEM: paybot ...]');
    assert.ok(/69,90/i.test(res), 'Deve conter plano mensal acessível');
    assert.ok(/497/i.test(res), 'Deve conter licença anual');
    assert.ok(/ESCOPO/i.test(res), 'Deve conter escopo de planos');
  });

  // 4. Teste da resposta consultiva para Bot de Grupos
  await test('CognitiveSales: Pergunta de bot para grupos entrega áudio + imagem bot_grupos + escopo de moderação', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'vocês têm bot de grupo com anti-trava e moderação?',
      profile: { buying_stage: 'CONSCIENCIA', company_niche: 'Grupos' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio explicativo de grupos');
    assert.ok(/\[imagem\s*:\s*bot_grupos/i.test(res), 'Deve conter imagem demonstrativa [IMAGEM: bot_grupos ...]');
    assert.ok(/anti-trava|anti-spam/i.test(res), 'Deve conter escopo anti-trava/spam');
    assert.ok(/49,90/i.test(res), 'Deve conter opções de planos de grupo');
  });

  // 5. Teste da resposta consultiva para Desenvolvimento Sob Medida / App Mobile
  await test('CognitiveSales: Pergunta de desenvolvimento sob medida entrega áudio + imagem app_mobile + escopo', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'vocês desenvolvem aplicativo mobile para android e ios?',
      profile: { buying_stage: 'CONSCIENCIA', company_niche: 'Desenvolvimento' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio de consultor técnico');
    assert.ok(/\[imagem\s*:\s*app_mobile/i.test(res), 'Deve conter imagem [IMAGEM: app_mobile ...]');
    assert.ok(/Figma|UI\/UX/i.test(res), 'Deve citar metodologia de design');
    assert.ok(/ESCOPO/i.test(res), 'Deve detalhar escopo do projeto');
  });

  // 6. Teste da resposta para objeção de Confiança / Garantia
  await test('CognitiveSales: Objeção de segurança/garantia entrega áudio de reversão de risco + imagem garantia + 7 dias', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'é confiável? e se eu não gostar, tem garantia?',
      profile: { buying_stage: 'NEGOCIACAO', company_niche: 'Geral', main_objection: 'CONFIANCA_GARANTIA' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio de garantia');
    assert.ok(/\[imagem\s*:\s*garantia/i.test(res), 'Deve conter imagem da garantia');
    assert.ok(/7 dias de garantia/i.test(res), 'Deve citar os 7 dias incondicionais');
  });

  // 7. Teste da resposta para Fechamento de Venda
  await test('CognitiveSales: Fechamento entrega áudio de boas-vindas + imagem + resumo do pedido + CTA Pix', async () => {
    const res = cognitiveService.generateHeuristicConsultativeReply({
      text: 'quero fechar agora, manda o pix!',
      profile: { buying_stage: 'FECHAMENTO', company_niche: 'Geral' },
      isMasterBot: true,
      storeBase: 'https://paybot.store'
    });

    assert.ok(/\[audio\s*:/i.test(res), 'Deve conter áudio de boas-vindas/reserva');
    assert.ok(/\[imagem\s*:\s*paybot/i.test(res), 'Deve conter imagem do produto/ativação');
    assert.ok(/RESUMO DO PEDIDO/i.test(res), 'Deve conter resumo do pedido');
    assert.ok(/Pix/i.test(res), 'Deve conter CTA Pix');
  });

  // 8. Teste do Despachante sendHumanSplitMessages (Tokenizer de Mídia)
  await test('WhatsAppBot: sendHumanSplitMessages divide texto, áudio e imagens sem perder conteúdo', async () => {
    process.env.NODE_ENV = 'test';
    const fakeSock = {
      presenceUpdates: [],
      sentMessages: [],
      async sendPresenceUpdate(state, jid) {
        this.presenceUpdates.push({ state, jid });
      },
      async sendMessage(jid, payload) {
        this.sentMessages.push({ jid, payload });
        return { key: { id: `FAKE_MSG_${Date.now()}_${Math.random()}` } };
      }
    };

    const payload = `Olá, tudo bem?\n\n` +
      `[AUDIO: Fala amigo, deixa eu te explicar como a gente automatiza tudo pra você!]\n\n` +
      `[IMAGEM: bot_vendas | Demonstração da Automação]\n\n` +
      `Aqui está o escopo completo dos entregáveis. Qualquer dúvida estou à disposição!`;

    const results = await whatsappBot.sendHumanSplitMessages(fakeSock, '5511987654321', payload, { forceFleetDispatch: true });

    assert.ok(results.length >= 3, `Deveria ter enviado pelo menos 3 mensagens/mídias. Enviou: ${results.length}`);
    
    // Verifica se as mensagens enviadas incluem imagem e texto/áudio
    const hasImage = fakeSock.sentMessages.some(m => m.payload.image);
    assert.ok(hasImage, 'Deveria ter enviado uma mensagem com imagem');

    const imageMsg = fakeSock.sentMessages.find(m => m.payload.image);
    assert.ok(imageMsg.payload.image.url, 'Imagem deve ter URL resolvida');
    assert.strictEqual(imageMsg.payload.caption, 'Demonstração da Automação');
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

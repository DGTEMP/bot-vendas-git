const assert = require('assert');
const models = require('./src/db/models');
const nlpService = require('./src/services/nlpService');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');

async function runTests() {
  console.log('🧪 [TESTES] Iniciando Suíte de Testes de Inteligência Conversacional & Qualidade de Diálogo...\n');

  // ==============================================================
  // 1. CLASSIFICAÇÃO DE INTENÇÕES (NLU SEMÂNTICO PT-BR)
  // ==============================================================
  console.log('--- 1. Classificação Semântica de Intenções ---');
  
  const testCases = [
    { text: 'Pronto, acabei de comprar pelo link!', expected: 'CONFIRM_PURCHASE' },
    { text: 'já comprei', expected: 'CONFIRM_PURCHASE' },
    { text: 'comprei pelo link', expected: 'CONFIRM_PURCHASE' },
    { text: 'acabei de pagar', expected: 'CONFIRM_PURCHASE' },
    { text: 'paguei pelo link', expected: 'CONFIRM_PURCHASE' },
    { text: 'consegui comprar aqui', expected: 'CONFIRM_PURCHASE' },
    { text: 'já fiz o pix', expected: 'CONFIRM_PURCHASE' },
    { text: 'olha o comprovante', expected: 'CONFIRM_PURCHASE' },
    { text: 'Adorei! Me passa o link para comprar agora', expected: 'BUY_INTENT' },
    { text: 'quero o link de compra', expected: 'BUY_INTENT' },
    { text: 'Bacana, me conta mais sobre isso', expected: 'HOW_IT_WORKS' },
    { text: 'como funciona na prática?', expected: 'HOW_IT_WORKS' },
    { text: 'quanto custa?', expected: 'PRICE_QUERY' },
    { text: 'tem garantia ou é golpe?', expected: 'TRUST_AND_GUARANTEE' }
  ];

  for (const tc of testCases) {
    const normalized = nlpService.normalizeText(tc.text);
    const { intent, confidence } = nlpService.classifyIntent(normalized);
    assert.strictEqual(
      intent,
      tc.expected,
      `Falha na intenção para: "${tc.text}". Esperado: ${tc.expected}, Recebido: ${intent}`
    );
    assert.ok(confidence >= 0.90, `Confiança baixa (${confidence}) para: "${tc.text}"`);
    console.log(`  ✓ Intenção detectada com precisão: "${tc.text}" -> ${intent} (${(confidence * 100).toFixed(0)}%)`);
  }

  // ==============================================================
  // 2. ELIMINAÇÃO ABSOLUTA DE "AMIGO(A)" E VOCATIVOS ROBÓTICOS
  // ==============================================================
  console.log('\n--- 2. Eliminação de Vocativos Artificiais ("amigo(a)") ---');

  // Caso A: Lead anônimo (sem nome)
  const resNoName = await nlpService.processMessage({
    text: 'Pronto, acabei de comprar pelo link!',
    customerName: null
  });
  assert.ok(!resNoName.replyText.includes('amigo(a)'), 'Resposta não deve conter "amigo(a)"');
  assert.ok(!resNoName.replyText.includes('Amigo(a)'), 'Resposta não deve conter "Amigo(a)"');
  assert.ok(!resNoName.replyText.includes('AMIGO(A)'), 'Resposta não deve conter "AMIGO(A)"');
  assert.ok(resNoName.replyText.includes('PARABÉNS PELA COMPRA') || resNoName.replyText.includes('Perfeito'), 'Deve conter abertura natural');
  console.log('  ✓ Lead sem nome: Resposta sem "amigo(a)":\n    ', resNoName.replyText.split('\n')[0]);

  // Caso B: Lead com nome real
  const resWithName = await nlpService.processMessage({
    text: 'Pronto, acabei de comprar pelo link!',
    customerName: 'Carlos Silveira'
  });
  assert.ok(resWithName.replyText.includes('Carlos'), 'Deve utilizar o primeiro nome do lead');
  assert.ok(!resWithName.replyText.includes('amigo(a)'), 'Não deve conter "amigo(a)"');
  console.log('  ✓ Lead com nome: Resposta personalizada:\n    ', resWithName.replyText.split('\n')[0]);

  // Caso C: Formatação de campanha sem nome
  const campaignTpl = '{Olá|Oi} {nome}! Conheça o {produto} aqui: {link}';
  const formattedNoName = models.formatCampaignMessage(campaignTpl, { name: '' }, { product_name: 'Super Bot', affiliate_url: 'https://pay.bot/vip' });
  assert.ok(!formattedNoName.includes('amigo(a)'), 'formatCampaignMessage não deve inserir "amigo(a)"');
  assert.ok(!formattedNoName.includes('undefined'), 'Não deve conter undefined');
  assert.ok(formattedNoName.includes('Super Bot'), 'Deve conter o nome do produto');
  console.log('  ✓ formatCampaignMessage sem nome:', formattedNoName);

  // ==============================================================
  // 3. DIÁLOGO DO CHIP / FUNIL DE AQUECIMENTO (CENÁRIO DO USUÁRIO)
  // ==============================================================
  console.log('\n--- 3. Simulação Completa do Diálogo do Usuário (Sub-Bot / Chip) ---');
  
  const testPhone = '5511999887766';
  
  // Limpa conversas ou logs anteriores do lead de teste
  const db = require('./src/db/database');
  db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM funnel_interactions_log WHERE lead_phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);

  // Captura as mensagens enviadas pelo whatsappArmyService
  const sentMessages = [];
  const originalSendArmyMessage = whatsappArmyService.sendArmyMessage;
  whatsappArmyService.sendArmyMessage = async (instId, phone, msgText) => {
    sentMessages.push({ instId, phone, msgText });
    return true;
  };

  try {
    // --- TURNO 1: Lead demonstra interesse e pede mais informações ---
    console.log('  [Turno 1] Lead: "Bacana, me conta mais sobre isso"');
    await whatsappArmyService.handleIncomingLeadMessage('1', `${testPhone}@s.whatsapp.net`, 'Bacana, me conta mais sobre isso');

    assert.ok(sentMessages.length >= 1, 'Chip deve enviar resposta no Turno 1');
    const reply1 = sentMessages[sentMessages.length - 1].msgText;
    console.log('  🤖 Bot:', reply1);

    // Validações do Turno 1:
    assert.ok(!reply1.includes('Hoje muita gente tem dificuldade de ter consistência'), 'Não deve usar template descontextualizado de consistência');
    assert.ok(!reply1.includes('amigo(a)'), 'Não deve conter amigo(a)');
    assert.ok(reply1.includes('objetivo') || reply1.includes('foco') || reply1.includes('metodologia') || reply1.includes('prática'), 'Deve explicar o objetivo do produto');

    // --- TURNO 2: Lead pede o link para comprar ---
    console.log('\n  [Turno 2] Lead: "Adorei! Me passa o link para comprar agora"');
    await whatsappArmyService.handleIncomingLeadMessage('1', `${testPhone}@s.whatsapp.net`, 'Adorei! Me passa o link para comprar agora');

    assert.ok(sentMessages.length >= 2, 'Chip deve enviar resposta no Turno 2');
    const reply2 = sentMessages[sentMessages.length - 1].msgText;
    console.log('  🤖 Bot:', reply2);

    // Validações do Turno 2:
    assert.ok(reply2.includes('http') || reply2.includes('link') || reply2.includes('exclusiv'), 'Deve enviar o link de compra');
    assert.ok(!reply2.includes('amigo(a)'), 'Não deve conter amigo(a)');

    // --- TURNO 3: Lead conclui a compra e avisa pelo WhatsApp ---
    console.log('\n  [Turno 3] Lead: "Pronto, acabei de comprar pelo link!"');
    await whatsappArmyService.handleIncomingLeadMessage('1', `${testPhone}@s.whatsapp.net`, 'Pronto, acabei de comprar pelo link!');

    assert.ok(sentMessages.length >= 3, 'Chip deve enviar resposta no Turno 3');
    const reply3 = sentMessages[sentMessages.length - 1].msgText;
    console.log('  🤖 Bot:', reply3);

    // Validações CRÍTICAS do Turno 3 (O bug relatado pelo usuário):
    assert.ok(!reply3.includes('Vi que você tem interesse no'), 'NUNCA deve resetar para a mensagem de primeiro contato');
    assert.ok(!reply3.includes('Posso te passar todos os detalhes e o código PIX promocional?'), 'NUNCA deve perguntar se quer código PIX de produto que acabou de comprar');
    assert.ok(!reply3.includes('amigo(a)'), 'Não deve conter amigo(a)');
    assert.ok(reply3.includes('registrei') || reply3.includes('validação') || reply3.includes('conferência') || reply3.includes('PARABÉNS') || reply3.includes('Perfeito'), 'Deve acolher a compra com sucesso');

    // Validação do estado no banco de dados:
    const conv = models.getLeadFunnelConversationByPhone(testPhone);
    assert.strictEqual(conv.current_stage, 'CONVERTED', 'Lead deve estar marcado como CONVERTED no funil');
    console.log('  ✓ Lead registrado como CONVERTED no banco de dados!');

    // --- TURNO 4: Mensagem posterior do cliente convertido (Pós-Venda) ---
    console.log('\n  [Turno 4] Lead: "Muito obrigado, fico no aguardo!"');
    await whatsappArmyService.handleIncomingLeadMessage('1', `${testPhone}@s.whatsapp.net`, 'Muito obrigado, fico no aguardo!');

    assert.ok(sentMessages.length >= 4, 'Chip deve responder no Turno 4');
    const reply4 = sentMessages[sentMessages.length - 1].msgText;
    console.log('  🤖 Bot:', reply4);

    // Validações do Turno 4:
    assert.ok(!reply4.includes('Vi que você tem interesse no'), 'Não deve vender novamente para cliente convertido');
    assert.ok(!reply4.includes('garantia incondicional de 7 dias'), 'Não deve mandar quebra de objeções para quem já comprou');
    assert.ok(reply4.includes('acessos') || reply4.includes('suporte') || reply4.includes('disposição'), 'Deve prestar acolhimento de suporte pós-venda');

  } finally {
    // Restaura mock
    whatsappArmyService.sendArmyMessage = originalSendArmyMessage;
    // Limpa dados de teste
    db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(testPhone);
    db.prepare('DELETE FROM funnel_interactions_log WHERE lead_phone = ?').run(testPhone);
    db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);
  }

  // ==============================================================
  // 4. MOTOR COGNITIVO CONSULTIVO OFFLINE & HUMANIZADOR
  // ==============================================================
  console.log('\n--- 4. Motor Cognitivo Consultivo & Humanizador Anti-Robô ---');
  
  const cognitiveReply = cognitiveSalesService.generateHeuristicConsultativeReply({
    profile: { phone: '5511999990000', buying_stage: 'DESCOBERTA', main_objection: 'NENHUMA' },
    firstName: 'Fernando',
    text: 'Bacana, me conta mais sobre isso',
    matchedProduct: { name: 'Licença Bot Scalper Pro', price_brl: 97.00 },
    nlpResult: { intent: 'HOW_IT_WORKS' }
  });

  console.log('  🤖 Resposta Heurística Consultiva:', cognitiveReply);
  assert.ok(cognitiveReply.includes('Fernando'), 'Deve cumprimentar Fernando');
  assert.ok(!cognitiveReply.includes('amigo(a)'), 'Não deve conter amigo(a)');
  assert.ok(cognitiveReply.includes('Licença Bot Scalper Pro'), 'Deve citar o produto de interesse');

  // Humanizador: remoção de clichês
  const cliches = 'Entendi perfeitamente! Com certeza! Maravilha! Seu acesso está liberado!!!';
  const humanized = cognitiveSalesService.humanizeResponse(cliches);
  assert.ok(!humanized.toLowerCase().includes('com certeza'), 'Remove com certeza');
  assert.ok(!humanized.toLowerCase().includes('maravilha'), 'Remove maravilha');
  assert.ok(!humanized.includes('!!!'), 'Normaliza exclamações excessivas');
  console.log('  ✓ Humanizador Anti-AI:', humanized);

  console.log('\n🎉 TODOS OS TESTES DE INTELIGÊNCIA CONVERSACIONAL PASSARAM COM 100% DE SUCESSO!\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

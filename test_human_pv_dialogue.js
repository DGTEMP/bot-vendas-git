process.env.NODE_ENV = 'test';
const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const nlpService = require('./src/services/nlpService');

async function runTests() {
  console.log('🚀 [TESTES] Iniciando Suíte de Testes do Atendimento 100% Humano no Privado (PV WhatsApp)...\n');

  // Configura modo padrão 'HUMANO'
  models.setSetting('WPP_PV_WELCOME_MODE', 'HUMANO');
  models.setSetting('WPP_PV_WELCOME_AUDIO_ENABLED', 'false');
  models.setSetting('BOT_NAME', 'PayBot Vendas');

  const sentMessages = [];
  const sentPresences = [];

  const fakeSock = {
    sendMessage: async (jid, content) => {
      if (content?.react) return { key: { id: 'REACT_' + Date.now() } };
      const txt = typeof content === 'string' ? content : content?.text;
      sentMessages.push({ jid, text: txt });
      return { key: { id: 'MSG_' + Date.now() } };
    },
    sendPresenceUpdate: async (type, to) => {
      sentPresences.push({ type, to, time: Date.now() });
    }
  };

  // ==============================================================
  // 1. PRIMEIRO CONTATO - PERSONA HUMANA COM SPLIT DE MENSAGENS
  // ==============================================================
  console.log('--- 1. Primeiro Contato no PV (Usuário Humano Real com Split de Textos) ---');

  // Turno A: Lead sem nome enviando "oi"
  sentMessages.length = 0;
  sentPresences.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511988880001@s.whatsapp.net', '', fakeSock);

  console.log('  🤖 Mensagens enviadas no acolhimento (sem nome):');
  sentMessages.forEach((m, idx) => console.log(`     Balão ${idx + 1}: "${m.text}"`));

  assert.strictEqual(sentMessages.length, 2, 'Deve enviar exatamente 2 balões curtos');
  assert.ok(sentMessages[0].text.startsWith('Opa, '), 'Balão 1 deve ser saudação natural e humana');
  assert.ok(sentMessages[1].text.includes('Tudo certo por aí?'), 'Balão 2 deve ser despretensioso ("Tudo certo por aí?") sem cara de bot prestativo');
  assert.ok(!sentMessages.some(m => /como posso (?:te )?ajudar/i.test(m.text)), 'NÃO deve conter "como posso te ajudar" (frase de bot)');
  assert.ok(!sentMessages.some(m => m.text.includes('1️⃣')), 'NÃO deve conter opções numéricas de menu');
  assert.ok(!sentMessages.some(m => m.text.includes('Operamos com atendimento inteligente 24h')), 'NÃO deve conter frases corporativas/robóticas');
  assert.ok(!sentMessages.some(m => m.text.includes('amigo(a)')), 'NÃO deve conter vocativos artificiais');
  assert.ok(sentPresences.some(p => p.type === 'composing'), 'Deve simular status de digitando (composing)');
  assert.ok(sentPresences.some(p => p.type === 'paused'), 'Deve pausar status de digitação antes de enviar');
  console.log('  ✓ Primeiro contato acolhe como usuário comum de WhatsApp, sem robôs nem menus!\n');

  // Turno B: Lead com nome real ("Lucas") enviando "boa tarde"
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511988880002@s.whatsapp.net', 'Lucas Silva', fakeSock);
  console.log('  🤖 Mensagens enviadas no acolhimento (com nome):');
  sentMessages.forEach((m, idx) => console.log(`     Balão ${idx + 1}: "${m.text}"`));

  assert.strictEqual(sentMessages.length, 2, 'Deve enviar exatamente 2 balões');
  assert.ok(sentMessages[0].text.includes('Lucas'), 'Balão 1 deve cumprimentar Lucas pelo nome');
  assert.ok(sentMessages[1].text.includes('Tudo certo por aí?'), 'Balão 2 deve ser despretensioso');
  assert.ok(!sentMessages.some(m => /como posso (?:te )?ajudar/i.test(m.text)), 'NÃO deve soar como atendente de suporte');
  console.log('  ✓ Personalização despretensiosa com primeiro nome confirmada!\n');

  // ==============================================================
  // 2. FASE 1: ENTENDIMENTO DO CONTATO ANTES DE VENDER
  // ==============================================================
  console.log('--- 2. Fase de Acolhimento & Entendimento (Antes de Vender) ---');

  const leadPhone = '5511988880003';
  const leadJid = `${leadPhone}@s.whatsapp.net`;

  // Contato pergunta como funciona o bot
  const nlpQuestion = await nlpService.processMessage({
    text: 'Queria saber como funciona o bot de vocês',
    customerName: 'Renato'
  });

  const replyPhase1 = await cognitiveSalesService.generateConsultativeReply({
    phone: leadPhone,
    name: 'Renato',
    text: 'Queria saber como funciona o bot de vocês',
    nlpResult: nlpQuestion,
    isMaster: true
  });

  console.log('  🤖 Resposta do atendente na Fase de Entendimento:');
  const bubblesP1 = replyPhase1.split(/\n{2,}/);
  bubblesP1.forEach((b, idx) => console.log(`     Balão ${idx + 1}: "${b}"`));

  assert.ok(bubblesP1.length >= 2, 'Deve dividir a resposta em pelo menos 2 balões');
  assert.ok(
    bubblesP1.some(b => /(?:bot|atendimento|vendas|funciona|roda na prática|sistema|explicar)/i.test(b)),
    'Deve se referir ao sistema/bot ou funcionamento na prática'
  );
  assert.ok(
    bubblesP1.some(b => /(?:nicho|ramo|operação|loja|negócio|produto|atuação|me conta)/i.test(b)),
    'Deve fazer pergunta investigativa para entender a operação do contato antes de empurrar venda'
  );
  assert.ok(!replyPhase1.includes('R$ 497') && !replyPhase1.includes('comprar agora'), 'NÃO deve empurrar preço de venda agressivo antes de entender o contato');
  console.log('  ✓ Atendente humano ouve e faz pergunta investigativa antes de vender!\n');

  // ==============================================================
  // 3. FASE 2: TRANSIÇÃO PARA O CARGO DE VENDEDOR
  // ==============================================================
  console.log('--- 3. Fase de Transição para o Cargo de Vendedor ---');

  // O contato agora explica o que faz e sua dor
  // "Já tenho uma loja de roupas e recebo muitas mensagens todo dia"
  const leadExplanation = 'Já tenho uma loja de roupas e recebo muitas mensagens todo dia no WhatsApp';
  const updatedProfile = cognitiveSalesService.analyzeAndExtractProfile(leadPhone, 'Renato', leadExplanation);

  assert.ok(updatedProfile.company_niche, 'Deve identificar o nicho do lead');
  console.log(`  📊 Lead qualificado: Nicho = ${updatedProfile.company_niche} | Estágio = ${updatedProfile.buying_stage}`);

  const replyPhase2 = await cognitiveSalesService.generateConsultativeReply({
    phone: leadPhone,
    name: 'Renato',
    text: leadExplanation,
    isMaster: true
  });

  // Verifica resposta de transição / avanço na conversa
  const heuristicPhase2 = cognitiveSalesService.generateHeuristicConsultativeReply({
    profile: updatedProfile,
    firstName: 'Renato',
    text: leadExplanation,
    isMasterBot: true
  });

  console.log('  🤖 Resposta Heurística de Transição para Vendedor:');
  const hBubbles = heuristicPhase2.split(/\n{2,}/);
  hBubbles.forEach((b, idx) => console.log(`     Balão ${idx + 1}: "${b}"`));

  assert.ok(hBubbles.length >= 2, 'Motor heurístico deve dividir resposta em pelo menos 2 balões');
  assert.ok(
    hBubbles.some(b => b.includes('R$ 497')),
    'Deve apresentar o bot de vendas e o valor de R$ 497'
  );
  assert.ok(
    hBubbles.some(b => b.includes('vitrine') || b.includes('loja') || b.includes('dúvida')),
    'Deve convidar para ver a vitrine ou tirar dúvidas'
  );
  assert.ok(hBubbles.some(b => /[🚀😉👍]/.test(b)), 'Deve conter emojis naturais');
  console.log('  ✓ Transição para o papel de vendedor realizada com maestria e linguagem fluida!\n');

  // ==============================================================
  // 4. ENVIO REAL COM sendHumanSplitMessages (SIMULAÇÃO WHATSAPP)
  // ==============================================================
  console.log('--- 4. Envio Sequencial com Delays de Digitação Humanos ---');

  sentMessages.length = 0;
  sentPresences.length = 0;

  const testSplitText = "Opa, entendi perfeitamente!\n\nNo seu caso, o bot vai te economizar horas todo dia tirando dúvidas e mandando o Pix no automático 👍\n\nO plano anual completo sai por R$ 497 com suporte incluso 🚀";
  await whatsappBot.sendHumanSplitMessages(fakeSock, leadJid, testSplitText);

  assert.strictEqual(sentMessages.length, 3, 'Deve enviar exatamente 3 balões de texto');
  assert.ok(sentPresences.filter(p => p.type === 'composing').length >= 3, 'Deve ter digitado (composing) antes de cada balão');
  assert.ok(sentPresences.filter(p => p.type === 'paused').length >= 3, 'Deve ter pausado antes de cada envio');

  console.log('  ✓ Sequência de 3 balões enviada com digitação humana simulada entre cada mensagem!\n');

  // ==============================================================
  // 5. CONSULTA DE PREÇO DIRETA (TRANSPARÊNCIA TOTAL)
  // ==============================================================
  console.log('--- 5. Consulta Direta de Valores & Planos ---');

  const priceQueryText = 'Quanto custa o bot?';
  const nlpPrice = await nlpService.processMessage({ text: priceQueryText, customerName: 'Felipe' });
  
  // Resposta Heurística Garantida
  const heuristicPrice = cognitiveSalesService.generateHeuristicConsultativeReply({
    profile: { buying_stage: 'PROPOSTA', phone: '5511999998888' },
    firstName: 'Felipe',
    text: priceQueryText,
    nlpResult: nlpPrice,
    isMasterBot: true
  });

  const priceBubbles = heuristicPrice.split(/\n{2,}/);
  console.log('  🤖 Resposta de preços (Heurística):');
  priceBubbles.forEach((b, idx) => console.log(`     Balão ${idx + 1}: "${b}"`));

  assert.ok(priceBubbles.some(b => b.includes('497') && b.includes('anual')), 'Deve citar o plano anual de R$ 497');
  assert.ok(priceBubbles.some(b => b.includes('49,90')), 'Deve citar a opção de grupos a R$ 49,90/mês');
  assert.ok(priceBubbles.some(b => /[🚀😉👍]/.test(b)), 'Deve conter emojis naturais');
  console.log('  ✓ Resposta de preços clara, transparente e dividida em balões naturais!\n');

  console.log('🎉 TODOS OS TESTES DE ATENDIMENTO 100% HUMANO NO PRIVADO PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Falha nos testes de atendimento humano:', err);
  process.exit(1);
});

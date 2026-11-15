const assert = require('assert');
const models = require('./src/db/models');
const meteoricService = require('./src/services/meteoricService');
const meteoricDialogueEngine = require('./src/services/meteoricDialogueEngine');
const whatsappArmyService = require('./src/services/whatsappArmyService');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

console.log('\n======================================================');
console.log('🧪 SUÍTE DE TESTES: SIMULADOR & INJETOR DE CONVERSAS (100+ WHATSAPPS)');
console.log('======================================================\n');

(async () => {
  // 1. Temas e Tons disponíveis
  console.log('--- 1. Catálogo de Temas, Tons e Personas do Exército ---');

  it('meteoricDialogueEngine deve disponibilizar no mínimo 10 temas estratégicos de lançamento', () => {
    const themes = meteoricDialogueEngine.getAvailableThemes();
    assert(Array.isArray(themes), 'Themes deve ser um array');
    assert(themes.length >= 10, `Esperava pelo menos 10 temas, obteve ${themes.length}`);
    
    const themeIds = themes.map(t => t.id);
    assert(themeIds.includes('social_proof_herd'), 'Deve incluir Prova Social Massiva');
    assert(themeIds.includes('anticipation'), 'Deve incluir Antecipação');
    assert(themeIds.includes('objection_guarantee'), 'Deve incluir Quebra de Objeções');
    assert(themeIds.includes('payment_methods'), 'Deve incluir Métodos de Pagamento');
    assert(themeIds.includes('support_beginners'), 'Deve incluir Suporte e Iniciantes');
    assert(themeIds.includes('scarcity_lot_switch'), 'Deve incluir Virada de Lote');
    assert(themeIds.includes('urgency_last_chance'), 'Deve incluir Urgência Máxima');
    assert(themeIds.includes('testimonials_results'), 'Deve incluir Depoimentos');
    assert(themeIds.includes('natural_cross_dialogue'), 'Deve incluir Diálogo Cruzado');
    assert(themeIds.includes('army_massive_warmup'), 'Deve incluir Mobilização do Exército');
  });

  it('meteoricDialogueEngine deve disponibilizar 7 estilos de fala e tons de conversa', () => {
    const tones = meteoricDialogueEngine.getAvailableTones();
    assert(Array.isArray(tones), 'Tones deve ser um array');
    assert.strictEqual(tones.length, 7, 'Deve conter exatamente 7 estilos');

    const toneIds = tones.map(t => t.id);
    assert(toneIds.includes('misto_organico'), 'Deve incluir Misto Orgânico');
    assert(toneIds.includes('casual_giras'), 'Deve incluir Jovem e Gírias');
    assert(toneIds.includes('formal_seguro'), 'Deve incluir Formal e Seguro');
    assert(toneIds.includes('cetico_analitico'), 'Deve incluir Cético Analítico');
    assert(toneIds.includes('afobado_empolgado'), 'Deve incluir Afobado Empolgado');
    assert(toneIds.includes('rapido_minimalista'), 'Deve incluir Rápido Minimalista');
    assert(toneIds.includes('regional_brasileiro'), 'Deve incluir Regional Brasileiro');
  });

  // 2. Resolução de Spintax multinível e variáveis
  console.log('\n--- 2. Motor de Spintax Multinível & Variações Anti-Ban ---');

  it('resolveSpintax deve resolver chaves {opcao1|opcao2} e substituir variáveis', () => {
    const template = '{Fala|Opa|E aí} galera, o link {link} do produto {produto} tá {top|demais|sensacional}!';
    const resolved = meteoricDialogueEngine.resolveSpintax(template, {
      link: 'https://exemplo.com/vip',
      produto: 'Bot Scalper Pro'
    });

    assert(!resolved.includes('{Fala|Opa|E aí}'), 'Não deve conter spintax não resolvido');
    assert(resolved.includes('https://exemplo.com/vip'), 'Deve conter link substituído');
    assert(resolved.includes('Bot Scalper Pro'), 'Deve conter produto substituído');
    assert(!/\{.*\|.*\}/.test(resolved), 'Não deve restar pipes ou chaves de spintax');
  });

  it('models.parseSpintax deve aceitar vars e resolver spintax de modo compatível', () => {
    const res = models.parseSpintax('{Oi|Olá} amigo! Acesse {link}', { link: 'https://meulink.com' });
    assert(res.startsWith('Oi') || res.startsWith('Olá'));
    assert(res.includes('https://meulink.com'));
  });

  it('calculateHumanDelay deve gerar delay realista com jitter baseado no tamanho da frase', () => {
    const delayShort = meteoricDialogueEngine.calculateHumanDelay('Pago.', 4);
    const delayLong = meteoricDialogueEngine.calculateHumanDelay('Gostaria de tirar uma dúvida sobre a garantia de 7 dias incondicional concedida pela plataforma de pagamentos.', 4);
    assert(delayShort >= 2, 'Delay curto deve ser no mínimo 2s');
    assert(delayLong >= delayShort, 'Mensagem longa deve ter delay maior ou igual ao de mensagem curta');
  });

  // 3. Geração de Diálogo para Exército de 100+ WhatsApps
  console.log('\n--- 3. Geração Escalável para Exército de 100+ WhatsApps ---');

  it('generateDialogue deve gerar timeline rica com subBotId, avatarColor, speaker e delays', () => {
    const armyMock = [
      { id: 2, name: 'Chip 02 - Comprador SP', phone: '5511999990002' },
      { id: 3, name: 'Chip 03 - Dúvidas RJ', phone: '5521999990003' },
      { id: 4, name: 'Chip 04 - Veterano MG', phone: '5531999990004' }
    ];

    const generated = meteoricDialogueEngine.generateDialogue({
      theme: 'social_proof_herd',
      tone: 'misto_organico',
      count: 8,
      armyInstances: armyMock,
      vars: { link: 'http://localhost:3000/l/vip', produto: 'Mentoria Elite' }
    });

    assert(generated.success, 'Geração deve ser bem sucedida');
    assert.strictEqual(generated.timeline.length, 8, 'Deve conter 8 falas');

    const first = generated.timeline[0];
    assert(first.step === 1);
    assert(first.subBotId !== null, 'Deve conter ID do sub-bot');
    assert(first.avatarColor, 'Deve conter avatarColor');
    assert(first.avatarInitials, 'Deve conter avatarInitials');
    assert(first.text && first.text.length > 5, 'Deve conter texto gerado');
    assert(!first.text.includes('{'), 'Não deve conter spintax sem resolver');

    // Verifica que distribuiu entre os chips mockados
    const usedBotIds = new Set(generated.timeline.map(t => t.subBotId));
    assert(usedBotIds.has(2), 'Deve ter usado Chip 2');
    assert(usedBotIds.has(3), 'Deve ter usado Chip 3');
    assert(usedBotIds.has(4), 'Deve ter usado Chip 4');
  });

  it('generateDialogue deve suportar expansão massiva para 30 e 50 falas sem erro', () => {
    const gen30 = meteoricDialogueEngine.generateDialogue({
      theme: 'army_massive_warmup',
      count: 30
    });
    assert.strictEqual(gen30.timeline.length, 30, 'Deve gerar 30 falas completas');

    const gen50 = meteoricDialogueEngine.generateDialogue({
      theme: 'social_proof_herd',
      count: 50
    });
    assert.strictEqual(gen50.timeline.length, 50, 'Deve gerar 50 falas completas');
  });

  it('Filtro de tom deve modular o estilo de escrita da mensagem', () => {
    const raw = 'Você também pode fazer isso para mim muito obrigado excelente';
    const casual = meteoricDialogueEngine.applyToneFilter(raw, 'casual_giras');
    assert(casual.includes('vc'), 'Casual deve abreviar você para vc');
    assert(casual.includes('tb'), 'Casual deve abreviar também para tb');
    assert(casual.includes('pra'), 'Casual deve abreviar para para pra');

    const formal = meteoricDialogueEngine.applyToneFilter('vc tb pode fazer isso pra mim mano slk 🔥', 'formal_seguro');
    assert(formal.includes('você'), 'Formal deve expandir vc para você');
    assert(!formal.includes('🔥'), 'Formal deve remover emojis extravagantes');

    const minimal = meteoricDialogueEngine.applyToneFilter('Acabei de fazer o Pix agora mesmo. Já recebi o e-mail de acesso e o comprovante.', 'rapido_minimalista');
    assert(minimal.length < 80, 'Minimalista deve encurtar para frase direta');
  });

  // 4. Integração no MeteoricService & Endpoints
  console.log('\n--- 4. Integração com MeteoricService & Rota Web ---');

  it('meteoricService.getDialoguePresets() deve retornar temas, tons e templates', () => {
    const presets = meteoricService.getDialoguePresets();
    assert(presets, 'Presets deve existir');
    assert(Array.isArray(presets.themes) && presets.themes.length >= 10);
    assert(Array.isArray(presets.tones) && presets.tones.length === 7);
    assert(presets.templates && typeof presets.templates === 'object');
  });

  await itAsync('meteoricService.generateOrSimulateDialogue (dryRun: true) deve retornar timeline rica', async () => {
    const res = await meteoricService.generateOrSimulateDialogue({
      theme: 'anticipation',
      tone: 'afobado_empolgado',
      count: 6,
      dryRun: true
    });

    assert(res.success, 'Deve retornar success: true');
    assert.strictEqual(res.dryRun, true);
    assert.strictEqual(res.theme, 'anticipation');
    assert.strictEqual(res.tone, 'afobado_empolgado');
    assert.strictEqual(res.timeline.length, 6);
  });

  await itAsync('generateOrSimulateDialogue deve mapear temas legados com compatibilidade total', async () => {
    const legacyRes = await meteoricService.generateOrSimulateDialogue({
      theme: 'social_proof', // tema legado
      dryRun: true
    });

    assert(legacyRes.success);
    assert.strictEqual(legacyRes.theme, 'social_proof_herd', 'Deve normalizar social_proof para social_proof_herd');
    assert(legacyRes.timeline.length >= 4);
  });

  await itAsync('generateOrSimulateDialogue (dryRun: false) deve agendar e registrar no log de atividades', async () => {
    const liveRes = await meteoricService.generateOrSimulateDialogue({
      targetGroupJid: '120363999999999999@g.us',
      theme: 'payment_methods',
      tone: 'casual_giras',
      count: 4,
      dryRun: false
    });

    assert(liveRes.success);
    assert.strictEqual(liveRes.dryRun, false);
    assert.strictEqual(liveRes.dialogueCount, 4);

    // Verifica se gravou no feed de atividades do Meteórico
    const logs = models.getMeteoricActivityLogs(10);
    const subbotLog = logs.find(l => l.event_type === 'SUBBOT_SIMULATION' && l.message_text && l.message_text.includes('payment_methods'));
    assert(subbotLog, 'Atividade SUBBOT_SIMULATION deve estar no feed ao vivo');
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES PASSARAM!`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

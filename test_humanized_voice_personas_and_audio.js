const assert = require('assert');
const http = require('http');

console.log('========================================================================');
console.log('🎙️ TEST SUITE: HUMANIZAÇÃO VOCAL, PERSONAS, RESPIRAÇÃO & ENTONAÇÃO');
console.log('========================================================================\n');

async function run() {
  process.env.NODE_ENV = 'test';
  const voicePersonaService = require('./src/services/voicePersonaService');
  const audioConverter = require('./src/services/audioConverterService');
  const models = require('./src/db/models');

  // -------------------------------------------------------------
  // GRUPO 1: CATÁLOGO DE PERSONAS VOCAIS (9 PERSONAS DIVERSIFICADAS)
  // -------------------------------------------------------------
  console.log('--- GRUPO 1: Catálogo de Personas Vocais ---');

  const personas = voicePersonaService.getPersonas();
  assert.ok(Array.isArray(personas) && personas.length >= 9, 'Deve haver pelo menos 9 personas vocais cadastradas');

  const requiredIds = ['marcos', 'lucas', 'rodrigo', 'camila', 'juliana', 'thalita', 'larissa', 'duarte', 'raquel'];
  for (const id of requiredIds) {
    const p = voicePersonaService.getPersona(id);
    assert.ok(p, `Persona ${id} deve existir`);
    assert.strictEqual(p.id, id);
    assert.ok(p.name, `Persona ${id} deve ter nome humanizado`);
    assert.ok(p.badge, `Persona ${id} deve ter badge visual`);
    assert.ok(p.description, `Persona ${id} deve ter descrição de estilo`);
    assert.ok(p.edgeVoice, `Persona ${id} deve ter voz neural associada`);
    assert.ok(p.sampleText, `Persona ${id} deve ter texto de amostra`);
    assert.ok(Array.isArray(p.recommendedNiches) && p.recommendedNiches.length > 0, `Persona ${id} deve ter nichos recomendados`);
  }
  console.log('  ✅ [PASS] Todas as 9 Personas Vocais estão ativas com perfis, nichos e timbres definidos');

  // -------------------------------------------------------------
  // GRUPO 2: ESTILOS EMOCIONAIS E ENTONAÇÃO (PITCH & RATE DYNAMICS)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 2: Modulação de Emoção & Entonação ---');

  const emotions = voicePersonaService.getEmotions();
  assert.ok(Array.isArray(emotions) && emotions.length >= 5, 'Deve haver pelo menos 5 estilos emocionais');

  const emotionKeys = ['entusiasmado', 'consultivo', 'acolhedor', 'calmo', 'natural'];
  for (const emKey of emotionKeys) {
    const em = voicePersonaService.getEmotion(emKey);
    assert.ok(em, `Estilo emocional ${emKey} deve existir`);
    assert.strictEqual(em.id, emKey);
    assert.ok(typeof em.pitchDeltaHz === 'number', `${emKey} deve ter pitchDeltaHz numérico`);
    assert.ok(typeof em.rateDeltaPercent === 'number', `${emKey} deve ter rateDeltaPercent numérico`);
  }

  // Verifica cálculo combinado de Persona + Emoção
  const cfgMarcosConsultivo = voicePersonaService.resolveVoiceConfig({ persona: 'marcos', emotion: 'consultivo' });
  assert.strictEqual(cfgMarcosConsultivo.edgeVoice, 'pt-BR-AntonioNeural');
  assert.strictEqual(cfgMarcosConsultivo.organicBreath, true);
  assert.strictEqual(cfgMarcosConsultivo.phoneWarmth, true);

  const cfgLucasEntusiasmado = voicePersonaService.resolveVoiceConfig({ persona: 'lucas', emotion: 'entusiasmado' });
  assert.strictEqual(cfgLucasEntusiasmado.edgeVoice, 'en-US-BrianMultilingualNeural');
  assert.ok(parseInt(cfgLucasEntusiasmado.pitch) > 0, 'Pitch de Lucas entusiasmado deve ser mais agudo/vivo');
  assert.ok(parseInt(cfgLucasEntusiasmado.rate) > 0, 'Velocidade de Lucas entusiasmado deve ser mais rápida');

  console.log('  ✅ [PASS] Modulação de entonação emocional calcula pitch e rate corretamente');

  // -------------------------------------------------------------
  // GRUPO 3: NORMALIZAÇÃO CONVERSACIONAL DE TEXTO (HUMAN SPOKEN PORTUGUESE)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 3: Normalização Conversacional Falada ---');

  // Teste de moedas (R$)
  const normPrice1 = voicePersonaService.humanizeTextForSpeech('O plano custa R$ 69,90 no mês e R$ 497 no ano');
  assert.ok(normPrice1.includes('sessenta e nove e noventa'), 'R$ 69,90 deve ser lido como sessenta e nove e noventa');
  assert.ok(normPrice1.includes('quatrocentos e noventa e sete reais'), 'R$ 497 deve ser lido como quatrocentos e noventa e sete reais');
  assert.ok(!normPrice1.includes('R$'), 'Não deve conter R$ puro para não gerar fala robótica');

  // Teste de URLs
  const normUrl = voicePersonaService.humanizeTextForSpeech('Dá uma olhada no catálogo em https://loja.com/produtos e me avisa');
  assert.ok(!normUrl.includes('https://'), 'URLs não devem ser soletradas');
  assert.ok(normUrl.includes('link que eu vou te mandar'), 'URLs devem ser substituídas por menção oral conversacional');

  // Teste de porcentagens e horas
  const normPctTime = voicePersonaService.humanizeTextForSpeech('Desconto de 15% ativo 24/7 com suporte 24h');
  assert.ok(normPctTime.includes('quinze por cento'), '15% deve ser lido como quinze por cento');
  assert.ok(normPctTime.includes('vinte e quatro horas por dia'), '24/7 deve ser lido como vinte e quatro horas por dia');
  assert.ok(normPctTime.includes('vinte e quatro horas'), '24h deve ser lido como vinte e quatro horas');

  // Teste de abreviações e tags de áudio
  const normAbbr = voicePersonaService.humanizeTextForSpeech('[AUDIO: Cara, vc viu a msg no whats? blz, tmj!]');
  assert.ok(!normAbbr.includes('[AUDIO:'), 'Tags [AUDIO:] devem ser limpas');
  assert.ok(normAbbr.includes('você'), 'vc deve virar você');
  assert.ok(normAbbr.includes('mensagem'), 'msg deve virar mensagem');
  assert.ok(normAbbr.includes('WhatsApp'), 'whats deve virar WhatsApp');
  assert.ok(normAbbr.includes('beleza'), 'blz deve virar beleza');

  console.log('  ✅ [PASS] Normalização conversacional elimina fala robótica de valores, links e termos técnicos');

  // -------------------------------------------------------------
  // GRUPO 4: SÍNTESE E CONVERSÃO COM RESPIRAÇÃO E CALOR ACÚSTICO
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 4: Síntese de Áudio com Respiração & Warmth ---');

  const pttResult = await audioConverter.textToSpeech('Olá, tudo bem? Este é um teste da voz humanizada com respiração.', {
    persona: 'camila',
    emotion: 'acolhedor',
    organicBreath: true,
    phoneWarmth: true
  });

  assert.ok(pttResult && pttResult.buffer, 'Resultado do PTT deve conter buffer de áudio');
  assert.strictEqual(pttResult.mimetype, 'audio/ogg; codecs=opus', 'Mimetype deve ser OGG Opus para WhatsApp PTT');
  assert.strictEqual(pttResult.ptt, true, 'Flag ptt deve ser true');
  assert.ok(pttResult.waveform && pttResult.waveform.length === 64, 'Waveform deve conter exatamente 64 barras de amplitude');

  const previewMp3 = await audioConverter.synthesizePreviewMp3('Olá! Amostra para audição direta no navegador.', {
    persona: 'marcos',
    emotion: 'consultivo'
  });
  assert.ok(previewMp3 && previewMp3.length > 0, 'Preview MP3 deve ser gerado');

  console.log('  ✅ [PASS] Síntese PTT gera OGG Opus com waveform e preview MP3');

  // -------------------------------------------------------------
  // GRUPO 5: ROTAS REST DE GESTÃO E PREVIEW DE VOZ
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 5: Rotas REST da API de Voz ---');

  const { createServer } = require('./src/server/app');
  const expressApp = createServer();
  const server = expressApp.listen(0);
  await new Promise(resolve => server.on('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/voice/personas
    const resPersonas = await fetch(`${baseUrl}/api/voice/personas`).then(r => r.json());
    assert.strictEqual(resPersonas.success, true);
    assert.ok(resPersonas.personas.length >= 9);

    // 2. GET /api/voice/emotions
    const resEmotions = await fetch(`${baseUrl}/api/voice/emotions`).then(r => r.json());
    assert.strictEqual(resEmotions.success, true);
    assert.ok(resEmotions.emotions.length >= 5);

    // 3. GET /api/voice/settings
    const resSettings = await fetch(`${baseUrl}/api/voice/settings`).then(r => r.json());
    assert.strictEqual(resSettings.success, true);
    assert.ok(resSettings.settings.persona);
    assert.ok(resSettings.settings.emotion);

    // 4. POST /api/voice/settings
    const saveRes = await fetch(`${baseUrl}/api/voice/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona: 'camila',
        emotion: 'acolhedor',
        voice: 'pt-BR-FranciscaNeural',
        organicBreath: true,
        phoneWarmth: true
      })
    }).then(r => r.json());
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(models.getSetting('SALES_BOT_PERSONA'), 'camila');
    assert.strictEqual(models.getSetting('SALES_BOT_EMOTION'), 'acolhedor');

    // 5. POST /api/voice/preview
    const prevRes = await fetch(`${baseUrl}/api/voice/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Amostra de teste de áudio',
        persona: 'juliana',
        emotion: 'consultivo'
      })
    });
    assert.strictEqual(prevRes.status, 200);
    assert.strictEqual(prevRes.headers.get('content-type'), 'audio/mpeg');
    const prevBuf = Buffer.from(await prevRes.arrayBuffer());
    assert.ok(prevBuf.length > 0);

    // 6. GET /api/voice/preview-stream
    const streamRes = await fetch(`${baseUrl}/api/voice/preview-stream?persona=lucas&emotion=entusiasmado&text=Fala+amigo`);
    assert.strictEqual(streamRes.status, 200);
    assert.strictEqual(streamRes.headers.get('content-type'), 'audio/mpeg');

    console.log('  ✅ [PASS] Todos os endpoints REST de Voz (/api/voice/*) responderam com sucesso');
  } finally {
    server.close();
  }

  // -------------------------------------------------------------
  // GRUPO 6: RECOMENDAÇÃO INTELIGENTE DE VOZ POR NICHO
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 6: Recomendações Vocais Especializadas por Nicho ---');

  const pAdv = voicePersonaService.getPersonaForNiche('advogados');
  assert.ok(['marcos', 'juliana', 'duarte'].includes(pAdv.id), 'Advogados deve sugerir Marcos, Juliana ou Duarte');

  const pNails = voicePersonaService.getPersonaForNiche('nailsdesigns');
  assert.ok(['camila', 'thalita'].includes(pNails.id), 'Nails Design deve sugerir Camila ou Thalita');

  const pLanches = voicePersonaService.getPersonaForNiche('lanches');
  assert.ok(['lucas', 'larissa', 'thalita'].includes(pLanches.id), 'Lanches deve sugerir Lucas ou Larissa');

  const pImoveis = voicePersonaService.getPersonaForNiche('corretor_imoveis');
  assert.ok(['marcos', 'juliana'].includes(pImoveis.id), 'Corretor de Imóveis deve sugerir voz executiva/firme');

  console.log('  ✅ [PASS] Recomendações especializadas por nicho operando com perfeição');

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS TESTES DE VOZ HUMANIZADA, PERSONAS E ÁUDIO PASSARAM COM 100%!');
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});

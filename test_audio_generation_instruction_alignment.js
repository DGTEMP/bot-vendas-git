/**
 * test_audio_generation_instruction_alignment.js
 * 
 * Validação do Alinhamento das Instruções de Geração de Texto para Áudio:
 * Garante que, ao planejar enviar trechos, indagações ou pitch em áudio ([AUDIO: ...]),
 * as instruções passadas ao gerador de texto (LLM/IA) já estejam alinhadas durante a
 * geração, informando explicitamente que o texto gerado será reproduzido como áudio falado.
 */

const assert = require('assert');
const voicePersonaService = require('./src/services/voicePersonaService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const knowledgeBaseService = require('./src/services/knowledgeBaseService');
const models = require('./src/db/models');

console.log('========================================================================');
console.log('🎙️ TEST SUITE: ALINHAMENTO DAS INSTRUÇÕES DE GERAÇÃO PARA ÁUDIO FALADO');
console.log('========================================================================\n');

let passedTests = 0;
function pass(msg) {
  console.log(`  ✅ [PASS] ${msg}`);
  passedTests++;
}

(async () => {
  try {
    // -------------------------------------------------------------------------
    // GRUPO 1: Diretriz de Prompt de Áudio (voicePersonaService.buildAudioPromptDirective)
    // -------------------------------------------------------------------------
    console.log('--- GRUPO 1: Diretriz de Prompt de Áudio no VoicePersonaService ---');

    const masterDirective = voicePersonaService.buildAudioPromptDirective({
      personaKey: 'marcos',
      emotionKey: 'consultivo',
      isMasterBot: true,
      wantsAudio: true
    });

    assert(typeof masterDirective === 'string', 'Diretriz deve ser uma string');
    assert(masterDirective.includes('DIRETRIZ SUPREMA DE REDAÇÃO PARA ÁUDIO FALADO'), 'Deve conter o cabeçalho de diretriz de áudio');
    assert(masterDirective.includes('SERÁ CONVERTIDO E ENVIADO COMO UMA NOTA DE VOZ GRAVADA NO WHATSAPP (ÁUDIO PTT)'), 'Deve avisar ao gerador que o texto será reproduzido como áudio falado');
    assert(masterDirective.includes('ZERO ELEMENTOS VISUAIS NO ÁUDIO'), 'Deve proibir explicitamente asteriscos, emojis e links');
    assert(masterDirective.includes('PENSE EXCLUSIVAMENTE NO OUVIDO'), 'Deve instruir o modelo a pensar no ouvido humano');
    assert(masterDirective.includes('VALORES, MOEDAS E PORCENTAGENS POR EXTENSO ORAL'), 'Deve instruir a escrever números e moedas por extenso');
    assert(masterDirective.includes('LINKS E PIX FICAM NO TEXTO ABAIXO'), 'Deve instruir a colocar links e Pix fora do áudio');
    assert(masterDirective.includes('CADÊNCIA RESPIRATÓRIA'), 'Deve instruir pausas respiratórias');

    pass('1.1 voicePersonaService.buildAudioPromptDirective orienta o gerador de texto sobre a reprodução em áudio');

    const tenantDirective = voicePersonaService.buildAudioPromptDirective({
      personaKey: 'camila',
      emotionKey: 'acolhedor',
      nicheKey: 'nailsdesigns',
      isMasterBot: false,
      tenantName: 'Espaço Glamour Nails',
      wantsAudio: false
    });

    assert(tenantDirective.includes('Espaço Glamour Nails'), 'Deve personalizar o contexto do negócio para o tenant');
    assert(tenantDirective.includes('Camila'), 'Deve carregar a persona do nicho');
    assert(tenantDirective.includes('Acolhedor'), 'Deve carregar o tom emocional');

    pass('1.2 buildAudioPromptDirective adapta persona, nicho e tom emocional do tenant durante a geração');

    // -------------------------------------------------------------------------
    // GRUPO 2: Injeção das Instruções no CognitiveSalesService (Master Bot & Tenants)
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: Injeção das Diretrizes no CognitiveSalesService ---');

    // Inspeciona se cognitiveSalesService chama buildAudioPromptDirective
    const cognitiveCode = require('fs').readFileSync('src/services/cognitiveSalesService.js', 'utf8');
    assert(cognitiveCode.includes('voicePersonaService.buildAudioPromptDirective'), 'cognitiveSalesService deve invocar buildAudioPromptDirective');
    assert(cognitiveCode.includes('audioPreferenceDirective'), 'cognitiveSalesService deve injetar audioPreferenceDirective no prompt Master');
    assert(cognitiveCode.includes('tenantAudioDirective'), 'cognitiveSalesService deve injetar tenantAudioDirective no prompt do Tenant');

    pass('2.1 cognitiveSalesService injeta ativamente as diretrizes de áudio nos prompts da Matriz e dos Tenants');

    // Verifica que o userPrompt avisa formalmente o modelo durante o planejamento da resposta
    assert(cognitiveCode.includes('o texto dentro de [AUDIO: ...] SERÁ REPRODUZIDO COMO ÁUDIO FALADO NO WHATSAPP'), 'userPrompt deve alertar o modelo que o texto gerado será falado');
    assert(cognitiveCode.includes('pensando no ouvido (oralidade humana, zero asteriscos, zero emojis, zero links no áudio)'), 'userPrompt deve reforçar oralidade sem poluição visual');

    pass('2.2 userPrompt instrui o modelo no momento da geração a compor trechos de áudio para audição humana');

    // -------------------------------------------------------------------------
    // GRUPO 3: Reforço no Núcleo de Conhecimento RAG (knowledgeBaseService)
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: Reforço no Núcleo de Conhecimento RAG ---');

    const kbPlaybook = knowledgeBaseService.getContextualPlaybook({
      text: 'quanto custa o plano?',
      stage: 'PROPOSTA',
      niche: 'vendedores'
    });

    assert(kbPlaybook.includes('Geração Alinhada para Áudios ([AUDIO: ...])'), 'Base de conhecimento deve incluir diretriz de áudio');
    assert(kbPlaybook.includes('SERÁ REPRODUZIDO COMO VOZ FALADA (WhatsApp PTT)'), 'Playbook deve orientar a reprodução falada');

    pass('3.1 getContextualPlaybook orienta a geração de áudio no RAG das 65 obras de vendas');

    // -------------------------------------------------------------------------
    // GRUPO 4: Validação Prática de Fallbacks e Sanitização de Fala
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: Validação Prática de Fallbacks e Sanitização de Fala ---');

    // Testa que sanitizeTextForSpeech converte qualquer resíduo visual perfeitamente
    const rawVisualText = "Olá! *Preço:* R$ 49,90 com 15% de desconto! Acesse https://meusite.com/oferta 🙂";
    const spokenText = voicePersonaService.sanitizeTextForSpeech(rawVisualText);

    assert(!spokenText.includes('*'), 'Não pode conter asteriscos');
    assert(!spokenText.includes('🙂'), 'Não pode conter emojis');
    assert(!spokenText.includes('https://'), 'URLs devem ser convertidas para fala natural');
    assert(spokenText.includes('quarenta e nove e noventa'), 'R$ 49,90 deve ser foneticamente pronunciado');
    assert(spokenText.includes('quinze por cento'), '15% deve ser foneticamente pronunciado');

    pass('4.1 sanitizeTextForSpeech garante integridade acústica absoluta caso algum símbolo passe');

    console.log('\n========================================================================');
    console.log(`🎉 TODOS OS ${passedTests}/${passedTests} TESTES DE ALINHAMENTO DE INSTRUÇÕES DE ÁUDIO PASSARAM!`);
    console.log('========================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ [FALHA NO TESTE]:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();

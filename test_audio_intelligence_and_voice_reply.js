const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Injeta NODE_ENV=test
process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const cognitiveService = require('./src/services/cognitiveSalesService');
const speechToTextService = require('./src/services/speechToTextService');
const audioConverter = require('./src/services/audioConverterService');

async function runAudioIntelligenceSuite() {
  console.log('========================================================================');
  console.log('🎙️ TESTES: INTELIGÊNCIA DE ÁUDIO & RESPOSTA POR VOZ AUTOMÁTICA');
  console.log('========================================================================\n');

  let passed = 0;
  const testPhone = '5511999995544';
  const testJid = `${testPhone}@s.whatsapp.net`;

  // Limpa histórico e perfil do lead de teste
  try {
    models.db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);
    models.db.prepare('DELETE FROM lead_episodic_memories WHERE lead_phone = ?').run(testPhone);
    models.db.prepare('DELETE FROM cognitive_dialogue_turns WHERE phone = ?').run(testPhone);
  } catch (_) {}

  // =========================================================================
  // TESTE 1: ÁUDIO RECEBIDO -> NÃO ECOA TEXTO E REAGE COM 🎧
  // =========================================================================
  console.log('--- TESTE 1: Recepção de Áudio sem Eco de Transcrição ---');

  // Mock de speechToText para simular transcrição com sucesso
  const originalTranscribe = speechToTextService.transcribeAudio;
  speechToTextService.transcribeAudio = async () => 'quanto custa o plano anual do bot de vendas?';

  const sentMessages = [];
  const reactions = [];
  const presences = [];

  const mockSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      if (content.react) {
        reactions.push(content.react);
      } else {
        sentMessages.push({ jid, content });
      }
      return { key: { id: 'mock_msg_' + Date.now(), remoteJid: jid } };
    },
    sendPresenceUpdate: async (type, jid) => {
      presences.push({ type, jid });
    }
  };

  const fakeAudioMsg = {
    key: { remoteJid: testJid, id: 'audio_incoming_test_1', fromMe: false },
    _audioBuffer: Buffer.from('FAKE_AUDIO_OPUS_BYTES_TEST'),
    message: {
      audioMessage: {
        seconds: 6,
        mimetype: 'audio/ogg; codecs=opus'
      }
    }
  };

  // Mock de downloadMediaMessage do Baileys para não depender de download de rede
  const baileys = require('@whiskeysockets/baileys');
  const originalDownloadMedia = baileys.downloadMediaMessage;
  baileys.downloadMediaMessage = async () => Buffer.from('FAKE_AUDIO_OPUS_BYTES_TEST');

  await whatsappBot.handleIncomingVoiceMessage(
    fakeAudioMsg,
    testJid,
    'Leonardo Teste',
    testPhone,
    mockSock
  );

  // 1.1 Garante que NENHUMA mensagem enviada ecoa "Entendi o seu áudio" ou repete o que o cliente falou
  const hasEchoedTranscription = sentMessages.some(m => {
    const txt = typeof m.content?.text === 'string' ? m.content.text : '';
    return /entendi o seu [aá]udio/i.test(txt) || txt.includes('quanto custa o plano anual');
  });
  assert.strictEqual(hasEchoedTranscription, false, 'Bot NUNCA deve ecoar a transcrição do áudio por texto');
  console.log('  ✅ [PASS] 1.1 Bot não ecoa a transcrição nem envia mensagem "Entendi o seu áudio"');
  passed++;

  // 1.2 Garante reação com emoji 🎧 na mensagem original de áudio
  const reactedWithHeadphones = reactions.some(r => r.text === '🎧');
  assert.strictEqual(reactedWithHeadphones, true, 'Bot deve reagir com 🎧 na mensagem de áudio');
  console.log('  ✅ [PASS] 1.2 Bot reage com 🎧 discretamente na mensagem de áudio');
  passed++;

  // =========================================================================
  // TESTE 2: CONTEXTO COGNITIVO & MEMÓRIA EPISÓDICA
  // =========================================================================
  console.log('\n--- TESTE 2: Adição ao Contexto Cognitivo & Histórico ---');

  // 2.1 Memória episódica gravada com sucesso
  const memories = models.getLeadEpisodicMemories(testPhone);
  assert.ok(memories.length > 0, 'Memória episódica deve ter sido gravada');
  assert.ok(memories.some(m => m.fact_summary.includes('quanto custa o plano anual')), 'Memória deve conter o áudio falado');
  console.log('  ✅ [PASS] 2.1 Áudio adicionado à memória episódica do lead');
  passed++;

  // 2.2 Turno de diálogo registrado como fala do cliente ('user')
  const dialogueTurns = cognitiveService.getRecentDialogueTurns(testPhone);
  assert.ok(dialogueTurns.some(t => t.role === 'user' && t.content.includes('plano anual')), 'Turno do usuário registrado');
  console.log('  ✅ [PASS] 2.2 Transcrição adicionada ao histórico de turnos do diálogo cognitivo');
  passed++;

  // 2.3 Perfil marcado com preferência por áudio
  const profile = models.getLeadCognitiveProfile(testPhone);
  assert.strictEqual(profile.prefers_audio, 1, 'Perfil deve ter prefers_audio = 1');
  assert.strictEqual(profile.preferred_channel, 'audio', 'Canal preferido deve ser audio');
  console.log('  ✅ [PASS] 2.3 Lead identificado e marcado com preferência por áudio');
  passed++;

  // =========================================================================
  // TESTE 3: SE O CLIENTE PREFERE ÁUDIO, MANDE ÁUDIO (COGNITIVE + SENDHUMANSPLIT)
  // =========================================================================
  console.log('\n--- TESTE 3: Resposta por Voz / Áudio PTT quando Cliente Prefere Áudio ---');

  // 3.1 cognitiveSalesService gera resposta prioritariamente em formato [AUDIO: ...]
  const consultativeReply = await cognitiveService.generateConsultativeReply({
    phone: testPhone,
    name: 'Leonardo',
    text: 'quanto custa o plano anual?',
    isVoiceInput: true,
    preferAudio: true
  });
  console.log('CONSULTATIVE REPLY RETORNADO:', JSON.stringify(consultativeReply));

  assert.ok(consultativeReply.includes('[AUDIO:'), 'Resposta consultiva deve conter bloco de áudio [AUDIO: ...]');
  console.log('  ✅ [PASS] 3.1 cognitiveSalesService gera resposta em formato de áudio [AUDIO: ...] para lead de voz');
  passed++;

  // 3.2 sendHumanSplitMessages envia mensagem de áudio nativo PTT (Opus + Waveform + presence recording)
  const audioDispatchMessages = [];
  const audioDispatchPresences = [];

  const mockAudioSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      audioDispatchMessages.push({ jid, content });
      return { key: { id: 'mock_sent_ptt_' + Date.now(), remoteJid: jid } };
    },
    sendPresenceUpdate: async (type, jid) => {
      audioDispatchPresences.push({ type, jid });
    }
  };

  // Envia resposta contendo áudio e link de vitrine
  const mixedResponse = `[AUDIO: Fala Leonardo! O plano anual completo tá saindo por 497 reais com vitrine inclusa e suporte VIP.]\n\nhttps://loja.com/plano-anual`;

  await whatsappBot.sendHumanSplitMessages(mockAudioSock, testJid, mixedResponse, { preferAudio: true });

  // Verifica se disparou presença 'recording' (gravando áudio...)
  assert.ok(audioDispatchPresences.some(p => p.type === 'recording'), 'Deve simular presença recording no WhatsApp');
  console.log('  ✅ [PASS] 3.2 Simulou presença "gravando áudio..." antes do envio');
  passed++;

  // Verifica se enviou mensagem de áudio PTT
  const sentAudioBubble = audioDispatchMessages.find(m => m.content.audio && m.content.ptt === true);
  assert.ok(sentAudioBubble, 'Deve enviar balão de áudio com ptt: true');
  assert.strictEqual(sentAudioBubble.content.mimetype, 'audio/ogg; codecs=opus', 'Formato deve ser audio/ogg opus');
  assert.ok(sentAudioBubble.content.waveform instanceof Uint8Array, 'Deve incluir forma de onda (waveform) do WhatsApp');
  console.log('  ✅ [PASS] 3.3 Mensagem de voz PTT enviada com Opus e waveform');
  passed++;

  // Verifica se o link foi preservado em balão de texto separado abaixo do áudio
  const sentLinkBubble = audioDispatchMessages.find(m => typeof m.content?.text === 'string' && m.content.text.includes('https://loja.com'));
  assert.ok(sentLinkBubble, 'Link de vitrine deve ser enviado em texto limpo logo abaixo do áudio para fácil clique');
  console.log('  ✅ [PASS] 3.4 Link e Pix preservados em texto para clique e cópia direta do cliente');
  passed++;

  // 3.3 Se o cliente digitar texto comum mas com preferência por áudio (ex: "prefiro áudio" ou options.preferAudio), converte balão para áudio
  const textReplyMessages = [];
  const mockTextSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      textReplyMessages.push({ jid, content });
      return { key: { id: 'mock_conv_' + Date.now(), remoteJid: jid } };
    },
    sendPresenceUpdate: async () => {}
  };

  const plainTextResponse = `Com certeza, nosso suporte é 24 horas e a gente te ajuda a deixar tudo rodando.`;
  await whatsappBot.sendHumanSplitMessages(mockTextSock, testJid, plainTextResponse, { preferAudio: true });

  const convertedToAudio = textReplyMessages.some(m => m.content.audio && m.content.ptt === true);
  assert.strictEqual(convertedToAudio, true, 'Texto conversacional deve ser convertido para áudio PTT quando preferAudio: true');
  console.log('  ✅ [PASS] 3.5 Texto conversacional convertido automaticamente para áudio PTT quando cliente prefere áudio');
  passed++;

  // =========================================================================
  // TESTE 4: CONTINGÊNCIA HUMANIZADA POR VOZ SE TRANSCRIÇÃO FALHAR
  // =========================================================================
  console.log('\n--- TESTE 4: Contingência Humanizada se Transcrição Falhar ---');

  speechToTextService.transcribeAudio = async () => null; // Falha na transcrição
  const fallbackMessages = [];

  const mockFallbackSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      fallbackMessages.push({ jid, content });
      return { key: { id: 'mock_fb_' + Date.now(), remoteJid: jid } };
    },
    sendPresenceUpdate: async () => {}
  };

  await whatsappBot.handleIncomingVoiceMessage(
    fakeAudioMsg,
    testJid,
    'Leonardo',
    testPhone,
    mockFallbackSock
  );

  // Garante que não envia o menu rígido robótico corporativo antigo
  const hasOldRigidMenu = fallbackMessages.some(m => {
    const txt = typeof m.content?.text === 'string' ? m.content.text : '';
    return txt.includes('equipe técnica especializada já foi acionada') || txt.includes('1️⃣ Digite 1');
  });
  assert.strictEqual(hasOldRigidMenu, false, 'Não deve mais enviar o menu rígido corporativo antigo');

  // Garante que envia áudio ou mensagem humanizada leve
  const sentVoiceFallback = fallbackMessages.some(m => m.content.audio || (typeof m.content.text === 'string' && m.content.text.includes('cortou')));
  assert.ok(sentVoiceFallback, 'Deve enviar aviso humanizado de que o som cortou');
  console.log('  ✅ [PASS] 4.1 Contingência humanizada por voz quando o áudio falha na transcrição');
  passed++;

  // Restaura mocks
  speechToTextService.transcribeAudio = originalTranscribe;
  baileys.downloadMediaMessage = originalDownloadMedia;

  console.log('\n========================================================================');
  console.log(`🎉 TODOS OS ${passed} TESTES DE INTELIGÊNCIA DE ÁUDIO PASSARAM COM 100%!`);
  console.log('========================================================================\n');
}

runAudioIntelligenceSuite().catch(err => {
  console.error('❌ ERRO NO TESTE DE ÁUDIO:', err);
  process.exit(1);
});

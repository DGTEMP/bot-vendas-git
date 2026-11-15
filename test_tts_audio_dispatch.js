/**
 * TEST SUITE: DISPARO DE ÁUDIO NATIVO NO PRIVADO (FIX DO [AUDIO: ...])
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const whatsappBot = require('./src/bots/whatsappBot');
const audioConverter = require('./src/services/audioConverterService');

async function run() {
  console.log('🧪 Iniciando Testes do Disparo de Áudio no WhatsApp (Eliminação do vazamento de [AUDIO: ...])...\n');

  const sentMessages = [];
  const presenceUpdates = [];

  const mockSock = {
    user: { id: '5511999990000:1@s.whatsapp.net' },
    sendPresenceUpdate: async (type, to) => {
      presenceUpdates.push({ type, to });
    },
    sendMessage: async (to, content, opts) => {
      sentMessages.push({ to, content, opts });
      return { key: { id: 'MSG_' + Math.random().toString(36).substring(7) } };
    }
  };

  // TESTE 1: sendHumanSplitMessages com texto contendo áudio longo com pontuação
  console.log('--- TESTE 1: sendHumanSplitMessages com texto e [AUDIO: ...] longo com múltiplos pontos ---');
  sentMessages.length = 0;
  presenceUpdates.length = 0;

  const complexMessage = `Show, essa entrega rápida é um diferencial forte pra papelaria hoje em dia.

[AUDIO: Imagina o cliente pedindo papel ou caneta de madrugada, e o bot já responde, gera o Pix e confirma o pedido na hora, sem você precisar acordar. Como você recebe muitas mensagens, isso tira esse peso do seu tempo e garante que nenhuma venda escapa porque você tava ocupado entregando.]

Quer que eu te mande o link da vitrine pra você ver como funciona na prática?`;

  const targetJid = '5511988887766@s.whatsapp.net';
  await whatsappBot.sendHumanSplitMessages(mockSock, targetJid, complexMessage);

  console.log(`Total de mensagens enviadas: ${sentMessages.length}`);
  sentMessages.forEach((m, idx) => {
    if (m.content.audio) {
      console.log(`  Mensagem ${idx + 1}: [ÁUDIO PTT] ${m.content.mimetype} (${m.content.audio.length} bytes, ptt=${m.content.ptt})`);
    } else {
      console.log(`  Mensagem ${idx + 1}: [TEXTO] "${m.content.text || m.content}"`);
    }
  });

  assert.strictEqual(sentMessages.length, 3, 'Deve enviar exatamente 3 mensagens (Texto 1 -> Áudio -> Texto 2)');

  // Mensagem 1: Texto introdutório
  assert.ok(!sentMessages[0].content.audio, 'Mensagem 1 deve ser texto');
  assert.ok(sentMessages[0].content.text.includes('Show, essa entrega rápida'));
  assert.ok(!sentMessages[0].content.text.includes('[AUDIO:'), 'Mensagem 1 não pode ter tag de áudio');

  // Mensagem 2: O ÁUDIO REAL DE VOZ (PTT)
  assert.ok(sentMessages[1].content.audio, 'Mensagem 2 DEVE SER ÁUDIO');
  assert.strictEqual(sentMessages[1].content.ptt, true, 'Deve ter ptt: true (nota de voz com microfone verde)');
  assert.strictEqual(sentMessages[1].content.mimetype, 'audio/ogg; codecs=opus', 'Mimetype deve ser audio/ogg; codecs=opus');
  assert.ok(sentMessages[1].content.waveform, 'Deve conter as ondinhas de som (waveform)');

  // Mensagem 3: Texto final com a pergunta
  assert.ok(!sentMessages[2].content.audio, 'Mensagem 3 deve ser texto');
  assert.ok(sentMessages[2].content.text.includes('Quer que eu te mande o link da vitrine'));
  assert.ok(!sentMessages[2].content.text.includes('[AUDIO:'), 'Mensagem 3 não pode ter tag de áudio');

  // Verifica simulação de presença humana de gravação
  assert.ok(presenceUpdates.some(p => p.type === 'recording'), 'Deve ter simulado status "gravando áudio..." (recording)');
  console.log('✅ 1. sendHumanSplitMessages enviou o áudio PTT real sem vazar tags de texto!');

  // TESTE 2: sendMessage diretamente com texto contendo [AUDIO: ...]
  console.log('\n--- TESTE 2: sendMessage diretamente com [AUDIO: ...] (Auto-delegação) ---');
  sentMessages.length = 0;
  presenceUpdates.length = 0;

  const directMsg = `Opa! [AUDIO: Cara, vou fazer o seguinte pra gente fechar hoje: te dou 10% no Pix.] Me avisa se aceita!`;
  await whatsappBot.sendMessage(targetJid, directMsg, {}, mockSock);

  console.log(`Total de mensagens enviadas: ${sentMessages.length}`);
  assert.strictEqual(sentMessages.length, 3, 'sendMessage deve delegar e enviar 3 mensagens');
  assert.ok(sentMessages[1].content.audio, 'Segunda mensagem deve ser áudio gerado pelo TTS');
  assert.strictEqual(sentMessages[1].content.ptt, true);
  console.log('✅ 2. sendMessage interceptou e converteu tag [AUDIO: ...] para nota de voz com sucesso!');

  // TESTE 3: sendMessageWithTyping com [AUDIO: ...]
  console.log('\n--- TESTE 3: sendMessageWithTyping com [AUDIO: ...] ---');
  sentMessages.length = 0;

  await whatsappBot.sendMessageWithTyping(mockSock, targetJid, { text: `[ÁUDIO: Fala meu amigo, áudio de boas-vindas teste!]` });
  assert.strictEqual(sentMessages.length, 1);
  assert.ok(sentMessages[0].content.audio, 'Deve ser áudio');
  assert.strictEqual(sentMessages[0].content.ptt, true);
  console.log('✅ 3. sendMessageWithTyping converteu tag com acento [ÁUDIO: ...] para nota de voz com sucesso!');

  // TESTE 4: Fallback limpo caso o TTS falhe por completo
  console.log('\n--- TESTE 4: Fallback seguro caso o sintetizador TTS falhe ---');
  sentMessages.length = 0;

  const origTTS = audioConverter.textToSpeech;
  audioConverter.textToSpeech = async () => { throw new Error('Simulated TTS Failure'); };

  try {
    await whatsappBot.sendHumanSplitMessages(mockSock, targetJid, `[AUDIO: Mensagem importante que não conseguiu virar áudio.]`);
    assert.strictEqual(sentMessages.length, 1);
    const sentText = sentMessages[0].content.text || sentMessages[0].content;
    console.log(`Texto enviado em caso de falha: "${sentText}"`);
    assert.ok(!sentText.includes('[AUDIO:'), 'NUNCA deve vazar [AUDIO: como texto');
    assert.ok(!sentText.includes(']'), 'NUNCA deve vazar ]');
    assert.strictEqual(sentText, 'Mensagem importante que não conseguiu virar áudio.');
    console.log('✅ 4. Mesmo com falha catastrófica do TTS, a tag [AUDIO: ...] é limpa e nunca vaza para o cliente!');
  } finally {
    audioConverter.textToSpeech = origTTS;
  }

  console.log('\n🎉 TODOS OS TESTES DE DISPARO DE ÁUDIO PASSARAM COM 100% DE SUCESSO! 🎉');
}

run().catch(err => {
  console.error('❌ Falha nos testes de áudio:', err);
  process.exit(1);
});

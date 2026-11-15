const assert = require('assert');
const whatsappBot = require('./src/bots/whatsappBot');
const incomingBuffer = require('./src/services/incomingMessageBufferService');
const models = require('./src/db/models');

async function runTests() {
  console.log('🧪 Iniciando Testes de Debounce Contextual & Monitoramento de Presença...');

  // --------------------------------------------------------------------------
  // TESTE 1: Acúmulo de mensagens picotadas em linhas separadas (Debounce)
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 1: Acúmulo de mensagens picotadas (Debounce) ---');
  incomingBuffer.clearAll();
  incomingBuffer.setTestDelay(150); // 150ms para testes rápidos

  const leadJid = '5511999991111@s.whatsapp.net';
  const capturedReplies1 = [];

  const mockSock1 = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      capturedReplies1.push({ jid, text, options });
      return { key: { remoteJid: jid, id: 'REPLY_' + Date.now() }, message: { conversation: text } };
    },
    sendPresenceUpdate: async () => {},
    presenceSubscribe: async () => {}
  };

  // Simula cliente digitando 3 linhas rápidas (intervalo de 30ms entre elas)
  const p1 = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 150,
    key: { remoteJid: leadJid, fromMe: false, id: 'MSG_LINE_1' },
    pushName: 'Rodrigo',
    message: { conversation: 'Opa' }
  }, mockSock1);

  await new Promise(r => setTimeout(r, 30));

  const p2 = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 150,
    key: { remoteJid: leadJid, fromMe: false, id: 'MSG_LINE_2' },
    pushName: 'Rodrigo',
    message: { conversation: 'tudo bem?' }
  }, mockSock1);

  await new Promise(r => setTimeout(r, 30));

  const p3 = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 150,
    key: { remoteJid: leadJid, fromMe: false, id: 'MSG_LINE_3' },
    pushName: 'Rodrigo',
    message: { conversation: 'quanto tá saindo o bot de vendas com vitrine?' }
  }, mockSock1);

  // Antes dos 150ms após a última mensagem, NENHUMA resposta deve ter sido enviada
  assert.strictEqual(capturedReplies1.length, 0, 'Bot não deve responder antes do tempo de debounce!');

  // Aguarda o término do timer de debounce (as 3 mensagens se resolvem)
  const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

  // Mensagens 1 e 2 foram unificadas no buffer para a mensagem 3
  assert.strictEqual(res1.merged, true, 'Mensagem 1 deve ter sido mesclada no buffer');
  assert.strictEqual(res2.merged, true, 'Mensagem 2 deve ter sido mesclada no buffer');
  assert.strictEqual(res1.combinedCount, 3, 'Buffer deve ter consolidado exatamente 3 mensagens');

  // Verifica as respostas enviadas para o turno unificado
  assert(capturedReplies1.length >= 1, 'Bot deve responder com os balões contextuais da conversa');
  const fullResponse1 = capturedReplies1.map(r => r.text).join('\n');
  console.log('✅ Resposta unificada gerada pelo bot:\n', fullResponse1);

  // Verifica que o bot abordou o cumprimento E o produto de forma natural
  assert(
    fullResponse1.includes('497') || fullResponse1.includes('anual') || fullResponse1.includes('vitrine') || fullResponse1.includes('vendas'),
    'A resposta do bot deve responder sobre o bot de vendas / licença anual!'
  );
  console.log('✅ Teste 1 APROVADO: 3 mensagens acumuladas em 1 único turno coeso sem interrupções!');

  // --------------------------------------------------------------------------
  // TESTE 2: Pausa no envio se o cliente estiver digitando ('composing')
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: Pausa no envio enquanto o cliente digita (composing) ---');
  incomingBuffer.clearAll();
  incomingBuffer.setTestDelay(150); // 150ms debounce

  const leadJid2 = '5511999992222@s.whatsapp.net';
  const capturedReplies2 = [];

  const mockSock2 = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      capturedReplies2.push({ jid, text });
      return { key: { remoteJid: jid, id: 'REPLY_2_' + Date.now() }, message: { conversation: text } };
    },
    sendPresenceUpdate: async () => {},
    presenceSubscribe: async () => {}
  };

  // Cliente envia linha 1: "Olá"
  const pMsgA = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 150,
    key: { remoteJid: leadJid2, fromMe: false, id: 'MSG_A_1' },
    pushName: 'Marina',
    message: { conversation: 'Olá' }
  }, mockSock2);

  // 40ms depois, o WhatsApp notifica que a cliente começou a digitar ('composing')
  await new Promise(r => setTimeout(r, 40));
  incomingBuffer.handlePresenceUpdate({
    id: leadJid2,
    presences: {
      [leadJid2]: { lastKnownPresence: 'composing' }
    }
  });

  // Aguarda 200ms (tempo superior ao debounce de 150ms)
  await new Promise(r => setTimeout(r, 200));

  // Como a cliente está escrevendo, o bot DEVE AGUARDAR e NÃO responder ainda!
  assert.strictEqual(capturedReplies2.length, 0, 'Bot NÃO deve responder enquanto o status composing estiver ativo!');
  console.log('✅ Bot aguardou pacientemente enquanto a cliente digitava...');

  // Cliente envia a segunda linha: "queria saber o preço da licença anual do bot de vendas"
  const pMsgB = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 150,
    key: { remoteJid: leadJid2, fromMe: false, id: 'MSG_A_2' },
    pushName: 'Marina',
    message: { conversation: 'queria saber o preço da licença anual do bot de vendas' }
  }, mockSock2);

  // Cliente para de digitar ('paused')
  incomingBuffer.handlePresenceUpdate({
    id: leadJid2,
    presences: {
      [leadJid2]: { lastKnownPresence: 'paused' }
    }
  });

  // Aguarda o término do debounce após a pausa
  const [resA, resB] = await Promise.all([pMsgA, pMsgB]);

  // Mensagem A foi mesclada na mensagem B
  assert.strictEqual(resA.merged, true, 'Mensagem A deve ter sido mesclada no buffer');
  assert.strictEqual(resA.combinedCount, 2, 'Buffer deve ter consolidado 2 mensagens');

  // Agora sim o bot deve ter respondido para o turno consolidado!
  assert(capturedReplies2.length >= 1, 'Bot deve responder após a cliente parar de escrever');
  const fullResponse2 = capturedReplies2.map(r => r.text).join('\n');
  console.log('✅ Resposta gerada após cliente parar de escrever:\n', fullResponse2);
  assert(fullResponse2.includes('497') || fullResponse2.includes('anual') || fullResponse2.includes('vendas') || fullResponse2.includes('bot'), 'Resposta deve abordar o bot de vendas / licença!');
  console.log('✅ Teste 2 APROVADO: Bot respeita presença composing e aguarda término da escrita!');

  // --------------------------------------------------------------------------
  // TESTE 3: Comandos com prefixo executam imediatamente (Zero Debounce Lag)
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: Comandos executam imediatamente sem debounce ---');
  incomingBuffer.clearAll();

  const capturedReplies3 = [];
  const mockSock3 = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      capturedReplies3.push({ jid, text });
      return { key: { remoteJid: jid, id: 'REPLY_CMD_' + Date.now() }, message: { conversation: text } };
    },
    sendPresenceUpdate: async () => {}
  };

  const startCmdTime = Date.now();
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511999993333@s.whatsapp.net', fromMe: false, id: 'CMD_PING_1' },
    pushName: 'Cliente',
    message: { conversation: '!ping' }
  }, mockSock3);
  const elapsedCmd = Date.now() - startCmdTime;

  assert(capturedReplies3.length >= 1, 'Comando !ping deve responder imediatamente!');
  assert(elapsedCmd < 2000, `Execução do comando deve ser instantânea (levou ${elapsedCmd}ms)!`);
  console.log(`✅ Teste 3 APROVADO: Comando !ping executou em ${elapsedCmd}ms sem sofrer delay de debounce.`);

  // --------------------------------------------------------------------------
  // TESTE 4: Botões e Listas Interativas executam imediatamente
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Botões interativos executam imediatamente ---');
  incomingBuffer.clearAll();

  const capturedReplies4 = [];
  const mockSock4 = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      capturedReplies4.push({ jid, text });
      return { key: { remoteJid: jid, id: 'REPLY_BTN_' + Date.now() }, message: { conversation: text } };
    },
    sendPresenceUpdate: async () => {}
  };

  const startBtnTime = Date.now();
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511999994444@s.whatsapp.net', fromMe: false, id: 'BTN_CLICK_1' },
    pushName: 'Cliente',
    message: {
      buttonsResponseMessage: {
        selectedButtonId: '!menu',
        selectedDisplayText: 'Menu'
      }
    }
  }, mockSock4);
  const elapsedBtn = Date.now() - startBtnTime;

  assert(capturedReplies4.length >= 1, 'Clique de botão interativo deve ser processado imediatamente!');
  assert(elapsedBtn < 2000, `Clique de botão deve ser instantâneo (levou ${elapsedBtn}ms)!`);
  console.log(`✅ Teste 4 APROVADO: Clique de botão interativo executou em ${elapsedBtn}ms.`);

  // --------------------------------------------------------------------------
  // TESTE 5: Teto Máximo Anti-Travamento (Max Ceiling Safety Timeout)
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 5: Teto máximo de espera anti-travamento ---');
  incomingBuffer.clearAll();
  incomingBuffer.setTestDelay(100);
  incomingBuffer.maxWaitCeilingMs = 250; // 250ms teto de segurança no teste

  const leadJid5 = '5511999995555@s.whatsapp.net';
  const capturedReplies5 = [];
  const mockSock5 = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      capturedReplies5.push({ jid, text });
      return { key: { remoteJid: jid, id: 'REPLY_5_' + Date.now() }, message: { conversation: text } };
    },
    sendPresenceUpdate: async () => {},
    presenceSubscribe: async () => {}
  };

  // Usuário começa digitando e nunca manda evento de pausa
  incomingBuffer.handlePresenceUpdate({
    id: leadJid5,
    presences: { [leadJid5]: { lastKnownPresence: 'composing' } }
  });

  const pSafety = whatsappBot.handleIncomingMessage({
    _testDebounce: true,
    _testDebounceDelayMs: 100,
    key: { remoteJid: leadJid5, fromMe: false, id: 'MSG_SAFETY_1' },
    pushName: 'Marcos',
    message: { conversation: 'Oi, quanto custa o bot de vendas?' }
  }, mockSock5);

  // Aguarda o término da promise (que será forçada pelo teto)
  await pSafety;
  assert(capturedReplies5.length >= 1, 'Teto máximo deve forçar o envio após o tempo limite de segurança!');
  console.log('✅ Teste 5 APROVADO: Teto máximo anti-travamento garantiu a resposta mesmo com composing pendente!');

  console.log('\n🎉 TODOS OS 5 TESTES DE DEBOUNCE E PRESENÇA PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha nos testes de debounce:', err);
  process.exit(1);
});

const assert = require('assert');
const commandHelpService = require('./src/services/commandHelpService');
const naturalCommandService = require('./src/services/naturalLanguageCommandService');
const spyFeatures = require('./src/services/spyFeaturesService');

console.log('=== TESTES DO SISTEMA DE AJUDA EDUCATIVA (!AJUDA <COMANDO>) & IA SEM CORTES ===\n');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`✅ [PASSOU] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FALHOU] ${name}`);
    console.error(`   Detalhes:`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`✅ [PASSOU] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FALHOU] ${name}`);
    console.error(`   Detalhes:`, err.message);
  }
}

async function main() {
  // 1. Testes de Busca no Banco de Comandos
  runTest('CommandHelp: findCommand encontra comando exato "play"', () => {
    const match = commandHelpService.findCommand('play');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'play');
    assert.strictEqual(match.exact, true);
  });

  runTest('CommandHelp: findCommand encontra por alias "musica" -> play', () => {
    const match = commandHelpService.findCommand('musica');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'play');
  });

  runTest('CommandHelp: findCommand encontra com prefixo "!play"', () => {
    const match = commandHelpService.findCommand('!play');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'play');
  });

  runTest('CommandHelp: findCommand encontra "s" e "sticker"', () => {
    const match = commandHelpService.findCommand('sticker');
    assert.ok(match);
    assert.strictEqual(match.command.id, 's');
  });

  runTest('CommandHelp: findCommand encontra "pagespeed" e "seo"', () => {
    const match = commandHelpService.findCommand('pagespeed');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'pagespeed');
  });

  runTest('CommandHelp: findCommand encontra "imei" e "celularseguro"', () => {
    const match = commandHelpService.findCommand('celularseguro');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'imei');
  });

  runTest('CommandHelp: findCommand encontra "ban"', () => {
    const match = commandHelpService.findCommand('ban');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'ban');
  });

  runTest('CommandHelp: findCommand encontra "ia" e "gemini"', () => {
    const match = commandHelpService.findCommand('ia');
    assert.ok(match);
    assert.strictEqual(match.command.id, 'ia');
  });

  // 2. Testes de Formatação Educativa
  runTest('CommandHelp: formatCommandHelp formata explicação detalhada com exemplos', () => {
    const match = commandHelpService.findCommand('play');
    const text = commandHelpService.formatCommandHelp(match.command);
    assert.ok(text.includes('MANUAL DO COMANDO: !PLAY'));
    assert.ok(text.includes('O QUE ELE FAZ:'));
    assert.ok(text.includes('COMO DIGITAR (SINTAXE):'));
    assert.ok(text.includes('EXEMPLOS EM LINGUAGEM NATURAL'));
    assert.ok(text.includes('EXEMPLOS PRÁTICOS (COPIE E TESTE):'));
    assert.ok(text.includes('!play Bohemian Rhapsody Queen'));
    assert.ok(text.includes('DICA PRO:'));
  });

  runTest('CommandHelp: formatGeneralHelp lista categorias e dicas de consulta', () => {
    const text = commandHelpService.formatGeneralHelp();
    assert.ok(text.includes('CENTRAL EDUCATIVA DE COMANDOS PAYBOT'));
    assert.ok(text.includes('Downloads & Músicas'));
    assert.ok(text.includes('!ajuda <nome_do_comando>'));
    assert.ok(text.includes('!ajuda play'));
    assert.ok(text.includes('!ajuda s'));
    assert.ok(text.includes('!ajuda pagespeed'));
  });

  // 3. Teste de Despacho handleHelpCommand
  await runAsyncTest('CommandHelp: handleHelpCommand responde no WhatsApp', async () => {
    let sentText = null;
    const fakeSock = {
      sendMessage: async (to, payload) => {
        sentText = payload.text;
        return { key: { id: 'MSG_HELP_1' } };
      }
    };

    await commandHelpService.handleHelpCommand(fakeSock, '5511999990000@s.whatsapp.net', 'play');
    assert.ok(sentText);
    assert.ok(sentText.includes('MANUAL DO COMANDO: !PLAY'));
    assert.ok(sentText.includes('!play Bohemian Rhapsody Queen'));
  });

  // 4. Testes de Linguagem Natural para Pedidos de Ajuda/Tutorial
  runTest('Linguagem Natural: "como usa o comando play?" -> COMMAND_HELP play', () => {
    const res = naturalCommandService.resolveCommand('como usa o comando play?');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.confidence, 0.99);
    assert.strictEqual(res.type, 'COMMAND_HELP');
    assert.strictEqual(res.params.commandId, 'play');
    assert.strictEqual(res.syntheticText, '!ajuda play');
  });

  runTest('Linguagem Natural: "como funciona o comando s?" -> COMMAND_HELP s', () => {
    const res = naturalCommandService.resolveCommand('como funciona o comando s?');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'COMMAND_HELP');
    assert.strictEqual(res.params.commandId, 's');
  });

  runTest('Linguagem Natural: "me ensina a usar o comando ban" -> COMMAND_HELP ban', () => {
    const res = naturalCommandService.resolveCommand('me ensina a usar o comando ban');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'COMMAND_HELP');
    assert.strictEqual(res.params.commandId, 'ban');
  });

  runTest('Linguagem Natural: "para que serve o comando imei?" -> COMMAND_HELP imei', () => {
    const res = naturalCommandService.resolveCommand('para que serve o comando imei?');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'COMMAND_HELP');
    assert.strictEqual(res.params.commandId, 'imei');
  });

  runTest('Linguagem Natural: "me dá um exemplo do comando pagespeed" -> COMMAND_HELP pagespeed', () => {
    const res = naturalCommandService.resolveCommand('me dá um exemplo do comando pagespeed');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'COMMAND_HELP');
    assert.strictEqual(res.params.commandId, 'pagespeed');
  });

  // 5. Testes da IA sem cortes no handleAIChat
  await runAsyncTest('IA sem cortes: handleAIChat com maxTokens elevado e resposta completa', async () => {
    let sentText = null;
    let presenceHistory = [];
    const fakeSock = {
      sendPresenceUpdate: async (state, to) => {
        presenceHistory.push({ state, to });
      },
      sendMessage: async (to, payload) => {
        sentText = payload.text;
        return { key: { id: 'MSG_AI_1' } };
      }
    };

    // Força ambiente de teste com resposta válida
    process.env.NODE_ENV = 'test';
    const fakeAiManager = require('./src/services/aiManagerService');
    const originalChat = fakeAiManager.chat;
    let receivedMaxTokens = null;
    let receivedTimeout = null;

    fakeAiManager.chat = async (params) => {
      receivedMaxTokens = params.maxTokens;
      receivedTimeout = params.timeoutMs;
      return {
        text: 'Esta é uma resposta completa da Inteligência Artificial, estruturada em vários parágrafos, sem cortes no meio da frase, trazendo todos os detalhes do planejamento com conclusão clara.',
        provider: 'gemini',
        model: 'gemini-2.0-flash'
      };
    };

    try {
      await spyFeatures.handleAIChat(fakeSock, '5511999990000@s.whatsapp.net', '!ia crie um plano de estudos', 'Carlos');

      assert.ok(sentText);
      assert.ok(sentText.includes('resposta completa da Inteligência Artificial'));
      assert.strictEqual(receivedMaxTokens, 2500, 'maxTokens deve ser de pelo menos 2500 para não cortar a resposta');
      assert.strictEqual(receivedTimeout, 25000, 'timeoutMs deve ser de pelo menos 25s');
    } finally {
      fakeAiManager.chat = originalChat;
    }
  });

  // 6. Testes de Chunking Inteligente de Mensagens Gigantes (> 3500 caracteres)
  await runAsyncTest('IA sem cortes: respostas longas (>3500 chars) são enviadas em blocos sequenciais sem perda', async () => {
    const sentMessages = [];
    const fakeSock = {
      sendPresenceUpdate: async () => {},
      sendMessage: async (to, payload) => {
        sentMessages.push(payload.text);
        return { key: { id: `MSG_${Date.now()}` } };
      }
    };

    const fakeAiManager = require('./src/services/aiManagerService');
    const originalChat = fakeAiManager.chat;

    // Gera texto com 4500 caracteres dividido em parágrafos
    const p1 = 'Parágrafo 1 com detalhes profundos sobre tecnologia e arquitetura. '.repeat(30);
    const p2 = 'Parágrafo 2 com implementação prática e metodologia ágil. '.repeat(30);
    const longText = `${p1}\n\n${p2}`;

    fakeAiManager.chat = async () => ({
      text: longText,
      provider: 'groq',
      model: 'qwen'
    });

    try {
      await spyFeatures.handleAIChat(fakeSock, '5511999990000@s.whatsapp.net', '!ia me explique tudo detalhado', 'Carlos');

      assert.ok(sentMessages.length >= 2, `Deveria ter enviado pelo menos 2 blocos para não cortar. Enviou: ${sentMessages.length}`);
      const joined = sentMessages.join('\n\n');
      assert.strictEqual(joined.length >= longText.length - 10, true, 'Todo o conteúdo do texto longo deve ter sido preservado');
    } finally {
      fakeAiManager.chat = originalChat;
    }
  });

  console.log(`\n======================================================`);
  console.log(`TOTAL HELP & IA: ${passed}/${total} TESTES PASSARAM!`);
  console.log(`======================================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * =========================================================================
 * 🧪 TEST SUITE: FLOWITH BLANK AI & REGISTERED API TOKENS FALLBACK
 * =========================================================================
 * Verifica a regra estrita do usuário:
 * "nas funções de ia, quero que só use os meus tokens de api cadastrados quando
 *  https://flowith.io/blank não funcionar"
 * =========================================================================
 */

const assert = require('assert');
const flowithService = require('./src/services/flowithService');
const aiManager = require('./src/services/aiManagerService');
const achadinhosService = require('./src/services/achadinhosService');
const spyFeatures = require('./src/services/spyFeaturesService');
const models = require('./src/db/models');

async function runTests() {
  console.log('🚀 Iniciando Testes do Sistema Flowith AI Zero-Token & Fallback...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // TESTE 1: Configuração e Estado Inicial do FlowithService (Cancelado por padrão)
  // -------------------------------------------------------------------------
  test('1. Configuração e Estado Inicial do FlowithService', () => {
    flowithService.setEnabled(false);
    assert.strictEqual(flowithService.targetUrl, 'https://flowith.io/blank');
    assert.strictEqual(flowithService.isEnabled(), false, 'Flowith deve iniciar cancelado/desativado');
    
    flowithService.resetStats();
    const status = flowithService.getStatus();
    assert.strictEqual(status.targetUrl, 'https://flowith.io/blank');
    assert.strictEqual(status.totalRequests, 0);
    assert.strictEqual(status.flowithSuccesses, 0);
    assert.strictEqual(status.fallbacksToApiTokens, 0);
    assert.ok(status.policy.includes('https://flowith.io/blank'));
  });

  // -------------------------------------------------------------------------
  // TESTE 2: Quando Flowith Blank FUNCIONA -> Zero Tokens de API Gastos
  // -------------------------------------------------------------------------
  await testAsync('2. Quando Flowith Blank FUNCIONA: Usa Flowith e NÃO gasta tokens de API', async () => {
    flowithService.setEnabled(true);
    flowithService.resetStats();
    flowithService.setSimulationMode(true, ({ userPrompt }) => {
      return `Resposta gerada diretamente pelo Flowith Blank para: ${userPrompt}`;
    });

    let paidApiCalled = false;
    const originalCallChatProvider = aiManager._callChatProvider;
    aiManager._callChatProvider = async () => {
      paidApiCalled = true;
      return 'Resposta paga da API';
    };

    try {
      const res = await aiManager.chat({
        userPrompt: 'Qual a melhor estratégia para vender no WhatsApp?',
        isMaster: true
      });

      assert.strictEqual(res.provider, 'flowith', 'Deveria ter usado o provedor flowith');
      assert.strictEqual(res.savedTokens, true, 'Deveria sinalizar economia de tokens');
      assert.ok(res.text.includes('Flowith Blank'), 'O texto deve vir do Flowith');
      assert.strictEqual(paidApiCalled, false, 'JAMAIS deve chamar APIs pagas quando o Flowith funciona!');

      const status = flowithService.getStatus();
      assert.strictEqual(status.flowithSuccesses, 1);
      assert.strictEqual(status.fallbacksToApiTokens, 0);
      assert.strictEqual(status.tokenSavingsPercentage, '100%');
    } finally {
      aiManager._callChatProvider = originalCallChatProvider;
      flowithService.setSimulationMode(false);
    }
  });

  // -------------------------------------------------------------------------
  // TESTE 3: Quando Flowith Blank FALHA -> Aciona Fallback para Tokens Cadastrados
  // -------------------------------------------------------------------------
  await testAsync('3. Quando Flowith Blank FALHA: Aciona tokens de API cadastrados sem interrupção', async () => {
    flowithService.resetStats();
    
    // Força falha no Flowith simulando instabilidade / queda em https://flowith.io/blank
    flowithService.setSimulationMode(true, () => {
      throw new Error('503 Service Unavailable no Flowith Blank');
    });

    let paidApiProviderUsed = null;
    const originalCallChatProvider = aiManager._callChatProvider;
    aiManager._callChatProvider = async (provider, key, model) => {
      paidApiProviderUsed = provider;
      return `Resposta de contingência via ${provider} (${model}) após queda do Flowith.`;
    };

    try {
      const res = await aiManager.chat({
        userPrompt: 'Como funciona o reembolso?',
        isMaster: true
      });

      assert.notStrictEqual(res.provider, 'flowith', 'Não deveria usar Flowith já que ele falhou');
      assert.ok(paidApiProviderUsed !== null, 'Deveria ter acionado um provedor com chave de API cadastrada');
      assert.ok(res.text.includes('após queda do Flowith'));

      const status = flowithService.getStatus();
      assert.strictEqual(status.flowithSuccesses, 0);
      assert.strictEqual(status.fallbacksToApiTokens, 1);
      assert.ok(status.lastError.includes('503 Service Unavailable'));
    } finally {
      aiManager._callChatProvider = originalCallChatProvider;
      flowithService.setSimulationMode(false);
    }
  });

  // -------------------------------------------------------------------------
  // TESTE 4: Sub-Bots Usando Flowith Gratuitamente vs Fallback de Sub-Bot
  // -------------------------------------------------------------------------
  await testAsync('4. Sub-Bots operam com Flowith gratuito e exigem chave própria se o Flowith cair', async () => {
    // 4.1 Com Flowith ativo: Sub-Bot usa Flowith mesmo sem chave própria
    flowithService.resetStats();
    flowithService.setSimulationMode(true, () => 'Resposta grátis para o Sub-Bot via Flowith');

    const subbotRes = await aiManager.chat({
      userPrompt: 'Olá, gostaria de saber os preços',
      subbotId: 999
    });

    assert.strictEqual(subbotRes.provider, 'flowith');
    assert.strictEqual(subbotRes.savedTokens, true);

    // 4.2 Com Flowith falhando: Sub-Bot sem chave própria é bloqueado com mensagem educativa
    flowithService.setSimulationMode(true, () => {
      throw new Error('Flowith offline');
    });

    let blockedCaught = false;
    try {
      await aiManager.chat({
        userPrompt: 'Olá',
        subbotId: 999
      });
    } catch (err) {
      blockedCaught = true;
      assert.ok(err.message.includes('Sub-Bot #999 Bloqueado'));
    }
    assert.strictEqual(blockedCaught, true, 'Sub-Bot sem chave deve ser bloqueado quando Flowith falha');
    flowithService.setSimulationMode(false);
    flowithService.setEnabled(false);
  });

  // -------------------------------------------------------------------------
  // TESTE 5: Comandos WhatsApp (!flowith, !fl, !menuabv com atalhos)
  // -------------------------------------------------------------------------
  await testAsync('5. Comandos WhatsApp (!flowith, !fl, !menuabv)', async () => {
    // 5.1 Guia de atalhos (!menuabv) contém !fl
    const guide = achadinhosService.getAbbreviatedMenuGuide();
    assert.ok(guide.includes('!fl'), 'Guia de abreviações deve conter o atalho !fl');
    assert.ok(guide.includes('!flowith'), 'Guia de abreviações deve mencionar !flowith');

    // 5.2 Formatação da mensagem de status do Flowith
    const statusMsg = flowithService.formatStatusMessage();
    assert.ok(statusMsg.includes('FLOWITH BLANK'));
    assert.ok(statusMsg.includes('https://flowith.io/blank'));
    assert.ok(statusMsg.includes('Economia de Tokens'));

    // 5.3 Simulação de despacho via spyFeatures.handleAIChat
    let sentMessage = null;
    const fakeSock = {
      sendMessage: async (jid, payload) => {
        sentMessage = payload.text;
        return { key: { id: 'test' } };
      }
    };

    // Consulta !ia flowith
    await spyFeatures.handleAIChat(fakeSock, '5511999999999@s.whatsapp.net', '!ia flowith', 'Admin');
    assert.ok(sentMessage.includes('STATUS DA IA FLOWITH BLANK'));

    // Consulta !ia pergunta normal com Flowith simulado
    flowithService.setEnabled(true);
    flowithService.setSimulationMode(true, () => 'Simulação de resposta inteligente');
    await spyFeatures.handleAIChat(fakeSock, '5511999999999@s.whatsapp.net', '!ia como aumentar minhas vendas?', 'Comprador');
    assert.ok(sentMessage.includes('⚡ Flowith Blank (0 Tokens de API)'));
    assert.ok(sentMessage.includes('Simulação de resposta inteligente'));

    flowithService.setSimulationMode(false);
    flowithService.setEnabled(false);
  });

  // -------------------------------------------------------------------------
  // TESTE 6: Roteamento via handleAchadinhosCommand (!fl e !ach fl)
  // -------------------------------------------------------------------------
  await testAsync('6. Roteamento via handleAchadinhosCommand (!fl e !ach fl)', async () => {
    let sentReply = null;
    const fakeSock = {
      sendMessage: async (jid, payload) => {
        sentReply = payload.text;
        return { key: { id: 'test' } };
      }
    };

    await achadinhosService.handleAchadinhosCommand({
      sock: fakeSock,
      from: '5511999999999@s.whatsapp.net',
      text: '!fl',
      senderPhone: '5511999999999'
    });
    assert.ok(sentReply.includes('FLOWITH BLANK'));

    // Teste com prefixo !ach fl
    sentReply = null;
    await achadinhosService.handleAchadinhosCommand({
      sock: fakeSock,
      from: '5511999999999@s.whatsapp.net',
      text: '!ach fl',
      senderPhone: '5511999999999'
    });
    assert.ok(sentReply.includes('FLOWITH BLANK'));
  });

  // -------------------------------------------------------------------------
  // TESTE 7: REST API Endpoints (/api/ai/flowith/status & config)
  // -------------------------------------------------------------------------
  await testAsync('7. REST API Endpoints (/api/ai/flowith/status & config)', async () => {
    const request = require('supertest');
    const { createServer, createStoreServer } = require('./src/server/app');

    const app = createServer();
    const resGet = await request(app).get('/api/ai/flowith/status');
    assert.strictEqual(resGet.status, 200);
    assert.strictEqual(resGet.body.targetUrl, 'https://flowith.io/blank');
    assert.strictEqual(resGet.body.enabled, false);

    const resPost = await request(app)
      .post('/api/ai/flowith/config')
      .send({ enabled: true, endpoint: 'http://127.0.0.1:8000/v1' });
    assert.strictEqual(resPost.status, 200);
    assert.strictEqual(resPost.body.status.endpoint, 'http://127.0.0.1:8000/v1');

    // Restaura estado desativado
    flowithService.setEnabled(false);
    flowithService.setEndpoint('');
  });

  // -------------------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------------------
  console.log(`\n=======================================================`);
  console.log(`🎯 RESULTADO DOS TESTES FLOWITH: ${passed}/${total} PASSOU COM SUCESSO!`);
  console.log(`=======================================================\n`);
}

runTests().catch(err => {
  console.error('Falha geral no teste:', err);
  process.exit(1);
});

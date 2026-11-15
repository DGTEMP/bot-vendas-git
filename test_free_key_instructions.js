/**
 * =========================================================================
 * 🧪 TEST SUITE: INSTRUÇÕES E LINKS PARA OBTER CHAVE DE IA GRATUITA
 * =========================================================================
 * Valida:
 * 1. Formatação das instruções com links diretos (Google Gemini e Groq Cloud)
 * 2. Bloqueio de sub-bot enviando o passo a passo com links
 * 3. Comando abreviado !cf / !chavefree enviando as instruções
 * 4. Perguntas em linguagem natural ("como pegar chave", "onde pegar chave")
 * 5. Rejeição de chave inválida oferecendo o guia completo com links
 * =========================================================================
 */

const assert = require('assert');
process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const aiManager = require('./src/services/aiManagerService');
const swarmIntelligence = require('./src/services/swarmIntelligenceService');
const handler = require('./src/handler');
const achadinhosService = require('./src/services/achadinhosService');

async function testFreeKeyInstructions() {
  console.log('=================================================================');
  console.log('🚀 TESTANDO INSTRUÇÕES E LINKS PARA CHAVES DE IA GRATUITAS');
  console.log('=================================================================\n');

  // 1. aiManager.getFreeApiKeyInstructions
  console.log('👉 [TESTE 1] Método aiManager.getFreeApiKeyInstructions()');
  const instructions = aiManager.getFreeApiKeyInstructions({ subbotId: 9999, isBlocked: true });
  assert.ok(instructions.includes('https://aistudio.google.com/app/apikey'), 'Deve conter o link do Google Gemini');
  assert.ok(instructions.includes('https://console.groq.com/keys'), 'Deve conter o link do Groq Cloud');
  assert.ok(instructions.includes('/subbot?subbot=9999&tab=ai#tab-ai'), 'Deve conter link parametrizado do painel web para o sub-bot');
  assert.ok(instructions.includes('Passo a Passo'), 'Deve conter o passo a passo didático');
  assert.ok(instructions.includes('50 Tokens Diários Garantidos'), 'Deve mencionar a liberação de 50 tokens diários');
  console.log('   ✅ Instruções estruturadas com link parametrizado do painel web e links oficiais!\n');

  // 2. Bloqueio de comando no Sub-Bot sem chave
  console.log('👉 [TESTE 2] Sub-bot bloqueado recebe instruções completas no chat');
  const subbotId = 7777;
  models.setSubBotAiKeys(subbotId, 'groq', []);
  models.setSubBotAiKeys(subbotId, 'gemini', []);

  let capturedReply = '';
  const mockCustomSock = {
    instanceId: subbotId,
    sendMessage: async (jid, content) => {
      capturedReply = content.text || content;
      return true;
    }
  };

  await handler.handleMessage(null, {
    key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'MSG_BLOCKED_TEST' },
    message: { conversation: '!menu' },
    pushName: 'Usuário Sem Chave'
  }, mockCustomSock);

  assert.ok(capturedReply.includes('SUB-BOT #7777 BLOQUEADO'), 'Deve alertar o bloqueio');
  assert.ok(capturedReply.includes('https://aistudio.google.com/app/apikey'), 'Deve conter link no bloqueio');
  assert.ok(capturedReply.includes('https://console.groq.com/keys'), 'Deve conter link da Groq no bloqueio');
  console.log('   ✅ Sub-bot bloqueado recebeu instruções com links diretamente na tentativa de comando!\n');

  // 3. Comando !cf e !chavefree
  console.log('👉 [TESTE 3] Comando !cf e !chavefree com link parametrizado');
  let cmdReply = '';
  const mockSockForCmd = {
    instanceId: subbotId,
    sendMessage: async (jid, content) => {
      cmdReply = content.text || content;
      return true;
    }
  };

  await achadinhosService.handleAchadinhosCommand({
    sock: mockSockForCmd,
    from: '5511999997777@s.whatsapp.net',
    text: '!cf',
    senderPhone: '5511999997777'
  });

  assert.ok(cmdReply.includes('/subbot?subbot=7777&tab=ai#tab-ai'), '!cf deve enviar link parametrizado para o Sub-Bot #7777');
  assert.ok(cmdReply.includes('https://aistudio.google.com/app/apikey'), '!cf deve enviar link do Gemini');
  assert.ok(cmdReply.includes('https://console.groq.com/keys'), '!cf deve enviar link do Groq');

  // Testando !cf com ID explícito (!cf 8888)
  await achadinhosService.handleAchadinhosCommand({
    sock: mockSockForCmd,
    from: '5511999997777@s.whatsapp.net',
    text: '!cf 8888',
    senderPhone: '5511999997777'
  });
  assert.ok(cmdReply.includes('/subbot?subbot=8888&tab=ai#tab-ai'), '!cf 8888 deve parametrizar especificamente para o Sub-Bot #8888');
  console.log('   ✅ Comando abreviado !cf enviou o link parametrizado e o guia completo!\n');

  // 4. Pergunta em linguagem natural ("como pegar chave")
  console.log('👉 [TESTE 4] Pergunta em linguagem natural ("como pegar chave")');
  let naturalReply = '';
  const mockSockNatural = {
    instanceId: subbotId,
    sendMessage: async (jid, content) => {
      naturalReply = content.text || content;
      return true;
    }
  };

  const naturalResult = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockNatural,
    instanceId: subbotId,
    from: '5511999997777@s.whatsapp.net',
    sender: '5511999997777@s.whatsapp.net',
    text: 'amigo como pegar chave gratis pro bot?',
    pushName: 'Cliente Dúvida',
    isGroup: false
  });

  assert.strictEqual(naturalResult.handled, true, 'Mensagem deve ser tratada');
  assert.strictEqual(naturalResult.action, 'INSTRUCTIONS_SENT', 'Ação deve ser INSTRUCTIONS_SENT');
  assert.ok(naturalReply.includes('https://aistudio.google.com/app/apikey'), 'Deve conter link');
  console.log('   ✅ Pergunta em linguagem natural respondida com instruções e links imediatos!\n');

  // 5. Chave inválida recebendo instruções de regularização
  console.log('👉 [TESTE 5] Chave inválida oferece instruções para gerar chave correta');
  let failedReply = '';
  const mockSockFailed = {
    instanceId: subbotId,
    sendMessage: async (jid, content) => {
      failedReply = content.text || content;
      return true;
    }
  };

  const failedResult = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockFailed,
    instanceId: subbotId,
    from: '5511999997777@s.whatsapp.net',
    sender: '5511999997777@s.whatsapp.net',
    text: 'gsk_invalid_test_key_00000000000000000000000000',
    pushName: 'Cliente Erro',
    isGroup: false
  });

  assert.strictEqual(failedResult.handled, true);
  assert.strictEqual(failedResult.action, 'KEY_REJECTED');
  assert.ok(failedReply.includes('CHAVE DE IA RECUSADA OU EXPIRADA'), 'Deve avisar recusa');
  assert.ok(failedReply.includes('https://aistudio.google.com/app/apikey'), 'Deve conter link para gerar chave nova');
  console.log('   ✅ Rejeição de chave oferece link e instruções para obter chave correta!\n');

  console.log('═════════════════════════════════════════════════════════════════');
  console.log('🎉 TODOS OS 5 TESTES DE INSTRUÇÕES E LINKS PASSARAM COM SUCESSO!');
  console.log('═════════════════════════════════════════════════════════════════');
}

testFreeKeyInstructions().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

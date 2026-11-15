const assert = require('assert');
const handler = require('./src/handler');
const models = require('./src/db/models');

async function runHandlerPlayIntegrationTests() {
  console.log('🧪 Iniciando Teste de Integração Nativa de !play e !playdoc no Handler...\n');
  process.env.NODE_ENV = 'test';

  const reactions = [];
  const sentMessages = [];

  const mockSock = {
    user: { id: '254102815766:1@s.whatsapp.net' },
    sendMessage: async (to, payload, options) => {
      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      sentMessages.push({ to, payload, options, id: msgId });
      return { key: { id: msgId, remoteJid: to } };
    }
  };

  const mockWhatsappBot = {
    sock: mockSock,
    currentDispatchSock: mockSock,
    isOwner: () => false,
    checkIsAdmin: async () => false,
    groupMetadataCache: new Map(),
    _processIncomingMessage: async () => {
      throw new Error('Não deveria cair no fallback de _processIncomingMessage!');
    }
  };

  function createRawMessage(text, from = '120363346115853465@g.us', sender = '554891941092@s.whatsapp.net') {
    return {
      key: {
        remoteJid: from,
        participant: sender,
        id: 'RAW_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        fromMe: false
      },
      message: {
        conversation: text
      },
      pushName: 'Tester User'
    };
  }

  // TESTE 1: !play nativo via handler
  console.log('--- TESTE 1: !play nativo via handler.handleMessage ---');
  sentMessages.length = 0;
  reactions.length = 0;

  const rawPlayMsg = createRawMessage('!play Coldplay Paradise');
  // Monkey-patch sock.sendMessage to record reactions
  mockSock.sendMessage = async (to, payload, options) => {
    if (payload.react) {
      reactions.push(payload.react.text);
      return { key: { id: 'react_id' } };
    }
    const msgId = 'msg_' + Date.now();
    sentMessages.push({ to, payload, options, id: msgId });
    return { key: { id: msgId, remoteJid: to } };
  };

  const playRes = await handler.handleMessage(mockWhatsappBot, rawPlayMsg, mockSock);
  console.log('  Resultado do handler:', playRes);
  assert(playRes, 'Handler deve retornar resposta');
  assert(sentMessages.length >= 2, 'Deve ter enviado card de preview e áudio MP3');
  const hasAudio = sentMessages.some(m => m.payload.audio || m.payload.document);
  assert(hasAudio, 'Deve ter enviado áudio ou documento de áudio');
  assert(reactions.includes('⏳') || reactions.includes('✅'), 'Deve ter reagido no fluxo nativo');
  console.log('  ✅ PASS: !play executado nativamente pelo Handler sem cair no fallback!');

  // TESTE 2: !playdoc nativo via handler
  console.log('\n--- TESTE 2: !playdoc nativo via handler.handleMessage ---');
  sentMessages.length = 0;
  reactions.length = 0;

  const rawDocMsg = createRawMessage('!playdoc Imagine Dragons Radioactive');
  const docRes = await handler.handleMessage(mockWhatsappBot, rawDocMsg, mockSock);
  console.log('  Resultado do handler:', docRes);
  assert(docRes, 'Handler deve retornar resposta');
  assert(sentMessages.length >= 2, 'Deve ter enviado card de preview e documento MP3');
  const hasDoc = sentMessages.some(m => m.payload.document);
  assert(hasDoc, 'Deve ter enviado documento MP3');
  console.log('  ✅ PASS: !playdoc executado nativamente pelo Handler sem cair no fallback!');

  // TESTE 3: Verificação de Auditoria no Banco de Dados
  console.log('\n--- TESTE 3: Verificação de Auditoria (bot_command_audit_logs) ---');
  const db = require('./src/db/database');
  const recentAudits = db.prepare('SELECT * FROM bot_command_audit_logs ORDER BY id DESC LIMIT 5').all();
  const playAudit = recentAudits.find(a => a.command.includes('!play Coldplay Paradise'));
  const playDocAudit = recentAudits.find(a => a.command.includes('!playdoc Imagine Dragons Radioactive'));

  assert(playAudit, 'Deve registrar auditoria do !play');
  assert.strictEqual(playAudit.status, 'SUCCESS', 'Status de auditoria do !play deve ser SUCCESS');
  assert(playAudit.execution_time_ms >= 0, 'execution_time_ms deve estar registrado');

  assert(playDocAudit, 'Deve registrar auditoria do !playdoc');
  assert.strictEqual(playDocAudit.status, 'SUCCESS', 'Status de auditoria do !playdoc deve ser SUCCESS');
  assert(playDocAudit.execution_time_ms >= 0, 'execution_time_ms deve estar registrado');
  console.log('  ✅ PASS: Comandos auditados com tempo real de execução e status SUCCESS!');

  console.log('\n🎉 TODOS OS TESTES DE INTEGRAÇÃO NATIVA PASSARAM COM SUCESSO!\n');
}

runHandlerPlayIntegrationTests().catch(err => {
  console.error('❌ Falha no teste de integração:', err);
  process.exit(1);
});

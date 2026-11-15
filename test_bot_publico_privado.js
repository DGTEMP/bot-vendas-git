const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const botFleetAdminService = require('./src/services/botFleetAdminService');
const spyFeaturesService = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: BOT & SUB-BOT MODO PÚBLICO VS PRIVADO (SÓ RESPONDE A SI MESMO)');
  console.log('========================================================================');

  // Setup: Sub-bot para testes
  const testPhone = '5511977778888';
  const strangerPhone = '5511911112222';
  const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '554884702848').replace(/\D/g, '');

  const testBot = models.createArmyInstance({
    name: 'Sub-Bot Acesso Teste',
    phone: testPhone,
    daily_limit: 50,
    tokens_balance: 50,
    tokens_daily_base: 50,
    is_subbot: 1,
    terms_accepted: 1,
    access_mode: 'PUBLIC'
  });
  const botId = testBot.id;
  console.log(`📌 Criado Sub-Bot #${botId} (+${testPhone}) para testes de modo de acesso.`);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Métodos de Model e Persistência no Banco (Matriz e Sub-Bot)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 1: Models e Persistência de access_mode ---');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PUBLIC', 'Sub-bot deve nascer PUBLIC por padrão');
    
    models.setSubBotAccessMode(botId, 'PRIVATE');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PRIVATE', 'Sub-bot deve persistir PRIVATE');
    assert.strictEqual(models.isBotPrivateMode(botId), true, 'isBotPrivateMode deve ser true');

    models.setSubBotAccessMode(botId, 'PUBLIC');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PUBLIC', 'Sub-bot deve voltar para PUBLIC');
    assert.strictEqual(models.isBotPrivateMode(botId), false, 'isBotPrivateMode deve ser false');

    // Matriz (id = 1)
    const initialMatrizMode = models.getMatrizAccessMode();
    models.setMatrizAccessMode('PRIVATE');
    assert.strictEqual(models.getMatrizAccessMode(), 'PRIVATE', 'Matriz deve persistir PRIVATE');
    assert.strictEqual(models.isBotPrivateMode(1), true, 'isBotPrivateMode(1) deve ser true');

    models.setMatrizAccessMode('PUBLIC');
    assert.strictEqual(models.getMatrizAccessMode(), 'PUBLIC', 'Matriz deve persistir PUBLIC');
    assert.strictEqual(models.isBotPrivateMode(1), false, 'isBotPrivateMode(1) deve ser false');
    console.log('✅ Teste 1 passou: Persistência e models funcionando perfeitamente!');

    // -------------------------------------------------------------------------
    // TESTE 2: botFleetAdminService (controlSubBot)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 2: botFleetAdminService.controlSubBot(publico/privado) ---');
    const privRes = await botFleetAdminService.controlSubBot(botId, 'privado');
    assert.strictEqual(privRes.success, true);
    assert.strictEqual(privRes.access_mode, 'PRIVATE');
    assert(privRes.message.includes('MODO PRIVADO'), 'Mensagem deve confirmar modo privado');
    assert(privRes.message.includes('apenas a si mesmo'), 'Mensagem deve destacar que só responde a si mesmo');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PRIVATE');

    const pubRes = await botFleetAdminService.controlSubBot(botId, 'publico');
    assert.strictEqual(pubRes.success, true);
    assert.strictEqual(pubRes.access_mode, 'PUBLIC');
    assert(pubRes.message.includes('MODO PÚBLICO'), 'Mensagem deve confirmar modo público');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PUBLIC');

    const modoRes = await botFleetAdminService.controlSubBot(botId, 'modo');
    assert.strictEqual(modoRes.success, true);
    assert.strictEqual(modoRes.action, 'mode_status');
    assert(modoRes.message.includes('PÚBLICO'));
    console.log('✅ Teste 2 passou: botFleetAdminService controlSubBot funcionando!');

    // -------------------------------------------------------------------------
    // TESTE 3: spyFeaturesService.handleBotAccessMode
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 3: spyFeaturesService.handleBotAccessMode ---');
    const sentMessages = [];
    const mockSock = {
      instanceId: botId,
      _isFromMe: false,
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'MOCK_' + Date.now(), remoteJid: jid } };
      }
    };

    // Estranho tentando alterar o subbot para privado -> ACESSO NEGADO
    sentMessages.length = 0;
    await spyFeaturesService.handleBotAccessMode(mockSock, 'status@broadcast', '!privado', strangerPhone, false, mockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('ACESSO NEGADO'), 'Estranho não pode alterar modo');

    // Dono do próprio chip do Sub-Bot alterando para privado -> SUCESSO
    sentMessages.length = 0;
    await spyFeaturesService.handleBotAccessMode(mockSock, `${testPhone}@s.whatsapp.net`, '!privado', testPhone, false, mockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('MODO PRIVADO'), 'Dono do chip pode ativar privado');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PRIVATE');

    // Dono do próprio chip alterando de volta para público -> SUCESSO
    sentMessages.length = 0;
    await spyFeaturesService.handleBotAccessMode(mockSock, `${testPhone}@s.whatsapp.net`, '!publico', testPhone, false, mockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('MODO PÚBLICO'), 'Dono do chip pode ativar público');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PUBLIC');

    // Dono Supremo do Sistema alterando Sub-Bot remotamente: !subbot privado <id>
    sentMessages.length = 0;
    await spyFeaturesService.handleBotAccessMode(mockSock, `${ownerPhone}@s.whatsapp.net`, `!subbot privado ${botId}`, ownerPhone, true, mockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('MODO PRIVADO'), 'Dono Supremo pode alterar qualquer subbot');
    assert.strictEqual(models.getSubBotAccessMode(botId), 'PRIVATE');

    // Matriz: Dono ativando !privado na Matriz (#1)
    sentMessages.length = 0;
    const mainMockSock = {
      instanceId: 1,
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'MOCK_MAIN_' + Date.now(), remoteJid: jid } };
      }
    };
    await spyFeaturesService.handleBotAccessMode(mainMockSock, `${ownerPhone}@s.whatsapp.net`, '!privado', ownerPhone, true, mainMockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('BOT MATRIZ CONFIGURADO PARA MODO PRIVADO'), 'Dono pode ativar privado na Matriz');
    assert.strictEqual(models.getMatrizAccessMode(), 'PRIVATE');

    // Matriz: Dono ativando !publico na Matriz (#1)
    sentMessages.length = 0;
    await spyFeaturesService.handleBotAccessMode(mainMockSock, `${ownerPhone}@s.whatsapp.net`, '!publico', ownerPhone, true, mainMockSock);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('BOT MATRIZ CONFIGURADO PARA MODO PÚBLICO'), 'Dono pode ativar público na Matriz');
    assert.strictEqual(models.getMatrizAccessMode(), 'PUBLIC');
    console.log('✅ Teste 3 passou: spyFeaturesService.handleBotAccessMode com permissões validado!');

    // -------------------------------------------------------------------------
    // TESTE 4: Enforçamento no handler.js (Sub-Bot)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 4: Gatekeeper do handler.js para Sub-Bot (Público vs Privado) ---');
    
    // Sub-Bot em MODO PÚBLICO:
    models.setSubBotAccessMode(botId, 'PUBLIC');
    let handlerExecuted = false;
    let mockConn = {
      instanceId: botId,
      user: { id: `${testPhone}:1@s.whatsapp.net` },
      sendMessage: async (jid, content) => {
        handlerExecuted = true;
        return { key: { id: 'MOCK_H_' + Date.now() } };
      }
    };

    // Mensagem de estranho executando !ping no Sub-Bot em modo público
    let rawMsg = {
      key: { remoteJid: '12036300000000@g.us', id: 'TEST_PUB_' + Date.now(), fromMe: false, participant: `${strangerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mockConn }, rawMsg, mockConn);
    assert.strictEqual(handlerExecuted, true, 'No modo público, comando de terceiros DEVE executar');

    // Agora muda o Sub-Bot para MODO PRIVADO:
    models.setSubBotAccessMode(botId, 'PRIVATE');
    
    // Mensagem de estranho executando !ping no Sub-Bot em modo privado: DEVE SER IGNORADA!
    rawMsg = {
      key: { remoteJid: '12036300000000@g.us', id: 'TEST_PRIV_STRANGER_' + Date.now(), fromMe: false, participant: `${strangerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mockConn }, rawMsg, mockConn);
    assert.strictEqual(handlerExecuted, false, 'No modo privado, comando de terceiros DEVE ser ignorado silenciosamente');

    // Mensagem de SI MESMO (fromMe = true) no Sub-Bot em modo privado: DEVE EXECUTAR!
    rawMsg = {
      key: { remoteJid: '12036300000000@g.us', id: 'TEST_PRIV_SELF_' + Date.now(), fromMe: true, participant: `${testPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mockConn }, rawMsg, mockConn);
    assert.strictEqual(handlerExecuted, true, 'No modo privado, comando enviado por si mesmo (fromMe) DEVE executar');

    // Mensagem enviada pelo Dono Supremo (isROwner) no Sub-Bot em modo privado: DEVE EXECUTAR!
    rawMsg = {
      key: { remoteJid: '12036300000000@g.us', id: 'TEST_PRIV_OWNER_' + Date.now(), fromMe: false, participant: `${ownerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mockConn }, rawMsg, mockConn);
    assert.strictEqual(handlerExecuted, true, 'No modo privado, comando enviado pelo Dono Supremo DEVE executar');

    console.log('✅ Teste 4 passou: Gatekeeper de Sub-Bot no handler.js validado com sucesso!');

    // -------------------------------------------------------------------------
    // TESTE 5: Enforçamento no handler.js (Matriz)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 5: Gatekeeper do handler.js para Matriz (Público vs Privado) ---');
    const mainConn = {
      instanceId: 1,
      user: { id: `${ownerPhone}:1@s.whatsapp.net` },
      sendMessage: async (jid, content) => {
        handlerExecuted = true;
        return { key: { id: 'MOCK_MAIN_H_' + Date.now() } };
      }
    };

    // Matriz em MODO PRIVADO:
    models.setMatrizAccessMode('PRIVATE');

    // Estranho tentando executar comando na Matriz em modo privado -> Bloqueado/Ignorado!
    rawMsg = {
      key: { remoteJid: '12036300000001@g.us', id: 'MAIN_PRIV_STRANGER_' + Date.now(), fromMe: false, participant: `${strangerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mainConn }, rawMsg, mainConn);
    assert.strictEqual(handlerExecuted, false, 'Na Matriz em modo privado, comando de terceiros DEVE ser ignorado');

    // Dono Supremo executando comando na Matriz em modo privado -> Executa!
    rawMsg = {
      key: { remoteJid: '12036300000001@g.us', id: 'MAIN_PRIV_OWNER_' + Date.now(), fromMe: false, participant: `${ownerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    const resOwner = await handler.handleMessage({ sock: mainConn }, rawMsg, mainConn);
    assert.strictEqual(handlerExecuted, true, 'Na Matriz em modo privado, Dono Supremo DEVE executar');

    // Matriz volta para MODO PÚBLICO:
    models.setMatrizAccessMode('PUBLIC');
    rawMsg = {
      key: { remoteJid: '12036300000001@g.us', id: 'MAIN_PUB_STRANGER_' + Date.now(), fromMe: false, participant: `${strangerPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: mainConn }, rawMsg, mainConn);
    assert.strictEqual(handlerExecuted, true, 'Na Matriz em modo público, terceiros DEVEM executar');

    console.log('✅ Teste 5 passou: Gatekeeper de Matriz no handler.js validado com sucesso!');

    // -------------------------------------------------------------------------
    // TESTE 6: Enforçamento no whatsappBot._processIncomingMessage
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 6: Gatekeeper do whatsappBot._processIncomingMessage ---');
    models.setSubBotAccessMode(botId, 'PRIVATE');

    let botResponded = false;
    const testCustomSock = {
      instanceId: botId,
      isSubBot: true,
      user: { id: `${testPhone}:1@s.whatsapp.net` },
      sendMessage: async (jid, content) => {
        botResponded = true;
        return { key: { id: 'MOCK_BOT_' + Date.now() } };
      }
    };

    // Mensagem de estranho no privado com o subbot privado
    const privMsgStranger = {
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, id: 'PV_STRANGER_' + Date.now(), fromMe: false, participant: `${strangerPhone}@s.whatsapp.net` },
      message: { conversation: 'Olá, gostaria de saber preços' }
    };
    botResponded = false;
    await whatsappBot._processIncomingMessage(privMsgStranger, testCustomSock);
    assert.strictEqual(botResponded, false, 'No modo privado, mensagem de estranho não gera respostas');

    // Mensagem do próprio chip (fromMe = true)
    const privMsgSelf = {
      key: { remoteJid: `${testPhone}@s.whatsapp.net`, id: 'PV_SELF_' + Date.now(), fromMe: true, participant: `${testPhone}@s.whatsapp.net` },
      message: { conversation: '!status' }
    };
    botResponded = false;
    await whatsappBot._processIncomingMessage(privMsgSelf, testCustomSock);
    assert.strictEqual(botResponded, true, 'No modo privado, mensagem de si mesmo (fromMe) é atendida');

    console.log('✅ Teste 6 passou: whatsappBot._processIncomingMessage validado com sucesso!');

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS 6 TESTES DE !publico E !privado PASSARAM COM 100% DE SUCESSO!');
    console.log('========================================================================');

  } finally {
    // Limpeza
    models.setMatrizAccessMode('PUBLIC');
    try {
      db.prepare('DELETE FROM whatsapp_army_instances WHERE id = ?').run(botId);
    } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de !publico / !privado:', err);
  process.exit(1);
});

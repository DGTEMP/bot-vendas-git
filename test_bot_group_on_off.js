const assert = require('assert');
const models = require('./src/db/models');
const spyFeaturesService = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: COMANDO !bot on E !bot off DIRETAMENTE NO GRUPO');
  console.log('========================================================================');

  const groupA = '12036311111111@g.us';
  const groupB = '12036322222222@g.us';
  const adminPhone = '5511999990001';
  const memberPhone = '5511988880002';
  const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '554884702848').replace(/\D/g, '');

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Models e Persistência de isGroupBotActive / setGroupBotActive
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 1: Models e Persistência do Bot Ativo por Grupo ---');
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Grupo novo deve ter bot ativo por padrão (true)');
    assert.strictEqual(models.isGroupBotActive(groupB), true, 'Grupo B deve ter bot ativo por padrão (true)');

    models.setGroupBotActive(groupA, false);
    assert.strictEqual(models.isGroupBotActive(groupA), false, 'Grupo A deve estar desativado (false)');
    assert.strictEqual(models.isGroupBotActive(groupB), true, 'Grupo B deve continuar ativo independentemente');

    models.setGroupBotActive(groupA, true);
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Grupo A deve voltar a ficar ativo (true)');
    console.log('✅ Teste 1 passou: Persistência e isolamento entre grupos 100% validados!');

    // -------------------------------------------------------------------------
    // TESTE 2: Execução de !bot on / !bot off no Privado (PV) -> Aviso explicativo
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 2: !bot on/off executado no PV deve instruir a usar no grupo ---');
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, content });
        return { key: { id: 'MOCK_' + Date.now(), remoteJid: jid } };
      }
    };

    sentMessages.length = 0;
    await spyFeaturesService.handleGroupBotOnOff(mockSock, `${adminPhone}@s.whatsapp.net`, '!bot off', adminPhone, false, false, false);
    assert(sentMessages.length > 0, 'Deve responder aviso no PV');
    assert(sentMessages[0].content.text.includes('diretamente dentro do grupo'), 'Deve informar que deve ser digitado no grupo');
    console.log('✅ Teste 2 passou: Bloqueio amigável no privado validado!');

    // -------------------------------------------------------------------------
    // TESTE 3: Permissões de Grupo (Membro comum vs Admin/Dono)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 3: Apenas Administradores e Dono podem ligar/desligar o bot ---');
    models.setGroupBotActive(groupA, true);

    // Membro comum tentando !bot off -> Acesso Negado
    sentMessages.length = 0;
    await spyFeaturesService.handleGroupBotOnOff(mockSock, groupA, '!bot off', memberPhone, true, false, false);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('Acesso Negado'), 'Membro comum deve receber Acesso Negado');
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Bot deve continuar ativo');

    // Administrador executando !bot off -> Sucesso
    sentMessages.length = 0;
    await spyFeaturesService.handleGroupBotOnOff(mockSock, groupA, '!bot off', adminPhone, true, true, false);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('BOT DESATIVADO NESTE GRUPO'), 'Admin pode desativar o bot');
    assert.strictEqual(models.isGroupBotActive(groupA), false, 'Bot agora deve estar desativado no Grupo A');

    // Consulta de status no grupo desativado (!bot status)
    sentMessages.length = 0;
    await spyFeaturesService.handleGroupBotOnOff(mockSock, groupA, '!bot status', adminPhone, true, true, false);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('DESATIVADO'), 'Status deve indicar desativado');

    // Administrador executando !bot on -> Sucesso
    sentMessages.length = 0;
    await spyFeaturesService.handleGroupBotOnOff(mockSock, groupA, '!bot on', adminPhone, true, true, false);
    assert(sentMessages.length > 0);
    assert(sentMessages[0].content.text.includes('BOT ATIVADO NESTE GRUPO'), 'Admin pode reativar o bot');
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Bot agora deve estar ativo novamente no Grupo A');

    console.log('✅ Teste 3 passou: Controle de permissões e mensagens validado!');

    // -------------------------------------------------------------------------
    // TESTE 4: Enforçamento Real no handler.js (Silêncio no grupo quando desligado)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 4: Silêncio absoluto para comandos no grupo quando !bot off ---');
    let handlerExecuted = false;
    const testConn = {
      instanceId: 1,
      user: { id: `${ownerPhone}:1@s.whatsapp.net` },
      sendMessage: async (jid, content) => {
        handlerExecuted = true;
        return { key: { id: 'MOCK_H_' + Date.now() } };
      }
    };

    // Com bot ativo, comando !ping de membro comum responde normalmente:
    models.setGroupBotActive(groupA, true);
    let rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_PUB_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, true, 'Quando bot está ativo, comandos comuns devem responder');

    // Desativa o bot no Grupo A: !bot off
    models.setGroupBotActive(groupA, false);

    // 1. Membro comum tentando !ping no Grupo A desligado -> Silêncio total!
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_OFF_PING_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, false, 'Quando bot está desligado, !ping de membro DEVE ser ignorado');

    // 2. Membro comum tentando !menu no Grupo A desligado -> Silêncio total!
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_OFF_MENU_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!menu' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, false, 'Quando bot está desligado, !menu de membro DEVE ser ignorado');

    // 3. Membro comum tentando !bot on no Grupo A desligado -> Ignorado (não é admin)!
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_OFF_BOTON_MEMBER_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!bot on' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, false, 'Membro comum não pode reativar o bot no grupo');
    assert.strictEqual(models.isGroupBotActive(groupA), false, 'Bot deve continuar desligado');

    // 4. Dono Supremo executando !bot on no Grupo A desligado -> DEVE EXECUTAR E REATIVAR!
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_OFF_BOTON_OWNER_' + Date.now(), fromMe: false, participant: `${ownerPhone}@s.whatsapp.net` },
      message: { conversation: '!bot on' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, true, 'Dono / Admin DEVE conseguir reativar o bot com !bot on');
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Bot foi reativado no Grupo A');

    // 5. Após reativação, membros podem usar comandos novamente:
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_AFTER_REACTIVATE_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, true, 'Após reativação, comandos funcionam normalmente de novo');

    console.log('✅ Teste 4 passou: Gatekeeper do handler.js para !bot on e !bot off validado!');

    // -------------------------------------------------------------------------
    // TESTE 5: Isolamento de Grupos (Grupo A desligado não afeta Grupo B)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 5: Isolamento entre diferentes grupos ---');
    models.setGroupBotActive(groupA, false);
    models.setGroupBotActive(groupB, true);

    // Grupo A desligado ignora !ping:
    rawMsg = {
      key: { remoteJid: groupA, id: 'MSG_ISO_A_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, false, 'Grupo A deve ignorar !ping');

    // Grupo B ligado executa !ping:
    rawMsg = {
      key: { remoteJid: groupB, id: 'MSG_ISO_B_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: '!ping' }
    };
    handlerExecuted = false;
    await handler.handleMessage({ sock: testConn }, rawMsg, testConn);
    assert.strictEqual(handlerExecuted, true, 'Grupo B deve executar !ping normalmente');

    console.log('✅ Teste 5 passou: Isolamento perfeito entre grupos validado!');

    // -------------------------------------------------------------------------
    // TESTE 6: Gatekeeper do whatsappBot._processIncomingMessage
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 6: Gatekeeper do whatsappBot._processIncomingMessage ---');
    models.setGroupBotActive(groupA, false);
    let wbResponded = false;
    let wbLastMessage = null;
    const mockWbSock = {
      instanceId: 1,
      sendMessage: async (jid, content) => {
        wbResponded = true;
        wbLastMessage = content;
        return { key: {} };
      }
    };

    // Mensagem comum no grupo desativado
    wbResponded = false;
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupA, id: 'WB_OFF_' + Date.now(), fromMe: false, participant: `${memberPhone}@s.whatsapp.net` },
      message: { conversation: 'Olá bot, você está ativo?' }
    }, mockWbSock);
    assert.strictEqual(wbResponded, false, 'whatsappBot não deve responder no grupo desligado');

    // Dono Supremo enviando !bot on no grupo desativado
    wbResponded = false;
    await whatsappBot._processIncomingMessage({
      key: { remoteJid: groupA, id: 'WB_ON_' + Date.now(), fromMe: false, participant: `${ownerPhone}@s.whatsapp.net` },
      message: { conversation: '!bot on' }
    }, mockWbSock);
    assert.strictEqual(wbResponded, true, 'whatsappBot deve responder ao comando !bot on de admin/dono');
    assert.strictEqual(models.isGroupBotActive(groupA), true, 'Bot reativado via whatsappBot');

    console.log('✅ Teste 6 passou: Gatekeeper do whatsappBot._processIncomingMessage validado!');

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS 6 TESTES DE !bot on E !bot off NO GRUPO PASSARAM COM SUCESSO!');
    console.log('========================================================================');

  } finally {
    // Limpeza
    models.setGroupBotActive(groupA, true);
    models.setGroupBotActive(groupB, true);
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de !bot on / !bot off:', err);
  process.exit(1);
});

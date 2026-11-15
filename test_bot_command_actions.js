/**
 * TEST SUITE: EXECUÇÃO DE COMANDOS DE BOTS DIRETO DO NAVEGADOR
 * Testa os endpoints:
 * - GET /api/bots/command-targets
 * - POST /api/bots/execute-command (todas as 17 ações no Master, Telegram e Sub-Bots)
 */

process.env.NODE_ENV = 'test';
const http = require('http');
const assert = require('assert');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');

let totalTests = 0;
let passedTests = 0;

function check(cond, msg) {
  totalTests++;
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('======================================================');
  console.log('🧪 TESTES: EXECUÇÃO DE COMANDOS DO PAINEL WEB NO BOT');
  console.log('======================================================\n');

  const app = createServer();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // ----------------------------------------------------
    // TESTE 1: GET /api/bots/command-targets
    // ----------------------------------------------------
    console.log('--- 1. Listagem de Alvos e Bots Disponíveis ---');
    const resTargets = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/command-targets',
      method: 'GET'
    });

    check(resTargets.status === 200, 'GET /api/bots/command-targets retorna 200');
    check(resTargets.body.success === true, 'Retorna success: true');
    check(Array.isArray(resTargets.body.instances), 'Retorna array de instâncias de bots');
    
    const masterInst = resTargets.body.instances.find(i => i.id === 'whatsapp_master');
    check(masterInst && masterInst.is_main === true, 'Contém o Bot Master / Dono');

    const tgInst = resTargets.body.instances.find(i => i.id === 'telegram');
    check(tgInst && tgInst.botType === 'telegram', 'Contém o Bot Telegram');

    check(Array.isArray(resTargets.body.groups), 'Retorna array de grupos de WhatsApp/Meteórico');

    // ----------------------------------------------------
    // TESTE 2: POST /api/bots/execute-command -> !desativar e !ativar
    // ----------------------------------------------------
    console.log('\n--- 2. Comandos de Pausa e Reativação (!desativar & !ativar) ---');
    const testChat = '120363999999999999@g.us';

    const resMute = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'desativar',
      botType: 'whatsapp_master',
      targetId: testChat,
      text: 'Pausa solicitada pelo Dono via painel'
    });

    check(resMute.status === 200, '!desativar retorna status 200');
    check(resMute.body.success === true, '!desativar executado com sucesso');
    check(models.isChatMuted('whatsapp', testChat) === true, 'Chat está pausado no banco de dados');

    const resUnmute = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'ativar',
      botType: 'whatsapp_master',
      targetId: testChat
    });

    check(resUnmute.status === 200, '!ativar retorna status 200');
    check(resUnmute.body.success === true, '!ativar executado com sucesso');
    check(models.isChatMuted('whatsapp', testChat) === false, 'Chat está reativado no banco de dados');

    // ----------------------------------------------------
    // TESTE 3: !bloquear e !desbloquear participante
    // ----------------------------------------------------
    console.log('\n--- 3. Bloqueio e Desbloqueio de Participantes (!bloquear & !desbloquear) ---');
    const testUser = '5511988887777';

    const resBlock = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'bloquear',
      botType: 'whatsapp_master',
      targetId: testChat,
      targetParticipant: testUser,
      text: 'SPAM no grupo'
    });

    check(resBlock.status === 200, '!bloquear retorna 200');
    check(resBlock.body.success === true, 'Participante bloqueado com sucesso');
    check(models.isUserBlocked('whatsapp', testUser, testChat) === true, 'isUserBlocked confirma bloqueio');

    const resUnblock = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'desbloquear',
      botType: 'whatsapp_master',
      targetId: testChat,
      targetParticipant: testUser
    });

    check(resUnblock.status === 200, '!desbloquear retorna 200');
    check(resUnblock.body.success === true, 'Participante desbloqueado com sucesso');
    check(models.isUserBlocked('whatsapp', testUser, testChat) === false, 'isUserBlocked confirma liberação');

    // ----------------------------------------------------
    // TESTE 4: !statusbot
    // ----------------------------------------------------
    console.log('\n--- 4. Telemetria e Status em Tempo Real (!statusbot) ---');
    const resStatus = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'statusbot',
      botType: 'whatsapp_master',
      targetId: testChat
    });

    check(resStatus.status === 200, '!statusbot retorna 200');
    check(resStatus.body.success === true, 'Telemetria obtida com sucesso');
    check(resStatus.body.status && resStatus.body.status.targetId === testChat, 'Status corresponde ao chat alvo');
    check(typeof resStatus.body.status.isMuted === 'boolean', 'isMuted retornado');
    check(typeof resStatus.body.status.blockedCount === 'number', 'blockedCount retornado');

    // ----------------------------------------------------
    // TESTE 5: Gestão de Membros (!ban, !promover, !rebaixar, !todos)
    // ----------------------------------------------------
    console.log('\n--- 5. Gestão de Membros de Grupos (!ban, !promover, !rebaixar, !todos) ---');
    
    // BAN
    const resBan = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'ban',
      botType: 'whatsapp_master',
      targetId: testChat,
      targetParticipant: '5511977776666'
    });
    check(resBan.status === 200 && resBan.body.success === true, '!ban executado com sucesso');

    // PROMOVER
    const resPromote = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'promover',
      botType: 'whatsapp_master',
      targetId: testChat,
      targetParticipant: '5511977776666'
    });
    check(resPromote.status === 200 && resPromote.body.success === true, '!promover executado com sucesso');

    // REBAIXAR
    const resDemote = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'rebaixar',
      botType: 'whatsapp_master',
      targetId: testChat,
      targetParticipant: '5511977776666'
    });
    check(resDemote.status === 200 && resDemote.body.success === true, '!rebaixar executado com sucesso');

    // TODOS (@tagall)
    const resTodos = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'todos',
      botType: 'whatsapp_master',
      targetId: testChat,
      text: 'Aviso urgente de promoção relâmpago!'
    });
    check(resTodos.status === 200 && resTodos.body.success === true, '!todos transmitido com sucesso');

    // ----------------------------------------------------
    // TESTE 6: Segurança & Chat (!fechar, !abrir, !antilink, !link, !revogar_link)
    // ----------------------------------------------------
    console.log('\n--- 6. Segurança e Chat (!fechar, !abrir, !antilink, !link, !revogar_link) ---');
    
    // FECHAR
    const resLock = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'fechar',
      botType: 'whatsapp_master',
      targetId: testChat
    });
    check(resLock.status === 200 && resLock.body.success === true, '!fechar executado');

    // ABRIR
    const resUnlock = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'abrir',
      botType: 'whatsapp_master',
      targetId: testChat
    });
    check(resUnlock.status === 200 && resUnlock.body.success === true, '!abrir executado');

    // ANTILINK ON
    const resAntiOn = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'antilink',
      botType: 'whatsapp_master',
      targetId: testChat,
      state: 'on'
    });
    check(resAntiOn.status === 200 && resAntiOn.body.state === 'on', '!antilink on configurado');
    check(models.getSetting(`ANTILINK_${testChat}`) === 'true', 'Configuração ANTILINK salva');

    // ANTILINK OFF
    const resAntiOff = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'antilink',
      botType: 'whatsapp_master',
      targetId: testChat,
      state: 'off'
    });
    check(resAntiOff.status === 200 && resAntiOff.body.state === 'off', '!antilink off configurado');

    // LINK
    const resLink = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'link',
      botType: 'whatsapp_master',
      targetId: testChat
    });
    check(resLink.status === 200 && typeof resLink.body.inviteLink === 'string', '!link retornou link de convite oficial');

    // REVOGAR LINK
    const resRevoke = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'revogar_link',
      botType: 'whatsapp_master',
      targetId: testChat
    });
    check(resRevoke.status === 200 && typeof resRevoke.body.inviteLink === 'string', '!revogar_link gerou novo convite oficial');

    // ----------------------------------------------------
    // TESTE 7: Boas-Vindas Automáticas (!boasvindas, !boasvindas_msg, !admin)
    // ----------------------------------------------------
    console.log('\n--- 7. Boas-Vindas Automáticas (!boasvindas & !boasvindas_msg) ---');
    
    // BOAS-VINDAS ON
    const resWelOn = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'boasvindas',
      botType: 'whatsapp_master',
      targetId: testChat,
      state: 'on'
    });
    check(resWelOn.status === 200 && resWelOn.body.state === 'on', '!boasvindas on ativada');
    check(models.getSetting(`WELCOME_${testChat}`) === 'true', 'WELCOME salvo como true');

    // BOAS-VINDAS MSG COM VARIÁVEIS
    const customMsg = '👋 Olá {nome}, seja bem-vindo ao {grupo}! Seu número é {numero}.';
    const resWelMsg = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'boasvindas_msg',
      botType: 'whatsapp_master',
      targetId: testChat,
      text: customMsg
    });
    check(resWelMsg.status === 200 && resWelMsg.body.success === true, '!boasvindas_msg atualizada');
    check(models.getSetting(`WELCOME_MSG_${testChat}`) === customMsg, 'Texto com variáveis salvo no banco');

    // ADMIN
    const resAdmin = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'admin',
      botType: 'whatsapp_master',
      targetId: testChat
    });
    check(resAdmin.status === 200 && resAdmin.body.settings, '!admin retornou sumário das configurações');

    // ----------------------------------------------------
    // TESTE 8: Execução através de Sub-Bot do Exército e Telegram
    // ----------------------------------------------------
    console.log('\n--- 8. Execução via Sub-Bot e Telegram ---');
    
    // Sub-Bot
    const resSub = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'statusbot',
      botType: 'whatsapp_subbot',
      botInstanceId: 1,
      targetId: testChat
    });
    check(resSub.status === 200 && resSub.body.success === true, 'Execução via Sub-Bot Chip #1 funcionou');

    // Telegram
    const resTg = await makeRequest(server, {
      hostname: 'localhost',
      port,
      path: '/api/bots/execute-command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      command: 'desativar',
      botType: 'telegram',
      platform: 'telegram',
      targetId: '-100987654321',
      text: 'Pausa no Telegram'
    });
    check(resTg.status === 200 && resTg.body.success === true, 'Execução via Telegram funcionou');

    // ----------------------------------------------------
    // TESTE 9: Validação de Auditoria Registrada
    // ----------------------------------------------------
    console.log('\n--- 9. Validação do Registro de Auditoria no Painel ---');
    const auditLogs = models.getGroupAdminAuditLogs ? models.getGroupAdminAuditLogs({ groupId: testChat, limit: 10 }) : [];
    check(auditLogs.length > 0, `Auditoria registrou ${auditLogs.length} ações no grupo de teste`);

    console.log('\n======================================================');
    console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} PASSARAM!`);
    console.log('======================================================\n');

  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('Erro nos testes:', err);
  process.exit(1);
});

/**
 * TEST SUITE: AUDITORIA DE COMANDOS & DELEGAÇÃO DE SUPORTE
 * Testa:
 * 1. Banco de Dados & Models (Tabelas bot_command_audit_logs e support_devs)
 * 2. Service Layer (CommandAuditService, detecção de papéis, resolução de bots, despacho de alertas ao Dono 554884702848 e Devs)
 * 3. Integração com WhatsAppBot (!suporte add/remove/list, isolamento de permissão do Dono vs Cliente)
 * 4. Endpoints REST da API (/api/commands/logs, /stats, /support-devs, /test-alert, /export.csv)
 */

process.env.NODE_ENV = 'test';
const http = require('http');
const models = require('./src/db/models');
const commandAuditService = require('./src/services/commandAuditService');
const whatsappBot = require('./src/bots/whatsappBot');
const { createServer } = require('./src/server/app');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 INICIANDO TESTES: AUDITORIA DE COMANDOS & SUPORTE');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // BLOCO 1: BANCO DE DADOS & GESTÃO DE DEVS DE SUPORTE
  // ----------------------------------------------------------------
  console.log('--- 1. Models: Gestão de Desenvolvedores de Suporte Delegados ---');
  
  // Limpeza de testes anteriores se houver
  try {
    models.removeSupportDev('5511999990001');
    models.removeSupportDev('5511999990002');
  } catch (_) {}

  // Adiciona dev 1
  const dev1 = models.addSupportDev({
    phone: '5511999990001',
    name: 'Carlos Backend',
    role: 'DEV_SUPORTE',
    assignedBy: '554884702848',
    notes: 'Dev responsável por APIs'
  });
  assert(dev1 && dev1.phone === '5511999990001', 'Adiciona desenvolvedor de suporte com sucesso');

  // Verifica se isSupportDev reconhece o telefone
  assert(models.isSupportDev('5511999990001') === true, 'isSupportDev reconhece dev recém-cadastrado');
  assert(models.isSupportDev('11999990001') === true, 'isSupportDev reconhece sem o DDI 55');
  assert(models.isSupportDev('5599999999999') === false, 'isSupportDev retorna falso para número não autorizado');

  // Adiciona dev 2
  const dev2 = models.addSupportDev({
    phone: '5511999990002',
    name: 'Mariana DevOps',
    assignedBy: '554884702848'
  });
  assert(dev2 && dev2.id, 'Adiciona segundo desenvolvedor de suporte');

  // Lista devs
  let allDevs = models.getSupportDevs();
  assert(allDevs.some(d => d.phone === '5511999990001'), 'getSupportDevs lista dev 1');
  assert(allDevs.some(d => d.phone === '5511999990002'), 'getSupportDevs lista dev 2');

  // Toggle dev: desativa e reativa
  models.toggleSupportDev(dev2.id, { active: false, receive_alerts: false });
  const dev2Updated = models.getSupportDevByPhone('5511999990002');
  assert(dev2Updated.active === 0 && dev2Updated.receive_alerts === 0, 'toggleSupportDev desativa dev e alertas');
  assert(models.isSupportDev('5511999990002') === false, 'isSupportDev ignora devs inativos');

  // Reativa dev 2
  models.toggleSupportDev(dev2.id, { active: true, receive_alerts: true });
  assert(models.isSupportDev('5511999990002') === true, 'isSupportDev volta a reconhecer dev reativado');

  // ----------------------------------------------------------------
  // BLOCO 2: SERVICE LAYER (DETECÇÃO DE PAPÉIS & RESOLUÇÃO DE BOT)
  // ----------------------------------------------------------------
  console.log('\n--- 2. Service Layer: Detecção de Papéis e Resolução de Bots ---');

  // Detecção de papéis
  assert(commandAuditService.determineSenderRole('554884702848') === 'DONO', 'Telefone do Dono 554884702848 é identificado como DONO');
  assert(commandAuditService.determineSenderRole(null, true) === 'DONO', 'isOwner=true é identificado como DONO');
  assert(commandAuditService.determineSenderRole('5511999990001') === 'DEV_SUPORTE', 'Dev cadastrado é identificado como DEV_SUPORTE');
  assert(commandAuditService.determineSenderRole('5511888887777', false, true) === 'ADMIN_GRUPO', 'Admin de grupo é identificado como ADMIN_GRUPO');
  assert(commandAuditService.determineSenderRole('5511888887777', false, false) === 'CLIENTE', 'Usuário comum é identificado como CLIENTE');

  // Resolução de Bots
  const mainBotInfo = commandAuditService.resolveBotInfo('WHATSAPP_MAIN', 1);
  assert(mainBotInfo.botType === 'WHATSAPP_MAIN' && mainBotInfo.botInstanceId === 1, 'Resolução de Bot Matriz Principal');

  const subBotInfo = commandAuditService.resolveBotInfo('WHATSAPP_SUBBOT', 5);
  assert(subBotInfo.botType === 'WHATSAPP_SUBBOT' && subBotInfo.botInstanceId === 5, 'Resolução de Sub-Bot #5');

  const telegramInfo = commandAuditService.resolveBotInfo('TELEGRAM_MAIN', 1);
  assert(telegramInfo.botType === 'TELEGRAM_MAIN', 'Resolução de Bot Telegram');

  // ----------------------------------------------------------------
  // BLOCO 3: REGISTRO DE COMANDOS & DISPARO DE ALERTAS DE FALHA
  // ----------------------------------------------------------------
  console.log('\n--- 3. Registro de Auditoria & Alertas Automáticos de Falha ---');

  // Registra comando com SUCESSO (não deve disparar alerta de erro)
  const successLog = await commandAuditService.recordCommand({
    command: '!status',
    senderPhone: '554884702848',
    senderName: 'Dono Oficial',
    isOwner: true,
    botType: 'WHATSAPP_MAIN',
    botInstanceId: 1,
    status: 'SUCCESS',
    executionTimeMs: 145,
    responseText: 'Status do bot operacional'
  });
  assert(successLog && successLog.status === 'SUCCESS' && successLog.sender_role === 'DONO', 'Registra comando SUCCESS com papel DONO');

  // Registra comando executado por Sub-Bot
  const subBotLog = await commandAuditService.recordCommand({
    command: '!pix 50',
    senderPhone: '5511977776666',
    senderName: 'Cliente Loja',
    botType: 'WHATSAPP_SUBBOT',
    botInstanceId: 3,
    botName: 'Sub-Bot Vendedor #3',
    status: 'SUCCESS',
    executionTimeMs: 230,
    responseText: 'Chave Pix gerada'
  });
  assert(subBotLog && subBotLog.bot_type === 'WHATSAPP_SUBBOT' && subBotLog.bot_instance_id === 3, 'Registra comando executado em Sub-Bot');

  // Registra comando com FALHA / ERRO
  // O Dono (554884702848) e o dev ativo (5511999990001) devem estar entre os destinatários do alerta!
  const errorLog = await commandAuditService.recordCommand({
    command: '!entregar_pedido 9982',
    senderPhone: '5511977776666',
    senderName: 'Cliente Comprador',
    botType: 'WHATSAPP_SUBBOT',
    botInstanceId: 2,
    botName: 'Chip Campanha 02',
    status: 'ERROR',
    executionTimeMs: 1200,
    errorMessage: 'Falha de conexão com a API de Estoque: Timeout de 10s'
  });
  assert(errorLog && errorLog.status === 'ERROR', 'Registra comando ERROR');

  // Verifica no banco de dados se os alertas foram marcados como enviados para o Dono e Devs
  const freshErrorLog = models.getCommandAuditLogs({ limit: 1 }).logs[0];
  assert(freshErrorLog.alert_sent === 1, 'Alerta de falha foi disparado automaticamente (alert_sent = 1)');
  assert(freshErrorLog.alert_recipients && freshErrorLog.alert_recipients.includes('554884702848'), 'Alerta de falha inclui Dono Supremo 554884702848');
  assert(freshErrorLog.alert_recipients && freshErrorLog.alert_recipients.includes('5511999990001'), 'Alerta de falha inclui Dev de Suporte Delegado 5511999990001');

  // Teste de Alerta Diagnóstico
  const testAlertRes = await commandAuditService.sendTestAlert();
  assert(testAlertRes.success === true && testAlertRes.recipients.includes('554884702848'), 'Disparo de alerta de teste notifica o Dono');

  // ----------------------------------------------------------------
  // BLOCO 4: CONSULTAS, FILTROS & MÉTRICAS (MODELS)
  // ----------------------------------------------------------------
  console.log('\n--- 4. Consultas, Filtros e Estatísticas de Auditoria ---');

  const allLogs = models.getCommandAuditLogs({ limit: 10 });
  assert(allLogs.total >= 3, `Busca total de logs (encontrados: ${allLogs.total})`);

  const errorLogsOnly = models.getCommandAuditLogs({ status: 'ERROR' });
  assert(errorLogsOnly.logs.every(l => l.status === 'ERROR'), 'Filtro por status ERROR funciona');

  const subBotLogsOnly = models.getCommandAuditLogs({ botType: 'WHATSAPP_SUBBOT' });
  assert(subBotLogsOnly.logs.every(l => l.bot_type === 'WHATSAPP_SUBBOT'), 'Filtro por bot_type WHATSAPP_SUBBOT funciona');

  const stats = models.getCommandAuditStats();
  assert(stats.totalCommands >= 3, 'Estatísticas: totalCommands apurado');
  assert(stats.errorCommands >= 1, 'Estatísticas: errorCommands apurado');
  assert(typeof stats.avgExecutionTimeMs === 'number', 'Estatísticas: tempo médio de execução calculado');
  assert(Array.isArray(stats.topCommands), 'Estatísticas: lista de top comandos retornada');

  // ----------------------------------------------------------------
  // BLOCO 5: ENDPOINTS REST DA API WEB
  // ----------------------------------------------------------------
  console.log('\n--- 5. Endpoints REST da API (/api/commands/*) ---');

  const app = createServer();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/commands/logs
    const resLogs = await fetch(`${baseUrl}/api/commands/logs?limit=5`);
    const jsonLogs = await resLogs.json();
    assert(resLogs.status === 200 && jsonLogs.success === true && Array.isArray(jsonLogs.logs), 'GET /api/commands/logs retorna 200 com logs');

    // 2. GET /api/commands/stats
    const resStats = await fetch(`${baseUrl}/api/commands/stats`);
    const jsonStats = await resStats.json();
    assert(resStats.status === 200 && jsonStats.success === true && jsonStats.stats.totalCommands > 0, 'GET /api/commands/stats retorna 200 com métricas');

    // 3. GET /api/commands/support-devs
    const resDevs = await fetch(`${baseUrl}/api/commands/support-devs`);
    const jsonDevs = await resDevs.json();
    assert(resDevs.status === 200 && jsonDevs.success === true && Array.isArray(jsonDevs.devs), 'GET /api/commands/support-devs lista desenvolvedores');

    // 4. POST /api/commands/support-devs (Criação via API)
    const resCreateDev = await fetch(`${baseUrl}/api/commands/support-devs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5511999990003',
        name: 'Dev Criado via Web',
        role: 'DEV_SUPORTE',
        notes: 'Adicionado pelo painel web'
      })
    });
    const jsonCreateDev = await resCreateDev.json();
    assert(resCreateDev.status === 201 && jsonCreateDev.success === true && jsonCreateDev.dev.phone === '5511999990003', 'POST /api/commands/support-devs cria dev com status 201');

    // 5. PUT /api/commands/support-devs/:id (Atualização via API)
    const devCreatedId = jsonCreateDev.dev.id;
    const resUpdateDev = await fetch(`${baseUrl}/api/commands/support-devs/${devCreatedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: 0, receive_alerts: 0 })
    });
    const jsonUpdateDev = await resUpdateDev.json();
    assert(resUpdateDev.status === 200 && jsonUpdateDev.success === true, 'PUT /api/commands/support-devs/:id atualiza status do dev');

    // 6. POST /api/commands/test-alert (Disparo de alerta diagnóstico)
    const resAlert = await fetch(`${baseUrl}/api/commands/test-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const jsonAlert = await resAlert.json();
    assert(resAlert.status === 200 && jsonAlert.success === true, 'POST /api/commands/test-alert dispara alerta com sucesso');

    // 7. GET /api/commands/export.csv
    const resCsv = await fetch(`${baseUrl}/api/commands/export.csv`);
    const csvText = await resCsv.text();
    assert(resCsv.status === 200 && csvText.includes('ID') && csvText.includes('Bot_Nome') && csvText.includes('Comando') && csvText.includes('Alerta_Dono_Enviado'), 'GET /api/commands/export.csv exporta CSV com cabeçalhos corretos');

    // 8. DELETE /api/commands/support-devs/:id
    const resDeleteDev = await fetch(`${baseUrl}/api/commands/support-devs/${devCreatedId}`, {
      method: 'DELETE'
    });
    const jsonDeleteDev = await resDeleteDev.json();
    assert(resDeleteDev.status === 200 && jsonDeleteDev.success === true, 'DELETE /api/commands/support-devs/:id remove dev');

    // ----------------------------------------------------------------
    // BLOCO 7: BOTÕES DE AÇÃO NA LINHA (INTERROMPER, REPETIR, ENVIAR P/ OUTRO, BLOQUEAR X MIN)
    // ----------------------------------------------------------------
    console.log('\n--- 7. Ações Rápidas em Linha: Interromper, Repetir, Encaminhar e Bloqueio ---');

    // Cria comando de teste para manipulação
    const actionCmdLog = await commandAuditService.recordCommand({
      command: '!catalogo_vip',
      rawMessage: '!catalogo_vip',
      senderPhone: '5511977770001',
      senderName: 'Cliente Teste Ações',
      botType: 'WHATSAPP_MAIN',
      botInstanceId: 1,
      status: 'SUCCESS',
      responseText: 'Aqui está nosso catálogo completo de lançamentos VIP: https://loja.exemplo.com'
    });

    // 1. Interromper função/comando
    const resInterrupt = await fetch(`${baseUrl}/api/commands/logs/${actionCmdLog.id}/interrupt`, {
      method: 'POST'
    });
    const jsonInterrupt = await resInterrupt.json();
    assert(resInterrupt.status === 200 && jsonInterrupt.success === true && jsonInterrupt.status === 'INTERRUPTED', 'POST /api/commands/logs/:id/interrupt interrompe comando');

    const interruptedLog = models.getCommandAuditById(actionCmdLog.id);
    assert(interruptedLog.status === 'INTERRUPTED', 'Log no banco de dados atualizado para INTERRUPTED');

    // 2. Repetir comando com os mesmos parâmetros
    const resRetry = await fetch(`${baseUrl}/api/commands/logs/${actionCmdLog.id}/retry`, {
      method: 'POST'
    });
    const jsonRetry = await resRetry.json();
    assert(resRetry.status === 200 && jsonRetry.success === true && jsonRetry.newLog, 'POST /api/commands/logs/:id/retry reexecuta comando com sucesso');
    assert(jsonRetry.newLog.command.includes('[REPLAY]'), 'Novo log gerado marcado com flag [REPLAY]');

    // 3. Enviar para outro destinatário a mesma resposta
    const resForward = await fetch(`${baseUrl}/api/commands/logs/${actionCmdLog.id}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPhone: '5511988887777' })
    });
    const jsonForward = await resForward.json();
    assert(resForward.status === 200 && jsonForward.success === true && jsonForward.targetPhone === '5511988887777', 'POST /api/commands/logs/:id/forward envia mesma resposta para novo destinatário');

    // 4. Bloquear usuário por X minutos
    const resBlock = await fetch(`${baseUrl}/api/commands/users/block-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5511977770001',
        name: 'Cliente Teste Ações',
        minutes: 45,
        reason: 'Spam de comandos não autorizados'
      })
    });
    const jsonBlock = await resBlock.json();
    assert(resBlock.status === 200 && jsonBlock.success === true && jsonBlock.block.duration_minutes === 45, 'POST /api/commands/users/block-temp bloqueia usuário por 45 minutos');

    // Verifica se isUserTemporarilyBlocked reconhece o bloqueio
    const isBlocked = models.isUserTemporarilyBlocked('5511977770001');
    assert(isBlocked && isBlocked.blocked === true && isBlocked.minutesRemaining > 0, 'models.isUserTemporarilyBlocked confirma bloqueio e calcula minutos restantes');

    // Tentativa de bloquear o Dono Supremo (deve ser rejeitada com erro)
    let ownerBlockedError = false;
    try {
      models.blockUserTemporarily({ phone: '554884702848', minutes: 30 });
    } catch (e) {
      ownerBlockedError = true;
    }
    assert(ownerBlockedError === true, 'Imunidade do Dono: tentativa de bloquear o Dono Supremo (554884702848) é barrada');

    // 5. Listar usuários bloqueados
    const resListBlocked = await fetch(`${baseUrl}/api/commands/users/blocked`);
    const jsonListBlocked = await resListBlocked.json();
    assert(resListBlocked.status === 200 && jsonListBlocked.success === true && jsonListBlocked.blockedUsers.some(u => u.phone === '5511977770001'), 'GET /api/commands/users/blocked lista usuários com bloqueio ativo');

    // 6. Desbloquear usuário
    const resUnblock = await fetch(`${baseUrl}/api/commands/users/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5511977770001' })
    });
    const jsonUnblock = await resUnblock.json();
    assert(resUnblock.status === 200 && jsonUnblock.success === true, 'POST /api/commands/users/unblock desbloqueia usuário com sucesso');
    assert(models.isUserTemporarilyBlocked('5511977770001') === null, 'Usuário volta a ter acesso livre após desbloqueio');

  } finally {
    server.close();
  }

  // ----------------------------------------------------------------
  // BLOCO 6: ISOLAMENTO DE COMANDO WHATSAPP (!suporte add vs !suporte cliente)
  // ----------------------------------------------------------------
  console.log('\n--- 6. Verificação de Permissões de Comandos WhatsApp ---');

  // Testa método isSupportDev no whatsappBot
  assert(whatsappBot.isSupportDev('5511999990001') === true, 'whatsappBot.isSupportDev reconhece dev');
  assert(whatsappBot.isSupportDev('5548999999999') === false, 'whatsappBot.isSupportDev rejeita não-dev');

  // Limpeza de devs de teste
  try {
    models.removeSupportDev('5511999990001');
    models.removeSupportDev('5511999990002');
    models.removeSupportDev('5511999990003');
  } catch (_) {}

  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} PASSARAM!`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!\n');
    process.exit(0);
  } else {
    console.error(`❌ ${totalTests - passedTests} TESTES FALHARAM!\n`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Erro fatal nos testes:', err);
  process.exit(1);
});

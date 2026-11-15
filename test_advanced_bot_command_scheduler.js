const assert = require('assert');
const http = require('http');

process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const { createServer } = require('./src/server/app');
const matrizAssistantService = require('./src/services/matrizAssistantService');

async function runTests() {
  console.log('🧪 Iniciando Testes Avançados do Seletor de Participantes, Agendamento e Recorrência...');

  // Setup de servidor teste para endpoints
  const app = createServer();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`[Test Server] Rodando na porta ${port}`);

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Teste de listagem de participantes do grupo
    console.log('1. Testando GET /api/groups/:groupId/participants...');
    const testGroupId = '120363028199999999@g.us';
    
    // Cadastra um lead fictício associado para verificar fallback do banco
    try {
      models.createLead({
        phone: '5511999887766',
        name: 'Carlos Membro Teste',
        origem: testGroupId
      });
    } catch (_) {}

    const resPart = await makeRequest('GET', `/api/groups/${testGroupId}/participants`);
    assert.strictEqual(resPart.status, 200, 'Status deve ser 200');
    assert.strictEqual(resPart.body.success, true, 'Deve retornar success: true');
    assert.strictEqual(resPart.body.groupId, testGroupId, 'GroupId deve coincidir');
    assert.ok(Array.isArray(resPart.body.participants), 'Participants deve ser um array');
    assert.ok(resPart.body.participants.length > 0, 'Deve ter participantes listados');
    
    const samplePart = resPart.body.participants[0];
    assert.ok(samplePart.phone, 'Participante deve ter telefone');
    assert.strictEqual(typeof samplePart.isAdmin, 'boolean', 'isAdmin deve ser boolean');
    console.log(`  ✅ GET /api/groups/:groupId/participants retornou ${resPart.body.participants.length} participante(s) com sucesso.`);

    // 2. Teste de Agendamento em Minutos
    console.log('2. Testando POST /api/bots/execute-command com scheduleType: "minutes"...');
    const resSchedMin = await makeRequest('POST', '/api/bots/execute-command', {
      command: 'ban',
      targetId: testGroupId,
      participants: ['5511999990001', '5511999990002'],
      delaySeconds: 5,
      scheduleType: 'minutes',
      scheduleMinutes: 30,
      recurrence: 'none'
    });

    assert.strictEqual(resSchedMin.status, 200, 'Status deve ser 200');
    assert.strictEqual(resSchedMin.body.success, true, 'Sucesso deve ser true');
    assert.strictEqual(resSchedMin.body.scheduled, true, 'Scheduled deve ser true');
    assert.ok(resSchedMin.body.taskId, 'Deve retornar taskId');
    assert.ok(resSchedMin.body.scheduled_at, 'Deve retornar scheduled_at');
    assert.strictEqual(resSchedMin.body.participantsCount, 2, 'Deve ter 2 participantes');

    // Valida que a tarefa foi inserida no banco
    const taskInDb = models.getDelegatedTaskById(resSchedMin.body.taskId);
    assert.ok(taskInDb, 'Tarefa deve existir no banco de dados');
    assert.strictEqual(taskInDb.task_type, 'GROUP_COMMAND', 'task_type deve ser GROUP_COMMAND');
    assert.strictEqual(taskInDb.status, 'PENDING', 'status inicial deve ser PENDING');
    const payload = JSON.parse(taskInDb.message_payload);
    assert.strictEqual(payload.command, 'ban');
    assert.strictEqual(payload.delaySeconds, 5);
    assert.deepStrictEqual(payload.participants, ['5511999990001', '5511999990002']);
    console.log(`  ✅ Tarefa agendada [${taskInDb.task_code}] salva com sucesso no banco para ${resSchedMin.body.scheduled_at}`);

    // 3. Teste de Agendamento em Data & Hora Específica + Recorrência
    console.log('3. Testando POST /api/bots/execute-command com scheduleType: "datetime" e recurrence: "daily"...');
    const futureDate = new Date(Date.now() + 2 * 3600 * 1000); // 2 horas no futuro
    const resSchedDt = await makeRequest('POST', '/api/bots/execute-command', {
      command: 'promover',
      targetId: testGroupId,
      participants: ['5511988887777'],
      scheduleType: 'datetime',
      scheduleDateTime: futureDate.toISOString(),
      recurrence: 'daily'
    });

    assert.strictEqual(resSchedDt.status, 200);
    assert.strictEqual(resSchedDt.body.scheduled, true);
    assert.strictEqual(resSchedDt.body.recurrence, 'daily');
    const taskDt = models.getDelegatedTaskById(resSchedDt.body.taskId);
    assert.ok(taskDt);
    const dtPayload = JSON.parse(taskDt.message_payload);
    assert.strictEqual(dtPayload.recurrence, 'daily');
    assert.strictEqual(dtPayload.command, 'promover');
    console.log(`  ✅ Tarefa agendada com data fixa e recorrência diária cadastrada com sucesso!`);

    // 4. Teste de Execução Imediata com Múltiplos Participantes & Delay Anti-Ban
    console.log('4. Testando POST /api/bots/execute-command com múltiplos participantes imediatos...');
    const resImmediate = await makeRequest('POST', '/api/bots/execute-command', {
      command: 'ban',
      targetId: testGroupId,
      participants: ['5511911112222', '5511933334444'],
      delaySeconds: 1,
      scheduleType: 'now',
      recurrence: 'none'
    });

    assert.strictEqual(resImmediate.status, 200);
    assert.strictEqual(resImmediate.body.success, true);
    assert.ok(resImmediate.body.message.includes('2 participantes') || resImmediate.body.message.includes('removido'), 'Mensagem deve indicar execução em lote');
    console.log(`  ✅ Execução imediata com 2 participantes concluída com sucesso: "${resImmediate.body.message}"`);

    // 5. Teste de Worker de Execução Agendada e Auto-Reagendamento Recorrente
    console.log('5. Testando Worker de execução agendada e recorrência...');
    // Criamos uma tarefa com scheduled_at no passado para o worker pegar
    const pastDate = new Date(Date.now() - 10000).toISOString();
    const recurringTask = models.createDelegatedTask({
      assigned_instance_id: 1,
      task_type: 'GROUP_COMMAND',
      title: 'Comando Recorrente Teste !fechar',
      description: 'Teste de repetição de comando',
      target: testGroupId,
      message_payload: JSON.stringify({
        command: 'fechar',
        targetId: testGroupId,
        recurrence: 'hourly'
      }),
      delegated_by: 'TEST_SUITE',
      scheduled_at: pastDate
    });

    // Mock do socket
    const mockSock = {
      groupSettingUpdate: async (gid, setting) => true,
      sendMessage: async () => true
    };

    // Executa worker para a tarefa
    await matrizAssistantService.executeScheduledTask(recurringTask, mockSock);

    const executedTask = models.getDelegatedTaskById(recurringTask.id);
    assert.strictEqual(executedTask.status, 'COMPLETED', 'Status da tarefa executada deve ser COMPLETED');

    // Verifica se a próxima tarefa da recorrência 'hourly' foi criada
    const pendingTasks = models.getDelegatedTasks({ task_type: 'GROUP_COMMAND', status: 'PENDING' });
    const nextRecurrence = pendingTasks.find(t => t.delegated_by === 'RECURRING_SCHEDULER' && t.target === testGroupId);
    assert.ok(nextRecurrence, 'Próxima tarefa recorrente deve ter sido criada automaticamente no banco');
    const nextPayload = JSON.parse(nextRecurrence.message_payload);
    assert.strictEqual(nextPayload.command, 'fechar');
    assert.strictEqual(nextPayload.recurrence, 'hourly');
    console.log(`  ✅ Worker executou a tarefa com sucesso e agendou a próxima recorrência para ${nextRecurrence.scheduled_at}!`);

    // 6. Teste de Cálculo de Datas de Recorrência
    console.log('6. Testando cálculo de recorrência (calculateNextRecurrenceDate)...');
    const now = new Date('2026-11-07T12:00:00Z');
    const hourly = matrizAssistantService.calculateNextRecurrenceDate('hourly', now);
    assert.strictEqual(hourly.toISOString(), '2026-11-07T13:00:00.000Z');

    const daily = matrizAssistantService.calculateNextRecurrenceDate('daily', now);
    assert.strictEqual(daily.toISOString(), '2026-11-08T12:00:00.000Z');

    const weekly = matrizAssistantService.calculateNextRecurrenceDate('weekly', now);
    assert.strictEqual(weekly.toISOString(), '2026-11-14T12:00:00.000Z');
    console.log('  ✅ Todas as regras de cálculo de recorrência validadas com exatidão!');

    console.log('\n🎉 TODOS OS TESTES AVANÇADOS FORAM CONCLUÍDOS COM 100% DE SUCESSO! 🎉');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

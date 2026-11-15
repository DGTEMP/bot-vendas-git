/**
 * Teste End-to-End do Gerente da Operação & Árbitro Supremo
 * Validação rigorosa dos 8 subsistemas, integração com Núcleo IA,
 * autocura, persistência no banco e endpoints HTTP.
 */

const assert = require('assert');
const http = require('http');

console.log('====================================================');
console.log('🧪 INICIANDO TESTE DO GERENTE DA OPERAÇÃO & ÁRBITRO');
console.log('====================================================\n');

async function runTests() {
  let passedCount = 0;
  let failedCount = 0;

  function record(title, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${title}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${title}`);
      console.error(`     Erro: ${err.message}`);
      failedCount++;
    }
  }

  async function recordAsync(title, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${title}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${title}`);
      console.error(`     Erro: ${err.message}`);
      failedCount++;
    }
  }

  // 1. CARREGAMENTO DOS MÓDULOS
  console.log('📌 1. Testando importação dos serviços e modelos...');
  const arbiter = require('./src/services/operationsArbiterService');
  const arbiterAlias = require('./src/services/operationsManagerService');
  const models = require('./src/db/models');

  record('Serviço operationsArbiterService e alias operationsManagerService coincidem', () => {
    assert.strictEqual(arbiter, arbiterAlias, 'O alias deve apontar exatamente para o mesmo singleton');
    assert.strictEqual(typeof arbiter.auditAll, 'function', 'auditAll deve ser função');
    assert.strictEqual(typeof arbiter.autoHealAll, 'function', 'autoHealAll deve ser função');
    assert.strictEqual(typeof arbiter.healSubsystem, 'function', 'healSubsystem deve ser função');
  });

  // 2. AUDITORIA COMPLETA DOS 8 SUBSISTEMAS
  console.log('\n📌 2. Executando auditoria completa com Núcleo de Inteligência...');
  let latestAudit = null;
  await recordAsync('auditAll() executa auditoria dos 8 subsistemas com cálculo de score', async () => {
    latestAudit = await arbiter.auditAll({ forceAi: true });
    assert.ok(latestAudit, 'Auditoria deve retornar um objeto');
    assert.ok(typeof latestAudit.healthScore === 'number', 'healthScore deve ser numérico');
    assert.ok(typeof latestAudit.globalScore === 'number', 'globalScore deve ser numérico');
    assert.ok(latestAudit.globalScore >= 0 && latestAudit.globalScore <= 100, 'Score deve estar entre 0 e 100');
    assert.ok(['PLENO_FUNCIONAMENTO', 'ATENCAO_OPERACIONAL', 'DEGRADADO', 'CRITICO'].includes(latestAudit.verdict), 'Veredito deve ser válido');

    const expectedKeys = [
      'whatsapp_master',
      'whatsapp_subbots',
      'telegram',
      'gateways_financial',
      'web_servers_tunnels',
      'database_storage',
      'ai_intelligence_core',
      'queues_and_workflows'
    ];

    assert.ok(latestAudit.subsystems, 'Subsystems deve existir');
    for (const key of expectedKeys) {
      assert.ok(latestAudit.subsystems[key], `Subsistema ${key} deve estar presente`);
      assert.ok(typeof latestAudit.subsystems[key].score === 'number', `Score de ${key} deve ser numérico`);
      assert.ok(latestAudit.subsystems[key].name, `Nome de ${key} deve estar definido`);
      assert.ok(latestAudit.subsystems[key].status, `Status de ${key} deve estar definido`);
    }

    console.log(`     -> Score Global: ${latestAudit.globalScore}% | Veredito: ${latestAudit.verdictLabel}`);
    console.log(`     -> Motor IA: ${latestAudit.aiProvider} (${latestAudit.aiModel})`);
    console.log(`     -> Parecer IA: ${latestAudit.aiDiagnosis.slice(0, 100)}...`);
  });

  // 3. PERSISTÊNCIA EM BANCO DE DADOS
  console.log('\n📌 3. Testando persistência no SQLite (auditorias e eventos)...');
  record('Auditoria foi persistida na tabela operations_arbiter_audits', () => {
    const fromDb = models.getLatestOperationsAudit();
    assert.ok(fromDb, 'Deve existir auditoria persistida no banco');
    assert.strictEqual(fromDb.global_score, latestAudit.globalScore, 'Score gravado deve bater com o auditado');
    assert.strictEqual(fromDb.verdict, latestAudit.verdict, 'Veredito gravado deve bater');
  });

  record('Histórico de auditorias pode ser consultado', () => {
    const history = models.getOperationsAuditHistory(5);
    assert.ok(Array.isArray(history), 'Histórico deve ser um array');
    assert.ok(history.length >= 1, 'Deve conter pelo menos 1 registro');
  });

  record('Registro e consulta de eventos do árbitro funcionam', () => {
    const evId = models.recordOperationsEvent({
      eventType: 'TEST_EVENT',
      severity: 'INFO',
      subsystem: 'database_storage',
      title: 'Teste de Evento do Árbitro',
      description: 'Evento de validação de fluxo unitário',
      metadata: { test: true }
    });
    assert.ok(evId, 'Deve retornar ID do evento inserido');

    const recent = models.getRecentOperationsEvents(10);
    assert.ok(Array.isArray(recent), 'Eventos recentes deve ser array');
    const found = recent.find(e => e.id === evId);
    assert.ok(found, 'Evento recém-inserido deve ser retornado na consulta');
    assert.strictEqual(found.event_type, 'TEST_EVENT');

    models.resolveOperationsEvent(evId, 'Resolvido no teste E2E');
  });

  // 4. PROTOCOLO DE AUTOCURA
  console.log('\n📌 4. Testando rotinas de autocura...');
  await recordAsync('autoHealAll() executa autocura preventiva sem falhas', async () => {
    const actions = await arbiter.autoHealAll();
    assert.ok(Array.isArray(actions), 'Autocura deve retornar lista de ações');
    console.log(`     -> ${actions.length} ação(ões) de autocura executadas com sucesso.`);
  });

  await recordAsync('healSubsystem() repara subsistema específico (database_storage)', async () => {
    const res = await arbiter.healSubsystem('database_storage');
    assert.ok(res, 'Deve retornar objeto de resultado');
    assert.strictEqual(res.success, true, 'Autocura de database_storage deve ter sucesso');
  });

  await recordAsync('healSubsystem() repara subsistema específico (gateways_financial)', async () => {
    const res = await arbiter.healSubsystem('gateways_financial');
    assert.ok(res, 'Deve retornar objeto de resultado');
    assert.strictEqual(res.success, true, 'Autocura de gateways_financial deve ter sucesso');
  });

  // 5. FORMATADORES DE RELATÓRIO EXECUTIVO (WHATSAPP & TELEGRAM)
  console.log('\n📌 5. Testando formatação de relatórios para WhatsApp e Telegram...');
  record('formatWhatsAppReport produz texto legível e com seções', () => {
    const report = arbiter.formatWhatsAppReport(latestAudit);
    assert.ok(typeof report === 'string', 'Relatório WhatsApp deve ser string');
    assert.ok(report.includes('GERENTE GERAL DA OPERAÇÃO'), 'Deve conter cabeçalho');
    assert.ok(report.includes('NÚCLEO DE INTELIGÊNCIA'), 'Deve conter seção da IA');
    assert.ok(report.includes('TELEMETRIA DOS 8 PILARES VITAIS'), 'Deve conter os 8 pilares');
    assert.ok(report.includes('WhatsApp Matriz'), 'Deve conter WhatsApp Matriz');
    assert.ok(report.includes('Gateways Financeiros'), 'Deve conter Gateways');
    assert.ok(report.includes('Banco de Dados SQLite'), 'Deve conter Banco de Dados');
  });

  record('formatTelegramReport produz texto formatado para Telegram', () => {
    const tgReport = arbiter.formatTelegramReport(latestAudit);
    assert.ok(typeof tgReport === 'string', 'Relatório Telegram deve ser string');
    assert.ok(tgReport.includes('*GERENTE GERAL DA OPERAÇÃO'), 'Deve conter cabeçalho');
    assert.ok(tgReport.includes('Diagnóstico do Núcleo de Inteligência'), 'Deve conter bloco de IA');
  });

  // 6. ROTAS REST DO EXPRESS (SERVER)
  console.log('\n📌 6. Subindo servidor Express em porta temporária e testando endpoints REST...');
  const { createServer } = require('./src/server/app');
  const app = createServer();
  let server = null;
  const testPort = 39871;

  await recordAsync('Endpoints HTTP respondem corretamente', async () => {
    await new Promise((resolve) => {
      server = app.listen(testPort, () => {
        resolve();
      });
    });

    function getJson(path) {
      return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}${path}`, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Falha no parse do JSON: ${body}`));
            }
          });
        }).on('error', reject);
      });
    }

    function postJson(path) {
      return new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${testPort}${path}`, { method: 'POST' }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Falha no parse do JSON: ${body}`));
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    // GET /api/operations-manager/status
    const statusRes = await getJson('/api/operations-manager/status');
    assert.strictEqual(statusRes.success, true, 'status deve retornar success true');
    assert.ok(statusRes.audit, 'status deve conter objeto audit');

    // POST /api/operations-manager/arbitrate
    const arbitrateRes = await postJson('/api/operations-manager/arbitrate');
    assert.strictEqual(arbitrateRes.success, true, 'arbitrate deve retornar success true');
    assert.ok(arbitrateRes.audit.globalScore >= 0, 'arbitrate deve retornar audit atualizado');

    // POST /api/operations-manager/auto-heal
    const healRes = await postJson('/api/operations-manager/auto-heal');
    assert.strictEqual(healRes.success, true, 'auto-heal deve retornar success true');
    assert.ok(Array.isArray(healRes.actions), 'auto-heal deve retornar lista de ações');

    // POST /api/operations-manager/heal/database_storage
    const healDbRes = await postJson('/api/operations-manager/heal/database_storage');
    assert.strictEqual(healDbRes.success, true, 'heal específico deve retornar success true');

    // GET /api/operations-manager/history
    const historyRes = await getJson('/api/operations-manager/history?limit=5');
    assert.strictEqual(historyRes.success, true, 'history deve retornar success true');
    assert.ok(Array.isArray(historyRes.history), 'history deve ser array');
    assert.ok(historyRes.history.length >= 1, 'history deve ter registros');
  });

  if (server) {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO DOS TESTES: ${passedCount} PASSOU | ${failedCount} FALHOU`);
  console.log('====================================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Erro fatal no script de testes:', err);
  process.exit(1);
});

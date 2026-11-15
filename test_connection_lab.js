/**
 * =========================================================================
 * 🧪 TESTE DE VALIDAÇÃO: LAB OPERACIONAL DE CONEXÕES & COMANDOS
 * =========================================================================
 * Valida o fluxo completo requerido pelo usuário:
 * 1. Escolha da conexão ativa no momento para entrar no Lab
 * 2. Seleção de comando e input
 * 3. Envio e recepção do RESULTADO DIRETO da conexão
 * 4. Sem histórico de comandos executados poluindo a tela
 * 5. Endpoints REST da API (/api/lab/*)
 * =========================================================================
 */

const assert = require('assert');
const http = require('http');

console.log('====================================================');
console.log('🧪 INICIANDO TESTE DO LAB OPERACIONAL DE CONEXÕES');
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

  // 1. CARREGAMENTO DO SERVIÇO
  console.log('📌 1. Testando importação e métodos do connectionLabService...');
  const labService = require('./src/services/connectionLabService');

  record('connectionLabService exporta os métodos necessários', () => {
    assert.strictEqual(typeof labService.listActiveConnections, 'function', 'listActiveConnections deve ser função');
    assert.strictEqual(typeof labService.getCommandCatalog, 'function', 'getCommandCatalog deve ser função');
    assert.strictEqual(typeof labService.executeLabCommand, 'function', 'executeLabCommand deve ser função');
  });

  // 2. LISTAGEM DE CONEXÕES ATIVAS
  console.log('\n📌 2. Testando listActiveConnections()...');
  let connections = [];
  record('listActiveConnections() retorna conexões estruturadas (Matriz, Sub-bots, Telegram)', () => {
    connections = labService.listActiveConnections();
    assert.ok(Array.isArray(connections), 'Deve retornar array de conexões');
    assert.ok(connections.length >= 2, 'Deve conter pelo menos Matriz e Telegram');

    const master = connections.find(c => c.id === 'whatsapp_master');
    assert.ok(master, 'Deve conter conexão whatsapp_master');
    assert.strictEqual(master.platform, 'whatsapp');
    assert.strictEqual(master.type, 'master');
    assert.ok(master.phone, 'Matriz deve possuir telefone');

    const telegram = connections.find(c => c.id === 'telegram');
    assert.ok(telegram, 'Deve conter conexão telegram');
    assert.strictEqual(telegram.platform, 'telegram');

    console.log(`     -> ${connections.length} conexões mapeadas no Lab.`);
    console.log(`     -> Conexões no topo: ${connections.slice(0, 3).map(c => `${c.name} (${c.status})`).join(' | ')}`);
  });

  // 3. CATÁLOGO DE COMANDOS ORGANIZADOS
  console.log('\n📌 3. Testando getCommandCatalog()...');
  record('getCommandCatalog() retorna categorias e comandos utilizáveis', () => {
    const catalog = labService.getCommandCatalog();
    assert.ok(Array.isArray(catalog), 'Catálogo deve ser array de categorias');
    assert.ok(catalog.length >= 4, 'Deve conter categorias como Vendas, IA, Árbitro, Utilidades');

    const vendas = catalog.find(c => c.category.includes('Vendas'));
    assert.ok(vendas, 'Categoria Vendas deve existir');
    assert.ok(vendas.commands.some(cmd => cmd.cmd === 'pix'), 'Comando pix deve existir na categoria');

    const ia = catalog.find(c => c.category.includes('Inteligência'));
    assert.ok(ia, 'Categoria IA deve existir');
    assert.ok(ia.commands.some(cmd => cmd.cmd === 'ia'), 'Comando ia deve existir');

    console.log(`     -> ${catalog.length} categorias disponíveis para o seletor.`);
  });

  // 4. EXECUÇÃO DE COMANDOS NA CONEXÃO (RESULTADO DIRETO)
  console.log('\n📌 4. Testando executeLabCommand() na conexão WhatsApp Matriz...');

  await recordAsync('Execução do comando !ping retorna telemetria direta', async () => {
    const res = await labService.executeLabCommand({
      connectionId: 'whatsapp_master',
      command: 'ping',
      input: ''
    });

    assert.strictEqual(res.success, true, 'Execução deve ter sucesso');
    assert.strictEqual(res.command, '!ping');
    assert.strictEqual(res.connectionId, 'whatsapp_master');
    assert.ok(typeof res.executionTimeMs === 'number', 'Deve medir tempo de execução em ms');
    assert.ok(typeof res.resultText === 'string', 'Deve retornar resultado direto em texto');
    assert.ok(res.resultText.includes('PONG'), 'Resultado do ping deve conter PONG');
    assert.strictEqual(res.history, undefined, 'NÃO deve conter histórico de comandos executados');

    console.log(`     -> Latência medida: ${res.executionTimeMs}ms`);
    console.log(`     -> Resultado Direto: ${res.resultText.slice(0, 80).replace(/\n/g, ' ')}...`);
  });

  await recordAsync('Execução do comando !pix com input de valor retorna dados de cobrança', async () => {
    const res = await labService.executeLabCommand({
      connectionId: 'whatsapp_master',
      command: 'pix',
      input: '89.90'
    });

    assert.strictEqual(res.success, true, 'Execução de pix deve ter sucesso');
    assert.ok(res.resultText, 'Deve conter texto de retorno do Pix');
    assert.strictEqual(res.history, undefined, 'Sem histórico poluindo o resultado');
    console.log(`     -> Resposta do Pix: ${res.resultText.slice(0, 90).replace(/\n/g, ' ')}...`);
  });

  await recordAsync('Execução do comando !menu retorna menu da conexão', async () => {
    const res = await labService.executeLabCommand({
      connectionId: 'whatsapp_master',
      command: 'menu',
      input: 'vendas'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.resultText.length > 20, 'Menu deve retornar texto formatado');
    console.log(`     -> Menu retornado com tamanho: ${res.resultText.length} caracteres.`);
  });

  await recordAsync('Execução do comando !ia retorna resposta cognitiva em tempo real', async () => {
    const res = await labService.executeLabCommand({
      connectionId: 'whatsapp_master',
      command: 'ia',
      input: 'O que você faz?'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.resultText.length > 10, 'IA deve responder');
    console.log(`     -> Resposta IA: ${res.resultText.slice(0, 90).replace(/\n/g, ' ')}...`);
  });

  // 5. TESTANDO SUB-BOT DO EXÉRCITO & TELEGRAM
  console.log('\n📌 5. Testando executeLabCommand() em Sub-bot do Exército e Telegram...');

  await recordAsync('Execução em Sub-bot funciona com identidade do chip', async () => {
    const subbotConn = connections.find(c => c.type === 'subbot') || { id: 'subbot_1282' };
    const res = await labService.executeLabCommand({
      connectionId: subbotConn.id,
      command: 'ping',
      input: ''
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.connectionId, subbotConn.id);
    assert.ok(res.resultText);
    console.log(`     -> Executado via ${res.connectionName}: ${res.executionTimeMs}ms`);
  });

  await recordAsync('Execução no Telegram retorna resposta formatada', async () => {
    const res = await labService.executeLabCommand({
      connectionId: 'telegram',
      command: 'gerente',
      input: ''
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.platform, 'telegram');
    assert.ok(res.resultText);
    console.log(`     -> Telegram retornou: ${res.resultText.slice(0, 80).replace(/\n/g, ' ')}...`);
  });

  // 6. ENDPOINTS REST DA API (/api/lab/*)
  console.log('\n📌 6. Testando rotas HTTP da API (/api/lab/connections, /api/lab/commands, /api/lab/execute)...');
  const { createServer } = require('./src/server/app');
  const app = createServer();
  let server = null;
  const testPort = 39872;

  await recordAsync('Endpoints REST do Lab respondem adequadamente', async () => {
    await new Promise((resolve) => {
      server = app.listen(testPort, () => resolve());
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

    function postJson(path, payload) {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request(`http://127.0.0.1:${testPort}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          }
        }, (res) => {
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
        req.write(data);
        req.end();
      });
    }

    // GET /api/lab/connections
    const connRes = await getJson('/api/lab/connections');
    assert.strictEqual(connRes.success, true);
    assert.ok(Array.isArray(connRes.connections));
    assert.ok(connRes.connections.length >= 2);

    // GET /api/lab/commands
    const cmdRes = await getJson('/api/lab/commands');
    assert.strictEqual(cmdRes.success, true);
    assert.ok(Array.isArray(cmdRes.catalog));

    // POST /api/lab/execute
    const execRes = await postJson('/api/lab/execute', {
      connectionId: 'whatsapp_master',
      command: 'ping',
      input: ''
    });

    assert.strictEqual(execRes.success, true);
    assert.ok(execRes.resultText);
    assert.strictEqual(execRes.command, '!ping');
    assert.ok(typeof execRes.executionTimeMs === 'number');
    assert.strictEqual(execRes.history, undefined, 'Sem histórico poluindo');

    console.log(`     -> Endpoints /api/lab/* responderam 100% OK.`);
  });

  if (server) {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO DOS TESTES DO LAB: ${passedCount} PASSOU | ${failedCount} FALHOU`);
  console.log('====================================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Erro fatal nos testes do Lab:', err);
  process.exit(1);
});

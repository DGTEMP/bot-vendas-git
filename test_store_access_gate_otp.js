const assert = require('assert');
const http = require('http');

process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const { createServer, createStoreServer } = require('./src/server/app');

async function runTests() {
  console.log('🧪 Iniciando Testes da Trava de Acesso da Loja (Gate OTP 5 Dígitos & /v/:code)...');

  // Servidor da Loja (Porta dinâmica)
  const storeApp = createStoreServer();
  const storeServer = http.createServer(storeApp);
  await new Promise(r => storeServer.listen(0, r));
  const storePort = storeServer.address().port;
  console.log(`[Store Server Test] Rodando na porta ${storePort}`);

  function makeRequest(port, method, path, body = null) {
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
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    const testPhone = '5511977778899';

    // 1. Teste de Validação de Telefone Inválido
    console.log('1. Testando POST /api/store/request-access-code com telefone inválido...');
    const resInvalid = await makeRequest(storePort, 'POST', '/api/store/request-access-code', { phone: '123' });
    assert.strictEqual(resInvalid.status, 400);
    assert.strictEqual(resInvalid.body.success, false);
    console.log('  ✅ Telefone inválido rejeitado com mensagem amigável.');

    // 2. Teste de Solicitação de Código de Acesso Válido
    console.log('2. Testando solicitação de código de 5 dígitos via WhatsApp...');
    const resRequest = await makeRequest(storePort, 'POST', '/api/store/request-access-code', {
      phone: testPhone,
      name: 'Cliente Teste VIP'
    });

    assert.strictEqual(resRequest.status, 200);
    assert.strictEqual(resRequest.body.success, true);
    assert.strictEqual(resRequest.body.phone, testPhone);
    assert.strictEqual(resRequest.body.codeLength, 5);
    assert.ok(resRequest.body.shortCode, 'Deve retornar shortCode de 5 caracteres');
    assert.strictEqual(resRequest.body.shortCode.length, 5, 'Código deve ter exatamente 5 caracteres');
    assert.ok(resRequest.body.directLink.includes('/v/'), 'Link direto deve conter /v/');
    assert.ok(resRequest.body.directLink.includes(resRequest.body.shortCode), 'Link direto deve conter o código gerado');

    const generatedCode = resRequest.body.shortCode;
    console.log(`  ✅ Código de 5 dígitos gerado com sucesso: ${generatedCode}`);
    console.log(`  ✅ Link direto de acesso gerado: ${resRequest.body.directLink}`);

    // Verifica se foi registrado no banco com status PENDING
    const isAlreadyVer = models.isStoreAccessVerified(testPhone, generatedCode);
    assert.strictEqual(isAlreadyVer, false, 'Antes da validação, status deve ser false');

    // 3. Teste de Checagem de Status (GET /api/store/auth-status)
    console.log('3. Testando polling GET /api/store/auth-status antes da validação...');
    const resStatusPending = await makeRequest(storePort, 'GET', `/api/store/auth-status?phone=${testPhone}&code=${generatedCode}`);
    assert.strictEqual(resStatusPending.status, 200);
    assert.strictEqual(resStatusPending.body.verified, false, 'Deve constar como não verificado');
    console.log('  ✅ Status pendente confirmado.');

    // 4. Teste de Verificação com Código Errado
    console.log('4. Testando validação com código incorreto...');
    const resWrong = await makeRequest(storePort, 'POST', '/api/store/verify-access-code', {
      phone: testPhone,
      code: 'ERR99'
    });
    assert.strictEqual(resWrong.status, 400);
    assert.strictEqual(resWrong.body.success, false);
    console.log('  ✅ Código incorreto rejeitado com sucesso.');

    // 5. Teste de Verificação com o Código Correto de 5 dígitos
    console.log('5. Testando validação com o código correto de 5 dígitos...');
    const resVerify = await makeRequest(storePort, 'POST', '/api/store/verify-access-code', {
      phone: testPhone,
      code: generatedCode
    });

    assert.strictEqual(resVerify.status, 200);
    assert.strictEqual(resVerify.body.success, true);
    assert.strictEqual(resVerify.body.code, generatedCode);
    assert.ok(resVerify.body.message.includes('liberado'), 'Mensagem de sucesso confirmada');

    // Verifica no modelo se agora consta como verificado
    const isNowVer = models.isStoreAccessVerified(testPhone, generatedCode);
    assert.strictEqual(isNowVer, true, 'Status agora deve ser verificado');

    // Checa polling após validação
    const resStatusVer = await makeRequest(storePort, 'GET', `/api/store/auth-status?phone=${testPhone}&code=${generatedCode}`);
    assert.strictEqual(resStatusVer.body.verified, true, 'Polling confirma verificação');
    console.log('  ✅ Validação do código de 5 dígitos efetuada com sucesso!');

    // 6. Teste de Acesso pelo Link Direto (/v/:code)
    console.log('6. Testando acesso e desbloqueio instantâneo pelo link próprio do Bot (/v/:code)...');
    const directPhone = '5511966663322';
    const reqCode2 = await makeRequest(storePort, 'POST', '/api/store/request-access-code', { phone: directPhone });
    const code2 = reqCode2.body.shortCode;

    // Antes de clicar no link, não está verificado
    assert.strictEqual(models.isStoreAccessVerified(directPhone, code2), false);

    // Cliente clica no link /v/:code enviado pelo Bot no WhatsApp
    const resShortLink = await makeRequest(storePort, 'GET', `/v/${code2}`);
    assert.strictEqual(resShortLink.status, 302, 'Link curto deve redirecionar (HTTP 302)');
    assert.ok(resShortLink.headers.location.includes('/loja'), 'Redireciona para /loja');
    assert.ok(resShortLink.headers.location.includes(`s=${code2}`), 'Contém parâmetro s com o código');
    assert.ok(resShortLink.headers.location.includes(`auth=${code2}`), 'Contém parâmetro auth de liberação');
    assert.ok(resShortLink.headers.location.includes(`phone=${directPhone}`), 'Contém o WhatsApp do cliente');

    // Confirma que clicar no link automaticamente marcou o código como verificado no sistema
    const isLinkVerified = models.isStoreAccessVerified(directPhone, code2);
    assert.strictEqual(isLinkVerified, true, 'Ao clicar no link /v/:code, o acesso é liberado instantaneamente!');
    console.log('  ✅ Acesso e liberação instantânea via /v/:code 100% comprovados!');

    console.log('\n🎉 TODOS OS TESTES DA TRAVA DE ACESSO DA LOJA PASSARAM COM SUCESSO! 🎉');

  } finally {
    storeServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

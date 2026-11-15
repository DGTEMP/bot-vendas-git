/**
 * Testes unitários e de integração para o Encurtador Inteligente de Links da Vitrine (/v/:code)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const { getDb } = require('./src/db/database');
const models = require('./src/db/models');

async function runTests() {
  console.log('🧪 Iniciando testes do Encurtador Inteligente de Links da Vitrine...');

  // 1. Teste de criação e recuperação no banco de dados
  console.log('\n[1/4] Testando models.createStoreShortLink...');
  const testPhone = '5511999998888';
  const testName = 'Cliente Teste VIP';
  const testSubbot = 'subbot_alphavendas';
  const testRef = 'afiliado_top';
  const testCoupon = 'DESCONTO10';

  const linkObj = models.createStoreShortLink({
    phone: testPhone,
    customerName: testName,
    instanceId: testSubbot,
    refCode: testRef,
    couponCode: testCoupon,
    source: 'test_pv_greeting'
  });

  assert(linkObj, 'Objeto de link curto não foi retornado');
  assert(linkObj.code, 'Código do link curto não gerado');
  assert(linkObj.code.length >= 4, 'Código muito curto');
  assert.strictEqual(linkObj.phone, testPhone, 'Telefone não corresponde');
  assert.strictEqual(linkObj.customer_name, testName, 'Nome do cliente não corresponde');
  assert.strictEqual(linkObj.instance_id, testSubbot, 'Instância/subbot não corresponde');
  assert.strictEqual(linkObj.coupon_code, testCoupon, 'Cupom não corresponde');
  assert.strictEqual(linkObj.clicks_count, 0, 'Cliques iniciais devem ser 0');
  console.log(`✅ Link criado com sucesso: código = ${linkObj.code}`);

  // 2. Testando getStoreShortLinkByCode
  console.log('\n[2/4] Testando models.getStoreShortLinkByCode...');
  const fetched = models.getStoreShortLinkByCode(linkObj.code);
  assert(fetched, 'Link curto não encontrado pelo código');
  assert.strictEqual(fetched.id, linkObj.id, 'ID não corresponde');
  assert.strictEqual(fetched.phone, testPhone, 'Telefone não corresponde');
  console.log(`✅ Link recuperado com sucesso pelo código: ${fetched.code}`);

  // 3. Testando getOrCreateStoreShortLink (idempotência / reaproveitamento)
  console.log('\n[3/4] Testando models.getOrCreateStoreShortLink (idempotência)...');
  const reused = models.getOrCreateStoreShortLink({
    phone: testPhone,
    customerName: testName,
    instanceId: testSubbot,
    refCode: testRef,
    couponCode: testCoupon,
    source: 'test_pv_greeting'
  });
  assert.strictEqual(reused.code, linkObj.code, 'Deveria reaproveitar o código existente para o mesmo cliente/subbot/cupom');
  console.log(`✅ Código reutilizado corretamente: ${reused.code}`);

  // 4. Teste de Redirecionamento HTTP e Incremento de Cliques
  console.log('\n[4/4] Testando Rota HTTP Express /v/:code com redirecionamento 302...');
  
  // Criar um app express isolado com o handler da rota para testar o redirecionamento
  const app = express();
  app.get(['/v/:code', '/l/:code', '/s/:code', '/vitrine/:code', '/loja/:code'], (req, res) => {
    const code = req.params.code;
    const shortLink = models.getStoreShortLinkByCode(code, { trackClick: true });
    if (!shortLink) {
      return res.redirect('/loja');
    }
    const params = new URLSearchParams();
    if (shortLink.phone) params.set('phone', shortLink.phone);
    if (shortLink.customer_name) params.set('name', shortLink.customer_name);
    if (shortLink.instance_id) params.set('subbot', shortLink.instance_id);
    if (shortLink.ref_code) params.set('ref', shortLink.ref_code);
    if (shortLink.coupon_code) params.set('cupom', shortLink.coupon_code);
    params.set('s', shortLink.code);

    const targetUrl = (shortLink.target_path || '/loja') + '?' + params.toString();
    res.redirect(302, targetUrl);
  });

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const initialClicks = models.getStoreShortLinkByCode(linkObj.code).clicks_count;

    // Fazer requisição GET sem seguir o redirect (para capturar o 302 e Location)
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: `/v/${linkObj.code}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      assert.strictEqual(res.statusCode, 302, `Status HTTP esperado 302, recebido ${res.statusCode}`);
      const location = res.headers['location'];
      assert(location, 'Header Location não presente');
      console.log(`   Header Location recebido: ${location}`);

      assert(location.includes('/loja?'), 'Redirecionamento deve apontar para /loja?');
      assert(location.includes(`phone=${testPhone}`), 'Location deve incluir o telefone');
      assert(location.includes(`subbot=${testSubbot}`), 'Location deve incluir o subbot');
      assert(location.includes(`cupom=${testCoupon}`), 'Location deve incluir o cupom');
      assert(location.includes(`s=${linkObj.code}`), 'Location deve incluir o tracking s=:code');

      // Verificar se os cliques foram incrementados
      const afterClick = models.getStoreShortLinkByCode(linkObj.code);
      assert.strictEqual(afterClick.clicks_count, initialClicks + 1, 'Contador de cliques deveria incrementar em 1');
      console.log(`✅ Redirecionamento 302 validado com parâmetros e cliques incrementados (${afterClick.clicks_count})!`);

      server.close();
      console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO! 🎉');
      process.exit(0);
    });

    req.on('error', (err) => {
      console.error('❌ Erro na requisição de teste:', err);
      server.close();
      process.exit(1);
    });

    req.end();
  });
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

/**
 * test_coupons_and_short_links.js
 * Validação rigorosa dos Cupons de Desconto e Encurtador Limpo da Vitrine Web
 */

const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const { createStoreServer, createServer } = require('./src/server/app');
const spyFeatures = require('./src/services/spyFeaturesService');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');

async function runCouponAndLinkTests() {
  console.log('🧪 Iniciando testes de Cupons de Desconto e Links Encurtados...');

  // 1. Criação/Garantia de cupons de teste baseados nos fornecidos pelo usuário
  const testCoupons = [
    { code: 'AUTO10PRO', discount_percent: 10, max_uses: 50 },
    { code: 'FIDELIDADE_JTJR3', discount_percent: 15, max_uses: 1 },
    { code: 'PROMO_1794027027467', discount_percent: 30, max_uses: 10 },
    { code: 'DESC_1794027027332', discount_percent: 10, discount_amount: 10, max_uses: 100 },
    { code: 'TESTE_1794027027332', discount_percent: 20, max_uses: 5 }
  ];

  for (const tc of testCoupons) {
    const existing = models.getCouponByCode(tc.code);
    if (!existing) {
      models.createCoupon(tc);
    }
  }

  // 2. Teste do Endpoint /api/store/coupon no servidor da Loja Pública (createStoreServer)
  console.log('\n[1/5] Testando endpoint /api/store/coupon com múltiplos formatos e prefixos...');
  const storeApp = createStoreServer();
  const storeServer = http.createServer(storeApp);

  await new Promise(resolve => storeServer.listen(0, resolve));
  const port = storeServer.address().port;

  async function postCoupon(code, amount) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ code, amount });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/store/coupon',
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
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // A) Teste do cupom AUTO10PRO (10% OFF sobre R$ 200)
  const res1 = await postCoupon('AUTO10PRO', 200);
  assert.strictEqual(res1.status, 200);
  assert(res1.body.success, 'Deve retornar success: true');
  assert(res1.body.valid, 'Deve retornar valid: true para store.html');
  assert.strictEqual(res1.body.code, 'AUTO10PRO');
  assert.strictEqual(res1.body.discountAmount, 20);
  assert.strictEqual(res1.body.finalAmount, 180);
  console.log('  ✅ AUTO10PRO validado com 10% OFF (R$ 200 -> R$ 180)');

  // B) Teste com prefixo cupom_ (ex: cupom_AUTO10PRO)
  const res2 = await postCoupon('cupom_AUTO10PRO', 100);
  assert.strictEqual(res2.status, 200);
  assert(res2.body.valid);
  assert.strictEqual(res2.body.code, 'AUTO10PRO');
  assert.strictEqual(res2.body.discountAmount, 10);
  console.log('  ✅ cupom_AUTO10PRO tratado com sucesso (prefixo removido)');

  // C) Teste com letras minúsculas (ex: fidelidade_jtjr3)
  const res3 = await postCoupon('fidelidade_jtjr3', 100);
  assert.strictEqual(res3.status, 200);
  assert(res3.body.valid);
  assert.strictEqual(res3.body.code, 'FIDELIDADE_JTJR3');
  assert.strictEqual(res3.body.discountAmount, 15);
  console.log('  ✅ fidelidade_jtjr3 validado com 15% OFF (case-insensitive)');

  // D) Teste com carrinho vazio (amount = 0)
  const res4 = await postCoupon('PROMO_1794027027467', 0);
  assert.strictEqual(res4.status, 200);
  assert(res4.body.valid);
  assert.strictEqual(res4.body.code, 'PROMO_1794027027467');
  console.log('  ✅ PROMO_1794027027467 validado com carrinho inicial vazio');

  // E) Teste de cupom inexistente
  const res5 = await postCoupon('CUPOM_NAO_EXISTE_XYZ', 100);
  assert.strictEqual(res5.status, 404);
  assert(!res5.body.valid);
  console.log('  ✅ Cupom inexistente rejeitado com 404 e mensagem explicativa');

  // 3. Teste de Checkout Completo com Cupom (/api/store/checkout)
  console.log('\n[2/5] Testando finalização de checkout com aplicação real de cupom...');
  const testProd = models.getProducts()[0] || models.createProduct({
    name: 'Licença PayBot Teste',
    price_brl: 100.0,
    price: 100.0,
    product_type: 'digital'
  });

  async function postCheckout(payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/store/checkout',
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
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  const checkoutPayload = {
    items: [{ id: testProd.id, quantity: 1, price_brl: testProd.price_brl || 100 }],
    customer: { name: 'Cliente Cupom Teste', phone: '5511999998877' },
    gateway: 'pix',
    couponCode: 'AUTO10PRO'
  };

  const chkRes = await postCheckout(checkoutPayload);
  assert.strictEqual(chkRes.status, 200);
  assert(chkRes.body.success, 'Checkout com cupom deve ser gerado com sucesso');
  const expectedFinal = Math.max(0.50, Math.round(((testProd.price_brl || 100) * 0.90) * 100) / 100);
  assert.strictEqual(chkRes.body.finalBRL, expectedFinal, `Valor final com cupom deve ser R$ ${expectedFinal}`);
  console.log(`  ✅ Checkout gerou pedido #${chkRes.body.tradeNo} com 10% de desconto (Final: R$ ${chkRes.body.finalBRL})`);

  storeServer.close();

  // 4. Teste do Tamanho do Link enviado pelo Bot
  console.log('\n[3/5] Testando tamanho e formato do link enviado pelo bot...');
  let botMessage = null;
  const mockSock = {
    sendMessage: async (to, content) => {
      botMessage = { to, ...content };
      return true;
    }
  };

  const testPhone = '5511988889999';
  const testName = 'Leonardo Comprador';
  await spyFeatures.handleLoja(mockSock, `${testPhone}@s.whatsapp.net`, testPhone, testName);

  assert(botMessage, 'Bot deve enviar a mensagem');
  const urlMatch = botMessage.text.match(/👉\s+(https?:\/\/[^\s\n]+)/);
  assert(urlMatch, 'Deve conter link da loja após o emoji 👉');
  const storeUrl = urlMatch[1];

  console.log(`  ℹ️ Link enviado pelo bot: ${storeUrl}`);
  assert(storeUrl.includes('/v/'), 'O link deve ser curto (/v/<code>)');
  assert(!storeUrl.includes('phone='), 'O link NÃO deve expor query parameters gigantes como phone=');
  assert(!storeUrl.includes('name='), 'O link NÃO deve expor query parameters gigantes como name=');
  assert(!storeUrl.includes('source='), 'O link NÃO deve expor query parameters gigantes como source=');
  assert(storeUrl.length < 80, `O link deve ser conciso (tamanho atual: ${storeUrl.length} caracteres)`);
  console.log(`  ✅ Link curto aprovado com apenas ${storeUrl.length} caracteres (super limpo e elegante!)`);

  // 5. Teste de Resolução do Link Curto no Servidor
  console.log('\n[4/5] Testando resolução do link curto gerado para o cliente...');
  const shortCode = storeUrl.split('/v/')[1].split('?')[0];
  const shortLinkRow = models.getStoreShortLinkByCode(shortCode);
  assert(shortLinkRow, 'Link curto deve estar gravado na tabela store_short_links');
  assert.strictEqual(shortLinkRow.phone, testPhone, 'Link curto deve conter o telefone do lead');
  assert.strictEqual(shortLinkRow.customer_name, testName, 'Link curto deve conter o nome do cliente');
  console.log('  ✅ Link curto mapeia 100% dos dados do cliente no banco de dados');

  // 6. Teste de Redirecionamento 302 com expansão de todos os parâmetros
  console.log('\n[5/5] Testando redirecionamento 302 para preencher a vitrine do cliente...');
  const app2 = createStoreServer();
  const server2 = http.createServer(app2);
  await new Promise(r => server2.listen(0, r));
  const port2 = server2.address().port;

  const redirectRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port2}/v/${shortCode}`, (res) => {
      resolve({ status: res.statusCode, location: res.headers.location });
    }).on('error', reject);
  });

  assert.strictEqual(redirectRes.status, 302, 'Deve responder com 302 redirect');
  assert(redirectRes.location.includes(`phone=${testPhone}`), 'Redirecionamento deve injetar phone do lead');
  assert(redirectRes.location.includes(`lead=${testPhone}`), 'Redirecionamento deve injetar lead do cliente');
  assert(redirectRes.location.includes(`track=${shortCode}`), 'Redirecionamento deve injetar código de rastreamento');
  console.log(`  ✅ 302 Redirect expande perfeitamente os dados na chegada à vitrine:\n     Location: ${redirectRes.location}`);

  server2.close();

  console.log('\n🎉 TODOS OS TESTES DE CUPONS E LINKS ENCURTADOS PASSARAM COM 100%! 🎉\n');
}

runCouponAndLinkTests().catch(err => {
  console.error('\n❌ Falha nos testes de cupons e links:', err);
  process.exit(1);
});

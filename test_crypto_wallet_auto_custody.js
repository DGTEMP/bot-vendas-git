/**
 * Test Suite: Carteira Cripto Auto-Custódia
 * Verifica serviços, APIs web, banco de dados, bots e checkout da loja.
 */

const assert = require('assert');
const models = require('./src/db/models');
const cryptoWalletService = require('./src/services/cryptoWalletService');
const { createServer } = require('./src/server/app');
const http = require('http');

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: Carteira Cripto Auto-Custódia...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Configurações de Redes Suportadas
  test('1. Deve listar metadados completos de todas as 10 redes suportadas', () => {
    const networks = cryptoWalletService.getSupportedNetworks();
    assert(networks.USDT_TRC20, 'USDT_TRC20 deve existir');
    assert(networks.USDT_BEP20, 'USDT_BEP20 deve existir');
    assert(networks.USDT_ERC20, 'USDT_ERC20 deve existir');
    assert(networks.BTC, 'BTC deve existir');
    assert(networks.ETH, 'ETH deve existir');
    assert(networks.BNB, 'BNB deve existir');
    assert(networks.SOL, 'SOL deve existir');
    assert(networks.TON, 'TON deve existir');
    assert(networks.LTC, 'LTC deve existir');
    assert(networks.TRX, 'TRX deve existir');
  });

  // 2. Validação de Endereços
  test('2. Deve validar formatos de endereços em diferentes redes', () => {
    // Tron TRC20 (começa com T, 34 chars)
    assert(cryptoWalletService.validateAddress('USDT_TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));
    assert(!cryptoWalletService.validateAddress('USDT_TRC20', '0x1234567890abcdef1234567890abcdef12345678'));

    // Ethereum / BSC (começa com 0x, 42 chars hex)
    assert(cryptoWalletService.validateAddress('ETH', '0xdAC17F958D2ee523a2206206994597C13D831ec7'));
    assert(cryptoWalletService.validateAddress('USDT_BEP20', '0x55d398326f99059fF775485246999027B3197955'));
    assert(!cryptoWalletService.validateAddress('ETH', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));

    // Bitcoin (SegWit bc1... ou Legacy 1... ou 3...)
    assert(cryptoWalletService.validateAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'));
    assert(cryptoWalletService.validateAddress('BTC', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'));
    assert(!cryptoWalletService.validateAddress('BTC', 'invalid-btc-address'));

    // Solana
    assert(cryptoWalletService.validateAddress('SOL', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
    assert(!cryptoWalletService.validateAddress('SOL', 'short'));
  });

  // 3. Salvar e Recuperar Configurações no Banco
  test('3. Deve salvar configurações de carteira configuráveis no painel web', () => {
    const saved = cryptoWalletService.saveWalletSettings({
      GATEWAY_CRYPTO_ENABLED: true,
      CRYPTO_CONFIRM_MODE: 'auto',
      CRYPTO_AUTO_POLL_INTERVAL_SEC: 45,
      CRYPTO_PAYMENT_TIMEOUT_MIN: 90,
      CRYPTO_MEMO_PREFIX: 'TESTORD',
      WALLET_USDT_TRC20: 'TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf',
      WALLET_USDT_TRC20_ENABLED: true,
      WALLET_BTC: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      WALLET_BTC_ENABLED: true,
      WALLET_ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      WALLET_ETH_ENABLED: false, // desabilitada
    });

    assert.strictEqual(saved._global.CRYPTO_GATEWAY_ENABLED, true);
    assert.strictEqual(saved._global.CRYPTO_CONFIRM_MODE, 'auto');
    assert.strictEqual(saved._global.CRYPTO_AUTO_POLL_INTERVAL_SEC, 45);
    assert.strictEqual(saved._global.CRYPTO_PAYMENT_TIMEOUT_MIN, 90);
    assert.strictEqual(saved._global.CRYPTO_MEMO_PREFIX, 'TESTORD');
    assert.strictEqual(saved.USDT_TRC20.address, 'TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf');
    assert.strictEqual(saved.USDT_TRC20.enabled, true);
    assert.strictEqual(saved.BTC.enabled, true);
    assert.strictEqual(saved.ETH.enabled, false);

    // Enabled networks deve conter USDT_TRC20 e BTC, e não conter ETH
    const enabledNets = cryptoWalletService.getEnabledNetworks();
    assert(enabledNets.some(n => n.key === 'USDT_TRC20'), 'USDT_TRC20 deve estar habilitado');
    assert(enabledNets.some(n => n.key === 'BTC'), 'BTC deve estar habilitado');
    assert(!enabledNets.some(n => n.key === 'ETH'), 'ETH não deve estar habilitado');
  });

  // 4. Criação de Pedido Cripto e URIs de Pagamento
  await asyncTest('4. Deve criar cobrança cripto com URI e QR Code válidos', async () => {
    const res = await cryptoWalletService.createOrder({
      merchantTradeNo: 'ORD_TEST_123456',
      amountUsdt: 29.90,
      productName: 'Software Bot VIP',
      networkKey: 'USDT_TRC20'
    });

    assert(res.success, 'Criação de ordem cripto deve ter sucesso');
    assert(res.data.address.startsWith('T'), 'Endereço TRC20 deve iniciar com T');
    assert.strictEqual(res.data.network, 'USDT_TRC20');
    assert(res.data.memo.includes('TESTORD'), 'Memo deve conter o prefixo customizado');
    assert(res.data.paymentUri.includes('tron:TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf'), 'URI Tron deve estar formatada');
    assert(res.data.qrCodeUrl.includes('api.qrserver.com'), 'QR Server URL deve ser gerada');
  });

  // 5. Montagem de Mensagem de Pagamento
  test('5. Deve formatar mensagem completa de cobrança cripto para WhatsApp e Telegram', () => {
    const msg = cryptoWalletService.buildPaymentMessage({
      networkName: 'USDT (TRC20)',
      networkIcon: '💚',
      address: 'TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf',
      amountUsdt: '29.90',
      memo: 'TESTORD-123456',
      expireTime: Date.now() + 3600000,
      confirmMode: 'auto'
    }, 'Plano Premium', 164.45);

    assert(msg.includes('PAGAMENTO EM CRIPTOMOEDA'), 'Deve conter cabeçalho');
    assert(msg.includes('TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf'), 'Deve conter endereço');
    assert(msg.includes('29.90 USDT'), 'Deve conter valor exato em USDT');
    assert(msg.includes('TESTORD-123456'), 'Deve conter memo');
    assert(msg.includes('blockchain'), 'Deve informar modo automático');
  });

  // 6. Ciclo de Pedido no Banco de Dados
  test('6. Deve persistir pedido com gateway "crypto" e entregar produto após confirmação', () => {
    const tradeNo = `ORD_CRP_TEST_${Date.now()}`;
    const products = models.getProducts(true);
    const prod = products[0];

    const order = models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: '5511999999999',
      platform_user_name: 'Comprador Cripto',
      product_id: prod.id,
      gateway: 'crypto',
      amount: 19.90,
      currency: 'USDT',
      status: 'PENDING'
    });

    assert(order, 'Pedido deve ser criado');
    assert.strictEqual(order.gateway, 'crypto');
    assert.strictEqual(order.status, 'PENDING');

    // Confirmação manual
    const confirmRes = cryptoWalletService.manualConfirm(tradeNo, '0xabcdef1234567890txhash');
    assert(confirmRes.success, 'Confirmação manual deve ter sucesso');

    // Atualiza status do pedido para PAID
    models.updateOrderStatus(tradeNo, 'PAID', 'Licença entregue via Cripto');
    const updated = models.getOrderByTradeNo(tradeNo);
    assert.strictEqual(updated.status, 'PAID');
    assert(updated.delivered_content.includes('Licença entregue'), 'Conteúdo deve ser entregue');
  });

  // 7. Teste de Endpoints HTTP do Servidor
  await asyncTest('7. Deve responder corretamente aos endpoints da API Web de Carteira Cripto', async () => {
    const app = createServer();
    const server = http.createServer(app);

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // GET /api/crypto/settings
      const resSettings = await fetch(`${baseUrl}/api/crypto/settings`);
      const dataSettings = await resSettings.json();
      assert(dataSettings.success, 'GET /api/crypto/settings deve retornar success');
      assert(dataSettings.settings.USDT_TRC20, 'Deve conter configuração USDT_TRC20');

      // POST /api/crypto/settings
      const resSave = await fetch(`${baseUrl}/api/crypto/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          WALLET_TON: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
          WALLET_TON_ENABLED: true
        })
      });
      const dataSave = await resSave.json();
      assert(dataSave.success, 'POST /api/crypto/settings deve retornar success');
      assert.strictEqual(dataSave.settings.TON.address, 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N');
      assert.strictEqual(dataSave.settings.TON.enabled, true);

      // GET /api/crypto/networks
      const resNets = await fetch(`${baseUrl}/api/crypto/networks`);
      const dataNets = await resNets.json();
      assert(dataNets.success, 'GET /api/crypto/networks deve retornar success');
      assert(dataNets.networks.some(n => n.key === 'TON'), 'TON deve estar na lista de redes ativas');

      // POST /api/store/checkout com gateway crypto
      const products = models.getProducts(true);
      const testProd = products[0];
      const resCheckout = await fetch(`${baseUrl}/api/store/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: testProd.id, quantity: 1 }],
          customer: { name: 'Lucas Cripto', phone: '5511988887777' },
          gateway: 'crypto',
          networkKey: 'USDT_TRC20'
        })
      });
      const dataCheckout = await resCheckout.json();
      assert(dataCheckout.success, 'Checkout da loja com crypto deve retornar success');
      assert.strictEqual(dataCheckout.gateway, 'crypto');
      assert(dataCheckout.cryptoData, 'Deve retornar cryptoData estruturado para o frontend da loja');
      assert.strictEqual(dataCheckout.cryptoData.network, 'USDT_TRC20');
      assert(dataCheckout.cryptoData.address, 'Deve conter o endereço de carteira auto-custódia configurado');

      // POST /api/crypto/confirm/:tradeNo
      const resConfirm = await fetch(`${baseUrl}/api/crypto/confirm/${dataCheckout.tradeNo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: '0xhash_confirmacao_teste_123' })
      });
      const dataConfirm = await resConfirm.json();
      assert(dataConfirm.success, 'Confirmação manual de pedido cripto deve retornar success');

      // Para polling pendente
      cryptoWalletService.stopPolling(dataCheckout.tradeNo);

      // Verifica se o pedido no banco virou PAID
      const verifiedOrder = models.getOrderByTradeNo(dataCheckout.tradeNo);
      assert.strictEqual(verifiedOrder.status, 'PAID');
    } finally {
      server.close();
    }
  });

  console.log(`\n========================================`);
  console.log(`🏁 Fim dos Testes: ${passed} passaram, ${failed} falharam.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

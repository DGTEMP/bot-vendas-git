/**
 * =========================================================================
 * 🧪 TEST SUITE: BLOCOS AVANÇADOS 1, 2, 3 E 4
 * =========================================================================
 * 1. Cotações Cripto ao Vivo + Derivação Determinística HD (XPUB)
 * 2. Order Bump na Loja + Portal de Afiliados (/afiliado) + Magic Paylinks
 * 3. Speech-to-Text (Áudio IA) + Base FAQ RAG + Lead Scoring / Termômetro CRM
 * 4. Fechamento Diário de Caixa (23h Brasília) + Backup Automático SQLite
 * =========================================================================
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const models = require('./src/db/models');
const db = require('./src/db/database');
const cryptoWalletService = require('./src/services/cryptoWalletService');
const speechToTextService = require('./src/services/speechToTextService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const dailyClosingReportService = require('./src/services/dailyClosingReportService');
const databaseBackupService = require('./src/services/databaseBackupService');

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: Blocos 1, 2, 3 e 4...\n');
  let passed = 0;
  let failed = 0;

  function pass(desc) {
    passed++;
    console.log(`  ✅ [PASS] ${desc}`);
  }
  function fail(desc, err) {
    failed++;
    console.error(`  ❌ [FAIL] ${desc}:`, err.message);
  }

  // Sobe servidor express transient para testar endpoints HTTP
  const { createServer } = require('./src/server/app');
  const app = createServer();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------
    // BLOCO 1: Cotações Cripto ao Vivo & Derivação XPUB
    // -------------------------------------------------------------
    console.log('--- BLOCO 1: Cotação Cripto ao Vivo & Derivação HD (XPUB) ---');

    try {
      const prices = await cryptoWalletService.fetchLivePrices();
      assert(prices.BTC && prices.BTC.usd > 0, 'Cotação BTC deve ser maior que 0');
      assert(prices.ETH && prices.ETH.usd > 0, 'Cotação ETH deve ser maior que 0');
      assert(prices.USDT && Math.abs(prices.USDT.usd - 1.0) < 0.1, 'USDT deve ser ~1.0 USD');
      assert(prices.USDT.brl > 0, 'Cotação USDT/BRL deve ser maior que 0');
      pass('1.1 fetchLivePrices retorna cotações válidas');
    } catch (e) { fail('1.1 fetchLivePrices', e); }

    try {
      const convBtc = await cryptoWalletService.convertCryptoAmount(100.0, 'BTC');
      assert(parseFloat(convBtc.cryptoAmount) > 0, 'Quantidade BTC convertida deve ser positiva');
      assert.strictEqual(convBtc.cryptoSymbol, 'BTC');

      const convUsdt = await cryptoWalletService.convertCryptoAmount(50.0, 'USDT_TRC20');
      assert.strictEqual(convUsdt.cryptoAmount, '50.00');
      assert.strictEqual(convUsdt.cryptoSymbol, 'USDT');
      pass('1.2 convertCryptoAmount converte corretamente valores');
    } catch (e) { fail('1.2 convertCryptoAmount', e); }

    try {
      // Salva chaves XPUB simuladas
      models.setSetting('CRYPTO_XPUB_BTC', 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4QcmDwR7zN1XW');
      models.setSetting('CRYPTO_XPUB_EVM', 'xpub661MyMwAqRbcG5D8zEVM8sYJABqqG9YLmC4QcmDwR7zN2YY');
      models.setSetting('CRYPTO_XPUB_TRON', 'xpub661MyMwAqRbcT9Z8zTRONsYJABqqG9YLmC4QcmDwR7zN3ZZ');

      const btcAddr = cryptoWalletService.deriveAddress('BTC', 'ORD_1001', 'bc1qfallback');
      assert(btcAddr.startsWith('bc1q') && btcAddr !== 'bc1qfallback', 'Endereço BTC derivado deve começar com bc1q');

      const evmAddr = cryptoWalletService.deriveAddress('ETH', 'ORD_1001', '0xfallback');
      assert(evmAddr.startsWith('0x') && evmAddr !== '0xfallback', 'Endereço EVM derivado deve começar com 0x');

      const tronAddr = cryptoWalletService.deriveAddress('USDT_TRC20', 'ORD_1001', 'Tfallback');
      assert(tronAddr.startsWith('T') && tronAddr !== 'Tfallback', 'Endereço TRON derivado deve começar com T');

      // Sem XPUB deve usar fallback
      models.setSetting('CRYPTO_XPUB_BTC', '');
      models.setSetting('CRYPTO_XPUB_EVM', '');
      models.setSetting('CRYPTO_XPUB_TRON', '');
      const fallbackAddr = cryptoWalletService.deriveAddress('BTC', 'ORD_1001', 'bc1qfallback');
      assert.strictEqual(fallbackAddr, 'bc1qfallback');

      pass('1.3 deriveAddress gera sub-endereços determinísticos com XPUB');
    } catch (e) { fail('1.3 deriveAddress', e); }

    // -------------------------------------------------------------
    // BLOCO 2: Order Bump, Magic Paylinks & Portal de Afiliados
    // -------------------------------------------------------------
    console.log('\n--- BLOCO 2: Order Bump, Magic Paylinks & Portal de Afiliados ---');

    let testProd1, testProd2, testAffiliate;
    try {
      testProd1 = models.createProduct({
        name: 'Produto Base Teste Bump',
        price: 100.0,
        price_brl: 100.0,
        type: 'digital_file',
        upsell_discount_percent: 25.0,
        upsell_headline: 'Leve também o addon com 25% de desconto!'
      });

      testProd2 = models.createProduct({
        name: 'Produto Addon Bump',
        price: 40.0,
        price_brl: 40.0,
        type: 'digital_file'
      });

      testAffiliate = models.createAffiliate({
        name: 'Afiliado Teste Alpha',
        email: 'alpha@afiliado.com',
        phone: '5511999991111',
        ref_code: 'REF_ALPHA_' + Date.now(),
        commission_rate: 30.0,
        pix_key: 'alpha@pix.me',
        usdt_wallet: 'TYDzsYUE2DdvdYqD22EmCL8nyP38p65mBf'
      });

      pass('2.1 Criação de produtos e afiliado de teste no banco');
    } catch (e) { fail('2.1 Setup produtos e afiliado', e); }

    try {
      // Checkout com Order Bump e Ref Code
      const checkoutRes = await fetch(`${baseUrl}/api/store/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: testProd1.id, quantity: 1, is_order_bump: false },
            { id: testProd2.id, quantity: 1, is_order_bump: true }
          ],
          customer: { name: 'Cliente Bump Teste', phone: '5511988884444' },
          gateway: 'crypto',
          networkKey: 'USDT_TRC20',
          ref_code: testAffiliate.ref_code
        })
      });

      const ckData = await checkoutRes.json();
      assert(ckData.success, 'Checkout com Order Bump deve retornar sucesso');
      assert(ckData.tradeNo, 'Deve gerar merchantTradeNo');

      // Interrompe polling do teste para desligar com segurança
      cryptoWalletService.stopPolling(ckData.tradeNo);

      const savedOrder = db.prepare('SELECT * FROM orders WHERE merchant_trade_no = ?').get(ckData.tradeNo);
      assert(savedOrder, 'Pedido deve estar salvo no banco');
      assert.strictEqual(savedOrder.is_upsell, 1, 'is_upsell deve ser 1 quando há order bump');
      assert.strictEqual(savedOrder.affiliate_id, testAffiliate.id, 'affiliate_id deve ser vinculado');

      pass('2.2 Checkout processa Order Bump com is_upsell=1 e credita afiliado');
    } catch (e) { fail('2.2 Checkout Order Bump', e); }

    try {
      // Magic Paylink Redirection
      const payRes = await fetch(`${baseUrl}/pay/${testProd1.id}?ref=${testAffiliate.ref_code}`, {
        redirect: 'manual'
      });
      assert([301, 302, 303, 307, 308].includes(payRes.status), 'Magic Paylink deve responder com redirecionamento HTTP');
      const location = payRes.headers.get('location');
      assert(location.includes(`/loja?buy=${testProd1.id}`), 'Redirecionamento deve apontar para /loja?buy=...');
      assert(location.includes(`ref=${testAffiliate.ref_code}`), 'Deve propagar o ref_code na URL');

      pass('2.3 Magic Paylink (/pay/:id) redireciona corretamente com parâmetros');
    } catch (e) { fail('2.3 Magic Paylink', e); }

    try {
      // Portal de Afiliados: Login e Dashboard
      const loginRes = await fetch(`${baseUrl}/api/portal-afiliado/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testAffiliate.ref_code })
      });
      const loginData = await loginRes.json();
      assert(loginData.success, 'Login do portal deve retornar sucesso');
      assert.strictEqual(loginData.affiliate.id, testAffiliate.id);

      const dashRes = await fetch(`${baseUrl}/api/portal-afiliado/dashboard/${testAffiliate.id}`);
      const dashData = await dashRes.json();
      assert(dashData.success, 'Dashboard deve retornar dados do afiliado');
      assert(Array.isArray(dashData.products), 'Deve listar produtos disponíveis para afiliação');

      pass('2.4 Portal de Afiliados (/api/portal-afiliado/*) responde login e dashboard');
    } catch (e) { fail('2.4 Portal de Afiliados', e); }

    // -------------------------------------------------------------
    // BLOCO 3: Speech-to-Text, Base FAQ RAG & Lead Scoring CRM
    // -------------------------------------------------------------
    console.log('\n--- BLOCO 3: Speech-to-Text, FAQ RAG & Lead Scoring CRM ---');

    try {
      // Teste de Speech-to-Text em modo sandbox
      models.setSetting('ENVIRONMENT_MODE', 'sandbox');
      const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....');
      const transcription = await speechToTextService.transcribeAudio(dummyAudio, 'audio/ogg');
      assert(typeof transcription === 'string' && transcription.length > 0, 'Deve retornar texto transcrito em sandbox');
      pass('3.1 speechToTextService transcreve áudio com sucesso');
    } catch (e) { fail('3.1 speechToTextService', e); }

    try {
      // Base de Conhecimento RAG / FAQ
      const faq = models.createProductFaq({
        product_id: null,
        question: 'Qual o tempo de entrega do acesso?',
        answer: 'O envio é imediato via WhatsApp e Telegram após aprovação.',
        keywords: 'tempo, entrega, envio, prazo, acesso'
      });
      assert(faq && faq.id > 0, 'Deve criar FAQ');

      // Teste de busca semântica
      const match1 = models.matchProductFaq('Qual o prazo de entrega do acesso após eu pagar?');
      assert(match1 && match1.match, 'Deve encontrar FAQ por correspondência de palavras-chave');
      assert.strictEqual(match1.faq.id, faq.id);

      // Endpoint /api/faqs
      const listFaqsRes = await fetch(`${baseUrl}/api/faqs`);
      const listData = await listFaqsRes.json();
      assert(listData.success && Array.isArray(listData.faqs), 'Endpoint /api/faqs deve listar FAQs');

      pass('3.2 Base de Conhecimento RAG FAQ cria e faz correspondência semântica');
    } catch (e) { fail('3.2 FAQ RAG', e); }

    try {
      // Lead Scoring & Termômetro no CRM
      const testPhone = '5511977778888';
      models.upsertLeadCognitiveProfile(testPhone, {
        name: 'Lead Quente Teste',
        buying_stage: 'PROPOSTA',
        readiness_score: 75,
        estimated_budget: 1500.0
      });

      const scoreData = cognitiveSalesService.calculateLeadScoreAndTemperature(testPhone);
      assert(scoreData.score >= 70, 'Score deve ser >= 70');
      assert(['QUENTE', 'FECHAMENTO'].includes(scoreData.temperature), 'Temperatura deve ser QUENTE ou FECHAMENTO');
      assert(scoreData.emoji, 'Deve conter emoji de termômetro');

      // Endpoint HTTP
      const scoreRes = await fetch(`${baseUrl}/api/cognitive/lead-score/${testPhone}`);
      const scoreHttp = await scoreRes.json();
      assert(scoreHttp.success && scoreHttp.score > 0, 'Endpoint /api/cognitive/lead-score deve retornar dados válidos');

      pass('3.3 Lead Scoring e Termômetro calculam temperatura e ações de vendas');
    } catch (e) { fail('3.3 Lead Scoring', e); }

    // -------------------------------------------------------------
    // BLOCO 4: Fechamento Diário de Caixa & Backup Automático SQLite
    // -------------------------------------------------------------
    console.log('\n--- BLOCO 4: Fechamento Diário & Backup Automático SQLite ---');

    try {
      // Geração do Fechamento Diário de Caixa
      const report = dailyClosingReportService.generateDailyReport();
      assert(report.date, 'Relatório deve ter data');
      assert(typeof report.totalBRL === 'number', 'Total BRL deve ser número');
      assert(typeof report.totalUSDT === 'number', 'Total USDT deve ser número');
      assert(report.gatewayBreakdown, 'Deve ter segregação por gateways');

      const message = dailyClosingReportService.formatReportMessage(report);
      assert(message.includes('FECHAMENTO DIÁRIO DE CAIXA'), 'Mensagem formatada deve conter cabeçalho');

      // Endpoint HTTP
      const reportRes = await fetch(`${baseUrl}/api/reports/daily-closing`);
      const reportHttp = await reportRes.json();
      assert(reportHttp.success && reportHttp.report, 'Endpoint /api/reports/daily-closing deve responder sucesso');

      pass('4.1 Fechamento Diário de Caixa consolida métricas e formata relatório executivo');
    } catch (e) { fail('4.1 Fechamento Diário', e); }

    try {
      // Backup Automático do SQLite com VACUUM INTO
      const backupResult = databaseBackupService.createBackup();
      assert(backupResult.success, 'Backup deve retornar sucesso');
      assert(backupResult.filename && backupResult.filename.startsWith('backup_paybot_'), 'Nome do arquivo de backup válido');
      assert(backupResult.sizeBytes > 1000, 'Arquivo de backup deve ter tamanho consistente');
      assert(fs.existsSync(backupResult.filePath), 'Arquivo de backup deve existir fisicamente');

      const backupsList = databaseBackupService.listBackups();
      assert(Array.isArray(backupsList) && backupsList.length > 0, 'Deve listar backups disponíveis');

      // Endpoint HTTP
      const listHttpRes = await fetch(`${baseUrl}/api/system/backups`);
      const listHttp = await listHttpRes.json();
      assert(listHttp.success && Array.isArray(listHttp.backups), 'Endpoint /api/system/backups deve listar backups');

      pass('4.2 Backup Automático SQLite cria snapshot atômico com retenção');
    } catch (e) { fail('4.2 Backup SQLite', e); }

  } finally {
    server.close();
  }

  console.log('\n========================================');
  console.log(`🏁 Fim dos Testes dos Blocos 1-4: ${passed} passaram, ${failed} falharam.`);
  console.log('========================================');

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

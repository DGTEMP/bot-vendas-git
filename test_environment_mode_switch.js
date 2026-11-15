const assert = require('assert');
const path = require('path');
const models = require('./src/db/models');
const pixPayment = require('./src/services/pixPayment');
const binancePay = require('./src/services/binancePay');
const bacenPixService = require('./src/services/bacenPixService');
const whatsappBot = require('./src/bots/whatsappBot');
const telegramBot = require('./src/bots/telegramBot');
const fulfillment = require('./src/services/fulfillment');
const express = require('express');
const http = require('http');

async function runTests() {
  console.log('🧪 ====================================================');
  console.log('🧪 TESTE COMPLETO: SELEÇÃO DE MODO SANDBOX vs PRODUÇÃO');
  console.log('🧪 ====================================================\n');

  // Salva estado original
  const originalEnvMode = models.getSetting('ENVIRONMENT_MODE', 'sandbox');
  const originalPixSim = models.getSetting('PIX_SIMULATION_MODE', 'true');
  const originalBnbSim = models.getSetting('BINANCE_SIMULATION_MODE', 'true');
  const originalBacenSandbox = models.getSetting('BACEN_PIX_SANDBOX', 'true');

  try {
    // ----------------------------------------------------
    // TESTE 1: Métodos de Modelo (models.js)
    // ----------------------------------------------------
    console.log('--- TESTE 1: Métodos de Modelo (models.js) ---');
    
    // Alterna para Produção
    const resProd = models.setEnvironmentMode('production');
    assert.strictEqual(resProd, 'production');
    assert.strictEqual(models.getEnvironmentMode(), 'production');
    assert.strictEqual(models.isProduction(), true);
    assert.strictEqual(models.getSetting('PIX_SIMULATION_MODE'), 'false');
    assert.strictEqual(models.getSetting('BINANCE_SIMULATION_MODE'), 'false');
    assert.strictEqual(models.getSetting('BACEN_PIX_SANDBOX'), 'false');
    console.log('  ✅ [PASS] setEnvironmentMode("production") configurou flags de produção');

    // Alterna para Sandbox
    const resSand = models.setEnvironmentMode('sandbox');
    assert.strictEqual(resSand, 'sandbox');
    assert.strictEqual(models.getEnvironmentMode(), 'sandbox');
    assert.strictEqual(models.isProduction(), false);
    assert.strictEqual(models.getSetting('PIX_SIMULATION_MODE'), 'true');
    assert.strictEqual(models.getSetting('BINANCE_SIMULATION_MODE'), 'true');
    assert.strictEqual(models.getSetting('BACEN_PIX_SANDBOX'), 'true');
    console.log('  ✅ [PASS] setEnvironmentMode("sandbox") configurou flags de simulação');

    // ----------------------------------------------------
    // TESTE 2: Comportamento dos Gateways (Pix, Bacen, Binance)
    // ----------------------------------------------------
    console.log('\n--- TESTE 2: Comportamento dos Gateways ---');

    // MODO PRODUÇÃO
    models.setEnvironmentMode('production');
    const pixSettingsProd = pixPayment.getSettings();
    assert.strictEqual(pixSettingsProd.isProduction, true);
    assert.strictEqual(pixSettingsProd.isSimulated, false);

    const bnbCredsProd = binancePay.getCredentials();
    assert.strictEqual(bnbCredsProd.isProduction, true);
    assert.strictEqual(bnbCredsProd.isSimulated, false);

    const bacenSettingsProd = bacenPixService.getSettings();
    assert.strictEqual(bacenSettingsProd.isProduction, true);
    assert.strictEqual(bacenSettingsProd.isSandbox, false);
    console.log('  ✅ [PASS] Em Modo Produção: todos os gateways desativam simulação e sandbox');

    // MODO SANDBOX
    models.setEnvironmentMode('sandbox');
    const bnbCredsSand = binancePay.getCredentials();
    assert.strictEqual(bnbCredsSand.isProduction, false);
    assert.strictEqual(bnbCredsSand.isSimulated, true);

    const bacenSettingsSand = bacenPixService.getSettings();
    assert.strictEqual(bacenSettingsSand.isProduction, false);
    assert.strictEqual(bacenSettingsSand.isSandbox, true);
    console.log('  ✅ [PASS] Em Modo Sandbox: gateways utilizam simulação e endpoints de homologação');

    // ----------------------------------------------------
    // TESTE 3: Comportamento do WhatsApp Bot
    // ----------------------------------------------------
    console.log('\n--- TESTE 3: Mensagens do WhatsApp Bot ---');
    
    // Produto de teste
    let testProd = models.getProducts(false)[0];
    if (!testProd) {
      testProd = models.createProduct({
        name: 'Produto Teste Licença',
        price_brl: 49.90,
        price_usdt: 10.00,
        category: 'Software'
      });
    }

    // Interceptador de mensagens do WhatsAppBot
    let lastWppMessages = [];
    const origSendMessage = whatsappBot.sendMessage.bind(whatsappBot);
    whatsappBot.sendMessage = async function(to, content, options, sock) {
      lastWppMessages.push({ to, content });
      return { key: { id: 'TEST_' + Date.now() } };
    };

    // Cenário A: WhatsAppBot em modo SANDBOX
    models.setEnvironmentMode('sandbox');
    lastWppMessages = [];
    await whatsappBot.processPixPurchase('5511999990001@s.whatsapp.net', 'Tester Sandbox', testProd);
    const hasTestNoticeSandbox = lastWppMessages.some(m => 
      (typeof m.content === 'object' && m.content.caption && m.content.caption.includes('[MODO DE TESTE]')) ||
      (typeof m.content === 'string' && m.content.includes('[MODO DE TESTE]'))
    );
    assert.strictEqual(hasTestNoticeSandbox, true, 'No modo Sandbox o bot DEVE incluir [MODO DE TESTE]');
    console.log('  ✅ [PASS] WhatsAppBot exibe aviso [MODO DE TESTE] e link de aprovação em Modo Sandbox');

    // Cenário B: WhatsAppBot em modo PRODUÇÃO
    models.setEnvironmentMode('production');
    lastWppMessages = [];
    await whatsappBot.processPixPurchase('5511999990002@s.whatsapp.net', 'Cliente Real', testProd);
    const hasTestNoticeProd = lastWppMessages.some(m => 
      (typeof m.content === 'object' && m.content.caption && m.content.caption.includes('[MODO DE TESTE]')) ||
      (typeof m.content === 'string' && m.content.includes('[MODO DE TESTE]'))
    );
    assert.strictEqual(hasTestNoticeProd, false, 'No modo Produção o bot NÃO DEVE incluir [MODO DE TESTE]');
    console.log('  ✅ [PASS] WhatsAppBot NÃO exibe aviso [MODO DE TESTE] nem links de simulação em Modo Produção');

    // Restaura interceptador
    whatsappBot.sendMessage = origSendMessage;

    // ----------------------------------------------------
    // TESTE 4: Notificação Administrativa de Venda
    // ----------------------------------------------------
    console.log('\n--- TESTE 4: Tag de Ambiente no Alerta de Venda ---');
    let lastAdminAlert = null;
    const origFulfillSendWpp = fulfillment.sendWhatsAppMessage;
    fulfillment.sendWhatsAppMessage = async function(to, msg) {
      if (to.includes(models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '554884702848'))) {
        lastAdminAlert = msg;
      }
    };

    // Simula venda em Produção
    models.setEnvironmentMode('production');
    const orderProdTradeNo = `ORD_TEST_PROD_${Date.now()}`;
    models.createOrder({
      merchant_trade_no: orderProdTradeNo,
      platform: 'whatsapp',
      platform_user_id: '5511988887777@s.whatsapp.net',
      platform_user_name: 'Cliente Produção',
      product_id: testProd.id,
      gateway: 'pix',
      amount: 49.90,
      currency: 'BRL',
      status: 'PENDING'
    });
    await fulfillment.fulfillOrder(orderProdTradeNo);
    assert.ok(lastAdminAlert && lastAdminAlert.includes('[PRODUÇÃO REAL]'), 'Alerta de venda deve conter [PRODUÇÃO REAL]');
    console.log('  ✅ [PASS] Alerta do Administrador exibe tag 🚀 [PRODUÇÃO REAL]');

    // Simula venda em Sandbox
    models.setEnvironmentMode('sandbox');
    const orderSandTradeNo = `ORD_TEST_SAND_${Date.now()}`;
    models.createOrder({
      merchant_trade_no: orderSandTradeNo,
      platform: 'whatsapp',
      platform_user_id: '5511988887777@s.whatsapp.net',
      platform_user_name: 'Tester Sandbox',
      product_id: testProd.id,
      gateway: 'pix',
      amount: 49.90,
      currency: 'BRL',
      status: 'PENDING'
    });
    await fulfillment.fulfillOrder(orderSandTradeNo);
    assert.ok(lastAdminAlert && lastAdminAlert.includes('[SANDBOX / TESTE]'), 'Alerta de venda deve conter [SANDBOX / TESTE]');
    console.log('  ✅ [PASS] Alerta do Administrador exibe tag 🧪 [SANDBOX / TESTE]');

    fulfillment.sendWhatsAppMessage = origFulfillSendWpp;

    // ----------------------------------------------------
    // TESTE 5: API Endpoints (GET e POST)
    // ----------------------------------------------------
    console.log('\n--- TESTE 5: Endpoints da API de Configurações ---');
    const serverModule = require('./src/server/app');
    const testApp = serverModule.createServer();

    // Cria servidor temporário em porta livre
    const testServer = http.createServer(testApp);
    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 5.1 GET /api/settings/environment-mode
      const resGetMode = await fetch(`${baseUrl}/api/settings/environment-mode`);
      const dataGetMode = await resGetMode.json();
      assert.strictEqual(dataGetMode.success, true);
      assert.strictEqual(dataGetMode.mode, 'sandbox');
      console.log('  ✅ [PASS] GET /api/settings/environment-mode retornou status atual');

      // 5.2 POST /api/settings/environment-mode -> production
      const resPostMode = await fetch(`${baseUrl}/api/settings/environment-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'production' })
      });
      const dataPostMode = await resPostMode.json();
      assert.strictEqual(dataPostMode.success, true);
      assert.strictEqual(dataPostMode.mode, 'production');
      assert.strictEqual(dataPostMode.isProduction, true);
      assert.strictEqual(models.getEnvironmentMode(), 'production');
      console.log('  ✅ [PASS] POST /api/settings/environment-mode alternou com sucesso para Produção');

      // 5.3 GET /api/settings retorna ENVIRONMENT_MODE e isProduction
      const resGetSettings = await fetch(`${baseUrl}/api/settings`);
      const dataSettings = await resGetSettings.json();
      assert.strictEqual(dataSettings.ENVIRONMENT_MODE, 'production');
      assert.strictEqual(dataSettings.isProduction, true);
      assert.strictEqual(dataSettings.PIX_SIMULATION_MODE, 'false');
      assert.strictEqual(dataSettings.BINANCE_SIMULATION_MODE, 'false');
      console.log('  ✅ [PASS] GET /api/settings reflete ENVIRONMENT_MODE e flags de produção');

      // 5.4 POST /api/settings/environment-mode -> sandbox
      const resPostBack = await fetch(`${baseUrl}/api/settings/environment-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'sandbox' })
      });
      const dataPostBack = await resPostBack.json();
      assert.strictEqual(dataPostBack.success, true);
      assert.strictEqual(dataPostBack.mode, 'sandbox');
      assert.strictEqual(models.getEnvironmentMode(), 'sandbox');
      console.log('  ✅ [PASS] POST /api/settings/environment-mode alternou de volta para Sandbox');

    } finally {
      await new Promise(resolve => testServer.close(resolve));
    }

    console.log('\n====================================================');
    console.log('🎉 TODOS OS TESTES DE AMBIENTE SANDBOX/PRODUÇÃO PASSARAM!');
    console.log('====================================================\n');

  } finally {
    // Restaura configurações originais
    models.setSetting('ENVIRONMENT_MODE', originalEnvMode);
    models.setSetting('PIX_SIMULATION_MODE', originalPixSim);
    models.setSetting('BINANCE_SIMULATION_MODE', originalBnbSim);
    models.setSetting('BACEN_PIX_SANDBOX', originalBacenSandbox);
  }
}

runTests().catch(err => {
  console.error('❌ FALHA NO TESTE:', err);
  process.exit(1);
});

const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const licenseGuardService = require('./src/services/licenseGuardService');
const paymentSplitService = require('./src/services/paymentSplitService');

async function runDrmAndSplitSuite() {
  console.log('🛡️ Iniciando Bateria de Testes: DRM Anti-Clonagem & Split de Pagamentos (Opções 3 e 4)...\n');

  // =========================================================================
  // TESTE 1: Geração de HWID e Assinatura Digital HMAC-SHA256
  // =========================================================================
  console.log('--- TESTE 1: Hardware ID (HWID) & Assinatura Criptográfica ---');
  const hwid = licenseGuardService.getHwid();
  assert.ok(hwid && hwid.length === 32, 'HWID deve ser um hash de 32 caracteres');
  console.log(`✅ HWID único da máquina: ${hwid}`);

  const testPayload = { license_key: 'SAAS-PRO-TEST-9999', plan: 'pro', status: 'AUTHORIZED' };
  const signature = licenseGuardService.signPayload(testPayload);
  assert.ok(signature && signature.length === 64, 'Assinatura HMAC-SHA256 deve ter 64 caracteres hex');
  assert.strictEqual(licenseGuardService.verifySignature(testPayload, signature), true, 'Assinatura legítima deve ser validada');
  assert.strictEqual(licenseGuardService.verifySignature({ ...testPayload, plan: 'enterprise' }, signature), false, 'Assinatura adulterada deve ser rejeitada');
  console.log('✅ Assinatura HMAC-SHA256 anti-tamper validada com sucesso.');

  // =========================================================================
  // TESTE 2: Validador Remoto de Licença (Autorização vs Bloqueio)
  // =========================================================================
  console.log('\n--- TESTE 2: Validador Mestre de Licença (Autorização vs Bloqueio) ---');
  
  // 2.1 Teste com chave inexistente / falsa (Alguém que clonou o repo e inventou uma chave)
  const fakeCheck = licenseGuardService.verifyRemoteClientLicense({
    license_key: 'CLONE-PIRATA-1234',
    hwid: 'HWID-CLONE-HACKER',
    version: '1.0.0'
  });
  assert.strictEqual(fakeCheck.authorized, false, 'Chave falsa deve ser desautorizada');
  assert.strictEqual(fakeCheck.lockdown, true, 'Instalação com chave falsa deve entrar em lockdown');
  assert.strictEqual(fakeCheck.status, 'UNREGISTERED', 'Status deve ser UNREGISTERED');
  console.log('✅ Cópias piratas/clonadas sem licença são bloqueadas imediatamente (Lockdown ativado).');

  // 2.2 Teste com chave legítima de um Tenant ativo
  const anyActiveTenant = db.prepare("SELECT * FROM saas_tenants WHERE status = 'ACTIVE' LIMIT 1").get();
  assert.ok(anyActiveTenant, 'Deve existir pelo menos um tenant ativo');

  const legitCheck = licenseGuardService.verifyRemoteClientLicense({
    license_key: anyActiveTenant.license_key,
    hwid,
    version: '1.0.0'
  });
  assert.strictEqual(legitCheck.authorized, true, 'Licença ativa deve ser autorizada');
  assert.strictEqual(legitCheck.lockdown, false, 'Licença ativa não deve entrar em lockdown');
  assert.ok(legitCheck.signature, 'Resposta do servidor mestre deve conter assinatura HMAC');
  console.log(`✅ Licença legítima [${anyActiveTenant.license_key}] autorizada com sucesso (${legitCheck.plan}).`);

  // 2.3 Teste do Interceptor de Mensagens do WhatsApp
  const warningMsg = licenseGuardService.interceptMessageIfLocked('5511999998888');
  // Se não estiver em lockdown, deve retornar null
  if (!licenseGuardService.isExecutionLocked()) {
    assert.strictEqual(warningMsg, null, 'Com licença ativa, interceptor não deve bloquear mensagens');
  }
  console.log('✅ Interceptor de execução operacional.');

  // =========================================================================
  // TESTE 3: Cálculo de Split de Pagamento & Take-Rate
  // =========================================================================
  console.log('\n--- TESTE 3: Motor Matemático de Split (Taxas por Plano) ---');
  const starterRate = paymentSplitService.getTakeRatePercent(null); // Padrão
  assert.ok(starterRate >= 2.0 && starterRate <= 5.0, 'Taxa padrão deve estar entre 2% e 5%');

  const split100 = paymentSplitService.calculateSplit({
    grossAmount: 100.00,
    customRate: 3.5
  });
  assert.strictEqual(split100.gross_amount, 100.00);
  assert.strictEqual(split100.platform_fee_amount, 3.50, 'Taxa de 3.5% sobre R$ 100 deve ser R$ 3,50');
  assert.strictEqual(split100.merchant_net_amount, 96.50, 'Líquido do lojista deve ser R$ 96,50');
  console.log(`✅ Split de R$ 100,00 calculado: R$ 3,50 para o Dono do SaaS | R$ 96,50 para o Lojista.`);

  const split500 = paymentSplitService.calculateSplit({
    grossAmount: 500.00,
    customRate: 2.5
  });
  assert.strictEqual(split500.platform_fee_amount, 12.50, 'Taxa de 2.5% sobre R$ 500 deve ser R$ 12,50');
  assert.strictEqual(split500.merchant_net_amount, 487.50, 'Líquido do lojista deve ser R$ 487,50');
  console.log(`✅ Split de R$ 500,00 calculado: R$ 12,50 para o Dono do SaaS | R$ 487,50 para o Lojista.`);

  // =========================================================================
  // TESTE 4: Registro no Ledger & Persistência Financeira
  // =========================================================================
  console.log('\n--- TESTE 4: Persistência no Ledger Financeiro (Receita Passiva) ---');
  const tradeNo = 'TEST-ORDER-' + Date.now();
  const record = paymentSplitService.recordOrderSplit({
    orderId: 99999,
    merchantTradeNo: tradeNo,
    tenantId: anyActiveTenant.id,
    grossAmount: 250.00,
    customRate: 4.0
  });

  assert.ok(record.id > 0, 'Registro deve ser inserido no platform_fee_ledger com ID');
  assert.strictEqual(record.platform_fee_amount, 10.00, 'Taxa de 4% sobre R$ 250 deve ser R$ 10,00');
  assert.strictEqual(record.merchant_net_amount, 240.00, 'Líquido do lojista deve ser R$ 240,00');

  const stats = paymentSplitService.getSplitFinancialStats();
  assert.ok(stats.total_transactions > 0, 'Total de transações deve ser > 0');
  assert.ok(stats.total_platform_revenue_brl >= 10.00, 'Receita total da plataforma deve acumular as taxas');
  console.log(`✅ Transação registrada no Ledger: ID #${record.id} • R$ ${record.platform_fee_amount.toFixed(2)} retidos para a plataforma.`);
  console.log(`✅ Estatísticas Globais de Split: GMV = R$ ${stats.total_gmv_brl.toFixed(2)} | Lucro Passivo em Taxas = R$ ${stats.total_platform_revenue_brl.toFixed(2)}.`);

  console.log('\n🎉 PARABÉNS! AS OPÇÕES 3 (DRM ANTI-CLONAGEM) E 4 (SPLIT DE PAGAMENTO) FORAM HOMOLOGADAS COM SUCESSO TOTAL!');
}

runDrmAndSplitSuite().catch(err => {
  console.error('\n❌ ERRO NA SUÍTE DRM & SPLIT:', err);
  process.exit(1);
});

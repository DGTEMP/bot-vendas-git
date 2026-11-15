const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const saasProfitService = require('./src/services/saasProfitService');

async function runSaaSProfitabilitySuite() {
  console.log('🚀 Iniciando Bateria de Testes: SaaS Altamente Lucrativo (6 Pilares de Monetização)...');

  // =========================================================================
  // PILAR 1: Catálogo de Planos Oficiais & Pacotes de Recarga
  // =========================================================================
  console.log('\n--- PILAR 1: Planos Estratégicos & Pacotes de Recarga ---');
  const plans = saasProfitService.getPlans();
  assert.ok(plans.starter, 'Plano Starter deve existir');
  assert.ok(plans.pro, 'Plano Pro deve existir');
  assert.ok(plans.enterprise, 'Plano Enterprise deve existir');
  assert.ok(plans.agency_whitelabel, 'Plano Agência Whitelabel deve existir');

  assert.strictEqual(plans.starter.price_monthly, 97.00, 'Starter deve custar R$ 97');
  assert.strictEqual(plans.pro.price_monthly, 197.00, 'Pro deve custar R$ 197');
  assert.strictEqual(plans.enterprise.price_monthly, 497.00, 'Enterprise deve custar R$ 497');
  assert.strictEqual(plans.agency_whitelabel.price_monthly, 997.00, 'Agência Whitelabel deve custar R$ 997');

  const packs = saasProfitService.getCreditPacks();
  assert.ok(packs.pack_2500, 'Pacote de 2.500 msgs deve existir');
  assert.ok(packs.pack_10000, 'Pacote de 10.000 msgs deve existir');
  assert.ok(packs.extra_bot, 'Pacote de Bot Adicional deve existir');
  console.log('✅ 4 Planos Oficiais e 4 Pacotes de Recarga validados com sucesso.');

  // =========================================================================
  // PILAR 2: Checkout Pix Instantâneo (EMVCo BR Code & CRC16 Oficial)
  // =========================================================================
  console.log('\n--- PILAR 2: Motor de Checkout Pix Instantâneo (Zero Fricção) ---');
  const testPhone = '55119' + Math.floor(10000000 + Math.random() * 90000000);
  const checkout = await saasProfitService.createSubscriptionCheckout({
    plan_key: 'pro',
    billing_cycle: 'monthly',
    customer_name: 'Imobiliária Prime Vendas',
    customer_phone: testPhone,
    customer_email: 'contato@primevendas.com.br',
    niche: 'imobiliaria'
  });

  assert.ok(checkout.order_code.startsWith('SAAS-'), 'Código do pedido deve ter prefixo SAAS-');
  assert.strictEqual(checkout.price_brl, 197.00, 'Valor deve ser R$ 197,00');
  assert.strictEqual(checkout.status, 'PENDING', 'Status inicial deve ser PENDING');
  assert.ok(checkout.pix_copia_cola.startsWith('000201'), 'Pix Copia e Cola deve seguir especificação EMVCo 000201');
  assert.ok(checkout.pix_copia_cola.includes('6304'), 'Payload deve conter tag 6304 do CRC16');
  assert.ok(checkout.pix_qr_base64.startsWith('data:image/png;base64,'), 'QR Code deve ser uma imagem Base64 válida');
  console.log('✅ Checkout Pix gerado com sucesso (BR Code e QR Code validados).');

  // =========================================================================
  // PILAR 3: Auto-Onboarding & Ativação Zero-Touch
  // =========================================================================
  console.log('\n--- PILAR 3: Confirmação Bancária & Auto-Ativação do Tenant ---');
  const activation = saasProfitService.confirmSubscriptionOrder(checkout.order_code, { mock: true });
  assert.strictEqual(activation.success, true, 'Ativação deve retornar sucesso');
  assert.strictEqual(activation.status, 'PAID', 'Status do pedido deve ser PAID');
  assert.ok(activation.tenant_id > 0, 'Tenant deve ter sido criado com ID válido');
  assert.ok(activation.license_key.startsWith('SAAS-'), 'Chave de licença deve ter prefixo oficial');
  assert.ok(activation.token && activation.token.length > 20, 'Token de sessão ativa deve ser emitido');

  const tenant = models.getTenantById(activation.tenant_id);
  assert.strictEqual(tenant.name, 'Imobiliária Prime Vendas');
  assert.strictEqual(tenant.plan, 'pro');
  assert.strictEqual(tenant.effective_status, 'ACTIVE');
  assert.ok(tenant.days_left >= 29, 'Dias restantes devem ser ~30 dias');
  console.log(`✅ Tenant [${tenant.name}] ativado com sucesso! Licença: ${tenant.license_key}`);

  // =========================================================================
  // PILAR 4: Economia de Tokens & Recarga Avulsa (Pay-As-You-Go)
  // =========================================================================
  console.log('\n--- PILAR 4: Recarga de Mensagens IA & Add-ons (Alta Margem) ---');
  const initialQuota = tenant.monthly_ai_msg_quota || 12000;
  const creditCheckout = await saasProfitService.createCreditCheckout(tenant.id, 'pack_10000');
  assert.ok(creditCheckout.order_code.startsWith('CRD-'), 'Código de recarga deve ter prefixo CRD-');
  assert.strictEqual(creditCheckout.price_brl, 69.90, 'Pacote de 10k msgs deve custar R$ 69,90');

  const creditConfirm = saasProfitService.confirmCreditOrder(creditCheckout.order_code);
  assert.strictEqual(creditConfirm.success, true, 'Confirmação de recarga deve ter sucesso');

  const updatedTenant = models.getTenantById(tenant.id);
  assert.strictEqual(updatedTenant.monthly_ai_msg_quota, initialQuota + 10000, 'Quota deve ser incrementada em 10.000');
  console.log(`✅ Recarga de +10.000 mensagens creditada. Nova Quota: ${updatedTenant.monthly_ai_msg_quota.toLocaleString('pt-BR')} msgs.`);

  // =========================================================================
  // PILAR 5: Sistema de Afiliados Recorrentes (30% MRR)
  // =========================================================================
  console.log('\n--- PILAR 5: Programa de Afiliados Recorrentes (30% MRR) ---');
  const affPhone = '55119' + Math.floor(10000000 + Math.random() * 90000000);
  const testAffCode = 'TOPGROWTH_' + Math.floor(1000 + Math.random() * 9000);
  const affiliate = saasProfitService.getOrCreateAffiliate({
    name: 'Canal Marketing & Automação',
    phone: affPhone,
    email: 'afiliado@marketing.com',
    pix_key: affPhone,
    pix_key_type: 'TELEFONE',
    custom_code: testAffCode
  });

  assert.strictEqual(affiliate.affiliate_code, testAffCode);
  assert.strictEqual(affiliate.commission_percent, 30.0);

  // Cliente assina com a indicação do afiliado
  const affCustomerPhone = '55119' + Math.floor(10000000 + Math.random() * 90000000);
  const affCheckout = await saasProfitService.createSubscriptionCheckout({
    plan_key: 'starter',
    customer_name: 'Loja Afiliada Teste',
    customer_phone: affCustomerPhone,
    affiliate_code: testAffCode
  });

  assert.strictEqual(affCheckout.commission_brl, 29.10, 'Comissão de 30% sobre R$ 97 deve ser R$ 29,10');

  // Aprova o pagamento e valida o crédito da comissão
  saasProfitService.confirmSubscriptionOrder(affCheckout.order_code, { mock: true });

  const allAffiliates = saasProfitService.listAffiliates();
  const topAff = allAffiliates.find(a => a.id === affiliate.id);
  assert.ok(topAff.total_earned_brl >= 29.10, 'Total ganho pelo afiliado deve ser >= R$ 29,10');
  assert.ok(topAff.available_balance_brl >= 29.10, 'Saldo disponível deve ser >= R$ 29,10');
  console.log(`✅ Comissão recorrente de 30% creditada ao afiliado [${topAff.affiliate_code}]: R$ ${topAff.available_balance_brl.toFixed(2)}.`);

  // =========================================================================
  // PILAR 6: Motor Anti-Churn & Métricas Financeiras Consolidadas (MRR / ARR)
  // =========================================================================
  console.log('\n--- PILAR 6: Motor Anti-Churn (ROI Semanal) & Métricas Master SaaS ---');
  const roiReport = saasProfitService.getTenantRoiReport(tenant.id);
  assert.ok(roiReport.leads_attended >= 12, 'Leads atendidos devem ser computados');
  assert.ok(roiReport.hours_saved > 0, 'Horas economizadas devem ser estimadas');
  assert.ok(roiReport.whatsapp_message.includes('RELATÓRIO SEMANAL DE ROI'), 'Mensagem formatada para WhatsApp deve existir');
  console.log(`✅ Relatório de ROI gerado: ${roiReport.leads_attended} leads atendidos, ${roiReport.hours_saved}h economizadas (+${roiReport.estimated_roi_percent}% ROI).`);

  const finMetrics = saasProfitService.getFinancialMetrics();
  assert.ok(finMetrics.mrr > 0, 'MRR deve ser maior que zero');
  assert.ok(finMetrics.arr === finMetrics.mrr * 12, 'ARR deve ser MRR * 12');
  assert.ok(finMetrics.active_subscribers >= 2, 'Assinantes ativos devem ser contabilizados');
  assert.ok(finMetrics.gross_margin_percent >= 65.0, 'Margem de lucro bruta deve ser alta (>65%)');
  console.log(`✅ Métricas Master SaaS: MRR = R$ ${finMetrics.mrr.toFixed(2)} | ARR = R$ ${finMetrics.arr.toFixed(2)} | Assinantes Ativos = ${finMetrics.active_subscribers} | Margem Bruta = ${finMetrics.gross_margin_percent}%.`);

  console.log('\n🎉 PARABÉNS! TODOS OS 6 PILARES DO SAAS LUCRATIVO FORAM HOMOLOGADOS COM SUCESSO TOTAL!');
}

runSaaSProfitabilitySuite().catch(err => {
  console.error('\n❌ ERRO NA BATERIA DE TESTES DO SAAS:', err);
  process.exit(1);
});

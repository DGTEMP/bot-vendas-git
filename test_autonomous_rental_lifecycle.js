/**
 * =========================================================================
 * 🧪 SUÍTE DE TESTES: GESTÃO AUTÔNOMA DE ALUGUEL, CHAVES, COBRANÇA E RENOVAÇÃO
 * =========================================================================
 * 1. Planos de Aluguel Comerciais (Semanal, Mensal, Trimestral, Vitalício)
 * 2. Geração Autônoma de Cobrança Pix e Pedido no Banco (!alugar <plano>)
 * 3. Ativação Automática (Zero-Touch) via Pagamento / Fulfillment
 * 4. Acúmulo de Dias na Renovação (Extensão da data atual sem perdas)
 * 5. Ciclo de Avisos e Cobrança com Pix no Cron:
 *    - 72h antes (3 dias): Aviso preventivo com Pix Copia e Cola
 *    - 24h antes: Alerta urgente com Pix Copia e Cola
 *    - Vencimento: Notificação de pausa com 12h de tolerância
 *    - 12h após vencido (Grace Period): Despedida e Auto-Saída (groupLeave)
 * 6. Comandos no Handler: !alugar, !tempoaluguel, !gerarkey, !listarkeys, !modoglobal, !checkrentals
 * =========================================================================
 */

process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const handler = require('./src/handler');
const groupRental = require('./src/services/groupRentalService');
const fulfillment = require('./src/services/fulfillment');
const models = require('./src/db/models');
const db = require('./src/db/database');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🤖 INICIANDO TESTES DO GERENCIADOR AUTÔNOMO DE ALUGUEL 🤖');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // BLOCO 1: PLANOS COMERCIAIS E CONSULTA
  // ----------------------------------------------------------------
  console.log('--- 1. Planos de Aluguel Oficiais ---');
  const plans = groupRental.getRentalPlans();
  assert(Array.isArray(plans) && plans.length === 4, '4 planos oficiais configurados');
  assert(plans.some(p => p.days === 7 && p.price === 14.90), 'Plano Semanal (7 dias - R$ 14,90) presente');
  assert(plans.some(p => p.days === 30 && p.price === 49.90), 'Plano Mensal (30 dias - R$ 49,90) presente');
  assert(plans.some(p => p.days === 90 && p.price === 129.90), 'Plano Trimestral (90 dias - R$ 129,90) presente');
  assert(plans.some(p => p.days === -1 && p.price === 299.00), 'Plano Vitalício (-1 permanente - R$ 299,00) presente');

  // ----------------------------------------------------------------
  // BLOCO 2: GERAÇÃO AUTÔNOMA DE PIX (!alugar)
  // ----------------------------------------------------------------
  console.log('\n--- 2. Geração Autônoma de Cobrança Pix ---');
  db.prepare('DELETE FROM group_rentals WHERE group_jid = ?').run('12036399999999@g.us');
  const charge = await groupRental.generateRentalPixCharge({
    durationDays: 30,
    payerPhone: '554884702848',
    payerName: 'Dono Teste',
    targetGroupJid: '12036399999999@g.us'
  });

  assert(charge.success === true, 'generateRentalPixCharge gerou cobrança com sucesso');
  assert(charge.amount === 49.90, 'Valor da cobrança mensal correto (R$ 49,90)');
  assert(charge.tradeNo && charge.tradeNo.startsWith('ORD_RENT_'), 'TradeNo gerado no formato ORD_RENT_...');
  assert(charge.pixCode && charge.pixCode.length > 20, 'Pix Copia e Cola válido gerado');

  const pendingOrder = models.getOrderByTradeNo(charge.tradeNo);
  assert(pendingOrder && pendingOrder.status === 'PENDING', 'Pedido PENDING registrado no banco SQLite');
  assert(pendingOrder.platform_user_id === '12036399999999@g.us', 'ID do grupo registrado no pedido para ativação direta');

  // ----------------------------------------------------------------
  // BLOCO 3: ATIVAÇÃO AUTOMÁTICA VIA FULFILLMENT (ZERO-TOUCH)
  // ----------------------------------------------------------------
  console.log('\n--- 3. Ativação Automática no Pagamento (Fulfillment) ---');
  let groupAnnouncementSent = '';
  fulfillment.registerWhatsAppBot({
    sendMessage: async (jid, content) => {
      const text = typeof content === 'string' ? content : (content?.text || '');
      if (text.includes('ALUGUEL') || text.includes('PAGAMENTO CONFIRMADO')) {
        groupAnnouncementSent = text;
      }
      return true;
    }
  });

  const fulfillRes = await fulfillment.fulfillOrder(charge.tradeNo);
  assert(fulfillRes.success === true, 'fulfillOrder processou pagamento de aluguel com sucesso');

  const activatedRental = models.getGroupRental('12036399999999@g.us');
  assert(activatedRental.active === true, 'Aluguel do grupo ativado automaticamente no banco');
  assert(activatedRental.days_left >= 29 && activatedRental.days_left <= 31, 'Dias restantes apurados em ~30 dias');
  assert(groupAnnouncementSent.includes('PAGAMENTO CONFIRMADO') && (groupAnnouncementSent.includes('ALUGUEL ATIVADO') || groupAnnouncementSent.includes('SEU BOT ESTÁ LIBERADO')), 'Mensagem de confirmação enviada para o grupo');

  // ----------------------------------------------------------------
  // BLOCO 4: RENOVAÇÃO INTELIGENTE COM PRESERVAÇÃO DE DIAS
  // ----------------------------------------------------------------
  console.log('\n--- 4. Renovação com Acúmulo de Dias ---');
  // Simula renovação antecipada de mais 30 dias
  const beforeRenew = models.getGroupRental('12036399999999@g.us');
  const daysBefore = beforeRenew.days_left;

  models.setGroupRental('12036399999999@g.us', 30, { payer_name: 'Renovador' });
  const afterRenew = models.getGroupRental('12036399999999@g.us');
  assert(afterRenew.days_left >= daysBefore + 29, `Dias acumulados corretamente (Antes: ${daysBefore}, Depois: ${afterRenew.days_left})`);

  // ----------------------------------------------------------------
  // BLOCO 5: CICLO AUTÔNOMO DE AVISOS E COBRANÇAS (CRON WORKER)
  // ----------------------------------------------------------------
  console.log('\n--- 5. Ciclo de Avisos e Cobrança no Cron (72h, 24h, Expirado, Saída) ---');

  // Configura Grupo A: Vence em 2 dias (deve disparar aviso de 72h com Pix)
  const exp72h = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO group_rentals (group_jid, group_name, expires_at, status, notified_72h, notified_24h, left_group)
    VALUES (?, ?, ?, 'active', 0, 0, 0)
    ON CONFLICT(group_jid) DO UPDATE SET expires_at = excluded.expires_at, status = 'active', notified_72h = 0, notified_24h = 0, left_group = 0
  `).run('grupo_72h@g.us', 'Grupo Teste 72h', exp72h);

  // Configura Grupo B: Vence em 18 horas (deve disparar aviso urgente de 24h)
  const exp24h = new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO group_rentals (group_jid, group_name, expires_at, status, notified_72h, notified_24h, left_group)
    VALUES (?, ?, ?, 'active', 1, 0, 0)
    ON CONFLICT(group_jid) DO UPDATE SET expires_at = excluded.expires_at, status = 'active', notified_72h = 1, notified_24h = 0, left_group = 0
  `).run('grupo_24h@g.us', 'Grupo Teste 24h', exp24h);

  // Configura Grupo C: Já venceu há 2 horas (deve pausar funções e avisar tolerância de 12h)
  const expNow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO group_rentals (group_jid, group_name, expires_at, status, notified_72h, notified_24h, left_group)
    VALUES (?, ?, ?, 'active', 1, 1, 0)
    ON CONFLICT(group_jid) DO UPDATE SET expires_at = excluded.expires_at, status = 'active', notified_72h = 1, notified_24h = 1, left_group = 0
  `).run('grupo_expired@g.us', 'Grupo Teste Expirado', expNow);

  // Configura Grupo D: Venceu há 15 horas (passou da tolerância de 12h -> groupLeave)
  const expPastGrace = new Date(Date.now() - 15 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO group_rentals (group_jid, group_name, expires_at, status, notified_72h, notified_24h, left_group)
    VALUES (?, ?, ?, 'expired', 1, 1, 0)
    ON CONFLICT(group_jid) DO UPDATE SET expires_at = excluded.expires_at, status = 'expired', notified_72h = 1, notified_24h = 1, left_group = 0
  `).run('grupo_leave@g.us', 'Grupo Teste Grace', expPastGrace);

  let leftGroupJid = '';
  const sentMessages = {};
  const mockSockCron = {
    sendMessage: async (jid, payload) => {
      sentMessages[jid] = payload.text;
      return true;
    },
    groupLeave: async (jid) => {
      leftGroupJid = jid;
      return true;
    }
  };

  const cronResults = await groupRental.checkExpiringRentals(mockSockCron);

  assert(cronResults.warned_72h.includes('grupo_72h@g.us'), 'Grupo 72h alertado com sucesso');
  assert(sentMessages['grupo_72h@g.us'] && sentMessages['grupo_72h@g.us'].includes('Pix Copia e Cola de Renovação'), 'Aviso de 72h contém Pix Copia e Cola de renovação');

  assert(cronResults.warned_24h.includes('grupo_24h@g.us'), 'Grupo 24h alertado com alerta urgente');
  assert(cronResults.expired.includes('grupo_expired@g.us'), 'Grupo vencido marcado como expirado e notificado');
  assert(cronResults.left_group.includes('grupo_leave@g.us'), 'Grupo com tolerância esgotada adicionado em left_group');
  assert(leftGroupJid === 'grupo_leave@g.us', 'sock.groupLeave invocado com sucesso para saída automática');

  // ----------------------------------------------------------------
  // BLOCO 6: COMANDOS DO HANDLER
  // ----------------------------------------------------------------
  console.log('\n--- 6. Comandos Nativos de Aluguel no Handler ---');
  assert(handler.findCommand('alugar'), 'Comando !alugar registrado');
  assert(handler.findCommand('planos'), 'Alias !planos registrado');
  assert(handler.findCommand('tempoaluguel'), 'Comando !tempoaluguel registrado');
  assert(handler.findCommand('gerarkey'), 'Comando !gerarkey registrado');
  assert(handler.findCommand('listarkeys'), 'Comando !listarkeys registrado');
  assert(handler.findCommand('modoglobal'), 'Comando !modoglobal registrado');
  assert(handler.findCommand('checkrentals'), 'Comando !checkrentals registrado');

  // Teste !alugar sem args (mostra planos)
  let replyText = '';
  const mockMsgUser = {
    chat: '12036399999999@g.us',
    sender: '554884702848@s.whatsapp.net',
    senderNumber: '554884702848',
    pushName: 'Admin Grupo',
    isGroup: true,
    react: async () => true,
    reply: (txt) => { replyText = txt; return true; }
  };
  const alugarCmd = handler.findCommand('alugar');
  await alugarCmd.run(mockMsgUser, { conn: mockSockCron, args: [], usedPrefix: '!' });
  assert(replyText.includes('PLANOS DE ALUGUEL DO PAYBOT') && replyText.includes('Plano Mensal (30 dias)'), '!alugar sem argumentos exibe tabela comparativa de planos');

  // Teste !alugar 30 (gera Pix na hora)
  let sentImageCaption = '';
  const mockConnWithImage = {
    sendMessage: async (jid, payload) => {
      if (payload.image && payload.caption) sentImageCaption = payload.caption;
      return true;
    }
  };
  await alugarCmd.run(mockMsgUser, { conn: mockConnWithImage, args: ['30'], usedPrefix: '!' });
  assert(sentImageCaption.includes('COBRANÇA PIX GERADA COM SUCESSO') && sentImageCaption.includes('Pix Copia e Cola'), '!alugar 30 gera Pix Copia e Cola com QR Code');

  // Teste !tempoaluguel
  const tempoInfo = groupRental.formatRentalInfo('12036399999999@g.us');
  assert(tempoInfo.includes('STATUS DO ALUGUEL DO BOT') && tempoInfo.includes('Aluguel Ativo'), 'formatRentalInfo formata status com clareza');

  // Teste !gerarkey (Dono)
  const gerarkeyCmd = handler.findCommand('gerarkey');
  assert(gerarkeyCmd.owner === true, '!gerarkey restrito ao Dono');
  await gerarkeyCmd.run(mockMsgUser, { args: ['30'], usedPrefix: '!' });
  assert(replyText.includes('NOVA CHAVE DE ATIVAÇÃO GERADA') && replyText.includes('30 dias'), '!gerarkey gera código manual com sucesso');

  // Teste !modoglobal (Dono)
  const modoglobalCmd = handler.findCommand('modoglobal');
  assert(modoglobalCmd.owner === true, '!modoglobal restrito ao Dono');
  await modoglobalCmd.run(mockMsgUser, { args: ['on'], usedPrefix: '!' });
  assert(groupRental.isGlobalModeActive() === true, '!modoglobal on ativa restrição global');
  await modoglobalCmd.run(mockMsgUser, { args: ['off'], usedPrefix: '!' });
  assert(groupRental.isGlobalModeActive() === false, '!modoglobal off desativa restrição global');

  // ----------------------------------------------------------------
  // RELATÓRIO FINAL
  // ----------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} APROVADOS!`);
  console.log('======================================================\n');
  if (passedTests === totalTests) {
    console.log('🎉 SISTEMA AUTÔNOMO DE ALUGUEL E COBRANÇAS HOMOLOGADO COM 100% DE SUCESSO!\n');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const subbotTokenService = require('./src/services/subbotTokenService');

async function runTests() {
  console.log('=============================================================');
  console.log('🧪 TESTES: TETO DE 50 TOKENS & REPOSIÇÃO EM 24H (SUB-BOT FREE)');
  console.log('=============================================================');

  // Cria um sub-bot de teste dedicado
  const testBot = models.createArmyInstance({
    name: 'Sub-Bot Teste 24h Replenish',
    phone: '5511999990001',
    daily_limit: 50,
    tokens_balance: 50,
    tokens_daily_base: 50,
    is_subbot: 1,
    terms_accepted: 1
  });

  const botId = testBot.id;
  console.log(`📌 Criado Sub-Bot #${botId} para os testes.`);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Teto Máximo Inviolável de 50 Tokens na Criação e Atualização
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 1: Teto Máximo Inviolável de 50 Tokens ---');
    assert.strictEqual(testBot.tokens_balance, 50, 'Deve iniciar com exatamente 50 tokens.');

    // Tentativa de injetar 100 tokens via updateArmyInstance
    const updatedOver = models.updateArmyInstance(botId, { tokens_balance: 100 });
    assert.strictEqual(updatedOver.tokens_balance, 50, 'updateArmyInstance deve barrar > 50 tokens e limitar ao teto.');

    // Tentativa de adicionar tokens via addTokens
    const addRes = subbotTokenService.addTokens(botId, 30, 'MANUAL_BONUS', 'Tentativa de estourar teto');
    assert.strictEqual(addRes.newBalance, 50, 'addTokens deve respeitar o teto estrito de 50.');
    const botCheck1 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck1.tokens_balance, 50, 'Saldo no banco deve permanecer em 50.');
    console.log('  ✅ [PASS] 1. Teto de 50 tokens é inviolável contra adições e updates.');

    // -------------------------------------------------------------------------
    // TESTE 2: Consumo de Tokens por Comando
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 2: Consumo de Tokens por Comandos ---');
    // Consome 3 tokens (ex: comando !ia ou !voz)
    const consumeRes = subbotTokenService.consumeTokens(botId, 'ia', 3);
    assert.strictEqual(consumeRes.success, true);
    assert.strictEqual(consumeRes.newBalance, 47, 'Saldo deve cair para 47 após gastar 3 tokens.');
    const botCheck2 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck2.tokens_balance, 47);

    // Consome mais 2 tokens (ex: comando !play)
    subbotTokenService.consumeTokens(botId, 'play', 2);
    const botCheck3 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck3.tokens_balance, 45, 'Saldo deve cair para 45 após gastar mais 2 tokens.');
    console.log('  ✅ [PASS] 2. Tokens consumidos corretamente (saldo 50 -> 47 -> 45).');

    // -------------------------------------------------------------------------
    // TESTE 3: Tokens Usados NÃO são repostos antes de 24h
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 3: Tokens NÃO são repostos antes de 24h ---');
    subbotTokenService.replenishUsedTokens(botId);
    const botCheck4 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck4.tokens_balance, 45, 'Saldo deve continuar 45 pois 24h ainda não passaram.');
    console.log('  ✅ [PASS] 3. Reposição bloqueada antes de completar a janela de 24h.');

    // -------------------------------------------------------------------------
    // TESTE 4: Simulação de Passagem de Tempo (24h para o primeiro consumo de 3 tokens)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 4: Reposição de 3 tokens após 24h ---');
    // Vamos simular que o primeiro consumo de 3 tokens ocorreu há 25 horas
    const logs = models.getPendingReplenishments(botId);
    assert(logs.length >= 2, 'Deve ter pelo menos 2 consumos registrados.');
    
    const firstLog = logs[0]; // Consumo de 3 tokens
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 24h já expirou (disponível há 1h)

    // Simula a data no banco para o primeiro log
    db.prepare('UPDATE subbot_token_logs SET created_at = ?, available_at = ? WHERE id = ?')
      .run(twentyFiveHoursAgo, oneHourAgo, firstLog.id);

    // Executa a reposição contínua
    subbotTokenService.replenishUsedTokens(botId);

    const botCheck5 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck5.tokens_balance, 48, 'Saldo deve subir de 45 para 48 (+3 tokens repostos).');

    // Verifica que o primeiro log foi marcado como replenished = 1
    const repCheck = db.prepare('SELECT replenished FROM subbot_token_logs WHERE id = ?').get(firstLog.id);
    assert.strictEqual(repCheck.replenished, 1, 'Primeiro log deve estar marcado como reposto.');
    console.log('  ✅ [PASS] 4. Os 3 tokens usados há 25h foram repostos com precisão (saldo 45 -> 48).');

    // -------------------------------------------------------------------------
    // TESTE 5: Reposição do segundo consumo após suas 24h
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 5: Reposição do segundo consumo (2 tokens) após 24h ---');
    const remainingPending = models.getPendingReplenishments(botId);
    assert.strictEqual(remainingPending.length, 1, 'Deve restar exatamente 1 consumo pendente.');
    const secondLog = remainingPending[0];

    // Simula que o segundo consumo também completou 24h
    db.prepare('UPDATE subbot_token_logs SET created_at = ?, available_at = ? WHERE id = ?')
      .run(twentyFiveHoursAgo, oneHourAgo, secondLog.id);

    subbotTokenService.replenishUsedTokens(botId);

    const botCheck6 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck6.tokens_balance, 50, 'Saldo deve subir de 48 para 50 (+2 tokens repostos).');
    console.log('  ✅ [PASS] 5. Segundo lote de tokens reposto após 24h, atingindo os 50 tokens.');

    // -------------------------------------------------------------------------
    // TESTE 6: Reposição NUNCA ultrapassa o teto de 50 tokens
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 6: Reposição nunca ultrapassa o teto de 50 tokens ---');
    // Simula que o usuário gastou 10 tokens
    subbotTokenService.consumeTokens(botId, 'gemini', 10);
    const botCheck7 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck7.tokens_balance, 40, 'Saldo deve ser 40.');

    // Suponha que o usuário ganhou um bônus de 8 tokens, subindo para 48
    subbotTokenService.addTokens(botId, 8, 'BONUS_DAILY_SHARE', 'Bônus de missão');
    const botCheck8 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck8.tokens_balance, 48, 'Saldo deve ser 48.');

    // Agora os 10 tokens gastos anteriormente chegam para ser repostos após 24h
    // Como a capacidade restante até o teto é de apenas 2 tokens (50 - 48 = 2),
    // a reposição deve adicionar apenas 2 tokens e parar rigorosamente em 50!
    const pending10 = models.getPendingReplenishments(botId);
    assert.strictEqual(pending10.length, 1);
    db.prepare('UPDATE subbot_token_logs SET created_at = ?, available_at = ? WHERE id = ?')
      .run(twentyFiveHoursAgo, oneHourAgo, pending10[0].id);

    subbotTokenService.replenishUsedTokens(botId);
    const botCheck9 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck9.tokens_balance, 50, 'Saldo DEVE parar estritamente em 50 (nunca 58).');
    console.log('  ✅ [PASS] 6. Reposição limitada rigorosamente ao teto de 50 tokens.');

    // -------------------------------------------------------------------------
    // TESTE 7: Relatório do Painel de Tokens (!tokens / !saldo)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 7: Relatório de Tokens exibe Teto e Reposição 24h ---');
    // Gasta 5 tokens para ter reposição pendente no relatório
    subbotTokenService.consumeTokens(botId, 'ia', 5);
    const reportWithPending = subbotTokenService.getTokensStatusReport(botId);
    assert(reportWithPending.includes('45 / 50 Tokens'), 'Deve exibir 45 / 50 Tokens.');
    assert(reportWithPending.includes('Teto Máximo Diário:* 50 Tokens (Inviolável)'), 'Deve citar teto inviolável.');
    assert(reportWithPending.includes('Cada token usado é reposto em 24h'), 'Deve citar regra de 24h.');
    assert(reportWithPending.includes('5 token(s) gastos'), 'Deve indicar 5 tokens em reposição.');
    assert(reportWithPending.includes('Próxima Reposição:'), 'Deve indicar tempo para próxima reposição.');
    console.log('  ✅ [PASS] 7. Relatório de status exibe teto de 50, tokens em recuperação e timer 24h.');

    // -------------------------------------------------------------------------
    // TESTE 8: ensureDailyReset preserva ciclo de 24h e não zera arbitrariamente
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 8: ensureDailyReset respeita os tokens em recuperação ---');
    // Simula a virada do dia para testar o reset diário
    db.prepare('UPDATE whatsapp_army_instances SET last_token_reset = ? WHERE id = ?').run('2020-01-01', botId);
    subbotTokenService.ensureDailyReset(botId);
    const botCheck10 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck10.tokens_balance, 45, 'Saldo não deve ser artificialmente forçado para 50 no midnight se os tokens ainda estão no ciclo 24h.');
    console.log('  ✅ [PASS] 8. Virada de dia respeita a janela de 24h de cada token usado.');

    // -------------------------------------------------------------------------
    // TESTE 9: Varredura Periódica Global (replenishAllActiveSubBots)
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 9: Varredura Global de Sub-Bots Ativos ---');
    // Vence o tempo dos 5 tokens restantes
    const pending5 = models.getPendingReplenishments(botId);
    assert.strictEqual(pending5.length, 1);
    db.prepare('UPDATE subbot_token_logs SET created_at = ?, available_at = ? WHERE id = ?')
      .run(twentyFiveHoursAgo, oneHourAgo, pending5[0].id);

    subbotTokenService.replenishAllActiveSubBots();
    const botCheck11 = models.getArmyInstanceById(botId);
    assert.strictEqual(botCheck11.tokens_balance, 50, 'Varredura global deve restaurar o saldo para 50.');
    console.log('  ✅ [PASS] 9. replenishAllActiveSubBots repõe tokens de todos os sub-bots com precisão.');

    // -------------------------------------------------------------------------
    // TESTE 10: Bloqueio amigável ao esgotar tokens e reativação após 24h
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 10: Bloqueio ao esgotar tokens e liberação após 24h ---');
    // Gasta todos os 50 tokens
    subbotTokenService.consumeTokens(botId, 'maratona', 50);
    const checkEmpty = subbotTokenService.checkCommandAllowance(botId, '!ia teste');
    assert.strictEqual(checkEmpty.allowed, false, 'Comando pago deve ser bloqueado quando saldo for 0.');
    assert(checkEmpty.message.includes('SEUS TOKENS DIÁRIOS ESGOTARAM'), 'Deve conter mensagem persuasiva.');

    // Comandos gratuitos continuam funcionando
    const checkFree = subbotTokenService.checkCommandAllowance(botId, '!tokens');
    assert.strictEqual(checkFree.allowed, true, 'Comandos de custo zero continuam liberados.');

    // Reposição de 24h ocorre para 1 token
    const allPending = models.getPendingReplenishments(botId);
    const lastPending = allPending[allPending.length - 1];
    db.prepare('UPDATE subbot_token_logs SET created_at = ?, available_at = ? WHERE id = ?')
      .run(twentyFiveHoursAgo, oneHourAgo, lastPending.id);

    subbotTokenService.replenishUsedTokens(botId);
    const checkRestored = subbotTokenService.checkCommandAllowance(botId, '!figu');
    assert.strictEqual(checkRestored.allowed, true, 'Comando de 1 token deve ser liberado imediatamente após reposição.');
    console.log('  ✅ [PASS] 10. Bloqueio por falta de saldo e desbloqueio imediato após reposição de 24h.');

    console.log('\n=============================================================');
    console.log('🎉 TODOS OS 10 TESTES DE TETO 50 TOKENS & REPOSIÇÃO 24H PASSARAM 100%!');
    console.log('=============================================================');
  } finally {
    // Limpeza do sub-bot de teste
    models.deleteArmyInstance(botId);
    db.prepare('DELETE FROM subbot_token_logs WHERE instance_id = ?').run(botId);
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});

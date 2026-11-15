/**
 * test_escuta_hybrid_engine.js
 * Teste completo do Motor Híbrido de Escuta, Social Listening, Radar Sentinela, Áudios,
 * Importação em Massa (Texto/Arquivo) e Delegação de Grupos para Sub-Bots Gerentes.
 */

const assert = require('assert');
const models = require('./src/db/models');
const socialListeningService = require('./src/services/socialListeningService');
const groupManagerService = require('./src/services/groupManagerService');
const matrizAssistantService = require('./src/services/matrizAssistantService');
const handler = require('./src/handler');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('\n=============================================================');
console.log('🎧 TESTES: MOTOR HÍBRIDO !escuta (SOCIAL LISTENING + SENTINELA + ÁUDIO)');
console.log('📦 + IMPORTAÇÃO EM MASSA & DELEGAÇÃO DE SUB-BOTS GERENTES');
console.log('=============================================================\n');

(async () => {
  const testOwnerPhone = '554884702848';
  const testGroupJid = '120363000000000088@g.us';
  const testSenderJid = '5511999993333@s.whatsapp.net';

  // Helper para capturar mensagens enviadas pelo mock sock
  function createMockSock() {
    const sent = [];
    return {
      sent,
      sendMessage: async (jid, content) => {
        sent.push({ jid, content, text: typeof content === 'string' ? content : (content.text || '') });
        return { key: { id: 'MOCK_MSG_' + Date.now() } };
      },
      sendPresenceUpdate: async () => {},
      groupMetadata: async (jid) => ({ subject: 'Grupo VIP Vendas Teste' })
    };
  }

  // TESTE 1: Painel Cockpit sem argumentos (!escuta)
  await itAsync('1. !escuta sem argumentos retorna cockpit completo e status', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta', testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('CENTRAL DE COMANDO DA ESCUTA & SENTINELA'));
    assert.ok(reply.includes('Motor Global:'));
    assert.ok(reply.includes('Escuta de Áudios (IA):'));
    assert.ok(reply.includes('Radar Sentinela (PV):'));
    assert.ok(reply.includes('!escuta add'));
    assert.ok(reply.includes('!escuta sentinela'));
    assert.ok(reply.includes('!escuta lote'));
  });

  // TESTE 2: Comandos de On/Off e Configuração Global
  await itAsync('2. !escuta on/off alterna status global do motor', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta off', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isEnabled(), false);

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta on', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isEnabled(), true);
  });

  // TESTE 3: Controle de Áudio e Radar Sentinela
  await itAsync('3. !escuta audio on/off e !escuta alerta on/off configuram subsistemas', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta audio off', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isAudioEnabled(), false);

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta audio on', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isAudioEnabled(), true);

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta alerta off', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isAlertEnabled(), false);

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta alerta on', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.isAlertEnabled(), true);
  });

  // TESTE 4: Cooldown entre disparos
  await itAsync('4. !escuta cooldown altera intervalo de proteção anti-spam', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta cooldown 22', testOwnerPhone, true, true);
    assert.strictEqual(socialListeningService.getCooldownMinutes(), 22);
  });

  // TESTE 5: Criação de Regra de Afiliado via Chat (!escuta add)
  let createdAffiliateRuleId = null;
  await itAsync('5. !escuta add cria regra de Social Listening com templates', async () => {
    const sock = createMockSock();
    const cmd = '!escuta add Curso Automação Top | automacao zap, bot vendas curso, bot n8n | https://paybot.store/curso | Esse curso é surreal: {link}';
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', cmd, testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('NOVA REGRA DE SOCIAL LISTENING CADASTRADA'));
    assert.ok(reply.includes('Curso Automação Top'));

    const matchId = reply.match(/#(\d+)/);
    assert.ok(matchId && matchId[1]);
    createdAffiliateRuleId = parseInt(matchId[1], 10);
    const ruleInDb = models.getSocialListeningRule(createdAffiliateRuleId);
    assert.strictEqual(ruleInDb.action_type, 'REPLY');
    assert.strictEqual(ruleInDb.product_name, 'Curso Automação Top');
  });

  // TESTE 6: Criação de Regra Sentinela via Chat (!escuta sentinela)
  let createdSentinelRuleId = null;
  await itAsync('6. !escuta sentinela cria regra de radar com notificação no PV', async () => {
    const sock = createMockSock();
    const cmd = '!escuta sentinela Radar Leads Quentes | quero contratar bot, quanto custa bot, preco do sistema';
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', cmd, testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('NOVA REGRA SENTINELA CADASTRADA'));
    assert.ok(reply.includes('Radar Leads Quentes'));

    const matchId = reply.match(/#(\d+)/);
    assert.ok(matchId && matchId[1]);
    createdSentinelRuleId = parseInt(matchId[1], 10);
    const ruleInDb = models.getSocialListeningRule(createdSentinelRuleId);
    assert.strictEqual(ruleInDb.action_type, 'ALERT');
  });

  // TESTE 7: Detalhes e Toggle de Regra (!escuta ver e !escuta toggle)
  await itAsync('7. !escuta ver e !escuta toggle inspecionam e pausam regra', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', `!escuta ver ${createdSentinelRuleId}`, testOwnerPhone, true, true);
    assert.ok(sock.sent[0].text.includes('DETALHES DA REGRA'));
    assert.ok(sock.sent[0].text.includes('Alerta Sentinela no PV'));

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', `!escuta toggle ${createdSentinelRuleId}`, testOwnerPhone, true, true);
    const pausedRule = models.getSocialListeningRule(createdSentinelRuleId);
    assert.strictEqual(pausedRule.active, 0);

    // Reativa para os próximos testes
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', `!escuta toggle ${createdSentinelRuleId}`, testOwnerPhone, true, true);
    const reactivatedRule = models.getSocialListeningRule(createdSentinelRuleId);
    assert.strictEqual(reactivatedRule.active, 1);
  });

  // TESTE 8: Simulador / Testador de Frases (!escuta teste)
  await itAsync('8. !escuta teste simula gatilhos ao vivo com relatório detalhado', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta teste Alguém sabe onde acho curso automacao zap?', testOwnerPhone, true, true);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('RESULTADO DO TESTE (MATCH ENCONTRADO!)'));
    assert.ok(reply.includes('Curso Automação Top'));
    assert.ok(reply.includes('Recomendação Stealth no Grupo'));
  });

  // TESTE 9: Disparo de Alerta Sentinela no PV do Dono em tempo real
  await itAsync('9. Mensagem de lead no grupo aciona Radar Sentinela e alerta Dono no PV', async () => {
    socialListeningService.resetCooldown();
    const sock = createMockSock();

    const triggerRes = await socialListeningService.handleIncomingGroupMessage(
      sock,
      testGroupJid,
      testSenderJid,
      'Boa tarde pessoal, queria saber o preco do sistema de vocês!',
      false,
      { senderName: 'Marcos Oliveira' }
    );

    assert.ok(triggerRes && triggerRes.triggered);
    assert.strictEqual(triggerRes.alerted, true);

    // Valida que o Dono recebeu o alerta confidencial no PV
    const ownerJid = socialListeningService.getOwnerTargetJid();
    const alertSentToOwner = sock.sent.find(m => m.jid === ownerJid);
    assert.ok(alertSentToOwner, 'Dono deve receber alerta Sentinela no PV');
    assert.ok(alertSentToOwner.text.includes('RADAR SENTINELA / ESCUTA ATIVA'));
    assert.ok(alertSentToOwner.text.includes('Grupo VIP Vendas Teste'));
    assert.ok(alertSentToOwner.text.includes('Marcos Oliveira'));
    assert.ok(alertSentToOwner.text.includes('5511999993333'));
    assert.ok(alertSentToOwner.text.includes('https://wa.me/5511999993333'));
  });

  // TESTE 10: Escuta de Áudios em Grupos (Simulação de transcrição via speechToText)
  await itAsync('10. Áudio com gatilho de escuta no grupo é transcrito e processado', async () => {
    socialListeningService.resetCooldown();
    const sock = createMockSock();

    // Injeta chamada de grupo simulando áudio transcrito
    const audioTriggerRes = await socialListeningService.handleIncomingGroupMessage(
      sock,
      testGroupJid,
      '5521988887777@s.whatsapp.net',
      'Galera estou querendo contratar bot de atendimento com urgência',
      false,
      { isAudio: true, durationSec: 14, senderName: 'Roberta Silva' }
    );

    assert.ok(audioTriggerRes && audioTriggerRes.triggered);
    assert.strictEqual(audioTriggerRes.alerted, true);

    const ownerJid = socialListeningService.getOwnerTargetJid();
    const audioAlert = sock.sent.find(m => m.jid === ownerJid && m.text.includes('Roberta Silva'));
    assert.ok(audioAlert, 'Alerta do áudio deve ser enviado ao Dono');
    assert.ok(audioAlert.text.includes('Áudio de Voz (14s) 🗣️'));
  });

  // TESTE 11: Bloqueio de Usuários Comuns (Segurança)
  await itAsync('11. Usuário comum que não é Dono nem Admin tem acesso negado', async () => {
    const sock = createMockSock();
    await socialListeningService.handleEscutaCommand(sock, '5511999990000@s.whatsapp.net', '!escuta on', '5511999990000', false, false);
    assert.ok(sock.sent[0].text.includes('ACESSO RESTRITO'));
  });

  // TESTE 12: Integração com PayBotHandler (Catálogo Modular)
  await itAsync('12. Comando escuta está registrado no handler mestre com aliases', async () => {
    const cmd = handler.findCommand('escuta');
    assert.ok(cmd, 'Comando escuta deve estar registrado no handler');
    assert.strictEqual(cmd.name, 'escuta');
    assert.ok(cmd.command.includes('sentinela'));
    assert.ok(cmd.command.includes('social'));
  });

  // ==============================================================
  // BLOCO NOVO: ADIÇÃO EM MASSA (LOTE, ARQUIVO E RESPOSTA)
  // ==============================================================
  console.log('\n--- Testes de Adição de Regras em Massa ---');

  // TESTE 13: Importação em Massa por Texto Multilinhas
  await itAsync('13. !escuta lote importa múltiplas regras por texto (uma por linha)', async () => {
    const sock = createMockSock();
    const multilineCmd =
      `!escuta lote\n` +
      `Fone Bluetooth Pro | fone bluetooth, fone sem fio, airdots | https://shopee.com/fone | Comprei esse fone e a bateria dura muito: {link}\n` +
      `Smartwatch Ultra | smartwatch, relogio inteligente | https://shopee.com/relogio | Uso esse relógio todo dia: {link}\n` +
      `[sentinela] Reclamações e Procon | reclame aqui, procon, calote, golpe no pix\n` +
      `Mochila Impermeável;mochila,mochila notebook;https://shopee.com/mochila;Essa mochila é resistente: {link}`;

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', multilineCmd, testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('IMPORTAÇÃO EM MASSA CONCLUÍDA'));
    assert.ok(reply.includes('Regras Cadastradas com Sucesso: 🟢 *4*'));
    assert.ok(reply.includes('Afiliados (Stealth): *3*'));
    assert.ok(reply.includes('Sentinela (Alertas PV): *1*'));
  });

  // TESTE 14: Importação em Massa enviando Arquivo em Buffer simulado
  await itAsync('14. !escuta lote com arquivo em anexo (buffer de documento)', async () => {
    const sock = createMockSock();
    const fileContent =
      `Camera Segurança WiFi | camera wifi, camera seguranca | https://shopee.com/camera | Instalei em casa e é top: {link}\n` +
      `Teclado Mecânico RGB | teclado mecanico, teclado gamer | https://shopee.com/teclado | Teclas macias demais: {link}`;

    const mockMsgWithFile = {
      message: {
        documentMessage: {
          mimetype: 'text/plain',
          fileName: 'regras_produtos.txt'
        }
      },
      download: async () => Buffer.from(fileContent, 'utf-8')
    };

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta lote', testOwnerPhone, true, true, mockMsgWithFile);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('IMPORTAÇÃO EM MASSA CONCLUÍDA'));
    assert.ok(reply.includes('Regras Cadastradas com Sucesso: 🟢 *2*'));
    assert.ok(reply.includes('Afiliados (Stealth): *2*'));
  });

  // TESTE 15: Importação em Massa respondendo a uma mensagem no chat
  await itAsync('15. !escuta lote respondendo (citando) uma lista de regras', async () => {
    const sock = createMockSock();
    const quotedList =
      `Ring Light LED | ring light, iluminacao video | https://shopee.com/ringlight | Meus vídeos melhoraram 100%: {link}\n` +
      `[sentinela] Dúvidas sobre PIX | chave pix, comprovante pix, pix demorando`;

    const mockMsgWithQuote = {
      quoted: {
        text: quotedList
      }
    };

    await socialListeningService.handleEscutaCommand(sock, testOwnerPhone + '@s.whatsapp.net', '!escuta lote', testOwnerPhone, true, true, mockMsgWithQuote);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('IMPORTAÇÃO EM MASSA CONCLUÍDA'));
    assert.ok(reply.includes('Regras Cadastradas com Sucesso: 🟢 *2*'));
    assert.ok(reply.includes('Afiliados (Stealth): *1*'));
    assert.ok(reply.includes('Sentinela (Alertas PV): *1*'));
  });

  // ==============================================================
  // BLOCO NOVO: DELEGAÇÃO DE GRUPO PARA SUB-BOT GERENTE
  // ==============================================================
  console.log('\n--- Testes de Delegação de Grupo para Sub-Bot Gerente ---');

  // Garante que existe pelo menos uma instância de Sub-Bot para o teste
  const instances = models.getArmyInstances();
  let testSubBotId = 1;
  if (!instances || instances.length === 0) {
    const created = models.createArmyInstance({
      name: 'Sub-Bot Gerente Alfa',
      phone: '5511988887777',
      session_id: 'test_subbot_mgr_' + Date.now(),
      status: 'CONNECTED',
      daily_limit: 100,
      is_main: 0,
      active: 1
    });
    testSubBotId = created.id;
  } else {
    testSubBotId = instances[0].id;
  }

  // TESTE 16: Delegação de Grupo via comando !gerente <id>
  await itAsync('16. !gerente <id> nomeia Sub-Bot como gerente oficial do grupo', async () => {
    const sock = createMockSock();
    await groupManagerService.handleGerenteCommand(sock, testGroupJid, `!gerente ${testSubBotId}`, testOwnerPhone, true, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('DESIGNADO COMO GERENTE OFICIAL'));
    assert.ok(reply.toLowerCase().includes(`sub-bot #${testSubBotId}`.toLowerCase()));

    const manager = models.getGroupManager(testGroupJid);
    assert.ok(manager);
    assert.strictEqual(Number(manager.instance_id), Number(testSubBotId));
  });

  // TESTE 17: Consulta de status do gerente (!gerente no grupo)
  await itAsync('17. !gerente sem argumentos dentro do grupo exibe o gerente atual', async () => {
    const sock = createMockSock();
    await groupManagerService.handleGerenteCommand(sock, testGroupJid, '!gerente', testOwnerPhone, true, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('SUB-BOT GERENTE DESTE GRUPO'));
    assert.ok(reply.includes(`Sub-Bot #${testSubBotId}`));
  });

  // TESTE 18: Delegação em linguagem natural via MatrizAssistantService
  await itAsync('18. Dono pode delegar grupo em linguagem natural para a Matriz', async () => {
    const sock = createMockSock();
    await matrizAssistantService.handleOwnerConversation(sock, testGroupJid, `delegar este grupo para o subbot ${testSubBotId}`, 'Comandante', testOwnerPhone, true);
    assert.ok(sock.sent.length >= 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('DESIGNADO COMO GERENTE OFICIAL'));
  });

  // TESTE 19: Remoção do Sub-Bot Gerente e Restauração para a Matriz
  await itAsync('19. !gerente remover desvincula o sub-bot e devolve a gerência à Matriz', async () => {
    const sock = createMockSock();
    await groupManagerService.handleGerenteCommand(sock, testGroupJid, '!gerente remover', testOwnerPhone, true, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('GERÊNCIA DO GRUPO RESTAURADA PARA A MATRIZ'));

    const managerAfter = models.getGroupManager(testGroupJid);
    assert.strictEqual(managerAfter, null);
  });

  // TESTE 20: Registro do comando !gerente no handler
  it('20. Comando gerente está registrado no PayBotHandler mestre', () => {
    const cmd = handler.findCommand('gerente');
    assert.ok(cmd, 'Comando gerente deve estar registrado no handler');
    assert.strictEqual(cmd.name, 'gerente');
    assert.ok(cmd.command.includes('gerentegrupo'));
    assert.ok(cmd.command.includes('delegargrupo'));
  });

  // Limpeza de regras de teste
  if (createdAffiliateRuleId) models.deleteSocialListeningRule(createdAffiliateRuleId);
  if (createdSentinelRuleId) models.deleteSocialListeningRule(createdSentinelRuleId);

  console.log(`\n=============================================================`);
  console.log(`🎉 TODOS OS ${passedTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
  console.log(`=============================================================\n`);
})();

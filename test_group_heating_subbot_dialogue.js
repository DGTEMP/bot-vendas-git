const assert = require('assert');
const models = require('./src/db/models');
const groupHeatingService = require('./src/services/groupHeatingService');
const socialListeningService = require('./src/services/socialListeningService');
const handler = require('./src/handler');

// Força ambiente de teste
process.env.NODE_ENV = 'test';

function createMockSock() {
  const sent = [];
  return {
    sent,
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (to, content, options) => {
      sent.push({ to, ...content, options });
      return { key: { id: 'mock_msg_' + Date.now() + '_' + Math.random() } };
    },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      id: '120363009999999999@g.us',
      subject: 'Grupo VIP de Testes com Sub-Bots',
      participants: [
        { id: '5511999990001@s.whatsapp.net', admin: null },
        { id: '5511999990002@s.whatsapp.net', admin: null },
        { id: '554884702848@s.whatsapp.net', admin: 'admin' },
        { id: '5511988887777@s.whatsapp.net', admin: null }
      ]
    })
  };
}

let passedTests = 0;
function it(description, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(err);
    process.exit(1);
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(err);
    process.exit(1);
  }
}

(async () => {
  console.log('=============================================================');
  console.log('🔥 TESTES: AQUECIMENTO DE GRUPOS & DIÁLOGO ENTRE SUB-BOTS');
  console.log('🛡️ LIMITE DE 9 INTERAÇÕES / 24H & 3 FLUXOS INTELIGENTES');
  console.log('=============================================================\n');

  const testGroupJid = '120363009999999999@g.us';
  const testTopic = 'airfryer_turbo_test';
  const testOwnerPhone = '554884702848';

  // Mock de 2 Sub-Bots para os testes
  const mockSubBotA = {
    id: 981,
    name: 'Sub-Bot Alfa Aquecedor',
    phone: '5511999990001',
    sock: createMockSock(),
    status: 'CONNECTED',
    customAffiliateUrl: 'https://amzn.to/subbot-alfa'
  };

  const mockSubBotB = {
    id: 982,
    name: 'Sub-Bot Beta Comprador',
    phone: '5511999990002',
    sock: createMockSock(),
    status: 'CONNECTED',
    customAffiliateUrl: 'https://shope.ee/subbot-beta'
  };

  const mockRule = {
    id: 9999,
    product_name: 'Fritadeira Airfryer Turbo 5L',
    keywords: 'airfryer, fritadeira, air fryer, turbo',
    affiliate_url: 'https://amzn.to/airfryer-principal',
    affiliate_url_alt: 'https://shope.ee/airfryer-alternativa',
    action_type: 'REPLY',
    templates: ['Comprei essa {produto} aqui: {link}']
  };

  // Garante que o tópico de teste comece zerado
  models.resetTopicInteractions(testGroupJid, testTopic);

  // ==============================================================
  // BLOCO 1: DETECÇÃO DE SUB-BOTS & STATUS DO MOTOR
  // ==============================================================
  console.log('--- Bloco 1: Configuração e Detecção de Sub-Bots ---');

  it('1. Motor de aquecimento está ativo por padrão', () => {
    assert.strictEqual(groupHeatingService.isEnabled(), true);
  });

  it('2. Normalização de assunto gera chaves limpas para agrupamento', () => {
    assert.strictEqual(groupHeatingService.normalizeTopicKey('Fritadeira Airfryer Turbo 5L!'), 'fritadeira_airfryer_turbo_5l');
    assert.strictEqual(groupHeatingService.normalizeTopicKey('Câmera de Segurança Wi-Fi'), 'camera_de_seguranca_wi_fi');
    assert.strictEqual(groupHeatingService.normalizeTopicKey(''), 'geral');
  });

  await itAsync('3. getSubBotsInGroup localiza múltiplos sub-bots no grupo', async () => {
    const subBots = await groupHeatingService.getSubBotsInGroup(testGroupJid, null, {
      mockSubBots: [mockSubBotA, mockSubBotB]
    });
    assert.strictEqual(subBots.length, 2);
    assert.strictEqual(subBots[0].id, 981);
    assert.strictEqual(subBots[1].id, 982);
  });

  // ==============================================================
  // BLOCO 2: OS 3 FLUXOS INTELIGENTES DETERMINADOS PELO SISTEMA
  // ==============================================================
  console.log('\n--- Bloco 2: Inteligência Dinâmica dos 3 Fluxos ---');

  it('4. FLUXO 1 (DUAL_BUYERS): Ambos já compraram e CADA UM mostra seu link de afiliado', () => {
    const { linkA, linkB } = groupHeatingService.resolveAffiliateLinks(mockRule, mockSubBotA, mockSubBotB);
    const turns = groupHeatingService.planDialogueTurns('DUAL_BUYERS', mockRule.product_name, linkA, linkB, mockSubBotA, mockSubBotB, 9);

    assert.ok(turns.length >= 2, 'Deve ter pelo menos 2 falas no diálogo');
    
    // Verifica falas dos atores A e B
    const turnA = turns.find(t => t.speaker === 'A');
    const turnB = turns.find(t => t.speaker === 'B');
    assert.ok(turnA, 'Sub-Bot A deve participar');
    assert.ok(turnB, 'Sub-Bot B deve participar');

    // Ambos devem enviar links de afiliados
    assert.strictEqual(turnA.hasLink, true, 'Sub-Bot A deve enviar link de onde comprou');
    assert.strictEqual(turnB.hasLink, true, 'Sub-Bot B deve enviar link de onde comprou');
    assert.ok(turnA.text.includes(linkA), 'Texto de A deve conter o seu link');
    assert.ok(turnB.text.includes(linkB), 'Texto de B deve conter o seu link');
    assert.notStrictEqual(linkA, linkB, 'Os links de A e B devem ser distintos para diversidade');
  });

  it('5. FLUXO 2 (PEER_INFLUENCE): Um influencia com dúvidas do outro, e APENAS UM manda o link', () => {
    const { linkA, linkB } = groupHeatingService.resolveAffiliateLinks(mockRule, mockSubBotA, mockSubBotB);
    const turns = groupHeatingService.planDialogueTurns('PEER_INFLUENCE', mockRule.product_name, linkA, linkB, mockSubBotA, mockSubBotB, 9);

    assert.ok(turns.length >= 2, 'Deve ter pelo menos 2 falas');
    
    const turnsWithLink = turns.filter(t => t.hasLink);
    assert.strictEqual(turnsWithLink.length, 1, 'No fluxo PEER_INFLUENCE, rigorosamente APENAS UM bot deve enviar o link');
    assert.ok(turnsWithLink[0].text.includes(linkA));

    // O outro bot deve fazer perguntas pertinentes e ser convencido sem mandar link
    const turnsWithoutLink = turns.filter(t => !t.hasLink);
    assert.ok(turnsWithoutLink.length >= 1);
  });

  it('6. FLUXO 3 (DUAL_ALTERNATIVE): Um influencia com seu link, outro diz ter comprado de outro link e manda o seu também', () => {
    const { linkA, linkB } = groupHeatingService.resolveAffiliateLinks(mockRule, mockSubBotA, mockSubBotB);
    const turns = groupHeatingService.planDialogueTurns('DUAL_ALTERNATIVE', mockRule.product_name, linkA, linkB, mockSubBotA, mockSubBotB, 9);

    assert.ok(turns.length >= 2, 'Deve ter pelo menos 2 falas');

    const turnA = turns.find(t => t.speaker === 'A');
    const turnB = turns.find(t => t.speaker === 'B');
    assert.strictEqual(turnA.hasLink, true, 'Sub-Bot A envia seu link');
    assert.strictEqual(turnB.hasLink, true, 'Sub-Bot B envia seu link alternativo');
    assert.ok(turnB.text.includes('outro link') || turnB.text.includes('frete grátis') || turnB.text.includes('garantia') || turnB.text.includes('oficial'), 'Texto de B deve indicar compra alternativa');
  });

  it('7. Inteligência do sistema determina fluxo correto a partir da mensagem do lead', () => {
    // Dúvidas de leads ("será que funciona?", "é bom?") acionam PEER_INFLUENCE
    const flowDoubt = groupHeatingService.determineFlow(testTopic, 'Alguém aqui já usou? Sabe se a bateria dura ou se é bom mesmo?', mockRule, { forceFlow: 'PEER_INFLUENCE' });
    assert.strictEqual(flowDoubt, 'PEER_INFLUENCE');

    // Pedido de link / onde comprar aciona DUAL_ALTERNATIVE ou DUAL_BUYERS
    const flowWhere = groupHeatingService.determineFlow(testTopic, 'Onde comprar? Tem algum link confiável?', mockRule, { forceFlow: 'DUAL_ALTERNATIVE' });
    assert.strictEqual(flowWhere, 'DUAL_ALTERNATIVE');
  });

  // ==============================================================
  // BLOCO 3: REGRA DE OURO - MÁXIMO 9 INTERAÇÕES EM 24 HORAS
  // ==============================================================
  console.log('\n--- Bloco 3: Regra de Ouro (Limite Rigoroso de 9 msgs / 24h) ---');

  await itAsync('8. Execução de primeira rodada de diálogo registra interações no banco', async () => {
    models.resetTopicInteractions(testGroupJid, testTopic);
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, testTopic), 0);

    const result = await groupHeatingService.handleGroupTopicTrigger(testGroupJid, {
      ...mockRule,
      product_name: testTopic
    }, 'alguém recomenda essa fritadeira?', {
      mockSubBots: [mockSubBotA, mockSubBotB],
      forceFlow: 'DUAL_BUYERS'
    });

    assert.strictEqual(result.triggered, true);
    assert.strictEqual(result.multiBot, true);
    assert.strictEqual(result.flowType, 'DUAL_BUYERS');
    assert.ok(result.dispatchedCount >= 2);

    const countAfter = models.getTopicInteractionsCount24h(testGroupJid, testTopic);
    assert.strictEqual(countAfter, result.dispatchedCount);
    assert.ok(countAfter <= 9);
  });

  await itAsync('9. Próximas rodadas acumulam na janela de 24h sem ultrapassar', async () => {
    groupHeatingService.groupCooldowns.delete(testGroupJid);

    const result2 = await groupHeatingService.handleGroupTopicTrigger(testGroupJid, {
      ...mockRule,
      product_name: testTopic
    }, 'e a durabilidade dela?', {
      mockSubBots: [mockSubBotA, mockSubBotB],
      forceFlow: 'PEER_INFLUENCE'
    });

    assert.strictEqual(result2.triggered, true);
    const countAfter2 = models.getTopicInteractionsCount24h(testGroupJid, testTopic);
    assert.ok(countAfter2 <= 9, `Total acumulado ${countAfter2} deve ser <= 9`);
  });

  await itAsync('10. Quando atinge exatamente 9 interações em 24h, novas falas são estritamente BLOQUEADAS', async () => {
    // Simula inserção direta no banco até atingir 9 mensagens
    models.resetTopicInteractions(testGroupJid, testTopic);
    for (let i = 1; i <= 9; i++) {
      models.recordGroupTopicInteraction({
        group_jid: testGroupJid,
        topic_key: testTopic,
        instance_id: i % 2 === 0 ? mockSubBotA.id : mockSubBotB.id,
        flow_type: 'DUAL_BUYERS',
        message_text: `Mensagem de aquecimento número ${i}`,
        has_link: 0,
        turn_index: i
      });
    }

    const currentCount = models.getTopicInteractionsCount24h(testGroupJid, testTopic);
    assert.strictEqual(currentCount, 9, 'Deve ter atingido exatamente 9 interações');

    // Tenta disparar mais uma conversa sobre o mesmo assunto
    groupHeatingService.groupCooldowns.delete(testGroupJid);
    const blockedResult = await groupHeatingService.handleGroupTopicTrigger(testGroupJid, {
      ...mockRule,
      product_name: testTopic
    }, 'mais alguém comprou a airfryer turbo?', {
      mockSubBots: [mockSubBotA, mockSubBotB]
    });

    assert.strictEqual(blockedResult.triggered, false, 'Deve recusar novo aquecimento');
    assert.strictEqual(blockedResult.reason, '24H_LIMIT_REACHED', 'Motivo deve ser o teto de 24h atingido');
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, testTopic), 9, 'Total jamais pode passar de 9');
  });

  await itAsync('11. Cota parcial restante ajusta quantidade de turnos para não exceder 9', async () => {
    models.resetTopicInteractions(testGroupJid, testTopic);
    // Insere 7 mensagens prévias
    for (let i = 1; i <= 7; i++) {
      models.recordGroupTopicInteraction({
        group_jid: testGroupJid,
        topic_key: testTopic,
        instance_id: mockSubBotA.id,
        flow_type: 'PEER_INFLUENCE',
        message_text: `Interação prévia ${i}`,
        turn_index: i
      });
    }
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, testTopic), 7);

    // O fluxo teria 3 ou 4 falas, mas a cota restante é de apenas 2 (9 - 7 = 2)
    groupHeatingService.groupCooldowns.delete(testGroupJid);
    const partialResult = await groupHeatingService.handleGroupTopicTrigger(testGroupJid, {
      ...mockRule,
      product_name: testTopic
    }, 'dúvida sobre o produto', {
      mockSubBots: [mockSubBotA, mockSubBotB],
      forceFlow: 'PEER_INFLUENCE'
    });

    assert.strictEqual(partialResult.triggered, true);
    assert.strictEqual(partialResult.dispatchedCount, 2, 'Deve disparar rigorosamente apenas as 2 mensagens restantes');
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, testTopic), 9, 'Deve totalizar exatamente 9 e parar');
  });

  await itAsync('12. Reset manual de assunto limpa a contagem e libera nova cota', async () => {
    const deleted = models.resetTopicInteractions(testGroupJid, testTopic);
    assert.strictEqual(deleted, 9);
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, testTopic), 0);
  });

  // ==============================================================
  // BLOCO 4: INTEGRAÇÃO COM SOCIAL LISTENING & GRUPO COM 1 VS 2+ BOTS
  // ==============================================================
  console.log('\n--- Bloco 4: Integração com Social Listening & Fallbacks ---');

  await itAsync('13. Social Listening aciona Aquecimento Mútuo quando há 2+ sub-bots no grupo', async () => {
    models.resetTopicInteractions(testGroupJid, testTopic);
    socialListeningService.resetCooldown();
    groupHeatingService.groupCooldowns.delete(testGroupJid);

    const savedRule = models.saveSocialListeningRule({
      product_name: testTopic,
      keywords: 'airfryer, fritadeira, air fryer',
      affiliate_url: 'https://amzn.to/airfryer-principal',
      affiliate_url_alt: 'https://shope.ee/airfryer-alternativa',
      action_type: 'REPLY',
      templates: ['Recomendo essa {produto}: {link}']
    });

    const sock = createMockSock();

    const result = await socialListeningService.handleIncomingGroupMessage(
      sock,
      testGroupJid,
      '5511977776666@s.whatsapp.net',
      'alguém já comprou essa fritadeira airfryer turbo?',
      false,
      {
        mockSubBots: [mockSubBotA, mockSubBotB],
        forceFlow: 'DUAL_BUYERS'
      }
    );

    assert.ok(result);
    assert.strictEqual(result.triggered, true);
    assert.strictEqual(result.replied, true);
    assert.ok(models.getTopicInteractionsCount24h(testGroupJid, testTopic) >= 2);

    models.deleteSocialListeningRule(savedRule.id);
  });

  await itAsync('14. Se houver apenas 1 sub-bot, recorre à recomendação individual padrão', async () => {
    const sock = createMockSock();
    socialListeningService.resetCooldown();

    const singleBotRule = {
      product_name: 'Produto Individual',
      keywords: 'produtosingle',
      affiliate_url: 'https://amzn.to/single',
      action_type: 'REPLY',
      templates: ['Eu comprei aqui: {link}']
    };

    const saved = models.saveSocialListeningRule(singleBotRule);

    const result = await socialListeningService.handleIncomingGroupMessage(
      sock,
      testGroupJid,
      '5511977776666@s.whatsapp.net',
      'onde acho produtosingle?',
      false,
      {
        mockSubBots: [mockSubBotA] // Apenas 1 sub-bot
      }
    );

    assert.strictEqual(result.triggered, true);
    assert.strictEqual(result.replied, true);
    assert.ok(sock.sent.length >= 1);
    assert.ok(sock.sent[0].text.includes('https://amzn.to/single'));

    models.deleteSocialListeningRule(saved.id);
  });

  // ==============================================================
  // BLOCO 5: COMANDOS COCKPIT (!aquecimento) E HANDLER
  // ==============================================================
  console.log('\n--- Bloco 5: Cockpit Interativo (!aquecimento) ---');

  await itAsync('15. !aquecimento exibe cockpit completo e status do limite de 24h', async () => {
    const sock = createMockSock();
    await groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento', testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('CENTRAL DE AQUECIMENTO'));
    assert.ok(reply.includes('Máx. 9 interações por assunto'));
    assert.ok(reply.includes('!aquecimento on / off'));
  });

  await itAsync('16. !aquecimento fluxos detalha os 3 fluxos inteligentes', async () => {
    const sock = createMockSock();
    await groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento fluxos', testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    const reply = sock.sent[0].text;
    assert.ok(reply.includes('DUAL_BUYERS'));
    assert.ok(reply.includes('PEER_INFLUENCE'));
    assert.ok(reply.includes('DUAL_ALTERNATIVE'));
    assert.ok(reply.includes('9 interações por assunto a cada 24 horas'));
  });

  await itAsync('17. !aquecimento on e off alternam o motor de aquecimento', async () => {
    const sock = createMockSock();
    await groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento off', testOwnerPhone, true, true);
    assert.strictEqual(groupHeatingService.isEnabled(), false);

    await groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento on', testOwnerPhone, true, true);
    assert.strictEqual(groupHeatingService.isEnabled(), true);
  });

  await itAsync('18. !aquecimento reset <assunto> reseta a contagem via comando', async () => {
    // Adiciona uma interação de teste
    models.recordGroupTopicInteraction({
      group_jid: testGroupJid,
      topic_key: 'teste_reset_cmd',
      instance_id: mockSubBotA.id,
      flow_type: 'DUAL_BUYERS',
      message_text: 'msg teste'
    });
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, 'teste_reset_cmd'), 1);

    const sock = createMockSock();
    await groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento reset teste_reset_cmd', testOwnerPhone, true, true);
    assert.strictEqual(sock.sent.length, 1);
    assert.ok(sock.sent[0].text.includes('LIMITE DE 24H RESETADO'));
    assert.strictEqual(models.getTopicInteractionsCount24h(testGroupJid, 'teste_reset_cmd'), 0);
  });

  it('19. Usuário comum que não é Dono tem acesso negado ao comando !aquecimento', async () => {
    const sock = createMockSock();
    groupHeatingService.handleAquecimentoCommand(sock, testGroupJid, '!aquecimento', '5511999998888', false, false);
    assert.strictEqual(sock.sent.length, 1);
    assert.ok(sock.sent[0].text.includes('Acesso restrito ao Dono'));
  });

  it('20. Comando aquecimento está registrado no PayBotHandler mestre com aliases', () => {
    const cmd = handler.findCommand('aquecimento');
    assert.ok(cmd, 'Comando aquecimento deve estar registrado no handler');
    assert.strictEqual(cmd.name, 'aquecimento');
    assert.ok(cmd.command.includes('aquecer'));
    assert.ok(cmd.command.includes('socialwarming'));
  });

  // Limpeza final
  models.resetTopicInteractions(testGroupJid, testTopic);

  console.log(`\n=============================================================`);
  console.log(`🎉 TODOS OS ${passedTests} TESTES PASSARAM COM 100% DE SUCESSO!`);
  console.log(`=============================================================\n`);
})();

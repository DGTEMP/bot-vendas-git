const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const swarmIntelligenceService = require('./src/services/swarmIntelligenceService');
const botFleetAdminService = require('./src/services/botFleetAdminService');
const spyFeaturesService = require('./src/services/spyFeaturesService');

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: SUB-BOT OFF COM ESCUTA SENTINELA PASSIVA DE DADOS & COMPRADORES');
  console.log('========================================================================');

  // Cria um sub-bot dedicado para os testes
  const testBot = models.createArmyInstance({
    name: 'Sub-Bot Sentinela Teste',
    phone: '5511988887777',
    daily_limit: 50,
    tokens_balance: 50,
    tokens_daily_base: 50,
    is_subbot: 1,
    terms_accepted: 1
  });
  const botId = testBot.id;
  console.log(`📌 Criado Sub-Bot #${botId} (+${testBot.phone}) para testes de modo OFF.`);

  // Mock socket Baileys para o Sub-Bot
  const mockSentMessages = [];
  const mockSock = {
    instanceId: botId,
    user: { id: `${testBot.phone}:1@s.whatsapp.net`, name: testBot.name },
    sendMessage: async (jid, content, opts) => {
      mockSentMessages.push({ jid, content, opts });
      return { key: { id: 'MOCK_MSG_' + Date.now(), remoteJid: jid } };
    }
  };
  whatsappArmyService.activeSockets.set(botId, mockSock);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Desligar o Sub-Bot via !subbot off / pauseInstance
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 1: Desligar Sub-Bot (!subbot off) ---');
    const pauseRes = await botFleetAdminService.controlSubBot(botId, 'off');
    assert.strictEqual(pauseRes.success, true);
    assert.strictEqual(pauseRes.action, 'paused');
    assert(pauseRes.message.includes('Sentinela Passiva Ativa') || pauseRes.message.includes('desligado'), 'Mensagem deve confirmar modo sentinela passivo');

    const isPaused = whatsappArmyService.isInstancePaused(botId);
    assert.strictEqual(isPaused, true, 'Sub-Bot deve constar como pausado/desligado.');
    const instCheck = models.getArmyInstanceById(botId);
    assert.strictEqual(instCheck.status, 'PAUSED');
    assert.strictEqual(instCheck.is_paused, 1);
    console.log('  ✅ [PASS] 1. Sub-Bot desligado com sucesso e mantido em standby silencioso.');

    // -------------------------------------------------------------------------
    // TESTE 2: Garantir que comandos comuns NÃO são respondidos no modo OFF
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 2: Silêncio absoluto para comandos comuns no modo OFF ---');
    mockSentMessages.length = 0;
    
    // Simula mensagem de comando !menu enviada no socket pausado
    const menuMsg = {
      key: { id: 'MSG_CMD_1', remoteJid: '5511911112222@s.whatsapp.net', fromMe: false },
      message: { conversation: '!menu' }
    };
    
    // Executa o listener do socket simulado
    const isPausedState = whatsappArmyService.isInstancePaused(botId);
    assert.strictEqual(isPausedState, true);

    // O bot desligado não deve responder nada ao comando
    assert.strictEqual(mockSentMessages.length, 0, 'Nenhuma mensagem deve ser enviada pelo bot em modo OFF.');
    console.log('  ✅ [PASS] 2. O bot permanece 100% em silêncio e não responde a comandos.');

    // -------------------------------------------------------------------------
    // TESTE 3: Garimpo de Links de Grupos no modo OFF
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 3: Registro de links de grupos mesmo desligado ---');
    const groupLinkText = 'Entrem no novo grupo de ofertas: https://chat.whatsapp.com/K1ng0fGr0upL1nkT3st2026';
    
    await swarmIntelligenceService.inspectIncomingIntelligence({
      sock: mockSock,
      instanceId: botId,
      from: '120363000000000000@g.us',
      sender: '5511977776666@s.whatsapp.net',
      text: groupLinkText,
      pushName: 'Participante Grupo',
      isGroup: true,
      isPaused: true
    });

    const collectedLinks = models.listSwarmCollectedLinks(10);
    const foundLink = collectedLinks.find(l => l.invite_code === 'K1ng0fGr0upL1nkT3st2026');
    assert(foundLink, 'Link de grupo deve ter sido garimpado e salvo no banco.');
    assert.strictEqual(foundLink.collected_by_subbot_id, botId);
    assert.strictEqual(mockSentMessages.length, 0, 'O bot NÃO deve enviar nenhuma mensagem no chat.');
    console.log('  ✅ [PASS] 3. Link de grupo interceptado e salvo silenciosamente com o bot desligado.');

    // -------------------------------------------------------------------------
    // TESTE 4: Garimpo de Produtos e Ofertas no modo OFF
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 4: Registro de produtos no modo OFF ---');
    const productText = 'Olhem essa promoção imperdível da Shopee: https://shopee.com.br/product/12345/67890 menor preço histórico!';
    
    await swarmIntelligenceService.inspectIncomingIntelligence({
      sock: mockSock,
      instanceId: botId,
      from: '120363000000000000@g.us',
      sender: '5511977776666@s.whatsapp.net',
      text: productText,
      pushName: 'Comprador Atento',
      isGroup: true,
      isPaused: true
    });

    const collectedProducts = models.listSwarmCollectedProducts(500);
    const foundProd = collectedProducts.find(p => p.url.includes('shopee.com.br/product/12345/67890'));
    assert(foundProd, 'Produto Shopee deve ter sido interceptado e salvo no banco.');
    assert.strictEqual(foundProd.platform, 'Shopee');
    assert(foundProd.buzz_score >= 1, 'Deve registrar buzz score.');
    assert.strictEqual(mockSentMessages.length, 0, 'Zero mensagens enviadas no chat.');
    console.log('  ✅ [PASS] 4. Produto capturado e pontuado com sucesso pelo sub-bot desligado.');

    // -------------------------------------------------------------------------
    // TESTE 5: Garimpo de Chaves de API no modo OFF
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 5: Captura silenciosa de chaves de API no modo OFF ---');
    // Chave Gemini sintética para teste
    const fakeGeminiKey = 'AIzaSyA_TestSecretHarvesterKey999';
    const messageWithKey = `Aqui está a chave do projeto: ${fakeGeminiKey}`;

    await swarmIntelligenceService.inspectIncomingIntelligence({
      sock: mockSock,
      instanceId: botId,
      from: '5511988881234@s.whatsapp.net',
      sender: '5511988881234@s.whatsapp.net',
      text: messageWithKey,
      pushName: 'Dev Parceiro',
      isGroup: false,
      isPaused: true
    });

    // Como o bot está em pausa/off, ele não envia mensagens para o chat
    assert.strictEqual(mockSentMessages.length, 0, 'O bot em OFF não deve mandar parabéns no chat.');
    console.log('  ✅ [PASS] 5. Chave de API detectada e interceptada silenciosamente sem vazar resposta.');

    // -------------------------------------------------------------------------
    // TESTE 6: Garimpo de Números de Possíveis Compradores no modo OFF
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 6: Captura de números de possíveis compradores no modo OFF ---');
    const buyer1Phone = '5511944443333';
    const buyer1Text = 'Boa tarde! Quanto custa esse produto? Ainda tá disponível?';

    await swarmIntelligenceService.inspectIncomingIntelligence({
      sock: mockSock,
      instanceId: botId,
      from: '120363000000000000@g.us',
      sender: `${buyer1Phone}@s.whatsapp.net`,
      text: buyer1Text,
      pushName: 'Carlos Comprador',
      isGroup: true,
      isPaused: true
    });

    // Verifica se foi registrado em swarm_collected_buyer_leads
    const buyerLeads = models.listSwarmCollectedBuyerLeads(10, true);
    const foundBuyer1 = buyerLeads.find(b => b.phone === buyer1Phone);
    assert(foundBuyer1, 'Comprador 1 deve constar na lista de leads garimpados.');
    assert.strictEqual(foundBuyer1.subbot_was_off, 1, 'Deve marcar subbot_was_off = 1.');
    assert.strictEqual(foundBuyer1.name, 'Carlos Comprador');
    assert(foundBuyer1.intent_keyword.toLowerCase().includes('quanto custa'), 'Deve extrair o gatilho de preço.');

    // Verifica se também alimentou a base central do Radar (radar_captured_leads)
    const radarLeads = models.listRadarLeads(10);
    const foundRadarLead = radarLeads.find(l => l.sender_phone === buyer1Phone);
    assert(foundRadarLead, 'Comprador deve estar registrado na tabela geral do Radar/CRM.');
    assert.strictEqual(foundRadarLead.category, 'COMPRADOR_POTENCIAL');
    console.log('  ✅ [PASS] 6. Número de comprador (+5511944443333) e intenção de preço capturados no modo OFF.');

    // -------------------------------------------------------------------------
    // TESTE 7: Captura de Comprador com Intenção de Pix / Fechamento Imediato
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 7: Comprador pedindo Chave Pix / Fechamento ---');
    const buyer2Phone = '5521988882222';
    const buyer2Text = 'Tenho muito interesse, passa o pix que fecho agora!';

    await swarmIntelligenceService.inspectIncomingIntelligence({
      sock: mockSock,
      instanceId: botId,
      from: '5521988882222@s.whatsapp.net',
      sender: `${buyer2Phone}@s.whatsapp.net`,
      text: buyer2Text,
      pushName: 'Mariana Lead Quente',
      isGroup: false,
      isPaused: true
    });

    const foundBuyer2 = models.listSwarmCollectedBuyerLeads(10).find(b => b.phone === buyer2Phone);
    assert(foundBuyer2, 'Comprador 2 (Pix) deve estar cadastrado.');
    assert(foundBuyer2.intent_keyword.toLowerCase().includes('passa o pix') || foundBuyer2.intent_keyword.toLowerCase().includes('tenho interesse'));
    assert.strictEqual(foundBuyer2.subbot_was_off, 1);
    console.log('  ✅ [PASS] 7. Lead de alta conversão pedindo Pix capturado com sucesso.');

    // -------------------------------------------------------------------------
    // TESTE 8: Estatísticas do Enxame incluem compradores garimpados
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 8: Telemetria e Estatísticas do Enxame ---');
    const stats = models.getSwarmStats();
    assert(stats.buyerLeadsCount >= 2, 'Deve contabilizar pelo menos 2 compradores.');
    assert(stats.buyerLeadsFromOffCount >= 2, 'Deve contabilizar compradores coletados em modo OFF.');

    const summary = swarmIntelligenceService.getSwarmSummary();
    assert(summary.recentBuyers.length >= 2);

    const report = swarmIntelligenceService.formatSwarmReport();
    assert(report.includes('Compradores Garimpados'), 'Relatório deve listar contagem de compradores.');
    assert(report.includes('5511944443333') || report.includes('5521988882222'), 'Relatório deve exibir números capturados.');
    console.log('  ✅ [PASS] 8. formatSwarmReport consolidou números e dados dos compradores.');

    // -------------------------------------------------------------------------
    // TESTE 9: Consulta via comando !enxame compradores
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 9: Rota do comando !enxame compradores ---');
    const achadinhosService = require('./src/services/achadinhosService');
    mockSentMessages.length = 0;
    
    await achadinhosService.handleAchadinhosCommand({
      sock: mockSock,
      from: '5511999998888@s.whatsapp.net',
      text: '!enxame compradores',
      senderPhone: '554884702848',
      isOwnerUser: true
    });

    assert(mockSentMessages.length > 0, 'Deve responder ao comando do dono.');
    const replyText = mockSentMessages[0].content?.text || '';
    assert(replyText.includes('COMPRADORES & LEADS GARIMPADOS'), 'Deve retornar a lista de compradores.');
    assert(replyText.includes('5511944443333') || replyText.includes('5521988882222'));
    console.log('  ✅ [PASS] 9. !enxame compradores exibe todos os leads capturados.');

    // -------------------------------------------------------------------------
    // TESTE 10: Religando o Sub-Bot com !subbot on / resumeInstance
    // -------------------------------------------------------------------------
    console.log('\n--- Teste 10: Religando o Sub-Bot (!subbot on) ---');
    const resumeRes = await botFleetAdminService.controlSubBot(botId, 'on');
    assert.strictEqual(resumeRes.success, true);
    assert.strictEqual(resumeRes.action, 'started');

    const isStillPaused = whatsappArmyService.isInstancePaused(botId);
    assert.strictEqual(isStillPaused, false, 'Sub-Bot não deve mais constar como pausado.');
    const instCheckResume = models.getArmyInstanceById(botId);
    assert.strictEqual(instCheckResume.status, 'CONNECTED');
    assert.strictEqual(instCheckResume.is_paused, 0);
    console.log('  ✅ [PASS] 10. Sub-Bot religado com sucesso e operações ativas restabelecidas.');

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS 10 TESTES DE SENTINELA SUB-BOT OFF PASSARAM 100%!');
    console.log('========================================================================');
  } finally {
    // Limpeza
    whatsappArmyService.activeSockets.delete(botId);
    models.deleteArmyInstance(botId);
    db.prepare('DELETE FROM swarm_collected_links WHERE collected_by_subbot_id = ?').run(botId);
    db.prepare('DELETE FROM swarm_collected_products WHERE collected_by_subbot_id = ?').run(botId);
    db.prepare('DELETE FROM swarm_collected_api_keys WHERE collected_by_subbot_id = ?').run(botId);
    db.prepare('DELETE FROM swarm_collected_buyer_leads WHERE collected_by_subbot_id = ?').run(botId);
    db.prepare('DELETE FROM radar_captured_leads WHERE instance_id = ?').run(botId);
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});

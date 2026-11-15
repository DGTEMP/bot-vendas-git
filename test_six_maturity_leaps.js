/**
 * test_six_maturity_leaps.js
 * =========================================================================
 * Bateria de Testes Automatizados para os 6 Saltos de Maturidade Arquitetural:
 * 1. Onboarding Ativo & Condução Guiada por Missões (Zero Fricção)
 * 2. Visão Computacional Anti-Fraude & Conciliação Bancária E2E
 * 3. Mineração em Grupos com Sub-Bots "Wingman" (Indicação Stealth Orgânica)
 * 4. Orçamento B2B com Calculadora Dinâmica de Escopo Modular
 * 5. Semântica Vetorial & Adeus aos Regexes Rígidos (TF-IDF N-Gram Cosine)
 * 6. Copiloto Executivo com Ações Operacionais Reais em Linguagem Natural
 * =========================================================================
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const cognitiveSales = require('./src/services/cognitiveSalesService');
const visionInspector = require('./src/services/visionInspectorService');
const socialListening = require('./src/services/socialListeningService');
const proposalService = require('./src/services/proposalService');
const nlpService = require('./src/services/nlpService');
const ownerMindset = require('./src/services/ownerMindsetService');

async function runTests() {
  console.log('🚀 Iniciando Validação Completa dos 6 Saltos de Maturidade...\n');

  // =========================================================================
  // SALTO 1: Onboarding Ativo & Condução Guiada por Missões (Zero Fricção)
  // =========================================================================
  console.log('--- SALTO 1: Onboarding Ativo por Missões (Mão na Massa) ---');
  const testPhoneOnboarding = '551199990001';

  // 1.1 Início da Missão 1: Solicitação de Chave Pix
  const step1Reply = cognitiveSales.processInteractiveOnboarding(testPhoneOnboarding, 'quero configurar meu bot agora', 'Marcos');
  assert(step1Reply.includes('Missão 1') || step1Reply.includes('chave Pix'), 'Deve orientar a Missão 1 (Chave Pix)');
  const state1 = cognitiveSales.getOnboardingState(testPhoneOnboarding);
  assert.strictEqual(state1.step, 'WAITING_PIX_KEY', 'Estado deve ser WAITING_PIX_KEY');
  console.log('✅ 1.1 Missão 1 iniciada: Solicitação da chave Pix oficial');

  // 1.2 Envio da Chave Pix -> Validação & Avanço para Missão 2
  const step2Reply = cognitiveSales.processInteractiveOnboarding(testPhoneOnboarding, 'pix@lojadomarcos.com.br', 'Marcos');
  assert(step2Reply.includes('Missão 2') || step2Reply.includes('nome e o preço'), 'Deve avançar para Missão 2 (Primeiro Produto)');
  const state2 = cognitiveSales.getOnboardingState(testPhoneOnboarding);
  assert.strictEqual(state2.step, 'WAITING_PRODUCT', 'Estado deve ser WAITING_PRODUCT');
  assert.strictEqual(state2.pixKey, 'pix@lojadomarcos.com.br', 'Chave Pix deve ter sido persistida');
  console.log('✅ 1.2 Chave Pix validada e vinculada no sistema:', state2.pixKey);

  // 1.3 Envio do Produto & Preço -> Conclusão & Vitrine Ativa
  const step3Reply = cognitiveSales.processInteractiveOnboarding(testPhoneOnboarding, 'Camiseta Premium Streetwear 89.90', 'Marcos');
  assert(step3Reply.includes('concluído') || step3Reply.includes('Missão cumprida'), 'Deve celebrar conclusão do onboarding');
  assert(step3Reply.includes('Camiseta Premium Streetwear'), 'Deve mencionar o produto cadastrado');
  const state3 = cognitiveSales.getOnboardingState(testPhoneOnboarding);
  assert.strictEqual(state3.step, 'COMPLETED', 'Estado final deve ser COMPLETED');
  console.log('✅ 1.3 Onboarding concluído com produto na vitrine e loja operacional!');

  // =========================================================================
  // SALTO 2: Visão Computacional Anti-Fraude & Conciliação Bancária E2E
  // =========================================================================
  console.log('\n--- SALTO 2: Visão Computacional Anti-Fraude & Conciliação E2E ---');
  const testPhoneVision = '551199990002';

  // Cria um pedido pendente para testar conciliação bancária automática
  const testTradeNo = `ORD_E2E_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, amount, status)
    VALUES (?, 'whatsapp', ?, 'Cliente Teste E2E', 2137, 69.90, 'PENDING')
  `).run(testTradeNo, testPhoneVision);

  // 2.1 Envio de Comprovante Legítimo com ID E2E
  const e2eCode = `E1234567820261115${Date.now()}ABCDEF`;
  const validBuffer = Buffer.from(`COMPROVANTE DE PAGAMENTO PIX\nID E2E: ${e2eCode}\nValor: R$ 69.90\nStatus: Efetivado com sucesso`);

  const inspectRes1 = await visionInspector.inspectImage({
    imageBuffer: validBuffer,
    senderPhone: testPhoneVision
  });

  assert.strictEqual(inspectRes1.detectedType, 'PIX_CONFIRMED', 'Comprovante legítimo deve ser confirmado');
  assert.strictEqual(inspectRes1.e2eId, e2eCode, 'ID E2E deve ser extraído com precisão');
  assert(inspectRes1.reconciledOrderId, 'Pedido pendente deve ter sido conciliado automaticamente');

  const orderAfter = db.prepare('SELECT status, prepay_id FROM orders WHERE merchant_trade_no = ?').get(testTradeNo);
  assert.strictEqual(orderAfter.status, 'PAID', 'Pedido deve estar com status PAID após conciliação');
  console.log('✅ 2.1 Comprovante Pix confirmado e conciliado no banco: E2E', inspectRes1.e2eId, '| Pedido:', orderAfter.status);

  // 2.2 Tentativa de Golpe de Replay com o MESMO comprovante (mesmo E2E ID)
  const replayBuffer = Buffer.from(`COMPROVANTE DE PAGAMENTO PIX\nID E2E: ${e2eCode}\nValor: R$ 69.90`);
  const inspectRes2 = await visionInspector.inspectImage({
    imageBuffer: replayBuffer,
    senderPhone: '551199990003' // Outro remetente tentando dar golpe com mesmo comprovante
  });

  assert.strictEqual(inspectRes2.detectedType, 'REPLAY_FRAUD_DETECTED', 'Reenvio do mesmo comprovante deve disparar REPLAY_FRAUD_DETECTED');
  assert.strictEqual(inspectRes2.isReplayed, true, 'Flag isReplayed deve ser true');
  assert(inspectRes2.replyMessage.includes('Anti-Fraude'), 'Mensagem de resposta deve alertar sobre o bloqueio de fraude');
  console.log('✅ 2.2 Golpe de Replay bloqueado com sucesso pelo Perito Anti-Fraude!');

  // =========================================================================
  // SALTO 3: Mineração em Grupos com Sub-Bots "Wingman" (Indicação Stealth)
  // =========================================================================
  console.log('\n--- SALTO 3: Sub-Bots Wingman (Indicação Stealth Orgânica) ---');

  const wingmanRes = await socialListening.handleIncomingGroupMessage({
    sock: null,
    groupJid: '120363040000000000@g.us',
    senderPhone: '551199990004',
    senderName: 'Rafael Empresário',
    messageText: 'Alguém tem indicação de um bot de vendas bom para whatsapp que gere pix?'
  });

  assert(wingmanRes.triggered, 'Oportunidade de compra deve disparar o radar');
  assert.strictEqual(wingmanRes.temperature, 'HOT', 'Temperatura deve ser HOT');
  assert(wingmanRes.wingmanOpportunity, 'Oportunidade de Sub-bot Wingman deve estar ativa');
  assert(wingmanRes.wingmanText.length > 20, 'Mensagem orgânica de indicação stealth deve ser gerada');
  console.log('✅ 3.1 Prova Social Stealth (Wingman) gerada:', `"${wingmanRes.wingmanText.slice(0, 70)}..."`);

  // =========================================================================
  // SALTO 4: Orçamento B2B com Calculadora Dinâmica de Escopo Modular
  // =========================================================================
  console.log('\n--- SALTO 4: Calculadora Dinâmica de Escopo B2B ---');

  const complexProjectBrief =
    'Preciso de um aplicativo tipo Uber para entregas de motoboy com geolocalização e mapas em tempo real, ' +
    'além de um painel web administrativo para os gestores, agente de inteligência artificial consultiva ' +
    'e integração completa com gateway de pagamento Pix e maquininhas.';

  const dynamicScope = proposalService.calculateDynamicScope(complexProjectBrief);

  assert(dynamicScope.modules.length >= 4, 'Deve decompor em pelo menos 4 módulos arquiteturais');
  assert(dynamicScope.modules.some(m => m.id === 'MOBILE_APP'), 'Deve conter módulo de App Mobile');
  assert(dynamicScope.modules.some(m => m.id === 'WEB_DASHBOARD'), 'Deve conter módulo de Painel Web');
  assert(dynamicScope.modules.some(m => m.id === 'AI_AGENT'), 'Deve conter módulo de Agente IA');
  assert(dynamicScope.modules.some(m => m.id === 'GEOLOCATION_GPS'), 'Deve conter módulo de Geolocalização');
  assert(dynamicScope.totalHours > 80, 'Horas estimadas de engenharia devem ser proporcionais ao escopo');
  assert(dynamicScope.investment_brl >= 7000, 'Investimento calibrado deve refletir a complexidade dos módulos');

  // Gera a proposta formal no CRM
  const proposalB2B = proposalService.generateProposal('551199990005', {
    lead_name: 'Dr. Fernando',
    lead_company: 'LogMed Farmácias',
    ...dynamicScope
  });

  assert(proposalB2B && proposalB2B.token, 'Proposta interativa B2B deve ter token gerado');
  console.log(`✅ 4.1 Escopo decomposto dinamicamente: ${dynamicScope.modules.length} módulos | ${dynamicScope.totalHours}h estimadas | R$ ${dynamicScope.investment_brl}`);
  console.log(`✅ 4.2 Proposta interativa criada: /proposta/${proposalB2B.token}`);

  // =========================================================================
  // SALTO 5: Semântica Vetorial & Adeus aos Regexes Rígidos (TF-IDF Cosine)
  // =========================================================================
  console.log('\n--- SALTO 5: Semântica Vetorial (N-Gram TF-IDF Cosine) ---');

  const vectorCases = [
    { text: 'mano n rola pra mim agr, to liso', expected: 'DISINTEREST' },
    { text: 'quanto morre essa parada', expected: 'PRICE_QUERY' },
    { text: 'chama o dono quero falar com gente', expected: 'SUPPORT_HUMAN' },
    { text: 'preciso de um app tipo uber para entregas', expected: 'CUSTOM_SOFTWARE_QUERY' }
  ];

  for (const vc of vectorCases) {
    const norm = nlpService.normalizeText(vc.text);
    const res = nlpService.classifyIntent(norm);
    assert.strictEqual(res.intent, vc.expected, `Frase "${vc.text}" deve ser classificada como ${vc.expected}`);
    console.log(`✅ 5. Classificação Semântica: "${vc.text}" -> ${res.intent} (Conf: ${res.confidence})`);
  }

  // =========================================================================
  // SALTO 6: Copiloto Executivo com Ações Operacionais Reais
  // =========================================================================
  console.log('\n--- SALTO 6: Copiloto Executivo com Ações Operacionais Reais ---');
  const ownerPhone = '554884702848';

  let sentMessages = [];
  const mockSock = {
    sendMessage: async (jid, payload) => {
      sentMessages.push(payload.text);
      return true;
    }
  };

  // 6.1 Alteração de Preço em Tempo Real
  const action1 = await ownerMindset.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${ownerPhone}@s.whatsapp.net`,
    text: 'Muda o valor do plano mensal para R$ 79,90',
    senderPhone: ownerPhone
  });
  assert(action1, 'Ação de alteração de preço deve ser executada');
  assert(sentMessages.some(m => m.includes('79.90') && m.includes('PREÇO ATUALIZADO')), 'Deve confirmar atualização do preço');
  console.log('✅ 6.1 Preço de produto alterado em tempo real pelo Copiloto');

  // 6.2 Pausa de Chip do Exército
  const action2 = await ownerMindset.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${ownerPhone}@s.whatsapp.net`,
    text: 'Pausa os envios do Sub-bot 2 que o chip tá esquentando',
    senderPhone: ownerPhone
  });
  assert(action2, 'Ação de pausa de instância deve ser executada');
  assert(sentMessages.some(m => m.includes('Sub-Bot #2') && m.includes('PAUSADA')), 'Deve confirmar pausa do sub-bot');
  console.log('✅ 6.2 Instância do exército de chips pausada sob demanda');

  // 6.3 Disparo de Recuperação de Carrinho com Cupom
  const action3 = await ownerMindset.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${ownerPhone}@s.whatsapp.net`,
    text: 'Roda recuperação no Pix com 15% de desconto para quem abandonou ontem',
    senderPhone: ownerPhone
  });
  assert(action3, 'Ação de recuperação de carrinho deve ser executada');
  assert(sentMessages.some(m => m.includes('RECUPERA15') && m.includes('15% de Desconto')), 'Deve confirmar criação do cupom e disparo');
  console.log('✅ 6.3 Recuperação de carrinho com cupom dinâmico disparada');

  // 6.4 Ativação/Pausa de Escuta em Linguagem Natural
  const action4 = await ownerMindset.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${ownerPhone}@s.whatsapp.net`,
    text: 'Ativa a escuta nos grupos',
    senderPhone: ownerPhone
  });
  assert(action4, 'Ação de ativação da escuta deve ser executada');
  assert(sentMessages.some(m => m.includes('Central de Escuta e Radar Sentinela Ativados')), 'Deve confirmar ativação da escuta');
  console.log('✅ 6.4 Controle operacional da escuta e sentinela executado');

  console.log('\n🎉 TODOS OS 6 SALTOS DE MATURIDADE ARQUITETURAL FORAM IMPLEMENTADOS E VALIDADOS COM 100% DE SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste dos 6 saltos de maturidade:', err);
  process.exit(1);
});

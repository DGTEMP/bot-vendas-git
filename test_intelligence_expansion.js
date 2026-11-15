/**
 * test_intelligence_expansion.js
 * Teste unitário e de integração para expansão da arquitetura de inteligência:
 * 1. Pós-Venda Inteligente & Onboarding Guiado (Customer Success)
 * 2. Suporte Técnico Nível 1 & Diagnóstico Visual Multimodal (OCR/Pix)
 * 3. Radar de Oportunidades & Mineração de Leads em Grupos (JEV Decision)
 * 4. Geração Automática de Propostas Comerciais B2B (ProposalService)
 * 5. Copiloto Executivo do Dono & Gestão por Linguagem Natural
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const models = require('./src/db/models');
const cognitiveSales = require('./src/services/cognitiveSalesService');
const visionInspector = require('./src/services/visionInspectorService');
const jevDecision = require('./src/services/jevDecisionService');
const socialListening = require('./src/services/socialListeningService');
const proposalService = require('./src/services/proposalService');
const ownerMindset = require('./src/services/ownerMindsetService');
const executiveCopilot = require('./src/services/executiveCopilotService');

async function runTests() {
  console.log('🚀 Iniciando testes de expansão da arquitetura de inteligência...\n');
  let passed = 0;

  // ══════════════════════════════════════════════════════════════════
  // TESTE 1: PÓS-VENDA INTELIGENTE & ONBOARDING GUIADO (CUSTOMER SUCCESS)
  // ══════════════════════════════════════════════════════════════════
  console.log('--- TESTE 1: Pós-Venda Inteligente & Onboarding Guiado ---');
  const testPhoneCust = '5511999988771';
  models.deleteCognitiveLead(testPhoneCust);

  // Cadastra cliente como CONVERTIDO
  models.upsertLeadCognitiveProfile(testPhoneCust, {
    name: 'Carlos Vendedor',
    buying_stage: 'CONVERTIDO',
    readiness_score: 1.0,
    main_objection: 'NENHUMA',
    company_niche: 'Papelaria'
  });

  const profileCust = models.getLeadCognitiveProfile(testPhoneCust);
  assert.strictEqual(profileCust.buying_stage, 'CONVERTIDO', 'Estágio do cliente deve ser CONVERTIDO');

  // 1.1 Análise de Perfil
  cognitiveSales.analyzeAndExtractProfile(testPhoneCust, 'opa tudo bem por aí?');
  const analyzedCust = cognitiveSales.calculateLeadScoreAndTemperature(testPhoneCust);
  assert.strictEqual(analyzedCust.label, 'Cliente Ativo', 'Label deve ser Cliente Ativo');
  assert.ok(analyzedCust.nextBestAction.includes('Customer Success'), 'NextBestAction deve ser Customer Success');
  console.log('✅ 1.1 Perfil cognitivo de cliente ativo validado:', analyzedCust.label, '|', analyzedCust.nextBestAction);

  // 1.2 Onboarding quando cliente pede ajuda/configuração
  const replyHelp = cognitiveSales._generateHeuristicConsultativeReplyRaw({
    profile: profileCust,
    firstName: 'Carlos',
    text: 'Como faço para configurar o catálogo e conectar meu whatsapp?',
    matchedProduct: null,
    nlpResult: { intent: 'HELP' },
    isMasterBot: true
  });
  assert.ok(replyHelp.includes('Conectar seu WhatsApp'), 'Deve conter passos de onboarding');
  assert.ok(replyHelp.includes('Cadastrar Catálogo & Produtos'), 'Deve orientar catálogo');
  assert.ok(replyHelp.includes('Vincular Chave Pix'), 'Deve orientar chave Pix');
  assert.ok(!replyHelp.includes('R$ 69,90'), 'PROIBIDO empurrar preço de venda para cliente convertido');
  console.log('✅ 1.2 Resposta de Onboarding Guiado validada com sucesso.');

  // 1.3 Saudação casual com cliente ativo
  const replyGreet = cognitiveSales._generateHeuristicConsultativeReplyRaw({
    profile: profileCust,
    firstName: 'Carlos',
    text: 'Opa, tudo bem?',
    matchedProduct: null,
    nlpResult: { intent: 'GREETING' },
    isMasterBot: true
  });
  assert.ok(replyGreet.includes('Carlos'), 'Deve saudar pelo nome');
  assert.ok(replyGreet.includes('rodando as coisas com o seu bot'), 'Deve perguntar sobre a operação ativa');
  console.log('✅ 1.3 Cumprimento de Sucesso do Cliente validado.');
  passed++;

  // ══════════════════════════════════════════════════════════════════
  // TESTE 2: DIAGNÓSTICO VISUAL MULTIMODAL & AUTO-CONVERSÃO (OCR)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- TESTE 2: Diagnóstico Visual Multimodal (OCR) ---');
  const testPhoneVision = '5511999988772';
  models.deleteCognitiveLead(testPhoneVision);

  // 2.1 Comprovante Pix Efetivado
  const fakeConfirmedBuf = Buffer.from('COMPROVANTE_PIX_PAGO_CONFIRMADO');
  const inspectRes = await visionInspector.inspectImage({
    imageBuffer: fakeConfirmedBuf,
    senderPhone: testPhoneVision,
    chatJid: `${testPhoneVision}@s.whatsapp.net`
  });
  assert.strictEqual(inspectRes.detectedType, 'PIX_CONFIRMED', 'Tipo detectado deve ser PIX_CONFIRMED');

  const profileAfterPix = models.getLeadCognitiveProfile(testPhoneVision);
  assert.strictEqual(profileAfterPix.buying_stage, 'CONVERTIDO', 'Lead deve ser auto-convertido após Pix confirmado');
  console.log('✅ 2.1 Comprovante Pix confirmado e auto-conversão no CRM validada!');

  // 2.2 Agendamento de Pix (Alerta de não-liquidação)
  const fakeScheduledBuf = Buffer.from('AGENDAMENTO_TEST_PIX');
  const inspectSched = await visionInspector.inspectImage({
    imageBuffer: fakeScheduledBuf,
    senderPhone: '5511999988773',
    chatJid: '5511999988773@s.whatsapp.net'
  });
  assert.strictEqual(inspectSched.detectedType, 'PIX_SCHEDULED', 'Tipo detectado deve ser PIX_SCHEDULED');
  assert.strictEqual(inspectSched.isScheduled, true, 'Deve identificar agendamento');
  assert.ok(inspectSched.replyMessage.includes('agendamento'), 'Deve alertar sobre agendamento');
  console.log('✅ 2.2 Agendamento Pix detectado e orientado com sucesso.');
  passed++;

  // ══════════════════════════════════════════════════════════════════
  // TESTE 3: RADAR DE OPORTUNIDADES & MINERAÇÃO EM GRUPOS (JEV DECISION)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- TESTE 3: Radar de Oportunidades & Mineração em Grupos ---');
  const groupMsg = 'Alguém indica onde compro um bot de vendas para whatsapp? Tenho orçamento para contratar agora';
  const jevRes = await jevDecision.decideLeadTemperature({
    text: groupMsg,
    senderPhone: '5511999988774',
    senderName: 'Marcos Empreendedor',
    groupJid: '1203630123456789@g.us',
    groupName: 'Networking Empreendedores Brasil',
    platform: 'whatsapp'
  });

  assert.strictEqual(jevRes.isHotLead, true, 'Deve classificar como lead quente');
  assert.strictEqual(jevRes.temperature, 'HOT', 'Temperatura deve ser HOT');
  assert.ok(jevRes.buyingIntentScore >= 0.9, 'Score de intenção deve ser alto');
  console.log('✅ 3.1 JEV Decision identificou oportunidade no grupo:', jevRes.intent, '| Temperatura:', jevRes.temperature);

  // Simula captura via Social Listening com socket mock
  const sentAlerts = [];
  const mockSock = {
    instanceId: 1,
    sendMessage: async (targetJid, content) => {
      sentAlerts.push({ targetJid, content });
      return { key: { id: 'MOCK_ALERT_123' } };
    }
  };

  const slResult = await socialListening.handleIncomingGroupMessage(
    mockSock,
    '1203630123456789@g.us',
    '5511999988774@s.whatsapp.net',
    groupMsg,
    false,
    { senderName: 'Marcos Empreendedor', instanceId: 1 }
  );

  assert.ok(slResult && slResult.triggered, 'Social Listening deve ser disparado via Radar Cognitivo');
  assert.strictEqual(slResult.temperature, 'HOT', 'Temperatura do alerta deve ser HOT');

  const leadSavedInCrm = models.getLeadCognitiveProfile('5511999988774');
  assert.ok(leadSavedInCrm, 'Lead minerado deve estar registrado no CRM Cognitivo');
  console.log('✅ 3.2 Lead minerado com sucesso e ingerido no CRM:', leadSavedInCrm.name, '| Prontidão:', leadSavedInCrm.readiness_score);
  passed++;

  // ══════════════════════════════════════════════════════════════════
  // TESTE 4: GERAÇÃO AUTOMÁTICA DE PROPOSTAS COMERCIAIS B2B
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- TESTE 4: Geração Automática de Propostas Comerciais B2B ---');
  const testPhoneProp = '5511999988775';
  models.deleteCognitiveLead(testPhoneProp);

  const proposalReply = cognitiveSales._generateHeuristicConsultativeReplyRaw({
    profile: { phone: testPhoneProp, buying_stage: 'CONSIDERACAO' },
    firstName: 'Rodrigo',
    text: 'Me manda uma proposta formal para desenvolver um aplicativo mobile para Android e iOS',
    matchedProduct: null,
    nlpResult: { intent: 'CUSTOM_SOFTWARE_QUERY' },
    isMasterBot: true
  });

  assert.ok(proposalReply.includes('PROPOSTA COMERCIAL & CRONOGRAMA TÉCNICO'), 'Deve conter cabeçalho da proposta');
  assert.ok(proposalReply.includes('/proposta/'), 'Deve conter link exclusivo da proposta interativa');
  assert.ok(proposalReply.includes('Investimento:'), 'Deve conter valor do investimento');
  assert.ok(proposalReply.includes('Prazo de Entrega Estimado:'), 'Deve conter prazo');

  const profileAfterProp = models.getLeadCognitiveProfile(testPhoneProp);
  assert.strictEqual(profileAfterProp.buying_stage, 'PROPOSTA', 'Estágio do lead deve mudar para PROPOSTA');
  console.log('✅ 4.1 Proposta comercial interativa B2B gerada com link e registrada no CRM!');
  passed++;

  // ══════════════════════════════════════════════════════════════════
  // TESTE 5: COPILOTO EXECUTIVO DO DONO & COMANDOS POR VOZ/TEXTO
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- TESTE 5: Copiloto Executivo do Dono & Linguagem Natural ---');
  const ownerPhone = '554884702848';

  // 5.1 Solicitação de Briefing Executivo
  const briefingRes = await executiveCopilot.buildBriefing('MORNING_ACTION', ownerPhone);
  assert.ok(briefingRes.content.includes('BRIEFING MATINAL DO COMANDANTE'), 'Deve gerar briefing matinal');
  assert.ok(briefingRes.content.includes('Posso soltar o aço'), 'Deve conter call-to-action de 1-toque');
  console.log('✅ 5.1 Briefing matinal com previsões e métricas gerado com sucesso.');

  // 5.2 Aprovação e Execução por Linguagem Natural ("solta o aço")
  const approvalMockSock = {
    sendMessage: async (targetJid, content) => {
      return { key: { id: 'CONFIRM_123' } };
    }
  };

  const executed = await executiveCopilot.handleOwnerApproval({
    senderPhone: ownerPhone,
    messageText: 'Solta o aço, manda ver!',
    whatsappBotInstance: { sock: approvalMockSock }
  });

  assert.strictEqual(executed, true, 'Deve reconhecer "solta o aço" como aprovação e executar');
  const latestBrief = models.getLatestExecutiveBriefing(ownerPhone);
  assert.strictEqual(latestBrief.action_executed, 1, 'Briefing deve ser marcado como executado');
  console.log('✅ 5.2 Ordem em linguagem natural ("Solta o aço") executada e auditada no banco!');
  passed++;

  // Limpeza
  models.deleteCognitiveLead(testPhoneCust);
  models.deleteCognitiveLead(testPhoneVision);
  models.deleteCognitiveLead('5511999988773');
  models.deleteCognitiveLead('5511999988774');
  models.deleteCognitiveLead(testPhoneProp);

  console.log(`\n🎉 TODOS OS ${passed} TESTES DE EXPANSÃO DA INTELIGÊNCIA PASSARAM COM 100% DE SUCESSO!`);
}

runTests().catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

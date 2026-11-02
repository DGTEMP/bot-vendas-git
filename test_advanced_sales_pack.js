/**
 * test_advanced_sales_pack.js
 * Teste completo e rigoroso das 4 novas funcionalidades de vendas consultivas e alta performance:
 *  - ITEM 4: Agendamento de Demonstração / Call de Diagnóstico Técnico (Google Meet / Reuniões)
 *  - ITEM 1: Gerador Automático de Propostas Comerciais & Contratos em PDF / Link Interativo (/proposta/:token)
 *  - ITEM 2: Pipeline Kanban Visual Drag-and-Drop no CRM Cognitivo
 *  - ITEM 3: Calculadora Interativa de Escopo e Orçamento Técnico (Tech Scope Calculator)
 */

const assert = require('assert');
const path = require('path');
const http = require('http');

const models = require('./src/db/models');
const meetingService = require('./src/services/meetingService');
const proposalService = require('./src/services/proposalService');
const calcService = require('./src/services/techScopeCalculatorService');
const { createServer } = require('./src/server/app');

let server;
let baseUrl;

async function runTests() {
  console.log('====================================================');
  console.log('🚀 INICIANDO TESTES DO PACOTE DE VENDAS CONSULTIVAS TECH');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Inicia servidor de teste
  const app = createServer();
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const testPhone = '5511988887766';
  const testLeadName = 'Dr. Marcos Teste';

  // Limpeza de testes anteriores para garantir idempotência
  const db = require('./src/db/database');
  try {
    db.prepare('DELETE FROM scheduled_meetings WHERE meeting_date = ? OR lead_phone = ?').run('2026-11-10', testPhone);
    db.prepare('DELETE FROM commercial_proposals WHERE lead_phone = ?').run(testPhone);
    models.deleteCognitiveLead(testPhone);
  } catch (err) {
    console.error('Erro na limpeza inicial:', err.message);
  }

  try {
    // ----------------------------------------------------
    // TESTE 1: [ITEM 4] DETECÇÃO DE INTENÇÃO E PARSER DE DATAS (MEETING SERVICE)
    // ----------------------------------------------------
    console.log('📅 [TESTE 1] Detecção de Intenção de Call & Parser de Horários');
    const intent1 = meetingService.detectMeetingIntent('Podemos fazer uma call pelo Google Meet amanhã às 14h?');
    const intent2 = meetingService.detectMeetingIntent('Quero ver uma demonstração ao vivo do sistema');
    const intent3 = meetingService.detectMeetingIntent('quanto custa uma coxinha');

    assert.strictEqual(intent1, true, 'Deve detectar intenção de call/meet');
    assert.strictEqual(intent2, true, 'Deve detectar intenção de demonstração');
    assert.strictEqual(intent3, false, 'Não deve detectar em mensagem comum');

    const dt = meetingService.parseDateTimeFromText('vamos marcar amanhã às 15:30 para ver o app');
    assert.ok(dt.targetDate, 'Deve extrair targetDate para amanhã');
    assert.strictEqual(dt.targetTime, '15:30', 'Deve extrair horário 15:30');
    console.log('   └─ Detalhes: Intenção detectada e horário extraído: ' + dt.targetDate + ' ' + dt.targetTime);
    passed++;

    // ----------------------------------------------------
    // TESTE 2: [ITEM 4] AGENDAMENTO DE REUNIÃO GOOGLE MEET & SLOTS
    // ----------------------------------------------------
    console.log('📅 [TESTE 2] Criação de Reunião & Consulta de Slots Livres');
    const slots = models.getAvailableMeetingSlots('2026-11-10');
    assert.ok(Array.isArray(slots.available_slots), 'Deve retornar array de slots disponíveis');
    assert.ok(slots.available_slots.includes('14:00'), '14:00 deve estar disponível');

    const meeting = models.createMeeting({
      lead_phone: testPhone,
      lead_name: testLeadName,
      meeting_title: 'Diagnóstico de Arquitetura de Software',
      meeting_date: '2026-11-10',
      meeting_time: '14:00',
      duration_minutes: 30,
      topic_scope: 'App Delivery com Painel Web e Pix'
    });

    assert.ok(meeting && meeting.id, 'Reunião deve ser criada com ID');
    assert.strictEqual(meeting.lead_phone, testPhone);
    assert.ok(meeting.meet_url.includes('meet.google.com'), 'Deve gerar URL do Google Meet');

    // Verifica que 14:00 agora está ocupado no dia
    const slotsAfter = models.getAvailableMeetingSlots('2026-11-10');
    assert.strictEqual(slotsAfter.available_slots.includes('14:00'), false, '14:00 deve constar como ocupado');

    console.log('   └─ Detalhes: Reunião agendada com sucesso. Link Meet: ' + meeting.meet_url);
    passed++;

    // ----------------------------------------------------
    // TESTE 3: [ITEM 4] LEMBRETES AUTOMÁTICOS DE REUNIÃO (1H ANTES)
    // ----------------------------------------------------
    console.log('⏰ [TESTE 3] Lembrete Automático de Reuniões Pré-Call');
    // Cria uma reunião marcada para daqui a 30 minutos
    const in30min = new Date(Date.now() + 30 * 60 * 1000);
    const mDate = in30min.toISOString().split('T')[0];
    const mTime = `${String(in30min.getHours()).padStart(2, '0')}:${String(in30min.getMinutes()).padStart(2, '0')}`;
    const urgentMeeting = models.createMeeting({
      lead_phone: testPhone,
      lead_name: testLeadName,
      meeting_title: 'Call Iminente',
      meeting_date: mDate,
      meeting_time: mTime,
      meeting_datetime: in30min.toISOString().replace('T', ' ').substring(0, 19)
    });

    const pendingReminders = models.getUpcomingMeetingReminders(60);
    assert.ok(pendingReminders.some(m => m.id === urgentMeeting.id), 'Reunião de teste deve constar na fila de lembretes');

    const reminderResults = await meetingService.checkAndSendMeetingReminders();
    assert.ok(reminderResults.some(r => r.meetingId === urgentMeeting.id), 'Lembrete deve ter sido disparado');

    const updatedM = models.getMeetingById(urgentMeeting.id);
    assert.strictEqual(updatedM.reminder_sent, 1, 'Deve marcar reminder_sent como 1');
    console.log('   └─ Detalhes: Lembrete disparado com sucesso para ' + testPhone);
    passed++;

    // ----------------------------------------------------
    // TESTE 4: [ITEM 1] GERADOR DE PROPOSTAS COMERCIAIS & MINUTAS EM HTML
    // ----------------------------------------------------
    console.log('📄 [TESTE 4] Gerador de Propostas Comerciais & Minutas de Contrato');
    const proposal = proposalService.generateProposal(testPhone, {
      lead_name: testLeadName,
      lead_company: 'Marcos Imóveis & Tecnologia',
      project_title: 'Software Sob Medida de Gestão Imobiliária & Pix',
      category: 'SOFTWARE',
      investment_brl: 5800.0,
      timeline_weeks: 3
    });

    assert.ok(proposal && proposal.id, 'Proposta deve ser criada com ID');
    assert.ok(proposal.code.startsWith('PROP-2026-'), 'Código deve iniciar com PROP-2026-');
    assert.ok(proposal.token, 'Token público de acesso deve existir');
    assert.strictEqual(proposal.investment_brl, 5800.0);
    assert.ok(Array.isArray(proposal.deliverables), 'Deve conter array de entregáveis');
    assert.ok(Array.isArray(proposal.contract_clauses), 'Deve conter cláusulas contratuais');

    // Gera mensagem do WhatsApp
    const wppMsg = proposalService.generateWhatsAppShareMessage(proposal, 'https://meupainel.com');
    assert.ok(wppMsg.includes(proposal.code), 'Mensagem deve conter o código da proposta');
    assert.ok(wppMsg.includes('/proposta/' + proposal.token), 'Mensagem deve conter o link público da proposta');

    // Gera HTML interativo e validamos elementos essenciais
    const htmlPage = proposalService.renderProposalHtml(proposal, 'https://meupainel.com');
    assert.ok(htmlPage.includes(proposal.code), 'HTML deve conter código da proposta');
    assert.ok(htmlPage.includes('5.800,00'), 'HTML deve conter valor formatado');
    assert.ok(htmlPage.includes('Cláusula 1 - Propriedade Intelectual'), 'HTML deve conter cláusulas contratuais');
    assert.ok(htmlPage.includes('Aceitar Proposta &amp; Iniciar Projeto') || htmlPage.includes('Aceitar Proposta & Iniciar Projeto') || htmlPage.includes('Aceitar Proposta'), 'HTML deve conter botão de aceite');

    console.log('   └─ Detalhes: Proposta ' + proposal.code + ' gerada com link interativo /proposta/' + proposal.token);
    passed++;

    // ----------------------------------------------------
    // TESTE 5: [ITEM 1] VISUALIZAÇÃO PÚBLICA (/proposta/:token) E ACEITE DIGITAL
    // ----------------------------------------------------
    console.log('📄 [TESTE 5] Rota Pública /proposta/:token e Aceite Digital');
    // GET /proposta/:token
    const getRes = await fetch(`${baseUrl}/proposta/${proposal.token}`);
    assert.strictEqual(getRes.status, 200, 'Endpoint /proposta/:token deve responder 200 OK');
    const getHtml = await getRes.text();
    assert.ok(getHtml.includes(proposal.code), 'Página retornada deve conter a proposta');

    // POST /api/proposals/:token/accept
    const acceptRes = await fetch(`${baseUrl}/api/proposals/${proposal.token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testLeadName })
    });
    const acceptData = await acceptRes.json();
    assert.strictEqual(acceptData.success, true, 'Aceite digital deve ter sucesso');
    assert.strictEqual(acceptData.proposal.status, 'ACCEPTED', 'Status deve mudar para ACCEPTED');

    // Valida que o lead no CRM cognitivo avançou para CONVERTIDO
    const profAfter = models.getLeadCognitiveProfile(testPhone);
    assert.strictEqual(profAfter.buying_stage, 'CONVERTIDO', 'Estágio no CRM deve ser atualizado para CONVERTIDO');
    assert.strictEqual(profAfter.readiness_score, 100, 'Readiness score deve ser 100%');
    console.log('   └─ Detalhes: Proposta aceita digitalmente e lead convertido no CRM!');
    passed++;

    // ----------------------------------------------------
    // TESTE 6: [ITEM 2] PIPELINE KANBAN VISUAL & DRAG-AND-DROP TRANSITIONS
    // ----------------------------------------------------
    console.log('📊 [TESTE 6] Transições de Estágio do Pipeline Kanban');
    // Move o lead de teste para FECHAMENTO via API do Kanban
    const stageRes = await fetch(`${baseUrl}/api/cognitive/leads/${testPhone}/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'FECHAMENTO', readiness_score: 95 })
    });
    const stageData = await stageRes.json();
    assert.strictEqual(stageData.success, true);
    assert.strictEqual(stageData.profile.buying_stage, 'FECHAMENTO');
    assert.strictEqual(stageData.profile.readiness_score, 95);

    // Valida registro de memória episódica da transição
    const memories = models.getLeadEpisodicMemories(testPhone);
    assert.ok(memories.some(m => (m.fact_summary || '').includes('Estágio avançado no Kanban')), 'Deve registrar memória episódica do Kanban');
    console.log('   └─ Detalhes: Lead movido no Kanban para FECHAMENTO com memória auditada.');
    passed++;

    // ----------------------------------------------------
    // TESTE 7: [ITEM 3] CALCULADORA INTERATIVA DE ESCOPO TÉCNICO & ORÇAMENTO
    // ----------------------------------------------------
    console.log('🧮 [TESTE 7] Calculadora de Escopo & Preço (Tech Scope Calculator)');
    const calc = calcService.calculate({
      category: 'APP_MOBILE',
      complexity: 'INTERMEDIATE',
      addons: ['pix_gateway', 'realtime_web_panel', 'ai_integration'],
      slaTier: 'PROFESSIONAL',
      rushDelivery: false
    });

    assert.strictEqual(calc.category, 'APP_MOBILE');
    assert.strictEqual(calc.complexity, 'INTERMEDIATE');
    assert.ok(calc.pricingBreakdown.totalInvestmentBrl > 6000, 'Valor total deve somar base + addons + sla');
    assert.ok(calc.timeline.totalDays >= 20, 'Dias totais devem somar base + complexidade + addons');
    assert.ok(calc.deliverables.length >= 4, 'Deve conter lista detalhada de entregáveis');
    assert.ok(calc.timeline.milestones.length === 3, 'Deve gerar cronograma de 3 fases/sprints');

    // Teste com entrega urgente
    const calcRush = calcService.calculate({
      category: 'APP_MOBILE',
      complexity: 'INTERMEDIATE',
      addons: ['pix_gateway'],
      slaTier: 'STANDARD',
      rushDelivery: true
    });
    assert.ok(calcRush.pricingBreakdown.rushFee > 0, 'Deve aplicar taxa de urgência');
    assert.ok(calcRush.timeline.totalDays < calc.timeline.totalDays, 'Prazo de entrega urgente deve ser menor');

    // Teste de exportação direta para proposta comercial
    const exportedPropData = calcService.exportToProposalData(calc, {
      lead_phone: testPhone,
      lead_name: testLeadName
    });
    assert.strictEqual(exportedPropData.lead_phone, testPhone);
    assert.strictEqual(exportedPropData.investment_brl, calc.pricingBreakdown.totalInvestmentBrl);
    assert.strictEqual(exportedPropData.timeline_weeks, calc.timeline.timelineWeeks);
    console.log(`   └─ Detalhes: Cálculo executado: R$ ${calc.pricingBreakdown.totalInvestmentBrl} em ${calc.timeline.totalDays} dias úteis.`);
    passed++;

    // ----------------------------------------------------
    // TESTE 8: [ITEM 3] ENDPOINTS REST DA CALCULADORA E BOT DECK ACTIONS
    // ----------------------------------------------------
    console.log('🌐 [TESTE 8] Endpoints REST da Calculadora & Ações Bot Deck');
    const calcApiRes = await fetch(`${baseUrl}/api/scope-calculator/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'AI_AGENT',
        complexity: 'ADVANCED',
        addons: ['pix_gateway', 'whatsapp_bot'],
        slaTier: 'ENTERPRISE'
      })
    });
    const calcApiText = await calcApiRes.text();
    let calcApiData;
    try {
      calcApiData = JSON.parse(calcApiText);
    } catch (e) {
      console.error('CALC API STATUS:', calcApiRes.status, 'BODY:', calcApiText.substring(0, 200));
      throw e;
    }
    assert.strictEqual(calcApiData.success, true);
    assert.strictEqual(calcApiData.result.category, 'AI_AGENT');

    // Bot Deck: Ação SCHEDULE_MEETING
    const deckMeetRes = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'SCHEDULE_MEETING',
        payload: {
          phone: testPhone,
          name: testLeadName,
          title: 'Alinhamento Bot Deck',
          date: '2026-11-15',
          time: '16:00',
          duration: 30
        }
      })
    });
    const deckMeetData = await deckMeetRes.json();
    assert.strictEqual(deckMeetData.success, true);
    assert.ok(deckMeetData.message.includes('Reunião agendada'));

    // Bot Deck: Ação GENERATE_PROPOSAL
    const deckPropRes = await fetch(`${baseUrl}/api/botdeck/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'GENERATE_PROPOSAL',
        payload: {
          phone: testPhone,
          name: testLeadName,
          title: 'Software Bot Deck',
          category: 'SOFTWARE',
          investment: 7500
        }
      })
    });
    const deckPropData = await deckPropRes.json();
    assert.strictEqual(deckPropData.success, true);
    assert.ok(deckPropData.message.includes('Proposta comercial'));

    console.log('   └─ Detalhes: Endpoints REST e ações do Bot Deck integradas e respondendo perfeitamente.');
    passed++;

  } catch (err) {
    console.error(`\n❌ FALHA NO TESTE: ${err.message}`);
    console.error(err.stack);
    failed++;
  } finally {
    try {
      db.prepare('DELETE FROM scheduled_meetings WHERE lead_phone = ?').run(testPhone);
      db.prepare('DELETE FROM commercial_proposals WHERE lead_phone = ?').run(testPhone);
      models.deleteCognitiveLead(testPhone);
    } catch (_) {}
    if (server) server.close();
  }

  console.log('\n====================================================');
  console.log('📊 RELATÓRIO FINAL DO PACOTE DE VENDAS CONSULTIVAS:');
  console.log('====================================================');
  console.log(`Total: ${passed + failed} | ✅ Sucesso: ${passed} | ❌ Falhas: ${failed}`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runTests();

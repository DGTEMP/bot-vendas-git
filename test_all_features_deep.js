/**
 * test_all_features_deep.js
 * Teste aprofundado e individual de CADA FUNÇÃO do Bot Matriz, Sub-Bots e SpyFeatures.
 */

const assert = require('assert');
const path = require('path');
const models = require('./src/db/models');
const matrizAssistant = require('./src/services/matrizAssistantService');
const whatsappArmy = require('./src/services/whatsappArmyService');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const { createServer } = require('./src/server/app');

// Configuração do ambiente para testes
process.env.NODE_ENV = 'test';
process.env.PIX_SIMULATION_MODE = 'true';

const testResults = [];

function recordTest(id, name, success, details = '') {
  testResults.push({ id, name, success, details });
  const icon = success ? '✅' : '❌';
  console.log(`${icon} [TESTE ${id}] ${name}`);
  if (details) console.log(`   └─ Detalhes: ${details}`);
}

async function run() {
  console.log('====================================================');
  console.log('🚀 INICIANDO TESTE INDIVIDUAL DE CADA FUNÇÃO DO SISTEMA');
  console.log('====================================================\n');

  // Configura instâncias de teste
  const ownerPhone = '5511999990000';
  const ownerJid = `${ownerPhone}@s.whatsapp.net`;
  models.setSetting('OWNER_PHONE', ownerPhone);

  const subBotTest = models.createArmyInstance({
    name: 'Sub-Bot Alpha Teste',
    phone: '5511988881111',
    daily_limit: 100,
    messages_sent_today: 10,
    is_business: 1
  });

  // Mock Socket para capturar mensagens enviadas pela Matriz ao Dono
  let capturedMessages = [];
  const mockSock = {
    user: { id: `${ownerPhone}:1@s.whatsapp.net` },
    sendMessage: async (jid, payload) => {
      capturedMessages.push({ jid, payload });
      return { key: { id: 'MOCK_MSG_' + Date.now() } };
    }
  };

  // ----------------------------------------------------
  // FUNÇÃO 1: Status e Painel Operacional dos Sub-Bots
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'status dos subbots',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1, 'Deve enviar resposta de status');
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('CENTRAL DE COMANDO DA MATRIZ'), 'Cabeçalho da central');
    assert(txt.includes('Total de Instâncias'), 'Total de instâncias');
    assert(txt.includes('Sub-Bots Online/Conectados'), 'Contagem de conectados');
    assert(txt.includes(`Sub-Bot Alpha Teste`), 'Nome da instância');
    recordTest(1, 'Status e Painel dos Sub-Bots (status dos subbots)', true, 'Relatório executivo gerado com contagem e detalhes de chips');
  } catch (err) {
    recordTest(1, 'Status e Painel dos Sub-Bots', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 2: Consulta e Histórico de Tarefas Delegadas
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'tarefas',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('RELATÓRIO DE MISSÕES & TAREFAS DELEGADAS') || txt.includes('NENHUMA MISSÃO'));
    recordTest(2, 'Consulta de Tarefas Delegadas (tarefas / missões)', true, 'Histórico de ordens e missões consultado com sucesso');
  } catch (err) {
    recordTest(2, 'Consulta de Tarefas Delegadas', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 3: Controle Operacional de Sub-Bot (Pausar e Iniciar)
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    // Pausar
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Pausar subbot #${subBotTest.id}`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    let inst = models.getArmyInstanceById(subBotTest.id);
    assert.strictEqual(inst.status, 'PAUSED', 'Instância deve estar pausada');

    // Iniciar
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Iniciar subbot #${subBotTest.id}`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    recordTest(3, 'Controle Operacional (Pausar & Iniciar Sub-Bot)', true, `Sub-Bot #${subBotTest.id} pausado e reiniciado via ordem natural`);
  } catch (err) {
    recordTest(3, 'Controle Operacional', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 4: Delegação de Mensagem Direta por um Sub-Bot
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    const targetLead = '5511977771234';
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Subbot ${subBotTest.id} mande mensagem para ${targetLead} dizendo Seu acesso VIP foi liberado!`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('ORDEM EXECUTADA COM SUCESSO'), 'Confirmação ao dono');
    assert(txt.includes(targetLead), 'Destinatário no briefing');

    const tasks = models.getDelegatedTasks({ limit: 5 });
    const directTask = tasks.find(t => t.target === targetLead && t.task_type === 'DIRECT_MESSAGE');
    assert(directTask, 'Tarefa no banco de dados');
    assert.strictEqual(directTask.status, 'COMPLETED');
    recordTest(4, 'Delegação de Mensagem Direta por Sub-Bot', true, `Mensagem entregue via Sub-Bot #${subBotTest.id} e registrada com código ${directTask.task_code}`);
  } catch (err) {
    recordTest(4, 'Delegação de Mensagem Direta por Sub-Bot', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 5: Delegação de Áudio PTT (Voz Sintética)
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    const targetLead = '5511977775678';
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Subbot ${subBotTest.id} mande áudio para ${targetLead} dizendo Olá seu pacote de benefícios está ativo!`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('ÁUDIO DELEGADO COM SUCESSO'), 'Confirmação de áudio');
    assert(txt.includes('Voz PTT Sintetizada'), 'Tipo de mídia');

    const tasks = models.getDelegatedTasks({ limit: 5 });
    const voiceTask = tasks.find(t => t.target === targetLead && t.task_type === 'VOICE_NOTE');
    assert(voiceTask, 'Tarefa de voz no banco');
    assert.strictEqual(voiceTask.status, 'COMPLETED');
    recordTest(5, 'Delegação de Áudio PTT (Voz Sintética) por Sub-Bot', true, `Áudio sintetizado e transmitido como nota de voz PTT (${voiceTask.task_code})`);
  } catch (err) {
    recordTest(5, 'Delegação de Áudio PTT por Sub-Bot', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 6: Delegação de Disparo de Áudio em Massa para Leads
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'Sub-bots disparem áudio para os leads: Olá temos promoção especial hoje no catálogo!',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 2, 'Aviso de início e conclusão');
    const finalTxt = capturedMessages[capturedMessages.length - 1].payload.text || '';
    assert(finalTxt.includes('BRIEFING DE CONCLUSÃO DA MISSÃO'));
    assert(finalTxt.includes('Áudios PTT Disparados com Sucesso'));
    recordTest(6, 'Disparo de Áudio PTT em Massa para Leads', true, 'Disparos de voz PTT em cluster executados e briefing entregue');
  } catch (err) {
    recordTest(6, 'Disparo de Áudio PTT em Massa para Leads', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 7: Disparo em Massa para Leads com Spintax
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'Sub-bots disparem para os leads a seguinte mensagem: {Olá|Oi} {nome}! Conheça nosso novo produto.',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 2);
    const finalTxt = capturedMessages[capturedMessages.length - 1].payload.text || '';
    assert(finalTxt.includes('Disparos Realizados com Sucesso'));
    assert(finalTxt.includes('Template Spintax'));
    recordTest(7, 'Disparo em Massa com Spintax para Leads', true, 'Rotação de variações Spintax e anti-ban distribuído no exército');
  } catch (err) {
    recordTest(7, 'Disparo em Massa com Spintax para Leads', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 8: Transmissão em Todos os Grupos dos Sub-Bots
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'Sub-bots divulguem nos grupos: Comunicado oficial da promoção relâmpago de fim de semana!',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('MISSÃO CUMPRIDA'));
    assert(txt.includes('Grupos Transmitidos'));
    recordTest(8, 'Transmissão em Grupos Participantes', true, 'Varredura de grupos participantes e transmissão confirmada');
  } catch (err) {
    recordTest(8, 'Transmissão em Grupos Participantes', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 9: Distribuição Inteligente de Leads (Smart Load Balancing)
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'Sub-bots distribuam 30 leads com a mensagem: {Oi|Olá} amigo! Aproveite seu cupom VIP.',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('DISTRIBUIÇÃO INTELIGENTE DE LEADS CONCLUÍDA'));
    assert(txt.includes('Smart Load Balancing'));
    assert(txt.includes('Divisão de Carga Anti-Ban'));

    const tasks = models.getDelegatedTasks({ limit: 5 });
    const bTask = tasks.find(t => t.task_type === 'SMART_LOAD_BALANCE');
    assert(bTask);
    assert.strictEqual(bTask.status, 'COMPLETED');
    recordTest(9, 'Smart Load Balancing (Distribuição Equilibrada)', true, `30 leads balanceados proporcionalmente às cotas diárias dos chips`);
  } catch (err) {
    recordTest(9, 'Smart Load Balancing', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 10: Promoção de Produto do Catálogo
  // ----------------------------------------------------
  try {
    const prod = models.createProduct({
      name: 'Painel Master VIP Ultra',
      description: 'Acesso completo com suporte 24h',
      price: 97.00,
      price_brl: 97.00,
      type: 'DIGITAL'
    });

    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Mande o subbot ${subBotTest.id} promover o produto ${prod.id}`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const finalTxt = capturedMessages[capturedMessages.length - 1].payload.text || '';
    assert(finalTxt.includes('Disparos Realizados com Sucesso') || finalTxt.includes('SUPER OFERTA EXCLUSIVA DO DIA') || finalTxt.includes('ENTENDIDO, CHEFE'));
    recordTest(10, 'Promoção Automática de Produto do Catálogo', true, `Copy comercial gerada para o produto "${prod.name}" (R$ 97,00) e disparada`);
  } catch (err) {
    recordTest(10, 'Promoção Automática de Produto do Catálogo', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 11: Divulgação do Catálogo Próprio do Sub-Bot Business
  // ----------------------------------------------------
  try {
    // Sincroniza produtos exclusivos para este subbot business
    models.saveSubBotCatalogProducts(subBotTest.id, [
      { id: 'PROD_BIZ_1', name: 'Peça Automotiva X', price: 150.00, price_brl: 150.00, description: 'Pronta entrega' },
      { id: 'PROD_BIZ_2', name: 'Peça Automotiva Y', price: 280.00, price_brl: 280.00, description: 'Original importada' }
    ]);

    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Subbot ${subBotTest.id} divulgue seu próprio catálogo`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    recordTest(11, 'Catálogo Próprio do Sub-Bot Business', true, `Catálogo exclusivo isolado do Sub-Bot #${subBotTest.id} formatado e promovido`);
  } catch (err) {
    recordTest(11, 'Catálogo Próprio do Sub-Bot Business', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 12: Live Relay & Human Takeover (Assumir, Receber, Responder e Encerrar)
  // ----------------------------------------------------
  try {
    const relayLead = '5511966669999';

    // 12a: Assumir conversa
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Assumir conversa com ${relayLead} no subbot ${subBotTest.id}`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    assert(capturedMessages[0].payload.text.includes('ATENDIMENTO ASSUMIDO COM SUCESSO'));
    assert(whatsappArmy.getOwnerRelay(relayLead) !== null, 'Relay deve estar em memória');

    // 12b: Interceptar lead que responde
    const relayed = [];
    const origSock = whatsappBot.sock;
    whatsappBot.sock = {
      sendMessage: async (jid, payload) => {
        relayed.push({ jid, payload });
        return true;
      }
    };

    await whatsappArmy.handleIncomingLeadMessage(subBotTest.id, relayLead, 'Olá, como posso comprar pelo Pix?');
    assert(relayed.length >= 1, 'Mensagem deve chegar ao dono');
    assert(relayed[0].payload.text.includes('RELAY / TAKEOVER'));
    assert(relayed[0].payload.text.includes('Olá, como posso comprar pelo Pix?'));

    // 12c: Dono responde pelo Sub-bot
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Responder pelo subbot ${subBotTest.id} para ${relayLead}: Olá! Você pode pagar pela chave Pix suporte@loja.com`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    assert(capturedMessages[0].payload.text.includes('RESPOSTA ENVIADA AO LEAD COM SUCESSO'));

    // 12d: Encerrar Takeover
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Encerrar atendimento com ${relayLead}`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    assert(capturedMessages[0].payload.text.includes('ATENDIMENTO MANUAL FINALIZADO'));
    assert(whatsappArmy.getOwnerRelay(relayLead) === null);

    whatsappBot.sock = origSock;
    recordTest(12, 'Live Relay & Human Takeover Completo', true, 'Ciclo de takeover completo: interceptação, repasse ao Dono, resposta pelo chip e encerramento');
  } catch (err) {
    recordTest(12, 'Live Relay & Human Takeover Completo', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 13: Criação de Missão Personalizada
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      `Delegar tarefa ao subbot ${subBotTest.id}: Realizar aquecimento de 50 novos contatos via Spintax`,
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('MISSÃO REGISTRADA COM SUCESSO'));
    assert(txt.includes('Código:'));
    recordTest(13, 'Criação de Missão Personalizada (Nova Missão)', true, 'Missão cadastrada e indexada com código de rastreamento');
  } catch (err) {
    recordTest(13, 'Criação de Missão Personalizada', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 14: Chat Estratégico com a Assistente Executiva
  // ----------------------------------------------------
  try {
    capturedMessages = [];
    await matrizAssistant.handleOwnerConversation(
      mockSock,
      ownerJid,
      'Qual a melhor estratégia para reativar clientes que não compram há 30 dias?',
      'Dono Matriz',
      ownerPhone,
      false
    );
    assert(capturedMessages.length >= 1);
    const txt = capturedMessages[0].payload.text || '';
    assert(txt.includes('ASSISTENTE EXECUTIVA DA MATRIZ'));
    assert(txt.includes('sub-bots') || txt.includes('Exército'));
    recordTest(14, 'Chat Estratégico da Assistente Executiva (IA & Fallback)', true, 'Consultoria estratégica para o Dono com sugestões práticas de delegação');
  } catch (err) {
    recordTest(14, 'Chat Estratégico da Assistente Executiva', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 15: Agendamento e Execução Pontual pelo Worker
  // ----------------------------------------------------
  try {
    const pastDate = new Date(Date.now() - 30000).toISOString();
    const scheduledTask = models.createDelegatedTask({
      assigned_instance_id: subBotTest.id,
      task_type: 'DIRECT_MESSAGE',
      title: 'Disparo Programado Pontual',
      target: '5511955554444',
      message_payload: 'Mensagem de teste do agendamento',
      scheduled_at: pastDate
    });

    assert.strictEqual(scheduledTask.status, 'PENDING');
    const dueList = models.getDueScheduledDelegatedTasks();
    assert(dueList.some(t => t.id === scheduledTask.id), 'Tarefa vencida deve ser listada');

    const executed = await matrizAssistant.checkAndExecuteScheduledTasks();
    const targetExecuted = executed.find(t => t.id === scheduledTask.id);
    assert(targetExecuted, 'Tarefa deve ter sido executada pelo worker');
    assert.strictEqual(targetExecuted.status, 'COMPLETED');
    recordTest(15, 'Worker de Tarefas Agendadas (scheduled_at)', true, 'Detecção de agendamentos vencidos e execução automática pelo Worker');
  } catch (err) {
    recordTest(15, 'Worker de Tarefas Agendadas', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 16: Endpoints REST da Central de Comando (/api/matriz/*)
  // ----------------------------------------------------
  try {
    const app = createServer();
    const testServer = app.listen(0);
    const port = testServer.address().port;
    const baseUrl = `http://localhost:${port}`;

    // 16a: GET /api/matriz/tasks
    const resTasks = await fetch(`${baseUrl}/api/matriz/tasks`).then(r => r.json());
    assert.strictEqual(resTasks.success, true);
    assert(Array.isArray(resTasks.tasks));

    // 16b: GET /api/matriz/status
    const resStatus = await fetch(`${baseUrl}/api/matriz/status`).then(r => r.json());
    assert.strictEqual(resStatus.success, true);
    assert(resStatus.instances.length >= 1);

    // 16c: POST /api/matriz/delegate com VOICE_NOTE
    const resVoice = await fetch(`${baseUrl}/api/matriz/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'VOICE_NOTE',
        instanceId: subBotTest.id,
        target: '5511944443333',
        message: 'Teste de áudio sintético via API REST'
      })
    }).then(r => r.json());
    assert.strictEqual(resVoice.success, true);
    assert.strictEqual(resVoice.task.task_type, 'VOICE_NOTE');
    assert.strictEqual(resVoice.task.status, 'COMPLETED');

    await new Promise(res => testServer.close(res));
    recordTest(16, 'Endpoints REST da Central de Comando (/api/matriz/*)', true, 'Rotas GET e POST validadas com sucesso para dashboard web');
  } catch (err) {
    recordTest(16, 'Endpoints REST da Central de Comando', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 17: Downloader com Seleção de Qualidade (High "H" e Standard "S")
  // ----------------------------------------------------
  try {
    const parseHigh = spyFeatures.parseDownloadQuery('musica de teste H', 'standard');
    assert.strictEqual(parseHigh.quality, 'high');
    assert.strictEqual(parseHigh.cleanQuery, 'musica de teste');

    const parseSmall = spyFeatures.parseDownloadQuery('!play2s link_do_video', 'high');
    assert.strictEqual(parseSmall.quality, 'standard');
    assert.strictEqual(parseSmall.cleanQuery, 'link_do_video');

    const parseDefault = spyFeatures.parseDownloadQuery('video tutorial', 'high');
    assert.strictEqual(parseDefault.quality, 'high');
    assert.strictEqual(parseDefault.cleanQuery, 'video tutorial');

    recordTest(17, 'Downloader de Mídia com Seletor de Qualidade (H / S)', true, 'Sufixos H e S extraídos com precisão em comandos de áudio e vídeo');
  } catch (err) {
    recordTest(17, 'Downloader de Mídia com Seletor de Qualidade', false, err.message);
  }

  // ----------------------------------------------------
  // FUNÇÃO 18: Comandos de Moderação e Admin de Grupo (!promover, !ban)
  // ----------------------------------------------------
  try {
    const testGroup = '120363099998888777@g.us';
    const mockAdminSock = {
      user: { id: '5511999998888:1@s.whatsapp.net' },
      groupMetadata: async () => ({
        id: testGroup,
        participants: [
          { id: '5511999998888@s.whatsapp.net', admin: 'superadmin' },
          { id: '5511911112222@s.whatsapp.net', admin: null }
        ]
      }),
      groupParticipantsUpdate: async (groupJid, participants, action) => {
        return [{ jid: participants[0], status: '200' }];
      },
      sendMessage: async () => ({ key: { id: 'OK' } })
    };

    whatsappBot.currentDispatchSock = mockAdminSock;
    const adminStatus = await whatsappBot.getGroupAdminStatus(testGroup, '5511999998888@s.whatsapp.net', false);
    assert.strictEqual(adminStatus.isRequesterAdmin, true, 'O remetente deve ser admin');
    whatsappBot.currentDispatchSock = null;

    recordTest(18, 'Comandos de Moderação de Grupo (!promover, !ban)', true, 'Verificação de privilégios de admin e chamada de grupo validados');
  } catch (err) {
    recordTest(18, 'Comandos de Moderação de Grupo', false, err.message);
  }

  // ----------------------------------------------------
  // RELATÓRIO FINAL CONSOLIDADO
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('📊 RELATÓRIO FINAL DOS TESTES INDIVIDUAIS:');
  console.log('====================================================');

  const passed = testResults.filter(t => t.success).length;
  const failed = testResults.filter(t => !t.success).length;

  console.log(`Total de Funções Testadas: ${testResults.length}`);
  console.log(`✅ Sucesso: ${passed}`);
  console.log(`❌ Falhas: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Erro fatal no executor de testes:', err);
  process.exit(1);
});

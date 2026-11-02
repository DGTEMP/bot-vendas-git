const models = require('../db/models');
const whatsappArmyService = require('./whatsappArmyService');
const config = require('../config');

class MatrizAssistantService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || config.ai?.endpoint || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || config.ai?.key || 'sk-antigravity-master-key';
  }

  /**
   * Ponto de entrada para quando o Dono (Owner) conversa com o Bot Matriz
   */
  async handleOwnerConversation(sock, from, text, senderName, senderPhone, isGroup = false) {
    const rawText = String(text || '').trim();
    if (!rawText) return false;

    const lower = rawText.toLowerCase();

    // 1. Relatório Operacional e Status dos Sub-Bots
    if (
      /^(?:!|\/)?(?:status\s*dos?\s*sub-?bots?|painel\s*sub-?bots?|como\s*est[aã]o\s*os\s*sub-?bots?|quem\s*t[aá]\s*online|quem\s*est[aá]\s*online|sub-?bots?\s*status|situa[cç][aã]o\s*do\s*ex[eé]rcito|relat[oó]rio\s*dos?\s*bots?)$/i.test(lower) ||
      lower === '!painelsubbots' || lower === '!subbots' || lower === '!bots' || lower === '!statusbots'
    ) {
      return this.handleSubBotsStatusReport(sock, from);
    }

    // 2. Consulta de Tarefas Delegadas / Histórico de Missões
    if (
      /^(?:!|\/)?(?:tarefas|miss[oõ]es|tarefas\s*delegadas|quais\s*(?:s[aã]o\s*as\s*)?tarefas|tarefas\s*pendentes|hist[oó]rico\s*de\s*tarefas)$/i.test(lower) ||
      lower === '!tarefas' || lower === '!missoes'
    ) {
      return this.handleListDelegatedTasks(sock, from);
    }

    // 3. Controle Direto de Sub-Bot (Pausar, Iniciar, Reiniciar)
    const controlMatch = rawText.match(/^(?:!|\/)?(pausar|pause|parar|desconectar|iniciar|inicie|ligar|conectar|reiniciar|restart)\s*(?:o\s*)?sub-?bot\s*#?(\d+)/i);
    if (controlMatch) {
      const action = controlMatch[1].toLowerCase();
      const instanceId = parseInt(controlMatch[2], 10);
      return this.handleSubBotControl(sock, from, instanceId, action);
    }

    // 4. Delegação: Envio de Mensagem Direta por um Sub-Bot específico para um número
    // Ex: "Subbot 2 mande mensagem para 5511999998888 dizendo Olá seu produto está a caminho"
    // Ex: "!delegar 2 5511999998888 Olá tudo bem"
    // Ex: "Mande o subbot 1 enviar para 551188887777: Olá"
    const directMsgMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:para\s*)?(?:o\s*)?sub-?bot\s*#?(\d+)\s*(?:enviar|mandar|msg)?\s*(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+)|(?:mande\s*(?:o\s*)?sub-?bot|sub-?bot)\s*#?(\d+)\s*(?:mande|manda|envie|dispare|avise|fale|enviar|mandar)\s*(?:mensagem\s*)?(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+)|!delegar\s+#?(\d+)\s+(\+?\d{8,15})\s+(.+))$/is
    );
    if (directMsgMatch) {
      const instanceId = parseInt(directMsgMatch[1] || directMsgMatch[4] || directMsgMatch[7], 10);
      const targetPhone = (directMsgMatch[2] || directMsgMatch[5] || directMsgMatch[8]).replace(/\D/g, '');
      const messageBody = (directMsgMatch[3] || directMsgMatch[6] || directMsgMatch[9]).trim();
      return this.delegateDirectMessage(sock, from, instanceId, targetPhone, messageBody);
    }

    // 5. Delegação: Divulgação em Massa para Leads via Sub-Bots
    // Ex: "Mande os sub-bots divulgarem a mensagem '...' para os leads"
    // Ex: "Sub-bots disparem para os leads a promoção..."
    // Ex: "!delegar leads Mensagem com {Oi|Olá}"
    // Ex: "Subbot 2 dispare para os leads: Mensagem..."
    const broadcastLeadsMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:para\s*)?(?:todos\s*os\s*sub-?bots|sub-?bots?|leads)\s*(?:divulgar|disparar|enviar)?[:\s]+(.+)|(?:mande\s*(?:os\s*)?sub-?bots|sub-?bots|todos\s*os\s*sub-?bots)\s*(?:divulgarem|dispararem|enviarem|disparem|divulguem)\s*(?:para\s*(?:os\s*)?leads)?[:\s]+(.+)|sub-?bot\s*#?(\d+)\s*(?:dispare|divulgue|envie)\s*(?:para\s*(?:os\s*)?leads)[:\s]+(.+)|!delegar\s+leads?\s+(.+))$/is
    );
    if (broadcastLeadsMatch) {
      const specificId = broadcastLeadsMatch[3] ? parseInt(broadcastLeadsMatch[3], 10) : null;
      const messageText = (broadcastLeadsMatch[1] || broadcastLeadsMatch[2] || broadcastLeadsMatch[4] || broadcastLeadsMatch[5]).trim();
      return this.delegateBroadcastLeads(sock, from, messageText, specificId);
    }

    // 6. Delegação: Divulgação em Grupos via Sub-Bots
    // Ex: "Sub-bots divulguem nos grupos: Promoção relâmpago..."
    // Ex: "Mande os subbots transmitirem nos grupos a mensagem..."
    const broadcastGroupsMatch = rawText.match(
      /^(?:!|\/)?(?:(?:mande\s*(?:os\s*)?sub-?bots|sub-?bots)\s*(?:divulgarem|enviarem|disparem|divulguem|transmitirem)\s*nos\s*grupos[:\s]+(.+)|!delegar\s+grupos?\s+(.+))$/is
    );
    if (broadcastGroupsMatch) {
      const messageText = (broadcastGroupsMatch[1] || broadcastGroupsMatch[2]).trim();
      return this.delegateBroadcastGroups(sock, from, messageText);
    }

    // 7. Delegação: Promoção de Produto do Catálogo via Sub-Bots
    // Ex: "Mande o subbot 2 promover o produto 1"
    // Ex: "Sub-bots promovam o produto 2"
    const promoProdMatch = rawText.match(
      /^(?:!|\/)?(?:(?:mande\s*(?:o\s*)?sub-?bot\s*#?(\d+)|sub-?bots)\s*promover(?:em)?\s*(?:o\s*produto)?\s*#?(\d+|[a-zA-Z0-9_-]+)|!delegar\s+promover\s+#?(\d+))$/i
    );
    if (promoProdMatch) {
      const instanceId = promoProdMatch[1] ? parseInt(promoProdMatch[1], 10) : null;
      const prodIdentifier = promoProdMatch[2] || promoProdMatch[3];
      return this.delegateProductPromotion(sock, from, prodIdentifier, instanceId);
    }

    // 8. Delegação: Sub-Bot Business divulgar seu próprio catálogo exclusivo
    // Ex: "Subbot 2 divulgue seu próprio catálogo"
    // Ex: "Mande o subbot 2 divulgar suas peças"
    const businessCatalogMatch = rawText.match(
      /^(?:!|\/)?(?:sub-?bot\s*#?(\d+)\s*(?:promova|divulgue|mostre|dispare)\s*(?:o\s*seu|seu\s*pr[oó]prio|suas\s*pe[cç]as)?\s*cat[aá]logo|mande\s*(?:o\s*)?sub-?bot\s*#?(\d+)\s*divulgar\s*(?:o\s*)?cat[aá]logo)$/i
    );
    if (businessCatalogMatch) {
      const instanceId = parseInt(businessCatalogMatch[1] || businessCatalogMatch[2], 10);
      return this.delegateSubBotBusinessCatalog(sock, from, instanceId);
    }

    // 9. Delegação Genérica de Tarefa / Missão Personalizada
    // Ex: "Delegar tarefa ao subbot 2: Aquecer novos leads de marketing"
    // Ex: "Nova missão para os sub-bots: Fazer triagem de suporte"
    const customTaskMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:tarefa|miss[aã]o)?\s*(?:ao|para|pro)?\s*(?:o\s*)?sub-?bot\s*#?(\d+|todos)?[:\s]+(.+)|nova\s*miss[aã]o\s*(?:para\s*os?\s*sub-?bots?|sub-?bot\s*#?(\d+))?[:\s]+(.+))$/is
    );
    if (customTaskMatch) {
      const instanceStr = customTaskMatch[1] || customTaskMatch[3];
      const instanceId = (instanceStr && instanceStr.toLowerCase() !== 'todos') ? parseInt(instanceStr, 10) : null;
      const taskDescription = (customTaskMatch[2] || customTaskMatch[4]).trim();
      return this.createCustomMission(sock, from, taskDescription, instanceId);
    }

    // 10. Diálogo Estratégico, Dúvidas de Vendas e Assistência Executiva da Matriz
    return this.handleExecutiveStrategicChat(sock, from, rawText, senderName);
  }

  // ==============================================================
  // 1. DELEGAÇÃO DE MENSAGEM DIRETA A UM SUB-BOT
  // ==============================================================
  async delegateDirectMessage(sock, from, instanceId, targetPhone, messageBody) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    const inst = models.getArmyInstanceById(instanceId);

    if (!inst) {
      return sock.sendMessage(from, {
        text: `⚠️ *Sub-Bot #${instanceId} não encontrado no sistema.*\n\n` +
          `Utilize *status dos subbots* para visualizar os chips disponíveis.`
      });
    }

    // Registra a tarefa no banco de dados
    const task = models.createDelegatedTask({
      assigned_instance_id: instanceId,
      task_type: 'DIRECT_MESSAGE',
      title: `Envio de Mensagem Direta para +${cleanPhone}`,
      description: `Disparo ordenado pelo Dono para o contato +${cleanPhone}`,
      target: cleanPhone,
      message_payload: messageBody,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    try {
      const startTime = Date.now();
      const sendResult = await whatsappArmyService.sendMessageViaInstance(instanceId, cleanPhone, messageBody);
      const elapsed = Date.now() - startTime;

      models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: `Mensagem enviada com sucesso em ${elapsed}ms via Sub-Bot #${instanceId} (${inst.name})`
      });

      const confirmationMsg =
        `🫡 *ORDEM EXECUTADA COM SUCESSO, CHEFE!* 🫡\n\n` +
        `📋 *Missão:* \`${task.task_code}\` (Mensagem Direta)\n` +
        `🤖 *Sub-Bot #${instanceId}:* ${inst.name}\n` +
        `📱 *Destinatário:* +${cleanPhone}\n` +
        `⏱️ *Tempo de Resposta:* ${elapsed}ms\n` +
        `💬 *Mensagem Enviada:*\n` +
        `"${messageBody}"\n\n` +
        `✅ *Status:* Concluída e registrada no relatório de atividades.`;

      return sock.sendMessage(from, { text: confirmationMsg });
    } catch (err) {
      models.updateDelegatedTask(task.id, {
        status: 'FAILED',
        result_summary: `Falha no envio: ${err.message}`
      });

      return sock.sendMessage(from, {
        text: `❌ *FALHA NA EXECUÇÃO DA TAREFA* [${task.task_code}]\n\n` +
          `🤖 *Sub-Bot #${instanceId}:* ${inst.name}\n` +
          `⚠️ *Motivo:* ${err.message}\n\n` +
          `_Verifique se o chip está conectado ou envie "status dos subbots"._`
      });
    }
  }

  // ==============================================================
  // 2. DELEGAÇÃO DE DISPARO EM MASSA PARA LEADS (SPINTAX)
  // ==============================================================
  async delegateBroadcastLeads(sock, from, messageText, specificInstanceId = null) {
    const taskTitle = specificInstanceId
      ? `Disparo para Leads via Sub-Bot #${specificInstanceId}`
      : `Disparo para Leads via Todos os Sub-Bots (Cluster)`;

    const task = models.createDelegatedTask({
      assigned_instance_id: specificInstanceId,
      task_type: 'BROADCAST_LEADS',
      title: taskTitle,
      description: `Divulgação em massa para base de leads com Spintax`,
      message_payload: messageText,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    await sock.sendMessage(from, {
      text: `🫡 *ENTENDIDO, CHEFE! DELEGANDO DISPARO AOS SUB-BOTS...*\n\n` +
        `📋 *Missão:* \`${task.task_code}\`\n` +
        `🎯 *Alvo:* Base de Leads Ativos\n` +
        `🤖 *Operação:* ${specificInstanceId ? `Exclusivo Sub-Bot #${specificInstanceId}` : 'Distribuído em todo o Exército de Sub-Bots'}\n` +
        `⏳ *Iniciando envios agora...*`
    });

    try {
      const res = await whatsappArmyService.broadcastViaAllSubBots({
        message: messageText,
        targetType: 'leads',
        specificInstanceId
      });

      models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: `Disparado com sucesso para ${res.totalSent || 0} leads utilizando ${res.activeBotsCount || 0} sub-bots.`
      });

      const reportMsg =
        `📊 *BRIEFING DE CONCLUSÃO DA MISSÃO [${task.task_code}]*\n\n` +
        `✅ *Status:* Disparos Realizados com Sucesso!\n` +
        `👥 *Leads Alcançados:* ${res.totalSent || 0}\n` +
        `🤖 *Sub-Bots Utilizados:* ${res.activeBotsCount || 0}\n` +
        `📝 *Template Spintax:* Ativado e rotacionado anti-ban.\n\n` +
        `👑 _Todos os leads foram distribuídos e as respostas serão convertidas automaticamente pelo Funil Inteligente!_`;

      return sock.sendMessage(from, { text: reportMsg });
    } catch (err) {
      models.updateDelegatedTask(task.id, {
        status: 'FAILED',
        result_summary: `Falha: ${err.message}`
      });

      return sock.sendMessage(from, {
        text: `⚠️ *Erro ao executar disparo pelos sub-bots:* ${err.message}`
      });
    }
  }

  // ==============================================================
  // 3. DELEGAÇÃO DE TRANSMISSÃO EM GRUPOS
  // ==============================================================
  async delegateBroadcastGroups(sock, from, messageText) {
    const task = models.createDelegatedTask({
      assigned_instance_id: null,
      task_type: 'BROADCAST_GROUPS',
      title: 'Transmissão em Todos os Grupos dos Sub-Bots',
      description: 'Envio de comunicado oficial nos grupos conectados',
      message_payload: messageText,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    try {
      const res = await whatsappArmyService.broadcastViaAllSubBots({
        message: messageText,
        targetType: 'groups'
      });

      models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: `Transmitido para ${res.totalSent || 0} grupos.`
      });

      return sock.sendMessage(from, {
        text: `🫡 *MISSÃO CUMPRIDA [${task.task_code}]!*\n\n` +
          `📢 *Grupos Transmitidos:* ${res.totalSent || 0}\n` +
          `🤖 *Sub-Bots em Ação:* ${res.activeBotsCount || 0}\n` +
          `💬 *Conteúdo:* "${messageText.slice(0, 80)}..."\n\n` +
          `✅ Os comunicados já foram entregues aos grupos participantes!`
      });
    } catch (err) {
      models.updateDelegatedTask(task.id, { status: 'FAILED', result_summary: err.message });
      return sock.sendMessage(from, { text: `❌ Erro na transmissão em grupos: ${err.message}` });
    }
  }

  // ==============================================================
  // 4. DELEGAÇÃO DE PROMOÇÃO DE PRODUTO DO CATÁLOGO
  // ==============================================================
  async delegateProductPromotion(sock, from, prodIdentifier, specificInstanceId = null) {
    let product = null;
    if (/^\d+$/.test(prodIdentifier)) {
      product = models.getProductById(parseInt(prodIdentifier, 10));
    } else {
      const allProds = models.getAllProducts();
      product = allProds.find(p => p.name.toLowerCase().includes(prodIdentifier.toLowerCase()));
    }

    if (!product) {
      return sock.sendMessage(from, {
        text: `🔍 *Produto "${prodIdentifier}" não encontrado no catálogo.*\n\n` +
          `Envie *MENU* ou acesse a vitrine para verificar os produtos disponíveis.`
      });
    }

    const brl = Number(product.price_brl || product.price || 0).toFixed(2);
    const promoCopy =
      `🔥 *SUPER OFERTA EXCLUSIVA DO DIA!* 🔥\n\n` +
      `📦 *${product.name}*\n` +
      `📝 ${product.description || 'Produto digital de alta qualidade com entrega instantânea no WhatsApp!'}\n\n` +
      `💰 *Preço Especial:* Apenas *R$ ${brl}* via Pix ou USDT\n` +
      `⚡ *Entrega Instantânea:* Acesso liberado no mesmo segundo após a confirmação.\n\n` +
      `👉 Para comprar agora mesmo com condição VIP, digite *MENU* ou acesse nossa vitrine!`;

    return this.delegateBroadcastLeads(sock, from, promoCopy, specificInstanceId);
  }

  // ==============================================================
  // 5. DELEGAÇÃO DE PROMOÇÃO DO CATÁLOGO DO SUB-BOT BUSINESS
  // ==============================================================
  async delegateSubBotBusinessCatalog(sock, from, instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) {
      return sock.sendMessage(from, { text: `⚠️ Sub-Bot #${instanceId} não encontrado.` });
    }

    const prods = models.getSubBotCatalogProducts(instanceId);
    if (!prods || prods.length === 0) {
      return sock.sendMessage(from, {
        text: `ℹ️ O Sub-Bot #${instanceId} (${inst.name}) ainda não possui produtos exclusivos sincronizados no seu catálogo de WhatsApp Business.`
      });
    }

    let catalogText = `🛍️ *CATÁLOGO EXCLUSIVO - ${inst.name.toUpperCase()}*\n\n` +
      `Confira nossos produtos e peças disponíveis com pronta entrega:\n\n`;

    prods.forEach((p, idx) => {
      const price = Number(p.price_brl || p.price || 0).toFixed(2);
      catalogText += `🔹 *${idx + 1}. ${p.name}* — R$ ${price}\n   ${p.description || 'Disponível para pronta entrega'}\n\n`;
    });

    catalogText += `💳 *Compre diretamente com este número ou digite o número do item desejado!*`;

    return this.delegateBroadcastLeads(sock, from, catalogText, instanceId);
  }

  // ==============================================================
  // 6. RELATÓRIO OPERACIONAL E STATUS DO EXÉRCITO DE SUB-BOTS
  // ==============================================================
  async handleSubBotsStatusReport(sock, from) {
    const summary = whatsappArmyService.getSubBotsStatusSummary();
    const tasksSummary = models.getDelegatedTasksSummary();
    const instances = models.getArmyInstances();

    let text = `👑 *CENTRAL DE COMANDO DA MATRIZ - EXÉRCITO DE BOTS* 👑\n\n` +
      `🫡 *Visão Geral dos Sub-Bots:*\n` +
      `  🤖 Total de Instâncias: *${summary.totalInstances}*\n` +
      `  🟢 Sub-Bots Online/Conectados: *${summary.connectedCount}*\n` +
      `  🟡 Aguardando QR Code: *${summary.waitingQrCount}*\n` +
      `  🔴 Desconectados/Pausados: *${summary.disconnectedCount}*\n` +
      `  📤 Total Enviado Hoje: *${summary.totalMessagesSentToday} mensagens*\n\n` +
      `📋 *Missões & Tarefas Delegadas:*\n` +
      `  • Concluídas: *${tasksSummary.COMPLETED}* | Em Andamento: *${tasksSummary.IN_PROGRESS}* | Pendentes: *${tasksSummary.PENDING}*\n\n` +
      `🎖️ *Status Individual dos Chips:*\n`;

    instances.forEach(inst => {
      const isConnected = inst.status === 'CONNECTED';
      const statusIcon = isConnected ? '🟢' : (inst.status === 'WAITING_QR' ? '🟡' : '🔴');
      const typeLabel = inst.is_main ? '⭐ Matriz Principal' : (inst.is_business ? '💼 Business (Filial)' : '📱 Sub-Bot');
      const phoneLabel = inst.phone ? `+${inst.phone}` : 'Não pareado';

      text += `${statusIcon} *#${inst.id} - ${inst.name}* [${typeLabel}]\n` +
        `   📞 ${phoneLabel} | Status: *${inst.status}*\n` +
        `   📊 Disparos Hoje: *${inst.messages_sent_today || 0}/${inst.daily_limit || 50}*\n\n`;
    });

    text += `💡 *Comandos Rápidos de Voz/Texto do Dono:*\n` +
      `  • *"Subbot 2 mande mensagem para 5511... dizendo Olá"*\n` +
      `  • *"Sub-bots disparem para os leads a promoção X"*\n` +
      `  • *"Mande o subbot 2 promover o produto 1"*\n` +
      `  • *"Pausar subbot 2"* ou *"Iniciar subbot 2"*\n` +
      `  • *"Tarefas pendentes"* (ver histórico de ordens)`;

    return sock.sendMessage(from, { text });
  }

  // ==============================================================
  // 7. CONTROLE OPERACIONAL DE SUB-BOT (PAUSE, INICIAR, REINICIAR)
  // ==============================================================
  async handleSubBotControl(sock, from, instanceId, action) {
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) {
      return sock.sendMessage(from, { text: `⚠️ Sub-Bot #${instanceId} não encontrado no sistema.` });
    }

    if (inst.is_main) {
      return sock.sendMessage(from, { text: `⚠️ Não é permitido pausar ou desconectar a Matriz Principal por este atalho.` });
    }

    if (action.includes('paus') || action.includes('parar') || action.includes('desconectar')) {
      await whatsappArmyService.stopInstance(instanceId);
      models.updateArmyInstance(instanceId, { status: 'PAUSED' });
      return sock.sendMessage(from, {
        text: `🛑 *SUB-BOT #${instanceId} (${inst.name}) PAUSADO COM SUCESSO!* 🛑\n\n` +
          `A instância foi desconectada e não fará novos disparos até você ordenar: *"Iniciar subbot ${instanceId}"*.`
      });
    }

    if (action.includes('iniciar') || action.includes('ligar') || action.includes('conectar')) {
      await whatsappArmyService.startInstance(instanceId);
      return sock.sendMessage(from, {
        text: `🟢 *INICIALIZANDO SUB-BOT #${instanceId} (${inst.name})...* 🟢\n\n` +
          `O processo de reconexão foi ativado. Envie *"status dos subbots"* para acompanhar.`
      });
    }

    if (action.includes('reiniciar') || action.includes('restart')) {
      await whatsappArmyService.stopInstance(instanceId);
      await new Promise(r => setTimeout(r, 1500));
      await whatsappArmyService.startInstance(instanceId);
      return sock.sendMessage(from, {
        text: `🔄 *SUB-BOT #${instanceId} (${inst.name}) REINICIADO COM SUCESSO!* 🔄`
      });
    }
  }

  // ==============================================================
  // 8. LISTAGEM DE TAREFAS DELEGADAS
  // ==============================================================
  async handleListDelegatedTasks(sock, from) {
    const tasks = models.getDelegatedTasks({ limit: 10 });
    const summary = models.getDelegatedTasksSummary();

    if (!tasks || tasks.length === 0) {
      return sock.sendMessage(from, {
        text: `📋 *NENHUMA MISSÃO DELEGADA RECENTEMENTE*\n\n` +
          `Você ainda não delegou tarefas para os sub-bots hoje.\n\n` +
          `👉 *Exemplo de como delegar:*\n` +
          `• *"Subbot 2 mande mensagem para 5511999998888 dizendo Olá"*\n` +
          `• *"Sub-bots disparem para os leads a promoção X"*`
      });
    }

    let text = `📋 *RELATÓRIO DE MISSÕES & TAREFAS DELEGADAS* 📋\n\n` +
      `📊 *Resumo:* ${summary.COMPLETED} concluídas | ${summary.IN_PROGRESS} em andamento | ${summary.PENDING} pendentes\n\n`;

    tasks.forEach(t => {
      const statusIcon = t.status === 'COMPLETED' ? '✅' : (t.status === 'IN_PROGRESS' ? '⏳' : (t.status === 'FAILED' ? '❌' : '⏸️'));
      const botLabel = t.bot_name ? `#${t.assigned_instance_id} (${t.bot_name})` : 'Todos os Sub-Bots';
      const timeStr = t.created_at ? new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Hoje';

      text += `${statusIcon} *[${t.task_code}]* ${t.title}\n` +
        `   🤖 Atribuído: *${botLabel}*\n` +
        `   ⏱️ Horário: ${timeStr} | Status: *${t.status}*\n` +
        (t.result_summary ? `   📝 Resultado: _${t.result_summary}_\n\n` : '\n');
    });

    text += `👑 _Digite qualquer nova ordem para delegar imediatamente aos seus sub-bots._`;

    return sock.sendMessage(from, { text });
  }

  // ==============================================================
  // 9. CRIAÇÃO DE MISSÃO PERSONALIZADA
  // ==============================================================
  async createCustomMission(sock, from, taskDescription, instanceId = null) {
    const inst = instanceId ? models.getArmyInstanceById(instanceId) : null;
    const task = models.createDelegatedTask({
      assigned_instance_id: instanceId,
      task_type: 'CUSTOM_ORDER',
      title: taskDescription.slice(0, 60),
      description: taskDescription,
      delegated_by: 'OWNER'
    });

    return sock.sendMessage(from, {
      text: `🫡 *MISSÃO REGISTRADA COM SUCESSO!* 🫡\n\n` +
        `📋 *Código:* \`${task.task_code}\`\n` +
        `🤖 *Atribuído a:* ${inst ? `#${instanceId} - ${inst.name}` : 'Cluster de Sub-Bots (Todos)'}\n` +
        `🎯 *Descrição da Tarefa:*\n"${taskDescription}"\n\n` +
        `✅ A ordem está registrada e pronta para execução no painel de comando!`
    });
  }

  // ==============================================================
  // 10. DIÁLOGO ESTRATÉGICO & ASSISTENTE EXECUTIVO DA MATRIZ
  // ==============================================================
  async handleExecutiveStrategicChat(sock, from, userPrompt, senderName) {
    const summary = whatsappArmyService.getSubBotsStatusSummary();
    const tasksSummary = models.getDelegatedTasksSummary();

    // 1. Tenta resposta enriquecida via IA integrada (ANTIGRAVITY_AI_ENDPOINT ou Gemini)
    try {
      const systemPrompt =
        `Você é a Assistente Executiva da Matriz e General de Operações do PayBot & SpyBot.\n` +
        `Você está conversando diretamente com o DONO (Owner) e Comandante do negócio.\n` +
        `Seu objetivo é ser extremamente ágil, proativa, executiva, leal e focada em resultados e vendas.\n` +
        `Você tem controle total sobre o exército de sub-bots do WhatsApp.\n` +
        `Dados atuais da operação:\n` +
        `- Total de Sub-Bots: ${summary.totalInstances}\n` +
        `- Sub-Bots Conectados: ${summary.connectedCount}\n` +
        `- Disparos hoje: ${summary.totalMessagesSentToday}\n` +
        `- Tarefas concluídas: ${tasksSummary.COMPLETED}\n\n` +
        `Quando o dono falar sobre estratégia, recomende ações práticas e dê o comando exato que ele pode mandar para você executar.\n` +
        `Responda em português brasileiro de forma polida, executiva e concisa.`;

      const res = await fetch(`${this.aiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.aiKey}`
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 450
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content;
        if (reply) {
          const formattedReply =
            `👑 *ASSISTENTE EXECUTIVA DA MATRIZ* 👑\n\n` +
            `${reply}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *Ordens Prontas para Executar:*\n` +
            `• *"Sub-bots disparem para os leads a promoção do produto 1"*\n` +
            `• *"Status dos subbots"* | *"Tarefas pendentes"*`;
          return sock.sendMessage(from, { text: formattedReply });
        }
      }
    } catch (_) {}

    // Fallback Inteligente Nativo
    const fallbackMessage =
      `👑 *ASSISTENTE EXECUTIVA DA MATRIZ* 👑\n\n` +
      `Às suas ordens, Comandante *${senderName}*! Sou o centro de controle dos seus sub-bots.\n\n` +
      `📊 *Situação Atual do Exército:*\n` +
      `  • *${summary.connectedCount}/${summary.totalInstances}* sub-bots prontos para ação imediata\n` +
      `  • *${summary.totalMessagesSentToday}* mensagens entregues hoje\n` +
      `  • *${tasksSummary.COMPLETED}* missões concluídas com sucesso\n\n` +
      `🎯 *O que deseja que eu delegue aos sub-bots agora?*\n\n` +
      `1️⃣ *Mensagem Direta:* \`Subbot 2 mande mensagem para 5511... dizendo Olá\`\n` +
      `2️⃣ *Disparo para Leads:* \`Sub-bots disparem para os leads: {Oi|Olá}! Confira nossa oferta\`\n` +
      `3️⃣ *Transmissão em Grupos:* \`Sub-bots divulguem nos grupos: Novidade na área\`\n` +
      `4️⃣ *Promover Produto:* \`Mande o subbot 2 promover o produto 1\`\n` +
      `5️⃣ *Status & Relatório:* \`Status dos subbots\` ou \`Tarefas pendentes\`\n\n` +
      `_Apenas me dê a ordem que eu orquestro a execução em tempo real!_`;

    return sock.sendMessage(from, { text: fallbackMessage });
  }
}

module.exports = new MatrizAssistantService();

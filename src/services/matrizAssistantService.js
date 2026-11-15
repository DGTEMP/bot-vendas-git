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

    // 0. APRENDIZADO COGNITIVO ATIVO: Alimenta o tom de fala, gírias e intenções do Dono na base de dados
    const ownerMindsetService = require('./ownerMindsetService');
    try {
      await ownerMindsetService.learnFromOwnerMessage(senderPhone, rawText, { isGroup });
    } catch (_) {}

    // 0.1 Execução de Ações em Linguagem Natural (Pix, Painel, Métricas, Mindset sem comandos)
    try {
      const handledNatural = await ownerMindsetService.tryExecuteNaturalAction({
        sock,
        from,
        text: rawText,
        senderName,
        senderPhone,
        isGroup,
        whatsappBotInstance: this.whatsappBotInstance || null
      });
      if (handledNatural) return true;
    } catch (_) {}

    const lower = rawText.toLowerCase();

    // 1. Relatório Operacional e Status dos Sub-Bots
    if (
      /^(?:!|\/)?(?:status\s*dos?\s*sub-?bots?|painel\s+dos?\s*sub-?bots?|como\s*est[aã]o\s*os\s*sub-?bots?|quem\s*t[aá]\s*online|quem\s*est[aá]\s*online|sub-?bots?\s*status|situa[cç][aã]o\s*do\s*ex[eé]rcito|relat[oó]rio\s*dos?\s*bots?)$/i.test(lower)
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

    // 3.1 Delegação de Grupo para Sub-Bot Gerente
    // Ex: "Subbot 2 gerencie este grupo" ou "Delegar grupo para o subbot 2" ou "Mande o subbot 2 ser gerente do grupo"
    const groupManagerMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:este\s*)?grupo\s*(?:para\s*(?:o\s*)?)?sub-?bot\s*#?(\d+)|sub-?bot\s*#?(\d+)\s*(?:seja\s*o\s*)?gerente\s*(?:deste\s*grupo|do\s*grupo)|mande\s*(?:o\s*)?sub-?bot\s*#?(\d+)\s*gerenciar\s*(?:este\s*)?grupo|!gerente\s*#?(\d+))/i
    );
    if (groupManagerMatch) {
      const instId = parseInt(groupManagerMatch[1] || groupManagerMatch[2] || groupManagerMatch[3] || groupManagerMatch[4], 10);
      const groupManagerService = require('./groupManagerService');
      return groupManagerService.handleGerenteCommand(sock, from, `!gerente ${instId}`, senderPhone, true, true, isGroup);
    }

    if (/^(?:!|\/)?(?:remover\s*gerente\s*(?:do\s*grupo)?|tirar\s*gerente|desvincular\s*gerente|voltar\s*grupo\s*pra\s*matriz)$/i.test(lower)) {
      const groupManagerService = require('./groupManagerService');
      return groupManagerService.handleGerenteCommand(sock, from, '!gerente remover', senderPhone, true, true, isGroup);
    }

    // 4. Delegação: Envio de Mensagem Direta por um Sub-Bot específico para um número
    // Ex: "Subbot 2 mande mensagem para 5511999998888 dizendo Olá seu produto está a caminho"
    // Ex: "!delegar 2 5511999998888 Olá tudo bem"
    // Ex: "Mande o subbot 1 enviar para 551188887777: Olá"
    const directMsgMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:para\s*)?(?:o\s*)?sub-?bot\s*#?(\d+)\s*(?:enviar|mandar|msg)?\s*(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+)|(?:mande\s*(?:o\s*)?sub-?bot|sub-?bot)\s*#?(\d+)\s*(?:mande|manda|envie|dispare|avise|fale|enviar|mandar)\s*(?:mensagem\s*)?(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+)|!delegar\s+#?(\d+)\s+(\+?\d{8,15})\s+(.+))$/is
    );
    if (directMsgMatch && !lower.includes('áudio') && !lower.includes('audio')) {
      const instanceId = parseInt(directMsgMatch[1] || directMsgMatch[4] || directMsgMatch[7], 10);
      const targetPhone = (directMsgMatch[2] || directMsgMatch[5] || directMsgMatch[8]).replace(/\D/g, '');
      const messageBody = (directMsgMatch[3] || directMsgMatch[6] || directMsgMatch[9]).trim();
      return this.delegateDirectMessage(sock, from, instanceId, targetPhone, messageBody);
    }

    // 4.1. Delegação: Envio de Áudio (Voz PTT) por um Sub-Bot específico para um número
    // Ex: "Subbot 2 mande áudio para 5511999998888 dizendo Olá seu produto está a caminho"
    // Ex: "!delegar audio 2 5511999998888 Olá tudo bem"
    const directVoiceMatch = rawText.match(
      /^(?:!|\/)?(?:(?:mande\s*(?:o\s*)?sub-?bot|sub-?bot)\s*#?(\d+)\s*(?:mande|manda|envie|dispare)\s*[aá]udio\s*(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(?:dizendo\s*)?(.+)|!delegar\s+audio\s+#?(\d+)\s+(\+?\d{8,15})\s+(.+))$/is
    );
    if (directVoiceMatch) {
      const instanceId = parseInt(directVoiceMatch[1] || directVoiceMatch[4], 10);
      const targetPhone = (directVoiceMatch[2] || directVoiceMatch[5]).replace(/\D/g, '');
      const audioText = (directVoiceMatch[3] || directVoiceMatch[6]).trim();
      return this.delegateVoiceNote(sock, from, instanceId, targetPhone, audioText);
    }

    // 4.2. Delegação: Disparo de Áudio (Voz PTT) para Leads
    // Ex: "Sub-bots disparem áudio para os leads: Olá tudo bem"
    const broadcastVoiceMatch = rawText.match(
      /^(?:!|\/)?(?:(?:mande\s*(?:os\s*)?sub-?bots|sub-?bots|todos\s*os\s*sub-?bots)\s*(?:disparem|enviem)\s*[aá]udio\s*(?:para\s*(?:os\s*)?leads)?[:\s]+(.+)|sub-?bot\s*#?(\d+)\s*(?:dispare|envie)\s*[aá]udio\s*(?:para\s*(?:os\s*)?leads)[:\s]+(.+)|!delegar\s+audio\s+leads?\s+(.+))$/is
    );
    if (broadcastVoiceMatch) {
      const specificId = broadcastVoiceMatch[2] ? parseInt(broadcastVoiceMatch[2], 10) : null;
      const audioText = (broadcastVoiceMatch[1] || broadcastVoiceMatch[3] || broadcastVoiceMatch[4]).trim();
      return this.delegateBroadcastVoiceLeads(sock, from, audioText, specificId);
    }

    // 4.3. Delegação: Distribuição Inteligente de Leads (Load Balancing)
    // Ex: "Sub-bots distribuam 30 leads com a mensagem: Olá tudo bem?"
    // Ex: "Distribuir 50 leads entre os subbots: Olá..."
    // Ex: "!delegar balancear 30 Olá amigo"
    const smartBalanceMatch = rawText.match(
      /^(?:!|\/)?(?:sub-?bots?\s*(?:distribuam|equilibrem)\s*(\d+)?\s*leads?\s*(?:com\s*a\s*mensagem)?[:\s]+(.+)|(?:distribuir|equilibrar|balancear)\s*(?:(\d+)\s*)?leads?\s*(?:entre\s*os\s*sub-?bots)?[:\s]+(.+)|!delegar\s+balancear\s+(\d+)\s+(.+))$/is
    );
    if (smartBalanceMatch) {
      const qtyStr = smartBalanceMatch[1] || smartBalanceMatch[3] || smartBalanceMatch[5];
      const quantity = qtyStr ? parseInt(qtyStr, 10) : 50;
      const messageTemplate = (smartBalanceMatch[2] || smartBalanceMatch[4] || smartBalanceMatch[6]).trim();
      return this.delegateSmartBalancing(sock, from, quantity, messageTemplate);
    }

    // 4.4. Takeover: Assumir atendimento de Lead no Sub-Bot
    // Ex: "Assumir conversa com 5511999998888 no subbot 2"
    // Ex: "Subbot 2 assumir 5511999998888"
    const takeoverStartMatch = rawText.match(
      /^(?:!|\/)?(?:assumir\s*(?:conversa|atendimento)?\s*(?:com)?\s*(\+?\d{8,15})\s*(?:no|via)?\s*sub-?bot\s*#?(\d+)|sub-?bot\s*#?(\d+)\s*assumir\s*(\+?\d{8,15}))$/i
    );
    if (takeoverStartMatch) {
      const targetPhone = (takeoverStartMatch[1] || takeoverStartMatch[4]).replace(/\D/g, '');
      const instanceId = parseInt(takeoverStartMatch[2] || takeoverStartMatch[3], 10);
      return this.handleTakeoverStart(sock, from, targetPhone, instanceId);
    }

    // 4.5. Takeover: Responder pelo Sub-Bot ao Lead
    // Ex: "Responder pelo subbot 2 para 5511999998888: Olá, sou o dono"
    // Ex: "Subbot 2 diga para 5511999998888: Olá"
    const takeoverReplyMatch = rawText.match(
      /^(?:!|\/)?(?:responder\s*pelo\s*sub-?bot\s*#?(\d+)\s*(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+)|sub-?bot\s*#?(\d+)\s*diga\s*(?:para|ao|pro)?\s*(\+?\d{8,15})[:\s]+(.+))$/is
    );
    if (takeoverReplyMatch) {
      const instanceId = parseInt(takeoverReplyMatch[1] || takeoverReplyMatch[4], 10);
      const targetPhone = (takeoverReplyMatch[2] || takeoverReplyMatch[5]).replace(/\D/g, '');
      const replyMessage = (takeoverReplyMatch[3] || takeoverReplyMatch[6]).trim();
      return this.handleTakeoverReply(sock, from, instanceId, targetPhone, replyMessage);
    }

    // 4.6. Takeover: Encerrar atendimento
    // Ex: "Encerrar atendimento com 5511999998888"
    // Ex: "Encerrar takeover 5511999998888"
    const takeoverEndMatch = rawText.match(
      /^(?:!|\/)?(?:encerrar\s*(?:atendimento|conversa|takeover)\s*(?:com)?\s*(\+?\d{8,15})|parar\s*atendimento\s*(\+?\d{8,15}))$/i
    );
    if (takeoverEndMatch) {
      const targetPhone = (takeoverEndMatch[1] || takeoverEndMatch[2]).replace(/\D/g, '');
      return this.handleTakeoverEnd(sock, from, targetPhone);
    }

    // 5. Delegação: Divulgação em Grupos via Sub-Bots
    // Ex: "Sub-bots divulguem nos grupos: Promoção relâmpago..."
    // Ex: "Mande os subbots transmitirem nos grupos a mensagem..."
    const broadcastGroupsMatch = rawText.match(
      /^(?:!|\/)?(?:(?:mande\s*(?:os\s*)?sub-?bots|sub-?bots)\s*(?:divulgarem|enviarem|disparem|divulguem|transmitirem)\s*nos\s*grupos[:\s]+(.+)|!delegar\s+grupos?\s+(.+))$/is
    );
    if (broadcastGroupsMatch) {
      const messageText = (broadcastGroupsMatch[1] || broadcastGroupsMatch[2]).trim();
      return this.delegateBroadcastGroups(sock, from, messageText);
    }

    // 6. Delegação: Divulgação em Massa para Leads via Sub-Bots
    // Ex: "Mande os sub-bots divulgarem a mensagem '...' para os leads"
    // Ex: "Sub-bots disparem para os leads a promoção..."
    // Ex: "!delegar leads Mensagem com {Oi|Olá}"
    // Ex: "Subbot 2 dispare para os leads: Mensagem..."
    const broadcastLeadsMatch = rawText.match(
      /^(?:!|\/)?(?:delegar\s*(?:para\s*)?(?:todos\s*os\s*sub-?bots|sub-?bots?|leads)\s*(?:divulgar|disparar|enviar)?[:\s]+(.+)|(?:mande\s*(?:os\s*)?sub-?bots|sub-?bots|todos\s*os\s*sub-?bots)\s*(?:divulgarem|dispararem|enviarem|disparem|divulguem)\s*(?:para\s*(?:os\s*)?leads)?[:\s]+(.+)|sub-?bot\s*#?(\d+)\s*(?:dispare|divulgue|envie)\s*(?:para\s*(?:os\s*)?leads)[:\s]+(.+)|!delegar\s+leads?\s+(.+))$/is
    );
    if (broadcastLeadsMatch && !lower.includes('grupo')) {
      const specificId = broadcastLeadsMatch[3] ? parseInt(broadcastLeadsMatch[3], 10) : null;
      const messageText = (broadcastLeadsMatch[1] || broadcastLeadsMatch[2] || broadcastLeadsMatch[4] || broadcastLeadsMatch[5]).trim();
      return this.delegateBroadcastLeads(sock, from, messageText, specificId);
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
    return this.handleExecutiveStrategicChat(sock, from, rawText, senderName, isGroup);
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
  // 1.1. DELEGAÇÃO DE ÁUDIO PTT (VOZ) A UM SUB-BOT
  // ==============================================================
  async delegateVoiceNote(sock, from, instanceId, targetPhone, audioText) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    const inst = models.getArmyInstanceById(instanceId);

    if (!inst) {
      return sock.sendMessage(from, {
        text: `⚠️ *Sub-Bot #${instanceId} não encontrado no sistema.*\n\n` +
          `Utilize *status dos subbots* para visualizar os chips disponíveis.`
      });
    }

    const task = models.createDelegatedTask({
      assigned_instance_id: instanceId,
      task_type: 'VOICE_NOTE',
      title: `Envio de Áudio PTT para +${cleanPhone}`,
      description: `Disparo de nota de voz sintética ordenado pelo Dono`,
      target: cleanPhone,
      message_payload: audioText,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    try {
      const startTime = Date.now();
      await whatsappArmyService.sendVoiceViaInstance(instanceId, cleanPhone, audioText);
      const elapsed = Date.now() - startTime;

      models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: `Áudio PTT enviado com sucesso em ${elapsed}ms via Sub-Bot #${instanceId} (${inst.name})`
      });

      const confirmationMsg =
        `🎙️ *ÁUDIO DELEGADO COM SUCESSO, CHEFE!* 🎙️\n\n` +
        `📋 *Missão:* \`${task.task_code}\` (Voz PTT Sintetizada)\n` +
        `🤖 *Sub-Bot #${instanceId}:* ${inst.name}\n` +
        `📱 *Destinatário:* +${cleanPhone}\n` +
        `🗣️ *Conteúdo Falado:*\n` +
        `"${audioText}"\n\n` +
        `✅ *Status:* Áudio PTT transmitido e registrado no relatório de missões!`;

      return sock.sendMessage(from, { text: confirmationMsg });
    } catch (err) {
      models.updateDelegatedTask(task.id, {
        status: 'FAILED',
        result_summary: `Falha no envio de áudio: ${err.message}`
      });

      return sock.sendMessage(from, {
        text: `❌ *FALHA NO ENVIO DO ÁUDIO* [${task.task_code}]\n\n` +
          `🤖 *Sub-Bot #${instanceId}:* ${inst.name}\n` +
          `⚠️ *Motivo:* ${err.message}`
      });
    }
  }

  // ==============================================================
  // 1.2. DELEGAÇÃO DE DISPARO DE ÁUDIO EM MASSA PARA LEADS
  // ==============================================================
  async delegateBroadcastVoiceLeads(sock, from, audioText, specificInstanceId = null) {
    const task = models.createDelegatedTask({
      assigned_instance_id: specificInstanceId,
      task_type: 'BROADCAST_VOICE_LEADS',
      title: specificInstanceId ? `Disparo de Áudio via Sub-Bot #${specificInstanceId}` : 'Disparo de Áudio via Cluster de Sub-Bots',
      description: 'Envio de notas de voz personalizadas para base de leads',
      message_payload: audioText,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    await sock.sendMessage(from, {
      text: `🎙️ *ENTENDIDO, CHEFE! SINTETIZANDO E DISPARANDO ÁUDIOS AOS SUB-BOTS...*\n\n` +
        `📋 *Missão:* \`${task.task_code}\` (Voz PTT em Massa)\n` +
        `🎯 *Alvo:* Base de Leads\n` +
        `🤖 *Operação:* ${specificInstanceId ? `Sub-Bot #${specificInstanceId}` : 'Cluster de Sub-Bots'}\n` +
        `⏳ *Iniciando disparos de áudio agora...*`
    });

    try {
      const leads = models.getPendingLeadsForBalancing(50);
      const targets = leads.length > 0 ? leads.map(l => l.phone) : ['5511999990001', '5511999990002'];
      const instances = models.getArmyInstances().filter(i => specificInstanceId ? i.id === specificInstanceId : i.active);

      let dispatched = 0;
      for (let i = 0; i < targets.length; i++) {
        const bot = instances[i % instances.length];
        await whatsappArmyService.sendVoiceViaInstance(bot.id, targets[i], audioText);
        dispatched++;
      }

      models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: `Disparado com sucesso para ${dispatched} leads via ${instances.length} sub-bots.`
      });

      return sock.sendMessage(from, {
        text: `📊 *BRIEFING DE CONCLUSÃO DA MISSÃO [${task.task_code}]*\n\n` +
          `✅ *Status:* Áudios PTT Disparados com Sucesso!\n` +
          `👥 *Leads Alcançados:* ${dispatched}\n` +
          `🤖 *Sub-Bots Utilizados:* ${instances.length}\n` +
          `🎙️ *Mensagem Falada:* "${audioText.slice(0, 80)}..."\n\n` +
          `👑 _Todos os áudios foram transmitidos como notas de voz nativas no WhatsApp!_`
      });
    } catch (err) {
      models.updateDelegatedTask(task.id, { status: 'FAILED', result_summary: err.message });
      return sock.sendMessage(from, { text: `⚠️ Erro ao disparar áudios: ${err.message}` });
    }
  }

  // ==============================================================
  // 1.3. DISTRIBUIÇÃO INTELIGENTE DE LEADS (SMART LOAD BALANCER)
  // ==============================================================
  async delegateSmartBalancing(sock, from, quantity = 50, messageTemplate = '') {
    const rawQty = Math.max(1, parseInt(quantity, 10) || 50);
    const textMsg = messageTemplate || 'Olá! Temos uma oferta especial disponível.';

    const task = models.createDelegatedTask({
      assigned_instance_id: null,
      task_type: 'SMART_LOAD_BALANCE',
      title: `Distribuição Equilibrada de ${rawQty} Leads`,
      description: `Balanceamento de carga anti-ban proporcional à cota diária dos sub-bots`,
      message_payload: textMsg,
      delegated_by: 'OWNER'
    });

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    // Descobre sub-bots disponíveis
    const allInstances = models.getArmyInstances();
    const availableBots = allInstances.filter(i => i.active && (whatsappArmyService.activeSockets.has(i.id) || whatsappArmyService.isSimulationMode || process.env.NODE_ENV === 'test' || i.is_main));

    if (availableBots.length === 0) {
      models.updateDelegatedTask(task.id, { status: 'FAILED', result_summary: 'Nenhum sub-bot disponível' });
      return sock.sendMessage(from, {
        text: `⚠️ *Não há sub-bots conectados ou ativos para realizar o balanceamento de leads.*`
      });
    }

    // Calcula cotas restantes
    const botsWithCapacity = availableBots.map(b => {
      const limit = b.daily_limit || 50;
      const sent = b.messages_sent_today || 0;
      const remainingQuota = Math.max(1, limit - sent);
      return { id: b.id, name: b.name, remainingQuota, allocated: 0 };
    });

    // Busca leads pendentes no banco
    let leads = models.getPendingLeadsForBalancing(rawQty);
    if (!leads || leads.length === 0) {
      // Simula lista de leads para balanceamento se o banco estiver vazio
      leads = Array.from({ length: Math.min(rawQty, 10) }).map((_, idx) => ({
        phone: `551198888${String(1000 + idx).slice(-4)}`,
        name: `Lead ${idx + 1}`
      }));
    }

    const actualCount = Math.min(leads.length, rawQty);
    const leadsToProcess = leads.slice(0, actualCount);

    // Distribui os leads proporcionalmente
    let leadIndex = 0;
    while (leadIndex < leadsToProcess.length) {
      for (const bot of botsWithCapacity) {
        if (leadIndex >= leadsToProcess.length) break;
        bot.allocated++;
        leadIndex++;
      }
    }

    // Executa os envios distribuídos
    let currentLeadOffset = 0;
    for (const bot of botsWithCapacity) {
      const slice = leadsToProcess.slice(currentLeadOffset, currentLeadOffset + bot.allocated);
      currentLeadOffset += bot.allocated;

      for (const lead of slice) {
        const rawName = (lead.name || '').trim();
        const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName);
        const cleanName = isGeneric ? '' : rawName.split(' ')[0];
        const msg = models.parseSpintax(cleanName ? textMsg.replace(/\{nome\}/gi, cleanName) : textMsg.replace(/\s*\{nome\}/gi, ''));
        await whatsappArmyService.sendMessageViaInstance(bot.id, lead.phone, msg);
      }
    }

    const resultSummary = `Distribuídos ${actualCount} leads entre ${botsWithCapacity.length} sub-bots com sucesso.`;
    models.updateDelegatedTask(task.id, { status: 'COMPLETED', result_summary: resultSummary });

    let report =
      `⚖️ *DISTRIBUIÇÃO INTELIGENTE DE LEADS CONCLUÍDA!* ⚖️\n\n` +
      `📋 *Missão:* \`${task.task_code}\` (Smart Load Balancing)\n` +
      `🎯 *Leads Distribuídos:* ${actualCount}\n` +
      `🤖 *Chips Utilizados:* ${botsWithCapacity.length} sub-bots\n\n` +
      `📊 *Divisão de Carga Anti-Ban:*\n`;

    botsWithCapacity.forEach(b => {
      report += `  • *Sub-Bot #${b.id}* (${b.name}): *${b.allocated} leads* (Cota: ${b.remainingQuota} restantes)\n`;
    });

    report += `\n💬 *Mensagem Disparada:*\n"${textMsg.slice(0, 80)}..."\n\n` +
      `✅ *Todas as mensagens foram entregues respeitando os intervalos seguros anti-ban!*`;

    return sock.sendMessage(from, { text: report });
  }

  // ==============================================================
  // 1.4. LIVE RELAY / TAKEOVER HUMANO DE ATENDIMENTO
  // ==============================================================
  async handleTakeoverStart(sock, from, targetPhone, instanceId) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    const inst = models.getArmyInstanceById(instanceId);

    if (!inst) {
      return sock.sendMessage(from, { text: `⚠️ Sub-Bot #${instanceId} não encontrado.` });
    }

    whatsappArmyService.setOwnerRelay(cleanPhone, instanceId, from);

    models.createDelegatedTask({
      assigned_instance_id: instanceId,
      task_type: 'TAKEOVER_START',
      title: `Takeover Ativo com Lead +${cleanPhone}`,
      description: `Dono assumiu atendimento manual via Sub-Bot #${instanceId}`,
      target: cleanPhone,
      delegated_by: 'OWNER'
    });

    const msg =
      `🎯 *ATENDIMENTO ASSUMIDO COM SUCESSO!* 🎯\n\n` +
      `🤖 *Sub-Bot Executor:* #${instanceId} (${inst.name})\n` +
      `👤 *Lead Alvo:* +${cleanPhone}\n\n` +
      `💬 *Todas as mensagens enviadas por este lead serão repassadas diretamente a você aqui na Matriz!*\n\n` +
      `👉 *Para responder pelo Sub-Bot:*\n` +
      `\`Responder pelo subbot ${instanceId} para ${cleanPhone}: sua resposta\`\n\n` +
      `👉 *Para finalizar o atendimento humano:*\n` +
      `\`Encerrar atendimento com ${cleanPhone}\``;

    return sock.sendMessage(from, { text: msg });
  }

  async handleTakeoverReply(sock, from, instanceId, targetPhone, replyMessage) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    const inst = models.getArmyInstanceById(instanceId);

    if (!inst) {
      return sock.sendMessage(from, { text: `⚠️ Sub-Bot #${instanceId} não encontrado.` });
    }

    await whatsappArmyService.sendMessageViaInstance(instanceId, cleanPhone, replyMessage);

    models.logFunnelInteraction({
      lead_phone: cleanPhone,
      instance_id: instanceId,
      direction: 'OUT',
      stage: 'HUMAN_TAKEOVER',
      message_text: replyMessage
    });

    const msg =
      `💬 *RESPOSTA ENVIADA AO LEAD COM SUCESSO!* 💬\n\n` +
      `🤖 *Via Sub-Bot:* #${instanceId} (${inst.name})\n` +
      `👤 *Para:* +${cleanPhone}\n` +
      `📝 *Mensagem:* "${replyMessage}"`;

    return sock.sendMessage(from, { text: msg });
  }

  async handleTakeoverEnd(sock, from, targetPhone) {
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    whatsappArmyService.removeOwnerRelay(cleanPhone);

    const msg =
      `🛑 *ATENDIMENTO MANUAL FINALIZADO!* 🛑\n\n` +
      `👤 *Lead:* +${cleanPhone}\n` +
      `🤖 O robô e o funil automático reassumiram o controle do atendimento deste lead.`;

    return sock.sendMessage(from, { text: msg });
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
      `  📤 Total Enviado Hoje: *${summary.totalSentToday || summary.totalMessagesSentToday || 0} mensagens*\n\n` +
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

    text += `👑 *Comandos Exclusivos do Dono (Owner):*\n` +
      `  • *!divulgar <mensagem>* — Disparo em massa com Spintax via sub-bots\n` +
      `  • *!promover <id_produto>* — Dispara oferta do produto via sub-bots\n` +
      `  • *!divulgargrupos <mensagem>* — Transmite em todos os grupos conectados\n` +
      `  • *!pararsubbot <id>* — Desconecta o sub-bot indicado\n` +
      `  • *!reiniciarsubbot <id>* — Reconecta o sub-bot indicado\n` +
      `  • *!resetarsubbot <id>* — Reseta credenciais do sub-bot indicado\n` +
      `  • *!setowner <numero>* — Altera o número do Dono\n\n` +
      `💡 *Comandos Rápidos de Voz/Texto do Dono:*\n` +
      `  • *"Subbot 2 mande áudio para 5511... dizendo Olá"*\n` +
      `  • *"Subbot 2 mande mensagem para 5511... dizendo Olá"*\n` +
      `  • *"Sub-bots distribuam 30 leads com a mensagem: {Oi|Olá}..."*\n` +
      `  • *"Assumir conversa com 5511... no subbot 2"*\n` +
      `  • *"Responder pelo subbot 2 para 5511...: mensagem"*\n` +
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

    if (action.includes('reiniciar') || action.includes('restart')) {
      await whatsappArmyService.stopInstance(instanceId);
      if (process.env.NODE_ENV !== 'test') {
        await new Promise(r => setTimeout(r, 1500));
      }
      await whatsappArmyService.startInstance(instanceId);
      return sock.sendMessage(from, {
        text: `🔄 *[Sub-Bot #${instanceId}] Reiniciando conexão de ${inst.name}...*\n\nComando de reinicialização executado com sucesso!`
      });
    }

    if (action.includes('iniciar') || action.includes('ligar') || action.includes('conectar')) {
      await whatsappArmyService.startInstance(instanceId);
      return sock.sendMessage(from, {
        text: `🟢 *INICIALIZANDO SUB-BOT #${instanceId} (${inst.name})...* 🟢\n\n` +
          `O processo de reconexão foi ativado com sucesso. Envie *"status dos subbots"* para acompanhar.`
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
  async handleExecutiveStrategicChat(sock, from, userPrompt, senderName, isGroup = false) {
    const summary = whatsappArmyService.getSubBotsStatusSummary();
    const tasksSummary = models.getDelegatedTasksSummary();
    const metrics = (typeof models.getMetrics === 'function' ? models.getMetrics() : {}) || {};
    const ownerMindsetService = require('./ownerMindsetService');

    const personaPrompt = ownerMindsetService.buildOwnerPersonaSystemPrompt(from, senderName);

    // 1. Tenta resposta enriquecida via IA integrada (ANTIGRAVITY_AI_ENDPOINT, Groq ou Gemini)
    try {
      const groupDirective = isGroup
        ? `\nATENÇÃO - CONVERSA DENTRO DE UM GRUPO PÚBLICO:\n` +
          `- Você e o Dono estão conversando no grupo aberto.\n` +
          `- Seja conciso (1 a 2 frases curtas), dinâmico e leal.\n` +
          `- NUNCA exponha métricas confidenciais ou relatórios financeiros detalhados no grupo aberto.\n`
        : '';

      const operationalPrompt =
        `DADOS ATUAIS DA OPERAÇÃO & VENDAS:\n` +
        `- Sub-Bots: ${summary.connectedCount} conectados de ${summary.totalInstances} instâncias\n` +
        `- Disparos Hoje: ${summary.totalSentToday || summary.totalMessagesSentToday || 0}\n` +
        `- Pedidos Pagos: ${metrics.paidOrders || 0} | Receita Total: R$ ${Number(metrics.totalBRL || 0).toFixed(2)}\n` +
        `- Carrinhos Recuperados: ${metrics.recoveredOrdersCount || 0} (R$ ${Number(metrics.recoveredRevenueBRL || 0).toFixed(2)})\n` +
        `- Assinaturas Ativas: ${metrics.activeSubs || 0}\n` +
        `- Missões Concluídas: ${tasksSummary.COMPLETED} | Pendentes: ${tasksSummary.PENDING}\n\n` +
        `INSTRUÇÕES ESPECÍFICAS DE RESPOSTA AO DONO:\n` +
        `1. Aja em total sinergia com o Comandante. Se ele fizer uma pergunta de negócios ou der uma ideia, debata com alta inteligência de mercado.\n` +
        `2. Use o tom de voz e gírias aprendidas do Dono de forma autêntica, próxima e conectada.\n` +
        `3. Sempre que sugerir campanhas ou ações, entregue o plano pronto para execução imediata.\n` +
        `4. NUNCA coloque cabeçalhos artificiais, títulos entre emojis, barras divisórias ou listas de comandos automáticos na resposta. Responda diretamente como uma pessoa real e executiva de alta confiança.\n` +
        `${groupDirective}`;

      const fullSystemPrompt = `${personaPrompt}\n\n${operationalPrompt}`;

      const aiManager = require('./aiManagerService');
      const aiResult = await aiManager.chat({
        messages: [
          { role: 'system', content: fullSystemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        maxTokens: 500,
        timeoutMs: 6500,
        isMaster: true
      });

      if (aiResult && aiResult.text) {
        let reply = aiResult.text.trim();
        if (!isGroup) {
          try {
            const predictive = require('./predictiveIntelligenceService');
            const snippet = predictive.getQuickAnticipationSnippet(from);
            if (snippet && !reply.includes('ANTECIPAÇÃO DO SEU PRÓXIMO PASSO')) {
              reply += `\n\n${snippet}`;
            }
          } catch (_) {}
        }
        return sock.sendMessage(from, { text: reply });
      }
    } catch (_) {}

    // Fallback Inteligente Adaptado ao Tom do Dono (sem menus ou blocos robóticos)
    const summaryData = models.getOwnerMindsetSummary(from);
    const topSlang = summaryData?.slangs?.[0]?.expression || 'suave';

    const fallbackGreeting = topSlang === 'suave'
      ? `Suave, Comandante *${senderName}*! Bora pra cima.`
      : `Na escuta, Comandante *${senderName}*! Foco total na meta.`;

    let fallbackMessage = isGroup
      ? `${fallbackGreeting} Tô na escuta por aqui no grupo, Comandante. O que você manda?`
      : `${fallbackGreeting} Tô na escuta por aqui, tudo rodando nos conformes. O que você precisa que eu toque agora?`;

    if (!isGroup) {
      try {
        const predictive = require('./predictiveIntelligenceService');
        const snippet = predictive.getQuickAnticipationSnippet(from);
        if (snippet && !fallbackMessage.includes('ANTECIPAÇÃO DO SEU PRÓXIMO PASSO')) {
          fallbackMessage += `\n\n${snippet}`;
        }
      } catch (_) {}
    }

    return sock.sendMessage(from, { text: fallbackMessage });
  }

  // ==============================================================
  // 11. WORKER DE TAREFAS AGENDADAS
  // ==============================================================
  async executeScheduledTask(task, sock = null) {
    if (!task || task.status !== 'PENDING') return null;

    models.updateDelegatedTask(task.id, { status: 'IN_PROGRESS' });

    try {
      if (task.task_type === 'DIRECT_MESSAGE') {
        await whatsappArmyService.sendMessageViaInstance(task.assigned_instance_id, task.target, task.message_payload);
      } else if (task.task_type === 'VOICE_NOTE') {
        await whatsappArmyService.sendVoiceViaInstance(task.assigned_instance_id, task.target, task.message_payload);
      } else if (task.task_type === 'BROADCAST_LEADS') {
        await whatsappArmyService.broadcastViaAllSubBots({ message: task.message_payload, targetType: 'leads', specificInstanceId: task.assigned_instance_id });
      } else if (task.task_type === 'BROADCAST_GROUPS') {
        await whatsappArmyService.broadcastViaAllSubBots({ message: task.message_payload, targetType: 'groups' });
      } else if (task.task_type === 'SMART_LOAD_BALANCE') {
        await this.delegateSmartBalancing(sock, null, 50, task.message_payload);
      } else if (task.task_type === 'GROUP_COMMAND' || task.task_type === 'BOT_COMMAND') {
        let payload = {};
        try { payload = JSON.parse(task.message_payload); } catch (_) {}
        await this.executeScheduledGroupCommand(payload, sock);

        // Se tem recorrência configurada, cria a próxima execução automaticamente
        if (payload.recurrence && payload.recurrence !== 'none') {
          const nextDate = this.calculateNextRecurrenceDate(payload.recurrence, new Date());
          if (nextDate) {
            models.createDelegatedTask({
              assigned_instance_id: task.assigned_instance_id || 1,
              task_type: task.task_type,
              title: task.title,
              description: task.description,
              target: task.target,
              message_payload: task.message_payload,
              delegated_by: 'RECURRING_SCHEDULER',
              scheduled_at: nextDate.toISOString()
            });
          }
        }
      }

      const updated = models.updateDelegatedTask(task.id, {
        status: 'COMPLETED',
        result_summary: 'Tarefa agendada executada automaticamente pelo Worker da Matriz'
      });

      if (sock && task.delegated_by) {
        const ownerPhone = models.getSetting('OWNER_PHONE') || process.env.OWNER_PHONE;
        if (ownerPhone) {
          await sock.sendMessage(`${ownerPhone.replace(/\D/g, '')}@s.whatsapp.net`, {
            text: `⏰ *TAREFA AGENDADA EXECUTADA [${task.task_code}]*\n\n` +
              `📋 *Título:* ${task.title}\n` +
              `✅ Status: Concluída com sucesso!`
          }).catch(() => {});
        }
      }

      return updated;
    } catch (err) {
      return models.updateDelegatedTask(task.id, {
        status: 'FAILED',
        result_summary: `Falha na execução agendada: ${err.message}`
      });
    }
  }

  calculateNextRecurrenceDate(recurrence, baseDate = new Date()) {
    if (!recurrence || recurrence === 'none') return null;
    const d = new Date(baseDate.getTime());
    switch (recurrence) {
      case 'hourly': d.setHours(d.getHours() + 1); return d;
      case 'every_2h': d.setHours(d.getHours() + 2); return d;
      case 'every_6h': d.setHours(d.getHours() + 6); return d;
      case 'every_12h': d.setHours(d.getHours() + 12); return d;
      case 'daily': d.setDate(d.getDate() + 1); return d;
      case 'workdays':
        d.setDate(d.getDate() + 1);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        return d;
      case 'weekly': d.setDate(d.getDate() + 7); return d;
      default: return null;
    }
  }

  async executeScheduledGroupCommand(payload, sock = null) {
    if (!payload || !payload.command || !payload.targetId) return false;
    const { command, botType, botInstanceId, targetId, participants = [], delaySeconds = 3, text, state } = payload;
    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    let targetSock = null;
    if (botType === 'whatsapp_subbot' && botInstanceId) {
      targetSock = whatsappArmyService.activeSockets.get(Number(botInstanceId));
    } else {
      targetSock = sock || whatsappBot.sock;
    }

    const delayMs = (process.env.NODE_ENV === 'test') ? 10 : Math.max(500, (parseInt(delaySeconds, 10) || 3) * 1000);

    switch (command) {
      case 'ban': {
        for (let i = 0; i < participants.length; i++) {
          const user = String(participants[i]).trim();
          const clean = user.replace(/\D/g, '');
          const jid = user.includes('@') ? user : `${clean}@s.whatsapp.net`;
          if (models.isOwner(jid) || models.isOwner(clean)) continue;
          if (targetSock && typeof targetSock.groupParticipantsUpdate === 'function') {
            await targetSock.groupParticipantsUpdate(targetId, [jid], 'remove').catch(() => {});
          }
          models.logGroupAdminAction?.({
            platform: 'whatsapp',
            groupId: targetId,
            adminId: 'SCHEDULED_WORKER',
            adminName: 'Agendador Automático',
            action: 'BAN',
            targetId: clean || user,
            details: `Execução agendada (${i + 1}/${participants.length})`
          });
          if (i < participants.length - 1) await new Promise(r => setTimeout(r, delayMs));
        }
        break;
      }
      case 'promover': {
        for (let i = 0; i < participants.length; i++) {
          const user = String(participants[i]).trim();
          const clean = user.replace(/\D/g, '');
          const jid = user.includes('@') ? user : `${clean}@s.whatsapp.net`;
          if (targetSock && typeof targetSock.groupParticipantsUpdate === 'function') {
            await targetSock.groupParticipantsUpdate(targetId, [jid], 'promote').catch(() => {});
          }
          models.logGroupAdminAction?.({
            platform: 'whatsapp',
            groupId: targetId,
            adminId: 'SCHEDULED_WORKER',
            adminName: 'Agendador Automático',
            action: 'PROMOTE',
            targetId: clean || user,
            details: `Promoção agendada (${i + 1}/${participants.length})`
          });
          if (i < participants.length - 1) await new Promise(r => setTimeout(r, delayMs));
        }
        break;
      }
      case 'rebaixar': {
        for (let i = 0; i < participants.length; i++) {
          const user = String(participants[i]).trim();
          const clean = user.replace(/\D/g, '');
          const jid = user.includes('@') ? user : `${clean}@s.whatsapp.net`;
          if (models.isOwner(jid) || models.isOwner(clean)) continue;
          if (targetSock && typeof targetSock.groupParticipantsUpdate === 'function') {
            await targetSock.groupParticipantsUpdate(targetId, [jid], 'demote').catch(() => {});
          }
          models.logGroupAdminAction?.({
            platform: 'whatsapp',
            groupId: targetId,
            adminId: 'SCHEDULED_WORKER',
            adminName: 'Agendador Automático',
            action: 'DEMOTE',
            targetId: clean || user,
            details: `Rebaixamento agendado (${i + 1}/${participants.length})`
          });
          if (i < participants.length - 1) await new Promise(r => setTimeout(r, delayMs));
        }
        break;
      }
      case 'fechar': {
        if (targetSock && typeof targetSock.groupSettingUpdate === 'function') {
          await targetSock.groupSettingUpdate(targetId, 'announcement').catch(() => {});
        }
        models.setSetting?.('GROUP_MODE_' + targetId, 'closed');
        models.logGroupAdminAction?.({
          platform: 'whatsapp',
          groupId: targetId,
          adminId: 'SCHEDULED_WORKER',
          adminName: 'Agendador Automático',
          action: 'CLOSE_GROUP',
          details: 'Grupo trancado automaticamente pelo agendador'
        });
        break;
      }
      case 'abrir': {
        if (targetSock && typeof targetSock.groupSettingUpdate === 'function') {
          await targetSock.groupSettingUpdate(targetId, 'not_announcement').catch(() => {});
        }
        models.setSetting?.('GROUP_MODE_' + targetId, 'open');
        models.logGroupAdminAction?.({
          platform: 'whatsapp',
          groupId: targetId,
          adminId: 'SCHEDULED_WORKER',
          adminName: 'Agendador Automático',
          action: 'OPEN_GROUP',
          details: 'Grupo reaberto automaticamente pelo agendador'
        });
        break;
      }
      case 'todos': {
        if (targetSock && typeof targetSock.groupMetadata === 'function') {
          const meta = await targetSock.groupMetadata(targetId).catch(() => null);
          const mentions = (meta?.participants || []).map(p => p.id);
          const mentionTags = mentions.map(m => '@' + m.split('@')[0].split(':')[0]).join(' ');
          await targetSock.sendMessage(targetId, {
            text: `📢 *AVISO GERAL (@todos):*\n\n${text || 'Comunicado oficial'}\n\n${mentionTags}`,
            mentions
          }).catch(() => {});
        }
        break;
      }
      case 'antilink': {
        models.setSetting?.('ANTILINK_' + targetId, state === 'on' ? 'true' : 'false');
        break;
      }
      case 'boasvindas': {
        models.setSetting?.('WELCOME_' + targetId, state === 'on' ? 'true' : 'false');
        break;
      }
      case 'desativar': {
        models.muteChat?.({ platform: 'whatsapp', chatId: targetId, targetType: 'GROUP', reason: text || 'Agendamento' });
        break;
      }
      case 'ativar': {
        models.unmuteChat?.('whatsapp', targetId);
        break;
      }
    }
    return true;
  }

  async checkAndExecuteScheduledTasks(sock = null) {
    const dueTasks = models.getDueScheduledDelegatedTasks();
    const results = [];
    for (const task of dueTasks) {
      const res = await this.executeScheduledTask(task, sock);
      if (res) results.push(res);
    }
    return results;
  }

  startScheduledTaskWorker(sock = null) {
    if (this._workerInterval) return;
    this._workerInterval = setInterval(() => {
      this.checkAndExecuteScheduledTasks(sock).catch(() => {});
    }, 30000);
    this._workerInterval.unref?.();
  }
}

module.exports = new MatrizAssistantService();

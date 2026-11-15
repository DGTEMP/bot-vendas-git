const models = require('../db/models');
const meteoricDialogueEngine = require('./meteoricDialogueEngine');

class MeteoricService {
  constructor() {
    this.isWarmupRunning = false;
    this.activeWarmupTimeouts = [];
  }

  getMeteoricPublicLink(group = null) {
    if (group && group.invite_url && !group.invite_url.includes('localhost:3000')) {
      return group.invite_url;
    }
    const tunnelService = require('./tunnelService');
    const storeUrl = tunnelService.getStoreUrl() || models.getSetting('STORE_BASE_URL', 'http://localhost:3001');
    return `${storeUrl.replace(/\/$/, '')}/l/vip`;
  }

  getDialoguePresets() {
    return {
      themes: meteoricDialogueEngine.getAvailableThemes(),
      tones: meteoricDialogueEngine.getAvailableTones(),
      templates: meteoricDialogueEngine.getTemplates()
    };
  }

  // ==========================================
  // 1. STATUS E CONFIGURAÇÕES DO LANÇAMENTO
  // ==========================================
  getCampaignStatus() {
    const campaign = models.getMeteoricCampaign();
    const groups = models.getMeteoricGroups(campaign.id);
    const activeGroup = models.getActiveMeteoricGroup(campaign.id);
    const stages = models.getMeteoricStages();

    const whatsappArmyService = require('./whatsappArmyService');
    const armySummary = whatsappArmyService.getSubBotsStatusSummary ? whatsappArmyService.getSubBotsStatusSummary() : { onlineSubBots: 0, totalSubBots: 0 };

    const totalMembers = groups.reduce((acc, g) => acc + (g.member_count || 0), 0);
    const tunnelService = require('./tunnelService');
    const storePublicUrl = tunnelService.getStoreUrl() || 'http://localhost:3001';

    return {
      campaign,
      activeGroup,
      totalGroups: groups.length,
      totalMembers,
      currentStage: stages.find(s => s.stage_num === campaign.current_stage) || stages[0],
      onlineSubBots: armySummary.onlineSubBots || 0,
      totalSubBots: armySummary.totalSubBots || 0,
      redirectUrl: `${storePublicUrl}/l/vip`
    };
  }

  updateConfig(updates = {}) {
    return models.updateMeteoricCampaign(updates);
  }

  toggleCampaign(active = null) {
    const current = models.getMeteoricCampaign();
    const newActive = active !== null ? (active ? 1 : 0) : (current.active ? 0 : 1);
    return models.updateMeteoricCampaign({ active: newActive });
  }

  // ==========================================
  // 2. CRIAÇÃO AUTOMÁTICA & GESTÃO DE GRUPOS
  // ==========================================
  async createNewMeteoricGroup(options = {}) {
    const campaign = models.getMeteoricCampaign();
    const existingGroups = models.getMeteoricGroups(campaign.id);
    const nextGroupNum = existingGroups.length + 1;

    let baseName = options.title || campaign.group_base_name || 'Oferta VIP #{num}';
    const groupTitle = baseName.replace('#{num}', `#${nextGroupNum}`).replace('{num}', nextGroupNum);
    const maxLimit = options.max_limit || campaign.max_members_per_group || 200;

    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    // 1. Ambiente de Teste ou Simulação (sem WhatsApp real conectado)
    if (process.env.NODE_ENV === 'test' || !whatsappBot.sock || !whatsappBot.isConnected) {
      const simJid = `120363${Date.now()}_${Math.random().toString(36).substring(2, 8)}@g.us`;
      const simCode = `METEOR_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const simInvite = `https://chat.whatsapp.com/${simCode}`;

      const created = models.createMeteoricGroup({
        campaign_id: campaign.id,
        group_jid: simJid,
        group_num: nextGroupNum,
        title: groupTitle,
        invite_code: simCode,
        invite_url: simInvite,
        member_count: 1,
        max_limit: maxLimit,
        is_full: 0,
        is_closed: 1
      });

      console.log(`[Lançamento Meteórico 🚀] Grupo SIMULADO criado: ${groupTitle} (${simInvite})`);
      return { success: true, group: created, simulated: true };
    }

    // 2. Conexão Real via Baileys Socket
    const mainSock = whatsappBot.sock;
    try {
      // Coleta os JIDs de todos os sub-bots para inseri-los no grupo
      const initialParticipants = [];
      if (whatsappArmyService.activeSockets) {
        for (const [instId, sBotSock] of whatsappArmyService.activeSockets.entries()) {
          const sBotJid = sBotSock.user?.id ? sBotSock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
          if (sBotJid && !initialParticipants.includes(sBotJid)) {
            initialParticipants.push(sBotJid);
          }
        }
      }

      console.log(`[Lançamento Meteórico 🚀] Criando grupo WhatsApp real: "${groupTitle}" com ${initialParticipants.length} sub-bots...`);
      const groupRes = await mainSock.groupCreate(groupTitle, initialParticipants);
      const groupJid = groupRes.id;

      // Aguarda 1.5s para Baileys propagar metadados do grupo
      await new Promise(r => setTimeout(r, 1500));

      // Obtém código de convite
      let inviteCode = '';
      let inviteUrl = '';
      try {
        inviteCode = await mainSock.groupInviteCode(groupJid);
        inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
      } catch (cErr) {
        console.warn('[Lançamento Meteórico ⚠️] Erro ao obter inviteCode imediato:', cErr.message);
      }

      // Define descrição do grupo
      if (campaign.group_description) {
        try {
          await mainSock.groupUpdateDescription(groupJid, campaign.group_description);
        } catch (_) {}
      }

      // Configura grupo em modo anúncio (fechado para membros comuns)
      try {
        await mainSock.groupSettingUpdate(groupJid, 'announcement');
      } catch (_) {}

      // Promove sub-bots a administradores do grupo para poderem falar mesmo com grupo fechado
      if (initialParticipants.length > 0) {
        try {
          await mainSock.groupParticipantsUpdate(groupJid, initialParticipants, 'promote');
        } catch (_) {}
      }

      const created = models.createMeteoricGroup({
        campaign_id: campaign.id,
        group_jid: groupJid,
        group_num: nextGroupNum,
        title: groupTitle,
        invite_code: inviteCode,
        invite_url: inviteUrl,
        member_count: initialParticipants.length + 1,
        max_limit: maxLimit,
        is_full: 0,
        is_closed: 1
      });

      console.log(`[Lançamento Meteórico ✅] Novo grupo criado com sucesso: ${groupTitle} (${inviteUrl})`);
      return { success: true, group: created };
    } catch (err) {
      console.error('[Lançamento Meteórico ❌] Falha ao criar grupo no WhatsApp:', err.message);
      throw new Error(`Falha ao criar grupo no WhatsApp: ${err.message}`);
    }
  }

  // ==========================================
  // 3. MONITORAMENTO DE LIMITE & TRANSBORDAMENTO
  // ==========================================
  async handleParticipantJoined(groupJid, sock = null) {
    const group = models.getMeteoricGroupByJid(groupJid);
    if (!group) return null; // Não é um grupo rastreado pelo Meteórico

    let currentCount = group.member_count + 1;

    // Se tiver socket real, consulta metadados atualizados do grupo
    if (sock && typeof sock.groupMetadata === 'function') {
      try {
        const meta = await sock.groupMetadata(groupJid);
        if (meta && meta.participants) {
          currentCount = meta.participants.length;
        }
      } catch (_) {}
    }

    models.updateMeteoricGroup(group.id, { member_count: currentCount });
    console.log(`[Lançamento Meteórico 👥] Grupo #${group.group_num} ("${group.title}"): ${currentCount}/${group.max_limit} participantes.`);

    try {
      models.logMeteoricActivity({
        campaign_id: group.campaign_id,
        group_jid: group.group_jid,
        group_title: group.title,
        event_type: 'MEMBER_JOINED',
        sender_name: 'Lead Entrou',
        message_text: `Participante ingressou no grupo. Lotação atualizada para ${currentCount}/${group.max_limit}.`
      });
    } catch (_) {}

    // Verifica se atingiu o limite estabelecido pelo admin
    if (currentCount >= group.max_limit && !group.is_full) {
      console.log(`[Lançamento Meteórico ⚠️] Grupo #${group.group_num} atingiu a capacidade máxima (${currentCount}/${group.max_limit})! Transbordando para novo grupo...`);
      models.updateMeteoricGroup(group.id, { is_full: 1 });

      try {
        models.logMeteoricActivity({
          campaign_id: group.campaign_id,
          group_jid: group.group_jid,
          group_title: group.title,
          event_type: 'OVERFLOW',
          sender_name: 'Sistema Meteórico',
          message_text: `Grupo #${group.group_num} lotou (${currentCount}/${group.max_limit}). Criando novo grupo sequencial...`
        });
      } catch (_) {}

      try {
        const nextResult = await this.createNewMeteoricGroup();
        if (nextResult && nextResult.group) {
          console.log(`[Lançamento Meteórico 🚀] Transbordamento concluído! Próximo grupo: #${nextResult.group.group_num} (${nextResult.group.invite_url})`);
          
          // Opcional: Avisa no grupo lotado
          if (sock && sock.sendMessage) {
            try {
              await sock.sendMessage(groupJid, {
                text: `🚨 *GRUPO LOTADO!* Atingimos a capacidade máxima de participantes. O link de novos acessos foi atualizado para os próximos membros.`
              });
            } catch (_) {}
          }
          return { overflow: true, newGroup: nextResult.group };
        }
      } catch (err) {
        console.error('[Lançamento Meteórico ❌] Erro ao transbordar grupo:', err.message);
      }
    }

    return { overflow: false, currentCount };
  }

  // ==========================================
  // 4. AQUECIMENTO & DIRETRIZES DE ETAPAS (SUB-BOTS)
  // ==========================================
  async executeStageWarmup(stageNum, targetGroupJid = null, options = {}) {
    const stage = models.getMeteoricStage(stageNum);
    if (!stage) {
      throw new Error(`Etapa ${stageNum} do Lançamento Meteórico não encontrada.`);
    }

    const campaign = models.getMeteoricCampaign();
    models.updateMeteoricCampaign({ current_stage: stageNum });
    models.updateMeteoricStage(stageNum, { executed_at: new Date().toISOString() });

    // Determina os grupos de destino: se fornecido um JID específico, envia nele; senão envia em todos os grupos ativos
    let targetGroups = [];
    if (targetGroupJid) {
      const g = models.getMeteoricGroupByJid(targetGroupJid);
      targetGroups = g ? [g] : [{ group_jid: targetGroupJid, title: 'Grupo Alvo' }];
    } else {
      targetGroups = models.getMeteoricGroups(campaign.id).filter(g => !g.is_full || options.includeFullGroups);
      if (targetGroups.length === 0) {
        // Se nenhum grupo criado ainda, busca qualquer grupo existente
        targetGroups = models.getMeteoricGroups(campaign.id);
      }
    }

    if (targetGroups.length === 0) {
      throw new Error('Nenhum grupo de Lançamento Meteórico encontrado para disparar a etapa.');
    }

    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    const adminAnnouncement = stage.admin_announcement;
    const groupMode = stage.group_mode || 'announcement'; // 'announcement' (fechado) ou 'not_announcement' (aberto)

    let subbotScripts = [];
    try {
      subbotScripts = typeof stage.subbot_scripts === 'string' ? JSON.parse(stage.subbot_scripts) : (stage.subbot_scripts || []);
    } catch (_) {
      subbotScripts = [];
    }

    const report = {
      stageNum,
      stageTitle: stage.title,
      groupMode,
      targetGroupsCount: targetGroups.length,
      announcementsSent: 0,
      subbotInteractionsScheduled: 0,
      groups: []
    };

    // Coleta sockets dos sub-bots conectados e elegíveis pelo aceite de termos do Exército
    const availableSubBots = [];
    const allArmyInsts = models.getArmyInstances();
    const instMap = new Map();
    allArmyInsts.forEach(i => instMap.set(Number(i.id), i));

    if (whatsappArmyService.activeSockets) {
      for (const [id, s] of whatsappArmyService.activeSockets.entries()) {
        const inst = instMap.get(Number(id));
        // Sub-Bots que aceitaram os termos do exército (ou bot principal)
        if (!inst || inst.is_main || inst.terms_accepted === 1 || inst.can_participate_meteoric !== 0) {
          availableSubBots.push({ id, sock: s });
        }
      }
    }

    // Determina o socket do Admin do Grupo de Captação (Matriz ou Sub-bot específico)
    const adminId = campaign.admin_subbot_id || 1;
    let adminSock = whatsappBot.sock;
    let adminName = 'Admin Oficial (Matriz)';
    if (adminId && adminId !== 1 && whatsappArmyService.activeSockets?.has(Number(adminId))) {
      adminSock = whatsappArmyService.activeSockets.get(Number(adminId));
      adminName = `Sub-Bot #${adminId} (Admin)`;
    }

    // Filtra especificamente os sub-bots atores/compradores selecionados
    let buyerSubBots = availableSubBots;
    if (campaign.buyer_subbot_ids && campaign.buyer_subbot_ids.trim()) {
      const buyerIds = campaign.buyer_subbot_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
      if (buyerIds.length > 0) {
        const filtered = availableSubBots.filter(b => buyerIds.includes(Number(b.id)));
        if (filtered.length > 0) buyerSubBots = filtered;
      }
    }

    for (const group of targetGroups) {
      const gJid = group.group_jid;

      // 1. Altera modo do grupo (aberto/fechado conforme a etapa)
      const groupControlSock = (adminSock && typeof adminSock.groupSettingUpdate === 'function') ? adminSock : whatsappBot.sock;
      if (groupControlSock && gJid.endsWith('@g.us')) {
        try {
          await groupControlSock.groupSettingUpdate(gJid, groupMode);
          models.updateMeteoricGroup(group.id, { is_closed: groupMode === 'announcement' ? 1 : 0 });
          models.logMeteoricActivity({
            campaign_id: campaign.id,
            group_jid: gJid,
            group_title: group.title,
            event_type: 'MODE_CHANGED',
            sender_name: adminName,
            message_text: `Modo do grupo alterado para ${groupMode === 'announcement' ? 'Fechado (Modo Anúncio)' : 'Aberto para Todos'}.`
          });
        } catch (_) {}
      }

      // 2. Dispara o Anúncio Oficial do Administrador Designado
      const dispatchAdminSock = adminSock || whatsappBot.sock;
      if (adminAnnouncement && dispatchAdminSock) {
        try {
          const parsedAnnouncement = models.parseSpintax(adminAnnouncement, {
            link: this.getMeteoricPublicLink(group),
            produto: campaign.name
          });

          if (stage.media_url && typeof dispatchAdminSock.sendMessage === 'function') {
            await dispatchAdminSock.sendMessage(gJid, {
              image: { url: stage.media_url },
              caption: parsedAnnouncement
            });
          } else if (typeof dispatchAdminSock.sendMessage === 'function') {
            await dispatchAdminSock.sendMessage(gJid, { text: parsedAnnouncement });
          } else {
            await whatsappBot.sendMessage(gJid, parsedAnnouncement);
          }
          report.announcementsSent++;

          models.logMeteoricActivity({
            campaign_id: campaign.id,
            group_jid: gJid,
            group_title: group.title,
            event_type: 'ANNOUNCEMENT',
            sender_name: adminName,
            message_text: parsedAnnouncement.slice(0, 160) + (parsedAnnouncement.length > 160 ? '...' : '')
          });
        } catch (annErr) {
          console.warn(`[Lançamento Meteórico ⚠️] Erro ao enviar anúncio no grupo ${gJid}:`, annErr.message);
        }
      }

      // 3. Orquestra o Aquecimento dos Sub-Bots Compradores / Atores Selecionados
      if (subbotScripts.length > 0) {
        this.scheduleSubBotDialogue(gJid, subbotScripts, buyerSubBots, {
          link: this.getMeteoricPublicLink(group),
          produto: campaign.name
        });
        report.subbotInteractionsScheduled += subbotScripts.length;
      }

      report.groups.push({ id: group.id, title: group.title, jid: gJid });
    }

    console.log(`[Lançamento Meteórico 🔥] Etapa #${stageNum} ("${stage.title}") iniciada com sucesso em ${targetGroups.length} grupos!`);
    return report;
  }

  // Agenda falas realistas entre sub-bots com digitação e intervalo humano
  scheduleSubBotDialogue(groupJid, scripts, availableSubBots, vars = {}) {
    let accumulatedDelayMs = 2000;

    const campaign = models.getMeteoricCampaign();
    const armyService = require('./whatsappArmyService');
    const allArmyInstances = models.getArmyInstances().filter(a => a.id !== 1);

    let actors = Array.isArray(availableSubBots) ? availableSubBots : [];
    if (campaign && campaign.buyer_subbot_ids && campaign.buyer_subbot_ids.trim() && actors.length > 0) {
      const buyerIds = campaign.buyer_subbot_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
      if (buyerIds.length > 0) {
        const filtered = actors.filter(b => buyerIds.includes(Number(b.id)));
        if (filtered.length > 0) actors = filtered;
      }
    }

    scripts.forEach((item, index) => {
      const delayMs = Math.max(2000, (item.stepDelay ? item.stepDelay * 1000 : (item.delay ? item.delay * 1000 : (index * 6 + 3) * 1000)));
      accumulatedDelayMs += delayMs;

      const timeoutId = setTimeout(async () => {
        try {
          const rawText = item.text || item.message || '';
          if (!rawText) return;

          const parsedText = models.parseSpintax(rawText, vars);

          // 1. Identifica o Sub-Bot a ser utilizado
          let chosenSubBot = null;
          let targetBotId = item.subBotId;

          // Se um subBotId específico foi atribuído na linha do tempo
          if (targetBotId && targetBotId !== 1) {
            chosenSubBot = Array.isArray(actors) ? actors.find(a => a && a.id && Number(a.id) === Number(targetBotId)) : null;
            if (!chosenSubBot && armyService.activeSockets?.has(Number(targetBotId))) {
              chosenSubBot = { id: Number(targetBotId), sock: armyService.activeSockets.get(Number(targetBotId)) };
            }
          }

          // Se não encontrou, pega rotativo entre os atores disponíveis ou instâncias do exército
          if (!chosenSubBot && Array.isArray(actors) && actors.length > 0) {
            const validActors = actors.filter(a => a && a.id);
            if (validActors.length > 0) {
              chosenSubBot = validActors[index % validActors.length];
            }
          }
          if (!chosenSubBot && Array.isArray(allArmyInstances) && allArmyInstances.length > 0) {
            const validInsts = allArmyInstances.filter(i => i && i.id);
            if (validInsts.length > 0) {
              const inst = validInsts[index % validInsts.length];
              chosenSubBot = {
                id: inst.id,
                sock: armyService.activeSockets?.get(inst.id) || null,
                name: inst.name
              };
            }
          }

          const botLabel = chosenSubBot ? (chosenSubBot.name || `Chip #${chosenSubBot.id}`) : `Sub-Bot #${index + 2}`;

          // 2. Disparo via Socket Baileys Real se conectado
          if (chosenSubBot && (chosenSubBot.sock || (chosenSubBot.id && armyService.activeSockets?.has(Number(chosenSubBot.id))))) {
            const realSock = chosenSubBot.sock || armyService.activeSockets.get(Number(chosenSubBot.id));
            try {
              if (typeof realSock.sendPresenceUpdate === 'function') {
                await realSock.sendPresenceUpdate('composing', groupJid);
              }
              const humanTypeTime = Math.min(4000, Math.max(1200, parsedText.length * 30));
              await new Promise(r => setTimeout(r, humanTypeTime));
            } catch (_) {}

            await realSock.sendMessage(groupJid, { text: parsedText });
            // Registra como disparo legítimo para evitar falso positivo de rogue
            if (typeof armyService.registerLegitimateDispatch === 'function') {
              // O key.id da última mensagem enviada não é retornado diretamente, usamos timestamp como proxy
              // mas o suficiente é marcar o período como "orquestração ativa"
              armyService._orchestrationActive = true;
              setTimeout(() => { armyService._orchestrationActive = false; }, 10000);
            }
            if (chosenSubBot?.id) models.incrementInstanceSentCount(chosenSubBot.id);
            console.log(`[Meteórico Sub-Bot 💬 ${botLabel}] Falou no grupo ${groupJid}: "${parsedText}"`);
          } else if (chosenSubBot && chosenSubBot.id) {
            // Disparo via motor do Exército (suporta modo de simulação com métricas)
            await armyService.sendArmyMessage(chosenSubBot.id, groupJid, parsedText);
            console.log(`[Meteórico Sub-Bot 💬 ${botLabel}] Mensagem enviada via motor do exército: "${parsedText}"`);
          } else {
            // Fallback para Matriz se nenhum sub-bot disponível
            const whatsappBot = require('../bots/whatsappBot');
            if (whatsappBot.sock && whatsappBot.isConnected) {
              await whatsappBot.sendMessage(groupJid, parsedText);
            } else {
              console.log(`[Meteórico Sub-Bot (Simulação) 💬] Falou no grupo ${groupJid}: "${parsedText}"`);
            }
          }

          // Log de atividade no feed com persona e identificador
          models.logMeteoricActivity({
            campaign_id: (campaign && typeof campaign === 'object') ? (campaign.id || 1) : (typeof campaign === 'number' ? campaign : 1),
            group_jid: groupJid,
            event_type: 'SUBBOT_SPEECH',
            sender_name: item.speaker || botLabel,
            message_text: parsedText.slice(0, 160)
          });
        } catch (err) {
          console.warn(`[Lançamento Meteórico ⚠️] Erro na interação de sub-bot:`, err.message);
        }
      }, accumulatedDelayMs);

      this.activeWarmupTimeouts.push(timeoutId);
    });
  }

  // Aquecimento instantâneo avulso
  async executeInstantWarmup(groupJid, customText = null) {
    const scripts = customText 
      ? [{ speaker: 'subbot_any', delay: 2, text: customText }]
      : [
          { speaker: 'subbot_any', delay: 2, text: '{Caraca, muito top!|Show de bola!|Sensacional essa novidade!}' },
          { speaker: 'subbot_any', delay: 8, text: '{Como faço pra garantir o meu?|Já tá liberado para comprar?}' }
        ];

    const whatsappArmyService = require('./whatsappArmyService');
    const availableSubBots = [];
    if (whatsappArmyService.activeSockets) {
      for (const [id, s] of whatsappArmyService.activeSockets.entries()) {
        availableSubBots.push({ id, sock: s });
      }
    }

    this.scheduleSubBotDialogue(groupJid, scripts, availableSubBots);
    return { success: true, count: scripts.length };
  }

  // Abre ou fecha o grupo para mensagens
  async setGroupMode(groupJid, mode = 'closed') {
    const whatsappBot = require('../bots/whatsappBot');
    const setting = mode === 'open' || mode === 'not_announcement' ? 'not_announcement' : 'announcement';

    if (whatsappBot.sock && whatsappBot.isConnected && typeof whatsappBot.sock.groupSettingUpdate === 'function') {
      try {
        await whatsappBot.sock.groupSettingUpdate(groupJid, setting);
      } catch (_) {}
    }

    const group = models.getMeteoricGroupByJid(groupJid);
    if (group) {
      models.updateMeteoricGroup(group.id, { is_closed: setting === 'announcement' ? 1 : 0 });
      try {
        models.logMeteoricActivity({
          campaign_id: group.campaign_id,
          group_jid: groupJid,
          group_title: group.title,
          event_type: 'MODE_CHANGED',
          sender_name: 'Painel Web',
          message_text: `Grupo ${setting === 'announcement' ? 'fechado para modo anúncio' : 'aberto para mensagens de todos'}.`
        });
      } catch (_) {}
    }
    return { success: true, mode: setting === 'announcement' ? 'closed' : 'open', setting };
  }

  // Alterna o modo de TODOS os grupos do lançamento em lote (Abrir Todos / Fechar Todos)
  async setAllGroupsMode(mode) {
    const campaign = models.getMeteoricCampaign();
    const groups = models.getMeteoricGroups(campaign.id);
    const results = [];

    for (const g of groups) {
      try {
        const res = await this.setGroupMode(g.group_jid, mode);
        results.push({ id: g.id, jid: g.group_jid, success: true, ...res });
      } catch (err) {
        results.push({ id: g.id, jid: g.group_jid, success: false, error: err.message });
      }
    }
    return { success: true, mode, updatedCount: results.filter(r => r.success).length, results };
  }

  // Envio de mensagem personalizada pelo Painel Web (Matriz ou Sub-Bot com suporte opcional a Imagem/Banner)
  async sendMessageToGroups({ targetGroupJid = 'all', senderType = 'admin', senderInstanceId = null, text, mediaUrl = null }) {
    if (!text || !text.trim()) throw new Error('Mensagem não pode ser vazia');

    const campaign = models.getMeteoricCampaign();
    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    let targetGroups = [];
    if (targetGroupJid === 'all' || !targetGroupJid) {
      targetGroups = models.getMeteoricGroups(campaign.id);
    } else {
      const single = models.getMeteoricGroupByJid(targetGroupJid) || models.getMeteoricGroupById(parseInt(targetGroupJid, 10));
      if (single) targetGroups = [single];
      else targetGroups = [{ group_jid: targetGroupJid, title: 'Grupo Selecionado', invite_url: this.getMeteoricPublicLink() }];
    }

    if (targetGroups.length === 0) throw new Error('Nenhum grupo encontrado para envio');

    const results = [];
    for (const group of targetGroups) {
      const gJid = group.group_jid;
      const parsedText = models.parseSpintax(text.trim(), {
        link: this.getMeteoricPublicLink(group),
        produto: campaign.name
      });

      try {
        if (senderType === 'subbot') {
          let chosenSock = null;
          let subBotLabel = 'Sub-Bot';

          if (senderInstanceId && whatsappArmyService.activeSockets?.has(parseInt(senderInstanceId, 10))) {
            chosenSock = whatsappArmyService.activeSockets.get(parseInt(senderInstanceId, 10));
            subBotLabel = `Sub-Bot #${senderInstanceId}`;
          } else if (whatsappArmyService.activeSockets?.size > 0) {
            const firstEntry = Array.from(whatsappArmyService.activeSockets.entries())[0];
            chosenSock = firstEntry[1];
            subBotLabel = `Sub-Bot #${firstEntry[0]}`;
          }

          if (chosenSock) {
            try {
              await chosenSock.sendPresenceUpdate('composing', gJid);
              await new Promise(r => setTimeout(r, 1200));
            } catch (_) {}

            if (mediaUrl && typeof chosenSock.sendMessage === 'function') {
              await chosenSock.sendMessage(gJid, { image: { url: mediaUrl }, caption: parsedText });
            } else {
              await chosenSock.sendMessage(gJid, { text: parsedText });
            }
            results.push({ jid: gJid, success: true, sender: subBotLabel });
          } else {
            // Fallback para Matriz se nenhum sub-bot conectado
            if (mediaUrl && whatsappBot.sock && typeof whatsappBot.sock.sendMessage === 'function') {
              await whatsappBot.sock.sendMessage(gJid, { image: { url: mediaUrl }, caption: parsedText });
            } else {
              await whatsappBot.sendMessage(gJid, parsedText);
            }
            results.push({ jid: gJid, success: true, sender: 'Matriz (Fallback)' });
          }
        } else {
          // Remetente padrão: Matriz Oficial (Admin)
          if (mediaUrl && whatsappBot.sock && typeof whatsappBot.sock.sendMessage === 'function') {
            await whatsappBot.sock.sendMessage(gJid, { image: { url: mediaUrl }, caption: parsedText });
          } else {
            await whatsappBot.sendMessage(gJid, parsedText);
          }
          results.push({ jid: gJid, success: true, sender: 'Admin Oficial (Matriz)' });
        }

        models.logMeteoricActivity({
          campaign_id: campaign.id,
          group_jid: gJid,
          group_title: group.title,
          event_type: 'WEB_MESSAGE',
          sender_name: senderType === 'subbot' ? 'Sub-Bot' : 'Admin Web',
          message_text: (mediaUrl ? '[🖼️ Imagem] ' : '') + parsedText.slice(0, 150) + (parsedText.length > 150 ? '...' : '')
        });
      } catch (err) {
        results.push({ jid: gJid, success: false, error: err.message });
      }
    }

    return { success: true, totalSent: results.filter(r => r.success).length, results };
  }

  // Verifica e executa etapas agendadas automaticamente (Cron)
  async checkAndExecuteScheduledStages() {
    const dueStages = models.getDueScheduledStages();
    if (!dueStages || dueStages.length === 0) return { executed: 0 };

    const reports = [];
    for (const stage of dueStages) {
      console.log(`[Lançamento Meteórico ⏰ Cron] Disparando Etapa #${stage.stage_num} agendada para ${stage.scheduled_at}...`);
      try {
        const report = await this.executeStageWarmup(stage.stage_num);
        models.updateMeteoricStage(stage.stage_num, {
          auto_execute: 0,
          executed_at: new Date().toISOString()
        });
        models.logMeteoricActivity({
          campaign_id: 1,
          group_jid: null,
          group_title: 'Todos os Grupos VIP',
          event_type: 'SCHEDULED_STAGE_TRIGGERED',
          sender_name: 'Cron Automático',
          message_text: `Etapa #${stage.stage_num} (${stage.title}) executada automaticamente no horário agendado!`
        });
        reports.push({ stageNum: stage.stage_num, success: true, report });
      } catch (err) {
        console.error(`[Meteórico ❌ Cron Erro ao disparar etapa #${stage.stage_num}]:`, err.message);
        reports.push({ stageNum: stage.stage_num, success: false, error: err.message });
      }
    }
    return { executed: reports.length, reports };
  }

  // Sincroniza metadados reais de participantes com o WhatsApp sem precisar de celular
  async syncGroupParticipants(targetGroupJid = null) {
    const whatsappBot = require('../bots/whatsappBot');
    const campaign = models.getMeteoricCampaign();
    let groups = models.getMeteoricGroups(campaign.id);

    if (targetGroupJid) {
      groups = groups.filter(g => g.group_jid === targetGroupJid);
    }

    const updated = [];
    for (const g of groups) {
      if (whatsappBot.sock && whatsappBot.isConnected && typeof whatsappBot.sock.groupMetadata === 'function') {
        try {
          const meta = await whatsappBot.sock.groupMetadata(g.group_jid);
          if (meta && meta.participants) {
            const count = meta.participants.length;
            const isFull = count >= g.max_limit ? 1 : 0;
            models.updateMeteoricGroup(g.id, { member_count: count, is_full: isFull });
            updated.push({ id: g.id, jid: g.group_jid, count });
          }
        } catch (_) {}
      }
    }
    return { success: true, count: updated.length, updated };
  }

  // Exclui grupo de teste ou arquivado
  deleteGroup(groupId) {
    return models.deleteMeteoricGroup(parseInt(groupId, 10));
  }

  // Retorna feed de atividades ao vivo para a web
  getActivityLogs(limit = 40) {
    return models.getMeteoricActivityLogs(limit);
  }

  // Limpa feed de atividades
  clearActivityLogs() {
    return models.clearMeteoricActivityLogs();
  }

  // Gera, pré-visualiza ou executa simulação interativa de conversas entre sub-bots (com suporte a 100+ WhatsApps)
  async generateOrSimulateDialogue({
    targetGroupJid = null,
    theme = 'social_proof_herd',
    tone = 'misto_organico',
    count = null,
    customScripts = null,
    delaySeconds = 4,
    dryRun = false,
    subBotIds = null
  } = {}) {
    // Normalização de temas legados para os novos temas ricos
    const legacyThemeMap = {
      social_proof: 'social_proof_herd',
      objection_breaking: 'objection_guarantee',
      payment_doubt: 'payment_methods',
      urgency: 'scarcity_lot_switch'
    };
    const effectiveTheme = legacyThemeMap[theme] || theme;

    const campaign = models.getMeteoricCampaign();
    const armyService = require('./whatsappArmyService');
    const allArmy = armyService.getAllAccounts();

    // Filtra instâncias caso o usuário tenha selecionado IDs específicos
    let activeArmy = allArmy;
    if (subBotIds) {
      const allowedIds = String(subBotIds).split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
      if (allowedIds.length > 0) {
        activeArmy = allArmy.filter(a => allowedIds.includes(Number(a.id)));
      }
    }

    const generated = meteoricDialogueEngine.generateDialogue({
      theme: effectiveTheme,
      tone,
      count,
      targetGroupJid,
      customScripts,
      delaySeconds,
      armyInstances: activeArmy,
      vars: {
        link: this.getMeteoricPublicLink(),
        produto: campaign?.name || 'Oferta VIP',
        desconto: '50% de Desconto'
      }
    });

    const formattedTimeline = generated.timeline;

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        theme: effectiveTheme,
        tone,
        targetGroupJid: targetGroupJid || 'preview_screen',
        dialogueCount: formattedTimeline.length,
        timeline: formattedTimeline
      };
    }

    // Execução real em grupos do WhatsApp
    let targetJids = [];
    if (!targetGroupJid || targetGroupJid === 'all') {
      const allGroups = models.getMeteoricGroups(campaign ? campaign.id : 1);
      targetJids = allGroups.map(g => g.group_jid);
      if (targetJids.length === 0) {
        const activeGrp = models.getActiveMeteoricGroup();
        if (activeGrp) targetJids = [activeGrp.group_jid];
      }
    } else if (targetGroupJid !== 'preview_only') {
      targetJids = [targetGroupJid];
    }

    // Prepara sub-bots disponíveis para envio real
    const availableSubBots = [];
    if (armyService.activeSockets) {
      for (const [id, s] of armyService.activeSockets.entries()) {
        if (id !== 1) {
          availableSubBots.push({ id, sock: s });
        }
      }
    }
    // Adiciona instâncias cadastradas no banco mesmo sem socket aberto (modo simulação/teste)
    allArmy.forEach(inst => {
      if (inst.id !== 1 && !availableSubBots.some(b => Number(b.id) === Number(inst.id))) {
        availableSubBots.push(inst);
      }
    });

    for (const jid of targetJids) {
      const scriptItems = formattedTimeline.map(item => ({
        subBotId: item.subBotId,
        speaker: item.speaker,
        stepDelay: item.stepDelay,
        delay: item.stepDelay,
        text: item.text
      }));

      this.scheduleSubBotDialogue(jid, scriptItems, availableSubBots, {
        link: this.getMeteoricPublicLink(),
        produto: campaign?.name || 'Oferta VIP'
      });

      models.logMeteoricActivity({
        campaign_id: campaign ? campaign.id : 1,
        group_jid: jid,
        event_type: 'SUBBOT_SIMULATION',
        sender_name: 'Sub-Bots (Injetor de Conversas)',
        message_text: `Injeção de diálogo (${effectiveTheme} / ${tone}) disparada com ${scriptItems.length} falas humanas para o exército`
      });
    }

    return {
      success: true,
      dryRun: false,
      theme: effectiveTheme,
      tone,
      targetGroupsCount: targetJids.length,
      dialogueCount: formattedTimeline.length,
      timeline: formattedTimeline
    };
  }

  // Obtém leads / participantes de um grupo para exportação CSV ou remarketing
  async getGroupLeads(groupJid) {
    const whatsappBot = require('../bots/whatsappBot');
    let leads = [];

    // 1. Tenta recuperar do cache de grupos do WhatsApp (já possui participantes completos sem bater na API)
    if (whatsappBot.cachedGroups && Array.isArray(whatsappBot.cachedGroups)) {
      const foundInCache = whatsappBot.cachedGroups.find(cg => cg.id === groupJid);
      if (foundInCache && foundInCache.participants && foundInCache.participants.length > 0) {
        return foundInCache.participants.map(p => ({
          id: p.id,
          phone: p.phone || (p.id ? p.id.split('@')[0].split(':')[0] : ''),
          admin: p.admin || 'membro',
          groupJid,
          groupName: foundInCache.subject || 'Grupo VIP'
        }));
      }
    }

    // 2. Se não estiver no cache, consulta metadados do Baileys
    if (whatsappBot.sock && whatsappBot.isConnected && typeof whatsappBot.sock.groupMetadata === 'function') {
      try {
        const meta = await whatsappBot.sock.groupMetadata(groupJid);
        if (meta && meta.participants) {
          leads = meta.participants.map(p => ({
            id: p.id,
            phone: p.id ? p.id.split('@')[0].split(':')[0] : '',
            admin: p.admin || 'membro',
            groupJid,
            groupName: meta.subject || 'Grupo VIP'
          }));
        }
      } catch (err) {
        // Ignora silenciosamente se o grupo não existir mais ou por limite de requisições temporário
      }
    }

    // 3. Fallback: recupera telefones que já enviaram mensagens no histórico deste grupo
    if (leads.length === 0) {
      const logs = models.getMeteoricActivityLogs(200);
      const groupLogs = logs.filter(l => l.group_jid === groupJid && l.lead_phone);
      const seenPhones = new Set();
      groupLogs.forEach(l => {
        if (!seenPhones.has(l.lead_phone)) {
          seenPhones.add(l.lead_phone);
          leads.push({
            id: `${l.lead_phone}@s.whatsapp.net`,
            phone: l.lead_phone,
            admin: 'membro',
            groupJid,
            groupName: 'Grupo Meteórico'
          });
        }
      });
    }

    return leads;
  }

  // ==========================================
  // 6. PAPÉIS DOS SUB-BOTS & MOVIMENTAÇÃO DE COMPRADORES PARA GRUPO VIP
  // ==========================================
  getRolesConfig() {
    const campaign = models.getMeteoricCampaign();
    const product = models.getProductById(campaign.product_id || 1);

    return {
      campaign_id: campaign.id,
      product_id: campaign.product_id || 1,
      product_name: product?.name || 'Produto Principal',
      admin_subbot_id: campaign.admin_subbot_id || 1,
      buyer_subbot_ids: campaign.buyer_subbot_ids || '',
      buyers_group_jid: campaign.buyers_group_jid || product?.buyers_group_jid || '',
      buyers_group_invite_url: campaign.buyers_group_invite_url || product?.buyers_group_invite_url || '',
      buyers_group_admin_id: campaign.buyers_group_admin_id || product?.buyers_group_admin_id || 1,
      buyers_group_workflow: campaign.buyers_group_workflow || product?.buyers_group_workflow || '',
      auto_move_buyers: campaign.auto_move_buyers !== 0
    };
  }

  updateRolesConfig(updates = {}) {
    const payload = {};
    if (updates.product_id !== undefined) payload.product_id = parseInt(updates.product_id, 10) || 1;
    if (updates.admin_subbot_id !== undefined) payload.admin_subbot_id = parseInt(updates.admin_subbot_id, 10) || 1;
    if (updates.buyer_subbot_ids !== undefined) payload.buyer_subbot_ids = String(updates.buyer_subbot_ids).trim();
    if (updates.buyers_group_jid !== undefined) payload.buyers_group_jid = String(updates.buyers_group_jid).trim();
    if (updates.buyers_group_invite_url !== undefined) payload.buyers_group_invite_url = String(updates.buyers_group_invite_url).trim();
    if (updates.buyers_group_admin_id !== undefined) payload.buyers_group_admin_id = parseInt(updates.buyers_group_admin_id, 10) || 1;
    if (updates.buyers_group_workflow !== undefined) payload.buyers_group_workflow = String(updates.buyers_group_workflow).trim();
    if (updates.auto_move_buyers !== undefined) payload.auto_move_buyers = updates.auto_move_buyers ? 1 : 0;

    models.updateMeteoricCampaign(payload);

    // Se um product_id foi indicado, sincroniza também os campos no produto correspondente
    if (payload.product_id) {
      try {
        models.updateProduct(payload.product_id, {
          buyers_group_jid: payload.buyers_group_jid,
          buyers_group_invite_url: payload.buyers_group_invite_url,
          buyers_group_admin_id: payload.buyers_group_admin_id,
          buyers_group_workflow: payload.buyers_group_workflow
        });
      } catch (_) {}
    }

    return this.getRolesConfig();
  }

  async handleLeadPurchase(order) {
    if (!order) return { success: false, reason: 'ORDER_NULL' };

    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');

    const campaign = models.getMeteoricCampaign();
    const product = models.getProductById(order.product_id);

    // Prioriza configuração específica do produto; fallback para a campanha meteórica
    const buyersGroupJid = (product?.buyers_group_jid || campaign.buyers_group_jid || '').trim();
    const buyersGroupInvite = (product?.buyers_group_invite_url || campaign.buyers_group_invite_url || '').trim();
    const buyersAdminId = product?.buyers_group_admin_id || campaign.buyers_group_admin_id || 1;
    const workflowInstructions = (product?.buyers_group_workflow || campaign.buyers_group_workflow || '').trim();

    if (!buyersGroupJid && !buyersGroupInvite) {
      return { success: true, handled: false, reason: 'NO_BUYERS_GROUP_CONFIGURED' };
    }

    const customerPhone = String(order.platform_user_id || order.phone || '').replace(/\D/g, '');
    if (!customerPhone) return { success: false, reason: 'INVALID_PHONE' };
    const buyerJid = `${customerPhone}@s.whatsapp.net`;
    const customerName = order.platform_user_name || order.customer_name || 'Cliente VIP';
    const prodName = product?.name || campaign.name || 'Produto VIP';

    // Obtém o socket do Sub-Bot Administrador exclusivo do Grupo de Compradores
    let buyersAdminSock = null;
    let adminLabel = 'Admin Compradores (Matriz)';
    if (buyersAdminId && buyersAdminId !== 1 && whatsappArmyService.activeSockets?.has(Number(buyersAdminId))) {
      buyersAdminSock = whatsappArmyService.activeSockets.get(Number(buyersAdminId));
      adminLabel = `Sub-Bot #${buyersAdminId} (Admin Compradores)`;
    } else {
      buyersAdminSock = whatsappBot.sock;
    }

    const result = {
      success: true,
      buyerJid,
      customerName,
      productName: prodName,
      buyersGroupJid,
      buyersGroupInvite,
      adminAssigned: adminLabel,
      directAdded: false,
      inviteSent: false,
      onboardingWorkflowExecuted: false
    };

    // 1. Adiciona o comprador diretamente ao Grupo de Compradores se o JID for de grupo
    if (buyersGroupJid && buyersGroupJid.endsWith('@g.us') && buyersAdminSock && typeof buyersAdminSock.groupParticipantsUpdate === 'function') {
      try {
        const updateRes = await buyersAdminSock.groupParticipantsUpdate(buyersGroupJid, [buyerJid], 'add');
        if (updateRes && Array.isArray(updateRes) && updateRes[0]?.status === '200') {
          result.directAdded = true;
          console.log(`[Meteórico 👑 Movimentação] Comprador ${customerPhone} adicionado diretamente ao Grupo de Compradores VIP ${buyersGroupJid}!`);
        }
      } catch (addErr) {
        console.warn(`[Meteórico ⚠️ Adição direta ao Grupo VIP]:`, addErr.message);
      }
    }

    // 2. Envia mensagem privada VIP ao comprador com o link oficial e boas-vindas do novo admin
    const inviteUrlToUse = buyersGroupInvite || (result.directAdded ? null : 'Acesso VIP Liberado');
    const privateVipMessage =
      `👑 *PARABÉNS PELA COMPRA, ${customerName.toUpperCase()}!* 🎉\n\n` +
      `Seu pagamento para *${prodName}* foi 100% confirmado!\n\n` +
      `Você acaba de ser promovido para o nosso *Grupo Exclusivo de Compradores VIP*.\n` +
      (inviteUrlToUse ? `👉 *Entre no Grupo VIP de Clientes pelo link abaixo:*\n${inviteUrlToUse}\n\n` : '') +
      `Lá você terá acompanhamento prioritário e todas as orientações operacionais do produto pelo Administrador exclusivo da turma.\n\n` +
      `Estamos muito felizes em ter você conosco!`;

    try {
      if (buyersAdminSock && typeof buyersAdminSock.sendMessage === 'function') {
        await buyersAdminSock.sendMessage(buyerJid, { text: privateVipMessage });
        result.inviteSent = true;
      } else if (whatsappBot.sock && whatsappBot.isConnected) {
        await whatsappBot.sendMessage(buyerJid, privateVipMessage);
        result.inviteSent = true;
      }
    } catch (msgErr) {
      console.warn(`[Meteórico ⚠️ Erro ao enviar convite VIP privado]:`, msgErr.message);
    }

    // 3. Executa a tarefa do novo Admin no Grupo de Compradores (Onboarding & Fluxo Operacional Único)
    if (buyersGroupJid && buyersGroupJid.endsWith('@g.us')) {
      const defaultWorkflow =
        `👋 *SEJA BEM-VINDO(A) AO GRUPO VIP DE COMPRADORES!* 🚀\n\n` +
        `Recebemos a confirmação de entrada do(a) *${customerName}*!\n\n` +
        `📋 *Fluxo Operacional do Produto:* \n` +
        `1. Seus acessos e credenciais já foram liberados;\n` +
        `2. Assista às instruções fixadas no topo do grupo;\n` +
        `3. Qualquer dúvida operacional, basta me marcar como Admin aqui no grupo que te guiarei passo a passo!`;

      const finalWorkflowText = models.parseSpintax(workflowInstructions || defaultWorkflow, {
        nome: customerName,
        produto: prodName,
        telefone: customerPhone
      });

      try {
        if (buyersAdminSock && typeof buyersAdminSock.sendMessage === 'function') {
          setTimeout(async () => {
            try {
              await buyersAdminSock.sendMessage(buyersGroupJid, { text: finalWorkflowText });
            } catch (_) {}
          }, 3500);
          result.onboardingWorkflowExecuted = true;
        }
      } catch (wfErr) {
        console.warn(`[Meteórico ⚠️ Erro ao postar fluxo operacional no grupo de compradores]:`, wfErr.message);
      }
    }

    // 4. Registra no log de atividades do Lançamento Meteórico
    models.logMeteoricActivity({
      campaign_id: campaign.id,
      group_jid: buyersGroupJid || null,
      group_title: 'Grupo VIP de Compradores',
      event_type: 'BUYER_MOVED_TO_VIP',
      sender_name: adminLabel,
      message_text: `Cliente ${customerName} (+${customerPhone}) promovido ao Grupo de Compradores VIP do produto ${prodName}.`
    });

    return result;
  }
}

module.exports = new MeteoricService();

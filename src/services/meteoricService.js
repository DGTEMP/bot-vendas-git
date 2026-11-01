const models = require('../db/models');

class MeteoricService {
  constructor() {
    this.isWarmupRunning = false;
    this.activeWarmupTimeouts = [];
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

    return {
      campaign,
      activeGroup,
      totalGroups: groups.length,
      totalMembers,
      currentStage: stages.find(s => s.stage_num === campaign.current_stage) || stages[0],
      onlineSubBots: armySummary.onlineSubBots || 0,
      totalSubBots: armySummary.totalSubBots || 0,
      redirectUrl: `/l/vip`
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

    // Coleta sockets dos sub-bots conectados
    const availableSubBots = [];
    if (whatsappArmyService.activeSockets) {
      for (const [id, s] of whatsappArmyService.activeSockets.entries()) {
        availableSubBots.push({ id, sock: s });
      }
    }

    for (const group of targetGroups) {
      const gJid = group.group_jid;

      // 1. Altera modo do grupo (aberto/fechado conforme a etapa)
      if (whatsappBot.sock && whatsappBot.isConnected && gJid.endsWith('@g.us')) {
        try {
          await whatsappBot.sock.groupSettingUpdate(gJid, groupMode);
          models.updateMeteoricGroup(group.id, { is_closed: groupMode === 'announcement' ? 1 : 0 });
          models.logMeteoricActivity({
            campaign_id: campaign.id,
            group_jid: gJid,
            group_title: group.title,
            event_type: 'MODE_CHANGED',
            sender_name: 'Admin',
            message_text: `Modo do grupo alterado para ${groupMode === 'announcement' ? 'Fechado (Modo Anúncio)' : 'Aberto para Todos'}.`
          });
        } catch (_) {}
      }

      // 2. Dispara o Anúncio Oficial do Administrador (Matriz)
      if (adminAnnouncement && whatsappBot.sock && whatsappBot.isConnected) {
        try {
          const parsedAnnouncement = models.parseSpintax(adminAnnouncement, {
            link: group.invite_url || `http://localhost:3000/l/vip`,
            produto: campaign.name
          });

          if (stage.media_url && typeof whatsappBot.sock.sendMessage === 'function') {
            await whatsappBot.sock.sendMessage(gJid, {
              image: { url: stage.media_url },
              caption: parsedAnnouncement
            });
          } else {
            await whatsappBot.sendMessage(gJid, parsedAnnouncement);
          }
          report.announcementsSent++;

          models.logMeteoricActivity({
            campaign_id: campaign.id,
            group_jid: gJid,
            group_title: group.title,
            event_type: 'ANNOUNCEMENT',
            sender_name: 'Admin Oficial (Matriz)',
            message_text: parsedAnnouncement.slice(0, 160) + (parsedAnnouncement.length > 160 ? '...' : '')
          });
        } catch (annErr) {
          console.warn(`[Lançamento Meteórico ⚠️] Erro ao enviar anúncio no grupo ${gJid}:`, annErr.message);
        }
      }

      // 3. Orquestra o Aquecimento dos Sub-Bots (Diretrizes da Etapa)
      if (subbotScripts.length > 0) {
        this.scheduleSubBotDialogue(gJid, subbotScripts, availableSubBots, {
          link: group.invite_url || `http://localhost:3000/l/vip`,
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

    scripts.forEach((item, index) => {
      const delayMs = Math.max(3000, (item.delay || (index * 7 + 4)) * 1000);
      accumulatedDelayMs += delayMs;

      const timeoutId = setTimeout(async () => {
        try {
          const rawText = item.text || item.message || '';
          if (!rawText) return;

          const parsedText = models.parseSpintax(rawText, vars);

          // Escolhe o sub-bot que vai falar nesta interação (rotativo)
          let chosenSubBot = null;
          if (availableSubBots.length > 0) {
            chosenSubBot = availableSubBots[index % availableSubBots.length];
          }

          if (chosenSubBot && chosenSubBot.sock) {
            // Sub-bot real: simula presença digitando e envia
            try {
              await chosenSubBot.sock.sendPresenceUpdate('composing', groupJid);
              await new Promise(r => setTimeout(r, 2000));
            } catch (_) {}
            await chosenSubBot.sock.sendMessage(groupJid, { text: parsedText });
            console.log(`[Meteórico Sub-Bot 💬 Chip #${chosenSubBot.id}] Falou no grupo ${groupJid}: "${parsedText}"`);
          } else {
            // Fallback ou modo simulação: usa Matriz ou console
            const whatsappBot = require('../bots/whatsappBot');
            if (whatsappBot.sock && whatsappBot.isConnected) {
              await whatsappBot.sendMessage(groupJid, parsedText);
            } else {
              console.log(`[Meteórico Sub-Bot (Simulação) 💬] Falou no grupo ${groupJid}: "${parsedText}"`);
            }
          }
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
      else targetGroups = [{ group_jid: targetGroupJid, title: 'Grupo Selecionado', invite_url: 'http://localhost:3000/l/vip' }];
    }

    if (targetGroups.length === 0) throw new Error('Nenhum grupo encontrado para envio');

    const results = [];
    for (const group of targetGroups) {
      const gJid = group.group_jid;
      const parsedText = models.parseSpintax(text.trim(), {
        link: group.invite_url || 'http://localhost:3000/l/vip',
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

  // Gera, pré-visualiza ou executa simulação interativa de conversas entre sub-bots
  async generateOrSimulateDialogue({ targetGroupJid = null, theme = 'social_proof', customScripts = null, delaySeconds = 4, dryRun = false } = {}) {
    const presets = {
      social_proof: [
        { speaker: 'Sub-Bot 1 (Comprador)', text: '{Caraca galera|Gente}, acabei de fazer minha inscrição! O link abriu certinho aqui 🔥', delay: 2 },
        { speaker: 'Sub-Bot 2 (Interessado)', text: 'Chegou o acesso no seu e-mail na hora? Pagou por Pix ou Cartão?', delay: Math.max(3, delaySeconds) },
        { speaker: 'Sub-Bot 1 (Comprador)', text: 'Paguei no Pix com desconto e já tô dentro da área de membros! Muito top', delay: Math.max(3, delaySeconds * 1.5) },
        { speaker: 'Sub-Bot 3 (Garantia)', text: 'Show! Eu tava em dúvida mas com essa condição não dá pra deixar passar, gerando meu Pix agora', delay: Math.max(3, delaySeconds * 2.2) }
      ],
      objection_breaking: [
        { speaker: 'Sub-Bot 1 (Dúvida)', text: 'Uma dúvida: se eu não me adaptar ou não tiver tempo de ver as aulas essa semana, tem garantia?', delay: 2 },
        { speaker: 'Sub-Bot 2 (Suporte/Membro)', text: 'Tem garantia incondicional de 7 dias sim! Você entra, testa e se não curtir devolvem 100% sem burocracia.', delay: Math.max(3, delaySeconds) },
        { speaker: 'Sub-Bot 1 (Dúvida)', text: 'Ah top demais, sem risco nenhum então! Vou garantir a minha vaga agora', delay: Math.max(3, delaySeconds * 1.5) }
      ],
      payment_doubt: [
        { speaker: 'Sub-Bot 1 (Dúvida Pix)', text: 'Pessoal, o Pix aprova imediato? Ou é melhor passar no cartão?', delay: 2 },
        { speaker: 'Sub-Bot 2 (Experiente)', text: 'Pix aprova na mesma hora e tem o maior desconto! No cartão divide em até 12x.', delay: Math.max(3, delaySeconds) },
        { speaker: 'Sub-Bot 1 (Dúvida Pix)', text: 'Fechou, acabei de pagar pelo Pix! Aprovou instantâneo aqui!', delay: Math.max(3, delaySeconds * 1.6) }
      ],
      urgency: [
        { speaker: 'Sub-Bot 1 (Alerta)', text: 'Ainda restam vagas com os bônus VIP ou o lote já vai virar?', delay: 2 },
        { speaker: 'Sub-Bot 2 (Membro)', text: 'Vi aqui no checkout que as últimas vagas desse lote estão acabando rápido!', delay: Math.max(3, delaySeconds) },
        { speaker: 'Sub-Bot 3 (Decidido)', text: 'Corram que nas turmas anteriores acabou antes do prazo programado!', delay: Math.max(3, delaySeconds * 1.5) }
      ]
    };

    let scripts = [];
    if (customScripts && Array.isArray(customScripts) && customScripts.length > 0) {
      scripts = customScripts;
    } else {
      scripts = presets[theme] || presets.social_proof;
    }

    const campaign = models.getMeteoricCampaign();
    const formattedTimeline = scripts.map((s, i) => {
      const parsedText = models.parseSpintax(s.text || s.message || '', {
        link: `http://localhost:3000/l/vip`,
        produto: campaign?.name || 'Oferta VIP'
      });
      return {
        step: i + 1,
        speaker: s.speaker || `Sub-Bot ${i + 1}`,
        delaySeconds: s.delay || (i * delaySeconds + 2),
        text: parsedText
      };
    });

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        theme,
        targetGroupJid: targetGroupJid || 'preview_screen',
        dialogueCount: formattedTimeline.length,
        timeline: formattedTimeline
      };
    }

    // Executa em grupo real
    const armyService = require('./whatsappArmyService');
    const allArmy = armyService.getAllAccounts();
    const availableSubBots = allArmy.filter(a => a.id !== 1 && (a.status === 'CONNECTED' || a.isConnected));

    let targetJid = targetGroupJid;
    if (!targetJid || targetJid === 'all') {
      const activeGrp = models.getActiveMeteoricGroup();
      if (activeGrp) targetJid = activeGrp.group_jid;
    }

    if (targetJid && targetJid !== 'preview_only') {
      const scriptItems = formattedTimeline.map(item => ({
        speaker: 'subbot_any',
        delay: item.delaySeconds,
        text: item.text
      }));

      this.scheduleSubBotDialogue(targetJid, scriptItems, availableSubBots, {
        link: `http://localhost:3000/l/vip`,
        produto: campaign?.name || 'Oferta VIP'
      });

      models.logMeteoricActivity({
        campaign_id: campaign ? campaign.id : 1,
        group_jid: targetJid,
        event_type: 'SUBBOT_SIMULATION',
        sender_name: 'Sub-Bots (Simulador)',
        message_text: `Simulação de diálogo (${theme}) disparada com ${scriptItems.length} falas`
      });
    }

    return {
      success: true,
      dryRun: false,
      theme,
      targetGroupJid: targetJid,
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
}

module.exports = new MeteoricService();

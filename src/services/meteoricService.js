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

    // Verifica se atingiu o limite estabelecido pelo admin
    if (currentCount >= group.max_limit && !group.is_full) {
      console.log(`[Lançamento Meteórico ⚠️] Grupo #${group.group_num} atingiu a capacidade máxima (${currentCount}/${group.max_limit})! Transbordando para novo grupo...`);
      models.updateMeteoricGroup(group.id, { is_full: 1 });

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
        } catch (_) {}
      }

      // 2. Dispara o Anúncio Oficial do Administrador (Matriz)
      if (adminAnnouncement && whatsappBot.sock && whatsappBot.isConnected) {
        try {
          const parsedAnnouncement = models.parseSpintax(adminAnnouncement, {
            link: group.invite_url || `http://localhost:3000/l/vip`,
            produto: campaign.name
          });
          await whatsappBot.sendMessage(gJid, parsedAnnouncement);
          report.announcementsSent++;
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
  async setGroupMode(groupJid, mode) {
    const whatsappBot = require('../bots/whatsappBot');
    if (!whatsappBot.sock || !whatsappBot.isConnected) {
      return { success: true, mode, simulated: true };
    }
    const setting = mode === 'open' || mode === 'not_announcement' ? 'not_announcement' : 'announcement';
    await whatsappBot.sock.groupSettingUpdate(groupJid, setting);

    const group = models.getMeteoricGroupByJid(groupJid);
    if (group) {
      models.updateMeteoricGroup(group.id, { is_closed: setting === 'announcement' ? 1 : 0 });
    }
    return { success: true, mode: setting };
  }
}

module.exports = new MeteoricService();

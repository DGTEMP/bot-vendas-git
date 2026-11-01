const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');

class WhatsAppArmyService {
  constructor() {
    this.activeSockets = new Map(); // instanceId -> Baileys socket
    this.instanceQrs = new Map(); // instanceId -> { qr, qrDataUrl }
    this.campaignTimeouts = new Map(); // campaignId -> timer
    this.armyBaseFolder = path.join(__dirname, '..', '..', 'data', 'whatsapp_army');
    this.isSimulationMode = config.binance?.simulationMode || process.env.PIX_SIMULATION_MODE === 'true';
  }

  parseSpintax(text, vars = {}) {
    let result = models.parseSpintax(text);
    if (vars) {
      if (vars.name) result = result.replace(/\{nome\}|\{cliente\}|\{amigo\}/gi, vars.name);
      if (vars.product) result = result.replace(/\{produto\}/gi, vars.product);
      if (vars.link) result = result.replace(/\{link\}/gi, vars.link);
    }
    return result;
  }

  async sendMessageViaInstance(instanceId, target, text) {
    const cleanPhone = String(target).split('@')[0].replace(/\D/g, '');
    return this.sendArmyMessage(instanceId, cleanPhone, text);
  }

  // ==========================================
  // 1. GERENCIAMENTO DE INSTÂNCIAS / CHIPS
  // ==========================================
  async startInstance(instanceId) {
    const instance = models.getArmyInstanceById(instanceId);
    if (!instance) throw new Error('Instância do exército não encontrada');

    // Instância Matriz (ID 1) é gerenciada pelo whatsappBot principal
    if (instance.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      const status = whatsappBot.getConnectionStatus();
      models.updateArmyInstance(instanceId, {
        status: status.connected ? 'CONNECTED' : (status.hasQr ? 'WAITING_QR' : 'DISCONNECTED'),
        phone: status.phone || instance.phone
      });
      return {
        id: instanceId,
        status: status.connected ? 'CONNECTED' : 'WAITING_QR',
        qrDataUrl: status.qrDataUrl,
        pairingCode: status.pairingCode
      };
    }

    // Se já estiver rodando, para primeiro
    await this.stopInstance(instanceId);

    const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    try {
      models.updateArmyInstance(instanceId, { status: 'CONNECTING' });
      const { state, saveCreds } = await useMultiFileAuthState(folder);
      
      let version = [2, 3000, 1043857760];
      try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
      } catch (_) {}

      // Configuração baseada na arquitetura multi-device do GataBot-MD
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 55000
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            const prev = this.instanceQrs.get(instanceId) || {};
            this.instanceQrs.set(instanceId, { ...prev, qr, qrDataUrl });
            models.updateArmyInstance(instanceId, { status: 'WAITING_QR' });
          } catch (_) {}
        }

        if (connection === 'open') {
          this.instanceQrs.delete(instanceId);
          const rawPhone = sock.user?.id ? sock.user.id.split(':')[0] : null;
          models.updateArmyInstance(instanceId, {
            status: 'CONNECTED',
            phone: rawPhone || instance.phone
          });
          console.log(`[Exército WhatsApp 📱] Chip #${instanceId} (${instance.name}) conectado com sucesso (+ ${rawPhone || instance.phone})!`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
          console.log(`[Exército WhatsApp ⚠️] Chip #${instanceId} desconectado (código ${statusCode}).`);

          if (statusCode === 401 || statusCode === 403 || statusCode === 405) {
            console.log(`[Exército WhatsApp 🛑] Sessão inválida ou desconectada pelo usuário. Limpando credenciais do Chip #${instanceId}.`);
            models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
            this.instanceQrs.delete(instanceId);
            try {
              fs.rmSync(folder, { recursive: true, force: true });
            } catch (_) {}
          } else if (statusCode === 515 || statusCode === 408 || statusCode === 428) {
            models.updateArmyInstance(instanceId, { status: 'CONNECTING' });
            setTimeout(() => this.startInstance(instanceId).catch(() => {}), 4000);
          } else {
            models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
            setTimeout(() => this.startInstance(instanceId).catch(() => {}), 5000);
          }
        }
      });

      // Escuta mensagens: Roteia tanto para o cérebro principal do WhatsAppBot quanto para o funil
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const whatsappBot = require('../bots/whatsappBot');
        for (const msg of messages) {
          if (!msg.message) continue;
          
          if (msg.key.fromMe) {
            const rawTxt = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!rawTxt.startsWith('!') && !rawTxt.startsWith('/')) continue;
          }

          // Executa fluxo comercial / catálogo / nlp / comandos de grupos com o socket deste chip
          try {
            await whatsappBot.handleIncomingMessage(msg, sock);
          } catch (botErr) {
            console.error(`[Exército WhatsApp ⚠️] Erro no bot handler do Chip #${instanceId}:`, botErr.message);
          }

          // Registra e avança no funil se for lead privado
          if (!msg.key.fromMe && !msg.key.remoteJid.endsWith('@g.us')) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (text) {
              await this.handleIncomingLeadMessage(msg.key.remoteJid, text, instanceId);
            }
          }
        }
      });

      // Boas-vindas automáticas em grupos onde o chip secundário é membro
      sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
          if (action === 'add') {
            // Anti-Fake / Anti-Estrangeiro (Gata Nina Security)
            const gataFeatures = require('./gataFeaturesService');
            await gataFeatures.checkAntiFakeEntry(sock, id, participants);

            const isWelcomeActive = models.getSetting(`WELCOME_${id}`, 'false') === 'true';
            if (!isWelcomeActive) return;

            let groupName = 'nosso grupo';
            try {
              const meta = await sock.groupMetadata(id);
              if (meta && meta.subject) groupName = meta.subject;
            } catch (_) {}

            const customMsg = models.getSetting(`WELCOME_MSG_${id}`, 'Seja muito bem-vindo(a) ao {grupo}! Sinta-se em casa e aproveite nosso conteúdo exclusivo.');
            const welcomeText = customMsg.replace(/{grupo}/g, groupName);

            for (const participant of participants) {
              const mentionTag = `@${participant.split('@')[0]}`;
              const textWithMention = `${mentionTag} ${welcomeText}`;
              await sock.sendMessage(id, {
                text: textWithMention,
                mentions: [participant]
              });
            }
          }
        } catch (err) {
          console.error(`[Exército WhatsApp ⚠️] Erro em group-participants.update no Chip #${instanceId}:`, err.message);
        }
      });

      this.activeSockets.set(instanceId, sock);
      return { id: instanceId, status: 'CONNECTING' };
    } catch (err) {
      models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
      throw err;
    }
  }

  async stopInstance(instanceId) {
    const sock = this.activeSockets.get(instanceId);
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (_) {}
      this.activeSockets.delete(instanceId);
    }
    this.instanceQrs.delete(instanceId);
    models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
  }

  async resetInstanceSession(instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (inst && inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      return whatsappBot.resetSession();
    }

    await this.stopInstance(instanceId);
    const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
    if (fs.existsSync(folder)) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch (_) {}
    }
    this.instanceQrs.delete(instanceId);
    models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
    // Inicia imediatamente um socket limpo pronto para pareamento ou leitura de QR
    await this.startInstance(instanceId);
    return { success: true };
  }

  async requestPairingCode(instanceId, phone) {
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error('Informe o telefone com DDI e DDD (ex: 5511999998888)');
    }

    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) throw new Error('Instância não encontrada.');

    // Se for Chip Matriz (ID 1)
    if (inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      return whatsappBot.requestPairingCode(cleanPhone);
    }

    models.updateArmyInstance(instanceId, { phone: cleanPhone });

    let sock = this.activeSockets.get(instanceId);
    if (!sock) {
      await this.startInstance(instanceId);
      sock = this.activeSockets.get(instanceId);
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!sock) {
      throw new Error('Não foi possível inicializar a conexão WhatsApp.');
    }

    if (sock.authState?.creds?.registered) {
      throw new Error('Este chip já está registrado e pareado.');
    }

    try {
      await new Promise(r => setTimeout(r, 1200));
      const code = await sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
      const prev = this.instanceQrs.get(instanceId) || {};
      this.instanceQrs.set(instanceId, { ...prev, pairingCode: formattedCode });
      return { success: true, pairingCode: formattedCode };
    } catch (err) {
      if (process.env.NODE_ENV === 'test' || !sock) {
        const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const simCode = `${p1}-${p2}`;
        const prev = this.instanceQrs.get(instanceId) || {};
        this.instanceQrs.set(instanceId, { ...prev, pairingCode: simCode });
        return { success: true, pairingCode: simCode, simulated: true };
      }
      throw new Error('Falha ao gerar código de pareamento: ' + err.message);
    }
  }

  getInstanceQr(instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (inst && inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      const st = whatsappBot.getConnectionStatus();
      return {
        connected: st.connected,
        hasQr: st.hasQr,
        qrDataUrl: st.qrDataUrl,
        pairingCode: st.pairingCode || null,
        phone: st.phone || null,
        status: st.connected ? 'CONNECTED' : (st.hasQr ? 'WAITING_QR' : 'DISCONNECTED')
      };
    }
    const data = this.instanceQrs.get(instanceId);
    return {
      connected: inst ? inst.status === 'CONNECTED' : false,
      hasQr: !!data?.qrDataUrl,
      qrDataUrl: data?.qrDataUrl || null,
      pairingCode: data?.pairingCode || null,
      phone: inst?.phone || null,
      status: inst ? inst.status : 'DISCONNECTED'
    };
  }

  // ==========================================
  // 2. DISPARO DE MENSAGENS INDIVIDUAIS
  // ==========================================
  async sendArmyMessage(instanceId, targetPhone, text) {
    const cleanPhone = String(targetPhone).replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const instance = models.getArmyInstanceById(instanceId);

    // Se a instância for a Matriz Principal
    if (instance && instance.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot.sock && whatsappBot.isConnected) {
        try {
          await whatsappBot.sock.presenceSubscribe(jid);
          await whatsappBot.sock.sendPresenceUpdate('composing', jid);
          await new Promise(r => setTimeout(r, 1200));
          await whatsappBot.sendMessage(jid, text);
          models.incrementInstanceSentCount(instanceId);
          return true;
        } catch (err) {
          console.error(`[Exército WhatsApp ❌ Falha Matriz #${instanceId}]:`, err.message);
        }
      }
    }

    // Se for chip secundário do exército
    const sock = this.activeSockets.get(instanceId);
    if (sock) {
      try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 1200));
        await sock.sendMessage(jid, { text });
        models.incrementInstanceSentCount(instanceId);
        return true;
      } catch (err) {
        console.error(`[Exército WhatsApp ❌ Falha Chip #${instanceId}]:`, err.message);
      }
    }

    // Modo simulação ou ambiente de testes
    if (this.isSimulationMode || process.env.NODE_ENV === 'test') {
      console.log(`[Exército WhatsApp 🟢 SIMULAÇÃO CHIP #${instanceId}] Mensagem para ${cleanPhone}:\n${text.slice(0, 70)}...`);
      models.incrementInstanceSentCount(instanceId);
      return true;
    }

    return false;
  }

  // ==========================================
  // 3. MOTOR DE DISPARO DE CAMPANHAS (ANTI-BAN)
  // ==========================================
  async startCampaign(campaignId) {
    const campaign = models.getAffiliateCampaignById(campaignId);
    if (!campaign) throw new Error('Campanha não encontrada');

    // Valida se há leads pendentes
    const nextLead = models.getNextPendingLead(campaignId);
    if (!nextLead) {
      models.updateAffiliateCampaign(campaignId, { status: 'COMPLETED', completed_at: new Date().toISOString() });
      return { success: true, message: 'Campanha já foi finalizada. Todos os leads foram processados.' };
    }

    models.updateAffiliateCampaign(campaignId, { status: 'RUNNING' });
    console.log(`[Exército WhatsApp 🚀] Campanha #${campaignId} "${campaign.name}" iniciada!`);

    // Inicia ciclo assíncrono de disparos
    this.triggerNextCampaignLead(campaignId);
    return { success: true, status: 'RUNNING' };
  }

  pauseCampaign(campaignId) {
    if (this.campaignTimeouts.has(campaignId)) {
      clearTimeout(this.campaignTimeouts.get(campaignId));
      this.campaignTimeouts.delete(campaignId);
    }
    models.updateAffiliateCampaign(campaignId, { status: 'PAUSED' });
    console.log(`[Exército WhatsApp ⏸️] Campanha #${campaignId} pausada pelo operador.`);
    return { success: true, status: 'PAUSED' };
  }

  async triggerNextCampaignLead(campaignId) {
    if (this.campaignTimeouts.has(campaignId)) {
      clearTimeout(this.campaignTimeouts.get(campaignId));
      this.campaignTimeouts.delete(campaignId);
    }

    const campaign = models.getAffiliateCampaignById(campaignId);
    if (!campaign || campaign.status !== 'RUNNING') return;

    const lead = models.getNextPendingLead(campaignId);
    if (!lead) {
      models.updateAffiliateCampaign(campaignId, {
        status: 'COMPLETED',
        completed_at: new Date().toISOString()
      });
      console.log(`[Exército WhatsApp 🏁] Campanha #${campaignId} "${campaign.name}" concluída com sucesso!`);
      return;
    }

    // Busca chips disponíveis do exército
    let targetIds = null;
    if (campaign.target_instances) {
      try {
        targetIds = JSON.parse(campaign.target_instances);
      } catch (_) {}
    }

    let availableInstances = models.getAvailableArmyInstances(targetIds);

    // Se não houver chips disponíveis e não for simulação, pausa e avisa
    if (availableInstances.length === 0) {
      if (this.isSimulationMode || process.env.NODE_ENV === 'test') {
        // Em testes/simulação, usa o chip 1
        availableInstances = [models.getArmyInstanceById(1) || { id: 1, name: 'Chip Teste', is_main: 1 }];
      } else {
        console.warn(`[Exército WhatsApp ⚠️] Campanha #${campaignId} pausada: nenhum chip do exército está conectado ou com cota diária disponível.`);
        models.updateAffiliateCampaign(campaignId, { status: 'PAUSED' });
        return;
      }
    }

    // Seleciona o chip da vez (Round-Robin com base em quem enviou menos hoje)
    const selectedInstance = availableInstances[0];

    // Formata a mensagem com Spintax e tags dinâmicas
    const formattedMessage = models.formatCampaignMessage(campaign.message_template, lead, campaign);

    try {
      const sent = await this.sendArmyMessage(selectedInstance.id, lead.phone, formattedMessage);
      if (sent) {
        models.updateCampaignLead(lead.id, {
          status: 'SENT',
          sent_message: formattedMessage,
          sender_instance_id: selectedInstance.id,
          sent_at: new Date().toISOString()
        });

        // Inscreve o lead no Funil Conversacional de Aquecimento em Tempo Real
        try {
          models.enrollLeadInFunnel({
            phone: lead.phone,
            name: lead.name,
            campaign_id: campaign.id,
            affiliate_link_id: campaign.affiliate_link_id,
            product_name: campaign.product_name,
            affiliate_url: campaign.affiliate_url,
            assigned_instance_id: selectedInstance.id
          });

          models.logFunnelInteraction({
            lead_phone: lead.phone,
            instance_id: selectedInstance.id,
            direction: 'OUT',
            stage: 'STAGE_1_DESCOBERTA',
            message_text: formattedMessage
          });
        } catch (_) {}

        console.log(`[Exército WhatsApp ✅] Lead ${lead.phone} (${lead.name || 'Sem nome'}) enviado via ${selectedInstance.name} e inscrito no Funil de Aquecimento`);
      } else {
        models.updateCampaignLead(lead.id, {
          status: 'FAILED',
          error_message: 'Instância desconectada ou falha no envio'
        });
      }
    } catch (err) {
      models.updateCampaignLead(lead.id, {
        status: 'FAILED',
        error_message: err.message
      });
    }

    // Calcula intervalo com jitter anti-ban
    const minSec = campaign.delay_min_seconds || 20;
    const maxSec = campaign.delay_max_seconds || 45;
    let delayMs = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;

    // Em testes ou simulação com intervalo rápido para agilidade
    if (process.env.NODE_ENV === 'test' || process.env.FAST_TESTS === 'true') {
      delayMs = 50;
    }

    const timer = setTimeout(() => {
      this.triggerNextCampaignLead(campaignId);
    }, delayMs);

    this.campaignTimeouts.set(campaignId, timer);
  }

  // ==========================================
  // 4. MOTOR CONVERSACIONAL DO FUNIL DE AQUECIMENTO
  // ==========================================
  async handleIncomingLeadMessage(fromJid, text, instanceId = 1) {
    const rawPhone = fromJid.replace(/[^0-9]/g, '');
    const lower = text.trim().toLowerCase();

    // 1. Registra interação de entrada do lead
    models.logFunnelInteraction({
      lead_phone: rawPhone,
      instance_id: instanceId,
      direction: 'IN',
      message_text: text
    });

    // 2. Localiza estado do lead no funil de aquecimento
    let leadConv = models.getLeadFunnelConversationByPhone(rawPhone);

    // Se o lead ainda não foi cadastrado no funil, verifica campanhas ou links de afiliados
    if (!leadConv) {
      const db = require('../db/database');
      const leadRecord = db.prepare(`
        SELECT cl.*, ac.product_name, ac.affiliate_url, ac.affiliate_link_id
        FROM campaign_leads cl
        JOIN affiliate_campaigns ac ON cl.campaign_id = ac.id
        WHERE cl.phone = ? OR cl.phone = ?
        ORDER BY cl.id DESC LIMIT 1
      `).get(rawPhone, rawPhone.slice(-8));

      if (leadRecord) {
        leadConv = models.enrollLeadInFunnel({
          phone: rawPhone,
          name: leadRecord.name,
          campaign_id: leadRecord.campaign_id,
          affiliate_link_id: leadRecord.affiliate_link_id,
          product_name: leadRecord.product_name,
          affiliate_url: leadRecord.affiliate_url,
          assigned_instance_id: instanceId
        });
      }
    }

    if (!leadConv) {
      // Verifica se é uma mensagem com palavras-chave comerciais gerais
      const intentRegex = /(quero|link|preço|preco|como funciona|comprar|tenho interesse|me manda|valor|qual o valor|desconto|chave|acesso)/i;
      if (!intentRegex.test(lower)) return false;

      // Pega o primeiro link de afiliado disponível
      const links = models.getAffiliateLinks();
      const defaultLink = links[0] || {
        title: 'Produto Especial',
        affiliate_url: 'https://paybot.app',
        pitch_copy: 'Conheça nossa solução completa: {link}'
      };

      leadConv = models.enrollLeadInFunnel({
        phone: rawPhone,
        product_name: defaultLink.title,
        affiliate_url: defaultLink.affiliate_url,
        affiliate_link_id: defaultLink.id,
        assigned_instance_id: instanceId
      });
    }

    // 3. Atualiza status de campanha se existir
    const db = require('../db/database');
    db.prepare("UPDATE campaign_leads SET status = 'REPLIED' WHERE phone = ? OR phone = ?").run(rawPhone, rawPhone.slice(-8));

    // 4. Análise NLU / NLP em Português Brasileiro
    let nlp = null;
    try {
      const nlpService = require('./nlpService');
      nlp = await nlpService.processMessage({
        text,
        customerName: leadConv?.name,
        platform: 'whatsapp'
      });
    } catch (_) {}

    // Reconhece confirmação de compra / conversão
    const isConfirmedPurchase = nlp?.intent === 'CONFIRM_PURCHASE' || /(já comprei|ja comprei|paguei|fiz a compra|comprei aqui|acabei de comprar|ta pago|ja fiz o pix)/i.test(lower);
    if (isConfirmedPurchase) {
      models.markLeadConverted(rawPhone);
      const thankYouMsg = (nlp && nlp.replyText) ? nlp.replyText : `🎉 *PARABÉNS PELA SUA DECISÃO!* 🚀\n\nFicamos muito felizes em ter você conosco! Seu acesso está liberado. Se precisar de qualquer suporte, basta chamar por aqui!`;
      await this.sendArmyMessage(instanceId, rawPhone, thankYouMsg);
      models.logFunnelInteraction({
        lead_phone: rawPhone,
        instance_id: instanceId,
        direction: 'OUT',
        stage: 'CONVERTED',
        message_text: thankYouMsg
      });
      console.log(`[Funil de Vendas 🏆 CONVERSÃO] Lead ${rawPhone} converteu com sucesso!`);
      return true;
    }

    // 5. Intenção direta de compra / pedido de link (Fast-forward para Oferta)
    const directOfferRegex = /(quero o link|manda o link|me passa o link|qual o link|onde compro|quero comprar|passa o link|como faço pra comprar)/i;
    let nextStageKey = null;

    if (nlp?.intent === 'BUY_INTENT' || nlp?.intent === 'PAYMENT_PIX' || nlp?.intent === 'PAYMENT_CRYPTO' || directOfferRegex.test(lower)) {
      nextStageKey = 'STAGE_4_OFERTA';
    } else if (nlp?.intent === 'DISCOUNT_QUERY') {
      nextStageKey = 'STAGE_5_FECHAMENTO';
    } else {
      // Sequência natural de aquecimento conversacional
      const current = leadConv.current_stage || 'STAGE_1_DESCOBERTA';
      if (current === 'STAGE_1_DESCOBERTA') nextStageKey = 'STAGE_2_INTERESSE';
      else if (current === 'STAGE_2_INTERESSE') nextStageKey = 'STAGE_3_SOLUCAO';
      else if (current === 'STAGE_3_SOLUCAO') nextStageKey = 'STAGE_4_OFERTA';
      else if (current === 'STAGE_4_OFERTA') nextStageKey = 'STAGE_5_FECHAMENTO';
      else nextStageKey = 'STAGE_5_FECHAMENTO';
    }

    // Busca o template da etapa
    const stageObj = models.getFunnelStageByKey(nextStageKey);
    const template = stageObj ? stageObj.message_template : '{Olá|Oi} {nome}! {produto} com desconto aqui: {link}';

    // Formata a mensagem persuasiva da etapa
    const replyText = models.formatCampaignMessage(template, leadConv, {
      product_name: leadConv.product_name,
      affiliate_url: leadConv.affiliate_url
    });

    // Avança o lead para a nova etapa no banco de dados
    models.advanceLeadFunnelStage(rawPhone, nextStageKey);

    // Dispara a mensagem da etapa
    await this.sendArmyMessage(instanceId, rawPhone, replyText);

    // Registra a interação de saída
    models.logFunnelInteraction({
      lead_phone: rawPhone,
      instance_id: instanceId,
      direction: 'OUT',
      stage: nextStageKey,
      message_text: replyText
    });

    console.log(`[Funil de Aquecimento 📈] Lead ${rawPhone} avançou para ${nextStageKey} via Chip #${instanceId}`);
    return true;
  }

  async initAllInstances() {
    try {
      const instances = models.getArmyInstances();
      for (const inst of instances) {
        if (inst.active && !inst.is_main) {
          const folder = path.join(this.armyBaseFolder, `instance_${inst.id}`);
          const credsFile = path.join(folder, 'creds.json');
          if (fs.existsSync(credsFile)) {
            console.log(`[Exército WhatsApp 📱] Restaurando conexão persistente do Chip #${inst.id} (${inst.name})...`);
            this.startInstance(inst.id).catch(err => {
              console.error(`⚠️ [Exército WhatsApp] Erro ao restaurar Chip #${inst.id}:`, err.message);
            });
          }
        }
      }
    } catch (_) {}
  }

  async stopAllInstances() {
    for (const [id, sock] of this.activeSockets.entries()) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (_) {}
    }
    this.activeSockets.clear();
    this.instanceQrs.clear();
  }

  async initArmyCluster() {
    return this.initAllInstances();
  }
}

module.exports = new WhatsAppArmyService();
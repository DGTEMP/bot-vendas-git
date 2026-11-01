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
    this.startingInstances = new Set(); // instanceId sendo inicializado para evitar race conditions
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
  // Retorna uma assinatura de navegador e dispositivo altamente realista e rotativa (Anti-Ban)
  getRealisticBrowserProfile(instanceId = 1) {
    const profiles = [
      Browsers.windows('Chrome'),             // [ 'Windows', 'Chrome', '10.0.22631' ]
      ['Windows', 'Chrome', '124.0.6367.207'], // Google Chrome no Windows 11
      ['macOS', 'Safari', '17.4.1'],          // Apple Safari no macOS
      ['Windows', 'Edge', '124.0.2478.80'],   // Microsoft Edge no Windows 11
      ['macOS', 'Chrome', '124.0.6367.201'],  // Google Chrome no macOS
      Browsers.ubuntu('Chrome'),              // [ 'Ubuntu', 'Chrome', '22.04.4' ]
      ['Windows', 'Firefox', '125.0.3']       // Mozilla Firefox no Windows
    ];
    return profiles[(Math.max(1, Number(instanceId) || 1) - 1) % profiles.length];
  }

  async startInstance(instanceId) {
    const instance = models.getArmyInstanceById(instanceId);
    if (!instance) {
      this.startingInstances.delete(instanceId);
      this.activeSockets.delete(instanceId);
      this.instanceQrs.delete(instanceId);
      return null;
    }

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

    // Evita loop de inicializações simultâneas (race conditions)
    if (this.startingInstances.has(instanceId)) {
      return { id: instanceId, status: 'CONNECTING' };
    }
    this.startingInstances.add(instanceId);

    // Se já estiver rodando, encerra com segurança antes de reiniciar
    await this.stopInstance(instanceId);

    const folder = path.join(this.armyBaseFolder, `instance_${instanceId}`);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    try {
      models.updateArmyInstance(instanceId, { status: 'CONNECTING' });
      const { state, saveCreds } = await useMultiFileAuthState(folder);
      if (state.creds?.me && !state.creds?.registered) {
        state.creds.registered = true;
        try { await saveCreds(); } catch (_) {}
      }
      
      let version = [2, 3000, 1043857760];
      try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
      } catch (_) {}

      // Configuração baseada na arquitetura multi-device do GataBot-MD com perfil realista
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: this.getRealisticBrowserProfile(instanceId),
        getMessage: async (key) => ({ conversation: 'PayBot' }),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 55000
      });
      sock.instanceId = instanceId;

      sock.ev.on('creds.update', async () => {
        try {
          if (sock.user?.id && state.creds) {
            state.creds.registered = true;
          }
          await saveCreds();
        } catch (_) {}
      });

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
          try {
            if (state.creds) {
              state.creds.registered = true;
            }
            await saveCreds();
          } catch (_) {}
          console.log(`[Exército WhatsApp 📱] Chip #${instanceId} (${instance.name}) conectado com sucesso (+ ${rawPhone || instance.phone})!`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          console.log(`[Exército WhatsApp ⚠️] Chip #${instanceId} desconectado (código ${statusCode}).`);

          this.activeSockets.delete(instanceId);

          if (isLoggedOut) {
            console.log(`[Exército WhatsApp 🛑] Sessão desconectada no Chip #${instanceId}. Preservando credenciais.`);
            try { models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' }); } catch (_) {}
            this.instanceQrs.delete(instanceId);
            // IMPORTANTE: Se o WhatsApp deslogou (401), NÃO tenta reconectar em loop infinito.
            return;
          }

          // Verifica se a instância ainda existe no banco e está ativa antes de agendar reconexão
          const currentInst = models.getArmyInstanceById(instanceId);
          if (!currentInst || !currentInst.active) {
            try { models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' }); } catch (_) {}
            this.instanceQrs.delete(instanceId);
            return;
          }

          try { models.updateArmyInstance(instanceId, { status: 'CONNECTING' }); } catch (_) {}
          setTimeout(() => {
            const checkInst = models.getArmyInstanceById(instanceId);
            if (checkInst && checkInst.active) {
              this.startInstance(instanceId).catch(() => {});
            }
          }, 5000);
        }
      });

      // Escuta mensagens: Roteia para o cérebro principal do WhatsAppBot com o socket deste chip
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const whatsappBot = require('../bots/whatsappBot');
        for (const msg of messages) {
          if (!msg.message) continue;
          
          if (msg.key.fromMe) {
            const rawTxt = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (!rawTxt.startsWith('!') && !rawTxt.startsWith('/')) continue;
          }

          // Executa fluxo comercial / catálogo / nlp / comandos com o socket deste chip (evitando duplicação)
          try {
            await whatsappBot.handleIncomingMessage(msg, sock);
          } catch (botErr) {
            console.error(`[Exército WhatsApp ⚠️] Erro no bot handler do Chip #${instanceId}:`, botErr.message);
          }
        }
      });

      // Boas-vindas automáticas em grupos onde o chip secundário é membro
      sock.ev.on('group-participants.update', async (evt) => {
        try {
          const whatsappBot = require('../bots/whatsappBot');
          await whatsappBot.handleGroupParticipantsUpdate(evt, sock);
        } catch (err) {
          console.error(`[Exército WhatsApp ⚠️] Erro em group-participants.update no Chip #${instanceId}:`, err.message);
        }
      });

      this.activeSockets.set(instanceId, sock);
      this.startingInstances.delete(instanceId);
      return { id: instanceId, status: 'CONNECTING' };
    } catch (err) {
      this.startingInstances.delete(instanceId);
      models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
      throw err;
    }
  }

  async stopInstance(instanceId) {
    this.startingInstances.delete(instanceId);
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
    let cleanPhone = String(phone).replace(/[^0-9]/g, '');
    // Se digitou número BR com 10 ou 11 dígitos sem DDI (ex: 11999998888), adiciona 55 automaticamente
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = '55' + cleanPhone;
    }
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

    if (process.env.NODE_ENV === 'test') {
      const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const simCode = `${p1}-${p2}`;
      const prev = this.instanceQrs.get(instanceId) || {};
      this.instanceQrs.set(instanceId, { ...prev, pairingCode: simCode });
      return { success: true, pairingCode: simCode, simulated: true };
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
        id: inst.id,
        name: inst.name,
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
      id: inst ? inst.id : instanceId,
      name: inst ? inst.name : `Chip #${instanceId}`,
      connected: inst ? inst.status === 'CONNECTED' : false,
      hasQr: !!data?.qrDataUrl,
      qrDataUrl: data?.qrDataUrl || null,
      pairingCode: data?.pairingCode || null,
      phone: inst?.phone || null,
      status: inst ? inst.status : 'DISCONNECTED'
    };
  }

  getAllAccounts() {
    const instances = models.getArmyInstances();
    const whatsappBot = require('../bots/whatsappBot');
    const mainStatus = whatsappBot.getConnectionStatus();

    return instances.map(inst => {
      if (inst.is_main) {
        return {
          id: inst.id,
          name: inst.name || 'WhatsApp Matriz Principal',
          phone: mainStatus.phone || inst.phone,
          is_main: true,
          status: mainStatus.connected ? 'CONNECTED' : (mainStatus.hasQr ? 'WAITING_QR' : 'DISCONNECTED'),
          connected: !!mainStatus.connected,
          hasQr: !!mainStatus.hasQr,
          qrDataUrl: mainStatus.qrDataUrl,
          pairingCode: mainStatus.pairingCode,
          daily_limit: inst.daily_limit,
          messages_sent_today: inst.messages_sent_today,
          active: inst.active
        };
      }
      const qrData = this.instanceQrs.get(inst.id);
      const isConnected = inst.status === 'CONNECTED';
      return {
        id: inst.id,
        name: inst.name,
        phone: inst.phone,
        is_main: false,
        status: inst.status,
        connected: isConnected,
        hasQr: !!qrData?.qrDataUrl,
        qrDataUrl: qrData?.qrDataUrl || null,
        pairingCode: qrData?.pairingCode || null,
        daily_limit: inst.daily_limit,
        messages_sent_today: inst.messages_sent_today,
        active: inst.active
      };
    });
  }

  async createAndConnectInstance({ name, phone = null, daily_limit = 50 }) {
    let cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    if (cleanPhone && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
      cleanPhone = '55' + cleanPhone;
    }
    const inst = models.createArmyInstance({
      name: name || `WhatsApp Secundário #${Date.now().toString().slice(-4)}`,
      phone: cleanPhone,
      daily_limit: daily_limit || 50,
      warmup_mode: 0
    });
    // Inicia Baileys imediatamente para preparar socket e QR code
    this.startInstance(inst.id).catch(err => {
      console.error(`[WhatsApp Multi-Contas ⚠️] Erro ao iniciar instância #${inst.id}:`, err.message);
    });
    return inst;
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
          if (typeof whatsappBot.sock.presenceSubscribe === 'function') {
            await whatsappBot.sock.presenceSubscribe(jid);
            await whatsappBot.sock.sendPresenceUpdate('composing', jid);
          }
          if (process.env.NODE_ENV !== 'test') {
            await new Promise(r => setTimeout(r, 1200));
          }
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
        if (typeof sock.presenceSubscribe === 'function') {
          await sock.presenceSubscribe(jid);
          await sock.sendPresenceUpdate('composing', jid);
        }
        if (process.env.NODE_ENV !== 'test') {
          await new Promise(r => setTimeout(r, 1200));
        }
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
    if (!fromJid || fromJid.endsWith('@g.us')) return false;
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

  // ==========================================
  // 5. TRANSMISSÃO EM MASSA / DIVULGAÇÃO DO DONO E BOT PRINCIPAL
  // ==========================================
  async broadcastViaAllSubBots({ message, targets = [], targetType = 'leads', specificInstanceId = null, vars = {} }) {
    if (!message || !message.trim()) {
      throw new Error('A mensagem de divulgação não pode estar vazia.');
    }

    // 1. Instâncias disponíveis
    const instances = models.getArmyInstances();
    let availableInstances = [];

    if (specificInstanceId) {
      const single = instances.find(i => i.id === Number(specificInstanceId) && i.active);
      if (single) availableInstances.push(single);
    } else {
      // Prioriza sub-bots secundários ativos
      availableInstances = instances.filter(i => !i.is_main && i.active && (this.activeSockets.has(i.id) || this.isSimulationMode || process.env.NODE_ENV === 'test'));
      // Se não houver sub-bots secundários conectados, usa todos os ativos incluindo a Matriz
      if (availableInstances.length === 0) {
        availableInstances = instances.filter(i => i.active);
      }
    }

    if (availableInstances.length === 0) {
      throw new Error('Nenhum bot ou sub-bot ativo disponível no momento para disparar a divulgação.');
    }

    // 2. Destinatários
    let recipients = [];
    if (Array.isArray(targets) && targets.length > 0) {
      recipients = targets.map(t => String(t).trim()).filter(Boolean);
    } else if (targetType === 'groups') {
      const groupJids = new Set();
      for (const inst of availableInstances) {
        const sock = this.activeSockets.get(inst.id) || (inst.is_main ? require('../bots/whatsappBot').sock : null);
        if (sock && typeof sock.groupFetchAllParticipating === 'function') {
          try {
            const groups = await sock.groupFetchAllParticipating();
            Object.keys(groups || {}).forEach(jid => groupJids.add(jid));
          } catch (_) {}
        }
      }
      recipients = Array.from(groupJids);
    } else {
      // Leads cadastrados no sistema (campanhas e funis)
      try {
        const db = require('../db/database');
        const rows = db.prepare(`
          SELECT DISTINCT phone FROM (
            SELECT phone FROM campaign_leads
            UNION
            SELECT phone FROM lead_funnel_conversations
          ) WHERE phone IS NOT NULL AND phone != ''
        `).all();
        recipients = rows.map(r => String(r.phone).replace(/\D/g, '')).filter(p => p.length >= 8);
      } catch (_) {
        recipients = [];
      }
    }

    if (recipients.length === 0) {
      return {
        success: true,
        dispatched: 0,
        failed: 0,
        totalRecipients: 0,
        subBotsCount: availableInstances.length,
        message: 'Nenhum contato encontrado para envio. Cadastre leads ou envie uma lista manual.'
      };
    }

    // 3. Disparo balanceado (Round-Robin) com Spintax e Anti-ban
    const results = [];
    let dispatched = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const botInst = availableInstances[i % availableInstances.length];
      const personalizedText = this.parseSpintax(message, { ...vars, target: recipient, name: 'Cliente' });

      try {
        if (recipient.endsWith('@g.us')) {
          const sock = this.activeSockets.get(botInst.id) || (require('../bots/whatsappBot').sock);
          if (sock) {
            await sock.sendMessage(recipient, { text: personalizedText });
          }
        } else {
          await this.sendArmyMessage(botInst.id, recipient, personalizedText);
        }
        dispatched++;
        results.push({ recipient, instanceId: botInst.id, status: 'SENT' });
      } catch (err) {
        failed++;
        results.push({ recipient, instanceId: botInst.id, status: 'FAILED', error: err.message });
      }

      // Intervalo seguro anti-ban entre envios
      if (i < recipients.length - 1 && !this.isSimulationMode && process.env.NODE_ENV !== 'test') {
        const delay = Math.floor(Math.random() * 2000) + 2500; // 2.5s a 4.5s
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return {
      success: true,
      dispatched,
      failed,
      totalRecipients: recipients.length,
      subBotsCount: availableInstances.length,
      details: results
    };
  }

  getSubBotsStatusSummary() {
    const instances = models.getArmyInstances();
    const subBots = instances.filter(i => !i.is_main);
    const mainBot = instances.find(i => i.is_main) || { name: 'Matriz Principal', id: 1 };
    const onlineSubBots = subBots.filter(s => this.activeSockets.has(s.id) || s.status === 'CONNECTED');

    let totalSentToday = 0;
    let totalDailyCapacity = 0;
    subBots.forEach(s => {
      totalSentToday += s.messages_sent_today || 0;
      totalDailyCapacity += s.daily_limit || 50;
    });

    return {
      totalSubBots: subBots.length,
      onlineSubBots: onlineSubBots.length,
      totalSentToday,
      totalDailyCapacity,
      mainBot: {
        id: mainBot.id,
        name: mainBot.name,
        phone: mainBot.phone,
        status: mainBot.status
      },
      subBots: subBots.map(s => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        status: this.activeSockets.has(s.id) ? 'CONNECTED' : s.status,
        messages_sent_today: s.messages_sent_today || 0,
        daily_limit: s.daily_limit || 50,
        active: s.active
      }))
    };
  }

  async initAllInstances() {
    try {
      // 1. Limpa pastas órfãs de instâncias que não existem mais no banco de dados
      if (fs.existsSync(this.armyBaseFolder)) {
        const existingIds = new Set(models.getArmyInstances().map(i => String(i.id)));
        const files = fs.readdirSync(this.armyBaseFolder);
        for (const file of files) {
          if (file.startsWith('instance_')) {
            const instId = file.replace('instance_', '');
            if (instId !== '1' && !existingIds.has(instId)) {
              try {
                fs.rmSync(path.join(this.armyBaseFolder, file), { recursive: true, force: true });
              } catch (_) {}
            }
          }
        }
      }

      // 2. Restaura conexões salvas de chips ativos
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
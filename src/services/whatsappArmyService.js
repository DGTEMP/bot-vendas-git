const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
        status: status.connected ? 'CONNECTED' : (status.hasQr ? 'WAITING_QR' : 'DISCONNECTED')
      });
      return {
        id: instanceId,
        status: status.connected ? 'CONNECTED' : 'WAITING_QR',
        qrDataUrl: status.qrDataUrl
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
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: [`Exército Chip #${instanceId}`, 'Chrome', '1.0.0']
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            this.instanceQrs.set(instanceId, { qr, qrDataUrl });
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
          console.log(`[Exército WhatsApp 📱] Chip #${instanceId} (${instance.name}) conectado com sucesso!`);
        }

        if (connection === 'close') {
          this.instanceQrs.delete(instanceId);
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          models.updateArmyInstance(instanceId, { status: 'DISCONNECTED' });
          console.log(`[Exército WhatsApp ⚠️] Chip #${instanceId} desconectado (código ${statusCode}).`);

          if (shouldReconnect) {
            setTimeout(() => this.startInstance(instanceId).catch(() => {}), 5000);
          }
        }
      });

      // Escuta respostas para auto-responder
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          if (msg.key.remoteJid.endsWith('@g.us')) continue;
          const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
          if (text) {
            await this.handleIncomingLeadMessage(msg.key.remoteJid, text, instanceId);
          }
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

  getInstanceQr(instanceId) {
    const inst = models.getArmyInstanceById(instanceId);
    if (inst && inst.is_main) {
      const whatsappBot = require('../bots/whatsappBot');
      return whatsappBot.getConnectionStatus();
    }
    const data = this.instanceQrs.get(instanceId);
    return {
      connected: inst ? inst.status === 'CONNECTED' : false,
      hasQr: !!data?.qrDataUrl,
      qrDataUrl: data?.qrDataUrl || null
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
        console.log(`[Exército WhatsApp ✅] Lead ${lead.phone} (${lead.name || 'Sem nome'}) enviado via ${selectedInstance.name}`);
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
  // 4. AUTO-RESPOSTA INTELIGENTE DE CONVERSÃO
  // ==========================================
  async handleIncomingLeadMessage(fromJid, text, instanceId = 1) {
    const rawPhone = fromJid.replace(/[^0-9]/g, '');
    const lower = text.toLowerCase();

    // Palavras-chave de interesse comercial
    const intentRegex = /(quero|link|preço|preco|como funciona|comprar|tenho interesse|me manda|valor|qual o valor|desconto|chave|acesso)/i;
    if (!intentRegex.test(lower)) return false;

    // Verifica se o lead pertence a uma campanha recente
    const recentLead = models.getCampaignLeads(null, null, 1000);
    // Busca na tabela de leads
    const db = require('../db/database');
    const leadRecord = db.prepare(`
      SELECT cl.*, ac.product_name, ac.affiliate_url, al.pitch_copy
      FROM campaign_leads cl
      JOIN affiliate_campaigns ac ON cl.campaign_id = ac.id
      LEFT JOIN affiliate_links al ON ac.affiliate_link_id = al.id
      WHERE cl.phone = ? OR cl.phone = ?
      ORDER BY cl.id DESC LIMIT 1
    `).get(rawPhone, rawPhone.slice(-8));

    if (leadRecord) {
      models.updateCampaignLead(leadRecord.id, { status: 'REPLIED' });

      const replyText = `🎉 *QUE ÓTIMO SEU INTERESSE!* 🚀\n\n` +
        `Você perguntou sobre *${leadRecord.product_name}*!\n\n` +
        `Para garantir sua vaga com condição promocional exclusiva, basta acessar o link oficial abaixo:\n` +
        `🔗 ${leadRecord.affiliate_url}\n\n` +
        `Se tiver qualquer dúvida na ativação, estou por aqui para te ajudar!`;

      await this.sendArmyMessage(instanceId, rawPhone, replyText);
      console.log(`[Exército WhatsApp 💬 Auto-Resposta] Lead ${rawPhone} atendido com link da campanha "${leadRecord.product_name}"`);
      return true;
    }

    return false;
  }
}

module.exports = new WhatsAppArmyService();
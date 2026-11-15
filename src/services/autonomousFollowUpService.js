/**
 * =========================================================================
 * 🚀 AUTONOMOUS FOLLOW-UP SERVICE - ANTI-VÁCUO & RECUPERAÇÃO DE PIX
 * =========================================================================
 * Monitora proativamente leads que geraram Pix ou consultaram preços e pararam
 * de responder (ghosting). Em vez de spam robótico, atua como o Dono:
 *
 * - Etapa 1 (10-20 min pós-Pix): Checagem prestativa ("deu algum erro no app do banco?")
 * - Etapa 2 (4 horas pós-Pix): Gatilho de escassez e reserva de vaga
 * - Etapa 3 (24 horas pós-Pix): Última oportunidade / bônus especial de setup
 * =========================================================================
 */

const models = require('../db/models');
const { getBrasiliaGreeting } = require('../utils/dateTime');

class AutonomousFollowUpService {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  start(whatsappBotInstance) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Executa a cada 2 minutos em background
    this.interval = setInterval(() => {
      this.runRecoveryCycle(whatsappBotInstance).catch(err => {
        console.warn('[AutonomousFollowUp ⚠️ Erro no ciclo]:', err.message);
      });
    }, 120000);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  async runRecoveryCycle(whatsappBotInstance) {
    const isEnabled = models.getSetting('AUTONOMOUS_FOLLOWUP_ENABLED', 'true') === 'true';
    if (!isEnabled) return;

    const sock = whatsappBotInstance?.sock;
    if (!sock || !whatsappBotInstance.isConnected) return;

    // Não envia de madrugada (entre 23h e 07h30) para manter boa experiência e reputação do chip
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
    if (process.env.NODE_ENV !== 'test' && (hour >= 23 || hour < 7)) {
      return;
    }

    const now = Date.now();
    const pendingOrders = models.getAllOrders(80).filter(o => o.status === 'PENDING' && o.platform === 'whatsapp');

    for (const order of pendingOrders) {
      if (!order.platform_user_id) continue;
      const customerPhone = String(order.platform_user_id).split('@')[0].replace(/\D/g, '');
      if (!customerPhone || customerPhone.length < 8) continue;

      // Se o cliente já informou desinteresse ou recusa, pula e não importuna
      const cognProfile = models.getLeadCognitiveProfile(customerPhone);
      if (cognProfile && (cognProfile.buying_stage === 'PERDIDO' || cognProfile.main_objection === 'SEM_INTERESSE')) {
        continue;
      }

      const orderAgeMs = now - new Date(order.created_at).getTime();
      const orderAgeMin = Math.floor(orderAgeMs / 60000);

      const logs = models.getFollowUpHistory(customerPhone);
      const stagesSent = logs.map(l => l.stage);

      const firstName = (order.customer_name && typeof order.customer_name === 'string' && !/^(cliente|lead|amigo|user)$/i.test(order.customer_name.trim()))
        ? order.customer_name.trim().split(' ')[0]
        : 'amigo';

      const prodName = order.product_name || 'PayBot Vendas 24/7';
      const cleanTargetJid = `${customerPhone}@s.whatsapp.net`;

      // ETAPA 1: 10 a 30 minutos após a geração do Pix
      if (orderAgeMin >= 10 && orderAgeMin <= 60 && !stagesSent.includes(1)) {
        const msg = `Fala ${firstName}, tudo na paz?\n\nTô separando teu acesso aqui ao *${prodName}* pra já liberar... deu algum erro no app do seu banco ao copiar a chave Pix ou foi suave? Qualquer coisa me dá um toque aqui! 👊`;
        await this._dispatchMessage(whatsappBotInstance, sock, cleanTargetJid, msg);
        models.recordFollowUpLog({
          orderId: order.id,
          tradeNo: order.merchant_trade_no,
          customerPhone,
          customerName: firstName,
          stage: 1,
          messageSent: msg
        });
        continue;
      }

      // ETAPA 2: 4 a 12 horas após a geração do Pix
      if (orderAgeMin >= 240 && orderAgeMin <= 720 && !stagesSent.includes(2) && stagesSent.includes(1)) {
        const msg = `Opa ${firstName}, passando rápido:\n\nSobrou apenas *1 vaga* com a condição especial que te passei pro *${prodName}*. Consigo segurar ela pra você até o final da tarde de hoje. Consegue fechar agora pra eu já liberar teu setup?`;
        await this._dispatchMessage(whatsappBotInstance, sock, cleanTargetJid, msg);
        models.recordFollowUpLog({
          orderId: order.id,
          tradeNo: order.merchant_trade_no,
          customerPhone,
          customerName: firstName,
          stage: 2,
          messageSent: msg
        });
        continue;
      }

      // ETAPA 3: 24 horas após a geração do Pix (Última chamada com bônus)
      if (orderAgeMin >= 1440 && orderAgeMin <= 2880 && !stagesSent.includes(3) && stagesSent.includes(2)) {
        const msg = `${firstName}, beleza?\n\nHoje estamos virando o lote do *${prodName}*. Como você já tinha gerado o pedido ontem, liberei pra você um *Bônus VIP de Setup Prioritário* se você confirmar hoje. Quer que eu reenvie a chave Pix atualizada?`;
        await this._dispatchMessage(whatsappBotInstance, sock, cleanTargetJid, msg);
        models.recordFollowUpLog({
          orderId: order.id,
          tradeNo: order.merchant_trade_no,
          customerPhone,
          customerName: firstName,
          stage: 3,
          messageSent: msg
        });
      }
    }
  }

  async _dispatchMessage(whatsappBotInstance, sock, jid, text) {
    try {
      if (typeof whatsappBotInstance.sendHumanSplitMessages === 'function') {
        await whatsappBotInstance.sendHumanSplitMessages(sock, jid, text);
      } else if (typeof whatsappBotInstance.sendMessage === 'function') {
        await whatsappBotInstance.sendMessage(jid, text, {}, sock);
      } else if (typeof sock.sendMessage === 'function') {
        await sock.sendMessage(jid, { text });
      }
    } catch (err) {
      console.warn('[AutonomousFollowUp ⚠️ Envio falhou]:', err.message);
    }
  }
}

const autonomousFollowUpService = new AutonomousFollowUpService();
module.exports = autonomousFollowUpService;

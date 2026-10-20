const models = require('../db/models');
const binancePay = require('./binancePay');
const fulfillment = require('./fulfillment');

class SubscriptionCronService {
  constructor() {
    this.pollInterval = null;
    this.subCheckInterval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('⏰ [Cron] Serviço de verificação automática iniciado.');

    // 1. Polling de pagamentos pendentes na Binance Pay a cada 15 segundos
    this.pollInterval = setInterval(() => {
      this.checkPendingOrders().catch(err => {
        console.error('[Cron ❌ Erro ao checar pedidos pendentes]:', err.message);
      });
    }, 15000);

    // 2. Verificação de assinaturas (vencimentos e renovações) a cada 5 minutos
    this.subCheckInterval = setInterval(() => {
      this.checkSubscriptions().catch(err => {
        console.error('[Cron ❌ Erro ao checar assinaturas]:', err.message);
      });
    }, 5 * 60 * 1000);

    // Executa uma checagem imediata
    setTimeout(() => {
      this.checkPendingOrders();
      this.checkSubscriptions();
    }, 3000);
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.subCheckInterval) clearInterval(this.subCheckInterval);
    this.isRunning = false;
    console.log('⏰ [Cron] Serviço de verificação automática parado.');
  }

  async checkPendingOrders() {
    const pendingOrders = models.getPendingOrders();
    if (!pendingOrders || pendingOrders.length === 0) return;

    for (const order of pendingOrders) {
      // Ignora pedidos muito antigos (> 6 horas)
      const createdAt = new Date(order.created_at).getTime();
      const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

      if (ageHours > 6) {
        models.updateOrderStatus(order.merchant_trade_no, 'EXPIRED');
        continue;
      }

      // Consulta status na Binance Pay
      const queryResult = await binancePay.queryOrder(order.merchant_trade_no);
      if (queryResult.success && queryResult.status === 'PAID') {
        console.log(`[Cron 💰] Pagamento detectado pela Binance Pay para pedido ${order.merchant_trade_no}!`);
        await fulfillment.fulfillOrder(order.merchant_trade_no);
      } else if (queryResult.status === 'CANCELED' || queryResult.status === 'EXPIRED') {
        models.updateOrderStatus(order.merchant_trade_no, queryResult.status);
      }
    }
  }

  async checkSubscriptions() {
    const now = new Date();

    // 1. Envia lembrete de renovação para quem vence nas próximas 48 horas
    const expiringSoon = models.getExpiringSubscriptions(48);
    for (const sub of expiringSoon) {
      const endDate = new Date(sub.end_date);
      const diffHours = Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60));
      const formattedDate = endDate.toLocaleDateString('pt-BR');

      const reminderMsg = `⏳ *AVISO DE VENCIMENTO DE ASSINATURA* ⏳\n\n` +
        `Sua assinatura de *${sub.product_name}* vence em aproximadamente *${diffHours} horas* (em ${formattedDate}).\n\n` +
        `Para não perder o acesso ao grupo VIP, basta realizar a renovação no menu de planos!`;

      try {
        if (sub.platform === 'telegram' && fulfillment.sendTelegramMessage) {
          await fulfillment.sendTelegramMessage(sub.platform_user_id, reminderMsg);
        } else if (sub.platform === 'whatsapp' && fulfillment.sendWhatsAppMessage) {
          await fulfillment.sendWhatsAppMessage(sub.platform_user_id, reminderMsg);
        }
        models.markReminderSent(sub.id);
        console.log(`[Cron 🔔] Lembrete de renovação enviado para ${sub.platform_user_id} (${sub.platform})`);
      } catch (err) {
        console.error(`[Cron ⚠️ Erro no lembrete para ${sub.platform_user_id}]:`, err.message);
      }
    }

    // 2. Remove membros cujas assinaturas já expiraram
    const expiredList = models.getExpiredSubscriptions();
    for (const sub of expiredList) {
      console.log(`[Cron ⛔] Assinatura #${sub.id} de ${sub.platform_user_id} expirou. Revogando acesso...`);

      // Se for Telegram e houver canal configurado, remove o usuário
      if (sub.telegram_channel_id && fulfillment.removeTelegramMember) {
        try {
          await fulfillment.removeTelegramMember(sub.telegram_channel_id, sub.platform_user_id);
          console.log(`[Cron ✅] Usuário ${sub.platform_user_id} removido do grupo Telegram VIP.`);
        } catch (err) {
          console.error(`[Cron ⚠️ Falha ao remover membro do Telegram]:`, err.message);
        }
      }

      // Notifica o cliente sobre a expiração
      const expiredMsg = `🚨 *SUA ASSINATURA VIP EXPIROU* 🚨\n\n` +
        `Seu período de acesso para *${sub.product_name}* terminou.\n` +
        `Seu acesso ao grupo VIP foi temporariamente suspenso.\n\n` +
        `Para reativar instantaneamente, escolha um plano no menu e efetue o pagamento. O acesso é liberado no mesmo segundo!`;

      try {
        if (sub.platform === 'telegram' && fulfillment.sendTelegramMessage) {
          await fulfillment.sendTelegramMessage(sub.platform_user_id, expiredMsg);
        } else if (sub.platform === 'whatsapp' && fulfillment.sendWhatsAppMessage) {
          await fulfillment.sendWhatsAppMessage(sub.platform_user_id, expiredMsg);
        }
      } catch (err) {
        console.error(`[Cron ⚠️ Erro ao notificar expiração para ${sub.platform_user_id}]:`, err.message);
      }

      models.updateSubscriptionStatus(sub.id, 'EXPIRED');
    }
  }
}

module.exports = new SubscriptionCronService();

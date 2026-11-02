const models = require('../db/models');
const binancePay = require('./binancePay');
const pixPayment = require('./pixPayment');
const fulfillment = require('./fulfillment');

class SubscriptionCronService {
  constructor() {
    this.pollInterval = null;
    this.subCheckInterval = null;
    this.abandonedInterval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('⏰ [Cron] Serviço de verificação automática iniciado.');

    // 1. Polling de pagamentos pendentes a cada 15 segundos
    this.pollInterval = setInterval(() => {
      this.checkPendingOrders().catch(err => {
        console.error('[Cron ❌ Erro ao checar pedidos pendentes]:', err.message);
      });
    }, 15000);
    this.pollInterval.unref?.();

    // 2. Recuperação automática de carrinhos/pedidos abandonados a cada 60 segundos
    this.abandonedInterval = setInterval(() => {
      this.checkAbandonedCarts().catch(err => {
        console.error('[Cron ❌ Erro ao recuperar carrinhos]:', err.message);
      });
    }, 60000);
    this.abandonedInterval.unref?.();

    // 3. Verificação de assinaturas (vencimentos e renovações) a cada 5 minutos
    this.subCheckInterval = setInterval(() => {
      this.checkSubscriptions().catch(err => {
        console.error('[Cron ❌ Erro ao checar assinaturas]:', err.message);
      });
    }, 5 * 60 * 1000);
    this.subCheckInterval.unref?.();

    // 4. Verificação de etapas agendadas do Lançamento Meteórico a cada 30 segundos
    this.meteoricCheckInterval = setInterval(() => {
      this.checkMeteoricScheduledStages().catch(err => {
        console.error('[Cron ❌ Erro ao checar etapas meteóricas]:', err.message);
      });
    }, 30000);
    this.meteoricCheckInterval.unref?.();

    // 5. Verificação de reuniões agendadas & lembrete 1h antes (Google Meet)
    this.meetingReminderInterval = setInterval(() => {
      try {
        const meetingService = require('./meetingService');
        meetingService.checkAndSendMeetingReminders().catch(err => {
          console.error('[Cron ❌ Erro nos lembretes de reunião]:', err.message);
        });
      } catch (_) {}
    }, 60000);
    this.meetingReminderInterval.unref?.();

    // 6. Heartbeat Autônomo de Follow-up Consultivo (Hexis Sales)
    this.cognitiveHeartbeatInterval = setInterval(() => {
      try {
        const cognitiveService = require('./cognitiveSalesService');
        cognitiveService.runAutonomousHeartbeat().catch(err => {
          console.error('[Cron ❌ Erro no heartbeat cognitivo]:', err.message);
        });
      } catch (_) {}
    }, 5 * 60 * 1000);
    this.cognitiveHeartbeatInterval.unref?.();

    // Executa uma checagem imediata
    setTimeout(() => {
      this.checkPendingOrders();
      this.checkAbandonedCarts();
      this.checkSubscriptions();
      this.checkMeteoricScheduledStages();
    }, 3000);
  }

  async checkMeteoricScheduledStages() {
    try {
      const meteoricService = require('./meteoricService');
      if (typeof meteoricService.checkAndExecuteScheduledStages === 'function') {
        await meteoricService.checkAndExecuteScheduledStages();
      }
    } catch (_) {}
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.abandonedInterval) clearInterval(this.abandonedInterval);
    if (this.subCheckInterval) clearInterval(this.subCheckInterval);
    if (this.meteoricCheckInterval) clearInterval(this.meteoricCheckInterval);
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

      // Se for Mercado Pago (Pix)
      if (order.gateway === 'mercadopago' && order.prepay_id) {
        const pixRes = await pixPayment.queryPixPayment(order.prepay_id);
        if (pixRes.success && pixRes.status === 'PAID') {
          console.log(`[Cron 💰] Pagamento Pix detectado para pedido ${order.merchant_trade_no}!`);
          await fulfillment.fulfillOrder(order.merchant_trade_no);
        }
      } 
      // Se for Binance Pay
      else if (order.gateway === 'binancepay') {
        const queryResult = await binancePay.queryOrder(order.merchant_trade_no);
        if (queryResult.success && queryResult.status === 'PAID') {
          console.log(`[Cron 💰] Pagamento Binance Pay detectado para pedido ${order.merchant_trade_no}!`);
          await fulfillment.fulfillOrder(order.merchant_trade_no);
        } else if (queryResult.status === 'CANCELED' || queryResult.status === 'EXPIRED') {
          models.updateOrderStatus(order.merchant_trade_no, queryResult.status);
        }
      }
    }
  }

  async checkAbandonedCarts() {
    const isEnabled = models.getSetting('ABANDONED_CART_ENABLED', 'true') === 'true';
    if (!isEnabled) return;

    const delayMinutes = parseInt(models.getSetting('ABANDONED_CART_DELAY_MIN', '15'), 10) || 15;
    const abandonedOrders = models.getAbandonedOrders(delayMinutes);
    if (!abandonedOrders || abandonedOrders.length === 0) return;

    const template = models.getSetting(
      'ABANDONED_CART_MESSAGE',
      '👋 Olá, {name}! Notamos que seu pedido para *{product}* ainda está reservado.\n\nFicou com alguma dúvida para concluir seu pagamento? Garanta o seu antes que o link expire!\n\nClique no botão abaixo para pagar e receber seu acesso imediatamente:'
    );

    for (const order of abandonedOrders) {
      const customerName = order.platform_user_name || 'Cliente';
      const valorStr = order.currency === 'BRL' ? `R$ ${order.amount.toFixed(2)}` : `${order.amount.toFixed(2)} USDT`;

      let message = template
        .replace(/{name}/g, customerName)
        .replace(/{product}/g, order.product_name)
        .replace(/{amount}/g, valorStr)
        .replace(/{order}/g, order.merchant_trade_no);

      try {
        if (order.platform === 'telegram' && fulfillment.sendTelegramMessage) {
          if (order.pix_code) {
            message += `\n\n📋 *Pix Copia e Cola:* \`${order.pix_code}\``;
          } else if (order.checkout_url) {
            message += `\n\n🔗 *Link de Pagamento:* ${order.checkout_url}`;
          }
          const sentTg = await fulfillment.sendTelegramMessage(order.platform_user_id, message);
          if (sentTg !== false) {
            models.markOrderRecoverySent(order.id);
            console.log(`[Carrinho Abandonado 🛒] Lembrete enviado com sucesso para ${order.platform_user_id} (${order.platform}) ref. #${order.merchant_trade_no}`);
          }
        } else if (order.platform === 'whatsapp' && fulfillment.sendWhatsAppMessage) {
          const cleanPhone = String(order.platform_user_id || '').replace(/\D/g, '');
          if (cleanPhone.length >= 8) {
            if (order.pix_code) {
              message += `\n\n📋 *Código Pix Copia e Cola:*\n\`${order.pix_code}\``;
            } else if (order.checkout_url) {
              message += `\n\n🔗 *Link Direto de Pagamento:*\n${order.checkout_url}`;
            }
            const sentWpp = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, message);
            if (sentWpp !== false) {
              models.markOrderRecoverySent(order.id);
              console.log(`[Carrinho Abandonado 🛒] Lembrete enviado com sucesso para ${order.platform_user_id} (${order.platform}) ref. #${order.merchant_trade_no}`);
            } else {
              console.log(`[Carrinho Abandonado ⏸️] WhatsApp não conectado. Lembrete para ${order.platform_user_id} mantido na fila para envio automático.`);
            }
          }
        }
      } catch (err) {
        console.error(`[Carrinho Abandonado ⚠️ Erro ao enviar para ${order.platform_user_id}]:`, err.message);
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
          const cleanPhone = String(sub.platform_user_id || '').replace(/\D/g, '');
          if (cleanPhone.length >= 8) {
            await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, reminderMsg);
          }
        }
        models.markReminderSent(sub.id);
        console.log(`[Cron 🔔] Lembrete de renovação processado para ${sub.platform_user_id} (${sub.platform})`);
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
          const cleanPhone = String(sub.platform_user_id || '').replace(/\D/g, '');
          if (cleanPhone.length >= 8) {
            await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, expiredMsg);
          }
        }
      } catch (err) {
        console.error(`[Cron ⚠️ Erro ao notificar expiração para ${sub.platform_user_id}]:`, err.message);
      }

      models.updateSubscriptionStatus(sub.id, 'EXPIRED');
    }
  }
}

module.exports = new SubscriptionCronService();

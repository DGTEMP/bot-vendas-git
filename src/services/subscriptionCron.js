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

    // 7. Reposição contínua de tokens de Sub-Bots Free (Ciclo de 24h por token usado, teto máx 50)
    this.subbotTokenReplenishInterval = setInterval(() => {
      try {
        const subbotTokenService = require('./subbotTokenService');
        subbotTokenService.replenishAllActiveSubBots();
      } catch (_) {}
    }, 60 * 1000);
    this.subbotTokenReplenishInterval.unref?.();

    // 8. Follow-Up Autônomo Anti-Vácuo & Recuperação de Pix Abandonado (Etapas 1, 2 e 3)
    try {
      const autonomousFollowUpService = require('./autonomousFollowUpService');
      const whatsappBot = require('../bots/whatsappBot');
      autonomousFollowUpService.start(whatsappBot);
    } catch (_) {}

    // 8.1 🛒 Recuperação Ativa de Carrinho Abandonado no WhatsApp (Pilar 2)
    try {
      const abandonedCartRecoveryService = require('./abandonedCartRecoveryService');
      const whatsappBot = require('../bots/whatsappBot');
      abandonedCartRecoveryService.start(whatsappBot);
    } catch (_) {}

    // 8.2 🛡️ Régua de Aquecimento de Sub-Bots 7 Dias (Pilar 3)
    try {
      const subBotWarmupPipelineService = require('./subBotWarmupPipelineService');
      subBotWarmupPipelineService.start();
    } catch (_) {}

    // 8.3 🎬 Máquina de Vídeos Virais Agendados (Pilar 4)
    try {
      const viralRepurposingService = require('./viralRepurposingService');
      viralRepurposingService.start();
    } catch (_) {}

    // 9. Ciclo de Sono & Consolidação Noturna de Memória (Sleep-Cycle Memory / aydinnyunus/sleep)
    // Executa verificação periódica; se o horário de Brasília estiver na janela da madrugada (03h), roda a consolidação noturna
    this.sleepCycleInterval = setInterval(() => {
      try {
        const now = new Date();
        const hour = now.getHours();
        if (hour === 3) {
          const sleepCycle = require('./sleepCycleMemoryService');
          const lastRun = models.getLatestSleepCycleRun();
          const todayDateStr = now.toISOString().split('T')[0];
          if (!lastRun || !lastRun.created_at || !lastRun.created_at.startsWith(todayDateStr)) {
            sleepCycle.executeSleepCycle({ source: 'CRON_NOTURNO_03H' }).catch(err => {
              console.warn('[Cron ⚠️ SleepCycle]:', err.message);
            });
          }
        }
      } catch (_) {}
    }, 30 * 60 * 1000);
    this.sleepCycleInterval.unref?.();

    // Executa uma checagem imediata com proteção contra rejeição não tratada
    setTimeout(() => {
      this.checkPendingOrders().catch(err => console.error('[Cron ❌ checkPendingOrders]:', err.message));
      this.checkAbandonedCarts().catch(err => console.error('[Cron ❌ checkAbandonedCarts]:', err.message));
      this.checkSubscriptions().catch(err => console.error('[Cron ❌ checkSubscriptions]:', err.message));
      this.checkMeteoricScheduledStages().catch(err => console.error('[Cron ❌ checkMeteoricScheduledStages]:', err.message));
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
      try {
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
      } catch (orderErr) {
        console.warn(`[Cron ⚠️ Erro ao verificar pedido ${order?.merchant_trade_no}]:`, orderErr.message);
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
      const cleanPhone = String(order.platform_user_id || '').replace(/\D/g, '');

      // Gera ou resgata cupom inteligente de 10% OFF com urgência de 2 horas
      let coupon = null;
      try {
        coupon = models.createOrGetAbandonedCoupon(cleanPhone || order.merchant_trade_no, customerName, 10, 2);
      } catch (_) {}

      let message = template
        .replace(/{name}/g, customerName)
        .replace(/{product}/g, order.product_name)
        .replace(/{amount}/g, valorStr)
        .replace(/{order}/g, order.merchant_trade_no);

      if (coupon && coupon.code) {
        message += `\n\n🎁 *CUPOM EXCLUSIVO DE RETOMADA (10% OFF):* \`${coupon.code}\`\n⏳ _Válido apenas pelas próximas 2 horas para garantir sua compra agora!_`;
      }

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
        } else if (order.platform === 'whatsapp') {
          const cleanPhone = String(order.platform_user_id || '').replace(/\D/g, '');
          if (cleanPhone.length >= 8) {
            const firstName = models.getContactFirstName(cleanPhone) || (customerName && customerName !== 'Cliente' ? customerName.split(' ')[0] : '');
            const greetWord = firstName ? `opa ${firstName}, tudo bem? 🙂` : 'opa, tudo bem? 🙂';
            const payRef = order.pix_code ? `\n\nse quiser pagar no Pix, o código é esse aqui:\n\`${order.pix_code}\`` : (order.checkout_url ? `\n\nse quiser dar mais uma olhada, seu link de pagamento tá salvo aqui: ${order.checkout_url}` : '');
            const humanOrderMsg = `${greetWord}\n\nvi aqui que você gerou o pedido do *${order.product_name}*, mas não deu tempo de concluir... deu algum problema no pagamento ou ficou com alguma dúvida sobre o acesso?${payRef}\n\nse precisar de qualquer coisa, só me responder por aqui! 👍`;

            let sentWpp = false;
            try {
              const whatsappBot = require('../bots/whatsappBot');
              if (whatsappBot && typeof whatsappBot.sendHumanSplitMessages === 'function' && whatsappBot.sock) {
                await whatsappBot.sendHumanSplitMessages(whatsappBot.sock, `${cleanPhone}@s.whatsapp.net`, humanOrderMsg);
                sentWpp = true;
              } else if (fulfillment.sendWhatsAppMessage) {
                sentWpp = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, humanOrderMsg);
              }
            } catch (_) {
              if (fulfillment.sendWhatsAppMessage) {
                sentWpp = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, humanOrderMsg);
              }
            }

            if (sentWpp !== false) {
              models.markOrderRecoverySent(order.id);
              console.log(`[Carrinho Abandonado 🛒] Lembrete humanizado enviado para ${order.platform_user_id} ref. #${order.merchant_trade_no}`);
            } else {
              console.log(`[Carrinho Abandonado ⏸️] WhatsApp não conectado. Lembrete para ${order.platform_user_id} mantido na fila.`);
            }
          }
        }
      } catch (err) {
        console.error(`[Carrinho Abandonado ⚠️ Erro ao enviar para ${order.platform_user_id}]:`, err.message);
      }
    }

    // 2. Recuperação de Carrinhos Abandonados na Vitrine Web (web_cart_sessions)
    try {
      const webStoreTrackerService = require('./webStoreTrackerService');
      const webAbandoned = models.getAbandonedCartSessions(delayMinutes);
      if (webAbandoned && webAbandoned.length > 0) {
        for (const session of webAbandoned) {
          const cleanPhone = String(session.phone || '').replace(/\D/g, '');
          if (!cleanPhone || cleanPhone.length < 8) continue;

          let prodName = session.current_product_name;
          if (!prodName && Array.isArray(session.cart_items) && session.cart_items.length > 0) {
            prodName = session.cart_items.map(i => i.name).filter(Boolean).join(', ');
          }
          if (!prodName) prodName = 'seus itens selecionados';

          const clientName = session.customer_name || 'Amigo(a)';
          const firstName = models.getContactFirstName(cleanPhone) || (clientName && clientName !== 'Amigo(a)' && clientName !== 'Cliente' ? clientName.split(' ')[0] : '');

          const recoveryObj = webStoreTrackerService.buildTrackedStoreUrl({
            phone: cleanPhone,
            name: firstName || clientName,
            subbot_id: session.subbot_id,
            source: 'carrinho_abandonado_web',
            preferShort: true
          });
          const recoveryUrl = recoveryObj.shortUrl || recoveryObj.url;

          const greetWord = firstName ? `opa ${firstName}, tudo bem? 🙂` : 'opa, tudo bem? 🙂';
          const humanWebMsg = `${greetWord}\n\nvi aqui que você tava dando uma olhada no *${prodName}*... deu algum problema na hora de fechar ou ficou alguma dúvida sobre como funciona?\n\nse quiser dar mais uma olhada com calma, deixei seu carrinho salvo aqui: ${recoveryUrl}\n\nqualquer coisa pode me responder direto por aqui! 👍`;

          let sent = false;
          try {
            const whatsappBot = require('../bots/whatsappBot');
            if (whatsappBot && typeof whatsappBot.sendHumanSplitMessages === 'function' && whatsappBot.sock) {
              await whatsappBot.sendHumanSplitMessages(whatsappBot.sock, `${cleanPhone}@s.whatsapp.net`, humanWebMsg);
              sent = true;
            } else if (fulfillment.sendWhatsAppMessage) {
              sent = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, humanWebMsg);
            }
          } catch (_) {
            if (fulfillment.sendWhatsAppMessage) {
              sent = await fulfillment.sendWhatsAppMessage(`${cleanPhone}@s.whatsapp.net`, humanWebMsg);
            }
          }

          if (sent !== false) {
            models.updateCartSession(session.session_id, { abandoned_recovery_sent: 1 });
            console.log(`[Carrinho Web Abandonado 🛒] Lembrete humanizado enviado para ${cleanPhone} (Sessão: ${session.session_id})`);
          }
        }
      }
    } catch (webCartErr) {
      console.warn('[Carrinho Web Abandonado ⚠️ Erro]:', webCartErr.message);
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

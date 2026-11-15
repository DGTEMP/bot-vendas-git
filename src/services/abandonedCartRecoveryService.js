/**
 * ============================================================================
 * 🛒 ABANDONED CART RECOVERY SERVICE - PILAR 2: RECUPERAÇÃO ATIVA NO WHATSAPP
 * ============================================================================
 * Monitora carrinhos abandonados na Loja Web (web_cart_sessions) e executa
 * uma régua de recuperação autônoma em duas etapas:
 *
 * - Etapa 1 (15 a 45 min pós-abandono): Abordagem consultiva e humanizada
 *   ("Opa [Nome], vi que separou o [Produto]... deu algum erro no checkout?")
 * - Etapa 2 (20 a 28 horas pós-abandono): Gatilho de escassez + Cupom de 10% OFF
 *   gerado na hora (ex: VOLTA10_XXXX válido por 24 horas).
 *
 * Roteamento Inteligente:
 * - Se o lead acessou via sub-bot específico, a recuperação é enviada por esse sub-bot.
 * - Respeita horários de descanso (23h às 07h30) para blindagem de reputação.
 * ============================================================================
 */

const models = require('../db/models');

class AbandonedCartRecoveryService {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  start(whatsappBotInstance) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Executa a cada 2 minutos
    this.interval = setInterval(() => {
      this.runRecoveryCycle(whatsappBotInstance).catch(err => {
        console.warn('[AbandonedCartRecovery ⚠️ Erro no ciclo]:', err.message);
      });
    }, 120000);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  async runRecoveryCycle(whatsappBotInstance) {
    const isEnabled = models.getSetting('ABANDONED_CART_ENABLED', 'true') === 'true';
    if (!isEnabled) return;

    // Não envia de madrugada (23h às 07h30)
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
    if (process.env.NODE_ENV !== 'test' && (hour >= 23 || hour < 7)) {
      return;
    }

    const delayMinutes = Number(models.getSetting('ABANDONED_CART_DELAY_MIN', '15')) || 15;

    // 1. ETAPA 1: Recuperação inicial (15 a 45 minutos)
    await this._processStep1(whatsappBotInstance, delayMinutes);

    // 2. ETAPA 2: Segunda chance com cupom de desconto (20 a 28 horas)
    await this._processStep2(whatsappBotInstance, 20);
  }

  async _processStep1(whatsappBotInstance, delayMinutes) {
    const sessions = models.getAbandonedCartSessionsStep1(delayMinutes);
    if (!sessions || sessions.length === 0) return;

    const webStoreTrackerService = require('./webStoreTrackerService');

    for (const session of sessions) {
      const cleanPhone = String(session.phone || '').replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) continue;

      let prodName = session.current_product_name;
      if (!prodName && Array.isArray(session.cart_items) && session.cart_items.length > 0) {
        prodName = session.cart_items.map(i => i.name).filter(Boolean).join(', ');
      }
      if (!prodName) prodName = 'seus itens selecionados';

      const clientName = session.customer_name || 'Amigo(a)';
      const firstName = models.getContactFirstName ? models.getContactFirstName(cleanPhone) : (clientName !== 'Amigo(a)' && clientName !== 'Cliente' ? clientName.split(' ')[0] : '');

      const recoveryObj = webStoreTrackerService.buildTrackedStoreUrl({
        phone: cleanPhone,
        name: firstName || clientName,
        subbot_id: session.subbot_id,
        source: 'carrinho_abandonado_etapa1',
        preferShort: true
      });
      const recoveryUrl = recoveryObj.shortUrl || recoveryObj.url;

      const greet = firstName ? `Opa ${firstName}, tudo bem? 🙂` : 'Opa, tudo bem? 🙂';
      const message = `${greet}\n\nVi aqui que você estava dando uma olhada no *${prodName}* na nossa loja... deu algum problema na hora de fechar ou ficou com alguma dúvida sobre o produto ou entrega?\n\nSe quiser dar mais uma olhada com calma, deixei seu carrinho salvo aqui:\n🔗 ${recoveryUrl}\n\nQualquer dúvida me dá um toque direto por aqui! 👍`;

      const sent = await this._dispatchToCustomer(whatsappBotInstance, cleanPhone, message, session.subbot_id);
      if (sent) {
        models.markCartRecoveryStep1(session.session_id);
        console.log(`[Carrinho Abandonado 🛒 Etapa 1 Enviada]: ${cleanPhone} (Sessão: ${session.session_id})`);
      }
    }
  }

  async _processStep2(whatsappBotInstance, delayHours) {
    const sessions = models.getAbandonedCartSessionsStep2(delayHours);
    if (!sessions || sessions.length === 0) return;

    const webStoreTrackerService = require('./webStoreTrackerService');

    for (const session of sessions) {
      const cleanPhone = String(session.phone || '').replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) continue;

      let prodName = session.current_product_name;
      if (!prodName && Array.isArray(session.cart_items) && session.cart_items.length > 0) {
        prodName = session.cart_items.map(i => i.name).filter(Boolean).join(', ');
      }
      if (!prodName) prodName = 'seus itens selecionados';

      const clientName = session.customer_name || 'Amigo(a)';
      const firstName = models.getContactFirstName ? models.getContactFirstName(cleanPhone) : (clientName !== 'Amigo(a)' && clientName !== 'Cliente' ? clientName.split(' ')[0] : '');

      // Cria cupom exclusivo de 10% válido por 24 horas
      const coupon = models.createOrGetAbandonedCoupon(cleanPhone, firstName, 10, 24);
      const couponCode = coupon?.code || 'VOLTA10';

      const recoveryObj = webStoreTrackerService.buildTrackedStoreUrl({
        phone: cleanPhone,
        name: firstName || clientName,
        couponCode,
        subbot_id: session.subbot_id,
        source: 'carrinho_abandonado_etapa2_cupom',
        preferShort: true
      });
      const recoveryUrl = recoveryObj.shortUrl || recoveryObj.url;

      const salutation = firstName ? `Passando rápido, ${firstName}!` : 'Passando rápido!';
      const message = `🔥 *${salutation}*\n\nO *${prodName}* que você olhou ontem na loja está com as últimas unidades reservadas no estoque.\n\nPara te ajudar a fechar seu pedido hoje, consegui liberar um *cupom exclusivo de 10% OFF*:\n🎟️ Cupom: *${couponCode}* _(válido pelas próximas 24h)_\n\n👉 Acesse por aqui com o desconto já ativado:\n🔗 ${recoveryUrl}\n\nAproveite antes que o cupom expire! 🚀`;

      const sent = await this._dispatchToCustomer(whatsappBotInstance, cleanPhone, message, session.subbot_id);
      if (sent) {
        models.markCartRecoveryStep2(session.session_id, couponCode);
        console.log(`[Carrinho Abandonado 🛒 Etapa 2 + Cupom Enviada]: ${cleanPhone} (Cupom: ${couponCode})`);
      }
    }
  }

  async _dispatchToCustomer(whatsappBotInstance, cleanPhone, text, preferredSubbotId = null) {
    const targetJid = `${cleanPhone}@s.whatsapp.net`;
    const whatsappArmyService = require('./whatsappArmyService');

    // 1. Se veio por um Sub-Bot específico e ele está ativo, envia por ele
    if (preferredSubbotId && whatsappArmyService.activeSockets) {
      const subSock = whatsappArmyService.activeSockets.get(Number(preferredSubbotId));
      if (subSock) {
        try {
          await subSock.sendMessage(targetJid, { text });
          return true;
        } catch (_) {}
      }
    }

    // 2. Se o bot mestre estiver conectado, usa ele
    if (whatsappBotInstance && whatsappBotInstance.sock && (whatsappBotInstance.isConnected || whatsappBotInstance.sock.user)) {
      try {
        if (typeof whatsappBotInstance.sendHumanSplitMessages === 'function') {
          await whatsappBotInstance.sendHumanSplitMessages(whatsappBotInstance.sock, targetJid, text);
        } else {
          await whatsappBotInstance.sock.sendMessage(targetJid, { text });
        }
        return true;
      } catch (_) {}
    }

    // 3. Fallback: usa qualquer sub-bot ativo da frota
    if (whatsappArmyService.activeSockets && whatsappArmyService.activeSockets.size > 0) {
      for (const [id, sSock] of whatsappArmyService.activeSockets.entries()) {
        try {
          await sSock.sendMessage(targetJid, { text });
          return true;
        } catch (_) {}
      }
    }

    // 4. Fallback final: fulfillment genérico
    try {
      const fulfillment = require('./fulfillment');
      if (typeof fulfillment.sendWhatsAppMessage === 'function') {
        const res = await fulfillment.sendWhatsAppMessage(targetJid, text);
        return res !== false;
      }
    } catch (_) {}

    return false;
  }
}

module.exports = new AbandonedCartRecoveryService();

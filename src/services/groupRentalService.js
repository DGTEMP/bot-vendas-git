const models = require('../db/models');
const db = require('../db/database');

/**
 * GroupRentalService - Sistema Autônomo Completo de Aluguel de Bot por Grupo e Monetização
 *
 * Funcionalidades Autônomas:
 * 1. Modo Aluguel Global: Quando ativado, apenas grupos com aluguel ativo executam comandos.
 * 2. Planos Comerciais Integrados: Semanal (7d), Mensal (30d), Trimestral (90d) e Vitalício.
 * 3. Geração Autônoma de Cobrança Pix: Gera Pix Copia e Cola dinâmico e QR Code na hora (!alugar).
 * 4. Ativação Automática (Zero-Touch): Se o pagamento for feito no grupo, o bot ativa na hora sem código manual.
 * 5. Chaves Manuais de Backup (!key / !usarcodigo): Para vendas externas ou presentes do Dono.
 * 6. Ciclo de Avisos e Cobrança com Pix de Renovação (Cron Autônomo):
 *    - 3 dias antes (72h): Envia aviso preventivo com Pix de renovação no grupo.
 *    - 24 horas antes: Alerta urgente com Pix de renovação.
 *    - No vencimento: Alerta de funções pausadas com prazo de tolerância de 12 horas.
 *    - Após 12 horas (Grace Period): Mensagem de despedida educada e auto-saída do grupo (groupLeave).
 * 7. Renovação Inteligente com Acúmulo: Ao renovar com dias restantes, soma os dias novos sem perder os atuais.
 */
class GroupRentalService {
  constructor() {
    this.intervalId = null;
  }

  /**
   * Planos Oficiais de Aluguel do PayBot
   */
  getRentalPlans() {
    return [
      {
        id: '7',
        days: 7,
        name: '🥉 Plano Semanal (7 Dias)',
        price: 14.90,
        desc: 'Ideal para testes, eventos e lançamentos rápidos',
        highlight: false
      },
      {
        id: '30',
        days: 30,
        name: '🥈 Plano Mensal (30 Dias)',
        price: 49.90,
        desc: 'O mais popular! Proteção contínua e recursos liberados',
        highlight: true
      },
      {
        id: '90',
        days: 90,
        name: '🥇 Plano Trimestral (90 Dias)',
        price: 129.90,
        desc: 'Economia garantida (desconto de mais de 15%)',
        highlight: false
      },
      {
        id: 'vitalicio',
        days: -1,
        name: '💎 Licença Vitalícia (Permanente)',
        price: 299.00,
        desc: 'Pague uma única vez e tenha o bot para sempre no grupo',
        highlight: false
      }
    ];
  }

  isGlobalModeActive() {
    return models.isRentalModeGlobal();
  }

  setGlobalMode(enabled) {
    return models.setRentalModeGlobal(enabled);
  }

  isGroupAuthorized(groupId, senderPhone = '', isOwnerOrSub = false) {
    if (isOwnerOrSub) return { authorized: true, reason: 'OWNER_BYPASS' };
    if (!this.isGlobalModeActive()) return { authorized: true, reason: 'RENTAL_MODE_DISABLED' };

    const rental = models.getGroupRental(groupId);
    if (rental && rental.active) {
      return { authorized: true, reason: 'ACTIVE_RENTAL', rental };
    }

    return {
      authorized: false,
      reason: 'RENTAL_EXPIRED_OR_INACTIVE',
      rental,
      message: '⏳ *Oops! O aluguel deste bot no grupo não está ativo ou expirou.*\n\n' +
        '🔑 Para ativar ou renovar, utilize uma chave de ativação com o comando *!usarcodigo <CHAVE>*, ou digite *!alugar* para adquirir na hora via Pix!'
    };
  }

  getRentalStatus(groupId) {
    return models.getGroupRental(groupId);
  }

  formatRentalInfo(groupId) {
    const isGlobal = this.isGlobalModeActive();
    const rental = models.getGroupRental(groupId);

    let statusLine = '';
    if (rental.permanent) {
      statusLine = '✨ *Aluguel Permanente / Vitalício Ativo!*';
    } else if (rental.active) {
      statusLine = `✅ *Aluguel Ativo:* Restam *${rental.days_left} dia(s)* (Expira em: ${rental.expiration_formatted || new Date(rental.expires_at).toLocaleDateString('pt-BR')})`;
    } else if (!isGlobal) {
      statusLine = '🟢 *Modo Livre Ativo* (Aluguel global desativado pelo Dono)';
    } else {
      statusLine = '❌ *Aluguel Expirado ou Não Ativado*';
    }

    return `╭━━━〔 🤖 *STATUS DO ALUGUEL DO BOT* 〕━━━⬣\n` +
      `┃\n` +
      `┃ 📋 *Grupo:* ${rental.group_name || groupId}\n` +
      `┃ 📡 *Situação:* ${statusLine}\n` +
      `┃ 🔑 *Código Ativo:* \`${rental.rental_code || 'Direto/Sistema'}\`\n` +
      `┃ 💳 *Contratante:* ${rental.payer_phone ? `@${rental.payer_phone.split('@')[0]}` : 'Administração'}\n` +
      `┃ 🛡️ *Proteções:* Anti-Link, Anti-Fake, Anti-Trava, Moderação e IA\n` +
      `┃\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
      `💡 *Deseja renovar ou estender o prazo?* Digite *!alugar* para gerar um Pix de renovação instantâneo!`;
  }

  /**
   * Gera uma Cobrança Pix Autônoma para Contratação ou Renovação de Aluguel
   */
  async generateRentalPixCharge({ durationDays, payerPhone, payerName = 'Cliente WhatsApp', targetGroupJid = null }) {
    const pixPayment = require('./pixPayment');
    const plans = this.getRentalPlans();
    const plan = plans.find(p => String(p.days) === String(durationDays) || (durationDays === 'vitalicio' && p.days === -1)) || plans[1]; // Padrão: 30 dias

    const tradeNo = `ORD_RENT_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    const cleanPhone = String(payerPhone || '').replace(/\D/g, '') || '554884702848';

    // 1. Gera cobrança Pix via Bacen / Gateway homologado
    const pixRes = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo,
      amount: plan.price,
      goodsName: `${plan.name} - PayBot WhatsApp`,
      payerName,
      payerPhone: cleanPhone
    });

    const pixCode = pixRes?.data?.pixCode || pixRes?.pixCopiaECola || pixPayment.generateBacenPixPayload({
      key: models.getSetting('PIX_KEY', '+5548984702848'),
      name: models.getSetting('PIX_MERCHANT_NAME', 'PAYBOT'),
      city: models.getSetting('PIX_MERCHANT_CITY', 'SAO PAULO'),
      amount: plan.price,
      txid: '***'
    });
    const qrCodeBase64 = pixRes?.data?.qrCodeBase64 || null;

    // 2. Localiza produto correspondente ou padrão
    const prodRow = db.prepare('SELECT id FROM products WHERE (type = ? OR category = ?) AND duration_days = ? LIMIT 1').get('group_rental', 'Aluguel', plan.days);
    const prodId = prodRow ? prodRow.id : (plan.days === 30 ? 1062 : (plan.days === 90 ? 1063 : (plan.days === -1 ? 1064 : 1062)));

    // 3. Cadastra o pedido no banco SQLite
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: targetGroupJid || `${cleanPhone}@s.whatsapp.net`,
      platform_user_name: payerName,
      product_id: prodId,
      gateway: 'pix',
      amount: plan.price,
      currency: 'BRL',
      pix_code: pixCode,
      status: 'PENDING'
    });

    return {
      success: true,
      tradeNo,
      amount: plan.price,
      durationDays: plan.days,
      planName: plan.name,
      pixCode,
      qrCodeBase64
    };
  }

  generateCode(durationDays, targetGroupId = null, createdBy = 'admin') {
    return models.generateRentalActivationCode(durationDays, targetGroupId, createdBy);
  }

  validateCode(code) {
    return models.validateRentalActivationCode(code);
  }

  useCode(code, groupId, userId) {
    return models.useRentalActivationCode(code, groupId, userId);
  }

  setGroupRental(groupId, durationDays, info = {}) {
    return models.setGroupRental(groupId, durationDays, info);
  }

  removeGroupRental(groupId) {
    return models.removeGroupRental(groupId);
  }

  listRentals() {
    return models.listGroupRentals();
  }

  listCodes(unusedOnly = false) {
    return models.listRentalActivationCodes(unusedOnly);
  }

  /**
   * Monitor Autônomo de Vencimento e Cobrança de Aluguel (Cron Worker)
   * Avisa com 72h e 24h com Pix Copia e Cola pronto, notifica expiração e remove bot após 12h de tolerância
   */
  async checkExpiringRentals(sock = null) {
    try {
      const allRentals = models.listGroupRentals();
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const results = { warned_72h: [], warned_24h: [], expired: [], left_group: [] };

      for (const r of allRentals) {
        if (r.permanent || !r.expires_at || r.expires_at === 'permanent') continue;
        const expTime = new Date(r.expires_at).getTime();
        const diffMs = expTime - now;

        // Caso 1: Vence em menos de 72h (3 dias) e ainda não foi alertado
        if (diffMs > oneDayMs && diffMs <= 3 * oneDayMs && !r.notified_72h) {
          const daysLeft = Math.max(1, Math.ceil(diffMs / oneDayMs));
          let renewalPixCode = null;

          try {
            const charge = await this.generateRentalPixCharge({
              durationDays: 30,
              payerPhone: r.payer_phone,
              payerName: r.payer_name || 'Admin do Grupo',
              targetGroupJid: r.group_jid
            });
            renewalPixCode = charge.pixCode;
          } catch (_) {}

          const alertMsg =
            `⚠️ *[AVISO DE VENCIMENTO DO BOT - 3 DIAS]* ⚠️\n\n` +
            `O aluguel deste bot no grupo expira em *${daysLeft} dias* (${new Date(r.expires_at).toLocaleDateString('pt-BR')})!\n\n` +
            `Para não interromper as proteções anti-link, anti-fake, moderação e comandos de membros, renove com 1 clique:\n\n` +
            (renewalPixCode ? `💳 *Pix Copia e Cola de Renovação (R$ 49,90 - 30 Dias):*\n\`${renewalPixCode}\`\n\n` : `👉 Digite *!alugar* para gerar o Pix de renovação!\n\n`) +
            `_A renovação é aplicada instantaneamente assim que o Pix for pago._`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: alertMsg });
            } catch (_) {}
          }

          db.prepare('UPDATE group_rentals SET notified_72h = 1 WHERE group_jid = ?').run(r.group_jid);
          results.warned_72h.push(r.group_jid);
        }

        // Caso 2: Vence em menos de 24h e ainda não foi alertado
        if (diffMs > 0 && diffMs <= oneDayMs && !r.notified_24h) {
          const hoursLeft = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
          let renewalPixCode = null;

          try {
            const charge = await this.generateRentalPixCharge({
              durationDays: 30,
              payerPhone: r.payer_phone,
              payerName: r.payer_name || 'Admin do Grupo',
              targetGroupJid: r.group_jid
            });
            renewalPixCode = charge.pixCode;
          } catch (_) {}

          const alertMsg =
            `🚨 *[ALERTA URGENTE: O BOT EXPIRA AMANHÃ!]* 🚨\n\n` +
            `Restam apenas *${hoursLeft} horas* (${new Date(r.expires_at).toLocaleDateString('pt-BR')}) de aluguel ativo para este grupo!\n\n` +
            (renewalPixCode ? `💳 *Pix Copia e Cola de Renovação (R$ 49,90 - 30 Dias):*\n\`${renewalPixCode}\`\n\n` : `👉 Digite *!alugar* para renovar imediatamente!\n\n`) +
            `_Evite que o bot seja removido e o grupo fique desprotegido._`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: alertMsg });
            } catch (_) {}
          }

          db.prepare('UPDATE group_rentals SET notified_24h = 1 WHERE group_jid = ?').run(r.group_jid);
          results.warned_24h.push(r.group_jid);
        }

        // Caso 3: Já expirou
        if (diffMs <= 0 && r.status === 'active') {
          models.removeGroupRental(r.group_jid);

          const expiredMsg =
            `⏳ *[ALUGUEL EXPIRADO - FUNÇÕES PAUSADAS]* ⏳\n\n` +
            `O período de aluguel deste bot expirou hoje (${new Date(r.expires_at).toLocaleDateString('pt-BR')}).\n\n` +
            `🛡️ As funções e comandos de membros foram temporariamente pausados.\n` +
            `⏰ *Tolerância de Renovação:* Você tem até *12 horas* para renovar antes que o bot saia automaticamente do grupo.\n\n` +
            `💡 Para reativar imediatamente, digite *!alugar* ou insira uma nova chave com *!usarcodigo <chave>*.`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: expiredMsg });
            } catch (_) {}
          }
          results.expired.push(r.group_jid);
        }

        // Caso 4: Prazo de tolerância de 12 horas esgotado (Grace Period) -> Auto-Saída (groupLeave)
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        if (diffMs <= -twelveHoursMs && !r.left_group) {
          const leaveMsg =
            `👋 *[TOLERÂNCIA ENCERRADA - ATÉ LOGO!]* 👋\n\n` +
            `O prazo de tolerância de 12 horas encerrou sem renovação de aluguel.\n` +
            `O bot está saindo do grupo para otimizar os recursos do servidor.\n\n` +
            `✨ *Muito obrigado pela preferência!* Quando desejar reativar, basta adicionar o bot novamente e digitar *!alugar*.`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: leaveMsg });
            } catch (_) {}
          }

          if (sock && typeof sock.groupLeave === 'function') {
            try {
              await sock.groupLeave(r.group_jid);
            } catch (_) {}
          }

          db.prepare('UPDATE group_rentals SET left_group = 1 WHERE group_jid = ?').run(r.group_jid);
          results.left_group.push(r.group_jid);
        }
      }

      return results;
    } catch (err) {
      console.error('[GroupRentalService ⚠️ checkExpiringRentals]:', err.message);
      return { warned_72h: [], warned_24h: [], expired: [], left_group: [], error: err.message };
    }
  }

  startExpiringRentalsCron(sock = null) {
    if (this.intervalId) return;
    // Checa a cada 15 minutos
    this.intervalId = setInterval(() => {
      this.checkExpiringRentals(sock).catch(() => {});
    }, 15 * 60 * 1000);
  }

  stopExpiringRentalsCron() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = new GroupRentalService();

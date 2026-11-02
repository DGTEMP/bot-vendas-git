const models = require('../db/models');

/**
 * GroupRentalService - Sistema Completo de Aluguel de Bot por Grupo e Monetização (Portado de Nazuna v4.0)
 *
 * Funcionalidades:
 * 1. Modo Aluguel Global: Quando ativado, grupos precisam ter aluguel válido para responder a comandos.
 * 2. Códigos de Ativação Únicos: Geração de chaves de 8 caracteres hexadecimais (ex: A1B2C3D4).
 * 3. Detecção Automática de Chaves: Se alguém colar o código de 8 dígitos no grupo, ativa na hora.
 * 4. Monitoramento Autônomo de Vencimento: Notifica 24h antes e avisa ao expirar.
 * 5. Integração com Vendas / Loja: Liberação automática via Pix e Cripto (Fulfillment).
 */
class GroupRentalService {
  constructor() {
    this.intervalId = null;
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
        '🔑 Para ativar ou renovar, utilize um código de ativação com o comando *!usarcodigo <CHAVE>* ou adquira o aluguel no comando *!loja*.'
    };
  }

  getRentalStatus(groupId) {
    return models.getGroupRental(groupId);
  }

  formatRentalInfo(groupId) {
    const isGlobal = this.isGlobalModeActive();
    const rental = models.getGroupRental(groupId);

    let statusLine = '';
    if (!isGlobal) {
      statusLine = '🟢 *Modo Aluguel Global Desativado* (Livre para todos os grupos)';
    } else if (rental.permanent) {
      statusLine = '✨ *Aluguel Permanente / Vitalício Ativo!*';
    } else if (rental.active) {
      statusLine = `✅ *Aluguel Ativo:* Restam *${rental.days_left} dia(s)* (Expira em: ${rental.expiration_formatted || new Date(rental.expires_at).toLocaleDateString('pt-BR')})`;
    } else {
      statusLine = '❌ *Aluguel Expirado ou Não Ativado*';
    }

    return `╭┈⊰ 🤖 『 *STATUS DO ALUGUEL DO GRUPO* 』\n` +
      `┊\n` +
      `┊📋 *Grupo:* ${rental.group_name || groupId}\n` +
      `┊📡 *Status:* ${statusLine}\n` +
      `┊🔑 *Código Utilizado:* ${rental.rental_code || 'Nenhum'}\n` +
      `┊💳 *Contratante:* ${rental.payer_phone ? `@${rental.payer_phone.split('@')[0]}` : 'Administração'}\n` +
      `╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n` +
      `💡 *Para renovar ou adquirir:* Peça ao dono uma chave ou adquira via Pix no comando *!loja*!`;
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
   * Worker Periódico de Checagem de Expiração de Aluguéis
   * Avisa grupos 24h antes do vencimento e notifica expiração.
   */
  async checkExpiringRentals(sock = null) {
    try {
      const allRentals = models.listGroupRentals();
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const results = { warned_24h: [], expired: [] };

      for (const r of allRentals) {
        if (r.permanent || !r.expires_at || r.expires_at === 'permanent') continue;
        const expTime = new Date(r.expires_at).getTime();
        const diffMs = expTime - now;

        // Caso 1: Vence em menos de 24h e ainda não foi alertado
        if (diffMs > 0 && diffMs <= oneDayMs && !r.notified_24h) {
          const hoursLeft = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
          const alertMsg = `⚠️ *[ALERTA DE VENCIMENTO]* ⚠️\n\n` +
            `O aluguel deste bot no grupo expira em aproximadamente *${hoursLeft} horas* (${new Date(r.expires_at).toLocaleDateString('pt-BR')})!\n\n` +
            `Para não interromper as funções de segurança, moderação e IA, renove hoje mesmo com um novo código no comando *!usarcodigo* ou acesse a *!loja*.`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: alertMsg });
            } catch (_) {}
          }

          // Marca como notificado
          const db = require('../db/database');
          db.prepare('UPDATE group_rentals SET notified_24h = 1 WHERE group_jid = ?').run(r.group_jid);
          results.warned_24h.push(r.group_jid);
        }

        // Caso 2: Já expirou
        if (diffMs <= 0 && r.status === 'active') {
          models.removeGroupRental(r.group_jid);
          const expiredMsg = `⏳ *[ALUGUEL EXPIRADO]* ⏳\n\n` +
            `O período de aluguel deste bot expirou hoje (${new Date(r.expires_at).toLocaleDateString('pt-BR')}).\n\n` +
            `Os comandos de membros e utilitários foram pausados. Contate o suporte ou adquira uma nova chave de ativação para reativar! ✨`;

          if (sock && typeof sock.sendMessage === 'function') {
            try {
              await sock.sendMessage(r.group_jid, { text: expiredMsg });
            } catch (_) {}
          }
          results.expired.push(r.group_jid);
        }
      }

      return results;
    } catch (err) {
      console.error('[GroupRentalService ⚠️ checkExpiringRentals]:', err.message);
      return { warned_24h: [], expired: [], error: err.message };
    }
  }

  startExpiringRentalsCron(sock = null) {
    if (this.intervalId) return;
    // Checa a cada 30 minutos
    this.intervalId = setInterval(() => {
      this.checkExpiringRentals(sock).catch(() => {});
    }, 30 * 60 * 1000);
  }

  stopExpiringRentalsCron() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = new GroupRentalService();

/**
 * socialListeningService.js
 * Motor de Escuta de Palavras-Chave e Entrosamento Orgânico nos Grupos do WhatsApp
 * Identifica menções espontâneas de produtos/assuntos (ex: "chapinha", "bot", "software")
 * e dispara recomendações naturais com links de afiliado como se fosse um cliente satisfeito.
 */

const models = require('../db/models');

class SocialListeningService {
  constructor() {
    // Rastreia cooldown por grupo para evitar spam consecutivo
    this.groupCooldowns = new Map();
  }

  /**
   * Verifica se o recurso está ativado globalmente
   */
  isEnabled() {
    return models.getSetting('SOCIAL_LISTENING_ENABLED', 'true') === 'true';
  }

  /**
   * Retorna o tempo de cooldown padrão em minutos
   */
  getCooldownMinutes() {
    const val = parseInt(models.getSetting('SOCIAL_LISTENING_COOLDOWN_MIN', '15'), 10);
    return isNaN(val) ? 15 : Math.max(1, val);
  }

  /**
   * Analisa mensagens em grupos e dispara recomendação orgânica stealth
   */
  async handleIncomingGroupMessage(sock, groupJid, senderJid, text, isOwnerUser = false) {
    if (!this.isEnabled()) return false;
    if (isOwnerUser) return false; // Dono nunca é alvo de entrosamento stealth
    if (!sock || !groupJid || !text || typeof text !== 'string') return false;

    const lower = text.trim().toLowerCase();
    // Ignora comandos iniciados por ! ou /
    if (lower.startsWith('!') || lower.startsWith('/')) return false;

    // 1. Verifica Cooldown do Grupo
    const now = Date.now();
    const lastTrigger = this.groupCooldowns.get(groupJid);
    const cooldownMs = process.env.NODE_ENV === 'test' ? 50 : (this.getCooldownMinutes() * 60 * 1000);

    if (lastTrigger && (now - lastTrigger) < cooldownMs) {
      return false; // Grupo ainda em período de resfriamento
    }

    // 2. Busca todas as regras de escuta ativas
    const rules = models.listSocialListeningRules(true);
    if (!rules || rules.length === 0) return false;

    for (const rule of rules) {
      if (!rule.keywords) continue;
      const keywords = rule.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

      // Verifica se a mensagem contém alguma das palavras-chave
      const matchedKeyword = keywords.find(kw => lower.includes(kw));
      if (matchedKeyword) {
        // Regra disparada!
        const templates = Array.isArray(rule.templates) && rule.templates.length > 0
          ? rule.templates
          : ['Comprei o meu por esse link aqui na promoção e recomendo demais: {link}'];

        // Seleciona template aleatório
        const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
        const recommendationText = randomTemplate
          .replace(/\{link\}/gi, rule.affiliate_url)
          .replace(/\{produto\}/gi, rule.product_name)
          .replace(/\{url\}/gi, rule.affiliate_url);

        console.log(`[Social Listening 🎯] Palavra "${matchedKeyword}" detectada no grupo ${groupJid}! Disparando recomendação de "${rule.product_name}"...`);

        // Simula presença de digitação humana
        try {
          if (typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('composing', groupJid);
            if (process.env.NODE_ENV !== 'test') {
              const delay = Math.min(2500, Math.max(1000, recommendationText.length * 20));
              await new Promise(resolve => setTimeout(resolve, delay));
              await sock.sendPresenceUpdate('paused', groupJid);
            }
          }
        } catch (_) {}

        // Envia mensagem no grupo
        await sock.sendMessage(groupJid, { text: recommendationText });

        // Atualiza métricas e timestamp de cooldown
        this.groupCooldowns.set(groupJid, Date.now());
        models.recordSocialListeningTrigger(rule.id);

        return {
          triggered: true,
          ruleId: rule.id,
          productName: rule.product_name,
          matchedKeyword,
          sentText: recommendationText
        };
      }
    }

    return false;
  }

  /**
   * Reseta o cooldown de um grupo específico (útil para testes ou reset manual)
   */
  resetCooldown(groupJid) {
    if (groupJid) {
      this.groupCooldowns.delete(groupJid);
    } else {
      this.groupCooldowns.clear();
    }
  }
}

module.exports = new SocialListeningService();

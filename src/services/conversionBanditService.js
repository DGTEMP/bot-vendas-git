/**
 * =========================================================================
 * 🎰 CONVERSION BANDIT SERVICE - TESTE A/B AUTÔNOMO COM THOMPSON SAMPLING
 * =========================================================================
 * Otimizador algorítmico de argumentos de vendas. Em vez de usar scripts estáticos,
 * o PayBot balanceia Exploração (testar novas abordagens) e Explotação (usar o
 * argumento com maior taxa de conversão comprovada no Pix).
 * =========================================================================
 */

const models = require('../db/models');

class ConversionBanditService {
  /**
   * Seleciona o melhor argumento de venda para a situação
   */
  selectBestPitch(category = 'PITCH_ANGLE') {
    const bestArm = models.getBestBanditArm(category);
    if (!bestArm) {
      return {
        armKey: 'ARM_DEFAULT',
        name: 'Argumento Padrão',
        pitchText: 'Com o PayBot rodando no WhatsApp você fecha pedidos e recebe no Pix 24h por dia no piloto automático.',
        conversionRate: 25.0
      };
    }

    // Registra a impressão do argumento
    models.recordBanditImpression(bestArm.arm_key);

    const convRate = bestArm.impressions > 0
      ? Number(((bestArm.conversions / bestArm.impressions) * 100).toFixed(1))
      : 30.0;

    return {
      armKey: bestArm.arm_key,
      name: bestArm.name,
      pitchText: bestArm.pitch_text,
      impressions: bestArm.impressions,
      conversions: bestArm.conversions,
      conversionRate: convRate
    };
  }

  /**
   * Recompensa o braço vencedor quando o cliente efetiva o pagamento do Pix
   */
  rewardConversion(armKey, revenueBrl = 0) {
    if (!armKey || armKey === 'ARM_DEFAULT') return;
    try {
      models.recordBanditConversion(armKey, revenueBrl);
    } catch (_) {}
  }

  /**
   * Retorna leaderboard dos melhores argumentos para o Painel Web
   */
  getLeaderboard(category = 'PITCH_ANGLE') {
    const arms = models.listBanditArms(category);
    return arms.map(a => ({
      key: a.arm_key,
      name: a.name,
      pitch: a.pitch_text,
      impressions: a.impressions,
      conversions: a.conversions,
      revenueBrl: a.revenue_brl,
      conversionRate: a.impressions > 0 ? Number(((a.conversions / a.impressions) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.conversionRate - a.conversionRate);
  }
}

const conversionBanditService = new ConversionBanditService();
module.exports = conversionBanditService;

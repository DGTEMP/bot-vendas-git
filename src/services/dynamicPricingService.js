/**
 * =========================================================================
 * 📊 DYNAMIC PRICING SERVICE - ELASTICIDADE & OFERTA ADAPTATIVA POR LEAD
 * =========================================================================
 * Analisa sinais multi-dimensionais do lead (DDD regional, vocabulário corporativo
 * vs popular, dispositivo móvel e velocidade de resposta) para modular a
 * ancoragem e oferta de forma 100% matemática, maximizando o LTV e o ticket médio.
 * =========================================================================
 */

const models = require('../db/models');

class DynamicPricingService {
  constructor() {
    this.tier1Ddds = ['11', '21', '48', '31', '41', '61', '19', '16', '47', '27']; // Alta renda média per capita
    this.tier2Ddds = ['51', '81', '85', '71', '62', '91', '92', '12', '13', '14', '15'];
  }

  /**
   * Avalia a elasticidade do lead e sugere a estratégia ótima de fechamento.
   */
  evaluateLeadProfile({ phone, name = '', userAgent = '', recentText = '', pastTurns = [] }) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const ddd = cleanPhone.slice(2, 4) || cleanPhone.slice(0, 2);

    let purchasingPowerScore = 0.50; // Base neutra (0.0 a 1.0)
    const signals = [];

    // 1. Sinal Geográfico (DDD)
    if (this.tier1Ddds.includes(ddd)) {
      purchasingPowerScore += 0.20;
      signals.push(`DDD ${ddd} (Polo de Alto Poder Aquisitivo)`);
    } else if (this.tier2Ddds.includes(ddd)) {
      purchasingPowerScore += 0.08;
      signals.push(`DDD ${ddd} (Capital Regional / Polo Comercial)`);
    }

    // 2. Sinal de Dispositivo (se lead navegou na vitrine web)
    const lowUa = String(userAgent || '').toLowerCase();
    if (lowUa.includes('iphone') || lowUa.includes('ipad') || lowUa.includes('macintosh')) {
      purchasingPowerScore += 0.15;
      signals.push('Dispositivo Apple iOS/macOS');
    }

    // 3. Sinal Semântico e Vocabulário (Linguagem Corporativa vs Sensibilidade a Preço)
    const fullText = (recentText + ' ' + pastTurns.map(t => t.text || '').join(' ')).toLowerCase();

    const corporateWords = ['empresa', 'equipe', 'escala', 'faturamento', 'opera[cç][aã]o', 'gestor', 'cnpj', 'nota fiscal', 'sócio', 'alto volume'];
    const corporateMatches = corporateWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(fullText));
    if (corporateMatches.length > 0) {
      purchasingPowerScore += Math.min(0.25, corporateMatches.length * 0.10);
      signals.push(`Linguagem Corporativa (${corporateMatches.slice(0, 3).join(', ')})`);
    }

    const priceSensitiveWords = ['desconto', 'parcela', 'mais barato', 'sem grana', 'apertad', 'menor valor', 'chora', 'caro', 'salgado'];
    const sensitiveMatches = priceSensitiveWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(fullText));
    if (sensitiveMatches.length > 0) {
      purchasingPowerScore -= Math.min(0.30, sensitiveMatches.length * 0.12);
      signals.push(`Sensibilidade a Preço (${sensitiveMatches.slice(0, 3).join(', ')})`);
    }

    // Normaliza entre 0.10 e 0.98
    purchasingPowerScore = Math.max(0.10, Math.min(0.98, purchasingPowerScore));

    // Define Estratégia Recomendada
    let recommendedStrategy = 'STANDARD_ROI';
    let suggestedOffer = 'Plano Padrão com Ancoragem de ROI';
    let suggestedDiscountPercent = 0;

    if (purchasingPowerScore >= 0.75) {
      recommendedStrategy = 'HIGH_TICKET_UPSELL';
      suggestedOffer = 'Combo VIP Vitalício + 1 Sub-Bot Gerente + Setup Prioritário';
      suggestedDiscountPercent = 0;
    } else if (purchasingPowerScore <= 0.40) {
      recommendedStrategy = 'ENTRY_FAST_DISCOUNT';
      suggestedOffer = 'Ancoragem de Preço Oficial com Cupom Surpresa de 15% válido por 20 minutos';
      suggestedDiscountPercent = 15;
    }

    return {
      phone: cleanPhone,
      ddd,
      purchasingPowerScore: Number(purchasingPowerScore.toFixed(2)),
      elasticity: Number((1.0 - purchasingPowerScore).toFixed(2)), // Elasticidade inversa ao poder de compra
      recommendedStrategy,
      suggestedOffer,
      suggestedDiscountPercent,
      signals
    };
  }
}

const dynamicPricingService = new DynamicPricingService();
module.exports = dynamicPricingService;

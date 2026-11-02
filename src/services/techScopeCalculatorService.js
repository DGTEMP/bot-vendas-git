class TechScopeCalculatorService {
  constructor() {
    this.categories = {
      SOFTWARE: { name: 'Software Sob Medida (Web / SaaS)', basePrice: 3500, baseDays: 14, defaultStack: 'Node.js, Vue/React, SQLite/PostgreSQL, WebSockets' },
      APP_MOBILE: { name: 'Aplicativo Mobile (iOS & Android)', basePrice: 4900, baseDays: 21, defaultStack: 'React Native / Flutter, Node.js API, Firebase' },
      AI_AGENT: { name: 'Agente de IA Consultivo & Automação', basePrice: 2900, baseDays: 10, defaultStack: 'Gemini API, Node.js, Baileys WhatsApp, SQLite Vetorial' },
      HARDWARE_IOT: { name: 'Hardware, IoT & Telemetria em Nuvem', basePrice: 4200, baseDays: 21, defaultStack: 'ESP32 / Raspberry, MQTT Broker, Node.js, Web Dashboard' },
      SITE_PORTAL: { name: 'Portal Institucional & Landing Page', basePrice: 1800, baseDays: 7, defaultStack: 'TailwindCSS, Vanilla JS, HTML5, CDN Cloudflare' },
      SEO_TUNING: { name: 'SEO Técnico & Otimização de Performance', basePrice: 1400, baseDays: 7, defaultStack: 'Lighthouse, Schema.org, Search Console, Cache Tuning' },
      METEORIC: { name: 'Máquina de Lançamento Meteórico', basePrice: 2500, baseDays: 10, defaultStack: 'Baileys Multi-Device, Checkout Pix, Grupos VIP' }
    };

    this.addonModules = {
      pix_gateway: { name: 'Gateway Pix Automático com Webhook & Baixa Imediata', price: 600, days: 2 },
      whatsapp_bot: { name: 'Motor WhatsApp (Baileys) com Menus & Resposta Automática', price: 900, days: 3 },
      realtime_web_panel: { name: 'Painel Web Administrativo em Tempo Real (WebSockets)', price: 800, days: 3 },
      ai_integration: { name: 'Integração com LLM (Gemini / OpenAI) & Prompts Consultivos', price: 1200, days: 4 },
      auth_rbac: { name: 'Autenticação Segura com Níveis de Acesso (RBAC) e 2FA', price: 500, days: 2 },
      docker_ci_cd: { name: 'Deploy Automatizado com Docker, SSL & Ambientes Staging', price: 400, days: 1 }
    };

    this.complexityMultipliers = {
      BASIC: { name: 'Básica (SQLite, Monólito Otimizado)', multiplier: 1.0, days: 0 },
      INTERMEDIATE: { name: 'Intermediária (PostgreSQL, Cache Redis, Filas)', multiplier: 1.25, days: 4 },
      ADVANCED: { name: 'Avançada (Microsserviços, Alta Disponibilidade, Failover)', multiplier: 1.6, days: 8 }
    };

    this.slaTiers = {
      STANDARD: { name: 'Garantia Padrão (30 Dias)', price: 0 },
      PROFESSIONAL: { name: 'Profissional (90 Dias + Monitoramento Proativo)', price: 800 },
      ENTERPRISE: { name: 'Enterprise (1 Ano + Suporte Prioritário SLA 2h)', price: 2400 }
    };
  }

  /**
   * Executa o cálculo completo de escopo, preço, dias e entregáveis
   */
  calculate(options = {}) {
    const categoryKey = (options.category || 'SOFTWARE').toUpperCase();
    const category = this.categories[categoryKey] || this.categories.SOFTWARE;

    const complexityKey = (options.complexity || 'BASIC').toUpperCase();
    const complexity = this.complexityMultipliers[complexityKey] || this.complexityMultipliers.BASIC;

    const slaKey = (options.slaTier || 'STANDARD').toUpperCase();
    const sla = this.slaTiers[slaKey] || this.slaTiers.STANDARD;

    // Soma módulos selecionados
    const selectedAddons = [];
    let addonsPrice = 0;
    let addonsDays = 0;

    const requestedAddons = Array.isArray(options.addons) ? options.addons : [];
    for (const key of requestedAddons) {
      if (this.addonModules[key]) {
        const mod = this.addonModules[key];
        selectedAddons.push({ key, name: mod.name, price: mod.price, days: mod.days });
        addonsPrice += mod.price;
        addonsDays += mod.days;
      }
    }

    // Aplica multiplicador de complexidade à base
    const baseWithComplexity = Math.round(category.basePrice * complexity.multiplier);
    const subtotal = baseWithComplexity + addonsPrice + sla.price;

    let totalDays = Math.round((category.baseDays + complexity.days + addonsDays));
    let rushFee = 0;

    if (options.rushDelivery) {
      // Sprint urgente: +35% no valor, reduz prazo em 40% (mínimo 3 dias)
      rushFee = Math.round(subtotal * 0.35);
      totalDays = Math.max(3, Math.round(totalDays * 0.6));
    }

    const totalInvestmentBrl = subtotal + rushFee;
    const timelineWeeks = Math.max(1, Math.ceil(totalDays / 7));

    // Gera lista de entregáveis recomendados
    const deliverables = [
      {
        title: `Módulo Central: ${category.name}`,
        desc: `Desenvolvimento core utilizando a stack recomendada: ${category.defaultStack}.`
      },
      {
        title: `Infraestrutura & Banco de Dados (${complexity.name})`,
        desc: `Camada de persistência otimizada com índices para máxima escalabilidade e latência mínima.`
      }
    ];

    selectedAddons.forEach(a => {
      deliverables.push({
        title: a.name,
        desc: `Integração homologada com testes ponta a ponta e documentação de operação.`
      });
    });

    deliverables.push({
      title: `Garantia & Suporte Técnico (${sla.name})`,
      desc: `Cobertura técnica completa contra bugs ou não-conformidades de escopo.`
    });

    // Gera cronograma de sprints
    const milestones = [
      { phase: 'Sprint 1 (Kick-off & MVP)', percentage: '30%', days: Math.max(2, Math.round(totalDays * 0.3)), desc: 'Modelagem do banco, rotas de API e layout inicial' },
      { phase: 'Sprint 2 (Funcionalidades & Integrações)', percentage: '50%', days: Math.max(2, Math.round(totalDays * 0.5)), desc: 'Módulos adicionais, gateways e regras de negócio' },
      { phase: 'Sprint 3 (Homologação, Testes & Go-Live)', percentage: '20%', days: Math.max(1, Math.round(totalDays * 0.2)), desc: 'Deploy em produção, testes de carga e entrega' }
    ];

    return {
      category: categoryKey,
      categoryName: category.name,
      complexity: complexityKey,
      complexityName: complexity.name,
      slaTier: slaKey,
      slaName: sla.name,
      selectedAddons,
      rushDelivery: Boolean(options.rushDelivery),
      pricingBreakdown: {
        basePrice: category.basePrice,
        baseWithComplexity,
        addonsPrice,
        slaPrice: sla.price,
        rushFee,
        totalInvestmentBrl
      },
      timeline: {
        totalDays,
        timelineWeeks,
        milestones
      },
      recommendedTechStack: category.defaultStack,
      deliverables
    };
  }

  /**
   * Converte o resultado do cálculo para formato de proposta comercial pronta para salvar
   */
  exportToProposalData(calcResult, leadData = {}) {
    return {
      lead_phone: leadData.lead_phone || '',
      lead_name: leadData.lead_name || 'Cliente Consultoria',
      lead_company: leadData.lead_company || '',
      project_title: `${calcResult.categoryName} - Escopo Técnico`,
      category: calcResult.category,
      scope_description: `Projeto sob medida de ${calcResult.categoryName} com complexidade ${calcResult.complexityName} e garantia ${calcResult.slaName}.`,
      deliverables: calcResult.deliverables,
      tech_stack: calcResult.recommendedTechStack,
      timeline_weeks: calcResult.timeline.timelineWeeks,
      investment_brl: calcResult.pricingBreakdown.totalInvestmentBrl,
      payment_terms: '50% entrada via Pix + 50% na homologação final e entrega do código-fonte',
      notes: `Orçamento calculado automaticamente. Dias estimados: ${calcResult.timeline.totalDays} dias úteis.`
    };
  }
}

module.exports = new TechScopeCalculatorService();

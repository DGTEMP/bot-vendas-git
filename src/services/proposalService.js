const models = require('../db/models');

class ProposalService {
  constructor() {
    this.categoryPresets = {
      SOFTWARE: {
        category: 'SOFTWARE',
        project_title: 'Software Sob Medida & Painel de Gestão em Tempo Real',
        scope_description: 'Desenvolvimento de arquitetura full-stack sob medida com banco de dados de alta performance, painel web responsivo, autenticação segura e automações operacionais.',
        tech_stack: 'Node.js, Vue.js/React, SQLite/PostgreSQL, WebSockets, Docker',
        timeline_weeks: 3,
        investment_brl: 4800.0,
        payment_terms: '50% de entrada via Pix no kick-off + 50% na homologação final e entrega do código-fonte',
        deliverables: [
          { title: 'Arquitetura Backend & Banco de Dados', desc: 'Modelagem relacional otimizada, índices de alta performance e rotinas transacionais seguras.' },
          { title: 'Painel Web Administrativo', desc: 'Interface moderna, responsiva, com métricas em tempo real e controles de acesso (RBAC).' },
          { title: 'APIs REST & Webhooks', desc: 'Endpoints documentados para integrações externas e automação contínua.' },
          { title: 'Documentação & Deploy Staging/Produção', desc: 'Deploy conteinerizado em Docker, scripts de inicialização e manual de operação.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Propriedade Intelectual', text: 'Após a quitação integral dos valores acordados, a CONTRATANTE terá a titularidade total e irrestrita dos códigos-fonte desenvolvidos exclusivamente para o projeto.' },
          { clause: 'Cláusula 2 - Garantia & SLA de Suporte', text: 'O projeto conta com garantia técnica incondicional de 90 (noventa) dias contra quaisquer bugs ou não-conformidades de escopo, com SLA de resposta em até 4 horas úteis.' },
          { clause: 'Cláusula 3 - Confidencialidade (NDA)', text: 'Ambas as partes comprometem-se com o sigilo absoluto de quaisquer dados estratégicos, modelos de negócio ou informações confidenciais compartilhadas.' },
          { clause: 'Cláusula 4 - Homologação & Aceite', text: 'A CONTRATANTE terá prazo de 5 (cinco) dias úteis após o deploy em ambiente de homologação para validação e testes integrados dos entregáveis.' }
        ]
      },
      APP_MOBILE: {
        category: 'APP_MOBILE',
        project_title: 'Aplicativo Mobile Personalizado (iOS & Android)',
        scope_description: 'Aplicativo nativo/híbrido com alta performance, suporte a notificações push, integração com gateway de pagamento Pix e sincronização em tempo real.',
        tech_stack: 'React Native / Flutter, Node.js API, Firebase Cloud Messaging, SQLite/Postgres',
        timeline_weeks: 4,
        investment_brl: 6500.0,
        payment_terms: '50% entrada via Pix + 50% na publicação nas lojas ou entrega dos builds (APK / IPA)',
        deliverables: [
          { title: 'Aplicativo Mobile iOS & Android', desc: 'Telas fluidas, UI/UX intuitiva e navegação nativa.' },
          { title: 'Integração de Notificações Push', desc: 'Disparos segmentados de alertas para retenção de usuários.' },
          { title: 'Gateway Pix & Autenticação', desc: 'Checkout integrado e login social / biometria.' },
          { title: 'Builds de Produção & Publicação', desc: 'Geração de APK/AAB e IPA prontos para distribuição.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Entrega e Código-Fonte', text: 'Entrega do repositório Git completo com assets, documentação de build e instruções de compilação.' },
          { clause: 'Cláusula 2 - Garantia de Funcionamento', text: 'Garantia técnica de 90 dias cobrindo compatibilidade com versões correntes do Android e iOS.' },
          { clause: 'Cláusula 3 - Sigilo Comercial', text: 'Cláusula de confidencialidade mútua sobre a base de usuários e regras de negócio do aplicativo.' }
        ]
      },
      AI_AGENT: {
        category: 'AI_AGENT',
        project_title: 'Agente de IA Consultivo & Automação Cognitiva de Vendas',
        scope_description: 'Implantação de agente inteligente com memória episódica, motor anti-voz robótica, qualificação automática de leads e integração direta com WhatsApp e CRM.',
        tech_stack: 'Node.js, Gemini API / OpenAI, Baileys WhatsApp Engine, SQLite Vetorial / Memória Cognitiva',
        timeline_weeks: 2,
        investment_brl: 3900.0,
        payment_terms: '50% entrada via Pix + 50% após homologação dos fluxos de atendimento',
        deliverables: [
          { title: 'Configuração do Agente Cognitivo', desc: 'Treinamento sobre o catálogo de produtos/serviços, precificação e regras de negócio da empresa.' },
          { title: 'Motor Anti-AI Voice & Humanização', desc: 'Eliminação de frases genéricas e clichês robóticos; tom de consultor sênior de tecnologia.' },
          { title: 'Pipeline de Memória Episódica', desc: 'Armazenamento persistente de preferências, histórico de orçamentos e objeções do lead.' },
          { title: 'Dashboard de Monitoramento & Live Relay', desc: 'Painel web com telemetria de conversão, intervenção humana em 1 clique e logs auditáveis.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Privacidade de Dados & LGPD', text: 'As conversas e dados dos clientes são armazenados localmente e criptografados, em estrita conformidade com a LGPD.' },
          { clause: 'Cláusula 2 - Ajustes Finos de Prompt', text: 'Inclusos 30 dias de acompanhamento e refinamento diário dos prompts e gatilhos de conversão.' }
        ]
      },
      HARDWARE_IOT: {
        category: 'HARDWARE_IOT',
        project_title: 'Solução Integrada de Hardware, IoT & Telemetria em Nuvem',
        scope_description: 'Desenvolvimento de firmware sob medida para microcontroladores (ESP32/Raspberry Pi), protocolo de comunicação MQTT/WebSockets e telemetria em nuvem.',
        tech_stack: 'C++ / MicroPython, ESP32, MQTT Broker, Node.js Backend, Grafana / Web Dashboard',
        timeline_weeks: 4,
        investment_brl: 5400.0,
        payment_terms: '50% entrada via Pix + 50% na validação do protótipo funcional',
        deliverables: [
          { title: 'Firmware Otimizado', desc: 'Código embarcado com baixo consumo de energia, reconexão automática de Wi-Fi e watchdog.' },
          { title: 'Broker MQTT & Ingestão de Dados', desc: 'Camada de ingestão de telemetria com alta taxa de amostragem e persistência em banco de dados.' },
          { title: 'Dashboard de Telemetria ao Vivo', desc: 'Painel visual com gráficos de sensores, alertas de limite e acionamento remoto de relés/atuadores.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Entrega de Firmware & Esquemas', text: 'Fornecimento dos diagramas de ligação, código-fonte do firmware e lista de componentes (BOM).' }
        ]
      },
      SITE_PORTAL: {
        category: 'SITE_PORTAL',
        project_title: 'Portal Institucional de Alta Performance & Conversão',
        scope_description: 'Website de alto impacto visual, nota 95+ no Google PageSpeed, estrutura semântica otimizada para SEO e integração com WhatsApp.',
        tech_stack: 'HTML5 Moderno, TailwindCSS, Vanilla JS / Astro, Otimização de Imagens WebP',
        timeline_weeks: 2,
        investment_brl: 2500.0,
        payment_terms: '50% entrada via Pix + 50% na publicação no domínio oficial',
        deliverables: [
          { title: 'Design Exclusivo & Responsivo', desc: 'Interface personalizada alinhada à identidade visual da marca, adaptada para celular e desktop.' },
          { title: 'Otimização Core Web Vitals', desc: 'Carregamento instantâneo em menos de 1 segundo e nota máxima de acessibilidade.' },
          { title: 'Copywriting Persuasivo Tech', desc: 'Textos orientados a conversão focados nos diferenciais técnicos dos serviços ofertados.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Publicação & Certificado SSL', text: 'Inclusa configuração de DNS, CDN Cloudflare e emissão de certificado SSL seguro.' }
        ]
      },
      SEO_TUNING: {
        category: 'SEO_TUNING',
        project_title: 'Consultoria de SEO Técnico, Indexação & Otimização de Performance',
        scope_description: 'Diagnóstico profundo de gargalos de SEO, reestruturação de tags semânticas, dados estruturados Schema.org e plano de posicionamento orgânico.',
        tech_stack: 'Google Search Console, Schema.org, Lighthouse, Node.js Analyzer',
        timeline_weeks: 2,
        investment_brl: 1900.0,
        payment_terms: '100% Pix no kick-off ou 2x de 50%',
        deliverables: [
          { title: 'Auditoria Técnica Completa', desc: 'Relatório de erros de rastreamento, links quebrados e oportunidades de palavras-chave.' },
          { title: 'Implementação de Schema.org', desc: 'Injeção de microdados de produto, organização, FAQ e avaliações nos motores de busca.' },
          { title: 'Plano de Ação para Google Search', desc: 'Guia prático de produção de conteúdo técnico com autoridade de domínio.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Relatório Comparativo', text: 'Entrega de relatório antes/depois de pontuação de SEO e métricas de rastreabilidade.' }
        ]
      },
      METEORIC: {
        category: 'METEORIC',
        project_title: 'Máquina de Lançamento Meteórico Automatizado no WhatsApp',
        scope_description: 'Estruturação de funil de antecipação, aquecimento e fechamento relâmpago em grupos VIP de WhatsApp com bot autônomo e gateway Pix instantâneo.',
        tech_stack: 'Baileys Multi-Device, Motor Meteórico, Pix Dinâmico, Dashboard de Conversão',
        timeline_weeks: 2,
        investment_brl: 3500.0,
        payment_terms: '50% entrada via Pix + 50% no dia de abertura do carrinho',
        deliverables: [
          { title: 'Script de 4 Fases do Lançamento', desc: 'Mensagens pré-programadas de Antecipação, Aquecimento, Revelação de Oferta e Fechamento.' },
          { title: 'Gestão Automática de Grupos VIP', desc: 'Abertura e fechamento de chat dos grupos em horários agendados de pico de engajamento.' },
          { title: 'Checkout Pix Automático com Entrega Imediata', desc: 'Geração de QR Code Pix e entrega instantânea de credenciais ou produtos.' }
        ],
        contract_clauses: [
          { clause: 'Cláusula 1 - Suporte em Tempo Real', text: 'Acompanhamento do especialista técnico durante todo o dia de abertura do carrinho.' }
        ]
      }
    };
  }

  /**
   * Cria uma proposta comercial com base na categoria ou dados customizados
   */
  generateProposal(leadPhone, customData = {}) {
    const category = (customData.category || 'SOFTWARE').toUpperCase();
    const preset = this.categoryPresets[category] || this.categoryPresets.SOFTWARE;

    const proposalData = {
      lead_phone: leadPhone,
      lead_name: customData.lead_name || 'Cliente Consultoria',
      lead_company: customData.lead_company || '',
      project_title: customData.project_title || preset.project_title,
      category,
      scope_description: customData.scope_description || preset.scope_description,
      deliverables: customData.deliverables || preset.deliverables,
      tech_stack: customData.tech_stack || preset.tech_stack,
      timeline_weeks: customData.timeline_weeks || preset.timeline_weeks,
      investment_brl: customData.investment_brl !== undefined ? Number(customData.investment_brl) : preset.investment_brl,
      payment_terms: customData.payment_terms || preset.payment_terms,
      contract_clauses: customData.contract_clauses || preset.contract_clauses,
      status: customData.status || 'SENT',
      notes: customData.notes || 'Gerado via Módulo Comercial Consultivo'
    };

    return models.createProposal(proposalData);
  }

  /**
   * Gera a mensagem do WhatsApp para enviar a proposta ao lead
   */
  generateWhatsAppShareMessage(proposal, baseUrl = '') {
    const rawName = (proposal.lead_name || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName);
    const nameGreet = isGeneric ? 'Olá!' : `Olá, *${rawName.split(' ')[0]}*!`;
    const proposalUrl = `${baseUrl.replace(/\/$/, '')}/proposta/${proposal.token}`;
    const valueFormatted = Number(proposal.investment_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    return (
      `📄 *PROPOSTA COMERCIAL & CRONOGRAMA TÉCNICO* 🚀\n\n` +
      `${nameGreet} Conforme alinhamos, montei o escopo técnico completo e cronograma para o seu projeto: *${proposal.project_title}*.\n\n` +
      `📌 *Código:* \`${proposal.code}\`\n` +
      `⏱️ *Prazo de Entrega Estimado:* ${proposal.timeline_weeks} semanas\n` +
      `💰 *Investimento:* R$ ${valueFormatted}\n` +
      `💳 *Condições:* ${proposal.payment_terms}\n\n` +
      `🔗 *Acesse a proposta interativa e minuta do contrato no link exclusivo:*\n` +
      `${proposalUrl}\n\n` +
      `No link você pode revisar todos os entregáveis técnicos, cronograma de sprints e efetuar o aceite digital para iniciarmos o protótipo imediatamente.\n\n` +
      `Qualquer ajuste no escopo, estou 100% à disposição aqui!`
    );
  }

  /**
   * Renderiza a página web executiva e elegante da proposta (/proposta/:token)
   */
  renderProposalHtml(proposal, baseUrl = '') {
    const valueFormatted = Number(proposal.investment_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const isAccepted = proposal.status === 'ACCEPTED';
    const statusBadge = isAccepted
      ? `<span class="badge accepted">✅ PROPOSTA ACEITA EM ${new Date(proposal.accepted_at || Date.now()).toLocaleDateString('pt-BR')}</span>`
      : `<span class="badge sent">⏳ PROPOSTA EM ABERTO</span>`;

    const deliverablesHtml = (proposal.deliverables || []).map((item, idx) => `
      <div class="deliverable-card">
        <div class="deliverable-num">0${idx + 1}</div>
        <div class="deliverable-info">
          <h4>${this._escape(item.title || '')}</h4>
          <p>${this._escape(item.desc || '')}</p>
        </div>
      </div>
    `).join('');

    const clausesHtml = (proposal.contract_clauses || []).map(item => `
      <div class="clause-item">
        <h5>${this._escape(item.clause || '')}</h5>
        <p>${this._escape(item.text || '')}</p>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposta Comercial - ${this._escape(proposal.code)} | ${this._escape(proposal.project_title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(23, 32, 54, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --primary-gradient: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
      --success: #10b981;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      line-height: 1.6;
      padding: 30px 20px;
      min-height: 100vh;
      background-image: 
        radial-gradient(at 10% 20%, rgba(56, 189, 248, 0.08) 0px, transparent 50%),
        radial-gradient(at 90% 80%, rgba(99, 102, 241, 0.08) 0px, transparent 50%);
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 15px;
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      font-size: 12px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 999px;
      letter-spacing: 0.5px;
    }
    .badge.sent { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .badge.accepted { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }

    .hero-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      border-radius: 20px;
      padding: 35px;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
    }
    .hero-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--primary-gradient);
    }
    .code-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--primary);
      margin-bottom: 8px;
    }
    h1 {
      font-size: 28px;
      font-weight: 800;
      line-height: 1.25;
      margin-bottom: 15px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
      margin-top: 25px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .meta-item .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-item .value {
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      margin-top: 2px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-title::before {
      content: '';
      width: 4px;
      height: 18px;
      background: var(--primary);
      border-radius: 2px;
    }

    .deliverables-grid {
      display: grid;
      gap: 14px;
      margin-bottom: 35px;
    }
    .deliverable-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 22px;
      display: flex;
      gap: 18px;
      align-items: flex-start;
    }
    .deliverable-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 16px;
      font-weight: 700;
      color: var(--primary);
      background: rgba(56, 189, 248, 0.1);
      padding: 6px 12px;
      border-radius: 8px;
    }
    .deliverable-info h4 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .deliverable-info p {
      font-size: 14px;
      color: var(--text-muted);
    }

    .investment-box {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 18px;
      padding: 30px;
      margin-bottom: 35px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }
    .investment-val {
      font-size: 36px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: -1px;
    }
    .investment-terms {
      font-size: 14px;
      color: var(--text-muted);
      max-width: 420px;
    }

    .contract-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 25px;
      margin-bottom: 35px;
    }
    .clause-item {
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .clause-item:last-child { border-bottom: none; }
    .clause-item h5 {
      font-size: 14px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 4px;
    }
    .clause-item p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .action-bar {
      display: flex;
      gap: 15px;
      justify-content: center;
      margin-top: 40px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      transition: all 0.2s ease;
      border: none;
    }
    .btn-primary {
      background: var(--primary-gradient);
      color: #fff;
      box-shadow: 0 4px 20px rgba(56, 189, 248, 0.3);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(56, 189, 248, 0.45);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    @media print {
      body { background: #fff !important; color: #111 !important; padding: 0 !important; }
      .container { max-width: 100% !important; }
      .hero-card, .deliverable-card, .contract-box, .investment-box {
        background: #fff !important; border: 1px solid #ccc !important; color: #111 !important;
        page-break-inside: avoid;
      }
      .deliverable-info p, .clause-item p, .meta-item .label, .investment-terms { color: #444 !important; }
      .meta-item .value, h1, h4, h5 { color: #000 !important; }
      .investment-val { color: #0284c7 !important; }
      .action-bar { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <div class="brand">PROPOSTA COMERCIAL & CONTRATO TÉCNICO</div>
      <div>${statusBadge}</div>
    </div>

    <div class="hero-card">
      <div class="code-tag">${this._escape(proposal.code)}</div>
      <h1>${this._escape(proposal.project_title)}</h1>
      <p style="color: var(--text-muted); font-size: 15px; margin-top: 8px;">
        ${this._escape(proposal.scope_description || '')}
      </p>

      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Cliente / Solicitante</div>
          <div class="value">${this._escape(proposal.lead_name || 'Lead')}${proposal.lead_company ? ' (' + this._escape(proposal.lead_company) + ')' : ''}</div>
        </div>
        <div class="meta-item">
          <div class="label">Prazo de Execução</div>
          <div class="value">${proposal.timeline_weeks} semanas (Sprints Dedicados)</div>
        </div>
        <div class="meta-item">
          <div class="label">Stack Tecnológica</div>
          <div class="value">${this._escape(proposal.tech_stack || 'Node.js / React')}</div>
        </div>
        <div class="meta-item">
          <div class="label">Data de Emissão</div>
          <div class="value">${new Date(proposal.created_at || Date.now()).toLocaleDateString('pt-BR')}</div>
        </div>
      </div>
    </div>

    <div class="section-title">Escopo & Entregáveis Técnicos</div>
    <div class="deliverables-grid">
      ${deliverablesHtml}
    </div>

    <div class="section-title">Investimento & Condições Comerciais</div>
    <div class="investment-box">
      <div>
        <div style="font-size: 13px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">Valor Total do Projeto</div>
        <div class="investment-val">R$ ${valueFormatted}</div>
      </div>
      <div class="investment-terms">
        <strong style="color: #fff; display: block; margin-bottom: 4px;">Condições de Pagamento:</strong>
        ${this._escape(proposal.payment_terms || '50% entrada via Pix + 50% na homologação')}
      </div>
    </div>

    <div class="section-title">Minuta de Contrato & Garantia Técnica</div>
    <div class="contract-box">
      ${clausesHtml}
    </div>

    <div class="action-bar">
      ${!isAccepted ? `
        <button class="btn btn-primary" id="btnAccept" onclick="acceptProposal('${proposal.token}')">
          ✍️ Aceitar Proposta & Iniciar Projeto
        </button>
      ` : `
        <div style="color: var(--success); font-weight: 700; font-size: 16px; padding: 12px 24px; background: rgba(16, 185, 129, 0.1); border-radius: 12px;">
          🎉 Proposta Aceita com Sucesso! Projeto em Fase de Execução.
        </div>
      `}
      <button class="btn btn-secondary" onclick="window.print()">
        🖨️ Salvar como PDF / Imprimir
      </button>
      <a class="btn btn-secondary" href="https://wa.me/55${proposal.lead_phone.replace(/\D/g, '')}?text=Ol%C3%A1%2C%20estou%20revisando%20a%20proposta%20${encodeURIComponent(proposal.code)}" target="_blank">
        💬 Dúvidas no WhatsApp
      </a>
    </div>
  </div>

  <script>
    async function acceptProposal(token) {
      if (!confirm('Deseja confirmar o aceite digital desta proposta comercial e iniciar o projeto?')) return;
      const btn = document.getElementById('btnAccept');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Processando Aceite Digital...';
      }
      try {
        const res = await fetch('/api/proposals/' + token + '/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ${JSON.stringify(proposal.lead_name || 'Cliente')} })
        });
        const data = await res.json();
        if (data.success) {
          alert('🎉 Parabéns! Proposta aceita digitalmente com sucesso. Nossa equipe iniciará o kick-off do projeto imediatamente!');
          window.location.reload();
        } else {
          alert('Erro ao aceitar: ' + (data.error || 'Tente novamente'));
          if (btn) { btn.disabled = false; btn.innerText = '✍️ Aceitar Proposta & Iniciar Projeto'; }
        }
      } catch (err) {
        alert('Falha na comunicação: ' + err.message);
        if (btn) { btn.disabled = false; btn.innerText = '✍️ Aceitar Proposta & Iniciar Projeto'; }
      }
    }
  </script>
</body>
</html>`;
  }

  _escape(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

module.exports = new ProposalService();

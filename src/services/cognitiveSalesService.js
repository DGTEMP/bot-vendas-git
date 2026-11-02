const models = require('../db/models');
const config = require('../config');

class CognitiveSalesService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || config.ai?.endpoint || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || config.ai?.key || 'sk-antigravity-master-key';

    // Lista de padrões artificiais de IA proibidos no modo humanizado
    this.forbiddenAiClichés = [
      /com certeza(?:,|!)?/gi,
      /hoje [eé] o seu dia de sorte(?:,|!)?/gi,
      /maravilha(?:,|!)?/gi,
      /sensacional(?:,|!)?/gi,
      /excelente escolha(?:,|!)?/gi,
      /fique tranquilo(?:\(a\))?(?:,|!)?/gi,
      /posso te ajudar com isso/gi,
      /estou aqui para te ajudar/gi,
      /n[aã]o hesite em perguntar/gi,
      /como posso ser [uú]til/gi,
      /essa [eé] uma excelente pergunta/gi,
      /com grande satisfa[cç][aã]o/gi,
      /espero que esta mensagem o encontre bem/gi,
      /sem mais delongas/gi
    ];
  }

  // ==============================================================
  // 1. MOTOR DE HUMANIZAÇÃO DE RESPOSTAS (ANTI-AI VOICE)
  // ==============================================================
  humanizeResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let humanized = text;

    // Remove clichês artificiais de robô
    for (const pattern of this.forbiddenAiClichés) {
      humanized = humanized.replace(pattern, '').trim();
    }

    // Reduz excessos de exclamações consecutivas (ex: "!!!" -> ".")
    humanized = humanized.replace(/!{2,}/g, '.');

    // Modera excesso de emojis para manter postura de consultoria sênior (máximo 1 ou 2 por mensagem)
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const emojis = humanized.match(emojiRegex);
    if (emojis && emojis.length > 3) {
      let count = 0;
      humanized = humanized.replace(emojiRegex, (match) => {
        count++;
        return count <= 2 ? match : '';
      });
    }

    // Ajusta espaços e pontuações remanescentes
    humanized = humanized
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:?!])/g, '$1')
      .replace(/^([.,;:?!])\s*/g, '')
      .trim();

    // Garante primeira letra maiúscula
    if (humanized.length > 0) {
      humanized = humanized.charAt(0).toUpperCase() + humanized.slice(1);
    }

    return humanized;
  }

  // ==============================================================
  // 2. EXTRAÇÃO DE CRENÇAS, MEMÓRIAS & LEAD SCORING BASEADO EM EVIDÊNCIAS
  // ==============================================================
  analyzeAndExtractProfile(phone, name, messageText) {
    if (!phone || !messageText) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const text = String(messageText).trim();
    const lower = text.toLowerCase();

    // Obtém ou inicializa perfil existente
    let profile = models.getLeadCognitiveProfile(cleanPhone);
    if (!profile) {
      profile = models.upsertLeadCognitiveProfile(cleanPhone, {
        name: name || 'Lead Consultoria',
        buying_stage: 'DESCOBERTA',
        readiness_score: 30
      });
    }

    const updates = {};
    const beliefsToUpdate = [];
    const memoriesToAdd = [];

    // --- A. Nicho de Atuação da Empresa ---
    const nichePatterns = [
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:cl[ií]nica|consult[oó]rio|m[eé]dic|odont|sa[uú]de|paciente)/i, niche: 'Saúde & Clínicas' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:loja|e-?commerce|varejo|roupa|moda|dropshipping|produtos?)/i, niche: 'E-commerce & Varejo' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:imobili[aá]ria|corretor|im[oó]veis|loca[cç][aã]o|aluguel)/i, niche: 'Imobiliário & Construção' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:advocacia|advogado|escrit[oó]rio|jur[ií]dico)/i, niche: 'Jurídico & Serviços' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:restaurante|delivery|lanchonete|pizzaria|hamburgueria|bar)/i, niche: 'Alimentação & Delivery' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:escola|curso|infoproduto|produtor|mentor|lan[cç]amento)/i, niche: 'Educação & Infoprodutos' },
      { regex: /(?:sou|trabalho com|tenho um[a]?|minha|meu)\s*(?:empresa|f[aá]brica|ind[uú]stria|log[ií]stica|transport)/i, niche: 'Indústria & Logística' }
    ];
    for (const np of nichePatterns) {
      if (np.regex.test(text)) {
        updates.company_niche = np.niche;
        beliefsToUpdate.push({ key: 'niche', value: np.niche, evidence: text.slice(0, 100), confidence: 0.85 });
        memoriesToAdd.push({ type: 'REQUIREMENT', summary: `Atua no segmento de ${np.niche}`, excerpt: text });
        break;
      }
    }

    // --- B. Escopo do Projeto & Interesses Técnicos ---
    const scopeInterests = [];
    if (/(?:app|aplicativo|mobile|android|ios|flutter|react native)/i.test(lower)) {
      scopeInterests.push('Aplicativo Mobile sob medida');
    }
    if (/(?:bot|chatbot|ia|intelig[eê]ncia artificial|atendente autom[aá]tico|gemini|openai)/i.test(lower)) {
      scopeInterests.push('Agente de IA & Atendimento');
    }
    if (/(?:site|landing page|portal|painel web|dashboard|sistema web)/i.test(lower)) {
      scopeInterests.push('Site Institucional / Painel Web');
    }
    if (/(?:seo|primeiro no google|otimiza[cç][aã]o|performance|page speed|velocidade)/i.test(lower)) {
      scopeInterests.push('SEO & Tuning de Performance');
    }
    if (/(?:mete[oó]rico|lan[cç]amento|grupos vip|efeito manada)/i.test(lower)) {
      scopeInterests.push('Estrutura de Lançamento Meteórico');
    }
    if (/(?:hardwere|hardware|iot|embarcado|arduino|esp32|placa)/i.test(lower)) {
      scopeInterests.push('Hardware & Soluções IoT');
    }

    if (scopeInterests.length > 0) {
      updates.project_scope = scopeInterests.join(' + ');
      beliefsToUpdate.push({
        key: 'tech_interests',
        value: updates.project_scope,
        evidence: text.slice(0, 100),
        confidence: 0.90
      });
      memoriesToAdd.push({
        type: 'REQUIREMENT',
        summary: `Interesse em: ${updates.project_scope}`,
        excerpt: text
      });
    }

    // --- C. Extração de Orçamento (Budget Tier) ---
    const budgetMatch = text.match(/(?:or[cç]amento|posso pagar|verba|investir|tenho|gastar|at[eé])\s*(?:de|em)?\s*(?:r\$|reais)?\s*([\d.,]+)\s*(?:mil|k)?/i);
    if (budgetMatch) {
      let rawVal = budgetMatch[1].replace(/\./g, '').replace(',', '.');
      let amount = parseFloat(rawVal);
      if (text.toLowerCase().includes('mil') || text.toLowerCase().includes('k')) {
        if (amount < 100) amount = amount * 1000;
      }
      if (!isNaN(amount) && amount > 0) {
        let tier = 'MEDIO';
        if (amount < 1500) tier = 'BAIXO';
        else if (amount >= 1500 && amount <= 5000) tier = 'MEDIO';
        else if (amount > 5000 && amount <= 15000) tier = 'ALTO';
        else tier = 'CORPORATIVO';

        updates.budget_tier = tier;
        updates.budget_confidence = 0.88;
        beliefsToUpdate.push({
          key: 'lead_budget',
          value: `R$ ${amount.toFixed(2)} (${tier})`,
          evidence: text.slice(0, 100),
          confidence: 0.88
        });
        memoriesToAdd.push({
          type: 'BUDGET',
          summary: `Orçamento declarado de ~R$ ${amount.toFixed(2)} (${tier})`,
          excerpt: text,
          importance: 4
        });
      }
    } else if (/(?:caro|puxado|salgado|sem grana|apertado|desconto|abaixa o pre[cç]o)/i.test(lower)) {
      updates.budget_tier = 'BAIXO';
      updates.budget_confidence = 0.70;
      beliefsToUpdate.push({ key: 'lead_budget', value: 'Sensível a Preço (Baixo/Médio)', evidence: text.slice(0, 100), confidence: 0.70 });
    }

    // --- D. Detecção de Objeções Reais ---
    if (/(?:muito caro|pre[cç]o alto|salgado|tem desconto|fora do or[cç]amento|n[aã]o tenho essa grana)/i.test(lower)) {
      updates.main_objection = 'PRECO';
      updates.objection_confidence = 0.85;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Preço / Investimento', evidence: text.slice(0, 100), confidence: 0.85 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Objeção de preço: busca condição modular ou desconto', excerpt: text, importance: 4 });
    } else if (/(?:demora|prazo|urgente|preciso pra ontem|entrega quando|quantos dias|at[eé] o dia|tempo de entrega)/i.test(lower)) {
      updates.main_objection = 'PRAZO';
      updates.objection_confidence = 0.80;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Prazo de Entrega', evidence: text.slice(0, 100), confidence: 0.80 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Objeção/preocupação com cronograma e prazo de entrega', excerpt: text, importance: 4 });
    } else if (/(?:garantia|e se n[aã]o funcionar|contrato|seguro|confi[aá]vel|golpe|suporte depois|manuten[cç][aã]o)/i.test(lower)) {
      updates.main_objection = 'CONFIANCA_GARANTIA';
      updates.objection_confidence = 0.85;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Garantia, Contrato & Suporte', evidence: text.slice(0, 100), confidence: 0.85 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Exige segurança contratual, SLA e garantia de funcionamento', excerpt: text, importance: 4 });
    } else if (/(?:meu s[oó]cio|minha s[oó]cia|diretor|gerente|esposa|marido|conversar com|aprovar com)/i.test(lower)) {
      updates.main_objection = 'DECISOR';
      updates.objection_confidence = 0.80;
      beliefsToUpdate.push({ key: 'decision_maker', value: 'Decisão Compartilhada', evidence: text.slice(0, 100), confidence: 0.80 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Precisa apresentar proposta para sócio ou comitê', excerpt: text, importance: 4 });
    }

    // --- E. Estágio de Compra & Readiness Score ---
    let stage = profile.buying_stage || 'DESCOBERTA';
    let readiness = profile.readiness_score || 30;

    if (/(?:ja fiz o pix|acabei de pagar|ja paguei|comprovante|pagamento feito)/i.test(lower)) {
      stage = 'CONVERTIDO';
      readiness = 100;
      memoriesToAdd.push({ type: 'AGREEMENT', summary: 'Pagamento confirmado e projeto iniciado', excerpt: text, importance: 5 });
    } else if (/(?:manda a chave pix|qual a chave pix|onde fa[cç]o o pix|manda o contrato|quero fechar|como fa[cç]o o pagamento|vamos fechar|fechado ent[aã]o|pode gerar o boleto|passa os dados da empresa)/i.test(lower)) {
      stage = 'FECHAMENTO';
      readiness = Math.max(readiness, 88);
      memoriesToAdd.push({ type: 'AGREEMENT', summary: 'Sinal verde para fechamento, solicitou dados de pagamento', excerpt: text, importance: 5 });
    } else if (updates.main_objection && updates.main_objection !== 'NENHUMA') {
      stage = 'OBJECOES';
      readiness = Math.max(readiness, 65);
    } else if (/(?:quanto custa|qual o valor|or[cç]amento|manda a proposta|tabela de pre[cç]os|quanto fica)/i.test(lower)) {
      stage = 'PROPOSTA';
      readiness = Math.max(readiness, 55);
    } else if (scopeInterests.length > 0 || updates.company_niche) {
      if (stage === 'DESCOBERTA') stage = 'QUALIFICACAO';
      readiness = Math.max(readiness, 45);
    }

    updates.buying_stage = stage;
    updates.readiness_score = readiness;

    // Se o lead forneceu o nome explicitamente
    if (name && name !== 'Lead WhatsApp' && (!profile.name || profile.name === 'Lead WhatsApp')) {
      updates.name = name;
    }

    // Salva perfil atualizado no banco
    const updatedProfile = models.upsertLeadCognitiveProfile(cleanPhone, updates);

    // Salva crenças auditadas
    for (const b of beliefsToUpdate) {
      models.updateLeadBelief(cleanPhone, b.key, b.value, b.evidence, b.confidence);
    }

    // Salva memórias episódicas
    for (const m of memoriesToAdd) {
      models.addLeadEpisodicMemory(cleanPhone, m.type, m.summary, m.excerpt, m.importance || 3);
    }

    return updatedProfile;
  }

  // ==============================================================
  // 3. CONSULTATIVE SALES PLAYBOOKS & GERADOR DE RESPOSTA INTELIGENTE
  // ==============================================================
  async generateConsultativeReply({ phone, name, text, nlpResult, matchedProduct }) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const profile = models.getLeadCognitiveProfile(cleanPhone) || {
      name: name || 'Amigo',
      company_niche: 'Geral',
      project_scope: 'Software & Soluções Tech',
      budget_tier: 'MEDIO',
      buying_stage: 'DESCOBERTA',
      main_objection: 'NENHUMA',
      readiness_score: 35
    };

    const beliefs = models.getLeadBeliefs(cleanPhone);
    const memories = models.getLeadEpisodicMemories(cleanPhone, 5);
    const firstName = (profile.name || name || 'amigo').split(' ')[0];

    // Tenta enriquecer com IA (Gemini / OpenAI API) mantendo persona de Consultor Sênior Tech
    try {
      const memoryContext = memories.map(m => `- [${m.memory_type}]: ${m.fact_summary}`).join('\n');
      const beliefsContext = beliefs.map(b => `- ${b.belief_key}: ${b.belief_value} (confiança: ${(b.confidence * 100).toFixed(0)}%)`).join('\n');

      const systemPrompt =
        `Você é o Consultor Técnico Sênior e Especialista em Soluções de Software, IA, Hardware, SEO e Otimizações da nossa empresa de tecnologia.\n` +
        `Você está conversando no WhatsApp comercial diretamente com o lead.\n` +
        `OBJETIVO: Conduzir uma venda consultiva de alto padrão técnico, demonstrando clareza, autoridade e segurança de entrega.\n\n` +
        `REGRAS ESTRITAS DE COMUNICAÇÃO (ANTI-AI VOICE):\n` +
        `1. NUNCA use frases clichês como "Com certeza!", "Hoje é o seu dia de sorte!", "Maravilha!", "Sensacional!", "Excelente escolha!", "Fique tranquilo!".\n` +
        `2. NUNCA despeje listas enciclopédicas desnecessárias nem exagere em emojis. Máximo de 1 emoji discreto por mensagem.\n` +
        `3. Seja direto, pragmático, objetivo e técnico na medida certa, falando a língua de negócios e retorno sobre investimento (ROI).\n` +
        `4. Utilize a memória do cliente. Se ele já citou escopo, nicho ou prazo anteriormente, faça referência natural a isso para eliminar qualquer "amnésia".\n` +
        `5. Se o cliente tiver uma objeção (preço, prazo ou garantia), responda de frente: mostre modularidade de escopo, cronograma de MVP ou código-fonte sob contrato.\n` +
        `6. Termine sempre com UMA pergunta consultiva clara que avance a conversa para a próxima etapa.\n\n` +
        `DADOS COGNITIVOS DO LEAD:\n` +
        `- Nome: ${firstName}\n` +
        `- Nicho da Empresa: ${profile.company_niche || 'Não especificado'}\n` +
        `- Escopo de Interesse: ${profile.project_scope || 'Geral Tech'}\n` +
        `- Faixa de Orçamento: ${profile.budget_tier}\n` +
        `- Estágio de Decisão: ${profile.buying_stage}\n` +
        `- Objeção Principal: ${profile.main_objection}\n` +
        `- Histórico de Memórias Episódicas Recentes:\n${memoryContext || 'Nenhuma memória prévia.'}\n` +
        `- Crenças do Lead:\n${beliefsContext || 'Sem crenças cadastradas.'}\n`;

      const userPrompt = `Mensagem recebida do cliente: "${text}"\n` +
        `Produto sugerido ou detectado: ${matchedProduct ? matchedProduct.name + ' - R$ ' + (matchedProduct.price_brl || matchedProduct.price) : 'Nenhum'}\n` +
        `Gere a resposta consultiva ideal em português brasileiro:`;

      const res = await fetch(`${this.aiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.aiKey}`
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 380
        }),
        signal: AbortSignal.timeout(4500)
      });

      if (res.ok) {
        const data = await res.json();
        const aiText = data.choices?.[0]?.message?.content;
        if (aiText && aiText.trim()) {
          const finalHumanized = this.humanizeResponse(aiText);
          // Registra a interação em memória
          models.addLeadEpisodicMemory(cleanPhone, 'FEEDBACK', `Consultor respondeu com foco em ${profile.buying_stage}`, text.slice(0, 100), 2);
          return finalHumanized;
        }
      }
    } catch (_) {
      // Fallback nativo imediato e robusto
    }

    // --- Motor Heurístico Consultivo Offline ---
    return this.generateHeuristicConsultativeReply({ profile, firstName, text, matchedProduct, nlpResult });
  }

  // ==============================================================
  // 4. MOTOR HEURÍSTICO CONSULTIVO OFFLINE (RESILIENTE A FALHAS DE REDE)
  // ==============================================================
  generateHeuristicConsultativeReply({ profile, firstName, text, matchedProduct, nlpResult }) {
    const cleanPhone = profile.phone;
    const stage = profile.buying_stage || 'DESCOBERTA';
    const objection = profile.main_objection || 'NENHUMA';
    const scope = profile.project_scope || 'software sob medida';

    // 1. Resolução de Objeção de Preço
    if (objection === 'PRECO' || nlpResult?.intent === 'DISCOUNT_QUERY') {
      const reply = `${firstName}, entendo a questão de orçamento. Em projetos de ${scope}, costumamos modular a entrega: podemos focar primeiro no MVP com as funções centrais que geram retorno financeiro imediato para sua operação, diluindo o investimento. Qual funcionalidade é mais urgente para você rodar na primeira fase?`;
      return this.humanizeResponse(reply);
    }

    // 2. Resolução de Objeção de Prazo
    if (objection === 'PRAZO') {
      const reply = `${firstName}, sobre o cronograma: conseguimos trabalhar em sprint dedicado para colocar a primeira versão funcional no ar em menos de 10 dias úteis, garantindo que sua operação não fique travada. Para quando exatamente você precisa da primeira entrega homologada?`;
      return this.humanizeResponse(reply);
    }

    // 3. Resolução de Objeção de Garantia & Contrato
    if (objection === 'CONFIANCA_GARANTIA' || nlpResult?.intent === 'TRUST_AND_GUARANTEE') {
      const reply = `${firstName}, todo o desenvolvimento é feito sob contrato formal de prestação de serviços com SLA de suporte garantido e entrega integral do código-fonte e documentação técnica. O risco operacional é zero para sua empresa. Quer que eu te envie nosso modelo de contrato e escopo?`;
      return this.humanizeResponse(reply);
    }

    // 4. Fechamento & Pagamento
    if (stage === 'FECHAMENTO' || nlpResult?.intent === 'PAYMENT_PIX') {
      const prodName = matchedProduct ? matchedProduct.name : 'seu projeto de software personalizado';
      const prodPrice = matchedProduct ? `R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}` : 'da entrada acordada';
      const reply = `Perfeito, ${firstName}. O valor para ${prodName} fica fechado em ${prodPrice}. Vou gerar a chave Pix oficial do Banco Central para iniciarmos o setup e sprint técnico hoje mesmo. Posso emitir agora?`;
      return this.humanizeResponse(reply);
    }

    // 5. Apresentação de Proposta & Preço
    if (stage === 'PROPOSTA' || nlpResult?.intent === 'PRICE_QUERY') {
      if (matchedProduct) {
        const valBrl = Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2);
        const reply = `${firstName}, o investimento para o *${matchedProduct.name}* é de *R$ ${valBrl}* com implantação técnica, suporte e entrega completa. Esse formato se encaixa no planejamento atual da sua empresa ou prefere ver opções modulares?`;
        return this.humanizeResponse(reply);
      }
      const reply = `${firstName}, nossos projetos sob medida variam conforme o escopo e integrações necessárias, geralmente iniciando entre R$ 1.500 e R$ 4.800 com entrega em 15 dias. Se você puder me detalhar quais integrações você precisa (ex: Pix, painel web ou WhatsApp), eu te passo a estimativa exata.`;
      return this.humanizeResponse(reply);
    }

    // 6. Qualificação / Diagnóstico Técnico
    if (stage === 'QUALIFICACAO' || nlpResult?.intent === 'HOW_IT_WORKS') {
      const reply = `${firstName}, desenvolvemos soluções completas sob medida — incluindo softwares de gestão, aplicativos Android/iOS, agentes de IA integrados ao WhatsApp e sistemas web com painel em tempo real. O que sua empresa precisa automatizar com maior prioridade hoje?`;
      return this.humanizeResponse(reply);
    }

    // 7. Saudação Inicial
    const reply = `Olá, ${firstName}. Sou o especialista técnico em desenvolvimento de softwares sob medida, inteligência artificial, aplicativos e otimizações. Como posso apoiar seu projeto ou negócio hoje?`;
    return this.humanizeResponse(reply);
  }

  // ==============================================================
  // 5. HEARTBEAT AUTÔNOMO DE FOLLOW-UP ("EARNING ATTENTION")
  // ==============================================================
  async runAutonomousHeartbeat({ dryRun = false, limit = 10 } = {}) {
    const pendingLeads = models.getLeadsPendingFollowup(limit);
    const results = [];

    for (const lead of pendingLeads) {
      const firstName = (lead.name || 'Amigo').split(' ')[0];
      const stage = lead.buying_stage || 'PROPOSTA';
      const objection = lead.main_objection || 'NENHUMA';
      const scope = lead.project_scope || 'software sob medida';

      let hookMessage = '';
      if (objection === 'PRECO') {
        hookMessage = `${firstName}, fechamos ontem uma nova esteira de implantação modular que permite rodar o seu ${scope} com entrada reduzida e o restante faturado após o retorno da primeira etapa. Quer que eu te envie como ficou essa opção?`;
      } else if (objection === 'PRAZO') {
        hookMessage = `${firstName}, abrimos uma vaga no sprint técnico desta semana. Se aprovarmos o escopo do seu ${scope} até amanhã, conseguimos adiantar o primeiro protótipo funcional para entrega em 5 dias úteis.`;
      } else if (stage === 'PROPOSTA' || stage === 'QUALIFICACAO') {
        hookMessage = `${firstName}, subimos recentemente em produção um painel com fluxo em tempo real muito parecido com o que você solicitou para seu negócio. Gravei uma demonstração rápida de 40 segundos da tela. Quer dar uma olhada na usabilidade?`;
      } else {
        hookMessage = `${firstName}, passando para compartilhar um insight técnico rápido sobre a integração de ${scope}: conseguimos otimizar a latência e o custo de banco de dados para a sua operação. Quer revisar o escopo?`;
      }

      hookMessage = this.humanizeResponse(hookMessage);

      const followupItem = {
        phone: lead.phone,
        name: lead.name,
        stage,
        objection,
        readiness_score: lead.readiness_score,
        hookMessage,
        executed: false
      };

      if (!dryRun) {
        // Atualiza contagem de follow-up e posterga o próximo para 3 dias
        const newCount = (lead.followup_count || 0) + 1;
        const nextDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        models.upsertLeadCognitiveProfile(lead.phone, {
          followup_count: newCount,
          next_followup_at: nextDate,
          notes: `Follow-up #${newCount} acionado: ${hookMessage.slice(0, 80)}...`
        });
        models.addLeadEpisodicMemory(lead.phone, 'QUOTE', `Follow-up automático enviado: ${hookMessage.slice(0, 100)}`, hookMessage, 3);
        followupItem.executed = true;
      }

      results.push(followupItem);
    }

    return {
      timestamp: new Date().toISOString(),
      total_pending: pendingLeads.length,
      processed: results.length,
      dry_run: Boolean(dryRun),
      results
    };
  }
}

module.exports = new CognitiveSalesService();

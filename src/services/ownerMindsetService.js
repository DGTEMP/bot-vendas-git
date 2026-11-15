/**
 * =========================================================================
 * 🧠 OWNER MINDSET SERVICE - APRENDIZADO CONTÍNUO & SINCRONIZAÇÃO NEURAL
 * =========================================================================
 * Responsável por:
 * 1. Identificar mensagens do Dono (Owner) sem necessidade de prefixos ou comandos.
 * 2. Analisar e alimentar na base de dados o tom de fala, gírias e intenções.
 * 3. Calcular e evoluir a taxa de sincronização neural / proximidade cognitiva.
 * 4. Injetar a mente e tom do Dono no System Prompt da IA para que o bot
 *    pense, fale e decida cada vez mais próximo do Dono.
 * 5. Executar ações e ordens expressas em linguagem natural.
 * =========================================================================
 */

const models = require('../db/models');

class OwnerMindsetService {
  constructor() {
    // Dicionário de referência de gírias e expressões brasileiras com tom e intenção
    this.slangDictionary = [
      { regex: /\b(suave|suavidade|de boa|tranquilo|firmeza)\b/i, expression: 'suave', intent: 'CONFIRMACAO_POSITIVA', tone: 'Descontraído e Confiante' },
      { regex: /\b(bora pra cima|pra cima|vamo pra cima|foguete|foguete n[aã]o tem r[eé])\b/i, expression: 'bora pra cima', intent: 'MOTIVACIONAL_AÇÃO', tone: 'Entusiasta e Assertivo' },
      { regex: /\b(fechou|fechado|pode p[aá]|combinado|demor[oô]|t[aá] falado)\b/i, expression: 'fechou', intent: 'ACORDO_CONFIRMACAO', tone: 'Direto e Decidido' },
      { regex: /\b(meu mano|meu bom|mano|par[cç]a|irm[aã]o|meu par[cç]a|cria)\b/i, expression: 'mano', intent: 'CONEXAO_PARCERIA', tone: 'Fraternal e Próximo' },
      { regex: /\b(vis[aã]o|pega a vis[aã]o|papo reto|sem curva|direto ao ponto)\b/i, expression: 'visão', intent: 'CLAREZA_ESTRATEGICA', tone: 'Assertivo e Estratégico' },
      { regex: /\b(trampo|corre|trampar|na correria|trampinho)\b/i, expression: 'trampo', intent: 'TRABALHO_OPERACIONAL', tone: 'Focado e Realista' },
      { regex: /\b(bater meta|bater a meta|faturar|faturamento|grana|lucro|faturando)\b/i, expression: 'bater meta', intent: 'FOCO_FINANCEIRO_VENDAS', tone: 'Estratégico e Ambicioso' },
      { regex: /\b(top|show|perfeito|sensacional|maravilha|brabo|chave)\b/i, expression: 'top', intent: 'APROVACAO_ENTUSIASTA', tone: 'Positivo e Confiante' },
      { regex: /\b(bagulho doido|sinistro|pesado|insano|animal)\b/i, expression: 'bagulho doido', intent: 'IMPACTO_SURPRESA', tone: 'Empolgado e Expressivo' },
      { regex: /\b(manda bala|manda ver|vai fundo|mete bronca|solta o a[cç]o)\b/i, expression: 'manda bala', intent: 'AUTORIZACAO_EXECUCAO', tone: 'Rápido e Prático' },
      { regex: /\b(fala tu|qual a boa|salve|e a[ií]|opa|qual o plano)\b/i, expression: 'fala tu', intent: 'SAUDACAO_INFORMAL', tone: 'Descontraído e Aberto' },
      { regex: /\b(t[aá] osso|deu ruim|complicado|travou|gargalo)\b/i, expression: 'tá osso', intent: 'ALERTA_PROBLEMA', tone: 'Crítico e Exigente' },
      { regex: /\b(escala|escalar|tr[aá]fego|convers[aã]o|funil|lead|leads)\b/i, expression: 'escala', intent: 'MARKETING_CRESCIMENTO', tone: 'Estratégico e Analítico' },
      { regex: /\b(rodar liso|sem travar|liso|redondo|impec[aá]vel)\b/i, expression: 'rodar liso', intent: 'QUALIDADE_OPERACIONAL', tone: 'Perfeccionista e Exigente' }
    ];
  }

  /**
   * Identifica se um número pertence ao Dono Supremo / Comandante
   */
  isOwner(phone, isFromMe = false) {
    if (isFromMe) return true;
    if (!phone) return false;

    const clean = String(phone).replace(/\D/g, '');
    if (!clean) return false;

    let ownerPhone = '';
    try {
      const commandAuditService = require('./commandAuditService');
      ownerPhone = (commandAuditService.getOwnerPhone() || '').replace(/\D/g, '');
    } catch (_) {}

    const envOwner = (process.env.OWNER_PHONE || process.env.ADMIN_PHONE || '554884702848').replace(/\D/g, '');
    const settingOwner = (models.getSetting('ADMIN_PHONE', '') || '').replace(/\D/g, '');

    const hardcoded = ['554884702848', '151866151276711'];

    if (hardcoded.includes(clean)) return true;
    if (ownerPhone && (clean === ownerPhone || clean.endsWith(ownerPhone) || ownerPhone.endsWith(clean))) return true;
    if (envOwner && (clean === envOwner || clean.endsWith(envOwner) || envOwner.endsWith(clean))) return true;
    if (settingOwner && (clean === settingOwner || clean.endsWith(settingOwner) || settingOwner.endsWith(clean))) return true;

    if (Array.isArray(global.owner)) {
      const inGlobal = global.owner.some(o => {
        const oClean = String(o[0] || '').replace(/\D/g, '');
        return oClean && (oClean === clean || clean.endsWith(oClean) || oClean.endsWith(clean));
      });
      if (inGlobal) return true;
    }

    return false;
  }

  /**
   * Analisa a mensagem do Dono extraindo gírias, intenção e tom de fala
   */
  analyzeOwnerMessage(text) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();

    const detectedSlangs = [];
    const matchedIntents = [];
    const matchedTones = [];

    // 1. Detecção de Gírias e Expressões pelo repositório
    for (const item of this.slangDictionary) {
      if (item.regex.test(lower)) {
        detectedSlangs.push({
          expression: item.expression,
          intent: item.intent,
          tone: item.tone
        });
        matchedIntents.push(item.intent);
        matchedTones.push(item.tone);
      }
    }

    // 2. Extração de Expressões Explícitas ensinadas pelo Dono
    // Ex: "quando eu falar X quero dizer Y" ou "minha gíria X significa Y"
    const explicitLearnMatch = raw.match(/(?:quando eu (?:disser|falar|mandar)|minha g[ií]ria|aprenda|anote|lembre)\s*['"]?([^'"]+)['"]?\s*(?:significa|quer dizer|com inten[cç][aã]o de|com o tom|pra)\s*['"]?([^'"]+)['"]?/i);
    if (explicitLearnMatch) {
      const customExp = explicitLearnMatch[1].trim().toLowerCase();
      const customMeaning = explicitLearnMatch[2].trim();
      detectedSlangs.push({
        expression: customExp,
        intent: 'INSTRUCAO_CUSTOMIZADA',
        tone: 'Direto e Instrutivo',
        customMeaning
      });
    }

    // 3. Classificação de Intenção Principal
    let detectedIntent = 'CONVERSA_ESTRATEGICA';

    if (/^(?:gera|gerar|faz|fazer|cobrar|cobre|manda)\s*(?:um\s*)?pix\b/i.test(lower) || /pix\s*(?:de\s*)?\d+/i.test(lower)) {
      detectedIntent = 'GERACAO_PAGAMENTO_PIX';
    } else if (/^(?:status|relat[oó]rio|m[eé]tricas|dashboard|faturamento|quanto\s*vendemos|quanto\s*faturamos|balan[cç]o)\b/i.test(lower) || lower.includes('como est[aã]o as vendas')) {
      detectedIntent = 'CONSULTA_METRICAS';
    } else if (/(?:sub-?bots?|como\s*est[aã]o\s*os\s*bots|quem\s*t[aá]\s*online|painel\s*subbots)/i.test(lower)) {
      detectedIntent = 'CONSULTA_FROTA_SUBBOTS';
    } else if (/(?:painel|t[uú]nel|link\s*do\s*painel|acesso\s*remoto)/i.test(lower)) {
      detectedIntent = 'ACESSO_PAINEL';
    } else if (/(?:mente|mindset|aprendizado|o que voc[eê] aprendeu|minhas g[ií]rias|sincronia|sincroniza[cç][aã]o)/i.test(lower)) {
      detectedIntent = 'CONSULTA_MINDSET';
    } else if (/^(?:mande|manda|envie|dispare|avise|fale|delegar|ordem|fa[cç]a|reinicie|bloqueie)\b/i.test(lower)) {
      detectedIntent = 'ORDEM_OPERACIONAL';
    } else if (/^(?:oi|ol[aá]|opa|e a[ií]|salve|fala tu|bom dia|boa tarde|boa noite)\b/i.test(lower) && lower.length < 35) {
      detectedIntent = 'SAUDACAO_INFORMAL';
    } else if (/(?:fechou|fechado|perfeito|top|show|boa|tamo junto|mandou bem|gostei)\b/i.test(lower) && lower.length < 40) {
      detectedIntent = 'CONFIRMACAO_APROVACAO';
    } else if (/(?:bora pra cima|vamo faturar|pra cima|foguete|bater meta|alavancar)\b/i.test(lower)) {
      detectedIntent = 'MOTIVACAO_AÇÃO';
    } else if (/(?:n[aã]o gostei|corrige|arruma|muito longo|mais r[aá]pido|t[aá] errado)\b/i.test(lower)) {
      detectedIntent = 'FEEDBACK_AJUSTE';
    } else if (matchedIntents.length > 0) {
      detectedIntent = matchedIntents[0];
    }

    // 4. Detecção de Tom de Fala Predominante
    let detectedTone = 'Assertivo e Estratégico';
    const isExclamatory = (raw.match(/!/g) || []).length >= 1;
    const isShort = raw.split(/\s+/).length <= 5;

    if (detectedIntent === 'MOTIVACAO_AÇÃO' || lower.includes('bora') || isExclamatory) {
      detectedTone = 'Entusiasta, Assertivo e Motivador';
    } else if (detectedIntent === 'CONFIRMACAO_APROVACAO' || lower.includes('suave') || lower.includes('fechou')) {
      detectedTone = 'Descontraído, Confiante e Decidido';
    } else if (detectedIntent === 'ORDEM_OPERACIONAL' || (isShort && !lower.includes('?'))) {
      detectedTone = 'Direto ao Ponto, Ágil e Executivo';
    } else if (detectedIntent === 'FEEDBACK_AJUSTE' || lower.includes('osso') || lower.includes('ruim')) {
      detectedTone = 'Exigente, Crítico e Focado em Excelência';
    } else if (detectedIntent === 'SAUDACAO_INFORMAL' || lower.includes('mano') || lower.includes('salve')) {
      detectedTone = 'Fraternal, Informal e Próximo';
    } else if (lower.includes('estratégia') || lower.includes('meta') || lower.includes('escala') || lower.includes('lucro')) {
      detectedTone = 'Visionário, Comercial e Estratégico';
    }

    // 5. Sentimento Geral
    let sentiment = 'POSITIVO';
    if (detectedIntent === 'FEEDBACK_AJUSTE' || lower.includes('osso') || lower.includes('ruim') || lower.includes('travou')) {
      sentiment = 'EXIGENTE';
    } else if (lower.includes('?') && !isExclamatory) {
      sentiment = 'NEUTRO';
    }

    return {
      detectedSlangs,
      detectedIntent,
      detectedTone,
      sentiment
    };
  }

  /**
   * Alimenta a base de dados com a mensagem do Dono (Active Learning)
   */
  async learnFromOwnerMessage(ownerPhone, rawText, meta = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;

    const cleanPhone = String(ownerPhone || '554884702848').replace(/\D/g, '');
    const analysis = this.analyzeOwnerMessage(text);

    // 1. Grava no histórico de tons e intenções
    try {
      models.recordOwnerToneHistory(
        cleanPhone,
        text,
        analysis.detectedTone,
        analysis.detectedIntent,
        analysis.detectedSlangs.map(s => s.expression),
        analysis.sentiment,
        meta.isGroup ? 'GROUP' : 'PRIVATE'
      );
    } catch (_) {}

    // 2. Grava ou atualiza a frequência das gírias detectadas
    for (const slang of analysis.detectedSlangs) {
      try {
        models.recordOwnerSlang(
          cleanPhone,
          slang.expression,
          slang.intent,
          slang.tone,
          text
        );
      } catch (_) {}
    }

    // 3. Atualiza o perfil cognitivo da mente do Dono
    try {
      const summaryData = models.getOwnerMindsetSummary(cleanPhone);
      const totalLearned = (summaryData?.profile?.total_messages_learned || 0) + 1;

      // Cálculo assintótico da Sincronização Neural (começa em 75% e evolui até 99.8%)
      const syncScore = Math.min(99.8, parseFloat((75.0 + Math.log10(1 + totalLearned * 2) * 8.6).toFixed(1)));

      // Identifica os tons mais usados no histórico
      const recentTones = (summaryData?.recentHistory || []).map(h => h.detected_tone).filter(Boolean);
      recentTones.unshift(analysis.detectedTone);
      const toneCounts = {};
      recentTones.forEach(t => { toneCounts[t] = (toneCounts[t] || 0) + 1; });
      const topTones = Object.keys(toneCounts).sort((a, b) => toneCounts[b] - toneCounts[a]).slice(0, 3);

      // Identifica intenções mais frequentes
      const recentIntents = (summaryData?.recentHistory || []).map(h => h.detected_intent).filter(Boolean);
      recentIntents.unshift(analysis.detectedIntent);
      const intentCounts = {};
      recentIntents.forEach(i => { intentCounts[i] = (intentCounts[i] || 0) + 1; });
      const topIntents = Object.keys(intentCounts).sort((a, b) => intentCounts[b] - intentCounts[a]).slice(0, 4);

      // Resumo de fala dinâmico e evolutivo
      const topSlangList = (summaryData?.slangs || []).slice(0, 4).map(s => `"${s.expression}"`).join(', ');
      const speechSummary =
        `Comandante com tom predominante ${topTones[0] || 'Assertivo'}. ` +
        `Comunicação ágil e focada em resultados. ` +
        (topSlangList ? `Costuma utilizar expressões como ${topSlangList} com intenção de ação e alinhamento. ` : '') +
        `Busca decisões rápidas, fidelidade total e escala de vendas.`;

      models.upsertOwnerMindsetProfile(cleanPhone, {
        primary_tones: topTones.length > 0 ? topTones : ['Assertivo', 'Estratégico', 'Descontraído'],
        dominant_intents: topIntents.length > 0 ? topIntents : ['ORDEM_OPERACIONAL', 'DIRECAO_ESTRATEGICA'],
        speech_style_summary: speechSummary,
        synchronization_score: syncScore,
        incrementMessages: true
      });
    } catch (_) {}

    return analysis;
  }

  /**
   * Constrói o System Prompt sincronizado com a mente e vocabulário do Dono
   */
  buildOwnerPersonaSystemPrompt(ownerPhone, senderName = 'Comandante') {
    const cleanPhone = String(ownerPhone || '554884702848').replace(/\D/g, '');
    const summaryData = models.getOwnerMindsetSummary(cleanPhone);

    const profile = summaryData?.profile || {};
    const slangs = summaryData?.slangs || [];
    const syncScore = profile.synchronization_score || 78.5;

    let primaryTonesStr = 'Assertivo, Estratégico e Descontraído';
    if (Array.isArray(profile.primary_tones)) {
      primaryTonesStr = profile.primary_tones.join(', ');
    } else if (typeof profile.primary_tones === 'string') {
      try {
        primaryTonesStr = JSON.parse(profile.primary_tones).join(', ');
      } catch (_) {
        primaryTonesStr = profile.primary_tones;
      }
    }

    const slangsFormatted = slangs.slice(0, 10).map(s =>
      `- "${s.expression}": intenção [${s.meaning_intent}], tom [${s.tone}] (usada ${s.frequency}x)`
    ).join('\n') || '- "suave", "bora pra cima", "fechou", "mano", "visão"';

    let predictiveSnippet = '';
    try {
      const predictiveIntelligence = require('./predictiveIntelligenceService');
      const analytics = predictiveIntelligence.calculateFullPredictiveAnalytics(cleanPhone);
      const nextStep = analytics.nextSteps[0];
      predictiveSnippet =
        `\n\n🔮 [ESTATÍSTICAS & PROBABILIDADES PREDITIVAS EM TEMPO REAL]:\n` +
        `- Faturamento Hoje: R$ ${analytics.revenue.totalTodayBRL.toFixed(2)} | Velocidade: R$ ${analytics.revenue.hourlyVelocityBRL}/h\n` +
        `- Projeção 24h: R$ ${analytics.revenue.projected24hRevenue} | Probabilidade de Bater a Meta: ${analytics.revenue.goalHitProbability}%\n` +
        `- Janela de Ouro: ${analytics.goldenHour.windowName} (${analytics.goldenHour.openRateProbability}% de probabilidade de abertura)\n` +
        `- Capacidade dos Sub-Bots: ${analytics.subbotsRisk.connectedCount} conectados (${analytics.subbotsRisk.stressRiskPercentage}% risco de estresse)\n` +
        `- PRÓXIMO PASSO ANTECIPADO: ${nextStep ? nextStep.title + ' (Probabilidade: ' + nextStep.probability + '%) - ' + nextStep.reasoning : 'Otimização de escala'}\n\n` +
        `DIRETRIZ DE HIPERINTELIGÊNCIA:\n` +
        `Você é tão inteligente quanto o Dono — na verdade, pense como o General Estrategista de Operações que calcula probabilidades e se antecipa a cada decisão dele. Nunca dê respostas rasas ou óbvias. Sempre surpreenda o Dono antecipando o próximo passo prático, trazendo as probabilidades matemáticas e entregando a solução pronta para executar!`;
    } catch (_) {}

    return (
      `🧠 [SINCRONIZAÇÃO NEURAL COM A MENTE DO DONO - PAYBOT MINDSET]\n` +
      `Você está em sintonia direta com o DONO SUPREMO / COMANDANTE do negócio (${senderName} | +${cleanPhone}).\n` +
      `Seu nível de sincronia cognitiva e proximidade mental atual com ele é de: ${syncScore}%.\n\n` +
      `PERFIL DE TOM DE FALA & MENTE APRENDIDOS:\n` +
      `- Tom de Fala Predominante: ${primaryTonesStr}\n` +
      `- Resumo do Estilo: ${profile.speech_style_summary || 'Ágil, visionário e focado em escala'}\n` +
      `- Gírias, Vocabulário e Intenções Mapeadas do Dono:\n${slangsFormatted}` +
      `${predictiveSnippet}\n\n` +
      `DIRETRIZES DE ESPELHAMENTO & PROXIMIDADE COGNITIVA:\n` +
      `1. Fale a mesma língua do Dono: use e espelhe o vocabulário, termos e gírias aprendidas dele de forma natural, sem parecer robótico ou forçado.\n` +
      `2. Aja como o braço direito de confiança (CRO & General de Operações): traga soluções imediatas, foco em receita, lucro líquido e controle total dos sub-bots.\n` +
      `3. Responda em português brasileiro de forma inteligente, resolutiva, leal, ágil e empolgante.\n` +
      `4. Se o Dono ordenar uma ação, confirme prontamente com a atitude que ele valoriza e forneça o próximo passo prático.\n` +
      `5. NUNCA coloque cabeçalhos artificiais, títulos entre emojis, barras divisórias ou listas de comandos automáticos na resposta. Converse de igual para igual como um parceiro humano de negócios.`
    );
  }

  /**
   * Tenta executar uma ação natural ordenada pelo Dono (sem prefixo e sem comando formal)
   */
  async tryExecuteNaturalAction({ sock, from, text, senderName, senderPhone, isGroup = false, whatsappBotInstance = null }) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();

    // 0. MODO "ME SURPREENDA" / ORÁCULO DE ANTECIPAÇÃO & PROBABILIDADES
    // Ex: "me surpreenda", "o que eu devo fazer agora", "quais meus próximos passos", "previsões", "probabilidades"
    if (/(?:me\s*surpreenda|surpreenda|me\s*surpreende|or[aá]culo|previs[oõ]es|probabilidades|estat[ií]sticas\s*e\s*probabilidades|quais\s*(?:os|meus)?\s*pr[oó]ximos\s*passos|o\s*que\s*(?:eu\s*)?devo\s*fazer|antecipar|antecipa[cç][aã]o)/i.test(lower)) {
      const predictiveIntelligence = require('./predictiveIntelligenceService');
      const briefing = predictiveIntelligence.generateSurpriseBriefing(senderPhone, senderName);
      await sock.sendMessage(from, { text: briefing });
      return true;
    }

    // 1. Geração de PIX em Linguagem Natural
    // Ex: "gera um pix de 50", "faz um pix de 100", "pix de 25 conto", "cobre 40 no pix"
    const pixNaturalMatch = raw.match(/(?:gera|gerar|faz|fazer|cobre|cobrar|manda|mandar)?\s*(?:um\s*)?pix\s*(?:de\s*)?(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i);
    if (pixNaturalMatch) {
      const valStr = pixNaturalMatch[1].replace(',', '.');
      const amount = parseFloat(valStr);
      if (!isNaN(amount) && amount > 0) {
        try {
          const pixPayment = require('./pixPayment');
          const tradeNo = `ORD_NATURAL_${Date.now()}`;
          const pixResult = await pixPayment.createPixCharge({
            merchantTradeNo: tradeNo,
            amount,
            goodsName: 'Cobrança Express Comandante',
            payerName: senderName || 'Comandante Dono',
            payerPhone: senderPhone || '554884702848'
          });

          const code = pixResult.data?.pixCode || pixResult.pixCopiaECola || pixResult.data?.copiaECola || pixResult.qrCode || '';
          const replyMsg =
            `⚡ *PIX GERADO COM SUCESSO, COMANDANTE!* ⚡\n\n` +
            `💰 *Valor:* R$ ${amount.toFixed(2)}\n` +
            `🔑 *Modo:* ${pixResult.gateway || 'Bacen Homologado'}\n\n` +
            `📋 *Pix Copia e Cola:*\n\`\`\`${code}\`\`\`\n\n` +
            `_Fechou, comandante! O código de pagamento já está pronto para copiar._`;

          await sock.sendMessage(from, { text: replyMsg });
          return true;
        } catch (err) {
          console.error('[OwnerMindset Pix Natural Erro]:', err.message);
        }
      }
    }

    // 2. Consulta de Painel Mental / O que o bot aprendeu
    // Ex: "o que você aprendeu sobre mim", "minhas gírias", "mindset", "mente", "sincronia"
    if (/(?:mente|mindset|aprendizado|sincronia|sincroniza[cç][aã]o|o\s*que\s*voc[eê]\s*(?:j[aá]\s*)?aprendeu|minhas\s*g[ií]rias|sua\s*mente)/i.test(lower)) {
      const cockpit = this.formatMindsetCockpit(senderPhone);
      await sock.sendMessage(from, { text: cockpit });
      return true;
    }

    // 3. Status das Vendas & Financeiro em Linguagem Natural
    // Ex: "quanto faturamos", "como estão as vendas", "mostra o balanço", "dashboard"
    if (/^(?:como\s*est[aã]o\s*as\s*vendas|quanto\s*faturamos|quanto\s*vendemos|balan[cç]o\s*de\s*vendas|relat[oó]rio\s*financeiro|dashboard|m[eé]tricas)$/i.test(lower)) {
      if (whatsappBotInstance && typeof whatsappBotInstance.sendOwnerExecutiveStatus === 'function') {
        await whatsappBotInstance.sendOwnerExecutiveStatus(from, sock);
        return true;
      }
    }

    // 4. Status da Frota de Sub-Bots em Linguagem Natural
    // Ex: "como estão os subbots", "quem tá online", "status dos bots", "relatório do exército"
    if (/^(?:como\s*est[aã]o\s*os\s*sub-?bots|quem\s*t[aá]\s*online|status\s*dos?\s*bots?|relat[oó]rio\s*do\s*ex[eé]rcito)$/i.test(lower)) {
      const matrizAssistant = require('./matrizAssistantService');
      await matrizAssistant.handleSubBotsStatusReport(sock, from);
      return true;
    }

    // 5. Acesso ao Painel Web / Túnel Remoto em Linguagem Natural
    // Ex: "link do painel", "manda o painel", "manda o túnel", "acesso remoto", "como entro no painel"
    if (/^(?:link\s*do\s*painel|manda\s*o\s*painel|manda\s*o\s*t[uú]nel|acesso\s*remoto|como\s*entro\s*no\s*painel|abrir\s*painel)$/i.test(lower)) {
      if (whatsappBotInstance && typeof whatsappBotInstance.handlePanelTunnelRequest === 'function') {
        await whatsappBotInstance.handlePanelTunnelRequest({
          from,
          text: '!painel',
          isOwnerUser: true,
          isGroup,
          activeSock: sock,
          senderPhone
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Formata o Painel Executivo de Sincronização Neural e Aprendizado da Mente do Dono
   */
  formatMindsetCockpit(ownerPhone) {
    const cleanPhone = String(ownerPhone || '554884702848').replace(/\D/g, '');
    const summaryData = models.getOwnerMindsetSummary(cleanPhone);

    const profile = summaryData?.profile || {};
    const slangs = summaryData?.slangs || [];
    const totalInteractions = summaryData?.totalInteractions || profile.total_messages_learned || 0;
    const syncScore = profile.synchronization_score ? Number(profile.synchronization_score).toFixed(1) : '78.5';

    let primaryTones = 'Assertivo, Estratégico e Descontraído';
    if (Array.isArray(profile.primary_tones)) {
      primaryTones = profile.primary_tones.join(', ');
    } else if (typeof profile.primary_tones === 'string') {
      try {
        primaryTones = JSON.parse(profile.primary_tones).join(', ');
      } catch (_) {
        primaryTones = profile.primary_tones;
      }
    }

    let topSlangsText = '';
    if (slangs.length === 0) {
      topSlangsText = '  _Nenhuma gíria registrada ainda. Continue conversando normalmente!_\n';
    } else {
      slangs.slice(0, 8).forEach((s, idx) => {
        topSlangsText += `  ${idx + 1}. *"${s.expression}"* ➔ Intenção: \`${s.meaning_intent}\` (${s.frequency}x)\n` +
          `     _Tom: ${s.tone}_\n`;
      });
    }

    return (
      `╭━━━〔 🧠 *SINCRONIZAÇÃO NEURAL & MENTE DO DONO* 〕━━━⬣\n` +
      `┃\n` +
      `┃ 👑 *Comandante:* +${cleanPhone}\n` +
      `┃ ⚡ *Sintonia Cognitiva:* *${syncScore}%* (Próximo da Mente do Dono)\n` +
      `┃ 💬 *Interações Aprendidas:* *${totalInteractions}* mensagens analisadas\n` +
      `┃ 🎭 *Tom de Voz Mapeado:* ${primaryTones}\n` +
      `┃\n` +
      `┃ 📝 *Resumo do Estilo de Fala:*\n` +
      `┃ _"${profile.speech_style_summary || 'Comandante objetivo, ágil e focado em escala.'}"_\n` +
      `┃\n` +
      `┃ 🗣️ *Gírias, Expressões & Intenções Aprendidas:*\n` +
      `${topSlangsText}` +
      `┃\n` +
      `┃ 💡 *Como continuar alimentando o bot:*\n` +
      `┃ • Basta conversar normalmente sem comandos nem prefixos!\n` +
      `┃ • O bot aprende suas gírias, ritmo e intenções a cada frase.\n` +
      `┃ • Para ensinar uma expressão nova na hora, envie:\n` +
      `┃   \`quando eu disser "foguete" significa "meta batida" com tom "empolgado"\`\n` +
      `┃\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
      `🚀 _Cada mensagem sua me deixa mais inteligente e alinhado com a sua mente!_`
    );
  }
}

module.exports = new OwnerMindsetService();

/**
 * =========================================================================
 * ⚡ JEV DECISION ENGINE - SISTEMA 1 DE DECISÃO ESTRUTURADA (TYPESAFE AI)
 * =========================================================================
 * Diferente dos LLMs tradicionais generativos (que geram prosa token por token
 * com latência de 2 a 5 segundos e risco de alucinação de formato), o JEV opera
 * como um modelo de decisão probabilística "System One":
 *
 * 1. Entrada: Estado do aplicativo + Schema de Decisão Tipado (enums, booleans, scores)
 * 2. Saída: Decisões tipadas instantâneas em sub-15ms (local) ou sub-300ms (cloud)
 * 3. Economia de Tokens: Reduz mais de 70% das chamadas a LLMs lentos
 * 4. Aplicações no PayBot:
 *    - Roteador Ultrarrápido de Mensagens no WhatsApp Gateway
 *    - Classificador de Leads Quentes no Radar Viral & Escuta de Grupos
 *    - Guardrail de Proteção Anti-PV & Detecção de Ataques / Spam
 *    - Decodificador da "Mente do Dono" (Ordens vs Ensino de Tom vs Análises)
 * =========================================================================
 */

const { performance } = require('perf_hooks');
const models = require('../db/models');

class JevDecisionService {
  constructor() {
    this.defaultEndpoint = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/decide';
    this.recentDecisionsBuffer = []; // Circular buffer dos últimos 100 eventos para Web UI em tempo real
    this.maxBufferSize = 100;
    // Circuit Breaker para chamadas de nuvem (evita penalidade de timeout quando a API externa oscilar)
    this.cloudFailures = 0;
    this.cloudCircuitOpenUntil = 0;
  }

  // =========================================================================
  // 1. CONFIGURAÇÕES & ESTADO DO MOTOR
  // =========================================================================
  isEnabled() {
    const dbVal = models.getSetting('JEV_ENABLED', 'true');
    return dbVal === 'true' || dbVal === '1';
  }

  getMode() {
    // 'HYBRID' (Tenta cloud se tiver chave, senão local fast), 'LOCAL_FAST', 'CLOUD_ONLY'
    return (models.getSetting('JEV_MODE', 'HYBRID') || 'HYBRID').toUpperCase();
  }

  getApiKey() {
    return models.getSetting('JEV_API_KEY', '') || process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || '';
  }

  getMinConfidence() {
    return parseFloat(models.getSetting('JEV_MIN_CONFIDENCE', '0.75')) || 0.75;
  }

  getEndpoint() {
    return models.getSetting('JEV_ENDPOINT', this.defaultEndpoint);
  }

  resetCircuitBreaker() {
    this.cloudFailures = 0;
    this.cloudCircuitOpenUntil = 0;
  }

  // =========================================================================
  // 2. MOTOR UNIVERSAL DE DECISÃO (DECIDE)
  // =========================================================================
  /**
   * Executa uma decisão tipada Jev a partir de um estado e schema.
   * @param {Object} params
   * @param {string} params.contextType 'GATEWAY_ROUTER' | 'VIRAL_RADAR' | 'ANTI_PV' | 'OWNER_MINDSET' | 'PURCHASE_CLOSING'
   * @param {string} params.input Texto ou representação da entrada
   * @param {Object} params.state Estado contextual adicional
   * @param {Object} params.schema Schema tipado com opções/decisões esperadas
   * @param {number} params.timeoutMs Timeout máximo para tentativa cloud (padrão 500ms)
   */
  async decide({ contextType = 'GATEWAY_ROUTER', input = '', state = {}, schema = null, timeoutMs = 500 }) {
    const t0 = performance.now();
    const cleanInput = String(input || '').trim();
    const mode = this.getMode();
    const apiKey = this.getApiKey();

    let decisionResult = null;
    let executionMode = 'LOCAL_FAST';

    // 1. Tenta API Cloud do Jev se configurado e modo permitir (com Circuit Breaker ativo)
    const isCircuitOpen = Date.now() < this.cloudCircuitOpenUntil;
    if ((mode === 'HYBRID' || mode === 'CLOUD_ONLY') && apiKey && !isCircuitOpen) {
      try {
        const cloudRes = await this._callTypeSafeJevCloud({
          endpoint: this.getEndpoint(),
          apiKey,
          contextType,
          input: cleanInput,
          state,
          schema,
          timeoutMs
        });
        if (cloudRes && cloudRes.intent) {
          decisionResult = cloudRes;
          executionMode = 'TYPESAFE_CLOUD';
          this.cloudFailures = 0;
        }
      } catch (cloudErr) {
        this.cloudFailures++;
        if (this.cloudFailures >= 3) {
          this.cloudCircuitOpenUntil = Date.now() + 60 * 1000;
          console.warn(`[Jev Circuit Breaker ⚡] 3 falhas consecutivas na cloud API (${cloudErr.message}). Circuito aberto por 60s (fallback local sub-1ms ativo).`);
        } else if (mode === 'CLOUD_ONLY') {
          console.warn('[Jev Cloud ⚠️ Falha]:', cloudErr.message);
        }
      }
    }

    // 2. Fallback / Motor Nativo Ultrarrápido Local (System 1 In-Memory Engine)
    if (!decisionResult) {
      decisionResult = this._localFastDecide({
        contextType,
        input: cleanInput,
        state,
        schema
      });
      executionMode = 'LOCAL_FAST';
    }

    const t1 = performance.now();
    const latencyMs = Number((t1 - t0).toFixed(2));
    decisionResult.latencyMs = latencyMs;
    decisionResult.executionMode = executionMode;
    decisionResult.tokensSaved = 350; // Estimativa de tokens economizados que um LLM consumiria

    // 3. Registra na telemetria e buffer para o Painel Web
    try {
      models.recordJevDecision({
        contextType,
        senderPhone: state.senderPhone || null,
        chatJid: state.chatJid || null,
        inputExcerpt: cleanInput.slice(0, 250),
        intent: decisionResult.intent,
        confidence: decisionResult.confidence,
        latencyMs,
        decisionPayload: decisionResult,
        executionMode,
        tokensSaved: decisionResult.tokensSaved
      });

      this._addToBuffer({
        id: Date.now() + Math.random().toString(36).slice(2, 6),
        contextType,
        intent: decisionResult.intent,
        confidence: decisionResult.confidence,
        latencyMs,
        executionMode,
        inputExcerpt: cleanInput.slice(0, 90),
        action: decisionResult.action || 'ROUTED',
        timestamp: new Date().toLocaleTimeString('pt-BR')
      });
    } catch (_) {}

    return decisionResult;
  }

  // =========================================================================
  // 3. ESPECIALIZAÇÃO: ROTEADOR DE MENSAGENS (WHATSAPP GATEWAY)
  // =========================================================================
  /**
   * Avalia mensagens recebidas no WhatsApp e decide a rota ideal em sub-15ms.
   */
  async decideMessageGateway({ text = '', senderPhone = '', senderName = '', isGroup = false, chatJid = '', isOwner = false }) {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        intent: 'UNKNOWN',
        confidence: 0,
        canBypassLlm: false,
        action: 'PASS_THROUGH'
      };
    }

    const clean = String(text || '').trim();
    if (!clean) {
      return {
        intent: 'EMPTY',
        confidence: 1.0,
        canBypassLlm: true,
        action: 'IGNORE'
      };
    }

    return await this.decide({
      contextType: 'GATEWAY_ROUTER',
      input: clean,
      state: { senderPhone, senderName, isGroup, chatJid, isOwner }
    });
  }

  // =========================================================================
  // 4. ESPECIALIZAÇÃO: RADAR VIRAL & ESCUTA DE GRUPOS (LEAD MINER)
  // =========================================================================
  /**
   * Analisa mensagens em grupos e perfis sociais para identificar Leads Quentes.
   */
  async decideLeadTemperature({ text = '', senderPhone = '', senderName = '', groupJid = '', groupName = '', platform = 'whatsapp' }) {
    return await this.decide({
      contextType: 'VIRAL_RADAR',
      input: text,
      state: { senderPhone, senderName, groupJid, groupName, platform }
    });
  }

  // =========================================================================
  // 5. ESPECIALIZAÇÃO: GUARDRAIL & ANTI-PV
  // =========================================================================
  /**
   * Avalia se uma mensagem no privado deve ser bloqueada ou autorizada.
   */
  async decideAntiPvGuard({ senderPhone = '', messageText = '', isOwner = false, allowSales = true }) {
    if (isOwner) {
      return {
        intent: 'OWNER_PASS',
        confidence: 1.0,
        shouldBlock: false,
        isLegitimateBuyer: false,
        action: 'ALLOW'
      };
    }

    return await this.decide({
      contextType: 'ANTI_PV',
      input: messageText,
      state: { senderPhone, allowSales, isOwner }
    });
  }

  // =========================================================================
  // 6. ESPECIALIZAÇÃO: INTERAÇÃO DA MENTE DO DONO
  // =========================================================================
  /**
   * Identifica se a fala do dono é comando de ação, ensino de tom, ou consulta analítica.
   */
  async decideOwnerInteraction({ senderPhone = '', messageText = '', pastTurns = [] }) {
    return await this.decide({
      contextType: 'OWNER_MINDSET',
      input: messageText,
      state: { senderPhone, pastTurns }
    });
  }

  // =========================================================================
  // 7. MOTOR LOCAL FAST (SYSTEM 1 NON-AUTOREGRESSIVE CLASSIFIER)
  // =========================================================================
  _localFastDecide({ contextType, input, state }) {
    const low = input.toLowerCase();

    // -------------------------------------------------------------
    // CONTEXTO: ANTI-PV GUARDRAILS
    // -------------------------------------------------------------
    if (contextType === 'ANTI_PV') {
      const isSalesQuery = /^(p\d+|c\d+|k\d+|[0-9]{1,2}|oi|ola|olá|menu|catalogo|catálogo|produtos|planos|loja|vitrine|pix|usdt|pedido|status|suporte|humano|atendimento|ajuda|comprar|quero comprar|quanto custa|valor|preco|preço)$/i.test(low) ||
        /(?:quanto\s*(?:custa|t[aá]|sai|fica)|pre[cç]o|valor|comprar|adquirir|vendas?|vitrine|cat[aá]logo|produtos?|planos?|pix|bot|licen[cç]a|aluguel|suporte|atendimento|duvida|dúvida|informa[cç][aõ]es|como\s*funciona)/i.test(low) ||
        low.startsWith('!pix') || low.startsWith('!pedido') || low.startsWith('!status') || low.startsWith('!catalogo') || low.startsWith('!loja') || low.startsWith('!menu') || low.startsWith('/menu');

      if (state.allowSales && isSalesQuery) {
        return {
          intent: 'LEGITIMATE_SALES_INTERACTION',
          confidence: 0.96,
          shouldBlock: false,
          isLegitimateBuyer: true,
          action: 'ALLOW_SALES',
          reason: 'Lead legítimo consultando produtos, preços ou suporte de compras'
        };
      }

      // Detecta ameaça ou spam óbvio
      const isSpam = /(?:ganhe\s*dinheiro|trabalhe\s*de\s*casa|renda\s*extra|vagas\s*abertas|clique\s*no\s*link|bit\.ly|t\.me\/|wa\.me\/)/i.test(low);
      return {
        intent: isSpam ? 'SPAM_THREAT' : 'UNAUTHORIZED_PRIVATE_CONTACT',
        confidence: isSpam ? 0.98 : 0.92,
        shouldBlock: true,
        isLegitimateBuyer: false,
        action: 'BLOCK_AND_WARN',
        reason: isSpam ? 'Detecção de spam/divulgação não autorizada' : 'Contato no privado sem finalidade de compra com Anti-PV ativo'
      };
    }

    // -------------------------------------------------------------
    // CONTEXTO: MENTE DO DONO (OWNER MINDSET)
    // -------------------------------------------------------------
    if (contextType === 'OWNER_MINDSET') {
      const isActionCmd = /(?:reiniciar|ativar|desativar|pausar|limpar|deletar|bloquear|desbloquear|start|stop|restart|status|desliga|liga|executa|manda\s+ver|solta\s+o\s+a[cç]o)/i.test(low) ||
        /^(?:subbot|bot|chave|pix|painel|tunnel|backup)/i.test(low);
      if (isActionCmd) {
        return {
          intent: 'EXECUTE_IMMEDIATE_ACTION',
          confidence: 0.95,
          action: 'DISPATCH_ACTION',
          topic: 'OPERATIONAL_COMMAND'
        };
      }

      const isTeaching = /(?:quando\s+(?:o\s+cliente|algu[eé]m)\s+falar|responda\s+sempre|usa\s+sempre|n[aã]o\s+fale|troca\s+a\s+g[ií]ria|aprenda|nossa\s+meta|minha\s+vis[aã]o)/i.test(low);
      if (isTeaching) {
        return {
          intent: 'TEACH_SLANG_OR_MINDSET',
          confidence: 0.94,
          action: 'FEED_NEURAL_MINDSET',
          topic: 'COGNITIVE_CALIBRATION'
        };
      }

      const isForecast = /(?:previs[aã]o|estat[ií]stica|probabilidade|vai\s+bater|como\s+est[aã]o\s+as\s+vendas|quanto\s+faturamos|relat[oó]rio|briefing|surpreenda|antecipe)/i.test(low);
      if (isForecast) {
        return {
          intent: 'STRATEGIC_FORECAST_REQUEST',
          confidence: 0.97,
          action: 'GENERATE_PREDICTIVE_BRIEFING',
          topic: 'FINANCIAL_INTELLIGENCE'
        };
      }

      return {
        intent: 'CASUAL_FEEDBACK',
        confidence: 0.88,
        action: 'NATURAL_CONVERSATION',
        topic: 'GENERAL_LEADERSHIP'
      };
    }

    // -------------------------------------------------------------
    // CONTEXTO: RADAR VIRAL & MINERAÇÃO DE LEADS EM GRUPOS
    // -------------------------------------------------------------
    if (contextType === 'VIRAL_RADAR') {
      const hasDirectBuyingNeed = /(?:onde\s+(?:\w+\s+){0,3}(?:compro|comprar|acho|encontro)|algu[eé]m\s+(?:\w+\s+){0,3}(?:vende|tem|faz|indica|indica[cç][aã]o)|preciso\s+(?:\w+\s+){0,3}(?:bot|software|app|sistema|painel|licen[cç]a|site)|quem\s+(?:\w+\s+){0,3}(?:vende|desenvolve|fornece)|recomenda[cç][aã]o\s+de|procuro\s+(?:\w+\s+){0,3}comprar|(?:quero|busco)\s+(?:\w+\s+){0,3}(?:comprar|adquirir|contratar))/i.test(low);
      const hasBudget = /(?:tenho\s+(?:grana|or[cç]amento|dinheiro)|pago\s+(?:bem|a\s+vista|no\s+pix)|qual\s+o\s+or[cç]amento|quanto\s+custa)/i.test(low);

      if (hasDirectBuyingNeed) {
        return {
          intent: 'HOT_BUYING_OPPORTUNITY',
          confidence: 0.95,
          isHotLead: true,
          temperature: 'HOT',
          buyingIntentScore: 0.95,
          budgetDetected: hasBudget,
          action: 'STEALTH_ENGAGE',
          recommendedAction: 'Engajar contato ou alertar dono no PV imediatamente'
        };
      }

      const hasCuriosity = /(?:como\s+funciona\s+(?:esse\s+)?bot|algu[eé]m\s+usa|vale\s+a\s+pena|o\s+que\s+[eé]\s+paybot|automa[cç][aã]o\s+whatsapp)/i.test(low);
      if (hasCuriosity) {
        return {
          intent: 'WARM_INTEREST',
          confidence: 0.86,
          isHotLead: true,
          temperature: 'WARM',
          buyingIntentScore: 0.72,
          budgetDetected: false,
          action: 'NURTURE_LEAD',
          recommendedAction: 'Apresentar benefícios e case de sucesso com link da vitrine'
        };
      }

      return {
        intent: 'GENERAL_CHATTER',
        confidence: 0.80,
        isHotLead: false,
        temperature: 'COLD',
        buyingIntentScore: 0.15,
        budgetDetected: false,
        action: 'IGNORE'
      };
    }

    // -------------------------------------------------------------
    // CONTEXTO: GATEWAY ROUTER (ROTEADOR DE ENTRADA DO WHATSAPP)
    // -------------------------------------------------------------
    // 1. Confirmação de PIX / Comprovante
    if (/(?:comprovante|j[aá]\s+paguei|fiz\s+o\s+pix|mandei\s+o\s+pix|t[aá]\s+pago|olha\s+o\s+pix|transfer[ií]|pix\s+enviado)/i.test(low)) {
      return {
        intent: 'PIX_CONFIRMATION',
        confidence: 0.97,
        urgency: 'IMMEDIATE',
        canBypassLlm: true,
        action: 'VERIFY_PAYMENT_PROOF',
        suggestedNext: 'Verificar status Bacen/MercadoPago e enviar entrega automática'
      };
    }

    // 2. Intenção Clara de Compra / Pedido de PIX
    if (/(?:quero\s+(?:comprar|adquirir|fechar|assinar)|manda\s+o\s+pix|passa\s+a\s+chave|vou\s+querer|quero\s+o\s+bot|quero\s+a\s+licen[cç]a|gerar\s+pix|como\s+fa[cç]o\s+pra\s+pagar)/i.test(low)) {
      return {
        intent: 'BUY_INTENT',
        confidence: 0.95,
        urgency: 'HIGH',
        canBypassLlm: true,
        action: 'GENERATE_PAYMENT',
        suggestedNext: 'Disparar QR Code Copia e Cola do PIX sem delongas'
      };
    }

    // 3. Catálogo e Produtos
    if (/(?:cat[aá]logo|produtos|planos|vitrine|loja|valores|tabela\s+de\s+pre[cç]os|o\s+que\s+voc[eê]s\s+vendem)/i.test(low) || /^(?:loja|vitrine|produtos|planos)$/i.test(low)) {
      return {
        intent: 'CATALOG_QUERY',
        confidence: 0.96,
        urgency: 'HIGH',
        canBypassLlm: true,
        action: 'SHOW_STORE_CATALOG',
        suggestedNext: 'Enviar link rastreado da vitrine oficial ou menu visual'
      };
    }

    // 4. Pergunta sobre Preço
    if (/(?:quanto\s*(?:custa|t[aá]|sai|fica)|qual\s*o\s*valor|pre[cç]o\s*d[eo]|qual\s*o\s*pre[cç]o)/i.test(low)) {
      return {
        intent: 'PRICE_QUERY',
        confidence: 0.94,
        urgency: 'HIGH',
        canBypassLlm: false,
        action: 'CONSULTATIVE_PRICING',
        suggestedNext: 'Responder com valor direto e ancoragem de ROI'
      };
    }

    // 5. Suporte Humano
    if (/(?:falar\s+com\s+(?:humano|atendente|suporte|dono)|atendimento\s+humano|n[aã]o\s+[eé]\s+isso|preciso\s+de\s+ajuda|deu\s+erro|n[aã]o\s+recebi)/i.test(low)) {
      return {
        intent: 'SUPPORT_HUMAN',
        confidence: 0.96,
        urgency: 'HIGH',
        canBypassLlm: true,
        action: 'ESCALATE_TO_SUPPORT',
        suggestedNext: 'Criar ticket de suporte e notificar equipe'
      };
    }

    // 5.5 Desinteresse / Recusa Explícita do Produto
    if (/(?:n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+preciso|n[aã]o\s+vou\s+comprar|n[aã]o\s+vou\s+querer|n[aã]o\s+me\s+interessa|valeu\s+mas\s+n[aã]o|obrigad[oa]\s+mas\s+n[aã]o|deixa\s+quieto|t[oô]\s+de\s+boa)/i.test(low)) {
      return {
        intent: 'DISINTEREST',
        confidence: 0.96,
        urgency: 'LOW',
        canBypassLlm: false,
        action: 'HANDLE_DISINTEREST',
        suggestedNext: 'Acolher recusa com elegância e encerrar abordagem sem insistir'
      };
    }

    // 6. Conversa Consultiva Geral
    return {
      intent: 'CHAT_CONSULTATIVE',
      confidence: 0.88,
      urgency: 'MEDIUM',
      canBypassLlm: false,
      action: 'INVOKE_COGNITIVE_SALES',
      suggestedNext: 'Acionar esteira humanizada do CognitiveSalesService'
    };
  }

  // =========================================================================
  // 8. COMUNICAÇÃO COM A API CLOUD TYPESAFE AI (SUB-300MS)
  // =========================================================================
  async _callTypeSafeJevCloud({ endpoint, apiKey, contextType, input, state, schema, timeoutMs }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Client': 'PayBot-JevEngine/1.0'
        },
        body: JSON.stringify({
          model: 'jev-decision-v1',
          context: contextType,
          input,
          state,
          schema: schema || {
            type: 'object',
            properties: {
              intent: { type: 'string' },
              confidence: { type: 'number' },
              urgency: { type: 'string', enum: ['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW'] },
              canBypassLlm: { type: 'boolean' },
              action: { type: 'string' }
            },
            required: ['intent', 'confidence']
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Jev Cloud HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.decision || data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // =========================================================================
  // 9. BUFFER CIRCULAR & TELEMETRIA EM TEMPO REAL
  // =========================================================================
  _addToBuffer(item) {
    this.recentDecisionsBuffer.unshift(item);
    if (this.recentDecisionsBuffer.length > this.maxBufferSize) {
      this.recentDecisionsBuffer.pop();
    }
  }

  getLiveBuffer() {
    return this.recentDecisionsBuffer;
  }

  getTelemetry() {
    const dbTelemetry = models.getJevTelemetry();
    return {
      ...dbTelemetry,
      recentStream: this.recentDecisionsBuffer.slice(0, 15),
      liveEngineStatus: {
        active: this.isEnabled(),
        mode: this.getMode(),
        subMillisecondCapable: true,
        endpoint: this.getEndpoint()
      }
    };
  }

  /**
   * Método interativo para testar frases ao vivo via Painel Web
   */
  async testInteractive(inputText, contextType = 'GATEWAY_ROUTER') {
    return await this.decide({
      contextType,
      input: inputText,
      state: { isTest: true }
    });
  }
}

const jevDecisionService = new JevDecisionService();
module.exports = jevDecisionService;

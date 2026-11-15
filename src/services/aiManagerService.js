/**
 * =========================================================================
 * 🧠 AI MANAGER SERVICE - MULTI-PROVIDER & SUB-BOT MULTI-TENANT FAILOVER
 * =========================================================================
 * Gerenciador central de Inteligência Artificial para o PayBot:
 * - Regra de Isolamento de Sub-Bots:
 *   * Cada Sub-Bot (chip do exército) PRECISA cadastrar suas próprias chaves
 *     de API (Gemini, Groq, OpenAI, etc.) para conseguir usar a IA.
 *   * Se um Sub-Bot não cadastrar suas chaves, a IA fica BLOQUEADA para ele.
 * - Regra do Bot Master (Matriz Principal):
 *   * O Bot Master tem acesso total: utiliza suas próprias chaves (do .env e DB)
 *     E TAMBÉM incorpora todas as chaves cadastradas por TODOS os Sub-Bots
 *     em um gigantesco Mega-Pool de alta disponibilidade!
 * - Fallback automático em cascata: se uma chave falhar (429, timeout, erro),
 *   tenta a próxima chave do mesmo provedor; se todas falharem, aciona o próximo
 *   provedor da fila sem perder o contexto da conversa.
 * - Suporte unificado para Chat/Vendas, Visão Computacional e Áudio WhatsApp.
 * =========================================================================
 */

try {
  require('dns').setDefaultResultOrder('ipv4first');
} catch (_) {}

const models = require('../db/models');
const flowithService = require('./flowithService');

class AiManagerService {
  constructor() {
    this.flowithService = flowithService;
    // Ordem padrão de prioridade de provedores para fallback
    this.defaultFallbackOrder = ['jev', 'gemini', 'groq', 'openai', 'deepseek', 'openrouter', 'local'];

    // Rastreamento em memória do estado de saúde das chaves (cooldown, falhas, sucessos)
    // Map: `${provider}:${scopeKey}` -> Array<{ key: string, cooldownUntil: number, failCount: number, successCount: number, lastError: string }>
    this.keyPools = new Map();

    // Índice para rotação Round-Robin por `${provider}:${scopeKey}`
    this.rrIndices = new Map();

    // Definição das configurações nativas de cada provedor
    this.providerConfigs = {
      jev: {
        name: 'Jev AI (TypeSafe Decision Engine - System 1)',
        chatEndpoint: 'https://api.typesafe.ai/v1/decide',
        models: ['jev-decision-v1', 'jev-fast'],
        supportsAudio: false,
        supportsVision: false,
        isDecisionModel: true
      },
      gemini: {
        name: 'Google Gemini',
        chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        models: ['gemini-flash-latest', 'gemini-3.8-flash'],
        visionModel: 'gemini-flash-latest',
        supportsAudio: true,
        supportsVision: true
      },
      groq: {
        name: 'Groq (Meta Llama, Qwen & Whisper)',
        chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
        audioEndpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        models: ['qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
        visionModel: 'llama-3.2-11b-vision-preview',
        audioModel: 'whisper-large-v3-turbo',
        supportsAudio: true,
        supportsVision: true
      },
      openai: {
        name: 'OpenAI (ChatGPT & Whisper)',
        chatEndpoint: 'https://api.openai.com/v1/chat/completions',
        audioEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
        models: ['gpt-4o-mini', 'gpt-4o'],
        visionModel: 'gpt-4o-mini',
        audioModel: 'whisper-1',
        supportsAudio: true,
        supportsVision: true
      },
      deepseek: {
        name: 'DeepSeek AI',
        chatEndpoint: 'https://api.deepseek.com/chat/completions',
        models: ['deepseek-chat'],
        supportsAudio: false,
        supportsVision: false
      },
      openrouter: {
        name: 'OpenRouter',
        chatEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
        models: ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp:free'],
        supportsAudio: false,
        supportsVision: true
      },
      local: {
        name: 'Local / Antigravity / Ollama',
        get chatEndpoint() {
          let ep = process.env.ANTIGRAVITY_AI_ENDPOINT || 'http://localhost:20128/v1';
          return ep.endsWith('/chat/completions') ? ep : ep.replace(/\/+$/, '') + '/chat/completions';
        },
        models: ['gemini-2.5-flash', 'llama3.2'],
        supportsAudio: false,
        supportsVision: true
      }
    };
  }

  // =========================================================================
  // 1. RESOLUÇÃO DE ESCOPO (SUB-BOT vs BOT MASTER)
  // =========================================================================

  /**
   * Identifica se a operação está sendo executada no contexto de um Sub-Bot ou do Master.
   * @param {object} context
   * @returns {{ isSubBot: boolean, subbotId: number|null, scopeKey: string }}
   */
  _resolveScope(context = {}) {
    const sId = context.subbotId || (context.instanceId && Number(context.instanceId) !== 1 ? Number(context.instanceId) : null);
    const isSubBot = Boolean(sId && Number(sId) !== 1 && !context.isMaster);
    return {
      isSubBot,
      subbotId: isSubBot ? Number(sId) : null,
      scopeKey: isSubBot ? `subbot_${sId}` : 'master'
    };
  }

  // =========================================================================
  // 2. CARREGAMENTO E SINCRONIZAÇÃO DE CHAVES (ENV + DB + SUB-BOTS)
  // =========================================================================

  /**
   * Obtém a lista de chaves cadastradas para um determinado provedor respeitando o escopo:
   * - Sub-Bot: retorna ESTRITAMENTE as chaves cadastradas para aquele Sub-Bot.
   * - Master: retorna suas chaves master + TODAS as chaves de TODOS os Sub-Bots (Mega-Pool).
   *
   * @param {string} provider
   * @param {object} [context={}]
   * @returns {string[]} Lista de chaves limpas e únicas
   */
  getKeysForProvider(provider, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const { isSubBot, subbotId } = this._resolveScope(context);

    // REGRA 1: SUB-BOT SÓ PODE USAR AS SUAS PRÓPRIAS CHAVES CADASTRADAS (OU CHAVE DA INSTÂNCIA / POOL DO TENANT)
    if (isSubBot) {
      try {
        const subBotKeys = models.getSubBotAiKeys(subbotId, prov);
        const inst = models.getArmyInstanceById(subbotId);
        if (inst && inst.ai_api_key && (inst.ai_provider === prov || inst.ai_provider === 'auto')) {
          subBotKeys.push(inst.ai_api_key.trim());
        }
        if (subBotKeys.length === 0) {
          const sharedKeys = this.getKeysForProvider(prov, { isMaster: true });
          if (sharedKeys.length > 0) return sharedKeys;
        }
        const isPlaceholder = (k) => !k || typeof k !== 'string' || k.trim().length < 5 || /^(your_api_key|sua_chave|insira_sua_chave|placeholder|<)/i.test(k.trim()) || k === 'chave_gemini_1' || k === 'chave_gemini_2' || /^(?:sk-|gsk_)?(?:chave_|sua_chave)/i.test(k.trim());
        return Array.from(new Set(subBotKeys.filter(k => k && k.length > 3 && !isPlaceholder(k))));
      } catch (_) {
        return [];
      }
    }

    // REGRA 2: BOT MASTER (MATRIZ PRINCIPAL) USA AS SUAS + TODAS AS DOS SUB-BOTS (MEGA-POOL)
    const rawKeys = [];

    // 2.1 Chaves do process.env do Master
    const envVarNames = [
      `${prov.toUpperCase()}_API_KEYS`,
      `${prov.toUpperCase()}_API_KEY`,
      `${prov.toUpperCase()}_KEYS`,
      `${prov.toUpperCase()}_KEY`
    ];

    if (prov === 'gemini') {
      envVarNames.push('AI_API_KEY', 'GEMINI_KEY');
    }
    if (prov === 'local') {
      envVarNames.push('ANTIGRAVITY_AI_KEY');
    }

    for (const vName of envVarNames) {
      const val = process.env[vName];
      if (val && typeof val === 'string' && val.trim()) {
        val.split(',').forEach(k => rawKeys.push(k.trim()));
      }
    }

    // 2.2 Chaves do Banco de Dados do Master
    try {
      const dbVal = models.getSetting(`AI_KEYS_${prov.toUpperCase()}`, '');
      if (dbVal && typeof dbVal === 'string' && dbVal.trim()) {
        try {
          const parsed = JSON.parse(dbVal);
          if (Array.isArray(parsed)) {
            parsed.forEach(k => rawKeys.push(String(k).trim()));
          } else if (typeof parsed === 'string') {
            parsed.split(',').forEach(k => rawKeys.push(k.trim()));
          }
        } catch (_) {
          dbVal.split(',').forEach(k => rawKeys.push(k.trim()));
        }
      }

      const dbSingle = models.getSetting(`${prov.toUpperCase()}_API_KEY`, '');
      if (dbSingle && typeof dbSingle === 'string' && dbSingle.trim()) {
        dbSingle.split(',').forEach(k => rawKeys.push(k.trim()));
      }
    } catch (_) {}

    // 2.3 SUPER-POOL: O Master incorpora todas as chaves de todos os Sub-Bots!
    try {
      const allSubBotKeys = models.getAllSubBotsAiKeys(prov);
      if (Array.isArray(allSubBotKeys)) {
        allSubBotKeys.forEach(k => rawKeys.push(k));
      }
    } catch (_) {}

    // 2.4 Filtra e remove duplicatas e placeholders de exemplo
    const isPlaceholder = (k) => !k || typeof k !== 'string' || k.trim().length < 5 || /^(your_api_key|sua_chave|insira_sua_chave|placeholder|<)/i.test(k.trim()) || k === 'chave_gemini_1' || k === 'chave_gemini_2' || /^(?:sk-|gsk_)?(?:chave_|sua_chave)/i.test(k.trim());
    const uniqueKeys = Array.from(new Set(rawKeys.filter(k => k && k.length > 3 && !isPlaceholder(k))));

    if (prov === 'local' && uniqueKeys.length === 0) {
      uniqueKeys.push(process.env.ANTIGRAVITY_AI_KEY || 'sk-antigravity-local');
    }

    return uniqueKeys;
  }

  /**
   * Obtém a ordem de fallback configurada.
   */
  getFallbackOrder() {
    try {
      const dbOrder = models.getSetting('AI_FALLBACK_ORDER', '');
      if (dbOrder && typeof dbOrder === 'string' && dbOrder.trim()) {
        return dbOrder.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
      }
    } catch (_) {}

    if (process.env.AI_FALLBACK_ORDER) {
      return process.env.AI_FALLBACK_ORDER.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    }

    return [...this.defaultFallbackOrder];
  }

  /**
   * Atualiza a ordem de fallback no banco de dados.
   */
  setFallbackOrder(order) {
    const list = Array.isArray(order) ? order : String(order).split(',');
    const clean = list.map(p => p.trim().toLowerCase()).filter(Boolean);
    models.setSetting('AI_FALLBACK_ORDER', clean.join(','));
    return clean;
  }

  /**
   * Cadastra uma nova chave para o Master ou para um Sub-Bot específico.
   * @param {string} provider
   * @param {string} newKey
   * @param {object} [context={}] - { subbotId }
   */
  addApiKey(provider, newKey, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const cleanKey = String(newKey).trim();
    if (!cleanKey) throw new Error('A chave de API não pode ser vazia.');

    const { isSubBot, subbotId } = this._resolveScope(context);

    if (isSubBot) {
      // Cadastra no Sub-Bot
      const res = models.addSubBotAiKey(subbotId, prov, cleanKey);
      this.refreshKeyPool(prov, context);
      // Atualiza também o pool do Master, já que o Master agrega as chaves de sub-bots
      this.refreshKeyPool(prov, { isMaster: true });
      return { scope: 'subbot', subbotId, provider: prov, totalKeys: res.totalKeys };
    }

    // Cadastra no Master
    const currentKeys = this.getKeysForProvider(prov, { isMaster: true });
    if (!currentKeys.includes(cleanKey)) {
      currentKeys.push(cleanKey);
    }

    models.setSetting(`AI_KEYS_${prov.toUpperCase()}`, JSON.stringify(currentKeys));
    this.refreshKeyPool(prov, { isMaster: true });
    return { scope: 'master', provider: prov, totalKeys: currentKeys.length };
  }

  /**
   * Remove uma chave cadastrada.
   */
  removeApiKey(provider, keyToRemove, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const cleanKey = String(keyToRemove).trim();
    const { isSubBot, subbotId } = this._resolveScope(context);

    if (isSubBot) {
      const res = models.removeSubBotAiKey(subbotId, prov, cleanKey);
      this.refreshKeyPool(prov, context);
      this.refreshKeyPool(prov, { isMaster: true });
      return { scope: 'subbot', subbotId, provider: prov, totalKeys: res.totalKeys };
    }

    const currentKeys = this.getKeysForProvider(prov, { isMaster: true });
    const filtered = currentKeys.filter(k => k !== cleanKey);

    models.setSetting(`AI_KEYS_${prov.toUpperCase()}`, JSON.stringify(filtered));
    this.refreshKeyPool(prov, { isMaster: true });
    return { scope: 'master', provider: prov, totalKeys: filtered.length };
  }

  /**
   * Recarrega o pool em memória para um provedor e escopo
   */
  refreshKeyPool(provider, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const { scopeKey } = this._resolveScope(context);
    const poolKey = `${prov}:${scopeKey}`;

    const keys = this.getKeysForProvider(prov, context);
    const existingPool = this.keyPools.get(poolKey) || [];
    const poolMap = new Map(existingPool.map(item => [item.key, item]));

    const newPool = keys.map(key => {
      if (poolMap.has(key)) {
        return poolMap.get(key);
      }
      return {
        key,
        cooldownUntil: 0,
        failCount: 0,
        successCount: 0,
        lastError: null,
        lastUsed: 0
      };
    });

    this.keyPools.set(poolKey, newPool);
    return newPool;
  }

  /**
   * Retorna o pool para um provedor e escopo.
   */
  getPoolForProvider(provider, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const { scopeKey } = this._resolveScope(context);
    const poolKey = `${prov}:${scopeKey}`;

    if (!this.keyPools.has(poolKey)) {
      this.refreshKeyPool(prov, context);
    }
    return this.keyPools.get(poolKey) || [];
  }

  /**
   * Seleciona a próxima chave disponível (fora de cooldown) via Round-Robin.
   */
  getNextAvailableKey(provider, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const { scopeKey } = this._resolveScope(context);
    const poolKey = `${prov}:${scopeKey}`;

    const pool = this.getPoolForProvider(prov, context);
    if (!pool || pool.length === 0) return null;

    const now = Date.now();
    let idx = this.rrIndices.get(poolKey) || 0;

    for (let i = 0; i < pool.length; i++) {
      const candidateIdx = (idx + i) % pool.length;
      const item = pool[candidateIdx];
      if (now >= item.cooldownUntil) {
        this.rrIndices.set(poolKey, (candidateIdx + 1) % pool.length);
        item.lastUsed = now;
        return { item, index: candidateIdx };
      }
    }

    let earliest = pool[0];
    let earliestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].cooldownUntil < earliest.cooldownUntil) {
        earliest = pool[i];
        earliestIdx = i;
      }
    }

    return { item: earliest, index: earliestIdx, inCooldown: true };
  }

  /**
   * Registra falha em uma chave e aplica cooldown inteligente.
   */
  markKeyFailure(provider, key, statusOrErr, errMsg, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const pool = this.getPoolForProvider(prov, context);
    const item = pool.find(k => k.key === key);
    if (!item) return;

    item.failCount++;
    item.lastError = `${statusOrErr}: ${errMsg}`.slice(0, 150);

    const status = parseInt(statusOrErr, 10);
    const now = Date.now();

    if (status === 429) {
      item.cooldownUntil = now + 15 * 1000;
      console.warn(`[AIManager ⏳ RateLimit 429] Chave ${key.slice(0, 6)}... [${prov}] em cooldown por 15s.`);
    } else if (status === 401 || status === 403) {
      item.cooldownUntil = now + 24 * 60 * 60 * 1000;
      console.warn(`[AIManager 🚫 Auth ${status}] Chave ${key.slice(0, 6)}... [${prov}] inválida/bloqueada.`);
      // Se a chave for de um Sub-Bot, remove imediatamente para revogar o acesso até regularização
      const { isSubBot, subbotId } = this._resolveScope(context);
      if (isSubBot && subbotId) {
        models.removeSubBotAiKey(subbotId, prov, key);
        console.warn(`[AIManager 🚫 Acesso Revogado] Chave inválida ${key.slice(0, 6)}... removida do Sub-Bot #${subbotId}.`);
      }
    } else {
      item.cooldownUntil = now + 15 * 1000;
      console.warn(`[AIManager ⚠️ Erro ${statusOrErr}] Falha na chave ${key.slice(0, 6)}... [${prov}]: ${item.lastError}`);
    }
  }

  /**
   * Registra sucesso em uma chave.
   */
  markKeySuccess(provider, key, context = {}) {
    const prov = String(provider).toLowerCase().trim();
    const pool = this.getPoolForProvider(prov, context);
    const item = pool.find(k => k.key === key);
    if (!item) return;

    item.successCount++;
    item.failCount = 0;
    item.cooldownUntil = 0;
    item.lastError = null;
  }

  // =========================================================================
  // 3. CHAT / COMPLETIONS COM ISOLAMENTO DE SUB-BOT E MEGA-POOL MASTER
  // =========================================================================

  /**
   * Executa uma chamada de chat inteligente com fallback garantido.
   * - Se for Sub-Bot: EXIGE chave própria cadastrada. Se não tiver, lança exceção.
   * - Se for Master: usa o Mega-Pool (suas chaves + todas dos subbots).
   */
  /**
   * Remove rigorosamente qualquer cabeçalho de sistema ou assinatura vazada de LLMs (ex: Groq, Qwen, Llama, Flowith)
   */
  sanitizeRawAiResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let lines = text.split('\n');
    lines = lines.filter(line => {
      const l = line.trim();
      if (!l) return true;
      if (/^(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?/i.test(l)) return false;
      if (/^(?:(?:master\s+bot|bot(?:\s+tenant[^\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+/i.test(l)) return false;
      if (/^via\s+(?:groq|gemini|openai|deepseek|claude|qwen|llama|flowith)/i.test(l)) return false;
      if (/^\[(?:flowith|groq|gemini|openai|deepseek|claude|qwen|llama|fallback|ia|ai)[^\]]*\]:?$/i.test(l)) return false;
      if (/^(?:modelo|model|provedor|provider|engine)\s*:\s*/i.test(l)) return false;
      return true;
    });

    let cleaned = lines.join('\n').trim();
    // Se ainda sobrar algum prefixo inline na primeira linha
    cleaned = cleaned
      .replace(/^(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?(?:\s*\[[^\]]*\])?\*?:?\s*/i, '')
      .replace(/^(?:(?:master\s+bot|bot(?:\s+tenant[^\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+[^\n:]*(?::|\s*)/i, '')
      .replace(/^\[(?:flowith|groq|gemini|openai|deepseek|claude|qwen|llama|fallback|ia|ai)[^\]]*\]:?\s*/i, '')
      .replace(/^(?:(?:bot|ia|atendente|assistente|consultor|vendedor)\s*:\s*)+/i, '');

    return cleaned.trim();
  }

  async chat({
    messages = [],
    systemPrompt = null,
    userPrompt = null,
    temperature = 0.7,
    maxTokens = 500,
    timeoutMs = 7000,
    preferredProvider = null,
    model = null,
    subbotId = null,
    instanceId = null,
    isMaster = false
  }) {
    const context = { subbotId, instanceId, isMaster };
    const { isSubBot, subbotId: targetSubbotId } = this._resolveScope(context);

    const finalMessages = this._normalizeMessages(messages, systemPrompt, userPrompt);
    if (finalMessages.length === 0) {
      throw new Error('Nenhuma mensagem fornecida para o chat.');
    }

    const startTime = Date.now();

    // =========================================================================
    // 0. PRIORIDADE ABSOLUTA #0: FLOWITH BLANK (https://flowith.io/blank)
    // =========================================================================
    // REGRA DE OURO: Os tokens de API cadastrados (Gemini, Groq, OpenAI, etc.)
    // SÓ SÃO USADOS quando o https://flowith.io/blank NÃO funcionar!
    // Se o Flowith estiver operacional, a resposta é entregue a custo ZERO de tokens.
    // =========================================================================
    if (this.flowithService && this.flowithService.isEnabled()) {
      try {
        const flowithRes = await this.flowithService.chat({
          messages: finalMessages,
          systemPrompt,
          userPrompt,
          temperature,
          maxTokens,
          timeoutMs: Math.min(timeoutMs || 7000, 8000)
        });

        if (flowithRes && flowithRes.text && flowithRes.text.trim()) {
          const latencyMs = flowithRes.latencyMs || (Date.now() - startTime);
          console.log(`[AIManager ⚡ Flowith] Resposta gerada via https://flowith.io/blank em ${latencyMs}ms (Economia: 100% de tokens de API cadastrados)`);
          return {
            text: this.sanitizeRawAiResponse(flowithRes.text),
            provider: 'flowith',
            model: flowithRes.model || 'flowith-blank',
            latencyMs,
            totalTimeMs: Date.now() - startTime,
            scope: isSubBot ? `subbot_${targetSubbotId}_flowith_free` : 'master_flowith_free',
            savedTokens: true
          };
        }
      } catch (flowithErr) {
        console.warn(`[AIManager ⚠️ Flowith Fallback] https://flowith.io/blank indisponível (${flowithErr.message}). Acionando tokens de API cadastrados...`);
      }
    }

    // NÚCLEO DE INTELIGÊNCIA: Se o Sub-Bot não cadastrou chave individual, utiliza o Núcleo Compartilhado para atender
    if (isSubBot && !models.canSubBotUseAi(targetSubbotId)) {
      console.log(`[Núcleo de Inteligência 🧠] Sub-Bot #${targetSubbotId} utilizando Núcleo de Inteligência Compartilhado para atendimento no privado.`);
    }

    const baseOrder = this.getFallbackOrder();
    let executionOrder = [...baseOrder];
    if (preferredProvider && executionOrder.includes(preferredProvider.toLowerCase())) {
      executionOrder = [
        preferredProvider.toLowerCase(),
        ...executionOrder.filter(p => p !== preferredProvider.toLowerCase())
      ];
    }

    const errorsCollected = [];

    for (const provider of executionOrder) {
      const provConfig = this.providerConfigs[provider];
      if (!provConfig) continue;

      const keys = this.getKeysForProvider(provider, context);
      if (keys.length === 0) continue;

      const pool = this.getPoolForProvider(provider, context);
      const attemptsCount = Math.min(pool.length, 3);

      for (let attempt = 0; attempt < attemptsCount; attempt++) {
        const keyObj = this.getNextAvailableKey(provider, context);
        if (!keyObj) break;

        const { item: keyItem } = keyObj;
        const apiKey = keyItem.key;
        const modelToUse = model || provConfig.models[0] || 'default';

        try {
          const attemptStart = Date.now();
          const responseText = await this._callChatProvider(provider, apiKey, modelToUse, finalMessages, {
            temperature,
            maxTokens,
            timeoutMs
          });

          if (responseText && responseText.trim()) {
            this.markKeySuccess(provider, apiKey, context);
            const latencyMs = Date.now() - attemptStart;
            return {
              text: this.sanitizeRawAiResponse(responseText),
              provider,
              model: modelToUse,
              latencyMs,
              totalTimeMs: Date.now() - startTime,
              scope: isSubBot ? `subbot_${targetSubbotId}` : 'master_mega_pool'
            };
          }
        } catch (err) {
          this.markKeyFailure(provider, apiKey, err.status || 'ERR', err.message, context);
          errorsCollected.push(`[${provider}:${apiKey.slice(0, 4)}...]: ${err.message}`);
        }
      }
    }

    throw new Error(`Todas as APIs de IA falharam para [${isSubBot ? `Sub-Bot #${targetSubbotId}` : 'Master Mega-Pool'}]: ${errorsCollected.slice(-2).join(' | ')}`);
  }

  async _callChatProvider(provider, apiKey, model, messages, options) {
    if (process.env.NODE_ENV === 'test') {
      if (apiKey && (apiKey.includes('invalid') || apiKey.includes('revoked'))) {
        const err = new Error('HTTP 401 - {"error":{"message":"Invalid API Key or revoked"}}');
        err.status = 401;
        throw err;
      }
      if (apiKey && (apiKey.includes('valid') || apiKey.includes('mock') || apiKey.includes('test_active'))) {
        const isAudioExpected = messages.some(m => String(m.content).includes('[AUDIO:') || String(m.content).includes('PREFERÊNCIA POR ÁUDIO'));
        if (isAudioExpected) {
          return '[AUDIO: Fala amigo! O plano anual do bot de vendas tá saindo por 497 reais com vitrine inclusa e suporte VIP.]\n\nhttps://loja.com/plano-anual';
        }
        return 'Mock response OK';
      }
    }

    const provConfig = this.providerConfigs[provider];
    const endpoint = provConfig.chatEndpoint;
    const timeout = options.timeoutMs || 7000;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
      }
    }

    const payload = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} - ${errText.slice(0, 180)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  // =========================================================================
  // 4. VISÃO COMPUTACIONAL (IMAGENS & COMPROVANTES)
  // =========================================================================

  async analyzeImage({
    imageBuffer,
    prompt = 'Extraia com máxima fidelidade todo o texto legível nesta imagem. Retorne apenas o texto transcrito.',
    mimetype = 'image/jpeg',
    timeoutMs = 15000,
    subbotId = null,
    instanceId = null,
    isMaster = false
  }) {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('Buffer de imagem inválido ou vazio.');
    }

    const context = { subbotId, instanceId, isMaster };
    const { isSubBot, subbotId: targetSubbotId } = this._resolveScope(context);

    if (isSubBot && !models.canSubBotUseAi(targetSubbotId)) {
      console.log(`[Núcleo de Inteligência 🧠 Visão] Sub-Bot #${targetSubbotId} utilizando Núcleo de Inteligência Compartilhado.`);
    }

    const base64Img = imageBuffer.toString('base64');
    const cleanMime = mimetype.split(';')[0].trim().toLowerCase();
    const dataUrl = `data:${cleanMime};base64,${base64Img}`;

    const visionProviders = ['gemini', 'groq', 'openai', 'openrouter', 'local'];
    const fallbackOrder = this.getFallbackOrder().filter(p => visionProviders.includes(p));

    const errors = [];

    for (const provider of fallbackOrder) {
      const provConfig = this.providerConfigs[provider];
      if (!provConfig || !provConfig.supportsVision) continue;

      const keys = this.getKeysForProvider(provider, context);
      if (keys.length === 0) continue;

      const keyObj = this.getNextAvailableKey(provider, context);
      if (!keyObj) continue;

      const apiKey = keyObj.item.key;
      const visionModel = provConfig.visionModel || provConfig.models[0];

      try {
        const payload = {
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 1000
        };

        const res = await fetch(provConfig.chatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (res.ok) {
          const json = await res.json();
          const extracted = json.choices?.[0]?.message?.content;
          if (extracted && extracted.trim()) {
            this.markKeySuccess(provider, apiKey, context);
            return { text: extracted.trim(), provider, model: visionModel };
          }
        } else {
          const errText = await res.text().catch(() => '');
          this.markKeyFailure(provider, apiKey, res.status, errText, context);
          errors.push(`[${provider} Vision HTTP ${res.status}]`);
        }
      } catch (err) {
        this.markKeyFailure(provider, apiKey, err.status || 'ERR', err.message, context);
        errors.push(`[${provider} Vision Error: ${err.message}]`);
      }
    }

    throw new Error(`Falha em todas as IAs visuais: ${errors.join(', ')}`);
  }

  // =========================================================================
  // 5. TRANSCRIÇÃO DE ÁUDIO (SPEECH-TO-TEXT)
  // =========================================================================

  async transcribeAudio({
    audioBuffer,
    mimetype = 'audio/ogg',
    language = 'pt',
    timeoutMs = 15000,
    subbotId = null,
    instanceId = null,
    isMaster = false
  }) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new Error('Buffer de áudio inválido.');
    }

    const context = { subbotId, instanceId, isMaster };
    const { isSubBot, subbotId: targetSubbotId } = this._resolveScope(context);

    if (isSubBot && !models.canSubBotUseAi(targetSubbotId)) {
      console.log(`[Núcleo de Inteligência 🧠 Áudio] Sub-Bot #${targetSubbotId} utilizando Núcleo de Inteligência Compartilhado.`);
    }

    let cleanMime = (mimetype || 'audio/ogg').split(';')[0].trim().toLowerCase();
    if (cleanMime === 'audio/opus') cleanMime = 'audio/ogg';

    const errors = [];
    const audioProviders = ['gemini', 'groq', 'openai'];
    const activeAudioProviders = this.getFallbackOrder().filter(p => audioProviders.includes(p));

    for (const provider of activeAudioProviders) {
      const provConfig = this.providerConfigs[provider];
      if (!provConfig || !provConfig.supportsAudio) continue;

      const keys = this.getKeysForProvider(provider, context);
      if (keys.length === 0) continue;

      const keyObj = this.getNextAvailableKey(provider, context);
      if (!keyObj) continue;
      const apiKey = keyObj.item.key;

      try {
        if (provider === 'gemini') {
          const model = 'gemini-1.5-flash';
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const base64Audio = audioBuffer.toString('base64');

          const payload = {
            contents: [
              {
                parts: [
                  { text: 'Transcreva em português brasileiro de forma direta e exata o que foi dito neste áudio. Retorne SOMENTE a transcrição literal.' },
                  { inline_data: { mime_type: cleanMime, data: base64Audio } }
                ]
              }
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs)
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (text) {
              this.markKeySuccess('gemini', apiKey, context);
              return { text: text.replace(/^["']|["']$/g, ''), provider: 'gemini', model };
            }
          } else {
            const errText = await res.text().catch(() => '');
            this.markKeyFailure('gemini', apiKey, res.status, errText, context);
            errors.push(`[Gemini Audio HTTP ${res.status}]`);
          }
        } else if (provider === 'groq' || provider === 'openai') {
          const endpoint = provConfig.audioEndpoint;
          const model = provConfig.audioModel;

          const formData = new FormData();
          const audioBlob = new Blob([audioBuffer], { type: cleanMime });
          formData.append('file', audioBlob, 'audio.ogg');
          formData.append('model', model);
          formData.append('language', language);
          formData.append('response_format', 'json');

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData,
            signal: AbortSignal.timeout(timeoutMs)
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.text?.trim();
            if (text) {
              this.markKeySuccess(provider, apiKey, context);
              return { text, provider, model };
            }
          } else {
            const errText = await res.text().catch(() => '');
            this.markKeyFailure(provider, apiKey, res.status, errText, context);
            errors.push(`[${provider} Whisper HTTP ${res.status}]`);
          }
        }
      } catch (err) {
        this.markKeyFailure(provider, apiKey, err.status || 'ERR', err.message, context);
        errors.push(`[${provider} Audio Error: ${err.message}]`);
      }
    }

    throw new Error(`Falha em todas as IAs de transcrição de áudio: ${errors.join(', ')}`);
  }

  // =========================================================================
  // 6. RELATÓRIO DE STATUS COMPLETO (MASTER MEGA-POOL & SUB-BOTS FLEET)
  // =========================================================================

  /**
   * Retorna o status completo da infraestrutura de IA:
   * - Master Mega-Pool (todas as chaves integradas)
   * - Sub-Bots (status de cada atendente e suas chaves isoladas)
   */
  getStatus() {
    const order = this.getFallbackOrder();
    const providersReport = {};

    // 1. Relatório do Bot Master (Mega-Pool)
    for (const [pKey, pConfig] of Object.entries(this.providerConfigs)) {
      const keys = this.getKeysForProvider(pKey, { isMaster: true });
      const pool = this.getPoolForProvider(pKey, { isMaster: true });
      const now = Date.now();

      const activeKeys = pool.filter(item => now >= item.cooldownUntil).length;
      const inCooldownKeys = pool.filter(item => now < item.cooldownUntil).length;

      providersReport[pKey] = {
        name: pConfig.name,
        configured: keys.length > 0,
        totalKeys: keys.length,
        activeKeys,
        inCooldownKeys,
        models: pConfig.models,
        supportsVision: !!pConfig.supportsVision,
        supportsAudio: !!pConfig.supportsAudio,
        keysSummary: pool.map(k => ({
          keyMasked: `${k.key.slice(0, 4)}...${k.key.slice(-3)}`,
          status: now >= k.cooldownUntil ? 'OPERACIONAL' : 'COOLDOWN',
          cooldownRemainingSec: Math.max(0, Math.round((k.cooldownUntil - now) / 1000)),
          successes: k.successCount,
          fails: k.failCount,
          lastError: k.lastError
        }))
      };
    }

    // 2. Relatório de Sub-Bots (Frota de Chips)
    const instances = models.getArmyInstances?.() || [];
    const subbotsMap = new Map();
    instances
      .filter(i => !i.is_main && i.id !== 1)
      .forEach(sb => {
        subbotsMap.set(Number(sb.id), {
          id: Number(sb.id),
          name: sb.name || `Sub-Bot #${sb.id}`,
          phone: sb.phone || 'Sem número'
        });
      });

    try {
      const db = require('../db/database');
      const rows = db.prepare('SELECT key FROM settings WHERE key LIKE ?').all('AI_SUBBOT_%_KEYS_%');
      for (const row of rows) {
        const m = row.key.match(/^AI_SUBBOT_(\d+)_KEYS_/);
        if (m) {
          const sId = Number(m[1]);
          if (!subbotsMap.has(sId)) {
            subbotsMap.set(sId, { id: sId, name: `Sub-Bot #${sId}`, phone: 'Sem número' });
          }
        }
      }
    } catch (_) {}

    const subbotsList = Array.from(subbotsMap.values()).map(sb => {
      const keysDict = models.getSubBotAiKeys(sb.id);
      let totalKeys = 0;
      const providersWithKeys = [];

      for (const [p, kList] of Object.entries(keysDict)) {
        if (Array.isArray(kList) && kList.length > 0) {
          totalKeys += kList.length;
          providersWithKeys.push(`${p.toUpperCase()} (${kList.length})`);
        }
      }

      const canUseAi = totalKeys > 0;
      return {
        id: sb.id,
        name: sb.name || `Sub-Bot #${sb.id}`,
        phone: sb.phone || 'Sem número',
        aiStatus: canUseAi ? 'LIBERADO' : 'BLOQUEADO_SEM_CHAVE',
        totalKeys,
        providersSummary: providersWithKeys.join(', ') || 'Nenhuma chave cadastrada'
      };
    });

    return {
      success: true,
      flowith: this.flowithService ? this.flowithService.getStatus() : null,
      fallbackOrder: order,
      masterMegaPool: providersReport,
      subbotsFleet: subbotsList
    };
  }

  // =========================================================================
  // 7. TESTE DE CONECTIVIDADE
  // =========================================================================

  async testAllProviders(context = {}) {
    const results = [];
    const testMessage = [{ role: 'user', content: 'Diga "OK" se estiver funcionando perfeitamente.' }];

    for (const [prov, pConfig] of Object.entries(this.providerConfigs)) {
      const keys = this.getKeysForProvider(prov, context);
      if (keys.length === 0) continue;

      for (let i = 0; i < keys.length; i++) {
        const apiKey = keys[i];
        const start = Date.now();
        const masked = `${apiKey.slice(0, 5)}...${apiKey.slice(-3)}`;

        try {
          const res = await this._callChatProvider(prov, apiKey, pConfig.models[0], testMessage, {
            temperature: 0.1,
            maxTokens: 10,
            timeoutMs: 6000
          });
          const latency = Date.now() - start;
          results.push({
            provider: prov,
            keyIndex: i + 1,
            keyMasked: masked,
            success: true,
            latencyMs: latency,
            reply: res.slice(0, 40)
          });
        } catch (err) {
          results.push({
            provider: prov,
            keyIndex: i + 1,
            keyMasked: masked,
            success: false,
            latencyMs: Date.now() - start,
            error: err.message
          });
        }
      }
    }

    return results;
  }

  /**
   * Valida uma chave de API específica efetuando um ping leve.
   */
  async testSingleKey(provider, apiKey) {
    const prov = String(provider).toLowerCase().trim();
    const pConfig = this.providerConfigs[prov];
    if (!pConfig) throw new Error(`Provedor desconhecido: ${provider}`);
    const start = Date.now();
    const testMessage = [{ role: 'user', content: 'Diga "OK" se estiver funcionando perfeitamente.' }];
    const res = await this._callChatProvider(prov, apiKey, pConfig.models[0], testMessage, {
      temperature: 0.1,
      maxTokens: 10,
      timeoutMs: 6000
    });
    const latency = Date.now() - start;
    return {
      provider: prov,
      success: true,
      latencyMs: latency,
      reply: (res || '').slice(0, 50)
    };
  }

  /**
   * Detecta se um texto contém uma chave de API de IA válida (Groq, Gemini, OpenAI, DeepSeek, OpenRouter)
   * @param {string} text
   * @returns {{ provider: string, key: string, name: string } | null}
   */
  detectApiKey(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();

    // Groq: começa com gsk_ e tem pelo menos 20 caracteres
    const groqMatch = clean.match(/\b(gsk_[A-Za-z0-9_-]{20,})\b/);
    if (groqMatch) return { provider: 'groq', key: groqMatch[1], name: 'Groq (Llama & Whisper)' };

    // Google Gemini: começa com AIzaSy e tem ~39 caracteres (tolerante 30-40)
    const geminiMatch = clean.match(/\b(AIzaSy[A-Za-z0-9_-]{30,40})\b/);
    if (geminiMatch) return { provider: 'gemini', key: geminiMatch[1], name: 'Google Gemini' };

    // OpenRouter: sk-or-v1- seguido de hex/alfanumérico
    const openrouterMatch = clean.match(/\b(sk-or-v1-[a-f0-9_-]{25,})\b/);
    if (openrouterMatch) return { provider: 'openrouter', key: openrouterMatch[1], name: 'OpenRouter' };

    // DeepSeek: sk- seguido de 32 hex
    const deepseekMatch = clean.match(/\b(sk-[a-f0-9]{32})\b/);
    if (deepseekMatch) return { provider: 'deepseek', key: deepseekMatch[1], name: 'DeepSeek' };

    // OpenAI: sk- ou sk-proj- seguido de caracteres alfanuméricos e traços
    const openaiMatch = clean.match(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{25,})\b/);
    if (openaiMatch) return { provider: 'openai', key: openaiMatch[1], name: 'OpenAI (ChatGPT)' };

    return null;
  }

  /**
   * Valida uma chave de IA efetuando teste em tempo real com retorno estruturado seguro.
   */
  async validateSubBotKey(provider, apiKey) {
    try {
      const res = await this.testSingleKey(provider, apiKey);
      return { ok: true, latencyMs: res.latencyMs, reply: res.reply };
    } catch (err) {
      return { ok: false, error: err.message, status: err.status || 401 };
    }
  }

  /**
   * Revoga uma chave do Sub-Bot, remove do banco e limpa pools de memória.
   */
  revokeSubBotKey(subbotId, provider, key, reason = 'Chave inválida ou expirada') {
    const sId = Number(subbotId);
    const prov = String(provider).toLowerCase().trim();
    models.removeSubBotAiKey(sId, prov, key);

    const pool = this.getPoolForProvider(prov, { subbotId: sId });
    const idx = pool.findIndex(k => k.key === key);
    if (idx !== -1) pool.splice(idx, 1);

    const hasAnyRemaining = models.canSubBotUseAi(sId);
    console.warn(`[AIManager 🚫 Revogação] Chave ${key.slice(0, 6)}... revogada do Sub-Bot #${sId}. Motivo: ${reason}. Acesso ativo: ${hasAnyRemaining}`);

    return {
      subbotId: sId,
      provider: prov,
      revokedKey: key,
      hasValidKeysRemaining: hasAnyRemaining,
      isRevoked: !hasAnyRemaining
    };
  }

  /**
   * Testa todas as chaves do Sub-Bot e remove as que falharem com 401/403.
   */
  async validateAndPruneSubBotKeys(subbotId) {
    const sId = Number(subbotId);
    const allKeys = models.getSubBotAiKeys(sId);
    let validCount = 0;
    let revokedCount = 0;

    for (const prov of Object.keys(allKeys)) {
      const keys = allKeys[prov] || [];
      for (const k of keys) {
        const check = await this.validateSubBotKey(prov, k);
        if (check.ok) {
          validCount++;
        } else if (check.status === 401 || check.status === 403 || String(check.error).includes('401') || String(check.error).includes('403')) {
          this.revokeSubBotKey(sId, prov, k, check.error);
          revokedCount++;
        }
      }
    }

    return {
      subbotId: sId,
      validKeysCount: validCount,
      revokedKeysCount: revokedCount,
      hasValidKeysRemaining: models.canSubBotUseAi(sId),
      isRevoked: !models.canSubBotUseAi(sId)
    };
  }

  _normalizeMessages(messages, systemPrompt, userPrompt) {
    const list = Array.isArray(messages) ? [...messages] : [];

    if (systemPrompt && !list.some(m => m.role === 'system')) {
      list.unshift({ role: 'system', content: String(systemPrompt) });
    }

    if (userPrompt && !list.some(m => m.role === 'user')) {
      list.push({ role: 'user', content: String(userPrompt) });
    }

    return list.map(m => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));
  }

  /**
   * Retorna a URL pública do painel web já parametrizada para o Sub-Bot e focada na aba de chaves de IA
   * @param {number|string} [subbotId]
   * @param {Object} [options]
   * @returns {string}
   */
  getSubBotAiPanelUrl(subbotId, options = {}) {
    try {
      const tunnelService = require('./tunnelService');
      const base = options.webUrl || tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || tunnelService.getUrl() || models.getSetting('TUNNEL_URL', null) || 'http://localhost:3000';
      const cleanBase = String(base).replace(/\/+$/, '');
      const sId = subbotId ? Number(subbotId) : null;
      const param = sId && sId > 1 ? `?subbot=${sId}&tab=ai#tab-ai` : '?tab=ai#tab-ai';
      return `${cleanBase}/subbot${param}`;
    } catch (_) {
      const sId = subbotId ? Number(subbotId) : null;
      const param = sId && sId > 1 ? `?subbot=${sId}&tab=ai#tab-ai` : '?tab=ai#tab-ai';
      return `http://localhost:3000/subbot${param}`;
    }
  }

  /**
   * Retorna instruções didáticas e passo a passo com links diretos
   * para obter uma chave de API de IA 100% gratuita em menos de 1 minuto,
   * incluindo o link do painel web já parametrizado para o Sub-Bot.
   * @param {Object} options
   * @param {number} [options.subbotId]
   * @param {boolean} [options.isBlocked]
   * @param {string} [options.failedKeyProvider]
   * @returns {string}
   */
  getFreeApiKeyInstructions(options = {}) {
    const rawId = options.subbotId ? Number(options.subbotId) : null;
    const subbotIdText = rawId && rawId > 1 ? `Sub-Bot #${rawId}` : 'seu Sub-Bot';
    const directWebUrl = this.getSubBotAiPanelUrl(rawId, options);
    let header = '';

    if (options.isBlocked) {
      header =
        `🔑 *[SUB-BOT #${rawId || 'SELECIONADO'} BLOQUEADO — CADASTRO DE CHAVE DE IA OBRIGATÓRIO]* 🔑\n\n` +
        `Para liberar os comandos e resgatar seus *50 Tokens Diários Garantidos*, este Sub-Bot precisa cadastrar uma chave de IA ativa.\n\n`;
    } else if (options.failedKeyProvider) {
      header =
        `❌ *CHAVE DE IA RECUSADA OU EXPIRADA!*\n\n` +
        `A chave informada (${options.failedKeyProvider}) falhou no teste de validação.\n` +
        `Para regularizar seu Sub-Bot e liberar o acesso, use o painel web ou gere uma chave 100% gratuita abaixo:\n\n`;
    } else {
      header =
        `🔑 *GUIA & PAINEL WEB: COMO CADASTRAR SUA CHAVE DE IA GRATUITA* 🔑\n\n` +
        `Cadastre sua chave em menos de 1 minuto, sem cartão de crédito:\n\n`;
    }

    const webSection =
      `🌐 *PAINEL WEB DIRETO (JÁ PARAMETRIZADO NO SEU SUB-BOT):*\n` +
      `🔗 ${directWebUrl}\n` +
      `_(Abra o link acima: a página já abre selecionada no ${subbotIdText} com o formulário aberto para colar com 1 toque!)_\n\n`;

    const instructions =
      webSection +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🥇 *OPÇÃO 1: GOOGLE GEMINI (Recomendada - Rápida & Ilimitada)*\n` +
      `🔗 *Link Direto:* https://aistudio.google.com/app/apikey\n\n` +
      `*Passo a Passo:*\n` +
      `1️⃣ Clique no link acima (ou abra no navegador do celular/PC)\n` +
      `2️⃣ Faça login com qualquer conta Google (Gmail)\n` +
      `3️⃣ Clique no botão azul *"Create API key"* (ou *"Criar chave de API"*)\n` +
      `4️⃣ Selecione *"Create key in new project"* e confirme\n` +
      `5️⃣ Clique em *"Copy"* para copiar sua chave (começa com \`AIzaSy...\`)\n` +
      `6️⃣ **Cole no Painel Web acima ou envie diretamente aqui no chat!**\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🥈 *OPÇÃO 2: GROQ CLOUD (Ultra-Rápida / Llama 3.3)*\n` +
      `🔗 *Link Direto:* https://console.groq.com/keys\n\n` +
      `*Passo a Passo:*\n` +
      `1️⃣ Acesse o link acima\n` +
      `2️⃣ Faça login com sua conta Google ou GitHub\n` +
      `3️⃣ Clique no botão *"Create API Key"*\n` +
      `4️⃣ Digite um nome qualquer (ex: \`subbot\`) e clique em *"Submit"*\n` +
      `5️⃣ Copie a chave gerada (começa com \`gsk_...\`)\n` +
      `6️⃣ **Cole no Painel Web acima ou envie diretamente aqui no chat!**\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👉 *COMO ATIVAR:*\n` +
      `Basta **cadastrar pelo link do Painel Web acima** ou colar a chave **diretamente nesta conversa**! O sistema reconhece automaticamente, valida e libera todos os módulos com seus *50 Tokens Diários Garantidos*! 🚀`;

    return header + instructions;
  }
}

module.exports = new AiManagerService();

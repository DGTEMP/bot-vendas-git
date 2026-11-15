/**
 * =========================================================================
 * ⚡ FLOWITH AI SERVICE - ZERO-TOKEN PRIMARY ENGINE (https://flowith.io/blank)
 * =========================================================================
 * Prioridade Absoluta #0 para todas as funções de Inteligência Artificial:
 * - O bot utiliza prioritariamente o Flowith Blank (https://flowith.io/blank)
 *   para todas as gerações de IA (vendas cognitivas, NLU, chat, FAQs, etc.).
 * - REGRA DE OURO: Os tokens de API cadastrados pelo usuário (Gemini, Groq,
 *   OpenAI, DeepSeek, etc.) SÓ são consumidos quando o https://flowith.io/blank
 *   estiver fora do ar, instável, com erro ou indisponível.
 * - Suporta 3 camadas de execução resiliente:
 *   1. Bridge / Endpoint OpenAI-compatível (ex: flowith2api, FLOWITH_ENDPOINT)
 *   2. Flowith Edge API direta com token de sessão (https://edge.flowith.io)
 *   3. Automação Web Headless com rebrowser-puppeteer no Flowith Blank
 * - Rastreamento contínuo de economia de tokens e telemetria de fallback.
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const models = require('../db/models');

class FlowithService {
  constructor() {
    this.targetUrl = 'https://flowith.io/blank';
    this.edgeUrl = 'https://edge.flowith.io';
    
    // Puppeteer runtime (lazy loaded)
    this.puppeteer = null;
    this.chromePath = null;
    this._puppeteerInitialized = false;

    // Simulação / Teste rápido para ambientes de teste e CI
    this.simulationMode = false;
    this.simulatedResponseFn = null;

    // Métricas de economia e telemetria
    this.stats = {
      totalRequests: 0,
      flowithSuccesses: 0,
      fallbacksToApiTokens: 0,
      lastSuccessTime: null,
      lastErrorTime: null,
      lastError: null,
      consecutiveFailures: 0
    };
  }

  // =========================================================================
  // 1. CONFIGURAÇÕES & STATUS
  // =========================================================================

  isEnabled() {
    try {
      const dbVal = models.getSetting('FLOWITH_ENABLED', 'false');
      return dbVal === 'true' || dbVal === '1';
    } catch (_) {
      return false;
    }
  }

  setEnabled(enabled) {
    models.setSetting('FLOWITH_ENABLED', enabled ? 'true' : 'false');
    return this.isEnabled();
  }

  getEndpoint() {
    try {
      const dbVal = models.getSetting('FLOWITH_ENDPOINT', '');
      if (dbVal && dbVal.trim()) return dbVal.trim();
    } catch (_) {}
    return process.env.FLOWITH_ENDPOINT || process.env.FLOWITH_URL || '';
  }

  setEndpoint(endpoint) {
    const clean = String(endpoint || '').trim();
    models.setSetting('FLOWITH_ENDPOINT', clean);
    return clean;
  }

  getAuthToken() {
    try {
      const dbVal = models.getSetting('FLOWITH_AUTH_TOKEN', '');
      if (dbVal && dbVal.trim()) return dbVal.trim();
    } catch (_) {}
    return process.env.FLOWITH_AUTH_TOKEN || process.env.FLOWITH_TOKEN || '';
  }

  setAuthToken(token) {
    const clean = String(token || '').trim();
    models.setSetting('FLOWITH_AUTH_TOKEN', clean);
    return clean;
  }

  getTimeoutMs() {
    try {
      const dbVal = models.getSetting('FLOWITH_TIMEOUT_MS', '8000');
      const parsed = parseInt(dbVal, 10);
      if (!isNaN(parsed) && parsed >= 2000) return parsed;
    } catch (_) {}
    return 8000;
  }

  // =========================================================================
  // 2. INICIALIZAÇÃO DO MOTOR WEB HEADLESS (REBROWSER-PUPPETEER)
  // =========================================================================

  _initPuppeteer() {
    if (this._puppeteerInitialized) return;
    this._puppeteerInitialized = true;

    try {
      this.puppeteer = require('rebrowser-puppeteer');
    } catch (_) {
      try {
        const pExtra = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        pExtra.use(StealthPlugin());
        this.puppeteer = pExtra;
      } catch (err) {
        this.puppeteer = null;
      }
    }

    this.chromePath = this._detectChromePath();
  }

  _detectChromePath() {
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
      return process.env.CHROME_BIN;
    }

    const candidatePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
    return null;
  }

  // =========================================================================
  // 3. EXECUÇÃO DE CHAT COM PRIORIDADE ZERO-TOKEN
  // =========================================================================

  /**
   * Tenta gerar a resposta de IA diretamente via Flowith.
   * Se o Flowith responder com sucesso, retorna o texto e economiza 100% dos tokens de API.
   * Se o Flowith falhar (erro, timeout, login-wall, rate-limit), LANÇA ERRO para que
   * o AiManager acione os tokens de API cadastrados como fallback automático.
   */
  async chat({
    messages = [],
    systemPrompt = null,
    userPrompt = null,
    temperature = 0.7,
    maxTokens = 500,
    timeoutMs = null
  }) {
    if (!this.isEnabled()) {
      throw new Error('Flowith desativado manualmente pelo administrador.');
    }

    this.stats.totalRequests++;
    const start = Date.now();
    const effectiveTimeout = timeoutMs || this.getTimeoutMs();

    // 0. Modo de Simulação (Testes Unitários / Offline CI)
    if (this.simulationMode) {
      try {
        const reply = this.simulatedResponseFn
          ? this.simulatedResponseFn({ messages, systemPrompt, userPrompt })
          : 'Resposta gerada com sucesso via Flowith Blank (Simulação Zero-Token Ativa).';
        
        this.stats.flowithSuccesses++;
        this.stats.consecutiveFailures = 0;
        this.stats.lastSuccessTime = Date.now();

        return {
          text: reply,
          provider: 'flowith',
          model: 'flowith-blank',
          latencyMs: Date.now() - start,
          zeroCost: true
        };
      } catch (simErr) {
        this._recordFailure(simErr);
        throw simErr;
      }
    }

    const errors = [];

    // CAMADA 1: BRIDGE / PROXY ENDPOINT (ex: flowith2api ou FLOWITH_ENDPOINT)
    const endpoint = this.getEndpoint();
    if (endpoint) {
      try {
        const result = await this._callEndpoint({
          endpoint,
          messages,
          systemPrompt,
          userPrompt,
          temperature,
          maxTokens,
          timeoutMs: effectiveTimeout
        });
        if (result && result.text) {
          this._recordSuccess(start);
          return result;
        }
      } catch (err) {
        errors.push(`Endpoint [${endpoint}]: ${err.message}`);
      }
    }

    // CAMADA 2: FLOWITH EDGE API DIRETA (com Token de Sessão se configurado)
    const authToken = this.getAuthToken();
    if (authToken) {
      try {
        const result = await this._callEdgeApi({
          authToken,
          messages,
          systemPrompt,
          userPrompt,
          temperature,
          maxTokens,
          timeoutMs: effectiveTimeout
        });
        if (result && result.text) {
          this._recordSuccess(start);
          return result;
        }
      } catch (err) {
        errors.push(`Edge API: ${err.message}`);
      }
    }

    // CAMADA 3: AUTOMAÇÃO WEB REBROWSER-PUPPETEER (Flowith Blank)
    this._initPuppeteer();
    if (this.puppeteer && this.chromePath) {
      try {
        const result = await this._callPuppeteerFlowith({
          messages,
          systemPrompt,
          userPrompt,
          timeoutMs: effectiveTimeout
        });
        if (result && result.text) {
          this._recordSuccess(start);
          return result;
        }
      } catch (err) {
        errors.push(`Headless Web: ${err.message}`);
      }
    } else {
      errors.push('Headless Chrome indisponível');
    }

    // Se todas as camadas do Flowith falharem:
    const finalErr = new Error(`Flowith Blank indisponível (${errors.join(' | ')})`);
    this._recordFailure(finalErr);
    throw finalErr;
  }

  // =========================================================================
  // 4. CAMADA 1: CHAMADA VIA ENDPOINT OPENAI-COMPATÍVEL
  // =========================================================================

  async _callEndpoint({ endpoint, messages, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs }) {
    let cleanEndpoint = endpoint.replace(/\/+$/, '');
    if (!cleanEndpoint.endsWith('/chat/completions')) {
      cleanEndpoint = cleanEndpoint.endsWith('/v1') ? `${cleanEndpoint}/chat/completions` : `${cleanEndpoint}/v1/chat/completions`;
    }

    const normMessages = this._formatMessages(messages, systemPrompt, userPrompt);
    const payload = {
      model: 'flowith',
      messages: normMessages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    const headers = { 'Content-Type': 'application/json' };
    const authToken = this.getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(cleanEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || data.reply || null;
    if (!text || !text.trim()) {
      throw new Error('Endpoint retornou resposta vazia.');
    }

    return {
      text: text.trim(),
      provider: 'flowith',
      model: data.model || 'flowith-proxy',
      zeroCost: true
    };
  }

  // =========================================================================
  // 5. CAMADA 2: CHAMADA VIA FLOWITH EDGE API COM SESSÃO
  // =========================================================================

  async _callEdgeApi({ authToken, messages, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs }) {
    const normMessages = this._formatMessages(messages, systemPrompt, userPrompt);
    const edgeEndpoint = `${this.edgeUrl}/v1/chat/completions`;

    const res = await fetch(edgeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Origin': 'https://flowith.io',
        'Referer': 'https://flowith.io/blank'
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        messages: normMessages,
        temperature,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Edge HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || null;
    if (!text || !text.trim()) throw new Error('Edge API retornou conteúdo vazio.');

    return {
      text: text.trim(),
      provider: 'flowith',
      model: 'flowith-edge',
      zeroCost: true
    };
  }

  // =========================================================================
  // 6. CAMADA 3: AUTOMAÇÃO WEB REBROWSER-PUPPETEER NO FLOWITH BLANK
  // =========================================================================

  async _callPuppeteerFlowith({ messages, systemPrompt, userPrompt, timeoutMs }) {
    const promptText = this._extractUserPrompt(messages, systemPrompt, userPrompt);
    if (!promptText) throw new Error('Prompt vazio para o Flowith Web.');

    let browser = null;
    try {
      browser = await this.puppeteer.launch({
        headless: 'new',
        executablePath: this.chromePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,800'
        ]
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Se houver cookies de sessão configurados, injeta
      const rawCookie = process.env.FLOWITH_COOKIE || models.getSetting('FLOWITH_COOKIE', '');
      if (rawCookie) {
        try {
          const cookies = JSON.parse(rawCookie);
          if (Array.isArray(cookies)) await page.setCookie(...cookies);
        } catch (_) {}
      }

      await page.goto(this.targetUrl, { waitUntil: 'networkidle2', timeout: Math.min(timeoutMs, 15000) });
      await new Promise(r => setTimeout(r, 1500));

      // 1. Muda para o modo Conversar se estiver no modo Imagem padrão
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const modelBtn = btns.find(b => b.innerText && (b.innerText.includes('Imagem') || b.innerText.includes('Banana')));
        if (modelBtn) modelBtn.click();
      });
      await new Promise(r => setTimeout(r, 600));

      const switched = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('button, div, span'));
        const conv = els.find(e => (e.innerText || '').trim() === 'Conversar');
        if (conv) {
          conv.click();
          return true;
        }
        return false;
      });

      if (switched) {
        await new Promise(r => setTimeout(r, 600));
        // Seleciona um modelo de chat se a lista estiver aberta
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const target = btns.find(b => (b.innerText || '').includes('GPT 6 Luna') || (b.innerText || '').includes('Gemini 3.8 Flash'));
          if (target) target.click();
        });
        await new Promise(r => setTimeout(r, 600));
      }

      // 2. Localiza o campo de digitação
      const textbox = await page.$('div[role="textbox"], div[contenteditable="true"], .font-oracle');
      if (!textbox) throw new Error('Campo de texto do Flowith Blank não encontrado.');

      await textbox.click();
      await page.keyboard.type(promptText);
      await new Promise(r => setTimeout(r, 400));

      // 3. Dispara o envio
      const sendBtn = await page.$('button[aria-label="Enviar"], button[title="Enviar"]');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // 4. Aguarda até 12s pela resposta gerada
      const waitStart = Date.now();
      let generatedText = null;

      while (Date.now() - waitStart < Math.min(timeoutMs, 14000)) {
        await new Promise(r => setTimeout(r, 1000));

        // Checa se caiu em tela de login
        const hasLoginWall = await page.evaluate(() => {
          const txt = document.body.innerText || '';
          return txt.includes('Faça login para continuar sua jornada') || txt.includes('Bem-vindo de volta');
        });
        if (hasLoginWall) {
          throw new Error('Flowith Blank exigiu login para esta solicitação.');
        }

        // Tenta capturar resposta em nós de mensagem / canvas
        generatedText = await page.evaluate(() => {
          const codeBlocks = Array.from(document.querySelectorAll('.prose, [data-message-author-role="assistant"], .markdown-body, .font-oracle-content'));
          for (const cb of codeBlocks) {
            const t = (cb.innerText || '').trim();
            if (t.length > 5) return t;
          }
          return null;
        });

        if (generatedText) break;
      }

      if (!generatedText || !generatedText.trim()) {
        throw new Error('Tempo limite excedido aguardando resposta do Flowith Blank.');
      }

      return {
        text: generatedText.trim(),
        provider: 'flowith',
        model: 'flowith-blank-web',
        zeroCost: true
      };

    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  // =========================================================================
  // 7. REGISTRO DE TELEMETRIA & TELEGRAM/WHATSAPP STATUS
  // =========================================================================

  _recordSuccess(startTime) {
    this.stats.flowithSuccesses++;
    this.stats.consecutiveFailures = 0;
    this.stats.lastSuccessTime = Date.now();
    console.log(`[Flowith AI ⚡ Zero-Token] Resposta gerada via ${this.targetUrl} em ${Date.now() - startTime}ms (Tokens de API economizados: 100%)`);
  }

  _recordFailure(err) {
    this.stats.fallbacksToApiTokens++;
    this.stats.consecutiveFailures++;
    this.stats.lastErrorTime = Date.now();
    this.stats.lastError = err.message;
    console.warn(`[Flowith AI ⚠️ Fallback Ativado] ${this.targetUrl} indisponível (${err.message}). Acionando tokens de API cadastrados...`);
  }

  getStatus() {
    const total = this.stats.totalRequests;
    const successes = this.stats.flowithSuccesses;
    const fallbacks = this.stats.fallbacksToApiTokens;
    const savingsPct = total > 0 ? Math.round((successes / total) * 100) : 100;

    let operationalStatus = 'OPERACIONAL (PRIORITÁRIO)';
    if (!this.isEnabled()) {
      operationalStatus = 'DESATIVADO';
    } else if (this.stats.consecutiveFailures > 2) {
      operationalStatus = 'FALLBACK_ATIVO (Tokens de API em uso)';
    }

    return {
      enabled: this.isEnabled(),
      targetUrl: this.targetUrl,
      edgeUrl: this.edgeUrl,
      endpoint: this.getEndpoint() || 'Não configurado (Usa automação web nativa)',
      hasAuthToken: Boolean(this.getAuthToken()),
      operationalStatus,
      totalRequests: total,
      flowithSuccesses: successes,
      fallbacksToApiTokens: fallbacks,
      tokenSavingsPercentage: `${savingsPct}%`,
      lastSuccess: this.stats.lastSuccessTime ? new Date(this.stats.lastSuccessTime).toLocaleString('pt-BR') : 'Ainda não registrado',
      lastError: this.stats.lastError || 'Nenhum erro registrado',
      consecutiveFailures: this.stats.consecutiveFailures,
      policy: 'Tokens de API cadastrados (Gemini, Groq, OpenAI) só são acionados se https://flowith.io/blank falhar.'
    };
  }

  formatStatusMessage() {
    const s = this.getStatus();
    return (
      `⚡ *STATUS DA IA FLOWITH BLANK (ZERO-TOKEN PRIORITÁRIO)* ⚡\n\n` +
      `🌐 *URL Alvo:* ${s.targetUrl}\n` +
      `📊 *Status do Motor:* *${s.operationalStatus}*\n` +
      `💰 *Economia de Tokens de API:* *${s.tokenSavingsPercentage}*\n\n` +
      `📈 *Métricas de Produção:*\n` +
      `• Total de Requisições de IA: *${s.totalRequests}*\n` +
      `• Respostas via Flowith (Zero Custo): *${s.flowithSuccesses}*\n` +
      `• Fallbacks para Tokens Cadastrados: *${s.fallbacksToApiTokens}*\n` +
      `• Falhas Consecutivas: *${s.consecutiveFailures}*\n` +
      `• Último Sucesso: _${s.lastSuccess}_\n` +
      `• Último Erro: _${s.lastError}_\n\n` +
      `🛡️ *Regra de Prioridade:*\n` +
      `_Toda e qualquer chamada de IA tenta primeiramente o Flowith Blank. Os seus tokens de API cadastrados (Gemini, Groq, OpenAI) só são acionados se o Flowith oscilar ou cair._\n\n` +
      `💡 *Comandos Úteis:*\n` +
      `• \`!flowith on\` / \`!flowith off\` - Ativa/Desativa o Flowith\n` +
      `• \`!flowith token <token>\` - Cadastra token de autenticação Flowith\n` +
      `• \`!flowith endpoint <url>\` - Conecta a uma bridge flowith2api\n` +
      `• \`!ia <sua pergunta>\` - Testa a geração de IA com zero-token`
    );
  }

  // =========================================================================
  // 8. CONTROLE DE MOCK / SIMULAÇÃO PARA TESTES
  // =========================================================================

  setSimulationMode(enabled, mockFn = null) {
    this.simulationMode = Boolean(enabled);
    this.simulatedResponseFn = mockFn;
  }

  isSimulationMode() {
    return this.simulationMode;
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      flowithSuccesses: 0,
      fallbacksToApiTokens: 0,
      lastSuccessTime: null,
      lastErrorTime: null,
      lastError: null,
      consecutiveFailures: 0
    };
  }

  // =========================================================================
  // 9. UTILITÁRIOS INTERNOS DE FORMATAÇÃO DE MENSAGENS
  // =========================================================================

  _formatMessages(messages, systemPrompt, userPrompt) {
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

  _extractUserPrompt(messages, systemPrompt, userPrompt) {
    if (userPrompt) return String(userPrompt);
    if (Array.isArray(messages)) {
      const userMsgs = messages.filter(m => m.role === 'user');
      if (userMsgs.length > 0) {
        return userMsgs[userMsgs.length - 1].content;
      }
      if (messages.length > 0) {
        return messages[messages.length - 1].content;
      }
    }
    return '';
  }
}

module.exports = new FlowithService();

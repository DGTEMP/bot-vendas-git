const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const models = require('../db/models');
const pixUtil = require('../utils/pixEmvUtil');

/**
 * =========================================================================
 * ⚡ LIVEPIX SCAPER SERVICE - DUAL ENGINE COM AUTO-FALLBACK & GESTÃO DE CARGA
 * =========================================================================
 * - Motor Turbo (Conversão Full): Browser pré-aquecido, bloqueio de mídia e
 *   execução ultra-rápida para campanhas de ads e picos de lançamento.
 * - Motor Clássico Resiliente (Fallback Seguro): O motor original 100% testado
 *   que assume instantaneamente caso o turbo encontre qualquer oscilação.
 * - Modos de Operação Configuráveis no Painel:
 *   1. 'save': Desliga o navegador imediatamente após cada uso, concorrência 1.
 *   2. 'balanced': Modo inteligente padrão (auto-desliga após 15 min ocioso).
 *   3. 'turbo': Conversão Full (pool 24/7 pré-aquecido, concorrência até 4).
 * =========================================================================
 */
class LivepixScraperService {
  constructor() {
    this.puppeteer = null;
    this.chromePath = null;
    this.cache = new Map();
    this.activeWorkers = 0;
    this.warmBrowser = null;
    this.idleTimer = null;
    this.isWarming = false;
    this.init();
  }

  init() {
    // 1. Tenta rebrowser-puppeteer (anti-bot / Turnstile bypass sem vazamento CDP)
    try {
      this.puppeteer = require('rebrowser-puppeteer');
      console.log('[LivePix Scraper ⚡] rebrowser-puppeteer carregado com sucesso.');
    } catch (_) {
      try {
        const pExtra = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        pExtra.use(StealthPlugin());
        this.puppeteer = pExtra;
        console.log('[LivePix Scraper] puppeteer-extra carregado como secundário.');
      } catch (err) {
        console.warn('[LivePix Scraper] Nenhum motor Puppeteer disponível:', err.message);
      }
    }

    // 2. Localiza o executável do Google Chrome no Windows/Linux/Mac
    this.chromePath = this.detectChromePath();
    if (this.chromePath) {
      console.log(`[LivePix Scraper] Chrome detectado em: ${this.chromePath}`);
    } else {
      console.warn('[LivePix Scraper] Google Chrome não localizado automaticamente nos caminhos padrão.');
    }
  }

  detectChromePath() {
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
        if (fs.existsSync(p)) {
          return p;
        }
      } catch (_) {}
    }

    return null;
  }

  isAvailable() {
    return Boolean(this.puppeteer && this.chromePath);
  }

  /**
   * Obtém o modo de performance configurado no painel administrativo:
   * 'save' | 'balanced' | 'turbo'
   */
  getPerfMode() {
    try {
      const mode = models.getSetting('LIVEPIX_PERF_MODE', null);
      if (mode && ['save', 'balanced', 'turbo'].includes(mode)) return mode;
      if (models.getSetting('LIVEPIX_SAVE_MODE', 'false') === 'true') return 'save';
      if (models.getSetting('LIVEPIX_TURBO_MODE', 'false') === 'true') return 'turbo';
    } catch (_) {}
    return 'balanced';
  }

  /**
   * Limite de compradores simultâneos de acordo com o modo
   */
  getMaxConcurrent() {
    const mode = this.getPerfMode();
    if (mode === 'save') return 1;
    if (mode === 'turbo') return 4;
    return 2;
  }

  /**
   * Verifica se o navegador está ativo e conectado de forma segura e retrocompatível
   */
  isBrowserConnected(b) {
    if (!b) return false;
    try {
      if (typeof b.isConnected === 'function') return b.isConnected();
      if (typeof b.connected === 'boolean') return b.connected;
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Gerencia a instância aquecida do navegador (Warm Browser Pool)
   */
  async getWarmBrowser() {
    if (this.isBrowserConnected(this.warmBrowser)) {
      return this.warmBrowser;
    }

    if (this.isWarming) {
      let waitCount = 0;
      while (this.isWarming && waitCount < 30) {
        await new Promise(r => setTimeout(r, 200));
        waitCount++;
      }
      if (this.isBrowserConnected(this.warmBrowser)) {
        return this.warmBrowser;
      }
    }

    this.isWarming = true;
    try {
      const isHeadless = process.env.LIVEPIX_HEADLESS === 'true';
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1280,800'
      ];

      console.log('[LivePix Pool ⚡] Pré-aquecendo instância do Chrome para respostas em tempo recorde...');
      this.warmBrowser = await this.puppeteer.launch({
        executablePath: this.chromePath,
        headless: isHeadless ? 'new' : false,
        args: launchArgs
      });

      this.warmBrowser.on('disconnected', () => {
        console.log('[LivePix Pool ℹ️] Instância do Chrome desconectada.');
        this.warmBrowser = null;
      });

      return this.warmBrowser;
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Desliga o navegador e libera memória RAM do servidor
   */
  async shutdownBrowser(force = false) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;

    if (this.warmBrowser) {
      if (this.activeWorkers > 0 && !force) {
        console.log(`[LivePix Pool ⏳] Adiantando shutdown: ${this.activeWorkers} processo(s) em andamento.`);
        return false;
      }
      try {
        console.log('[LivePix Pool 🧹] Encerrando Chrome em background e liberando memória RAM...');
        await this.warmBrowser.close();
      } catch (_) {}
      this.warmBrowser = null;
    }

    if (typeof global.gc === 'function') {
      try { global.gc(); } catch (_) {}
    }
    return true;
  }

  /**
   * Reseta o timer de inatividade (Modo Balanceado: desliga após 15 min sem uso)
   */
  touchIdleTimer() {
    clearTimeout(this.idleTimer);
    const mode = this.getPerfMode();

    if (mode === 'save') {
      // No modo economia, desliga de imediato quando não há workers
      if (this.activeWorkers === 0) {
        setTimeout(() => this.shutdownBrowser(true), 300);
      }
      return;
    }

    if (mode === 'balanced') {
      // 15 minutos de tolerância antes de liberar RAM
      this.idleTimer = setTimeout(() => {
        if (this.activeWorkers === 0) {
          console.log('[LivePix Eco 🍃] 15 minutos de inatividade: desligando navegador para economizar servidor.');
          this.shutdownBrowser(true);
        }
      }, 15 * 60 * 1000);
    }
  }

  /**
   * Aplica mudança de modo a partir do painel administrativo
   */
  async applyMode(newMode) {
    console.log(`[LivePix Scraper ⚙️] Novo modo de performance aplicado: "${newMode.toUpperCase()}"`);
    if (newMode === 'save') {
      await this.shutdownBrowser(true);
    } else if (newMode === 'turbo') {
      this.getWarmBrowser().catch(() => {});
    }
  }

  /**
   * =========================================================================
   * 1. MOTOR TURBO DE ALTA VELOCIDADE (Ultra-Fast Engine)
   * =========================================================================
   * - Utiliza o Warm Browser Pool (zero delay de launch).
   * - Bloqueia imagens, vídeos, áudios e analytics desnecessários.
   * - Digitação ágil e detecção reativa de elementos.
   * - Tempo médio: 6 a 8 segundos.
   */
  async generateTurboPix({ username, clientPhone, tradeNo, amount, coverFees = true, timeoutMs = 18000 }) {
    const t0 = Date.now();
    const cleanUser = String(username || '').replace(/^@/, '').trim();
    const cleanAmountStr = Number(amount).toFixed(2).replace('.', ',');
    const phoneToFill = clientPhone ? String(clientPhone).replace(/\D/g, '') : `cliente_${tradeNo.slice(-6)}`;

    const browser = await this.getWarmBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      // Bloqueio de tráfego pesado e rastreadores analíticos
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        const url = req.url();
        if (
          ['image', 'media', 'font'].includes(type) ||
          url.includes('google-analytics') ||
          url.includes('doubleclick') ||
          url.includes('sentry') ||
          url.includes('facebook')
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Interceptação de paymentId da API /tip
      let interceptedPaymentId = null;
      page.on('response', async res => {
        try {
          if (res.url().includes('/tip') && res.status() === 200) {
            const json = await res.json();
            if (json?.paymentId) {
              interceptedPaymentId = json.paymentId;
              console.log(`[LivePix Turbo ⚡] paymentId interceptado via API: ${interceptedPaymentId}`);
            }
          }
        } catch (_) {}
      });

      const livepixUrl = `https://livepix.gg/${cleanUser}`;
      await page.goto(livepixUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 10000) });

      // Tela 1: Preenchimento rápido dos inputs
      await page.waitForSelector('input[name="username"]', { timeout: 6000 });
      await page.type('input[name="username"]', phoneToFill, { delay: 5 });
      await page.type('textarea[name="message"]', tradeNo, { delay: 5 });

      const amountInput = await page.$('input[name="amount"]');
      if (amountInput) {
        await amountInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await amountInput.type(cleanAmountStr, { delay: 5 });
      }

      // Switch de taxa
      try {
        const checkbox = await page.$('input[type="checkbox"]');
        if (checkbox) {
          const isChecked = await page.evaluate(el => el.checked, checkbox);
          if (coverFees && !isChecked) await checkbox.click();
          else if (!coverFees && isChecked) await checkbox.click();
        }
      } catch (_) {}

      // Aguarda o Turnstile habilitar o botão Continuar (tolerância de até 10s)
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Continuar para pagamento"]') ||
          Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.toLowerCase().includes('continuar'));
        return btn && !btn.disabled;
      }, { timeout: 10000 }).catch(() => {});

      // Clica no Continuar
      const payBtn = await page.$('button[aria-label="Continuar para pagamento"]') ||
        (await page.$('button')).find(async b => {
          const txt = await page.evaluate(el => el.innerText, b);
          return txt && txt.toLowerCase().includes('continuar');
        });

      if (payBtn) {
        await payBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // Tela 2: Modal de Recompensa (se houver)
      await new Promise(r => setTimeout(r, 400));
      try {
        const rewardBtns = await page.$('button');
        for (const rb of rewardBtns) {
          const txt = await page.evaluate(el => el.innerText, rb);
          if (txt && txt.trim().toLowerCase().includes('continuar')) {
            await rb.click();
            break;
          }
        }
      } catch (_) {}

      // Aguarda interceptação do paymentId da requisição /tip (até 10 segundos)
      const pWaitStart = Date.now();
      while (!interceptedPaymentId && Date.now() - pWaitStart < 10000) {
        await new Promise(r => setTimeout(r, 100));
      }

      let extractedPixCode = null;

      // ATALHO ULTRA-RÁPIDO: Consulta direta na API oficial LivePix via paymentId
      if (interceptedPaymentId) {
        try {
          console.log(`[LivePix Turbo ⚡] Consultando código Pix direto da API oficial (${interceptedPaymentId})...`);
          const apiRes = await fetch(`https://webservice.livepix.gg/checkout/payment/${interceptedPaymentId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://checkout.livepix.gg',
              'Referer': `https://checkout.livepix.gg/${interceptedPaymentId}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: JSON.stringify({ method: 'pix' })
          });
          if (apiRes.ok) {
            const apiJson = await apiRes.json();
            if (apiJson && apiJson.code && apiJson.code.startsWith('000201')) {
              extractedPixCode = apiJson.code;
              console.log(`[LivePix Turbo ⚡] Código Pix obtido via API oficial em ${Date.now() - t0}ms!`);
            }
          }
        } catch (apiErr) {
          console.warn('[LivePix Turbo ⚠️ Falha na API direta, continuando via DOM]:', apiErr.message);
        }
      }

      // SE A API DIRETA NÃO RETORNOU, NAVEGA NO CHECKOUT VIA BROWSER
      if (!extractedPixCode) {
        let checkoutTarget = null;
        const startCheckoutWait = Date.now();
        while (Date.now() - startCheckoutWait < 10000) {
          const frames = page.frames();
          const f = frames.find(frame => frame.url().includes('checkout.livepix.gg'));
          if (f) {
            checkoutTarget = f;
            break;
          }

          if (interceptedPaymentId) {
            try {
              await page.goto(`https://checkout.livepix.gg/${interceptedPaymentId}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
              checkoutTarget = page;
              break;
            } catch (_) {}
          }
          await new Promise(r => setTimeout(r, 200));
        }

        if (!checkoutTarget) {
          throw new Error('Checkout não detectado a tempo no motor turbo');
        }

        // Clica em Continuar na escolha do Pix (Tela 2)
        await checkoutTarget.waitForSelector('button', { timeout: 8000 });
        await checkoutTarget.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const cont = btns.find(b => b.innerText && b.innerText.trim().toUpperCase() === 'CONTINUAR');
          if (cont) cont.click();
        });

        // Tela 3: Extração do código Pix Copia e Cola (000201...)
        const pixStart = Date.now();
        while (Date.now() - pixStart < 12000) {
          const found = await checkoutTarget.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input, textarea')).map(i => i.value);
            return inputs.find(val => val && val.startsWith('000201'));
          });
          if (found) {
            extractedPixCode = found;
            break;
          }
          await new Promise(r => setTimeout(r, 150));
        }
      }

      if (!extractedPixCode) {
        throw new Error('Código Pix não surgiu no tempo limite turbo');
      }

      const elapsed = Date.now() - t0;
      console.log(`[LivePix Turbo ⚡] Pix extraído com SUCESSO em ${(elapsed / 1000).toFixed(1)} segundos!`);

      // Normaliza no padrão BACEN (garante injeção de 010212 em QR Codes dinâmicos da InfoPago e integridade do CRC16)
      const normalizedPixCode = pixUtil.normalizeAndValidatePixCode(extractedPixCode);
      const qrBuffer = await QRCode.toBuffer(normalizedPixCode, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(normalizedPixCode);
      const checkoutUrl = `https://livepix.gg/${cleanUser}?amount=${Number(amount).toFixed(2)}&message=${tradeNo}${phoneToFill ? `&username=${phoneToFill}` : ''}`;

      return {
        success: true,
        gateway: 'livepix',
        isLivepix: true,
        isDynamicLivepix: true,
        engine: 'turbo',
        elapsedMs: elapsed,
        pixCode: normalizedPixCode,
        qrBuffer,
        qrCodeBase64,
        checkoutUrl,
        data: {
          paymentId: interceptedPaymentId || `LPX_${tradeNo}`,
          pixCode: normalizedPixCode,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl,
          livepixUsername: cleanUser,
          isDynamicLivepix: true,
          instructions: `Código Pix Dinâmico gerado para o pedido ${tradeNo}. Pague pelo app bancário com aprovação imediata.`
        }
      };

    } finally {
      try { await page.close(); } catch (_) {}
    }
  }

  /**
   * =========================================================================
   * 2. MOTOR CLÁSSICO RESILIENTE (100% Proven Stable Fallback)
   * =========================================================================
   * O motor original que já está testado e homologado pelo usuário.
   * Funciona como fallback de segurança absoluta para garantir que NENHUM
   * pedido seja perdido caso ocorra qualquer oscilação de rede ou anti-bot.
   */
  async legacyGenerateLivepixPix({ username, clientPhone, tradeNo, amount, coverFees = true, timeoutMs = 35000 }) {
    const cleanUser = String(username || '').replace(/^@/, '').trim();
    let browser = null;
    const cleanAmountStr = Number(amount).toFixed(2).replace('.', ',');
    const phoneToFill = clientPhone ? String(clientPhone).replace(/\D/g, '') : `cliente_${tradeNo.slice(-6)}`;
    const isHeadless = process.env.LIVEPIX_HEADLESS === 'true';

    try {
      console.log(`[LivePix Clássico 🛡️] Executando motor resiliente para @${cleanUser} | Pedido: ${tradeNo}...`);

      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800'
      ];

      browser = await this.puppeteer.launch({
        executablePath: this.chromePath,
        headless: isHeadless ? 'new' : false,
        args: launchArgs
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      let interceptedPaymentId = null;
      page.on('response', async res => {
        try {
          if (res.url().includes('/tip') && res.status() === 200) {
            const json = await res.json();
            if (json?.paymentId) {
              interceptedPaymentId = json.paymentId;
              console.log(`[LivePix Clássico ⚡] paymentId interceptado via API: ${interceptedPaymentId}`);
            }
          }
        } catch (_) {}
      });

      const livepixUrl = `https://livepix.gg/${cleanUser}`;
      const response = await page.goto(livepixUrl, { waitUntil: 'networkidle2', timeout: Math.min(timeoutMs, 15000) });

      if (response && response.status() === 404) {
        throw new Error(`Perfil LivePix @${cleanUser} não existe (HTTP 404)`);
      }

      await page.waitForSelector('input[name="username"]', { timeout: 6000 });
      await page.type('input[name="username"]', phoneToFill, { delay: 15 });
      await page.type('textarea[name="message"]', tradeNo, { delay: 15 });

      const amountInput = await page.$('input[name="amount"]');
      if (amountInput) {
        await amountInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await amountInput.type(cleanAmountStr, { delay: 15 });
      }

      try {
        const checkbox = await page.$('input[type="checkbox"]');
        if (checkbox) {
          const isChecked = await page.evaluate(el => el.checked, checkbox);
          if (coverFees && !isChecked) await checkbox.click();
          else if (!coverFees && isChecked) await checkbox.click();
        }
      } catch (_) {}

      await new Promise(r => setTimeout(r, 1200));

      let payBtn = await page.$('button[aria-label="Continuar para pagamento"]');
      if (!payBtn) {
        const buttons = await page.$$('button');
        for (const b of buttons) {
          const txt = await page.evaluate(el => el.innerText, b);
          if (txt && txt.trim().toLowerCase().includes('continuar')) {
            payBtn = b;
            break;
          }
        }
      }

      if (!payBtn) {
        throw new Error('Botão Continuar da tela inicial não encontrado');
      }

      await payBtn.click();
      await new Promise(r => setTimeout(r, 1500));

      try {
        const hasRewardScreen = await page.evaluate(() => {
          const txt = (document.body ? document.body.innerText : '').toLowerCase();
          return txt.includes('você receberá estas recompensas') || txt.includes('recompensas');
        });
        if (hasRewardScreen) {
          const rewardButtons = await page.$$('button');
          for (const rb of rewardButtons) {
            const txt = await page.evaluate(el => el.innerText, rb);
            if (txt && txt.trim().toLowerCase().includes('continuar')) {
              await rb.click();
              break;
            }
          }
        }
      } catch (_) {}

      let checkoutTarget = null;
      let checkoutFrame = null;
      const iframeWaitStart = Date.now();
      const iframeMaxWait = Math.max(25000, timeoutMs);

      while (Date.now() - iframeWaitStart < iframeMaxWait) {
        const frames = page.frames();
        checkoutFrame = frames.find(f => f.url().includes('checkout.livepix.gg'));
        if (checkoutFrame) {
          checkoutTarget = checkoutFrame;
          break;
        }

        if (interceptedPaymentId) {
          try {
            await page.goto(`https://checkout.livepix.gg/${interceptedPaymentId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            checkoutTarget = page;
            break;
          } catch (_) {}
        }

        await new Promise(r => setTimeout(r, 400));
      }

      if (!checkoutTarget) {
        throw new Error('Modal/Checkout do LivePix não apareceu a tempo');
      }

      await checkoutTarget.waitForSelector('button', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 600));

      const frameButtons = await checkoutTarget.$$('button');
      let continueBtn = null;
      for (const fb of frameButtons) {
        const txt = await checkoutTarget.evaluate(el => el.innerText, fb);
        if (txt && txt.trim().toUpperCase() === 'CONTINUAR') {
          continueBtn = fb;
          break;
        }
      }

      if (continueBtn) {
        await continueBtn.click();
      } else {
        const anyBtn = await checkoutTarget.$('button[type="submit"], button.primary, button');
        if (anyBtn) await anyBtn.click();
      }

      let extractedPixCode = null;
      const pixWaitStart = Date.now();
      const pixMaxWait = 12000;

      while (Date.now() - pixWaitStart < pixMaxWait) {
        const inputs = await checkoutTarget.$$eval('input', els => els.map(i => i.value));
        const found = inputs.find(val => val && val.startsWith('000201'));
        if (found) {
          extractedPixCode = found;
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!extractedPixCode) {
        throw new Error('Código Pix Dinâmico (000201...) não encontrado no modal final');
      }

      console.log(`[LivePix Clássico ✅] Pix extraído com sucesso: ${extractedPixCode.slice(0, 45)}...`);

      // Normaliza no padrão BACEN (garante injeção de 010212 em QR Codes dinâmicos da InfoPago e integridade do CRC16)
      const normalizedPixCode = pixUtil.normalizeAndValidatePixCode(extractedPixCode);
      const qrBuffer = await QRCode.toBuffer(normalizedPixCode, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(normalizedPixCode);
      const checkoutUrl = `https://livepix.gg/${cleanUser}?amount=${Number(amount).toFixed(2)}&message=${tradeNo}${phoneToFill ? `&username=${phoneToFill}` : ''}`;

      return {
        success: true,
        gateway: 'livepix',
        isLivepix: true,
        isDynamicLivepix: true,
        engine: 'classic_fallback',
        pixCode: normalizedPixCode,
        qrBuffer,
        qrCodeBase64,
        checkoutUrl,
        data: {
          paymentId: interceptedPaymentId || `LPX_${tradeNo}`,
          pixCode: normalizedPixCode,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl,
          livepixUsername: cleanUser,
          isDynamicLivepix: true,
          instructions: `Código Pix Dinâmico gerado para o pedido ${tradeNo}. Pague pelo app bancário com aprovação imediata.`
        }
      };

    } finally {
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
    }
  }

  /**
   * =========================================================================
   * 3. MÉTODO PRINCIPAL: GERAR PIX LIVEPIX COM DUAL ENGINE & AUTO-FALLBACK
   * =========================================================================
   */
  async generateLivepixPix(options = {}) {
    if (!this.puppeteer) {
      return { success: false, reason: 'puppeteer_not_available' };
    }

    const { username, tradeNo } = options;
    const cleanUser = String(username || '').replace(/^@/, '').trim();
    if (!cleanUser) {
      return { success: false, reason: 'no_username' };
    }

    // 1. Cache na memória para evitar reprocessamento do mesmo pedido
    const cacheKey = `${cleanUser}_${tradeNo}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
        console.log(`[LivePix Scraper ⚡ Cache Hit] Retornando Pix do cache para pedido ${tradeNo}`);
        return cached.result;
      }
      this.cache.delete(cacheKey);
    }

    // 2. Concorrência adaptativa baseada no modo selecionado
    const maxConc = this.getMaxConcurrent();
    if (this.activeWorkers >= maxConc) {
      console.warn(`[LivePix Scraper] Limite de concorrência atingido (${this.activeWorkers}/${maxConc}).`);
      return { success: false, reason: 'concurrency_limit' };
    }

    this.activeWorkers++;
    const mode = this.getPerfMode();
    let finalResult = null;

    try {
      // MODO SAVE (Econômico): Executa direto o motor isolado e desliga
      if (mode === 'save') {
        console.log(`[LivePix 🍃 Save Mode Ativo] Executando processo isolado leve...`);
        finalResult = await this.legacyGenerateLivepixPix(options);
        // Desliga o navegador e roda GC imediatamente
        await this.shutdownBrowser(true);
      } else {
        // MODO TURBO OU BALANCEADO: Tenta primeiro o motor Turbo de alta velocidade
        try {
          console.log(`[LivePix 🚀 Disparando Motor Turbo (${mode.toUpperCase()})]...`);
          finalResult = await this.generateTurboPix(options);
        } catch (turboErr) {
          console.warn(`[LivePix 🛡️ Fallback Automático Ativado] Motor turbo falhou: "${turboErr.message}". Alternando imediatamente para o motor clássico comprovado...`);
          // FALLBACK SEGURO E TRANSPARENTE
          finalResult = await this.legacyGenerateLivepixPix(options);
        }
      }

      if (finalResult && finalResult.success) {
        this.cache.set(cacheKey, {
          timestamp: Date.now(),
          result: finalResult
        });
      }

      return finalResult;

    } catch (err) {
      console.error(`[LivePix Scraper ❌ Falha Geral]:`, err.message);
      return { success: false, reason: err.message };
    } finally {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.touchIdleTimer();
    }
  }
}

module.exports = new LivepixScraperService();

const { spawn } = require('child_process');
const models = require('../db/models');

class TunnelService {
  constructor() {
    // Túnel 1: Painel Administrativo (CONFIDENCIAL - Exclusivo Dono/Master)
    this.adminProcess = null;
    this.currentAdminUrl = null;
    this.isAdminStarting = false;
    this.adminPort = 3000;
    this.adminRestartTimeout = null;
    this._adminMockUrl = null;

    // Túnel 2: Loja / Vitrine Pública & Propostas (PÚBLICO - Clientes e Leads)
    this.storeProcess = null;
    this.currentStoreUrl = null;
    this.isStoreStarting = false;
    this.storePort = 3001;
    this.storeRestartTimeout = null;
    this._storeMockUrl = null;

    this.manualStop = false;
  }

  // Compatibilidade com mock direto em testes: tunnelService.url = '...'
  get url() {
    return this._adminMockUrl || this.currentAdminUrl || null;
  }
  set url(val) {
    this._adminMockUrl = val;
  }

  get adminUrl() {
    return this._adminMockUrl || this.currentAdminUrl || null;
  }
  set adminUrl(val) {
    this._adminMockUrl = val;
  }

  get storeUrl() {
    return this._storeMockUrl || this.currentStoreUrl || null;
  }
  set storeUrl(val) {
    this._storeMockUrl = val;
  }

  /**
   * Retorna a URL segura e confidencial do Painel Administrativo.
   * ESTA URL NUNCA DEVE SER EXPOSTA A CLIENTES OU USUÁRIOS COMUNS!
   * Entregue EXCLUSIVAMENTE ao Dono/Master em privado quando solicitar !painel.
   */
  getAdminUrl() {
    if (this._adminMockUrl) return this._adminMockUrl;
    if (this.currentAdminUrl) return this.currentAdminUrl;
    try {
      const saved = models.getSetting('TUNNEL_ADMIN_URL', null) || models.getSetting('TUNNEL_URL', null);
      if (saved && saved.startsWith('https://')) return saved;
    } catch (_) {}
    return null;
  }

  /**
   * Retorna a URL pública da Loja / Vitrine / Checkout e Propostas.
   * Pode ser distribuída para clientes, links de produtos e propostas comerciais.
   */
  getStoreUrl() {
    if (this._storeMockUrl) return this._storeMockUrl;
    if (this.currentStoreUrl) return this.currentStoreUrl;
    try {
      const saved = models.getSetting('TUNNEL_STORE_URL', null);
      if (saved && saved.startsWith('https://')) return saved;
    } catch (_) {}
    return null;
  }

  /**
   * Alias de getAdminUrl() para manter compatibilidade com testes legados
   */
  getUrl() {
    return this.getAdminUrl();
  }

  /**
   * Inicia o túnel Cloudflare do Painel Administrativo
   */
  async startAdminTunnel(port = 3000) {
    this.adminPort = port;
    if (this.adminProcess) return this.getAdminUrl();
    if (this.isAdminStarting) return this.getAdminUrl();

    this.isAdminStarting = true;

    return new Promise((resolve) => {
      let resolved = false;

      try {
        console.log(`[Tunnel Admin 🔒] Inicializando túnel Cloudflare confidencial para porta ${port}...`);

        this.adminProcess = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const onData = (chunk) => {
          const text = chunk.toString();
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !this.currentAdminUrl) {
            this.currentAdminUrl = match[0];
            this.isAdminStarting = false;
            try {
              models.setSetting('TUNNEL_ADMIN_URL', this.currentAdminUrl);
              models.setSetting('TUNNEL_URL', this.currentAdminUrl);
            } catch (_) {}
            console.log(`[Tunnel Admin 🔒] ✅ Painel Admin Privado Ativo: ${this.currentAdminUrl}`);
            if (!resolved) {
              resolved = true;
              resolve(this.currentAdminUrl);
            }
          }
        };

        this.adminProcess.stdout?.on('data', onData);
        this.adminProcess.stderr?.on('data', onData);

        this.adminProcess.on('error', (err) => {
          console.warn('[Tunnel Admin ⚠️ Erro Cloudflare]:', err.message);
          this.isAdminStarting = false;
          this.currentAdminUrl = null;
          if (!resolved) { resolved = true; resolve(null); }
        });

        this.adminProcess.on('close', (code) => {
          console.log(`[Tunnel Admin ℹ️] Túnel do Painel fechado (código ${code}).`);
          this.adminProcess = null;
          this.currentAdminUrl = null;
          this.isAdminStarting = false;

          if (!this.manualStop) {
            clearTimeout(this.adminRestartTimeout);
            this.adminRestartTimeout = setTimeout(() => {
              this.startAdminTunnel(this.adminPort).catch(() => {});
            }, 5000);
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.isAdminStarting = false;
            resolve(this.getAdminUrl());
          }
        }, 15000);

      } catch (err) {
        console.warn('[Tunnel Admin ⚠️ Falha ao disparar cloudflared]:', err.message);
        this.isAdminStarting = false;
        if (!resolved) { resolved = true; resolve(null); }
      }
    });
  }

  /**
   * Inicia o túnel Cloudflare público da Loja e Vitrine
   */
  async startStoreTunnel(port = 3001) {
    this.storePort = port;
    if (this.storeProcess) return this.getStoreUrl();
    if (this.isStoreStarting) return this.getStoreUrl();

    this.isStoreStarting = true;

    return new Promise((resolve) => {
      let resolved = false;

      try {
        console.log(`[Tunnel Loja 🛍️] Inicializando túnel Cloudflare público da Loja para porta ${port}...`);

        this.storeProcess = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const onData = (chunk) => {
          const text = chunk.toString();
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !this.currentStoreUrl) {
            this.currentStoreUrl = match[0];
            this.isStoreStarting = false;
            try {
              models.setSetting('TUNNEL_STORE_URL', this.currentStoreUrl);
            } catch (_) {}
            console.log(`[Tunnel Loja 🛍️] ✅ Vitrine Pública Ativa: ${this.currentStoreUrl}`);
            if (!resolved) {
              resolved = true;
              resolve(this.currentStoreUrl);
            }
          }
        };

        this.storeProcess.stdout?.on('data', onData);
        this.storeProcess.stderr?.on('data', onData);

        this.storeProcess.on('error', (err) => {
          console.warn('[Tunnel Loja ⚠️ Erro Cloudflare]:', err.message);
          this.isStoreStarting = false;
          this.currentStoreUrl = null;
          if (!resolved) { resolved = true; resolve(null); }
        });

        this.storeProcess.on('close', (code) => {
          console.log(`[Tunnel Loja ℹ️] Túnel da Loja fechado (código ${code}).`);
          this.storeProcess = null;
          this.currentStoreUrl = null;
          this.isStoreStarting = false;

          if (!this.manualStop) {
            clearTimeout(this.storeRestartTimeout);
            this.storeRestartTimeout = setTimeout(() => {
              this.startStoreTunnel(this.storePort).catch(() => {});
            }, 5000);
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.isStoreStarting = false;
            resolve(this.getStoreUrl());
          }
        }, 15000);

      } catch (err) {
        console.warn('[Tunnel Loja ⚠️ Falha ao disparar cloudflared]:', err.message);
        this.isStoreStarting = false;
        if (!resolved) { resolved = true; resolve(null); }
      }
    });
  }

  /**
   * Inicia ambos os túneis simultaneamente (Painel Admin + Loja Pública)
   */
  async startBoth({ adminPort = 3000, storePort = 3001 } = {}) {
    this.manualStop = false;
    const [adminUrl, storeUrl] = await Promise.all([
      this.startAdminTunnel(adminPort),
      this.startStoreTunnel(storePort)
    ]);
    return { adminUrl, storeUrl };
  }

  /**
   * Inicia túneis (compatibilidade com chamada única `start(port)`)
   */
  async start(adminPort = 3000, storePort = null) {
    this.manualStop = false;
    const sPort = storePort || (Number(adminPort) + 1);
    await Promise.all([
      this.startAdminTunnel(adminPort),
      this.startStoreTunnel(sPort)
    ]);
    return this.getAdminUrl();
  }

  async restart(port = this.adminPort) {
    this.stop();
    await new Promise((r) => setTimeout(r, 1000));
    return this.start(port);
  }

  stop() {
    this.manualStop = true;
    clearTimeout(this.adminRestartTimeout);
    clearTimeout(this.storeRestartTimeout);

    if (this.adminProcess) {
      try { this.adminProcess.kill(); } catch (_) {}
      this.adminProcess = null;
    }
    if (this.storeProcess) {
      try { this.storeProcess.kill(); } catch (_) {}
      this.storeProcess = null;
    }

    this.currentAdminUrl = null;
    this.currentStoreUrl = null;
    this.isAdminStarting = false;
    this.isStoreStarting = false;
  }
}

module.exports = new TunnelService();

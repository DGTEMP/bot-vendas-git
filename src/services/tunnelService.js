const { spawn } = require('child_process');
const models = require('../db/models');

class TunnelService {
  constructor() {
    this.process = null;
    this.currentUrl = null;
    this.isStarting = false;
    this.port = 3000;
    this.restartTimeout = null;
  }

  /**
   * Inicia o túnel remoto com Cloudflare Tunnel (cloudflared)
   * Fornece HTTPS gratuito com alta velocidade sem abrir portas
   */
  async start(port = 3000) {
    this.port = port;
    if (this.process) {
      return this.currentUrl;
    }

    if (this.isStarting) {
      return this.currentUrl;
    }

    this.isStarting = true;

    return new Promise((resolve) => {
      let resolved = false;

      try {
        console.log(`[Tunnel 🌐] Inicializando túnel Cloudflare para porta ${port}...`);

        this.process = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const onData = (chunk) => {
          const text = chunk.toString();
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !this.currentUrl) {
            this.currentUrl = match[0];
            this.isStarting = false;
            try {
              models.setSetting('TUNNEL_URL', this.currentUrl);
            } catch (_) {}
            console.log(`[Tunnel 🌐] ✅ Acesso Remoto Ativo com Sucesso: ${this.currentUrl}`);
            if (!resolved) {
              resolved = true;
              resolve(this.currentUrl);
            }
          }
        };

        this.process.stdout?.on('data', onData);
        this.process.stderr?.on('data', onData);

        this.process.on('error', (err) => {
          console.warn('[Tunnel ⚠️ Erro no processo Cloudflare]:', err.message);
          this.isStarting = false;
          this.currentUrl = null;
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });

        this.process.on('close', (code) => {
          console.log(`[Tunnel ℹ️] Processo do túnel finalizado (código ${code}).`);
          this.process = null;
          this.currentUrl = null;
          this.isStarting = false;

          // Auto-reconecta após 5 segundos se não for desligamento intencional
          if (!this.manualStop) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = setTimeout(() => {
              this.start(this.port).catch(() => {});
            }, 5000);
          }
        });

        // Timeout de resolução (se demorar mais de 15 segundos)
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.isStarting = false;
            resolve(this.currentUrl);
          }
        }, 15000);

      } catch (err) {
        console.warn('[Tunnel ⚠️ Falha ao disparar cloudflared]:', err.message);
        this.isStarting = false;
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }
    });
  }

  getUrl() {
    if (this.currentUrl) return this.currentUrl;
    try {
      const saved = models.getSetting('TUNNEL_URL', null);
      if (saved && saved.startsWith('https://')) return saved;
    } catch (_) {}
    return null;
  }

  async restart(port = this.port) {
    this.stop();
    await new Promise((r) => setTimeout(r, 1000));
    return this.start(port);
  }

  stop() {
    this.manualStop = true;
    clearTimeout(this.restartTimeout);
    if (this.process) {
      try {
        this.process.kill();
      } catch (_) {}
      this.process = null;
    }
    this.currentUrl = null;
    this.isStarting = false;
  }
}

module.exports = new TunnelService();

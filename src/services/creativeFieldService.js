/**
 * =========================================================================
 * 🎨 CREATIVEFIELD SERVICE (FOTOFIELD & WORKFLOW CANVAS)
 * =========================================================================
 * Integração oficial com o CreativeField (https://github.com/rhymeas/Creativefield.git)
 * Vencedor do Desafio Open-Source ComfyUI / Higgsfield:
 * 
 * 1. Servidor Criativo Local na Porta 8787 (http://127.0.0.1:8787)
 * 2. FotoField: Editor de imagens IA integrado para retoques, inpainting e camadas
 * 3. Conexão direta com ComfyUI (http://127.0.0.1:8188)
 * 4. Gerenciamento de ciclo de vida do servidor (Start / Stop / Health)
 * 5. Integração com Posts e Catálogo de Produtos do Bot
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const models = require('../db/models');

const CREATIVEFIELD_REPO_URL = 'https://github.com/rhymeas/Creativefield.git';

class CreativeFieldService {
  constructor() {
    this.repoDir = path.resolve(__dirname, '../../tools/Creativefield');
    this.repoUrl = CREATIVEFIELD_REPO_URL;
    this.defaultPort = 8787;
    this.processInstance = null;
    this.processPid = null;
    this.isStarting = false;
  }

  isInstalled() {
    return fs.existsSync(path.join(this.repoDir, 'package.json'));
  }

  isDependenciesInstalled() {
    return fs.existsSync(path.join(this.repoDir, 'node_modules'));
  }

  isBuildReady() {
    return fs.existsSync(path.join(this.repoDir, 'dist', 'index.html'));
  }

  getEndpoint() {
    return models.getSetting('CREATIVEFIELD_ENDPOINT', `http://127.0.0.1:${this.defaultPort}`);
  }

  setEndpoint(url) {
    if (!url) return;
    models.setSetting('CREATIVEFIELD_ENDPOINT', url.trim().replace(/\/+$/, ''));
  }

  /**
   * Verifica se o CreativeField está respondendo na porta 8787
   */
  async checkHealth() {
    const endpoint = this.getEndpoint();
    const installed = this.isInstalled();
    const dependenciesInstalled = this.isDependenciesInstalled();
    const buildReady = this.isBuildReady();

    let online = false;
    let latencyMs = 0;
    const t0 = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);

      // Tenta endpoint de health ou raiz
      const res = await fetch(`${endpoint}/api/v1/health`, {
        signal: controller.signal
      }).catch(async () => {
        return await fetch(`${endpoint}/`, { signal: controller.signal });
      });

      clearTimeout(timeoutId);
      if (res && (res.ok || res.status < 500)) {
        online = true;
      }
    } catch (_) {
      online = false;
    }
    latencyMs = Date.now() - t0;

    return {
      success: true,
      serviceName: 'CreativeField & FotoField',
      repoUrl: this.repoUrl,
      repoDir: this.repoDir,
      installed,
      dependenciesInstalled,
      buildReady,
      endpoint,
      fotoFieldUrl: `${endpoint}/#video`,
      canvasUrl: `${endpoint}/`,
      online,
      latencyMs: online ? latencyMs : null,
      processRunning: Boolean(this.processPid || online),
      launcherBat: path.resolve(__dirname, '../../iniciar_creativefield.bat')
    };
  }

  async checkStatus() {
    return this.checkHealth();
  }

  /**
   * Inicia o servidor do CreativeField localmente
   */
  async startServer() {
    const health = await this.checkHealth();
    if (health.online) {
      return {
        success: true,
        alreadyRunning: true,
        message: 'CreativeField já está ativo e respondendo na porta 8787!',
        endpoint: health.endpoint,
        fotoFieldUrl: health.fotoFieldUrl
      };
    }

    if (!this.isInstalled()) {
      throw new Error(`CreativeField não está instalado em ${this.repoDir}`);
    }

    if (this.isStarting) {
      return {
        success: true,
        isStarting: true,
        message: 'CreativeField está iniciando em segundo plano...'
      };
    }

    this.isStarting = true;

    try {
      const isWin = process.platform === 'win32';
      const npmCmd = isWin ? 'npm.cmd' : 'npm';

      const child = spawn(npmCmd, ['start'], {
        cwd: this.repoDir,
        detached: true,
        stdio: 'ignore',
        shell: isWin
      });

      child.unref();
      this.processInstance = child;
      this.processPid = child.pid;

      setTimeout(() => {
        this.isStarting = false;
      }, 5000);

      return {
        success: true,
        started: true,
        pid: child.pid,
        message: 'Servidor CreativeField iniciado com sucesso! Acesse em instantes na porta 8787.',
        endpoint: this.getEndpoint(),
        fotoFieldUrl: `${this.getEndpoint()}/#video`
      };
    } catch (err) {
      this.isStarting = false;
      throw new Error(`Falha ao iniciar CreativeField: ${err.message}`);
    }
  }

  /**
   * Encerra o processo do servidor se foi iniciado por nós
   */
  stopServer() {
    if (this.processInstance && !this.processInstance.killed) {
      try {
        if (process.platform === 'win32' && this.processPid) {
          const { spawnSync } = require('child_process');
          spawnSync('taskkill', ['/pid', String(this.processPid), '/T', '/F']);
        } else {
          this.processInstance.kill('SIGINT');
        }
        this.processInstance = null;
        this.processPid = null;
        return { success: true, message: 'CreativeField finalizado com sucesso' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: true, message: 'Nenhum processo local gerenciado ativo' };
  }
}

module.exports = new CreativeFieldService();

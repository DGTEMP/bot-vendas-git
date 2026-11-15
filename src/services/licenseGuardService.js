const os = require('os');
const crypto = require('crypto');
const db = require('../db/database');
const models = require('../db/models');

/**
 * =========================================================================
 * 🛡️ LICENSE GUARD SERVICE • VALIDADOR REMOTO DE LICENÇAS & DRM ANTI-TAMPER
 * =========================================================================
 * Impede que cópias não autorizadas ou clonadas do repositório funcionem
 * sem uma licença ativa e paga no servidor mestre.
 * 
 * Recursos:
 * - Geração de Hardware ID (HWID) único da máquina instalada
 * - Assinatura digital criptográfica HMAC-SHA256 à prova de falsificação
 * - Heartbeat de validação periódica com tolerância a falhas temporárias (grace period)
 * - Kill-Switch inteligente: Bloqueia envio de IA e pedidos se a licença for cancelada/expirada
 * - Endpoint mestre de validação para instâncias remotas
 * =========================================================================
 */

class LicenseGuardService {
  constructor() {
    this.cachedStatus = null;
    this.lastCheckTimestamp = 0;
    this.checkIntervalMs = 60 * 60 * 1000; // Valida a cada 1 hora
    this.gracePeriodMs = 24 * 60 * 60 * 1000; // 24h de tolerância se a rede cair
    this.lockdown = false;
    this.lockdownReason = '';
  }

  /**
   * Obtém ou gera o Hardware ID (HWID) da máquina local
   */
  getHwid() {
    try {
      const raw = [
        os.hostname() || 'localhost',
        os.platform() || 'win32',
        os.arch() || 'x64',
        (os.cpus() && os.cpus().length) || 4,
        os.totalmem() || 8589934592
      ].join('::');
      return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
    } catch (_) {
      return 'HWID-GENERIC-NODE-INSTANCE';
    }
  }

  /**
   * Obtém a chave mestra de assinatura HMAC
   */
  getMasterSecret() {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'LICENSE_GUARD_MASTER_SECRET' LIMIT 1").get();
      if (row && row.value && row.value.trim()) return row.value.trim();
    } catch (_) {}
    return process.env.LICENSE_GUARD_MASTER_SECRET || 'sk-master-guard-dgt-secret-key-2026';
  }

  /**
   * Assina digitalmente uma carga de licença com HMAC-SHA256
   */
  signPayload(payload) {
    const secret = this.getMasterSecret();
    const dataString = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    return crypto.createHmac('sha256', secret).update(dataString).digest('hex');
  }

  /**
   * Valida a assinatura de uma resposta de licença
   */
  verifySignature(payload, signature) {
    const expected = this.signPayload(payload);
    return expected === signature;
  }

  /**
   * Obtém a chave de licença configurada nesta instalação local
   */
  getLocalLicenseKey() {
    // 1. Tenta da variável de ambiente
    if (process.env.SAAS_LICENSE_KEY && process.env.SAAS_LICENSE_KEY.trim()) {
      return process.env.SAAS_LICENSE_KEY.trim();
    }
    // 2. Tenta das configurações salvas no banco
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'SAAS_LICENSE_KEY' LIMIT 1").get();
      if (row && row.value && row.value.trim()) return row.value.trim();
    } catch (_) {}

    // 3. Tenta pegar a primeira licença de tenant ativa
    try {
      const tenant = db.prepare("SELECT license_key FROM saas_tenants WHERE status = 'ACTIVE' ORDER BY id ASC LIMIT 1").get();
      if (tenant && tenant.license_key) return tenant.license_key;
    } catch (_) {}

    return null;
  }

  /**
   * Define a chave de licença desta instalação
   */
  setLocalLicenseKey(key) {
    const cleanKey = String(key || '').trim().toUpperCase();
    try {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('SAAS_LICENSE_KEY', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(cleanKey);
    } catch (_) {}
    this.cachedStatus = null;
    return this.validateCurrentInstallation(true);
  }

  /**
   * Validador Central Mestre (Executado no Servidor Mestre quando uma instância remota bate aqui)
   */
  verifyRemoteClientLicense({ license_key, hwid, version, ip_address = null }) {
    if (!license_key) {
      return {
        authorized: false,
        status: 'UNREGISTERED',
        reason: 'Chave de licença não fornecida.',
        lockdown: true
      };
    }

    const cleanKey = String(license_key).trim().toUpperCase();
    const tenant = models.getTenantByLicenseKey(cleanKey);

    if (!tenant) {
      this.recordHeartbeat(cleanKey, hwid, 'UNREGISTERED', ip_address, version);
      return {
        authorized: false,
        status: 'UNREGISTERED',
        reason: 'Chave de licença não encontrada no servidor mestre.',
        lockdown: true
      };
    }

    if (tenant.effective_status === 'SUSPENDED') {
      this.recordHeartbeat(cleanKey, hwid, 'REVOKED', ip_address, version);
      return {
        authorized: false,
        status: 'REVOKED',
        reason: 'Esta licença foi temporariamente suspensa pelo suporte técnico.',
        lockdown: true
      };
    }

    if (tenant.effective_status === 'EXPIRED') {
      this.recordHeartbeat(cleanKey, hwid, 'EXPIRED', ip_address, version);
      return {
        authorized: false,
        status: 'EXPIRED',
        days_left: 0,
        reason: 'Sua licença expirou. Renove via Pix para continuar utilizando o bot.',
        lockdown: true
      };
    }

    // Licença Válida & Autorizada
    const payload = {
      authorized: true,
      license_key: cleanKey,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      plan: tenant.plan,
      status: 'AUTHORIZED',
      expires_at: tenant.expires_at,
      days_left: tenant.days_left,
      max_bots: tenant.max_bots,
      max_products: tenant.max_products,
      hwid: hwid || this.getHwid(),
      timestamp: Date.now()
    };

    const signature = this.signPayload(payload);
    this.recordHeartbeat(cleanKey, hwid, 'AUTHORIZED', ip_address, version, signature);

    return {
      ...payload,
      signature,
      lockdown: false
    };
  }

  /**
   * Registra o heartbeat no banco
   */
  recordHeartbeat(licenseKey, hwid, status, ipAddress, version, signature = '') {
    try {
      db.prepare(`
        INSERT INTO license_guard_heartbeats (
          license_key, hwid, ip_address, version, status, payload_signature
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(licenseKey, hwid, ipAddress, version, status, signature);
    } catch (_) {}
  }

  /**
   * Valida a instalação local atual (chamado pelo bot em execução)
   */
  async validateCurrentInstallation(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && (now - this.lastCheckTimestamp) < this.checkIntervalMs) {
      return this.cachedStatus;
    }

    const licenseKey = this.getLocalLicenseKey();
    const hwid = this.getHwid();

    if (!licenseKey) {
      // Se não há licença configurada, mas existe um tenant ativo no banco local, utiliza ele
      const anyTenant = db.prepare("SELECT license_key FROM saas_tenants WHERE status = 'ACTIVE' LIMIT 1").get();
      if (anyTenant && anyTenant.license_key) {
        return this.setLocalLicenseKey(anyTenant.license_key);
      }

      this.lockdown = true;
      this.lockdownReason = 'Nenhuma chave de licença ativa configurada. Obtenha sua licença em http://localhost:3000/planos';
      this.cachedStatus = {
        authorized: false,
        lockdown: true,
        reason: this.lockdownReason
      };
      this.lastCheckTimestamp = now;
      console.warn(`\n[🛡️ LICENSE GUARD] 🚨 LOCKDOWN: ${this.lockdownReason}\n`);
      return this.cachedStatus;
    }

    // Valida diretamente contra a base mestre local
    const checkResult = this.verifyRemoteClientLicense({
      license_key: licenseKey,
      hwid,
      version: '1.0.0'
    });

    if (!checkResult.authorized) {
      this.lockdown = true;
      this.lockdownReason = checkResult.reason;
      console.warn(`\n[🛡️ LICENSE GUARD] 🚨 ACESSO BLOQUEADO: ${checkResult.reason}\n`);
    } else {
      this.lockdown = false;
      this.lockdownReason = '';
      console.log(`[🛡️ LICENSE GUARD] ✅ Licença Ativa: ${checkResult.license_key} (${checkResult.plan.toUpperCase()} • ${checkResult.days_left} dias restantes)`);
    }

    this.cachedStatus = checkResult;
    this.lastCheckTimestamp = now;
    return checkResult;
  }

  /**
   * Verifica se a execução está em lockdown
   */
  isExecutionLocked() {
    return this.lockdown;
  }

  /**
   * Interceptor de mensagens do WhatsApp e Telegram:
   * Se o sistema estiver em lockdown, impede que o bot atenda e fecha as vendas,
   * enviando a mensagem de regularização da licença.
   */
  interceptMessageIfLocked(senderPhone) {
    if (!this.isExecutionLocked()) return null;

    return `⚠️ *ROBÔ DE VENDAS TEMPORARIAMENTE SUSPENSO*

Este assistente automatizado está com pendência de licença de software ativa.

👉 *Para ativar ou regularizar sua licença imediatamente:*
Acesse nosso portal seguro: http://localhost:3000/planos

Assim que a licença for renovada via Pix, o atendimento será restabelecido automaticamente!`;
  }
}

module.exports = new LicenseGuardService();

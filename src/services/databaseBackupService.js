/**
 * =========================================================================
 * 💾 DATABASE BACKUP SERVICE (BACKUP AUTOMÁTICO DO BANCO SQLITE)
 * =========================================================================
 * Realiza backups seguros, atômicos e com zero-downtime utilizando o
 * comando VACUUM INTO nativo do SQLite.
 *
 * Funcionalidades:
 * - Backup instantâneo sob demanda (via painel web ou API)
 * - Agendamento automático periódico (a cada 12 horas / diário às 23:30)
 * - Política de retenção inteligente (mantém os 15 backups mais recentes)
 * - Download direto do arquivo .sqlite pelo navegador com proteção
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const models = require('../db/models');

class DatabaseBackupService {
  constructor() {
    this.backupDir = path.resolve('data/backups');
    this.maxRetentionCount = 15;
    this._interval = null;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Executa um backup atômico completo do banco de dados.
   * @returns {{ success: boolean, filename: string, filePath: string, sizeBytes: number, formattedSize: string }}
   */
  createBackup() {
    this._ensureDir();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `backup_paybot_${timestampStr}.sqlite`;
    const fullPath = path.join(this.backupDir, filename);
    const normalizedPath = fullPath.replace(/\\/g, '/');

    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }

      // Executa VACUUM INTO nativo
      db.exec(`VACUUM INTO '${normalizedPath}';`);

      const stat = fs.statSync(fullPath);
      const sizeBytes = stat.size;
      const formattedSize = sizeBytes > 1024 * 1024
        ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(sizeBytes / 1024).toFixed(1)} KB`;

      console.log(`[Backup 💾] Backup realizado com sucesso: ${filename} (${formattedSize})`);

      // Aplica rotação de retenção
      this._enforceRetention();

      models.setSetting('LAST_DATABASE_BACKUP_TIME', now.toISOString());
      models.setSetting('LAST_DATABASE_BACKUP_FILE', filename);

      return {
        success: true,
        filename,
        filePath: fullPath,
        sizeBytes,
        formattedSize,
        createdAt: now.toISOString()
      };
    } catch (err) {
      console.error('[Backup ❌] Falha ao criar backup:', err.message);
      throw err;
    }
  }

  /**
   * Mantém apenas os backups mais recentes conforme a política de retenção.
   */
  _enforceRetention() {
    try {
      const files = this.listBackups();
      if (files.length > this.maxRetentionCount) {
        const toDelete = files.slice(this.maxRetentionCount);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(file.fullPath);
            console.log(`[Backup 🧹] Removido backup antigo da retenção: ${file.filename}`);
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[Backup ⚠️] Erro na rotação de retenção:', err.message);
    }
  }

  /**
   * Lista todos os backups salvos em ordem cronológica decrescente.
   */
  listBackups() {
    this._ensureDir();
    try {
      const entries = fs.readdirSync(this.backupDir);
      const backups = [];

      for (const f of entries) {
        if (f.endsWith('.sqlite') || f.endsWith('.db')) {
          const fp = path.join(this.backupDir, f);
          try {
            const stat = fs.statSync(fp);
            const sizeBytes = stat.size;
            const formattedSize = sizeBytes > 1024 * 1024
              ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
              : `${(sizeBytes / 1024).toFixed(1)} KB`;

            backups.push({
              filename: f,
              fullPath: fp,
              sizeBytes,
              formattedSize,
              createdAt: stat.mtime.toISOString(),
              mtimeMs: stat.mtimeMs
            });
          } catch (_) {}
        }
      }

      // Ordena pelos mais recentes primeiro
      return backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch (_) {
      return [];
    }
  }

  /**
   * Retorna o caminho do backup mais recente.
   */
  getLatestBackupPath() {
    const list = this.listBackups();
    return list.length > 0 ? list[0].fullPath : null;
  }

  /**
   * Retorna o caminho de um backup específico pelo nome do arquivo.
   */
  getBackupPathByName(filename) {
    if (!filename || typeof filename !== 'string') return null;
    const sanitized = path.basename(filename);
    const fullPath = path.join(this.backupDir, sanitized);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  /**
   * Inicia o agendamento de backups periódicos (padrão: a cada 12 horas).
   */
  start(intervalHours = 12) {
    if (this._interval) return;

    const intervalMs = intervalHours * 60 * 60 * 1000;
    this._interval = setInterval(() => {
      try {
        console.log('[Backup 🕒] Iniciando backup periódico agendado...');
        this.createBackup();
      } catch (err) {
        console.error('[Backup ⚠️] Erro no backup agendado:', err.message);
      }
    }, intervalMs);

    this._interval.unref?.();
    console.log(`✅ [DatabaseBackup] Backup automático ativado (intervalo: a cada ${intervalHours}h, retenção: ${this.maxRetentionCount} arquivos)`);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}

module.exports = new DatabaseBackupService();

/**
 * =========================================================================
 * 🕒 CENTRALIZADOR DE DATA, HORA E FUSO HORÁRIO (GMT-3 BRASÍLIA)
 * =========================================================================
 * Garante consistência temporal em todo o sistema (Bots, DB, API e Logs):
 * - Fuso horário oficial: America/Sao_Paulo (GMT-3 / Horário de Brasília)
 * - Saudações automáticas precisas (Bom dia, Boa tarde, Boa noite)
 * - Conversão correta de timestamps UTC do SQLite para o horário local
 * =========================================================================
 */

const TIMEZONE_BRASILIA = 'America/Sao_Paulo';

// Força o fuso horário padrão do processo Node.js
if (!process.env.TZ) {
  process.env.TZ = TIMEZONE_BRASILIA;
}

/**
 * Retorna a hora atual no fuso horário de Brasília (0 a 23).
 * @param {Date|string|number} [date]
 * @returns {number}
 */
function getBrasiliaHour(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const hourStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE_BRASILIA,
    hour: 'numeric',
    hour12: false
  }).format(d);
  return parseInt(hourStr, 10);
}

/**
 * Retorna a saudação dinâmica baseada no horário de Brasília:
 * 05:00 às 11:59 -> Bom dia
 * 12:00 às 17:59 -> Boa tarde
 * 18:00 às 04:59 -> Boa noite
 * @param {Date|string|number} [date]
 * @returns {{ saudacao: string, icon: string }}
 */
function getBrasiliaGreeting(date = new Date()) {
  const hour = getBrasiliaHour(date);
  if (hour >= 5 && hour < 12) {
    return { saudacao: 'Bom dia', icon: '🌅' };
  } else if (hour >= 12 && hour < 18) {
    return { saudacao: 'Boa tarde', icon: '☀️' };
  } else {
    return { saudacao: 'Boa noite', icon: '🌙' };
  }
}

/**
 * Converte qualquer formato de data (incluindo string UTC sem offset do SQLite)
 * em um objeto Date seguro para conversão para America/Sao_Paulo.
 * @param {any} val 
 * @returns {Date|null}
 */
function parseDateSafely(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    // Padrão SQLite UTC: "YYYY-MM-DD HH:mm:ss" ou "YYYY-MM-DD HH:mm:ss.sss"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      const d = new Date(trimmed.replace(' ', 'T') + 'Z');
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Formata data e hora no padrão brasileiro (DD/MM/YYYY, HH:mm:ss) em Brasília (GMT-3).
 * @param {any} val 
 * @param {Intl.DateTimeFormatOptions} [customOptions] 
 * @returns {string}
 */
function formatBrasiliaDateTime(val, customOptions = {}) {
  const d = parseDateSafely(val);
  if (!d) return '-';
  const defaultOptions = {
    timeZone: TIMEZONE_BRASILIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  return d.toLocaleString('pt-BR', { ...defaultOptions, ...customOptions });
}

/**
 * Formata apenas a data no padrão brasileiro (DD/MM/YYYY) em Brasília (GMT-3).
 * @param {any} val 
 * @returns {string}
 */
function formatBrasiliaDate(val) {
  const d = parseDateSafely(val);
  if (!d) return '-';
  return d.toLocaleDateString('pt-BR', {
    timeZone: TIMEZONE_BRASILIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Formata apenas a hora no padrão brasileiro (HH:mm) em Brasília (GMT-3).
 * @param {any} val 
 * @param {boolean} [withSeconds=false] 
 * @returns {string}
 */
function formatBrasiliaTime(val, withSeconds = false) {
  const d = parseDateSafely(val);
  if (!d) return '-';
  return d.toLocaleTimeString('pt-BR', {
    timeZone: TIMEZONE_BRASILIA,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false
  });
}

/**
 * Retorna string ISO com timezone explícito de Brasília (-03:00).
 * Ex: "2026-11-04T20:30:00-03:00"
 * @param {Date} [date]
 * @returns {string}
 */
function getBrasiliaISOString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-03:00`;
}

module.exports = {
  TIMEZONE_BRASILIA,
  getBrasiliaHour,
  getBrasiliaGreeting,
  parseDateSafely,
  formatBrasiliaDateTime,
  formatBrasiliaDate,
  formatBrasiliaTime,
  getBrasiliaISOString
};

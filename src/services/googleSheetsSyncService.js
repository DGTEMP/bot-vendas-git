/**
 * googleSheetsSyncService.js
 * Sincronizador de Links de Afiliados em Tempo Real via Planilhas Google Sheets
 * Suporta:
 * 1. Polling Contínuo em Segundo Plano (a cada segundo ou intervalo configurado)
 * 2. Webhook Push instantâneo via Google Apps Script (sub-segundo / streaming)
 * 3. Parser RFC 4180 resiliente com mapeamento dinâmico de cabeçalhos
 * 4. Detecção inteligente de plataforma e extração automática de palavras-chave para Social Listening
 */

const crypto = require('crypto');
const models = require('../db/models');

class GoogleSheetsSyncService {
  constructor() {
    this.pollTimer = null;
    this.isPolling = false;
    this.lastContentHash = null;
    this.cachedRowsCount = 0;
  }

  // ==========================================
  // 1. EXTRAÇÃO DE IDS E CONSTRUÇÃO DE URLS DE EXPORTAÇÃO
  // ==========================================
  extractSheetIdAndUrls(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();

    // Caso A: Já é uma URL de exportação direta CSV ou publicada na web
    if (trimmed.includes('export?format=csv') || trimmed.includes('/pub?output=csv') || trimmed.includes('/pub?gid=')) {
      return {
        sheetId: 'direct',
        csvExportUrl: trimmed,
        gvizUrl: trimmed,
        originalUrl: trimmed
      };
    }

    // Caso B: URL padrão de edição do Google Sheets
    // Ex: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0
    const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch && idMatch[1]) {
      const sheetId = idMatch[1];
      const gidMatch = trimmed.match(/[#&]gid=([0-9]+)/);
      const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

      return {
        sheetId,
        csvExportUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`,
        gvizUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`,
        originalUrl: trimmed
      };
    }

    // Caso C: O usuário forneceu diretamente o ID da planilha
    if (/^[a-zA-Z0-9-_]{20,80}$/.test(trimmed)) {
      const sheetId = trimmed;
      return {
        sheetId,
        csvExportUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`,
        gvizUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`,
        originalUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
      };
    }

    return null;
  }

  // ==========================================
  // 2. PARSER DE CSV ROBUSTO & DETECÇÃO DE CABEÇALHOS
  // ==========================================
  parseCsv(csvContent) {
    if (!csvContent || typeof csvContent !== 'string') return [];
    const text = csvContent.replace(/^\uFEFF/, '').trim(); // Remove UTF-8 BOM
    if (!text) return [];

    // Detecção de delimitador (, ou ; ou \t)
    const firstLine = text.split(/\r\n|\n|\r/)[0] || '';
    let delimiter = ',';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
    else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

    // Parser RFC 4180 com suporte a aspas duplas e quebras de linha dentro de campos
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Pula escape
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++; // Pula CRLF
        currentRow.push(currentCell.trim());
        if (currentRow.some(cell => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) rows.push(currentRow);
    }

    if (rows.length < 2) return [];

    // Mapeamento dinâmico e flexível dos cabeçalhos (PT e EN)
    const rawHeaders = rows[0].map(h => this.normalizeHeader(h));
    const headerMap = {
      title: this.findHeaderIndex(rawHeaders, ['titulo', 'título', 'produto', 'nome', 'nome do produto', 'title', 'product', 'item', 'name']),
      affiliate_url: this.findHeaderIndex(rawHeaders, ['link', 'url', 'link de afiliado', 'link afiliado', 'link_afiliado', 'affiliate_url', 'link_final', 'link produto']),
      platform: this.findHeaderIndex(rawHeaders, ['plataforma', 'platform', 'rede', 'origem', 'marketplace', 'loja']),
      product_price: this.findHeaderIndex(rawHeaders, ['preco', 'preço', 'valor', 'price', 'valor_produto']),
      commission_percent: this.findHeaderIndex(rawHeaders, ['comissao', 'comissão', 'commission', 'comissao_percent', 'taxa', 'porcentagem']),
      keywords: this.findHeaderIndex(rawHeaders, ['keywords', 'palavras_chave', 'palavras-chave', 'tags', 'termos', 'palavras chave', 'gatilhos']),
      pitch_copy: this.findHeaderIndex(rawHeaders, ['copy', 'pitch', 'texto', 'descricao', 'descrição', 'legenda'])
    };

    // Fallback: se não encontrou link por cabeçalho, tenta achar coluna com URL http
    if (headerMap.affiliate_url === -1) {
      for (let c = 0; c < rows[1].length; c++) {
        if (/^https?:\/\//i.test(rows[1][c])) {
          headerMap.affiliate_url = c;
          break;
        }
      }
    }

    // Fallback: se não encontrou título, usa a primeira coluna que não seja URL
    if (headerMap.title === -1) {
      for (let c = 0; c < rows[1].length; c++) {
        if (c !== headerMap.affiliate_url && rows[1][c].length > 1) {
          headerMap.title = c;
          break;
        }
      }
    }

    if (headerMap.affiliate_url === -1 || headerMap.title === -1) {
      return [];
    }

    const parsedItems = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const title = row[headerMap.title] || '';
      const affiliate_url = row[headerMap.affiliate_url] || '';

      if (!title || !affiliate_url || !/^https?:\/\//i.test(affiliate_url)) continue;

      let platform = headerMap.platform !== -1 ? row[headerMap.platform] : '';
      if (!platform) platform = this.detectPlatformFromUrl(affiliate_url);

      let product_price = 0.0;
      if (headerMap.product_price !== -1 && row[headerMap.product_price]) {
        const rawP = String(row[headerMap.product_price]).replace(/[^0-9.,]/g, '').replace(',', '.');
        product_price = parseFloat(rawP) || 0.0;
      }

      let commission_percent = 50.0;
      if (headerMap.commission_percent !== -1 && row[headerMap.commission_percent]) {
        const rawC = String(row[headerMap.commission_percent]).replace(/[^0-9.,]/g, '').replace(',', '.');
        commission_percent = parseFloat(rawC) || 50.0;
      }

      let keywords = headerMap.keywords !== -1 ? (row[headerMap.keywords] || '') : '';
      if (!keywords) keywords = this.extractKeywordsFromTitle(title);

      const pitch_copy = headerMap.pitch_copy !== -1 ? (row[headerMap.pitch_copy] || null) : null;

      parsedItems.push({
        title,
        affiliate_url,
        platform,
        product_price,
        commission_percent,
        keywords,
        pitch_copy,
        currency: 'BRL'
      });
    }

    return parsedItems;
  }

  normalizeHeader(header) {
    if (!header) return '';
    return header
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
  }

  findHeaderIndex(headers, aliases) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (aliases.some(alias => h === alias || h.includes(alias))) return i;
    }
    return -1;
  }

  // ==========================================
  // 3. ENGENHARIA DE METADADOS: PLATAFORMA & PALAVRAS-CHAVE
  // ==========================================
  detectPlatformFromUrl(url) {
    if (!url) return 'Outro';
    const lower = url.toLowerCase();
    if (lower.includes('shopee') || lower.includes('shope.ee')) return 'Shopee';
    if (lower.includes('amazon') || lower.includes('amzn.to')) return 'Amazon';
    if (lower.includes('hotmart') || lower.includes('hotm.art')) return 'Hotmart';
    if (lower.includes('kiwify')) return 'Kiwify';
    if (lower.includes('braip')) return 'Braip';
    if (lower.includes('monetizze')) return 'Monetizze';
    if (lower.includes('mercadolivre') || lower.includes('mercadolivre.com.br') || lower.includes('meli.la')) return 'Mercado Livre';
    if (lower.includes('magazineluiza') || lower.includes('magalu')) return 'Magalu';
    if (lower.includes('aliexpress')) return 'AliExpress';
    if (lower.includes('shein')) return 'Shein';
    if (lower.includes('cakto')) return 'Cakto';
    return 'Outro';
  }

  extractKeywordsFromTitle(title) {
    if (!title || typeof title !== 'string') return '';
    const stopWords = new Set([
      'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'para', 'pra', 'pro', 'com', 'sem', 'por', 'que', 'um', 'uma',
      'uns', 'umas', 'o', 'a', 'os', 'as', 'e', 'ou', 'se', 'seu',
      'sua', 'seus', 'suas', 'mais', 'menos', 'muito', 'muita',
      'original', 'novo', 'nova', 'bivolt', '110v', '220v', 'frete',
      'gratis', 'promocao', 'promocional', 'oficial', 'kit', 'combo'
    ]);

    const clean = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ');

    const tokens = clean.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    const uniqueTokens = Array.from(new Set(tokens));

    // Enriquece sinônimos comuns para e-commerce (ex: chapinha -> prancha, alisador)
    const extra = [];
    if (uniqueTokens.includes('chapinha') || uniqueTokens.includes('prancha')) {
      extra.push('alisador', 'cabelo');
    }
    if (uniqueTokens.includes('robô') || uniqueTokens.includes('robo') || uniqueTokens.includes('bot')) {
      extra.push('automação', 'sistema');
    }
    if (uniqueTokens.includes('smartwatch') || uniqueTokens.includes('relogio')) {
      extra.push('relógio', 'pulseira');
    }

    return Array.from(new Set([...uniqueTokens, ...extra])).slice(0, 8).join(', ');
  }

  // ==========================================
  // 4. SINCRONIZAÇÃO NATIVA (FETCH + UPSERT)
  // ==========================================
  async syncNow({ trigger = 'MANUAL_SYNC', force = false } = {}) {
    const config = models.getGoogleSheetsSyncConfig();
    if (!config || !config.sheet_url) {
      return {
        success: false,
        error: 'Nenhuma URL de planilha Google Sheets configurada no sistema.'
      };
    }

    const urlInfo = this.extractSheetIdAndUrls(config.sheet_url);
    if (!urlInfo) {
      const err = 'Formato de URL do Google Sheets inválido. Use o link de compartilhamento ou edição.';
      models.recordGoogleSheetsSyncLog({ event_type: trigger, error: err });
      return { success: false, error: err };
    }

    let csvContent = '';
    let fetchError = null;

    // Tentativa 1: Exportação CSV oficial (/export?format=csv)
    try {
      const res = await fetch(urlInfo.csvExportUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 PayBotSheetsSync/2.0' },
        signal: AbortSignal.timeout(7000)
      });
      if (res.ok) {
        csvContent = await res.text();
      } else {
        fetchError = `HTTP ${res.status} ao acessar exportação CSV`;
      }
    } catch (err) {
      fetchError = err.message;
    }

    // Tentativa 2: Fallback via Google Visualization API (/gviz/tq?tqx=out:csv)
    if (!csvContent || csvContent.includes('<!DOCTYPE html>')) {
      try {
        const res2 = await fetch(urlInfo.gvizUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 PayBotSheetsSync/2.0' },
          signal: AbortSignal.timeout(7000)
        });
        if (res2.ok) {
          const t2 = await res2.text();
          if (!t2.includes('<!DOCTYPE html>')) {
            csvContent = t2;
            fetchError = null;
          }
        }
      } catch (_) {}
    }

    if (!csvContent || csvContent.includes('<!DOCTYPE html>')) {
      const msg = `Falha ao baixar CSV do Google Sheets (${fetchError || 'Acesso negado'}). Verifique se a planilha está com acesso "Qualquer pessoa com o link pode ler".`;
      models.recordGoogleSheetsSyncLog({ event_type: trigger, error: msg });
      return { success: false, error: msg };
    }

    // Verifica se houve alteração de conteúdo para poupar I/O
    const contentHash = crypto.createHash('md5').update(csvContent).digest('hex');
    if (!force && this.lastContentHash === contentHash) {
      return {
        success: true,
        skipped: true,
        reason: 'NO_CHANGES',
        message: 'Planilha sem alterações desde a última verificação.'
      };
    }

    const items = this.parseCsv(csvContent);
    if (items.length === 0) {
      const msg = 'Nenhum link válido encontrado no CSV da planilha. Verifique as colunas (ex: Título, Link, Plataforma, Preço).';
      models.recordGoogleSheetsSyncLog({ event_type: trigger, error: msg });
      return { success: false, error: msg };
    }

    const result = models.bulkUpsertAffiliateLinksFromSheet(items, {
      auto_social_listening: Boolean(config.auto_social_listening)
    });

    this.lastContentHash = contentHash;
    this.cachedRowsCount = items.length;

    const details = `Processados ${items.length} itens da planilha. +${result.added} novos, ~${result.updated} atualizados.`;
    models.recordGoogleSheetsSyncLog({
      event_type: trigger,
      links_added: result.added,
      links_updated: result.updated,
      total_processed: items.length,
      details
    });

    console.log(`[Google Sheets 📊] Sync concluído (${trigger}): ${details}`);
    return {
      success: true,
      added: result.added,
      updated: result.updated,
      total: items.length,
      details
    };
  }

  // ==========================================
  // 5. MOTOR DE STREAMING WEBHOOK (PUSH EM TEMPO REAL)
  // ==========================================
  handleWebhookPush(payload, incomingSecret = null) {
    const config = models.getGoogleSheetsSyncConfig();
    if (config.webhook_secret && incomingSecret && config.webhook_secret !== incomingSecret) {
      throw new Error('Chave de autenticação do Webhook inválida.');
    }

    let itemsToProcess = [];
    if (Array.isArray(payload)) {
      itemsToProcess = payload;
    } else if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.items || payload.rows || payload.links)) {
        itemsToProcess = payload.items || payload.rows || payload.links;
      } else {
        itemsToProcess = [payload];
      }
    }

    const sanitized = [];
    for (const item of itemsToProcess) {
      const title = item.title || item.titulo || item.produto || item.nome || '';
      const affiliate_url = item.affiliate_url || item.link || item.url || item.link_afiliado || '';
      if (!title || !affiliate_url) continue;

      let platform = item.platform || item.plataforma || '';
      if (!platform) platform = this.detectPlatformFromUrl(affiliate_url);

      let keywords = item.keywords || item.palavras_chave || '';
      if (!keywords) keywords = this.extractKeywordsFromTitle(title);

      sanitized.push({
        title: String(title).trim(),
        affiliate_url: String(affiliate_url).trim(),
        platform,
        product_price: parseFloat(item.product_price || item.preco || item.valor || 0) || 0.0,
        commission_percent: parseFloat(item.commission_percent || item.comissao || 50) || 50.0,
        keywords,
        pitch_copy: item.pitch_copy || item.copy || null,
        currency: 'BRL'
      });
    }

    if (sanitized.length === 0) {
      throw new Error('Nenhum link de afiliado válido recebido no payload do Webhook.');
    }

    const result = models.bulkUpsertAffiliateLinksFromSheet(sanitized, {
      auto_social_listening: Boolean(config.auto_social_listening)
    });

    const details = `Webhook recebeu ${sanitized.length} links. +${result.added} novos, ~${result.updated} atualizados.`;
    models.recordGoogleSheetsSyncLog({
      event_type: 'WEBHOOK_PUSH',
      links_added: result.added,
      links_updated: result.updated,
      total_processed: sanitized.length,
      details
    });

    console.log(`[Google Sheets Webhook ⚡] ${details}`);
    return {
      success: true,
      added: result.added,
      updated: result.updated,
      total: sanitized.length,
      details
    };
  }

  // ==========================================
  // 6. GERADOR DE CÓDIGO GOOGLE APPS SCRIPT
  // ==========================================
  getGoogleAppsScriptCode(serverBaseUrl = 'http://localhost:3000') {
    const config = models.getGoogleSheetsSyncConfig();
    const endpoint = `${serverBaseUrl.replace(/\/$/, '')}/api/sheets/webhook?secret=${config.webhook_secret}`;

    return `/**
 * ==============================================================
 * PAYBOT - SINCRONIZADOR EM TEMPO REAL PARA GOOGLE SHEETS
 * ==============================================================
 * Instalação:
 * 1. Na sua planilha do Google Sheets, clique em "Extensões" > "Apps Script".
 * 2. Apague o código existente e cole este script completo.
 * 3. Clique em "Salvar" (ícone de disquete) e feche a aba.
 * 4. Pronto! Cada nova linha inserida será enviada instantaneamente ao PayBot.
 */

var PAYBOT_WEBHOOK_URL = "${endpoint}";

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var row = e.range.getRow();
    if (row < 2) return; // Ignora linha de cabeçalho

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

    var payload = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).toLowerCase().trim();
      payload[h] = rowData[i];
    }

    if (payload.link || payload.url || payload.affiliate_url) {
      UrlFetchApp.fetch(PAYBOT_WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    }
  } catch (err) {
    Logger.log("Erro no PayBot Sync: " + err);
  }
}

function syncAllRowsNow() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
  var items = [];

  for (var r = 1; r < data.length; r++) {
    var item = {};
    for (var c = 0; c < headers.length; c++) {
      item[headers[c]] = data[r][c];
    }
    if (item.link || item.url || item.affiliate_url) {
      items.push(item);
    }
  }

  if (items.length > 0) {
    UrlFetchApp.fetch(PAYBOT_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(items),
      muteHttpExceptions: true
    });
  }
}
`;
  }

  // ==========================================
  // 7. POLLER CONTÍNUO EM SEGUNDO PLANO
  // ==========================================
  start() {
    if (this.pollTimer) return;
    const config = models.getGoogleSheetsSyncConfig();
    const intervalSec = Math.max(1, config?.sync_interval_seconds || 5);
    const intervalMs = intervalSec * 1000;

    console.log(`[Google Sheets Poller ⏰] Ativado a cada ${intervalSec}s`);

    this.pollTimer = setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;
      try {
        const currentCfg = models.getGoogleSheetsSyncConfig();
        if (currentCfg && currentCfg.sync_enabled && currentCfg.sheet_url) {
          await this.syncNow({ trigger: 'POLL_SYNC' });
        }
      } catch (err) {
        console.error('[Google Sheets Poller Error]:', err.message);
      } finally {
        this.isPolling = false;
      }
    }, intervalMs);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Google Sheets Poller 🛑] Pausado');
    }
  }

  restart() {
    this.stop();
    this.start();
  }
}

module.exports = new GoogleSheetsSyncService();

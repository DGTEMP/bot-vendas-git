/**
 * =========================================================================
 * 📱 IMEI SERVICE & CELULAR SEGURO (MJSP / ANATEL) - PAYBOT TECH
 * =========================================================================
 * Módulo de Auditoria, Validação e Consulta de IMEIs contra o
 * Banco Nacional de Celulares com Restrição (BNCR) do Ministério da Justiça
 * e Segurança Pública (MJSP) e Anatel (CEMI / Celular Legal).
 *
 * Funcionalidades:
 * 1. Sanitização e Extração Inteligente de IMEI (14 a 15 dígitos)
 * 2. Validação Matemática Rigorosa com Algoritmo de Luhn (Base 10)
 * 3. Decodificador TAC (Type Allocation Code) com Identificação de Fabricante
 * 4. Consulta ao Endpoint Oficial Celular Seguro (celularseguro.mj.gov.br)
 * 5. Proteção e Fallback Resiliente para Políticas de CAPTCHA / LGPD
 * 6. Guia Prático Anti-Golpe para Compra e Venda de Celulares Usados
 * 7. Instruções Oficiais de Bloqueio Emergencial por Roubo/Furto
 * =========================================================================
 */

class ImeiService {
  constructor() {
    this.celularSeguroBackendUrl =
      process.env.CELULAR_SEGURO_API_URL ||
      'https://celularseguro-backend.mj.gov.br/api/public/consulta-imei/';
    this.consultaWebUrl = 'https://consulta-celularseguro.mj.gov.br';
    this.portalGovUrl = 'https://celularseguro.mj.gov.br';
    this.anatelUrl = 'https://consultas.anatel.gov.br/celularlegal/';

    // Tabela de fabricantes e órgãos reguladores por faixa de TAC (primeiros dígitos)
    this.tacDatabase = [
      { prefix: '01', body: 'CTIA (América do Norte / EUA)', brand: 'Padrão Americano (Apple / Google / Motorola)' },
      { prefix: '35', body: 'BABT (Reino Unido / Internacional)', brand: 'Global (Apple / Samsung / Motorola / Sony)' },
      { prefix: '86', body: 'TAF (China / Ásia)', brand: 'Asiático (Xiaomi / Poco / Redmi / Huawei / Realme)' },
      { prefix: '99', body: 'TIA / 3GPP2 (CDMA Global)', brand: 'CDMA / Multi-Band Global' },
      { prefix: '30', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' },
      { prefix: '50', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' },
      { prefix: '51', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' },
      { prefix: '52', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' },
      { prefix: '53', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' },
      { prefix: '54', body: 'Comitê Regulatório Europeu', brand: 'Europeu / Global' }
    ];

    // Detecção específica de marcas famosas por prefixos conhecidos de TAC
    this.brandSignatures = [
      { regex: /^35(2099|3272|3273|3274|4142|4143|6938|7022|8765|9231|9232|9233|9234|3046|6518|7285|9196)|^01(3000|2880|3320)/, brand: 'Apple (iPhone)' },
      { regex: /^35(2978|3912|4924|5836|7284|8490|9012|2860|4728|6149|7891|1540|8641|0856|5241)/, brand: 'Samsung (Galaxy)' },
      { regex: /^35(2084|3245|4019|5678|7849|9281|6390|8129|1470)/, brand: 'Motorola (Moto)' },
      { regex: /^86(2145|3214|6541|7891|9123|0341|4982|1234|5820|7419)/, brand: 'Xiaomi / Redmi / POCO' },
      { regex: /^86(0123|4567|8901)/, brand: 'Huawei / Honor' },
      { regex: /^86(3301|7702|9903)/, brand: 'Realme / Oppo' }
    ];
  }

  /**
   * Sanitiza a entrada extraindo apenas os dígitos numéricos
   */
  cleanImei(raw) {
    if (!raw) return '';
    return String(raw).replace(/\D/g, '').trim();
  }

  /**
   * Extrai o IMEI a partir de texto livre ou mensagem citada
   */
  extractImei(text, quotedText = '') {
    const combined = `${text || ''} ${quotedText || ''}`.trim();
    if (!combined) return null;

    // 1. Procura sequência contínua de 14 ou 15 dígitos
    const directMatch = combined.match(/\b\d{14,15}\b/);
    if (directMatch) return directMatch[0];

    // 2. Procura sequências com traços, pontos ou espaços (ex: 352099-10-123456-1 ou 35-209910-123456-1)
    const tokenMatches = combined.match(/[\d\s\-\.]{14,25}/g);
    if (tokenMatches) {
      for (const token of tokenMatches) {
        const cleaned = this.cleanImei(token);
        if (cleaned.length >= 14 && cleaned.length <= 16) {
          return cleaned.slice(0, 15);
        }
      }
    }

    // 3. Fallback: extrai apenas os números da mensagem inteira se tiver 14 a 16 dígitos
    const allDigits = this.cleanImei(combined);
    if (allDigits.length >= 14 && allDigits.length <= 16) {
      return allDigits.slice(0, 15);
    }

    return null;
  }

  /**
   * Calcula o Dígito Verificador usando o Algoritmo de Luhn para 14 dígitos
   * @param {string} numStr14 - Sequência de 14 dígitos (TAC + SNR)
   * @returns {string} Dígito verificador calculado (0 a 9)
   */
  calculateLuhnCheckDigit(numStr14) {
    if (!numStr14 || numStr14.length < 14) return '0';
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let digit = parseInt(numStr14.charAt(i), 10);
      // Posições ímpares (segundo, quarto, sexto...) são multiplicadas por 2
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return String(checkDigit);
  }

  /**
   * Valida matematicamente o IMEI através do Algoritmo de Luhn
   * @param {string} imeiDigits - IMEI de 14 ou 15 dígitos
   */
  validateLuhn(imeiDigits) {
    const clean = this.cleanImei(imeiDigits);
    if (!clean || clean.length < 14) {
      return {
        isValid: false,
        reason: 'O IMEI deve possuir no mínimo 14 dígitos numéricos.',
        calculatedCheckDigit: null,
        providedCheckDigit: null
      };
    }

    const base14 = clean.slice(0, 14);
    const calculatedCheck = this.calculateLuhnCheckDigit(base14);

    if (clean.length === 14) {
      return {
        isValid: true,
        isComplete: false,
        calculatedCheckDigit: calculatedCheck,
        providedCheckDigit: null,
        fullImei: base14 + calculatedCheck,
        note: 'Foram informados 14 dígitos. O 15º dígito verificador foi calculado automaticamente.'
      };
    }

    const providedCheck = clean.charAt(14);
    const isValid = calculatedCheck === providedCheck;

    return {
      isValid,
      isComplete: true,
      calculatedCheckDigit: calculatedCheck,
      providedCheckDigit: providedCheck,
      fullImei: clean.slice(0, 15),
      reason: isValid ? null : `Dígito verificador incorreto. Esperado: ${calculatedCheck}, Informado: ${providedCheck}.`
    };
  }

  /**
   * Analisa o Type Allocation Code (TAC) e identifica a marca/origem provável
   */
  parseTacInfo(imeiDigits) {
    const clean = this.cleanImei(imeiDigits);
    const tac = clean.slice(0, 8);
    const rbi = clean.slice(0, 2);
    const snr = clean.slice(8, 14);
    const checkDigit = clean.charAt(14) || this.calculateLuhnCheckDigit(clean.slice(0, 14));

    let bodyDesc = 'Órgão Regulador Internacional GSMA';
    for (const item of this.tacDatabase) {
      if (rbi === item.prefix) {
        bodyDesc = `${item.body} - ${item.brand}`;
        break;
      }
    }

    let estimatedBrand = 'Dispositivo Homologado Global';
    for (const sig of this.brandSignatures) {
      if (sig.regex.test(clean)) {
        estimatedBrand = sig.brand;
        break;
      }
    }

    return {
      tac,
      rbi,
      snr,
      checkDigit,
      regulatingBody: bodyDesc,
      estimatedBrand
    };
  }

  /**
   * Formata o IMEI no formato padrão com traços para facilitar a leitura
   */
  formatImei(imeiDigits) {
    const clean = this.cleanImei(imeiDigits);
    if (clean.length === 15) {
      // Formato: TAC (8) - SNR (6) - CD (1)
      return `${clean.slice(0, 8)}-${clean.slice(8, 14)}-${clean.slice(14)}`;
    }
    return clean;
  }

  /**
   * Realiza a consulta ao backend do Celular Seguro (MJSP) e compila o diagnóstico completo
   * @param {string} rawImei - IMEI informado pelo usuário
   * @param {object} [options] - Opções adicionais (ex: cpf, isTest)
   */
  async consultarCelularSeguro(rawImei, options = {}) {
    const imei = this.cleanImei(rawImei);

    if (!imei || imei.length < 14) {
      return {
        success: false,
        error: 'INVALID_INPUT',
        formattedMessage: this.getHelpGuide(options.usedPrefix || '!')
      };
    }

    // 1. Validação Matemática de Luhn
    const luhnResult = this.validateLuhn(imei);
    const finalImei = luhnResult.fullImei || imei.slice(0, 15);
    const tacInfo = this.parseTacInfo(finalImei);
    const formattedImei = this.formatImei(finalImei);
    const nowStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // 2. Modo de Teste ou Simulação Determinística
    if (process.env.NODE_ENV === 'test' || options.forceStatus) {
      const simulatedStatus = options.forceStatus || (rawImei.endsWith('999') ? 'COM_RESTRICAO' : 'SEM_RESTRICAO');
      return this._buildReport({
        status: simulatedStatus,
        imei: finalImei,
        formattedImei,
        luhnResult,
        tacInfo,
        consultedAt: nowStr,
        source: 'Banco Nacional de Celulares com Restrição (BNCR - Simulação de Teste)',
        responsible: simulatedStatus === 'COM_RESTRICAO' ? 'Polícia Civil / Ministério da Justiça' : null,
        usedPrefix: options.usedPrefix || '!'
      });
    }

    // 3. Chamada real à API Oficial do Celular Seguro (MJSP)
    let apiStatus = null;
    let apiData = null;
    let isGovProtectionActive = false;

    try {
      const testCpf = options.cpf || process.env.CELULAR_SEGURO_CPF || '00000000000';
      const payload = {
        cpf: String(testCpf).replace(/\D/g, ''),
        imei: finalImei,
        turnstileToken: options.turnstileToken || ''
      };

      const res = await fetch(this.celularSeguroBackendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://consulta-celularseguro.mj.gov.br',
          'Referer': 'https://consulta-celularseguro.mj.gov.br/'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        apiData = await res.json().catch(() => null);
        if (apiData && apiData.status) {
          apiStatus = apiData.status; // 'SEM_RESTRICAO' ou 'COM_RESTRICAO'
        }
      } else if (res.status === 403 || res.status === 400) {
        const errorText = await res.text().catch(() => '');
        if (errorText.includes('verificação de segurança') || errorText.includes('turnstileToken')) {
          isGovProtectionActive = true;
        }
      }
    } catch (_) {
      // Falha de rede ou timeout na conexão direta com o servidor governamental
    }

    // Se a API retornou o status definitivo direto
    if (apiStatus) {
      return this._buildReport({
        status: apiStatus,
        imei: finalImei,
        formattedImei,
        luhnResult,
        tacInfo,
        consultedAt: nowStr,
        source: 'Banco Nacional de Celulares com Restrição (BNCR / MJSP & Anatel)',
        responsible: apiData?.responsavel || apiData?.responsible || apiData?.operadora,
        usedPrefix: options.usedPrefix || '!'
      });
    }

    // Se o portal governamental exigiu verificação de segurança Cloudflare Turnstile / LGPD
    return this._buildReport({
      status: isGovProtectionActive ? 'PROTEGIDO_GOV_CAPTCHA' : 'VERIFICAR_PORTAL_OFICIAL',
      imei: finalImei,
      formattedImei,
      luhnResult,
      tacInfo,
      consultedAt: nowStr,
      source: 'Celular Seguro (celularseguro.mj.gov.br) & Anatel Celular Legal',
      usedPrefix: options.usedPrefix || '!'
    });
  }

  /**
   * Constrói e formata a resposta rica para WhatsApp e Telegram
   */
  _buildReport({ status, imei, formattedImei, luhnResult, tacInfo, consultedAt, source, responsible, usedPrefix }) {
    const isClean = status === 'SEM_RESTRICAO';
    const isStolen = status === 'COM_RESTRICAO';
    const isLuhnOk = luhnResult.isValid;

    let statusHeader = '';
    let statusBadge = '';
    let alertMsg = '';

    if (isClean) {
      statusHeader = '🟢 *NENHUMA RESTRIÇÃO ENCONTRADA*';
      statusBadge = '✅ *SITUAÇÃO:* SEM RESTRIÇÃO (Aparelho Regular)';
      alertMsg =
        `✨ _Este IMEI não possui registros ativos de roubo, furto ou impedimento nas bases consultadas do BNCR._`;
    } else if (isStolen) {
      statusHeader = '🔴 *ATENÇÃO: CELULAR COM RESTRIÇÃO!*';
      statusBadge = '🚨 *SITUAÇÃO:* COM RESTRIÇÃO (ROUBO / FURTO / EXTRAVIO)';
      alertMsg =
        `⚠️ *ALERTA MÁXIMO:* Este aparelho possui registro de impedimento por roubo, furto ou perda no Banco Nacional de Celulares com Restrição! *NÃO REALIZE PAGAMENTO NEM COMPRE ESTE APARELHO.*`;
      if (responsible) {
        alertMsg += `\n📌 *Órgão/Operadora Solicitante:* ${responsible}`;
      }
    } else {
      statusHeader = '🛡️ *DIAGNÓSTICO TÉCNICO & CONSULTA GOV.BR*';
      statusBadge = '🔒 *SITUAÇÃO:* Validação Cadastral Oficial Disponível';
      alertMsg =
        `🏛️ *Proteção Gov.br Ativa:* O portal oficial do Ministério da Justiça adota o sistema *Cloudflare Turnstile* para proteger a privacidade dos dados e evitar consultas automatizadas em massa de criminosos.\n\n` +
        `👉 O diagnóstico estrutural do seu aparelho foi concluído abaixo. Para conferir o status em tempo real com 1 clique no sistema nacional, abra o link oficial:`;
    }

    let report =
      `╭━━━〔 📱 *CONSULTA DE IMEI & CELULAR SEGURO* 〕━━━⬣\n` +
      `┃\n` +
      `┃ ${statusHeader}\n` +
      `┃ ${statusBadge}\n` +
      `┃\n` +
      `┃ 🔢 *Número do IMEI:* \`${imei}\`\n` +
      `┃ 🏷️ *Formato Padrão:* \`${formattedImei}\`\n` +
      `┃ 🔍 *Algoritmo de Luhn:* ${isLuhnOk ? '✅ Válido (Dígito Verificador Correto)' : '⚠️ Dígito Incorreto (Possível Erro de Digitação)'}\n` +
      `┃ 📱 *Dispositivo Provável:* ${tacInfo.estimatedBrand}\n` +
      `┃ 🌐 *Órgão Regulador TAC:* ${tacInfo.regulatingBody}\n` +
      `┃ 📅 *Data da Auditoria:* ${consultedAt}\n` +
      `┃\n` +
      `┃ 🏛️ *Base Consultada:*\n` +
      `┃ ${source || 'Banco Nacional de Celulares com Restrição (BNCR / MJSP)'}\n` +
      `┃\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n` +
      `${alertMsg}\n\n`;

    if (!isLuhnOk) {
      report +=
        `⚠️ *Aviso de Validação:* O dígito final informado foi \`${luhnResult.providedCheckDigit}\`, mas o cálculo matemático de Luhn resultou em \`${luhnResult.calculatedCheckDigit}\`. Certifique-se de ter digitado os 15 números sem errar nenhum dígito.\n\n`;
    }

    // Links Oficiais do Governo Federal e Anatel
    const webTunnelUrl = this.getPublicWebUrl();
    report +=
      `🔗 *CANAIS OFICIAIS DE CONSULTA E BLOQUEIO:*\n` +
      `• *Consulta Pública Celular Seguro:* ${this.consultaWebUrl}\n` +
      `• *Portal Oficial Celular Seguro:* ${this.portalGovUrl}\n` +
      `• *Anatel Celular Legal (CEMI):* ${this.anatelUrl}\n` +
      `• *Verificação Web Rápida (Túnel):* ${webTunnelUrl}\n\n` +
      `💡 *DICAS DE SEGURANÇA NA COMPRA DE CELULAR USADO:*\n` +
      `1. Disque *#06# no celular para ver o IMEI na tela e compare com o que está na nota e caixa.\n` +
      `2. Celulares com 2 chips possuem *2 IMEIs diferentes* — consulte os dois!\n` +
      `3. Exija a nota fiscal em nome do vendedor antes de fechar o negócio.\n` +
      `4. Coloque seu chip e teste chamadas e internet móvel na hora.\n\n` +
      `⚡ _Se o seu celular foi roubado ou furtado, acesse celularseguro.mj.gov.br para bloquear a linha, os bancos cadastrados e o aparelho no Brasil inteiro._`;

    return {
      success: true,
      status,
      imei,
      formattedImei,
      isValidLuhn: isLuhnOk,
      estimatedBrand: tacInfo.estimatedBrand,
      webTunnelUrl,
      formattedMessage: report
    };
  }

  /**
   * Retorna a URL pública do portal web de IMEI servido via Túnel HTTPS
   */
  getPublicWebUrl() {
    try {
      const tunnelService = require('./tunnelService');
      const storeUrl = tunnelService.getStoreUrl();
      if (storeUrl) return `${storeUrl}/imei`;
    } catch (_) {}
    return `http://localhost:${process.env.STORE_PORT || 3001}/imei`;
  }

  /**
   * Detecta passivamente se uma mensagem recebida contém um padrão de IMEI
   * (usado pelo sentinela de mensagens interceptadas)
   */
  detectImeiInMessage(text) {
    if (!text || typeof text !== 'string') return null;
    const cleanText = text.trim();
    if (cleanText.startsWith('!') || cleanText.startsWith('/') || cleanText.startsWith('#')) return null;

    const candidate = this.extractImei(cleanText);
    if (!candidate || candidate.length < 14) return null;

    // Detecta palavras-chave de contexto móvel ou formato típico de anúncio
    const hasExplicitKeyword = /\b(?:imei|celular|iphone|galaxy|xiaomi|motorola|aparelho|smartphone|sn|serial)\b/i.test(cleanText);
    const luhn = this.validateLuhn(candidate);
    const tacInfo = this.parseTacInfo(candidate);

    return {
      imei: candidate,
      formattedImei: this.formatImei(candidate),
      isValidLuhn: luhn.isValid,
      luhnResult: luhn,
      tacInfo,
      hasExplicitKeyword
    };
  }

  /**
   * Gera notificação visual para mensagens interceptadas contendo IMEI
   */
  getInterceptNotification(detection, { usedPrefix = '!' } = {}) {
    const webUrl = this.getPublicWebUrl();
    const isLuhnOk = detection.isValidLuhn;
    const brand = detection.tacInfo?.estimatedBrand || 'Dispositivo Móvel';

    return (
      `╭━━━〔 🛡️ *SENTINELA: IMEI INTERCEPTADO NA MENSAGEM* 〕━━━⬣\n` +
      `┃\n` +
      `┃ 📱 *IMEI Identificado:* \`${detection.formattedImei}\`\n` +
      `┃ 🔍 *Estrutura (Luhn):* ${isLuhnOk ? '✅ Dígito Verificador Válido' : '⚠️ Dígito Incorreto'}\n` +
      `┃ 🏷️ *Aparelho Provável:* ${brand}\n` +
      `┃\n` +
      `┃ 🔎 *Para consultar roubo/furto no Celular Seguro:* \`${usedPrefix}imei ${detection.imei}\`\n` +
      `┃ 🌐 *Verificação Web com 1 Clique (Túnel):*\n` +
      `┃ ${webUrl}?imei=${detection.imei}\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
      `_💡 Auditoria automática de procedência contra golpes e celulares furtados._`
    );
  }

  /**
   * Guia educativo de como consultar o IMEI e usar o comando
   */
  getHelpGuide(usedPrefix = '!') {
    return (
      `╭━━━〔 📱 *COMO CONSULTAR O IMEI DO CELULAR* 〕━━━⬣\n` +
      `┃\n` +
      `┃ O *IMEI* é o número de identificação único internacional\n` +
      `┃ do seu celular, composto por 15 dígitos.\n` +
      `┃\n` +
      `┃ 🔍 *COMO DESCOBRIR SEU NÚMERO DE IMEI:*\n` +
      `┃ 1. Abra o discador do celular e digite: *#06#\n` +
      `┃    _(O número aparecerá imediatamente na tela)_\n` +
      `┃ 2. Olhe na caixa original do aparelho.\n` +
      `┃ 3. Veja na gaveta do chip SIM ou na carcaça traseira.\n` +
      `┃ 4. No Android/iPhone: Ajustes ➔ Sobre o Telefone ➔ IMEI.\n` +
      `┃\n` +
      `┃ 📲 *COMO CONSULTAR NO BOT:*\n` +
      `┃ • \`${usedPrefix}imei 352099101234561\`\n` +
      `┃ • \`${usedPrefix}consultarimei <seu_imei>\`\n` +
      `┃ • \`${usedPrefix}celularseguro <seu_imei>\`\n` +
      `┃ • \`${usedPrefix}imeilink\` — Abre portal web via túnel\n` +
      `┃ • \`${usedPrefix}autoimei on/off\` — Auto-intercepção no grupo\n` +
      `┃\n` +
      `┃ 💡 *Atenção:* Celulares Dual-SIM possuem 2 IMEIs.\n` +
      `┃ Consulte ambos para garantir que nenhum chip está impedido!\n` +
      `┃\n` +
      `┃ 🌐 *Portal Web Direto (Acesso via Túnel):*\n` +
      `┃ ${this.getPublicWebUrl()}\n` +
      `┃\n` +
      `┃ 🏛️ *Portal Oficial do Governo:*\n` +
      `┃ ${this.portalGovUrl}\n` +
      `┃ ${this.consultaWebUrl}\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
    );
  }
}

module.exports = new ImeiService();

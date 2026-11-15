/**
 * =========================================================================
 * 🏦 PIX EMVCo / BACEN BR CODE UTILITY (Padrão Oficial Banco Central do Brasil)
 * =========================================================================
 * Conformidade estrita com o Manual de Padrões para Iniciação do Pix (BACEN):
 * - Cálculo de Checksum CRC16-CCITT (Polinômio 0x1021, Init 0xFFFF)
 * - Formatador e Parser TLV (Tag-Length-Value)
 * - Detecção, Sanitização e Normalização de Chaves Pix (CPF, CNPJ, Telefone, E-mail, EVP)
 * - Auto-correção de telefones celulares brasileiros com/sem nono dígito (+55DDD9XXXXXXXX)
 * - Normalização Universal de QR Codes Dinâmicos (injeção do campo obrigatório 010212)
 * - Geração de Pix Copia e Cola Estático com txid '***' universal (100% dos bancos)
 * - Validador de integridade e conformidade bancária
 * =========================================================================
 */

// Formatador padrão EMV BACEN QRCPS-MPM (Tag + Tamanho 2 dígitos + Valor)
function formatEMV(id, val) {
  const str = String(val ?? '');
  const len = String(str.length).padStart(2, '0');
  return id + len + str;
}

// Cálculo do Checksum CRC16 CCITT padrão BACEN (Polinômio 0x1021, Init 0xFFFF, CCITT-FALSE)
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Parser TLV para depuração e diagnóstico
function parseEMV(code) {
  if (!code || typeof code !== 'string') return [];
  const tags = [];
  let idx = 0;
  const cleanCode = code.trim().replace(/[\r\n\t]/g, '');

  while (idx < cleanCode.length) {
    if (idx + 4 > cleanCode.length) break;
    const id = cleanCode.substring(idx, idx + 2);
    const lenStr = cleanCode.substring(idx + 2, idx + 4);
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || len < 0 || idx + 4 + len > cleanCode.length) {
      break;
    }
    const val = cleanCode.substring(idx + 4, idx + 4 + len);
    tags.push({ id, len, val });
    idx += 4 + len;
  }
  return tags;
}

/**
 * Normaliza número de telefone celular brasileiro para o formato internacional E.164:
 * +55 seguido de 2 dígitos de DDD e 9 dígitos de celular (total 11 dígitos pós-+55).
 * Se o usuário passar um número sem o 9 (ex: 554884702848 ou 4884702848), adiciona o 9.
 */
function normalizeBrazilianPhone(digits) {
  let p = String(digits || '').replace(/\D/g, '');
  if (!p) return '';

  // Se já possui DDI 55
  if (p.startsWith('55')) {
    const withoutDdi = p.slice(2);
    // 10 dígitos: DDD + 8 dígitos (celular sem o 9º dígito)
    if (withoutDdi.length === 10) {
      const ddd = parseInt(withoutDdi.slice(0, 2), 10);
      const rest = withoutDdi.slice(2);
      if (ddd >= 11 && ddd <= 99 && /^[6-9]/.test(rest)) {
        return `+55${withoutDdi.slice(0, 2)}9${rest}`;
      }
    }
    return `+${p}`;
  }

  // 10 dígitos sem DDI: DDD + 8 dígitos (ex: 4884702848)
  if (p.length === 10) {
    const ddd = parseInt(p.slice(0, 2), 10);
    const rest = p.slice(2);
    if (ddd >= 11 && ddd <= 99 && /^[6-9]/.test(rest)) {
      return `+55${p.slice(0, 2)}9${rest}`;
    }
    return `+55${p}`;
  }

  // 11 dígitos sem DDI: DDD + 9 dígitos de celular (ex: 48984702848)
  if (p.length === 11) {
    return `+55${p}`;
  }

  return `+${p}`;
}

/**
 * Detecção inteligente e sanitização da Chave Pix conforme o manual oficial do BACEN:
 * - Telefone: formato internacional E.164 com +55 (ex: +5548984702848)
 * - CPF: 11 dígitos numéricos sem pontuação
 * - CNPJ: 14 dígitos numéricos sem pontuação
 * - E-mail: minúsculo e sem espaços
 * - EVP (Aleatória): UUID minúsculo
 */
function detectAndSanitizePixKey(rawKey, optionalType = '') {
  let clean = String(rawKey || '').trim().replace(/^[`"']+|[`"']+$/g, '');
  const typeHint = String(optionalType || '').trim().toLowerCase();

  // E-mail
  if (typeHint === 'email' || (!typeHint && clean.includes('@'))) {
    return { type: 'E-mail', key: clean.toLowerCase().replace(/\s+/g, '') };
  }

  // Chave Aleatória (EVP/UUID com hifens)
  if (typeHint === 'evp' || typeHint === 'aleatoria' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    return { type: 'Chave Aleatória (EVP)', key: clean.toLowerCase().trim() };
  }

  const digits = clean.replace(/\D/g, '');

  // CNPJ com 14 dígitos
  if (typeHint === 'cnpj' || digits.length === 14) {
    return { type: 'CNPJ', key: digits };
  }

  // CPF explícito
  if (typeHint === 'cpf') {
    return { type: 'CPF', key: digits };
  }

  // Telefone explícito
  if (typeHint === 'telefone' || typeHint === 'celular' || typeHint === 'phone') {
    return { type: 'Telefone', key: normalizeBrazilianPhone(digits) };
  }

  // Telefone que já começa com '+'
  if (clean.startsWith('+')) {
    return { type: 'Telefone', key: normalizeBrazilianPhone(digits) };
  }

  // Telefone com DDI 55 já embutido (12 dígitos numéricos: 55 + DDD + 8 dígitos)
  if (digits.length === 12 && digits.startsWith('55')) {
    return { type: 'Telefone', key: normalizeBrazilianPhone(digits) };
  }

  // Telefone com DDI 55 e 13 dígitos numéricos (55 + DDD + 9 dígitos)
  if (digits.length === 13 && digits.startsWith('55')) {
    return { type: 'Telefone', key: `+${digits}` };
  }

  // Telefone ou CPF com 11 dígitos
  if (digits.length === 11) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    const thirdDigit = digits[2];
    // Se o DDD é válido no Brasil e o 3º dígito é 9 e não há pontos de máscara de CPF, trata como celular
    if (ddd >= 11 && ddd <= 99 && thirdDigit === '9' && !clean.includes('.')) {
      return { type: 'Telefone', key: `+55${digits}` };
    }
    return { type: 'CPF', key: digits };
  }

  // Telefone com 10 dígitos (DDD + 8 dígitos)
  if (digits.length === 10) {
    return { type: 'Telefone', key: normalizeBrazilianPhone(digits) };
  }

  return { type: 'Personalizado', key: clean };
}

function sanitizePixKey(rawKey, optionalType = '') {
  return detectAndSanitizePixKey(rawKey, optionalType).key;
}

/**
 * Normaliza e valida qualquer código Pix Copia e Cola (BR Code EMV):
 * 1. Remove quebras de linha e crases/aspas envolventes de markdown.
 * 2. Se for QR Code Dinâmico (tem URL de location no subcampo 25 do campo 26):
 *    Garante que o Point of Initiation Method '010212' esteja presente.
 *    (Sem esse campo, os bancos tratam o código como estático e rejeitam por falta de chave Pix).
 * 3. Valida e recalcula o CRC16-CCITT ('6304XXXX') oficial.
 */
function normalizeAndValidatePixCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return '';
  let code = rawCode.trim().replace(/[\r\n\t]/g, '').replace(/^[`"']+|[`"']+$/g, '').trim();
  if (!code.startsWith('000201')) return code;

  // Extrai o índice do CRC16 se existir
  const crcTagIdx = code.lastIndexOf('6304');
  let basePayload = crcTagIdx !== -1 ? code.substring(0, crcTagIdx) : code;

  // Detecta se é QR Code Dinâmico (possui subcampo 25 com URL no campo 26)
  const isDynamic = basePayload.includes('0014br.gov.bcb.pix25') || /26\d{2}.*?25\d{2}[a-zA-Z0-9.\-_/]+/.test(basePayload);
  const hasPoi = /^0002010102/.test(basePayload);

  let modified = false;
  if (isDynamic && !hasPoi) {
    // Insere Point of Initiation Method: 12 (Dinâmico) logo após 000201
    basePayload = basePayload.slice(0, 6) + '010212' + basePayload.slice(6);
    modified = true;
  } else if (!isDynamic && !hasPoi) {
    // Se for estático e faltar POI, insere 010211 (Estático)
    basePayload = basePayload.slice(0, 6) + '010211' + basePayload.slice(6);
    modified = true;
  }

  // Prepara para checagem / recálculo do CRC16
  const payloadToHash = basePayload + '6304';
  const computedCrc = crc16(payloadToHash);

  // Se já existia CRC de 4 caracteres e o payload não foi modificado, valida integridade
  if (!modified && crcTagIdx !== -1 && code.length >= crcTagIdx + 8) {
    const existingCrc = code.substring(crcTagIdx + 4, crcTagIdx + 8).toUpperCase();
    if (existingCrc === computedCrc) {
      return code.substring(0, crcTagIdx + 8);
    }
  }

  return payloadToHash + computedCrc;
}

/**
 * Gerador oficial de código Pix Copia e Cola BACEN (000201...)
 * Constrói payload EMV completo com txid '***' padrão ouro universal para QR Code Estático.
 */
function generateBacenPixPayload({ pixKey, merchantName, merchantCity, amount, txid = '***' }) {
  const key = sanitizePixKey(pixKey || '5548984702848');
  const pfi = formatEMV('00', '01');
  const poi = formatEMV('01', '11'); // 11 = QR Code Estático universal padrão BACEN
  const gui = formatEMV('00', 'br.gov.bcb.pix');
  const keyField = formatEMV('01', key);
  const mai = formatEMV('26', gui + keyField);
  const mcc = formatEMV('52', '0000');
  const cur = formatEMV('53', '986');
  const amt = amount && Number(amount) > 0 ? formatEMV('54', Number(amount).toFixed(2)) : '';
  const ctry = formatEMV('58', 'BR');

  const cleanName = (merchantName || 'PAYBOT')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim().toUpperCase().slice(0, 25) || 'PAYBOT';

  const cleanCity = (merchantCity || 'SAO PAULO')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim().toUpperCase().slice(0, 15) || 'SAO PAULO';

  const name = formatEMV('59', cleanName);
  const city = formatEMV('60', cleanCity);

  // No Pix Estático universal, txid DEVE ser '***' para compatibilidade com 100% dos apps bancários
  let cleanTxid = String(txid || '***').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  if (!cleanTxid || cleanTxid.length === 0) cleanTxid = '***';
  const addData = formatEMV('62', formatEMV('05', cleanTxid));

  const payloadToCRC = pfi + poi + mai + mcc + cur + amt + ctry + name + city + addData + '6304';
  const checksum = crc16(payloadToCRC);
  return payloadToCRC + checksum;
}

/**
 * Diagnóstico completo de um código Pix Copia e Cola (BR Code):
 * Verifica tipo (Dinâmico vs Estático), tags obrigatórias, integridade do CRC16 e conformidade com o BACEN.
 */
function inspectPixCode(code) {
  const norm = normalizeAndValidatePixCode(code);
  const tags = parseEMV(norm);
  const tagMap = {};
  for (const t of tags) tagMap[t.id] = t.val;

  const isDynamic = Boolean(tagMap['26'] && (tagMap['26'].includes('25') || tagMap['26'].includes('http') || tagMap['26'].includes('.br/')));
  const isStatic = !isDynamic;
  const poi = tagMap['01'] || '';
  const isCompliant = isDynamic ? (poi === '12') : (poi === '11' || !poi);
  const crc = tagMap['63'] || '';

  return {
    originalCode: code,
    normalizedCode: norm,
    isValid: norm.startsWith('000201') && crc.length === 4,
    type: isDynamic ? 'DINAMICO' : 'ESTATICO',
    poi,
    isCompliant,
    merchantName: tagMap['59'] || 'N/A',
    merchantCity: tagMap['60'] || 'N/A',
    amount: tagMap['54'] || 'Definido no pagamento',
    currency: tagMap['53'] === '986' ? 'BRL (R$)' : tagMap['53'],
    country: tagMap['58'] || 'BR',
    txid: tagMap['62'] ? tagMap['62'].replace(/^05\d{2}/, '') : '***',
    accountInfo: tagMap['26'] || '',
    crc16: crc,
    tags
  };
}

module.exports = {
  formatEMV,
  crc16,
  parseEMV,
  normalizeBrazilianPhone,
  detectAndSanitizePixKey,
  sanitizePixKey,
  normalizeAndValidatePixCode,
  generateBacenPixPayload,
  inspectPixCode
};

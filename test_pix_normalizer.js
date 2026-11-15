function crc16_func(str) {
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

function normalizeAndValidatePixCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return '';
  // Limpa espaços apenas nas bordas, remove quebras de linha e crases/aspas envolventes
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

  // Prepara para checagem / cálculo de CRC
  const payloadToHash = basePayload + '6304';
  const computedCrc = crc16_func(payloadToHash);

  // Se já existia CRC de 4 caracteres e o payload não foi modificado, valida integridade
  if (!modified && crcTagIdx !== -1 && code.length >= crcTagIdx + 8) {
    const existingCrc = code.substring(crcTagIdx + 4, crcTagIdx + 8).toUpperCase();
    if (existingCrc === computedCrc) {
      return code.substring(0, crcTagIdx + 8);
    }
  }

  return payloadToHash + computedCrc;
}

const livepixRaw = '00020126870014br.gov.bcb.pix2565pix.infopago.com.br/qr/v3/at/3634c390-e14f-4312-8d77-669a67706cbf5204000053039865802BR5912LIVEPIX_LTDA6009SAO_PAULO62070503***6304B92D';
const normalized = normalizeAndValidatePixCode(livepixRaw);
console.log('LivePix Normalizado:');
console.log(normalized);

const wooviRaw = '00020101021226810014br.gov.bcb.pix2559qr.woovi.com/qr/v2/cob/30c43bf7-0ac6-434e-adf8-791af6c36e0c520400005303986540552.405802BR5907LIVEPIX6009SAO PAULO622905250a8e4f803b9b40758806f2fd66304AF35';
console.log('Woovi norm matches wooviRaw:', normalizeAndValidatePixCode(wooviRaw) === wooviRaw);

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

  // Helper para normalizar celular brasileiro (adiciona 9 se faltar para DDDs móveis 11 a 99)
  function formatBrazilianPhone(phoneDigits) {
    let p = phoneDigits;
    // Se começa com DDI 55
    if (p.startsWith('55')) {
      const withoutDdi = p.slice(2);
      if (withoutDdi.length === 10) { // DDD + 8 dígitos (celular sem o 9)
        const ddd = parseInt(withoutDdi.slice(0, 2), 10);
        const rest = withoutDdi.slice(2);
        if (ddd >= 11 && ddd <= 99 && /^[6-9]/.test(rest)) {
          return `+55${withoutDdi.slice(0, 2)}9${rest}`;
        }
      }
      return `+${p}`;
    }
    // Sem DDI (10 dígitos: DDD + 8 dígitos)
    if (p.length === 10) {
      const ddd = parseInt(p.slice(0, 2), 10);
      const rest = p.slice(2);
      if (ddd >= 11 && ddd <= 99 && /^[6-9]/.test(rest)) {
        return `+55${p.slice(0, 2)}9${rest}`;
      }
      return `+55${p}`;
    }
    // 11 dígitos (DDD + 9 dígitos de celular)
    if (p.length === 11) {
      return `+55${p}`;
    }
    return `+${p}`;
  }

  // Telefone explícito
  if (typeHint === 'telefone' || typeHint === 'celular' || typeHint === 'phone') {
    return { type: 'Telefone', key: formatBrazilianPhone(digits) };
  }

  // Telefone que já começa com '+'
  if (clean.startsWith('+')) {
    return { type: 'Telefone', key: formatBrazilianPhone(digits) };
  }

  // Telefone com DDI 55 já embutido (12 dígitos numéricos: 55 + DDD + 8 dígitos)
  if (digits.length === 12 && digits.startsWith('55')) {
    return { type: 'Telefone', key: formatBrazilianPhone(digits) };
  }

  // Telefone com DDI 55 e 13 dígitos numéricos (55 + DDD + 9 dígitos)
  if (digits.length === 13 && digits.startsWith('55')) {
    return { type: 'Telefone', key: `+${digits}` };
  }

  // Telefone ou CPF com 11 dígitos
  if (digits.length === 11) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    const thirdDigit = digits[2];
    // Se o DDD é válido no Brasil e o 3º dígito é 9 e não há pontos (máscara de CPF), trata como telefone celular
    if (ddd >= 11 && ddd <= 99 && thirdDigit === '9' && !clean.includes('.')) {
      return { type: 'Telefone', key: `+55${digits}` };
    }
    return { type: 'CPF', key: digits };
  }

  // Telefone com 10 dígitos (DDD + 8 dígitos)
  if (digits.length === 10) {
    return { type: 'Telefone', key: formatBrazilianPhone(digits) };
  }

  return { type: 'Personalizado', key: clean };
}

console.log('Sanitize 554884702848:', detectAndSanitizePixKey('554884702848'));
console.log('Sanitize 4884702848:', detectAndSanitizePixKey('4884702848'));
console.log('Sanitize 48984702848:', detectAndSanitizePixKey('48984702848'));
console.log('Sanitize +554884702848:', detectAndSanitizePixKey('+554884702848'));
console.log('Sanitize +5548984702848:', detectAndSanitizePixKey('+5548984702848'));
console.log('Sanitize CPF 12345678909:', detectAndSanitizePixKey('12345678909', 'cpf'));
console.log('Sanitize Email:', detectAndSanitizePixKey('contato@paybot.com'));

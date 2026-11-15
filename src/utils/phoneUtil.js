/**
 * src/utils/phoneUtil.js
 * Utilitário Universal de Telefonia Internacional (ITU E.164) & Localização
 *
 * Suporte completo para:
 * 1. Conexão de Sub-Bots em QUALQUER país do mundo sem forçar prefixo +55 do Brasil.
 * 2. Detecção inteligente de DDI, país de origem, bandeira (emoji), idioma e moeda.
 * 3. Normalização retrocompatível de números brasileiros (adicionando 55 apenas quando for BR legítimo).
 * 4. Preparação para o bot "dançar conforme a música" (reconhecimento do local do lead e adaptação linguística).
 */

// Tabela de Códigos Telefônicos Internacionais (DDI), Países, Bandeiras, Idiomas e Moedas
const COUNTRY_DIALING_DATA = [
  // América do Norte
  { ddi: '1', code: 'US', name: 'Estados Unidos', flag: '🇺🇸', lang: 'en', currency: 'USD', nationalLengths: [10] },
  { ddi: '1', code: 'CA', name: 'Canadá', flag: '🇨🇦', lang: 'en', currency: 'CAD', nationalLengths: [10] },

  // América do Sul
  { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalLengths: [10, 11] },
  { ddi: '54', code: 'AR', name: 'Argentina', flag: '🇦🇷', lang: 'es', currency: 'ARS', nationalLengths: [10, 11] },
  { ddi: '56', code: 'CL', name: 'Chile', flag: '🇨🇱', lang: 'es', currency: 'CLP', nationalLengths: [9] },
  { ddi: '57', code: 'CO', name: 'Colômbia', flag: '🇨🇴', lang: 'es', currency: 'COP', nationalLengths: [10] },
  { ddi: '58', code: 'VE', name: 'Venezuela', flag: '🇻🇪', lang: 'es', currency: 'VES', nationalLengths: [10] },
  { ddi: '51', code: 'PE', name: 'Peru', flag: '🇵🇪', lang: 'es', currency: 'PEN', nationalLengths: [9] },
  { ddi: '591', code: 'BO', name: 'Bolívia', flag: '🇧🇴', lang: 'es', currency: 'BOB', nationalLengths: [8] },
  { ddi: '593', code: 'EC', name: 'Equador', flag: '🇪🇨', lang: 'es', currency: 'USD', nationalLengths: [9] },
  { ddi: '595', code: 'PY', name: 'Paraguai', flag: '🇵🇾', lang: 'es', currency: 'PYG', nationalLengths: [9] },
  { ddi: '598', code: 'UY', name: 'Uruguai', flag: '🇺🇾', lang: 'es', currency: 'UYU', nationalLengths: [8] },

  // América Central & Caribe
  { ddi: '52', code: 'MX', name: 'México', flag: '🇲🇽', lang: 'es', currency: 'MXN', nationalLengths: [10] },
  { ddi: '502', code: 'GT', name: 'Guatemala', flag: '🇬🇹', lang: 'es', currency: 'GTQ', nationalLengths: [8] },
  { ddi: '503', code: 'SV', name: 'El Salvador', flag: '🇸🇻', lang: 'es', currency: 'USD', nationalLengths: [8] },
  { ddi: '504', code: 'HN', name: 'Honduras', flag: '🇭🇳', lang: 'es', currency: 'HNL', nationalLengths: [8] },
  { ddi: '505', code: 'NI', name: 'Nicarágua', flag: '🇳🇮', lang: 'es', currency: 'NIO', nationalLengths: [8] },
  { ddi: '506', code: 'CR', name: 'Costa Rica', flag: '🇨🇷', lang: 'es', currency: 'CRC', nationalLengths: [8] },
  { ddi: '507', code: 'PA', name: 'Panamá', flag: '🇵🇦', lang: 'es', currency: 'USD', nationalLengths: [8] },
  { ddi: '53', code: 'CU', name: 'Cuba', flag: '🇨🇺', lang: 'es', currency: 'CUP', nationalLengths: [8] },
  { ddi: '509', code: 'HT', name: 'Haiti', flag: '🇭🇹', lang: 'fr', currency: 'HTG', nationalLengths: [8] },

  // Europa
  { ddi: '351', code: 'PT', name: 'Portugal', flag: '🇵🇹', lang: 'pt', currency: 'EUR', nationalLengths: [9] },
  { ddi: '34', code: 'ES', name: 'Espanha', flag: '🇪🇸', lang: 'es', currency: 'EUR', nationalLengths: [9] },
  { ddi: '44', code: 'GB', name: 'Reino Unido', flag: '🇬🇧', lang: 'en', currency: 'GBP', nationalLengths: [10] },
  { ddi: '33', code: 'FR', name: 'França', flag: '🇫🇷', lang: 'fr', currency: 'EUR', nationalLengths: [9] },
  { ddi: '49', code: 'DE', name: 'Alemanha', flag: '🇩🇪', lang: 'de', currency: 'EUR', nationalLengths: [10, 11] },
  { ddi: '39', code: 'IT', name: 'Itália', flag: '🇮🇹', lang: 'it', currency: 'EUR', nationalLengths: [9, 10] },
  { ddi: '31', code: 'NL', name: 'Holanda', flag: '🇳🇱', lang: 'nl', currency: 'EUR', nationalLengths: [9] },
  { ddi: '32', code: 'BE', name: 'Bélgica', flag: '🇧🇪', lang: 'nl', currency: 'EUR', nationalLengths: [9] },
  { ddi: '41', code: 'CH', name: 'Suíça', flag: '🇨🇭', lang: 'de', currency: 'CHF', nationalLengths: [9] },
  { ddi: '43', code: 'AT', name: 'Áustria', flag: '🇦🇹', lang: 'de', currency: 'EUR', nationalLengths: [10, 11] },
  { ddi: '46', code: 'SE', name: 'Suécia', flag: '🇸🇪', lang: 'sv', currency: 'SEK', nationalLengths: [9] },
  { ddi: '47', code: 'NO', name: 'Noruega', flag: '🇳🇴', lang: 'no', currency: 'NOK', nationalLengths: [8] },
  { ddi: '45', code: 'DK', name: 'Dinamarca', flag: '🇩🇰', lang: 'da', currency: 'DKK', nationalLengths: [8] },
  { ddi: '353', code: 'IE', name: 'Irlanda', flag: '🇮🇪', lang: 'en', currency: 'EUR', nationalLengths: [9] },
  { ddi: '48', code: 'PL', name: 'Polônia', flag: '🇵🇱', lang: 'pl', currency: 'PLN', nationalLengths: [9] },
  { ddi: '7', code: 'RU', name: 'Rússia', flag: '🇷🇺', lang: 'ru', currency: 'RUB', nationalLengths: [10] },

  // África Lusófona & Geral
  { ddi: '244', code: 'AO', name: 'Angola', flag: '🇦🇴', lang: 'pt', currency: 'AOA', nationalLengths: [9] },
  { ddi: '258', code: 'MZ', name: 'Moçambique', flag: '🇲🇿', lang: 'pt', currency: 'MZN', nationalLengths: [9] },
  { ddi: '238', code: 'CV', name: 'Cabo Verde', flag: '🇨🇻', lang: 'pt', currency: 'CVE', nationalLengths: [7] },
  { ddi: '239', code: 'ST', name: 'São Tomé e Príncipe', flag: '🇸🇹', lang: 'pt', currency: 'STN', nationalLengths: [7] },
  { ddi: '245', code: 'GW', name: 'Guiné-Bissau', flag: '🇬🇼', lang: 'pt', currency: 'XOF', nationalLengths: [7] },
  { ddi: '27', code: 'ZA', name: 'África do Sul', flag: '🇿🇦', lang: 'en', currency: 'ZAR', nationalLengths: [9] },

  // Ásia & Oceania
  { ddi: '81', code: 'JP', name: 'Japão', flag: '🇯🇵', lang: 'ja', currency: 'JPY', nationalLengths: [10] },
  { ddi: '82', code: 'KR', name: 'Coreia do Sul', flag: '🇰🇷', lang: 'ko', currency: 'KRW', nationalLengths: [9, 10] },
  { ddi: '86', code: 'CN', name: 'China', flag: '🇨🇳', lang: 'zh', currency: 'CNY', nationalLengths: [11] },
  { ddi: '91', code: 'IN', name: 'Índia', flag: '🇮🇳', lang: 'hi', currency: 'INR', nationalLengths: [10] },
  { ddi: '61', code: 'AU', name: 'Austrália', flag: '🇦🇺', lang: 'en', currency: 'AUD', nationalLengths: [9] },
  { ddi: '64', code: 'NZ', name: 'Nova Zelândia', flag: '🇳🇿', lang: 'en', currency: 'NZD', nationalLengths: [8, 9] },
  { ddi: '971', code: 'AE', name: 'Emirados Árabes', flag: '🇦🇪', lang: 'ar', currency: 'AED', nationalLengths: [9] },
  { ddi: '966', code: 'SA', name: 'Arábia Saudita', flag: '🇸🇦', lang: 'ar', currency: 'SAR', nationalLengths: [9] },
  { ddi: '972', code: 'IL', name: 'Israel', flag: '🇮🇱', lang: 'he', currency: 'ILS', nationalLengths: [9] }
];

// Lista oficial dos 67 Códigos de DDD válidos no Brasil (ANATEL)
const VALID_BRAZILIAN_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19', // SP
  '21', '22', '24', // RJ
  '27', '28', // ES
  '31', '32', '33', '34', '35', '37', '38', // MG
  '41', '42', '43', '44', '45', '46', // PR
  '47', '48', '49', // SC
  '51', '53', '54', '55', // RS
  '61', // DF
  '62', '64', // GO
  '63', // TO
  '65', '66', // MT
  '67', // MS
  '68', // AC
  '69', // RO
  '71', '73', '74', '75', '77', // BA
  '79', // SE
  '81', '87', // PE
  '82', // AL
  '83', // PB
  '84', // RN
  '85', '88', // CE
  '86', '89', // PI
  '91', '93', '94', // PA
  '92', '97', // AM
  '95', // RR
  '96', // AP
  '98', '99'  // MA
]);

/**
 * Remove qualquer formatação, símbolos, sufixos de JID (@s.whatsapp.net, @c.us, :device)
 */
function cleanPhoneDigits(raw) {
  if (!raw) return '';
  const noJid = String(raw).split('@')[0].split(':')[0].trim();
  return noJid.replace(/\D/g, '');
}

/**
 * Detecta se o input continha indicativo explícito de internacionalização (+ ou 00)
 */
function hasExplicitInternationalPrefix(raw) {
  if (!raw) return false;
  const str = String(raw).trim();
  return str.startsWith('+') || str.startsWith('00') || /^\+/.test(str);
}

/**
 * Identifica dados de país a partir de uma sequência de dígitos em formato internacional E.164.
 * Testa DDIs de 3 dígitos, depois 2, depois 1.
 */
function matchCountryByDigits(digits) {
  if (!digits || digits.length < 6) return null;

  // 1. Tenta correspondência com DDI de 3 dígitos (ex: 351, 591, 595, 598, etc.)
  if (digits.length >= 3) {
    const ddi3 = digits.slice(0, 3);
    const match3 = COUNTRY_DIALING_DATA.find(c => c.ddi === ddi3);
    if (match3) return { ...match3, nationalNumber: digits.slice(3) };
  }

  // 2. Tenta correspondência com DDI de 2 dígitos (ex: 55, 34, 44, 49, 33, 54, 56, etc.)
  if (digits.length >= 2) {
    const ddi2 = digits.slice(0, 2);
    const match2 = COUNTRY_DIALING_DATA.find(c => c.ddi === ddi2);
    if (match2) return { ...match2, nationalNumber: digits.slice(2) };
  }

  // 3. Tenta correspondência com DDI de 1 dígito (ex: 1 = US/CA, 7 = RU)
  const ddi1 = digits.slice(0, 1);
  const match1 = COUNTRY_DIALING_DATA.find(c => c.ddi === ddi1);
  if (match1) return { ...match1, nationalNumber: digits.slice(1) };

  return null;
}

/**
 * Verifica se um número de 10 ou 11 dígitos possui formato genuinamente brasileiro.
 * Regras da ANATEL:
 * - 11 dígitos: DDD válido + primeiro dígito '9' (celular brasileiro)
 * - 10 dígitos: DDD válido + primeiro dígito entre 2 e 8 (fixo brasileiro)
 */
function isStrictlyBrazilianNationalNumber(digits) {
  if (!digits) return false;
  if (digits.length !== 10 && digits.length !== 11) return false;

  const ddd = digits.slice(0, 2);
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return false;

  const firstLocalDigit = digits[2];
  if (digits.length === 11) {
    // Celular no Brasil obrigatoriamente começa com 9
    return firstLocalDigit === '9';
  } else if (digits.length === 10) {
    // Fixo no Brasil começa com 2, 3, 4 ou 5
    // Ou celular antigo sem o nono dígito (7, 8, 9)
    return ['2', '3', '4', '5', '7', '8', '9'].includes(firstLocalDigit);
  }
  return false;
}

/**
 * Normaliza número de telefone celular brasileiro garantindo o 9º dígito
 */
function normalizeBrazilianMobile(digits) {
  // Se já tem 55 na frente
  if (digits.startsWith('55')) {
    if (digits.length === 13) return digits; // 55 + 2 DDD + 9 dígitos = Perfeito
    if (digits.length === 12) {
      // 55 + 2 DDD + 8 dígitos -> insere 9 se for celular
      const ddd = digits.slice(2, 4);
      const firstNum = digits[4];
      if (['6', '7', '8', '9'].includes(firstNum)) {
        return `55${ddd}9${digits.slice(4)}`;
      }
      return digits; // Fixo
    }
  }

  // Se não tem 55 mas é BR legítimo
  if (digits.length === 11 && digits[2] === '9') {
    return '55' + digits;
  }
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const firstNum = digits[2];
    if (['6', '7', '8', '9'].includes(firstNum)) {
      return `55${ddd}9${digits.slice(2)}`;
    }
    return '55' + digits;
  }

  return digits;
}

/**
 * PARSER UNIVERSAL DE TELEFONE (ITU E.164)
 *
 * Converte qualquer entrada do usuário em um número internacional canônico e seguro,
 * extraindo metadados de país sem NUNCA forçar +55 em números estrangeiros.
 *
 * @param {string} rawInput - Texto bruto (ex: '+1 202 555 0199', '12025550199', '351912345678', '48984702848', '5511999998888')
 * @param {string|null} fallbackSenderPhone - Telefone de quem enviou o comando (caso o input seja vazio)
 * @returns {object} Informações canônicas do telefone
 */
function parseAndNormalizePhone(rawInput, fallbackSenderPhone = null) {
  let raw = String(rawInput || '').trim();

  // Se o input principal for vazio e houver fallback do remetente
  if (!raw && fallbackSenderPhone) {
    raw = String(fallbackSenderPhone).trim();
  }

  const hadExplicitPlus = hasExplicitInternationalPrefix(raw);
  let digits = cleanPhoneDigits(raw);

  // Se começou com 00 (ex: 001202..., 00351...), remove o prefixo de discagem internacional 00
  if (digits.startsWith('00') && digits.length > 8) {
    digits = digits.slice(2);
  }

  if (!digits || digits.length < 7) {
    return {
      isValid: false,
      phone: digits,
      countryCode: null,
      countryDDI: null,
      countryName: null,
      flag: '🌐',
      lang: 'pt',
      currency: 'BRL',
      isForeign: false,
      formatted: raw || '',
      error: 'Número de telefone inválido ou muito curto'
    };
  }

  let finalDigits = digits;
  let detected = null;

  // CASO 1: O usuário inseriu explicitamente com '+' (ex: +1 202..., +351..., +34..., +55...)
  if (hadExplicitPlus) {
    detected = matchCountryByDigits(digits);
    if (detected && detected.code === 'BR') {
      finalDigits = normalizeBrazilianMobile(digits);
    } else {
      finalDigits = digits; // Mantém número internacional exato
    }
  }
  // CASO 2: Começa com 55 e tem tamanho de número brasileiro (12 ou 13 dígitos)
  else if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    finalDigits = normalizeBrazilianMobile(digits);
    detected = { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalNumber: finalDigits.slice(2) };
  }
  // CASO 3: Começa com 1 e tem 11 dígitos (Padrão América do Norte: EUA/Canadá: 1 + 10 dígitos)
  else if (digits.startsWith('1') && digits.length === 11) {
    // No Brasil, nenhum DDD começa com '1' seguido de '0' ou '1', e DDDs 11-19 têm formato 119...
    // Se o 3º dígito for 0 ou 1, é 100% US/CA (ex: 1 202..., 1 415...)
    // Se o 2º dígito não formar um DDD BR com 9º dígito, é US/CA
    const dddCandidate = digits.slice(0, 2);
    const thirdDigit = digits[2];
    const isBrLike = VALID_BRAZILIAN_DDDS.has(dddCandidate) && thirdDigit === '9';

    if (!isBrLike) {
      finalDigits = digits; // É EUA / Canadá
      detected = { ddi: '1', code: 'US', name: 'Estados Unidos', flag: '🇺🇸', lang: 'en', currency: 'USD', nationalNumber: digits.slice(1) };
    } else {
      // Caso raro de colisão: ex: 11988887777 sem 55
      finalDigits = '55' + digits;
      detected = { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalNumber: digits };
    }
  }
  // CASO 4: É estritamente um número nacional brasileiro sem DDI (10 ou 11 dígitos com DDD válido e celular 9)
  else if (isStrictlyBrazilianNationalNumber(digits)) {
    finalDigits = normalizeBrazilianMobile(digits);
    detected = { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalNumber: digits };
  }
  // CASO 5: Tenta casamento direto com tabela de DDIs internacionais
  else {
    const match = matchCountryByDigits(digits);
    if (match) {
      detected = match;
      finalDigits = digits;
    } else {
      // Se não casou com nenhum país e tem 10-11 dígitos, verifica fallback prudente
      if (digits.length === 10 || digits.length === 11) {
        const ddd = digits.slice(0, 2);
        if (VALID_BRAZILIAN_DDDS.has(ddd)) {
          finalDigits = normalizeBrazilianMobile(digits);
          detected = { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalNumber: digits };
        } else {
          // Não é DDD brasileiro! Mantém o número do usuário como está!
          finalDigits = digits;
        }
      } else {
        finalDigits = digits;
      }
    }
  }

  // Se ainda não detectou, assume padrão internacional genérico ou padrão local
  if (!detected) {
    if (finalDigits.startsWith('55')) {
      detected = { ddi: '55', code: 'BR', name: 'Brasil', flag: '🇧🇷', lang: 'pt', currency: 'BRL', nationalNumber: finalDigits.slice(2) };
    } else {
      detected = { ddi: null, code: 'INTL', name: 'Internacional', flag: '🌐', lang: 'en', currency: 'USD', nationalNumber: finalDigits };
    }
  }

  const isForeign = detected.code !== 'BR';

  // Formatação legível
  let formatted = `+${finalDigits}`;
  if (detected.code === 'BR') {
    const ddd = finalDigits.slice(2, 4);
    const num = finalDigits.slice(4);
    if (num.length === 9) {
      formatted = `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    } else if (num.length === 8) {
      formatted = `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
    }
  } else if (detected.code === 'US' || detected.code === 'CA') {
    const area = finalDigits.slice(1, 4);
    const mid = finalDigits.slice(4, 7);
    const last = finalDigits.slice(7);
    formatted = `+1 (${area}) ${mid}-${last}`;
  } else if (detected.ddi) {
    const ddiLen = detected.ddi.length;
    formatted = `+${detected.ddi} ${finalDigits.slice(ddiLen)}`;
  }

  return {
    isValid: finalDigits.length >= 8 && finalDigits.length <= 15,
    phone: finalDigits,
    countryCode: detected.code,
    countryDDI: detected.ddi,
    countryName: detected.name,
    flag: detected.flag,
    lang: detected.lang || 'pt',
    currency: detected.currency || 'USD',
    isForeign,
    formatted,
    nationalNumber: detected.nationalNumber || finalDigits
  };
}

/**
 * Saudação inteligente e adaptativa para o bot "dançar conforme a música"
 */
function getLocalizedGreeting(phoneInfo) {
  const lang = phoneInfo?.lang || 'pt';
  const flag = phoneInfo?.flag || '🌐';

  switch (lang) {
    case 'en':
      return {
        greeting: 'Hello! Welcome to our automated assistant.',
        helpPrompt: 'How can I assist you today?',
        flag
      };
    case 'es':
      return {
        greeting: '¡Hola! Bienvenido a nuestro asistente automatizado.',
        helpPrompt: '¿Cómo puedo ayudarte hoy?',
        flag
      };
    case 'fr':
      return {
        greeting: 'Bonjour! Bienvenue sur notre assistant automatisé.',
        helpPrompt: 'Comment puis-je vous aider aujourd\'hui?',
        flag
      };
    case 'de':
      return {
        greeting: 'Hallo! Willkommen bei unserem automatisierten Assistenten.',
        helpPrompt: 'Wie kann ich Ihnen heute helfen?',
        flag
      };
    case 'it':
      return {
        greeting: 'Ciao! Benvenuto nel nostro assistente automatizzato.',
        helpPrompt: 'Come posso aiutarti oggi?',
        flag
      };
    case 'pt':
    default:
      return {
        greeting: 'Olá! Seja muito bem-vindo ao nosso assistente automatizado.',
        helpPrompt: 'Como posso te ajudar hoje?',
        flag
      };
  }
}

module.exports = {
  COUNTRY_DIALING_DATA,
  VALID_BRAZILIAN_DDDS,
  cleanPhoneDigits,
  hasExplicitInternationalPrefix,
  matchCountryByDigits,
  isStrictlyBrazilianNationalNumber,
  normalizeBrazilianMobile,
  parseAndNormalizePhone,
  getLocalizedGreeting
};

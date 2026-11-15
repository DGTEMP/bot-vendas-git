/**
 * Utilitário de Formatação e Sanitização de Mensagens para WhatsApp
 *
 * WhatsApp Markdown Rules:
 * • Negrito: *texto* (não aceita espaço entre o asterisco e o texto: * texto* falha)
 * • Itálico: _texto_ (não aceita espaço entre o underscore e o texto: _ texto_ falha)
 * • Tachado: ~texto~
 * • Monoespaçado: ```texto```
 *
 * URLs com underscores (sub_id, aff_id, utm_source) NÃO podem ser interpretadas como itálico.
 * Caracteres órfãos/não balanceados (*) ou (_) quebram o layout do anúncio.
 */

/**
 * Higieniza um campo dinâmico (título, nome de produto) antes de colocá-lo em negrito *...*
 * Remove asteriscos internos para não fechar ou quebrar o negrito prematuramente.
 */
function sanitizeFieldForBold(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*+/g, '') // remove asteriscos internos
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Higieniza um campo dinâmico (pitch copy, descrição) antes de colocá-lo em itálico _..._
 * Remove underscores internos para não quebrar o itálico.
 */
function sanitizeFieldForItalic(text) {
  if (!text) return '';
  return String(text)
    .replace(/_+/g, ' ') // substitui underscores internos por espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Higieniza um campo dinâmico antes de colocá-lo em tachado ~...~
 */
function sanitizeFieldForStrikethrough(text) {
  if (!text) return '';
  return String(text)
    .replace(/~+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Higienização e balanceamento completo de mensagens para WhatsApp
 * Protege links, corrige espaços inválidos, remove tags órfãs e formatações duplicadas.
 */
function sanitizeWhatsAppMessage(message) {
  if (!message || typeof message !== 'string') return '';

  // 1. Isola URLs para proteger underscores e parâmetros de query (sub_id, aff_id, etc)
  // Usamos delimitadores seguros que não contêm underscores ou asteriscos
  const urls = [];
  let masked = message.replace(/(https?:\/\/[^\s]+)/gi, (match) => {
    let cleanUrl = match;
    let trailing = '';
    // Se a URL estiver colada em pontuação ou caracteres de formatação no final
    while (cleanUrl.endsWith('*') || cleanUrl.endsWith('_') || cleanUrl.endsWith('~')) {
      trailing = cleanUrl.slice(-1) + trailing;
      cleanUrl = cleanUrl.slice(0, -1);
    }
    const idx = urls.length;
    urls.push(cleanUrl);
    return `§§URLTOKEN${idx}§§${trailing}`;
  });

  // 2. Isola underscores intra-palavras (ex: Smartwatch_Ultra, produto_top, var_1)
  // No WhatsApp, underscores dentro de palavras não acionam itálico e não podem ser contados no balanceamento
  masked = masked.replace(/(?<=[a-zA-Z0-9À-ÿ])_(?=[a-zA-Z0-9À-ÿ])/g, '§§INTUND§§');
  // Isola asteriscos aritméticos entre números (ex: 2*3 = 6)
  masked = masked.replace(/(?<=[0-9])\*(?=[0-9])/g, '§§INTAST§§');

  // 3. Remove formatações duplicadas estilo Discord/Slack que o WhatsApp não suporta (ex: **negrito** -> *negrito*)
  masked = masked.replace(/\*{2,}/g, '*');
  masked = masked.replace(/_{2,}/g, '_');
  masked = masked.replace(/~{2,}/g, '~');

  // 4. Corrige espaços inválidos no início e fim de marcadores
  // * texto * -> *texto*, * texto* -> *texto*, *texto * -> *texto*
  masked = masked.replace(/\*([^*\n]+?)\*/g, (m, inner) => inner.trim() ? `*${inner.trim()}*` : m);
  masked = masked.replace(/_([^_\n]+?)_/g, (m, inner) => inner.trim() ? `_${inner.trim()}_` : m);
  masked = masked.replace(/~([^~\n]+?)~/g, (m, inner) => inner.trim() ? `~${inner.trim()}~` : m);

  // 5. Balanceamento de Asteriscos (*)
  // Se houver um número ímpar de asteriscos, remove o asterisco órfão
  const asteriskMatches = masked.match(/\*/g);
  if (asteriskMatches && asteriskMatches.length % 2 !== 0) {
    const lastIdx = masked.lastIndexOf('*');
    masked = masked.substring(0, lastIdx) + masked.substring(lastIdx + 1);
  }

  // 6. Balanceamento de Underscores (_)
  const underscoreMatches = masked.match(/_/g);
  if (underscoreMatches && underscoreMatches.length % 2 !== 0) {
    const lastIdx = masked.lastIndexOf('_');
    masked = masked.substring(0, lastIdx) + masked.substring(lastIdx + 1);
  }

  // 7. Balanceamento de Tildes (~)
  const tildeMatches = masked.match(/~/g);
  if (tildeMatches && tildeMatches.length % 2 !== 0) {
    const lastIdx = masked.lastIndexOf('~');
    masked = masked.substring(0, lastIdx) + masked.substring(lastIdx + 1);
  }

  // 8. Restaura underscores intra-palavras e asteriscos aritméticos
  masked = masked.replace(/§§INTUND§§/g, '_');
  masked = masked.replace(/§§INTAST§§/g, '*');

  // 9. Restaura URLs isoladas garantindo que fiquem livres de marcadores colados
  masked = masked.replace(/§§URLTOKEN(\d+)§§/g, (_, idx) => {
    return urls[Number(idx)] || '';
  });

  return masked;
}

module.exports = {
  sanitizeFieldForBold,
  sanitizeFieldForItalic,
  sanitizeFieldForStrikethrough,
  sanitizeWhatsAppMessage
};

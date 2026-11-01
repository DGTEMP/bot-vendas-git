/**
 * Utilitário de Estilos e Fontes Decorativas Unicode (Fazer Nick / Tabela)
 * Portado e aprimorado a partir do SpyBot (Aleatory-MD)
 */

const CHAR_MAPS = {
  // Gótico Fraktur: 𝔄𝔅ℭ... 𝔞𝔟𝔠...
  gotico: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ0123456789'
  },
  // Gótico Negrito: 𝖆𝖇𝖈... 𝕬𝕭𝕮...
  goticoNegrito: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅0123456789'
  },
  // Negrito Sem Serifa: 𝗮𝗯𝗰... 𝗔𝗕𝗖...
  negrito: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵'
  },
  // Negrito Serifado: 𝐚𝐛𝐜... 𝐀𝐁𝐂...
  negritoSerifa: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗'
  },
  // Itálico Sem Serifa: 𝘢𝘣𝘤... 𝘈𝘉𝘊...
  italico: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡0123456789'
  },
  // Monospace / Código: 𝚊𝚋𝚌... 𝙰𝙱𝙲...
  monospace: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿'
  },
  // Circundado / Bolhas: ⓐⓑⓒ... ⒶⒷⒸ...
  circundado: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: 'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ⓪①②③④⑤⑥⑦⑧⑨'
  },
  // Quadrado / Caixa: 🄰🄱🄲...
  quadrado: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉0123456789'
  },
  // Quadrado Preenchido / Negativo: 🅰🅱🅲...
  quadradoPreto: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉0123456789'
  },
  // Script / Cursiva: 𝒶𝒷𝒸...
  script: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵0123456789'
  },
  // Script Negrito: 𝓪𝓫𝓬...
  scriptNegrito: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: '𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩0123456789'
  },
  // Sobrescrito: ᵃᵇᶜ...
  sobrescrito: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᵠʳˢᵗᵘᵛʷˣʸᶻᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᵠᴿˢᵀᵁⱽᵂˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹'
  },
  // Largura Total / Vaporwave: ａｂｃ...
  larguraTotal: {
    orig: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    dest: 'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９'
  }
};

function transformText(text, styleKey) {
  const map = CHAR_MAPS[styleKey];
  if (!map) return text;
  
  // Como caracteres Unicode usam surrogate pairs, separamos com Array.from
  const destChars = Array.from(map.dest);
  const origChars = Array.from(map.orig);
  const lookup = new Map();
  for (let i = 0; i < origChars.length; i++) {
    lookup.set(origChars[i], destChars[i] || origChars[i]);
  }

  return Array.from(text).map(c => lookup.get(c) || c).join('');
}

function strikeText(text) {
  return Array.from(text).map(c => c + '\u0336').join('');
}

function underlineText(text) {
  return Array.from(text).map(c => c + '\u0333').join('');
}

function invertText(text) {
  const normal = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?,._!&";
  const inverted = "ɐqɔpǝɟɓɥıɾʞןɯuodbɹsʇnʌʍxʎzⱯᗺƆᗡƎℲ⅁HIſʞꞀWNOԀÒᴚS⊥∩ΛMX⅄Z0⇂ᘔƐᔭ59ㄥ86¿'˙‾¡⅋";
  const rev = Array.from(text).reverse();
  return rev.map(c => {
    const idx = normal.indexOf(c);
    return idx !== -1 ? inverted[idx] : c;
  }).join('');
}

function generateAllStyles(inputText) {
  const text = (inputText || 'PayBot').trim();
  const styles = [
    { name: '1. Gótico Fraktur', value: transformText(text, 'gotico') },
    { name: '2. Gótico Negrito', value: transformText(text, 'goticoNegrito') },
    { name: '3. Negrito Sem Serifa', value: transformText(text, 'negrito') },
    { name: '4. Negrito Serifado', value: transformText(text, 'negritoSerifa') },
    { name: '5. Itálico Elegante', value: transformText(text, 'italico') },
    { name: '6. Monospace (Código)', value: transformText(text, 'monospace') },
    { name: '7. Circundado (Bolhas)', value: transformText(text, 'circundado') },
    { name: '8. Caixas Quadradas', value: transformText(text, 'quadrado') },
    { name: '9. Quadrado Preenchido', value: transformText(text, 'quadradoPreto') },
    { name: '10. Cursiva Script', value: transformText(text, 'script') },
    { name: '11. Script Negrito', value: transformText(text, 'scriptNegrito') },
    { name: '12. Sobrescrito', value: transformText(text, 'sobrescrito') },
    { name: '13. Vaporwave / Estendido', value: transformText(text, 'larguraTotal') },
    { name: '14. Tachado / Riscado', value: strikeText(text) },
    { name: '15. Sublinhado Duplo', value: underlineText(text) },
    { name: '16. Invertido / De Cabeça Baixo', value: invertText(text) },
    { name: '17. Nick Decorado Asas', value: `꧁༺ ${transformText(text, 'scriptNegrito')} ༻꧂` },
    { name: '18. Nick Decorado Espadas', value: `乂 ${transformText(text, 'negrito')} 乂` },
    { name: '19. Nick Decorado Estrelas', value: `★彡[ ${transformText(text, 'goticoNegrito')} ]彡★` },
    { name: '20. Nick Decorado Fogo', value: `⚡ 『${transformText(text, 'negrito')}』 ⚡` }
  ];

  return styles;
}

module.exports = {
  CHAR_MAPS,
  transformText,
  strikeText,
  underlineText,
  invertText,
  generateAllStyles
};

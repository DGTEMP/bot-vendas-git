const models = require('../db/models');

/**
 * ModeratorService - Motor Inteligente de Moderação Heurística e Crowd-Reporting (Baseado em Advanced WhatsApp Moderator)
 *
 * Características:
 * 1. Normalização profunda: dobra fontes estilizadas unicode (NFKC), decompõe acentos (NFD),
 *    remove ZWSP/invisíveis, desfaz homoglifos (cirílico/grego), resolve leetspeak, quebra evasão por pontos/traços.
 * 2. Dampeners: previne falsos positivos quando um membro está reportando ou citando golpistas.
 * 3. Crowd-Reporting: comando !report / !spam / /report ao responder mensagens suspeitas.
 * 4. Modos Sombra (Shadow - apenas audita) e Ativo (Enforce - deleta e adverte).
 */

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFE00-\uFE0F\u180E]/g;
const COMBINING = /[\u0300-\u036F\u0483-\u0489\u1ABE-\u1AFF\u20D0-\u20FF]/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|xyz|shop|store|link|app|gg|ly|top|club)\b/gi;

/** Homoglifos Cirílicos e Gregos frequentemente usados para burlar filtros regex */
const HOMOGLYPHS = {
  'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'ѕ': 's', 'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm',
  'н': 'h', 'о': 'o', 'р': 'p', 'т': 't', 'у': 'y', 'х': 'x', 'ԁ': 'd', 'ɡ': 'g', 'ⅼ': 'l',
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u',
  'ν': 'v', 'χ': 'x', '×': 'x', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
};

/** Leetspeak aplicado em contexto de palavras */
const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l'
};

/**
 * Dampeners: frases indicando que o usuário está denunciando, citando ou avisando sobre um golpe.
 * Quando um dampener é acionado, a pontuação é limitada a 0.55 (abaixo do teto de exclusão automática).
 */
const DAMPENERS = [
  { name: 'reporting-spam', re: /\b(?:por\s*favor\s*)?(?:ban|expulsa|tira|deleta|bane|denuncia(?:r|do)?|bloqueia|remove|kick)\s+(?:ele|esse|este|essa|esse cara|usuario|membro|them|him|her|this guy|user)\b/i },
  { name: 'warning-others', re: /\b(?:cuidado|alerta|golpe|nao caiam|fiquem espertos|atencao|beware|watch out|warning|be careful|don'?t fall for|avoid)\b/i },
  { name: 'third-party-report', re: /\b(?:alguem|alguém|um cara|esse cara|golpista|scammer|they|someone)\s+(?:me\s+)?(?:chamou|mandou|abordou|dm(?:ed|'d)?|messaged|sent)\s*(?:no\s*)?(?:pv|direct|privado|me)\b/i },
  { name: 'quoting', re: /\b(?:ele disse|ela disse|olha o que mandou|mandou assim|they said|he said|quote|screenshot)\b/i },
  { name: 'is-this-a-scam', re: /\b(?:e golpe|é golpe|e confiavel|é confiavel|isso e verdade|is (?:this|that) a scam)\b|\bgolpe\?|\bscam\?/i }
];

const DAMPENED_CEILING = 0.55;

/** Regras Padrão de Classificação Heurística */
const BUILTIN_RULES = [
  // --- SPAM DE MERCADO & ATRAÇÃO PARA PV / DM ---
  { name: 'chama-no-pv', category: 'marketplace_spam', pattern: '\\b(?:chama|chame|chamar|fala|vem|mandar?)\\s*(?:no\\s*)?(?:pv|privado|direct|inbox|dm|zap|whatsapp)\\b', flags: 'i', weight: 0.65 },
  { name: 'serious-buyers-only', category: 'marketplace_spam', pattern: '\\b(?:serious|apenas|so|somente)\\s*(?:buyers?|interessados?|compradores?)\\s*(?:only|no pv)?\\b', flags: 'i', weight: 0.70 },
  { name: 'comprovantes-pv', category: 'marketplace_spam', pattern: '\\b(?:comprovantes?|provas?|vouches?|depoimentos?)\\s*(?:no\\s*)?(?:pv|direct|privado|inbox)\\b', flags: 'i', weight: 0.75 },
  { name: 'confiavel-claim', category: 'marketplace_spam', pattern: '\\b(?:100%|totalmente|sempre)\\s*(?:confiavel|confiável|seguro|legit|sem golpe)\\b|\\bsem perigo de golpe\\b', flags: 'i', weight: 0.60 },
  { name: 'preco-negociavel', category: 'marketplace_spam', pattern: '\\b(?:preco|preço|valor)\\s*(?:negociavel|negociável|baixo|barato)\\b|\\bchama com proposta\\b', flags: 'i', weight: 0.40 },

  // --- GOLPES FINANCEIROS, CRIPTO & PIRÂMIDES ---
  { name: 'lucro-garantido', category: 'crypto_investment', pattern: '\\b(?:lucro|renda|retorno|ganho|rendimento)\\s*(?:garantido|certo|sem risco|100% seguro)\\b', flags: 'i', weight: 0.85 },
  { name: 'multiplicador-pix', category: 'crypto_investment', pattern: '\\b(?:multiplique|dobre|triplique|multiplicador)\\s*(?:seu\\s*)?(?:pix|saldo|investimento|capital|dinheiro)\\b|\\brobo do pix\\b|\\burubu do pix\\b', flags: 'i', weight: 0.90 },
  { name: 'sinais-vip-scam', category: 'crypto_investment', pattern: '\\b(?:sala|grupo|canal)\\s*(?:de\\s*)?(?:sinais|alavancagem|iq option|blaze|mines)\\b.{0,30}\\b(?:gratis|gratuito|vip|assertividade)\\b', flags: 'i', weight: 0.70 },
  { name: 'recuperacao-fundos', category: 'crypto_investment', pattern: '\\b(?:recupere|recupero|resgato|reclaim)\\b.{0,30}\\b(?:dinheiro|fundos|saldo|cripto|bitcoin|pix)\\b.{0,20}\\b(?:perdido|golpe|roubado|preso)\\b', flags: 'i', weight: 0.85 },

  // --- GOLPES DE EMPREGO FALSO / RENDA FÁCIL ---
  { name: 'renda-extra-facil', category: 'job_scam', pattern: '\\b(?:renda extra|trabalhe de casa|trabalho em casa|ganhe dinheiro|ganhe renda)\\b.{0,60}\\b(?:assistindo videos|avaliando|curtindo|pesquisas|no celular)\\b|\\b(?:assistindo videos|avaliando|curtindo|no celular)\\b.{0,60}\\b(?:renda extra|ganhe dinheiro)\\b', flags: 'i', weight: 0.80 },
  { name: 'ganho-diario-exagerado', category: 'job_scam', pattern: '\\b(?:ganhe|tire|faca|receba)\\s*(?:de\\s*)?\\d{2,4}(?:\\s*(?:reais|rs|brl|usd|dolares))?\\s*(?:a\\s*\\d{2,4})?\\s*(?:por dia|diarios|diariamente)\\b', flags: 'i', weight: 0.80 },
  { name: 'sem-experiencia-scam', category: 'job_scam', pattern: '\\bsem\\s*(?:experiencia|requisitos?|investimento)\\s*(?:necessari[ao]|precisa|apenas celular)\\b', flags: 'i', weight: 0.50 },

  // --- REVENDA DE CONTAS & SEGUIDORES ---
  { name: 'venda-de-contas', category: 'account_resale', pattern: '\\b(?:vendo|venda de|compro|alugo)\\s*(?:contas?|perfis?|logins?|acessos?)\\s*(?:de\\s*)?(?:instagram|tiktok|netflix|spotify|chatgpt|openai|free fire|discord|telegram)\\b', flags: 'i', weight: 0.85 },
  { name: 'venda-seguidores', category: 'account_resale', pattern: '\\b(?:vendo|compre|aumente|seguidores|curtidas|visualizacoes)\\s*(?:reais|brasileiros|engajamento|no insta|no tiktok)\\b', flags: 'i', weight: 0.80 },
  { name: 'aged-accounts', category: 'account_resale', pattern: '\\b(?:aged|antigas|aquecidas|pva|verificadas)\\s*(?:contas?|perfis?)\\b', flags: 'i', weight: 0.85 },

  // --- DIVULGAÇÃO EM MASSA & ENCURTADORES ---
  { name: 'whatsapp-group-invite', category: 'mass_promo', pattern: 'chat\\.whatsapp\\.com/|t\\.me/|discord\\.gg/', flags: 'i', weight: 0.55 },
  { name: 'url-shorteners', category: 'mass_promo', pattern: '\\b(?:bit\\.ly|tinyurl\\.com|cutt\\.ly|rb\\.gy|shorturl\\.at|is\\.gd|t\\.co)/', flags: 'i', weight: 0.50 },
  { name: 'entre-no-meu-grupo', category: 'mass_promo', pattern: '\\b(?:entre|entra|acesse|clique|participem)\\s*(?:no|do|ao)?\\s*(?:meu|nosso|novo)?\\s*(?:grupo|canal|comunidade|link)\\b', flags: 'i', weight: 0.45 },

  // --- CONTEÚDO ADULTO / SOLICITAÇÃO ---
  { name: 'adult-solicitation', category: 'adult', pattern: '\\b(?:nudes?|onlyfans|privacy|pack de pezinho|camgirl|chamada de video quente|gp no pv)\\b', flags: 'i', weight: 0.85 }
];

class ModeratorService {
  constructor() {
    this._compiledRules = null;
    this._rulesLoadedAt = 0;
  }

  /**
   * Normalização Avançada de Texto
   * Desfaz artifícios usados por spammers para iludir filtros.
   */
  normalize(input) {
    const raw = String(input || '');

    const invisibles = (raw.match(INVISIBLE) || []).length;
    const emojiCount = (raw.match(EMOJI) || []).length;
    const linkCount = (raw.match(LINK) || []).length;

    // NFKC normaliza negritos matemáticos, itálicos, fullwidth, etc.
    const readable = raw.normalize('NFKC').replace(INVISIBLE, '').toLowerCase();

    // Calcula razão de caracteres estilizados / não-ASCII antes de dobrar
    const letters = [...raw.replace(EMOJI, '').replace(INVISIBLE, '')].filter(c => /\p{L}/u.test(c));
    const nonAscii = letters.filter(c => c.charCodeAt(0) > 127).length;
    const stylizedRatio = letters.length ? nonAscii / letters.length : 0;

    const upper = (raw.match(/[A-Z]/g) || []).length;
    const alpha = (raw.match(/[A-Za-z]/g) || []).length;
    const capsRatio = alpha ? upper / alpha : 0;

    let maxRun = 0;
    let run = 1;
    for (let i = 1; i <= raw.length; i++) {
      if (i < raw.length && raw[i] === raw[i - 1]) run++;
      else {
        if (run > maxRun) maxRun = run;
        run = 1;
      }
    }

    // NFD decompõe acentos para remover sinais diacríticos (ex: vídeos -> videos)
    const decomposed = readable.normalize('NFD').replace(COMBINING, '');

    let folded = decomposed
      .split('')
      .map(c => HOMOGLYPHS[c] ?? c)
      .join('')
      // "s.e.r.i.o.u.s" / "s-e-r-i-o-u-s" / "s*e*r*i*o*u*s" -> "serious"
      .replace(/(?<=\p{L})[.\-_*·•~](?=\p{L})/gu, '')
      // Leet folding dentro do contexto da palavra
      .replace(/(?<=\p{L})[0134578@$!|](?=\p{L})/gu, c => LEET[c] ?? c)
      .replace(/^[0134578@$!|](?=\p{L})/u, c => LEET[c] ?? c)
      .replace(EMOJI, ' ')
      // Reduz repetições exageradas: "buyerssss" -> "buyerss"
      .replace(/(.)\1{2,}/g, '$1$1')
      .replace(/\s+/g, ' ')
      .trim();

    // Desfaz letras espaçadas propositais: "s e r i o u s" -> "serious"
    folded = folded.replace(/(?:\b\p{L}\b[ ]){2,}\b\p{L}\b/gu, m => m.replace(/ /g, ''));

    const wordCount = folded ? folded.split(/\s+/).filter(Boolean).length : 0;

    return {
      text: folded,
      readable,
      stats: {
        length: raw.length,
        invisibles,
        stylizedRatio,
        emojiCount,
        emojiRatio: (emojiCount + wordCount) ? emojiCount / (emojiCount + wordCount) : 0,
        capsRatio,
        linkCount,
        maxRunLength: maxRun,
        wordCount
      }
    };
  }

  /**
   * Carrega e compila regras (cache de 10s)
   */
  getRules() {
    const now = Date.now();
    if (this._compiledRules && (now - this._rulesLoadedAt < 10000)) {
      return this._compiledRules;
    }

    let dbRules = [];
    try {
      dbRules = models.getModerationRules();
    } catch (_) {}

    const sourceRules = (dbRules && dbRules.length > 0) ? dbRules : BUILTIN_RULES;
    const compiled = [];

    for (const r of sourceRules) {
      if (r.enabled === 0) continue;
      try {
        compiled.push({
          ...r,
          re: new RegExp(r.pattern, r.flags || 'i')
        });
      } catch (err) {
        console.warn(`[ModeratorService] Erro ao compilar regra "${r.name}":`, err.message);
      }
    }

    this._compiledRules = compiled;
    this._rulesLoadedAt = now;
    return compiled;
  }

  /**
   * Combinação saturante de múltiplos pesos (1 - (1-w1)*(1-w2)...)
   */
  _saturate(weights) {
    return 1 - weights.reduce((acc, w) => acc * (1 - Math.min(Math.max(w, 0), 0.99)), 1);
  }

  /**
   * Avalia texto normalizado contra as heurísticas e regras estruturais
   */
  evaluateRules(n) {
    const hits = [];
    const rules = this.getRules();

    for (const rule of rules) {
      const m = rule.re.exec(n.text);
      rule.re.lastIndex = 0;
      if (m) {
        hits.push({
          name: rule.name,
          category: rule.category,
          weight: rule.weight || 0.5,
          evidence: m[0].slice(0, 100)
        });
      }
    }

    // Heurísticas estruturais de formatação
    const s = n.stats;
    if (s.stylizedRatio > 0.5 && s.length > 12) {
      hits.push({
        name: 'stylized-unicode',
        category: 'formatting_abuse',
        weight: s.stylizedRatio > 0.85 ? 0.75 : 0.50,
        evidence: `${Math.round(s.stylizedRatio * 100)}% de letras estilizadas (evasão)`
      });
    }
    if (s.invisibles >= 3) {
      hits.push({
        name: 'invisible-chars',
        category: 'formatting_abuse',
        weight: 0.65,
        evidence: `${s.invisibles} caracteres invisíveis/bidi injetados`
      });
    }
    if (s.emojiCount >= 8 && s.emojiRatio > 0.4) {
      hits.push({
        name: 'emoji-wall',
        category: 'formatting_abuse',
        weight: 0.45,
        evidence: `Parede de emojis (${s.emojiCount} emojis, ${Math.round(s.emojiRatio * 100)}% da msg)`
      });
    }
    if (s.capsRatio > 0.8 && s.wordCount >= 5) {
      hits.push({
        name: 'all-caps',
        category: 'formatting_abuse',
        weight: 0.30,
        evidence: `${Math.round(s.capsRatio * 100)}% em caixa alta (gritando)`
      });
    }
    if (s.linkCount >= 3) {
      hits.push({
        name: 'link-spray',
        category: 'mass_promo',
        weight: 0.50,
        evidence: `${s.linkCount} links na mesma mensagem`
      });
    }
    if (s.maxRunLength >= 10) {
      hits.push({
        name: 'char-flood',
        category: 'formatting_abuse',
        weight: 0.35,
        evidence: `Inundação de caractere repetido (${s.maxRunLength}x)`
      });
    }

    if (!hits.length) {
      return { score: 0, hits: [], category: null, dampeners: [] };
    }

    // Categoria dominante
    const catWeights = new Map();
    for (const h of hits) {
      catWeights.set(h.category, (catWeights.get(h.category) || 0) + h.weight);
    }
    const dominantCategory = [...catWeights.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Verifica Dampeners no texto
    const dampeners = DAMPENERS.filter(d => d.re.test(n.text) || d.re.test(n.readable)).map(d => d.name);
    const rawScore = this._saturate(hits.map(h => h.weight));

    // Se acionou dampener, limita a pontuação para não banir/deletar injustamente quem reporta
    const score = dampeners.length > 0 ? Math.min(rawScore, DAMPENED_CEILING) : rawScore;

    return {
      score: Number(score.toFixed(3)),
      hits,
      category: dominantCategory,
      dampeners
    };
  }

  /**
   * Avalia uma mensagem completa
   */
  analyze(text) {
    const normalized = this.normalize(text);
    const verdict = this.evaluateRules(normalized);
    return {
      normalized,
      ...verdict
    };
  }

  /**
   * Processa o comando de Crowd-Reporting (!report / !spam / /report / /spam)
   * Qualquer membro do grupo pode denunciar uma mensagem citando-a.
   */
  async handleCrowdReport(sock, msg, from, senderJid, isGroup, isAdmin = false, isOwner = false) {
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `🛡️ *MODERAÇÃO INTELIGENTE SPY*\n\nO comando de denúncia por resposta (*!report* / *!spam*) funciona exclusivamente dentro de grupos.`
      });
    }

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const targetId = contextInfo?.stanzaId;
    const targetParticipant = contextInfo?.participant;
    const quotedMessage = contextInfo?.quotedMessage;

    const reporterPhone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const reporterName = msg.pushName || reporterPhone;

    // Se o usuário não citou nenhuma mensagem
    if (!targetId || !quotedMessage) {
      return sock.sendMessage(from, {
        text: `⚠️ *COMO DENUNCIAR SPAM OU GOLPE:*\n\n` +
          `Para denunciar um conteúdo impróprio ou golpe:\n` +
          `1️⃣ Pressione e segure a mensagem suspeita e clique em *Responder (Citar)*\n` +
          `2️⃣ Digite *!report* ou *!spam*\n\n` +
          `_Nossa IA e sistema heurístico examinarão o conteúdo em tempo real!_`
      });
    }

    const targetPhone = (targetParticipant || '').split('@')[0].split(':')[0].replace(/\D/g, '');

    // Proteção: Dono ou o próprio Bot não podem ser denunciados
    const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '').replace(/\D/g, '');
    if (targetPhone === ownerPhone || targetPhone === (sock.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '')) {
      return sock.sendMessage(from, {
        text: `🛡️ *Operação Negada:* Administradores e a Matriz Oficial não podem ser alvos de denúncia automatizada.`
      });
    }

    // Extrai o texto da mensagem citada
    const targetText = quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      '';

    const analysis = this.analyze(targetText);
    const mode = models.getSetting('MODERATION_MODE', 'enforce'); // 'enforce' ou 'shadow'
    const blockThreshold = parseFloat(models.getSetting('MODERATION_BLOCK_THRESHOLD', '0.80')) || 0.80;

    const trustedReporter = isAdmin || isOwner;
    const canAutoDelete = trustedReporter || (analysis.score >= 0.70);

    let actionTaken = 'QUEUED';
    let status = 'PENDING';
    let deleteSuccessful = false;

    // Execução da Remoção se Modo Ativo (Enforce)
    if (mode === 'enforce' && canAutoDelete) {
      try {
        const deleteKey = {
          remoteJid: from,
          id: targetId,
          fromMe: false,
          participant: targetParticipant
        };
        await sock.sendMessage(from, { delete: deleteKey });
        deleteSuccessful = true;
        actionTaken = 'DELETED';
        status = trustedReporter ? 'UPHELD' : 'DELETED';

        // Aplica advertência/strike ao autor
        models.addWarning(from, targetPhone, `Spam / Abuso detectado por denúncia (${analysis.category || 'Geral'})`, reporterName);
      } catch (err) {
        console.warn('[ModeratorService] Falha ao deletar mensagem citada:', err.message);
        actionTaken = 'DELETE_FAILED';
      }
    }

    // Registra a denúncia no banco de dados para a mesa de análise do painel web
    try {
      models.recordModerationReport({
        message_id: targetId,
        group_jid: from,
        group_name: null,
        reported_author_jid: targetParticipant || `${targetPhone}@s.whatsapp.net`,
        reported_author_name: null,
        reporter_jid: senderJid,
        reporter_name: reporterName,
        reported_text: targetText,
        normalized_text: analysis.normalized.text,
        spam_score: analysis.score,
        category: analysis.category,
        evidence: JSON.stringify(analysis.hits.map(h => `${h.name}: ${h.evidence}`)),
        dampeners: JSON.stringify(analysis.dampeners),
        status,
        action_taken: actionTaken,
        note: trustedReporter ? 'Denunciado por Administrador' : (deleteSuccessful ? 'Removido por alta pontuação de spam' : 'Encaminhado para moderação')
      });
    } catch (e) {
      console.warn('[ModeratorService] Falha ao gravar relatório:', e.message);
    }

    // Feedback público no grupo
    if (deleteSuccessful) {
      return sock.sendMessage(from, {
        text: `🗑️ *MENSAGEM APAGADA POR SPAM / DENÚNCIA!*\n\n` +
          `👤 *Autor:* @${targetPhone}\n` +
          `🛡️ *Denunciante:* @${reporterPhone}${trustedReporter ? ' (Admin)' : ''}\n` +
          `⚖️ *Motivo:* ${analysis.category || 'Violação de Regras'}\n` +
          `📊 *Índice de Spam:* ${(analysis.score * 100).toFixed(0)}%\n` +
          `⚡ *Ação:* Mensagem removida para todos e advertência registrada.`,
        mentions: [targetParticipant, senderJid].filter(Boolean)
      });
    } else {
      return sock.sendMessage(from, {
        text: `🚩 *DENÚNCIA REGISTRADA COM SUCESSO!*\n\n` +
          `Obrigado, @${reporterPhone}! A mensagem foi indexada e encaminhada com prioridade para a mesa de revisão dos administradores no painel.\n\n` +
          `📊 *Score Heurístico:* ${(analysis.score * 100).toFixed(0)}% | *Categoria:* ${analysis.category || 'Revisão Geral'}`,
        mentions: [senderJid]
      });
    }
  }

  /**
   * Monitoramento Heurístico Passivo de Toda Mensagem de Grupo
   * Disparado no fluxo geral do bot se a moderação inteligente estiver ativa.
   */
  async checkIntelligentModeration(sock, from, msg, text, isGroup, isAdmin = false) {
    if (!isGroup || isAdmin || !text) return false;

    const isGlobalActive = models.getSetting('MODERATION_AUTO_DELETE', 'true') === 'true';
    if (!isGlobalActive) return false;

    const analysis = this.analyze(text);
    const blockThreshold = parseFloat(models.getSetting('MODERATION_BLOCK_THRESHOLD', '0.85')) || 0.85;

    // Se atingiu o limiar de bloqueio e não foi amenizado por dampeners
    if (analysis.score >= blockThreshold) {
      const mode = models.getSetting('MODERATION_MODE', 'enforce');
      const sender = msg.key?.participant || from;
      const senderPhone = sender.split('@')[0].split(':')[0].replace(/\D/g, '');

      // Proteção do Dono
      const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '').replace(/\D/g, '');
      if (senderPhone === ownerPhone) return false;

      if (mode === 'enforce') {
        try {
          await sock.sendMessage(from, { delete: msg.key });
        } catch (_) {}

        models.addWarning(from, senderPhone, `Spam Automático Detectado: ${analysis.category}`, 'AI Moderator Engine');

        try {
          models.recordModerationReport({
            message_id: msg.key?.id,
            group_jid: from,
            group_name: null,
            reported_author_jid: sender,
            reported_author_name: msg.pushName || senderPhone,
            reporter_jid: 'system@moderator',
            reporter_name: 'AI Moderator Engine',
            reported_text: text,
            normalized_text: analysis.normalized.text,
            spam_score: analysis.score,
            category: analysis.category,
            evidence: JSON.stringify(analysis.hits.map(h => `${h.name}: ${h.evidence}`)),
            dampeners: JSON.stringify(analysis.dampeners),
            status: 'DELETED',
            action_taken: 'DELETED',
            note: 'Detectado e excluído automaticamente no fluxo do grupo'
          });
        } catch (_) {}

        await sock.sendMessage(from, {
          text: `🚨 *@${senderPhone}, sua mensagem foi removida automaticamente por violar as diretrizes do grupo!*\n\n` +
            `⚖️ *Classificação:* ${analysis.category}\n` +
            `📊 *Nível de Detecção:* ${(analysis.score * 100).toFixed(0)}%\n` +
            `⚠️ _Uma advertência foi adicionada ao seu histórico._`,
          mentions: [sender]
        });

        return true; // Mensagem foi excluída/interceptada
      } else {
        // Modo Sombra: Apenas registra no banco sem deletar
        try {
          models.recordModerationReport({
            message_id: msg.key?.id,
            group_jid: from,
            group_name: null,
            reported_author_jid: sender,
            reported_author_name: msg.pushName || senderPhone,
            reporter_jid: 'system@moderator',
            reporter_name: 'AI Moderator Engine (Shadow)',
            reported_text: text,
            normalized_text: analysis.normalized.text,
            spam_score: analysis.score,
            category: analysis.category,
            evidence: JSON.stringify(analysis.hits.map(h => `${h.name}: ${h.evidence}`)),
            dampeners: JSON.stringify(analysis.dampeners),
            status: 'PENDING',
            action_taken: 'QUEUED',
            note: 'Modo Sombra: Mensagem violou regras mas foi mantida para auditoria'
          });
        } catch (_) {}
      }
    }

    return false;
  }
}

module.exports = new ModeratorService();

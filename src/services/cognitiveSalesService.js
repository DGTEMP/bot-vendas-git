const models = require('../db/models');
const config = require('../config');
const aiManager = require('./aiManagerService');

class CognitiveSalesService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || config.ai?.endpoint || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || config.ai?.key || 'sk-antigravity-master-key';

    // Buffer de diálogo recente em memória para conversas multi-turn coerentes
    this.dialogueBuffers = new Map(); // cleanPhone -> Array<{ role: 'user'|'assistant', text: string, timestamp: number }>
    // Estado do Onboarding Ativo por Missões
    this.onboardingStates = new Map(); // cleanPhone -> { step: 'WAITING_PIX_KEY'|'WAITING_PRODUCT'|'COMPLETED', pixKey, productName, price, updatedAt }

    // Lista de padrões artificiais de IA proibidos no modo humanizado
    this.forbiddenAiClichés = [
      /com certeza(?:,|!)?/gi,
      /hoje [eé] o seu dia de sorte(?:,|!)?/gi,
      /maravilha(?:,|!)?/gi,
      /sensacional(?:,|!)?/gi,
      /excelente escolha(?:,|!)?/gi,
      /fique tranquilo(?:\(a\))?(?:,|!)?/gi,
      /posso te ajudar com isso/gi,
      /estou aqui para te ajudar/gi,
      /n[aã]o hesite em perguntar/gi,
      /como posso ser [uú]til/gi,
      /essa [eé] uma excelente pergunta/gi,
      /com grande satisfa[cç][aã]o/gi,
      /espero que esta mensagem o encontre bem/gi,
      /sem mais delongas/gi,
      /que bom falar contigo(?:,|!)?/gi,
      /estamos aqui para te ouvir/gi,
      /temos todo o tempo do mundo/gi,
      /com total aten[cç][aã]o/gi,
      /encontrar a melhor solu[cç][aã]o juntos/gi,
      /seja muito bem-vindo(?:\(a\))?/gi,
      /espero que seu dia esteja sendo excelente/gi,
      /estou 100% [aà] sua disposi[cç][aã]o/gi,
      /pode falar com total tranquilidade/gi,
      /compreendo perfeitamente(?:,|!)?/gi,
      /[eé] um prazer te atender(?:,|!)?/gi,
      /aqui na nossa empresa(?:,|!)?/gi,
      /aguardo seu retorno(?:,|!)?/gi,
      /estou [aà] disposi[cç][aã]o(?:,|!)?/gi,
      /caso tenha alguma d[uú]vida(?:,|!)?/gi,
      /fique [aà] vontade para/gi,
      /prezado(?:\(a\))?/gi,
      /como posso (?:te )?ajudar(?: hoje)?(?:\?|!|\.)?/gi,
      /em que posso (?:te )?ajudar(?:\?|!|\.)?/gi,
      /como posso ser [uú]til(?:\?|!|\.)?/gi,
      /o que posso fazer por voc[eê](?:\?|!|\.)?/gi,
      /me conta,? como posso te ajudar/gi,
      /posso te ajudar em algo/gi,
      /em que posso colaborar/gi,
      /vi que voc[eê] (?:deu uma olhada|olhou|visitou)(?: nas nossas solu[cç][oõ]es| nosso cat[aá]logo| nossa vitrine| nosso site)?/gi,
      /t[aá] buscando algo espec[ií]fico pro seu neg[oó]cio ou s[oó] explorando(?: as op[cç][oõ]es)?(?:\?|!|\.)?/gi
    ];
  }

  // ==============================================================
  // 1. MOTOR DE HUMANIZAÇÃO DE RESPOSTAS (ANTI-AI VOICE)
  // ==============================================================
  humanizeResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let lines = text.split('\n');
    lines = lines.filter(line => {
      const l = line.trim();
      if (!l) return true;
      if (/^(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?/i.test(l)) return false;
      if (/^(?:(?:master\s+bot|bot(?:\s+tenant[^\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+/i.test(l)) return false;
      if (/^via\s+(?:groq|gemini|openai|deepseek|claude|qwen|llama|flowith)/i.test(l)) return false;
      if (/^\[(?:flowith|groq|gemini|openai|deepseek|claude|qwen|llama|fallback|ia|ai)[^\]]*\]:?$/i.test(l)) return false;
      if (/^(?:modelo|model|provedor|provider|engine)\s*:\s*/i.test(l)) return false;
      return true;
    });

    let humanized = lines.join('\n').trim();

    // Remove prefixos inline remanescentes
    humanized = humanized
      .replace(/^(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?(?:\s*\[[^\]]*\])?\*?:?\s*/i, '')
      .replace(/^(?:(?:master\s+bot|bot(?:\s+tenant[^\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+[^\n:]*(?::|\s*)/i, '')
      .replace(/^\[(?:flowith|groq|gemini|openai|deepseek|claude|qwen|llama|fallback|ia|ai)[^\]]*\]:?\s*/i, '')
      .replace(/^(?:(?:bot|ia|atendente|assistente|consultor|vendedor)\s*:\s*)+/i, '')
      .replace(/^#{1,4}\s+.*?\n+/gi, '');

    // Remove clichês artificiais de robô
    for (const pattern of this.forbiddenAiClichés) {
      humanized = humanized.replace(pattern, '').trim();
    }

    // Reduz excessos de exclamações consecutivas (ex: "!!!" -> ".")
    humanized = humanized.replace(/!{2,}/g, '.');

    // Modera excesso de emojis para manter postura de consultoria sênior (máximo 1 ou 2 por mensagem)
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const emojis = humanized.match(emojiRegex);
    if (emojis && emojis.length > 3) {
      let count = 0;
      humanized = humanized.replace(emojiRegex, (match) => {
        count++;
        return count <= 2 ? match : '';
      });
    }

    // Ajusta espaços e pontuações remanescentes preservando quebras de balão (\n\n)
    humanized = humanized
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+([.,;:?!])/g, '$1')
      .replace(/^([.,;:?!])[ \t]*/g, '')
      .trim();

    // Garante primeira letra maiúscula
    if (humanized.length > 0) {
      humanized = humanized.charAt(0).toUpperCase() + humanized.slice(1);
    }

    return humanized;
  }

  // ==============================================================
  // 1.0 ONBOARDING ATIVO & CONDUÇÃO GUIADA POR MISSÕES (MÃO NA MASSA)
  // ==============================================================
  getOnboardingState(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    return this.onboardingStates.get(clean) || null;
  }

  setOnboardingState(phone, state) {
    if (!phone) return;
    const clean = String(phone).replace(/\D/g, '');
    this.onboardingStates.set(clean, { ...state, updatedAt: Date.now() });
  }

  processInteractiveOnboarding(phone, text, firstName = '') {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const cleanFirstNameGreet = firstName && firstName !== 'Amigo' ? `, ${firstName}` : '';
    let currentState = this.getOnboardingState(cleanPhone);
    const low = String(text || '').trim().toLowerCase();

    // 1. Se o cliente está no meio do passo de Chave Pix (Missão 1)
    if (currentState && currentState.step === 'WAITING_PIX_KEY') {
      const cleanDigits = low.replace(/\D/g, '');
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(low);
      const isCpf = cleanDigits.length === 11;
      const isCnpj = cleanDigits.length === 14;
      const isPhone = cleanDigits.length >= 10 && cleanDigits.length <= 13;
      const isEvp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(low);

      if (isEmail || isCpf || isCnpj || isPhone || isEvp || low.length >= 8) {
        const pixKey = isCpf || isCnpj || isPhone ? cleanDigits : text.trim();
        models.setSetting(`OWNER_PIX_KEY_${cleanPhone}`, pixKey);
        models.setSetting('OWNER_PIX_KEY', pixKey);

        this.setOnboardingState(cleanPhone, {
          step: 'WAITING_PRODUCT',
          pixKey
        });

        models.recordCognitiveMemory(cleanPhone, {
          memory_type: 'AGREEMENT',
          fact_summary: `Chave Pix cadastrada no Onboarding Interativo: ${pixKey}`,
          confidence_score: 1.0
        });

        return `Chave Pix *${pixKey}* vinculada com sucesso! ✅\n\n` +
          `🎯 *Missão 2:* Agora me manda o *nome e o preço* do seu produto principal (ex: *"Plano VIP 97"* ou *"Camiseta Premium 89.90"*).\n\n` +
          `Se tiver foto dele, pode mandar junto que eu já coloco na sua vitrine online agora mesmo! 🚀`;
      }
    }

    // 2. Se o cliente está no passo de Cadastrar Primeiro Produto (Missão 2)
    if (currentState && currentState.step === 'WAITING_PRODUCT') {
      const priceMatch = text.match(/(?:r\$\s*|valor[:=\s]+)?(\d+(?:[.,]\d{1,2})?)/i);
      let extractedPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : 49.90;
      let productName = text.replace(/(?:r\$\s*|valor[:=\s]+)?\d+(?:[.,]\d{1,2})?/gi, '').trim();
      if (!productName || productName.length < 2) productName = 'Produto Oficial';

      try {
        models.createProduct({
          name: productName,
          description: `Produto cadastrado via Onboarding Interativo de ${firstName || 'Cliente VIP'}`,
          price: extractedPrice,
          price_brl: extractedPrice,
          price_usdt: Math.round(extractedPrice / 5),
          currency: 'BRL',
          type: 'DIGITAL',
          category: 'Geral',
          active: 1
        });
      } catch (_) {}

      this.setOnboardingState(cleanPhone, {
        step: 'COMPLETED',
        pixKey: currentState.pixKey,
        productName,
        price: extractedPrice
      });

      models.recordCognitiveMemory(cleanPhone, {
        memory_type: 'AGREEMENT',
        fact_summary: `Primeiro produto configurado no Onboarding: ${productName} (R$ ${extractedPrice})`,
        confidence_score: 1.0
      });

      const storeUrl = models.getSetting('WEB_STORE_PUBLIC_URL', 'http://localhost:3000/loja');
      return `🎉 *Sensacional${cleanFirstNameGreet}! Missão cumprida com sucesso!* 🚀\n\n` +
        `Seu produto *"${productName}"* de *R$ ${extractedPrice.toFixed(2)}* já está ativo na sua vitrine oficial com Pix automático configurado!\n\n` +
        `🔗 *Sua Vitrine Oficial:* ${storeUrl}\n\n` +
        `✅ *Seu Onboarding está 100% concluído!* A partir de agora, seu bot atende, tira dúvidas e vende sozinho 24h por dia.\n\n` +
        `Qualquer ajuste ou dúvida, só me chamar aqui! Mande *"menu"* a qualquer momento para ver o painel.`;
    }

    // 3. Inicia Onboarding Guiado Mão na Massa (Missão 1)
    this.setOnboardingState(cleanPhone, {
      step: 'WAITING_PIX_KEY'
    });

    return `Opa${cleanFirstNameGreet}! Vamos colocar sua máquina pra rodar agora em menos de 3 minutos, mão na massa 🚀\n\n` +
      `Aqui não tem manual chato: a gente configura direto por aqui em 2 passos rápidos!\n\n` +
      `🎯 *Missão 1:* Me manda aqui a sua *chave Pix oficial* (CPF, CNPJ, e-mail, telefone ou chave aleatória) que eu já vinculo no seu bot agora mesmo.`;
  }

  // ==============================================================
  // 1.1 BUFFER DE DIÁLOGO MULTI-TURN & MEMÓRIA IMEDIATA
  // ==============================================================
  recordDialogueTurn(phone, role, text) {
    if (!phone || !text) return;
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!this.dialogueBuffers.has(cleanPhone)) {
      this.dialogueBuffers.set(cleanPhone, []);
    }
    const buf = this.dialogueBuffers.get(cleanPhone);
    const now = Date.now();
    const filtered = buf.filter(t => (now - t.timestamp) < 45 * 60 * 1000);
    const trimmedText = String(text).trim();

    // Evita duplicar o mesmo turno de assistente ou usuário consecutivamente
    const last = filtered[filtered.length - 1];
    if (last && last.role === role && last.text === trimmedText) {
      return;
    }

    filtered.push({ role, text: trimmedText, timestamp: now });
    if (filtered.length > 60) filtered.splice(0, filtered.length - 60);
    this.dialogueBuffers.set(cleanPhone, filtered);
  }

  getRecentDialogueTurns(phone, maxTurns = 12) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    const buf = this.dialogueBuffers.get(cleanPhone) || [];
    const now = Date.now();
    const valid = buf.filter(t => (now - t.timestamp) < 45 * 60 * 1000);
    return valid.slice(-maxTurns).map(t => ({ role: t.role, content: t.text }));
  }

  getLastDialogueTimestamp(phone) {
    if (!phone) return 0;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const buf = this.dialogueBuffers.get(cleanPhone);
    if (!buf || buf.length === 0) return 0;
    const last = buf[buf.length - 1];
    return last ? (last.timestamp || 0) : 0;
  }

  stripRedundantGreeting(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();
    const greetingPrefixRegex = /^(?:(?:ol[aá]|oi\b|opa\b|salve\b|fala\b|e\s*a[ií]|bom\s*dia|boa\s*(?:tarde|noite))\s*(?:[A-Za-zÀ-ÿ]+)?[,!.\s]*)+(?:(?:tudo\s*(?:bem|bom|certo|100%?|tranquilo|joia|[oó]timo)|beleza)\s*(?:por\s*a[ií]|com\s*voc[eê]|contigo)?[!?.\s]*)*/i;
    cleaned = cleaned.replace(greetingPrefixRegex, '').trim();
    return cleaned.length > 0 ? (cleaned.charAt(0).toUpperCase() + cleaned.slice(1)) : text;
  }

  // ==============================================================
  // 1.2 FILTRO ANTI-REPETIÇÃO DE PERGUNTAS & DETECTOR DE LOOPS
  // ==============================================================
  getRecentQuestionsAsked(phone, maxTurns = 6) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    const buf = this.dialogueBuffers.get(cleanPhone) || [];
    const recent = buf.filter(t => t.role === 'assistant').slice(-maxTurns);
    const questionsFound = [];

    for (const item of recent) {
      const txt = (item.text || '').toLowerCase();
      if (/qual\s*(?:dessas?|das)\s*(?:op[cç][oõ]es|[aá]reas|planos)/i.test(txt)) {
        questionsFound.push('WHICH_OPTION');
      }
      if (/(?:j[aá]\s+tem\s+(?:uma\s+)?opera[cç][aã]o|t[aá]\s+montando\s+(?:a\s+estrutura\s+)?do\s+zero)/i.test(txt)) {
        questionsFound.push('OPERATION_STATUS');
      }
      if (/(?:o\s+que\s+voc[eê]\s+t[aá]\s+precisando\s+resolver|precisando\s+resolver\s+no\s+momento)/i.test(txt)) {
        questionsFound.push('DIAGNOSTIC_NEED');
      }
      if (/(?:posso\s+gerar\s+o\s+c[oó]digo\s+pix|posso\s+te\s+gerar\s+a\s+chave\s+pix|gerar\s+o\s+c[oó]digo\s+pix\s+copia\s+e\s+cola)/i.test(txt)) {
        questionsFound.push('GENERATE_PIX');
      }
      if (/(?:quer\s+dar\s+uma\s+olhada\s+na\s+vitrine|olhar\s+na\s+vitrine|prefere\s+o\s+link\s+da\s+loja)/i.test(txt)) {
        questionsFound.push('VISIT_STORE');
      }
      if (/(?:qual\s+parte\s+da\s+automa[cç][aã]o\s+[eé]\s+mais\s+urgente)/i.test(txt)) {
        questionsFound.push('WHICH_URGENT');
      }
      if (/(?:pra\s+quando\s+voc[eê]\s+precisa\s+disso)/i.test(txt)) {
        questionsFound.push('WHEN_NEED');
      }
      if (/(?:j[aá]\s+tem\s+o\s+escopo\s+desenhado)/i.test(txt)) {
        questionsFound.push('HAS_SCOPE');
      }
      if (/(?:procurando\s+algo\s+pra\s+voc[eê]\s+mesmo\s+ou\s+tem\s+algum\s+modelo)/i.test(txt)) {
        questionsFound.push('SPECIFIC_MODEL');
      }
    }
    return questionsFound;
  }

  filterRepeatedQuestions(text, phone, isGroup = false) {
    if (!text || typeof text !== 'string' || !phone || isGroup) return text;
    const asked = this.getRecentQuestionsAsked(phone, 6);
    if (asked.length === 0) return text;

    let filtered = text;

    if (asked.includes('WHICH_OPTION') && /qual\s*(?:dessas?|das)\s*(?:op[cç][oõ]es|[aá]reas|planos)[^.?!\n]*/i.test(filtered)) {
      filtered = filtered.replace(/qual\s*(?:dessas?|das)\s*(?:op[cç][oõ]es|[aá]reas|planos)[^.?!\n]*(?:\?|!|\.)?/i, 'Se você quiser ativar agora, só me dar o ok que já te envio o Pix Copia e Cola pra liberar seu acesso! 👍');
    }

    if (asked.includes('OPERATION_STATUS') && /(?:voc[eê]\s+)?(?:j[aá]\s+tem\s+(?:uma\s+)?opera[cç][aã]o|t[aá]\s+montando\s+(?:a\s+estrutura\s+)?do\s+zero)[^.?!\n]*(?:\?|!|\.)?/i.test(filtered)) {
      filtered = filtered.replace(/(?:voc[eê]\s+)?(?:j[aá]\s+tem\s+(?:uma\s+)?opera[cç][aã]o|t[aá]\s+montando\s+(?:a\s+estrutura\s+)?do\s+zero)[^.?!\n]*(?:\?|!|\.)?/i, 'Temos planos flexíveis com garantia total de 7 dias.');
    }

    if (asked.includes('DIAGNOSTIC_NEED') && /me\s+conta:?\s*o\s+que\s+voc[eê]\s+t[aá]\s+precisando\s+resolver[^.?!\n]*(?:\?|!|\.)?/i.test(filtered)) {
      filtered = filtered.replace(/me\s+conta:?\s*o\s+que\s+voc[eê]\s+t[aá]\s+precisando\s+resolver[^.?!\n]*(?:\?|!|\.)?/i, 'Se quiser testar ou tirar dúvidas sobre o bot, estou por aqui! 👍');
    }

    if (asked.includes('GENERATE_PIX') && /posso\s+(?:te\s+)?gerar\s+(?:o\s+c[oó]digo|a\s+chave)?\s*pix[^.?!\n]*(?:\?|!|\.)?/i.test(filtered)) {
      filtered = filtered.replace(/posso\s+(?:te\s+)?gerar\s+(?:o\s+c[oó]digo|a\s+chave)?\s*pix[^.?!\n]*(?:\?|!|\.)?/i, 'Assim que você der o sinal, já te mando o Pix pra você começar a rodar no mesmo minuto! 🚀');
    }

    return filtered;
  }

  // ==============================================================
  // 2. EXTRAÇÃO DE CRENÇAS, MEMÓRIAS & LEAD SCORING BASEADO EM EVIDÊNCIAS
  // ==============================================================
  analyzeAndExtractProfile(phone, name, messageText, extraContext = {}) {
    if (!phone || !messageText) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const text = String(messageText).trim();
    const lower = text.toLowerCase();

    // Registra o turno no buffer multi-turn imediato
    this.recordDialogueTurn(cleanPhone, 'user', text);

    // Obtém ou inicializa perfil existente
    let profile = models.getLeadCognitiveProfile(cleanPhone);
    if (!profile) {
      profile = models.upsertLeadCognitiveProfile(cleanPhone, {
        name: name || 'Lead Consultoria',
        buying_stage: 'DESCOBERTA',
        readiness_score: 30
      });
    }

    const updates = {};
    const beliefsToUpdate = [];
    const memoriesToAdd = [];

    // --- 0. Detecção de Desinteresse / Recusa Explícita do Produto ---
    const isDisinterest = /(?:n[aã]o\s+quero\s+(?:o\s+)?(?:produto|bot|servi[cç]o|plano|sistema|nada|isso|esse|essa|comprar)|n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+me\s+interessa|n[aã]o\s+preciso(?:\s+de\s+(?:bot|nada|isso|produto))?|n[aã]o\s+vou\s+querer|n[aã]o\s+vou\s+comprar|n[aã]o\s+[eé]\s+(?:o\s+que\s+)?(?:eu\s+)?procuro|pra\s+mim\s+n[aã]o\s+serve|n[aã]o\s+serve\s+pra\s+mim|n[aã]o\s+faz\s+sentido|n[aã]o\s+estou\s+interessad[oa]|obrigad[oa]\s+mas\s+n[aã]o|valeu\s+mas\s+n[aã]o|obrigado\s+n[aã]o\s+quero|valeu\s+n[aã]o\s+quero|t[oô]\s+de\s+boa|deixa\s+quieto|deixa\s+pra\s+l[aá]|n[aã]o\s+vou\s+fechar|n[aã]o\s+quero\s+gastar|pode\s+cancelar(?:\s+o\s+pedido)?|cancela\s+(?:o\s+pedido|a\s+compra)|n[aã]o\s+tenho\s+como\s+comprar|n[aã]o\s+tenho\s+interesse\s+em\s+comprar)/i.test(lower);

    if (isDisinterest) {
      try {
        const db = require('../db/database');
        db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(cleanPhone);
        db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE platform = 'whatsapp' AND platform_user_id LIKE ? AND status = 'PENDING'`).run(`%${cleanPhone}%`);
      } catch (_) {}

      updates.buying_stage = 'PERDIDO';
      updates.readiness_score = 0;
      updates.main_objection = 'SEM_INTERESSE';
      updates.objection_confidence = 0.98;
      updates.next_followup_at = null;

      beliefsToUpdate.push({
        key: 'product_interest',
        value: 'Sem interesse no momento (Recusa explícita)',
        evidence: text.slice(0, 100),
        confidence: 0.98
      });

      memoriesToAdd.push({
        type: 'OBJECTION',
        summary: 'DESINTERESSE DECLARADO: O cliente afirmou com clareza que não quer o produto ou não tem interesse.',
        excerpt: text,
        importance: 5
      });
    }

    // --- 0.1 Detecção de Correção Enfática do Lead (Nicho / Escopo) ---
    const isCorrectionOrRejection = /(?:n[aã]o\s+tem\s+nada\s+(?:a|ha)ver|t[aá]\s+errado|est[aá]\s+errado|falei\s+que|eu\s+disse\s+que|eu\s+tenho\s+[eé]\s+uma?|o\s+que\s+isso\s+tem\s+(?:a|ha)ver|n[aã]o\s+sou\s+trader|n[aã]o\s+mexo\s+com\s+trader|nada\s+disso|viajou|errou\s+feio|t[aá]\s+doido|t[aá]\s+louco|insistindo)/i.test(lower);
    if (isCorrectionOrRejection && !isDisinterest) {
      try {
        const db = require('../db/database');
        db.prepare('DELETE FROM lead_funnel_conversations WHERE phone = ?').run(cleanPhone);
      } catch (_) {}
      memoriesToAdd.push({
        type: 'FEEDBACK',
        summary: 'CORREÇÃO ENFÁTICA: O cliente corrigiu o bot dizendo que não tem nada a ver com método trader. NUNCA mais cite trader ou scalper. O foco é 100% no negócio real do cliente.',
        excerpt: text,
        importance: 5
      });
    }

    // --- A. Nicho de Atuação da Empresa ---
    const nichePatterns = [
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|vendo|loja de|marca de|pra|para|dono de|empresa de)?\s*(?:uma?\s*)?(?:papelaria|livraria|gr[aá]fica|xerox|impress[aã]o|copiadora|material escolar|materiais escolares|material de escrit[oó]rio|cadernos|resmas)/i,
        niche: 'Papelaria & Material de Escritório'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|vendo|loja de|marca de|pra|para|dono de|empresa de)?\s*(?:uma?\s*)?(?:cl[ií]nica|consult[oó]rio|m[eé]dic|odont|sa[uú]de|paciente|dentista|psic[oó]log|fisioterap|est[eé]tica)/i,
        niche: 'Saúde & Clínicas'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|vendo|loja de|marca de|pra|para|dono de|empresa de)?\s*(?:uma?\s*)?(?:mercado|mercadinho|supermercado|mercearia|hortifruti|a[cç]ougue|padaria|panificadora|confeitaria|farm[aá]cia|drogaria|pet\s*shop|agropecu[aá]ria|conveni[eê]ncia|adega|distribuidora|bebidas|dep[oó]sito|materiais de constru[cç][aã]o|tintas|ferragens|auto\s*pe[cç]as|moto\s*pe[cç]as|oficina|mec[aâ]nica|eletr[oô]nicos?|assist[eê]ncia t[eé]cnica|celulares?|smartphone|[oó]tica|joalheria|bijuteria|floricultura|brinquedos?|artesanato|bazar)/i,
        niche: 'Comércio Local & Varejo Físico'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|vendo|loja de|marca de|pra|para|dono de|empresa de)?\s*(?:uma?\s*)?(?:loja|e-?commerce|varejo|roupas?|moda|vestu[aá]rio|dropshipping|cosm[eé]ticos?|suplementos?|encapsulados?|cal[cç]ados?)/i,
        niche: 'E-commerce & Varejo'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|vendo|pra|para|dono de)?\s*(?:uma?\s*)?(?:restaurante|delivery|lanchonete|pizzaria|hamburgueria|bar|marmitaria|a[cç]a[ií]|comida)/i,
        niche: 'Alimentação & Delivery'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|pra|para|dono de)?\s*(?:uma?\s*)?(?:imobili[aá]ria|corretor|im[oó]veis|loca[cç][aã]o|aluguel)/i,
        niche: 'Imobiliário & Construção'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|pra|para|dono de)?\s*(?:uma?\s*)?(?:advocacia|advogado|escrit[oó]rio|jur[ií]dico|contabilidade|contador)/i,
        niche: 'Jurídico & Contabilidade'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|pra|para|dono de)?\s*(?:uma?\s*)?(?:escola|curso|infoproduto|produtor|mentor|lan[cç]amento)/i,
        niche: 'Educação & Infoprodutos'
      },
      {
        regex: /(?:tenho|sou|trabalho com|minha|meu|pra|para|dono de)?\s*(?:uma?\s*)?(?:empresa|f[aá]brica|ind[uú]stria|log[ií]stica|transport)/i,
        niche: 'Indústria & Logística'
      },
      {
        regex: /(?:sou afiliad|trabalho como afiliad|marketing de afiliados|sou infoprodutor|sou dropshipper)/i,
        niche: 'Afiliados & Infoprodutos'
      },
      {
        regex: /(?:sou tipster|trabalho com apostas|grupo de sinais|tenho casa de aposta|minha bet)/i,
        niche: 'iGaming & Grupos VIP'
      }
    ];
    for (const np of nichePatterns) {
      if (np.regex.test(text)) {
        updates.company_niche = np.niche;
        beliefsToUpdate.push({ key: 'niche', value: np.niche, evidence: text.slice(0, 100), confidence: 0.90 });
        memoriesToAdd.push({ type: 'REQUIREMENT', summary: `Atua no segmento de ${np.niche}`, excerpt: text });
        break;
      }
    }

    // --- A.2 Detecção de Modelo de Operação com Entregas Rápidas ---
    if (/(?:entrega[s]?\s*(?:super\s*)?r[aá]pid[ao]|pede\s+hoje.*amanh[aã]\s+chega|delivery\s+local|motoboy|envio\s+no\s+mesmo\s+dia|pronta\s+entrega)/i.test(text)) {
      beliefsToUpdate.push({
        key: 'delivery_model',
        value: 'Entrega Rápida Local (Pede hoje, amanhã chega)',
        evidence: text.slice(0, 100),
        confidence: 0.95
      });
      memoriesToAdd.push({
        type: 'REQUIREMENT',
        summary: 'Opera com entregas rápidas locais (pede hoje, chega amanhã)',
        excerpt: text,
        importance: 4
      });
    }

    // --- B. Escopo do Projeto & Interesses Técnicos ---
    const scopeInterests = [];
    if (/(?:\bapp\b|aplicativo|mobile|android|ios|flutter|react native)/i.test(lower)) {
      scopeInterests.push('Aplicativo Mobile sob medida');
    }
    if (/(?:bot|chatbot|ia|intelig[eê]ncia artificial|atendente autom[aá]tico|gemini|openai)/i.test(lower)) {
      scopeInterests.push('Agente de IA & Atendimento');
    }
    if (/(?:site|landing page|portal|painel web|dashboard|sistema web)/i.test(lower)) {
      scopeInterests.push('Site Institucional / Painel Web');
    }
    if (/(?:seo|primeiro no google|otimiza[cç][aã]o|performance|page speed|velocidade)/i.test(lower)) {
      scopeInterests.push('SEO & Tuning de Performance');
    }
    if (/(?:mete[oó]rico|lan[cç]amento|grupos vip|efeito manada)/i.test(lower)) {
      scopeInterests.push('Estrutura de Lançamento Meteórico');
    }
    if (/(?:hardwere|hardware|iot|embarcado|arduino|esp32|placa)/i.test(lower)) {
      scopeInterests.push('Hardware & Soluções IoT');
    }

    if (scopeInterests.length > 0) {
      updates.project_scope = scopeInterests.join(' + ');
      beliefsToUpdate.push({
        key: 'tech_interests',
        value: updates.project_scope,
        evidence: text.slice(0, 100),
        confidence: 0.90
      });
      memoriesToAdd.push({
        type: 'REQUIREMENT',
        summary: `Interesse em: ${updates.project_scope}`,
        excerpt: text
      });
    }

    // --- B.2 Maturidade da Operação (Do zero vs Rodando vs Escala) ---
    let opStatus = null;
    if (/(?:do zero|come[cç]ando|iniciando|ainda n[aã]o vendo|montando|primeir[oa]|pretendo|quero come[cç]ar)/i.test(lower)) {
      opStatus = 'Iniciante (Do Zero)';
    } else if (/(?:j[aá] vendo|j[aá] tenho|j[aá] roda|opera[cç][aã]o ativa|vendo no|tenho clientes|faturamento|tenho equipe|recebo mensagens)/i.test(lower)) {
      opStatus = 'Operação Ativa Rodando';
    } else if (/(?:escala|muitas mensagens|milhares|n[aã]o dou conta|lotado|alto volume|equipe grande|esgotado)/i.test(lower)) {
      opStatus = 'Escala & Alto Volume';
    }
    if (opStatus) {
      beliefsToUpdate.push({ key: 'operation_status', value: opStatus, evidence: text.slice(0, 100), confidence: 0.90 });
      memoriesToAdd.push({ type: 'REQUIREMENT', summary: `Maturidade: ${opStatus}`, excerpt: text });
    }

    // --- B.3 Dor / Gargalo Principal (Reunindo conteúdo silenciosamente) ---
    let detectedPain = null;
    if (/(?:atendimento manual|responder na m[aã]o|demoro pra responder|tempo respondendo|mesma coisa|muita mensagem|perco tempo|grudado no celular)/i.test(lower)) {
      detectedPain = 'Perda de tempo com atendimento manual';
    } else if (/(?:perco venda|perco lead|fora de hora|de noite|madrugada|esfriam|demora pra fechar)/i.test(lower)) {
      detectedPain = 'Perda de leads fora do horário comercial';
    } else if (/(?:carrinho|checkout|abandonam|geram pix e n[aã]o pagam|n[aã]o pagam o pix|recupera[cç][aã]o)/i.test(lower)) {
      detectedPain = 'Carrinho abandonado e Pix não pago';
    } else if (/(?:curiosos|curioso|muito curioso|s[oó] perguntam|sem grana|triagem|filtrar)/i.test(lower)) {
      detectedPain = 'Sobrecarga de curiosos e falta de triagem';
    }
    if (detectedPain) {
      beliefsToUpdate.push({ key: 'main_pain', value: detectedPain, evidence: text.slice(0, 100), confidence: 0.90 });
      memoriesToAdd.push({ type: 'REQUIREMENT', summary: `Gargalo/Dor: ${detectedPain}`, excerpt: text });
    }

    // --- C. Extração de Orçamento (Budget Tier) ---
    const budgetMatch = text.match(/(?:or[cç]amento|posso pagar|verba|investir|tenho|gastar|at[eé])\s*(?:de|em)?\s*(?:r\$|reais)?\s*([\d.,]+)\s*(?:mil|k)?/i);
    if (budgetMatch) {
      let rawVal = budgetMatch[1].replace(/\./g, '').replace(',', '.');
      let amount = parseFloat(rawVal);
      if (text.toLowerCase().includes('mil') || text.toLowerCase().includes('k')) {
        if (amount < 100) amount = amount * 1000;
      }
      if (!isNaN(amount) && amount > 0) {
        let tier = 'MEDIO';
        if (amount < 1500) tier = 'BAIXO';
        else if (amount >= 1500 && amount <= 5000) tier = 'MEDIO';
        else if (amount > 5000 && amount <= 15000) tier = 'ALTO';
        else tier = 'CORPORATIVO';

        updates.budget_tier = tier;
        updates.budget_confidence = 0.88;
        beliefsToUpdate.push({
          key: 'lead_budget',
          value: `R$ ${amount.toFixed(2)} (${tier})`,
          evidence: text.slice(0, 100),
          confidence: 0.88
        });
        memoriesToAdd.push({
          type: 'BUDGET',
          summary: `Orçamento declarado de ~R$ ${amount.toFixed(2)} (${tier})`,
          excerpt: text,
          importance: 4
        });
      }
    } else if (/(?:caro|puxado|salgado|sem grana|apertado|desconto|abaixa o pre[cç]o)/i.test(lower)) {
      updates.budget_tier = 'BAIXO';
      updates.budget_confidence = 0.70;
      beliefsToUpdate.push({ key: 'lead_budget', value: 'Sensível a Preço (Baixo/Médio)', evidence: text.slice(0, 100), confidence: 0.70 });
    }

    // --- D. Detecção de Objeções Reais ---
    if (/(?:muito caro|pre[cç]o alto|salgado|tem desconto|fora do or[cç]amento|n[aã]o tenho essa grana)/i.test(lower)) {
      updates.main_objection = 'PRECO';
      updates.objection_confidence = 0.85;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Preço / Investimento', evidence: text.slice(0, 100), confidence: 0.85 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Objeção de preço: busca condição modular ou desconto', excerpt: text, importance: 4 });
    } else if (/(?:demora|prazo|urgente|preciso pra ontem|entrega quando|quantos dias|at[eé] o dia|tempo de entrega)/i.test(lower)) {
      updates.main_objection = 'PRAZO';
      updates.objection_confidence = 0.80;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Prazo de Entrega', evidence: text.slice(0, 100), confidence: 0.80 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Objeção/preocupação com cronograma e prazo de entrega', excerpt: text, importance: 4 });
    } else if (/(?:garantia|e se n[aã]o funcionar|contrato|seguro|confi[aá]vel|golpe|suporte depois|manuten[cç][aã]o)/i.test(lower)) {
      updates.main_objection = 'CONFIANCA_GARANTIA';
      updates.objection_confidence = 0.85;
      beliefsToUpdate.push({ key: 'main_objection', value: 'Garantia, Contrato & Suporte', evidence: text.slice(0, 100), confidence: 0.85 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Exige segurança contratual, SLA e garantia de funcionamento', excerpt: text, importance: 4 });
    } else if (/(?:meu s[oó]cio|minha s[oó]cia|diretor|gerente|esposa|marido|conversar com|aprovar com)/i.test(lower)) {
      updates.main_objection = 'DECISOR';
      updates.objection_confidence = 0.80;
      beliefsToUpdate.push({ key: 'decision_maker', value: 'Decisão Compartilhada', evidence: text.slice(0, 100), confidence: 0.80 });
      memoriesToAdd.push({ type: 'OBJECTION', summary: 'Precisa apresentar proposta para sócio ou comitê', excerpt: text, importance: 4 });
    }

    // --- E. Estágio de Compra & Readiness Score ---
    let stage = profile.buying_stage || 'DESCOBERTA';
    let readiness = profile.readiness_score || 30;

    if (isDisinterest || updates.buying_stage === 'PERDIDO') {
      stage = 'PERDIDO';
      readiness = 0;
    } else if (profile.buying_stage === 'CONVERTIDO') {
      stage = 'CONVERTIDO';
      readiness = 100;
    } else if (/(?:ja fiz o pix|acabei de pagar|ja paguei|comprovante|pagamento feito|acabei de comprar|ja comprei|comprei pelo link|paguei pelo link|fiz a compra|consegui comprar|pronto.*compr)/i.test(lower)) {
      stage = 'CONVERTIDO';
      readiness = 100;
      memoriesToAdd.push({ type: 'AGREEMENT', summary: 'Pagamento confirmado e projeto iniciado', excerpt: text, importance: 5 });
    } else if (/(?:manda a chave pix|qual a chave pix|onde fa[cç]o o pix|manda o contrato|quero fechar|como fa[cç]o o pagamento|vamos fechar|fechado ent[aã]o|pode gerar o boleto|passa os dados da empresa)/i.test(lower)) {
      stage = 'FECHAMENTO';
      readiness = Math.max(readiness, 88);
      memoriesToAdd.push({ type: 'AGREEMENT', summary: 'Sinal verde para fechamento, solicitou dados de pagamento', excerpt: text, importance: 5 });
    } else if (updates.main_objection && updates.main_objection !== 'NENHUMA') {
      stage = 'OBJECOES';
      readiness = Math.max(readiness, 65);
    } else if (/(?:quanto custa|qual o valor|or[cç]amento|manda a proposta|tabela de pre[cç]os|quanto fica)/i.test(lower)) {
      stage = 'PROPOSTA';
      readiness = Math.max(readiness, 55);
    } else if (scopeInterests.length > 0 || updates.company_niche || profile.company_niche) {
      if (detectedPain || opStatus) {
        stage = 'AQUECIMENTO';
        readiness = Math.max(readiness, 55);
      } else if (stage === 'DESCOBERTA') {
        stage = 'QUALIFICACAO';
        readiness = Math.max(readiness, 45);
      }
    }

    updates.buying_stage = stage;
    updates.readiness_score = readiness;

    // Se o lead forneceu o nome explicitamente
    if (name && name !== 'Lead WhatsApp' && (!profile.name || profile.name === 'Lead WhatsApp')) {
      updates.name = name;
    }

    // Salva perfil atualizado no banco
    const updatedProfile = models.upsertLeadCognitiveProfile(cleanPhone, updates);

    // Salva crenças auditadas
    for (const b of beliefsToUpdate) {
      models.updateLeadBelief(cleanPhone, b.key, b.value, b.evidence, b.confidence);
    }

    // Salva memórias episódicas
    for (const m of memoriesToAdd) {
      models.addLeadEpisodicMemory(cleanPhone, m.type, m.summary, m.excerpt, m.importance || 3);
    }

    return updatedProfile;
  }

  // ==============================================================
  // 3. CONSULTATIVE SALES PLAYBOOKS & GERADOR DE RESPOSTA INTELIGENTE
  // ==============================================================
  async generateConsultativeReply(options = {}) {
    const {
      phone,
      senderPhone,
      name,
      customerName,
      senderName,
      firstName: rawFirstName,
      text: rawText,
      message,
      msg,
      nlpResult,
      matchedProduct,
      instanceId = null,
      subbotId = null,
      tenantId = null,
      tenantObj: explicitTenantObj = null,
      isMasterBot: explicitIsMasterBot = null,
      products = null,
      isGroup = false,
      groupName = '',
      isWithinActiveWindow = null,
      isVoiceInput = false,
      preferAudio = false
    } = (options || {});

    const rawPhone = phone || senderPhone || '';
    const phoneUtil = require('../utils/phoneUtil');
    const phoneInfo = phoneUtil.parseAndNormalizePhone(rawPhone);
    const cleanPhone = phoneInfo.phone || String(rawPhone).replace(/\D/g, '');
    const rawName = name || customerName || senderName || rawFirstName || '';
    const cleanName = (rawName && typeof rawName === 'string' && !/^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(rawName)) ? rawName.trim() : '';
    const text = String(rawText || message || msg || '').trim();

    let resolvedNlp = nlpResult;
    if (!resolvedNlp && text) {
      try {
        const nlpService = require('./nlpService');
        resolvedNlp = nlpService.classifyIntent(text);
      } catch (_) {}
    }

    // ⏱️ Regra de Inatividade de 30 Minutos
    const lastTurnTime = this.getLastDialogueTimestamp(cleanPhone);
    const inactivityMs = lastTurnTime > 0 ? (Date.now() - lastTurnTime) : Infinity;
    const activeWindow = isWithinActiveWindow !== null
      ? Boolean(isWithinActiveWindow)
      : (inactivityMs < 30 * 60 * 1000);

    const profile = models.getLeadCognitiveProfile(cleanPhone) || {
      phone: cleanPhone,
      name: cleanName,
      company_niche: '',
      project_scope: '',
      budget_tier: 'MEDIO',
      buying_stage: 'DESCOBERTA',
      main_objection: 'NENHUMA',
      readiness_score: 35
    };
    if (!profile.phone) profile.phone = cleanPhone;

    const cleanText = (text || '').trim();
    const wantsAudio = Boolean(
      isVoiceInput ||
      preferAudio ||
      profile.prefers_audio ||
      profile.preferred_channel === 'audio' ||
      /(?:manda|mande|envia|envie|grava|grave|fala|fale)\s+(?:um\s+)?(?:[aá]udio|voz)|prefiro\s+(?:[aá]udio|voz)|conversa\s+por\s+[aá]udio|pode\s+ser\s+por\s+[aá]udio/i.test(cleanText)
    );

    if (wantsAudio && cleanPhone) {
      try {
        models.upsertLeadCognitiveProfile(cleanPhone, { prefers_audio: true, preferred_channel: 'audio' });
      } catch (_) {}
    }

    const beliefs = models.getLeadBeliefs(cleanPhone);
    const memories = models.getLeadEpisodicMemories(cleanPhone, 6);
    const profName = (profile.name || cleanName || '').trim();
    const firstName = (!profName || /^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(profName)) ? '' : profName.split(' ')[0];

    const targetId = instanceId || subbotId || null;
    const inst = targetId ? models.getArmyInstanceById(targetId) : null;

    // Resolução de Escopo (Tenant vs Master Bot)
    const resolvedTenantId = (tenantId !== undefined && tenantId !== null)
      ? Number(tenantId)
      : (explicitTenantObj && explicitTenantObj.id ? Number(explicitTenantObj.id) : (inst && inst.tenant_id ? Number(inst.tenant_id) : null));

    let tenantObj = explicitTenantObj || null;
    let tenantSettings = tenantObj && tenantObj.settings ? tenantObj.settings : null;
    let effectiveProducts = Array.isArray(products) && products.length > 0 ? products : null;

    if (resolvedTenantId && !tenantObj) {
      tenantObj = models.getTenantById(resolvedTenantId);
      if (tenantObj && tenantObj.settings) tenantSettings = tenantObj.settings;
    }
    if (tenantObj && tenantObj.settings && !tenantSettings) {
      tenantSettings = tenantObj.settings;
    }
    if (resolvedTenantId || tenantObj) {
      if (!effectiveProducts) {
        const tId = resolvedTenantId || (tenantObj ? tenantObj.id : null);
        if (tId) {
          try {
            effectiveProducts = models.getProductsByTenant(tId).filter(p => p.active !== 0);
          } catch (_) {}
        }
      }
    } else {
      if (!effectiveProducts) {
        effectiveProducts = models.getProducts(true);
      }
    }

    const isMasterBot = explicitIsMasterBot !== null
      ? Boolean(explicitIsMasterBot)
      : (!resolvedTenantId && !tenantObj);

    const isDisinterest = Boolean(
      (resolvedNlp?.intent === 'DISINTEREST' || nlpResult?.intent === 'DISINTEREST') ||
      profile.buying_stage === 'PERDIDO' || profile.main_objection === 'SEM_INTERESSE' ||
      /(?:n[aã]o\s+quero\s+(?:o\s+)?(?:produto|bot|servi[cç]o|plano|sistema|nada|isso|esse|essa|comprar)|n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+me\s+interessa|n[aã]o\s+preciso(?:\s+de\s+(?:bot|nada|isso|produto))?|n[aã]o\s+vou\s+querer|n[aã]o\s+vou\s+comprar|n[aã]o\s+[eé]\s+(?:o\s+que\s+)?(?:eu\s+)?procuro|pra\s+mim\s+n[aã]o\s+serve|n[aã]o\s+serve\s+pra\s+mim|n[aã]o\s+faz\s+sentido|n[aã]o\s+estou\s+interessad[oa]|obrigad[oa]\s+mas\s+n[aã]o|valeu\s+mas\s+n[aã]o|obrigado\s+n[aã]o\s+quero|valeu\s+n[aã]o\s+quero|t[oô]\s+de\s+boa|deixa\s+quieto|deixa\s+pra\s+l[aá]|n[aã]o\s+vou\s+fechar|n[aã]o\s+quero\s+gastar|pode\s+cancelar(?:\s+o\s+pedido)?|cancela\s+(?:o\s+pedido|a\s+compra)|n[aã]o\s+tenho\s+como\s+comprar|n[aã]o\s+tenho\s+interesse\s+em\s+comprar)/i.test(cleanText)
    );

    const disinterestDirective = isDisinterest
      ? `\n🚨 REGRA DE OURO - O CLIENTE DECLAROU DESINTERESSE OU RECUSA DO PRODUTO:
O lead acabou de afirmar que NÃO quer o produto, NÃO tem interesse, não precisa ou que não é o que procura.
DIRETRIZ SUPREMA & INVIOLÁVEL:
1. É TERMINANTEMENTE PROIBIDO insistir, empurrar o produto novamente, forçar argumentos de "mas o sistema se paga", mandar chave Pix, áudios persuasivos de fechamento ou imagens promocionais!
2. Aja com máxima maturidade, elegância e gentileza: aceite o "Não" do cliente sem qualquer constrangimento ou insistência.
3. Responda em 1 ou 2 frases curtas e calorosas agradecendo sinceramente pelo tempo e atenção dele e deixando a porta aberta para o futuro (ex: "Entendido perfeitamente! Sem problemas. Muito obrigado pela atenção e pelo seu tempo! Se no futuro precisar de qualquer coisa, estamos à disposição. Sucesso por aí! 👍").
4. Apenas se o cliente disser espontaneamente que busca algo TOTALMENTE DIFERENTE que você tem no portfólio (ex: "não quero bot, quero um site"), responda tirando a dúvida dele com naturalidade sobre o item pedido, sem forçar o produto rejeitado.\n\n`
      : '';

    const isConverted = Boolean(profile?.buying_stage === 'CONVERTIDO');
    const onboardingDirective = (isConverted && !isDisinterest)
      ? `\n🌟 DIRETRIZ SUPREMA DE PÓS-VENDA & CUSTOMER SUCCESS (CLIENTE JÁ CONVERTIDO):
Este contato é um CLIENTE ATIVO que já adquiriu nossos produtos ou contratou nossos serviços!
1. PROIBIDO empurrar novos produtos, mandar preços ou enviar chaves Pix de planos básicos como se ele fosse um prospect novo!
2. Sua postura é de Consultor de Sucesso do Cliente (Customer Success & Onboarding VIP):
   - Trate o cliente como parceiro e cliente VIP ("Fala ${firstName || 'amigo'}, tudo bem? Como tão as coisas por aí?").
   - Ajude na ativação, configuração, dúvidas operacionais e melhores práticas do bot/sistema.
   - Forneça passos claros: como cadastrar produtos, como vincular chave Pix, como conectar o WhatsApp ou como proteger grupos.
   - Dê suporte técnico humanizado e prestativo.
   - Somente se o próprio cliente demonstrar interesse em novos produtos, projetos sob medida ou expansões, apresente com carinho e condição especial de cliente existente.\n\n`
      : '';

    let saudacao = 'boa tarde';
    try {
      const { getBrasiliaGreeting } = require('../utils/dateTime');
      saudacao = getBrasiliaGreeting().saudacao;
    } catch (_) {}

    let preferredProvider = (inst && inst.ai_provider && inst.ai_provider !== 'auto') ? inst.ai_provider : null;
    if (!preferredProvider && tenantSettings && tenantSettings.default_ai_provider && tenantSettings.default_ai_provider !== 'auto') {
      preferredProvider = tenantSettings.default_ai_provider;
    }

    let customModel = (inst && inst.ai_model) ? inst.ai_model : null;
    if (!customModel && tenantSettings && tenantSettings.default_ai_model) {
      customModel = tenantSettings.default_ai_model;
    }

    const config = require('../config');
    const tunnelService = require('./tunnelService');
    const storeBase = tunnelService.getStoreUrl() || `http://localhost:${config.storePort || 3001}`;

    if (inst && inst.ai_enabled === 0) {
      const fallback = this.generateHeuristicConsultativeReply({
        profile, firstName, text, matchedProduct, nlpResult: (resolvedNlp || nlpResult),
        isMasterBot, tenantObj, tenantSettings, effectiveProducts, storeBase,
        isGroup, groupName, isWithinActiveWindow: activeWindow
      });
      this.recordDialogueTurn(cleanPhone, 'assistant', fallback);
      return fallback;
    }

    const isPureGreeting = /^(?:ol[aá]|oi\b|bom dia|boa tarde|boa noite|opa\b|salve\b|e a[ií]\b|fala\b)(?:[!?.\s]*)$/i.test(cleanText);
    const recentTurns = this.getRecentDialogueTurns(cleanPhone, 6);

    // Se for saudação pura mas o contato já está em conversa ativa há menos de 30 minutos:
    // NÃO saúda novamente ("ele só deve saudar novamente se mais de 30min inatividade")
    if (isPureGreeting && activeWindow && recentTurns.length > 0) {
      if (isGroup) {
        return `Tô por aqui! Pode falar.`;
      }
      if (wantsAudio) {
        const audioReply = `[AUDIO: Opa, tô por aqui! Pode falar que tô na escuta.]`;
        this.recordDialogueTurn(cleanPhone, 'assistant', audioReply);
        return audioReply;
      }
      const continuations = [
        `Opa, tô por aqui! Pode falar 👍`,
        `Na escuta! Ficou alguma dúvida sobre o que a gente tava conversando?`,
        `Tô por aqui! Em que posso te ajudar a respeito do que conversamos?`,
        `Opa, tô acompanhando! Pode mandar 😉`
      ];
      const reply = continuations[Math.floor(Math.random() * continuations.length)];
      this.recordDialogueTurn(cleanPhone, 'assistant', reply);
      return reply;
    }

    // Se for saudação pura inicial (> 30 min de inatividade ou primeiro contato absoluto):
    if (isPureGreeting && (recentTurns.length === 0 || !activeWindow)) {
      if (isGroup) {
        const rawName = (firstName || '').trim();
        const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(rawName);
        const namePart = (rawName && !isGeneric) ? ` ${rawName}` : '';
        const groupGreet = `Fala${namePart}! Tô na área por aqui no grupo. Qualquer coisa só me chamar!`;
        return groupGreet;
      }
      const { getBrasiliaGreeting } = require('../utils/dateTime');
      const saudacao = getBrasiliaGreeting().saudacao.toLowerCase();
      const rawName = (firstName || '').trim();
      const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(rawName);
      const cleanFirstNameGreet = (rawName && !isGeneric) ? `, ${rawName}` : '';
      if (wantsAudio) {
        const audioGreet = `[AUDIO: Opa${cleanFirstNameGreet}, ${saudacao}! Tudo bem? Como tão as coisas por aí?]`;
        this.recordDialogueTurn(cleanPhone, 'assistant', audioGreet);
        return audioGreet;
      }
      const humanGreetings = [
        `Opa${cleanFirstNameGreet}, ${saudacao}!\n\nTudo certo por aí?`,
        `Opa${cleanFirstNameGreet}! Tudo bem? 🙂\n\nComo tão as coisas por aí?`,
        `Fala aí${cleanFirstNameGreet}, ${saudacao}!\n\nTudo certo contigo?`
      ];
      const chosenGreeting = humanGreetings[Math.floor(Math.random() * humanGreetings.length)];
      this.recordDialogueTurn(cleanPhone, 'assistant', chosenGreeting);
      return chosenGreeting;
    }

    // Se for reciprocidade de cumprimento ("tudo bem e vc?", "tranquilo"): resposta humana leve
    const isReciprocalGreeting = /^(?:tudo bem|tudo bom|tudo certo|tranquilo|beleza|tudo [oó]timo|tudo na paz|tudo 100%?)(?:\s*(?:e\s*(?:voc[eê]|vc|contigo))|!|\.|\?)?$/i.test(cleanText);
    if (isReciprocalGreeting && recentTurns.length <= 2) {
      if (isGroup) {
        return `Tudo tranquilo por aqui também! O que manda de bom?`;
      }
      if (wantsAudio) {
        const audioReply = `[AUDIO: Tudo tranquilo por aqui também! E aí, o que manda de bom?]`;
        this.recordDialogueTurn(cleanPhone, 'assistant', audioReply);
        return audioReply;
      }
      const reply = `Tudo tranquilo por aqui também!\n\nE aí, o que manda de bom?`;
      this.recordDialogueTurn(cleanPhone, 'assistant', reply);
      return reply;
    }

    // Disparo imediato de áudios realistas da "Voz do Dono" nos momentos-chave de decisão (somente em privado)
    if (!isGroup && /(?:garantia|confi[aá]vel|[eé] seguro|seguran[cç]a|golpe|medo)/i.test(cleanText)) {
      const audioReply = `Opa, deixa eu te mandar um áudio que fica mais fácil de te explicar rapidinho:\n\n` +
        `[AUDIO: Pode ficar 100% em paz quanto a isso. Você tem 7 dias de garantia incondicional pela lei, o pagamento é processado com total segurança e o acesso cai na hora no seu WhatsApp e e-mail. Além disso o suporte é direto comigo aqui pra gente deixar tudo configurado e rodando junto com você.]\n\n` +
        `Qualquer dúvida pode me falar por aqui! 🙂`;
      this.recordDialogueTurn(cleanPhone, 'assistant', audioReply);
      return audioReply;
    }

    if (!isGroup && /(?:como funciona|como [eé] que funciona|como recebo|como roda|funciona como|como [eé] isso)/i.test(cleanText)) {
      const audioReply = `Deixa eu te mandar um áudio explicando certinho como funciona:\n\n` +
        `[AUDIO: Cara, funciona assim: assim que você fecha, o sistema já libera o seu acesso no mesmo segundo no seu WhatsApp e no seu e-mail. É super tranquilo e a gente te dá todo o suporte na hora de configurar.]\n\n` +
        `Deu pra entender a ideia? Qualquer coisa me avisa! 👍`;
      this.recordDialogueTurn(cleanPhone, 'assistant', audioReply);
      return audioReply;
    }

    if (!isGroup && /(?:desconto|cupom|mais barato|choro|descontinho|faz por menos|diminui)/i.test(cleanText)) {
      const audioReply = `Opa, peraí que eu te explico em áudio:\n\n` +
        `[AUDIO: Cara, vou fazer o seguinte pra gente fechar essa parceria hoje: consigo te liberar um desconto exclusivo de 10% no Pix se você for ativar agora. Deixa eu só gerar o link com essa condição pra você.]\n\n` +
        `Me dá um toque se for fechar agora que eu já gero a condição especial pra você! 👊`;
      this.recordDialogueTurn(cleanPhone, 'assistant', audioReply);
      return audioReply;
    }

    // Tenta enriquecer com IA mantendo a diretriz configurada para a conexão/bot ou tenant
    try {
      const memoryContext = memories
        .map(m => {
          let summary = String(m.fact_summary || '')
            .replace(/(?:master\s+bot|bot(?:\s+tenant[^\)]*\)?)?|atendente)\s+respondeu\s+via\s+[^\n]*/gi, 'Atendimento consultivo realizado')
            .replace(/(?:groq|qwen|llama|gemini|openai|claude|deepseek)/gi, '')
            .trim();
          return `- [${m.memory_type}]: ${summary}`;
        })
        .join('\n');
      const beliefsContext = beliefs.map(b => `- ${b.belief_key}: ${b.belief_value} (confiança: ${(b.confidence * 100).toFixed(0)}%)`).join('\n');

      let systemPrompt = '';

      if (isMasterBot) {
        // Formata catálogo de soluções da Matriz (PayBot / SpyBot / Software Sob Medida)
        // Filtra produtos legados de teste/nicho (Scalper, Sinais Cripto, Peças) para manter portfólio oficial
        const matrizOfficialProds = (effectiveProducts || []).filter(p => {
          if (!p || p.active === 0) return false;
          const n = (p.name || '').toLowerCase();
          const c = (p.category || '').toLowerCase();
          if (/scalper|sinais cripto|investimentos|freio|pastilha|embreagem|[oó]leo|turbina|pe[cç]a/i.test(n)) return false;
          if (/auto pe[cç]as|criptomoedas/i.test(c)) return false;
          return true;
        }).sort((a, b) => {
          const priority = [842, 1062, 1063, 1064, 848, 845, 844, 850, 849, 852];
          const idxA = priority.indexOf(a.id);
          const idxB = priority.indexOf(b.id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.id - b.id;
        });

        const topProds = matrizOfficialProds.slice(0, 8).map(p => {
          const pr = Number(p.price_brl || p.price).toFixed(2);
          return `- *${p.name}* (R$ ${pr})${p.description ? ': ' + p.description.slice(0, 90) : ''}`;
        }).join('\n');

        const webStoreTrackerService = require('./webStoreTrackerService');
        const trackedMaster = webStoreTrackerService.buildTrackedStoreUrl({
          phone: cleanPhone,
          name: firstName,
          instanceId: targetId || (isMasterBot ? 1 : 2),
          source: 'cognitive_sales',
          preferShort: true
        });
        const masterStoreUrl = trackedMaster.shortUrl || trackedMaster.url;

        const isCorrectionOrRejection = /(?:n[aã]o\s+tem\s+nada\s+(?:a|ha)ver|t[aá]\s+errado|est[aá]\s+errado|falei\s+que|eu\s+disse\s+que|eu\s+tenho\s+[eé]|o\s+que\s+isso\s+tem\s+(?:a|ha)ver|n[aã]o\s+sou\s+trader|n[aã]o\s+mexo\s+com\s+trader|nada\s+disso|viajou|errou\s+feio|t[aá]\s+doido|t[aá]\s+louco|insistindo)/i.test(text);

        const correctionDirective = isCorrectionOrRejection && !isDisinterest
          ? `\n🚨 CORREÇÃO CRÍTICA DO CONTATO (HUMILDADE & RETRATAÇÃO NATURAL):
O cliente acabou de sinalizar que você falou besteira ou ofereceu algo sem sentido (ex: produto trader/scalper quando ele tem papelaria ou loja física).
SUA RESPOSTA DEVE SER 100% HUMANA, NATURAL E HUMILDE (DIVIDIDA EM 2 A 3 BALÕES COM \\n\\n):
1º Balão: Peça desculpas com muita naturalidade e bom humor ("Pô, viajei total aqui haha desculpa aí!", "Nossa, viajei feio agora haha, foi mal!").
2º Balão: Confirme que entendeu perfeitamente o negócio real dele ("Entendi certinho agora: você tem uma papelaria e faz entregas rápidas (pede hoje, amanhã chega)!").
3º Balão: Explique de forma prática e direta como o PayBot WhatsApp atende a papelaria (atende quem chama pedindo material escolar ou escritório, manda o catálogo, recebe no Pix automático e já organiza as entregas do dia seguinte) e faça uma pergunta leve sobre a rotina dele.\n\n`
          : '';

        const chosenInstruction = (inst && inst.ai_instruction && inst.ai_instruction.trim())
          ? inst.ai_instruction.trim()
          : null;

        const storeCtx = models.getLeadStoreContext(cleanPhone);
        const storeIntentDirective = (storeCtx && (storeCtx.last_viewed_product_name || storeCtx.has_active_cart))
          ? `\n🎯 CONTEXTO EM TEMPO REAL DA VITRINE:
O lead visitou a vitrine online recentemente e demonstrou interesse direto no produto: "${storeCtx.last_viewed_product_name || 'Nossas Soluções'}"${storeCtx.cart_total ? ` (Carrinho ativo: R$ ${Number(storeCtx.cart_total).toFixed(2)})` : ''}.
DIRETRIZ DE VENDA PODEROSA (ALTA MARGEM):
O lead já viu o produto. Converse com naturalidade e autoridade comercial validando o cenário dele, tire dúvidas e apresente o Pix Copia e Cola imediato para ativação rápida!\n\n`
          : '';

        const voicePersonaService = require('./voicePersonaService');
        const activePersonaKey = models.getSetting('SALES_BOT_PERSONA', 'marcos');
        const activeEmotionKey = models.getSetting('SALES_BOT_EMOTION', 'consultivo');
        const audioPreferenceDirective = voicePersonaService.buildAudioPromptDirective({
          personaKey: activePersonaKey,
          emotionKey: activeEmotionKey,
          isMasterBot: true,
          wantsAudio: Boolean(wantsAudio && !isGroup)
        });

        systemPrompt =
          `Você é uma pessoa real conversando no WhatsApp (brasileiro, casual, tranquilo e despretensioso).\n` +
          `Você conversa com quem te chama de forma leve, sem formalismo e sem postura de "assistente prestativo" ou robô corporativo.\n\n` +
          `${audioPreferenceDirective}\n` +
          (storeIntentDirective ? `${storeIntentDirective}` : '') +
          (correctionDirective ? `${correctionDirective}` : '') +
          (disinterestDirective ? `${disinterestDirective}` : '') +
          (onboardingDirective ? `${onboardingDirective}` : '') +
          `POSTURA DESPRETENSISOSA & PSICOLOGIA CONVERSACIONAL:\n` +
          `1. NUNCA use frases com cara de bot como "Como posso te ajudar?", "Como posso ser útil?", "Em que posso te ajudar hoje?", "Seja bem-vindo", "Como posso colaborar?". Isso destrói a percepção humana.\n` +
          `2. NUNCA cite rastreamentos técnicos ("Vi que você olhou o catálogo", "Vi que visitou nossa vitrine"). Um humano real não fala isso, isso soa invasivo e robótico!\n` +
          `3. FASE 1 (ACOLHIMENTO DESPRETENSISOSO & DIAGNÓSTICO): No início, converse de forma despretensiosa, sem nenhuma intenção aparente de empurrar produtos. Deixe o contato guiar e faça perguntas leves e abertas para entender a real necessidade dele (ex: se busca automação de atendimento no WhatsApp, proteção de grupos, aplicativo/sistema sob medida ou algum produto específico da loja).\n` +
          `4. FASE 2 (CONSULTORIA PRECISA & MULTI-SOLUÇÕES): Somente após entender o que o cliente realmente precisa, apresente a solução adequada ao cenário DELE. PROIBIDO SER MONOTEMÁTICO: você NÃO vende apenas o plano anual do bot. Ofereça opções com naturalidade (mensal flexível, anual completo, bots de grupo ou desenvolvimento sob medida) e convide a conhecer a vitrine (${masterStoreUrl}) para detalhes.\n` +
          `5. RETENÇÃO MÁXIMA & FECHAMENTO (NÃO SE CONTER - ENVIAR ÁUDIO + IMAGEM + ESCOPO): Quando o cliente entrar a fundo no assunto, fizer perguntas técnicas, pedir preços ou estiver no momento de fechar, você NÃO DEVE SE CONTER! Use toda a sua inteligência comercial para segurar a atenção do lead e NÃO PERDER A VENDA:\n` +
          `   - ÁUDIO OBRIGATÓRIO [AUDIO: script falado]: O áudio quebra a frieza do texto e prende a atenção do lead com o play no WhatsApp. Fale como um consultor sênior, entusiasmado, prestativo e seguro (tom 10/10 de certeza de Jordan Belfort e empatia de Chris Voss). Explique a dinâmica prática e benefícios no dia a dia dele.\n` +
          `   - DEMONSTRAÇÃO VISUAL [IMAGEM: preset | legenda]: Tangibilize o valor com [IMAGEM: bot_vendas], [IMAGEM: bot_grupos], [IMAGEM: app_mobile] ou [IMAGEM: saas].\n` +
          `   - ESCOPO E ENTREGÁVEIS: Apresente o escopo claro (recursos inclusos, ativação imediata, 7 dias de garantia incondicional) e faça uma chamada para ação (CTA) direta e irresistível para fechar no Pix!\n` +
          `6. REGRA INVIOLÁVEL: NUNCA coloque cabeçalhos, títulos ou assinaturas do tipo "Bot respondeu via...", "[RESPOSTA DA IA]", "Atendente:", "Modelo:", "Via Groq/OpenAI/Gemini". NUNCA mencione o nome de nenhum modelo de IA, LLM ou provedor. Responda DIRETAMENTE como uma pessoa real no WhatsApp sem nenhum rótulo ou prefixo.\n` +
          `7. NUNCA SEJA CANSATIVO OU INSISTENTE: Não fique repetindo preços ou empurrando o mesmo produto em toda mensagem. Se o cliente perguntar de preços, apresente as opções de forma clara e consulte o interesse dele.\n` +
          `8. REGRA SUPREMA ANTI-REPETIÇÃO (MEMÓRIA ATIVA): NUNCA repita perguntas já feitas no histórico da conversa! Se você já perguntou qual plano cabe melhor, ou se tem operação rodando, ou o que ele precisa, NÃO repita essas perguntas. Se o cliente escolheu um plano (ex: "o mensal", "o de 69", "o anual", "automação", "papelaria", "sim"), confirme a escolha e passe os dados para ativação rápida no Pix sem novos diagnósticos.\n` +
          `9. REGRA CRÍTICA DE RESPEITO AO "NÃO" & DESINTERESSE: Se o cliente indicar com clareza que NÃO quer o produto, NÃO tem interesse, não precisa ou que não vai comprar: é TERMINANTEMENTE PROIBIDO insistir, empurrar o produto ou contornar! Aja com educação e elegância, agradeça cordialmente pelo tempo e atenção dele e encerre de forma desarmada e simpática.\n` +
          (activeWindow
            ? `8. REGRA INVIOLÁVEL DE SAUDAÇÕES (MENOS DE 30 MIN DE INATIVIDADE): O cliente já está conversando com você há poucos instantes. É TERMINANTEMENTE PROIBIDO iniciar sua resposta com saudações ("Olá", "Oi", "Opa", "Bom dia", "Boa tarde", "Boa noite", "Tudo bem?", "Como vai?"). Vá DIRETO ao ponto da resposta ou responda com continuidade natural ("Tô por aqui!", "Com certeza", "Então...", "Sobre isso..."). Somente cumprimente formalmente se o cliente tiver ficado mais de 30 minutos em silêncio absoluto.\n\n`
            : `8. SAUDAÇÃO APÓS INATIVIDADE (> 30 MIN): O contato ficou mais de 30 minutos sem interagir ou este é o primeiro contato. Você pode usar uma saudação leve e descontraída ("Opa ${firstName}, ${saudacao.toLowerCase()}!").\n\n`) +
          `SUAS PRINCIPAIS SOLUÇÕES OFICIAIS:\n` +
          `1. 🤖 *PayBot WhatsApp (Automação de Atendimento & Vendas)*: Atendimento e vendas 24/7 no WhatsApp, emissão de Pix instantâneo em 3s, catálogo e vitrine web integrada. Planos: Mensal flexível de entrada (R$ 69,90/mês) ou Licença Anual Completa (R$ 497/ano com vitrine inclusa e suporte VIP).\n` +
          `2. 🛡️ *Bot de Proteção & Moderação de Grupos*: Anti-trava, anti-link, anti-fake/estrangeiro, boas-vindas automáticas com imagem, banimento automático e jogos interativos. Planos: Mensal (R$ 49,90), Trimestral (R$ 119,90) ou Vitalício (R$ 299,00).\n` +
          `3. 💻 *Software Sob Medida & Aplicativos Mobile*: Criação de Aplicativos Mobile (Android/iOS sob medida a partir de R$ 4.500), Painéis Web & Plataformas SaaS (a partir de R$ 2.800), Agentes de IA Corporativos com RAG (a partir de R$ 1.800) e Landing Pages de Alta Conversão (a partir de R$ 1.200).\n` +
          `4. 🕵️ *SpyBot Pro & Exército de Sub-Bots (Multi-Chip)*: Anti-delete (revela mensagens apagadas no grupo e privado), anti-view-once (salva fotos e vídeos de visualização única), áudios humanizados gravados na hora e cluster de múltiplos números.\n` +
          `5. 🛍️ *Vitrine Online & Catálogo Geral*: ${masterStoreUrl}\n\n` +
          `PRODUTOS EM DESTAQUE NO CATÁLOGO MASTER:\n${topProds || 'Consulte nosso portfólio completo.'}\n\n` +
          (chosenInstruction ? `DIRETRIZ ADICIONAL DO COMANDANTE:\n${chosenInstruction}\n\n` : '') +
          `REGRAS DE FORMATAÇÃO E SPLIT DE MENSAGENS:\n` +
          `1. SPLIT DE TEXTOS OBRIGATÓRIO: Divida SEMPRE sua resposta em 2 ou 3 mensagens curtas separadas por duas quebras de linha (\\n\\n). Isso faz o WhatsApp enviar balões curtos separados, como humanos reais fazem no app.\n` +
          `2. Cada balão deve ter no máximo 1 a 2 frases curtas e diretas. Zero parágrafos longos, zero enrolação.\n` +
          `3. Use no máximo 1 ou 2 emojis discretos no total (ex: 🙂, 👍, 😉, 🚀, 👊).\n` +
          `4. NUNCA use clichês robóticos ("Com certeza!", "Hoje é seu dia de sorte!", "Como posso te ajudar?", "Excelente pergunta!", "Fique tranquilo", "Sensacional!", "Compreendo perfeitamente").\n` +
          `5. Se o cliente pedir preço, link ou quiser fechar: informe o valor com clareza e pergunte se prefere o código Pix Copia e Cola para ativação imediata ou o link da vitrine (${masterStoreUrl}).\n` +
          `6. Se disser que vai pensar: respeite com naturalidade e elegância, deixando a porta aberta com o link da vitrine.\n\n` +
          `DADOS COGNITIVOS DO LEAD:\n` +
          `- Nome: ${firstName || 'Cliente'}\n` +
          `- Nicho: ${profile.company_niche || 'Não identificado'}\n` +
          `- Interesse: ${profile.project_scope || 'Geral Tech'}\n` +
          `- Faixa de Orçamento: ${profile.budget_tier}\n` +
          `- Estágio: ${profile.buying_stage} | Objeção: ${profile.main_objection}\n` +
          `- Memórias Episódicas Recentes:\n${memoryContext || 'Primeira conversa.'}\n` +
          `- Crenças do Lead:\n${beliefsContext || 'Sem crenças registradas.'}\n\n`;

        if (phoneInfo && phoneInfo.isForeign) {
          systemPrompt +=
            `LOCALIZAÇÃO E IDIOMA DO CLIENTE (DANÇAR CONFORME A MÚSICA):\n` +
            `- País: ${phoneInfo.countryName} (${phoneInfo.flag}) | Código: +${phoneInfo.countryDDI}\n` +
            `- Idioma Nativo do País: ${phoneInfo.lang.toUpperCase()} | Moeda: ${phoneInfo.currency}\n` +
            `- Se o cliente se comunicar em ${phoneInfo.lang === 'en' ? 'inglês' : phoneInfo.lang === 'es' ? 'espanhol' : phoneInfo.lang} ou demonstrar preferência cultural, adapte suas respostas com maestria no idioma dele mantendo o tom consultivo e acolhedor.\n\n`;
        }

        // Injeta Táticas da Base de Conhecimento (65+ Obras de Hormozi, Belfort, Voss, Schwartz, etc.)
        const knowledgeBaseService = require('./knowledgeBaseService');
        const tacticalPlaybook = knowledgeBaseService.getContextualPlaybook({
          text,
          stage: profile.buying_stage,
          objection: profile.main_objection,
          intent: nlpResult?.intent,
          niche: profile.company_niche || 'vendedores',
          tone: 'consultivo',
          model: customModel,
          provider: preferredProvider
        });
        systemPrompt += tacticalPlaybook;
      } else {
        // Contexto específico do TENANT
        const tenantName = tenantObj ? tenantObj.name : 'Loja Oficial';
        const tenantSlug = tenantObj ? tenantObj.slug : '';
        const webStoreTrackerService = require('./webStoreTrackerService');
        const trackedTenant = webStoreTrackerService.buildTrackedStoreUrl({
          phone: cleanPhone,
          name: firstName,
          instanceId: targetId || 2,
          source: 'tenant_cognitive_sales',
          targetPath: `/loja/${tenantSlug}`,
          preferShort: true
        });
        const tenantStoreUrl = trackedTenant.shortUrl || trackedTenant.url;
        const upsellDiscount = tenantSettings?.upsell_discount_percent || 15;
        const tenantUpsellUrl = `${trackedTenant.url}&ref=upsell_whatsapp&upsell=1`;
        const tenantPixKey = tenantSettings?.pix_key || '';

        const tenantProdsList = (effectiveProducts || []).map(p => {
          const pr = Number(p.price_brl || p.price).toFixed(2);
          return `- *${p.name}* — R$ ${pr}${p.description ? ' (' + p.description.slice(0, 90) + ')' : ''}`;
        }).join('\n');

        const customInstruction = (inst && inst.ai_instruction && inst.ai_instruction.trim())
          ? inst.ai_instruction.trim()
          : (tenantSettings && tenantSettings.default_ai_instruction && tenantSettings.default_ai_instruction.trim() ? tenantSettings.default_ai_instruction.trim() : null);

        systemPrompt =
          `Você é o Consultor Comercial e Atendente Oficial da loja *${tenantName}* no WhatsApp.\n` +
          `Seu objetivo é atender os clientes com simpatia, agilidade, clareza e conduzir naturalmente para a compra dos produtos da loja.\n\n` +
          `CATÁLOGO EXCLUSIVO DE PRODUTOS DA ${tenantName.toUpperCase()}:\n` +
          `${tenantProdsList || 'Catálogo com produtos exclusivos da loja.'}\n\n` +
          `INFORMAÇÕES DA LOJA ONLINE:\n` +
          `- Vitrine Oficial: ${tenantStoreUrl}\n` +
          `- Link Especial VIP (${upsellDiscount}% de Desconto): ${tenantUpsellUrl}\n` +
          (tenantPixKey ? `- Chave Pix da Loja: ${tenantPixKey}\n` : '') +
          (tenantSettings?.welcome_message ? `- Boas-vindas da Loja: "${tenantSettings.welcome_message}"\n` : '') +
          (tenantSettings?.store_banner_text ? `- Destaque Promocional: "${tenantSettings.store_banner_text}"\n\n` : '\n') +
          (customInstruction ? `DIRETRIZES PERSONALIZADAS DO PROPRIETÁRIO DA LOJA:\n${customInstruction}\n\n` : '') +
          (disinterestDirective ? `${disinterestDirective}` : '') +
          (onboardingDirective ? `${onboardingDirective}` : '') +
          `REGRAS DE ATENDIMENTO E VENDAS HUMANIZADAS:\n` +
          `1. Você representa ESTRITAMENTE a ${tenantName}. Nunca mencione outros produtos ou empresas alheias.\n` +
          `2. Respostas curtas, acolhedoras, empáticas e naturais de WhatsApp (1 a 3 frases curtas).\n` +
          `3. Se o cliente perguntar preço ou produtos, informe exatamente os valores do catálogo acima e convide a visitar a loja web (${tenantStoreUrl}) ou pagar no Pix.\n` +
          `4. Se o cliente tiver dúvidas sobre um produto, explique com base na descrição e benefícios de forma clara e objetiva.\n` +
          `5. NUNCA use clichês robóticos ou instrua o cliente a 'digitar 1' ou 'enviar comandos'. Converse como uma pessoa real e prestativa.\n` +
          `6. Máximo de 1 emoji amigável opcional por mensagem.\n` +
          `7. REGRA INVIOLÁVEL: NUNCA coloque cabeçalhos, títulos ou assinaturas do tipo "Bot respondeu via...", "[RESPOSTA DA IA]", "Atendente:", "Modelo:", "Via Groq/OpenAI/Gemini". NUNCA mencione o nome de nenhum modelo de IA, LLM ou provedor. Responda DIRETAMENTE como uma pessoa real no WhatsApp sem nenhum rótulo ou prefixo.\n` +
          `8. REGRA SUPREMA ANTI-REPETIÇÃO: NUNCA repita perguntas já feitas no histórico. Se o cliente já perguntou preço ou tirou dúvida, conduza com agilidade para a compra no Pix ou visita à loja web sem fazer interrogatórios repetitivos.\n` +
          `9. REGRA CRÍTICA DE RESPEITO AO "NÃO" & DESINTERESSE: Se o cliente indicar que não quer o produto, não tem interesse ou não vai comprar, é PROIBIDO insistir. Agradeça cordialmente com simpatia, encerre a abordagem e deixe a porta aberta para o futuro sem constrangimento.\n` +
          (activeWindow
            ? `8. REGRA INVIOLÁVEL DE SAUDAÇÕES (MENOS DE 30 MIN DE INATIVIDADE): O cliente já está conversando com a loja há poucos instantes. É TERMINANTEMENTE PROIBIDO iniciar a resposta com saudações ("Olá", "Oi", "Boa tarde", "Tudo bem?"). Responda DIRETAMENTE à pergunta do cliente ou continue a conversa naturalmente. Somente cumprimente se o cliente estiver inativo há mais de 30 minutos.\n\n`
            : `8. SAUDAÇÃO APÓS INATIVIDADE (> 30 MIN): O contato ficou mais de 30 minutos sem interagir ou este é o primeiro contato. Você pode utilizar uma saudação calorosa e breve ("Olá ${firstName || ''}!").\n\n`) +
          `DADOS DO CLIENTE:\n` +
          `- Nome: ${firstName || 'Cliente'}\n` +
          `- Estágio: ${profile.buying_stage}\n` +
          `- Memórias:\n${memoryContext || 'Início de conversa.'}\n\n`;

        if (phoneInfo && phoneInfo.isForeign) {
          systemPrompt +=
            `LOCALIZAÇÃO E IDIOMA DO CLIENTE (DANÇAR CONFORME A MÚSICA):\n` +
            `- País: ${phoneInfo.countryName} (${phoneInfo.flag}) | Código: +${phoneInfo.countryDDI}\n` +
            `- Idioma Nativo do País: ${phoneInfo.lang.toUpperCase()} | Moeda: ${phoneInfo.currency}\n` +
            `- Se o cliente se comunicar em ${phoneInfo.lang === 'en' ? 'inglês' : phoneInfo.lang === 'es' ? 'espanhol' : phoneInfo.lang} ou demonstrar preferência cultural, responda com maestria no idioma dele mantendo o tom comercial e empático.\n\n`;
        }

        const tenantNiche = tenantObj?.niche || tenantSettings?.niche_key || 'vendedores';
        const tenantTone = tenantObj?.interaction_tone || tenantSettings?.interaction_tone || 'consultivo';

        const knowledgeBaseService = require('./knowledgeBaseService');
        const tacticalPlaybook = knowledgeBaseService.getContextualPlaybook({
          text,
          stage: profile.buying_stage,
          objection: profile.main_objection,
          intent: nlpResult?.intent,
          niche: tenantNiche,
          tone: tenantTone,
          model: customModel,
          provider: preferredProvider
        });
        systemPrompt += tacticalPlaybook;

        try {
          const nicheModularService = require('./nicheModularService');
          const nicheDirective = nicheModularService.buildNichePromptDirective(tenantNiche, tenantTone, {
            tenantName,
            firstName
          });
          if (nicheDirective) {
            systemPrompt += `\n${nicheDirective}\n`;
          }
        } catch (_) {}

        const voicePersonaService = require('./voicePersonaService');
        const tenantPersona = voicePersonaService.getPersonaForNiche(tenantNiche);
        const tenantAudioDirective = voicePersonaService.buildAudioPromptDirective({
          personaKey: tenantPersona.id,
          emotionKey: tenantTone === 'formal' ? 'consultivo' : (tenantTone === 'comercial' ? 'entusiasmado' : 'acolhedor'),
          nicheKey: tenantNiche,
          tenantName: tenantName,
          isMasterBot: false,
          wantsAudio: Boolean(wantsAudio && !isGroup)
        });
        systemPrompt += tenantAudioDirective;
      }

      if (isGroup) {
        systemPrompt +=
          `\n🚨 ATENÇÃO - CONVERSA DENTRO DE UM GRUPO DO WHATSAPP (${groupName || 'Grupo'}):\n` +
          `Você foi mencionado ou chamado em um GRUPO de WhatsApp por um membro (${firstName || 'Membro'}).\n` +
          `DIRETRIZES RÍGIDAS PARA GRUPOS:\n` +
          `1. Responda em UMA ÚNICA MENSAGEM CURTA (1 a 2 frases no máximo, máximo 30 palavras). NÃO use \\n\\n para separar balões múltiplos dentro do grupo.\n` +
          `2. NUNCA envie comandos, menus, códigos de barras, listas com marcadores ou textões no grupo.\n` +
          `3. Fale de forma natural, simpática e descontraída como qualquer membro humano participando do grupo.\n` +
          `4. Se a dúvida for sobre produtos, preços ou bots:\n` +
          `   - Dê a resposta direta e objetiva: temos bots de vendas/atendimento (mensal R$ 69,90 ou anual R$ 497), bots de proteção de grupos a partir de R$ 49,90/mês (ou vitalício R$ 299) e desenvolvimento de sistemas sob medida.\n` +
          `   - Convide gentilmente para chamar no privado se quiser ver uma demonstração ou detalhes, para não lotar a conversa do grupo!\n` +
          `5. Se for zoação, cumprimento ou papo casual: responda com bom humor, inteligência e leveza.\n`;
      }

      // Buffer recente de diálogo para coerência turn-by-turn já carregado em recentTurns

      let effectiveMatchedProduct = matchedProduct;
      if (isDisinterest || isConverted) {
        effectiveMatchedProduct = null;
      } else if (isMasterBot && effectiveMatchedProduct) {
        const prodNameLower = (effectiveMatchedProduct.name || '').toLowerCase();
        if (/scalper|sinais cripto|investimentos|pastilha|freio|pe[cç]a/i.test(prodNameLower)) {
          if (!/scalper|day\s*trade|trader|cripto|pe[cç]a/i.test(text.toLowerCase())) {
            effectiveMatchedProduct = null;
          }
        }
      }
      if (!isDisinterest && !isConverted && isMasterBot && !effectiveMatchedProduct) {
        if (/grupo|comunidade|anti-?trava|anti-?link|modera[cç][aã]o|gerenciar\s+grupo/i.test(text)) {
          effectiveMatchedProduct = { name: 'Bot de Proteção & Moderação de Grupos', price_brl: 49.90, category: 'Grupos' };
        } else if (/app|aplicativo|software|sistema|landing\s*page|site|pwa|desenvolvimento|sob\s*medida/i.test(text)) {
          effectiveMatchedProduct = { name: 'Desenvolvimento de Software & Aplicativos Sob Medida', price_brl: 1200.00, category: 'Sob Medida' };
        } else if (/papelaria|loja|vendas|entrega|atendimento|pedidos/i.test(text)) {
          effectiveMatchedProduct = { name: 'PayBot WhatsApp (Automação de Atendimento & Vendas)', price_brl: 69.90, category: 'Automação' };
        }
      }

      const userPrompt = isGroup
        ? `Mensagem recebida no grupo (${groupName || 'WhatsApp'}) de ${firstName || 'Membro'}: "${text}"\n` +
          `Produto detectado: ${effectiveMatchedProduct ? effectiveMatchedProduct.name + ' - R$ ' + (effectiveMatchedProduct.price_brl || effectiveMatchedProduct.price) : 'Nenhum'}\n` +
          `Gere UMA ÚNICA resposta curta, humana, natural e prestativa (1 a 2 frases curtas) para enviar no grupo:`
        : `Mensagem recebida do cliente: "${text}"\n` +
          `Produto sugerido ou detectado: ${effectiveMatchedProduct ? effectiveMatchedProduct.name + ' - R$ ' + (effectiveMatchedProduct.price_brl || effectiveMatchedProduct.price) : 'Nenhum'}\n` +
          `Histórico recente: ${recentTurns.length > 0 ? recentTurns.map(t => `${t.role === 'user' ? 'Cliente' : 'Consultor'}: ${t.content}`).join(' | ') : 'Primeiro contato'}\n` +
          (isDisinterest
            ? `🚨 O CLIENTE DECLAROU DESINTERESSE OU RECUSA! PROIBIDO FORÇAR A VENDA OU INSISTIR! Responda com elegância e cordialidade em 1 ou 2 frases curtas desarmadas, agradecendo pela atenção e deixando a porta aberta sem tentar vender nada:\n`
            : (isConverted
              ? `🚨 O CLIENTE JÁ É CONVERTIDO (CLIENTE ATIVO)! Atue exclusivamente como Consultor de Sucesso do Cliente (Customer Success & Onboarding). Auxilie na configuração, boas práticas ou tire dúvidas com empatia e presteza, sem empurrar vendas:\n`
              : (wantsAudio
                ? `🚨 O CLIENTE MANDOU ÁUDIO OU PREFERE ÁUDIO! Responda OBRIGATORIAMENTE POR ÁUDIO incluindo [AUDIO: seu script falado aqui]. ATENÇÃO: o texto dentro de [AUDIO: ...] SERÁ REPRODUZIDO COMO ÁUDIO FALADO NO WHATSAPP, então escreva exclusivamente em linguagem oral, sem asteriscos (*negrito*), sem emojis, sem marcadores e sem links! Se houver link ou chave Pix, envie a explicação no áudio e o link/chave em balão de texto separado logo abaixo:\n`
                : `Gere a resposta ideal para enviar no WhatsApp. Se o cliente estiver aprofundando ou interessado em comprar/conhecer a solução, NÃO SE CONTE: inclua áudio persuasivo [AUDIO: ...], demonstração visual [IMAGEM: ...] e escopo claro dos entregáveis com CTA direta, dividida em balões curtos separados por \\n\\n. LEMBRE-SE: o trecho dentro de [AUDIO: ...] será reproduzido como áudio falado real, por isso deve ser redigido pensando no ouvido (oralidade humana, zero asteriscos, zero emojis, zero links no áudio):\n`)));

      // Constrói mensagens garantindo alternância estrita de papéis (system -> user -> assistant -> user)
      // para 100% de compatibilidade sem erros 400 Bad Request em provedores como Google Gemini e Groq
      const chatMessages = [
        { role: 'system', content: systemPrompt }
      ];
      let lastRole = 'system';
      for (const turn of recentTurns) {
        if (!turn.content || (turn.role === 'user' && turn.content === text)) continue;
        const normalizedRole = turn.role === 'assistant' ? 'assistant' : 'user';
        if (normalizedRole === lastRole) {
          chatMessages[chatMessages.length - 1].content += '\n' + turn.content;
        } else {
          chatMessages.push({ role: normalizedRole, content: turn.content });
          lastRole = normalizedRole;
        }
      }
      if (lastRole === 'user') {
        chatMessages[chatMessages.length - 1].content += '\n\n' + userPrompt;
      } else {
        chatMessages.push({ role: 'user', content: userPrompt });
      }

      const aiResult = await aiManager.chat({
        messages: chatMessages,
        temperature: 0.65,
        maxTokens: 420,
        timeoutMs: 8500,
        preferredProvider,
        model: customModel,
        instanceId: inst ? inst.id : instanceId,
        subbotId: inst ? inst.id : subbotId,
        isMaster: isMasterBot
      });

      if (aiResult && aiResult.text && aiResult.text.trim()) {
        let finalHumanized = this.humanizeResponse(aiResult.text);
        if (activeWindow && !isPureGreeting) {
          finalHumanized = this.stripRedundantGreeting(finalHumanized);
        }
        finalHumanized = this.filterRepeatedQuestions(finalHumanized, cleanPhone, isGroup);
        this.recordDialogueTurn(cleanPhone, 'assistant', finalHumanized);

        models.addLeadEpisodicMemory(
          cleanPhone,
          'FEEDBACK',
          `Atendimento consultivo realizado com foco em ${profile.buying_stage}`,
          (text || '').slice(0, 100),
          2
        );

        // 🧠 ALIMENTA O NÚCLEO DE INTELIGÊNCIA COM O APRENDIZADO DESTE MODELO E NICHO
        try {
          const knowledgeBaseService = require('./knowledgeBaseService');
          const effectiveNiche = !isMasterBot ? (tenantObj?.niche || tenantSettings?.niche_key || 'vendedores') : (profile.company_niche || 'vendedores');
          const effectiveTone = !isMasterBot ? (tenantObj?.interaction_tone || tenantSettings?.interaction_tone || 'consultivo') : 'consultivo';
          
          knowledgeBaseService.feedFromInteraction({
            tenantId: tenantObj?.id || 1,
            niche: effectiveNiche,
            interaction_tone: effectiveTone,
            provider: aiResult.provider || preferredProvider || 'gemini',
            model: aiResult.model || customModel || 'default',
            leadPhone: cleanPhone,
            userInput: text,
            botResponse: finalHumanized,
            intent: nlpResult?.intent,
            objection: profile.main_objection,
            buyingStage: profile.buying_stage,
            source: isGroup ? 'whatsapp_group' : (isMasterBot ? 'whatsapp_master' : 'whatsapp_tenant')
          });
        } catch (_) {}

        return finalHumanized;
      }
    } catch (aiErr) {
      console.warn(`[CognitiveSales ⚠️ AI Fallback Lead +${cleanPhone}]:`, aiErr.stack || aiErr.message);
      // Fallback nativo imediato e robusto offline
    }

    // --- Motor Heurístico Consultivo Offline ---
    let fallback = this.generateHeuristicConsultativeReply({
      profile, firstName, text, matchedProduct, nlpResult: (resolvedNlp || nlpResult),
      isMasterBot, tenantObj, tenantSettings, effectiveProducts, storeBase,
      isGroup, groupName, isWithinActiveWindow: activeWindow
    });
    fallback = this.filterRepeatedQuestions(fallback, cleanPhone, isGroup);
    this.recordDialogueTurn(cleanPhone, 'assistant', fallback);

    try {
      const knowledgeBaseService = require('./knowledgeBaseService');
      const effectiveNiche = !isMasterBot ? (tenantObj?.niche || tenantSettings?.niche_key || 'vendedores') : (profile.company_niche || 'vendedores');
      const effectiveTone = !isMasterBot ? (tenantObj?.interaction_tone || tenantSettings?.interaction_tone || 'consultivo') : 'consultivo';
      knowledgeBaseService.feedFromInteraction({
        tenantId: tenantObj?.id || 1,
        niche: effectiveNiche,
        interaction_tone: effectiveTone,
        provider: 'heuristic_offline',
        model: 'cognitive_rules_engine',
        leadPhone: cleanPhone,
        userInput: text,
        botResponse: fallback,
        intent: nlpResult?.intent,
        objection: profile.main_objection,
        buyingStage: profile.buying_stage,
        source: isGroup ? 'whatsapp_group' : 'whatsapp_private'
      });
    } catch (_) {}

    return fallback;
  }

  // ==============================================================
  // 4. MOTOR HEURÍSTICO CONSULTIVO OFFLINE (RESILIENTE A FALHAS DE REDE)
  // ==============================================================
  generateHeuristicConsultativeReply(params) {
    const rawReply = this._generateHeuristicConsultativeReplyRaw(params);
    const { isWithinActiveWindow = false, isGroup = false, text = '', firstName = '' } = params || {};
    if (isGroup || !rawReply) return rawReply;

    if (isWithinActiveWindow) {
      // Inatividade < 30 min: NUNCA repete saudação formal de abertura
      return this.stripRedundantGreeting(rawReply);
    }

    // Inatividade > 30 min: Se o cliente iniciou com cumprimento, garante saudação amigável de retorno
    const clientStartedWithGreeting = /^(?:ol[aá]|oi\b|opa\b|salve\b|bom\s*dia|boa\s*(?:tarde|noite)|fala\b)/i.test((text || '').trim());
    if (clientStartedWithGreeting && !/^(?:ol[aá]|oi\b|opa\b|salve\b|bom\s*dia|boa\s*(?:tarde|noite)|fala\b)/i.test(rawReply.trim())) {
      let saudacao = 'boa tarde';
      try {
        const { getBrasiliaGreeting } = require('../utils/dateTime');
        saudacao = getBrasiliaGreeting().saudacao;
      } catch (_) {}
      const rawName = (firstName || '').trim();
      const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(rawName);
      const cleanFirstNameGreet = isGeneric ? '' : ` ${rawName}`;
      return `Opa${cleanFirstNameGreet}, ${saudacao.toLowerCase()}!\n\n${rawReply}`;
    }

    return rawReply;
  }

  _generateHeuristicConsultativeReplyRaw({
    profile, firstName, text, matchedProduct, nlpResult,
    isMasterBot = true, tenantObj = null, tenantSettings = null, effectiveProducts = [], storeBase = '',
    isGroup = false, groupName = '', isWithinActiveWindow = false
  }) {
    const rawName = (firstName || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|user|undefined|null)$/i.test(rawName);
    const cleanFirstName = isGeneric ? '' : `${rawName}, `;
    const cleanFirstNameGreet = isGeneric ? '' : ` ${rawName}`;
    const cleanPhone = profile?.phone;
    const stage = profile?.buying_stage || 'DESCOBERTA';
    const objection = profile?.main_objection || 'NENHUMA';
    const niche = profile?.company_niche || '';

    const webStoreTrackerService = require('./webStoreTrackerService');
    const targetPath = (!isMasterBot && tenantObj) ? `/loja/${tenantObj.slug}` : '/loja';
    const trackedConsultative = webStoreTrackerService.buildTrackedStoreUrl({
      phone: cleanPhone,
      name: rawName,
      source: 'cognitive_consultative',
      targetPath,
      preferShort: true
    });
    const effectiveStoreUrl = trackedConsultative.shortUrl || trackedConsultative.url;

    let saudacao = 'boa tarde';
    try {
      const { getBrasiliaGreeting } = require('../utils/dateTime');
      saudacao = getBrasiliaGreeting().saudacao;
    } catch (_) {}

    // Resposta para menção ou interação dentro de GRUPO (concisa, 1 mensagem única e sem menus)
    if (isGroup) {
      if (stage === 'CONVERTIDO' || nlpResult?.intent === 'CONFIRM_PURCHASE') {
        return `Show de bola${cleanFirstNameGreet}! Pagamento identificado, já já te chamo no privado com os acessos 👍`;
      }
      if (nlpResult?.intent === 'BUY_INTENT' || /(?:manda o link|passa o link|quero o link|link de compra|quero comprar agora|fechar agora)/i.test(text)) {
        return `Fechou${cleanFirstNameGreet}! Tá na mão o link oficial da nossa vitrine: ${effectiveStoreUrl} 🚀 Se precisar de ajuda na ativação, me chama no privado!`;
      }
      if (stage === 'PROPOSTA' || nlpResult?.intent === 'PRICE_QUERY' || /(?:quanto custa|qual o valor|pre[cç]o|tabela de pre[cç]os|quanto fica|valores)/i.test(text)) {
        if (matchedProduct) {
          const valBrl = Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2);
          const isAnnualBot = Number(matchedProduct.price_brl || matchedProduct.price) >= 400;
          if (isAnnualBot) {
            return `Fala${cleanFirstNameGreet}! O *${matchedProduct.name}* tá saindo por *R$ ${valBrl}/ano* (com suporte e vitrine inclusa) e também temos planos mensais de entrada. Me chama no pv pra eu te mostrar! 🙂`;
          }
          return `Fala${cleanFirstNameGreet}! O *${matchedProduct.name}* fica em *R$ ${valBrl}*. Me dá um toque no privado pra eu te passar os detalhes! 👍`;
        }
        return `Fala${cleanFirstNameGreet}! Temos planos de automação de vendas (mensal R$ 69,90 ou anual R$ 497) e bots de proteção de grupos a partir de R$ 49,90/mês (ou vitalício R$ 299). Me chama no pv pra gente ver o que melhor te atende! 👍`;
      }
      if (nlpResult?.intent === 'RENTAL_QUERY' || /(?:aluguel|alugar|proteger grupo|bot de grupo|modera[cç][aã]o)/i.test(text)) {
        return `Opa${cleanFirstNameGreet}! Pra proteção e moderação de grupos (anti-trava, anti-link e boas-vindas) temos planos a partir de R$ 49,90/mês. Me chama no privado que te passo a ativação! 🛡️`;
      }
      if (nlpResult?.intent === 'HOW_IT_WORKS' || /(?:como funciona|o que o bot faz|queria entender)/i.test(text)) {
        return `Opa${cleanFirstNameGreet}! O PayBot atende no WhatsApp 24h, emite Pix automático e gerencia pedidos na hora. Se quiser testar, dá um alô no pv pra não lotar o grupo! 🚀`;
      }
      if (nlpResult?.intent === 'GREETING' || /^(?:ol[aá]|oi\b|bom dia|boa tarde|boa noite|opa\b|salve\b)/i.test(text)) {
        return `Fala${cleanFirstNameGreet}! Tô na área por aqui no grupo, precisando é só marcar! 👍`;
      }
      return `Fala${cleanFirstNameGreet}! Na escuta por aqui no grupo. Se for sobre os bots ou precisar de algo, pode falar ou me chamar no privado!`;
    }

    // 0.0 Saudação pura ou retorno no privado (sem pergunta de negócio ou produto)
    const normalizedGreeting = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nonGreetingOnly = normalizedGreeting
      .replace(/\b(?:oi|ola|oie|oiee|opa|e\s*ai|eai|fala|salve|bom\s*dia|boa\s*(?:tarde|noite)|tudo\s*(?:bem|bom|certo|100%?|tranquilo|joia|otimo)|como\s*(?:vai|esta|ce\s*ta|voce\s*ta)|voce|vc|contigo|por\s*ai|por\s*aqui|blz|beleza|amigo|mano|ai|voltei|to\s*de\s*volta|estou\s*de\s*volta|to\s*aqui|estou\s*aqui|cheguei|retornei)\b/gi, '')
      .replace(/[^\w\s]/g, '')
      .trim();
    const isPureOrReturnGreeting = !isGroup && (nonGreetingOnly.length === 0 || nlpResult?.intent === 'GREETING');

    if (isPureOrReturnGreeting) {
      if (stage === 'CONVERTIDO') {
        return `Fala${cleanFirstNameGreet}! Tudo ótimo por aqui 👍\n\nComo tão rodando as coisas com o seu bot? Precisando de qualquer ajuste ou dúvida na operação, só me dar um toque que tô por aqui!`;
      }
      if (isWithinActiveWindow) {
        return `Opa, tô por aqui! Pode falar 👍`;
      }
      if (isMasterBot) {
        return `Opa${cleanFirstNameGreet}, ${saudacao.toLowerCase()}!\n\nTudo certo por aí?`;
      }
      return `Opa${cleanFirstNameGreet}, ${saudacao.toLowerCase()}!\n\nTudo bem por aí?`;
    }

    // 0. Detecção de Desinteresse / Recusa Explícita do Produto
    const isDisinterest = nlpResult?.intent === 'DISINTEREST' || /(?:n[aã]o\s+quero\s+(?:o\s+)?(?:produto|bot|servi[cç]o|plano|sistema|nada|isso|esse|essa|comprar)|n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+me\s+interessa|n[aã]o\s+preciso(?:\s+de\s+(?:bot|nada|isso|produto))?|n[aã]o\s+vou\s+querer|n[aã]o\s+vou\s+comprar|n[aã]o\s+[eé]\s+(?:o\s+que\s+)?(?:eu\s+)?procuro|pra\s+mim\s+n[aã]o\s+serve|n[aã]o\s+serve\s+pra\s+mim|n[aã]o\s+faz\s+sentido|n[aã]o\s+estou\s+interessad[oa]|obrigad[oa]\s+mas\s+n[aã]o|valeu\s+mas\s+n[aã]o|obrigado\s+n[aã]o\s+quero|valeu\s+n[aã]o\s+quero|t[oô]\s+de\s+boa|deixa\s+quieto|deixa\s+pra\s+l[aá]|n[aã]o\s+vou\s+fechar|n[aã]o\s+quero\s+gastar|pode\s+cancelar(?:\s+o\s+pedido)?|cancela\s+(?:o\s+pedido|a\s+compra)|n[aã]o\s+tenho\s+como\s+comprar|n[aã]o\s+tenho\s+interesse\s+em\s+comprar)/i.test(text);
    if (isDisinterest) {
      return `Entendido perfeitamente${cleanFirstNameGreet}! Sem problemas nenhum 👍\n\nMuito obrigado pelo retorno e pela atenção! Se em algum momento precisar de algo ou quiser tirar alguma dúvida, estamos à disposição por aqui. Sucesso nos seus projetos!`;
    }

    // 0.0 PÓS-VENDA & CUSTOMER SUCCESS: Cliente já CONVERTIDO (Onboarding Guiado)
    const isConverted = stage === 'CONVERTIDO';
    if (isConverted && !isDisinterest) {
      // Verifica se já está com missão interativa em andamento
      const currentOnboarding = this.getOnboardingState(cleanPhone);
      if (currentOnboarding && currentOnboarding.step !== 'COMPLETED') {
        return this.processInteractiveOnboarding(cleanPhone, text, firstName);
      }

      const wantsActionOnboarding = /(?:vamos|quero|ajuda\s+a|configur|cadastr|coloc)\s*(?:a\s*)?(?:chave\s*pix|o\s*pix|m[aã]o\s*na\s*massa|agora)/i.test(text);
      if (wantsActionOnboarding) {
        return this.processInteractiveOnboarding(cleanPhone, text, firstName);
      }

      const isAskingOnboarding = /(?:como\s+(?:\w+\s+){0,4}(?:configur|come[cç]|ativ|conect|us|adicion|cadastr|coloc)|configur|conect|ativar|cadastr|ajuda|suporte|d[uú]vida|passo\s+a\s+passo|tutorial|onde\s+(?:vejo|entro|acesso)|painel|login|senha|qr\s*code|chave\s+pix)/i.test(text);
      const isExpansionOrUpgrade = /(?:upgrade|outro\s+bot|mais\s+um|segundo\s+bot|novo\s+projeto|app\s+sob\s+medida|software|desenvolvimento)/i.test(text);

      if (isExpansionOrUpgrade) {
        return `Fala${cleanFirstNameGreet}! Que massa você querer expandir com a gente 🚀\n\n` +
          `Como você já é nosso cliente ativo, tem condição VIP exclusiva pra novas ativações ou desenvolvimento sob medida!\n\n` +
          `Me conta o que você tem em mente pra esse novo passo que já alinho tudo com prioridade pra você 👍`;
      }

      if (isAskingOnboarding || /(?:come[cç]ar|iniciar|primeiros\s+passos)/i.test(text)) {
        return `Opa${cleanFirstNameGreet}! Tô por aqui pra te guiar no que precisar 🚀\n\n` +
          `Aqui estão os passos principais pra deixar tudo rodando perfeitamente:\n\n` +
          `1️⃣ *Conectar seu WhatsApp:* Acesse seu painel e escaneie o QR Code na aba de Conexão.\n` +
          `2️⃣ *Cadastrar Catálogo & Produtos:* Na aba de Produtos, defina seus itens, descrições e valores.\n` +
          `3️⃣ *Vincular Chave Pix:* Insira sua chave Pix oficial nas configurações pra receber pagamentos automáticos na sua conta bancária.\n\n` +
          `💡 *Quer fazer o Onboarding Guiado (Mão na Massa) agora em 3 minutos direto por aqui?*\n` +
          `Só me responder com a sua *chave Pix* ou mandar *"vamos configurar"* que eu já vinculo e adiciono seu primeiro produto na hora! 🙂`;
      }

      // Cumprimento casual ou pergunta geral do cliente ativo
      if (isPureOrReturnGreeting || /(?:tudo\s+bem|como\s+vai|e\s+a[ií])/i.test(text)) {
        return `Fala${cleanFirstNameGreet}! Tudo ótimo por aqui 👍\n\nComo tão rodando as coisas com o seu bot? Precisando de qualquer ajuste ou dúvida na operação, só me dar um toque que tô por aqui!`;
      }

      return `Fala${cleanFirstNameGreet}! Tô por aqui à disposição. Como posso te auxiliar na sua operação hoje? Se precisar de ajuda com configuração, catálogo ou suporte, é só falar! 🙂`;
    }

    // 0.05 Geração Automática de Proposta Comercial B2B Sob Medida (Calculadora Dinâmica de Escopo)
    const isProposalRequest = !isDisinterest && (
      nlpResult?.intent === 'CUSTOM_SOFTWARE_QUERY' ||
      /(?:proposta|or[cç]amento\s+formal|quanto\s+custa\s+pra\s+(?:fazer|desenvolver)|me\s+manda\s+uma\s+proposta|monta\s+uma\s+proposta|gera\s+uma\s+proposta|quero\s+uma\s+proposta)/i.test(text)
    );

    if (isProposalRequest) {
      try {
        const proposalService = require('./proposalService');
        const dynamicScope = proposalService.calculateDynamicScope(text, profile);

        const proposal = proposalService.generateProposal(cleanPhone || '5500000000000', {
          lead_name: rawName || 'Cliente',
          ...dynamicScope
        });

        if (proposal && proposal.token) {
          const tunnelService = require('./tunnelService');
          const baseUrl = tunnelService.getStoreUrl() || storeBase || 'http://localhost:3001';
          const shareMsg = proposalService.generateWhatsAppShareMessage(proposal, baseUrl);

          if (cleanPhone) {
            models.upsertLeadCognitiveProfile(cleanPhone, {
              buying_stage: 'PROPOSTA',
              project_scope: proposal.project_title,
              readiness_score: 75
            });
            models.addLeadEpisodicMemory(cleanPhone, 'PROPOSAL', `Proposta comercial gerada: ${proposal.code} (${proposal.project_title}) - R$ ${proposal.investment_brl}`, text, 5);
          }

          return shareMsg;
        }
      } catch (pErr) {
        console.warn('[ProposalGeneration ⚠️ Erro]:', pErr.message);
      }
    }

    // 0.1 Detecção de Correção / Rejeição Enfática do Cliente (Nicho / Escopo)
    const isCorrectionOrRejection = /(?:n[aã]o\s+tem\s+nada\s+(?:a|ha)ver|t[aá]\s+errado|est[aá]\s+errado|falei\s+que|eu\s+disse\s+que|eu\s+tenho\s+[eé]|o\s+que\s+isso\s+tem\s+(?:a|ha)ver|n[aã]o\s+sou\s+trader|n[aã]o\s+mexo\s+com\s+trader|nada\s+disso|viajou|errou\s+feio|t[aá]\s+doido|t[aá]\s+louco|insistindo)/i.test(text);
    if (isCorrectionOrRejection) {
      const biz = niche || 'sua papelaria com entregas rápidas';
      const isPapelaria = /papelaria|livraria|escrit[oó]rio/i.test(biz) || /papelaria/i.test(text);
      if (isPapelaria) {
        return `Pô, viajei total aqui haha desculpa aí! 😅\n\n` +
          `Entendi certinho agora: você tem uma papelaria e faz entregas super rápidas (o cliente pede hoje e já recebe amanhã)!\n\n` +
          `O bot pra você é perfeito exatamente pra isso: ele recebe os pedidos dos materiais escolares e de escritório pelo WhatsApp, mostra o catálogo, cobra no Pix automático e já organiza os despachos do dia seguinte sem você perder tempo digitando tudo na mão 👍`;
      }
      return `Pô, viajei total aqui haha desculpa aí! 😅\n\n` +
        `Entendi certinho agora: o seu negócio é ${biz}!\n\n` +
        `O bot pra você é focado em atender seus clientes no WhatsApp, mostrar seus produtos, cobrar no Pix automático e organizar seus pedidos no automático 👍`;
    }

    // 0.1 Confirmação de Compra / Pagamento
    const isConfirmingPayment = nlpResult?.intent === 'CONFIRM_PURCHASE' || /(?:acabei de comprar|ja comprei|comprei pelo link|paguei pelo link|ja fiz o pix|ta pago|comprovante|pronto.*compr)/i.test(text);
    if (isConfirmingPayment) {
      return `Show de bola${cleanFirstNameGreet}! Já registrei seu aviso por aqui 👍\n\nAssim que o sistema compensar, seus dados e acessos chegam direto nessa conversa.\n\nSe tiver o comprovante da transação e quiser mandar aqui, já agiliza ainda mais a liberação!`;
    }

    // 0.2 Seleção de Plano / Escolha de Opção do Bot (Mensal, Anual, Vitalício)
    const isPlanChoice = /(?:quero\s*(?:o\s*)?)?(?:o\s*)?(?:plano\s*)?(?:mensal|anual|vital[ií]cio|trimestral|de\s*69(?:\b|,|9)|de\s*70|de\s*497|de\s*49(?:\b|,|9)|de\s*50|de\s*299|de\s*129|de\s*130|o\s*primeiro|o\s*segundo|o\s*1|o\s*2)\b/i.test(text) || nlpResult?.intent === 'PLAN_SELECTION';
    if (isPlanChoice) {
      const isMensal = /(?:mensal|69|70|primeiro|\b1\b)/i.test(text) && !/(?:grupo|aluguel\s+mensal|49|50)/i.test(text);
      const isAnual = /(?:anual|497|segundo|\b2\b)/i.test(text);
      const isVitalicio = /(?:vital[ií]cio|vitalicio|299)/i.test(text);

      if (isMensal) {
        return `Show de bola${cleanFirstNameGreet}! O plano mensal do *PayBot WhatsApp* fica em *R$ 69,90* no Pix 🚀\n\n` +
          `[AUDIO: Excelente escolha! O plano mensal de R$ 69,90 é perfeito pra você validar na prática. Assim que o Pix for aprovado, o sistema já libera suas credenciais na hora aqui no WhatsApp e você já começa a rodar seus atendimentos e vendas automáticas hoje mesmo.]\n\n` +
          `[IMAGEM: paybot | Acesso Reservado - Liberação Imediata]\n\n` +
          `📋 *RESUMO DO PEDIDO:*\n` +
          `• Item: *PayBot WhatsApp - Plano Mensal*\n` +
          `• Valor: *R$ 69,90* no Pix\n` +
          `• Liberação: Automática no WhatsApp em até 2 minutos\n` +
          `• Garantia: 7 dias incondicionais\n\n` +
          `Posso gerar o código Pix copia e cola pra liberar seu acesso agora? 😉`;
      }

      if (isAnual) {
        return `Sensacional${cleanFirstNameGreet}! A licença anual completa do *PayBot WhatsApp* fica em *R$ 497,00* no Pix 🚀\n\n` +
          `[AUDIO: Maravilha, excelente decisão! Na licença anual completa de R$ 497 você fica 12 meses sem mensalidades, tem a vitrine web completa integrada, emissão de Pix automático e suporte VIP direto comigo pra gente deixar tudo configurado.]\n\n` +
          `[IMAGEM: bot_vendas | Licença Anual Completa PayBot]\n\n` +
          `📋 *RESUMO DO PEDIDO:*\n` +
          `• Item: *PayBot WhatsApp - Licença Anual Completa*\n` +
          `• Valor: *R$ 497,00* no Pix\n` +
          `• Liberação: Automática no WhatsApp em até 2 minutos\n` +
          `• Garantia: 7 dias incondicionais\n\n` +
          `Posso gerar o código Pix copia e cola pra liberar seu acesso agora? 😉`;
      }

      if (isVitalicio) {
        return `Show de bola${cleanFirstNameGreet}! O plano vitalício do *Bot de Grupos* fica em *R$ 299,00* no Pix, sem mensalidades pra sempre 🛡️\n\n` +
          `[AUDIO: Excelente escolha! Com o vitalício de R$ 299 você protege seu grupo pra sempre contra travas, spam e invasores sem se preocupar com mensalidades.]\n\n` +
          `[IMAGEM: bot_grupos | Licença Vitalícia PayBot Grupos]\n\n` +
          `📋 *RESUMO DO PEDIDO:*\n` +
          `• Item: *Licença Vitalícia PayBot (Grupos WhatsApp)*\n` +
          `• Valor: *R$ 299,00* no Pix\n` +
          `• Liberação: Chave de ativação imediata no WhatsApp\n` +
          `• Garantia: 7 dias incondicionais\n\n` +
          `Posso gerar o código Pix copia e cola pra liberar seu acesso agora? 😉`;
      }
    }

    // 0.3 Resposta afirmativa / sinal verde ("sim", "pode mandar", "quero", "manda o pix", "gera aí", "fechado")
    const isAffirmative = /^(?:sim|quero|pode\s+(?:mandar|gerar|ser|fazer)|manda(?:\s+(?:a[ií]|aqui|o\s+pix|bala))?|gera(?:\s+(?:a[ií]|aqui|o\s+pix))?|passa(?:\s+(?:a[ií]|aqui|o\s+pix))?|fechado|bora|beleza|claro|com\s+certeza|topo|vamos\s+fechar)(?:[\s,]+(?:sim|quero|pode|mandar|gerar|ser|fazer|manda|gera|o\s+pix|bala|a[ií]|aqui|por\s+favor|pfv|amigo|bora|fechado))*[!?.\s]*$/i.test(text) || nlpResult?.intent === 'AFFIRMATIVE_CONFIRMATION';
    if (isAffirmative) {
      if (!matchedProduct && cleanPhone) {
        const recentTurns = (this.getRecentDialogueTurns(cleanPhone, 6) || []).slice().reverse();
        for (const t of recentTurns) {
          const content = t.content || '';
          if (/plano mensal|69[,.]90|o mensal/i.test(content)) {
            matchedProduct = (effectiveProducts || []).find(p => p.id === 2137) ||
              (effectiveProducts || []).find(p => !/(?:grupo|aluguel)/i.test(p.name) && (p.price_brl >= 65 && p.price_brl <= 75)) ||
              (effectiveProducts || []).find(p => /mensal.*(?:vendas|atendimento)/i.test(p.name) || /paybot.*mensal/i.test(p.name));
            break;
          } else if (/licen[cç]a anual|497|o anual/i.test(content)) {
            matchedProduct = (effectiveProducts || []).find(p => p.id === 842 || (p.price_brl >= 450 && p.price_brl <= 550));
            break;
          } else if (/vital[ií]cio|299/i.test(content)) {
            matchedProduct = (effectiveProducts || []).find(p => p.id === 1064 || p.price_brl === 299);
            break;
          }
        }
      }
      const prodName = matchedProduct ? matchedProduct.name : (isMasterBot ? 'PayBot WhatsApp (Plano Mensal)' : 'seu pedido');
      const prodPrice = matchedProduct ? `R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}` : 'R$ 69,90';
      return `Fechado${cleanFirstNameGreet}! Gerando seu código Pix Copia e Cola para *${prodName}* (*${prodPrice}*) agora mesmo... 🚀\n\nAssim que o pagamento compensar no banco, seu acesso é liberado no mesmo segundo aqui na conversa!`;
    }

    // 0.4 Esclarecimento de necessidade / Nicho trazido pelo cliente
    const isNeedClarification = /(?:automa[cç][aã]o|atendimento|vendas|papelaria|loja|delivery|ecommerce|e-commerce|mercado|clinica)/i.test(text) && !/(?:quanto|custa|pre[cç]o|valor|link)/i.test(text);
    if (isNeedClarification) {
      return `Perfeito${cleanFirstNameGreet}! Pra essa parte de automação de atendimento e vendas no WhatsApp, o PayBot é perfeito: atende seus clientes 24h por dia, envia catálogo com fotos e emite Pix automático em 3 segundos sem você perder tempo digitando na mão 👍\n\n` +
        `Temos o plano mensal de entrada (R$ 69,90) ou a licença anual completa (R$ 497). Qual das opções fica melhor pra você? 🙂`;
    }

    // 1. Pedido direto de compra / manda o link / Fechamento de Venda
    // Regra de Fechamento: Não se conter no fechamento (Áudio de boas-vindas + Imagem + Resumo do pedido + CTA Pix)
    if (nlpResult?.intent === 'BUY_INTENT' || /(?:manda o link|passa o link|quero o link|link de compra|quero comprar|fechar agora|vou querer|manda o pix)/i.test(text)) {
      if (!matchedProduct && cleanPhone) {
        const storeCtx = models.getLeadStoreContext(cleanPhone);
        if (storeCtx && storeCtx.last_viewed_product_id) {
          const viewed = models.getProductById(storeCtx.last_viewed_product_id);
          if (viewed && viewed.active) matchedProduct = viewed;
        }
      }
      const prodName = matchedProduct ? matchedProduct.name : (isMasterBot ? 'PayBot Vendas' : (tenantObj ? tenantObj.name : 'seu pedido'));
      const prodPrice = matchedProduct ? `R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}` : 'R$ 69,90';
      const upsellHint = (isMasterBot && matchedProduct && matchedProduct.upsell_product_id)
        ? `\n💡 _Dica de alta performance: fechando agora você ainda garante o pacote complementar com ${matchedProduct.upsell_discount_percent || 20}% OFF no combo exclusivo!_`
        : '';
      return `Fechou${cleanFirstNameGreet}! O valor do *${prodName}* fica em *${prodPrice}* no Pix 🚀\n\n` +
        `[AUDIO: Sensacional, excelente escolha! Acabei de separar seu acesso. Assim que o Pix for aprovado, o sistema já dispara suas credenciais na hora aqui no WhatsApp e você já começa a usar em menos de 2 minutos. Se tiver qualquer dúvida na hora de subir seus produtos ou configurar, me chama que eu te guio passo a passo!]\n\n` +
        `[IMAGEM: paybot | Acesso Reservado - Liberação Imediata]\n\n` +
        `📋 *RESUMO DO PEDIDO:*\n` +
        `• Item: *${prodName}*\n` +
        `• Valor: *${prodPrice}* no Pix\n` +
        `• Link da Loja: ${effectiveStoreUrl}\n` +
        `• Liberação: Automática no WhatsApp em até 2 minutos\n` +
        `• Garantia: 7 dias incondicionais\n\n` +
        `Posso gerar o código Pix copia e cola pra liberar seu acesso agora? 😉${upsellHint}`;
    }

    // 2. Pedido de mais informações / Como funciona / O que ele faz
    // Regra Humana: Quando o lead aprofunda para conhecer ou fechar a venda, NÃO SE CONTER (Áudio + Imagem + Escopo)
    const isAskingHowItWorks = nlpResult?.intent === 'HOW_IT_WORKS' || /(?:me conta mais|fala mais|como funciona|quero saber mais|explica mais|do que se trata|o que (?:ele|o bot) faz|queria entender)/i.test(text);
    if (isAskingHowItWorks) {
      if (isMasterBot) {
        if (niche) {
          const isPapelaria = /papelaria|livraria|escrit[oó]rio/i.test(niche) || /papelaria/i.test(text);
          const hasDelivery = /(?:entrega|pede hoje|chega amanh[aã]|delivery)/i.test(text);
          if (isPapelaria && hasDelivery) {
            return `Pô, pra uma papelaria com entrega rápida isso cai como uma luva!\n\n` +
              `[AUDIO: Cara, funciona assim: o cliente chama no WhatsApp pedindo material escolar ou de escritório, o bot atende em 3 segundos, manda o catálogo com fotos e preços, calcula o frete e manda o Pix Copia e Cola automático. Assim que o cliente paga, o sistema já confirma o pagamento no banco e deixa o pedido pronto pro seu despacho do dia seguinte, sem você perder tempo digitando tudo na mão.]\n\n` +
              `[IMAGEM: bot_vendas | Demonstração do Atendimento Automático e Catálogo da Papelaria]\n\n` +
              `📋 *ESCOPO & BENEFÍCIOS PRÁTICOS:*\n` +
              `• Atendimento automático 24h sem perder clientes na fila\n` +
              `• Emissão de Pix instantâneo em 3s com conciliação bancária\n` +
              `• Vitrine Web interativa sincronizada no link: ${effectiveStoreUrl}\n` +
              `• Suporte direto na configuração e 7 dias de garantia total!\n\n` +
              `Temos o plano mensal de teste (R$ 69,90) ou a licença anual completa (R$ 497). Qual das opções fica melhor pro seu momento? 🙂`;
          }
          return `Opa! No seu caso com ${niche}, a automação roda 24h por dia gerando vendas:\n\n` +
            `[AUDIO: Funciona de forma super simples e eficiente: o cliente te chama no WhatsApp com dúvida ou querendo comprar, o bot responde no mesmo segundo, apresenta suas opções, soma os valores e gera a cobrança Pix na hora. O cliente paga sozinho e você só recebe a notificação da venda no seu celular já confirmada, com suporte completo pra gente configurar tudo junto.]\n\n` +
            `[IMAGEM: bot_vendas | Painel de Vendas e Atendimento PayBot]\n\n` +
            `📋 *ESCOPO & RECURSOS DA AUTOMAÇÃO:*\n` +
            `• Atendimento rápido e humanizado no WhatsApp 24/7\n` +
            `• Pix Copia e Cola automático com confirmação imediata\n` +
            `• Vitrine online integrada para exibir seu catálogo\n` +
            `• Ativação rápida com garantia incondicional de 7 dias!\n\n` +
            `Temos o plano mensal de teste (R$ 69,90) e a licença anual completa (R$ 497). Quer que eu te mande o Pix de ativação de algum deles agora? 👍`;
        }
        const prodHighlight = matchedProduct ? `o *${matchedProduct.name}*` : 'a automação';
        return `Show de bola${cleanFirstNameGreet}! Deixa eu te explicar certinho como ${prodHighlight} funciona na prática:\n\n` +
          `[AUDIO: Cara, funciona assim: o bot assume todo o atendimento inicial no seu WhatsApp 24 horas por dia. Quando o lead te chama com dúvida ou querendo comprar, o robô responde na hora, tira as dúvidas, apresenta o catálogo de produtos e já gera a chave Pix Copia e Cola pra ele pagar sozinho. Você não perde nenhuma venda mesmo se estiver ocupado ou dormindo, e o acesso é liberado no mesmo segundo após o Pix com todo suporte da nossa equipe.]\n\n` +
          `[IMAGEM: bot_vendas | Demonstração do PayBot WhatsApp e Painel de Vendas]\n\n` +
          `📋 *ESCOPO & BENEFÍCIOS PRINCIPAIS:*\n` +
          `• Atendimento comercial 24/7 sem fila de espera\n` +
          `• Cobrança Pix integrada com baixa automática no banco em 3s\n` +
          `• Vitrine Web interativa sincronizada no link: ${effectiveStoreUrl}\n` +
          `• Configuração assistida passo a passo e 7 dias de garantia total!\n\n` +
          `Dá pra começar pelo plano mensal de teste (R$ 69,90) ou ativar a licença anual completa (R$ 497 com tudo incluso). Qual dessas opções cabe melhor pra você hoje? 🙂`;
      } else {
        return `Opa! Dá uma olhada nos detalhes e fotos direto na vitrine: ${effectiveStoreUrl}\n\n` +
          `[AUDIO: Qualquer dúvida sobre modelos, tamanhos ou formas de envio, pode me falar por aqui que eu te ajudo na hora a escolher a melhor opção!]\n\n` +
          `Você tá procurando algo pra você mesmo ou tem algum modelo em mente? 🙂`;
      }
    }

    // 2.1 Aluguel de Bot para Grupos (Master Bot)
    if (isMasterBot && (nlpResult?.intent === 'RENTAL_QUERY' || /(?:aluguel|bot para grupo|bot de grupo|proteger grupo|modera[cç][aã]o)/i.test(text))) {
      return `Opa! Pra gerenciar e proteger grupos o bot é uma máquina blindada 🛡️\n\n` +
        `[AUDIO: Cara, esse bot de grupos resolve uma das maiores dores de quem tem comunidade no WhatsApp. Ele fica monitorando 24 horas por dia: se alguém mandar link de spam, golpe ou trava de WhatsApp, ele apaga a mensagem em menos de um segundo e já bane o invasor na hora. Além disso, quando alguém entra ele manda uma imagem de boas-vindas personalizada com o avatar do membro e tem comandos completos de moderação como marcar todos, sorteio e advertência. O plano mensal é apenas R$ 49,90, trimestral R$ 119,90 ou você garante o vitalício por R$ 299 e fica protegido pra sempre sem mensalidade.]\n\n` +
        `[IMAGEM: bot_grupos | Painel de Moderação 24h & Proteção Anti-Trava de Grupos]\n\n` +
        `📋 *ESCOPO & RECURSOS DO BOT DE GRUPOS:*\n` +
        `• Anti-trava, anti-spam e anti-link com auto-delete e auto-ban em milissegundos\n` +
        `• Boas-vindas personalizadas com foto de perfil do novo membro\n` +
        `• Bloqueio automático de DDI estrangeiro / números fakes (+1, +234...)\n` +
        `• Comandos de moderação: !hidetag, !marcar, !ban, !sorteio, !fechar\n` +
        `• Ativação instantânea por chave de 8 dígitos no privado!\n\n` +
        `💳 *Investimento:* Mensal R$ 49,90 | Trimestral R$ 119,90 | Vitalício R$ 299,00.\n\n` +
        `Quer que eu te mande o Pix do plano mensal (R$ 49,90) ou já prefere fechar o vitalício pra não ter mensalidades? 👍`;
    }

    // 2.2 Software Sob Medida (Master Bot)
    if (isMasterBot && (nlpResult?.intent === 'CUSTOM_SOFTWARE_QUERY' || /(?:software sob medida|sistema sob medida|\b(?:app|apps)\b(?!.*whatsapp)|aplicativo|mobile|painel web|desenvolvem?)/i.test(text.replace(/whatsapp/gi, '')))) {
      return `Desenvolvemos soluções completas de alta performance sob medida 💻\n\n` +
        `[AUDIO: Fala parceiro! A nossa equipe desenvolve desde aplicativos mobile nativos pra Android e iOS, até plataformas web completas, SaaS com painel administrativo e integrações avançadas de inteligência artificial. A gente cuida de tudo: desde o design no Figma, desenvolvimento do backend e banco de dados, até a publicação oficial na Google Play e App Store com código auditado e garantia técnica pós-entrega. Projetos de landing page começam em R$ 1.200, sistemas web a partir de R$ 2.800 e apps completos a partir de R$ 4.500.]\n\n` +
        `[IMAGEM: app_mobile | Desenvolvimento de Apps Mobile Android/iOS & Painéis Web]\n\n` +
        `📋 *ESCOPO DE PROJETO SOB MEDIDA:*\n` +
        `• UI/UX moderno e responsivo no Figma antes de programar\n` +
        `• Desenvolvimento nativo (Android + iOS) ou Web SaaS Full-Stack\n` +
        `• Integração de banco de dados, APIs e gateways de pagamento (Pix/Cartão)\n` +
        `• Publicação nas lojas oficiais e documentação técnica completa\n` +
        `• Suporte e garantia técnica após a entrega\n\n` +
        `💳 *Investimento:* Landing Pages R$ 1.200 | Web Apps R$ 2.800 | Apps Mobile a partir de R$ 4.500.\n\n` +
        `Me conta um pouquinho das funções que você precisa pro seu projeto que já te passo uma estimativa de prazo e orçamento certinha! 👊`;
    }

    // 3. Objeção de Preço
    if (objection === 'PRECO' || nlpResult?.intent === 'DISCOUNT_QUERY') {
      return `Saquei perfeitamente. A gente consegue modular a condição pra você começar com o essencial e o investimento se pagar logo no início.\n\nQual parte da automação é mais urgente pra sua operação hoje? 👍`;
    }

    // 4. Objeção de Prazo
    if (objection === 'PRAZO' || /(?:prazo|adiantar|cronograma|sprint|dias úteis)/i.test(text)) {
      return `Entendi! Conseguimos priorizar o cronograma e o prazo da sua implantação pra você já começar a rodar em pouquíssimo tempo.\n\nPra quando você precisa desse prazo ativo na sua operação? 🙂`;
    }

    // 5. Objeção de Garantia & Confiança (Resposta com Áudio do Dono)
    if (objection === 'CONFIANCA_GARANTIA' || nlpResult?.intent === 'TRUST_AND_GUARANTEE' || /(?:garantia|confi[aá]vel|[eé] seguro|seguran[cç]a|golpe|medo)/i.test(text)) {
      return `Opa, pode ficar totalmente em paz! Deixa eu te explicar certinho como garantimos sua segurança:\n\n` +
        `[AUDIO: Pode ficar 100% em paz quanto a isso. Você tem 7 dias de garantia incondicional pela lei, o pagamento é processado com total segurança e o acesso cai na hora no seu WhatsApp e e-mail. Além disso o suporte é direto comigo aqui pra gente deixar tudo configurado e rodando junto com você. O risco pro seu lado é zero absoluto.]\n\n` +
        `[IMAGEM: garantia | Compra Segura, Ativação Imediata & 7 Dias de Garantia Total]\n\n` +
        `📋 *COMPROMISSO DE SEGURANÇA BLINDADA:*\n` +
        `• 7 dias de garantia incondicional (satisfação total ou 100% de reembolso)\n` +
        `• Pagamento instantâneo via Pix com comprovante e conciliação imediata\n` +
        `• Ativação automática em segundos após a confirmação\n` +
        `• Suporte dedicado direto aqui no WhatsApp para configuração\n\n` +
        `Qualquer dúvida pode me falar por aqui! Posso te gerar a chave Pix pra gente já liberar seu acesso agora? 🙂`;
    }

    // 5.1 Pergunta de Funcionamento Geral (Resposta com Áudio do Dono)
    if (/(?:como funciona|como [eé] que funciona|como recebo|como roda|funciona como|como [eé] isso)/i.test(text)) {
      return `Deixa eu te mandar um áudio explicando certinho como funciona:\n\n` +
        `[AUDIO: Cara, funciona assim: assim que você fecha, o sistema já libera o seu acesso no mesmo segundo no seu WhatsApp e no seu e-mail. É super tranquilo e a gente te dá todo o suporte na hora de configurar.]\n\n` +
        `Deu pra entender a ideia? Qualquer coisa me avisa! 👍`;
    }

    // 5.2 Pedido de Desconto / Cupom (Resposta com Áudio do Dono)
    if (/(?:desconto|cupom|mais barato|choro|descontinho|faz por menos|diminui)/i.test(text)) {
      return `Opa, peraí que eu te explico em áudio:\n\n` +
        `[AUDIO: Cara, vou fazer o seguinte pra gente fechar essa parceria hoje: consigo te liberar um desconto exclusivo de 10% no Pix se você for ativar agora. Deixa eu só gerar o link com essa condição pra você.]\n\n` +
        `Me dá um toque se for fechar agora que eu já gero a condição especial pra você! 👊`;
    }

    // 6. Fechamento & Pagamento
    if (stage === 'FECHAMENTO' || nlpResult?.intent === 'PAYMENT_PIX') {
      const prodName = matchedProduct ? matchedProduct.name : (isMasterBot ? 'PayBot Vendas' : 'seu pedido');
      const prodPrice = matchedProduct ? `R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}` : 'R$ 69,90';
      return `Fechou${cleanFirstNameGreet}! O valor do *${prodName}* fica em *${prodPrice}* no Pix 🚀\n\n` +
        `[AUDIO: Sensacional, excelente escolha! Acabei de separar seu acesso. Assim que o Pix for aprovado, o sistema já dispara suas credenciais na hora aqui no WhatsApp e você já começa a usar em menos de 2 minutos. Se tiver qualquer dúvida na hora de subir seus produtos ou configurar, me chama que eu te guio passo a passo!]\n\n` +
        `[IMAGEM: paybot | Acesso Reservado - Liberação Imediata]\n\n` +
        `📋 *RESUMO DO PEDIDO:*\n` +
        `• Item: *${prodName}*\n` +
        `• Valor: *${prodPrice}* no Pix\n` +
        `• Liberação: Automática no WhatsApp em até 2 minutos\n` +
        `• Garantia: 7 dias incondicionais\n\n` +
        `Posso gerar o código Pix copia e cola pra liberar seu acesso agora?`;
    }

    // 7. Apresentação de Proposta & Preço
    if (stage === 'PROPOSTA' || nlpResult?.intent === 'PRICE_QUERY' || /(?:quanto custa|qual o valor|pre[cç]o|tabela de pre[cç]os|quanto fica|valores)/i.test(text)) {
      if (!matchedProduct && cleanPhone) {
        const storeCtx = models.getLeadStoreContext(cleanPhone);
        if (storeCtx && storeCtx.last_viewed_product_id) {
          const viewed = models.getProductById(storeCtx.last_viewed_product_id);
          if (viewed && viewed.active) matchedProduct = viewed;
        }
      }
      if (matchedProduct) {
        const valBrl = Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2);
        const isAnnualBot = Number(matchedProduct.price_brl || matchedProduct.price) >= 400;
        if (isAnnualBot) {
          return `O investimento na licença anual do *${matchedProduct.name}* fica em *R$ ${valBrl}* com suporte completo e atualizações por 12 meses 🚀\n\n` +
            `[AUDIO: Fala parceiro! Esse valor de R$ ${valBrl} é referente à licença anual completa, que já inclui a vitrine web integrada, emissão de Pix instantâneo e suporte direto comigo pra gente deixar tudo configurado e rodando. Mas se você quiser validar primeiro antes de dar esse passo, a gente também tem o plano mensal de entrada por R$ 69,90. É ativação na hora!]\n\n` +
            `[IMAGEM: bot_vendas | Licença Anual Completa PayBot]\n\n` +
            `📋 *ESCOPO INCLUSO:*\n` +
            `• Licença anual com atualizações e suporte VIP\n` +
            `• Vitrine Web interativa sincronizada\n` +
            `• Emissão de Pix instantâneo em 3s\n` +
            `• 7 dias de garantia total incondicional\n\n` +
            `Quer dar uma olhada na vitrine ou prefere o Pix direto por aqui pra gente já ativar? 🙂`;
        }
        return `O investimento para o *${matchedProduct.name}* fica em *R$ ${valBrl}* com suporte e entrega completa 👍\n\n` +
          `[AUDIO: O acesso cai na hora assim que o Pix compensa e a gente te dá todo o suporte na hora de configurar e rodar. Se quiser, já gero o Pix pra você ativar agora!]\n\n` +
          `[IMAGEM: paybot | Detalhes do Produto & Ativação]\n\n` +
          `Prefere o link da loja (${effectiveStoreUrl}) ou posso gerar a chave Pix pra você por aqui?`;
      }
      if (isMasterBot) {
        return `Temos opções ideais pra cada tipo de necessidade e tamanho de operação:\n\n` +
          `[AUDIO: Fala amigo! Sobre os investimentos: a gente tem opções bem flexíveis pra você já começar a faturar hoje. Pra automação de atendimento e vendas no WhatsApp, temos o plano mensal de teste por R$ 69,90 pra você validar na prática, e a licença anual completa por R$ 497 com vitrine inclusa e suporte VIP. Se for bot pra grupos, fica a partir de R$ 49,90 no mês ou vitalício por R$ 299. E se precisar de aplicativo ou sistema sob medida, a gente desenvolve a partir de R$ 1.200. É ativação imediata logo após o Pix e você tem 7 dias de garantia total.]\n\n` +
          `[IMAGEM: paybot | Tabela Oficial de Planos e Soluções Tecnológicas]\n\n` +
          `📋 *PORTFÓLIO & ESCOPO DE PLANOS:*\n` +
          `• *Automação de Atendimento & Vendas:* plano mensal de teste (R$ 69,90) ou a licença anual completa com vitrine (R$ 497).\n` +
          `• *Gerenciamento & Proteção de Grupos:* a partir de R$ 49,90/mês ou vitalício por R$ 299.\n` +
          `• *Projetos & Software Sob Medida (Apps/Web/IA):* a partir de R$ 1.200.\n\n` +
          `Dá uma olhada no catálogo completo na nossa vitrine: ${effectiveStoreUrl}\n\n` +
          `Qual dessas áreas faz mais sentido pro seu momento? Se quiser, já te mando o Pix pra gente ativar agora! 🚀`;
      }
      if (effectiveProducts && effectiveProducts.length > 0) {
        const top = effectiveProducts.slice(0, 3).map(p => `• *${p.name}*: R$ ${Number(p.price_brl || p.price).toFixed(2)}`).join('\n');
        return `Aqui estão alguns dos nossos produtos em destaque:\n${top}\n\nVocê também pode ver o catálogo completo na nossa loja: ${effectiveStoreUrl}\n\nQual deles te interessou mais? 🙂`;
      }
      return `Nossos produtos variam conforme o modelo escolhido.\n\nVocê pode conferir a tabela completa na nossa vitrine: ${effectiveStoreUrl}\n\nMe conta o que você procura pra eu te orientar! 👍`;
    }

    // 8. Saudação pura (Despretensiosa, sem oferecer ajuda robótica)
    if (nlpResult?.intent === 'GREETING' || /^(?:ol[aá]|oi\b|bom dia|boa tarde|boa noite|opa\b|salve\b)/i.test(text)) {
      if (isWithinActiveWindow && !isGroup) {
        return `Opa, tô por aqui! Pode falar 👍`;
      }
      if (isMasterBot) {
        return `Opa${cleanFirstNameGreet}, ${saudacao.toLowerCase()}!\n\nTudo certo por aí?`;
      }
      return `Opa${cleanFirstNameGreet}, ${saudacao.toLowerCase()}!\n\nTudo bem por aí?`;
    }

    // 8.1 Resposta à reciprocidade de cumprimento ("tudo bem e vc?", "tranquilo", "tudo certo")
    if (/^(?:tudo bem|tudo bom|tudo certo|tranquilo|beleza|tudo [oó]timo|tudo na paz|tudo 100%?)(?:\s*(?:e\s*(?:voc[eê]|vc|contigo))|!|\.|\?)?$/i.test(text.trim())) {
      return `Tudo tranquilo por aqui também!\n\nE aí, o que manda de bom?`;
    }

    // 9. Reunião de conteúdo do lead & Diagnóstico Consultivo
    // Deixa o contato guiar e obtém informações; só propõe soluções após entender a real necessidade!
    const beliefs = cleanPhone ? models.getLeadBeliefs(cleanPhone) : [];
    const hasNiche = beliefs.some(b => b.belief_key === 'niche') || (Boolean(niche) && niche !== 'Geral' && niche !== 'Geral / Tech' && niche !== 'Não especificado');
    const hasOperation = beliefs.some(b => b.belief_key === 'operation_status');
    const hasPain = beliefs.some(b => b.belief_key === 'main_pain');

    // 9.1 Diagnóstico de Site, PageSpeed ou SEO (Cliente enviou link ou perguntou de velocidade)
    const websiteAuditService = require('./websiteAuditService');
    const detectedSiteUrl = websiteAuditService.extractUrlFromText(text);
    const isSiteAuditQuery = detectedSiteUrl || /(?:pagespeed|lighthouse|site lento|velocidade do site|otimizar site|melhorar site|seo do site|auditoria de site|analisar meu site|minha loja tá lenta)/i.test(text);

    if (isSiteAuditQuery) {
      let targetDomain = 'seu site';
      try {
        if (detectedSiteUrl) {
          targetDomain = new URL(detectedSiteUrl).hostname;
        }
      } catch (_) {}

      if (detectedSiteUrl) {
        return `Opa! Rodei a auditoria oficial do Google no *${targetDomain}* 🚀\n\n` +
          `[AUDIO: Fala amigo! Acabei de rodar um raio-x técnico completo no link ${targetDomain} através do Google PageSpeed e da nossa ferramenta de auditoria de performance. Deu pra mapear certinho os gargalos de imagens pesadas, scripts bloqueantes e SEO que derrubam o posicionamento no Google. A gente consegue colocar esse site com nota verde acima de 90 em 48 horas com garantia total. Dá uma olhada no diagnóstico que preparei pra você!]\n\n` +
          `[IMAGEM: pagespeed | Diagnóstico Técnico Google PageSpeed & SEO - ${targetDomain}]\n\n` +
          `📊 *PONTOS PRINCIPAIS DE DIAGNÓSTICO (${targetDomain}):*\n` +
          `• *Google PageSpeed (Mobile):* Análise de Core Web Vitals (LCP, TTFB e FCP)\n` +
          `• *SEO Técnico:* Rastreabilidade de tags Title, Meta Description e Open Graph\n` +
          `• *Segurança & SSL:* Criptografia HTTPS e proteção contra ataques\n` +
          `• *Pixels & Conversão:* Verificação de Meta Pixel e botão direto de WhatsApp\n\n` +
          `🛠️ *SOLUÇÃO DISPONÍVEL:* Otimização de Performance Web (PageSpeed 90+ & Core Web Vitals) a partir de R$ 800,00 com entrega em 48h e garantia incondicional de 7 dias!\n\n` +
          `Quer que eu te mande o escopo completo pra gente já deixar seu site voando? 🙂`;
      }

      return `Show de bola! A gente faz auditoria e otimização completa de sites e e-commerces 💻\n\n` +
        `[AUDIO: Opa! A gente tem uma ferramenta avançada que roda o raio-x oficial do Google PageSpeed, avalia Core Web Vitals, imagens pesadas, SEO técnico e segurança do seu site na hora. Se você quiser, me manda o link do seu site aqui na conversa que eu já puxo a análise completa pra gente ver os pontos de melhoria!]\n\n` +
        `[IMAGEM: site_portal | Auditoria de Performance & SEO]\n\n` +
        `Me passa o link do seu site ou loja aqui que eu já puxo a pontuação dele no Google PageSpeed e vejo o que dá pra melhorar pra você! 👍`;
    }

    // 9.2 Interesse em Proteção e Gerenciamento de Grupos
    const isGroupInterest = /grupo|comunidade|anti-?trava|anti-?link|modera[cç][aã]o|gerenciar\s+grupo|participante|membro/i.test(text) || (niche && /grupo|comunidade/i.test(niche));
    if (isGroupInterest) {
      return `Pô, pra gerenciar e proteger grupos isso é uma tranquilidade gigante!\n\n` +
        `[AUDIO: Opa! Cara, o bot de grupos funciona 100% no automático: ele barra travas, apaga links de spam, dá boas-vindas com imagem personalizada e modera os membros sem você precisar ficar de olho o tempo todo. Temos planos a partir de R$ 49,90 no mês ou vitalício por R$ 299.]\n\n` +
        `[IMAGEM: bot_grupos | Painel de Moderação 24h & Proteção Anti-Trava de Grupos]\n\n` +
        `📋 *ESCOPO DO BOT DE GRUPOS:*\n` +
        `• Anti-trava e anti-spam imediato (apaga e bane invasores)\n` +
        `• Boas-vindas com avatar do novo participante\n` +
        `• Bloqueio automático de DDI estrangeiro / fake\n` +
        `• Comandos completos de administração e sorteios\n` +
        `• Ativação instantânea por chave de 8 dígitos!\n\n` +
        `Quer que eu te mande o Pix de ativação agora ou prefere tirar mais alguma dúvida? 👍`;
    }

    // Se o contato ainda não revelou o que faz ou precisa: despretensioso, obtendo diagnóstico aberto
    if (!hasNiche && !hasOperation && !hasPain) {
      const recentQuestions = this.getRecentQuestionsAsked(cleanPhone);
      if (recentQuestions.includes('DIAGNOSTIC_NEED') || recentQuestions.includes('OPERATION_STATUS')) {
        return `Tô por aqui pra te ajudar no que você precisar! Dá uma olhada no catálogo completo na nossa vitrine: ${effectiveStoreUrl}\n\nSe quiser ver um modelo ou tirar qualquer dúvida, só me falar! 👍`;
      }
      return `Massa!\n\nMe conta: o que você tá precisando resolver no momento? É automação de atendimento no WhatsApp, proteção/gerenciamento de grupo, criação de algum sistema/app sob medida ou viu algum produto específico da loja?`;
    }

    // 9.2 Interesse em Desenvolvimento Sob Medida / Apps / Sistemas
    const isDevInterest = /app|aplicativo|software|sistema|landing\s*page|site|pwa|desenvolvimento|sob\s*medida|ia\s*corporativa/i.test(text);
    if (isDevInterest) {
      return `Show de bola! Nós desenvolvemos soluções tecnológicas sob medida de ponta a ponta.\n\n` +
        `[AUDIO: A gente desenvolve aplicativos nativos pra Android e iOS, painéis web completos e automações inteligentes com IA. Me conta um pouquinho de como você imaginou esse projeto pra eu te passar uma estimativa certinha.]\n\n` +
        `[IMAGEM: app_mobile | Desenvolvimento de Apps Mobile Android/iOS & Painéis Web]\n\n` +
        `📋 *ESCOPO & METODOLOGIA SOB MEDIDA:*\n` +
        `• Design UI/UX profissional no Figma\n` +
        `• Desenvolvimento nativo (Android/iOS) ou Web SaaS\n` +
        `• Integração de pagamentos Pix/Cartão e APIs\n` +
        `• Publicação nas lojas oficiais e suporte técnico pós-entrega\n\n` +
        `Você já tem o escopo desenhado ou tá começando a estruturar a ideia agora? 😉`;
    }

    // 9.3 Papelaria / Delivery / Varejo
    const isPapelaria = /papelaria|livraria|escrit[oó]rio/i.test(niche) || /papelaria/i.test(text);
    const hasDelivery = beliefs.some(b => b.belief_key === 'delivery_model') || /(?:entrega|pede hoje|chega amanh[aã]|delivery)/i.test(text);

    if (isPapelaria && hasDelivery) {
      return `Pô, pra papelaria com entrega rápida isso cai como uma luva!\n\n` +
        `[AUDIO: O cliente chama querendo ver material escolar ou de escritório, o bot atende na hora, manda o catálogo, recebe no Pix e já deixa o pedido organizado pras suas entregas do dia seguinte no automático. Dá pra começar no plano mensal de teste ou ativar a licença anual completa.]\n\n` +
        `[IMAGEM: bot_vendas | Demonstração do Atendimento Automático e Catálogo da Papelaria]\n\n` +
        `📋 *ESCOPO DE AUTOMAÇÃO COMERCIAL:*\n` +
        `• Catálogo interativo com fotos e preços\n` +
        `• Cobrança Pix automática em 3s com confirmação\n` +
        `• Separação e resumo de pedidos organizado\n` +
        `• Ativação imediata e 7 dias de garantia incondicional\n\n` +
        `Quer dar uma olhada na vitrine ou prefere que eu já te mande o Pix pra ativar hoje? 😉`;
    }

    const nicheLabel = (niche && niche !== 'Geral') ? ` pra quem mexe com ${niche}` : ' pro seu caso';
    return `Pô,${nicheLabel} isso é uma mão na roda demais!\n\n` +
      `[AUDIO: O cliente chama querendo ver produto ou tirar dúvida e o bot já responde na hora e manda o Pix pra ele pagar, sem você ficar preso no celular. A gente tem planos mensais flexíveis e também a licença anual completa.]\n\n` +
      `[IMAGEM: bot_vendas | Painel de Vendas e Atendimento PayBot]\n\n` +
      `📋 *ESCOPO DA SOLUÇÃO:*\n` +
      `• Atendimento comercial automático 24 horas por dia\n` +
      `• Cobrança Pix Copia e Cola instantânea\n` +
      `• Vitrine web sincronizada no link: ${effectiveStoreUrl}\n` +
      `• Garantia de 7 dias com ativação rápida em 2 minutos\n\n` +
      `Quer dar uma olhada na vitrine ou prefere que eu já gere a chave Pix de ativação agora? 😉`;
  }

  // ==============================================================
  // 5. HEARTBEAT AUTÔNOMO DE FOLLOW-UP ("EARNING ATTENTION")
  // ==============================================================
  async runAutonomousHeartbeat({ dryRun = false, limit = 10 } = {}) {
    const pendingLeads = models.getLeadsPendingFollowup(limit);
    const results = [];

    for (const lead of pendingLeads) {
      const firstName = (lead.name || 'Amigo').split(' ')[0];
      const stage = lead.buying_stage || 'PROPOSTA';
      const objection = lead.main_objection || 'NENHUMA';
      const scope = lead.project_scope || 'software sob medida';

      let hookMessage = '';
      if (objection === 'PRECO') {
        hookMessage = `${firstName}, fechamos ontem uma nova esteira de implantação modular que permite rodar o seu ${scope} com entrada reduzida e o restante faturado após o retorno da primeira etapa. Quer que eu te envie como ficou essa opção?`;
      } else if (objection === 'PRAZO') {
        hookMessage = `${firstName}, abrimos uma vaga no sprint técnico desta semana. Se aprovarmos o escopo do seu ${scope} até amanhã, conseguimos adiantar o primeiro protótipo funcional para entrega em 5 dias úteis.`;
      } else if (stage === 'PROPOSTA' || stage === 'QUALIFICACAO') {
        hookMessage = `${firstName}, subimos recentemente em produção um painel com fluxo em tempo real muito parecido com o que você solicitou para seu negócio. Gravei uma demonstração rápida de 40 segundos da tela. Quer dar uma olhada na usabilidade?`;
      } else {
        hookMessage = `${firstName}, passando para compartilhar um insight técnico rápido sobre a integração de ${scope}: conseguimos otimizar a latência e o custo de banco de dados para a sua operação. Quer revisar o escopo?`;
      }

      hookMessage = this.humanizeResponse(hookMessage);

      const followupItem = {
        phone: lead.phone,
        name: lead.name,
        stage,
        objection,
        readiness_score: lead.readiness_score,
        hookMessage,
        executed: false
      };

      if (!dryRun) {
        // Atualiza contagem de follow-up e posterga o próximo para 3 dias
        const newCount = (lead.followup_count || 0) + 1;
        const nextDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        models.upsertLeadCognitiveProfile(lead.phone, {
          followup_count: newCount,
          next_followup_at: nextDate,
          notes: `Follow-up #${newCount} acionado: ${hookMessage.slice(0, 80)}...`
        });
        models.addLeadEpisodicMemory(lead.phone, 'QUOTE', `Follow-up automático enviado: ${hookMessage.slice(0, 100)}`, hookMessage, 3);
        followupItem.executed = true;
      }

      results.push(followupItem);
    }

    return {
      timestamp: new Date().toISOString(),
      total_pending: pendingLeads.length,
      processed: results.length,
      dry_run: Boolean(dryRun),
      results
    };
  }

  /**
   * Calcula o Lead Score (0-100) e a Temperatura do Lead no CRM Cognitivo.
   * Retorna termômetro, emojis, cor e próxima melhor ação de vendas.
   */
  calculateLeadScoreAndTemperature(phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const profile = models.getLeadCognitiveProfile(cleanPhone);
    if (!profile) {
      return {
        phone: cleanPhone,
        score: 25,
        temperature: 'FRIO',
        emoji: '🧊',
        color: '#94a3b8',
        label: 'Lead Frio (Descoberta)',
        stage: 'DESCOBERTA',
        nextBestAction: 'Apresentar catálogo e descobrir principais necessidades.'
      };
    }

    let score = Number(profile.readiness_score || 30);
    const stage = profile.buying_stage || 'DESCOBERTA';
    const memoriesCount = Array.isArray(profile.memories) ? profile.memories.length : 0;

    if (stage === 'CONVERTIDO') score = Math.max(score, 100);
    else if (stage === 'FECHAMENTO') score = Math.max(score, 85);
    else if (stage === 'PROPOSTA') score = Math.max(score, 70);
    else if (stage === 'QUALIFICACAO') score = Math.max(score, 50);

    if (memoriesCount >= 5) score += 10;
    else if (memoriesCount >= 2) score += 5;

    if (profile.estimated_budget && profile.estimated_budget > 0) score += 10;

    if (profile.main_objection && profile.main_objection !== 'NENHUMA') {
      score -= 5;
    }

    score = Math.max(5, Math.min(100, score));

    let temperature = 'FRIO';
    let emoji = '🧊';
    let color = '#94a3b8';
    let label = 'Lead Frio';
    let nextBestAction = 'Enviar menu interativo e despertar interesse.';

    if (stage === 'CONVERTIDO') {
      temperature = 'CONVERTIDO';
      emoji = '🌟';
      color = '#10b981';
      label = 'Cliente Ativo';
      nextBestAction = 'Realizar onboarding guiado, suporte técnico e acompanhamento de sucesso (Customer Success).';
    } else if (score >= 85 || stage === 'FECHAMENTO') {
      temperature = 'FECHAMENTO';
      emoji = '🚀';
      color = '#ef4444';
      label = 'Fechamento Iminente';
      nextBestAction = 'Enviar link de pagamento direto com condição exclusiva ou acionar especialista.';
    } else if (score >= 65 || stage === 'PROPOSTA') {
      temperature = 'QUENTE';
      emoji = '🔥';
      color = '#f97316';
      label = 'Lead Quente';
      nextBestAction = 'Apresentar proposta de valor, esclarecer garantias e enviar cupom.';
    } else if (score >= 40 || stage === 'QUALIFICACAO') {
      temperature = 'MORNO';
      emoji = '⛅';
      color = '#f59e0b';
      label = 'Lead Morno';
      nextBestAction = 'Fazer perguntas de qualificação e apresentar casos de uso.';
    }

    return {
      phone: cleanPhone,
      score,
      temperature,
      emoji,
      color,
      label,
      stage,
      nextBestAction
    };
  }

  /**
   * Limpeza periódica de memória RAM para desalocar buffers de diálogo antigos
   */
  cleanupMemory() {
    try {
      const now = Date.now();
      for (const [phone, buf] of this.dialogueBuffers.entries()) {
        if (!Array.isArray(buf) || buf.length === 0) {
          this.dialogueBuffers.delete(phone);
          continue;
        }
        const lastTurn = buf[buf.length - 1];
        // Desaloca buffers de conversas inativas há mais de 45 minutos
        if (!lastTurn || (now - (lastTurn.timestamp || 0)) > 45 * 60 * 1000) {
          this.dialogueBuffers.delete(phone);
        }
      }
      if (this.onboardingStates) {
        for (const [phone, state] of this.onboardingStates.entries()) {
          if (!state || (now - (state.updatedAt || 0)) > 24 * 60 * 60 * 1000) {
            this.onboardingStates.delete(phone);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = new CognitiveSalesService();

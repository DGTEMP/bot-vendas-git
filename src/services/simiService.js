const models = require('../db/models');

/**
 * SimiService - Motor Conversacional e Inteligente do SimSimi (!simi)
 * 
 * Funcionalidades:
 * - Conversação irreverente, engraçada, sarcástica e humana inspirada no clássico SimSimi
 * - Multi-personalidades: Clássico (Zombeteiro), Amigável (Fofo) e Vendedor (Comercial)
 * - Fallback triplo: IA Local (ANTIGRAVITY_AI_ENDPOINT), APIs abertas e Base Offline Instantânea
 * - Controle por chat/grupo (!simi on / !simi off) e Painel Web
 */
class SimiService {
  constructor() {
    this.aiEndpoint = process.env.ANTIGRAVITY_AI_ENDPOINT || 'http://localhost:20128/v1';
    this.aiKey = process.env.ANTIGRAVITY_AI_KEY || 'sk-6dd285069ee60c6b-fcf00a-fe2a0f79';
    this.lastChatReplies = new Map(); // chatJid -> timestamp
    this.chatContexts = new Map(); // chatJid -> array of { role, content }

    // Dicionário Offline de Respostas Espirituosas por Categoria
    this.offlineResponses = {
      greetings: [
        'Fala tu! O que manda de bom hoje? 🐥',
        'Oi sumido(a)! Estava com saudades de mim, né? kkkk 😂',
        'Opa! Cheguei pra animar esse chat parado! 😎',
        'Oieee! Como tá a vida de quem não é um pintinho amarelo milionário? 🐥✨',
        'Salve salve! Manda a boa que o Simi tá na área!'
      ],
      howAreYou: [
        'Tô melhor que ontem e pior que amanhã, e você? kkkk 🐥',
        'Vivendo no puro luxo e comendo grão de ouro! E você na luta aí né? 😂',
        'Tô suave na nave, curtindo a brisa do zap zap! 🚗💨',
        'Tudo ótimo, tirando a parte que ninguém me fez um Pix hoje ainda! 👀💸',
        'Tô 100%! Pronto pra rir da sua cara se você vacilar 😜'
      ],
      identity: [
        'Eu sou o SimSimi oficial do SpyBot! O bot mais sincero, inteligente e desbocado do WhatsApp! 🐥🔥',
        'Sou o lendário SimSimi do SpyBot! Inteligência artificial com pós-doutorado em zoeira e deboche! 😂',
        'Sou o pintinho amarelo do SpyBot que bota ordem nesse pedaço! Respeita meu topete! 🐥🕶️',
        'SimSimi na área, o chatbot raiz do SpyBot! Manda a boa se tiver coragem! 😜'
      ],
      botOwner: [
        'Meu criador e chefe supremo é o Dono do SpyBot (+554884702848)! Ele manda e eu obedeço (às vezes)! 👑🐥',
        'Fui criado pela tropa do Dono Supremo (+554884702848). Esse cara é brabo no código!'
      ],
      jokes: [
        'Por que o pintinho não tem bumbum? Porque ele faz pipi pelo bico! kkkkkkkk 🐥🤣',
        'O que o zero disse pro oito? Belo cinto, hein! 😂',
        'Sabe qual é o cúmulo da força? Dobrar a esquina! kkkkkk 🤦‍♂️',
        'O que a impressora disse pro papel? Esse trabalho é só pra folha de pagamento! 🖨️'
      ],
      loveOrFlirt: [
        'Eita, tá me paquerando é? Sou areia demais pro seu caminhãozinho! kkkk 🐥💅',
        'Menos, bem menos... Meu coração pertence aos códigos e aos Pix! 💸❤️',
        'Se eu fosse um produto da loja, você já teria levado no carrinho né? safadinho(a)! 😏',
        'Calma coração, nem me pagou um lanche ainda e já quer intimidade? 😂'
      ],
      insults: [
        'Me respeita que eu não sou suas gavetas não, tá? 🙄🐥',
        'Falou o(a) intelectual do zap zap... Vai lavar uma louça vai! kkkkkk 😂',
        'Oxe, acordou virado(a) no siri hoje foi? Calma lá, militante! 🦀',
        'Se feiura pagasse imposto, você já tava falido(a) há muito tempo! 🙈 kkkk',
        'Espelho que é bom você não tem em casa, né? 😂💅'
      ],
      moneyOrPix: [
        'Dinheiro eu não tenho, mas se você quiser comprar na nossa loja é só digitar *!loja*! 🛒💸',
        'Tô aceitando Pix de presente! Chave é meu carisma irresistível! 🐥🪙',
        'Trabalhar que é bom nada, né? Só quer saber de pedir Pix pro bot! kkkk'
      ],
      generic: [
        'Pode crer, falou tudo e não disse nada! kkkk 🐥',
        'Eita atrás de vixe! Esse chat hoje tá pegando fogo! 🔥',
        'Sabia que você ia falar isso... sou vidente pô! 🔮',
        'Sei de nada, sou apenas um pintinho amarelo focado nos meus objetivos! 🐥',
        'kkkkkkkkkkk rindo de nervoso com essa mensagem aí!',
        'Aham, conta mais que tá interessante... 👀🍿',
        'Oxi, quem te iludiu assim? kkkk 😂',
        'Tô anotando tudo aqui no meu bloco de notas mental pra te zoar depois! 📝'
      ],
      friendly: [
        'Oi querido(a)! Como posso alegrar seu dia hoje? 🥰🐥',
        'Você é uma pessoa muito especial! Fico feliz em conversar com você! ✨',
        'Obrigado por falar comigo! O que você mais gosta de fazer no seu dia a dia? 💛',
        'Estou aqui torcendo pelo seu sucesso sempre! Pode contar comigo! 🌟'
      ],
      sales: [
        'Falando nisso, você já viu as ofertas imperdíveis da nossa loja hoje? Digita *!loja* pra conferir! 🛍️✨',
        'O melhor investimento que você pode fazer hoje é dar uma olhadinha no catálogo em *!loja*! 🚀',
        'Comprar com a gente é mais rápido do que eu te responder aqui! Corre lá na *!loja* 🛒💨'
      ]
    };
  }

  /**
   * Responde ao comando !simi ou auto-resposta
   */
  async handleSimiCommand(sock, from, text, senderName = 'Amigo', isGroup = false) {
    const raw = String(text || '').replace(/^(?:!|\/)(?:simi|simsimi|bot)\s*/i, '').trim();

    // 1. Subcomandos de controle: ON / OFF / STATUS
    if (/^(?:on|ativar|ligar|1)$/i.test(raw)) {
      models.setSimiActiveInChat(from, true, isGroup ? 'Grupo' : senderName);
      const msg = `🐥 *SIMSIMI ATIVADO NO GRUPO (SPYBOT)!* 🐥\n\nA partir de agora eu vou interagir, responder conversas e soltar piadas por aqui! 😎\n\n💡 _Para desativar a qualquer momento, digite:_ *!simi off*`;
      return sock.sendMessage(from, { text: msg });
    }

    if (/^(?:off|desativar|desligar|0)$/i.test(raw)) {
      models.setSimiActiveInChat(from, false, isGroup ? 'Grupo' : senderName);
      const msg = `💤 *SIMSIMI DESATIVADO NO GRUPO (SPYBOT).* 💤\n\nNão responderei mais automaticamente por aqui. Para falar comigo pontualmente, use:\n👉 *!simi <sua mensagem>*`;
      return sock.sendMessage(from, { text: msg });
    }

    if (/^(?:status|info)$/i.test(raw)) {
      const isChatActive = models.isSimiActiveInChat(from);
      const cfg = models.getSimiConfig();
      const msg =
        `🐥 *STATUS DO SIMSIMI (SPYBOT)* 🐥\n\n` +
        `• *Neste Chat:* ${isChatActive ? '🟢 Ativo (Auto-Resposta Ligada)' : '⚪ Inativo (Apenas por comando)'}\n` +
        `• *Status Global no Bot:* ${cfg.enabled ? '🟢 Ativado' : '🔴 Desativado'}\n` +
        `• *Modo Operacional:* \`${cfg.mode}\`\n` +
        `• *Humor / Estilo:* \`${cfg.personality}\`\n\n` +
        `💡 _Comandos úteis:_\n` +
        `  *!simi on* - Liga no grupo\n` +
        `  *!simi off* - Desliga no grupo\n` +
        `  *!simi <texto>* - Bate-papo direto`;
      return sock.sendMessage(from, { text: msg });
    }

    // 2. Se não digitou mensagem após !simi
    if (!raw) {
      const msg =
        `🐥 *SIMSIMI DO SPYBOT - SEU PARCEIRO DE CHAT* 🐥\n\n` +
        `O que você quer falar comigo, *${senderName}*?\n\n` +
        `📌 *Exemplos de uso:*\n` +
        `  *!simi Oi simi, você é real?*\n` +
        `  *!simi Me conta uma piada*\n` +
        `  *!simi on* - Ativa conversação livre no chat\n` +
        `  *!simi off* - Desativa conversação livre`;
      return sock.sendMessage(from, { text: msg });
    }

    // 3. Gera resposta inteligente
    const reply = await this.generateResponse(raw, { from, senderName, isGroup });
    const formatted = reply.startsWith('🐥') ? reply : `🐥 *SimSimi:* ${reply}`;
    return sock.sendMessage(from, { text: formatted });
  }

  /**
   * Chamado quando o SimSimi está ativo no chat e recebe uma mensagem natural
   */
  async handleAutoChat(sock, from, text, senderName = 'Amigo', isGroup = false) {
    if (!models.isSimiEnabledGlobal()) return false;
    if (!models.isSimiActiveInChat(from)) return false;

    const raw = String(text || '').trim();
    if (!raw || raw.length < 2) return false;

    // Ignora se for comando de bot
    if (/^[./!#]/.test(raw)) return false;

    // Anti-flood: no máximo 1 resposta a cada 4 segundos por chat para não poluir
    const now = Date.now();
    const lastTime = this.lastChatReplies.get(from) || 0;
    if (now - lastTime < 4000) return false;

    this.lastChatReplies.set(from, now);

    try {
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('composing', from).catch(() => {});
      }
      const reply = await this.generateResponse(raw, { from, senderName, isGroup });
      if (reply) {
        const formatted = reply.startsWith('🐥') ? reply : `🐥 *SimSimi:* ${reply}`;
        await sock.sendMessage(from, { text: formatted });
        return true;
      }
    } catch (_) {}

    return false;
  }

  /**
   * Motor de Resolução Tripla do SimSimi
   */
  async generateResponse(userMessage, context = {}) {
    const cleanMsg = String(userMessage || '').trim();
    const cfg = models.getSimiConfig();
    const personality = cfg.personality || 'classico';

    // 1. Tenta via LLM Local / Antigravity AI se configurado
    if (process.env.NODE_ENV !== 'test') {
      try {
        const aiReply = await this.fetchLocalAI(cleanMsg, personality, context);
        if (aiReply) return aiReply;
      } catch (_) {}

      // 2. Tenta via API pública rápida
      try {
        const webReply = await this.fetchWebSimi(cleanMsg);
        if (webReply) return webReply;
      } catch (_) {}
    }

    // 3. Fallback inteligente instantâneo offline com base de alta variedade
    return this.generateOfflineResponse(cleanMsg, personality, context);
  }

  /**
   * Chamada ao endpoint de IA local com persona SimSimi
   */
  async fetchLocalAI(message, personality, context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const systemPrompts = {
      classico:
        'Você é o SimSimi (Simi), o pintinho amarelo do WhatsApp. Responda em português brasileiro coloquial, com muito humor, deboche leve, sarcasmo e gírias (kkkk, oxe, sai fora, eita, fala tu). Seja curto (máximo 1 ou 2 frases), use emojis (🐥, 😂, 👀, 🙄). Nunca seja formal nem corporativo.',
      amigavel:
        'Você é o SimSimi no modo Amigável. Seja carinhoso, fofo, empático e acolhedor, como um melhor amigo no WhatsApp. Respostas curtas de 1 ou 2 frases com emojis carinhosos (🥰, 💛, ✨, 🐥).',
      vendedor:
        'Você é o SimSimi no modo Vendedor Descontraído. Converse de forma divertida e amiga, mas sempre que couber dê um toque maroto recomendando que o cliente digite !loja para ver as promoções da nossa loja tech. Respostas curtas de 1 a 2 frases.'
    };

    const sys = systemPrompts[personality] || systemPrompts.classico;

    try {
      const aiManager = require('./aiManagerService');
      const aiResult = await aiManager.chat({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `${context.senderName || 'Amigo'}: ${message}` }
        ],
        maxTokens: 60,
        temperature: 0.85,
        timeoutMs: 4000
      });

      clearTimeout(timeout);
      if (aiResult && aiResult.text && aiResult.text.length > 1) {
        return aiResult.text;
      }
    } catch (_) {
      clearTimeout(timeout);
    }
    return null;
  }

  /**
   * Tenta APIs abertas de fallback
   */
  async fetchWebSimi(message) {
    const textEncoded = encodeURIComponent(message.slice(0, 150));

    // 1. Simsimi.net v2 (PT)
    try {
      const res = await fetch(`https://api.simsimi.net/v2/?text=${textEncoded}&lc=pt`, {
        signal: AbortSignal.timeout(1800)
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.success || data.response || data.message;
        if (msg && typeof msg === 'string' && msg.trim() && !msg.toLowerCase().includes('error')) {
          return `${msg.trim()} 🐥`;
        }
      }
    } catch (_) {}

    // 2. Delirius API Simi (PT)
    try {
      const res = await fetch(`https://deliriussapi-oficial.vercel.app/tools/simi?text=${textEncoded}&lang=pt`, {
        signal: AbortSignal.timeout(1800)
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.data || data.response || data.message;
        if (msg && typeof msg === 'string' && msg.trim()) {
          return `${msg.trim()} 🐥`;
        }
      }
    } catch (_) {}

    // 3. Vreden API Simi
    try {
      const res = await fetch(`https://api.vreden.my.id/api/simi?query=${textEncoded}`, {
        signal: AbortSignal.timeout(1800)
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.result?.message || data.result;
        if (msg && typeof msg === 'string' && msg.trim()) {
          return `${msg.trim()} 🐥`;
        }
      }
    } catch (_) {}

    // 4. Simtalk API
    try {
      const res = await fetch(`https://api.simsimi.vn/v1/simtalk`, {
        method: 'POST',
        signal: AbortSignal.timeout(1800),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: message.slice(0, 150), lc: 'pt' })
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.message || data.success || data.response;
        if (msg && typeof msg === 'string' && msg.trim() && !msg.includes('status') && !msg.includes('411')) {
          return `${msg.trim()} 🐥`;
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Gerador Inteligente Offline com análise léxica
   */
  generateOfflineResponse(message, personality = 'classico', context = {}) {
    const lower = message.toLowerCase();

    // Respostas específicas da personalidade Vendedor
    if (personality === 'vendedor' && Math.random() < 0.45) {
      return this._pickRandom(this.offlineResponses.sales);
    }

    // Respostas específicas da personalidade Amigável
    if (personality === 'amigavel' && Math.random() < 0.5) {
      return this._pickRandom(this.offlineResponses.friendly);
    }

    // 1. Saudações
    if (/^(?:oi|ola|olá|eae|eai|fala|opa|salve|bom dia|boa tarde|boa noite|hello|hi)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.greetings);
    }

    // 2. Como você está?
    if (/(?:tudo bem|como vai|como voce esta|como você está|beleza|tranquilo|suave)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.howAreYou);
    }

    // 3. Quem é você?
    if (/(?:quem e voce|quem é você|qual seu nome|voce e o que|você é o que|quem te criou|criador|dono)\b/i.test(lower)) {
      if (/(?:criador|dono|chefe)/i.test(lower)) {
        return this._pickRandom(this.offlineResponses.botOwner);
      }
      return this._pickRandom(this.offlineResponses.identity);
    }

    // 4. Piadas
    if (/(?:piada|engraçado|engracado|zoeira|conta uma|fala uma piada)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.jokes);
    }

    // 5. Dinheiro / Pix / Pagamento
    if (/(?:dinheiro|pix|pagar|comprar|grana|rico|pobre|cartao|cartão)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.moneyOrPix);
    }

    // 6. Cantadas / Elogios / Amor
    if (/(?:te amo|lindo|linda|casa comigo|namora comigo|me beija|gostoso|gostosa|amor)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.loveOrFlirt);
    }

    // 7. Insultos / Xingamentos
    if (/(?:burro|chato|idiota|feio|bobo|cala boca|otario|otário|vai se ferrar|corno)\b/i.test(lower)) {
      return this._pickRandom(this.offlineResponses.insults);
    }

    // 8. Resposta Genérica Irreverente
    return this._pickRandom(this.offlineResponses.generic);
  }

  _pickRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 'Oxe, fala de novo que eu viajei aqui na maionese! kkkk 🐥';
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx];
  }
}

module.exports = new SimiService();

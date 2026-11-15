const models = require('../db/models');

class NaturalLanguageService {
  constructor() {
    this.slangDictionary = {
      'td': 'tudo',
      'tds': 'todos',
      'nd': 'nada',
      'trampo': 'trabalho',
      'grana': 'dinheiro',
      'pdc': 'pode crer',
      'pdpa': 'pode pá',
      'valew': 'valeu',
      'falow': 'falou',
      'vc': 'você',
      'vcs': 'vocês',
      'tbm': 'também',
      'tb': 'também',
      'qto': 'quanto',
      'qnto': 'quanto',
      'oq': 'o que',
      'pq': 'porque',
      'blz': 'beleza',
      'agr': 'agora',
      'pfv': 'por favor',
      'plz': 'por favor',
      'porfa': 'por favor',
      'obg': 'obrigado',
      'vlw': 'valeu',
      'brigado': 'obrigado',
      'brigada': 'obrigado',
      'ctz': 'certeza',
      'mto': 'muito',
      'mt': 'muito',
      'qdo': 'quando',
      'tmj': 'estamos juntos',
      'flw': 'falou',
      'zap': 'whatsapp',
      'wpp': 'whatsapp',
      'whats': 'whatsapp',
      'fvr': 'favor',
      'dps': 'depois',
      'bão': 'bom',
      'bao': 'bom',
      'opa': 'olá',
      'salve': 'olá',
      'fala': 'olá'
    };
  }

  // ==============================================================
  // 1. NORMALIZAÇÃO DE TEXTO & GÍRIAS BRASILEIRAS
  // ==============================================================
  normalizeText(text) {
    if (!text) return '';
    let normalized = text.toLowerCase();

    // Remove acentos e caracteres especiais desnecessários
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Reduz letras repetidas excessivas (ex: "oiiiiiii" -> "oi", "valeeeeeu" -> "valeu")
    normalized = normalized.replace(/([a-z])\1{2,}/g, '$1');

    // Substitui gírias e abreviações comuns
    const words = normalized.split(/\s+/);
    const expanded = words.map(w => this.slangDictionary[w] || w);
    return expanded.join(' ').trim();
  }

  // ==============================================================
  // 2. CLASSIFICAÇÃO DE INTENÇÕES (NLU SEMÂNTICO PT-BR)
  // ==============================================================
  classifyIntent(normalized) {
    // 0. Pedido de Desativação / Pausa / Parar de receber mensagens (Opt-out / LGPD)
    if (/(pare de me mandar mensagem|para de mandar mensagem|nao quero mais mensagem|nao me mande mensagem|desativar bot|pausar bot|parar bot|cancela o bot|nao me mande mais|para de mandar|nao quero receber|silenciar bot)/i.test(normalized)) {
      return { intent: 'DEACTIVATE_BOT', confidence: 0.98 };
    }

    // 0.5 Desinteresse / Recusa Explícita do Produto / Não Quero
    if (/(?:n[aã]o\s+quero\s+(?:o\s+)?(?:produto|bot|servi[cç]o|plano|sistema|nada|isso|esse|essa|comprar)|n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+me\s+interessa|n[aã]o\s+preciso(?:\s+de\s+(?:bot|nada|isso|produto))?|n[aã]o\s+vou\s+querer|n[aã]o\s+vou\s+comprar|n[aã]o\s+[eé]\s+(?:o\s+que\s+)?(?:eu\s+)?procuro|pra\s+mim\s+n[aã]o\s+serve|n[aã]o\s+serve\s+pra\s+mim|n[aã]o\s+faz\s+sentido|n[aã]o\s+estou\s+interessad[oa]|obrigad[oa]\s+mas\s+n[aã]o|valeu\s+mas\s+n[aã]o|obrigado\s+n[aã]o\s+quero|valeu\s+n[aã]o\s+quero|t[oô]\s+de\s+boa|deixa\s+quieto|deixa\s+pra\s+l[aá]|n[aã]o\s+vou\s+fechar|n[aã]o\s+quero\s+gastar|pode\s+cancelar(?:\s+o\s+pedido)?|cancela\s+(?:o\s+pedido|a\s+compra)|n[aã]o\s+tenho\s+como\s+comprar|n[aã]o\s+tenho\s+interesse\s+em\s+comprar)/i.test(normalized)) {
      return { intent: 'DISINTEREST', confidence: 0.96 };
    }

    // 1. Confirmação de Pagamento / Já paguei / Já comprei
    if (/(ja fiz o pix|acabei de pagar|ja paguei|fiz o pagamento|mandei o comprovante|olha o comprovante|ja transferi|dinheiro enviado|paguei aqui|caiu ai|ta pago|comprovante|pagamento feito|pagamento realizado|fiz a transferencia|acabei de comprar|ja comprei|comprei pelo link|paguei pelo link|comprei aqui|fiz a compra|consegui comprar|deu certo a compra|comprei agora|ja garanti|pronto.*compr|pronto.*pagu|pagamento concluido|pagamento efetuado|pix enviado|pix realizado|consegui fechar)/i.test(normalized)) {
      return { intent: 'CONFIRM_PURCHASE', confidence: 0.98 };
    }

    // 1.5 Confirmação Afirmativa / Resposta Positiva ao Fechamento / Enviar Pix
    if (/^(?:sim|quero|pode\s+(?:mandar|gerar|ser|fazer)|manda(?:\s+(?:a[ií]|aqui|o\s+pix|bala))?|gera(?:\s+(?:a[ií]|aqui|o\s+pix))?|passa(?:\s+(?:a[ií]|aqui|o\s+pix))?|fechado|bora|beleza|claro|com\s+certeza|topo|vamos\s+fechar)(?:[\s,]+(?:sim|quero|pode|mandar|gerar|ser|fazer|manda|gera|o\s+pix|bala|a[ií]|aqui|por\s+favor|pfv|amigo|bora|fechado))*[!?.\s]*$/i.test(normalized)) {
      return { intent: 'AFFIRMATIVE_CONFIRMATION', confidence: 0.96 };
    }

    // 1.6 Seleção de Plano ou Opção Específica (Mensal / Anual / Vitalício)
    if (/(?:quero\s*(?:o\s*)?)?(?:o\s*)?(?:plano\s*)?(?:mensal|anual|vital[ií]cio|trimestral|de\s*69(?:\b|,|9)|de\s*70|de\s*497|de\s*49(?:\b|,|9)|de\s*50|de\s*299|de\s*129|de\s*130|o\s*primeiro|o\s*segundo|o\s*1|o\s*2)\b/i.test(normalized)) {
      return { intent: 'PLAN_SELECTION', confidence: 0.95 };
    }

    // 2. Aceite de Upsell pós-venda
    if (/(quero o combo|quero up|quero o desconto|levar os dois|adiciona o vip|aceito a oferta|adicionar o outro|quero aproveitar a promocao|sim up|manda o combo|quero a oferta)/i.test(normalized)) {
      return { intent: 'UPSELL_ACCEPT', confidence: 0.95 };
    }

    // 3. Pagamento via PIX direto
    if (/(pagar no pix|manda a chave pix|passa o pix|faz por pix|aceita pix|qr code pix|copia e cola|chave do pix|quero pagar via pix|pago no pix|manda o pix|codigo pix|pix copia e cola|pix pfv|faz pix|\bpix\b)/i.test(normalized)) {
      return { intent: 'PAYMENT_PIX', confidence: 0.96 };
    }

    // 4. Pagamento via Cripto / Binance Pay
    if (/(pagar com cripto|aceita usdt|tem binance pay|pagar em bitcoin|manda a carteira|pagar com tether|carteira usdt|pagamento cripto|pago com usdt|pagar via cripto|usdt trc20|\bbinance\b|\busdt\b|\bcripto\b|\bcrypto\b)/i.test(normalized)) {
      return { intent: 'PAYMENT_CRYPTO', confidence: 0.96 };
    }

    // 5. Consulta de Desconto / Cupom
    if (/(tem cupom|tem algum cupom|cupom de desconto|tem desconto|rola um desconto|consegue fazer mais barato|tem promocao|faz um preco melhor|desconto a vista|algum desconto|tem promo|consegue melhorar o preco|da um desconto|\bcupom\b|\bdesconto\b)/i.test(normalized)) {
      return { intent: 'DISCOUNT_QUERY', confidence: 0.94 };
    }

    // 6. Dúvidas sobre Confiança, Golpe e Garantia
    if (/(e confiavel|e seguro|e golpe|tem garantia|e se eu nao gostar|devolvem o dinheiro|reembolso|posso confiar|e verdade|da pra confiar|tem suporte mesmo|funciona mesmo|\bgarantia\b|\bgolpe\b)/i.test(normalized)) {
      return { intent: 'TRUST_AND_GUARANTEE', confidence: 0.95 };
    }

    // 7. Intenção Direta de Compra / Link / Fechamento
    if (/(quero comprar|como compro|onde compro|quero o link|manda o link|passa o link|me passa o link|me manda o link|vou querer|quero assinar|como faco pra adquirir|como faco pra comprar|vou levar|quero o produto|libera o acesso|comprar agora|quero fechar|tenho interesse|manda pra mim|como faco pra ter|quero assinar agora|link para comprar|link pra comprar|passa o link para comprar|manda o link para comprar|link de compra|onde pago)/i.test(normalized)) {
      return { intent: 'BUY_INTENT', confidence: 0.95 };
    }

    // 8. Aluguel de Bot para Grupos
    if (/(?:aluguel\s+de\s+bot|alugar\s+bot|bot\s+para\s+grupo|bot\s+de\s+grupo|bot\s+pra\s+grupo|proteger\s+meu\s+grupo|antitrava|anti-trava|antilink\s+de\s+grupo|colocar\s+bot\s+no\s+grupo|planos?\s+do\s+bot|mensalidade\s+do\s+bot|aluguel\s+mensal|\baluguel\b)/i.test(normalized)) {
      return { intent: 'RENTAL_QUERY', confidence: 0.94 };
    }

    // 9. Software e Aplicativos Sob Medida
    if (/(?:(?:software|sistema|app|aplicativo|bot)\s+sob\s+medida|(?:criar|desenvolver|desenvolvem|faz|fazer|programar|construir)\s+(?:um\s+)?(?:software|sistema|app|aplicativo|bot|site)|desenvolvimento|app\s+mobile|aplicativo\s+android|agendar\s+call|reuni[aã]o\s+t[eé]cnica|\bcall\b)/i.test(normalized)) {
      return { intent: 'CUSTOM_SOFTWARE_QUERY', confidence: 0.93 };
    }

    // 10. Dúvida de Teste / Demonstração
    if (/(?:tem\s+teste|posso\s+testar|tem\s+demonstra[cç][aã]o|vers[aã]o\s+de\s+teste|teste\s+gr[aá]tis|tem\s+demo|posso\s+ver\s+funcionando|tem\s+como\s+testar|testar\s+antes|\bteste\b|\bdemo\b)/i.test(normalized)) {
      return { intent: 'TEST_QUERY', confidence: 0.93 };
    }

    // 11. Consulta de Pedidos / Rastreio / Licença
    if (/(?:onde\s+t[aá]\s+meu\s+pedido|meus\s+pedidos|status\s+do\s+pedido|minha\s+compra|minha\s+chave|cad[eê]\s+minha\s+licen[cç]a|ver\s+meu\s+pedido|rastrear\s+pedido|\brastreio\b|\bpedidos\b)/i.test(normalized)) {
      return { intent: 'ORDER_STATUS_QUERY', confidence: 0.93 };
    }

    // 12. Consulta de Preço / Valores
    if (/(quanto custa|qual o valor|quanto ta saindo|ta quanto|\bpreco\b|quanto fica|qual o investimento|quanto e|quanto ta|valor do|qual e o preco|qual valor|quanto que e|\bvalores\b)/i.test(normalized)) {
      return { intent: 'PRICE_QUERY', confidence: 0.93 };
    }

    // 13. Como Funciona / Explicação do Produto / Me conta mais
    if (/(como funciona|o que vem|como recebo|e imediato|entrega na hora|como e feita a entrega|funciona no celular|funciona no iphone|explica como funciona|detalhes do produto|o que inclui|como recebo os acessos|me conta mais|me fala mais|conta mais sobre|fala mais sobre|quero saber mais|me explica mais|explica mais|do que se trata|o que e isso|como e esse|como e essa)/i.test(normalized)) {
      return { intent: 'HOW_IT_WORKS', confidence: 0.92 };
    }

    // 14. Consulta de Catálogo / Cardápio / Planos
    if (/(quais os produtos|o que voces vendem|cardapio|tabela de precos|quais planos|me mostra o que tem|opcoes de produtos|produtos disponiveis|ver catalogo|menu|inicio|ver planos|o que tem disponivel|\bcatalogo\b|\bprodutos\b)/i.test(normalized)) {
      return { intent: 'CATALOG_QUERY', confidence: 0.92 };
    }

    // 15. Suporte Humano / Ajuda
    if (/(falar com atendente|falar com suporte|humano|atendimento|ajuda|nao estou conseguindo|deu erro|problema com meu acesso|preciso de ajuda|\bsuporte\b|\batendente\b)/i.test(normalized)) {
      return { intent: 'SUPPORT_HUMAN', confidence: 0.92 };
    }

    // 16. Saudações / Cumprimentos
    if (/(?:ol[aá]|oi|e\s*a[ií]|bom\s*dia|boa\s*tarde|boa\s*noite|opa|salve|fala|tudo\s*bem|como\s*vai)/i.test(normalized)) {
      return { intent: 'GREETING', confidence: 0.88 };
    }

    // 13. Intenção Padrão / Conversa Geral
    return { intent: 'GENERAL_CHAT', confidence: 0.60 };
  }

  // ==============================================================
  // 3. EXTRAÇÃO DE ENTIDADES (PRODUTO, CUPOM, AFILIADO)
  // ==============================================================
  extractEntities(normalized, originalText, customProducts = null) {
    const products = (Array.isArray(customProducts) && customProducts.length > 0)
      ? customProducts
      : models.getProducts(true);
    let matchedProduct = null;
    let extractedNumber = null;

    // Se a mensagem for de desinteresse/recusa explícita, NÃO vincula produto como intenção de compra
    const isDisinterestText = /(?:n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+preciso|n[aã]o\s+vou\s+comprar|n[aã]o\s+vou\s+querer|n[aã]o\s+me\s+interessa|valeu\s+mas\s+n[aã]o|obrigad[oa]\s+mas\s+n[aã]o|t[oô]\s+de\s+boa)/i.test(normalized);

    // Detecta menção a número de produto (apenas se a mensagem for exclusivamente o número ou se tiver prefixo explícito de produto/opção)
    const isOnlyNumber = /^\s*([1-9]\d?)\s*$/.test(normalized);
    const explicitNumMatch = normalized.match(/(?:produto|plano|item|op[cç][aã]o|n[uú]mero|n[ºo]|\bo\b|\bpro\b|\bpra\b|\bpara\b|\bdo\b|\bda\b)\s*([1-9]\d?)\b/i);

    if (!isDisinterestText) {
      if (isOnlyNumber) {
        const idx = parseInt(normalized.trim(), 10);
        if (idx > 0 && idx <= products.length) {
          matchedProduct = products[idx - 1];
          extractedNumber = idx;
        }
      } else if (explicitNumMatch) {
        const idx = parseInt(explicitNumMatch[1], 10);
        if (idx > 0 && idx <= products.length) {
          matchedProduct = products[idx - 1];
          extractedNumber = idx;
        }
      }
    }

    // Se não encontrou por número, busca por semelhança no nome/categoria do produto usando palavras distintivas (evita falsos positivos com palavras genéricas como "bot", "pro", "ia")
    if (!isDisinterestText && !matchedProduct && products.length > 0) {
      const GENERIC_PRODUCT_STOPWORDS = new Set([
        'bot', 'pro', 'app', 'para', 'com', 'sem', 'de', 'da', 'do', 'das', 'dos',
        'em', 'um', 'uma', 'plano', 'licenca', 'licença', 'acesso', 'chave', 'grupo',
        'sistema', 'software', 'digital', 'mensal', 'anual', 'vitalicio', 'vitalício',
        'novo', 'mais', 'como', 'quem', 'qual', 'onde', 'quando', 'sobre', 'esse',
        'essa', 'este', 'esta', 'meu', 'minha', 'seu', 'sua', 'loja', 'teste', 'geral',
        'base', 'curso', 'oficial', 'premium', 'ultra', 'especial', 'edicao', 'edição',
        'final', 'vendas', 'atendimento'
      ]);

      for (const prod of products) {
        const prodNorm = this.normalizeText(prod.name);
        const catNorm = (prod.category || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        const distinctiveKeywords = prodNorm
          .split(/\s+/)
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => (w.length >= 3 && !GENERIC_PRODUCT_STOPWORDS.has(w)) || w === 'vip' || w === 'seo');

        const matchesDistinctive = distinctiveKeywords.some(kw => {
          const kwRegex = new RegExp('\\b' + kw + '\\b', 'i');
          return kwRegex.test(normalized);
        });

        const matchesCategory = catNorm && catNorm.length >= 3 && !['ia', 'geral', 'auto', 'app'].includes(catNorm) &&
          new RegExp('\\b' + catNorm + '\\b', 'i').test(normalized);

        if (matchesDistinctive || matchesCategory) {
          matchedProduct = prod;
          break;
        }
      }

      // Se a mensagem pede especificamente por automação ou bot de atendimento/vendas do WhatsApp e nenhum produto de nicho casou:
      if (!matchedProduct && /(?:bot\s+de\s+vendas|bot\s+whatsapp|bot\s+de\s+atendimento|automa[cç][aã]o\s+whatsapp|rob[oô]\s+de\s+vendas|bot\s+para\s+loja|bot\s+pra\s+minha\s+loja)/i.test(normalized)) {
        const flagshipBot = products.find(p => p.id === 842 || /SpyBot Pro|PayBot/i.test(p.name));
        if (flagshipBot) matchedProduct = flagshipBot;
      }

      // Detecção inteligente de planos e opções selecionadas (Mensal, Anual, Vitalício, Grupos):
      if (!matchedProduct) {
        const isMensalSales = /(?:mensal|69|70|primeiro|\b1\b)/i.test(normalized) && !/(?:grupo|aluguel\s+mensal|49|50)/i.test(normalized);
        const isAnualSales = /(?:anual|497|segundo|\b2\b)/i.test(normalized);
        const isGrupoVitalicio = /(?:vital[ií]cio|vitalicio|299)/i.test(normalized);
        const isGrupoTrimestral = /(?:trimestral|129|130)/i.test(normalized);
        const isGrupoMensal = /(?:grupo.*mensal|aluguel.*mensal|49|50)/i.test(normalized);

        if (isMensalSales) {
          matchedProduct = products.find(p => p.id === 2137) ||
            products.find(p => !/(?:grupo|aluguel|prote[cç][aã]o)/i.test(p.name) && (p.price_brl >= 65 && p.price_brl <= 75)) ||
            products.find(p => /mensal.*(?:vendas|atendimento)/i.test(p.name) || /paybot.*mensal/i.test(p.name)) ||
            products.find(p => p.id === 2137 || (p.price_brl >= 65 && p.price_brl <= 75));
        } else if (isAnualSales) {
          matchedProduct = products.find(p => p.id === 842 || (p.price_brl >= 450 && p.price_brl <= 550) || /spybot|bot de vendas/i.test(p.name));
        } else if (isGrupoVitalicio) {
          matchedProduct = products.find(p => p.id === 1064 || p.price_brl === 299 || /vital[ií]cio/i.test(p.name));
        } else if (isGrupoTrimestral) {
          matchedProduct = products.find(p => p.id === 1063 || (p.price_brl >= 115 && p.price_brl <= 135) || /trimestral/i.test(p.name));
        } else if (isGrupoMensal) {
          matchedProduct = products.find(p => p.id === 1062 || (p.price_brl >= 45 && p.price_brl <= 55) || /aluguel mensal/i.test(p.name));
        }
      }
    }

    // Se ainda não encontrou e há apenas 1 produto no catálogo, assume este (apenas se não houver desinteresse)
    if (!isDisinterestText && !matchedProduct && products.length === 1) {
      matchedProduct = products[0];
    }

    // Detecta Cupom de Desconto com filtro de stop words
    let couponCode = null;
    const couponMatch = originalText.match(/(?:cupom[:\s]+|cupom de desconto[:\s]+|codigo[:\s]+)([a-zA-Z0-9_-]{3,20})/i);
    if (couponMatch) {
      const candidate = couponMatch[1].toUpperCase();
      const stopWords = ['DE', 'DO', 'DA', 'PRA', 'PARA', 'COM', 'EM', 'UM', 'UMA', 'DESCONTO', 'TEM', 'ATIVO'];
      if (!stopWords.includes(candidate)) {
        couponCode = candidate;
      }
    }

    // Detecta Código de Afiliado
    const refMatch = originalText.match(/(?:ref_|afiliado[:\s]+)([a-zA-Z0-9_-]+)/i);
    const refCode = refMatch ? refMatch[1].toUpperCase() : null;

    return {
      matchedProduct,
      extractedNumber,
      couponCode,
      refCode
    };
  }

  // ==============================================================
  // 4. PROCESSAMENTO INTEGRAL E GERAÇÃO DA RESPOSTA EM PT-BR
  // ==============================================================
  async processMessage(input, options = {}) {
    let text = '';
    let customerName = '';
    let platform = 'whatsapp';
    let products = null;
    let tenantId = null;
    let instanceId = null;

    if (typeof input === 'string') {
      text = input;
      customerName = options.customerName || options.senderName || options.name || '';
      platform = options.platform || 'whatsapp';
      products = options.products || null;
      tenantId = options.tenantId || null;
      instanceId = options.instanceId || null;
    } else if (input && typeof input === 'object') {
      text = input.text || input.message || input.msg || '';
      customerName = input.customerName || input.senderName || input.name || '';
      platform = input.platform || 'whatsapp';
      products = input.products || null;
      tenantId = input.tenantId || null;
      instanceId = input.instanceId || null;
    }

    if (!text || typeof text !== 'string') {
      return { intent: 'EMPTY', replyText: 'Olá! Como posso te ajudar hoje?', confidence: 0 };
    }

    const rawName = (customerName || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|undefined|null)$/i.test(rawName);
    const firstName = isGeneric ? '' : rawName.split(' ')[0];
    const nameGreeting = firstName ? ` ${firstName}` : '';

    const normalized = this.normalizeText(text);
    const { intent, confidence } = this.classifyIntent(normalized);
    
    // Resolve produtos considerando escopo do Tenant ou Matriz
    let effectiveProducts = Array.isArray(products) && products.length > 0 ? products : null;
    if (!effectiveProducts && tenantId) {
      effectiveProducts = models.getProductsByTenant(tenantId).filter(p => p.active !== 0);
    }
    if (!effectiveProducts) {
      effectiveProducts = models.getProducts(true);
    }

    const { matchedProduct, extractedNumber, couponCode, refCode } = this.extractEntities(normalized, text, effectiveProducts);

    const defaultProduct = matchedProduct || (
      tenantId
        ? (effectiveProducts && effectiveProducts[0])
        : ((effectiveProducts && effectiveProducts.find(p => p.id === 842 || /SpyBot Pro|PayBot/i.test(p.name))) || (effectiveProducts && effectiveProducts[0]))
    ) || {
      name: 'PayBot WhatsApp - Bot de Vendas 24/7',
      price_brl: 497.00,
      price_usdt: 99.00,
      description: 'Atendimento e vendas no automático 24/7 com vitrine e Pix instantâneo'
    };

    let replyText = '';
    let directAction = null; // 'TRIGGER_PIX', 'TRIGGER_BINANCE', 'SHOW_MENU', 'APPLY_COUPON', 'TRIGGER_UPSELL'

    // 0. Verifica se há algum Trigger Inteligente Personalizado cadastrado no banco de dados
    const customTrigger = models.findMatchingTrigger(text, platform);
    if (customTrigger) {
      const trigReply = customTrigger.response_text
        .replace(/\{nome\}/gi, firstName || '')
        .replace(/\{produto\}/gi, defaultProduct.name)
        .replace(/\{preco_brl\}/gi, Number(defaultProduct.price_brl || defaultProduct.price).toFixed(2))
        .replace(/\{preco_usdt\}/gi, Number(defaultProduct.price_usdt || (defaultProduct.price / 5.5)).toFixed(2));

      return {
        intent: 'CUSTOM_TRIGGER',
        confidence: 0.99,
        replyText: trigReply.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim(),
        matchedProduct,
        couponCode,
        refCode,
        triggerId: customTrigger.id,
        triggerCategory: customTrigger.category
      };
    }

    switch (intent) {
      case 'DEACTIVATE_BOT':
        directAction = 'DEACTIVATE_BOT';
        replyText = `🛑 *ATENDIMENTO AUTOMÁTICO PAUSADO!*\n\nRespeitamos sua decisão${nameGreeting}! Pausamos as respostas automáticas para esta conversa. Se quiser reativar a qualquer momento, basta enviar *!ativar*. Tenha um ótimo dia!`;
        break;

      case 'DISINTEREST':
        directAction = 'HANDLE_DISINTEREST';
        replyText = `Entendido perfeitamente${nameGreeting}! Sem problemas nenhum 👍\n\nMuito obrigado pelo retorno e pela atenção! Se em algum momento precisar de algo ou quiser tirar alguma dúvida, estamos à disposição por aqui. Sucesso nos seus projetos!`;
        break;

      case 'CONFIRM_PURCHASE':
        replyText = `🎉 *PARABÉNS PELA COMPRA${firstName ? ', ' + firstName : ''}!* 🚀\n\nIdentificamos sua confirmação! O nosso sistema faz a conferência automática do pagamento em segundos. Assim que o pagamento for compensado, você receberá seus dados de acesso diretamente por aqui!\n\nSe tiver o comprovante e quiser mandar aqui, agiliza ainda mais a liberação! Qualquer dúvida, conte comigo.`;
        break;

      case 'UPSELL_ACCEPT':
        directAction = 'TRIGGER_UPSELL';
        replyText = `Sensacional${nameGreeting}! Vamos adicionar essa oferta especial ao seu pedido com o desconto exclusivo garantido! 🚀`;
        break;

      case 'AFFIRMATIVE_CONFIRMATION':
        directAction = 'TRIGGER_PIX';
        if (matchedProduct) {
          const pr = Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2);
          replyText = `Perfeito${nameGreeting}! Gerando sua chave Pix Copia e Cola para *${matchedProduct.name}* (R$ ${pr}) agora mesmo... 🚀`;
        } else {
          replyText = `Fechado${nameGreeting}! Gerando seu código Pix Copia e Cola para liberação imediata agora mesmo... 🚀`;
        }
        break;

      case 'PLAN_SELECTION':
        directAction = 'TRIGGER_PIX';
        if (matchedProduct) {
          const pr = Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2);
          replyText = `Show de bola${nameGreeting}! O *${matchedProduct.name}* fica em *R$ ${pr}* no Pix com liberação imediata. Posso gerar o código Pix copia e cola pra você agora?`;
        } else {
          replyText = `Perfeito${nameGreeting}! Qual dos planos você prefere que eu gere agora? Temos o plano mensal (R$ 69,90) e o anual completo (R$ 497).`;
        }
        break;

      case 'PAYMENT_PIX':
        directAction = 'TRIGGER_PIX';
        if (matchedProduct) {
          replyText = `Perfeito${nameGreeting}! O pagamento via *PIX* para *${matchedProduct.name}* custa apenas *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* com liberação instantânea. Gerando sua chave e QR Code agora...`;
        } else {
          replyText = `Com certeza! Aceitamos *PIX com entrega automática na hora*. Para qual dos nossos produtos você deseja gerar o código PIX? Digite o número correspondente ou o nome do produto!`;
        }
        break;

      case 'PAYMENT_CRYPTO':
        directAction = 'TRIGGER_BINANCE';
        if (matchedProduct) {
          replyText = `Excelente escolha${nameGreeting}! Aceitamos pagamento em cripto via *Binance Pay (USDT)* sem taxas de rede! O valor para *${matchedProduct.name}* é de *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT*. Gerando sua cobrança agora...`;
        } else {
          replyText = `Sim! Aceitamos *USDT via Binance Pay* com confirmação imediata. Qual dos produtos você deseja adquirir com USDT?`;
        }
        break;

      case 'DISCOUNT_QUERY':
        const activeCoupon = models.getCoupons ? models.getCoupons(true)[0] : null;
        if (activeCoupon) {
          replyText = `Temos um cupom promocional ativo hoje${nameGreeting}! Use o código *${activeCoupon.code}* para garantir *${activeCoupon.discount_percent || 15}% de desconto* na sua compra!`;
        } else {
          replyText = `Nossos valores já estão na melhor condição especial de lançamento${nameGreeting}! Mas se você fechar via PIX agora, a ativação é imediata com bônus exclusivos inclusos.`;
        }
        break;

      case 'TRUST_AND_GUARANTEE':
        replyText = `Pode ter certeza absoluta${nameGreeting}! 🛡️\n\nNossa plataforma é auditada e opera com tecnologia segura via *PIX oficial do Banco Central* e *Binance Pay*.\n\nAlém disso, você tem *GARANTIA INCONDICIONAL DE 7 DIAS*: se por qualquer razão você não gostar, nós devolvemos 100% do seu dinheiro sem burocracia nenhuma. O risco é todo nosso!`;
        break;

      case 'BUY_INTENT':
        if (matchedProduct) {
          replyText = `Perfeito${nameGreeting}! O *${matchedProduct.name}* está disponível por *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* (ou *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT*).\n\nComo você prefere realizar o pagamento? Digite *PIX* para gerar a chave copia e cola ou *CRIPTO* para Binance Pay!`;
        } else {
          directAction = 'SHOW_MENU';
          replyText = `Excelente decisão${nameGreeting}! 🚀 Veja abaixo nossos produtos disponíveis e me diga qual deles você deseja garantir agora:`;
        }
        break;

      case 'PRICE_QUERY':
        if (matchedProduct) {
          replyText = `O valor do *${matchedProduct.name}* é de apenas *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* no PIX ou *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT* com entrega automática imediata! Quer que eu gere seu código de pagamento agora?`;
        } else if (effectiveProducts && effectiveProducts.length > 0) {
          const list = effectiveProducts.slice(0, 4).map((p, i) => `🔹 *${i + 1}. ${p.name}* — R$ ${Number(p.price_brl || p.price).toFixed(2)} (${Number(p.price_usdt || (p.price / 5.5)).toFixed(2)} USDT)`).join('\n');
          replyText = `Aqui estão os valores atualizados dos nossos produtos:\n\n${list}\n\nQual deles você tem interesse em garantir?`;
        } else {
          replyText = `Os valores variam conforme o plano escolhido, a partir de R$ 25,00 com entrega imediata!`;
        }
        break;

      case 'HOW_IT_WORKS':
        if (matchedProduct) {
          replyText = `O *${matchedProduct.name}* foi desenvolvido para entregar resultados consistentes na prática, sem complicação técnica. Você recebe acesso imediato, metodologia passo a passo e suporte dedicado para qualquer dúvida.\n\nQuer que eu te mostre como funciona na prática ou prefere receber o link oficial de apresentação?`;
        } else {
          replyText = `É muito simples e 100% automático${nameGreeting}! ⚡\n\n1. Você escolhe o produto ou assinatura que deseja.\n2. Efetua o pagamento seguro via PIX ou USDT.\n3. O nosso sistema identifica a transação na hora e entrega seus acessos, chave de licença ou convite do canal VIP diretamente aqui na conversa!\n\nSem espera humana e com suporte disponível. Gostaria de ver o catálogo?`;
        }
        break;

      case 'CATALOG_QUERY':
        directAction = 'SHOW_MENU';
        replyText = `Com certeza${nameGreeting}! Aqui está nosso catálogo oficial de produtos e planos disponíveis para você:`;
        break;

      case 'SUPPORT_HUMAN':
        replyText = `Compreendo perfeitamente${nameGreeting}! Notifiquei nossa equipe de suporte para te atender com prioridade. Se puder detalhar sua dúvida ou problema aqui abaixo, já adiantamos seu atendimento!`;
        break;

      case 'RENTAL_QUERY':
        directAction = 'SHOW_RENTAL';
        replyText = `Com certeza${nameGreeting}! 🛡️ Nosso bot para grupos de WhatsApp conta com proteção anti-trava, anti-link, boas-vindas automáticas, stickers instantâneos (!s) e comandos FX.\n\n` +
          `💎 *Planos Disponíveis:*\n` +
          `• Mensal (30 dias): *R$ 49,90*\n` +
          `• Trimestral (90 dias): *R$ 119,90*\n` +
          `• Licença Vitalícia: *R$ 299,00*\n\n` +
          `A ativação é instantânea por chave de 8 dígitos logo após o Pix! Quer gerar o Pix de 30 dias (R$ 49,90) agora? Digite *PIX ALUGUEL*!`;
        break;

      case 'CUSTOM_SOFTWARE_QUERY':
        directAction = 'SHOW_CUSTOM_SOFTWARE';
        replyText = `Desenvolvemos sim${nameGreeting}! 💻 Criamos bots avançados, aplicativos mobile (Android & iOS) e plataformas SaaS completas com entrega ágil e código auditado.\n\n` +
          `Deseja agendar uma conversa técnica de 15 minutos via Google Meet? Digite *!call* ou me conte mais sobre o que seu projeto precisa!`;
        break;

      case 'TEST_QUERY':
        replyText = `Com certeza${nameGreeting}! 🚀 Você pode testar nossos comandos e catálogo diretamente aqui no WhatsApp enviando *1* ou *MENU*.\n\n` +
          `Além disso, todas as nossas licenças possuem *GARANTIA INCONDICIONAL DE 7 DIAS*: você ativa, testa em sua operação e se não aprovar devolvemos 100% do seu valor! O que você gostaria de testar primeiro?`;
        break;

      case 'ORDER_STATUS_QUERY':
        directAction = 'SHOW_STATUS';
        replyText = `Perfeito${nameGreeting}! Estou consultando o histórico dos seus pedidos e licenças ativas agora mesmo...`;
        break;

      case 'GREETING':
        replyText = `Olá${nameGreeting}! Tudo bem? 👋\n\n` +
          `Seja muito bem-vindo! Como posso te ajudar hoje?\n\n` +
          `1️⃣ *Ver Catálogo & Produtos Digitais*\n` +
          `2️⃣ *Aluguel de Bots para Grupos*\n` +
          `3️⃣ *Software Sob Medida & Apps*\n` +
          `4️⃣ *Falar com Atendimento Humano*\n` +
          `5️⃣ *Consultar Meus Pedidos*\n\n` +
          `👉 *Digite o número da opção (1 a 5)* ou me diga diretamente o que você precisa!`;
        break;

      default:
        if (matchedProduct && /(comprar|preco|valor|link|oferta|adquirir|quanto|custa)/i.test(normalized)) {
          const prodPrice = Number(matchedProduct.price_brl || matchedProduct.price || 49.90).toFixed(2);
          replyText = `O *${matchedProduct.name}* fica em R$ ${prodPrice}. Quer que eu te envie o link de checkout ou prefere chave Pix?`;
        } else if (matchedProduct) {
          replyText = `Saquei. O *${matchedProduct.name}* atende bem isso. Você já tem uma operação rodando ou tá montando do zero?`;
        } else {
          replyText = `Entendi. Você já tem uma operação rodando hoje ou tá montando a estrutura do zero?`;
        }
        break;
    }

    return {
      originalText: text,
      normalized,
      intent,
      confidence,
      entities: {
        matchedProduct,
        selectedProduct: matchedProduct,
        extractedNumber,
        couponCode,
        refCode
      },
      directAction,
      replyText
    };
  }

  getDictionary() {
    return this.slangDictionary;
  }

  getIntents() {
    return [
      { id: 'CONFIRM_PURCHASE', label: 'Confirmação de Pagamento', desc: 'Comprovantes, "já paguei", "fiz o pix"' },
      { id: 'UPSELL_ACCEPT', label: 'Aceite de Oferta / Upsell', desc: '"Quero o combo", "adiciona o outro", "sim up"' },
      { id: 'PAYMENT_PIX', label: 'Pagamento via PIX', desc: '"Chave pix", "copia e cola", "pagar no pix"' },
      { id: 'PAYMENT_CRYPTO', label: 'Pagamento via Cripto', desc: '"Binance Pay", "USDT", "pagar com bitcoin"' },
      { id: 'DISCOUNT_QUERY', label: 'Consulta de Cupom / Desconto', desc: '"Tem desconto?", "faz mais barato?", "cupom"' },
      { id: 'TRUST_AND_GUARANTEE', label: 'Confiança, Garantia & Objeção', desc: '"É seguro?", "é golpe?", "tem garantia?"' },
      { id: 'BUY_INTENT', label: 'Intenção Direta de Compra', desc: '"Quero comprar", "manda o link", "vou querer"' },
      { id: 'PRICE_QUERY', label: 'Consulta de Preços', desc: '"Quanto custa?", "qual o valor?", "tá quanto?"' },
      { id: 'HOW_IT_WORKS', label: 'Como Funciona a Entrega', desc: '"Entrega na hora?", "como recebo?", "explica"' },
      { id: 'CATALOG_QUERY', label: 'Consulta de Catálogo / Menu', desc: '"Quais os produtos?", "cardápio", "menu"' },
      { id: 'SUPPORT_HUMAN', label: 'Suporte & Atendente Humano', desc: '"Falar com atendente", "ajuda", "humano"' },
      { id: 'GREETING', label: 'Saudações & Cumprimentos', desc: '"Olá", "bom dia", "opa", "e aí"' },
      { id: 'GENERAL_CHAT', label: 'Conversa Geral', desc: 'Outras dúvidas e mensagens conversacionais' }
    ];
  }
}

module.exports = new NaturalLanguageService();

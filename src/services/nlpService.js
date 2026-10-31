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

    // 1. Confirmação de Pagamento / Já paguei
    if (/(ja fiz o pix|acabei de pagar|ja paguei|fiz o pagamento|mandei o comprovante|olha o comprovante|ja transferi|dinheiro enviado|paguei aqui|caiu ai|ta pago|comprovante|pagamento feito|pagamento realizado|fiz a transferencia)/i.test(normalized)) {
      return { intent: 'CONFIRM_PURCHASE', confidence: 0.98 };
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

    // 7. Intenção Direta de Compra / Link
    if (/(quero comprar|como compro|onde compro|quero o link|manda o link|passa o link|vou querer|quero assinar|como faco pra adquirir|vou levar|quero o produto|libera o acesso|comprar agora|quero fechar|tenho interesse|manda pra mim|como faco pra ter|quero assinar agora)/i.test(normalized)) {
      return { intent: 'BUY_INTENT', confidence: 0.95 };
    }

    // 8. Consulta de Preço / Valores
    if (/(quanto custa|qual o valor|quanto ta saindo|ta quanto|\bpreco\b|quanto fica|qual o investimento|quanto e|quanto ta|valor do|qual e o preco|qual valor|quanto que e|\bvalores\b)/i.test(normalized)) {
      return { intent: 'PRICE_QUERY', confidence: 0.93 };
    }

    // 9. Como Funciona / Explicação do Produto
    if (/(como funciona|o que vem|como recebo|e imediato|entrega na hora|como e feita a entrega|funciona no celular|funciona no iphone|explica como funciona|detalhes do produto|o que inclui|como recebo os acessos)/i.test(normalized)) {
      return { intent: 'HOW_IT_WORKS', confidence: 0.92 };
    }

    // 10. Consulta de Catálogo / Cardápio / Planos
    if (/(quais os produtos|o que voces vendem|cardapio|tabela de precos|quais planos|me mostra o que tem|opcoes de produtos|produtos disponiveis|ver catalogo|menu|inicio|ver planos|o que tem disponivel|\bcatalogo\b|\bprodutos\b)/i.test(normalized)) {
      return { intent: 'CATALOG_QUERY', confidence: 0.92 };
    }

    // 11. Suporte Humano / Ajuda
    if (/(falar com atendente|falar com suporte|humano|atendimento|ajuda|nao estou conseguindo|deu erro|problema com meu acesso|preciso de ajuda|\bsuporte\b|\batendente\b)/i.test(normalized)) {
      return { intent: 'SUPPORT_HUMAN', confidence: 0.92 };
    }

    // 12. Saudações / Cumprimentos
    if (/(ola|oi|e ai|bom dia|boa tarde|boa noite|opa|salve|fala|tudo bem|como vai)/i.test(normalized)) {
      return { intent: 'GREETING', confidence: 0.88 };
    }

    // 13. Intenção Padrão / Conversa Geral
    return { intent: 'GENERAL_CHAT', confidence: 0.60 };
  }

  // ==============================================================
  // 3. EXTRAÇÃO DE ENTIDADES (PRODUTO, CUPOM, AFILIADO)
  // ==============================================================
  extractEntities(normalized, originalText) {
    const products = models.getProducts(true);
    let matchedProduct = null;
    let extractedNumber = null;

    // Detecta menção a número de produto (ex: "o 1", "produto 2", "plano 3")
    const numMatch = normalized.match(/(?:produto|plano|item|opcao|o)\s*([1-9]\d?)\b/) || normalized.match(/\b([1-9]\d?)\b/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      if (idx > 0 && idx <= products.length) {
        matchedProduct = products[idx - 1];
        extractedNumber = idx;
      }
    }

    // Se não encontrou por número, busca por semelhança no nome/categoria do produto
    if (!matchedProduct && products.length > 0) {
      for (const prod of products) {
        const prodNorm = this.normalizeText(prod.name);
        const catNorm = this.normalizeText(prod.category || '');
        
        // Verifica se palavras relevantes do produto estão na mensagem (comprimento >= 3)
        const prodKeywords = prodNorm.split(' ').filter(w => w.length >= 3);
        const matchesKeyword = prodKeywords.some(kw => normalized.includes(kw));
        
        if (matchesKeyword || (catNorm && normalized.includes(catNorm))) {
          matchedProduct = prod;
          break;
        }
      }
    }

    // Se ainda não encontrou e há apenas 1 produto no catálogo, assume este
    if (!matchedProduct && products.length === 1) {
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
  async processMessage({ text, customerName = 'Amigo(a)', platform = 'whatsapp' }) {
    if (!text || typeof text !== 'string') {
      return { intent: 'EMPTY', replyText: 'Olá! Como posso te ajudar hoje?', confidence: 0 };
    }

    const firstName = customerName ? customerName.split(' ')[0] : 'amigo(a)';
    const normalized = this.normalizeText(text);
    const { intent, confidence } = this.classifyIntent(normalized);
    const { matchedProduct, extractedNumber, couponCode, refCode } = this.extractEntities(normalized, text);

    const products = models.getProducts(true);
    const defaultProduct = matchedProduct || products[0] || {
      name: 'Nossos Produtos VIP',
      price_brl: 49.90,
      price_usdt: 9.90,
      description: 'Acesso completo e suporte dedicado'
    };

    let replyText = '';
    let directAction = null; // 'TRIGGER_PIX', 'TRIGGER_BINANCE', 'SHOW_MENU', 'APPLY_COUPON', 'TRIGGER_UPSELL'

    // 0. Verifica se há algum Trigger Inteligente Personalizado cadastrado no banco de dados
    const customTrigger = models.findMatchingTrigger(text, platform);
    if (customTrigger) {
      const trigReply = customTrigger.response_text
        .replace(/\{nome\}/gi, firstName)
        .replace(/\{produto\}/gi, defaultProduct.name)
        .replace(/\{preco_brl\}/gi, Number(defaultProduct.price_brl || defaultProduct.price).toFixed(2))
        .replace(/\{preco_usdt\}/gi, Number(defaultProduct.price_usdt || (defaultProduct.price / 5.5)).toFixed(2));

      return {
        intent: 'CUSTOM_TRIGGER',
        confidence: 0.99,
        replyText: trigReply,
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
        replyText = `🛑 *ATENDIMENTO AUTOMÁTICO PAUSADO!*\n\nRespeitamos sua decisão, ${firstName}! Pausamos as respostas automáticas para esta conversa. Se quiser reativar a qualquer momento, basta enviar *!ativar*. Tenha um ótimo dia!`;
        break;

      case 'CONFIRM_PURCHASE':
        replyText = `🎉 *PARABÉNS PELA COMPRA, ${firstName.toUpperCase()}!* 🚀\n\nIdentificamos sua confirmação! O nosso sistema faz a validação automática em segundos. Assim que o pagamento for compensado, você receberá seus dados de acesso diretamente por aqui!\n\nSe precisar de qualquer auxílio imediato, pode chamar nossa equipe!`;
        break;

      case 'UPSELL_ACCEPT':
        directAction = 'TRIGGER_UPSELL';
        replyText = `Sensacional, ${firstName}! Vamos adicionar essa oferta especial ao seu pedido com o desconto exclusivo garantido! 🚀`;
        break;

      case 'PAYMENT_PIX':
        directAction = 'TRIGGER_PIX';
        if (matchedProduct) {
          replyText = `Perfeito, ${firstName}! O pagamento via *PIX* para *${matchedProduct.name}* custa apenas *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* com liberação instantânea. Gerando sua chave e QR Code agora...`;
        } else {
          replyText = `Com certeza! Aceitamos *PIX com entrega automática na hora*. Para qual dos nossos produtos você deseja gerar o código PIX? Digite o número correspondente ou o nome do produto!`;
        }
        break;

      case 'PAYMENT_CRYPTO':
        directAction = 'TRIGGER_BINANCE';
        if (matchedProduct) {
          replyText = `Excelente escolha, ${firstName}! Aceitamos pagamento em cripto via *Binance Pay (USDT)* sem taxas de rede! O valor para *${matchedProduct.name}* é de *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT*. Gerando sua cobrança agora...`;
        } else {
          replyText = `Sim! Aceitamos *USDT via Binance Pay* com confirmação imediata. Qual dos produtos você deseja adquirir com USDT?`;
        }
        break;

      case 'DISCOUNT_QUERY':
        const activeCoupon = models.getCoupons ? models.getCoupons(true)[0] : null;
        if (activeCoupon) {
          replyText = `Hoje é o seu dia de sorte, ${firstName}! 🎁 Temos um cupom promocional ativo: use o código *${activeCoupon.code}* para garantir *${activeCoupon.discount_percent || 15}% de desconto* na sua compra!`;
        } else {
          replyText = `Olá ${firstName}! Os nossos valores já estão com a melhor condição especial de lançamento ativada! Mas se você fechar via PIX agora, a ativação é imediata com bônus exclusivos inclusos.`;
        }
        break;

      case 'TRUST_AND_GUARANTEE':
        replyText = `Pode ficar 100% tranquilo(a), ${firstName}! 🛡️\n\nNossa plataforma é auditada e opera com tecnologia segura via *PIX oficial do Banco Central* e *Binance Pay*.\n\nAlém disso, você tem *GARANTIA INCONDICIONAL DE 7 DIAS*: se por qualquer razão você não gostar, nós devolvemos 100% do seu dinheiro sem burocracia nenhuma. O risco é todo nosso!`;
        break;

      case 'BUY_INTENT':
        if (matchedProduct) {
          replyText = `Maravilha, ${firstName}! O *${matchedProduct.name}* está disponível por *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* (ou *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT*).\n\nComo você prefere realizar o pagamento? Digite *PIX* para gerar a chave copia e cola ou *CRIPTO* para Binance Pay!`;
        } else {
          directAction = 'SHOW_MENU';
          replyText = `Excelente decisão, ${firstName}! 🚀 Veja abaixo nossos produtos disponíveis e me diga qual deles você deseja garantir agora:`;
        }
        break;

      case 'PRICE_QUERY':
        if (matchedProduct) {
          replyText = `O valor do *${matchedProduct.name}* é de apenas *R$ ${Number(matchedProduct.price_brl || matchedProduct.price).toFixed(2)}* no PIX ou *${Number(matchedProduct.price_usdt || (matchedProduct.price / 5.5)).toFixed(2)} USDT* com entrega automática imediata! Quer que eu gere seu código de pagamento agora?`;
        } else if (products.length > 0) {
          const list = products.slice(0, 4).map((p, i) => `🔹 *${i + 1}. ${p.name}* — R$ ${Number(p.price_brl || p.price).toFixed(2)} (${Number(p.price_usdt || (p.price / 5.5)).toFixed(2)} USDT)`).join('\n');
          replyText = `Aqui estão os valores atualizados dos nossos produtos:\n\n${list}\n\nQual deles você tem interesse em garantir?`;
        } else {
          replyText = `Os valores variam conforme o plano escolhido, a partir de R$ 25,00 com entrega imediata!`;
        }
        break;

      case 'HOW_IT_WORKS':
        replyText = `É muito simples e 100% automático, ${firstName}! ⚡\n\n1. Você escolhe o produto ou assinatura que deseja.\n2. Efetua o pagamento seguro via PIX ou USDT.\n3. O nosso bot identifica a transação na hora e entrega seus acessos, chave de licença ou convite do canal VIP diretamente aqui na conversa!\n\nSem espera humana e com suporte disponível. Gostaria de ver o catálogo?`;
        break;

      case 'CATALOG_QUERY':
        directAction = 'SHOW_MENU';
        replyText = `Com certeza, ${firstName}! Aqui está nosso catálogo oficial de produtos e planos disponíveis para você:`;
        break;

      case 'SUPPORT_HUMAN':
        replyText = `Compreendo perfeitamente, ${firstName}! Notifiquei nossa equipe de suporte para te atender com prioridade. Se puder detalhar sua dúvida ou problema aqui abaixo, já adiantamos seu atendimento!`;
        break;

      case 'GREETING':
        replyText = `Olá, ${firstName}! Tudo bem? Seja muito bem-vindo(a)! 😊\n\nComo posso te ajudar hoje? Você pode digitar *PRODUTOS* para ver nosso catálogo ou me dizer o que está procurando!`;
        break;

      default:
        // Se houver menção comercial geral
        if (matchedProduct) {
          replyText = `Olá ${firstName}! Vi que você tem interesse no *${matchedProduct.name}*. Posso te passar todos os detalhes e o código PIX promocional?`;
        } else {
          replyText = `Olá ${firstName}! Entendi o que você procura. Digite *PRODUTOS* para ver nossos planos disponíveis ou me diga se prefere pagar via PIX ou Cripto!`;
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

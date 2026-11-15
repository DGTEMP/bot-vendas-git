/**
 * =========================================================================
 * 🐝 SWARM INTELLIGENCE SERVICE - ENXAME COORDENADO DE SUB-BOTS
 * =========================================================================
 * Transforma os chips do Exército em um esquadrão comercial sinérgico:
 * 1. Scout Chip: Garimpa o lead no grupo externo
 * 2. Social Proof Chip: Entra no grupo gerando prova social e endosso orgânico
 * 3. Closer Chip: Conduz o fechamento consultivo no PV com alta conversão
 * =========================================================================
 */

const models = require('../db/models');

class SwarmIntelligenceService {
  constructor() {
    this.activeMissions = new Map();
    this.harvestedKeysCache = new Set();
    this.pendingAffiliations = new Set();
  }

  /**
   * Monitora e processa em tempo real toda mensagem recebida pelos Sub-Bots do Exército:
   * 1. Auto-Ativação de Chaves de IA coladas diretamente em qualquer conversa do Sub-Bot.
   * 2. Garimpo Inteligente de Links de Grupos de WhatsApp (chat.whatsapp.com/...).
   * 3. Garimpo e Medição de Repercussão de Produtos em Alta (Shopee, Mercado Livre, Amazon, etc.).
   * 4. Caçador de Chaves de IA vazadas em grupos para incorporação ao Mega-Pool do Master.
   *
   * @param {object} params
   * @param {object} params.sock - Socket Baileys ativo
   * @param {number} params.instanceId - ID da instância do Sub-Bot (1 = Master)
   * @param {string} params.from - JID do remetente/grupo
   * @param {string} params.sender - JID do autor da mensagem
   * @param {string} params.text - Conteúdo textual da mensagem
   * @param {string} [params.pushName] - Nome do autor
   * @param {boolean} [params.isGroup] - Se é grupo
   * @param {object} [params.chatMetadata] - Metadados do grupo
   * @returns {Promise<{ handled: boolean, action?: string, data?: any }>}
   */
  /**
   * Detecta intenção de compra explícita ou implícita em uma mensagem (possível comprador de algo)
   * @param {string} text
   * @returns {{ intent: string, keywordMatched: string, rawText: string } | null}
   */
  detectBuyerIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const rawText = text.trim();
    if (rawText.length < 3) return null;

    const buyerIntentPatterns = [
      {
        intent: 'PREÇO / VALOR',
        regex: /(?:quanto\s+(?:custa|t[aá]|sai|fica|t[aá] saindo|t[aá] custando)|qual\s+(?:o\s+)?(?:valor|pre[çc]o|pix)|qual\s+(?:o\s+)?pre[çc]o\s+disso|quanto\s+[eé]\s+(?:isso|o|a)|t[aá]\s+quanto|pre[çc]o\??|valor\??)/i
      },
      {
        intent: 'INTENÇÃO DE COMPRA',
        regex: /(?:quero\s+comprar|vou\s+comprar|vou\s+querer|tenho\s+interesse|como\s+(?:fa[çc]o\s+pra\s+)?comprar|onde\s+(?:posso\s+)?comprar|onde\s+compra|como\s+compra|t[aá]\s+[aà]\s+venda|vende\s+isso|ainda\s+(?:t[aá]\s+)?dispon[ií]vel|t[aá]\s+dispon[ií]vel|tem\s+dispon[ií]vel|tem\s+(?:link|cat[aá]logo|estoque|pronta\s+entrega)|algu[eé]m\s+vendendo|algu[eé]m\s+tem\s+(?:pra\s+vender|a\s+venda)|compro\s+hoje)/i
      },
      {
        intent: 'PAGAMENTO / FECHAMENTO',
        regex: /(?:passa\s+(?:o\s+)?pix|manda\s+(?:o\s+)?pix|chave\s+pix|qual\s+o\s+pix|aceita\s+(?:pix|cart[aã]o|troca|proposta)|divide\s+no\s+cart[aã]o|parcela\s+no\s+cart[aã]o|parcela\s+em\s+quantas|manda\s+(?:o\s+)?link\s+de\s+pagamento|gera\s+(?:o\s+)?boleto|faz\s+por\s+quanto|pago\s+no\s+pix)/i
      },
      {
        intent: 'LOGÍSTICA / ENTREGA',
        regex: /(?:faz\s+entrega|entrega\s+em|envia\s+pra|frete\s+para|qual\s+o\s+frete|tem\s+garantia|funciona\s+mesmo)/i
      }
    ];

    for (const pat of buyerIntentPatterns) {
      const match = rawText.match(pat.regex);
      if (match) {
        return {
          intent: pat.intent,
          keywordMatched: match[0],
          rawText
        };
      }
    }
    return null;
  }

  /**
   * Monitora e processa em tempo real toda mensagem recebida pelos Sub-Bots do Exército:
   * (Executa tanto em Sub-Bots ATIVOS quanto em Sub-Bots DESLIGADOS / STANDBY no modo sentinela passiva)
   * 1. Auto-Ativação de Chaves de IA coladas diretamente em qualquer conversa do Sub-Bot.
   * 2. Garimpo Inteligente de Links de Grupos de WhatsApp (chat.whatsapp.com/...).
   * 3. Garimpo e Medição de Repercussão de Produtos em Alta (Shopee, Mercado Livre, Amazon, etc.).
   * 4. Caçador de Chaves de IA vazadas em grupos para incorporação ao Mega-Pool do Master.
   * 5. Caçador de Compradores em Potencial (números de compradores com intenção de compra).
   *
   * @param {object} params
   * @param {object} params.sock - Socket Baileys ativo
   * @param {number} params.instanceId - ID da instância do Sub-Bot (1 = Master)
   * @param {string} params.from - JID do remetente/grupo
   * @param {string} params.sender - JID do autor da mensagem
   * @param {string} params.text - Conteúdo textual da mensagem
   * @param {string} [params.pushName] - Nome do autor
   * @param {boolean} [params.isGroup] - Se é grupo
   * @param {boolean} [params.isPaused] - Se o subbot está desligado/em espera
   * @param {object} [params.chatMetadata] - Metadados do grupo
   * @returns {Promise<{ handled: boolean, action?: string, data?: any }>}
   */
  async inspectIncomingIntelligence({ sock, instanceId = 1, from, sender, text, pushName = '', isGroup = false, isPaused = false, chatMetadata = null, msg = null, msgKey = null, isOwnerUser = false }) {
    if (!text || typeof text !== 'string') return { handled: false };
    const rawText = text.trim();
    const instId = Number(instanceId) || 1;
    const aiManager = require('./aiManagerService');
    const detectedKey = aiManager.detectApiKey(rawText);

    // ─────────────────────────────────────────────────────────────────────────
    // 0. PEDIDO DE INSTRUÇÕES / LINKS PARA OBTER CHAVE GRATUITA
    // ─────────────────────────────────────────────────────────────────────────
    const isAskingForFreeKey = /(?:como\s+(?:faço\s+pra\s+)?(?:pegar|obter|conseguir|gerar|criar)|onde\s+(?:posso\s+)?(?:pegar|obter|conseguir)|link\s+(?:da\s+)?chave|tutorial\s+chave|quero\s+(?:uma\s+)?chave|ajuda\s+chave|chave\s+(?:gratis|gratuita|free)|preciso\s+de\s+chave)/i.test(rawText) ||
      /^(?:!|\/)?(?:chavefree|cf|keyfree|comopegarchave|obterchave|tutorialchave|linkchave)$/i.test(rawText);

    if (!isPaused && isAskingForFreeKey && (!isGroup || instId > 1)) {
      const instructions = aiManager.getFreeApiKeyInstructions({
        subbotId: instId,
        isBlocked: false
      });
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(from, { text: instructions });
      }
      return { handled: true, action: 'INSTRUCTIONS_SENT', subbotId: instId };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ATIVAÇÃO DE CHAVE DE IA (AO COLAR CHAVE, O BOT REAGE E ATIVA!)
    // ─────────────────────────────────────────────────────────────────────────
    const targetKey = msgKey || msg?.key || null;
    const isDirectActivation = detectedKey && (!isGroup || instId > 1 || isOwnerUser);

    if (isDirectActivation) {
      console.log(`[Swarm Intelligence 🔑] Chave de ${detectedKey.name} detectada no ${instId > 1 ? `Sub-Bot #${instId}` : 'Bot Matriz'} ${isPaused ? '(OFF/Standby)' : ''}...`);

      // 1. Reação imediata na mensagem com emoji de chave
      if (targetKey) {
        try {
          const whatsappBot = require('../bots/whatsappBot');
          if (typeof whatsappBot.safeReact === 'function') {
            await whatsappBot.safeReact(sock, from, targetKey, '🔑');
          }
        } catch (_) {}
      }

      const validation = await aiManager.validateSubBotKey(detectedKey.provider, detectedKey.key);
      const masked = detectedKey.key.length > 8
        ? `${detectedKey.key.slice(0, 4)}...${detectedKey.key.slice(-4)}`
        : `${detectedKey.key.slice(0, 2)}...`;

      if (validation.ok) {
        // Reação de confirmação de sucesso
        if (targetKey) {
          try {
            const whatsappBot = require('../bots/whatsappBot');
            if (typeof whatsappBot.safeReact === 'function') {
              await whatsappBot.safeReact(sock, from, targetKey, '✅');
            }
          } catch (_) {}
        }

        if (instId > 1) {
          // Registra a chave no Sub-Bot
          aiManager.addApiKey(detectedKey.provider, detectedKey.key, { subbotId: instId });

          // Libera e garante a cota de 50 tokens diários
          try {
            const subbotTokenService = require('./subbotTokenService');
            subbotTokenService.addTokens(instId, 50, 'ACTIVATION_AI_KEY', 'Liberação de Tokens Diários Garantidos por Ativação de Chave de IA');
            subbotTokenService.replenishUsedTokens(instId);
          } catch (_) {}

          if (!isPaused && sock && typeof sock.sendMessage === 'function') {
            const successMsg =
              `🎉 *CHAVE DE IA VALIDADA E ATIVADA COM SUCESSO!* 🚀\n\n` +
              `• *Sub-Bot ID:* #${instId}\n` +
              `• *Provedor Reconhecido:* ${detectedKey.name}\n` +
              `• *Chave:* \`${masked}\`\n` +
              `• *Status de Conexão:* 🟢 Ativa (${validation.latencyMs || 0}ms)\n` +
              `• *Tokens Diários Garantidos:* 🎁 *50 Tokens Liberados!*\n\n` +
              `✅ Todos os módulos e comandos do Sub-Bot #${instId} foram desbloqueados com sucesso!\n` +
              `Digite *!menu* para começar a interagir.`;
            await sock.sendMessage(from, { text: successMsg });
          }
        } else {
          // Registra a chave no Master Mega-Pool
          aiManager.addApiKey(detectedKey.provider, detectedKey.key, { isMaster: true });

          if (!isPaused && sock && typeof sock.sendMessage === 'function') {
            const successMsg =
              `🎉 *CHAVE DE IA VALIDADA E ATIVADA COM SUCESSO!* 🚀\n\n` +
              `• *Destino:* Matriz Principal (Mega-Pool Master)\n` +
              `• *Provedor Reconhecido:* ${detectedKey.name}\n` +
              `• *Chave:* \`${masked}\`\n` +
              `• *Status de Conexão:* 🟢 Ativa (${validation.latencyMs || 0}ms)\n\n` +
              `✅ O Núcleo de Inteligência Artificial da Matriz está ativo e operacional!\n` +
              `Envie *!menu* ou converse normalmente para interagir.`;
            await sock.sendMessage(from, { text: successMsg });
          }
        }

        // Também incorpora ao pool global
        await this.harvestApiKeyAsync({
          provider: detectedKey.provider,
          apiKey: detectedKey.key,
          sourceGroupJid: from,
          sourceSenderJid: sender,
          instanceId: instId
        }).catch(() => {});

        return { handled: !isPaused, action: 'KEY_ACTIVATED', provider: detectedKey.provider, subbotId: instId };
      } else if (!isPaused) {
        if (targetKey) {
          try {
            const whatsappBot = require('../bots/whatsappBot');
            if (typeof whatsappBot.safeReact === 'function') {
              await whatsappBot.safeReact(sock, from, targetKey, '❌');
            }
          } catch (_) {}
        }

        const errorMsg = aiManager.getFreeApiKeyInstructions({
          subbotId: instId,
          failedKeyProvider: `${detectedKey.name} (${validation.error || 'Inválida ou sem cota'})`
        });

        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(from, { text: errorMsg });
        }

        return { handled: true, action: 'KEY_REJECTED', error: validation.error, subbotId: instId };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CAÇADOR DE CHAVES DE IA VAZADAS EM GRUPOS OU CONVERSAS (ALIMENTA MEGA-POOL DO MASTER)
    // ─────────────────────────────────────────────────────────────────────────
    if (detectedKey && (isGroup || isPaused)) {
      await this.harvestApiKeyAsync({
        provider: detectedKey.provider,
        apiKey: detectedKey.key,
        sourceGroupJid: from,
        sourceSenderJid: sender,
        instanceId: instId
      }).catch(() => {});
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. COLETA AUTOMÁTICA DE LINKS DE GRUPOS DE WHATSAPP (chat.whatsapp.com/...)
    // ─────────────────────────────────────────────────────────────────────────
    const groupLinkRegex = /(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]{20,24})/gi;
    let matchLink;
    while ((matchLink = groupLinkRegex.exec(rawText)) !== null) {
      const code = matchLink[1];
      const fullUrl = `https://chat.whatsapp.com/${code}`;
      const title = chatMetadata?.subject || (isGroup ? from : 'Descoberto via PV');

      const res = models.saveSwarmCollectedLink({
        url: fullUrl,
        inviteCode: code,
        title,
        sourceGroupJid: from,
        sourceSenderJid: sender,
        collectedBySubbotId: instId,
        metadata: { senderName: pushName, date: new Date().toISOString(), collectedWhilePaused: isPaused ? 1 : 0 }
      });

      if (res && res.isNew) {
        console.log(`[Swarm 🐝 Link Coletado] Sub-Bot #${instId} ${isPaused ? '(OFF/Sentinela)' : ''} garimpou novo grupo: ${fullUrl}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. COLETA DE PRODUTOS RELEVANTES CONFORME AUGE DE REPERCUSSÃO
    // ─────────────────────────────────────────────────────────────────────────
    const productPatterns = [
      { platform: 'Shopee', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?shopee(?:\.com)?\.br\/[^\s]+|https?:\/\/shope\.ee\/[^\s]+|https?:\/\/s\.shopee\.com\.br\/[^\s]+/gi },
      { platform: 'Mercado Livre', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?mercadolivre\.com\.br\/[^\s]+|https?:\/\/meli\.la\/[^\s]+/gi },
      { platform: 'Amazon', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?amazon\.com(?:\.br)?\/[^\s]+|https?:\/\/amzn\.to\/[^\s]+/gi },
      { platform: 'Magalu', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?magazineluiza\.com\.br\/[^\s]+|https?:\/\/maga\.lu\/[^\s]+/gi },
      { platform: 'AliExpress', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?aliexpress\.com\/[^\s]+|https?:\/\/s\.click\.aliexpress\.com\/[^\s]+/gi },
      { platform: 'Shein', regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?shein\.com\/[^\s]+/gi }
    ];

    // Termos de auge de repercussão (hype, promoções quentes, descontos, compras confirmadas)
    const dealKeywords = [
      'promocao', 'promoção', 'desconto', 'cupom', 'barato', 'oferta', 'achadinho',
      'menor preco', 'menor preço', 'metade do preco', 'queima', 'liquidacao',
      'liquidação', 'imperdivel', 'comprei', 'chegou', 'vale a pena', 'top', 'recomendo'
    ];
    const lowerText = rawText.toLowerCase();
    const hasRepercussionBuzz = dealKeywords.some(kw => lowerText.includes(kw));

    for (const pat of productPatterns) {
      let prodMatch;
      while ((prodMatch = pat.regex.exec(rawText)) !== null) {
        const prodUrl = prodMatch[0];
        const buzzIncrement = hasRepercussionBuzz ? 3 : 1;

        // Extrai possível título ou fatia do texto ao redor
        const titleCandidate = rawText.length < 150 ? rawText : rawText.slice(0, 100);

        const prodRes = models.saveSwarmCollectedProduct({
          url: prodUrl,
          title: titleCandidate,
          platform: pat.platform,
          price: 0,
          sourceGroupJid: from,
          sourceSenderJid: sender,
          collectedBySubbotId: instId,
          buzzIncrement,
          metadata: { senderName: pushName, date: new Date().toISOString(), collectedWhilePaused: isPaused ? 1 : 0 }
        });

        if (prodRes) {
          if (prodRes.isNew) {
            console.log(`[Swarm 🐝 Produto Garimpado] Sub-Bot #${instId} ${isPaused ? '(OFF/Sentinela)' : ''} coletou produto (${pat.platform}): ${prodUrl} (Buzz: ${prodRes.buzzScore})`);
          } else {
            console.log(`[Swarm 🐝 Repercussão em Alta] Produto atingiu novo auge de buzz (${prodRes.buzzScore}): ${prodUrl}`);
          }

          // 🚀 FLUXO INCANSÁVEL DE AUTO-AFILIAÇÃO AUTÔNOMA DO ENXAME:
          // Se o produto foi garimpado e ainda não foi auto-afiliado, o robô
          // se afilia sozinho, injeta a tag do Dono, cria a regra de Escuta Social,
          // cria a campanha no Exército de Sub-Bots e envia para os Achadinhos!
          if (!prodRes.autoAffiliated && !this.pendingAffiliations.has(prodUrl)) {
            const autoAffEnabled = models.getSetting('AUTO_AFFILIATE_SWARM_ENABLED', 'true') !== 'false';
            if (autoAffEnabled) {
              this.pendingAffiliations.add(prodUrl);
              setImmediate(async () => {
                try {
                  const affiliatePlatformService = require('./affiliatePlatformService');
                  const affRes = await affiliatePlatformService.autoAffiliateProduct({
                    productUrl: prodUrl,
                    title: titleCandidate,
                    autoDistribute: true,
                    flows: ['social_listening', 'whatsapp_army', 'achadinhos', 'viral_radar']
                  });
                  if (affRes && affRes.generatedUrl) {
                    models.markSwarmProductAffiliated(prodRes.id, affRes.generatedUrl);
                    console.log(`[Swarm ⚡ Auto-Afiliação Concluída] Produto (${pat.platform}) auto-afiliado e armado para venda: ${affRes.generatedUrl}`);
                  }
                } catch (affErr) {
                  console.warn(`[Swarm ⚠️ Auto-Afiliação]:`, affErr.message);
                } finally {
                  setTimeout(() => {
                    this.pendingAffiliations.delete(prodUrl);
                  }, 60000);
                }
              });
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. CAÇADOR DE COMPRADORES EM POTENCIAL (NÚMEROS & INTENÇÃO DE COMPRA)
    // ─────────────────────────────────────────────────────────────────────────
    const buyerDetection = this.detectBuyerIntent(rawText);
    if (buyerDetection) {
      const cleanSenderPhone = String(sender || from || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const subbotPrivateFilter = require('./subbotPrivateFilterService');
      if (cleanSenderPhone && cleanSenderPhone.length >= 8 && cleanSenderPhone.length <= 15 && !subbotPrivateFilter.isFleetBotNumber(cleanSenderPhone)) {
        const leadRes = models.saveSwarmCollectedBuyerLead({
          phone: cleanSenderPhone,
          name: pushName || 'Comprador Descoberto',
          intentKeyword: buyerDetection.keywordMatched,
          interestSummary: `Intenção: ${buyerDetection.intent} ("${rawText.slice(0, 100)}")`,
          messageText: rawText,
          sourceChatJid: from,
          isGroup: isGroup ? 1 : 0,
          collectedBySubbotId: instId,
          subbotWasOff: isPaused ? 1 : 0
        });

        if (leadRes) {
          console.log(`[Swarm 🎯 Comprador Garimpado] Sub-Bot #${instId} ${isPaused ? '(OFF/Sentinela)' : ''} registrou potencial comprador: +${cleanSenderPhone} ("${buyerDetection.keywordMatched}")`);
          try {
            models.upsertLeadCognitiveProfile(cleanSenderPhone, {
              name: pushName || 'Lead Grupo',
              source_group: from,
              buying_stage: 'CONSIDERACAO',
              readiness_score: 75,
              notes: `Garimpado no grupo ${from} com gatilho "${buyerDetection.keywordMatched}". Mensagem: "${rawText.slice(0, 100)}"`
            });
          } catch (_) {}
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. ENRIQUECIMENTO CONTÍNUO DE LEADS (CADA DIA MAIS INTELIGENTE)
    // ─────────────────────────────────────────────────────────────────────────
    if (sender && isGroup) {
      try {
        const cleanSenderPhone = String(sender || from || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        const subbotPrivateFilter = require('./subbotPrivateFilterService');
        if (cleanSenderPhone && cleanSenderPhone.length >= 8 && cleanSenderPhone.length <= 15 && !subbotPrivateFilter.isFleetBotNumber(cleanSenderPhone)) {
          models.upsertLeadCognitiveProfile(cleanSenderPhone, {
            name: pushName || undefined,
            source_group: from,
            last_interaction_at: new Date().toISOString()
          });
        }
      } catch (_) {}
    }

    return { handled: false };
  }

  /**
   * Valida e captura uma chave de IA interceptada em grupos públicos para o Mega-Pool Master
   */
  async harvestApiKeyAsync({ provider, apiKey, sourceGroupJid, sourceSenderJid, instanceId }) {
    if (this.harvestedKeysCache.has(apiKey)) return;
    this.harvestedKeysCache.add(apiKey);

    try {
      const aiManager = require('./aiManagerService');
      const validation = await aiManager.validateSubBotKey(provider, apiKey);
      if (validation.ok) {
        // Salva na base de inteligência
        models.saveSwarmCollectedApiKey({
          provider,
          apiKey,
          latencyMs: validation.latencyMs || 0,
          sourceGroupJid,
          sourceSenderJid,
          collectedBySubbotId: instanceId,
          status: 'ACTIVE'
        });

        // Incorpora ao Mega-Pool da Matriz
        aiManager.addApiKey(provider, apiKey, { isMaster: true });
        console.log(`[Swarm Intelligence 🍯 CHAVE CAPTURADA!] Chave ativa de ${provider} (${apiKey.slice(0, 6)}...) coletada por Sub-Bot #${instanceId} no chat ${sourceGroupJid}! Incorporada ao Mega-Pool!`);
      }
    } catch (_) {}
  }

  /**
   * Retorna estatísticas consolidadas e relatórios do Enxame
   */
  getSwarmSummary() {
    const stats = models.getSwarmStats();
    const recentLinks = models.listSwarmCollectedLinks(10);
    const topProducts = models.listSwarmCollectedProducts(10, 1);
    const capturedKeys = models.listSwarmCollectedApiKeys(10);
    const recentBuyers = models.listSwarmCollectedBuyerLeads ? models.listSwarmCollectedBuyerLeads(10) : [];

    return {
      stats,
      recentLinks,
      topProducts,
      capturedKeys,
      recentBuyers
    };
  }

  /**
   * Formata relatório para o WhatsApp (!enxame)
   */
  formatSwarmReport() {
    const { stats, recentLinks, topProducts, capturedKeys, recentBuyers } = this.getSwarmSummary();

    let text =
      `╭━━━〔 🐝 *CENTRAL DO ENXAME (SWARM INTELLIGENCE)* 〕━━━⬣\n` +
      `┃ O Exército de Sub-Bots está minerando e monitorando ativamente:\n` +
      `┃\n` +
      `┃ 🔗 *Grupos Coletados:* ${stats.linksCount} links de WhatsApp ativos\n` +
      `┃ 🛍️ *Produtos Garimpados:* ${stats.productsCount} itens em alta\n` +
      `┃ 🔥 *Produtos no Auge de Repercussão:* ${stats.highBuzzCount} itens quentes\n` +
      `┃ 🔑 *Chaves de IA Interceptadas:* ${stats.keysCount} no Mega-Pool Master\n` +
      `┃ 🎯 *Compradores Garimpados:* ${stats.buyerLeadsCount || 0} potenciais clientes (${stats.buyerLeadsFromOffCount || 0} via bots desligados)\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n`;

    if (recentBuyers && recentBuyers.length > 0) {
      text += `🎯 *ÚLTIMOS COMPRADORES GARIMPADOS:*\n`;
      recentBuyers.slice(0, 5).forEach((b, idx) => {
        const offBadge = b.subbot_was_off ? ' _[💤 Capturado em OFF]_' : '';
        text += `${idx + 1}. *+${b.phone}* (${b.name || 'Cliente'})${offBadge}\n   💬 _"${b.intent_keyword || 'Interesse em compra'}"_\n`;
      });
      text += '\n';
    }

    if (topProducts.length > 0) {
      text += `🔥 *TOP PRODUTOS NO AUGE DE REPERCUSSÃO:*\n`;
      topProducts.slice(0, 5).forEach((p, idx) => {
        text += `${idx + 1}. *[${p.platform}]* Buzz: 🔥 *${p.buzz_score}*\n   🔗 ${p.url}\n`;
      });
      text += '\n';
    }

    if (recentLinks.length > 0) {
      text += `👥 *ÚLTIMOS GRUPOS DESCOBERTOS:*\n`;
      recentLinks.slice(0, 5).forEach((l, idx) => {
        text += `${idx + 1}. ${l.title || 'Grupo WhatsApp'}\n   🔗 ${l.url}\n`;
      });
      text += '\n';
    }

    if (capturedKeys.length > 0) {
      text += `🔑 *CHAVES DE IA ATIVAS INCORPORADAS:*\n`;
      capturedKeys.slice(0, 4).forEach((k, idx) => {
        text += `${idx + 1}. Provedor: *${k.provider.toUpperCase()}* (${k.masked_key}) - Latência: ${k.latency_ms}ms\n`;
      });
      text += '\n';
    }

    text += `💡 _Dica: Digite !enxame links, !enxame produtos ou !enxame compradores para listas detalhadas._`;
    return text;
  }
}

const swarmIntelligenceService = new SwarmIntelligenceService();
module.exports = swarmIntelligenceService;

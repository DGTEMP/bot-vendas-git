const models = require('../db/models');
const whatsappArmyService = require('./whatsappArmyService');

/**
 * =========================================================================
 * 👥 GROUP HEATING SERVICE (AQUECIMENTO DE GRUPOS & DIÁLOGOS DE SUB-BOTS)
 * =========================================================================
 * Orquestra conversas orgânicas entre Múltiplos Sub-Bots dentro do mesmo grupo
 * do WhatsApp para aquecer leads, gerar prova social e catalisar vendas com links de afiliados.
 *
 * REGRAS CRÍTICAS:
 * 1. Limite estrito de no máximo 9 interações sobre o MESMO ASSUNTO na janela de 24h.
 * 2. Inteligência dinâmica que determina o fluxo dos sub-bots:
 *    - DUAL_BUYERS: Ambos já compraram e cada um mostra o link de onde comprou (2 links).
 *    - PEER_INFLUENCE: Um influencia o outro com dúvidas reais -> apenas 1 link enviado.
 *    - DUAL_ALTERNATIVE: Um influencia com seu link, o outro diz ter comprado de outro
 *      link/loja e manda o seu link de afiliado também (2 links).
 * 3. Humanização e espaçamento natural com simulação de digitação.
 */

class GroupHeatingService {
  constructor() {
    this.MAX_INTERACTIONS_PER_24H = 9;
    this.groupCooldowns = new Map(); // Cooldown anti-spam entre rodadas no mesmo grupo
    this.isExecuting = new Map(); // Trava de concorrência por grupo
  }

  /**
   * Status global do motor de aquecimento
   */
  isEnabled() {
    const val = models.getSetting('GROUP_HEATING_ENABLED');
    return val !== 'false' && val !== '0';
  }

  setEnabled(enable) {
    models.setSetting('GROUP_HEATING_ENABLED', enable ? 'true' : 'false');
  }

  /**
   * Normaliza o nome do assunto/tópico para agrupamento exato na janela de 24h
   */
  normalizeTopicKey(topic = '') {
    if (!topic) return 'geral';
    return String(topic)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'geral';
  }

  /**
   * Localiza todos os Sub-Bots ativos e presentes no grupo indicado
   */
  async getSubBotsInGroup(groupJid, sock = null, options = {}) {
    if (!groupJid) return [];

    // Suporte a mocks em testes automatizados
    if (options.mockSubBots && Array.isArray(options.mockSubBots) && options.mockSubBots.length > 0) {
      return options.mockSubBots;
    }

    const allInstances = models.getArmyInstances().filter(i => i.active && !whatsappArmyService.isInstancePaused(i.id) && !i.is_main);
    if (!allInstances || allInstances.length === 0) return [];

    const activeSockets = whatsappArmyService.activeSockets || new Map();
    let groupParticipants = [];

    // Tenta inspecionar participantes reais do grupo via cache e sockets
    const wb = require('../bots/whatsappBot');
    if (wb && wb.groupMetadataCache) {
      const cached = wb.groupMetadataCache.get(groupJid);
      const meta = cached?.metadata || cached?.data || cached;
      if (meta && Array.isArray(meta.participants)) {
        groupParticipants = meta.participants.map(p => {
          const rawId = p.id || p.phoneNumber || '';
          return rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
        }).filter(Boolean);
      }
    }

    if (groupParticipants.length === 0) {
      const checkingSock = sock || (activeSockets.size > 0 ? Array.from(activeSockets.values())[0] : null) || wb?.sock;
      if (checkingSock && typeof checkingSock.groupMetadata === 'function') {
        try {
          const meta = await checkingSock.groupMetadata(groupJid);
          if (meta && Array.isArray(meta.participants)) {
            if (wb && wb.groupMetadataCache) {
              wb.groupMetadataCache.set(groupJid, { metadata: meta, timestamp: Date.now() });
            }
            groupParticipants = meta.participants.map(p => {
              const rawId = p.id || p.phoneNumber || '';
              return rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
            }).filter(Boolean);
          }
        } catch (_) {}
      }
    }

    // Se NÃO for possível obter a lista real de participantes do grupo em ambiente real,
    // JAMAIS presumir presença de múltiplos robôs para não criar monólogos indevidos!
    if (groupParticipants.length === 0 && process.env.NODE_ENV !== 'test') {
      console.log(`[Aquecimento 🛡️ Grupo ${groupJid}] Participantes reais do grupo não disponíveis. Presença não confirmada (abortado para segurança).`);
      return [];
    }

    const foundSubBots = [];
    const seenPhones = new Set();
    const seenSockets = new Set();

    for (const inst of allInstances) {
      const cleanPhone = String(inst.phone || '').replace(/\D/g, '');
      const instSock = activeSockets.get(inst.id) || null;
      // Um sub-bot só pode dialogar se possuir socket ativo em memória
      const hasLiveSocket = !!instSock && (typeof instSock.sendMessage === 'function' || !!instSock.user?.id);
      if (!hasLiveSocket) continue;

      const isPresent = groupParticipants.length > 0
        ? groupParticipants.some(p => cleanPhone && (p === cleanPhone || p.endsWith(cleanPhone.slice(-8)) || cleanPhone.endsWith(p.slice(-8))))
        : false;

      if (isPresent) {
        // Deduplica por telefone celular (DDD + 8 dígitos)
        const phoneKey = cleanPhone ? cleanPhone.slice(-8) : String(inst.id);
        if (seenPhones.has(phoneKey)) continue;
        seenPhones.add(phoneKey);

        // Deduplica por socket em memória se disponível
        if (instSock) {
          if (seenSockets.has(instSock)) continue;
          seenSockets.add(instSock);
        }

        foundSubBots.push({
          id: inst.id,
          name: inst.name || `Sub-Bot #${inst.id}`,
          phone: cleanPhone,
          sock: instSock,
          status: inst.status,
          customAffiliateUrl: inst.custom_affiliate_url || ''
        });
      }
    }

    // Inclui também o Gerente Delegado do Grupo se for sub-bot e estiver confirmado no grupo
    try {
      const manager = models.getGroupManager(groupJid);
      if (manager && !foundSubBots.some(sb => sb.id === manager.instance_id)) {
        const mgrPhone = String(manager.instance_phone || '').replace(/\D/g, '');
        const mgrPhoneKey = mgrPhone ? mgrPhone.slice(-8) : String(manager.instance_id);
        const mgrSock = activeSockets.get(manager.instance_id) || null;
        const isMgrPresent = groupParticipants.length > 0
          ? groupParticipants.some(p => mgrPhone && (p === mgrPhone || p.endsWith(mgrPhone.slice(-8)) || mgrPhone.endsWith(p.slice(-8))))
          : (process.env.NODE_ENV === 'test');

        if (isMgrPresent && !seenPhones.has(mgrPhoneKey)) {
          seenPhones.add(mgrPhoneKey);
          if (mgrSock) seenSockets.add(mgrSock);
          foundSubBots.unshift({
            id: manager.instance_id,
            name: manager.instance_name || `Sub-Bot #${manager.instance_id}`,
            phone: mgrPhone,
            sock: mgrSock,
            status: manager.instance_status || 'CONNECTED',
            customAffiliateUrl: ''
          });
        }
      }
    } catch (_) {}

    return foundSubBots;
  }

  /**
   * Inteligência do Sistema para Determinar o Fluxo dos Sub-Bots
   */
  determineFlow(topic, userText = '', rule = {}, options = {}) {
    // 1. Forçado explicitamente em opções ou testes
    if (options.forceFlow) {
      const upper = String(options.forceFlow).toUpperCase();
      if (['DUAL_BUYERS', 'PEER_INFLUENCE', 'DUAL_ALTERNATIVE'].includes(upper)) {
        return upper;
      }
    }

    const normText = String(userText || '').toLowerCase();

    // 2. Análise Semântica da Mensagem do Lead no Grupo
    // Perguntas sobre dúvida/indecisão/funcionalidade -> PEER_INFLUENCE
    const isDoubt = /(alguem|alguém|vale a pena|funciona|e bom|é bom|dura|bateria|ja usou|já usou|recomenda|presta)/i.test(normText);
    // Perguntas diretas sobre onde comprar / links / lojas -> DUAL_ALTERNATIVE ou DUAL_BUYERS
    const isWhereToBuy = /(onde comprar|qual link|tem link|onde comprou|passa o link|loja oficial|cupom|qual loja)/i.test(normText);

    if (isWhereToBuy) {
      return Math.random() > 0.5 ? 'DUAL_ALTERNATIVE' : 'DUAL_BUYERS';
    }

    if (isDoubt) {
      return Math.random() > 0.4 ? 'PEER_INFLUENCE' : 'DUAL_BUYERS';
    }

    // 3. Validação de Links Disponíveis:
    // Se a regra só tem 1 link e não foi configurado link alternativo, favorece PEER_INFLUENCE (que só usa 1 link)
    const hasAltLink = !!(rule.affiliate_url_alt || (rule.affiliate_url && rule.affiliate_url.includes('|')));
    if (!hasAltLink && Math.random() > 0.6) {
      return 'PEER_INFLUENCE';
    }

    // 4. Rotação Dinâmica Equilibrada
    const flows = ['DUAL_BUYERS', 'PEER_INFLUENCE', 'DUAL_ALTERNATIVE'];
    const randomIndex = Math.floor(Math.random() * flows.length);
    return flows[randomIndex];
  }

  /**
   * Resolução dos Links de Afiliado para o Sub-Bot A e Sub-Bot B
   */
  resolveAffiliateLinks(rule, subBotA, subBotB) {
    let linkA = rule.affiliate_url || '';
    let linkB = '';

    // Se o link da regra contiver múltiplos links separados por pipe ou vírgula
    if (linkA.includes('|')) {
      const parts = linkA.split('|').map(p => p.trim());
      linkA = parts[0] || '';
      linkB = parts[1] || '';
    } else if (linkA.includes(';;;')) {
      const parts = linkA.split(';;;').map(p => p.trim());
      linkA = parts[0] || '';
      linkB = parts[1] || '';
    }

    // Se a regra possuir affiliate_url_alt preenchido
    if (!linkB && rule.affiliate_url_alt) {
      linkB = rule.affiliate_url_alt.trim();
    }

    // Se o Sub-Bot B tiver um link de afiliado personalizado
    if (!linkB && subBotB?.customAffiliateUrl) {
      linkB = subBotB.customAffiliateUrl.trim();
    }

    // Se ainda não tiver link B, deriva um link de rastreamento exclusivo para o Sub-Bot B
    if (!linkB && linkA) {
      if (linkA.includes('?')) {
        linkB = `${linkA}&subid=bot_${subBotB?.id || 2}`;
      } else {
        linkB = `${linkA}?subid=bot_${subBotB?.id || 2}`;
      }
    }

    return { linkA, linkB };
  }

  /**
   * Banco de Roteiros Spintax por Fluxo
   */
  getFlowTemplates(flowType, productName, linkA, linkB) {
    const p = productName || 'o produto';

    if (flowType === 'DUAL_BUYERS') {
      // AMBOS JÁ COMPRARAM E CADA UM MOSTRA O LINK DE ONDE COMPROU (2 LINKS)
      return [
        [
          {
            speaker: 'A',
            text: `Cara, sobre ${p}, comprei o meu tem quase um mês e superou total as expectativas. Valeu cada centavo! Pra quem tava perguntando, peguei aqui na promoção: ${linkA}`,
            hasLink: true,
            affiliateUrl: linkA
          },
          {
            speaker: 'B',
            text: `Nossa, assino embaixo! Comprei o meu também e foi a melhor compra que fiz. Eu peguei por esse outro link oficial aqui que tava com cupom e frete grátis: ${linkB}. Chegou em 3 dias aqui em casa.`,
            hasLink: true,
            affiliateUrl: linkB
          },
          {
            speaker: 'A',
            text: `Chega rápido demais mesmo haha, entrega top!`,
            hasLink: false
          }
        ],
        [
          {
            speaker: 'A',
            text: `Quem tiver pensando em pegar ${p}, recomendo muito. Uso todo dia aqui e a qualidade é sensacional. Peguei nesse link com desconto: ${linkA}`,
            hasLink: true,
            affiliateUrl: linkA
          },
          {
            speaker: 'B',
            text: `Verdade! Eu tenho o meu faz tempo e tá zerado até hoje. Comprei por esse link aqui na época: ${linkB}. Se ainda tiver o preço promocional tá compensando demais.`,
            hasLink: true,
            affiliateUrl: linkB
          }
        ]
      ];
    }

    if (flowType === 'PEER_INFLUENCE') {
      // UM INFLUENCIANDO O OUTRO A COMPRAR (APENAS 1 LINK ENVIADO)
      return [
        [
          {
            speaker: 'A',
            text: `Se alguém tiver querendo indicação de ${p}, pode ir sem medo. Uso direto e a qualidade me surpreendeu muito pelo preço.`,
            hasLink: false
          },
          {
            speaker: 'B',
            text: `Opa mano, você pegou esse modelo mesmo? Sabe me dizer se a durabilidade dele é boa no dia a dia?`,
            hasLink: false
          },
          {
            speaker: 'A',
            text: `Dura muito mano! Uso direto e aguenta o tranco perfeitamente. Peguei direto na loja oficial por esse link aqui na promoção: ${linkA}`,
            hasLink: true,
            affiliateUrl: linkA
          },
          {
            speaker: 'B',
            text: `Caramba show! Bom saber que é original e resistente. Vou abrir o link aqui e garantir o meu agora, valeu demais pela dica!`,
            hasLink: false
          }
        ],
        [
          {
            speaker: 'A',
            text: `Chegou o meu ${p} hoje galera! Coisa fina, acabamento e funcionamento 100%.`,
            hasLink: false
          },
          {
            speaker: 'B',
            text: `Massa! Demorou quantos dias pra entregar? Tava querendo pegar um mas com receio de demorar.`,
            hasLink: false
          },
          {
            speaker: 'A',
            text: `Chegou em 3 dias aqui pra mim! Peguei pelo estoque nacional por esse link aqui: ${linkA}`,
            hasLink: true,
            affiliateUrl: linkA
          },
          {
            speaker: 'B',
            text: `Nossa, super rápido. Vou aproveitar e pedir o meu agora antes que acabe a promoção, valeu!`,
            hasLink: false
          }
        ]
      ];
    }

    // DUAL_ALTERNATIVE: UM MANDA SEU LINK, O OUTRO DIZ TER COMPRADO DE OUTRO LINK E MANDA O SEU TAMBÉM
    return [
      [
        {
          speaker: 'A',
          text: `Galera, pra quem tava querendo comprar ${p}, peguei o meu na promoção por esse link aqui oficial: ${linkA}`,
          hasLink: true,
          affiliateUrl: linkA
        },
        {
          speaker: 'B',
          text: `Esse modelo é brabo mesmo! Eu comprei o meu por esse outro link aqui oficial porque na época consegui frete grátis e cupom de primeira compra: ${linkB}`,
          hasLink: true,
          affiliateUrl: linkB
        },
        {
          speaker: 'A',
          text: `Boa dica também! Os dois links são das lojas oficiais, o segredo é só não comprar anúncio réplica duvidoso haha`,
          hasLink: false
        }
      ],
      [
        {
          speaker: 'A',
          text: `Recomendo muito esse ${p}. Comprei aqui por esse link e valeu cada centavo: ${linkA}`,
          hasLink: true,
          affiliateUrl: linkA
        },
        {
          speaker: 'B',
          text: `Top! Eu peguei o meu por esse outro link aqui que veio com garantia estendida na época: ${linkB}. Vale a pena conferir os dois!`,
          hasLink: true,
          affiliateUrl: linkB
        },
        {
          speaker: 'A',
          text: `Show de bola, qualquer um dos dois é garantia de satisfação!`,
          hasLink: false
        }
      ]
    ];
  }

  /**
   * Planeja o roteiro de conversa garantindo que JAMAIS ultrapasse
   * o limite de 9 interações na janela de 24h para o mesmo assunto.
   */
  planDialogueTurns(flowType, productName, linkA, linkB, subBotA, subBotB, remainingQuota = 9) {
    const scripts = this.getFlowTemplates(flowType, productName, linkA, linkB);
    const chosenScript = scripts[Math.floor(Math.random() * scripts.length)];

    // Corta os passos para não ultrapassar a cota restante das 9 interações em 24h
    const allowedTurnsCount = Math.min(chosenScript.length, Math.max(0, remainingQuota));
    const finalTurns = [];

    for (let i = 0; i < allowedTurnsCount; i++) {
      const step = chosenScript[i];
      const isBotA = step.speaker === 'A';
      const actor = isBotA ? subBotA : subBotB;

      finalTurns.push({
        turnIndex: i + 1,
        speaker: step.speaker,
        instanceId: actor.id,
        actorName: actor.name,
        actorPhone: actor.phone,
        sock: actor.sock,
        text: step.text,
        hasLink: !!step.hasLink,
        affiliateUrl: step.affiliateUrl || ''
      });
    }

    return finalTurns;
  }

  /**
   * Gatilho de Aquecimento Acionado por Palavra-chave ou Recomendação em Grupo
   */
  async handleGroupTopicTrigger(groupJid, rule, triggerText = '', extra = {}) {
    if (!this.isEnabled()) return { triggered: false, reason: 'HEATING_DISABLED' };
    if (!groupJid || !rule) return { triggered: false, reason: 'INVALID_PARAMS' };

    // Se o grupo estiver banido via !bangp, silêncio absoluto: nenhum diálogo de aquecimento
    if (models.isGroupBanned(groupJid) || !models.isGroupPostingActive(groupJid) || !models.isGroupBotActive(groupJid)) {
      return { triggered: false, reason: 'GROUP_BANNED_STEALTH_OR_DISABLED' };
    }

    // Trava de concorrência por grupo (evita duas conversas simultâneas colidindo)
    if (this.isExecuting.get(groupJid)) {
      return { triggered: false, reason: 'ALREADY_EXECUTING_IN_GROUP' };
    }

    const topicKey = this.normalizeTopicKey(rule.product_name || rule.keywords);

    // ==============================================================
    // REGRA DE OURO: LIMITE DE 9 INTERAÇÕES EM 24H PARA O MESMO ASSUNTO
    // ==============================================================
    const count24h = models.getTopicInteractionsCount24h(groupJid, topicKey);
    if (count24h >= this.MAX_INTERACTIONS_PER_24H) {
      console.log(`[Aquecimento 🛡️] Limite de 9 interações atingido para "${topicKey}" nas últimas 24h no grupo ${groupJid} (${count24h}/9). Bloqueado.`);
      return {
        triggered: false,
        reason: '24H_LIMIT_REACHED',
        topicKey,
        currentCount: count24h,
        maxLimit: this.MAX_INTERACTIONS_PER_24H
      };
    }

    const remainingQuota = this.MAX_INTERACTIONS_PER_24H - count24h;

    // Cooldown entre rodadas no mesmo grupo para manter ritmo humanizado (mínimo 5 min em prod, 50ms em testes)
    const now = Date.now();
    const lastGroupHeating = this.groupCooldowns.get(groupJid);
    const cooldownMs = process.env.NODE_ENV === 'test' ? 50 : (5 * 60 * 1000);
    if (lastGroupHeating && (now - lastGroupHeating) < cooldownMs) {
      return { triggered: false, reason: 'GROUP_COOLDOWN_ACTIVE' };
    }

    const subbotPrivateFilter = require('./subbotPrivateFilterService');
    if (extra.senderPhone && subbotPrivateFilter.isFleetBotNumber(extra.senderPhone)) {
      return { triggered: false, reason: 'SENDER_IS_FLEET_BOT' };
    }

    // Trava de concorrência imediata antes de chamadas assíncronas
    this.isExecuting.set(groupJid, true);
    this.groupCooldowns.set(groupJid, now);

    try {
      // Localiza os sub-bots presentes no grupo
      const subBots = await this.getSubBotsInGroup(groupJid, extra.sock, extra);
      if (!subBots || subBots.length < 2) {
        return { triggered: false, reason: 'LESS_THAN_TWO_SUBBOTS', count: subBots ? subBots.length : 0 };
      }

      // Seleciona Sub-Bot A e Sub-Bot B
      const subBotA = subBots[0];
      const subBotB = subBots[1];

      if (subBotA.id === subBotB.id) {
        return { triggered: false, reason: 'SAME_BOT_CANNOT_DIALOGUE_WITH_ITSELF' };
      }

      if (subBotA.phone && subBotB.phone && (subBotA.phone === subBotB.phone || subBotA.phone.slice(-8) === subBotB.phone.slice(-8))) {
        return { triggered: false, reason: 'SAME_PHONE_CANNOT_DIALOGUE_WITH_ITSELF' };
      }

      if (subBotA.sock && subBotB.sock && subBotA.sock === subBotB.sock) {
        return { triggered: false, reason: 'SAME_SOCKET_CANNOT_DIALOGUE_WITH_ITSELF' };
      }

      // Determina o Fluxo Inteligente
      const flowType = this.determineFlow(topicKey, triggerText, rule, extra);

      // Resolve os links de afiliados para ambos os bots
      const { linkA, linkB } = this.resolveAffiliateLinks(rule, subBotA, subBotB);

      // Planeja os passos da conversa dentro da cota restante
      const plannedTurns = this.planDialogueTurns(
        flowType,
        rule.product_name,
        linkA,
        linkB,
        subBotA,
        subBotB,
        remainingQuota
      );

      if (!plannedTurns || plannedTurns.length === 0) {
        return { triggered: false, reason: 'NO_TURNS_PLANNED' };
      }

      const dispatchedTurns = [];

      console.log(`[Aquecimento 🔥 Grupo ${groupJid}] Iniciando diálogo entre Sub-Bot #${subBotA.id} e Sub-Bot #${subBotB.id} | Fluxo: ${flowType} | Cota Restante: ${remainingQuota}/9`);

      for (let i = 0; i < plannedTurns.length; i++) {
        // Checagem rigorosa antes de cada disparo para garantir que NUNCA passe de 9
        const currentCountRealtime = models.getTopicInteractionsCount24h(groupJid, topicKey);
        if (currentCountRealtime >= this.MAX_INTERACTIONS_PER_24H) {
          console.log(`[Aquecimento 🛡️] Cota máxima de 9 atingida em tempo de execução. Encerrando diálogo.`);
          break;
        }

        const turn = plannedTurns[i];

        // Intervalo humanizado entre falas
        if (i > 0) {
          const delayMs = process.env.NODE_ENV === 'test' ? 10 : Math.min(8000, Math.max(2500, turn.text.length * 25));
          await new Promise(r => setTimeout(r, delayMs));
        }

        // Simula digitação se socket disponível
        if (turn.sock && typeof turn.sock.sendPresenceUpdate === 'function') {
          try {
            await turn.sock.sendPresenceUpdate('composing', groupJid);
            if (process.env.NODE_ENV !== 'test') {
              await new Promise(r => setTimeout(r, Math.min(3000, turn.text.length * 20)));
              await turn.sock.sendPresenceUpdate('paused', groupJid);
            }
          } catch (_) {}
        }

        // Disparo da mensagem
        let sentOk = false;
        if (turn.sock && typeof turn.sock.sendMessage === 'function') {
          try {
            const sendRes = await turn.sock.sendMessage(groupJid, { text: turn.text });
            sentOk = true;
            if (sendRes?.key?.id) {
              if (typeof whatsappArmyService.registerLegitimateDispatchKey === 'function') {
                whatsappArmyService.registerLegitimateDispatchKey(sendRes.key.id);
              }
              const wb = require('../bots/whatsappBot');
              if (typeof wb.trackSentBotMessage === 'function') {
                wb.trackSentBotMessage(sendRes.key.id, groupJid, turn.sock);
              }
            }
          } catch (sendErr) {
            console.warn(`[Aquecimento ⚠️] Falha ao enviar via socket do Sub-Bot #${turn.instanceId}:`, sendErr.message);
            break; // Se falhou enviar com o socket deste robô, aborta para não quebrar a ordem do diálogo
          }
        }

        // Se o sub-bot responsável não conseguiu enviar a sua própria fala,
        // NUNCA disparar através de outro robô (isso criaria um monólogo onde o bot conversa consigo mesmo)!
        if (!sentOk) {
          console.warn(`[Aquecimento 🛑] Sub-Bot #${turn.instanceId} não pôde enviar mensagem no grupo ${groupJid}. Abortando diálogo entre sub-bots.`);
          break;
        }

        if (sentOk) {
          // Gravação auditada no banco de dados para contabilidade rígida da janela de 24h
          models.recordGroupTopicInteraction({
            group_jid: groupJid,
            topic_key: topicKey,
            instance_id: turn.instanceId,
            flow_type: flowType,
            message_text: turn.text,
            has_link: turn.hasLink ? 1 : 0,
            affiliate_url: turn.affiliateUrl || '',
            turn_index: turn.turnIndex
          });

          models.incrementInstanceSentCount(turn.instanceId);
          dispatchedTurns.push(turn);
          console.log(`[Aquecimento 💬 Sub-Bot #${turn.instanceId}] Falou no grupo: "${turn.text.slice(0, 80)}..."`);
        }
      }

      return {
        triggered: true,
        multiBot: true,
        groupJid,
        topicKey,
        flowType,
        subBotA: { id: subBotA.id, name: subBotA.name },
        subBotB: { id: subBotB.id, name: subBotB.name },
        dispatchedCount: dispatchedTurns.length,
        totalIn24h: models.getTopicInteractionsCount24h(groupJid, topicKey),
        summaryText: `Aquecimento realizado com ${dispatchedTurns.length} mensagens no fluxo ${flowType}`
      };
    } finally {
      this.isExecuting.delete(groupJid);
    }
  }

  /**
   * Comandos Interativos de Gerenciamento do Aquecimento (!aquecimento ...)
   */
  async handleAquecimentoCommand(sock, from, text = '', senderPhone = '', isOwner = false, isAdmin = false) {
    if (!sock || !from) return;

    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, { text: '⛔ Acesso restrito ao Dono do Bot.' });
    }

    const rawArgs = text.replace(/^(?:!|\/)?(?:aquecimento|aquecer|socialwarming)\s*/i, '').trim();
    const parts = rawArgs.split(/\s+/);
    const subCmd = (parts[0] || '').toLowerCase();

    // 1. ATIVAR / DESATIVAR MOTOR
    if (subCmd === 'on' || subCmd === 'ligar' || subCmd === 'ativar') {
      this.setEnabled(true);
      return sock.sendMessage(from, {
        text: `🔥 *MOTOR DE AQUECIMENTO DE SUB-BOTS ATIVADO!* 🤖\n\nQuando 2 ou mais sub-bots estiverem no mesmo grupo, eles irão dialogar entre si para aquecer leads com os 3 fluxos inteligentes, respeitando o limite estrito de 9 mensagens em 24h.`
      });
    }

    if (subCmd === 'off' || subCmd === 'desligar' || subCmd === 'pausar') {
      this.setEnabled(false);
      return sock.sendMessage(from, {
        text: `⏸️ *MOTOR DE AQUECIMENTO PAUSADO!*\n\nOs diálogos automáticos entre sub-bots foram suspensos.`
      });
    }

    // 2. EXPLICAR FLUXOS (!aquecimento fluxos)
    if (subCmd === 'fluxos' || subCmd === 'flows') {
      return sock.sendMessage(from, {
        text: `🧠 *OS 3 FLUXOS INTELIGENTES DO MOTOR DE AQUECIMENTO:*\n\n` +
          `1️⃣ *DUAL_BUYERS (Ambos Já Compraram)*\n` +
          `• Ambos os sub-bots atuam como compradores satisfeitos.\n` +
          `• Cada um envia o seu link de afiliado de onde comprou (2 links enviados).\n\n` +
          `2️⃣ *PEER_INFLUENCE (Influência de Pares)*\n` +
          `• Um sub-bot recomenda o produto com entusiasmo.\n` +
          `• O outro sub-bot faz perguntas pertinentes (bateria, entrega, originalidade) e é convencido a comprar.\n` +
          `• Apenas 1 link de afiliado é enviado no grupo.\n\n` +
          `3️⃣ *DUAL_ALTERNATIVE (Comparação & Links Alternativos)*\n` +
          `• Um sub-bot recomenda e manda o seu link de afiliado.\n` +
          `• O outro concorda com a qualidade, mas diz que pegou em outra loja/link com frete grátis/cupom e manda o seu link também (2 links enviados).\n\n` +
          `🛡️ *REGRA DE OURO:* Máximo rigoroso de *9 interações por assunto a cada 24 horas*!`
      });
    }

    // 3. RESETAR LIMITE DE UM ASSUNTO (!aquecimento reset <assunto>)
    if (subCmd === 'reset' || subCmd === 'limpar') {
      const topicInput = parts.slice(1).join(' ').trim();
      if (!topicInput) {
        return sock.sendMessage(from, {
          text: `⚠️ Informe o assunto para resetar: \`!aquecimento reset <assunto>\` (ex: \`!aquecimento reset airfryer\`)`
        });
      }
      const topicKey = this.normalizeTopicKey(topicInput);
      const changes = models.resetTopicInteractions(from, topicKey);
      return sock.sendMessage(from, {
        text: `🧹 *LIMITE DE 24H RESETADO!* 🔄\n\nAssunto: \`${topicKey}\`\nInterações removidas no grupo: *${changes}*\nAgora o assunto possui nova cota de até 9 interações livres.`
      });
    }

    // 4. TESTAR DIÁLOGO AO VIVO (!aquecimento teste <assunto> [fluxo])
    if (subCmd === 'teste' || subCmd === 'simular') {
      const topicPart = parts[1] || 'Produto Teste';
      const flowPart = (parts[2] || '').toUpperCase();
      const topicKey = this.normalizeTopicKey(topicPart);

      const fakeRule = {
        product_name: topicPart,
        keywords: topicKey,
        affiliate_url: 'https://amzn.to/exemplo-teste',
        affiliate_url_alt: 'https://shope.ee/exemplo-teste-2'
      };

      const result = await this.handleGroupTopicTrigger(from, fakeRule, `alguém recomenda ${topicPart}?`, {
        sock,
        forceFlow: ['DUAL_BUYERS', 'PEER_INFLUENCE', 'DUAL_ALTERNATIVE'].includes(flowPart) ? flowPart : null
      });

      if (!result.triggered) {
        return sock.sendMessage(from, {
          text: `⚠️ *SIMULAÇÃO NÃO EXECUTADA:*\nMotivo: *${result.reason}*\n${result.reason === '24H_LIMIT_REACHED' ? `O assunto \`${topicKey}\` já atingiu ${result.currentCount}/9 interações nas últimas 24h!\nUse \`!aquecimento reset ${topicKey}\` para limpar.` : 'Certifique-se de que há pelo menos 2 sub-bots no grupo.'}`
        });
      }

      return sock.sendMessage(from, {
        text: `✅ *DIÁLOGO DE AQUECIMENTO DISPARADO COM SUCESSO!*\n\n` +
          `• *Assunto:* \`${topicKey}\`\n` +
          `• *Fluxo Executado:* *${result.flowType}*\n` +
          `• *Sub-Bot A:* ${result.subBotA.name} (#${result.subBotA.id})\n` +
          `• *Sub-Bot B:* ${result.subBotB.name} (#${result.subBotB.id})\n` +
          `• *Mensagens Disparadas:* ${result.dispatchedCount}\n` +
          `• *Interações no Assunto (Últimas 24h):* *${result.totalIn24h}/9*`
      });
    }

    // 5. PAINEL COCKPIT (!aquecimento sem argumentos)
    const isHeatingOn = this.isEnabled();
    const isGroup = from.endsWith('@g.us');
    let summaryList = '';

    if (isGroup) {
      const summaries = models.getGroupHeatingSummary24h(from);
      if (summaries && summaries.length > 0) {
        summaryList = `\n📊 *Assuntos Aquecidos nas Últimas 24h neste Grupo:*\n`;
        summaries.forEach((s, idx) => {
          summaryList += `${idx + 1}. \`${s.topic_key}\` — *${s.interactions_24h}/9 interações* (Fluxos: ${s.flows_used})\n`;
        });
      } else {
        summaryList = `\n📊 *Assuntos nas Últimas 24h:* Nenhum assunto aquecido ainda neste grupo.\n`;
      }
    }

    return sock.sendMessage(from, {
      text: `🔥 *CENTRAL DE AQUECIMENTO DE GRUPOS & DIÁLOGOS DE SUB-BOTS* 🤖\n\n` +
        `🟢 *Status do Motor:* ${isHeatingOn ? '🟢 Ativo & Operacional' : '⏸️ Pausado'}\n` +
        `🛡️ *Limite Rigoroso de 24h:* *Máx. 9 interações por assunto*\n` +
        `👥 *Requisito:* 2 ou mais Sub-Bots presentes no mesmo grupo\n` +
        summaryList +
        `\n⚙️ *Comandos Disponíveis:*\n` +
        `• \`!aquecimento on / off\` — Liga ou pausa o motor\n` +
        `• \`!aquecimento fluxos\` — Detalha os 3 fluxos inteligentes de conversa\n` +
        `• \`!aquecimento teste <assunto> [fluxo]\` — Simula diálogo entre 2 sub-bots\n` +
        `• \`!aquecimento reset <assunto>\` — Zera a cota de 24h de um assunto\n` +
        `• \`!aquecimento logs\` — Lista histórico recente de interações\n\n` +
        `_As conversas respeitam intervalos humanos e digitação realista._`
    });
  }
}

module.exports = new GroupHeatingService();

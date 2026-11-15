const models = require('../db/models');

/**
 * Serviço de Gamificação e Economia de Tokens para Sub-Bots (100% Gratuito)
 * Permite que qualquer pessoa conecte seu WhatsApp gratuitamente como Sub-Bot
 * e utilize os comandos pagando exclusivamente com:
 * 1. Participação em Grupos Oficiais Parceiros (+50 tokens diários)
 * 2. Divulgações Diárias de Ofertas e Links (+100 tokens por missão diária)
 * 3. Indicação de Novos Sub-Bots (+50 tokens por amigo indicado)
 */
class SubBotTokenService {
  constructor() {
    this.MAX_DAILY_TOKENS = 50; // Teto máximo diário estrito e inviolável para Sub-Bots Free
    this.REPLENISH_HOURS = 24;  // Cada token usado é reposto automaticamente após 24 horas
    this.DEFAULT_DAILY_BASE = 50;
    this.DEFAULT_DAILY_SHARE = 50;
    this.DEFAULT_GROUP_BONUS = 50;
    this.DEFAULT_REFERRAL_BONUS = 50;

    this.COMMAND_COSTS = {
      // 0 TOKENS (Sempre Gratuitos - Comandos de Gestão, Tokens, Suporte e Vendas)
      tokens: 0, meustokens: 0, saldo: 0, pontos: 0,
      missao: 0, missaodiaria: 0, tarefadiaria: 0, divulgar: 0, confirmardivulgacao: 0, missaofeita: 0,
      grupos: 0, gruposoficiais: 0, entragrupos: 0, verificargrupos: 0,
      indicar: 0, convite: 0, meucodigo: 0,
      serbot: 0, jadibot: 0, subbot: 0, code: 0, conectar: 0,
      stopbot: 0, pararbot: 0, pararsubbot: 0, desconectarbot: 0,
      subbotstatus: 0, subbothelp: 0, bots: 0, subbots: 0,
      ajuda: 0, help: 0, menu: 0, suporte: 0, souodono: 0, painel: 0, dev: 0,
      comprar: 0, pix: 0, livepix: 0, catalogo: 0, loja: 0, ver: 0, pedido: 0, ordem: 0,

      // 1 TOKEN (Comandos Utilitários, Figurinhas e Ferramentas Leves)
      figu: 1, sticker: 1, s: 1, perfil: 1, calc: 1, clima: 1, tempo: 1,
      dado: 1, moeda: 1, caraoucoroa: 1, ping: 1, sorteio: 1, rastreio: 1,
      noticias: 1, noticia: 1, x9: 1, fantasmas: 1, marcar: 1, tagall: 1,
      hidetag: 1, qc: 1, brat: 1, attp: 1, ttp: 1, traduzir: 1, trad: 1,
      emojimix: 1, revelar: 1, qrcode: 1, ssweb: 1, gitclone: 1,

      // 2 TOKENS (Downloads de Mídia e Processamento de Áudio)
      play: 2, musica: 2, video: 2, yt: 2, youtube: 2, tiktok: 2, tt: 2,
      insta: 2, instagram: 2, ig: 2, baixar: 2, download: 2,
      audiofx: 2, bass: 2, slow: 2, nightcore: 2, reverse: 2, tomp3: 2, toimg: 2,

      // 3 TOKENS (Inteligência Artificial & Síntese de Voz)
      ia: 3, ai: 3, gpt: 3, gemini: 3, nina: 3, dalle: 3, desenhe: 3,
      imagem: 3, voz: 3, tts: 3, falar: 3, audio: 3, zapvoice: 3, transcrever: 3
    };
  }

  /**
   * Obtém as configurações globais ou do tenant de gamificação de sub-bots
   */
  getConfig(tenantId = null) {
    const enabled = models.getSetting('SUBBOT_SYSTEM_ENABLED', 'true') === 'true';
    const dailyBaseTokens = parseInt(models.getSetting('SUBBOT_FREE_DAILY_TOKENS', String(this.DEFAULT_DAILY_BASE)), 10) || this.DEFAULT_DAILY_BASE;
    const dailyShareTokens = parseInt(models.getSetting('SUBBOT_DAILY_SHARE_TOKENS', String(this.DEFAULT_DAILY_SHARE)), 10) || this.DEFAULT_DAILY_SHARE;
    const groupBonusTokens = parseInt(models.getSetting('SUBBOT_OFFICIAL_GROUPS_TOKENS', String(this.DEFAULT_GROUP_BONUS)), 10) || this.DEFAULT_GROUP_BONUS;
    const referralTokens = parseInt(models.getSetting('SUBBOT_REFERRAL_TOKENS', String(this.DEFAULT_REFERRAL_BONUS)), 10) || this.DEFAULT_REFERRAL_BONUS;
    
    let officialGroups = [];
    try {
      const rawGroups = models.getSetting('SUBBOT_OFFICIAL_GROUPS', null);
      if (rawGroups) {
        officialGroups = JSON.parse(rawGroups);
      }
    } catch (_) {}

    if (!Array.isArray(officialGroups) || officialGroups.length === 0) {
      officialGroups = [
        {
          name: 'Comunidade Oficial VIP & Suporte',
          url: 'https://chat.whatsapp.com/GeralComunidadeVIP',
          desc: 'Tire dúvidas, pegue novidades e receba bônus de tokens diários.'
        },
        {
          name: 'Canal Oficial de Achadinhos & Ofertas',
          url: 'https://whatsapp.com/channel/0029VaOficialAchadinhos',
          desc: 'Ofertas exclusivas com menores preços históricos e cupons.'
        }
      ];
    }

    const dailyMissionTemplate = models.getSetting('SUBBOT_DAILY_MISSION_TEMPLATE', '');

    return {
      enabled,
      dailyBaseTokens,
      dailyShareTokens,
      groupBonusTokens,
      referralTokens,
      officialGroups,
      dailyMissionTemplate
    };
  }

  /**
   * Salva configurações no banco de dados
   */
  updateConfig(cfg = {}) {
    if (cfg.enabled !== undefined) {
      models.setSetting('SUBBOT_SYSTEM_ENABLED', cfg.enabled ? 'true' : 'false');
    }
    if (cfg.dailyBaseTokens !== undefined) {
      models.setSetting('SUBBOT_FREE_DAILY_TOKENS', String(cfg.dailyBaseTokens));
    }
    if (cfg.dailyShareTokens !== undefined) {
      models.setSetting('SUBBOT_DAILY_SHARE_TOKENS', String(cfg.dailyShareTokens));
    }
    if (cfg.groupBonusTokens !== undefined) {
      models.setSetting('SUBBOT_OFFICIAL_GROUPS_TOKENS', String(cfg.groupBonusTokens));
    }
    if (cfg.referralTokens !== undefined) {
      models.setSetting('SUBBOT_REFERRAL_TOKENS', String(cfg.referralTokens));
    }
    if (cfg.officialGroups !== undefined) {
      const jsonStr = typeof cfg.officialGroups === 'string' ? cfg.officialGroups : JSON.stringify(cfg.officialGroups);
      models.setSetting('SUBBOT_OFFICIAL_GROUPS', jsonStr);
    }
    if (cfg.dailyMissionTemplate !== undefined) {
      models.setSetting('SUBBOT_DAILY_MISSION_TEMPLATE', String(cfg.dailyMissionTemplate || ''));
    }
    return this.getConfig();
  }

  /**
   * Repõe individualmente cada token usado após a janela de 24 horas,
   * respeitando o teto estrito e inviolável de 50 tokens diários
   */
  replenishUsedTokens(instanceId) {
    if (!instanceId || instanceId === 1) return null;
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    const isSubBot = inst.is_subbot !== 0;
    if (!isSubBot) return inst;

    const MAX_CEILING = this.MAX_DAILY_TOKENS || 50;
    let currentBalance = inst.tokens_balance !== undefined && inst.tokens_balance !== null ? Number(inst.tokens_balance) : MAX_CEILING;

    // Garante que nunca ultrapasse o teto de 50 tokens diários
    if (currentBalance > MAX_CEILING) {
      currentBalance = MAX_CEILING;
      models.updateArmyInstance(instanceId, { tokens_balance: MAX_CEILING });
    }

    const nowIso = new Date().toISOString();
    const eligibleLogs = models.getEligibleReplenishments ? models.getEligibleReplenishments(instanceId, nowIso) : [];

    if (!eligibleLogs || eligibleLogs.length === 0) {
      return models.getArmyInstanceById(instanceId) || inst;
    }

    let tokensToRestoreTotal = 0;
    const logsToMark = [];

    for (const log of eligibleLogs) {
      const consumedAmount = Math.abs(log.amount || 1);
      const remainingCapacity = MAX_CEILING - (currentBalance + tokensToRestoreTotal);

      if (remainingCapacity > 0) {
        const canAdd = Math.min(consumedAmount, remainingCapacity);
        tokensToRestoreTotal += canAdd;
      }
      logsToMark.push(log.id);
    }

    if (logsToMark.length > 0 && models.markTokenLogsReplenished) {
      models.markTokenLogsReplenished(logsToMark, nowIso);
    }

    if (tokensToRestoreTotal > 0) {
      const newBalance = Math.min(MAX_CEILING, currentBalance + tokensToRestoreTotal);
      models.updateArmyInstance(instanceId, { tokens_balance: newBalance });
      models.logSubBotTokenTransaction({
        instance_id: instanceId,
        type: 'TOKEN_REPLENISH_24H',
        amount: tokensToRestoreTotal,
        balance_after: newBalance,
        description: `Reposição automática de +${tokensToRestoreTotal} token(s) usado(s) após ciclo de 24h`,
        replenished: 1,
        replenished_at: nowIso
      });
      return models.getArmyInstanceById(instanceId);
    }

    return models.getArmyInstanceById(instanceId) || inst;
  }

  /**
   * Varre e processa reposição de 24h de tokens para todos os Sub-Bots cadastrados
   */
  replenishAllActiveSubBots() {
    try {
      const instances = models.getArmyInstances ? models.getArmyInstances() : [];
      const subbots = instances.filter(i => i.id > 1 && i.is_subbot !== 0);
      for (const sb of subbots) {
        this.replenishUsedTokens(sb.id);
      }
    } catch (err) {
      console.warn('[SubBot Tokens ⚠️] Erro na varredura de reposição de tokens:', err.message);
    }
  }

  /**
   * Garante a renovação e manutenção da cota diária do sub-bot
   */
  ensureDailyReset(instanceId) {
    if (!instanceId || instanceId === 1) return null;
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    // Aplica a reposição contínua de 24h para cada token usado
    this.replenishUsedTokens(instanceId);

    const todayStr = new Date().toISOString().split('T')[0];
    const MAX_CEILING = this.MAX_DAILY_TOKENS || 50;

    if (inst.last_token_reset !== todayStr) {
      // Reseta contadores diários de missões (divulgação e grupos) para o novo dia
      models.updateArmyInstance(instanceId, {
        tokens_daily_base: MAX_CEILING,
        last_token_reset: todayStr,
        daily_shares_count: 0,
        official_groups_bonus_claimed: null
      });

      return models.getArmyInstanceById(instanceId);
    }

    return models.getArmyInstanceById(instanceId) || inst;
  }

  /**
   * Retorna os dados completos de tokens de um subbot
   */
  getSubBotTokens(instanceId) {
    if (!instanceId) return null;
    if (instanceId === 1) {
      return {
        id: 1,
        name: 'Matriz Principal',
        tokens_balance: 999999,
        tokens_daily_base: 999999,
        is_subbot: 0,
        unlimited: true
      };
    }

    const inst = this.ensureDailyReset(instanceId) || models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    return {
      id: inst.id,
      name: inst.name,
      phone: inst.phone,
      tokens_balance: inst.tokens_balance !== undefined ? inst.tokens_balance : this.DEFAULT_DAILY_BASE,
      tokens_daily_base: inst.tokens_daily_base || this.DEFAULT_DAILY_BASE,
      last_token_reset: inst.last_token_reset,
      daily_shares_count: inst.daily_shares_count || 0,
      last_daily_share_date: inst.last_daily_share_date,
      official_groups_bonus_claimed: inst.official_groups_bonus_claimed,
      referral_code: inst.referral_code || `SUB-${inst.id}`,
      referred_by: inst.referred_by,
      is_subbot: inst.is_subbot !== undefined ? inst.is_subbot : 1
    };
  }

  /**
   * Extrai o nome limpo do comando a partir do texto
   */
  extractCommandName(text) {
    if (!text) return '';
    const clean = text.trim();
    if (!clean.startsWith('!') && !clean.startsWith('/')) return '';
    const parts = clean.slice(1).trim().split(/\s+/);
    return (parts[0] || '').toLowerCase();
  }

  /**
   * Determina o custo de tokens de um comando
   */
  getCommandCost(commandName) {
    if (!commandName) return 0;
    const cmd = commandName.toLowerCase();
    if (this.COMMAND_COSTS[cmd] !== undefined) {
      return this.COMMAND_COSTS[cmd];
    }
    // Por padrão, qualquer outro comando de bot consome 1 token
    return 1;
  }

  /**
   * Verifica se o sub-bot tem saldo de tokens suficiente para executar o comando
   */
  checkCommandAllowance(instanceId, text, isOwner = false) {
    // Matriz Principal ou Dono do sistema nunca consomem tokens (acesso irrestrito)
    if (!instanceId || instanceId === 1 || isOwner) {
      return { allowed: true, cost: 0, isFree: true };
    }

    const commandName = this.extractCommandName(text);
    // Se não for comando (ex: conversa normal do lead, mensagem comercial), não consome
    if (!commandName) {
      return { allowed: true, cost: 0, isFree: true };
    }

    const cost = this.getCommandCost(commandName);
    // Comandos de custo zero (gestão, suporte, tokens) são sempre permitidos
    if (cost === 0) {
      return { allowed: true, cost: 0, isFree: true };
    }

    // Aplica renovação diária antes de checar saldo
    const inst = this.ensureDailyReset(instanceId) || models.getArmyInstanceById(instanceId);
    const balance = inst?.tokens_balance !== undefined ? Number(inst.tokens_balance) : 0;

    if (balance >= cost) {
      return {
        allowed: true,
        cost,
        commandName,
        balance,
        isFree: false
      };
    }

    // Saldo insuficiente: Bloqueia e retorna mensagem persuasiva
    return {
      allowed: false,
      cost,
      commandName,
      balance,
      isFree: false,
      message: this.getExhaustedMessage(instanceId, commandName, cost, balance)
    };
  }

  /**
   * Deduz tokens após a execução de um comando
   */
  consumeTokens(instanceId, commandName, cost = 1) {
    if (!instanceId || instanceId === 1 || cost <= 0) return true;
    
    // Processa reposição 24h pendente antes de consumir
    this.replenishUsedTokens(instanceId);

    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return false;

    const currentBalance = inst.tokens_balance !== undefined ? Number(inst.tokens_balance) : 0;
    const newBalance = Math.max(0, currentBalance - cost);
    const nowIso = new Date().toISOString();
    const availableAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    models.updateArmyInstance(instanceId, { tokens_balance: newBalance });
    models.logSubBotTokenTransaction({
      instance_id: instanceId,
      type: 'CONSUME_COMMAND',
      amount: -cost,
      balance_after: newBalance,
      description: `Uso do comando !${commandName}`,
      command: commandName,
      replenished: 0,
      replenished_at: null,
      available_at: availableAtIso,
      created_at: nowIso
    });

    return { success: true, cost, newBalance };
  }

  /**
   * Credita tokens para um sub-bot (bônus, missões, etc.)
   * Garante inviolabilidade do teto máximo de 50 tokens diários
   */
  addTokens(instanceId, amount, type, description = '', command = '') {
    if (!instanceId || instanceId === 1) return null;
    this.replenishUsedTokens(instanceId);

    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    const MAX_CEILING = this.MAX_DAILY_TOKENS || 50;
    const currentBalance = inst.tokens_balance !== undefined ? Number(inst.tokens_balance) : 0;
    const newBalance = Math.min(MAX_CEILING, currentBalance + Number(amount));

    models.updateArmyInstance(instanceId, { tokens_balance: newBalance });
    models.logSubBotTokenTransaction({
      instance_id: instanceId,
      type: type || 'MANUAL_BONUS',
      amount: Number(amount),
      balance_after: newBalance,
      description: description || `Crédito de +${amount} tokens (máx ${MAX_CEILING})`,
      command: command || '',
      replenished: 1,
      replenished_at: new Date().toISOString()
    });

    return { success: true, added: Number(amount), newBalance };
  }

  /**
   * Gera a mensagem da Missão Diária de Divulgação (Daily Sharing)
   */
  getDailyMission(instanceId) {
    const inst = this.getSubBotTokens(instanceId);
    const cfg = this.getConfig();
    const todayStr = new Date().toISOString().split('T')[0];

    // Busca produto de maior relevância ou link de afiliado
    let headline = '🔥 *SUPER PROMOÇÃO EXCLUSIVA DO DIA!* 🛍️';
    let pitch = 'Aproveite o menor preço histórico com entrega imediata e suporte garantido via WhatsApp!';
    let promoUrl = 'https://paybot.digital';

    try {
      const products = models.getProducts ? models.getProducts() : [];
      const bestProd = products.find(p => p.active !== 0 && (p.profit_margin_percent >= 80 || p.price_brl > 0));
      if (bestProd) {
        headline = `🔥 *OFERTA ESPECIAL: ${bestProd.name.toUpperCase()}* 🚀`;
        pitch = bestProd.description || 'Produto com alta procura, desconto imperdível e liberação instantânea!';
        const tunnelService = require('./tunnelService');
        const storeDomain = models.getSetting('STORE_BASE_URL') || tunnelService.getStoreUrl() || 'http://localhost:3001';
        promoUrl = `${storeDomain}/#produto_${bestProd.id}?ref=${inst?.referral_code || 'SUB'}`;
      } else {
        const affLinks = models.getAffiliateLinks ? models.getAffiliateLinks() : [];
        if (affLinks.length > 0) {
          headline = `⚡ *ACHADINHO IMPERDÍVEL: ${affLinks[0].title.toUpperCase()}* 🎁`;
          pitch = affLinks[0].pitch_copy || 'Desconto exclusivo por tempo limitado!';
          promoUrl = affLinks[0].affiliate_url;
        }
      }
    } catch (_) {}

    const copyToShare = 
      `${headline}\n\n` +
      `${pitch}\n\n` +
      `👉 *Acesse agora pelo link:* ${promoUrl}\n` +
      `⚡ _Vagas e estoque promocional por tempo limitado!_`;

    const instructions =
      `🎯 *MISSÃO DIÁRIA DE DIVULGAÇÃO (+${cfg.dailyShareTokens} TOKENS)* 💎\n\n` +
      `Ganhe +${cfg.dailyShareTokens} tokens diários para usar os comandos no seu Sub-Bot sem pagar nada em dinheiro!\n\n` +
      `📋 *COMO CUMPRIR A MISSÃO EM 30 SEGUNDOS:*\n` +
      `1. Copie o texto de oferta abaixo ⬇️\n` +
      `2. Compartilhe no seu *Status do WhatsApp* ou em *3 grupos* de amigos.\n` +
      `3. Em seguida, digite aqui: *!confirmardivulgacao* para creditar seus +${cfg.dailyShareTokens} tokens na hora!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *TEXTO DA OFERTA PARA COPIAR & POSTAR:* 👇\n\n` +
      `${copyToShare}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 _Ao postar, envie *!confirmardivulgacao* para resgatar seus tokens!_`;

    return {
      copyToShare,
      instructions,
      rewardTokens: cfg.dailyShareTokens,
      alreadyDoneToday: inst?.last_daily_share_date === todayStr && (inst?.daily_shares_count || 0) >= 2
    };
  }

  /**
   * Confirma a conclusão da Missão Diária de Divulgação e credita os tokens
   */
  confirmDailyMission(instanceId, method = 'manual', proofText = '') {
    if (!instanceId || instanceId === 1) return null;
    const inst = this.ensureDailyReset(instanceId) || models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    const cfg = this.getConfig(inst.tenant_id);
    const todayStr = new Date().toISOString().split('T')[0];
    const sharesToday = inst.last_daily_share_date === todayStr ? (inst.daily_shares_count || 0) : 0;

    // Permite até 2 divulgações diárias bonificadas por dia (ex: até 200 tokens bônus/dia!)
    const MAX_DAILY_SHARES = 2;
    if (sharesToday >= MAX_DAILY_SHARES) {
      return {
        success: false,
        limitReached: true,
        message: `⚠️ *LIMITE DE MISSÕES DIÁRIAS ATINGIDO HOJE!* 🎯\n\n` +
                 `Você já realizou ${sharesToday} divulgações hoje e garantiu todos os seus tokens bônus do dia!\n` +
                 `🔋 *Seu saldo atual:* ${inst.tokens_balance} tokens.\n\n` +
                 `💡 Amanhã uma nova missão estará disponível para você recarregar mais tokens gratuitamente.`,
        currentBalance: inst.tokens_balance
      };
    }

    const tokensToAward = cfg.dailyShareTokens;
    const newSharesCount = sharesToday + 1;
    const MAX_CEILING = this.MAX_DAILY_TOKENS || 50;
    const newBalance = Math.min(MAX_CEILING, (inst.tokens_balance || 0) + tokensToAward);

    models.updateArmyInstance(instanceId, {
      tokens_balance: newBalance,
      daily_shares_count: newSharesCount,
      last_daily_share_date: todayStr
    });

    models.recordSubBotMission({
      instance_id: instanceId,
      mission_date: todayStr,
      mission_type: 'DAILY_SHARE',
      status: 'COMPLETED',
      proof_text: proofText || `Divulgação diária #${newSharesCount} (${method})`,
      tokens_awarded: tokensToAward
    });

    models.logSubBotTokenTransaction({
      instance_id: instanceId,
      type: 'BONUS_DAILY_SHARE',
      amount: tokensToAward,
      balance_after: newBalance,
      description: `Missão diária de divulgação concluída (+${tokensToAward} tokens)`
    });

    return {
      success: true,
      limitReached: false,
      tokensAwarded: tokensToAward,
      sharesCompletedToday: newSharesCount,
      maxSharesDaily: MAX_DAILY_SHARES,
      newBalance,
      message: `🎉 *PARABÉNS! MISSÃO DIÁRIA CONCLUÍDA!* 💎\n\n` +
               `Você divulgou e liberou *+${tokensToAward} TOKENS* de uso imediato!\n\n` +
               `🔋 *Novo Saldo:* ${newBalance} tokens disponíveis\n` +
               `🚀 Agora você pode usar todos os comandos do seu Sub-Bot sem restrições!\n\n` +
               `👉 Digite *!menu* para ver comandos ou *!tokens* para consultar seu saldo.`
    };
  }

  /**
   * Retorna os grupos oficiais da comunidade e canais parceiros
   */
  getOfficialGroupsMessage(instanceId) {
    const inst = this.getSubBotTokens(instanceId);
    const cfg = this.getConfig();
    const todayStr = new Date().toISOString().split('T')[0];
    const isClaimedToday = inst?.official_groups_bonus_claimed === todayStr;

    let msg = `👥 *GRUPOS OFICIAIS & COMUNIDADE (+${cfg.groupBonusTokens} TOKENS DIÁRIOS)* 🚀\n\n` +
      `Para manter seu Sub-Bot ativo sem pagar nenhum valor em dinheiro, basta participar dos nossos canais e grupos oficiais:\n\n`;

    cfg.officialGroups.forEach((grp, idx) => {
      msg += `${idx + 1}️⃣ *${grp.name}*\n` +
             `🔗 ${grp.url}\n` +
             (grp.desc ? `📝 _${grp.desc}_\n\n` : '\n');
    });

    if (isClaimedToday) {
      msg += `✅ *STATUS DO BÔNUS DE HOJE:* Resgatado (+${cfg.groupBonusTokens} tokens creditados)!\n` +
             `🔋 *Saldo atual:* ${inst?.tokens_balance} tokens.\n` +
             `Amanhã seu bônus de presença será renovado automaticamente!`;
    } else {
      msg += `🎁 *RESGATAR BÔNUS DE PRESENÇA (+${cfg.groupBonusTokens} TOKENS):*\n` +
             `Entre nos links acima e digite: *!verificargrupos* para validar sua presença e resgatar seus tokens na hora!`;
    }

    return msg;
  }

  /**
   * Valida presença e credita o bônus diário de grupos oficiais
   */
  claimOfficialGroupsBonus(instanceId) {
    if (!instanceId || instanceId === 1) return null;
    const inst = this.ensureDailyReset(instanceId) || models.getArmyInstanceById(instanceId);
    if (!inst) return null;

    const cfg = this.getConfig(inst.tenant_id);
    const todayStr = new Date().toISOString().split('T')[0];

    if (inst.official_groups_bonus_claimed === todayStr) {
      return {
        success: false,
        alreadyClaimed: true,
        message: `✅ *BÔNUS DE GRUPOS JÁ RESGATADO HOJE!* 👥\n\n` +
                 `Você já resgatou seu bônus diário de presença nos grupos (+${cfg.groupBonusTokens} tokens) hoje!\n` +
                 `🔋 *Seu saldo atual:* ${inst.tokens_balance} tokens.\n\n` +
                 `💡 Para ganhar mais tokens hoje, faça a *!missaodiaria* (+${cfg.dailyShareTokens} tokens) ou use *!indicar*!`,
        balance: inst.tokens_balance
      };
    }

    const tokensToAward = cfg.groupBonusTokens;
    const MAX_CEILING = this.MAX_DAILY_TOKENS || 50;
    const newBalance = Math.min(MAX_CEILING, (inst.tokens_balance || 0) + tokensToAward);

    models.updateArmyInstance(instanceId, {
      tokens_balance: newBalance,
      official_groups_bonus_claimed: todayStr
    });

    models.recordSubBotMission({
      instance_id: instanceId,
      mission_date: todayStr,
      mission_type: 'OFFICIAL_GROUPS_PRESENCE',
      status: 'COMPLETED',
      proof_text: 'Presença confirmada nos grupos parceiros',
      tokens_awarded: tokensToAward
    });

    models.logSubBotTokenTransaction({
      instance_id: instanceId,
      type: 'BONUS_OFFICIAL_GROUPS',
      amount: tokensToAward,
      balance_after: newBalance,
      description: `Bônus diário por participação em grupos oficiais (+${tokensToAward} tokens)`
    });

    return {
      success: true,
      alreadyClaimed: false,
      tokensAwarded: tokensToAward,
      newBalance,
      message: `🎉 *BÔNUS DE COMUNIDADE RESGATADO!* 👥✨\n\n` +
               `Sua presença nos grupos oficiais foi confirmada e você recebeu *+${tokensToAward} TOKENS*!\n\n` +
               `🔋 *Saldo Atual:* ${newBalance} tokens disponíveis\n` +
               `🚀 Aproveite os recursos no seu próprio número!\n\n` +
               `👉 Digite *!menu* para ver comandos ou *!missaodiaria* para ganhar mais tokens.`
    };
  }

  /**
   * Retorna os dados para indicação de amigos (!indicar)
   */
  getReferralInfo(instanceId, botPhone = '') {
    const inst = this.getSubBotTokens(instanceId);
    const cfg = this.getConfig();
    const refCode = inst?.referral_code || `SUB-${instanceId}`;
    const cleanBotPhone = (botPhone || '554884702848').replace(/\D/g, '');

    const inviteMsg =
      `🤖 *TRANSFORME SEU WHATSAPP EM UM SUPER BOT GRÁTIS!* ✨\n\n` +
      `Eu conectei meu WhatsApp como Sub-Bot e agora ele responde figurinhas, IA, downloads de vídeos e músicas diretamente no meu número, *sem pagar nada*!\n\n` +
      `📲 Para virar Sub-Bot também em 1 minuto:\n` +
      `1. Envie uma mensagem para o bot: https://wa.me/${cleanBotPhone}?text=!serbot\n` +
      `2. Informe o meu código de indicação: *${refCode}*\n\n` +
      `🎁 Usando esse código nós dois ganhamos *+${cfg.referralTokens} TOKENS* de bônus!`;

    const instructions =
      `🎁 *INDIQUE AMIGOS & GANHE TOKENS (+${cfg.referralTokens} TOKENS POR AMIGO)* 🤝\n\n` +
      `Convide seus amigos para transformarem o WhatsApp deles em Sub-Bot gratuitamente!\n\n` +
      `🔑 *SEU CÓDIGO DE INDICAÇÃO:* 👉 *${refCode}* 👈\n\n` +
      `Quando seu amigo enviar *!serbot <numero> ${refCode}*, ambos recebem *+${cfg.referralTokens} TOKENS* imediatamente!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *MENSAGEM PRONTA PARA ENCAMINHAR:* 👇\n\n` +
      `${inviteMsg}`;

    return {
      refCode,
      inviteMsg,
      instructions,
      rewardTokens: cfg.referralTokens
    };
  }

  /**
   * Processa a indicação quando um novo sub-bot é criado
   */
  processReferral(newSubBotId, referralCode) {
    if (!newSubBotId || !referralCode) return false;
    try {
      const referrer = models.getSubBotByReferralCode(referralCode);
      if (!referrer || referrer.id === newSubBotId) return false;

      const cfg = this.getConfig();
      const bonus = cfg.referralTokens || 50;

      // Vincula a indicação
      models.updateArmyInstance(newSubBotId, { referred_by: referrer.id });

      // Bonifica o novo sub-bot
      this.addTokens(newSubBotId, bonus, 'BONUS_REFERRAL', `Bônus por usar o convite de #${referrer.id} (${referralCode})`);

      // Bonifica quem indicou
      this.addTokens(referrer.id, bonus, 'BONUS_REFERRAL', `Bônus por indicar o novo Sub-Bot #${newSubBotId}`);

      return {
        success: true,
        referrerId: referrer.id,
        referrerName: referrer.name,
        bonus
      };
    } catch (err) {
      console.warn('[SubBot Indicação ⚠️] Erro ao processar referral:', err.message);
      return false;
    }
  }

  /**
   * Mensagem amigável de tokens esgotados
   */
  getExhaustedMessage(instanceId, commandName = '', cost = 1, balance = 0) {
    const cfg = this.getConfig();
    return (
      `⚠️ *SEUS TOKENS DIÁRIOS ESGOTARAM!* 🔋\n\n` +
      `O comando *!${commandName || 'comando'}* necessita de *${cost} token(s)*, mas seu saldo atual é de *${balance} tokens*.\n\n` +
      `💎 *NÃO SE PREOCUPE: SEU SUB-BOT É 100% GRATUITO!* 🚀\n` +
      `Você *não precisa pagar nada em dinheiro* para continuar usando! Basta cumprir qualquer uma das opções gratuitas abaixo para recarregar na hora:\n\n` +
      `1️⃣ *FAZER A DIVULGAÇÃO DIÁRIA (+${cfg.dailyShareTokens} TOKENS)* 🎯\n` +
      `Compartilhe uma oferta quente no seu Status ou em 3 grupos!\n` +
      `👉 Digite: *!missaodiaria* (ou *!divulgar*)\n\n` +
      `2️⃣ *ENTRAR NOS GRUPOS OFICIAIS (+${cfg.groupBonusTokens} TOKENS)* 👥\n` +
      `Participe da nossa comunidade parceira e ganhe tokens todo dia!\n` +
      `👉 Digite: *!grupos* para ver os links e resgatar com *!verificargrupos*\n\n` +
      `3️⃣ *INDICAR UM AMIGO (+${cfg.referralTokens} TOKENS)* 🤝\n` +
      `Indique um amigo para virar Sub-Bot e ambos ganham bônus!\n` +
      `👉 Digite: *!indicar*\n\n` +
      `📊 _Consulte seu saldo a qualquer momento digitando *!tokens*._`
    );
  }

  /**
   * Relatório completo de saldo, teto máximo diário (50 tokens) e ciclo de reposição de 24h (!tokens / !saldo)
   */
  getTokensStatusReport(instanceId) {
    // Processa reposições pendentes antes de gerar o relatório
    this.replenishUsedTokens(instanceId);

    const inst = this.getSubBotTokens(instanceId);
    if (!inst) {
      return '⚠️ Nenhuma informação de Sub-Bot encontrada para esta conta.';
    }

    if (inst.unlimited) {
      return (
        `👑 *MATRIZ PRINCIPAL (ACESSO ILIMITADO)* ⚡\n\n` +
        `Esta instância é o cérebro Matriz do sistema e possui acesso mestre permanente sem consumo de tokens.`
      );
    }

    const cfg = this.getConfig();
    const todayStr = new Date().toISOString().split('T')[0];
    const sharesToday = inst.last_daily_share_date === todayStr ? (inst.daily_shares_count || 0) : 0;
    const groupsClaimed = inst.official_groups_bonus_claimed === todayStr;

    // Calcula tokens gastos aguardando reposição da janela de 24h
    const pendingLogs = models.getPendingReplenishments ? models.getPendingReplenishments(instanceId) : [];
    let pendingTokensCount = 0;
    let nextLog = null;
    let nextMsRemaining = Infinity;
    const nowMs = Date.now();

    for (const log of pendingLogs) {
      const logAmount = Math.abs(log.amount || 1);
      pendingTokensCount += logAmount;
      const availMs = log.available_at 
        ? new Date(log.available_at).getTime() 
        : (log.created_at ? new Date(log.created_at).getTime() + 24 * 60 * 60 * 1000 : nowMs);
      const diff = Math.max(0, availMs - nowMs);
      if (diff < nextMsRemaining) {
        nextMsRemaining = diff;
        nextLog = { ...log, diff, availMs, logAmount };
      }
    }

    let replenishInfo = '';
    if (pendingTokensCount > 0 && nextLog) {
      const totalSec = Math.ceil(nextMsRemaining / 1000);
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const timeStr = new Date(nextLog.availMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      replenishInfo = 
        `• *Teto Máximo Diário:* 50 Tokens (Inviolável) 🛡️\n` +
        `• *Regra de Recarga:* Cada token usado é reposto em 24h ⏱️\n` +
        `• *Tokens em Reposição (24h):* *${pendingTokensCount} token(s) gastos*\n` +
        `• *Próxima Reposição:* +${nextLog.logAmount} token(s) em ${hrs}h ${mins}m (às ${timeStr})\n`;
    } else {
      replenishInfo = 
        `• *Teto Máximo Diário:* 50 Tokens (Inviolável) 🛡️\n` +
        `• *Regra de Recarga:* Cada token usado é reposto em 24h ⏱️\n` +
        `• *Reposição:* Nenhuma pendente (100% dos tokens restaurados) ✅\n`;
    }

    return (
      `🔋 *PAINEL DE TOKENS DO SEU SUB-BOT* 🤖\n\n` +
      `• *Instância:* Sub-Bot #${inst.id} (${inst.name})\n` +
      `• *Saldo Disponível:* *${inst.tokens_balance} / 50 Tokens* ⚡\n` +
      replenishInfo +
      `• *Plano:* 100% Gratuito (Sem mensalidades ou cobranças)\n` +
      `• *Código de Indicação:* *${inst.referral_code}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *STATUS DAS MISSÕES DIÁRIAS (HOJE):*\n` +
      `1️⃣ *Divulgação Diária:* ${sharesToday > 0 ? `✅ Concluída (${sharesToday}/2 feitas)` : `⏳ Disponível (+${cfg.dailyShareTokens} tokens)`}\n` +
      `   _Digite *!missaodiaria* para pegar o texto de divulgação._\n\n` +
      `2️⃣ *Presença nos Grupos Oficiais:* ${groupsClaimed ? '✅ Bônus Resgatado Hoje (+50 tokens)' : `⏳ Pendente (+${cfg.groupBonusTokens} tokens)`}\n` +
      `   _Digite *!grupos* e *!verificargrupos* para resgatar._\n\n` +
      `3️⃣ *Indicação de Amigos:* +${cfg.referralTokens} tokens por cada amigo que virar Sub-Bot!\n` +
      `   _Digite *!indicar* para pegar seu link exclusivo._\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Tabela de Consumo por Comando:*\n` +
      `• Comandos de Gestão / Vendas / Tokens: *0 Tokens (Grátis)*\n` +
      `• Figurinhas e Utilitários: *1 Token*\n` +
      `• Músicas e Vídeos (Downloads): *2 Tokens*\n` +
      `• Inteligência Artificial e Voz: *3 Tokens*`
    );
  }

  /**
   * Mensagem de boas-vindas enviada logo após a conexão bem-sucedida do Sub-Bot
   */
  getWelcomeSubBotMessage(instanceId) {
    this.replenishUsedTokens(instanceId);
    const inst = this.getSubBotTokens(instanceId);
    const cfg = this.getConfig();

    return (
      `🎉 *PARABÉNS! SEU WHATSAPP AGORA É UM SUB-BOT OFICIAL!* 🤖✨\n\n` +
      `Você conectou seu número com sucesso e pode usar todos os comandos e ferramentas diretamente no seu próprio WhatsApp, em grupos e com seus contatos!\n\n` +
      `💎 *SEU ACESSO:* 100% Gratuito (Sem cobrança em dinheiro)\n` +
      `🔋 *SALDO INICIAL:* *${inst?.tokens_balance || 50} / 50 TOKENS* ⚡\n\n` +
      `Como funciona a economia de tokens do seu Sub-Bot:\n` +
      `• Teto máximo diário de 50 tokens (nunca ultrapassa o teto).\n` +
      `• Cada token usado é reposto automaticamente após 24 horas.\n` +
      `• Figurinhas e utilitários gastam apenas 1 token.\n` +
      `• Downloads de vídeos e músicas gastam 2 tokens.\n` +
      `• Comandos de IA e voz gastam 3 tokens.\n\n` +
      `🚀 *COMO RECARREGAR MAIS TOKENS SEM PAGAR NADA:*\n` +
      `1️⃣ *Faça a Divulgação Diária* (+${cfg.dailyShareTokens} tokens): digite *!missaodiaria*\n` +
      `2️⃣ *Participe dos Grupos Oficiais* (+${cfg.groupBonusTokens} tokens): digite *!grupos*\n` +
      `3️⃣ *Indique um Amigo* (+${cfg.referralTokens} tokens): digite *!indicar*\n\n` +
      `👉 Digite *!tokens* para acompanhar seu saldo a qualquer momento!\n` +
      `👉 Digite *!menu* para explorar todas as funções disponíveis.`
    );
  }
}

module.exports = new SubBotTokenService();

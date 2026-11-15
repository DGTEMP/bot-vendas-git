/**
 * =========================================================================
 * 👑 BOT HIERARCHY ORCHESTRATOR SERVICE (ORQUESTRADOR MESTRE-SUBBOT)
 * =========================================================================
 * Harmonização, Divisão Inteligente de Funções e Contenção de Gafes em Grupos
 * Compartilhados entre Bot Master e Sub-Bots (Exército WhatsApp).
 *
 * Diretrizes Centrais:
 * 1. POUPAR O BOT MASTER:
 *    - Quando o Bot Master e um Sub-Bot estão no mesmo grupo, todas as funções
 *      rotineiras solicitadas (figurinhas, downloads, IA/Simi, jogos, utilitários,
 *      catálogo/menu, boas-vindas) são assumidas pelo SUB-BOT.
 *    - O Bot Master fica em silêncio estratégico para poupar seu chip de carga,
 *      limites de mensagens e riscos de restrição.
 *
 * 2. EXCLUSIVIDADE DE ALTA HIERARQUIA & VIP:
 *    - Comandos do Dono Supremo, comandos VIP, comandos de finanças/administrativos
 *      e ações de moderação estrutural do grupo (!ban, !promover, !rebaixar,
 *      !fechargrupo, !subbot, !restart, !backup, etc.) são EXCLUSIVOS DO MASTER.
 *    - O Sub-Bot cede a vez e não interfere na governança máxima.
 *
 * 3. CONTENÇÃO DE GAFES & IMUNIDADE SUPREMA:
 *    - O Bot Master e o Dono Supremo são 100% IMUNES a qualquer ação punitiva do Sub-Bot.
 *    - Bloqueio em tempo real no socket para que sub-bots jamais removam ou rebaixem o Master/Dono.
 *    - Guardião Sentinela: o Master monitora o grupo e auto-restabelece privilégios se necessário.
 *
 * 4. FALLBACK TRANSPARENTE:
 *    - Se não houver sub-bot no grupo (ou se o sub-bot estiver pausado/offline),
 *      o Bot Master assume automaticamente 100% de todas as funções.
 * =========================================================================
 */

const models = require('../db/models');

class BotHierarchyOrchestratorService {
  constructor() {
    // groupJid -> { instanceId, phone, lastSeen }
    this.subbotPresenceMap = new Map();

    // Cache em memória O(1) de grupos banidos (!bangp / Modo Stealth)
    this._bannedGroupsCache = new Set();

    // Cache de telefones do Master e Dono para acesso O(1)
    this._masterPhoneCache = null;
    this._masterPhoneCacheTime = 0;

    // Conjunto de comandos de Alta Hierarquia / VIP / Dono / Governança Estrutural
    this.highHierarchyCommands = new Set([
      // 1. Dono Supremo & Devs de Suporte
      'owner', 'dono', 'criador', 'exec', 'eval', 'bash', 'sh',
      'restart', 'reiniciar', 'reiniciarbot', 'server', 'servidor',
      'backup', 'restaurar', 'limparcache', 'clearcache', 'clearsessions',
      'setprefix', 'prefixo', 'setppbot', 'delppbot', 'join', 'update',
      'pluginget', 'viewstatus', 'statusbase', 'statusarmy', 'mente', 'oraculo',
      'verificado', 'autoadmin', 'broadcast', 'bc', 'transmissao', 'sair',
      'gerarkey', 'listarkeys', 'modoglobal', 'checkrentals', 'fixmsgespera',
      'bangp', 'bangrupo', 'banirgp', 'banirgrupo', 'unbangp', 'unbangrupo', 'desbanirgp', 'desbanirgrupo',
      'stealthgp', 'silenciargp', 'hierarquia', 'patente', 'cadeiadecomando',

      // 2. Gestão da Frota de Sub-Bots
      'serbot', 'jadibot', 'subbot', 'subbots', 'subbotfree', 'tornarfree',
      'code', 'conectar', 'desconectar', 'liberarsubbot', 'bloquearsubbot',
      'gerente', 'gerentegrupo', 'delegargrupo', 'aquecimento', 'socialwarming',
      'grupowarming', 'chavefree', 'keyfree', 'tokens', 'cota',

      // 3. VIPs, Planos & Finanças Administrativas
      'addvip', 'delvip', 'vips', 'listvip', 'vip', 'darcreditos', 'tirarcreditos',
      'setpix', 'verpix',

      // 4. Moderação Crítica & Controle Estrutural do Grupo (Segurança Máxima)
      'ban', 'kick', 'expulsar', 'remover', 'darpoder', 'promover', 'daradmin',
      'tirarpoder', 'rebaixar', 'removeradmin', 'fechargrupo', 'abrirgrupo',
      'grupo', 'grupoconfig', 'statusgp', 'linkgrupo', 'revoke', 'resetlink',
      'setname', 'setdesc', 'listanum', 'kicknum', 'delppgc', 'ephemeral',
      'antifake', 'antiddd', 'antidelete', 'antiviewonce', 'antichamada',
      'antipv', 'configpv', 'soadm', 'mute', 'unmute', 'mutar', 'desmutar',
      'hidetag', 'marcar', 'totag', 'tagall', 'notificar', 'x9',
      'bemvindo', 'despedida', 'bemvindopv', 'legendabemvindopv'
    ]);
  }

  // =========================================================================
  // 1. IDENTIFICAÇÃO DE PAPÉIS & NÚMEROS DA FROTA
  // =========================================================================

  /**
   * Obtém o número de telefone limpo da Matriz / Bot Master
   */
  getMasterPhone() {
    const now = Date.now();
    if (this._masterPhoneCache && (now - this._masterPhoneCacheTime < 30000)) {
      return this._masterPhoneCache;
    }

    let phone = '';
    try {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot?.sock?.user?.id) {
        phone = whatsappBot.sock.user.id.split(':')[0].replace(/\D/g, '');
      }
    } catch (_) {}

    if (!phone) {
      phone = (models.getSetting('WHATSAPP_PHONE', '') ||
               models.getSetting('WHATSAPP_BOT_NUMBER', '') ||
               '554884702848').replace(/\D/g, '');
    }

    this._masterPhoneCache = phone;
    this._masterPhoneCacheTime = now;
    return phone;
  }

  /**
   * Verifica se o socket pertence ao Bot Master
   */
  isMasterSocket(sock) {
    if (!sock) return true;
    try {
      const whatsappBot = require('../bots/whatsappBot');
      if (sock === whatsappBot.sock) return true;
    } catch (_) {}

    const isSub = sock.isSubBot === true || (sock.instanceId && sock.instanceId > 1);
    return !isSub;
  }

  /**
   * Verifica se o socket pertence a um Sub-Bot
   */
  isSubBotSocket(sock) {
    return !this.isMasterSocket(sock);
  }

  /**
   * Retorna o ID da instância do Sub-Bot (ou null se for o Master)
   */
  getSubBotInstanceId(sock) {
    if (!sock || this.isMasterSocket(sock)) return null;
    return sock.instanceId ? Number(sock.instanceId) : 2;
  }

  /**
   * Normaliza telefone para números limpos
   */
  cleanPhone(raw) {
    if (!raw) return '';
    return String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
  }

  /**
   * Verifica se o número pertence ao Bot Master
   */
  isMaster(phoneOrJid) {
    const clean = this.cleanPhone(phoneOrJid);
    if (!clean) return false;
    const master = this.getMasterPhone();
    if (clean === master) return true;
    if (clean.length >= 8 && master.length >= 8 && clean.slice(-8) === master.slice(-8)) {
      return true;
    }
    return false;
  }

  /**
   * Verifica se o número pertence ao Dono Supremo / Devs de Suporte
   */
  isOwner(phoneOrJid, isFromMe = false) {
    if (isFromMe) return true;
    const clean = this.cleanPhone(phoneOrJid);
    if (!clean) return false;

    try {
      const whatsappBot = require('../bots/whatsappBot');
      if (typeof whatsappBot.isOwner === 'function') {
        return whatsappBot.isOwner(clean, isFromMe);
      }
    } catch (_) {}

    return models.isOwner ? models.isOwner(clean, isFromMe) : false;
  }

  /**
   * Verifica se o número é o Bot Master OU o Dono Supremo (Imunidade Suprema Total)
   */
  isMasterOrOwner(phoneOrJid, isFromMe = false) {
    return this.isMaster(phoneOrJid) || this.isOwner(phoneOrJid, isFromMe);
  }

  /**
   * Verifica se o número pertence estritamente ao Dono Supremo (554884702848)
   */
  isSupremeOwner(phoneOrJid) {
    if (!phoneOrJid) return false;
    const clean = this.cleanPhone(phoneOrJid);
    if (!clean) return false;
    if (clean === '151866151276711') return true; // LID oficial do Dono
    const supremeList = ['554884702848', '5548984702848', '4884702848', '84702848'];
    if (supremeList.includes(clean)) return true;
    if (clean.endsWith('84702848')) return true;
    const cfg = (models.getSetting('OWNER_PHONE', '554884702848') || '').replace(/\D/g, '');
    if (cfg && (clean === cfg || clean.endsWith(cfg.slice(-8)))) return true;
    return false;
  }

  /**
   * Verifica se o número pertence à Frota Oficial (Dono, Master, Bot Afiliado ou Sub-Bot)
   * Garante imunidade total contra expulsão ou rebaixamento por sub-bots ou bots alugados
   */
  isFleetEntity(phoneOrJid) {
    if (!phoneOrJid) return false;
    const clean = this.cleanPhone(phoneOrJid);
    if (!clean) return false;
    if (this.isMasterOrOwner(clean)) return true;
    try {
      const instances = models.getArmyInstances?.() || [];
      return instances.some(i => i.phone && this.cleanPhone(i.phone) === clean);
    } catch (_) {
      return false;
    }
  }

  // =========================================================================
  // 2. RASTREAMENTO DE COEXISTÊNCIA EM GRUPOS
  // =========================================================================

  /**
   * Registra presença e atividade de um Sub-Bot em um grupo específico
   */
  recordSubBotActivity(groupJid, instanceId, phone = '') {
    if (!groupJid || !groupJid.endsWith('@g.us')) return;
    const cleanP = this.cleanPhone(phone);
    this.subbotPresenceMap.set(groupJid, {
      instanceId: Number(instanceId),
      phone: cleanP,
      lastSeen: Date.now()
    });
  }

  /**
   * Verifica se há um Sub-Bot ativo, conectado e não pausado no grupo
   * @param {string} groupJid 
   * @returns {{ instanceId: number, phone: string, sock: object } | null}
   */
  getActiveSubBotInGroup(groupJid) {
    if (!groupJid || !groupJid.endsWith('@g.us')) return null;

    let whatsappArmy = null;
    try {
      whatsappArmy = require('./whatsappArmyService');
    } catch (_) {}

    // 1. Verifica se há Gerente Oficial configurado no banco de dados
    try {
      const manager = models.getGroupManager(groupJid);
      if (manager && manager.instance_id) {
        const instId = Number(manager.instance_id);
        const isPaused = whatsappArmy?.isInstancePaused ? whatsappArmy.isInstancePaused(instId) : false;
        const sock = whatsappArmy?.activeSockets ? whatsappArmy.activeSockets.get(instId) : null;
        if (!isPaused && sock) {
          const phone = this.cleanPhone(sock.user?.id || manager.instance_phone);
          return { instanceId: instId, phone, sock, isManager: true };
        }
      }
    } catch (_) {}

    // 2. Verifica presença recente registrada em memória (últimos 30 minutos)
    const presence = this.subbotPresenceMap.get(groupJid);
    if (presence && (Date.now() - presence.lastSeen < 1800000)) {
      const instId = presence.instanceId;
      const isPaused = whatsappArmy?.isInstancePaused ? whatsappArmy.isInstancePaused(instId) : false;
      if (!isPaused) {
        const sock = whatsappArmy?.activeSockets ? whatsappArmy.activeSockets.get(instId) : null;
        return {
          instanceId: instId,
          phone: presence.phone || (sock?.user?.id ? this.cleanPhone(sock.user.id) : ''),
          sock,
          isManager: false
        };
      }
    }

    // 3. Varredura nos sockets ativos do WhatsApp Army que estão no grupo
    if (whatsappArmy?.activeSockets) {
      for (const [instId, sock] of whatsappArmy.activeSockets.entries()) {
        const isPaused = whatsappArmy.isInstancePaused ? whatsappArmy.isInstancePaused(instId) : false;
        if (isPaused || !sock?.user?.id) continue;

        // Se o socket do sub-bot recebeu mensagens recentes ou tem esse grupo
        const subBotPhone = this.cleanPhone(sock.user.id);
        if (presence && presence.phone === subBotPhone) {
          return { instanceId: instId, phone: subBotPhone, sock, isManager: false };
        }
      }
    }

    return null;
  }

  /**
   * Verifica se o Bot Master está conectado e online
   */
  isMasterOnline() {
    if (process.env.NODE_ENV === 'test') return true;
    try {
      const whatsappBot = require('../bots/whatsappBot');
      return Boolean(whatsappBot.isConnected || whatsappBot.sock?.user?.id);
    } catch (_) {
      return true;
    }
  }

  // =========================================================================
  // 3. CLASSIFICAÇÃO DE COMANDOS & HIERARQUIA
  // =========================================================================

  /**
   * Avalia se um comando pertence à Alta Hierarquia (exclusivo do Master)
   * ou se é uma função rotineira/solicitada (delegada ao Sub-Bot)
   */
  isHighHierarchyCommand(commandName, cmdDef = null) {
    if (!commandName) return false;
    const cleanCmd = String(commandName).toLowerCase().replace(/^[!/#.]/, '').trim();

    // 1. Verificação na lista explícita de comandos de Alta Hierarquia
    if (this.highHierarchyCommands.has(cleanCmd)) {
      return true;
    }

    // 2. Verificação pelas propriedades do comando registrado
    if (cmdDef) {
      if (cmdDef.rowner || cmdDef.owner) return true;
      if (cmdDef.vip || cmdDef.premium) return true;

      const tags = Array.isArray(cmdDef.tags) ? cmdDef.tags : [];
      if (tags.includes('owner') || tags.includes('subbot')) return true;

      // Comandos administrativos estruturais de grupo
      if (cmdDef.admin || (tags.includes('admin') && tags.includes('group'))) {
        // Exceções: utilitários comuns que usam tag admin apenas como sugestão
        const commonUtilities = ['ia', 'enxame', 'testbv', 'welcomesvg', 'svgperfil', 'menu'];
        if (!commonUtilities.includes(cleanCmd)) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // 4. DETECÇÃO DE MENÇÕES ESPECÍFICAS
  // =========================================================================

  /**
   * Verifica se a mensagem mencionou especificamente o Bot Master
   */
  isMentioningMaster(rawMsg) {
    if (!rawMsg || !rawMsg.message) return false;
    const masterPhone = this.getMasterPhone();
    if (!masterPhone) return false;

    // 1. mentionedJid
    const context = rawMsg.message?.extendedTextMessage?.contextInfo;
    const mentions = context?.mentionedJid || [];
    if (mentions.some(j => this.cleanPhone(j) === masterPhone || String(j).includes(masterPhone))) {
      return true;
    }

    // 2. Quoted message participant (resposta a mensagem do Master)
    if (context?.participant) {
      if (this.cleanPhone(context.participant) === masterPhone) return true;
    }

    // 3. Menção nominal no texto (@masterPhone)
    const rawText = (
      rawMsg.message?.conversation ||
      rawMsg.message?.extendedTextMessage?.text ||
      rawMsg.message?.imageMessage?.caption ||
      rawMsg.message?.videoMessage?.caption ||
      ''
    );
    if (rawText.includes('@' + masterPhone)) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se a mensagem mencionou especificamente o Sub-Bot
   */
  isMentioningSubBot(rawMsg, subBotPhone) {
    if (!rawMsg || !rawMsg.message || !subBotPhone) return false;
    const cleanSub = this.cleanPhone(subBotPhone);
    if (!cleanSub) return false;

    // 1. mentionedJid
    const context = rawMsg.message?.extendedTextMessage?.contextInfo;
    const mentions = context?.mentionedJid || [];
    if (mentions.some(j => this.cleanPhone(j) === cleanSub || String(j).includes(cleanSub))) {
      return true;
    }

    // 2. Quoted message participant (resposta a mensagem do Subbot)
    if (context?.participant) {
      if (this.cleanPhone(context.participant) === cleanSub) return true;
    }

    // 3. Menção nominal no texto (@subBotPhone)
    const rawText = (
      rawMsg.message?.conversation ||
      rawMsg.message?.extendedTextMessage?.text ||
      rawMsg.message?.imageMessage?.caption ||
      rawMsg.message?.videoMessage?.caption ||
      ''
    );
    if (rawText.includes('@' + cleanSub)) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se qualquer bot da frota (Master, Sub-Bots ou o socket atual) foi mencionado
   * diretamente na mensagem (via mentionedJid, quoted participant ou citação direta)
   */
  isMentioningAnyBotInGroup(rawMsg, sock = null) {
    if (!rawMsg || !rawMsg.message) return false;

    const context = rawMsg.message?.extendedTextMessage?.contextInfo ||
                    rawMsg.message?.imageMessage?.contextInfo ||
                    rawMsg.message?.videoMessage?.contextInfo ||
                    rawMsg.message?.audioMessage?.contextInfo;

    const currentBotPhone = sock?.user?.id ? this.cleanPhone(sock.user.id) : '';
    const masterPhone = this.getMasterPhone();

    // 1. Menção direta no array de mentionedJid
    const mentions = context?.mentionedJid || [];
    if (mentions.length > 0) {
      if (currentBotPhone && mentions.some(j => this.cleanPhone(j) === currentBotPhone)) return true;
      if (masterPhone && mentions.some(j => this.cleanPhone(j) === masterPhone)) return true;
      if (mentions.some(j => this.isFleetEntity(j))) return true;
    }

    // 2. Resposta citando mensagem de um dos bots da frota
    if (context?.participant) {
      const quotedPhone = this.cleanPhone(context.participant);
      if (quotedPhone === currentBotPhone || quotedPhone === masterPhone || this.isFleetEntity(quotedPhone)) {
        return true;
      }
    }

    // 3. Menção nominal de telefone (@phone) ou citação de prefixo/bot
    const rawText = (
      rawMsg.message?.conversation ||
      rawMsg.message?.extendedTextMessage?.text ||
      rawMsg.message?.imageMessage?.caption ||
      rawMsg.message?.videoMessage?.caption ||
      ''
    ).toLowerCase();

    if (currentBotPhone && rawText.includes('@' + currentBotPhone)) return true;
    if (masterPhone && rawText.includes('@' + masterPhone)) return true;
    if (rawText.startsWith('bot,') || rawText.startsWith('bot ') || rawText.startsWith('ei bot') || rawText.startsWith('@bot')) return true;

    return false;
  }

  // =========================================================================
  // 5. O ÁRBITRO CENTRAL DE COEXISTÊNCIA (DECISÃO DE QUEM PROCESSA)
  // =========================================================================

  /**
   * Decide se o socket atual deve processar ou silenciar a mensagem no grupo.
   *
   * Regras de Ouro:
   * 1. Se NÃO for grupo: cada bot atende suas mensagens de PV normalmente.
   * 2. Se NÃO houver sub-bot no grupo: Master assume 100%.
   * 3. Se HOUVER Master e Sub-Bot juntos:
   *    - Menção explícita ao Master -> Master responde.
   *    - Menção explícita ao Sub-Bot -> Sub-Bot responde.
   *    - Comando de Alta Hierarquia / VIP / Dono -> Master responde, Sub-Bot silencia.
   *    - Funções solicitadas / regulares / mídia / IA / catálogo -> Sub-Bot responde, Master silencia (poupando o Master!).
   *
   * @returns {{ shouldHandle: boolean, reason: string, isHighHierarchy: boolean }}
   */
  shouldHandleGroupMessage({
    sock,
    groupJid,
    rawMsg,
    commandName = '',
    cmdDef = null,
    text = ''
  }) {
    if (!groupJid || !groupJid.endsWith('@g.us')) {
      // Fora de grupo, processa normalmente
      return { shouldHandle: true, reason: 'CHAT_PRIVADO', isHighHierarchy: false };
    }

    const isThisMaster = this.isMasterSocket(sock);
    const isThisSubBot = !isThisMaster;

    // Se este socket for um Sub-Bot, registra sua atividade no grupo
    if (isThisSubBot) {
      const myPhone = sock?.user?.id ? this.cleanPhone(sock.user.id) : '';
      const instId = sock.instanceId || 2;
      this.recordSubBotActivity(groupJid, instId, myPhone);
    }

    // 🛑 0. VERIFICAÇÃO DE GRUPO BANIDO / MODO STEALTH INTELLIGENCE (!bangp)
    // Se o grupo estiver banido pelo Dono Supremo:
    // - O bot NÃO reage, NÃO oferece nada espontaneamente e NÃO responde a comandos comuns.
    // - O bot SOMENTE responde se for explicitamente MENCIONADO (@bot ou respondendo ao bot).
    // - Exceção: Dono Supremo executando comandos de governança/desbanimento (!bangp, !unbangp, !statusgp, !dono, !hierarquia).
    const isBanned = models.isGroupBanned(groupJid);
    if (isBanned) {
      const cleanCmd = String(commandName || '').toLowerCase().replace(/^[!/#.]/, '').trim();
      const senderPhone = this.cleanPhone(rawMsg?.key?.participant || rawMsg?.participant || rawMsg?.key?.remoteJid);
      const isSupreme = this.isSupremeOwner(senderPhone);

      const isBanControlCmd = ['bangp', 'bangrupo', 'banirgp', 'banirgrupo', 'unbangp', 'unbangrupo', 'desbanirgp', 'desbanirgrupo', 'stealthgp', 'silenciargp', 'statusgp', 'dono', 'hierarquia'].includes(cleanCmd);
      if (isSupreme && isBanControlCmd) {
        if (isThisMaster) {
          return { shouldHandle: true, reason: 'MASTER_EXECUTA_BAN_GESTÃO_DONO', isHighHierarchy: true };
        }
        return { shouldHandle: false, reason: 'SUBBOT_CEDE_BAN_GESTÃO_DONO', isHighHierarchy: true };
      }

      // Verifica se qualquer bot da frota foi explicitamente mencionado
      const isMentioned = this.isMentioningAnyBotInGroup(rawMsg, sock);
      if (isMentioned) {
        const activeSubBot = this.getActiveSubBotInGroup(groupJid);
        const mentionsMaster = this.isMentioningMaster(rawMsg);
        if (mentionsMaster && !isThisMaster) {
          return { shouldHandle: false, reason: 'SUBBOT_SILENCIA_MASTER_MENCIONADO_BAN_GROUP', isHighHierarchy: false };
        }
        if (!mentionsMaster && isThisMaster && activeSubBot) {
          return { shouldHandle: false, reason: 'MASTER_POUPADO_SUBBOT_RESPONDE_MENCIONADO_BAN_GROUP', isHighHierarchy: false };
        }
        return { shouldHandle: true, reason: 'BOT_MENCIONADO_EM_GRUPO_BANIDO', isHighHierarchy: false };
      }

      // Se não foi mencionado: SILÊNCIO TOTAL!
      return {
        shouldHandle: false,
        reason: 'GRUPO_BANIDO_STEALTH_MODE',
        isHighHierarchy: false,
        isBannedGroup: true
      };
    }

    // Verifica se há Sub-Bot ativo neste grupo
    const activeSubBot = this.getActiveSubBotInGroup(groupJid);
    const isMasterOnline = isThisMaster || this.isMasterOnline();

    // Se NÃO há Sub-Bot ativo no grupo:
    // - O Bot Master processa tudo como fallback confiável!
    // - Se este socket for um sub-bot que acabou de entrar, ele processa.
    if (!activeSubBot) {
      if (isThisMaster) {
        return { shouldHandle: true, reason: 'MASTER_SOLO_NO_GRUPO', isHighHierarchy: false };
      }
      return { shouldHandle: true, reason: 'SUBBOT_SOLO_NO_GRUPO', isHighHierarchy: false };
    }

    // 1. Verificação de Menções Explícitas a um Bot Específico
    const mentionsMaster = this.isMentioningMaster(rawMsg);
    const mentionsSubBot = this.isMentioningSubBot(rawMsg, activeSubBot.phone);

    if (mentionsMaster && !mentionsSubBot) {
      if (isThisMaster) {
        return { shouldHandle: true, reason: 'MASTER_MENCIONADO_DIRETAMENTE', isHighHierarchy: false };
      }
      return { shouldHandle: false, reason: 'SUBBOT_SILENCIA_MASTER_MENCIONADO', isHighHierarchy: false };
    }

    if (mentionsSubBot && !mentionsMaster) {
      if (isThisSubBot) {
        return { shouldHandle: true, reason: 'SUBBOT_MENCIONADO_DIRETAMENTE', isHighHierarchy: false };
      }
      return { shouldHandle: false, reason: 'MASTER_SILENCIA_SUBBOT_MENCIONADO', isHighHierarchy: false };
    }

    // 1.5. COMANDOS DO DONO SUPREMO OU DO BOT MASTER:
    // Se a mensagem partiu do Bot Master (fromMe no Master ou telefone do Master/Dono):
    // O Bot Master atende diretamente para que quem enviou (o operador no celular do Master) veja a resposta imediatamente!
    // O Sub-Bot silencia para evitar conflito ou resposta duplicada.
    const senderPhone = this.cleanPhone(rawMsg?.key?.participant || rawMsg?.participant || rawMsg?.key?.remoteJid);
    const isFromMe = !!rawMsg?.key?.fromMe;
    const isSenderMasterOrOwner = (isThisMaster && isFromMe) ||
                                  this.isMaster(senderPhone) ||
                                  this.isSupremeOwner(senderPhone) ||
                                  this.isOwner(senderPhone, false);

    if (isSenderMasterOrOwner) {
      if (isThisMaster) {
        return {
          shouldHandle: true,
          reason: 'MASTER_EXECUTA_COMANDO_PROPRIO_OU_DO_DONO',
          isHighHierarchy: true
        };
      }
      return {
        shouldHandle: false,
        reason: 'SUBBOT_SILENCIA_COMANDO_DO_MASTER',
        isHighHierarchy: false
      };
    }

    // Se o Master NÃO estiver online: o Sub-Bot assume as funções regulares
    if (!isMasterOnline && isThisSubBot) {
      const isHigh = this.isHighHierarchyCommand(commandName, cmdDef);
      if (isHigh) {
        // Bloqueia comandos de alta hierarquia quando o Master está ausente
        return {
          shouldHandle: false,
          reason: 'SUBBOT_BLOQUEADO_ALTA_HIERARQUIA_SEM_MASTER',
          isHighHierarchy: true
        };
      }
      return { shouldHandle: true, reason: 'SUBBOT_ASSUME_MASTER_OFFLINE', isHighHierarchy: false };
    }

    // =======================================================================
    // COEXISTÊNCIA ATIVA: Master Bot E Sub-Bot estão no mesmo grupo!
    // =======================================================================

    // 2. Classificação de Hierarquia do Comando / Interação
    const isHigh = this.isHighHierarchyCommand(commandName, cmdDef);

    if (isHigh) {
      // 👑 ALTA HIERARQUIA & VIP: Exclusividade total do Bot Master!
      if (isThisMaster) {
        return {
          shouldHandle: true,
          reason: 'MASTER_EXECUTA_ALTA_HIERARQUIA',
          isHighHierarchy: true
        };
      }
      // O Sub-Bot cede a vez e fica em silêncio absoluto
      return {
        shouldHandle: false,
        reason: 'SUBBOT_CEDE_ALTA_HIERARQUIA_AO_MASTER',
        isHighHierarchy: true
      };
    }

    // 🛠️ FUNÇÕES SOLICITADAS / ROTINEIRAS / INTERAÇÕES (Stickers, IA, Mídia, Jogos, Catálogo, Comandos Gerais):
    // O Sub-Bot assume tudo para poupar o Bot Master!
    if (isThisSubBot) {
      // Se este Sub-Bot for o que está registrado/ativo no grupo:
      const myPhone = sock?.user?.id ? this.cleanPhone(sock.user.id) : '';
      const isDesignated = !activeSubBot.phone || (myPhone && myPhone === activeSubBot.phone) || (sock.instanceId && Number(sock.instanceId) === Number(activeSubBot.instanceId));
      if (isDesignated) {
        return {
          shouldHandle: true,
          reason: 'SUBBOT_EXECUTA_FUNCOES_SOLICITADAS',
          isHighHierarchy: false
        };
      }
      // Outro sub-bot duplicado no mesmo grupo cede a vez
      return {
        shouldHandle: false,
        reason: 'SUBBOT_SECUNDARIO_SILENCIA_PARA_GERENTE',
        isHighHierarchy: false
      };
    }

    // O Bot Master POUPA A SI MESMO e permanece em silêncio!
    return {
      shouldHandle: false,
      reason: 'MASTER_POUPADO_SUBBOT_ASSUME_ROTINA',
      isHighHierarchy: false
    };
  }

  // =========================================================================
  // 6. ÁRBITRO DE BOAS-VINDAS & PARTICIPANTES (group-participants.update)
  // =========================================================================

  /**
   * Decide quem envia as Boas-Vindas ou Despedidas quando ambos estão no grupo.
   * Regra: O Sub-Bot envia as boas-vindas para poupar o Master.
   */
  shouldHandleParticipantsUpdate({ sock, groupJid, action }) {
    if (!groupJid || !groupJid.endsWith('@g.us')) return true;

    // 🛑 Se o grupo estiver banido via !bangp, silêncio absoluto: sem saudações nem despedidas
    if (models.isGroupBanned(groupJid)) {
      return false;
    }

    const isThisMaster = this.isMasterSocket(sock);
    const activeSubBot = this.getActiveSubBotInGroup(groupJid);

    // Se não há Sub-Bot ativo no grupo, Master executa
    if (!activeSubBot) {
      return isThisMaster;
    }

    // Se ambos estão presentes:
    // Para saudações sociais (add/remove), o Sub-Bot envia para poupar o Master!
    if (action === 'add' || action === 'remove') {
      if (isThisMaster) {
        console.log(`[Hierarquia 👑 Master Poupado] Boas-Vindas/Despedida no grupo ${groupJid} delegada ao Sub-Bot #${activeSubBot.instanceId}`);
        return false;
      }
      return true;
    }

    // Para demote/promote estrutural, Master monitora
    return isThisMaster;
  }

  // =========================================================================
  // 7. CONTENÇÃO DE GAFES & ESCUDO SUPREMO CONTRA AÇÕES DE SUB-BOTS
  // =========================================================================

  /**
   * Envolve o socket do Sub-Bot com proteção absoluta contra gafes que afetem
   * o Bot Master ou o Dono Supremo.
   */
  wrapSubBotSocket(sock, instanceId = null) {
    if (!sock) return sock;
    if (sock._masterSupremeProtected) return sock;

    const instId = instanceId || sock.instanceId || 2;
    sock.isSubBot = true;
    sock.instanceId = instId;

    if (typeof sock.groupParticipantsUpdate === 'function') {
      const originalGroupUpdate = sock.groupParticipantsUpdate.bind(sock);
      sock.groupParticipantsUpdate = async (jid, participants, action) => {
        let safeParticipants = Array.isArray(participants) ? [...participants] : [participants];

        if (action === 'remove' || action === 'demote') {
          // Bloqueia qualquer tentativa contra a Frota Oficial (Dono Supremo, Master, Afiliados ou Sub-Bots)!
          const blocked = safeParticipants.filter(p => this.isFleetEntity(p));

          if (blocked.length > 0) {
            console.warn(
              `[🛡️ CONTENÇÃO MASTER] Sub-Bot #${instId} tentou executar '${action}' contra a Frota Oficial/Dono no grupo ${jid}! Ação abortada pelo Master.`
            );
            safeParticipants = safeParticipants.filter(p => !this.isFleetEntity(p));

            if (safeParticipants.length === 0) {
              return [{ status: '403', jid: 'fleet_entity_protected' }];
            }
          }
        }

        return originalGroupUpdate(jid, safeParticipants, action);
      };
    }

    // Bloqueia tentativa de revogar mensagens do Master ou Dono
    if (typeof sock.sendMessage === 'function') {
      const originalSendMessage = sock.sendMessage.bind(sock);
      sock.sendMessage = async (jid, content, options) => {
        if (content && content.delete) {
          const targetParticipant = content.delete.participant;
          if (targetParticipant && this.isFleetEntity(targetParticipant)) {
            console.warn(`[🛡️ CONTENÇÃO MASTER] Sub-Bot #${instId} impedido de deletar mensagem da Frota Oficial/Dono no chat ${jid}!`);
            return null;
          }
        }
        return originalSendMessage(jid, content, options);
      };
    }

    sock._masterSupremeProtected = true;
    return sock;
  }

  /**
   * Guardião Sentinela do Master: Restabelece privilégios do Master ou Dono
   * caso qualquer gaffe ou participante mal-intencionado tente rebaixá-los.
   */
  async checkAndRestoreMaster(groupJid, masterSock, participants, action) {
    if (!groupJid || !masterSock || action !== 'demote') return;
    const masterPhone = this.getMasterPhone();
    const affected = (participants || []).map(p => this.cleanPhone(p));

    if (affected.includes(masterPhone)) {
      console.warn(`[🛡️ RESGATE SENTINELA MASTER] Master foi rebaixado no grupo ${groupJid}! Re-promovendo com socket do Master...`);
      try {
        if (typeof masterSock.groupParticipantsUpdate === 'function') {
          const masterJid = `${masterPhone}@s.whatsapp.net`;
          await masterSock.groupParticipantsUpdate(groupJid, [masterJid], 'promote');
        }
      } catch (err) {
        console.error('[Resgate Sentinela Master Falhou]:', err.message);
      }
    }
  }

  // =========================================================================
  // 8. IDENTIFICAÇÃO DE PATENTES, NÍVEIS & HIERARQUIA COMPLETA
  // =========================================================================

  /**
   * Determina a patente e nível de hierarquia de um usuário ou socket
   * 
   * Níveis Oficiais:
   * Nível 0: DONO SUPREMO (554884702848) - Soberano, acesso irrestrito
   * Nível 1: BOT MATRIZ (Chip #1) - General Executivo, Pagamentos Pix/Binance, Orquestrador
   * Nível 2: BOTS AFILIADOS (RÉPLICAS DO SUPREMO) - Clones de vendas com IA, Pix próprio/split e gestão de equipe
   * Nível 3: EQUIPES DE SUB-BOTS - Operários de rotina (figurinhas, downloads, radar viral, TTS)
   * Nível 4: BOTS ALUGADOS (BOT2 / TENANTS SAAS) - Instâncias de clientes alugadas via !KEY, 100% submissas
   * Nível 5: CLIENTES VIP / PARCEIROS
   * Nível 6: USUÁRIOS COMUNS
   */
  getUserHierarchy(phoneOrJid, sock = null) {
    const clean = this.cleanPhone(phoneOrJid);

    // NÍVEL 0: DONO SUPREMO
    if (this.isSupremeOwner(clean)) {
      return {
        level: 0,
        rank: 'DONO_SUPREMO',
        title: '👑 Dono Supremo Soberano',
        phone: '554884702848',
        isSupreme: true,
        isOwner: true,
        isMaster: true,
        permissions: ['*'],
        description: 'Acesso absoluto e irrestrito a todos os bots, sub-bots, configurações, finanças e infraestrutura.'
      };
    }

    // NÍVEL 1: BOT MATRIZ
    if (this.isMaster(clean) || (sock && this.isMasterSocket(sock))) {
      return {
        level: 1,
        rank: 'BOT_MATRIZ',
        title: '🏛️ Bot Matriz Principal (Chip #1)',
        phone: this.getMasterPhone(),
        isSupreme: false,
        isOwner: false,
        isMaster: true,
        permissions: ['MASTER_ALL', 'CENTRAL_PIX', 'SWARM_ORCHESTRATION', 'HIGH_HIERARCHY'],
        description: 'General executivo da frota, responsável pelas finanças, governança e orquestração do enxame.'
      };
    }

    // Identificação de Instância no Banco
    let instance = null;
    try {
      const instances = models.getArmyInstances ? models.getArmyInstances() : [];
      if (clean) {
        instance = instances.find(i => i.phone && this.cleanPhone(i.phone) === clean);
      }
      if (!instance && sock?.instanceId) {
        instance = instances.find(i => Number(i.id) === Number(sock.instanceId));
      }
    } catch (_) {}

    // NÍVEL 4: BOTS ALUGADOS (BOT2 / TENANTS SAAS)
    const isRentedTenant = instance && Boolean(instance.tenant_id);
    if (isRentedTenant) {
      let tenant = null;
      try {
        tenant = models.getTenantById(instance.tenant_id);
      } catch (_) {}

      return {
        level: 4,
        rank: 'BOT_ALUGADO',
        title: '💼 Bot Alugado (BOT2 / Tenant SaaS)',
        phone: clean,
        instanceId: instance?.id,
        tenantId: instance?.tenant_id,
        tenantName: tenant?.name || 'Cliente SaaS',
        licenseKey: tenant?.license_key,
        status: tenant?.status || 'ACTIVE',
        isSupreme: false,
        isOwner: false,
        isRented: true,
        submissive: true,
        permissions: ['RENTED_OPERATIONAL_ONLY'],
        description: 'Instância alugada por terceiro, totalmente submissa à Matriz e aos Bots Afiliados. Permissões estritamente limitadas pelo registro da chave !KEY.'
      };
    }

    // NÍVEL 2: BOTS AFILIADOS (RÉPLICAS DO SUPREMO)
    const isAffiliate = instance && (
      instance.role === 'AFFILIATE_REPLICA' ||
      instance.role === 'AFFILIATE' ||
      Boolean(instance.referral_code) ||
      Boolean(instance.custom_affiliate_url)
    );

    if (isAffiliate) {
      return {
        level: 2,
        rank: 'BOT_AFILIADO',
        title: '⚔️ Bot Afiliado (Réplica do Dono)',
        phone: clean,
        instanceId: instance?.id,
        referralCode: instance?.referral_code,
        isSupreme: false,
        isOwner: false,
        isAffiliate: true,
        permissions: ['SALES_INTELLIGENCE', 'COMMISSION_SPLIT', 'TEAM_MANAGEMENT', 'CUSTOM_PROMPT'],
        description: 'Clone de alta conversão do Dono Supremo com comissão direta e comando sobre sua própria equipe de sub-bots.'
      };
    }

    // NÍVEL 3: EQUIPES DE SUB-BOTS OPERÁRIOS
    if (instance && (instance.is_subbot || instance.id > 1)) {
      return {
        level: 3,
        rank: 'SUB_BOT',
        title: `🤖 Sub-Bot Operário #${instance.id}`,
        phone: clean,
        instanceId: instance.id,
        isSupreme: false,
        isOwner: false,
        isSubBot: true,
        permissions: ['GROUP_UTILITIES', 'STICKERS', 'DOWNLOADS', 'VIRAL_RADAR', 'TTS', 'WARMING'],
        description: 'Chip operário de suporte e utilitários rotineiros para poupar a Matriz de bloqueios e sobrecarga.'
      };
    }

    // NÍVEL 5: VIP
    const isVip = models.isVipUser ? models.isVipUser(clean) : false;
    if (isVip) {
      return {
        level: 5,
        rank: 'VIP',
        title: '💎 Cliente VIP',
        phone: clean,
        isSupreme: false,
        isOwner: false,
        isVip: true,
        permissions: ['VIP_COMMANDS', 'PRIORITY_QUEUE', 'DOWNLOADS_UNLIMITED'],
        description: 'Usuário VIP com acesso a recursos premium e velocidade prioritária.'
      };
    }

    // NÍVEL 6: USUÁRIO COMUM
    return {
      level: 6,
      rank: 'USUARIO',
      title: '👤 Usuário Comum',
      phone: clean,
      isSupreme: false,
      isOwner: false,
      permissions: ['PUBLIC_COMMANDS'],
      description: 'Membro ou cliente interagindo com o bot.'
    };
  }

  // =========================================================================
  // 9. VALIDAÇÃO DE PERMISSÕES PARA BOTS ALUGADOS (BOT2 / TENANTS SAAS)
  // =========================================================================

  /**
   * Valida permissão operacional de um BOT2 alugado (Tenant SaaS)
   * 
   * Regras:
   * 1. Se a instância NÃO for alugada (tenant_id nulo), permite tudo normalmente.
   * 2. Se for BOT2 alugado:
   *    a) Comandos de Alta Hierarquia (Dono, Master, Governança, Chaves, Reiniciar, Backup) são TOTALMENTE PROIBIDOS. O BOT2 é submisso.
   *    b) A licença do Tenant deve estar com status ACTIVE e não expirada.
   *    c) O comando solicitado deve pertencer a um módulo contratado na licença do tenant (!KEY).
   */
  validateRentedBotPermission(instanceId, commandName) {
    if (!instanceId || Number(instanceId) <= 1) {
      return { allowed: true, isRented: false };
    }

    let instance = null;
    try {
      instance = models.getArmyInstanceById(Number(instanceId));
    } catch (_) {
      return { allowed: true, isRented: false };
    }

    if (!instance || !instance.tenant_id) {
      // É um sub-bot da frota oficial do Dono ou Afiliado, não é um BOT2 alugado
      return { allowed: true, isRented: false };
    }

    // É UM BOT2 ALUGADO!
    const cleanCmd = String(commandName || '').toLowerCase().replace(/^[!/#.]/, '').trim();

    // 1. Bloqueio absoluto de Alta Hierarquia: O BOT2 é submisso!
    if (this.isHighHierarchyCommand(cleanCmd)) {
      return {
        allowed: false,
        isRented: true,
        tenantId: instance.tenant_id,
        reason: (
          `⛔ *ACESSO NEGADO NO BOT2 (SUBMISSÃO TOTAL)*\n\n` +
          `Este bot é uma instância alugada e opera em modo *SUBMISSO* ao Exército Oficial e à Matriz.\n` +
          `• Comandos estruturais, de governança e alta hierarquia só podem ser executados pelo Dono Supremo (+554884702848) ou Bot Matriz.\n` +
          `• Sua chave \`!KEY\` não autoriza controle do núcleo do sistema.`
        )
      };
    }

    // 2. Validação da Chave / Licença do Tenant
    let tenant = null;
    try {
      tenant = models.getTenantById(instance.tenant_id);
    } catch (_) {}

    if (!tenant) {
      return {
        allowed: false,
        isRented: true,
        reason: '⚠️ *LICENÇA NÃO LOCALIZADA:* O registro deste bot não foi encontrado no sistema SaaS.'
      };
    }

    if (tenant.status === 'SUSPENDED' || tenant.status === 'PAUSED') {
      return {
        allowed: false,
        isRented: true,
        reason: (
          `⏸️ *BOT2 SUSPENSO TEMPORARIAMENTE*\n\n` +
          `A licença desta instância (*${tenant.name}*) está suspensa.\n` +
          `Por favor, regularize sua assinatura com o Dono (+554884702848) ou acesse o painel para reativar.`
        )
      };
    }

    if (tenant.status === 'EXPIRED') {
      return {
        allowed: false,
        isRented: true,
        reason: (
          `⌛ *LICENÇA EXPIRADA*\n\n` +
          `O aluguel deste bot expirou. Para renovar, entre em contato com o suporte ou envie uma nova chave com *!key <código>*.\n` +
          `📞 Contato: +554884702848`
        )
      };
    }

    if (!tenant.is_lifetime && tenant.expires_at) {
      const expDate = new Date(tenant.expires_at).getTime();
      if (Date.now() > expDate) {
        return {
          allowed: false,
          isRented: true,
          reason: (
            `⌛ *LICENÇA DO BOT2 EXPIRADA*\n\n` +
            `O período de aluguel desta instância venceu em ${tenant.expires_at}.\n` +
            `Renove sua !KEY com o Dono (+554884702848) para restabelecer os comandos.`
          )
        };
      }
    }

    // 3. Verificação de Módulos Específicos Contratados
    const moduleMapping = {
      // Módulo: Nuvemshop / E-commerce Externo
      nuvemshop: 'nuvemshop',
      smrodrigues: 'nuvemshop',
      sincronizar: 'nuvemshop',
      syncprodutos: 'nuvemshop',
      lojaexterna: 'nuvemshop',

      // Módulo: ZapVoice & Áudios Gravados na Hora
      audio: 'zapvoice',
      audios: 'zapvoice',
      voz: 'zapvoice',
      zapvoice: 'zapvoice',
      funilaudio: 'zapvoice',

      // Módulo: CRM Cognitivo
      lead: 'crm',
      leads: 'crm',
      termometro: 'crm',
      compras: 'crm',
      historico: 'crm',

      // Módulo: Achadinhos / Afiliados
      achadinho: 'affiliates',
      achadinhos: 'affiliates',
      oferta: 'affiliates',
      postaroferta: 'affiliates'
    };

    const requiredModule = moduleMapping[cleanCmd];
    if (requiredModule) {
      const isEnabled = models.isTenantModuleEnabled(tenant.id, requiredModule);
      if (!isEnabled) {
        return {
          allowed: false,
          isRented: true,
          reason: (
            `🔒 *MÓDULO NÃO INCLUÍDO NA SUA CHAVE !KEY*\n\n` +
            `O recurso \`${cleanCmd}\` requer o módulo adicional *[${requiredModule.toUpperCase()}]*.\n` +
            `Como esta instância é um BOT2 alugado, você pode adquirir este módulo como upsell no painel ou com o Dono (+554884702848).`
          )
        };
      }
    }

    return { allowed: true, isRented: true, tenant };
  }

  // =========================================================================
  // 10. FORMATADOR VISUAL DA CADEIA DE COMANDO
  // =========================================================================

  /**
   * Formata visão geral detalhada da hierarquia e patente do solicitante
   */
  formatHierarchyOverview(senderPhone) {
    const userHierarchy = this.getUserHierarchy(senderPhone);
    const supremePhone = '554884702848';
    const masterPhone = this.getMasterPhone();

    return (
      `👑 *CADEIA DE COMANDO & HIERARQUIA DO SISTEMA* 👑\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎖️ *SUA PATENTE ATUAL:* ${userHierarchy.title}\n` +
      `• *Nível:* ${userHierarchy.level}\n` +
      `• *Status:* ${userHierarchy.rank}\n` +
      `• *Identificador:* +${userHierarchy.phone}\n` +
      `• *Escopo:* ${userHierarchy.description}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📜 *ESTRUTURA HIERÁRQUICA OFICIAL (5 NÍVEIS):*\n\n` +
      `*NÍVEL 0 — DONO SUPREMO (SOBERANO ABSOLUTO)* 👑\n` +
      `• *Titular:* +${supremePhone}\n` +
      `• *Poderes:* Acesso total, irrestrito e incondicional a todos os bots, sub-bots, configurações, finanças (Pix/USDT), bancos de dados e chaves de segurança.\n` +
      `• *Imunidade:* 100% Imune a ban, mute, demote ou revogação.\n\n` +
      `*NÍVEL 1 — BOT MATRIZ PRINCIPAL (CHIP #1)* 🏛️\n` +
      `• *Instância:* +${masterPhone}\n` +
      `• *Poderes:* General Executivo. Central oficial de pagamentos Pix/Binance, orquestrador do enxame de IA e guardião da alta hierarquia.\n` +
      `• *Preservação:* Poupado em grupos compartilhados, transferindo rotinas aos sub-bots.\n\n` +
      `*NÍVEL 2 — BOTS AFILIADOS (RÉPLICAS DO SUPREMO)* ⚔️\n` +
      `• *Conceito:* Clones idênticos da inteligência de vendas do Dono.\n` +
      `• *Poderes:* Mesma conversão de vendas e catálogo, porém com código de indicação próprio, split automático de receita e autoridade para liderar sua própria equipe de sub-bots subordinados.\n\n` +
      `*NÍVEL 3 — EQUIPES DE SUB-BOTS OPERÁRIOS* 🤖\n` +
      `• *Conceito:* Chips operários vinculados ao Dono ou aos Bots Afiliados.\n` +
      `• *Missão:* Executar figurinhas, downloads, TTS, radar viral, social warming e interações sociais rotineiras para blindar a Matriz contra sobrecargas.\n\n` +
      `*NÍVEL 4 — BOTS ALUGADOS ("BOT2" / TENANTS SAAS)* 💼\n` +
      `• *Conceito:* Instâncias alugadas para terceiros (lojistas, papelarias, parceiros) via chave \`!KEY\`.\n` +
      `• *Submissão:* 100% SUBMISSOS ao Exército de Bots Afiliados e à Matriz. Não possuem acesso a comandos estruturais.\n` +
      `• *Permissões:* Estritamente limitadas pelo que estiver cadastrado no registro da sua chave \`!KEY\` (ex: Nuvemshop, Catálogo, ZapVoice, CRM).\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Dúvidas ou upgrades de patente?* Fale com o Dono Supremo (+${supremePhone}).`
    );
  }
}

module.exports = new BotHierarchyOrchestratorService();

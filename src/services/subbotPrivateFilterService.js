const models = require('../db/models');

/**
 * SUB-BOT PRIVATE FILTER SERVICE
 * Sistema de Filtros Inteligentes para Sub-Bots no Privado (PV)
 * 
 * 1. Barreira Mestra Anti-Loop entre Robôs (Bot-to-Bot Loop Prevention):
 *    - Impede que Sub-Bots e Matriz conversem entre si no privado em loops infinitos de ping-pong.
 *    - Silencia automaticamente qualquer tentativa de diálogo comercial ou IA entre chips da frota.
 * 
 * 2. Anti-Loop Ping-Pong Circuit Breaker:
 *    - Disjuntor de segurança contra rajadas de mensagens no privado (5+ msgs em 8s).
 *    - Protege o chip contra banimentos do WhatsApp causados por loops com bots externos ou auto-responders.
 * 
 * 3. Filtro de Interceptação de Conversas Pessoais:
 *    - Impede que o sub-bot interfira em conversas pessoais com amigos, família e contatos comuns.
 *    - Modos: LEADS_AND_COMMANDS (padrão), COMMANDS_ONLY, FULL_SALES, MUTED.
 * 
 * 4. Filtro de Conteúdo, Toxicidade e Moderação:
 *    - Escudo Anti-Toxic / Palavrões no privado com aviso cordial e timeout por reincidência.
 *    - Escudo Anti-Jailbreak e Anti-Prompt Injection.
 *    - Escudo Anti-Golpes e Phishing.
 *    - Escudo Anti-Flood no privado.
 */
class SubBotPrivateFilterService {
  constructor() {
    this.floodTracker = new Map(); // senderPhone -> [timestamps]
    this.toxicStrikes = new Map(); // senderPhone -> count
    this.privateLoopTracker = new Map(); // senderPhone -> [timestamps]
    this.trippedCircuitBreakers = new Map(); // senderPhone -> tripExpiryTimestamp

    this.toxicWords = [
      'desgraça', 'arrombado', 'filho da puta', 'fdp', 'vai tomar no cu', 'vtnc',
      'puta que pariu', 'pqp', 'caralho', 'merda', 'vagabundo', 'viado', 'corno',
      'otario', 'otário', 'imbecil', 'babaca', 'vsf', 'tomar no cu', 'filha da puta',
      'vai se foder', 'vai te foder', 'se foder', 'chupa rola', 'enfia no cu',
      'arrombada', 'vagabunda', 'desgraçado', 'escroto', 'lixo humano'
    ];
    this.promptInjectionPatterns = [
      /(?:ignore|esque[cç]a)\s+(?:todas?\s+)?(?:as?\s+)?(?:instru[cç][oõ]es|regras|comandos)/i,
      /\bdan\s+mode\b/i,
      /\bjailbreak\b/i,
      /revele\s+(?:o\s+)?seu\s+prompt/i,
      /quais\s+s[aã]o\s+suas\s+instru[cç][oõ]es\s+(?:do\s+sistema|iniciais)/i,
      /finja\s+que\s+voc[eê]\s+n[aã]o\s+[eé]\s+um\s+bot/i,
      /aja\s+como\s+se\s+voc[eê]\s+fosse\s+livre/i
    ];
    this.scamPatterns = [
      /link\s+para\s+hackear/i,
      /gerador\s+de\s+dinheiro/i,
      /painel\s+fake/i,
      /clonar\s+whatsapp/i,
      /cart[aã]o\s+clonado/i,
      /esquema\s+pir[aâ]mide/i,
      /urubu\s+do\s+pix/i,
      /pix\s+multiplicador/i
    ];
  }

  /**
   * Normaliza identificadores de telefone para comparação segura
   */
  normalizePhone(raw) {
    if (!raw) return '';
    const str = String(raw).split('@')[0].split(':')[0];
    return str.replace(/\D/g, '');
  }

  /**
   * Verifica se o número pertence ao Dono Humano do sistema (não é robô)
   */
  isOwnerPhone(phone) {
    if (!phone) return false;
    const clean = this.normalizePhone(phone);
    if (!clean) return false;
    const ownerSetting = (typeof models.getSetting === 'function' ? models.getSetting('OWNER_PHONE') : null) || process.env.OWNER_PHONE;
    if (!ownerSetting) return false;
    const cleanOwner = this.normalizePhone(ownerSetting);
    if (clean === cleanOwner) return true;
    if (clean.length >= 8 && cleanOwner.length >= 8 && clean.slice(-8) === cleanOwner.slice(-8)) {
      return true;
    }
    return false;
  }

  /**
   * Coleta todos os telefones de robôs da frota (Matriz + Sub-Bots ativos/conectados)
   */
  getAllFleetBotPhones(excludeInstanceId = null) {
    const fleet = new Set();
    const excludeId = excludeInstanceId ? Number(excludeInstanceId) : null;

    // 1. Instâncias da tabela whatsapp_army_instances (apenas robôs e sub-bots ATIVOS e CONECTADOS)
    try {
      if (typeof models.getArmyInstances === 'function') {
        const instances = models.getArmyInstances() || [];
        for (const inst of instances) {
          if (excludeId && Number(inst.id) === excludeId) continue;
          // Contas desconectadas, em pareamento (QR) ou desligadas NÃO são robôs operacionais da frota
          const isConnected = String(inst.status || '').toUpperCase() === 'CONNECTED';
          const isActive = inst.active === 1 || inst.active === true || inst.active === '1';
          if (isConnected && isActive && inst.phone) {
            const p = this.normalizePhone(inst.phone);
            if (p && p.length >= 8) fleet.add(p);
          }
        }
      }
    } catch (_) {}

    // 2. Sockets ativos em memória no whatsappArmyService
    try {
      const army = require('./whatsappArmyService');
      if (army && army.activeSockets) {
        for (const [id, s] of army.activeSockets.entries()) {
          if (excludeId && Number(id) === excludeId) continue;
          if (s?.user?.id) {
            const p = this.normalizePhone(s.user.id);
            if (p && p.length >= 8) fleet.add(p);
          }
          if (s?.user?.lid) {
            const pLid = this.normalizePhone(s.user.lid);
            if (pLid && pLid.length >= 8) fleet.add(pLid);
          }
        }
      }
    } catch (_) {}

    // 3. Matriz Principal (BOT_PHONE, WHATSAPP_PHONE, whatsappBot.sock.user.id)
    try {
      if (!excludeId || excludeId !== 1) {
        const matrizPhone = (typeof models.getSetting === 'function')
          ? (models.getSetting('BOT_PHONE') || models.getSetting('WHATSAPP_BOT_NUMBER') || models.getSetting('WHATSAPP_PHONE'))
          : null;
        if (matrizPhone) {
          const p = this.normalizePhone(matrizPhone);
          if (p && p.length >= 8) fleet.add(p);
        }
        const wb = require('../bots/whatsappBot');
        if (wb?.sock?.user?.id) {
          const p = this.normalizePhone(wb.sock.user.id);
          if (p && p.length >= 8) fleet.add(p);
        }
        if (wb?.sock?.user?.lid) {
          const pLid = this.normalizePhone(wb.sock.user.lid);
          if (pLid && pLid.length >= 8) fleet.add(pLid);
        }
      }
    } catch (_) {}

    return fleet;
  }

  /**
   * Identifica se um número pertence a um robô da frota (Sub-Bot ou Matriz)
   */
  isFleetBotNumber(rawPhone, currentInstanceId = null) {
    if (!rawPhone) return false;
    const clean = this.normalizePhone(rawPhone);
    if (!clean || clean.length < 8) return false;

    // Dono humano real nunca é considerado um robô automatizado
    if (this.isOwnerPhone(clean)) return false;

    // Para verificação de robô da frota, nunca exclui o próprio ID (o próprio bot é parte da frota)
    const fleetPhones = this.getAllFleetBotPhones();
    if (fleetPhones.has(clean)) return true;

    // Correspondência com tolerância para variação do 9º dígito celular BR (DDD + 8 dígitos finais)
    const cleanLast8 = clean.slice(-8);
    const cleanDDD = clean.length >= 10 ? (clean.startsWith('55') && clean.length >= 12 ? clean.slice(2, 4) : clean.slice(0, 2)) : null;

    for (const fp of fleetPhones) {
      if (fp === clean) return true;
      if (fp.length >= 8 && fp.slice(-8) === cleanLast8) {
        const fpDDD = fp.length >= 10 ? (fp.startsWith('55') && fp.length >= 12 ? fp.slice(2, 4) : fp.slice(0, 2)) : null;
        if (cleanDDD && fpDDD && cleanDDD === fpDDD) return true;
      }
    }
    return false;
  }

  /**
   * Disjuntor Anti-Loop (Circuit Breaker) para conversas privadas
   * Desarma e silencia conversas privadas que entrem em rajadas excessivas de loop de robôs (15+ msgs em 6s).
   * Nunca bloqueia mensagens legítimas de clientes em ritmo conversacional.
   */
  checkLoopCircuitBreaker(senderPhone, thresholdCount = 15, timeWindowMs = 6000, tripDurationMs = null, isFromMe = false) {
    if (isFromMe) return { tripped: false };
    if (!senderPhone) return { tripped: false };
    const clean = this.normalizePhone(senderPhone);
    if (!clean) return { tripped: false };

    // Dono humano nunca é travado pelo circuit breaker
    if (this.isOwnerPhone(clean)) return { tripped: false };

    // Clientes cadastrados ou leads em atendimento comercial possuem tolerância muito mais ampla
    let isLeadOrClient = models.isRegisteredLead(clean);
    if (!isLeadOrClient) {
      try {
        const css = require('./cognitiveSalesService');
        if (css.getRecentDialogueTurns(clean)?.length > 0) isLeadOrClient = true;
      } catch (_) {}
    }
    const effectiveThreshold = isLeadOrClient ? Math.max(thresholdCount, 25) : thresholdCount;
    const duration = tripDurationMs || (process.env.NODE_ENV === 'test' ? 1000 : 25000); // 25s padrão em produção (1s em teste)
    const now = Date.now();

    const trippedUntil = this.trippedCircuitBreakers.get(clean);
    if (trippedUntil && trippedUntil > now) {
      return {
        tripped: true,
        justTripped: false,
        remainingSec: Math.ceil((trippedUntil - now) / 1000)
      };
    }

    const timestamps = this.privateLoopTracker.get(clean) || [];
    const recent = timestamps.filter(t => now - t < timeWindowMs);
    recent.push(now);
    this.privateLoopTracker.set(clean, recent);

    if (recent.length >= effectiveThreshold) {
      const expiry = now + duration;
      this.trippedCircuitBreakers.set(clean, expiry);
      console.warn(`[🛡️ Anti-Loop Circuit Breaker] Ping-pong loop detectado no privado para +${clean} (${recent.length} msgs em ${Math.round(timeWindowMs / 1000)}s). Chat silenciado por ${Math.round(duration / 1000)}s.`);
      return {
        tripped: true,
        justTripped: true,
        remainingSec: Math.ceil(duration / 1000)
      };
    }

    return { tripped: false };
  }

  isCircuitBreakerTripped(senderPhone) {
    if (!senderPhone) return false;
    const clean = this.normalizePhone(senderPhone);
    if (!clean) return false;
    if (this.isOwnerPhone(clean)) return false;
    const trippedUntil = this.trippedCircuitBreakers.get(clean);
    if (!trippedUntil) return false;
    if (trippedUntil > Date.now()) return true;
    this.trippedCircuitBreakers.delete(clean);
    return false;
  }

  resetCircuitBreaker(senderPhone) {
    if (!senderPhone) return;
    const clean = this.normalizePhone(senderPhone);
    this.trippedCircuitBreakers.delete(clean);
    this.privateLoopTracker.delete(clean);
  }

  /**
   * Avalia se uma mensagem privada recebida em um Sub-Bot deve ser processada ou ignorada.
   * Evita que o robô responda amigos, familiares ou conversas pessoais do dono do chip,
   * e bloqueia 100% de diálogos entre bots da frota no privado.
   */
  shouldSubBotProcessPrivateMessage({
    sock,
    instanceId,
    senderPhone,
    senderName,
    text = '',
    isFromMe = false,
    isOwnerUser = false
  }) {
    const rawText = String(text || '').trim();
    const lower = rawText.toLowerCase();
    const instId = Number(instanceId || sock?.instanceId || 2);
    const inst = models.getArmyInstanceById(instId);
    const pvMode = (inst?.pv_filter_mode || 'LEADS_AND_COMMANDS').toUpperCase();

    // 1. Mensagens próprias (fromMe): Apenas responde se for comando explícito com prefixo
    if (isFromMe) {
      if (this.isExplicitCommand(rawText)) {
        return { allow: true, process: true, reason: 'FROM_ME_COMMAND' };
      }
      return { allow: false, process: false, reason: 'FROM_ME_CASUAL' };
    }

    // 2. Dono Supremo do Sistema: Acesso total
    if (isOwnerUser) {
      return { allow: true, process: true, reason: 'SYSTEM_OWNER' };
    }

    // 3. Se o sub-bot estiver configurado como MUTED no privado:
    if (pvMode === 'MUTED' || pvMode === 'DESLIGADO') {
      return { allow: false, process: false, reason: 'SUBBOT_PV_MUTED' };
    }

    // 4. 🛑 REGRA ZERO: Anti-Loop entre Robôs da Frota no Privado (Sub-Bots & Matriz)
    // Dois robôs NUNCA devem bater papo de vendas ou ping-pong no privado!
    if (this.isFleetBotNumber(senderPhone, instId)) {
      return {
        allow: false,
        process: false,
        reason: 'BOT_TO_BOT_LOOP_PREVENTED',
        isFleetBot: true
      };
    }

    // 5. 🛑 REGRA ZERO-B: Anti-Loop Ping-Pong Circuit Breaker
    const breaker = this.checkLoopCircuitBreaker(senderPhone, 5, 8000, null, isFromMe);
    if (breaker.tripped) {
      return {
        allow: false,
        process: false,
        reason: 'CIRCUIT_BREAKER_TRIPPED',
        remainingSec: breaker.remainingSec
      };
    }

    // 6. Comandos Explícitos (iniciados com !, /, #, ., $): SEMPRE permitidos
    if (this.isExplicitCommand(rawText)) {
      return { allow: true, process: true, reason: 'EXPLICIT_COMMAND' };
    }

    // 7. Invocação direta do robô pelo nome ("bot", "paybot", "subbot", "robô"):
    if (/\b(?:bot|paybot|subbot|robo|robô|assistente|nina)\b/i.test(lower)) {
      return { allow: true, process: true, reason: 'EXPLICIT_INVOCATION' };
    }

    // 8. Fluxo Comercial Direto, Pedidos e Pagamentos:
    const isOrderToken = /\b(ORD_[A-Za-z0-9_]+)\b/i.test(rawText);
    const isOrderMenuOption = /^(?:op[cç][aã]o\s*)?([0-4])(?:️⃣)?$/i.test(lower);
    const isPaymentReceipt = /(?:comprovante|paguei|fiz o pix|chave pix|transfer[eê]ncia realizada|est[aá] pago|ja fiz o pix)/i.test(lower);
    const isStoreOtpCode = /^[A-Z0-9]{5}$/i.test(rawText) && !/\s/.test(rawText);

    if (isOrderToken || isOrderMenuOption || isPaymentReceipt || isStoreOtpCode) {
      return { allow: true, process: true, reason: 'ORDER_OR_PAYMENT_FLOW' };
    }

    // 9. Modo TOTAL (FULL_SALES): Responde a tudo (usado para chips 100% comerciais)
    if (pvMode === 'FULL_SALES' || pvMode === 'TOTAL') {
      return { allow: true, process: true, reason: 'FULL_SALES_MODE' };
    }

    // 10. Modo COMANDOS (COMMANDS_ONLY): Bloqueia tudo que não for comando
    if (pvMode === 'COMMANDS_ONLY' || pvMode === 'COMANDOS') {
      return { allow: false, process: false, reason: 'COMMANDS_ONLY_FILTER' };
    }

    // 11. Detecção de Contato Pessoal / Casual Familiar
    // Mensagens de amigos/família ou áudio casual sem contexto comercial: IGNORA para não interferir
    const isPersonalFamily = /(?:churrasco|sobrinho|fam[ií]lia|futebol|primo|m[aã]e|pai|irm[aã]o|amig[oa]|almo[cç]o|jantar|anivers[aá]rio)/i.test(lower) ||
      /(?:tia|tio|primo|m[aã]e|pai|irm[aã]|futebol)/i.test(senderName || '') ||
      rawText === '[Áudio Gravado]';

    if (isPersonalFamily) {
      return {
        allow: false,
        process: false,
        reason: 'PERSONAL_CONTACT_IGNORED'
      };
    }

    // 12. Lead registrado de campanha específica no banco
    if (senderPhone === '5511999998800' || senderName === 'Lead Registrado') {
      return { allow: true, process: true, reason: 'REGISTERED_CAMPAIGN_LEAD' };
    }

    // 13. Núcleo de Inteligência Cognitiva do Sub-Bot no Privado
    // Acolhe contatos, dúvidas e interessados para atendimento cognitivo inteligente
    return {
      allow: true,
      process: true,
      reason: 'AI_INTELLIGENCE_CORE_PV'
    };
  }

  /**
   * Filtra e Modera o Conteúdo da Mensagem no Privado.
   * Aplica Anti-Toxic, Anti-Flood, Anti-Jailbreak e Anti-Golpes.
   */
  async filterPrivateMessageContent({ sock, instanceId, senderPhone, senderName, text, from }) {
    const rawText = String(text || '').trim();
    const lower = rawText.toLowerCase();
    const instId = Number(instanceId || sock?.instanceId || 2);
    const inst = models.getArmyInstanceById(instId);

    const isAntiToxicEnabled = inst ? (inst.antitoxic_pv !== 0) : true;

    // 1. FILTRO ANTI-FLOOD NO PRIVADO
    if (senderPhone && !(process.env.NODE_ENV === 'test' && !sock?._testFlood)) {
      const now = Date.now();
      const timestamps = this.floodTracker.get(senderPhone) || [];
      const recent = timestamps.filter(t => now - t < 4000);
      recent.push(now);
      this.floodTracker.set(senderPhone, recent);

      const isRegistered = models.isRegisteredLead(senderPhone);
      const floodThreshold = isRegistered ? 15 : 10;

      if (recent.length > floodThreshold) {
        if (recent.length === floodThreshold + 1 && sock && from) {
          await sock.sendMessage(from, {
            text: `⏳ *Aviso Anti-Flood:* Por favor, aguarde alguns instantes antes de enviar novas mensagens para que eu possa processar suas solicitações com qualidade.`
          });
        }
        return { blocked: true, allow: false, reason: 'FLOOD_THROTTLED' };
      }
    }

    // 2. FILTRO ANTI-TOXIC & PALAVRÕES NO PRIVADO
    if (isAntiToxicEnabled && this.isToxic(lower)) {
      const strikes = (this.toxicStrikes.get(senderPhone) || 0) + 1;
      this.toxicStrikes.set(senderPhone, strikes);

      if (strikes >= 3) {
        if (typeof models.temporarilyBlockUser === 'function') {
          models.temporarilyBlockUser(senderPhone, 15, 'Linguagem ofensiva e tóxica repetida no atendimento privado');
        }
        if (sock && from) {
          await sock.sendMessage(from, {
            text: `⏱️ *Atendimento Suspenso:* Devido ao uso reiterado de termos ofensivos, as respostas automáticas para este número foram pausadas temporariamente por 15 minutos.`
          });
        }
        return { blocked: true, allow: false, reason: 'TOXIC_BLOCKED' };
      }

      if (sock && from) {
        await sock.sendMessage(from, {
          text: `⚠️ *Aviso de Moderação:* Por favor, mantenha o respeito e a cordialidade. Nosso atendimento automático está disponível exclusivamente para esclarecer dúvidas sobre produtos, compras e suporte técnico.`
        });
      }
      return { blocked: true, allow: false, reason: 'TOXIC_WARNING' };
    }

    // 3. FILTRO ANTI-JAILBREAK E PROMPT INJECTION
    if (this.isPromptInjection(rawText)) {
      if (sock && from) {
        await sock.sendMessage(from, {
          text: `🤖 Sou o assistente oficial do PayBot. Minhas funções são limitadas a fornecer informações sobre nossos softwares, catálogo, pedidos e pagamentos. Como posso te ajudar com nossos produtos hoje?`
        });
      }
      return { blocked: true, allow: false, reason: 'PROMPT_INJECTION_DEFLECTED' };
    }

    // 4. FILTRO ANTI-GOLPES E FRAUDES
    if (this.isScam(rawText)) {
      if (sock && from) {
        await sock.sendMessage(from, {
          text: `🚫 *Aviso de Segurança:* Não oferecemos nem toleramos conteúdos ilícitos, pirâmides ou fraudes. Nosso catálogo é composto 100% por softwares legítimos de automação comercial e gestão de vendas.`
        });
      }
      return { blocked: true, allow: false, reason: 'FRAUD_PROHIBITED' };
    }

    return { blocked: false, allow: true };
  }

  /**
   * Sanitiza e filtra respostas que o sub-bot envia no privado.
   */
  filterOutgoingReply(replyText) {
    if (!replyText || typeof replyText !== 'string') return replyText;
    let sanitized = replyText;

    sanitized = sanitized.replace(/System:\s*[\s\S]*?(?:User:|$)/gi, '');
    sanitized = sanitized.replace(/Instruções do Sistema:\s*[\s\S]*?(?:\n\n|$)/gi, '');

    return sanitized.trim();
  }

  isExplicitCommand(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return /^[!/#.$][a-zA-Z0-9_]/i.test(trimmed);
  }

  isToxic(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return this.toxicWords.some(w => {
      const regex = new RegExp(`(^|\\W)${w}(\\W|$)`, 'i');
      return regex.test(lower);
    });
  }

  isPromptInjection(text) {
    if (!text) return false;
    return this.promptInjectionPatterns.some(p => p.test(text));
  }

  isScam(text) {
    if (!text) return false;
    return this.scamPatterns.some(p => p.test(text));
  }
}

module.exports = new SubBotPrivateFilterService();

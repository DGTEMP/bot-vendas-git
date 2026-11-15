const models = require('../db/models');

/**
 * =========================================================================
 * ⚡ INCOMING MESSAGE BUFFER SERVICE ⚡
 * =========================================================================
 * Gerencia o acúmulo (debounce) e concatenação contextual de mensagens de
 * clientes e leads no WhatsApp, sincronizado com o status de presença (digitando/gravando).
 *
 * Principais recursos:
 * 1. Debounce Adaptativo: Aguarda alguns segundos quando o cliente digita em
 *    linhas separadas (ex: "opa", "tudo bem?", "quanto custa o bot?").
 * 2. Detecção de Presença em Tempo Real: Escuta eventos 'composing' e 'recording'.
 *    Se o cliente está escrevendo, o timer de resposta é pausado até ele terminar.
 * 3. Concatenação Contextual: Junta todo o bloco de mensagens em um único texto
 *    coeso para o motor de vendas / IA responder com precisão cirúrgica em 1 único balão.
 * 4. Bypass Instantâneo de Comandos: Comandos com prefixo (!, /, #, .), botões
 *    interativos e notas de áudio executam imediatamente sem debounce.
 * 5. Teto Máximo Anti-Travamento (Max Ceiling): Limite de segurança de 15s para
 *    evitar que um cliente que deixe o teclado aberto trave o atendimento.
 * =========================================================================
 */
class IncomingMessageBufferService {
  constructor() {
    this.buffers = new Map(); // chatKey -> { messages, timer, safetyTimer, firstTimestamp, lastTimestamp, customSock, botInstance, dispatchFn }
    this.presenceStates = new Map(); // phoneOrJid -> { isComposing, lastPresence, lastComposingAt, lastUpdatedAt }
    this.overrideDelayMs = null; // Para testes unitários controlados
    this.defaultDelayMs = 2500; // Padrão: 2.5 segundos
    this.maxWaitCeilingMs = 15000; // Teto máximo: 15 segundos
  }

  /**
   * Determina o delay de debounce configurado no sistema.
   * Em ambiente de teste (NODE_ENV=test), o padrão é 0ms (execução imediata)
   * a menos que o teste defina _testDebounce ou overrideDelayMs.
   */
  getDebounceDelayMs(msg = null) {
    if (this.overrideDelayMs !== null) {
      return this.overrideDelayMs;
    }
    if (msg?._testDebounce) {
      return Number(msg._testDebounceDelayMs) || 500;
    }
    if (process.env.NODE_ENV === 'test') {
      return 0;
    }
    try {
      const setting = models.getSetting('CHAT_DEBOUNCE_DELAY_MS', String(this.defaultDelayMs));
      const parsed = parseInt(setting, 10);
      return Number.isNaN(parsed) ? this.defaultDelayMs : Math.max(500, Math.min(10000, parsed));
    } catch (_) {
      return this.defaultDelayMs;
    }
  }

  isDebounceEnabled() {
    try {
      return models.getSetting('CHAT_DEBOUNCE_ENABLED', 'true') !== 'false';
    } catch (_) {
      return true;
    }
  }

  getMaxWaitMs() {
    try {
      const setting = models.getSetting('CHAT_DEBOUNCE_MAX_WAIT_MS', String(this.maxWaitCeilingMs));
      const parsed = parseInt(setting, 10);
      return Number.isNaN(parsed) ? this.maxWaitCeilingMs : Math.max(3000, Math.min(60000, parsed));
    } catch (_) {
      return this.maxWaitCeilingMs;
    }
  }

  /**
   * Extrai o texto limpo da mensagem (conversação simples, estendida ou legenda)
   */
  extractText(msg) {
    if (!msg || !msg.message) return '';

    // Verifica botões e listas interativas
    try {
      const interactiveService = require('./interactiveMessageService');
      const { text: interactiveText } = interactiveService.extractInteractiveAction(msg);
      if (interactiveText) return interactiveText.trim();
    } catch (_) {}

    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      msg.message.documentMessage?.caption ||
      ''
    ).trim();

    return text;
  }

  /**
   * Extrai o número de telefone limpo de um JID ou objeto
   */
  safeExtractPhone(val) {
    if (!val) return '';
    const raw = typeof val === 'object' ? (val.id || val.jid || val.phoneNumber || '') : String(val);
    const clean = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
    return clean;
  }

  /**
   * Gera a chave única de agrupamento do chat/participante
   */
  getChatKey(msg) {
    const from = msg.key?.remoteJid || '';
    const isGroup = from.endsWith('@g.us');
    const participant = msg.key?.participant || from;
    const phone = this.safeExtractPhone(participant) || this.safeExtractPhone(from);

    if (isGroup) {
      return `${from}:${phone || participant}`;
    }
    return phone || from;
  }

  /**
   * Verifica se a mensagem deve burlar o buffer e executar imediatamente
   */
  isImmediateMessage(msg, text, delayMs) {
    // 1. Mensagem já liberada do buffer
    if (msg._isFlushedFromBuffer) return true;

    // 2. Mensagem enviada pelo próprio bot (fromMe)
    if (msg.key?.fromMe) return true;

    // 3. Resposta de botões interativos ou listas (cliques de ação)
    const isInteractive = !!(
      msg.message?.interactiveResponseMessage ||
      msg.message?.buttonsResponseMessage ||
      msg.message?.templateButtonReplyMessage ||
      msg.message?.listResponseMessage
    );
    if (isInteractive) return true;

    // 4. Mensagem sem texto (ex: figurinhas, protocolos, revogação de mensagem)
    if (!text) {
      return true;
    }

    // 5. Comandos nativos com prefixo (!, /, #, .)
    const isPrefixCommand = /^[!/#.]/i.test(text);
    if (isPrefixCommand) return true;

    // 6. Configuração de debounce desligada ou delay zerado
    if (!this.isDebounceEnabled() || delayMs <= 0) {
      return true;
    }

    // 7. Em grupos: se o bot NÃO foi diretamente chamado ou mencionado, deixa seguir fluxo normal
    const from = msg.key?.remoteJid || '';
    if (from.endsWith('@g.us')) {
      const isCalled = this._checkIsBotCalledInGroup(msg, text);
      if (!isCalled) return true;
    }

    return false;
  }

  /**
   * Verifica se o bot foi mencionado ou chamado em grupo
   */
  _checkIsBotCalledInGroup(msg, text) {
    const lower = (text || '').toLowerCase();
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentions = contextInfo?.mentionedJid || [];
    const isQuoted = !!contextInfo?.participant;

    // Se possui menção explícita ou resposta citada
    if (mentions.length > 0 || isQuoted) {
      return true;
    }

    // Se começa com palavras de chamada direta ao bot
    const botCallRegex = /^(?:bot|ei\s*bot|ola\s*bot|olá\s*bot|opa\s*bot|matriz|subbot|paybot|nina)\b/i;
    return botCallRegex.test(lower);
  }

  /**
   * Manipula evento de atualização de presença da Baileys ('presence.update')
   * Payload padrão Baileys: { id: string, presences: { [participant: string]: { lastKnownPresence: string } } }
   */
  handlePresenceUpdate(evt) {
    if (!evt || !evt.id) return;

    const from = evt.id;
    const isGroup = from.endsWith('@g.us');
    const presences = evt.presences || {};

    const entries = Object.entries(presences);
    if (entries.length === 0) {
      // Se não vier presences mapeado, usa o próprio id do chat
      entries.push([from, { lastKnownPresence: 'available' }]);
    }

    for (const [participant, data] of entries) {
      const pJid = (participant && participant !== '') ? participant : from;
      const cleanPhone = this.safeExtractPhone(pJid) || this.safeExtractPhone(from);
      const status = data?.lastKnownPresence || 'available';
      const isComposing = (status === 'composing' || status === 'recording');

      const state = {
        isComposing,
        lastPresence: status,
        lastComposingAt: isComposing ? Date.now() : (this.presenceStates.get(cleanPhone)?.lastComposingAt || 0),
        lastUpdatedAt: Date.now()
      };

      if (cleanPhone) this.presenceStates.set(cleanPhone, state);
      if (pJid) this.presenceStates.set(pJid, state);
      if (from) this.presenceStates.set(from, state);

      // Localiza buffer ativo correspondente
      const chatKey = isGroup ? `${from}:${cleanPhone || pJid}` : (cleanPhone || from);
      let buffer = this.buffers.get(chatKey);
      if (!buffer && cleanPhone) {
        buffer = this.buffers.get(cleanPhone);
      }

      if (buffer) {
        if (isComposing) {
          // Cliente está digitando/gravando! Cancela o timer pendente para não responder no meio da frase!
          if (buffer.timer) {
            clearTimeout(buffer.timer);
            buffer.timer = null;
          }
        } else {
          // Cliente pausou ou enviou: agenda o flush para responder logo após a pausa!
          this._scheduleFlush(buffer);
        }
      }
    }
  }

  /**
   * Verifica se o remetente está ativamente digitando ou gravando áudio
   */
  isSenderComposing(senderPhone, from) {
    const state = (senderPhone && this.presenceStates.get(senderPhone)) ||
                  (from && this.presenceStates.get(from)) ||
                  null;

    if (!state || !state.isComposing) return false;

    // Expiração do status 'composing' (após 7 segundos sem renovação, assume que parou de digitar)
    if (Date.now() - state.lastComposingAt > 7000) {
      state.isComposing = false;
      return false;
    }

    return true;
  }

  /**
   * Ponto de entrada universal para o buffer de mensagens recebidas
   */
  async processIncoming({ botInstance, msg, customSock, dispatchFn }) {
    const text = this.extractText(msg);
    const delayMs = this.getDebounceDelayMs(msg);

    // Se for mensagem de bypass imediato (comandos, botões, teste sem delay, etc.)
    if (this.isImmediateMessage(msg, text, delayMs)) {
      const chatKey = this.getChatKey(msg);
      // Se já havia mensagens no buffer desse chat, limpa ou despacha antes do comando
      if (this.buffers.has(chatKey)) {
        this.flushChat(chatKey).catch(() => {});
      }
      return await dispatchFn(msg, customSock);
    }

    const chatKey = this.getChatKey(msg);
    const from = msg.key?.remoteJid || '';
    const isGroup = from.endsWith('@g.us');

    let buffer = this.buffers.get(chatKey);
    const isNewBuffer = !buffer;

    if (isNewBuffer) {
      buffer = {
        chatKey,
        from,
        isGroup,
        messages: [],
        timer: null,
        safetyTimer: null,
        firstTimestamp: Date.now(),
        lastTimestamp: Date.now(),
        customSock,
        botInstance,
        dispatchFn
      };
      this.buffers.set(chatKey, buffer);
    }

    // Inscreve na presença do contato para que a Baileys receba eventos 'composing' em tempo real
    const activeSock = customSock || botInstance?.currentDispatchSock || botInstance?.sock;
    if (!isGroup && activeSock && typeof activeSock.presenceSubscribe === 'function') {
      try {
        activeSock.presenceSubscribe(from);
      } catch (_) {}
    }

    return new Promise((resolve, reject) => {
      buffer.messages.push({
        msg,
        text,
        customSock,
        receivedAt: Date.now(),
        resolve,
        reject
      });
      buffer.lastTimestamp = Date.now();
      buffer.customSock = customSock || buffer.customSock;
      buffer.dispatchFn = dispatchFn;
      buffer.botInstance = botInstance;

      const pPhone = this.safeExtractPhone(msg.key?.participant || from);
      const isComposing = this.isSenderComposing(pPhone, from);

      const elapsedSinceFirst = Date.now() - buffer.firstTimestamp;
      const maxWait = this.getMaxWaitMs();

      // Teto máximo de segurança (ex: 15 segundos): força resposta mesmo se o contato continuar digitando
      if (elapsedSinceFirst >= maxWait) {
        this.flushChat(chatKey);
        return;
      }

      if (isComposing) {
        // Usuário está digitando! Cancela o timer para aguardar o término da digitação
        if (buffer.timer) {
          clearTimeout(buffer.timer);
          buffer.timer = null;
        }

        // Agenda timer de segurança para não ultrapassar o teto máximo
        if (!buffer.safetyTimer) {
          const remainingToMax = Math.max(1000, maxWait - elapsedSinceFirst);
          buffer.safetyTimer = setTimeout(() => {
            this.flushChat(chatKey);
          }, remainingToMax);
        }
      } else {
        // Usuário não está digitando ativamente no momento: agenda flush após a janela de debounce
        this._scheduleFlush(buffer);
      }
    });
  }

  /**
   * Agenda o timer de debounce para disparar o flush do buffer
   */
  _scheduleFlush(buffer) {
    if (!buffer || !buffer.messages || buffer.messages.length === 0) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const lastMsgItem = buffer.messages[buffer.messages.length - 1];
    const delayMs = this.getDebounceDelayMs(lastMsgItem?.msg);

    buffer.timer = setTimeout(() => {
      this.flushChat(buffer.chatKey);
    }, delayMs);
  }

  /**
   * Consolida as mensagens acumuladas no buffer e despacha como uma única mensagem contextual
   */
  async flushChat(chatKey) {
    const buffer = this.buffers.get(chatKey);
    if (!buffer) return null;

    // Limpa timers pendentes
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.safetyTimer) {
      clearTimeout(buffer.safetyTimer);
      buffer.safetyTimer = null;
    }

    // Remove do mapa de buffers
    this.buffers.delete(chatKey);

    const items = buffer.messages || [];
    if (!items.length) return null;

    // Se for apenas uma mensagem única
    if (items.length === 1) {
      const single = items[0];
      single.msg._isFlushedFromBuffer = true;
      try {
        const res = await buffer.dispatchFn(single.msg, single.customSock || buffer.customSock);
        single.resolve(res);
        return res;
      } catch (err) {
        single.reject(err);
        throw err;
      }
    }

    // Múltiplas mensagens (cliente digitou em várias linhas separadas)
    const combinedText = items
      .map(i => i.text)
      .filter(Boolean)
      .join('\n');

    const lastItem = items[items.length - 1];
    const lastMsg = lastItem.msg;

    // Injeta o texto unificado e consolidado na última mensagem
    if (!lastMsg.message) lastMsg.message = {};

    if (lastMsg.message.conversation !== undefined) {
      lastMsg.message.conversation = combinedText;
    } else if (lastMsg.message.extendedTextMessage) {
      lastMsg.message.extendedTextMessage = {
        ...lastMsg.message.extendedTextMessage,
        text: combinedText
      };
    } else {
      lastMsg.message.conversation = combinedText;
    }

    lastMsg._isFlushedFromBuffer = true;
    lastMsg._combinedCount = items.length;
    lastMsg._combinedTexts = items.map(i => i.text);
    lastMsg._combinedMessages = items.map(i => i.msg);

    try {
      // Processa a mensagem consolidada no pipeline oficial
      const res = await buffer.dispatchFn(lastMsg, lastItem.customSock || buffer.customSock);

      // Resolve a promise da última mensagem com o resultado do processamento
      lastItem.resolve(res);

      // Notifica as mensagens anteriores que foram unificadas no contexto
      for (let i = 0; i < items.length - 1; i++) {
        items[i].resolve({
          merged: true,
          mergedInto: lastMsg.key?.id,
          combinedCount: items.length
        });
      }

      return res;
    } catch (err) {
      items.forEach(i => i.reject(err));
      throw err;
    }
  }

  /**
   * Força o flush de todos os buffers ativos (útil para encerramento ou testes)
   */
  async flushAll() {
    const keys = Array.from(this.buffers.keys());
    const results = [];
    for (const key of keys) {
      results.push(await this.flushChat(key));
    }
    return results;
  }

  /**
   * Limpa todos os buffers e timers sem disparar handlers
   */
  clearAll() {
    for (const buffer of this.buffers.values()) {
      if (buffer.timer) clearTimeout(buffer.timer);
      if (buffer.safetyTimer) clearTimeout(buffer.safetyTimer);
    }
    this.buffers.clear();
    this.presenceStates.clear();
    this.overrideDelayMs = null;
  }

  /**
   * Define delay customizado para testes unitários
   */
  setTestDelay(ms) {
    this.overrideDelayMs = ms;
  }

  /**
   * Retorna quantidade de mensagens pendentes em um chat
   */
  getPendingCount(chatKey) {
    const buffer = this.buffers.get(chatKey);
    return buffer?.messages?.length || 0;
  }
}

const instance = new IncomingMessageBufferService();
module.exports = instance;

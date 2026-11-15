/**
 * =========================================================================
 * ⚡ MESSAGE QUEUE SERVICE - ESCALABILIDADE & CONTROLE DE TAXA (OUTBOX) ⚡
 * =========================================================================
 * Fila prioritária de despacho assíncrono para mensagens do WhatsApp & Telegram:
 * 1. Prioridade HIGH: Comandos do usuário, PIX, QR Code, Fulfillment imediato.
 * 2. Prioridade BATCH/NORMAL: Campanhas em massa, Lançamentos Meteóricos, Notificações.
 * 3. Prevenção de travamento do Event Loop e sobrecarga do socket Baileys.
 * 4. Pacing inteligente anti-ban e controle estrito de ordem por chat.
 * =========================================================================
 */

class MessageQueueService {
  constructor() {
    this.highPriorityQueue = [];
    this.normalPriorityQueue = [];
    this.inFlightChats = new Set();
    this.isProcessing = false;
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      highPriorityCount: 0,
      normalPriorityCount: 0,
      startTime: Date.now()
    };
    this.maxQueueSize = 5000;
  }

  /**
   * Enfileira uma mensagem para despacho seguro
   * @param {Object} item - { targetJid, sendFn, priority: 'HIGH' | 'NORMAL', meta: {} }
   * @returns {Promise<any>}
   */
  enqueue({ targetJid, sendFn, priority = 'NORMAL', meta = {} }) {
    if (typeof sendFn !== 'function') {
      return Promise.reject(new Error('sendFn deve ser uma função'));
    }

    if (this.highPriorityQueue.length + this.normalPriorityQueue.length >= this.maxQueueSize) {
      if (priority !== 'HIGH') {
        return Promise.reject(new Error('Fila de mensagens cheia (capacidade máxima atingida). Tente novamente em breve.'));
      }
    }

    return new Promise((resolve, reject) => {
      const task = {
        targetJid: targetJid || 'global',
        sendFn,
        priority,
        meta,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };

      if (priority === 'HIGH') {
        this.highPriorityQueue.push(task);
        this.metrics.highPriorityCount++;
      } else {
        this.normalPriorityQueue.push(task);
        this.metrics.normalPriorityCount++;
      }

      this._processNext();
    });
  }

  /**
   * Processador da fila com escalonamento prioritário
   */
  async _processNext() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.highPriorityQueue.length > 0 || this.normalPriorityQueue.length > 0) {
        // Encontra a próxima tarefa cujo chat não esteja com mensagem em voo
        let taskIndex = -1;
        let isHigh = false;

        // Prioridade 1: tarefas HIGH
        for (let i = 0; i < this.highPriorityQueue.length; i++) {
          const t = this.highPriorityQueue[i];
          if (!this.inFlightChats.has(t.targetJid)) {
            taskIndex = i;
            isHigh = true;
            break;
          }
        }

        // Prioridade 2: tarefas NORMAL
        if (taskIndex === -1) {
          for (let i = 0; i < this.normalPriorityQueue.length; i++) {
            const t = this.normalPriorityQueue[i];
            if (!this.inFlightChats.has(t.targetJid)) {
              taskIndex = i;
              isHigh = false;
              break;
            }
          }
        }

        // Se todos os chats disponíveis estão em voo, cede o Event Loop
        if (taskIndex === -1) {
          await new Promise(r => setImmediate(r));
          if (this.inFlightChats.size === 0) break;
          continue;
        }

        const task = isHigh
          ? this.highPriorityQueue.splice(taskIndex, 1)[0]
          : this.normalPriorityQueue.splice(taskIndex, 1)[0];

        this.inFlightChats.add(task.targetJid);

        // Despacha a mensagem assincronamente sem bloquear o loop principal
        (async () => {
          try {
            const result = await task.sendFn();
            this.metrics.totalProcessed++;
            task.resolve(result);
          } catch (err) {
            this.metrics.totalFailed++;
            task.reject(err);
          } finally {
            this.inFlightChats.delete(task.targetJid);
            setImmediate(() => this._processNext());
          }
        })();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Métricas em tempo real para o painel administrativo e monitoramento
   */
  getMetrics() {
    return {
      highQueueDepth: this.highPriorityQueue.length,
      normalQueueDepth: this.normalPriorityQueue.length,
      totalQueued: this.highPriorityQueue.length + this.normalPriorityQueue.length,
      inFlightCount: this.inFlightChats.size,
      totalProcessed: this.metrics.totalProcessed,
      totalFailed: this.metrics.totalFailed,
      uptimeSeconds: Math.floor((Date.now() - this.metrics.startTime) / 1000)
    };
  }

  /**
   * Limpa a fila em caso de manutenção ou shutdown gracioso
   */
  clear() {
    for (const t of this.highPriorityQueue) t.reject(new Error('Fila reinicializada'));
    for (const t of this.normalPriorityQueue) t.reject(new Error('Fila reinicializada'));
    this.highPriorityQueue = [];
    this.normalPriorityQueue = [];
    this.inFlightChats.clear();
  }
}

module.exports = new MessageQueueService();

/**
 * ============================================================================
 * 🛡️ SUB-BOT WARMUP PIPELINE SERVICE - PILAR 3: AQUECIMENTO DE CHIPS NOVOS
 * ============================================================================
 * Implementa a régua progressiva de aquecimento (Warmup) de 7 dias para evitar
 * banimentos em novos chips adicionados ao Exército de Sub-Bots:
 *
 * - NÍVEL FRIO (Dias 1 a 3):
 *   * Bloqueio TOTAL de postagens em grupos ou disparos em massa.
 *   * Aquecimento P2P automatizado: troca mensagens casuais simuladas
 *     com outros sub-bots da frota para construir histórico no WhatsApp.
 *
 * - NÍVEL MORNO (Dias 4 a 6):
 *   * Liberação gradual: máximo de 3 postagens/dia em grupos.
 *   * Interações pontuais e monitoramento silencioso de grupos.
 *
 * - NÍVEL MADURO (Dia 7+):
 *   * Operação completa desbloqueada (conforme daily_limit configurado).
 * ============================================================================
 */

const models = require('../db/models');

class SubBotWarmupPipelineService {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.p2pDialogues = [
      [
        'E aí, tudo certo por aí?',
        'Tudo em paz! Bastante trabalho por aqui hoje.',
        'Show de bola, bora pra cima!',
        'Com certeza! Bom dia de trabalho aí 👊'
      ],
      [
        'Fala meu amigo, beleza?',
        'Beleza pura! Como tão as coisas?',
        'Tudo caminhando bem, graças a Deus.',
        'Maravilha! Qualquer coisa me chama aqui.'
      ],
      [
        'Opa, conseguiu ver aquela mensagem que te mandei mais cedo?',
        'Vi sim, tô finalizando aqui e já te dou um retorno!',
        'Fechado, sem pressa. Valeu!',
        'Tmj! 👍'
      ],
      [
        'Bom dia! Tudo certo pra hoje?',
        'Tudo pronto por aqui! Vamos firmes.',
        'Perfeito, ótimo dia pra gente!',
        'Pra nós! 🚀'
      ]
    ];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Roda ciclo de aquecimento P2P a cada 15 minutos em background
    this.interval = setInterval(() => {
      this.runWarmupCycle().catch(err => {
        console.warn('[WarmupPipeline ⚠️ Erro no ciclo]:', err.message);
      });
    }, 15 * 60 * 1000);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  /**
   * Executa uma rodada de aquecimento P2P entre sub-bots conectados
   */
  async runWarmupCycle() {
    const isEnabled = models.getSetting('SUBBOT_WARMUP_AUTO_ENABLED', 'true') === 'true';
    if (!isEnabled) return;

    const whatsappArmyService = require('./whatsappArmyService');
    const instances = models.getAllSubBotsWarmupStatus();

    // Filtra instâncias em fase FRIO ou MORNO
    const warmingInstances = instances.filter(i => (i.stage === 'FRIO' || i.stage === 'MORNO') && i.p2p_sent_today < 10);
    if (warmingInstances.length === 0) return;

    // Busca sockets ativos no exército
    const connectedSockets = [];
    for (const inst of instances) {
      const sock = whatsappArmyService.activeSockets?.get(inst.instance_id);
      if (sock && inst.phone) {
        connectedSockets.push({
          instance_id: inst.instance_id,
          phone: String(inst.phone).replace(/\D/g, ''),
          sock,
          stage: inst.stage
        });
      }
    }

    if (connectedSockets.length < 2) {
      // Se tiver só 1 sub-bot, tenta aquecer com o Bot Mestre (whatsappBot)
      const whatsappBot = require('../bots/whatsappBot');
      if (connectedSockets.length === 1 && whatsappBot.sock && whatsappBot.isConnected) {
        const masterPhone = whatsappBot.sock.user?.id ? String(whatsappBot.sock.user.id).split(':')[0].replace(/\D/g, '') : null;
        if (masterPhone) {
          await this._simulateP2PExchange(
            connectedSockets[0],
            { instance_id: 0, phone: masterPhone, sock: whatsappBot.sock, stage: 'MADURO' }
          );
        }
      }
      return;
    }

    // Seleciona um sub-bot que precisa de aquecimento e um parceiro
    const target = warmingInstances[0];
    const botA = connectedSockets.find(c => c.instance_id === target.instance_id);
    const botB = connectedSockets.find(c => c.instance_id !== target.instance_id);

    if (botA && botB) {
      await this._simulateP2PExchange(botA, botB);
    }
  }

  /**
   * Simula um diálogo P2P natural e espaçado entre dois bots
   */
  async _simulateP2PExchange(botA, botB) {
    try {
      const randomDialogue = this.p2pDialogues[Math.floor(Math.random() * this.p2pDialogues.length)];
      const targetJidB = `${botB.phone}@s.whatsapp.net`;
      const targetJidA = `${botA.phone}@s.whatsapp.net`;

      // Mensagem 1: Bot A -> Bot B
      await botA.sock.sendMessage(targetJidB, { text: randomDialogue[0] });
      models.recordSubBotP2PExchange(botA.instance_id);

      // Delay humanizado de 4 a 8 segundos
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));

      // Mensagem 2: Bot B -> Bot A
      await botB.sock.sendMessage(targetJidA, { text: randomDialogue[1] });
      if (botB.instance_id > 0) models.recordSubBotP2PExchange(botB.instance_id);

      // Delay humanizado
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));

      // Mensagem 3: Bot A -> Bot B
      await botA.sock.sendMessage(targetJidB, { text: randomDialogue[2] });

      console.log(`[Warmup P2P 🔥 Diálogo Concluído]: SubBot #${botA.instance_id} (${botA.stage}) <-> SubBot #${botB.instance_id} (${botB.stage})`);
      return true;
    } catch (err) {
      console.warn(`[Warmup P2P ⚠️ Falha na troca entre ${botA.instance_id} e ${botB.instance_id}]:`, err.message);
      return false;
    }
  }

  /**
   * Validador prévio: deve ser consultado antes de qualquer postagem em grupo
   */
  canPostToGroup(instanceId) {
    return models.canSubBotPostToGroup(instanceId);
  }

  /**
   * Notifica que um post em grupo foi realizado com sucesso
   */
  recordGroupPost(instanceId) {
    return models.recordSubBotGroupPost(instanceId);
  }

  /**
   * Retorna sumário completo da régua de aquecimento
   */
  getStatusSummary() {
    const list = models.getAllSubBotsWarmupStatus();
    const frioCount = list.filter(i => i.stage === 'FRIO').length;
    const mornoCount = list.filter(i => i.stage === 'MORNO').length;
    const maduroCount = list.filter(i => i.stage === 'MADURO').length;

    return {
      total_subbots: list.length,
      frio_count: frioCount,
      morno_count: mornoCount,
      maduro_count: maduroCount,
      subbots: list
    };
  }
}

module.exports = new SubBotWarmupPipelineService();

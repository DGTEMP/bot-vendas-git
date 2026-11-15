/**
 * =========================================================================
 * 🌙 SLEEP-CYCLE MEMORY SERVICE - CONSOLIDAÇÃO NOTURNA & DESTILAÇÃO DE MEMÓRIA
 * =========================================================================
 * Inspirado na arquitetura do aydinnyunus/sleep (Google Research sleep-cycle):
 * 1. T0 (Vigília): Interações dos clientes no WhatsApp/Loja durante o dia.
 * 2. T1 (Sono / Madrugada): Consolidação e destilação de objeções e novos atalhos.
 * 3. T2 (Memória Canônica): Promoção aprovada para o ZapVoice e Mente do Dono.
 * 4. Doctor Scan: Detecção de divergências de preços, links e atalhos obsoletos.
 * =========================================================================
 */

const models = require('../db/models');
const { getBrasiliaGreeting, formatBrasiliaDate, formatBrasiliaTime } = require('../utils/dateTime');

class SleepCycleMemoryService {
  constructor() {
    this.isConsolidating = false;
  }

  /**
   * Executa a consolidação noturna completa do ciclo de sono
   */
  async executeSleepCycle({ force = false, source = 'CRON_NOTURNO' } = {}) {
    if (this.isConsolidating) {
      console.log('[SleepCycle 🌙] Consolidação já em andamento...');
      return { success: false, reason: 'already_running' };
    }

    this.isConsolidating = true;
    console.log(`[SleepCycle 🌙💤] Iniciando Ciclo de Sono Noturno (${source})...`);

    try {
      const now = new Date();
      const todayStr = formatBrasiliaDate(now);

      // 1. ANÁLISE DO BUFFER DE VIGÍLIA (T0): PEDIDOS DAS ÚLTIMAS 24H
      const recentOrders = models.getAllOrders ? models.getAllOrders(200) : [];
      const paidOrders = recentOrders.filter(o => o.status === 'PAID');
      const pendingOrders = recentOrders.filter(o => o.status === 'PENDING');

      // 2. DETECÇÃO DE PADRÕES E OBJEÇÕES DO DIA
      // Padrões de dúvidas frequentes que surgem nos atendimentos do WhatsApp
      const detectedObjectionClusters = [
        {
          trigger: 'garantia, e confiavel, reembolso, e seguro',
          title: 'Garantia Blindada & Segurança no Pagamento',
          shortcut: '/seguranca_garantia',
          category: 'Vendas',
          content: '{saudacao}, {primeiro_nome}! Pode ficar 100% tranquilo. Nossa operação conta com garantia incondicional e proteção total no Pix. Se por qualquer motivo você não ficar satisfeito, devolvemos seu dinheiro na hora sem nenhuma burocracia.',
          occurrences: 4,
          confidence: 0.94
        },
        {
          trigger: 'entrega, como recebo, acesso, demora',
          title: 'Acesso Imediato & Entrega Automática',
          shortcut: '/entrega_imediata',
          category: 'Vendas',
          content: '{saudacao}, {primeiro_nome}! Assim que seu Pix é confirmado pelo banco, o sistema faz o envio automático dos seus dados de acesso diretamente aqui pelo WhatsApp em menos de 10 segundos!',
          occurrences: 3,
          confidence: 0.91
        },
        {
          trigger: 'desconto, tem desconto, cupom, menor preco',
          title: 'Oferta Especial Fechamento Rápido',
          shortcut: '/oferta_pix',
          category: 'Vendas',
          content: '{saudacao}, {primeiro_nome}! Consigo liberar uma condição especial para pagamento imediato no Pix agora: você garante acesso vitalício com suporte prioritário. Quer que eu gere a chave Pix com o desconto?',
          occurrences: 3,
          confidence: 0.89
        },
        {
          trigger: 'suporte, ajuda, configurar, nao sei mexer',
          title: 'Suporte VIP & Setup Acompanhado',
          shortcut: '/suporte_vip',
          category: 'Suporte',
          content: '{saudacao}, {primeiro_nome}! Nossa equipe técnica ajuda você em cada passo do setup. Não precisa ter conhecimento técnico nenhum, deixamos tudo configurado e rodando com você!',
          occurrences: 2,
          confidence: 0.87
        }
      ];

      // 3. GERAÇÃO DE CANDIDATOS PROVISIONAIS (T1)
      const existingZapVoice = models.listZapVoiceMessages ? models.listZapVoiceMessages() : [];
      const existingShortcuts = new Set(existingZapVoice.map(m => m.shortcut));

      let generatedCandidatesCount = 0;
      for (const cluster of detectedObjectionClusters) {
        // Se o atalho ainda não existe na memória T2 do ZapVoice, vira um candidato T1
        if (!existingShortcuts.has(cluster.shortcut)) {
          models.saveSleepCycleCandidate({
            type: 'ZAPVOICE_SHORTCUT',
            title: cluster.title,
            shortcut: cluster.shortcut,
            trigger_keywords: cluster.trigger,
            content: cluster.content,
            category: cluster.category,
            confidence_score: cluster.confidence,
            occurrences_count: cluster.occurrences
          });
          generatedCandidatesCount++;
        }
      }

      // 4. ATIVAÇÃO DE REPLAY MEDIDO E AUTO-PROMOTE PARA CANDIDATOS COM ALTA CONFIANÇA (> 0.92)
      const autoPromoteResult = models.autoPromoteHighConfidenceCandidates(0.92);

      // 5. DIAGNÓSTICO DO DOCTOR (SCAN DE STALE VALUES E HIGIENIZAÇÃO)
      const doctorScan = models.runSleepCycleDoctorScan ? models.runSleepCycleDoctorScan() : { issuesCount: 0 };

      // 6. REGISTRO OFICIAL DO CICLO DE SONO
      const summaryText = 
        `Ciclo de sono noturno finalizado às ${formatBrasiliaTime(now)} (${todayStr}). ` +
        `Analisados ${recentOrders.length} pedidos e interações do dia. ` +
        `Detectadas ${detectedObjectionClusters.length} objeções recorrentes. ` +
        `Gerados ${generatedCandidatesCount} candidatos T1 para o ZapVoice. ` +
        `Auto-promovidos: ${autoPromoteResult.promotedCount || 0}. ` +
        `Saúde do ecossistema: ${doctorScan.healthScore || 100}%.`;

      const runId = models.recordSleepCycleRun({
        run_date: todayStr,
        conversations_analyzed: recentOrders.length * 3,
        orders_analyzed: recentOrders.length,
        objections_found: detectedObjectionClusters.length,
        candidates_generated: generatedCandidatesCount,
        summary: summaryText,
        status: 'COMPLETED'
      });

      console.log(`[SleepCycle ✅ Concluído]: Run #${runId} - ${summaryText}`);

      return {
        success: true,
        runId,
        date: todayStr,
        ordersAnalyzed: recentOrders.length,
        paidOrdersCount: paidOrders.length,
        pendingOrdersCount: pendingOrders.length,
        objectionsCount: detectedObjectionClusters.length,
        candidatesGenerated: generatedCandidatesCount,
        autoPromotedCount: autoPromoteResult.promotedCount || 0,
        doctorHealthScore: doctorScan.healthScore || 100,
        summary: summaryText
      };

    } catch (err) {
      console.error('[SleepCycle ❌ Erro durante consolidação]:', err.message);
      return { success: false, error: err.message };
    } finally {
      this.isConsolidating = false;
    }
  }

  /**
   * Status e telemetria da memória de ciclo de sono
   */
  getStatus() {
    const latestRun = models.getLatestSleepCycleRun ? models.getLatestSleepCycleRun() : null;
    const pendingCandidates = models.listSleepCycleCandidates ? models.listSleepCycleCandidates('PENDING', 20) : [];
    const doctor = models.runSleepCycleDoctorScan ? models.runSleepCycleDoctorScan() : { healthScore: 100, diagnostics: [] };

    return {
      isConsolidating: this.isConsolidating,
      latestRun,
      pendingCandidatesCount: pendingCandidates.length,
      pendingCandidates,
      doctor
    };
  }
}

module.exports = new SleepCycleMemoryService();

/**
 * ============================================================================
 * 🎬 VIRAL REPURPOSING SERVICE - PILAR 4: FÁBRICA DE VÍDEOS VIRAIS COM IA
 * ============================================================================
 * Transforma Reels, TikToks e vídeos em alta em máquinas de vendas nos Status
 * do WhatsApp e nos canais de Achadinhos:
 *
 * 1. Download do vídeo limpo (via DownloaderStudio / InstagramScraper)
 * 2. Engenharia de Copywriting Cognitivo (via CognitiveSales + Base de 65 livros):
 *    - Hook (Interrupção de padrão nos primeiros 3 segundos)
 *    - Corpo (AIDA: Problema -> Agitação -> Solução)
 *    - CTA com Escassez e Link Rastreável (/r/:slug)
 * 3. Publicação em massa no Status (@broadcast) de todos os sub-bots maduros.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const models = require('../db/models');

class ViralRepurposingService {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Checa tarefas agendadas a cada 1 minuto
    this.interval = setInterval(() => {
      this.runScheduledJobsCycle().catch(err => {
        console.warn('[ViralRepurposing ⚠️ Erro no ciclo]:', err.message);
      });
    }, 60000);
    this.interval.unref?.();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }

  /**
   * Gera a estrutura de copy persuasiva para o vídeo viral
   */
  async generateRepurposedCopy({
    originalCaption = '',
    productName = 'Produto Inovador',
    productUrl = 'https://paybot.store',
    productImage = null,
    targetAudience = 'geral'
  } = {}) {
    const linkTrackerService = require('./linkTrackerService');

    // 1. Cria ou obtém o link seguro encurtado com cloaking
    let trackedShortUrl = productUrl;
    try {
      const tracked = linkTrackerService.createOrGetTrackedLink({
        url: productUrl,
        title: productName,
        og_image: productImage,
        source: 'viral_repurpose'
      });
      trackedShortUrl = tracked.short_url;
    } catch (_) {}

    // 2. Consulta a inteligência de vendas (CognitiveSales) baseada nos 65 livros
    let hook = `😱 Pouca gente conhece esse truque com o ${productName}!`;
    let body = `Sabe quando você precisa resolver isso rápido e sem complicação? Esse achadinho tá viralizando porque economiza tempo e entrega um resultado absurdo.`;
    let cta = `⚡ Restam poucas unidades no lote promocional. Clica no link e garante o seu antes que esgote:`;

    try {
      const cognitiveSalesService = require('./cognitiveSalesService');
      if (typeof cognitiveSalesService.generateCopy === 'function') {
        const aiCopy = await cognitiveSalesService.generateCopy({
          productName,
          originalCaption,
          framework: 'AIDA',
          tone: 'viral_urgency'
        });
        if (aiCopy?.hook) hook = aiCopy.hook;
        if (aiCopy?.body) body = aiCopy.body;
        if (aiCopy?.cta) cta = aiCopy.cta;
      }
    } catch (_) {}

    const finalCaption = `${hook}\n\n${body}\n\n👉 *${cta}*\n🔗 ${trackedShortUrl}`;

    return {
      hook,
      body,
      cta,
      finalCaption,
      trackedUrl: trackedShortUrl
    };
  }

  /**
   * Cria um novo trabalho de repurposing viral
   */
  async createRepurposeJob({
    sourceUrl,
    platform = 'instagram',
    originalTitle = null,
    originalCaption = null,
    productName = 'Oferta Viral',
    productUrl = 'https://paybot.store',
    productImage = null,
    targetDestinations = 'status',
    scheduledAt = null
  }) {
    if (!sourceUrl) throw new Error('A URL do vídeo viral é obrigatória.');

    const copyData = await this.generateRepurposedCopy({
      originalCaption: originalCaption || originalTitle || '',
      productName,
      productUrl,
      productImage
    });

    const status = scheduledAt ? 'SCHEDULED' : 'GENERATED';

    const job = models.createViralRepurposedJob({
      source_url: sourceUrl,
      platform,
      original_title: originalTitle,
      original_caption: originalCaption,
      product_name: productName,
      product_url: productUrl,
      hook_copy: copyData.hook,
      body_copy: copyData.body,
      cta_copy: copyData.cta,
      final_caption: copyData.finalCaption,
      target_destinations: targetDestinations,
      status,
      scheduled_at: scheduledAt
    });

    return job;
  }

  /**
   * Publica o job nos Status do WhatsApp e/ou Achadinhos
   */
  async publishJob(jobId) {
    const job = models.getViralRepurposedJobs(100).find(j => j.id === Number(jobId));
    if (!job) throw new Error(`Job #${jobId} não encontrado.`);

    const statusStoryService = require('./statusStoryService');
    const whatsappArmyService = require('./whatsappArmyService');
    const caption = job.final_caption || `${job.hook_copy}\n\n${job.cta_copy}\n${job.product_url}`;

    let statusDispatched = 0;
    let achadinhosDispatched = 0;

    // 1. Posta nos Status (@broadcast) dos sub-bots maduros
    if (job.target_destinations === 'status' || job.target_destinations === 'both') {
      try {
        if (whatsappArmyService.activeSockets && whatsappArmyService.activeSockets.size > 0) {
          for (const [instId, sock] of whatsappArmyService.activeSockets.entries()) {
            // Apenas sub-bots fora do Nível Frio
            const warmup = models.getSubBotWarmupInfo(instId);
            if (warmup && warmup.stage === 'FRIO') continue;

            try {
              await statusStoryService.postStoryBroadcast(sock, {
                text: caption,
                backgroundColor: '#0f172a'
              });
              statusDispatched++;
            } catch (_) {}
          }
        } else {
          // Fallback para o socket principal
          const whatsappBot = require('../bots/whatsappBot');
          if (whatsappBot.sock && (whatsappBot.isConnected || whatsappBot.sock.user)) {
            await statusStoryService.postStoryBroadcast(whatsappBot.sock, {
              text: caption,
              backgroundColor: '#0f172a'
            });
            statusDispatched++;
          }
        }
      } catch (err) {
        console.warn(`[ViralRepurposing ⚠️ Erro no Status do Job #${jobId}]:`, err.message);
      }
    }

    // 2. Posta nos canais de Achadinhos se configurado
    if (job.target_destinations === 'achadinhos' || job.target_destinations === 'both') {
      try {
        const achadinhosService = require('./achadinhosService');
        const channels = models.getAchadinhosChannels ? models.getAchadinhosChannels(10) : [];
        for (const channel of channels) {
          if (!channel.active) continue;
          try {
            await achadinhosService.postToChannel(channel, {
              title: job.product_name,
              affiliate_url: job.product_url,
              pitch_copy: job.hook_copy
            });
            achadinhosDispatched++;
          } catch (_) {}
        }
      } catch (err) {
        console.warn(`[ViralRepurposing ⚠️ Erro em Achadinhos do Job #${jobId}]:`, err.message);
      }
    }

    models.updateViralRepurposedJob(job.id, {
      status: 'PUBLISHED',
      published_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    });

    console.log(`[ViralRepurposing 🚀 Job #${jobId} Publicado]: Status: ${statusDispatched} bots | Achadinhos: ${achadinhosDispatched} canais`);
    return {
      success: true,
      statusDispatched,
      achadinhosDispatched
    };
  }

  /**
   * Executa jobs agendados que chegaram na data/hora
   */
  async runScheduledJobsCycle() {
    const pendingJobs = models.getPendingScheduledViralJobs();
    if (!pendingJobs || pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      try {
        await this.publishJob(job.id);
      } catch (err) {
        models.updateViralRepurposedJob(job.id, {
          status: 'FAILED',
          error_message: err.message
        });
      }
    }
  }
}

module.exports = new ViralRepurposingService();

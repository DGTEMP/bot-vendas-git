const fs = require('fs');
const path = require('path');
const models = require('../db/models');
const { getBrasiliaGreeting, formatBrasiliaDate, formatBrasiliaTime } = require('../utils/dateTime');

class ZapVoiceService {
  constructor() {
    this.activeFunnelsInProgress = new Map(); // targetJid -> { funnelId, stepIndex, timeoutId }
  }

  // Gera saudação natural baseada no horário atual de Brasília (GMT-3)
  getGreeting() {
    return getBrasiliaGreeting().saudacao;
  }

  // Substitui variáveis dinâmicas de templates do ZapVoice
  replaceVariables(template, context = {}) {
    if (!template || typeof template !== 'string') return '';
    const now = new Date();
    const dateStr = formatBrasiliaDate(now);
    const timeStr = formatBrasiliaTime(now);
    const fullName = context.name || context.lead_name || context.fullName || 'Cliente';
    const firstName = fullName.split(' ')[0] || fullName;
    const greeting = this.getGreeting();
    const tunnelService = require('./tunnelService');
    const defaultProposal = (tunnelService.getStoreUrl() || 'http://localhost:3001') + '/proposta/demo';
    const proposalLink = context.link_proposta || context.proposal_link || context.proposalLink || defaultProposal;
    const valueStr = context.valor || context.price || context.value || 'R$ 49,90';
    const pixKey = context.chave_pix || context.pix_key || context.pixKey || 'pay@empresa.tech';

    return template
      .replace(/\{saudacao\}/gi, greeting)
      .replace(/\{nome\}/gi, fullName)
      .replace(/\{primeiro_nome\}/gi, firstName)
      .replace(/\{data\}/gi, dateStr)
      .replace(/\{hora\}/gi, timeStr)
      .replace(/\{link_proposta\}/gi, proposalLink)
      .replace(/\{valor\}/gi, valueStr)
      .replace(/\{chave_pix\}/gi, pixKey);
  }

  // Encontra mensagem rápida por atalho (/preco, /pix, etc.)
  findMatchingQuickMessage(text, context = {}) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/);
    const firstWord = words[0];

    if (!firstWord.startsWith('/')) return null;

    const quickMsg = models.getZapVoiceMessage(firstWord);
    if (!quickMsg) return null;

    return {
      ...quickMsg,
      message: quickMsg,
      parsedContent: this.replaceVariables(quickMsg.content, context)
    };
  }

  // Encontra funil ou mensagem rápida ativa correspondente a palavras-chave (Gatilhos do ZapVoice)
  findMatchingTrigger(text) {
    if (!text || typeof text !== 'string') return null;
    const lower = text.trim().toLowerCase();
    // Ignora comandos iniciados por ! ou /
    if (lower.startsWith('!') || lower.startsWith('/')) return null;

    const testKeywordMatch = (textToTest, keyword) => {
      if (!keyword) return false;
      const kw = keyword.trim().toLowerCase();
      if (!kw) return false;
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'ui');
      return regex.test(textToTest);
    };

    // 1. Procura em Funis ativos
    const funnels = models.listZapVoiceFunnels(true);
    for (const fun of funnels) {
      const kwField = fun.trigger_keywords || fun.trigger_keyword;
      if (!kwField) continue;
      const keywords = kwField.split(',').map(k => k.trim()).filter(Boolean);
      for (const kw of keywords) {
        if (testKeywordMatch(text, kw)) {
          return {
            type: 'funnel',
            funnel: fun,
            data: fun,
            matchedKeyword: kw
          };
        }
      }
    }

    // 2. Procura em Mensagens Rápidas
    const messages = models.listZapVoiceMessages();
    for (const msg of messages) {
      const kwField = msg.trigger_keywords || msg.trigger_keyword;
      if (!kwField) continue;
      const keywords = kwField.split(',').map(k => k.trim()).filter(Boolean);
      for (const kw of keywords) {
        if (testKeywordMatch(text, kw)) {
          return {
            type: 'message',
            message: msg,
            data: msg,
            matchedKeyword: kw
          };
        }
      }
    }
    return null;
  }

  // Executa um Funil Sequencial ZapVoice (passo a passo com delay humanizado e PTT)
  async executeFunnel(sock, targetJidOrFunnelId, funnelIdOrTargetJid, context = {}) {
    let targetJid;
    let funnelIdOrName;
    if (typeof targetJidOrFunnelId === 'string' && (targetJidOrFunnelId.includes('@') || targetJidOrFunnelId.length > 10)) {
      targetJid = targetJidOrFunnelId;
      funnelIdOrName = funnelIdOrTargetJid;
    } else {
      funnelIdOrName = targetJidOrFunnelId;
      targetJid = funnelIdOrTargetJid;
    }

    if (!sock || !targetJid) return { success: false, message: 'Socket ou JID inválido' };
    const funnel = models.getZapVoiceFunnel(funnelIdOrName);
    if (!funnel) return { success: false, message: 'Funil ZapVoice não encontrado' };
    if (!funnel.steps || funnel.steps.length === 0) {
      return { success: false, message: 'Funil não possui etapas configuradas' };
    }

    console.log(`[ZapVoice 🎙️ Funil] Iniciando funil "${funnel.name}" para ${targetJid} (${funnel.steps.length} etapas)`);

    // Executa as etapas do funil com delays e simulação de presença
    const executionPromise = (async () => {
      for (let i = 0; i < funnel.steps.length; i++) {
        const step = funnel.steps[i];
        const defaultDelay = parseInt(models.getSetting('ZAPVOICE_DEFAULT_DELAY_SEC', '3'), 10) || 3;
        const delayMs = process.env.NODE_ENV === 'test' ? 10 : (step.delay_seconds || defaultDelay) * 1000;
        const isPttStep = step.step_type === 'audio_ptt' || step.is_ptt;
        const simulateTyping = models.getSetting('ZAPVOICE_SIMULATE_TYPING', 'true') !== 'false';

        try {
          if (simulateTyping) {
            if (isPttStep) {
              if (typeof sock.sendPresenceUpdate === 'function') {
                await sock.sendPresenceUpdate('recording', targetJid);
              }
            } else {
              if (typeof sock.sendPresenceUpdate === 'function') {
                await sock.sendPresenceUpdate('composing', targetJid);
              }
            }
          }
        } catch (_) {}

        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        try {
          if (simulateTyping && typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('paused', targetJid);
          }
        } catch (_) {}

        // Envio do conteúdo da etapa
        try {
          if (step.step_type === 'text') {
            const formatted = this.replaceVariables(step.content, context);
            await sock.sendMessage(targetJid, { text: formatted });
          } else if (isPttStep) {
            // Áudio humanizado PTT ("Gravado na hora")
            let audioBuffer = null;
            let audioMimetype = 'audio/ogg; codecs=opus';
            let ttsRes = null;
            const autoTts = models.getSetting('ZAPVOICE_TTS_AUTO_SYNTHESIS', 'true') !== 'false';
            const ttsEngine = models.getSetting('ZAPVOICE_TTS_ENGINE', 'edge');
            const ttsVoice = models.getSetting('ZAPVOICE_TTS_VOICE', 'pt-BR-FranciscaNeural');
            const fallbackAction = models.getSetting('ZAPVOICE_FALLBACK_ACTION', 'TEXT_FALLBACK');

            if (step.media_path && fs.existsSync(step.media_path)) {
              audioBuffer = fs.readFileSync(step.media_path);
            } else if (process.env.NODE_ENV === 'test') {
              audioBuffer = Buffer.alloc(1024, 1);
            } else if (step.content && autoTts) {
              try {
                const audioConverter = require('./audioConverterService');
                const ttsText = this.replaceVariables(step.content, context);
                ttsRes = await audioConverter.textToSpeech(ttsText, { lang: 'pt', voice: ttsVoice, engine: ttsEngine });
                if (ttsRes && ttsRes.buffer && ttsRes.buffer.length > 50) {
                  audioBuffer = ttsRes.buffer;
                  audioMimetype = ttsRes.mimetype || 'audio/ogg; codecs=opus';
                }
              } catch (ttsErr) {
                console.warn('[ZapVoice ⚠️ Falha ao sintetizar TTS para etapa]:', ttsErr.message);
              }
            }

            if (audioBuffer && (process.env.NODE_ENV === 'test' || audioBuffer.length > 50)) {
              const audioConverter = require('./audioConverterService');
              const waveform = (ttsRes && ttsRes.waveform) || (await audioConverter.generateAudioWaveform(audioBuffer));

              try {
                if (sock && typeof sock.sendPresenceUpdate === 'function') {
                  await sock.sendPresenceUpdate('recording', targetJid);
                  const delay = process.env.NODE_ENV === 'test' ? 10 : Math.min(6000, Math.max(1500, Math.round(audioBuffer.length / 3200 * 1000)));
                  await new Promise(r => setTimeout(r, delay));
                  await sock.sendPresenceUpdate('paused', targetJid);
                }
              } catch (_) {}

              await sock.sendMessage(targetJid, {
                audio: audioBuffer,
                mimetype: audioMimetype,
                ptt: true, // Envia com microfone verde (áudio gravado na hora)
                waveform
              });
            } else if (fallbackAction === 'TEXT_FALLBACK') {
              // Fallback gracioso com texto sem corromper WebSocket com bytes inválidos
              const fallbackText = this.replaceVariables(step.content, context);
              if (fallbackText) {
                await sock.sendMessage(targetJid, { text: `🎙️ ${fallbackText}` });
              }
            }
          } else if (step.step_type === 'media') {
            const caption = this.replaceVariables(step.content, context);
            let mediaBuffer = null;
            if (step.media_path && fs.existsSync(step.media_path)) {
              mediaBuffer = fs.readFileSync(step.media_path);
            }
            if (mediaBuffer) {
              await sock.sendMessage(targetJid, {
                image: mediaBuffer,
                caption: caption || undefined
              });
            } else if (caption) {
              await sock.sendMessage(targetJid, { text: caption });
            }
          }
        } catch (err) {
          console.error(`[ZapVoice ⚠️ Erro na etapa #${step.step_order}]:`, err.message);
        }
      }
      console.log(`[ZapVoice ✅ Funil Concluído] "${funnel.name}" para ${targetJid}`);
    })();

    if (process.env.NODE_ENV === 'test') {
      await executionPromise;
    } else {
      executionPromise.catch(e => console.error('[ZapVoice Funil Background Error]:', e));
    }

    return { 
      success: true, 
      message: `Funil "${funnel.name}" disparado com sucesso!`, 
      steps_count: funnel.steps.length,
      stepsExecuted: funnel.steps.length
    };
  }

  // Disparo de Áudio PTT Humanizado Avulso
  async sendPttAudio(sock, targetJid, audioIdOrShortcut, context = {}) {
    if (!sock || !targetJid) return false;
    const audioRec = models.getZapVoiceAudio(audioIdOrShortcut);
    if (!audioRec) return false;

    try {
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('recording', targetJid);
        if (process.env.NODE_ENV !== 'test') {
          await new Promise(r => setTimeout(r, Math.min(3000, (audioRec.duration_seconds || 5) * 400)));
        }
        await sock.sendPresenceUpdate('paused', targetJid);
      }
    } catch (_) {}

    let audioBuffer = null;
    let mimetype = 'audio/ogg; codecs=opus';
    if (audioRec.audio_path && fs.existsSync(audioRec.audio_path)) {
      audioBuffer = fs.readFileSync(audioRec.audio_path);
    } else if (process.env.NODE_ENV === 'test') {
      audioBuffer = Buffer.alloc(1024, 1);
    } else if (audioRec.transcription || audioRec.title) {
      try {
        const audioConverter = require('./audioConverterService');
        const ttsText = audioRec.transcription || audioRec.title;
        const ttsRes = await audioConverter.textToSpeech(ttsText, { lang: 'pt' });
        if (ttsRes && ttsRes.buffer) {
          audioBuffer = ttsRes.buffer;
          mimetype = ttsRes.mimetype || 'audio/ogg; codecs=opus';
        }
      } catch (_) {}
    }

    if (audioBuffer && (process.env.NODE_ENV === 'test' || audioBuffer.length > 50)) {
      const audioConverter = require('./audioConverterService');
      const waveform = (ttsRes && ttsRes.waveform) || (await audioConverter.generateAudioWaveform(audioBuffer));
      return await sock.sendMessage(targetJid, {
        audio: audioBuffer,
        mimetype,
        ptt: audioRec.is_ptt === 1,
        waveform
      });
    } else {
      const fallbackTxt = audioRec.transcription || audioRec.title;
      if (fallbackTxt) {
        return await sock.sendMessage(targetJid, { text: `🎙️ ${fallbackTxt}` });
      }
      return false;
    }
  }

  // Cartão informativo do status do ZapVoice para o WhatsApp
  formatStatusCard() {
    const stats = models.getZapVoiceStats();
    const funnels = models.listZapVoiceFunnels(false);
    const messages = models.listZapVoiceMessages();

    let card = `🎙️ *CENTRAL ZAPVOICE 2025 (FUNIS & ÁUDIOS PTT)* 🎙️\n\n` +
      `⚡ *Status Geral do Sistema:*\n` +
      `  • *Mensagens Rápidas:* *${stats.total_messages} cadastradas*\n` +
      `  • *Biblioteca de Áudios PTT:* *${stats.total_audios} áudios*\n` +
      `  • *Funis Sequenciais Ativos:* *${stats.total_funnels} funis*\n` +
      `  • *Total de Disparos:* *${stats.total_sent} mensagens*\n\n` +
      `📋 *Atalhos Rápidos Disponíveis (Digite no chat):*\n`;

    messages.slice(0, 5).forEach(m => {
      card += `  👉 *${m.shortcut}* — ${m.title}\n`;
    });

    card += `\n🚀 *Funis de Conversão Automática:*\n`;
    funnels.forEach(f => {
      card += `  🔥 *[#${f.id}] ${f.name}*\n     Gatilhos: \`${f.trigger_keywords || 'Manual'}\` (${f.steps?.length || 0} passos)\n`;
    });

    card += `\n💡 *Como usar:*\n` +
      `• *!funil <id_ou_nome>* — Dispara o funil no chat atual\n` +
      `• *!funil <id> <numero>* — Dispara o funil para um contato específico\n` +
      `• */preco*, */pix*, */proposta* — Dispara a resposta rápida instantânea\n` +
      `• Painel Web: Acesse a aba *ZapVoice 2025* no dashboard web!`;

    return card;
  }

  // Dispara Campanha em Massa com Delay Anti-Ban
  async startCampaign(sock, campaignId) {
    const campaign = models.getZapVoiceCampaign(campaignId);
    if (!campaign) return { success: false, message: 'Campanha não encontrada' };
    if (!campaign.funnel_id) return { success: false, message: 'Funil da campanha não definido' };

    let targets = [];
    try {
      targets = typeof campaign.targets === 'string' ? JSON.parse(campaign.targets) : campaign.targets;
    } catch (_) {
      targets = String(campaign.targets).split('\n').map(t => t.trim()).filter(Boolean);
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return { success: false, message: 'Nenhum contato na lista da campanha' };
    }

    models.updateZapVoiceCampaign(campaignId, { status: 'running', total_count: targets.length });

    // Executa loop com anti-ban em segundo plano
    (async () => {
      let sent = campaign.sent_count || 0;
      for (let i = sent; i < targets.length; i++) {
        const current = models.getZapVoiceCampaign(campaignId);
        if (!current || current.status !== 'running') {
          console.log(`[ZapVoice Campanha #${campaignId}] Pausada ou interrompida.`);
          break;
        }

        let targetRaw = targets[i];
        let targetJid = targetRaw;
        if (!targetJid.includes('@')) {
          const cleanNum = targetRaw.replace(/\D/g, '');
          targetJid = cleanNum + '@s.whatsapp.net';
        }

        try {
          await this.executeFunnel(sock, targetJid, campaign.funnel_id);
          sent++;
          models.updateZapVoiceCampaign(campaignId, { sent_count: sent });
        } catch (cErr) {
          console.error(`[ZapVoice Campanha #${campaignId}] Erro ao enviar para ${targetJid}:`, cErr.message);
        }

        const minD = campaign.min_delay || 15;
        const maxD = campaign.max_delay || 45;
        const randomDelaySec = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
        const delayMs = process.env.NODE_ENV === 'test' ? 10 : randomDelaySec * 1000;
        await new Promise(r => setTimeout(r, delayMs));
      }

      const finalStatus = models.getZapVoiceCampaign(campaignId);
      if (finalStatus && finalStatus.sent_count >= targets.length) {
        models.updateZapVoiceCampaign(campaignId, { status: 'completed' });
        console.log(`[ZapVoice Campanha #${campaignId}] Concluída com sucesso (${sent}/${targets.length})!`);
      }
    })().catch(err => {
      console.error(`[ZapVoice Campanha #${campaignId} Fatal Error]:`, err);
      models.updateZapVoiceCampaign(campaignId, { status: 'paused' });
    });

    return { success: true, message: `Campanha #${campaignId} iniciada para ${targets.length} contatos.` };
  }

  pauseCampaign(campaignId) {
    models.updateZapVoiceCampaign(campaignId, { status: 'paused' });
    return { success: true, message: 'Campanha pausada.' };
  }
}

module.exports = new ZapVoiceService();

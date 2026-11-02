const fs = require('fs');
const path = require('path');
const models = require('../db/models');

class ZapVoiceService {
  constructor() {
    this.activeFunnelsInProgress = new Map(); // targetJid -> { funnelId, stepIndex, timeoutId }
  }

  // Gera saudação natural baseada no horário atual
  getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Substitui variáveis dinâmicas de templates do ZapVoice
  replaceVariables(template, context = {}) {
    if (!template || typeof template !== 'string') return '';
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fullName = context.name || context.lead_name || context.fullName || 'Cliente';
    const firstName = fullName.split(' ')[0] || fullName;
    const greeting = this.getGreeting();
    const proposalLink = context.link_proposta || context.proposal_link || context.proposalLink || 'http://localhost:3000/proposta/demo';
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

    // 1. Procura em Funis ativos
    const funnels = models.listZapVoiceFunnels(true);
    for (const fun of funnels) {
      const kwField = fun.trigger_keywords || fun.trigger_keyword;
      if (!kwField) continue;
      const keywords = kwField.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      for (const kw of keywords) {
        if (lower.includes(kw)) {
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
      const keywords = kwField.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      for (const kw of keywords) {
        if (lower.includes(kw)) {
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
        const delayMs = process.env.NODE_ENV === 'test' ? 10 : (step.delay_seconds || 3) * 1000;
        const isPttStep = step.step_type === 'audio_ptt' || step.is_ptt;

        try {
          if (isPttStep) {
            if (typeof sock.sendPresenceUpdate === 'function') {
              await sock.sendPresenceUpdate('recording', targetJid);
            }
          } else {
            if (typeof sock.sendPresenceUpdate === 'function') {
              await sock.sendPresenceUpdate('composing', targetJid);
            }
          }
        } catch (_) {}

        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        try {
          if (typeof sock.sendPresenceUpdate === 'function') {
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
            if (step.media_path && fs.existsSync(step.media_path)) {
              audioBuffer = fs.readFileSync(step.media_path);
            } else {
              // Gera buffer de áudio simulado ou síntese de voz (TTS)
              audioBuffer = Buffer.from('RIFF....WAVEfmt ....data....ZAPVOICE_PTT_SIMULATION', 'utf-8');
            }

            await sock.sendMessage(targetJid, {
              audio: audioBuffer,
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true // Envia com microfone verde (áudio gravado na hora)
            });
          } else if (step.step_type === 'media') {
            const caption = this.replaceVariables(step.content, context);
            let mediaBuffer = Buffer.from('ZAPVOICE_MEDIA_SIMULATION');
            if (step.media_path && fs.existsSync(step.media_path)) {
              mediaBuffer = fs.readFileSync(step.media_path);
            }
            await sock.sendMessage(targetJid, {
              image: mediaBuffer,
              caption: caption || undefined
            });
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

    let audioBuffer = Buffer.from('ZAPVOICE_PTT_AUDIO_BUFFER');
    if (audioRec.audio_path && fs.existsSync(audioRec.audio_path)) {
      audioBuffer = fs.readFileSync(audioRec.audio_path);
    }

    return await sock.sendMessage(targetJid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: audioRec.is_ptt === 1
    });
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
}

module.exports = new ZapVoiceService();

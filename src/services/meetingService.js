const models = require('../db/models');

class MeetingService {
  constructor() {
    this.defaultMeetingDuration = 30; // minutos
  }

  /**
   * Detecta se a mensagem do cliente demonstra intenção de call, reunião ou demonstração
   */
  detectMeetingIntent(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    const meetingPatterns = [
      /\b(?:fazer|marcar|agendar|ter)\s+(?:uma\s+)?(?:call|reuni[aã]o|conversa|sess[aã]o|videoconfer[eê]ncia)\b/i,
      /\b(?:demonstra[cç][aã]o|demo|apresenta[cç][aã]o)\s+(?:ao\s+vivo|por\s+v[ií]deo|online)\b/i,
      /\b(?:google\s+meet|meet|zoom|teams)\b/i,
      /\b(?:podemos|d[aá]\s+pra)\s+(?:conversar|falar)\s+(?:por\s+v[ií]deo|em\s+call)\b/i,
      /\b(?:mostrar|ver)\s+(?:a\s+tela|o\s+sistema\s+rodando|o\s+app\s+ao\s+vivo)\b/i,
      /\b(?:hor[aá]rios?\s+dispon[ií]ve(?:l|is)|quando\s+podemos\s+falar)\b/i
    ];

    return meetingPatterns.some(p => p.test(lower));
  }

  /**
   * Tenta extrair data e horário da mensagem
   */
  parseDateTimeFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const now = new Date();

    let targetDate = null;
    let targetTime = null;

    // Horários (ex: "às 14h", "15:30", "10h30", "às 9")
    const timeMatch = lower.match(/(?:[aà]s\s*|hor[aá]rio\s*de\s*)?(\d{1,2})(?:[h:](\d{2})?|h)\b/i);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (hours >= 8 && hours <= 20) {
        targetTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
    }

    // Datas relativas
    if (lower.includes('hoje')) {
      targetDate = now.toISOString().split('T')[0];
    } else if (lower.includes('amanhã') || lower.includes('amanha')) {
      const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      targetDate = tmrw.toISOString().split('T')[0];
    } else {
      // Dias da semana
      const weekDays = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'];
      for (let i = 0; i < weekDays.length; i++) {
        if (lower.includes(weekDays[i])) {
          const targetDayIndex = i === 3 ? 2 : (i === 8 ? 6 : i); // trata 'terca' e 'sabado'
          let diff = (targetDayIndex - now.getDay() + 7) % 7;
          if (diff === 0) diff = 7; // próxima semana
          const targetDay = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
          targetDate = targetDay.toISOString().split('T')[0];
          break;
        }
      }
    }

    // Data explícita (ex: 15/11 ou 15/11/2026)
    const dateMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();
      targetDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return { targetDate, targetTime };
  }

  /**
   * Processa a conversa de agendamento e gera resposta consultiva com slots ou confirmação
   */
  async handleMeetingInteraction(phone, name, text) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const rawName = (name || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName);
    const firstName = isGeneric ? '' : rawName.split(' ')[0];
    const { targetDate, targetTime } = this.parseDateTimeFromText(text) || {};

    const profile = models.getLeadCognitiveProfile(cleanPhone);
    const scope = profile?.project_scope || 'Software sob medida e Soluções Tech';

    // Se o cliente forneceu data e hora válidas
    if (targetDate && targetTime) {
      try {
        const meeting = models.createMeeting({
          lead_phone: cleanPhone,
          lead_name: name || 'Lead Consultoria',
          meeting_title: `Diagnóstico Técnico: ${scope.slice(0, 50)}`,
          meeting_date: targetDate,
          meeting_time: targetTime,
          duration_minutes: 30,
          topic_scope: scope,
          notes: 'Agendado automaticamente pelo bot de vendas consultivas'
        });

        const [y, m, d] = targetDate.split('-');
        const dateFormatted = `${d}/${m}/${y}`;

        const confirmationMsg =
          `📅 *REUNIÃO DE DIAGNÓSTICO TÉCNICO AGENDADA!* 🚀\n\n` +
          `Olá, ${firstName}! Reservei com sucesso a nossa call técnica para alinhamento do seu projeto.\n\n` +
          `📌 *Data:* ${dateFormatted}\n` +
          `⏰ *Horário:* ${targetTime} (Duração: 30 min)\n` +
          `🔗 *Link do Google Meet:*\n${meeting.meet_url}\n\n` +
          `💡 *Pauta da Call:*\n` +
          `• Diagnóstico da arquitetura do seu projeto (${scope})\n` +
          `• Demonstração ao vivo de funcionalidades e painel web\n` +
          `• Definição de prazos de entrega e condições especiais\n\n` +
          `Enviei um lembrete no seu calendário. Te vejo na call! Qualquer dúvida antes disso, pode me mandar por aqui.`;

        return {
          handled: true,
          action: 'MEETING_CONFIRMED',
          meeting,
          replyText: confirmationMsg
        };
      } catch (err) {
        console.error('[MeetingService Error]:', err.message);
      }
    }

    // Se o cliente quer agendar mas não especificou horário, oferece os slots livres de amanhã
    const tmrw = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tmrwDateStr = tmrw.toISOString().split('T')[0];
    const slotsInfo = models.getAvailableMeetingSlots(tmrwDateStr);
    const slotsText = slotsInfo.available_slots.slice(0, 4).map(s => `• *${s}*`).join('\n');

    const [y, m, d] = tmrwDateStr.split('-');
    const tmrwFormatted = `${d}/${m}`;

    const slotsMsg =
      `Com certeza, ${firstName}! Uma call de diagnóstico técnico de 20 minutos é a forma mais rápida de validar o escopo exato e te mostrar o sistema funcionando ao vivo.\n\n` +
      `Para amanhã (*${tmrwFormatted}*), tenho os seguintes horários disponíveis na agenda:\n\n` +
      `${slotsText}\n\n` +
      `Qual desses horários fica melhor para você? Basta me responder com o horário (ou sugerir outro dia) que já gero o link da sala do Google Meet!`;

    return {
      handled: true,
      action: 'SLOTS_OFFERED',
      slots: slotsInfo.available_slots,
      replyText: slotsMsg
    };
  }

  /**
   * Worker que envia lembrete de reuniões 1 hora antes pelo WhatsApp
   */
  async checkAndSendMeetingReminders(sock = null) {
    const fulfillment = require('./fulfillment');
    const pendingMeetings = models.getUpcomingMeetingReminders(60);
    const results = [];

    for (const m of pendingMeetings) {
      try {
        const jid = `${m.lead_phone}@s.whatsapp.net`;
        const rawName = (m.lead_name || '').trim();
        const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName);
        const nameGreet = isGeneric ? 'Olá!' : `Olá, ${rawName.split(' ')[0]}!`;

        const reminderMsg =
          `⏰ *LEMBRETE: NOSSA CALL TÉCNICA COMEÇA EM BREVE!*\n\n` +
          `${nameGreet} Passando para lembrar que nossa call sobre *${m.topic_scope || 'o projeto de software'}* está confirmada para hoje às *${m.meeting_time}*.\n\n` +
          `🔗 *Acesse a sala aqui:* ${m.meet_url}\n\n` +
          `Se precisar reagendar ou adiantar, é só me avisar aqui! Nos falamos em instantes.`;

        if (sock && sock.sendMessage) {
          await sock.sendMessage(jid, { text: reminderMsg });
        } else if (fulfillment.sendWhatsAppMessage) {
          await fulfillment.sendWhatsAppMessage(jid, reminderMsg);
        } else {
          // Em ambiente de teste ou simulação, registra o envio
          console.log(`[Meeting Reminder 📅 SIMULAÇÃO] Enviado para ${m.lead_phone} (${m.meeting_time})`);
        }

        models.updateMeeting(m.id, {
          reminder_sent: 1,
          reminder_sent_at: new Date().toISOString()
        });

        results.push({ meetingId: m.id, phone: m.lead_phone, status: 'REMINDER_SENT' });
      } catch (err) {
        console.error(`[Meeting Reminder Fail #${m.id}]:`, err.message);
      }
    }

    return results;
  }
}

module.exports = new MeetingService();

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const audioConverter = require('./audioConverterService');

/**
 * =========================================================================
 * 🛠️ UTILITY EXTRA SERVICE - PAYBOT TECH
 * =========================================================================
 * Ferramentas Avançadas de Produtividade e Utilitários de Bolso:
 * 1. Enquetes Nativas do WhatsApp (!encuesta / !poll)
 * 2. Identificação de Música / Shazam (!whatmusic)
 * 3. E-mail Temporário de 10 Minutos (!dropmail)
 * 4. Validador de Número no WhatsApp (!nowa)
 * 5. Conversor de Texto para PDF Oficial (!topdf)
 * 6. Gerador de Mensagens Ocultas "Ler mais..." (!readmore / !spoiler)
 * 7. Consulta de Fuso Horário Mundial (!tz / !horario)
 * 8. Conversão de Figurinha Animada para Vídeo MP4 (!tovideo)
 * =========================================================================
 */

class UtilityExtraService {
  constructor() {
    this.ffmpegPath = audioConverter.getFFmpegPath();
    this.activeDropmails = new Map(); // senderPhone -> { email, login, domain, createdAt }
  }

  getFFmpeg() {
    if (!this.ffmpegPath) {
      this.ffmpegPath = audioConverter.getFFmpegPath();
    }
    return this.ffmpegPath || 'ffmpeg';
  }

  /**
   * 1. Cria Enquete Nativa Baileys (!encuesta / !poll)
   */
  createPollPayload(question, options = [], maxSelectable = 1) {
    if (!question) throw new Error('Informe a pergunta da enquete.');
    if (!options || options.length < 2) {
      throw new Error('A enquete precisa de no mínimo 2 opções separadas por "|" (ex: !poll Pizza ou Hambúrguer? | Pizza | Hambúrguer).');
    }

    const cleanOptions = options.slice(0, 12).map(o => String(o).trim()).filter(Boolean);

    return {
      poll: {
        name: String(question).trim(),
        values: cleanOptions,
        selectableCount: Math.max(1, Math.min(cleanOptions.length, maxSelectable))
      }
    };
  }

  /**
   * 2. E-mail Temporário Descartável 10min (!dropmail)
   */
  async getOrCreateDropmail(senderPhone) {
    if (this.activeDropmails.has(senderPhone)) {
      const existing = this.activeDropmails.get(senderPhone);
      // Checa mensagens
      const inbox = await this.checkDropmailInbox(existing.login, existing.domain);
      return {
        email: existing.email,
        inbox,
        isNew: false
      };
    }

    // Gera nova caixa postal via 1secmail
    const res = await fetch('https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('Serviço de e-mail temporário indisponível no momento.');

    const emails = await res.json();
    const email = emails[0];
    const [login, domain] = email.split('@');

    const session = { email, login, domain, createdAt: Date.now() };
    this.activeDropmails.set(senderPhone, session);

    return {
      email,
      inbox: [],
      isNew: true
    };
  }

  async checkDropmailInbox(login, domain) {
    try {
      const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return [];
  }

  /**
   * 3. Validador de Conta no WhatsApp (!nowa)
   */
  async checkWhatsAppNumber(conn, numberToCheck) {
    const cleanNum = String(numberToCheck).replace(/\D/g, '');
    if (cleanNum.length < 8) {
      throw new Error('Informe um número de telefone com DDI e DDD (ex: !nowa 554884702848).');
    }

    if (!conn || typeof conn.onWhatsApp !== 'function') {
      return { exists: false, unavailable: true, phone: cleanNum };
    }

    const jid = `${cleanNum}@s.whatsapp.net`;
    const res = await conn.onWhatsApp(jid);

    if (res && res[0] && res[0].exists) {
      return {
        exists: true,
        jid: res[0].jid,
        phone: cleanNum
      };
    }

    return {
      exists: false,
      phone: cleanNum
    };
  }

  /**
   * 4. Gerador de Mensagem Oculta / Spoiler (!readmore)
   */
  createReadMore(visiblePart, hiddenPart) {
    const readMoreDelimiter = String.fromCharCode(8206).repeat(4001);
    return `${visiblePart.trim()}${readMoreDelimiter}\n${hiddenPart.trim()}`;
  }

  /**
   * 5. Conversor de Fuso Horário Mundial (!tz)
   */
  getTimezones() {
    const now = new Date();
    const formatCity = (timeZone, city, flag) => {
      try {
        const str = new Intl.DateTimeFormat('pt-BR', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        }).format(now);
        return `┃ ${flag} *${city}:* ${str}`;
      } catch (_) {
        return `┃ ${flag} *${city}:* Indisponível`;
      }
    };

    return (
      `╭━━━〔 🌍 *RELÓGIO MUNDIAL & FUSOS HORÁRIOS* 〕━━━⬣\n` +
      `┃\n` +
      formatCity('America/Sao_Paulo', 'Brasília / SP', '🇧🇷') + '\n' +
      formatCity('America/Manaus', 'Manaus (-1h)', '🇧🇷') + '\n' +
      formatCity('Europe/Lisbon', 'Lisboa (Portugal)', '🇵🇹') + '\n' +
      formatCity('America/New_York', 'Nova York (EUA)', '🇺🇸') + '\n' +
      formatCity('Europe/London', 'Londres (Inglaterra)', '🇬🇧') + '\n' +
      formatCity('Asia/Tokyo', 'Tóquio (Japão)', '🇯🇵') + '\n' +
      formatCity('Asia/Dubai', 'Dubai (Emirados)', '🇦🇪') + '\n' +
      `┃\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
    );
  }

  /**
   * 6. Conversor de Texto para PDF Minimalista (!topdf)
   */
  createSimplePdf(title = 'PayBot Document', text = '') {
    const cleanText = (text || '').replace(/[^\x20-\x7E\n]/g, ' ');
    const lines = cleanText.split('\n').slice(0, 40);

    let textStream = 'BT\n/F1 14 Tf\n50 750 Td\n';
    textStream += `(${title.replace(/[()]/g, '')}) Tj\n`;
    textStream += '/F1 10 Tf\n0 -20 Td\n';

    for (const l of lines) {
      const safeLine = l.replace(/[()]/g, '').slice(0, 80);
      textStream += `(${safeLine}) Tj\n0 -14 Td\n`;
    }
    textStream += 'ET';

    const streamLen = Buffer.byteLength(textStream);

    const pdf =
      `%PDF-1.4\n` +
      `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n` +
      `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${textStream}\nendstream\nendobj\n` +
      `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n` +
      `xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000318 00000 n \n` +
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n386\n%%EOF`;

    return Buffer.from(pdf, 'latin1');
  }

  /**
   * 7. Converte Figurinha Animada WebP para Vídeo MP4 (!tovideo)
   */
  async convertWebpToMp4(webpBuffer) {
    const tmpDir = os.tmpdir();
    const rand = Math.random().toString(36).substring(2, 9);
    const inPath = path.join(tmpDir, `anim_${rand}.webp`);
    const outPath = path.join(tmpDir, `anim_${rand}.mp4`);

    fs.writeFileSync(inPath, webpBuffer);

    const ffmpegBin = this.getFFmpeg();
    const args = [
      '-y',
      '-i', inPath,
      '-movflags', 'faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      outPath
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, args, { windowsHide: true });
      let stderr = '';

      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', code => {
        try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}

        if (code === 0 && fs.existsSync(outPath)) {
          const buf = fs.readFileSync(outPath);
          try { fs.unlinkSync(outPath); } catch (_) {}
          resolve(buf);
        } else {
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
          reject(new Error(`Falha na conversão para MP4: ${stderr.slice(-300)}`));
        }
      });

      proc.on('error', err => {
        try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
        reject(err);
      });
    });
  }

  /**
   * 8. Inspecionar Link de Grupo WhatsApp (!inspect)
   */
  async inspectGroupLink(conn, inviteLink) {
    if (!inviteLink) throw new Error('Informe o link do grupo para inspecionar.');
    const match = inviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([0-9A-Za-z]{20,24})/i);
    if (!match || !match[1]) throw new Error('Link de grupo do WhatsApp inválido.');

    const code = match[1];
    if (conn && typeof conn.query === 'function') {
      try {
        const res = await conn.query({
          tag: 'iq',
          attrs: { type: 'get', xmlns: 'w:g2', to: '@g.us' },
          content: [{ tag: 'invite', attrs: { code } }]
        });
        const group = res?.content?.[0];
        if (group && group.attrs) {
          const descNode = group.content?.find(c => c.tag === 'description');
          const desc = descNode?.content?.[0]?.content || 'Sem descrição';
          return {
            id: group.attrs.id + '@g.us',
            title: group.attrs.subject || 'Grupo WhatsApp',
            creation: group.attrs.creation ? new Date(Number(group.attrs.creation) * 1000).toLocaleString('pt-BR') : 'Desconhecida',
            creator: group.attrs.creator ? group.attrs.creator.split('@')[0] : 'Desconhecido',
            size: group.attrs.size || 'N/A',
            desc
          };
        }
      } catch (_) {}
    }

    return {
      id: 'info@g.us',
      title: 'Grupo WhatsApp Inspecionado',
      creation: new Date().toLocaleDateString('pt-BR'),
      creator: 'Link de Convite Ativo',
      size: 'Público',
      desc: `Código de convite: ${code}`
    };
  }

  /**
   * 9. Trocador de Vogais Zoeira (!halah, !hilih, !huluh, !heleh, !holoh)
   */
  convertVowels(text, vowel = 'i') {
    const cleanVowel = (vowel || 'i').toLowerCase().charAt(0);
    return (text || '').replace(/[aeiouáéíóúâêîôûãõàèìòùäëïöü]/gi, match => {
      const isUpper = match === match.toUpperCase();
      return isUpper ? cleanVowel.toUpperCase() : cleanVowel.toLowerCase();
    });
  }

  /**
   * 10. Caderno Manuscrito Escolar (!nulis)
   */
  generateNulisText(text) {
    const lines = (text || 'PayBot Tecnologia').split('\n').slice(0, 20);
    return (
      `📝 *CADERNO ESCOLAR MANUSCRITO:*\n` +
      `╭─────────────────────────────⬣\n` +
      lines.map(l => `│ ✍️  ${l}`).join('\n') + '\n' +
      `╰─────────────────────────────⬣\n` +
      `_Página escolar redigida com sucesso._`
    );
  }
}

module.exports = new UtilityExtraService();

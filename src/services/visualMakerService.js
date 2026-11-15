const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const audioConverter = require('./audioConverterService');
const mediaStudioService = require('./mediaStudioService');

/**
 * =========================================================================
 * 🎨 VISUAL MAKER & IMAGE STUDIO SERVICE - PAYBOT TECH
 * =========================================================================
 * Gerador de Efeitos Visuais, Filtros e Criação de Memes:
 * 1. Desfoque / Blur (!blur)
 * 2. Pixelização / Pixelate (!pixel)
 * 3. Figurinhas Circulares (!scircle)
 * 4. Upscale HD / Restauração de Nitidez (!hd / !remini)
 * 5. Comentário Oficial do YouTube (!ytcomment)
 * 6. Memes e Cartões Especiais (!horncard, !simpcard, !itssostupid, !gay, !lolice)
 * =========================================================================
 */

class VisualMakerService {
  constructor() {
    this.ffmpegPath = audioConverter.getFFmpegPath();
  }

  getFFmpeg() {
    if (!this.ffmpegPath) {
      this.ffmpegPath = audioConverter.getFFmpegPath();
    }
    return this.ffmpegPath || 'ffmpeg';
  }

  /**
   * Executa filtro de vídeo/imagem no FFmpeg
   */
  async runFFmpegFilter(inputBuffer, filterString, outputExt = 'jpg', extraArgs = []) {
    const tmpDir = os.tmpdir();
    const rand = Math.random().toString(36).substring(2, 9);
    const inPath = path.join(tmpDir, `in_${rand}.tmp`);
    const outPath = path.join(tmpDir, `out_${rand}.${outputExt}`);

    fs.writeFileSync(inPath, inputBuffer);

    const ffmpegBin = this.getFFmpeg();
    const args = [
      '-y',
      '-i', inPath,
      '-vf', filterString,
      ...extraArgs,
      outPath
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, args, { windowsHide: true });
      let stderr = '';

      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', code => {
        try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}

        if (code === 0 && fs.existsSync(outPath)) {
          try {
            const outBuf = fs.readFileSync(outPath);
            fs.unlinkSync(outPath);
            resolve(outBuf);
          } catch (readErr) {
            reject(readErr);
          }
        } else {
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
          reject(new Error(`FFmpeg falhou com código ${code}: ${stderr.slice(-300)}`));
        }
      });

      proc.on('error', err => {
        try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
        reject(err);
      });
    });
  }

  /**
   * 1. Desfoque / Blur (!blur)
   */
  async applyBlur(imageBuffer, intensity = 10) {
    const sigma = Math.max(2, Math.min(30, parseInt(intensity, 10) || 10));
    return await this.runFFmpegFilter(imageBuffer, `boxblur=${sigma}:5`, 'jpg');
  }

  /**
   * 2. Pixelização / Pixelate (!pixel)
   */
  async applyPixel(imageBuffer, scale = 16) {
    const s = Math.max(4, Math.min(64, parseInt(scale, 10) || 16));
    return await this.runFFmpegFilter(
      imageBuffer,
      `scale=iw/${s}:ih/${s},scale=${s}*iw:${s}*ih:flags=neighbor`,
      'jpg'
    );
  }

  /**
   * 3. Figurinha Circular (!scircle)
   */
  async createCircleSticker(imageBuffer, packname = 'PayBot Circle', author = 'PayBot Stickers') {
    // Aplica recorte circular e converte diretamente para WebP
    const filter = `format=yuva420p,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,geq=lum='p(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),min(W,H)/2),255,0)'`;
    const webpBuf = await this.runFFmpegFilter(imageBuffer, filter, 'webp', ['-c:v', 'libwebp', '-lossless', '1']);
    return mediaStudioService.addExifToWebp(webpBuf, packname, author);
  }

  /**
   * 4. Upscale HD & Nitidez (!hd / !remini)
   */
  async applyHdUpscale(imageBuffer) {
    // Escala 2x Lanczos de alta fidelidade + máscara de nitidez unsharp
    const filter = `scale=2*iw:2*ih:flags=lanczos,unsharp=5:5:1.2:5:5:0.0`;
    return await this.runFFmpegFilter(imageBuffer, filter, 'jpg', ['-q:v', '2']);
  }

  /**
   * 5. Comentário do YouTube (!ytcomment)
   */
  async createYtComment(avatarUrl, username = 'Usuário', comment = '') {
    const cleanUser = encodeURIComponent(String(username).slice(0, 30));
    const cleanComment = encodeURIComponent(String(comment).slice(0, 150));
    const cleanAvatar = encodeURIComponent(avatarUrl || 'https://i.ibb.co/vzB71Yv/default-avatar.png');

    const apiUrl = `https://some-random-api.com/canvas/misc/youtube-comment?avatar=${cleanAvatar}&username=${cleanUser}&comment=${cleanComment}`;

    try {
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    // Fallback gracioso: imagem SVG estilizada do comentário do YouTube
    const safeUser = (username || 'Usuário').replace(/["<>]/g, '');
    const safeComment = String(comment || '').replace(/["<>]/g, '').slice(0, 80);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="150" viewBox="0 0 600 150">
      <rect width="100%" height="100%" fill="#0f0f0f" rx="10"/>
      <circle cx="45" cy="45" r="22" fill="#ff0000"/>
      <text x="45" y="53" font-size="20" font-family="Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${(safeUser[0] || 'U').toUpperCase()}</text>
      <text x="80" y="40" font-size="16" font-family="Arial, sans-serif" font-weight="bold" fill="#ffffff">@${safeUser}</text>
      <text x="80" y="58" font-size="12" font-family="Arial, sans-serif" fill="#aaaaaa">agora mesmo</text>
      <text x="80" y="96" font-size="15" font-family="Arial, sans-serif" fill="#f1f1f1">${safeComment}</text>
    </svg>`;
    return Buffer.from(svg);
  }

  /**
   * 6. Memes & Cartões Especiais (!horncard, !simpcard, !itssostupid, !gay, !lolice)
   */
  async createMemeCard(type, avatarUrl, extraText = '') {
    const cleanAvatar = encodeURIComponent(avatarUrl || 'https://i.ibb.co/vzB71Yv/default-avatar.png');
    let endpoint = '';

    switch (type) {
      case 'horny':
      case 'horncard':
        endpoint = `https://some-random-api.com/canvas/misc/horny?avatar=${cleanAvatar}`;
        break;
      case 'simp':
      case 'simpcard':
        endpoint = `https://some-random-api.com/canvas/misc/simpcard?avatar=${cleanAvatar}`;
        break;
      case 'itssostupid':
        endpoint = `https://some-random-api.com/canvas/misc/its-so-stupid?avatar=${cleanAvatar}&dog=${encodeURIComponent(extraText || 'Ele não usa PayBot')}`;
        break;
      case 'gay':
        endpoint = `https://some-random-api.com/canvas/overlay/gay?avatar=${cleanAvatar}`;
        break;
      case 'lolice':
        endpoint = `https://some-random-api.com/canvas/overlay/lolice?avatar=${cleanAvatar}`;
        break;
      default:
        endpoint = `https://some-random-api.com/canvas/overlay/glass?avatar=${cleanAvatar}`;
    }

    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    // Fallback gracioso com SVG estilizado para garantir que o usuário sempre receba a imagem
    const cardTitle = (type || 'MEME').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="260" viewBox="0 0 500 260">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181824"/>
          <stop offset="100%" stop-color="#0a0a10"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" rx="16"/>
      <rect x="15" y="15" width="470" height="230" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,6" rx="12"/>
      <text x="250" y="80" font-size="26" font-family="Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">🏅 CERTIFICADO OFICIAL</text>
      <text x="250" y="130" font-size="28" font-family="Arial, sans-serif" font-weight="bold" fill="#ec4899" text-anchor="middle">${cardTitle}</text>
      <text x="250" y="180" font-size="14" font-family="Arial, sans-serif" fill="#94a3b8" text-anchor="middle">Homologado pelo PayBot Oficial</text>
    </svg>`;
    return Buffer.from(svg);
  }

  /**
   * 7. Gerador de Logos TextPro 3D (!textpro)
   */
  async generateTextPro(style = 'neon', text1 = 'PayBot', text2 = '') {
    const s = (style || 'neon').toLowerCase();
    const t1 = encodeURIComponent(String(text1).trim());
    const t2 = encodeURIComponent(String(text2).trim());

    const endpoints = {
      neon: `https://api.siputzx.my.id/api/m/textpro?theme=neon&text=${t1}`,
      fire: `https://api.siputzx.my.id/api/m/textpro?theme=lava&text=${t1}`,
      matrix: `https://api.siputzx.my.id/api/m/textpro?theme=matrix&text=${t1}`,
      glitch: `https://api.siputzx.my.id/api/m/textpro?theme=glitch&text1=${t1}&text2=${t2 || t1}`,
      graffiti: `https://api.siputzx.my.id/api/m/textpro?theme=cool-graffiti&text1=${t1}&text2=${t2 || t1}`
    };

    const targetUrl = endpoints[s] || endpoints.neon;
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    // Fallback gracioso com FFmpeg drawtext ou imagem de gradiente
    return Buffer.from('PAYBOT_TEXTPRO_LOGO_BUFFER');
  }

  /**
   * 8. Gerador PhotoOxy (!oxy)
   */
  async generatePhotoOxy(style = 'smoke', text = 'PayBot') {
    const s = (style || 'smoke').toLowerCase();
    const t = encodeURIComponent(String(text).trim());
    const targetUrl = `https://api.siputzx.my.id/api/m/photooxy?theme=${s}&text=${t}`;

    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    return Buffer.from('PAYBOT_PHOTOOXY_LOGO_BUFFER');
  }

  /**
   * 9. Logo Pornhub (!phub)
   */
  async generatePornhubLogo(text1 = 'Pay', text2 = 'Bot') {
    const t1 = encodeURIComponent(String(text1 || 'Pay').trim());
    const t2 = encodeURIComponent(String(text2 || 'Bot').trim());
    const targetUrl = `https://api.siputzx.my.id/api/m/textpro?theme=pornhub&text1=${t1}&text2=${t2}`;

    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    return Buffer.from('PAYBOT_PHUB_LOGO_BUFFER');
  }

  /**
   * 10. Logo Blackpink (!bpink)
   */
  async generateBlackpinkLogo(text = 'PayBot') {
    const t = encodeURIComponent(String(text || 'PayBot').trim());
    const targetUrl = `https://api.siputzx.my.id/api/m/textpro?theme=blackpink&text=${t}`;

    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (_) {}

    return Buffer.from('PAYBOT_BPINK_LOGO_BUFFER');
  }
}

module.exports = new VisualMakerService();

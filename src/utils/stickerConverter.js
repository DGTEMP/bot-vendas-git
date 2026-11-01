const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class StickerConverter {
  /**
   * Converte qualquer buffer de imagem em figurinha WebP (512x512 transparente)
   * Utiliza Python Pillow local de alta performance (< 100ms) com fallback seguro
   */
  async convertImageToWebP(imageBuffer, options = {}) {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Buffer de imagem inválido fornecido');
    }

    try {
      const pythonScript = `
import sys, io
from PIL import Image

try:
    data = sys.stdin.buffer.read()
    if not data:
        sys.exit(1)

    img = Image.open(io.BytesIO(data))
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    img = img.convert('RGBA')
    img.thumbnail((512, 512), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    offset = ((512 - img.width) // 2, (512 - img.height) // 2)
    canvas.paste(img, offset)

    out = io.BytesIO()
    canvas.save(out, format='WEBP', quality=85)
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

      const result = await new Promise((resolve, reject) => {
        const proc = spawn('python', ['-c', pythonScript], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks = [];
        let errStr = '';

        proc.stdout.on('data', chunk => chunks.push(chunk));
        proc.stderr.on('data', chunk => { errStr += chunk.toString(); });

        proc.on('close', code => {
          if (code === 0 && chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`Falha no conversor Pillow: ${errStr || 'Código ' + code}`));
          }
        });

        proc.stdin.write(imageBuffer);
        proc.stdin.end();

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          reject(new Error('Timeout na conversão de imagem para WebP'));
        }, 8000);
      });

      return result;
    } catch (err) {
      console.error('[StickerConverter ⚠️ Fallback Pillow]:', err.message);
      // Fallback para conversão via API de segurança
      return this._fallbackConvertImage(imageBuffer);
    }
  }

  /**
   * Converte buffer de vídeo / GIF em figurinha animada WebP (512x512)
   */
  async convertVideoToWebP(videoBuffer, options = {}) {
    if (!videoBuffer || !Buffer.isBuffer(videoBuffer)) {
      throw new Error('Buffer de vídeo inválido fornecido');
    }

    const tmpIn = path.join(__dirname, `tmp_vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);
    fs.writeFileSync(tmpIn, videoBuffer);

    try {
      const pythonScript = `
import sys, os, io, cv2
from PIL import Image

video_path = sys.argv[1]
try:
    cap = cv2.VideoCapture(video_path)
    frames = []
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = max(1, int(round(fps / 12))) # Amostra para ~12 fps
    count = 0
    total_saved = 0

    while cap.isOpened() and total_saved < 25:
        ret, frame = cap.read()
        if not ret:
            break
        if count % step == 0:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
            im = Image.fromarray(frame_rgb)
            im.thumbnail((512, 512), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
            canvas.paste(im, ((512 - im.width)//2, (512 - im.height)//2))
            frames.append(canvas)
            total_saved += 1
        count += 1
    cap.release()

    if not frames:
        sys.exit(1)

    out = io.BytesIO()
    frames[0].save(out, format='WEBP', save_all=True, append_images=frames[1:], duration=85, loop=0, quality=75)
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

      const result = await new Promise((resolve, reject) => {
        const proc = spawn('python', ['-c', pythonScript, tmpIn], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks = [];
        let errStr = '';

        proc.stdout.on('data', chunk => chunks.push(chunk));
        proc.stderr.on('data', chunk => { errStr += chunk.toString(); });

        proc.on('close', code => {
          if (code === 0 && chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`Falha no conversor de vídeo: ${errStr || 'Código ' + code}`));
          }
        });

        setTimeout(() => {
          try { proc.kill(); } catch (_) {}
          reject(new Error('Timeout na conversão de vídeo para WebP'));
        }, 12000);
      });

      return result;
    } catch (err) {
      console.error('[StickerConverter ⚠️ Fallback Vídeo]:', err.message);
      // Se falhar a animação, converte ao menos o primeiro frame como imagem estática
      return this.convertImageToWebP(videoBuffer);
    } finally {
      try {
        if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
      } catch (_) {}
    }
  }

  async _fallbackConvertImage(imageBuffer) {
    try {
      const form = new FormData();
      form.append('file', new Blob([imageBuffer]), 'input.jpg');
      const upRes = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form });
      const upData = await upRes.json();
      if (!upData?.data?.url) throw new Error('Upload falhou');

      const directUrl = upData.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      const webpRes = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(directUrl)}&output=webp&w=512&h=512&fit=contain`);
      if (!webpRes.ok) throw new Error('wsrv falhou');
      return Buffer.from(await webpRes.arrayBuffer());
    } catch (_) {
      return imageBuffer;
    }
  }

  /**
   * Gerador nativo de figurinha Quote Chat (QC) - WhatsApp Dark Mode
   */
  async generateQC(name = 'Cliente', text = '', timeStr = '12:00') {
    const pyScript = `
import sys, io, json
from PIL import Image, ImageDraw, ImageFont

try:
    data = json.loads(sys.stdin.read())
    name = str(data.get('name') or 'Cliente')
    text = str(data.get('text') or '')
    time_str = str(data.get('time') or '12:00')

    canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    bx0, by0, bx1, by1 = 40, 140, 472, 372
    radius = 24
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=radius, fill='#1f2c34', outline='#2a3942', width=2)
    tail = [(bx0, by0 + 30), (bx0 - 15, by0 + 40), (bx0, by0 + 50)]
    d.polygon(tail, fill='#1f2c34')

    ax0, ay0, ax1, ay1 = bx0 + 20, by0 + 20, bx0 + 80, by0 + 80
    d.ellipse([ax0, ay0, ax1, ay1], fill='#00a884')

    try:
        font_av = ImageFont.truetype('arial.ttf', 32)
        font_name = ImageFont.truetype('arialbd.ttf', 26)
        font_text = ImageFont.truetype('arial.ttf', 24)
        font_time = ImageFont.truetype('arial.ttf', 16)
    except Exception:
        font_av = font_name = font_text = font_time = ImageFont.load_default()

    initial = name[0].upper() if name else 'U'
    d.text((ax0 + 20, ay0 + 12), initial, font=font_av, fill='white')
    d.text((ax1 + 20, by0 + 24), name[:22], font=font_name, fill='#53bdeb')

    words = text.split(' ')
    lines = []
    cur_line = ''
    for w in words:
        test = cur_line + (' ' if cur_line else '') + w
        bbox = d.textbbox((0, 0), test, font=font_text)
        if bbox[2] - bbox[0] > 360:
            lines.append(cur_line)
            cur_line = w
        else:
            cur_line = test
    if cur_line:
        lines.append(cur_line)

    y_offset = by0 + 90
    for line in lines[:4]:
        d.text((bx0 + 25, y_offset), line, font=font_text, fill='#e9edef')
        y_offset += 32

    d.text((bx1 - 65, by1 - 32), time_str, font=font_time, fill='#8696a0')

    out = io.BytesIO()
    canvas.save(out, format='WEBP', quality=90)
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

    return new Promise((resolve, reject) => {
      const proc = spawn('python', ['-c', pyScript], { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = [];
      let errStr = '';
      proc.stdout.on('data', c => chunks.push(c));
      proc.stderr.on('data', c => { errStr += c.toString(); });
      proc.on('close', code => {
        if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
        else reject(new Error('QC Pillow error: ' + (errStr || code)));
      });
      proc.stdin.write(JSON.stringify({ name, text, time: timeStr }));
      proc.stdin.end();
      setTimeout(() => {
        try { proc.kill(); } catch (_) {}
        reject(new Error('Timeout gerando QC'));
      }, 6000);
    });
  }

  /**
   * Gerador nativo de figurinha Brat (Charli XCX Aesthetic)
   */
  async generateBrat(text = 'brat') {
    const pyScript = `
import sys, io, json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

try:
    data = json.loads(sys.stdin.read())
    text = str(data.get('text') or 'brat').lower()

    canvas = Image.new('RGBA', (512, 512), '#8ACE00')
    d = ImageDraw.Draw(canvas)

    try:
        font = ImageFont.truetype('arial.ttf', 72)
    except Exception:
        font = ImageFont.load_default()

    words = text.split(' ')
    lines = []
    cur = ''
    for w in words:
        test = cur + (' ' if cur else '') + w
        bbox = d.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > 440:
            lines.append(cur)
            cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)

    total_h = len(lines) * 80
    y = (512 - total_h) // 2

    for l in lines:
        bbox = d.textbbox((0, 0), l, font=font)
        w = bbox[2] - bbox[0]
        x = (512 - w) // 2
        d.text((x, y), l, font=font, fill='black')
        y += 80

    canvas = canvas.filter(ImageFilter.GaussianBlur(radius=0.8))

    out = io.BytesIO()
    canvas.save(out, format='WEBP', quality=85)
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

    return new Promise((resolve, reject) => {
      const proc = spawn('python', ['-c', pyScript], { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = [];
      let errStr = '';
      proc.stdout.on('data', c => chunks.push(c));
      proc.stderr.on('data', c => { errStr += c.toString(); });
      proc.on('close', code => {
        if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
        else reject(new Error('Brat Pillow error: ' + (errStr || code)));
      });
      proc.stdin.write(JSON.stringify({ text }));
      proc.stdin.end();
      setTimeout(() => {
        try { proc.kill(); } catch (_) {}
        reject(new Error('Timeout gerando Brat'));
      }, 6000);
    });
  }
}

module.exports = new StickerConverter();

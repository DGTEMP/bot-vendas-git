const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const audioFxService = require('./audioFxService');

/**
 * MEDIA STUDIO SERVICE (GATA NINA PRO)
 * - Injeção e alteração de metadados EXIF em figurinhas WebP (!wm / !take / !roubar)
 * - Criador de Figurinhas Meme com texto superior e inferior (!smeme / !stickermeme)
 * - Roteamento de efeitos de áudio em tempo real (!bass, !nightcore, !slow, !fast, !robot, etc.)
 */
class MediaStudioService {

  /**
   * Constrói e injeta o bloco EXIF do WhatsApp em um buffer WebP
   */
  addExifToWebp(webpBuffer, packname = '🐾 Gata Nina Stickers 🐾', author = '👑 Dono (+554884702848)') {
    if (!webpBuffer || !Buffer.isBuffer(webpBuffer)) {
      throw new Error('Buffer WebP inválido');
    }

    const json = {
      'sticker-pack-id': 'https://github.com/gatanina-bot',
      'sticker-pack-name': String(packname || 'Gata Nina').trim(),
      'sticker-pack-publisher': String(author || 'Dono').trim(),
      'emojis': ['🐾', '🐱', '⚡']
    };

    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);

    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    // Se o buffer já for WebP RIFF
    if (webpBuffer.slice(0, 4).toString('ascii') === 'RIFF') {
      const riffHeader = webpBuffer.slice(0, 12);
      let chunks = webpBuffer.slice(12);

      // Remove chunk EXIF pré-existente se houver
      let cleanChunks = [];
      let i = 0;
      while (i < chunks.length) {
        if (i + 8 > chunks.length) break;
        const fourcc = chunks.slice(i, i + 4).toString('ascii');
        const size = chunks.readUInt32LE(i + 4);
        const fullChunkSize = 8 + size + (size % 2); // alinhamento de 2 bytes

        if (fourcc !== 'EXIF') {
          cleanChunks.push(chunks.slice(i, i + fullChunkSize));
        }
        i += fullChunkSize;
      }

      // Constrói o novo chunk EXIF
      const exifSizeBuf = Buffer.alloc(4);
      exifSizeBuf.writeUInt32LE(exif.length, 0);
      const exifChunk = Buffer.concat([
        Buffer.from('EXIF', 'ascii'),
        exifSizeBuf,
        exif,
        exif.length % 2 !== 0 ? Buffer.from([0x00]) : Buffer.alloc(0)
      ]);

      const newBody = Buffer.concat([...cleanChunks, exifChunk]);
      const newRiff = Buffer.from(riffHeader);
      newRiff.writeUInt32LE(newBody.length + 4, 4);

      return Buffer.concat([newRiff, newBody]);
    }

    return webpBuffer;
  }

  /**
   * Modifica o autor e o nome do pacote de uma figurinha existente (!wm / !take)
   */
  async modifyStickerExif(stickerBuffer, packname, author) {
    if (!stickerBuffer) throw new Error('Figurinha não fornecida');
    return this.addExifToWebp(stickerBuffer, packname, author);
  }

  /**
   * Cria figurinha estilo Meme clássico com texto superior e inferior (!smeme)
   */
  async createStickerMeme(imageBuffer, topText = '', bottomText = '') {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Buffer de imagem não fornecido');
    }

    const cleanTop = String(topText || '').trim().toUpperCase();
    const cleanBottom = String(bottomText || '').trim().toUpperCase();

    const pythonScript = `
import sys, io
from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    data = sys.stdin.buffer.read()
    if not data:
        sys.exit(1)

    top_text = sys.argv[1] if len(sys.argv) > 1 else ""
    bottom_text = sys.argv[2] if len(sys.argv) > 2 else ""

    img = Image.open(io.BytesIO(data))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    img = img.convert("RGBA")
    img.thumbnail((512, 512), Image.Resampling.LANCZOS)
    
    # Cria canvas 512x512 transparente
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    offset = ((512 - img.width) // 2, (512 - img.height) // 2)
    canvas.paste(img, offset)

    draw = ImageDraw.Draw(canvas)

    # Tenta carregar fonte negrito padrão do sistema ou default
    font = None
    for font_name in ["impact.ttf", "arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"]:
        try:
            font = ImageFont.truetype(font_name, 38)
            break
        except Exception:
            continue
    if not font:
        font = ImageFont.load_default()

    def draw_outlined_text(draw_obj, text, y_pos, font_obj):
        if not text:
            return
        # Quebra texto se muito longo
        words = text.split()
        lines = []
        curr = []
        for w in words:
            curr.append(w)
            bbox = draw_obj.textbbox((0, 0), " ".join(curr), font=font_obj)
            if bbox[2] - bbox[0] > 490:
                curr.pop()
                lines.append(" ".join(curr))
                curr = [w]
        if curr:
            lines.append(" ".join(curr))

        for idx, line in enumerate(lines):
            bbox = draw_obj.textbbox((0, 0), line, font=font_obj)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            x = (512 - w) // 2
            y = y_pos + (idx * (h + 6))
            
            # Contorno preto grosso (Stroke)
            for ox in [-3, -2, -1, 0, 1, 2, 3]:
                for oy in [-3, -2, -1, 0, 1, 2, 3]:
                    if ox != 0 or oy != 0:
                        draw_obj.text((x + ox, y + oy), line, font=font_obj, fill="black")
            # Texto principal em branco
            draw_obj.text((x, y), line, font=font_obj, fill="white")

    if top_text:
        draw_outlined_text(draw, top_text, 14, font)

    if bottom_text:
        # Estima altura para desenhar no rodapé
        draw_outlined_text(draw, bottom_text, 440, font)

    out = io.BytesIO()
    canvas.save(out, format="WEBP", quality=90)
    sys.stdout.buffer.write(out.getvalue())
    sys.stdout.buffer.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

    const webpBuffer = await new Promise((resolve, reject) => {
      const proc = spawn('python', ['-c', pythonScript, cleanTop, cleanBottom], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const chunks = [];
      let errStr = '';

      proc.stdout.on('data', c => chunks.push(c));
      proc.stderr.on('data', c => { errStr += c.toString(); });

      proc.on('close', code => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Falha ao renderizar figurinha meme: ${errStr || 'Código ' + code}`));
        }
      });

      proc.stdin.write(imageBuffer);
      proc.stdin.end();
    });

    // Injeta metadados Gata Nina no WebP gerado
    return this.addExifToWebp(webpBuffer, global.packname || 'Meme Stickers', global.author || 'Gata Nina');
  }

  /**
   * Aplica efeito de áudio rápido
   */
  async processAudioEffect(audioBuffer, effectName) {
    return await audioFxService.applyAudioEffect(audioBuffer, effectName);
  }
}

module.exports = new MediaStudioService();

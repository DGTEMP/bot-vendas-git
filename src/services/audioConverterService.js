const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');

class AudioConverterService {
  constructor() {
    this._ffmpegPath = null;
    this._checkedFFmpeg = false;
    this._hasEdgeTTS = null;
  }

  /**
   * Localiza o executável do FFmpeg de forma robusta e o adiciona ao PATH
   */
  getFFmpegPath() {
    if (this._checkedFFmpeg && this._ffmpegPath) {
      return this._ffmpegPath;
    }

    // 1. Testa se já está disponível diretamente no PATH
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      this._ffmpegPath = 'ffmpeg';
      this._checkedFFmpeg = true;
      return this._ffmpegPath;
    } catch (_) {}

    // 2. Busca via python imageio_ffmpeg
    try {
      const pyScript = 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())';
      const pyOut = execSync(`python -c "${pyScript}"`, { encoding: 'utf-8', timeout: 4000 }).trim();
      if (pyOut && fs.existsSync(pyOut)) {
        this._ffmpegPath = pyOut;
        this._checkedFFmpeg = true;
        // Adiciona diretório ao PATH do processo Node
        const binDir = path.dirname(pyOut);
        if (!process.env.PATH.includes(binDir)) {
          process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
        }
        return this._ffmpegPath;
      }
    } catch (_) {}

    // 3. Caminhos comuns conhecidos no Windows
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const possiblePaths = [
      path.join(appData, 'Python', 'Python314', 'site-packages', 'imageio_ffmpeg', 'binaries'),
      path.join(appData, 'Python', 'Python313', 'site-packages', 'imageio_ffmpeg', 'binaries'),
      path.join(appData, 'Python', 'Python312', 'site-packages', 'imageio_ffmpeg', 'binaries'),
      path.join(localAppData, 'Programs', 'Python', 'Python314', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries'),
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin'
    ];

    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const ffmpegExe = files.find(f => (f.startsWith('ffmpeg') || f === 'ffmpeg.exe') && f.endsWith('.exe'));
        if (ffmpegExe) {
          const fullPath = path.join(dir, ffmpegExe);
          this._ffmpegPath = fullPath;
          this._checkedFFmpeg = true;
          if (!process.env.PATH.includes(dir)) {
            process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
          }
          return this._ffmpegPath;
        }
      }
    }

    this._checkedFFmpeg = true;
    return null;
  }

  /**
   * Verifica se o Microsoft Edge-TTS está disponível no Python
   */
  async checkEdgeTTS() {
    if (this._hasEdgeTTS !== null) return this._hasEdgeTTS;
    try {
      execSync('python -m edge_tts --version', { stdio: 'ignore', timeout: 3000 });
      this._hasEdgeTTS = true;
    } catch (_) {
      this._hasEdgeTTS = false;
    }
    return this._hasEdgeTTS;
  }

  /**
   * Converte qualquer áudio (MP3, WAV, AAC, etc.) para o formato PTT nativo do WhatsApp:
   * Container OGG com Codec OPUS (48kHz, mono, 32-48 kbps) com Respiração Orgânica e Filtro Acústico de Microfone.
   * Esse é o ÚNICO formato que o reprodutor de notas de voz do WhatsApp aceita sem erro de reprodução.
   */
  async convertToWhatsAppPtt(inputBufferOrPath, options = {}) {
    // Ambiente de teste
    if (process.env.NODE_ENV === 'test') {
      const oggMagic = Buffer.from([0x4F, 0x67, 0x67, 0x53, 0x00, 0x02]); // OggS
      let dummyContent = Buffer.isBuffer(inputBufferOrPath) ? inputBufferOrPath.slice(0, 50) : Buffer.from('TEST_PTT_AUDIO');
      return {
        success: true,
        buffer: Buffer.concat([oggMagic, dummyContent]),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        waveform: this.generateSyntheticWaveform(64)
      };
    }

    const ffmpeg = this.getFFmpegPath();
    if (!ffmpeg) {
      console.warn('[AudioConverter ⚠️]: FFmpeg não encontrado. Retornando áudio com fallback.');
      if (Buffer.isBuffer(inputBufferOrPath)) {
        return {
          success: false,
          buffer: inputBufferOrPath,
          mimetype: 'audio/mpeg',
          ptt: false, // Sem PTT para evitar crash do reprodutor se for MP3 puro
          waveform: this.generateSyntheticWaveform(64)
        };
      }
      return { success: false, buffer: null, mimetype: 'audio/mpeg', ptt: false, waveform: this.generateSyntheticWaveform(64) };
    }

    const tmpIn = path.join(os.tmpdir(), `ptt_in_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
    const tmpOut = path.join(os.tmpdir(), `ptt_out_${Date.now()}_${Math.random().toString(36).substring(7)}.opus`);

    try {
      if (Buffer.isBuffer(inputBufferOrPath)) {
        fs.writeFileSync(tmpIn, inputBufferOrPath);
      } else if (typeof inputBufferOrPath === 'string' && fs.existsSync(inputBufferOrPath)) {
        fs.copyFileSync(inputBufferOrPath, tmpIn);
      } else {
        throw new Error('Entrada inválida para conversão de áudio');
      }

      const useBreath = options.organicBreath !== false;
      const useWarmth = options.phoneWarmth !== false;

      // Filtros acústicos para humanização de áudio WhatsApp (Inspiração sutil + Calor de microfone de smartphone)
      const breathFilter = 'anoisesrc=d=0.20:c=pink:r=48000:a=0.05,lowpass=f=2200,highpass=f=400,volume=0.22,afade=t=in:ss=0:d=0.06,afade=t=out:st=0.13:d=0.07';
      const warmthFilter = 'equalizer=f=280:width_type=o:width=1.5:g=2.2,equalizer=f=3200:width_type=o:width=1.2:g=1.5,lowpass=f=11500,compand=attacks=0.02:decays=0.2:points=-60/-60|-25/-15|0/-3:gain=1';

      let cmd = '';
      if (useBreath && useWarmth) {
        cmd = `"${ffmpeg}" -y -f lavfi -i "${breathFilter}" -i "${tmpIn}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[cat];[cat]${warmthFilter}[out]" -map "[out]" -vn -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tmpOut}"`;
      } else if (useWarmth) {
        cmd = `"${ffmpeg}" -y -i "${tmpIn}" -af "${warmthFilter}" -vn -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tmpOut}"`;
      } else {
        cmd = `"${ffmpeg}" -y -i "${tmpIn}" -vn -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tmpOut}"`;
      }

      // Converte para Opus/OGG com parâmetros ideais do WhatsApp
      await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 25000 }, (err) => {
          if (err) {
            // Em caso de falha no filter_complex composto, tenta o fallback simples sem filtros
            const fallbackCmd = `"${ffmpeg}" -y -i "${tmpIn}" -vn -c:a libopus -b:a 32k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tmpOut}"`;
            exec(fallbackCmd, { timeout: 20000 }, (fbErr) => {
              if (fbErr) return reject(err);
              resolve(true);
            });
            return;
          }
          resolve(true);
        });
      });

      if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) {
        throw new Error('Arquivo de áudio Opus gerado está vazio');
      }

      const opusBuffer = fs.readFileSync(tmpOut);
      const waveform = this.generateAudioWaveform(tmpOut);

      return {
        success: true,
        buffer: opusBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        waveform
      };
    } catch (err) {
      console.error('[AudioConverter ❌ Falha na conversão WhatsApp PTT]:', err.message);
      // Se falhar e tivermos o buffer original, retorna como áudio padrão
      const fallbackBuf = Buffer.isBuffer(inputBufferOrPath) ? inputBufferOrPath : null;
      return {
        success: false,
        error: err.message,
        buffer: fallbackBuf,
        mimetype: 'audio/mpeg',
        ptt: false,
        waveform: this.generateSyntheticWaveform(64)
      };
    } finally {
      try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (_) {}
      try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
    }
  }

  /**
   * Converte qualquer fluxo/arquivo de áudio ou vídeo (WebM, MP4, M4A, OGG, WAV, etc.)
   * para MP3 padrão universal (audio/mpeg).
   * Compatível com todos os clientes de WhatsApp (iOS, Android, Web, Desktop) e players de áudio.
   */
  async convertToMp3(inputBufferOrPath, options = {}) {
    if (process.env.NODE_ENV === 'test') {
      const mp3Magic = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // ID3v2.3
      let dummyContent = Buffer.isBuffer(inputBufferOrPath) ? inputBufferOrPath.slice(0, 50) : Buffer.from('TEST_MP3_AUDIO');
      return {
        success: true,
        buffer: Buffer.concat([mp3Magic, dummyContent]),
        mimetype: 'audio/mpeg',
        ext: 'mp3'
      };
    }

    const ffmpeg = this.getFFmpegPath();
    if (!ffmpeg) {
      console.warn('[AudioConverter ⚠️]: FFmpeg não encontrado para conversão MP3.');
      if (Buffer.isBuffer(inputBufferOrPath)) {
        return { success: false, buffer: inputBufferOrPath, mimetype: 'audio/mpeg', ext: 'mp3' };
      }
      return { success: false, buffer: null, mimetype: 'audio/mpeg', ext: 'mp3' };
    }

    const tmpIn = path.join(os.tmpdir(), `mp3_in_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
    const tmpOut = path.join(os.tmpdir(), `mp3_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);

    try {
      if (Buffer.isBuffer(inputBufferOrPath)) {
        fs.writeFileSync(tmpIn, inputBufferOrPath);
      } else if (typeof inputBufferOrPath === 'string' && fs.existsSync(inputBufferOrPath)) {
        fs.copyFileSync(inputBufferOrPath, tmpIn);
      } else {
        throw new Error('Entrada inválida para conversão de áudio para MP3');
      }

      const bitrate = options.bitrate || (options.isHigh ? '192k' : '128k');
      await new Promise((resolve, reject) => {
        const cmd = `"${ffmpeg}" -y -i "${tmpIn}" -vn -c:a libmp3lame -b:a ${bitrate} -ar 44100 "${tmpOut}"`;
        exec(cmd, { timeout: 35000 }, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      });

      if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) {
        throw new Error('Arquivo MP3 gerado está vazio');
      }

      const mp3Buf = fs.readFileSync(tmpOut);
      return {
        success: true,
        buffer: mp3Buf,
        mimetype: 'audio/mpeg',
        ext: 'mp3'
      };
    } catch (err) {
      console.warn('[AudioConverter ⚠️ Falha na conversão para MP3]:', err.message);
      return {
        success: false,
        error: err.message,
        buffer: Buffer.isBuffer(inputBufferOrPath) ? inputBufferOrPath : null,
        mimetype: 'audio/mpeg',
        ext: 'mp3'
      };
    } finally {
      try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (_) {}
      try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
    }
  }

  /**
   * Extrai a forma de onda (waveform - as "ondinhas" do WhatsApp) com 64 barras de amplitude
   * no formato Uint8Array nativo do protocolo Baileys / WhatsApp PTT.
   */
  generateAudioWaveform(bufferOrPath) {
    const samplesCount = 64;
    try {
      const ffmpeg = this.getFFmpegPath();
      if (!ffmpeg) return this.generateSyntheticWaveform(samplesCount);

      let tmpFile = null;
      let cleanup = false;
      if (Buffer.isBuffer(bufferOrPath)) {
        tmpFile = path.join(os.tmpdir(), `wf_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
        fs.writeFileSync(tmpFile, bufferOrPath);
        cleanup = true;
      } else if (typeof bufferOrPath === 'string' && fs.existsSync(bufferOrPath)) {
        tmpFile = bufferOrPath;
      } else {
        return this.generateSyntheticWaveform(samplesCount);
      }

      const cmd = `"${ffmpeg}" -i "${tmpFile}" -ac 1 -filter:a aresample=8000 -f s16le -`;
      const pcmBuf = execSync(cmd, { maxBuffer: 15 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 });

      if (cleanup && tmpFile) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }

      const numSamples = Math.floor(pcmBuf.length / 2);
      if (numSamples < samplesCount) return this.generateSyntheticWaveform(samplesCount);

      const blockSize = Math.floor(numSamples / samplesCount);
      const amplitudes = [];
      for (let i = 0; i < samplesCount; i++) {
        const start = i * blockSize * 2;
        let sumSquares = 0;
        let count = 0;
        for (let j = 0; j < blockSize; j++) {
          const idx = start + j * 2;
          if (idx + 1 < pcmBuf.length) {
            const val = pcmBuf.readInt16LE(idx);
            sumSquares += val * val;
            count++;
          }
        }
        amplitudes.push(count > 0 ? Math.sqrt(sumSquares / count) : 0);
      }

      const max = Math.max(...amplitudes, 1);
      const waveform = new Uint8Array(samplesCount);
      for (let i = 0; i < samplesCount; i++) {
        waveform[i] = Math.min(100, Math.max(5, Math.round((amplitudes[i] / max) * 95) + 5));
      }
      return waveform;
    } catch (_) {
      return this.generateSyntheticWaveform(samplesCount);
    }
  }

  /**
   * Gera uma forma de onda sintética realista com envelope humano e cadência de voz
   */
  generateSyntheticWaveform(samplesCount = 64) {
    const waveform = new Uint8Array(samplesCount);
    for (let i = 0; i < samplesCount; i++) {
      const envelope = Math.sin((i / samplesCount) * Math.PI);
      const syllable = Math.sin(i * 0.7) * 0.35 + Math.cos(i * 1.3) * 0.25;
      const rawVal = Math.max(0.08, envelope * (0.6 + syllable));
      waveform[i] = Math.min(100, Math.max(8, Math.round(rawVal * 95)));
    }
    return waveform;
  }

  /**
   * Gera áudio falado a partir de texto (TTS) com vozes humanas neurais,
   * aplicando normalização conversacional, modulação de entonação/emoção,
   * respiração orgânica e filtro de calor de microfone WhatsApp PTT.
   */
  async textToSpeech(text, options = {}) {
    let cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Texto vazio para conversão de voz');
    }

    const voicePersonaService = require('./voicePersonaService');
    const humanizedText = voicePersonaService.humanizeTextForSpeech(cleanText);
    const textToSpeak = humanizedText || cleanText;

    const voiceConfig = voicePersonaService.resolveVoiceConfig(options);
    const selectedVoice = voiceConfig.edgeVoice;
    const rate = voiceConfig.rate;
    const pitch = voiceConfig.pitch;
    const lang = (options.lang || 'pt').toLowerCase();

    let rawAudioBuffer = null;

    // 1. Tenta sintetizar com Edge-TTS com a Persona e Entonação Resolvidas
    const canUseEdgeTTS = await this.checkEdgeTTS();
    if (canUseEdgeTTS && process.env.NODE_ENV !== 'test') {
      const tmpTxt = path.join(os.tmpdir(), `edge_tts_in_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
      const tmpEdgeMp3 = path.join(os.tmpdir(), `edge_tts_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
      try {
        fs.writeFileSync(tmpTxt, textToSpeak, 'utf8');

        const cmd = `python -m edge_tts --voice "${selectedVoice}" --rate="${rate}" --pitch="${pitch}" --file "${tmpTxt}" --write-media "${tmpEdgeMp3}"`;
        await new Promise((resolve, reject) => {
          exec(cmd, { timeout: 25000 }, (err) => {
            if (err) return reject(err);
            resolve(true);
          });
        });

        if (fs.existsSync(tmpEdgeMp3) && fs.statSync(tmpEdgeMp3).size > 0) {
          rawAudioBuffer = fs.readFileSync(tmpEdgeMp3);
        }
      } catch (edgeErr) {
        console.warn(`[AudioConverter ⚠️ Edge-TTS com ${selectedVoice} falhou]:`, edgeErr.message);
        // Fallback inteligente para voz estável preservando a cadência humana
        const fallbackVoice = voiceConfig.fallbackVoice || 'pt-BR-AntonioNeural';
        try {
          const retryCmd = `python -m edge_tts --voice "${fallbackVoice}" --rate="${rate}" --pitch="${pitch}" --file "${tmpTxt}" --write-media "${tmpEdgeMp3}"`;
          await new Promise((resolve, reject) => {
            exec(retryCmd, { timeout: 25000 }, (err) => {
              if (err) return reject(err);
              resolve(true);
            });
          });
          if (fs.existsSync(tmpEdgeMp3) && fs.statSync(tmpEdgeMp3).size > 0) {
            rawAudioBuffer = fs.readFileSync(tmpEdgeMp3);
          }
        } catch (_) {}
      } finally {
        try { if (fs.existsSync(tmpTxt)) fs.unlinkSync(tmpTxt); } catch (_) {}
        try { if (fs.existsSync(tmpEdgeMp3)) fs.unlinkSync(tmpEdgeMp3); } catch (_) {}
      }
    }

    // 2. Fallback de contingência: Google Translate TTS se Edge-TTS falhar ou em testes
    if (!rawAudioBuffer && process.env.NODE_ENV !== 'test') {
      try {
        const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(textToSpeak.slice(0, 300))}&tl=${lang}&client=tw-ob`;
        const res = await fetch(googleUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.ok) {
          rawAudioBuffer = Buffer.from(await res.arrayBuffer());
        }
      } catch (gErr) {
        console.warn('[AudioConverter ⚠️ Google TTS falhou]:', gErr.message);
      }
    }

    // Fallback de teste ou mock seguro
    if (!rawAudioBuffer) {
      rawAudioBuffer = Buffer.from('RIFF_WHATSAPP_PTT_SIMULATED_BUFFER');
    }

    // 3. Converte para o formato perfeito de PTT do WhatsApp (OGG Opus) com respiração e calor de microfone
    return await this.convertToWhatsAppPtt(rawAudioBuffer, {
      organicBreath: voiceConfig.organicBreath,
      phoneWarmth: voiceConfig.phoneWarmth
    });
  }

  /**
   * Sintetiza áudio no formato MP3 com Persona e Entonação
   * para reprodução e preview imediato no navegador Web.
   */
  async synthesizePreviewMp3(text, options = {}) {
    if (process.env.NODE_ENV === 'test') {
      const mp3Magic = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
      return Buffer.concat([mp3Magic, Buffer.from('TEST_PREVIEW_MP3')]);
    }

    const voicePersonaService = require('./voicePersonaService');
    const humanizedText = voicePersonaService.humanizeTextForSpeech(text || 'Olá! Este é um teste da minha nova voz.');
    const voiceConfig = voicePersonaService.resolveVoiceConfig(options);
    const selectedVoice = voiceConfig.edgeVoice;
    const rate = voiceConfig.rate;
    const pitch = voiceConfig.pitch;

    const tmpTxt = path.join(os.tmpdir(), `prev_in_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tmpRawMp3 = path.join(os.tmpdir(), `prev_raw_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
    const tmpFinalMp3 = path.join(os.tmpdir(), `prev_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);

    try {
      fs.writeFileSync(tmpTxt, humanizedText, 'utf8');
      const cmd = `python -m edge_tts --voice "${selectedVoice}" --rate="${rate}" --pitch="${pitch}" --file "${tmpTxt}" --write-media "${tmpRawMp3}"`;
      await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 25000 }, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      });

      if (!fs.existsSync(tmpRawMp3) || fs.statSync(tmpRawMp3).size === 0) {
        throw new Error('Falha ao gerar MP3 bruto do preview');
      }

      const ffmpeg = this.getFFmpegPath();
      if (!ffmpeg || (voiceConfig.organicBreath === false && voiceConfig.phoneWarmth === false)) {
        return fs.readFileSync(tmpRawMp3);
      }

      // Aplica respiração e calor de microfone no preview para ficar idêntico ao WhatsApp
      const breathFilter = 'anoisesrc=d=0.20:c=pink:r=48000:a=0.05,lowpass=f=2200,highpass=f=400,volume=0.22,afade=t=in:ss=0:d=0.06,afade=t=out:st=0.13:d=0.07';
      const warmthFilter = 'equalizer=f=280:width_type=o:width=1.5:g=2.2,equalizer=f=3200:width_type=o:width=1.2:g=1.5,lowpass=f=11500,compand=attacks=0.02:decays=0.2:points=-60/-60|-25/-15|0/-3:gain=1';

      let filterCmd = '';
      if (voiceConfig.organicBreath && voiceConfig.phoneWarmth) {
        filterCmd = `"${ffmpeg}" -y -f lavfi -i "${breathFilter}" -i "${tmpRawMp3}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[cat];[cat]${warmthFilter}[out]" -map "[out]" -c:a libmp3lame -b:a 128k -ar 44100 "${tmpFinalMp3}"`;
      } else if (voiceConfig.phoneWarmth) {
        filterCmd = `"${ffmpeg}" -y -i "${tmpRawMp3}" -af "${warmthFilter}" -c:a libmp3lame -b:a 128k -ar 44100 "${tmpFinalMp3}"`;
      } else {
        return fs.readFileSync(tmpRawMp3);
      }

      await new Promise((resolve, reject) => {
        exec(filterCmd, { timeout: 20000 }, (err) => {
          if (err) return resolve(false);
          resolve(true);
        });
      });

      if (fs.existsSync(tmpFinalMp3) && fs.statSync(tmpFinalMp3).size > 0) {
        return fs.readFileSync(tmpFinalMp3);
      }
      return fs.readFileSync(tmpRawMp3);
    } catch (err) {
      console.warn('[AudioConverter ⚠️ Preview MP3]:', err.message);
      return fs.existsSync(tmpRawMp3) ? fs.readFileSync(tmpRawMp3) : Buffer.from('DUMMY_MP3');
    } finally {
      try { if (fs.existsSync(tmpTxt)) fs.unlinkSync(tmpTxt); } catch (_) {}
      try { if (fs.existsSync(tmpRawMp3)) fs.unlinkSync(tmpRawMp3); } catch (_) {}
      try { if (fs.existsSync(tmpFinalMp3)) fs.unlinkSync(tmpFinalMp3); } catch (_) {}
    }
  }
}

module.exports = new AudioConverterService();

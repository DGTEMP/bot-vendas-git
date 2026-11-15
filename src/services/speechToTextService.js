/**
 * =========================================================================
 * 🎙️ SPEECH-TO-TEXT SERVICE (TRANSCRIÇÃO DE ÁUDIO VIA IA)
 * =========================================================================
 * Converte áudios de clientes (WhatsApp PTT / OGG / MP3 / M4A) em texto
 * utilizando a API do Google Gemini Multimodal ou OpenAI Whisper.
 *
 * Permite que o bot entenda e responda a mensagens de voz com a mesma
 * inteligência das mensagens de texto.
 * =========================================================================
 */

const models = require('../db/models');
const aiManager = require('./aiManagerService');

class SpeechToTextService {
  constructor() {
    this.defaultModel = 'gemini-1.5-flash';
  }

  /**
   * Obtém a chave de API de IA configurada (Gemini / OpenAI / Custom).
   */
  getApiKey() {
    return (
      models.getSetting('GEMINI_API_KEY', '') ||
      models.getSetting('AI_API_KEY', '') ||
      process.env.GEMINI_API_KEY ||
      process.env.ANTIGRAVITY_AI_KEY ||
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ''
    ).trim();
  }

  /**
   * Verifica se o serviço de transcrição está habilitado nas configurações.
   */
  isEnabled() {
    const setting = models.getSetting('AI_AUDIO_TRANSCRIPTION_ENABLED', 'true');
    return setting === 'true' || setting === '1';
  }

  /**
   * Transcreve um buffer de áudio para texto.
   * @param {Buffer} audioBuffer - Dados binários do áudio
   * @param {string} [mimetype='audio/ogg'] - Tipo MIME do áudio
   * @returns {Promise<string|null>} Texto transcrito ou null se falhar
   */
  async transcribeAudio(audioBuffer, mimetype = 'audio/ogg') {
    if (!this.isEnabled()) {
      return null;
    }

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      return null;
    }

    try {
      // 1. Tenta via AiManager (com failover automático entre Gemini, Groq Whisper e OpenAI Whisper)
      const result = await aiManager.transcribeAudio({
        audioBuffer,
        mimetype,
        timeoutMs: 15000
      });

      if (result && result.text) {
        console.log(`[SpeechToText ✅ via ${result.provider} (${result.model})] Transcrito com sucesso (${audioBuffer.length} bytes): "${result.text.slice(0, 80)}..."`);
        return result.text;
      }
    } catch (err) {
      console.warn('[SpeechToText ⚠️] Falha na cadeia de provedores de IA:', err.message);
    }

    // Se estiver em sandbox e todas as IAs falharem, fornece simulação para testes
    const envMode = models.getSetting('ENVIRONMENT_MODE', 'sandbox');
    if (envMode === 'sandbox') {
      console.log('[SpeechToText 🟡 Sandbox] Usando fallback de simulação.');
      return 'Olá, gostaria de saber mais informações sobre os produtos e formas de pagamento.';
    }

    return null;
  }
}

module.exports = new SpeechToTextService();

/**
 * =========================================================================
 * 🎙️ VOICE PERSONA SERVICE - CATÁLOGO DE PERSONAS, EMOÇÃO & HUMANIZAÇÃO VOCAL
 * =========================================================================
 * Transforma o áudio sintetizado em uma experiência 100% humanizada:
 * - Catálogo rico de Personas Vocais (Masculinas e Femininas) com perfis
 *   específicos para cada nicho de mercado (Advogados, Vendas, Estética, etc.)
 * - Modulação de Emoção, Entonação e Inflecção (Entusiasmado, Consultivo,
 *   Acolhedor, Calmo, Natural) ajustando pitch, cadência e volume
 * - Normalização Conversacional: lê números, moedas (R$), datas, horas (24h),
 *   porcentagens (%) e substitui links e termos robóticos por falas orais
 * - Respiração Orgânica (Organic Breath): insere inspiração sutil e micro-pausas
 * - Filtro Acústico de Microfone de Celular (WhatsApp Mic Warmth & Presence)
 * =========================================================================
 */

class VoicePersonaService {
  constructor() {
    this.personas = {
      marcos: {
        id: 'marcos',
        name: 'Marcos — Consultor Executivo & Firme',
        shortName: 'Marcos',
        gender: 'masculino',
        badge: '👨‍💼 Firme / Executivo',
        description: 'Voz masculina grave, firme e segura. Transmite máxima autoridade, credibilidade e fechamento de contratos.',
        edgeVoice: 'pt-BR-AntonioNeural',
        fallbackVoice: 'pt-BR-AntonioNeural',
        openaiVoice: 'onyx',
        geminiVoice: 'Fenrir',
        defaultEmotion: 'consultivo',
        pitchOffset: '-2Hz',
        rateOffset: '-1%',
        volumeOffset: '+0%',
        recommendedNiches: ['advogados', 'corretor_imoveis', 'consorcio', 'carros', 'vendedores'],
        sampleText: 'Opa, tudo bem? Olha só, tava analisando aqui o seu caso e garanto que consigo te atender com total segurança e agilidade.'
      },
      lucas: {
        id: 'lucas',
        name: 'Lucas — Jovem Vendedor Dinâmico & Comercial',
        shortName: 'Lucas',
        gender: 'masculino',
        badge: '⚡ Dinâmico / Comercial',
        description: 'Voz masculina jovem, ágil e descontraída. Ritmo comercial de alta energia, sorriso na voz e persuasão imediata.',
        edgeVoice: 'en-US-BrianMultilingualNeural',
        fallbackVoice: 'pt-BR-AntonioNeural',
        openaiVoice: 'echo',
        geminiVoice: 'Puck',
        defaultEmotion: 'entusiasmado',
        pitchOffset: '+2Hz',
        rateOffset: '+3%',
        volumeOffset: '+2%',
        recommendedNiches: ['lanches', 'pizzas', 'academia', 'arena_esportiva', 'vendedores'],
        sampleText: 'Fala meu amigo! Beleza? Cara, vou fazer uma condição exclusiva pra você fechar hoje comigo no Pix, se liga só!'
      },
      rodrigo: {
        id: 'rodrigo',
        name: 'Rodrigo — Atendente Acolhedor & Empático',
        shortName: 'Rodrigo',
        gender: 'masculino',
        badge: '🤝 Caloroso / Empático',
        description: 'Voz masculina calorosa, paciente e amigável. Ideal para relacionamento próximo, suporte e alimentação.',
        edgeVoice: 'en-US-AndrewMultilingualNeural',
        fallbackVoice: 'pt-BR-AntonioNeural',
        openaiVoice: 'fable',
        geminiVoice: 'Charon',
        defaultEmotion: 'acolhedor',
        pitchOffset: '+0Hz',
        rateOffset: '-1%',
        volumeOffset: '+0%',
        recommendedNiches: ['sushi', 'marmitas', 'hospedagens', 'alugueis'],
        sampleText: 'Olá! Que bom falar com você. Tô à disposição pra te ajudar a escolher a melhor opção com todo carinho.'
      },
      camila: {
        id: 'camila',
        name: 'Camila — Atendente Acolhedora & Doce',
        shortName: 'Camila',
        gender: 'feminino',
        badge: '🌸 Acolhedora / Doce',
        description: 'Voz feminina suave, empática e atenciosa. Perfeita para estética, beleza, saúde e atendimento humanizado.',
        edgeVoice: 'pt-BR-FranciscaNeural',
        fallbackVoice: 'pt-BR-FranciscaNeural',
        openaiVoice: 'nova',
        geminiVoice: 'Kore',
        defaultEmotion: 'acolhedor',
        pitchOffset: '+1Hz',
        rateOffset: '-1%',
        volumeOffset: '-1%',
        recommendedNiches: ['nailsdesigns', 'leshes', 'marmitas', 'hospedagens', 'sushi'],
        sampleText: 'Oi, tudo bem? Que prazer te atender! Deixa eu te explicar com calma como a gente cuida de cada detalhe por aqui.'
      },
      juliana: {
        id: 'juliana',
        name: 'Juliana — Especialista Persuasiva & Profissional',
        shortName: 'Juliana',
        gender: 'feminino',
        badge: '👩‍💼 Confiante / Persuasiva',
        description: 'Voz feminina executiva, articulada e confiante. Passa firmeza técnica e clareza absoluta nas negociações.',
        edgeVoice: 'en-US-AvaMultilingualNeural',
        fallbackVoice: 'pt-BR-FranciscaNeural',
        openaiVoice: 'shimmer',
        geminiVoice: 'Aoede',
        defaultEmotion: 'consultivo',
        pitchOffset: '-1Hz',
        rateOffset: '+0%',
        volumeOffset: '+1%',
        recommendedNiches: ['advogados', 'corretor_imoveis', 'consorcio', 'carros', 'vendedores'],
        sampleText: 'Olá! Perfeito. Nós temos as soluções jurídicas e comerciais ideais pro seu perfil, com total transparência e resultado.'
      },
      thalita: {
        id: 'thalita',
        name: 'Thalita — Jovem Moderna & Espontânea',
        shortName: 'Thalita',
        gender: 'feminino',
        badge: '🚀 Jovem / Vibrante',
        description: 'Voz feminina jovem, moderna e espontânea. Conecta de forma autêntica com público conectado e dinâmico.',
        edgeVoice: 'pt-BR-ThalitaMultilingualNeural',
        fallbackVoice: 'pt-BR-ThalitaMultilingualNeural',
        openaiVoice: 'alloy',
        geminiVoice: 'Kore',
        defaultEmotion: 'entusiasmado',
        pitchOffset: '+2Hz',
        rateOffset: '+3%',
        volumeOffset: '+2%',
        recommendedNiches: ['nailsdesigns', 'leshes', 'academia', 'arena_esportiva', 'lanches'],
        sampleText: 'Oi gente, tudo bem? Olha só que novidade incrível que acabou de chegar pra você aproveitar hoje mesmo!'
      },
      larissa: {
        id: 'larissa',
        name: 'Larissa — Entusiasta & Comunicativa',
        shortName: 'Larissa',
        gender: 'feminino',
        badge: '✨ Expressiva / Comercial',
        description: 'Voz feminina clara, expressiva e envolvente. Excelente para vendas diretas, promoções e delivery ágil.',
        edgeVoice: 'en-US-EmmaMultilingualNeural',
        fallbackVoice: 'pt-BR-ThalitaMultilingualNeural',
        openaiVoice: 'nova',
        geminiVoice: 'Aoede',
        defaultEmotion: 'entusiasmado',
        pitchOffset: '+2Hz',
        rateOffset: '+2%',
        volumeOffset: '+2%',
        recommendedNiches: ['pizzas', 'lanches', 'vendedores', 'hospedagens'],
        sampleText: 'Oi! Já separei aqui a melhor oferta pra você. Se você quiser garantir com frete rápido, me dá um toque agora!'
      },
      duarte: {
        id: 'duarte',
        name: 'Duarte — Consultor Internacional (PT)',
        shortName: 'Duarte',
        gender: 'masculino',
        badge: '🏛️ Internacional / Nobre',
        description: 'Voz masculina formal com sotaque português europeu. Ideal para marcas premium e público seletivo.',
        edgeVoice: 'pt-PT-DuarteNeural',
        fallbackVoice: 'pt-BR-AntonioNeural',
        openaiVoice: 'onyx',
        geminiVoice: 'Fenrir',
        defaultEmotion: 'consultivo',
        pitchOffset: '+0Hz',
        rateOffset: '+0%',
        volumeOffset: '+0%',
        recommendedNiches: ['advogados', 'hospedagens', 'carros'],
        sampleText: 'Olá, com certeza. Estamos plenamente preparados para prestar o melhor serviço com elevado padrão de qualidade.'
      },
      raquel: {
        id: 'raquel',
        name: 'Raquel — Executiva Internacional (PT)',
        shortName: 'Raquel',
        gender: 'feminino',
        badge: '👑 Executiva / Nobre',
        description: 'Voz feminina distinta com sotaque português europeu. Ótima para consultoria e público refinado.',
        edgeVoice: 'pt-PT-RaquelNeural',
        fallbackVoice: 'pt-BR-FranciscaNeural',
        openaiVoice: 'shimmer',
        geminiVoice: 'Aoede',
        defaultEmotion: 'consultivo',
        pitchOffset: '+0Hz',
        rateOffset: '+0%',
        volumeOffset: '+0%',
        recommendedNiches: ['advogados', 'hospedagens', 'alugueis'],
        sampleText: 'Olá, seja muito bem-vindo. Terei todo o gosto em apresentar-lhe as melhores opções disponíveis para o seu projeto.'
      }
    };

    this.emotions = {
      entusiasmado: {
        id: 'entusiasmado',
        name: '⚡ Entusiasmado & Comercial',
        description: 'Alta energia, tom mais vivo e ritmo comercial para gerar empolgação e fechamento imediato.',
        pitchDeltaHz: 3,
        rateDeltaPercent: 4,
        volumeDeltaPercent: 2
      },
      consultivo: {
        id: 'consultivo',
        name: '🎯 Consultivo & Firme',
        description: 'Tom seguro, ritmo firme e postura de autoridade, eliminando desconfiança e ancorando valor.',
        pitchDeltaHz: -2,
        rateDeltaPercent: -1,
        volumeDeltaPercent: 0
      },
      acolhedor: {
        id: 'acolhedor',
        name: '🌸 Acolhedor & Empático',
        description: 'Tom doce, suave e atencioso, ideal para clínicas, suporte atencioso e estética.',
        pitchDeltaHz: 1,
        rateDeltaPercent: -2,
        volumeDeltaPercent: -1
      },
      calmo: {
        id: 'calmo',
        name: '🧘 Calmo & Didático',
        description: 'Ritmo compassado, pausas generosas e clareza didática para explicar processos e tirar dúvidas.',
        pitchDeltaHz: 0,
        rateDeltaPercent: -4,
        volumeDeltaPercent: 0
      },
      natural: {
        id: 'natural',
        name: '💬 Natural & Conversacional',
        description: 'Conversa espontânea de WhatsApp do dia a dia, sem formalidades exageradas.',
        pitchDeltaHz: 0,
        rateDeltaPercent: 0,
        volumeDeltaPercent: 0
      }
    };
  }

  /**
   * Retorna a lista completa de personas vocais
   */
  getPersonas() {
    return Object.values(this.personas);
  }

  /**
   * Retorna uma persona pelo identificador ou busca por aproximação
   */
  getPersona(idOrKey) {
    if (!idOrKey) return this.personas.marcos;
    const clean = String(idOrKey).toLowerCase().trim();
    if (this.personas[clean]) return this.personas[clean];

    // Busca por nome ou voz edge
    for (const p of Object.values(this.personas)) {
      if (p.shortName.toLowerCase() === clean || p.edgeVoice.toLowerCase() === clean) {
        return p;
      }
      if (clean.includes(p.shortName.toLowerCase())) {
        return p;
      }
    }

    // Heurísticas por gênero / palavras-chave
    if (clean.includes('antonio') || clean.includes('executiv') || clean.includes('firme')) return this.personas.marcos;
    if (clean.includes('lucas') || clean.includes('dinamic') || clean.includes('comercial')) return this.personas.lucas;
    if (clean.includes('rodrigo') || clean.includes('amigav') || clean.includes('caloroso')) return this.personas.rodrigo;
    if (clean.includes('francisca') || clean.includes('camila') || clean.includes('doce')) return this.personas.camila;
    if (clean.includes('juliana') || clean.includes('persuasiv') || clean.includes('advogad')) return this.personas.juliana;
    if (clean.includes('thalita') || clean.includes('jovem')) return this.personas.thalita;
    if (clean.includes('larissa') || clean.includes('entusiasta')) return this.personas.larissa;
    if (clean.includes('duarte') || clean.includes('portugal') || clean.includes('pt-pt-duarte')) return this.personas.duarte;
    if (clean.includes('raquel') || clean.includes('pt-pt-raquel')) return this.personas.raquel;

    if (clean.includes('mulher') || clean.includes('fem') || clean === 'f') return this.personas.camila;
    if (clean.includes('homem') || clean.includes('masc') || clean === 'm') return this.personas.marcos;

    return this.personas.marcos;
  }

  /**
   * Retorna os estilos emocionais disponíveis
   */
  getEmotions() {
    return Object.values(this.emotions);
  }

  getEmotion(emotionKey) {
    if (!emotionKey) return this.emotions.consultivo;
    const clean = String(emotionKey).toLowerCase().trim();
    return this.emotions[clean] || this.emotions.consultivo;
  }

  /**
   * Encontra a persona recomendada para um nicho
   */
  getPersonaForNiche(nicheKey) {
    if (!nicheKey) return this.personas.marcos;
    const clean = String(nicheKey).toLowerCase().trim();
    for (const p of Object.values(this.personas)) {
      if (p.recommendedNiches.includes(clean)) {
        return p;
      }
    }
    return this.personas.marcos;
  }

  /**
   * Resolve a configuração final de voz a partir de parâmetros mesclados
   */
  resolveVoiceConfig(options = {}) {
    let models = null;
    try {
      models = require('../db/models');
    } catch (_) {}

    const defaultPersonaKey = models ? models.getSetting('SALES_BOT_PERSONA', 'marcos') : 'marcos';
    const defaultVoiceName = models ? models.getSetting('SALES_BOT_VOICE', 'pt-BR-AntonioNeural') : 'pt-BR-AntonioNeural';
    const defaultEmotionKey = models ? models.getSetting('SALES_BOT_EMOTION', 'consultivo') : 'consultivo';
    const defaultOrganicBreath = models ? models.getSetting('SALES_BOT_ORGANIC_BREATH', 'true') !== 'false' : true;
    const defaultPhoneWarmth = models ? models.getSetting('SALES_BOT_PHONE_WARMTH', 'true') !== 'false' : true;

    const requestedPersona = options.persona || options.personaKey || (options.voice && !options.voice.includes('Neural') ? options.voice : null) || defaultPersonaKey;
    const persona = this.getPersona(requestedPersona);

    const requestedEmotion = options.emotion || persona.defaultEmotion || defaultEmotionKey;
    const emotion = this.getEmotion(requestedEmotion);

    // Calcula Rate final
    let baseRate = options.rate !== undefined && options.rate !== null ? options.rate : persona.rateOffset;
    let rateNum = parseInt(String(baseRate).replace('%', ''), 10);
    if (isNaN(rateNum)) rateNum = 0;
    rateNum += (emotion.rateDeltaPercent || 0);
    const finalRate = (rateNum >= 0 ? `+${rateNum}%` : `${rateNum}%`);

    // Calcula Pitch final
    let basePitch = options.pitch !== undefined && options.pitch !== null ? options.pitch : persona.pitchOffset;
    let pitchNum = parseInt(String(basePitch).replace('Hz', ''), 10);
    if (isNaN(pitchNum)) pitchNum = 0;
    pitchNum += (emotion.pitchDeltaHz || 0);
    const finalPitch = (pitchNum >= 0 ? `+${pitchNum}Hz` : `${pitchNum}Hz`);

    // Determina voz exata do Edge TTS
    const edgeVoice = options.edgeVoice || (options.voice && options.voice.includes('Neural') ? options.voice : persona.edgeVoice) || defaultVoiceName;

    return {
      persona,
      emotion,
      edgeVoice,
      fallbackVoice: persona.fallbackVoice || 'pt-BR-AntonioNeural',
      openaiVoice: persona.openaiVoice || 'alloy',
      geminiVoice: persona.geminiVoice || 'Fenrir',
      rate: finalRate,
      pitch: finalPitch,
      volume: options.volume || '+0%',
      organicBreath: options.breath !== undefined ? Boolean(options.breath) : (options.organicBreath !== undefined ? Boolean(options.organicBreath) : defaultOrganicBreath),
      phoneWarmth: options.warmth !== undefined ? Boolean(options.warmth) : (options.phoneWarmth !== undefined ? Boolean(options.phoneWarmth) : defaultPhoneWarmth)
    };
  }

  /**
   * Converte números cardinais simples para português falado natural
   */
  numberToWordsPt(num) {
    const n = Math.floor(Math.abs(Number(num)));
    if (isNaN(n)) return String(num);
    if (n === 0) return 'zero';

    const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
      'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

    if (n === 100) return 'cem';
    if (n < 20) return units[n];
    if (n < 100) {
      const u = n % 10;
      return tens[Math.floor(n / 10)] + (u > 0 ? ` e ${units[u]}` : '');
    }
    if (n < 1000) {
      const rem = n % 100;
      const h = Math.floor(n / 100);
      return hundreds[h] + (rem > 0 ? ` e ${this.numberToWordsPt(rem)}` : '');
    }
    if (n < 1000000) {
      const thousands = Math.floor(n / 1000);
      const rem = n % 1000;
      const thStr = thousands === 1 ? 'mil' : `${this.numberToWordsPt(thousands)} mil`;
      if (rem === 0) return thStr;
      if (rem < 100 || rem % 100 === 0) return `${thStr} e ${this.numberToWordsPt(rem)}`;
      return `${thStr}, ${this.numberToWordsPt(rem)}`;
    }
    return String(num);
  }

  /**
   * Normaliza texto para fala humana ultra fluida (Conversational Spoken Portuguese):
   * - Transforma moedas: R$ 69,90 -> sessenta e nove e noventa
   * - Transforma números soltos e porcentagens
   * - Remove URLs e substitui por menção oral ao texto abaixo
   * - Transforma abreviações comuns da internet em palavras pronunciadas
   * - Converte 24/7, 24h, Pix, etc.
   * - Insere pontuação oral e micro-pausas estratégicas para respiração
   */
  humanizeTextForSpeech(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText
      // Remove tags de formatação técnica
      .replace(/\[[aá]udio\s*:\s*([\s\S]*?)\]/gi, '$1')
      .replace(/(?:^|\n)(?:🤖\s*)?\*?RESPOSTA(?:\s+DA\s+IA)?(?:\s*\[[^\]\n]*\])?\*?:?\s*(?:\n+|$)/gi, '\n')
      .replace(/(?:^|\n)(?:(?:master\s+bot|bot(?:\s+tenant[^\n\)]*\)?)?|atendente|assistente|consultor|vendedor)\s+)?respondeu\s+via\s+[^\n]*(?:\n+|$)/gi, '\n')
      .replace(/(?:^|\n)(?:via\s+(?:groq|gemini|openai|deepseek|claude|qwen|llama|flowith)[^\n]*(?:\n+|$))/gi, '\n')
      // Remove tags HTML e emojis
      .replace(/<[^>]*>/g, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      // Remove marcadores markdown
      .replace(/[*_~`#]/g, '');

    // 1. Substitui links e URLs por fala conversacional (ninguém fala 'http ponto barra barra' no áudio!)
    text = text.replace(/https?:\/\/\S+/gi, 'o link que eu vou te mandar aqui no texto');

    // 2. Normaliza moedas em Reais (R$)
    text = text.replace(/R\$\s*(\d{1,3}(?:\.\d{3})*),(\d{2})/g, (_, intPart, centsPart) => {
      const cleanInt = parseInt(intPart.replace(/\./g, ''), 10);
      const cleanCents = parseInt(centsPart, 10);
      const intWords = this.numberToWordsPt(cleanInt);
      if (cleanCents === 0) {
        return `${intWords} reais`;
      }
      const centsWords = this.numberToWordsPt(cleanCents);
      return `${intWords} e ${centsWords}`;
    });

    text = text.replace(/R\$\s*(\d{1,3}(?:\.\d{3})*)/g, (_, intPart) => {
      const cleanInt = parseInt(intPart.replace(/\./g, ''), 10);
      const intWords = this.numberToWordsPt(cleanInt);
      return `${intWords} reais`;
    });

    // 3. Normaliza porcentagens (%)
    text = text.replace(/(\d+)%/g, (_, num) => {
      const w = this.numberToWordsPt(num);
      return `${w} por cento`;
    });

    // 4. Normaliza horários e disponibilidade
    text = text
      .replace(/\b24\/7\b/gi, 'vinte e quatro horas por dia')
      .replace(/\b24h\b/gi, 'vinte e quatro horas')
      .replace(/\b100%\b/gi, 'cem por cento')
      .replace(/\b(seg|ter|qua|qui|sex|s[aá]b|dom)\b/gi, (m) => {
        const d = m.toLowerCase();
        if (d === 'seg') return 'segunda';
        if (d === 'ter') return 'terça';
        if (d === 'qua') return 'quarta';
        if (d === 'qui') return 'quinta';
        if (d === 'sex') return 'sexta';
        if (d === 'sab' || d === 'sáb') return 'sábado';
        if (d === 'dom') return 'domingo';
        return m;
      });

    // 5. Normaliza termos comuns de internet e abreviações
    text = text
      .replace(/\bvc\b/gi, 'você')
      .replace(/\bvcs\b/gi, 'vocês')
      .replace(/\btbm?\b/gi, 'também')
      .replace(/\bpq\b/gi, 'porque')
      .replace(/\bblz\b/gi, 'beleza')
      .replace(/\bwhats\b/gi, 'WhatsApp')
      .replace(/\bzap\b/gi, 'WhatsApp')
      .replace(/\bmsg\b/gi, 'mensagem')
      .replace(/\bmsgs\b/gi, 'mensagens')
      .replace(/\bobs:?\b/gi, 'olha,')
      .replace(/\bp\/\b/gi, 'para')
      .replace(/\bq\b/gi, 'que')
      .replace(/\btd\b/gi, 'tudo')
      .replace(/\btmj\b/gi, 'tamo junto')
      .replace(/\badd\b/gi, 'adiciona');

    // 6. Normaliza telefones longos no texto (ex: 5548999998888 -> 'quarenta e oito, nove, nove nove...')
    text = text.replace(/\b(?:\+?55)?\s*(\d{2})\s*9?(\d{4})(\d{4})\b/g, '$1 $2 $3');

    // 7. Modulação de pontuação oral (cadência natural de fala com micro-pausas)
    // Transforma pontos seguidos de frases em quebras respiratórias naturais
    text = text
      .replace(/([.!?])\s+([A-ZÀ-Ú])/g, '$1... $2')
      .replace(/\n{2,}/g, '... ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return text;
  }

  sanitizeTextForSpeech(rawText) {
    return this.humanizeTextForSpeech(rawText);
  }

  /**
   * Constrói a diretriz de prompt para IA quando um áudio falado for planejado ou gerado.
   * Alinha o LLM durante a geração do texto para saber que o conteúdo dentro de [AUDIO: ...]
   * será convertido e reproduzido como fala humana real no WhatsApp.
   */
  buildAudioPromptDirective(params = {}) {
    const {
      personaKey = null,
      emotionKey = null,
      nicheKey = null,
      wantsAudio = false,
      isMasterBot = true,
      tenantName = null
    } = (params || {});

    const persona = this.getPersona(personaKey || (nicheKey ? this.getPersonaForNiche(nicheKey).id : 'marcos'));
    const emotion = this.getEmotion(emotionKey || persona.defaultEmotion || 'consultivo');

    const businessContext = isMasterBot
      ? 'soluções do PayBot (automação de vendas, bots de grupos e software sob medida)'
      : `produtos e atendimento da loja ${tenantName || 'nossa loja'}`;

    const mandatoryBanner = wantsAudio
      ? '🚨 ATENÇÃO PRIORITÁRIA: O CLIENTE ENVIOU ÁUDIO OU PREFERE CONVERSAR POR ÁUDIO! Você DEVE incluir uma nota de voz falada [AUDIO: ...] na sua resposta.'
      : '💡 NOTA DE VOZ ESTRATÉGICA: Quando o cliente estiver conhecendo as soluções, tirando dúvidas de valores ou pronto para fechar, inclua uma nota de voz gravada em [AUDIO: ...] para humanizar o atendimento e reter atenção total.';

    return `\n🎙️ DIRETRIZ SUPREMA DE REDAÇÃO PARA ÁUDIO FALADO ([AUDIO: ...]):
${mandatoryBanner}
ATENÇÃO MÁXIMA AO GERADOR DE TEXTO:
O trecho delimitado dentro da tag [AUDIO: ...] NÃO SERÁ LIDO COM OS OLHOS PELO CLIENTE!
ELE SERÁ CONVERTIDO E ENVIADO COMO UMA NOTA DE VOZ GRAVADA NO WHATSAPP (ÁUDIO PTT) COM A SUA PERSONA: *${persona.name}* (Tom Emocional: *${emotion.name}*).

Por ser uma gravação falada que o cliente escuta pelo alto-falante do celular, a redação DENTRO de [AUDIO: ...] DEVE SEGUIR AS LEIS DA ORALIDADE HUMANA:
1. PENSE EXCLUSIVAMENTE NO OUVIDO: Escreva exatamente como uma pessoa real fala ao telefone ou manda um áudio casual no WhatsApp para um cliente ou parceiro comercial.
2. ZERO ELEMENTOS VISUAIS NO ÁUDIO: É TERMINANTEMENTE PROIBIDO colocar asteriscos (*negrito*), emojis, marcadores de tópicos (• ou -), listas ou links dentro de [AUDIO: ...]. O cliente NÃO VAI LER nada disso, ele VAI OUVIR! Emojis e asteriscos lidos pelo áudio soam robóticos e falsos.
3. VALORES, MOEDAS E PORCENTAGENS POR EXTENSO ORAL: Em vez de símbolos numéricos, escreva a fonética falada natural (ex: escreva "quarenta e nove e noventa" ou "quatrocentos e noventa e sete reais" em vez de "R$ 497,00"; escreva "quinze por cento" em vez de "15%").
4. LINKS E PIX FICAM NO TEXTO ABAIXO: Nunca tente soletrar URLs ou chaves Pix no áudio. Fale no áudio: "vou te mandar o link aqui no texto logo abaixo" ou "já separei o código Pix aqui embaixo no WhatsApp pra você". O link clicável, catálogo e código Pix DEVEM vir em balão de texto separado por \\n\\n FORA de [AUDIO: ...].
5. CONECTIVOS ORAIS & HESITAÇÕES HUMANAS AUTÊNTICAS: Inicie e conduza a fala com conectivos naturais de conversa humana: "Fala fulano!", "Olha só,", "Então,", "Deixa eu te explicar certinho como funciona:", "Pois é,", "Cara,", "O negócio é o seguinte:".
6. CADÊNCIA RESPIRATÓRIA (PONTUAÇÃO ORAL): Use vírgulas e reticências (...) para criar as pausas naturais onde a pessoa puxa o ar e reflete ao falar. Evite frases excessivamente longas que fiquem sem fôlego.
7. DURAÇÃO IDEAL DE UMA NOTA DE VOZ: Entre 25 a 55 segundos de fala (cerca de 40 a 90 palavras). Tempo ideal para reter atenção total, gerar conexão humana e conduzir para o fechamento.
8. PERSONALIDADE E ENTONAÇÃO: Fale com a postura da sua persona (${persona.description}), transmitindo empatia, segurança inabalável e prestatividade para ${businessContext}.\n\n`;
  }
}

module.exports = new VoicePersonaService();

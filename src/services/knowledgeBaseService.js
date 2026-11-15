const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');

/**
 * =========================================================================
 * 🧠 KNOWLEDGE BASE SERVICE - NÚCLEO COGNITIVO & PSICOLOGIA DE VENDAS 🧠
 * =========================================================================
 * Integra e destila a pasta "base-conhecimento" para o cérebro do Bot:
 *
 * 1. Alex Hormozi ($100M Offers & $100M Money Models):
 *    - Equação de Valor (Sonho x Certeza / Tempo x Esforço)
 *    - Oferta Irrecusável Grand Slam, Bônus Empilhados e Reversão Total de Risco
 *
 * 2. Jordan Belfort (Straight Line Persuasion / Os Segredos do Lobo):
 *    - Os Três Dezenas (Certeza no Produto, no Vendedor e na Empresa)
 *    - Loopings de Fechamento na Linha Reta e Escudo contra Desvios
 *
 * 3. Chris Voss (Negocie Como Se Sua Vida Dependesse Disso / FBI):
 *    - Empatia Tática, Espelhamento (Mirroring) e Rotulagem Emocional (Labeling)
 *    - Perguntas Calibradas ("Como nós resolvemos isso?") e Perguntas com Foco no "Não"
 *
 * 4. Robert Cialdini (As Armas da Persuasão):
 *    - Reciprocidade, Compromisso/Coerência, Prova Social, Autoridade, Afeição e Escassez
 *
 * 5. Eugene Schwartz (Breakthrough Advertising):
 *    - Os 5 Níveis de Consciência do Lead e Mecanismo Único de Solução
 *
 * 6. Neil Rackham (SPIN Selling):
 *    - Perguntas de Situação, Problema, Implicação e Necessidade de Solução
 *
 * 7. Russell Brunson (DotCom, Expert & Traffic Secrets):
 *    - Estrutura Gancho-História-Oferta (Hook-Story-Offer) e Ponte da Epifania
 *
 * 8. Michael Masterson & Agora Publishing (Agora's Big Black Book & Ready Fire Aim):
 *    - The Rule of One (Uma grande ideia, uma grande emoção, uma ação inevitável)
 *
 * 9. Dale Carnegie, Robert Greene, James Clear, Naval Ravikant, Warren Buffett:
 *    - Rapport genuíno, hábitos de consistência, alavancagem tecnológica e liderança
 * =========================================================================
 */

class KnowledgeBaseService {
  constructor() {
    this.baseFolder = config.knowledgeBasePath || path.join(__dirname, '..', '..', 'base-conhecimento');
    this.catalog = [];
    this.catalogMap = new Map();
    this.isInitialized = false;

    // Métricas
    this.totalBooks = 0;
    this.totalBytes = 0;

    // Matriz de Obras e Princípios Destilados da Biblioteca
    this.masterFrameworks = {
      // 1. OFERTAS IRRECUSÁVEIS & MONETIZAÇÃO
      alex_hormozi: {
        author: 'Alex Hormozi',
        books: ['$100M Offers', '$100M Money Models'],
        category: 'OFFERS_MONETIZATION',
        corePrinciples: [
          'EQUAÇÃO DE VALOR: Valor = (Resultado dos Sonhos x Certeza Percebida) / (Tempo de Espera x Esforço e Sacrifício). Para maximizar a conversão, mostre como as automações reduzem o tempo de atendimento e o esforço do cliente.',
          'OFERTA IRRECUSÁVEL: Apresente soluções com alta percepção de valor e baixo atrito adaptadas ao que o cliente procura (automação comercial no WhatsApp, proteção de grupos, aplicativos sob medida ou itens da vitrine).',
          'REVERSÃO DE RISCO (GARANTIA BLINDADA): Elimine o medo do cliente assumindo o risco. Se ele não gostar em 7 dias, devolução integral incondicional.',
          'ANCORAGEM DE PREÇO: Compare o investimento na automação com o custo de horas manuais perdidas ou funcionários dedicados. O sistema se paga com o próprio ganho de tempo e vendas.',
          'BÔNUS & BENEFÍCIOS: Apresente os diferenciais da solução (vitrine integrada, painel de controle, suporte dedicado e configuração assistida).'
        ]
      },

      // 2. FECHAMENTO DE VENDAS & LINHA RETA
      jordan_belfort: {
        author: 'Jordan Belfort',
        books: ['Os Segredos do Lobo', 'Straight Line System'],
        category: 'CLOSING_SALES',
        corePrinciples: [
          'OS TRÊS DEZENAS (THE 3 TENS): O cliente só compra quando atinge nota 10/10 em: 1) No Produto (PayBot resolve); 2) No Vendedor (confiança e humildade); 3) Na Empresa/Garantia (segurança e suporte).',
          'STRAIGHT LINE (LINHA RETA): Toda venda é idêntica. Você conduz o cliente do ponto A (abertura despretensiosa) ao ponto B (pagamento/fechamento). Não se perca em conversas paralelas sem objetivo.',
          'LOOPING DE FECHAMENTO: Quando o cliente der uma objeção frouxa ("vou pensar", "depois vejo"), nunca discuta. Diga: "Com certeza, entendo você perfeitamente! Mas deixa eu te fazer uma pergunta rápida: você gostou da ideia de ter as vendas caindo no Pix no automático enquanto você cuida do restante do negócio?" Resgate a certeza no produto antes de pedir a compra novamente.',
          'TOM DE VOZ NO WHATSAPP: Confiança absoluta sem arrogância. Entusiasmo contido e profissionalismo.'
        ]
      },

      // 3. NEGOCIAÇÃO TÁTICA & EMPATIA
      chris_voss: {
        author: 'Chris Voss (Ex-Negociador Chefe do FBI)',
        books: ['Negocie Como Se Sua Vida Dependesse Disso', 'Manual de Persuasão do FBI'],
        category: 'TACTICAL_NEGOTIATION',
        corePrinciples: [
          'EMPATIA TÁTICA: Reconhecer a perspectiva do interlocutor sem necessariamente concordar com ela para desarmar a resistência.',
          'ESPELHAMENTO (MIRRORING): Repetir as últimas 1 a 3 palavras críticas que o cliente disse com tom interrogativo para fazê-lo se aprofundar (Ex: Cliente: "Achei meio puxado agora..." -> Bot: "Puxado agora?...").',
          'ROTULAGEM DE EMOÇÕES (LABELING): Nomear a dor ou receio invisível do cliente. "Parece que você está com receio de não saber configurar ou não ter tempo de mexer...", "Parece que você já teve problemas com ferramentas que não funcionaram antes...".',
          'PERGUNTAS CALIBRADAS: Perguntas abertas começando com "Como" ou "O que": "Como nós podemos estruturar isso para ficar leve no seu caixa este mês?", "O que falta para você colocar isso para rodar hoje?".',
          'PERGUNTA FOCADA NO NÃO: As pessoas sentem segurança dizendo "Não". Em vez de "Você quer fechar?", pergunte: "Seria uma má ideia a gente deixar isso ativo na sua operação hoje para você já testar?".'
        ]
      },

      // 4. GATILHOS MENTAIS & INFLUÊNCIA
      robert_cialdini: {
        author: 'Robert Cialdini',
        books: ['As Armas da Persuasão'],
        category: 'INFLUENCE_PSYCHOLOGY',
        corePrinciples: [
          'RECIPROCIDADE: Entregue valor genuíno, insights sobre a operação do lead e links úteis antes de pedir qualquer compra.',
          'COMPROMISSO E COERÊNCIA: Faça o lead concordar com pequenas afirmações antes de pedir o fechamento ("Você concorda que responder clientes na hora aumenta as vendas?").',
          'PROVA SOCIAL: Mencione que centenas de lojistas e infoprodutores já usam o PayBot diariamente para não perder vendas na madrugada.',
          'AUTORIDADE: Postura segura de consultor sênior de automação comercial e sistemas sob medida.',
          'ESCASSEZ REAL: Licença com suporte direto e implantação assistida limitada à capacidade de suporte da equipe.'
        ]
      },

      // 5. NÍVEIS DE CONSCIÊNCIA & COPYWRITING
      eugene_schwartz: {
        author: 'Eugene M. Schwartz',
        books: ['Breakthrough Advertising'],
        category: 'COPYWRITING_AWARENESS',
        corePrinciples: [
          'NÍVEL 1 (INCONSCIENTE): O cliente não sabe que tem um problema. Conte uma história sobre como negócios perdem 30% a 50% dos clientes simplesmente demorando mais de 5 minutos para responder no WhatsApp.',
          'NÍVEL 2 (CONSCIENTE DO PROBLEMA): Sabe que perde vendas no WhatsApp e gasta horas respondendo a mesma coisa. Conecte com a dor dele com empatia.',
          'NÍVEL 3 (CONSCIENTE DA SOLUÇÃO): Sabe que precisa de um bot, mas teme bots burros ou robóticos. Apresente o MECANISMO ÚNICO: IA humanizada em áudio e texto + Pix com split de mensagens realistas.',
          'NÍVEL 4 (CONSCIENTE DO PRODUTO): Já conhece o PayBot. Demonstre os benefícios e a facilidade de uso.',
          'NÍVEL 5 (TOTALMENTE CONSCIENTE): Já quer comprar. Dê o valor claro da solução escolhida (conforme o plano ou produto de interesse), ofereça o Pix imediato ou o link da vitrine e elimine qualquer atrito.'
        ]
      },

      // 6. VENDAS CONSULTIVAS B2B & SPIN
      neil_rackham: {
        author: 'Neil Rackham',
        books: ['SPIN Selling'],
        category: 'CONSULTATIVE_SALES',
        corePrinciples: [
          'SITUAÇÃO: Entenda o nicho e tamanho do negócio do cliente ("O que você vende hoje e por onde os clientes mais te chamam?").',
          'PROBLEMA: Identifique o gargalo ("Você consegue responder todo mundo na hora ou às vezes acumula muita mensagem sem resposta?").',
          'IMPLICAÇÃO: Faça o cliente sentir o custo financeiro da ineficiência ("Quando alguém chama de noite ou de fim de semana e você demora 2 horas para ver, você acha que ele espera ou vai no concorrente que respondeu na hora?").',
          'NECESSIDADE DE SOLUÇÃO: Deixe o cliente verbalizar o valor ("Se você tivesse um sistema atendendo na hora, mandando o catálogo e gerando o Pix enquanto você dorme, quanto a mais você faturaria por mês?").'
        ]
      },

      // 7. STORYTELLING & FUNIS DE ALTA CONVERSÃO
      russell_brunson: {
        author: 'Russell Brunson',
        books: ['DotCom Secrets', 'Expert Secrets', 'Traffic Secrets'],
        category: 'FUNNELS_STORYTELLING',
        corePrinciples: [
          'HOOK, STORY, OFFER: Toda mensagem persuasiva tem: 1) Um gancho que prende a atenção (1º balão); 2) Uma ponte ou história curta de identificação (2º balão); 3) Uma oferta irresistível ou chamado para ação leve (3º balão).',
          'A PONTE DA EPIFANIA: Em vez de empurrar o produto com argumentos técnicos, faça o cliente ter a mesma realização que os maiores empresários tiveram: "Vender não é ficar respondendo mensagem o dia todo; é ter um sistema trabalhando para você".'
        ]
      },

      // 8. RESPOSTA DIRETA & AGORA PUBLISHING
      michael_masterson: {
        author: 'Michael Masterson & Agora Series',
        books: ["Agora's Big Black Book", 'Ready, Fire, Aim: Zero to $100 Million'],
        category: 'DIRECT_RESPONSE',
        corePrinciples: [
          'THE RULE OF ONE: Cada conversa deve focar em UMA única dor principal, UMA grande promessa e UM próximo passo claro (gerar o Pix ou visitar a vitrine). Nunca sobrecarregue com 5 opções ao mesmo tempo.',
          'READY, FIRE, AIM: Na fase inicial de um negócio ou operação, o foco absoluto deve ser VENDER e validar a oferta no mercado sem perfeccionismo paralisante.'
        ]
      },

      // 9. RAPPORT & PSICOLOGIA SOCIAL
      dale_carnegie: {
        author: 'Dale Carnegie & Nicholas Boothman',
        books: ['Como Fazer Amigos e Influenciar Pessoas', 'Como Convencer Alguém em 90 Segundos'],
        category: 'HUMAN_RAPPORT',
        corePrinciples: [
          'INTERESSE GENUÍNO: As pessoas não se importam com o seu bot até saberem o quanto você se importa com o negócio delas. Faça perguntas sobre a operação delas.',
          'VALIDAÇÃO E ELOGIO SINCERO: "Sensacional a sua iniciativa com essa loja!", "Muito bacana o nicho que você atua!".',
          'NOME DO CLIENTE: O som do próprio nome é a palavra mais doce em qualquer idioma. Use o primeiro nome do cliente com naturalidade.'
        ]
      },

      // 10. MINDSET DE ALAVANCAGEM & RIQUEZA
      naval_ravikant: {
        author: 'Naval Ravikant & Warren Buffett',
        books: ['O Almanaque de Naval Ravikant', 'A Bola de Neve', 'Trabalhe 4 Horas por Semana'],
        category: 'LEVERAGE_MINDSET',
        corePrinciples: [
          'ALAVANCAGEM SEM PERMISSÃO: Código e mídia são as maiores formas de alavancagem do mundo moderno. O bot é um exército de vendedores trabalhando sem salário, sem cansaço e sem folga.',
          'EFEITO BOLA DE NEVE: Pequenas automações implementadas hoje geram tempo livre para o empresário focar em tráfego e produto, gerando crescimento exponencial.'
        ]
      }
    };

    // Inicializa catálogo automaticamente
    this.initCatalog();
  }

  /**
   * Inicializa e indexa todos os arquivos da pasta base-conhecimento
   */
  initCatalog() {
    try {
      if (!fs.existsSync(this.baseFolder)) {
        console.warn(`[Base de Conhecimento ⚠️] Pasta não encontrada em: ${this.baseFolder}`);
        return;
      }

      const files = fs.readdirSync(this.baseFolder);
      this.catalog = [];
      this.catalogMap.clear();
      let totalBytes = 0;

      for (const fileName of files) {
        const fullPath = path.join(this.baseFolder, fileName);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            totalBytes += stats.size;
            const ext = path.extname(fileName).toLowerCase();
            const baseName = path.basename(fileName, ext);

            // Mapeia categoria e autor com base no nome do arquivo
            const meta = this._detectBookMeta(fileName);

            const docEntry = {
              id: `doc_${this.catalog.length + 1}`,
              fileName,
              title: meta.title || baseName,
              author: meta.author || 'Mestre em Vendas/Persuasão',
              category: meta.category || 'GERAL_VENDAS',
              extension: ext,
              sizeBytes: stats.size,
              sizeMb: (stats.size / (1024 * 1024)).toFixed(2),
              path: fullPath
            };

            this.catalog.push(docEntry);
            this.catalogMap.set(fileName.toLowerCase(), docEntry);
          }
        } catch (_) {}
      }

      this.totalBooks = this.catalog.length;
      this.totalBytes = totalBytes;
      this.isInitialized = true;

      console.log(`[Base de Conhecimento 🧠] Núcleo Cognitivo carregado com sucesso! ${this.totalBooks} obras-primas indexadas (${(this.totalBytes / (1024 * 1024)).toFixed(1)} MB)`);
    } catch (err) {
      console.error('[Base de Conhecimento ❌] Erro ao carregar diretório:', err.message);
    }
  }

  /**
   * Helper para detectar autor e temática pelo nome do arquivo
   */
  _detectBookMeta(fileName) {
    const fn = fileName.toLowerCase();

    if (/hormozi|100m\s*offers|100m\s*money/i.test(fn)) {
      return { author: 'Alex Hormozi', category: 'OFFERS_MONETIZATION', title: 'Grand Slam Offers & Money Models' };
    }
    if (/belfort|lobo\s*de\s*wall|segredos\s*do\s*lobo|stratton/i.test(fn)) {
      return { author: 'Jordan Belfort', category: 'CLOSING_SALES', title: 'Straight Line Persuasion' };
    }
    if (/voss|negocie\s*como|manual.*fbi/i.test(fn)) {
      return { author: 'Chris Voss (FBI)', category: 'TACTICAL_NEGOTIATION', title: 'Never Split the Difference / Empatia Tática' };
    }
    if (/cialdini|armas\s*da\s*persuas/i.test(fn)) {
      return { author: 'Robert Cialdini', category: 'INFLUENCE_PSYCHOLOGY', title: 'As Armas da Persuasão' };
    }
    if (/schwartz|breakthrough\s*advertising/i.test(fn)) {
      return { author: 'Eugene Schwartz', category: 'COPYWRITING_AWARENESS', title: 'Breakthrough Advertising' };
    }
    if (/brunson|expert\s*secrets|dotcom|traffic\s*secrets/i.test(fn)) {
      return { author: 'Russell Brunson', category: 'FUNNELS_STORYTELLING', title: 'Secret Trilogy (DotCom/Expert/Traffic)' };
    }
    if (/rackham|spin\s*selling/i.test(fn)) {
      return { author: 'Neil Rackham', category: 'CONSULTATIVE_SALES', title: 'SPIN Selling' };
    }
    if (/agora|masterson|ready\s*fire/i.test(fn)) {
      return { author: 'Michael Masterson / Agora', category: 'DIRECT_RESPONSE', title: "Agora's Big Black Book & Ready Fire Aim" };
    }
    if (/carnegie|como\s*fazer\s*amigos/i.test(fn)) {
      return { author: 'Dale Carnegie', category: 'HUMAN_RAPPORT', title: 'Como Fazer Amigos e Influenciar Pessoas' };
    }
    if (/naval|almanaque\s*de\s*naval/i.test(fn)) {
      return { author: 'Naval Ravikant', category: 'LEVERAGE_MINDSET', title: 'O Almanaque de Naval Ravikant' };
    }
    if (/clear|habitos\s*atomicos/i.test(fn)) {
      return { author: 'James Clear', category: 'HIGH_PERFORMANCE', title: 'Hábitos Atômicos' };
    }
    if (/greene|48\s*leis|arte\s*da\s*sedu/i.test(fn)) {
      return { author: 'Robert Greene', category: 'POWER_STRATEGY', title: 'As 48 Leis do Poder & Arte da Sedução' };
    }
    if (/copywriting|paulo\s*maccedo|gustavo\s*ferreira|jim\s*edwards/i.test(fn)) {
      return { author: 'Mestres do Copywriting', category: 'COPYWRITING', title: 'Copywriting de Alta Conversão' };
    }
    if (/vsl|7\s*di-gitos/i.test(fn)) {
      return { author: 'Especialista VSL', category: 'VSL_SCRIPTING', title: 'O Guia Definitivo para VSL de 7 Dígitos' };
    }

    return { author: 'Referência Mundial', category: 'VENDAS_E_NEGOCIOS', title: fileName };
  }

  /**
   * Retorna resumo estatístico da base de conhecimento
   */
  getStats() {
    if (!this.isInitialized) {
      this.initCatalog();
    }

    return {
      totalBooks: this.totalBooks,
      totalBytes: this.totalBytes,
      totalMb: (this.totalBytes / (1024 * 1024)).toFixed(1),
      baseFolder: this.baseFolder,
      masterFrameworksCount: Object.keys(this.masterFrameworks).length,
      status: this.totalBooks > 0 ? 'READY' : 'EMPTY'
    };
  }

  /**
   * Busca livros e referências no catálogo por palavra-chave
   */
  searchBooks(query) {
    if (!query) return this.catalog.slice(0, 20);
    const q = query.toLowerCase().trim();
    return this.catalog.filter(doc => {
      return doc.fileName.toLowerCase().includes(q) ||
        doc.author.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.title.toLowerCase().includes(q);
    });
  }

  /**
   * =========================================================================
   * 🎯 NÚCLEO COGNITIVO RAG: PLAYBOOK CONTEXTUAL PARA O PROMPT DO BOT
   * =========================================================================
   * Gera dinamicamente as diretrizes táticas exatas para o contexto do lead,
   * combinando os livros mais relevantes para a situação atual, os padrões
   * vivos aprendidos para o nicho em questão e calibração para o modelo ativo:
   */
  getContextualPlaybook({ text = '', stage = 'CONSCIENCIA', objection = null, intent = null, niche = null, tone = null, model = null, provider = null } = {}) {
    const lower = String(text || '').toLowerCase();
    const activeDirectives = [];

    // --- 0. CENÁRIO: DESINTERESSE REAL / RECUSA ELEGANTE (Jeb Blount & Chris Voss) ---
    if (stage === 'PERDIDO' || objection === 'SEM_INTERESSE' || intent === 'DISINTEREST' || /(?:n[aã]o\s+quero|n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+me\s+interessa|n[aã]o\s+preciso|n[aã]o\s+vou\s+comprar|n[aã]o\s+vou\s+querer|valeu\s+mas\s+n[aã]o|obrigad[oa]\s+mas\s+n[aã]o|t[oô]\s+de\s+boa)/i.test(lower)) {
      activeDirectives.push({
        source: 'Jeb Blount (Fanatical Prospecting) & Chris Voss (Never Split the Difference)',
        technique: 'RESPEITO AO "NÃO" & DESQUALIFICAÇÃO ELEGANTE COM PORTA ABERTA',
        guideline:
          '1. ACEITE O "NÃO" IMEDIATAMENTE: Quando o lead expressa desinteresse ou recusa, isso NÃO é uma objeção contornável de preço ou prazo. Forçar a venda aqui destrói a confiança e causa bloqueio no WhatsApp.\n' +
          '2. DESARME TOTAL: Zero insistência, zero argumentos de venda ("mas o sistema se paga"), zero envio de Pix ou áudios promocionais.\n' +
          '3. ENCERRAMENTO CORDIAL: Agradeça o tempo e a atenção do contato com simpatia e maturidade, deixando a porta aberta para o futuro com elegância e leveza.'
      });
      return `\n${activeDirectives.map((d, idx) => `📌 TÁTICA #${idx + 1} [${d.source} - ${d.technique}]:\n${d.guideline}`).join('\n\n')}\n`;
    }

    // --- 1. CENÁRIO: OBJEÇÃO DE PREÇO / TÁ CARO / DINHEIRO ---
    if (objection === 'PRECO' || intent === 'PRICE_QUERY' || /(?:caro|muito caro|salgado|sem grana|sem dinheiro|desconto|abaixar|menor pre[cç]o|puxado)/i.test(lower)) {
      activeDirectives.push({
        source: 'Alex Hormozi ($100M Offers) & Chris Voss (FBI)',
        technique: 'EQUAÇÃO DE VALOR + PERGUNTA CALIBRADA DE PREÇO + DEMONSTRAÇÃO VISUAL',
        guideline:
          '1. ANCORAGEM & FLEXIBILIDADE: Se o cliente achar o investimento alto, apresente alternativas mais acessíveis (como o plano mensal de entrada R$ 69,90 ou planos de grupo a partir de R$ 49,90) e lembre que o sistema se paga com o tempo economizado.\n' +
          '2. RETENÇÃO E DEMONSTRAÇÃO: Não se contenha no fechamento! Envie áudio explicativo caloroso [AUDIO: ...] + imagem do painel [IMAGEM: paybot|Painel de Controle e Vendas Automáticas] + escopo claro com garantia incondicional.\n' +
          '3. ROTULAGEM DE VOSS: "Entendo perfeitamente, parece que o timing financeiro tá apertado este mês."\n' +
          '4. PERGUNTA FOCADA NO NÃO: "Seria uma má ideia você começar rodando com um plano mais enxuto para ver na prática o resultado antes de dar um passo maior?"'
      });
    }

    // --- 2. CENÁRIO: HESITAÇÃO / VOU PENSAR / DEPOIS EU VEJO ---
    if (objection === 'VOU_PENSAR' || /(?:vou pensar|depois eu vejo|mais tarde|semana que vem|vou ver com|falar com meu s[oó]cio|depois te chamo)/i.test(lower)) {
      activeDirectives.push({
        source: 'Jordan Belfort (Straight Line) & Chris Voss',
        technique: 'LOOPING DE FECHAMENTO + EMPATIA TÁTICA',
        guideline:
          '1. NUNCA discuta e NUNCA pressione de forma agressiva.\n' +
          '2. VALIDAÇÃO: "Claro, com certeza! Pensa com calma sim, sem pressa alguma."\n' +
          '3. RESGATE DE CERTEZA DE BELFORT: "Só uma curiosidade sincera: da ideia de ter um bot atendendo seus clientes no automático e gerando Pix 24h por dia, o que você mais achou interessante pro seu negócio?"\n' +
          '4. Deixe a porta aberta com elegância enviando o link da vitrine para ele salvar.'
      });
    }

    // --- 3. CENÁRIO: DESCONFIANÇA / GOLPE / É SEGURO / TEM GARANTIA ---
    if (objection === 'CONFIANCA_GARANTIA' || intent === 'TRUST_AND_GUARANTEE' || /(?:garantia|seguro|confi[aá]vel|golpe|medo|devolve|reembolso)/i.test(lower)) {
      activeDirectives.push({
        source: 'Alex Hormozi (Risk Reversal) & Robert Cialdini (Autoridade & Prova)',
        technique: 'REVERSÃO TOTAL DE RISCO + GARANTIA INCONDICIONAL + MULTIMÍDIA DE IMPACTO',
        guideline:
          '1. GARANTIA BLINDADA: Reafirme com total tranquilidade que o cliente possui 7 dias de garantia incondicional legal. Se não gostar por qualquer motivo, o reembolso é feito na hora.\n' +
          '2. SUPORTE DIRETO: O suporte para configurar os produtos e colocar para rodar é feito diretamente com a equipe aqui no WhatsApp.\n' +
          '3. TRINCA DE SEGURANÇA: Use nota de voz [AUDIO: ...] com tom firme e calmo + imagem de garantia [IMAGEM: garantia|Garantia Blindada de 7 Dias] para eliminar 100% das dúvidas do lead.'
      });
    }

    // --- 4. CENÁRIO: CONTATO CURIOSO / COMO FUNCIONA / INÍCIO DE CONVERSA ---
    if (stage === 'CONSCIENCIA' || intent === 'HOW_IT_WORKS' || intent === 'GREETING' || /(?:como funciona|como [eé]|me explica|do que se trata)/i.test(lower)) {
      activeDirectives.push({
        source: 'Neil Rackham (SPIN) & Jordan Belfort (Straight Line & Certeza)',
        technique: 'APROFUNDAMENTO COM RETENÇÃO (ÁUDIO + IMAGEM + ESCOPO TANGÍVEL)',
        guideline:
          '1. NÃO SE CONTER: No momento em que o cliente pede detalhes ou quer saber como funciona, mostre autoridade máxima imediata.\n' +
          '2. ENVIE ÁUDIO [AUDIO: ...]: Explicação envolvente e humana da solução sem enrolação.\n' +
          '3. ENVIE DEMONSTRAÇÃO [IMAGEM: bot_vendas|Demonstração do Fluxo Automatizado]: Tangibilize a entrega na hora.\n' +
          '4. DIAGNÓSTICO E ESCOPO: Apresente o escopo claro dos entregáveis e faça pergunta calibrada de fechamento sobre a operação dele.'
      });
    }

    // --- 5. CENÁRIO: INTENÇÃO DE COMPRA / LINK / FECHAMENTO ---
    if (stage === 'FECHAMENTO' || intent === 'BUY_INTENT' || intent === 'PAYMENT_PIX' || /(?:quero comprar|manda o link|manda o pix|passa o link|vou querer|comprar agora)/i.test(lower)) {
      activeDirectives.push({
        source: 'Russell Brunson & Michael Masterson (The Rule of One) & Alex Hormozi',
        technique: 'FECHAMENTO DEFINITIVO (ÁUDIO DE BOAS-VINDAS + RESUMO + CTA PIX)',
        guideline:
          '1. ZERO ENROLAÇÃO & MÁXIMA ENERGIA: O cliente está na hora de fechar. Envie áudio caloroso [AUDIO: ...] parabenizando pela decisão e explicando a liberação imediata.\n' +
          '2. ESCOPO DO PEDIDO: Resumo conciso dos itens entregues (acesso vitalício/anual, painel, suporte e garantia 7 dias).\n' +
          '3. CTA DIRETO: Envie o código Pix Copia e Cola ou link de checkout com orientação do próximo passo.'
      });
    }

    // --- 6. CENÁRIO: AUDITORIA DE SITE / PAGESPEED / SEO / LENTIDÃO ---
    if (/(?:pagespeed|lighthouse|site|loja|e-commerce|lento|velocidade|carregamento|seo|posicionamento|google)/i.test(lower)) {
      activeDirectives.push({
        source: 'Neil Rackham (SPIN Selling) & Alex Hormozi (Value Equation)',
        technique: 'DIAGNÓSTICO TÉCNICO COMO ALAVANCA DE VALOR (PAGESPEED + CORE WEB VITALS)',
        guideline:
          '1. DIAGNÓSTICO IMEDIATO: Se o cliente enviar o link do site ou reclamar de lentidão, ofereça rodar o raio-x do Google PageSpeed e Core Web Vitals na hora.\n' +
          '2. TRADUÇÃO DE DADOS EM DINHEIRO: Mostre que lentidão no mobile derruba 20% das vendas por segundo de espera.\n' +
          '3. SOLUÇÃO PRONTA: Apresente o serviço de Otimização PageSpeed 90+ & Core Web Vitals (R$ 800 - R$ 1.400) com escopo de compressão WebP, scripts e Cloudflare com garantia incondicional de 7 dias.\n' +
          '4. MULTIMÍDIA: Envie áudio [AUDIO: ...] + imagem demonstrativa [IMAGEM: site_portal | ...] para prender a atenção do lead.'
      });
    }

    // Framework Fundamental Sempre Ativo:
    const baseCore =
      `🧠 DIRETRIZES DA BASE DE CONHECIMENTO COGNITIVA (65+ Obras de Vendas, Copy e Negociação Ativas):\n` +
      `- Postura Humana: Casual, brasileiro, despretensioso (Dale Carnegie / Nicholas Boothman).\n` +
      `- Valor Irrecusável: Destaque o benefício concreto no dia a dia do cliente (Alex Hormozi).\n` +
      `- Fechamento Seguro: Responda as dúvidas e conduza suavemente com perguntas abertas (Chris Voss / Jordan Belfort).\n` +
      `- Geração Alinhada para Áudios ([AUDIO: ...]): Quando planejar trecho, indagação ou pitch em áudio, lembre-se na geração que o texto dentro de [AUDIO: ...] SERÁ REPRODUZIDO COMO VOZ FALADA (WhatsApp PTT). Escreva 100% oral, com cadência respiratória, zero asteriscos, zero emojis e zero links no áudio.\n`;

    const tacticalSections = activeDirectives.map((d, idx) => {
      const techHeader = d.technique ? ` - ${d.technique}` : '';
      return `📌 TÁTICA #${idx + 1} [${d.source}${techHeader}]:\n${d.guideline}`;
    }).join('\n\n');

    // 7. INJEÇÃO DE APRENDIZADO COLETIVO DO NICHO
    let nicheLearningsSection = '';
    if (niche) {
      try {
        const nicheModularService = require('./nicheModularService');
        const nicheData = nicheModularService.getNiche(niche);
        if (nicheData) {
          const patterns = models.getNichePatterns(nicheData.key, null, 3);
          if (patterns && patterns.length > 0) {
            const patternLines = patterns.map(p => `  • [${p.pattern_type}]: "${p.canonical_response.slice(0, 160)}" (Validação: ${p.success_count}x por ${p.tested_models?.join(', ') || 'IA'})`);
            nicheLearningsSection = `\n🎯 APRENDIZADO VIVO DO NÚCLEO DE INTELIGÊNCIA [NICHO: ${nicheData.name.toUpperCase()}]:\n` +
              `Este nicho já acumulou aprendizados práticos com múltiplos modelos neurais. Utilize as abordagens comprovadas abaixo:\n` +
              patternLines.join('\n') + '\n';
          }
        }
      } catch (_) {}
    }

    // 8. CALIBRAÇÃO NEURAL DO MODELO ATIVO
    let modelCalibrationSection = '';
    if (provider || model) {
      modelCalibrationSection = `\n⚡ CALIBRAÇÃO DO NÚCLEO PARA O MODELO ATIVO [PROVEDOR: ${(provider || 'IA').toUpperCase()} | MODELO: ${model || 'default'}]:\n` +
        `- Responda estritamente no formato de WhatsApp: sem introduções genéricas, sem cabeçalhos e com máxima empatia brasileira.\n` +
        `- Aplique os princípios ativos acima com foco na conversão e fechamento humanizado do nicho.\n`;
    }

    let result = baseCore;
    if (tacticalSections) result += '\n' + tacticalSections;
    if (nicheLearningsSection) result += '\n' + nicheLearningsSection;
    if (modelCalibrationSection) result += '\n' + modelCalibrationSection;

    return result.trim() + '\n';
  }

  /**
   * =========================================================================
   * 🔄 ALIMENTAÇÃO DO NÚCLEO: REGISTRO DE APRENDIZADO DE CADA INTERAÇÃO
   * =========================================================================
   * Qualquer nicho ou modelo ativo alimenta o cérebro central com a pergunta,
   * a resposta gerada, a intenção, a objeção superada e sinais de conversão.
   */
  feedFromInteraction(data = {}) {
    try {
      const {
        tenantId = 1,
        niche = 'vendedores',
        interaction_tone = 'consultivo',
        provider = 'gemini',
        model = 'default',
        leadPhone = '',
        userInput = '',
        botResponse = '',
        intent = null,
        objection = null,
        buyingStage = 'DESCOBERTA',
        conversionSignal = 0,
        source = 'whatsapp'
      } = data;

      let detectedConversion = conversionSignal ? 1 : 0;
      if (!detectedConversion && userInput) {
        // Detecta sinais fortes de conversão e intenção de fechamento
        if (/(?:manda o pix|passa o pix|vou pagar|fechado|quero comprar|onde pago|vou querer|pode fechar|manda o link de pagamento|chave pix)/i.test(userInput)) {
          detectedConversion = 1;
        }
      }

      // Normaliza o nicho
      let cleanNiche = 'vendedores';
      try {
        const nicheModularService = require('./nicheModularService');
        cleanNiche = nicheModularService.getNiche(niche)?.key || 'vendedores';
      } catch (_) {
        cleanNiche = String(niche || 'vendedores').toLowerCase().trim();
      }

      // 1. Grava no histórico geral de aprendizados
      const saved = models.recordIntelligenceLearning({
        tenant_id: tenantId,
        niche: cleanNiche,
        interaction_tone,
        ai_provider: provider,
        ai_model: model,
        lead_phone: leadPhone,
        user_input: userInput,
        bot_response: botResponse,
        detected_intent: intent,
        detected_objection: objection,
        resolved_objection: (objection && botResponse && botResponse.length > 20) ? 1 : 0,
        buying_stage: buyingStage,
        conversion_signal: detectedConversion,
        feedback_score: detectedConversion ? 4.5 : 1.0,
        learned_insight: `Interação no nicho ${cleanNiche} processada via ${provider}/${model}`,
        source
      });

      // 2. Se houve reversão de objeção ou sinal de fechamento, destila como padrão canônico
      if (detectedConversion && botResponse) {
        models.upsertNichePattern({
          niche: cleanNiche,
          pattern_type: 'WINNING_PITCH',
          trigger_topic: intent || 'FECHAMENTO',
          canonical_response: botResponse,
          model: `${provider}/${model}`,
          confidence: 0.95
        });
      } else if (objection && botResponse) {
        models.upsertNichePattern({
          niche: cleanNiche,
          pattern_type: 'OBJECTION_REVERSAL',
          trigger_topic: objection,
          canonical_response: botResponse,
          model: `${provider}/${model}`,
          confidence: 0.88
        });
      }

      console.log(`[Núcleo de Inteligência 🧠 Aprendizado] Nicho: ${cleanNiche} | Modelo: ${provider}/${model} alimentou o cérebro central.`);
      return saved;
    } catch (err) {
      console.warn('[KnowledgeBase ⚠️ feedFromInteraction]:', err.message);
      return null;
    }
  }

  /**
   * =========================================================================
   * 💰 ALIMENTAÇÃO POR CONVERSÃO: VENDA OU PEDIDO FECHADO (#ORD_)
   * =========================================================================
   * Reforça o aprendizado de toda a cadeia de atendimento que resultou em venda.
   */
  feedFromOrder({ order = {}, tenantId = 1, leadPhone = null, niche = null }) {
    try {
      const phone = leadPhone || order.platform_user_id || order.customer_phone;
      const orderId = order.merchant_trade_no || order.trade_no || order.id;
      const orderAmount = order.amount || order.price_brl || 0;

      const affected = models.markLearningConversion(phone, orderId, orderAmount, niche);
      console.log(`[Núcleo de Inteligência 💰 Venda Aprovada] Pedido #${orderId} (R$ ${orderAmount}) reforçou a rede neural (${affected} turnos promovidos a alta conversão).`);
      return { success: true, order_id: orderId, affected_turns: affected };
    } catch (err) {
      console.warn('[KnowledgeBase ⚠️ feedFromOrder]:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Retorna métricas do núcleo de inteligência (aprendizados, nichos ativos e modelos)
   */
  getCoreMetrics() {
    try {
      return models.getIntelligenceStats();
    } catch (err) {
      return { total_learnings: 0, total_conversions: 0, total_patterns: 0 };
    }
  }

  /**
   * Retorna aprendizados e padrões específicos de um nicho
   */
  getNicheInsights(nicheKey) {
    try {
      const clean = String(nicheKey || 'vendedores').toLowerCase().trim();
      const patterns = models.getNichePatterns(clean, null, 10);
      const recentLearnings = models.getIntelligenceLearnings({ niche: clean, limit: 10 });
      return {
        niche: clean,
        total_patterns: patterns.length,
        patterns,
        recent_learnings: recentLearnings
      };
    } catch (err) {
      return { niche: nicheKey, patterns: [], recent_learnings: [] };
    }
  }
}

const knowledgeBaseInstance = new KnowledgeBaseService();
module.exports = knowledgeBaseInstance;

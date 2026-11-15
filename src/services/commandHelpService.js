/**
 * =========================================================================
 * 📚 COMMAND HELP & TUTORIAL SERVICE (!ajuda <comando>)
 * =========================================================================
 * Sistema educativo interativo que ensina o funcionamento de cada comando
 * do bot com explicações claras em Português do Brasil, sintaxe, atalhos,
 * permissões e múltiplos exemplos práticos copiáveis e testáveis.
 * =========================================================================
 */

class CommandHelpService {
  constructor() {
    this.commandsDatabase = [
      // ==========================================
      // 1. DOWNLOADS E MÍDIA
      // ==========================================
      {
        id: 'play',
        name: 'Downloader de Músicas MP3',
        category: '📥 Downloads & Músicas',
        aliases: ['play', 'musica', 'audio', 'mp3', 'ytmp3', 'playh', 'plays'],
        description: 'Baixa músicas do YouTube em formato MP3 de alta fidelidade com capa oficial, nome do artista e título correto.',
        syntax: '!play <nome da música ou link do YouTube> [H|S]',
        naturalExamples: [
          'toca a música Bohemian Rhapsody Queen',
          'baixa o áudio desse vídeo https://youtu.be/dQw4w9WgXcQ',
          'baixa a música Evidências do Chitãozinho e Xororó'
        ],
        commandExamples: [
          '!play Bohemian Rhapsody Queen',
          '!play https://youtu.be/dQw4w9WgXcQ',
          '!play Viva La Vida Coldplay H'
        ],
        options: 'Adicione *H* no final para Áudio em Alta Qualidade (HQ) ou *S* para Padrão.',
        permission: '👥 Todos os membros',
        tips: 'Para receber a música sem compressão com arte de capa em alta definição, use *!playdoc*.'
      },
      {
        id: 'playdoc',
        name: 'Música em Documento HQ',
        category: '📥 Downloads & Músicas',
        aliases: ['playdoc', 'musicadoc', 'audiodoc', 'mp3doc', 'ytmp3doc'],
        description: 'Baixa a música do YouTube e a envia como DOCUMENTO sem nenhuma perda de compressão do WhatsApp, com capa em alta resolução.',
        syntax: '!playdoc <nome da música ou link do YouTube>',
        naturalExamples: [
          'baixa em documento esse link https://youtu.be/dQw4w9WgXcQ',
          'manda como doc a música Hotel California Eagles'
        ],
        commandExamples: [
          '!playdoc Hotel California Eagles',
          '!playdoc https://youtu.be/dQw4w9WgXcQ'
        ],
        permission: '👥 Todos os membros',
        tips: 'Ideal para quem deseja guardar o arquivo de áudio no celular com máxima pureza sonora.'
      },
      {
        id: 'video',
        name: 'Downloader de Vídeos YouTube (MP4)',
        category: '📥 Downloads & Músicas',
        aliases: ['video', 'videoh', 'videos', 'ytmp4', 'play2', 'mp4'],
        description: 'Baixa vídeos completos do YouTube em formato MP4 sem o limite de 50MB do WhatsApp comum.',
        syntax: '!video <link do YouTube ou nome do vídeo> [H|S]',
        naturalExamples: [
          'baixa esse vídeo pra mim https://youtube.com/watch?v=123456',
          'baixa o vídeo do youtube https://youtu.be/dQw4w9WgXcQ'
        ],
        commandExamples: [
          '!video https://youtu.be/dQw4w9WgXcQ',
          '!video podcast inteligência ltda resumo H'
        ],
        options: '*H* = Alta resolução (720p/1080p) | *S* = Resolução padrão (360p mais leve)',
        permission: '👥 Todos os membros',
        tips: 'Se você estiver no grupo e mandar apenas o link de vídeo com "baixa esse vídeo", o bot baixa na hora!'
      },
      {
        id: 'lista',
        name: 'Pesquisa com Lista de Músicas',
        category: '📥 Downloads & Músicas',
        aliases: ['lista', 'search', 'pesquisar', 'buscar'],
        description: 'Pesquisa no YouTube e retorna os 20 melhores resultados numerados para você escolher com apenas um toque.',
        syntax: '!lista <termo de busca>',
        naturalExamples: [
          'pesquisa uma lista de músicas do Legião Urbana',
          'busca músicas do Jorge e Mateus'
        ],
        commandExamples: [
          '!lista Legião Urbana',
          '!lista Sertanejo 2026',
          '!lista Melhores do Rock anos 80'
        ],
        permission: '👥 Todos os membros',
        tips: 'Após a lista ser enviada, você pode digitar apenas *1* ou *A1* para baixar o áudio, ou *V1* para baixar o vídeo!'
      },
      {
        id: 'ig',
        name: 'Downloader do Instagram (Reels & Posts)',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['ig', 'instagram', 'reels', 'insta'],
        description: 'Baixa vídeos do Instagram Reels, publicações do feed (fotos e vídeos) em alta resolução e sem marcas d\'água.',
        syntax: '!ig <link da publicação ou reel>',
        naturalExamples: [
          'baixa esse reels do insta https://www.instagram.com/reel/C123456789/',
          'salva esse post do instagram https://instagram.com/p/...'
        ],
        commandExamples: [
          '!ig https://www.instagram.com/reel/C123456789/',
          '!ig https://instagram.com/p/XYZ987/'
        ],
        permission: '👥 Todos os membros',
        tips: 'Você pode citar qualquer link do Instagram e escrever "baixa esse reels" que o bot processa direto!'
      },
      {
        id: 'allstories',
        name: 'Downloader de Stories do Instagram',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['allstories', 'stories', 'todosstories'],
        description: 'Baixa todos os stories ativos e disponíveis das últimas 24 horas de qualquer perfil público do Instagram.',
        syntax: '!allstories <@usuario ou nome do perfil>',
        naturalExamples: [
          'baixa todos os stories do perfil @neymarjr',
          'pega os stories do insta @lojaoficial'
        ],
        commandExamples: [
          '!allstories @neymarjr',
          '!allstories lojaoficial'
        ],
        permission: '👥 Todos os membros',
        tips: 'O perfil precisa ser público para que os stories possam ser coletados.'
      },
      {
        id: 'scrapinsta',
        name: 'Raio-X & Stalk de Perfil do Instagram',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['scrapinsta', 'stalkinsta', 'spyinsta'],
        description: 'Gera um laudo completo de inteligência sobre um perfil: seguidores, engajamento, média de likes, biografia e análise.',
        syntax: '!scrapinsta <@usuario>',
        naturalExamples: [
          'stalkea o perfil @lojaoficial',
          'faz um raio-x do insta @fulano'
        ],
        commandExamples: [
          '!scrapinsta @lojaoficial',
          '!scrapinsta @carlos_tech'
        ],
        permission: '👥 Todos os membros',
        tips: 'Ótimo para checar a reputação de lojas, fornecedores e influenciadores antes de fechar negócios.'
      },
      {
        id: 'tiktok',
        name: 'Downloader do TikTok',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['tiktok', 'tt'],
        description: 'Baixa vídeos do TikTok com som original, qualidade máxima e sem nenhuma marca d\'água flutuante.',
        syntax: '!tiktok <link do vídeo do TikTok>',
        naturalExamples: [
          'baixa esse tiktok https://vm.tiktok.com/ZM8x/',
          'pega esse vídeo do tiktok https://www.tiktok.com/@user/video/...'
        ],
        commandExamples: [
          '!tiktok https://vm.tiktok.com/ZM8x/',
          '!tiktok https://www.tiktok.com/@criador/video/7123456789'
        ],
        permission: '👥 Todos os membros',
        tips: 'Suporta tanto links encurtados (vm.tiktok.com) quanto links completos de desktop.'
      },
      {
        id: 'fb',
        name: 'Downloader do Facebook',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['fb', 'facebook'],
        description: 'Baixa vídeos do feed, grupos públicos, reels e transmissões do Facebook em alta definição.',
        syntax: '!fb <link do vídeo do Facebook>',
        naturalExamples: [
          'baixa esse vídeo do facebook https://fb.watch/xyz/',
          'faz download desse post do face https://www.facebook.com/watch/?v=...'
        ],
        commandExamples: [
          '!fb https://fb.watch/xyz123/',
          '!fb https://www.facebook.com/watch/?v=123456789'
        ],
        permission: '👥 Todos os membros',
        tips: 'Funciona com links no formato fb.watch e facebook.com/watch.'
      },
      {
        id: 'twitter',
        name: 'Downloader do Twitter / X',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['twitter', 'x', 'twdl'],
        description: 'Baixa vídeos, memes e animações em MP4 direto de posts do Twitter / X.',
        syntax: '!twitter <link do post do Twitter/X>',
        naturalExamples: [
          'baixa esse tweet https://x.com/user/status/...',
          'salva esse vídeo do twitter https://twitter.com/user/status/...'
        ],
        commandExamples: [
          '!twitter https://x.com/noticias/status/123456789',
          '!x https://twitter.com/tecnologia/status/987654321'
        ],
        permission: '👥 Todos os membros',
        tips: 'Você pode usar tanto *!twitter* quanto *!x* para disparar o download.'
      },
      {
        id: 'download',
        name: 'Downloader Universal da Web',
        category: '📥 Downloads & Redes Sociais',
        aliases: ['download', 'dl', 'baixar'],
        description: 'Downloader genérico para baixar mídias e arquivos de links diretos da internet.',
        syntax: '!download <link>',
        naturalExamples: [
          'baixa esse link https://site.com/video.mp4',
          'faz download desse arquivo https://...'
        ],
        commandExamples: [
          '!download https://exemplo.com/conteudo.mp4'
        ],
        permission: '👥 Todos os membros'
      },

      // ==========================================
      // 2. FIGURINHAS & EFEITOS
      // ==========================================
      {
        id: 's',
        name: 'Criador de Figurinhas (Sticker)',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['s', 'sticker', 'fig', 'figurinha'],
        description: 'Transforma qualquer foto, vídeo curto (até 10s) ou GIF em figurinha oficial para WhatsApp com corte otimizado.',
        syntax: '!s (com foto/vídeo anexado ou respondendo à mídia)',
        naturalExamples: [
          'faz uma figurinha dessa foto',
          'transforma esse vídeo em sticker',
          'cria figurinha disso aqui'
        ],
        commandExamples: [
          'Envie uma foto com a legenda: *!s*',
          'Responda a uma foto ou vídeo com: *!s*'
        ],
        permission: '👥 Todos os membros',
        tips: 'Se você responder a uma foto escrevendo simplesmente "faz figurinha", o bot cria a figurinha automaticamente!'
      },
      {
        id: 'toimg',
        name: 'Figurinha para Foto/Imagem',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['toimg', 'paraimg'],
        description: 'Converte uma figurinha estática do WhatsApp de volta em imagem JPEG de alta qualidade para sua galeria.',
        syntax: '!toimg (respondendo a uma figurinha)',
        naturalExamples: [
          'passa pra foto essa figurinha',
          'converte esse sticker em imagem',
          'manda a foto dessa figurinha'
        ],
        commandExamples: [
          'Responda a qualquer figurinha enviando: *!toimg*'
        ],
        permission: '👥 Todos os membros',
        tips: 'Excelente para salvar aquela foto rara ou meme que te mandaram apenas em formato de figurinha.'
      },
      {
        id: 'tomp3',
        name: 'Conversor de Vídeo para Áudio MP3',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['tomp3', 'toaudio', 'paramp3', 'extrairaudio'],
        description: 'Extrai a faixa de áudio de qualquer vídeo ou mensagem de voz respondida e entrega um arquivo de áudio MP3 pronto para ouvir.',
        syntax: '!tomp3 (respondendo a um vídeo ou áudio)',
        naturalExamples: [
          'tira o áudio desse vídeo',
          'converte esse vídeo pra mp3',
          'extrai o som dessa gravação'
        ],
        commandExamples: [
          'Responda a um vídeo com: *!tomp3*'
        ],
        permission: '👥 Todos os membros',
        tips: 'Útil para extrair músicas de videoclipes ou guardar áudios longos em arquivo MP3.'
      },
      {
        id: 'ttp',
        name: 'Texto para Figurinha Estática',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['ttp'],
        description: 'Cria uma figurinha estática elegante com fundo transparente a partir de qualquer texto que você digitar.',
        syntax: '!ttp <seu texto>',
        naturalExamples: [
          'faz uma figurinha escrita "Bom dia galera"',
          'escreve "Parabéns" em figurinha'
        ],
        commandExamples: [
          '!ttp Bom dia grupo!',
          '!ttp Parabéns amigo!',
          '!ttp Fechado com sucesso!'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'attp',
        name: 'Texto para Figurinha Animada',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['attp', 'attp2'],
        description: 'Cria uma figurinha animada com texto em efeito arco-íris piscante multicolorido.',
        syntax: '!attp <seu texto>',
        naturalExamples: [
          'faz uma figurinha animada com o texto "Top Demais"',
          'cria um sticker colorido escrito "Sextou"'
        ],
        commandExamples: [
          '!attp Sextou!',
          '!attp Parabéns!',
          '!attp É Tetra!'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'qc',
        name: 'Figurinha Quote Chat',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['qc', 'quotechat', 'citacao'],
        description: 'Gera uma figurinha personalizada imitando o balão de fala oficial escuro do WhatsApp com sua foto de perfil e nome.',
        syntax: '!qc <frase>',
        naturalExamples: [
          'faz um quote chat da frase "Pensando positivo sempre"',
          'cria figurinha de citação com meu perfil'
        ],
        commandExamples: [
          '!qc Quem não arrisca, não petisca!',
          '!qc O sucesso é a soma de pequenos esforços.'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'brat',
        name: 'Figurinha Estilo Brat (Charli XCX)',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['brat', 'charli'],
        description: 'Cria a famosa figurinha verde-limão viral do álbum Brat da cantora Charli XCX com tipografia autêntica e desfoque.',
        syntax: '!brat <texto>',
        commandExamples: [
          '!brat 365 party girl',
          '!brat focado no objetivo',
          '!brat cafe e trabalho'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'emojimix',
        name: 'Fusão de Emojis (Emoji Kitchen)',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['emojimix', 'mix', 'fusao', 'emojikitchen'],
        description: 'Funde dois emojis diferentes gerando uma figurinha exclusiva através da tecnologia oficial Google Kitchen.',
        syntax: '!emojimix <emoji1>+<emoji2>',
        naturalExamples: [
          'mistura o emoji de gato com óculos',
          'faz fusão do emoji de coração com fogo'
        ],
        commandExamples: [
          '!emojimix 🐱+🕶️',
          '!emojimix ❤️+🔥',
          '!emojimix 🤖+🚀'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'tts',
        name: 'Texto para Voz Neural (Áudio Falado)',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['tts', 'voz', 'falar'],
        description: 'Transforma qualquer texto em uma nota de voz humanizada gravada pelo robô e enviada como áudio de WhatsApp (PTT).',
        syntax: '!tts <texto para ser falado>',
        naturalExamples: [
          'fala pra mim "Seja muito bem-vindo ao grupo"',
          'manda um áudio falando "Atenção a todos"'
        ],
        commandExamples: [
          '!tts Seja muito bem-vindo ao nosso grupo oficial!',
          '!tts Atenção pessoal, reunião remarcada para as 15 horas.'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'h',
        name: 'Upgrade de Qualidade para HD',
        category: '🎨 Figurinhas & Mídia',
        aliases: ['h', 'hd', 'hq', 'alta', 'high'],
        description: 'Faz o upgrade imediato de qualquer música ou vídeo para a qualidade máxima em alta resolução.',
        syntax: 'Responda a uma mídia ou digite *!h*',
        naturalExamples: [
          'manda em alta qualidade',
          'baixa esse vídeo em hd',
          'manda em alta resolução'
        ],
        commandExamples: [
          'Responda a um vídeo ou áudio do bot com: *!h*',
          'Responda à mídia com: *HD*'
        ],
        permission: '👥 Todos os membros'
      },

      // ==========================================
      // 3. INTELIGÊNCIA ARTIFICIAL & AUDITORIAS
      // ==========================================
      {
        id: 'ia',
        name: 'Inteligência Artificial Integrada',
        category: '🤖 Inteligência Artificial',
        aliases: ['ia', 'gpt', 'ai', 'gemini'],
        description: 'Converse com a inteligência artificial de última geração. Responde dúvidas, escreve redações, cria códigos, formata tabelas e gera ideias completas sem cortar o texto.',
        syntax: '!ia <sua pergunta ou dúvida>',
        naturalExamples: [
          'ia como criar um plano de negócios?',
          'pergunta pra ia quais os melhores investimentos em 2026',
          'ia me explica o que é inteligência artificial em termos simples'
        ],
        commandExamples: [
          '!ia como criar uma rotina produtiva de estudos?',
          '!ia escreva um roteiro de vídeo para o Instagram vendendo consultoria',
          '!ia crie uma função em JavaScript para validar CPF'
        ],
        permission: '👥 Todos os membros',
        tips: 'A IA agora fornece respostas longas e estruturadas sem interromper ou cortar a explicação no meio!'
      },
      {
        id: 'imagine',
        name: 'Gerador de Imagens por IA',
        category: '🤖 Inteligência Artificial',
        aliases: ['imagine', 'dalle', 'desenhe'],
        description: 'Cria ilustrações artísticas, paisagens e designs ultrarrealistas a partir da descrição que você digitar.',
        syntax: '!imagine <descrição da imagem>',
        commandExamples: [
          '!imagine um robô futurista em uma cidade neon cyberpunk em 4k',
          '!imagine um café aconchegante em Paris em um dia chuvoso',
          '!imagine um leão dourado com armadura medieval'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'traduzir',
        name: 'Tradutor Instantâneo Multilíngue',
        category: '🤖 Inteligência Artificial',
        aliases: ['traduzir', 'translate'],
        description: 'Traduz qualquer texto instantaneamente para dezenas de idiomas com detecção automática do texto original.',
        syntax: '!traduzir <código_idioma> <texto>',
        commandExamples: [
          '!traduzir en Bom dia amigo, como você está?',
          '!traduzir es Quanto custa este produto com frete?',
          '!traduzir fr Muito obrigado pela sua ajuda'
        ],
        options: 'Idiomas comuns: en (Inglês), es (Espanhol), fr (Francês), de (Alemão), it (Italiano), ja (Japonês).',
        permission: '👥 Todos os membros'
      },
      {
        id: 'pagespeed',
        name: 'Raio-X de Sites & Google PageSpeed',
        category: '🌐 Ferramentas Técnicas',
        aliases: ['pagespeed', 'analisarsite', 'auditoriasite', 'seo', 'lighthouse', 'auditar'],
        description: 'Auditoria técnica completa de qualquer site: notas do Google PageSpeed, Core Web Vitals, SEO on-page, certificado SSL, detecção de pixels (Meta, GA4, TikTok) e botão de WhatsApp.',
        syntax: '!pagespeed <link ou domínio do site>',
        naturalExamples: [
          'analisa o site https://meusite.com.br pra ver se tá lento',
          'roda um pagespeed em minhaloja.com.br',
          'como tá a velocidade e o seo do site https://...'
        ],
        commandExamples: [
          '!pagespeed https://meudominio.com.br',
          '!pagespeed www.lojavirtual.com.br',
          '!analisarsite meusite.com'
        ],
        permission: '👥 Todos os membros',
        tips: 'Gera diagnóstico profissional completo ideal para enviar a clientes e fechar serviços de otimização.'
      },
      {
        id: 'imei',
        name: 'Consulta de IMEI & Celular Seguro',
        category: '🌐 Ferramentas Técnicas',
        aliases: ['imei', 'consultarimei', 'celularseguro', 'checarimei', 'bncr'],
        description: 'Consulta a procedência de qualquer celular contra o Banco Nacional de Celulares com Restrição (BNCR) do Ministério da Justiça (Gov.br) e Anatel.',
        syntax: '!imei <número_imei_14_ou_15_digitos>',
        naturalExamples: [
          'consulta o imei 352099001761481 pra ver se tá bloqueado',
          'checa a procedência desse imei 352099001761481',
          'vê se esse celular tem queixa de roubo imei 352099001761481'
        ],
        commandExamples: [
          '!imei 352099001761481',
          '!celularseguro 353272091234567'
        ],
        permission: '👥 Todos os membros',
        tips: 'Valida o dígito verificador matemático pelo Algoritmo de Luhn e aponta se o aparelho tem bloqueio ou impedimento.'
      },
      {
        id: 'ssweb',
        name: 'Print de Página da Internet (Screenshot)',
        category: '🌐 Ferramentas Técnicas',
        aliases: ['ssweb', 'printweb', 'captura'],
        description: 'Captura um print em alta resolução de qualquer página da internet e envia diretamente no chat como imagem.',
        syntax: '!ssweb <url da página>',
        commandExamples: [
          '!ssweb https://g1.globo.com',
          '!ssweb https://github.com'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'tourl',
        name: 'Conversor de Mídia para Link CDN',
        category: '🌐 Ferramentas Técnicas',
        aliases: ['tourl', 'upload'],
        description: 'Converte qualquer foto, vídeo, áudio ou documento respondido em um link público direto na internet.',
        syntax: '!tourl (respondendo à mídia)',
        commandExamples: [
          'Responda a uma foto ou documento com: *!tourl*'
        ],
        permission: '👥 Todos os membros'
      },

      // ==========================================
      // 4. MODERAÇÃO E GESTÃO DE GRUPOS (ADMINS)
      // ==========================================
      {
        id: 'd',
        name: 'Apagar Mensagem Citada',
        category: '🛡️ Moderação de Grupos',
        aliases: ['d', 'del', 'delete', 'apagar', 'deletar'],
        description: 'Apaga qualquer mensagem enviada no grupo para todos os participantes de forma silenciosa e instantânea.',
        syntax: '!d (respondendo à mensagem que deseja apagar)',
        naturalExamples: [
          'apaga essa mensagem',
          'deleta isso aqui',
          'limpa essa mensagem do grupo'
        ],
        commandExamples: [
          'Responda à mensagem imprópria com: *!d*'
        ],
        permission: '👑 Administradores do Grupo e VIPs',
        tips: 'Se o bot for admin, ele também apaga a sua mensagem de comando para manter o chat completamente limpo.'
      },
      {
        id: 'ban',
        name: 'Banir / Expulsar Membro',
        category: '🛡️ Moderação de Grupos',
        aliases: ['ban', 'kick', 'expulsar'],
        description: 'Remove e expulsa imediatamente um membro infrator do grupo.',
        syntax: '!ban @usuario (ou respondendo à mensagem do infrator)',
        naturalExamples: [
          'bane esse cara @5511999998888',
          'remove ele do grupo',
          'expulsa esse participante'
        ],
        commandExamples: [
          '!ban @5511999998888',
          'Responda a uma mensagem de spam com: *!ban*'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)',
        tips: 'Você pode apenas responder à mensagem de quem infringiu as regras escrevendo "bane esse cara".'
      },
      {
        id: 'mute',
        name: 'Mutar Usuário no Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['mute', 'mutar'],
        description: 'Silencia um usuário específico no grupo. Todas as mensagens enviadas por ele serão apagadas automaticamente pelo bot.',
        syntax: '!mute @usuario (ou respondendo ao usuário)',
        naturalExamples: [
          'muta esse cara @5511999998888',
          'cala a boca desse cara'
        ],
        commandExamples: [
          '!mute @5511999998888'
        ],
        permission: '👑 Administradores do Grupo'
      },
      {
        id: 'desmute',
        name: 'Desmutar Usuário no Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['desmute', 'desmutar', 'unmute'],
        description: 'Remove o silenciamento de um usuário, permitindo que ele volte a conversar normalmente no grupo.',
        syntax: '!desmute @usuario (ou respondendo ao usuário)',
        naturalExamples: [
          'desmuta esse cara @5511999998888',
          'libera ele pra falar no grupo'
        ],
        commandExamples: [
          '!desmute @5511999998888'
        ],
        permission: '👑 Administradores do Grupo'
      },
      {
        id: 'fechar',
        name: 'Fechar / Trancar Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['fechar', 'lock', 'mutargrupo', 'travar'],
        description: 'Tranca o grupo para que apenas os administradores possam enviar mensagens (modo apenas anúncios).',
        syntax: '!fechar',
        naturalExamples: [
          'fecha o grupo',
          'tranca o chat pros membros',
          'trava o grupo aí adm'
        ],
        commandExamples: [
          '!fechar',
          '!lock'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)'
      },
      {
        id: 'abrir',
        name: 'Abrir / Destrancar Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['abrir', 'unlock', 'desmutargrupo', 'liberar'],
        description: 'Reabre o grupo permitindo que todos os participantes enviem mensagens livremente.',
        syntax: '!abrir',
        naturalExamples: [
          'abre o grupo',
          'destranca o grupo',
          'libera o chat pra todo mundo'
        ],
        commandExamples: [
          '!abrir',
          '!unlock'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)'
      },
      {
        id: 'marcar',
        name: 'Marcar Todos (Chamada Geral)',
        category: '🛡️ Moderação de Grupos',
        aliases: ['marcar', 'tagall', 'todos'],
        description: 'Notifica os membros do grupo para avisos urgentes. Poupando expressamente todos os administradores!',
        syntax: '!marcar <aviso ou comunicado>',
        naturalExamples: [
          'marca todo mundo do grupo atenção reunião às 15h',
          'chama geral do grupo',
          'marca a galera aviso importante'
        ],
        commandExamples: [
          '!marcar Reunião geral hoje às 19:00!',
          '!marcar Novo produto liberado no catálogo!',
          '!marcar'
        ],
        permission: '👑 Administradores do Grupo',
        tips: 'Regra de ouro: os administradores NUNCA são marcados; somente participantes comuns recebem o alerta.'
      },
      {
        id: 'x9',
        name: 'X9 / Dedo-Duro do Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['x9', 'dedoduro'],
        description: 'Auditoria avançada do grupo: monitora quem saiu, mensagens apagadas pelos membros e tentativas de visualização única.',
        syntax: '!x9 [on|off|logs]',
        naturalExamples: [
          'quem saiu do grupo?',
          'alguém vazou do grupo?',
          'mostra o relatório do x9'
        ],
        commandExamples: [
          '!x9 logs (mostra as últimas ações de saída e apagamento)',
          '!x9 on (ativa alertas)',
          '!x9 off (desativa alertas)'
        ],
        permission: '👑 Administradores do Grupo'
      },
      {
        id: 'setname',
        name: 'Mudar Nome do Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['setname', 'mudarnome'],
        description: 'Altera o nome/título oficial do grupo no WhatsApp.',
        syntax: '!setname <novo nome>',
        naturalExamples: [
          'muda o nome do grupo para Clientes VIP 2026',
          'troca o título do grupo para Suporte Tech'
        ],
        commandExamples: [
          '!setname Clientes VIP 2026',
          '!setname Comunidade Oficial PayBot'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)'
      },
      {
        id: 'setdesc',
        name: 'Mudar Descrição do Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['setdesc', 'mudardesc'],
        description: 'Altera o texto da descrição e bio oficial do grupo.',
        syntax: '!setdesc <novo texto da descrição>',
        naturalExamples: [
          'muda a descrição do grupo para Regras Oficiais e Suporte',
          'atualiza a descrição do grupo'
        ],
        commandExamples: [
          '!setdesc Bem-vindos ao grupo oficial! Respeite os membros e evite spam.'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)'
      },
      {
        id: 'linkgp',
        name: 'Link de Convite do Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['linkgp', 'linkgroup', 'linkdogrupo'],
        description: 'Gera e envia o link de convite oficial atualizado para novos membros entrarem no grupo.',
        syntax: '!linkgp',
        naturalExamples: [
          'qual é o link de convite do grupo?',
          'manda o link do grupo aí'
        ],
        commandExamples: [
          '!linkgp'
        ],
        permission: '👑 Administradores do Grupo (o bot precisa ser admin)'
      },
      {
        id: 'sorteio',
        name: 'Sorteio Transparente no Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['sorteio', 'sortear', 'raffle'],
        description: 'Realiza um sorteio aleatório, transparente e auditável entre os participantes comuns do grupo (administradores poupados).',
        syntax: '!sorteio <prêmio> | <quantidade_ganhadores>',
        naturalExamples: [
          'faz um sorteio entre os membros do grupo',
          'sorteia alguém no grupo'
        ],
        commandExamples: [
          '!sorteio 1 Mês de Licença VIP | 1',
          '!sorteio Pix de R$ 100 | 2'
        ],
        permission: '👑 Administradores do Grupo'
      },
      {
        id: 'regras',
        name: 'Regras Oficiais do Grupo',
        category: '🛡️ Moderação de Grupos',
        aliases: ['regras', 'rules', 'addregra'],
        description: 'Exibe as diretrizes de conduta e regras estabelecidas pela administração do grupo.',
        syntax: '!regras (ou !addregra <texto das regras>)',
        naturalExamples: [
          'quais são as regras do grupo?',
          'mostra as regras'
        ],
        commandExamples: [
          '!regras',
          '!addregra Proibido spam, correntes e links não autorizados.'
        ],
        permission: '👥 Todos os membros podem consultar'
      },

      // ==========================================
      // 5. LOJA, VENDAS & MULTI-DISPOSITIVOS
      // ==========================================
      {
        id: 'catalogo',
        name: 'Vitrine Digital & Catálogo Oficial',
        category: '🛍️ Vendas & Loja',
        aliases: ['catalogo', 'loja', 'vitrine', 'store', 'produtos', 'planos'],
        description: 'Abre a vitrine digital com catálogo completo de produtos, planos, valores, garantias e links oficiais de pagamento.',
        syntax: '!catalogo',
        naturalExamples: [
          'me manda o catálogo da loja',
          'quero ver os produtos e planos',
          'mostra a vitrine de produtos'
        ],
        commandExamples: [
          '!catalogo',
          '!loja',
          '!vitrine'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'pedido',
        name: 'Rastreamento de Pedidos e Compras',
        category: '🛍️ Vendas & Loja',
        aliases: ['pedido', 'pedidos', 'meuspedidos', 'rastrear', 'rastreio'],
        description: 'Consulta o status de compensação, entrega de licenças e histórico de pedidos realizados.',
        syntax: '!pedido [código_pedido]',
        naturalExamples: [
          'rastreia minha compra ORD_ABC123',
          'cadê meu pedido?',
          'status do meu pedido'
        ],
        commandExamples: [
          '!pedido ORD_1711234567',
          '!pedido'
        ],
        permission: '👥 Todos os membros'
      },
      {
        id: 'serbot',
        name: 'Conectar Sub-Bot (Multi-WhatsApp)',
        category: '🔗 Multi-Dispositivos',
        aliases: ['serbot', 'code', 'jadibot', 'subbot', 'conectar'],
        description: 'Conecta seu próprio WhatsApp secundário como sub-bot da rede usando apenas um código de 8 dígitos seguro, sem precisar de QR Code.',
        syntax: '!serbot <seu_numero_com_ddd>',
        commandExamples: [
          '!serbot 5511999998888',
          '!code 5521988887777'
        ],
        permission: '👥 Todos os membros',
        tips: 'Receba o código no chat, abra Aparelhos Conectados no WhatsApp e digite o código de 8 dígitos para parear.'
      }
    ];
  }

  /**
   * Normaliza termo de busca para encontrar o comando correspondente
   */
  normalizeSearchTerm(raw) {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .replace(/^[!\/#]/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /**
   * Localiza a documentação de um comando pelo nome ou apelido
   */
  findCommand(query) {
    const clean = this.normalizeSearchTerm(query);
    if (!clean) return null;

    // 1. Busca exata por ID ou aliases
    const exact = this.commandsDatabase.find(cmd =>
      cmd.id === clean || (cmd.aliases && cmd.aliases.some(a => this.normalizeSearchTerm(a) === clean))
    );
    if (exact) return { command: exact, exact: true };

    // 2. Busca por prefixo / inclusão
    const partial = this.commandsDatabase.find(cmd =>
      cmd.id.startsWith(clean) || (cmd.aliases && cmd.aliases.some(a => a.startsWith(clean))) ||
      clean.startsWith(cmd.id)
    );
    if (partial) return { command: partial, exact: false, matchedTerm: clean };

    // 3. Busca em nomes e descrições
    const fuzzy = this.commandsDatabase.find(cmd =>
      cmd.name.toLowerCase().includes(clean) || cmd.description.toLowerCase().includes(clean)
    );
    if (fuzzy) return { command: fuzzy, exact: false, matchedTerm: clean };

    return null;
  }

  /**
   * Formata o manual educativo completo de um comando específico
   */
  formatCommandHelp(cmdObj, options = {}) {
    const cmd = cmdObj.command || cmdObj;
    const isFuzzy = options.isFuzzy || false;
    const searchedTerm = options.searchedTerm || '';

    let out = '';

    if (isFuzzy && searchedTerm) {
      out += `🔍 *Comando aproximado encontrado para "${searchedTerm}":*\n\n`;
    }

    out += `┏━━━〔 📖 *MANUAL DO COMANDO: !${cmd.id.toUpperCase()}* 〕━━━⬣\n`;
    out += `┃\n`;
    out += `┃ 📌 *Função:* ${cmd.name}\n`;
    out += `┃ 📂 *Categoria:* ${cmd.category}\n`;
    out += `┃ 🛡️ *Permissão:* ${cmd.permission}\n`;
    out += `┃\n`;
    out += `┃ 📝 *O QUE ELE FAZ:*\n`;
    out += `┃ ${cmd.description}\n`;
    out += `┃\n`;
    out += `┃ ⌨️ *COMO DIGITAR (SINTAXE):*\n`;
    out += `┃ • \`${cmd.syntax}\`\n`;

    if (cmd.aliases && cmd.aliases.length > 1) {
      const aliasList = cmd.aliases.map(a => `!${a}`).join(', ');
      out += `┃ • *Atalhos aceitos:* ${aliasList}\n`;
    }

    if (cmd.options) {
      out += `┃ • *Opções especiais:* ${cmd.options}\n`;
    }

    out += `┃\n`;
    out += `┃ 💬 *EXEMPLOS EM LINGUAGEM NATURAL (SEM PREFIXO):*\n`;
    if (cmd.naturalExamples && cmd.naturalExamples.length > 0) {
      cmd.naturalExamples.forEach(ex => {
        out += `┃ 👉 _"${ex}"_\n`;
      });
    }

    out += `┃\n`;
    out += `┃ 💡 *EXEMPLOS PRÁTICOS (COPIE E TESTE):*\n`;
    if (cmd.commandExamples && cmd.commandExamples.length > 0) {
      cmd.commandExamples.forEach(ex => {
        out += `┃ • *${ex}*\n`;
      });
    }

    if (cmd.tips) {
      out += `┃\n`;
      out += `┃ ⚡ *DICA PRO:* ${cmd.tips}\n`;
    }

    out += `┃\n`;
    out += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n\n`;
    out += `💡 _Quer aprender outro comando? Envie:_ *!ajuda <comando>*\n`;
    out += `_Exemplo:_ *!ajuda s* | *!ajuda pagespeed* | *!ajuda imei* | *!ajuda ban*`;

    return out;
  }

  /**
   * Formata o índice geral de ajuda quando nenhum comando é especificado
   */
  formatGeneralHelp() {
    const categories = {};
    for (const cmd of this.commandsDatabase) {
      if (!categories[cmd.category]) categories[cmd.category] = [];
      categories[cmd.category].push(cmd);
    }

    let out = `🤖 *CENTRAL EDUCATIVA DE COMANDOS PAYBOT* 🤖\n\n`;
    out += `Aprenda a usar qualquer comando do robô passo a passo com exemplos práticos copiáveis!\n\n`;

    for (const [catName, cmds] of Object.entries(categories)) {
      out += `*${catName}:*\n`;
      for (const c of cmds) {
        out += `• *!${c.id}* — ${c.name}\n`;
      }
      out += `\n`;
    }

    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `💡 *COMO APRENDER UM COMANDO COM EXEMPLOS:*\n`;
    out += `Envie: *!ajuda <nome_do_comando>*\n\n`;
    out += `*Exemplos imediatos:*\n`;
    out += `👉 *!ajuda play* — Aprenda a baixar músicas em MP3 e alta fidelidade\n`;
    out += `👉 *!ajuda s* — Aprenda a criar figurinhas de fotos e vídeos\n`;
    out += `👉 *!ajuda pagespeed* — Aprenda a auditar sites e velocidade\n`;
    out += `👉 *!ajuda imei* — Aprenda a consultar celulares no Celular Seguro\n`;
    out += `👉 *!ajuda ban* — Aprenda as regras de moderação e banimento\n`;
    out += `👉 *!ajuda ia* — Aprenda a conversar e criar conteúdos com a IA\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    return out;
  }

  /**
   * Executa a resposta de ajuda para o usuário no WhatsApp
   */
  async handleHelpCommand(sock, from, query) {
    const cleanQuery = this.normalizeSearchTerm(query);

    if (!cleanQuery) {
      return sock.sendMessage(from, { text: this.formatGeneralHelp() });
    }

    const match = this.findCommand(cleanQuery);

    if (match) {
      const text = this.formatCommandHelp(match.command, {
        isFuzzy: !match.exact,
        searchedTerm: query
      });
      return sock.sendMessage(from, { text });
    }

    // Se não encontrou nada parecido
    let notFoundMsg = `❓ *Comando "${query}" não encontrado!*\n\n`;
    notFoundMsg += `Aqui estão alguns dos comandos mais populares para você consultar:\n`;
    notFoundMsg += `• *!ajuda play* (Baixar músicas)\n`;
    notFoundMsg += `• *!ajuda s* (Criar figurinhas)\n`;
    notFoundMsg += `• *!ajuda pagespeed* (Auditar sites)\n`;
    notFoundMsg += `• *!ajuda imei* (Consulta de Celular Seguro)\n`;
    notFoundMsg += `• *!ajuda ig* (Baixar Instagram Reels)\n`;
    notFoundMsg += `• *!ajuda ban* (Expulsar membro)\n`;
    notFoundMsg += `• *!ajuda ia* (Inteligência Artificial)\n\n`;
    notFoundMsg += `_Para ver a lista completa de todos os comandos, envie apenas:_ *!ajuda*`;

    return sock.sendMessage(from, { text: notFoundMsg });
  }
}

module.exports = new CommandHelpService();

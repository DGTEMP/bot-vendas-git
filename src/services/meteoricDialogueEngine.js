const models = require('../db/models');

/**
 * METEORIC DIALOGUE ENGINE
 * Motor de geração de diálogos, variações de fala, tons de conversa e estilos de escrita
 * para Lançamentos Meteóricos via WhatsApp com Exército de 100+ Sub-Bots (Chips).
 */

// ==========================================
// 1. BANCO DE PERSONAS E ESTILOS DE ESCRITA
// ==========================================
const TONES = {
  misto_organico: {
    id: 'misto_organico',
    name: '🎭 Misto Orgânico (Recomendado p/ 100+ WhatsApps)',
    desc: 'Combina aleatoriamente múltiplos estilos e personas para simular um grupo 100% humano e natural sem padrão detectável.'
  },
  casual_giras: {
    id: 'casual_giras',
    name: '😎 Jovem & Descontraído (Gírias, Emojis & Internetês)',
    desc: 'Usa abreviações ("vc", "tb", "pra"), gírias ("mano", "slk", "top", "bora"), emojis e pontuação solta.'
  },
  formal_seguro: {
    id: 'formal_seguro',
    name: '👔 Formal & Polido (Profissional & Respeitoso)',
    desc: 'Escrita pontuada, sem gírias, frases estruturadas, transmitindo maturidade, seriedade e credibilidade.'
  },
  cetico_analitico: {
    id: 'cetico_analitico',
    name: '🧐 Cético & Cuidadoso (Perguntas Racionais)',
    desc: 'Faz perguntas que os leads reais têm receio de fazer (garantia, suporte, tempo de acesso) e depois compra.'
  },
  afobado_empolgado: {
    id: 'afobado_empolgado',
    name: '⚡ Afobado & Empolgado (Alta Energia & Comemoração)',
    desc: 'Usa exclamações enfáticas, letras alongadas ("conseguiii"), caixa alta parcial e muitos emojis festivos.'
  },
  rapido_minimalista: {
    id: 'rapido_minimalista',
    name: '🎯 Prático & Minimalista (Falas Curtas e Diretas)',
    desc: 'Mensagens secas de 2 a 5 palavras como "Pago.", "Pix aprovou.", "Link ok.", "Tô dentro.", típicas de WhatsApp.'
  },
  regional_brasileiro: {
    id: 'regional_brasileiro',
    name: '🇧🇷 Regional Brasileiro (Expressões Típicas BR)',
    desc: 'Usa expressões autênticas como "meu irmão", "camarada", "uai bom demais", "partiu meu patrão", "fechou parceiro".'
  }
};

// ==========================================
// 2. PALETA DE CORES PARA AVATARES (100+ CHIPS)
// ==========================================
const AVATAR_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4',
  '#f97316', '#14b8a6', '#6366f1', '#e11d48', '#84cc16', '#a855f7',
  '#0284c7', '#d97706', '#059669', '#7c3aed', '#db2777', '#ea580c'
];

// ==========================================
// 3. TEMAS COMPLETOS PARA LANÇAMENTO METEÓRICO
// ==========================================
const THEMES = {
  social_proof_herd: {
    id: 'social_proof_herd',
    name: '🔥 Prova Social Massiva & Efeito Manada (Abertura)',
    desc: 'Dezenas de confirmações de inscrições e pagamentos Pix/Cartão para gerar urgência e efeito manada incontrolável.',
    scripts: [
      {
        role: 'Comprador Rápido',
        tone: 'afobado_empolgado',
        spintax: '{Gente|Galera|Pessoal|Caraca}, {acabei de conseguir!|minha vaga tá garantida!|já garanti a minha!|inscrição feita!} O link {abriu lisinho aqui|funcionou de primeira|abriu super rápido} {🔥|🚀|🎉}'
      },
      {
        role: 'Interessado no Pix',
        tone: 'casual_giras',
        spintax: '{Mano|Galera|Rapaziada}, {o Pix aprova na mesma hora?|pagamento no Pix cai rápido?|já compensa na hora se pagar no Pix?} {Tô no checkout aqui|Tô gerando o código agora}'
      },
      {
        role: 'Comprador Experiente',
        tone: 'rapido_minimalista',
        spintax: '{Pix aprovou em 2 segundos.|Aprovou na hora no Pix.|Caiu instantâneo aqui.} {Já recebi no e-mail e no zap.|Acesso liberado imediato.|Já tô com o login no e-mail.}'
      },
      {
        role: 'Comprador Aliviado',
        tone: 'formal_seguro',
        spintax: '{Pagamento confirmado com sucesso.|Inscrição devidamente realizada.|Acesso recebido imediatamente.} {Agradeço pela condição especial concedida.|Muito obrigado pela oportunidade única.|Excelente iniciativa da equipe.}'
      },
      {
        role: 'Comprador 2 Cartões',
        tone: 'casual_giras',
        spintax: '{Show de bola|Sensacional|Top demais}, {dividi em 2 cartões e passou de boa!|passei no cartão de crédito em 12x, ficou muito leve!|parcelamento suave demais no cartão.} {Bora pra cima!|Partiu começar!|Pra cima!} 👊'
      },
      {
        role: 'Aluno Curioso',
        tone: 'regional_brasileiro',
        spintax: '{Meu irmão|Meu querido|Camarada}, {os bônus já estão liberados dentro da plataforma?|onde fica o acesso aos bônus exclusivos?|já dá pra acessar o material agora?}'
      },
      {
        role: 'Comprador Veterano',
        tone: 'casual_giras',
        spintax: '{Sim, mano!|Já tá tudo lá dentro!|Com certeza!} {Entrei na plataforma agora e os módulos já tão 100% liberados!|Acabei de dar play na aula de boas-vindas, didática top!|Material muito completo!} 🔥'
      },
      {
        role: 'Comprador Seguro',
        tone: 'cetico_analitico',
        spintax: '{Eu tava em dúvida|Fiquei pensando se entrava ou não}, {mas com essa garantia de 7 dias e desconto não tinha como deixar passar.|mas pelo valor do lote promocional compensa demais.|vi que o risco é zero e já fiz o Pix.} {Dentro!|Matrícula confirmada!|Garantido!}'
      },
      {
        role: 'Comprador Minimalista',
        tone: 'rapido_minimalista',
        spintax: '{Fechou aqui.|Pix pago.|Confirmado!|Tô dentro turma.|Vaga garantida.}'
      },
      {
        role: 'Colega de Turma',
        tone: 'afobado_empolgado',
        spintax: '{MEU DEUS, já vi que a turma vai ser gigante!|Turma pesada demais!|Sensacional ver tanta gente entrando!|Bora voar juntos galera!} 🚀🚀🚀'
      }
    ]
  },

  anticipation: {
    id: 'anticipation',
    name: '⏰ Antecipação & Expectativa (Pré-Abertura)',
    desc: 'Aquecimento do grupo horas ou minutos antes da abertura oficial, ativando notificações e gerando tensão de compra.',
    scripts: [
      {
        role: 'Lead Ansioso',
        tone: 'casual_giras',
        spintax: '{E aí galera|Fala turma|Boa tarde pessoal}, {alguém sabe o horário exato que o link vai ser liberado?|que horas pontualmente o admin vai soltar o link aqui no grupo?|já tem horário marcado pra abertura do carrinho?}'
      },
      {
        role: 'Lead Preparado',
        tone: 'formal_seguro',
        spintax: '{Já deixei o grupo fixado e notificações ativadas.|Todas as notificações aqui estão ativadas para não correr o risco de perder.|Grupo com prioridade ativada.} {Na expectativa pelas informações.|Aguardando a liberação oficial da oferta.}'
      },
      {
        role: 'Lead Alerta',
        tone: 'afobado_empolgado',
        spintax: '{Mano do céu, tô no plantão aqui!|Tô atualizando a tela de 5 em 5 minutos!|Já deixei o aplicativo do banco aberto no celular!} {Não posso perder essa condição de jeito nenhum!|Tô esperando essa oportunidade há meses!} 🔥'
      },
      {
        role: 'Lead Cético / Curioso',
        tone: 'cetico_analitico',
        spintax: '{Admin, as vagas com valor promocional são limitadas por ordem de chegada|O desconto do primeiro lote é para todo mundo ou só para os primeiros que clicarem}? {Gostaria de me organizar aqui.}'
      },
      {
        role: 'Membro Veterano',
        tone: 'casual_giras',
        spintax: '{Quem tem experiência em outros lançamentos sabe:|Pelo que o admin avisou ontem:|Dica de ouro pra vcs:} {quem clica nos primeiros minutos garante o maior bônus.|as vagas dos primeiros lotes costumam voar muito rápido.|melhor já deixar o Pix no jeito porque esgota rapidinho.}'
      },
      {
        role: 'Lead Regional',
        tone: 'regional_brasileiro',
        spintax: '{Uai parceiro|Meu irmão}, {tô só pela abertura!|tô pronto pra entrar!|assim que pipocar o link eu já mando bala!} {Bora que hoje o dia promete!|Pra cima!} 👊'
      },
      {
        role: 'Lead Minimalista',
        tone: 'rapido_minimalista',
        spintax: '{No aguardo aqui.|Tudo pronto.|Alerta ligado.|Só esperando o link.}'
      }
    ]
  },

  objection_guarantee: {
    id: 'objection_guarantee',
    name: '🛡️ Quebra de Objeções (Garantia 7 Dias & Risco Zero)',
    desc: 'Diálogo estratégico onde dúvidas sinceras de leads sobre reembolso e risco são sanadas com segurança inabalável.',
    scripts: [
      {
        role: 'Lead com Receio',
        tone: 'cetico_analitico',
        spintax: '{Uma pergunta bem sincera pessoal:|Tenho uma dúvida importante:|Pessoal, alguém aqui sabe me dizer:} {se por acaso eu entrar e sentir que não é pra mim, a garantia funciona de verdade?|como funciona o reembolso se eu não me adaptar ao conteúdo?|é seguro mesmo ou tem burocracia pra pedir estorno?}'
      },
      {
        role: 'Aluno Veterano',
        tone: 'formal_seguro',
        spintax: '{Pode ficar totalmente tranquilo(a).|A garantia é 100% incondicional por lei e pela plataforma.|Já acompanho o trabalho deles há bastante tempo.} {Você tem 7 dias corridos para testar tudo. Se por qualquer motivo não gostar, basta um e-mail ou mensagem e eles devolvem 100% do seu dinheiro sem perguntas.}'
      },
      {
        role: 'Membro Empolgado',
        tone: 'casual_giras',
        spintax: '{Exatamente, mano!|É risco zero total!|Não tem segredo nenhum!} {A plataforma de pagamento segura o valor justamente pra proteger o comprador.|Eles não enrolam com letrinhas miúdas.|Eu mesmo entrei na certeza porque sabia da garantia!}'
      },
      {
        role: 'Lead Aliviado',
        tone: 'afobado_empolgado',
        spintax: '{Nossa, que alívio saber disso!|Pô, sensacional então!|Agora sim me deu total segurança!} {Zero risco pro nosso lado.|Não tem desculpa pra não testar.|Vou gerar meu Pix agora mesmo!} 🚀'
      },
      {
        role: 'Comprador Confirmando',
        tone: 'rapido_minimalista',
        spintax: '{Garantia impecável.|Sem risco algum.|Fiz o teste e aprovei.|Dentro.}'
      }
    ]
  },

  payment_methods: {
    id: 'payment_methods',
    name: '💳 Métodos de Pagamento (Pix, 2 Cartões, Parcelas)',
    desc: 'Elimina atritos financeiros e tira dúvidas sobre limites, divisão em múltiplos cartões e aprovação imediata.',
    scripts: [
      {
        role: 'Lead Dúvida Cartão',
        tone: 'casual_giras',
        spintax: '{Turma, uma dúvida:|Gente, me tirem uma dúvida:|Alguém sabe se} {dá pra parcelar em 2 cartões diferentes? Meu limite tá dividido entre dois bancos.|o checkout aceita pagar uma parte no Pix e outra no cartão?|divide em até quantas vezes no cartão?}'
      },
      {
        role: 'Comprador Informado',
        tone: 'formal_seguro',
        spintax: '{Sim! Na tela de pagamento tem a opção de "Pagar com 2 Cartões".|No checkout você consegue dividir em até 2 cartões tranquilamente.|O parcelamento vai em até 12 vezes e a aprovação no cartão é praticamente imediata.}'
      },
      {
        role: 'Fã do Pix',
        tone: 'casual_giras',
        spintax: '{E no Pix à vista tem a melhor condição!|Se fizer pelo Pix cai na mesma hora sem juros!|Eu paguei pelo Pix Copia e Cola do banco e aprovou em menos de 10 segundos!|Super prático.}'
      },
      {
        role: 'Lead Resolvido',
        tone: 'regional_brasileiro',
        spintax: '{Top demais, meu camarada!|Fechou com chave de ouro!|Maravilha meu irmão!} {Vou dividir nos dois cartões agora mesmo.|Acabei de escanear o QR Code do Pix aqui!|Partiu!} 👊'
      },
      {
        role: 'Comprador Confirmado',
        tone: 'rapido_minimalista',
        spintax: '{Pix confirmado.|2 cartões funcionou liso.|Aprovado na hora.|Show.}'
      }
    ]
  },

  support_beginners: {
    id: 'support_beginners',
    name: '🤝 Suporte, Acompanhamento & Iniciantes / Leigos',
    desc: 'Acolhe pessoas inseguras que acham que não têm capacidade técnica ou que vão ficar sozinhas sem suporte.',
    scripts: [
      {
        role: 'Iniciante Inseguro',
        tone: 'cetico_analitico',
        spintax: '{Pessoal, eu sou bem iniciante nessa área e não entendo muito de tecnologia...|Tenho pouco conhecimento prático, sou leigo no assunto...|Para quem está começando do absoluto zero, vocês acham que é viável?} {Tem suporte para tirar dúvidas quando a gente travar?}'
      },
      {
        role: 'Aluno Mentor',
        tone: 'formal_seguro',
        spintax: '{Com certeza é viável. A didática foi desenhada exatamente para pegar qualquer pessoa pela mão desde os primeiros passos.|O suporte técnico deles responde com muita rapidez e atenção.|Você nunca fica sozinho com dúvidas.}'
      },
      {
        role: 'Ex-Iniciante',
        tone: 'casual_giras',
        spintax: '{Mano, pode entrar sem medo nenhum!|Relaxa que eu comecei do zero igual a você!|Eu também não sabia nada quando comecei e hoje aplico direto!|O passo a passo é muito mastigado e direto ao ponto.}'
      },
      {
        role: 'Iniciante Convertido',
        tone: 'afobado_empolgado',
        spintax: '{Muito obrigado pela resposta! Era exatamente isso que eu precisava ouvir!|Sensacional, me encorajou demais!|Vou me dedicar e botar em prática com certeza!} {Vaga garantida!|Já comprei aqui!|Tamo junto!} 🎉'
      }
    ]
  },

  scarcity_lot_switch: {
    id: 'scarcity_lot_switch',
    name: '⏳ Escassez Real & Virada de Lote (Vagas Esgotando)',
    desc: 'Ativa o gatilho da perda e do arrependimento iminente, acelerando indecisos antes que o preço suba.',
    scripts: [
      {
        role: 'Lead Preocupado',
        tone: 'casual_giras',
        spintax: '{Galera, o primeiro lote ainda tá ativo ou já vai subir de valor?|Alguém sabe se ainda tem vaga com esse super desconto?|Vi que o contador do checkout tá acabando!}'
      },
      {
        role: 'Membro Atento',
        tone: 'formal_seguro',
        spintax: '{O admin informou que o lote promocional encerra assim que atingir a cota limite.|Quem estiver no checkout deve finalizar logo para não perder a condição especial.|O valor do próximo lote é substancialmente mais alto.}'
      },
      {
        role: 'Comprador Apressado',
        tone: 'afobado_empolgado',
        spintax: '{CORRE QUEM NÃO PEGOU AINDA!|Quase que eu perco, meu banco tinha travado mas consegui pelo Pix agora!|As últimas vagas voam em minutos!|Não deixem pra depois galera!}'
      },
      {
        role: 'Lead Decidido',
        tone: 'regional_brasileiro',
        spintax: '{Meu Deus do céu, não posso vacilar agora não!|Partiu pagar logo esse Pix!|Não vou pagar mais caro depois de bobeira!|Garantindo a minha agora!} 🔥'
      },
      {
        role: 'Finalizador',
        tone: 'rapido_minimalista',
        spintax: '{Garantido no 1º lote.|Peguei a tempo.|Ufa, deu certo.|Dentro.}'
      }
    ]
  },

  urgency_last_chance: {
    id: 'urgency_last_chance',
    name: '🚨 Urgência Máxima (Últimos Minutos do Carrinho)',
    desc: 'Contagem regressiva final para o fechamento absoluto do carrinho de compras.',
    scripts: [
      {
        role: 'Lead no Desespero',
        tone: 'afobado_empolgado',
        spintax: '{AINDA DÁ TEMPO DE ENTRAR?|O link ainda tá funcionando pessoal?|Tava no trânsito e cheguei agora em casa, consigo pagar ainda?}'
      },
      {
        role: 'Membro Solidário',
        tone: 'casual_giras',
        spintax: '{Clica rápido no link que o checkout ainda tá aberto!|Corre mano, falta pouquíssimo tempo pro carrinho fechar de vez!|Gera o Pix agora que segura sua vaga por alguns minutos!}'
      },
      {
        role: 'Lead que Conseguiu',
        tone: 'afobado_empolgado',
        spintax: '{CONSEGUIIII! No apagar das luzes!|UFA! Passou o Pix aqui agora!|Valeu demais por avisarem!|Garantido no último minuto!}'
      },
      {
        role: 'Colega de Turma',
        tone: 'formal_seguro',
        spintax: '{Parabéns a quem aproveitou.|Essa oportunidade foi fora da curva.|Nos vemos na comunidade exclusiva de alunos.}'
      },
      {
        role: 'Fechador Seco',
        tone: 'rapido_minimalista',
        spintax: '{Fechou com chave de ouro.|Dentro nos 45 do 2º tempo.|Vaga salva.}'
      }
    ]
  },

  testimonials_results: {
    id: 'testimonials_results',
    name: '🌟 Depoimentos, Resultados & Primeiras Impressões',
    desc: 'Sub-bots comentando que já entraram na área de membros, assistiram as primeiras aulas e ficaram impressionados.',
    scripts: [
      {
        role: 'Aluno Empolgado',
        tone: 'casual_giras',
        spintax: '{Caraca galera|Pessoal|Mano do céu}, {já acessei a área de membros e assisti o primeiro módulo!|dei uma olhada geral na plataforma agora!|já baixei o material complementar!} {Didática surreal de boa!|Conteúdo de altíssimo nível!|Muito prático e direto ao ponto!} 👏'
      },
      {
        role: 'Aluno Analítico',
        tone: 'formal_seguro',
        spintax: '{Gostaria de registrar meus parabéns à equipe pela organização impecável da plataforma.|As orientações são extremamente claras e sem enrolação.|Realmente entrega muito mais do que o valor cobrado.}'
      },
      {
        role: 'Lead Decidindo',
        tone: 'regional_brasileiro',
        spintax: '{Meu irmão, só de ver vocês falando assim já me deu uma empolgação danada!|Opa, se o conteúdo prático já começa forte assim, não tem como ficar de fora não!|Tô gerando meu acesso aqui agora!}'
      },
      {
        role: 'Aluno Veterano',
        tone: 'casual_giras',
        spintax: '{Pode ir sem medo, turma!|Quem aplicar o que tá lá dentro já recupera esse valor rapidinho!|Melhor investimento do ano fácil!|Bora colocar em prática!}'
      },
      {
        role: 'Comprador Rápido',
        tone: 'rapido_minimalista',
        spintax: '{Top demais.|Aulas sensacionais.|Vale cada centavo.|Recomendo.}'
      }
    ]
  },

  natural_cross_dialogue: {
    id: 'natural_cross_dialogue',
    name: '💬 Diálogo Cruzado Multi-Bot (Ping-Pong Completo)',
    desc: 'Conversação fluida e orgânica entre 4 a 6 sub-bots simulando pessoas reais debatendo, tirando dúvidas e comprando.',
    scripts: [
      {
        role: 'Sub-Bot A (Dúvida)',
        tone: 'casual_giras',
        spintax: '{Alguém aqui que já comprou sabe se o acesso chega no WhatsApp ou só no e-mail?|Pessoal, o link de acesso da plataforma chega na hora pelo zap?}'
      },
      {
        role: 'Sub-Bot B (Resposta Rápida)',
        tone: 'rapido_minimalista',
        spintax: '{Chega nos dois. E-mail e WhatsApp com link direto.|Recebi nos dois em menos de 1 minuto.}'
      },
      {
        role: 'Sub-Bot C (Complemento)',
        tone: 'formal_seguro',
        spintax: '{Exatamente, inclusive a mensagem do WhatsApp vem com o número de suporte oficial caso precise de alguma orientação.}'
      },
      {
        role: 'Sub-Bot A (Agradecimento & Compra)',
        tone: 'afobado_empolgado',
        spintax: '{Ah perfeito então! Acabei de finalizar aqui no Pix, muito obrigado pelo retorno galera!} 🚀'
      },
      {
        role: 'Sub-Bot D (Celebração)',
        tone: 'regional_brasileiro',
        spintax: '{Boa meu camarada! Seja bem-vindo à turma! Bora pra cima que o ano é nosso!} 👊'
      }
    ]
  },

  skeptic_converted: {
    id: 'skeptic_converted',
    name: '🧐 Cético Convertido ao Vivo (Superação de Desconfiança)',
    desc: 'Demonstra a jornada psicológica de quem era desconfiado e decide comprar após verificar a seriedade da oferta.',
    scripts: [
      {
        role: 'Cético Sincero',
        tone: 'cetico_analitico',
        spintax: '{Sendo bem transparente com vocês:|Vou mandar a real aqui:|Eu estava desconfiado no começo...} {Já caí em promessas vazias na internet antes e fico sempre com o pé atrás com ofertas com muito desconto.}'
      },
      {
        role: 'Comprador Seguro',
        tone: 'formal_seguro',
        spintax: '{Entendo perfeitamente sua preocupação. O mercado está cheio de promessas falsas. Mas aqui você conta com garantia respaldada por plataforma segura de pagamentos e suporte dedicado.}'
      },
      {
        role: 'Cético Convencido',
        tone: 'casual_giras',
        spintax: '{Pesquisei sobre a equipe e vi que a reputação é impecável.|Fui conferir o contrato de garantia e o CNPJ da empresa.|Realmente é tudo transparente e sério.} {Resolvi dar o voto de confiança e acabei de pagar meu Pix!}'
      },
      {
        role: 'Colega Animado',
        tone: 'afobado_empolgado',
        spintax: '{Fez a melhor escolha possível! Você não vai se arrepender, conteúdo é outro nível! Seja bem-vindo!}'
      },
      {
        role: 'Fechador Rápido',
        tone: 'rapido_minimalista',
        spintax: '{Decisão certa.|Transparência total.|Bora pro conteúdo.}'
      }
    ]
  },

  vip_welcome: {
    id: 'vip_welcome',
    name: '👑 Boas-Vindas & Conexão de Novos Membros',
    desc: 'Recepção calorosa aos novos inscritos gerando senso de pertencimento e comunidade ativa.',
    scripts: [
      {
        role: 'Anfitrião',
        tone: 'formal_seguro',
        spintax: '{Sejam todos muito bem-vindos ao grupo de alunos e clientes VIP!|Parabéns a todos que tomaram essa decisão de entrar na turma.} {Tenho certeza que será um divisor de águas na jornada de cada um.}'
      },
      {
        role: 'Aluno Novo Animado',
        tone: 'afobado_empolgado',
        spintax: '{MUITO FELIZ EM ESTAR AQUI!|Feliz demais com essa oportunidade!|Bora pra cima galera, prontíssimo pra aplicar tudo!|Tamo junto!} 🚀🔥'
      },
      {
        role: 'Colega de Turma',
        tone: 'casual_giras',
        spintax: '{Sensacional turma! Quem tiver dúvidas sobre os primeiros passos pode chamar aqui no grupo que a galera se ajuda!|Comunidade muito unida!}'
      },
      {
        role: 'Colega Regional',
        tone: 'regional_brasileiro',
        spintax: '{Show de bola meu povo! Sejam bem-vindos! Vamos que vamos que o topo é nosso!|Fechou a turma dos feras!} 👊'
      }
    ]
  },

  army_massive_warmup: {
    id: 'army_massive_warmup',
    name: '🚀 Mobilização Massiva do Exército (100+ WhatsApps)',
    desc: 'Bateria gigante de aquecimento escalável para grupos grandes, distribuindo dezenas de mensagens por múltiplos chips.',
    scripts: [
      { role: 'Comprador #1', tone: 'casual_giras', spintax: '{Fala rapaziada!|E aí turma!|Boa tarde!} Inscrição feita aqui no Pix, aprovou rapidão! 🔥' },
      { role: 'Tirando Dúvida #1', tone: 'cetico_analitico', spintax: 'O suporte responde pelo WhatsApp mesmo ou é só por chamado no site?' },
      { role: 'Veterano #1', tone: 'formal_seguro', spintax: 'O suporte atende diretamente pelo WhatsApp oficial em horário comercial, com atendimento rápido e atencioso.' },
      { role: 'Comprador #2', tone: 'rapido_minimalista', spintax: 'Pix feito. Acesso liberado no e-mail.' },
      { role: 'Interessado #2', tone: 'afobado_empolgado', spintax: 'GENTEE consegui pagar em 2 cartões! Que facilidade absurda! 🥳' },
      { role: 'Regional #1', tone: 'regional_brasileiro', spintax: 'Meu irmão, acabei de entrar e o material é bom demais da conta! Uai valeu cada centavo!' },
      { role: 'Comprador #3', tone: 'casual_giras', spintax: 'Link tá abrindo super liso galera, quem tava na dúvida pode clicar que tá aprovando na hora!' },
      { role: 'Alerta de Lote', tone: 'casual_giras', spintax: 'Ouvi falar que o primeiro lote tá nas últimas vagas, quem não comprou ainda corre!' },
      { role: 'Comprador #4', tone: 'rapido_minimalista', spintax: 'Garantido aqui. Tudo certo.' },
      { role: 'Comprador #5', tone: 'afobado_empolgado', spintax: 'Já comecei a ver os primeiros vídeos! Didática top demais, sem enrolação! 🚀' },
      { role: 'Dúvida Garantia', tone: 'cetico_analitico', spintax: 'A garantia de 7 dias é incondicional mesmo, né? Sem pegadinha?' },
      { role: 'Veterano #2', tone: 'formal_seguro', spintax: 'Sim, garantia 100% incondicional por lei e pela plataforma de pagamento. Risco absolutamente zero.' },
      { role: 'Comprador #6', tone: 'regional_brasileiro', spintax: 'Camarada, fiz o Pix agorinha e o e-mail de acesso pipocou na tela! Show de bola!' },
      { role: 'Comprador #7', tone: 'casual_giras', spintax: 'Vaga salva com sucesso! Esse desconto foi o mais agressivo que já vi!' },
      { role: 'Comprador #8', tone: 'rapido_minimalista', spintax: 'Dentro. Bora focar.' },
      { role: 'Empolgado #2', tone: 'afobado_empolgado', spintax: 'Não acredito que peguei com todos esses bônus inclusos! Valeu demais admin! 🎉' },
      { role: 'Comprador #9', tone: 'casual_giras', spintax: 'Passou de boa no cartão de crédito! Partiu comunidade VIP!' },
      { role: 'Colega de Turma', tone: 'formal_seguro', spintax: 'Muito feliz em integrar este grupo seleto de alunos. Sucesso a todos nós nesta jornada.' },
      { role: 'Comprador #10', tone: 'regional_brasileiro', spintax: 'Fechou com chave de ouro, meu querido! Tô dentro e pronto pro que der e vier!' },
      { role: 'Fechamento', tone: 'afobado_empolgado', spintax: 'A melhor decisão do ano! Bora pra cima foguete não tem ré! 🚀🚀🚀' }
    ]
  }
};

// ==========================================
// 4. BANCO DE VARIAÇÕES DE PALAVRAS E FRASES
// ==========================================
const PHRASE_VARIATIONS = {
  greetings: [
    'Fala pessoal', 'E aí turma', 'Gente', 'Opa rapaziada', 'Fala galera',
    'Caraca galera', 'Boa tarde pessoal', 'E aí pessoal', 'Boa tarde turma',
    'Salve rapaziada', 'Opa pessoal', 'Gente do céu'
  ],
  bought_actions: [
    'acabei de garantir minha vaga', 'minha inscrição tá confirmada', 'já fiz o Pix aqui',
    'consegui pegar com esse super desconto', 'já passei o cartão e aprovou na hora',
    'minha vaga no lote 1 já tá salva', 'deu tudo certinho no checkout', 'já tô dentro da plataforma'
  ],
  status_reactions: [
    'o link funcionou de primeira', 'aprovou em menos de 10 segundos', 'acesso já chegou no e-mail',
    'já recebi a confirmação no zap', 'material já tá todo liberado', 'didática incrível das primeiras aulas'
  ],
  closings: [
    'bora pra cima! 🚀', 'valeu demais! 🔥', 'partiu começar! 👊', 'muito top! 👏',
    'sensacional demais!', 'não dava pra perder essa condição!', 'já tô nos estudos! 🎉'
  ]
};

// ==========================================
// 5. CLASSE METEORIC DIALOGUE ENGINE
// ==========================================
class MeteoricDialogueEngine {
  constructor() {
    this.themes = THEMES;
    this.tones = TONES;
    this.avatarColors = AVATAR_COLORS;
  }

  // Lista todos os temas disponíveis para preenchimento de seletores
  getAvailableThemes() {
    return Object.values(this.themes).map(t => ({
      id: t.id,
      name: t.name,
      desc: t.desc,
      defaultCount: t.scripts.length
    }));
  }

  // Lista todos os tons de fala disponíveis
  getAvailableTones() {
    return Object.values(this.tones).map(t => ({
      id: t.id,
      name: t.name,
      desc: t.desc
    }));
  }

  // Retorna templates prontos para o editor customizado
  getTemplates() {
    const templates = {};
    for (const [key, value] of Object.entries(this.themes)) {
      templates[key] = value.scripts.map((s, idx) => ({
        speaker: `Sub-Bot #${idx + 1} (${s.role})`,
        delay: (idx + 1) * 4,
        text: s.spintax
      }));
    }
    return templates;
  }

  /**
   * Converte Spintax multinível e substitui variáveis dinâmicas
   */
  resolveSpintax(text, vars = {}) {
    if (!text) return '';
    let result = String(text);

    // Fallback seguro para {link} caso não fornecido explicitamente
    if (vars && typeof vars === 'object' && !vars.link) {
      const tunnelService = require('./tunnelService');
      vars.link = (tunnelService.getStoreUrl() || 'http://localhost:3001') + '/l/vip';
    }

    // 1. Substitui variáveis
    if (vars && typeof vars === 'object') {
      for (const [key, val] of Object.entries(vars)) {
        if (val !== undefined && val !== null) {
          result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(val));
        }
      }
    }

    // 2. Resolve Spintax recursivo {a|b|c}
    const regex = /\{([^{}]*\|[^{}]*)\}/;
    let matches;
    let safetyCounter = 0;
    while ((matches = regex.exec(result)) !== null && safetyCounter < 100) {
      safetyCounter++;
      const options = matches[1].split('|');
      const chosen = options[Math.floor(Math.random() * options.length)].trim();
      result = result.replace(matches[0], chosen);
    }

    // Limpeza de espaços duplos
    return result.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Calcula delay humano baseado no comprimento da mensagem (Anti-Ban Jitter)
   */
  calculateHumanDelay(text, baseSeconds = 4) {
    const charCount = (text || '').length;
    // Simula velocidade de digitação humana (20 caracteres por segundo)
    const typingDuration = Math.min(12, Math.max(1, charCount / 20));
    // Jitter sutil de ±0.75 segundos para variação anti-ban
    const jitter = (Math.random() * 1.5 - 0.75);
    const calculated = Math.round(Math.max(2, baseSeconds + typingDuration * 0.8 + jitter));
    return calculated;
  }

  /**
   * Adapta o tom de uma frase caso o usuário tenha selecionado um tom específico
   */
  applyToneFilter(text, targetTone) {
    if (!text || targetTone === 'misto_organico') return text;

    let modified = text;
    if (targetTone === 'casual_giras') {
      modified = modified
        .replace(/(^|[\s.,!?])voc[eê](?=[\s.,!?]|$)/gi, (m, p1) => (p1 || '') + 'vc')
        .replace(/(^|[\s.,!?])tamb[eé]m(?=[\s.,!?]|$)/gi, (m, p1) => (p1 || '') + 'tb')
        .replace(/(^|[\s.,!?])para(?=[\s.,!?]|$)/gi, (m, p1) => (p1 || '') + 'pra')
        .replace(/\bmuito obrigado\b/gi, 'valeu demais mano')
        .replace(/\bexcelente\b/gi, 'top demais');
    } else if (targetTone === 'formal_seguro') {
      modified = modified
        .replace(/\bvc\b/gi, 'você')
        .replace(/\btb\b/gi, 'também')
        .replace(/\bpra\b/gi, 'para')
        .replace(/\bmano\b/gi, 'pessoal')
        .replace(/\bslk\b/gi, 'realmente impressionante')
        .replace(/\btop\b/gi, 'excelente')
        .replace(/[🔥🚀🎉🥳💥]/g, '');
    } else if (targetTone === 'rapido_minimalista') {
      // Deixa mais seco se for muito longo
      if (modified.length > 40) {
        const parts = modified.split(/[.!?]/).filter(p => p.trim());
        if (parts.length > 0) modified = parts[0].trim() + '.';
      }
    } else if (targetTone === 'afobado_empolgado') {
      if (!/[!🔥🚀🎉]/.test(modified)) {
        modified = modified + '!! 🔥🚀';
      }
    }
    return modified;
  }

  /**
   * GERA O DIÁLOGO COMPLETO PARA O EXÉRCITO DE ATÉ 100+ WHATSAPPS
   */
  generateDialogue({
    theme = 'social_proof_herd',
    tone = 'misto_organico',
    count = null,
    targetGroupJid = null,
    customScripts = null,
    delaySeconds = 4,
    armyInstances = [],
    vars = {}
  } = {}) {
    let sourceScripts = [];

    // Se fornecido customScripts
    if (customScripts && Array.isArray(customScripts) && customScripts.length > 0) {
      sourceScripts = customScripts;
    } else {
      const selectedTheme = this.themes[theme] || this.themes.social_proof_herd;
      sourceScripts = selectedTheme.scripts || [];
    }

    // Determina a quantidade desejada de falas
    let targetCount = count ? parseInt(count, 10) : sourceScripts.length;
    if (isNaN(targetCount) || targetCount <= 0) targetCount = sourceScripts.length;

    // Se o usuário quer mais falas do que o roteiro base (ex: 30 falas para um exército de 100 chips),
    // o motor expande dinamicamente combinando variações e outros temas
    let dialogueItems = [];
    if (targetCount <= sourceScripts.length) {
      dialogueItems = sourceScripts.slice(0, targetCount);
    } else {
      // Expande ciclicamente enriquecendo com variações
      let currentIdx = 0;
      while (dialogueItems.length < targetCount) {
        const baseItem = sourceScripts[currentIdx % sourceScripts.length];
        dialogueItems.push({ ...baseItem });
        currentIdx++;
      }
    }

    // Filtra instâncias disponíveis do exército (chips secundários / sub-bots)
    const availableBots = Array.isArray(armyInstances)
      ? armyInstances.filter(a => a.id !== 1) // exclui matriz principal (id 1)
      : [];

    let accumulatedDelay = 2;
    const timeline = [];

    dialogueItems.forEach((item, index) => {
      // 1. Atribuição de sub-bot do exército
      let botId = null;
      let botPhone = null;
      let botDisplayName = null;

      if (availableBots.length > 0) {
        const assignedBot = availableBots[index % availableBots.length];
        botId = assignedBot.id;
        botPhone = assignedBot.phone;
        botDisplayName = assignedBot.name || `Chip #${assignedBot.id}`;
      } else {
        botId = index + 2; // Simulação Sub-Bot #2, #3, etc.
        botDisplayName = `Sub-Bot #${botId}`;
      }

      // 2. Determina tom e persona
      const itemTone = (tone && tone !== 'misto_organico') ? tone : (item.tone || 'casual_giras');
      const roleName = item.role || `Interagindo #${index + 1}`;
      const speakerLabel = `${botDisplayName} (${roleName})`;

      // 3. Resolve Spintax e variáveis
      const rawText = item.spintax || item.text || item.message || '';
      const tunnelService = require('./tunnelService');
      const defaultMeteoricLink = (tunnelService.getStoreUrl() || 'http://localhost:3001') + '/l/vip';
      let resolvedText = this.resolveSpintax(rawText, {
        link: vars.link || defaultMeteoricLink,
        produto: vars.produto || 'Oferta VIP',
        desconto: vars.desconto || '50% de Desconto',
        ...vars
      });

      // 4. Aplica filtro de tom
      resolvedText = this.applyToneFilter(resolvedText, itemTone);

      // 5. Cálculo de delay com jitter anti-ban
      const stepDelay = item.delay || this.calculateHumanDelay(resolvedText, delaySeconds);
      accumulatedDelay += stepDelay;

      // 6. Estilo visual do avatar
      const colorIndex = (botId || index) % this.avatarColors.length;
      const avatarColor = this.avatarColors[colorIndex];
      const initials = (botDisplayName.replace(/\D/g, '') ? `B${botDisplayName.replace(/\D/g, '').slice(-2)}` : `SB`).toUpperCase();

      timeline.push({
        step: index + 1,
        subBotId: botId,
        subBotPhone: botPhone,
        speaker: speakerLabel,
        avatarInitials: initials,
        avatarColor: avatarColor,
        role: roleName,
        tone: itemTone,
        delaySeconds: accumulatedDelay,
        stepDelay: stepDelay,
        text: resolvedText
      });
    });

    return {
      success: true,
      theme,
      tone,
      targetCount: timeline.length,
      targetGroupJid: targetGroupJid || 'preview_only',
      timeline
    };
  }
}

module.exports = new MeteoricDialogueEngine();

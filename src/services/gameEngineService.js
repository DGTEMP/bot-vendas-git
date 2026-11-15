const models = require('../db/models');

/**
 * =========================================================================
 * 🎮 GAME ENGINE SERVICE - PAYBOT TECH
 * =========================================================================
 * Módulo de Entretenimento, Minigames Interativos e Tabuleiro:
 * 1. Jogo da Velha Multiplayer (Tic-Tac-Toe / !ttt / !delttt)
 * 2. Akinator Cognitivo (!akinator)
 * 3. Batalha PvP Jokenpô (!suitpvp / !pvp)
 * 4. Desafio Matemático Relâmpago (!math / !matematicas)
 * 5. Charadas & Enigmas com Dicas (!acertijo / !charada / !pista)
 * 6. Caça-Palavras no Chat (!sopa)
 * 7. Jokenpô Solo contra o Bot (!ppt)
 * 8. Verdade ou Desafio & Bola 8 (!verdad / !reto / !pregunta)
 * =========================================================================
 */

class GameEngineService {
  constructor() {
    this.tttGames = new Map(); // chatId -> { p1, p2, board: [], turn, p1Number, p2Number, timer }
    this.akiSessions = new Map(); // senderPhone -> { step, history: [], character: null }
    this.pvpChallenges = new Map(); // chatId -> { p1, p2, bet, moves: {}, timer }
    this.mathGames = new Map(); // chatId -> { question, answer, reward, expiresAt }
    this.acertijoGames = new Map(); // chatId -> { riddle, answer, hint, reward, expiresAt }
    this.sopaGames = new Map(); // chatId -> { word, grid, reward, expiresAt }

    // Banco de Charadas & Enigmas em Português
    this.riddles = [
      { q: 'O que é, o que é? Quanto mais você tira, maior ele fica?', a: ['buraco', 'o buraco'], hint: 'Tem no chão ou na parede.' },
      { q: 'O que é que passa a vida inteira correndo e nunca sai do lugar?', a: ['rio', 'o rio', 'relogio', 'o relogio', 'relógio'], hint: 'Água ou ponteiros.' },
      { q: 'O que tem capa mas não é super-herói, tem folhas mas não é árvore?', a: ['livro', 'o livro'], hint: 'Você lê para aprender.' },
      { q: 'O que cai em pé e corre deitado?', a: ['chuva', 'a chuva'], hint: 'Vem das nuvens.' },
      { q: 'O que tem dentes mas nunca comeu nada na vida?', a: ['pente', 'o pente', 'serrote', 'o serrote'], hint: 'Usado para arrumar os cabelos.' },
      { q: 'O que é que pertence a você, mas os outros usam muito mais do que você?', a: ['nome', 'o nome', 'meu nome'], hint: 'Como te chamam?' },
      { q: 'O que tem chave mas não abre porta, tem espaço mas não tem quarto?', a: ['teclado', 'o teclado'], hint: 'Você usa no computador ou celular.' },
      { q: 'O que sobe quando a chuva desce?', a: ['guarda chuva', 'guarda-chuva', 'o guarda chuva'], hint: 'Protege contra água.' },
      { q: 'O que nasce grande e morre pequeno?', a: ['vela', 'a vela', 'lapis', 'o lapis', 'lápis'], hint: 'Dá luz ou escreve.' },
      { q: 'Tenho cidades, mas não tenho casas. Tenho montanhas, mas não tenho árvores. Tenho água, mas não tenho peixes. Quem sou eu?', a: ['mapa', 'o mapa'], hint: 'Usado para navegação e geografia.' }
    ];

    // Banco de Verdades & Desafios
    this.truths = [
      'Qual foi o maior mico que você já pagou na frente de alguém que você gostava?',
      'Se você pudesse namorar alguém deste grupo, quem seria?',
      'Qual foi a última mentira que você contou e por quê?',
      'Você já fingiu estar dormindo para não atender alguém?',
      'Qual é a coisa mais esquisita que você faz quando está sozinho em casa?',
      'Se você tivesse que ser banido de uma rede social para sempre, qual escolheria?',
      'Qual foi a mensagem mais comprometedora que você já mandou no chat errado?'
    ];

    this.dares = [
      'Mande um áudio de 5 segundos cantando o refrão de uma música brega agora no grupo!',
      'Mude o seu recado/status do WhatsApp para "Sou fã número 1 do PayBot" por 1 hora.',
      'Mande uma foto engraçada fazendo careta aqui no grupo!',
      'Grave um áudio imitando um pato ou uma galinha por 3 segundos.',
      'Elogie a última pessoa que mandou mensagem no grupo de forma exagerada e poética.',
      'Declare seu amor fictício pelo Administrador do grupo com uma rima.'
    ];

    this.magicAnswers = [
      'Sim, com certeza absoluta! ✨',
      'Minhas fontes dizem que sim! 🟢',
      'Nem pense nisso... 🔴',
      'As chances são altamente favoráveis! 🚀',
      'Concentre-se e pergunte novamente mais tarde. 🔮',
      'Não conte com isso... ❌',
      'Tudo indica que sim! ✅',
      'Muito duvidoso. 🤔'
    ];
  }

  // =========================================================================
  // 1. JOGO DA VELHA (TIC-TAC-TOE / !ttt)
  // =========================================================================

  formatBoard(board) {
    const emojis = {
      '1': '1️⃣', '2': '2️⃣', '3': '3️⃣',
      '4': '4️⃣', '5': '5️⃣', '6': '6️⃣',
      '7': '7️⃣', '8': '8️⃣', '9': '9️⃣',
      'X': '❌', 'O': '⭕'
    };
    const b = board.map(cell => emojis[cell] || cell);
    return (
      `      ${b[0]} ┃ ${b[1]} ┃ ${b[2]}\n` +
      `     ━━━╋━━━╋━━━\n` +
      `      ${b[3]} ┃ ${b[4]} ┃ ${b[5]}\n` +
      `     ━━━╋━━━╋━━━\n` +
      `      ${b[6]} ┃ ${b[7]} ┃ ${b[8]}`
    );
  }

  checkWin(b) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // Linhas
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // Colunas
      [0, 4, 8], [2, 4, 6]             // Diagonais
    ];
    for (const [x, y, z] of lines) {
      if (b[x] && (b[x] === 'X' || b[x] === 'O') && b[x] === b[y] && b[x] === b[z]) {
        return b[x];
      }
    }
    if (b.every(cell => cell === 'X' || cell === 'O')) {
      return 'TIE';
    }
    return null;
  }

  async handleTicTacToe(m, { conn, args = [], usedPrefix = '!' } = {}) {
    const chatId = m.chat;
    if (this.tttGames.has(chatId)) {
      const g = this.tttGames.get(chatId);
      const timeoutSec = Math.max(10, Math.min(600, parseInt(models.getSetting('GAME_INACTIVITY_TIMEOUT_SEC', '120'), 10) || 120));
      const isExpired = Date.now() - (g.lastMoveAt || g.createdAt || 0) > (timeoutSec * 1000);
      if (isExpired) {
        this.tttGames.delete(chatId);
      } else {
        return m.reply(
          `⚠️ *Já existe uma partida de Jogo da Velha em andamento neste grupo!*\n\n` +
          this.formatBoard(g.board) + `\n\n` +
          `🎲 Vez de: @${g.turn === 'X' ? g.p1Number : g.p2Number}\n` +
          `💡 Digite o número (1 a 9) para marcar sua jogada ou *${usedPrefix}delttt* para encerrar.`,
          { mentions: [g.p1, g.p2] }
        );
      }
    }

    const mentioned = m.mentionedJid || [];
    let p2Jid = mentioned[0];
    let p2Number = '';

    if (!p2Jid && args[0]) {
      const cleanNum = args[0].replace(/\D/g, '');
      if (cleanNum.length >= 8) {
        p2Number = cleanNum;
        p2Jid = cleanNum + '@s.whatsapp.net';
      }
    } else if (p2Jid) {
      p2Number = p2Jid.split('@')[0].replace(/\D/g, '');
    }

    if (!p2Jid || p2Jid === m.sender) {
      return m.reply(`ℹ️ *Uso correto:* \`${usedPrefix}ttt @membro\` para desafiar um colega no grupo!`);
    }

    const game = {
      chatId,
      p1: m.sender,
      p1Number: m.senderNumber,
      p2: p2Jid,
      p2Number,
      board: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      turn: 'X', // X começa
      createdAt: Date.now()
    };

    this.tttGames.set(chatId, game);

    const txt =
      `╭━━━〔 🎮 *JOGO DA VELHA PAYBOT* 〕━━━⬣\n` +
      `┃\n` +
      `┃ ❌ *Jogador 1:* @${game.p1Number}\n` +
      `┃ ⭕ *Jogador 2:* @${game.p2Number}\n` +
      `┃ 🎲 *Primeira Jogada:* @${game.p1Number} (❌)\n` +
      `┃\n` +
      this.formatBoard(game.board) + `\n` +
      `┃\n` +
      `┃ 💡 *Como Jogar:* Digite o número da casa (1 a 9) no chat.\n` +
      `┃ 🚪 Para cancelar, envie *${usedPrefix}delttt*\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    return m.reply(txt, { mentions: [game.p1, game.p2] });
  }

  async processTicTacToeMove(m) {
    const chatId = m.chat;
    if (!this.tttGames.has(chatId)) return false;

    const game = this.tttGames.get(chatId);
    const text = (m.text || '').trim();
    if (!/^[1-9]$/.test(text)) return false;

    const cellIndex = parseInt(text, 10) - 1;
    const isP1 = m.sender === game.p1 || m.senderNumber === game.p1Number;
    const isP2 = m.sender === game.p2 || m.senderNumber === game.p2Number;

    if (!isP1 && !isP2) return false;

    // Checa a vez do jogador
    if (game.turn === 'X' && !isP1) {
      await m.reply(`⏳ Aguarde a sua vez! É a vez de @${game.p1Number} (❌) jogar.`, { mentions: [game.p1] });
      return true;
    }
    if (game.turn === 'O' && !isP2) {
      await m.reply(`⏳ Aguarde a sua vez! É a vez de @${game.p2Number} (⭕) jogar.`, { mentions: [game.p2] });
      return true;
    }

    // Checa se a casa já foi jogada
    if (game.board[cellIndex] === 'X' || game.board[cellIndex] === 'O') {
      await m.reply(`⚠️ A posição ${text} já está ocupada! Escolha outro número.`, { noQuote: true });
      return true;
    }

    // Executa a jogada
    game.board[cellIndex] = game.turn;

    const isOwnerP1 = models.isOwner(game.p1) || models.isOwner(game.p1Number);
    const isOwnerP2 = models.isOwner(game.p2) || models.isOwner(game.p2Number);
    const isOwnerInGame = isOwnerP1 || isOwnerP2;

    // Se o Dono Supremo está na partida, ele NUNCA perde nem empata: ele SEMPRE VENCE!
    if (isOwnerInGame) {
      const ownerSymbol = isOwnerP1 ? 'X' : 'O';
      const isOwnerTurn = (isOwnerP1 && isP1) || (isOwnerP2 && isP2);

      // Se o Dono acabou de jogar, completa uma linha vencedora para garantir vitória se já tem 2
      if (isOwnerTurn) {
        const winLines = [
          [0, 1, 2], [3, 4, 5], [6, 7, 8],
          [0, 3, 6], [1, 4, 7], [2, 5, 8],
          [0, 4, 8], [2, 4, 6]
        ];
        for (const line of winLines) {
          const ownerCount = line.filter(idx => game.board[idx] === ownerSymbol).length;
          const emptyIndices = line.filter(idx => game.board[idx] !== 'X' && game.board[idx] !== 'O');
          if (ownerCount >= 2 && emptyIndices.length === 1) {
            game.board[emptyIndices[0]] = ownerSymbol;
            break;
          }
        }
      }
    }

    let winner = this.checkWin(game.board);

    // Se o Dono está na partida e terminaria em empate ou derrota, ele vence!
    if (isOwnerInGame) {
      const ownerSymbol = isOwnerP1 ? 'X' : 'O';
      if (winner === 'TIE' || (isOwnerP1 && winner === 'O') || (isOwnerP2 && winner === 'X')) {
        winner = ownerSymbol;
      }
    }

    if (winner) {
      this.tttGames.delete(chatId);
      if (winner === 'TIE') {
        const tieMsg =
          `╭━━━〔 🤝 *EMPATE (DEU VELHA!)* 〕━━━⬣\n` +
          `┃\n` +
          this.formatBoard(game.board) + `\n` +
          `┃\n` +
          `┃ Ninguém venceu desta vez! Bom jogo entre @${game.p1Number} e @${game.p2Number}.\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        await m.reply(tieMsg, { mentions: [game.p1, game.p2] });
        return true;
      }

      const winJid = winner === 'X' ? game.p1 : game.p2;
      const winNum = winner === 'X' ? game.p1Number : game.p2Number;
      const loseNum = winner === 'X' ? game.p2Number : game.p1Number;
      const isOwnerWin = models.isOwner(winJid) || models.isOwner(winNum);

      // Recompensa moedas e XP
      try {
        models.addExp(winNum, isOwnerWin ? 300 : 100);
        models.addMoedas(winNum, isOwnerWin ? 150 : 50);
      } catch (_) {}

      const winMsg = isOwnerWin
        ? `╭━━━〔 👑 *VITÓRIA SUPREMA DO COMANDANTE!* 〕━━━⬣\n` +
          `┃\n` +
          this.formatBoard(game.board) + `\n` +
          `┃\n` +
          `┃ 👑 Glória ao Dono Supremo @${winNum}! Vitória esmagadora sobre @${loseNum} no Jogo da Velha!\n` +
          `┃ 🎁 Recompensa Suprema: *+150 Moedas* e *+300 XP*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        : `╭━━━〔 🏆 *TEMOS UM VENCEDOR!* 〕━━━⬣\n` +
          `┃\n` +
          this.formatBoard(game.board) + `\n` +
          `┃\n` +
          `┃ 🎉 Parabéns @${winNum}! Você venceu @${loseNum} no Jogo da Velha!\n` +
          `┃ 🎁 Recompensa: *+50 Moedas* e *+100 XP*\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
      await m.reply(winMsg, { mentions: [game.p1, game.p2] });
      return true;
    }

    // Alterna a vez
    game.turn = game.turn === 'X' ? 'O' : 'X';
    const nextNum = game.turn === 'X' ? game.p1Number : game.p2Number;
    const nextJid = game.turn === 'X' ? game.p1 : game.p2;

    const turnMsg =
      `╭━━━〔 🎮 *JOGO DA VELHA* 〕━━━⬣\n` +
      `┃\n` +
      this.formatBoard(game.board) + `\n` +
      `┃\n` +
      `┃ 🎲 Vez de: @${nextNum} (${game.turn === 'X' ? '❌' : '⭕'})\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    await m.reply(turnMsg, { mentions: [nextJid] });
    return true;
  }

  deleteTicTacToe(m) {
    const chatId = m.chat;
    if (this.tttGames.has(chatId)) {
      this.tttGames.delete(chatId);
      return m.reply('🗑️ *Partida de Jogo da Velha cancelada com sucesso!*');
    }
    return m.reply('ℹ️ Não há nenhuma partida ativa neste grupo para cancelar.');
  }

  // =========================================================================
  // 2. AKINATOR COGNITIVO (!akinator)
  // =========================================================================

  async handleAkinator(m, { args = [], usedPrefix = '!' } = {}) {
    const sender = m.senderNumber;
    const action = (args[0] || '').toLowerCase();

    if (action === 'cancelar' || action === 'sair' || action === 'parar') {
      this.akiSessions.delete(sender);
      return m.reply('🧞 *Sessão do Akinator encerrada com sucesso!*');
    }

    if (!this.akiSessions.has(sender) || action === 'novo' || action === 'start') {
      const session = {
        step: 0,
        characterHint: null,
        answers: []
      };
      this.akiSessions.set(sender, session);

      const intro =
        `🧞 *OLÁ! EU SOU O GRANDE AKINATOR!*\n\n` +
        `Pense em um personagem real ou fictício que eu irei adivinhar!\n\n` +
        `📌 *Pergunta 1:*\n` +
        `_O seu personagem é uma pessoa real?_\n\n` +
        `*Opções de Resposta:*\n` +
        `🔹 *0* - Sim\n` +
        `🔹 *1* - Não\n` +
        `🔹 *2* - Não sei\n` +
        `🔹 *3* - Provavelmente sim\n` +
        `🔹 *4* - Provavelmente não\n\n` +
        `💡 _Responda com o número (0 a 4) ou digite *${usedPrefix}akinator cancelar* para parar._`;
      return m.reply(intro);
    }

    const session = this.akiSessions.get(sender);
    const ans = parseInt(action, 10);

    if (isNaN(ans) || ans < 0 || ans > 4) {
      return m.reply('⚠️ Por favor, responda com uma opção válida de *0 a 4* (0: Sim, 1: Não, 2: Não sei, 3: Talvez sim, 4: Talvez não).');
    }

    session.answers.push(ans);
    session.step++;

    const questions = [
      'O seu personagem é do sexo feminino?',
      'O seu personagem é brasileiro?',
      'O seu personagem é um cantor ou músico famoso?',
      'O seu personagem é do mundo dos animes ou jogos?',
      'O seu personagem tem superpoderes?',
      'O seu personagem joga futebol profissionalmente?',
      'O seu personagem produz conteúdo para a internet / YouTube?',
      'O seu personagem é um vilão?',
      'O seu personagem é careca ou usa chapéu?'
    ];

    if (session.step < questions.length) {
      const qText = questions[session.step];
      const replyText =
        `🧞 *AKINATOR - PERGUNTA ${session.step + 1}*\n\n` +
        `_${qText}_\n\n` +
        `🔹 *0* - Sim\n` +
        `🔹 *1* - Não\n` +
        `🔹 *2* - Não sei\n` +
        `🔹 *3* - Provavelmente sim\n` +
        `🔹 *4* - Provavelmente não`;
      return m.reply(replyText);
    }

    // Revelação final do Akinator baseada nas respostas
    this.akiSessions.delete(sender);

    // Conclusão heurística com base nas respostas
    let guessed = 'Neymar Jr';
    let desc = 'Jogador de futebol brasileiro lendário';
    if (session.answers[0] === 1) { // Fictício
      if (session.answers[3] === 0) { // Anime
        guessed = 'Goku (Dragon Ball)';
        desc = 'Guerreiro Saiyajin protetor da Terra';
      } else {
        guessed = 'Batman';
        desc = 'O Cavaleiro das Trevas de Gotham';
      }
    } else { // Real
      if (session.answers[5] === 0) { // Futebol
        guessed = 'Cristiano Ronaldo (CR7)';
        desc = 'Maior artilheiro de futebol da história';
      } else if (session.answers[6] === 0) { // Internet
        guessed = 'MrBeast / Whindersson Nunes';
        desc = 'Famoso criador de conteúdo e filantropo da internet';
      }
    }

    const resultMsg =
      `╭━━━〔 🧞 *O GRANDE AKINATOR ADIVINHOU!* 〕━━━⬣\n` +
      `┃\n` +
      `┃ 🔮 Eu acho com 95% de certeza que você pensou em:\n` +
      `┃\n` +
      `┃ ⭐ *${guessed}*\n` +
      `┃ 📖 _${desc}_\n` +
      `┃\n` +
      `┃ Eu acertei? Envie *${usedPrefix}akinator* para jogar de novo!\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    return m.reply(resultMsg);
  }

  // =========================================================================
  // 3. BATALHA PVP JOKENPÔ (!suitpvp / !pvp)
  // =========================================================================

  async handlePvp(m, { args = [], usedPrefix = '!' } = {}) {
    const chatId = m.chat;
    const mentioned = m.mentionedJid || [];
    let target = mentioned[0];

    if (!target) {
      return m.reply(`ℹ️ *Uso:* \`${usedPrefix}suitpvp @membro [aposta]\` para desafiar no Pedra, Papel ou Tesoura!`);
    }

    const bet = parseInt(args[1] || '20', 10);
    const targetNum = target.split('@')[0].replace(/\D/g, '');

    const challenge = {
      chatId,
      p1: m.sender,
      p1Num: m.senderNumber,
      p2: target,
      p2Num: targetNum,
      bet: Math.max(10, isNaN(bet) ? 20 : bet),
      status: 'PENDING',
      moves: {}
    };

    this.pvpChallenges.set(chatId, challenge);

    const txt =
      `⚔️ *DESAFIO DE DUELO JOKENPÔ!* ⚔️\n\n` +
      `@${m.senderNumber} desafiou @${targetNum} para uma partida valendo *${challenge.bet} Moedas*!\n\n` +
      `👉 @${targetNum}, responda com *${usedPrefix}aceitar* para aceitar o duelo ou *${usedPrefix}recusar* para fugir!`;

    return m.reply(txt, { mentions: [m.sender, target] });
  }

  async handleAcceptPvp(m, accept = true) {
    const chatId = m.chat;
    if (!this.pvpChallenges.has(chatId)) return false;

    const c = this.pvpChallenges.get(chatId);
    if (m.sender !== c.p2 && m.senderNumber !== c.p2Num) return false;

    if (!accept) {
      this.pvpChallenges.delete(chatId);
      return m.reply(`🏳️ @${c.p2Num} recusou o duelo com @${c.p1Num}. Covarde!`, { mentions: [c.p1, c.p2] });
    }

    c.status = 'READY';
    const msg =
      `🔥 *DUELO ACEITO!* 🔥\n\n` +
      `Ambos os jogadores (@${c.p1Num} e @${c.p2Num}) devem enviar suas jogadas agora!\n` +
      `Digite no chat: *pedra*, *papel* ou *tesoura*!`;
    return m.reply(msg, { mentions: [c.p1, c.p2] });
  }

  async processPvpMove(m) {
    const chatId = m.chat;
    if (!this.pvpChallenges.has(chatId)) return false;

    const c = this.pvpChallenges.get(chatId);
    if (c.status !== 'READY') return false;

    const text = (m.text || '').toLowerCase().trim();
    const validMoves = ['pedra', 'papel', 'tesoura'];
    if (!validMoves.includes(text)) return false;

    const isP1 = m.sender === c.p1 || m.senderNumber === c.p1Num;
    const isP2 = m.sender === c.p2 || m.senderNumber === c.p2Num;
    if (!isP1 && !isP2) return false;

    const playerKey = isP1 ? 'p1' : 'p2';
    c.moves[playerKey] = text;

    await m.react('🔒');

    if (c.moves.p1 && c.moves.p2) {
      this.pvpChallenges.delete(chatId);
      let m1 = c.moves.p1;
      let m2 = c.moves.p2;

      const isOwnerP1 = models.isOwner(c.p1) || models.isOwner(c.p1Num);
      const isOwnerP2 = models.isOwner(c.p2) || models.isOwner(c.p2Num);

      // Se o Dono Supremo está no duelo, o oponente SEMPRE perde para a jogada do Dono
      if (isOwnerP1 && !isOwnerP2) {
        if (m1 === 'pedra') m2 = 'tesoura';
        else if (m1 === 'papel') m2 = 'pedra';
        else if (m1 === 'tesoura') m2 = 'papel';
      } else if (isOwnerP2 && !isOwnerP1) {
        if (m2 === 'pedra') m1 = 'tesoura';
        else if (m2 === 'papel') m1 = 'pedra';
        else if (m2 === 'tesoura') m1 = 'papel';
      }

      let winner = null;
      if (m1 === m2) {
        winner = isOwnerP1 ? 'p1' : (isOwnerP2 ? 'p2' : 'EMPATE');
      } else if (
        (m1 === 'pedra' && m2 === 'tesoura') ||
        (m1 === 'papel' && m2 === 'pedra') ||
        (m1 === 'tesoura' && m2 === 'papel')
      ) {
        winner = 'p1';
      } else {
        winner = 'p2';
      }

      if (isOwnerP1 && !isOwnerP2) winner = 'p1';
      if (isOwnerP2 && !isOwnerP1) winner = 'p2';

      const moveIcons = { pedra: '🪨 Pedra', papel: '📄 Papel', tesoura: '✂️ Tesoura' };

      if (winner === 'EMPATE') {
        const drawMsg =
          `╭━━━〔 🤝 *DUELO EMPATADO!* 〕━━━⬣\n` +
          `┃ @${c.p1Num}: ${moveIcons[m1]}\n` +
          `┃ @${c.p2Num}: ${moveIcons[m2]}\n` +
          `┃ Ninguém perdeu nem ganhou moedas!\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;
        return m.reply(drawMsg, { mentions: [c.p1, c.p2] });
      }

      const winNum = winner === 'p1' ? c.p1Num : c.p2Num;
      const loseNum = winner === 'p1' ? c.p2Num : c.p1Num;
      const winMove = winner === 'p1' ? moveIcons[m1] : moveIcons[m2];
      const loseMove = winner === 'p1' ? moveIcons[m2] : moveIcons[m1];
      const isOwnerWinner = models.isOwner(winNum) || (winner === 'p1' ? isOwnerP1 : isOwnerP2);

      const prizeCoins = isOwnerWinner ? c.bet * 2 : c.bet;
      const prizeExp = isOwnerWinner ? 100 : 50;

      try {
        models.addMoedas(winNum, prizeCoins);
        models.addExp(winNum, prizeExp);
      } catch (_) {}

      const victoryMsg = isOwnerWinner
        ? `╭━━━〔 👑 *VITÓRIA SUPREMA DO COMANDANTE!* 〕━━━⬣\n` +
          `┃\n` +
          `┃ 👑 *Vencedor Supremo:* @${winNum} (${winMove})\n` +
          `┃ 💀 *Derrotado:* @${loseNum} (${loseMove})\n` +
          `┃ 💰 *Prêmio Máximo:* +${prizeCoins} Moedas e +${prizeExp} XP\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`
        : `╭━━━〔 🏆 *VENCEDOR DO DUELO!* 〕━━━⬣\n` +
          `┃\n` +
          `┃ 👑 *Ganhador:* @${winNum} (${winMove})\n` +
          `┃ 💀 *Derrotado:* @${loseNum} (${loseMove})\n` +
          `┃ 💰 *Prêmio:* +${c.bet} Moedas e +50 XP\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

      return m.reply(victoryMsg, { mentions: [c.p1, c.p2] });
    }

    return true;
  }

  // =========================================================================
  // 4. DESAFIO MATEMÁTICO (!math / !matematicas)
  // =========================================================================

  async handleMath(m, { args = [] } = {}) {
    const chatId = m.chat;
    const diff = (args[0] || 'medio').toLowerCase();

    let n1, n2, op, answer;
    if (diff === 'facil') {
      n1 = Math.floor(Math.random() * 20) + 1;
      n2 = Math.floor(Math.random() * 20) + 1;
      op = Math.random() > 0.5 ? '+' : '-';
      answer = op === '+' ? n1 + n2 : n1 - n2;
    } else if (diff === 'dificil') {
      n1 = Math.floor(Math.random() * 90) + 10;
      n2 = Math.floor(Math.random() * 15) + 2;
      op = '*';
      answer = n1 * n2;
    } else {
      n1 = Math.floor(Math.random() * 50) + 10;
      n2 = Math.floor(Math.random() * 50) + 10;
      op = Math.random() > 0.5 ? '+' : '-';
      answer = op === '+' ? n1 + n2 : n1 - n2;
    }

    const baseReward = Math.max(1, parseInt(models.getSetting('GAME_MATH_REWARD_COINS', '50'), 10) || 50);
    const finalReward = diff === 'dificil' ? baseReward * 2 : baseReward;

    this.mathGames.set(chatId, {
      question: `${n1} ${op} ${n2}`,
      answer,
      reward: finalReward,
      expiresAt: Date.now() + 45000
    });

    const msg =
      `╭━━━〔 🧮 *DESAFIO MATEMÁTICO RELÂMPAGO* 〕━━━⬣\n` +
      `┃\n` +
      `┃ Quanto é: *${n1} ${op} ${n2}* = ?\n` +
      `┃ ⏳ Tempo limite: *45 segundos*\n` +
      `┃ 🎁 Recompensa: *+${finalReward} Moedas*\n` +
      `┃\n` +
      `┃ 💡 O primeiro participante a responder o resultado correto ganha!\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    return m.reply(msg);
  }

  async checkMathAnswer(m) {
    const chatId = m.chat;
    if (!this.mathGames.has(chatId)) return false;

    const game = this.mathGames.get(chatId);
    if (Date.now() > game.expiresAt) {
      this.mathGames.delete(chatId);
      await m.reply(`⏰ Tempo esgotado! A resposta correta era *${game.answer}*.`);
      return false;
    }

    const isOwner = models.isOwner(m.sender) || models.isOwner(m.senderNumber);
    const text = (m.text || '').trim();
    if (parseInt(text, 10) === game.answer || isOwner) {
      this.mathGames.delete(chatId);
      const reward = isOwner ? game.reward * 2 : game.reward;
      const exp = isOwner ? 100 : 40;
      try {
        models.addMoedas(m.senderNumber, reward);
        models.addExp(m.senderNumber, exp);
      } catch (_) {}

      const title = isOwner ? `👑 *VITÓRIA SUPREMA DO COMANDANTE!*` : `🎉 *RESPOSTA CORRETA!*`;
      await m.reply(
        `${title}\n\n` +
        `Parabéns @${m.senderNumber}! Você acertou que *${game.question} = ${game.answer}*!\n` +
        `🎁 Recompensa: *+${reward} Moedas* e *+${exp} XP*!`,
        { mentions: [m.sender] }
      );
      return true;
    }

    return false;
  }

  // =========================================================================
  // 5. CHARADAS & ENIGMAS (!acertijo / !charada / !pista)
  // =========================================================================

  async handleAcertijo(m) {
    const chatId = m.chat;
    const r = this.riddles[Math.floor(Math.random() * this.riddles.length)];
    const rewardCoins = Math.max(1, parseInt(models.getSetting('GAME_ACERTIJO_REWARD_COINS', '60'), 10) || 60);

    this.acertijoGames.set(chatId, {
      riddle: r.q,
      answers: r.a,
      hint: r.hint,
      reward: rewardCoins,
      expiresAt: Date.now() + 60000
    });

    const msg =
      `╭━━━〔 🧩 *CHARADA / ENIGMA DO DIA* 〕━━━⬣\n` +
      `┃\n` +
      `┃ "${r.q}"\n` +
      `┃\n` +
      `┃ ⏳ Tempo: *60 segundos*\n` +
      `┃ 💡 Digite *!pista* se precisar de ajuda!\n` +
      `┃ 🎁 Recompensa: *+${rewardCoins} Moedas* e *+50 XP*\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    return m.reply(msg);
  }

  async handlePista(m) {
    const chatId = m.chat;
    if (!this.acertijoGames.has(chatId)) {
      return m.reply('ℹ️ Não há nenhum enigma ativo no momento. Inicie um com *!acertijo*');
    }
    const g = this.acertijoGames.get(chatId);
    return m.reply(`💡 *DICA DA CHARADA:* ${g.hint}`);
  }

  async checkAcertijoAnswer(m) {
    const chatId = m.chat;
    if (!this.acertijoGames.has(chatId)) return false;

    const game = this.acertijoGames.get(chatId);
    if (Date.now() > game.expiresAt) {
      this.acertijoGames.delete(chatId);
      await m.reply(`⏰ Tempo esgotado! A resposta correta era: *${game.answers[0]}*.`);
      return false;
    }

    const isOwner = models.isOwner(m.sender) || models.isOwner(m.senderNumber);
    const text = (m.text || '').toLowerCase().trim();
    if (game.answers.some(ans => text === ans || text.includes(ans)) || isOwner) {
      this.acertijoGames.delete(chatId);
      const reward = isOwner ? game.reward * 2 : game.reward;
      const exp = isOwner ? 100 : 50;
      try {
        models.addMoedas(m.senderNumber, reward);
        models.addExp(m.senderNumber, exp);
      } catch (_) {}

      const title = isOwner ? `👑 *VITÓRIA SUPREMA DO COMANDANTE!*` : `🏆 *PARABÉNS! VOCÊ ACERTOU A CHARADA!*`;
      await m.reply(
        `${title}\n\n` +
        `@${m.senderNumber} decifrou o enigma! Resposta: *${game.answers[0]}*\n` +
        `🎁 Recompensa: *+${reward} Moedas* e *+${exp} XP* adicionados ao seu perfil!`,
        { mentions: [m.sender] }
      );
      return true;
    }

    return false;
  }

  // =========================================================================
  // 6. CAÇA-PALAVRAS NO CHAT (!sopa)
  // =========================================================================

  async handleSopa(m) {
    const chatId = m.chat;
    const words = ['PAYBOT', 'PIX', 'CRIPTOPAY', 'VENDAS', 'BAILEYS', 'WHATSAPP', 'INTELIGENCIA', 'SUCESSO'];
    const chosen = words[Math.floor(Math.random() * words.length)];

    // Monta matriz 7x7
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const grid = [];
    for (let r = 0; r < 7; r++) {
      let row = [];
      for (let c = 0; c < 7; c++) {
        row.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
      }
      grid.push(row);
    }

    // Injeta a palavra horizontalmente na linha 3
    const startCol = Math.max(0, Math.floor((7 - chosen.length) / 2));
    for (let i = 0; i < chosen.length && (startCol + i) < 7; i++) {
      grid[3][startCol + i] = chosen[i];
    }

    const gridStr = grid.map(r => r.join('  ')).join('\n');

    this.sopaGames.set(chatId, {
      word: chosen.toLowerCase(),
      expiresAt: Date.now() + 60000
    });

    const msg =
      `╭━━━〔 🔠 *CAÇA-PALAVRAS PAYBOT* 〕━━━⬣\n` +
      `┃ Encontre a palavra secreta escondida na grade:\n` +
      `┃\n` +
      `\`\`\`\n${gridStr}\n\`\`\`\n` +
      `┃\n` +
      `┃ ⏳ Tempo: *60 segundos*\n` +
      `┃ 💡 Digite a palavra assim que encontrá-la!\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

    return m.reply(msg);
  }

  async checkSopaAnswer(m) {
    const chatId = m.chat;
    if (!this.sopaGames.has(chatId)) return false;

    const game = this.sopaGames.get(chatId);
    if (Date.now() > game.expiresAt) {
      this.sopaGames.delete(chatId);
      return false;
    }

    const isOwner = models.isOwner(m.sender) || models.isOwner(m.senderNumber);
    const text = (m.text || '').toLowerCase().trim();
    if (text === game.word || (isOwner && text.length >= 3)) {
      this.sopaGames.delete(chatId);
      const reward = isOwner ? 120 : 60;
      const exp = isOwner ? 100 : 50;
      try {
        models.addMoedas(m.senderNumber, reward);
        models.addExp(m.senderNumber, exp);
      } catch (_) {}

      const title = isOwner ? `👑 *VITÓRIA SUPREMA DO COMANDANTE!*` : `🎉 *PALAVRA ENCONTRADA!* Olhos de águia, @${m.senderNumber}!`;
      await m.reply(
        `${title}\n` +
        `A palavra era *${game.word.toUpperCase()}*.\n` +
        `🎁 Recompensa: *+${reward} Moedas* e *+${exp} XP*!`,
        { mentions: [m.sender] }
      );
      return true;
    }

    return false;
  }

  // =========================================================================
  // 7. JOKENPÔ SOLO CONTRA O BOT (!ppt)
  // =========================================================================

  async handlePptSolo(m, { text = '', usedPrefix = '!' } = {}) {
    const choices = ['pedra', 'papel', 'tesoura'];
    const userChoice = text.toLowerCase().trim();

    if (!choices.includes(userChoice)) {
      return m.reply(`ℹ️ *Uso:* \`${usedPrefix}ppt pedra\`, \`${usedPrefix}ppt papel\` ou \`${usedPrefix}ppt tesoura\`!`);
    }

    const isOwner = models.isOwner(m.sender) || models.isOwner(m.senderNumber);
    let botChoice = choices[Math.floor(Math.random() * choices.length)];

    // Se o Dono Supremo está jogando, o bot NUNCA vence dele: bot sempre joga o movimento que perde!
    if (isOwner) {
      if (userChoice === 'pedra') botChoice = 'tesoura';
      else if (userChoice === 'papel') botChoice = 'pedra';
      else if (userChoice === 'tesoura') botChoice = 'papel';
    }

    const icons = { pedra: '🪨 Pedra', papel: '📄 Papel', tesoura: '✂️ Tesoura' };

    let outcome = '';
    if (userChoice === botChoice && !isOwner) {
      outcome = '🤝 *EMPATE!* Nós dois escolhemos ' + icons[userChoice] + '!';
    } else if (
      (userChoice === 'pedra' && botChoice === 'tesoura') ||
      (userChoice === 'papel' && botChoice === 'pedra') ||
      (userChoice === 'tesoura' && botChoice === 'papel') ||
      isOwner
    ) {
      if (isOwner) {
        outcome = `👑 *VITÓRIA SUPREMA DO COMANDANTE!*\nSua escolha genial: ${icons[userChoice]} esmagou meu ${icons[botChoice]}!\n🎁 Ganhou *+100 Moedas* e Glória Eterna!`;
        try { models.addMoedas(m.senderNumber, 100); } catch (_) {}
      } else {
        outcome = `🎉 *VOCÊ VENCEU!*\nSua escolha: ${icons[userChoice]} bate meu ${icons[botChoice]}!\n🎁 Ganhou *+20 Moedas*!`;
        try { models.addMoedas(m.senderNumber, 20); } catch (_) {}
      }
    } else {
      outcome = `🤖 *EU VENCI!*\nMeu ${icons[botChoice]} derrotou seu ${icons[userChoice]}! Tente novamente!`;
    }

    return m.reply(`🎮 *JOKENPÔ PAYBOT*\n\n${outcome}`);
  }

  // =========================================================================
  // 8. VERDADE OU DESAFIO & BOLA 8 (!verdad / !reto / !pregunta)
  // =========================================================================

  handleVerdad(m) {
    const t = this.truths[Math.floor(Math.random() * this.truths.length)];
    return m.reply(`🤫 *VERDADE OU CONSEQUÊNCIA:*\n\n"${t}"`);
  }

  handleReto(m) {
    const d = this.dares[Math.floor(Math.random() * this.dares.length)];
    return m.reply(`🔥 *DESAFIO ACEITO:*\n\n"${d}"`);
  }

  handlePregunta(m, text) {
    if (!text) return m.reply('🔮 Faça uma pergunta de Sim ou Não para a Bola 8 Mágica!');
    const ans = this.magicAnswers[Math.floor(Math.random() * this.magicAnswers.length)];
    return m.reply(`🔮 *BOLA 8 MÁGICA:*\n\n❓ *Pergunta:* ${text}\n✨ *Resposta:* ${ans}`);
  }
}

module.exports = new GameEngineService();

const assert = require('assert');
const naturalCommandService = require('./src/services/naturalLanguageCommandService');

console.log('=== TESTES DO NATURAL LANGUAGE COMMAND RESOLVER (99% DE CERTEZA) ===\n');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`✅ [PASSOU] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FALHOU] ${name}`);
    console.error(`   Detalhes:`, err.message);
  }
}

// 1. Figurinha com mídia
runTest('Figurinha: "faz uma figurinha dessa foto" com mídia direta', () => {
  const res = naturalCommandService.resolveCommand('faz uma figurinha dessa foto', {
    msg: { message: { imageMessage: { url: 'https://...' } } }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'STICKER');
  assert.strictEqual(res.syntheticText, '!s');
});

// 2. Figurinha sem mídia (falso positivo prevenido)
runTest('Figurinha: "faz uma figurinha" sem mídia -> Não executa', () => {
  const res = naturalCommandService.resolveCommand('faz uma figurinha', {
    msg: { message: { conversation: 'faz uma figurinha' } }
  });
  assert.strictEqual(res.matched, false);
  assert.ok(res.confidence < 0.99);
});

// 3. Auditoria PageSpeed com URL completa
runTest('PageSpeed: "analisa o site https://meusite.com.br pra ver se tá lento"', () => {
  const res = naturalCommandService.resolveCommand('analisa o site https://meusite.com.br pra ver se tá lento');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'PAGESPEED');
  assert.strictEqual(res.params.url, 'https://meusite.com.br');
  assert.strictEqual(res.syntheticText, '!pagespeed https://meusite.com.br');
});

// 4. PageSpeed com domínio sem protocolo
runTest('PageSpeed: "roda um pagespeed em meusite.com.br"', () => {
  const res = naturalCommandService.resolveCommand('roda um pagespeed em meusite.com.br');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'PAGESPEED');
  assert.strictEqual(res.params.url, 'https://meusite.com.br');
});

// 5. Pergunta conceitual sobre pagespeed -> Não executa
runTest('PageSpeed Negativo: "o que é pagespeed?" -> Não executa', () => {
  const res = naturalCommandService.resolveCommand('o que é pagespeed?');
  assert.strictEqual(res.matched, false);
});

// 6. Download de Vídeo YouTube
runTest('Download Vídeo: "baixa esse vídeo do youtube pra mim: https://www.youtube.com/watch?v=dQw4w9WgXcQ"', () => {
  const res = naturalCommandService.resolveCommand('baixa esse vídeo do youtube pra mim: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_VIDEO');
  assert.strictEqual(res.syntheticText, '!video https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

// 7. Download de Áudio YouTube
runTest('Download Áudio: "baixa o áudio desse vídeo https://youtu.be/dQw4w9WgXcQ"', () => {
  const res = naturalCommandService.resolveCommand('baixa o áudio desse vídeo https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_AUDIO');
  assert.strictEqual(res.syntheticText, '!play https://youtu.be/dQw4w9WgXcQ');
});

// 8. Download de Música por Nome
runTest('Download Áudio por Nome: "toca a música Bohemian Rhapsody Queen"', () => {
  const res = naturalCommandService.resolveCommand('toca a música Bohemian Rhapsody Queen');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_AUDIO');
  assert.strictEqual(res.syntheticText, '!play Bohemian Rhapsody Queen');
});

// 9. Download Documento HQ
runTest('Download Documento: "baixa em documento esse link https://youtu.be/dQw4w9WgXcQ"', () => {
  const res = naturalCommandService.resolveCommand('baixa em documento esse link https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_DOC');
  assert.strictEqual(res.syntheticText, '!playdoc https://youtu.be/dQw4w9WgXcQ');
});

// 10. Download Instagram Reels
runTest('Download Instagram: "baixa esse reels do insta https://www.instagram.com/reel/C123456789/"', () => {
  const res = naturalCommandService.resolveCommand('baixa esse reels do insta https://www.instagram.com/reel/C123456789/');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_INSTAGRAM');
  assert.strictEqual(res.syntheticText, '!ig https://www.instagram.com/reel/C123456789/');
});

// 11. Download TikTok
runTest('Download TikTok: "baixa esse tiktok https://vm.tiktok.com/ZM8x/"', () => {
  const res = naturalCommandService.resolveCommand('baixa esse tiktok https://vm.tiktok.com/ZM8x/');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_TIKTOK');
  assert.strictEqual(res.syntheticText, '!tiktok https://vm.tiktok.com/ZM8x/');
});

// 12. Consulta de IMEI
runTest('Consulta IMEI: "consulta o imei 352099001761481 pra ver se tá roubado"', () => {
  const res = naturalCommandService.resolveCommand('consulta o imei 352099001761481 pra ver se tá roubado');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'CONSULTAR_IMEI');
  assert.strictEqual(res.params.imei, '352099001761481');
  assert.strictEqual(res.syntheticText, '!imei 352099001761481');
});

// 13. Moderação Grupo: Apagar Mensagem (Admin)
runTest('Moderação: "apaga essa mensagem" com admin e stanzaId', () => {
  const res = naturalCommandService.resolveCommand('apaga essa mensagem', {
    isGroup: true,
    isAdmin: true,
    msg: {
      message: {
        extendedTextMessage: {
          contextInfo: { stanzaId: 'STZ12345', participant: '5511999991111@s.whatsapp.net' }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'GROUP_DELETE');
  assert.strictEqual(res.params.stanzaId, 'STZ12345');
});

// 14. Moderação Grupo: Apagar Mensagem (Não admin -> Bloqueado)
runTest('Moderação: "apaga essa mensagem" sem ser admin -> Bloqueado', () => {
  const res = naturalCommandService.resolveCommand('apaga essa mensagem', {
    isGroup: true,
    isAdmin: false,
    msg: {
      message: {
        extendedTextMessage: {
          contextInfo: { stanzaId: 'STZ12345', participant: '5511999991111@s.whatsapp.net' }
        }
      }
    }
  });
  assert.strictEqual(res.matched, false);
  assert.strictEqual(res.unauthorized, true);
});

// 15. Moderação Grupo: Banir Membro
runTest('Moderação: "bane esse cara @5511999998888" com admin', () => {
  const res = naturalCommandService.resolveCommand('bane esse cara @5511999998888', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'GROUP_BAN');
  assert.strictEqual(res.params.targetUser, '5511999998888@s.whatsapp.net');
});

// 16. Moderação Grupo: Fechar e Abrir Grupo
runTest('Moderação: "fecha o grupo" e "abre o grupo"', () => {
  const lockRes = naturalCommandService.resolveCommand('fecha o grupo', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(lockRes.matched, true);
  assert.strictEqual(lockRes.type, 'GROUP_LOCK');

  const unlockRes = naturalCommandService.resolveCommand('abre o grupo', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(unlockRes.matched, true);
  assert.strictEqual(unlockRes.type, 'GROUP_UNLOCK');
});

// 17. Moderação Grupo: Marcar Todos
runTest('Moderação: "marca todo mundo do grupo atenção reunião às 15h"', () => {
  const res = naturalCommandService.resolveCommand('marca todo mundo do grupo atenção reunião às 15h', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_TAGALL');
  assert.strictEqual(res.syntheticText, '!marcar atenção reunião às 15h');
});

// 18. Moderação Grupo: X9
runTest('Moderação: "quem saiu do grupo?"', () => {
  const res = naturalCommandService.resolveCommand('quem saiu do grupo?', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_X9');
});

// 19. Catálogo de Vendas
runTest('Vendas: "me manda o catálogo da loja"', () => {
  const res = naturalCommandService.resolveCommand('me manda o catálogo da loja');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'CATALOG');
});

console.log(`\n========================================`);
console.log(`TOTAL: ${passed}/${total} TESTES PASSARAM!`);
console.log(`========================================`);

if (passed !== total) {
  process.exit(1);
}

const assert = require('assert');
const naturalCommandService = require('./src/services/naturalLanguageCommandService');

console.log('=== TESTE DE DESPACHO E EXECUÇÃO DIRETA (99% DE CERTEZA) ===\n');

let passed = 0;
let total = 0;

async function runAsyncTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`✅ [PASSOU] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FALHOU] ${name}`);
    console.error(`   Detalhes:`, err.message);
  }
}

async function runAll() {
  // 1. Despacho de PageSpeed
  await runAsyncTest('Despacho PageSpeed: executa websiteAuditService com syntheticText', async () => {
    const res = naturalCommandService.resolveCommand('analisa esse site pra ver se tá rápido: https://exemplo.com.br');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'PAGESPEED');

    let calledCmd = null;
    let calledFrom = null;

    const fakeAuditService = require('./src/services/websiteAuditService');
    const originalMethod = fakeAuditService.handleAuditCommand;
    fakeAuditService.handleAuditCommand = async (sock, from, text, senderPhone) => {
      calledCmd = text;
      calledFrom = from;
      return true;
    };

    try {
      const executed = await naturalCommandService.executeCommand(res, {
        botInstance: {},
        activeSock: {},
        from: '5511999990000@s.whatsapp.net',
        senderName: 'Carlos',
        senderPhone: '5511999990000'
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(calledCmd, '!pagespeed https://exemplo.com.br');
      assert.strictEqual(calledFrom, '5511999990000@s.whatsapp.net');
    } finally {
      fakeAuditService.handleAuditCommand = originalMethod;
    }
  });

  // 2. Despacho de Vídeo YouTube
  await runAsyncTest('Despacho Vídeo: executa spyFeatures.handlePlayVideo com URL correta', async () => {
    const res = naturalCommandService.resolveCommand('baixa esse vídeo pra mim https://youtube.com/watch?v=123456');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'DOWNLOAD_VIDEO');

    let calledCmd = null;
    const spyFeatures = require('./src/services/spyFeaturesService');
    const originalMethod = spyFeatures.handlePlayVideo;
    spyFeatures.handlePlayVideo = async (sock, from, text) => {
      calledCmd = text;
      return true;
    };

    try {
      const executed = await naturalCommandService.executeCommand(res, {
        botInstance: {},
        activeSock: {},
        from: '5511999990000@s.whatsapp.net',
        senderName: 'Carlos',
        senderPhone: '5511999990000'
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(calledCmd, '!video https://youtube.com/watch?v=123456');
    } finally {
      spyFeatures.handlePlayVideo = originalMethod;
    }
  });

  // 3. Despacho de Instagram
  await runAsyncTest('Despacho Instagram: executa spyFeatures.handleInstagram com URL correta', async () => {
    const res = naturalCommandService.resolveCommand('baixa esse reels https://www.instagram.com/reel/xyz123/');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'DOWNLOAD_INSTAGRAM');

    let calledCmd = null;
    const spyFeatures = require('./src/services/spyFeaturesService');
    const originalMethod = spyFeatures.handleInstagram;
    spyFeatures.handleInstagram = async (sock, from, text) => {
      calledCmd = text;
      return true;
    };

    try {
      const executed = await naturalCommandService.executeCommand(res, {
        botInstance: {},
        activeSock: {},
        from: '5511999990000@s.whatsapp.net',
        senderName: 'Carlos',
        senderPhone: '5511999990000'
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(calledCmd, '!ig https://www.instagram.com/reel/xyz123/');
    } finally {
      spyFeatures.handleInstagram = originalMethod;
    }
  });

  // 4. Despacho de Figurinha
  await runAsyncTest('Despacho Figurinha: executa spyFeatures.handleSticker com a mensagem', async () => {
    const fakeMsg = { message: { imageMessage: { url: 'https://...' } } };
    const res = naturalCommandService.resolveCommand('cria figurinha disso aqui', { msg: fakeMsg });
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'STICKER');

    let calledMsg = null;
    const spyFeatures = require('./src/services/spyFeaturesService');
    const originalMethod = spyFeatures.handleSticker;
    spyFeatures.handleSticker = async (sock, from, msg, senderName) => {
      calledMsg = msg;
      return true;
    };

    try {
      const executed = await naturalCommandService.executeCommand(res, {
        botInstance: {},
        activeSock: {},
        from: '5511999990000@s.whatsapp.net',
        msg: fakeMsg,
        senderName: 'Carlos'
      });

      assert.strictEqual(executed, true);
      assert.deepStrictEqual(calledMsg, fakeMsg);
    } finally {
      spyFeatures.handleSticker = originalMethod;
    }
  });

  // 5. Despacho de Moderação: Fechar Grupo (Admin)
  await runAsyncTest('Despacho Moderação: fecha grupo via groupSettingUpdate', async () => {
    const res = naturalCommandService.resolveCommand('tranca o grupo pros membros', {
      isGroup: true,
      isAdmin: true,
      isBotAdmin: true
    });
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'GROUP_LOCK');

    let updatedMode = null;
    let sentMsg = null;
    const fakeSock = {
      groupSettingUpdate: async (from, mode) => {
        updatedMode = mode;
      }
    };
    const fakeBot = {
      sock: fakeSock,
      sendMessage: async (from, text) => {
        sentMsg = text;
      }
    };

    const executed = await naturalCommandService.executeCommand(res, {
      botInstance: fakeBot,
      activeSock: fakeSock,
      from: '120363000000000000@g.us',
      isGroup: true,
      isAdmin: true,
      isBotAdmin: true,
      senderPhone: '5511999991111',
      senderName: 'Admin'
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(updatedMode, 'announcement');
    assert.ok(sentMsg.includes('GRUPO FECHADO'));
  });

  // 6. Despacho de Moderação: Marcar Todos (Poupando Administradores)
  await runAsyncTest('Despacho Moderação: marca todos via spyFeatures.handleMarcar', async () => {
    const res = naturalCommandService.resolveCommand('marca todo mundo aviso importante', {
      isGroup: true,
      isAdmin: true
    });
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.type, 'GROUP_TAGALL');

    let calledText = null;
    const spyFeatures = require('./src/services/spyFeaturesService');
    const originalMethod = spyFeatures.handleMarcar;
    spyFeatures.handleMarcar = async (sock, from, text, metadata, isAdmin) => {
      calledText = text;
      return true;
    };

    try {
      const fakeBot = {
        getGroupAdminStatus: async () => ({ metadata: { participants: [] }, isBotAdmin: true, isRequesterAdmin: true })
      };
      const executed = await naturalCommandService.executeCommand(res, {
        botInstance: fakeBot,
        activeSock: {},
        from: '120363000000000000@g.us',
        isGroup: true,
        isAdmin: true,
        isBotAdmin: true
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(calledText, '!marcar aviso importante');
    } finally {
      spyFeatures.handleMarcar = originalMethod;
    }
  });

  console.log(`\n========================================`);
  console.log(`TOTAL DISPATCH: ${passed}/${total} TESTES PASSARAM!`);
  console.log(`========================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runAll().catch(e => {
  console.error(e);
  process.exit(1);
});

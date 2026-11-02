const assert = require('assert');
const models = require('./src/db/models');
const db = require('./src/db/database');
const groupRentalService = require('./src/services/groupRentalService');
const audioFxService = require('./src/services/audioFxService');
const spyFeatures = require('./src/services/spyFeaturesService');
const fulfillment = require('./src/services/fulfillment');
const { createServer } = require('./src/server/app');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 INICIANDO TESTES DO PACOTE DE RECURSOS NAZUNA v4.0');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ [TESTE ${passed + failed + 1}] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [TESTE ${passed + failed + 1}] FALHOU: ${name}`);
      console.error(err);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`✅ [TESTE ${passed + failed + 1}] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [TESTE ${passed + failed + 1}] FALHOU: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ----------------------------------------------------
  // 1. CÓDIGOS DE ATIVAÇÃO & ALUGUEL DE GRUPOS (30 DIAS)
  // ----------------------------------------------------
  await asyncTest('Geração e Validação de Código de Ativação de 8 Dígitos', async () => {
    const codeRes = models.generateRentalActivationCode(30, null, 'test-unit');
    assert.strictEqual(codeRes.success, true);
    assert.strictEqual(typeof codeRes.code, 'string');
    assert.strictEqual(codeRes.code.length, 8);
    assert.match(codeRes.code, /^[A-F0-9]{8}$/);

    const validation = models.validateRentalActivationCode(codeRes.code);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.codeInfo.used, 0);
    assert.strictEqual(validation.codeInfo.duration_days, 30);
  });

  // ----------------------------------------------------
  // 2. ATIVAÇÃO DE ALUGUEL VIA CÓDIGO NO GRUPO
  // ----------------------------------------------------
  await asyncTest('Ativação do Código no Grupo e Bloqueio de Reutilização', async () => {
    const testGroup = '120363099999999999@g.us';
    const testUser = '5511999998888';

    const codeRes = models.generateRentalActivationCode(15, null, 'test-unit');
    const actResult = models.useRentalActivationCode(codeRes.code, testGroup, testUser);

    assert.strictEqual(actResult.success, true);
    assert.match(actResult.message, /ativado com sucesso/i);

    // Segunda tentativa com mesmo código deve falhar
    const reuse = models.useRentalActivationCode(codeRes.code, testGroup, testUser);
    assert.strictEqual(reuse.success, false);
    assert.match(reuse.message, /já foi utilizado/i);

    // Consulta status do grupo
    const rental = models.getGroupRental(testGroup);
    assert.strictEqual(rental.active, true);
    assert.strictEqual(rental.permanent, false);
    assert.strictEqual(rental.rental_code, codeRes.code);
    assert.strictEqual(rental.days_left >= 14, true);
  });

  // ----------------------------------------------------
  // 3. LICENÇA PERMANENTE / VITALÍCIA
  // ----------------------------------------------------
  await asyncTest('Código de Ativação Permanente / Vitalício', async () => {
    const testGroupPerm = '120363088888888888@g.us';
    const codePerm = models.generateRentalActivationCode('permanent', null, 'test-unit');
    assert.strictEqual(codePerm.duration_days, -1);

    const actPerm = models.useRentalActivationCode(codePerm.code, testGroupPerm, '5511977776666');
    assert.strictEqual(actPerm.success, true);

    const rentalPerm = models.getGroupRental(testGroupPerm);
    assert.strictEqual(rentalPerm.active, true);
    assert.strictEqual(rentalPerm.permanent, true);
    assert.strictEqual(rentalPerm.status, 'permanent');
  });

  // ----------------------------------------------------
  // 4. MODO ALUGUEL GLOBAL E VERIFICAÇÃO DE AUTORIZAÇÃO
  // ----------------------------------------------------
  await asyncTest('Controle de Autorização de Comandos por Aluguel Global', async () => {
    const unrentedGroup = '120363077777777777@g.us';
    const rentedGroup = '120363099999999999@g.us';
    const regularUser = '5511999991111';
    const ownerUser = '554884702848';

    // 1. Modo Global Desativado: Tudo Liberado
    groupRentalService.setGlobalMode(false);
    let check = groupRentalService.isGroupAuthorized(unrentedGroup, regularUser, false);
    assert.strictEqual(check.authorized, true);

    // 2. Modo Global Ativado: Grupo sem aluguel é bloqueado
    groupRentalService.setGlobalMode(true);
    check = groupRentalService.isGroupAuthorized(unrentedGroup, regularUser, false);
    assert.strictEqual(check.authorized, false);
    assert.strictEqual(check.reason, 'RENTAL_EXPIRED_OR_INACTIVE');

    // 3. Grupo com aluguel ativo é autorizado
    check = groupRentalService.isGroupAuthorized(rentedGroup, regularUser, false);
    assert.strictEqual(check.authorized, true);

    // 4. Dono / Owner possui bypass mesmo em grupo sem aluguel
    check = groupRentalService.isGroupAuthorized(unrentedGroup, ownerUser, true);
    assert.strictEqual(check.authorized, true);
    assert.strictEqual(check.reason, 'OWNER_BYPASS');

    // Restaura modo livre para testes seguintes
    groupRentalService.setGlobalMode(false);
  });

  // ----------------------------------------------------
  // 5. PROTEÇÃO DE GRUPO: ANTIFLOOD, ANTITRAVA & WELCOME
  // ----------------------------------------------------
  await asyncTest('Configurações de Proteção e Templates de Boas-Vindas com Variáveis', async () => {
    const grp = '120363066666666666@g.us';
    models.updateGroupProtection(grp, {
      antiflood_enabled: true,
      antiflood_interval: 4,
      antitrava_enabled: true,
      welcome_enabled: true,
      welcome_text: 'Olá #nome#! Bem-vindo ao grupo *#grupo#*. Agora somos #membros# membros. Regras: #desc#'
    });

    const prot = models.getGroupProtection(grp);
    assert.strictEqual(prot.antiflood_enabled, 1);
    assert.strictEqual(prot.antiflood_interval, 4);
    assert.strictEqual(prot.antitrava_enabled, 1);
    assert.strictEqual(prot.welcome_enabled, 1);

    // Simula renderização do Welcome
    const rendered = prot.welcome_text
      .replace(/#nome#/gi, '@5511999990000')
      .replace(/#grupo#/gi, 'Devs Tech Pro')
      .replace(/#membros#/gi, '150')
      .replace(/#desc#/gi, 'Proibido spam');

    assert.strictEqual(rendered.includes('@5511999990000'), true);
    assert.strictEqual(rendered.includes('Devs Tech Pro'), true);
    assert.strictEqual(rendered.includes('150'), true);
    assert.strictEqual(rendered.includes('Proibido spam'), true);

    // Detecção de Anti-Trava (> 3500 caracteres repetitivos)
    const travaPayload = 'TRAVA-ZAP-CRASH-PAYLOAD-TEST'.repeat(150);
    const mockMsg = { key: { id: 'test_trava', remoteJid: grp }, message: { conversation: travaPayload } };
    const mockSock = {
      sendMessage: async () => ({}),
      groupParticipantsUpdate: async () => ({})
    };

    const isTrava = await spyFeatures.checkAntiTrava(mockSock, grp, mockMsg, travaPayload, '5511999990000', true);
    assert.strictEqual(isTrava, true);
  });

  // ----------------------------------------------------
  // 6. MOTOR DE ÁUDIO FX & VÍDEO FX (FFMPEG / NAZUNA)
  // ----------------------------------------------------
  await asyncTest('Filtros de Áudio FX (Bass, Slow, Reverse, Robot, Equalizer)', async () => {
    const dummyAudio = Buffer.from('ID3_UNIT_TEST_AUDIO_BYTES');

    assert.strictEqual(audioFxService.isEffectSupported('bass'), true);
    assert.strictEqual(audioFxService.isEffectSupported('slow'), true);
    assert.strictEqual(audioFxService.isEffectSupported('reverso'), true);
    assert.strictEqual(audioFxService.isEffectSupported('robot'), true);
    assert.strictEqual(audioFxService.isEffectSupported('equalizer'), true);

    const bassRes = await audioFxService.applyAudioEffect(dummyAudio, 'bass');
    assert.strictEqual(bassRes.success, true);
    assert.strictEqual(bassRes.effect, 'bass');
    assert(bassRes.buffer.length > 0);

    const slowRes = await audioFxService.applyAudioEffect(dummyAudio, 'slow');
    assert.strictEqual(slowRes.success, true);
    assert.strictEqual(slowRes.effect, 'slow');

    // Vídeo FX
    const dummyVideo = Buffer.from('MP4_UNIT_TEST_VIDEO_BYTES');
    const vidRes = await audioFxService.applyVideoEffect(dummyVideo, 'videorapido');
    assert.strictEqual(vidRes.success, true);
    assert.strictEqual(vidRes.effect, 'videorapido');
  });

  // ----------------------------------------------------
  // 7. RANKING E AUDITORIA DE TOP COMANDOS
  // ----------------------------------------------------
  await asyncTest('Registro de Estatísticas e Ranking dos Top Comandos', async () => {
    models.recordCommandExecution('menu');
    models.recordCommandExecution('menu');
    models.recordCommandExecution('sticker');
    models.recordCommandExecution('ia');
    models.recordCommandExecution('bass');

    const topStats = models.getTopCommands(5);
    assert(topStats.total_executions > 0);
    assert(topStats.commands.length > 0);
    assert.strictEqual(topStats.commands[0].rank, 1);
    assert(topStats.commands[0].count >= 1);
    assert(topStats.commands[0].percentage > 0);
  });

  // ----------------------------------------------------
  // 8. FULFILLMENT: COMPRA DE ALUGUEL VIA LOJA PIX/CRIPTO
  // ----------------------------------------------------
  await asyncTest('Fulfillment Automático de Produto de Aluguel de Bot', async () => {
    // Busca ou cria o produto de aluguel mensal
    let rentalProd = db.prepare("SELECT * FROM products WHERE type = 'group_rental' LIMIT 1").get();
    if (!rentalProd) {
      const ins = db.prepare(`
        INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, category, stock_qty, active)
        VALUES ('Aluguel Mensal PayBot', '30 dias de acesso completo', 49.90, 49.90, 10.0, 'BRL', 'group_rental', 30, 'Aluguel', 999, 1)
      `).run();
      rentalProd = models.getProductById(Number(ins.lastInsertRowid));
    }

    const tradeNo = `ORD_RENT_${Date.now()}`;
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: '5511988887777@s.whatsapp.net',
      platform_user_name: 'Cliente Aluguel Tech',
      product_id: rentalProd.id,
      gateway: 'pix',
      amount: rentalProd.price_brl || 49.90,
      currency: 'BRL',
      status: 'PENDING'
    });

    // Processa fulfillment da compra
    const fulfillRes = await fulfillment.fulfillOrder(tradeNo);
    assert.strictEqual(fulfillRes.success, true);
    assert(fulfillRes.order.delivered_content.includes('Código Exclusivo de Ativação'));
    assert(fulfillRes.order.delivered_content.includes('!usarcodigo'));

    // Verifica que o código gerado no fulfillment foi gravado no banco de dados
    const matchCode = fulfillRes.order.delivered_content.match(/\*([A-F0-9]{8})\*/);
    assert(matchCode !== null);
    const code = matchCode[1];

    const val = models.validateRentalActivationCode(code);
    assert.strictEqual(val.valid, true);
    assert.strictEqual(val.codeInfo.used, 0);
  });

  // ----------------------------------------------------
  // 9. ENDPOINTS REST & BOT DECK ACTIONS
  // ----------------------------------------------------
  await asyncTest('Endpoints REST /api/rentals e Bot Deck Actions (GENERATE_RENTAL_CODE)', async () => {
    const http = require('http');
    const app = createServer();
    const testServer = http.createServer(app);
    await new Promise(resolve => testServer.listen(0, resolve));
    const testPort = testServer.address().port;
    const baseUrl = `http://localhost:${testPort}`;

    try {
      // 1. Simula POST /api/botdeck/execute para gerar código
      const postDeck = await fetch(`${baseUrl}/api/botdeck/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'GENERATE_RENTAL_CODE',
          payload: { durationDays: 30 }
        })
      });
      const botDeckRes = await postDeck.json();
      assert.strictEqual(botDeckRes.success, true);
      assert.match(botDeckRes.message, /Código de ativação gerado/i);

      // 2. Consulta REST /api/rentals/groups
      const getRentals = await fetch(`${baseUrl}/api/rentals/groups`);
      const rentApiData = await getRentals.json();
      assert.strictEqual(rentApiData.success, true);
      assert(Array.isArray(rentApiData.rentals));

      // 3. Consulta REST /api/stats/commands
      const getStats = await fetch(`${baseUrl}/api/stats/commands`);
      const statsApiData = await getStats.json();
      assert.strictEqual(statsApiData.success, true);
      assert(Array.isArray(statsApiData.commands));
    } finally {
      await new Promise(resolve => testServer.close(resolve));
    }
  });

  console.log('\n====================================================');
  console.log(`📊 RESULTADO FINAL DOS TESTES NAZUNA v4.0:`);
  console.log(`====================================================`);
  console.log(`Total: ${passed + failed} | ✅ Sucesso: ${passed} | ❌ Falhas: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Erro fatal no runner de testes:', err);
  process.exit(1);
});

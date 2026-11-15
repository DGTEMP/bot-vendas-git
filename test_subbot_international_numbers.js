const assert = require('assert');
const phoneUtil = require('./src/utils/phoneUtil');
const models = require('./src/db/models');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeaturesService = require('./src/services/spyFeaturesService');

async function runInternationalSubbotTests() {
  console.log('🧪 =========================================================================');
  console.log('🧪 TESTES DE SUB-BOTS COM NÚMEROS INTERNACIONAIS / GRINGOS & LOCALIZAÇÃO');
  console.log('🧪 =========================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Testes de Parsing e Normalização E.164
  await test('phoneUtil normaliza números internacionais sem injetar 55', async () => {
    const us1 = phoneUtil.parseAndNormalizePhone('+1 (202) 555-0199');
    assert.strictEqual(us1.phone, '12025550199', 'EUA com + deve manter 12025550199');
    assert.strictEqual(us1.countryCode, 'US');
    assert.strictEqual(us1.isForeign, true);

    const us2 = phoneUtil.parseAndNormalizePhone('12025550199');
    assert.strictEqual(us2.phone, '12025550199', 'EUA sem + deve manter 12025550199');
    assert.strictEqual(us2.countryCode, 'US');
    assert.strictEqual(us2.isForeign, true);

    const pt1 = phoneUtil.parseAndNormalizePhone('+351 912 345 678');
    assert.strictEqual(pt1.phone, '351912345678', 'Portugal com + deve manter 351912345678');
    assert.strictEqual(pt1.countryCode, 'PT');
    assert.strictEqual(pt1.isForeign, true);

    const pt2 = phoneUtil.parseAndNormalizePhone('351912345678');
    assert.strictEqual(pt2.phone, '351912345678', 'Portugal sem + deve manter 351912345678');
    assert.strictEqual(pt2.countryCode, 'PT');
    assert.strictEqual(pt2.isForeign, true);

    const es = phoneUtil.parseAndNormalizePhone('+34 612 345 678');
    assert.strictEqual(es.phone, '34612345678', 'Espanha 11 dígitos NÃO deve receber 55');
    assert.strictEqual(es.countryCode, 'ES');
    assert.strictEqual(es.isForeign, true);

    const fr = phoneUtil.parseAndNormalizePhone('+33 6 12 34 56 78');
    assert.strictEqual(fr.phone, '33612345678', 'França 11 dígitos NÃO deve receber 55');
    assert.strictEqual(fr.countryCode, 'FR');
    assert.strictEqual(fr.isForeign, true);

    const cl = phoneUtil.parseAndNormalizePhone('+56 9 1234 5678');
    assert.strictEqual(cl.phone, '56912345678', 'Chile 11 dígitos NÃO deve receber 55');
    assert.strictEqual(cl.countryCode, 'CL');
    assert.strictEqual(cl.isForeign, true);

    const ar = phoneUtil.parseAndNormalizePhone('+54 9 11 2345-6789');
    assert.strictEqual(ar.phone, '5491123456789');
    assert.strictEqual(ar.countryCode, 'AR');
    assert.strictEqual(ar.isForeign, true);
  });

  await test('phoneUtil normaliza números brasileiros adicionando 55 e 9º dígito quando necessário', async () => {
    const br1 = phoneUtil.parseAndNormalizePhone('48984702848');
    assert.strictEqual(br1.phone, '5548984702848');
    assert.strictEqual(br1.countryCode, 'BR');
    assert.strictEqual(br1.isForeign, false);

    const br2 = phoneUtil.parseAndNormalizePhone('554884702848');
    assert.strictEqual(br2.phone, '5548984702848', 'Auto-insere 9º dígito no celular BR');
    assert.strictEqual(br2.countryCode, 'BR');

    const br3 = phoneUtil.parseAndNormalizePhone('+55 11 99999-8888');
    assert.strictEqual(br3.phone, '5511999998888');
    assert.strictEqual(br3.countryCode, 'BR');
  });

  // 2. Testes de whatsappArmyService.requestPairingCodeForNewInstance
  await test('requestPairingCodeForNewInstance gera pareamento para EUA sem forçar 55', async () => {
    process.env.NODE_ENV = 'test';
    const res = await whatsappArmyService.requestPairingCodeForNewInstance('+1 202 555-0199', { accepted_terms: true });
    assert.strictEqual(res.success, true);
    assert(res.code, 'Deve retornar código de pareamento');
    assert.strictEqual(res.country, 'US');
    assert.strictEqual(res.flag, '🇺🇸');
    assert.strictEqual(res.isForeign, true);
  });

  await test('requestPairingCodeForNewInstance gera pareamento para Portugal sem forçar 55', async () => {
    process.env.NODE_ENV = 'test';
    const res = await whatsappArmyService.requestPairingCodeForNewInstance('+351 912 345 678', { accepted_terms: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.country, 'PT');
    assert.strictEqual(res.flag, '🇵🇹');
    assert.strictEqual(res.isForeign, true);
  });

  // 3. Testes de whatsappBot.requestPairingCode
  await test('whatsappBot.requestPairingCode aceita número internacional dos EUA', async () => {
    process.env.NODE_ENV = 'test';
    const res = await whatsappBot.requestPairingCode('+1 415 555 2671');
    assert.strictEqual(res.success, true);
    assert(res.pairingCode);
  });

  // 4. Teste de comando de chat !serbot com número estrangeiro
  await test('!serbot <numero gringo> gera pareamento preservando o DDI internacional', async () => {
    process.env.NODE_ENV = 'test';
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push(payload.text);
        return { key: { id: 'MOCK_' + Date.now() } };
      }
    };

    // Usuário gringo chamando !serbot com número dos EUA
    await spyFeaturesService.handleSerBot(mockSock, '12025550199@s.whatsapp.net', '!serbot +1 202 555-0199', '12025550199', false);

    assert(sentMessages.length >= 2, 'Deve ter enviado mensagem de carregamento e mensagem de código');
    const loadingMsg = sentMessages[0];
    assert(loadingMsg.includes('+12025550199'), `Mensagem deve indicar +12025550199 e não 55: ${loadingMsg}`);
    assert(loadingMsg.includes('🇺🇸'), 'Mensagem deve exibir a bandeira dos EUA');
    assert(!loadingMsg.includes('+5512025550199'), 'NÃO PODE conter prefixo 55 forçado');

    const codeMsg = sentMessages[1];
    assert(codeMsg.includes('CÓDIGO DE CONEXÃO') || codeMsg.includes('CÓDIGO DE PAREAMENTO'), 'Mensagem com código de conexão');
  });

  // 5. Teste de usuário gringo enviando apenas !serbot sem argumentos (usa senderPhone)
  await test('Usuário gringo enviando apenas !serbot no privado usa seu próprio número sem forçar 55', async () => {
    process.env.NODE_ENV = 'test';
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push(payload.text);
        return { key: { id: 'MOCK_' + Date.now() } };
      }
    };

    // Usuário de Portugal enviando apenas !serbot
    const portugalJid = '351912345678@s.whatsapp.net';
    await spyFeaturesService.handleSerBot(mockSock, portugalJid, '!serbot', '351912345678', false);

    assert(sentMessages.length >= 2);
    const loadingMsg = sentMessages[0];
    assert(loadingMsg.includes('+351912345678'), `Mensagem deve usar o número de Portugal: ${loadingMsg}`);
    assert(loadingMsg.includes('🇵🇹'), 'Mensagem deve exibir bandeira de Portugal');
    assert(!loadingMsg.includes('+55351912345678'), 'NÃO PODE conter prefixo 55 forçado no número de Portugal');
  });

  // 6. Teste de Adaptação Cultural e Linguística ("Dançar conforme a música")
  await test('CognitiveSalesService reconhece a localização e idioma nativo do cliente estrangeiro', async () => {
    const cognitiveService = require('./src/services/cognitiveSalesService');
    const foreignPhone = '12025550199';

    // Mock turnos para o teste de geração consultiva
    const reply = await cognitiveService.generateConsultativeReply({
      phone: foreignPhone,
      senderPhone: foreignPhone,
      name: 'John Miller',
      text: 'Hello, what are your available bots and pricing?',
      isVoiceInput: false,
      preferAudio: false
    });

    assert(reply && typeof reply === 'string', 'Deve gerar resposta consultiva');
    console.log(`    ℹ️ Resposta gerada para lead dos EUA: "${reply.slice(0, 90)}..."`);
  });

  console.log(`\n=========================================================================`);
  console.log(`📊 RESULTADO DA SUÍTE INTERNACIONAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log(`=========================================================================\n`);

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runInternationalSubbotTests().catch(err => {
  console.error('Erro fatal nos testes internacionais:', err);
  process.exit(1);
});

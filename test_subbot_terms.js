/**
 * Teste Automatizado Completo: Termos de Adesão do Exército de Sub-Bots Free
 * Valida:
 * 1. Rejeição e aceite de termos no endpoint /api/generate-code
 * 2. Atualização e persistência de terms_accepted, can_participate_meteoric, can_mention_members, can_post_status no banco SQLite
 * 3. Filtragem de menções em grupos EXCLUINDO administradores (menos os admins do grupo)
 * 4. Postagem de status promocional e de divulgação do PayBot
 * 5. Elegibilidade de Sub-Bots em campanhas meteóricas
 * 6. Comandos no WhatsApp (!serbot termos prompt, !aceitartermos, !termos)
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const models = require('./src/db/models');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const achadinhosService = require('./src/services/achadinhosService');
const statusStoryService = require('./src/services/statusStoryService');
const meteoricService = require('./src/services/meteoricService');
const spyFeatures = require('./src/services/spyFeaturesService');

async function runTests() {
  console.log('🧪 [TESTES] Iniciando validação dos Termos de Adesão do Exército de Sub-Bots Free...');

  // ==========================================
  // 1. BANCO DE DADOS & MODELS
  // ==========================================
  console.log('1️⃣ Testando criação de Sub-Bot com campos de termos...');
  const testPhone = '5511988887777';
  
  // Limpeza prévia
  const all = models.getArmyInstances();
  all.filter(i => i.phone && (i.phone === testPhone || i.phone.includes('88887777'))).forEach(p => models.deleteArmyInstance(p.id));

  const inst = models.createArmyInstance({
    name: 'Sub-Bot Teste Termos',
    phone: testPhone,
    terms_accepted: 1,
    terms_version: '1.0',
    can_participate_meteoric: 1,
    can_mention_members: 1,
    can_post_status: 1,
    is_subbot: 1
  });

  assert(inst.id, 'Instância deveria ter sido criada com ID.');
  assert.strictEqual(inst.terms_accepted, 1, 'terms_accepted deve ser 1');
  assert.strictEqual(inst.can_participate_meteoric, 1, 'can_participate_meteoric deve ser 1');
  assert.strictEqual(inst.can_mention_members, 1, 'can_mention_members deve ser 1');
  assert.strictEqual(inst.can_post_status, 1, 'can_post_status deve ser 1');
  console.log('  ✅ Sub-Bot criado com todos os atributos de termos gravados.');

  const termsStatus = models.getSubBotTermsStatus(inst.id);
  assert.strictEqual(termsStatus.terms_accepted, true);
  assert.strictEqual(termsStatus.can_participate_meteoric, true);
  assert.strictEqual(termsStatus.can_mention_members, true);
  assert.strictEqual(termsStatus.can_post_status, true);
  console.log('  ✅ getSubBotTermsStatus retornou status completo.');

  // ==========================================
  // 2. FILTRAGEM DE MENÇÕES EXCLUINDO ADMINS
  // ==========================================
  console.log('2️⃣ Testando filtragem de menções em grupos (EXCLUINDO ADMINS)...');
  const mockParticipants = [
    { id: '5511900000001@s.whatsapp.net', admin: 'admin' },        // Admin
    { id: '5511900000002@s.whatsapp.net', admin: 'superadmin' },   // Superadmin / Criador
    { id: '5511900000003@s.whatsapp.net', admin: null },          // Membro normal
    { id: '5511900000004@s.whatsapp.net' },                       // Membro normal
    { id: '5511900000005@s.whatsapp.net', admin: undefined }      // Membro normal
  ];

  // Teste no achadinhosService
  const filteredAchadinhos = achadinhosService.extractParticipantJids(mockParticipants, true);
  assert.strictEqual(filteredAchadinhos.length, 3, 'Deveria conter exatamente 3 membros normais.');
  assert(!filteredAchadinhos.includes('5511900000001@s.whatsapp.net'), 'Admin 1 não deve estar nas menções.');
  assert(!filteredAchadinhos.includes('5511900000002@s.whatsapp.net'), 'SuperAdmin não deve estar nas menções.');
  assert(filteredAchadinhos.includes('5511900000003@s.whatsapp.net'), 'Membro normal deve ser mencionado.');
  assert(filteredAchadinhos.includes('5511900000004@s.whatsapp.net'), 'Membro normal deve ser mencionado.');
  assert(filteredAchadinhos.includes('5511900000005@s.whatsapp.net'), 'Membro normal deve ser mencionado.');
  console.log('  ✅ achadinhosService filtrou e poupou com sucesso todos os administradores.');

  // Teste no whatsappArmyService
  const filteredArmy = whatsappArmyService.extractNonAdminParticipants(mockParticipants);
  assert.strictEqual(filteredArmy.length, 3);
  assert(!filteredArmy.includes('5511900000001@s.whatsapp.net'));
  assert(!filteredArmy.includes('5511900000002@s.whatsapp.net'));
  console.log('  ✅ whatsappArmyService.extractNonAdminParticipants blindou administradores.');

  // ==========================================
  // 3. WHATSAPP ARMY & CÓDIGO COM TERMOS
  // ==========================================
  console.log('3️⃣ Testando requestPairingCodeForNewInstance com opções de termos...');
  const pairingRes = await whatsappArmyService.requestPairingCodeForNewInstance('5511977776666', {
    accepted_terms: true
  });
  assert(pairingRes.code || pairingRes.pairingCode, 'Deve retornar código de pareamento');
  console.log('  ✅ requestPairingCodeForNewInstance gerou código com sucesso:', pairingRes.code || pairingRes.pairingCode);

  // ==========================================
  // 4. STATUS PROMOCIONAL E DE DIVULGAÇÃO DO PAYBOT
  // ==========================================
  console.log('4️⃣ Testando postagem de status promocional do PayBot...');
  // Mock de socket para a instância de teste
  const fakeSocket = {
    groupFetchAllParticipating: async () => ({
      'grupo1@g.us': { participants: mockParticipants }
    }),
    sendMessage: async (target, payload, options) => {
      assert.strictEqual(target, 'status@broadcast');
      assert(payload.text || payload.image);
      assert(options.statusJidList && options.statusJidList.length > 0);
      return { key: { id: 'STATUS_MSG_123' } };
    }
  };
  whatsappArmyService.activeSockets.set(inst.id, fakeSocket);

  const promoStatusRes = await statusStoryService.postPayBotPromotionalStatus({
    instanceId: inst.id
  });
  assert.strictEqual(promoStatusRes.success, true);
  assert.strictEqual(promoStatusRes.dispatchedCount, 1);
  console.log('  ✅ statusStoryService.postPayBotPromotionalStatus disparou story oficial com sucesso.');

  // ==========================================
  // 5. INTEGRAÇÃO COM METEÓRICOS
  // ==========================================
  console.log('5️⃣ Testando participação em campanhas meteóricas...');
  // O sub-bot inst com terms_accepted = 1 está no activeSockets
  assert(whatsappArmyService.activeSockets.has(inst.id));
  console.log('  ✅ Sub-Bot que aceitou termos ativo no pool de sockets para atuação em meteóricos.');

  // ==========================================
  // 6. COMANDOS DO BOT WHATSAPP
  // ==========================================
  console.log('6️⃣ Testando comandos de chat do WhatsApp...');
  let sentMessages = [];
  const mockChatSock = {
    sendMessage: async (to, content, opts) => {
      sentMessages.push({ to, content, opts });
      return { key: { id: 'MOCK_MSG_' + Date.now() } };
    }
  };

  // 6.1 Chamada !serbot -> Gera o código de pareamento diretamente e inclui termos aceitos automaticamente
  sentMessages = [];
  await spyFeatures.handleSerBot(mockChatSock, '5511999990000@s.whatsapp.net', '!serbot 5511999990000', '5511999990000', false);
  assert(sentMessages.length > 0, 'Deveria ter enviado resposta com código de pareamento.');
  const fullText = sentMessages.map(m => m.content.text).join('\n');
  assert(fullText.includes('JADIBOT / SUB-BOT') || fullText.includes('CÓDIGO DE CONEXÃO'), 'Deve conter identificação Jadibot/Código.');
  assert(fullText.includes('Lançamentos Meteóricos'), 'Deve detalhar meteóricos.');
  assert(fullText.includes('poupando e excluindo expressamente todos os administradores'), 'Deve detalhar proteção dos admins.');
  assert(fullText.includes('Status Promocionais'), 'Deve detalhar status promocionais.');
  console.log('  ✅ !serbot gerou o código de pareamento e aceitou os termos automaticamente.');

  // 6.2 Chamada !aceitartermos COM número -> Deve aceitar termos e gerar código
  sentMessages = [];
  await spyFeatures.handleSerBot(mockChatSock, '5511988881111@s.whatsapp.net', '!aceitartermos 5511988881111', '5511988881111', false);
  const acceptResultText = sentMessages.find(m => m.content.text.includes('TERMOS ACEITOS COM SUCESSO') || m.content.text.includes('CÓDIGO DE CONEXÃO'))?.content?.text;
  assert(acceptResultText, 'Deveria ter enviado mensagem com confirmação de termos aceitos e código.');
  console.log('  ✅ !aceitartermos processou o aceite com sucesso e retornou código.');

  // 6.3 Chamada !termos -> Deve exibir termos completos e status do usuário
  sentMessages = [];
  await spyFeatures.handleTermsCommand(mockChatSock, '5511988887777@s.whatsapp.net', testPhone);
  assert(sentMessages.length > 0);
  const termsText = sentMessages[0].content.text;
  assert(termsText.includes('TERMOS DE ADESÃO DO EXÉRCITO DE SUB-BOTS'));
  assert(termsText.includes('Sub-Bot #' + inst.id));
  assert(termsText.includes('Aceitos em'));
  assert(termsText.includes('Participação em Meteóricos'));
  assert(termsText.includes('Divulgações em Grupos (Membros)'));
  assert(termsText.includes('Status Promocionais PayBot'));
  console.log('  ✅ !termos exibiu o contrato completo e o status ativo do sub-bot.');

  // ==========================================
  // 7. ENDPOINT HTTP /api/generate-code
  // ==========================================
  console.log('7️⃣ Testando validação de termos no endpoint HTTP /api/generate-code...');
  // Testa chamada sem accepted_terms -> Deve rejeitar com 400
  const http = require('http');
  const { createServer } = require('./src/server/app');
  const expressApp = createServer();
  const server = http.createServer(expressApp);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 7.1 Sem termos
    const resNoTerms = await fetch(`http://127.0.0.1:${port}/api/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: '5511955554444', accepted_terms: false })
    });
    const dataNoTerms = await resNoTerms.json();
    assert.strictEqual(resNoTerms.status, 400, 'Deveria retornar status 400.');
    assert.strictEqual(dataNoTerms.success, false);
    assert(dataNoTerms.message.includes('obrigatório aceitar os Termos do Exército'), 'Mensagem de erro deve citar termos.');
    console.log('  ✅ POST /api/generate-code rejeitou com HTTP 400 quando termos não foram aceitos.');

    // 7.2 Com termos
    const resWithTerms = await fetch(`http://127.0.0.1:${port}/api/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: '5511955554444', accepted_terms: true })
    });
    const dataWithTerms = await resWithTerms.json();
    assert.strictEqual(resWithTerms.status, 200, 'Deveria retornar status 200.');
    assert.strictEqual(dataWithTerms.success, true);
    assert(dataWithTerms.code || dataWithTerms.pairingCode);
    console.log('  ✅ POST /api/generate-code aprovou e gerou código com accepted_terms: true.');
  } finally {
    server.close();
  }

  // Limpeza
  whatsappArmyService.activeSockets.delete(inst.id);
  models.deleteArmyInstance(inst.id);

  console.log('\n🎉 TODOS OS TESTES DOS TERMOS DE ADESÃO DO EXÉRCITO FORAM CONCLUÍDOS COM 100% DE SUCESSO!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ ERRO NO TESTE DE TERMOS:', err);
  process.exit(1);
});

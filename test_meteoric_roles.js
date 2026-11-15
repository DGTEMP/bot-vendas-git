const assert = require('assert');
const path = require('path');
const db = require('./src/db/database');
const models = require('./src/db/models');
const meteoricService = require('./src/services/meteoricService');
const nlpService = require('./src/services/nlpService');
const whatsappBot = require('./src/bots/whatsappBot');
const whatsappArmyService = require('./src/services/whatsappArmyService');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

console.log('\n======================================================');
console.log('🧪 SUÍTE DE TESTES: PAPÉIS DOS SUB-BOTS & ATENDIMENTO AMIGÁVEL');
console.log('======================================================\n');

(async () => {
  // TEST 1: Atendimento calmo e amigável no primeiro contato
  console.log('--- 1. Primeiro Contato & Atendimento Amigável no Privado ---');
  
  await itAsync('NLP Service deve acolher saudações com calma e escuta ativa, sem cuspir produtos ou pedir PIX', async () => {
    const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa, tudo bem?'];
    for (const g of greetings) {
      const response = await nlpService.processMessage({ text: g, customerName: 'Marcos' });
      assert.strictEqual(response.intent, 'GREETING', `Esperava GREETING para "${g}"`);
      
      const reply = response.replyText;
      assert(reply.toLowerCase().includes('marcos') || reply.toLowerCase().includes('olá') || reply.toLowerCase().includes('tempo'), 
        `Resposta deve ser personalizada e acolhedora: ${reply}`);
      assert(!reply.toLowerCase().includes('pix copia e cola'), 'Não deve pedir PIX na saudação inicial!');
      assert(!reply.toLowerCase().includes('digite produtos'), 'Não deve cuspir comando de catálogo na saudação inicial!');
      assert(!reply.toLowerCase().includes('licença bot scalper pro'), 'Não deve empurrar produto sem o cliente pedir!');
    }
  });

  await itAsync('Texto default do NLP não deve empurrar opções agressivas de compra', async () => {
    const response = await nlpService.processMessage({ text: 'fala parceiro, como que tá?', customerName: 'Ana' });
    const reply = response.replyText;
    assert(reply.toLowerCase().includes('tempo') || reply.toLowerCase().includes('compreendi') || reply.toLowerCase().includes('ajudar') || reply.toLowerCase().includes('ouvir') || reply.toLowerCase().includes('explique'),
      `Resposta default deve ser empática e calma: ${reply}`);
    assert(!reply.toLowerCase().includes('prefere pix ou cripto'), 'Não deve forçar PIX ou cripto como padrão agressivo!');
  });

  // TEST 2: Configuração de Papéis dos Sub-Bots & Grupo de Compradores
  console.log('\n--- 2. Configuração de Papéis dos Sub-Bots (Meteórico) ---');

  it('meteoricService.getRolesConfig() deve retornar os campos de papéis e grupo de compradores', () => {
    const roles = meteoricService.getRolesConfig();
    assert(roles !== null && typeof roles === 'object');
    assert('admin_subbot_id' in roles, 'Deve conter admin_subbot_id');
    assert('buyer_subbot_ids' in roles, 'Deve conter buyer_subbot_ids');
    assert('buyers_group_jid' in roles, 'Deve conter buyers_group_jid');
    assert('buyers_group_admin_id' in roles, 'Deve conter buyers_group_admin_id');
    assert('buyers_group_workflow' in roles, 'Deve conter buyers_group_workflow');
    assert('auto_move_buyers' in roles, 'Deve conter auto_move_buyers');
  });

  it('meteoricService.updateRolesConfig() deve atualizar papéis no banco e persistir no produto', () => {
    const updated = meteoricService.updateRolesConfig({
      product_id: 1,
      admin_subbot_id: 2,
      buyer_subbot_ids: '1,2,3',
      buyers_group_jid: '120363099999999999@g.us',
      buyers_group_invite_url: 'https://chat.whatsapp.com/TestVipGroup',
      buyers_group_admin_id: 3,
      buyers_group_workflow: '🎉 Parabéns pelo {produto}! Acesse seu drive exclusivo aqui: https://drive.google.com/test',
      auto_move_buyers: true
    });

    assert.strictEqual(updated.admin_subbot_id, 2);
    assert.strictEqual(updated.buyer_subbot_ids, '1,2,3');
    assert.strictEqual(updated.buyers_group_jid, '120363099999999999@g.us');
    assert.strictEqual(updated.buyers_group_admin_id, 3);
    assert.strictEqual(updated.auto_move_buyers, true);
    assert(updated.buyers_group_workflow.includes('{produto}'));

    // Verifica sincronização com a tabela products
    const prod = models.getProductById(1);
    assert(prod, 'Produto 1 deve existir');
    assert.strictEqual(prod.buyers_group_jid, '120363099999999999@g.us');
    assert.strictEqual(prod.buyers_group_admin_id, 3);
    assert(prod.buyers_group_workflow.includes('drive exclusivo'));
  });

  // TEST 3: Movimentação de Compradores & Fluxo Operacional
  console.log('\n--- 3. Movimentação Automática de Comprador & Fluxo Único ---');

  await itAsync('meteoricService.handleLeadPurchase() transfere comprador, envia convite VIP e executa fluxo operacional', async () => {
    // Configura mock socket no Sub-Bot #3 (Admin Compradores)
    const mockMessagesSent = [];
    const mockBuyersAdminSock = {
      sendMessage: async (jid, content) => {
        mockMessagesSent.push({ jid, content });
        return { key: { id: 'MOCK_MSG_' + Date.now() } };
      },
      groupParticipantsUpdate: async (groupJid, participants, action) => {
        return [{ status: '200', jid: participants[0] }];
      }
    };
    if (!whatsappArmyService.activeSockets) {
      whatsappArmyService.activeSockets = new Map();
    }
    whatsappArmyService.activeSockets.set(3, mockBuyersAdminSock);

    const simulatedOrder = {
      id: 'ORD_ROLES_TEST_' + Date.now(),
      product_id: 1,
      platform_user_id: '5511998877665',
      platform_user_name: 'Roberto Aluno VIP',
      customer_name: 'Roberto Aluno VIP',
      amount_cents: 19700,
      currency: 'BRL',
      status: 'PAID'
    };

    const result = await meteoricService.handleLeadPurchase(simulatedOrder);
    assert(result.success, 'Operação de movimentação de comprador deve ser bem-sucedida');
    assert.strictEqual(result.buyerJid, '5511998877665@s.whatsapp.net');
    assert.strictEqual(result.buyersGroupJid, '120363099999999999@g.us');
    assert.strictEqual(result.directAdded, true, 'Deve adicionar o comprador diretamente ao grupo');
    assert.strictEqual(result.inviteSent, true, 'Deve enviar link/convite de acesso VIP no privado');
    assert.strictEqual(result.onboardingWorkflowExecuted, true, 'Deve agendar o fluxo operacional único do produto');
    assert(mockMessagesSent.length >= 1, 'Deve ter disparado mensagem no privado do comprador');

    // Verificar se o log BUYER_MOVED_TO_VIP foi gravado no banco
    const logs = models.getMeteoricActivityLogs(10);
    const buyerLog = logs.find(l => l.event_type === 'BUYER_MOVED_TO_VIP' && l.message_text && l.message_text.includes('5511998877665'));
    assert(buyerLog, 'Atividade BUYER_MOVED_TO_VIP deve ser registrada no feed');
  });

  // TEST 4: Comandos WhatsApp !meteorico para gestão de papéis
  console.log('\n--- 4. Comandos WhatsApp !meteorico de Gestão de Papéis ---');

  await itAsync('handleMeteoricCommand deve aceitar comandos de papéis e responder adequadamente', async () => {
    let capturedReply = '';
    const mockSock = {
      sendMessage: async (to, content) => {
        capturedReply = content.text;
      }
    };
    const sender = '554884702848@s.whatsapp.net';

    // 1. !meteorico admin 1
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico admin 1', true);
    assert(capturedReply.includes('Sub-Bot Administrador'), `Esperava confirmação de Admin, recebido: ${capturedReply}`);

    // 2. !meteorico compradores 1,2
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico compradores 1,2', true);
    assert(capturedReply.includes('Sub-Bots Compradores'), `Esperava confirmação de Compradores, recebido: ${capturedReply}`);

    // 3. !meteorico grupocompradores 120363000000000000@g.us
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico grupocompradores 120363000000000000@g.us', true);
    assert(capturedReply.includes('Compradores VIP'), `Esperava confirmação de Grupo, recebido: ${capturedReply}`);

    // 4. !meteorico admincompradores 1
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico admincompradores 1', true);
    assert(capturedReply.includes('Administrador do Grupo de Compradores'), `Esperava confirmação de Admin Compradores, recebido: ${capturedReply}`);

    // 5. !meteorico fluxo Seja bem-vindo ao curso VIP!
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico fluxo Seja bem-vindo ao curso VIP!', true);
    assert(capturedReply.includes('Fluxo Operacional'), `Esperava confirmação de Fluxo, recebido: ${capturedReply}`);

    // 6. !meteorico status
    await whatsappBot.handleMeteoricCommand(mockSock, sender, '!meteorico status', true);
    assert(capturedReply.includes('Admin do Grupo de Captação'), `Status deve exibir Admin Captação, recebido: ${capturedReply}`);
    assert(capturedReply.includes('Sub-Bots Compradores'), `Status deve exibir Compradores Atores, recebido: ${capturedReply}`);
    assert(capturedReply.includes('Grupo de Compradores VIP'), `Status deve exibir Grupo Compradores, recebido: ${capturedReply}`);
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES PASSARAM!`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

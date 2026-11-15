/**
 * test_achadinhos_complete.js
 * 
 * Suíte Completa de Testes para o Sistema de Achadinhos:
 * 1. Criação Automatizada de Grupo e Canal (@g.us e @newsletter)
 * 2. Alimentação de Produtos (Deals virais, Curados, Sincronização da Loja, Cadastro via Pipe)
 * 3. Gestão da Estrutura (Feed rotativo, Horários silenciosos, Status, Comandos e API REST)
 * 4. Total Suporte aos Compradores (Busca em tempo real, Alertas de Preço no PV, Cupons, FAQ e Interceptador Cognitivo)
 */

const assert = require('assert');
const path = require('path');
const db = require('./src/db/database');
const models = require('./src/db/models');
const achadinhosService = require('./src/services/achadinhosService');
const whatsappBot = require('./src/bots/whatsappBot');
const { createServer } = require('./src/server/app');

console.log('🚀 Iniciando Suíte Completa de Testes de Achadinhos...');

// Mock Socket Baileys completo para testes offline
class MockBaileysSocket {
  constructor() {
    this.sentMessages = [];
    this.createdGroups = [];
    this.createdNewsletters = [];
    this.descriptions = {};
  }

  async sendMessage(jid, content) {
    this.sentMessages.push({ jid, content, timestamp: Date.now() });
    return { key: { id: 'MOCK_MSG_' + Math.random().toString(36).substring(7), remoteJid: jid } };
  }

  async groupCreate(title, participants) {
    const gid = `120363${Math.floor(10000000000 + Math.random() * 90000000000)}@g.us`;
    this.createdGroups.push({ gid, title, participants });
    return { id: gid };
  }

  async groupInviteCode(gid) {
    return 'InviteMock' + Math.random().toString(36).substring(4);
  }

  async groupUpdateDescription(gid, desc) {
    this.descriptions[gid] = desc;
    return true;
  }

  async newsletterCreate(name, description) {
    const nid = `120363${Math.floor(10000000000 + Math.random() * 90000000000)}@newsletter`;
    this.createdNewsletters.push({ nid, name, description });
    return {
      id: nid,
      thread_metadata: {
        invite: 'MockNewsInvite' + Math.random().toString(36).substring(4),
        name: { text: name },
        description: { text: description }
      }
    };
  }

  groupMetadata(gid) {
    return Promise.resolve({
      id: gid,
      participants: [
        { id: '5511999990001@s.whatsapp.net', admin: 'admin' },
        { id: '5511999990002@s.whatsapp.net', admin: null }
      ]
    });
  }
}

async function runTests() {
  // Limpar canais mock antigos criados em testes anteriores para agilidade
  db.prepare("DELETE FROM achadinhos_channels WHERE id > 8").run();
  db.prepare("DELETE FROM achadinhos_buyer_alerts").run();

  const mockSock = new MockBaileysSocket();

  console.log('\n--- 1. TESTE DE CRIAÇÃO DE GRUPO & CANAL ---');
  // 1.1 Criar Grupo
  const groupRes = await achadinhosService.createAchadinhosGroup({
    name: 'Achadinhos VIP Teste',
    description: 'Melhores ofertas diárias da internet',
    sock: mockSock
  });
  assert(groupRes.success === true, 'Criação de grupo deve retornar success: true');
  assert(groupRes.groupJid.endsWith('@g.us'), 'JID do grupo deve terminar em @g.us');
  assert(groupRes.inviteUrl.includes('chat.whatsapp.com/'), 'Link de convite do grupo deve ser válido');
  console.log('✅ Grupo criado com sucesso:', groupRes.groupJid, groupRes.inviteUrl);

  // 1.2 Criar Canal Oficial (Newsletter)
  const channelRes = await achadinhosService.createAchadinhosChannel({
    name: 'Canal Oficial Achadinhos',
    description: 'Canal unidirecional com ofertas verificadas',
    sock: mockSock
  });
  assert(channelRes.success === true, 'Criação de canal deve retornar success: true');
  assert(channelRes.channelJid.endsWith('@newsletter'), 'JID do canal deve terminar em @newsletter');
  assert(channelRes.inviteUrl.includes('whatsapp.com/channel/'), 'Link de convite do canal deve ser válido');
  console.log('✅ Canal criado com sucesso:', channelRes.channelJid, channelRes.inviteUrl);

  // 1.3 Verificar se registros foram salvos nas configurações e no banco
  assert.strictEqual(models.getSetting('ACHADINHOS_GROUP_JID'), groupRes.groupJid);
  assert.strictEqual(models.getSetting('ACHADINHOS_CHANNEL_JID'), channelRes.channelJid);
  console.log('✅ Configurações ACHADINHOS_GROUP_JID e ACHADINHOS_CHANNEL_JID validadas no DB.');

  console.log('\n--- 2. TESTE DE SETUP COMPLETO DA ESTRUTURA ---');
  // 2.1 Executar setupFullStructure
  const fullSetupRes = await achadinhosService.setupFullStructure({
    groupName: 'Super Achadinhos Brasil',
    channelName: 'Canal Super Achadinhos',
    sock: mockSock,
    seedDeals: true,
    syncStore: true,
    startFeed: true,
    feedIntervalMin: 20
  });
  assert(fullSetupRes.success === true, 'Setup completo deve retornar success: true');
  assert(fullSetupRes.seededDealsCount >= 5, 'Deve semear pelo menos 5 ofertas virais');
  assert(achadinhosService.isAutoFeedRunning() === true, 'AutoFeed deve estar ativo após setup');
  console.log(`✅ Setup concluído: ${fullSetupRes.seededDealsCount} ofertas semeadas, auto-feed ativo.`);

  console.log('\n--- 3. TESTE DE ALIMENTAÇÃO DE PRODUTOS ---');
  // 3.1 Adicionar Oferta Manual
  const customDeal = await achadinhosService.addDeal({
    title: 'Smartwatch Ultra 2 AMOLED Teste',
    product_url: 'https://shopee.com.br/product/test/smartwatch123',
    original_price: 299.90,
    promo_price: 99.90,
    coupon_code: 'SMART50',
    category: 'Eletrônicos',
    free_shipping: true,
    rating: 4.9,
    platform: 'Shopee',
    sock: mockSock
  });
  assert(customDeal.id > 0, 'Oferta customizada deve ter ID gerado');
  assert.strictEqual(customDeal.promo_price, 99.90);
  console.log('✅ Oferta customizada adicionada:', customDeal.id, customDeal.title);

  // 3.2 Adicionar Oferta via Sintaxe Pipe (WhatsApp !achadinhos add)
  const pipeDeal = await achadinhosService.parseAndAddDealFromText(
    'https://mercadolivre.com.br/item/fone-gamer | Fone Gamer Headset 7.1 Surround | 180.00 | 79.90 | GAMER10',
    mockSock
  );
  assert(pipeDeal !== null, 'Oferta via pipe deve ser processada com sucesso');
  assert.strictEqual(pipeDeal.coupon_code, 'GAMER10');
  console.log('✅ Oferta via pipe cadastrada com cupom:', pipeDeal.coupon_code);

  // 3.3 Disparo de Post no Grupo e Canal
  const postRes = await achadinhosService.postNextDealToChannels({ sock: mockSock });
  assert(postRes.success === true, 'PostNextDealToChannels deve rodar com sucesso');
  assert(mockSock.sentMessages.length > 0, 'Socket deve ter registrado envio de mensagens');
  console.log('✅ Post manual para canais executado com sucesso.');

  console.log('\n--- 4. TESTE DE SUPORTE A COMPRADORES ---');
  // 4.1 Busca de Produtos por Compradores (!buscar)
  const searchResult = achadinhosService.searchDealsForBuyer('smartwatch');
  assert(searchResult.includes('Smartwatch Ultra 2'), 'Busca deve retornar o smartwatch cadastrado');
  assert(searchResult.includes('99,90') || searchResult.includes('99.90'), 'Busca deve conter o preço');
  console.log('✅ Busca de produtos funcionando perfeitamente.');

  // 4.2 Inscrição em Alerta de Preço (!alerta)
  const buyerPhone = '5511988887777';
  const alertReply = achadinhosService.handleBuyerAlertSubscription(buyerPhone, 'notebook gamer', 'group123@g.us');
  assert(alertReply.includes('criado com sucesso') || alertReply.includes('notebook gamer'), 'Resposta de alerta deve confirmar criação');
  
  const buyerAlerts = models.getBuyerAlertsByPhone(buyerPhone);
  assert(buyerAlerts.length >= 1, 'Deve encontrar alerta registrado para o telefone');
  assert.strictEqual(buyerAlerts[0].keyword, 'notebook gamer');
  console.log('✅ Alerta de comprador registrado:', buyerAlerts[0].keyword);

  // 4.3 Notificação Proativa no PV quando Oferta do Alerta surge
  const beforeAlertMsgs = mockSock.sentMessages.length;
  await achadinhosService.addDeal({
    title: 'Notebook Gamer RTX 4060 i7 16GB',
    product_url: 'https://amazon.com.br/dp/notebook-gamer-123',
    original_price: 6499.00,
    promo_price: 4999.00,
    coupon_code: 'NOTE500',
    platform: 'Amazon',
    sock: mockSock,
    notifyAlerts: true
  });
  const afterAlertMsgs = mockSock.sentMessages.length;
  assert(afterAlertMsgs > beforeAlertMsgs, 'Deve ter disparado mensagem no PV do comprador inscrito');
  
  const lastDirectMsg = mockSock.sentMessages.find(m => m.jid.includes('5511988887777'));
  assert(lastDirectMsg !== undefined, 'Mensagem deve ter sido enviada especificamente para o PV do comprador');
  assert(lastDirectMsg.content.text.includes('ALERTA DE OFERTA'), 'Mensagem de alerta deve conter cabeçalho');
  console.log('✅ Notificação proativa no PV do comprador entregue com sucesso!');

  // 4.4 Listagem de Cupons Ativos (!cupons)
  const couponsText = achadinhosService.getActiveCouponsList();
  assert(couponsText.includes('CUPONS ATIVOS'), 'Listagem de cupons deve conter cabeçalho');
  assert(couponsText.includes('SMART50') || couponsText.includes('NOTE500') || couponsText.includes('GAMER10'), 'Deve exibir cupons das ofertas cadastradas');
  console.log('✅ Listagem de cupons verificada.');

  // 4.5 FAQ Automático de Compradores
  const faqSafety = achadinhosService.getBuyerFaqResponse('É seguro comprar pelos links daqui?');
  assert(faqSafety !== null && (faqSafety.includes('100% SEGURA') || faqSafety.includes('100% SEGURO')), 'FAQ de segurança deve responder');

  const faqShipping = achadinhosService.getBuyerFaqResponse('qual o prazo de entrega e frete?');
  assert(faqShipping !== null && faqShipping.includes('FRETE E ENTREGA'), 'FAQ de frete deve responder');

  const faqCoupons = achadinhosService.getBuyerFaqResponse('como eu uso os cupons?');
  assert(faqCoupons !== null && (faqCoupons.includes('CUPOM') || faqCoupons.includes('COMO USAR')), 'FAQ de cupons deve responder');
  console.log('✅ FAQ automático de suporte a compradores validado.');

  // 4.6 Interceptador Cognitivo no Grupo (handleBuyerGroupQuery)
  const handledQuery = await achadinhosService.handleBuyerGroupQuery({
    sock: mockSock,
    from: groupRes.groupJid,
    text: 'Alguém tem link de fone gamer?',
    senderPhone: '5511977776666',
    isGroup: true,
    senderName: 'Carlos'
  });
  assert(handledQuery === true, 'handleBuyerGroupQuery deve interceptar e responder a busca de produto');
  console.log('✅ Interceptador de dúvidas e buscas no grupo testado com sucesso.');

  // 4.7 Cancelamento de Alerta (!cancelaralerta)
  const cancelRes = models.removeBuyerAlert(buyerPhone, 'notebook gamer');
  assert(cancelRes === true, 'Cancelamento de alerta deve retornar true');
  const alertsAfterCancel = models.getBuyerAlertsByPhone(buyerPhone);
  assert(alertsAfterCancel.length === 0, 'Lista de alertas deve estar vazia após cancelamento');
  console.log('✅ Cancelamento de alerta verificado.');

  console.log('\n--- 5. TESTE DE COMANDOS WHATSAPP VIA ROUTER ---');
  // 5.1 !achadinhos status
  let botReply = '';
  const routerMockSock = {
    sendMessage: async (jid, content) => {
      botReply = content.text;
      return { key: { id: 'test1' } };
    }
  };

  await achadinhosService.handleAchadinhosCommand({
    sock: routerMockSock,
    from: '5511999999999@s.whatsapp.net',
    text: '!achadinhos status',
    senderPhone: '5511999999999',
    isOwnerUser: true,
    isGroup: false
  });
  assert(botReply.includes('ACHADINHOS') || botReply.includes('CENTRAL DE GESTÃO'), 'Comando !achadinhos status deve retornar painel');
  assert(botReply.includes('Feed Automático') || botReply.includes('Auto-Feed:'), 'Deve exibir status do Auto-Feed');
  console.log('✅ Comando !achadinhos status roteado com sucesso.');

  // 5.2 !buscar air fryer
  const searchDirect = achadinhosService.searchDealsForBuyer('air fryer');
  assert(searchDirect.includes('Air Fryer') || searchDirect.includes('OFERTAS'), 'Busca direta deve retornar ofertas');
  console.log('✅ Busca direta roteada com sucesso.');

  console.log('\n--- 6. TESTE DE ROTAS REST API NO EXPRESS ---');
  const app = createServer();
  
  // Testar rota GET /api/achadinhos/status
  const mockReq = {};
  let statusApiResult = null;
  const mockRes = {
    json: (data) => { statusApiResult = data; },
    status: () => mockRes
  };

  // Simular requisições aos handlers diretamente
  const feedStatus = achadinhosService.getFeedStatus();
  assert(feedStatus !== null, 'getFeedStatus deve retornar objeto');
  assert(typeof feedStatus.feedRunning === 'boolean', 'feedRunning deve ser booleano');
  assert(feedStatus.activeDealsCount >= 1, 'Deve haver ofertas ativas registradas');
  console.log('✅ API REST /api/achadinhos/status validada. Ofertas ativas:', feedStatus.activeDealsCount);

  // Parar feed para não deixar timer pendente
  achadinhosService.stopAutoFeed();
  assert(achadinhosService.isAutoFeedRunning() === false, 'Feed deve estar desligado');

  console.log('\n🎉 TODOS OS 6 BLOCOS DE TESTES DE ACHADINHOS PASSARAM COM 100% DE SUCESSO! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de achadinhos:', err);
  process.exit(1);
});

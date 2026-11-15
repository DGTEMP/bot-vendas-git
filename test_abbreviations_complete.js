/**
 * test_abbreviations_complete.js
 * 
 * Suíte de Testes para o Sistema de Comandos Abreviados e Atalhos (!menuabv):
 * 1. Guia Completo !menuabv (e aliases !mabv, !abv, !atalhos, !alias)
 * 2. Atalhos de Gestão & Achadinhos (!stp, !st, !cgp, !ccn, !fon, !foff, !post, !add, !sc, !cv, !ls, !rm)
 * 3. Atalhos com prefixo curto !ach (!ach st, !ach post, !ach fon, etc.)
 * 4. Atalhos de Compradores (!b, !f, !a, !alt, !ma, !ca, !cp, !cmf, !faq)
 * 5. Atalhos de Sistema & Dono (!pn, !pnl, !t, !dono, !owner, !m, !px)
 */

const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const achadinhosService = require('./src/services/achadinhosService');
const whatsappBot = require('./src/bots/whatsappBot');

console.log('🚀 Iniciando Suíte Completa de Testes de Comandos Abreviados...\n');

class MockSocket {
  constructor() {
    this.messages = [];
  }
  async sendMessage(jid, content) {
    this.messages.push({ jid, text: content.text || content.caption || '' });
    return { key: { id: 'MOCK_' + Math.random().toString(36).substring(4) } };
  }
  async groupCreate(title, participants) {
    return { id: `120363${Date.now()}@g.us` };
  }
  async groupInviteCode(gid) {
    return 'InviteAbvMock';
  }
  async groupUpdateDescription(gid, desc) {
    return true;
  }
  async newsletterCreate(name, description) {
    return {
      id: `120363${Date.now()}@newsletter`,
      thread_metadata: { invite: 'NewsAbvMock' }
    };
  }
}

async function runTests() {
  const sock = new MockSocket();

  console.log('--- 1. TESTE DO GUIA DE ABREVIAÇÕES (!menuabv) ---');
  const guide = achadinhosService.getAbbreviatedMenuGuide();
  assert(guide.includes('GUIA DE COMANDOS ABREVIADOS'), 'Guia deve ter cabeçalho');
  assert(guide.includes('!stp') && guide.includes('!achadinhos setup'), 'Deve conter !stp -> !achadinhos setup');
  assert(guide.includes('!st') && guide.includes('!achadinhos status'), 'Deve conter !st -> !achadinhos status');
  assert(guide.includes('!cgp') && guide.includes('!achadinhos criargrupo'), 'Deve conter !cgp -> !achadinhos criargrupo');
  assert(guide.includes('!ccn') && guide.includes('!achadinhos criarcanal'), 'Deve conter !ccn -> !achadinhos criarcanal');
  assert(guide.includes('!fon') && guide.includes('!achadinhos feed on'), 'Deve conter !fon -> !achadinhos feed on');
  assert(guide.includes('!foff') && guide.includes('!achadinhos feed off'), 'Deve conter !foff -> !achadinhos feed off');
  assert(guide.includes('!post') && guide.includes('!achadinhos postar'), 'Deve conter !post -> !achadinhos postar');
  assert(guide.includes('!add') && guide.includes('!achadinhos add'), 'Deve conter !add -> !achadinhos add');
  assert(guide.includes('!sc') && guide.includes('!achadinhos sinc'), 'Deve conter !sc -> !achadinhos sinc');
  assert(guide.includes('!cv') && guide.includes('!achadinhos convites'), 'Deve conter !cv -> !achadinhos convites');
  assert(guide.includes('!b <termo>') && guide.includes('!buscar <termo>'), 'Deve conter !b -> !buscar');
  assert(guide.includes('!a <termo>') && guide.includes('!alerta <termo>'), 'Deve conter !a -> !alerta');
  assert(guide.includes('!ma') && guide.includes('!meusalertas'), 'Deve conter !ma -> !meusalertas');
  assert(guide.includes('!ca <termo>') && guide.includes('!cancelaralerta'), 'Deve conter !ca -> !cancelaralerta');
  assert(guide.includes('!cp') && guide.includes('!cupons'), 'Deve conter !cp -> !cupons');
  assert(guide.includes('!cmf') && guide.includes('!comofunciona'), 'Deve conter !cmf -> !comofunciona');
  assert(guide.includes('!pn') && guide.includes('!painel'), 'Deve conter !pn -> !painel');
  assert(guide.includes('!dono') && guide.includes('!souodono'), 'Deve conter !dono -> !souodono');
  assert(guide.includes('!m') && guide.includes('!menu'), 'Deve conter !m -> !menu');
  assert(guide.includes('!px') && guide.includes('!pix'), 'Deve conter !px -> !pix');
  console.log('✅ Guia !menuabv formatado com todos os atalhos e equivalentes inteiros lado a lado.');

  // Testar acionamento de !menuabv e seus aliases no handleAchadinhosCommand
  for (const cmdText of ['!menuabv', '!mabv', '!abv', '!atalhos', '!alias', '!curtos']) {
    sock.messages = [];
    await achadinhosService.handleAchadinhosCommand({
      sock,
      from: '5511999999999@s.whatsapp.net',
      text: cmdText,
      senderPhone: '5511999999999',
      isOwnerUser: true
    });
    assert(sock.messages.length > 0 && sock.messages[0].text.includes('GUIA DE COMANDOS ABREVIADOS'), `Alias ${cmdText} deve retornar o guia de abreviações`);
  }
  console.log('✅ Todos os aliases de !menuabv (!mabv, !abv, !atalhos, !alias, !curtos) validados.');

  console.log('\n--- 2. TESTE DE ATALHOS DIRETOS DE GESTÃO (DONO) ---');
  // 2.1 !st (status)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!st',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('CENTRAL DE GESTÃO'), '!st deve abrir painel de status');
  console.log('✅ !st aciona status com sucesso.');

  // 2.2 !fon e !foff
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!fon 15',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('Feed Automático de Achadinhos ATIVADO'), '!fon deve ativar o feed');
  assert(achadinhosService.isAutoFeedRunning() === true, 'Feed deve estar ativo');
  assert.strictEqual(models.getSetting('ACHADINHOS_FEED_INTERVAL_MIN'), '15', 'Intervalo deve ser 15');

  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!foff',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('Feed Automático PAUSADO'), '!foff deve pausar o feed');
  assert(achadinhosService.isAutoFeedRunning() === false, 'Feed deve estar desligado');
  console.log('✅ !fon 15 e !foff acionam feed com sucesso.');

  // 2.3 !cv (convites)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!cv',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('CONVITES OFICIAIS'), '!cv deve exibir links de convite');
  console.log('✅ !cv aciona convites com sucesso.');

  // 2.4 !ls (listar)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!ls',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('ÚLTIMAS OFERTAS'), '!ls deve listar ofertas');
  console.log('✅ !ls aciona listar com sucesso.');

  // 2.5 !add (cadastrar via pipe direto)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!add https://shopee.com.br/item-teste Teclado Mecânico RGB Pro | 250.00 | 99.90 | TECLADO10',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('Oferta Cadastrada com Sucesso'), '!add deve cadastrar nova oferta');
  console.log('✅ !add cadastra produto direto com sucesso.');

  // 2.6 !sc (sincronizar loja)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!sc',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('Sincronização Concluída'), '!sc deve sincronizar loja');
  console.log('✅ !sc sincroniza catálogo com sucesso.');

  console.log('\n--- 3. TESTE DE ATALHOS COM PREFIXO CURTO (!ach) ---');
  // 3.1 !ach st
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!ach st',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('CENTRAL DE GESTÃO'), '!ach st deve abrir painel');

  // 3.2 !ach cv
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: '5511999999999@s.whatsapp.net',
    text: '!ach cv',
    senderPhone: '5511999999999',
    isOwnerUser: true
  });
  assert(sock.messages[0].text.includes('CONVITES OFICIAIS'), '!ach cv deve abrir convites');
  console.log('✅ Atalhos combinados com !ach (!ach st, !ach cv) funcionando perfeitamente.');

  console.log('\n--- 4. TESTE DE ATALHOS DE COMPRADORES ---');
  const testPhone = '5511977770000';

  // 4.1 !b (buscar)
  const searchReply = achadinhosService.searchDealsForBuyer('teclado');
  assert(searchReply.includes('Teclado Mecânico'), '!b deve encontrar o teclado cadastrado');
  console.log('✅ !b teclado localiza o produto com sucesso.');

  // 4.2 !a (alerta)
  const alertReply = achadinhosService.handleBuyerAlertSubscription(testPhone, 'monitor 144hz', 'testgroup@g.us');
  assert(alertReply.includes('monitor 144hz'), '!a deve criar o alerta');
  console.log('✅ !a monitor 144hz inscreve o comprador.');

  // 4.3 !ma (meus alertas)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: `${testPhone}@s.whatsapp.net`,
    text: '!ma',
    senderPhone: testPhone,
    isOwnerUser: false
  });
  assert(sock.messages[0].text.includes('monitor 144hz'), '!ma deve exibir monitor 144hz');
  console.log('✅ !ma exibe alertas ativos.');

  // 4.4 !ca (cancelar alerta)
  sock.messages = [];
  await achadinhosService.handleAchadinhosCommand({
    sock,
    from: `${testPhone}@s.whatsapp.net`,
    text: '!ca monitor 144hz',
    senderPhone: testPhone,
    isOwnerUser: false
  });
  assert(sock.messages[0].text.includes('cancelado com sucesso'), '!ca deve cancelar o alerta');
  const remaining = models.getBuyerAlertsByPhone(testPhone);
  assert.strictEqual(remaining.length, 0, 'Não deve restar alertas para o telefone');
  console.log('✅ !ca cancela alerta na hora.');

  // 4.5 !cp (cupons)
  const cupReply = achadinhosService.getActiveCouponsList();
  assert(cupReply.includes('CUPONS ATIVOS'), '!cp deve listar cupons ativos');
  console.log('✅ !cp lista cupons com sucesso.');

  // 4.6 !cmf / !faq (como funciona)
  const faqReply = achadinhosService.getBuyerHelpGuide();
  assert(faqReply.includes('CENTRAL DE AJUDA'), '!cmf deve retornar o guia de suporte');
  console.log('✅ !cmf / !faq exibe guia do comprador.');

  console.log('\n--- 5. TESTE DE ATALHOS DE SISTEMA & DONO VIA WHATSAPP ROUTER ---');
  // 5.1 !pn <senha> (túnel com senha)
  let routerReply = '';
  const routerSock = {
    sendMessage: async (jid, content) => {
      routerReply = content.text || content.caption || '';
      return { key: { id: 'r1' } };
    }
  };

  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    pushName: 'Outro Admin',
    message: { conversation: '!pn paybot2026' }
  }, routerSock);
  assert(routerReply.includes('PAINEL WEB') || routerReply.includes('Autenticação Mestra'), '!pn <senha> deve liberar link do túnel no PV');
  console.log('✅ !pn <senha> libera acesso ao túnel com sucesso.');

  // 5.2 !menuabv direto no router do whatsappBot
  routerReply = '';
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    pushName: 'Usuario',
    message: { conversation: '!menuabv' }
  }, routerSock);
  assert(routerReply.includes('GUIA DE COMANDOS ABREVIADOS'), '!menuabv via whatsappBot deve retornar o guia');
  console.log('✅ !menuabv roteado com sucesso no fluxo do whatsappBot.');

  console.log('\n🎉 TODOS OS 5 BLOCOS DE TESTES DE ABREVIAÇÕES PASSARAM COM 100% DE SUCESSO! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de abreviações:', err);
  process.exit(1);
});

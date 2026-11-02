const assert = require('assert');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const tunnelService = require('./src/services/tunnelService');

// Simula tunnel ativo para o teste
tunnelService.url = 'https://exclusive-owner-tunnel.trycloudflare.com';

const ownerPhone = '554884702848';
const strangerPhone = '5511999998888';

console.log('====================================================');
console.log('🔒 TESTES DE SEGURANÇA: ISOLAMENTO DO TÚNEL E PAINEL');
console.log('====================================================');

let testsPassed = 0;

async function runSecurityTests() {
  // Teste 1: !ping de usuário comum NÃO pode ter URLs, localhost, nem dados de infra
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Estranho',
      message: { conversation: '!ping' }
    }, mockSock);

    assert(sentMsg, 'Mensagem de ping deve ter sido enviada');
    assert(!sentMsg.includes('http'), 'Ping de usuário comum NÃO pode conter URL http');
    assert(!sentMsg.includes('localhost'), 'Ping de usuário comum NÃO pode conter localhost');
    assert(!sentMsg.includes('trycloudflare.com'), 'Ping de usuário comum NÃO pode conter cloudflare');
    assert(!sentMsg.includes('Memória RAM'), 'Ping de usuário comum NÃO pode expor RAM');
    assert(!sentMsg.includes('Rede Multi-Device'), 'Ping de usuário comum NÃO pode expor chips');
    assert(sentMsg.includes('PONG'), 'Deve conter PONG');
    console.log('✅ [TESTE 1] !ping de usuário comum não vaza nenhuma URL nem dados de infraestrutura');
    testsPassed++;
  }

  // Teste 2: !ping do Dono mostra diagnóstico mas NÃO expõe a URL do túnel no corpo
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${ownerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Dono',
      message: { conversation: '!ping' }
    }, mockSock);

    assert(sentMsg, 'Mensagem de ping do Dono deve ter sido enviada');
    assert(sentMsg.includes('PONG') && sentMsg.includes('DIAGNÓSTICO'), 'Deve conter PONG DIAGNÓSTICO para Dono');
    assert(sentMsg.includes('Memória RAM'), 'Deve conter dados de RAM para Dono');
    assert(!sentMsg.includes('trycloudflare.com'), 'Ping do Dono NÃO deve vazar a URL do túnel no ping');
    assert(!sentMsg.includes('localhost:3000'), 'Ping do Dono NÃO deve vazar localhost');
    assert(sentMsg.includes('!painel'), 'Deve instruir o dono a usar !painel confidencial');
    console.log('✅ [TESTE 2] !ping do Dono exibe diagnóstico de RAM/Chips e protege a URL do túnel');
    testsPassed++;
  }

  // Teste 3: !tunnel ou !painel por usuário comum deve ser BLOQUEADO com ACESSO NEGADO
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Estranho',
      message: { conversation: '!tunnel' }
    }, mockSock);

    assert(sentMsg, 'Mensagem deve ser respondida');
    assert(sentMsg.includes('ACESSO NEGADO'), 'Usuário comum deve receber ACESSO NEGADO no !tunnel');
    assert(!sentMsg.includes('trycloudflare.com'), 'Não pode conter URL do túnel');
    assert(!sentMsg.includes('localhost'), 'Não pode conter localhost');
    console.log('✅ [TESTE 3] !tunnel executado por terceiro é bloqueado com ACESSO NEGADO');
    testsPassed++;
  }

  // Teste 4: !painel por usuário comum deve ser BLOQUEADO com ACESSO NEGADO
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Estranho',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(sentMsg, 'Mensagem deve ser respondida');
    assert(sentMsg.includes('ACESSO NEGADO'), 'Usuário comum deve receber ACESSO NEGADO no !painel');
    assert(!sentMsg.includes('trycloudflare.com'), 'Não pode conter URL do túnel');
    console.log('✅ [TESTE 4] !painel executado por terceiro é bloqueado com ACESSO NEGADO');
    testsPassed++;
  }

  // Teste 5: !painel pelo Dono em GRUPO NÃO expõe a URL no grupo; envia ao PV do Dono
  {
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, text: content.text });
      }
    };
    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '1203630283748291@g.us',
        participant: `${ownerPhone}@s.whatsapp.net`,
        fromMe: false
      },
      pushName: 'Dono',
      message: { conversation: '!painel' }
    }, mockSock);

    // Deve ter enviado 2 mensagens: 1 no PV com o link, 1 no Grupo avisando que foi pro PV
    assert.strictEqual(sentMessages.length, 2, 'Deve enviar mensagem no PV e aviso no grupo');
    const groupReply = sentMessages.find(m => m.jid === '1203630283748291@g.us');
    const pvReply = sentMessages.find(m => m.jid.includes(ownerPhone));

    assert(groupReply, 'Deve haver resposta no grupo');
    assert(!groupReply.text.includes('trycloudflare.com'), 'Resposta no grupo NÃO pode conter link do túnel');
    assert(!groupReply.text.includes('localhost:3000'), 'Resposta no grupo NÃO pode conter localhost');
    assert(groupReply.text.includes('Privado'), 'Grupo é informado que link foi pro Privado');

    assert(pvReply, 'Deve haver mensagem enviada ao privado do Dono');
    assert(pvReply.text.includes('trycloudflare.com'), 'Mensagem no PV do Dono deve conter o link do túnel');
    console.log('✅ [TESTE 5] !painel chamado pelo Dono em grupo despacha link confidencial para o PV');
    testsPassed++;
  }

  // Teste 6: !painel pelo Dono no Privado (PV) entrega o link direto
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${ownerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Dono',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(sentMsg, 'Mensagem deve ser respondida no PV');
    assert(sentMsg.includes('trycloudflare.com'), 'Dono no PV recebe o link do túnel');
    assert(sentMsg.includes('PAINEL WEB & ACESSO REMOTO'), 'Dono recebe cabeçalho do painel');
    console.log('✅ [TESTE 6] !painel chamado pelo Dono em PV entrega o link do painel imediatamente');
    testsPassed++;
  }

  // Teste 7: !help ou !comandos por usuário comum NÃO contém !tunnel nem Painel Web
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${strangerPhone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Estranho',
      message: { conversation: '!comandos' }
    }, mockSock);

    assert(sentMsg, 'Mensagem de comandos deve ser respondida');
    assert(!sentMsg.includes('!tunnel'), 'Menu público NÃO pode sugerir !tunnel');
    assert(!sentMsg.includes('trycloudflare.com'), 'Menu público NÃO pode conter URL do túnel');
    assert(!sentMsg.includes('Painel Web:'), 'Menu público NÃO pode conter URL do painel web');
    assert(sentMsg.includes('CATÁLOGO DE COMANDOS'), 'Contém catálogo de comandos');
    console.log('✅ [TESTE 7] !comandos para usuário comum não lista !tunnel nem expõe Painel Web');
    testsPassed++;
  }

  // Teste 8: !help pelo Dono em GRUPO NÃO expõe a URL do Painel Web
  {
    let sentMsg = null;
    const mockSock = {
      sendMessage: async (jid, content) => { sentMsg = content.text; }
    };
    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: '1203630283748291@g.us',
        participant: `${ownerPhone}@s.whatsapp.net`,
        fromMe: false
      },
      pushName: 'Dono',
      message: { conversation: '!help' }
    }, mockSock);

    assert(sentMsg, 'Mensagem de comandos deve ser respondida');
    assert(!sentMsg.includes('trycloudflare.com'), 'Menu no grupo NÃO pode exibir a URL do túnel');
    assert(!sentMsg.includes('http://localhost:3000'), 'Menu no grupo NÃO pode exibir localhost');
    console.log('✅ [TESTE 8] !help executado pelo Dono em grupo omite links de painel web no grupo');
    testsPassed++;
  }

  console.log('====================================================');
  console.log(`🎉 TODOS OS ${testsPassed} TESTES DE SEGURANÇA PASSARAM COM SUCESSO!`);
  console.log('====================================================');
}

runSecurityTests().catch(err => {
  console.error('❌ Falha no teste de segurança:', err);
  process.exit(1);
});

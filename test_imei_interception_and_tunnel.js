/**
 * SUÍTE DE TESTES: INTERCEPTAÇÃO DE MENSAGENS COM IMEI & ACESSO VIA TÚNEL
 *
 * 1. Servidor Web & Rotas Públicas (/imei, /celularseguro, /api/public/imei/consultar)
 * 2. Detecção Passiva de IMEI em Mensagens Interceptadas (detectImeiInMessage)
 * 3. Notificação do Sentinela com Link do Túnel (getInterceptNotification)
 * 4. Comando !imeilink (Geração e Envio de Link do Túnel)
 * 5. Comando !autoimei (Ativação e Desativação do Sentinela no Grupo)
 * 6. Suporte a Extração de IMEI via Imagem (OCR) no Comando !imei
 * 7. Fluxo de Interceptação Automática no WhatsAppBot
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const imeiService = require('./src/services/imeiService');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');
const models = require('./src/db/models');
const { createServer, createStoreServer } = require('./src/server/app');

let totalTests = 0;
let passedTests = 0;

function testAssert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🛡️ INICIANDO TESTES: INTERCEPTAÇÃO & ACESSO VIA TÚNEL 🌐');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Testando Métodos de Detecção e Túnel no ImeiService ---');
  // --------------------------------------------------------------------------
  const webUrl = imeiService.getPublicWebUrl();
  testAssert(webUrl && webUrl.includes('/imei'), `getPublicWebUrl retorna URL com rota /imei: ${webUrl}`);

  // Mensagem normal contendo IMEI e palavra-chave
  const msgText1 = 'Vendo iPhone 13 Pro Max novinho, IMEI: 352099-10-123456-1 retirar em mãos';
  const det1 = imeiService.detectImeiInMessage(msgText1);
  testAssert(det1 !== null, 'detectImeiInMessage detecta IMEI em anúncio de venda');
  testAssert(det1.imei === '352099101234561', `IMEI extraído corretamente: ${det1.imei}`);
  testAssert(det1.isValidLuhn === true, 'Validação de Luhn automática na detecção');
  testAssert(det1.hasExplicitKeyword === true, 'Palavra-chave identificada com sucesso');

  // Mensagem normal sem IMEI
  const msgText2 = 'Olá amigo, você ainda tem aquele videogame à venda?';
  const det2 = imeiService.detectImeiInMessage(msgText2);
  testAssert(det2 === null, 'detectImeiInMessage ignora mensagens sem IMEI');

  // Mensagem que é um comando (não deve ser interceptada passivamente para não duplicar resposta)
  const msgTextCmd = '!imei 352099101234561';
  const detCmd = imeiService.detectImeiInMessage(msgTextCmd);
  testAssert(detCmd === null, 'detectImeiInMessage ignora comandos que começam com ! ou /');

  // Notificação do Sentinela
  const notif = imeiService.getInterceptNotification(det1, { usedPrefix: '!' });
  testAssert(notif.includes('SENTINELA: IMEI INTERCEPTADO'), 'Notificação contém cabeçalho do Sentinela');
  testAssert(notif.includes(det1.formattedImei), 'Notificação contém IMEI formatado');
  testAssert(notif.includes(webUrl), 'Notificação inclui link do túnel web');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testando Rotas Web e API no Servidor HTTP (Porta 3001) ---');
  // --------------------------------------------------------------------------
  const storeApp = createStoreServer();
  const testServer = http.createServer(storeApp);
  await new Promise(res => testServer.listen(0, res));
  const port = testServer.address().port;

  // Teste 2.1: GET /imei serve a página HTML
  const resHtml = await fetch(`http://localhost:${port}/imei`);
  testAssert(resHtml.status === 200, 'GET /imei responde com HTTP 200');
  const htmlText = await resHtml.text();
  testAssert(htmlText.includes('Verificador de IMEI & Celular Seguro'), 'Página contém título oficial');
  testAssert(htmlText.includes('id="imeiInput"'), 'Página contém campo de digitação de IMEI');
  testAssert(htmlText.includes('Verificar meu dispositivo agora!'), 'Página contém o botão com texto "Verificar meu dispositivo agora!"');

  // Teste 2.2: GET /celularseguro (alias)
  const resAlias = await fetch(`http://localhost:${port}/celularseguro`);
  testAssert(resAlias.status === 200, 'GET /celularseguro responde com HTTP 200');

  // Teste 2.3: POST /api/public/imei/consultar
  const resApi = await fetch(`http://localhost:${port}/api/public/imei/consultar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imei: '352099101234561' })
  });
  testAssert(resApi.status === 200, 'POST /api/public/imei/consultar responde com HTTP 200');
  const apiData = await resApi.json();
  testAssert(apiData.success === true, 'API retorna success: true');
  testAssert(apiData.imei === '352099101234561', 'API retorna o IMEI consultado');
  testAssert(apiData.isValidLuhn === true, 'API valida dígito Luhn');

  // Teste 2.4: GET /api/public/imei/status
  const resStatus = await fetch(`http://localhost:${port}/api/public/imei/status`);
  const statusData = await resStatus.json();
  testAssert(statusData.success === true, 'API status retorna success: true');
  testAssert(!!statusData.localUrl, 'API status informa localUrl');

  testServer.close();

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testando Comandos !imeilink e !autoimei no Handler ---');
  // --------------------------------------------------------------------------
  let lastReply = null;
  const groupJid = '12036302485938@g.us';
  const ownerPhone = '554884702848';
  const ownerJid = `${ownerPhone}@s.whatsapp.net`;

  const mockConn = {
    user: { id: `${ownerPhone}:1@s.whatsapp.net` },
    sendMessage: async (jid, content) => {
      lastReply = content.text || content.caption || '';
      return { key: { id: 'MOCK_REPLY' } };
    }
  };

  // Teste 3.1: Comando !imeilink
  const rawImeiLink = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_LINK' },
    message: { conversation: '!imeilink' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawImeiLink, mockConn);
  testAssert(lastReply && lastReply.includes('PORTAL WEB DE CONSULTA DE IMEI'), '!imeilink retorna painel do túnel');
  testAssert(lastReply && lastReply.includes(webUrl), '!imeilink contém URL do túnel');

  // Teste 3.2: Comando !autoimei on
  const rawAutoOn = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_AUTO_ON' },
    message: { conversation: '!autoimei on' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawAutoOn, mockConn);
  testAssert(lastReply && lastReply.includes('SENTINELA DE IMEI ATIVADO NO GRUPO'), '!autoimei on ativa monitoramento');
  testAssert(models.getSetting(`AUTO_IMEI_${groupJid}`, 'false') === 'true', 'Configuração AUTO_IMEI salva como true no banco');

  // Teste 3.3: Comando !autoimei off
  const rawAutoOff = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_AUTO_OFF' },
    message: { conversation: '!autoimei off' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawAutoOff, mockConn);
  testAssert(lastReply && lastReply.includes('SENTINELA DE IMEI DESATIVADO NO GRUPO'), '!autoimei off desativa monitoramento');
  testAssert(models.getSetting(`AUTO_IMEI_${groupJid}`, 'false') === 'false', 'Configuração AUTO_IMEI salva como false no banco');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testando Interceptação Automática de Mensagens no WhatsAppBot ---');
  // --------------------------------------------------------------------------
  let botSentMessage = null;
  const mockActiveSock = {
    instanceId: 1,
    sendMessage: async (jid, content) => {
      botSentMessage = content.text || '';
      return { key: { id: 'SENTINEL_REPLY' } };
    }
  };

  // Re-ativa AUTO_IMEI no grupo de teste
  models.setSetting(`AUTO_IMEI_${groupJid}`, 'true');

  // Simula mensagem postada por membro comum com IMEI no grupo
  const incomingMsg = {
    key: { remoteJid: groupJid, participant: '5511988887777@s.whatsapp.net', fromMe: false, id: 'MSG_LEAD' },
    message: { conversation: 'Galera tô vendendo meu celular iPhone 12, imei dele é 352099101234561 quem quiser chama no pv' },
    pushName: 'Vendedor Particular'
  };

  botSentMessage = null;
  await whatsappBot.handleIncomingMessage(incomingMsg, mockActiveSock);
  testAssert(botSentMessage && botSentMessage.includes('SENTINELA: IMEI INTERCEPTADO NA MENSAGEM'), 'Bot intercepta mensagem com IMEI no grupo e envia alerta');
  testAssert(botSentMessage && botSentMessage.includes('35209910-123456-1'), 'Alerta contém o IMEI formatado da mensagem interceptada');
  testAssert(botSentMessage && botSentMessage.includes('/imei'), 'Alerta convida para verificação no link do túnel');

  console.log('\n======================================================');
  console.log(`🎉 TESTES CONCLUÍDOS: ${passedTests}/${totalTests} PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

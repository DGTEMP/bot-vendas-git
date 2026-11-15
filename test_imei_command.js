/**
 * SUÍTE DE TESTES: COMANDO DE CONSULTA IMEI & CELULAR SEGURO
 * (celularseguro.mj.gov.br / BNCR / Anatel)
 *
 * 1. Algoritmo de Luhn (Base 10) & Dígito Verificador
 * 2. Sanitização, Formatação e Extração de IMEI
 * 3. Análise TAC (Type Allocation Code) & Identificação de Marca
 * 4. Consulta ao Banco Celular Seguro (SEM_RESTRICAO e COM_RESTRICAO)
 * 5. Registro no Handler e Resolução de Aliases (!imei, !celularseguro, etc.)
 * 6. Execução Completa do Comando via Mensagens Baileys
 * 7. Presença nos Menus Oficiais do Bot
 */

process.env.NODE_ENV = 'test';
const imeiService = require('./src/services/imeiService');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');

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
  console.log('📱 INICIANDO TESTES: COMANDO CONSULTA IMEI & CELULAR SEGURO 📱');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Testando Algoritmo de Luhn & Dígito Verificador ---');
  // --------------------------------------------------------------------------
  const base14 = '35209910123456';
  const calculatedCheck = imeiService.calculateLuhnCheckDigit(base14);
  testAssert(calculatedCheck === '1', `Cálculo de Luhn para ${base14} deve retornar '1' (retornou: ${calculatedCheck})`);

  const valid15 = base14 + '1';
  const luhnValid = imeiService.validateLuhn(valid15);
  testAssert(luhnValid.isValid === true, 'IMEI com dígito verificador correto é validado como true');
  testAssert(luhnValid.isComplete === true, 'IMEI de 15 dígitos marcado como completo');

  const invalid15 = base14 + '8';
  const luhnInvalid = imeiService.validateLuhn(invalid15);
  testAssert(luhnInvalid.isValid === false, 'IMEI com dígito verificador incorreto é rejeitado');
  testAssert(luhnInvalid.calculatedCheckDigit === '1', 'Informa o dígito calculado correto');
  testAssert(luhnInvalid.providedCheckDigit === '8', 'Informa o dígito incorreto fornecido');

  const luhn14 = imeiService.validateLuhn(base14);
  testAssert(luhn14.isValid === true, 'Entrada de 14 dígitos é aceita e completada');
  testAssert(luhn14.fullImei === valid15, `Auto-completa com 15º dígito: ${luhn14.fullImei}`);

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testando Sanitização, Formatação e Extração ---');
  // --------------------------------------------------------------------------
  const rawWithMask = '  352099-10-123456-1  ';
  const cleaned = imeiService.cleanImei(rawWithMask);
  testAssert(cleaned === '352099101234561', `Limpeza de caracteres não-numéricos: ${cleaned}`);

  const formatted = imeiService.formatImei('352099101234561');
  testAssert(formatted === '35209910-123456-1', `Formatação legível de IMEI: ${formatted}`);

  const textPrompt = 'olá bot, confere pra mim o imei 352099101234561 por favor';
  const extracted = imeiService.extractImei(textPrompt);
  testAssert(extracted === '352099101234561', `Extração de IMEI dentro de texto livre: ${extracted}`);

  const extractedQuoted = imeiService.extractImei('', 'O número do meu celular é 352099-10-123456-1');
  testAssert(extractedQuoted === '352099101234561', `Extração de IMEI em mensagem citada: ${extractedQuoted}`);

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testando Análise TAC & Identificação de Fabricante ---');
  // --------------------------------------------------------------------------
  const tacApple = imeiService.parseTacInfo('352099101234561');
  testAssert(tacApple.estimatedBrand.includes('Apple'), `TAC 352099 identificado como Apple: ${tacApple.estimatedBrand}`);
  testAssert(tacApple.regulatingBody.includes('BABT'), `RBI 35 identificado como BABT: ${tacApple.regulatingBody}`);

  const tacSamsung = imeiService.parseTacInfo('352978101234568');
  testAssert(tacSamsung.estimatedBrand.includes('Samsung'), `TAC 352978 identificado como Samsung: ${tacSamsung.estimatedBrand}`);

  const tacXiaomi = imeiService.parseTacInfo('862145101234567');
  testAssert(tacXiaomi.estimatedBrand.includes('Xiaomi'), `TAC 862145 identificado como Xiaomi: ${tacXiaomi.estimatedBrand}`);
  testAssert(tacXiaomi.regulatingBody.includes('TAF'), `RBI 86 identificado como TAF China: ${tacXiaomi.regulatingBody}`);

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testando Consulta Celular Seguro (Simulação & Relatório) ---');
  // --------------------------------------------------------------------------
  const reportClean = await imeiService.consultarCelularSeguro('352099101234561', { forceStatus: 'SEM_RESTRICAO' });
  testAssert(reportClean.success === true, 'Consulta sem restrição executada com sucesso');
  testAssert(reportClean.status === 'SEM_RESTRICAO', 'Status SEM_RESTRICAO retornado');
  testAssert(reportClean.formattedMessage.includes('NENHUMA RESTRIÇÃO ENCONTRADA'), 'Mensagem contém aviso de sem restrição');
  testAssert(reportClean.formattedMessage.includes('celularseguro.mj.gov.br'), 'Mensagem contém link oficial celularseguro.mj.gov.br');
  testAssert(reportClean.formattedMessage.includes('consulta-celularseguro.mj.gov.br'), 'Mensagem contém link consulta-celularseguro.mj.gov.br');
  testAssert(reportClean.formattedMessage.includes('anatel.gov.br'), 'Mensagem contém link Anatel');

  const reportStolen = await imeiService.consultarCelularSeguro('352099101234561', { forceStatus: 'COM_RESTRICAO' });
  testAssert(reportStolen.success === true, 'Consulta com restrição executada com sucesso');
  testAssert(reportStolen.status === 'COM_RESTRICAO', 'Status COM_RESTRICAO retornado');
  testAssert(reportStolen.formattedMessage.includes('CELULAR COM RESTRIÇÃO'), 'Mensagem contém alerta explícito de roubo/furto');
  testAssert(reportStolen.formattedMessage.includes('NÃO REALIZE PAGAMENTO'), 'Mensagem adverte para não comprar nem pagar');

  const helpGuide = imeiService.getHelpGuide('!');
  testAssert(helpGuide.includes('*#06#'), 'Guia de ajuda orienta como ver o IMEI (*#06#)');
  testAssert(helpGuide.includes('Dual-SIM'), 'Guia de ajuda orienta sobre celulares Dual-SIM');
  testAssert(helpGuide.includes('!imei'), 'Guia de ajuda contém exemplos de uso');

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testando Registro no Handler & Resolução de Aliases ---');
  // --------------------------------------------------------------------------
  const cmdImei = handler.findCommand('imei');
  testAssert(!!cmdImei, 'Comando !imei registrado no Handler');
  testAssert(handler.findCommand('consultaimei') === cmdImei, 'Alias !consultaimei aponta para !imei');
  testAssert(handler.findCommand('consultarimei') === cmdImei, 'Alias !consultarimei aponta para !imei');
  testAssert(handler.findCommand('celularseguro') === cmdImei, 'Alias !celularseguro aponta para !imei');
  testAssert(handler.findCommand('celularroubado') === cmdImei, 'Alias !celularroubado aponta para !imei');
  testAssert(handler.findCommand('checarimei') === cmdImei, 'Alias !checarimei aponta para !imei');
  testAssert(handler.findCommand('bncr') === cmdImei, 'Alias !bncr aponta para !imei');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Testando Execução do Comando via Mensagens Baileys ---');
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

  // Teste 6.1: Chamada sem parâmetros (deve responder com o guia)
  const rawNoArgs = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_HELP_' + Date.now() },
    message: { conversation: '!imei' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawNoArgs, mockConn);
  testAssert(lastReply && lastReply.includes('COMO CONSULTAR O IMEI DO CELULAR'), '!imei sem argumentos retorna guia explicativo');

  // Teste 6.2: Chamada com IMEI válido
  const rawWithImei = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_IMEI_' + Date.now() },
    message: { conversation: '!imei 352099101234561' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawWithImei, mockConn);
  testAssert(lastReply && lastReply.includes('CONSULTA DE IMEI & CELULAR SEGURO'), '!imei com número retorna relatório de auditoria');
  testAssert(lastReply && lastReply.includes('352099101234561'), 'Relatório contém o IMEI consultado');
  testAssert(lastReply && lastReply.includes('Luhn'), 'Relatório contém o diagnóstico do algoritmo de Luhn');

  // Teste 6.3: Chamada com alias !celularseguro
  const rawAlias = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_ALIAS_' + Date.now() },
    message: { conversation: '!celularseguro 352099-10-123456-1' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawAlias, mockConn);
  testAssert(lastReply && lastReply.includes('CONSULTA DE IMEI & CELULAR SEGURO'), 'Alias !celularseguro executa com sucesso');

  // Teste 6.4: Chamada citando mensagem com IMEI
  const rawQuoted = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_REPLY_' + Date.now() },
    message: {
      extendedTextMessage: {
        text: '!consultarimei',
        contextInfo: {
          stanzaId: 'QUOTED_ID_' + Date.now(),
          participant: '5511888887777@s.whatsapp.net',
          quotedMessage: { conversation: 'O IMEI deste aparelho é 352099101234561' }
        }
      }
    }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawQuoted, mockConn);
  testAssert(lastReply && lastReply.includes('352099101234561'), 'Comando extrai IMEI de mensagem citada e responde');

  // --------------------------------------------------------------------------
  console.log('\n--- 7. Testando Menus Oficiais do Bot ---');
  // --------------------------------------------------------------------------
  // Menu 4 (IA & Utilitários)
  const rawMenu4 = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_M4_' + Date.now() },
    message: { conversation: '!menu 4' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawMenu4, mockConn);
  testAssert(lastReply && lastReply.includes('!imei'), 'Comando !imei presente no Submenu 4 de Ferramentas');

  // Menu SpyBot (!comandos)
  const rawSpyMenu = {
    key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: 'MSG_SPY_' + Date.now() },
    message: { conversation: '!comandos' }
  };
  lastReply = null;
  await handler.handleMessage(whatsappBot, rawSpyMenu, mockConn);
  testAssert(lastReply && lastReply.includes('!imei'), 'Comando !imei presente no Catálogo SpyBot (!comandos)');

  console.log('\n======================================================');
  console.log(`🎉 TESTES CONCLUÍDOS: ${passedTests}/${totalTests} PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

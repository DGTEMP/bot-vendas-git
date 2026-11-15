/**
 * Testes Automatizados: Link Único Pré-Configurado para Conexão de Sub-Bots
 * 
 * Valida a paridade de experiência entre a Loja Web (/loja) e a Conexão de Sub-Bots (/subbot/conectar).
 */

const assert = require('assert');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('🧪 Iniciando testes de Link Único Pré-Configurado de Sub-Bots...\n');

  // 1. Testes do subbotConnectService
  console.log('1️⃣ Testando subbotConnectService...');
  const subbotConnectService = require('../src/services/subbotConnectService');

  // 1.1 Geração de URL personalizada com nome e telefone
  const connectData = subbotConnectService.buildSubBotConnectUrl({
    phone: '5511988887777',
    name: 'Carlos Oliveira',
    host: 'http://localhost:3000'
  });

  assert.ok(connectData.url, 'Deve retornar a URL completa');
  assert.ok(connectData.url.includes('phone=5511988887777'), 'URL deve conter o telefone do cliente');
  assert.ok(connectData.url.includes('name=Carlos') || connectData.url.includes('name='), 'URL deve conter o nome do cliente');
  assert.ok(connectData.shortCode, 'Deve gerar um código de link curto');
  assert.ok(connectData.shortUrl, 'Deve gerar uma URL curta (/s/:code)');
  console.log('  ✅ Geração de URL e short link: OK ->', connectData.shortUrl);

  // 1.2 Resolução de dados de conexão via token e query
  const resolved = subbotConnectService.resolveConnectData(connectData.shortCode, '5511988887777', 'Carlos Oliveira');
  assert.ok(resolved.success, 'Deve resolver com sucesso');
  assert.strictEqual(resolved.customer.phone, '5511988887777', 'Deve conter o telefone resolvido');
  assert.strictEqual(resolved.customer.name, 'Carlos Oliveira', 'Deve conter o nome resolvido');
  assert.ok(resolved.customer.formattedPhone.includes('+55'), 'Telefone formatado deve incluir código do país');
  assert.strictEqual(resolved.customer.countryFlag, '🇧🇷', 'Bandeira do Brasil detectada');
  console.log('  ✅ Resolução de dados pré-configurados do cliente: OK');

  // 1.3 Formatação da mensagem WhatsApp
  const inviteMsg = subbotConnectService.formatSubBotInvitationMessage({
    phone: '5511988887777',
    name: 'Carlos Oliveira',
    connectUrl: connectData.url,
    shortUrl: connectData.shortUrl
  });
  assert.ok(inviteMsg.includes('Carlos Oliveira'), 'Mensagem deve saudar o cliente pelo nome');
  assert.ok(inviteMsg.includes(connectData.shortUrl) || inviteMsg.includes(connectData.url), 'Mensagem deve conter o link único');
  assert.ok(inviteMsg.includes('50 Tokens'), 'Mensagem deve mencionar o benefício dos 50 tokens diários');
  console.log('  ✅ Formatação de mensagem de convite WhatsApp: OK');

  // 2. Testes de Rotas Web e API no Servidor Express
  console.log('\n2️⃣ Testando Rotas Express (/subbot/conectar e /api/subbot/connect/*)...');
  const { createServer } = require('../src/server/app');
  const app = createServer();

  // 2.1 GET /subbot/conectar (Página HTML)
  const resHtml = await request(app).get('/subbot/conectar');
  assert.strictEqual(resHtml.status, 200, 'GET /subbot/conectar deve retornar 200');
  assert.ok(resHtml.text.includes('Sub-Bot'), 'Página deve conter o título do portal');
  assert.ok(resHtml.text.includes('id="pairingCodeText"'), 'Página deve ter o elemento do código de pareamento');
  assert.ok(resHtml.text.includes('id="btnRequestCode"'), 'Página deve ter o botão de gerar código');
  console.log('  ✅ GET /subbot/conectar serve HTML responsivo: OK');

  // 2.2 GET /api/subbot/connect/info
  const resInfo = await request(app)
    .get('/api/subbot/connect/info')
    .query({ phone: '5521977776666', name: 'Mariana Silva' });
  
  assert.strictEqual(resInfo.status, 200, 'GET /api/subbot/connect/info deve retornar 200');
  assert.strictEqual(resInfo.body.success, true);
  assert.strictEqual(resInfo.body.customer.phone, '5521977776666');
  assert.strictEqual(resInfo.body.customer.name, 'Mariana Silva');
  assert.strictEqual(resInfo.body.customer.countryFlag, '🇧🇷');
  console.log('  ✅ GET /api/subbot/connect/info pré-configura os dados do cliente: OK');

  // 2.3 POST /api/subbot/connect/request-code (Validação sem telefone)
  const resCodeFail = await request(app)
    .post('/api/subbot/connect/request-code')
    .send({});
  assert.strictEqual(resCodeFail.status, 400, 'Sem telefone deve retornar erro 400');
  console.log('  ✅ POST /api/subbot/connect/request-code rejeita requisição sem telefone: OK');

  // 2.4 GET /api/subbot/connect/status/:idOrPhone
  const resStatus = await request(app)
    .get('/api/subbot/connect/status/5511999990000');
  assert.strictEqual(resStatus.status, 200);
  assert.strictEqual(typeof resStatus.body.connected, 'boolean');
  console.log('  ✅ GET /api/subbot/connect/status/:idOrPhone retorna status em tempo real: OK');

  // 3. Testes do spyFeaturesService (Comandos de WhatsApp)
  console.log('\n3️⃣ Testando comandos WhatsApp em spyFeaturesService...');
  const spyFeatures = require('../src/services/spyFeaturesService');

  let sentMessages = [];
  const mockSock = {
    sendMessage: async (to, content) => {
      sentMessages.push({ to, content });
      return { key: { id: 'mock_msg_' + Date.now() } };
    }
  };

  // 3.1 !serbot sem argumentos (deve gerar e enviar link único pré-configurado)
  sentMessages = [];
  await spyFeatures.handleSerBot(
    mockSock,
    '5511999991234@s.whatsapp.net',
    '!serbot',
    '5511999991234',
    false,
    false,
    'Lucas Mendes'
  );

  assert.ok(sentMessages.length > 0, 'Deve enviar resposta no WhatsApp');
  const responseText = sentMessages[0].content.text;
  assert.ok(responseText.includes('Lucas Mendes'), 'Resposta deve conter o nome do solicitante');
  assert.ok(responseText.includes('/s/') || responseText.includes('/subbot/conectar'), 'Resposta deve conter o link único de conexão');
  console.log('  ✅ !serbot gera e envia link único personalizado para o cliente: OK');

  // 3.2 !termos com nome do cliente
  sentMessages = [];
  await spyFeatures.handleTermsCommand(
    mockSock,
    '5511999991234@s.whatsapp.net',
    '5511999991234',
    'Lucas Mendes'
  );

  assert.ok(sentMessages.length > 0, 'Deve enviar resposta de termos no WhatsApp');
  const termsText = sentMessages[0].content.text;
  assert.ok(termsText.includes('TERMOS DE ADESÃO'), 'Deve conter o cabeçalho dos termos');
  assert.ok(termsText.includes('/s/') || termsText.includes('/subbot/conectar'), 'Deve incluir link seguro de conexão');
  console.log('  ✅ !termos inclui link de onboarding pré-configurado: OK');

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

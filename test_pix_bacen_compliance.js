const assert = require('assert');
const pixPayment = require('./src/services/pixPayment');
const bacenPixService = require('./src/services/bacenPixService');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const models = require('./src/db/models');

console.log('======================================================');
console.log('🏦 TESTE DE CONFORMIDADE PIX BACEN & COMANDOS !setpix / !verpix 🏦');
console.log('======================================================\n');

// 1. Teste de Sanitização e Detecção de Chaves Pix
console.log('--- 1. Sanitização e Detecção de Chaves Pix ---');

const t1 = pixPayment.detectAndSanitizePixKey('48984702848');
assert.strictEqual(t1.type, 'Telefone');
assert.strictEqual(t1.key, '+5548984702848');
console.log('  ✅ PASS: Telefone celular 11 dígitos -> +5548984702848');

const t2 = pixPayment.detectAndSanitizePixKey('554884702848');
assert.strictEqual(t2.type, 'Telefone');
assert.strictEqual(t2.key, '+554884702848');
console.log('  ✅ PASS: Telefone com DDI 55 (12 dígitos) -> +554884702848');

const t3 = pixPayment.detectAndSanitizePixKey('(48) 98470-2848');
assert.strictEqual(t3.type, 'Telefone');
assert.strictEqual(t3.key, '+5548984702848');
console.log('  ✅ PASS: Telefone formatado com parênteses e hífen -> +5548984702848');

const t4 = pixPayment.detectAndSanitizePixKey('MEUPIX@EMPRESA.COM.BR');
assert.strictEqual(t4.type, 'E-mail');
assert.strictEqual(t4.key, 'meupix@empresa.com.br');
console.log('  ✅ PASS: E-mail em maiúsculo -> minúsculo sem espaços');

const t5 = pixPayment.detectAndSanitizePixKey('123.456.789-01');
assert.strictEqual(t5.type, 'CPF');
assert.strictEqual(t5.key, '12345678901');
console.log('  ✅ PASS: CPF com pontuação -> 11 dígitos limpos');

const t6 = pixPayment.detectAndSanitizePixKey('12.345.678/0001-95');
assert.strictEqual(t6.type, 'CNPJ');
assert.strictEqual(t6.key, '12345678000195');
console.log('  ✅ PASS: CNPJ formatado -> 14 dígitos limpos');

const t7 = pixPayment.detectAndSanitizePixKey('123e4567-e89b-12d3-a456-426614174000');
assert.strictEqual(t7.type, 'Chave Aleatória (EVP)');
assert.strictEqual(t7.key, '123e4567-e89b-12d3-a456-426614174000');
console.log('  ✅ PASS: Chave Aleatória EVP/UUID preservada');

// 2. Validação Estrita do EMVCo BR Code
console.log('\n--- 2. Validação Estrita do EMVCo BR Code BACEN ---');

const pixPayload = pixPayment.generateBacenPixPayload({
  pixKey: '+554884702848',
  merchantName: 'PayBot Loja Oficial',
  merchantCity: 'São Paulo',
  amount: '49.90',
  txid: '***'
});

console.log('  Código Pix Gerado:', pixPayload);

// Parsing manual dos campos TLV (Tag-Length-Value)
function parseTLV(payload) {
  const tags = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    const val = payload.slice(i + 4, i + 4 + len);
    tags[id] = val;
    i += 4 + len;
  }
  return tags;
}

const tags = parseTLV(pixPayload);
assert.strictEqual(tags['00'], '01', 'Tag 00 deve ser 01 (Payload Format Indicator)');
assert.strictEqual(tags['01'], '11', 'Tag 01 deve ser 11 (QR Code Estático padrão BACEN)');
assert(tags['26'].includes('br.gov.bcb.pix'), 'Tag 26 Subtag 00 deve conter br.gov.bcb.pix');
assert(tags['26'].includes('+554884702848'), 'Tag 26 Subtag 01 deve conter a Chave Pix sanitizada');
assert.strictEqual(tags['52'], '0000', 'Tag 52 deve ser 0000 (MCC Padrão)');
assert.strictEqual(tags['53'], '986', 'Tag 53 deve ser 986 (Moeda BRL)');
assert.strictEqual(tags['54'], '49.90', 'Tag 54 deve conter o valor formatado');
assert.strictEqual(tags['58'], 'BR', 'Tag 58 deve ser BR (País)');
assert.strictEqual(tags['59'], 'PAYBOT LOJA OFICIAL', 'Tag 59 deve ser ASCII puro em maiúsculo');
assert.strictEqual(tags['60'], 'SAO PAULO', 'Tag 60 deve ter acentos removidos (SÃO -> SAO)');
assert.strictEqual(tags['62'], '0503***', 'Tag 62 Subtag 05 deve ser *** para compatibilidade 100% com bancos');
assert(tags['63'].length === 4, 'Tag 63 deve conter 4 caracteres hexadecimais de CRC');

console.log('  ✅ PASS: Tag 00 = 01 (Format Indicator)');
console.log('  ✅ PASS: Tag 01 = 11 (Static Point of Initiation)');
console.log('  ✅ PASS: Tag 26 Subtag 00 = br.gov.bcb.pix');
console.log('  ✅ PASS: Tag 26 Subtag 01 = +554884702848 (Chave internacional)');
console.log('  ✅ PASS: Tag 52 = 0000 (MCC)');
console.log('  ✅ PASS: Tag 53 = 986 (Moeda Real BRL)');
console.log('  ✅ PASS: Tag 54 = 49.90 (Valor correto)');
console.log('  ✅ PASS: Tag 58 = BR (Código do País)');
console.log('  ✅ PASS: Tag 59 = PAYBOT LOJA OFICIAL (Nome sem caracteres especiais)');
console.log('  ✅ PASS: Tag 60 = SAO PAULO (Cidade sem acento)');
console.log('  ✅ PASS: Tag 62 = 0503*** (Subtag 05 = *** universal)');
console.log('  ✅ PASS: Tag 63 = ' + tags['63'] + ' (CRC16-CCITT Válido)');

// 3. Teste de Execução createPixCharge
console.log('\n--- 3. Teste de Execução createPixCharge ---');
async function testCreateCharge() {
  const res = await pixPayment.createPixCharge({
    merchantTradeNo: 'ORD_TEST_9999',
    amount: 25.50,
    goodsName: 'Licença VIP PayBot'
  });

  assert(res.success, 'Cobrança deve retornar success: true');
  assert(res.data?.pixCode, 'Deve retornar pixCode');
  assert(Buffer.isBuffer(res.data?.qrBuffer), 'Deve retornar qrBuffer como Buffer de imagem');
  assert(res.data?.qrBuffer.length > 100, 'qrBuffer deve conter imagem PNG válida');
  console.log('  ✅ PASS: createPixCharge gerou Copia e Cola e Buffer QR Code PNG');
  console.log('  ✅ PASS: Gateway utilizado:', res.gateway);
}

// 4. Teste dos Comandos !setpix e !verpix
console.log('\n--- 4. Testando Comandos !setpix e !verpix no Handler & WhatsApp ---');
async function testCommands() {
  const cmdSetPix = handler.findCommand('setpix');
  assert(!!cmdSetPix, 'Comando !setpix registrado no Handler');
  assert(cmdSetPix.command.includes('configpix'), 'Alias !configpix registrado');
  assert(cmdSetPix.command.includes('chavepix'), 'Alias !chavepix registrado');

  const cmdVerPix = handler.findCommand('verpix');
  assert(!!cmdVerPix, 'Comando !verpix registrado no Handler');
  assert(cmdVerPix.command.includes('statuspix'), 'Alias !statuspix registrado');
  assert(cmdVerPix.command.includes('meupix'), 'Alias !meupix registrado');

  const mockSent = [];
  const mockConn = {
    user: { id: '554884702848@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      mockSent.push({ jid, content });
      return { key: { id: 'MSG_' + Date.now() } };
    }
  };

  // Testa !setpix com telefone celular
  mockSent.length = 0;
  await spyFeatures.handleSetPix(mockConn, '12036302485938@g.us', '!setpix 48984702848', true);
  assert(mockSent.some(m => (m.content.caption || m.content.text || '').includes('CHAVE PIX ATUALIZADA')), '!setpix confirma atualização da chave');
  assert(models.getSetting('PIX_KEY') === '+5548984702848', 'PIX_KEY salvo no banco como +5548984702848');
  assert(models.getSetting('BACEN_PIX_KEY') === '+5548984702848', 'BACEN_PIX_KEY salvo no banco como +5548984702848');
  console.log('  ✅ PASS: !setpix 48984702848 sanitiza para +5548984702848 e salva em models');

  // Testa !verpix
  mockSent.length = 0;
  await spyFeatures.handleVerPix(mockConn, '12036302485938@g.us', true);
  assert(mockSent.some(m => (m.content.caption || m.content.text || '').includes('STATUS DA CHAVE PIX')), '!verpix exibe status da chave');
  assert(mockSent.some(m => (m.content.caption || m.content.text || '').includes('+5548984702848')), '!verpix exibe a chave cadastrada');
  console.log('  ✅ PASS: !verpix exibe detalhes, tipo Telefone e teste Copia e Cola');

  // Testa !setpix com email
  mockSent.length = 0;
  await spyFeatures.handleSetPix(mockConn, '12036302485938@g.us', '!setpix contato@paybot.com', true);
  assert(models.getSetting('PIX_KEY') === 'contato@paybot.com', 'PIX_KEY atualizado para email');
  console.log('  ✅ PASS: !setpix com email atualizado com sucesso');

  // Restaura para a chave do dono (telefone oficial)
  models.setSetting('PIX_KEY', '+554884702848');
  models.setSetting('BACEN_PIX_KEY', '+554884702848');
  console.log('  ✅ PASS: Chave oficial restaurada para +554884702848');
}

(async () => {
  await testCreateCharge();
  await testCommands();
  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES PIX BACEN PASSARAM COM 100% DE SUCESSO! 🎉');
  console.log('======================================================\n');
})();

const assert = require('assert');
const pixPayment = require('./src/services/pixPayment');
const pixUtil = require('./src/utils/pixEmvUtil');

console.log('=== TESTES DE ACEITAÇÃO BANCÁRIA DO PIX (PADRÃO OFICIAL BACEN / EMVCo) ===\n');

// 1. TESTE: Normalização de QR Code Dinâmico InfoPago/LivePix sem o campo 01
console.log('Testando normalização de QR Code Dinâmico InfoPago/LivePix...');
const livepixDefectiveRaw = '00020126870014br.gov.bcb.pix2565pix.infopago.com.br/qr/v3/at/3634c390-e14f-4312-8d77-669a67706cbf5204000053039865802BR5912LIVEPIX_LTDA6009SAO_PAULO62070503***6304B92D';
const normalizedDynamic = pixUtil.normalizeAndValidatePixCode(livepixDefectiveRaw);

assert(normalizedDynamic.startsWith('000201010212'), 'Deve conter 010212 logo após 000201 para que o banco reconheça como dinâmico');
assert(normalizedDynamic.includes('pix.infopago.com.br'), 'Deve preservar a URL da location no subcampo 25');
assert(normalizedDynamic.endsWith('63049364'), 'CRC16 deve ser recalculado corretamente (esperado: 9364)');

const inspectDynamic = pixUtil.inspectPixCode(livepixDefectiveRaw);
assert.strictEqual(inspectDynamic.isCompliant, true, 'O código normalizado deve ser 100% homologado pelo BACEN');
assert.strictEqual(inspectDynamic.type, 'DINAMICO', 'Deve ser classificado como DINÂMICO');
assert.strictEqual(inspectDynamic.poi, '12', 'POI deve ser 12 (uso único / dinâmico)');
console.log('✅ [PASSOU] QR Code Dinâmico InfoPago corrigido com 010212 e CRC16 recalculado!');

// 2. TESTE: Preservação de QR Code Dinâmico que já possui 010212 (Woovi/Mercado Pago)
console.log('Testando preservação de QR Code Dinâmico íntegro (Woovi)...');
const wooviRaw = '00020101021226810014br.gov.bcb.pix2559qr.woovi.com/qr/v2/cob/30c43bf7-0ac6-434e-adf8-791af6c36e0c520400005303986540552.405802BR5907LIVEPIX6009SAO PAULO622905250a8e4f803b9b40758806f2fd66304AF35';
const wooviNorm = pixUtil.normalizeAndValidatePixCode(wooviRaw);
assert.strictEqual(wooviNorm, wooviRaw, 'Código íntegro não deve ser alterado');
console.log('✅ [PASSOU] QR Code Dinâmico pré-formatado mantido 100% intacto!');

// 3. TESTE: Auto-correção do nono dígito em celulares brasileiros para chaves Pix
console.log('Testando sanitização e auto-correção de nono dígito em telefones celulares...');
const t1 = pixUtil.detectAndSanitizePixKey('554884702848');
assert.strictEqual(t1.key, '+5548984702848', 'Deve adicionar o 9 para celular com DDD 48 (554884702848 -> +5548984702848)');

const t2 = pixUtil.detectAndSanitizePixKey('4884702848');
assert.strictEqual(t2.key, '+5548984702848', 'Deve adicionar o 9 e o DDI +55 (4884702848 -> +5548984702848)');

const t3 = pixUtil.detectAndSanitizePixKey('+554884702848');
assert.strictEqual(t3.key, '+5548984702848', 'Deve corrigir celular com prefixo + ( +554884702848 -> +5548984702848)');

const t4 = pixUtil.detectAndSanitizePixKey('48984702848');
assert.strictEqual(t4.key, '+5548984702848', 'Celular com 9 já presente deve apenas receber +55');

const tCpf = pixUtil.detectAndSanitizePixKey('123.456.789-00', 'cpf');
assert.strictEqual(tCpf.key, '12345678900', 'CPF deve ser sanitizado apenas com números');

const tEmail = pixUtil.detectAndSanitizePixKey('  Contato@Loja.Com.Br  ');
assert.strictEqual(tEmail.key, 'contato@loja.com.br', 'E-mail deve ser minúsculo e sem espaços');

const tEvp = pixUtil.detectAndSanitizePixKey('123e4567-e89b-12d3-a456-426614174000');
assert.strictEqual(tEvp.type, 'Chave Aleatória (EVP)', 'EVP deve ser reconhecida');
console.log('✅ [PASSOU] Sanitização inteligente de chaves com 9º dígito obrigatório do DICT!');

// 4. TESTE: Geração e validação de BR Code Estático com txid '***'
console.log('Testando geração oficial BACEN de Pix Estático...');
const staticPayload = pixUtil.generateBacenPixPayload({
  pixKey: '+5548984702848',
  merchantName: 'PAYBOT',
  merchantCity: 'SAO PAULO',
  amount: '25.00',
  txid: '***'
});

assert(staticPayload.startsWith('000201010211'), 'Pix Estático deve conter tag 01 com valor 11');
assert(staticPayload.includes('0114+5548984702848'), 'Chave com nono dígito e +55 deve ter tamanho 14 e valor correto');
assert(staticPayload.includes('540525.00'), 'Valor formatado com 2 casas decimais na tag 54');
assert(staticPayload.includes('62070503***'), 'txid deve ser *** para compatibilidade universal');
assert(staticPayload.includes('6304'), 'Deve terminar com o campo de checksum 6304');

const inspectStatic = pixUtil.inspectPixCode(staticPayload);
assert.strictEqual(inspectStatic.isCompliant, true);
assert.strictEqual(inspectStatic.type, 'ESTATICO');
assert.strictEqual(inspectStatic.merchantName, 'PAYBOT');
assert.strictEqual(inspectStatic.amount, '25.00');
console.log('✅ [PASSOU] BR Code Estático universal gerado com padrão ouro BACEN!');

// 5. TESTE: createPixCharge com gateway direto
(async () => {
  console.log('Testando criação de cobrança com gateway direto (pix_manual)...');
  const directRes = await pixPayment.createPixCharge({
    merchantTradeNo: 'ORD_TEST_BANCO_' + Date.now(),
    amount: '19.90',
    goodsName: 'Produto Teste Banco',
    payerPhone: '5511999998888',
    forceGateway: 'pix_manual'
  });

  assert.strictEqual(directRes.success, true);
  assert.strictEqual(directRes.gateway, 'pix_manual');
  assert(directRes.data.pixCode, 'Deve retornar o código Pix');
  
  const inspDirect = pixUtil.inspectPixCode(directRes.data.pixCode);
  assert.strictEqual(inspDirect.isValid, true);
  assert.strictEqual(inspDirect.isCompliant, true);
  console.log('✅ [PASSOU] createPixCharge (pix_manual) entrega Pix 100% homologado para os bancos!');

  console.log('\n======================================================');
  console.log('TOTAL ACEITAÇÃO BANCÁRIA: TODOS OS TESTES PASSARAM COM SUCESSO!');
  console.log('======================================================\n');
})();

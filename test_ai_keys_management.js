const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const models = require('./src/db/models');
const aiManager = require('./src/services/aiManagerService');
const handler = require('./src/handler');

async function runAiKeyTests() {
  console.log('======================================================');
  console.log('🧠 TESTES DE GERENCIAMENTO DE CHAVES MULTI-IA & .ENV 🧠');
  console.log('======================================================\n');

  // 1. Testa se as variáveis do .env foram carregadas
  console.log('--- 1. Carregamento do .env ---');
  assert(process.env.AI_FALLBACK_ORDER, '.env contém AI_FALLBACK_ORDER');
  assert(process.env.ANTIGRAVITY_AI_ENDPOINT, '.env contém ANTIGRAVITY_AI_ENDPOINT');
  assert(process.env.ANTIGRAVITY_AI_KEY, '.env contém ANTIGRAVITY_AI_KEY');
  console.log('  ✅ PASS: .env possui as variáveis Multi-IA e Antigravity');

  // 2. Testa sanitização de endpoint e placeholders
  console.log('\n--- 2. Sanitização de Endpoints e Placeholders ---');
  const localConfig = aiManager.providerConfigs.local;
  assert(localConfig.chatEndpoint.endsWith('/chat/completions'), 'chatEndpoint local normalizado com /chat/completions');
  console.log('  ✅ PASS: chatEndpoint normalizado:', localConfig.chatEndpoint);

  // 3. Testa cadastro de chave via !setia e auto-delete
  console.log('\n--- 3. Cadastro via Comando !setia e Auto-Delete ---');
  const cmdSetIa = handler.findCommand('setia');
  const cmdVerIa = handler.findCommand('veria');
  const cmdStatusIa = handler.findCommand('statusia');
  const cmdTestIa = handler.findCommand('testia');

  assert(!!cmdSetIa, 'Comando !setia registrado no Handler');
  assert(!!cmdVerIa, 'Comando !veria registrado no Handler');
  assert(!!cmdStatusIa, 'Comando !statusia registrado no Handler');
  assert(!!cmdTestIa, 'Comando !testia registrado no Handler');

  let deletedMessage = false;
  let repliesSent = [];
  const fakeMsg = {
    chat: '554884702848@s.whatsapp.net',
    isGroup: false,
    textArgs: 'gemini AIzaSyMockTestKey1234567890ABCDEF',
    async delete() {
      deletedMessage = true;
      return true;
    },
    async react(emoji) {
      return true;
    },
    reply(txt) {
      repliesSent.push(txt);
      return true;
    }
  };

  const fakeConn = {
    sendMessage: async (jid, content) => {
      repliesSent.push(content.text);
      return { key: { id: 'REP_1' } };
    }
  };

  await cmdSetIa.run(fakeMsg, {
    conn: fakeConn,
    isOwner: true,
    usedPrefix: '!',
    command: 'setia',
    text: fakeMsg.textArgs,
    args: fakeMsg.textArgs.split(' ')
  });

  assert(deletedMessage === true, 'Mensagem com a chave foi apagada automaticamente');
  assert(repliesSent.some(r => r.includes('Chave cadastrada com sucesso') && r.includes('GEMINI')), 'Confirmação enviada');
  assert(repliesSent.some(r => r.includes('Segurança') && r.includes('apagada')), 'Aviso de segurança enviado');
  console.log('  ✅ PASS: !setia cadastrou chave com sucesso e apagou a mensagem do chat');

  // 4. Testa mascaramento de chave e integridade do Pool
  console.log('\n--- 4. Pool de Chaves e Mascaramento Seguro ---');
  const geminiKeys = aiManager.getKeysForProvider('gemini', { isMaster: true });
  assert(geminiKeys.includes('AIzaSyMockTestKey1234567890ABCDEF'), 'Chave mock está ativa no pool do Master');

  const report = aiManager.getStatus();
  assert(report.masterMegaPool.gemini.totalKeys >= 1, 'Mega-Pool contabilizou a chave cadastrada');
  console.log('  ✅ PASS: Mega-Pool atualizado:', report.masterMegaPool.gemini.totalKeys, 'chave(s)');

  // 5. Testa visualização de status com !veria
  console.log('\n--- 5. Painel !veria ---');
  repliesSent = [];
  await cmdVerIa.run(fakeMsg, {
    conn: fakeConn,
    isOwner: true,
    usedPrefix: '!',
    command: 'veria'
  });

  assert(repliesSent.length > 0, '!veria enviou o relatório');
  const reportText = repliesSent[0];
  assert(reportText.includes('BOT MASTER - MEGA-POOL MULTI-IA'), '!veria exibe cabeçalho do Mega-Pool');
  assert(!reportText.includes('AIzaSyMockTestKey1234567890ABCDEF'), 'Chave bruta NUNCA é exibida em texto plano (Safe Protocol)');
  console.log('  ✅ PASS: !veria protege o segredo e exibe status dos provedores');

  // Limpeza
  aiManager.removeApiKey('gemini', 'AIzaSyMockTestKey1234567890ABCDEF', { isMaster: true });

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DE CHAVES IA PASSARAM COM 100%! 🎉');
  console.log('======================================================\n');
}

runAiKeyTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});

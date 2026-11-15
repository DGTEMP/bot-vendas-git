const assert = require('assert');
const models = require('./src/db/models');
const groupRentalService = require('./src/services/groupRentalService');
const spyFeatures = require('./src/services/spyFeaturesService');
const simiService = require('./src/services/simiService');
const handler = require('./src/handler');
const whatsappBot = require('./src/bots/whatsappBot');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('🧪 INICIANDO TESTES: SIMI DO SPYBOT & COMANDO !KEY / !USARCODIGO\n');

  // ==========================================
  // BLOCO 1: SIMI DO SPYBOT VIA SPYFEATURESSERVICE
  // ==========================================
  console.log('--- TESTE 1: spyFeatures.handleSimi e Identidade SpyBot ---');
  let sentMsg = null;
  let botReplies = [];
  const mockSock = {
    sendMessage: async (to, payload) => {
      sentMsg = { to, payload };
      botReplies.push({ jid: to, content: payload });
      return true;
    },
    sendPresenceUpdate: async () => true
  };

  const testGroup = '1203630011223344@g.us';

  // 1.1 Ativação no grupo
  await spyFeatures.handleSimi(mockSock, testGroup, '!simi on', 'Tester', true);
  assert(sentMsg && sentMsg.payload.text.includes('SIMSIMI ATIVADO'), 'Deve ativar SimSimi no grupo');
  assert.strictEqual(models.isSimiActiveInChat(testGroup), true, 'Grupo deve constar ativo no banco');
  console.log('  ✅ PASS: spyFeatures.handleSimi on ativou com sucesso');

  // 1.2 Status no grupo
  sentMsg = null;
  await spyFeatures.handleSimi(mockSock, testGroup, '!simi status', 'Tester', true);
  assert(sentMsg && sentMsg.payload.text.includes('STATUS DO SIMSIMI'), 'Deve exibir status do SimSimi');
  console.log('  ✅ PASS: spyFeatures.handleSimi status reportou status com sucesso');

  // 1.3 Pergunta direta
  sentMsg = null;
  await spyFeatures.handleSimi(mockSock, testGroup, '!simi quem é você?', 'Tester', true);
  assert(sentMsg && sentMsg.payload.text, 'Deve responder à pergunta direta');
  assert(sentMsg.payload.text.includes('SimSimi') || sentMsg.payload.text.includes('🐥'), 'Deve conter identidade SimSimi');
  console.log('  ✅ PASS: spyFeatures.handleSimi resposta direta:', sentMsg.payload.text);

  // 1.4 Auto-chat em grupo ativo
  const autoHandled = await spyFeatures.checkSimiAutoChat(mockSock, testGroup, 'E aí galera como vocês estão hoje?', 'Marcos', true);
  assert.strictEqual(autoHandled, true, 'Auto-chat do Simi deve responder a mensagem livre no grupo ativo');
  console.log('  ✅ PASS: spyFeatures.checkSimiAutoChat respondeu automaticamente no grupo');

  // 1.5 Desativação no grupo
  sentMsg = null;
  await spyFeatures.handleSimi(mockSock, testGroup, '!simi off', 'Tester', true);
  assert(sentMsg && sentMsg.payload.text.includes('SIMSIMI DESATIVADO'), 'Deve desativar SimSimi no grupo');
  assert.strictEqual(models.isSimiActiveInChat(testGroup), false, 'Grupo deve constar inativo no banco');
  console.log('  ✅ PASS: spyFeatures.handleSimi off desativou com sucesso');

  // ==========================================
  // BLOCO 2: COMANDO !KEY E !USARCODIGO
  // ==========================================
  console.log('\n--- TESTE 2: Comando !key e !usarcodigo de Aluguel de Grupos ---');

  // 2.1 Chamada sem parâmetros em grupo deve exibir instrução com !key
  sentMsg = null;
  await spyFeatures.handleUsarCodigo(mockSock, testGroup, '!key', '5511999990001');
  assert(sentMsg && sentMsg.payload.text.includes('!key') && sentMsg.payload.text.includes('!usarcodigo'), 'Deve instruir o uso do comando !key e !usarcodigo');
  console.log('  ✅ PASS: !key sem código orienta com exemplo de uso');

  // 2.2 Chamada fora de grupo deve avisar que é apenas para grupo
  sentMsg = null;
  await spyFeatures.handleUsarCodigo(mockSock, '5511999990001@s.whatsapp.net', '!key A1B2C3D4', '5511999990001');
  assert(sentMsg && sentMsg.payload.text.includes('dentro do grupo'), 'Deve exigir execução dentro de grupo');
  console.log('  ✅ PASS: !key bloqueado em chat privado');

  // 2.3 Gera código de aluguel para teste
  const codeGen = groupRentalService.generateCode(7, null, 'KEY_TESTER');
  assert(codeGen.success && codeGen.code, 'Deve gerar código de 8 caracteres');
  const createdKey = codeGen.code;
  console.log('  🔑 Chave gerada para teste:', createdKey);

  // 2.4 Ativação via !key <chave>
  sentMsg = null;
  await spyFeatures.handleUsarCodigo(mockSock, testGroup, `!key ${createdKey}`, '5511999990001');
  assert(sentMsg && sentMsg.payload.text.includes('ativado com sucesso'), `Deve confirmar ativação com !key: ${sentMsg?.payload?.text}`);
  console.log('  ✅ PASS: !key ativou o aluguel do grupo com sucesso:', sentMsg.payload.text.split('\n')[0]);

  // 2.5 Gera segundo código para testar citação (quoted message)
  const codeGen2 = groupRentalService.generateCode(15, null, 'KEY_TESTER');
  const createdKey2 = codeGen2.code;
  const mockMsgWithQuoted = {
    message: {
      extendedTextMessage: {
        text: '!key',
        contextInfo: {
          quotedMessage: {
            conversation: `Parabéns pela compra! Sua chave é: ${createdKey2}`
          }
        }
      }
    }
  };

  sentMsg = null;
  const testGroup2 = '1203639988776655@g.us';
  await spyFeatures.handleUsarCodigo(mockSock, testGroup2, '!key', '5511999990002', mockMsgWithQuoted);
  assert(sentMsg && sentMsg.payload.text.includes('ativado com sucesso'), `Deve extrair chave de mensagem citada: ${sentMsg?.payload?.text}`);
  console.log('  ✅ PASS: !key respondendo mensagem com chave ativou perfeitamente');

  // ==========================================
  // BLOCO 3: INTEGRAÇÃO NO WHATSAPPBOT & BYPASS
  // ==========================================
  console.log('\n--- TESTE 3: Integração no WhatsAppBot & bypassCmds ---');

  // 3.1 Verifica se 'key' está em bypassCmds
  let origSend = whatsappBot.sendMessage;
  botReplies = [];
  whatsappBot.sendMessage = async (jid, content) => {
    botReplies.push({ jid, content });
    return true;
  };
  whatsappBot.sock = mockSock;

  // 3.2 Executa !simi via handleIncomingMessage
  botReplies = [];
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: testGroup, fromMe: false, id: 'MSG_SIMI_TEST' },
    pushName: 'Carla',
    message: { conversation: '!simi qual seu prato favorito?' }
  });
  assert(botReplies.length > 0, 'WhatsAppBot deve responder comando !simi');
  console.log('  ✅ PASS: WhatsAppBot roteou !simi com resposta:', botReplies[0].content?.text || botReplies[0].content);

  // 3.3 Executa !key via handleIncomingMessage
  const codeGen3 = groupRentalService.generateCode(30, null, 'KEY_TESTER');
  const createdKey3 = codeGen3.code;
  const testGroup3 = '1203634455667788@g.us';

  botReplies = [];
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: testGroup3, fromMe: false, id: 'MSG_KEY_TEST' },
    pushName: 'Lucas',
    message: { conversation: `!key ${createdKey3}` }
  });
  assert(botReplies.length > 0 && JSON.stringify(botReplies).includes('ativado com sucesso'), 'WhatsAppBot deve ativar aluguel via !key');
  console.log('  ✅ PASS: WhatsAppBot ativou grupo via !key com sucesso');

  // ==========================================
  // BLOCO 4: MASTER HANDLER GATA NINA / SPYBOT
  // ==========================================
  console.log('\n--- TESTE 4: Master Handler registra !key e !simi ---');
  const simiCmd = handler.commands.get('simi');
  assert(simiCmd, 'Comando simi deve estar registrado no handler');
  assert(simiCmd.command.includes('simi'), 'Deve ter alias simi');

  const keyCmd = handler.commands.get('usarcodigo');
  assert(keyCmd, 'Comando usarcodigo deve estar registrado no handler');
  assert(keyCmd.command.includes('key'), 'Deve ter alias key');
  assert(keyCmd.command.includes('usarcodigo'), 'Deve ter alias usarcodigo');
  console.log('  ✅ PASS: Master Handler possui comandos simi e usarcodigo com alias [key]');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DA SIMI DO SPYBOT E !KEY PASSARAM!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});

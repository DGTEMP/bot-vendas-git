/**
 * Bateria de Testes Automatizada: Modo Só Divulgação (!sodivu & !sodivu-global)
 * Valida o funcionamento dos comandos, modelos de banco, filtragem de mensagens no handler,
 * integração com o Lab de Conexões e API REST do Painel Web.
 */

const assert = require('assert');
const models = require('./src/db/models');
const handler = require('./src/handler');
const spyFeatures = require('./src/services/spyFeaturesService');
const connectionLabService = require('./src/services/connectionLabService');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function runTestAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🧪 TESTE COMPLETO: MODO SÓ DIVULGAÇÃO (!sodivu & !sodivu-global)');
  console.log('======================================================\n');

  const testGroup = '120363028123456789@g.us';
  const otherGroup = '120363028987654321@g.us';

  // 1. Limpa estado inicial
  models.setGroupSoDivu(testGroup, false);
  models.setGroupSoDivu(otherGroup, false);
  models.setGlobalSoDivu(false);

  // -------------------------------------------------------------------------
  // BLOCO 1: Modelos e Configurações de Banco de Dados
  // -------------------------------------------------------------------------
  console.log('📦 Bloco 1: Modelos e Persistência no Banco');

  runTest('1.1 Inicialmente Só Divulgação deve estar inativo para o grupo', () => {
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), false);
    assert.strictEqual(models.isGlobalSoDivuActive(), false);
  });

  runTest('1.2 Ativar Só Divulgação para grupo específico', () => {
    models.setGroupSoDivu(testGroup, true);
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), true);
    // Outro grupo permanece inalterado
    assert.strictEqual(models.isGroupSoDivuActive(otherGroup), false);
  });

  runTest('1.3 Desativar Só Divulgação para grupo específico', () => {
    models.setGroupSoDivu(testGroup, false);
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), false);
  });

  runTest('1.4 Ativar Só Divulgação Global reflete em todos os grupos', () => {
    models.setGlobalSoDivu(true);
    assert.strictEqual(models.isGlobalSoDivuActive(), true);
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), true);
    assert.strictEqual(models.isGroupSoDivuActive(otherGroup), true);
    // Restaura
    models.setGlobalSoDivu(false);
    assert.strictEqual(models.isGlobalSoDivuActive(), false);
  });

  runTest('1.5 isGroupPostingActive deve ser TRUE quando Só Divulgação estiver ativo', () => {
    models.setGroupPostingActive(testGroup, false);
    models.setGroupSoDivu(testGroup, true);
    // Mesmo com postingActive explicitamente falso, o modo Só Divulgação força o posting para true
    assert.strictEqual(models.isGroupPostingActive(testGroup), true);
    models.setGroupSoDivu(testGroup, false);
  });

  runTest('1.6 getGroupSettings e updateGroupSettings incluem soDivu e globalSoDivu', () => {
    models.updateGroupSettings('whatsapp', testGroup, { soDivu: true });
    const settings = models.getGroupSettings('whatsapp', testGroup);
    assert.strictEqual(settings.soDivu, true);
    assert.strictEqual(typeof settings.globalSoDivu, 'boolean');
    models.updateGroupSettings('whatsapp', testGroup, { soDivu: false });
  });

  // -------------------------------------------------------------------------
  // BLOCO 2: Serviço spyFeatures - handleSoDivuControl
  // -------------------------------------------------------------------------
  console.log('\n💬 Bloco 2: spyFeaturesService.handleSoDivuControl');

  await runTestAsync('2.1 handleSoDivuControl ativa !sodivu on no grupo', async () => {
    let sentMessage = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessage = content;
        return { key: { id: 'MOCK_MSG_1' } };
      }
    };

    await spyFeatures.handleSoDivuControl(
      mockSock,
      testGroup,
      '!sodivu on',
      '5511999998888',
      true, // isGroup
      true, // isAdmin
      false // isOwner
    );

    assert.ok(sentMessage, 'Deve enviar mensagem');
    assert.ok(sentMessage.text.includes('MODO SÓ DIVULGAÇÃO ATIVADO'), 'Texto deve confirmar ativação');
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), true);
  });

  await runTestAsync('2.2 handleSoDivuControl desativa !sodivu off no grupo', async () => {
    let sentMessage = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessage = content;
        return { key: { id: 'MOCK_MSG_2' } };
      }
    };

    await spyFeatures.handleSoDivuControl(
      mockSock,
      testGroup,
      '!sodivu off',
      '5511999998888',
      true,
      true,
      false
    );

    assert.ok(sentMessage, 'Deve enviar mensagem');
    assert.ok(sentMessage.text.includes('MODO SÓ DIVULGAÇÃO DESATIVADO'), 'Texto deve confirmar desativação');
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), false);
  });

  await runTestAsync('2.3 handleSoDivuControl ativa !sodivu-global on', async () => {
    let sentMessage = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessage = content;
        return { key: { id: 'MOCK_MSG_3' } };
      }
    };

    await spyFeatures.handleSoDivuControl(
      mockSock,
      testGroup,
      '!sodivu-global on',
      '5511999998888',
      true,
      true,
      true // isOwner
    );

    assert.ok(sentMessage, 'Deve enviar mensagem');
    assert.ok(sentMessage.text.includes('MODO SÓ DIVULGAÇÃO GLOBAL ATIVADO'), 'Texto deve confirmar global on');
    assert.strictEqual(models.isGlobalSoDivuActive(), true);

    // Desativa global
    await spyFeatures.handleSoDivuControl(
      mockSock,
      testGroup,
      '!sodivu-global off',
      '5511999998888',
      true,
      true,
      true
    );
    assert.strictEqual(models.isGlobalSoDivuActive(), false);
  });

  await runTestAsync('2.4 Membro comum sem admin não pode alternar !sodivu', async () => {
    let sentMessage = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessage = content;
        return { key: { id: 'MOCK_MSG_4' } };
      }
    };

    await spyFeatures.handleSoDivuControl(
      mockSock,
      testGroup,
      '!sodivu on',
      '5511988887777',
      true,
      false, // isAdmin = false
      false  // isOwner = false
    );

    assert.ok(sentMessage, 'Deve avisar que é restrito');
    assert.ok(sentMessage.text.includes('Acesso Negado') || sentMessage.text.includes('restrito'), 'Deve conter mensagem de restrição');
  });

  // -------------------------------------------------------------------------
  // BLOCO 3: Registro de Comandos no Handler
  // -------------------------------------------------------------------------
  console.log('\n⚡ Bloco 3: Registro de Comandos no Handler PayBot');

  runTest('3.1 Comando !sodivu deve estar registrado no catálogo', () => {
    const cmd = handler.findCommand('sodivu');
    assert.ok(cmd, 'Comando sodivu deve existir');
    assert.strictEqual(cmd.name, 'sodivu');
  });

  runTest('3.2 Aliases de !sodivu devem resolver para o mesmo comando', () => {
    const aliases = ['sodivulgacao', 'apenasdivu', 'apenasdivulgacao', 'somentedivu', 'somentedivulgacao'];
    aliases.forEach(alias => {
      const cmd = handler.findCommand(alias);
      assert.ok(cmd, `Alias ${alias} deve resolver`);
      assert.strictEqual(cmd.name, 'sodivu');
    });
  });

  runTest('3.3 Comando !sodivuglobal deve estar registrado com aliases', () => {
    const cmd = handler.findCommand('sodivuglobal');
    assert.ok(cmd, 'Comando sodivuglobal deve existir');
    const cmdDash = handler.findCommand('sodivu-global');
    assert.ok(cmdDash, 'Alias sodivu-global deve resolver');
    const cmdUnder = handler.findCommand('sodivu_global');
    assert.ok(cmdUnder, 'Alias sodivu_global deve resolver');
  });

  // -------------------------------------------------------------------------
  // BLOCO 4: Filtragem de Mensagens no handler.handleMessage
  // -------------------------------------------------------------------------
  console.log('\n🛡️ Bloco 4: Filtragem e Silêncio em Modo Só Divulgação');

  await runTestAsync('4.1 Membro comum enviando comando comum (!menu) é silenciado quando Só Divulgação ativo', async () => {
    models.setGroupSoDivu(testGroup, true);
    let replyCount = 0;

    const mockMsg = {
      key: { remoteJid: testGroup, fromMe: false, participant: '5511988887777@s.whatsapp.net', id: 'TEST_MSG_MEMBER' },
      message: { conversation: '!menu' },
      isGroup: true
    };

    const mockSock = {
      user: { id: '554884702848:1@s.whatsapp.net' },
      sendMessage: async () => {
        replyCount++;
      },
      groupMetadata: async () => ({
        id: testGroup,
        participants: [
          { id: '554884702848@s.whatsapp.net', admin: 'admin' },
          { id: '5511988887777@s.whatsapp.net', admin: null }
        ]
      })
    };

    const mockBot = {
      isOwnerNumber: () => false,
      isRealOwnerUser: () => false,
      checkIsAdmin: async () => false
    };

    await handler.handleMessage(mockBot, mockMsg, mockSock);
    assert.strictEqual(replyCount, 0, 'Comando comum de membro comum não deve ter nenhuma resposta no grupo');
  });

  await runTestAsync('4.2 Admin enviando comando de controle (!sodivu off) é processado com sucesso', async () => {
    models.setGroupSoDivu(testGroup, true);
    if (handler.groupMetadataCache) handler.groupMetadataCache.clear();
    let sentContent = null;

    const mockMsg = {
      key: { remoteJid: testGroup, fromMe: false, participant: '5511999990000@s.whatsapp.net', id: 'TEST_MSG_ADMIN_UNIQUE_1' },
      message: { conversation: '!sodivu off' },
      isGroup: true
    };

    const mockSock = {
      user: { id: '554884702848:1@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentContent = content;
        return { key: { id: 'RES_1' } };
      },
      groupMetadata: async () => ({
        id: testGroup,
        participants: [
          { id: '554884702848@s.whatsapp.net', admin: 'admin' },
          { id: '5511999990000@s.whatsapp.net', admin: 'admin' }
        ]
      })
    };

    const mockBot = {
      isOwnerNumber: () => false,
      isRealOwnerUser: () => false,
      checkIsAdmin: async () => true
    };

    await handler.handleMessage(mockBot, mockMsg, mockSock);
    assert.ok(sentContent, 'Admin deve receber resposta do comando de controle');
    assert.strictEqual(models.isGroupSoDivuActive(testGroup), false, 'Modo deve ter sido desligado');
  });

  // -------------------------------------------------------------------------
  // BLOCO 5: Integração com o Lab de Conexões
  // -------------------------------------------------------------------------
  console.log('\n🔬 Bloco 5: Integração com o Lab de Conexões');

  runTest('5.1 Catálogo do Lab deve incluir !sodivu e !sodivu-global', () => {
    const catalog = connectionLabService.getCommandCatalog();
    const arbiterCategory = catalog.find(c => c.category.includes('Árbitro') || c.category.includes('Sistema'));
    assert.ok(arbiterCategory, 'Categoria Árbitro da Operação deve existir no Lab');
    
    const sodivuCmd = arbiterCategory.commands.find(c => c.cmd === 'sodivu');
    assert.ok(sodivuCmd, 'Comando sodivu deve estar catalogado no Lab');
    assert.strictEqual(sodivuCmd.name, '!sodivu');

    const sodivuGlobalCmd = arbiterCategory.commands.find(c => c.cmd === 'sodivuglobal');
    assert.ok(sodivuGlobalCmd, 'Comando sodivuglobal deve estar catalogado no Lab');
  });

  await runTestAsync('5.2 Executar !sodivu no Lab de Conexões retorna resposta direta', async () => {
    const result = await connectionLabService.executeLabCommand({
      connectionId: 'whatsapp_master',
      command: 'sodivu',
      input: 'status',
      targetRecipient: testGroup,
      sendDirectly: false
    });

    assert.ok(result.success, 'Execução no Lab deve ser bem sucedida');
    const textOut = result.resultText || '';
    assert.ok(textOut.includes('MODO SÓ DIVULGAÇÃO') || textOut.includes('STATUS'), 'Resposta deve conter status');
  });

  // Limpeza final
  models.setGroupSoDivu(testGroup, false);
  models.setGlobalSoDivu(false);

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests} de ${totalTests} testes passaram com sucesso!`);
  console.log('======================================================\n');

  process.exit(passedTests === totalTests ? 0 : 1);
}

main().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

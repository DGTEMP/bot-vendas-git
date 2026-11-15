/**
 * Suíte de Testes: Comando !clonefun (Clonagem e Ativação Instantânea de Funções de Outros Bots)
 */

const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const models = require('./src/db/models');

async function runCloneFunTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: COMANDO !clonefun (CLONAGEM & ATIVAÇÃO INSTANTÂNEA DE FUNÇÕES)');
  console.log('========================================================================\n');

  // Limpeza de testes anteriores
  try {
    const existing = models.getCustomTriggers({ platform: 'all' })
      .filter(t => t.keyword === '!rastreio_teste' || t.keyword === '!foto_teste' || t.keyword === '!card_teste');
    existing.forEach(e => models.deleteCustomTrigger(e.id));
  } catch (_) {}

  // --------------------------------------------------------------------------
  console.log('--- Teste 1: !clonefun Sem Marcar Mensagem (Guia Didático) ---');
  // --------------------------------------------------------------------------
  {
    let replyText = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      isGroup: false,
      quoted: null,
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleCloneFun({}, mockMsg.chat, mockMsg, [], '', { handler });
    assert(result.includes('CLONADOR DE FUNÇÕES E COMANDOS'), 'Deve conter título do clonador');
    assert(result.includes('Nenhuma mensagem foi marcada!'), 'Deve alertar falta de citação');
    assert(result.includes('!clonefun <nome_do_comando>'), 'Deve ensinar a sintaxe correta');
    assert(result.includes('!delclone'), 'Deve citar comando de remoção');
    assert(result.includes('!clones'), 'Deve citar comando de listagem');
    console.log('  ✅ [PASS] 1. !clonefun sem citação exibe guia passo a passo.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: !clonefun Sem Informar Nome do Comando ---');
  // --------------------------------------------------------------------------
  {
    let replyText = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      isGroup: false,
      quoted: {
        id: 'OTHER_BOT_MSG_1',
        sender: '5511988887777@s.whatsapp.net',
        senderNumber: '5511988887777',
        fromMe: false,
        mtype: 'conversation',
        text: 'Olá! Como posso ajudar você hoje?'
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleCloneFun({}, mockMsg.chat, mockMsg, [], '', { handler });
    assert(result.includes('informe o nome do comando que deseja criar'), 'Deve solicitar o nome do comando');
    console.log('  ✅ [PASS] 2. !clonefun solicita o nome do comando quando não fornecido e não inferível.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: Clonando Card com Link Preview (!clonefun rastreio_teste) ---');
  // --------------------------------------------------------------------------
  {
    let replyText = '';
    const mockMsg = {
      chat: '120363000000000000@g.us',
      isGroup: true,
      quoted: {
        id: 'OTHER_BOT_TRACKING_MSG',
        sender: '5511988885555@s.whatsapp.net',
        senderNumber: '5511988885555',
        fromMe: false,
        mtype: 'extendedTextMessage',
        text: '📦 Rastreie sua encomenda em tempo real pelo link abaixo:',
        message: {
          extendedTextMessage: {
            text: '📦 Rastreie sua encomenda em tempo real pelo link abaixo:',
            contextInfo: {
              externalAdReply: {
                title: '🚚 Rastreamento Expresso 24h',
                body: 'Digite o código de rastreio para atualizar',
                mediaType: 1,
                thumbnailUrl: 'https://cdn.rastreio.com/banner.jpg',
                sourceUrl: 'https://rastreio.com/consultar',
                renderLargerThumbnail: true,
                showAdAttribution: true
              }
            }
          }
        }
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleCloneFun({}, mockMsg.chat, mockMsg, ['rastreio_teste'], 'rastreio_teste', { handler });
    assert(result.includes('FUNÇÃO DE OUTRO BOT CLONADA COM SUCESSO!'), 'Deve confirmar clonagem');
    assert(result.includes('!rastreio_teste'), 'Deve indicar o comando criado');
    assert(result.includes('Ativa & Persistida no SQLite'), 'Deve confirmar persistência no banco');
    assert(result.includes('Rastreamento Expresso 24h'), 'Deve incluir metadados no payload');
    assert(result.includes('await sock.sendMessage(jid,'), 'Deve gerar código Baileys de replicação');

    // Valida no banco SQLite (custom_triggers)
    const trigger = models.getCustomTriggers({ platform: 'all' })
      .find(t => t.keyword === '!rastreio_teste');
    assert(trigger, 'Trigger deve estar salvo na tabela custom_triggers');
    assert.strictEqual(trigger.category, 'Cloned Commands', 'Categoria deve ser Cloned Commands');

    console.log('  ✅ [PASS] 3. Função de outro bot clonada, salva em SQLite e ativada como comando.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Executando o Comando Clonado Recém-Criado (!rastreio_teste) ---');
  // --------------------------------------------------------------------------
  {
    let sentToChat = null;
    let sentPayload = null;
    const mockConn = {
      sendMessage: async (jid, content) => {
        sentToChat = jid;
        sentPayload = content;
        return { key: { id: 'DISPATCH_CLONED_1' } };
      }
    };

    const cmdRastreio = handler.findCommand('rastreio_teste');
    assert(cmdRastreio, 'Comando rastreio_teste deve estar registrado no catálogo do Handler');

    let replyResult = null;
    const mockExecMsg = {
      chat: '120363999999999999@g.us',
      senderNumber: '5511999991234',
      isGroup: true,
      command: 'rastreio_teste',
      text: '!rastreio_teste',
      reply: async (txt) => { replyResult = txt; return txt; }
    };

    await cmdRastreio.run(mockExecMsg, { conn: mockConn });
    assert(sentPayload, 'sock.sendMessage deve ter sido chamado com o payload clonado');
    assert(sentPayload.text.includes('Rastreie sua encomenda'), 'Texto clonado deve ser idêntico');
    assert(sentPayload.contextInfo?.externalAdReply?.title === '🚚 Rastreamento Expresso 24h', 'externalAdReply deve ser idêntico');
    console.log('  ✅ [PASS] 4. O comando clonado !rastreio_teste respondeu perfeitamente com o card e preview!');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 5: Clonando Foto com Legenda (!clonefun foto_teste) ---');
  // --------------------------------------------------------------------------
  {
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      isGroup: false,
      quoted: {
        id: 'OTHER_BOT_IMG_99',
        sender: '5511988881111@s.whatsapp.net',
        senderNumber: '5511988881111',
        fromMe: false,
        mtype: 'imageMessage',
        text: '📸 Banner promocional oficial com 50% de desconto',
        message: {
          imageMessage: {
            url: 'https://cdn.exemplo.com/banner.jpg',
            caption: '📸 Banner promocional oficial com 50% de desconto',
            mimetype: 'image/jpeg'
          }
        }
      },
      reply: async (txt) => txt
    };

    const result = await spyFeatures.handleCloneFun({}, mockMsg.chat, mockMsg, ['foto_teste'], 'foto_teste', { handler });
    assert(result.includes('!foto_teste'), 'Deve criar comando foto_teste');
    assert(result.includes('imageMessage'), 'Deve identificar imageMessage');

    const cmdFoto = handler.findCommand('foto_teste');
    assert(cmdFoto, 'Comando foto_teste deve estar registrado');

    let sentFoto = null;
    await cmdFoto.run({ chat: '5511999990000@s.whatsapp.net', reply: async () => {} }, {
      conn: {
        sendMessage: async (jid, content) => { sentFoto = content; }
      }
    });

    assert(sentFoto && sentFoto.image, 'Deve disparar mensagem de imagem');
    assert(sentFoto.caption.includes('Banner promocional'), 'Legenda deve ser clonada');
    console.log('  ✅ [PASS] 5. Função de imagem clonada e executada com sucesso.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 6: Listando Funções Clonadas (!clones) ---');
  // --------------------------------------------------------------------------
  {
    let listReply = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      reply: async (txt) => { listReply = txt; return txt; }
    };

    const listResult = await spyFeatures.handleListClones({}, mockMsg.chat, mockMsg);
    assert(listResult.includes('CATÁLOGO DE FUNÇÕES CLONADAS'), 'Deve conter título');
    assert(listResult.includes('!rastreio_teste'), 'Deve listar !rastreio_teste');
    assert(listResult.includes('!foto_teste'), 'Deve listar !foto_teste');
    console.log('  ✅ [PASS] 6. !clones lista todas as funções clonadas no banco de dados.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 7: Removendo Função Clonada (!delclone rastreio_teste) ---');
  // --------------------------------------------------------------------------
  {
    let delReply = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      reply: async (txt) => { delReply = txt; return txt; }
    };

    const delResult = await spyFeatures.handleDelClone({}, mockMsg.chat, mockMsg, ['rastreio_teste'], 'rastreio_teste');
    assert(delResult.includes('removido com sucesso'), 'Deve confirmar remoção');

    // Valida no banco
    const triggerAfter = models.getCustomTriggers({ platform: 'all' })
      .find(t => t.keyword === '!rastreio_teste');
    assert(!triggerAfter, 'Trigger !rastreio_teste não deve mais existir no banco');
    console.log('  ✅ [PASS] 7. !delclone removeu com sucesso o comando do banco e da memória.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 8: Validação dos Aliases de !clonefun no Handler ---');
  // --------------------------------------------------------------------------
  {
    const aliases = ['clonefun', 'clonefuncao', 'clonarfun', 'clonarfuncao', 'clonefunc', 'clonarmensagem', 'clonarcmd', 'clonecmd'];
    for (const a of aliases) {
      assert(handler.findCommand(a), `Alias !${a} deve estar registrado no handler`);
    }

    assert(handler.findCommand('delclone'), 'Alias !delclone registrado');
    assert(handler.findCommand('rmclone'), 'Alias !rmclone registrado');
    assert(handler.findCommand('clones'), 'Alias !clones registrado');
    assert(handler.findCommand('listclones'), 'Alias !listclones registrado');
    console.log('  ✅ [PASS] 8. Todos os aliases de !clonefun, !delclone e !clones registrados no Handler.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 9: Persistência após Reinicialização do Bot (_registerClonedCommandsFromDb) ---');
  // --------------------------------------------------------------------------
  {
    // Simula reinicialização do bot criando uma nova instância de PayBotHandler
    const PayBotHandlerClass = handler.constructor;
    const freshHandler = new PayBotHandlerClass();

    const cmdFotoPersistent = freshHandler.findCommand('foto_teste');
    assert(cmdFotoPersistent, 'Comando foto_teste persistido no SQLite deve ser registrado automaticamente na inicialização');
    console.log('  ✅ [PASS] 9. Comandos clonados persistem no SQLite e sobem automaticamente após reinicialização!');
  }

  // Limpeza final dos comandos de teste
  try {
    const existing = models.getCustomTriggers({ platform: 'all' })
      .filter(t => t.keyword === '!rastreio_teste' || t.keyword === '!foto_teste');
    existing.forEach(e => models.deleteCustomTrigger(e.id));
  } catch (_) {}

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS 9 TESTES DE CLONAGEM DE FUNÇÕES (!clonefun) PASSARAM COM SUCESSO!');
  console.log('========================================================================');
}

runCloneFunTests().catch(err => {
  console.error('❌ Falha nos testes de !clonefun:', err);
  process.exit(1);
});

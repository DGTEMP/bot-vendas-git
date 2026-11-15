/**
 * Suíte de Testes: Telemetria VIP no !ping e Comando !get (Inspector & Replicator)
 */

const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const models = require('./src/db/models');

async function runAllTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: TELEMETRIA VIP NO !ping E COMANDO !get (INSPECTION & CODE REPLICATION)');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- Teste 1: !ping para Usuário Comum (Não-VIP) ---');
  // --------------------------------------------------------------------------
  {
    const mockCommonSock = {
      instanceId: 1,
      sendMessage: async (jid, content) => ({ key: { id: 'PING_1' }, text: content.text })
    };

    const regularText = spyFeatures.buildPingDiagnosticText({
      sock: mockCommonSock,
      from: '5511977770000@s.whatsapp.net',
      isOwnerUser: false,
      isVipUser: false,
      senderPhone: '5511977770000'
    });

    assert(regularText.includes('PONG! STATUS & DIAGNÓSTICO'), 'Cabeçalho de usuário comum');
    assert(!regularText.includes('TELEMETRIA EXCLUSIVA VIP'), 'Usuário comum NÃO pode ter bloco VIP');
    assert(!regularText.includes('Memória RAM:'), 'Usuário comum NÃO pode ter rótulo Memória RAM');
    assert(regularText.includes('Consumo de Memória:'), 'Usuário comum deve ter Consumo de Memória');
    console.log('  ✅ [PASS] 1. !ping de usuário comum exibe status padrão seguro sem telemetria VIP.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: !ping para Usuário VIP (Telemetria VIP Completa) ---');
  // --------------------------------------------------------------------------
  {
    const mockVipSock = {
      instanceId: 1,
      sendMessage: async (jid, content) => ({ key: { id: 'PING_VIP' }, text: content.text })
    };

    const vipText = spyFeatures.buildPingDiagnosticText({
      sock: mockVipSock,
      from: '5511999998811@s.whatsapp.net',
      isOwnerUser: false,
      isVipUser: true,
      senderPhone: '5511999998811'
    });

    assert(vipText.includes('PONG! DIAGNÓSTICO VIP'), 'Deve conter cabeçalho VIP');
    assert(vipText.includes('TELEMETRIA EXCLUSIVA VIP:'), 'Deve conter bloco de telemetria VIP');
    assert(vipText.includes('Fila Ultra Prioritária'), 'Deve citar fila ultra prioritária');
    assert(vipText.includes('Latência do Event Loop:'), 'Deve conter latência do Event Loop');
    assert(vipText.includes('Cota de IA & Processamento:'), 'Deve citar cota de IA ilimitada');
    assert(vipText.includes('Métricas de Vendas & Leads:'), 'Deve citar métricas de pedidos e leads');
    assert(vipText.includes('Saúde do Banco SQLite:'), 'Deve citar saúde do SQLite WAL');
    assert(vipText.includes('WebSocket Baileys:'), 'Deve citar status do WebSocket Baileys');
    assert(vipText.includes('!get'), 'Deve citar o recurso VIP exclusivo !get');
    console.log('  ✅ [PASS] 2. !ping para VIP exibe telemetria rica, métricas de vendas e status do Event Loop.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: !ping para o Dono Supremo (Diagnóstico + VIP) ---');
  // --------------------------------------------------------------------------
  {
    const mockOwnerSock = {
      instanceId: 1,
      sendMessage: async (jid, content) => ({ key: { id: 'PING_OWNER' }, text: content.text })
    };

    const ownerText = spyFeatures.buildPingDiagnosticText({
      sock: mockOwnerSock,
      from: '554884702848@s.whatsapp.net',
      isOwnerUser: true,
      senderPhone: '554884702848'
    });

    assert(ownerText.includes('PONG! DIAGNÓSTICO (DONO)'), 'Deve conter cabeçalho do Dono');
    assert(ownerText.includes('TELEMETRIA EXCLUSIVA VIP:'), 'Dono recebe automaticamente o bloco VIP');
    assert(ownerText.includes('Memória RAM:'), 'Dono visualiza rótulo de Memória RAM');
    assert(ownerText.includes('RAM da Máquina:'), 'Dono visualiza RAM da Máquina');
    console.log('  ✅ [PASS] 3. !ping para o Dono inclui diagnóstico de hardware + Telemetria VIP.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Comando !get Sem Marcar Mensagem (Guia de Uso) ---');
  // --------------------------------------------------------------------------
  {
    const mockSock = {
      sendMessage: async (jid, content) => ({ key: { id: 'GET_HELP' }, text: content.text })
    };

    let replyText = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      isGroup: false,
      quoted: null,
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleGet(mockSock, mockMsg.chat, mockMsg, {});
    assert(result.includes('Nenhuma mensagem foi marcada!'), 'Deve alertar que nenhuma mensagem foi marcada');
    assert(result.includes('Como usar este comando:'), 'Deve apresentar instruções de uso');
    assert(result.includes('!inspectmsg'), 'Deve citar aliases');
    assert(result.includes('sock.sendMessage'), 'Deve explicar a geração de código Baileys');
    console.log('  ✅ [PASS] 4. !get sem citação exibe guia claro e didático de utilização.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 5: !get Citando Mensagem com Link Preview (externalAdReply) ---');
  // --------------------------------------------------------------------------
  {
    const mockSock = {
      sendMessage: async (jid, content) => ({ key: { id: 'GET_1' }, text: content.text })
    };

    let replyText = '';
    const mockMsg = {
      chat: '120363000000000000@g.us',
      isGroup: true,
      quoted: {
        id: 'STANZA_998811',
        sender: '5511988887777@s.whatsapp.net',
        senderNumber: '5511988887777',
        fromMe: false,
        mtype: 'extendedTextMessage',
        text: 'Aproveite a promoção de Smartwatches!',
        message: {
          extendedTextMessage: {
            text: 'Aproveite a promoção de Smartwatches!',
            contextInfo: {
              externalAdReply: {
                title: '⚡ Relógio Smart Nitro X',
                body: 'R$ 199,00 com frete grátis hoje',
                mediaType: 1,
                thumbnailUrl: 'https://cdn.loja.com/relogio.jpg',
                sourceUrl: 'https://loja.com/nitro-x',
                renderLargerThumbnail: true,
                showAdAttribution: true
              }
            }
          }
        }
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleGet(mockSock, mockMsg.chat, mockMsg, {});
    assert(result.includes('PAYBOT INSPECTOR & CODE REPLICATOR'), 'Deve conter título do Inspector');
    assert(result.includes('STANZA_998811'), 'Deve extrair o ID da mensagem');
    assert(result.includes('5511988887777'), 'Deve extrair o remetente');
    assert(result.includes('extendedTextMessage'), 'Deve identificar o tipo extendedTextMessage');
    assert(result.includes('Relógio Smart Nitro X'), 'Deve extrair o título do externalAdReply');
    assert(result.includes('https://loja.com/nitro-x'), 'Deve extrair a sourceUrl');
    assert(result.includes('await sock.sendMessage(jid,'), 'Deve gerar código Baileys sock.sendMessage');
    console.log('  ✅ [PASS] 5. !get extrai perfeitamente payload com externalAdReply e gera código Baileys.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 6: !get Citando Mensagem com Imagem e Legenda ---');
  // --------------------------------------------------------------------------
  {
    const mockSock = {
      sendMessage: async (jid, content) => ({ key: { id: 'GET_2' }, text: content.text })
    };

    let replyText = '';
    const mockMsg = {
      chat: '5511999990000@s.whatsapp.net',
      isGroup: false,
      quoted: {
        id: 'IMG_MSG_4455',
        sender: '5511999991111@s.whatsapp.net',
        senderNumber: '5511999991111',
        fromMe: false,
        mtype: 'imageMessage',
        text: 'Foto do produto em estoque pronta para envio!',
        message: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/test.enc',
            mimetype: 'image/jpeg',
            caption: 'Foto do produto em estoque pronta para envio!'
          }
        }
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleGet(mockSock, mockMsg.chat, mockMsg, {});
    assert(result.includes('imageMessage'), 'Deve identificar imageMessage');
    assert(result.includes('Foto do produto em estoque'), 'Deve extrair a legenda da foto');
    assert(result.includes('image/jpeg'), 'Deve identificar o mimetype');
    assert(result.includes('await sock.sendMessage(jid,'), 'Deve gerar código de envio Baileys para imagem');
    console.log('  ✅ [PASS] 6. !get extrai payload de imagem e formata código de envio.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 7: !get Citando Comando de Bot (Geração de Boilerplate) ---');
  // --------------------------------------------------------------------------
  {
    const mockSock = {
      sendMessage: async (jid, content) => ({ key: { id: 'GET_3' }, text: content.text })
    };

    let replyText = '';
    const mockMsg = {
      chat: '120363000000000000@g.us',
      isGroup: true,
      quoted: {
        id: 'CMD_MSG_123',
        sender: '5511988880002@s.whatsapp.net',
        senderNumber: '5511988880002',
        fromMe: true,
        mtype: 'extendedTextMessage',
        text: '!catalogo',
        message: {
          extendedTextMessage: {
            text: '!catalogo'
          }
        }
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleGet(mockSock, mockMsg.chat, mockMsg, {});
    assert(result.includes('BOILERPLATE PARA REGISTRAR ESTE COMANDO EM OUTRO BOT:'), 'Deve incluir seção de boilerplate');
    assert(result.includes("name: 'catalogo'"), 'Deve gerar registro do comando catalogo');
    assert(result.includes("command: ['catalogo']"), 'Deve definir alias catalogo');
    assert(result.includes('bot.registerCommand'), 'Deve conter bot.registerCommand');
    console.log('  ✅ [PASS] 7. !get gera automaticamente boilerplate de handler para comandos.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 8: !get Citando Mensagem com Botões / Interativa ---');
  // --------------------------------------------------------------------------
  {
    const mockSock = {
      sendMessage: async (jid, content) => ({ key: { id: 'GET_4' }, text: content.text })
    };

    let replyText = '';
    const mockMsg = {
      chat: '120363000000000000@g.us',
      isGroup: true,
      quoted: {
        id: 'BTN_MSG_77',
        sender: '5511988887777@s.whatsapp.net',
        senderNumber: '5511988887777',
        fromMe: false,
        mtype: 'buttonsMessage',
        text: 'Escolha seu método de pagamento:',
        message: {
          buttonsMessage: {
            contentText: 'Escolha seu método de pagamento:',
            footerText: 'PayBot Checkout',
            buttons: [
              { buttonId: 'pix', buttonText: { displayText: '💳 Pagar com Pix' } },
              { buttonId: 'cartao', buttonText: { displayText: '💳 Cartão de Crédito' } }
            ]
          }
        }
      },
      reply: async (txt) => { replyText = txt; return txt; }
    };

    const result = await spyFeatures.handleGet(mockSock, mockMsg.chat, mockMsg, {});
    assert(result.includes('buttonsMessage'), 'Deve identificar buttonsMessage');
    assert(result.includes('Pagar com Pix'), 'Deve conter texto do botão 1');
    assert(result.includes('Cartão de Crédito'), 'Deve conter texto do botão 2');
    assert(result.includes('PayBot Checkout'), 'Deve conter footer do botão');
    console.log('  ✅ [PASS] 8. !get extrai payload de botões interativos e estrutura para replicação.');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 9: Registro no Handler de Comandos e Aliases ---');
  // --------------------------------------------------------------------------
  {
    const cmdGet = handler.findCommand('get');
    assert(cmdGet, 'Comando !get deve estar registrado no handler');
    assert(handler.findCommand('inspectmsg'), 'Alias !inspectmsg deve estar registrado');
    assert(handler.findCommand('dumpmsg'), 'Alias !dumpmsg deve estar registrado');
    assert(handler.findCommand('rawmsg'), 'Alias !rawmsg deve estar registrado');
    assert(handler.findCommand('copymsg'), 'Alias !copymsg deve estar registrado');
    assert(handler.findCommand('getcode'), 'Alias !getcode deve estar registrado');
    assert(handler.findCommand('clonemsg'), 'Alias !clonemsg deve estar registrado');
    assert(handler.findCommand('clonarmsg'), 'Alias !clonarmsg deve estar registrado');

    // Executa via handler
    let handlerExecuted = false;
    const mockHandlerMsg = {
      chat: '5511999990000@s.whatsapp.net',
      senderNumber: '5511999990000',
      isGroup: false,
      quoted: null,
      reply: async (txt) => {
        handlerExecuted = true;
        assert(txt.includes('Nenhuma mensagem foi marcada!'), 'Handler deve retornar guia de uso');
        return txt;
      }
    };

    await cmdGet.run(mockHandlerMsg, { conn: {}, isOwner: true });
    assert(handlerExecuted, 'Handler deve executar m.reply para !get');
    console.log('  ✅ [PASS] 9. Comando !get e todos os 7 aliases devidamente registrados e operantes no Handler.');
  }

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS 9 TESTES DE TELEMETRIA VIP E DO COMANDO !get PASSARAM COM SUCESSO!');
  console.log('========================================================================');
}

runAllTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

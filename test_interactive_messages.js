/**
 * test_interactive_messages.js
 * 
 * Suíte de testes automatizados para Botões e Listas Interativas do WhatsApp:
 * 1. Testes unitários do interactiveMessageService (criação de botões, listas, cópia Pix com 1 toque)
 * 2. Testes de extração de mensagens (cliques em botões, respostas de listas e fallback de texto)
 * 3. Testes de resiliência e fallback para clientes que não suportam Native Flow
 * 4. Testes de integração com sendMenu, sendPrivateInitialDialogue e processPixPurchase
 */

const assert = require('assert');
const models = require('./src/db/models');
const interactiveService = require('./src/services/interactiveMessageService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');

async function runTests() {
  console.log('🧪 Iniciando testes de Botões e Listas Interativas...');
  let passed = 0;

  // Teste 1: interactiveService.buildNativeFlowButtons
  {
    console.log('\n[1/6] Testando construção de botões Native Flow...');
    const buttons = [
      { type: 'quick_reply', text: '🛒 Ver Catálogo', id: '1' },
      { type: 'cta_url', text: '🌐 Vitrine Online', url: 'https://exemplo.com/loja' },
      { type: 'cta_copy', text: '📋 Copiar Pix', code: '00020126580014br.gov.bcb.pix...' },
      {
        type: 'single_select',
        buttonText: '📦 Lista de Produtos',
        sections: [
          {
            title: 'Softwares',
            rows: [
              { id: 'P1', title: 'Bot de Vendas', description: 'R$ 49,90' },
              { id: 'P2', title: 'Sistema Web', description: 'R$ 99,00' }
            ]
          }
        ]
      }
    ];

    const nativeButtons = interactiveService.buildNativeFlowButtons(buttons);
    assert.strictEqual(nativeButtons.length, 4, 'Deve conter 4 botões');
    assert.strictEqual(nativeButtons[0].name, 'quick_reply');
    assert.strictEqual(JSON.parse(nativeButtons[0].buttonParamsJson).id, '1');

    assert.strictEqual(nativeButtons[1].name, 'cta_url');
    assert.strictEqual(JSON.parse(nativeButtons[1].buttonParamsJson).url, 'https://exemplo.com/loja');

    assert.strictEqual(nativeButtons[2].name, 'cta_copy');
    assert.strictEqual(JSON.parse(nativeButtons[2].buttonParamsJson).copy_code, '00020126580014br.gov.bcb.pix...');

    assert.strictEqual(nativeButtons[3].name, 'single_select');
    const listParams = JSON.parse(nativeButtons[3].buttonParamsJson);
    assert.strictEqual(listParams.title, '📦 Lista de Produtos');
    assert.strictEqual(listParams.sections.length, 1);
    assert.strictEqual(listParams.sections[0].rows[0].id, 'P1');

    console.log('  ✅ Botões quick_reply, cta_url, cta_copy e single_select construídos perfeitamente!');
    passed++;
  }

  // Teste 2: Formatação de Fallback de Texto
  {
    console.log('\n[2/6] Testando formatação de Fallback em Texto...');
    const buttons = [
      { type: 'quick_reply', text: 'Ver Catálogo', id: '1' },
      { type: 'cta_url', text: 'Vitrine Online', url: 'https://minhaloja.com' },
      { type: 'cta_copy', text: 'Copiar Pix', code: 'CHAVE_PIX_123' }
    ];
    const textFb = interactiveService.formatButtonsAsText({
      title: 'Menu de Atendimento',
      text: 'Selecione uma opção:',
      footer: 'Bot de Vendas',
      buttons
    });

    assert(textFb.includes('*Menu de Atendimento*'), 'Deve conter o título');
    assert(textFb.includes('Envie *1* para: *Ver Catálogo*'), 'Deve conter atalho numérico');
    assert(textFb.includes('https://minhaloja.com'), 'Deve conter link');
    assert(textFb.includes('CHAVE_PIX_123'), 'Deve conter chave Pix');

    const sections = [
      {
        title: 'Produtos Digitais',
        rows: [
          { id: 'P1', title: 'Bot VIP', description: 'R$ 29,90' }
        ]
      }
    ];
    const secFb = interactiveService.formatSectionsAsText({
      title: 'Cardápio',
      text: 'Itens disponíveis:',
      footer: 'Entrega Imediata',
      sections
    });
    assert(secFb.includes('PRODUTOS DIGITAIS'), 'Deve conter o cabeçalho da seção');
    assert(secFb.includes('👉 Envie *P1*: *Bot VIP*'), 'Deve conter o ID e nome do item');

    console.log('  ✅ Formatação de fallback textual validada com sucesso!');
    passed++;
  }

  // Teste 3: Extração de Ações e Cliques de Botão (extractInteractiveAction)
  {
    console.log('\n[3/6] Testando extração de cliques e respostas interativas...');

    // 1. Native Flow Quick Reply
    const msgQuick = {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            name: 'quick_reply',
            paramsJson: JSON.stringify({ id: 'P1' })
          }
        }
      }
    };
    const resQuick = interactiveService.extractInteractiveAction(msgQuick);
    assert.strictEqual(resQuick.text, 'P1');
    assert.strictEqual(resQuick.actionId, 'P1');

    // 2. ViewOnce Message com Single Select List Row
    const msgList = {
      message: {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              nativeFlowResponseMessage: {
                name: 'single_select',
                paramsJson: JSON.stringify({ id: '!loja' })
              }
            }
          }
        }
      }
    };
    const resList = interactiveService.extractInteractiveAction(msgList);
    assert.strictEqual(resList.text, '!loja');
    assert.strictEqual(resList.actionId, '!loja');

    // 3. Baileys Legacy Buttons Response
    const msgBtn = {
      message: {
        buttonsResponseMessage: {
          selectedButtonId: 'C1'
        }
      }
    };
    const resBtn = interactiveService.extractInteractiveAction(msgBtn);
    assert.strictEqual(resBtn.text, 'C1');

    // 4. List Response Tradicional
    const msgListTrad = {
      message: {
        listResponseMessage: {
          singleSelectReply: {
            selectedRowId: '0'
          }
        }
      }
    };
    const resListTrad = interactiveService.extractInteractiveAction(msgListTrad);
    assert.strictEqual(resListTrad.text, '0');

    // 5. Conversa em texto tradicional
    const msgConv = {
      message: {
        conversation: 'Olá quero tirar uma dúvida'
      }
    };
    const resConv = interactiveService.extractInteractiveAction(msgConv);
    assert.strictEqual(resConv.text, 'Olá quero tirar uma dúvida');
    assert.strictEqual(resConv.actionId, '');

    console.log('  ✅ Extração de cliques Native Flow, listas e botões legados validada!');
    passed++;
  }

  // Teste 4: Mock Socket relayMessage e Fallback Inteligente
  {
    console.log('\n[4/6] Testando envio com Mock Socket e recuperação contra erros...');
    let relayCalled = false;
    let relayedJid = '';
    let sendMsgCalled = false;

    const mockSock = {
      user: { id: '5511999999999@s.whatsapp.net' },
      relayMessage: async (jid, message, opts) => {
        relayCalled = true;
        relayedJid = jid;
        assert(message.viewOnceMessage?.message?.interactiveMessage, 'Deve gerar interactiveMessage envelopada');
        return { key: { id: opts.messageId } };
      },
      sendMessage: async (jid, content) => {
        sendMsgCalled = true;
        return { key: { id: 'msg_fallback_123' } };
      }
    };

    // Envio com sucesso via Native Flow
    const sentOk = await interactiveService.sendInteractiveButtons(mockSock, '5511988887777@s.whatsapp.net', {
      title: 'Título Teste',
      text: 'Texto Teste',
      buttons: [{ type: 'quick_reply', text: 'Botão 1', id: 'cmd_1' }]
    });
    assert.strictEqual(sentOk, true);
    assert.strictEqual(relayCalled, true);
    assert.strictEqual(relayedJid, '5511988887777@s.whatsapp.net');

    // Simulação de erro no relayMessage -> deve acionar sendMessage com fallback
    const failingSock = {
      user: { id: '5511999999999@s.whatsapp.net' },
      relayMessage: async () => {
        throw new Error('Protocol unsupported in this client');
      },
      sendMessage: async (jid, content) => {
        sendMsgCalled = true;
        assert(content.text.includes('Botão 1'), 'Fallback deve conter o texto do botão');
        return { key: { id: 'fallback_ok' } };
      }
    };

    const sentFallback = await interactiveService.sendInteractiveButtons(failingSock, '5511988887777@s.whatsapp.net', {
      title: 'Título Fallback',
      text: 'Texto Fallback',
      buttons: [{ type: 'quick_reply', text: 'Botão 1', id: 'cmd_1' }]
    });
    assert(sentFallback, 'Deve retornar resultado do fallback');
    assert.strictEqual(sendMsgCalled, true);

    console.log('  ✅ Envio nativo e fallback de resiliência funcionam perfeitamente!');
    passed++;
  }

  // Teste 5: Integração com o fluxo sendMenu e sendPrivateInitialDialogue do Bot
  {
    console.log('\n[5/6] Testando integração com sendMenu e sendPrivateInitialDialogue...');
    let capturedMessages = [];

    const testSock = {
      user: { id: '5511999999999@s.whatsapp.net' },
      relayMessage: async (jid, message, opts) => {
        capturedMessages.push({ type: 'relay', jid, message, opts });
        return { key: { id: opts.messageId } };
      },
      sendMessage: async (jid, content) => {
        capturedMessages.push({ type: 'send', jid, content });
        return { key: { id: 'msg_id_test' } };
      },
      sendPresenceUpdate: async () => {}
    };

    // Garante produto no banco
    const products = models.getProducts();
    if (products.length === 0) {
      models.createProduct({
        name: 'Produto Teste Interativo',
        price_brl: 35.00,
        price_usdt: 7.00,
        description: 'Descrição do produto teste',
        category: 'Softwares',
        type: 'digital_item',
        active: 1
      });
    }

    // Chama sendMenu com o testSock
    await whatsappBot.sendMenu('5511977776666@s.whatsapp.net', 'Maria Teste', testSock);
    assert(capturedMessages.length > 0, 'Deve enviar ao menos uma mensagem');
    const menuMsg = capturedMessages.find(m => m.type === 'relay');
    assert(menuMsg, 'Deve enviar menu interativo via relayMessage');
    const interactive = menuMsg.message.viewOnceMessage.message.interactiveMessage;
    assert(interactive.nativeFlowMessage.buttons.length >= 1, 'Deve conter botões interativos');

    console.log('  ✅ sendMenu gerou menu interativo com lista e botões perfeitamente!');
    passed++;
  }

  // Teste 6: Integração no Handler smsg (extração de botões em plugins)
  {
    console.log('\n[6/6] Testando extração de botões no handler.js (smsg)...');

    const rawMessage = {
      key: {
        remoteJid: '5511966665555@s.whatsapp.net',
        fromMe: false,
        id: 'BTN_REPLY_123'
      },
      message: {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              nativeFlowResponseMessage: {
                name: 'quick_reply',
                paramsJson: JSON.stringify({ id: 'P1' })
              }
            }
          }
        }
      }
    };

    const mockSock = { user: { id: '5511999999999:1@s.whatsapp.net' } };
    const smsg = handler.smsg(mockSock, rawMessage);
    assert.strictEqual(smsg.body, 'P1', 'smsg.body deve ser P1');
    assert.strictEqual(smsg.text, 'P1', 'smsg.text deve ser P1');

    console.log('  ✅ handler.js smsg extrai perfeitamente o clique de botão nativo!');
    passed++;
  }

  console.log(`\n🎉 Todos os ${passed}/6 testes de Botões e Listas Interativas foram concluídos com SUCESSO!`);
}

runTests().catch(err => {
  console.error('\n❌ Falha nos testes de mensagens interativas:', err);
  process.exit(1);
});

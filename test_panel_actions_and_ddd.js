/**
 * Test Suite: Verificação do comando !ddd com marcação de membros e ações do Painel Web (TTS, Cobrança, Mensagens)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('🧪 Iniciando testes de !ddd e Ações do Painel Web (TTS, Cobrança, Mensagens)...\n');

  const spyFeatures = require('./src/services/spyFeaturesService');
  const models = require('./src/db/models');
  const pixPayment = require('./src/services/pixPayment');

  // ==========================================
  // TESTE 1: !ddd no Privado (Consulta Regional)
  // ==========================================
  console.log('--- TESTE 1: !ddd no Privado (Consulta Regional) ---');
  let privateSent = null;
  const mockSockPrivate = {
    sendMessage: async (to, content) => {
      privateSent = { to, content };
      return true;
    }
  };

  await spyFeatures.handleDDD(mockSockPrivate, '5511999998888@s.whatsapp.net', '!ddd 11');
  assert(privateSent, 'Deve responder à consulta de DDD no privado');
  assert(privateSent.content.text.includes('DDD 11 - INFORMAÇÕES REGIONAIS'), 'Deve conter título com DDD 11');
  assert(privateSent.content.text.includes('São Paulo'), 'Deve conter descrição da região de SP');
  console.log('✅ Teste 1 passou: Consulta de DDD no privado exibida com sucesso.');

  // ==========================================
  // TESTE 2: !ddd em Grupo com Membros do DDD
  // ==========================================
  console.log('\n--- TESTE 2: !ddd em Grupo com Membros do DDD (Marcação Real) ---');
  let groupSent = null;
  const mockGroupMetadata = {
    id: '12036302485938@g.us',
    subject: 'Grupo VIP de Testes',
    participants: [
      { id: '5511988881111@s.whatsapp.net' }, // DDD 11
      { id: '5511977772222:2@s.whatsapp.net' }, // DDD 11 (com device suffix)
      { id: '5521966663333@s.whatsapp.net' }, // DDD 21
      { id: '5548991234567@s.whatsapp.net' }, // DDD 48 (Membro comum 1)
      { id: '5548998765432@s.whatsapp.net' }  // DDD 48 (Membro comum 2)            // Dono (LID mapeado para 554884702848 -> DDD 48)
    ]
  };

  const mockSockGroup = {
    groupMetadata: async (gid) => mockGroupMetadata,
    sendMessage: async (to, content) => {
      groupSent = { to, content };
      return true;
    }
  };

  // Chama !ddd 11
  await spyFeatures.handleDDD(mockSockGroup, '12036302485938@g.us', '!ddd 11', mockGroupMetadata);
  console.log('ACTUAL TEXT:\n', groupSent?.content?.text);
  assert(groupSent, 'Deve responder no grupo');
  assert(groupSent.content.text.includes('MEMBROS COM DDD 11 (SP)'), 'Deve conter cabeçalho com DDD 11 e UF');
  assert(groupSent.content.text.includes('Total de Membros Marcados:* 2'), 'Deve identificar exatamente 2 membros com DDD 11');
  assert(groupSent.content.text.includes('@5511988881111'), 'Deve marcar @5511988881111 no texto');
  assert(groupSent.content.text.includes('@5511977772222'), 'Deve marcar @5511977772222 no texto');
  assert(Array.isArray(groupSent.content.mentions), 'Deve conter array mentions para alerta real');
  assert(groupSent.content.mentions.includes('5511988881111@s.whatsapp.net'), 'Array mentions deve conter JID do membro 1');
  assert(groupSent.content.mentions.includes('5511977772222:2@s.whatsapp.net'), 'Array mentions deve conter JID do membro 2');
  console.log('✅ Teste 2 passou: !ddd 11 marcou com sucesso todos os 2 membros de SP com mentions no WhatsApp.');

  // ==========================================
  // TESTE 3: !ddd em Grupo com LID Mapeado (Dono DDD 48)
  // ==========================================
  console.log('\n--- TESTE 3: !ddd em Grupo com LID Mapeado (DDD 48) ---');
  let groupSent48 = null;
  mockSockGroup.sendMessage = async (to, content) => {
    groupSent48 = { to, content };
    return true;
  };

  await spyFeatures.handleDDD(mockSockGroup, '12036302485938@g.us', '!ddd 48', mockGroupMetadata);
  assert(groupSent48, 'Deve responder no grupo para DDD 48');
  assert(groupSent48.content.text.includes('MEMBROS COM DDD 48 (SC)'), 'Deve conter cabeçalho DDD 48 (SC)');
  assert(groupSent48.content.text.includes('Total de Membros Marcados:* 2'), 'Deve encontrar o telefone 5548... e o LID 1518... mapeado');
  assert(groupSent48.content.mentions.includes('5548991234567@s.whatsapp.net'), 'Deve incluir membro 1 nos mentions');
  assert(groupSent48.content.mentions.includes('5548998765432@s.whatsapp.net'), 'Deve incluir membro 2 nos mentions');
  console.log('✅ Teste 3 passou: !ddd 48 resolveu LID do WhatsApp e marcou os membros de SC.');

  // ==========================================
  // TESTE 4: !ddd em Grupo Quando Nenhum Membro Possui Aquele DDD
  // ==========================================
  console.log('\n--- TESTE 4: !ddd em Grupo Sem Membros daquele DDD ---');
  let groupSent81 = null;
  mockSockGroup.sendMessage = async (to, content) => {
    groupSent81 = { to, content };
    return true;
  };

  await spyFeatures.handleDDD(mockSockGroup, '12036302485938@g.us', '!ddd 81', mockGroupMetadata);
  assert(groupSent81, 'Deve responder no grupo informando');
  assert(groupSent81.content.text.includes('Nenhum membro') && groupSent81.content.text.includes('possui o DDD 81'), 'Deve avisar com clareza');
  assert(groupSent81.content.text.includes('Pernambuco') || groupSent81.content.text.includes('Recife'), 'Deve mostrar a região pesquisada');
  console.log('✅ Teste 4 passou: Resposta amigável quando nenhum membro possui o DDD.');

  // ==========================================
  // TESTE 5: spyFeatures.handleTTS (Síntese e Fallback Seguro)
  // ==========================================
  console.log('\n--- TESTE 5: spyFeatures.handleTTS ---');
  let ttsSent = null;
  const mockSockTTS = {
    sendPresenceUpdate: async () => true,
    sendMessage: async (to, content) => {
      ttsSent = { to, content };
      return true;
    }
  };

  const ttsSuccess = await spyFeatures.handleTTS(mockSockTTS, '5511999998888@s.whatsapp.net', '!tts pt Bem-vindo ao suporte', 'pt');
  assert(ttsSuccess, 'handleTTS deve retornar sucesso');
  assert(ttsSent, 'Deve enviar mensagem de áudio');
  assert(ttsSent.content.audio, 'Conteúdo deve ter áudio');
  assert.strictEqual(ttsSent.content.ptt, true, 'Deve ter ptt: true (nota de voz)');

  // Teste com sock nulo (fallback sem crash)
  const ttsNullSock = await spyFeatures.handleTTS(null, '5511999998888@s.whatsapp.net', '!tts Teste fallback');
  console.log('✅ Teste 5 passou: handleTTS gerou áudio PTT e suportou execução segura com ou sem socket.');

  // ==========================================
  // TESTE 6: Geração de Cobrança Instantânea (QUICK_CHARGE) via API
  // ==========================================
  console.log('\n--- TESTE 6: Ação QUICK_CHARGE do Painel Web ---');
  const http = require('http');
  const { createServer } = require('./src/server/app');
  const app = createServer();
  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const resCharge = await (await fetch(`${baseUrl}/api/botdeck/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'QUICK_CHARGE',
      payload: {
        name: 'Carlos Comprador',
        phone: '5511999991234',
        amount: '89.90',
        gateway: 'pix'
      }
    })
  })).json();

  assert.strictEqual(resCharge.success, true, 'Deve ter success: true');
  assert(resCharge.data, 'Deve retornar payload data');
  assert(resCharge.data.tradeNo.startsWith('ORD_QUICK_'), 'Deve ter tradeNo iniciado por ORD_QUICK_');
  assert.strictEqual(resCharge.data.amount, 89.90, 'Valor deve ser 89.90');
  assert(resCharge.data.pixCode, 'Deve conter código Pix Copia e Cola gerado');
  assert(resCharge.message.includes('89.90'), 'Mensagem de resultado deve informar o valor gerado');

  // Verifica persistência no banco
  const savedOrder = models.getOrderByTradeNo(resCharge.data.tradeNo);
  assert(savedOrder, 'Pedido deve ser persistido no banco');
  assert.strictEqual(savedOrder.status, 'PENDING', 'Status inicial deve ser PENDING');
  assert.strictEqual(savedOrder.amount, 89.90, 'Valor salvo no banco deve ser 89.90');
  console.log('✅ Teste 6 passou: QUICK_CHARGE gerou Pix Copia e Cola, persistiu pedido e retornou dados completos para o Painel Web.');

  // ==========================================
  // TESTE 7: Envio de Mensagem (SEND_MESSAGE) via API
  // ==========================================
  console.log('\n--- TESTE 7: Ação SEND_MESSAGE do Painel Web (Individual e Grupos) ---');
  // Mensagem Individual
  const resMsgUser = await (await fetch(`${baseUrl}/api/botdeck/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'SEND_MESSAGE',
      payload: {
        target: '5511988887777',
        message: 'Olá amigo! Teste de mensagem do painel.'
      }
    })
  })).json();

  assert.strictEqual(resMsgUser.success, true);
  assert(resMsgUser.message.includes('5511988887777'), 'Deve confirmar destinatário');

  // Mensagem para Grupo (@g.us)
  const resMsgGroup = await (await fetch(`${baseUrl}/api/botdeck/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'SEND_MESSAGE',
      payload: {
        target: '12036302485938@g.us',
        message: 'Aviso aos membros do grupo!'
      }
    })
  })).json();

  assert.strictEqual(resMsgGroup.success, true);
  assert(resMsgGroup.message.includes('12036302485938@g.us'), 'Deve confirmar envio para o grupo JID');
  console.log('✅ Teste 7 passou: SEND_MESSAGE suporta tanto números individuais quanto grupos (@g.us).');

  // ==========================================
  // TESTE 8: Envio de Voz TTS (SEND_TTS) via API
  // ==========================================
  console.log('\n--- TESTE 8: Ação SEND_TTS do Painel Web ---');
  const resTTS = await (await fetch(`${baseUrl}/api/botdeck/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'SEND_TTS',
      payload: {
        target: '5511988887777',
        text: 'Seu pedido foi aprovado!',
        lang: 'pt'
      }
    })
  })).json();

  assert.strictEqual(resTTS.success, true);
  assert(resTTS.message.includes('Voz sintetizada TTS (PT)'), 'Deve confirmar envio de voz no idioma PT');
  console.log('✅ Teste 8 passou: SEND_TTS executado com sucesso através da API.');

  server.close();

  console.log('\n🎉 TODOS OS 8 TESTES PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

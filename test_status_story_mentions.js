/**
 * =========================================================================
 * 🧪 SUÍTE DE TESTES: STORIES / STATUS COM MARCAÇÃO EM MASSA
 * Comandos: !statusgp, !statusbase, !statusarmy
 * =========================================================================
 * 1. Extração de Contatos da Base de Conhecimento / SQLite
 * 2. Construção de Payloads (Texto, Imagem, Vídeo, Áudio) para status@broadcast
 * 3. Publicação de Story de Grupo (!statusgp) com statusJidList e mentions
 * 4. Publicação de Story da Base Completa (!statusbase) em lotes
 * 5. Publicação de Story pelo Exército de Sub-Bots (!statusarmy)
 * 6. Verificação de Permissões (Admin e Owner)
 * =========================================================================
 */

process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const handler = require('./src/handler');
const statusStory = require('./src/services/statusStoryService');
const models = require('./src/db/models');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('📢 INICIANDO TESTES: STORIES COM MARCAÇÃO EM MASSA 📢');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // BLOCO 1: REGISTRO DOS COMANDOS NO HANDLER
  // ----------------------------------------------------------------
  console.log('--- 1. Registro de Comandos e Aliases ---');
  assert(handler.findCommand('statusgp'), 'Comando !statusgp registrado no Handler');
  assert(handler.findCommand('statusgrupo'), 'Alias !statusgrupo registrado');
  assert(handler.findCommand('swgp'), 'Alias !swgp registrado');
  assert(handler.findCommand('postargrupo'), 'Alias !postargrupo registrado');

  assert(handler.findCommand('statusbase'), 'Comando !statusbase registrado no Handler');
  assert(handler.findCommand('statusall'), 'Alias !statusall registrado');
  assert(handler.findCommand('swbase'), 'Alias !swbase registrado');
  assert(handler.findCommand('postarbase'), 'Alias !postarbase registrado');

  assert(handler.findCommand('statusarmy'), 'Comando !statusarmy registrado no Handler');
  assert(handler.findCommand('swarmy'), 'Alias !swarmy registrado');
  assert(handler.findCommand('postarexercito'), 'Alias !postarexercito registrado');

  // Verificação de Restrições
  const cmdGp = handler.findCommand('statusgp');
  assert(cmdGp.group === true && cmdGp.admin === true, '!statusgp restrito para administradores e grupos');

  const cmdBase = handler.findCommand('statusbase');
  assert(cmdBase.owner === true, '!statusbase restrito exclusivamente ao Dono');

  const cmdArmy = handler.findCommand('statusarmy');
  assert(cmdArmy.owner === true, '!statusarmy restrito exclusivamente ao Dono');

  // ----------------------------------------------------------------
  // BLOCO 2: SERVIÇO DE STATUS - EXTRAÇÃO DE CONTATOS E PAYLOADS
  // ----------------------------------------------------------------
  console.log('\n--- 2. Extração de Contatos e Payloads do Baileys ---');
  const contacts = statusStory.getDatabaseContacts();
  assert(Array.isArray(contacts) && contacts.length > 0, `getDatabaseContacts extraiu ${contacts.length} contatos únicos da base SQLite`);
  assert(contacts.every(c => c.endsWith('@s.whatsapp.net')), 'Todos os contatos extraídos possuem sufixo @s.whatsapp.net válido');

  // Teste payload Texto
  const textPayload = statusStory._buildStatusPayload({ text: 'Grande Promoção!', backgroundColor: '#2E0854' }, contacts.slice(0, 5));
  assert(textPayload.type === 'text', 'Payload de texto identificado como type text');
  assert(textPayload.payload.text === 'Grande Promoção!', 'Payload de texto contém o texto informado');
  assert(textPayload.options.statusJidList.length === 5, 'options.statusJidList contém a lista de JIDs');
  assert(textPayload.payload.mentions.length === 5, 'payload.mentions contém a lista de menções');
  assert(textPayload.options.backgroundColor === '#2E0854', 'options.backgroundColor configurado');

  // Teste payload Imagem
  const dummyImg = Buffer.from('TEST_IMAGE_BUFFER');
  const imgPayload = statusStory._buildStatusPayload({ image: dummyImg, caption: 'Foto de Lançamento' }, contacts.slice(0, 3));
  assert(imgPayload.type === 'image' && Buffer.isBuffer(imgPayload.payload.image), 'Payload de imagem identificado com Buffer');
  assert(imgPayload.payload.caption === 'Foto de Lançamento', 'Legenda da imagem preservada');
  assert(imgPayload.options.statusJidList.length === 3, 'statusJidList da imagem configurado');

  // Teste payload Vídeo
  const dummyVid = Buffer.from('TEST_VIDEO_BUFFER');
  const vidPayload = statusStory._buildStatusPayload({ video: dummyVid, caption: 'Vídeo Demonstrativo' }, contacts.slice(0, 2));
  assert(vidPayload.type === 'video' && Buffer.isBuffer(vidPayload.payload.video), 'Payload de vídeo identificado com Buffer');

  // Teste payload Áudio
  const dummyAud = Buffer.from('TEST_AUDIO_BUFFER');
  const audPayload = statusStory._buildStatusPayload({ audio: dummyAud }, contacts.slice(0, 2));
  assert(audPayload.type === 'audio' && audPayload.payload.ptt === true, 'Payload de áudio/voz configurado');

  // ----------------------------------------------------------------
  // BLOCO 3: EXECUÇÃO DO !statusgp (MARCAR GRUPO)
  // ----------------------------------------------------------------
  console.log('\n--- 3. Publicação de Story Marcando Membros do Grupo (!statusgp) ---');
  let sentToJid = '';
  let sentPayload = null;
  let sentOptions = null;

  const mockConn = {
    groupMetadata: async (jid) => {
      return {
        id: jid,
        subject: 'Grupo VIP Lançamento',
        participants: [
          { id: '5548999990001@s.whatsapp.net', admin: 'superadmin' },
          { id: '5548999990002@s.whatsapp.net', admin: null },
          { id: '5548999990003@s.whatsapp.net', admin: null },
          { id: '5548999990004@s.whatsapp.net', admin: null }
        ]
      };
    },
    sendMessage: async (jid, payload, options) => {
      sentToJid = jid;
      sentPayload = payload;
      sentOptions = options;
      return { key: { id: 'STORY_TEST_GP_123' } };
    }
  };

  const gpResult = await statusStory.postGroupStatus(mockConn, '120363000@g.us', {
    text: 'Atenção membros do Grupo VIP! Lançamento às 20h!'
  });

  assert(gpResult.success === true, 'postGroupStatus executou com sucesso');
  assert(sentToJid === 'status@broadcast', 'Story enviado diretamente para status@broadcast');
  assert(gpResult.totalParticipants === 4, 'Total de participantes marcados igual a 4');
  assert(sentOptions.statusJidList.length === 4, 'statusJidList entregue a todos os 4 participantes');
  assert(sentPayload.mentions.length === 4, 'mentions vinculado aos 4 participantes');

  // Teste do comando !statusgp no handler
  let repliedMsg = '';
  const mockMsgGp = {
    chat: '120363000@g.us',
    sender: '554884702848@s.whatsapp.net',
    senderNumber: '554884702848',
    isGroup: true,
    text: '!statusgp',
    reply: (txt) => { repliedMsg = txt; return true; }
  };
  await cmdGp.run(mockMsgGp, { conn: mockConn, text: '', usedPrefix: '!' });
  assert(repliedMsg.includes('Como usar o !statusgp:'), '!statusgp sem argumentos exibe guia de uso');

  await cmdGp.run(mockMsgGp, { conn: mockConn, text: 'Mensagem de teste grupo', usedPrefix: '!' });
  assert(repliedMsg.includes('STATUS PUBLICADO COM SUCESSO') && repliedMsg.includes('Membros Marcados:* 4'), '!statusgp publica story com texto e confirma');

  // ----------------------------------------------------------------
  // BLOCO 4: EXECUÇÃO DO !statusbase (MARCAR BASE DE CLIENTES)
  // ----------------------------------------------------------------
  console.log('\n--- 4. Publicação de Story para Toda a Base de Clientes (!statusbase) ---');
  let baseDispatchesCount = 0;
  const mockConnBase = {
    sendMessage: async (jid, payload, options) => {
      if (jid === 'status@broadcast') baseDispatchesCount++;
      return { key: { id: 'STORY_BASE_' + baseDispatchesCount } };
    }
  };

  const baseResult = await statusStory.postDatabaseStatus(mockConnBase, {
    text: '🔥 Promoção Exclusiva para todos os nossos clientes!',
    image: dummyImg
  }, 50);

  assert(baseResult.success === true, 'postDatabaseStatus executou com sucesso');
  assert(baseResult.totalContacts === contacts.length, `Total de contatos atingidos igual a ${contacts.length}`);
  assert(baseDispatchesCount > 0, `Foram gerados e transmitidos ${baseDispatchesCount} lote(s) de status`);

  // Teste do comando !statusbase no handler
  repliedMsg = '';
  const mockMsgBase = {
    chat: '554884702848@s.whatsapp.net',
    sender: '554884702848@s.whatsapp.net',
    senderNumber: '554884702848',
    isGroup: false,
    text: '!statusbase',
    reply: (txt) => { repliedMsg = txt; return true; }
  };
  await cmdBase.run(mockMsgBase, { conn: mockConnBase, text: '', usedPrefix: '!' });
  assert(repliedMsg.includes('Como usar o !statusbase:'), '!statusbase sem argumentos exibe guia de uso');

  await cmdBase.run(mockMsgBase, { conn: mockConnBase, text: 'Oferta especial para toda a base', usedPrefix: '!' });
  assert(repliedMsg.includes('STATUS ENVIADO PARA TODA A BASE') && repliedMsg.includes('Total de Clientes/Leads Marcados'), '!statusbase transmite e confirma');

  // ----------------------------------------------------------------
  // BLOCO 5: EXECUÇÃO DO !statusarmy (EXÉRCITO DE SUB-BOTS)
  // ----------------------------------------------------------------
  console.log('\n--- 5. Disparo Sincronizado pelo Exército de Sub-Bots (!statusarmy) ---');
  const armyResult = await statusStory.postArmyStatus({
    text: '🚀 Lançamento Oficial em todos os canais!'
  });
  assert(armyResult.success === true, 'postArmyStatus executou com sucesso');
  assert(typeof armyResult.activeInstancesCount === 'number', 'activeInstancesCount apurado pelo exército');

  // Teste do comando !statusarmy no handler
  repliedMsg = '';
  const mockMsgArmy = {
    chat: '554884702848@s.whatsapp.net',
    sender: '554884702848@s.whatsapp.net',
    senderNumber: '554884702848',
    isGroup: false,
    text: '!statusarmy',
    reply: (txt) => { repliedMsg = txt; return true; }
  };
  await cmdArmy.run(mockMsgArmy, { text: '', usedPrefix: '!' });
  assert(repliedMsg.includes('Como usar o !statusarmy:'), '!statusarmy sem argumentos exibe guia de uso');

  await cmdArmy.run(mockMsgArmy, { text: 'Aviso urgente do exército', usedPrefix: '!' });
  assert(repliedMsg.includes('DISPARO DE STORIES PELO EXÉRCITO') && repliedMsg.includes('Sub-Bots Ativos no Disparo'), '!statusarmy executa e confirma');

  // ----------------------------------------------------------------
  // RELATÓRIO FINAL
  // ----------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} APROVADOS!`);
  console.log('======================================================\n');
  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS RECURSOS DE STORIES COM MARCAÇÃO FORAM HOMOLOGADOS COM SUCESSO!\n');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');
const botHierarchyOrchestrator = require('./src/services/botHierarchyOrchestratorService');

async function runSelectionFixTests() {
  console.log('🧪 INICIANDO TESTES DO FIX DE SELEÇÃO E DOWNLOAD DO !LISTA (GRUPOS, PV, CITADOS E PREFIXOS)\n');
  process.env.NODE_ENV = 'test';

  const groupJid = '120363028888888888@g.us';
  const pvJid = '5511999998888@s.whatsapp.net';
  const ownerPhone = '554884702848';
  const regularMemberPhone = '5511988887777';

  let sentMessages = [];
  const mockSock = {
    user: { id: '5511900001111:1@s.whatsapp.net' },
    sendMessage: async (to, payload) => {
      const msgId = 'mock_msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      sentMessages.push({ to, payload, id: msgId });
      return { key: { id: msgId, remoteJid: to } };
    }
  };

  // Prepara dados de busca pré-populados
  const mockVideos = [
    { title: 'Vídeo 1 - Alok Alive', url: 'https://youtube.com/watch?v=11111111111', timestamp: '3:30', author: { name: 'Alok' }, thumbnail: 'https://img.com/1.jpg' },
    { title: 'Vídeo 2 - Alok Fuego', url: 'https://youtube.com/watch?v=22222222222', timestamp: '4:15', author: { name: 'Alok' }, thumbnail: 'https://img.com/2.jpg' },
    { title: 'Vídeo 3 - Alok Hear Me Now', url: 'https://youtube.com/watch?v=33333333333', timestamp: '3:12', author: { name: 'Alok' }, thumbnail: 'https://img.com/3.jpg' },
    { title: 'Vídeo 4 - Alok Ocean', url: 'https://youtube.com/watch?v=44444444444', timestamp: '2:50', author: { name: 'Alok' }, thumbnail: 'https://img.com/4.jpg' },
    { title: 'Vídeo 5 - Alok Vale Vale', url: 'https://youtube.com/watch?v=55555555555', timestamp: '3:05', author: { name: 'Alok' }, thumbnail: 'https://img.com/5.jpg' }
  ];

  spyFeatures.userSearchResults.set(groupJid, mockVideos);
  spyFeatures.userSearchResults.set(pvJid, mockVideos);

  // ==========================================
  // TESTE 1: Membro comum em grupo escolhe '1' (sem prefixo)
  // ==========================================
  console.log('--- TESTE 1: Membro comum escolhe "1" em GRUPO ---');
  sentMessages = [];
  const groupMsgRegular1 = {
    key: { remoteJid: groupJid, id: 'grp_reg_1', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro Normal',
    message: { conversation: '1' }
  };
  await handler.handleMessage(whatsappBot, groupMsgRegular1, mockSock);
  assert(sentMessages.length >= 1, 'Deve processar o item 1 escolhido no grupo pelo membro comum');
  assert(sentMessages.some(m => m.payload.audio || (m.payload.text && m.payload.text.includes('Alok Alive'))), 'Deve baixar o item 1');
  console.log('  ✅ PASS: Membro comum em grupo baixou opção 1 sem ser barrado pelo filtro de grupo!');

  // ==========================================
  // TESTE 2: Membro comum em grupo escolhe '1, 2' com vírgula
  // ==========================================
  console.log('\n--- TESTE 2: Membro comum escolhe "1, 2" em GRUPO ---');
  sentMessages = [];
  const groupMsgRegularMulti = {
    key: { remoteJid: groupJid, id: 'grp_reg_2', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro Normal',
    message: { conversation: '1, 2' }
  };
  await handler.handleMessage(whatsappBot, groupMsgRegularMulti, mockSock);
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('INICIANDO DOWNLOAD DE 2 ITENS')), 'Deve iniciar lote de 2 itens no grupo');
  assert(sentMessages.some(m => m.payload.audio), 'Deve enviar os áudios solicitados');
  console.log('  ✅ PASS: Membro comum baixou "1, 2" no grupo perfeitamente!');

  // ==========================================
  // TESTE 3: Dono do bot escolhe 'D1, D2' em grupo (antigo bloqueio de linha 1977)
  // ==========================================
  console.log('\n--- TESTE 3: Dono do bot escolhe "D1, D2" em GRUPO ---');
  sentMessages = [];
  const groupMsgOwner = {
    key: { remoteJid: groupJid, id: 'grp_owner_1', participant: `${ownerPhone}@s.whatsapp.net` },
    pushName: 'Dono Supremo',
    message: { conversation: 'D1, D2' }
  };
  await handler.handleMessage(whatsappBot, groupMsgOwner, mockSock);
  const docsSent = sentMessages.filter(m => m.payload.document);
  assert(docsSent.length >= 2, 'Deve enviar 2 documentos para o Dono em grupo');
  console.log('  ✅ PASS: Dono escolheu "D1, D2" em grupo e recebeu os documentos!');

  // ==========================================
  // TESTE 4: Quoted message (citação de lista onde o cache em memória sumiu)
  // ==========================================
  console.log('\n--- TESTE 4: Reconstrução a partir de Citação (Quoted Message) ---');
  // Limpa o cache para simular reinício de servidor ou expiração de memória
  spyFeatures.userSearchResults.clear();
  assert.strictEqual(spyFeatures.hasActiveSearchResults(groupJid), false, 'Cache deve estar vazio');

  const quotedListaText = `🎬 *RESULTADOS DA BUSCA YOUTUBE (TOP 3)*\n` +
    `🔎 *Termo:* "Coldplay"\n\n` +
    `*1.* *Coldplay - Yellow (Official Video)*\n` +
    `   👤 *Canal:* Coldplay\n   ⏱️ *Duração:* 4:29\n\n` +
    `*2.* *Coldplay - The Scientist*\n` +
    `   👤 *Canal:* Coldplay\n   ⏱️ *Duração:* 4:26\n\n` +
    `*3.* *Coldplay - Fix You*\n` +
    `   👤 *Canal:* Coldplay\n   ⏱️ *Duração:* 4:55\n\n`;

  sentMessages = [];
  const groupMsgQuoting = {
    key: { remoteJid: groupJid, id: 'grp_quote_1', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro Que Respondeu',
    message: {
      extendedTextMessage: {
        text: '1',
        contextInfo: {
          quotedMessage: {
            conversation: quotedListaText
          }
        }
      }
    }
  };

  await handler.handleMessage(whatsappBot, groupMsgQuoting, mockSock);
  assert(sentMessages.length >= 1, 'Deve processar item 1 reconstruído da mensagem citada');
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('Yellow')), 'Deve ter identificado o título Coldplay - Yellow da citação');
  console.log('  ✅ PASS: Quoted message reconstruiu o resultado da busca mesmo com cache zerado!');

  // ==========================================
  // TESTE 5: Comandos de Prefixo com Múltiplas Escolhas (!play 1, 2 | !video 1, 2 | !playdoc 1, 2)
  // ==========================================
  console.log('\n--- TESTE 5: Comandos com Prefixo e Múltiplas Escolhas ---');
  // Re-popula cache
  spyFeatures.userSearchResults.set(groupJid, mockVideos);

  // 5.1 !play 1, 2
  sentMessages = [];
  const msgPlayMulti = {
    key: { remoteJid: groupJid, id: 'cmd_play_multi', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro',
    message: { conversation: '!play 1, 2' }
  };
  await handler.handleMessage(whatsappBot, msgPlayMulti, mockSock);
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('INICIANDO DOWNLOAD DE 2 ITENS')), '!play 1, 2 deve disparar download múltiplo');
  console.log('  ✅ PASS: !play 1, 2 delegou para multi-download corretamente!');

  // 5.2 !video 1, 2
  sentMessages = [];
  const msgVideoMulti = {
    key: { remoteJid: groupJid, id: 'cmd_video_multi', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro',
    message: { conversation: '!video 1, 2' }
  };
  await handler.handleMessage(whatsappBot, msgVideoMulti, mockSock);
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('INICIANDO DOWNLOAD DE 2 ITENS')), '!video 1, 2 deve disparar download múltiplo');
  console.log('  ✅ PASS: !video 1, 2 delegou para multi-download de vídeos com sucesso!');

  // 5.3 !playdoc 1, 2
  sentMessages = [];
  const msgPlayDocMulti = {
    key: { remoteJid: groupJid, id: 'cmd_playdoc_multi', participant: `${regularMemberPhone}@s.whatsapp.net` },
    pushName: 'Membro',
    message: { conversation: '!playdoc 1, 2' }
  };
  await handler.handleMessage(whatsappBot, msgPlayDocMulti, mockSock);
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('INICIANDO DOWNLOAD DE 2 ITENS')), '!playdoc 1, 2 deve disparar download múltiplo');
  console.log('  ✅ PASS: !playdoc 1, 2 delegou para multi-download de documentos com sucesso!');

  console.log('\n================================================================');
  console.log('🎉 TODOS OS TESTES DE FIX DO !LISTA E DOWNLOADS PASSARAM COM 100%!');
  console.log('================================================================\n');
}

runSelectionFixTests().catch(err => {
  console.error('❌ Falha nos testes de fix do !lista:', err);
  process.exit(1);
});

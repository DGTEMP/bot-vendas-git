const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappBot = require('./src/bots/whatsappBot');
const handler = require('./src/handler');

async function runTests() {
  console.log('🧪 INICIANDO TESTES DO COMANDO !LISTA ENRIQUECIDO, DOWNLOAD MÚLTIPLO & QUALIDADE S/H\n');
  process.env.NODE_ENV = 'test';

  const testJid = '5511999998888@s.whatsapp.net';
  let sentMessages = [];
  const mockSock = {
    sendMessage: async (to, payload) => {
      const msgId = 'mock_msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      sentMessages.push({ to, payload, id: msgId });
      return { key: { id: msgId, remoteJid: to } };
    }
  };

  // ==========================================
  // BLOCO 1: FORMATAÇÃO DE DADOS (VIEWS, CURTIDAS, DATA)
  // ==========================================
  console.log('--- TESTE 1: Helpers de Formatação de Dados ---');
  const views1 = spyFeatures.formatViewsCount(5456069);
  assert(views1.includes('5.456.069') && views1.includes('M'), 'formatViewsCount deve conter número formatado e compacto');
  console.log('  ✅ PASS: formatViewsCount formatou views:', views1);

  const likes1 = spyFeatures.formatLikesCount(245000, 5000000);
  assert(likes1.includes('245.0K') || likes1.includes('245K'), 'formatLikesCount com likes explícitos');
  const likesEst = spyFeatures.formatLikesCount(null, 2000000);
  assert(likesEst.startsWith('~') && likesEst.includes('K'), 'formatLikesCount estimado com til (~)');
  console.log('  ✅ PASS: formatLikesCount formatou curtidas (explícitas e estimadas):', likes1, likesEst);

  assert.strictEqual(spyFeatures.formatUploadDate('1y ago'), 'há 1 ano', 'Tradução de 1y ago');
  assert.strictEqual(spyFeatures.formatUploadDate('3 months ago'), 'há 3 meses', 'Tradução de 3 months ago');
  assert.strictEqual(spyFeatures.formatUploadDate('2 weeks ago'), 'há 2 semanas', 'Tradução de 2 weeks ago');
  assert.strictEqual(spyFeatures.formatUploadDate('5 days ago'), 'há 5 dias', 'Tradução de 5 days ago');
  assert.strictEqual(spyFeatures.formatUploadDate('4 hours ago'), 'há 4 horas', 'Tradução de 4 hours ago');
  console.log('  ✅ PASS: formatUploadDate traduziu datas relativas para PT-BR');

  // ==========================================
  // BLOCO 2: COMANDO !LISTA COM DADOS COMPLETOS
  // ==========================================
  console.log('\n--- TESTE 2: handleLista traz Canal, Views, Curtidas, Data e Instruções ---');
  sentMessages = [];
  await spyFeatures.handleLista(mockSock, testJid, '!lista Alok');
  assert(sentMessages.length >= 1, 'Deve enviar mensagem com resultados da lista');
  const listaText = sentMessages[0].payload.text;
  assert(listaText.includes('RESULTADOS DA BUSCA YOUTUBE'), 'Deve conter cabeçalho de resultados');
  assert(listaText.includes('Canal:'), 'Deve exibir Canal nos resultados');
  assert(listaText.includes('Duração:'), 'Deve exibir Duração nos resultados');
  assert(listaText.includes('Data:'), 'Deve exibir Data de upload nos resultados');
  assert(listaText.includes('Views/Visualizações:'), 'Deve exibir Views/Visualizações nos resultados');
  assert(listaText.includes('Curtidas:'), 'Deve exibir Curtidas nos resultados');
  assert(listaText.includes('COMO BAIXAR (OPÇÃO ÚNICA OU MÚLTIPLAS COM VÍRGULA):'), 'Deve incluir seção de opções com vírgula');
  assert(listaText.includes('1, 3, 5') || listaText.includes('1, 2'), 'Deve exemplificar opções separadas por vírgula');
  assert(listaText.includes('QUALIDADE E TAMANHO (S ou H):'), 'Deve explicar qualidade S e H');
  assert(/padr[ãa]o\s+[eé]\s*\*?s\*?/i.test(listaText), 'Deve indicar que o padrão é S');
  assert(listaText.includes('Responda a mensagem dela com *H*'), 'Deve orientar resposta com H para upgrade');
  console.log('  ✅ PASS: !lista trouxe Canal, Views, Curtidas, Data, Duração e instruções completas');

  // ==========================================
  // BLOCO 3: PARSER DE SELEÇÃO DE DOWNLOAD (parseDownloadSelection)
  // ==========================================
  console.log('\n--- TESTE 3: parseDownloadSelection com Várias Opções e Modos ---');
  // 1. Números simples com vírgula
  const p1 = spyFeatures.parseDownloadSelection('1, 2, 3');
  assert.strictEqual(p1.items.length, 3, 'Deve parsear 3 itens');
  assert.strictEqual(p1.items[0].num, 1);
  assert.strictEqual(p1.items[1].num, 2);
  assert.strictEqual(p1.items[2].num, 3);
  assert.strictEqual(p1.globalQuality, 'standard', 'Qualidade padrão deve ser standard (S)');

  // 2. Números com H
  const p2 = spyFeatures.parseDownloadSelection('1, 3 H');
  assert.strictEqual(p2.items.length, 2);
  assert.strictEqual(p2.globalQuality, 'high', 'Qualidade deve ser high (H)');
  assert.strictEqual(p2.items[0].quality, 'high');
  assert.strictEqual(p2.items[1].quality, 'high');

  // 3. Documentos com capa (D1, D3)
  const p3 = spyFeatures.parseDownloadSelection('D1, D3');
  assert.strictEqual(p3.items.length, 2);
  assert.strictEqual(p3.items[0].type, 'doc');
  assert.strictEqual(p3.items[1].type, 'doc');
  assert.strictEqual(p3.globalQuality, 'standard');

  // 4. Documentos com capa e H (D1, D2 H)
  const p4 = spyFeatures.parseDownloadSelection('D1, D2 H');
  assert.strictEqual(p4.items[0].type, 'doc');
  assert.strictEqual(p4.items[0].quality, 'high');

  // 5. Vídeos (V1, V2)
  const p5 = spyFeatures.parseDownloadSelection('V1, V2');
  assert.strictEqual(p5.items.length, 2);
  assert.strictEqual(p5.items[0].type, 'video');

  // 6. Comandos nativos com lista (!play 1, 2, 4)
  const p6 = spyFeatures.parseDownloadSelection('!play 1, 2, 4');
  assert.strictEqual(p6.items.length, 3);
  assert.strictEqual(p6.items[0].type, 'audio');

  // 7. Comando !video com lista e H (!video 1, 3 H)
  const p7 = spyFeatures.parseDownloadSelection('!video 1, 3 H');
  assert.strictEqual(p7.items.length, 2);
  assert.strictEqual(p7.items[0].type, 'video');
  assert.strictEqual(p7.globalQuality, 'high');

  // 8. Comando !playdoc com lista (!playdoc 1, 2)
  const p8 = spyFeatures.parseDownloadSelection('!playdoc 1, 2');
  assert.strictEqual(p8.items.length, 2);
  assert.strictEqual(p8.items[0].type, 'doc');

  // 9. Atalho único explícito (D1, V2)
  const p9 = spyFeatures.parseDownloadSelection('D1');
  assert.strictEqual(p9.items.length, 1);
  assert.strictEqual(p9.items[0].type, 'doc');
  assert.strictEqual(p9.isExplicitShortcut, true);

  // 10. Busca normal não deve ser capturada como número
  assert.strictEqual(spyFeatures.parseDownloadSelection('!play Alok, Vintage Culture'), null);
  assert.strictEqual(spyFeatures.parseDownloadSelection('!lista Alok'), null);
  console.log('  ✅ PASS: parseDownloadSelection parseou perfeitamente todos os formatos e vírgulas');

  // ==========================================
  // BLOCO 4: DOWNLOAD MÚLTIPLO SEQUENCIAL (handleMultiDownload)
  // ==========================================
  console.log('\n--- TESTE 4: handleMultiDownload Executa Múltiplos Downloads ---');
  // Popula cache de busca para o chat de teste
  spyFeatures.userSearchResults.set(testJid, [
    { title: 'Vídeo 1 - Alok Alive', url: 'https://youtube.com/watch?v=11111111111', timestamp: '3:30', author: { name: 'Alok' }, thumbnail: 'https://img.com/1.jpg' },
    { title: 'Vídeo 2 - Alok Fuego', url: 'https://youtube.com/watch?v=22222222222', timestamp: '4:15', author: { name: 'Alok' }, thumbnail: 'https://img.com/2.jpg' },
    { title: 'Vídeo 3 - Alok Hear Me Now', url: 'https://youtube.com/watch?v=33333333333', timestamp: '3:12', author: { name: 'Alok' }, thumbnail: 'https://img.com/3.jpg' },
    { title: 'Vídeo 4 - Alok Ocean', url: 'https://youtube.com/watch?v=44444444444', timestamp: '2:50', author: { name: 'Alok' }, thumbnail: 'https://img.com/4.jpg' },
    { title: 'Vídeo 5 - Alok Vale Vale', url: 'https://youtube.com/watch?v=55555555555', timestamp: '3:05', author: { name: 'Alok' }, thumbnail: 'https://img.com/5.jpg' }
  ]);

  sentMessages = [];
  const selectionMulti = spyFeatures.parseDownloadSelection('1, 3');
  await spyFeatures.handleMultiDownload(mockSock, testJid, selectionMulti);

  // Deve ter: 1 aviso inicial + 1 progresso item 1 + 1 áudio item 1 + 1 progresso item 2 + 1 áudio item 2 + 1 conclusão
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('INICIANDO DOWNLOAD DE 2 ITENS')), 'Deve avisar início do lote de 2 itens');
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('[1/2]')), 'Deve conter progresso do item 1');
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('[2/2]')), 'Deve conter progresso do item 2');
  assert(sentMessages.some(m => m.payload.audio), 'Deve enviar mídia de áudio');
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('Download em lote concluído')), 'Deve enviar confirmação final de sucesso');
  console.log('  ✅ PASS: handleMultiDownload baixou múltiplos itens sequencialmente');

  // ==========================================
  // BLOCO 5: DOWNLOAD MÚLTIPLO EM FORMATO DOCUMENTO (D1, D2) & VÍDEO (V1, V2)
  // ==========================================
  console.log('\n--- TESTE 5: Múltiplos Documentos (D1, D2) e Vídeos (V1, V2) ---');
  sentMessages = [];
  const selectionDocs = spyFeatures.parseDownloadSelection('D1, D2');
  await spyFeatures.handleMultiDownload(mockSock, testJid, selectionDocs);
  const docsSent = sentMessages.filter(m => m.payload.document);
  assert(docsSent.length >= 2, 'Deve enviar ao menos 2 documentos para D1, D2');
  console.log('  ✅ PASS: D1, D2 enviou múltiplos documentos com sucesso');

  sentMessages = [];
  const selectionVideos = spyFeatures.parseDownloadSelection('V1, V2 H');
  await spyFeatures.handleMultiDownload(mockSock, testJid, selectionVideos);
  const videosSent = sentMessages.filter(m => m.payload.video || (m.payload.document && m.payload.mimetype === 'video/mp4'));
  assert(videosSent.length >= 2, 'Deve enviar ao menos 2 vídeos para V1, V2 H');
  console.log('  ✅ PASS: V1, V2 H enviou múltiplos vídeos em qualidade High com sucesso');

  // ==========================================
  // BLOCO 6: UPGRADE PARA H RESPONDENDO COM 'H' (handleMediaUpgrade)
  // ==========================================
  console.log('\n--- TESTE 6: Upgrade de Mídia Respondendo com "H" ---');
  // Pega a última mídia enviada registrada
  const lastMedia = spyFeatures.lastMediaPerChat.get(testJid);
  assert(lastMedia, 'Deve haver registro de última mídia enviada');
  assert(lastMedia.msgId, 'Deve conter ID da mensagem enviada');

  sentMessages = [];
  // Simula o usuário respondendo com 'H'
  const mockMsgReplyH = {
    message: {
      extendedTextMessage: {
        text: 'H',
        contextInfo: {
          stanzaId: lastMedia.msgId,
          participant: testJid
        }
      }
    }
  };

  const upgraded = await spyFeatures.handleMediaUpgrade(mockSock, testJid, mockMsgReplyH, 'H');
  assert.strictEqual(upgraded, true, 'handleMediaUpgrade deve retornar true confirmando upgrade');
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('UPGRADE PARA ALTA DEFINIÇÃO (MODO H)')), 'Deve enviar notificação de upgrade em High');
  assert(sentMessages.some(m => m.payload.video || m.payload.audio || m.payload.document), 'Deve rebaixar e reenviar a mídia em alta qualidade');
  console.log('  ✅ PASS: Responder a mídia com "H" rebaixa e atualiza para Alta Definição com sucesso');

  // ==========================================
  // BLOCO 7: INTEGRAÇÃO NO WHATSAPPBOT & MASTER HANDLER
  // ==========================================
  console.log('\n--- TESTE 7: Integração no WhatsAppBot & Master Handler ---');
  // 1. Comando lista no Master Handler
  const listaCmd = handler.commands.get('lista');
  assert(listaCmd, 'Comando lista deve estar registrado no Master Handler');
  assert(listaCmd.command.includes('search') && listaCmd.command.includes('pesquisar'), 'Deve conter aliases search e pesquisar');

  // 2. WhatsAppBot processando atalho múltiplo '1, 2'
  sentMessages = [];
  const mockMsgMultiChoice = {
    key: { remoteJid: testJid, id: 'multi_req_1' },
    pushName: 'Usuário Teste',
    message: { conversation: '1, 2' }
  };
  await whatsappBot._processIncomingMessage(mockMsgMultiChoice, mockSock);
  assert(sentMessages.length >= 2, 'WhatsAppBot deve processar 1, 2 e enviar mídias');

  // 3. WhatsAppBot processando upgrade 'H'
  sentMessages = [];
  const mockMsgUpgradeH = {
    key: { remoteJid: testJid, id: 'multi_req_2' },
    pushName: 'Usuário Teste',
    message: { conversation: 'H' }
  };
  await whatsappBot._processIncomingMessage(mockMsgUpgradeH, mockSock);
  assert(sentMessages.some(m => m.payload.text && m.payload.text.includes('UPGRADE PARA ALTA DEFINIÇÃO')), 'WhatsAppBot deve capturar H e disparar upgrade');
  console.log('  ✅ PASS: WhatsAppBot e Master Handler integrados com suporte a 1, 2 e H');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES DO !LISTA E DOWNLOAD MÚLTIPLO PASSARAM!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

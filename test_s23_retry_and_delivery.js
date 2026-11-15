const assert = require('assert');
const whatsappMessageStore = require('./src/services/whatsappMessageStoreService');
const spyFeatures = require('./src/services/spyFeaturesService');

async function runTests() {
  console.log('======================================================');
  console.log('🧪 INICIANDO TESTES: RESILIÊNCIA, RETRY E ENTREGA S23 ULTRA');
  console.log('======================================================\n');

  const s23Phone = '5511988887777';
  const s23Lid = '100245090398329';
  const s23Jid = `${s23Phone}@s.whatsapp.net`;
  const s23LidJid = `${s23Lid}@lid`;

  // --- TESTE 1: Mapeamento e Resolução Bidirecional LID <-> Telefone ---
  console.log('--- TESTE 1: Mapeamento e Resolução Bidirecional LID <-> Telefone ---');
  whatsappMessageStore.registerLidMapping(s23Lid, s23Phone);

  const resolvedPhone = whatsappMessageStore.resolveLidToPhone(s23Lid);
  assert.strictEqual(resolvedPhone, s23Phone, 'LID puro deve resolver para o telefone');

  const resolvedFromJid = whatsappMessageStore.resolveLidToPhone(s23LidJid);
  assert.strictEqual(resolvedFromJid, s23Phone, 'JID @lid deve resolver para o telefone');

  const resolvedLid = whatsappMessageStore.resolvePhoneToLid(s23Phone);
  assert.strictEqual(resolvedLid, s23Lid, 'Telefone deve resolver para o LID correspondente');

  // Auto-extração a partir de envelope WAMessage com remoteJidAlt
  const mockMsg = {
    key: {
      id: 'MSG_ENV_001',
      remoteJid: '200111222333444@lid',
      remoteJidAlt: '5511977776666@s.whatsapp.net'
    }
  };
  whatsappMessageStore.extractAndRegisterFromMsg(mockMsg);
  assert.strictEqual(whatsappMessageStore.resolveLidToPhone('200111222333444'), '5511977776666');
  console.log('  ✅ PASS: Mapeamento bidirecional LID <-> Telefone validado');

  // --- TESTE 2: Interceptação e Armazenamento de Mensagens Enviadas (Outgoing) ---
  console.log('\n--- TESTE 2: Interceptação e Armazenamento de Mensagens Enviadas (Outgoing) ---');
  const mockSock = {
    instanceId: 1,
    sendMessage: async (jid, content) => {
      return {
        key: {
          id: 'BAE5TEST_' + Math.random().toString(36).substring(2, 9),
          remoteJid: jid,
          fromMe: true
        },
        message: {
          audioMessage: {
            url: 'https://mock.audio.url',
            mimetype: 'audio/mpeg',
            fileLength: 4500000,
            seconds: 240
          }
        }
      };
    }
  };

  whatsappMessageStore.wrapSocketWithRetryTracking(mockSock);

  const sentResult = await mockSock.sendMessage(s23Jid, { audio: Buffer.alloc(100) });
  assert(sentResult?.key?.id, 'Mensagem deve ter ID');

  const cachedMsg = whatsappMessageStore.getOutgoingMessage({ id: sentResult.key.id });
  assert(cachedMsg, 'Mensagem enviada deve estar indexada na Outgoing Store');
  assert(cachedMsg.audioMessage, 'Deve armazenar o protobuf real audioMessage');
  console.log('  ✅ PASS: Mensagens de saída são interceptadas e cacheadas com protobuf completo');

  // --- TESTE 3: Resolução de Retries do S23 Ultra via getMessage ---
  console.log('\n--- TESTE 3: Resolução de Retries do S23 Ultra via getMessage ---');
  // S23 Ultra envia retry referenciando o ID da mensagem, mas com seu LID ou companion device :1
  const retryKeyLid = {
    id: sentResult.key.id,
    remoteJid: s23LidJid,
    fromMe: true
  };

  const retryResLid = await whatsappMessageStore.getMessage(retryKeyLid);
  assert(retryResLid, 'getMessage deve resolver mensagem para retry enviado com LID');
  assert(retryResLid.audioMessage, 'Mensagem resolvida deve ser o áudio original');

  // Retry com companion device (:1@s.whatsapp.net)
  const retryKeyCompanion = {
    id: sentResult.key.id,
    remoteJid: `${s23Phone}:1@s.whatsapp.net`,
    fromMe: true
  };

  const retryResCompanion = await whatsappMessageStore.getMessage(retryKeyCompanion);
  assert(retryResCompanion, 'getMessage deve resolver mensagem para retry com device companion :1');
  assert(retryResCompanion.audioMessage, 'Mensagem resolvida deve ser o áudio original');
  console.log('  ✅ PASS: Retries do S23 Ultra via LID e Companion Device resolvidos com sucesso');

  // --- TESTE 4: msgRetryCounterCache e TTL ---
  console.log('\n--- TESTE 4: msgRetryCounterCache e TTL ---');
  const cache = whatsappMessageStore.msgRetryCounterCache;
  assert(cache, 'msgRetryCounterCache deve estar instanciado');
  cache.set('retry_test_msg_1', 2);
  assert.strictEqual(cache.get('retry_test_msg_1'), 2, 'Contador de retries deve ser armazenado e lido');
  console.log('  ✅ PASS: msgRetryCounterCache ativo e compatível com Baileys');

  // --- TESTE 5: Sub-Bot Compartilhando a Mesma Store de Retry ---
  console.log('\n--- TESTE 5: Sub-Bot Compartilhando a Mesma Store de Retry ---');
  const mockSubBotSock = {
    instanceId: 2,
    sendMessage: async (jid, content) => {
      return {
        key: {
          id: 'SUBBOT_DOC_' + Date.now(),
          remoteJid: jid,
          fromMe: true
        },
        message: {
          documentMessage: {
            fileName: 'musica_hq.mp3',
            mimetype: 'audio/mpeg'
          }
        }
      };
    }
  };

  whatsappMessageStore.wrapSocketWithRetryTracking(mockSubBotSock);
  const subSent = await mockSubBotSock.sendMessage(s23Jid, { document: Buffer.alloc(10) });

  // S23 Ultra pede retry ao Sub-Bot
  const subRetryRes = await whatsappMessageStore.getMessage({ id: subSent.key.id, remoteJid: s23Jid, fromMe: true });
  assert(subRetryRes, 'Sub-Bot deve resolver a mensagem de retry');
  assert(subRetryRes.documentMessage, 'Sub-Bot não deve devolver string dummy, mas sim documentMessage real');
  assert.notStrictEqual(subRetryRes.conversation, 'PayBot', 'NÃO deve ser o texto dummy "PayBot"');
  console.log('  ✅ PASS: Sub-Bots entregam retries reais com sucesso sem dummy "PayBot"');

  // --- TESTE 6: Validação de Card de Link Preview e Áudio para S23 Ultra ---
  console.log('\n--- TESTE 6: Validação de Card de Link Preview e Áudio para S23 Ultra ---');
  const sentPayloads = [];
  const testSock = {
    instanceId: 1,
    sendMessage: async (jid, payload) => {
      sentPayloads.push(payload);
      return {
        key: { id: 'TEST_PLAY_' + Date.now(), remoteJid: jid, fromMe: true },
        message: payload
      };
    }
  };

  await spyFeatures.handlePlayMusic(testSock, s23Jid, '!play Queen Bohemian Rhapsody');
  assert(sentPayloads.length >= 2, 'Deve enviar o card informativo + áudio');

  const cardPayload = sentPayloads.find(p => p.text && p.contextInfo?.externalAdReply);
  assert(cardPayload, 'Card informativo com preview de link deve existir');
  assert(cardPayload.linkPreview, 'Card deve conter linkPreview para renderização nativa de link no Android/Samsung');
  assert(cardPayload.linkPreview['matched-text'], 'linkPreview deve apontar para o link do vídeo');
  assert(Buffer.isBuffer(cardPayload.linkPreview.jpegThumbnail), 'linkPreview deve conter buffer JPEG da thumbnail');

  const adReply = cardPayload.contextInfo.externalAdReply;
  assert.strictEqual(adReply.mediaType, 1, 'mediaType deve ser 1 (IMAGE)');
  assert(Buffer.isBuffer(adReply.thumbnail), 'thumbnail do externalAdReply deve ser buffer JPEG');
  assert.strictEqual(adReply.renderLargerThumbnail, true, 'renderLargerThumbnail deve ser true');

  const audioPayload = sentPayloads.find(p => p.audio);
  assert(audioPayload, 'Mensagem de áudio deve ser enviada');
  assert.strictEqual(audioPayload.mimetype, 'audio/mpeg');
  assert.strictEqual(audioPayload.ptt, false);
  console.log('  ✅ PASS: Card rico com linkPreview nativo + externalAdReply entregue perfeitamente');

  // --- TESTE 7: Validação de Documento !playdoc Limpo e com Capa ---
  console.log('\n--- TESTE 7: Validação de Documento !playdoc Limpo e com Capa ---');
  const docPayloads = [];
  const testDocSock = {
    instanceId: 1,
    sendMessage: async (jid, payload) => {
      docPayloads.push(payload);
      return {
        key: { id: 'TEST_DOC_' + Date.now(), remoteJid: jid, fromMe: true },
        message: payload
      };
    }
  };

  await spyFeatures.handlePlayDoc(testDocSock, s23Jid, '!playdoc Queen Bohemian Rhapsody');
  const docMsg = docPayloads.find(p => p.document);
  assert(docMsg, 'Mensagem de documento deve existir');
  assert.strictEqual(docMsg.mimetype, 'audio/mpeg');
  assert(docMsg.jpegThumbnail, 'jpegThumbnail nativo deve estar presente para exibir capa no WhatsApp Android');
  assert(!docMsg.contextInfo?.externalAdReply, 'Documento NÃO deve ter externalAdReply duplicado que quebra no Android');
  console.log('  ✅ PASS: Documento !playdoc entregue com jpegThumbnail nativo sem quebra de formato');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS 7 TESTES DE RESILIÊNCIA S23 ULTRA PASSARAM COM SUCESSO!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ ERRO NOS TESTES:', err);
  process.exit(1);
});

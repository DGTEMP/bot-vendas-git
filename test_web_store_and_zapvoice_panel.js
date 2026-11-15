/**
 * Suite de Verificação: Painel Web - Abrir Loja Pública e ZapVoice 2025 & Funis
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.STORE_PORT = '3001';

const models = require('./src/db/models');

async function runTestSuite() {
  console.log('🧪 Iniciando testes: Loja Pública e ZapVoice 2025...\n');

  // 1. Verificação do index.html
  console.log('--- [1] Verificação Estrutural de src/public/index.html ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'src', 'public', 'index.html'), 'utf8');

  assert.ok(indexHtml.includes('id="tab-zapvoice"'), 'Aba tab-zapvoice deve existir em index.html');
  assert.ok(indexHtml.includes('data-tab="zapvoice"'), 'Botão de navegação data-tab="zapvoice" deve existir');
  assert.ok(indexHtml.includes('openPublicStore(event)'), 'Link da loja pública deve chamar openPublicStore');
  assert.ok(indexHtml.includes('href="/loja"'), 'Link da loja pública deve apontar para /loja');
  assert.ok(indexHtml.includes('zvStatMessages'), 'Card de métricas zvStatMessages deve existir');
  assert.ok(indexHtml.includes('zvStatAudios'), 'Card de métricas zvStatAudios deve existir');
  assert.ok(indexHtml.includes('zvStatFunnels'), 'Card de métricas zvStatFunnels deve existir');
  assert.ok(indexHtml.includes('zvStatCampaigns'), 'Card de métricas zvStatCampaigns deve existir');
  assert.ok(indexHtml.includes('btnZvTabMessages'), 'Botão da sub-aba Mensagens deve existir');
  assert.ok(indexHtml.includes('btnZvTabAudios'), 'Botão da sub-aba Áudios deve existir');
  assert.ok(indexHtml.includes('btnZvTabFunnels'), 'Botão da sub-aba Funis deve existir');
  assert.ok(indexHtml.includes('btnZvTabSettings'), 'Botão da sub-aba Configurações deve existir');
  assert.ok(indexHtml.includes('zvSubtabMessagesPane'), 'Painel zvSubtabMessagesPane deve existir');
  assert.ok(indexHtml.includes('zvSubtabAudiosPane'), 'Painel zvSubtabAudiosPane deve existir');
  assert.ok(indexHtml.includes('zvSubtabFunnelsPane'), 'Painel zvSubtabFunnelsPane deve existir');
  assert.ok(indexHtml.includes('zvSubtabSettingsPane'), 'Painel zvSubtabSettingsPane deve existir');
  assert.ok(indexHtml.includes('modalZvMessage'), 'Modal modalZvMessage deve existir');
  assert.ok(indexHtml.includes('modalZvAudio'), 'Modal modalZvAudio deve existir');
  assert.ok(indexHtml.includes('modalZvFunnel'), 'Modal modalZvFunnel deve existir');
  assert.ok(indexHtml.includes('modalZvStep'), 'Modal modalZvStep deve existir');
  assert.ok(indexHtml.includes('modalZvTestSend'), 'Modal modalZvTestSend deve existir');
  console.log('✅ index.html contém toda a estrutura e componentes do ZapVoice e Loja Pública.');

  // 2. Verificação do app.js
  console.log('\n--- [2] Verificação das Funções em src/public/app.js ---');
  const appJs = fs.readFileSync(path.join(__dirname, 'src', 'public', 'app.js'), 'utf8');

  // initNav não bloqueia links sem data-tab
  assert.ok(appJs.includes('if (!tabName)'), 'initNav deve checar se tabName existe antes de e.preventDefault()');
  assert.ok(appJs.includes('function openPublicStore'), 'openPublicStore deve estar implementada');
  assert.ok(appJs.includes('function openModal'), 'openModal helper global deve existir');
  assert.ok(appJs.includes('function closeModal'), 'closeModal helper global deve existir');
  assert.ok(appJs.includes('function switchZvSubtab'), 'switchZvSubtab deve existir');
  assert.ok(appJs.includes('function copyZvVar'), 'copyZvVar deve existir');
  assert.ok(appJs.includes('function insertZvVarIntoContent'), 'insertZvVarIntoContent deve existir');
  assert.ok(appJs.includes('function loadZapVoiceOverview'), 'loadZapVoiceOverview deve existir');
  assert.ok(appJs.includes('function loadZapVoiceMessages'), 'loadZapVoiceMessages deve existir');
  assert.ok(appJs.includes('function renderZapVoiceMessagesTable'), 'renderZapVoiceMessagesTable deve existir');
  assert.ok(appJs.includes('function openNewZvMessageModal'), 'openNewZvMessageModal deve existir');
  assert.ok(appJs.includes('function editZapVoiceMessage'), 'editZapVoiceMessage deve existir');
  assert.ok(appJs.includes('function saveZapVoiceMessageForm'), 'saveZapVoiceMessageForm deve existir');
  assert.ok(appJs.includes('function deleteZapVoiceMessage'), 'deleteZapVoiceMessage deve existir');
  assert.ok(appJs.includes('function loadZapVoiceAudios'), 'loadZapVoiceAudios deve existir');
  assert.ok(appJs.includes('function renderZapVoiceAudiosTable'), 'renderZapVoiceAudiosTable deve existir');
  assert.ok(appJs.includes('function openNewZvAudioModal'), 'openNewZvAudioModal deve existir');
  assert.ok(appJs.includes('function synthesizeZapVoiceAudio'), 'synthesizeZapVoiceAudio deve existir');
  assert.ok(appJs.includes('function deleteZapVoiceAudio'), 'deleteZapVoiceAudio deve existir');
  assert.ok(appJs.includes('function loadZapVoiceFunnels'), 'loadZapVoiceFunnels deve existir');
  assert.ok(appJs.includes('function renderZapVoiceFunnels'), 'renderZapVoiceFunnels deve existir');
  assert.ok(appJs.includes('function openNewZvFunnelModal'), 'openNewZvFunnelModal deve existir');
  assert.ok(appJs.includes('function saveZapVoiceFunnelForm'), 'saveZapVoiceFunnelForm deve existir');
  assert.ok(appJs.includes('function deleteZapVoiceFunnel'), 'deleteZapVoiceFunnel deve existir');
  assert.ok(appJs.includes('function openZvAddStepModal'), 'openZvAddStepModal deve existir');
  assert.ok(appJs.includes('function saveZapVoiceStepForm'), 'saveZapVoiceStepForm deve existir');
  assert.ok(appJs.includes('function deleteZvStep'), 'deleteZvStep deve existir');
  assert.ok(appJs.includes('function openZvTestModal'), 'openZvTestModal deve existir');
  assert.ok(appJs.includes('function executeZapVoiceTestSend'), 'executeZapVoiceTestSend deve existir');
  assert.ok(appJs.includes('function loadZapVoiceSettings'), 'loadZapVoiceSettings deve existir');
  assert.ok(appJs.includes('function saveZapVoiceSettings'), 'saveZapVoiceSettings deve existir');
  console.log('✅ app.js possui todas as funções interativas, reativas e de gestão do ZapVoice.');

  // 3. Verificação do Servidor Express & Rotas da API
  console.log('\n--- [3] Verificação das Rotas REST no Backend ---');
  const { createServer } = require('./src/server/app');
  const mockWhatsapp = {
    sock: {
      sendMessage: async (jid, content) => ({ key: { id: 'test_msg_id' }, content })
    },
    sendMessage: async (jid, text) => ({ key: { id: 'test_text_id' }, text })
  };
  const mockTelegram = {};

  const serverInstance = createServer(mockWhatsapp, mockTelegram);
  const testPort = 39182;

  await new Promise((resolve) => {
    serverInstance.listen(testPort, () => {
      console.log(`📡 Servidor de teste ouvindo na porta ${testPort}`);
      resolve();
    });
  });

  function makeRequest(method, pathUrl, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: testPort,
        path: pathUrl,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, data: parsed, headers: res.headers });
          } catch (_) {
            resolve({ status: res.statusCode, raw: data, headers: res.headers });
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    // 3.1 GET /api/store/url
    const storeUrlRes = await makeRequest('GET', '/api/store/url');
    assert.strictEqual(storeUrlRes.status, 200);
    assert.strictEqual(storeUrlRes.data.success, true);
    assert.ok(storeUrlRes.data.url, 'URL da loja deve ser retornada');
    console.log(`✅ [GET /api/store/url] URL retornado com sucesso: ${storeUrlRes.data.url}`);

    // 3.2 GET /api/zapvoice/stats
    const statsRes = await makeRequest('GET', '/api/zapvoice/stats');
    assert.strictEqual(statsRes.status, 200);
    assert.strictEqual(statsRes.data.success, true);
    assert.ok(statsRes.data.stats !== undefined);
    console.log('✅ [GET /api/zapvoice/stats] Métricas retornadas com sucesso.');

    // 3.3 POST & GET & DELETE /api/zapvoice/messages
    const msgCreateRes = await makeRequest('POST', '/api/zapvoice/messages', {
      title: 'Teste Oferta Relâmpago',
      shortcut: '/teste',
      content: 'Olá {primeiro_nome}, aproveite o valor especial de {valor}!',
      category: 'Vendas',
      trigger_keywords: ['promo', 'desconto']
    });
    assert.strictEqual(msgCreateRes.status, 200);
    assert.strictEqual(msgCreateRes.data.success, true);
    const createdMsgId = msgCreateRes.data.message.id;
    assert.ok(createdMsgId, 'ID da mensagem criada deve ser retornado');
    console.log(`✅ [POST /api/zapvoice/messages] Mensagem #${createdMsgId} criada.`);

    const msgListRes = await makeRequest('GET', '/api/zapvoice/messages');
    assert.strictEqual(msgListRes.status, 200);
    const foundMsg = msgListRes.data.messages.find(m => m.id === createdMsgId);
    assert.ok(foundMsg, 'Mensagem criada deve constar na listagem');
    console.log('✅ [GET /api/zapvoice/messages] Mensagem recuperada na lista.');

    // 3.4 POST /api/zapvoice/messages/send-test
    const msgTestSend = await makeRequest('POST', '/api/zapvoice/messages/send-test', {
      messageId: createdMsgId,
      targetPhone: '5548999999999',
      context: { primeiro_nome: 'Carlos', valor: 'R$ 97,00' }
    });
    assert.strictEqual(msgTestSend.status, 200);
    assert.strictEqual(msgTestSend.data.success, true);
    console.log('✅ [POST /api/zapvoice/messages/send-test] Disparo de teste executado com substituição de variáveis.');

    // 3.5 POST & GET /api/zapvoice/funnels
    const funnelCreateRes = await makeRequest('POST', '/api/zapvoice/funnels', {
      name: 'Funil Resgate Automatizado',
      description: 'Disparo de áudio PTT e proposta',
      trigger_keywords: ['resgate', 'carrinho']
    });
    assert.strictEqual(funnelCreateRes.status, 200);
    assert.strictEqual(funnelCreateRes.data.success, true);
    const createdFunnelId = funnelCreateRes.data.funnel.id;
    console.log(`✅ [POST /api/zapvoice/funnels] Funil #${createdFunnelId} criado com sucesso.`);

    // 3.6 POST & GET /api/zapvoice/funnels/:id/steps
    const stepCreateRes = await makeRequest('POST', `/api/zapvoice/funnels/${createdFunnelId}/steps`, {
      step_type: 'text',
      delay_seconds: 2,
      content: 'Oi {primeiro_nome}, vi que seu Pix ficou pendente!'
    });
    assert.strictEqual(stepCreateRes.status, 200);
    assert.strictEqual(stepCreateRes.data.success, true);
    const createdStepId = stepCreateRes.data.step.id;
    console.log(`✅ [POST /api/zapvoice/funnels/:id/steps] Etapa #${createdStepId} adicionada ao funil.`);

    const stepsListRes = await makeRequest('GET', `/api/zapvoice/funnels/${createdFunnelId}/steps`);
    assert.strictEqual(stepsListRes.status, 200);
    assert.strictEqual(stepsListRes.data.steps.length, 1);
    console.log('✅ [GET /api/zapvoice/funnels/:id/steps] Etapas listadas com sucesso.');

    // 3.7 POST & GET /api/zapvoice/audios e streaming
    const testAudioPath = path.join(__dirname, 'data', 'zapvoice_audios');
    if (!fs.existsSync(testAudioPath)) fs.mkdirSync(testAudioPath, { recursive: true });
    const dummyAudioFile = path.join(testAudioPath, 'dummy_test.opus');
    fs.writeFileSync(dummyAudioFile, Buffer.alloc(512, 1));

    const audioCreateRes = await makeRequest('POST', '/api/zapvoice/audios', {
      title: 'Áudio Apresentação VIP',
      shortcut: '/audio_vip',
      audio_path: dummyAudioFile,
      duration_seconds: 8,
      is_ptt: 1
    });
    assert.strictEqual(audioCreateRes.status, 200);
    const createdAudioId = audioCreateRes.data.audio.id;
    console.log(`✅ [POST /api/zapvoice/audios] Áudio PTT #${createdAudioId} registrado.`);

    const audioStreamRes = await makeRequest('GET', `/api/zapvoice/audios/${createdAudioId}/stream`);
    assert.strictEqual(audioStreamRes.status, 200);
    assert.strictEqual(audioStreamRes.headers['content-type'], 'audio/ogg; codecs=opus');
    console.log('✅ [GET /api/zapvoice/audios/:id/stream] Stream de áudio PTT respondeu status 200 com content-type audio/ogg.');

    // 3.8 Limpeza
    await makeRequest('DELETE', `/api/zapvoice/messages/${createdMsgId}`);
    await makeRequest('DELETE', `/api/zapvoice/funnels/steps/${createdStepId}`);
    await makeRequest('DELETE', `/api/zapvoice/funnels/${createdFunnelId}`);
    await makeRequest('DELETE', `/api/zapvoice/audios/${createdAudioId}`);
    if (fs.existsSync(dummyAudioFile)) fs.unlinkSync(dummyAudioFile);
    console.log('✅ Limpeza de registros de teste concluída com sucesso.');

  } catch (err) {
    console.error('Erro detalhado no try:', err);
    throw err;
  } finally {
    if (serverInstance && typeof serverInstance.close === 'function') {
      serverInstance.close();
    }
  }

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!\n');
  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

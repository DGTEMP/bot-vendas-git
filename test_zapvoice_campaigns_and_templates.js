/**
 * test_zapvoice_campaigns_and_templates.js
 * Teste completo da Central ZapVoice 2025:
 * 1. Carga de Modelos Oficiais (POST /api/zapvoice/load-templates)
 * 2. Gestão de Campanhas em Massa com Delay Anti-Ban (CRUD, start, pause, delete)
 * 3. Streaming de Áudio PTT para o Navegador (GET /api/zapvoice/audios/:id/stream)
 * 4. Backup e Restauração de Fluxos em JSON (GET /export, POST /import)
 */

const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 TESTES: CENTRAL ZAPVOICE & CAMPANHAS EM MASSA');
  console.log('====================================================\n');

  const app = createServer();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Carregar Modelos Oficiais
    console.log('--- 1. Carregar Modelos Oficiais ZapVoice 2025 ---');
    const resLoad = await fetch(`${baseUrl}/api/zapvoice/load-templates`, { method: 'POST' });
    const dataLoad = await resLoad.json();
    assert.strictEqual(dataLoad.success, true, 'Deve carregar templates com sucesso');
    const stats = dataLoad.stats || {};
    assert.ok(stats.total_funnels >= 3, 'Deve carregar no mínimo 3 funis');
    assert.ok(stats.total_messages >= 3, 'Deve carregar no mínimo 3 mensagens');
    assert.ok(stats.total_audios >= 3, 'Deve carregar áudios de exemplo');
    console.log(`  ✓ Templates carregados: ${stats.total_funnels} funis, ${stats.total_messages} mensagens, ${stats.total_audios} áudios`);

    // 2. Criar Nova Campanha em Massa
    console.log('\n--- 2. Criação de Campanha de Disparo em Massa ---');
    const funnels = models.listZapVoiceFunnels(true);
    assert.ok(funnels.length > 0, 'Deve ter ao menos 1 funil ativo');
    const targetFunnel = funnels[0];

    const campaignPayload = {
      name: 'Campanha Teste Automatizada',
      funnel_id: targetFunnel.id,
      targets: ['5511999990001', '5511999990002', '5511999990003'],
      min_delay: 2,
      max_delay: 4
    };

    const resCampCreate = await fetch(`${baseUrl}/api/zapvoice/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaignPayload)
    });
    const dataCampCreate = await resCampCreate.json();
    assert.strictEqual(dataCampCreate.success, true);
    assert.ok(dataCampCreate.campaign.id);
    assert.strictEqual(dataCampCreate.campaign.total_count, 3);
    const campaignId = dataCampCreate.campaign.id;
    console.log(`  ✓ Campanha criada com sucesso (ID #${campaignId}) com 3 destinatários`);

    // 3. Listar Campanhas
    console.log('\n--- 3. Listagem de Campanhas ---');
    const resList = await fetch(`${baseUrl}/api/zapvoice/campaigns`);
    const dataList = await resList.json();
    assert.strictEqual(dataList.success, true);
    const found = dataList.campaigns.find(c => c.id === campaignId);
    assert.ok(found, 'Campanha deve constar na listagem');
    console.log(`  ✓ Campanha encontrada na listagem (${dataList.campaigns.length} no total)`);

    // 4. Iniciar e Pausar Campanha
    console.log('\n--- 4. Iniciar e Pausar Campanha ---');
    const resStart = await fetch(`${baseUrl}/api/zapvoice/campaigns/${campaignId}/start`, { method: 'POST' });
    const dataStart = await resStart.json();
    assert.strictEqual(dataStart.success, true);

    const resPause = await fetch(`${baseUrl}/api/zapvoice/campaigns/${campaignId}/pause`, { method: 'POST' });
    const dataPause = await resPause.json();
    assert.strictEqual(dataPause.success, true);
    console.log('  ✓ Iniciar e Pausar disparos da campanha responderam com sucesso');

    // 5. Excluir Campanha
    console.log('\n--- 5. Exclusão de Campanha ---');
    const resDel = await fetch(`${baseUrl}/api/zapvoice/campaigns/${campaignId}`, { method: 'DELETE' });
    const dataDel = await resDel.json();
    assert.strictEqual(dataDel.success, true);
    assert.ok(!models.getZapVoiceCampaign(campaignId), 'Campanha deve ter sido removida do BD');
    console.log('  ✓ Campanha excluída com sucesso');

    // 6. Streaming de Áudio PTT
    console.log('\n--- 6. Endpoint de Streaming de Áudio PTT ---');
    const audios = models.listZapVoiceAudios();
    assert.ok(audios.length > 0, 'Deve ter áudios cadastrados');
    const firstAudio = audios[0];

    const resStream = await fetch(`${baseUrl}/api/zapvoice/audios/${firstAudio.id}/stream`);
    assert.strictEqual(resStream.status, 200);
    assert.ok(resStream.headers.get('content-type')?.includes('audio/'), 'Content-type deve ser áudio');
    const buffer = await resStream.arrayBuffer();
    assert.ok(buffer.byteLength > 0, 'Buffer de áudio transmitido');
    console.log(`  ✓ Streaming de áudio #${firstAudio.id} funcionando (${buffer.byteLength} bytes, ${resStream.headers.get('content-type')})`);

    // 7. Exportar e Importar Configuração ZapVoice
    console.log('\n--- 7. Exportação e Importação de Fluxos em JSON ---');
    const resExport = await fetch(`${baseUrl}/api/zapvoice/export`);
    assert.strictEqual(resExport.status, 200);
    const exportJson = await resExport.json();
    assert.ok(exportJson.funnels && exportJson.messages);
    console.log(`  ✓ Exportação gerou backup com ${exportJson.funnels.length} funis e ${exportJson.messages.length} mensagens`);

    const resImport = await fetch(`${baseUrl}/api/zapvoice/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportJson)
    });
    const dataImport = await resImport.json();
    assert.strictEqual(dataImport.success, true);
    console.log('  ✓ Importação validou e processou os fluxos JSON');

    console.log('\n🎉 TODOS OS TESTES DA CENTRAL ZAPVOICE & CAMPANHAS PASSARAM COM 100% DE SUCESSO!\n');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

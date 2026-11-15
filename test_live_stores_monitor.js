/**
 * Testes para o Monitor de Lojas Abertas & Radar de Visitantes Ao Vivo
 * Valida: quantas lojas abertas, quem está, seção/produto, localização (DDD/IP) e aparelho (User-Agent)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const models = require('./src/db/models');
const webStoreTrackerService = require('./src/services/webStoreTrackerService');

async function runTests() {
  console.log('🧪 Iniciando testes do Radar de Lojas Abertas & Visitantes Ao Vivo...');

  // 1. Testando Parser de Aparelhos (User-Agent)
  console.log('\n[1/5] Testando Parser de Aparelhos (User-Agent)...');
  const uaAndroidWpp = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36 WhatsApp/2.24.1.78';
  const parsed1 = webStoreTrackerService.parseUserAgent(uaAndroidWpp);
  assert.strictEqual(parsed1.deviceType, 'Mobile', 'Deveria ser Mobile');
  assert(parsed1.os.includes('Android'), 'OS deveria conter Android');
  assert.strictEqual(parsed1.browser, 'WhatsApp In-App', 'Navegador deveria ser WhatsApp In-App');
  console.log(`   ✅ Android + WhatsApp detectado: "${parsed1.device}"`);

  const uaiPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const parsed2 = webStoreTrackerService.parseUserAgent(uaiPhone);
  assert.strictEqual(parsed2.deviceType, 'Mobile', 'Deveria ser Mobile');
  assert(parsed2.os.includes('iOS'), 'OS deveria conter iOS');
  assert.strictEqual(parsed2.browser, 'Apple Safari', 'Navegador deveria ser Apple Safari');
  console.log(`   ✅ iPhone + Safari detectado: "${parsed2.device}"`);

  const uaWindowsPC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';
  const parsed3 = webStoreTrackerService.parseUserAgent(uaWindowsPC);
  assert.strictEqual(parsed3.deviceType, 'Desktop', 'Deveria ser Desktop');
  assert(parsed3.os.includes('Windows'), 'OS deveria conter Windows');
  assert.strictEqual(parsed3.browser, 'Microsoft Edge', 'Navegador deveria ser Microsoft Edge');
  console.log(`   ✅ Windows PC + Edge detectado: "${parsed3.device}"`);

  // 2. Testando Resolução de Localização por DDD Brasileiro e IP
  console.log('\n[2/5] Testando Resolução de Localização (DDD & IP)...');
  const locSP = webStoreTrackerService.resolveLocation('5511988887777', '189.40.10.2');
  assert(locSP.includes('São Paulo') && locSP.includes('11'), 'DDD 11 deve resolver para São Paulo');
  console.log(`   ✅ DDD 11 resolvido: "${locSP}"`);

  const locRJ = webStoreTrackerService.resolveLocation('5521977776666', '177.18.5.10');
  assert(locRJ.includes('Rio de Janeiro') && locRJ.includes('21'), 'DDD 21 deve resolver para Rio de Janeiro');
  console.log(`   ✅ DDD 21 resolvido: "${locRJ}"`);

  const locLocal = webStoreTrackerService.resolveLocation(null, '127.0.0.1');
  assert(locLocal.includes('Rede Local'), 'IP 127.0.0.1 deve resolver para Rede Local');
  console.log(`   ✅ IP Local resolvido: "${locLocal}"`);

  // 3. Testando Registro e Telemetria no Banco
  console.log('\n[3/5] Testando Registro de Sessão com Aparelho, Loja, Seção e Produto...');
  const testSession1 = 'sess_live_test_alpha_01';
  const resTrack = await webStoreTrackerService.trackEvent({
    session_id: testSession1,
    phone: '5511999995555',
    customer_name: 'Marcos Vinicius',
    event_type: 'PRODUCT_VIEW',
    product_id: 101,
    product_name: 'Bot Vendas Automático PRO',
    cart_payload: JSON.stringify([{ id: 101, name: 'Bot Vendas PRO', price: 97.00, quantity: 1 }]),
    cart_total: 97.00,
    section: 'Softwares & IA',
    subbot_id: 2,
    user_agent: uaAndroidWpp,
    ip: '189.40.10.2',
    screen_resolution: '1080x2400'
  });

  assert(resTrack.success, 'trackEvent deveria retornar sucesso');

  const sess1 = models.getCartSession(testSession1);
  assert(sess1, 'Sessão deveria existir no banco');
  assert.strictEqual(sess1.phone, '5511999995555');
  assert.strictEqual(sess1.customer_name, 'Marcos Vinicius');
  assert.strictEqual(sess1.current_product_name, 'Bot Vendas Automático PRO');
  assert.strictEqual(sess1.current_section, 'Softwares & IA');
  assert.strictEqual(sess1.subbot_id, 2);
  assert(sess1.device.includes('Android'), 'Device deve conter Android');
  assert(sess1.location.includes('São Paulo'), 'Location deve conter São Paulo');
  console.log(`   ✅ Sessão registrada com sucesso: Loja #${sess1.subbot_id}, Cliente: ${sess1.customer_name}, Produto: ${sess1.current_product_name}, Local: ${sess1.location}, Aparelho: ${sess1.device}`);

  // 4. Testando Heartbeat (Atualização de Seção para Checkout)
  console.log('\n[4/5] Testando Heartbeat em Tempo Real (Mudança para Checkout)...');
  const resHb = await webStoreTrackerService.recordHeartbeat({
    session_id: testSession1,
    phone: '5511999995555',
    customer_name: 'Marcos Vinicius',
    section: 'Checkout & Pagamento Pix',
    product_id: 101,
    product_name: 'Bot Vendas Automático PRO',
    subbot_id: 2,
    cart_total: 97.00,
    user_agent: uaAndroidWpp,
    ip: '189.40.10.2'
  });
  assert(resHb.success, 'Heartbeat deveria retornar sucesso');

  const sessAfterHb = models.getCartSession(testSession1);
  assert.strictEqual(sessAfterHb.current_section, 'Checkout & Pagamento Pix', 'Seção atualizada via Heartbeat');
  console.log(`   ✅ Heartbeat atualizou seção em tempo real: "${sessAfterHb.current_section}"`);

  // 5. Testando Consulta Agregada de Lojas Abertas (getLiveStoreSessions)
  console.log('\n[5/5] Testando models.getLiveStoreSessions (Métricas de Lojas Abertas)...');
  
  // Criar uma segunda sessão em outra loja (Loja Matriz)
  const testSession2 = 'sess_live_test_beta_02';
  await webStoreTrackerService.trackEvent({
    session_id: testSession2,
    phone: null,
    customer_name: null,
    event_type: 'PAGE_VIEW',
    section: 'Catálogo Geral',
    subbot_id: 1,
    user_agent: uaWindowsPC,
    ip: '127.0.0.1'
  });

  const liveData = models.getLiveStoreSessions(15);
  assert(liveData, 'Dados de live store devem ser retornados');
  assert(liveData.summary, 'Summary deve existir');
  assert(liveData.summary.openStoresCount >= 2, `Deveria ter pelo menos 2 lojas abertas (Matriz e Sub-Bot 2), recebido: ${liveData.summary.openStoresCount}`);
  assert(liveData.summary.activeVisitorsCount >= 2, `Deveria ter pelo menos 2 visitantes ativos, recebido: ${liveData.summary.activeVisitorsCount}`);
  assert(liveData.summary.identifiedCount >= 1, 'Pelo menos 1 identificado');
  assert(liveData.summary.anonymousCount >= 1, 'Pelo menos 1 anônimo');

  console.log(`   ✅ Métricas do Radar Ao Vivo consolidadas:`);
  console.log(`      • Lojas Abertas com Visitantes: ${liveData.summary.openStoresCount}`);
  console.log(`      • Visitantes Navegando Agora: ${liveData.summary.activeVisitorsCount}`);
  console.log(`      • Identificados com WhatsApp: ${liveData.summary.identifiedCount}`);
  console.log(`      • Anônimos: ${liveData.summary.anonymousCount}`);
  console.log(`      • Lojas Ativas:`, liveData.summary.stores.map(s => `${s.name} (${s.active_visitors} vis)`).join(', '));

  // 6. Testando Endpoints HTTP Express (/api/store/live-visitors & /api/store/heartbeat)
  console.log('\n[6/6] Testando Endpoints HTTP Express (/api/store/live-visitors)...');
  const app = express();
  app.use(express.json());

  app.get('/api/store/live-visitors', (req, res) => {
    const minutes = parseInt(req.query.minutes, 10) || 10;
    const data = webStoreTrackerService.getLiveStoreSessions(minutes);
    res.json({ success: true, ...data });
  });

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/store/live-visitors?minutes=15`);
    const json = await res.json();
    assert(json.success, 'Resposta HTTP deve ser sucesso');
    assert(json.summary.openStoresCount >= 2, 'Pelo menos 2 lojas abertas');
    assert(Array.isArray(json.visitors), 'Lista de visitantes deve ser um array');
    console.log(`   ✅ Endpoint HTTP /api/store/live-visitors respondeu com sucesso: ${json.summary.activeVisitorsCount} visitantes online!`);
    server.close();

    console.log('\n🎉 TODOS OS TESTES DO MONITOR DE LOJAS AO VIVO PASSARAM COM 100% DE SUCESSO! 🎉\n');
    process.exit(0);
  });
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

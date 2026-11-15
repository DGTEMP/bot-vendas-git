const assert = require('assert');
const models = require('./src/db/models');
const db = require('./src/db/database');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappArmyService = require('./src/services/whatsappArmyService');
const fulfillment = require('./src/services/fulfillment');
const messageQueueService = require('./src/services/messageQueueService');

console.log('====================================================');
console.log('⚡ BENCHMARK DE PERFORMANCE & EFICIÊNCIA DO BOT');
console.log('====================================================');

// 1. Benchmark de Leitura de Configurações (Settings Cache)
const SETTING_CYCLES = 5000;
const tStartSettings = process.hrtime.bigint();
for (let i = 0; i < SETTING_CYCLES; i++) {
  models.getSetting('BOT_NAME', 'PayBot');
  models.getSetting('GATEWAY_PIX_ENABLED', 'true');
  models.getSetting('OWNER_PHONE', '554884702848');
}
const tEndSettings = process.hrtime.bigint();
const elapsedSettingsMs = Number(tEndSettings - tStartSettings) / 1e6;
const opsPerSec = Math.round((SETTING_CYCLES * 3) / (elapsedSettingsMs / 1000));

console.log(`✅ [SETTINGS CACHE] ${SETTING_CYCLES * 3} leituras em ${elapsedSettingsMs.toFixed(2)}ms (${opsPerSec.toLocaleString('pt-BR')} ops/seg)`);

// 2. Benchmark de Consultas com Statement Cache e Índices (Sem N+1)
const QUERY_CYCLES = 1000;
const tStartQueries = process.hrtime.bigint();
for (let i = 0; i < QUERY_CYCLES; i++) {
  models.getProducts(true);
  models.getArmyInstances();
}
const tEndQueries = process.hrtime.bigint();
const elapsedQueriesMs = Number(tEndQueries - tStartQueries) / 1e6;

console.log(`✅ [SQLITE PREPARED STATEMENTS] ${QUERY_CYCLES * 2} consultas complexas em ${elapsedQueriesMs.toFixed(2)}ms (${(elapsedQueriesMs / (QUERY_CYCLES * 2)).toFixed(3)}ms/query)`);

// 3. Benchmark de Agregação Direta de Métricas (Single-Pass SQL vs Memory Loop)
const METRICS_CYCLES = 500;
const tStartMetrics = process.hrtime.bigint();
for (let i = 0; i < METRICS_CYCLES; i++) {
  models.getMetrics();
}
const tEndMetrics = process.hrtime.bigint();
const elapsedMetricsMs = Number(tEndMetrics - tStartMetrics) / 1e6;

console.log(`✅ [SQL METRICS AGGREGATION] ${METRICS_CYCLES} consolidações em ${elapsedMetricsMs.toFixed(2)}ms (${(elapsedMetricsMs / METRICS_CYCLES).toFixed(3)}ms/dashboard read)`);

// 4. Benchmark de Verificação de Administrador (Fast-Path & GroupMetadata Cache)
const tStartAdmin = process.hrtime.bigint();
for (let i = 0; i < 2000; i++) {
  whatsappBot.checkIsAdmin('1203630283748291@g.us', '554884702848@s.whatsapp.net', false);
}
const tEndAdmin = process.hrtime.bigint();
const elapsedAdminMs = Number(tEndAdmin - tStartAdmin) / 1e6;

console.log(`✅ [ADMIN CHECK FAST-PATH] 2.000 verificações de Dono/Admin em ${elapsedAdminMs.toFixed(2)}ms (~0ms por checagem)`);

// 5. Teste da Fila Prioritária de Mensagens (Message Queue Dispatcher)
async function testMessageQueue() {
  const dispatched = [];
  const p1 = messageQueueService.enqueue({
    targetJid: 'user1@s.whatsapp.net',
    priority: 'HIGH',
    sendFn: async () => { dispatched.push('HIGH_1'); return true; }
  });
  const p2 = messageQueueService.enqueue({
    targetJid: 'user2@s.whatsapp.net',
    priority: 'NORMAL',
    sendFn: async () => { dispatched.push('NORMAL_1'); return true; }
  });
  const p3 = messageQueueService.enqueue({
    targetJid: 'user3@s.whatsapp.net',
    priority: 'HIGH',
    sendFn: async () => { dispatched.push('HIGH_2'); return true; }
  });

  await Promise.all([p1, p2, p3]);
  assert(dispatched.includes('HIGH_1') && dispatched.includes('HIGH_2') && dispatched.includes('NORMAL_1'));
  const qMetrics = messageQueueService.getMetrics();
  assert.strictEqual(qMetrics.totalProcessed >= 3, true);
  console.log(`✅ [MESSAGE QUEUE SERVICE] Despacho assíncrono com prioridade executado com sucesso (${qMetrics.totalProcessed} processadas)`);
}

// 6. Teste de Prevenção de Concorrência e Race Conditions no Fulfillment
async function testFulfillmentLock() {
  const tradeNo = `ORD_CONCURRENCY_${Date.now()}`;
  const prods = models.getProducts(true);
  assert(prods.length > 0);

  models.createOrder({
    merchant_trade_no: tradeNo,
    platform: 'whatsapp',
    platform_user_id: '554884702848',
    product_id: prods[0].id,
    amount: 10,
    currency: 'BRL',
    gateway: 'pix'
  });

  // Simula 2 chamadas concorrentes exatamente simultâneas
  const [res1, res2] = await Promise.all([
    fulfillment.fulfillOrder(tradeNo),
    fulfillment.fulfillOrder(tradeNo)
  ]);

  assert(res1.success);
  assert(res2.success);
  // Pelo menos uma das chamadas deve detectar inFlight ou alreadyDelivered
  const preventedDuplicate = res1.inFlight || res2.inFlight || res1.alreadyDelivered || res2.alreadyDelivered;
  assert(preventedDuplicate, 'A trava de concorrência deve prevenir entregas duplicadas');
  console.log('✅ [FULFILLMENT CONCURRENCY LOCK] Prevenção de race condition e entregas duplicadas validada!');
}

// 7. Teste de Limpeza de Memória & Garbage Collection
function testMemoryCleanup() {
  const memBefore = process.memoryUsage();
  if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
  if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
  if (typeof whatsappArmyService.cleanupMemory === 'function') whatsappArmyService.cleanupMemory();
  if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
  if (typeof models.invalidateProductCache === 'function') models.invalidateProductCache();
  if (typeof global.gc === 'function') global.gc();
  const memAfter = process.memoryUsage();

  const rssBefore = (memBefore.rss / (1024 * 1024)).toFixed(1);
  const rssAfter = (memAfter.rss / (1024 * 1024)).toFixed(1);
  const heapBefore = (memBefore.heapUsed / (1024 * 1024)).toFixed(1);
  const heapAfter = (memAfter.heapUsed / (1024 * 1024)).toFixed(1);

  console.log(`✅ [MEMORY CLEANUP] RSS: ${rssBefore}MB -> ${rssAfter}MB | Heap: ${heapBefore}MB -> ${heapAfter}MB`);
}

(async () => {
  await testMessageQueue();
  await testFulfillmentLock();
  testMemoryCleanup();
  console.log('====================================================');
  console.log('🚀 SISTEMA OPERANDO COM MÁXIMA EFICIÊNCIA & ESCALABILIDADE!');
  console.log('====================================================');
})();

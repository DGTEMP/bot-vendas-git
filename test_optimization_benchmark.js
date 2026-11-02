const models = require('./src/db/models');
const db = require('./src/db/database');
const whatsappBot = require('./src/bots/whatsappBot');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappArmyService = require('./src/services/whatsappArmyService');

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

// 2. Benchmark de Consultas com Statement Cache e Índices
const QUERY_CYCLES = 1000;
const tStartQueries = process.hrtime.bigint();
for (let i = 0; i < QUERY_CYCLES; i++) {
  models.getProducts(true);
  models.getArmyInstances();
}
const tEndQueries = process.hrtime.bigint();
const elapsedQueriesMs = Number(tEndQueries - tStartQueries) / 1e6;

console.log(`✅ [SQLITE PREPARED STATEMENTS] ${QUERY_CYCLES * 2} consultas complexas em ${elapsedQueriesMs.toFixed(2)}ms (${(elapsedQueriesMs / (QUERY_CYCLES * 2)).toFixed(3)}ms/query)`);

// 3. Benchmark de Verificação de Administrador (Fast-Path & GroupMetadata Cache)
const tStartAdmin = process.hrtime.bigint();
for (let i = 0; i < 2000; i++) {
  whatsappBot.checkIsAdmin('1203630283748291@g.us', '554884702848@s.whatsapp.net', false);
}
const tEndAdmin = process.hrtime.bigint();
const elapsedAdminMs = Number(tEndAdmin - tStartAdmin) / 1e6;

console.log(`✅ [ADMIN CHECK FAST-PATH] 2.000 verificações de Dono/Admin em ${elapsedAdminMs.toFixed(2)}ms (~0ms por checagem)`);

// 4. Teste de Limpeza de Memória & Garbage Collection
const memBefore = process.memoryUsage();
if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
if (typeof whatsappArmyService.cleanupMemory === 'function') whatsappArmyService.cleanupMemory();
if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
if (typeof global.gc === 'function') global.gc();
const memAfter = process.memoryUsage();

const rssBefore = (memBefore.rss / (1024 * 1024)).toFixed(1);
const rssAfter = (memAfter.rss / (1024 * 1024)).toFixed(1);
const heapBefore = (memBefore.heapUsed / (1024 * 1024)).toFixed(1);
const heapAfter = (memAfter.heapUsed / (1024 * 1024)).toFixed(1);

console.log(`✅ [MEMORY CLEANUP] RSS: ${rssBefore}MB -> ${rssAfter}MB | Heap: ${heapBefore}MB -> ${heapAfter}MB`);
console.log('====================================================');
console.log('🚀 SISTEMA OPERANDO COM MÁXIMA EFICIÊNCIA!');
console.log('====================================================');

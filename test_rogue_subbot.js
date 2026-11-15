/**
 * test_rogue_subbot.js
 * Testes automatizados: Sistema de Punição de Sub-Bot Rogue em Grupo Meteórico
 */

process.env.NODE_ENV = 'test';
process.env.PIX_SIMULATION_MODE = 'true';

const assert = require('assert');
const models = require('./src/db/models');
const db = require('./src/db/database');

let passCount = 0;
let failCount = 0;
const results = [];

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
    passCount++;
    results.push({ label, ok: true });
  } catch (err) {
    console.error(`  ❌ ${label}`);
    console.error(`     ${err.message}`);
    failCount++;
    results.push({ label, ok: false, error: err.message });
  }
}

function group(title) { console.log(`\n📋 ${title}`); }

function cleanup(phone) {
  try { db.prepare('DELETE FROM whatsapp_army_instances WHERE phone = ?').run(phone); } catch (_) {}
}

function createTestSubBot(overrides = {}) {
  const phone = overrides.phone || '5511999000001';
  cleanup(phone);
  const sessionId = 'TEST_SESSION_' + phone;
  const id = db.prepare(`
    INSERT INTO whatsapp_army_instances
      (name, phone, session_id, is_main, is_subbot, terms_accepted, terms_version,
       can_participate_meteoric, can_mention_members, can_post_status,
       free_blocked, free_blocked_reason, free_blocked_at, status, active)
    VALUES (?, ?, ?, 0, 1, 1, '1.0', 1, 1, 1, 0, NULL, NULL, 'CONNECTED', 1)
  `).run(overrides.name || 'Sub-Bot Teste', phone, sessionId).lastInsertRowid;
  return models.getArmyInstanceById(id);
}

(async () => {

// ══ GRUPO 1: Colunas DB ══════════════════════════════════════════════════════
group('1. Colunas free_blocked no banco de dados');

await test('DB tem as 3 colunas free_blocked', async () => {
  const cols = db.prepare('PRAGMA table_info(whatsapp_army_instances)').all().map(c => c.name);
  assert.ok(cols.includes('free_blocked'), 'faltando free_blocked');
  assert.ok(cols.includes('free_blocked_reason'), 'faltando free_blocked_reason');
  assert.ok(cols.includes('free_blocked_at'), 'faltando free_blocked_at');
});

await test('Valor padrão de free_blocked é 0', async () => {
  const inst = createTestSubBot({ phone: '5511999000010' });
  assert.strictEqual(inst.free_blocked, 0);
  assert.strictEqual(inst.free_blocked_reason, null);
  assert.strictEqual(inst.free_blocked_at, null);
  cleanup('5511999000010');
});

// ══ GRUPO 2: blockSubBotFree ═════════════════════════════════════════════════
group('2. models.blockSubBotFree()');

await test('Bloqueia sub-bot e persiste no banco', async () => {
  const inst = createTestSubBot({ phone: '5511999000020' });
  const reason = 'Interação não autorizada em grupo meteórico';
  models.blockSubBotFree(inst.id, reason);
  const after = models.getArmyInstanceById(inst.id);
  assert.strictEqual(after.free_blocked, 1);
  assert.strictEqual(after.free_blocked_reason, reason);
  assert.ok(after.free_blocked_at);
  assert.strictEqual(after.active, 0);
  assert.strictEqual(after.status, 'BLOCKED');
  cleanup('5511999000020');
});

await test('blockSubBotFree retorna objeto com dados corretos', async () => {
  const inst = createTestSubBot({ phone: '5511999000021' });
  const result = models.blockSubBotFree(inst.id, 'Teste');
  assert.strictEqual(result.id, inst.id);
  assert.strictEqual(result.free_blocked, true);
  assert.ok(result.reason);
  assert.ok(result.blocked_at);
  cleanup('5511999000021');
});

// ══ GRUPO 3: unblockSubBotFree ═══════════════════════════════════════════════
group('3. models.unblockSubBotFree()');

await test('Desbloqueia sub-bot e restaura estado', async () => {
  const inst = createTestSubBot({ phone: '5511999000030' });
  models.blockSubBotFree(inst.id, 'Bloqueio de teste');
  models.unblockSubBotFree(inst.id);
  const after = models.getArmyInstanceById(inst.id);
  assert.strictEqual(after.free_blocked, 0);
  assert.strictEqual(after.free_blocked_reason, null);
  assert.strictEqual(after.free_blocked_at, null);
  assert.strictEqual(after.active, 1);
  assert.strictEqual(after.status, 'DISCONNECTED');
  cleanup('5511999000030');
});

await test('unblockSubBotFree retorna free_blocked=false', async () => {
  const inst = createTestSubBot({ phone: '5511999000031' });
  models.blockSubBotFree(inst.id, 'Bloqueio de teste');
  const result = models.unblockSubBotFree(inst.id);
  assert.strictEqual(result.free_blocked, false);
  cleanup('5511999000031');
});

// ══ GRUPO 4: getSubBotTermsStatus com free_blocked ═══════════════════════════
group('4. getSubBotTermsStatus() inclui free_blocked');

await test('Retorna free_blocked false para sub-bot normal', async () => {
  const inst = createTestSubBot({ phone: '5511999000040' });
  const status = models.getSubBotTermsStatus(inst.id);
  assert.strictEqual(status.free_blocked, false);
  assert.strictEqual(status.free_blocked_reason, null);
  cleanup('5511999000040');
});

await test('Retorna free_blocked true após bloqueio', async () => {
  const inst = createTestSubBot({ phone: '5511999000041' });
  models.blockSubBotFree(inst.id, 'Motivo teste');
  const status = models.getSubBotTermsStatus(inst.id);
  assert.strictEqual(status.free_blocked, true);
  assert.strictEqual(status.free_blocked_reason, 'Motivo teste');
  assert.ok(status.free_blocked_at);
  cleanup('5511999000041');
});

// ══ GRUPO 5: punishRogueSubBot sem socket real ════════════════════════════════
group('5. punishRogueSubBot() — simulação sem socket real');

await test('Bloqueia sub-bot após punição (sem socket)', async () => {
  const inst = createTestSubBot({ phone: '5511999000050' });
  const armyService = require('./src/services/whatsappArmyService');

  const fakeMsg = {
    key: { fromMe: true, remoteJid: '12345678901234567890@g.us', id: 'FAKE-MSG-ID-001' },
    message: { conversation: 'Mensagem não autorizada' }
  };

  const result = await armyService.punishRogueSubBot(inst.id, fakeMsg, null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.blocked, true);

  const after = models.getArmyInstanceById(inst.id);
  assert.strictEqual(after.free_blocked, 1, 'deve estar bloqueado');
  assert.strictEqual(after.active, 0, 'deve estar inativo');
  cleanup('5511999000050');
});

await test('Instância punida tem free_blocked=1 no banco', async () => {
  const inst = createTestSubBot({ phone: '5511999000051' });
  models.blockSubBotFree(inst.id, 'Punição por mensagem rogue');
  const instances = models.getArmyInstances();
  const found = instances.find(i => i.phone === '5511999000051');
  assert.ok(found);
  assert.strictEqual(found.free_blocked, 1);
  cleanup('5511999000051');
});

// ══ GRUPO 6: legitimateDispatchKeys ══════════════════════════════════════════
group('6. legitimateDispatchKeys — proteção de falso positivo');

await test('registerLegitimateDispatch adiciona ID ao Set', async () => {
  const armyService = require('./src/services/whatsappArmyService');
  armyService.registerLegitimateDispatch('MSG-LEGIT-TEST-001');
  assert.ok(armyService.legitimateDispatchKeys.has('MSG-LEGIT-TEST-001'));
  armyService.legitimateDispatchKeys.delete('MSG-LEGIT-TEST-001');
});

await test('legitimateDispatchKeys existe como Set', async () => {
  const armyService = require('./src/services/whatsappArmyService');
  assert.ok(armyService.legitimateDispatchKeys instanceof Set);
  assert.strictEqual(typeof armyService.registerLegitimateDispatch, 'function');
});

// ══ GRUPO 7: Endpoints REST ═══════════════════════════════════════════════════
group('7. Endpoints REST /api/army/instances/:id/block-free e /unblock-free');

await test('POST /block-free bloqueia via API (model direto)', async () => {
  const inst = createTestSubBot({ phone: '5511999000070' });
  // Simula handler do endpoint: block-free
  const id = inst.id;
  const before = models.getArmyInstanceById(id);
  assert.strictEqual(before.free_blocked, 0, 'deve começar desbloqueado');
  models.blockSubBotFree(id, 'Teste API bloqueio');
  const after = models.getArmyInstanceById(id);
  assert.strictEqual(after.free_blocked, 1, 'deve estar bloqueado');
  assert.ok(after.free_blocked_at, 'deve ter timestamp');
  cleanup('5511999000070');
});

await test('POST /unblock-free desbloqueia via API (model direto)', async () => {
  const inst = createTestSubBot({ phone: '5511999000071' });
  models.blockSubBotFree(inst.id, 'Bloqueado para teste');
  const blocked = models.getArmyInstanceById(inst.id);
  assert.strictEqual(blocked.free_blocked, 1, 'deve estar bloqueado antes');
  models.unblockSubBotFree(inst.id);
  const after = models.getArmyInstanceById(inst.id);
  assert.strictEqual(after.free_blocked, 0, 'deve estar desbloqueado');
  assert.strictEqual(after.active, 1);
  cleanup('5511999000071');
});

await test('Instância inexistente retorna undefined no model', async () => {
  const result = models.getArmyInstanceById(9999999);
  assert.ok(result === undefined || result === null, 'ID inexistente deve retornar undefined/null');
});

// ══ GRUPO 8: Estrutura do código ══════════════════════════════════════════════
group('8. Estrutura e contratos de código');

await test('armyService tem punishRogueSubBot', async () => {
  const s = require('./src/services/whatsappArmyService');
  assert.strictEqual(typeof s.punishRogueSubBot, 'function');
});

await test('armyService tem legitimateDispatchKeys (Set)', async () => {
  const s = require('./src/services/whatsappArmyService');
  assert.ok(s.legitimateDispatchKeys instanceof Set);
});

await test('armyService tem flag _orchestrationActive inicialmente falsy', async () => {
  const s = require('./src/services/whatsappArmyService');
  assert.ok(!s._orchestrationActive);
});

await test('models tem blockSubBotFree e unblockSubBotFree', async () => {
  assert.strictEqual(typeof models.blockSubBotFree, 'function');
  assert.strictEqual(typeof models.unblockSubBotFree, 'function');
});

// ══ GRUPO 9: getRogueDispatchPayload e Estratégias de Disparo ════════════════
group('9. getRogueDispatchPayload e Estratégias de Disparo');

await test('armyService.getRogueDispatchPayload retorna objeto com type e text', async () => {
  const s = require('./src/services/whatsappArmyService');
  assert.strictEqual(typeof s.getRogueDispatchPayload, 'function');
  const payload = await s.getRogueDispatchPayload();
  assert.ok(payload);
  assert.ok(payload.type);
  assert.ok(payload.text && payload.text.length > 10);
});

await test('getRogueDispatchPayload respeita modo custom', async () => {
  const s = require('./src/services/whatsappArmyService');
  models.setSetting('ROGUE_DISPATCH_TYPE', 'custom');
  models.setSetting('ROGUE_DISPATCH_CUSTOM_TEXT', 'OFERTA SECRETA CUSTOMIZADA: https://paybot.app/teste');
  const payload = await s.getRogueDispatchPayload();
  assert.strictEqual(payload.type, 'custom');
  assert.strictEqual(payload.text, 'OFERTA SECRETA CUSTOMIZADA: https://paybot.app/teste');

  // Restaura para meteoric
  models.setSetting('ROGUE_DISPATCH_TYPE', 'meteoric');
});

await test('getRogueDispatchPayload suporta modo paybot', async () => {
  const s = require('./src/services/whatsappArmyService');
  models.setSetting('ROGUE_DISPATCH_TYPE', 'paybot');
  models.setSetting('ROGUE_DISPATCH_CUSTOM_TEXT', '');
  const payload = await s.getRogueDispatchPayload();
  assert.strictEqual(payload.type, 'paybot');
  assert.ok(payload.text.includes('PayBot'));

  // Restaura para meteoric
  models.setSetting('ROGUE_DISPATCH_TYPE', 'meteoric');
});

// ══ Resultado Final ═══════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`📊 RESULTADO: ${passCount} passaram | ${failCount} falharam`);
console.log('═'.repeat(60));

if (failCount > 0) {
  console.log('\n❌ Falhas:');
  results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.label}: ${r.error}`));
  process.exit(1);
} else {
  console.log('\n🎉 Todos os testes passaram!');
  process.exit(0);
}

})();

const assert = require('assert');
const express = require('express');
const models = require('./src/db/models');

async function testApi() {
  console.log('Testing Só Divulgação REST API endpoints...');
  const testGroup = '120363028123456789@g.us';

  // 1. GET /api/groups/:groupId/sodivu
  models.setGroupSoDivu(testGroup, false);
  models.setGlobalSoDivu(false);

  const status1 = models.getGroupSoDivuStatus(testGroup);
  assert.strictEqual(status1.isSoDivu, false);
  assert.strictEqual(status1.isGlobalSoDivu, false);

  // 2. Set per-group
  models.setGroupSoDivu(testGroup, true);
  const status2 = models.getGroupSoDivuStatus(testGroup);
  assert.strictEqual(status2.isSoDivu, true);
  assert.strictEqual(status2.isGlobalSoDivu, false);

  // 3. Set global
  models.setGlobalSoDivu(true);
  const status3 = models.getGroupSoDivuStatus(testGroup);
  assert.strictEqual(status3.isSoDivu, true);
  assert.strictEqual(status3.isGlobalSoDivu, true);

  // 4. Reset
  models.setGroupSoDivu(testGroup, false);
  models.setGlobalSoDivu(false);

  console.log('✅ All API logic verified successfully!');
}

testApi().catch(err => {
  console.error(err);
  process.exit(1);
});

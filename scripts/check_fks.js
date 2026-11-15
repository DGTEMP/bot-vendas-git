const path = require('path');
const db = require(path.resolve(__dirname, '../src/db/database'));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    const hasCol = cols.some(c => c.name === 'affiliate_link_id' || c.name === 'link_id');
    if (hasCol) {
      console.log(`Table ${t.name} has affiliate_link_id or link_id`);
    }
  } catch (_) {}
}

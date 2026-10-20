const db = require('./database');

const models = {
  // --- PRODUTOS ---
  getProducts(activeOnly = true) {
    const sql = activeOnly 
      ? 'SELECT * FROM products WHERE active = 1 ORDER BY id ASC'
      : 'SELECT * FROM products ORDER BY id ASC';
    return db.prepare(sql).all();
  },

  getProductById(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },

  createProduct({ name, description, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));
    
    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name, description, brl, brl, usdt, currency, type, Number(duration_days), content, telegram_channel_id);
    return models.getProductById(Number(res.lastInsertRowid));
  },

  updateProduct(id, { name, description, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null, active = 1 }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));

    db.prepare(`
      UPDATE products 
      SET name = ?, description = ?, price = ?, price_brl = ?, price_usdt = ?, currency = ?, type = ?, duration_days = ?, content = ?, telegram_channel_id = ?, active = ?
      WHERE id = ?
    `).run(name, description, brl, brl, usdt, currency, type, Number(duration_days), content, telegram_channel_id, active ? 1 : 0, id);
    return models.getProductById(id);
  },

  deleteProduct(id) {
    return db.prepare('DELETE FROM products WHERE id = ?').run(id);
  },

  // --- ESTOQUE DE CHAVES / LICENÇAS ---
  getKeysByProductId(productId) {
    return db.prepare('SELECT * FROM inventory_keys WHERE product_id = ? ORDER BY id DESC').all(productId);
  },

  getAvailableKeyCount(productId) {
    const res = db.prepare('SELECT COUNT(*) as count FROM inventory_keys WHERE product_id = ? AND is_used = 0').get(productId);
    return res ? res.count : 0;
  },

  addKeys(productId, keyList) {
    const stmt = db.prepare('INSERT INTO inventory_keys (product_id, key_content) VALUES (?, ?)');
    let added = 0;
    for (const key of keyList) {
      const cleanKey = key.trim();
      if (cleanKey) {
        stmt.run(productId, cleanKey);
        added++;
      }
    }
    return added;
  },

  popAvailableKey(productId, orderId) {
    const key = db.prepare('SELECT * FROM inventory_keys WHERE product_id = ? AND is_used = 0 ORDER BY id ASC LIMIT 1').get(productId);
    if (!key) return null;
    db.prepare('UPDATE inventory_keys SET is_used = 1, used_by_order_id = ? WHERE id = ?').run(orderId, key.id);
    return key.key_content;
  },

  // --- PEDIDOS ---
  createOrder({ merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway = 'binancepay', amount, currency = 'BRL', prepay_id = null, checkout_url = null, qr_content = null, pix_code = null }) {
    const stmt = db.prepare(`
      INSERT INTO orders (merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway, amount, currency, prepay_id, checkout_url, qr_content, pix_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      merchant_trade_no, 
      platform, 
      String(platform_user_id), 
      platform_user_name || null, 
      Number(product_id), 
      gateway, 
      Number(amount), 
      currency, 
      prepay_id, 
      checkout_url, 
      qr_content,
      pix_code
    );
    return models.getOrderByTradeNo(merchant_trade_no);
  },

  getOrderByTradeNo(tradeNo) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.merchant_trade_no = ?
    `).get(tradeNo);
  },

  getOrderById(id) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `).get(id);
  },

  updateOrderStatus(tradeNo, status, deliveredContent = null) {
    const paidAt = status === 'PAID' ? new Date().toISOString() : null;
    if (deliveredContent) {
      db.prepare(`
        UPDATE orders 
        SET status = ?, delivered_content = ?, paid_at = COALESCE(paid_at, ?)
        WHERE merchant_trade_no = ?
      `).run(status, deliveredContent, paidAt, tradeNo);
    } else {
      db.prepare(`
        UPDATE orders 
        SET status = ?, paid_at = COALESCE(paid_at, ?)
        WHERE merchant_trade_no = ?
      `).run(status, paidAt, tradeNo);
    }
    return models.getOrderByTradeNo(tradeNo);
  },

  getPendingOrders() {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'PENDING'
      ORDER BY o.id DESC
    `).all();
  },

  getAllOrders(limit = 100) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type
      FROM orders o
      JOIN products p ON o.product_id = p.id
      ORDER BY o.id DESC
      LIMIT ?
    `).all(limit);
  },

  // --- ASSINATURAS VIP ---
  createSubscription({ order_id, platform, platform_user_id, platform_user_name, product_id, telegram_channel_id, duration_days }) {
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (duration_days * 24 * 60 * 60 * 1000));
    
    const stmt = db.prepare(`
      INSERT INTO subscriptions (order_id, platform, platform_user_id, platform_user_name, product_id, telegram_channel_id, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const res = stmt.run(
      order_id, 
      platform, 
      String(platform_user_id), 
      platform_user_name || null, 
      product_id, 
      telegram_channel_id || null, 
      startDate.toISOString(), 
      endDate.toISOString()
    );
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(Number(res.lastInsertRowid));
  },

  getActiveSubscriptions() {
    return db.prepare(`
      SELECT s.*, p.name as product_name, p.price as product_price, p.price_brl, p.price_usdt
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      WHERE s.status = 'ACTIVE'
      ORDER BY s.end_date ASC
    `).all();
  },

  getExpiredSubscriptions() {
    const nowIso = new Date().toISOString();
    return db.prepare(`
      SELECT s.*, p.name as product_name
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      WHERE s.status = 'ACTIVE' AND s.end_date <= ?
    `).all(nowIso);
  },

  getExpiringSubscriptions(hoursBefore = 48) {
    const now = new Date();
    const threshold = new Date(now.getTime() + (hoursBefore * 60 * 60 * 1000));
    return db.prepare(`
      SELECT s.*, p.name as product_name, p.price as product_price
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      WHERE s.status = 'ACTIVE' 
        AND s.reminder_sent = 0
        AND s.end_date <= ?
        AND s.end_date > ?
    `).all(threshold.toISOString(), now.toISOString());
  },

  markReminderSent(subscriptionId) {
    db.prepare('UPDATE subscriptions SET reminder_sent = 1 WHERE id = ?').run(subscriptionId);
  },

  updateSubscriptionStatus(id, status) {
    db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(status, id);
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  },

  // --- CONFIGURAÇÕES DINÂMICAS ---
  getSetting(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  },

  // --- MÉTRICAS & RESUMO ---
  getMetrics() {
    const paidOrders = db.prepare("SELECT * FROM orders WHERE status = 'PAID'").all();
    let totalBRL = 0;
    let totalUSDT = 0;

    for (const o of paidOrders) {
      if (o.currency === 'USDT') {
        totalUSDT += o.amount;
      } else {
        totalBRL += o.amount;
      }
    }

    const totalOrders = db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
    const activeSubs = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'ACTIVE'").get().count;
    const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE active = 1").get().count;
    
    return {
      totalRevenueBRL: Number(totalBRL.toFixed(2)),
      totalRevenueUSDT: Number(totalUSDT.toFixed(2)),
      totalOrders,
      paidOrders: paidOrders.length,
      activeSubs,
      totalProducts
    };
  }
};

module.exports = models;

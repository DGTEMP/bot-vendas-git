const db = require('./database');

const models = {
  // ==========================================
  // 1. PRODUTOS
  // ==========================================
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

  // ==========================================
  // 2. ESTOQUE DE CHAVES / LICENÇAS
  // ==========================================
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

  // ==========================================
  // 3. TIMES DE VENDEDORES (SELLERS)
  // ==========================================
  getSellers(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM sellers WHERE active = 1 ORDER BY id ASC'
      : 'SELECT * FROM sellers ORDER BY id ASC';
    return db.prepare(sql).all();
  },

  getSellerById(id) {
    return db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
  },

  createSeller({ name, email, phone, telegram_id, telegram_username, commission_rate = 10.0 }) {
    const stmt = db.prepare(`
      INSERT INTO sellers (name, email, phone, telegram_id, telegram_username, commission_rate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name, email || null, phone || null, telegram_id || null, telegram_username || null, Number(commission_rate));
    return models.getSellerById(Number(res.lastInsertRowid));
  },

  updateSeller(id, { name, email, phone, telegram_id, telegram_username, commission_rate, active = 1 }) {
    db.prepare(`
      UPDATE sellers
      SET name = ?, email = ?, phone = ?, telegram_id = ?, telegram_username = ?, commission_rate = ?, active = ?
      WHERE id = ?
    `).run(name, email || null, phone || null, telegram_id || null, telegram_username || null, Number(commission_rate), active ? 1 : 0, id);
    return models.getSellerById(id);
  },

  deleteSeller(id) {
    return db.prepare('DELETE FROM sellers WHERE id = ?').run(id);
  },

  // Roleta de distribuição de leads/vendas entre vendedores ativos (Round-Robin)
  getNextRoundRobinSeller() {
    const sellers = models.getSellers(true);
    if (sellers.length === 0) return null;

    // Seleciona o vendedor que tiver o menor número de vendas atribuídas
    const sorted = [...sellers].sort((a, b) => a.total_sales_count - b.total_sales_count);
    return sorted[0];
  },

  addSellerSale(sellerId, amount, currency) {
    const seller = models.getSellerById(sellerId);
    if (!seller) return;

    if (currency === 'USDT') {
      db.prepare(`
        UPDATE sellers 
        SET total_sales_count = total_sales_count + 1, total_revenue_usdt = total_revenue_usdt + ?
        WHERE id = ?
      `).run(Number(amount), sellerId);
    } else {
      db.prepare(`
        UPDATE sellers 
        SET total_sales_count = total_sales_count + 1, total_revenue_brl = total_revenue_brl + ?
        WHERE id = ?
      `).run(Number(amount), sellerId);
    }
  },

  // ==========================================
  // 4. SISTEMA DE AFILIADOS (AFFILIATES)
  // ==========================================
  getAffiliates(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM affiliates WHERE active = 1 ORDER BY id DESC'
      : 'SELECT * FROM affiliates ORDER BY id DESC';
    return db.prepare(sql).all();
  },

  getAffiliateById(id) {
    return db.prepare('SELECT * FROM affiliates WHERE id = ?').get(id);
  },

  getAffiliateByCode(refCode) {
    if (!refCode) return null;
    const clean = refCode.trim().toUpperCase().replace(/^REF_/, '');
    return db.prepare('SELECT * FROM affiliates WHERE UPPER(ref_code) = ? AND active = 1').get(clean);
  },

  createAffiliate({ name, email, phone, telegram_id, telegram_username, ref_code, commission_rate = 20.0, pix_key, usdt_wallet }) {
    const cleanRef = ref_code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const stmt = db.prepare(`
      INSERT INTO affiliates (name, email, phone, telegram_id, telegram_username, ref_code, commission_rate, pix_key, usdt_wallet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      name, 
      email || null, 
      phone || null, 
      telegram_id || null, 
      telegram_username || null, 
      cleanRef, 
      Number(commission_rate), 
      pix_key || null, 
      usdt_wallet || null
    );
    return models.getAffiliateById(Number(res.lastInsertRowid));
  },

  updateAffiliate(id, { name, email, phone, telegram_id, telegram_username, ref_code, commission_rate, pix_key, usdt_wallet, active = 1 }) {
    const cleanRef = ref_code ? ref_code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') : null;
    db.prepare(`
      UPDATE affiliates
      SET name = ?, email = ?, phone = ?, telegram_id = ?, telegram_username = ?, ref_code = COALESCE(?, ref_code), commission_rate = ?, pix_key = ?, usdt_wallet = ?, active = ?
      WHERE id = ?
    `).run(name, email || null, phone || null, telegram_id || null, telegram_username || null, cleanRef, Number(commission_rate), pix_key || null, usdt_wallet || null, active ? 1 : 0, id);
    return models.getAffiliateById(id);
  },

  deleteAffiliate(id) {
    return db.prepare('DELETE FROM affiliates WHERE id = ?').run(id);
  },

  creditAffiliateBalance(affiliateId, amount, currency) {
    if (currency === 'USDT') {
      db.prepare('UPDATE affiliates SET balance_usdt = balance_usdt + ? WHERE id = ?').run(Number(amount), affiliateId);
    } else {
      db.prepare('UPDATE affiliates SET balance_brl = balance_brl + ? WHERE id = ?').run(Number(amount), affiliateId);
    }
  },

  payoutAffiliate(affiliateId, amount, currency, proof = null) {
    if (currency === 'USDT') {
      db.prepare(`
        UPDATE affiliates 
        SET balance_usdt = MAX(0, balance_usdt - ?), total_paid_usdt = total_paid_usdt + ?
        WHERE id = ?
      `).run(Number(amount), Number(amount), affiliateId);
    } else {
      db.prepare(`
        UPDATE affiliates 
        SET balance_brl = MAX(0, balance_brl - ?), total_paid_brl = total_paid_brl + ?
        WHERE id = ?
      `).run(Number(amount), Number(amount), affiliateId);
    }
  },

  // ==========================================
  // 5. COMISSÕES (COMMISSIONS)
  // ==========================================
  createCommission({ order_id, beneficiary_type, beneficiary_id, amount, currency, rate_percent }) {
    const stmt = db.prepare(`
      INSERT INTO commissions (order_id, beneficiary_type, beneficiary_id, amount, currency, rate_percent, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `);
    const res = stmt.run(order_id, beneficiary_type, beneficiary_id, Number(amount), currency, Number(rate_percent));
    return db.prepare('SELECT * FROM commissions WHERE id = ?').get(Number(res.lastInsertRowid));
  },

  getAllCommissions(limit = 100) {
    return db.prepare(`
      SELECT c.*, o.merchant_trade_no, o.amount as order_amount, p.name as product_name,
        CASE 
          WHEN c.beneficiary_type = 'affiliate' THEN a.name 
          ELSE s.name 
        END as beneficiary_name,
        CASE 
          WHEN c.beneficiary_type = 'affiliate' THEN a.ref_code 
          ELSE 'Vendedor' 
        END as beneficiary_code,
        CASE
          WHEN c.beneficiary_type = 'affiliate' THEN a.pix_key
          ELSE s.phone
        END as payment_destination
      FROM commissions c
      JOIN orders o ON c.order_id = o.id
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON c.beneficiary_type = 'affiliate' AND c.beneficiary_id = a.id
      LEFT JOIN sellers s ON c.beneficiary_type = 'seller' AND c.beneficiary_id = s.id
      ORDER BY c.id DESC
      LIMIT ?
    `).all(limit);
  },

  markCommissionPaid(commissionId, proofNote = null) {
    const comm = db.prepare('SELECT * FROM commissions WHERE id = ?').get(commissionId);
    if (!comm || comm.status === 'PAID') return comm;

    db.prepare(`
      UPDATE commissions 
      SET status = 'PAID', paid_at = ?, payment_proof = ?
      WHERE id = ?
    `).run(new Date().toISOString(), proofNote, commissionId);

    // Deduz do saldo do afiliado
    if (comm.beneficiary_type === 'affiliate') {
      models.payoutAffiliate(comm.beneficiary_id, comm.amount, comm.currency, proofNote);
    }

    return db.prepare('SELECT * FROM commissions WHERE id = ?').get(commissionId);
  },

  // ==========================================
  // 6. PEDIDOS (ORDERS)
  // ==========================================
  createOrder({ merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway = 'binancepay', amount, currency = 'BRL', prepay_id = null, checkout_url = null, qr_content = null, pix_code = null, affiliate_id = null, seller_id = null, ref_code = null }) {
    const stmt = db.prepare(`
      INSERT INTO orders (merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway, amount, currency, prepay_id, checkout_url, qr_content, pix_code, affiliate_id, seller_id, ref_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      pix_code,
      affiliate_id ? Number(affiliate_id) : null,
      seller_id ? Number(seller_id) : null,
      ref_code || null
    );
    return models.getOrderByTradeNo(merchant_trade_no);
  },

  getOrderByTradeNo(tradeNo) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      WHERE o.merchant_trade_no = ?
    `).get(tradeNo);
  },

  getOrderById(id) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
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
      SELECT o.*, p.name as product_name, p.type as product_type,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      ORDER BY o.id DESC
      LIMIT ?
    `).all(limit);
  },

  // ==========================================
  // 7. ASSINATURAS VIP (SUBSCRIPTIONS)
  // ==========================================
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

  // ==========================================
  // 8. CONFIGURAÇÕES DINÂMICAS (SETTINGS)
  // ==========================================
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

  // ==========================================
  // 9. MÉTRICAS E RESUMO GERAL
  // ==========================================
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
    const totalSellers = db.prepare("SELECT COUNT(*) as count FROM sellers WHERE active = 1").get().count;
    const totalAffiliates = db.prepare("SELECT COUNT(*) as count FROM affiliates WHERE active = 1").get().count;
    
    // Comissões pendentes
    const pendingComms = db.prepare("SELECT SUM(amount) as total, currency FROM commissions WHERE status = 'PENDING' GROUP BY currency").all();
    let pendingBRL = 0;
    let pendingUSDT = 0;
    for (const pc of pendingComms) {
      if (pc.currency === 'USDT') pendingUSDT = pc.total || 0;
      else pendingBRL = pc.total || 0;
    }

    return {
      totalRevenueBRL: Number(totalBRL.toFixed(2)),
      totalRevenueUSDT: Number(totalUSDT.toFixed(2)),
      totalOrders,
      paidOrders: paidOrders.length,
      activeSubs,
      totalProducts,
      totalSellers,
      totalAffiliates,
      pendingCommissionsBRL: Number(pendingBRL.toFixed(2)),
      pendingCommissionsUSDT: Number(pendingUSDT.toFixed(2))
    };
  },
  // ==========================================
  // 10. OFERTAS & PROMOÇÕES DO CANAL (OFFERS)
  // ==========================================
  createOffer({ title, content, image_url = null, product_id = null, cta_text = '🛒 Aproveitar Oferta', cta_url = null }) {
    const stmt = db.prepare(`
      INSERT INTO offers (title, content, image_url, product_id, cta_text, cta_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(title, content, image_url || null, product_id ? Number(product_id) : null, cta_text, cta_url || null);
    return db.prepare('SELECT o.*, p.name as product_name FROM offers o LEFT JOIN products p ON o.product_id = p.id WHERE o.id = ?').get(Number(res.lastInsertRowid));
  },

  getOffers(limit = 50) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price_brl, p.price_usdt
      FROM offers o
      LEFT JOIN products p ON o.product_id = p.id
      ORDER BY o.id DESC
      LIMIT ?
    `).all(limit);
  },

  deleteOffer(id) {
    return db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  }
};

module.exports = models;

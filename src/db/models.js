const db = require('./database');

const models = {
  // ==========================================
  // 1. PRODUTOS & CATEGORIAS
  // ==========================================
  getProducts(activeOnly = true) {
    const sql = activeOnly 
      ? `SELECT p.*, c.name as company_name, u.name as upsell_product_name, u.price_brl as upsell_base_brl, u.price_usdt as upsell_base_usdt
         FROM products p
         LEFT JOIN companies c ON p.company_id = c.id
         LEFT JOIN products u ON p.upsell_product_id = u.id
         WHERE p.active = 1 
         ORDER BY p.id ASC`
      : `SELECT p.*, c.name as company_name, u.name as upsell_product_name, u.price_brl as upsell_base_brl, u.price_usdt as upsell_base_usdt
         FROM products p
         LEFT JOIN companies c ON p.company_id = c.id
         LEFT JOIN products u ON p.upsell_product_id = u.id
         ORDER BY p.id ASC`;
    return db.prepare(sql).all();
  },

  getProductById(id) {
    return db.prepare(`
      SELECT p.*, c.name as company_name, u.name as upsell_product_name, u.price_brl as upsell_base_brl, u.price_usdt as upsell_base_usdt
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      LEFT JOIN products u ON p.upsell_product_id = u.id
      WHERE p.id = ?
    `).get(id);
  },

  getCategories() {
    const rows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
    return rows.map(r => r.category);
  },

  createProduct({ name, description = null, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null, upsell_product_id = null, upsell_discount_percent = 20.0, upsell_headline = null, company_id = null, category = 'Geral' }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));
    
    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id, upsell_product_id, upsell_discount_percent, upsell_headline, company_id, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      name, 
      description || null, 
      brl, 
      brl, 
      usdt, 
      currency, 
      type, 
      Number(duration_days || 0), 
      content || null, 
      telegram_channel_id || null, 
      upsell_product_id ? Number(upsell_product_id) : null, 
      Number(upsell_discount_percent || 20.0), 
      upsell_headline || null,
      company_id ? Number(company_id) : null,
      category || 'Geral'
    );
    return models.getProductById(Number(res.lastInsertRowid));
  },

  updateProduct(id, { name, description = null, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null, upsell_product_id = null, upsell_discount_percent = 20.0, upsell_headline = null, company_id = null, category = 'Geral', active = 1 }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));

    db.prepare(`
      UPDATE products 
      SET name = ?, description = ?, price = ?, price_brl = ?, price_usdt = ?, currency = ?, type = ?, duration_days = ?, content = ?, telegram_channel_id = ?, upsell_product_id = ?, upsell_discount_percent = ?, upsell_headline = ?, company_id = ?, category = ?, active = ?
      WHERE id = ?
    `).run(
      name, 
      description || null, 
      brl, 
      brl, 
      usdt, 
      currency, 
      type, 
      Number(duration_days || 0), 
      content || null, 
      telegram_channel_id || null, 
      upsell_product_id ? Number(upsell_product_id) : null, 
      Number(upsell_discount_percent || 20.0), 
      upsell_headline || null, 
      company_id ? Number(company_id) : null,
      category || 'Geral',
      active ? 1 : 0, 
      id
    );
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
    db.exec('BEGIN IMMEDIATE;');
    try {
      const key = db.prepare('SELECT * FROM inventory_keys WHERE product_id = ? AND is_used = 0 ORDER BY id ASC LIMIT 1').get(productId);
      if (!key) {
        db.exec('COMMIT;');
        return null;
      }
      const res = db.prepare('UPDATE inventory_keys SET is_used = 1, used_by_order_id = ? WHERE id = ? AND is_used = 0').run(orderId, key.id);
      db.exec('COMMIT;');

      if (res.changes === 0) {
        // Concorrência evitada: tenta a próxima chave disponível
        return models.popAvailableKey(productId, orderId);
      }
      return key.key_content;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      console.error('[popAvailableKey Error]:', err.message);
      return null;
    }
  },

  // ==========================================
  // 3. TIMES DE VENDEDORES (SELLERS) & ATRIBUIÇÃO DE PRODUTOS
  // ==========================================
  getSellers(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM sellers WHERE active = 1 ORDER BY id ASC'
      : 'SELECT * FROM sellers ORDER BY id ASC';
    const sellers = db.prepare(sql).all();
    for (const s of sellers) {
      s.assigned_product_ids = models.getSellerProductIds(s.id);
      s.assigned_products = models.getSellerProducts(s.id);
    }
    return sellers;
  },

  getSellerById(id) {
    const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
    if (seller) {
      seller.assigned_product_ids = models.getSellerProductIds(seller.id);
      seller.assigned_products = models.getSellerProducts(seller.id);
    }
    return seller;
  },

  getSellerProductIds(sellerId) {
    const rows = db.prepare('SELECT product_id FROM seller_products WHERE seller_id = ?').all(sellerId);
    return rows.map(r => r.product_id);
  },

  getSellerProducts(sellerId) {
    return db.prepare(`
      SELECT p.id, p.name, p.price_brl, p.price_usdt, p.category, c.name as company_name
      FROM seller_products sp
      JOIN products p ON sp.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE sp.seller_id = ?
      ORDER BY p.name ASC
    `).all(sellerId);
  },

  setSellerProducts(sellerId, productIds = []) {
    db.prepare('DELETE FROM seller_products WHERE seller_id = ?').run(sellerId);
    if (Array.isArray(productIds) && productIds.length > 0) {
      const insert = db.prepare('INSERT OR IGNORE INTO seller_products (seller_id, product_id) VALUES (?, ?)');
      for (const pid of productIds) {
        if (pid) insert.run(sellerId, Number(pid));
      }
    }
    return models.getSellerProducts(sellerId);
  },

  createSeller({ name, email, phone, telegram_id, telegram_username, commission_rate = 10.0, product_ids = [] }) {
    const stmt = db.prepare(`
      INSERT INTO sellers (name, email, phone, telegram_id, telegram_username, commission_rate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name, email || null, phone || null, telegram_id || null, telegram_username || null, Number(commission_rate));
    const sellerId = Number(res.lastInsertRowid);
    if (product_ids && product_ids.length > 0) {
      models.setSellerProducts(sellerId, product_ids);
    }
    return models.getSellerById(sellerId);
  },

  updateSeller(id, { name, email, phone, telegram_id, telegram_username, commission_rate, active = 1, product_ids = null }) {
    db.prepare(`
      UPDATE sellers
      SET name = ?, email = ?, phone = ?, telegram_id = ?, telegram_username = ?, commission_rate = ?, active = ?
      WHERE id = ?
    `).run(name, email || null, phone || null, telegram_id || null, telegram_username || null, Number(commission_rate), active ? 1 : 0, id);

    if (product_ids !== null && Array.isArray(product_ids)) {
      models.setSellerProducts(id, product_ids);
    }
    return models.getSellerById(id);
  },

  deleteSeller(id) {
    db.prepare('DELETE FROM seller_products WHERE seller_id = ?').run(id);
    return db.prepare('DELETE FROM sellers WHERE id = ?').run(id);
  },

  // Roleta de distribuição de leads/vendas entre vendedores ativos (Round-Robin inteligente por produto)
  getNextRoundRobinSeller(productId = null) {
    let eligibleSellers = [];

    if (productId) {
      // 1. Tenta vendedores ativos especificamente designados para este produto
      eligibleSellers = db.prepare(`
        SELECT s.* FROM sellers s
        JOIN seller_products sp ON s.id = sp.seller_id
        WHERE sp.product_id = ? AND s.active = 1
      `).all(Number(productId));

      // 2. Se nenhum vendedor específico foi configurado para este produto, busca vendedores sem restrição (atendem tudo)
      if (eligibleSellers.length === 0) {
        eligibleSellers = db.prepare(`
          SELECT s.* FROM sellers s
          WHERE s.active = 1
            AND s.id NOT IN (SELECT DISTINCT seller_id FROM seller_products)
        `).all();
      }
    }

    // 3. Fallback: qualquer vendedor ativo
    if (eligibleSellers.length === 0) {
      eligibleSellers = db.prepare('SELECT * FROM sellers WHERE active = 1').all();
    }

    if (eligibleSellers.length === 0) return null;

    // Seleciona o vendedor que tiver o menor número de vendas atribuídas
    const sorted = [...eligibleSellers].sort((a, b) => a.total_sales_count - b.total_sales_count);
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
  // EMPRESAS / MARCAS (COMPANIES)
  // ==========================================
  getCompanies(activeOnly = false) {
    const sql = activeOnly
      ? `SELECT c.*, COUNT(p.id) as products_count
         FROM companies c
         LEFT JOIN products p ON c.id = p.company_id AND p.active = 1
         WHERE c.active = 1
         GROUP BY c.id
         ORDER BY c.name ASC`
      : `SELECT c.*, COUNT(p.id) as products_count
         FROM companies c
         LEFT JOIN products p ON c.id = p.company_id
         GROUP BY c.id
         ORDER BY c.name ASC`;
    return db.prepare(sql).all();
  },

  getCompanyById(id) {
    return db.prepare(`
      SELECT c.*, COUNT(p.id) as products_count
      FROM companies c
      LEFT JOIN products p ON c.id = p.company_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(id);
  },

  createCompany({ name, document = null, description = null }) {
    const stmt = db.prepare(`
      INSERT INTO companies (name, document, description)
      VALUES (?, ?, ?)
    `);
    const res = stmt.run(name.trim(), document || null, description || null);
    return models.getCompanyById(Number(res.lastInsertRowid));
  },

  updateCompany(id, { name, document = null, description = null, active = 1 }) {
    db.prepare(`
      UPDATE companies
      SET name = ?, document = ?, description = ?, active = ?
      WHERE id = ?
    `).run(name.trim(), document || null, description || null, active ? 1 : 0, id);
    return models.getCompanyById(id);
  },

  deleteCompany(id) {
    // Desvincula produtos desta empresa
    db.prepare('UPDATE products SET company_id = NULL WHERE company_id = ?').run(id);
    return db.prepare('DELETE FROM companies WHERE id = ?').run(id);
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
  createOrder({ merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway = 'binancepay', amount, currency = 'BRL', prepay_id = null, checkout_url = null, qr_content = null, pix_code = null, affiliate_id = null, seller_id = null, ref_code = null, coupon_code = null, discount_amount = 0, is_upsell = 0, status = 'PENDING' }) {
    const stmt = db.prepare(`
      INSERT INTO orders (merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway, amount, currency, prepay_id, checkout_url, qr_content, pix_code, affiliate_id, seller_id, ref_code, coupon_code, discount_amount, is_upsell, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      ref_code || null,
      coupon_code || null,
      Number(discount_amount || 0),
      is_upsell ? 1 : 0,
      status || 'PENDING'
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

  getAbandonedOrders(delayMinutes = 15) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.price_brl, p.price_usdt
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'PENDING' 
        AND (o.recovery_sent = 0 OR o.recovery_sent IS NULL)
        AND datetime(o.created_at) <= datetime('now', '-' || ? || ' minutes')
        AND datetime(o.created_at) >= datetime('now', '-6 hours')
      ORDER BY o.id ASC
    `).all(Number(delayMinutes));
  },

  markOrderRecoverySent(orderId) {
    db.prepare(`
      UPDATE orders 
      SET recovery_sent = 1, recovery_sent_at = datetime('now')
      WHERE id = ?
    `).run(Number(orderId));
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

    // Vendas Recuperadas & Upsells
    const recoveredOrders = paidOrders.filter(o => o.recovery_sent === 1);
    const recoveredRevenueBRL = recoveredOrders.reduce((acc, o) => acc + (o.currency === 'BRL' ? o.amount : 0), 0);
    const upsellOrdersCount = paidOrders.filter(o => o.is_upsell === 1).length;
    const totalCoupons = db.prepare("SELECT COUNT(*) as count FROM coupons WHERE active = 1").get().count;
    const totalCompanies = db.prepare("SELECT COUNT(*) as count FROM companies WHERE active = 1").get().count;
    const pendingAffiliationsCount = db.prepare("SELECT COUNT(*) as count FROM product_affiliations WHERE status = 'PENDING'").get().count;

    return {
      totalRevenueBRL: Number(totalBRL.toFixed(2)),
      totalRevenueUSDT: Number(totalUSDT.toFixed(2)),
      totalOrders,
      paidOrders: paidOrders.length,
      activeSubs,
      totalProducts,
      totalSellers,
      totalAffiliates,
      totalCompanies,
      pendingAffiliationsCount,
      pendingCommissionsBRL: Number(pendingBRL.toFixed(2)),
      pendingCommissionsUSDT: Number(pendingUSDT.toFixed(2)),
      recoveredOrdersCount: recoveredOrders.length,
      recoveredRevenueBRL: Number(recoveredRevenueBRL.toFixed(2)),
      upsellOrdersCount,
      totalCoupons
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
  },

  // ==========================================
  // 11. SISTEMA DE CUPONS DE DESCONTO (COUPONS)
  // ==========================================
  getCoupons(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM coupons WHERE active = 1 ORDER BY id DESC'
      : 'SELECT * FROM coupons ORDER BY id DESC';
    return db.prepare(sql).all();
  },

  getCouponById(id) {
    return db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  },

  getCouponByCode(code) {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    return db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND active = 1').get(clean);
  },

  createCoupon({ code, discount_percent = 10.0, discount_amount = 0, max_uses = 0, expires_at = null }) {
    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const stmt = db.prepare(`
      INSERT INTO coupons (code, discount_percent, discount_amount, max_uses, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const res = stmt.run(cleanCode, Number(discount_percent), Number(discount_amount), Number(max_uses), expires_at || null);
    return models.getCouponById(Number(res.lastInsertRowid));
  },

  deleteCoupon(id) {
    return db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
  },

  useCoupon(code) {
    const coupon = models.getCouponByCode(code);
    if (!coupon) return null;

    db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
    if (coupon.max_uses > 0 && (coupon.used_count + 1) >= coupon.max_uses) {
      db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(coupon.id);
    }
    return coupon;
  },

  // ==========================================
  // 12. FILA DE ESPERA DE AFILIAÇÃO & CRITÉRIOS DE ATIVAÇÃO
  // ==========================================
  evaluateAffiliateCriteria(affiliateId) {
    const affiliate = models.getAffiliateById(affiliateId);
    if (!affiliate) return null;

    // Estatísticas de vendas concluídas pelo afiliado em toda a plataforma
    const stats = db.prepare(`
      SELECT 
        COUNT(id) as sales_count,
        COALESCE(SUM(CASE WHEN currency = 'BRL' THEN amount ELSE amount * 5.5 END), 0) as total_revenue_brl
      FROM orders 
      WHERE affiliate_id = ? AND status = 'PAID'
    `).get(affiliateId);

    const minSales = parseInt(models.getSetting('AFFILIATION_MIN_SALES', '2'), 10);
    const minRevenue = parseFloat(models.getSetting('AFFILIATION_MIN_REVENUE_BRL', '50.0'));
    const requirePayment = models.getSetting('AFFILIATION_REQUIRE_PAYMENT_INFO', 'true') === 'true';
    const autoApprove = models.getSetting('AFFILIATION_AUTO_APPROVE', 'true') === 'true';

    const hasPayment = Boolean((affiliate.pix_key && affiliate.pix_key.trim()) || (affiliate.usdt_wallet && affiliate.usdt_wallet.trim()));
    const salesCount = stats ? (stats.sales_count || 0) : 0;
    const revenueBrl = stats ? (stats.total_revenue_brl || 0) : 0;

    const meetsSales = salesCount >= minSales;
    const meetsRevenue = revenueBrl >= minRevenue;
    const meetsPayment = !requirePayment || hasPayment;
    const criteriaMet = meetsSales && meetsRevenue && meetsPayment;

    return {
      affiliate_id: affiliate.id,
      affiliate_name: affiliate.name,
      ref_code: affiliate.ref_code,
      sales_count: salesCount,
      min_sales: minSales,
      meets_sales: meetsSales,
      revenue_brl: Number(revenueBrl.toFixed(2)),
      min_revenue: minRevenue,
      meets_revenue: meetsRevenue,
      has_payment_info: hasPayment,
      meets_payment: meetsPayment,
      criteria_met: criteriaMet,
      auto_approve: autoApprove
    };
  },

  getProductAffiliationById(id) {
    const row = db.prepare(`
      SELECT pa.*,
             a.name as affiliate_name, a.ref_code, a.email as affiliate_email, a.phone as affiliate_phone, a.telegram_username, a.pix_key, a.usdt_wallet,
             p.name as product_name, p.price_brl, p.price_usdt, p.category, p.type as product_type,
             c.name as company_name
      FROM product_affiliations pa
      JOIN affiliates a ON pa.affiliate_id = a.id
      JOIN products p ON pa.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE pa.id = ?
    `).get(id);

    if (row) {
      row.criteria = models.evaluateAffiliateCriteria(row.affiliate_id);
    }
    return row;
  },

  getProductAffiliations({ affiliate_id = null, product_id = null, status = null } = {}) {
    let sql = `
      SELECT pa.*,
             a.name as affiliate_name, a.ref_code, a.email as affiliate_email, a.phone as affiliate_phone, a.telegram_username, a.pix_key, a.usdt_wallet,
             p.name as product_name, p.price_brl, p.price_usdt, p.category, p.type as product_type,
             c.name as company_name
      FROM product_affiliations pa
      JOIN affiliates a ON pa.affiliate_id = a.id
      JOIN products p ON pa.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (affiliate_id) {
      sql += ' AND pa.affiliate_id = ?';
      params.push(affiliate_id);
    }
    if (product_id) {
      sql += ' AND pa.product_id = ?';
      params.push(product_id);
    }
    if (status) {
      sql += ' AND pa.status = ?';
      params.push(status);
    }

    sql += ` ORDER BY 
      CASE pa.status 
        WHEN 'PENDING' THEN 1 
        WHEN 'CRITERIA_MET' THEN 2 
        WHEN 'APPROVED' THEN 3 
        ELSE 4 
      END, pa.requested_at DESC`;

    const rows = db.prepare(sql).all(...params);
    return rows.map(r => {
      r.criteria = models.evaluateAffiliateCriteria(r.affiliate_id);
      return r;
    });
  },

  requestProductAffiliation({ affiliate_id, product_id, notes = null }) {
    const affiliate = models.getAffiliateById(affiliate_id);
    const product = models.getProductById(product_id);

    if (!affiliate) throw new Error('Afiliado não encontrado.');
    if (!product) throw new Error('Produto não encontrado.');

    const existing = db.prepare('SELECT * FROM product_affiliations WHERE affiliate_id = ? AND product_id = ?').get(affiliate_id, product_id);

    if (existing && existing.status === 'APPROVED') {
      return models.getProductAffiliationById(existing.id);
    }

    // Avalia os critérios mínimos atuais do afiliado
    const criteria = models.evaluateAffiliateCriteria(affiliate_id);
    let initialStatus = 'PENDING';
    let statusNote = notes || 'Solicitação inserida na fila de espera.';

    if (criteria.criteria_met) {
      if (criteria.auto_approve) {
        initialStatus = 'APPROVED';
        statusNote = 'Critérios mínimos atingidos - Aprovado automaticamente.';
      } else {
        initialStatus = 'CRITERIA_MET';
        statusNote = 'Critérios mínimos atingidos - Aguardando liberação do administrador.';
      }
    }

    let affiliationId;
    if (existing) {
      db.prepare(`
        UPDATE product_affiliations
        SET status = ?, notes = ?, requested_at = datetime('now')
        WHERE id = ?
      `).run(initialStatus, statusNote, existing.id);
      affiliationId = existing.id;
    } else {
      const res = db.prepare(`
        INSERT INTO product_affiliations (affiliate_id, product_id, status, notes)
        VALUES (?, ?, ?, ?)
      `).run(affiliate_id, product_id, initialStatus, statusNote);
      affiliationId = Number(res.lastInsertRowid);
    }

    return models.getProductAffiliationById(affiliationId);
  },

  approveProductAffiliation(affiliationId, reviewer = 'ADMIN', note = null) {
    const finalNote = note || `Aprovado manualmente por ${reviewer}.`;
    db.prepare(`
      UPDATE product_affiliations
      SET status = 'APPROVED', reviewed_at = datetime('now'), notes = ?
      WHERE id = ?
    `).run(finalNote, affiliationId);
    return models.getProductAffiliationById(affiliationId);
  },

  rejectProductAffiliation(affiliationId, reason = null) {
    const finalReason = reason || 'Solicitação recusada pelo administrador.';
    db.prepare(`
      UPDATE product_affiliations
      SET status = 'REJECTED', reviewed_at = datetime('now'), notes = ?
      WHERE id = ?
    `).run(finalReason, affiliationId);
    return models.getProductAffiliationById(affiliationId);
  },

  checkAndActivateAffiliations(affiliateId = null) {
    const autoApprove = models.getSetting('AFFILIATION_AUTO_APPROVE', 'true') === 'true';
    let query = "SELECT id, affiliate_id, product_id FROM product_affiliations WHERE status IN ('PENDING', 'CRITERIA_MET')";
    const params = [];
    if (affiliateId) {
      query += ' AND affiliate_id = ?';
      params.push(affiliateId);
    }

    const pendingList = db.prepare(query).all(...params);
    const updated = [];

    for (const item of pendingList) {
      const evalResult = models.evaluateAffiliateCriteria(item.affiliate_id);
      if (evalResult && evalResult.criteria_met) {
        if (autoApprove) {
          db.prepare(`
            UPDATE product_affiliations 
            SET status = 'APPROVED', reviewed_at = datetime('now'), notes = 'Critérios mínimos atingidos com sucesso - Ativação Automática.'
            WHERE id = ?
          `).run(item.id);
          updated.push({ id: item.id, status: 'APPROVED' });
        } else {
          db.prepare(`
            UPDATE product_affiliations 
            SET status = 'CRITERIA_MET', notes = 'Critérios mínimos atingidos - Aguardando liberação do administrador.'
            WHERE id = ?
          `).run(item.id);
          updated.push({ id: item.id, status: 'CRITERIA_MET' });
        }
      }
    }
    return updated;
  },

  isAffiliateApprovedForProduct(affiliateId, productId) {
    const affiliate = models.getAffiliateById(affiliateId);
    if (!affiliate || !affiliate.active) return false;

    const restricted = models.getSetting('AFFILIATION_PRODUCT_RESTRICTED', 'false') === 'true';
    const record = db.prepare('SELECT status FROM product_affiliations WHERE affiliate_id = ? AND product_id = ?').get(affiliateId, productId);

    if (record) {
      return record.status === 'APPROVED';
    }

    // Se o modo estrito/restringido estiver desativado, o afiliado ativo tem acesso se não houver recusa explícita
    return !restricted;
  }
};

module.exports = models;

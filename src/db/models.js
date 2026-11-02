const db = require('./database');

// ==========================================
// Cache Write-Through em Memória RAM para Configurações (Acesso ~0ms)
// ==========================================
const _settingsMemoryCache = new Map();
let _settingsLoaded = false;

function _ensureSettingsCache() {
  if (!_settingsLoaded) {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      for (const r of rows) {
        _settingsMemoryCache.set(r.key, r.value);
      }
      _settingsLoaded = true;
    } catch (_) {}
  }
}

const models = {
  // ==========================================
  // 1. PRODUTOS & CATEGORIAS
  // ==========================================
  getProducts(activeOnly = true, includeSubbots = false) {
    let whereClause = '';
    if (activeOnly) {
      whereClause = includeSubbots ? 'WHERE p.active = 1' : 'WHERE p.active = 1 AND (p.army_instance_id IS NULL OR p.army_instance_id = 0)';
    } else if (!includeSubbots) {
      whereClause = 'WHERE (p.army_instance_id IS NULL OR p.army_instance_id = 0)';
    }

    const sql = `SELECT p.*, c.name as company_name, u.name as upsell_product_name, u.price_brl as upsell_base_brl, u.price_usdt as upsell_base_usdt
         FROM products p
         LEFT JOIN companies c ON p.company_id = c.id
         LEFT JOIN products u ON p.upsell_product_id = u.id
         ${whereClause}
         ORDER BY p.id ASC`;
    const products = db.prepare(sql).all();
    for (const p of products) {
      if (p.type === 'license_key') {
        p.availableStock = models.getAvailableKeyCount(p.id);
      }
      p.assigned_seller_ids = models.getProductSellerIds(p.id);
      p.assigned_sellers = models.getProductSellers(p.id);
    }
    return products;
  },

  getProductById(id) {
    const product = db.prepare(`
      SELECT p.*, c.name as company_name, u.name as upsell_product_name, u.price_brl as upsell_base_brl, u.price_usdt as upsell_base_usdt
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      LEFT JOIN products u ON p.upsell_product_id = u.id
      WHERE p.id = ?
    `).get(id);

    if (product) {
      if (product.type === 'license_key') {
        product.availableStock = models.getAvailableKeyCount(product.id);
      }
      product.assigned_seller_ids = models.getProductSellerIds(product.id);
      product.assigned_sellers = models.getProductSellers(product.id);
    }
    return product;
  },

  getProductSellerIds(productId) {
    const rows = db.prepare('SELECT seller_id FROM seller_products WHERE product_id = ?').all(productId);
    return rows.map(r => r.seller_id);
  },

  getProductSellers(productId) {
    return db.prepare(`
      SELECT s.id, s.name, s.email, s.phone, s.telegram_username, s.commission_rate, s.active
      FROM seller_products sp
      JOIN sellers s ON sp.seller_id = s.id
      WHERE sp.product_id = ?
      ORDER BY s.name ASC
    `).all(productId);
  },

  setProductSellers(productId, sellerIds = []) {
    db.prepare('DELETE FROM seller_products WHERE product_id = ?').run(productId);
    if (Array.isArray(sellerIds) && sellerIds.length > 0) {
      const insert = db.prepare('INSERT OR IGNORE INTO seller_products (seller_id, product_id) VALUES (?, ?)');
      for (const sid of sellerIds) {
        if (sid) insert.run(Number(sid), productId);
      }
    }
    return models.getProductSellers(productId);
  },

  getCategories(activeOnly = true) {
    const whereActive = activeOnly ? 'WHERE active = 1 AND' : 'WHERE';
    const rows = db.prepare(`SELECT DISTINCT category FROM products ${whereActive} category IS NOT NULL AND category != '' AND (army_instance_id IS NULL OR army_instance_id = 0) ORDER BY category ASC`).all();
    return rows.map(r => r.category);
  },

  createProduct({ name, description = null, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null, upsell_product_id = null, upsell_discount_percent = 20.0, upsell_headline = null, company_id = null, category = 'Geral', affiliation_enabled = 1, custom_affiliate_rate = null, seller_ids = [] }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));
    
    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id, upsell_product_id, upsell_discount_percent, upsell_headline, company_id, category, affiliation_enabled, custom_affiliate_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      category || 'Geral',
      affiliation_enabled ? 1 : 0,
      custom_affiliate_rate !== null && custom_affiliate_rate !== undefined && custom_affiliate_rate !== '' ? Number(custom_affiliate_rate) : null
    );
    const prodId = Number(res.lastInsertRowid);
    if (Array.isArray(seller_ids) && seller_ids.length > 0) {
      models.setProductSellers(prodId, seller_ids);
    }
    return models.getProductById(prodId);
  },

  updateProduct(id, data = {}) {
    const existing = models.getProductById(id);
    if (!existing) throw new Error('Produto não encontrado');

    const name = data.name !== undefined ? data.name : existing.name;
    const description = data.description !== undefined ? data.description : existing.description;
    const price_brl = data.price_brl !== undefined ? Number(data.price_brl) : (data.price !== undefined ? Number(data.price) : Number(existing.price_brl || existing.price));
    const price_usdt = data.price_usdt !== undefined ? Number(data.price_usdt) : Number(existing.price_usdt || (price_brl / 5.5).toFixed(2));
    const currency = data.currency !== undefined ? data.currency : (existing.currency || 'BRL');
    const type = data.type !== undefined ? data.type : existing.type;
    const duration_days = data.duration_days !== undefined ? Number(data.duration_days) : Number(existing.duration_days || 0);
    const content = data.content !== undefined ? data.content : existing.content;
    const telegram_channel_id = data.telegram_channel_id !== undefined ? data.telegram_channel_id : existing.telegram_channel_id;
    const upsell_product_id = data.upsell_product_id !== undefined ? (data.upsell_product_id ? Number(data.upsell_product_id) : null) : existing.upsell_product_id;
    const upsell_discount_percent = data.upsell_discount_percent !== undefined ? Number(data.upsell_discount_percent) : Number(existing.upsell_discount_percent || 20.0);
    const upsell_headline = data.upsell_headline !== undefined ? data.upsell_headline : existing.upsell_headline;
    const company_id = data.company_id !== undefined ? (data.company_id ? Number(data.company_id) : null) : existing.company_id;
    const category = data.category !== undefined ? (data.category ? data.category.trim() : 'Geral') : (existing.category || 'Geral');
    const active = data.active !== undefined ? (data.active ? 1 : 0) : (existing.active ? 1 : 0);
    const affiliation_enabled = data.affiliation_enabled !== undefined ? (data.affiliation_enabled ? 1 : 0) : (existing.affiliation_enabled !== undefined ? existing.affiliation_enabled : 1);
    const custom_affiliate_rate = data.custom_affiliate_rate !== undefined ? (data.custom_affiliate_rate !== null && data.custom_affiliate_rate !== '' ? Number(data.custom_affiliate_rate) : null) : existing.custom_affiliate_rate;

    db.prepare(`
      UPDATE products 
      SET name = ?, description = ?, price = ?, price_brl = ?, price_usdt = ?, currency = ?, type = ?, duration_days = ?, content = ?, telegram_channel_id = ?, upsell_product_id = ?, upsell_discount_percent = ?, upsell_headline = ?, company_id = ?, category = ?, active = ?, affiliation_enabled = ?, custom_affiliate_rate = ?
      WHERE id = ?
    `).run(
      name, 
      description || null, 
      price_brl, 
      price_brl, 
      price_usdt, 
      currency, 
      type, 
      duration_days, 
      content || null, 
      telegram_channel_id || null, 
      upsell_product_id, 
      upsell_discount_percent, 
      upsell_headline || null, 
      company_id, 
      category, 
      active, 
      affiliation_enabled, 
      custom_affiliate_rate, 
      id
    );

    if (data.seller_ids !== undefined && Array.isArray(data.seller_ids)) {
      models.setProductSellers(id, data.seller_ids);
    }

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
  // 8. CONFIGURAÇÕES DINÂMICAS (SETTINGS) - OTIMIZADO COM WRITE-THROUGH RAM CACHE
  // ==========================================
  getSetting(key, defaultValue = null) {
    _ensureSettingsCache();
    if (_settingsMemoryCache.has(key)) {
      return _settingsMemoryCache.get(key);
    }
    return defaultValue;
  },

  setSetting(key, value) {
    const valStr = String(value);
    _settingsMemoryCache.set(key, valStr);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, valStr);
  },

  getAllSettings() {
    _ensureSettingsCache();
    const map = {};
    for (const [k, v] of _settingsMemoryCache.entries()) {
      map[k] = v;
    }
    return map;
  },

  clearSettingsCache() {
    _settingsMemoryCache.clear();
    _settingsLoaded = false;
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

  incrementCouponUsage(code) {
    return models.useCoupon(code);
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
    if (product.affiliation_enabled === 0) {
      throw new Error('Este produto não está disponível para afiliação no momento.');
    }

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

    const product = models.getProductById(productId);
    if (!product || product.affiliation_enabled === 0) return false;

    const restricted = models.getSetting('AFFILIATION_PRODUCT_RESTRICTED', 'false') === 'true';
    const record = db.prepare('SELECT status FROM product_affiliations WHERE affiliate_id = ? AND product_id = ?').get(affiliateId, productId);

    if (record) {
      return record.status === 'APPROVED';
    }

    // Se o modo estrito/restringido estiver desativado, o afiliado ativo tem acesso se não houver recusa explícita
    return !restricted;
  },

  // ==========================================
  // 14. EXÉRCITO DE WHATSAPP (MULTI-INSTÂNCIAS / CHIPS)
  // ==========================================
  getArmyInstances() {
    return db.prepare('SELECT * FROM whatsapp_army_instances ORDER BY is_main DESC, id ASC').all();
  },

  getArmyInstanceById(id) {
    return db.prepare('SELECT * FROM whatsapp_army_instances WHERE id = ?').get(id);
  },

  createArmyInstance({ name, phone = null, daily_limit = 50, warmup_mode = 0 }) {
    const count = db.prepare('SELECT COUNT(*) as count FROM whatsapp_army_instances').get().count;
    const sessionId = `session_${Date.now()}_${count + 1}`;
    const stmt = db.prepare(`
      INSERT INTO whatsapp_army_instances (name, phone, session_id, status, daily_limit, warmup_mode, is_main, active)
      VALUES (?, ?, ?, 'DISCONNECTED', ?, ?, 0, 1)
    `);
    const res = stmt.run(name, phone || null, sessionId, Number(daily_limit || 50), warmup_mode ? 1 : 0);
    return models.getArmyInstanceById(Number(res.lastInsertRowid));
  },

  updateArmyInstance(id, data = {}) {
    const existing = models.getArmyInstanceById(id);
    if (!existing) return null;

    const name = data.name !== undefined ? data.name : existing.name;
    const phone = data.phone !== undefined ? data.phone : existing.phone;
    const status = data.status !== undefined ? data.status : existing.status;
    const daily_limit = data.daily_limit !== undefined ? Number(data.daily_limit) : existing.daily_limit;
    const messages_sent_today = data.messages_sent_today !== undefined ? Number(data.messages_sent_today) : existing.messages_sent_today;
    const warmup_mode = data.warmup_mode !== undefined ? (data.warmup_mode ? 1 : 0) : existing.warmup_mode;
    const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;
    const is_business = data.is_business !== undefined ? (data.is_business ? 1 : 0) : (existing.is_business || 0);
    const business_catalog_synced = data.business_catalog_synced !== undefined ? (data.business_catalog_synced ? 1 : 0) : (existing.business_catalog_synced || 0);
    const catalog_products = data.catalog_products !== undefined ? (typeof data.catalog_products === 'string' ? data.catalog_products : JSON.stringify(data.catalog_products)) : (existing.catalog_products || '[]');
    const role = data.role !== undefined ? data.role : (existing.role || (existing.is_main ? 'MATRIZ_ORCHESTRATOR' : (existing.is_business ? 'BUSINESS_CATALOG' : 'LEAD_OUTREACH')));
    const health_score = data.health_score !== undefined ? Number(data.health_score) : (existing.health_score || 98.5);
    const delivery_success_rate = data.delivery_success_rate !== undefined ? Number(data.delivery_success_rate) : (existing.delivery_success_rate || 99.0);

    db.prepare(`
      UPDATE whatsapp_army_instances
      SET name = ?, phone = ?, status = ?, daily_limit = ?, messages_sent_today = ?, warmup_mode = ?, active = ?, is_business = ?, business_catalog_synced = ?, catalog_products = ?, role = ?, health_score = ?, delivery_success_rate = ?
      WHERE id = ?
    `).run(name, phone || null, status, daily_limit, messages_sent_today, warmup_mode, active, is_business, business_catalog_synced, catalog_products, role, health_score, delivery_success_rate, id);

    return models.getArmyInstanceById(id);
  },

  setArmyInstanceRole(id, role) {
    db.prepare('UPDATE whatsapp_army_instances SET role = ? WHERE id = ?').run(role, id);
    return models.getArmyInstanceById(id);
  },

  resetArmyInstancesQuota(id = null) {
    if (id && id !== 'all' && id !== 'matriz') {
      db.prepare('UPDATE whatsapp_army_instances SET messages_sent_today = 0 WHERE id = ?').run(Number(id));
      return models.getArmyInstanceById(id);
    }
    db.prepare('UPDATE whatsapp_army_instances SET messages_sent_today = 0').run();
    return true;
  },

  // Verifica se uma instância de Sub-Bot é uma conta WhatsApp Business
  isSubBotBusiness(instanceId) {
    if (!instanceId) return false;
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return false;
    return Boolean(inst.is_business || inst.business_catalog_synced);
  },

  // Retorna os produtos exclusivos de um Sub-Bot (WhatsApp Business ou atribuídos)
  getSubBotProducts(instanceId, phone = null) {
    if (!instanceId) return [];
    const inst = models.getArmyInstanceById(instanceId);
    if (!inst) return [];

    // 1. Busca produtos já cadastrados/sincronizados na tabela products com army_instance_id
    const dbProds = db.prepare('SELECT * FROM products WHERE army_instance_id = ? AND active = 1 ORDER BY id ASC').all(instanceId);
    if (dbProds && dbProds.length > 0) {
      return dbProds.map(p => ({
        ...p,
        is_subbot_catalog: true,
        army_instance_id: instanceId
      }));
    }

    // 2. Se houver catálogo JSON salvo na instância
    if (inst.catalog_products) {
      try {
        const parsed = JSON.parse(inst.catalog_products);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p, idx) => ({
            id: p.id || (idx + 1),
            name: p.name,
            description: p.description || '',
            price: Number(p.price || p.price_brl || 0),
            price_brl: Number(p.price_brl || p.price || 0),
            price_usdt: Number(p.price_usdt || ((p.price || 10) / 5.5).toFixed(2)),
            currency: p.currency || 'BRL',
            type: p.type || 'digital',
            duration_days: p.duration_days || 0,
            image_url: p.image_url || p.imageUrl || '',
            category: p.category || 'Catálogo Business',
            is_subbot_catalog: true,
            army_instance_id: instanceId
          }));
        }
      } catch (_) {}
    }

    // 3. Verifica vendedor cadastrado com o mesmo telefone deste sub-bot
    const cleanPhone = (phone || inst.phone || '').replace(/\D/g, '');
    if (cleanPhone) {
      const seller = db.prepare('SELECT * FROM sellers WHERE replace(replace(replace(replace(phone, " ", ""), "-", ""), "+", ""), "(", "") LIKE ?').get(`%${cleanPhone.slice(-8)}%`);
      if (seller) {
        const sProds = models.getSellerProducts(seller.id);
        if (sProds && sProds.length > 0) {
          return sProds.map(sp => models.getProductById(sp.id)).filter(Boolean).map(p => ({
            ...p,
            is_subbot_catalog: true,
            army_instance_id: instanceId,
            seller_id: seller.id
          }));
        }
      }
    }

    return [];
  },

  // Salva e sincroniza produtos de um catálogo WhatsApp Business para o banco de dados
  saveSubBotCatalogProducts(instanceId, rawProducts = []) {
    if (!instanceId || !Array.isArray(rawProducts)) return [];
    const saved = [];

    for (const p of rawProducts) {
      const name = String(p.name || '').trim();
      if (!name) continue;

      const rawPrice = Number(p.price || p.price_brl || 10.0);
      const priceBrl = rawPrice > 1000 ? (rawPrice / 1000) : rawPrice;
      const priceUsdt = Number((priceBrl / 5.5).toFixed(2));
      const desc = p.description || '';
      const img = p.image_url || p.imageUrl || '';

      // Procura se já existe produto com esse nome para essa instância
      let prod = db.prepare('SELECT * FROM products WHERE name = ? AND army_instance_id = ?').get(name, instanceId);

      if (!prod) {
        const stmt = db.prepare(`
          INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, image_url, category, army_instance_id, active)
          VALUES (?, ?, ?, ?, ?, 'BRL', 'digital', 0, ?, 'WhatsApp Business', ?, 1)
        `);
        const res = stmt.run(name, desc, priceBrl, priceBrl, priceUsdt, img, instanceId);
        prod = models.getProductById(Number(res.lastInsertRowid));
      } else {
        db.prepare(`
          UPDATE products
          SET description = ?, price = ?, price_brl = ?, price_usdt = ?, image_url = ?, active = 1
          WHERE id = ?
        `).run(desc, priceBrl, priceBrl, priceUsdt, img, prod.id);
        prod = models.getProductById(prod.id);
      }

      if (prod) saved.push(prod);
    }

    models.updateArmyInstance(instanceId, {
      is_business: 1,
      business_catalog_synced: 1,
      catalog_products: JSON.stringify(saved)
    });

    return saved;
  },

  getSubBotCatalogProducts(instanceId) {
    if (!instanceId) return [];
    return db.prepare('SELECT * FROM products WHERE army_instance_id = ? AND active = 1 ORDER BY id DESC').all(Number(instanceId));
  },

  deleteArmyInstance(id) {
    const inst = models.getArmyInstanceById(id);
    if (inst && inst.is_main) {
      throw new Error('Não é permitido remover a instância Matriz Principal.');
    }
    try {
      db.prepare('UPDATE campaign_leads SET sender_instance_id = 1 WHERE sender_instance_id = ?').run(id);
      db.prepare('UPDATE lead_funnel_conversations SET assigned_instance_id = 1 WHERE assigned_instance_id = ?').run(id);
    } catch (_) {}
    const res = db.prepare('DELETE FROM whatsapp_army_instances WHERE id = ?').run(id);
    try {
      const fs = require('fs');
      const path = require('path');
      const armyFolder = path.join(__dirname, '..', '..', 'data', 'whatsapp_army', `instance_${id}`);
      if (fs.existsSync(armyFolder)) {
        fs.rmSync(armyFolder, { recursive: true, force: true });
      }
    } catch (_) {}
    return res;
  },

  incrementInstanceSentCount(id) {
    db.prepare(`
      UPDATE whatsapp_army_instances
      SET messages_sent_today = messages_sent_today + 1, last_sent_at = datetime('now')
      WHERE id = ?
    `).run(id);
    return models.getArmyInstanceById(id);
  },

  resetArmyDailyCounts() {
    return db.prepare('UPDATE whatsapp_army_instances SET messages_sent_today = 0').run();
  },

  getAvailableArmyInstances(targetIds = null) {
    let sql = `
      SELECT * FROM whatsapp_army_instances 
      WHERE active = 1 AND status = 'CONNECTED' AND messages_sent_today < daily_limit
    `;
    const params = [];
    if (Array.isArray(targetIds) && targetIds.length > 0) {
      sql += ` AND id IN (${targetIds.map(() => '?').join(',')})`;
      params.push(...targetIds);
    }
    sql += ' ORDER BY messages_sent_today ASC, last_sent_at ASC';
    return db.prepare(sql).all(...params);
  },

  // ==========================================
  // 15. CATÁLOGO DE LINKS DE AFILIADO
  // ==========================================
  getAffiliateLinks() {
    return db.prepare('SELECT * FROM affiliate_links ORDER BY id DESC').all();
  },

  getAffiliateLinkById(id) {
    return db.prepare('SELECT * FROM affiliate_links WHERE id = ?').get(id);
  },

  createAffiliateLink({ title, platform = 'Hotmart', affiliate_url, commission_percent = 50.0, product_price = 0.0, currency = 'BRL', pitch_copy = null }) {
    if (!title || !affiliate_url) throw new Error('Título e Link de Afiliado são obrigatórios.');
    const stmt = db.prepare(`
      INSERT INTO affiliate_links (title, platform, affiliate_url, commission_percent, product_price, currency, pitch_copy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(title, platform, affiliate_url, Number(commission_percent || 50.0), Number(product_price || 0.0), currency, pitch_copy || null);
    return models.getAffiliateLinkById(Number(res.lastInsertRowid));
  },

  updateAffiliateLink(id, data = {}) {
    const existing = models.getAffiliateLinkById(id);
    if (!existing) throw new Error('Link de afiliado não encontrado');

    const title = data.title !== undefined ? data.title : existing.title;
    const platform = data.platform !== undefined ? data.platform : existing.platform;
    const affiliate_url = data.affiliate_url !== undefined ? data.affiliate_url : existing.affiliate_url;
    const commission_percent = data.commission_percent !== undefined ? Number(data.commission_percent) : existing.commission_percent;
    const product_price = data.product_price !== undefined ? Number(data.product_price) : existing.product_price;
    const currency = data.currency !== undefined ? data.currency : existing.currency;
    const pitch_copy = data.pitch_copy !== undefined ? data.pitch_copy : existing.pitch_copy;
    const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

    db.prepare(`
      UPDATE affiliate_links
      SET title = ?, platform = ?, affiliate_url = ?, commission_percent = ?, product_price = ?, currency = ?, pitch_copy = ?, active = ?
      WHERE id = ?
    `).run(title, platform, affiliate_url, commission_percent, product_price, currency, pitch_copy || null, active, id);

    return models.getAffiliateLinkById(id);
  },

  deleteAffiliateLink(id) {
    return db.prepare('DELETE FROM affiliate_links WHERE id = ?').run(id);
  },

  trackAffiliateLinkClick(id) {
    return db.prepare('UPDATE affiliate_links SET clicks_count = clicks_count + 1 WHERE id = ?').run(id);
  },

  // ==========================================
  // 16. CAMPANHAS DE DIVULGAÇÃO & SPINTAX (AFFILIATE BROADCAST)
  // ==========================================
  parseSpintax(text) {
    if (!text) return '';
    let result = text;
    const regex = /\{([^{}]*\|[^{}]*)\}/;
    let matches;
    while ((matches = regex.exec(result)) !== null) {
      const options = matches[1].split('|');
      const randomOption = options[Math.floor(Math.random() * options.length)];
      result = result.replace(matches[0], randomOption);
    }
    return result;
  },

  formatCampaignMessage(template, lead = {}, campaign = {}) {
    let msg = template || '';
    const greeting = new Date().getHours() < 12 ? 'Bom dia' : (new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite');
    msg = msg.replace(/\{nome\}/gi, lead.name || 'amigo(a)');
    msg = msg.replace(/\{saudacao\}/gi, greeting);
    msg = msg.replace(/\{produto\}/gi, campaign.product_name || 'Produto Especial');
    msg = msg.replace(/\{link\}/gi, campaign.affiliate_url || '');
    return models.parseSpintax(msg);
  },

  getAffiliateCampaigns() {
    const campaigns = db.prepare(`
      SELECT c.*, l.title as affiliate_link_title, l.platform as affiliate_platform
      FROM affiliate_campaigns c
      LEFT JOIN affiliate_links l ON c.affiliate_link_id = l.id
      ORDER BY c.id DESC
    `).all();

    for (const c of campaigns) {
      const counts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
        FROM campaign_leads WHERE campaign_id = ?
      `).get(c.id);

      c.total_leads = counts.total || 0;
      c.sent_count = counts.sent || 0;
      c.failed_count = counts.failed || 0;
      c.pending_count = counts.pending || 0;
    }
    return campaigns;
  },

  getAffiliateCampaignById(id) {
    const campaign = db.prepare(`
      SELECT c.*, l.title as affiliate_link_title, l.platform as affiliate_platform
      FROM affiliate_campaigns c
      LEFT JOIN affiliate_links l ON c.affiliate_link_id = l.id
      WHERE c.id = ?
    `).get(id);

    if (campaign) {
      const counts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
        FROM campaign_leads WHERE campaign_id = ?
      `).get(id);

      campaign.total_leads = counts.total || 0;
      campaign.sent_count = counts.sent || 0;
      campaign.failed_count = counts.failed || 0;
      campaign.pending_count = counts.pending || 0;
    }
    return campaign;
  },

  createAffiliateCampaign({ name, affiliate_link_id = null, product_name, affiliate_url, message_template, delay_min_seconds = 20, delay_max_seconds = 45, target_instances = null, leads = [] }) {
    if (!name || !message_template) throw new Error('Nome da campanha e modelo de mensagem são obrigatórios.');
    
    let prodName = product_name;
    let affUrl = affiliate_url;

    if (affiliate_link_id) {
      const link = models.getAffiliateLinkById(affiliate_link_id);
      if (link) {
        if (!prodName) prodName = link.title;
        if (!affUrl) affUrl = link.affiliate_url;
      }
    }

    if (!affUrl) throw new Error('Link de afiliado é obrigatório.');

    const targetJson = Array.isArray(target_instances) ? JSON.stringify(target_instances) : null;

    const stmt = db.prepare(`
      INSERT INTO affiliate_campaigns (name, affiliate_link_id, product_name, affiliate_url, message_template, delay_min_seconds, delay_max_seconds, target_instances, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
    `);
    const res = stmt.run(
      name, 
      affiliate_link_id ? Number(affiliate_link_id) : null, 
      prodName || 'Produto Afiliado', 
      affUrl, 
      message_template, 
      Number(delay_min_seconds || 20), 
      Number(delay_max_seconds || 45), 
      targetJson
    );
    const campaignId = Number(res.lastInsertRowid);

    if (Array.isArray(leads) && leads.length > 0) {
      models.addCampaignLeads(campaignId, leads);
    }

    return models.getAffiliateCampaignById(campaignId);
  },

  updateAffiliateCampaign(id, data = {}) {
    const existing = models.getAffiliateCampaignById(id);
    if (!existing) throw new Error('Campanha não encontrada');

    const name = data.name !== undefined ? data.name : existing.name;
    const affiliate_link_id = data.affiliate_link_id !== undefined ? (data.affiliate_link_id ? Number(data.affiliate_link_id) : null) : existing.affiliate_link_id;
    const product_name = data.product_name !== undefined ? data.product_name : existing.product_name;
    const affiliate_url = data.affiliate_url !== undefined ? data.affiliate_url : existing.affiliate_url;
    const message_template = data.message_template !== undefined ? data.message_template : existing.message_template;
    const status = data.status !== undefined ? data.status : existing.status;
    const delay_min_seconds = data.delay_min_seconds !== undefined ? Number(data.delay_min_seconds) : existing.delay_min_seconds;
    const delay_max_seconds = data.delay_max_seconds !== undefined ? Number(data.delay_max_seconds) : existing.delay_max_seconds;
    const target_instances = data.target_instances !== undefined ? (Array.isArray(data.target_instances) ? JSON.stringify(data.target_instances) : null) : existing.target_instances;
    const completed_at = data.completed_at !== undefined ? data.completed_at : existing.completed_at;

    db.prepare(`
      UPDATE affiliate_campaigns
      SET name = ?, affiliate_link_id = ?, product_name = ?, affiliate_url = ?, message_template = ?, status = ?, delay_min_seconds = ?, delay_max_seconds = ?, target_instances = ?, completed_at = ?
      WHERE id = ?
    `).run(name, affiliate_link_id, product_name, affiliate_url, message_template, status, delay_min_seconds, delay_max_seconds, target_instances, completed_at, id);

    return models.getAffiliateCampaignById(id);
  },

  deleteAffiliateCampaign(id) {
    db.prepare('DELETE FROM campaign_leads WHERE campaign_id = ?').run(id);
    return db.prepare('DELETE FROM affiliate_campaigns WHERE id = ?').run(id);
  },

  getCampaignLeads(campaignId, status = null, limit = 500) {
    let sql = 'SELECT * FROM campaign_leads WHERE campaign_id = ?';
    const params = [campaignId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY id ASC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  },

  addCampaignLeads(campaignId, leads = []) {
    const insert = db.prepare(`
      INSERT INTO campaign_leads (campaign_id, phone, name, status)
      VALUES (?, ?, ?, 'PENDING')
    `);
    let added = 0;
    for (const lead of leads) {
      const rawPhone = String(lead.phone || lead).trim().replace(/[^0-9]/g, '');
      if (rawPhone.length >= 10) {
        insert.run(campaignId, rawPhone, lead.name ? String(lead.name).trim() : null);
        added++;
      }
    }
    models.updateCampaignProgress(campaignId);
    return added;
  },

  updateCampaignLead(id, data = {}) {
    const existing = db.prepare('SELECT * FROM campaign_leads WHERE id = ?').get(id);
    if (!existing) return null;

    const status = data.status !== undefined ? data.status : existing.status;
    const sent_message = data.sent_message !== undefined ? data.sent_message : existing.sent_message;
    const sender_instance_id = data.sender_instance_id !== undefined ? data.sender_instance_id : existing.sender_instance_id;
    const sent_at = data.sent_at !== undefined ? data.sent_at : existing.sent_at;
    const error_message = data.error_message !== undefined ? data.error_message : existing.error_message;

    db.prepare(`
      UPDATE campaign_leads
      SET status = ?, sent_message = ?, sender_instance_id = ?, sent_at = ?, error_message = ?
      WHERE id = ?
    `).run(status, sent_message, sender_instance_id, sent_at, error_message, id);

    models.updateCampaignProgress(existing.campaign_id);
    return db.prepare('SELECT * FROM campaign_leads WHERE id = ?').get(id);
  },

  getNextPendingLead(campaignId) {
    return db.prepare(`
      SELECT * FROM campaign_leads 
      WHERE campaign_id = ? AND status = 'PENDING' 
      ORDER BY id ASC 
      LIMIT 1
    `).get(campaignId);
  },

  updateCampaignProgress(campaignId) {
    const counts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM campaign_leads WHERE campaign_id = ?
    `).get(campaignId);

    const total = counts.total || 0;
    const sent = counts.sent || 0;
    const failed = counts.failed || 0;

    let newStatus = undefined;
    let completedAt = undefined;

    if (total > 0 && (sent + failed) >= total) {
      newStatus = 'COMPLETED';
      completedAt = new Date().toISOString();
    }

    if (newStatus) {
      db.prepare(`
        UPDATE affiliate_campaigns
        SET total_leads = ?, sent_count = ?, failed_count = ?, status = ?, completed_at = ?
        WHERE id = ?
      `).run(total, sent, failed, newStatus, completedAt, campaignId);
    } else {
      db.prepare(`
        UPDATE affiliate_campaigns
        SET total_leads = ?, sent_count = ?, failed_count = ?
        WHERE id = ?
      `).run(total, sent, failed, campaignId);
    }
  },

  getPayBotCustomerLeads() {
    return db.prepare(`
      SELECT DISTINCT 
        REPLACE(REPLACE(REPLACE(platform_user_id, '@s.whatsapp.net', ''), '@c.us', ''), '+', '') as phone,
        platform_user_name as name
      FROM orders
      WHERE platform = 'whatsapp' AND platform_user_id IS NOT NULL AND length(platform_user_id) >= 10
      ORDER BY id DESC
      LIMIT 500
    `).all();
  },

  // ==========================================
  // 17. FUNIL DE AQUECIMENTO CONVERSACIONAL (LEAD WARMING)
  // ==========================================
  getFunnelStages() {
    return db.prepare('SELECT * FROM funnel_stages ORDER BY order_num ASC').all();
  },

  getFunnelStageByKey(key) {
    return db.prepare('SELECT * FROM funnel_stages WHERE stage_key = ?').get(key);
  },

  updateFunnelStage(key, { title, message_template, followup_template, followup_delay_minutes, active }) {
    const existing = models.getFunnelStageByKey(key);
    if (!existing) throw new Error('Etapa de funil não encontrada');

    db.prepare(`
      UPDATE funnel_stages
      SET title = COALESCE(?, title),
          message_template = COALESCE(?, message_template),
          followup_template = COALESCE(?, followup_template),
          followup_delay_minutes = COALESCE(?, followup_delay_minutes),
          active = COALESCE(?, active)
      WHERE stage_key = ?
    `).run(
      title !== undefined ? title : null,
      message_template !== undefined ? message_template : null,
      followup_template !== undefined ? followup_template : null,
      followup_delay_minutes !== undefined ? Number(followup_delay_minutes) : null,
      active !== undefined ? (active ? 1 : 0) : null,
      key
    );

    return models.getFunnelStageByKey(key);
  },

  getLeadFunnelConversations({ stage = null, status = null, limit = 100 } = {}) {
    let sql = `
      SELECT lfc.*, wai.name as assigned_instance_name, fs.title as current_stage_title
      FROM lead_funnel_conversations lfc
      LEFT JOIN whatsapp_army_instances wai ON lfc.assigned_instance_id = wai.id
      LEFT JOIN funnel_stages fs ON lfc.current_stage = fs.stage_key
      WHERE 1=1
    `;
    const params = [];
    if (stage) {
      sql += ' AND lfc.current_stage = ?';
      params.push(stage);
    }
    if (status) {
      sql += ' AND lfc.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY lfc.last_message_at DESC, lfc.id DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  },

  getLeadFunnelConversationByPhone(phone) {
    const clean = String(phone).replace(/[^0-9]/g, '');
    return db.prepare(`
      SELECT lfc.*, wai.name as assigned_instance_name, fs.title as current_stage_title
      FROM lead_funnel_conversations lfc
      LEFT JOIN whatsapp_army_instances wai ON lfc.assigned_instance_id = wai.id
      LEFT JOIN funnel_stages fs ON lfc.current_stage = fs.stage_key
      WHERE lfc.phone = ? OR lfc.phone = ?
    `).get(clean, clean.slice(-8));
  },

  enrollLeadInFunnel({ phone, name = null, campaign_id = null, affiliate_link_id = null, product_name, affiliate_url, assigned_instance_id = null }) {
    const clean = String(phone).replace(/[^0-9]/g, '');
    if (!clean || clean.length < 10) throw new Error('Número de telefone inválido.');

    const existing = models.getLeadFunnelConversationByPhone(clean);
    if (existing) {
      db.prepare(`
        UPDATE lead_funnel_conversations
        SET name = COALESCE(?, name),
            campaign_id = COALESCE(?, campaign_id),
            affiliate_link_id = COALESCE(?, affiliate_link_id),
            product_name = COALESCE(?, product_name),
            affiliate_url = COALESCE(?, affiliate_url),
            assigned_instance_id = COALESCE(?, assigned_instance_id)
        WHERE id = ?
      `).run(name, campaign_id, affiliate_link_id, product_name, affiliate_url, assigned_instance_id, existing.id);
      return models.getLeadFunnelConversationByPhone(clean);
    }

    const res = db.prepare(`
      INSERT INTO lead_funnel_conversations (
        phone, name, campaign_id, affiliate_link_id, product_name, affiliate_url,
        assigned_instance_id, current_stage, status, messages_sent, messages_received, last_message_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'STAGE_1_DESCOBERTA', 'WAITING_REPLY', 1, 0, datetime('now'))
    `).run(
      clean,
      name || null,
      campaign_id ? Number(campaign_id) : null,
      affiliate_link_id ? Number(affiliate_link_id) : null,
      product_name || 'Produto Especial',
      affiliate_url || '',
      assigned_instance_id ? Number(assigned_instance_id) : 1
    );

    return models.getLeadFunnelConversationByPhone(clean);
  },

  advanceLeadFunnelStage(phone, targetStage = null) {
    const lead = models.getLeadFunnelConversationByPhone(phone);
    if (!lead) return null;

    const stagesOrder = [
      'STAGE_1_DESCOBERTA',
      'STAGE_2_INTERESSE',
      'STAGE_3_SOLUCAO',
      'STAGE_4_OFERTA',
      'STAGE_5_FECHAMENTO',
      'CONVERTED'
    ];

    let nextStage = targetStage;
    if (!nextStage) {
      const currentIndex = stagesOrder.indexOf(lead.current_stage);
      if (currentIndex !== -1 && currentIndex < stagesOrder.length - 1) {
        nextStage = stagesOrder[currentIndex + 1];
      } else {
        nextStage = 'STAGE_5_FECHAMENTO';
      }
    }

    const isConverted = nextStage === 'CONVERTED';
    const convertedAt = isConverted ? new Date().toISOString() : lead.converted_at;
    const status = isConverted ? 'CONVERTED' : 'WAITING_REPLY';

    db.prepare(`
      UPDATE lead_funnel_conversations
      SET current_stage = ?,
          status = ?,
          converted_at = ?,
          messages_sent = messages_sent + 1,
          last_message_at = datetime('now')
      WHERE id = ?
    `).run(nextStage, status, convertedAt, lead.id);

    return models.getLeadFunnelConversationByPhone(phone);
  },

  markLeadConverted(phone) {
    return models.advanceLeadFunnelStage(phone, 'CONVERTED');
  },

  logFunnelInteraction({ lead_phone, instance_id = null, direction = 'OUT', stage = null, message_text }) {
    const clean = String(lead_phone).replace(/[^0-9]/g, '');
    const stmt = db.prepare(`
      INSERT INTO funnel_interactions_log (lead_phone, instance_id, direction, stage, message_text)
      VALUES (?, ?, ?, ?, ?)
    `);
    const res = stmt.run(clean, instance_id ? Number(instance_id) : null, direction, stage || null, message_text);
    return db.prepare('SELECT * FROM funnel_interactions_log WHERE id = ?').get(Number(res.lastInsertRowid));
  },

  getFunnelInteractionLogs(phone, limit = 50) {
    const clean = String(phone).replace(/[^0-9]/g, '');
    return db.prepare(`
      SELECT fil.*, wai.name as instance_name
      FROM funnel_interactions_log fil
      LEFT JOIN whatsapp_army_instances wai ON fil.instance_id = wai.id
      WHERE fil.lead_phone = ? OR fil.lead_phone = ?
      ORDER BY fil.id ASC LIMIT ?
    `).all(clean, clean.slice(-8), limit);
  },

  getFunnelRealTimeStats() {
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM lead_funnel_conversations').get().count;

    const stagesCount = db.prepare(`
      SELECT 
        SUM(CASE WHEN current_stage = 'STAGE_1_DESCOBERTA' THEN 1 ELSE 0 END) as stage1,
        SUM(CASE WHEN current_stage = 'STAGE_2_INTERESSE' THEN 1 ELSE 0 END) as stage2,
        SUM(CASE WHEN current_stage = 'STAGE_3_SOLUCAO' THEN 1 ELSE 0 END) as stage3,
        SUM(CASE WHEN current_stage = 'STAGE_4_OFERTA' THEN 1 ELSE 0 END) as stage4,
        SUM(CASE WHEN current_stage = 'STAGE_5_FECHAMENTO' THEN 1 ELSE 0 END) as stage5,
        SUM(CASE WHEN current_stage = 'CONVERTED' THEN 1 ELSE 0 END) as converted,
        SUM(CASE WHEN status = 'REPLIED' OR messages_received > 0 THEN 1 ELSE 0 END) as engaged
      FROM lead_funnel_conversations
    `).get();

    const stage1 = stagesCount.stage1 || 0;
    const stage2 = stagesCount.stage2 || 0;
    const stage3 = stagesCount.stage3 || 0;
    const stage4 = stagesCount.stage4 || 0;
    const stage5 = stagesCount.stage5 || 0;
    const converted = stagesCount.converted || 0;
    const engaged = stagesCount.engaged || 0;

    const replyRate = totalLeads > 0 ? Number(((engaged / totalLeads) * 100).toFixed(1)) : 0;
    const offerReachRate = totalLeads > 0 ? Number((((stage4 + stage5 + converted) / totalLeads) * 100).toFixed(1)) : 0;
    const conversionRate = totalLeads > 0 ? Number(((converted / totalLeads) * 100).toFixed(1)) : 0;

    return {
      totalLeads,
      stage1,
      stage2,
      stage3,
      stage4,
      stage5,
      converted,
      engaged,
      replyRate,
      offerReachRate,
      conversionRate
    };
  },

  // ==========================================
  // 10. REDES SOCIAIS (INSTAGRAM DIRECT & FACEBOOK MESSENGER)
  // ==========================================
  getSocialAccounts({ platform = null, status = null } = {}) {
    let sql = 'SELECT s.*, c.name as company_name FROM social_accounts s LEFT JOIN companies c ON s.assigned_company_id = c.id WHERE 1=1';
    const params = [];
    if (platform) {
      sql += ' AND s.platform = ?';
      params.push(platform);
    }
    if (status) {
      sql += ' AND s.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY s.id DESC';
    return db.prepare(sql).all(...params);
  },

  getSocialAccountById(id) {
    return db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id);
  },

  getSocialAccountByAccountId(accountId) {
    return db.prepare('SELECT * FROM social_accounts WHERE account_id = ?').get(accountId);
  },

  createSocialAccount({ platform, name, account_id, access_token = null, app_secret = null, auto_reply_enabled = 1, assigned_company_id = null }) {
    const info = db.prepare(`
      INSERT INTO social_accounts (platform, name, account_id, access_token, app_secret, auto_reply_enabled, assigned_company_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      platform,
      name,
      account_id,
      access_token,
      app_secret,
      auto_reply_enabled !== undefined ? (auto_reply_enabled ? 1 : 0) : 1,
      assigned_company_id || null
    );
    return models.getSocialAccountById(info.lastInsertRowid);
  },

  updateSocialAccount(id, { name, account_id, access_token, app_secret, auto_reply_enabled, status, assigned_company_id }) {
    const existing = models.getSocialAccountById(id);
    if (!existing) throw new Error('Conta social não encontrada');

    db.prepare(`
      UPDATE social_accounts
      SET name = COALESCE(?, name),
          account_id = COALESCE(?, account_id),
          access_token = COALESCE(?, access_token),
          app_secret = COALESCE(?, app_secret),
          auto_reply_enabled = COALESCE(?, auto_reply_enabled),
          status = COALESCE(?, status),
          assigned_company_id = COALESCE(?, assigned_company_id)
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      account_id !== undefined ? account_id : null,
      access_token !== undefined ? access_token : null,
      app_secret !== undefined ? app_secret : null,
      auto_reply_enabled !== undefined ? (auto_reply_enabled ? 1 : 0) : null,
      status !== undefined ? status : null,
      assigned_company_id !== undefined ? assigned_company_id : null,
      id
    );
    return models.getSocialAccountById(id);
  },

  deleteSocialAccount(id) {
    db.prepare('DELETE FROM social_messages_log WHERE social_account_id = ?').run(id);
    return db.prepare('DELETE FROM social_accounts WHERE id = ?').run(id);
  },

  incrementSocialAccountCounters(id, { received = 0, sent = 0 } = {}) {
    if (received > 0) {
      db.prepare('UPDATE social_accounts SET total_messages_received = total_messages_received + ? WHERE id = ?').run(received, id);
    }
    if (sent > 0) {
      db.prepare('UPDATE social_accounts SET total_messages_sent = total_messages_sent + ? WHERE id = ?').run(sent, id);
    }
  },

  logSocialMessage({ social_account_id, platform, sender_id, sender_name = null, message_text, direction, stage = null }) {
    const info = db.prepare(`
      INSERT INTO social_messages_log (social_account_id, platform, sender_id, sender_name, message_text, direction, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      social_account_id || null,
      platform,
      sender_id,
      sender_name,
      message_text,
      direction,
      stage
    );
    return info.lastInsertRowid;
  },

  getSocialMessagesLog({ account_id = null, limit = 50 } = {}) {
    let sql = `
      SELECT m.*, a.name as account_name
      FROM social_messages_log m
      LEFT JOIN social_accounts a ON m.social_account_id = a.id
      WHERE 1=1
    `;
    const params = [];
    if (account_id) {
      sql += ' AND m.social_account_id = ?';
      params.push(account_id);
    }
    sql += ' ORDER BY m.id DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  },

  getSocialStats() {
    const totalAccounts = db.prepare('SELECT COUNT(*) as count FROM social_accounts').get().count;
    const igAccounts = db.prepare("SELECT COUNT(*) as count FROM social_accounts WHERE platform = 'instagram'").get().count;
    const fbAccounts = db.prepare("SELECT COUNT(*) as count FROM social_accounts WHERE platform = 'facebook'").get().count;
    const totalReceived = db.prepare('SELECT SUM(total_messages_received) as sum FROM social_accounts').get().sum || 0;
    const totalSent = db.prepare('SELECT SUM(total_messages_sent) as sum FROM social_accounts').get().sum || 0;
    const totalMessagesLogged = db.prepare('SELECT COUNT(*) as count FROM social_messages_log').get().count;

    return {
      totalAccounts,
      igAccounts,
      fbAccounts,
      totalReceived,
      totalSent,
      totalMessagesLogged
    };
  },

  // ==========================================
  // 17. CONTROLE DE MODERAÇÃO (MUTE & BLOQUEIOS)
  // ==========================================
  isChatMuted(platform, chatId) {
    if (!chatId) return false;
    const cleanChat = String(chatId).trim();
    const row = db.prepare(`
      SELECT * FROM bot_chat_controls
      WHERE platform = ? AND control_type = 'MUTE_CHAT' AND active = 1 AND chat_id = ?
      LIMIT 1
    `).get(platform, cleanChat);
    return !!row;
  },

  isUserBlocked(platform, userId, chatId = null) {
    if (!userId) return false;
    const cleanUser = String(userId).trim();
    const rawDigits = cleanUser.replace(/[^0-9]/g, '');

    if (chatId) {
      const cleanChat = String(chatId).trim();
      const row = db.prepare(`
        SELECT * FROM bot_chat_controls
        WHERE platform = ? AND control_type = 'BLOCK_USER' AND active = 1
          AND (chat_id = ? OR chat_id = '*' OR chat_id = '')
          AND (
            user_id = ? 
            OR user_id LIKE '%' || ? 
            OR (? != '' AND user_id = ?)
          )
        LIMIT 1
      `).get(platform, cleanChat, cleanUser, rawDigits ? rawDigits.slice(-8) : cleanUser, rawDigits, rawDigits);
      return !!row;
    } else {
      const row = db.prepare(`
        SELECT * FROM bot_chat_controls
        WHERE platform = ? AND control_type = 'BLOCK_USER' AND active = 1
          AND (
            user_id = ? 
            OR user_id LIKE '%' || ? 
            OR (? != '' AND user_id = ?)
          )
        LIMIT 1
      `).get(platform, cleanUser, rawDigits ? rawDigits.slice(-8) : cleanUser, rawDigits, rawDigits);
      return !!row;
    }
  },

  muteChat({ platform, chatId, targetType = 'PRIVATE', reason = 'Desativado via comando', createdBy = 'admin', userName = null }) {
    const cleanChat = String(chatId).trim();
    const existing = db.prepare(`
      SELECT id FROM bot_chat_controls
      WHERE platform = ? AND control_type = 'MUTE_CHAT' AND chat_id = ?
    `).get(platform, cleanChat);

    if (existing) {
      db.prepare(`
        UPDATE bot_chat_controls
        SET active = 1, target_type = ?, reason = ?, user_name = COALESCE(?, user_name), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(targetType, reason, userName, existing.id);
      return { id: existing.id, muted: true };
    } else {
      const info = db.prepare(`
        INSERT INTO bot_chat_controls (platform, control_type, target_type, chat_id, reason, created_by, user_name, active)
        VALUES (?, 'MUTE_CHAT', ?, ?, ?, ?, ?, 1)
      `).run(platform, targetType, cleanChat, reason, createdBy, userName);
      return { id: info.lastInsertRowid, muted: true };
    }
  },

  unmuteChat(platform, chatId) {
    const cleanChat = String(chatId).trim();
    const info = db.prepare(`
      UPDATE bot_chat_controls
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE platform = ? AND control_type = 'MUTE_CHAT' AND chat_id = ?
    `).run(platform, cleanChat);
    return { unmuted: info.changes > 0 };
  },

  blockUser({ platform, userId, chatId = null, targetType = 'USER', reason = 'Participante bloqueado', createdBy = 'admin', userName = null }) {
    const cleanUser = String(userId).trim();
    const cleanChat = chatId ? String(chatId).trim() : '*';

    const existing = db.prepare(`
      SELECT id FROM bot_chat_controls
      WHERE platform = ? AND control_type = 'BLOCK_USER' AND user_id = ? AND chat_id = ?
    `).get(platform, cleanUser, cleanChat);

    if (existing) {
      db.prepare(`
        UPDATE bot_chat_controls
        SET active = 1, reason = ?, user_name = COALESCE(?, user_name), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reason, userName, existing.id);
      return { id: existing.id, blocked: true };
    } else {
      const info = db.prepare(`
        INSERT INTO bot_chat_controls (platform, control_type, target_type, chat_id, user_id, user_name, reason, created_by, active)
        VALUES (?, 'BLOCK_USER', ?, ?, ?, ?, ?, ?, 1)
      `).run(platform, targetType, cleanChat, cleanUser, userName, reason, createdBy);
      return { id: info.lastInsertRowid, blocked: true };
    }
  },

  unblockUser(platform, userId, chatId = null) {
    const cleanUser = String(userId).trim();
    const rawDigits = cleanUser.replace(/[^0-9]/g, '');

    let query = `
      UPDATE bot_chat_controls
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE platform = ? AND control_type = 'BLOCK_USER'
        AND (
          user_id = ? 
          OR user_id LIKE '%' || ?
          OR (? != '' AND user_id = ?)
        )
    `;
    const params = [platform, cleanUser, rawDigits ? rawDigits.slice(-8) : cleanUser, rawDigits, rawDigits];
    if (chatId) {
      query += ` AND (chat_id = ? OR chat_id = '*' OR chat_id = '')`;
      params.push(String(chatId));
    }
    const info = db.prepare(query).run(...params);
    return { unblocked: info.changes > 0 };
  },

  getChatControls({ platform = null, activeOnly = true } = {}) {
    let query = `SELECT * FROM bot_chat_controls WHERE 1=1`;
    const params = [];
    if (platform) {
      query += ` AND platform = ?`;
      params.push(platform);
    }
    if (activeOnly) {
      query += ` AND active = 1`;
    }
    query += ` ORDER BY id DESC`;
    return db.prepare(query).all(...params);
  },

  deleteChatControl(id) {
    const info = db.prepare(`DELETE FROM bot_chat_controls WHERE id = ?`).run(id);
    return { deleted: info.changes > 0 };
  },

  // ==========================================
  // GESTÃO & AUDITORIA DE GRUPOS (WHATSAPP & TELEGRAM)
  // ==========================================
  logGroupAdminAction({ platform, groupId, groupName = null, adminId, adminName = null, action, targetId = null, details = null }) {
    if (!platform || !groupId || !adminId || !action) {
      throw new Error('platform, groupId, adminId e action são obrigatórios para registrar log.');
    }
    const stmt = db.prepare(`
      INSERT INTO group_admin_audit_logs (platform, group_id, group_name, admin_id, admin_name, action, target_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      platform,
      String(groupId),
      groupName ? String(groupName) : null,
      String(adminId),
      adminName ? String(adminName) : null,
      String(action).toUpperCase(),
      targetId ? String(targetId) : null,
      details ? String(details) : null
    );
    return { id: info.lastInsertRowid, logged: true };
  },

  getGroupAdminAuditLogs({ platform = null, groupId = null, limit = 50, offset = 0 } = {}) {
    let query = `SELECT * FROM group_admin_audit_logs WHERE 1=1`;
    const params = [];
    if (platform) {
      query += ` AND platform = ?`;
      params.push(platform);
    }
    if (groupId) {
      query += ` AND group_id = ?`;
      params.push(String(groupId));
    }
    query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit) || 50, Number(offset) || 0);
    return db.prepare(query).all(...params);
  },

  clearGroupAdminAuditLogs({ groupId = null } = {}) {
    if (groupId) {
      const info = db.prepare(`DELETE FROM group_admin_audit_logs WHERE group_id = ?`).run(String(groupId));
      return { cleared: info.changes };
    }
    const info = db.prepare(`DELETE FROM group_admin_audit_logs`).run();
    return { cleared: info.changes };
  },

  getGroupSettings(platform, groupId) {
    const antilink = this.getSetting(`ANTILINK_${groupId}`, 'false') === 'true';
    const welcome = this.getSetting(`WELCOME_${groupId}`, 'false') === 'true';
    const welcomeMsg = this.getSetting(
      `WELCOME_MSG_${groupId}`,
      '👋 Olá {nome}, seja muito bem-vindo(a) ao grupo *{grupo}*! Sinta-se em casa e confira as regras.'
    );
    const antifake = this.getSetting(`ANTIFAKE_${groupId}`, 'false') === 'true';
    const antiviewonce = this.getSetting(`ANTIVIEWONCE_${groupId}`, 'true') === 'true';
    const antidelete = this.getSetting(`ANTIDELETE_${groupId}`, 'false') === 'true';
    const bye = this.getSetting(`BYE_${groupId}`, 'false') === 'true';
    const byeMsg = this.getSetting(
      `BYE_MSG_${groupId}`,
      '👋 @{numero} saiu ou foi removido do grupo *{grupo}*.'
    );
    return { platform, groupId, antilink, welcome, welcomeMsg, antifake, antiviewonce, antidelete, bye, byeMsg };
  },

  updateGroupSettings(platform, groupId, {
    antilink = null,
    welcome = null,
    welcomeMsg = null,
    antifake = null,
    antiviewonce = null,
    antidelete = null,
    bye = null,
    byeMsg = null
  } = {}) {
    if (antilink !== null && antilink !== undefined) {
      this.setSetting(`ANTILINK_${groupId}`, antilink ? 'true' : 'false');
    }
    if (welcome !== null && welcome !== undefined) {
      this.setSetting(`WELCOME_${groupId}`, welcome ? 'true' : 'false');
    }
    if (welcomeMsg !== null && welcomeMsg !== undefined) {
      this.setSetting(`WELCOME_MSG_${groupId}`, String(welcomeMsg));
    }
    if (antifake !== null && antifake !== undefined) {
      this.setSetting(`ANTIFAKE_${groupId}`, antifake ? 'true' : 'false');
    }
    if (antiviewonce !== null && antiviewonce !== undefined) {
      this.setSetting(`ANTIVIEWONCE_${groupId}`, antiviewonce ? 'true' : 'false');
    }
    if (antidelete !== null && antidelete !== undefined) {
      this.setSetting(`ANTIDELETE_${groupId}`, antidelete ? 'true' : 'false');
    }
    if (bye !== null && bye !== undefined) {
      this.setSetting(`BYE_${groupId}`, bye ? 'true' : 'false');
    }
    if (byeMsg !== null && byeMsg !== undefined) {
      this.setSetting(`BYE_MSG_${groupId}`, String(byeMsg));
    }
    return this.getGroupSettings(platform, groupId);
  },

  // ==========================================
  // TRIGGERS INTELIGENTES CUSTOMIZADOS (FAQ / OBJEÇÕES RÁPIDAS)
  // ==========================================
  getCustomTriggers({ activeOnly = false, platform = null } = {}) {
    let query = `SELECT * FROM custom_triggers WHERE 1=1`;
    const params = [];
    if (activeOnly) {
      query += ` AND active = 1`;
    }
    if (platform && platform !== 'all') {
      query += ` AND (platform = ? OR platform = 'all')`;
      params.push(platform);
    }
    query += ` ORDER BY id DESC`;
    return db.prepare(query).all(...params);
  },

  getCustomTriggerById(id) {
    return db.prepare(`SELECT * FROM custom_triggers WHERE id = ?`).get(id);
  },

  createCustomTrigger({ keyword, matchType = 'CONTAINS', responseText, category = 'Dúvidas Frequentes', platform = 'all', active = 1 }) {
    if (!keyword || !responseText) {
      throw new Error('Palavra-chave e texto de resposta são obrigatórios.');
    }
    const stmt = db.prepare(`
      INSERT INTO custom_triggers (keyword, match_type, response_text, category, platform, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      keyword.trim(),
      matchType ? matchType.toUpperCase() : 'CONTAINS',
      responseText.trim(),
      category ? category.trim() : 'Dúvidas Frequentes',
      platform || 'all',
      active !== undefined ? (active ? 1 : 0) : 1
    );
    return this.getCustomTriggerById(info.lastInsertRowid);
  },

  updateCustomTrigger(id, data = {}) {
    const current = this.getCustomTriggerById(id);
    if (!current) return null;

    const keyword = data.keyword !== undefined ? data.keyword.trim() : current.keyword;
    const matchType = data.matchType !== undefined ? data.matchType.toUpperCase() : current.match_type;
    const responseText = data.responseText !== undefined ? data.responseText.trim() : current.response_text;
    const category = data.category !== undefined ? data.category.trim() : current.category;
    const platform = data.platform !== undefined ? data.platform : current.platform;
    const active = data.active !== undefined ? (data.active ? 1 : 0) : current.active;

    db.prepare(`
      UPDATE custom_triggers
      SET keyword = ?, match_type = ?, response_text = ?, category = ?, platform = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(keyword, matchType, responseText, category, platform, active, id);

    return this.getCustomTriggerById(id);
  },

  deleteCustomTrigger(id) {
    const info = db.prepare(`DELETE FROM custom_triggers WHERE id = ?`).run(id);
    return { deleted: info.changes > 0 };
  },

  incrementTriggerUsage(id) {
    db.prepare(`UPDATE custom_triggers SET usage_count = usage_count + 1 WHERE id = ?`).run(id);
  },

  findMatchingTrigger(text, platform = 'all') {
    if (!text || typeof text !== 'string') return null;
    const triggers = this.getCustomTriggers({ activeOnly: true, platform });
    const normalizedInput = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    for (const t of triggers) {
      const kw = t.keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (!kw) continue;

      if (t.match_type === 'EXACT') {
        if (normalizedInput === kw) {
          this.incrementTriggerUsage(t.id);
          return t;
        }
      } else if (t.match_type === 'REGEX') {
        try {
          const reg = new RegExp(t.keyword, 'i');
          if (reg.test(text)) {
            this.incrementTriggerUsage(t.id);
            return t;
          }
        } catch (_) {}
      } else {
        // CONTAINS (Padrão)
        if (normalizedInput.includes(kw)) {
          this.incrementTriggerUsage(t.id);
          return t;
        }
      }
    }
    return null;
  },

  // ==========================================
  // TRANSBORDO & CHAMADOS DE SUPORTE HUMANO (SUPPORT TICKETS)
  // ==========================================
  createSupportTicket({ platform, customerId, customerName = null, issueSummary = null, priority = 'NORMAL', sellerId = null }) {
    if (!platform || !customerId) {
      throw new Error('Plataforma e ID do cliente são obrigatórios para abrir ticket.');
    }

    // Se não tiver vendedor especificado, usa a rotação do time de vendedores
    let assignedSellerId = sellerId;
    if (!assignedSellerId) {
      const nextSeller = this.getNextRoundRobinSeller();
      if (nextSeller) assignedSellerId = nextSeller.id;
    }

    const stmt = db.prepare(`
      INSERT INTO support_tickets (platform, customer_id, customer_name, seller_id, issue_summary, status, priority, last_message)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `);
    const info = stmt.run(
      platform,
      String(customerId),
      customerName ? String(customerName) : null,
      assignedSellerId || null,
      issueSummary ? String(issueSummary) : 'Solicitação de atendimento humano',
      priority || 'NORMAL',
      issueSummary ? String(issueSummary) : null
    );
    return this.getSupportTicketById(info.lastInsertRowid);
  },

  getSupportTickets({ status = null, platform = null, sellerId = null, limit = 50 } = {}) {
    let query = `
      SELECT t.*, s.name as seller_name, s.phone as seller_phone
      FROM support_tickets t
      LEFT JOIN sellers s ON t.seller_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }
    if (platform) {
      query += ` AND t.platform = ?`;
      params.push(platform);
    }
    if (sellerId) {
      query += ` AND t.seller_id = ?`;
      params.push(sellerId);
    }
    query += ` ORDER BY t.id DESC LIMIT ?`;
    params.push(Number(limit) || 50);
    return db.prepare(query).all(...params);
  },

  getSupportTicketById(id) {
    return db.prepare(`
      SELECT t.*, s.name as seller_name, s.phone as seller_phone
      FROM support_tickets t
      LEFT JOIN sellers s ON t.seller_id = s.id
      WHERE t.id = ?
    `).get(id);
  },

  updateSupportTicketStatus(id, status) {
    const valid = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'];
    if (!valid.includes(status)) throw new Error('Status de ticket inválido.');
    db.prepare(`
      UPDATE support_tickets
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);
    return this.getSupportTicketById(id);
  },

  assignSupportTicket(id, sellerId) {
    db.prepare(`
      UPDATE support_tickets
      SET seller_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sellerId, id);
    return this.getSupportTicketById(id);
  },

  // ==========================================
  // MÉTRICAS CONSOLIDADAS POR CANAL / PLATAFORMA
  // ==========================================
  getChannelMetrics() {
    const platforms = ['whatsapp', 'telegram', 'instagram', 'facebook'];
    const metrics = {};

    platforms.forEach(p => {
      // Pedidos Pagos
      const orders = db.prepare(`
        SELECT COUNT(*) as count, 
               COALESCE(SUM(CASE WHEN currency = 'BRL' THEN amount ELSE 0 END), 0) as total_brl,
               COALESCE(SUM(CASE WHEN currency = 'USDT' THEN amount ELSE 0 END), 0) as total_usdt
        FROM orders
        WHERE platform = ? AND status = 'PAID'
      `).get(p);

      // Assinaturas Ativas
      const subs = db.prepare(`
        SELECT COUNT(*) as count FROM subscriptions WHERE platform = ? AND status = 'ACTIVE'
      `).get(p);

      // Tickets de Suporte Abertos
      const openTickets = db.prepare(`
        SELECT COUNT(*) as count FROM support_tickets WHERE platform = ? AND status = 'OPEN'
      `).get(p);

      metrics[p] = {
        ordersCount: orders.count,
        revenueBRL: orders.total_brl,
        revenueUSDT: orders.total_usdt,
        activeSubscriptions: subs.count,
        openTickets: openTickets.count
      };
    });

    return metrics;
  },

  // ==========================================
  // 17. SPY SECURITY: SISTEMA DE ADVERTÊNCIAS (WARNS)
  // ==========================================
  addWarning(groupId, userPhone, reason = 'Violação de regras do grupo', warnedBy = 'Admin') {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const cleanGroup = String(groupId).trim();
    
    db.prepare(`
      INSERT INTO group_warnings (group_id, user_phone, reason, warned_by)
      VALUES (?, ?, ?, ?)
    `).run(cleanGroup, cleanPhone, reason, warnedBy);

    const count = this.getWarningsCount(cleanGroup, cleanPhone);
    return { count, reason, warnedBy, userPhone: cleanPhone };
  },

  getWarningsCount(groupId, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const cleanGroup = String(groupId).trim();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM group_warnings 
      WHERE group_id = ? AND user_phone = ?
    `).get(cleanGroup, cleanPhone);
    return row ? row.count : 0;
  },

  getWarnings(groupId, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const cleanGroup = String(groupId).trim();
    return db.prepare(`
      SELECT * FROM group_warnings 
      WHERE group_id = ? AND user_phone = ? 
      ORDER BY id DESC
    `).all(cleanGroup, cleanPhone);
  },

  removeLastWarning(groupId, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const cleanGroup = String(groupId).trim();
    const last = db.prepare(`
      SELECT id FROM group_warnings 
      WHERE group_id = ? AND user_phone = ? 
      ORDER BY id DESC LIMIT 1
    `).get(cleanGroup, cleanPhone);

    if (last) {
      db.prepare('DELETE FROM group_warnings WHERE id = ?').run(last.id);
      return true;
    }
    return false;
  },

  clearWarnings(groupId, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const cleanGroup = String(groupId).trim();
    db.prepare('DELETE FROM group_warnings WHERE group_id = ? AND user_phone = ?').run(cleanGroup, cleanPhone);
    return true;
  },

  // ==========================================
  // 18. SPY GAMIFICAÇÃO & FIDELIDADE (LOYALTY / RPG)
  // ==========================================
  getUserLoyalty(platform = 'whatsapp', userId, userName = null) {
    const cleanId = String(userId).trim();
    let row = db.prepare('SELECT * FROM user_loyalty WHERE platform = ? AND user_id = ?').get(platform, cleanId);
    
    if (!row) {
      db.prepare(`
        INSERT INTO user_loyalty (platform, user_id, user_name, points, level, exp, total_spent)
        VALUES (?, ?, ?, 50, 1, 0, 0)
      `).run(platform, cleanId, userName || 'Membro');
      row = db.prepare('SELECT * FROM user_loyalty WHERE platform = ? AND user_id = ?').get(platform, cleanId);
    } else if (userName && row.user_name !== userName) {
      db.prepare('UPDATE user_loyalty SET user_name = ? WHERE id = ?').run(userName, row.id);
      row.user_name = userName;
    }

    return row;
  },

  addLoyaltyPoints(platform = 'whatsapp', userId, pointsToAdd = 10, expToAdd = 10, userName = null) {
    const current = this.getUserLoyalty(platform, userId, userName);
    const newPoints = Math.max(0, (current.points || 0) + pointsToAdd);
    const newExp = (current.exp || 0) + expToAdd;
    
    // Nível sobe a cada 100 de exp
    const newLevel = Math.floor(newExp / 100) + 1;

    db.prepare(`
      UPDATE user_loyalty 
      SET points = ?, exp = ?, level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newPoints, newExp, newLevel, current.id);

    return {
      points: newPoints,
      exp: newExp,
      level: newLevel,
      pointsAdded: pointsToAdd,
      leveledUp: newLevel > current.level
    };
  },

  redeemLoyaltyCoupon(platform = 'whatsapp', userId, pointsCost = 100) {
    const current = this.getUserLoyalty(platform, userId);
    if ((current.points || 0) < pointsCost) {
      return {
        success: false,
        error: `Pontos insuficientes. Você possui ${current.points} pts, mas precisa de ${pointsCost} pts para resgatar este cupom.`
      };
    }

    // Deduz pontos
    const newPoints = current.points - pointsCost;
    db.prepare('UPDATE user_loyalty SET points = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPoints, current.id);

    // Cria cupom exclusivo na tabela de cupons
    const couponCode = `FIDELIDADE_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    models.createCoupon({
      code: couponCode,
      discount_percent: 15.0,
      discount_amount: 0,
      max_uses: 1
    });

    return {
      success: true,
      couponCode,
      discountPercent: 15,
      remainingPoints: newPoints
    };
  },

  // ==========================================
  // 19. SPY ANTI-VIEW-ONCE
  // ==========================================
  logViewOnceMedia(chatId, senderPhone, mediaType, mediaCaption = '') {
    const res = db.prepare(`
      INSERT INTO view_once_logs (chat_id, sender_phone, media_type, media_caption)
      VALUES (?, ?, ?, ?)
    `).run(chatId, senderPhone, mediaType, mediaCaption);
    return {
      id: res.lastInsertRowid,
      chat_id: chatId,
      sender_phone: senderPhone,
      media_type: mediaType,
      media_caption: mediaCaption,
      caption: mediaCaption
    };
  },

  getViewOnceLogs(chatId = null, limit = 50) {
    if (chatId) {
      return db.prepare(`SELECT id, chat_id, sender_phone, media_type, media_caption, media_caption as caption, created_at FROM view_once_logs WHERE chat_id = ? ORDER BY id DESC LIMIT ?`).all(chatId, limit);
    }
    return db.prepare(`SELECT id, chat_id, sender_phone, media_type, media_caption, media_caption as caption, created_at FROM view_once_logs ORDER BY id DESC LIMIT ?`).all(limit);
  },

  // ==========================================
  // 20. LANÇAMENTO METEÓRICO & MULTI-GRUPOS
  // ==========================================
  getMeteoricCampaign(id = 1) {
    const row = db.prepare('SELECT * FROM meteoric_campaigns WHERE id = ?').get(id);
    if (!row) {
      return {
        id: 1,
        name: 'Lançamento Meteórico VIP',
        group_base_name: 'Oferta VIP #{num}',
        max_members_per_group: 200,
        active: 1,
        current_group_id: null,
        current_stage: 1,
        group_description: 'Grupo VIP oficial de lançamento. Acompanhe os avisos!',
        total_groups_created: 0,
        total_leads_reached: 0
      };
    }
    return row;
  },

  updateMeteoricCampaign(updates = {}, id = 1) {
    const allowed = [
      'name', 'group_base_name', 'max_members_per_group', 'active',
      'current_group_id', 'current_stage', 'group_description',
      'total_groups_created', 'total_leads_reached'
    ];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length === 0) return this.getMeteoricCampaign(id);

    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);

    db.prepare(`UPDATE meteoric_campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getMeteoricCampaign(id);
  },

  getMeteoricGroups(campaignId = 1) {
    return db.prepare(`
      SELECT * FROM meteoric_groups 
      WHERE campaign_id = ? 
      ORDER BY group_num ASC, id ASC
    `).all(campaignId);
  },

  getMeteoricGroupById(id) {
    return db.prepare('SELECT * FROM meteoric_groups WHERE id = ?').get(id);
  },

  getMeteoricGroupByJid(jid) {
    return db.prepare('SELECT * FROM meteoric_groups WHERE group_jid = ?').get(jid);
  },

  getActiveMeteoricGroup(campaignId = 1) {
    // 1. Tenta pegar o grupo atual marcado na campanha se não estiver lotado
    const campaign = this.getMeteoricCampaign(campaignId);
    if (campaign && campaign.current_group_id) {
      const current = this.getMeteoricGroupById(campaign.current_group_id);
      if (current && !current.is_full) {
        return current;
      }
    }
    // 2. Procura o último grupo criado que ainda não atingiu o limite de capacidade
    const group = db.prepare(`
      SELECT * FROM meteoric_groups 
      WHERE campaign_id = ? AND is_full = 0 
      ORDER BY group_num DESC, id DESC 
      LIMIT 1
    `).get(campaignId);

    return group || null;
  },

  createMeteoricGroup(data) {
    const {
      campaign_id = 1,
      group_jid,
      group_num = 1,
      title,
      invite_code = '',
      invite_url = '',
      member_count = 0,
      max_limit = 200,
      is_full = 0,
      is_closed = 1
    } = data;

    const res = db.prepare(`
      INSERT INTO meteoric_groups (
        campaign_id, group_jid, group_num, title,
        invite_code, invite_url, member_count, max_limit,
        is_full, is_closed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign_id, group_jid, group_num, title,
      invite_code, invite_url, member_count, max_limit,
      is_full, is_closed
    );

    const newGroup = this.getMeteoricGroupById(Number(res.lastInsertRowid));

    // Atualiza campanha com este grupo como ativo e incrementa contador
    db.prepare(`
      UPDATE meteoric_campaigns 
      SET current_group_id = ?, total_groups_created = total_groups_created + 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newGroup.id, campaign_id);

    return newGroup;
  },

  updateMeteoricGroup(id, updates = {}) {
    const allowed = [
      'title', 'invite_code', 'invite_url', 'member_count',
      'max_limit', 'is_full', 'is_closed'
    ];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE meteoric_groups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }

    return this.getMeteoricGroupById(id);
  },

  getMeteoricStages() {
    return db.prepare('SELECT * FROM meteoric_stages ORDER BY stage_num ASC').all();
  },

  getMeteoricStage(stageNum) {
    return db.prepare('SELECT * FROM meteoric_stages WHERE stage_num = ?').get(stageNum);
  },

  updateMeteoricStage(stageNum, updates = {}) {
    const allowed = ['title', 'description', 'admin_announcement', 'group_mode', 'subbot_scripts', 'executed_at', 'scheduled_at', 'auto_execute', 'media_url'];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      }
    }

    if (sets.length > 0) {
      vals.push(stageNum);
      db.prepare(`UPDATE meteoric_stages SET ${sets.join(', ')} WHERE stage_num = ?`).run(...vals);
    }

    return this.getMeteoricStage(stageNum);
  },

  getDueScheduledStages() {
    return db.prepare(`
      SELECT * FROM meteoric_stages
      WHERE auto_execute = 1
        AND scheduled_at IS NOT NULL
        AND datetime(scheduled_at) <= datetime('now')
        AND (executed_at IS NULL OR datetime(executed_at) < datetime(scheduled_at))
      ORDER BY stage_num ASC
    `).all();
  },

  incrementMeteoricLeads(campaignId = 1) {
    db.prepare('UPDATE meteoric_campaigns SET total_leads_reached = total_leads_reached + 1 WHERE id = ?').run(campaignId);
  },

  deleteMeteoricGroup(id) {
    return db.prepare('DELETE FROM meteoric_groups WHERE id = ?').run(id);
  },

  logMeteoricActivity({ campaign_id = 1, group_jid = null, group_title = null, event_type, sender_name = null, message_text = null }) {
    const stmt = db.prepare(`
      INSERT INTO meteoric_activity_logs (campaign_id, group_jid, group_title, event_type, sender_name, message_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(campaign_id, group_jid, group_title, event_type, sender_name, message_text);
  },

  getMeteoricActivityLogs(limit = 40) {
    return db.prepare('SELECT * FROM meteoric_activity_logs ORDER BY id DESC LIMIT ?').all(limit);
  },

  clearMeteoricActivityLogs() {
    return db.prepare('DELETE FROM meteoric_activity_logs').run();
  },

  // ==========================================
  // 17. RADAR VIRAL & CRIADOR DE POSTS
  // ==========================================
  getViralProfiles(filter = {}) {
    let sql = 'SELECT * FROM viral_tracked_profiles WHERE 1=1';
    const params = [];

    if (filter.platform) {
      sql += ' AND platform = ?';
      params.push(filter.platform.toLowerCase());
    }
    if (filter.auto_scrape !== undefined) {
      sql += ' AND auto_scrape = ?';
      params.push(filter.auto_scrape ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(...params);
  },

  getViralProfileById(id) {
    return db.prepare('SELECT * FROM viral_tracked_profiles WHERE id = ?').get(id);
  },

  getViralProfileByUsername(platform, username) {
    const cleanUser = String(username).replace(/^@+/, '').trim().toLowerCase();
    return db.prepare('SELECT * FROM viral_tracked_profiles WHERE platform = ? AND LOWER(username) = ?').get(platform.toLowerCase(), cleanUser);
  },

  createViralProfile({ platform, username, display_name = null, profile_url = null, niche = 'Geral', auto_scrape = 1, notes = null }) {
    const cleanPlat = String(platform || 'instagram').toLowerCase();
    const cleanUser = String(username).replace(/^@+/, '').trim().toLowerCase();
    const existing = this.getViralProfileByUsername(cleanPlat, cleanUser);
    if (existing) return existing;

    const fullUrl = profile_url || (cleanPlat === 'instagram' ? `https://instagram.com/${cleanUser}` : `https://facebook.com/${cleanUser}`);
    const name = display_name || cleanUser;

    const stmt = db.prepare(`
      INSERT INTO viral_tracked_profiles (platform, username, display_name, profile_url, niche, auto_scrape, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(cleanPlat, cleanUser, name, fullUrl, niche || 'Geral', auto_scrape ? 1 : 0, notes || null);
    return this.getViralProfileById(Number(res.lastInsertRowid));
  },

  updateViralProfile(id, updates = {}) {
    const allowed = ['display_name', 'profile_url', 'niche', 'followers_count', 'avg_likes', 'auto_scrape', 'last_scraped_at', 'total_captured', 'notes'];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE viral_tracked_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return this.getViralProfileById(id);
  },

  deleteViralProfile(id) {
    try {
      db.prepare('DELETE FROM viral_captured_posts WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM viral_generated_posts WHERE profile_id = ?').run(id);
    } catch (_) {}
    return db.prepare('DELETE FROM viral_tracked_profiles WHERE id = ?').run(id);
  },

  getViralCapturedPosts(filter = {}) {
    let sql = `
      SELECT vcp.*, vtp.display_name as profile_display_name, vtp.followers_count as profile_followers
      FROM viral_captured_posts vcp
      LEFT JOIN viral_tracked_profiles vtp ON vcp.profile_id = vtp.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.platform) {
      sql += ' AND vcp.platform = ?';
      params.push(filter.platform.toLowerCase());
    }
    if (filter.profile_id) {
      sql += ' AND vcp.profile_id = ?';
      params.push(Number(filter.profile_id));
    }
    if (filter.min_score) {
      sql += ' AND vcp.viral_score >= ?';
      params.push(Number(filter.min_score));
    }
    if (filter.status) {
      sql += ' AND vcp.status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY vcp.viral_score DESC, vcp.captured_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(Number(filter.limit));
    }

    return db.prepare(sql).all(...params);
  },

  getViralCapturedPostById(id) {
    return db.prepare(`
      SELECT vcp.*, vtp.display_name as profile_display_name, vtp.followers_count as profile_followers
      FROM viral_captured_posts vcp
      LEFT JOIN viral_tracked_profiles vtp ON vcp.profile_id = vtp.id
      WHERE vcp.id = ?
    `).get(id);
  },

  createViralCapturedPost(data) {
    const existing = db.prepare('SELECT id FROM viral_captured_posts WHERE post_url = ? OR (post_id IS NOT NULL AND post_id = ?)').get(data.post_url, data.post_id || null);
    if (existing) {
      return this.updateViralCapturedPost(existing.id, data);
    }

    const stmt = db.prepare(`
      INSERT INTO viral_captured_posts (
        profile_id, platform, source_username, post_id, post_url,
        media_type, media_url, thumbnail_url, caption, hook_text,
        likes_count, comments_count, shares_count, views_count, viral_score, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      data.profile_id || null,
      data.platform || 'instagram',
      data.source_username || '',
      data.post_id || null,
      data.post_url,
      data.media_type || 'video',
      data.media_url || null,
      data.thumbnail_url || null,
      data.caption || '',
      data.hook_text || (data.caption ? data.caption.split('\n')[0].slice(0, 150) : ''),
      Number(data.likes_count || 0),
      Number(data.comments_count || 0),
      Number(data.shares_count || 0),
      Number(data.views_count || 0),
      Number(data.viral_score || 80),
      data.status || 'NEW'
    );

    if (data.profile_id) {
      db.prepare("UPDATE viral_tracked_profiles SET total_captured = total_captured + 1, last_scraped_at = datetime('now') WHERE id = ?").run(data.profile_id);
    }

    return this.getViralCapturedPostById(Number(res.lastInsertRowid));
  },

  updateViralCapturedPost(id, updates = {}) {
    const allowed = ['caption', 'hook_text', 'likes_count', 'comments_count', 'shares_count', 'views_count', 'viral_score', 'status', 'thumbnail_url', 'media_url'];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE viral_captured_posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return this.getViralCapturedPostById(id);
  },

  deleteViralCapturedPost(id) {
    return db.prepare('DELETE FROM viral_captured_posts WHERE id = ?').run(id);
  },

  getViralGeneratedPosts(filter = {}) {
    let sql = `
      SELECT vgp.*, p.name as product_name, p.price_brl as product_price_brl,
             vcp.source_username as source_username, vcp.post_url as source_post_url
      FROM viral_generated_posts vgp
      LEFT JOIN products p ON vgp.product_id = p.id
      LEFT JOIN viral_captured_posts vcp ON vgp.source_post_id = vcp.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.status) {
      sql += ' AND vgp.status = ?';
      params.push(filter.status);
    }
    if (filter.profile_id) {
      sql += ' AND vgp.profile_id = ?';
      params.push(Number(filter.profile_id));
    }

    sql += ' ORDER BY vgp.created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(Number(filter.limit));
    }

    return db.prepare(sql).all(...params);
  },

  getViralGeneratedPostById(id) {
    return db.prepare(`
      SELECT vgp.*, p.name as product_name, p.price_brl as product_price_brl,
             vcp.source_username as source_username, vcp.post_url as source_post_url
      FROM viral_generated_posts vgp
      LEFT JOIN products p ON vgp.product_id = p.id
      LEFT JOIN viral_captured_posts vcp ON vgp.source_post_id = vcp.id
      WHERE vgp.id = ?
    `).get(id);
  },

  createViralGeneratedPost(data) {
    const stmt = db.prepare(`
      INSERT INTO viral_generated_posts (
        source_post_id, profile_id, title, target_platform, tone, objective,
        product_id, hook, body, cta, hashtags, media_suggestion, full_content, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      data.source_post_id || null,
      data.profile_id || null,
      data.title || 'Novo Post Viral',
      data.target_platform || 'whatsapp',
      data.tone || 'Comercial & Persuasivo',
      data.objective || 'Vendas & Conversão',
      data.product_id || null,
      data.hook || '',
      data.body || '',
      data.cta || '',
      data.hashtags || '',
      data.media_suggestion || '',
      data.full_content || '',
      data.status || 'READY'
    );

    if (data.source_post_id) {
      try {
        db.prepare("UPDATE viral_captured_posts SET status = 'USED' WHERE id = ?").run(data.source_post_id);
      } catch (_) {}
    }

    return this.getViralGeneratedPostById(Number(res.lastInsertRowid));
  },

  updateViralGeneratedPost(id, updates = {}) {
    const allowed = ['title', 'target_platform', 'tone', 'objective', 'product_id', 'hook', 'body', 'cta', 'hashtags', 'media_suggestion', 'full_content', 'status', 'published_at'];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }

    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE viral_generated_posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return this.getViralGeneratedPostById(id);
  },

  deleteViralGeneratedPost(id) {
    return db.prepare('DELETE FROM viral_generated_posts WHERE id = ?').run(id);
  },

  getViralStats() {
    const profiles = db.prepare('SELECT COUNT(*) as count FROM viral_tracked_profiles').get().count;
    const captured = db.prepare('SELECT COUNT(*) as count FROM viral_captured_posts').get().count;
    const generated = db.prepare('SELECT COUNT(*) as count FROM viral_generated_posts').get().count;
    const avgScore = db.prepare('SELECT ROUND(AVG(viral_score), 1) as avg FROM viral_captured_posts').get().avg || 0;

    return {
      totalProfiles: profiles,
      totalCaptured: captured,
      totalGenerated: generated,
      avgViralScore: avgScore
    };
  },

  // ==========================================
  // 17. CENTRAL DE AVISOS, ALERTAS & BROADCAST (SISTEMAS AVISOS PC)
  // ==========================================
  createNotice({ title, message, category = 'info', color = '#2196f3', sender = 'Admin', target = 'all', sound_alert = 1 }) {
    const stmt = db.prepare(`
      INSERT INTO system_notices (title, message, category, color, sender, target, sound_alert)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(title, message, category, color, sender, target, sound_alert ? 1 : 0);
    return this.getNoticeById(Number(res.lastInsertRowid));
  },

  getNoticeById(id) {
    const notice = db.prepare('SELECT * FROM system_notices WHERE id = ?').get(id);
    if (!notice) return null;
    notice.responses = this.getNoticeResponses(id);
    return notice;
  },

  getNotices(limit = 50, status = null) {
    let sql = 'SELECT * FROM system_notices';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return rows.map(n => {
      n.responses = this.getNoticeResponses(n.id);
      return n;
    });
  },

  addNoticeResponse(noticeId, respondent, responseText) {
    const stmt = db.prepare(`
      INSERT INTO system_notice_responses (notice_id, respondent, response_text)
      VALUES (?, ?, ?)
    `);
    const res = stmt.run(noticeId, respondent || 'Operador', responseText);
    return {
      id: Number(res.lastInsertRowid),
      notice_id: noticeId,
      respondent,
      response_text: responseText,
      created_at: new Date().toISOString()
    };
  },

  getNoticeResponses(noticeId) {
    return db.prepare('SELECT * FROM system_notice_responses WHERE notice_id = ? ORDER BY id ASC').all(noticeId);
  },

  archiveNotice(id) {
    return db.prepare("UPDATE system_notices SET status = 'archived' WHERE id = ?").run(id);
  },

  deleteNotice(id) {
    return db.prepare('DELETE FROM system_notices WHERE id = ?').run(id);
  },

  // ==========================================
  // 18. VITRINE & CATÁLOGO E-COMMERCE (SPY TECH SOLUTIONS)
  // ==========================================
  getStoreProducts(category = null, search = null) {
    let sql = 'SELECT * FROM products WHERE active = 1 AND (army_instance_id IS NULL OR army_instance_id = 0)';
    const params = [];
    if (category && category !== 'Todos') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search && search.trim()) {
      sql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }
    sql += ' ORDER BY id DESC';
    return db.prepare(sql).all(...params);
  },

  // ==========================================
  // 19. TAREFAS DELEGADAS AOS SUB-BOTS (COMANDO DA MATRIZ)
  // ==========================================
  createDelegatedTask({
    assigned_instance_id = null,
    task_type = 'DIRECT_MESSAGE',
    title,
    description = '',
    target = null,
    message_payload = null,
    delegated_by = 'OWNER',
    scheduled_at = null
  }) {
    const taskCode = `TSK-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const stmt = db.prepare(`
      INSERT INTO subbot_delegated_tasks (
        task_code, assigned_instance_id, task_type, title, description, target, message_payload, status, delegated_by, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `);
    const res = stmt.run(
      taskCode,
      assigned_instance_id ? Number(assigned_instance_id) : null,
      task_type,
      title || 'Tarefa Delegada',
      description || '',
      target || '',
      message_payload || '',
      delegated_by || 'OWNER',
      scheduled_at ? new Date(scheduled_at).toISOString() : null
    );
    return this.getDelegatedTaskById(Number(res.lastInsertRowid));
  },

  updateDelegatedTask(id, data = {}) {
    const existing = this.getDelegatedTaskById(id);
    if (!existing) return null;

    const status = data.status || existing.status;
    const result_summary = data.result_summary !== undefined ? data.result_summary : existing.result_summary;
    const completed_at = (status === 'COMPLETED' || status === 'FAILED') ? (data.completed_at || new Date().toISOString()) : existing.completed_at;
    const scheduled_at = data.scheduled_at !== undefined ? (data.scheduled_at ? new Date(data.scheduled_at).toISOString() : null) : existing.scheduled_at;

    db.prepare(`
      UPDATE subbot_delegated_tasks
      SET status = ?, result_summary = ?, completed_at = ?, scheduled_at = ?
      WHERE id = ?
    `).run(status, result_summary, completed_at, scheduled_at, id);

    return this.getDelegatedTaskById(id);
  },

  getDelegatedTasks({ limit = 50, status = null, instanceId = null } = {}) {
    let sql = `
      SELECT t.*, i.name as bot_name, i.phone as bot_phone, i.is_business as bot_is_business
      FROM subbot_delegated_tasks t
      LEFT JOIN whatsapp_army_instances i ON t.assigned_instance_id = i.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (instanceId) {
      sql += ' AND t.assigned_instance_id = ?';
      params.push(Number(instanceId));
    }
    sql += ' ORDER BY t.id DESC LIMIT ?';
    params.push(Number(limit) || 50);

    return db.prepare(sql).all(...params);
  },

  getDelegatedTaskById(id) {
    return db.prepare(`
      SELECT t.*, i.name as bot_name, i.phone as bot_phone, i.is_business as bot_is_business
      FROM subbot_delegated_tasks t
      LEFT JOIN whatsapp_army_instances i ON t.assigned_instance_id = i.id
      WHERE t.id = ?
    `).get(id);
  },

  getDelegatedTaskByCode(taskCode) {
    return db.prepare(`
      SELECT t.*, i.name as bot_name, i.phone as bot_phone, i.is_business as bot_is_business
      FROM subbot_delegated_tasks t
      LEFT JOIN whatsapp_army_instances i ON t.assigned_instance_id = i.id
      WHERE t.task_code = ?
    `).get(taskCode);
  },

  getDelegatedTasksSummary() {
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM subbot_delegated_tasks
      GROUP BY status
    `).all();

    const summary = { total: 0, PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, FAILED: 0 };
    rows.forEach(r => {
      summary[r.status] = r.count;
      summary.total += r.count;
    });
    return summary;
  },

  getDueScheduledDelegatedTasks() {
    return db.prepare(`
      SELECT t.*, i.name as bot_name, i.phone as bot_phone, i.is_business as bot_is_business
      FROM subbot_delegated_tasks t
      LEFT JOIN whatsapp_army_instances i ON t.assigned_instance_id = i.id
      WHERE t.status = 'PENDING'
        AND t.scheduled_at IS NOT NULL
        AND datetime(t.scheduled_at) <= datetime('now')
      ORDER BY t.scheduled_at ASC
    `).all();
  },


  // ==========================================
  // 32. MODERAÇÃO INTELIGENTE & CROWD-REPORTING
  // ==========================================
  recordModerationReport({
    message_id = null,
    group_jid,
    group_name = null,
    reported_author_jid = null,
    reported_author_name = null,
    reporter_jid,
    reporter_name = null,
    reported_text = '',
    normalized_text = '',
    spam_score = 0,
    category = 'Geral',
    evidence = '[]',
    dampeners = '[]',
    status = 'PENDING',
    action_taken = 'QUEUED',
    note = null
  }) {
    const stmt = db.prepare(`
      INSERT INTO moderation_reports (
        message_id, group_jid, group_name, reported_author_jid, reported_author_name,
        reporter_jid, reporter_name, reported_text, normalized_text, spam_score,
        category, evidence, dampeners, status, action_taken, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      message_id,
      group_jid,
      group_name,
      reported_author_jid,
      reported_author_name,
      reporter_jid,
      reporter_name,
      reported_text,
      normalized_text,
      Number(spam_score || 0),
      category,
      typeof evidence === 'string' ? evidence : JSON.stringify(evidence || []),
      typeof dampeners === 'string' ? dampeners : JSON.stringify(dampeners || []),
      status,
      action_taken,
      note
    );
    return models.getModerationReportById(Number(res.lastInsertRowid));
  },

  getModerationReportById(id) {
    return db.prepare('SELECT * FROM moderation_reports WHERE id = ?').get(id);
  },

  getModerationReports({ limit = 50, status = null, group_jid = null } = {}) {
    let sql = 'SELECT * FROM moderation_reports';
    const params = [];
    const where = [];

    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (group_jid) {
      where.push('group_jid = ?');
      params.push(group_jid);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit) || 50);

    return db.prepare(sql).all(...params);
  },

  updateModerationReport(id, data = {}) {
    const existing = models.getModerationReportById(id);
    if (!existing) return null;

    const status = data.status !== undefined ? data.status : existing.status;
    const action_taken = data.action_taken !== undefined ? data.action_taken : existing.action_taken;
    const note = data.note !== undefined ? data.note : existing.note;

    db.prepare(`
      UPDATE moderation_reports
      SET status = ?, action_taken = ?, note = ?
      WHERE id = ?
    `).run(status, action_taken, note, id);

    return models.getModerationReportById(id);
  },

  deleteModerationReport(id) {
    const res = db.prepare('DELETE FROM moderation_reports WHERE id = ?').run(id);
    return res.changes > 0;
  },

  clearOldModerationReports(days = 7) {
    const res = db.prepare(`
      DELETE FROM moderation_reports
      WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
    `).run(Number(days) || 7);
    return res.changes;
  },

  getModerationStats() {
    try {
      const counts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'DELETED' OR action_taken = 'DELETED' THEN 1 ELSE 0 END) as deleted,
          SUM(CASE WHEN status = 'DISMISSED' THEN 1 ELSE 0 END) as dismissed
        FROM moderation_reports
      `).get() || { total: 0, pending: 0, deleted: 0, dismissed: 0 };

      return {
        total: counts.total || 0,
        pending: counts.pending || 0,
        deleted: counts.deleted || 0,
        dismissed: counts.dismissed || 0,
        mode: models.getSetting('MODERATION_MODE', 'enforce'),
        auto_delete: models.getSetting('MODERATION_AUTO_DELETE', 'true') === 'true',
        block_threshold: parseFloat(models.getSetting('MODERATION_BLOCK_THRESHOLD', '0.80')) || 0.80
      };
    } catch (_) {
      return { total: 0, pending: 0, deleted: 0, dismissed: 0, mode: 'enforce', auto_delete: true, block_threshold: 0.80 };
    }
  },

  getModerationRules() {
    try {
      return db.prepare('SELECT * FROM moderation_rules ORDER BY weight DESC').all();
    } catch (_) {
      return [];
    }
  },

  bumpRuleHits(ruleNames = []) {
    if (!Array.isArray(ruleNames) || ruleNames.length === 0) return;
    try {
      const stmt = db.prepare('UPDATE moderation_rules SET hits = hits + 1 WHERE name = ?');
      for (const name of ruleNames) {
        stmt.run(name);
      }
    } catch (_) {}
  },

  getPendingLeadsForBalancing(limit = 100) {
    return db.prepare(`
      SELECT DISTINCT phone, name FROM (
        SELECT phone, name FROM campaign_leads WHERE status = 'PENDING'
        UNION
        SELECT phone, name FROM lead_funnel_conversations WHERE status = 'ACTIVE'
        UNION
        SELECT 
          REPLACE(REPLACE(REPLACE(platform_user_id, '@s.whatsapp.net', ''), '@c.us', ''), '+', '') as phone,
          platform_user_name as name
        FROM orders
        WHERE platform = 'whatsapp' AND length(platform_user_id) >= 10
      ) WHERE phone IS NOT NULL AND length(phone) >= 8
      LIMIT ?
    `).all(Number(limit) || 100);
  },

  getBotsLiveTelemetry() {
    const BOT_ROLES = {
      'MATRIZ_ORCHESTRATOR': {
        code: 'MATRIZ_ORCHESTRATOR',
        label: 'Atendimento Matriz & Venda Consultiva',
        badge: 'badge-primary',
        icon: 'fa-solid fa-crown',
        color: '#f59e0b',
        description: 'Qualificação B2B de softwares, apps, IA, SEO e fechamento Pix'
      },
      'LEAD_OUTREACH': {
        code: 'LEAD_OUTREACH',
        label: 'Disparo & Nutrição de Leads',
        badge: 'badge-info',
        icon: 'fa-solid fa-bullhorn',
        color: '#38bdf8',
        description: 'Prospecção fria e morna com Spintax anti-ban e apresentação de catálogo'
      },
      'METEORIC_WARMUP': {
        code: 'METEORIC_WARMUP',
        label: 'Aquecimento Meteórico de Grupos',
        badge: 'badge-danger',
        icon: 'fa-solid fa-meteor',
        color: '#ef4444',
        description: 'Simulação de prova social e hype nos grupos de lançamentos e ofertas'
      },
      'BUSINESS_CATALOG': {
        code: 'BUSINESS_CATALOG',
        label: 'Vitrine WhatsApp Business',
        badge: 'badge-success',
        icon: 'fa-solid fa-store',
        color: '#10b981',
        description: 'Catálogo de produtos tech, checkout direto e conversão automática'
      },
      'MODERATION_GUARD': {
        code: 'MODERATION_GUARD',
        label: 'Moderação Heurística & Anti-Golpe',
        badge: 'badge-purple',
        icon: 'fa-solid fa-shield-halved',
        color: '#8b5cf6',
        description: 'Escuta passiva de grupos, normalizador unicode, crowd-reporting e anti-flood'
      },
      'CART_RECOVERY': {
        code: 'CART_RECOVERY',
        label: 'Recuperação de Carrinho Abandonado',
        badge: 'badge-warning',
        icon: 'fa-solid fa-cart-shopping',
        color: '#ec4899',
        description: 'Contato com pedidos pendentes, cupons de desconto e urgência de estoque'
      },
      'VOICE_SYNTH_PTT': {
        code: 'VOICE_SYNTH_PTT',
        label: 'Disparador de Voz Sintética PTT',
        badge: 'badge-secondary',
        icon: 'fa-solid fa-microphone-lines',
        color: '#06b6d4',
        description: 'Notas de voz sintéticas humanizadas para alta taxa de abertura e confiança'
      }
    };

    const instances = models.getArmyInstances();
    const now = new Date();
    const hoursElapsed = Math.max(1, now.getHours() + (now.getMinutes() / 60));
    const hoursRemaining = Math.max(1, 24 - hoursElapsed);
    const avgTicketBrl = 497;
    const estConversionRate = 0.038;

    let clusterDailySent = 0;
    let clusterTotalCapacity = 0;
    let clusterProjectedReach = 0;
    let clusterProjectedSales = 0;
    let clusterProjectedRevenueBrl = 0;
    let clusterConnectedCount = 0;

    const bots = instances.map(inst => {
      const isMain = !!inst.is_main;
      const isBusiness = !!inst.is_business;
      const roleCode = (inst.role && inst.role !== 'LEAD_OUTREACH')
        ? inst.role
        : (isMain ? 'MATRIZ_ORCHESTRATOR' : (isBusiness ? 'BUSINESS_CATALOG' : (inst.role || 'LEAD_OUTREACH')));
      const roleMeta = BOT_ROLES[roleCode] || BOT_ROLES['LEAD_OUTREACH'];

      const dailyLimit = Number(inst.daily_limit || 50);
      const sentToday = Number(inst.messages_sent_today || 0);
      const quotaPercentage = dailyLimit > 0 ? Math.min(100, Math.round((sentToday / dailyLimit) * 100)) : 0;

      const isConnected = inst.status === 'CONNECTED';
      if (isConnected) clusterConnectedCount++;
      const isPaused = inst.status === 'PAUSED';
      const isWarmup = Boolean(inst.warmup_mode);

      const healthScore = isConnected ? 99.4 : (isPaused ? 65.0 : (isWarmup ? 85.0 : 15.0));
      const deliverySuccessRate = Number(inst.delivery_success_rate || 98.8);

      const usageRatio = dailyLimit > 0 ? (sentToday / dailyLimit) : 0;
      const antiBanSafetyScore = Math.max(25, Math.min(100, Math.round((1 - (usageRatio * 0.55)) * 100)));
      const safetyTier = antiBanSafetyScore >= 80 ? 'SAFE' : (antiBanSafetyScore >= 60 ? 'MODERATE' : 'WARNING');

      // Projeções
      const pacePerHour = sentToday > 0 ? (sentToday / hoursElapsed) : (isWarmup ? 2 : 1);
      const remainingQuota = Math.max(0, dailyLimit - sentToday);
      const projectedAdditional = Math.min(remainingQuota, Math.round(pacePerHour * hoursRemaining));
      const projectedDailyReach = sentToday + projectedAdditional;
      const projectedSales = Math.max(0, Math.round(projectedDailyReach * estConversionRate));
      const projectedRevenueBrl = projectedSales * avgTicketBrl;

      clusterDailySent += sentToday;
      clusterTotalCapacity += dailyLimit;
      clusterProjectedReach += projectedDailyReach;
      clusterProjectedSales += projectedSales;
      clusterProjectedRevenueBrl += projectedRevenueBrl;

      // Tarefa atual / mais recente
      let currentTaskDesc = 'Em prontidão para atendimento e missões';
      try {
        const latestTask = db.prepare('SELECT title, status, task_type FROM subbot_delegated_tasks WHERE assigned_instance_id = ? ORDER BY id DESC LIMIT 1').get(inst.id);
        if (latestTask) {
          currentTaskDesc = `${latestTask.title} (${latestTask.status})`;
        }
      } catch (_) {}

      return {
        id: inst.id,
        name: inst.name,
        phone: inst.phone,
        session_id: inst.session_id,
        status: inst.status,
        is_main: isMain,
        is_business: isBusiness,
        warmup_mode: isWarmup,
        active: Boolean(inst.active),
        role: roleCode,
        role_meta: roleMeta,
        daily_limit: dailyLimit,
        messages_sent_today: sentToday,
        quota_percentage: quotaPercentage,
        health_score: healthScore,
        delivery_success_rate: deliverySuccessRate,
        anti_ban_safety_score: antiBanSafetyScore,
        safety_tier: safetyTier,
        projected_daily_reach: projectedDailyReach,
        projected_sales: projectedSales,
        projected_revenue_brl: projectedRevenueBrl,
        pace_per_hour: Number(pacePerHour.toFixed(1)),
        time_to_exhaustion: pacePerHour > 0.2 ? `~${(remainingQuota / pacePerHour).toFixed(1)}h` : 'Disponível',
        current_task: currentTaskDesc
      };
    });

    const clusterQuotaPercentage = clusterTotalCapacity > 0 ? Math.min(100, Math.round((clusterDailySent / clusterTotalCapacity) * 100)) : 0;
    const clusterHealthAvg = bots.length > 0 ? Number((bots.reduce((a, b) => a + b.health_score, 0) / bots.length).toFixed(1)) : 100.0;
    const clusterSafetyScore = bots.length > 0 ? Math.round(bots.reduce((a, b) => a + b.anti_ban_safety_score, 0) / bots.length) : 95;

    return {
      timestamp: new Date().toISOString(),
      available_roles: BOT_ROLES,
      roles_catalog: BOT_ROLES,
      cluster: {
        total_bots: bots.length,
        connected_bots: clusterConnectedCount,
        daily_sent: clusterDailySent,
        total_capacity: clusterTotalCapacity,
        quota_percentage: clusterQuotaPercentage,
        projected_reach: clusterProjectedReach,
        projected_sales: clusterProjectedSales,
        projected_revenue_brl: clusterProjectedRevenueBrl,
        health_score: clusterHealthAvg,
        safety_score: clusterSafetyScore,
        safety_tier: clusterSafetyScore >= 80 ? 'SAFE' : (clusterSafetyScore >= 60 ? 'MODERATE' : 'WARNING')
      },
      bots
    };
  },

  // ==========================================
  // 35. HEXIS CONSULTATIVE SALES INTELLIGENCE & EPISODIC CRM
  // ==========================================
  getLeadCognitiveProfile(phone) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const profile = db.prepare('SELECT * FROM lead_cognitive_profiles WHERE phone = ?').get(cleanPhone);
    if (!profile) return null;
    profile.beliefs = models.getLeadBeliefs(cleanPhone);
    profile.memories = models.getLeadEpisodicMemories(cleanPhone, 15);
    return profile;
  },

  upsertLeadCognitiveProfile(phone, data = {}) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const existing = db.prepare('SELECT * FROM lead_cognitive_profiles WHERE phone = ?').get(cleanPhone);

    const now = new Date().toISOString();
    if (!existing) {
      db.prepare(`
        INSERT INTO lead_cognitive_profiles (
          phone, name, company_niche, project_scope, tech_stack,
          budget_tier, budget_confidence, buying_stage, readiness_score,
          main_objection, objection_confidence, last_quote_amount, last_quote_details,
          next_followup_at, followup_count, notes, last_interaction_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanPhone,
        data.name || 'Lead WhatsApp',
        data.company_niche || 'Geral / Tech',
        data.project_scope || 'Software & Soluções Digitais',
        data.tech_stack || 'Node.js, Web, Automações',
        data.budget_tier || 'MEDIO',
        data.budget_confidence !== undefined ? Number(data.budget_confidence) : 0.5,
        data.buying_stage || 'DESCOBERTA',
        data.readiness_score !== undefined ? Number(data.readiness_score) : 30,
        data.main_objection || 'NENHUMA',
        data.objection_confidence !== undefined ? Number(data.objection_confidence) : 0.0,
        data.last_quote_amount !== undefined ? Number(data.last_quote_amount) : 0,
        data.last_quote_details ?? null,
        data.next_followup_at ?? null,
        data.followup_count ?? 0,
        data.notes ?? '',
        now,
        now
      );
    } else {
      const updated = {
        name: data.name ?? existing.name ?? 'Lead WhatsApp',
        company_niche: data.company_niche ?? existing.company_niche ?? 'Geral / Tech',
        project_scope: data.project_scope ?? existing.project_scope ?? 'Software & Soluções Digitais',
        tech_stack: data.tech_stack ?? existing.tech_stack ?? 'Node.js, Web, Automações',
        budget_tier: data.budget_tier ?? existing.budget_tier ?? 'MEDIO',
        budget_confidence: data.budget_confidence !== undefined ? Number(data.budget_confidence) : (existing.budget_confidence ?? 0.5),
        buying_stage: data.buying_stage ?? existing.buying_stage ?? 'DESCOBERTA',
        readiness_score: data.readiness_score !== undefined ? Number(data.readiness_score) : (existing.readiness_score ?? 30),
        main_objection: data.main_objection ?? existing.main_objection ?? 'NENHUMA',
        objection_confidence: data.objection_confidence !== undefined ? Number(data.objection_confidence) : (existing.objection_confidence ?? 0.0),
        last_quote_amount: data.last_quote_amount !== undefined ? Number(data.last_quote_amount) : (existing.last_quote_amount ?? 0),
        last_quote_details: data.last_quote_details ?? existing.last_quote_details ?? null,
        next_followup_at: data.next_followup_at ?? existing.next_followup_at ?? null,
        followup_count: data.followup_count !== undefined ? Number(data.followup_count) : (existing.followup_count ?? 0),
        notes: data.notes ?? existing.notes ?? ''
      };

      db.prepare(`
        UPDATE lead_cognitive_profiles SET
          name = ?, company_niche = ?, project_scope = ?, tech_stack = ?,
          budget_tier = ?, budget_confidence = ?, buying_stage = ?, readiness_score = ?,
          main_objection = ?, objection_confidence = ?, last_quote_amount = ?, last_quote_details = ?,
          next_followup_at = ?, followup_count = ?, notes = ?, last_interaction_at = ?, updated_at = ?
        WHERE phone = ?
      `).run(
        updated.name, updated.company_niche, updated.project_scope, updated.tech_stack,
        updated.budget_tier, updated.budget_confidence, updated.buying_stage, updated.readiness_score,
        updated.main_objection, updated.objection_confidence, updated.last_quote_amount, updated.last_quote_details,
        updated.next_followup_at, updated.followup_count, updated.notes, now, now,
        cleanPhone
      );
    }
    return models.getLeadCognitiveProfile(cleanPhone);
  },

  updateLeadBelief(phone, key, value, evidence = '', confidence = 0.5) {
    if (!phone || !key) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const conf = Math.max(0.0, Math.min(1.0, Number(confidence) || 0.5));
    db.prepare(`
      INSERT INTO lead_cognitive_beliefs (lead_phone, belief_key, belief_value, evidence_text, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(lead_phone, belief_key) DO UPDATE SET
        belief_value = excluded.belief_value,
        evidence_text = excluded.evidence_text,
        confidence = excluded.confidence,
        updated_at = CURRENT_TIMESTAMP
    `).run(cleanPhone, key, String(value), String(evidence || ''), conf);
    return models.getLeadBeliefs(cleanPhone);
  },

  getLeadBeliefs(phone) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM lead_cognitive_beliefs WHERE lead_phone = ? ORDER BY confidence DESC').all(cleanPhone);
  },

  addLeadEpisodicMemory(phone, memoryType, factSummary, rawExcerpt = '', importance = 3) {
    if (!phone || !factSummary) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const imp = Math.max(1, Math.min(5, parseInt(importance, 10) || 3));
    const res = db.prepare(`
      INSERT INTO lead_episodic_memories (lead_phone, memory_type, fact_summary, raw_excerpt, importance)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanPhone, memoryType || 'REQUIREMENT', factSummary, rawExcerpt || '', imp);
    return { id: Number(res.lastInsertRowid), phone: cleanPhone, memoryType, factSummary, importance: imp };
  },

  getLeadEpisodicMemories(phone, limit = 20) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM lead_episodic_memories WHERE lead_phone = ? ORDER BY created_at DESC LIMIT ?').all(cleanPhone, limit);
  },

  getLeadsPendingFollowup(limit = 20) {
    return db.prepare(`
      SELECT * FROM lead_cognitive_profiles
      WHERE (next_followup_at IS NOT NULL AND datetime(next_followup_at) <= datetime('now'))
         OR (buying_stage IN ('PROPOSTA', 'QUALIFICACAO', 'OBJECOES') AND datetime(last_interaction_at) <= datetime('now', '-24 hours'))
      ORDER BY readiness_score DESC, next_followup_at ASC
      LIMIT ?
    `).all(limit);
  },

  getCognitiveLeadsOverview() {
    const leads = db.prepare('SELECT * FROM lead_cognitive_profiles ORDER BY readiness_score DESC, updated_at DESC').all();
    for (const lead of leads) {
      lead.beliefs = models.getLeadBeliefs(lead.phone);
      lead.memories_count = db.prepare('SELECT COUNT(*) as count FROM lead_episodic_memories WHERE lead_phone = ?').get(lead.phone)?.count || 0;
    }

    const stageSummary = {
      DESCOBERTA: leads.filter(l => l.buying_stage === 'DESCOBERTA').length,
      QUALIFICACAO: leads.filter(l => l.buying_stage === 'QUALIFICACAO').length,
      PROPOSTA: leads.filter(l => l.buying_stage === 'PROPOSTA').length,
      OBJECOES: leads.filter(l => l.buying_stage === 'OBJECOES').length,
      FECHAMENTO: leads.filter(l => l.buying_stage === 'FECHAMENTO').length,
      CONVERTIDO: leads.filter(l => l.buying_stage === 'CONVERTIDO').length,
      PERDIDO: leads.filter(l => l.buying_stage === 'PERDIDO').length
    };

    const avgReadiness = leads.length > 0 ? Math.round(leads.reduce((a, b) => a + (b.readiness_score || 0), 0) / leads.length) : 0;
    const highIntentCount = leads.filter(l => (l.readiness_score || 0) >= 70).length;
    const totalPipelineValue = leads
      .filter(l => l.buying_stage !== 'PERDIDO')
      .reduce((a, b) => a + (Number(b.last_quote_amount) || (b.budget_tier === 'CORPORATIVO' ? 15000 : (b.budget_tier === 'ALTO' ? 7500 : (b.budget_tier === 'MEDIO' ? 3500 : 1200)))), 0);

    return {
      total_leads: leads.length,
      avg_readiness: avgReadiness,
      high_intent_count: highIntentCount,
      total_pipeline_value: totalPipelineValue,
      stages: stageSummary,
      leads
    };
  },

  deleteCognitiveLead(phone) {
    if (!phone) return false;
    const cleanPhone = String(phone).replace(/\D/g, '');
    db.prepare('DELETE FROM lead_cognitive_beliefs WHERE lead_phone = ?').run(cleanPhone);
    db.prepare('DELETE FROM lead_episodic_memories WHERE lead_phone = ?').run(cleanPhone);
    db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(cleanPhone);
    return true;
  },

  // ==========================================
  // 36. AGENDAMENTO DE REUNIÕES & DEMONSTRAÇÕES (GOOGLE MEET)
  // ==========================================
  createMeeting(data = {}) {
    if (!data.lead_phone || !data.meeting_date || !data.meeting_time) {
      throw new Error('Telefone, data e horário da reunião são obrigatórios.');
    }
    const cleanPhone = String(data.lead_phone).replace(/\D/g, '');
    const dateStr = String(data.meeting_date).trim();
    const timeStr = String(data.meeting_time).trim();
    const dt = data.meeting_datetime || `${dateStr} ${timeStr}:00`;
    const meetUrl = data.meet_url || `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;

    const stmt = db.prepare(`
      INSERT INTO scheduled_meetings (
        lead_phone, lead_name, meeting_title, meeting_date, meeting_time,
        meeting_datetime, duration_minutes, meet_url, topic_scope, status, notes
      ) VALUES (?, ?, ?, ?, ?, datetime(?), ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      cleanPhone,
      data.lead_name || 'Lead',
      data.meeting_title || 'Reunião de Diagnóstico Técnico & Alinhamento',
      dateStr,
      timeStr,
      dt,
      data.duration_minutes ? Number(data.duration_minutes) : 30,
      meetUrl,
      data.topic_scope || 'Software sob Medida / IA / Projetos',
      data.status || 'SCHEDULED',
      data.notes || ''
    );

    const meetingId = Number(res.lastInsertRowid);

    // Registra na memória episódica do lead
    try {
      models.addLeadEpisodicMemory(
        cleanPhone,
        'TIMELINE',
        `Reunião agendada para ${dateStr} às ${timeStr} (${meetUrl})`,
        `Meet: ${meetUrl}`,
        5
      );
      // Avança estágio cognitivo se estiver em DESCOBERTA
      const prof = models.getLeadCognitiveProfile(cleanPhone);
      if (prof && prof.buying_stage === 'DESCOBERTA') {
        models.upsertLeadCognitiveProfile(cleanPhone, { buying_stage: 'QUALIFICACAO', readiness_score: Math.max(prof.readiness_score || 30, 60) });
      }
    } catch (_) {}

    return models.getMeetingById(meetingId);
  },

  getMeetingById(id) {
    if (!id) return null;
    return db.prepare('SELECT * FROM scheduled_meetings WHERE id = ?').get(Number(id));
  },

  getMeetings(filters = {}) {
    let sql = 'SELECT * FROM scheduled_meetings WHERE 1=1';
    const params = [];

    if (filters.lead_phone) {
      sql += ' AND lead_phone = ?';
      params.push(String(filters.lead_phone).replace(/\D/g, ''));
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.date) {
      sql += ' AND meeting_date = ?';
      params.push(filters.date);
    }
    if (filters.upcomingOnly) {
      sql += " AND datetime(meeting_datetime) >= datetime('now') AND status IN ('SCHEDULED', 'CONFIRMED')";
    }

    sql += ' ORDER BY datetime(meeting_datetime) ASC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(Number(filters.limit));
    }

    return db.prepare(sql).all(...params);
  },

  updateMeeting(id, data = {}) {
    const existing = models.getMeetingById(id);
    if (!existing) return null;

    const updated = {
      meeting_title: data.meeting_title ?? existing.meeting_title,
      meeting_date: data.meeting_date ?? existing.meeting_date,
      meeting_time: data.meeting_time ?? existing.meeting_time,
      duration_minutes: data.duration_minutes ?? existing.duration_minutes,
      meet_url: data.meet_url ?? existing.meet_url,
      topic_scope: data.topic_scope ?? existing.topic_scope,
      status: data.status ?? existing.status,
      reminder_sent: data.reminder_sent !== undefined ? Number(data.reminder_sent) : existing.reminder_sent,
      notes: data.notes ?? existing.notes
    };

    const newDt = (data.meeting_date || data.meeting_time)
      ? `${updated.meeting_date} ${updated.meeting_time}:00`
      : existing.meeting_datetime;

    db.prepare(`
      UPDATE scheduled_meetings SET
        meeting_title = ?, meeting_date = ?, meeting_time = ?,
        meeting_datetime = datetime(?), duration_minutes = ?, meet_url = ?,
        topic_scope = ?, status = ?, reminder_sent = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      updated.meeting_title, updated.meeting_date, updated.meeting_time,
      newDt, updated.duration_minutes, updated.meet_url,
      updated.topic_scope, updated.status, updated.reminder_sent, updated.notes,
      Number(id)
    );

    return models.getMeetingById(id);
  },

  cancelMeeting(id, reason = '') {
    return models.updateMeeting(id, {
      status: 'CANCELED',
      notes: reason ? `Cancelado: ${reason}` : 'Cancelado pelo operador/cliente'
    });
  },

  getUpcomingMeetingReminders(withinMinutes = 60) {
    return db.prepare(`
      SELECT * FROM scheduled_meetings
      WHERE status IN ('SCHEDULED', 'CONFIRMED')
        AND reminder_sent = 0
        AND datetime(meeting_datetime) > datetime('now')
        AND datetime(meeting_datetime) <= datetime('now', '+' || ? || ' minutes')
      ORDER BY datetime(meeting_datetime) ASC
    `).all(Number(withinMinutes));
  },

  getAvailableMeetingSlots(dateStr) {
    if (!dateStr) {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      dateStr = tomorrow.toISOString().split('T')[0];
    }

    const defaultSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
    const booked = db.prepare(`
      SELECT meeting_time FROM scheduled_meetings
      WHERE meeting_date = ? AND status IN ('SCHEDULED', 'CONFIRMED')
    `).all(dateStr).map(r => r.meeting_time);

    return {
      date: dateStr,
      available_slots: defaultSlots.filter(s => !booked.includes(s)),
      booked_slots: booked
    };
  },

  // ==========================================
  // 37. PROPOSTAS COMERCIAIS & CONTRATOS INTERATIVOS (/proposta/:token)
  // ==========================================
  createProposal(data = {}) {
    if (!data.lead_phone || !data.project_title) {
      throw new Error('Telefone do lead e título do projeto são obrigatórios.');
    }
    const cleanPhone = String(data.lead_phone).replace(/\D/g, '');
    const crypto = require('crypto');
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = data.code || `PROP-2026-${randomHex}`;
    const token = data.token || crypto.randomBytes(12).toString('hex');

    const deliverables = Array.isArray(data.deliverables) ? JSON.stringify(data.deliverables) : (data.deliverables_json || '[]');
    const clauses = Array.isArray(data.contract_clauses) ? JSON.stringify(data.contract_clauses) : (data.contract_clauses_json || '[]');

    const stmt = db.prepare(`
      INSERT INTO commercial_proposals (
        code, token, lead_phone, lead_name, lead_company, project_title,
        category, scope_description, deliverables_json, tech_stack,
        timeline_weeks, investment_brl, payment_terms, contract_clauses_json,
        status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
      code,
      token,
      cleanPhone,
      data.lead_name || 'Cliente',
      data.lead_company || '',
      data.project_title,
      data.category || 'SOFTWARE',
      data.scope_description || '',
      deliverables,
      data.tech_stack || 'Node.js, React, SQLite/PostgreSQL, Baileys, Docker',
      data.timeline_weeks ? Number(data.timeline_weeks) : 3,
      data.investment_brl ? Number(data.investment_brl) : 0.0,
      data.payment_terms || '50% entrada via Pix + 50% na entrega e homologação',
      clauses,
      data.status || 'SENT',
      data.notes || ''
    );

    const proposalId = Number(res.lastInsertRowid);

    // Registra na memória episódica do lead e avança estágio no CRM cognitivo
    try {
      models.addLeadEpisodicMemory(
        cleanPhone,
        'OFFER',
        `Proposta comercial gerada: ${code} (${data.project_title}) - R$ ${Number(data.investment_brl || 0).toLocaleString('pt-BR')}`,
        `Token: ${token}`,
        5
      );
      const prof = models.getLeadCognitiveProfile(cleanPhone);
      const newStage = (prof?.readiness_score || 0) >= 80 ? 'FECHAMENTO' : 'PROPOSTA';
      models.upsertLeadCognitiveProfile(cleanPhone, {
        buying_stage: newStage,
        estimated_budget: Number(data.investment_brl || 0),
        readiness_score: Math.max(prof?.readiness_score || 40, 75)
      });
    } catch (_) {}

    return models.getProposalById(proposalId);
  },

  _formatProposalRow(row) {
    if (!row) return null;
    let deliverables = [];
    let contract_clauses = [];
    try { deliverables = JSON.parse(row.deliverables_json || '[]'); } catch (_) {}
    try { contract_clauses = JSON.parse(row.contract_clauses_json || '[]'); } catch (_) {}

    return {
      ...row,
      deliverables,
      contract_clauses
    };
  },

  getProposalById(id) {
    if (!id) return null;
    const row = db.prepare('SELECT * FROM commercial_proposals WHERE id = ?').get(Number(id));
    return models._formatProposalRow(row);
  },

  getProposalByToken(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM commercial_proposals WHERE token = ?').get(String(token).trim());
    return models._formatProposalRow(row);
  },

  getProposalByCode(code) {
    if (!code) return null;
    const row = db.prepare('SELECT * FROM commercial_proposals WHERE code = ?').get(String(code).trim());
    return models._formatProposalRow(row);
  },

  getProposals(filters = {}) {
    let sql = 'SELECT * FROM commercial_proposals WHERE 1=1';
    const params = [];

    if (filters.lead_phone) {
      sql += ' AND lead_phone = ?';
      params.push(String(filters.lead_phone).replace(/\D/g, ''));
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }

    sql += ' ORDER BY created_at DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(Number(filters.limit));
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(r => models._formatProposalRow(r));
  },

  updateProposal(id, data = {}) {
    const existing = models.getProposalById(id);
    if (!existing) return null;

    const deliverables = data.deliverables !== undefined
      ? JSON.stringify(data.deliverables)
      : (data.deliverables_json ?? existing.deliverables_json);

    const clauses = data.contract_clauses !== undefined
      ? JSON.stringify(data.contract_clauses)
      : (data.contract_clauses_json ?? existing.contract_clauses_json);

    db.prepare(`
      UPDATE commercial_proposals SET
        lead_name = ?, lead_company = ?, project_title = ?, category = ?,
        scope_description = ?, deliverables_json = ?, tech_stack = ?,
        timeline_weeks = ?, investment_brl = ?, payment_terms = ?,
        contract_clauses_json = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.lead_name ?? existing.lead_name,
      data.lead_company ?? existing.lead_company,
      data.project_title ?? existing.project_title,
      data.category ?? existing.category,
      data.scope_description ?? existing.scope_description,
      deliverables,
      data.tech_stack ?? existing.tech_stack,
      data.timeline_weeks !== undefined ? Number(data.timeline_weeks) : existing.timeline_weeks,
      data.investment_brl !== undefined ? Number(data.investment_brl) : existing.investment_brl,
      data.payment_terms ?? existing.payment_terms,
      clauses,
      data.status ?? existing.status,
      data.notes ?? existing.notes,
      Number(id)
    );

    return models.getProposalById(id);
  },

  acceptProposal(token, clientData = {}) {
    const prop = models.getProposalByToken(token);
    if (!prop) throw new Error('Proposta não encontrada.');

    db.prepare(`
      UPDATE commercial_proposals SET
        status = 'ACCEPTED',
        accepted_at = CURRENT_TIMESTAMP,
        accepted_by_ip = ?,
        accepted_by_name = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE token = ?
    `).run(
      clientData.ip || '127.0.0.1',
      clientData.name || prop.lead_name || 'Cliente',
      token
    );

    // Atualiza estágio do CRM Cognitivo para CONVERTIDO
    try {
      models.addLeadEpisodicMemory(
        prop.lead_phone,
        'DECISION',
        `Proposta ${prop.code} ACEITA digitalmente pelo cliente! R$ ${prop.investment_brl}`,
        `IP: ${clientData.ip || 'online'} | Aceito por: ${clientData.name || prop.lead_name}`,
        5
      );
      models.upsertLeadCognitiveProfile(prop.lead_phone, {
        buying_stage: 'CONVERTIDO',
        readiness_score: 100
      });
    } catch (_) {}

    return models.getProposalByToken(token);
  },

  incrementProposalViews(token, ip = '') {
    db.prepare(`
      UPDATE commercial_proposals SET
        view_count = view_count + 1,
        last_viewed_at = CURRENT_TIMESTAMP
      WHERE token = ?
    `).run(token);
  },

  deleteProposal(id) {
    if (!id) return false;
    db.prepare('DELETE FROM commercial_proposals WHERE id = ?').run(Number(id));
    return true;
  },

  // ==========================================
  // 37. SISTEMA DE ALUGUEL DE BOT POR GRUPO (NAZUNA GROUP RENTAL)
  // ==========================================
  isRentalModeGlobal() {
    return models.getSetting('RENTAL_MODE_GLOBAL') === 'true';
  },

  setRentalModeGlobal(enabled) {
    return models.setSetting('RENTAL_MODE_GLOBAL', enabled ? 'true' : 'false');
  },

  getGroupRental(groupId) {
    if (!groupId) return { active: false, expires_at: null, status: 'none', permanent: false, days_left: 0 };
    const row = db.prepare('SELECT * FROM group_rentals WHERE group_jid = ?').get(groupId);
    if (!row) {
      return { group_jid: groupId, active: false, expires_at: null, status: 'none', permanent: false, days_left: 0 };
    }

    if (row.expires_at === 'permanent' || row.status === 'permanent') {
      return { ...row, active: true, permanent: true, status: 'permanent', days_left: 9999 };
    }

    if (row.expires_at) {
      const expDate = new Date(row.expires_at);
      const now = new Date();
      const diffMs = expDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const active = diffMs > 0;
      return {
        ...row,
        active,
        permanent: false,
        status: active ? 'active' : 'expired',
        days_left: Math.max(0, daysLeft)
      };
    }

    return { ...row, active: false, permanent: false, status: 'expired', days_left: 0 };
  },

  setGroupRental(groupId, durationDays, info = {}) {
    if (!groupId) throw new Error('ID de grupo obrigatório.');
    let expiresAt = 'permanent';
    let status = 'permanent';

    if (durationDays !== 'permanent' && Number(durationDays) > 0) {
      const exp = new Date();
      exp.setDate(exp.getDate() + Number(durationDays));
      expiresAt = exp.toISOString();
      status = 'active';
    } else if (durationDays === -1 || durationDays === 'permanent') {
      expiresAt = 'permanent';
      status = 'permanent';
    } else {
      throw new Error('Duração de aluguel inválida.');
    }

    db.prepare(`
      INSERT INTO group_rentals (group_jid, group_name, expires_at, status, rental_code, payer_phone, payer_name, notified_24h, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(group_jid) DO UPDATE SET
        expires_at = excluded.expires_at,
        status = excluded.status,
        rental_code = COALESCE(excluded.rental_code, group_rentals.rental_code),
        payer_phone = COALESCE(excluded.payer_phone, group_rentals.payer_phone),
        payer_name = COALESCE(excluded.payer_name, group_rentals.payer_name),
        group_name = COALESCE(excluded.group_name, group_rentals.group_name),
        notified_24h = 0,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      groupId,
      info.group_name || null,
      expiresAt,
      status,
      info.rental_code || null,
      info.payer_phone || null,
      info.payer_name || null
    );

    return models.getGroupRental(groupId);
  },

  removeGroupRental(groupId) {
    if (!groupId) return false;
    db.prepare(`
      UPDATE group_rentals SET status = 'expired', expires_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE group_jid = ?
    `).run(groupId);
    return true;
  },

  listGroupRentals() {
    const rows = db.prepare('SELECT * FROM group_rentals ORDER BY created_at DESC').all();
    return rows.map(r => {
      if (r.expires_at === 'permanent' || r.status === 'permanent') {
        return { ...r, active: true, permanent: true, days_left: 9999, expiration_formatted: 'Permanente ✨' };
      }
      if (r.expires_at) {
        const exp = new Date(r.expires_at);
        const diffMs = exp.getTime() - Date.now();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const active = diffMs > 0;
        return {
          ...r,
          active,
          permanent: false,
          days_left: Math.max(0, daysLeft),
          expiration_formatted: exp.toLocaleDateString('pt-BR')
        };
      }
      return { ...r, active: false, permanent: false, days_left: 0, expiration_formatted: 'Expirado' };
    });
  },

  generateRentalActivationCode(durationDays, targetGroupId = null, createdBy = 'admin') {
    const crypto = require('crypto');
    let code = '';
    let exists = null;
    let attempts = 0;
    do {
      code = crypto.randomBytes(4).toString('hex').toUpperCase();
      exists = db.prepare('SELECT id FROM rental_activation_codes WHERE code = ?').get(code);
      attempts++;
    } while (exists && attempts < 10);

    const dur = (durationDays === 'permanent' || durationDays === -1) ? -1 : (Number(durationDays) || 30);
    const targetGroup = targetGroupId && targetGroupId.endsWith('@g.us') ? targetGroupId : null;

    db.prepare(`
      INSERT INTO rental_activation_codes (code, duration_days, target_group_jid, used, created_by)
      VALUES (?, ?, ?, 0, ?)
    `).run(code, dur, targetGroup, createdBy);

    return {
      success: true,
      code,
      duration_days: dur,
      target_group_jid: targetGroup,
      message: `🔑 Código de ativação gerado com sucesso: *${code}* (${dur === -1 ? 'Permanente' : `${dur} dias`})`
    };
  },

  validateRentalActivationCode(code) {
    if (!code) return { valid: false, message: 'Código não informado.' };
    const clean = String(code).trim().toUpperCase();
    const row = db.prepare('SELECT * FROM rental_activation_codes WHERE code = ?').get(clean);
    if (!row) {
      return { valid: false, message: 'Código de ativação inválido ou inexistente.' };
    }
    if (row.used) {
      return { valid: false, message: `Este código já foi utilizado em ${row.used_at || 'data anterior'}.` };
    }
    return { valid: true, codeInfo: row };
  },

  useRentalActivationCode(code, groupId, userId) {
    const validation = models.validateRentalActivationCode(code);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }
    const { codeInfo } = validation;
    if (codeInfo.target_group_jid && codeInfo.target_group_jid !== groupId) {
      return { success: false, message: 'Este código é reservado exclusivamente para outro grupo.' };
    }

    const dur = codeInfo.duration_days === -1 ? 'permanent' : codeInfo.duration_days;
    models.setGroupRental(groupId, dur, {
      rental_code: codeInfo.code,
      payer_phone: userId
    });

    db.prepare(`
      UPDATE rental_activation_codes SET
        used = 1,
        used_by = ?,
        activated_group = ?,
        used_at = CURRENT_TIMESTAMP
      WHERE code = ?
    `).run(userId || 'usuario', groupId, codeInfo.code);

    const durText = codeInfo.duration_days === -1 ? 'Permanente ✨' : `${codeInfo.duration_days} dias ⏳`;
    return {
      success: true,
      code: codeInfo.code,
      duration_days: codeInfo.duration_days,
      message: `🎉 Código *${codeInfo.code}* ativado com sucesso!\n\n` +
        `✅ Aluguel do bot liberado para este grupo!\n` +
        `⏳ Duração: *${durText}*`
    };
  },

  listRentalActivationCodes(unusedOnly = false) {
    const sql = unusedOnly
      ? 'SELECT * FROM rental_activation_codes WHERE used = 0 ORDER BY created_at DESC'
      : 'SELECT * FROM rental_activation_codes ORDER BY created_at DESC';
    return db.prepare(sql).all();
  },

  // ==========================================
  // 38. CONFIGURAÇÕES DE PROTEÇÃO DE GRUPO (ANTIFLOOD, ANTITRAVA, BEMVINDO)
  // ==========================================
  getGroupProtection(groupId) {
    if (!groupId) return null;
    let row = db.prepare('SELECT * FROM group_protection_settings WHERE group_jid = ?').get(groupId);
    if (!row) {
      db.prepare(`
        INSERT OR IGNORE INTO group_protection_settings (group_jid)
        VALUES (?)
      `).run(groupId);
      row = db.prepare('SELECT * FROM group_protection_settings WHERE group_jid = ?').get(groupId);
    }
    return row;
  },

  updateGroupProtection(groupId, patch = {}) {
    if (!groupId) return null;
    models.getGroupProtection(groupId); // Garante que exista

    const fields = [];
    const values = [];

    if (patch.antiflood_enabled !== undefined) {
      fields.push('antiflood_enabled = ?');
      values.push(patch.antiflood_enabled ? 1 : 0);
    }
    if (patch.antiflood_interval !== undefined) {
      fields.push('antiflood_interval = ?');
      values.push(Math.max(1, Number(patch.antiflood_interval) || 3));
    }
    if (patch.antiflood_action !== undefined) {
      fields.push('antiflood_action = ?');
      values.push(patch.antiflood_action);
    }
    if (patch.antitrava_enabled !== undefined) {
      fields.push('antitrava_enabled = ?');
      values.push(patch.antitrava_enabled ? 1 : 0);
    }
    if (patch.antifake_enabled !== undefined) {
      fields.push('antifake_enabled = ?');
      values.push(patch.antifake_enabled ? 1 : 0);
    }
    if (patch.welcome_enabled !== undefined) {
      fields.push('welcome_enabled = ?');
      values.push(patch.welcome_enabled ? 1 : 0);
    }
    if (patch.welcome_text !== undefined) {
      fields.push('welcome_text = ?');
      values.push(String(patch.welcome_text));
    }
    if (patch.goodbye_enabled !== undefined) {
      fields.push('goodbye_enabled = ?');
      values.push(patch.goodbye_enabled ? 1 : 0);
    }
    if (patch.goodbye_text !== undefined) {
      fields.push('goodbye_text = ?');
      values.push(String(patch.goodbye_text));
    }

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(groupId);
      db.prepare(`UPDATE group_protection_settings SET ${fields.join(', ')} WHERE group_jid = ?`).run(...values);
    }

    return models.getGroupProtection(groupId);
  },

  // ==========================================
  // 39. ESTATÍSTICAS DE COMANDOS (TOP COMANDOS)
  // ==========================================
  recordCommandExecution(cmdName) {
    if (!cmdName) return;
    const clean = String(cmdName).trim().toLowerCase().replace(/^[!/#]/, '');
    db.prepare(`
      INSERT INTO command_execution_stats (command_name, execution_count, last_executed_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(command_name) DO UPDATE SET
        execution_count = execution_count + 1,
        last_executed_at = CURRENT_TIMESTAMP
    `).run(clean);
  },

  getTopCommands(limit = 10) {
    const totalRow = db.prepare('SELECT SUM(execution_count) as total FROM command_execution_stats').get();
    const total = (totalRow && totalRow.total) ? Number(totalRow.total) : 0;
    const rows = db.prepare(`
      SELECT command_name, execution_count, last_executed_at
      FROM command_execution_stats
      ORDER BY execution_count DESC
      LIMIT ?
    `).all(limit);

    return {
      total_executions: total,
      commands: rows.map((r, idx) => ({
        rank: idx + 1,
        command: r.command_name,
        count: r.execution_count,
        percentage: total > 0 ? Number(((r.execution_count / total) * 100).toFixed(1)) : 0,
        last_executed_at: r.last_executed_at
      }))
    };
  }

};

module.exports = models;

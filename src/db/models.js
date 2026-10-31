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

  getCategories() {
    const rows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
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
    if (!existing) throw new Error('Instância do exército não encontrada');

    const name = data.name !== undefined ? data.name : existing.name;
    const phone = data.phone !== undefined ? data.phone : existing.phone;
    const status = data.status !== undefined ? data.status : existing.status;
    const daily_limit = data.daily_limit !== undefined ? Number(data.daily_limit) : existing.daily_limit;
    const messages_sent_today = data.messages_sent_today !== undefined ? Number(data.messages_sent_today) : existing.messages_sent_today;
    const warmup_mode = data.warmup_mode !== undefined ? (data.warmup_mode ? 1 : 0) : existing.warmup_mode;
    const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

    db.prepare(`
      UPDATE whatsapp_army_instances
      SET name = ?, phone = ?, status = ?, daily_limit = ?, messages_sent_today = ?, warmup_mode = ?, active = ?
      WHERE id = ?
    `).run(name, phone || null, status, daily_limit, messages_sent_today, warmup_mode, active, id);

    return models.getArmyInstanceById(id);
  },

  deleteArmyInstance(id) {
    const inst = models.getArmyInstanceById(id);
    if (inst && inst.is_main) {
      throw new Error('Não é permitido remover a instância Matriz Principal.');
    }
    return db.prepare('DELETE FROM whatsapp_army_instances WHERE id = ?').run(id);
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
    return { platform, groupId, antilink, welcome, welcomeMsg };
  },

  updateGroupSettings(platform, groupId, { antilink = null, welcome = null, welcomeMsg = null } = {}) {
    if (antilink !== null && antilink !== undefined) {
      this.setSetting(`ANTILINK_${groupId}`, antilink ? 'true' : 'false');
    }
    if (welcome !== null && welcome !== undefined) {
      this.setSetting(`WELCOME_${groupId}`, welcome ? 'true' : 'false');
    }
    if (welcomeMsg !== null && welcomeMsg !== undefined) {
      this.setSetting(`WELCOME_MSG_${groupId}`, String(welcomeMsg));
    }
    return this.getGroupSettings(platform, groupId);
  }
};

module.exports = models;

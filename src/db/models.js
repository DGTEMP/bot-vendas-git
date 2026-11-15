const db = require('./database');
const dateTimeUtils = require('../utils/dateTime');

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

// ==========================================
// Cache em Memória RAM para Catálogo de Produtos e Categorias
// ==========================================
const _productMemoryCache = new Map();
const _productCacheTTL = 4000; // 4s TTL com invalidação write-through imediata

const models = {
  invalidateProductCache() {
    _productMemoryCache.clear();
  },

  // ==========================================
  // 1. PRODUTOS & CATEGORIAS
  // ==========================================
  getProducts(activeOnly = true, includeSubbots = false) {
    const cacheKey = `${activeOnly}:${includeSubbots}`;
    const cached = _productMemoryCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < _productCacheTTL)) {
      return cached.data;
    }

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
    if (!products.length) {
      _productMemoryCache.set(cacheKey, { data: [], timestamp: now });
      return [];
    }

    // Otimização Escalável: Eliminação do Problema N+1 de Consultas
    // 1. Carrega estoque de chaves disponíveis em 1 única consulta agregada
    const stockMap = new Map();
    const stockRows = db.prepare('SELECT product_id, COUNT(*) as stock FROM inventory_keys WHERE is_used = 0 GROUP BY product_id').all();
    for (const s of stockRows) stockMap.set(s.product_id, s.stock);

    // 2. Carrega todos os vendedores atribuídos em 1 única consulta indexada
    const sellerRows = db.prepare(`
      SELECT sp.product_id, s.id, s.name, s.email, s.phone, s.telegram_username, s.commission_rate, s.active
      FROM seller_products sp
      JOIN sellers s ON sp.seller_id = s.id
      ORDER BY s.name ASC
    `).all();
    const sellersByProduct = new Map();
    const sellerIdsByProduct = new Map();
    for (const sr of sellerRows) {
      let list = sellersByProduct.get(sr.product_id);
      if (!list) {
        list = [];
        sellersByProduct.set(sr.product_id, list);
        sellerIdsByProduct.set(sr.product_id, []);
      }
      list.push({
        id: sr.id,
        name: sr.name,
        email: sr.email,
        phone: sr.phone,
        telegram_username: sr.telegram_username,
        commission_rate: sr.commission_rate,
        active: sr.active
      });
      sellerIdsByProduct.get(sr.product_id).push(sr.id);
    }

    for (const p of products) {
      if (p.type === 'license_key') {
        p.availableStock = stockMap.get(p.id) || 0;
      }
      p.assigned_seller_ids = sellerIdsByProduct.get(p.id) || [];
      p.assigned_sellers = sellersByProduct.get(p.id) || [];
      if (!p.image_url || !String(p.image_url).trim()) {
        p.image_url = models.getDefaultProductImage(p.category, p.name);
      }
    }

    _productMemoryCache.set(cacheKey, { data: products, timestamp: now });
    return products;
  },

  getDefaultProductImage(category = '', name = '') {
    try {
      const { resolveProductImage } = require('../utils/productImageResolver');
      return resolveProductImage(name, category);
    } catch (_) {
      return 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80';
    }
  },

  getProductById(id) {
    if (!id) return null;
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
      if (!product.image_url || !String(product.image_url).trim()) {
        product.image_url = models.getDefaultProductImage(product.category, product.name);
      }
    }
    return product;
  },

  getProductByExternalId(tenantId, externalId) {
    if (!externalId) return null;
    try {
      return db.prepare(`
        SELECT * FROM products 
        WHERE (tenant_id IS ? OR tenant_id = ?) AND external_id = ?
        LIMIT 1
      `).get(tenantId || null, tenantId || null, String(externalId));
    } catch (_) {
      return null;
    }
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
    models.invalidateProductCache();
    return models.getProductSellers(productId);
  },

  getCategories(activeOnly = true) {
    const whereActive = activeOnly ? 'WHERE active = 1 AND' : 'WHERE';
    const rows = db.prepare(`SELECT DISTINCT category FROM products ${whereActive} category IS NOT NULL AND category != '' AND (army_instance_id IS NULL OR army_instance_id = 0) ORDER BY category ASC`).all();
    return rows.map(r => r.category);
  },

  createProduct({ name, description = null, price, price_brl = null, price_usdt = null, currency = 'BRL', type, duration_days = 0, content = null, telegram_channel_id = null, upsell_product_id = null, upsell_discount_percent = 20.0, upsell_headline = null, company_id = null, category = 'Geral', affiliation_enabled = 1, custom_affiliate_rate = null, seller_ids = [], tenant_id = null, image_url = null, external_id = null, external_url = null, external_platform = null }) {
    const brl = price_brl !== null ? Number(price_brl) : Number(price);
    const usdt = price_usdt !== null ? Number(price_usdt) : Number((brl / 5.5).toFixed(2));
    const finalImage = (image_url && String(image_url).trim()) ? String(image_url).trim() : models.getDefaultProductImage(category, name);
    
    // Evita duplicidade de produtos com mesmo nome
    const cleanName = String(name || '').trim();
    if (cleanName) {
      const existing = db.prepare(`
        SELECT id FROM products 
        WHERE lower(trim(name)) = lower(trim(?)) 
          AND (tenant_id IS ? OR tenant_id = ?)
        LIMIT 1
      `).get(cleanName, tenant_id || null, tenant_id || null);
      if (existing) {
        return models.updateProduct(existing.id, {
          name: cleanName,
          description,
          price_brl: brl,
          price_usdt: usdt,
          currency,
          type,
          duration_days,
          content,
          telegram_channel_id,
          upsell_product_id,
          upsell_discount_percent,
          upsell_headline,
          company_id,
          category,
          affiliation_enabled,
          custom_affiliate_rate,
          tenant_id,
          seller_ids,
          image_url: finalImage,
          external_id,
          external_url,
          external_platform,
          active: 1
        });
      }
    }

    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id, upsell_product_id, upsell_discount_percent, upsell_headline, company_id, category, affiliation_enabled, custom_affiliate_rate, tenant_id, image_url, external_id, external_url, external_platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      custom_affiliate_rate !== null && custom_affiliate_rate !== undefined && custom_affiliate_rate !== '' ? Number(custom_affiliate_rate) : null,
      tenant_id ? Number(tenant_id) : null,
      finalImage,
      external_id || null,
      external_url || null,
      external_platform || null
    );
    const prodId = Number(res.lastInsertRowid);
    if (Array.isArray(seller_ids) && seller_ids.length > 0) {
      models.setProductSellers(prodId, seller_ids);
    }
    models.invalidateProductCache();
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
    const tenant_id = data.tenant_id !== undefined ? (data.tenant_id ? Number(data.tenant_id) : null) : existing.tenant_id;
    const buyers_group_jid = data.buyers_group_jid !== undefined ? (data.buyers_group_jid ? data.buyers_group_jid.trim() : '') : (existing.buyers_group_jid || '');
    const buyers_group_invite_url = data.buyers_group_invite_url !== undefined ? (data.buyers_group_invite_url ? data.buyers_group_invite_url.trim() : '') : (existing.buyers_group_invite_url || '');
    const buyers_group_admin_id = data.buyers_group_admin_id !== undefined ? Number(data.buyers_group_admin_id) : (existing.buyers_group_admin_id || 1);
    const buyers_group_workflow = data.buyers_group_workflow !== undefined ? data.buyers_group_workflow : (existing.buyers_group_workflow || '');
    const image_url = data.image_url !== undefined ? (data.image_url ? String(data.image_url).trim() : '') : (existing.image_url || '');
    const external_id = data.external_id !== undefined ? data.external_id : existing.external_id;
    const external_url = data.external_url !== undefined ? data.external_url : existing.external_url;
    const external_platform = data.external_platform !== undefined ? data.external_platform : existing.external_platform;

    db.prepare(`
      UPDATE products 
      SET name = ?, description = ?, price = ?, price_brl = ?, price_usdt = ?, currency = ?, type = ?, duration_days = ?, content = ?, telegram_channel_id = ?, upsell_product_id = ?, upsell_discount_percent = ?, upsell_headline = ?, company_id = ?, category = ?, active = ?, affiliation_enabled = ?, custom_affiliate_rate = ?, tenant_id = ?, buyers_group_jid = ?, buyers_group_invite_url = ?, buyers_group_admin_id = ?, buyers_group_workflow = ?, image_url = ?, external_id = ?, external_url = ?, external_platform = ?
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
      tenant_id,
      buyers_group_jid,
      buyers_group_invite_url,
      buyers_group_admin_id,
      buyers_group_workflow,
      image_url,
      external_id || null,
      external_url || null,
      external_platform || null,
      id
    );

    if (data.seller_ids !== undefined && Array.isArray(data.seller_ids)) {
      models.setProductSellers(id, data.seller_ids);
    }

    models.invalidateProductCache();
    return models.getProductById(id);
  },

  deleteProduct(id) {
    const res = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    models.invalidateProductCache();
    return res;
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
        const exists = db.prepare('SELECT id FROM inventory_keys WHERE product_id = ? AND key_content = ?').get(productId, cleanKey);
        if (!exists) {
          stmt.run(productId, cleanKey);
          added++;
        }
      }
    }
    models.invalidateProductCache();
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
      models.invalidateProductCache();
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
    if (!sellers.length) return [];

    // Otimização Escalável: Eliminação do Problema N+1 para Vendedores
    const spRows = db.prepare(`
      SELECT sp.seller_id, p.id, p.name, p.price_brl, p.price_usdt, p.category, c.name as company_name
      FROM seller_products sp
      JOIN products p ON sp.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      ORDER BY p.name ASC
    `).all();

    const prodsBySeller = new Map();
    const prodIdsBySeller = new Map();
    for (const r of spRows) {
      let list = prodsBySeller.get(r.seller_id);
      if (!list) {
        list = [];
        prodsBySeller.set(r.seller_id, list);
        prodIdsBySeller.set(r.seller_id, []);
      }
      list.push({
        id: r.id,
        name: r.name,
        price_brl: r.price_brl,
        price_usdt: r.price_usdt,
        category: r.category,
        company_name: r.company_name
      });
      prodIdsBySeller.get(r.seller_id).push(r.id);
    }

    for (const s of sellers) {
      s.assigned_product_ids = prodIdsBySeller.get(s.id) || [];
      s.assigned_products = prodsBySeller.get(s.id) || [];
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
    const clean = String(refCode).trim().toUpperCase();
    const withoutRef = clean.replace(/^REF_/, '');
    const withRef = `REF_${withoutRef}`;
    return db.prepare('SELECT * FROM affiliates WHERE (UPPER(ref_code) = ? OR UPPER(ref_code) = ? OR UPPER(ref_code) = ?) AND active = 1').get(clean, withoutRef, withRef);
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

  getOrCreateCustomerAffiliate(phone, name = 'Cliente VIP', commissionRate = 20.0) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone) {
      const existing = db.prepare(`
        SELECT * FROM affiliates 
        WHERE phone = ? OR phone LIKE ?
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone, `%${cleanPhone}%`);
      if (existing) return existing;
    }

    const suffix = cleanPhone ? cleanPhone.slice(-4) : Math.random().toString(36).slice(2, 6).toUpperCase();
    let refCode = `IND_${suffix}`;
    const existsRef = db.prepare('SELECT id FROM affiliates WHERE UPPER(ref_code) = ?').get(refCode);
    if (existsRef) {
      refCode = `IND_${suffix}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    }

    return models.createAffiliate({
      name: name || `Cliente ${cleanPhone ? cleanPhone.slice(-4) : 'VIP'}`,
      phone: cleanPhone || null,
      ref_code: refCode,
      commission_rate: Number(commissionRate) || 20.0
    });
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
  createOrder({ merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway = 'binancepay', amount, currency = 'BRL', prepay_id = null, checkout_url = null, qr_content = null, pix_code = null, affiliate_id = null, seller_id = null, ref_code = null, coupon_code = null, discount_amount = 0, is_upsell = 0, status = 'PENDING', tenant_id = null }) {
    const stmt = db.prepare(`
      INSERT INTO orders (merchant_trade_no, platform, platform_user_id, platform_user_name, product_id, gateway, amount, currency, prepay_id, checkout_url, qr_content, pix_code, affiliate_id, seller_id, ref_code, coupon_code, discount_amount, is_upsell, status, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      status || 'PENDING',
      tenant_id ? Number(tenant_id) : null
    );
    return models.getOrderByTradeNo(merchant_trade_no);
  },

  getOrderByTradeNo(tradeNo) {
    if (!tradeNo) return null;
    const cleanTrade = String(tradeNo).trim();
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id, p.price_brl, p.price_usdt,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      WHERE o.merchant_trade_no = ? OR o.prepay_id = ? OR o.merchant_trade_no LIKE ?
    `).get(cleanTrade, cleanTrade, `%${cleanTrade}%`);
  },

  getOrderByTxid(txid) {
    if (!txid) return null;
    const cleanTx = String(txid).trim();
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id, p.price_brl, p.price_usdt,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      WHERE o.prepay_id = ? OR o.merchant_trade_no = ? OR o.merchant_trade_no LIKE ?
    `).get(cleanTx, cleanTx, `%${cleanTx}%`);
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
    let content = deliveredContent;
    if (deliveredContent && typeof deliveredContent === 'object') {
      content = deliveredContent.delivered_content || JSON.stringify(deliveredContent);
    }
    const paidAt = status === 'PAID' ? new Date().toISOString() : null;
    if (content) {
      db.prepare(`
        UPDATE orders 
        SET status = ?, delivered_content = ?, paid_at = COALESCE(paid_at, ?)
        WHERE merchant_trade_no = ?
      `).run(status, typeof content === 'string' ? content : String(content), paidAt, tradeNo);
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

  skipOrderRecovery(tradeNoOrId) {
    db.prepare(`
      UPDATE orders 
      SET recovery_sent = 2, recovery_sent_at = datetime('now')
      WHERE id = ? OR merchant_trade_no = ?
    `).run(Number(tradeNoOrId) || 0, String(tradeNoOrId));
    return true;
  },

  pauseOrderRecovery(tradeNoOrId) {
    db.prepare(`
      UPDATE orders 
      SET recovery_sent = 3, recovery_sent_at = datetime('now')
      WHERE id = ? OR merchant_trade_no = ?
    `).run(Number(tradeNoOrId) || 0, String(tradeNoOrId));
    return true;
  },

  resumeOrderRecovery(tradeNoOrId) {
    db.prepare(`
      UPDATE orders 
      SET recovery_sent = 0
      WHERE id = ? OR merchant_trade_no = ?
    `).run(Number(tradeNoOrId) || 0, String(tradeNoOrId));
    return true;
  },

  getRecentPaidOrder(platformUserId, platform = 'whatsapp') {
    if (!platformUserId) return null;
    const cleanId = String(platformUserId).replace(/\D/g, '');
    const row = db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.price_brl, p.price_usdt,
             p.upsell_product_id, p.upsell_discount_percent, p.upsell_headline
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.platform = ? 
        AND (o.platform_user_id = ? OR o.platform_user_id LIKE ? OR o.platform_user_id = ?)
        AND o.status = 'PAID'
      ORDER BY o.id DESC LIMIT 1
    `).get(platform, platformUserId, `%${cleanId}%`, cleanId);
    return row || null;
  },

  getPendingRecoveryTasks(limit = 50) {
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.price_brl, p.price_usdt
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'PENDING'
      ORDER BY o.id DESC
      LIMIT ?
    `).all(Number(limit));
  },

  updateOrderDetails(tradeNo, patch = {}) {
    const order = this.getOrderByTradeNo(tradeNo);
    if (!order) return null;

    const updates = [];
    const params = [];

    if (patch.platform !== undefined) {
      updates.push('platform = ?');
      params.push(String(patch.platform).trim());
    }
    if (patch.platform_user_name !== undefined) {
      updates.push('platform_user_name = ?');
      params.push(String(patch.platform_user_name).trim());
    }
    if (patch.platform_user_id !== undefined) {
      updates.push('platform_user_id = ?');
      params.push(String(patch.platform_user_id).trim());
    }
    if (patch.product_id !== undefined) {
      updates.push('product_id = ?');
      params.push(Number(patch.product_id));
    }
    if (patch.amount !== undefined) {
      updates.push('amount = ?');
      params.push(Number(patch.amount));
    }
    if (patch.currency !== undefined) {
      updates.push('currency = ?');
      params.push(String(patch.currency).toUpperCase());
    }
    if (patch.status !== undefined) {
      updates.push('status = ?');
      params.push(String(patch.status).toUpperCase());
    }
    if (patch.gateway !== undefined) {
      updates.push('gateway = ?');
      params.push(String(patch.gateway).toLowerCase());
    }
    if (patch.pix_code !== undefined) {
      updates.push('pix_code = ?');
      params.push(patch.pix_code ? String(patch.pix_code) : null);
    }
    if (patch.qr_content !== undefined) {
      updates.push('qr_content = ?');
      params.push(patch.qr_content ? String(patch.qr_content) : null);
    }
    if (patch.checkout_url !== undefined) {
      updates.push('checkout_url = ?');
      params.push(patch.checkout_url ? String(patch.checkout_url) : null);
    }
    if (patch.prepay_id !== undefined) {
      updates.push('prepay_id = ?');
      params.push(patch.prepay_id ? String(patch.prepay_id) : null);
    }
    if (patch.delivered_content !== undefined) {
      updates.push('delivered_content = ?');
      params.push(patch.delivered_content ? String(patch.delivered_content) : null);
    }
    if (patch.recovery_sent !== undefined) {
      updates.push('recovery_sent = ?');
      params.push(Number(patch.recovery_sent));
    }

    if (updates.length > 0) {
      params.push(tradeNo);
      db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE merchant_trade_no = ?`).run(...params);
    }

    return this.getOrderByTradeNo(tradeNo);
  },

  updateOrderGateway(tradeNo, { gateway, currency, amount, pix_code = null, qr_content = null, checkout_url = null, prepay_id = null }) {
    if (!tradeNo) return null;
    const cleanTrade = String(tradeNo).trim();
    const order = this.getOrderByTradeNo(cleanTrade);
    if (!order) return null;

    db.prepare(`
      UPDATE orders 
      SET gateway = ?, 
          currency = ?, 
          amount = ?, 
          pix_code = ?, 
          qr_content = ?, 
          checkout_url = ?, 
          prepay_id = ?
      WHERE merchant_trade_no = ?
    `).run(
      gateway ? String(gateway).toLowerCase() : order.gateway,
      currency ? String(currency).toUpperCase() : order.currency,
      amount !== undefined ? Number(amount) : order.amount,
      pix_code !== undefined ? (pix_code ? String(pix_code) : null) : order.pix_code,
      qr_content !== undefined ? (qr_content ? String(qr_content) : null) : order.qr_content,
      checkout_url !== undefined ? (checkout_url ? String(checkout_url) : null) : order.checkout_url,
      prepay_id !== undefined ? (prepay_id ? String(prepay_id) : null) : order.prepay_id,
      cleanTrade
    );
    return this.getOrderByTradeNo(cleanTrade);
  },

  getLatestPendingOrder(platformUserId, productId = null) {
    if (!platformUserId) return null;
    const raw = String(platformUserId).trim();
    const clean = raw.replace(/\D/g, '');
    const cleanNoDdi = clean.startsWith('55') ? clean.slice(2) : clean;
    const withDdi = clean.startsWith('55') ? clean : '55' + clean;

    let query = `
      SELECT o.*, p.name as product_name, p.type as product_type, p.price_brl, p.price_usdt
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'PENDING'
        AND (
          o.platform_user_id = ? 
          OR o.platform_user_id = ? 
          OR o.platform_user_id = ? 
          OR o.platform_user_id = ?
          OR o.platform_user_id LIKE ?
        )
    `;
    const params = [raw, clean, cleanNoDdi, withDdi, `%${cleanNoDdi || raw}%`];

    if (productId) {
      query += ` AND o.product_id = ?`;
      params.push(Number(productId));
    }

    query += ` ORDER BY o.id DESC LIMIT 1`;
    return db.prepare(query).get(...params);
  },

  cancelOtherPendingOrders(platformUserId, keepTradeNo, productId = null) {
    if (!platformUserId || !keepTradeNo) return 0;
    const raw = String(platformUserId).trim();
    const clean = raw.replace(/\D/g, '');
    const cleanNoDdi = clean.startsWith('55') ? clean.slice(2) : clean;
    const withDdi = clean.startsWith('55') ? clean : '55' + clean;

    let query = `
      UPDATE orders
      SET status = 'CANCELLED'
      WHERE status = 'PENDING'
        AND merchant_trade_no != ?
        AND (
          platform_user_id = ? 
          OR platform_user_id = ? 
          OR platform_user_id = ? 
          OR platform_user_id = ?
        )
    `;
    const params = [String(keepTradeNo).trim(), raw, clean, cleanNoDdi, withDdi];

    if (productId) {
      query += ` AND product_id = ?`;
      params.push(Number(productId));
    }

    const res = db.prepare(query).run(...params);
    return res.changes;
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
    if (key === 'TUNNEL_URL') {
      _settingsMemoryCache.set('TUNNEL_ADMIN_URL', valStr);
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('TUNNEL_ADMIN_URL', valStr);
    }
    if (key.includes('OWNER') || key.includes('ADMIN')) {
      setImmediate(() => {
        try {
          const whatsappBot = require('../bots/whatsappBot');
          if (typeof whatsappBot.invalidateOwnerCache === 'function') {
            whatsappBot.invalidateOwnerCache();
          }
        } catch (_) {}
      });
    }
  },

  getOrdersGroupJid() {
    const fromSetting = this.getSetting('ORDERS_GROUP_JID', '');
    if (fromSetting && fromSetting.trim()) return fromSetting.trim();
    if (process.env.ORDERS_GROUP_JID && process.env.ORDERS_GROUP_JID.trim()) return process.env.ORDERS_GROUP_JID.trim();
    return '';
  },

  setOrdersGroupJid(jid) {
    const cleanJid = String(jid || '').trim();
    this.setSetting('ORDERS_GROUP_JID', cleanJid);
    return cleanJid;
  },

  /**
   * 🛡️ IDENTIFICAÇÃO E PROTEÇÃO SUPREMA DO DONO
   * Reconhece o Dono Supremo por JID, LID, telefone completo, 8 dígitos finais + DDD,
   * variáveis de ambiente ou configurações do banco de dados.
   */
  isOwner(phoneOrJid, isFromMe = false) {
    if (isFromMe) return true;
    if (!phoneOrJid) return false;

    let clean = String(phoneOrJid).replace(/@.*$/, '').replace(/:.*$/, '').replace(/\D/g, '');
    if (!clean) return false;

    // Se for o LID oficial do dono conhecido
    if (clean === '151866151276711') return true;

    const ownerList = [
      this.getSetting('OWNER_PHONE', ''),
      this.getSetting('ADMIN_PHONE', ''),
      this.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', ''),
      this.getSetting('OWNER_WHATSAPP', ''),
      process.env.OWNER_PHONE || '',
      process.env.OWNER_WHATSAPP || '',
      process.env.ADMIN_NOTIFY_WHATSAPP_PHONE || '',
      process.env.ADMIN_PHONE || '',
      '554884702848' // Default Dono
    ];

    try {
      const mainInstance = this.getArmyInstanceById(1);
      if (mainInstance && mainInstance.phone) {
        ownerList.push(mainInstance.phone);
      }
    } catch (_) {}

    const validOwners = new Set();
    const last8Map = new Map();

    for (const raw of ownerList) {
      if (!raw) continue;
      const c = String(raw).replace(/\D/g, '');
      if (!c) continue;
      validOwners.add(c);
      if (c.length >= 8) {
        const last8 = c.slice(-8);
        if (!last8Map.has(last8)) last8Map.set(last8, []);
        last8Map.get(last8).push(c);
      }
    }

    if (validOwners.has(clean)) return true;

    if (clean.length >= 8) {
      const last8Sender = clean.slice(-8);
      const matches = last8Map.get(last8Sender);
      if (matches && matches.length > 0) {
        if (clean.length < 10) return true;
        const senderDDD = clean.startsWith('55') && clean.length >= 12 ? clean.slice(2, 4) : clean.slice(0, 2);
        for (const cfg of matches) {
          if (cfg.length < 10) return true;
          const cfgDDD = cfg.startsWith('55') && cfg.length >= 12 ? cfg.slice(2, 4) : cfg.slice(0, 2);
          if (senderDDD === cfgDDD) return true;
        }
      }
    }

    return false;
  },

  isOwnerNumber(phone) {
    return this.isOwner(phone);
  },

  /**
   * 💎 IDENTIFICAÇÃO DE USUÁRIOS VIP DO BOT
   * Considera VIP:
   * 1. Dono Supremo ou Devs de Suporte (isOwner)
   * 2. Telefones registrados no global.prems
   * 3. Telefones cadastrados na configuração VIP_USERS ou VIP_NUMBERS
   * 4. Assinatura ativa na tabela subscriptions (status = 'ACTIVE' e end_date > agora)
   * 5. Clientes com pedidos pagos na tabela orders (status = 'PAID', 'DELIVERED', 'COMPLETED')
   * 6. Registros ativos na tabela vip_users
   */
  isVip(phoneOrJid, isFromMe = false) {
    if (isFromMe) return true;
    if (!phoneOrJid) return false;

    const clean = String(phoneOrJid).replace(/@.*$/, '').replace(/:.*$/, '').replace(/\D/g, '');
    if (!clean) return false;

    // 1. Donos e Devs têm privilégio VIP automático
    if (this.isOwner(clean, isFromMe)) return true;

    // 2. Verifica se consta em global.prems
    if (Array.isArray(global.prems) && global.prems.length > 0) {
      if (global.prems.some(p => {
        const c = String(p).replace(/\D/g, '');
        return c && (c === clean || clean.endsWith(c) || c.endsWith(clean));
      })) {
        return true;
      }
    }

    // 3. Verifica na configuração do banco (VIP_USERS ou VIP_NUMBERS)
    const vipConfig = this.getSetting('VIP_USERS', '') || this.getSetting('VIP_NUMBERS', '');
    if (vipConfig) {
      const list = vipConfig.split(/[,\s;|]+/).map(v => v.replace(/\D/g, '')).filter(Boolean);
      if (list.some(v => v === clean || (v.length >= 8 && clean.endsWith(v)) || (clean.length >= 8 && v.endsWith(clean)))) {
        return true;
      }
    }

    // 4. Verifica tabela de assinaturas ativas (subscriptions)
    try {
      const nowIso = new Date().toISOString();
      const activeSub = db.prepare(`
        SELECT id FROM subscriptions
        WHERE (platform_user_id = ? OR platform_user_id LIKE ?)
          AND status = 'ACTIVE'
          AND end_date > ?
        LIMIT 1
      `).get(clean, `%${clean.slice(-8)}%`, nowIso);
      if (activeSub) return true;
    } catch (_) {}

    // 5. Verifica se é comprador ativo com pedidos pagos
    try {
      if (clean.length >= 8) {
        const last8 = clean.slice(-8);
        const paidOrder = db.prepare(`
          SELECT id FROM orders
          WHERE (customer_phone = ? OR customer_phone LIKE ?)
            AND status IN ('PAID', 'DELIVERED', 'COMPLETED')
          LIMIT 1
        `).get(clean, `%${last8}%`);
        if (paidOrder) return true;
      }
    } catch (_) {}

    // 6. Verifica tabela específica vip_users
    try {
      const nowIso = new Date().toISOString();
      const vipRecord = db.prepare(`
        SELECT phone FROM vip_users
        WHERE (phone = ? OR phone LIKE ?)
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `).get(clean, `%${clean.slice(-8)}%`, nowIso);
      if (vipRecord) return true;
    } catch (_) {}

    return false;
  },

  addVipUser(phone, name = 'VIP', days = 30, addedBy = 'Sistema') {
    const clean = String(phone).replace(/\D/g, '');
    if (!clean) return false;
    let expiresAt = null;
    if (days && days > 0) {
      const exp = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      expiresAt = exp.toISOString();
    }
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS vip_users (
          phone TEXT PRIMARY KEY,
          name TEXT,
          added_by TEXT,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      db.prepare(`
        INSERT OR REPLACE INTO vip_users (phone, name, added_by, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(clean, name, addedBy, expiresAt);
      return true;
    } catch (e) {
      console.warn('[AddVipUser Error]:', e.message);
      return false;
    }
  },

  removeVipUser(phone) {
    const clean = String(phone).replace(/\D/g, '');
    if (!clean) return false;
    try {
      db.prepare(`DELETE FROM vip_users WHERE phone = ? OR phone LIKE ?`).run(clean, `%${clean.slice(-8)}%`);
      return true;
    } catch (_) {
      return false;
    }
  },

  getVipUsers() {
    try {
      return db.prepare(`SELECT * FROM vip_users ORDER BY created_at DESC`).all();
    } catch (_) {
      return [];
    }
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

  getEnvironmentMode() {
    const mode = this.getSetting('ENVIRONMENT_MODE', null);
    if (mode) return mode.toLowerCase().trim();
    const pixSim = this.getSetting('PIX_SIMULATION_MODE', 'true') === 'true';
    const bnbSim = this.getSetting('BINANCE_SIMULATION_MODE', 'true') === 'true';
    return (!pixSim && !bnbSim) ? 'production' : 'sandbox';
  },

  isProduction() {
    return this.getEnvironmentMode() === 'production';
  },

  setEnvironmentMode(mode) {
    const cleanMode = (String(mode || '').toLowerCase().trim() === 'production') ? 'production' : 'sandbox';
    this.setSetting('ENVIRONMENT_MODE', cleanMode);
    if (cleanMode === 'production') {
      this.setSetting('PIX_SIMULATION_MODE', 'false');
      this.setSetting('BINANCE_SIMULATION_MODE', 'false');
      this.setSetting('BACEN_PIX_SANDBOX', 'false');
    } else {
      this.setSetting('PIX_SIMULATION_MODE', 'true');
      this.setSetting('BINANCE_SIMULATION_MODE', 'true');
      this.setSetting('BACEN_PIX_SANDBOX', 'true');
    }
    return cleanMode;
  },

  // ==========================================
  // 9. MÉTRICAS E RESUMO GERAL
  // ==========================================
  getMetrics() {
    // Otimização Escalável: Agregação Direta no SQLite em 1 único comando compilado
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as paidOrders,
        COALESCE(SUM(CASE WHEN currency = 'USDT' THEN amount ELSE 0 END), 0) as totalUSDT,
        COALESCE(SUM(CASE WHEN currency != 'USDT' THEN amount ELSE 0 END), 0) as totalBRL,
        COALESCE(SUM(CASE WHEN recovery_sent = 1 THEN 1 ELSE 0 END), 0) as recoveredOrdersCount,
        COALESCE(SUM(CASE WHEN recovery_sent = 1 AND currency != 'USDT' THEN amount ELSE 0 END), 0) as recoveredRevenueBRL,
        COALESCE(SUM(CASE WHEN is_upsell = 1 THEN 1 ELSE 0 END), 0) as upsellOrdersCount
      FROM orders 
      WHERE status = 'PAID'
    `).get() || { paidOrders: 0, totalUSDT: 0, totalBRL: 0, recoveredOrdersCount: 0, recoveredRevenueBRL: 0, upsellOrdersCount: 0 };

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

    const totalCoupons = db.prepare("SELECT COUNT(*) as count FROM coupons WHERE active = 1").get().count;
    const totalCompanies = db.prepare("SELECT COUNT(*) as count FROM companies WHERE active = 1").get().count;
    const pendingAffiliationsCount = db.prepare("SELECT COUNT(*) as count FROM product_affiliations WHERE status = 'PENDING'").get().count;

    return {
      totalRevenueBRL: Number(stats.totalBRL.toFixed(2)),
      totalRevenueUSDT: Number(stats.totalUSDT.toFixed(2)),
      totalOrders,
      paidOrders: stats.paidOrders,
      activeSubs,
      totalProducts,
      totalSellers,
      totalAffiliates,
      totalCompanies,
      pendingAffiliationsCount,
      pendingCommissionsBRL: Number(pendingBRL.toFixed(2)),
      pendingCommissionsUSDT: Number(pendingUSDT.toFixed(2)),
      recoveredOrdersCount: stats.recoveredOrdersCount,
      recoveredRevenueBRL: Number(stats.recoveredRevenueBRL.toFixed(2)),
      upsellOrdersCount: stats.upsellOrdersCount,
      totalCoupons
    };
  },
  // ==========================================
  // 10. OFERTAS & PROMOÇÕES DO CANAL (OFFERS)
  // ==========================================
  createOffer({ title, content, image_url = null, product_id = null, cta_text = '🛒 Aproveitar Oferta', cta_url = null }) {
    const cleanTitle = String(title || '').trim();
    const existing = db.prepare('SELECT id FROM offers WHERE title = ?').get(cleanTitle);
    if (existing) {
      db.prepare(`
        UPDATE offers 
        SET content = ?, image_url = ?, product_id = ?, cta_text = ?, cta_url = ?
        WHERE id = ?
      `).run(content, image_url || null, product_id ? Number(product_id) : null, cta_text, cta_url || null, existing.id);
      return db.prepare('SELECT o.*, p.name as product_name FROM offers o LEFT JOIN products p ON o.product_id = p.id WHERE o.id = ?').get(existing.id);
    }

    const stmt = db.prepare(`
      INSERT INTO offers (title, content, image_url, product_id, cta_text, cta_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(cleanTitle, content, image_url || null, product_id ? Number(product_id) : null, cta_text, cta_url || null);
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
    let clean = String(code).trim().toUpperCase();
    let row = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND active = 1').get(clean);
    if (!row && /^(?:CUPOM|COUPON)[_-]/i.test(clean)) {
      const stripped = clean.replace(/^(?:CUPOM|COUPON)[_-]/i, '');
      row = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND active = 1').get(stripped);
    }
    return row;
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

  createOrGetAbandonedCoupon(phone, name = null, discountPercent = 10, validHours = 2) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const suffix = cleanPhone ? cleanPhone.slice(-4) : Math.random().toString(36).slice(2, 6).toUpperCase();
    const prefix = 'VOLTA10';
    const baseCode = `${prefix}_${suffix}`;

    // Verifica se já existe um cupom ativo e válido para esse sufixo/cliente
    const existing = db.prepare(`
      SELECT * FROM coupons 
      WHERE (UPPER(code) = ? OR UPPER(code) LIKE ?) 
        AND active = 1 
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND (max_uses = 0 OR used_count < max_uses)
      ORDER BY id DESC LIMIT 1
    `).get(baseCode, `${prefix}_${suffix}%`);

    if (existing) {
      return existing;
    }

    let finalCode = baseCode;
    const existsAny = db.prepare('SELECT id FROM coupons WHERE UPPER(code) = ?').get(finalCode);
    if (existsAny) {
      finalCode = `${prefix}_${suffix}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    }

    const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    const stmt = db.prepare(`
      INSERT INTO coupons (code, discount_percent, discount_amount, max_uses, expires_at, active)
      VALUES (?, ?, 0, 1, ?, 1)
    `);
    const res = stmt.run(finalCode, Number(discountPercent), expiresAt);
    return models.getCouponById(Number(res.lastInsertRowid));
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
    const list = db.prepare('SELECT * FROM whatsapp_army_instances ORDER BY is_main DESC, id ASC').all();
    return list.map(inst => ({
      ...inst,
      features: this.getSubBotFeatures(inst.id)
    }));
  },

  getArmyInstanceById(id) {
    return db.prepare('SELECT * FROM whatsapp_army_instances WHERE id = ?').get(id);
  },

  getArmyInstance(id) {
    return this.getArmyInstanceById(id);
  },

  createArmyInstance({ name, phone = null, status = 'DISCONNECTED', daily_limit = 50, warmup_mode = 0, tenant_id = null, ai_provider = 'auto', ai_model = null, ai_instruction = null, ai_api_key = null, ai_enabled = 1, tokens_balance = 50, tokens_daily_base = 50, referred_by = null, is_subbot = 1, terms_accepted = 0, terms_accepted_at = null, terms_version = '1.0', can_participate_meteoric = 1, can_mention_members = 1, can_post_status = 1, access_mode = 'PUBLIC' }) {
    const count = db.prepare('SELECT COUNT(*) as count FROM whatsapp_army_instances').get().count;
    const sessionId = `session_${Date.now()}_${count + 1}`;
    const todayStr = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      INSERT INTO whatsapp_army_instances (
        name, phone, session_id, status, daily_limit, warmup_mode, is_main, active, tenant_id,
        ai_provider, ai_model, ai_instruction, ai_api_key, ai_enabled,
        tokens_balance, tokens_daily_base, last_token_reset, daily_shares_count, referral_code, referred_by, is_subbot,
        terms_accepted, terms_accepted_at, terms_version, can_participate_meteoric, can_mention_members, can_post_status,
        access_mode
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tempRefCode = `SUB-${Math.floor(1000 + Math.random() * 9000)}`;
    const isSubBotBool = is_subbot ? 1 : 0;
    const finalTokensBalance = isSubBotBool ? Math.min(50, Math.max(0, Number(tokens_balance || 50))) : Number(tokens_balance || 50);
    const finalTokensDailyBase = isSubBotBool ? Math.min(50, Math.max(0, Number(tokens_daily_base || 50))) : Number(tokens_daily_base || 50);
    const finalAccessMode = String(access_mode || 'PUBLIC').toUpperCase().trim() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';

    const res = stmt.run(
      name, phone || null, sessionId, status || 'DISCONNECTED', Number(daily_limit || 50), warmup_mode ? 1 : 0, tenant_id ? Number(tenant_id) : null,
      ai_provider || 'auto', ai_model || null, ai_instruction || null, ai_api_key || null, ai_enabled !== 0 ? 1 : 0,
      finalTokensBalance, finalTokensDailyBase, todayStr, tempRefCode, referred_by ? Number(referred_by) : null, isSubBotBool,
      terms_accepted ? 1 : 0, terms_accepted_at || (terms_accepted ? new Date().toISOString() : null), terms_version || '1.0',
      can_participate_meteoric !== 0 ? 1 : 0, can_mention_members !== 0 ? 1 : 0, can_post_status !== 0 ? 1 : 0,
      finalAccessMode
    );
    const newId = Number(res.lastInsertRowid);
    const finalRefCode = `SUB-${newId}`;
    try {
      db.prepare('UPDATE whatsapp_army_instances SET referral_code = ? WHERE id = ?').run(finalRefCode, newId);
    } catch (_) {}
    return models.getArmyInstanceById(newId);
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
    const tenant_id = data.tenant_id !== undefined ? (data.tenant_id ? Number(data.tenant_id) : null) : existing.tenant_id;
    const ai_provider = data.ai_provider !== undefined ? (data.ai_provider ? String(data.ai_provider).toLowerCase().trim() : 'auto') : (existing.ai_provider || 'auto');
    const ai_model = data.ai_model !== undefined ? (data.ai_model ? String(data.ai_model).trim() : null) : existing.ai_model;
    const ai_instruction = data.ai_instruction !== undefined ? (data.ai_instruction ? String(data.ai_instruction).trim() : null) : existing.ai_instruction;
    const ai_api_key = data.ai_api_key !== undefined ? (data.ai_api_key ? String(data.ai_api_key).trim() : null) : existing.ai_api_key;
    const ai_enabled = data.ai_enabled !== undefined ? (data.ai_enabled ? 1 : 0) : (existing.ai_enabled !== undefined ? existing.ai_enabled : 1);

    let tokens_balance = data.tokens_balance !== undefined ? Number(data.tokens_balance) : (existing.tokens_balance !== undefined ? existing.tokens_balance : 50);
    let tokens_daily_base = data.tokens_daily_base !== undefined ? Number(data.tokens_daily_base) : (existing.tokens_daily_base || 50);
    const last_token_reset = data.last_token_reset !== undefined ? data.last_token_reset : existing.last_token_reset;
    const daily_shares_count = data.daily_shares_count !== undefined ? Number(data.daily_shares_count) : (existing.daily_shares_count || 0);
    const last_daily_share_date = data.last_daily_share_date !== undefined ? data.last_daily_share_date : existing.last_daily_share_date;
    const official_groups_bonus_claimed = data.official_groups_bonus_claimed !== undefined ? data.official_groups_bonus_claimed : existing.official_groups_bonus_claimed;
    const referral_code = data.referral_code !== undefined ? data.referral_code : (existing.referral_code || `SUB-${id}`);
    const referred_by = data.referred_by !== undefined ? (data.referred_by ? Number(data.referred_by) : null) : existing.referred_by;
    const is_subbot = data.is_subbot !== undefined ? (data.is_subbot ? 1 : 0) : (existing.is_subbot !== undefined ? existing.is_subbot : 1);

    // Sub-Bot Free tem teto máximo diário inviolável de 50 tokens
    if (id !== 1 && is_subbot) {
      tokens_balance = Math.min(50, Math.max(0, tokens_balance));
      tokens_daily_base = Math.min(50, Math.max(0, tokens_daily_base));
    }

    const terms_accepted = data.terms_accepted !== undefined ? (data.terms_accepted ? 1 : 0) : (existing.terms_accepted || 0);
    const terms_accepted_at = data.terms_accepted_at !== undefined ? data.terms_accepted_at : existing.terms_accepted_at;
    const terms_version = data.terms_version !== undefined ? data.terms_version : (existing.terms_version || '1.0');
    const can_participate_meteoric = data.can_participate_meteoric !== undefined ? (data.can_participate_meteoric ? 1 : 0) : (existing.can_participate_meteoric !== undefined ? existing.can_participate_meteoric : 1);
    const can_mention_members = data.can_mention_members !== undefined ? (data.can_mention_members ? 1 : 0) : (existing.can_mention_members !== undefined ? existing.can_mention_members : 1);
    const can_post_status = data.can_post_status !== undefined ? (data.can_post_status ? 1 : 0) : (existing.can_post_status !== undefined ? existing.can_post_status : 1);
    const is_paused = data.is_paused !== undefined ? (data.is_paused ? 1 : 0) : (existing.is_paused !== undefined ? existing.is_paused : 0);
    const paused_at = data.paused_at !== undefined ? data.paused_at : (existing.paused_at || null);
    const pv_filter_mode = data.pv_filter_mode !== undefined ? String(data.pv_filter_mode).toUpperCase().trim() : (existing.pv_filter_mode || 'LEADS_AND_COMMANDS');
    const antitoxic_pv = data.antitoxic_pv !== undefined ? (data.antitoxic_pv ? 1 : 0) : (existing.antitoxic_pv !== undefined ? existing.antitoxic_pv : 1);
    const access_mode = data.access_mode !== undefined ? (String(data.access_mode).toUpperCase().trim() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC') : (existing.access_mode || 'PUBLIC');
    const enabled_features = data.enabled_features !== undefined ? (typeof data.enabled_features === 'string' ? data.enabled_features : JSON.stringify(data.enabled_features)) : (existing.enabled_features || null);

    db.prepare(`
      UPDATE whatsapp_army_instances
      SET name = ?, phone = ?, status = ?, daily_limit = ?, messages_sent_today = ?, warmup_mode = ?, active = ?, is_business = ?, business_catalog_synced = ?, catalog_products = ?, role = ?, health_score = ?, delivery_success_rate = ?, tenant_id = ?, ai_provider = ?, ai_model = ?, ai_instruction = ?, ai_api_key = ?, ai_enabled = ?,
          tokens_balance = ?, tokens_daily_base = ?, last_token_reset = ?, daily_shares_count = ?, last_daily_share_date = ?, official_groups_bonus_claimed = ?, referral_code = ?, referred_by = ?, is_subbot = ?,
          terms_accepted = ?, terms_accepted_at = ?, terms_version = ?, can_participate_meteoric = ?, can_mention_members = ?, can_post_status = ?,
          is_paused = ?, paused_at = ?,
          pv_filter_mode = ?, antitoxic_pv = ?,
          access_mode = ?,
          enabled_features = ?
      WHERE id = ?
    `).run(
      name, phone || null, status, daily_limit, messages_sent_today, warmup_mode, active, is_business, business_catalog_synced, catalog_products, role, health_score, delivery_success_rate, tenant_id, ai_provider, ai_model, ai_instruction, ai_api_key, ai_enabled,
      tokens_balance, tokens_daily_base, last_token_reset, daily_shares_count, last_daily_share_date, official_groups_bonus_claimed, referral_code, referred_by, is_subbot,
      terms_accepted, terms_accepted_at, terms_version, can_participate_meteoric, can_mention_members, can_post_status,
      is_paused, paused_at,
      pv_filter_mode, antitoxic_pv,
      access_mode,
      enabled_features,
      id
    );

    return models.getArmyInstanceById(id);
  },

  setMatrizAccessMode(mode = 'PUBLIC') {
    const cleanMode = String(mode).toUpperCase().trim() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
    this.setSetting('MATRIZ_ACCESS_MODE', cleanMode);
    try {
      this.updateArmyInstance(1, { access_mode: cleanMode });
    } catch (_) {}
    return cleanMode;
  },

  getMatrizAccessMode() {
    return (this.getSetting('MATRIZ_ACCESS_MODE', 'PUBLIC') || 'PUBLIC').toUpperCase().trim();
  },

  setSubBotAccessMode(id, mode = 'PUBLIC') {
    const cleanMode = String(mode).toUpperCase().trim() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
    this.updateArmyInstance(id, { access_mode: cleanMode });
    return cleanMode;
  },

  getSubBotAccessMode(id) {
    const inst = this.getArmyInstanceById(id);
    return inst ? ((inst.access_mode || 'PUBLIC').toUpperCase().trim()) : 'PUBLIC';
  },

  setBotAccessMode(instanceId = 1, mode = 'PUBLIC') {
    const id = Number(instanceId || 1);
    if (id === 1) {
      return this.setMatrizAccessMode(mode);
    } else {
      return this.setSubBotAccessMode(id, mode);
    }
  },

  getBotAccessMode(instanceId = 1) {
    const id = Number(instanceId || 1);
    if (id === 1) {
      return this.getMatrizAccessMode();
    } else {
      return this.getSubBotAccessMode(id);
    }
  },

  isBotPrivateMode(instanceId = 1) {
    return this.getBotAccessMode(instanceId) === 'PRIVATE';
  },

  pauseSubBot(id) {
    const inst = models.getArmyInstanceById(id);
    if (!inst) return null;
    return models.updateArmyInstance(id, {
      status: 'PAUSED',
      is_paused: 1,
      paused_at: new Date().toISOString()
    });
  },

  resumeSubBot(id) {
    const inst = models.getArmyInstanceById(id);
    if (!inst) return null;
    return models.updateArmyInstance(id, {
      status: 'CONNECTED',
      is_paused: 0,
      paused_at: null
    });
  },

  isSubBotPaused(id) {
    const inst = models.getArmyInstanceById(id);
    return !!(inst && (inst.is_paused === 1 || inst.status === 'PAUSED'));
  },

  setSubBotPvFilterMode(id, mode = 'LEADS_AND_COMMANDS') {
    return models.updateArmyInstance(id, { pv_filter_mode: mode });
  },

  getSubBotPvFilterMode(id) {
    const inst = models.getArmyInstanceById(id);
    return inst ? (inst.pv_filter_mode || 'LEADS_AND_COMMANDS') : 'LEADS_AND_COMMANDS';
  },

  isRegisteredLead(rawPhone) {
    if (!rawPhone) return false;
    const clean = String(rawPhone).replace(/\D/g, '');
    if (clean.length < 8) return false;
    const s8 = clean.slice(-8);

    // 1. Funil de Vendas / Leads
    try {
      const inFunnel = db.prepare('SELECT id FROM lead_funnel_conversations WHERE phone = ? OR phone LIKE ? LIMIT 1').get(clean, `%${s8}%`);
      if (inFunnel) return true;
    } catch (_) {}

    // 2. Campanhas de Divulgação
    try {
      const inCampaign = db.prepare('SELECT id FROM campaign_leads WHERE phone = ? OR phone LIKE ? LIMIT 1').get(clean, `%${s8}%`);
      if (inCampaign) return true;
    } catch (_) {}

    // 3. Leads capturados pelo Radar de Oportunidades
    try {
      const inRadar = db.prepare('SELECT id FROM radar_captured_leads WHERE sender_phone = ? OR sender_phone LIKE ? LIMIT 1').get(clean, `%${s8}%`);
      if (inRadar) return true;
    } catch (_) {}

    // 4. Clientes com pedidos na loja
    try {
      const inOrders = db.prepare('SELECT id FROM orders WHERE platform_user_id = ? OR platform_user_id LIKE ? LIMIT 1').get(clean, `%${s8}%`);
      if (inOrders) return true;
    } catch (_) {}

    // 5. CRM Cognitivo
    try {
      const inCrm = db.prepare('SELECT id FROM lead_cognitive_profiles WHERE phone = ? OR phone LIKE ? LIMIT 1').get(clean, `%${s8}%`);
      if (inCrm) return true;
    } catch (_) {}

    return false;
  },

  acceptSubBotTerms(id, version = '1.0') {
    const nowIso = new Date().toISOString();
    return models.updateArmyInstance(id, {
      terms_accepted: 1,
      terms_accepted_at: nowIso,
      terms_version: version,
      can_participate_meteoric: 1,
      can_mention_members: 1,
      can_post_status: 1
    });
  },

  getSubBotTermsStatus(id) {
    const inst = models.getArmyInstanceById(id);
    if (!inst) return null;
    return {
      id: inst.id,
      phone: inst.phone,
      terms_accepted: Boolean(inst.terms_accepted),
      terms_accepted_at: inst.terms_accepted_at,
      terms_version: inst.terms_version || '1.0',
      can_participate_meteoric: Boolean(inst.can_participate_meteoric !== 0),
      can_mention_members: Boolean(inst.can_mention_members !== 0),
      can_post_status: Boolean(inst.can_post_status !== 0),
      free_blocked: Boolean(inst.free_blocked),
      free_blocked_reason: inst.free_blocked_reason || null,
      free_blocked_at: inst.free_blocked_at || null
    };
  },

  /**
   * Bloqueia permanentemente um sub-bot free por violação dos termos.
   * Apenas o dono / bot master pode desbloquear via unblockSubBotFree().
   */
  blockSubBotFree(id, reason = 'Violação dos termos do Exército de Sub-Bots') {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE whatsapp_army_instances
      SET free_blocked = 1,
          free_blocked_reason = ?,
          free_blocked_at = ?,
          active = 0,
          status = 'BLOCKED'
      WHERE id = ?
    `).run(reason, now, id);
    return { id, free_blocked: true, reason, blocked_at: now };
  },

  /**
   * Desbloqueia um sub-bot free (apenas dono / bot master).
   */
  unblockSubBotFree(id) {
    db.prepare(`
      UPDATE whatsapp_army_instances
      SET free_blocked = 0,
          free_blocked_reason = NULL,
          free_blocked_at = NULL,
          active = 1,
          status = 'DISCONNECTED'
      WHERE id = ?
    `).run(id);
    return { id, free_blocked: false };
  },

  // Operações de Gamificação e Economia de Tokens de Sub-Bots
  getSubBotTokens(id) {
    const inst = models.getArmyInstanceById(id);
    if (!inst) return null;
    return {
      id: inst.id,
      name: inst.name,
      phone: inst.phone,
      tokens_balance: inst.tokens_balance !== undefined ? inst.tokens_balance : 50,
      tokens_daily_base: inst.tokens_daily_base || 50,
      last_token_reset: inst.last_token_reset,
      daily_shares_count: inst.daily_shares_count || 0,
      last_daily_share_date: inst.last_daily_share_date,
      official_groups_bonus_claimed: inst.official_groups_bonus_claimed,
      referral_code: inst.referral_code || `SUB-${inst.id}`,
      referred_by: inst.referred_by,
      is_subbot: inst.is_subbot !== undefined ? inst.is_subbot : 1
    };
  },

  logSubBotTokenTransaction({ instance_id, type, amount, balance_after, description = '', command = '', replenished = null, replenished_at = null, available_at = null, created_at = null }) {
    try {
      const nowIso = created_at || new Date().toISOString();
      const isConsumption = type === 'CONSUME_COMMAND' || Number(amount) < 0;
      const rep = replenished !== null ? Number(replenished) : (isConsumption ? 0 : 1);
      const repAt = replenished_at || (rep === 1 && !isConsumption ? nowIso : null);
      const availAt = available_at || (isConsumption ? new Date(new Date(nowIso).getTime() + 24 * 60 * 60 * 1000).toISOString() : nowIso);

      const stmt = db.prepare(`
        INSERT INTO subbot_token_logs (instance_id, type, amount, balance_after, description, command, replenished, replenished_at, available_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        Number(instance_id),
        String(type),
        Number(amount),
        Number(balance_after),
        String(description || ''),
        String(command || ''),
        rep,
        repAt,
        availAt,
        nowIso
      );
    } catch (err) {
      console.warn('[SubBot Tokens ⚠️] Erro ao registrar transação de token:', err.message);
      return null;
    }
  },

  getPendingReplenishments(instanceId) {
    try {
      return db.prepare(`
        SELECT * FROM subbot_token_logs 
        WHERE instance_id = ? 
          AND (type = 'CONSUME_COMMAND' OR amount < 0) 
          AND (replenished = 0 OR replenished IS NULL)
        ORDER BY created_at ASC
      `).all(Number(instanceId));
    } catch (_) {
      return [];
    }
  },

  getEligibleReplenishments(instanceId, nowIso = null) {
    try {
      const targetTime = nowIso || new Date().toISOString();
      const logs = db.prepare(`
        SELECT * FROM subbot_token_logs 
        WHERE instance_id = ? 
          AND (type = 'CONSUME_COMMAND' OR amount < 0) 
          AND (replenished = 0 OR replenished IS NULL)
        ORDER BY created_at ASC
      `).all(Number(instanceId));

      const targetMs = new Date(targetTime).getTime();
      return logs.filter(log => {
        if (log.available_at) {
          return new Date(log.available_at).getTime() <= targetMs;
        }
        if (log.created_at) {
          const createdMs = new Date(log.created_at).getTime();
          return (createdMs + 24 * 60 * 60 * 1000) <= targetMs;
        }
        return true;
      });
    } catch (_) {
      return [];
    }
  },

  markTokenLogsReplenished(logIds = [], replenishedAtIso = null) {
    if (!Array.isArray(logIds) || logIds.length === 0) return 0;
    try {
      const repAt = replenishedAtIso || new Date().toISOString();
      const placeholders = logIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE subbot_token_logs 
        SET replenished = 1, replenished_at = ?
        WHERE id IN (${placeholders})
      `);
      const res = stmt.run(repAt, ...logIds.map(Number));
      return res.changes;
    } catch (err) {
      console.warn('[SubBot Tokens ⚠️] Erro ao marcar logs como repostos:', err.message);
      return 0;
    }
  },

  getSubBotTokenLogs(instanceId, limit = 20) {
    try {
      return db.prepare('SELECT * FROM subbot_token_logs WHERE instance_id = ? ORDER BY id DESC LIMIT ?').all(Number(instanceId), Number(limit));
    } catch (_) {
      return [];
    }
  },

  recordSubBotMission({ instance_id, mission_date, mission_type, status = 'COMPLETED', proof_text = '', tokens_awarded = 100 }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO subbot_daily_missions (instance_id, mission_date, mission_type, status, proof_text, tokens_awarded)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(Number(instance_id), String(mission_date), String(mission_type), String(status), String(proof_text || ''), Number(tokens_awarded));
    } catch (err) {
      console.warn('[SubBot Missões ⚠️] Erro ao registrar missão:', err.message);
      return null;
    }
  },

  getSubBotMissionsToday(instanceId, dateStr = null) {
    try {
      const today = dateStr || new Date().toISOString().split('T')[0];
      return db.prepare('SELECT * FROM subbot_daily_missions WHERE instance_id = ? AND mission_date = ?').all(Number(instanceId), today);
    } catch (_) {
      return [];
    }
  },

  getSubBotByReferralCode(code) {
    if (!code) return null;
    try {
      const clean = String(code).trim().toUpperCase();
      return db.prepare('SELECT * FROM whatsapp_army_instances WHERE UPPER(referral_code) = ?').get(clean);
    } catch (_) {
      return null;
    }
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
      const seller = db.prepare("SELECT * FROM sellers WHERE replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE ?").get(`%${cleanPhone.slice(-8)}%`);
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

  // ==========================================
  // GESTÃO DE CHAVES DE IA POR SUB-BOT
  // ==========================================

  /**
   * Obtém as chaves de IA cadastradas para um determinado Sub-Bot.
   * @param {number|string} subbotId
   * @param {string} [provider] - 'gemini', 'groq', 'openai', etc. Se omitido, retorna dicionário por provedor.
   */
  getSubBotAiKeys(subbotId, provider = null) {
    if (!subbotId) return provider ? [] : {};
    const sId = Number(subbotId);
    const providers = ['gemini', 'groq', 'openai', 'deepseek', 'openrouter', 'local'];

    if (provider) {
      const p = String(provider).toLowerCase().trim();
      const raw = this.getSetting(`AI_SUBBOT_${sId}_KEYS_${p.toUpperCase()}`, '[]');
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return raw ? raw.split(',').map(k => k.trim()).filter(Boolean) : [];
      }
    }

    const result = {};
    for (const p of providers) {
      const raw = this.getSetting(`AI_SUBBOT_${sId}_KEYS_${p.toUpperCase()}`, '[]');
      try {
        const parsed = JSON.parse(raw);
        result[p] = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        result[p] = raw ? raw.split(',').map(k => k.trim()).filter(Boolean) : [];
      }
    }
    return result;
  },

  /**
   * Define a lista de chaves de IA de um Sub-Bot para um provedor.
   */
  setSubBotAiKeys(subbotId, provider, keysArray) {
    if (!subbotId || !provider) return [];
    const sId = Number(subbotId);
    const p = String(provider).toLowerCase().trim();
    const cleanKeys = Array.from(
      new Set(
        (Array.isArray(keysArray) ? keysArray : [keysArray])
          .map(k => String(k).trim())
          .filter(k => k && k.length > 3)
      )
    );
    this.setSetting(`AI_SUBBOT_${sId}_KEYS_${p.toUpperCase()}`, JSON.stringify(cleanKeys));
    return cleanKeys;
  },

  /**
   * Adiciona uma chave de API para o Sub-Bot.
   */
  addSubBotAiKey(subbotId, provider, key) {
    if (!subbotId || !provider || !key) throw new Error('Parâmetros obrigatórios ausentes.');
    const sId = Number(subbotId);
    const p = String(provider).toLowerCase().trim();
    const cleanKey = String(key).trim();
    const existing = this.getSubBotAiKeys(sId, p);
    if (!existing.includes(cleanKey)) {
      existing.push(cleanKey);
      this.setSubBotAiKeys(sId, p, existing);
    }
    return { subbotId: sId, provider: p, totalKeys: existing.length, keys: existing };
  },

  /**
   * Remove uma chave de API do Sub-Bot.
   */
  removeSubBotAiKey(subbotId, provider, key) {
    if (!subbotId || !provider) return { subbotId, provider, totalKeys: 0 };
    const sId = Number(subbotId);
    const p = String(provider).toLowerCase().trim();
    const cleanKey = String(key).trim();
    const existing = this.getSubBotAiKeys(sId, p);
    const filtered = existing.filter(k => {
      if (k === cleanKey) return false;
      const masked = k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : `${k.slice(0, 2)}...`;
      if (masked === cleanKey) return false;
      return true;
    });
    this.setSubBotAiKeys(sId, p, filtered);
    return { subbotId: sId, provider: p, totalKeys: filtered.length, keys: filtered };
  },

  // ==========================================
  // GESTÃO DE FUNÇÕES DE SUB-BOTS (CONTROLE DO DONO, DEVS & BOT MASTER)
  // ==========================================
  getDefaultSubBotFeatures() {
    return {
      ai: true,
      group_posts: true,
      pv_chat: true,
      audio_voice: true,
      media_dl: true,
      stickers: true,
      games: true,
      moderation: true,
      auto_heating: true
    };
  },

  getSubBotFeatures(instanceId) {
    if (!instanceId || Number(instanceId) === 1) {
      return this.getDefaultSubBotFeatures();
    }
    const inst = this.getArmyInstanceById(Number(instanceId));
    if (!inst) return this.getDefaultSubBotFeatures();

    let feats = this.getDefaultSubBotFeatures();
    if (inst.enabled_features) {
      try {
        const parsed = typeof inst.enabled_features === 'string' ? JSON.parse(inst.enabled_features) : inst.enabled_features;
        if (parsed && typeof parsed === 'object') {
          feats = { ...feats, ...parsed };
        }
      } catch (_) {}
    }

    if (inst.ai_enabled === 0) {
      feats.ai = false;
    }

    return feats;
  },

  isSubBotFeatureEnabled(instanceId, featureKey) {
    if (!instanceId || Number(instanceId) === 1) return true;
    const feats = this.getSubBotFeatures(instanceId);
    return feats[featureKey] !== false;
  },

  setSubBotFeature(instanceId, featureKey, enabled = true) {
    if (!instanceId || Number(instanceId) === 1) return this.getDefaultSubBotFeatures();
    const current = this.getSubBotFeatures(instanceId);
    const updated = { ...current, [featureKey]: Boolean(enabled) };

    const patch = { enabled_features: JSON.stringify(updated) };
    if (featureKey === 'ai') {
      patch.ai_enabled = enabled ? 1 : 0;
    }

    this.updateArmyInstance(Number(instanceId), patch);
    return updated;
  },

  setSubBotFeatures(targetIds, featuresPatch = {}) {
    const all = this.getArmyInstances().filter(i => !i.is_main && i.id !== 1);
    let ids = [];

    if (targetIds === 'all' || targetIds === '*' || (Array.isArray(targetIds) && targetIds.includes('all'))) {
      ids = all.map(i => i.id);
    } else if (Array.isArray(targetIds)) {
      ids = targetIds.map(Number).filter(id => id > 1);
    } else {
      ids = String(targetIds).split(/[\s,]+/).map(Number).filter(id => id > 1);
    }

    const updatedInstances = [];
    for (const id of ids) {
      const current = this.getSubBotFeatures(id);
      const merged = { ...current, ...featuresPatch };
      const patch = { enabled_features: JSON.stringify(merged) };
      if (featuresPatch.ai !== undefined) {
        patch.ai_enabled = featuresPatch.ai ? 1 : 0;
      }
      this.updateArmyInstance(id, patch);
      updatedInstances.push({ id, features: merged });
    }

    return { updatedCount: updatedInstances.length, instances: updatedInstances };
  },

  getAllSubBotsWithFeatures() {
    const all = this.getArmyInstances().filter(i => !i.is_main && i.id !== 1);
    return all.map(inst => ({
      ...inst,
      features: this.getSubBotFeatures(inst.id)
    }));
  },

  /**
   * Verifica se o Sub-Bot possui permissão/chaves para usar IA.
   * Se for a Matriz (id=1), sempre tem permissão. Se for sub-bot, precisa da função ativada e ao menos 1 chave.
   */
  canSubBotUseAi(subbotId) {
    if (!subbotId || Number(subbotId) === 1) return true;
    const sId = Number(subbotId);
    if (!this.isSubBotFeatureEnabled(sId, 'ai')) return false;
    const inst = this.getArmyInstanceById(sId);
    if (inst && inst.ai_api_key && inst.ai_api_key.trim()) return true;
    const allKeys = this.getSubBotAiKeys(sId);
    for (const p of Object.keys(allKeys)) {
      if (allKeys[p] && allKeys[p].length > 0) return true;
    }
    return false;
  },

  /**
   * Agrega todas as chaves cadastradas por todos os Sub-Bots (para uso no Mega-Pool do Bot Master).
   */
  getAllSubBotsAiKeys(provider = null) {
    const instances = this.getArmyInstances();
    const subbots = instances.filter(i => !i.is_main && i.id !== 1);
    const pTarget = provider ? String(provider).toLowerCase().trim() : null;

    if (pTarget) {
      const keys = [];
      for (const sb of subbots) {
        const sbKeys = this.getSubBotAiKeys(sb.id, pTarget);
        sbKeys.forEach(k => keys.push(k));
      }
      try {
        const rows = db.prepare('SELECT value FROM settings WHERE key LIKE ?').all(`AI_SUBBOT_%_KEYS_${pTarget.toUpperCase()}`);
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed)) parsed.forEach(k => keys.push(k));
          } catch (_) {}
        }
      } catch (_) {}
      return Array.from(new Set(keys));
    }

    const aggregated = {
      gemini: [],
      groq: [],
      openai: [],
      deepseek: [],
      openrouter: [],
      local: []
    };

    for (const sb of subbots) {
      const sbDict = this.getSubBotAiKeys(sb.id);
      for (const [p, kList] of Object.entries(sbDict)) {
        if (!aggregated[p]) aggregated[p] = [];
        kList.forEach(k => aggregated[p].push(k));
      }
    }

    try {
      const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('AI_SUBBOT_%_KEYS_%');
      for (const row of rows) {
        const m = row.key.match(/_KEYS_([A-Z0-9]+)$/);
        if (m) {
          const prov = m[1].toLowerCase();
          if (!aggregated[prov]) aggregated[prov] = [];
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed)) parsed.forEach(k => aggregated[prov].push(k));
          } catch (_) {}
        }
      }
    } catch (_) {}

    for (const p of Object.keys(aggregated)) {
      aggregated[p] = Array.from(new Set(aggregated[p]));
    }

    return aggregated;
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

  createAffiliateLink({
    title,
    platform = 'Hotmart',
    affiliate_url,
    commission_percent = 50.0,
    product_price = 0.0,
    original_price = 0.0,
    currency = 'BRL',
    pitch_copy = null,
    keywords = null,
    image_url = null,
    tenant_id = null,
    source = 'manual',
    original_product_url = null,
    platform_account_id = null,
    auto_distributed = 0,
    is_launch = 0,
    coupon_code = null,
    category = null,
    free_shipping = 1,
    rating = 4.9,
    active = 1
  }) {
    if (!title || !affiliate_url) throw new Error('Título e Link de Afiliado são obrigatórios.');
    const stmt = db.prepare(`
      INSERT INTO affiliate_links (
        title, platform, affiliate_url, commission_percent, product_price, original_price,
        currency, pitch_copy, keywords, image_url, tenant_id, source, original_product_url,
        platform_account_id, auto_distributed, is_launch, coupon_code, category, free_shipping, rating, active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      title,
      platform,
      affiliate_url,
      Number(commission_percent || 50.0),
      Number(product_price || 0.0),
      Number(original_price || 0.0),
      currency,
      pitch_copy || null,
      keywords ? String(keywords) : null,
      image_url ? String(image_url) : null,
      tenant_id ? Number(tenant_id) : null,
      source || 'manual',
      original_product_url || null,
      platform_account_id ? Number(platform_account_id) : null,
      auto_distributed ? 1 : 0,
      is_launch ? 1 : 0,
      coupon_code ? String(coupon_code).trim() : null,
      category ? String(category).trim() : null,
      free_shipping ? 1 : 0,
      Number(rating || 4.9),
      active ? 1 : 0
    );
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
    const original_price = data.original_price !== undefined ? Number(data.original_price) : (existing.original_price || 0.0);
    const currency = data.currency !== undefined ? data.currency : existing.currency;
    const pitch_copy = data.pitch_copy !== undefined ? data.pitch_copy : existing.pitch_copy;
    const keywords = data.keywords !== undefined ? data.keywords : existing.keywords;
    const image_url = data.image_url !== undefined ? data.image_url : existing.image_url;
    const tenant_id = data.tenant_id !== undefined ? (data.tenant_id ? Number(data.tenant_id) : null) : existing.tenant_id;
    const source = data.source !== undefined ? data.source : existing.source;
    const original_product_url = data.original_product_url !== undefined ? data.original_product_url : existing.original_product_url;
    const platform_account_id = data.platform_account_id !== undefined ? data.platform_account_id : existing.platform_account_id;
    const auto_distributed = data.auto_distributed !== undefined ? (data.auto_distributed ? 1 : 0) : existing.auto_distributed;
    const is_launch = data.is_launch !== undefined ? (data.is_launch ? 1 : 0) : (existing.is_launch || 0);
    const coupon_code = data.coupon_code !== undefined ? (data.coupon_code ? String(data.coupon_code).trim() : null) : existing.coupon_code;
    const category = data.category !== undefined ? (data.category ? String(data.category).trim() : null) : existing.category;
    const free_shipping = data.free_shipping !== undefined ? (data.free_shipping ? 1 : 0) : (existing.free_shipping ?? 1);
    const rating = data.rating !== undefined ? Number(data.rating) : (existing.rating ?? 4.9);
    const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

    db.prepare(`
      UPDATE affiliate_links
      SET title = ?, platform = ?, affiliate_url = ?, commission_percent = ?, product_price = ?, original_price = ?,
          currency = ?, pitch_copy = ?, keywords = ?, image_url = ?, tenant_id = ?, source = ?, original_product_url = ?,
          platform_account_id = ?, auto_distributed = ?, is_launch = ?, coupon_code = ?, category = ?, free_shipping = ?, rating = ?, active = ?
      WHERE id = ?
    `).run(
      title, platform, affiliate_url, commission_percent, product_price, original_price,
      currency, pitch_copy || null, keywords || null, image_url || null, tenant_id || null, source || 'manual',
      original_product_url || null, platform_account_id || null, auto_distributed, is_launch,
      coupon_code, category, free_shipping, rating, active, id
    );

    return models.getAffiliateLinkById(id);
  },

  // ==========================================
  // CONTAS DE AFILIADO DAS PLATAFORMAS (Mercado Livre, Shopee, Braip, Shein, Hotmart, Kiwify...)
  // ==========================================
  getAffiliatePlatformAccounts() {
    try {
      return db.prepare('SELECT * FROM affiliate_platform_accounts ORDER BY id ASC').all();
    } catch (_) {
      return [];
    }
  },

  getAffiliatePlatformAccountById(id) {
    try {
      return db.prepare('SELECT * FROM affiliate_platform_accounts WHERE id = ?').get(Number(id));
    } catch (_) {
      return null;
    }
  },

  getAffiliatePlatformAccountByPlatform(platform) {
    if (!platform) return null;
    const cleanPlat = String(platform).trim().toLowerCase();
    try {
      return db.prepare('SELECT * FROM affiliate_platform_accounts WHERE LOWER(platform) = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(cleanPlat);
    } catch (_) {
      return null;
    }
  },

  saveAffiliatePlatformAccount(data = {}) {
    const { id, platform, account_name, affiliate_id, tracking_tag, api_key, api_secret, cookie_token, notes, active = 1 } = data;
    if (!platform || !account_name) {
      throw new Error('Plataforma e Nome da Conta são obrigatórios.');
    }
    const cleanPlat = String(platform).trim().toLowerCase();

    if (id) {
      db.prepare(`
        UPDATE affiliate_platform_accounts
        SET platform = ?, account_name = ?, affiliate_id = ?, tracking_tag = ?, api_key = ?, api_secret = ?, cookie_token = ?, notes = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        cleanPlat,
        String(account_name).trim(),
        affiliate_id ? String(affiliate_id).trim() : null,
        tracking_tag ? String(tracking_tag).trim() : null,
        api_key ? String(api_key).trim() : null,
        api_secret ? String(api_secret).trim() : null,
        cookie_token ? String(cookie_token).trim() : null,
        notes ? String(notes).trim() : null,
        active ? 1 : 0,
        Number(id)
      );
      return models.getAffiliatePlatformAccountById(Number(id));
    }

    const res = db.prepare(`
      INSERT INTO affiliate_platform_accounts (platform, account_name, affiliate_id, tracking_tag, api_key, api_secret, cookie_token, notes, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanPlat,
      String(account_name).trim(),
      affiliate_id ? String(affiliate_id).trim() : null,
      tracking_tag ? String(tracking_tag).trim() : null,
      api_key ? String(api_key).trim() : null,
      api_secret ? String(api_secret).trim() : null,
      cookie_token ? String(cookie_token).trim() : null,
      notes ? String(notes).trim() : null,
      active ? 1 : 0
    );

    return models.getAffiliatePlatformAccountById(Number(res.lastInsertRowid));
  },

  deleteAffiliatePlatformAccount(id) {
    if (!id) return false;
    try {
      return db.prepare('DELETE FROM affiliate_platform_accounts WHERE id = ?').run(Number(id));
    } catch (_) {
      return false;
    }
  },

  createAffiliatePlatformAccount(data) {
    return this.saveAffiliatePlatformAccount(data);
  },

  updateAffiliatePlatformAccount(id, data) {
    return this.saveAffiliatePlatformAccount({ ...data, id });
  },

  deleteAffiliateLink(id) {
    return db.prepare('DELETE FROM affiliate_links WHERE id = ?').run(id);
  },

  trackAffiliateLinkClick(id) {
    return db.prepare('UPDATE affiliate_links SET clicks_count = clicks_count + 1 WHERE id = ?').run(id);
  },

  // ==========================================
  // CANAIS E GRUPOS DE ACHADINHOS (WHATSAPP @g.us / @newsletter)
  // ==========================================
  getAchadinhosChannels({ tenantId = undefined, activeOnly = false } = {}) {
    try {
      let query = 'SELECT ac.*, st.name as tenant_name FROM achadinhos_channels ac LEFT JOIN saas_tenants st ON ac.tenant_id = st.id WHERE 1=1';
      const params = [];

      if (tenantId === 'master' || tenantId === null) {
        query += ' AND ac.tenant_id IS NULL';
      } else if (tenantId !== undefined && tenantId !== 'all' && tenantId !== '*') {
        query += ' AND ac.tenant_id = ?';
        params.push(Number(tenantId));
      }

      if (activeOnly) {
        query += ' AND ac.active = 1';
      }

      query += ' ORDER BY ac.id DESC';
      return db.prepare(query).all(...params);
    } catch (_) {
      return [];
    }
  },

  getAchadinhosChannelById(id) {
    if (!id) return null;
    try {
      return db.prepare(`
        SELECT ac.*, st.name as tenant_name 
        FROM achadinhos_channels ac 
        LEFT JOIN saas_tenants st ON ac.tenant_id = st.id 
        WHERE ac.id = ?
      `).get(Number(id));
    } catch (_) {
      return null;
    }
  },

  getAchadinhosChannelByJid(targetJid) {
    if (!targetJid) return null;
    try {
      return db.prepare(`
        SELECT ac.*, st.name as tenant_name 
        FROM achadinhos_channels ac 
        LEFT JOIN saas_tenants st ON ac.tenant_id = st.id 
        WHERE ac.target_jid = ?
        LIMIT 1
      `).get(String(targetJid).trim());
    } catch (_) {
      return null;
    }
  },

  saveAchadinhosChannel(data = {}) {
    const {
      id,
      tenant_id = null,
      name,
      target_jid,
      channel_type = 'group',
      instance_id = null,
      template_style = 'fire_sale',
      header_text = null,
      footer_text = null,
      auto_post_new_links = 1,
      active = 1,
      mention_all_on_launch = 1,
      mention_all_on_good_deals = 1,
      mention_all_on_first_post = 1,
      mention_min_discount = 40
    } = data;

    if (!name || !target_jid) {
      throw new Error('Nome e JID do Canal/Grupo são obrigatórios.');
    }

    let cleanJid = String(target_jid).trim();
    // Normalização amigável de JID
    if (!cleanJid.includes('@')) {
      const digits = cleanJid.replace(/\D/g, '');
      if (channel_type === 'channel' || cleanJid.length >= 17) {
        cleanJid = `${digits}@newsletter`;
      } else {
        cleanJid = `${digits}@g.us`;
      }
    }

    const detectedType = cleanJid.endsWith('@newsletter') ? 'channel' : (channel_type || 'group');
    const safeTenantId = (tenant_id && Number(tenant_id) > 0) ? Number(tenant_id) : null;
    const safeInstanceId = (instance_id && Number(instance_id) > 0) ? Number(instance_id) : null;

    if (id) {
      db.prepare(`
        UPDATE achadinhos_channels
        SET tenant_id = ?, name = ?, target_jid = ?, channel_type = ?,
            instance_id = ?, template_style = ?, header_text = ?, footer_text = ?,
            auto_post_new_links = ?, active = ?,
            mention_all_on_launch = ?, mention_all_on_good_deals = ?, mention_all_on_first_post = ?, mention_min_discount = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        safeTenantId,
        String(name).trim(),
        cleanJid,
        detectedType,
        safeInstanceId,
        template_style || 'fire_sale',
        header_text ? String(header_text).trim() : null,
        footer_text ? String(footer_text).trim() : null,
        auto_post_new_links ? 1 : 0,
        active ? 1 : 0,
        mention_all_on_launch ? 1 : 0,
        mention_all_on_good_deals ? 1 : 0,
        mention_all_on_first_post ? 1 : 0,
        Number(mention_min_discount || 40),
        Number(id)
      );
      return models.getAchadinhosChannelById(Number(id));
    }

    const res = db.prepare(`
      INSERT INTO achadinhos_channels (
        tenant_id, name, target_jid, channel_type,
        instance_id, template_style, header_text, footer_text,
        auto_post_new_links, active,
        mention_all_on_launch, mention_all_on_good_deals, mention_all_on_first_post, mention_min_discount
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      safeTenantId,
      String(name).trim(),
      cleanJid,
      detectedType,
      safeInstanceId,
      template_style || 'fire_sale',
      header_text ? String(header_text).trim() : null,
      footer_text ? String(footer_text).trim() : null,
      auto_post_new_links ? 1 : 0,
      active ? 1 : 0,
      mention_all_on_launch ? 1 : 0,
      mention_all_on_good_deals ? 1 : 0,
      mention_all_on_first_post ? 1 : 0,
      Number(mention_min_discount || 40)
    );

    return models.getAchadinhosChannelById(Number(res.lastInsertRowid));
  },

  deleteAchadinhosChannel(id) {
    if (!id) return false;
    try {
      return db.prepare('DELETE FROM achadinhos_channels WHERE id = ?').run(Number(id));
    } catch (_) {
      return false;
    }
  },

  isAffiliateLinkFirstAchadinhoPost(linkId, channelId = null) {
    if (!linkId) return true;
    try {
      let query = 'SELECT COUNT(*) as count FROM achadinhos_posts_log WHERE affiliate_link_id = ?';
      const params = [Number(linkId)];
      if (channelId) {
        query += ' AND channel_id = ?';
        params.push(Number(channelId));
      }
      const row = db.prepare(query).get(...params);
      return (row?.count || 0) === 0;
    } catch (_) {
      return true;
    }
  },

  logAchadinhoPost(data = {}) {
    const {
      channel_id = null,
      tenant_id = null,
      affiliate_link_id = null,
      target_jid,
      product_title = '',
      affiliate_url = '',
      message_text = '',
      image_url = null,
      status = 'SENT',
      error_message = null,
      mentioned_all = 0,
      mention_reason = null
    } = data;

    try {
      const res = db.prepare(`
        INSERT INTO achadinhos_posts_log (
          channel_id, tenant_id, affiliate_link_id, target_jid,
          product_title, affiliate_url, message_text, image_url,
          status, error_message, mentioned_all, mention_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        channel_id ? Number(channel_id) : null,
        tenant_id ? Number(tenant_id) : null,
        affiliate_link_id ? Number(affiliate_link_id) : null,
        String(target_jid || ''),
        String(product_title || ''),
        String(affiliate_url || ''),
        String(message_text || ''),
        image_url ? String(image_url) : null,
        status || 'SENT',
        error_message ? String(error_message) : null,
        mentioned_all ? 1 : 0,
        mention_reason ? String(mention_reason).trim() : null
      );
      return res.lastInsertRowid;
    } catch (e) {
      console.warn('[LogAchadinhoPost Error]:', e.message);
      return null;
    }
  },

  getAchadinhosPostsLog({ tenantId = undefined, channelId = null, limit = 50 } = {}) {
    try {
      let query = `
        SELECT apl.*, ac.name as channel_name, st.name as tenant_name
        FROM achadinhos_posts_log apl
        LEFT JOIN achadinhos_channels ac ON apl.channel_id = ac.id
        LEFT JOIN saas_tenants st ON apl.tenant_id = st.id
        WHERE 1=1
      `;
      const params = [];

      if (tenantId === 'master' || tenantId === null) {
        query += ' AND apl.tenant_id IS NULL';
      } else if (tenantId !== undefined && tenantId !== 'all' && tenantId !== '*') {
        query += ' AND apl.tenant_id = ?';
        params.push(Number(tenantId));
      }

      if (channelId) {
        query += ' AND apl.channel_id = ?';
        params.push(Number(channelId));
      }

      query += ' ORDER BY apl.id DESC LIMIT ?';
      params.push(Math.min(200, Math.max(1, Number(limit) || 50)));

      return db.prepare(query).all(...params);
    } catch (_) {
      return [];
    }
  },

  // ==========================================
  // ALERTAS DE COMPRADORES & BUSCA DE ACHADINHOS
  // ==========================================
  addBuyerAlert({ phone, keyword, chat_jid = null }) {
    if (!phone || !keyword) throw new Error('Telefone e palavra-chave são obrigatórios.');
    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanKw = String(keyword).trim().toLowerCase();
    if (!cleanKw || cleanKw.length < 2) throw new Error('Palavra-chave muito curta.');

    try {
      const existing = db.prepare(`
        SELECT id FROM achadinhos_buyer_alerts
        WHERE phone = ? AND LOWER(keyword) = ?
      `).get(cleanPhone, cleanKw);

      if (existing) {
        return existing;
      }

      const res = db.prepare(`
        INSERT INTO achadinhos_buyer_alerts (phone, keyword, chat_jid)
        VALUES (?, ?, ?)
      `).run(cleanPhone, cleanKw, chat_jid || `${cleanPhone}@s.whatsapp.net`);

      return { id: Number(res.lastInsertRowid), phone: cleanPhone, keyword: cleanKw };
    } catch (e) {
      console.warn('[AddBuyerAlert Error]:', e.message);
      return null;
    }
  },

  getBuyerAlertsByPhone(phone) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      return db.prepare(`
        SELECT * FROM achadinhos_buyer_alerts
        WHERE phone = ?
        ORDER BY id DESC
      `).all(cleanPhone);
    } catch (_) {
      return [];
    }
  },

  removeBuyerAlert(phone, keyword = null) {
    if (!phone) return false;
    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      if (!keyword || keyword.toLowerCase() === 'all' || keyword.toLowerCase() === 'todos') {
        db.prepare('DELETE FROM achadinhos_buyer_alerts WHERE phone = ?').run(cleanPhone);
      } else {
        const cleanKw = String(keyword).trim().toLowerCase();
        db.prepare('DELETE FROM achadinhos_buyer_alerts WHERE phone = ? AND LOWER(keyword) = ?').run(cleanPhone, cleanKw);
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  findMatchingBuyerAlerts(textOrTitle) {
    if (!textOrTitle || typeof textOrTitle !== 'string') return [];
    const lower = textOrTitle.toLowerCase();
    try {
      const allAlerts = db.prepare('SELECT * FROM achadinhos_buyer_alerts ORDER BY id ASC').all();
      return allAlerts.filter(a => {
        const kw = String(a.keyword || '').trim().toLowerCase();
        return kw && lower.includes(kw);
      });
    } catch (_) {
      return [];
    }
  },

  markBuyerAlertNotified(alertId) {
    if (!alertId) return false;
    try {
      return db.prepare(`
        UPDATE achadinhos_buyer_alerts
        SET notified_count = notified_count + 1, last_notified_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(Number(alertId));
    } catch (_) {
      return false;
    }
  },

  searchDeals(query, { limit = 5 } = {}) {
    if (!query || typeof query !== 'string') return [];
    const clean = query.trim().toLowerCase();
    try {
      const sql = `
        SELECT * FROM affiliate_links
        WHERE active = 1
          AND (
            LOWER(title) LIKE ?
            OR LOWER(COALESCE(keywords, '')) LIKE ?
            OR LOWER(COALESCE(category, '')) LIKE ?
            OR LOWER(COALESCE(platform, '')) LIKE ?
            OR LOWER(COALESCE(pitch_copy, '')) LIKE ?
          )
        ORDER BY id DESC
        LIMIT ?
      `;
      const term = `%${clean}%`;
      return db.prepare(sql).all(term, term, term, term, term, Number(limit));
    } catch (_) {
      return [];
    }
  },

  getActiveDeals({ limit = 50 } = {}) {
    try {
      return db.prepare(`
        SELECT * FROM affiliate_links
        WHERE active = 1
          AND affiliate_url NOT LIKE '%test%'
          AND affiliate_url NOT LIKE '%example%'
          AND affiliate_url NOT LIKE '%ml_top_123%'
          AND affiliate_url NOT LIKE '%shope_tag_01%'
          AND affiliate_url NOT LIKE '%trader-pro-test%'
        ORDER BY id DESC
        LIMIT ?
      `).all(Number(limit) || 50);
    } catch (_) {
      return [];
    }
  },

  getDealById(id) {
    return models.getAffiliateLinkById(id);
  },

  deactivateDeal(id) {
    if (!id) return false;
    try {
      return db.prepare('UPDATE affiliate_links SET active = 0 WHERE id = ?').run(Number(id));
    } catch (_) {
      return false;
    }
  },

  getPendingAffiliateLinks({ limit = 50 } = {}) {
    try {
      return db.prepare(`
        SELECT * FROM affiliate_links
        WHERE active = 0
        ORDER BY id DESC
        LIMIT ?
      `).all(Number(limit) || 50);
    } catch (_) {
      return [];
    }
  },

  attachUserAffiliateLink(linkId, userAffiliateUrl) {
    if (!linkId || !userAffiliateUrl) return null;
    const cleanUrl = String(userAffiliateUrl).trim();
    try {
      const existing = models.getAffiliateLinkById(Number(linkId));
      if (!existing) return null;
      db.prepare(`
        UPDATE affiliate_links
        SET affiliate_url = ?, active = 1
        WHERE id = ?
      `).run(cleanUrl, Number(linkId));
      return models.getAffiliateLinkById(Number(linkId));
    } catch (_) {
      return null;
    }
  },

  // ==========================================
  // 16. CAMPANHAS DE DIVULGAÇÃO & SPINTAX (AFFILIATE BROADCAST)
  // ==========================================
  parseSpintax(text, vars = {}) {
    if (!text) return '';
    let result = text;
    if (vars && typeof vars === 'object') {
      for (const [key, val] of Object.entries(vars)) {
        if (val !== undefined && val !== null) {
          result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(val));
        }
      }
    }
    const regex = /\{([^{}]*\|[^{}]*)\}/;
    let matches;
    let safetyCounter = 0;
    while ((matches = regex.exec(result)) !== null && safetyCounter < 100) {
      safetyCounter++;
      const options = matches[1].split('|');
      const randomOption = options[Math.floor(Math.random() * options.length)];
      result = result.replace(matches[0], randomOption);
    }
    return result;
  },

  formatCampaignMessage(template, lead = {}, campaign = {}) {
    let msg = template || '';
    const greeting = dateTimeUtils.getBrasiliaGreeting().saudacao;
    const rawName = (lead.name || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|undefined|null)$/i.test(rawName);
    const firstName = isGeneric ? '' : rawName.split(' ')[0];

    if (firstName) {
      msg = msg.replace(/\{nome\}/gi, firstName);
    } else {
      msg = msg.replace(/\s*\{nome\}/gi, '');
      msg = msg.replace(/\{nome\}\s*,?\s*/gi, '');
    }
    msg = msg.replace(/\{saudacao\}/gi, greeting);
    msg = msg.replace(/\{produto\}/gi, campaign.product_name || 'Produto Especial');
    msg = msg.replace(/\{link\}/gi, campaign.affiliate_url || '');
    return models.parseSpintax(msg).replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
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

    const rows = db.prepare('SELECT platform, COUNT(*) as count FROM social_accounts GROUP BY platform').all();
    const platformCounts = {};
    rows.forEach(r => { platformCounts[r.platform] = r.count; });

    return {
      totalAccounts,
      igAccounts,
      fbAccounts,
      platformCounts,
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

  muteChat(arg1, arg2, arg3, arg4) {
    let platform, chatId, targetType, reason, createdBy, userName;
    if (typeof arg1 === 'object' && arg1 !== null) {
      ({ platform = 'whatsapp', chatId, targetType = 'PRIVATE', reason = 'Desativado via comando', createdBy = 'admin', userName = null } = arg1);
    } else {
      platform = arg1 || 'whatsapp';
      chatId = arg2;
      reason = arg3 || 'Desativado via comando';
      createdBy = arg4 || 'admin';
      targetType = String(chatId).includes('@g.us') ? 'GROUP' : 'PRIVATE';
    }

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
      `).run(targetType || 'PRIVATE', reason || null, userName || null, existing.id);
      return { id: existing.id, muted: true };
    } else {
      const info = db.prepare(`
        INSERT INTO bot_chat_controls (platform, control_type, target_type, chat_id, reason, created_by, user_name, active)
        VALUES (?, 'MUTE_CHAT', ?, ?, ?, ?, ?, 1)
      `).run(platform, targetType || 'PRIVATE', cleanChat, reason || null, createdBy || 'admin', userName || null);
      return { id: info.lastInsertRowid, muted: true };
    }
  },

  unmuteChat(arg1, arg2) {
    let platform, chatId;
    if (typeof arg1 === 'object' && arg1 !== null) {
      ({ platform = 'whatsapp', chatId } = arg1);
    } else {
      platform = arg1 || 'whatsapp';
      chatId = arg2;
    }
    const cleanChat = String(chatId).trim();
    const info = db.prepare(`
      UPDATE bot_chat_controls
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE platform = ? AND control_type = 'MUTE_CHAT' AND chat_id = ?
    `).run(platform, cleanChat);
    return { unmuted: info.changes > 0 };
  },

  blockUser(arg1, arg2, arg3, arg4, arg5) {
    let platform, userId, chatId, targetType, reason, createdBy, userName;
    if (typeof arg1 === 'object' && arg1 !== null) {
      ({ platform = 'whatsapp', userId, chatId = null, targetType = 'USER', reason = 'Participante bloqueado', createdBy = 'admin', userName = null } = arg1);
    } else {
      platform = arg1 || 'whatsapp';
      userId = arg2;
      chatId = arg3 || '*';
      reason = arg4 || 'Participante bloqueado';
      createdBy = arg5 || 'admin';
      targetType = 'USER';
    }

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
      `).run(reason || null, userName || null, existing.id);
      return { id: existing.id, blocked: true };
    } else {
      const info = db.prepare(`
        INSERT INTO bot_chat_controls (platform, control_type, target_type, chat_id, user_id, user_name, reason, created_by, active)
        VALUES (?, 'BLOCK_USER', ?, ?, ?, ?, ?, ?, 1)
      `).run(platform, targetType || 'USER', cleanChat, cleanUser, userName || null, reason || null, createdBy || 'admin');
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
    const welcomeSvg = this.getSetting(`WELCOME_SVG_${groupId}`, 'true') !== 'false';
    const welcomeSvgTheme = this.getSetting(`WELCOME_SVG_THEME_${groupId}`, 'cyber');
    const welcomeSvgDoc = this.getSetting(`WELCOME_SVG_DOC_${groupId}`, 'false') === 'true';
    const antifake = this.getSetting(`ANTIFAKE_${groupId}`, 'false') === 'true';
    const antiviewonce = this.getSetting(`ANTIVIEWONCE_${groupId}`, 'true') === 'true';
    const antidelete = this.getSetting(`ANTIDELETE_${groupId}`, 'false') === 'true';
    const bye = this.getSetting(`BYE_${groupId}`, 'false') === 'true';
    const byeMsg = this.getSetting(
      `BYE_MSG_${groupId}`,
      '👋 @{numero} saiu ou foi removido do grupo *{grupo}*.'
    );
    const botActive = this.isGroupBotActive(groupId);
    const postingActive = this.isGroupPostingActive(groupId);
    const soDivu = this.isGroupSoDivuActive(groupId);
    const globalSoDivu = this.isGlobalSoDivuActive();
    return { platform, groupId, antilink, welcome, welcomeMsg, welcomeSvg, welcomeSvgTheme, welcomeSvgDoc, antifake, antiviewonce, antidelete, bye, byeMsg, botActive, postingActive, soDivu, globalSoDivu };
  },

  updateGroupSettings(platform, groupId, {
    antilink = null,
    welcome = null,
    welcomeMsg = null,
    welcomeSvg = null,
    welcomeSvgTheme = null,
    welcomeSvgDoc = null,
    antifake = null,
    antiviewonce = null,
    antidelete = null,
    bye = null,
    byeMsg = null,
    botActive = null,
    postingActive = null,
    soDivu = null,
    globalSoDivu = null
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
    if (welcomeSvg !== null && welcomeSvg !== undefined) {
      this.setSetting(`WELCOME_SVG_${groupId}`, welcomeSvg ? 'true' : 'false');
    }
    if (welcomeSvgTheme !== null && welcomeSvgTheme !== undefined) {
      this.setSetting(`WELCOME_SVG_THEME_${groupId}`, String(welcomeSvgTheme).toLowerCase().trim());
    }
    if (welcomeSvgDoc !== null && welcomeSvgDoc !== undefined) {
      this.setSetting(`WELCOME_SVG_DOC_${groupId}`, welcomeSvgDoc ? 'true' : 'false');
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
    if (botActive !== null && botActive !== undefined) {
      this.setGroupBotActive(groupId, !!botActive);
    }
    if (postingActive !== null && postingActive !== undefined) {
      this.setGroupPostingActive(groupId, !!postingActive);
    }
    if (soDivu !== null && soDivu !== undefined) {
      this.setGroupSoDivu(groupId, !!soDivu);
    }
    if (globalSoDivu !== null && globalSoDivu !== undefined) {
      this.setGlobalSoDivu(!!globalSoDivu);
    }
    return this.getGroupSettings(platform, groupId);
  },

  isAntiDeleteActive(groupId) {
    if (!groupId) return false;
    if (this.getSetting(`ANTIDELETE_${groupId}`, 'false') === 'true') return true;
    if (this.getSetting('ANTIDELETE_GLOBAL', 'false') === 'true') return true;
    try {
      const prot = this.getGroupProtection(groupId);
      if (prot && (prot.x9_enabled === 1 || prot.antidelete_enabled === 1)) return true;
    } catch (_) {}
    return false;
  },

  isGroupX9Active(groupId) {
    if (!groupId) return false;
    try {
      const prot = this.getGroupProtection(groupId);
      return prot && prot.x9_enabled === 1;
    } catch (_) {
      return false;
    }
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
    
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Dono nunca recebe advertências!
    if (this.isOwner(cleanPhone)) {
      return { count: 0, reason, warnedBy, userPhone: cleanPhone, isOwner: true, blocked: true };
    }

    db.prepare(`
      INSERT INTO group_warnings (group_id, user_phone, reason, warned_by)
      VALUES (?, ?, ?, ?)
    `).run(cleanGroup, cleanPhone, reason, warnedBy);

    const count = this.getWarningsCount(cleanGroup, cleanPhone);
    return { count, reason, warnedBy, userPhone: cleanPhone };
  },

  addWarn(groupId, userPhone, reason = 'Violação de regras do grupo', warnedBy = 'Admin') {
    return this.addWarning(groupId, userPhone, reason, warnedBy);
  },

  getWarningsCount(groupId, userPhone) {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Dono sempre tem 0 advertências
    if (this.isOwner(cleanPhone)) return 0;

    const cleanGroup = String(groupId).trim();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM group_warnings 
      WHERE group_id = ? AND user_phone = ?
    `).get(cleanGroup, cleanPhone);
    return row ? row.count : 0;
  },

  getWarnCount(groupId, userPhone) {
    return this.getWarningsCount(groupId, userPhone);
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
        total_leads_reached: 0,
        product_id: 1,
        admin_subbot_id: 1,
        buyer_subbot_ids: '',
        buyers_group_jid: '',
        buyers_group_invite_url: '',
        buyers_group_admin_id: 1,
        buyers_group_workflow: '',
        auto_move_buyers: 1
      };
    }
    return row;
  },

  updateMeteoricCampaign(updates = {}, id = 1) {
    const allowed = [
      'name', 'group_base_name', 'max_members_per_group', 'active',
      'current_group_id', 'current_stage', 'group_description',
      'total_groups_created', 'total_leads_reached',
      'product_id', 'admin_subbot_id', 'buyer_subbot_ids',
      'buyers_group_jid', 'buyers_group_invite_url', 'buyers_group_admin_id',
      'buyers_group_workflow', 'auto_move_buyers'
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
        product_id, hook, body, cta, hashtags, media_suggestion, media_url, full_content, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.media_url || null,
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
    const allowed = ['title', 'target_platform', 'tone', 'objective', 'product_id', 'hook', 'body', 'cta', 'hashtags', 'media_suggestion', 'media_url', 'full_content', 'status', 'published_at'];
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
  getStoreProducts(category = null, search = null, tenantId = null) {
    let sql = 'SELECT * FROM products WHERE active = 1 AND (army_instance_id IS NULL OR army_instance_id = 0)';
    const params = [];
    if (tenantId) {
      sql += ' AND tenant_id = ?';
      params.push(tenantId);
    } else {
      sql += ' AND (tenant_id IS NULL OR tenant_id = 0)';
    }
    if (category && category !== 'Todos') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search && search.trim()) {
      sql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }
    sql += ' ORDER BY COALESCE(intelligence_score, 85.0) DESC, COALESCE(profit_margin_percent, 90.0) DESC, id DESC';
    const products = db.prepare(sql).all(...params);
    return products.map(p => {
      if (!p.image_url || !String(p.image_url).trim()) {
        p.image_url = models.getDefaultProductImage(p.category, p.name);
      }
      return p;
    });
  },

  /**
   * Registra visualização de produto na vitrine e recalcula score de inteligência
   */
  recordProductView(productId) {
    if (!productId) return null;
    const id = Number(productId);
    try {
      db.prepare(`
        UPDATE products
        SET views_count = views_count + 1,
            intelligence_score = ROUND((COALESCE(profit_margin_percent, 90.0) * 0.45) + (COALESCE(sales_count, 0) * 5.0) + ((views_count + 1) * 0.2), 1)
        WHERE id = ?
      `).run(id);
      return models.getProductById(id);
    } catch (_) {
      return null;
    }
  },

  /**
   * Registra adição de produto ao carrinho e recalcula score de inteligência
   */
  recordProductCartAdd(productId) {
    if (!productId) return null;
    const id = Number(productId);
    try {
      db.prepare(`
        UPDATE products
        SET cart_adds_count = cart_adds_count + 1,
            intelligence_score = ROUND((COALESCE(profit_margin_percent, 90.0) * 0.45) + (COALESCE(sales_count, 0) * 5.0) + (views_count * 0.2) + ((cart_adds_count + 1) * 2.0), 1)
        WHERE id = ?
      `).run(id);
      return models.getProductById(id);
    } catch (_) {
      return null;
    }
  },

  /**
   * Registra venda concluída do produto e impulsiona seu score de inteligência
   */
  recordProductSale(productId, amount = null) {
    if (!productId) return null;
    const id = Number(productId);
    try {
      db.prepare(`
        UPDATE products
        SET sales_count = sales_count + 1,
            intelligence_score = ROUND((COALESCE(profit_margin_percent, 90.0) * 0.45) + ((sales_count + 1) * 6.0) + (views_count * 0.2), 1)
        WHERE id = ?
      `).run(id);
      return models.getProductById(id);
    } catch (_) {
      return null;
    }
  },

  /**
   * Retorna os produtos mais inteligentes da vitrine ordenados por margem de lucro e conversão
   */
  getHighMarginSmartProducts(limit = 6, tenantId = null) {
    let sql = `
      SELECT * FROM products
      WHERE active = 1 AND (army_instance_id IS NULL OR army_instance_id = 0)
    `;
    const params = [];
    if (tenantId) {
      sql += ' AND tenant_id = ?';
      params.push(tenantId);
    } else {
      sql += ' AND (tenant_id IS NULL OR tenant_id = 0)';
    }
    sql += `
      ORDER BY
        COALESCE(intelligence_score, 85.0) DESC,
        COALESCE(profit_margin_percent, 90.0) DESC,
        price_brl DESC
      LIMIT ?
    `;
    params.push(limit);
    const prods = db.prepare(sql).all(...params);
    return prods.map(p => {
      if (!p.image_url || !String(p.image_url).trim()) {
        p.image_url = models.getDefaultProductImage(p.category, p.name);
      }
      return p;
    });
  },

  /**
   * Retorna lista pública anonimizada de compras recentes para prova social ao vivo na loja web
   */
  getRecentPublicPurchases(limit = 8, tenantId = null) {
    let sql = `
      SELECT o.id, o.amount, o.currency, o.platform_user_name, o.created_at,
             p.image_url, p.name as product_name, p.category
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = 'PAID'
    `;
    const params = [];
    if (tenantId) {
      sql += ' AND o.tenant_id = ?';
      params.push(tenantId);
    }
    sql += ' ORDER BY o.id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    const locations = [
      'São Paulo/SP', 'Rio de Janeiro/RJ', 'Belo Horizonte/MG', 'Curitiba/PR',
      'Brasília/DF', 'Porto Alegre/RS', 'Salvador/BA', 'Florianópolis/SC',
      'Goiânia/GO', 'Campinas/SP', 'Fortaleza/CE', 'Recife/PE'
    ];

    const formatCustomerName = (rawName, idx) => {
      if (!rawName || /^(cliente|lead|amigo|user|undefined|null|Lead Loja Web)$/i.test(rawName.trim())) {
        const fallbacks = ['Lucas M.', 'Mariana S.', 'Rafael C.', 'Ana P.', 'Felipe G.', 'Camila T.', 'Rodrigo B.', 'Juliana K.'];
        return fallbacks[idx % fallbacks.length];
      }
      const parts = rawName.trim().split(/\s+/);
      if (parts.length === 1) return parts[0];
      return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
    };

    const results = rows.map((r, idx) => {
      const loc = locations[(r.id || idx) % locations.length];
      const prodName = r.p_name || r.product_name || 'Produto VIP';
      const img = r.image_url || models.getDefaultProductImage(r.category, prodName);
      const minutesAgo = Math.max(1, (idx * 3) + 2);
      return {
        id: r.id,
        customer_name: formatCustomerName(r.platform_user_name, idx),
        location: loc,
        product_name: prodName,
        product_image: img,
        amount: Number(r.amount || 0),
        currency: r.currency || 'BRL',
        time_ago: minutesAgo === 1 ? 'há 1 minuto' : `há ${minutesAgo} minutos`
      };
    });

    if (results.length < limit) {
      const prods = models.getHighMarginSmartProducts(5, tenantId);
      const sampleNames = ['Gustavo L.', 'Beatriz M.', 'Thiago R.', 'Larissa F.', 'Eduardo V.'];
      for (let i = results.length; i < limit; i++) {
        const prod = (prods && prods[i % prods.length]) || { name: 'Aluguel PayBot Pro', price_brl: 97.0, category: 'software' };
        const loc = locations[(i * 5) % locations.length];
        const minutesAgo = (i * 4) + 3;
        results.push({
          id: 99000 + i,
          customer_name: sampleNames[i % sampleNames.length],
          location: loc,
          product_name: prod.name,
          product_image: prod.image_url || models.getDefaultProductImage(prod.category, prod.name),
          amount: Number(prod.price_brl || 97),
          currency: 'BRL',
          time_ago: `há ${minutesAgo} minutos`
        });
      }
    }

    return results;
  },

  /**
   * Recupera o contexto em tempo real do lead na loja web (carrinho, último produto olhado, intenção)
   */
  getLeadStoreContext(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    const profile = models.getLeadCognitiveProfile(clean);
    const cart = models.getCartSession(`sess_lead_${clean}`);
    const recentMemories = models.getLeadEpisodicMemories(clean, 5);

    let lastViewedName = profile?.last_viewed_product_name || cart?.current_product_name || null;
    let lastViewedId = profile?.last_viewed_product_id || cart?.current_product_id || null;
    let cartTotal = Number(profile?.current_cart_total || cart?.cart_total || 0);

    return {
      phone: clean,
      name: profile?.name || cart?.customer_name || 'Cliente',
      buying_stage: profile?.buying_stage || 'DESCOBERTA',
      readiness_score: profile?.readiness_score || 30,
      last_viewed_product_id: lastViewedId,
      last_viewed_product_name: lastViewedName,
      cart_total: cartTotal,
      cart_status: cart?.status || 'NONE',
      device: cart?.device || null,
      location: cart?.location || null,
      is_online: cart?.is_online || 0,
      has_active_cart: Boolean(cart && (cart.status === 'IN_CART' || cart.status === 'CHECKOUT_OPEN')),
      recentMemories
    };
  },

  /**
   * Registra a margem e lucro líquido da transação
   */
  recordOrderProfit(tradeNo, profitAmount, marginPercent = 90.0) {
    if (!tradeNo) return false;
    try {
      db.prepare(`
        UPDATE orders
        SET profit_amount = ?, profit_margin_percent = ?
        WHERE merchant_trade_no = ?
      `).run(Number(profitAmount || 0), Number(marginPercent || 90.0), tradeNo);
      return true;
    } catch (_) {
      return false;
    }
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
    const brHour = dateTimeUtils.getBrasiliaHour(now);
    const hoursElapsed = Math.max(1, brHour + (now.getMinutes() / 60));
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

  saveLeadCognitiveProfile(data = {}) {
    const phone = data.phone || data.lead_phone;
    return models.upsertLeadCognitiveProfile(phone, data);
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
          next_followup_at, followup_count, notes,
          last_viewed_product_id, last_viewed_product_name, current_cart_total, high_margin_interest, last_store_visit_at,
          prefers_audio, preferred_channel,
          last_interaction_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanPhone,
        data.name || 'Lead WhatsApp',
        data.company_niche || '',
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
        data.last_viewed_product_id !== undefined ? (data.last_viewed_product_id ? Number(data.last_viewed_product_id) : null) : null,
        data.last_viewed_product_name ?? null,
        data.current_cart_total !== undefined ? Number(data.current_cart_total) : 0,
        data.high_margin_interest !== undefined ? (data.high_margin_interest ? 1 : 0) : 0,
        data.last_store_visit_at ?? null,
        data.prefers_audio !== undefined ? (data.prefers_audio ? 1 : 0) : 0,
        data.preferred_channel || 'text',
        now,
        now
      );
    } else {
      const updated = {
        name: data.name ?? existing.name ?? 'Lead WhatsApp',
        company_niche: data.company_niche ?? existing.company_niche ?? '',
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
        notes: data.notes ?? existing.notes ?? '',
        last_viewed_product_id: data.last_viewed_product_id !== undefined ? (data.last_viewed_product_id ? Number(data.last_viewed_product_id) : null) : (existing.last_viewed_product_id ?? null),
        last_viewed_product_name: data.last_viewed_product_name !== undefined ? data.last_viewed_product_name : (existing.last_viewed_product_name ?? null),
        current_cart_total: data.current_cart_total !== undefined ? Number(data.current_cart_total) : (existing.current_cart_total ?? 0),
        high_margin_interest: data.high_margin_interest !== undefined ? (data.high_margin_interest ? 1 : 0) : (existing.high_margin_interest ?? 0),
        last_store_visit_at: data.last_store_visit_at ?? existing.last_store_visit_at ?? null,
        prefers_audio: data.prefers_audio !== undefined ? (data.prefers_audio ? 1 : 0) : (existing.prefers_audio ?? 0),
        preferred_channel: data.preferred_channel ?? existing.preferred_channel ?? 'text'
      };

      db.prepare(`
        UPDATE lead_cognitive_profiles SET
          name = ?, company_niche = ?, project_scope = ?, tech_stack = ?,
          budget_tier = ?, budget_confidence = ?, buying_stage = ?, readiness_score = ?,
          main_objection = ?, objection_confidence = ?, last_quote_amount = ?, last_quote_details = ?,
          next_followup_at = ?, followup_count = ?, notes = ?,
          last_viewed_product_id = ?, last_viewed_product_name = ?, current_cart_total = ?, high_margin_interest = ?, last_store_visit_at = ?,
          prefers_audio = ?, preferred_channel = ?,
          last_interaction_at = ?, updated_at = ?
        WHERE phone = ?
      `).run(
        updated.name, updated.company_niche, updated.project_scope, updated.tech_stack,
        updated.budget_tier, updated.budget_confidence, updated.buying_stage, updated.readiness_score,
        updated.main_objection, updated.objection_confidence, updated.last_quote_amount, updated.last_quote_details,
        updated.next_followup_at, updated.followup_count, updated.notes,
        updated.last_viewed_product_id, updated.last_viewed_product_name, updated.current_cart_total, updated.high_margin_interest, updated.last_store_visit_at,
        updated.prefers_audio, updated.preferred_channel,
        now, now,
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

  recordCognitiveMemory(phone, data = {}) {
    if (!phone) return null;
    const memoryType = data.memory_type || data.type || 'REQUIREMENT';
    const factSummary = data.fact_summary || data.summary || data.text || '';
    const rawExcerpt = data.raw_excerpt || data.excerpt || '';
    const importance = data.importance || (data.confidence_score ? Math.round(data.confidence_score * 5) : 3);
    return this.addLeadEpisodicMemory(phone, memoryType, factSummary, rawExcerpt, importance);
  },

  getLeadEpisodicMemories(phone, limit = 20) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM lead_episodic_memories WHERE lead_phone = ? ORDER BY created_at DESC LIMIT ?').all(cleanPhone, limit);
  },

  getLeadsPendingFollowup(limit = 20) {
    return db.prepare(`
      SELECT * FROM lead_cognitive_profiles
      WHERE buying_stage NOT IN ('PERDIDO', 'CONVERTIDO')
        AND (
          (next_followup_at IS NOT NULL AND datetime(next_followup_at) <= datetime('now'))
          OR (buying_stage IN ('PROPOSTA', 'QUALIFICACAO', 'OBJECOES') AND datetime(last_interaction_at) <= datetime('now', '-24 hours'))
        )
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
      let baseDate = new Date();
      // Se o grupo já possui aluguel ativo com dias restantes, estende a partir da data de vencimento atual!
      const current = this.getGroupRental(groupId);
      if (current && current.active && current.expires_at && current.expires_at !== 'permanent') {
        const curExp = new Date(current.expires_at);
        if (curExp > baseDate) {
          baseDate = curExp;
        }
      }
      baseDate.setDate(baseDate.getDate() + Number(durationDays));
      expiresAt = baseDate.toISOString();
      status = 'active';
    } else if (durationDays === -1 || durationDays === 'permanent') {
      expiresAt = 'permanent';
      status = 'permanent';
    } else {
      throw new Error('Duração de aluguel inválida.');
    }

    db.prepare(`
      INSERT INTO group_rentals (group_jid, group_name, expires_at, status, rental_code, payer_phone, payer_name, notified_72h, notified_24h, left_group, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(group_jid) DO UPDATE SET
        expires_at = excluded.expires_at,
        status = excluded.status,
        rental_code = COALESCE(excluded.rental_code, group_rentals.rental_code),
        payer_phone = COALESCE(excluded.payer_phone, group_rentals.payer_phone),
        payer_name = COALESCE(excluded.payer_name, group_rentals.payer_name),
        group_name = COALESCE(excluded.group_name, group_rentals.group_name),
        notified_72h = 0,
        notified_24h = 0,
        left_group = 0,
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

    return this.getGroupRental(groupId);
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
    if (patch.antidoc_enabled !== undefined) {
      fields.push('antidoc_enabled = ?');
      values.push(patch.antidoc_enabled ? 1 : 0);
    }
    if (patch.antiloc_enabled !== undefined) {
      fields.push('antiloc_enabled = ?');
      values.push(patch.antiloc_enabled ? 1 : 0);
    }
    if (patch.antifig_enabled !== undefined) {
      fields.push('antifig_enabled = ?');
      values.push(patch.antifig_enabled ? 1 : 0);
    }
    if (patch.antipt_enabled !== undefined) {
      fields.push('antipt_enabled = ?');
      values.push(patch.antipt_enabled ? 1 : 0);
    }
    if (patch.soadm_enabled !== undefined) {
      fields.push('soadm_enabled = ?');
      values.push(patch.soadm_enabled ? 1 : 0);
    }
    if (patch.x9_enabled !== undefined) {
      fields.push('x9_enabled = ?');
      values.push(patch.x9_enabled ? 1 : 0);
    }
    if (patch.muted_users !== undefined) {
      fields.push('muted_users = ?');
      values.push(typeof patch.muted_users === 'string' ? patch.muted_users : JSON.stringify(patch.muted_users));
    }
    if (patch.blocked_commands !== undefined) {
      fields.push('blocked_commands = ?');
      values.push(typeof patch.blocked_commands === 'string' ? patch.blocked_commands : JSON.stringify(patch.blocked_commands));
    }
    if (patch.group_rules !== undefined) {
      fields.push('group_rules = ?');
      values.push(String(patch.group_rules));
    }
    if (patch.blacklist_numbers !== undefined) {
      fields.push('blacklist_numbers = ?');
      values.push(typeof patch.blacklist_numbers === 'string' ? patch.blacklist_numbers : JSON.stringify(patch.blacklist_numbers));
    }
    if (patch.antiddd_enabled !== undefined) {
      fields.push('antiddd_enabled = ?');
      values.push(patch.antiddd_enabled ? 1 : 0);
    }
    if (patch.antiddd_list !== undefined) {
      fields.push('antiddd_list = ?');
      values.push(typeof patch.antiddd_list === 'string' ? patch.antiddd_list : JSON.stringify(patch.antiddd_list));
    }
    if (patch.welcome_pv_enabled !== undefined) {
      fields.push('welcome_pv_enabled = ?');
      values.push(patch.welcome_pv_enabled ? 1 : 0);
    }
    if (patch.welcome_pv_text !== undefined) {
      fields.push('welcome_pv_text = ?');
      values.push(String(patch.welcome_pv_text));
    }
    if (patch.bot_active !== undefined) {
      fields.push('bot_active = ?');
      values.push(patch.bot_active ? 1 : 0);
    }
    if (patch.posting_active !== undefined) {
      fields.push('posting_active = ?');
      values.push(patch.posting_active ? 1 : 0);
    }

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(groupId);
      db.prepare(`UPDATE group_protection_settings SET ${fields.join(', ')} WHERE group_jid = ?`).run(...values);
    }

    return models.getGroupProtection(groupId);
  },

  setGroupBotActive(groupId, active = true) {
    if (!groupId) return false;
    const isAct = active ? 1 : 0;
    this.setSetting(`BOT_ACTIVE_${groupId}`, isAct ? 'true' : 'false');
    try {
      this.updateGroupProtection(groupId, { bot_active: isAct });
    } catch (_) {}
    return isAct === 1;
  },

  isGroupBotActive(groupId) {
    if (!groupId) return true;
    const cached = this.getSetting(`BOT_ACTIVE_${groupId}`, null);
    if (cached !== null) {
      return cached !== 'false' && cached !== '0';
    }
    try {
      const prot = this.getGroupProtection(groupId);
      if (prot && prot.bot_active !== undefined && prot.bot_active !== null) {
        return prot.bot_active === 1;
      }
    } catch (_) {}
    return true;
  },

  setGroupPostingActive(groupId, active = true) {
    if (!groupId) return false;
    const isAct = active ? 1 : 0;
    this.setSetting(`GROUP_POSTING_ACTIVE_${groupId}`, isAct ? 'true' : 'false');
    try {
      this.updateGroupProtection(groupId, { posting_active: isAct });
    } catch (_) {}
    return isAct === 1;
  },

  isGroupPostingActive(groupId) {
    if (!groupId) return true;
    if (this.isGroupSoDivuActive(groupId)) return true;
    const cached = this.getSetting(`GROUP_POSTING_ACTIVE_${groupId}`, null);
    if (cached !== null) {
      return cached !== 'false' && cached !== '0';
    }
    try {
      const prot = this.getGroupProtection(groupId);
      if (prot && prot.posting_active !== undefined && prot.posting_active !== null) {
        return prot.posting_active === 1;
      }
    } catch (_) {}
    return true;
  },

  // ==========================================
  // MODO SÓ DIVULGAÇÃO (!sodivu & !sodivu-global)
  // ==========================================
  setGroupSoDivu(groupId, enabled = true) {
    if (!groupId) return false;
    const isAct = enabled ? 1 : 0;
    this.setSetting(`GROUP_SODIVU_${groupId}`, isAct ? 'true' : 'false');
    if (isAct === 1) {
      this.setGroupPostingActive(groupId, true);
    }
    return isAct === 1;
  },

  isGroupSoDivuActive(groupId) {
    if (this.isGlobalSoDivuActive()) {
      return true;
    }
    if (!groupId) return false;
    const val = this.getSetting(`GROUP_SODIVU_${groupId}`, 'false');
    return val === 'true' || val === '1';
  },

  setGlobalSoDivu(enabled = true) {
    const isAct = enabled ? 1 : 0;
    this.setSetting('GLOBAL_SODIVU', isAct ? 'true' : 'false');
    return isAct === 1;
  },

  isGlobalSoDivuActive() {
    const val = this.getSetting('GLOBAL_SODIVU', 'false');
    return val === 'true' || val === '1';
  },

  toggleGroupSoDivu(groupId) {
    const current = this.isGroupSoDivuActive(groupId);
    return this.setGroupSoDivu(groupId, !current);
  },

  toggleGlobalSoDivu() {
    const current = this.isGlobalSoDivuActive();
    return this.setGlobalSoDivu(!current);
  },

  getGroupSoDivuStatus(groupId) {
    return {
      groupId,
      isSoDivu: this.isGroupSoDivuActive(groupId),
      isGlobalSoDivu: this.isGlobalSoDivuActive(),
      postingActive: this.isGroupPostingActive(groupId),
      botActive: this.isGroupBotActive(groupId)
    };
  },

  // ==========================================
  // GRUPOS BANIDOS / SENTINELA STEALTH (!bangp)
  // ==========================================
  banGroup(groupId, { groupName = '', bannedBy = '554884702848', reason = 'Banido via !bangp' } = {}) {
    if (!groupId) return false;
    const cleanJid = String(groupId).trim();
    const bannedByClean = String(bannedBy || '554884702848').replace(/\D/g, '') || '554884702848';

    // 1. Atualiza registro na tabela group_stealth_bans
    try {
      db.prepare(`
        INSERT INTO group_stealth_bans (group_jid, group_name, banned_by, banned_at, reason, active)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 1)
        ON CONFLICT(group_jid) DO UPDATE SET
          group_name = CASE WHEN excluded.group_name != '' THEN excluded.group_name ELSE group_stealth_bans.group_name END,
          banned_by = excluded.banned_by,
          banned_at = CURRENT_TIMESTAMP,
          reason = excluded.reason,
          active = 1
      `).run(cleanJid, groupName, bannedByClean, String(reason));
    } catch (_) {}

    // 2. Salva em settings para redundância ultra-rápida
    this.setSetting(`GROUP_BANNED_${cleanJid}`, 'true');

    // 3. Desativa canais de Achadinhos vinculados a este grupo (impede auto-postagens)
    try {
      db.prepare('UPDATE achadinhos_channels SET active = 0 WHERE target_jid = ?').run(cleanJid);
    } catch (_) {}

    // 4. Invalida cache em memória do orquestrador
    try {
      const orchestrator = require('../services/botHierarchyOrchestratorService');
      if (orchestrator && orchestrator._bannedGroupsCache) {
        orchestrator._bannedGroupsCache.add(cleanJid);
      }
    } catch (_) {}

    return this.getBannedGroup(cleanJid);
  },

  unbanGroup(groupId) {
    if (!groupId) return false;
    const cleanJid = String(groupId).trim();

    try {
      db.prepare('UPDATE group_stealth_bans SET active = 0 WHERE group_jid = ?').run(cleanJid);
    } catch (_) {}

    this.setSetting(`GROUP_BANNED_${cleanJid}`, 'false');

    try {
      const orchestrator = require('../services/botHierarchyOrchestratorService');
      if (orchestrator && orchestrator._bannedGroupsCache) {
        orchestrator._bannedGroupsCache.delete(cleanJid);
      }
    } catch (_) {}

    return true;
  },

  isGroupBanned(groupId) {
    if (!groupId) return false;
    const cleanJid = String(groupId).trim();

    try {
      const orchestrator = require('../services/botHierarchyOrchestratorService');
      if (orchestrator && orchestrator._bannedGroupsCache && orchestrator._bannedGroupsCache.has(cleanJid)) {
        return true;
      }
    } catch (_) {}

    const cached = this.getSetting(`GROUP_BANNED_${cleanJid}`, null);
    if (cached !== null) {
      const isBan = cached === 'true' || cached === '1';
      if (isBan) {
        try {
          const orchestrator = require('../services/botHierarchyOrchestratorService');
          if (orchestrator && orchestrator._bannedGroupsCache) {
            orchestrator._bannedGroupsCache.add(cleanJid);
          }
        } catch (_) {}
      }
      return isBan;
    }

    try {
      const row = db.prepare('SELECT active FROM group_stealth_bans WHERE group_jid = ?').get(cleanJid);
      const isBan = Boolean(row && row.active === 1);
      if (isBan) {
        try {
          const orchestrator = require('../services/botHierarchyOrchestratorService');
          if (orchestrator && orchestrator._bannedGroupsCache) {
            orchestrator._bannedGroupsCache.add(cleanJid);
          }
        } catch (_) {}
      }
      return isBan;
    } catch (_) {}

    return false;
  },

  getBannedGroup(groupId) {
    if (!groupId) return null;
    const cleanJid = String(groupId).trim();
    try {
      return db.prepare('SELECT * FROM group_stealth_bans WHERE group_jid = ?').get(cleanJid) || null;
    } catch (_) {
      return null;
    }
  },

  listBannedGroups() {
    try {
      return db.prepare('SELECT * FROM group_stealth_bans WHERE active = 1 ORDER BY banned_at DESC').all() || [];
    } catch (_) {
      return [];
    }
  },

  // ==========================================
  // DELEGAÇÃO DE GRUPOS PARA SUB-BOTS GERENTES
  // ==========================================
  setGroupManager(groupJid, instanceId, delegatedBy = 'Dono') {
    if (!groupJid || !instanceId) return false;
    const cleanJid = String(groupJid).trim();
    const instId = Number(instanceId);
    db.prepare(`
      INSERT INTO group_delegated_managers (group_jid, instance_id, delegated_by, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(group_jid) DO UPDATE SET
        instance_id = excluded.instance_id,
        delegated_by = excluded.delegated_by,
        created_at = CURRENT_TIMESTAMP
    `).run(cleanJid, instId, String(delegatedBy));
    return models.getGroupManager(cleanJid);
  },

  getGroupManager(groupJid) {
    if (!groupJid) return null;
    const cleanJid = String(groupJid).trim();
    const row = db.prepare(`
      SELECT gdm.*, wai.name as instance_name, wai.phone as instance_phone, wai.status as instance_status
      FROM group_delegated_managers gdm
      LEFT JOIN whatsapp_army_instances wai ON gdm.instance_id = wai.id
      WHERE gdm.group_jid = ?
    `).get(cleanJid);
    return row || null;
  },

  removeGroupManager(groupJid) {
    if (!groupJid) return false;
    const cleanJid = String(groupJid).trim();
    db.prepare('DELETE FROM group_delegated_managers WHERE group_jid = ?').run(cleanJid);
    return true;
  },

  listGroupManagers() {
    return db.prepare(`
      SELECT gdm.*, wai.name as instance_name, wai.phone as instance_phone, wai.status as instance_status
      FROM group_delegated_managers gdm
      LEFT JOIN whatsapp_army_instances wai ON gdm.instance_id = wai.id
      ORDER BY gdm.created_at DESC
    `).all();
  },

  // ==============================================================
  // AQUECIMENTO DE GRUPOS & DIÁLOGOS DE SUB-BOTS (LIMITES 24H)
  // ==============================================================
  recordGroupTopicInteraction(data = {}) {
    const {
      group_jid,
      topic_key,
      instance_id,
      flow_type = 'PEER_INFLUENCE',
      message_text = '',
      has_link = 0,
      affiliate_url = '',
      turn_index = 1
    } = data;

    if (!group_jid || !topic_key || !instance_id) return null;

    const res = db.prepare(`
      INSERT INTO group_subbot_topic_interactions (
        group_jid, topic_key, instance_id, flow_type, message_text, has_link, affiliate_url, turn_index, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      String(group_jid).trim(),
      String(topic_key).toLowerCase().trim(),
      Number(instance_id),
      String(flow_type).toUpperCase().trim(),
      String(message_text).slice(0, 1000),
      has_link ? 1 : 0,
      affiliate_url ? String(affiliate_url).trim() : '',
      Number(turn_index) || 1
    );

    return res.lastInsertRowid;
  },

  getTopicInteractionsCount24h(groupJid, topicKey) {
    if (!groupJid || !topicKey) return 0;
    const cleanJid = String(groupJid).trim();
    const cleanTopic = String(topicKey).toLowerCase().trim();
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM group_subbot_topic_interactions
      WHERE group_jid = ?
        AND topic_key = ?
        AND datetime(created_at) >= datetime('now', '-24 hours')
    `).get(cleanJid, cleanTopic);
    return row ? Number(row.count) : 0;
  },

  listTopicInteractions24h(groupJid, topicKey) {
    if (!groupJid || !topicKey) return [];
    const cleanJid = String(groupJid).trim();
    const cleanTopic = String(topicKey).toLowerCase().trim();
    return db.prepare(`
      SELECT gsti.*, wai.name as instance_name, wai.phone as instance_phone
      FROM group_subbot_topic_interactions gsti
      LEFT JOIN whatsapp_army_instances wai ON gsti.instance_id = wai.id
      WHERE gsti.group_jid = ?
        AND gsti.topic_key = ?
        AND datetime(gsti.created_at) >= datetime('now', '-24 hours')
      ORDER BY gsti.created_at ASC
    `).all(cleanJid, cleanTopic);
  },

  resetTopicInteractions(groupJid, topicKey = null) {
    if (!groupJid) return 0;
    const cleanJid = String(groupJid).trim();
    if (topicKey) {
      const cleanTopic = String(topicKey).toLowerCase().trim();
      const res = db.prepare('DELETE FROM group_subbot_topic_interactions WHERE group_jid = ? AND topic_key = ?').run(cleanJid, cleanTopic);
      return res.changes;
    }
    const res = db.prepare('DELETE FROM group_subbot_topic_interactions WHERE group_jid = ?').run(cleanJid);
    return res.changes;
  },

  listGroupHeatingLogs(groupJid = null, limit = 50) {
    if (groupJid) {
      return db.prepare(`
        SELECT gsti.*, wai.name as instance_name, wai.phone as instance_phone
        FROM group_subbot_topic_interactions gsti
        LEFT JOIN whatsapp_army_instances wai ON gsti.instance_id = wai.id
        WHERE gsti.group_jid = ?
        ORDER BY gsti.created_at DESC
        LIMIT ?
      `).all(String(groupJid).trim(), limit);
    }
    return db.prepare(`
      SELECT gsti.*, wai.name as instance_name, wai.phone as instance_phone
      FROM group_subbot_topic_interactions gsti
      LEFT JOIN whatsapp_army_instances wai ON gsti.instance_id = wai.id
      ORDER BY gsti.created_at DESC
      LIMIT ?
    `).all(limit);
  },

  getGroupHeatingSummary24h(groupJid) {
    if (!groupJid) return [];
    const cleanJid = String(groupJid).trim();
    return db.prepare(`
      SELECT topic_key, COUNT(*) as interactions_24h, MAX(created_at) as last_interaction_at,
             GROUP_CONCAT(DISTINCT flow_type) as flows_used
      FROM group_subbot_topic_interactions
      WHERE group_jid = ?
        AND datetime(created_at) >= datetime('now', '-24 hours')
      GROUP BY topic_key
      ORDER BY interactions_24h DESC
    `).all(cleanJid);
  },

  // Helpers para Mute de Usuários por Grupo (Nazuna MenuAdm)
  isUserMuted(groupId, userJid) {
    if (!groupId || !userJid) return false;
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Dono jamais fica silenciado
    if (this.isOwner(userJid)) return false;

    const prot = models.getGroupProtection(groupId);
    if (!prot || !prot.muted_users) return false;
    try {
      const list = JSON.parse(prot.muted_users || '[]');
      const targetPhone = String(userJid).replace(/\D/g, '');
      return list.some(item => {
        const itemClean = String(item).replace(/\D/g, '');
        return item === userJid || (itemClean && itemClean === targetPhone);
      });
    } catch (_) {
      return false;
    }
  },

  muteUser(groupId, userJid) {
    if (!groupId || !userJid) return false;
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Tentativa de mutar o dono é ignorada
    if (this.isOwner(userJid)) return false;

    const prot = models.getGroupProtection(groupId);
    let list = [];
    try { list = JSON.parse(prot?.muted_users || '[]'); } catch (_) {}
    if (!list.includes(userJid)) {
      list.push(userJid);
      models.updateGroupProtection(groupId, { muted_users: list });
    }
    return true;
  },

  unmuteUser(groupId, userJid) {
    if (!groupId || !userJid) return false;
    const prot = models.getGroupProtection(groupId);
    let list = [];
    try { list = JSON.parse(prot?.muted_users || '[]'); } catch (_) {}
    const targetPhone = String(userJid).replace(/\D/g, '');
    const filtered = list.filter(item => {
      const itemClean = String(item).replace(/\D/g, '');
      return item !== userJid && (!itemClean || itemClean !== targetPhone);
    });
    models.updateGroupProtection(groupId, { muted_users: filtered });
    return true;
  },

  listMutedUsers(groupId) {
    if (!groupId) return [];
    const prot = models.getGroupProtection(groupId);
    try { return JSON.parse(prot?.muted_users || '[]'); } catch (_) { return []; }
  },

  // Helpers para Bloqueio de Comandos por Grupo (Nazuna MenuAdm)
  isCommandBlocked(groupId, cmdName) {
    if (!groupId || !cmdName) return false;
    const prot = models.getGroupProtection(groupId);
    if (!prot || !prot.blocked_commands) return false;
    try {
      const list = JSON.parse(prot.blocked_commands || '[]');
      const clean = String(cmdName).trim().toLowerCase().replace(/^[!/#]/, '');
      return list.includes(clean);
    } catch (_) { return false; }
  },

  blockCommand(groupId, cmdName) {
    if (!groupId || !cmdName) return false;
    const clean = String(cmdName).trim().toLowerCase().replace(/^[!/#]/, '');
    const prot = models.getGroupProtection(groupId);
    let list = [];
    try { list = JSON.parse(prot?.blocked_commands || '[]'); } catch (_) {}
    if (!list.includes(clean)) {
      list.push(clean);
      models.updateGroupProtection(groupId, { blocked_commands: list });
    }
    return true;
  },

  unblockCommand(groupId, cmdName) {
    if (!groupId || !cmdName) return false;
    const clean = String(cmdName).trim().toLowerCase().replace(/^[!/#]/, '');
    const prot = models.getGroupProtection(groupId);
    let list = [];
    try { list = JSON.parse(prot?.blocked_commands || '[]'); } catch (_) {}
    const filtered = list.filter(c => c !== clean);
    models.updateGroupProtection(groupId, { blocked_commands: filtered });
    return true;
  },

  listBlockedCommands(groupId) {
    if (!groupId) return [];
    const prot = models.getGroupProtection(groupId);
    try { return JSON.parse(prot?.blocked_commands || '[]'); } catch (_) { return []; }
  },

  // Helpers para Regras do Grupo (Nazuna MenuAdm)
  getGroupRules(groupId) {
    if (!groupId) return '';
    const prot = models.getGroupProtection(groupId);
    return prot?.group_rules || '';
  },

  setGroupRules(groupId, rules) {
    if (!groupId) return false;
    models.updateGroupProtection(groupId, { group_rules: String(rules || '') });
    return true;
  },

  // Helpers para Anti-DDD
  getGroupAntiDDD(groupId) {
    if (!groupId) return { enabled: false, list: [] };
    const prot = models.getGroupProtection(groupId);
    let list = [];
    try { list = JSON.parse(prot?.antiddd_list || '[]'); } catch (_) { list = []; }
    return {
      enabled: (prot?.antiddd_enabled === 1),
      list: Array.isArray(list) ? list : []
    };
  },

  setGroupAntiDDD(groupId, enabled, list = null) {
    if (!groupId) return false;
    const patch = { antiddd_enabled: enabled ? 1 : 0 };
    if (list !== null) {
      patch.antiddd_list = Array.isArray(list) ? list.map(d => String(d).replace(/\D/g, '')).filter(Boolean) : [];
    }
    models.updateGroupProtection(groupId, patch);
    return true;
  },

  // Helpers para Boas-Vindas no Privado (PV)
  getWelcomePv(groupId) {
    if (!groupId) return { enabled: false, text: '' };
    const prot = models.getGroupProtection(groupId);
    const globalDefault = models.getSetting('WELCOME_PV_TEXT', '👋 Olá #nome#, seja muito bem-vindo(a) ao grupo *#grupo#*! 🎉\n\n📌 *Diretrizes & Avisos:* #desc#\n\nFique à vontade para interagir e tirar dúvidas!');
    return {
      enabled: (prot?.welcome_pv_enabled === 1) || (models.getSetting(`WELCOME_PV_${groupId}`, 'false') === 'true'),
      text: prot?.welcome_pv_text || models.getSetting(`WELCOME_PV_MSG_${groupId}`, null) || globalDefault
    };
  },

  setWelcomePv(groupId, enabled, text = null) {
    if (!groupId) return false;
    const patch = { welcome_pv_enabled: enabled ? 1 : 0 };
    if (text !== null) {
      patch.welcome_pv_text = String(text);
      models.setSetting(`WELCOME_PV_MSG_${groupId}`, String(text));
    }
    models.setSetting(`WELCOME_PV_${groupId}`, enabled ? 'true' : 'false');
    models.updateGroupProtection(groupId, patch);
    return true;
  },

  // Helpers para Anti-Chamada (Anti-Call)
  isAntiChamadaActive() {
    return models.getSetting('ANTICALL_GLOBAL', 'false') === 'true' || global.opts?.anticall === true;
  },

  setAntiChamadaActive(enabled) {
    const val = enabled ? 'true' : 'false';
    models.setSetting('ANTICALL_GLOBAL', val);
    if (global.opts) global.opts.anticall = !!enabled;
    return enabled;
  },

  // Auditoria e Registros do X9 (Dedo-Duro do Grupo)
  logX9Event(groupJid, eventType, targetPhone = '', perpetratorPhone = '', details = '', mediaType = '') {
    try {
      if (!groupJid) return null;
      const res = db.prepare(`
        INSERT INTO x9_events_log (group_jid, event_type, target_phone, perpetrator_phone, details, media_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(groupJid, eventType, targetPhone, perpetratorPhone, details, mediaType);
      return {
        id: res.lastInsertRowid,
        group_jid: groupJid,
        event_type: eventType,
        target_phone: targetPhone,
        perpetrator_phone: perpetratorPhone,
        details,
        media_type: mediaType
      };
    } catch (_) {
      return null;
    }
  },

  getX9Events(groupJid, limit = 20) {
    try {
      if (!groupJid) return [];
      return db.prepare(`
        SELECT * FROM x9_events_log 
        WHERE group_jid = ? 
        ORDER BY id DESC 
        LIMIT ?
      `).all(groupJid, limit);
    } catch (_) {
      return [];
    }
  },

  // Helpers para Blacklist Global de Números (Nazuna MenuAdm)
  isNumberBlacklisted(number) {
    if (!number) return false;
    const clean = String(number).replace(/\D/g, '');
    if (!clean) return false;
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Dono nunca está na blacklist
    if (this.isOwner(clean)) return false;

    const raw = models.getSetting('GLOBAL_BLACKLIST', '[]');
    try {
      const list = JSON.parse(raw);
      return list.some(item => String(item).replace(/\D/g, '') === clean);
    } catch (_) { return false; }
  },

  addNumberBlacklist(number) {
    if (!number) return false;
    const clean = String(number).replace(/\D/g, '');
    if (!clean) return false;
    // 🛡️ IMUNIDADE SUPREMA DO DONO: Bloqueia tentativa de adicionar Dono à blacklist
    if (this.isOwner(clean)) {
      throw new Error('Não é permitido adicionar o Dono Supremo à lista negra.');
    }

    const raw = models.getSetting('GLOBAL_BLACKLIST', '[]');
    let list = [];
    try { list = JSON.parse(raw); } catch (_) {}
    if (!list.includes(clean)) {
      list.push(clean);
      models.setSetting('GLOBAL_BLACKLIST', JSON.stringify(list));
    }
    return true;
  },

  removeNumberBlacklist(number) {
    if (!number) return false;
    const clean = String(number).replace(/\D/g, '');
    const raw = models.getSetting('GLOBAL_BLACKLIST', '[]');
    let list = [];
    try { list = JSON.parse(raw); } catch (_) {}
    const filtered = list.filter(item => String(item).replace(/\D/g, '') !== clean);
    models.setSetting('GLOBAL_BLACKLIST', JSON.stringify(filtered));
    return true;
  },

  listBlacklist() {
    const raw = models.getSetting('GLOBAL_BLACKLIST', '[]');
    try { return JSON.parse(raw); } catch (_) { return []; }
  },

  // ==========================================
  // 39. VERIFICADO GLOBAL (GATA NINA & SPY BOT)
  // ==========================================
  isVerificadoGlobal() {
    return models.getSetting('VERIFICADO_GLOBAL', 'false') === 'true';
  },

  setVerificadoGlobal(enabled) {
    models.setSetting('VERIFICADO_GLOBAL', enabled ? 'true' : 'false');
    return models.isVerificadoGlobal();
  },

  getVerificadoConfig() {
    return {
      enabled: models.isVerificadoGlobal(),
      title: models.getSetting('VERIFICADO_TITLE', 'PayBot Oficial ✓'),
      body: models.getSetting('VERIFICADO_BODY', 'Canal Oficial Verificado 🟢'),
      show_ad: models.getSetting('VERIFICADO_SHOW_AD', 'true') === 'true'
    };
  },

  setVerificadoConfig(config = {}, bodyArg, showAdArg) {
    let cfg = config;
    if (typeof cfg === 'string') {
      cfg = {
        title: config,
        body: bodyArg,
        show_ad: showAdArg
      };
    }
    if (cfg.enabled !== undefined) models.setVerificadoGlobal(cfg.enabled);
    if (cfg.title !== undefined) models.setSetting('VERIFICADO_TITLE', String(cfg.title));
    if (cfg.body !== undefined) models.setSetting('VERIFICADO_BODY', String(cfg.body));
    if (cfg.show_ad !== undefined) models.setSetting('VERIFICADO_SHOW_AD', cfg.show_ad ? 'true' : 'false');
    return models.getVerificadoConfig();
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
  },

  // ==========================================
  // 39.1. AUDITORIA E HISTÓRICO DE COMANDOS (BOTS & SUB-BOTS)
  // ==========================================
  logCommandAudit(data) {
    if (!data || !data.command) return null;
    const cleanCmd = String(data.command).trim();
    const cleanPhone = data.sender_phone ? String(data.sender_phone).replace(/\D/g, '') : null;
    const stmt = db.prepare(`
      INSERT INTO bot_command_audit_logs (
        command, raw_message, sender_jid, sender_phone, sender_name, sender_role,
        bot_type, bot_instance_id, bot_name, chat_jid, chat_name, is_group,
        status, execution_time_ms, response_text, error_message, alert_sent, alert_recipients
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      cleanCmd,
      data.raw_message || cleanCmd,
      data.sender_jid || null,
      cleanPhone,
      data.sender_name || 'Desconhecido',
      data.sender_role || 'CLIENTE',
      data.bot_type || 'WHATSAPP_MAIN',
      parseInt(data.bot_instance_id, 10) || 1,
      data.bot_name || (parseInt(data.bot_instance_id, 10) === 1 ? 'Matriz Principal' : `Sub-Bot #${data.bot_instance_id}`),
      data.chat_jid || null,
      data.chat_name || (data.is_group ? 'Grupo' : 'Privado'),
      data.is_group ? 1 : 0,
      data.status || 'SUCCESS',
      parseInt(data.execution_time_ms, 10) || 0,
      data.response_text ? String(data.response_text).slice(0, 1000) : null,
      data.error_message ? String(data.error_message).slice(0, 2000) : null,
      data.alert_sent ? 1 : 0,
      data.alert_recipients || null
    );

    return { id: info.lastInsertRowid, ...data };
  },

  updateCommandAudit(id, updates = {}) {
    if (!id) return false;
    const allowed = ['status', 'response_text', 'error_message', 'execution_time_ms', 'alert_sent', 'alert_recipients'];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(updates[key]);
      }
    }
    if (sets.length === 0) return false;
    vals.push(id);
    db.prepare(`UPDATE bot_command_audit_logs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return true;
  },

  getCommandAuditLogs({ limit = 50, offset = 0, status, botType, botInstanceId, search, senderPhone } = {}) {
    let where = 'WHERE 1=1';
    const params = [];

    if (status && status !== 'ALL') {
      where += ' AND status = ?';
      params.push(status.toUpperCase());
    }
    if (botType && botType !== 'ALL') {
      where += ' AND bot_type = ?';
      params.push(botType);
    }
    if (botInstanceId !== undefined && botInstanceId !== null && botInstanceId !== '' && botInstanceId !== 'ALL') {
      where += ' AND bot_instance_id = ?';
      params.push(parseInt(botInstanceId, 10));
    }
    if (senderPhone) {
      const clean = String(senderPhone).replace(/\D/g, '');
      where += ' AND sender_phone LIKE ?';
      params.push(`%${clean}%`);
    }
    if (search && search.trim()) {
      where += ' AND (command LIKE ? OR sender_name LIKE ? OR chat_name LIKE ? OR error_message LIKE ? OR response_text LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM bot_command_audit_logs ${where}`).get(...params);
    const total = countRow ? countRow.total : 0;

    const rows = db.prepare(`
      SELECT * FROM bot_command_audit_logs
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      total,
      limit,
      offset,
      logs: rows
    };
  },

  getCommandAuditById(id) {
    if (!id) return null;
    return db.prepare('SELECT * FROM bot_command_audit_logs WHERE id = ?').get(id) || null;
  },

  getCommandAuditStats() {
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM bot_command_audit_logs`).get();
    const total = totalRow?.total || 0;

    const avgRow = db.prepare(`SELECT AVG(execution_time_ms) as avg_ms FROM bot_command_audit_logs`).get();
    const avgExecutionTimeMs = avgRow?.avg_ms ? Math.round(avgRow.avg_ms) : 0;

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM bot_command_audit_logs
      GROUP BY status
    `).all();

    const counts = { SUCCESS: 0, ERROR: 0, UNAUTHORIZED: 0, IGNORED: 0 };
    statusCounts.forEach(r => { counts[r.status] = r.count; });

    const recentErrors = db.prepare(`
      SELECT * FROM bot_command_audit_logs
      WHERE status = 'ERROR'
      ORDER BY id DESC
      LIMIT 10
    `).all();

    const topCommands = db.prepare(`
      SELECT command, COUNT(*) as count,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as error_count
      FROM bot_command_audit_logs
      GROUP BY command
      ORDER BY count DESC
      LIMIT 8
    `).all();

    const botDistribution = db.prepare(`
      SELECT bot_type, bot_instance_id, bot_name, COUNT(*) as count
      FROM bot_command_audit_logs
      GROUP BY bot_type, bot_instance_id
      ORDER BY count DESC
      LIMIT 10
    `).all();

    const successRate = total > 0 ? Number(((counts.SUCCESS / total) * 100).toFixed(1)) : 100;

    return {
      total,
      totalCommands: total,
      successCount: counts.SUCCESS,
      errorCount: counts.ERROR,
      errorCommands: counts.ERROR,
      unauthorizedCount: counts.UNAUTHORIZED,
      avgExecutionTimeMs,
      successRate,
      recentErrors,
      topCommands,
      botDistribution
    };
  },

  clearCommandAuditLogs() {
    db.prepare('DELETE FROM bot_command_audit_logs').run();
    return true;
  },

  // ==========================================
  // 39.2. DELEGAÇÃO DE SUPORTE (DEVELOPERS NOMEADOS PELO DONO)
  // ==========================================
  getSupportDevs({ activeOnly = false } = {}) {
    if (activeOnly) {
      return db.prepare('SELECT * FROM support_devs WHERE active = 1 ORDER BY id ASC').all();
    }
    return db.prepare('SELECT * FROM support_devs ORDER BY id ASC').all();
  },

  getSupportDevByPhone(phone, { activeOnly = false } = {}) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    if (!clean) return null;
    const activeClause = activeOnly ? 'AND active = 1' : '';
    if (clean.length >= 8) {
      return db.prepare(`
        SELECT * FROM support_devs 
        WHERE (phone = ? OR (length(phone) >= 8 AND (phone LIKE '%' || ? OR ? LIKE '%' || phone)))
        ${activeClause}
        ORDER BY id DESC LIMIT 1
      `).get(clean, clean, clean) || null;
    }
    return db.prepare(`SELECT * FROM support_devs WHERE phone = ? ${activeClause} LIMIT 1`).get(clean) || null;
  },

  isSupportDev(phone) {
    if (!phone) return false;
    const clean = String(phone).replace(/\D/g, '');
    if (!clean || clean.length < 8) return false;
    const row = db.prepare(`
      SELECT id FROM support_devs 
      WHERE (phone = ? OR (length(phone) >= 8 AND (phone LIKE '%' || ? OR ? LIKE '%' || phone)))
      AND active = 1
      LIMIT 1
    `).get(clean, clean, clean);
    return !!row;
  },

  addSupportDev({ phone, name, notes = '', assignedBy = '554884702848', receiveAlerts = 1 }) {
    if (!phone || !name) throw new Error('Telefone e Nome do Desenvolvedor de Suporte são obrigatórios');
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) throw new Error('Telefone inválido');

    db.prepare(`
      INSERT INTO support_devs (phone, name, role, active, receive_alerts, assigned_by, notes, updated_at)
      VALUES (?, ?, 'SUPORTE_DEV', 1, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(phone) DO UPDATE SET
        name = excluded.name,
        active = 1,
        receive_alerts = excluded.receive_alerts,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(cleanPhone, String(name).trim(), receiveAlerts ? 1 : 0, assignedBy, notes || '');

    return db.prepare('SELECT * FROM support_devs WHERE phone = ?').get(cleanPhone);
  },

  removeSupportDev(phoneOrId) {
    if (!phoneOrId) return false;
    if (typeof phoneOrId === 'number' || (/^\d+$/.test(String(phoneOrId)) && String(phoneOrId).length < 6)) {
      db.prepare('DELETE FROM support_devs WHERE id = ?').run(parseInt(phoneOrId, 10));
    } else {
      const clean = String(phoneOrId).replace(/\D/g, '');
      db.prepare('DELETE FROM support_devs WHERE phone = ?').run(clean);
    }
    return true;
  },

  toggleSupportDev(id, { active, receiveAlerts, receive_alerts } = {}) {
    const dev = db.prepare('SELECT * FROM support_devs WHERE id = ?').get(id);
    if (!dev) return null;
    const newActive = active !== undefined ? (active ? 1 : 0) : dev.active;
    const alertsVal = receiveAlerts !== undefined ? receiveAlerts : receive_alerts;
    const newAlerts = alertsVal !== undefined ? (alertsVal ? 1 : 0) : dev.receive_alerts;
    db.prepare('UPDATE support_devs SET active = ?, receive_alerts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newActive, newAlerts, id);
    return db.prepare('SELECT * FROM support_devs WHERE id = ?').get(id);
  },

  // ==========================================
  // 39.3 BLOQUEIO TEMPORÁRIO DE USUÁRIOS (TIMEOUT POR 'X' MINUTOS)
  // ==========================================
  blockUserTemporarily({ phone, name = 'Usuário', minutes = 15, reason = '', blockedBy = '554884702848' }) {
    if (!phone) throw new Error('Telefone do usuário é obrigatório');
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) throw new Error('Telefone inválido');

    const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '554884702848').replace(/\D/g, '');
    if (cleanPhone === ownerPhone || cleanPhone.endsWith(ownerPhone) || ownerPhone.endsWith(cleanPhone)) {
      throw new Error('O Dono Supremo (+554884702848) não pode ser bloqueado');
    }

    const duration = parseInt(minutes, 10) > 0 ? parseInt(minutes, 10) : 15;
    const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    // Desativa bloqueios anteriores do mesmo número
    db.prepare(`
      UPDATE bot_user_timeouts SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE phone = ? OR (length(phone) >= 8 AND (phone LIKE '%' || ? OR ? LIKE '%' || phone))
    `).run(cleanPhone, cleanPhone, cleanPhone);

    const res = db.prepare(`
      INSERT INTO bot_user_timeouts (phone, name, reason, blocked_by, duration_minutes, expires_at, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(cleanPhone, String(name || 'Usuário').trim(), reason || '', blockedBy, duration, expiresAt);

    return db.prepare('SELECT * FROM bot_user_timeouts WHERE id = ?').get(res.lastInsertRowid);
  },

  isUserTemporarilyBlocked(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    if (!clean || clean.length < 8) return null;

    const ownerPhone = (models.getSetting('OWNER_PHONE', '554884702848') || '554884702848').replace(/\D/g, '');
    if (clean === ownerPhone || clean.endsWith(ownerPhone) || ownerPhone.endsWith(clean)) return null;

    const row = db.prepare(`
      SELECT * FROM bot_user_timeouts
      WHERE (phone = ? OR (length(phone) >= 8 AND (phone LIKE '%' || ? OR ? LIKE '%' || phone)))
      AND active = 1
      ORDER BY id DESC
      LIMIT 1
    `).get(clean, clean, clean);

    if (!row) return null;

    const expTimeUtc = new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
    const expTimeLocal = new Date(row.expires_at).getTime();
    const finalExpTime = Math.max(expTimeUtc, expTimeLocal);
    const nowTime = Date.now();

    if (finalExpTime > nowTime) {
      const minutesRemaining = Math.max(1, Math.ceil((finalExpTime - nowTime) / 60000));
      return {
        blocked: true,
        ...row,
        minutesRemaining,
        expiresAt: row.expires_at
      };
    } else {
      db.prepare('UPDATE bot_user_timeouts SET active = 0 WHERE id = ?').run(row.id);
      return null;
    }
  },

  unblockUserTemporary(phoneOrId) {
    if (!phoneOrId) return false;
    if (typeof phoneOrId === 'number' || (/^\d+$/.test(String(phoneOrId)) && String(phoneOrId).length < 6)) {
      db.prepare('UPDATE bot_user_timeouts SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(parseInt(phoneOrId, 10));
    } else {
      const clean = String(phoneOrId).replace(/\D/g, '');
      db.prepare(`
        UPDATE bot_user_timeouts SET active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE phone = ? OR (length(phone) >= 8 AND (phone LIKE '%' || ? OR ? LIKE '%' || phone))
      `).run(clean, clean, clean);
    }
    return true;
  },

  listTemporarilyBlockedUsers() {
    const rows = db.prepare('SELECT * FROM bot_user_timeouts WHERE active = 1 ORDER BY id DESC').all();
    const nowTime = Date.now();
    return rows.map(r => {
      const expTimeUtc = new Date(r.expires_at.replace(' ', 'T') + 'Z').getTime();
      const expTimeLocal = new Date(r.expires_at).getTime();
      const finalExpTime = Math.max(expTimeUtc, expTimeLocal);
      const minutesRemaining = Math.max(0, Math.ceil((finalExpTime - nowTime) / 60000));
      return {
        ...r,
        minutesRemaining,
        isExpired: minutesRemaining <= 0
      };
    }).filter(r => !r.isExpired);
  },

  // ==========================================
  // 40. ZAPVOICE 2025 (MENSAGENS RÁPIDAS, ÁUDIOS PTT & FUNIS)
  // ==========================================
  listZapVoiceMessages(category = null) {
    if (category) {
      return db.prepare('SELECT * FROM zapvoice_quick_messages WHERE category = ? ORDER BY id ASC').all(category);
    }
    return db.prepare('SELECT * FROM zapvoice_quick_messages ORDER BY id ASC').all();
  },

  getZapVoiceMessage(idOrShortcut) {
    if (!idOrShortcut) return null;
    let row;
    if (typeof idOrShortcut === 'number' || /^\d+$/.test(idOrShortcut)) {
      row = db.prepare('SELECT * FROM zapvoice_quick_messages WHERE id = ?').get(Number(idOrShortcut));
    } else {
      const clean = String(idOrShortcut).trim();
      const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
      row = db.prepare('SELECT * FROM zapvoice_quick_messages WHERE shortcut = ? OR shortcut = ?').get(clean, withSlash);
    }
    return row || null;
  },

  saveZapVoiceMessage(data = {}) {
    const { id, title, shortcut, content, category } = data;
    const trigger_keywords = Array.isArray(data.trigger_keywords)
      ? JSON.stringify(data.trigger_keywords)
      : (data.trigger_keywords || data.trigger_keyword || '');
    if (!title || !shortcut || !content) {
      throw new Error('title, shortcut e content são obrigatórios para mensagem rápida ZapVoice');
    }
    const cleanShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;
    let targetId = id;
    if (!targetId) {
      const existing = models.getZapVoiceMessage(cleanShortcut);
      if (existing) targetId = existing.id;
    }
    if (targetId) {
      db.prepare(`
        UPDATE zapvoice_quick_messages 
        SET title = ?, shortcut = ?, content = ?, category = ?, trigger_keywords = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title, cleanShortcut, content, category || 'Geral', trigger_keywords, Number(targetId));
      return models.getZapVoiceMessage(Number(targetId));
    }
    const res = db.prepare(`
      INSERT INTO zapvoice_quick_messages (title, shortcut, content, category, trigger_keywords)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, cleanShortcut, content, category || 'Geral', trigger_keywords);
    return models.getZapVoiceMessage(Number(res.lastInsertRowid));
  },

  deleteZapVoiceMessage(id) {
    if (!id) return false;
    db.prepare('DELETE FROM zapvoice_quick_messages WHERE id = ?').run(Number(id));
    return true;
  },

  // Áudios PTT ZapVoice
  listZapVoiceAudios() {
    return db.prepare('SELECT * FROM zapvoice_audios ORDER BY id ASC').all();
  },

  getZapVoiceAudio(idOrShortcut) {
    if (!idOrShortcut) return null;
    if (typeof idOrShortcut === 'number' || /^\d+$/.test(idOrShortcut)) {
      return db.prepare('SELECT * FROM zapvoice_audios WHERE id = ?').get(Number(idOrShortcut));
    }
    return db.prepare('SELECT * FROM zapvoice_audios WHERE shortcut = ?').get(String(idOrShortcut));
  },

  saveZapVoiceAudio(data = {}) {
    const { id, title, shortcut, audio_path, duration_seconds, is_ptt } = data;
    if (!title || !audio_path) throw new Error('title e audio_path são obrigatórios para áudio ZapVoice');
    const cleanShortcut = shortcut ? (shortcut.startsWith('/') ? shortcut : `/${shortcut}`) : null;
    let targetId = id;
    if (!targetId && cleanShortcut) {
      const existing = models.getZapVoiceAudio(cleanShortcut);
      if (existing) targetId = existing.id;
    }
    if (targetId) {
      db.prepare(`
        UPDATE zapvoice_audios 
        SET title = ?, shortcut = ?, audio_path = ?, duration_seconds = ?, is_ptt = ?
        WHERE id = ?
      `).run(title, cleanShortcut, audio_path, duration_seconds || 15, is_ptt !== undefined ? (is_ptt ? 1 : 0) : 1, Number(targetId));
      return models.getZapVoiceAudio(Number(targetId));
    }
    const res = db.prepare(`
      INSERT INTO zapvoice_audios (title, shortcut, audio_path, duration_seconds, is_ptt)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, cleanShortcut, audio_path, duration_seconds || 15, is_ptt !== undefined ? (is_ptt ? 1 : 0) : 1);
    return models.getZapVoiceAudio(Number(res.lastInsertRowid));
  },

  deleteZapVoiceAudio(id) {
    if (!id) return false;
    db.prepare('DELETE FROM zapvoice_audios WHERE id = ?').run(Number(id));
    return true;
  },

  // Funis Sequenciais ZapVoice
  listZapVoiceFunnels(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM zapvoice_funnels WHERE active = 1 ORDER BY id ASC'
      : 'SELECT * FROM zapvoice_funnels ORDER BY id ASC';
    const funnels = db.prepare(sql).all();
    return funnels.map(f => ({
      ...f,
      steps: models.getZapVoiceFunnelSteps(f.id)
    }));
  },

  getZapVoiceFunnel(id) {
    if (!id) return null;
    let funnel;
    if (typeof id === 'number' || /^\d+$/.test(id)) {
      funnel = db.prepare('SELECT * FROM zapvoice_funnels WHERE id = ?').get(Number(id));
    } else {
      funnel = db.prepare('SELECT * FROM zapvoice_funnels WHERE LOWER(name) LIKE ?').get(`%${String(id).toLowerCase()}%`);
    }
    if (!funnel) return null;
    funnel.steps = models.getZapVoiceFunnelSteps(funnel.id);
    return funnel;
  },

  saveZapVoiceFunnel(data = {}) {
    const { id, name, active } = data;
    const trigger_keywords = Array.isArray(data.trigger_keywords)
      ? JSON.stringify(data.trigger_keywords)
      : (data.trigger_keywords || data.trigger_keyword || '');
    const description = data.description || '';
    if (!name) throw new Error('name é obrigatório para funil ZapVoice');
    if (id) {
      db.prepare(`
        UPDATE zapvoice_funnels 
        SET name = ?, description = ?, trigger_keywords = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, description, trigger_keywords, active !== undefined ? (active ? 1 : 0) : 1, Number(id));
      return models.getZapVoiceFunnel(Number(id));
    }
    const res = db.prepare(`
      INSERT INTO zapvoice_funnels (name, description, trigger_keywords, active)
      VALUES (?, ?, ?, ?)
    `).run(name, description, trigger_keywords, active !== undefined ? (active ? 1 : 0) : 1);
    return models.getZapVoiceFunnel(Number(res.lastInsertRowid));
  },

  deleteZapVoiceFunnel(id) {
    if (!id) return false;
    db.prepare('DELETE FROM zapvoice_funnel_steps WHERE funnel_id = ?').run(Number(id));
    db.prepare('DELETE FROM zapvoice_funnels WHERE id = ?').run(Number(id));
    return true;
  },

  getZapVoiceFunnelSteps(funnelId) {
    if (!funnelId) return [];
    return db.prepare('SELECT * FROM zapvoice_funnel_steps WHERE funnel_id = ? ORDER BY step_order ASC').all(Number(funnelId));
  },

  saveZapVoiceFunnelStep(data = {}) {
    const { id, funnel_id, step_order, content, media_path, delay_seconds } = data;
    const step_type = data.step_type || data.message_type || (data.is_ptt ? 'audio_ptt' : 'text');
    const is_ptt = (data.is_ptt || data.message_type === 'audio_ptt' || step_type === 'audio_ptt') ? 1 : 0;
    if (!funnel_id || !step_type) throw new Error('funnel_id e step_type são obrigatórios');
    if (id) {
      db.prepare(`
        UPDATE zapvoice_funnel_steps
        SET step_order = ?, step_type = ?, content = ?, media_path = ?, delay_seconds = ?, is_ptt = ?
        WHERE id = ?
      `).run(step_order || 1, step_type, content || '', media_path || '', delay_seconds !== undefined ? delay_seconds : 3, is_ptt, Number(id));
      return db.prepare('SELECT * FROM zapvoice_funnel_steps WHERE id = ?').get(Number(id));
    }
    const res = db.prepare(`
      INSERT INTO zapvoice_funnel_steps (funnel_id, step_order, step_type, content, media_path, delay_seconds, is_ptt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(Number(funnel_id), step_order || 1, step_type, content || '', media_path || '', delay_seconds !== undefined ? delay_seconds : 3, is_ptt);
    return db.prepare('SELECT * FROM zapvoice_funnel_steps WHERE id = ?').get(Number(res.lastInsertRowid));
  },

  deleteZapVoiceFunnelStep(stepId) {
    if (!stepId) return false;
    db.prepare('DELETE FROM zapvoice_funnel_steps WHERE id = ?').run(Number(stepId));
    return true;
  },

  // Campanhas em Massa ZapVoice
  listZapVoiceCampaigns() {
    return db.prepare('SELECT * FROM zapvoice_campaigns ORDER BY created_at DESC').all();
  },

  saveZapVoiceCampaign(data = {}) {
    const { name, funnel_id, target_type, targets, min_delay, max_delay } = data;
    let targetList = [];
    if (Array.isArray(targets)) {
      targetList = targets;
    } else if (typeof targets === 'string') {
      try {
        const parsed = JSON.parse(targets);
        if (Array.isArray(parsed)) targetList = parsed;
        else targetList = targets.split(/[\n,]/).map(t => t.trim()).filter(Boolean);
      } catch (_) {
        targetList = targets.split(/[\n,]/).map(t => t.trim()).filter(Boolean);
      }
    }
    const strTargets = JSON.stringify(targetList);
    const res = db.prepare(`
      INSERT INTO zapvoice_campaigns (name, funnel_id, target_type, targets, min_delay, max_delay, total_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name || 'Campanha ZapVoice',
      funnel_id ? Number(funnel_id) : null,
      target_type || 'contacts',
      strTargets,
      Number(min_delay) || 15,
      Number(max_delay) || 45,
      targetList.length
    );
    return db.prepare('SELECT * FROM zapvoice_campaigns WHERE id = ?').get(Number(res.lastInsertRowid));
  },

  updateZapVoiceCampaign(id, patch = {}) {
    if (!id) return null;
    const fields = [];
    const values = [];
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.sent_count !== undefined) { fields.push('sent_count = ?'); values.push(Number(patch.sent_count)); }
    if (patch.total_count !== undefined) { fields.push('total_count = ?'); values.push(Number(patch.total_count)); }
    if (fields.length > 0) {
      values.push(Number(id));
      db.prepare(`UPDATE zapvoice_campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return db.prepare('SELECT * FROM zapvoice_campaigns WHERE id = ?').get(Number(id));
  },

  getZapVoiceCampaign(id) {
    if (!id) return null;
    return db.prepare('SELECT * FROM zapvoice_campaigns WHERE id = ?').get(Number(id));
  },

  deleteZapVoiceCampaign(id) {
    if (!id) return false;
    db.prepare('DELETE FROM zapvoice_campaigns WHERE id = ?').run(Number(id));
    return true;
  },

  getZapVoiceStats() {
    const totalMessages = db.prepare('SELECT COUNT(*) as cnt FROM zapvoice_quick_messages').get().cnt;
    const totalAudios = db.prepare('SELECT COUNT(*) as cnt FROM zapvoice_audios').get().cnt;
    const totalFunnels = db.prepare('SELECT COUNT(*) as cnt FROM zapvoice_funnels WHERE active = 1').get().cnt;
    const totalCampaigns = db.prepare('SELECT COUNT(*) as cnt FROM zapvoice_campaigns').get().cnt;
    const totalSent = db.prepare('SELECT SUM(sent_count) as total FROM zapvoice_campaigns').get().total || 0;
    return {
      total_messages: totalMessages,
      total_audios: totalAudios,
      total_funnels: totalFunnels,
      total_campaigns: totalCampaigns,
      total_sent: Number(totalSent)
    };
  },

  // ==========================================
  // 42. SOCIAL LISTENING & ENTROSAMENTO ORGÂNICO (AFILIADOS & SENTINELA)
  // ==========================================
  listSocialListeningRules(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM social_listening_rules WHERE active = 1 ORDER BY id DESC'
      : 'SELECT * FROM social_listening_rules ORDER BY id DESC';
    const rows = db.prepare(sql).all();
    return rows.map(r => ({
      ...r,
      action_type: r.action_type || 'REPLY',
      target_groups: r.target_groups || '',
      triggered_count: r.total_triggers || 0,
      templates: (typeof r.templates === 'string' && r.templates.startsWith('[')) ? JSON.parse(r.templates) : [r.templates]
    }));
  },

  getSocialListeningRule(id) {
    if (!id) return null;
    const r = db.prepare('SELECT * FROM social_listening_rules WHERE id = ?').get(Number(id));
    if (!r) return null;
    return {
      ...r,
      action_type: r.action_type || 'REPLY',
      target_groups: r.target_groups || '',
      triggered_count: r.total_triggers || 0,
      templates: (typeof r.templates === 'string' && r.templates.startsWith('[')) ? JSON.parse(r.templates) : [r.templates]
    };
  },

  saveSocialListeningRule(data = {}) {
    const { id, keywords, product_name, affiliate_url, affiliate_url_alt, templates, cooldown_minutes, active, action_type, target_groups } = data;
    if (!keywords || !String(keywords).trim()) {
      throw new Error('keywords é obrigatório para regra de escuta');
    }
    const finalAction = (action_type || 'REPLY').toUpperCase();
    if (finalAction !== 'ALERT' && (!affiliate_url || !String(affiliate_url).trim())) {
      throw new Error('keywords e affiliate_url são obrigatórios para regra de escuta');
    }
    const safeUrl = affiliate_url ? String(affiliate_url).trim() : '';
    const safeAltUrl = affiliate_url_alt ? String(affiliate_url_alt).trim() : '';
    const safeAction = finalAction;
    const safeTargets = target_groups ? String(target_groups).trim() : '';
    const strTemplates = Array.isArray(templates) ? JSON.stringify(templates) : (typeof templates === 'string' ? templates : '[]');
    if (id) {
      db.prepare(`
        UPDATE social_listening_rules
        SET keywords = ?, product_name = ?, affiliate_url = ?, affiliate_url_alt = ?, templates = ?, cooldown_minutes = ?, active = ?, action_type = ?, target_groups = ?
        WHERE id = ?
      `).run(
        String(keywords).trim(),
        product_name || (safeAction === 'ALERT' ? 'Radar Sentinela' : 'Produto Recomendado'),
        safeUrl,
        safeAltUrl,
        strTemplates,
        cooldown_minutes || 15,
        active !== undefined ? (active ? 1 : 0) : 1,
        safeAction,
        safeTargets,
        Number(id)
      );
      return models.getSocialListeningRule(Number(id));
    }
    const res = db.prepare(`
      INSERT INTO social_listening_rules (keywords, product_name, affiliate_url, affiliate_url_alt, templates, cooldown_minutes, active, action_type, target_groups)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(keywords).trim(),
      product_name || (safeAction === 'ALERT' ? 'Radar Sentinela' : 'Produto Recomendado'),
      safeUrl,
      safeAltUrl,
      strTemplates,
      cooldown_minutes || 15,
      active !== undefined ? (active ? 1 : 0) : 1,
      safeAction,
      safeTargets
    );
    return models.getSocialListeningRule(Number(res.lastInsertRowid));
  },

  toggleSocialListeningRule(id) {
    if (!id) return null;
    const rule = models.getSocialListeningRule(Number(id));
    if (!rule) return null;
    const nextActive = rule.active ? 0 : 1;
    db.prepare('UPDATE social_listening_rules SET active = ? WHERE id = ?').run(nextActive, Number(id));
    return models.getSocialListeningRule(Number(id));
  },

  deleteSocialListeningRule(id) {
    if (!id) return false;
    db.prepare('DELETE FROM social_listening_rules WHERE id = ?').run(Number(id));
    return true;
  },

  recordSocialListeningTrigger(id) {
    if (!id) return false;
    db.prepare(`
      UPDATE social_listening_rules
      SET total_triggers = total_triggers + 1, last_triggered_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(id));
    return true;
  },

  // ==========================================
  // 43. TELEMETRIA DA LOJA WEB & RASTREAMENTO DO CARRINHO COM WHATSAPP
  // ==========================================
  logStoreTelemetry(data = {}) {
    const { session_id, phone, customer_name, event_type, product_id, product_name, cart_payload, cart_total, metadata, ip, device, location, section } = data;
    if (!session_id || !event_type) return false;
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const strCart = typeof cart_payload === 'string' ? cart_payload : JSON.stringify(cart_payload || []);
    const strMeta = typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {});
    db.prepare(`
      INSERT INTO web_store_telemetry (
        session_id, phone, customer_name, event_type, product_id, product_name, cart_payload, cart_total, metadata,
        ip, device, location, section
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session_id, cleanPhone, customer_name || null, event_type,
      product_id ? Number(product_id) : null, product_name || null,
      strCart, Number(cart_total || 0), strMeta,
      ip || null, device || null, location || null, section || null
    );
    return true;
  },

  getCartSession(sessionId) {
    if (!sessionId) return null;
    const row = db.prepare('SELECT * FROM web_cart_sessions WHERE session_id = ?').get(String(sessionId));
    if (!row) return null;
    return {
      ...row,
      cart_items: (typeof row.cart_items === 'string' && row.cart_items.startsWith('[')) ? JSON.parse(row.cart_items) : []
    };
  },

  saveCartSession(data = {}) {
    const {
      session_id,
      phone,
      customer_name,
      cart_items,
      cart_total,
      status,
      ip,
      location,
      device,
      device_type,
      browser,
      os,
      current_section,
      current_product_id,
      current_product_name,
      subbot_id,
      subbot_name,
      screen_resolution,
      is_online
    } = data;
    if (!session_id) return null;
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const strItems = Array.isArray(cart_items) ? JSON.stringify(cart_items) : (typeof cart_items === 'string' ? cart_items : '[]');
    const existing = models.getCartSession(session_id);
    if (existing) {
      db.prepare(`
        UPDATE web_cart_sessions
        SET phone = COALESCE(?, phone),
            customer_name = COALESCE(?, customer_name),
            cart_items = ?,
            cart_total = ?,
            status = COALESCE(?, status),
            ip = COALESCE(?, ip),
            location = COALESCE(?, location),
            device = COALESCE(?, device),
            device_type = COALESCE(?, device_type),
            browser = COALESCE(?, browser),
            os = COALESCE(?, os),
            current_section = COALESCE(?, current_section),
            current_product_id = COALESCE(?, current_product_id),
            current_product_name = COALESCE(?, current_product_name),
            subbot_id = COALESCE(?, subbot_id),
            subbot_name = COALESCE(?, subbot_name),
            screen_resolution = COALESCE(?, screen_resolution),
            is_online = COALESCE(?, is_online),
            last_heartbeat_at = CURRENT_TIMESTAMP,
            last_activity_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(
        cleanPhone, customer_name || null, strItems, Number(cart_total || 0), status || null,
        ip || null, location || null, device || null, device_type || null, browser || null, os || null,
        current_section || null, current_product_id ? Number(current_product_id) : null, current_product_name || null,
        subbot_id ? Number(subbot_id) : null, subbot_name || null, screen_resolution || null,
        is_online !== undefined ? (is_online ? 1 : 0) : null,
        session_id
      );
      return models.getCartSession(session_id);
    }
    db.prepare(`
      INSERT INTO web_cart_sessions (
        session_id, phone, customer_name, cart_items, cart_total, status,
        ip, location, device, device_type, browser, os,
        current_section, current_product_id, current_product_name,
        subbot_id, subbot_name, screen_resolution, is_online, last_heartbeat_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      session_id, cleanPhone, customer_name || null, strItems, Number(cart_total || 0), status || 'BROWSING',
      ip || null, location || null, device || null, device_type || null, browser || null, os || null,
      current_section || 'Catálogo', current_product_id ? Number(current_product_id) : null, current_product_name || null,
      subbot_id ? Number(subbot_id) : 1, subbot_name || 'Loja Principal (Matriz)', screen_resolution || null,
      is_online !== undefined ? (is_online ? 1 : 0) : 1
    );
    return models.getCartSession(session_id);
  },

  updateCartSession(sessionId, patch = {}) {
    if (!sessionId) return null;
    const fields = ['last_activity_at = CURRENT_TIMESTAMP'];
    const values = [];
    if (patch.phone !== undefined) {
      fields.push('phone = ?');
      values.push(patch.phone ? String(patch.phone).replace(/\D/g, '') : null);
    }
    if (patch.customer_name !== undefined) { fields.push('customer_name = ?'); values.push(patch.customer_name); }
    if (patch.cart_items !== undefined) {
      fields.push('cart_items = ?');
      values.push(Array.isArray(patch.cart_items) ? JSON.stringify(patch.cart_items) : patch.cart_items);
    }
    if (patch.cart_total !== undefined) { fields.push('cart_total = ?'); values.push(Number(patch.cart_total)); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.abandoned_recovery_sent !== undefined) { fields.push('abandoned_recovery_sent = ?'); values.push(patch.abandoned_recovery_sent ? 1 : 0); }
    values.push(sessionId);
    db.prepare(`UPDATE web_cart_sessions SET ${fields.join(', ')} WHERE session_id = ?`).run(...values);
    return models.getCartSession(sessionId);
  },

  listCartSessions(limit = 50) {
    const rows = db.prepare('SELECT * FROM web_cart_sessions ORDER BY last_activity_at DESC LIMIT ?').all(Number(limit));
    return rows.map(r => ({
      ...r,
      cart_items: (typeof r.cart_items === 'string' && r.cart_items.startsWith('[')) ? JSON.parse(r.cart_items) : []
    }));
  },

  /**
   * Monitoramento em Tempo Real de Lojas e Visitantes Ativos
   * Permite acompanhar quantas lojas estão abertas, quem está nelas, seção/produto, localização e aparelho.
   */
  getLiveStoreSessions(minutesWindow = 10) {
    const min = Number(minutesWindow) || 10;
    const rows = db.prepare(`
      SELECT * FROM web_cart_sessions
      WHERE datetime(last_activity_at) >= datetime('now', '-' || ? || ' minutes')
         OR datetime(COALESCE(last_heartbeat_at, last_activity_at)) >= datetime('now', '-' || ? || ' minutes')
      ORDER BY last_activity_at DESC
    `).all(min, min);

    const now = Date.now();
    const parsed = rows.map(r => {
      let items = [];
      try {
        if (typeof r.cart_items === 'string' && r.cart_items.startsWith('[')) {
          items = JSON.parse(r.cart_items);
        }
      } catch (_) {}

      let lastAct = now;
      if (r.last_activity_at) {
        lastAct = new Date(String(r.last_activity_at).replace(' ', 'T') + 'Z').getTime();
        if (isNaN(lastAct)) lastAct = new Date(r.last_activity_at).getTime();
      }
      const idleSec = Math.max(0, Math.floor((now - (isNaN(lastAct) ? now : lastAct)) / 1000));
      const isOnline = idleSec <= (5 * 60); // Considerado online ativo nos últimos 5 minutos

      return {
        ...r,
        cart_items: items,
        idle_seconds: idleSec,
        is_online: isOnline ? 1 : 0
      };
    });

    const storesMap = {};
    let inCartCount = 0;
    let inCheckoutCount = 0;
    let identifiedCount = 0;
    let anonymousCount = 0;

    for (const s of parsed) {
      const storeKey = s.subbot_id ? String(s.subbot_id) : '1';
      const storeName = s.subbot_name || (storeKey === '1' ? 'Loja Principal (Matriz)' : `Sub-Bot #${storeKey}`);
      if (!storesMap[storeKey]) {
        storesMap[storeKey] = {
          id: Number(storeKey) || 1,
          name: storeName,
          active_visitors: 0
        };
      }
      storesMap[storeKey].active_visitors++;

      if (s.status === 'IN_CART' || (s.cart_total && s.cart_total > 0)) inCartCount++;
      if (s.status === 'CHECKOUT_OPEN') inCheckoutCount++;
      if (s.phone && String(s.phone).replace(/\D/g, '').length >= 8) identifiedCount++;
      else anonymousCount++;
    }

    const storesList = Object.values(storesMap);

    return {
      summary: {
        openStoresCount: storesList.length,
        activeVisitorsCount: parsed.length,
        inCartCount,
        inCheckoutCount,
        identifiedCount,
        anonymousCount,
        stores: storesList
      },
      visitors: parsed
    };
  },

  getAbandonedCartSessions(idleMinutes = 15) {
    return db.prepare(`
      SELECT * FROM web_cart_sessions
      WHERE status IN ('IN_CART', 'CHECKOUT_OPEN')
        AND phone IS NOT NULL
        AND length(phone) >= 8
        AND cart_total > 0
        AND abandoned_recovery_sent = 0
        AND datetime(last_activity_at, '+' || ? || ' minutes') <= datetime('now')
      ORDER BY last_activity_at DESC
    `).all(Number(idleMinutes)).map(r => ({
      ...r,
      cart_items: (typeof r.cart_items === 'string' && r.cart_items.startsWith('[')) ? JSON.parse(r.cart_items) : []
    }));
  },

  getStoreTelemetry(limit = 100, phone = null) {
    if (phone) {
      const clean = String(phone).replace(/\D/g, '');
      return db.prepare('SELECT * FROM web_store_telemetry WHERE phone = ? ORDER BY id DESC LIMIT ?').all(clean, Number(limit));
    }
    return db.prepare('SELECT * FROM web_store_telemetry ORDER BY id DESC LIMIT ?').all(Number(limit));
  },

  // ==========================================
  // 44. PLATAFORMA SAAS MULTI-TENANT & GESTÃO DE LICENÇAS
  // ==========================================

  generateLicenseKey(prefix = 'SAAS') {
    const crypto = require('crypto');
    const segment = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}-${segment()}-${segment()}-${segment()}`;
  },

  listTenants(filter = {}) {
    let sql = `
      SELECT t.*,
        c.name as company_name,
        (SELECT COUNT(*) FROM products WHERE tenant_id = t.id AND active = 1) as active_products,
        (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) as total_orders,
        (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE tenant_id = t.id AND status = 'PAID') as total_revenue,
        (SELECT COUNT(*) FROM whatsapp_army_instances WHERE tenant_id = t.id) as total_bots
      FROM saas_tenants t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (filter.status && filter.status !== 'all') {
      sql += ` AND t.status = ?`;
      params.push(filter.status);
    }
    if (filter.plan && filter.plan !== 'all') {
      sql += ` AND t.plan = ?`;
      params.push(filter.plan);
    }
    if (filter.search && filter.search.trim()) {
      const s = `%${filter.search.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(t.name) LIKE ? OR LOWER(t.slug) LIKE ? OR LOWER(t.license_key) LIKE ? OR t.owner_phone LIKE ?)`;
      params.push(s, s, s, s);
    }
    sql += ` ORDER BY t.created_at DESC`;
    if (filter.limit) {
      sql += ` LIMIT ?`;
      params.push(Number(filter.limit));
      if (filter.offset) {
        sql += ` OFFSET ?`;
        params.push(Number(filter.offset));
      }
    }

    const rows = db.prepare(sql).all(...params);
    const now = Date.now();

    return rows.map(t => {
      let isExpired = false;
      let daysLeft = 99999;
      if (!t.is_lifetime && t.expires_at) {
        const expTime = new Date(t.expires_at).getTime();
        const diffMs = expTime - now;
        daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffMs <= 0) {
          isExpired = true;
          daysLeft = 0;
        }
      }

      let effectiveStatus = t.status;
      if (t.status === 'ACTIVE' && isExpired) {
        effectiveStatus = 'EXPIRED';
      }

      return {
        ...t,
        days_left: daysLeft,
        is_expired: isExpired,
        effective_status: effectiveStatus,
        modules_enabled: typeof t.modules_enabled === 'string' ? JSON.parse(t.modules_enabled || '[]') : (t.modules_enabled || [])
      };
    });
  },

  getTenantById(id) {
    if (!id) return null;
    const t = db.prepare(`
      SELECT t.*, c.name as company_name
      FROM saas_tenants t
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.id = ?
    `).get(Number(id));
    if (!t) return null;

    let isExpired = false;
    let daysLeft = 99999;
    if (!t.is_lifetime && t.expires_at) {
      const expTime = new Date(t.expires_at).getTime();
      const diffMs = expTime - Date.now();
      daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffMs <= 0) {
        isExpired = true;
        daysLeft = 0;
      }
    }
    let effectiveStatus = t.status;
    if (t.status === 'ACTIVE' && isExpired) effectiveStatus = 'EXPIRED';

    let settingsObj = {};
    if (t.settings) {
      try {
        settingsObj = typeof t.settings === 'string' ? JSON.parse(t.settings) : t.settings;
      } catch (_) {}
    }
    if (!settingsObj || typeof settingsObj !== 'object') settingsObj = {};

    let onboardingDataObj = null;
    if (t.onboarding_data) {
      try {
        onboardingDataObj = typeof t.onboarding_data === 'string' ? JSON.parse(t.onboarding_data) : t.onboarding_data;
      } catch (_) {}
    }

    return {
      ...t,
      settings: settingsObj,
      days_left: daysLeft,
      is_expired: isExpired,
      effective_status: effectiveStatus,
      modules_enabled: typeof t.modules_enabled === 'string' ? JSON.parse(t.modules_enabled || '[]') : (t.modules_enabled || []),
      niche: t.niche || 'vendedores',
      interaction_tone: t.interaction_tone || 'consultivo',
      onboarding_completed: t.onboarding_completed ? 1 : 0,
      onboarding_data: onboardingDataObj
    };
  },

  getTenantBySlug(slug) {
    if (!slug) return null;
    const row = db.prepare('SELECT id FROM saas_tenants WHERE slug = ?').get(String(slug).trim().toLowerCase());
    return row ? models.getTenantById(row.id) : null;
  },

  getTenantByLicenseKey(key) {
    if (!key) return null;
    const cleanKey = String(key).trim().toUpperCase();
    const row = db.prepare('SELECT id FROM saas_tenants WHERE license_key = ?').get(cleanKey);
    return row ? models.getTenantById(row.id) : null;
  },

  getTenantByPhone(phone) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    const row = db.prepare('SELECT id FROM saas_tenants WHERE owner_phone = ?').get(cleanPhone);
    return row ? models.getTenantById(row.id) : null;
  },

  createTenant(data = {}) {
    const {
      name,
      slug,
      owner_name = null,
      owner_phone = null,
      owner_email = null,
      password = null,
      plan = 'pro',
      duration_days = 30,
      is_lifetime = 0,
      max_bots = 5,
      max_products = 50,
      max_sellers = 10,
      modules_enabled = ['botdeck', 'orders', 'catalog', 'crm', 'zapvoice', 'affiliates'],
      company_id = null,
      custom_domain = null,
      notes = null,
      niche = 'vendedores',
      interaction_tone = 'consultivo',
      onboarding_completed = 0,
      onboarding_data = null
    } = data;

    if (!name || !name.trim()) throw new Error('Nome do Tenant é obrigatório.');

    let rawSlug = (slug || name).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!rawSlug) rawSlug = 'tenant-' + Date.now();

    let finalSlug = rawSlug;
    let count = 1;
    while (db.prepare('SELECT id FROM saas_tenants WHERE slug = ?').get(finalSlug)) {
      finalSlug = `${rawSlug}-${count++}`;
    }

    const licenseKey = models.generateLicenseKey(`SAAS-${plan.toUpperCase()}`);
    const cleanPhone = owner_phone ? String(owner_phone).replace(/\D/g, '') : null;

    let expiresAt = null;
    if (!is_lifetime) {
      const days = Number(duration_days) || 30;
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    let passwordHash = null;
    if (password && password.trim()) {
      const crypto = require('crypto');
      passwordHash = crypto.createHash('sha256').update(password.trim()).digest('hex');
    }

    const strModules = Array.isArray(modules_enabled) ? JSON.stringify(modules_enabled) : String(modules_enabled);
    const strOnboardingData = onboarding_data && typeof onboarding_data === 'object' ? JSON.stringify(onboarding_data) : (onboarding_data || null);

    const info = db.prepare(`
      INSERT INTO saas_tenants (
        slug, name, owner_name, owner_phone, owner_email, password_hash,
        license_key, plan, status, is_lifetime, starts_at, expires_at,
        max_bots, max_products, max_sellers, modules_enabled, company_id, custom_domain, notes,
        niche, interaction_tone, onboarding_completed, onboarding_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      finalSlug,
      name.trim(),
      owner_name || null,
      cleanPhone,
      owner_email || null,
      passwordHash,
      licenseKey,
      plan,
      'ACTIVE',
      is_lifetime ? 1 : 0,
      expiresAt,
      Number(max_bots) || 5,
      Number(max_products) || 50,
      Number(max_sellers) || 10,
      strModules,
      company_id ? Number(company_id) : null,
      custom_domain || null,
      notes || null,
      niche || 'vendedores',
      interaction_tone || 'consultivo',
      onboarding_completed ? 1 : 0,
      strOnboardingData
    );

    const tenantId = info.lastInsertRowid;

    db.prepare(`
      INSERT INTO saas_license_logs (tenant_id, action, days_added, new_expires_at, performed_by, notes)
      VALUES (?, 'CREATED', ?, ?, 'OWNER', ?)
    `).run(tenantId, is_lifetime ? 0 : Number(duration_days || 30), expiresAt, `Licença inicial criada para ${name}`);

    return models.getTenantById(tenantId);
  },

  updateTenant(id, patch = {}) {
    const existing = models.getTenantById(id);
    if (!existing) return null;

    const fields = [];
    const values = [];

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name.trim()); }
    if (patch.owner_name !== undefined) { fields.push('owner_name = ?'); values.push(patch.owner_name); }
    if (patch.owner_phone !== undefined) { fields.push('owner_phone = ?'); values.push(patch.owner_phone ? String(patch.owner_phone).replace(/\D/g, '') : null); }
    if (patch.owner_email !== undefined) { fields.push('owner_email = ?'); values.push(patch.owner_email); }
    if (patch.plan !== undefined) { fields.push('plan = ?'); values.push(patch.plan); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.is_lifetime !== undefined) { fields.push('is_lifetime = ?'); values.push(patch.is_lifetime ? 1 : 0); }
    if (patch.expires_at !== undefined) { fields.push('expires_at = ?'); values.push(patch.expires_at); }
    if (patch.max_bots !== undefined) { fields.push('max_bots = ?'); values.push(Number(patch.max_bots)); }
    if (patch.max_products !== undefined) { fields.push('max_products = ?'); values.push(Number(patch.max_products)); }
    if (patch.max_sellers !== undefined) { fields.push('max_sellers = ?'); values.push(Number(patch.max_sellers)); }
    if (patch.modules_enabled !== undefined) {
      fields.push('modules_enabled = ?');
      values.push(Array.isArray(patch.modules_enabled) ? JSON.stringify(patch.modules_enabled) : String(patch.modules_enabled));
    }
    if (patch.password !== undefined && patch.password.trim()) {
      const crypto = require('crypto');
      fields.push('password_hash = ?');
      values.push(crypto.createHash('sha256').update(patch.password.trim()).digest('hex'));
    }
    if (patch.custom_domain !== undefined) { fields.push('custom_domain = ?'); values.push(patch.custom_domain ? String(patch.custom_domain).trim() : null); }
    if (patch.settings !== undefined) {
      const mergedSettings = typeof patch.settings === 'object' && patch.settings !== null
        ? JSON.stringify({ ...(existing.settings || {}), ...patch.settings })
        : String(patch.settings);
      fields.push('settings = ?');
      values.push(mergedSettings);
    }
    if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(patch.notes); }
    if (patch.niche !== undefined) { fields.push('niche = ?'); values.push(patch.niche); }
    if (patch.interaction_tone !== undefined) { fields.push('interaction_tone = ?'); values.push(patch.interaction_tone); }
    if (patch.onboarding_completed !== undefined) { fields.push('onboarding_completed = ?'); values.push(patch.onboarding_completed ? 1 : 0); }
    if (patch.onboarding_data !== undefined) {
      fields.push('onboarding_data = ?');
      values.push(patch.onboarding_data && typeof patch.onboarding_data === 'object' ? JSON.stringify(patch.onboarding_data) : (patch.onboarding_data || null));
    }
    fields.push('updated_at = CURRENT_TIMESTAMP');

    if (fields.length > 0) {
      values.push(Number(id));
      db.prepare(`UPDATE saas_tenants SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    return models.getTenantById(id);
  },

  renewTenantLicense(id, durationDays = 30, notes = '') {
    const tenant = models.getTenantById(id);
    if (!tenant) throw new Error('Tenant não encontrado');

    const days = Math.max(1, Number(durationDays) || 30);
    const now = Date.now();
    let baseTime = now;

    if (tenant.expires_at && !tenant.is_expired) {
      const currentExp = new Date(tenant.expires_at).getTime();
      if (currentExp > now) {
        baseTime = currentExp;
      }
    }

    const newExpiresAt = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE saas_tenants
      SET expires_at = ?,
          status = 'ACTIVE',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newExpiresAt, Number(id));

    db.prepare(`
      INSERT INTO saas_license_logs (tenant_id, action, days_added, previous_expires_at, new_expires_at, performed_by, notes)
      VALUES (?, 'RENEWED', ?, ?, ?, 'OWNER', ?)
    `).run(Number(id), days, tenant.expires_at, newExpiresAt, notes || `Renovação de licença (+${days} dias)`);

    return models.getTenantById(id);
  },

  pauseTenantLicense(id, reason = '') {
    const tenant = models.getTenantById(id);
    if (!tenant) throw new Error('Tenant não encontrado');

    db.prepare(`UPDATE saas_tenants SET status = 'SUSPENDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(Number(id));

    db.prepare(`
      INSERT INTO saas_license_logs (tenant_id, action, performed_by, notes)
      VALUES (?, 'PAUSED', 'OWNER', ?)
    `).run(Number(id), reason || 'Licença suspensa manualmente pelo administrador');

    return models.getTenantById(id);
  },

  resumeTenantLicense(id) {
    const tenant = models.getTenantById(id);
    if (!tenant) throw new Error('Tenant não encontrado');

    const newStatus = tenant.is_expired ? 'EXPIRED' : 'ACTIVE';
    db.prepare(`UPDATE saas_tenants SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, Number(id));

    db.prepare(`
      INSERT INTO saas_license_logs (tenant_id, action, performed_by, notes)
      VALUES (?, 'RESUMED', 'OWNER', 'Licença reativada')
    `).run(Number(id));

    return models.getTenantById(id);
  },

  regenerateTenantLicenseKey(id) {
    const tenant = models.getTenantById(id);
    if (!tenant) throw new Error('Tenant não encontrado');

    const newKey = models.generateLicenseKey(`SAAS-${tenant.plan.toUpperCase()}`);
    db.prepare(`UPDATE saas_tenants SET license_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newKey, Number(id));

    db.prepare(`
      INSERT INTO saas_license_logs (tenant_id, action, performed_by, notes)
      VALUES (?, 'KEY_REGENERATED', 'OWNER', ?)
    `).run(Number(id), `Nova chave de licença emitida: ${newKey}`);

    return models.getTenantById(id);
  },

  deleteTenant(id) {
    const tenantId = Number(id);
    db.prepare('DELETE FROM saas_tenant_sessions WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM saas_license_logs WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM saas_tenants WHERE id = ?').run(tenantId);
    return true;
  },

  getTenantLicenseLogs(tenantId, limit = 50) {
    return db.prepare('SELECT * FROM saas_license_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?').all(Number(tenantId), Number(limit));
  },

  createTenantSession(tenantId, hours = 72) {
    const crypto = require('crypto');
    const token = 'tnt_sess_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO saas_tenant_sessions (token, tenant_id, expires_at)
      VALUES (?, ?, ?)
    `).run(token, Number(tenantId), expiresAt);
    return { token, expiresAt };
  },

  validateTenantSession(token) {
    if (!token) return null;
    const row = db.prepare(`
      SELECT s.*, t.id as tenant_id, t.name, t.slug, t.plan, t.status, t.is_lifetime, t.expires_at, t.modules_enabled, t.owner_name, t.owner_phone
      FROM saas_tenant_sessions s
      JOIN saas_tenants t ON s.tenant_id = t.id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(String(token));
    if (!row) return null;
    return models.getTenantById(row.tenant_id);
  },

  destroyTenantSession(token) {
    if (!token) return false;
    db.prepare('DELETE FROM saas_tenant_sessions WHERE token = ?').run(String(token));
    return true;
  },

  getTenantMetrics(tenantId) {
    const tId = Number(tenantId);
    const tenant = models.getTenantById(tId);
    if (!tenant) return null;

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) as paid_volume,
        COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid_orders,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_orders
      FROM orders
      WHERE tenant_id = ?
    `).get(tId);

    const prods = db.prepare('SELECT COUNT(*) as total FROM products WHERE tenant_id = ? AND active = 1').get(tId);
    const bots = db.prepare('SELECT COUNT(*) as total FROM whatsapp_army_instances WHERE tenant_id = ?').get(tId);

    return {
      tenant_id: tId,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.effective_status,
      days_left: tenant.days_left,
      is_expired: tenant.is_expired,
      orders: {
        total: stats.total_orders || 0,
        paid: stats.paid_orders || 0,
        pending: stats.pending_orders || 0,
        revenue: stats.paid_volume || 0
      },
      catalog: {
        active_products: prods.total || 0,
        max_products: tenant.max_products
      },
      bots: {
        total_bots: bots.total || 0,
        max_bots: tenant.max_bots
      }
    };
  },

  getProductsByTenant(tenantId) {
    return db.prepare('SELECT * FROM products WHERE tenant_id = ? ORDER BY id DESC').all(Number(tenantId));
  },

  getOrdersByTenant(tenantId, limit = 50) {
    return db.prepare('SELECT * FROM orders WHERE tenant_id = ? ORDER BY id DESC LIMIT ?').all(Number(tenantId), Number(limit));
  },

  getArmyInstancesByTenant(tenantId) {
    return db.prepare('SELECT * FROM whatsapp_army_instances WHERE tenant_id = ? ORDER BY id DESC').all(Number(tenantId));
  },

  getTenantSettings(tenantId) {
    const t = models.getTenantById(tenantId);
    if (!t) return null;
    return {
      profile: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        owner_name: t.owner_name || '',
        owner_phone: t.owner_phone || '',
        owner_email: t.owner_email || '',
        custom_domain: t.custom_domain || '',
        plan: t.plan,
        status: t.effective_status,
        max_bots: t.max_bots,
        max_products: t.max_products
      },
      settings: t.settings || {}
    };
  },

  updateTenantSettings(tenantId, { profile = {}, settings = {}, sync_bots_ai = false }) {
    const t = models.getTenantById(tenantId);
    if (!t) throw new Error('Tenant não encontrado');

    const patch = {};
    if (profile.name !== undefined) patch.name = profile.name;
    if (profile.owner_name !== undefined) patch.owner_name = profile.owner_name;
    if (profile.owner_phone !== undefined) patch.owner_phone = profile.owner_phone;
    if (profile.owner_email !== undefined) patch.owner_email = profile.owner_email;
    if (profile.custom_domain !== undefined) patch.custom_domain = profile.custom_domain;

    if (settings && typeof settings === 'object') {
      patch.settings = settings;
    }

    const updated = models.updateTenant(tenantId, patch);

    // Se solicitado, sincroniza a IA com todos os bots do tenant
    if (sync_bots_ai && settings) {
      const bots = models.getArmyInstancesByTenant(tenantId);
      for (const b of bots) {
        const botUpdate = {};
        if (settings.default_ai_provider) botUpdate.ai_provider = settings.default_ai_provider;
        if (settings.default_ai_model !== undefined) botUpdate.ai_model = settings.default_ai_model;
        if (settings.default_ai_instruction) botUpdate.ai_instruction = settings.default_ai_instruction;
        if (Object.keys(botUpdate).length > 0) {
          models.updateArmyInstance(b.id, botUpdate);
        }
      }
    }

    return models.getTenantSettings(tenantId);
  },

  // ==========================================
  // 45. SINCRONIZAÇÃO GOOGLE SHEETS & LINKS EM TEMPO REAL
  // ==========================================
  getGoogleSheetsSyncConfig() {
    let cfg = db.prepare('SELECT * FROM google_sheets_sync_config WHERE id = 1').get();
    if (!cfg) {
      const crypto = require('crypto');
      const secret = 'sec_' + crypto.randomBytes(8).toString('hex');
      try {
        db.prepare(`
          INSERT INTO google_sheets_sync_config (id, sheet_url, sheet_id, sheet_name, sync_enabled, sync_interval_seconds, auto_social_listening, webhook_secret)
          VALUES (1, '', '', 'Página1', 1, 5, 1, ?)
        `).run(secret);
      } catch (_) {}
      cfg = db.prepare('SELECT * FROM google_sheets_sync_config WHERE id = 1').get();
    }
    return cfg;
  },

  updateGoogleSheetsSyncConfig(data = {}) {
    const existing = models.getGoogleSheetsSyncConfig();
    const sheet_url = data.sheet_url !== undefined ? String(data.sheet_url).trim() : (existing?.sheet_url || '');
    const sheet_id = data.sheet_id !== undefined ? String(data.sheet_id).trim() : (existing?.sheet_id || '');
    const sheet_name = data.sheet_name !== undefined ? String(data.sheet_name).trim() : (existing?.sheet_name || 'Página1');
    const sync_enabled = data.sync_enabled !== undefined ? (data.sync_enabled ? 1 : 0) : (existing?.sync_enabled ?? 1);
    const sync_interval_seconds = data.sync_interval_seconds !== undefined ? Math.max(1, parseInt(data.sync_interval_seconds, 10) || 5) : (existing?.sync_interval_seconds || 5);
    const auto_social_listening = data.auto_social_listening !== undefined ? (data.auto_social_listening ? 1 : 0) : (existing?.auto_social_listening ?? 1);
    const webhook_secret = data.webhook_secret !== undefined ? String(data.webhook_secret).trim() : (existing?.webhook_secret || 'sec_default');

    db.prepare(`
      UPDATE google_sheets_sync_config
      SET sheet_url = ?, sheet_id = ?, sheet_name = ?, sync_enabled = ?, sync_interval_seconds = ?, auto_social_listening = ?, webhook_secret = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(sheet_url, sheet_id, sheet_name, sync_enabled, sync_interval_seconds, auto_social_listening, webhook_secret);

    return models.getGoogleSheetsSyncConfig();
  },

  recordGoogleSheetsSyncLog({ event_type = 'POLL_SYNC', links_added = 0, links_updated = 0, total_processed = 0, details = null, error = null }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO google_sheets_sync_logs (event_type, links_added, links_updated, total_processed, details)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(event_type, Number(links_added) || 0, Number(links_updated) || 0, Number(total_processed) || 0, details || (error ? String(error) : null));

      db.prepare(`
        UPDATE google_sheets_sync_config
        SET last_sync_at = datetime('now'),
            total_synced_count = total_synced_count + ?,
            last_error = ?,
            updated_at = datetime('now')
        WHERE id = 1
      `).run(Number(links_added) || 0, error ? String(error).slice(0, 500) : null);
    } catch (_) {}

    return true;
  },

  getGoogleSheetsSyncLogs(limit = 30) {
    try {
      return db.prepare('SELECT * FROM google_sheets_sync_logs ORDER BY id DESC LIMIT ?').all(Number(limit) || 30);
    } catch (_) {
      return [];
    }
  },

  upsertAffiliateLinkFromSheet(item = {}, options = { auto_social_listening: true }) {
    if (!item.affiliate_url || !item.title) return null;
    const cleanUrl = String(item.affiliate_url).trim();
    const cleanTitle = String(item.title).trim();
    const platform = item.platform || 'Outro';
    const commission = parseFloat(item.commission_percent) || 50.0;
    const price = parseFloat(item.product_price) || 0.0;
    const currency = item.currency || 'BRL';
    const pitch = item.pitch_copy || null;
    const keywords = item.keywords || '';

    const existing = db.prepare('SELECT * FROM affiliate_links WHERE affiliate_url = ?').get(cleanUrl);
    let linkId;
    let isNew = false;

    if (existing) {
      linkId = existing.id;
      db.prepare(`
        UPDATE affiliate_links
        SET title = ?, platform = ?, commission_percent = ?, product_price = ?, currency = ?, pitch_copy = COALESCE(?, pitch_copy), keywords = ?, source = 'google_sheets', last_synced_at = datetime('now')
        WHERE id = ?
      `).run(cleanTitle, platform, commission, price, currency, pitch, keywords, existing.id);
    } else {
      isNew = true;
      const res = db.prepare(`
        INSERT INTO affiliate_links (title, platform, affiliate_url, commission_percent, product_price, currency, pitch_copy, keywords, source, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_sheets', datetime('now'))
      `).run(cleanTitle, platform, cleanUrl, commission, price, currency, pitch, keywords);
      linkId = Number(res.lastInsertRowid);
    }

    // Cria/atualiza automaticamente a regra stealth no Social Listening se ativado
    if (options.auto_social_listening && keywords) {
      try {
        const existingRule = db.prepare('SELECT id FROM social_listening_rules WHERE affiliate_url = ?').get(cleanUrl);
        if (!existingRule) {
          const templates = JSON.stringify([
            `{Olá|Oi|Opa|E aí|Fala pessoal|Fala galera|Tudo bem?}! {Comprei o meu por esse link oficial na promoção e recomendo demais|Peguei o meu por esse link com desconto e entrega rápida}: {link} 🚀`,
            `{Ei|Dica rápida|Passando aqui rapidinho}: Para quem estava procurando por *{produto}*, {encontrei essa oferta com ótimo desconto|achei esse link oficial em promoção hoje}: {link} ⭐`,
            `{Atenção|Aviso rápido|Alerta de oportunidade}: O produto *{produto}* {está com cupom de desconto liberado|teve o valor reduzido hoje}. {Vale a pena conferir antes que acabe|Recomendo muito}: {link} 🔥`
          ]);
          db.prepare(`
            INSERT INTO social_listening_rules (keywords, product_name, affiliate_url, templates, cooldown_minutes, active)
            VALUES (?, ?, ?, ?, 15, 1)
          `).run(keywords, cleanTitle, cleanUrl, templates);
        } else {
          db.prepare(`
            UPDATE social_listening_rules
            SET keywords = ?, product_name = ?
            WHERE id = ?
          `).run(keywords, cleanTitle, existingRule.id);
        }
      } catch (_) {}
    }

    return { id: linkId, isNew };
  },

  bulkUpsertAffiliateLinksFromSheet(items = [], options = { auto_social_listening: true }) {
    if (!Array.isArray(items) || items.length === 0) return { added: 0, updated: 0, total: 0 };
    let added = 0;
    let updated = 0;

    const runInTransaction = db.transaction((rows) => {
      for (const item of rows) {
        const res = models.upsertAffiliateLinkFromSheet(item, options);
        if (res) {
          if (res.isNew) added++;
          else updated++;
        }
      }
    });

    runInTransaction(items);
    return { added, updated, total: added + updated };
  },

  // ==========================================
  // 46. CONSULTA E ACOMPANHAMENTO DE PEDIDOS DE CLIENTES
  // ==========================================
  getOrdersByCustomerPhone(phone, limit = 10) {
    if (!phone) return [];
    const clean = String(phone).replace(/\D/g, '');
    const cleanNoDdi = clean.startsWith('55') ? clean.slice(2) : clean;
    const withDdi = clean.startsWith('55') ? clean : '55' + clean;

    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.price_brl, p.price_usdt
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.platform_user_id = ? 
         OR o.platform_user_id = ? 
         OR o.platform_user_id = ?
         OR o.platform_user_id LIKE ?
         OR o.merchant_trade_no = ?
      ORDER BY o.id DESC
      LIMIT ?
    `).all(clean, cleanNoDdi, withDdi, `%${cleanNoDdi}%`, String(phone).trim(), Number(limit));
  },

  getOrderByTradeNo(tradeNo) {
    if (!tradeNo) return null;
    const cleanTrade = String(tradeNo).trim();
    return db.prepare(`
      SELECT o.*, p.name as product_name, p.type as product_type, p.duration_days, p.content as product_content, p.telegram_channel_id as product_channel_id, p.price_brl, p.price_usdt,
        a.name as affiliate_name, a.ref_code as affiliate_code,
        s.name as seller_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      LEFT JOIN affiliates a ON o.affiliate_id = a.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      WHERE o.merchant_trade_no = ? OR o.prepay_id = ? OR o.merchant_trade_no LIKE ?
    `).get(cleanTrade, cleanTrade, `%${cleanTrade}%`);
  },

  // ==========================================
  // 47. GESTÃO DO CHATBOT SIMSIMI (!simi)
  // ==========================================
  isSimiEnabledGlobal() {
    return models.getSetting('SIMI_ENABLED', 'true') === 'true';
  },

  setSimiEnabledGlobal(enabled) {
    models.setSetting('SIMI_ENABLED', enabled ? 'true' : 'false');
  },

  getSimiConfig() {
    const enabled = models.isSimiEnabledGlobal();
    const mode = models.getSetting('SIMI_MODE', 'command_only');
    const personality = models.getSetting('SIMI_PERSONALITY', 'classico');
    const totalActiveChats = db.prepare('SELECT COUNT(*) as count FROM bot_simi_chats WHERE active = 1').get().count;

    return {
      enabled,
      mode,
      personality,
      totalActiveChats
    };
  },

  updateSimiConfig({ enabled, mode, personality }) {
    if (typeof enabled !== 'undefined') {
      models.setSimiEnabledGlobal(enabled);
    }
    if (mode) {
      models.setSetting('SIMI_MODE', mode);
    }
    if (personality) {
      models.setSetting('SIMI_PERSONALITY', personality);
    }
    return models.getSimiConfig();
  },

  isSimiActiveInChat(chatJid) {
    if (!chatJid) return false;
    if (!models.isSimiEnabledGlobal()) return false;

    // Se houver configuração específica para este chat, ela tem precedência
    const row = db.prepare('SELECT active FROM bot_simi_chats WHERE chat_jid = ?').get(String(chatJid));
    if (row) return row.active === 1;

    const globalMode = models.getSetting('SIMI_MODE', 'command_only');
    if (globalMode === 'auto_everywhere') return true;
    if (globalMode === 'always_groups' && String(chatJid).endsWith('@g.us')) return true;

    return false;
  },

  setSimiActiveInChat(chatJid, active = true, chatName = '', mode = 'auto', personality = 'classico') {
    if (!chatJid) return false;
    const cleanJid = String(chatJid).trim();
    const activeVal = active ? 1 : 0;

    const existing = db.prepare('SELECT id FROM bot_simi_chats WHERE chat_jid = ?').get(cleanJid);
    if (existing) {
      db.prepare(`
        UPDATE bot_simi_chats
        SET active = ?, chat_name = COALESCE(NULLIF(?, ''), chat_name), mode = ?, personality = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(activeVal, chatName, mode, personality, existing.id);
    } else {
      db.prepare(`
        INSERT INTO bot_simi_chats (chat_jid, chat_name, active, mode, personality)
        VALUES (?, ?, ?, ?, ?)
      `).run(cleanJid, chatName || cleanJid, activeVal, mode, personality);
    }
    return true;
  },

  listSimiActiveChats() {
    return db.prepare('SELECT * FROM bot_simi_chats ORDER BY updated_at DESC').all();
  },

  // ==========================================
  // 48. BASE DE CONHECIMENTO & RAG FAQ DE PRODUTOS
  // ==========================================
  getProductFaqs(productId = null) {
    if (productId !== null && productId !== undefined && productId !== '') {
      return db.prepare('SELECT f.*, p.name as product_name FROM product_faqs f LEFT JOIN products p ON f.product_id = p.id WHERE f.product_id = ? OR f.product_id IS NULL ORDER BY f.id DESC').all(Number(productId));
    }
    return db.prepare('SELECT f.*, p.name as product_name FROM product_faqs f LEFT JOIN products p ON f.product_id = p.id ORDER BY f.id DESC').all();
  },

  getProductFaqById(id) {
    return db.prepare('SELECT f.*, p.name as product_name FROM product_faqs f LEFT JOIN products p ON f.product_id = p.id WHERE f.id = ?').get(Number(id));
  },

  createProductFaq({ product_id = null, question, answer, keywords = '' }) {
    if (!question || !answer) throw new Error('Pergunta e resposta são obrigatórias.');
    const res = db.prepare(`
      INSERT INTO product_faqs (product_id, question, answer, keywords, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(product_id ? Number(product_id) : null, String(question).trim(), String(answer).trim(), String(keywords || '').trim());
    return models.getProductFaqById(Number(res.lastInsertRowid));
  },

  updateProductFaq(id, data = {}) {
    const existing = models.getProductFaqById(id);
    if (!existing) throw new Error('FAQ não encontrado');
    const question = data.question !== undefined ? String(data.question).trim() : existing.question;
    const answer = data.answer !== undefined ? String(data.answer).trim() : existing.answer;
    const keywords = data.keywords !== undefined ? String(data.keywords).trim() : existing.keywords;
    const product_id = data.product_id !== undefined ? (data.product_id ? Number(data.product_id) : null) : existing.product_id;
    const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

    db.prepare(`
      UPDATE product_faqs
      SET question = ?, answer = ?, keywords = ?, product_id = ?, active = ?
      WHERE id = ?
    `).run(question, answer, keywords, product_id, active, id);
    return models.getProductFaqById(id);
  },

  deleteProductFaq(id) {
    return db.prepare('DELETE FROM product_faqs WHERE id = ?').run(Number(id));
  },

  matchProductFaq(queryText, productId = null) {
    if (!queryText || typeof queryText !== 'string') return null;
    const cleanQuery = queryText.toLowerCase().trim();
    const faqs = models.getProductFaqs(productId).filter(f => f.active === 1);
    if (faqs.length === 0) return null;

    let bestMatch = null;
    let highestScore = 0;

    for (const faq of faqs) {
      let score = 0;
      const q = faq.question.toLowerCase();
      const kwList = (faq.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);

      // Exact or partial phrase match
      if (cleanQuery.includes(q) || q.includes(cleanQuery)) {
        score += 50;
      }

      // Keyword matches
      for (const kw of kwList) {
        if (cleanQuery.includes(kw)) {
          score += 20;
        }
      }

      // Token overlap
      const queryTokens = cleanQuery.split(/\s+/).filter(w => w.length > 3);
      for (const tok of queryTokens) {
        if (q.includes(tok)) score += 5;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = faq;
      }
    }

    if (highestScore >= 15 && bestMatch) {
      return { match: true, faq: bestMatch, score: highestScore };
    }
    return null;
  },

  seedDefaultFaqsIfEmpty() {
    try {
      const count = db.prepare('SELECT COUNT(id) as c FROM product_faqs').get()?.c || 0;
      if (count === 0) {
        const defaults = [
          {
            question: 'Como recebo o acesso ao produto após o pagamento?',
            answer: 'A entrega é 100% automática e imediata! Assim que o PIX ou pagamento Cripto é confirmado pela rede, o sistema envia o seu link de acesso, licença e instruções completas diretamente aqui pelo chat.',
            keywords: 'como recebo, entrega, prazo, envio, acesso, download, liberacao, quando recebo'
          },
          {
            question: 'Quais são as formas de pagamento aceitas?',
            answer: 'Aceitamos PIX Instantâneo com aprovação em 2 segundos e Carteira Cripto Auto-Custódia (USDT TRC20/BEP20, BTC, ETH, SOL, TON, etc.) direto para a sua segurança sem intermediários.',
            keywords: 'formas de pagamento, como pagar, aceita pix, aceita cartao, cripto, usdt, bitcoin, boleto'
          },
          {
            question: 'Os produtos possuem garantia e suporte?',
            answer: 'Sim! Todos os nossos produtos e ferramentas contam com garantia legal de 7 dias e suporte técnico especializado para tirar todas as suas dúvidas.',
            keywords: 'garantia, suporte, reembolso, devolucao, funciona, confiavel, seguro'
          },
          {
            question: 'Como funciona o programa de afiliados?',
            answer: 'Você pode faturar comissões de 20% a 50% divulgando nossos produtos! Basta acessar o nosso Portal do Afiliado (/afiliado), pegar seus Magic Paylinks de 1-clique e começar a faturar. Pagamentos via PIX ou USDT.',
            keywords: 'afiliado, revenda, comissao, parceria, como ser afiliado, ganhar dinheiro'
          }
        ];
        for (const f of defaults) {
          models.createProductFaq(f);
        }
      }
    } catch (_) {}
  },

  // ==========================================
  // 47. ENCURTADOR INTELIGENTE DE LINKS DE VITRINE & IDENTIFICAÇÃO DE CLIENTES
  // ==========================================

  /**
   * Cria um link curto exclusivo para o cliente contendo telefone, nome, subbot e cupom.
   */
  createStoreShortLink({
    code = null,
    phone,
    name = null,
    customerName = null,
    instanceId = 1,
    refCode = null,
    couponCode = null,
    source = 'pv_welcome',
    targetPath = '/loja'
  }) {
    const crypto = require('crypto');
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : 'anon';
    const resolvedName = name || customerName;
    const cleanName = resolvedName && typeof resolvedName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(resolvedName.trim())
      ? resolvedName.trim()
      : null;

    let finalCode = code ? String(code).trim() : '';
    if (!finalCode) {
      let attempts = 0;
      while (attempts < 10) {
        const rand = crypto.randomBytes(3).toString('hex').slice(0, 5);
        const candidate = `v${rand}`;
        const exists = db.prepare('SELECT id FROM store_short_links WHERE code = ?').get(candidate);
        if (!exists) {
          finalCode = candidate;
          break;
        }
        attempts++;
      }
      if (!finalCode) {
        finalCode = `v${Date.now().toString(36).slice(-5)}`;
      }
    }

    const instId = (instanceId !== null && instanceId !== undefined && !isNaN(Number(instanceId)))
      ? Number(instanceId)
      : (instanceId || 1);

    // Se já existir com esse código, atualiza
    const existing = db.prepare('SELECT * FROM store_short_links WHERE lower(code) = lower(?)').get(finalCode);
    if (existing) {
      db.prepare('UPDATE store_short_links SET phone = ?, customer_name = ? WHERE id = ?').run(cleanPhone, cleanName, existing.id);
      return models.getStoreShortLinkByCode(finalCode, { trackClick: false });
    }

    const stmt = db.prepare(`
      INSERT INTO store_short_links (
        code, phone, customer_name, instance_id, ref_code, coupon_code, source, target_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      finalCode,
      cleanPhone,
      cleanName,
      instId,
      refCode || null,
      couponCode || null,
      source || 'pv_welcome',
      targetPath || '/loja'
    );

    return models.getStoreShortLinkByCode(finalCode, { trackClick: false });
  },

  /**
   * Obtém ou reaproveita um link curto recente (criado nas últimas 48h) para evitar gerar códigos repetidos
   */
  getOrCreateStoreShortLink({
    phone,
    name = null,
    customerName = null,
    instanceId = 1,
    refCode = null,
    couponCode = null,
    source = 'pv_welcome',
    targetPath = '/loja'
  }) {
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : 'anon';
    const instId = (instanceId !== null && instanceId !== undefined && !isNaN(Number(instanceId)))
      ? Number(instanceId)
      : (instanceId || 1);
    const resolvedName = name || customerName;

    const existing = db.prepare(`
      SELECT * FROM store_short_links
      WHERE phone = ? AND source = ? AND instance_id = ?
        AND datetime(created_at) >= datetime('now', '-48 hours')
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, source || 'pv_welcome', instId);

    if (existing) {
      const cleanName = resolvedName && typeof resolvedName === 'string' && !/^(cliente|lead|amigo|user|undefined|null)$/i.test(resolvedName.trim())
        ? resolvedName.trim()
        : null;
      if (cleanName && cleanName !== existing.customer_name) {
        try {
          db.prepare('UPDATE store_short_links SET customer_name = ? WHERE id = ?').run(cleanName, existing.id);
          existing.customer_name = cleanName;
        } catch (_) {}
      }
      return existing;
    }

    return models.createStoreShortLink({
      phone: cleanPhone,
      name: resolvedName,
      instanceId: instId,
      refCode,
      couponCode,
      source,
      targetPath
    });
  },

  /**
   * Busca os dados do link curto pelo código e opcionalmente incrementa contagem de acessos
   */
  getStoreShortLinkByCode(code, options = {}) {
    if (!code) return null;
    const cleanCode = String(code).trim().toLowerCase();
    const row = db.prepare('SELECT * FROM store_short_links WHERE lower(code) = ?').get(cleanCode);
    if (row && options && options.trackClick) {
      try {
        db.prepare('UPDATE store_short_links SET clicks_count = clicks_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
        row.clicks_count = (row.clicks_count || 0) + 1;
      } catch (_) {}
    }
    return row;
  },

  /**
   * Lista links curtos criados para um determinado número de telefone
   */
  getStoreShortLinksByPhone(phone, limit = 10) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM store_short_links WHERE phone = ? ORDER BY id DESC LIMIT ?').all(cleanPhone, limit);
  },

  // ==========================================
  // 46b. CÓDIGOS DE ACESSO & OTP DA LOJA PÚBLICA
  // ==========================================

  createStoreAccessCode({ phone, name = null, instanceId = 1 }) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const instId = Number(instanceId) || 1;

    // Gera código de 5 caracteres alfanuméricos em caixa alta (ex: F4G52)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let accessCode = '';
    for (let i = 0; i < 5; i++) {
      accessCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Cria shortlink correspondente para que o link /v/:code funcione instantaneamente
    const shortLink = models.createStoreShortLink({
      code: accessCode,
      phone: cleanPhone,
      name,
      instanceId: instId,
      source: 'store_gate',
      targetPath: '/loja'
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const stmt = db.prepare(`
      INSERT INTO store_access_codes (
        phone, code, short_code, instance_id, status, expires_at
      ) VALUES (?, ?, ?, ?, 'PENDING', ?)
    `);

    stmt.run(cleanPhone, accessCode, shortLink.code, instId, expiresAt);

    return {
      phone: cleanPhone,
      code: accessCode,
      shortCode: shortLink.code,
      expiresAt
    };
  },

  verifyStoreAccessCode(phone, code) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const cleanCode = String(code || '').trim().toUpperCase();

    const row = db.prepare(`
      SELECT * FROM store_access_codes
      WHERE phone = ? AND UPPER(code) = ?
        AND status = 'PENDING'
        AND datetime(expires_at) >= datetime('now')
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, cleanCode);

    if (!row) {
      const rowByShort = db.prepare(`
        SELECT * FROM store_access_codes
        WHERE phone = ? AND UPPER(short_code) = ?
          AND datetime(expires_at) >= datetime('now')
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone, cleanCode);

      if (rowByShort) {
        db.prepare(`UPDATE store_access_codes SET status = 'VERIFIED', verified_at = CURRENT_TIMESTAMP WHERE id = ?`).run(rowByShort.id);
        return { success: true, record: rowByShort };
      }
      return { success: false, error: 'Código inválido ou expirado.' };
    }

    db.prepare(`UPDATE store_access_codes SET status = 'VERIFIED', verified_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
    return { success: true, record: row };
  },

  isStoreAccessVerified(phone, code = null) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    let row;
    if (code) {
      const cleanCode = String(code).trim().toUpperCase();
      row = db.prepare(`
        SELECT * FROM store_access_codes
        WHERE (phone = ? OR phone = '') AND (UPPER(code) = ? OR UPPER(short_code) = ?) AND status = 'VERIFIED'
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone, cleanCode, cleanCode);
    } else {
      row = db.prepare(`
        SELECT * FROM store_access_codes
        WHERE phone = ? AND status = 'VERIFIED'
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone);
    }
    return !!row;
  },

  markStoreAccessVerifiedByCode(shortCode) {
    if (!shortCode) return false;
    const cleanCode = String(shortCode).trim().toUpperCase();
    try {
      db.prepare(`
        UPDATE store_access_codes
        SET status = 'VERIFIED', verified_at = CURRENT_TIMESTAMP
        WHERE (UPPER(code) = ? OR UPPER(short_code) = ?) AND status = 'PENDING'
      `).run(cleanCode, cleanCode);
      return true;
    } catch (_) {
      return false;
    }
  },

  // ==========================================
  // 47. MENTE DO DONO (MINDSET, TOM DE VOZ, GÍRIAS & INTENÇÕES)
  // ==========================================

  getOwnerMindsetProfile(ownerPhone) {
    if (!ownerPhone) return null;
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    let profile = db.prepare('SELECT * FROM owner_mindset_profile WHERE owner_phone = ?').get(cleanPhone);
    if (!profile) {
      db.prepare(`
        INSERT INTO owner_mindset_profile (
          owner_phone, primary_tones, speech_style_summary, dominant_intents, learned_traits, total_messages_learned, synchronization_score
        ) VALUES (?, ?, ?, ?, ?, 1, 75.0)
      `).run(
        cleanPhone,
        JSON.stringify(['Assertivo', 'Estratégico', 'Descontraído']),
        'Comandante com perfil visionário e ágil. Valoriza comunicação transparente, parcerias leais, escala acelerada e decisões firmes.',
        JSON.stringify(['ORDEM_OPERACIONAL', 'DIRECAO_ESTRATEGICA', 'CONSULTA_METRICAS']),
        JSON.stringify(['Respostas rápidas e sem enrolação', 'Foco no faturamento e lucro líquido', 'Tratamento fraternal de confiança mútua'])
      );
      profile = db.prepare('SELECT * FROM owner_mindset_profile WHERE owner_phone = ?').get(cleanPhone);
    }

    try {
      if (profile && typeof profile.primary_tones === 'string') profile.primary_tones = JSON.parse(profile.primary_tones);
      if (profile && typeof profile.dominant_intents === 'string') profile.dominant_intents = JSON.parse(profile.dominant_intents);
      if (profile && typeof profile.learned_traits === 'string') profile.learned_traits = JSON.parse(profile.learned_traits);
    } catch (_) {}

    return profile;
  },

  upsertOwnerMindsetProfile(ownerPhone, data = {}) {
    if (!ownerPhone) return null;
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    const existing = db.prepare('SELECT * FROM owner_mindset_profile WHERE owner_phone = ?').get(cleanPhone);

    const primaryTones = Array.isArray(data.primary_tones) ? JSON.stringify(data.primary_tones) : (data.primary_tones || null);
    const dominantIntents = Array.isArray(data.dominant_intents) ? JSON.stringify(data.dominant_intents) : (data.dominant_intents || null);
    const learnedTraits = Array.isArray(data.learned_traits) ? JSON.stringify(data.learned_traits) : (data.learned_traits || null);

    if (!existing) {
      db.prepare(`
        INSERT INTO owner_mindset_profile (
          owner_phone, primary_tones, speech_style_summary, dominant_intents, learned_traits,
          total_messages_learned, synchronization_score, last_message_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        cleanPhone,
        primaryTones || JSON.stringify(['Assertivo', 'Estratégico', 'Descontraído']),
        data.speech_style_summary || 'Comandante focado em crescimento e vendas.',
        dominantIntents || JSON.stringify(['ORDEM_OPERACIONAL', 'DIRECAO_ESTRATEGICA']),
        learnedTraits || JSON.stringify(['Foco em lucro', 'Agilidade']),
        data.total_messages_learned || 1,
        data.synchronization_score || 75.0
      );
    } else {
      db.prepare(`
        UPDATE owner_mindset_profile SET
          primary_tones = COALESCE(?, primary_tones),
          speech_style_summary = COALESCE(?, speech_style_summary),
          dominant_intents = COALESCE(?, dominant_intents),
          learned_traits = COALESCE(?, learned_traits),
          total_messages_learned = total_messages_learned + ?,
          synchronization_score = COALESCE(?, synchronization_score),
          last_message_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE owner_phone = ?
      `).run(
        primaryTones,
        data.speech_style_summary || null,
        dominantIntents,
        learnedTraits,
        data.incrementMessages ? 1 : 0,
        data.synchronization_score || null,
        cleanPhone
      );
    }

    return models.getOwnerMindsetProfile(cleanPhone);
  },

  recordOwnerSlang(ownerPhone, expression, meaningIntent, tone = 'Descontraído', exampleUsage = '') {
    if (!ownerPhone || !expression) return null;
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    const cleanExp = String(expression).trim().toLowerCase();
    const cleanIntent = String(meaningIntent || 'EXPRESSAO_COLOQUIAL').trim().toUpperCase();
    const cleanTone = String(tone || 'Descontraído').trim();

    const existing = db.prepare('SELECT * FROM owner_slangs_and_expressions WHERE owner_phone = ? AND lower(expression) = ?').get(cleanPhone, cleanExp);

    if (existing) {
      db.prepare(`
        UPDATE owner_slangs_and_expressions SET
          frequency = frequency + 1,
          meaning_intent = ?,
          tone = ?,
          example_usage = COALESCE(NULLIF(?, ''), example_usage),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cleanIntent, cleanTone, exampleUsage || '', existing.id);
    } else {
      db.prepare(`
        INSERT INTO owner_slangs_and_expressions (
          owner_phone, expression, meaning_intent, tone, frequency, example_usage
        ) VALUES (?, ?, ?, ?, 1, ?)
      `).run(cleanPhone, cleanExp, cleanIntent, cleanTone, exampleUsage || '');
    }

    return db.prepare('SELECT * FROM owner_slangs_and_expressions WHERE owner_phone = ? AND lower(expression) = ?').get(cleanPhone, cleanExp);
  },

  getOwnerSlangs(ownerPhone, limit = 50) {
    if (!ownerPhone) return [];
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM owner_slangs_and_expressions WHERE owner_phone = ? ORDER BY frequency DESC, updated_at DESC LIMIT ?').all(cleanPhone, limit);
  },

  recordOwnerToneHistory(ownerPhone, messageText, detectedTone, detectedIntent, detectedSlangs = [], sentiment = 'POSITIVO', contextType = 'PRIVATE') {
    if (!ownerPhone || !messageText) return null;
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    const slangsJson = Array.isArray(detectedSlangs) ? JSON.stringify(detectedSlangs) : String(detectedSlangs || '[]');

    const res = db.prepare(`
      INSERT INTO owner_tone_history (
        owner_phone, message_text, detected_tone, detected_intent, detected_slangs, sentiment, context_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanPhone,
      String(messageText).slice(0, 1000),
      detectedTone || 'Neutro',
      detectedIntent || 'CONVERSA',
      slangsJson,
      sentiment || 'POSITIVO',
      contextType || 'PRIVATE'
    );

    return res.lastInsertRowid;
  },

  getOwnerToneHistory(ownerPhone, limit = 20) {
    if (!ownerPhone) return [];
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    const rows = db.prepare('SELECT * FROM owner_tone_history WHERE owner_phone = ? ORDER BY id DESC LIMIT ?').all(cleanPhone, limit);
    for (const r of rows) {
      try {
        if (typeof r.detected_slangs === 'string') r.detected_slangs = JSON.parse(r.detected_slangs);
      } catch (_) {}
    }
    return rows;
  },

  getOwnerMindsetSummary(ownerPhone) {
    if (!ownerPhone) return null;
    const cleanPhone = String(ownerPhone).replace(/\D/g, '');
    const profile = models.getOwnerMindsetProfile(cleanPhone);
    const slangs = models.getOwnerSlangs(cleanPhone, 20);
    const recentHistory = models.getOwnerToneHistory(cleanPhone, 10);
    const totalInteractions = db.prepare('SELECT COUNT(*) as c FROM owner_tone_history WHERE owner_phone = ?').get(cleanPhone)?.c || 0;

    return {
      profile,
      slangs,
      recentHistory,
      totalInteractions,
      synchronizationScore: profile ? profile.synchronization_score : 75.0
    };
  },

  // ==========================================
  // 48. INTELIGÊNCIA PREDITIVA & ANTECIPAÇÃO DE PASSOS
  // ==========================================

  recordPredictiveInsight(data = {}) {
    const ownerPhone = String(data.owner_phone || '554884702848').replace(/\D/g, '');
    const res = db.prepare(`
      INSERT INTO predictive_intel_insights (
        owner_phone, insight_type, probability_score, projected_impact_brl,
        title, recommendation, suggested_action, evidence_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ownerPhone,
      data.insight_type || 'CONVERSION_OPPORTUNITY',
      Number(data.probability_score || 0),
      Number(data.projected_impact_brl || 0),
      String(data.title || 'Insight Preditivo'),
      String(data.recommendation || ''),
      String(data.suggested_action || ''),
      typeof data.evidence_data === 'object' ? JSON.stringify(data.evidence_data) : String(data.evidence_data || '{}')
    );
    return res.lastInsertRowid;
  },

  getRecentPredictiveInsights(ownerPhone, limit = 10) {
    const cleanPhone = String(ownerPhone || '554884702848').replace(/\D/g, '');
    const rows = db.prepare('SELECT * FROM predictive_intel_insights WHERE owner_phone = ? ORDER BY id DESC LIMIT ?').all(cleanPhone, limit);
    for (const r of rows) {
      try {
        if (typeof r.evidence_data === 'string') r.evidence_data = JSON.parse(r.evidence_data);
      } catch (_) {}
    }
    return rows;
  },

  recordOwnerDecisionPattern(data = {}) {
    const ownerPhone = String(data.owner_phone || '554884702848').replace(/\D/g, '');
    const now = new Date();
    const res = db.prepare(`
      INSERT INTO owner_decision_patterns (
        owner_phone, action_type, context_intent, hour_of_day, day_of_week, executed_command
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ownerPhone,
      data.action_type || 'GENERAL_COMMAND',
      data.context_intent || 'OPERATION',
      now.getHours(),
      now.getDay(),
      String(data.executed_command || '').slice(0, 500)
    );
    return res.lastInsertRowid;
  },

  getOwnerDecisionPatterns(ownerPhone, limit = 50) {
    const cleanPhone = String(ownerPhone || '554884702848').replace(/\D/g, '');
    return db.prepare('SELECT * FROM owner_decision_patterns WHERE owner_phone = ? ORDER BY id DESC LIMIT ?').all(cleanPhone, limit);
  },

  // ==========================================
  // CONTATOS & IDENTIFICAÇÃO WHATSAPP (PUSHNAME & PRIMEIRO NOME)
  // ==========================================
  extractFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    const clean = fullName
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}]/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();
    if (!clean) return '';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0];
    if (first.length < 2) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  },

  upsertWhatsAppContact(phone, pushName) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 8) return null;
    const cleanPushName = pushName && typeof pushName === 'string' ? pushName.trim().slice(0, 120) : null;
    const firstName = cleanPushName ? models.extractFirstName(cleanPushName) : null;

    try {
      const existing = db.prepare('SELECT * FROM whatsapp_contacts WHERE phone = ?').get(cleanPhone);
      if (existing) {
        if (cleanPushName && cleanPushName !== 'Cliente') {
          db.prepare(`
            UPDATE whatsapp_contacts
            SET push_name = ?, first_name = COALESCE(?, first_name), last_seen_at = datetime('now'), updated_at = datetime('now')
            WHERE phone = ?
          `).run(cleanPushName, firstName, cleanPhone);
        } else {
          db.prepare(`
            UPDATE whatsapp_contacts
            SET last_seen_at = datetime('now'), updated_at = datetime('now')
            WHERE phone = ?
          `).run(cleanPhone);
        }
      } else {
        db.prepare(`
          INSERT INTO whatsapp_contacts (phone, push_name, first_name, last_seen_at, updated_at, created_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
        `).run(cleanPhone, cleanPushName || null, firstName || null);
      }
      return models.getWhatsAppContact(cleanPhone);
    } catch (err) {
      console.warn('[upsertWhatsAppContact ⚠️ Erro]:', err.message);
      return null;
    }
  },

  getWhatsAppContact(phone) {
    if (!phone) return null;
    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      return db.prepare('SELECT * FROM whatsapp_contacts WHERE phone = ?').get(cleanPhone) || null;
    } catch (_) {
      return null;
    }
  },

  getContactFirstName(phone, fallback = '') {
    if (!phone) return fallback;
    const contact = models.getWhatsAppContact(phone);
    if (contact && contact.first_name && contact.first_name.length >= 2) {
      return contact.first_name;
    }
    return fallback;
  },

  // ==========================================
  // RADAR DE LEADS & MINERAÇÃO EM GRUPOS (BOTS & SUB-BOTS)
  // ==========================================
  recordRadarLead(data = {}) {
    try {
      const group_jid = data.group_jid || null;
      const group_name = data.group_name || 'Grupo WhatsApp';
      const sender_phone = String(data.sender_phone || '').replace(/\D/g, '');
      const sender_name = data.sender_name || null;
      const keyword_matched = data.keyword_matched || null;
      const category = data.category || 'Geral';
      const message_text = data.message_text ? String(data.message_text).slice(0, 1000) : null;
      const is_audio = data.is_audio ? 1 : 0;
      const status = data.status || 'NEW';
      const notes = data.notes || null;
      const instance_id = Number(data.instance_id || 1);
      const scout_name = data.scout_name || 'WhatsApp Matriz Principal';
      const matched_product_id = data.matched_product_id ? Number(data.matched_product_id) : null;
      const matched_product_name = data.matched_product_name || null;
      const custom_track_url = data.custom_track_url || null;
      const ready_message = data.ready_message || null;

      const res = db.prepare(`
        INSERT INTO radar_captured_leads (
          group_jid, group_name, sender_phone, sender_name, keyword_matched, category,
          message_text, is_audio, status, notes, instance_id, scout_name,
          matched_product_id, matched_product_name, custom_track_url, ready_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        group_jid, group_name, sender_phone, sender_name, keyword_matched, category,
        message_text, is_audio, status, notes, instance_id, scout_name,
        matched_product_id, matched_product_name, custom_track_url, ready_message
      );

      return { id: res.lastInsertRowid, ...data };
    } catch (err) {
      console.warn('[recordRadarLead ⚠️ Erro]:', err.message);
      return null;
    }
  },

  listRadarLeads(limit = 50, status = null) {
    try {
      if (status) {
        return db.prepare('SELECT * FROM radar_captured_leads WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, Number(limit));
      }
      return db.prepare('SELECT * FROM radar_captured_leads ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (err) {
      console.warn('[listRadarLeads ⚠️ Erro]:', err.message);
      return [];
    }
  },

  updateRadarLeadStatus(id, status, notes = null) {
    try {
      if (notes !== null) {
        db.prepare('UPDATE radar_captured_leads SET status = ?, notes = ? WHERE id = ?').run(status, notes, Number(id));
      } else {
        db.prepare('UPDATE radar_captured_leads SET status = ? WHERE id = ?').run(status, Number(id));
      }
      return db.prepare('SELECT * FROM radar_captured_leads WHERE id = ?').get(Number(id));
    } catch (err) {
      console.warn('[updateRadarLeadStatus ⚠️ Erro]:', err.message);
      return null;
    }
  },

  getRadarStats() {
    try {
      const total = db.prepare('SELECT COUNT(*) as c FROM radar_captured_leads').get()?.c || 0;
      const newCount = db.prepare("SELECT COUNT(*) as c FROM radar_captured_leads WHERE status = 'NEW'").get()?.c || 0;
      const contacted = db.prepare("SELECT COUNT(*) as c FROM radar_captured_leads WHERE status = 'CONTACTED'").get()?.c || 0;
      const converted = db.prepare("SELECT COUNT(*) as c FROM radar_captured_leads WHERE status = 'CONVERTED'").get()?.c || 0;
      return { total, new: newCount, contacted, converted };
    } catch (_) {
      return { total: 0, new: 0, contacted: 0, converted: 0 };
    }
  },

  // =========================================================================
  // ⚡ JEV DECISION ENGINE (SYSTEM 1 FAST TYPED DECISIONS)
  // =========================================================================
  recordJevDecision({
    contextType,
    senderPhone = null,
    chatJid = null,
    inputExcerpt = '',
    intent,
    confidence = 0.95,
    latencyMs = 15.0,
    decisionPayload = {},
    executionMode = 'HYBRID_FAST',
    tokensSaved = 350
  }) {
    try {
      const cleanPhone = senderPhone ? String(senderPhone).replace(/\D/g, '') : null;
      const excerpt = inputExcerpt ? String(inputExcerpt).slice(0, 300) : '';
      const payloadStr = typeof decisionPayload === 'string' ? decisionPayload : JSON.stringify(decisionPayload);

      const res = db.prepare(`
        INSERT INTO jev_decisions (
          context_type, sender_phone, chat_jid, input_excerpt, intent,
          confidence, latency_ms, decision_payload, execution_mode, tokens_saved, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        contextType, cleanPhone, chatJid, excerpt, intent,
        Number(confidence), Number(latencyMs), payloadStr, executionMode, Number(tokensSaved)
      );

      return { id: res.lastInsertRowid, intent, confidence, latencyMs };
    } catch (err) {
      console.warn('[recordJevDecision ⚠️ Erro]:', err.message);
      return null;
    }
  },

  getJevTelemetry() {
    try {
      const totalRow = db.prepare('SELECT COUNT(*) as c, AVG(latency_ms) as avg_lat, SUM(tokens_saved) as total_tokens FROM jev_decisions').get();
      const todayRow = db.prepare("SELECT COUNT(*) as c FROM jev_decisions WHERE created_at >= date('now')").get();
      
      const intentRows = db.prepare(`
        SELECT intent, COUNT(*) as count 
        FROM jev_decisions 
        GROUP BY intent 
        ORDER BY count DESC 
        LIMIT 10
      `).all();

      const contextRows = db.prepare(`
        SELECT context_type, COUNT(*) as count 
        FROM jev_decisions 
        GROUP BY context_type 
        ORDER BY count DESC
      `).all();

      return {
        totalDecisions: totalRow?.c || 0,
        decisionsToday: todayRow?.c || 0,
        avgLatencyMs: Number((totalRow?.avg_lat || 12.4).toFixed(1)),
        tokensSavedTotal: totalRow?.total_tokens || 0,
        intentsDistribution: intentRows || [],
        contextsDistribution: contextRows || [],
        enabled: this.getSetting('JEV_ENABLED', 'true') === 'true',
        mode: this.getSetting('JEV_MODE', 'HYBRID'),
        minConfidence: parseFloat(this.getSetting('JEV_MIN_CONFIDENCE', '0.75')),
        hasApiKey: !!(this.getSetting('JEV_API_KEY', '') || process.env.JEV_API_KEY)
      };
    } catch (err) {
      console.warn('[getJevTelemetry ⚠️ Erro]:', err.message);
      return {
        totalDecisions: 0,
        decisionsToday: 0,
        avgLatencyMs: 15.0,
        tokensSavedTotal: 0,
        intentsDistribution: [],
        contextsDistribution: [],
        enabled: true,
        mode: 'HYBRID',
        minConfidence: 0.75,
        hasApiKey: false
      };
    }
  },

  listRecentJevDecisions(limit = 25, contextType = null) {
    try {
      if (contextType) {
        return db.prepare('SELECT * FROM jev_decisions WHERE context_type = ? ORDER BY id DESC LIMIT ?').all(contextType, Number(limit));
      }
      return db.prepare('SELECT * FROM jev_decisions ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (err) {
      console.warn('[listRecentJevDecisions ⚠️ Erro]:', err.message);
      return [];
    }
  },

  getJevSettings() {
    return {
      enabled: this.getSetting('JEV_ENABLED', 'true') === 'true',
      mode: this.getSetting('JEV_MODE', 'HYBRID'),
      apiKey: this.getSetting('JEV_API_KEY', '') ? '••••••••' + this.getSetting('JEV_API_KEY', '').slice(-4) : '',
      endpoint: this.getSetting('JEV_ENDPOINT', 'https://api.typesafe.ai/v1/decide'),
      minConfidence: parseFloat(this.getSetting('JEV_MIN_CONFIDENCE', '0.75')),
      fallbackToLlm: this.getSetting('JEV_FALLBACK_TO_LLM', 'true') === 'true',
      bypassLlmOnDirectAction: this.getSetting('JEV_BYPASS_LLM_DIRECT', 'true') === 'true'
    };
  },

  updateJevSettings(settings = {}) {
    if (settings.enabled !== undefined) this.setSetting('JEV_ENABLED', settings.enabled ? 'true' : 'false');
    if (settings.mode !== undefined) this.setSetting('JEV_MODE', String(settings.mode).toUpperCase());
    if (settings.apiKey !== undefined && !settings.apiKey.includes('••••')) {
      this.setSetting('JEV_API_KEY', String(settings.apiKey).trim());
    }
    if (settings.endpoint !== undefined) this.setSetting('JEV_ENDPOINT', String(settings.endpoint).trim());
    if (settings.minConfidence !== undefined) this.setSetting('JEV_MIN_CONFIDENCE', String(settings.minConfidence));
    if (settings.fallbackToLlm !== undefined) this.setSetting('JEV_FALLBACK_TO_LLM', settings.fallbackToLlm ? 'true' : 'false');
    if (settings.bypassLlmOnDirectAction !== undefined) this.setSetting('JEV_BYPASS_LLM_DIRECT', settings.bypassLlmOnDirectAction ? 'true' : 'false');
    return this.getJevSettings();
  },

  // =========================================================================
  // ⚡ 1. FOLLOW-UP AUTÔNOMO ANTI-VÁCUO
  // =========================================================================
  recordFollowUpLog({ orderId = null, tradeNo = null, customerPhone, customerName = '', stage = 1, messageSent, status = 'SENT' }) {
    try {
      const cleanPhone = String(customerPhone).replace(/\D/g, '');
      const res = db.prepare(`
        INSERT INTO autonomous_followup_logs (order_id, trade_no, customer_phone, customer_name, stage, message_sent, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, tradeNo, cleanPhone, customerName, stage, messageSent, status);
      return { id: res.lastInsertRowid };
    } catch (err) {
      console.warn('[recordFollowUpLog ⚠️ Erro]:', err.message);
      return null;
    }
  },

  getFollowUpHistory(customerPhone) {
    try {
      const cleanPhone = String(customerPhone).replace(/\D/g, '');
      return db.prepare('SELECT * FROM autonomous_followup_logs WHERE customer_phone = ? ORDER BY id DESC').all(cleanPhone);
    } catch (_) {
      return [];
    }
  },

  // =========================================================================
  // ⚡ 2. MULTI-ARMED BANDIT PARA TESTES A/B AUTÔNOMOS
  // =========================================================================
  listBanditArms(category = 'PITCH_ANGLE') {
    try {
      return db.prepare('SELECT * FROM bandit_arms WHERE category = ? AND active = 1 ORDER BY id ASC').all(category);
    } catch (_) {
      return [];
    }
  },

  getBestBanditArm(category = 'PITCH_ANGLE') {
    try {
      const arms = this.listBanditArms(category);
      if (!arms || arms.length === 0) return null;

      let bestArm = arms[0];
      let maxSample = -1;

      for (const arm of arms) {
        const alpha = (arm.conversions || 0) + 1;
        const beta = Math.max(1, (arm.impressions || 0) - (arm.conversions || 0) + 1);
        const sample = (alpha / (alpha + beta)) + (Math.random() * 0.15);
        if (sample > maxSample) {
          maxSample = sample;
          bestArm = arm;
        }
      }
      return bestArm;
    } catch (_) {
      return null;
    }
  },

  recordBanditImpression(armKey) {
    try {
      db.prepare('UPDATE bandit_arms SET impressions = impressions + 1 WHERE arm_key = ?').run(armKey);
    } catch (_) {}
  },

  recordBanditConversion(armKey, revenueBrl = 0) {
    try {
      db.prepare('UPDATE bandit_arms SET conversions = conversions + 1, revenue_brl = revenue_brl + ? WHERE arm_key = ?').run(Number(revenueBrl || 0), armKey);
    } catch (_) {}
  },

  // =========================================================================
  // ⚡ 3. ENXAME DE SUB-BOTS (SWARM INTELLIGENCE)
  // =========================================================================
  recordSwarmMission({ missionType, targetJid = null, prospectPhone = null, scoutInstanceId = 1, proofInstanceId = null, closerInstanceId = null, notes = '' }) {
    try {
      const res = db.prepare(`
        INSERT INTO swarm_missions (mission_type, target_jid, prospect_phone, scout_instance_id, proof_instance_id, closer_instance_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?)
      `).run(missionType, targetJid, prospectPhone, scoutInstanceId, proofInstanceId, closerInstanceId, notes);
      return { id: res.lastInsertRowid };
    } catch (err) {
      console.warn('[recordSwarmMission ⚠️ Erro]:', err.message);
      return null;
    }
  },

  listSwarmMissions(limit = 20) {
    try {
      return db.prepare('SELECT * FROM swarm_missions ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (_) {
      return [];
    }
  },

  // =========================================================================
  // ⚡ 4. VISÃO COMPUTACIONAL (INSPEÇÃO DE COMPROVANTES & AGENDAMENTOS)
  // =========================================================================
  recordVisionInspection({ senderPhone, chatJid, detectedType, summaryText, isScheduled = 0, scheduledDate = null, e2eId = null, amountBrl = null, isReplayed = 0, actionTaken = '' }) {
    try {
      const cleanPhone = String(senderPhone || '').replace(/\D/g, '');
      const res = db.prepare(`
        INSERT INTO vision_inspections_log (sender_phone, chat_jid, detected_type, summary_text, is_scheduled, scheduled_date, e2e_id, amount_brl, is_replayed, action_taken)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cleanPhone, chatJid, detectedType, summaryText, isScheduled ? 1 : 0, scheduledDate, e2eId, amountBrl ? Number(amountBrl) : null, isReplayed ? 1 : 0, actionTaken);
      return { id: res.lastInsertRowid };
    } catch (err) {
      console.warn('[recordVisionInspection ⚠️ Erro]:', err.message);
      return null;
    }
  },

  findVisionInspectionByE2eId(e2eId) {
    if (!e2eId) return null;
    try {
      return db.prepare('SELECT * FROM vision_inspections_log WHERE e2e_id = ? ORDER BY id DESC LIMIT 1').get(e2eId);
    } catch (_) {
      return null;
    }
  },

  listVisionInspections(limit = 25) {
    try {
      return db.prepare('SELECT * FROM vision_inspections_log ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (_) {
      return [];
    }
  },

  // =========================================================================
  // ⚡ 5. CO-PILOTO EXECUTIVO DO DONO
  // =========================================================================
  recordExecutiveBriefing({ briefingType, targetPhone, contentText, proposedAction = null }) {
    try {
      const cleanPhone = String(targetPhone || '').replace(/\D/g, '');
      const res = db.prepare(`
        INSERT INTO executive_briefing_logs (briefing_type, target_phone, content_text, proposed_action)
        VALUES (?, ?, ?, ?)
      `).run(briefingType, cleanPhone, contentText, proposedAction);
      return { id: res.lastInsertRowid };
    } catch (err) {
      console.warn('[recordExecutiveBriefing ⚠️ Erro]:', err.message);
      return null;
    }
  },

  getLatestExecutiveBriefing(targetPhone) {
    try {
      const cleanPhone = String(targetPhone || '').replace(/\D/g, '');
      return db.prepare('SELECT * FROM executive_briefing_logs WHERE target_phone = ? ORDER BY id DESC LIMIT 1').get(cleanPhone);
    } catch (_) {
      return null;
    }
  },

  markExecutiveActionExecuted(id, ownerResponse = '') {
    try {
      db.prepare('UPDATE executive_briefing_logs SET action_executed = 1, owner_response = ? WHERE id = ?').run(ownerResponse, Number(id));
    } catch (_) {}
  },

  // =========================================================================
  // 🌙 55. SISTEMA DE MEMÓRIA NOTURNA & CICLO DE SONO (aydinnyunus/sleep)
  // =========================================================================
  recordSleepCycleRun(data = {}) {
    try {
      const res = db.prepare(`
        INSERT INTO sleep_cycle_runs (run_date, conversations_analyzed, orders_analyzed, objections_found, candidates_generated, summary, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.run_date || new Date().toISOString().split('T')[0],
        Number(data.conversations_analyzed || 0),
        Number(data.orders_analyzed || 0),
        Number(data.objections_found || 0),
        Number(data.candidates_generated || 0),
        data.summary || 'Ciclo de sono noturno executado com sucesso.',
        data.status || 'COMPLETED'
      );
      return Number(res.lastInsertRowid);
    } catch (err) {
      console.warn('[SleepCycle ⚠️ recordSleepCycleRun]:', err.message);
      return null;
    }
  },

  listSleepCycleRuns(limit = 10) {
    try {
      return db.prepare('SELECT * FROM sleep_cycle_runs ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (_) {
      return [];
    }
  },

  getLatestSleepCycleRun() {
    try {
      return db.prepare('SELECT * FROM sleep_cycle_runs ORDER BY id DESC LIMIT 1').get() || null;
    } catch (_) {
      return null;
    }
  },

  saveSleepCycleCandidate(data = {}) {
    try {
      const res = db.prepare(`
        INSERT INTO sleep_cycle_candidates (run_id, type, title, shortcut, trigger_keywords, content, category, confidence_score, occurrences_count, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).run(
        data.run_id ? Number(data.run_id) : null,
        data.type || 'ZAPVOICE_SHORTCUT',
        data.title || 'Candidato a Resposta Rápida',
        data.shortcut || null,
        data.trigger_keywords || '',
        data.content || '',
        data.category || 'Vendas',
        Number(data.confidence_score || 0.85),
        Number(data.occurrences_count || 1)
      );
      return Number(res.lastInsertRowid);
    } catch (err) {
      console.warn('[SleepCycle ⚠️ saveSleepCycleCandidate]:', err.message);
      return null;
    }
  },

  listSleepCycleCandidates(status = null, limit = 50) {
    try {
      if (status) {
        return db.prepare('SELECT * FROM sleep_cycle_candidates WHERE status = ? ORDER BY confidence_score DESC, id DESC LIMIT ?').all(String(status), Number(limit));
      }
      return db.prepare('SELECT * FROM sleep_cycle_candidates ORDER BY id DESC LIMIT ?').all(Number(limit));
    } catch (_) {
      return [];
    }
  },

  promoteSleepCycleCandidate(candidateId) {
    try {
      const candidate = db.prepare('SELECT * FROM sleep_cycle_candidates WHERE id = ?').get(Number(candidateId));
      if (!candidate) return { success: false, error: 'Candidato não encontrado' };

      // Se for ZAPVOICE_SHORTCUT ou OBJECTION_RULE, promove para Mensagem Rápida Oficial do ZapVoice
      if (candidate.type === 'ZAPVOICE_SHORTCUT' || candidate.type === 'OBJECTION_RULE') {
        const cleanShortcut = candidate.shortcut ? (candidate.shortcut.startsWith('/') ? candidate.shortcut : `/${candidate.shortcut}`) : `/resp_${candidate.id}`;
        models.saveZapVoiceMessage({
          title: candidate.title,
          shortcut: cleanShortcut,
          content: candidate.content,
          category: candidate.category || 'Vendas',
          trigger_keywords: candidate.trigger_keywords || ''
        });
      }

      // Marca como promovido
      db.prepare("UPDATE sleep_cycle_candidates SET status = 'PROMOTED', promoted_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(candidateId));
      return { success: true, candidate };
    } catch (err) {
      console.warn('[SleepCycle ⚠️ promoteSleepCycleCandidate]:', err.message);
      return { success: false, error: err.message };
    }
  },

  rejectSleepCycleCandidate(candidateId) {
    try {
      db.prepare("UPDATE sleep_cycle_candidates SET status = 'REJECTED' WHERE id = ?").run(Number(candidateId));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  autoPromoteHighConfidenceCandidates(minConfidence = 0.88) {
    try {
      const candidates = db.prepare("SELECT * FROM sleep_cycle_candidates WHERE status = 'PENDING' AND confidence_score >= ?").all(Number(minConfidence));
      let promotedCount = 0;
      for (const c of candidates) {
        const res = this.promoteSleepCycleCandidate(c.id);
        if (res && res.success) promotedCount++;
      }
      return { success: true, promotedCount };
    } catch (err) {
      return { success: false, error: err.message, promotedCount: 0 };
    }
  },

  runSleepCycleDoctorScan() {
    try {
      const diagnostics = [];
      const zapVoiceMessages = models.listZapVoiceMessages() || [];
      const products = models.getAllProducts ? models.getAllProducts() : [];

      // 1. Verifica links desatualizados ou localhost em mensagens do ZapVoice
      const tunnelService = require('../services/tunnelService');
      const storeUrl = tunnelService.getStoreUrl ? tunnelService.getStoreUrl() : '';

      zapVoiceMessages.forEach(msg => {
        if (msg.content && msg.content.includes('http://localhost') && storeUrl && storeUrl.startsWith('https://')) {
          diagnostics.push({
            type: 'STALE_URL',
            severity: 'WARN',
            item: msg.title,
            shortcut: msg.shortcut,
            description: `Mensagem contém link local (${msg.shortcut}). O túnel público oficial é ${storeUrl}.`,
            fixAvailable: true
          });
        }
      });

      // 2. Verifica divergência de preços mencionados em atalhos
      products.forEach(p => {
        const pPrice = Number(p.price_brl || p.price);
        zapVoiceMessages.forEach(msg => {
          if (msg.content && msg.content.includes('R$') && p.name && msg.title.toLowerCase().includes(p.name.toLowerCase().slice(0, 10))) {
            const matchPrice = msg.content.match(/R\$\s*([\d,.]+)/);
            if (matchPrice) {
              const mentioned = parseFloat(matchPrice[1].replace(',', '.'));
              if (!isNaN(mentioned) && Math.abs(mentioned - pPrice) > 5) {
                diagnostics.push({
                  type: 'PRICE_MISMATCH',
                  severity: 'INFO',
                  item: msg.title,
                  shortcut: msg.shortcut,
                  description: `Atalho ${msg.shortcut} cita R$ ${mentioned.toFixed(2)}, mas produto no catálogo oficial custa R$ ${pPrice.toFixed(2)}.`,
                  fixAvailable: true
                });
              }
            }
          }
        });
      });

      // 3. Verifica atalhos duplicados ou conflitantes
      const shortcutMap = new Map();
      zapVoiceMessages.forEach(m => {
        const sc = (m.shortcut || '').toLowerCase().trim();
        if (shortcutMap.has(sc)) {
          diagnostics.push({
            type: 'DUPLICATE_SHORTCUT',
            severity: 'ERROR',
            item: m.title,
            shortcut: m.shortcut,
            description: `Atalho ${m.shortcut} duplicado entre '${shortcutMap.get(sc)}' e '${m.title}'.`,
            fixAvailable: false
          });
        } else {
          shortcutMap.set(sc, m.title);
        }
      });

      const unreviewedCount = db.prepare("SELECT COUNT(*) as cnt FROM sleep_cycle_candidates WHERE status = 'PENDING'").get().cnt;
      if (unreviewedCount > 10) {
        diagnostics.push({
          type: 'PENDING_CANDIDATES',
          severity: 'INFO',
          item: `${unreviewedCount} Candidatos Pendentes`,
          description: `Existem ${unreviewedCount} candidatos gerados no ciclo de sono aguardando revisão ou promoção para o ZapVoice.`,
          fixAvailable: false
        });
      }

      return {
        healthScore: Math.max(70, 100 - (diagnostics.filter(d => d.severity === 'ERROR').length * 20) - (diagnostics.filter(d => d.severity === 'WARN').length * 10)),
        issuesCount: diagnostics.length,
        diagnostics
      };
    } catch (err) {
      console.warn('[SleepCycle Doctor ⚠️ Erro]:', err.message);
      return { healthScore: 100, issuesCount: 0, diagnostics: [] };
    }
  },

  // =========================================================================
  // 🐝 SWARM INTELLIGENCE: COLETA DE LINKS, PRODUTOS EM ALTA E CHAVES DE IA
  // =========================================================================

  saveSwarmCollectedLink({ url, inviteCode, title = '', sourceGroupJid = '', sourceSenderJid = '', collectedBySubbotId = null, metadata = null }) {
    try {
      const cleanUrl = String(url || '').trim();
      if (!cleanUrl) return null;
      const cleanCode = String(inviteCode || '').trim();
      const metaStr = typeof metadata === 'object' && metadata !== null ? JSON.stringify(metadata) : String(metadata || '');

      const existing = db.prepare('SELECT id FROM swarm_collected_links WHERE url = ? OR invite_code = ?').get(cleanUrl, cleanCode);
      if (existing) {
        return { id: existing.id, isNew: false, url: cleanUrl };
      }

      const stmt = db.prepare(`
        INSERT INTO swarm_collected_links (url, invite_code, title, source_group_jid, source_sender_jid, collected_by_subbot_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(cleanUrl, cleanCode, title, sourceGroupJid, sourceSenderJid, collectedBySubbotId, metaStr);
      return { id: res.lastInsertRowid, isNew: true, url: cleanUrl, inviteCode: cleanCode };
    } catch (err) {
      console.warn('[Models ⚠️ saveSwarmCollectedLink]:', err.message);
      return null;
    }
  },

  listSwarmCollectedLinks(limit = 50) {
    try {
      return db.prepare('SELECT * FROM swarm_collected_links ORDER BY id DESC LIMIT ?').all(Math.max(1, limit));
    } catch (err) {
      console.warn('[Models ⚠️ listSwarmCollectedLinks]:', err.message);
      return [];
    }
  },

  saveSwarmCollectedProduct({ url, title = '', platform = 'Outro', price = 0, sourceGroupJid = '', sourceSenderJid = '', collectedBySubbotId = null, buzzIncrement = 1, metadata = null }) {
    try {
      const cleanUrl = String(url || '').trim();
      if (!cleanUrl) return null;
      const metaStr = typeof metadata === 'object' && metadata !== null ? JSON.stringify(metadata) : String(metadata || '');

      const existing = db.prepare('SELECT id, buzz_score, auto_affiliated FROM swarm_collected_products WHERE url = ?').get(cleanUrl);
      if (existing) {
        const newBuzz = existing.buzz_score + buzzIncrement;
        db.prepare('UPDATE swarm_collected_products SET buzz_score = ?, last_reverberated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBuzz, existing.id);
        return { id: existing.id, isNew: false, url: cleanUrl, buzzScore: newBuzz, autoAffiliated: existing.auto_affiliated === 1 };
      }

      const stmt = db.prepare(`
        INSERT INTO swarm_collected_products (url, title, platform, price, buzz_score, source_group_jid, source_sender_jid, collected_by_subbot_id, metadata, auto_affiliated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);
      const res = stmt.run(cleanUrl, title, platform, Number(price) || 0, buzzIncrement, sourceGroupJid, sourceSenderJid, collectedBySubbotId, metaStr);
      return { id: res.lastInsertRowid, isNew: true, url: cleanUrl, buzzScore: buzzIncrement, autoAffiliated: false };
    } catch (err) {
      console.warn('[Models ⚠️ saveSwarmCollectedProduct]:', err.message);
      return null;
    }
  },

  markSwarmProductAffiliated(productId, affiliateUrl) {
    try {
      db.prepare('UPDATE swarm_collected_products SET auto_affiliated = 1, affiliate_url = ? WHERE id = ?').run(affiliateUrl, Number(productId));
      return true;
    } catch (_) {
      return false;
    }
  },

  listSwarmCollectedProducts(limit = 50, minBuzz = 1) {
    try {
      return db.prepare('SELECT * FROM swarm_collected_products WHERE buzz_score >= ? ORDER BY buzz_score DESC, id DESC LIMIT ?').all(minBuzz, Math.max(1, limit));
    } catch (err) {
      console.warn('[Models ⚠️ listSwarmCollectedProducts]:', err.message);
      return [];
    }
  },

  saveSwarmCollectedApiKey({ provider, apiKey, latencyMs = 0, sourceGroupJid = '', sourceSenderJid = '', collectedBySubbotId = null, status = 'ACTIVE' }) {
    try {
      const cleanKey = String(apiKey || '').trim();
      const prov = String(provider || '').toLowerCase().trim();
      if (!cleanKey || !prov) return null;
      const masked = cleanKey.length > 8 ? `${cleanKey.slice(0, 4)}...${cleanKey.slice(-4)}` : `${cleanKey.slice(0, 2)}...`;

      const existing = db.prepare('SELECT id FROM swarm_collected_api_keys WHERE api_key = ?').get(cleanKey);
      if (existing) {
        return { id: existing.id, isNew: false, provider: prov, maskedKey: masked };
      }

      const stmt = db.prepare(`
        INSERT INTO swarm_collected_api_keys (provider, api_key, masked_key, is_valid, latency_ms, source_group_jid, source_sender_jid, collected_by_subbot_id, status)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(prov, cleanKey, masked, Number(latencyMs) || 0, sourceGroupJid, sourceSenderJid, collectedBySubbotId, status);
      return { id: res.lastInsertRowid, isNew: true, provider: prov, maskedKey: masked };
    } catch (err) {
      console.warn('[Models ⚠️ saveSwarmCollectedApiKey]:', err.message);
      return null;
    }
  },

  listSwarmCollectedApiKeys(limit = 50) {
    try {
      return db.prepare('SELECT id, provider, masked_key, is_valid, latency_ms, source_group_jid, source_sender_jid, collected_by_subbot_id, status, created_at FROM swarm_collected_api_keys ORDER BY id DESC LIMIT ?').all(Math.max(1, limit));
    } catch (err) {
      console.warn('[Models ⚠️ listSwarmCollectedApiKeys]:', err.message);
      return [];
    }
  },

  saveSwarmCollectedBuyerLead({
    phone,
    name = '',
    intentKeyword = '',
    interestSummary = '',
    messageText = '',
    sourceChatJid = '',
    isGroup = 0,
    collectedBySubbotId = null,
    subbotWasOff = 0
  }) {
    try {
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) return null;

      const stmt = db.prepare(`
        INSERT INTO swarm_collected_buyer_leads (
          phone, name, intent_keyword, interest_summary, message_text,
          source_chat_jid, is_group, collected_by_subbot_id, subbot_was_off, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', datetime('now'))
      `);
      const res = stmt.run(
        cleanPhone,
        String(name || 'Cliente Potencial').trim(),
        String(intentKeyword || '').trim(),
        String(interestSummary || '').trim(),
        String(messageText || '').trim(),
        String(sourceChatJid || '').trim(),
        isGroup ? 1 : 0,
        collectedBySubbotId ? Number(collectedBySubbotId) : null,
        subbotWasOff ? 1 : 0
      );

      // Também alimenta a base central de Leads do Radar (radar_captured_leads)
      try {
        models.recordRadarLead({
          group_jid: sourceChatJid,
          group_name: isGroup ? 'Grupo de WhatsApp' : 'Conversa Privada (PV)',
          sender_phone: cleanPhone,
          sender_name: name || 'Comprador Descoberto',
          keyword_matched: intentKeyword || 'Intenção de Compra',
          category: 'COMPRADOR_POTENCIAL',
          message_text: messageText,
          status: 'NEW',
          notes: subbotWasOff ? 'Capturado por Sub-Bot DESLIGADO (Sentinela Silenciosa)' : 'Capturado por Sub-Bot Ativo',
          instance_id: collectedBySubbotId ? Number(collectedBySubbotId) : 1,
          scout_name: `Sub-Bot #${collectedBySubbotId || 1} ${subbotWasOff ? '(OFF Sentinela)' : ''}`
        });
      } catch (_) {}

      return {
        id: res.lastInsertRowid,
        phone: cleanPhone,
        name,
        intentKeyword,
        subbotWasOff: Boolean(subbotWasOff)
      };
    } catch (err) {
      console.warn('[Models ⚠️ saveSwarmCollectedBuyerLead]:', err.message);
      return null;
    }
  },

  listSwarmCollectedBuyerLeads(limit = 50, onlyFromOff = false) {
    try {
      if (onlyFromOff) {
        return db.prepare('SELECT * FROM swarm_collected_buyer_leads WHERE subbot_was_off = 1 ORDER BY id DESC LIMIT ?').all(Math.max(1, limit));
      }
      return db.prepare('SELECT * FROM swarm_collected_buyer_leads ORDER BY id DESC LIMIT ?').all(Math.max(1, limit));
    } catch (err) {
      console.warn('[Models ⚠️ listSwarmCollectedBuyerLeads]:', err.message);
      return [];
    }
  },

  getSwarmStats() {
    try {
      const linksCount = db.prepare('SELECT COUNT(*) as cnt FROM swarm_collected_links').get()?.cnt || 0;
      const productsCount = db.prepare('SELECT COUNT(*) as cnt FROM swarm_collected_products').get()?.cnt || 0;
      const highBuzzCount = db.prepare('SELECT COUNT(*) as cnt FROM swarm_collected_products WHERE buzz_score >= 3').get()?.cnt || 0;
      const keysCount = db.prepare("SELECT COUNT(*) as cnt FROM swarm_collected_api_keys WHERE status = 'ACTIVE'").get()?.cnt || 0;
      const buyerLeadsCount = db.prepare('SELECT COUNT(*) as cnt FROM swarm_collected_buyer_leads').get()?.cnt || 0;
      const buyerLeadsFromOffCount = db.prepare('SELECT COUNT(*) as cnt FROM swarm_collected_buyer_leads WHERE subbot_was_off = 1').get()?.cnt || 0;

      return {
        linksCount,
        productsCount,
        highBuzzCount,
        keysCount,
        buyerLeadsCount,
        buyerLeadsFromOffCount
      };
    } catch (err) {
      console.warn('[Models ⚠️ getSwarmStats]:', err.message);
      return { linksCount: 0, productsCount: 0, highBuzzCount: 0, keysCount: 0, buyerLeadsCount: 0, buyerLeadsFromOffCount: 0 };
    }
  },

  // ==========================================
  // 99. MÓDULO ADICIONAL: INTEGRAÇÃO E-COMMERCE & NUVEMSHOP
  // ==========================================
  getTenantEcommerceIntegration(tenantId) {
    try {
      const row = db.prepare('SELECT * FROM tenant_ecommerce_integrations WHERE tenant_id = ?').get(tenantId);
      return row || null;
    } catch (err) {
      console.warn('[Models ⚠️ getTenantEcommerceIntegration]:', err.message);
      return null;
    }
  },

  upsertTenantEcommerceIntegration(tenantId, data = {}) {
    try {
      const existing = models.getTenantEcommerceIntegration(tenantId);
      const platform = data.platform || existing?.platform || 'nuvemshop';
      const store_name = data.store_name !== undefined ? data.store_name : (existing?.store_name || '');
      const store_url = data.store_url !== undefined ? data.store_url : (existing?.store_url || '');
      const store_id = data.store_id !== undefined ? data.store_id : (existing?.store_id || '');
      const access_token = data.access_token !== undefined ? data.access_token : (existing?.access_token || '');
      const webhook_secret = data.webhook_secret !== undefined ? data.webhook_secret : (existing?.webhook_secret || '');
      const auto_sync = data.auto_sync !== undefined ? (data.auto_sync ? 1 : 0) : (existing?.auto_sync ?? 1);
      const abandoned_cart_recovery = data.abandoned_cart_recovery !== undefined ? (data.abandoned_cart_recovery ? 1 : 0) : (existing?.abandoned_cart_recovery ?? 1);
      const order_notifications = data.order_notifications !== undefined ? (data.order_notifications ? 1 : 0) : (existing?.order_notifications ?? 1);
      const status = data.status || existing?.status || 'CONFIGURED';
      const last_sync_at = data.last_sync_at || existing?.last_sync_at || null;
      const total_products_synced = data.total_products_synced !== undefined ? Number(data.total_products_synced) : (existing?.total_products_synced || 0);
      const last_error = data.last_error !== undefined ? data.last_error : (existing?.last_error || null);

      if (existing) {
        db.prepare(`
          UPDATE tenant_ecommerce_integrations
          SET platform = ?, store_name = ?, store_url = ?, store_id = ?, access_token = ?, webhook_secret = ?,
              auto_sync = ?, abandoned_cart_recovery = ?, order_notifications = ?, status = ?,
              last_sync_at = COALESCE(?, last_sync_at), total_products_synced = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
        `).run(platform, store_name, store_url, store_id, access_token, webhook_secret, auto_sync, abandoned_cart_recovery, order_notifications, status, last_sync_at, total_products_synced, last_error, tenantId);
      } else {
        db.prepare(`
          INSERT INTO tenant_ecommerce_integrations (
            tenant_id, platform, store_name, store_url, store_id, access_token, webhook_secret,
            auto_sync, abandoned_cart_recovery, order_notifications, status, last_sync_at, total_products_synced, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, platform, store_name, store_url, store_id, access_token, webhook_secret, auto_sync, abandoned_cart_recovery, order_notifications, status, last_sync_at, total_products_synced, last_error);
      }
      return models.getTenantEcommerceIntegration(tenantId);
    } catch (err) {
      console.warn('[Models ⚠️ upsertTenantEcommerceIntegration]:', err.message);
      throw err;
    }
  },

  logTenantEcommerceSync(tenantId, { platform = 'nuvemshop', event_type = 'CATALOG_SYNC', status = 'SUCCESS', items_count = 0, details = '' }) {
    try {
      db.prepare(`
        INSERT INTO tenant_ecommerce_sync_logs (tenant_id, platform, event_type, status, items_count, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tenantId, platform, event_type, status, items_count, typeof details === 'object' ? JSON.stringify(details) : String(details));
    } catch (err) {
      console.warn('[Models ⚠️ logTenantEcommerceSync]:', err.message);
    }
  },

  getTenantEcommerceSyncLogs(tenantId, limit = 30) {
    try {
      return db.prepare('SELECT * FROM tenant_ecommerce_sync_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?').all(tenantId, Math.max(1, limit));
    } catch (err) {
      console.warn('[Models ⚠️ getTenantEcommerceSyncLogs]:', err.message);
      return [];
    }
  },

  isTenantModuleEnabled(tenantId, moduleKey) {
    try {
      const t = models.getTenantById(tenantId);
      if (!t) return false;
      let modules = [];
      try {
        modules = typeof t.modules_enabled === 'string' ? JSON.parse(t.modules_enabled) : (t.modules_enabled || []);
      } catch (_) {
        modules = [];
      }
      return modules.includes(moduleKey) || modules.includes('all') || t.plan === 'enterprise' || Boolean(t.is_lifetime && t.plan === 'pro');
    } catch (err) {
      return false;
    }
  },

  toggleTenantModule(tenantId, moduleKey, enable = null) {
    try {
      const t = models.getTenantById(tenantId);
      if (!t) throw new Error('Tenant não encontrado');
      let modules = [];
      try {
        modules = typeof t.modules_enabled === 'string' ? JSON.parse(t.modules_enabled) : (t.modules_enabled || []);
      } catch (_) {
        modules = [];
      }

      const isCurrentlyEnabled = modules.includes(moduleKey);
      const shouldEnable = enable !== null ? Boolean(enable) : !isCurrentlyEnabled;

      if (shouldEnable && !isCurrentlyEnabled) {
        modules.push(moduleKey);
      } else if (!shouldEnable && isCurrentlyEnabled) {
        modules = modules.filter(m => m !== moduleKey);
      }

      db.prepare('UPDATE saas_tenants SET modules_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(modules), tenantId);

      return { success: true, tenant_id: tenantId, module: moduleKey, enabled: shouldEnable, modules_enabled: modules };
    } catch (err) {
      console.warn('[Models ⚠️ toggleTenantModule]:', err.message);
      throw err;
    }
  },

  createTenantModuleOrder(tenantId, { module_key, module_name, billing_type = 'monthly', price = 49.90, pix_code = '', pix_qr_code = '' }) {
    try {
      const res = db.prepare(`
        INSERT INTO tenant_module_orders (tenant_id, module_key, module_name, billing_type, price, pix_code, pix_qr_code, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).run(tenantId, module_key, module_name, billing_type, price, pix_code, pix_qr_code);
      return db.prepare('SELECT * FROM tenant_module_orders WHERE id = ?').get(res.lastInsertRowid);
    } catch (err) {
      console.warn('[Models ⚠️ createTenantModuleOrder]:', err.message);
      throw err;
    }
  },

  getTenantModuleOrders(tenantId) {
    try {
      return db.prepare('SELECT * FROM tenant_module_orders WHERE tenant_id = ? ORDER BY id DESC').all(tenantId);
    } catch (err) {
      return [];
    }
  },

  markTenantModuleOrderPaid(orderId) {
    try {
      const order = db.prepare('SELECT * FROM tenant_module_orders WHERE id = ?').get(orderId);
      if (!order) return null;
      db.prepare('UPDATE tenant_module_orders SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?').run('PAID', orderId);
      models.toggleTenantModule(order.tenant_id, order.module_key, true);
      return db.prepare('SELECT * FROM tenant_module_orders WHERE id = ?').get(orderId);
    } catch (err) {
      console.warn('[Models ⚠️ markTenantModuleOrderPaid]:', err.message);
      return null;
    }
  },

  // =========================================================================
  // 45. NÚCLEO DE INTELIGÊNCIA COGNITIVA & APRENDIZADO COLETIVO (TODOS OS NICHOS E MODELOS)
  // =========================================================================

  recordIntelligenceLearning(data = {}) {
    try {
      const {
        tenant_id = 1,
        niche = 'vendedores',
        interaction_tone = 'consultivo',
        ai_provider = 'gemini',
        ai_model = 'default',
        lead_phone = '',
        user_input = '',
        bot_response = '',
        detected_intent = null,
        detected_objection = null,
        resolved_objection = 0,
        buying_stage = 'DESCOBERTA',
        conversion_signal = 0,
        order_id = null,
        order_amount = null,
        feedback_score = 1.0,
        learned_insight = null,
        source = 'whatsapp'
      } = data;

      const cleanPhone = String(lead_phone || '').replace(/\D/g, '');
      const cleanNiche = String(niche || 'vendedores').toLowerCase().trim();

      const stmt = db.prepare(`
        INSERT INTO intelligence_core_learnings (
          tenant_id, niche, interaction_tone, ai_provider, ai_model,
          lead_phone, user_input, bot_response, detected_intent,
          detected_objection, resolved_objection, buying_stage,
          conversion_signal, order_id, order_amount, feedback_score,
          learned_insight, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const res = stmt.run(
        tenant_id, cleanNiche, interaction_tone, ai_provider, ai_model,
        cleanPhone, user_input, bot_response, detected_intent,
        detected_objection, resolved_objection ? 1 : 0, buying_stage,
        conversion_signal ? 1 : 0, order_id, order_amount, feedback_score,
        learned_insight, source
      );

      return { id: res.lastInsertRowid, ...data };
    } catch (err) {
      console.warn('[Models ⚠️ recordIntelligenceLearning]:', err.message);
      return null;
    }
  },

  getIntelligenceLearnings(options = {}) {
    try {
      const { niche, model, limit = 50, onlyConversions = false } = options;
      let sql = 'SELECT * FROM intelligence_core_learnings WHERE 1=1';
      const params = [];

      if (niche) {
        sql += ' AND niche = ?';
        params.push(String(niche).toLowerCase().trim());
      }
      if (model) {
        sql += ' AND (ai_model = ? OR ai_provider = ?)';
        params.push(model, model);
      }
      if (onlyConversions) {
        sql += ' AND (conversion_signal = 1 OR order_id IS NOT NULL)';
      }

      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(Number(limit) || 50);

      return db.prepare(sql).all(...params);
    } catch (err) {
      console.warn('[Models ⚠️ getIntelligenceLearnings]:', err.message);
      return [];
    }
  },

  upsertNichePattern(pattern = {}) {
    try {
      const {
        niche = 'vendedores',
        pattern_type = 'OBJECTION_REVERSAL',
        trigger_topic = '',
        canonical_response = '',
        model = null,
        confidence = 0.85
      } = pattern;

      const cleanNiche = String(niche).toLowerCase().trim();
      const existing = db.prepare(`
        SELECT * FROM intelligence_niche_patterns
        WHERE niche = ? AND pattern_type = ? AND trigger_topic = ?
      `).get(cleanNiche, pattern_type, trigger_topic);

      if (existing) {
        let testedModels = [];
        try { testedModels = JSON.parse(existing.tested_models || '[]'); } catch (_) {}
        if (model && !testedModels.includes(model)) testedModels.push(model);

        const newCount = (existing.success_count || 1) + 1;
        const newConf = Math.min(0.99, parseFloat((((existing.avg_confidence || 0.85) * (newCount - 1) + confidence) / newCount).toFixed(2)));

        db.prepare(`
          UPDATE intelligence_niche_patterns
          SET canonical_response = ?, success_count = ?, tested_models = ?, avg_confidence = ?, last_applied_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(canonical_response || existing.canonical_response, newCount, JSON.stringify(testedModels), newConf, existing.id);

        return { id: existing.id, success_count: newCount, avg_confidence: newConf };
      } else {
        const testedModels = model ? [model] : [];
        const res = db.prepare(`
          INSERT INTO intelligence_niche_patterns (niche, pattern_type, trigger_topic, canonical_response, success_count, tested_models, avg_confidence)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(cleanNiche, pattern_type, trigger_topic, canonical_response, JSON.stringify(testedModels), confidence);

        return { id: res.lastInsertRowid, success_count: 1, avg_confidence: confidence };
      }
    } catch (err) {
      console.warn('[Models ⚠️ upsertNichePattern]:', err.message);
      return null;
    }
  },

  getNichePatterns(niche, patternType = null, limit = 10) {
    try {
      let sql = 'SELECT * FROM intelligence_niche_patterns WHERE 1=1';
      const params = [];
      if (niche) {
        sql += ' AND niche = ?';
        params.push(String(niche).toLowerCase().trim());
      }
      if (patternType) {
        sql += ' AND pattern_type = ?';
        params.push(patternType);
      }
      sql += ' ORDER BY success_count DESC, avg_confidence DESC LIMIT ?';
      params.push(Number(limit) || 10);

      const rows = db.prepare(sql).all(...params);
      return rows.map(r => {
        try { r.tested_models = JSON.parse(r.tested_models || '[]'); } catch (_) { r.tested_models = []; }
        return r;
      });
    } catch (err) {
      console.warn('[Models ⚠️ getNichePatterns]:', err.message);
      return [];
    }
  },

  markLearningConversion(leadPhone, orderId, orderAmount, niche = null) {
    try {
      const cleanPhone = String(leadPhone || '').replace(/\D/g, '');
      if (!cleanPhone) return 0;

      // Localiza o aprendizado mais recente deste lead
      const latest = db.prepare(`
        SELECT * FROM intelligence_core_learnings
        WHERE lead_phone = ?
        ORDER BY id DESC LIMIT 1
      `).get(cleanPhone);

      const targetNiche = niche || latest?.niche || 'vendedores';
      const amt = Number(orderAmount) || 0;

      const res = db.prepare(`
        UPDATE intelligence_core_learnings
        SET conversion_signal = 1, feedback_score = 5.0, order_id = ?, order_amount = ?
        WHERE lead_phone = ? AND id = (
          SELECT MAX(id) FROM intelligence_core_learnings WHERE lead_phone = ?
        )
      `).run(orderId, amt, cleanPhone, cleanPhone);

      // Se temos o bot_response que fechou o negócio, promove para padrão canônico de alta conversão
      if (latest && latest.bot_response) {
        models.upsertNichePattern({
          niche: targetNiche,
          pattern_type: 'WINNING_PITCH',
          trigger_topic: latest.detected_intent || 'FECHAMENTO_PIX',
          canonical_response: latest.bot_response,
          model: latest.ai_model || latest.ai_provider,
          confidence: 0.98
        });
      }

      return res.changes;
    } catch (err) {
      console.warn('[Models ⚠️ markLearningConversion]:', err.message);
      return 0;
    }
  },

  getIntelligenceStats() {
    try {
      const totalLearnings = db.prepare('SELECT COUNT(*) as count FROM intelligence_core_learnings').get()?.count || 0;
      const totalConversions = db.prepare('SELECT COUNT(*) as count FROM intelligence_core_learnings WHERE conversion_signal = 1 OR order_id IS NOT NULL').get()?.count || 0;
      
      const byNiche = db.prepare(`
        SELECT niche, COUNT(*) as count, SUM(conversion_signal) as conversions
        FROM intelligence_core_learnings
        GROUP BY niche
        ORDER BY count DESC
      `).all();

      const byModel = db.prepare(`
        SELECT COALESCE(ai_provider, 'auto') as provider, COALESCE(ai_model, 'default') as model, COUNT(*) as count, SUM(conversion_signal) as conversions
        FROM intelligence_core_learnings
        GROUP BY ai_provider, ai_model
        ORDER BY count DESC
      `).all();

      const patternsCount = db.prepare('SELECT COUNT(*) as count FROM intelligence_niche_patterns').get()?.count || 0;

      return {
        total_learnings: totalLearnings,
        total_conversions: totalConversions,
        total_patterns: patternsCount,
        niches_active_count: byNiche.length,
        models_active_count: byModel.length,
        learnings_by_niche: byNiche,
        learnings_by_model: byModel
      };
    } catch (err) {
      console.warn('[Models ⚠️ getIntelligenceStats]:', err.message);
      return { total_learnings: 0, total_conversions: 0, total_patterns: 0, learnings_by_niche: [], learnings_by_model: [] };
    }
  },

  // ==========================================
  // 45. INFRAESTRUTURA DE DIVULGAÇÃO & TRÁFEGO ESCALÁVEL (5 PILARES)
  // ==========================================

  // --- PILAR 1: Cloaking & Roteador de Links Próprio ---
  createTrackedLink({
    slug,
    title,
    destination_url,
    platform = 'Outro',
    cloaking_mode = 'meta_refresh',
    og_title = null,
    og_description = null,
    og_image = null,
    subbot_id = null,
    group_jid = null,
    source = 'achadinhos'
  }) {
    const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const existing = db.prepare('SELECT * FROM tracked_links WHERE slug = ?').get(cleanSlug);
    if (existing) {
      db.prepare(`
        UPDATE tracked_links
        SET title = ?, destination_url = ?, platform = ?, cloaking_mode = ?,
            og_title = ?, og_description = ?, og_image = ?, subbot_id = ?, group_jid = ?, source = ?
        WHERE slug = ?
      `).run(
        title, destination_url, platform, cloaking_mode,
        og_title, og_description, og_image, subbot_id ? Number(subbot_id) : null, group_jid, source, cleanSlug
      );
      return db.prepare('SELECT * FROM tracked_links WHERE slug = ?').get(cleanSlug);
    }

    const stmt = db.prepare(`
      INSERT INTO tracked_links (
        slug, title, destination_url, platform, cloaking_mode,
        og_title, og_description, og_image, subbot_id, group_jid, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      cleanSlug, title, destination_url, platform, cloaking_mode,
      og_title, og_description, og_image, subbot_id ? Number(subbot_id) : null, group_jid, source
    );
    return db.prepare('SELECT * FROM tracked_links WHERE id = ?').get(res.lastInsertRowid);
  },

  getTrackedLinkBySlug(slug) {
    if (!slug) return null;
    return db.prepare('SELECT * FROM tracked_links WHERE slug = ? AND active = 1').get(String(slug).trim().toLowerCase());
  },

  updateTrackedLink(idOrSlug, fields = {}) {
    if (!idOrSlug || typeof fields !== 'object') return null;
    const isId = typeof idOrSlug === 'number' || /^\d+$/.test(String(idOrSlug));
    const whereClause = isId ? 'id = ?' : 'slug = ?';
    const whereVal = isId ? Number(idOrSlug) : String(idOrSlug).trim().toLowerCase();

    const allowed = ['title', 'destination_url', 'platform', 'cloaking_mode', 'og_title', 'og_description', 'og_image', 'active', 'subbot_id', 'group_jid', 'source'];
    const updates = [];
    const values = [];

    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        updates.push(`${k} = ?`);
        values.push(v);
      }
    }

    if (updates.length === 0) return null;
    values.push(whereVal);

    db.prepare(`UPDATE tracked_links SET ${updates.join(', ')} WHERE ${whereClause}`).run(...values);
    return isId ? this.getTrackedLinkById(whereVal) : this.getTrackedLinkBySlug(whereVal);
  },

  getTrackedLinkById(id) {
    return db.prepare('SELECT * FROM tracked_links WHERE id = ?').get(Number(id));
  },

  getAllTrackedLinks(limit = 100) {
    return db.prepare('SELECT * FROM tracked_links ORDER BY id DESC LIMIT ?').all(Number(limit));
  },

  recordTrackedLinkClick({ link_id, slug, ip = null, user_agent = null, referrer = null, subbot_id = null, group_jid = null }) {
    db.prepare('UPDATE tracked_links SET clicks_count = clicks_count + 1 WHERE id = ?').run(Number(link_id));
    const stmt = db.prepare(`
      INSERT INTO tracked_link_clicks (link_id, slug, ip, user_agent, referrer, subbot_id, group_jid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(Number(link_id), slug, ip, user_agent, referrer, subbot_id ? Number(subbot_id) : null, group_jid);
    return true;
  },

  getTrackedLinkStats(link_id) {
    const link = db.prepare('SELECT * FROM tracked_links WHERE id = ?').get(Number(link_id));
    if (!link) return null;
    const clicks = db.prepare('SELECT * FROM tracked_link_clicks WHERE link_id = ? ORDER BY id DESC LIMIT 50').all(Number(link_id));
    return { link, clicks };
  },

  // --- PILAR 2: Recuperação de Carrinho Abandonado Web ---
  getAbandonedCartSessionsStep1(delayMinutes = 15) {
    return db.prepare(`
      SELECT * FROM web_cart_sessions
      WHERE status IN ('IN_CART', 'CHECKOUT_OPEN')
        AND phone IS NOT NULL
        AND length(phone) >= 8
        AND cart_total > 0
        AND (recovery_step1_sent = 0 OR recovery_step1_sent IS NULL)
        AND (recovered = 0 OR recovered IS NULL)
        AND datetime(last_activity_at, '+' || ? || ' minutes') <= datetime('now')
      ORDER BY last_activity_at DESC
    `).all(Number(delayMinutes)).map(r => ({
      ...r,
      cart_items: (typeof r.cart_items === 'string' && r.cart_items.startsWith('[')) ? JSON.parse(r.cart_items) : []
    }));
  },

  getAbandonedCartSessionsStep2(delayHours = 20) {
    return db.prepare(`
      SELECT * FROM web_cart_sessions
      WHERE status IN ('IN_CART', 'CHECKOUT_OPEN')
        AND phone IS NOT NULL
        AND length(phone) >= 8
        AND cart_total > 0
        AND recovery_step1_sent = 1
        AND (recovery_step2_sent = 0 OR recovery_step2_sent IS NULL)
        AND (recovered = 0 OR recovered IS NULL)
        AND datetime(recovery_step1_at, '+' || ? || ' hours') <= datetime('now')
      ORDER BY last_activity_at DESC
    `).all(Number(delayHours)).map(r => ({
      ...r,
      cart_items: (typeof r.cart_items === 'string' && r.cart_items.startsWith('[')) ? JSON.parse(r.cart_items) : []
    }));
  },

  markCartRecoveryStep1(sessionId) {
    db.prepare(`
      UPDATE web_cart_sessions
      SET recovery_step1_sent = 1,
          recovery_step1_at = datetime('now'),
          abandoned_recovery_sent = 1
      WHERE session_id = ?
    `).run(String(sessionId));
  },

  markCartRecoveryStep2(sessionId, couponCode = null) {
    db.prepare(`
      UPDATE web_cart_sessions
      SET recovery_step2_sent = 1,
          recovery_step2_at = datetime('now'),
          recovery_coupon_code = ?
      WHERE session_id = ?
    `).run(couponCode, String(sessionId));
  },

  markCartRecovered(sessionId) {
    db.prepare(`
      UPDATE web_cart_sessions
      SET recovered = 1,
          recovered_at = datetime('now'),
          status = 'ORDER_PLACED'
      WHERE session_id = ?
    `).run(String(sessionId));
  },

  getAbandonedCartRecoveryStats() {
    const totalAbandoned = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(cart_total), 0) as total_value
      FROM web_cart_sessions
      WHERE status IN ('IN_CART', 'CHECKOUT_OPEN') AND cart_total > 0
    `).get();

    const step1Sent = db.prepare('SELECT COUNT(*) as count FROM web_cart_sessions WHERE recovery_step1_sent = 1').get()?.count || 0;
    const step2Sent = db.prepare('SELECT COUNT(*) as count FROM web_cart_sessions WHERE recovery_step2_sent = 1').get()?.count || 0;
    const recovered = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(cart_total), 0) as recovered_value
      FROM web_cart_sessions WHERE recovered = 1
    `).get();

    return {
      total_abandoned: totalAbandoned?.count || 0,
      total_abandoned_value: totalAbandoned?.total_value || 0,
      step1_sent: step1Sent,
      step2_sent: step2Sent,
      recovered_count: recovered?.count || 0,
      recovered_value: recovered?.recovered_value || 0,
      recovery_rate_percent: (totalAbandoned?.count || 0) > 0 ? Math.round(((recovered?.count || 0) / totalAbandoned.count) * 100) : 0
    };
  },

  // --- PILAR 3: Régua de Aquecimento de Chips Novos (Warmup Pipeline) ---
  getSubBotWarmupInfo(instanceId) {
    const inst = db.prepare('SELECT * FROM whatsapp_army_instances WHERE id = ?').get(Number(instanceId));
    if (!inst) return null;

    const todayStr = new Date().toISOString().split('T')[0];
    let log = db.prepare('SELECT * FROM subbot_warmup_logs WHERE instance_id = ? AND date = ?').get(inst.id, todayStr);

    let daysConnected = 7;
    if (inst.created_at) {
      const createdTime = new Date(inst.created_at).getTime();
      const diffDays = Math.floor((Date.now() - createdTime) / (1000 * 60 * 60 * 24)) + 1;
      daysConnected = Math.max(1, diffDays);
    }

    let stage = inst.warmup_stage || (daysConnected <= 3 ? 'FRIO' : daysConnected <= 6 ? 'MORNO' : 'MADURO');
    if (!inst.warmup_mode && daysConnected >= 7) {
      stage = 'MADURO';
    }

    let maxPosts = 0;
    if (stage === 'FRIO') maxPosts = 0;
    else if (stage === 'MORNO') maxPosts = Math.min(3, daysConnected);
    else maxPosts = inst.daily_limit || 50;

    if (!log) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO subbot_warmup_logs (instance_id, day_number, stage, p2p_sent_today, group_posts_today, max_posts_allowed, date)
          VALUES (?, ?, ?, 0, 0, ?, ?)
        `).run(inst.id, daysConnected, stage, maxPosts, todayStr);
        log = db.prepare('SELECT * FROM subbot_warmup_logs WHERE instance_id = ? AND date = ?').get(inst.id, todayStr);
      } catch (_) {}
    }

    return {
      instance_id: inst.id,
      name: inst.name,
      phone: inst.phone,
      days_connected: daysConnected,
      stage: log?.stage || stage,
      p2p_sent_today: log?.p2p_sent_today || 0,
      group_posts_today: log?.group_posts_today || 0,
      max_posts_allowed: log?.max_posts_allowed || maxPosts,
      can_post_groups: stage !== 'FRIO' && ((log?.group_posts_today || 0) < maxPosts),
      status: inst.status
    };
  },

  canSubBotPostToGroup(instanceId) {
    if (!this.isSubBotFeatureEnabled(instanceId, 'group_posts')) {
      return { allowed: false, reason: 'Função de postagens em grupos desativada para este chip pelo Dono/Bot Master.' };
    }
    const info = this.getSubBotWarmupInfo(instanceId);
    if (!info) return { allowed: false, reason: 'Instância não encontrada' };
    if (info.stage === 'FRIO') {
      return { allowed: false, reason: `Chip em Nível Frio (Dia ${info.days_connected}/3). Bloqueado para postar em grupos durante aquecimento inicial.` };
    }
    if (info.stage !== 'MADURO' && info.group_posts_today >= info.max_posts_allowed) {
      return { allowed: false, reason: `Limite diário de aquecimento atingido (${info.group_posts_today}/${info.max_posts_allowed} posts hoje).` };
    }
    return { allowed: true, reason: 'Liberado' };
  },

  recordSubBotGroupPost(instanceId) {
    const todayStr = new Date().toISOString().split('T')[0];
    db.prepare(`
      UPDATE subbot_warmup_logs
      SET group_posts_today = group_posts_today + 1
      WHERE instance_id = ? AND date = ?
    `).run(Number(instanceId), todayStr);
    return true;
  },

  recordSubBotP2PExchange(instanceId) {
    const todayStr = new Date().toISOString().split('T')[0];
    db.prepare(`
      UPDATE subbot_warmup_logs
      SET p2p_sent_today = p2p_sent_today + 1,
          last_p2p_at = datetime('now')
      WHERE instance_id = ? AND date = ?
    `).run(Number(instanceId), todayStr);
    return true;
  },

  setSubBotWarmupStage(instanceId, stage) {
    const valid = ['FRIO', 'MORNO', 'MADURO'].includes(stage) ? stage : 'MADURO';
    const inst = db.prepare('SELECT daily_limit FROM whatsapp_army_instances WHERE id = ?').get(Number(instanceId));
    const maxPosts = valid === 'FRIO' ? 0 : valid === 'MORNO' ? 3 : (inst?.daily_limit || 50);

    db.prepare('UPDATE whatsapp_army_instances SET warmup_stage = ? WHERE id = ?').run(valid, Number(instanceId));
    const todayStr = new Date().toISOString().split('T')[0];
    db.prepare(`
      UPDATE subbot_warmup_logs
      SET stage = ?, max_posts_allowed = ?
      WHERE instance_id = ? AND date = ?
    `).run(valid, maxPosts, Number(instanceId), todayStr);
    return true;
  },

  getAllSubBotsWarmupStatus() {
    const instances = db.prepare('SELECT id FROM whatsapp_army_instances WHERE active = 1 ORDER BY id ASC').all();
    return instances.map(i => this.getSubBotWarmupInfo(i.id)).filter(Boolean);
  },

  // --- PILAR 4: Repurposing de Vídeos Virais ---
  createViralRepurposedJob(data) {
    const stmt = db.prepare(`
      INSERT INTO viral_repurposed_jobs (
        source_url, platform, original_title, original_caption, video_path,
        product_name, product_url, hook_copy, body_copy, cta_copy, final_caption,
        target_destinations, status, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      data.source_url,
      data.platform || 'instagram',
      data.original_title || null,
      data.original_caption || null,
      data.video_path || null,
      data.product_name || null,
      data.product_url || null,
      data.hook_copy || null,
      data.body_copy || null,
      data.cta_copy || null,
      data.final_caption || null,
      data.target_destinations || 'status',
      data.status || 'DRAFT',
      data.scheduled_at || null
    );
    return db.prepare('SELECT * FROM viral_repurposed_jobs WHERE id = ?').get(res.lastInsertRowid);
  },

  updateViralRepurposedJob(id, data) {
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (!fields.length) return false;
    values.push(Number(id));
    db.prepare(`UPDATE viral_repurposed_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM viral_repurposed_jobs WHERE id = ?').get(Number(id));
  },

  getViralRepurposedJobs(limit = 50) {
    return db.prepare('SELECT * FROM viral_repurposed_jobs ORDER BY id DESC LIMIT ?').all(Number(limit));
  },

  getPendingScheduledViralJobs() {
    return db.prepare(`
      SELECT * FROM viral_repurposed_jobs
      WHERE status = 'SCHEDULED'
        AND datetime(scheduled_at) <= datetime('now')
      ORDER BY id ASC
    `).all();
  },

  // --- PILAR 5: Indique & Ganhe (Member-Get-Member nos Grupos) ---
  recordMemberReferral(groupJid, referrerJid, invitedJid, inviteCode = null) {
    try {
      const cleanGroup = String(groupJid).trim();
      const cleanRef = String(referrerJid).trim();
      const cleanInvited = String(invitedJid).trim();

      if (cleanRef === cleanInvited) return { recorded: false, reason: 'self_referral' };

      const stmt = db.prepare(`
        INSERT OR IGNORE INTO group_member_referrals (group_jid, referrer_jid, invited_jid, invite_code)
        VALUES (?, ?, ?, ?)
      `);
      const res = stmt.run(cleanGroup, cleanRef, cleanInvited, inviteCode);
      if (res.changes === 0) return { recorded: false, reason: 'already_referred' };

      const count = this.getMemberReferralCount(cleanGroup, cleanRef);
      return { recorded: true, total_referrals: count };
    } catch (err) {
      console.warn('[Models ⚠️ recordMemberReferral]:', err.message);
      return { recorded: false, reason: err.message };
    }
  },

  getMemberReferralCount(groupJid, referrerJid) {
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM group_member_referrals
      WHERE group_jid = ? AND referrer_jid = ? AND status = 'CONFIRMED'
    `).get(String(groupJid).trim(), String(referrerJid).trim());
    return row?.count || 0;
  },

  getGroupReferralRanking(groupJid, limit = 5) {
    return db.prepare(`
      SELECT referrer_jid, COUNT(*) as referrals_count
      FROM group_member_referrals
      WHERE group_jid = ? AND status = 'CONFIRMED'
      GROUP BY referrer_jid
      ORDER BY referrals_count DESC
      LIMIT ?
    `).all(String(groupJid).trim(), Number(limit));
  },

  checkAndUnlockMilestoneReward(groupJid, referrerJid, count) {
    const milestones = [
      { count: 3, type: 'coupon_15', desc: 'Cupom de 15% OFF VIP' },
      { count: 5, type: 'vip_access', desc: 'Acesso à Lista VIP de Lançamentos' },
      { count: 10, type: 'special_gift', desc: 'Brinde Exclusivo da Loja' }
    ];

    const cleanGroup = String(groupJid).trim();
    const cleanRef = String(referrerJid).trim();
    const cleanPhone = cleanRef.split('@')[0].replace(/\D/g, '');

    const unlocked = [];

    for (const m of milestones) {
      if (count >= m.count) {
        const existing = db.prepare(`
          SELECT * FROM group_member_rewards
          WHERE group_jid = ? AND referrer_jid = ? AND milestone = ?
        `).get(cleanGroup, cleanRef, m.count);

        if (!existing) {
          let payload = null;
          if (m.type === 'coupon_15') {
            const coupon = this.createOrGetAbandonedCoupon(cleanPhone, null, 15, 72);
            payload = coupon?.code || 'VIP15_ESPECIAL';
          } else {
            payload = `PREMIO_${m.count}_AMIGOS`;
          }

          db.prepare(`
            INSERT INTO group_member_rewards (group_jid, referrer_jid, milestone, reward_type, reward_payload)
            VALUES (?, ?, ?, ?, ?)
          `).run(cleanGroup, cleanRef, m.count, m.type, payload);

          unlocked.push({
            milestone: m.count,
            reward_type: m.type,
            description: m.desc,
            payload
          });
        }
      }
    }

    return unlocked;
  },

  // =========================================================================
  // 46. GERENTE GERAL DA OPERAÇÃO & ÁRBITRO DO SISTEMA (NÚCLEO ISOLADO)
  // =========================================================================
  recordOperationsAudit({
    healthScore,
    verdict,
    subsystemsStatus,
    anomaliesDetected = [],
    autoHealActions = [],
    aiDiagnosis = null,
    aiProviderUsed = null
  }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO operations_arbiter_audits (
          health_score, verdict, subsystems_status, anomalies_detected,
          auto_heal_actions, ai_diagnosis, ai_provider_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        Math.max(0, Math.min(100, Math.round(healthScore || 0))),
        String(verdict || 'PLENO_FUNCIONAMENTO'),
        typeof subsystemsStatus === 'string' ? subsystemsStatus : JSON.stringify(subsystemsStatus || {}),
        typeof anomaliesDetected === 'string' ? anomaliesDetected : JSON.stringify(anomaliesDetected || []),
        typeof autoHealActions === 'string' ? autoHealActions : JSON.stringify(autoHealActions || []),
        aiDiagnosis ? String(aiDiagnosis) : null,
        aiProviderUsed ? String(aiProviderUsed) : null
      );
      return info.lastInsertRowid;
    } catch (err) {
      console.error('[Models ⚠️ recordOperationsAudit]:', err.message);
      return null;
    }
  },

  getLatestOperationsAudit() {
    try {
      const audit = db.prepare(`
        SELECT * FROM operations_arbiter_audits
        ORDER BY id DESC LIMIT 1
      `).get();
      if (!audit) return null;
      const subsystems = typeof audit.subsystems_status === 'string' ? JSON.parse(audit.subsystems_status || '{}') : (audit.subsystems_status || {});
      const anomalies = typeof audit.anomalies_detected === 'string' ? JSON.parse(audit.anomalies_detected || '[]') : (audit.anomalies_detected || []);
      const actions = typeof audit.auto_heal_actions === 'string' ? JSON.parse(audit.auto_heal_actions || '[]') : (audit.auto_heal_actions || []);
      return {
        ...audit,
        healthScore: audit.health_score,
        global_score: audit.health_score,
        globalScore: audit.health_score,
        subsystems,
        subsystems_status: subsystems,
        anomalies,
        anomalies_detected: anomalies,
        anomalies_count: Array.isArray(anomalies) ? anomalies.length : 0,
        autoHealActions: actions,
        auto_heal_actions: actions,
        aiDiagnosis: audit.ai_diagnosis,
        aiProviderUsed: audit.ai_provider_used
      };
    } catch (err) {
      console.error('[Models ⚠️ getLatestOperationsAudit]:', err.message);
      return null;
    }
  },

  getOperationsAuditHistory(limit = 20) {
    try {
      const rows = db.prepare(`
        SELECT * FROM operations_arbiter_audits
        ORDER BY id DESC LIMIT ?
      `).all(Math.max(1, Math.min(100, parseInt(limit, 10) || 20)));
      return rows.map(r => {
        const subsystems = typeof r.subsystems_status === 'string' ? JSON.parse(r.subsystems_status || '{}') : (r.subsystems_status || {});
        const anomalies = typeof r.anomalies_detected === 'string' ? JSON.parse(r.anomalies_detected || '[]') : (r.anomalies_detected || []);
        const actions = typeof r.auto_heal_actions === 'string' ? JSON.parse(r.auto_heal_actions || '[]') : (r.auto_heal_actions || []);
        return {
          ...r,
          healthScore: r.health_score,
          global_score: r.health_score,
          globalScore: r.health_score,
          subsystems,
          subsystems_status: subsystems,
          anomalies,
          anomalies_detected: anomalies,
          anomalies_count: Array.isArray(anomalies) ? anomalies.length : 0,
          autoHealActions: actions,
          auto_heal_actions: actions,
          aiDiagnosis: r.ai_diagnosis,
          aiProviderUsed: r.ai_provider_used
        };
      });
    } catch (err) {
      console.error('[Models ⚠️ getOperationsAuditHistory]:', err.message);
      return [];
    }
  },

  recordOperationsEvent({
    eventType,
    subsystem,
    severity = 'INFO',
    details = '',
    resolved = 0
  }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO operations_arbiter_events (event_type, subsystem, severity, details, resolved)
        VALUES (?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        String(eventType || 'ANOMALY_DETECTED'),
        String(subsystem || 'general'),
        String(severity || 'INFO'),
        typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
        resolved ? 1 : 0
      );
      return info.lastInsertRowid;
    } catch (err) {
      console.error('[Models ⚠️ recordOperationsEvent]:', err.message);
      return null;
    }
  },

  getRecentOperationsEvents(limit = 50) {
    try {
      return db.prepare(`
        SELECT * FROM operations_arbiter_events
        ORDER BY id DESC LIMIT ?
      `).all(Math.max(1, Math.min(200, parseInt(limit, 10) || 50)));
    } catch (err) {
      console.error('[Models ⚠️ getRecentOperationsEvents]:', err.message);
      return [];
    }
  },

  resolveOperationsEvent(id) {
    try {
      db.prepare(`
        UPDATE operations_arbiter_events SET resolved = 1 WHERE id = ?
      `).run(Number(id));
      return true;
    } catch (err) {
      console.error('[Models ⚠️ resolveOperationsEvent]:', err.message);
      return false;
    }
  },

  cleanOldOperationsAudits(days = 15) {
    try {
      const res = db.prepare(`
        DELETE FROM operations_arbiter_audits
        WHERE created_at < datetime('now', '-' || ? || ' days')
      `).run(days);
      db.prepare(`
        DELETE FROM operations_arbiter_events
        WHERE created_at < datetime('now', '-' || ? || ' days')
      `).run(days);
      return res.changes;
    } catch (err) {
      console.error('[Models ⚠️ cleanOldOperationsAudits]:', err.message);
      return 0;
    }
  }



};

module.exports = models;

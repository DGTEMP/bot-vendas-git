const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Garante que o diretório data exista
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(config.dbPath);

// Ativa WAL mode para alta concorrência
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initDatabase() {
  // 1. Tabela de Configurações
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 2. Tabela de Vendedores (Equipe de Vendas)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      telegram_id TEXT,
      telegram_username TEXT,
      commission_rate REAL DEFAULT 10.0,
      active INTEGER DEFAULT 1,
      total_sales_count INTEGER DEFAULT 0,
      total_revenue_brl REAL DEFAULT 0,
      total_revenue_usdt REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Tabela de Afiliados
  db.exec(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      telegram_id TEXT,
      telegram_username TEXT,
      ref_code TEXT UNIQUE NOT NULL,
      commission_rate REAL DEFAULT 20.0,
      pix_key TEXT,
      usdt_wallet TEXT,
      balance_brl REAL DEFAULT 0,
      balance_usdt REAL DEFAULT 0,
      total_paid_brl REAL DEFAULT 0,
      total_paid_usdt REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Tabela de Produtos / Assinaturas
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      price_brl REAL DEFAULT 0,
      price_usdt REAL DEFAULT 0,
      currency TEXT DEFAULT 'BRL',
      type TEXT NOT NULL, 
      duration_days INTEGER DEFAULT 0,
      content TEXT,
      telegram_channel_id TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Tabela de Chaves / Estoque
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      key_content TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_by_order_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  // 6. Tabela de Pedidos
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_trade_no TEXT UNIQUE NOT NULL,
      platform TEXT NOT NULL, -- 'telegram' | 'whatsapp'
      platform_user_id TEXT NOT NULL,
      platform_user_name TEXT,
      product_id INTEGER NOT NULL,
      gateway TEXT DEFAULT 'binancepay', -- 'mercadopago', 'binancepay', 'livepix'
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'BRL',
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PAID', 'EXPIRED', 'CANCELED'
      prepay_id TEXT,
      checkout_url TEXT,
      qr_content TEXT,
      pix_code TEXT,
      delivered_content TEXT,
      affiliate_id INTEGER,
      seller_id INTEGER,
      ref_code TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    );
  `);

  // 7. Tabela de Comissões (Afiliados e Vendedores)
  db.exec(`
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      beneficiary_type TEXT NOT NULL, -- 'affiliate' | 'seller'
      beneficiary_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL, -- 'BRL' | 'USDT'
      rate_percent REAL NOT NULL,
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PAID', 'CANCELLED'
      paid_at TEXT,
      payment_proof TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);

  // 8. Tabela de Assinaturas Ativas
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      platform_user_name TEXT,
      product_id INTEGER NOT NULL,
      telegram_channel_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      reminder_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // 9. Tabela de Ofertas e Promoções Transmitidas
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      product_id INTEGER,
      cta_text TEXT DEFAULT '🛒 Aproveitar Oferta',
      cta_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Migrações seguras
  const migrations = [
    'ALTER TABLE orders ADD COLUMN affiliate_id INTEGER;',
    'ALTER TABLE orders ADD COLUMN seller_id INTEGER;',
    'ALTER TABLE orders ADD COLUMN ref_code TEXT;',
    'ALTER TABLE products ADD COLUMN price_brl REAL DEFAULT 0;',
    'ALTER TABLE products ADD COLUMN price_usdt REAL DEFAULT 0;',
    'ALTER TABLE orders ADD COLUMN gateway TEXT DEFAULT "binancepay";',
    'ALTER TABLE orders ADD COLUMN pix_code TEXT;'
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {}
  }

  // Configurações padrão
  const defaultSettings = [
    ['GATEWAY_PIX_ENABLED', 'true'],
    ['GATEWAY_BINANCE_ENABLED', 'true'],
    ['GATEWAY_LIVEPIX_ENABLED', 'false'],
    ['BINANCE_SIMULATION_MODE', 'true'],
    ['PIX_SIMULATION_MODE', 'true'],
    ['GLOBAL_AFFILIATE_RATE', '20.0'],
    ['ROUND_ROBIN_SELLERS', 'true'],
    ['NOTIFY_ADMIN_ON_SALE', 'true'],
    ['ADMIN_NOTIFY_TELEGRAM_ID', ''],
    ['ADMIN_NOTIFY_WHATSAPP_PHONE', ''],
    ['BOT_NAME', 'PayBot Vendas'],
    ['WELCOME_MESSAGE', '👋 Olá! Seja muito bem-vindo à nossa loja automatizada.'],
    ['SUPPORT_CONTACT', '@suporte'],
    ['TELEGRAM_UPDATES_CHANNEL_ID', ''],
    ['AUTO_POST_TRANSACTIONS', 'true'],
    ['MASK_CUSTOMER_NAME', 'true']
  ];

  for (const [k, v] of defaultSettings) {
    const exists = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (!exists) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
    }
  }

  // Semeia vendedor e afiliado de exemplo se vazios
  const sellersCount = db.prepare('SELECT COUNT(*) as count FROM sellers').get().count;
  if (sellersCount === 0) {
    db.prepare(`
      INSERT INTO sellers (name, email, phone, telegram_username, commission_rate)
      VALUES (?, ?, ?, ?, ?)
    `).run('Vendedor Oficial (Matriz)', 'vendas@paybot.com', '5511999990001', '@vendas_paybot', 10.0);
  }

  const affiliatesCount = db.prepare('SELECT COUNT(*) as count FROM affiliates').get().count;
  if (affiliatesCount === 0) {
    db.prepare(`
      INSERT INTO affiliates (name, email, phone, telegram_username, ref_code, commission_rate, pix_key, usdt_wallet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Afiliado Top VIP', 'afiliado@demo.com', '5511999990002', '@afiliado_vip', 'TOPVIP', 25.0, 'pix@afiliado.com', '0x1234567890abcdef');
  }

  console.log('✅ Banco de dados atualizado com Times de Vendedores e Afiliados!');
}

initDatabase();

module.exports = db;

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

// Ativa WAL mode para concorrência e alta performance
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

  // 2. Tabela de Produtos / Assinaturas
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

  // 3. Tabela de Chaves / Contas em Estoque (para produtos tipo 'license_key')
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

  // 4. Tabela de Pedidos
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // 5. Tabela de Assinaturas Ativas
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      platform TEXT NOT NULL, -- 'telegram' | 'whatsapp'
      platform_user_id TEXT NOT NULL,
      platform_user_name TEXT,
      product_id INTEGER NOT NULL,
      telegram_channel_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'REVOKED'
      reminder_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Migrações seguras de colunas em bancos existentes
  const migrations = [
    'ALTER TABLE products ADD COLUMN price_brl REAL DEFAULT 0;',
    'ALTER TABLE products ADD COLUMN price_usdt REAL DEFAULT 0;',
    'ALTER TABLE orders ADD COLUMN gateway TEXT DEFAULT "binancepay";',
    'ALTER TABLE orders ADD COLUMN pix_code TEXT;'
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {
      // Ignora se coluna já existe
    }
  }

  // Atualiza preços BRL e USDT nos produtos existentes caso estejam zerados
  db.exec(`
    UPDATE products 
    SET price_brl = CASE WHEN price_brl = 0 THEN ROUND(price * 5.5, 2) ELSE price_brl END,
        price_usdt = CASE WHEN price_usdt = 0 THEN price ELSE price_usdt END
    WHERE price_brl = 0 OR price_usdt = 0;
  `);

  // Configurações padrão se ainda não existirem
  const defaultSettings = [
    ['GATEWAY_PIX_ENABLED', 'true'],
    ['GATEWAY_BINANCE_ENABLED', 'true'],
    ['GATEWAY_LIVEPIX_ENABLED', 'false'],
    ['BINANCE_SIMULATION_MODE', 'true'],
    ['PIX_SIMULATION_MODE', 'true']
  ];

  for (const [k, v] of defaultSettings) {
    const exists = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (!exists) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
    }
  }

  // Semeia produtos de exemplo se vazio
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (productCount === 0) {
    console.log('📦 Inicializando banco com produtos e assinaturas de exemplo...');

    const insertProd = db.prepare(`
      INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, content, telegram_channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. E-book / Conteúdo Digital com Link
    insertProd.run(
      'Curso Completo de Cripto & Finanças (PDF + Aulas)',
      'Acesso vitalício ao material completo, planilhas e guias práticos.',
      25.00,
      25.00,
      5.00,
      'BRL',
      'digital_link',
      0,
      'https://drive.google.com/drive/folders/exemplo-acesso-curso-cripto',
      null
    );

    // 2. Chave de Ativação / Licença
    const prod2 = insertProd.run(
      'Licença de Software Premium (30 Dias)',
      'Chave de ativação individual entregue imediatamente.',
      49.90,
      49.90,
      10.00,
      'BRL',
      'license_key',
      0,
      null,
      null
    );

    const insertKey = db.prepare('INSERT INTO inventory_keys (product_id, key_content) VALUES (?, ?)');
    insertKey.run(Number(prod2.lastInsertRowid), 'KEY-PREMIUM-ABCD-1234-XYZ');
    insertKey.run(Number(prod2.lastInsertRowid), 'KEY-PREMIUM-EFGH-5678-WUV');

    // 3. Assinatura VIP Grupo Telegram Mensal (30 dias)
    insertProd.run(
      'Grupo VIP Sinais & Networking (30 Dias)',
      'Acesso exclusivo de 30 dias com remoção automática ao expirar.',
      75.00,
      75.00,
      15.00,
      'BRL',
      'vip_subscription',
      30,
      null,
      config.telegram.vipChannelId || null
    );

    console.log('✅ Banco inicializado com sucesso!');
  }
}

initDatabase();

module.exports = db;

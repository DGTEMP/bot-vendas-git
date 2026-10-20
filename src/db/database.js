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
  // type: 'digital_link' (envia link/arquivo), 'license_key' (retira 1 chave do estoque), 'vip_subscription' (gera link de convite VIP telegram)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'USDT',
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
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USDT',
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PAID', 'EXPIRED', 'CANCELED'
      prepay_id TEXT,
      checkout_url TEXT,
      qr_content TEXT,
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

  // Semeia produtos de exemplo se a tabela estiver vazia
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (productCount === 0) {
    console.log('📦 Inicializando banco com produtos e assinaturas de exemplo...');

    const insertProd = db.prepare(`
      INSERT INTO products (name, description, price, currency, type, duration_days, content, telegram_channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. E-book / Conteúdo Digital com Link
    const prod1 = insertProd.run(
      'Curso Completo de Cripto & DeFi (PDF + Aulas)',
      'Acesso vitalício ao material completo, planilhas e guias práticos.',
      5.00,
      'USDT',
      'digital_link',
      0,
      'https://drive.google.com/drive/folders/exemplo-acesso-curso-cripto',
      null
    );

    // 2. Chave de Ativação / Licença
    const prod2 = insertProd.run(
      'Licença de Software Premium (30 Dias)',
      'Chave de ativação individual entregue imediatamente.',
      10.00,
      'USDT',
      'license_key',
      0,
      null,
      null
    );

    // Adiciona algumas chaves no estoque para o produto 2
    const insertKey = db.prepare('INSERT INTO inventory_keys (product_id, key_content) VALUES (?, ?)');
    insertKey.run(Number(prod2.lastInsertRowid), 'KEY-PREMIUM-ABCD-1234-XYZ');
    insertKey.run(Number(prod2.lastInsertRowid), 'KEY-PREMIUM-EFGH-5678-WUV');
    insertKey.run(Number(prod2.lastInsertRowid), 'KEY-PREMIUM-IJKL-9012-QRS');

    // 3. Assinatura VIP Grupo Telegram Mensal (30 dias)
    insertProd.run(
      'Grupo VIP Sinais & Networking (30 Dias)',
      'Acesso exclusivo de 30 dias com remoção automática ao expirar.',
      15.00,
      'USDT',
      'vip_subscription',
      30,
      null,
      config.telegram.vipChannelId || null
    );

    // 4. Assinatura VIP Grupo Telegram Trimestral (90 dias)
    insertProd.run(
      'Grupo VIP Sinais & Networking (90 Dias)',
      'Acesso de 90 dias com desconto especial.',
      35.00,
      'USDT',
      'vip_subscription',
      90,
      null,
      config.telegram.vipChannelId || null
    );

    console.log('✅ Banco inicializado com sucesso!');
  }
}

initDatabase();

module.exports = db;

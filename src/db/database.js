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

// Ativa WAL mode para alta concorrência e resiliência
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');

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

  // 10. Tabela de Cupons de Desconto
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_percent REAL DEFAULT 10.0,
      discount_amount REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 0, -- 0 = ilimitado
      used_count INTEGER DEFAULT 0,
      expires_at TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 11. Tabela de Empresas / Multi-tenant (Companies)
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      document TEXT,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 12. Tabela de Associação Vendedor <-> Produtos (Seller Allowed Products)
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(seller_id, product_id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  // 13. Tabela de Fila de Espera de Afiliação por Produto (Product Affiliations Queue)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_affiliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'CRITERIA_MET', 'APPROVED', 'REJECTED'
      notes TEXT,
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      UNIQUE(affiliate_id, product_id),
      FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  // 14. Tabela de Instâncias do Exército WhatsApp (Multi-Número / Chips)
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_army_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      session_id TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'DISCONNECTED', -- 'DISCONNECTED', 'WAITING_QR', 'CONNECTING', 'CONNECTED', 'PAUSED'
      daily_limit INTEGER DEFAULT 50,
      messages_sent_today INTEGER DEFAULT 0,
      last_sent_at TEXT,
      warmup_mode INTEGER DEFAULT 0,
      is_main INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 15. Tabela de Catálogo de Links de Afiliado (Produtos Externos & Próprios)
  db.exec(`
    CREATE TABLE IF NOT EXISTS affiliate_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      platform TEXT DEFAULT 'Hotmart', -- 'Hotmart', 'Kiwify', 'Monetizze', 'Braip', 'Cakto', 'PayBot', 'Outro'
      affiliate_url TEXT NOT NULL,
      commission_percent REAL DEFAULT 50.0,
      product_price REAL DEFAULT 0.0,
      currency TEXT DEFAULT 'BRL',
      pitch_copy TEXT,
      clicks_count INTEGER DEFAULT 0,
      sales_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 16. Tabela de Campanhas de Divulgação em Massa (Affiliate Broadcast Campaigns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS affiliate_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      affiliate_link_id INTEGER REFERENCES affiliate_links(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      message_template TEXT NOT NULL,
      status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED'
      delay_min_seconds INTEGER DEFAULT 20,
      delay_max_seconds INTEGER DEFAULT 45,
      target_instances TEXT, -- JSON array de IDs de chips ou null para rotação global
      total_leads INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
  `);

  // 17. Tabela de Fila de Leads / Disparos da Campanha
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES affiliate_campaigns(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'SENT', 'FAILED', 'REPLIED'
      sent_message TEXT,
      sender_instance_id INTEGER REFERENCES whatsapp_army_instances(id),
      sent_at TEXT,
      error_message TEXT
    );
  `);

  // 18. Tabela de Etapas do Funil de Aquecimento (Lead Warming Stages)
  db.exec(`
    CREATE TABLE IF NOT EXISTS funnel_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_key TEXT UNIQUE NOT NULL, -- 'STAGE_1_DESCOBERTA', 'STAGE_2_INTERESSE', 'STAGE_3_SOLUCAO', 'STAGE_4_OFERTA', 'STAGE_5_FECHAMENTO'
      title TEXT NOT NULL,
      order_num INTEGER NOT NULL,
      message_template TEXT NOT NULL,
      followup_template TEXT,
      followup_delay_minutes INTEGER DEFAULT 120,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 19. Tabela de Conversações e Estado do Funil de Cada Lead (Lead Warming State)
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_funnel_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      assigned_instance_id INTEGER REFERENCES whatsapp_army_instances(id),
      campaign_id INTEGER REFERENCES affiliate_campaigns(id),
      affiliate_link_id INTEGER REFERENCES affiliate_links(id),
      product_name TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      current_stage TEXT DEFAULT 'STAGE_1_DESCOBERTA',
      status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'WAITING_REPLY', 'REPLIED', 'CONVERTED', 'LOST'
      messages_sent INTEGER DEFAULT 0,
      messages_received INTEGER DEFAULT 0,
      last_message_text TEXT,
      last_message_at TEXT,
      next_followup_at TEXT,
      converted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 20. Tabela de Histórico de Interações do Funil (Lead Interactions History)
  db.exec(`
    CREATE TABLE IF NOT EXISTS funnel_interactions_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_phone TEXT NOT NULL,
      instance_id INTEGER,
      direction TEXT NOT NULL, -- 'OUT' ou 'IN'
      stage TEXT,
      message_text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 21. Tabela de Contas das Redes Sociais (Instagram Direct & Facebook Pages)
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, -- 'instagram' ou 'facebook'
      name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      access_token TEXT,
      app_secret TEXT,
      webhook_verify_token TEXT DEFAULT 'paybot_meta_token_2026',
      auto_reply_enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'CONNECTED', -- 'CONNECTED', 'DISCONNECTED', 'PAUSED'
      total_messages_received INTEGER DEFAULT 0,
      total_messages_sent INTEGER DEFAULT 0,
      assigned_company_id INTEGER REFERENCES companies(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 22. Tabela de Histórico de Mensagens Sociais (Direct & Messenger)
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_messages_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      social_account_id INTEGER REFERENCES social_accounts(id),
      platform TEXT NOT NULL, -- 'instagram' ou 'facebook'
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      message_text TEXT NOT NULL,
      direction TEXT NOT NULL, -- 'IN' ou 'OUT'
      stage TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 23. Tabela de Controle de Moderação (Mute de Conversa Privada, Grupos & Bloqueio de Participantes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_chat_controls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, -- 'whatsapp', 'telegram', 'instagram', 'facebook'
      control_type TEXT NOT NULL, -- 'MUTE_CHAT' ou 'BLOCK_USER'
      target_type TEXT NOT NULL, -- 'PRIVATE', 'GROUP' ou 'USER'
      chat_id TEXT NOT NULL, -- JID / Chat ID (ou '*' para bloqueio global)
      user_id TEXT, -- JID / Telefone / ID do usuário bloqueado
      user_name TEXT, -- Nome ou apelido
      reason TEXT, -- Motivo do bloqueio / desativação
      created_by TEXT DEFAULT 'admin', -- 'admin', 'user_request', 'command'
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_controls ON bot_chat_controls(platform, control_type, active, chat_id, user_id);
  `);

  // 24. Tabela de Auditoria e Gestão de Grupos (WhatsApp & Telegram)
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, -- 'whatsapp' ou 'telegram'
      group_id TEXT NOT NULL,
      group_name TEXT,
      admin_id TEXT NOT NULL,
      admin_name TEXT,
      action TEXT NOT NULL, -- 'BAN', 'PROMOTE', 'DEMOTE', 'LOCK', 'UNLOCK', 'RENAME', 'SET_DESC', 'REVOKE_LINK', 'TAG_ALL', 'ANTILINK_ON', 'ANTILINK_OFF', 'ANTILINK_TRIGGER', 'WELCOME_ON', 'WELCOME_OFF', 'WELCOME_MSG'
      target_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_group_audit_logs ON group_admin_audit_logs(platform, group_id, action, created_at);
  `);

  // 25. Tabela de Triggers Inteligentes Customizados (FAQ & Objeções Rápidas)
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      match_type TEXT DEFAULT 'CONTAINS', -- 'CONTAINS', 'EXACT', 'REGEX'
      response_text TEXT NOT NULL,
      category TEXT DEFAULT 'Dúvidas Frequentes',
      platform TEXT DEFAULT 'all', -- 'all', 'whatsapp', 'telegram', 'instagram', 'facebook'
      active INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_custom_triggers ON custom_triggers(active, platform);
  `);

  // 26. Tabela de Chamados / Transbordo para Suporte Humano
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, -- 'whatsapp', 'telegram', 'instagram', 'facebook'
      customer_id TEXT NOT NULL, -- telefone ou id
      customer_name TEXT,
      seller_id INTEGER,
      issue_summary TEXT,
      status TEXT DEFAULT 'OPEN', -- 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'
      priority TEXT DEFAULT 'NORMAL', -- 'LOW', 'NORMAL', 'HIGH', 'URGENT'
      last_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets ON support_tickets(status, platform, seller_id);

    -- Sistema de Advertências (Gata Nina Security)
    CREATE TABLE IF NOT EXISTS group_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      reason TEXT DEFAULT 'Violação de regras do grupo',
      warned_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_group_warnings ON group_warnings(group_id, user_phone);

    -- Sistema de Fidelidade & Gamificação (Gata Nina Loyalty / RPG)
    CREATE TABLE IF NOT EXISTS user_loyalty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL DEFAULT 'whatsapp',
      user_id TEXT NOT NULL,
      user_name TEXT,
      points INTEGER DEFAULT 50,
      level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(platform, user_id)
    );

    -- Log de Mídias de Visualização Única Reveladas (Anti-ViewOnce)
    CREATE TABLE IF NOT EXISTS view_once_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      sender_phone TEXT,
      media_type TEXT,
      media_caption TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Lançamento Meteórico (Meteoric Launch & Multi-Grupos com Transbordamento Automático)
    CREATE TABLE IF NOT EXISTS meteoric_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Lançamento Meteórico VIP',
      group_base_name TEXT NOT NULL DEFAULT 'Oferta VIP #{num}',
      max_members_per_group INTEGER NOT NULL DEFAULT 200,
      active INTEGER NOT NULL DEFAULT 1,
      current_group_id INTEGER,
      current_stage INTEGER NOT NULL DEFAULT 1,
      group_description TEXT DEFAULT 'Grupo VIP oficial de lançamento. Fique atento às notificações e regras!',
      total_groups_created INTEGER NOT NULL DEFAULT 0,
      total_leads_reached INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meteoric_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER DEFAULT 1,
      group_jid TEXT UNIQUE NOT NULL,
      group_num INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      invite_code TEXT,
      invite_url TEXT,
      member_count INTEGER NOT NULL DEFAULT 0,
      max_limit INTEGER NOT NULL DEFAULT 200,
      is_full INTEGER NOT NULL DEFAULT 0,
      is_closed INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meteoric_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_num INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      admin_announcement TEXT,
      group_mode TEXT NOT NULL DEFAULT 'announcement',
      subbot_scripts TEXT,
      executed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meteoric_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER DEFAULT 1,
      group_jid TEXT,
      group_title TEXT,
      event_type TEXT NOT NULL, -- 'STAGE_TRIGGERED', 'MEMBER_JOINED', 'OVERFLOW', 'MODE_CHANGED', 'ANNOUNCEMENT', 'SUBBOT_TALK', 'CUSTOM_MESSAGE'
      sender_name TEXT,
      message_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS viral_tracked_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, -- 'instagram', 'facebook'
      username TEXT NOT NULL, -- '@eliezerscherer', 'marketingpro', etc.
      display_name TEXT,
      profile_url TEXT,
      niche TEXT DEFAULT 'Geral',
      followers_count INTEGER DEFAULT 0,
      avg_likes INTEGER DEFAULT 0,
      auto_scrape INTEGER DEFAULT 1,
      last_scraped_at DATETIME,
      total_captured INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS viral_captured_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES viral_tracked_profiles(id) ON DELETE CASCADE,
      platform TEXT NOT NULL, -- 'instagram', 'facebook'
      source_username TEXT NOT NULL,
      post_id TEXT,
      post_url TEXT NOT NULL,
      media_type TEXT DEFAULT 'video', -- 'video', 'image', 'reel', 'carousel', 'story'
      media_url TEXT,
      thumbnail_url TEXT,
      caption TEXT,
      hook_text TEXT,
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares_count INTEGER DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      viral_score INTEGER DEFAULT 80, -- 0 a 100
      status TEXT DEFAULT 'NEW', -- 'NEW', 'USED', 'ARCHIVED'
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS viral_generated_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_post_id INTEGER REFERENCES viral_captured_posts(id) ON DELETE SET NULL,
      profile_id INTEGER REFERENCES viral_tracked_profiles(id) ON DELETE SET NULL,
      title TEXT,
      target_platform TEXT DEFAULT 'whatsapp', -- 'whatsapp', 'instagram', 'facebook', 'telegram'
      tone TEXT DEFAULT 'Comercial & Persuasivo', -- 'Comercial & Persuasivo', 'Storytelling', 'Educativo', 'Meme'
      objective TEXT DEFAULT 'Vendas & Conversão', -- 'Vendas & Conversão', 'Engajamento', 'Geração de Leads'
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      hook TEXT,
      body TEXT,
      cta TEXT,
      hashtags TEXT,
      media_suggestion TEXT,
      full_content TEXT NOT NULL,
      status TEXT DEFAULT 'READY', -- 'READY', 'PUBLISHED', 'ARCHIVED'
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    'ALTER TABLE orders ADD COLUMN pix_code TEXT;',
    'ALTER TABLE orders ADD COLUMN recovery_sent INTEGER DEFAULT 0;',
    'ALTER TABLE orders ADD COLUMN recovery_sent_at TEXT;',
    'ALTER TABLE orders ADD COLUMN coupon_code TEXT;',
    'ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0;',
    'ALTER TABLE orders ADD COLUMN is_upsell INTEGER DEFAULT 0;',
    'ALTER TABLE products ADD COLUMN upsell_product_id INTEGER;',
    'ALTER TABLE products ADD COLUMN upsell_discount_percent REAL DEFAULT 20.0;',
    'ALTER TABLE products ADD COLUMN upsell_headline TEXT;',
    'ALTER TABLE products ADD COLUMN company_id INTEGER;',
    'ALTER TABLE products ADD COLUMN category TEXT DEFAULT "Geral";',
    'ALTER TABLE products ADD COLUMN affiliation_enabled INTEGER DEFAULT 1;',
    'ALTER TABLE products ADD COLUMN custom_affiliate_rate REAL DEFAULT NULL;'
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
    ['MASK_CUSTOMER_NAME', 'true'],
    ['ABANDONED_CART_ENABLED', 'true'],
    ['ABANDONED_CART_DELAY_MIN', '15'],
    ['ABANDONED_CART_MESSAGE', '👋 Olá, {name}! Notamos que seu pedido para *{product}* ainda está reservado.\n\nFicou com alguma dúvida para concluir seu pagamento? Garanta o seu antes que o link expire!\n\nClique no botão abaixo para pagar e receber seu acesso imediatamente:'],
    ['UPSELL_ENABLED', 'true'],
    ['AFFILIATION_MIN_SALES', '2'],
    ['AFFILIATION_MIN_REVENUE_BRL', '50.0'],
    ['AFFILIATION_REQUIRE_PAYMENT_INFO', 'true'],
    ['AFFILIATION_AUTO_APPROVE', 'true'],
    ['AFFILIATION_PRODUCT_RESTRICTED', 'false']
  ];

  for (const [k, v] of defaultSettings) {
    const exists = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (!exists) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
    }
  }

  // Semeia empresa padrão se nenhuma existir
  const companiesCount = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
  if (companiesCount === 0) {
    const resComp = db.prepare(`
      INSERT INTO companies (name, document, description)
      VALUES (?, ?, ?)
    `).run('Empresa Principal (Matriz)', '12.345.678/0001-90', 'Unidade de Negócios e Operação Principal');
    
    // Atualiza produtos sem company_id para vincular à empresa matriz
    try {
      db.prepare('UPDATE products SET company_id = ? WHERE company_id IS NULL').run(Number(resComp.lastInsertRowid));
    } catch (_) {}
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

  // Semeia chip principal do exército de WhatsApp se não existir
  const instancesCount = db.prepare('SELECT COUNT(*) as count FROM whatsapp_army_instances').get().count;
  if (instancesCount === 0) {
    db.prepare(`
      INSERT INTO whatsapp_army_instances (id, name, session_id, status, is_main, daily_limit)
      VALUES (1, 'Chip 01 - Matriz Principal', 'main', 'DISCONNECTED', 1, 100)
    `).run();
  }

  // Semeia link de afiliado de exemplo se não existir
  const linksCount = db.prepare('SELECT COUNT(*) as count FROM affiliate_links').get().count;
  if (linksCount === 0) {
    db.prepare(`
      INSERT INTO affiliate_links (title, platform, affiliate_url, commission_percent, product_price, pitch_copy)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'Sala VIP Sinais Cripto (Hotmart)',
      'Hotmart',
      'https://hotm.art/sinais-cripto-vip',
      50.0,
      97.00,
      '{Olá|Oi|E aí} {nome}! {Tudo bem?|Como você está?}\n\nLiberamos hoje uma condição exclusiva para entrar na *Sala VIP de Sinais Cripto* com 50% OFF!\n\nConfira todos os detalhes e garanta sua vaga aqui:\n{link}'
    );
  }

  // Semeia etapas padrão do funil de aquecimento de leads se vazias
  const stagesCount = db.prepare('SELECT COUNT(*) as count FROM funnel_stages').get().count;
  if (stagesCount === 0) {
    const insertStage = db.prepare(`
      INSERT INTO funnel_stages (stage_key, title, order_num, message_template, followup_template, followup_delay_minutes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertStage.run(
      'STAGE_1_DESCOBERTA',
      '1. Descoberta & Abertura',
      1,
      '{Olá|Oi|E aí} {nome}! {Tudo bem?|Como vai?} Vi seu contato na nossa lista VIP de interessados em {produto}. Você já atua nessa área ou está querendo começar do zero?',
      '{Oi|E aí} {nome}! Conseguiu ver a mensagem anterior? Fiquei curioso pra saber sua experiência com {produto}.',
      120
    );

    insertStage.run(
      'STAGE_2_INTERESSE',
      '2. Diagnóstico & Interesse',
      2,
      '{Entendi perfeitamente|Muito bom saber|Com certeza}! Hoje muita gente tem dificuldade de ter consistência e aplicar o método certo. O que mais tem te travado para ter resultados hoje?',
      '{Fala|Olá} {nome}, se você pudesse destravar seus resultados ainda essa semana, isso faria diferença pra você?',
      120
    );

    insertStage.run(
      'STAGE_3_SOLUCAO',
      '3. Apresentação da Solução & Prova',
      3,
      '{Sensacional|Excelente}! É exatamente para isso que serve o *{produto}*. Na última semana, mais de 340 pessoas conseguiram transformar seus resultados com essa mesma metodologia prática. Quer que eu te envie o link oficial para você ver os detalhes?',
      '{Oi|Olá} {nome}! Posso te mandar o link de apresentação rápida de 3 minutos?',
      120
    );

    insertStage.run(
      'STAGE_4_OFERTA',
      '4. Oferta & Envio do Link',
      4,
      '{Perfeito|Maravilha}! Aqui está seu link com a condição exclusiva de 50% de desconto: {link}\n\nDá uma olhada nos bônus inclusos e me diz se você conseguiu abrir!',
      '{Oi|E aí} {nome}! Conseguiu acessar o link? Restam poucas vagas com esse desconto promocional.',
      120
    );

    insertStage.run(
      'STAGE_5_FECHAMENTO',
      '5. Quebra de Objeções & Fechamento',
      5,
      '{Sem problemas|Super compreensível}! O pagamento é 100% seguro via PIX ou USDT, e você tem garantia total incondicional de 7 dias: se não gostar, recebe todo o seu dinheiro de volta na hora. Quer ajuda para emitir seu acesso agora?',
      '{Oi|Olá} {nome}! Posso gerar o código PIX ou link Binance Pay direto aqui pra você garantir antes do encerramento?',
      120
    );
  }

  // Semeia contas de redes sociais de exemplo se vazias
  const socialCount = db.prepare('SELECT COUNT(*) as count FROM social_accounts').get().count;
  if (socialCount === 0) {
    const insertSocial = db.prepare(`
      INSERT INTO social_accounts (platform, name, account_id, status, auto_reply_enabled, total_messages_received, total_messages_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertSocial.run('instagram', '@paybot.oficial', '17841400000000001', 'CONNECTED', 1, 14, 14);
    insertSocial.run('facebook', 'Página Oficial PayBot Cripto', '109876543210987', 'CONNECTED', 1, 8, 8);
  }

  // Semeia triggers inteligentes customizados se a tabela estiver vazia
  const triggersCount = db.prepare('SELECT COUNT(*) as count FROM custom_triggers').get().count;
  if (triggersCount === 0) {
    const insertTrig = db.prepare(`
      INSERT INTO custom_triggers (keyword, match_type, response_text, category, platform, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    insertTrig.run('reclame aqui', 'CONTAINS', 'Olá {nome}! Nossa reputação é impecável com nota máxima e índice de satisfação superior a 98%. Todos os nossos clientes contam com liberação imediata e garantia incondicional de 7 dias.', 'Confiança', 'all');
    insertTrig.run('formas de pagamento', 'CONTAINS', 'Aceitamos pagamentos instantâneos via *PIX* (com liberação em segundos) e *USDT* via Binance Pay sem nenhuma taxa de transferência. Qual opção você prefere?', 'Financeiro', 'all');
    insertTrig.run('prazo de entrega', 'CONTAINS', 'A entrega é 100% digital e imediata, {nome}! Assim que o pagamento via PIX ou Binance Pay é identificado, nosso sistema envia sua chave e link de acesso na mesma hora.', 'Entregas', 'all');
    insertTrig.run('como funciona a garantia', 'CONTAINS', 'Você conta com 7 dias de garantia incondicional! Se dentro desse prazo você sentir que o {produto} não atendeu suas expectativas, devolvemos 100% do seu dinheiro.', 'Garantia', 'all');
  }

  // Semeia campanha meteórica e etapas de aquecimento padrão se vazias
  const meteoricCount = db.prepare('SELECT COUNT(*) as count FROM meteoric_campaigns').get().count;
  if (meteoricCount === 0) {
    db.prepare(`
      INSERT INTO meteoric_campaigns (id, name, group_base_name, max_members_per_group, active, current_stage, group_description)
      VALUES (1, 'Lançamento Meteórico VIP', 'Oferta VIP #{num}', 200, 1, 1, 'Grupo VIP oficial de lançamento. Acompanhe os avisos e a liberação da oferta secreta!')
    `).run();
  }

  const stagesCountMeteoric = db.prepare('SELECT COUNT(*) as count FROM meteoric_stages').get().count;
  if (stagesCountMeteoric === 0) {
    const insertStage = db.prepare(`
      INSERT INTO meteoric_stages (stage_num, title, description, admin_announcement, group_mode, subbot_scripts)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertStage.run(
      1,
      '1. Antecipação & Boas-Vindas',
      'Acolhimento aos membros, fixação de regras e criação de expectativa de lançamento.',
      '🚨 *SEJAM BEM-VINDOS AO GRUPO VIP DE LANÇAMENTO!* 🚨\n\n' +
      'Parabéns por garantir sua vaga antecipada! Aqui dentro você terá acesso à maior condição especial com desconto que nunca fizemos antes.\n\n' +
      '📌 *Regras do Grupo:*\n' +
      '1. O grupo permanecerá silenciado para mantermos o foco e evitar spam.\n' +
      '2. Todos os comunicados oficiais e o link com desconto serão enviados exclusivamente aqui!\n' +
      '3. Fique atento às notificações para não perder o momento exato da abertura!\n\n' +
      '🔥 Prepare-se, o lançamento começa em breve!',
      'announcement',
      JSON.stringify([
        { speaker: 'subbot_any', delay: 8, text: '{Fala galera!|Show demais!|Top!} Ansioso pra ver qual vai ser essa condição especial.' },
        { speaker: 'subbot_any', delay: 15, text: 'Já deixei as notificações ativadas aqui pra não perder o horário! 🔥' },
        { speaker: 'subbot_any', delay: 22, text: '{Alguém sabe se a oferta vai durar o dia todo ou tem limite de vagas?|Quantas vagas com desconto vão ser liberadas, admin?}' }
      ])
    );

    insertStage.run(
      2,
      '2. Revelação da Oportunidade & Tira-Dúvidas',
      'Abertura do grupo para perguntas, quebra de objeções estratégicas via sub-bots e apresentação da oferta.',
      '📢 *REVELAÇÃO DA OFERTA & TIRA-DÚVIDAS LIBERADO!* 📢\n\n' +
      'Chegou a hora de entender tudo o que preparamos para vocês!\n\n' +
      '🎁 *O que você vai receber:*\n' +
      '• Acesso completo à ferramenta e catálogo oficial\n' +
      '• Bônus exclusivos de lançamento inclusos\n' +
      '• Suporte prioritário VIP e garantia incondicional de 7 dias\n' +
      '• Super condição especial com mais de 50% de desconto!\n\n' +
      '🔓 *O grupo está ABERTO para dúvidas agora!* Podem mandar suas perguntas aqui.',
      'not_announcement',
      JSON.stringify([
        { speaker: 'subbot_any', delay: 6, text: 'Admin, quem comprar consegue ter suporte pra tirar dúvidas na hora de configurar?' },
        { speaker: 'subbot_any', delay: 14, text: 'Quais formas de pagamento vão ser aceitas? Aceita PIX com liberação imediata e Cripto/Cartão?' },
        { speaker: 'subbot_any', delay: 20, text: 'Top demais! E se por acaso eu não me adaptar, a garantia de 7 dias funciona mesmo?' },
        { speaker: 'subbot_any', delay: 28, text: 'Maravilha, já tirei minhas dúvidas! Na hora que abrir já tô com o PIX preparado.' }
      ])
    );

    insertStage.run(
      3,
      '3. Abertura Oficial do Carrinho & Prova Social',
      'Liberação do link com desconto secreto e efeito manada com sub-bots confirmando compras.',
      '🚀 *ATENÇÃO: O LINK COM DESCONTO SECRETO ESTÁ LIBERADO!* 🚀\n\n' +
      'Está valendo! Conseguimos liberar o desconto máximo com todos os bônus para quem está aqui no grupo VIP.\n\n' +
      '👉 *GARANTA SUA VAGA COM DESCONTO AQUI:*\n' +
      '{link}\n\n' +
      '⚠️ *ATENÇÃO:* As vagas com esse valor promocional são limitadas. Assim que esgotar o lote especial, o valor volta ao normal!',
      'not_announcement',
      JSON.stringify([
        { speaker: 'subbot_any', delay: 10, text: 'Consegui comprar aqui! Pagamento no PIX aprovou na hora e o acesso já chegou no e-mail! 🚀🎉' },
        { speaker: 'subbot_any', delay: 18, text: 'Vaga garantida com o desconto! Valeu demais admin, não ia perder por nada.' },
        { speaker: 'subbot_any', delay: 28, text: 'Acabei de pegar o meu também! Os bônus já estão liberados dentro da plataforma, muito top!' },
        { speaker: 'subbot_any', delay: 40, text: 'Comprado! Chegou o comprovante no WhatsApp na mesma hora, sensacional.' }
      ])
    );

    insertStage.run(
      4,
      '4. Escassez & Últimas Horas',
      'Alerta de vagas quase esgotadas, urgência e lembrete de que o carrinho vai fechar.',
      '⏳ *ÚLTIMO AVISO: RESTAM MENOS DE 15 VAGAS NO LOTE COM DESCONTO!* ⏳\n\n' +
      'O volume de inscrições foi gigante e o lote promocional está quase encerrando. Se você ainda não garantiu seu acesso com desconto, essa é sua última chance!\n\n' +
      '🔗 *LINK DE ÚLTIMA HORA:*\n' +
      '{link}\n\n' +
      'Quem deixar pra depois vai pagar o valor cheio sem os bônus!',
      'announcement',
      JSON.stringify([
        { speaker: 'subbot_any', delay: 8, text: 'Quase que fico de fora, ainda bem que vi essa mensagem a tempo! Garantido aqui! 🙌' },
        { speaker: 'subbot_any', delay: 16, text: 'Corre pessoal, melhor oportunidade do ano, já comecei a ver os conteúdos e tá incrível!' }
      ])
    );

    insertStage.run(
      5,
      '5. Encerramento do Lançamento',
      'Fechamento do carrinho, agradecimentos e boas-vindas oficiais aos novos clientes.',
      '🔒 *LANÇAMENTO OFICIALMENTE ENCERRADO!* 🔒\n\n' +
      'As vagas promocionais esgotaram com sucesso! Agradecemos a todos que participaram e deram esse passo importante conosco.\n\n' +
      'Aos novos alunos/membros, sejam muito bem-vindos! Nos vemos do outro lado.',
      'announcement',
      JSON.stringify([
        { speaker: 'subbot_any', delay: 6, text: 'Parabéns a todo mundo que garantiu! Lançamento foi sensacional!' }
      ])
    );
  }

  // Semeia perfis rastreados e conteúdos virais de exemplo se vazios
  const viralProfilesCount = db.prepare('SELECT COUNT(*) as count FROM viral_tracked_profiles').get().count;
  if (viralProfilesCount === 0) {
    const p1 = db.prepare(`
      INSERT INTO viral_tracked_profiles (platform, username, display_name, profile_url, niche, followers_count, avg_likes, auto_scrape, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'instagram',
      'marketingdigital.brasil',
      'Marketing Digital Brasil',
      'https://instagram.com/marketingdigital.brasil',
      'Marketing & Vendas Online',
      185000,
      4200,
      'Referência em copies virais de alta conversão para infoprodutos e WhatsApp'
    );

    const p2 = db.prepare(`
      INSERT INTO viral_tracked_profiles (platform, username, display_name, profile_url, niche, followers_count, avg_likes, auto_scrape, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      'facebook',
      'viverdecripto',
      'Viver de Cripto & Renda Passiva',
      'https://facebook.com/viverdecripto',
      'Criptomoedas & Finanças',
      92000,
      2100,
      'Página viral no Facebook sobre estratégias de USDT, Bitcoin e sinais'
    );

    const prof1Id = Number(p1.lastInsertRowid);
    const prof2Id = Number(p2.lastInsertRowid);

    const insertPost = db.prepare(`
      INSERT INTO viral_captured_posts (profile_id, platform, source_username, post_id, post_url, media_type, thumbnail_url, caption, hook_text, likes_count, comments_count, shares_count, views_count, viral_score, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')
    `);

    insertPost.run(
      prof1Id,
      'instagram',
      'marketingdigital.brasil',
      'reel_mkt_01',
      'https://instagram.com/p/reel_mkt_01',
      'video',
      'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=500&auto=format&fit=crop&q=60',
      'O maior erro de quem tenta vender no WhatsApp é mandar preço logo na primeira mensagem. Quem faz isso parece um vendedor desesperado. Faça isso em vez disso: 1) Faça uma pergunta de qualificação; 2) Mostre uma prova social rápida de 5 segundos; 3) Mande o link exclusivo com condição relâmpago. Salva esse post antes que o algoritmo esconda!',
      'O maior erro de quem tenta vender no WhatsApp é mandar preço logo na primeira mensagem.',
      14200,
      890,
      2100,
      185000,
      96
    );

    insertPost.run(
      prof1Id,
      'instagram',
      'marketingdigital.brasil',
      'reel_mkt_02',
      'https://instagram.com/p/reel_mkt_02',
      'video',
      'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&auto=format&fit=crop&q=60',
      'Pouca gente sabe, mas existe uma ferramenta que faz toda a entrega de produtos digitais no Pix e USDT sem você precisar mexer um dedo. Enquanto você dorme, ela atende, envia QR Code e entrega o acesso no mesmo segundo. Comente BOT que te mando o passo a passo no direct!',
      'Pouca gente sabe, mas existe uma ferramenta que faz toda a entrega de produtos digitais no Pix e USDT sem você mexer um dedo.',
      9800,
      1420,
      1200,
      112000,
      92
    );

    insertPost.run(
      prof2Id,
      'facebook',
      'viverdecripto',
      'fb_post_01',
      'https://facebook.com/viverdecripto/posts/fb_post_01',
      'video',
      'https://images.unsplash.com/photo-1621416894569-0f39ed31d247?w=500&auto=format&fit=crop&q=60',
      'Se você tivesse começado a acumular USDT e seguir sinais VIP há 6 meses, hoje sua conta estaria completamente diferente. A maioria das pessoas perde dinheiro tentando adivinhar o mercado sozinha, enquanto quem segue método copia e cola lucra todos os dias. O link da sala VIP está no primeiro comentário com desconto exclusivo para os 20 primeiros!',
      'Se você tivesse começado a acumular USDT e seguir sinais VIP há 6 meses, sua conta estaria completamente diferente.',
      5400,
      630,
      890,
      76000,
      89
    );

    db.prepare("UPDATE viral_tracked_profiles SET total_captured = 2, last_scraped_at = datetime('now') WHERE id = ?").run(prof1Id);
    db.prepare("UPDATE viral_tracked_profiles SET total_captured = 1, last_scraped_at = datetime('now') WHERE id = ?").run(prof2Id);
  }

  console.log('✅ Banco de dados atualizado com Times de Vendedores, Afiliados, Redes Sociais e Radar Viral!');
}

initDatabase();

module.exports = db;

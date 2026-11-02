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

// Otimizações de Memória e Latência para SQLite (< 1ms por consulta)
db.exec('PRAGMA cache_size = -4000;'); // Cache otimizado de 4MB de RAM
db.exec('PRAGMA temp_store = MEMORY;'); // Tabelas e ordenações temporárias em RAM para evitar I/O de disco
db.exec('PRAGMA mmap_size = 0;'); // Desativa memory-mapping excessivo no Windows
db.exec('PRAGMA wal_autocheckpoint = 250;'); // Checkpoints automáticos balanceados

// Cache de Statements Preparados para eliminar recompilação de SQL no V8
const origPrepare = db.prepare.bind(db);
const stmtCache = new Map();

db.prepare = function(sql) {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = origPrepare(sql);
    if (stmtCache.size < 400) {
      stmtCache.set(sql, stmt);
    }
  }
  return stmt;
};

db.clearStatementCache = function() {
  stmtCache.clear();
};

db.optimizeDatabaseMemory = function() {
  try {
    if (stmtCache.size > 250) stmtCache.clear();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec('PRAGMA optimize;');
  } catch (_) {}
};

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

    -- Sistema de Advertências (Spy Security)
    CREATE TABLE IF NOT EXISTS group_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      user_phone TEXT NOT NULL,
      reason TEXT DEFAULT 'Violação de regras do grupo',
      warned_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_group_warnings ON group_warnings(group_id, user_phone);

    -- Sistema de Fidelidade & Gamificação (Spy Loyalty / RPG)
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

    -- 29. Tabela de Avisos & Alertas da Equipe / Inter-PC (Sistemas Avisos PC)
    CREATE TABLE IF NOT EXISTS system_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT DEFAULT 'info', -- 'urgente', 'emergencia', 'alerta', 'trabalho', 'social', 'info'
      color TEXT DEFAULT '#2196f3',
      sender TEXT DEFAULT 'Admin',
      target TEXT DEFAULT 'all', -- 'all', 'sellers', 'meteoric', 'web'
      sound_alert INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active', -- 'active', 'archived'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 30. Tabela de Respostas a Avisos da Equipe
    CREATE TABLE IF NOT EXISTS system_notice_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES system_notices(id) ON DELETE CASCADE,
      respondent TEXT NOT NULL,
      response_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 31. Tabela de Tarefas Delegadas pela Matriz aos Sub-Bots (Comando e Controle de Sub-Bots)
    CREATE TABLE IF NOT EXISTS subbot_delegated_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_code TEXT UNIQUE NOT NULL,
      assigned_instance_id INTEGER REFERENCES whatsapp_army_instances(id) ON DELETE SET NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target TEXT,
      message_payload TEXT,
      status TEXT DEFAULT 'PENDING',
      result_summary TEXT,
      delegated_by TEXT DEFAULT 'OWNER',
      scheduled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    -- 32. Tabela de Denúncias e Relatórios de Moderação Inteligente (Crowd-Reporting & AI Engine)
    CREATE TABLE IF NOT EXISTS moderation_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      group_jid TEXT NOT NULL,
      group_name TEXT,
      reported_author_jid TEXT,
      reported_author_name TEXT,
      reporter_jid TEXT NOT NULL,
      reporter_name TEXT,
      reported_text TEXT,
      normalized_text TEXT,
      spam_score REAL DEFAULT 0,
      category TEXT,
      evidence TEXT,
      dampeners TEXT,
      status TEXT DEFAULT 'PENDING',
      action_taken TEXT DEFAULT 'QUEUED',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 33. Tabela de Regras Heurísticas Customizadas de Moderação
    CREATE TABLE IF NOT EXISTS moderation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      pattern TEXT NOT NULL,
      flags TEXT DEFAULT 'i',
      weight REAL DEFAULT 0.5,
      enabled INTEGER DEFAULT 1,
      hits INTEGER DEFAULT 0,
      builtin INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 34. Tabela de Perfis Cognitivos de Leads (Hexis Consultative Sales Intelligence)
    CREATE TABLE IF NOT EXISTS lead_cognitive_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      company_niche TEXT,
      project_scope TEXT,
      tech_stack TEXT,
      budget_tier TEXT DEFAULT 'MEDIO', -- 'BAIXO', 'MEDIO', 'ALTO', 'CORPORATIVO'
      budget_confidence REAL DEFAULT 0.5,
      buying_stage TEXT DEFAULT 'DESCOBERTA', -- 'DESCOBERTA', 'QUALIFICACAO', 'PROPOSTA', 'OBJECOES', 'FECHAMENTO', 'CONVERTIDO', 'PERDIDO'
      readiness_score INTEGER DEFAULT 30, -- 0 a 100
      main_objection TEXT DEFAULT 'NENHUMA', -- 'PRECO', 'PRAZO', 'CONFIANCA_GARANTIA', 'DECISOR', 'COMPLEXIDADE', 'PRIORIDADE', 'NENHUMA'
      objection_confidence REAL DEFAULT 0.0,
      last_quote_amount REAL DEFAULT 0,
      last_quote_details TEXT,
      last_interaction_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      next_followup_at DATETIME,
      followup_count INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 35. Tabela de Crenças Baseadas em Evidências (Evidence-Based Beliefs)
    CREATE TABLE IF NOT EXISTS lead_cognitive_beliefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_phone TEXT NOT NULL,
      belief_key TEXT NOT NULL,
      belief_value TEXT NOT NULL,
      evidence_text TEXT,
      confidence REAL DEFAULT 0.5,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lead_phone, belief_key)
    );

    -- 36. Tabela de Memória Episódica do Lead (Episodic Memories & Dialogue Facts)
    CREATE TABLE IF NOT EXISTS lead_episodic_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_phone TEXT NOT NULL,
      memory_type TEXT NOT NULL, -- 'REQUIREMENT', 'BUDGET', 'OBJECTION', 'QUOTE', 'AGREEMENT', 'TIMELINE', 'FEEDBACK'
      fact_summary TEXT NOT NULL,
      raw_excerpt TEXT,
      importance INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 37. Tabela de Reuniões & Demonstrações Agendadas (Google Meet / Calls de Diagnóstico)
    CREATE TABLE IF NOT EXISTS scheduled_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_phone TEXT NOT NULL,
      lead_name TEXT,
      meeting_title TEXT DEFAULT 'Reunião de Diagnóstico Técnico & Alinhamento',
      meeting_date TEXT NOT NULL, -- YYYY-MM-DD
      meeting_time TEXT NOT NULL, -- HH:MM
      meeting_datetime DATETIME NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      meet_url TEXT,
      topic_scope TEXT,
      status TEXT DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'
      reminder_sent INTEGER DEFAULT 0,
      reminder_sent_at DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 38. Tabela de Propostas Comerciais & Contratos Interativos (/proposta/:token)
    CREATE TABLE IF NOT EXISTS commercial_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL, -- ex: PROP-2026-001
      token TEXT UNIQUE NOT NULL, -- safe random token para link público
      lead_phone TEXT NOT NULL,
      lead_name TEXT,
      lead_company TEXT,
      project_title TEXT NOT NULL,
      category TEXT DEFAULT 'SOFTWARE', -- SOFTWARE, APP_MOBILE, AI_AGENT, HARDWARE_IOT, SITE_PORTAL, SEO_TUNING, METEORIC
      scope_description TEXT,
      deliverables_json TEXT, -- JSON array de itens/entregáveis
      tech_stack TEXT, -- 'Node.js, React, SQLite/Postgres, Baileys, Docker'
      timeline_weeks INTEGER DEFAULT 3,
      investment_brl REAL NOT NULL DEFAULT 0.0,
      payment_terms TEXT, -- '50% entrada via Pix + 50% na homologação final'
      contract_clauses_json TEXT, -- JSON array de cláusulas de SLA, garantia, sigilo e entrega de código-fonte
      status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'REJECTED'
      view_count INTEGER DEFAULT 0,
      last_viewed_at DATETIME,
      accepted_at DATETIME,
      accepted_by_ip TEXT,
      accepted_by_name TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 37. Tabela de Aluguel de Bot para Grupos (Group Rental System)
    CREATE TABLE IF NOT EXISTS group_rentals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_jid TEXT UNIQUE NOT NULL,
      group_name TEXT,
      expires_at TEXT, -- ISO string ou 'permanent'
      status TEXT DEFAULT 'active', -- 'active', 'expired', 'permanent'
      rental_code TEXT,
      payer_phone TEXT,
      payer_name TEXT,
      notified_24h INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 38. Tabela de Códigos de Ativação de Aluguel (Activation Keys)
    CREATE TABLE IF NOT EXISTS rental_activation_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL, -- ex: 8 caracteres hexadecimais A1B2C3D4
      duration_days INTEGER NOT NULL, -- -1 para permanente, ou 7, 15, 30, 90, 365
      target_group_jid TEXT, -- grupo específico ou nulo para genérico
      used INTEGER DEFAULT 0,
      used_by TEXT,
      activated_group TEXT,
      used_at DATETIME,
      created_by TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 39. Tabela de Configurações de Proteção de Grupo (Antiflood, Antitrava, Antifake, Welcome/Goodbye)
    CREATE TABLE IF NOT EXISTS group_protection_settings (
      group_jid TEXT PRIMARY KEY,
      antiflood_enabled INTEGER DEFAULT 0,
      antiflood_interval INTEGER DEFAULT 3, -- segundos mínimos entre mensagens
      antiflood_action TEXT DEFAULT 'warn', -- 'warn', 'mute', 'kick'
      antitrava_enabled INTEGER DEFAULT 1,
      antifake_enabled INTEGER DEFAULT 0,
      welcome_enabled INTEGER DEFAULT 1,
      welcome_text TEXT DEFAULT 'Bem-vindo(a) #nome# ao grupo *#grupo#*! 🎉 Agora somos #membros# membros. Leia a descrição: #desc#',
      goodbye_enabled INTEGER DEFAULT 1,
      goodbye_text TEXT DEFAULT 'Até mais, #nome#! Sentiremos sua falta no grupo *#grupo#*. 👋',
      antidoc_enabled INTEGER DEFAULT 0,
      antiloc_enabled INTEGER DEFAULT 0,
      antifig_enabled INTEGER DEFAULT 0,
      antipt_enabled INTEGER DEFAULT 0,
      soadm_enabled INTEGER DEFAULT 0,
      muted_users TEXT DEFAULT '[]',
      blocked_commands TEXT DEFAULT '[]',
      group_rules TEXT DEFAULT '',
      blacklist_numbers TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 40. Tabela de Estatísticas de Execução de Comandos (Top Comandos)
    CREATE TABLE IF NOT EXISTS command_execution_stats (
      command_name TEXT PRIMARY KEY,
      execution_count INTEGER DEFAULT 0,
      last_executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 41. Tabelas do Plugin ZapVoice 2025 (Mensagens Rápidas, Áudios PTT, Funis e Campanhas)
    CREATE TABLE IF NOT EXISTS zapvoice_quick_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      shortcut TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'Atendimento',
      trigger_keywords TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zapvoice_audios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      shortcut TEXT UNIQUE,
      audio_path TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 15,
      is_ptt INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zapvoice_funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      trigger_keywords TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zapvoice_funnel_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funnel_id INTEGER NOT NULL REFERENCES zapvoice_funnels(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      step_type TEXT NOT NULL, -- 'text', 'audio_ptt', 'media', 'document'
      content TEXT DEFAULT '',
      media_path TEXT DEFAULT '',
      delay_seconds INTEGER DEFAULT 3,
      is_ptt INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zapvoice_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      funnel_id INTEGER,
      target_type TEXT DEFAULT 'contacts', -- 'contacts', 'groups'
      targets TEXT NOT NULL, -- JSON array de números ou JIDs
      min_delay INTEGER DEFAULT 15,
      max_delay INTEGER DEFAULT 45,
      status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'paused'
      sent_count INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 42. Tabelas de Social Listening (Escuta de Palavras-Chave e Entrosamento Orgânico com Afiliados)
    CREATE TABLE IF NOT EXISTS social_listening_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keywords TEXT NOT NULL, -- palavras-chave separadas por vírgula (ex: chapinha, prancha, alisador)
      product_name TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      templates TEXT NOT NULL, -- JSON array de frases naturais de recomendação
      cooldown_minutes INTEGER DEFAULT 15,
      active INTEGER DEFAULT 1,
      total_triggers INTEGER DEFAULT 0,
      last_triggered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 43. Tabelas de Telemetria de Loja Web & Rastreamento de Carrinho com WhatsApp
    CREATE TABLE IF NOT EXISTS web_store_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      phone TEXT,
      customer_name TEXT,
      event_type TEXT NOT NULL, -- PAGE_VIEW, PRODUCT_VIEW, ADD_TO_CART, REMOVE_FROM_CART, CHECKOUT_OPEN, CHECKOUT_SUBMIT, ABANDONED
      product_id INTEGER,
      product_name TEXT,
      cart_payload TEXT,
      cart_total REAL DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS web_cart_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      phone TEXT,
      customer_name TEXT,
      cart_items TEXT,
      cart_total REAL DEFAULT 0,
      status TEXT DEFAULT 'BROWSING', -- BROWSING, IN_CART, CHECKOUT_OPEN, ORDER_PLACED, ABANDONED
      abandoned_recovery_sent INTEGER DEFAULT 0,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- 44. PLATAFORMA SAAS MULTI-TENANT & GESTÃO DE LICENÇAS
    -- ==========================================
    CREATE TABLE IF NOT EXISTS saas_tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      owner_name TEXT,
      owner_phone TEXT,
      owner_email TEXT,
      password_hash TEXT,
      license_key TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'pro', -- starter, pro, enterprise, custom
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, TRIAL, EXPIRED, SUSPENDED
      is_lifetime INTEGER DEFAULT 0,
      starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      max_bots INTEGER DEFAULT 5,
      max_products INTEGER DEFAULT 50,
      max_sellers INTEGER DEFAULT 10,
      modules_enabled TEXT DEFAULT '["botdeck","orders","catalog","crm","zapvoice","affiliates"]',
      company_id INTEGER,
      custom_domain TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saas_license_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      action TEXT NOT NULL, -- CREATED, RENEWED, EXTENDED, PAUSED, RESUMED, PLAN_CHANGED, EXPIRED, BLOCKED
      days_added INTEGER DEFAULT 0,
      previous_expires_at DATETIME,
      new_expires_at DATETIME,
      performed_by TEXT DEFAULT 'OWNER',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saas_tenant_sessions (
      token TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

  `);

  // Migrações seguras
  const migrations = [
    'ALTER TABLE subbot_delegated_tasks ADD COLUMN scheduled_at DATETIME;',
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
    'ALTER TABLE products ADD COLUMN custom_affiliate_rate REAL DEFAULT NULL;',
    'ALTER TABLE products ADD COLUMN image_url TEXT DEFAULT "";',
    'ALTER TABLE products ADD COLUMN specs TEXT DEFAULT "";',
    'ALTER TABLE products ADD COLUMN stock_qty INTEGER DEFAULT 999;',
    'ALTER TABLE meteoric_stages ADD COLUMN scheduled_at DATETIME;',
    'ALTER TABLE meteoric_stages ADD COLUMN auto_execute INTEGER DEFAULT 0;',
    'ALTER TABLE meteoric_stages ADD COLUMN media_url TEXT;',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN is_business INTEGER DEFAULT 0;',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN business_catalog_synced INTEGER DEFAULT 0;',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN catalog_products TEXT DEFAULT "[]";',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN role TEXT DEFAULT "LEAD_OUTREACH";',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN health_score REAL DEFAULT 98.5;',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN delivery_success_rate REAL DEFAULT 99.0;',
    'ALTER TABLE products ADD COLUMN army_instance_id INTEGER DEFAULT NULL;',
    'ALTER TABLE group_protection_settings ADD COLUMN antidoc_enabled INTEGER DEFAULT 0;',
    'ALTER TABLE group_protection_settings ADD COLUMN antiloc_enabled INTEGER DEFAULT 0;',
    'ALTER TABLE group_protection_settings ADD COLUMN antifig_enabled INTEGER DEFAULT 0;',
    'ALTER TABLE group_protection_settings ADD COLUMN antipt_enabled INTEGER DEFAULT 0;',
    'ALTER TABLE group_protection_settings ADD COLUMN soadm_enabled INTEGER DEFAULT 0;',
    'ALTER TABLE group_protection_settings ADD COLUMN muted_users TEXT DEFAULT "[]";',
    'ALTER TABLE group_protection_settings ADD COLUMN blocked_commands TEXT DEFAULT "[]";',
    'ALTER TABLE group_protection_settings ADD COLUMN group_rules TEXT DEFAULT "";',
    'ALTER TABLE group_protection_settings ADD COLUMN blacklist_numbers TEXT DEFAULT "[]";',
    'ALTER TABLE zapvoice_quick_messages ADD COLUMN trigger_keywords TEXT DEFAULT "";',
    'ALTER TABLE zapvoice_funnels ADD COLUMN description TEXT DEFAULT "";',
    'ALTER TABLE products ADD COLUMN tenant_id INTEGER;',
    'ALTER TABLE orders ADD COLUMN tenant_id INTEGER;',
    'ALTER TABLE whatsapp_army_instances ADD COLUMN tenant_id INTEGER;',
    'ALTER TABLE settings ADD COLUMN tenant_id INTEGER;',
    'ALTER TABLE companies ADD COLUMN tenant_id INTEGER;'
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {}
  }

  // Índices de alta performance para acelerar consultas críticas (latência <1ms)
  const performanceIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);',
    'CREATE INDEX IF NOT EXISTS idx_orders_trade_no ON orders(trade_no);',
    'CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);',
    'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);',
    'CREATE INDEX IF NOT EXISTS idx_inv_keys_prod_st ON inventory_keys(product_id, status);',
    'CREATE INDEX IF NOT EXISTS idx_army_inst_st ON whatsapp_army_instances(status, is_main);',
    'CREATE INDEX IF NOT EXISTS idx_army_inst_phone ON whatsapp_army_instances(phone);',
    'CREATE INDEX IF NOT EXISTS idx_del_tasks_status ON subbot_delegated_tasks(status, scheduled_at);',
    'CREATE INDEX IF NOT EXISTS idx_del_tasks_code ON subbot_delegated_tasks(task_code);',
    'CREATE INDEX IF NOT EXISTS idx_del_tasks_inst ON subbot_delegated_tasks(instance_id);',
    'CREATE INDEX IF NOT EXISTS idx_camp_leads_phone ON campaign_leads(phone);',
    'CREATE INDEX IF NOT EXISTS idx_camp_leads_st ON campaign_leads(status);',
    'CREATE INDEX IF NOT EXISTS idx_camp_leads_inst ON campaign_leads(army_instance_id);',
    'CREATE INDEX IF NOT EXISTS idx_funnel_conv_phone ON lead_funnel_conversations(lead_phone);',
    'CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, army_instance_id);',
    'CREATE INDEX IF NOT EXISTS idx_aff_links_code ON affiliate_links(code);',
    'CREATE INDEX IF NOT EXISTS idx_notices_active ON system_notices(status, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_viral_posts_score ON viral_captured_posts(viral_score);',
    'CREATE INDEX IF NOT EXISTS idx_meteoric_grp_jid ON meteoric_groups(group_jid);',
    'CREATE INDEX IF NOT EXISTS idx_meteoric_grp_camp ON meteoric_groups(campaign_id, active);',
    'CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);',
    'CREATE INDEX IF NOT EXISTS idx_sellers_active ON sellers(active);',
    'CREATE INDEX IF NOT EXISTS idx_affiliates_active ON affiliates(active);',
    'CREATE INDEX IF NOT EXISTS idx_mod_reports_grp ON moderation_reports(group_jid, status);',
    'CREATE INDEX IF NOT EXISTS idx_mod_reports_msg ON moderation_reports(message_id);',
    'CREATE INDEX IF NOT EXISTS idx_mod_rules_cat ON moderation_rules(category, enabled);',
    'CREATE INDEX IF NOT EXISTS idx_cog_prof_phone ON lead_cognitive_profiles(phone);',
    'CREATE INDEX IF NOT EXISTS idx_cog_prof_stage ON lead_cognitive_profiles(buying_stage, readiness_score);',
    'CREATE INDEX IF NOT EXISTS idx_cog_prof_followup ON lead_cognitive_profiles(next_followup_at);',
    'CREATE INDEX IF NOT EXISTS idx_cog_beliefs_phone ON lead_cognitive_beliefs(lead_phone);',
    'CREATE INDEX IF NOT EXISTS idx_cog_memories_phone ON lead_episodic_memories(lead_phone, importance);',
    'CREATE INDEX IF NOT EXISTS idx_meetings_phone ON scheduled_meetings(lead_phone);',
    'CREATE INDEX IF NOT EXISTS idx_meetings_datetime ON scheduled_meetings(meeting_datetime, status);',
    'CREATE INDEX IF NOT EXISTS idx_proposals_phone ON commercial_proposals(lead_phone);',
    'CREATE INDEX IF NOT EXISTS idx_proposals_token ON commercial_proposals(token);',
    'CREATE INDEX IF NOT EXISTS idx_proposals_code ON commercial_proposals(code);',
    'CREATE INDEX IF NOT EXISTS idx_group_rentals_jid ON group_rentals(group_jid, status);',
    'CREATE INDEX IF NOT EXISTS idx_group_rentals_exp ON group_rentals(expires_at);',
    'CREATE INDEX IF NOT EXISTS idx_rental_codes_cd ON rental_activation_codes(code, used);',
    'CREATE INDEX IF NOT EXISTS idx_cmd_stats_cnt ON command_execution_stats(execution_count DESC);',
    'CREATE INDEX IF NOT EXISTS idx_zv_msg_shortcut ON zapvoice_quick_messages(shortcut);',
    'CREATE INDEX IF NOT EXISTS idx_zv_aud_shortcut ON zapvoice_audios(shortcut);',
    'CREATE INDEX IF NOT EXISTS idx_zv_fun_act ON zapvoice_funnels(active);',
    'CREATE INDEX IF NOT EXISTS idx_zv_steps_fun ON zapvoice_funnel_steps(funnel_id, step_order);',
    'CREATE INDEX IF NOT EXISTS idx_zv_camp_st ON zapvoice_campaigns(status);',
    'CREATE INDEX IF NOT EXISTS idx_sl_rules_act ON social_listening_rules(active);',
    'CREATE INDEX IF NOT EXISTS idx_telemetry_sess ON web_store_telemetry(session_id);',
    'CREATE INDEX IF NOT EXISTS idx_telemetry_ph ON web_store_telemetry(phone);',
    'CREATE INDEX IF NOT EXISTS idx_cart_sess_id ON web_cart_sessions(session_id);',
    'CREATE INDEX IF NOT EXISTS idx_cart_sess_ph ON web_cart_sessions(phone);',
    'CREATE INDEX IF NOT EXISTS idx_saas_tenant_slug ON saas_tenants(slug);',
    'CREATE INDEX IF NOT EXISTS idx_saas_tenant_key ON saas_tenants(license_key);',
    'CREATE INDEX IF NOT EXISTS idx_saas_tenant_phone ON saas_tenants(owner_phone);',
    'CREATE INDEX IF NOT EXISTS idx_saas_tenant_status ON saas_tenants(status);',
    'CREATE INDEX IF NOT EXISTS idx_saas_logs_tenant ON saas_license_logs(tenant_id);',
    'CREATE INDEX IF NOT EXISTS idx_saas_sess_token ON saas_tenant_sessions(token);',
    'CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);',
    'CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);',
    'CREATE INDEX IF NOT EXISTS idx_army_tenant ON whatsapp_army_instances(tenant_id);'
  ];
  for (const idxSql of performanceIndexes) {
    try { db.exec(idxSql); } catch (_) {}
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
    ['OWNER_PHONE', '554884702848'],
    ['OWNER_WHATSAPP', '554884702848'],
    ['ADMIN_PHONE', '554884702848'],
    ['ADMIN_NOTIFY_WHATSAPP_PHONE', '554884702848'],
    ['SOCIAL_LISTENING_ENABLED', 'true'],
    ['SOCIAL_LISTENING_COOLDOWN_MIN', '15'],
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
    ['RENTAL_MODE_GLOBAL', 'false'],
    ['VERIFICADO_GLOBAL', 'false'],
    ['VERIFICADO_TITLE', 'PayBot Oficial ✓'],
    ['VERIFICADO_BODY', 'Canal Oficial Verificado 🟢'],
    ['VERIFICADO_SHOW_AD', 'true'],
    ['AFFILIATION_MIN_SALES', '2'],
    ['AFFILIATION_MIN_REVENUE_BRL', '50.0'],
    ['AFFILIATION_REQUIRE_PAYMENT_INFO', 'true'],
    ['AFFILIATION_AUTO_APPROVE', 'true'],
    ['AFFILIATION_PRODUCT_RESTRICTED', 'false'],
    ['MODERATION_MODE', 'enforce'],
    ['MODERATION_BLOCK_THRESHOLD', '0.80'],
    ['MODERATION_ESCALATE_THRESHOLD', '0.50'],
    ['MODERATION_AUTO_DELETE', 'true']
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
      '{Olá|Oi}! Vi seu interesse no *{produto}*. Para eu te passar as informações certas, você já tem experiência nessa área ou está querendo começar do zero?',
      '{Olá|Oi}! Conseguiu ver a mensagem sobre o *{produto}*? Se tiver qualquer dúvida sobre como funciona, estou por aqui.',
      120
    );

    insertStage.run(
      'STAGE_2_INTERESSE',
      '2. Diagnóstico & Interesse',
      2,
      'Entendi! O principal objetivo do *{produto}* é justamente simplificar sua rotina e entregar consistência com metodologia prática e suporte dedicado. O que mais tem sido seu maior desafio hoje?',
      '{Olá|Oi}! Se você pudesse resolver esse gargalo ainda esta semana, isso faria diferença para você?',
      120
    );

    insertStage.run(
      'STAGE_3_SOLUCAO',
      '3. Apresentação da Solução & Prova',
      3,
      'É exatamente esse o foco do *{produto}*. Desenvolvemos essa solução para rodar com eficiência máxima, com dezenas de membros tendo resultados consistentes logo nas primeiras semanas. Quer dar uma olhada rápida na página oficial com os detalhes e demonstração?',
      '{Olá|Oi}! Posso te mandar o link de apresentação rápida para você ver como funciona na prática?',
      120
    );

    insertStage.run(
      'STAGE_4_OFERTA',
      '4. Oferta & Envio do Link',
      4,
      'Perfeito! Aqui está seu link com a condição exclusiva de 50% de desconto: {link}\n\nDá uma olhada nos bônus inclusos e na garantia. Assim que você abrir me dá um toque aqui!',
      '{Olá|Oi}! Conseguiu acessar o link? Qualquer dúvida sobre a condição promocional, pode me chamar por aqui.',
      120
    );

    insertStage.run(
      'STAGE_5_FECHAMENTO',
      '5. Quebra de Objeções & Fechamento',
      5,
      'Fique tranquilo: a inscrição é 100% segura e você conta com garantia incondicional de 7 dias — se por qualquer motivo achar que não é para você, devolvemos 100% do valor. Quer que eu te ajude a emitir seu acesso agora pelo Pix ou Cripto?',
      '{Olá|Oi}! Posso gerar o código Pix ou link Binance Pay direto aqui pra você garantir antes do encerramento?',
      120
    );
  }

  // Atualiza templates antigos dos estágios do funil para versão conversacional inteligente e natural
  try {
    db.prepare(`
      UPDATE funnel_stages 
      SET message_template = '{Olá|Oi}! Vi seu interesse no *{produto}*. Para eu te passar as informações certas, você já tem experiência nessa área ou está querendo começar do zero?',
          followup_template = '{Olá|Oi}! Conseguiu ver a mensagem sobre o *{produto}*? Se tiver qualquer dúvida sobre como funciona, estou por aqui.'
      WHERE stage_key = 'STAGE_1_DESCOBERTA' AND (message_template LIKE '%Vi seu contato na nossa lista VIP%' OR message_template LIKE '%Vi seu contato%')
    `).run();

    db.prepare(`
      UPDATE funnel_stages 
      SET message_template = 'Entendi! O principal objetivo do *{produto}* é justamente simplificar sua rotina e entregar consistência com metodologia prática e suporte dedicado. O que mais tem sido seu maior desafio hoje?',
          followup_template = '{Olá|Oi}! Se você pudesse resolver esse gargalo ainda esta semana, isso faria diferença para você?'
      WHERE stage_key = 'STAGE_2_INTERESSE' AND (message_template LIKE '%Hoje muita gente tem dificuldade de ter consistência%' OR message_template LIKE '%Entendi perfeitamente%')
    `).run();

    db.prepare(`
      UPDATE funnel_stages 
      SET message_template = 'É exatamente esse o foco do *{produto}*. Desenvolvemos essa solução para rodar com eficiência máxima, com dezenas de membros tendo resultados consistentes logo nas primeiras semanas. Quer dar uma olhada rápida na página oficial com os detalhes e demonstração?',
          followup_template = '{Olá|Oi}! Posso te mandar o link de apresentação rápida para você ver como funciona na prática?'
      WHERE stage_key = 'STAGE_3_SOLUCAO' AND (message_template LIKE '%Sensacional%' OR message_template LIKE '%340 pessoas%')
    `).run();

    db.prepare(`
      UPDATE funnel_stages 
      SET message_template = 'Perfeito! Aqui está seu link com a condição exclusiva de 50% de desconto: {link}\n\nDá uma olhada nos bônus inclusos e na garantia. Assim que você abrir me dá um toque aqui!',
          followup_template = '{Olá|Oi}! Conseguiu acessar o link? Qualquer dúvida sobre a condição promocional, pode me chamar por aqui.'
      WHERE stage_key = 'STAGE_4_OFERTA' AND (message_template LIKE '%Maravilha%' OR message_template LIKE '%restam poucas vagas%')
    `).run();

    db.prepare(`
      UPDATE funnel_stages 
      SET message_template = 'Fique tranquilo: a inscrição é 100% segura e você conta com garantia incondicional de 7 dias — se por qualquer motivo achar que não é para você, devolvemos 100% do valor. Quer que eu te ajude a emitir seu acesso agora pelo Pix ou Cripto?',
          followup_template = '{Olá|Oi}! Posso gerar o código Pix ou link Binance Pay direto aqui pra você garantir antes do encerramento?'
      WHERE stage_key = 'STAGE_5_FECHAMENTO' AND (message_template LIKE '%Sem problemas%' OR message_template LIKE '%Super compreensível%')
    `).run();
  } catch (_) {}

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

  // Desativa produtos legados que não pertencem ao catálogo oficial de tecnologia
  try {
    db.prepare(`
      UPDATE products SET active = 0 
      WHERE category NOT IN ('Softwares', 'Aplicativos', 'Hardware', 'IA', 'Sites', 'Projetos', 'SEO', 'Otimizações', 'Meteórico')
        AND (army_instance_id IS NULL OR army_instance_id = 0)
    `).run();
  } catch (_) {}

  // Semeia o Catálogo Oficial de Tecnologia (Softwares, Apps, Hardware, IA, Sites, Projetos, SEO, Otimizações, Meteórico)
  const officialTechCatalog = [
    // 1. Softwares
    {
      name: 'SpyBot Pro - Automação WhatsApp & Vendas 24/7',
      description: 'Bot completo de alta conversão para WhatsApp com multi-números, recuperação de carrinho, disparos em massa e checkout Pix/USDT.',
      price: 497.00,
      price_brl: 497.00,
      price_usdt: 90.36,
      currency: 'BRL',
      type: 'license_key',
      duration_days: 0,
      category: 'Softwares',
      specs: 'Node.js Baileys v6+, SQLite ultra-rápido (<1ms), painel web com gráficos, gestão de afiliados e sub-bots.',
      image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      stock_qty: 100
    },
    {
      name: 'Painel SaaS de Gestão Comercial & CRM Multi-Tenant',
      description: 'Sistema web completo de gestão comercial com controle de vendedores, comissões de afiliados, relatórios financeiros e CRM.',
      price: 997.00,
      price_brl: 997.00,
      price_usdt: 181.27,
      currency: 'BRL',
      type: 'digital_link',
      duration_days: 0,
      category: 'Softwares',
      specs: 'Arquitetura modular multi-empresas, relatórios em tempo real, exportação CSV/Excel e integração com webhooks.',
      image_url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80',
      stock_qty: 999
    },

    // 2. Aplicativos Personalizados Sob Medida
    {
      name: 'Aplicativo Mobile Personalizado Sob Medida (Android & iOS)',
      description: 'Desenvolvimento completo de app mobile nativo ou híbrido, com design UI/UX exclusivo, notificações push e APIs integradas.',
      price: 4500.00,
      price_brl: 4500.00,
      price_usdt: 818.18,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Aplicativos',
      specs: 'React Native / Flutter, autenticação biométrica, offline cache, painel web administrativo e publicação nas lojas.',
      image_url: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&auto=format&fit=crop&q=80',
      stock_qty: 10
    },
    {
      name: 'Web App / PWA Personalizado com Painel Administrativo',
      description: 'Aplicação Web Progressiva de alta performance, instalável em smartphones e PCs, offline-first e ultra-rápida.',
      price: 2800.00,
      price_brl: 2800.00,
      price_usdt: 509.09,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Aplicativos',
      specs: 'PWA com Service Workers, banco de dados em tempo real, responsividade 100% fluida e zero tempo de espera.',
      image_url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=80',
      stock_qty: 15
    },

    // 3. Hardware & Infraestrutura
    {
      name: 'Setup Servidor Dedicado & VPS High-Performance para Bots e IA',
      description: 'Provisionamento de infraestrutura bare-metal/VPS com Linux otimizado, proteção anti-DDoS, Nginx SSL e tuning de RAM/CPU.',
      price: 850.00,
      price_brl: 850.00,
      price_usdt: 154.55,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Hardware',
      specs: 'Configuração em AWS, Hetzner ou DigitalOcean, firewall avançado, swap zRAM, monitoramento e backups automáticos.',
      image_url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80',
      stock_qty: 20
    },
    {
      name: 'Workstation Corporativa / Rig Dedicado para Processamento Local de IA',
      description: 'Consultoria, dimensionamento e montagem de hardware dedicado com GPUs para inferência local de IA sem custos de API.',
      price: 12500.00,
      price_brl: 12500.00,
      price_usdt: 2272.73,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Hardware',
      specs: 'Configuração com GPUs Nvidia RTX/Enterprise, suporte a modelos 7B a 70B via vLLM/Ollama, refrigeração e estabilidade 24/7.',
      image_url: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=600&auto=format&fit=crop&q=80',
      stock_qty: 5
    },

    // 4. Inteligência Artificial (IA)
    {
      name: 'Agente de Atendimento Inteligente com IA Generativa (Gemini / GPT)',
      description: 'Atendente virtual humanizado treinado com o conhecimento do seu negócio para responder dúvidas e converter vendas no WhatsApp.',
      price: 1800.00,
      price_brl: 1800.00,
      price_usdt: 327.27,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'IA',
      specs: 'Integração Google Gemini / OpenAI, memória de conversa, transbordo automático para humanos e gatilhos de vendas.',
      image_url: 'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=600&auto=format&fit=crop&q=80',
      stock_qty: 25
    },
    {
      name: 'Sistema RAG Corporativo (Base de Conhecimento com Busca Semântica)',
      description: 'Indexação vetorial de PDFs, catálogos e manuais com busca semântica instantânea para respostas corporativas sem alucinações.',
      price: 2400.00,
      price_brl: 2400.00,
      price_usdt: 436.36,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'IA',
      specs: 'Embeddings vetoriais de alta fidelidade, busca híbrida semântica + BM25, API REST e suporte a múltiplos documentos.',
      image_url: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&auto=format&fit=crop&q=80',
      stock_qty: 20
    },

    // 5. Sites & Landing Pages
    {
      name: 'Landing Page de Alta Conversão (Copy + Design + Ultra-Rápida)',
      description: 'Página de vendas moderna e persuasiva, estruturada para tráfego pago, com carregamento abaixo de 1s e alta taxa de conversão.',
      price: 1200.00,
      price_brl: 1200.00,
      price_usdt: 218.18,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Sites',
      specs: 'HTML5/Tailwind/CSS3 ultra-leve, copy validada, pixels Meta e Google integrados, 100% responsiva.',
      image_url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=600&auto=format&fit=crop&q=80',
      stock_qty: 30
    },
    {
      name: 'Site Institucional ou Portal Corporativo Premium',
      description: 'Site corporativo profissional com páginas de serviços, blog institucional, formulários dinâmicos e conexão com WhatsApp.',
      price: 2500.00,
      price_brl: 2500.00,
      price_usdt: 454.55,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Sites',
      specs: 'SEO técnico on-page incluso, certificado SSL, design exclusivo no Figma, painel administrativo fácil de gerenciar.',
      image_url: 'https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=600&auto=format&fit=crop&q=80',
      stock_qty: 15
    },

    // 6. Projetos Sob Medida
    {
      name: 'Desenvolvimento de Software / Projeto Full-Stack Sob Medida',
      description: 'Solução sob medida desenvolvida do zero para resolver exatamente os desafios operacionais e regras do seu negócio.',
      price: 3800.00,
      price_brl: 3800.00,
      price_usdt: 690.91,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Projetos',
      specs: 'Node.js/TypeScript, React/Vue, PostgreSQL/SQLite, arquitetura limpa, testes unitários e garantia técnica pós-entrega.',
      image_url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80',
      stock_qty: 10
    },
    {
      name: 'Integração Personalizada de APIs, Webhooks e Gateways de Pagamento',
      description: 'Conexão confiável entre sistemas legados, ERPs, CRMs e gateways (Pix automático, Binance Pay, Mercado Pago, Stripe).',
      price: 1500.00,
      price_brl: 1500.00,
      price_usdt: 272.73,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Projetos',
      specs: 'Fila de reprocessamento automático (dead-letter queue), segurança com HMAC/tokens, logs detalhados e zero perdas de transações.',
      image_url: 'https://images.unsplash.com/photo-1555421689-491a97ff2040?w=600&auto=format&fit=crop&q=80',
      stock_qty: 25
    },

    // 7. SEO & Tráfego Orgânico
    {
      name: 'Auditoria Técnica de SEO & Otimização Google 1ª Página',
      description: 'Diagnóstico profundo de SEO técnico, correção de erros de indexação, schema markup e plano estratégico de palavras-chave.',
      price: 1350.00,
      price_brl: 1350.00,
      price_usdt: 245.45,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'SEO',
      specs: 'Otimização Core Web Vitals, robots.txt, sitemaps XML, canônicas, arquitetura de links internos e rich snippets.',
      image_url: 'https://images.unsplash.com/photo-1571721795195-a2ca2d3370a9?w=600&auto=format&fit=crop&q=80',
      stock_qty: 30
    },
    {
      name: 'Pacote Mensal de Gestão de SEO & Posicionamento Orgânico (30 Dias)',
      description: 'Acompanhamento contínuo de rankings no Google, criação de conteúdo otimizado, ganho de autoridade e monitoramento.',
      price: 1900.00,
      price_brl: 1900.00,
      price_usdt: 345.45,
      currency: 'BRL',
      type: 'vip_subscription',
      duration_days: 30,
      category: 'SEO',
      specs: 'Relatórios mensais de evolução de posições, Search Console, GA4 e otimizações contínuas de páginas estratégicas.',
      image_url: 'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=600&auto=format&fit=crop&q=80',
      stock_qty: 20
    },

    // 8. Otimizações de Performance
    {
      name: 'Otimização de Performance Web (PageSpeed 100/100 & Core Web Vitals)',
      description: 'Aceleração drástica do tempo de carregamento de páginas, compressão de imagens, minificação e cache avançado.',
      price: 790.00,
      price_brl: 790.00,
      price_usdt: 143.64,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Otimizações',
      specs: 'Garantia de pontuação verde no Google PageSpeed, redução de TTFB e eliminação de scripts bloqueantes.',
      image_url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&auto=format&fit=crop&q=80',
      stock_qty: 50
    },
    {
      name: 'Tuning de Performance de Banco de Dados, Backend & Redução de Latência',
      description: 'Auditoria de queries lentas, criação de índices estratégicos, statement cache, tuning de pooling e redução de RAM.',
      price: 1100.00,
      price_brl: 1100.00,
      price_usdt: 200.00,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Otimizações',
      specs: 'Otimização de bancos SQLite, MySQL ou Postgres, benchmarks antes/depois e redução de consumo de CPU/Memória em até 80%.',
      image_url: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=600&auto=format&fit=crop&q=80',
      stock_qty: 35
    },

    // 9. Lançamento Meteórico
    {
      name: 'Estruturação Completa de Lançamento Meteórico no WhatsApp',
      description: 'Configuração total do funil de lançamento meteórico: esteira de grupos VIP, links de auto-transbordamento e cronograma de 5 fases.',
      price: 3200.00,
      price_brl: 3200.00,
      price_usdt: 581.82,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Meteórico',
      specs: 'Gestão automatizada de grupos, scripts de antecipação, moderação inteligente e abertura cronometrada com checkout acelerado.',
      image_url: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=600&auto=format&fit=crop&q=80',
      stock_qty: 15
    },
    {
      name: 'Automação de Sub-Bots & Efeito Manada para Lançamento Meteórico',
      description: 'Scripts inteligentes de interação com sub-bots simultâneos gerando prova social, quebrando objeções e ativando escassez ao vivo.',
      price: 2100.00,
      price_brl: 2100.00,
      price_usdt: 381.82,
      currency: 'BRL',
      type: 'digital',
      duration_days: 0,
      category: 'Meteórico',
      specs: 'Simulação humanizada com delays orgânicos, múltiplos chips coordenados pela Matriz e disparo de links secretos com desconto.',
      image_url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&auto=format&fit=crop&q=80',
      stock_qty: 25
    },
    {
      name: 'Aluguel Mensal PayBot (Grupos WhatsApp)',
      description: '30 dias de acesso completo aos recursos do bot no seu grupo: moderação avançada, antiflood, antitrava, stickers, downloads e inteligência artificial.',
      price: 49.90,
      price_brl: 49.90,
      price_usdt: 10.00,
      currency: 'BRL',
      type: 'group_rental',
      duration_days: 30,
      category: 'Aluguel',
      specs: 'Liberação instantânea por chave de 8 dígitos de ativação. Válido por 30 dias contados após a ativação.',
      image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      stock_qty: 999
    },
    {
      name: 'Aluguel Trimestral PayBot (Grupos WhatsApp)',
      description: '90 dias de proteção de grupo, moderação, downloads, IA e engajamento automatizado com desconto especial.',
      price: 129.90,
      price_brl: 129.90,
      price_usdt: 25.00,
      currency: 'BRL',
      type: 'group_rental',
      duration_days: 90,
      category: 'Aluguel',
      specs: 'Chave exclusiva de ativação por 90 dias com suporte prioritário e renovação simplificada.',
      image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      stock_qty: 999
    },
    {
      name: 'Licença Vitalícia PayBot (Grupos WhatsApp)',
      description: 'Acesso permanente e vitalício para 1 grupo: proteção, diversão, IA, áudio FX e automação sem mensalidades.',
      price: 299.00,
      price_brl: 299.00,
      price_usdt: 60.00,
      currency: 'BRL',
      type: 'group_rental',
      duration_days: -1,
      category: 'Aluguel',
      specs: 'Ativação definitiva permanente para o grupo cadastrado. Sem cobranças recorrentes.',
      image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      stock_qty: 999
    }
  ];

  const insertProdStmt = db.prepare(`
    INSERT INTO products (name, description, price, price_brl, price_usdt, currency, type, duration_days, category, specs, image_url, stock_qty, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const p of officialTechCatalog) {
    const existing = db.prepare('SELECT id FROM products WHERE name = ?').get(p.name);
    if (!existing) {
      const res = insertProdStmt.run(
        p.name, p.description, p.price, p.price_brl, p.price_usdt, p.currency,
        p.type, p.duration_days, p.category, p.specs, p.image_url, p.stock_qty
      );
      if (p.type === 'license_key') {
        const prodId = Number(res.lastInsertRowid);
        const insertKey = db.prepare('INSERT INTO inventory_keys (product_id, key_content) VALUES (?, ?)');
        insertKey.run(prodId, 'SPY-PRO-7788-9900');
        insertKey.run(prodId, 'SPY-PRO-3344-5566');
        insertKey.run(prodId, 'SPY-PRO-1122-4455');
      }
    } else {
      db.prepare(`
        UPDATE products 
        SET active = 1, category = ?, description = ?, price = ?, price_brl = ?, price_usdt = ?, specs = ?, image_url = ?
        WHERE id = ?
      `).run(p.category, p.description, p.price, p.price_brl, p.price_usdt, p.specs, p.image_url, existing.id);
    }
  }

  // Semeia perfis cognitivos iniciais de demonstração se tabela estiver vazia
  try {
    const cogCount = db.prepare('SELECT COUNT(*) as count FROM lead_cognitive_profiles').get().count;
    if (cogCount === 0) {
      const insProf = db.prepare(`
        INSERT INTO lead_cognitive_profiles (
          phone, name, company_niche, project_scope, tech_stack,
          budget_tier, budget_confidence, buying_stage, readiness_score,
          main_objection, objection_confidence, last_quote_amount, last_quote_details,
          next_followup_at, followup_count, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 day'), 1, ?)
      `);

      insProf.run(
        '5511988880001', 'Dr. Marcos Silveira', 'Saúde & Clínicas',
        'Aplicativo Mobile de Agendamento & Prontuário com Painel Web',
        'Node.js, React Native, PostgreSQL, Pix Direto',
        'MEDIO', 0.85, 'PROPOSTA', 78,
        'PRAZO', 0.80, 4800.00, 'App Android/iOS + Painel Web em 20 dias',
        'Lead busca agilidade para inauguração da nova unidade em 3 semanas.'
      );

      insProf.run(
        '5511977770002', 'Mariana Mendes', 'E-commerce & Varejo',
        'Bot de Vendas Inteligente com IA e Checkout Integrado WhatsApp',
        'Node.js, Baileys, Gemini Flash, SQLite',
        'MEDIO', 0.75, 'QUALIFICACAO', 62,
        'PRECO', 0.65, 2400.00, 'Bot com fluxo anti-carrinho abandonado e Pix',
        'Interessada em reduzir custos com atendentes humanos aos finais de semana.'
      );

      // Crenças do Dr. Marcos
      const insBelief = db.prepare(`
        INSERT OR IGNORE INTO lead_cognitive_beliefs (lead_phone, belief_key, belief_value, evidence_text, confidence)
        VALUES (?, ?, ?, ?, ?)
      `);
      insBelief.run('5511988880001', 'lead_budget', 'R$ 4.500 - R$ 6.000', 'Citou que reservou 5k para o sistema da clínica', 0.85);
      insBelief.run('5511988880001', 'main_objection', 'Prazo de Entrega', 'Perguntou se consegue entregar antes do dia 25', 0.80);
      insBelief.run('5511988880001', 'decision_maker', 'Sim (Sócio-fundador)', 'Disse que ele mesmo aprova o orçamento', 0.90);
      insBelief.run('5511988880001', 'tech_interest', 'App Mobile + Painel Web', 'Exigiu app para pacientes e painel para médicos', 0.95);

      // Memórias episódicas
      const insMem = db.prepare(`
        INSERT INTO lead_episodic_memories (lead_phone, memory_type, fact_summary, raw_excerpt, importance)
        VALUES (?, ?, ?, ?, ?)
      `);
      insMem.run('5511988880001', 'REQUIREMENT', 'Precisa de autenticação de pacientes e emissão de comprovantes Pix', 'Preciso que o paciente receba o comprovante e veja o horário marcado', 4);
      insMem.run('5511988880001', 'QUOTE', 'Proposta enviada: R$ 4.800 em 2x com entrega do MVP em 15 dias', 'Consigo fazer 4800 em 2x entregando a primeira versão em 15 dias', 5);
      insMem.run('5511988880001', 'TIMELINE', 'Inauguração da filial prevista para o fim do mês', 'Minha filial abre dia 28, preciso estar rodando', 4);

      insMem.run('5511977770002', 'REQUIREMENT', 'Integração de checkout Pix no WhatsApp com disparo de rastreio', 'Quero que envie o código de rastreio dos Correios automaticamente', 4);
      insMem.run('5511977770002', 'BUDGET', 'Orçamento sensível: busca retorno rápido sobre investimento', 'Tenho verba enxuta agora, preciso ver se o bot se paga no primeiro mês', 3);
    }
  } catch (_) {}

  // Semeia regras padrão de Social Listening se tabela estiver vazia
  try {
    const slCount = db.prepare('SELECT COUNT(*) as count FROM social_listening_rules').get().count;
    if (slCount === 0) {
      const insSl = db.prepare(`
        INSERT INTO social_listening_rules (keywords, product_name, affiliate_url, templates, cooldown_minutes, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      insSl.run(
        'chapinha, prancha de cabelo, prancha, alisador, escova secadora, secador',
        'Chapinha Titanium Profissional Íons Negativos',
        'https://amzn.to/chapinha-titanium-pro',
        JSON.stringify([
          'Menina, comprei a minha por esse link aqui na promoção e chegou super rápido: {link} esquenta muito bem e não resseca o cabelo!',
          'Essa prancha é maravilhosa! Peguei com desconto direto no site oficial por aqui: {link} vale cada centavo.',
          'Uso essa no meu salão todos os dias, a temperatura é excelente: {link} recomendo demais!'
        ]),
        15
      );
      insSl.run(
        'bot de vendas, bot whatsapp, automacao whatsapp, sistema de vendas, zap bot, bot automatico',
        'PayBot Vendas Automáticas & Gestão de Grupos',
        'https://paybot.store/catalogo?ref=grupo_social',
        JSON.stringify([
          'Cara, uso o bot do pessoal daqui faz meses: {link} roda 24h sem cair com Pix automático e proteção de grupos, valeu cada centavo!',
          'Recomendo muito a solução que eles têm aqui: {link} aumentou minhas conversões direto no WhatsApp sem precisar ficar no celular o dia todo.',
          'Para quem tava com dúvida de bot que não toma ban, dá uma olhada na plataforma oficial deles: {link} recomendo!'
        ]),
        20
      );
      insSl.run(
        'software sob medida, app personalizado, desenvolver app, criar site, sistema web, automacao ia',
        'Desenvolvimento de Software Sob Medida & Painéis Web',
        'https://paybot.store/catalogo?ref=social_dev',
        JSON.stringify([
          'Contratei a equipe deles para montar um painel pra mim e entregaram antes do prazo: {link} recomendo demais falar com eles!',
          'Se você precisa de app ou site profissional, fecha com eles por aqui: {link} o suporte pós-entrega é de primeira.'
        ]),
        25
      );
    }
  } catch (_) {}

  // Semeia mensagens rápidas e funis ZapVoice padrão se tabela estiver vazia
  try {
    const zvMsgCount = db.prepare('SELECT COUNT(*) as count FROM zapvoice_quick_messages').get().count;
    if (zvMsgCount === 0) {
      const insZvMsg = db.prepare(`
        INSERT INTO zapvoice_quick_messages (title, shortcut, content, category)
        VALUES (?, ?, ?, ?)
      `);
      insZvMsg.run('Preços e Planos PayBot', '/preco', '{saudacao}, {primeiro_nome}! Nossos planos para o PayBot começam a partir de R$ 49,90/mês para aluguel de grupo ou R$ 299,00 para licença vitalícia permanente! Quer que eu envie a chave Pix para liberar o acesso agora?', 'Vendas');
      insZvMsg.run('Chave Pix Oficial', '/pix', '🔑 Nossa chave Pix oficial para ativação imediata é:\npay@empresa.tech\n\nAssim que efetuar o pagamento, envie o comprovante por aqui que seu bot ou licença é ativado instantaneamente!', 'Financeiro');
      insZvMsg.run('Proposta Comercial Tech', '/proposta', '{saudacao}, {nome}! Preparamos a proposta técnica personalizada para sua empresa. Acesse o link exclusivo para visualizar o escopo e minuta contratual: {link_proposta}. Válida por 48 horas!', 'Comercial');
      insZvMsg.run('Suporte Prioritário', '/suporte', '👨‍💻 Olá {primeiro_nome}! Nosso suporte técnico de engenharia está à disposição. Envie sua dúvida que um especialista irá atendê-lo imediatamente.', 'Suporte');
      insZvMsg.run('Boas-Vindas Novo Lead', '/oi', '{saudacao}, {primeiro_nome}! Tudo bem? Seja muito bem-vindo à nossa central técnica. Como posso te ajudar hoje?', 'Geral');
    }

    const zvFunCount = db.prepare('SELECT COUNT(*) as count FROM zapvoice_funnels').get().count;
    if (zvFunCount === 0) {
      const insZvFun = db.prepare(`
        INSERT INTO zapvoice_funnels (name, trigger_keywords, active)
        VALUES (?, ?, 1)
      `);
      const resFun1 = insZvFun.run('Funil Venda Rápida Tech', 'preco, valor, quanto custa, comprar, aluguel, contratar');
      const funnelId1 = Number(resFun1.lastInsertRowid);

      const insStep = db.prepare(`
        INSERT INTO zapvoice_funnel_steps (funnel_id, step_order, step_type, content, delay_seconds, is_ptt)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insStep.run(funnelId1, 1, 'text', '{saudacao}, {primeiro_nome}! Excelente você ter perguntado sobre isso. Vou te explicar em 20 segundos.', 2, 0);
      insStep.run(funnelId1, 2, 'audio_ptt', 'Olá! Aqui é da equipe técnica. Nossos bots contam com integração Pix direta, inteligência artificial antispam, proteção contra travas e painel em tempo real. Você consegue testar no seu grupo hoje mesmo sem complicação!', 4, 1);
      insStep.run(funnelId1, 3, 'text', 'O valor promocional de hoje para grupo é apenas R$ 49,90/mês. Quer que eu gere o QR Code Pix agora para você?', 3, 0);

      const resFun2 = insZvFun.run('Funil Software Sob Medida', 'software, app, aplicativo, site, sistemas, orcamento');
      const funnelId2 = Number(resFun2.lastInsertRowid);
      insStep.run(funnelId2, 1, 'text', '{saudacao}, {nome}! Desenvolvemos softwares, apps mobile (Android/iOS) e painéis em tempo real sob medida.', 2, 0);
      insStep.run(funnelId2, 2, 'audio_ptt', 'Tudo bem? Nós estruturamos o projeto em sprints ágeis com entrega do primeiro protótipo funcional em até 15 dias úteis, com código-fonte auditado e garantia técnica.', 5, 1);
      insStep.run(funnelId2, 3, 'text', 'Podemos agendar uma call rápida de 15 minutos pelo Google Meet para alinhar seus requisitos e gerar o orçamento exato? Envie *!call* para escolher seu melhor horário!', 3, 0);
    }
  } catch (_) {}

  // Semeia regras padrão de Social Listening se tabela estiver vazia
  try {
    const slCount = db.prepare('SELECT COUNT(*) as count FROM social_listening_rules').get().count;
    if (slCount === 0) {
      const insSl = db.prepare(`
        INSERT INTO social_listening_rules (keywords, product_name, affiliate_url, templates, cooldown_minutes, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      insSl.run(
        'chapinha, prancha de cabelo, prancha, alisador, escova secadora, secador',
        'Chapinha Titanium Profissional Íons Negativos',
        'https://amzn.to/chapinha-titanium-pro',
        JSON.stringify([
          'Menina, comprei a minha por esse link aqui na promoção e chegou super rápido: {link} esquenta muito bem e não resseca o cabelo!',
          'Essa prancha é maravilhosa! Peguei com desconto direto no site oficial por aqui: {link} vale cada centavo.',
          'Uso essa no meu salão todos os dias, a temperatura é excelente: {link} recomendo demais!'
        ]),
        15
      );
      insSl.run(
        'bot de vendas, bot whatsapp, automacao whatsapp, sistema de vendas, zap bot, bot automatico',
        'PayBot Vendas Automáticas & Gestão de Grupos',
        'https://paybot.store/catalogo?ref=grupo_social',
        JSON.stringify([
          'Cara, uso o bot do pessoal daqui faz meses: {link} roda 24h sem cair com Pix automático e proteção de grupos, valeu cada centavo!',
          'Recomendo muito a solução que eles têm aqui: {link} aumentou minhas conversões direto no WhatsApp sem precisar ficar no celular o dia todo.',
          'Para quem tava com dúvida de bot que não toma ban, dá uma olhada na plataforma oficial deles: {link} recomendo!'
        ]),
        20
      );
      insSl.run(
        'software sob medida, app personalizado, desenvolver app, criar site, sistema web, automacao ia',
        'Desenvolvimento de Software Sob Medida & Painéis Web',
        'https://paybot.store/catalogo?ref=social_dev',
        JSON.stringify([
          'Contratei a equipe deles para montar um painel pra mim e entregaram antes do prazo: {link} recomendo demais falar com eles!',
          'Se você precisa de app ou site profissional, fecha com eles por aqui: {link} o suporte pós-entrega é de primeira.'
        ]),
        25
      );
    }
  } catch (_) {}

  console.log('✅ Banco de dados atualizado com Times de Vendedores, Afiliados, Redes Sociais, Radar Viral, Catálogo Oficial Tech, CRM Cognitivo e ZapVoice 2025!');
}

initDatabase();

module.exports = db;

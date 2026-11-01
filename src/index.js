const http = require('http');
const config = require('./config');
const models = require('./db/models');
const { createServer } = require('./server/app');
const subscriptionCron = require('./services/subscriptionCron');
const telegramBot = require('./bots/telegramBot');
const whatsappBot = require('./bots/whatsappBot');

async function bootstrap() {
  console.clear();
  console.log('================================================================');
  console.log('🚀 PAYBOT - VENDAS AUTOMATIZADAS & ASSINATURAS VIP (USDT/BINANCE)');
  console.log('================================================================');

  // 1. Inicializa Servidor HTTP & Painel Web
  const app = createServer();
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ [Porta ${config.port} Ocupada] Já existe outro processo rodando na porta ${config.port}.`);
      console.error(`👉 Para encerrar o processo anterior no PowerShell:\n   Get-Process -Id (Get-NetTCPConnection -LocalPort ${config.port} -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force\n`);
      process.exit(1);
    } else {
      console.error('❌ Erro no servidor HTTP:', err.message);
      process.exit(1);
    }
  });

  server.listen(config.port, () => {
    console.log(`🌐 [Painel Web & API] Rodando em: http://localhost:${config.port}`);
    console.log(`🔔 [Webhook Binance] Endpoint: http://localhost:${config.port}/api/binance/webhook`);
  });

  // 2. Inicia Cron de Verificação Automática (Polling Binance + Expiração VIP)
  subscriptionCron.start();

  // 3. Inicia Bot do Telegram (se configurado)
  const tgToken = models.getSetting('TELEGRAM_BOT_TOKEN', config.telegram.botToken);
  if (tgToken) {
    console.log('🤖 [Telegram] Inicializando bot...');
    telegramBot.start().catch(err => {
      console.error('❌ [Telegram] Erro ao iniciar:', err.message);
    });
  } else {
    console.log('🤖 [Telegram] Token não configurado. Você pode configurá-lo pelo painel em http://localhost:' + config.port);
  }

  // 4. Inicia Bot do WhatsApp (Baileys)
  if (config.whatsapp.enabled) {
    console.log('📱 [WhatsApp Matriz] Inicializando cliente Baileys...');
    whatsappBot.start().catch(err => {
      console.error('❌ [WhatsApp Matriz] Erro ao iniciar:', err.message);
    });
  }

  // 5. Inicia e Restaura Chips Persistentes do Exército de WhatsApp (Multi-Device)
  const whatsappArmyService = require('./services/whatsappArmyService');
  whatsappArmyService.initAllInstances().catch(err => {
    console.error('❌ [Exército WhatsApp] Erro ao restaurar chips:', err.message);
  });

  // 6. Monitor & Coletor Automático de Otimização de Memória RAM e Ping
  const db = require('./db/database');
  const gataFeatures = require('./services/gataFeaturesService');
  const memoryCleanupInterval = setInterval(() => {
    try {
      if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
      if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
      if (typeof gataFeatures.cleanupMemory === 'function') gataFeatures.cleanupMemory();
      if (typeof global.gc === 'function') global.gc();
    } catch (_) {}
  }, 300000); // Executa a cada 5 minutos

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Encerrando serviços graciosamente...');
    clearInterval(memoryCleanupInterval);
    subscriptionCron.stop();
    await telegramBot.stop();
    await whatsappBot.stop();
    await whatsappArmyService.stopAllInstances();
    server.close(() => {
      console.log('👋 Servidor finalizado com segurança.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
  console.error('❌ Falha fatal na inicialização:', err);
  process.exit(1);
});

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '32';
const http = require('http');
const config = require('./config');
const models = require('./db/models');
const { createServer } = require('./server/app');
const subscriptionCron = require('./services/subscriptionCron');
const telegramBot = require('./bots/telegramBot');
const whatsappBot = require('./bots/whatsappBot');

// Escudos Globais de Resiliência 24/7 (Evita quedas por timeouts de rede externos)
const origExit = process.exit;
process.exit = function(code) {
  console.error(`🚨 [Process.exit interceptado com código ${code}]:`, new Error().stack);
  return origExit.apply(process, arguments);
};

process.on('exit', (code) => {
  console.log(`🛑 [Node Process Exit]: código ${code}`);
});

process.on('uncaughtException', (err) => {
  console.error('🛡️ [Shield - UncaughtException controlado]:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Shield - UnhandledRejection controlado]:', reason?.stack || reason?.message || reason);
});

async function bootstrap() {
  console.clear();
  console.log('================================================================');
  console.log('🚀 PAYBOT - VENDAS AUTOMATIZADAS & ASSINATURAS VIP (USDT/BINANCE)');
  console.log('================================================================');

  // 1. Inicializa Servidor HTTP do Painel Admin (Porta 3000)
  const { createServer, createStoreServer } = require('./server/app');
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
    console.log(`🔒 [Painel Admin & Backoffice] Rodando em: http://localhost:${config.port}`);
    console.log(`🔔 [Webhook Binance] Endpoint: http://localhost:${config.port}/api/binance/webhook`);
  });

  // 1.1 Inicializa Servidor HTTP da Loja Pública (Porta 3001)
  const storeApp = createStoreServer();
  const storeServer = http.createServer(storeApp);

  storeServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ [Porta Loja ${config.storePort} Ocupada] Tentando porta alternativa ${config.storePort + 10}...`);
      storeServer.listen(config.storePort + 10);
    } else {
      console.warn('⚠️ Erro no servidor da Loja Pública:', err.message);
    }
  });

  storeServer.listen(config.storePort, () => {
    console.log(`🛍️ [Loja Pública & Vitrine] Rodando em: http://localhost:${config.storePort}`);

    // Inicia os DOIS Túneis Cloudflare Independentes (Admin Tunnel + Store Tunnel)
    const tunnelService = require('./services/tunnelService');
    tunnelService.startBoth({
      adminPort: config.port,
      storePort: config.storePort
    }).catch(err => {
      console.warn('⚠️ [Tunnel] Falha ao iniciar túneis:', err.message);
    });
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

  // 5.5 Inicia Poller Contínuo de Sincronização Google Sheets (Links de Afiliados)
  const googleSheetsSyncService = require('./services/googleSheetsSyncService');
  try {
    googleSheetsSyncService.start();
  } catch (sheetErr) {
    console.warn('⚠️ [Google Sheets] Aviso ao iniciar poller:', sheetErr.message);
  }

  // 5.6 Inicia Fechamento Diário de Caixa Automático (23h Brasília) e Backup SQLite
  const dailyClosingReportService = require('./services/dailyClosingReportService');
  const databaseBackupService = require('./services/databaseBackupService');
  try {
    dailyClosingReportService.start();
    databaseBackupService.start(12);
  } catch (srvErr) {
    console.warn('⚠️ [Serviços Diários] Aviso ao iniciar:', srvErr.message);
  }

  // 5.7 Inicia o Gerente Geral da Operação & Árbitro Supremo (Núcleo Isolado 24/7)
  const operationsArbiter = require('./services/operationsArbiterService');
  try {
    operationsArbiter.startWatchdog();
  } catch (arbiterErr) {
    console.warn('⚠️ [Gerente da Operação] Aviso ao iniciar watchdog:', arbiterErr.message);
  }

  // 6. Monitor & Coletor Automático de Otimização de Memória RAM e Ping (Nitro V15 Performance Suite)
  const db = require('./db/database');
  const spyFeatures = require('./services/spyFeaturesService');
  const whatsappMessageStore = require('./services/whatsappMessageStoreService');
  const cognitiveSalesService = require('./services/cognitiveSalesService');
  const socialListeningService = require('./services/socialListeningService');
  const incomingMessageBufferService = require('./services/incomingMessageBufferService');
  
  const performSystemCleanup = () => {
    try {
      if (typeof db.optimizeDatabaseMemory === 'function') db.optimizeDatabaseMemory();
      if (typeof whatsappBot.cleanupMemory === 'function') whatsappBot.cleanupMemory();
      if (typeof whatsappArmyService.cleanupMemory === 'function') whatsappArmyService.cleanupMemory();
      if (typeof whatsappMessageStore.cleanupMemory === 'function') whatsappMessageStore.cleanupMemory();
      if (typeof spyFeatures.cleanupMemory === 'function') spyFeatures.cleanupMemory();
      if (typeof cognitiveSalesService.cleanupMemory === 'function') cognitiveSalesService.cleanupMemory();
      if (typeof socialListeningService.cleanupMemory === 'function') socialListeningService.cleanupMemory();
      if (typeof incomingMessageBufferService.cleanupMemory === 'function') incomingMessageBufferService.cleanupMemory();
      if (typeof global.gc === 'function') global.gc();
    } catch (_) {}
  };

  const memoryCleanupInterval = setInterval(performSystemCleanup, 120000); // Executa a cada 2 minutos no Nitro V15
  memoryCleanupInterval.unref?.();

  // Guardião Ativo de Pressão de Memória (Evita qualquer risco de Out Of Memory em picos)
  const memoryGuardInterval = setInterval(() => {
    try {
      const mem = process.memoryUsage();
      const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
      // Se o heap passar de 1.8GB ou 75% do limite usual, força purga emergencial
      if (heapUsedMb > 1800) {
        performSystemCleanup();
      }
    } catch (_) {}
  }, 30000); // Checagem leve a cada 30 segundos
  memoryGuardInterval.unref?.();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Encerrando serviços graciosamente...');
    clearInterval(memoryCleanupInterval);
    const tunnelService = require('./services/tunnelService');
    tunnelService.stop();
    subscriptionCron.stop();
    googleSheetsSyncService.stop();
    dailyClosingReportService.stop();
    databaseBackupService.stop();
    try { operationsArbiter.stopWatchdog(); } catch (_) {}
    await telegramBot.stop();
    await whatsappBot.stop();
    await whatsappArmyService.stopAllInstances();
    try { storeServer.close(); } catch (_) {}
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

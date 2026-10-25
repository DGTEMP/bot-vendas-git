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
    console.log('📱 [WhatsApp] Inicializando cliente Baileys...');
    whatsappBot.start().catch(err => {
      console.error('❌ [WhatsApp] Erro ao iniciar:', err.message);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Encerrando serviços graciosamente...');
    subscriptionCron.stop();
    await telegramBot.stop();
    await whatsappBot.stop();
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

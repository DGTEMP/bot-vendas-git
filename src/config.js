const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  storePort: parseInt(process.env.STORE_PORT || '3001', 10),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  storePublicUrl: process.env.STORE_PUBLIC_URL || 'http://localhost:3001',
  
  // Binance Pay API Credentials
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    secretKey: process.env.BINANCE_SECRET_KEY || '',
    // Se ativado, permite simulação de pagamento sem gastar USDT real
    simulationMode: process.env.BINANCE_SIMULATION_MODE === 'true' || !process.env.BINANCE_API_KEY,
    apiUrl: process.env.BINANCE_API_URL || 'https://bpay.binanceapi.com'
  },

  // Telegram Bot Credentials
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    vipChannelId: process.env.TELEGRAM_VIP_CHANNEL_ID || '', // ex: -1001234567890
    enabled: process.env.TELEGRAM_ENABLED !== 'false'
  },

  // WhatsApp Credentials & Config
  whatsapp: {
    enabled: process.env.WHATSAPP_ENABLED !== 'false',
    authFolder: path.join(__dirname, '..', 'data', 'whatsapp_auth')
  },

  // Database path
  dbPath: path.join(__dirname, '..', 'data', 'database.sqlite')
};

module.exports = config;

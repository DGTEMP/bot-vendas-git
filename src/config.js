const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

/**
 * =========================================================================
 * 🐾 GATA NINA & SPY BOT - MASTER CONFIGURATION 🐾
 * =========================================================================
 * Configuração no mais alto padrão GataBot-MD / Gata Nina / Baileys:
 * - Globais de Dono Supremo, Moderadores e Devs de Suporte
 * - Prefixo Universal Regex (^[./!#]) e Multi-Prefix
 * - Reações automáticas (⏳ rwait, ✅ rdone, ❌ rerror, ⚠️ rwarn)
 * - Moldura, Watermark, Selo Verificado e Branding
 * - Centralizador de Respostas de Negação de Acesso (global.dfail)
 * - Compatibilidade 100% com portas, DB, Binance Pay, Telegram e WhatsApp
 * =========================================================================
 */

// 1. DONOS SUPREMOS & MODERADORES OFICIAIS
global.owner = [
  ['554884702848', '👑 Dono Supremo', true],
  ['151866151276711', '👑 Dono (LID Oficial)', true]
];

global.mods = [];
global.prems = [];
global.suporteDevs = [];

// 2. IDENTIDADE VISUAL, BRANDING & WATERMARK (100% PAYBOT)
global.botname = process.env.BOT_NAME || 'PayBot';
global.wm = 'PAYBOT';
global.titulowm = 'PAYBOT';
global.author = 'PayBot (+554884702848)';
global.packname = 'PayBot Stickers';
global.canal = process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/paybot';
global.gp1 = process.env.COMMUNITY_GROUP_URL || 'https://chat.whatsapp.com/paybot';
global.md = 'https://github.com';

// 3. PREFIXO UNIVERSAL & REGEX DE COMANDOS
global.prefix = new RegExp('^[' + (process.env.PREFIX || 'xzXZ/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-').replace(/[|\\{}()[\]^$+*?.]/g, '\\$&') + ']');

// 4. REAÇÕES PADRONIZADAS (EMOJIS GATA NINA)
global.rwait = '⏳';
global.rdone = '✅';
global.rerror = '❌';
global.rwarn = '⚠️';

// 5. OPÇÕES GLOBAIS DE SEGURANÇA E OPERAÇÃO (GATA NINA OPTS)
global.opts = {
  self: false,            // Se true, só responde ao dono
  autoread: false,        // Auto-ler mensagens
  restrict: false,        // Restringir ações sensíveis
  anticall: false,        // Anti-chamada
  antispam: true,         // Anti-spam com cooldown
  antitravas: true,       // Escudo Anti-Trava e Anti-Crash
  pconly: false,          // Somente mensagens privadas
  gconly: false,          // Somente grupos
  swonly: false           // Somente status
};

// 6. CENTRALIZADOR DE RESPOSTAS DE ACESSO NEGADO (global.dfail)
global.dfail = function(type, m, conn) {
  if (!m || !m.chat) return null;

  const prefix = m.prefix || '!';
  const cmd = m.command || '';

  const msgMap = {
    rowner: `👑 *ACESSO EXCLUSIVO AO DONO SUPREMO* 👑\n\n` +
            `Este comando \`${prefix}${cmd}\` só pode ser executado pelo Dono Supremo (*+554884702848*).\n` +
            `_Seu número não possui privilégios de Dono Supremo._`,

    owner: `👨‍💻 *ACESSO RESTRITO A DESENVOLVEDORES & DONO* 🛠️\n\n` +
           `O comando \`${prefix}${cmd}\` é reservado exclusivamente para o Dono (+554884702848) e Desenvolvedores de Suporte nomeados.\n` +
           `_Para nomear um desenvolvedor: use \`!suporte add <tel> <nome>\` no painel web ou WhatsApp._`,

    mods: `🛡️ *ACESSO RESTRITO A MODERADORES* 🛡️\n\n` +
          `Apenas moderadores oficiais têm permissão para executar \`${prefix}${cmd}\`.`,

    premium: `💎 *RECURSO EXCLUSIVO VIP / PREMIUM* 💎\n\n` +
             `O comando \`${prefix}${cmd}\` está liberado apenas para clientes e usuários VIP.\n` +
             `_Adquira sua assinatura ou fale com a nossa equipe no privado._`,

    admin: `👮‍♂️ *COMANDO EXCLUSIVO PARA ADMINISTRADORES* 👮‍♂️\n\n` +
           `Apenas Administradores deste grupo podem utilizar \`${prefix}${cmd}\`.\n` +
           `_Se você é admin, certifique-se de que o bot possui permissão de leitura._`,

    botAdmin: `🤖 *O BOT PRECISA SER ADMINISTRADOR* ⚠️\n\n` +
              `Para executar o comando \`${prefix}${cmd}\`, o bot precisa ser promovido a *Administrador do Grupo*.\n` +
              `_Promova o bot a admin e tente novamente._`,

    group: `👥 *COMANDO EXCLUSIVO PARA GRUPOS* 👥\n\n` +
           `O comando \`${prefix}${cmd}\` só funciona dentro de Grupos de WhatsApp.\n` +
           `_Adicione o bot a um grupo para poder usar._`,

    private: `🔒 *COMANDO EXCLUSIVO NO PRIVADO (PV)* 🔒\n\n` +
             `O comando \`${prefix}${cmd}\` foi projetado para uso confidencial no Privado.\n` +
             `_Envie uma mensagem direta no privado do bot para utilizar._`,

    banned: `⏱️ *ACESSO TEMPORARIAMENTE SUSPENSO* ⛔\n\n` +
            `Você está temporariamente impedido de executar comandos no bot.\n` +
            `_Aguarde a expiração do tempo de restrição ou contate o administrador (+554884702848)._`,

    restrict: `🚫 *COMANDO DESATIVADO NO MOMENTO* 🚫\n\n` +
              `A função \`${prefix}${cmd}\` foi desativada temporariamente pela administração geral.`,

    unreg: `📝 *REGISTRO NECESSÁRIO* 📝\n\n` +
           `Você precisa estar cadastrado para utilizar \`${prefix}${cmd}\`.\n` +
           `_Envie \`!registrar Nome.Idade\` para liberar o acesso._`,

    timeout: `⏳ *AGUARDE UM MOMENTO (ANTI-FLOOD)* ⏱️\n\n` +
             `Você está enviando comandos rápido demais.\n` +
             `_Por favor, aguarde alguns instantes antes de enviar um novo comando._`
  };

  const responseText = msgMap[type] || `⚠️ *Acesso negado para o comando \`${prefix}${cmd}\`.*`;

  // Reage com alerta e envia resposta estilizada
  try {
    if (typeof m.react === 'function') m.react(global.rwarn || '⚠️');
  } catch (_) {}

  if (typeof m.reply === 'function') {
    return m.reply(responseText);
  } else if (conn && typeof conn.sendMessage === 'function') {
    return conn.sendMessage(m.chat, { text: responseText });
  }
  return responseText;
};

// 7. OBJETO CONFIG PRINCIPAL (EXPORTAÇÃO RETROCOMPATÍVEL COMPLETA)
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  storePort: parseInt(process.env.STORE_PORT || '3001', 10),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  storePublicUrl: process.env.STORE_PUBLIC_URL || 'http://localhost:3001',

  // Identidade Gata Nina
  botname: global.botname,
  wm: global.wm,
  titulowm: global.titulowm,
  author: global.author,
  packname: global.packname,
  prefix: global.prefix,
  rwait: global.rwait,
  rdone: global.rdone,
  rerror: global.rerror,
  rwarn: global.rwarn,
  opts: global.opts,
  dfail: global.dfail,

  // Binance Pay API Credentials
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    secretKey: process.env.BINANCE_SECRET_KEY || '',
    simulationMode: process.env.BINANCE_SIMULATION_MODE === 'true' || !process.env.BINANCE_API_KEY,
    apiUrl: process.env.BINANCE_API_URL || 'https://bpay.binanceapi.com'
  },

  // Telegram Bot Credentials
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    vipChannelId: process.env.TELEGRAM_VIP_CHANNEL_ID || '',
    enabled: process.env.TELEGRAM_ENABLED !== 'false'
  },

  // WhatsApp Credentials & Config
  whatsapp: {
    enabled: process.env.WHATSAPP_ENABLED !== 'false',
    authFolder: path.join(__dirname, '..', 'data', 'whatsapp_auth')
  },

  // Timezone
  timezone: process.env.TZ || 'America/Sao_Paulo',

  // Base de Conhecimento Corporativa (Cérebro Cognitivo de Vendas e Persuasão)
  knowledgeBasePath: process.env.KNOWLEDGE_BASE_PATH || path.join(__dirname, '..', 'base-conhecimento'),

  // Database path
  dbPath: path.join(__dirname, '..', 'data', 'database.sqlite')
};

module.exports = config;

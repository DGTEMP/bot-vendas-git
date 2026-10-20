const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const fulfillment = require('../services/fulfillment');

class WhatsAppBotService {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.currentQr = null;
    this.currentQrDataUrl = null;
    this.statusMessage = 'Iniciando...';
    this.authFolder = config.whatsapp.authFolder;
  }

  async start() {
    if (!config.whatsapp.enabled) {
      console.log('📱 [WhatsApp] Módulo desativado na configuração.');
      return;
    }

    // Registra envio no fulfillment
    fulfillment.registerWhatsAppBot({
      sendMessage: (jid, text) => this.sendMessage(jid, text)
    });

    try {
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`📱 [WhatsApp] Conectando via Baileys v${version.join('.')}...`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Geramos manualmente para capturar o DataURL também
        logger: pino({ level: 'silent' }),
        browser: ['BinancePay Bot', 'Chrome', '1.0.0']
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
          this.isConnected = false;
          this.statusMessage = 'Aguardando leitura do QR Code pelo WhatsApp';
          
          try {
            this.currentQrDataUrl = await QRCode.toDataURL(qr);
          } catch (e) {}

          console.log('\n======================================================');
          console.log('📱 [WhatsApp] ESCANEIE O QR CODE ABAIXO COM SEU CELULAR:');
          console.log('(Ou abra http://localhost:3000 no navegador para escanear)');
          console.log('======================================================\n');
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.currentQr = null;
          this.currentQrDataUrl = null;
          this.statusMessage = 'Conectado com sucesso';
          console.log('✅ [WhatsApp] Sessão conectada e pronta para receber pedidos!');
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.statusMessage = `Desconectado (código ${statusCode}). Tentando reconectar...`;
          console.log(`⚠️ [WhatsApp] Conexão encerrada. Reconectar? ${shouldReconnect}`);

          if (shouldReconnect) {
            setTimeout(() => this.start(), 4000);
          } else {
            console.log('🛑 [WhatsApp] Desconectado por logout. Novo QR Code será gerado.');
            // Limpa credenciais antigas para novo login
            try {
              fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (err) {}
            setTimeout(() => this.start(), 3000);
          }
        }
      });

      // Manipulação de Mensagens Recebidas
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

          // Ignora mensagens de grupos de bate-papo públicos para não poluir
          if (msg.key.remoteJid.endsWith('@g.us')) continue;

          await this.handleIncomingMessage(msg);
        }
      });

    } catch (err) {
      console.error('❌ [WhatsApp] Erro na inicialização:', err.message);
      this.statusMessage = `Erro: ${err.message}`;
    }
  }

  async handleIncomingMessage(msg) {
    const from = msg.key.remoteJid;
    const senderName = msg.pushName || 'Cliente';
    
    // Extrai texto da mensagem
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!text) return;

    const lower = text.toLowerCase();

    // 1. Mensagem de Boas-vindas / Menu
    if (['oi', 'ola', 'olá', 'menu', 'inicio', 'início', 'comprar', 'produtos', 'planos'].some(cmd => lower === cmd) || lower.startsWith('!menu')) {
      return this.sendMenu(from, senderName);
    }

    // 2. Ajuda
    if (lower === 'ajuda' || lower === 'suporte' || lower.startsWith('!ajuda')) {
      return this.sendHelp(from);
    }

    // 3. Status de Pedidos
    if (lower === 'status' || lower.startsWith('!status')) {
      return this.sendOrderStatus(from);
    }

    // 4. Seleção de produto por número (Ex: "1", "2", "3")
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > 0) {
      const products = models.getProducts(true);
      if (num <= products.length) {
        const selectedProduct = products[num - 1];
        return this.processPurchase(from, senderName, selectedProduct);
      }
    }

    // Mensagem padrão caso não reconheça comando
    const fallbackText = `Olá, *${senderName}*! 👋\n\n` +
      `Para ver nosso catálogo de produtos digitais e planos VIP com pagamento em Binance Pay, envie *MENU*.\n\n` +
      `Se precisar de suporte, envie *AJUDA*.`;
    await this.sendMessage(from, fallbackText);
  }

  async sendMenu(to, senderName) {
    const products = models.getProducts(true);

    if (products.length === 0) {
      return this.sendMessage(to, 'Nenhum produto cadastrado no momento. Tente novamente mais tarde.');
    }

    let menu = `👋 Olá, *${senderName}*!\n` +
      `Bem-vindo à nossa loja automatizada com pagamentos via *Binance Pay* (USDT).\n\n` +
      `📌 *CATÁLOGO DE PRODUTOS E ASSINATURAS:*\n\n`;

    products.forEach((p, idx) => {
      const typeTag = p.type === 'vip_subscription' ? `⭐ [VIP ${p.duration_days} dias]` : '📦 [Digital]';
      menu += `*${idx + 1}* - ${p.name} ${typeTag}\n` +
        `    💰 *${p.price.toFixed(2)} ${p.currency}*\n` +
        (p.description ? `    _${p.description}_\n\n` : '\n');
    });

    menu += `👉 *COMO COMPRAR:*\n` +
      `Basta digitar o *NÚMERO* da opção desejada (Exemplo: *1* ou *2*).\n\n` +
      `O sistema gerará instantaneamente seu QR Code e link oficial de pagamento da Binance.`;

    await this.sendMessage(to, menu);
  }

  async processPurchase(to, senderName, product) {
    // Verifica estoque se for chave
    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o produto *${product.name}* está esgotado no momento. Por favor escolha outra opção.`);
      }
    }

    await this.sendMessage(to, `⏳ Gerando sua fatura na *Binance Pay* para *${product.name}*...`);

    const tradeNo = `ORD_WPP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const binanceRes = await binancePay.createOrder({
      merchantTradeNo: tradeNo,
      amount: product.price,
      currency: product.currency || 'USDT',
      goodsName: product.name,
      goodsDetail: product.description,
      productId: product.id
    });

    if (!binanceRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar a cobrança na Binance Pay:\n${binanceRes.errorMessage}`);
    }

    const payData = binanceRes.data;

    // Registra pedido no banco
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: to,
      platform_user_name: senderName,
      product_id: product.id,
      amount: product.price,
      currency: product.currency,
      prepay_id: payData.prepayId,
      checkout_url: payData.checkoutUrl,
      qr_content: payData.qrContent
    });

    // Gera imagem do QR Code
    try {
      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, {
        width: 360,
        margin: 2
      });

      let caption = `🧾 *FATURA BINANCE PAY GERADA!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *${product.price.toFixed(2)} ${product.currency}*\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *FORMAS DE PAGAMENTO:*\n` +
        `1️⃣ Abra o aplicativo da *Binance*, selecione *Pay* e escaneie o QR Code acima.\n\n` +
        `2️⃣ Ou clique no link oficial de checkout:\n${payData.checkoutUrl}\n\n`;

      if (binanceRes.isSimulated) {
        caption += `🟡 *[MODO DE TESTE ATIVO]*\nPara simular o pagamento sem gastar cripto, acesse o link acima e clique em "Simular Pagamento".\n\n`;
      }

      caption += `⚡ *Identificação Automática:* Assim que você transferir, o sistema entregará seu produto ou link VIP automaticamente aqui!`;

      await this.sock.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      });

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar imagem QR]:', err.message);
      await this.sendMessage(to, `Pedido criado!\nLink para pagamento: ${payData.checkoutUrl}`);
    }
  }

  async sendOrderStatus(to) {
    const orders = models.getAllOrders(20).filter(o => o.platform === 'whatsapp' && o.platform_user_id === to);
    if (orders.length === 0) {
      return this.sendMessage(to, 'Você ainda não possui nenhum pedido registrado por este WhatsApp.');
    }

    let text = '📦 *SEUS ÚLTIMOS PEDIDOS:*\n\n';
    orders.slice(0, 5).forEach(o => {
      const statusText = o.status === 'PAID' ? '✅ Pago & Entregue' : o.status === 'PENDING' ? '⏳ Aguardando Pagamento' : '❌ Cancelado';
      text += `• *#${o.merchant_trade_no}*\n` +
        `  Item: ${o.product_name}\n` +
        `  Valor: ${o.amount} ${o.currency}\n` +
        `  Status: ${statusText}\n\n`;
    });

    await this.sendMessage(to, text);
  }

  async sendHelp(to) {
    const help = `ℹ️ *AJUDA & SUPORTE*\n\n` +
      `• *Como Comprar:* Envie *MENU*, digite o número do produto desejado e pague o QR Code pelo aplicativo da Binance.\n` +
      `• *Moeda aceita:* USDT (ou qualquer cripto configurada na sua carteira Binance Pay).\n` +
      `• *Prazo de Entrega:* Instantâneo. Nosso servidor verifica o recebimento do pagamento em segundos.\n` +
      `• *Assinaturas VIP:* Você receberá um link de convite exclusivo para ingressar no grupo. O robô monitora sua vigência e gerencia os acessos.`;
    await this.sendMessage(to, help);
  }

  async sendMessage(jid, text) {
    if (!this.sock || !this.isConnected) {
      console.log(`[WhatsApp ⚠️] Não conectado. Mensagem para ${jid} não enviada: ${text.slice(0, 40)}...`);
      return false;
    }

    try {
      await this.sock.sendMessage(jid, { text });
      return true;
    } catch (err) {
      console.error(`[WhatsApp ❌ Falha ao enviar para ${jid}]:`, err.message);
      return false;
    }
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      statusMessage: this.statusMessage,
      qrDataUrl: this.currentQrDataUrl,
      hasQr: !!this.currentQrDataUrl
    };
  }
}

module.exports = new WhatsAppBotService();

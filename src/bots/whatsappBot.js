const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');

class WhatsAppBotService {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.currentQr = null;
    this.currentQrDataUrl = null;
    this.statusMessage = 'Iniciando...';
    this.authFolder = config.whatsapp.authFolder;
    this.userSessions = new Map();
    this.userReferrals = new Map(); // Armazena affiliate_id e ref_code por jid
    this.userCoupons = new Map(); // Armazena cupom ativo por jid
  }

  async stop() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.end();
      } catch (e) {}
      this.sock = null;
    }
    this.isConnected = false;
  }

  async start() {
    if (!config.whatsapp.enabled) {
      console.log('📱 [WhatsApp] Módulo desativado na configuração.');
      return;
    }

    await this.stop();

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
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['PayBot Vendas', 'Chrome', '1.0.0']
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
            models.updateArmyInstance(1, { status: 'WAITING_QR' });
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
          const rawPhone = this.sock.user?.id ? this.sock.user.id.split(':')[0] : null;
          try {
            models.updateArmyInstance(1, { status: 'CONNECTED', phone: rawPhone });
          } catch (_) {}
          console.log('✅ [WhatsApp] Sessão conectada e pronta para receber pedidos!');
        }

        if (connection === 'close') {
          this.isConnected = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.statusMessage = `Desconectado (código ${statusCode}). Tentando reconectar...`;
          try {
            models.updateArmyInstance(1, { status: 'DISCONNECTED' });
          } catch (_) {}

          if (shouldReconnect) {
            setTimeout(() => this.start(), 4000);
          } else {
            console.log('🛑 [WhatsApp] Desconectado por logout. Novo QR Code será gerado.');
            try {
              fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (err) {}
            setTimeout(() => this.start(), 3000);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          if (msg.key.remoteJid.endsWith('@g.us')) continue; // ignora grupos

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
    
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!text) return;
    const lower = text.toLowerCase();

    // Auto-resposta do Exército de WhatsApp se for lead de campanha de divulgação
    try {
      const whatsappArmyService = require('../services/whatsappArmyService');
      const handled = await whatsappArmyService.handleIncomingLeadMessage(from, text, 1);
      if (handled) return;
    } catch (_) {}

    // 0. Detecta indicação de afiliado via link ou mensagem (ex: ref_TOPVIP ou cupom TOPVIP)
    const refMatch = text.match(/(?:ref_|afiliado[:\s]+)([a-zA-Z0-9_-]+)/i);
    if (refMatch) {
      const code = refMatch[1].toUpperCase();
      const affiliate = models.getAffiliateByCode(code);
      if (affiliate) {
        this.userReferrals.set(from, {
          affiliate_id: affiliate.id,
          ref_code: affiliate.ref_code
        });
        console.log(`[WhatsApp 🤝] Lead ${from} (${senderName}) vinculado ao afiliado ${affiliate.name} (#${affiliate.ref_code})`);
      }
    }

    // 0.1 Detecta ativação de cupom de desconto (ex: cupom PROMO10 ou desconto BLACK20)
    const couponMatch = text.match(/(?:cupom[:\s]+|desconto[:\s]+)([a-zA-Z0-9_-]+)/i);
    if (couponMatch) {
      const couponCode = couponMatch[1].toUpperCase();
      const coupon = models.getCouponByCode(couponCode);
      if (coupon) {
        this.userCoupons.set(from, coupon);
        return this.sendMessage(from, `🎉 *Cupom ${coupon.code} Aplicado com Sucesso!*\n\nVocê ganhou *${coupon.discount_percent}% de desconto* na sua próxima compra. Digite *MENU* para ver as opções!`);
      } else {
        return this.sendMessage(from, `❌ Desculpe, o cupom *${couponCode}* é inválido ou já expirou.`);
      }
    }

    // 0.2 Resposta para Oferta de Upsell / Order Bump (ex: "UP" ou "QUERO UP")
    if (lower === 'up' || lower === 'quero up' || lower === 'sim up') {
      const lastOrder = models.getAllOrders(10).find(o => o.platform === 'whatsapp' && o.platform_user_id === from && o.status === 'PAID');
      if (lastOrder) {
        const baseProduct = models.getProductById(lastOrder.product_id);
        if (baseProduct && baseProduct.upsell_product_id) {
          const upsellProd = models.getProductById(baseProduct.upsell_product_id);
          if (upsellProd && upsellProd.active) {
            const discount = baseProduct.upsell_discount_percent || 20.0;
            const discountedBrl = Number((upsellProd.price_brl * (1 - discount / 100)).toFixed(2));
            return this.processPixPurchase(from, senderName, {
              ...upsellProd,
              price_brl: discountedBrl,
              is_upsell: 1
            });
          }
        }
      }
    }

    // Comandos de menu
    if (['oi', 'ola', 'olá', 'menu', 'inicio', 'início', 'comprar', 'produtos', 'planos'].some(cmd => lower === cmd) || lower.startsWith('!menu')) {
      return this.sendMenu(from, senderName);
    }

    if (lower === 'ajuda' || lower === 'suporte' || lower.startsWith('!ajuda')) {
      return this.sendHelp(from);
    }

    if (lower === 'status' || lower.startsWith('!status')) {
      return this.sendOrderStatus(from);
    }

    // Atalhos diretos de pagamento: Ex "P1", "PIX 1", "C1", "CRIPTO 1"
    const pixMatch = lower.match(/^(?:p|pix\s*)(\d+)$/);
    if (pixMatch) {
      const idx = parseInt(pixMatch[1], 10);
      const products = models.getProducts(true);
      if (idx > 0 && idx <= products.length) {
        return this.processPixPurchase(from, senderName, products[idx - 1]);
      }
    }

    const bpayMatch = lower.match(/^(?:c|cripto\s*|crypto\s*|usdt\s*)(\d+)$/);
    if (bpayMatch) {
      const idx = parseInt(bpayMatch[1], 10);
      const products = models.getProducts(true);
      if (idx > 0 && idx <= products.length) {
        return this.processBinancePurchase(from, senderName, products[idx - 1]);
      }
    }

    // Seleção de produto: Ex "1", "QUERO 1", "COMPRAR 2"
    const wantMatch = lower.match(/^(?:quero\s*(?:o\s*)?|comprar\s*(?:o\s*)?|item\s*)?(\d+)$/);
    if (wantMatch) {
      const num = parseInt(wantMatch[1], 10);
      const products = models.getProducts(true);
      if (!isNaN(num) && num > 0 && num <= products.length) {
        const product = products[num - 1];
        
        const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
        const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';

        // Se ambos os gateways estão ativos, pergunta a forma de pagamento
        if (isPix && isBinance) {
          const brl = (product.price_brl || product.price).toFixed(2);
          const usdt = (product.price_usdt || (product.price / 5.5)).toFixed(2);

          const choiceMsg = `📦 *${product.name}*\n\n` +
            `Como você prefere pagar?\n\n` +
            `🟢 Digite *P${num}* para pagar via *PIX* (R$ ${brl})\n` +
            `🟡 Digite *C${num}* para pagar via *Cripto / USDT* (${usdt} USDT)\n\n` +
            `_Exemplo: responda *P${num}* para receber o código Copia e Cola instantâneo._`;
          return this.sendMessage(from, choiceMsg);
        } else if (isPix) {
          return this.processPixPurchase(from, senderName, product);
        } else {
          return this.processBinancePurchase(from, senderName, product);
        }
      }
    }

    // Fallback
    const fallbackText = `Olá, *${senderName}*! 👋\n\n` +
      `Para ver nossos produtos e assinaturas com pagamento automático via *PIX* ou *Cripto (USDT)*, envie *MENU*.\n\n` +
      `Se precisar de suporte, envie *AJUDA*.`;
    await this.sendMessage(from, fallbackText);
  }

  async sendMenu(to, senderName) {
    const products = models.getProducts(true);

    if (products.length === 0) {
      return this.sendMessage(to, 'Nenhum produto cadastrado no momento. Tente novamente mais tarde.');
    }

    let menu = `👋 Olá, *${senderName}*!\n` +
      `Bem-vindo à nossa loja automatizada com pagamentos via *PIX* e *Binance Pay* (USDT).\n\n` +
      `📌 *PRODUTOS & ASSINATURAS:*\n\n`;

    products.forEach((p, idx) => {
      const typeTag = p.type === 'vip_subscription' ? `⭐ [VIP ${p.duration_days} dias]` : '📦 [Digital]';
      const brl = (p.price_brl || p.price).toFixed(2);
      const usdt = (p.price_usdt || (p.price / 5.5)).toFixed(2);

      menu += `*${idx + 1}* - ${p.name} ${typeTag}\n` +
        `    💰 *R$ ${brl}* ou *${usdt} USDT*\n` +
        (p.description ? `    _${p.description}_\n\n` : '\n');
    });

    menu += `👉 *COMO COMPRAR:*\n` +
      `Digite o *NÚMERO* do item desejado (Exemplo: *1* ou *2*).\n\n` +
      `💡 Ou escolha direto:\n` +
      `• Para pagar com *PIX*: envie *P1*, *P2*, etc.\n` +
      `• Para pagar com *Cripto*: envie *C1*, *C2*, etc.`;

    await this.sendMessage(to, menu);
  }

  // 1. Processa Compra via PIX
  async processPixPurchase(to, senderName, product) {
    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`);
      }
    }

    await this.sendMessage(to, `⏳ Gerando seu código *PIX* para *${product.name}*...`);

    const tradeNo = `ORD_WPIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let amount = product.price_brl || product.price;

    // Aplica Cupom de Desconto se houver
    let couponCode = null;
    let discountAmount = 0;
    const activeCoupon = this.userCoupons.get(to);
    if (activeCoupon) {
      discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
      amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
      couponCode = activeCoupon.code;
      models.useCoupon(activeCoupon.code);
      this.userCoupons.delete(to);
    }

    const pixRes = await pixPayment.createPixCharge({
      merchantTradeNo: tradeNo,
      amount,
      goodsName: product.name,
      payerName: senderName
    });

    if (!pixRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar o PIX:\n${pixRes.errorMessage}`);
    }

    const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

    // Afiliado e Vendedor
    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = null;
    if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    // Salva no banco
    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: to,
      platform_user_name: senderName,
      product_id: product.id,
      gateway: 'mercadopago',
      amount,
      currency: 'BRL',
      prepay_id: paymentId,
      checkout_url: checkoutUrl,
      pix_code: pixCode,
      affiliate_id: refInfo.affiliate_id || null,
      seller_id: sellerId,
      ref_code: refInfo.ref_code || null,
      coupon_code: couponCode,
      discount_amount: discountAmount,
      is_upsell: product.is_upsell || 0
    });

    try {
      const couponNotice = couponCode ? ` (Cupom *${couponCode}* aplicado: -R$ ${discountAmount.toFixed(2)})` : '';
      let caption = `🟢 *COBRANÇA PIX GERADA!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Aponte a câmera do aplicativo do seu banco para o QR Code acima.\n` +
        `2. Ou copie o código *PIX Copia e Cola* que enviamos na próxima mensagem.\n\n` +
        `⚡ *Identificação Automática:* Assim que você efetuar o Pix, nosso sistema liberará seu acesso aqui imediatamente!`;

      if (pixRes.isSimulated) {
        caption += `\n\n🧪 *[MODO DE TESTE]*\nSimule o pagamento em:\n${checkoutUrl}`;
      }

      // Envia Imagem do QR Code
      await this.sock.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      });

      // Envia uma mensagem contendo apenas o Copia e Cola para facilitar cópia com 1 clique no celular
      await this.sendMessage(to, `👇 *PIX COPIA E COLA (Toque para copiar):*`);
      await this.sendMessage(to, `${pixCode}`);

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar PIX]:', err.message);
      await this.sendMessage(to, `Pix gerado! Código Copia e Cola:\n\n${pixCode}`);
    }
  }

  // 2. Processa Compra via Binance Pay
  async processBinancePurchase(to, senderName, product) {
    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        return this.sendMessage(to, `⚠️ Desculpe, o item *${product.name}* está esgotado no momento.`);
      }
    }

    await this.sendMessage(to, `⏳ Gerando sua fatura na *Binance Pay* para *${product.name}*...`);

    const tradeNo = `ORD_WBNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let amount = Number(product.price_usdt || (product.price / 5.5)).toFixed(2);

    // Aplica Cupom de Desconto se houver
    let couponCode = null;
    let discountAmount = 0;
    const activeCoupon = this.userCoupons.get(to);
    if (activeCoupon) {
      discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
      amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
      couponCode = activeCoupon.code;
      models.useCoupon(activeCoupon.code);
      this.userCoupons.delete(to);
    }

    const binanceRes = await binancePay.createOrder({
      merchantTradeNo: tradeNo,
      amount,
      currency: 'USDT',
      goodsName: product.name,
      goodsDetail: product.description,
      productId: product.id
    });

    if (!binanceRes.success) {
      return this.sendMessage(to, `❌ Não foi possível gerar a cobrança na Binance Pay:\n${binanceRes.errorMessage}`);
    }

    const payData = binanceRes.data;

    const refInfo = this.userReferrals.get(to) || {};
    let sellerId = null;
    if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
      const nextSeller = models.getNextRoundRobinSeller(product.id);
      if (nextSeller) sellerId = nextSeller.id;
    }

    models.createOrder({
      merchant_trade_no: tradeNo,
      platform: 'whatsapp',
      platform_user_id: to,
      platform_user_name: senderName,
      product_id: product.id,
      gateway: 'binancepay',
      amount,
      currency: 'USDT',
      prepay_id: payData.prepayId,
      checkout_url: payData.checkoutUrl,
      qr_content: payData.qrContent,
      affiliate_id: refInfo.affiliate_id || null,
      seller_id: sellerId,
      ref_code: refInfo.ref_code || null,
      coupon_code: couponCode,
      discount_amount: discountAmount,
      is_upsell: product.is_upsell || 0
    });

    try {
      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, {
        width: 360,
        margin: 2
      });

      let caption = `⚡ *FATURA BINANCE PAY (USDT)!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *${Number(amount).toFixed(2)} USDT*\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Abra o app da *Binance*, vá em *Pay* e escaneie o QR Code acima.\n` +
        `2. Ou clique no link oficial de checkout:\n${payData.checkoutUrl}\n\n` +
        `⚡ *A entrega é instantânea após o pagamento!*`;

      if (binanceRes.isSimulated) {
        caption += `\n\n🧪 *[MODO DE TESTE]*\nSimule o pagamento em:\n${payData.checkoutUrl}`;
      }

      await this.sock.sendMessage(to, {
        image: qrBuffer,
        caption: caption
      });

    } catch (err) {
      console.error('[WhatsApp ❌ Erro ao enviar imagem Binance]:', err.message);
      await this.sendMessage(to, `Pedido criado! Link para pagamento: ${payData.checkoutUrl}`);
    }
  }

  async sendOrderStatus(to) {
    const orders = models.getAllOrders(20).filter(o => o.platform === 'whatsapp' && o.platform_user_id === to);
    if (orders.length === 0) {
      return this.sendMessage(to, 'Você ainda não possui nenhum pedido registrado por este WhatsApp.');
    }

    let text = '📦 *SEUS ÚLTIMOS PEDIDOS:*\n\n';
    orders.slice(0, 5).forEach(o => {
      const statusText = o.status === 'PAID' ? '✅ Pago & Entregue' : o.status === 'PENDING' ? '⏳ Aguardando' : '❌ Cancelado';
      const valorStr = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;
      text += `• *#${o.merchant_trade_no}*\n` +
        `  Item: ${o.product_name}\n` +
        `  Valor: ${valorStr} | Status: ${statusText}\n\n`;
    });

    await this.sendMessage(to, text);
  }

  async sendHelp(to) {
    const help = `ℹ️ *AJUDA & FORMAS DE PAGAMENTO*\n\n` +
      `• *PIX:* Você recebe o QR Code e o código Copia e Cola na hora no chat.\n` +
      `• *Criptomoedas (Binance Pay):* Pagamento rápido em USDT pelo app oficial da Binance.\n` +
      `• *Entrega Instantânea:* Nossos servidores monitoram confirmações de bancos e blockchains a cada poucos segundos.\n` +
      `• *Assinaturas VIP:* Link exclusivo gerado para acesso ao canal VIP com controle automático de validade.`;
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

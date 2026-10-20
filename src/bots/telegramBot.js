const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.isRunning = false;
  }

  async start() {
    const token = models.getSetting('TELEGRAM_BOT_TOKEN', config.telegram.botToken);

    if (!token) {
      console.log('🤖 [Telegram] Token não configurado. O bot do Telegram iniciará quando você inserir o token no Painel Web ou no .env');
      return;
    }

    try {
      this.bot = new Telegraf(token);

      fulfillment.registerTelegramBot({
        sendMessage: (chatId, text) => this.sendMessage(chatId, text),
        createInviteLink: (channelId) => this.createInviteLink(channelId),
        removeMember: (channelId, userId) => this.removeMember(channelId, userId)
      });

      this.setupHandlers();
      
      await this.bot.launch();
      this.isRunning = true;
      console.log('✅ [Telegram] Bot conectado e operando com sucesso!');
    } catch (err) {
      console.error('❌ [Telegram] Falha ao iniciar bot:', err.message);
    }
  }

  async stop() {
    if (this.bot && this.isRunning) {
      this.bot.stop('SIGINT');
      this.isRunning = false;
      console.log('🛑 [Telegram] Bot desconectado.');
    }
  }

  setupHandlers() {
    // /start
    this.bot.start(async (ctx) => {
      const userName = ctx.from.first_name || 'Cliente';
      const welcomeText = `👋 Olá, *${userName}*! Seja muito bem-vindo.\n\n` +
        `Aqui você pode adquirir nossos produtos digitais e assinaturas VIP com cobrança automática via *PIX* ou *Binance Pay* (USDT).\n\n` +
        `Escolha uma das opções abaixo:`;

      await ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    this.bot.command('produtos', (ctx) => this.showProducts(ctx, false));
    this.bot.command('planos', (ctx) => this.showProducts(ctx, true));
    this.bot.command('ajuda', (ctx) => this.showHelp(ctx));

    this.bot.action('nav_products', (ctx) => this.showProducts(ctx, false));
    this.bot.action('nav_subs', (ctx) => this.showProducts(ctx, true));
    this.bot.action('nav_help', (ctx) => this.showHelp(ctx));
    this.bot.action('nav_main', async (ctx) => {
      await ctx.editMessageText('Selecione uma opção:', Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    this.bot.action('nav_my_orders', async (ctx) => {
      const userId = String(ctx.from.id);
      const orders = models.getAllOrders(20).filter(o => o.platform === 'telegram' && o.platform_user_id === userId);

      if (orders.length === 0) {
        return ctx.editMessageText('Você ainda não possui pedidos registrados.', Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]
        ]));
      }

      let text = '📦 *Seus Últimos Pedidos:*\n\n';
      orders.slice(0, 5).forEach(o => {
        const statusEmoji = o.status === 'PAID' ? '✅ Pago' : o.status === 'PENDING' ? '⏳ Aguardando' : '❌ Cancelado';
        const moeda = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;
        text += `• *#${o.merchant_trade_no}* | ${o.product_name}\n  Valor: ${moeda} | Status: ${statusEmoji}\n\n`;
      });

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]])
      });
    });

    // Clique em um produto -> Escolha do Método de Pagamento (PIX ou Binance)
    this.bot.action(/^buy_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);

      if (!product || !product.active) {
        return ctx.answerCbQuery('Produto indisponível no momento.');
      }

      if (product.type === 'license_key') {
        const available = models.getAvailableKeyCount(product.id);
        if (available <= 0) {
          return ctx.reply('⚠️ Desculpe, o estoque deste item está esgotado no momento.');
        }
      }

      const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
      const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';
      const isLivepix = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'false') === 'true';

      const buttons = [];
      const brlPrice = product.price_brl || product.price;
      const usdtPrice = product.price_usdt || (brlPrice / 5.5).toFixed(2);

      if (isPix) {
        buttons.push([Markup.button.callback(`🟢 Pagar com PIX (R$ ${Number(brlPrice).toFixed(2)})`, `pay_pix_${product.id}`)]);
      }
      if (isBinance) {
        buttons.push([Markup.button.callback(`🟡 Pagar com Binance Pay (${Number(usdtPrice).toFixed(2)} USDT)`, `pay_bpay_${product.id}`)]);
      }
      if (isLivepix) {
        buttons.push([Markup.button.callback(`💜 Pagar via LivePix (Apoiador)`, `pay_lpix_${product.id}`)]);
      }

      buttons.push([Markup.button.callback('⬅️ Voltar aos Produtos', 'nav_products')]);

      const detailsText = `📦 *${product.name}*\n\n` +
        (product.description ? `_${product.description}_\n\n` : '') +
        `💵 *Preço:* R$ ${Number(brlPrice).toFixed(2)} ou ${Number(usdtPrice).toFixed(2)} USDT\n\n` +
        `Como deseja efetuar o pagamento?`;

      await ctx.editMessageText(detailsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // 1. Processar Pagamento via PIX (Mercado Pago / Dinâmico)
    this.bot.action(/^pay_pix_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando cobrança PIX...');

      const tradeNo = `ORD_PIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      const amount = product.price_brl || product.price;

      const pixRes = await pixPayment.createPixCharge({
        merchantTradeNo: tradeNo,
        amount,
        goodsName: product.name,
        payerName: userName
      });

      if (!pixRes.success) {
        return ctx.reply(`❌ Erro ao gerar PIX: ${pixRes.errorMessage}`);
      }

      const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

      // Salva no banco
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'mercadopago',
        amount,
        currency: 'BRL',
        prepay_id: paymentId,
        checkout_url: checkoutUrl,
        pix_code: pixCode
      });

      const captionText = `🟢 *PAGAMENTO VIA PIX GERADO!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como Pagar:*\n` +
        `1. Escaneie o QR Code acima pelo app do seu banco.\n` +
        `2. Ou copie o código *PIX Copia e Cola* abaixo e cole no seu banco:\n\n` +
        `\`${pixCode}\`\n\n` +
        `⚡ *A entrega é instantânea assim que o banco confirmar!*`;

      const buttons = [
        [Markup.button.callback('🔄 Já Paguei / Verificar Pix', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];

      if (pixRes.isSimulated) {
        buttons.unshift([Markup.button.url('🧪 [TESTE] Simular Pagamento Pix', checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // 2. Processar Pagamento via BINANCE PAY (USDT)
    this.bot.action(/^pay_bpay_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando fatura Binance Pay...');

      const tradeNo = `ORD_BNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      const amount = product.price_usdt || (product.price / 5.5).toFixed(2);

      const binanceRes = await binancePay.createOrder({
        merchantTradeNo: tradeNo,
        amount,
        currency: 'USDT',
        goodsName: product.name,
        goodsDetail: product.description,
        productId: product.id
      });

      if (!binanceRes.success) {
        return ctx.reply(`❌ Erro Binance Pay: ${binanceRes.errorMessage}`);
      }

      const payData = binanceRes.data;

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'binancepay',
        amount,
        currency: 'USDT',
        prepay_id: payData.prepayId,
        checkout_url: payData.checkoutUrl,
        qr_content: payData.qrContent
      });

      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, { width: 360, margin: 2 });

      const captionText = `⚡ *FATURA BINANCE PAY GERADA!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* \`${Number(amount).toFixed(2)} USDT\`\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Como pagar:*\n` +
        `Abra o app da *Binance*, selecione *Pay* e escaneie o QR Code acima, ou clique no botão abaixo para pagar direto.`;

      const buttons = [
        [Markup.button.url('💳 Pagar com Binance Pay', payData.checkoutUrl)],
        [Markup.button.callback('🔄 Já Paguei / Verificar', `check_${tradeNo}`)],
        [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
      ];

      if (binanceRes.isSimulated) {
        buttons.splice(1, 0, [Markup.button.url('🧪 [TESTE] Simular Pagamento', payData.checkoutUrl)]);
      }

      await ctx.replyWithPhoto({ source: qrBuffer }, {
        caption: captionText,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    });

    // 3. Processar Pagamento via LIVEPIX
    this.bot.action(/^pay_lpix_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      const username = models.getSetting('LIVEPIX_USERNAME', '');
      if (!username) {
        return ctx.reply('⚠️ O usuário da LivePix ainda não foi configurado pelo administrador.');
      }

      const tradeNo = `ORD_LPX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');
      const amount = product.price_brl || product.price;

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'livepix',
        amount,
        currency: 'BRL',
        checkout_url: `https://livepix.gg/${username}`
      });

      const livepixUrl = `https://livepix.gg/${username}`;
      const msg = `💜 *PAGAMENTO VIA LIVEPIX*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* R$ ${Number(amount).toFixed(2)}\n` +
        `🆔 *Código do Pedido:* \`${tradeNo}\`\n\n` +
        `👉 *Instruções:*\n` +
        `1. Acesse: ${livepixUrl}\n` +
        `2. Digite o valor de *R$ ${Number(amount).toFixed(2)}*\n` +
        `3. ⚠️ *MUITO IMPORTANTE:* No campo de mensagem/mensagem da doação, insira o código: \`${tradeNo}\`\n\n` +
        `Assim que o LivePix notificar nosso sistema, seu produto será entregue automaticamente!`;

      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💜 Abrir Página do LivePix', livepixUrl)],
          [Markup.button.callback('🔄 Já Apoiei / Verificar', `check_${tradeNo}`)],
          [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
        ])
      });
    });

    // Verificação de Pagamento
    this.bot.action(/^check_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      await ctx.answerCbQuery('Verificando status...');

      const order = models.getOrderByTradeNo(tradeNo);
      if (!order) return ctx.reply('Pedido não encontrado.');
      if (order.status === 'PAID') return ctx.reply('✅ Este pedido já foi pago e entregue!');

      // Se for Mercado Pago
      if (order.gateway === 'mercadopago' && order.prepay_id) {
        const pixRes = await pixPayment.queryPixPayment(order.prepay_id);
        if (pixRes.success && pixRes.status === 'PAID') {
          await ctx.reply('🎉 Pagamento PIX confirmado com sucesso!');
          return fulfillment.fulfillOrder(tradeNo);
        }
      } 
      // Se for Binance Pay
      else if (order.gateway === 'binancepay') {
        const queryRes = await binancePay.queryOrder(tradeNo);
        if (queryRes.success && queryRes.status === 'PAID') {
          await ctx.reply('🎉 Pagamento confirmado pela Binance Pay!');
          return fulfillment.fulfillOrder(tradeNo);
        }
      }

      await ctx.reply('⏳ Pagamento ainda não identificado no sistema. Se acabou de transferir, aguarde alguns segundos que a entrega é automática!');
    });

    // Cancelar Pedido
    this.bot.action(/^cancel_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      models.updateOrderStatus(tradeNo, 'CANCELED');
      await ctx.answerCbQuery('Pedido cancelado.');
      await ctx.reply('❌ Pedido cancelado.');
    });
  }

  async showProducts(ctx, isSubscription = false) {
    const products = models.getProducts(true).filter(p => {
      return isSubscription ? p.type === 'vip_subscription' : p.type !== 'vip_subscription';
    });

    if (products.length === 0) {
      const emptyMsg = isSubscription ? 'Nenhuma assinatura disponível.' : 'Nenhum produto cadastrado.';
      return ctx.reply(emptyMsg, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar', 'nav_main')]]));
    }

    const title = isSubscription ? '⭐ *ASSINATURAS VIP:*' : '🛍️ *PRODUTOS DIGITAIS:*';
    const buttons = products.map(p => {
      const detail = p.duration_days ? ` (${p.duration_days} dias)` : '';
      const brl = (p.price_brl || p.price).toFixed(2);
      const usdt = (p.price_usdt || (p.price / 5.5)).toFixed(2);
      return [Markup.button.callback(`🛒 ${p.name}${detail} - R$ ${brl} / ${usdt} USDT`, `buy_${p.id}`)];
    });
    buttons.push([Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]);

    const msg = `${title}\n\nClique no item para escolher pagar via *PIX* ou *Binance Pay*:`;
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } else {
      await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
    }
  }

  async showHelp(ctx) {
    const helpText = `ℹ️ *COMO FUNCIONA*\n\n` +
      `1️⃣ *Escolha:* Selecione um produto ou plano.\n` +
      `2️⃣ *Forma de Pagamento:*\n` +
      `   • 🟢 *PIX:* Receba o QR Code e o código Copia e Cola direto aqui no chat.\n` +
      `   • 🟡 *Binance Pay:* Pague em USDT direto pelo app da Binance.\n` +
      `3️⃣ *Entrega Automática:* O sistema detecta o pagamento em segundos e entrega seu produto ou link exclusivo do canal VIP aqui mesmo!`;

    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]]);
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await ctx.replyWithMarkdown(helpText, keyboard);
    }
  }

  async sendMessage(chatId, text) {
    if (!this.bot || !this.isRunning) return false;
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return true;
    } catch (err) {
      try {
        await this.bot.telegram.sendMessage(chatId, text);
        return true;
      } catch (err2) {
        console.error(`[Telegram ❌ Erro ao enviar para ${chatId}]:`, err2.message);
        return false;
      }
    }
  }

  async createInviteLink(channelId) {
    if (!this.bot || !this.isRunning) return null;
    try {
      const link = await this.bot.telegram.createChatInviteLink(channelId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + (86400 * 3)
      });
      return link.invite_link;
    } catch (err) {
      console.error(`[Telegram ❌ Erro no link VIP]:`, err.message);
      return null;
    }
  }

  async removeMember(channelId, userId) {
    if (!this.bot || !this.isRunning) return false;
    try {
      await this.bot.telegram.banChatMember(channelId, Number(userId));
      await this.bot.telegram.unbanChatMember(channelId, Number(userId));
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = new TelegramBotService();

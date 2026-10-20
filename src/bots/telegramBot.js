const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
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

      // Registra no serviço de fulfillment para envio e gestão do canal VIP
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
    // Comando /start
    this.bot.start(async (ctx) => {
      const userName = ctx.from.first_name || 'Cliente';
      const welcomeText = `👋 Olá, *${userName}*! Seja muito bem-vindo à nossa plataforma.\n\n` +
        `Aqui você pode adquirir nossos produtos digitais e assinaturas VIP com cobrança automática em criptomoedas via *Binance Pay* (USDT).\n\n` +
        `Escolha uma das opções abaixo para começar:`;

      await ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    // Comandos diretos
    this.bot.command('produtos', (ctx) => this.showProducts(ctx, false));
    this.bot.command('planos', (ctx) => this.showProducts(ctx, true));
    this.bot.command('ajuda', (ctx) => this.showHelp(ctx));

    // Ações de Navegação
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
        text += `• *#${o.merchant_trade_no}* | ${o.product_name}\n  Status: ${statusEmoji} | ${o.amount} ${o.currency}\n\n`;
      });

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]])
      });
    });

    // Ação de seleção de produto para compra: 'buy_<productId>'
    this.bot.action(/^buy_(\d+)$/, async (ctx) => {
      const productId = parseInt(ctx.match[1], 10);
      const product = models.getProductById(productId);

      if (!product || !product.active) {
        return ctx.answerCbQuery('Produto não disponível no momento.');
      }

      await ctx.answerCbQuery('Gerando fatura Binance Pay...');

      // Verifica estoque caso seja chave
      if (product.type === 'license_key') {
        const availableCount = models.getAvailableKeyCount(product.id);
        if (availableCount <= 0) {
          return ctx.reply('⚠️ Desculpe, o estoque deste item está zerado no momento. Tente novamente mais tarde.');
        }
      }

      const tradeNo = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Telegram User');

      // Chama Binance Pay para gerar ordem
      const binanceRes = await binancePay.createOrder({
        merchantTradeNo: tradeNo,
        amount: product.price,
        currency: product.currency || 'USDT',
        goodsName: product.name,
        goodsDetail: product.description,
        productId: product.id
      });

      if (!binanceRes.success) {
        return ctx.reply(`❌ Ocorreu um erro ao comunicar com a Binance Pay:\n${binanceRes.errorMessage}`);
      }

      const payData = binanceRes.data;

      // Salva pedido como PENDING no banco
      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
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

        const captionText = `🧾 *FATURA GERADA COM SUCESSO!*\n\n` +
          `📦 *Item:* ${product.name}\n` +
          `💰 *Valor:* \`${product.price.toFixed(2)} ${product.currency}\`\n` +
          `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
          `📲 *Como pagar:*\n` +
          `1. Abra o app da *Binance* e aponte a câmera para o QR Code acima.\n` +
          `2. Ou clique no botão *💳 Pagar com Binance Pay* abaixo.\n\n` +
          `⚡ *A entrega é instantânea e automática assim que o pagamento for concluído!*`;

        const buttons = [
          [Markup.button.url('💳 Pagar com Binance Pay', payData.checkoutUrl)],
          [Markup.button.callback('🔄 Já Paguei / Verificar', `check_${tradeNo}`)],
          [Markup.button.callback('⬅️ Cancelar', `cancel_${tradeNo}`)]
        ];

        // Se estiver em modo simulação, adiciona botão de teste
        if (binanceRes.isSimulated) {
          buttons.splice(1, 0, [Markup.button.url('🟡 [TESTE] Simular Pagamento', payData.checkoutUrl)]);
        }

        await ctx.replyWithPhoto({ source: qrBuffer }, {
          caption: captionText,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (qrErr) {
        console.error('[Telegram ❌ Erro ao gerar imagem QR]:', qrErr.message);
        await ctx.reply(`Pedido gerado! Link para pagamento:\n${payData.checkoutUrl}`);
      }
    });

    // Ação: Verificar pagamento
    this.bot.action(/^check_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      await ctx.answerCbQuery('Consultando status na Binance...');

      const order = models.getOrderByTradeNo(tradeNo);
      if (!order) {
        return ctx.reply('Pedido não encontrado.');
      }

      if (order.status === 'PAID') {
        return ctx.reply('✅ Este pedido já foi pago e entregue!');
      }

      // Consulta Binance Pay
      const queryRes = await binancePay.queryOrder(tradeNo);
      if (queryRes.success && queryRes.status === 'PAID') {
        await ctx.reply('🎉 Pagamento confirmado pela Binance Pay!');
        await fulfillment.fulfillOrder(tradeNo);
      } else {
        await ctx.reply('⏳ Pagamento ainda não identificado no sistema da Binance. Se acabou de transferir, aguarde alguns segundos que a entrega é automática!');
      }
    });

    // Ação: Cancelar pedido
    this.bot.action(/^cancel_([A-Za-z0-9_]+)$/, async (ctx) => {
      const tradeNo = ctx.match[1];
      models.updateOrderStatus(tradeNo, 'CANCELED');
      await ctx.answerCbQuery('Pedido cancelado.');
      await ctx.reply('❌ Pedido cancelado com sucesso.');
    });
  }

  async showProducts(ctx, isSubscription = false) {
    const products = models.getProducts(true).filter(p => {
      return isSubscription ? p.type === 'vip_subscription' : p.type !== 'vip_subscription';
    });

    if (products.length === 0) {
      const emptyMsg = isSubscription 
        ? 'Nenhuma assinatura disponível no momento.' 
        : 'Nenhum produto digital cadastrado no momento.';
      return ctx.reply(emptyMsg, Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]
      ]));
    }

    const title = isSubscription ? '⭐ *ASSINATURAS VIP DISPONÍVEIS:*' : '🛍️ *PRODUTOS DIGITAIS:*';
    const buttons = products.map(p => {
      const detail = p.duration_days ? ` (${p.duration_days} dias)` : '';
      return [Markup.button.callback(`🛒 ${p.name}${detail} - ${p.price} ${p.currency}`, `buy_${p.id}`)];
    });
    buttons.push([Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]);

    const msg = `${title}\n\nClique no item desejado para ver detalhes e gerar a cobrança Binance Pay:`;
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    } else {
      await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
    }
  }

  async showHelp(ctx) {
    const helpText = `ℹ️ *COMO FUNCIONA O PAGAMENTO & ENTREGA*\n\n` +
      `1️⃣ *Escolha:* Selecione um produto ou assinatura no catálogo.\n` +
      `2️⃣ *Pague com Binance Pay:* Você receberá um QR Code e um link seguro oficial da Binance.\n` +
      `3️⃣ *Entrega Instantânea:* Assim que a Binance confirma a transação (geralmente em 3 a 10 segundos), o bot envia seu link, licença ou link exclusivo do canal VIP aqui mesmo no chat!\n\n` +
      `💡 *Dúvidas ou Suporte:* Contate nosso suporte pelo Telegram ou WhatsApp.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]
    ]);

    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await ctx.replyWithMarkdown(helpText, keyboard);
    }
  }

  async sendMessage(chatId, text) {
    if (!this.bot || !this.isRunning) {
      console.log(`[Telegram ⚠️] Bot não está rodando. Mensagem para ${chatId} pendente: ${text.slice(0, 50)}...`);
      return false;
    }
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return true;
    } catch (err) {
      // Tenta enviar como texto puro se falhar no Markdown
      try {
        await this.bot.telegram.sendMessage(chatId, text);
        return true;
      } catch (err2) {
        console.error(`[Telegram ❌ Erro ao enviar mensagem para ${chatId}]:`, err2.message);
        return false;
      }
    }
  }

  async createInviteLink(channelId) {
    if (!this.bot || !this.isRunning) return null;
    try {
      // Cria link com limite de 1 pessoa e validade de 3 dias
      const link = await this.bot.telegram.createChatInviteLink(channelId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + (86400 * 3)
      });
      return link.invite_link;
    } catch (err) {
      console.error(`[Telegram ❌ Falha ao criar link de convite VIP no canal ${channelId}]:`, err.message);
      return null;
    }
  }

  async removeMember(channelId, userId) {
    if (!this.bot || !this.isRunning) return false;
    try {
      // Ban e unban remove o membro sem deixá-lo permanentemente bloqueado
      await this.bot.telegram.banChatMember(channelId, Number(userId));
      await this.bot.telegram.unbanChatMember(channelId, Number(userId));
      return true;
    } catch (err) {
      console.error(`[Telegram ❌ Erro ao remover membro ${userId} do canal ${channelId}]:`, err.message);
      return false;
    }
  }
}

module.exports = new TelegramBotService();

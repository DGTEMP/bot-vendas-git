const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');
const binancePay = require('../services/binancePay');
const pixPayment = require('../services/pixPayment');
const fulfillment = require('../services/fulfillment');
const updatesChannel = require('../services/updatesChannel');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.isRunning = false;
    this.userReferrals = new Map(); // Armazena affiliate_id e ref_code por user_id
    this.userCoupons = new Map(); // Armazena cupom ativo por user_id
  }

  async start() {
    const token = models.getSetting('TELEGRAM_BOT_TOKEN', config.telegram.botToken);

    if (!token) {
      console.log('🤖 [Telegram] Token não configurado. O bot do Telegram iniciará quando você inserir o token no Painel Web ou no .env');
      return;
    }

    try {
      this.bot = new Telegraf(token);

      this.bot.catch((err, ctx) => {
        console.error(`[Telegram ⚠️ Erro interceptado em update ${ctx?.updateType}]:`, err.message);
      });

      fulfillment.registerTelegramBot({
        sendMessage: (chatId, text) => this.sendMessage(chatId, text),
        sendUpsell: (chatId, text, data) => this.sendUpsell(chatId, text, data),
        createInviteLink: (channelId) => this.createInviteLink(channelId),
        removeMember: (channelId, userId) => this.removeMember(channelId, userId)
      });

      updatesChannel.registerTelegramBroadcaster((channelId, text, options) => {
        return this.sendChannelPost(channelId, text, options);
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

  async checkTelegramAdmin(ctx) {
    if (!ctx.chat) return false;
    if (ctx.chat.type === 'private') return true;
    try {
      const chatMember = await ctx.getChatMember(ctx.from.id);
      return chatMember.status === 'creator' || chatMember.status === 'administrator';
    } catch (_) {
      return false;
    }
  }

  setupHandlers() {
    // Middleware de Moderação & Controle de Acesso (Mute & Blacklist)
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat ? String(ctx.chat.id) : null;
      const userId = ctx.from ? String(ctx.from.id) : null;

      // 1. Verifica se o participante está bloqueado
      if (userId && models.isUserBlocked('telegram', userId, chatId)) {
        return; // Usuário bloqueado: silêncio absoluto
      }

      // 2. Se o chat estiver desativado/mutado
      if (chatId && models.isChatMuted('telegram', chatId)) {
        const text = (ctx.message?.text || '').trim();
        const isReactivateCmd = /^\/(?:ativar|despausar|unmute|startbot)(?:@\w+)?(?:\s.*)?$/i.test(text);
        if (!isReactivateCmd) {
          return; // Chat mutado: silêncio para todas as mensagens exceto reativação
        }
      }

      return next();
    });

    // Comandos de Moderação e Controle do Bot
    this.bot.command(['desativar', 'pausar', 'mute', 'stopbot'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem desativar o bot.');
      }
      const isGroup = ctx.chat.type !== 'private';
      models.muteChat({
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        targetType: isGroup ? 'GROUP' : 'PRIVATE',
        reason: isGroup ? 'Desativado por moderador no grupo' : 'Desativado a pedido na conversa privada',
        createdBy: String(ctx.from.id),
        userName: ctx.chat.title || ctx.from.first_name
      });
      await ctx.reply(`🛑 *BOT DESATIVADO NESTE ${isGroup ? 'GRUPO' : 'CHAT'}!*\n\nO bot não responderá comandos ou mensagens aqui.\n\nPara reativar a qualquer momento, envie /ativar.`, { parse_mode: 'Markdown' });
    });

    this.bot.command(['ativar', 'despausar', 'unmute', 'startbot'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem reativar o bot.');
      }
      models.unmuteChat('telegram', String(ctx.chat.id));
      await ctx.reply('🟢 *BOT REATIVADO COM SUCESSO!*\n\nO atendimento automático e vendas estão operando normalmente.', { parse_mode: 'Markdown' });
    });

    this.bot.command(['bloquear', 'block'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem bloquear participantes.');
      }

      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      let targetId = null;
      let targetName = null;

      if (ctx.message?.reply_to_message?.from) {
        const u = ctx.message.reply_to_message.from;
        targetId = String(u.id);
        targetName = u.username ? `@${u.username}` : (u.first_name || targetId);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parts[1].replace(/[^0-9a-zA-Z_@]/g, '');
          targetName = targetId;
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ *Como bloquear um participante:*\n• Responda à mensagem da pessoa com `/bloquear`\n• Ou envie `/bloquear ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      models.blockUser({
        platform: 'telegram',
        userId: targetId,
        chatId: isGroup ? chatId : null,
        targetType: 'USER',
        reason: isGroup ? 'Bloqueado no grupo por administrador' : 'Bloqueado por administrador',
        createdBy: String(ctx.from.id),
        userName: targetName
      });

      return ctx.reply(`🚫 *Participante bloqueado com sucesso!*\n\nO usuário *${targetName}* foi bloqueado e não poderá mais interagir com o bot ${isGroup ? 'neste grupo' : 'no sistema'}.\n\nPara desbloquear: \`/desbloquear ${targetId}\``, { parse_mode: 'Markdown' });
    });

    this.bot.command(['desbloquear', 'unblock'], async (ctx) => {
      const isAdmin = await this.checkTelegramAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply('⚠️ Apenas administradores podem desbloquear participantes.');
      }

      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      let targetId = null;

      if (ctx.message?.reply_to_message?.from) {
        targetId = String(ctx.message.reply_to_message.from.id);
      } else {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1) {
          targetId = parts[1].replace(/[^0-9a-zA-Z_@]/g, '');
        }
      }

      if (!targetId) {
        return ctx.reply('ℹ️ *Como desbloquear:* responda à mensagem da pessoa com `/desbloquear` ou envie `/desbloquear ID_DO_USUARIO`', { parse_mode: 'Markdown' });
      }

      models.unblockUser('telegram', targetId, isGroup ? chatId : null);
      return ctx.reply(`✅ *Participante desbloqueado!*\n\nO usuário *${targetId}* agora pode interagir com o bot normalmente.`, { parse_mode: 'Markdown' });
    });

    this.bot.command(['statusbot', 'mod'], async (ctx) => {
      const chatId = String(ctx.chat.id);
      const isGroup = ctx.chat.type !== 'private';
      const isMuted = models.isChatMuted('telegram', chatId);
      const controls = models.getChatControls({ platform: 'telegram', activeOnly: true });
      const blockedInThisChat = controls.filter(c => c.control_type === 'BLOCK_USER' && (c.chat_id === chatId || c.chat_id === '*'));

      let statusText = `📊 *MODERAÇÃO & STATUS DO BOT (TELEGRAM):*\n\n` +
        `• *Tipo do Chat:* ${isGroup ? 'Grupo / Supergrupo' : 'Conversa Privada'}\n` +
        `• *Chat ID:* \`${chatId}\`\n` +
        `• *Status:* ${isMuted ? '🔴 Desativado (Muted)' : '🟢 Ativo'}\n` +
        `• *Participantes Bloqueados:* ${blockedInThisChat.length}\n\n`;

      if (blockedInThisChat.length > 0) {
        statusText += `*Bloqueados neste chat:*\n`;
        blockedInThisChat.slice(0, 5).forEach(b => {
          statusText += `• ${b.user_name || b.user_id} (${b.reason || 'Sem motivo'})\n`;
        });
        statusText += `\n`;
      }

      statusText += `_Comandos úteis: /desativar, /ativar, /bloquear, /desbloquear_`;
      return ctx.reply(statusText, { parse_mode: 'Markdown' });
    });

    // /start com suporte a Links de Afiliados e Ofertas (Deep-Linking: /start ref_CODIGO ou /start buy_ID)
    this.bot.start(async (ctx) => {
      const userName = ctx.from.first_name || 'Cliente';
      const userId = String(ctx.from.id);

      // Captura código de afiliado e/ou compra direta de produto se presente no link
      if (ctx.startPayload) {
        const payload = ctx.startPayload;

        // 1. Vincula afiliado se presente (ex: ref_CODIGO ou ref_CODIGO_buy_1)
        const refMatch = payload.match(/ref_([a-zA-Z0-9_-]+)/i);
        if (refMatch) {
          const cleanCode = refMatch[1].split('_')[0].toUpperCase();
          const affiliate = models.getAffiliateByCode(cleanCode);
          if (affiliate) {
            this.userReferrals.set(userId, {
              affiliate_id: affiliate.id,
              ref_code: affiliate.ref_code
            });
            console.log(`[Telegram 🤝] Usuário ${userId} (${userName}) vinculado ao afiliado ${affiliate.name} (#${affiliate.ref_code})`);
          }
        }

        // 2. Compra direta vinda do canal de ofertas (ex: buy_1 ou ref_TOPVIP_buy_1)
        const buyMatch = payload.match(/buy_(\d+)/i);
        if (buyMatch) {
          const productId = parseInt(buyMatch[1], 10);
          const product = models.getProductById(productId);
          if (product && product.active) {
            console.log(`[Telegram ⚡ Checkout Direto de Oferta] Abrindo item #${product.id} (${product.name}) para ${userName}`);
            return this.showProductDetails(ctx, product, false);
          }
        }

        // 3. Ativação de Cupom via link (ex: cupom_PROMO10)
        const couponMatch = payload.match(/cupo[nm]_([a-zA-Z0-9_-]+)/i);
        if (couponMatch) {
          const coupon = models.getCouponByCode(couponMatch[1]);
          if (coupon) {
            this.userCoupons.set(userId, coupon);
            console.log(`[Telegram 🎟️] Cupom ${coupon.code} (${coupon.discount_percent}%) ativado para ${userId}`);
          }
        }
      }

      const botName = models.getSetting('BOT_NAME', 'PayBot');
      const welcomeCustom = models.getSetting('WELCOME_MESSAGE', '👋 Olá! Seja muito bem-vindo.');

      let welcomeText = `${welcomeCustom}\n\n` +
        `Aqui você pode adquirir nossos produtos digitais e assinaturas VIP com cobrança automática via *PIX* ou *Binance Pay* (USDT).\n\n`;

      if (this.userCoupons.has(userId)) {
        const c = this.userCoupons.get(userId);
        welcomeText += `🎟️ *Cupom Ativo:* \`${c.code}\` (*${c.discount_percent}% OFF* aplicado na sua próxima compra!)\n\n`;
      }

      welcomeText += `Escolha uma das opções abaixo:`;

      await ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
        [Markup.button.callback('🛍️ Produtos Digitais', 'nav_products')],
        [Markup.button.callback('⭐ Assinaturas VIP', 'nav_subs')],
        [Markup.button.callback('📦 Meus Pedidos', 'nav_my_orders')],
        [Markup.button.callback('❓ Como Funciona', 'nav_help')]
      ]));
    });

    this.bot.command('cupom', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      if (parts.length < 2) {
        return ctx.reply('ℹ️ Como usar: envie `/cupom SEU_CUPOM` (ex: `/cupom PROMO10`)', { parse_mode: 'Markdown' });
      }
      const code = parts[1].toUpperCase();
      const coupon = models.getCouponByCode(code);
      if (!coupon) {
        return ctx.reply('❌ Cupom inválido, esgotado ou expirado.');
      }
      this.userCoupons.set(String(ctx.from.id), coupon);
      return ctx.reply(`🎉 *Cupom ${coupon.code} Aplicado com Sucesso!*\n\nVocê ganhou *${coupon.discount_percent}% de desconto* para sua próxima compra! Acesse o menu e escolha seu produto.`, { parse_mode: 'Markdown' });
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
      await this.showProductDetails(ctx, product, true);
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
      let amount = product.price_brl || product.price;

      // Aplica Cupom de Desconto se houver
      let couponCode = null;
      let discountAmount = 0;
      const activeCoupon = this.userCoupons.get(userId);
      if (activeCoupon) {
        discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
        amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
        couponCode = activeCoupon.code;
        models.useCoupon(activeCoupon.code);
        this.userCoupons.delete(userId);
      }

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

      // Obtém afiliado e vendedor para comissão
      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

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
        pix_code: pixCode,
        affiliate_id: refInfo.affiliate_id || null,
        seller_id: sellerId,
        ref_code: refInfo.ref_code || null,
        coupon_code: couponCode,
        discount_amount: discountAmount
      });

      const couponNotice = couponCode ? ` (Cupom *${couponCode}* aplicado: -R$ ${discountAmount.toFixed(2)})` : '';
      const captionText = `🟢 *PAGAMENTO VIA PIX GERADO!*\n\n` +
        `📦 *Item:* ${product.name}\n` +
        `💰 *Valor:* *R$ ${Number(amount).toFixed(2)}*${couponNotice}\n` +
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
      let amount = Number(product.price_usdt || (product.price / 5.5)).toFixed(2);

      // Aplica Cupom de Desconto se houver
      let couponCode = null;
      let discountAmount = 0;
      const activeCoupon = this.userCoupons.get(userId);
      if (activeCoupon) {
        discountAmount = Number(((amount * activeCoupon.discount_percent) / 100).toFixed(2));
        amount = Number(Math.max(0.50, amount - discountAmount).toFixed(2));
        couponCode = activeCoupon.code;
        models.useCoupon(activeCoupon.code);
        this.userCoupons.delete(userId);
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
        return ctx.reply(`❌ Erro Binance Pay: ${binanceRes.errorMessage}`);
      }

      const payData = binanceRes.data;

      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

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
        qr_content: payData.qrContent,
        affiliate_id: refInfo.affiliate_id || null,
        seller_id: sellerId,
        ref_code: refInfo.ref_code || null,
        coupon_code: couponCode,
        discount_amount: discountAmount
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

      const refInfo = this.userReferrals.get(userId) || {};
      let sellerId = null;
      if (models.getSetting('ROUND_ROBIN_SELLERS', 'true') === 'true') {
        const nextSeller = models.getNextRoundRobinSeller(product.id);
        if (nextSeller) sellerId = nextSeller.id;
      }

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'livepix',
        amount,
        currency: 'BRL',
        checkout_url: `https://livepix.gg/${username}`,
        affiliate_id: refInfo.affiliate_id || null,
        seller_id: sellerId,
        ref_code: refInfo.ref_code || null
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

    // Fechar oferta de Upsell
    this.bot.action('dismiss_upsell', async (ctx) => {
      await ctx.answerCbQuery('Oferta dispensada.');
      try {
        await ctx.deleteMessage();
      } catch (e) {}
    });

    // Pagar Upsell com PIX
    this.bot.action(/^pay_upsell_pix_(\d+)_(\d+)$/, async (ctx) => {
      const upsellProdId = parseInt(ctx.match[2], 10);
      const product = models.getProductById(upsellProdId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando PIX com desconto exclusivo...');
      const tradeNo = `ORD_UP_PIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');

      const discountPercent = product.upsell_discount_percent || 20.0;
      const discountedAmount = Number((product.price_brl * (1 - discountPercent / 100)).toFixed(2));

      const pixRes = await pixPayment.createPixCharge({
        merchantTradeNo: tradeNo,
        amount: discountedAmount,
        goodsName: `[UPSELL] ${product.name}`,
        payerName: userName
      });

      if (!pixRes.success) return ctx.reply(`❌ Erro: ${pixRes.errorMessage}`);

      const { pixCode, qrBuffer, checkoutUrl, paymentId } = pixRes.data;

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'mercadopago',
        amount: discountedAmount,
        currency: 'BRL',
        prepay_id: paymentId,
        checkout_url: checkoutUrl,
        pix_code: pixCode,
        is_upsell: 1
      });

      const captionText = `🔥 *OFERTA UPSELL: PIX COM DESCONTO GERADO!*\n\n` +
        `📦 *Item Adicional:* ${product.name}\n` +
        `💰 *Valor Especial:* *R$ ${discountedAmount.toFixed(2)}* (${discountPercent}% OFF)\n` +
        `🆔 *Pedido:* \`${tradeNo}\`\n\n` +
        `📲 *Pix Copia e Cola:*\n\`${pixCode}\``;

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

    // Pagar Upsell com Binance Pay
    this.bot.action(/^pay_upsell_bpay_(\d+)_(\d+)$/, async (ctx) => {
      const upsellProdId = parseInt(ctx.match[2], 10);
      const product = models.getProductById(upsellProdId);
      if (!product) return ctx.answerCbQuery('Produto não encontrado.');

      await ctx.answerCbQuery('Gerando fatura Binance Pay...');
      const tradeNo = `ORD_UP_BNB_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userId = String(ctx.from.id);
      const userName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Cliente');

      const discountPercent = product.upsell_discount_percent || 20.0;
      const discountedUsdt = Number((product.price_usdt * (1 - discountPercent / 100)).toFixed(2));

      const binanceRes = await binancePay.createOrder({
        merchantTradeNo: tradeNo,
        amount: discountedUsdt,
        currency: 'USDT',
        goodsName: `[UPSELL] ${product.name}`,
        productId: product.id
      });

      if (!binanceRes.success) return ctx.reply(`❌ Erro Binance Pay: ${binanceRes.errorMessage}`);

      const payData = binanceRes.data;
      const qrBuffer = await QRCode.toBuffer(payData.qrContent || payData.checkoutUrl, { width: 360, margin: 2 });

      models.createOrder({
        merchant_trade_no: tradeNo,
        platform: 'telegram',
        platform_user_id: userId,
        platform_user_name: userName,
        product_id: product.id,
        gateway: 'binancepay',
        amount: discountedUsdt,
        currency: 'USDT',
        prepay_id: payData.prepayId,
        checkout_url: payData.checkoutUrl,
        qr_content: payData.qrContent,
        is_upsell: 1
      });

      const captionText = `🔥 *OFERTA UPSELL: BINANCE PAY COM DESCONTO!*\n\n` +
        `📦 *Item Adicional:* ${product.name}\n` +
        `💰 *Valor Especial:* *${discountedUsdt.toFixed(2)} USDT* (${discountPercent}% OFF)\n` +
        `🆔 *Pedido:* \`${tradeNo}\``;

      const buttons = [
        [Markup.button.url('🟡 Pagar no App Binance', payData.checkoutUrl)],
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

    // Atendimento Inteligente em Linguagem Natural PT-BR
    this.bot.on('text', async (ctx) => {
      const text = ctx.message?.text?.trim() || '';
      if (text.startsWith('/')) return; // Deixa comandos /start, /produtos, /cupom para os handlers de comando

      const userName = ctx.from.first_name || 'Cliente';
      try {
        const nlpService = require('../services/nlpService');
        const nlp = await nlpService.processMessage({
          text,
          customerName: userName,
          platform: 'telegram'
        });

        if (nlp.directAction === 'SHOW_MENU') {
          return this.showProducts(ctx, false);
        }

        if (nlp.entities?.matchedProduct && (nlp.directAction === 'TRIGGER_PIX' || nlp.directAction === 'TRIGGER_BINANCE' || nlp.intent === 'BUY_INTENT')) {
          if (nlp.replyText) {
            await ctx.reply(nlp.replyText, { parse_mode: 'Markdown' });
          }
          return this.showProductDetails(ctx, nlp.entities.matchedProduct, false);
        }

        if (nlp.replyText) {
          await ctx.reply(nlp.replyText, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('[Telegram NLP Error]:', err.message);
      }
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

  async showProductDetails(ctx, product, isEdit = true) {
    if (!product || !product.active) {
      if (ctx.callbackQuery) return ctx.answerCbQuery('Produto indisponível no momento.');
      return ctx.reply('⚠️ Produto indisponível no momento.');
    }

    if (product.type === 'license_key') {
      const available = models.getAvailableKeyCount(product.id);
      if (available <= 0) {
        if (ctx.callbackQuery) return ctx.answerCbQuery('Estoque esgotado.');
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

    buttons.push([Markup.button.callback('⬅️ Voltar ao Início', 'nav_main')]);

    const detailsText = `📦 *${product.name}*\n\n` +
      (product.description ? `_${product.description}_\n\n` : '') +
      `💵 *Preço:* R$ ${Number(brlPrice).toFixed(2)} ou ${Number(usdtPrice).toFixed(2)} USDT\n\n` +
      `Como deseja efetuar o pagamento?`;

    if (isEdit && ctx.callbackQuery) {
      await ctx.editMessageText(detailsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    } else {
      await ctx.replyWithMarkdown(detailsText, Markup.inlineKeyboard(buttons));
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

  async sendChannelPost(channelId, text, { imageUrl = null, buttons = null } = {}) {
    if (!this.bot || !this.isRunning) return false;
    try {
      const keyboard = buttons && buttons.length > 0 
        ? { inline_keyboard: buttons } 
        : undefined;

      if (imageUrl) {
        await this.bot.telegram.sendPhoto(channelId, imageUrl, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await this.bot.telegram.sendMessage(channelId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
      return true;
    } catch (err) {
      console.error(`[Telegram ❌ Erro ao postar no canal ${channelId}]:`, err.message);
      return false;
    }
  }

  async sendUpsell(chatId, text, { orderId, upsellProductId, discountedBrl, discountedUsdt }) {
    if (!this.bot || !this.isRunning) return false;
    try {
      const isPix = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
      const isBinance = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';

      const buttons = [];
      if (isPix) {
        buttons.push([Markup.button.callback(`🚀 Sim! Levar com PIX (R$ ${discountedBrl.toFixed(2)})`, `pay_upsell_pix_${orderId}_${upsellProductId}`)]);
      }
      if (isBinance) {
        buttons.push([Markup.button.callback(`🟡 Sim! Levar com Binance Pay (${discountedUsdt.toFixed(2)} USDT)`, `pay_upsell_bpay_${orderId}_${upsellProductId}`)]);
      }
      buttons.push([Markup.button.callback('❌ Não, obrigado', 'dismiss_upsell')]);

      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
      return true;
    } catch (err) {
      console.error(`[Telegram ❌ Erro ao enviar Upsell para ${chatId}]:`, err.message);
      return false;
    }
  }
}

module.exports = new TelegramBotService();

const models = require('../db/models');

class UpdatesChannelService {
  constructor() {
    this.postToTelegramChannel = null;
  }

  registerTelegramBroadcaster(fn) {
    this.postToTelegramChannel = fn;
  }

  // Mascara nome ou telefone do cliente para privacidade e prova social
  maskCustomerIdentity(nameOrPhone) {
    if (!nameOrPhone) return 'Cliente';

    // Se for número de telefone (WhatsApp)
    if (/^\d+(@s\.whatsapp\.net)?$/.test(nameOrPhone)) {
      const digits = nameOrPhone.replace(/\D/g, '');
      if (digits.length >= 8) {
        return digits.slice(0, 4) + '*****' + digits.slice(-3);
      }
      return 'Cliente WhatsApp';
    }

    // Se for username do Telegram
    if (nameOrPhone.startsWith('@')) {
      const user = nameOrPhone.slice(1);
      if (user.length > 3) {
        return '@' + user.slice(0, 2) + '***' + user.slice(-1);
      }
      return '@usuário';
    }

    // Se for nome completo
    const parts = nameOrPhone.split(' ');
    if (parts.length > 1) {
      const first = parts[0];
      const maskedFirst = first.length > 3 ? first.slice(0, 3) + '***' : first;
      return `${maskedFirst} ${parts[1][0]}.`;
    }

    return nameOrPhone.length > 3 ? nameOrPhone.slice(0, 3) + '***' : nameOrPhone;
  }

  // Publica transação confirmada no canal de atualizações
  async broadcastTransaction(order) {
    const isAutoPost = models.getSetting('AUTO_POST_TRANSACTIONS', 'true') === 'true';
    const channelId = models.getSetting('TELEGRAM_UPDATES_CHANNEL_ID');

    if (!isAutoPost || !channelId || !this.postToTelegramChannel) {
      return false;
    }

    try {
      const isMasked = models.getSetting('MASK_CUSTOMER_NAME', 'true') === 'true';
      const rawCustomer = order.platform_user_name || order.platform_user_id;
      const customerDisplay = isMasked ? this.maskCustomerIdentity(rawCustomer) : rawCustomer;

      const botUsername = (models.getSetting('TELEGRAM_BOT_USERNAME') || 'seu_bot').replace('@', '');
      const botUrl = `https://t.me/${botUsername}`;

      const dateStr = new Date().toLocaleString('pt-BR');
      const valorStr = order.currency === 'BRL' ? `R$ ${order.amount.toFixed(2)}` : `${order.amount.toFixed(2)} USDT`;
      const gatewayStr = (order.gateway === 'mercadopago' || order.gateway === 'livepix' || order.gateway === 'bacen') ? 'PIX' : (order.gateway === 'binancepay' ? 'Binance Pay' : (order.gateway === 'crypto' ? 'Cripto' : 'PIX'));

      const message = `⚡ *NOVA TRANSAÇÃO CONFIRMADA!* ⚡\n\n` +
        `📦 *Item:* ${order.product_name || 'Produto Digital'}\n` +
        `💰 *Valor:* ${valorStr} (${gatewayStr})\n` +
        `👤 *Cliente:* \`${customerDisplay}\` (${order.platform.toUpperCase()})\n` +
        `⏱️ *Data:* ${dateStr}\n\n` +
        `🚀 *Status:* Entrega automática instantânea liberada!\n` +
        `✨ Faça como ele, adquira o seu no bot com total segurança.`;

      const buttons = [
        [{ text: '🛒 Comprar no Bot Agora', url: botUrl }]
      ];

      await this.postToTelegramChannel(channelId, message, { buttons });
      console.log(`[Canal Atualizações 📢] Transação #${order.merchant_trade_no} publicada no canal ${channelId}`);
      return true;
    } catch (err) {
      console.error('[Canal Atualizações ❌ Erro ao publicar transação]:', err.message);
      return false;
    }
  }

  // Publica oferta ou promoção personalizada criada no painel admin
  async broadcastOffer({ title, content, image_url, product_id, cta_text, cta_url }) {
    const channelId = models.getSetting('TELEGRAM_UPDATES_CHANNEL_ID');
    if (!channelId || !this.postToTelegramChannel) {
      throw new Error('Canal de atualizações não configurado. Defina o ID do canal na Central de Configurações.');
    }

    const botUsername = (models.getSetting('TELEGRAM_BOT_USERNAME') || 'seu_bot').replace('@', '');
    const defaultCtaUrl = product_id 
      ? `https://t.me/${botUsername}?start=buy_${product_id}`
      : `https://t.me/${botUsername}`;

    const finalCtaUrl = cta_url || defaultCtaUrl;
    const finalCtaText = cta_text || '🛒 Aproveitar Oferta Agora';

    // Salva oferta no banco de dados
    const savedOffer = models.createOffer({
      title,
      content,
      image_url,
      product_id,
      cta_text: finalCtaText,
      cta_url: finalCtaUrl
    });

    const message = `🔥 *${title.toUpperCase()}* 🔥\n\n` +
      `${content}\n\n` +
      `⚡ *Aproveite antes que acabe! Clique no botão abaixo:*`;

    const buttons = [
      [{ text: finalCtaText, url: finalCtaUrl }]
    ];

    await this.postToTelegramChannel(channelId, message, {
      imageUrl: image_url,
      buttons
    });

    console.log(`[Canal Atualizações 📢] Oferta "${title}" publicada com sucesso no canal ${channelId}!`);
    return savedOffer;
  }
}

module.exports = new UpdatesChannelService();

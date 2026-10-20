const models = require('../db/models');

class FulfillmentService {
  constructor() {
    this.sendTelegramMessage = null;
    this.sendWhatsAppMessage = null;
    this.createTelegramInviteLink = null;
    this.removeTelegramMember = null;
  }

  // Registra as funções de envio dos bots
  registerTelegramBot({ sendMessage, createInviteLink, removeMember }) {
    this.sendTelegramMessage = sendMessage;
    this.createTelegramInviteLink = createInviteLink;
    this.removeTelegramMember = removeMember;
  }

  registerWhatsAppBot({ sendMessage }) {
    this.sendWhatsAppMessage = sendMessage;
  }

  async fulfillOrder(merchantTradeNo) {
    const order = models.getOrderByTradeNo(merchantTradeNo);
    if (!order) {
      console.error(`[Fulfillment ❌] Pedido não encontrado: ${merchantTradeNo}`);
      return { success: false, error: 'Pedido não encontrado' };
    }

    if (order.status === 'PAID' && order.delivered_content) {
      console.log(`[Fulfillment ℹ️] Pedido ${merchantTradeNo} já foi entregue anteriormente.`);
      return { success: true, alreadyDelivered: true, order };
    }

    console.log(`[Fulfillment 🚀] Processando entrega para o pedido: ${merchantTradeNo} (${order.platform} - ${order.platform_user_id})`);

    let deliveredContent = '';
    const product = models.getProductById(order.product_id);
    if (!product) {
      console.error(`[Fulfillment ❌] Produto ID ${order.product_id} não encontrado.`);
      return { success: false, error: 'Produto não encontrado' };
    }

    // 1. ENTREGA DE PRODUTO DIGITAL POR LINK / ARQUIVO
    if (product.type === 'digital_link') {
      deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
        `📦 *Produto:* ${product.name}\n` +
        `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
        `🔗 *Acesse seu produto no link abaixo:*\n${product.content}\n\n` +
        `Obrigado pela sua compra! Qualquer dúvida, estamos à disposição.`;
    }

    // 2. ENTREGA DE CHAVE DE ATIVAÇÃO / LICENÇA EM ESTOQUE
    else if (product.type === 'license_key') {
      const key = models.popAvailableKey(product.id, order.id);
      if (key) {
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
          `🔑 *Sua Chave / Credencial de Ativação:*\n` +
          `\`${key}\`\n\n` +
          `Guarde sua chave em local seguro. Se precisar de suporte, basta responder esta mensagem.`;
      } else {
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `⚠️ *Aviso de Estoque:* Nosso estoque automático deste produto acabou de zerar.\n` +
          `Nosso time já foi alertado e enviará sua chave por aqui em alguns minutos!`;
      }
    }

    // 3. ATIVAÇÃO DE ASSINATURA VIP (TELEGRAM)
    else if (product.type === 'vip_subscription') {
      const channelId = product.telegram_channel_id || models.getSetting('TELEGRAM_VIP_CHANNEL_ID');
      let inviteLink = 'https://t.me/seu_canal_vip';

      if (this.createTelegramInviteLink && channelId) {
        try {
          const generated = await this.createTelegramInviteLink(channelId);
          if (generated) inviteLink = generated;
        } catch (err) {
          console.error('[Fulfillment ⚠️ Erro ao gerar link Telegram VIP]:', err.message);
        }
      }

      const subscription = models.createSubscription({
        order_id: order.id,
        platform: order.platform,
        platform_user_id: order.platform_user_id,
        platform_user_name: order.platform_user_name,
        product_id: product.id,
        telegram_channel_id: channelId,
        duration_days: product.duration_days || 30
      });

      const endDate = new Date(subscription.end_date);
      const formattedEndDate = endDate.toLocaleDateString('pt-BR');

      deliveredContent = `🎉 *ASSINATURA VIP ATIVADA!* ⭐\n\n` +
        `📦 *Plano:* ${product.name}\n` +
        `⏳ *Duração:* ${product.duration_days} dias\n` +
        `📅 *Válido até:* ${formattedEndDate}\n\n` +
        `🔗 *Seu Link Exclusivo de Entrada:*\n${inviteLink}\n\n` +
        `⚠️ *Atenção:* Este link é de uso único. Não compartilhe com terceiros.\n` +
        `Ao expirar o prazo, o sistema removerá o acesso automaticamente caso não haja renovação.`;
    }

    // Atualiza o pedido no banco
    const updatedOrder = models.updateOrderStatus(merchantTradeNo, 'PAID', deliveredContent);

    // Envia mensagem ao cliente
    try {
      if (order.platform === 'telegram' && this.sendTelegramMessage) {
        await this.sendTelegramMessage(order.platform_user_id, deliveredContent);
      } else if (order.platform === 'whatsapp' && this.sendWhatsAppMessage) {
        await this.sendWhatsAppMessage(order.platform_user_id, deliveredContent);
      }
      console.log(`[Fulfillment ✅] Entrega enviada com sucesso para ${order.platform_user_id} via ${order.platform}`);
    } catch (sendErr) {
      console.error(`[Fulfillment ❌ Erro no envio de mensagem para cliente]:`, sendErr.message);
    }

    return {
      success: true,
      order: updatedOrder,
      deliveredContent
    };
  }
}

module.exports = new FulfillmentService();

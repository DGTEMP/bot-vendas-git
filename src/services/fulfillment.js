const models = require('../db/models');
const updatesChannel = require('./updatesChannel');

class FulfillmentService {
  constructor() {
    this.sendTelegramMessage = null;
    this.sendTelegramUpsell = null;
    this.sendWhatsAppMessage = null;
    this.createTelegramInviteLink = null;
    this.removeTelegramMember = null;
  }

  registerTelegramBot({ sendMessage, sendUpsell, createInviteLink, removeMember }) {
    this.sendTelegramMessage = sendMessage;
    this.sendTelegramUpsell = sendUpsell;
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

    // 4. ATIVAÇÃO DE ALUGUEL DE BOT PARA GRUPO (NAZUNA GROUP RENTAL)
    else if (product.type === 'group_rental' || product.category === 'Aluguel') {
      const durationDays = product.duration_days || (product.name.toLowerCase().includes('vitalícia') || product.name.toLowerCase().includes('permanente') ? -1 : 30);
      const codeRes = models.generateRentalActivationCode(durationDays, null, `order:${order.id}`);
      const durText = durationDays === -1 ? 'Permanente / Vitalício ✨' : `${durationDays} dias ⏳`;

      deliveredContent = `🎉 *PAGAMENTO CONFIRMADO! SEU BOT ESTÁ LIBERADO!* 🤖\n\n` +
        `📦 *Plano:* ${product.name}\n` +
        `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
        `🔑 *Seu Código Exclusivo de Ativação do Grupo:*\n` +
        `*${codeRes.code}*\n\n` +
        `⏳ *Duração Liberada:* ${durText}\n\n` +
        `📲 *Como Ativar no Grupo:*\n` +
        `1. Adicione o bot ao seu grupo do WhatsApp;\n` +
        `2. Envie o código *${codeRes.code}* no grupo (ou digite: *!usarcodigo ${codeRes.code}*);\n` +
        `3. O bot confirmará o aluguel e todas as funções serão desbloqueadas instantaneamente!\n\n` +
        `Guarde seu código. Para verificar a validade do aluguel, use *!tempoaluguel* no grupo.`;
    }

    // Atualiza o pedido no banco
    const updatedOrder = models.updateOrderStatus(merchantTradeNo, 'PAID', deliveredContent);

    // ==========================================
    // 4. ATRIBUIÇÃO E CRÉDITO DE COMISSÃO DE AFILIADO
    // ==========================================
    let affiliateNotice = null;
    if (order.affiliate_id) {
      const affiliate = models.getAffiliateById(order.affiliate_id);
      if (affiliate && affiliate.active) {
        // Re-avalia a fila de espera do afiliado para verificar se atingiu os critérios mínimos com esta venda
        models.checkAndActivateAffiliations(affiliate.id);
        const isApproved = models.isAffiliateApprovedForProduct(affiliate.id, product.id);

        if (isApproved) {
          const rate = (product.custom_affiliate_rate !== null && product.custom_affiliate_rate !== undefined && Number(product.custom_affiliate_rate) > 0)
            ? Number(product.custom_affiliate_rate)
            : (affiliate.commission_rate || 20.0);
          const commAmount = Number(((order.amount * rate) / 100).toFixed(2));

          models.createCommission({
            order_id: order.id,
            beneficiary_type: 'affiliate',
            beneficiary_id: affiliate.id,
            amount: commAmount,
            currency: order.currency,
            rate_percent: rate
          });

          models.creditAffiliateBalance(affiliate.id, commAmount, order.currency);
          console.log(`[Fulfillment 🤝] Afiliado ${affiliate.name} (${affiliate.ref_code}) creditado: ${commAmount} ${order.currency}`);

          affiliateNotice = `${affiliate.name} (${affiliate.ref_code}) - Comissão: ${commAmount} ${order.currency}`;

          // Notifica o Afiliado se configurado
          const afilMsg = `🎉 *PARABÉNS! VOCÊ FEZ UMA VENDA!* 💰\n\n` +
            `📦 *Item:* ${product.name}\n` +
            `💵 *Valor da Venda:* ${order.amount} ${order.currency}\n` +
            `⭐ *Sua Comissão (${rate}%):* ${commAmount} ${order.currency}\n\n` +
            `Seu saldo já foi atualizado!`;

          if (affiliate.telegram_id && this.sendTelegramMessage) {
            this.sendTelegramMessage(affiliate.telegram_id, afilMsg).catch(() => {});
          } else if (affiliate.phone && this.sendWhatsAppMessage) {
            const wppPhone = affiliate.phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            this.sendWhatsAppMessage(wppPhone, afilMsg).catch(() => {});
          }
        } else {
          console.log(`[Fulfillment ⏳] Afiliado ${affiliate.name} (${affiliate.ref_code}) está na Fila de Espera para o produto ${product.name}. Critérios em avaliação.`);
          affiliateNotice = `${affiliate.name} (${affiliate.ref_code}) [Fila de Espera]`;
        }
      }
    }

    // ==========================================
    // 5. ATRIBUIÇÃO DE VENDEDOR
    // ==========================================
    let sellerNotice = null;
    if (order.seller_id) {
      const seller = models.getSellerById(order.seller_id);
      if (seller && seller.active) {
        models.addSellerSale(seller.id, order.amount, order.currency);

        if (seller.commission_rate > 0) {
          const sellerComm = Number(((order.amount * seller.commission_rate) / 100).toFixed(2));
          models.createCommission({
            order_id: order.id,
            beneficiary_type: 'seller',
            beneficiary_id: seller.id,
            amount: sellerComm,
            currency: order.currency,
            rate_percent: seller.commission_rate
          });
        }

        sellerNotice = `${seller.name}`;

        const sellerMsg = `💼 *NOVA VENDA CONCLUÍDA NO SEU ATENDIMENTO!*\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n` +
          `👤 *Cliente:* ${order.platform_user_name || order.platform_user_id} (${order.platform.toUpperCase()})\n` +
          `🆔 *Pedido:* \`${order.merchant_trade_no}\``;

        if (seller.telegram_id && this.sendTelegramMessage) {
          this.sendTelegramMessage(seller.telegram_id, sellerMsg).catch(() => {});
        } else if (seller.phone && this.sendWhatsAppMessage) {
          const wppPhone = seller.phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          this.sendWhatsAppMessage(wppPhone, sellerMsg).catch(() => {});
        }
      }
    }

    // ==========================================
    // 6. NOTIFICAÇÃO DO ADMINISTRADOR
    // ==========================================
    const notifyAdmin = models.getSetting('NOTIFY_ADMIN_ON_SALE', 'true') === 'true';
    if (notifyAdmin) {
      const adminTg = models.getSetting('ADMIN_NOTIFY_TELEGRAM_ID');
      const adminWpp = models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE');

      const adminAlert = `🚨 *NOVA VENDA REALIZADA!* 💰\n\n` +
        `📦 *Produto:* ${product.name}\n` +
        `💵 *Valor:* ${order.amount} ${order.currency} (${(order.gateway || 'Pix').toUpperCase()})\n` +
        `👤 *Cliente:* ${order.platform_user_name || order.platform_user_id} via ${order.platform.toUpperCase()}\n` +
        (affiliateNotice ? `🤝 *Afiliado:* ${affiliateNotice}\n` : '') +
        (sellerNotice ? `👔 *Vendedor:* ${sellerNotice}\n` : '') +
        `🆔 *Pedido:* \`${order.merchant_trade_no}\``;

      if (adminTg && this.sendTelegramMessage) {
        this.sendTelegramMessage(adminTg, adminAlert).catch(() => {});
      }
      if (adminWpp && this.sendWhatsAppMessage) {
        const cleanWpp = adminWpp.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        this.sendWhatsAppMessage(cleanWpp, adminAlert).catch(() => {});
      }
    }

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

    // ==========================================
    // 7. PUBLICAÇÃO NO CANAL DE ATUALIZAÇÕES (PROVA SOCIAL)
    // ==========================================
    updatesChannel.broadcastTransaction(updatedOrder).catch(err => {
      console.error('[Fulfillment ⚠️ Erro ao publicar transação no canal]:', err.message);
    });

    // ==========================================
    // 8. OFERTA DE UPSELL / ORDER BUMP PÓS-VENDA
    // ==========================================
    const isUpsellEnabled = models.getSetting('UPSELL_ENABLED', 'true') === 'true';
    if (isUpsellEnabled && product.upsell_product_id && !order.is_upsell) {
      const upsellProd = models.getProductById(product.upsell_product_id);
      if (upsellProd && upsellProd.active) {
        const discountPercent = product.upsell_discount_percent || 20.0;
        const discountedBrl = Number((upsellProd.price_brl * (1 - discountPercent / 100)).toFixed(2));
        const discountedUsdt = Number((upsellProd.price_usdt * (1 - discountPercent / 100)).toFixed(2));
        const headline = product.upsell_headline || `🔥 Oportunidade Exclusiva Pós-Venda (${discountPercent}% OFF)!`;

        const upsellMsg = `🎁 *${headline}*\n\n` +
          `Como você acabou de adquirir *${product.name}*, liberamos um desconto especial único para você levar também:\n\n` +
          `📦 *${upsellProd.name}*\n` +
          (upsellProd.description ? `_${upsellProd.description}_\n\n` : '') +
          `💵 De ~R$ ${upsellProd.price_brl.toFixed(2)}~ por apenas *R$ ${discountedBrl.toFixed(2)}* (ou *${discountedUsdt.toFixed(2)} USDT*)\n\n` +
          (order.platform === 'whatsapp' 
            ? `👉 Para garantir agora com desconto, envie *UP* para receber o Pix direto!`
            : `👉 Clique no botão abaixo para garantir sua oferta:`);

        try {
          if (order.platform === 'telegram' && this.sendTelegramUpsell) {
            this.sendTelegramUpsell(order.platform_user_id, upsellMsg, {
              orderId: order.id,
              upsellProductId: upsellProd.id,
              discountedBrl,
              discountedUsdt
            }).catch(() => {});
          } else if (order.platform === 'whatsapp' && this.sendWhatsAppMessage) {
            this.sendWhatsAppMessage(order.platform_user_id, upsellMsg).catch(() => {});
          }
          console.log(`[Upsell 🚀] Oferta de pós-venda disparada para ${order.platform_user_id} (${order.platform})`);
        } catch (uErr) {
          console.error('[Upsell ⚠️ Erro ao enviar oferta]:', uErr.message);
        }
      }
    }

    return {
      success: true,
      order: updatedOrder,
      deliveredContent
    };
  }
}

module.exports = new FulfillmentService();

const models = require('../db/models');
const updatesChannel = require('./updatesChannel');

class FulfillmentService {
  constructor() {
    this.sendTelegramMessage = null;
    this.sendTelegramUpsell = null;
    this.sendWhatsAppMessage = null;
    this.createTelegramInviteLink = null;
    this.removeTelegramMember = null;
    this.inFlightOrders = new Set(); // Trava de concorrência para evitar entregas duplicadas
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
    let lookupKey = merchantTradeNo;
    let initialOrder = models.getOrderByTradeNo(lookupKey);
    if (!initialOrder && (typeof lookupKey === 'number' || /^\d+$/.test(String(lookupKey)))) {
      const orderById = models.getOrderById(Number(lookupKey));
      if (orderById?.merchant_trade_no) {
        lookupKey = orderById.merchant_trade_no;
        initialOrder = orderById;
      }
    }

    if (this.inFlightOrders.has(lookupKey)) {
      console.log(`[Fulfillment ℹ️] Pedido ${lookupKey} já está em processamento concorrente.`);
      const currentOrder = initialOrder || models.getOrderByTradeNo(lookupKey);
      return { success: true, inFlight: true, order: currentOrder };
    }

    this.inFlightOrders.add(lookupKey);
    try {
      const order = initialOrder || models.getOrderByTradeNo(lookupKey);
      if (!order) {
        console.error(`[Fulfillment ❌] Pedido não encontrado: ${lookupKey}`);
        return { success: false, error: 'Pedido não encontrado' };
      }

      if (order.status === 'PAID' && order.delivered_content) {
        console.log(`[Fulfillment ℹ️] Pedido ${lookupKey} já foi entregue anteriormente.`);
        return { success: true, alreadyDelivered: true, order };
      }

    console.log(`[Fulfillment 🚀] Processando entrega para o pedido: ${lookupKey} (${order.platform} - ${order.platform_user_id})`);

    let deliveredContent = '';
    const product = models.getProductById(order.product_id);
    if (!product) {
      console.error(`[Fulfillment ❌] Produto ID ${order.product_id} não encontrado.`);
      return { success: false, error: 'Produto não encontrado' };
    }

    // 1. ENTREGA DE PRODUTO DIGITAL POR LINK / ARQUIVO
    if (product.type === 'digital_link') {
      const link = product.content && String(product.content).trim() !== 'null' ? String(product.content).trim() : null;
      if (link) {
        let finalDeliveryLink = link;
        if (finalDeliveryLink.startsWith('/') || finalDeliveryLink.includes('paybot.tech') || finalDeliveryLink.includes('paybot.app') || finalDeliveryLink.includes('paybot.store')) {
          const tunnelService = require('./tunnelService');
          const base = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
          const cleanPath = finalDeliveryLink.replace(/^https?:\/\/[^/]+/, '');
          finalDeliveryLink = `${base.replace(/\/+$/, '')}${cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath}`;
        }
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
          `🔗 *Acesse seu produto no link abaixo:*\n${finalDeliveryLink}\n\n` +
          `Obrigado pela sua compra! Qualquer dúvida, estamos à disposição.`;
      } else {
        const customPending = (models.getSetting('FULFILLMENT_PENDING_LINK_MSG', '') || '').trim();
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
          `✅ *Seu pedido foi registrado e homologado com sucesso!*\n` +
          (customPending ? `${customPending}\n\n` : `👨‍💻 Nossa equipe de suporte e ativação foi notificada e enviará os links e credenciais de acesso diretamente por aqui em instantes.\n\n`) +
          `Caso precise de atendimento imediato, basta responder esta mensagem.`;
        console.warn(`[Fulfillment ⚠️ Alerta] Produto ID ${product.id} ("${product.name}") possui content nulo.`);
      }
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
        const customPending = (models.getSetting('FULFILLMENT_PENDING_LINK_MSG', '') || '').trim();
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `⚠️ *Aviso de Estoque:* Nosso estoque automático deste produto acabou de zerar.\n` +
          (customPending ? `${customPending}\n\n` : `Nosso time já foi alertado e enviará sua chave por aqui em alguns minutos!\n\n`) +
          `Qualquer dúvida, estamos à disposição.`;
        console.warn(`[Fulfillment 🚨 Estoque Zerado] Produto ID ${product.id} ("${product.name}") sem chaves disponíveis.`);

        // Alerta o administrador se a opção estiver ativada
        const alertAdmin = models.getSetting('ALERT_ON_EMPTY_STOCK', 'true') !== 'false';
        if (alertAdmin) {
          try {
            const ordersGroupJid = models.getOrdersGroupJid ? models.getOrdersGroupJid() : (models.getSetting('ORDERS_GROUP_JID') || process.env.ORDERS_GROUP_JID || '');
            const adminPhone = models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '') || models.getSetting('OWNER_PHONE', '');
            if (this.sendWhatsAppMessage && (ordersGroupJid || adminPhone)) {
              const targetJid = ordersGroupJid ? ordersGroupJid : (adminPhone.replace(/\D/g, '') + '@s.whatsapp.net');
              const alertMsg = `🚨 *ALERTA DE ESTOQUE ZERADO NO PAYBOT!* 🚨\n\n` +
                `📦 *Produto:* ${product.name} (ID: ${product.id})\n` +
                `👤 *Cliente:* ${order.platform_user_name || order.platform_user_id}\n` +
                `🆔 *Pedido:* ${lookupKey}\n\n` +
                `⚠️ O cliente pagou e está aguardando o envio manual da chave/licença!\n` +
                `👉 Reabasteça as chaves em: Painel Web > Produtos > Gerenciar Chaves.`;
              this.sendWhatsAppMessage(targetJid, alertMsg).catch(() => {});
            }
          } catch (_) {}
        }
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
        `2. Envie a chave *${codeRes.code}* no grupo (ou digite: *!key ${codeRes.code}* ou *!usarcodigo ${codeRes.code}*);\n` +
        `3. O bot confirmará o aluguel e todas as funções serão desbloqueadas instantaneamente!\n\n` +
        `Guarde seu código. Para verificar a validade do aluguel, use *!tempoaluguel* no grupo.`;

      // Ativação direta e automática se o pedido for vinculado a um grupo específico
      const targetGroup = (order.platform_user_id && order.platform_user_id.endsWith('@g.us')) 
        ? order.platform_user_id 
        : ((order.customer_phone && order.customer_phone.endsWith('@g.us')) ? order.customer_phone : null);

      if (targetGroup) {
        try {
          models.useRentalActivationCode(codeRes.code, targetGroup, order.platform_user_id);
          if (this.sendWhatsAppMessage) {
            const groupAnnounce = `🎉 *PAGAMENTO CONFIRMADO! ALUGUEL ATIVADO/RENOVADO AUTOMATICAMENTE!* 🤖\n\n` +
              `📦 *Plano:* ${product.name}\n` +
              `⏳ *Duração:* ${durText}\n` +
              `🔑 *Chave Vinculada:* \`${codeRes.code}\`\n\n` +
              `🛡️ Todas as funções, escudos de proteção e comandos estão liberados!\n` +
              `_Use *!tempoaluguel* para consultar a data de vencimento._`;
            this.sendWhatsAppMessage(targetGroup, groupAnnounce).catch(() => {});
          }
        } catch (_) {}
      }
    }

    // 5. ENTREGA DE PRODUTO DIGITAL GENÉRICO / SERVIÇO / PROJETO SOB MEDIDA
    else {
      const link = product.content && String(product.content).trim() !== 'null' ? String(product.content).trim() : null;
      if (link) {
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
          `🔗 *Acesse seu produto no link abaixo:*\n${link}\n\n` +
          `Obrigado pela sua compra! Qualquer dúvida, estamos à disposição.`;
      } else {
        const customPending = (models.getSetting('FULFILLMENT_PENDING_LINK_MSG', '') || '').trim();
        deliveredContent = `🎉 *PAGAMENTO CONFIRMADO!* 🎉\n\n` +
          `📦 *Produto:* ${product.name}\n` +
          `💰 *Valor:* ${order.amount} ${order.currency}\n\n` +
          `✅ *Seu pedido foi registrado e homologado com sucesso!*\n` +
          (customPending ? `${customPending}\n\n` : `👨‍💻 Nossa equipe técnica de desenvolvimento e onboarding foi acionada e entrará em contato diretamente por aqui para dar início ao seu projeto/entrega.\n\n`) +
          `Se desejar falar com um especialista agora, basta responder esta mensagem.`;
      }
    }

    // Atualiza o pedido no banco
    const updatedOrder = models.updateOrderStatus(lookupKey, 'PAID', deliveredContent);

    // Alimenta a inteligência de vendas do produto e a margem de lucro no banco
    try {
      if (product && product.id) {
        models.recordProductSale(product.id, order.amount);
        const cost = Number(product.cost_price || (order.amount * 0.05));
        const profit = Math.max(0, order.amount - cost);
        const margin = Number(product.profit_margin_percent || 95.0);
        models.recordOrderProfit(lookupKey, profit, margin);
      }
      const cleanCustomer = String(order.platform_user_id || order.customer_phone || '').replace(/\D/g, '');
      if (cleanCustomer && cleanCustomer.length >= 8) {
        models.upsertLeadCognitiveProfile(cleanCustomer, {
          buying_stage: 'CONVERTIDO',
          readiness_score: 100
        });
        models.addLeadEpisodicMemory(
          cleanCustomer,
          'PURCHASE_COMPLETED',
          `Concluiu a compra de "${product.name}" no valor de R$ ${Number(order.amount).toFixed(2)}`,
          `Pagamento confirmado e produto liberado`,
          5
        );

        // 🧠 ALIMENTA O NÚCLEO DE INTELIGÊNCIA COM A CONVERSÃO BEM-SUCEDIDA
        try {
          const knowledgeBaseService = require('./knowledgeBaseService');
          knowledgeBaseService.feedFromOrder({
            order,
            tenantId: order.tenant_id || 1,
            leadPhone: cleanCustomer
          });
        } catch (_) {}
      }
    } catch (fErr) {
      console.warn('[Fulfillment ⚠️ Erro ao registrar inteligência de margem]:', fErr.message);
    }

    // ==========================================
    // 3.9 SPLIT DE PAGAMENTO AUTOMÁTICO & PLATAFORMA TAKE-RATE
    // ==========================================
    try {
      const paymentSplitService = require('./paymentSplitService');
      paymentSplitService.recordOrderSplit({
        orderId: order.id,
        merchantTradeNo: order.merchant_trade_no,
        tenantId: order.tenant_id || null,
        grossAmount: order.amount,
        splitMode: 'AUTOMATIC'
      });
    } catch (sErr) {
      console.warn('[Fulfillment ⚠️ Erro ao registrar split de taxa]:', sErr.message);
    }

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

      const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
      const envTag = isProduction ? '🚀 *[PRODUÇÃO REAL]*' : '🧪 *[SANDBOX / TESTE]*';

      const adminAlert = `🚨 *NOVA VENDA CONFIRMADA!* 💰\n` +
        `🌐 *Ambiente:* ${envTag}\n\n` +
        `📦 *Produto:* ${product.name}\n` +
        `💵 *Valor:* ${order.amount} ${order.currency} (${(order.gateway || 'Pix').toUpperCase()})\n` +
        `👤 *Cliente:* ${order.platform_user_name || order.platform_user_id} via ${order.platform.toUpperCase()}\n` +
        (affiliateNotice ? `🤝 *Afiliado:* ${affiliateNotice}\n` : '') +
        (sellerNotice ? `👔 *Vendedor:* ${sellerNotice}\n` : '') +
        `🆔 *Pedido:* \`${order.merchant_trade_no}\``;

      if (adminTg && this.sendTelegramMessage) {
        this.sendTelegramMessage(adminTg, adminAlert).catch(() => {});
      }
      const ordersGroupJid = models.getOrdersGroupJid ? models.getOrdersGroupJid() : (models.getSetting('ORDERS_GROUP_JID') || process.env.ORDERS_GROUP_JID || '');
      if (ordersGroupJid && this.sendWhatsAppMessage) {
        this.sendWhatsAppMessage(ordersGroupJid, adminAlert).catch(() => {});
      } else if (adminWpp && this.sendWhatsAppMessage) {
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
    if (isUpsellEnabled && !order.is_upsell) {
      let upsellProd = null;
      let discountPercent = 20.0;
      let headline = '🔥 Oportunidade Exclusiva Pós-Venda (20% OFF)!';

      if (product.upsell_product_id) {
        const found = models.getProductById(product.upsell_product_id);
        if (found && found.active) {
          upsellProd = found;
          discountPercent = product.upsell_discount_percent || 20.0;
          headline = product.upsell_headline || `🔥 Oportunidade Exclusiva Pós-Venda (${discountPercent}% OFF)!`;
        }
      }

      // Se o produto base não tiver upsell fixo, seleciona dinamicamente o produto mais inteligente de maior margem
      if (!upsellProd) {
        const smartProds = models.getHighMarginSmartProducts(5, order.tenant_id);
        upsellProd = (smartProds || []).find(p => p && p.active && p.id !== product.id);
        discountPercent = 20.0;
        headline = `🔥 Oferta VIP Relâmpago Exclusiva (${discountPercent}% OFF)!`;
      }

      if (upsellProd && upsellProd.active) {
        const discountedBrl = Number((upsellProd.price_brl * (1 - discountPercent / 100)).toFixed(2));
        const discountedUsdt = Number((upsellProd.price_usdt * (1 - discountPercent / 100)).toFixed(2));

        const upsellMsg = `🎁 *${headline}*\n\n` +
          `Como você acabou de adquirir *${product.name}*, liberamos um desconto especial único para você levar também:\n\n` +
          `📦 *${upsellProd.name}*\n` +
          (upsellProd.description ? `_${upsellProd.description}_\n\n` : '') +
          `💵 De ~R$ ${upsellProd.price_brl.toFixed(2)}~ por apenas *R$ ${discountedBrl.toFixed(2)}* (ou *${discountedUsdt.toFixed(2)} USDT*)\n\n` +
          (order.platform === 'whatsapp' 
            ? `👉 Para garantir agora com desconto, responda *UP* ou *QUERO* para receber o Pix direto!`
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

    // ==========================================
    // 8.1 OFERTA DE UPSELL PARA LOJA WEB EXCLUSIVA DO TENANT
    // ==========================================
    if (order.tenant_id && !order.is_upsell) {
      try {
        const tenant = models.getTenantById(order.tenant_id);
        if (tenant && (!tenant.settings || tenant.settings.store_upsell_whatsapp !== false)) {
          const config = require('../config');
          const tunnelService = require('./tunnelService');
          const storeUrl = tunnelService.getStoreUrl() || `http://localhost:${config.storePort || 3001}`;
          const cleanCustomer = String(order.platform_user_id || '').replace(/\D/g, '');
          const tenantLojaUrl = `${storeUrl}/loja/${tenant.slug}?ref=upsell_whatsapp&upsell=1${cleanCustomer ? `&phone=${cleanCustomer}` : ''}`;
          const discountPct = tenant.settings?.upsell_discount_percent || 15;
          const upsellStoreMsg = tenant.settings?.upsell_message
            ? tenant.settings.upsell_message
                .replace(/{nome}/g, order.platform_user_name || 'Amigo(a)')
                .replace(/{link_loja}/g, tenantLojaUrl)
                .replace(/{desconto}/g, `${discountPct}%`)
            : `🎁 *PARABÉNS PELA SUA COMPRA! VOCÊ LIBEROU UM BENEFÍCIO EXCLUSIVO* 🚀\n\n` +
              `Como agradecimento especial, você desbloqueou *${discountPct}% de desconto VIP* em toda a nossa vitrine oficial online!\n\n` +
              `👉 *Acesse nossa loja agora:* ${tenantLojaUrl}\n\n` +
              `_Aproveite seus descontos antes que o link expire!_`;

          if (order.platform === 'whatsapp' && this.sendWhatsAppMessage) {
            setTimeout(async () => {
              try {
                await this.sendWhatsAppMessage(order.platform_user_id, upsellStoreMsg);
                console.log(`[Tenant Upsell 🛍️] Enviado link da loja ${tenant.slug} para ${order.platform_user_id}`);
              } catch (_) {}
            }, 3000);
          }
        }
      } catch (err) {
        console.warn('[Tenant Upsell ⚠️]:', err.message);
      }
    }

    // ==========================================
    // 8.2 PROGRAMA INDIQUE E GANHE AUTOMÁTICO PÓS-VENDA
    // ==========================================
    const isReferralEnabled = models.getSetting('REFERRAL_SYSTEM_ENABLED', 'true') !== 'false';
    if (isReferralEnabled && !order.is_upsell) {
      try {
        const cleanCustomer = String(order.platform_user_id || '').replace(/\D/g, '');
        if (cleanCustomer && cleanCustomer.length >= 8) {
          const clientName = order.platform_user_name || 'Cliente';
          const defaultRate = parseFloat(models.getSetting('REFERRAL_COMMISSION_RATE', '20.0')) || 20.0;
          const customerAffiliate = models.getOrCreateCustomerAffiliate(cleanCustomer, clientName, defaultRate);

          if (customerAffiliate && customerAffiliate.ref_code) {
            const webStoreTrackerService = require('./webStoreTrackerService');
            const refLinkObj = webStoreTrackerService.buildTrackedStoreUrl({
              phone: cleanCustomer,
              name: clientName,
              refCode: customerAffiliate.ref_code,
              source: 'pos_venda_indique_e_ganhe',
              preferShort: true
            });
            const refUrl = refLinkObj.shortUrl || refLinkObj.url;

            const referralMsg = `🎁 *PROGRAMA INDIQUE E GANHE ATIVADO!* 💸\n\n` +
              `Gostou da sua compra, *${clientName}*?\n` +
              `Agora você tem um link exclusivo para indicar a nossa vitrine para seus contatos e lucrar no Pix!\n\n` +
              `⭐ *Você ganha ${customerAffiliate.commission_rate}% de comissão* em todas as compras feitas pelo seu link:\n` +
              `👉 *Seu Link de Indicação:* ${refUrl}\n\n` +
              `💡 _Compartilhe no seu status ou com seus amigos. O saldo de comissão acumula automaticamente na sua conta!_`;

            if (order.platform === 'whatsapp' && this.sendWhatsAppMessage) {
              setTimeout(async () => {
                try {
                  await this.sendWhatsAppMessage(order.platform_user_id, referralMsg);
                  console.log(`[Indique e Ganhe 🎁] Link de indicação (${customerAffiliate.ref_code}) enviado para ${order.platform_user_id}`);
                } catch (_) {}
              }, 4000);
            } else if (order.platform === 'telegram' && this.sendTelegramMessage) {
              setTimeout(async () => {
                try {
                  await this.sendTelegramMessage(order.platform_user_id, referralMsg);
                } catch (_) {}
              }, 4000);
            }
          }
        }
      } catch (refErr) {
        console.warn('[Indique e Ganhe ⚠️ Erro]:', refErr.message);
      }
    }

    // ==========================================
    // 9. LANÇAMENTO METEÓRICO: MOVIMENTAÇÃO AUTOMÁTICA PARA GRUPO VIP DE COMPRADORES
    // ==========================================
    try {
      const meteoricService = require('./meteoricService');
      meteoricService.handleLeadPurchase(updatedOrder).catch(err => {
        console.warn('[Fulfillment ⚠️ Erro ao movimentar comprador meteórico]:', err.message);
      });
    } catch (_) {}

    return {
      success: true,
      order: updatedOrder,
      deliveredContent
    };
    } finally {
      this.inFlightOrders.delete(merchantTradeNo);
    }
  }
}

module.exports = new FulfillmentService();

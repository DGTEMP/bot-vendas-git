/**
 * webStoreTrackerService.js
 * Serviço de Rastreamento de Telemetria da Loja Web & Integração com WhatsApp
 * Acompanha produtos visualizados, itens adicionados/removidos do carrinho, abandono de checkout,
 * sincroniza com o perfil cognitivo do lead e garante recuperação e checkout via WhatsApp.
 */

const models = require('../db/models');

class WebStoreTrackerService {
  /**
   * Registra um evento de telemetria vindo do frontend da loja
   */
  async trackEvent(data = {}) {
    const { session_id, phone, customer_name, event_type, product_id, product_name, cart_payload, cart_total, metadata } = data;
    if (!session_id || !event_type) return { success: false, message: 'session_id e event_type são obrigatórios' };

    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;

    // 1. Grava no log histórico de telemetria
    models.logStoreTelemetry({
      session_id,
      phone: cleanPhone,
      customer_name,
      event_type,
      product_id,
      product_name,
      cart_payload,
      cart_total,
      metadata
    });

    // 2. Determina o status da sessão do carrinho
    let sessionStatus = 'BROWSING';
    if (event_type === 'ADD_TO_CART' || event_type === 'CART_UPDATE') {
      sessionStatus = 'IN_CART';
    } else if (event_type === 'CHECKOUT_OPEN') {
      sessionStatus = 'CHECKOUT_OPEN';
    } else if (event_type === 'CHECKOUT_SUBMIT') {
      sessionStatus = 'ORDER_PLACED';
    } else if (event_type === 'ABANDONED') {
      sessionStatus = 'ABANDONED';
    }

    // 3. Salva / Atualiza o estado da sessão
    models.saveCartSession({
      session_id,
      phone: cleanPhone,
      customer_name,
      cart_items: cart_payload,
      cart_total: cart_total || 0,
      status: sessionStatus
    });

    // 4. Integração Cognitiva com o Lead no WhatsApp se o telefone for conhecido
    if (cleanPhone && cleanPhone.length >= 8) {
      try {
        let profile = models.getLeadCognitiveProfile(cleanPhone);
        if (!profile) {
          profile = models.upsertLeadCognitiveProfile(cleanPhone, {
            name: customer_name || 'Lead Loja Web',
            niche: 'E-commerce & Vitrine Web',
            buying_stage: sessionStatus === 'CHECKOUT_OPEN' ? 'DECISAO_IMINENTE' : 'CONSIDERACAO',
            readiness_score: sessionStatus === 'CHECKOUT_OPEN' ? 75 : 50
          });
        } else if (customer_name && customer_name !== 'Lead Loja Web' && (!profile.name || profile.name === 'Lead Loja Web')) {
          models.upsertLeadCognitiveProfile(cleanPhone, { name: customer_name });
        }

        // Registra memórias episódicas do comportamento na loja
        if (event_type === 'PAGE_VIEW') {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_ACCESS',
            `Acessou a vitrine digital vinculada ao WhatsApp`,
            `Cliente abriu o catálogo online através do link rastreável`,
            3
          );
        } else if (event_type === 'PRODUCT_VIEW' && product_name) {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_VIEW',
            `Visualizou o produto "${product_name}" na vitrine web`,
            `Cliente acessou a página de detalhes do produto #${product_id || ''}`,
            3
          );
        } else if (event_type === 'ADD_TO_CART' && product_name) {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_CART_ADD',
            `Adicionou "${product_name}" ao carrinho (Total atual: R$ ${Number(cart_total || 0).toFixed(2)})`,
            `Interesse forte de compra demonstrado na loja web`,
            4
          );
        } else if (event_type === 'REMOVE_FROM_CART' && product_name) {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_CART_REMOVE',
            `Removeu o produto "${product_name}" do carrinho`,
            `Cliente optou por retirar o item antes de prosseguir`,
            3
          );
        } else if (event_type === 'CHECKOUT_OPEN') {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_CHECKOUT_OPEN',
            `Abriu modal de checkout para concluir compra de R$ ${Number(cart_total || 0).toFixed(2)}`,
            `Etapa final de checkout iniciada na vitrine web`,
            5
          );
        }
      } catch (err) {
        console.error('[WebStoreTracker ⚠️ Erro na integração cognitiva]:', err.message);
      }
    }

    return { success: true, session_id, event_type };
  }

  /**
   * Resolve o número de telefone real do WhatsApp do bot ou do dono para links wa.me
   */
  getBotContactPhone(subbotId = null) {
    if (subbotId) {
      const subInstance = models.getArmyInstanceById(Number(subbotId));
      if (subInstance && subInstance.phone) {
        return String(subInstance.phone).replace(/\D/g, '');
      }
    }

    // Tenta pegar o número do socket ativo do WhatsApp
    try {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot?.sock?.user?.id) {
        const sockPhone = whatsappBot.sock.user.id.split(':')[0].replace(/\D/g, '');
        if (sockPhone && sockPhone.length >= 8) return sockPhone;
      }
    } catch (_) {}

    // Fallbacks nas configurações do sistema
    const adminPhone = models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '') ||
      models.getSetting('OWNER_WHATSAPP', '') ||
      models.getSetting('OWNER_PHONE', '') ||
      process.env.OWNER_WHATSAPP ||
      process.env.ADMIN_NOTIFY_WHATSAPP_PHONE ||
      '554884702848';

    const clean = String(adminPhone).replace(/\D/g, '');
    return clean || '554884702848';
  }

  /**
   * Dispara confirmação via WhatsApp para o cliente e alerta para o Dono após checkout
   */
  async notifyOrderPlaced(orderData = {}) {
    const { tradeNo, customerName, customerPhone, items = [], finalBRL, gateway, pixCode } = orderData;
    if (!customerPhone || customerPhone.length < 8) return false;

    const whatsappBot = require('../bots/whatsappBot');
    const cleanCustomer = String(customerPhone).replace(/\D/g, '');

    // 1. Mensagem para o Cliente
    let clientMsg = `🛍️ *PEDIDO RECEBIDO COM SUCESSO!* 🛍️\n\n` +
      `Olá, *${customerName || 'Cliente'}*! Confirmamos o registro do seu pedido *#${tradeNo}* na nossa loja web.\n\n` +
      `📦 *Resumo dos Itens:*\n` +
      items.map(i => `• ${i.quantity}x ${i.name} (R$ ${Number(i.totalBRL || i.price_brl * i.quantity).toFixed(2)})`).join('\n') + `\n\n` +
      `💰 *Total:* *R$ ${Number(finalBRL).toFixed(2)}*\n` +
      `⚡ *Forma Escolhida:* ${String(gateway || 'WhatsApp').toUpperCase()}\n\n`;

    if (gateway === 'pix' && pixCode) {
      clientMsg += `👇 *PIX Copia e Cola para pagamento:*\n\`${pixCode}\`\n\n` +
        `Assim que pagar, seu pedido é aprovado automaticamente pelo sistema!`;
    } else if (gateway === 'whatsapp') {
      clientMsg += `Nosso consultor técnico já recebeu seu pedido e está à disposição para sanar qualquer dúvida ou emitir sua fatura.`;
    }

    try {
      await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, clientMsg);
    } catch (e) {
      console.error('[WebStoreTracker ⚠️ Falha ao avisar cliente no WhatsApp]:', e.message);
    }

    // 2. Alerta imediato para o Dono
    const ownerPhone = models.getSetting('OWNER_WHATSAPP', '554884702848');
    const cleanOwner = String(ownerPhone).replace(/\D/g, '');
    if (cleanOwner) {
      const ownerAlert = `👑 *NOVO PEDIDO NA LOJA WEB (#${tradeNo})!* 👑\n\n` +
        `👤 *Cliente:* ${customerName} (+${cleanCustomer})\n` +
        `💰 *Valor:* R$ ${Number(finalBRL).toFixed(2)}\n` +
        `⚡ *Método:* ${String(gateway).toUpperCase()}\n` +
        `📦 *Itens:* ${items.length} produto(s)\n\n` +
        `_Acesse o painel web ou envie "!painel" para gerenciar._`;

      try {
        await whatsappBot.sendMessage(`${cleanOwner}@s.whatsapp.net`, ownerAlert);
      } catch (_) {}
    }

    return true;
  }
}

module.exports = new WebStoreTrackerService();

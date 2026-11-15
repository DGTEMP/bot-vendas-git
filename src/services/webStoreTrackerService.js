/**
 * webStoreTrackerService.js
 * Serviço de Rastreamento de Telemetria da Loja Web & Integração com WhatsApp
 * Acompanha produtos visualizados, itens adicionados/removidos do carrinho, abandono de checkout,
 * sincroniza com o perfil cognitivo do lead e garante recuperação e checkout via WhatsApp.
 */

const models = require('../db/models');
const QRCode = require('qrcode');

class WebStoreTrackerService {
  /**
   * Constrói e retorna a URL rastreada da vitrine online com todos os parâmetros de rastreamento
   * (lead/phone, nome, subbot/instância, afiliado, cupom, origem e token único de rastreamento).
   * Garante que toda oferta do link da loja carregue a identidade do lead e do canal emissor.
   */
  buildTrackedStoreUrl({
    phone = null,
    name = null,
    customerName = null,
    instanceId = null,
    subbot = null,
    refCode = null,
    sellerId = null,
    couponCode = null,
    source = 'whatsapp_bot',
    targetPath = '/loja',
    productId = null,
    preferShort = false
  } = {}) {
    const tunnelService = require('./tunnelService');
    const host = (tunnelService.getStoreUrl() || 'http://localhost:3001').replace(/\/+$/, '');

    // 1. Telefone do lead / cliente
    let cleanPhone = '';
    const rawPhone = phone || null;
    if (rawPhone) {
      cleanPhone = String(rawPhone).split('@')[0].replace(/\D/g, '');
    }

    // 2. Nome do lead / cliente
    let cleanName = (name || customerName || '').trim();
    if (!cleanName && cleanPhone) {
      try {
        const prof = models.getLeadCognitiveProfile(cleanPhone);
        if (prof && prof.name && !/^(cliente|lead|amigo|user|undefined|null|Lead Loja Web)$/i.test(prof.name.trim())) {
          cleanName = prof.name.trim();
        }
      } catch (_) {}
    }
    if (!cleanName || /^(cliente|lead|amigo|user|undefined|null)$/i.test(cleanName)) {
      cleanName = 'Cliente';
    }

    // 3. Instância / Sub-Bot
    const rawInst = instanceId !== null && instanceId !== undefined ? instanceId : subbot;
    let instId = 1;
    if (rawInst !== null && rawInst !== undefined && !isNaN(Number(rawInst))) {
      instId = Number(rawInst);
    } else if (rawInst && typeof rawInst === 'string' && rawInst.trim()) {
      instId = rawInst.trim();
    }

    // 4. Afiliado (se não informado, tenta recuperar do histórico do lead)
    let finalRef = refCode || null;
    if (!finalRef && cleanPhone) {
      try {
        const recentShort = models.getStoreShortLinksByPhone(cleanPhone, 1);
        if (recentShort && recentShort.length > 0 && recentShort[0].ref_code) {
          finalRef = recentShort[0].ref_code;
        }
      } catch (_) {}
    }

    // 5. Gera ou reaproveita o token único de rastreamento via store_short_links
    let trackCode = null;
    try {
      const shortObj = models.getOrCreateStoreShortLink({
        phone: cleanPhone || 'anon',
        name: cleanName !== 'Cliente' ? cleanName : null,
        instanceId: instId,
        refCode: finalRef,
        couponCode: couponCode || null,
        source: source || 'whatsapp_bot',
        targetPath: targetPath || '/loja'
      });
      if (shortObj && shortObj.code) {
        trackCode = shortObj.code;
      }
    } catch (err) {
      console.warn('[WebStoreTracker ⚠️ Erro ao registrar short link]:', err.message);
    }

    if (!trackCode) {
      trackCode = 'v' + Date.now().toString(36).slice(-5);
    }

    // 6. Montagem dos parâmetros de rastreamento compatíveis com a loja e os testes
    const queryParts = [];
    if (cleanPhone) {
      queryParts.push(`phone=${cleanPhone}`);
      queryParts.push(`lead=${cleanPhone}`);
    }
    if (cleanName && cleanName !== 'Cliente') {
      queryParts.push(`name=${encodeURIComponent(cleanName)}`);
    }
    if (instId && instId !== 1) {
      queryParts.push(`subbot=${instId}`);
    }
    if (finalRef) {
      queryParts.push(`ref=${encodeURIComponent(finalRef)}`);
    }
    if (sellerId) {
      queryParts.push(`seller=${encodeURIComponent(sellerId)}`);
    }
    if (couponCode) {
      queryParts.push(`cupom=${encodeURIComponent(couponCode).toUpperCase()}`);
    }
    if (productId) {
      queryParts.push(`buy=${encodeURIComponent(productId)}`);
    }
    if (source) {
      queryParts.push(`source=${encodeURIComponent(source)}`);
    }
    queryParts.push(`track=${trackCode}`);
    queryParts.push(`s=${trackCode}`);

    const basePath = (targetPath && targetPath.startsWith('/')) ? targetPath : `/${targetPath || 'loja'}`;
    const queryString = queryParts.join('&');
    const fullUrl = `${host}${basePath}${queryString ? '?' + queryString : ''}`;
    const shortUrl = `${host}/v/${trackCode}${(instId && instId !== 1) ? `?subbot=${instId}` : ''}`;

    return {
      url: fullUrl,
      shortUrl: shortUrl,
      trackCode: trackCode,
      shortCode: trackCode,
      phone: cleanPhone,
      name: cleanName,
      instanceId: instId,
      refCode: finalRef,
      queryString: queryString,
      toString() {
        return preferShort ? shortUrl : fullUrl;
      }
    };
  }

  /**
   * Identifica detalhes do aparelho e navegador a partir do User-Agent
   */
  parseUserAgent(ua) {
    if (!ua || typeof ua !== 'string') {
      return {
        device: '💻 Desktop • Navegador Web',
        deviceType: 'Desktop',
        os: 'Desktop',
        browser: 'Navegador Web'
      };
    }

    const uaLower = ua.toLowerCase();
    let deviceType = 'Desktop';
    let os = 'Windows';
    let browser = 'Chrome';

    // Tipo de Aparelho
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
      deviceType = 'Mobile';
    } else if (/ipad|tablet|playbook|silk/i.test(uaLower)) {
      deviceType = 'Tablet';
    }

    // Sistema Operacional
    if (/android/i.test(uaLower)) {
      const match = ua.match(/Android\s([0-9\.]+)/i);
      os = match ? `Android ${match[1]}` : 'Android';
    } else if (/iphone/i.test(uaLower)) {
      const match = ua.match(/OS\s([0-9_]+)/i);
      os = match ? `iOS ${match[1].replace(/_/g, '.')}` : 'iOS (iPhone)';
    } else if (/ipad/i.test(uaLower)) {
      os = 'iPadOS';
    } else if (/windows nt 10\.0/i.test(uaLower)) {
      os = 'Windows 10/11';
    } else if (/windows nt/i.test(uaLower)) {
      os = 'Windows';
    } else if (/macintosh|mac os x/i.test(uaLower)) {
      os = 'macOS';
    } else if (/linux/i.test(uaLower)) {
      os = 'Linux';
    }

    // Navegador & In-App
    if (/whatsapp/i.test(uaLower)) {
      browser = 'WhatsApp In-App';
    } else if (/edg\//i.test(uaLower)) {
      browser = 'Microsoft Edge';
    } else if (/chrome|crios/i.test(uaLower) && !/opr|opera/i.test(uaLower)) {
      browser = 'Google Chrome';
    } else if (/safari/i.test(uaLower) && !/chrome|crios/i.test(uaLower)) {
      browser = 'Apple Safari';
    } else if (/firefox|fxios/i.test(uaLower)) {
      browser = 'Mozilla Firefox';
    } else if (/opr|opera/i.test(uaLower)) {
      browser = 'Opera';
    }

    const icon = deviceType === 'Mobile' ? '📱' : (deviceType === 'Tablet' ? '📟' : '💻');
    const deviceDisplay = `${icon} ${deviceType} • ${os} (${browser})`;

    return {
      device: deviceDisplay,
      deviceType,
      os,
      browser
    };
  }

  /**
   * Resolve a localização do cliente a partir do DDD brasileiro do telefone ou do IP
   */
  resolveLocation(phone, ip) {
    if (phone) {
      const clean = String(phone).replace(/\D/g, '');
      let ddd = '';
      if (clean.startsWith('55') && clean.length >= 10) {
        ddd = clean.slice(2, 4);
      } else if (clean.length === 10 || clean.length === 11) {
        ddd = clean.slice(0, 2);
      }

      const dddMap = {
        '11': 'São Paulo / SP',
        '12': 'São José dos Campos & Vale / SP',
        '13': 'Santos & Baixada Santista / SP',
        '14': 'Bauru & Marília / SP',
        '15': 'Sorocaba / SP',
        '16': 'Ribeirão Preto / SP',
        '17': 'São José do Rio Preto / SP',
        '18': 'Presidente Prudente / SP',
        '19': 'Campinas & Piracicaba / SP',
        '21': 'Rio de Janeiro / RJ',
        '22': 'Campos & Região dos Lagos / RJ',
        '24': 'Volta Redonda & Petrópolis / RJ',
        '27': 'Vitória & Grande Vitória / ES',
        '28': 'Cachoeiro de Itapemirim / ES',
        '31': 'Belo Horizonte / MG',
        '32': 'Juiz de Fora / MG',
        '33': 'Governador Valadares / MG',
        '34': 'Uberlândia & Triângulo / MG',
        '35': 'Poços de Caldas & Sul / MG',
        '37': 'Divinópolis & Centro-Oeste / MG',
        '38': 'Montes Claros / MG',
        '41': 'Curitiba / PR',
        '42': 'Ponta Grossa / PR',
        '43': 'Londrina / PR',
        '44': 'Maringá / PR',
        '45': 'Cascavel & Foz do Iguaçu / PR',
        '46': 'Francisco Beltrão / PR',
        '47': 'Joinville & Balneário Camboriú / SC',
        '48': 'Florianópolis / SC',
        '49': 'Chapecó & Oeste / SC',
        '51': 'Porto Alegre / RS',
        '53': 'Pelotas & Rio Grande / RS',
        '54': 'Caxias do Sul & Serra / RS',
        '55': 'Santa Maria & Passo Fundo / RS',
        '61': 'Brasília / DF',
        '62': 'Goiânia / GO',
        '63': 'Palmas / TO',
        '64': 'Rio Verde & Caldas Novas / GO',
        '65': 'Cuiabá / MT',
        '66': 'Rondonópolis & Sinop / MT',
        '67': 'Campo Grande / MS',
        '68': 'Rio Branco / AC',
        '69': 'Porto Velho / RO',
        '71': 'Salvador / BA',
        '73': 'Ilhéus & Porto Seguro / BA',
        '74': 'Juazeiro & Irecê / BA',
        '75': 'Feira de Santana / BA',
        '77': 'Vitória da Conquista / BA',
        '79': 'Aracaju / SE',
        '81': 'Recife / PE',
        '82': 'Maceió / AL',
        '83': 'João Pessoa / PB',
        '84': 'Natal / RN',
        '85': 'Fortaleza / CE',
        '86': 'Teresina / PI',
        '87': 'Petrolina & Sertão / PE',
        '88': 'Juazeiro do Norte & Sobral / CE',
        '89': 'Picos & Floriano / PI',
        '91': 'Belém / PA',
        '92': 'Manaus / AM',
        '93': 'Santarém / PA',
        '94': 'Marabá & Parauapebas / PA',
        '95': 'Boa Vista / RR',
        '96': 'Macapá / AP',
        '97': 'Interior / AM',
        '98': 'São Luís / MA',
        '99': 'Imperatriz / MA'
      };

      if (dddMap[ddd]) {
        return `${dddMap[ddd]} (DDD ${ddd})`;
      }
    }

    if (ip) {
      const cleanIp = String(ip).replace('::ffff:', '').trim();
      if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.') || cleanIp === 'localhost') {
        return 'Rede Local / Servidor';
      }
      return `Brasil (IP ${cleanIp})`;
    }

    return 'Localização Desconhecida';
  }

  /**
   * Identifica o nome amigável da loja / sub-bot
   */
  resolveStoreName(subbotId) {
    if (!subbotId || Number(subbotId) === 1) {
      return 'Loja Principal (Matriz)';
    }
    const sId = Number(subbotId);
    try {
      const inst = models.getArmyInstanceById(sId);
      if (inst && inst.name) {
        return `Sub-Bot #${sId} - ${inst.name}`;
      }
    } catch (_) {}
    return `Sub-Bot #${subbotId}`;
  }

  /**
   * Registra um evento de telemetria vindo do frontend da loja com enriquecimento de aparelho e localização
   */
  async trackEvent(data = {}) {
    const {
      session_id,
      phone,
      customer_name,
      event_type,
      product_id,
      product_name,
      cart_payload,
      cart_total,
      metadata,
      ip,
      user_agent,
      section,
      subbot_id,
      screen_resolution
    } = data;
    if (!session_id || !event_type) return { success: false, message: 'session_id e event_type são obrigatórios' };

    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const uaParsed = this.parseUserAgent(user_agent);
    const location = this.resolveLocation(cleanPhone, ip);
    const storeName = this.resolveStoreName(subbot_id);
    const currentSection = section || (metadata?.section) || (product_name ? 'Produto' : 'Catálogo');

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
      metadata,
      ip,
      device: uaParsed.device,
      location,
      section: currentSection
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

    // 3. Salva / Atualiza o estado da sessão com todos os dados do dispositivo e local
    models.saveCartSession({
      session_id,
      phone: cleanPhone,
      customer_name,
      cart_items: cart_payload,
      cart_total: cart_total || 0,
      status: sessionStatus,
      ip,
      location,
      device: uaParsed.device,
      device_type: uaParsed.deviceType,
      browser: uaParsed.browser,
      os: uaParsed.os,
      current_section: currentSection,
      current_product_id: product_id ? Number(product_id) : null,
      current_product_name: product_name || null,
      subbot_id: subbot_id ? Number(subbot_id) : 1,
      subbot_name: storeName,
      screen_resolution: screen_resolution || null,
      is_online: 1
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

        // Registra memórias episódicas e atualiza inteligência de produtos e margem
        if (event_type === 'PAGE_VIEW') {
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_ACCESS',
            `Acessou a vitrine digital (${storeName}) via ${uaParsed.device}`,
            `Cliente abriu o catálogo online localizado em ${location}`,
            3
          );
        } else if (event_type === 'PRODUCT_VIEW' && product_name) {
          if (product_id) models.recordProductView(product_id);
          models.upsertLeadCognitiveProfile(cleanPhone, {
            last_viewed_product_id: Number(product_id) || undefined,
            last_viewed_product_name: product_name,
            last_store_visit_at: new Date().toISOString()
          });
          models.updateLeadBelief(cleanPhone, 'produto_em_foco', product_name, 'Visualizou detalhes na vitrine web', 0.85);
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_VIEW',
            `Visualizou o produto "${product_name}" na vitrine web`,
            `Cliente acessou a página de detalhes do produto #${product_id || ''}`,
            3
          );
        } else if (event_type === 'ADD_TO_CART' && product_name) {
          if (product_id) models.recordProductCartAdd(product_id);
          models.upsertLeadCognitiveProfile(cleanPhone, {
            buying_stage: 'DECISAO_IMINENTE',
            readiness_score: Math.max(profile?.readiness_score || 50, 75),
            current_cart_total: Number(cart_total || 0),
            last_viewed_product_id: Number(product_id) || undefined,
            last_viewed_product_name: product_name,
            high_margin_interest: 1
          });
          models.updateLeadBelief(cleanPhone, 'carrinho_ativo', product_name, `Adicionou ao carrinho (Total: R$ ${Number(cart_total || 0).toFixed(2)})`, 0.95);
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
          models.upsertLeadCognitiveProfile(cleanPhone, {
            buying_stage: 'FECHAMENTO',
            readiness_score: Math.max(profile?.readiness_score || 50, 90),
            current_cart_total: Number(cart_total || 0),
            high_margin_interest: 1
          });
          models.updateLeadBelief(cleanPhone, 'fase_compra', 'CHECKOUT_ABERTO', `Abriu checkout na vitrine web (R$ ${Number(cart_total || 0).toFixed(2)})`, 0.98);
          models.addLeadEpisodicMemory(
            cleanPhone,
            'STORE_CHECKOUT_OPEN',
            `Abriu modal de checkout para concluir compra de R$ ${Number(cart_total || 0).toFixed(2)}`,
            `Etapa final de checkout iniciada na vitrine web`,
            5
          );
        } else if (event_type === 'CHECKOUT_SUBMIT') {
          if (product_id) models.recordProductSale(product_id, cart_total);
          models.upsertLeadCognitiveProfile(cleanPhone, {
            buying_stage: 'CONVERTIDO',
            readiness_score: 100
          });
          models.updateLeadBelief(cleanPhone, 'cliente_convertido', 'SIM', 'Finalizou checkout na vitrine web', 1.0);
        }
      } catch (err) {
        console.error('[WebStoreTracker ⚠️ Erro na integração cognitiva]:', err.message);
      }
    }

    return { success: true, session_id, event_type };
  }

  /**
   * Heartbeat periódico da vitrine web (mantém status online, seção e produto atualizados)
   */
  async recordHeartbeat(data = {}) {
    const {
      session_id,
      phone,
      customer_name,
      section,
      product_id,
      product_name,
      subbot_id,
      ip,
      user_agent,
      screen_resolution,
      cart_total,
      cart_items
    } = data;
    if (!session_id) return { success: false, message: 'session_id obrigatório' };

    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const uaParsed = this.parseUserAgent(user_agent);
    const location = this.resolveLocation(cleanPhone, ip);
    const storeName = this.resolveStoreName(subbot_id);

    models.saveCartSession({
      session_id,
      phone: cleanPhone,
      customer_name: customer_name || null,
      ip: ip || null,
      location,
      device: uaParsed.device,
      device_type: uaParsed.deviceType,
      browser: uaParsed.browser,
      os: uaParsed.os,
      current_section: section || 'Catálogo',
      current_product_id: product_id ? Number(product_id) : null,
      current_product_name: product_name || null,
      subbot_id: subbot_id ? Number(subbot_id) : 1,
      subbot_name: storeName,
      screen_resolution: screen_resolution || null,
      cart_total: cart_total !== undefined ? Number(cart_total) : undefined,
      cart_items: cart_items || undefined,
      is_online: 1
    });

    return { success: true, session_id, is_online: true };
  }

  /**
   * Retorna os visitantes e lojas abertas em tempo real
   */
  getLiveStoreSessions(minutesWindow = 10) {
    return models.getLiveStoreSessions(minutesWindow);
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
    try {
      if ((gateway === 'pix' || gateway === 'livepix' || gateway === 'bacen') && pixCode) {
        // Mensagem 1: Fatura detalhada do pedido
        const clientMsg = `🛍️ *PEDIDO RECEBIDO COM SUCESSO!* 🛍️\n\n` +
          `Olá, *${customerName || 'Cliente'}*! Confirmamos o registro do seu pedido *#${tradeNo}* na nossa vitrine web.\n\n` +
          `📦 *Resumo dos Itens:*\n` +
          items.map(i => `• ${i.quantity}x ${i.name} (R$ ${Number(i.totalBRL || i.price_brl * i.quantity).toFixed(2)})`).join('\n') + `\n\n` +
          `💰 *Total:* *R$ ${Number(finalBRL).toFixed(2)}*\n` +
          `⚡ *Forma Escolhida:* PIX\n\n` +
          `📱 *Como Pagar:*\n` +
          `1. Aponte a câmera do aplicativo do seu banco para a imagem do QR Code a seguir, OU\n` +
          `2. Copie o código *Pix Copia e Cola* enviado isolado abaixo para copiar com 1 toque no seu celular.`;

        await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, clientMsg);
        await new Promise(r => setTimeout(r, 600));

        // Mensagem 2: Imagem do QR Code em alta definição
        try {
          let qrBuf = orderData.qrBuffer;
          if (!Buffer.isBuffer(qrBuf)) {
            qrBuf = await QRCode.toBuffer(pixCode, { width: 360, margin: 2 });
          }
          if (Buffer.isBuffer(qrBuf)) {
            await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, {
              image: qrBuf,
              caption: `📸 *QR CODE PIX* - Aponte a câmera do aplicativo do seu banco para pagar o Pedido #${tradeNo}`
            }, { noVerificado: true });
            await new Promise(r => setTimeout(r, 600));
          }
        } catch (qrErr) {
          console.warn('[WebStoreTracker ⚠️ Erro ao enviar QR Code buffer]:', qrErr.message);
        }

        // Mensagem 3: Aviso prévio
        await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, `👇 *PIX COPIA E COLA (Toque e segure no código abaixo para copiar):*`);
        await new Promise(r => setTimeout(r, 300));

        // Mensagem 4: CAIXA DE DIÁLOGO SEPARADA CONTENDO RIGOROSAMENTE APENAS O CÓDIGO
        await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, `${pixCode.trim()}`);
        await new Promise(r => setTimeout(r, 400));

        // Mensagem 5: Confirmação de aprovação automática
        await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, `⚡ *Aprovação Automática:* O acesso ao seu produto será liberado imediatamente assim que o pagamento for concluído!`);

      } else {
        let clientMsg = `🛍️ *PEDIDO RECEBIDO COM SUCESSO!* 🛍️\n\n` +
          `Olá, *${customerName || 'Cliente'}*! Confirmamos o registro do seu pedido *#${tradeNo}* na nossa vitrine web.\n\n` +
          `📦 *Resumo dos Itens:*\n` +
          items.map(i => `• ${i.quantity}x ${i.name} (R$ ${Number(i.totalBRL || i.price_brl * i.quantity).toFixed(2)})`).join('\n') + `\n\n` +
          `💰 *Total:* *R$ ${Number(finalBRL).toFixed(2)}*\n` +
          `⚡ *Forma Escolhida:* ${String(gateway || 'WhatsApp').toUpperCase()}\n\n`;

        if (gateway === 'whatsapp') {
          clientMsg += `Nosso consultor técnico já recebeu seu pedido e está à disposição para sanar qualquer dúvida ou emitir sua fatura.`;
        }
        await whatsappBot.sendMessage(`${cleanCustomer}@s.whatsapp.net`, clientMsg);
      }
    } catch (e) {
      console.error('[WebStoreTracker ⚠️ Falha ao avisar cliente no WhatsApp]:', e.message);
    }

    // 2. Alerta imediato: Envia no Grupo Específico de #ORD em vez do privado do Dono!
    const ordersGroupJid = models.getOrdersGroupJid ? models.getOrdersGroupJid() : (models.getSetting('ORDERS_GROUP_JID') || process.env.ORDERS_GROUP_JID || '');
    const itemsList = items.map(i => `  • ${i.quantity}x *${i.name}* (R$ ${Number(i.totalBRL || (i.price_brl * i.quantity) || 0).toFixed(2)})`).join('\n');
    const paymentMethod = (gateway === 'livepix' || gateway === 'bacen') ? 'PIX' : String(gateway || 'PIX').toUpperCase();

    const orderAlert = `📦 *NOVO PEDIDO GERADO NA LOJA (#${tradeNo})* 🛍️\n\n` +
      `🔖 *Cód. Pedido:* \`#${tradeNo}\`\n` +
      `👤 *Cliente:* ${customerName || 'Cliente Web'} (+${cleanCustomer})\n` +
      `💰 *Valor Total:* *R$ ${Number(finalBRL).toFixed(2)}*\n` +
      `⚡ *Forma de Pagamento:* ${paymentMethod}\n` +
      `📦 *Itens (${items.length}):*\n${itemsList}\n\n` +
      (pixCode ? `🔑 *Pix Copia e Cola:* \`${pixCode.trim()}\`\n\n` : '') +
      `⏳ _Aguardando compensação do pagamento pelo sistema._`;

    if (ordersGroupJid) {
      try {
        await whatsappBot.sendMessage(ordersGroupJid, orderAlert);
        console.log(`[Loja 📦 Pedido #${tradeNo}] Notificação enviada com sucesso para o Grupo #ORD (${ordersGroupJid})`);
      } catch (grpErr) {
        console.warn(`[Loja ⚠️ Falha ao enviar para o Grupo #ORD]:`, grpErr.message);
      }
    } else {
      // Fallback de segurança: se nenhum grupo de #ORD foi configurado, envia ao Dono
      const ownerPhone = models.getSetting('OWNER_WHATSAPP', '554884702848');
      const cleanOwner = String(ownerPhone).replace(/\D/g, '');
      if (cleanOwner) {
        try {
          await whatsappBot.sendMessage(`${cleanOwner}@s.whatsapp.net`, orderAlert);
        } catch (_) {}
      }
    }

    // 🧠 ALIMENTA O NÚCLEO DE INTELIGÊNCIA COM O NOVO PEDIDO GERADO (#ORD_)
    try {
      const knowledgeBaseService = require('./knowledgeBaseService');
      knowledgeBaseService.feedFromOrder({
        order: {
          merchant_trade_no: tradeNo,
          amount: finalBRL,
          platform_user_id: cleanCustomer
        },
        leadPhone: cleanCustomer
      });
    } catch (_) {}

    return true;
  }
}

module.exports = new WebStoreTrackerService();

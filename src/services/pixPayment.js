const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');
const livepixScraper = require('./livepixScraperService');
const bacenPixService = require('./bacenPixService');
const pixUtil = require('../utils/pixEmvUtil');

// Delegações para o utilitário EMV oficial do Banco Central
const {
  formatEMV,
  crc16,
  parseEMV,
  detectAndSanitizePixKey,
  sanitizePixKey,
  normalizeAndValidatePixCode,
  generateBacenPixPayload,
  inspectPixCode
} = pixUtil;

class PixPaymentService {
  getSettings(tenantId = null) {
    let tenantSettings = null;
    let tenantLivepixUser = '';
    if (tenantId) {
      try {
        const tenant = models.getTenantById(tenantId);
        tenantSettings = tenant?.settings || null;
        if (tenantSettings?.livepix_username) {
          tenantLivepixUser = tenantSettings.livepix_username.trim().replace(/^@/, '');
        }
      } catch (_) {}
    }

    const isPixEnabled = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
    const isLivepixEnabled = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'true') === 'true';
    const isBinanceEnabled = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';
    const isBacenPixEnabled = models.getSetting('GATEWAY_BACEN_PIX_ENABLED', 'false') === 'true';
    const primaryProvider = (tenantSettings?.livepix_default ? 'livepix' : (models.getSetting('PIX_PRIMARY_PROVIDER', 'livepix') || 'livepix')).toLowerCase();

    const mpToken = (models.getSetting('MERCADO_PAGO_ACCESS_TOKEN', '') || '').trim();
    const livepixUser = (tenantLivepixUser || models.getSetting('LIVEPIX_USERNAME', '') || process.env.LIVEPIX_USERNAME || '').trim().replace(/^@/, '');
    const effectiveLivepixUser = livepixUser;

    const merchantName = (models.getSetting('PIX_MERCHANT_NAME', '') || 'PAYBOT').trim();
    const merchantCity = (models.getSetting('PIX_MERCHANT_CITY', '') || 'SAO PAULO').trim();

    let pixKey = (tenantSettings?.pix_key || models.getSetting('BACEN_PIX_KEY', '') || models.getSetting('PIX_KEY', '') || '').trim();
    if (!pixKey || pixKey === 'contato@meunegocio.com' || pixKey === '00000000000') {
      const ownerPhone = (models.getSetting('OWNER_PHONE', '') || config.ownerPhone || process.env.OWNER_PHONE || '').trim();
      if (ownerPhone) pixKey = ownerPhone;
    }
    const cleanPixKey = sanitizePixKey(pixKey || '5548984702848');

    const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
    const isSimulatedSetting = isProduction ? false : (models.getSetting('PIX_SIMULATION_MODE', 'false') === 'true');
    const publicUrl = models.getSetting('PUBLIC_URL', config.publicUrl);

    // Conta primária (Mercado Pago) está configurada se possuir token com mais de 10 caracteres
    const isPrimaryConfigured = Boolean(mpToken && mpToken.length > 10);
    // Gateway oficial BACEN Pix está configurado se toggle ativo e credenciais mTLS presentes
    const isBacenConfigured = isBacenPixEnabled && bacenPixService.isConfigured();
    // Provedor LivePix está configurado se nome de usuário foi informado E (toggle ativo OU selecionado como primário)
    const isSecondaryLivepixConfigured = Boolean(effectiveLivepixUser && (isLivepixEnabled || primaryProvider === 'livepix'));
    // Chave Pix manual configurada se houver chave cadastrada ou chave do dono disponível
    const isManualPixConfigured = Boolean(cleanPixKey && cleanPixKey.length >= 3);

    return {
      isProduction,
      isPixEnabled,
      isLivepixEnabled,
      isBinanceEnabled,
      isBacenPixEnabled,
      primaryProvider,
      mpToken,
      livepixUser: effectiveLivepixUser,
      rawLivepixUser: livepixUser,
      pixKey: cleanPixKey,
      merchantName,
      merchantCity,
      isPrimaryConfigured,
      isBacenConfigured,
      isSecondaryLivepixConfigured,
      isManualPixConfigured,
      isSimulated: isProduction ? false : isSimulatedSetting,
      publicUrl
    };
  }

  // Gera cobrança via LivePix: insere os dados e repassa tanto o Link Oficial quanto o Pix Copia e Cola / QR Code oficiais
  async createLivepixCharge({ merchantTradeNo, amount, payerPhone, settings }) {
    const safeAmount = Number(amount).toFixed(2);
    const cleanUser = (settings.livepixUser || '').trim().replace(/^@/, '');
    const cleanPhone = payerPhone ? String(payerPhone).replace(/\D/g, '') : '';

    // Constrói o link oficial do LivePix com todos os dados inseridos pelo bot (valor, identificador do pedido e telefone)
    const directLivepixUrl = cleanUser 
      ? `https://livepix.gg/${cleanUser}?amount=${safeAmount}&message=${merchantTradeNo}${cleanPhone ? `&username=${cleanPhone}` : ''}`
      : `${settings.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}&gateway=livepix`;

    console.log(`[Pix 💜 LIVEPIX] Gerando cobrança Pix oficial (LivePix) para o pedido ${merchantTradeNo} (@${cleanUser || 'paybot'}) - R$ ${safeAmount}...`);

    let livepixPixCode = null;
    let qrBuffer = null;
    let qrCodeBase64 = null;
    let isDynamicLivepix = false;

    // 1. TENTA AUTOMATIZAÇÃO OFICIAL LIVEPIX (TELAS 1 -> 2 -> 3)
    if (cleanUser && livepixScraper.isAvailable()) {
      try {
        console.log(`[Pix 💜 LIVEPIX ⚡] Executando automação inteligente LivePix (@${cleanUser})...`);
        const scraperRes = await livepixScraper.generateLivepixPix({
          username: cleanUser,
          clientPhone: cleanPhone,
          tradeNo: merchantTradeNo,
          amount: safeAmount,
          coverFees: true,
          timeoutMs: 30000
        });

        if (scraperRes && scraperRes.success && scraperRes.pixCode) {
          // Normaliza garantindo injeção de 010212 e cálculo de CRC16 oficial
          livepixPixCode = normalizeAndValidatePixCode(scraperRes.pixCode);
          qrBuffer = scraperRes.qrBuffer || (await QRCode.toBuffer(livepixPixCode, { width: 360, margin: 2 }));
          qrCodeBase64 = scraperRes.qrCodeBase64 || (await QRCode.toDataURL(livepixPixCode));
          isDynamicLivepix = true;
          console.log(`[Pix 💜 LIVEPIX ✅] Pix Dinâmico LivePix obtido e normalizado: ${livepixPixCode.slice(0, 35)}...`);
        } else {
          console.warn(`[Pix 💜 LIVEPIX ⚠️] Automação retornou sem código (${scraperRes?.reason || 'sem resposta'}). Aplicando fallback BACEN.`);
        }
      } catch (scrapErr) {
        console.warn('[Pix 💜 LIVEPIX ⚠️ Falha na automação LivePix]:', scrapErr.message);
      }
    }

    // 2. FALLBACK IMEDIATO: Payload padrão BACEN EMV QRCPS-MPM (000201...)
    if (!livepixPixCode) {
      console.log(`[Pix 💜 LIVEPIX] Gerando payload BACEN Pix universal para @${cleanUser || 'paybot'}...`);
      const effectiveKey = settings.pixKey || sanitizePixKey('5548984702848');
      const merchantName = (cleanUser || settings.merchantName || 'PAYBOT').slice(0, 25).toUpperCase();
      const rawStatic = generateBacenPixPayload({
        pixKey: effectiveKey,
        merchantName: merchantName,
        merchantCity: settings.merchantCity || 'SAO PAULO',
        amount: safeAmount,
        txid: '***' // txid '***' garante 100% de compatibilidade em QR Code Estático em todos os bancos
      });
      livepixPixCode = normalizeAndValidatePixCode(rawStatic);

      qrBuffer = await QRCode.toBuffer(livepixPixCode, { width: 360, margin: 2 });
      qrCodeBase64 = await QRCode.toDataURL(livepixPixCode);
    }

    // Se em ambiente de teste ou simulação, marca adequadamente
    const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
    const isSimulated = !isProduction && (settings.isSimulated || models.getSetting('PIX_SIMULATION_MODE', 'false') === 'true');

    return {
      success: true,
      gateway: 'livepix',
      isBacen: false,
      isLivepix: true,
      isSimulated: isSimulated,
      isDynamicLivepix,
      hasPixCode: true,
      checkoutUrl: directLivepixUrl,
      pixCode: livepixPixCode,
      qrContent: qrCodeBase64,
      data: {
        paymentId: `LPX_${merchantTradeNo}`,
        pixCode: livepixPixCode,
        qrBuffer: qrBuffer,
        qrCodeBase64: qrCodeBase64,
        checkoutUrl: directLivepixUrl,
        livepixUsername: cleanUser,
        isDynamicLivepix,
        instructions: `Utilize o QR Code ou o Pix Copia e Cola no app do seu banco para pagar o pedido ${merchantTradeNo} com aprovação imediata.`
      }
    };
  }

  // Cria cobrança Pix (LivePix prioritário, BACEN Pix API, Mercado Pago, ou Chave Pix)
  async createPixCharge({ merchantTradeNo, amount, goodsName, payerName, payerEmail, payerPhone, payerCpf, forceGateway, tenantId = null }) {
    const settings = this.getSettings(tenantId);
    const safeAmount = Number(amount).toFixed(2);

    // 0. VERIFICAÇÃO DE PROVEDOR FORÇADO OU PREFERIDO
    const isBacenExplicitlyForced = forceGateway === 'bacen';
    const isLivepixExplicitlyForced = forceGateway === 'livepix';
    const isManualPixExplicitlyForced = forceGateway === 'pix_manual' || forceGateway === 'pix' || forceGateway === 'chave';
    const isPrimaryManualPix = settings.primaryProvider === 'pix_manual' || settings.primaryProvider === 'chave' || settings.primaryProvider === 'pix';
    const isPrimaryLivepix = (settings.primaryProvider === 'livepix' || (!settings.isPrimaryConfigured && !settings.isBacenConfigured && !isPrimaryManualPix));

    // 0.1 SE A CHAVE PIX DIRETA FOR PREFERENCIAL OU FORÇADA
    if (isManualPixExplicitlyForced || (isPrimaryManualPix && settings.isManualPixConfigured && !settings.isSimulated)) {
      const effectiveKey = settings.pixKey || sanitizePixKey('5548984702848');
      console.log(`[Pix 🔑 CHAVE MANUAL PRIMÁRIA] Gerando Pix direto homologado via Chave: ${effectiveKey} - R$ ${safeAmount}`);
      const directCode = normalizeAndValidatePixCode(generateBacenPixPayload({
        pixKey: effectiveKey,
        merchantName: settings.merchantName || 'PAYBOT',
        merchantCity: settings.merchantCity || 'SAO PAULO',
        amount: safeAmount,
        txid: '***'
      }));
      const qrBuffer = await QRCode.toBuffer(directCode, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(directCode);

      return {
        success: true,
        gateway: 'pix_manual',
        isBacen: false,
        isLivepix: false,
        isSimulated: Boolean(settings.isSimulated && !settings.isProduction),
        data: {
          paymentId: `PIX_${merchantTradeNo}`,
          pixCode: directCode,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl: `${settings.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}&gateway=pix_manual`
        }
      };
    }

    // 0.2 PRIORIZA LIVEPIX SE FORÇADO OU SELECIONADO COMO PRIMÁRIO
    const shouldTryLivepixFirst = isLivepixExplicitlyForced || (!isBacenExplicitlyForced && isPrimaryLivepix && settings.isSecondaryLivepixConfigured);
    if (shouldTryLivepixFirst) {
      const livepixRes = await this.createLivepixCharge({ merchantTradeNo, amount, payerPhone, settings });
      if (livepixRes && livepixRes.success) {
        return livepixRes;
      }
    }

    // 1. TENTA BACEN PIX API OFICIAL (Apenas se forçado OU configurado com mTLS ativo)
    const shouldTryBacenFirst = isBacenExplicitlyForced || 
      (!shouldTryLivepixFirst && settings.isBacenConfigured && settings.primaryProvider === 'bacen');

    if (shouldTryBacenFirst && settings.isBacenConfigured) {
      try {
        console.log(`[Pix 🏦 BACEN OFICIAL] Gerando cobrança via BACEN Pix API para ${merchantTradeNo}...`);
        const bacenRes = await bacenPixService.createCharge({
          merchantTradeNo,
          amount,
          goodsName,
          payerName,
          payerCpf,
          payerEmail
        });
        if (bacenRes && bacenRes.success) {
          if (bacenRes.data?.pixCode) {
            bacenRes.data.pixCode = normalizeAndValidatePixCode(bacenRes.data.pixCode);
          }
          return bacenRes;
        }
      } catch (err) {
        console.warn('[Pix ⚠️ BACEN Pix API falhou. Tentando próximo gateway...]:', err.message);
      }
    }

    // 2. TENTA MERCADO PAGO SE ESTIVER CONFIGURADO E NÃO FOR MODO SIMULADO FORÇADO
    const shouldTryMp = (forceGateway === 'mercadopago' || settings.isPrimaryConfigured) && !settings.isSimulated;
    if (shouldTryMp) {
      try {
        const cleanEmail = payerEmail && payerEmail.includes('@') ? payerEmail : `cliente_${merchantTradeNo.slice(-6)}@paybot.com`;
        const cleanName = payerName || 'Cliente';

        const response = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.mpToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': merchantTradeNo
          },
          body: JSON.stringify({
            transaction_amount: Number(amount),
            description: String(goodsName || 'Produto Digital').slice(0, 60),
            payment_method_id: 'pix',
            payer: {
              email: cleanEmail,
              first_name: cleanName.split(' ')[0]
            },
            notification_url: `${settings.publicUrl}/api/mercadopago/webhook`,
            external_reference: merchantTradeNo
          })
        });

        const resData = await response.json();

        if (resData.id && resData.point_of_interaction?.transaction_data) {
          const txData = resData.point_of_interaction.transaction_data;
          const pixCode = normalizeAndValidatePixCode(txData.qr_code);
          const qrBuffer = await QRCode.toBuffer(pixCode, { width: 360, margin: 2 });
          const qrCodeBase64 = await QRCode.toDataURL(pixCode);

          return {
            success: true,
            gateway: 'mercadopago',
            isBacen: false,
            isLivepix: false,
            isSimulated: false,
            data: {
              paymentId: String(resData.id),
              pixCode,
              qrBuffer,
              qrCodeBase64,
              ticketUrl: txData.ticket_url,
              checkoutUrl: txData.ticket_url
            }
          };
        } else {
          console.warn('[Pix ⚠️ Mercado Pago falhou. Acionando próximo gateway...]:', resData?.message || resData);
        }
      } catch (err) {
        console.warn('[Pix ⚠️ Erro ao conectar ao Mercado Pago. Acionando próximo gateway...]:', err.message);
      }
    }

    // 3. TENTA LIVEPIX COMO FALLBACK SE NÃO TIVER SIDO TESTADO ANTERIORMENTE
    if (!shouldTryLivepixFirst && settings.isSecondaryLivepixConfigured) {
      const livepixRes = await this.createLivepixCharge({ merchantTradeNo, amount, payerPhone, settings });
      if (livepixRes && livepixRes.success) {
        return livepixRes;
      }
    }

    // 4. CHAVE PIX DIRETA / MANUAL (Se configurada ou chave do Dono ativa e NÃO for modo simulação)
    const isSimulationActive = !settings.isProduction && (settings.isSimulated || models.getSetting('PIX_SIMULATION_MODE', 'false') === 'true');
    if ((settings.isManualPixConfigured || settings.pixKey) && !isSimulationActive) {
      const effectiveKey = settings.pixKey || sanitizePixKey('5548984702848');
      console.log(`[Pix 🔑 CHAVE MANUAL] Gerando Pix direto homologado via Chave: ${effectiveKey} - R$ ${safeAmount}`);
      const directCode = normalizeAndValidatePixCode(generateBacenPixPayload({
        pixKey: effectiveKey,
        merchantName: settings.merchantName || 'PAYBOT',
        merchantCity: settings.merchantCity || 'SAO PAULO',
        amount: safeAmount,
        txid: '***'
      }));
      const qrBuffer = await QRCode.toBuffer(directCode, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(directCode);

      return {
        success: true,
        gateway: 'pix_manual',
        isBacen: false,
        isLivepix: false,
        isSimulated: false,
        data: {
          paymentId: `PIX_${merchantTradeNo}`,
          pixCode: directCode,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl: `${settings.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}&gateway=pix_manual`
        }
      };
    }

    // 5. MODO SIMULAÇÃO / TESTE (FALLBACK PADRÃO SE NENHUM GATEWAY ESTIVER ATIVO)
    const effectiveKey = settings.pixKey || sanitizePixKey('5548984702848');
    if (settings.isProduction) {
      console.warn(`[Pix ⚠️ AVISO DE PRODUÇÃO] Nenhum gateway Pix conectado. Gerando fallback local.`);
    } else {
      console.log(`[Pix 🧪 SIMULAÇÃO] Gerando Pix simulado para ${merchantTradeNo} - R$ ${safeAmount}`);
    }
    const mockPixCode = normalizeAndValidatePixCode(generateBacenPixPayload({
      pixKey: effectiveKey,
      merchantName: settings.merchantName || 'PAYBOT',
      merchantCity: settings.merchantCity || 'SAO PAULO',
      amount: safeAmount,
      txid: '***'
    }));
    const qrBuffer = await QRCode.toBuffer(mockPixCode, { width: 360, margin: 2 });
    const qrCodeBase64 = await QRCode.toDataURL(mockPixCode);
    const checkoutUrl = `${settings.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}`;

    return {
      success: true,
      gateway: 'simulated',
      isBacen: false,
      isLivepix: false,
      isSimulated: !settings.isProduction,
      data: {
        paymentId: `SIM_PIX_${Date.now()}`,
        pixCode: mockPixCode,
        qrBuffer,
        qrCodeBase64,
        checkoutUrl
      }
    };
  }

  // Consulta status de pagamento no gateway
  async queryPixPayment(paymentId) {
    if (!paymentId) return { success: false, status: 'UNKNOWN' };

    if (String(paymentId).startsWith('LPX_')) {
      return { success: true, status: 'PENDING', gateway: 'livepix' };
    }

    const { mpToken, isSimulated } = this.getSettings();

    // Se parecer txid BACEN ou ordem BACEN
    if (String(paymentId).length >= 26 || String(paymentId).startsWith('ORD')) {
      try {
        const bacenRes = await bacenPixService.queryCharge(paymentId);
        if (bacenRes && bacenRes.success) {
          return bacenRes;
        }
      } catch (_) {}
    }

    if (isSimulated || !mpToken || String(paymentId).startsWith('SIM_') || String(paymentId).startsWith('PIX_')) {
      return { success: true, status: 'PENDING', gateway: 'simulated' };
    }

    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${mpToken}`
        }
      });
      const data = await response.json();

      if (data.status === 'approved') {
        return { success: true, status: 'PAID', externalReference: data.external_reference, gateway: 'mercadopago' };
      }
      return { success: true, status: data.status || 'PENDING', gateway: 'mercadopago' };
    } catch (err) {
      console.error('[Pix Mercado Pago ❌ Erro ao consultar pagamento]:', err.message);
      return { success: false, status: 'UNKNOWN' };
    }
  }

  // Manipulador unificado de webhooks Pix
  async handleWebhook(payload) {
    if (!payload) return { success: false, error: 'Payload vazio' };

    // 1. Webhook oficial BACEN (Notificação { "pix": [...] })
    if (payload.pix || (Array.isArray(payload) && payload[0]?.txid)) {
      return bacenPixService.handleWebhook(payload);
    }

    // 2. Webhook Mercado Pago
    if (payload.data?.id || payload.id || payload.type === 'payment' || payload.action === 'payment.created' || payload.action === 'payment.updated') {
      const paymentId = payload.data?.id || payload.id;
      if (paymentId) {
        const queryRes = await this.queryPixPayment(paymentId);
        if (queryRes.success && queryRes.status === 'PAID' && queryRes.externalReference) {
          const fulfillment = require('./fulfillment');
          await fulfillment.fulfillOrder(queryRes.externalReference);
          return { success: true, status: 'PAID', tradeNo: queryRes.externalReference };
        }
      }
      return { success: true, received: true };
    }

    // 3. Webhook LivePix
    if (payload.reference || payload.customId || payload.message) {
      let tradeNo = payload.reference || payload.customId;
      if (!tradeNo && payload.message) {
        const match = payload.message.match(/ORD_[A-Za-z0-9_]+/);
        if (match) tradeNo = match[0];
      }
      if (tradeNo) {
        const fulfillment = require('./fulfillment');
        await fulfillment.fulfillOrder(tradeNo);
        return { success: true, status: 'PAID', tradeNo };
      }
    }

    return { success: false, message: 'Formato de webhook não reconhecido' };
  }
}

const instance = new PixPaymentService();
instance.sanitizePixKey = sanitizePixKey;
instance.detectAndSanitizePixKey = detectAndSanitizePixKey;
instance.generateBacenPixPayload = generateBacenPixPayload;
instance.normalizeAndValidatePixCode = normalizeAndValidatePixCode;
instance.inspectPixCode = inspectPixCode;
instance.crc16 = crc16;
instance.parseEMV = parseEMV;
instance.formatEMV = formatEMV;

module.exports = instance;

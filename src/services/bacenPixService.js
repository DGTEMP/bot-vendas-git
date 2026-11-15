const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');

/**
 * =========================================================================
 * 🏦 BACEN PIX API SERVICE (Especificação Oficial Banco Central do Brasil)
 * =========================================================================
 * Implementação em conformidade com o padrão oficial BACEN:
 * Repositório Oficial: https://github.com/bacen/pix-api.git
 * 
 * Recursos:
 * - Autenticação OAuth2 Client Credentials (POST /oauth/token)
 * - Suporte a mTLS (Mutual TLS com certificado de cliente .pem/.crt e chave .key)
 * - Presets para principais PSPs (Efí/Gerencianet, Inter, BB, Itaú, Santander, Bradesco, Sicoob, Sicredi, Asaas)
 * - Criação de Cobrança Imediata (PUT /v2/cob/{txid} e POST /v2/cob)
 * - Construção de EMVCo BR Code (Pix Copia e Cola) com CRC16-CCITT oficial
 * - Consulta de Cobrança (GET /v2/cob/{txid})
 * - Parser e Tratamento de Webhook Oficial BACEN (POST /v2/webhook/{chave} e /api/bacen-pix/webhook)
 * - Testador de Conexão e Diagnóstico OAuth mTLS
 * =========================================================================
 */

class BacenPixService {
  constructor() {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  // Presets oficiais de PSPs regulados pelo BACEN
  static PRESETS = {
    efi: {
      name: 'Efí / Gerencianet',
      prodBaseUrl: 'https://pix.api.efipay.com.br',
      sandboxBaseUrl: 'https://pix-h.api.efipay.com.br',
      oauthPath: '/oauth/token',
      requiresMtls: true
    },
    inter: {
      name: 'Banco Inter',
      prodBaseUrl: 'https://cdpj.partners.bancointer.com.br',
      sandboxBaseUrl: 'https://cdpj-sandbox.partners.bancointer.com.br',
      oauthPath: '/oauth/v2/token',
      requiresMtls: true
    },
    bb: {
      name: 'Banco do Brasil',
      prodBaseUrl: 'https://api.bb.com.br/pix/v0.1',
      sandboxBaseUrl: 'https://api.hm.bb.com.br/pix/v0.1',
      oauthPath: 'https://oauth.bb.com.br/oauth/token',
      requiresMtls: true
    },
    itau: {
      name: 'Itaú Empresas',
      prodBaseUrl: 'https://secure.api.itau/pix_recebimentos/v2',
      sandboxBaseUrl: 'https://sandbox.itau.com.br/pix_recebimentos/v2',
      oauthPath: 'https://sts.itau.com.br/api/oauth/token',
      requiresMtls: true
    },
    santander: {
      name: 'Santander',
      prodBaseUrl: 'https://trust-open.api.santander.com.br',
      sandboxBaseUrl: 'https://trust-sandbox.api.santander.com.br',
      oauthPath: '/oauth/token',
      requiresMtls: true
    },
    bradesco: {
      name: 'Bradesco',
      prodBaseUrl: 'https://qrpix.bradesco.com.br',
      sandboxBaseUrl: 'https://qrpix-h.bradesco.com.br',
      oauthPath: '/auth/server/v1.0/token',
      requiresMtls: true
    },
    sicoob: {
      name: 'Sicoob',
      prodBaseUrl: 'https://api.sicoob.com.br/pix/api/v2',
      sandboxBaseUrl: 'https://sandbox.sicoob.com.br/pix/api/v2',
      oauthPath: 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token',
      requiresMtls: true
    },
    sicredi: {
      name: 'Sicredi',
      prodBaseUrl: 'https://api-pix.sicredi.com.br',
      sandboxBaseUrl: 'https://api-pix-h.sicredi.com.br',
      oauthPath: '/oauth/token',
      requiresMtls: true
    },
    asaas: {
      name: 'Asaas',
      prodBaseUrl: 'https://api.asaas.com/v3',
      sandboxBaseUrl: 'https://sandbox.asaas.com/api/v3',
      oauthPath: '/oauth/token',
      requiresMtls: false
    },
    custom: {
      name: 'Personalizado / Outro PSP BACEN',
      prodBaseUrl: '',
      sandboxBaseUrl: '',
      oauthPath: '/oauth/token',
      requiresMtls: true
    }
  };

  /**
   * Obtém as configurações consolidadas do banco de dados
   */
  getSettings() {
    const isEnabled = models.getSetting('GATEWAY_BACEN_PIX_ENABLED', 'false') === 'true';
    const psp = (models.getSetting('BACEN_PIX_PSP', 'custom') || 'custom').toLowerCase();
    const isProduction = typeof models.isProduction === 'function' ? models.isProduction() : (models.getSetting('ENVIRONMENT_MODE', 'sandbox') === 'production');
    const isSandbox = isProduction ? false : (models.getSetting('BACEN_PIX_SANDBOX', 'false') === 'true');
    const preset = BacenPixService.PRESETS[psp] || BacenPixService.PRESETS.custom;

    let baseUrl = (models.getSetting('BACEN_PIX_BASE_URL', '') || '').trim();
    if (!baseUrl && preset) {
      baseUrl = isSandbox ? preset.sandboxBaseUrl : preset.prodBaseUrl;
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    let oauthUrl = (models.getSetting('BACEN_PIX_OAUTH_URL', '') || '').trim();
    if (!oauthUrl && preset) {
      oauthUrl = preset.oauthPath;
    }

    const pixKey = (models.getSetting('BACEN_PIX_KEY', '') || models.getSetting('PIX_KEY', '') || '').trim();
    const clientId = (models.getSetting('BACEN_PIX_CLIENT_ID', '') || '').trim();
    const clientSecret = (models.getSetting('BACEN_PIX_CLIENT_SECRET', '') || '').trim();
    const cert = (models.getSetting('BACEN_PIX_CERT', '') || '').trim();
    const keyPem = (models.getSetting('BACEN_PIX_KEY_PEM', '') || '').trim();
    const passphrase = (models.getSetting('BACEN_PIX_PASSPHRASE', '') || '').trim();
    const merchantCity = (models.getSetting('BACEN_PIX_MERCHANT_CITY', 'SAO PAULO') || 'SAO PAULO').trim().toUpperCase();
    const merchantName = (models.getSetting('BACEN_PIX_MERCHANT_NAME', models.getSetting('BOT_NAME', 'PAYBOT')) || 'PAYBOT').trim().toUpperCase();
    const publicUrl = models.getSetting('PUBLIC_URL', config.publicUrl);
    const primaryProvider = (models.getSetting('PIX_PRIMARY_PROVIDER', 'auto') || 'auto').toLowerCase();

    return {
      isEnabled,
      psp,
      presetName: preset.name,
      isProduction,
      isSandbox,
      baseUrl,
      oauthUrl,
      pixKey,
      clientId,
      clientSecret,
      cert,
      keyPem,
      passphrase,
      merchantCity,
      merchantName,
      publicUrl,
      primaryProvider,
      isConfigured: Boolean(pixKey && clientId && (cert || clientSecret))
    };
  }

  /**
   * Verifica se o gateway BACEN Pix está apto a operar
   */
  isConfigured() {
    const s = this.getSettings();
    return s.isEnabled && s.isConfigured;
  }

  /**
   * Resolve o conteúdo do certificado ou chave privada a partir do texto ou arquivo em disco
   */
  resolveCertContent(input) {
    if (!input) return null;
    const trimmed = input.trim();
    // Se parecer conteúdo PEM direto
    if (trimmed.includes('-----BEGIN')) {
      return trimmed;
    }
    // Se for caminho de arquivo no sistema
    try {
      const candidates = [
        trimmed,
        path.resolve(trimmed),
        path.join(__dirname, '..', '..', trimmed),
        path.join(__dirname, '..', '..', 'data', 'certs', trimmed),
        path.join(__dirname, '..', '..', 'data', trimmed)
      ];
      for (const p of candidates) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return fs.readFileSync(p, 'utf8');
        }
      }
    } catch (_) {}
    return trimmed;
  }

  /**
   * Constrói o Agent HTTPS com mTLS para comunicação segura com o PSP
   */
  getHttpsAgent() {
    const s = this.getSettings();
    const certContent = this.resolveCertContent(s.cert);
    const keyContent = this.resolveCertContent(s.keyPem);

    if (certContent && keyContent) {
      return new https.Agent({
        cert: certContent,
        key: keyContent,
        passphrase: s.passphrase || undefined,
        rejectUnauthorized: !s.isSandbox,
        keepAlive: true
      });
    }

    return new https.Agent({
      rejectUnauthorized: !s.isSandbox,
      keepAlive: true
    });
  }

  /**
   * Executor padronizado de requisições HTTP/HTTPS com suporte a mTLS e timeout
   */
  httpRequest({ url, method = 'GET', headers = {}, body = null, agent = null, timeout = 20000 }) {
    return new Promise((resolve, reject) => {
      try {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          protocol: urlObj.protocol,
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method,
          headers: { ...headers },
          agent: agent || (isHttps ? this.getHttpsAgent() : undefined),
          timeout
        };

        let postData = null;
        if (body !== null && body !== undefined) {
          if (typeof body === 'string') {
            postData = body;
          } else if (Buffer.isBuffer(body)) {
            postData = body;
          } else {
            postData = JSON.stringify(body);
            if (!options.headers['Content-Type'] && !options.headers['content-type']) {
              options.headers['Content-Type'] = 'application/json';
            }
          }
          if (!options.headers['Content-Length'] && !options.headers['content-length']) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
          }
        }

        const req = client.request(options, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            let parsed = rawBody;
            try {
              parsed = JSON.parse(rawBody);
            } catch (_) {}

            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: parsed,
              rawBody
            });
          });
        });

        req.on('error', (err) => {
          reject(new Error(`[Bacen Pix NetError] ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`[Bacen Pix Timeout] Tempo limite de ${timeout}ms excedido na requisição para ${urlObj.hostname}`));
        });

        if (postData) {
          req.write(postData);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Obtém token de acesso OAuth2 usando o fluxo Client Credentials
   */
  async getAccessToken() {
    const s = this.getSettings();

    // Reutiliza token em cache se ainda for válido
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > (now + 60000)) {
      return this.cachedToken;
    }

    if (!s.clientId || !s.clientSecret) {
      throw new Error('Client ID e Client Secret são obrigatórios para autenticação OAuth2 BACEN.');
    }

    // Resolve URL completa de OAuth
    let targetOAuthUrl = s.oauthUrl;
    if (!targetOAuthUrl.startsWith('http://') && !targetOAuthUrl.startsWith('https://')) {
      targetOAuthUrl = `${s.baseUrl}${targetOAuthUrl.startsWith('/') ? '' : '/'}${targetOAuthUrl}`;
    }

    const basicAuth = Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64');
    const postBody = 'grant_type=client_credentials&scope=cob.read%20cob.write%20pix.read%20pix.write';

    console.log(`[Bacen Pix 🔐 OAuth] Solicitando token de acesso para ${s.presetName} (${targetOAuthUrl})...`);

    const res = await this.httpRequest({
      url: targetOAuthUrl,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: postBody,
      timeout: 15000
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const errMsg = typeof res.data === 'object' ? JSON.stringify(res.data) : res.rawBody;
      throw new Error(`Falha na autenticação OAuth2 (${res.statusCode}): ${errMsg}`);
    }

    const tokenData = res.data;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error(`Resposta OAuth sem access_token: ${JSON.stringify(tokenData)}`);
    }

    const expiresInSec = Number(tokenData.expires_in) || 3600;
    this.cachedToken = accessToken;
    this.tokenExpiresAt = now + (expiresInSec * 1000);

    console.log(`[Bacen Pix 🔐 OAuth] Token obtido com sucesso! Validade: ${expiresInSec}s`);
    return accessToken;
  }

  /**
   * Formata e valida o identificador de transação (txid) no padrão estrito BACEN
   * Regra BACEN: Regex ^[a-zA-Z0-9]{26,35}$
   */
  formatBacenTxid(merchantTradeNo) {
    const raw = String(merchantTradeNo || '').replace(/[^a-zA-Z0-9]/g, '');
    if (raw.length >= 26 && raw.length <= 35) {
      return raw;
    }
    if (raw.length > 35) {
      return raw.slice(0, 35);
    }
    // Se tiver menos de 26 caracteres, preenche deterministicamente com hash MD5
    const padNeeded = 26 - raw.length;
    const hash = crypto.createHash('md5').update(String(merchantTradeNo) + 'bacenpix').digest('hex').toUpperCase();
    return (raw + hash).slice(0, 32);
  }

  /**
   * Cálculo de redundância cíclica CRC16-CCITT (Polinômio 0x1021, Init 0xFFFF)
   * Padrão oficial exigido pelo BACEN na especificação EMVCo BR Code
   */
  computeCRC16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) << 8);
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Sanitiza e padroniza a Chave Pix conforme o manual oficial do BACEN
   */
  sanitizePixKey(rawKey) {
    if (!rawKey) return '';
    let clean = String(rawKey).trim();
    if (clean.includes('@')) return clean.toLowerCase().replace(/\s+/g, '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) return clean.toLowerCase();
    const digits = clean.replace(/\D/g, '');
    if (digits.length === 14) return digits; // CNPJ
    if (digits.length === 11 && clean.includes('.')) return digits; // CPF formatado
    if (digits.length === 11) {
      const ddd = parseInt(digits.slice(0, 2), 10);
      const thirdDigit = digits[2];
      if (ddd >= 11 && ddd <= 99 && thirdDigit === '9') return `+55${digits}`;
      return digits;
    }
    if (digits.length === 10) return `+55${digits}`;
    if (digits.length === 12 || digits.length === 13) {
      if (digits.startsWith('55')) return `+${digits}`;
    }
    if (clean.startsWith('+')) return `+${digits}`;
    return clean;
  }

  /**
   * Obtém a chave Pix efetiva do sistema com fallback seguro para o telefone do Dono
   */
  getEffectivePixKey() {
    let key = (models.getSetting('BACEN_PIX_KEY', '') || models.getSetting('PIX_KEY', '') || '').trim();
    if (!key || key === 'contato@meunegocio.com' || key === '00000000000') {
      const ownerPhone = (models.getSetting('OWNER_PHONE', '') || config.ownerPhone || process.env.OWNER_PHONE || '').trim();
      if (ownerPhone) key = ownerPhone;
    }
    return this.sanitizePixKey(key || '554884702848');
  }

  /**
   * Construtor de EMVCo BR Code (Pix Copia e Cola) oficial
   * Suporta QR Code Dinâmico (Tag 01 = 12 com URL/location real) e Estático (Tag 01 = 11 com Chave direta homologada)
   */
  generateBrcode({ location, chave, amount, merchantName = 'PAYBOT', merchantCity = 'SAO PAULO', txid = '***' }) {
    const formatField = (id, value) => {
      const strVal = String(value);
      const len = strVal.length.toString().padStart(2, '0');
      return `${id}${len}${strVal}`;
    };

    let payload = '';
    // Tag 00: Payload Format Indicator
    payload += formatField('00', '01');

    // Validação estrita de URL real para QR Code Dinâmico
    const isRealLocation = location && typeof location === 'string' &&
      !location.includes('pix.bcb.gov.br/qr/v2/cob_') &&
      (location.startsWith('http://') || location.startsWith('https://') || (location.includes('.') && !location.startsWith('pix.bcb.gov.br')));

    if (isRealLocation) {
      // 1. QR CODE DINÂMICO (Com URL/location real do PSP)
      payload += formatField('01', '12'); // 12 = Dinâmico

      const cleanUrl = location.replace(/^https?:\/\//, '');
      const accountInfo = formatField('00', 'br.gov.bcb.pix') + formatField('25', cleanUrl);
      payload += formatField('26', accountInfo);
    } else {
      // 2. QR CODE ESTÁTICO (Chave Pix direta homologada BACEN)
      payload += formatField('01', '11'); // 11 = Estático universal BACEN

      const effectiveKey = this.sanitizePixKey(chave || this.getEffectivePixKey());
      const accountInfo = formatField('00', 'br.gov.bcb.pix') + formatField('01', effectiveKey);
      payload += formatField('26', accountInfo);
    }

    // Tag 52: Merchant Category Code (0000 = Padrão)
    payload += formatField('52', '0000');
    // Tag 53: Transaction Currency (986 = BRL)
    payload += formatField('53', '986');

    // Tag 54: Transaction Amount
    if (amount && Number(amount) > 0) {
      const valStr = Number(amount).toFixed(2);
      payload += formatField('54', valStr);
    }

    // Tag 58: Country Code
    payload += formatField('58', 'BR');

    // Tag 59: Merchant Name (ASCII puro, sem acentos, máx 25)
    const cleanMerchantName = (merchantName || 'PAYBOT')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim().slice(0, 25) || 'PAYBOT';
    payload += formatField('59', cleanMerchantName);

    // Tag 60: Merchant City (ASCII puro, sem acentos, máx 15)
    const cleanMerchantCity = (merchantCity || 'SAO PAULO')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim().slice(0, 15) || 'SAO PAULO';
    payload += formatField('60', cleanMerchantCity);

    // Tag 62: Additional Data Field (txid)
    // Para estático sem PSP, BACEN exige '***' para compatibilidade com 100% dos bancos
    let cleanTxid = String(txid || '***').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
    if (!cleanTxid || !isRealLocation) {
      cleanTxid = '***';
    }
    const addData = formatField('05', cleanTxid);
    payload += formatField('62', addData);

    // Tag 63: CRC16 Checksum
    payload += '6304';
    const crc = this.computeCRC16(payload);
    return payload + crc;
  }

  /**
   * Criação de Cobrança Imediata no padrão BACEN (PUT /v2/cob/{txid} ou POST /v2/cob)
   */
  async createCharge({ merchantTradeNo, amount, goodsName, payerName, payerCpf, payerEmail }) {
    const s = this.getSettings();
    const safeAmount = Number(amount).toFixed(2);
    const txid = this.formatBacenTxid(merchantTradeNo);

    console.log(`[Bacen Pix 🏦] Iniciando cobrança BACEN para pedido ${merchantTradeNo} (txid: ${txid}) - R$ ${safeAmount}`);

    // Se estiver em modo simulado ou sem credenciais completas
    if (s.isSandbox && (!s.clientId || !s.clientSecret)) {
      console.log(`[Bacen Pix 🟢 SIMULAÇÃO] Gerando cobrança padrão BACEN homologada para ${merchantTradeNo}...`);
      const effectiveKey = this.getEffectivePixKey();
      const pixCopiaECola = this.generateBrcode({
        chave: effectiveKey,
        amount: safeAmount,
        merchantName: s.merchantName,
        merchantCity: s.merchantCity,
        txid: '***'
      });
      const qrBuffer = await QRCode.toBuffer(pixCopiaECola, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(pixCopiaECola);
      const checkoutUrl = `${s.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}&gateway=bacen`;

      return {
        success: true,
        gateway: 'bacen',
        isBacen: true,
        isSimulated: true,
        data: {
          paymentId: txid,
          txid,
          pixCode: pixCopiaECola,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl,
          status: 'ATIVA',
          instructions: 'Escaneie o QR Code no app do seu banco ou use a opção Pix Copia e Cola.'
        }
      };
    }

    try {
      const accessToken = await this.getAccessToken();

      // Monta payload estrito BACEN
      const cobPayload = {
        calendario: {
          expiracao: 3600 // 1 hora
        },
        valor: {
          original: safeAmount
        },
        chave: s.pixKey,
        solicitacaoPagador: goodsName ? goodsName.slice(0, 140) : `Pedido ${merchantTradeNo}`
      };

      // Adiciona devedor se informado
      if (payerCpf) {
        const cleanCpf = payerCpf.replace(/\D/g, '');
        if (cleanCpf.length === 11) {
          cobPayload.devedor = { cpf: cleanCpf, nome: (payerName || 'Cliente').slice(0, 100) };
        } else if (cleanCpf.length === 14) {
          cobPayload.devedor = { cnpj: cleanCpf, nome: (payerName || 'Cliente').slice(0, 100) };
        }
      }

      // Endpoint padrão BACEN: PUT /v2/cob/{txid}
      const cobUrl = `${s.baseUrl}/v2/cob/${txid}`;
      console.log(`[Bacen Pix 📤 Cobrança] Enviando PUT ${cobUrl}...`);

      let res = await this.httpRequest({
        url: cobUrl,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: cobPayload
      });

      // Se o PSP preferir POST /v2/cob (geração de txid pelo PSP)
      if (res.statusCode === 405 || (res.statusCode === 400 && res.rawBody.includes('POST'))) {
        console.log(`[Bacen Pix ℹ️] PSP requer POST /v2/cob ao invés de PUT. Alternando...`);
        res = await this.httpRequest({
          url: `${s.baseUrl}/v2/cob`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: cobPayload
        });
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Erro retornado pelo PSP BACEN (${res.statusCode}): ${JSON.stringify(res.data)}`);
      }

      const resData = res.data;
      const returnedTxid = resData.txid || txid;

      // Obtém ou constrói o Pix Copia e Cola
      let pixCopiaECola = resData.pixCopiaECola;
      if (!pixCopiaECola) {
        const locationUrl = resData.location || resData.loc?.location;
        if (locationUrl) {
          pixCopiaECola = this.generateBrcode({
            location: locationUrl,
            chave: s.pixKey,
            amount: safeAmount,
            merchantName: s.merchantName,
            merchantCity: s.merchantCity,
            txid: returnedTxid
          });
        }
      }

      if (!pixCopiaECola) {
        // Fallback seguro gerando BR Code estático com a chave
        pixCopiaECola = this.generateBrcode({
          chave: s.pixKey,
          amount: safeAmount,
          merchantName: s.merchantName,
          merchantCity: s.merchantCity,
          txid: returnedTxid
        });
      }

      const qrBuffer = await QRCode.toBuffer(pixCopiaECola, { width: 360, margin: 2 });
      const qrCodeBase64 = await QRCode.toDataURL(pixCopiaECola);

      return {
        success: true,
        gateway: 'bacen',
        isBacen: true,
        isSimulated: false,
        data: {
          paymentId: returnedTxid,
          txid: returnedTxid,
          pixCode: pixCopiaECola,
          qrBuffer,
          qrCodeBase64,
          checkoutUrl: resData.location ? `https://${resData.location.replace(/^https?:\/\//, '')}` : null,
          status: resData.status || 'ATIVA',
          instructions: 'Abra o app do seu banco, escolha Pagar via Pix e aponte a câmera ou use o Pix Copia e Cola.'
        }
      };
    } catch (err) {
      console.error(`[Bacen Pix ❌ Erro ao criar cobrança]:`, err.message);
      if (s.isSandbox || models.getSetting('PIX_SIMULATION_MODE', 'false') === 'true') {
        console.log(`[Bacen Pix 🟢 FALLBACK CHAVE DIRETA] Gerando Pix estático padrão BACEN homologado para ${merchantTradeNo}...`);
        const effectiveKey = this.getEffectivePixKey();
        const pixCopiaECola = this.generateBrcode({
          chave: effectiveKey,
          amount: safeAmount,
          merchantName: s.merchantName,
          merchantCity: s.merchantCity,
          txid: '***'
        });
        const qrBuffer = await QRCode.toBuffer(pixCopiaECola, { width: 360, margin: 2 });
        const qrCodeBase64 = await QRCode.toDataURL(pixCopiaECola);
        const checkoutUrl = `${s.publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}&gateway=bacen`;

        return {
          success: true,
          gateway: 'bacen',
          isBacen: true,
          isSimulated: true,
          data: {
            paymentId: txid,
            txid,
            pixCode: pixCopiaECola,
            qrBuffer,
            qrCodeBase64,
            checkoutUrl,
            status: 'ATIVA',
            instructions: 'Escaneie o QR Code no app do seu banco ou use a opção Pix Copia e Cola.'
          }
        };
      }
      throw err;
    }
  }

  /**
   * Consulta de cobrança no PSP (GET /v2/cob/{txid})
   */
  async queryCharge(txid) {
    const s = this.getSettings();
    if (!txid) return { success: false, status: 'UNKNOWN' };

    // Simulação
    if (s.isSandbox && (!s.clientId || !s.clientSecret)) {
      return { success: true, status: 'PENDING', gateway: 'bacen' };
    }

    try {
      const accessToken = await this.getAccessToken();
      const res = await this.httpRequest({
        url: `${s.baseUrl}/v2/cob/${txid}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return { success: false, status: 'UNKNOWN', error: res.rawBody };
      }

      const data = res.data;
      if (data.status === 'CONCLUIDA') {
        return {
          success: true,
          status: 'PAID',
          txid,
          endToEndId: data.pix?.[0]?.endToEndId,
          paidAmount: data.pix?.[0]?.valor,
          gateway: 'bacen'
        };
      }

      return {
        success: true,
        status: data.status || 'PENDING',
        txid,
        gateway: 'bacen'
      };
    } catch (err) {
      console.error(`[Bacen Pix ❌ Erro na consulta do txid ${txid}]:`, err.message);
      return { success: false, status: 'UNKNOWN', error: err.message };
    }
  }

  /**
   * Parser e manipulador de Notificação Webhook BACEN
   * Formato oficial BACEN: { "pix": [ { "endToEndId": "...", "txid": "...", "valor": "...", "horario": "..." } ] }
   */
  async handleWebhook(payload) {
    if (!payload) return { success: false, error: 'Payload vazio' };

    console.log('[Bacen Pix 🔔 Webhook] Recebendo notificação oficial BACEN:', JSON.stringify(payload));
    const pixList = payload.pix || (Array.isArray(payload) ? payload : null);

    if (!pixList || !Array.isArray(pixList) || pixList.length === 0) {
      return { success: false, message: 'Nenhuma transação Pix encontrada no payload.' };
    }

    const fulfillment = require('./fulfillment');
    const results = [];

    for (const item of pixList) {
      const txid = item.txid;
      const endToEndId = item.endToEndId;
      const amount = item.valor;

      if (!txid) {
        console.warn('[Bacen Pix Webhook ⚠️] Item recebido sem txid:', item);
        continue;
      }

      console.log(`[Bacen Pix Webhook ✅] Transação Pix confirmada! txid: ${txid}, E2E: ${endToEndId}, valor: R$ ${amount}`);

      // Procura pedido associado por merchant_trade_no ou prepay_id
      let order = models.getOrderByTradeNo(txid);
      if (!order && typeof models.getOrderByTxid === 'function') {
        order = models.getOrderByTxid(txid);
      }

      if (order) {
        console.log(`[Bacen Pix Webhook 🎯] Pedido localizado: ${order.merchant_trade_no}. Acionando entrega imediata...`);
        models.updateOrderStatus(order.merchant_trade_no, 'PAID');
        const fulfillRes = await fulfillment.fulfillOrder(order.merchant_trade_no);
        results.push({ txid, tradeNo: order.merchant_trade_no, fulfilled: fulfillRes.success });
      } else {
        console.warn(`[Bacen Pix Webhook ⚠️] Pedido correspondente ao txid ${txid} não localizado no banco.`);
        results.push({ txid, error: 'Pedido não encontrado' });
      }
    }

    return { success: true, processedCount: results.length, results };
  }

  /**
   * Teste de conectividade e validação OAuth2 + mTLS
   */
  async testConnection() {
    const s = this.getSettings();
    const startTime = Date.now();

    try {
      if (!s.baseUrl) {
        throw new Error('A URL Base do PSP BACEN não foi informada.');
      }
      if (!s.clientId || !s.clientSecret) {
        throw new Error('Client ID e Client Secret são obrigatórios para testar a autenticação BACEN.');
      }

      // Força nova obtenção de token
      this.cachedToken = null;
      this.tokenExpiresAt = 0;

      const token = await this.getAccessToken();
      const elapsed = Date.now() - startTime;

      return {
        success: true,
        message: `Conexão OAuth BACEN realizada com sucesso via ${s.presetName}!`,
        latencyMs: elapsed,
        psp: s.psp,
        presetName: s.presetName,
        baseUrl: s.baseUrl,
        hasCert: Boolean(s.cert),
        hasKey: Boolean(s.keyPem),
        isSandbox: s.isSandbox,
        tokenSnippet: token.slice(0, 10) + '...' + token.slice(-6)
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      return {
        success: false,
        message: `Falha na conexão com o PSP BACEN: ${err.message}`,
        latencyMs: elapsed,
        psp: s.psp,
        presetName: s.presetName,
        baseUrl: s.baseUrl
      };
    }
  }
}

module.exports = new BacenPixService();

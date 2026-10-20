const crypto = require('crypto');
const config = require('../config');
const models = require('../db/models');

class BinancePayService {
  constructor() {
    this.apiUrl = config.binance.apiUrl || 'https://bpay.binanceapi.com';
  }

  getCredentials() {
    const apiKey = models.getSetting('BINANCE_API_KEY', config.binance.apiKey);
    const secretKey = models.getSetting('BINANCE_SECRET_KEY', config.binance.secretKey);
    const simulationSetting = models.getSetting('BINANCE_SIMULATION_MODE', null);
    
    // Se a chave não estiver preenchida ou modo simulação explicitamente ligado
    const isSimulated = simulationSetting !== null 
      ? simulationSetting === 'true' 
      : (config.binance.simulationMode || !apiKey || !secretKey);

    return { apiKey, secretKey, isSimulated };
  }

  generateSignature(timestamp, nonce, bodyString, secretKey) {
    const payload = `${timestamp}\n${nonce}\n${bodyString}\n`;
    return crypto.createHmac('sha512', secretKey).update(payload).digest('hex').toUpperCase();
  }

  async createOrder({ merchantTradeNo, amount, currency = 'USDT', goodsName, goodsDetail, productId }) {
    const { apiKey, secretKey, isSimulated } = this.getCredentials();

    if (isSimulated) {
      console.log(`[BinancePay 🟡 SIMULAÇÃO] Criando pedido simulado: ${merchantTradeNo} - Valor: ${amount} ${currency}`);
      const publicUrl = models.getSetting('PUBLIC_URL', config.publicUrl);
      const checkoutUrl = `${publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}`;
      const qrContent = `https://app.binance.com/qr/simulated-${merchantTradeNo}`;
      
      return {
        success: true,
        isSimulated: true,
        data: {
          prepayId: `SIM_${Date.now()}`,
          checkoutUrl,
          qrContent,
          qrcodeLink: qrContent,
          universalUrl: checkoutUrl,
          expireTime: Date.now() + (3600 * 1000)
        }
      };
    }

    // Modo Produção / Binance Pay Oficial
    try {
      const timestamp = Date.now().toString();
      const nonce = crypto.randomBytes(16).toString('hex');
      const publicUrl = models.getSetting('PUBLIC_URL', config.publicUrl);

      const requestBody = {
        env: {
          terminalType: 'WEB'
        },
        merchantTradeNo,
        orderAmount: Number(amount).toFixed(2),
        currency: currency.toUpperCase(),
        goods: {
          goodsType: '02',
          goodsCategory: 'Z000',
          referenceGoodsId: String(productId || '1'),
          goodsName: goodsName.slice(0, 50),
          goodsDetail: (goodsDetail || goodsName).slice(0, 100)
        },
        returnUrl: `${publicUrl}/payment-success`,
        cancelUrl: `${publicUrl}/payment-cancel`,
        webhookUrl: `${publicUrl}/api/binance/webhook`
      };

      const bodyString = JSON.stringify(requestBody);
      const signature = this.generateSignature(timestamp, nonce, bodyString, secretKey);

      const response = await fetch(`${this.apiUrl}/binancepay/openapi/v2/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'BinancePay-Timestamp': timestamp,
          'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': apiKey,
          'BinancePay-Signature': signature
        },
        body: bodyString
      });

      const resData = await response.json();
      if (resData.status === 'SUCCESS' && resData.data) {
        return {
          success: true,
          isSimulated: false,
          data: {
            prepayId: resData.data.prepayId,
            checkoutUrl: resData.data.checkoutUrl || resData.data.universalUrl,
            universalUrl: resData.data.universalUrl,
            qrContent: resData.data.qrContent,
            qrcodeLink: resData.data.qrcodeLink,
            expireTime: resData.data.expireTime
          }
        };
      } else {
        console.error('[BinancePay ❌ Erro ao criar pedido]:', resData);
        return {
          success: false,
          errorMessage: resData.errorMessage || resData.code || 'Erro desconhecido na Binance'
        };
      }
    } catch (err) {
      console.error('[BinancePay ❌ Exceção de rede]:', err.message);
      return {
        success: false,
        errorMessage: err.message
      };
    }
  }

  async queryOrder(merchantTradeNo) {
    const { apiKey, secretKey, isSimulated } = this.getCredentials();

    if (isSimulated) {
      const order = models.getOrderByTradeNo(merchantTradeNo);
      return {
        success: true,
        status: order ? order.status : 'PENDING'
      };
    }

    try {
      const timestamp = Date.now().toString();
      const nonce = crypto.randomBytes(16).toString('hex');
      const bodyString = JSON.stringify({ merchantTradeNo });
      const signature = this.generateSignature(timestamp, nonce, bodyString, secretKey);

      const response = await fetch(`${this.apiUrl}/binancepay/openapi/v2/order/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'BinancePay-Timestamp': timestamp,
          'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': apiKey,
          'BinancePay-Signature': signature
        },
        body: bodyString
      });

      const resData = await response.json();
      if (resData.status === 'SUCCESS' && resData.data) {
        return {
          success: true,
          status: resData.data.status, // "PAID", "INITIAL", "PENDING", "CANCELED", "EXPIRED"
          orderAmount: resData.data.orderAmount,
          currency: resData.data.currency,
          transactionId: resData.data.transactionId
        };
      }
      return { success: false, status: 'UNKNOWN', error: resData.errorMessage };
    } catch (err) {
      console.error('[BinancePay ❌ Erro ao consultar pedido]:', err.message);
      return { success: false, status: 'UNKNOWN', error: err.message };
    }
  }
}

module.exports = new BinancePayService();

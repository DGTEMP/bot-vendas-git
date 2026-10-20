const QRCode = require('qrcode');
const config = require('../config');
const models = require('../db/models');

class PixPaymentService {
  getSettings() {
    const isPixEnabled = models.getSetting('GATEWAY_PIX_ENABLED', 'true') === 'true';
    const isLivepixEnabled = models.getSetting('GATEWAY_LIVEPIX_ENABLED', 'false') === 'true';
    const isBinanceEnabled = models.getSetting('GATEWAY_BINANCE_ENABLED', 'true') === 'true';
    const mpToken = models.getSetting('MERCADO_PAGO_ACCESS_TOKEN', '');
    const livepixUser = models.getSetting('LIVEPIX_USERNAME', '');
    const isSimulated = models.getSetting('PIX_SIMULATION_MODE', 'true') === 'true' || !mpToken;
    const publicUrl = models.getSetting('PUBLIC_URL', config.publicUrl);

    return {
      isPixEnabled,
      isLivepixEnabled,
      isBinanceEnabled,
      mpToken,
      livepixUser,
      isSimulated,
      publicUrl
    };
  }

  // Cria cobrança Pix Dinâmica (Mercado Pago ou Simulado)
  async createPixCharge({ merchantTradeNo, amount, goodsName, payerName, payerEmail }) {
    const { mpToken, isSimulated, publicUrl } = this.getSettings();

    // MODO SIMULADO / TESTE
    if (isSimulated) {
      console.log(`[Pix 🟢 SIMULAÇÃO] Gerando Pix simulado para ${merchantTradeNo} - R$ ${amount}`);
      
      // Gera um código Copia e Cola válido no formato padrão EMV BR Code
      const safeAmount = Number(amount).toFixed(2);
      const mockPixCode = `00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540${safeAmount}5802BR5913PAYBOT VENDAS6009SAO PAULO62070503${merchantTradeNo.slice(-3)}6304ABCD`;
      const qrBuffer = await QRCode.toBuffer(mockPixCode, { width: 360, margin: 2 });
      const checkoutUrl = `${publicUrl}/simulated-pay?tradeNo=${merchantTradeNo}`;

      return {
        success: true,
        isSimulated: true,
        data: {
          paymentId: `SIM_PIX_${Date.now()}`,
          pixCode: mockPixCode,
          qrBuffer,
          checkoutUrl
        }
      };
    }

    // MODO PRODUÇÃO (MERCADO PAGO API)
    try {
      const cleanEmail = payerEmail && payerEmail.includes('@') ? payerEmail : `cliente_${merchantTradeNo.slice(-6)}@paybot.com`;
      const cleanName = payerName || 'Cliente';

      const response = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mpToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': merchantTradeNo
        },
        body: JSON.stringify({
          transaction_amount: Number(amount),
          description: goodsName.slice(0, 60),
          payment_method_id: 'pix',
          payer: {
            email: cleanEmail,
            first_name: cleanName.split(' ')[0]
          },
          notification_url: `${publicUrl}/api/mercadopago/webhook`,
          external_reference: merchantTradeNo
        })
      });

      const resData = await response.json();

      if (resData.id && resData.point_of_interaction?.transaction_data) {
        const txData = resData.point_of_interaction.transaction_data;
        const pixCode = txData.qr_code;
        const qrBuffer = await QRCode.toBuffer(pixCode, { width: 360, margin: 2 });

        return {
          success: true,
          isSimulated: false,
          data: {
            paymentId: String(resData.id),
            pixCode: pixCode,
            qrBuffer,
            ticketUrl: txData.ticket_url,
            checkoutUrl: txData.ticket_url
          }
        };
      } else {
        console.error('[Pix Mercado Pago ❌ Erro ao criar pagamento]:', resData);
        return {
          success: false,
          errorMessage: resData.message || resData.cause?.[0]?.description || 'Erro ao gerar Pix no Mercado Pago'
        };
      }
    } catch (err) {
      console.error('[Pix Mercado Pago ❌ Exceção]:', err.message);
      return {
        success: false,
        errorMessage: err.message
      };
    }
  }

  // Consulta status de pagamento no Mercado Pago
  async queryPixPayment(paymentId) {
    const { mpToken, isSimulated } = this.getSettings();

    if (isSimulated || !mpToken || String(paymentId).startsWith('SIM_')) {
      return { success: true, status: 'PENDING' };
    }

    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${mpToken}`
        }
      });
      const data = await response.json();

      if (data.status === 'approved') {
        return { success: true, status: 'PAID', externalReference: data.external_reference };
      }
      return { success: true, status: data.status || 'PENDING' };
    } catch (err) {
      console.error('[Pix Mercado Pago ❌ Erro ao consultar pagamento]:', err.message);
      return { success: false, status: 'UNKNOWN' };
    }
  }
}

module.exports = new PixPaymentService();

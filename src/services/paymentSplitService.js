const db = require('../db/database');
const models = require('../db/models');

/**
 * =========================================================================
 * 💸 PAYMENT SPLIT SERVICE • MOTOR DE TAKE-RATE & REVENUE SHARE SAAS
 * =========================================================================
 * Garante que o PROPRIETÁRIO DO SAAS receba automaticamente uma fatia (ex: 2% a 5%)
 * de CADA venda que QUALQUER cliente/inquilino fizer através do bot.
 * 
 * Recursos:
 * - Cálculo dinâmico de taxa por plano (Starter 4.5%, Pro 2.5%, Enterprise 1.2%)
 * - Registro transparente no Ledger financeiro (`platform_fee_ledger`)
 * - Suporte a repasse instantâneo e conciliação de faturas
 * - Métricas de GMV (Gross Merchandise Volume) e receita passiva de taxas
 * =========================================================================
 */

class PaymentSplitService {
  constructor() {
    this.defaultTakeRatePercent = 3.5;
  }

  /**
   * Verifica se o split de pagamentos está ativo globalmente
   */
  isSplitEnabled() {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'PLATFORM_TAKE_RATE_ENABLED' LIMIT 1").get();
      return row ? row.value === 'true' : true;
    } catch (_) {
      return true;
    }
  }

  /**
   * Obtém a chave Pix da plataforma para onde as taxas devem ser direcionadas
   */
  getPlatformPixKey() {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'PLATFORM_SPLIT_PIX_KEY' LIMIT 1").get();
      if (row && row.value && row.value.trim()) return row.value.trim();
    } catch (_) {}
    return process.env.PLATFORM_SPLIT_PIX_KEY || process.env.PIX_KEY || 'financeiro@saasvendas.com.br';
  }

  /**
   * Obtém a taxa de take-rate aplicável com base no plano do inquilino
   */
  getTakeRatePercent(tenantId = null) {
    if (tenantId) {
      const tenant = models.getTenantById(tenantId);
      if (tenant && tenant.plan) {
        switch (tenant.plan.toLowerCase()) {
          case 'starter': return 4.5;
          case 'pro': return 2.5;
          case 'enterprise': return 1.2;
          case 'agency_whitelabel': return 0.5;
        }
      }
    }

    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'PLATFORM_DEFAULT_TAKE_RATE' LIMIT 1").get();
      if (row && row.value) return Number(row.value) || this.defaultTakeRatePercent;
    } catch (_) {}

    return this.defaultTakeRatePercent;
  }

  /**
   * Calcula a divisão matemática do pedido (Gross Amount, Fee da Plataforma, Líquido do Lojista)
   */
  calculateSplit({ grossAmount, tenantId = null, customRate = null }) {
    const gross = Number(grossAmount) || 0;
    const rate = customRate !== null ? Number(customRate) : this.getTakeRatePercent(tenantId);
    
    // Calcula a comissão da plataforma
    const platformFee = Number(((gross * rate) / 100).toFixed(2));
    const merchantNet = Number((gross - platformFee).toFixed(2));

    return {
      gross_amount: gross,
      take_rate_percent: rate,
      platform_fee_amount: platformFee,
      merchant_net_amount: merchantNet,
      platform_pix_key: this.getPlatformPixKey()
    };
  }

  /**
   * Registra a retenção/split da venda no Ledger Financeiro
   */
  recordOrderSplit({ orderId, merchantTradeNo, tenantId, grossAmount, customRate = null, splitMode = 'AUTOMATIC' }) {
    if (!this.isSplitEnabled()) return null;

    const split = this.calculateSplit({ grossAmount, tenantId, customRate });

    try {
      const res = db.prepare(`
        INSERT INTO platform_fee_ledger (
          order_id, merchant_trade_no, tenant_id, gross_amount,
          take_rate_percent, platform_fee_amount, merchant_net_amount,
          split_mode, status, platform_pix_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COLLECTED', ?)
      `).run(
        orderId, merchantTradeNo, tenantId || null, split.gross_amount,
        split.take_rate_percent, split.platform_fee_amount, split.merchant_net_amount,
        splitMode, split.platform_pix_key
      );

      return {
        id: res.lastInsertRowid,
        ...split
      };
    } catch (err) {
      console.warn('[PaymentSplit ⚠️ recordOrderSplit]:', err.message);
      return split;
    }
  }

  /**
   * Retorna as métricas financeiras consolidadas de Take-Rate para o Dono do SaaS
   */
  getSplitFinancialStats() {
    try {
      const row = db.prepare(`
        SELECT 
          COUNT(*) as total_split_transactions,
          COALESCE(SUM(gross_amount), 0) as total_gmv,
          COALESCE(SUM(platform_fee_amount), 0) as total_platform_revenue,
          COALESCE(SUM(merchant_net_amount), 0) as total_merchant_payout
        FROM platform_fee_ledger
      `).get() || { total_split_transactions: 0, total_gmv: 0, total_platform_revenue: 0, total_merchant_payout: 0 };

      // Taxas dos últimos 30 dias
      const recentRow = db.prepare(`
        SELECT COALESCE(SUM(platform_fee_amount), 0) as month_platform_revenue
        FROM platform_fee_ledger
        WHERE created_at >= datetime('now', '-30 days')
      `).get() || { month_platform_revenue: 0 };

      const gmv = Number(row.total_gmv);
      const feeRevenue = Number(row.total_platform_revenue);
      const avgRate = gmv > 0 ? Number(((feeRevenue / gmv) * 100).toFixed(2)) : this.defaultTakeRatePercent;

      return {
        total_transactions: Number(row.total_split_transactions),
        total_gmv_brl: Number(gmv.toFixed(2)),
        total_platform_revenue_brl: Number(feeRevenue.toFixed(2)),
        month_platform_revenue_brl: Number(recentRow.month_platform_revenue.toFixed(2)),
        total_merchant_payout_brl: Number(Number(row.total_merchant_payout).toFixed(2)),
        average_take_rate_percent: avgRate,
        is_split_active: this.isSplitEnabled()
      };
    } catch (err) {
      console.warn('[PaymentSplit ⚠️ getSplitFinancialStats]:', err.message);
      return {
        total_transactions: 0,
        total_gmv_brl: 0.0,
        total_platform_revenue_brl: 0.0,
        month_platform_revenue_brl: 0.0,
        total_merchant_payout_brl: 0.0,
        average_take_rate_percent: this.defaultTakeRatePercent,
        is_split_active: true
      };
    }
  }

  /**
   * Lista o histórico recente do Ledger de Taxas
   */
  listLedgerRecords(limit = 50) {
    try {
      return db.prepare(`
        SELECT l.*, t.name as tenant_name, t.plan as tenant_plan
        FROM platform_fee_ledger l
        LEFT JOIN saas_tenants t ON l.tenant_id = t.id
        ORDER BY l.id DESC
        LIMIT ?
      `).all(Math.max(1, limit));
    } catch (err) {
      console.warn('[PaymentSplit ⚠️ listLedgerRecords]:', err.message);
      return [];
    }
  }
}

module.exports = new PaymentSplitService();

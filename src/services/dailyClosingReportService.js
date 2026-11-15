/**
 * =========================================================================
 * 📊 DAILY CLOSING REPORT SERVICE (FECHAMENTO DE CAIXA DIÁRIO)
 * =========================================================================
 * Gera e envia automaticamente às 23:00 (Horário de Brasília GMT-3)
 * um relatório executivo financeiro e operacional consolidado via
 * WhatsApp e Telegram para o Dono / Administrador.
 *
 * Métricas:
 * - Faturamento total em BRL e USDT
 * - Segregação por gateways (PIX, Mercado Pago, Binance Pay, Cripto Auto-Custódia)
 * - Volume de pedidos pagos, pendentes e taxa de conversão
 * - Comissões de afiliados geradas
 * - Novos leads capturados no CRM Cognitivo
 * - Top produtos mais vendidos no dia
 * =========================================================================
 */

const models = require('../db/models');
const db = require('../db/database');
const { getBrasiliaHour } = require('../utils/dateTime');

class DailyClosingReportService {
  constructor() {
    this._interval = null;
    this._checkIntervalMs = 60 * 1000; // Checa a cada 1 minuto
  }

  /**
   * Retorna a string da data atual no padrão YYYY-MM-DD em Brasília (GMT-3).
   */
  getBrasiliaTodayStr() {
    const d = new Date();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  }

  /**
   * Gera o relatório consolidado para um dia específico (ou hoje).
   * @param {string} [targetDateStr] - Formato YYYY-MM-DD
   */
  generateDailyReport(targetDateStr = null) {
    const dateStr = targetDateStr || this.getBrasiliaTodayStr();

    // 1. Pedidos do dia
    const orders = db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.created_at LIKE ?
    `).all(`${dateStr}%`);

    let totalBRL = 0;
    let totalUSDT = 0;
    let paidOrdersCount = 0;
    let pendingOrdersCount = 0;
    let cancelledOrdersCount = 0;

    const gatewayBreakdown = {
      pix: { brl: 0, count: 0, name: 'PIX (Bacen / Mercado Pago)' },
      livepix: { brl: 0, count: 0, name: 'LivePix' },
      binancepay: { usdt: 0, brl: 0, count: 0, name: 'Binance Pay' },
      crypto: { usdt: 0, brl: 0, count: 0, name: 'Carteira Cripto (Auto-Custódia)' },
      whatsapp: { brl: 0, count: 0, name: 'Atendimento WhatsApp' }
    };

    const productSalesMap = {};

    for (const ord of orders) {
      const isPaid = ord.status === 'PAID';
      const isPending = ord.status === 'PENDING';
      const isCancelled = ['CANCELLED', 'EXPIRED'].includes(ord.status);

      if (isPaid) {
        paidOrdersCount++;
        const amt = Number(ord.amount || 0);
        if (ord.currency === 'BRL') {
          totalBRL += amt;
        } else {
          totalUSDT += amt;
        }

        const gwKey = (ord.gateway || 'pix').toLowerCase();
        if (gatewayBreakdown[gwKey]) {
          if (ord.currency === 'BRL') {
            gatewayBreakdown[gwKey].brl += amt;
          } else {
            gatewayBreakdown[gwKey].usdt += amt;
          }
          gatewayBreakdown[gwKey].count++;
        }

        const pName = ord.product_name || 'Produto da Loja';
        productSalesMap[pName] = (productSalesMap[pName] || 0) + 1;
      } else if (isPending) {
        pendingOrdersCount++;
      } else if (isCancelled) {
        cancelledOrdersCount++;
      }
    }

    // 2. Comissões de Afiliados do dia
    const commStats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN currency = 'BRL' THEN amount ELSE 0 END), 0) as comm_brl,
        COALESCE(SUM(CASE WHEN currency = 'USDT' THEN amount ELSE 0 END), 0) as comm_usdt,
        COUNT(id) as comm_count
      FROM commissions
      WHERE created_at LIKE ? AND status = 'PAID'
    `).get(`${dateStr}%`);

    // 3. Novos Leads no CRM do dia
    const leadsStats = db.prepare(`
      SELECT COUNT(phone) as new_leads
      FROM lead_cognitive_profiles
      WHERE created_at LIKE ? OR updated_at LIKE ?
    `).get(`${dateStr}%`, `${dateStr}%`);

    // Top produtos
    const topProducts = Object.entries(productSalesMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const ticketMedioBRL = paidOrdersCount > 0 ? (totalBRL / paidOrdersCount) : 0;

    return {
      date: dateStr,
      totalOrders: orders.length,
      paidOrdersCount,
      pendingOrdersCount,
      cancelledOrdersCount,
      totalBRL: Number(totalBRL.toFixed(2)),
      totalUSDT: Number(totalUSDT.toFixed(2)),
      ticketMedioBRL: Number(ticketMedioBRL.toFixed(2)),
      gatewayBreakdown,
      commissions: {
        totalBRL: Number((commStats?.comm_brl || 0).toFixed(2)),
        totalUSDT: Number((commStats?.comm_usdt || 0).toFixed(2)),
        count: commStats?.comm_count || 0
      },
      newLeads: leadsStats?.new_leads || 0,
      topProducts
    };
  }

  /**
   * Formata mensagem executiva estilizada para envio via WhatsApp ou Telegram.
   */
  formatReportMessage(report) {
    const [year, month, day] = report.date.split('-');
    const formattedDate = `${day}/${month}/${year}`;

    let msg = `📊 *FECHAMENTO DIÁRIO DE CAIXA* 📊\n`;
    msg += `📅 *Data:* ${formattedDate} (GMT-3 Brasília)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💰 *FATURAMENTO CONSOLIDADO:*\n`;
    msg += `• *BRL:* R$ ${report.totalBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`;
    if (report.totalUSDT > 0) {
      msg += `• *Cripto / USDT:* $ ${report.totalUSDT.toFixed(2)} USDT\n`;
    }
    msg += `• *Ticket Médio:* R$ ${report.ticketMedioBRL.toFixed(2)}\n\n`;

    msg += `🏦 *POR GATEWAY / FORMA DE PAGAMENTO:*\n`;
    for (const [key, g] of Object.entries(report.gatewayBreakdown)) {
      if (g.count > 0 || g.brl > 0 || g.usdt > 0) {
        const valStr = g.usdt ? `$ ${g.usdt.toFixed(2)} USDT` : `R$ ${g.brl.toFixed(2)}`;
        msg += `• ${g.name}: *${valStr}* (${g.count} pedidos)\n`;
      }
    }
    msg += `\n`;

    msg += `📦 *OPERAÇÃO & CONVERSÃO:*\n`;
    msg += `• ✅ Pedidos Concluídos: *${report.paidOrdersCount}*\n`;
    msg += `• ⏳ Pedidos Pendentes: *${report.pendingOrdersCount}*\n`;
    if (report.cancelledOrdersCount > 0) {
      msg += `• ❌ Pedidos Cancelados: *${report.cancelledOrdersCount}*\n`;
    }
    msg += `• 👥 Novos Leads no CRM: *${report.newLeads}*\n`;
    if (report.commissions.count > 0) {
      msg += `• 🤝 Comissões de Afiliados: *R$ ${report.commissions.totalBRL.toFixed(2)}* (${report.commissions.count})\n`;
    }
    msg += `\n`;

    if (report.topProducts && report.topProducts.length > 0) {
      msg += `🏆 *TOP PRODUTOS MAIS VENDIDOS:*\n`;
      report.topProducts.forEach((p, idx) => {
        const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '•'));
        msg += `${medal} ${p.name}: *${p.count} venda(s)*\n`;
      });
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🔒 _Relatório gerado e auditado automaticamente pelo sistema PayBot._`;

    return msg;
  }

  /**
   * Dispara o fechamento diário para os canais de notificação administrativa.
   */
  async sendDailyClosingReport(targetDateStr = null) {
    const report = this.generateDailyReport(targetDateStr);
    const message = this.formatReportMessage(report);

    const adminWpp = models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '');
    const adminTg = models.getSetting('ADMIN_NOTIFY_TELEGRAM_ID', '');

    let sentWpp = false;
    let sentTg = false;

    // Envio WhatsApp
    if (adminWpp) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        const cleanPhone = adminWpp.replace(/\D/g, '');
        if (cleanPhone) {
          const jid = `${cleanPhone}@s.whatsapp.net`;
          if (whatsappBot.sock) {
            await whatsappBot.sock.sendMessage(jid, { text: message });
            sentWpp = true;
          }
        }
      } catch (wErr) {
        console.warn('[DailyReport ⚠️] Falha ao enviar via WhatsApp:', wErr.message);
      }
    }

    // Envio Telegram
    if (adminTg) {
      try {
        const telegramBot = require('../bots/telegramBot');
        if (telegramBot.bot) {
          await telegramBot.bot.telegram.sendMessage(adminTg, message, { parse_mode: 'Markdown' });
          sentTg = true;
        }
      } catch (tErr) {
        console.warn('[DailyReport ⚠️] Falha ao enviar via Telegram:', tErr.message);
      }
    }

    // Marca no banco que o relatório do dia foi enviado
    models.setSetting('LAST_DAILY_REPORT_SENT_DATE', report.date);
    console.log(`[DailyReport ✅] Fechamento diário concluído para ${report.date} (WPP: ${sentWpp}, TG: ${sentTg})`);

    return {
      success: true,
      report,
      sentWhatsApp: sentWpp,
      sentTelegram: sentTg
    };
  }

  /**
   * Inicia o monitor de fechamento diário que dispara automaticamente às 23:00 Brasília.
   */
  start() {
    if (this._interval) return;

    this._interval = setInterval(async () => {
      try {
        const targetHour = parseInt(models.getSetting('DAILY_CLOSING_REPORT_HOUR', '23'), 10);
        const currentHour = getBrasiliaHour();
        const todayStr = this.getBrasiliaTodayStr();
        const lastSentDate = models.getSetting('LAST_DAILY_REPORT_SENT_DATE', '');

        // Dispara se for a hora alvo e ainda não tiver sido enviado hoje
        if (currentHour === targetHour && lastSentDate !== todayStr) {
          console.log(`[DailyReport 🕒] Horário de Brasília (${currentHour}h) atingido. Disparando fechamento de caixa...`);
          await this.sendDailyClosingReport(todayStr);
        }
      } catch (err) {
        console.error('[DailyReport Poller Error]:', err.message);
      }
    }, this._checkIntervalMs);

    this._interval.unref?.();
    console.log('✅ [DailyReport] Serviço de Fechamento Diário de Caixa iniciado (agendado para às 23h Brasília)');
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}

module.exports = new DailyClosingReportService();

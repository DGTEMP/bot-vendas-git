// PayBot Admin Dashboard Script

let currentProducts = [];
let qrPollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  loadAllData();

  // Polling regular para métricas e status a cada 8s
  setInterval(() => {
    loadMetrics();
    loadWhatsAppStatus();
  }, 8000);
});

// 1. NAVEGAÇÃO DE ABAS
function initNav() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = item.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  const targetLink = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  const targetPane = document.getElementById(`tab-${tabName}`);

  if (targetLink && targetPane) {
    targetLink.classList.add('active');
    targetPane.classList.add('active');
    document.getElementById('pageTitle').innerText = targetLink.innerText.trim();
  }

  if (tabName === 'connections') {
    startQrPolling();
  } else {
    stopQrPolling();
  }

  if (tabName === 'products') loadProducts();
  if (tabName === 'orders') loadOrders();
  if (tabName === 'subscriptions') loadSubscriptions();
  if (tabName === 'keys') loadProductsForKeys();
  if (tabName === 'settings') loadSettings();
}

// 2. CARREGAMENTO GERAL
async function loadAllData() {
  await Promise.all([
    loadMetrics(),
    loadWhatsAppStatus(),
    loadProducts(),
    loadOrders(),
    loadSubscriptions(),
    loadSettings()
  ]);
}

// 3. MÉTRICAS
async function loadMetrics() {
  try {
    const res = await fetch('/api/metrics');
    const data = await res.json();

    document.getElementById('statRevenueBRL').innerText = `R$ ${data.totalRevenueBRL.toFixed(2)}`;
    document.getElementById('statRevenueUSDT').innerText = `${data.totalRevenueUSDT.toFixed(2)} USDT`;
    document.getElementById('statPaidOrders').innerText = data.paidOrders;
    document.getElementById('statActiveSubs').innerText = data.activeSubs;

    const wppBadge = document.getElementById('overviewWppStatus');
    if (data.whatsapp?.connected) {
      wppBadge.className = 'badge badge-paid';
      wppBadge.innerText = 'Online';
    } else {
      wppBadge.className = 'badge badge-pending';
      wppBadge.innerText = 'Aguardando QR';
    }

    const tgBadge = document.getElementById('overviewTgStatus');
    if (data.telegram?.connected) {
      tgBadge.className = 'badge badge-paid';
      tgBadge.innerText = 'Online';
    } else {
      tgBadge.className = 'badge badge-pending';
      tgBadge.innerText = 'Sem Token';
    }
  } catch (err) {
    console.error('Erro ao carregar métricas:', err);
  }
}

// 4. WHATSAPP QR CODE POLLING
function startQrPolling() {
  loadWhatsAppStatus();
  if (!qrPollingInterval) {
    qrPollingInterval = setInterval(loadWhatsAppStatus, 3000);
  }
}

function stopQrPolling() {
  if (qrPollingInterval) {
    clearInterval(qrPollingInterval);
    qrPollingInterval = null;
  }
}

async function loadWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();

    const wppBadge = document.getElementById('wppBadge');
    const wppText = document.getElementById('wppStatusText');
    const qrBox = document.getElementById('wppQrContainer');

    if (data.connected) {
      wppBadge.className = 'badge badge-paid';
      wppBadge.innerText = 'Conectado';
      wppText.innerText = 'Seu WhatsApp está autenticado e pronto para vender!';
      qrBox.innerHTML = `
        <i class="fa-solid fa-circle-check" style="font-size: 64px; color: var(--color-green); margin-bottom: 12px;"></i>
        <h4 style="color: #12161f;">WhatsApp Conectado</h4>
        <span style="font-size: 12px; color: #64748b;">Recebendo mensagens normalmente</span>
      `;
    } else if (data.qrDataUrl) {
      wppBadge.className = 'badge badge-pending';
      wppBadge.innerText = 'Aguardando Leitura';
      wppText.innerText = 'Aponte a câmera do seu WhatsApp para o QR Code abaixo:';
      qrBox.innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code WhatsApp" />`;
    } else {
      wppBadge.className = 'badge badge-canceled';
      wppBadge.innerText = 'Desconectado';
      wppText.innerText = data.statusMessage || 'Inicializando serviço Baileys...';
      qrBox.innerHTML = `
        <div class="spinner"></div>
        <span>Gerando QR Code...</span>
      `;
    }
  } catch (err) {
    console.error('Erro no status do WhatsApp:', err);
  }
}

// 5. PRODUTOS & PLANOS
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    currentProducts = await res.json();

    const tbody = document.querySelector('#tableProducts tbody');
    if (currentProducts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhum produto cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = currentProducts.map(p => {
      let typeLabel = '';
      let infoExtra = '-';

      if (p.type === 'digital_link') {
        typeLabel = '<span class="badge" style="background:#3b82f620; color:#3b82f6">Link / Arquivo</span>';
        infoExtra = p.content ? `<a href="${p.content}" target="_blank" style="color:var(--primary-gold)">Ver link</a>` : '-';
      } else if (p.type === 'license_key') {
        typeLabel = '<span class="badge" style="background:#a855f720; color:#a855f7">Chave de Licença</span>';
        infoExtra = `<b>${p.availableStock || 0}</b> disponíveis`;
      } else if (p.type === 'vip_subscription') {
        typeLabel = '<span class="badge" style="background:#f0b90b20; color:#f0b90b">Assinatura VIP</span>';
        infoExtra = `${p.duration_days} dias de acesso`;
      }

      const statusBadge = p.active 
        ? '<span class="badge badge-paid">Ativo</span>' 
        : '<span class="badge badge-canceled">Inativo</span>';

      const brl = Number(p.price_brl || p.price).toFixed(2);
      const usdt = Number(p.price_usdt || (p.price / 5.5)).toFixed(2);

      return `
        <tr>
          <td>#${p.id}</td>
          <td><b>${p.name}</b><br><small style="color:var(--text-muted)">${p.description || ''}</small></td>
          <td>${typeLabel}</td>
          <td><b style="color:var(--color-pix)">R$ ${brl}</b></td>
          <td><b style="color:var(--primary-gold)">${usdt} USDT</b></td>
          <td>${infoExtra}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
  }
}

function openProductModal() {
  document.getElementById('formProduct').reset();
  document.getElementById('prodId').value = '';
  document.getElementById('modalProductTitle').innerText = 'Novo Produto / Assinatura';
  toggleProductTypeFields();
  document.getElementById('modalProduct').classList.add('active');
}

function closeProductModal() {
  document.getElementById('modalProduct').classList.remove('active');
}

function toggleProductTypeFields() {
  const type = document.getElementById('prodType').value;
  const fieldContent = document.getElementById('fieldContent');
  const fieldSub = document.getElementById('fieldSubscription');

  if (type === 'digital_link') {
    fieldContent.style.display = 'block';
    fieldSub.style.display = 'none';
  } else if (type === 'vip_subscription') {
    fieldContent.style.display = 'none';
    fieldSub.style.display = 'flex';
  } else {
    fieldContent.style.display = 'none';
    fieldSub.style.display = 'none';
  }
}

async function saveProduct(e) {
  e.preventDefault();
  const name = document.getElementById('prodName').value;
  const description = document.getElementById('prodDesc').value;
  const price_brl = parseFloat(document.getElementById('prodPriceBRL').value);
  const price_usdt = parseFloat(document.getElementById('prodPriceUSDT').value);
  const type = document.getElementById('prodType').value;
  const content = document.getElementById('prodContent').value;
  const duration_days = parseInt(document.getElementById('prodDuration').value, 10) || 0;
  const telegram_channel_id = document.getElementById('prodChannelId').value;

  const payload = {
    name,
    description,
    price: price_brl,
    price_brl,
    price_usdt,
    currency: 'BRL',
    type,
    content,
    duration_days,
    telegram_channel_id
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeProductModal();
      loadProducts();
      loadMetrics();
    }
  } catch (err) {
    alert('Erro ao salvar produto: ' + err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('Deseja realmente remover este produto?')) return;
  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    loadProducts();
    loadMetrics();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

// 6. ESTOQUE DE CHAVES
async function loadProductsForKeys() {
  try {
    const res = await fetch('/api/products');
    const prods = await res.json();
    const keyProds = prods.filter(p => p.type === 'license_key');

    const select = document.getElementById('selectKeyProduct');
    if (keyProds.length === 0) {
      select.innerHTML = '<option value="">Nenhum produto do tipo Chave de Licença cadastrado</option>';
      return;
    }

    select.innerHTML = keyProds.map(p => `<option value="${p.id}">${p.name} (#${p.id})</option>`).join('');
    loadProductKeys();
  } catch (err) {
    console.error('Erro ao carregar lista de chaves:', err);
  }
}

async function loadProductKeys() {
  const select = document.getElementById('selectKeyProduct');
  const productId = select.value;
  if (!productId) return;

  try {
    const res = await fetch(`/api/keys/${productId}`);
    const data = await res.json();

    document.getElementById('keyStockCount').innerText = `${data.availableCount} chaves disponíveis`;

    const tbody = document.querySelector('#tableKeys tbody');
    if (data.keys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">Nenhuma chave cadastrada neste produto.</td></tr>';
      return;
    }

    tbody.innerHTML = data.keys.map(k => `
      <tr>
        <td>#${k.id}</td>
        <td><code>${k.key_content}</code></td>
        <td>${k.is_used ? '<span class="badge badge-expired">Usada / Entregue</span>' : '<span class="badge badge-paid">Disponível</span>'}</td>
        <td>${k.used_by_order_id ? `#${k.used_by_order_id}` : '-'}</td>
        <td>${new Date(k.created_at).toLocaleString('pt-BR')}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar chaves:', err);
  }
}

async function submitKeys() {
  const select = document.getElementById('selectKeyProduct');
  const productId = select.value;
  const textarea = document.getElementById('txtNewKeys');
  const text = textarea.value.trim();

  if (!productId || !text) {
    return alert('Selecione um produto e insira pelo menos 1 chave.');
  }

  try {
    const res = await fetch(`/api/keys/${productId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keysText: text })
    });
    const data = await res.json();
    alert(`Sucesso! ${data.addedCount} chaves foram adicionadas ao estoque.`);
    textarea.value = '';
    loadProductKeys();
    loadProducts();
  } catch (err) {
    alert('Erro ao inserir chaves: ' + err.message);
  }
}

// 7. PEDIDOS / VENDAS
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();

    renderOrdersTable('tableOrders', orders);
    renderOrdersTable('tableOverviewOrders', orders.slice(0, 5));
  } catch (err) {
    console.error('Erro ao carregar pedidos:', err);
  }
}

function renderOrdersTable(tableId, list) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhum pedido registrado ainda.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(o => {
    let statusBadge = '<span class="badge badge-pending">Pendente</span>';
    if (o.status === 'PAID') statusBadge = '<span class="badge badge-paid">Pago & Entregue</span>';
    if (o.status === 'CANCELED') statusBadge = '<span class="badge badge-canceled">Cancelado</span>';
    if (o.status === 'EXPIRED') statusBadge = '<span class="badge badge-expired">Expirado</span>';

    let gatewayBadge = '<span class="badge badge-crypto">⚡ Binance</span>';
    if (o.gateway === 'mercadopago' || o.currency === 'BRL') {
      gatewayBadge = '<span class="badge badge-pix">🟢 PIX</span>';
    } else if (o.gateway === 'livepix') {
      gatewayBadge = '<span class="badge badge-livepix">💜 LivePix</span>';
    }

    const platformIcon = o.platform === 'whatsapp' 
      ? '<i class="fa-brands fa-whatsapp wpp-color"></i> WhatsApp' 
      : '<i class="fa-brands fa-telegram tg-color"></i> Telegram';

    const dateStr = new Date(o.created_at).toLocaleString('pt-BR');
    const valorStr = o.currency === 'BRL' ? `R$ ${o.amount.toFixed(2)}` : `${o.amount.toFixed(2)} USDT`;

    const actionBtn = o.status === 'PENDING'
      ? `<button class="btn btn-sm btn-primary" onclick="simulatePayment('${o.merchant_trade_no}')"><i class="fa-solid fa-check"></i> Simular Pago</button>`
      : `<span style="font-size:12px; color:var(--text-muted)">Concluído</span>`;

    return `
      <tr>
        <td><code>${o.merchant_trade_no}</code></td>
        <td>${gatewayBadge}</td>
        <td>${platformIcon}</td>
        <td>${o.platform_user_name || o.platform_user_id}</td>
        <td><b>${o.product_name}</b></td>
        <td><b>${valorStr}</b></td>
        <td>${statusBadge}</td>
        <td><small>${dateStr}</small></td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

async function simulatePayment(tradeNo) {
  try {
    const res = await fetch(`/api/orders/simulate-pay/${tradeNo}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`🎉 Pagamento confirmado para o pedido ${tradeNo}! A entrega foi realizada.`);
      loadOrders();
      loadMetrics();
      loadSubscriptions();
    } else {
      alert('Erro: ' + (data.error || 'Falha ao processar'));
    }
  } catch (err) {
    alert('Erro de rede: ' + err.message);
  }
}

// 8. ASSINATURAS VIP
async function loadSubscriptions() {
  try {
    const res = await fetch('/api/subscriptions');
    const subs = await res.json();

    const tbody = document.querySelector('#tableSubs tbody');
    if (subs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhuma assinatura ativa no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = subs.map(s => {
      const start = new Date(s.start_date).toLocaleDateString('pt-BR');
      const end = new Date(s.end_date).toLocaleDateString('pt-BR');

      const platformIcon = s.platform === 'whatsapp' 
        ? '<i class="fa-brands fa-whatsapp wpp-color"></i> WhatsApp' 
        : '<i class="fa-brands fa-telegram tg-color"></i> Telegram';

      return `
        <tr>
          <td>#${s.id}</td>
          <td><b>${s.platform_user_name || s.platform_user_id}</b></td>
          <td>${s.product_name}</td>
          <td>${platformIcon}</td>
          <td>${start}</td>
          <td><b>${end}</b></td>
          <td><span class="badge badge-active">Ativa</span></td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="revokeSubscription(${s.id})">
              <i class="fa-solid fa-ban"></i> Revogar
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar assinaturas:', err);
  }
}

async function revokeSubscription(id) {
  if (!confirm('Deseja realmente revogar esta assinatura? O usuário será removido do grupo VIP no Telegram.')) return;
  try {
    await fetch(`/api/subscriptions/${id}/revoke`, { method: 'POST' });
    loadSubscriptions();
    loadMetrics();
  } catch (err) {
    alert('Erro ao revogar assinatura: ' + err.message);
  }
}

// 9. CONFIGURAÇÕES
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const cfg = await res.json();

    // Toggles de Gateways
    document.getElementById('cfgGatewayPix').checked = cfg.GATEWAY_PIX_ENABLED;
    document.getElementById('cfgGatewayBinance').checked = cfg.GATEWAY_BINANCE_ENABLED;
    document.getElementById('cfgGatewayLivepix').checked = cfg.GATEWAY_LIVEPIX_ENABLED;

    // Badges no topo
    updateGatewayBadges(cfg);

    // Modo simulação
    document.getElementById('cfgSimulationMode').checked = cfg.BINANCE_SIMULATION_MODE === 'true' || cfg.PIX_SIMULATION_MODE === 'true';

    // Mercado Pago
    document.getElementById('cfgMercadoPagoToken').value = cfg.MERCADO_PAGO_ACCESS_TOKEN || '';

    // LivePix
    document.getElementById('cfgLivepixUsername').value = cfg.LIVEPIX_USERNAME || '';

    // Binance Pay
    document.getElementById('cfgBinanceApiKey').value = cfg.BINANCE_API_KEY || '';
    document.getElementById('cfgBinanceSecretKey').value = cfg.BINANCE_SECRET_KEY || '';

    // Telegram
    document.getElementById('cfgTelegramToken').value = cfg.TELEGRAM_BOT_TOKEN || '';
    document.getElementById('cfgTelegramChannelId').value = cfg.TELEGRAM_VIP_CHANNEL_ID || '';

    // URL Pública & Webhooks
    document.getElementById('cfgPublicUrl').value = cfg.PUBLIC_URL || '';
    if (cfg.webhooks) {
      document.getElementById('whMercadopago').innerText = cfg.webhooks.mercadopago;
      document.getElementById('whBinance').innerText = cfg.webhooks.binance;
      document.getElementById('whLivepix').innerText = cfg.webhooks.livepix;
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

function updateGatewayBadges(cfg) {
  const bPix = document.getElementById('badgePixStatus');
  const bBinance = document.getElementById('badgeBinanceStatus');
  const bLivepix = document.getElementById('badgeLivepixStatus');

  if (cfg.GATEWAY_PIX_ENABLED) {
    bPix.className = 'badge badge-pix';
    bPix.innerText = '🟢 PIX Ativo';
  } else {
    bPix.className = 'badge badge-expired';
    bPix.innerText = '⚪ PIX Inativo';
  }

  if (cfg.GATEWAY_BINANCE_ENABLED) {
    bBinance.className = 'badge badge-crypto';
    bBinance.innerText = '🟡 Binance Pay Ativo';
  } else {
    bBinance.className = 'badge badge-expired';
    bBinance.innerText = '⚪ Binance Pay Inativo';
  }

  if (cfg.GATEWAY_LIVEPIX_ENABLED) {
    bLivepix.className = 'badge badge-livepix';
    bLivepix.innerText = '💜 LivePix Ativo';
  } else {
    bLivepix.className = 'badge badge-expired';
    bLivepix.innerText = '⚪ LivePix Inativo';
  }
}

async function saveSettings(e) {
  e.preventDefault();

  const isSim = document.getElementById('cfgSimulationMode').checked;

  const payload = {
    GATEWAY_PIX_ENABLED: document.getElementById('cfgGatewayPix').checked,
    GATEWAY_BINANCE_ENABLED: document.getElementById('cfgGatewayBinance').checked,
    GATEWAY_LIVEPIX_ENABLED: document.getElementById('cfgGatewayLivepix').checked,
    PIX_SIMULATION_MODE: isSim,
    BINANCE_SIMULATION_MODE: isSim,
    MERCADO_PAGO_ACCESS_TOKEN: document.getElementById('cfgMercadoPagoToken').value,
    LIVEPIX_USERNAME: document.getElementById('cfgLivepixUsername').value,
    BINANCE_API_KEY: document.getElementById('cfgBinanceApiKey').value,
    BINANCE_SECRET_KEY: document.getElementById('cfgBinanceSecretKey').value,
    TELEGRAM_BOT_TOKEN: document.getElementById('cfgTelegramToken').value,
    TELEGRAM_VIP_CHANNEL_ID: document.getElementById('cfgTelegramChannelId').value,
    PUBLIC_URL: document.getElementById('cfgPublicUrl').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    const msg = document.getElementById('saveSettingsMsg');
    msg.innerText = '✅ Configurações salvas com sucesso!';
    setTimeout(() => { msg.innerText = ''; }, 3500);
    loadSettings();
    loadMetrics();
  } catch (err) {
    alert('Erro ao salvar configurações: ' + err.message);
  }
}

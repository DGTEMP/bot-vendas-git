// PayBot Admin Master Dashboard Script

let currentProducts = [];
let qrPollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  loadAllData();

  // Polling regular a cada 8s
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
  if (tabName === 'sellers') loadSellers();
  if (tabName === 'affiliates') loadAffiliates();
  if (tabName === 'commissions') loadCommissions();
  if (tabName === 'channel') loadChannelTab();
  if (tabName === 'coupons') loadCoupons();
}

// 2. CARREGAMENTO GERAL
async function loadAllData() {
  await Promise.all([
    loadMetrics(),
    loadWhatsAppStatus(),
    loadProducts(),
    loadOrders(),
    loadSubscriptions(),
    loadSettings(),
    loadSellers(),
    loadAffiliates(),
    loadCommissions(),
    loadOffers(),
    loadCoupons()
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
    if (document.getElementById('statTotalSellers')) {
      document.getElementById('statTotalSellers').innerText = data.totalSellers || 0;
    }
    if (document.getElementById('statTotalAffiliates')) {
      document.getElementById('statTotalAffiliates').innerText = data.totalAffiliates || 0;
    }
    if (document.getElementById('statRecoveredCount')) {
      document.getElementById('statRecoveredCount').innerText = data.recoveredOrdersCount || 0;
    }
    if (document.getElementById('statRecoveredAmount')) {
      document.getElementById('statRecoveredAmount').innerText = `R$ ${(data.recoveredRevenueBRL || 0).toFixed(2)}`;
    }
    if (document.getElementById('statUpsellCount')) {
      document.getElementById('statUpsellCount').innerText = data.upsellOrdersCount || 0;
    }
    if (document.getElementById('statTotalCoupons')) {
      document.getElementById('statTotalCoupons').innerText = data.totalCoupons || 0;
    }

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

// ==========================================
// 5. TIMES DE VENDEDORES (SELLERS)
// ==========================================
async function loadSellers() {
  try {
    const res = await fetch('/api/sellers');
    const sellers = await res.json();

    const tbody = document.querySelector('#tableSellers tbody');
    if (!tbody) return;

    if (sellers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhum vendedor cadastrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = sellers.map(s => `
      <tr>
        <td>#${s.id}</td>
        <td><b>${s.name}</b><br><small style="color:var(--text-muted)">${s.email || ''}</small></td>
        <td>${s.phone || '-'}</td>
        <td>${s.telegram_username ? '@' + s.telegram_username.replace('@', '') : '-'}</td>
        <td><span class="badge" style="background:#3b82f620; color:#3b82f6">${s.commission_rate}%</span></td>
        <td><b>${s.total_sales_count}</b></td>
        <td>R$ ${(s.total_revenue_brl || 0).toFixed(2)} | ${(s.total_revenue_usdt || 0).toFixed(2)} USDT</td>
        <td>${s.active ? '<span class="badge badge-paid">Ativo</span>' : '<span class="badge badge-canceled">Inativo</span>'}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteSeller(${s.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar vendedores:', err);
  }
}

function openSellerModal() {
  document.getElementById('formSeller').reset();
  document.getElementById('sellerId').value = '';
  document.getElementById('modalSeller').classList.add('active');
}

function closeSellerModal() {
  document.getElementById('modalSeller').classList.remove('active');
}

async function saveSeller(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('sellerName').value,
    phone: document.getElementById('sellerPhone').value,
    email: document.getElementById('sellerEmail').value,
    telegram_username: document.getElementById('sellerTgUser').value,
    telegram_id: document.getElementById('sellerTgId').value,
    commission_rate: parseFloat(document.getElementById('sellerCommission').value) || 0
  };

  try {
    const res = await fetch('/api/sellers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeSellerModal();
      loadSellers();
      loadMetrics();
    }
  } catch (err) {
    alert('Erro ao salvar vendedor: ' + err.message);
  }
}

async function deleteSeller(id) {
  if (!confirm('Deseja realmente excluir este vendedor?')) return;
  try {
    await fetch(`/api/sellers/${id}`, { method: 'DELETE' });
    loadSellers();
    loadMetrics();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

// ==========================================
// 6. SISTEMA DE AFILIADOS (AFFILIATES)
// ==========================================
async function loadAffiliates() {
  try {
    const res = await fetch('/api/affiliates');
    const affiliates = await res.json();

    const tbody = document.querySelector('#tableAffiliates tbody');
    if (!tbody) return;

    if (affiliates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhum afiliado cadastrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = affiliates.map(a => `
      <tr>
        <td>#${a.id}</td>
        <td><b>${a.name}</b><br><small style="color:var(--text-muted)">${a.telegram_username || a.phone || ''}</small></td>
        <td><code style="background:var(--bg-main); padding:3px 8px; border-radius:4px; color:var(--primary-gold); font-weight:bold;">${a.ref_code}</code></td>
        <td><span class="badge" style="background:#a855f720; color:#a855f7">${a.commission_rate}%</span></td>
        <td><b style="color:var(--color-green)">R$ ${(a.balance_brl || 0).toFixed(2)}</b><br><small style="color:var(--primary-gold)">${(a.balance_usdt || 0).toFixed(2)} USDT</small></td>
        <td><small>${a.pix_key || '-'}</small></td>
        <td><small>${a.usdt_wallet ? a.usdt_wallet.slice(0, 10) + '...' : '-'}</small></td>
        <td>${a.active ? '<span class="badge badge-paid">Ativo</span>' : '<span class="badge badge-canceled">Inativo</span>'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm btn-primary" onclick="viewAffiliateLinks(${a.id})">
            <i class="fa-solid fa-link"></i> Links
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteAffiliate(${a.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar afiliados:', err);
  }
}

function openAffiliateModal() {
  document.getElementById('formAffiliate').reset();
  document.getElementById('affiliateId').value = '';
  document.getElementById('modalAffiliate').classList.add('active');
}

function closeAffiliateModal() {
  document.getElementById('modalAffiliate').classList.remove('active');
}

async function saveAffiliate(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('afilName').value,
    ref_code: document.getElementById('afilRefCode').value,
    commission_rate: parseFloat(document.getElementById('afilCommission').value) || 20.0,
    phone: document.getElementById('afilPhone').value,
    pix_key: document.getElementById('afilPixKey').value,
    usdt_wallet: document.getElementById('afilUsdtWallet').value,
    telegram_username: document.getElementById('afilTgUser').value,
    telegram_id: document.getElementById('afilTgId').value
  };

  try {
    const res = await fetch('/api/affiliates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      closeAffiliateModal();
      loadAffiliates();
      loadMetrics();
    } else {
      alert('Erro: ' + (data.error || 'Falha ao salvar afiliado'));
    }
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
}

async function deleteAffiliate(id) {
  if (!confirm('Deseja realmente remover este afiliado?')) return;
  try {
    await fetch(`/api/affiliates/${id}`, { method: 'DELETE' });
    loadAffiliates();
    loadMetrics();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function viewAffiliateLinks(id) {
  try {
    const res = await fetch(`/api/affiliates/${id}/links`);
    const data = await res.json();
    if (data.links) {
      document.getElementById('modalLinksTitle').innerText = `Links de Divulgação: ${data.affiliate.name} (#${data.affiliate.ref_code})`;
      document.getElementById('linkTgAfil').value = data.links.telegram;
      document.getElementById('linkWppAfil').value = data.links.whatsapp;
      document.getElementById('modalAffiliateLinks').classList.add('active');
    }
  } catch (err) {
    alert('Erro ao gerar links: ' + err.message);
  }
}

function closeLinksModal() {
  document.getElementById('modalAffiliateLinks').classList.remove('active');
}

function copyInput(inputId) {
  const input = document.getElementById(inputId);
  input.select();
  navigator.clipboard.writeText(input.value);
  alert('Link copiado para a área de transferência!');
}

// ==========================================
// 7. COMISSÕES & REPASSES (COMMISSIONS)
// ==========================================
async function loadCommissions() {
  try {
    const res = await fetch('/api/commissions');
    const commissions = await res.json();

    const tbody = document.querySelector('#tableCommissions tbody');
    if (!tbody) return;

    if (commissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhuma comissão registrada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = commissions.map(c => {
      const typeBadge = c.beneficiary_type === 'affiliate'
        ? '<span class="badge" style="background:#a855f720; color:#a855f7">Afiliado</span>'
        : '<span class="badge" style="background:#3b82f620; color:#3b82f6">Vendedor</span>';

      const statusBadge = c.status === 'PAID'
        ? '<span class="badge badge-paid">Pago</span>'
        : '<span class="badge badge-pending">Pendente</span>';

      const actionBtn = c.status === 'PENDING'
        ? `<button class="btn btn-sm btn-primary" onclick="openPayCommissionModal(${c.id}, '${c.beneficiary_name}', '${c.amount.toFixed(2)} ${c.currency}', '${c.payment_destination || 'Não cadastrado'}')"><i class="fa-solid fa-check"></i> Marcar Pago</button>`
        : `<small style="color:var(--text-muted)">Quitado</small>`;

      return `
        <tr>
          <td>#${c.id}</td>
          <td><code>${c.merchant_trade_no}</code></td>
          <td><b>${c.beneficiary_name || 'Desconhecido'}</b></td>
          <td>${typeBadge}</td>
          <td>${c.product_name}</td>
          <td><b style="color:var(--color-green)">${c.amount.toFixed(2)} ${c.currency}</b> <small>(${c.rate_percent}%)</small></td>
          <td><code>${c.payment_destination || '-'}</code></td>
          <td>${statusBadge}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar comissões:', err);
  }
}

function openPayCommissionModal(id, name, amountStr, dest) {
  document.getElementById('payCommId').value = id;
  document.getElementById('payCommBeneficiary').value = name;
  document.getElementById('payCommAmount').value = amountStr;
  document.getElementById('payCommDestination').value = dest;
  document.getElementById('payCommProof').value = '';
  document.getElementById('modalPayCommission').classList.add('active');
}

function closePayCommissionModal() {
  document.getElementById('modalPayCommission').classList.remove('active');
}

async function submitPayCommission(e) {
  e.preventDefault();
  const id = document.getElementById('payCommId').value;
  const proofNote = document.getElementById('payCommProof').value;

  try {
    const res = await fetch(`/api/commissions/${id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proofNote })
    });
    if (res.ok) {
      closePayCommissionModal();
      loadCommissions();
      loadAffiliates();
      loadMetrics();
      alert('Repasse confirmado e debitado com sucesso!');
    }
  } catch (err) {
    alert('Erro ao confirmar repasse: ' + err.message);
  }
}

// ==========================================
// 8. CANAL DE ATUALIZAÇÕES & OFERTAS (CHANNEL & OFFERS)
// ==========================================
async function loadChannelTab() {
  await Promise.all([
    loadOffers(),
    loadSettings(),
    populateOfferProductsDropdown()
  ]);
}

async function populateOfferProductsDropdown() {
  const select = document.getElementById('offerProductSelect');
  if (!select) return;
  try {
    let prods = currentProducts;
    if (!prods || prods.length === 0) {
      const res = await fetch('/api/products');
      prods = await res.json();
      currentProducts = prods;
    }

    let html = '<option value="">Nenhum (Link Geral do Bot)</option>';
    prods.forEach(p => {
      const brl = Number(p.price_brl || p.price).toFixed(2);
      const usdt = Number(p.price_usdt || 0).toFixed(2);
      html += `<option value="${p.id}">${p.name} - R$ ${brl} / ${usdt} USDT</option>`;
    });
    select.innerHTML = html;
  } catch (err) {
    console.error('Erro ao popular lista de produtos para oferta:', err);
  }
}

async function loadOffers() {
  try {
    const res = await fetch('/api/offers');
    const offers = await res.json();

    const tbody = document.querySelector('#tableOffers tbody');
    if (!tbody) return;

    if (!offers || offers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">Nenhuma oferta publicada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = offers.map(o => {
      const date = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '-';
      const prodName = o.product_name ? `<b>${o.product_name}</b>` : '<span style="color:var(--text-muted)">Geral (Bot)</span>';
      return `
        <tr>
          <td>#${o.id}</td>
          <td><b>${o.title}</b><br><small style="color:var(--text-muted)">${(o.content || '').substring(0, 65)}...</small></td>
          <td>${prodName}</td>
          <td><span class="badge" style="background:#f59e0b20; color:#f59e0b">${o.cta_text || 'Comprar'}</span></td>
          <td><small>${date}</small></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar ofertas:', err);
  }
}

async function submitBroadcastOffer(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando...';

  const payload = {
    title: document.getElementById('offerTitle').value.trim(),
    content: document.getElementById('offerContent').value.trim(),
    product_id: document.getElementById('offerProductSelect').value ? parseInt(document.getElementById('offerProductSelect').value, 10) : null,
    cta_text: document.getElementById('offerCtaText').value.trim(),
    cta_url: document.getElementById('offerCtaUrl').value.trim() || null,
    image_url: document.getElementById('offerImageUrl').value.trim() || null
  };

  const statusMsg = document.getElementById('offerStatusMsg');

  try {
    const res = await fetch('/api/offers/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      statusMsg.style.color = 'var(--color-green)';
      statusMsg.innerText = '✅ Oferta disparada e registrada com sucesso no Canal!';
      document.getElementById('formBroadcastOffer').reset();
      loadOffers();
    } else {
      statusMsg.style.color = '#ef4444';
      statusMsg.innerText = '⚠️ Erro: ' + (result.error || 'Não foi possível publicar a oferta.');
    }
  } catch (err) {
    statusMsg.style.color = '#ef4444';
    statusMsg.innerText = '⚠️ Erro de rede: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    setTimeout(() => { if (statusMsg) statusMsg.innerText = ''; }, 6000);
  }
}

// ==========================================
// 9. PRODUTOS & PLANOS
// ==========================================
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    currentProducts = await res.json();
    populateOfferProductsDropdown();

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

function populateProductUpsellDropdown(excludeId = null) {
  const select = document.getElementById('prodUpsellId');
  if (!select) return;
  let html = '<option value="">Nenhum (Desativado)</option>';
  if (currentProducts && currentProducts.length > 0) {
    currentProducts.forEach(p => {
      if (excludeId && p.id === excludeId) return;
      html += `<option value="${p.id}">${p.name} (R$ ${Number(p.price_brl || p.price).toFixed(2)})</option>`;
    });
  }
  select.innerHTML = html;
}

function openProductModal() {
  document.getElementById('formProduct').reset();
  document.getElementById('prodId').value = '';
  document.getElementById('modalProductTitle').innerText = 'Novo Produto / Assinatura';
  populateProductUpsellDropdown();
  document.getElementById('prodUpsellDiscount').value = '20';
  document.getElementById('prodUpsellHeadline').value = '';
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
  const upsell_product_id = document.getElementById('prodUpsellId').value ? parseInt(document.getElementById('prodUpsellId').value, 10) : null;
  const upsell_discount_percent = parseFloat(document.getElementById('prodUpsellDiscount').value) || 0;
  const upsell_headline = document.getElementById('prodUpsellHeadline').value.trim();

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
    telegram_channel_id,
    upsell_product_id,
    upsell_discount_percent,
    upsell_headline
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

// ==========================================
// 9. ESTOQUE DE CHAVES
// ==========================================
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
    console.error('Erro ao carregar chaves do produto:', err);
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

// ==========================================
// 10. PEDIDOS / VENDAS
// ==========================================
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
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">Nenhum pedido registrado ainda.</td></tr>';
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

    const afilStr = o.affiliate_name ? `<span style="color:var(--color-purple); font-weight:600;">${o.affiliate_name}</span>` : '-';
    const sellerStr = o.seller_name ? `<span style="color:var(--color-blue); font-weight:600;">${o.seller_name}</span>` : '-';

    const actionBtn = o.status === 'PENDING'
      ? `<button class="btn btn-sm btn-primary" onclick="simulatePayment('${o.merchant_trade_no}')"><i class="fa-solid fa-check"></i> Simular Pago</button>`
      : `<span style="font-size:12px; color:var(--text-muted)">Concluído</span>`;

    if (tableId === 'tableOverviewOrders') {
      return `
        <tr>
          <td><code>${o.merchant_trade_no}</code></td>
          <td>${gatewayBadge}</td>
          <td>${platformIcon}</td>
          <td><b>${o.product_name}</b></td>
          <td>${afilStr} / ${sellerStr}</td>
          <td><b>${valorStr}</b></td>
          <td>${statusBadge}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }

    return `
      <tr>
        <td><code>${o.merchant_trade_no}</code></td>
        <td>${gatewayBadge}</td>
        <td>${platformIcon}</td>
        <td>${o.platform_user_name || o.platform_user_id}</td>
        <td><b>${o.product_name}</b></td>
        <td>${afilStr}</td>
        <td>${sellerStr}</td>
        <td><b>${valorStr}</b></td>
        <td>${statusBadge}</td>
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
      alert(`🎉 Pagamento confirmado para o pedido ${tradeNo}! A entrega e as comissões foram creditadas.`);
      loadOrders();
      loadMetrics();
      loadSubscriptions();
      loadAffiliates();
      loadCommissions();
    } else {
      alert('Erro: ' + (data.error || 'Falha ao processar'));
    }
  } catch (err) {
    alert('Erro de rede: ' + err.message);
  }
}

// ==========================================
// 11. ASSINATURAS VIP
// ==========================================
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

// ==========================================
// 12. CENTRAL DE CONFIGURAÇÕES GERAIS
// ==========================================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const cfg = await res.json();

    // Toggles de Gateways
    document.getElementById('cfgGatewayPix').checked = cfg.GATEWAY_PIX_ENABLED;
    document.getElementById('cfgGatewayBinance').checked = cfg.GATEWAY_BINANCE_ENABLED;
    document.getElementById('cfgGatewayLivepix').checked = cfg.GATEWAY_LIVEPIX_ENABLED;
    updateGatewayBadges(cfg);

    // Modo simulação
    document.getElementById('cfgSimulationMode').checked = cfg.BINANCE_SIMULATION_MODE === 'true' || cfg.PIX_SIMULATION_MODE === 'true';

    // Regras de Vendedores & Afiliados
    document.getElementById('cfgGlobalAffiliateRate').value = cfg.GLOBAL_AFFILIATE_RATE || 20.0;
    document.getElementById('cfgRoundRobinSellers').checked = cfg.ROUND_ROBIN_SELLERS;
    document.getElementById('cfgNotifyAdminOnSale').checked = cfg.NOTIFY_ADMIN_ON_SALE;
    document.getElementById('cfgAdminNotifyTelegram').value = cfg.ADMIN_NOTIFY_TELEGRAM_ID || '';
    document.getElementById('cfgAdminNotifyWhatsapp').value = cfg.ADMIN_NOTIFY_WHATSAPP_PHONE || '';

    // Textos do Bot
    document.getElementById('cfgBotName').value = cfg.BOT_NAME || 'PayBot Vendas';
    document.getElementById('cfgSupportContact').value = cfg.SUPPORT_CONTACT || '@suporte';
    document.getElementById('cfgWelcomeMessage').value = cfg.WELCOME_MESSAGE || '';

    // Gateways Keys
    document.getElementById('cfgMercadoPagoToken').value = cfg.MERCADO_PAGO_ACCESS_TOKEN || '';
    document.getElementById('cfgLivepixUsername').value = cfg.LIVEPIX_USERNAME || '';
    document.getElementById('cfgBinanceApiKey').value = cfg.BINANCE_API_KEY || '';
    document.getElementById('cfgBinanceSecretKey').value = cfg.BINANCE_SECRET_KEY || '';

    // Telegram
    document.getElementById('cfgTelegramToken').value = cfg.TELEGRAM_BOT_TOKEN || '';
    document.getElementById('cfgTelegramChannelId').value = cfg.TELEGRAM_VIP_CHANNEL_ID || '';
    document.getElementById('cfgTelegramBotUsername').value = cfg.TELEGRAM_BOT_USERNAME || '';

    // Canal de Atualizações & Prova Social
    const updatesChannelId = cfg.TELEGRAM_UPDATES_CHANNEL_ID || '';
    if (document.getElementById('cfgTelegramUpdatesChannelId')) {
      document.getElementById('cfgTelegramUpdatesChannelId').value = updatesChannelId;
    }
    if (document.getElementById('cfgAutoPostTransactions')) {
      document.getElementById('cfgAutoPostTransactions').checked = cfg.AUTO_POST_TRANSACTIONS !== false;
    }
    if (document.getElementById('cfgMaskCustomerName')) {
      document.getElementById('cfgMaskCustomerName').checked = cfg.MASK_CUSTOMER_NAME !== false;
    }

    // Recuperação de Carrinho & Upsell
    if (document.getElementById('cfgAbandonedCartEnabled')) {
      document.getElementById('cfgAbandonedCartEnabled').checked = cfg.ABANDONED_CART_ENABLED !== false;
    }
    if (document.getElementById('cfgAbandonedCartDelayMin')) {
      document.getElementById('cfgAbandonedCartDelayMin').value = cfg.ABANDONED_CART_DELAY_MIN || 15;
    }
    if (document.getElementById('cfgAbandonedCartMessage')) {
      document.getElementById('cfgAbandonedCartMessage').value = cfg.ABANDONED_CART_MESSAGE || '';
    }
    if (document.getElementById('cfgUpsellEnabled')) {
      document.getElementById('cfgUpsellEnabled').checked = cfg.UPSELL_ENABLED !== false;
    }

    // Atualiza status do canal na aba de Atualizações
    const lblStatus = document.getElementById('lblChannelConfigStatus');
    const lblId = document.getElementById('lblChannelIdText');
    if (lblStatus && lblId) {
      if (updatesChannelId) {
        lblStatus.style.color = 'var(--color-green)';
        lblStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Canal Configurado & Ativo';
        lblId.innerHTML = `Canal de destino: <code>${updatesChannelId}</code> (Postagem automática: <b>${cfg.AUTO_POST_TRANSACTIONS !== false ? 'Ligada' : 'Desligada'}</b>)`;
      } else {
        lblStatus.style.color = 'var(--primary-gold)';
        lblStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Canal Não Configurado';
        lblId.innerHTML = 'Nenhum canal configurado. Preencha o campo <b>ID / @User do Canal</b> em Configurações.';
      }
    }

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

    GLOBAL_AFFILIATE_RATE: parseFloat(document.getElementById('cfgGlobalAffiliateRate').value) || 20.0,
    ROUND_ROBIN_SELLERS: document.getElementById('cfgRoundRobinSellers').checked,
    NOTIFY_ADMIN_ON_SALE: document.getElementById('cfgNotifyAdminOnSale').checked,
    ADMIN_NOTIFY_TELEGRAM_ID: document.getElementById('cfgAdminNotifyTelegram').value,
    ADMIN_NOTIFY_WHATSAPP_PHONE: document.getElementById('cfgAdminNotifyWhatsapp').value,

    BOT_NAME: document.getElementById('cfgBotName').value,
    WELCOME_MESSAGE: document.getElementById('cfgWelcomeMessage').value,
    SUPPORT_CONTACT: document.getElementById('cfgSupportContact').value,

    MERCADO_PAGO_ACCESS_TOKEN: document.getElementById('cfgMercadoPagoToken').value,
    LIVEPIX_USERNAME: document.getElementById('cfgLivepixUsername').value,
    BINANCE_API_KEY: document.getElementById('cfgBinanceApiKey').value,
    BINANCE_SECRET_KEY: document.getElementById('cfgBinanceSecretKey').value,
    TELEGRAM_BOT_TOKEN: document.getElementById('cfgTelegramToken').value,
    TELEGRAM_VIP_CHANNEL_ID: document.getElementById('cfgTelegramChannelId').value,
    TELEGRAM_BOT_USERNAME: document.getElementById('cfgTelegramBotUsername').value,
    TELEGRAM_UPDATES_CHANNEL_ID: document.getElementById('cfgTelegramUpdatesChannelId')?.value?.trim() || '',
    AUTO_POST_TRANSACTIONS: document.getElementById('cfgAutoPostTransactions')?.checked ?? true,
    MASK_CUSTOMER_NAME: document.getElementById('cfgMaskCustomerName')?.checked ?? true,
    ABANDONED_CART_ENABLED: document.getElementById('cfgAbandonedCartEnabled')?.checked ?? true,
    ABANDONED_CART_DELAY_MIN: parseInt(document.getElementById('cfgAbandonedCartDelayMin')?.value, 10) || 15,
    ABANDONED_CART_MESSAGE: document.getElementById('cfgAbandonedCartMessage')?.value || '',
    UPSELL_ENABLED: document.getElementById('cfgUpsellEnabled')?.checked ?? true,
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
    msg.innerText = '✅ Todas as configurações foram salvas com sucesso!';
    setTimeout(() => { msg.innerText = ''; }, 3500);
    loadSettings();
    loadMetrics();
  } catch (err) {
    alert('Erro ao salvar configurações: ' + err.message);
  }
}

// ==========================================
// 13. CUPONS DE DESCONTO
// ==========================================
async function loadCoupons() {
  try {
    const res = await fetch('/api/coupons');
    const coupons = await res.json();

    const tbody = document.querySelector('#tableCoupons tbody');
    if (!tbody) return;

    if (!coupons || coupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhum cupom cadastrado ainda.</td></tr>';
      return;
    }

    // Obter username do bot para gerar deep link
    const tgUsername = document.getElementById('cfgTelegramBotUsername')?.value || '';

    tbody.innerHTML = coupons.map(c => {
      const discountStr = c.discount_percent 
        ? `<b style="color:var(--color-green)">${c.discount_percent}% OFF</b>` 
        : `<b style="color:var(--color-green)">R$ ${Number(c.discount_amount).toFixed(2)} OFF</b>`;
      
      const usesStr = c.max_uses > 0 
        ? `${c.used_count} / ${c.max_uses}` 
        : `${c.used_count} / ∞`;

      const expStr = c.expires_at ? new Date(c.expires_at).toLocaleDateString('pt-BR') : 'Sem expiração';

      const statusBadge = c.active 
        ? '<span class="badge badge-paid">Ativo</span>' 
        : '<span class="badge badge-canceled">Inativo</span>';

      const tgLink = tgUsername 
        ? `https://t.me/${tgUsername}?start=cupom_${c.code}` 
        : `?start=cupom_${c.code}`;

      return `
        <tr>
          <td><code style="font-size:14px; font-weight:bold; color:var(--primary-gold);">${c.code}</code></td>
          <td>${discountStr}</td>
          <td>${usesStr}</td>
          <td><small>${expStr}</small></td>
          <td>${statusBadge}</td>
          <td>
            <a href="${tgLink}" target="_blank" style="color:var(--primary-gold); font-size:12px; text-decoration:none;">
              <i class="fa-brands fa-telegram"></i> <code>cupom_${c.code}</code>
            </a>
          </td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteCoupon(${c.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar cupons:', err);
  }
}

function openCouponModal() {
  document.getElementById('formCoupon').reset();
  document.getElementById('couponDiscountPercent').value = '10';
  document.getElementById('couponDiscountAmount').value = '';
  document.getElementById('couponMaxUses').value = '0';
  document.getElementById('couponExpiresAt').value = '';
  toggleCouponTypeFields();
  document.getElementById('modalCoupon').classList.add('active');
}

function closeCouponModal() {
  document.getElementById('modalCoupon').classList.remove('active');
}

function toggleCouponTypeFields() {
  const type = document.getElementById('couponType').value;
  const grpPercent = document.getElementById('groupCouponPercent');
  const grpAmount = document.getElementById('groupCouponAmount');

  if (type === 'percent') {
    grpPercent.style.display = 'block';
    grpAmount.style.display = 'none';
  } else {
    grpPercent.style.display = 'none';
    grpAmount.style.display = 'block';
  }
}

async function saveCoupon(e) {
  e.preventDefault();
  const code = document.getElementById('couponCode').value.trim().toUpperCase();
  const type = document.getElementById('couponType').value;
  const discount_percent = type === 'percent' ? parseFloat(document.getElementById('couponDiscountPercent').value) || 0 : null;
  const discount_amount = type === 'fixed' ? parseFloat(document.getElementById('couponDiscountAmount').value) || 0 : null;
  const max_uses = parseInt(document.getElementById('couponMaxUses').value, 10) || 0;
  const expires_at = document.getElementById('couponExpiresAt').value || null;

  try {
    const res = await fetch('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, discount_percent, discount_amount, max_uses, expires_at })
    });
    const data = await res.json();
    if (res.ok) {
      closeCouponModal();
      loadCoupons();
      loadMetrics();
    } else {
      alert('Erro ao salvar cupom: ' + (data.error || 'Falha ao salvar'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function deleteCoupon(id) {
  if (!confirm('Deseja realmente desativar/remover este cupom?')) return;
  try {
    await fetch(`/api/coupons/${id}`, { method: 'DELETE' });
    loadCoupons();
    loadMetrics();
  } catch (err) {
    alert('Erro ao excluir cupom: ' + err.message);
  }
}

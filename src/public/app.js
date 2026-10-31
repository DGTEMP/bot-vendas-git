// PayBot Admin Master Dashboard Script

let currentProducts = [];
let currentCompanies = [];
let currentAffiliates = [];
let currentSellers = [];
let currentArmyInstances = [];
let currentArmyLinks = [];
let currentArmyCampaigns = [];
let qrPollingInterval = null;
let armyQrPollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  loadAllData();

  // Polling regular a cada 8s
  setInterval(() => {
    loadMetrics();
    loadWhatsAppStatus();
    loadFunnelStats();
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

  if (tabName === 'companies') loadCompanies();
  if (tabName === 'sellers') loadSellers();
  if (tabName === 'affiliates') loadAffiliates();
  if (tabName === 'affiliations') loadAffiliationQueue();
  if (tabName === 'products') loadProducts();
  if (tabName === 'orders') loadOrders();
  if (tabName === 'subscriptions') loadSubscriptions();
  if (tabName === 'keys') loadProductsForKeys();
  if (tabName === 'settings') loadSettings();
  if (tabName === 'commissions') loadCommissions();
  if (tabName === 'channel') loadChannelTab();
  if (tabName === 'coupons') loadCoupons();
  if (tabName === 'army') loadArmyData();
}

// 2. CARREGAMENTO GERAL
async function loadAllData() {
  await Promise.all([
    loadMetrics(),
    loadWhatsAppStatus(),
    loadCompanies(),
    loadProducts(),
    loadOrders(),
    loadSubscriptions(),
    loadSettings(),
    loadSellers(),
    loadAffiliates(),
    loadAffiliationQueue(),
    loadCommissions(),
    loadOffers(),
    loadCoupons(),
    loadArmyData()
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
    if (document.getElementById('statTotalCompanies')) {
      document.getElementById('statTotalCompanies').innerText = data.totalCompanies || 0;
    }
    if (document.getElementById('statPendingAffiliations')) {
      document.getElementById('statPendingAffiliations').innerText = data.pendingAffiliationsCount || 0;
    }
    const badgePending = document.getElementById('badgePendingAffiliations');
    if (badgePending) {
      if (data.pendingAffiliationsCount > 0) {
        badgePending.style.display = 'inline-block';
        badgePending.innerText = data.pendingAffiliationsCount;
      } else {
        badgePending.style.display = 'none';
      }
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
// 5. TIMES DE VENDEDORES & PRODUTOS PERMITIDOS (SELLERS)
// ==========================================
async function loadSellers() {
  try {
    const res = await fetch('/api/sellers');
    const sellers = await res.json();
    currentSellers = sellers;

    const tbody = document.querySelector('#tableSellers tbody');
    if (!tbody) return;

    if (sellers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center">Nenhum vendedor cadastrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = sellers.map(s => {
      let prodsBadge = '';
      if (s.assigned_products && s.assigned_products.length > 0) {
        const prodNames = s.assigned_products.map(p => p.name).join(', ');
        prodsBadge = `<span class="badge" style="background:#f0b90b20; color:#f0b90b; cursor:pointer;" title="${prodNames}"><i class="fa-solid fa-boxes-stacked"></i> ${s.assigned_products.length} selecionado(s)</span>`;
      } else {
        prodsBadge = '<span class="badge badge-paid"><i class="fa-solid fa-globe"></i> Todos os produtos</span>';
      }

      return `
        <tr>
          <td>#${s.id}</td>
          <td><b>${s.name}</b><br><small style="color:var(--text-muted)">${s.email || ''}</small></td>
          <td>${s.phone || '-'}</td>
          <td>${s.telegram_username ? '@' + s.telegram_username.replace('@', '') : '-'}</td>
          <td>${prodsBadge}</td>
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
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar vendedores:', err);
  }
}

function renderSellerProductsChecklist(selectedIds = []) {
  const container = document.getElementById('sellerProductsChecklist');
  if (!container) return;

  if (!currentProducts || currentProducts.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">Nenhum produto cadastrado no catálogo ainda.</span>';
    return;
  }

  container.innerHTML = currentProducts.map(p => {
    const isChecked = selectedIds.includes(p.id) ? 'checked' : '';
    const company = p.company_name ? `• ${p.company_name}` : '';
    const cat = p.category ? `[${p.category}]` : '';
    return `
      <label class="checkbox-label" style="font-size:12px; margin-bottom:4px; cursor:pointer;">
        <input type="checkbox" name="sellerProdCheck" value="${p.id}" ${isChecked}>
        <span><b>${p.name}</b> <small style="color:var(--text-muted);">${cat} ${company} (R$ ${Number(p.price_brl || p.price).toFixed(2)})</small></span>
      </label>
    `;
  }).join('');
}

function openSellerModal(seller = null) {
  document.getElementById('formSeller').reset();
  document.getElementById('sellerId').value = '';
  document.getElementById('modalSellerTitle').innerText = 'Novo Vendedor';
  renderSellerProductsChecklist(seller ? (seller.assigned_product_ids || []) : []);
  document.getElementById('modalSeller').classList.add('active');
}

function closeSellerModal() {
  document.getElementById('modalSeller').classList.remove('active');
}

async function saveSeller(e) {
  e.preventDefault();
  const checkedBoxes = Array.from(document.querySelectorAll('input[name="sellerProdCheck"]:checked'));
  const product_ids = checkedBoxes.map(cb => parseInt(cb.value, 10));

  const payload = {
    name: document.getElementById('sellerName').value,
    phone: document.getElementById('sellerPhone').value,
    email: document.getElementById('sellerEmail').value,
    telegram_username: document.getElementById('sellerTgUser').value,
    telegram_id: document.getElementById('sellerTgId').value,
    commission_rate: parseFloat(document.getElementById('sellerCommission').value) || 0,
    product_ids
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
    currentAffiliates = affiliates;

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
// EMPRESAS & MARCAS (COMPANIES)
// ==========================================
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies');
    const companies = await res.json();
    currentCompanies = companies;
    populateCompaniesDropdown();
    populateCompanyFilters();

    const tbody = document.querySelector('#tableCompanies tbody');
    if (!tbody) return;

    if (!companies || companies.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma empresa cadastrada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = companies.map(c => `
      <tr>
        <td>#${c.id}</td>
        <td><b>${c.name}</b></td>
        <td><code>${c.document || '-'}</code></td>
        <td><small style="color:var(--text-muted)">${c.description || '-'}</small></td>
        <td><span class="badge" style="background:#3b82f620; color:#3b82f6">${c.products_count || 0} produto(s)</span></td>
        <td>${c.active ? '<span class="badge badge-paid">Ativa</span>' : '<span class="badge badge-canceled">Inativa</span>'}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteCompany(${c.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar empresas:', err);
  }
}

function openCompanyModal() {
  document.getElementById('formCompany').reset();
  document.getElementById('companyId').value = '';
  document.getElementById('modalCompanyTitle').innerText = 'Nova Empresa / Marca';
  document.getElementById('modalCompany').classList.add('active');
}

function closeCompanyModal() {
  document.getElementById('modalCompany').classList.remove('active');
}

async function saveCompany(e) {
  e.preventDefault();
  const name = document.getElementById('companyName').value.trim();
  const documentNum = document.getElementById('companyDocument').value.trim();
  const description = document.getElementById('companyDescription').value.trim();

  try {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, document: documentNum, description })
    });
    if (res.ok) {
      closeCompanyModal();
      loadCompanies();
      loadProducts();
      loadMetrics();
    } else {
      const err = await res.json();
      alert('Erro: ' + (err.error || 'Falha ao salvar'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function deleteCompany(id) {
  if (!confirm('Deseja realmente remover esta empresa? Os produtos continuarão no sistema sem empresa vinculada.')) return;
  try {
    await fetch(`/api/companies/${id}`, { method: 'DELETE' });
    loadCompanies();
    loadProducts();
    loadMetrics();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

function populateCompaniesDropdown() {
  const select = document.getElementById('prodCompanyId');
  if (!select) return;

  let html = '<option value="">Nenhuma (Geral)</option>';
  if (currentCompanies && currentCompanies.length > 0) {
    currentCompanies.forEach(c => {
      html += `<option value="${c.id}">${c.name}</option>`;
    });
  }
  select.innerHTML = html;
}

// ==========================================
// FILA DE ESPERA DE AFILIAÇÃO (PRODUCT AFFILIATION QUEUE)
// ==========================================
async function loadAffiliationQueue() {
  try {
    const res = await fetch('/api/affiliations/queue');
    const items = await res.json();

    const tbody = document.querySelector('#tableAffiliationQueue tbody');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhum pedido de afiliação na fila no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(item => {
      const c = item.criteria || {};
      const date = item.requested_at ? new Date(item.requested_at).toLocaleDateString('pt-BR') : '-';

      // Status Badge
      let statusBadge = '';
      if (item.status === 'APPROVED') {
        statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Aprovado</span>';
      } else if (item.status === 'CRITERIA_MET') {
        statusBadge = '<span class="badge" style="background:#3b82f620; color:#3b82f6"><i class="fa-solid fa-star"></i> Critérios Atingidos</span>';
      } else if (item.status === 'REJECTED') {
        statusBadge = '<span class="badge badge-canceled"><i class="fa-solid fa-circle-xmark"></i> Recusado</span>';
      } else {
        statusBadge = '<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Fila de Espera</span>';
      }

      // Progresso dos Critérios
      const salesBadge = c.meets_sales 
        ? `<span class="badge badge-paid" title="Vendas do Afiliado">${c.sales_count} / ${c.min_sales} vendas</span>`
        : `<span class="badge badge-pending" title="Vendas do Afiliado">${c.sales_count || 0} / ${c.min_sales} vendas</span>`;

      const revBadge = c.meets_revenue
        ? `<span class="badge badge-paid" title="Faturamento">R$ ${(c.revenue_brl || 0).toFixed(0)}</span>`
        : `<span class="badge badge-pending" title="Faturamento">R$ ${(c.revenue_brl || 0).toFixed(0)} / R$ ${c.min_revenue}</span>`;

      const walletBadge = c.has_payment_info
        ? `<span class="badge badge-paid" title="PIX/USDT cadastrado">Dados OK</span>`
        : `<span class="badge badge-expired" title="Sem chave PIX ou carteira">Sem PIX/Wallet</span>`;

      let actionButtons = '';
      if (item.status !== 'APPROVED') {
        actionButtons += `
          <button class="btn btn-sm btn-primary" onclick="approveAffiliation(${item.id})" title="Aprovar e Ativar">
            <i class="fa-solid fa-check"></i> Aprovar
          </button>
        `;
      }
      if (item.status !== 'REJECTED') {
        actionButtons += `
          <button class="btn btn-sm btn-outline" onclick="rejectAffiliation(${item.id})" title="Recusar">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;
      }

      const companyStr = item.company_name ? `<b>${item.company_name}</b><br>` : '';
      const catStr = item.category ? `<small style="color:var(--text-muted)">[${item.category}]</small>` : '';

      return `
        <tr>
          <td>#${item.id}</td>
          <td><b>${item.affiliate_name}</b><br><code style="color:var(--primary-gold)">${item.ref_code}</code></td>
          <td><b>${item.product_name}</b><br><small style="color:var(--text-muted)">R$ ${Number(item.price_brl).toFixed(2)}</small></td>
          <td>${companyStr}${catStr}</td>
          <td>
            <div style="display:flex; flex-direction:column; gap:3px;">
              <div>${salesBadge} ${revBadge}</div>
              <div>${walletBadge}</div>
            </div>
          </td>
          <td>${statusBadge}<br><small style="color:var(--text-muted); font-size:10px;">${item.notes || ''}</small></td>
          <td><small>${date}</small></td>
          <td style="white-space:nowrap;">${actionButtons}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar fila de afiliação:', err);
  }
}

function openRequestAffiliationModal() {
  const selAfil = document.getElementById('reqAffiliateSelect');
  const selProd = document.getElementById('reqProductSelect');
  document.getElementById('formRequestAffiliation').reset();

  if (currentAffiliates && currentAffiliates.length > 0) {
    selAfil.innerHTML = currentAffiliates.map(a => `<option value="${a.id}">${a.name} (${a.ref_code})</option>`).join('');
  } else {
    selAfil.innerHTML = '<option value="">Nenhum afiliado cadastrado</option>';
  }

  if (currentProducts && currentProducts.length > 0) {
    selProd.innerHTML = currentProducts.map(p => {
      const comp = p.company_name ? `[${p.company_name}]` : '';
      return `<option value="${p.id}">${p.name} ${comp} - R$ ${Number(p.price_brl || p.price).toFixed(2)}</option>`;
    }).join('');
  } else {
    selProd.innerHTML = '<option value="">Nenhum produto cadastrado</option>';
  }

  document.getElementById('modalRequestAffiliation').classList.add('active');
}

function closeRequestAffiliationModal() {
  document.getElementById('modalRequestAffiliation').classList.remove('active');
}

async function submitRequestAffiliation(e) {
  e.preventDefault();
  const affiliate_id = document.getElementById('reqAffiliateSelect').value;
  const product_id = document.getElementById('reqProductSelect').value;
  const notes = document.getElementById('reqNotes').value.trim();

  try {
    const res = await fetch('/api/affiliations/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ affiliate_id, product_id, notes })
    });
    const data = await res.json();
    if (res.ok) {
      closeRequestAffiliationModal();
      loadAffiliationQueue();
      loadMetrics();
      alert(`Pedido de afiliação cadastrado! Status: ${data.status}`);
    } else {
      alert('Erro: ' + (data.error || 'Falha ao registrar pedido'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function approveAffiliation(id) {
  try {
    const res = await fetch(`/api/affiliations/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Aprovado pelo administrador no painel' })
    });
    if (res.ok) {
      loadAffiliationQueue();
      loadMetrics();
    }
  } catch (err) {
    alert('Erro ao aprovar: ' + err.message);
  }
}

async function rejectAffiliation(id) {
  const reason = prompt('Informe o motivo da recusa (opcional):', 'Critérios mínimos não atingidos no momento');
  if (reason === null) return;
  try {
    const res = await fetch(`/api/affiliations/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (res.ok) {
      loadAffiliationQueue();
      loadMetrics();
    }
  } catch (err) {
    alert('Erro ao recusar: ' + err.message);
  }
}

async function checkAllAffiliationCriteria() {
  try {
    const res = await fetch('/api/affiliations/check-criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    alert(`Critérios reavaliados! ${data.updatedCount || 0} solicitações foram atualizadas.`);
    loadAffiliationQueue();
    loadMetrics();
  } catch (err) {
    alert('Erro ao reavaliar critérios: ' + err.message);
  }
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
    populateCategoryFilters();
    populateCompanyFilters();
    filterProducts();
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
  }
}

function populateCategoryFilters() {
  const select = document.getElementById('filterProdCategory');
  if (!select) return;
  const currentVal = select.value;
  const categories = Array.from(new Set(currentProducts.map(p => p.category || 'Geral'))).sort();
  select.innerHTML = '<option value="">Todas as Categorias</option>' + 
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
  if (currentVal && categories.includes(currentVal)) {
    select.value = currentVal;
  }
}

function populateCompanyFilters() {
  const select = document.getElementById('filterProdCompany');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Todas as Empresas</option><option value="0">Matriz (Sem empresa)</option>' +
    currentCompanies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (currentVal) {
    select.value = currentVal;
  }
}

function filterProducts() {
  const catFilter = document.getElementById('filterProdCategory')?.value || '';
  const compFilter = document.getElementById('filterProdCompany')?.value || '';
  const affilFilter = document.getElementById('filterProdAffiliation')?.value || '';
  const activeFilter = document.getElementById('filterProdActive')?.value || '';

  let filtered = currentProducts;

  if (catFilter) {
    filtered = filtered.filter(p => (p.category || 'Geral') === catFilter);
  }

  if (compFilter !== '') {
    if (compFilter === '0') {
      filtered = filtered.filter(p => !p.company_id);
    } else {
      filtered = filtered.filter(p => p.company_id === Number(compFilter));
    }
  }

  if (affilFilter === 'enabled') {
    filtered = filtered.filter(p => p.affiliation_enabled !== 0);
  } else if (affilFilter === 'disabled') {
    filtered = filtered.filter(p => p.affiliation_enabled === 0);
  }

  if (activeFilter !== '') {
    filtered = filtered.filter(p => String(p.active ? 1 : 0) === activeFilter);
  }

  const tbody = document.querySelector('#tableProducts tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center" style="padding: 25px; color: var(--text-muted);">Nenhum produto encontrado com os filtros selecionados.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    let typeLabel = '';
    let infoExtra = '-';

    if (p.type === 'digital_link') {
      typeLabel = '<span class="badge" style="background:#3b82f620; color:#3b82f6"><i class="fa-solid fa-link"></i> Link / Arquivo</span>';
      infoExtra = p.content ? `<a href="${p.content}" target="_blank" style="color:var(--primary-gold)">Ver link</a>` : '-';
    } else if (p.type === 'license_key') {
      typeLabel = '<span class="badge" style="background:#a855f720; color:#a855f7"><i class="fa-solid fa-key"></i> Chave Licença</span>';
      infoExtra = `<b>${p.availableStock || 0}</b> disponíveis`;
    } else if (p.type === 'vip_subscription') {
      typeLabel = '<span class="badge" style="background:#f0b90b20; color:#f0b90b"><i class="fa-solid fa-crown"></i> Assinatura VIP</span>';
      infoExtra = `${p.duration_days} dias de acesso`;
    }

    const statusBadge = p.active 
      ? '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Ativo</span>' 
      : '<span class="badge badge-canceled"><i class="fa-solid fa-circle-pause"></i> Inativo</span>';

    const affilBadge = p.affiliation_enabled !== 0
      ? `<span class="badge" style="background:#10b98120; color:#10b981" title="Disponível para venda por afiliados"><i class="fa-solid fa-check"></i> Aberta${p.custom_affiliate_rate ? ` (${p.custom_affiliate_rate}%)` : ''}</span>`
      : `<span class="badge" style="background:#ef444420; color:#ef4444" title="Afiliação desabilitada para este produto"><i class="fa-solid fa-ban"></i> Fechada</span>`;

    const sellersBadge = (p.assigned_sellers && p.assigned_sellers.length > 0)
      ? `<span class="badge" style="background:#3b82f620; color:#3b82f6; cursor:pointer;" title="${p.assigned_sellers.map(s => s.name).join(', ')}"><i class="fa-solid fa-user-check"></i> ${p.assigned_sellers.length} vendedor(es)</span>`
      : `<span style="color:var(--text-muted); font-size:12px;">Todos</span>`;

    const brl = Number(p.price_brl || p.price).toFixed(2);
    const usdt = Number(p.price_usdt || (p.price / 5.5)).toFixed(2);

    const companyLabel = p.company_name ? `<b>${p.company_name}</b>` : '<span style="color:var(--text-muted)">Matriz</span>';
    const categoryLabel = `<span class="badge" style="background:#64748b20; color:#94a3b8"><i class="fa-solid fa-tag"></i> ${p.category || 'Geral'}</span>`;

    return `
      <tr>
        <td>#${p.id}</td>
        <td><b>${p.name}</b><br><small style="color:var(--text-muted)">${p.description || ''}</small></td>
        <td>${companyLabel}</td>
        <td>${categoryLabel}</td>
        <td>${typeLabel}</td>
        <td><b style="color:var(--color-pix)">R$ ${brl}</b></td>
        <td><b style="color:var(--primary-gold)">${usdt} USDT</b></td>
        <td>${infoExtra}</td>
        <td>${affilBadge}</td>
        <td>${sellersBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-primary" onclick="openEditProductModal(${p.id})" title="Editar Produto Completo">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})" title="Excluir Produto">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function populateCategoriesDatalist() {
  try {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    const datalist = document.getElementById('listCategories');
    if (!datalist) return;
    datalist.innerHTML = categories.map(c => `<option value="${c}">`).join('');
  } catch (_) {}
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

function renderProductSellersChecklist(selectedSellerIds = []) {
  const container = document.getElementById('prodSellersChecklist');
  if (!container) return;

  if (!currentSellers || currentSellers.length === 0) {
    container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);">Nenhum vendedor cadastrado ainda no sistema.</div>';
    return;
  }

  const selectedSet = new Set((selectedSellerIds || []).map(Number));

  container.innerHTML = currentSellers.map(s => {
    const isChecked = selectedSet.has(s.id) ? 'checked' : '';
    return `
      <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; cursor: pointer; font-size: 13px; font-weight: normal;">
        <input type="checkbox" name="prodSellerCheckbox" value="${s.id}" ${isChecked}>
        <span><b>${s.name}</b> ${s.email ? `<small style="color:var(--text-muted)">(${s.email})</small>` : ''}</span>
      </label>
    `;
  }).join('');
}

function openProductModal() {
  document.getElementById('formProduct').reset();
  document.getElementById('prodId').value = '';
  document.getElementById('modalProductTitle').innerText = 'Novo Produto / Assinatura';
  const saveBtn = document.getElementById('btnSaveProduct');
  if (saveBtn) saveBtn.innerText = 'Salvar Produto';

  populateCompaniesDropdown();
  populateCategoriesDatalist();
  populateProductUpsellDropdown();

  document.getElementById('prodActive').value = '1';
  document.getElementById('prodAffiliationEnabled').checked = true;
  document.getElementById('prodCustomAffiliateRate').value = '';
  document.getElementById('prodUpsellDiscount').value = '20';
  document.getElementById('prodUpsellHeadline').value = '';
  document.getElementById('prodCategory').value = 'Geral';

  renderProductSellersChecklist([]);
  toggleProductTypeFields();
  document.getElementById('modalProduct').classList.add('active');
}

async function openEditProductModal(id) {
  try {
    let p = currentProducts.find(prod => prod.id === id);
    if (!p) {
      const res = await fetch(`/api/products/${id}`);
      if (res.ok) p = await res.json();
    }
    if (!p) {
      alert('Produto não encontrado');
      return;
    }

    document.getElementById('formProduct').reset();
    document.getElementById('prodId').value = p.id;
    document.getElementById('modalProductTitle').innerText = `Editar Produto #${p.id} - ${p.name}`;
    const saveBtn = document.getElementById('btnSaveProduct');
    if (saveBtn) saveBtn.innerText = 'Salvar Alterações';

    populateCompaniesDropdown();
    populateCategoriesDatalist();
    populateProductUpsellDropdown(p.id);

    document.getElementById('prodName').value = p.name || '';
    document.getElementById('prodDesc').value = p.description || '';
    document.getElementById('prodPriceBRL').value = p.price_brl !== undefined ? p.price_brl : p.price;
    document.getElementById('prodPriceUSDT').value = p.price_usdt !== undefined ? p.price_usdt : (p.price / 5.5).toFixed(2);
    document.getElementById('prodCompanyId').value = p.company_id || '';
    document.getElementById('prodCategory').value = p.category || 'Geral';
    document.getElementById('prodActive').value = p.active ? '1' : '0';
    document.getElementById('prodType').value = p.type;
    document.getElementById('prodContent').value = p.content || '';
    document.getElementById('prodDuration').value = p.duration_days || 0;
    document.getElementById('prodChannelId').value = p.telegram_channel_id || '';

    document.getElementById('prodUpsellId').value = p.upsell_product_id || '';
    document.getElementById('prodUpsellDiscount').value = p.upsell_discount_percent !== undefined ? p.upsell_discount_percent : 20;
    document.getElementById('prodUpsellHeadline').value = p.upsell_headline || '';

    document.getElementById('prodAffiliationEnabled').checked = p.affiliation_enabled !== 0;
    document.getElementById('prodCustomAffiliateRate').value = (p.custom_affiliate_rate !== null && p.custom_affiliate_rate !== undefined) ? p.custom_affiliate_rate : '';

    renderProductSellersChecklist(p.assigned_seller_ids || []);
    toggleProductTypeFields();

    document.getElementById('modalProduct').classList.add('active');
  } catch (err) {
    alert('Erro ao abrir edição de produto: ' + err.message);
  }
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
  const prodId = document.getElementById('prodId').value;
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
  const company_id = document.getElementById('prodCompanyId').value ? parseInt(document.getElementById('prodCompanyId').value, 10) : null;
  const category = document.getElementById('prodCategory').value.trim() || 'Geral';
  const active = parseInt(document.getElementById('prodActive').value, 10);
  const affiliation_enabled = document.getElementById('prodAffiliationEnabled').checked ? 1 : 0;
  const customRateVal = document.getElementById('prodCustomAffiliateRate').value;
  const custom_affiliate_rate = customRateVal !== '' ? parseFloat(customRateVal) : null;

  const checkedSellers = Array.from(document.querySelectorAll('#prodSellersChecklist input[type="checkbox"]:checked')).map(cb => parseInt(cb.value, 10));

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
    upsell_headline,
    company_id,
    category,
    active,
    affiliation_enabled,
    custom_affiliate_rate,
    seller_ids: checkedSellers
  };

  try {
    const url = prodId ? `/api/products/${prodId}` : '/api/products';
    const method = prodId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      closeProductModal();
      await loadProducts();
      loadMetrics();
    } else {
      const err = await res.json();
      alert('Erro ao salvar produto: ' + (err.error || 'Falha ao salvar produto'));
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

    // Critérios Mínimos de Afiliação
    if (document.getElementById('cfgAffiliationMinSales')) {
      document.getElementById('cfgAffiliationMinSales').value = cfg.AFFILIATION_MIN_SALES || 2;
    }
    if (document.getElementById('cfgAffiliationMinRevenue')) {
      document.getElementById('cfgAffiliationMinRevenue').value = cfg.AFFILIATION_MIN_REVENUE_BRL || 50.0;
    }
    if (document.getElementById('cfgAffiliationRequirePayment')) {
      document.getElementById('cfgAffiliationRequirePayment').checked = cfg.AFFILIATION_REQUIRE_PAYMENT_INFO !== false;
    }
    if (document.getElementById('cfgAffiliationAutoApprove')) {
      document.getElementById('cfgAffiliationAutoApprove').checked = cfg.AFFILIATION_AUTO_APPROVE !== false;
    }
    if (document.getElementById('cfgAffiliationProductRestricted')) {
      document.getElementById('cfgAffiliationProductRestricted').checked = cfg.AFFILIATION_PRODUCT_RESTRICTED === true;
    }

    // Badges informativos na aba de Fila de Afiliação
    if (document.getElementById('badgeCriteriaSales')) {
      document.getElementById('badgeCriteriaSales').innerText = `Mín. ${cfg.AFFILIATION_MIN_SALES || 2} Vendas`;
    }
    if (document.getElementById('badgeCriteriaRevenue')) {
      document.getElementById('badgeCriteriaRevenue').innerText = `Mín. R$ ${Number(cfg.AFFILIATION_MIN_REVENUE_BRL || 50).toFixed(2)}`;
    }
    if (document.getElementById('badgeCriteriaAutoApprove')) {
      const isAuto = cfg.AFFILIATION_AUTO_APPROVE !== false;
      document.getElementById('badgeCriteriaAutoApprove').className = isAuto ? 'badge badge-paid' : 'badge badge-pending';
      document.getElementById('badgeCriteriaAutoApprove').innerText = isAuto ? '⚡ Auto-ativação Ativa' : '✋ Aprovação Manual';
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
    AFFILIATION_MIN_SALES: parseInt(document.getElementById('cfgAffiliationMinSales')?.value, 10) || 2,
    AFFILIATION_MIN_REVENUE_BRL: parseFloat(document.getElementById('cfgAffiliationMinRevenue')?.value) || 50.0,
    AFFILIATION_REQUIRE_PAYMENT_INFO: document.getElementById('cfgAffiliationRequirePayment')?.checked ?? true,
    AFFILIATION_AUTO_APPROVE: document.getElementById('cfgAffiliationAutoApprove')?.checked ?? true,
    AFFILIATION_PRODUCT_RESTRICTED: document.getElementById('cfgAffiliationProductRestricted')?.checked ?? false,
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

// ==========================================
// 15. EXÉRCITO DE WHATSAPP & DIVULGAÇÃO DE AFILIADOS
// ==========================================

async function loadArmyData() {
  await Promise.all([
    loadArmyInstances(),
    loadArmyLinks(),
    loadArmyCampaigns(),
    loadFunnelStats()
  ]);
  updateArmyMetrics();
}

function updateArmyMetrics() {
  const connectedCount = currentArmyInstances.filter(i => i.status === 'CONNECTED').length;
  const totalInstances = currentArmyInstances.length;
  const elConn = document.getElementById('armyStatConnected');
  if (elConn) elConn.innerText = `${connectedCount} / ${totalInstances}`;

  const sentToday = currentArmyInstances.reduce((acc, i) => acc + (i.messages_sent_today || 0), 0);
  const totalLimit = currentArmyInstances.reduce((acc, i) => acc + (i.daily_limit || 50), 0);
  const elSent = document.getElementById('armyStatSentToday');
  if (elSent) elSent.innerText = `${sentToday} / ${totalLimit} max`;

  const elLinks = document.getElementById('armyStatTotalLinks');
  if (elLinks) elLinks.innerText = `${currentArmyLinks.length} cadastrados`;

  const activeCamps = currentArmyCampaigns.filter(c => c.status === 'RUNNING').length;
  const elCamps = document.getElementById('armyStatActiveCampaigns');
  if (elCamps) elCamps.innerText = `${activeCamps} ativas`;
}

// --- 1. INSTÂNCIAS / CHIPS DO EXÉRCITO ---

async function loadArmyInstances() {
  try {
    const res = await fetch('/api/army/instances');
    currentArmyInstances = await res.json();

    const tbody = document.querySelector('#tableArmyInstances tbody');
    if (!tbody) return;

    if (currentArmyInstances.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhum chip conectado ainda. Clique em "Conectar Novo Chip" acima.</td></tr>';
      return;
    }

    tbody.innerHTML = currentArmyInstances.map(inst => {
      let statusBadge = '';
      if (inst.status === 'CONNECTED') {
        statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Conectado</span>';
      } else if (inst.status === 'WAITING_QR') {
        statusBadge = '<span class="badge" style="background:#f59e0b20; color:#f59e0b"><i class="fa-solid fa-qrcode"></i> Aguardando QR</span>';
      } else if (inst.status === 'CONNECTING') {
        statusBadge = '<span class="badge" style="background:#3b82f620; color:#3b82f6"><i class="fa-solid fa-spinner fa-spin"></i> Conectando...</span>';
      } else {
        statusBadge = '<span class="badge badge-canceled"><i class="fa-solid fa-circle-xmark"></i> Desconectado</span>';
      }

      const mainBadge = inst.is_main ? '<span class="badge" style="background:#f0b90b20; color:#f0b90b; margin-left: 6px;"><i class="fa-solid fa-crown"></i> Matriz</span>' : '';
      const warmupBadge = inst.warmup_mode ? '<span class="badge" style="background:#10b98120; color:#10b981">Aquecimento</span>' : '<span style="color:var(--text-muted); font-size:12px;">Normal</span>';

      return `
        <tr>
          <td>#${inst.id}</td>
          <td><b>${inst.name}</b>${mainBadge}</td>
          <td>${inst.phone ? `<b>${inst.phone}</b>` : '<span style="color:var(--text-muted)">Aguardando leitura</span>'}</td>
          <td>${statusBadge}</td>
          <td><b>${inst.messages_sent_today || 0}</b> envios</td>
          <td>${inst.daily_limit} / dia</td>
          <td>${warmupBadge}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-secondary" onclick="openArmyQrModal(${inst.id})" title="Ver QR Code / Status">
                <i class="fa-solid fa-qrcode"></i> QR
              </button>
              ${inst.status !== 'CONNECTED' ? `
                <button class="btn btn-sm btn-primary" onclick="connectArmyInstance(${inst.id})" title="Conectar / Reconectar">
                  <i class="fa-solid fa-play"></i>
                </button>
              ` : `
                <button class="btn btn-sm btn-secondary" onclick="disconnectArmyInstance(${inst.id})" title="Desconectar">
                  <i class="fa-solid fa-pause"></i>
                </button>
              `}
              ${!inst.is_main ? `
                <button class="btn btn-sm btn-danger" onclick="deleteArmyInstance(${inst.id})" title="Excluir Chip">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar instâncias do exército:', err);
  }
}

function openArmyInstanceModal() {
  document.getElementById('formArmyInstance').reset();
  document.getElementById('armyInstId').value = '';
  document.getElementById('armyInstName').value = `Chip 0${currentArmyInstances.length + 1} - Divulgador`;
  document.getElementById('armyInstDailyLimit').value = '50';
  document.getElementById('modalArmyInstance').classList.add('active');
}

function closeArmyInstanceModal() {
  document.getElementById('modalArmyInstance').classList.remove('active');
}

async function saveArmyInstance(e) {
  e.preventDefault();
  const name = document.getElementById('armyInstName').value.trim();
  const phone = document.getElementById('armyInstPhone').value.trim();
  const daily_limit = parseInt(document.getElementById('armyInstDailyLimit').value, 10) || 50;
  const warmup_mode = document.getElementById('armyInstWarmup').checked ? 1 : 0;

  try {
    const res = await fetch('/api/army/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, daily_limit, warmup_mode })
    });
    if (res.ok) {
      closeArmyInstanceModal();
      await loadArmyInstances();
      updateArmyMetrics();
    } else {
      const err = await res.json();
      alert('Erro ao salvar chip: ' + (err.error || 'Falha ao salvar'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function deleteArmyInstance(id) {
  if (!confirm('Deseja realmente remover esta instância do exército?')) return;
  try {
    const res = await fetch(`/api/army/instances/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadArmyInstances();
      updateArmyMetrics();
    } else {
      const err = await res.json();
      alert('Erro: ' + err.error);
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function connectArmyInstance(id) {
  try {
    openArmyQrModal(id);
    await fetch(`/api/army/instances/${id}/connect`, { method: 'POST' });
  } catch (err) {
    alert('Erro ao conectar chip: ' + err.message);
  }
}

async function disconnectArmyInstance(id) {
  try {
    await fetch(`/api/army/instances/${id}/disconnect`, { method: 'POST' });
    await loadArmyInstances();
    updateArmyMetrics();
  } catch (err) {
    alert('Erro ao desconectar chip: ' + err.message);
  }
}

function openArmyQrModal(instanceId) {
  const modal = document.getElementById('modalArmyQr');
  const container = document.getElementById('armyQrContainer');
  const statusText = document.getElementById('armyQrStatusText');
  document.getElementById('modalArmyQrTitle').innerText = `QR Code - Chip #${instanceId}`;
  modal.classList.add('active');

  container.innerHTML = '<div style="padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Carregando status do WhatsApp...</div>';

  if (armyQrPollingInterval) clearInterval(armyQrPollingInterval);

  const checkQr = async () => {
    try {
      const res = await fetch(`/api/army/instances/${instanceId}/qr`);
      const data = await res.json();

      if (data.connected) {
        container.innerHTML = '<div style="padding: 30px; color: #10b981;"><i class="fa-solid fa-circle-check fa-3x"></i><h4 style="margin-top: 15px;">Chip Conectado com Sucesso!</h4></div>';
        statusText.innerText = 'Este número já está online e pronto para receber comandos e disparar campanhas.';
        loadArmyInstances();
        updateArmyMetrics();
      } else if (data.qrDataUrl) {
        container.innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code WhatsApp" style="width: 250px; height: 250px; border-radius: 8px; border: 4px solid var(--border-color); background: #fff; padding: 10px;">`;
        statusText.innerText = 'Aponte a câmera do WhatsApp para escanear e autenticar este chip.';
      } else {
        container.innerHTML = '<div style="padding: 35px; color: var(--text-muted);"><i class="fa-solid fa-rotate fa-spin fa-2x"></i><br><br>Aguardando resposta do Baileys...</div>';
      }
    } catch (_) {}
  };

  checkQr();
  armyQrPollingInterval = setInterval(checkQr, 3000);
}

function closeArmyQrModal() {
  if (armyQrPollingInterval) {
    clearInterval(armyQrPollingInterval);
    armyQrPollingInterval = null;
  }
  document.getElementById('modalArmyQr').classList.remove('active');
  loadArmyInstances();
  updateArmyMetrics();
}

// --- 2. LINKS DE AFILIADO ---

async function loadArmyLinks() {
  try {
    const res = await fetch('/api/army/links');
    currentArmyLinks = await res.json();

    const tbody = document.querySelector('#tableArmyLinks tbody');
    if (!tbody) return;

    if (currentArmyLinks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhum link de afiliado cadastrado. Clique em "Novo Link de Afiliado" acima.</td></tr>';
      return;
    }

    tbody.innerHTML = currentArmyLinks.map(l => {
      const platformColors = {
        Hotmart: '#f04e23',
        Kiwify: '#00cc66',
        Monetizze: '#1a56db',
        Braip: '#9333ea',
        Cakto: '#f59e0b',
        PayBot: '#f0b90b',
        Outro: '#64748b'
      };
      const pColor = platformColors[l.platform] || '#64748b';

      return `
        <tr>
          <td>#${l.id}</td>
          <td><b>${l.title}</b></td>
          <td><span class="badge" style="background:${pColor}20; color:${pColor}; font-weight:600;"><i class="fa-solid fa-tag"></i> ${l.platform}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <code style="background:rgba(255,255,255,0.05); padding:3px 6px; border-radius:4px; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.affiliate_url}</code>
              <button class="btn btn-sm btn-secondary" onclick="copyAffiliateLink('${l.affiliate_url}')" title="Copiar Link">
                <i class="fa-solid fa-copy"></i>
              </button>
            </div>
          </td>
          <td><b style="color:var(--primary-gold)">${l.commission_percent}%</b></td>
          <td>${l.product_price ? `R$ ${Number(l.product_price).toFixed(2)}` : '-'}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-primary" onclick="openCampaignWithLink(${l.id})" title="Criar Campanha para este Link">
                <i class="fa-solid fa-bullhorn"></i> Disparar
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteAffiliateLink(${l.id})" title="Excluir Link">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar links de afiliado:', err);
  }
}

function openAffiliateLinkModal() {
  document.getElementById('formAffiliateLink').reset();
  document.getElementById('armyLinkId').value = '';
  document.getElementById('modalAffiliateLinkTitle').innerText = 'Novo Link de Afiliado';
  document.getElementById('modalAffiliateLink').classList.add('active');
}

function closeAffiliateLinkModal() {
  document.getElementById('modalAffiliateLink').classList.remove('active');
}

async function saveAffiliateLink(e) {
  e.preventDefault();
  const title = document.getElementById('armyLinkTitle').value.trim();
  const platform = document.getElementById('armyLinkPlatform').value;
  const affiliate_url = document.getElementById('armyLinkUrl').value.trim();
  const commission_percent = parseFloat(document.getElementById('armyLinkCommission').value) || 50;
  const product_price = parseFloat(document.getElementById('armyLinkPrice').value) || 0;
  const pitch_copy = document.getElementById('armyLinkPitch').value.trim();

  try {
    const res = await fetch('/api/army/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, platform, affiliate_url, commission_percent, product_price, pitch_copy })
    });
    if (res.ok) {
      closeAffiliateLinkModal();
      await loadArmyLinks();
      updateArmyMetrics();
    } else {
      const err = await res.json();
      alert('Erro ao salvar link: ' + (err.error || 'Falha ao salvar'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function deleteAffiliateLink(id) {
  if (!confirm('Deseja realmente remover este link de afiliado?')) return;
  try {
    await fetch(`/api/army/links/${id}`, { method: 'DELETE' });
    await loadArmyLinks();
    updateArmyMetrics();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function copyAffiliateLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    alert('Link de afiliado copiado para a área de transferência!');
  });
}

function openCampaignWithLink(linkId) {
  openCampaignModal();
  const select = document.getElementById('campLinkSelect');
  if (select) {
    select.value = String(linkId);
    onCampaignLinkSelectChange();
  }
}

// --- 3. CAMPANHAS DE DIVULGAÇÃO EM MASSA (BROADCAST) ---

async function loadArmyCampaigns() {
  try {
    const res = await fetch('/api/army/campaigns');
    currentArmyCampaigns = await res.json();

    const tbody = document.querySelector('#tableArmyCampaigns tbody');
    if (!tbody) return;

    if (currentArmyCampaigns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma campanha criada ainda. Clique em "Criar Nova Campanha" acima.</td></tr>';
      return;
    }

    tbody.innerHTML = currentArmyCampaigns.map(c => {
      let statusBadge = '';
      if (c.status === 'RUNNING') {
        statusBadge = '<span class="badge" style="background:#10b98120; color:#10b981"><i class="fa-solid fa-play fa-fade"></i> Em Andamento</span>';
      } else if (c.status === 'PAUSED') {
        statusBadge = '<span class="badge" style="background:#f59e0b20; color:#f59e0b"><i class="fa-solid fa-pause"></i> Pausada</span>';
      } else if (c.status === 'COMPLETED') {
        statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-check-double"></i> Concluída</span>';
      } else {
        statusBadge = '<span class="badge" style="background:#64748b20; color:#94a3b8">Rascunho</span>';
      }

      const percent = c.total_leads > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total_leads) * 100) : 0;

      return `
        <tr>
          <td>#${c.id}</td>
          <td><b>${c.name}</b></td>
          <td><b>${c.product_name}</b><br><small style="color:var(--text-muted)"><a href="${c.affiliate_url}" target="_blank" style="color:var(--primary-gold)">Ver link</a></small></td>
          <td>
            <div style="min-width: 140px;">
              <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                <span><b>${c.sent_count}</b> / ${c.total_leads} enviados</span>
                <span><b>${percent}%</b></span>
              </div>
              <div style="background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
                <div style="width:${percent}%; background:#10b981; height:100%;"></div>
              </div>
            </div>
          </td>
          <td>${c.delay_min_seconds}s a ${c.delay_max_seconds}s</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:6px;">
              ${c.status !== 'RUNNING' && c.status !== 'COMPLETED' ? `
                <button class="btn btn-sm btn-primary" onclick="startCampaign(${c.id})" title="Iniciar Disparos">
                  <i class="fa-solid fa-play"></i> Iniciar
                </button>
              ` : ''}
              ${c.status === 'RUNNING' ? `
                <button class="btn btn-sm btn-secondary" onclick="pauseCampaign(${c.id})" title="Pausar Disparos">
                  <i class="fa-solid fa-pause"></i> Pausar
                </button>
              ` : ''}
              <button class="btn btn-sm btn-secondary" onclick="openCampaignLeadsModal(${c.id})" title="Ver Leads / Fila">
                <i class="fa-solid fa-list"></i> Leads
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteCampaign(${c.id})" title="Excluir Campanha">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar campanhas:', err);
  }
}

function openCampaignModal() {
  document.getElementById('formCampaign').reset();
  document.getElementById('campId').value = '';
  document.getElementById('modalCampaignTitle').innerText = 'Nova Campanha de Divulgação em Massa';

  const select = document.getElementById('campLinkSelect');
  if (select) {
    select.innerHTML = '<option value="">Digitação Manual (Sem vínculo prévio)</option>' +
      currentArmyLinks.map(l => `<option value="${l.id}">${l.title} (${l.platform})</option>`).join('');
  }

  document.getElementById('campDelayMin').value = '20';
  document.getElementById('campDelayMax').value = '45';
  document.getElementById('modalCampaign').classList.add('active');
}

function closeCampaignModal() {
  document.getElementById('modalCampaign').classList.remove('active');
}

function onCampaignLinkSelectChange() {
  const select = document.getElementById('campLinkSelect');
  const selectedId = select.value;
  if (!selectedId) return;

  const link = currentArmyLinks.find(l => l.id === Number(selectedId));
  if (link) {
    document.getElementById('campProductName').value = link.title;
    document.getElementById('campAffiliateUrl').value = link.affiliate_url;
    if (link.pitch_copy) {
      document.getElementById('campMessageTemplate').value = link.pitch_copy;
    }
  }
}

function insertSpintaxTag(tag) {
  const textarea = document.getElementById('campMessageTemplate');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  textarea.value = text.substring(0, start) + tag + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + tag.length;
}

async function testSpintaxPreview() {
  const template = document.getElementById('campMessageTemplate').value;
  const product = document.getElementById('campProductName').value || 'Produto Especial';
  const link = document.getElementById('campAffiliateUrl').value || 'https://link.exemplo/afiliado';

  try {
    const res = await fetch('/api/army/spintax-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template,
        lead: { name: 'João' },
        campaign: { product_name: product, affiliate_url: link }
      })
    });
    const data = await res.json();
    document.getElementById('campSpintaxPreview').innerText = `"${data.preview}"`;
  } catch (_) {}
}

async function importPayBotCustomersToCampaign() {
  try {
    const res = await fetch('/api/army/customer-leads');
    const customers = await res.json();
    if (customers.length === 0) {
      alert('Nenhum cliente anterior via WhatsApp encontrado na base do PayBot.');
      return;
    }

    const lines = customers.map(c => c.name ? `${c.phone}, ${c.name}` : c.phone).join('\n');
    const textarea = document.getElementById('campLeadsText');
    textarea.value = (textarea.value ? textarea.value.trim() + '\n' : '') + lines;
    alert(`Sucesso! ${customers.length} contatos de compradores anteriores do PayBot foram adicionados à lista da campanha!`);
  } catch (err) {
    alert('Erro ao importar contatos: ' + err.message);
  }
}

async function saveCampaign(e) {
  e.preventDefault();
  const name = document.getElementById('campName').value.trim();
  const affiliate_link_id = document.getElementById('campLinkSelect').value ? parseInt(document.getElementById('campLinkSelect').value, 10) : null;
  const product_name = document.getElementById('campProductName').value.trim();
  const affiliate_url = document.getElementById('campAffiliateUrl').value.trim();
  const message_template = document.getElementById('campMessageTemplate').value.trim();
  const delay_min_seconds = parseInt(document.getElementById('campDelayMin').value, 10) || 20;
  const delay_max_seconds = parseInt(document.getElementById('campDelayMax').value, 10) || 45;

  const rawLeads = document.getElementById('campLeadsText').value.split('\n').map(l => l.trim()).filter(Boolean);
  const leads = rawLeads.map(line => {
    const parts = line.split(',');
    return {
      phone: parts[0].trim(),
      name: parts[1] ? parts[1].trim() : null
    };
  });

  const payload = {
    name,
    affiliate_link_id,
    product_name,
    affiliate_url,
    message_template,
    delay_min_seconds,
    delay_max_seconds,
    leads
  };

  try {
    const res = await fetch('/api/army/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeCampaignModal();
      await loadArmyCampaigns();
      updateArmyMetrics();
      alert(`Campanha "${name}" criada com ${leads.length} leads prontos para envio!`);
    } else {
      const err = await res.json();
      alert('Erro ao criar campanha: ' + (err.error || 'Falha na requisição'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function deleteCampaign(id) {
  if (!confirm('Deseja realmente remover esta campanha e todo o histórico de leads dela?')) return;
  try {
    await fetch(`/api/army/campaigns/${id}`, { method: 'DELETE' });
    await loadArmyCampaigns();
    updateArmyMetrics();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

async function startCampaign(id) {
  try {
    const res = await fetch(`/api/army/campaigns/${id}/start`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      loadArmyCampaigns();
      updateArmyMetrics();
      alert('Disparos iniciados! Os chips conectados do seu exército de WhatsApp começarão a disparar com intervalos anti-ban e Spintax.');
    } else {
      alert('Aviso: ' + (data.error || 'Falha ao iniciar'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function pauseCampaign(id) {
  try {
    const res = await fetch(`/api/army/campaigns/${id}/pause`, { method: 'POST' });
    loadArmyCampaigns();
    updateArmyMetrics();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function openCampaignLeadsModal(campaignId) {
  const modal = document.getElementById('modalCampaignLeads');
  modal.classList.add('active');
  const tbody = document.querySelector('#tableCampaignLeadsList tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Carregando lista de leads...</td></tr>';

  try {
    const res = await fetch(`/api/army/campaigns/${campaignId}/leads`);
    const leads = await res.json();

    if (leads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum lead nesta campanha.</td></tr>';
      return;
    }

    tbody.innerHTML = leads.map(l => {
      let badge = '';
      if (l.status === 'SENT') {
        badge = '<span class="badge badge-paid"><i class="fa-solid fa-check"></i> Enviado</span>';
      } else if (l.status === 'REPLIED') {
        badge = '<span class="badge" style="background:#10b98120; color:#10b981"><i class="fa-solid fa-reply"></i> Respondeu (Interessado)</span>';
      } else if (l.status === 'FAILED') {
        badge = '<span class="badge badge-canceled"><i class="fa-solid fa-xmark"></i> Falhou</span>';
      } else {
        badge = '<span class="badge" style="background:#f59e0b20; color:#f59e0b"><i class="fa-solid fa-clock"></i> Pendente</span>';
      }

      return `
        <tr>
          <td>#${l.id}</td>
          <td><b>${l.phone}</b></td>
          <td>${l.name || '-'}</td>
          <td>${badge}</td>
          <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.sent_message || ''}">
            ${l.sent_message ? l.sent_message : '<span style="color:var(--text-muted)">Aguardando envio</span>'}
          </td>
          <td>${l.sent_at ? new Date(l.sent_at).toLocaleTimeString('pt-BR') : '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Erro ao carregar: ${err.message}</td></tr>`;
  }
}

function closeCampaignLeadsModal() {
  document.getElementById('modalCampaignLeads').classList.remove('active');
}

// ==========================================
// 16. FUNIL DE AQUECIMENTO & GRÁFICO EM TEMPO REAL
// ==========================================

async function loadFunnelStats() {
  try {
    const res = await fetch('/api/army/funnel/stats');
    if (!res.ok) return;
    const stats = await res.json();

    const elReply = document.getElementById('funnelStatReplyRate');
    if (elReply) elReply.innerText = `${stats.replyRate}%`;

    const elOffer = document.getElementById('funnelStatOfferRate');
    if (elOffer) elOffer.innerText = `${stats.offerReachRate}%`;

    const elConv = document.getElementById('funnelStatConversionRate');
    if (elConv) elConv.innerText = `${stats.conversionRate}%`;

    const elTotal = document.getElementById('funnelStatTotalLeads');
    if (elTotal) elTotal.innerText = `${stats.totalLeads} leads`;

    const total = stats.totalLeads > 0 ? stats.totalLeads : 1;

    // Etapa 1
    const p1 = stats.totalLeads > 0 ? 100 : 0;
    const c1 = document.getElementById('funnelCount1');
    if (c1) c1.innerText = `${stats.stage1} leads`;
    const pct1 = document.getElementById('funnelPct1');
    if (pct1) pct1.innerText = `${p1}%`;
    const bar1 = document.getElementById('funnelBar1');
    if (bar1) bar1.style.width = `${p1}%`;

    // Etapa 2
    const p2 = Math.round(((stats.stage2 + stats.stage3 + stats.stage4 + stats.stage5 + stats.converted) / total) * 100);
    const c2 = document.getElementById('funnelCount2');
    if (c2) c2.innerText = `${stats.stage2} leads`;
    const pct2 = document.getElementById('funnelPct2');
    if (pct2) pct2.innerText = `${p2}%`;
    const bar2 = document.getElementById('funnelBar2');
    if (bar2) bar2.style.width = `${p2}%`;

    // Etapa 3
    const p3 = Math.round(((stats.stage3 + stats.stage4 + stats.stage5 + stats.converted) / total) * 100);
    const c3 = document.getElementById('funnelCount3');
    if (c3) c3.innerText = `${stats.stage3} leads`;
    const pct3 = document.getElementById('funnelPct3');
    if (pct3) pct3.innerText = `${p3}%`;
    const bar3 = document.getElementById('funnelBar3');
    if (bar3) bar3.style.width = `${p3}%`;

    // Etapa 4
    const p4 = Math.round(((stats.stage4 + stats.stage5 + stats.converted) / total) * 100);
    const c4 = document.getElementById('funnelCount4');
    if (c4) c4.innerText = `${stats.stage4} leads`;
    const pct4 = document.getElementById('funnelPct4');
    if (pct4) pct4.innerText = `${p4}%`;
    const bar4 = document.getElementById('funnelBar4');
    if (bar4) bar4.style.width = `${p4}%`;

    // Etapa 5
    const p5 = Math.round(((stats.stage5 + stats.converted) / total) * 100);
    const c5 = document.getElementById('funnelCount5');
    if (c5) c5.innerText = `${stats.stage5} leads`;
    const pct5 = document.getElementById('funnelPct5');
    if (pct5) pct5.innerText = `${p5}%`;
    const bar5 = document.getElementById('funnelBar5');
    if (bar5) bar5.style.width = `${p5}%`;

    // Convertidos
    const pConv = Math.round((stats.converted / total) * 100);
    const cConv = document.getElementById('funnelCountConv');
    if (cConv) cConv.innerText = `${stats.converted} vendas`;
    const pctConv = document.getElementById('funnelPctConv');
    if (pctConv) pctConv.innerText = `${pConv}%`;
    const barConv = document.getElementById('funnelBarConv');
    if (barConv) barConv.style.width = `${pConv}%`;
  } catch (err) {
    console.error('Erro ao carregar estatísticas do funil:', err);
  }
}

async function openFunnelStagesModal() {
  const modal = document.getElementById('modalFunnelStages');
  modal.classList.add('active');
  const container = document.getElementById('funnelStagesList');
  container.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Carregando etapas...</div>';

  try {
    const res = await fetch('/api/army/funnel/stages');
    const stages = await res.json();

    container.innerHTML = stages.map(s => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h4 style="margin: 0; color: var(--primary-gold);"><i class="fa-solid fa-circle-dot"></i> ${s.title}</h4>
          <span class="badge" style="background: #3b82f620; color: #3b82f6;">Ordem #${s.order_num}</span>
        </div>
        <form onsubmit="saveFunnelStage('${s.stage_key}', event)">
          <div class="form-group">
            <label style="font-size: 12px;">Script / Mensagem do Bot nesta Etapa:</label>
            <textarea id="stage_msg_${s.stage_key}" class="form-control" rows="3" required>${s.message_template || ''}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label style="font-size: 12px;">Mensagem de Follow-up (se o lead não responder):</label>
              <textarea id="stage_follow_${s.stage_key}" class="form-control" rows="2">${s.followup_template || ''}</textarea>
            </div>
            <div class="form-group" style="width: 140px;">
              <label style="font-size: 12px;">Tempo (min):</label>
              <input type="number" id="stage_delay_${s.stage_key}" class="form-control" value="${s.followup_delay_minutes || 120}" min="5">
            </div>
          </div>
          <div style="text-align: right;">
            <button type="submit" class="btn btn-sm btn-primary">Salvar Script desta Etapa</button>
          </div>
        </form>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-danger">Erro ao carregar: ${err.message}</div>`;
  }
}

function closeFunnelStagesModal() {
  document.getElementById('modalFunnelStages').classList.remove('active');
}

async function saveFunnelStage(key, e) {
  e.preventDefault();
  const message_template = document.getElementById(`stage_msg_${key}`).value.trim();
  const followup_template = document.getElementById(`stage_follow_${key}`).value.trim();
  const followup_delay_minutes = parseInt(document.getElementById(`stage_delay_${key}`).value, 10) || 120;

  try {
    const res = await fetch(`/api/army/funnel/stages/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_template, followup_template, followup_delay_minutes })
    });
    if (res.ok) {
      alert('Etapa do funil atualizada com sucesso!');
    } else {
      alert('Erro ao atualizar etapa');
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function openLeadsByStageModal(stageKey) {
  const modal = document.getElementById('modalLeadsByStage');
  modal.classList.add('active');
  const stageTitles = {
    STAGE_1_DESCOBERTA: 'Etapa 1: Descoberta & Abertura',
    STAGE_2_INTERESSE: 'Etapa 2: Diagnóstico & Interesse',
    STAGE_3_SOLUCAO: 'Etapa 3: Apresentação da Solução & Prova',
    STAGE_4_OFERTA: 'Etapa 4: Oferta & Link de Afiliado',
    STAGE_5_FECHAMENTO: 'Etapa 5: Quebra de Objeções & Fechamento',
    CONVERTED: 'Vendas Concluídas (Convertidos)'
  };
  document.getElementById('modalLeadsByStageTitle').innerText = stageTitles[stageKey] || 'Leads do Funil';

  const tbody = document.querySelector('#tableLeadsByStageList tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Carregando leads da etapa...</td></tr>';

  try {
    const res = await fetch(`/api/army/funnel/leads?stage=${stageKey}`);
    const leads = await res.json();

    if (leads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum lead nesta etapa no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = leads.map(l => `
      <tr>
        <td><b>${l.phone}</b></td>
        <td>${l.name || '-'}</td>
        <td>${l.assigned_instance_name ? `<span class="badge" style="background:#3b82f620; color:#3b82f6;">${l.assigned_instance_name}</span>` : 'Chip Principal'}</td>
        <td><b>${l.messages_sent + l.messages_received}</b> msgs</td>
        <td>${l.last_message_at ? new Date(l.last_message_at).toLocaleTimeString('pt-BR') : '-'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="openLeadConversationModal('${l.phone}')" title="Ver Histórico da Conversa">
            <i class="fa-solid fa-comments"></i> Conversar
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Erro: ${err.message}</td></tr>`;
  }
}

function closeLeadsByStageModal() {
  document.getElementById('modalLeadsByStage').classList.remove('active');
}

async function openLeadConversationModal(phone) {
  const modal = document.getElementById('modalLeadConversation');
  modal.classList.add('active');
  document.getElementById('chatLeadPhone').value = phone;

  const thread = document.getElementById('leadChatThread');
  thread.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Carregando conversa...</div>';

  const instSelect = document.getElementById('chatInstanceSelect');
  instSelect.innerHTML = currentArmyInstances.map(i => `<option value="${i.id}">${i.name}</option>`).join('');

  try {
    const res = await fetch(`/api/army/funnel/leads/${phone}`);
    const data = await res.json();
    const lead = data.lead;
    const history = data.history;

    document.getElementById('modalLeadChatTitle').innerText = `${lead.name || 'Lead'} (${lead.phone})`;
    document.getElementById('modalLeadChatSubtitle').innerText = `Etapa: ${lead.current_stage_title || lead.current_stage} | Produto: ${lead.product_name}`;

    if (history.length === 0) {
      thread.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Nenhuma mensagem registrada nesta conversa ainda.</div>';
      return;
    }

    thread.innerHTML = history.map(h => {
      const isOut = h.direction === 'OUT';
      const align = isOut ? 'flex-end' : 'flex-start';
      const bg = isOut ? 'rgba(240, 185, 11, 0.15)' : 'rgba(255, 255, 255, 0.08)';
      const border = isOut ? '1px solid var(--primary-gold)' : '1px solid var(--border-color)';
      const sender = isOut ? `🤖 Bot (${h.instance_name || 'Chip'})` : `👤 ${lead.name || 'Lead'}`;

      return `
        <div style="align-self: ${align}; max-width: 80%; background: ${bg}; border: ${border}; border-radius: 8px; padding: 10px 14px;">
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: flex; justify-content: space-between; gap: 15px;">
            <b>${sender}</b>
            <span>${new Date(h.created_at).toLocaleTimeString('pt-BR')}</span>
          </div>
          <div style="font-size: 13px; line-height: 1.4; white-space: pre-wrap;">${h.message_text}</div>
        </div>
      `;
    }).join('');

    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    thread.innerHTML = `<div class="text-danger">Erro ao carregar histórico: ${err.message}</div>`;
  }
}

function closeLeadConversationModal() {
  document.getElementById('modalLeadConversation').classList.remove('active');
}

async function sendManualLeadReply(e) {
  e.preventDefault();
  const phone = document.getElementById('chatLeadPhone').value;
  const instance_id = document.getElementById('chatInstanceSelect').value;
  const input = document.getElementById('chatReplyText');
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await fetch('/api/army/funnel/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, text, instance_id })
    });
    if (res.ok) {
      input.value = '';
      openLeadConversationModal(phone);
      loadFunnelStats();
    } else {
      alert('Falha ao enviar resposta manual');
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

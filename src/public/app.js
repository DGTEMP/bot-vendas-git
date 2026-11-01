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
  renderCommandsTable();
  refreshSystemPing();

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
    loadChatControls();
    refreshSystemPing();
    renderCommandsTable();
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
  if (tabName === 'meteoric') loadMeteoricData();
  if (tabName === 'social') loadSocialData();
  if (tabName === 'nlp') loadNlpData();
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
    loadArmyData(),
    loadChatControls(),
    loadGroupAuditLogs(),
    loadChannelMetrics(),
    loadSupportTickets(),
    loadCustomTriggers(),
    loadMeteoricData()
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
  loadAllWhatsAppAccounts();
  if (!qrPollingInterval) {
    qrPollingInterval = setInterval(() => {
      loadWhatsAppStatus();
      loadAllWhatsAppAccounts();
    }, 3000);
  }
}

function stopQrPolling() {
  if (qrPollingInterval) {
    clearInterval(qrPollingInterval);
    qrPollingInterval = null;
  }
}

function switchWppConnectTab(tab) {
  const tabQr = document.getElementById('wppTabQr');
  const tabPairing = document.getElementById('wppTabPairing');
  const btnQr = document.getElementById('tabBtnWppQr');
  const btnPairing = document.getElementById('tabBtnWppPairing');

  if (tab === 'qr') {
    if (tabQr) tabQr.style.display = 'block';
    if (tabPairing) tabPairing.style.display = 'none';
    if (btnQr) btnQr.className = 'btn btn-sm btn-primary';
    if (btnPairing) btnPairing.className = 'btn btn-sm btn-secondary';
  } else {
    if (tabQr) tabQr.style.display = 'none';
    if (tabPairing) tabPairing.style.display = 'block';
    if (btnQr) btnQr.className = 'btn btn-sm btn-secondary';
    if (btnPairing) btnPairing.className = 'btn btn-sm btn-primary';
  }
}

async function requestWppPairingCode() {
  const phoneInput = document.getElementById('wppPairingPhone');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  if (!phone) {
    alert('Informe o número de telefone completo com DDI e DDD (ex: 5511999998888)');
    return;
  }

  const codeBox = document.getElementById('wppPairingCodeBox');
  const codeText = document.getElementById('wppPairingCodeText');
  if (codeText) codeText.innerText = 'GERANDO...';
  if (codeBox) codeBox.style.display = 'block';

  try {
    const res = await fetch('/api/whatsapp/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (res.ok && data.pairingCode) {
      if (codeText) codeText.innerText = data.pairingCode;
    } else {
      if (codeText) codeText.innerText = 'ERRO';
      alert('Erro ao gerar código de pareamento: ' + (data.error || 'Falha na resposta do servidor'));
    }
  } catch (err) {
    if (codeText) codeText.innerText = 'ERRO';
    alert('Erro de conexão: ' + err.message);
  }
}

function copyWppPairingCode() {
  const codeEl = document.getElementById('wppPairingCodeText');
  const code = codeEl ? codeEl.innerText.trim() : '';
  if (code && code !== '----' && code !== 'GERANDO...' && code !== 'ERRO') {
    navigator.clipboard.writeText(code).then(() => {
      alert('Código copiado com sucesso! Digite no seu WhatsApp celular.');
    }).catch(() => {
      alert('Código: ' + code);
    });
  }
}

async function resetWppSession() {
  if (!confirm('Deseja realmente limpar a sessão do WhatsApp Matriz? Isso desconectará o aparelho e gerará um novo QR/Código.')) return;
  try {
    const res = await fetch('/api/whatsapp/reset', { method: 'POST' });
    if (res.ok) {
      alert('Sessão limpa com sucesso! Um novo QR Code e código já estão disponíveis.');
      loadWhatsAppStatus();
    }
  } catch (err) {
    alert('Erro ao resetar sessão: ' + err.message);
  }
}

async function reconnectWppSession() {
  try {
    await fetch('/api/whatsapp/reconnect', { method: 'POST' });
    alert('Reconexão solicitada com sucesso! Aguarde alguns instantes.');
    loadWhatsAppStatus();
  } catch (err) {
    alert('Erro ao reconectar: ' + err.message);
  }
}

async function loadWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();

    const wppBadge = document.getElementById('wppBadge');
    const wppText = document.getElementById('wppStatusText');
    const qrBox = document.getElementById('wppQrContainer');
    const codeBox = document.getElementById('wppPairingCodeBox');
    const codeText = document.getElementById('wppPairingCodeText');

    if (data.connected) {
      wppBadge.className = 'badge badge-paid';
      const phoneText = data.phone ? ` (+${data.phone})` : '';
      wppBadge.innerText = 'Conectado' + phoneText;
      wppText.innerText = 'Seu WhatsApp Matriz está autenticado e pronto para vender!';
      qrBox.innerHTML = `
        <i class="fa-solid fa-circle-check" style="font-size: 64px; color: var(--color-green); margin-bottom: 12px;"></i>
        <h4 style="color: #12161f;">WhatsApp Matriz Conectado</h4>
        <span style="font-size: 12px; color: #64748b;">Recebendo e respondendo mensagens normalmente</span>
      `;
    } else {
      if (data.pairingCode && codeText) {
        codeText.innerText = data.pairingCode;
        if (codeBox) codeBox.style.display = 'block';
      }

      if (data.qrDataUrl) {
        wppBadge.className = 'badge badge-pending';
        wppBadge.innerText = 'Aguardando Leitura';
        wppText.innerText = 'Aponte a câmera do seu WhatsApp para o QR Code abaixo ou use o Código de 8 Dígitos:';
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
  const scrollBody = document.querySelector('#modalProduct .modal-body-scroll');
  if (scrollBody) scrollBody.scrollTop = 0;
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

    const scrollBody = document.querySelector('#modalProduct .modal-body-scroll');
    if (scrollBody) scrollBody.scrollTop = 0;

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

    // Automações e Segurança Gata Nina
    if (document.getElementById('cfgAntiLinkDefault')) {
      document.getElementById('cfgAntiLinkDefault').checked = cfg.ANTILINK_DEFAULT === true;
    }
    if (document.getElementById('cfgAntiDeleteDefault')) {
      document.getElementById('cfgAntiDeleteDefault').checked = cfg.ANTIDELETE_DEFAULT !== false;
    }
    if (document.getElementById('cfgAntiFakeDefault')) {
      document.getElementById('cfgAntiFakeDefault').checked = cfg.ANTIFAKE_DEFAULT !== false;
    }
    if (document.getElementById('cfgAntiFloodDefault')) {
      document.getElementById('cfgAntiFloodDefault').checked = cfg.ANTIFLOOD_DEFAULT !== false;
    }
    if (document.getElementById('cfgAntiViewOnceDefault')) {
      document.getElementById('cfgAntiViewOnceDefault').checked = cfg.ANTIVIEWONCE_DEFAULT !== false;
    }
    if (document.getElementById('cfgAntiPrivadoGlobal')) {
      document.getElementById('cfgAntiPrivadoGlobal').checked = cfg.ANTIPRIVADO_GLOBAL === true;
    }
    if (document.getElementById('cfgOwnerPhone')) {
      document.getElementById('cfgOwnerPhone').value = cfg.OWNER_PHONE || '';
    }
    if (document.getElementById('cfgAiApiKey')) {
      document.getElementById('cfgAiApiKey').value = cfg.AI_API_KEY || '';
    }
    if (document.getElementById('cfgWelcomeMsgDefault')) {
      document.getElementById('cfgWelcomeMsgDefault').value = cfg.WELCOME_MSG_DEFAULT || '';
    }
    if (document.getElementById('cfgByeMsgDefault')) {
      document.getElementById('cfgByeMsgDefault').value = cfg.BYE_MSG_DEFAULT || '';
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
    PUBLIC_URL: document.getElementById('cfgPublicUrl').value,

    // Automações, Moderação de Grupos & Segurança Gata Nina
    ANTILINK_DEFAULT: document.getElementById('cfgAntiLinkDefault')?.checked ?? false,
    ANTIDELETE_DEFAULT: document.getElementById('cfgAntiDeleteDefault')?.checked ?? true,
    ANTIFAKE_DEFAULT: document.getElementById('cfgAntiFakeDefault')?.checked ?? true,
    ANTIFLOOD_DEFAULT: document.getElementById('cfgAntiFloodDefault')?.checked ?? true,
    ANTIVIEWONCE_DEFAULT: document.getElementById('cfgAntiViewOnceDefault')?.checked ?? true,
    ANTIPRIVADO_GLOBAL: document.getElementById('cfgAntiPrivadoGlobal')?.checked ?? false,
    OWNER_PHONE: document.getElementById('cfgOwnerPhone')?.value?.trim() || '',
    AI_API_KEY: document.getElementById('cfgAiApiKey')?.value?.trim() || '',
    WELCOME_MSG_DEFAULT: document.getElementById('cfgWelcomeMsgDefault')?.value?.trim() || '',
    BYE_MSG_DEFAULT: document.getElementById('cfgByeMsgDefault')?.value?.trim() || ''
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
    loadFunnelStats(),
    loadOwnerSettings(),
    loadSubBotsSummary(),
    loadBroadcastProducts()
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
      const created = await res.json();
      closeArmyInstanceModal();
      await loadArmyInstances();
      updateArmyMetrics();
      loadAllWhatsAppAccounts();
      if (created && created.id) {
        openArmyQrModal(created.id);
      }
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

let currentArmyQrInstanceId = null;

function switchArmyConnectTab(tab) {
  const tabQr = document.getElementById('armyTabQr');
  const tabPairing = document.getElementById('armyTabPairing');
  const btnQr = document.getElementById('tabBtnQr');
  const btnPairing = document.getElementById('tabBtnPairing');

  if (tab === 'qr') {
    if (tabQr) tabQr.style.display = 'block';
    if (tabPairing) tabPairing.style.display = 'none';
    if (btnQr) btnQr.className = 'btn btn-sm btn-primary';
    if (btnPairing) btnPairing.className = 'btn btn-sm btn-secondary';
  } else {
    if (tabQr) tabQr.style.display = 'none';
    if (tabPairing) tabPairing.style.display = 'block';
    if (btnQr) btnQr.className = 'btn btn-sm btn-secondary';
    if (btnPairing) btnPairing.className = 'btn btn-sm btn-primary';
  }
}

async function refreshArmyQr() {
  if (!currentArmyQrInstanceId) return;
  const container = document.getElementById('armyQrContainer');
  if (container) {
    container.innerHTML = '<div style="padding: 35px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Gerando novo QR Code...</div>';
  }
  try {
    await fetch(`/api/army/instances/${currentArmyQrInstanceId}/connect`, { method: 'POST' });
  } catch (_) {}
}

async function requestArmyPairingCode() {
  if (!currentArmyQrInstanceId) return;
  const phoneInput = document.getElementById('armyPairingPhone');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  if (!phone) {
    alert('Informe o número de telefone completo com DDI e DDD (ex: 5511999998888)');
    return;
  }

  const codeBox = document.getElementById('armyPairingCodeBox');
  const codeText = document.getElementById('armyPairingCodeText');
  if (codeText) codeText.innerText = 'GERANDO...';
  if (codeBox) codeBox.style.display = 'block';

  try {
    const res = await fetch(`/api/army/instances/${currentArmyQrInstanceId}/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (res.ok && data.pairingCode) {
      if (codeText) codeText.innerText = data.pairingCode;
    } else {
      if (codeText) codeText.innerText = 'ERRO';
      alert('Erro ao gerar código de pareamento: ' + (data.error || 'Falha na resposta do servidor'));
    }
  } catch (err) {
    if (codeText) codeText.innerText = 'ERRO';
    alert('Erro de conexão: ' + err.message);
  }
}

function copyPairingCode() {
  const codeEl = document.getElementById('armyPairingCodeText');
  const code = codeEl ? codeEl.innerText.trim() : '';
  if (code && code !== '----' && code !== 'GERANDO...' && code !== 'ERRO') {
    navigator.clipboard.writeText(code).then(() => {
      alert('Código ' + code + ' copiado com sucesso! Digite no seu WhatsApp.');
    });
  }
}

async function resetCurrentArmyInstanceSession() {
  if (!currentArmyQrInstanceId) return;
  if (!confirm('Deseja resetar e limpar todos os arquivos de sessão deste chip? Use isto se o chip estiver travado ou não conectar.')) return;
  try {
    await fetch(`/api/army/instances/${currentArmyQrInstanceId}/reset`, { method: 'POST' });
    alert('Sessão resetada com sucesso! Você pode conectar agora.');
    closeArmyQrModal();
    loadArmyInstances();
  } catch (err) {
    alert('Erro ao resetar sessão: ' + err.message);
  }
}

function openArmyQrModal(instanceId) {
  currentArmyQrInstanceId = instanceId;
  const modal = document.getElementById('modalArmyQr');
  const container = document.getElementById('armyQrContainer');
  const statusText = document.getElementById('armyQrStatusText');
  const pairingInput = document.getElementById('armyPairingPhone');
  const codeBox = document.getElementById('armyPairingCodeBox');

  // Preenche telefone se cadastrado
  const inst = currentArmyInstances.find(i => i.id === instanceId);
  if (inst && inst.phone && pairingInput) {
    pairingInput.value = inst.phone;
  }
  if (codeBox) codeBox.style.display = 'none';

  switchArmyConnectTab('qr');
  document.getElementById('modalArmyQrTitle').innerHTML = `<i class="fa-brands fa-whatsapp" style="color: #25d366;"></i> Conectar Chip #${instanceId}`;
  modal.classList.add('active');

  container.innerHTML = '<div style="padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Inicializando conexão WhatsApp...</div>';

  if (armyQrPollingInterval) clearInterval(armyQrPollingInterval);

  // Inicia conexão caso ainda não tenha sido iniciada
  fetch(`/api/army/instances/${instanceId}/connect`, { method: 'POST' }).catch(() => {});

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
        container.innerHTML = '<div style="padding: 35px; color: var(--text-muted);"><i class="fa-solid fa-rotate fa-spin fa-2x"></i><br><br>Aguardando QR Code do Baileys...</div>';
      }

      if (data.pairingCode && codeBox && codeBox.style.display === 'none') {
        const codeText = document.getElementById('armyPairingCodeText');
        if (codeText) codeText.innerText = data.pairingCode;
        codeBox.style.display = 'block';
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

// ====================================================================
// 8. REDES SOCIAIS (INSTAGRAM DIRECT & FACEBOOK MESSENGER)
// ====================================================================
let currentSocialAccounts = [];

async function loadSocialData() {
  await Promise.all([
    loadSocialAccounts(),
    loadSocialStats(),
    loadSocialMessages()
  ]);
}

async function loadSocialAccounts() {
  try {
    const res = await fetch('/api/social/accounts');
    currentSocialAccounts = await res.json();

    const tbody = document.querySelector('#tableSocialAccounts tbody');
    const simSelect = document.getElementById('simSocialAccountId');

    if (simSelect) {
      simSelect.innerHTML = currentSocialAccounts.map(a => `
        <option value="${a.id}">[${a.platform.toUpperCase()}] ${a.name}</option>
      `).join('') || '<option value="">Nenhuma conta cadastrada</option>';
    }

    if (!tbody) return;

    if (currentSocialAccounts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px; color: var(--text-muted);">Nenhuma conta do Instagram ou Facebook conectada ainda. Clique no botão acima para adicionar.</td></tr>';
      return;
    }

    tbody.innerHTML = currentSocialAccounts.map(a => {
      const isIg = a.platform === 'instagram';
      const platIcon = isIg 
        ? '<span style="color: #e1306c; font-weight: bold;"><i class="fa-brands fa-instagram fa-lg"></i> Instagram</span>' 
        : '<span style="color: #1877f2; font-weight: bold;"><i class="fa-brands fa-facebook fa-lg"></i> Facebook</span>';
      
      const statusBadge = a.status === 'CONNECTED'
        ? '<span class="badge badge-success">Conectado</span>'
        : '<span class="badge" style="background: rgba(255,255,255,0.1); color: var(--text-muted);">Pausado</span>';

      const autoReplyBadge = a.auto_reply_enabled === 1
        ? '<span class="badge badge-success"><i class="fa-solid fa-bolt"></i> Ativo</span>'
        : '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;">Desativado</span>';

      return `
        <tr>
          <td>${platIcon}</td>
          <td><b>${a.name}</b></td>
          <td><code style="font-size: 11px;">${a.account_id}</code></td>
          <td>${statusBadge}</td>
          <td>
            <a href="javascript:void(0)" onclick="toggleSocialAutoReply(${a.id}, ${a.auto_reply_enabled ? 0 : 1})" style="text-decoration: none;">
              ${autoReplyBadge}
            </a>
          </td>
          <td>
            <span title="Recebidas"><i class="fa-solid fa-arrow-down" style="color: #10b981;"></i> ${a.total_messages_received || 0}</span>
            &nbsp;|&nbsp;
            <span title="Respostas"><i class="fa-solid fa-arrow-up" style="color: #3b82f6;"></i> ${a.total_messages_sent || 0}</span>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-primary" onclick="prepareSocialSimulation(${a.id})" title="Testar Direct desta Conta">
                <i class="fa-solid fa-paper-plane"></i> Testar
              </button>
              <button class="btn btn-sm btn-secondary" onclick="editSocialAccount(${a.id})" title="Editar Conta">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteSocialAccount(${a.id})" title="Remover Conta">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar contas sociais:', err);
  }
}

async function loadSocialStats() {
  try {
    const res = await fetch('/api/social/stats');
    const data = await res.json();
    document.getElementById('socialStatAccounts').innerText = `${data.totalAccounts || 0} contas`;
    document.getElementById('socialStatReceived').innerText = `${data.totalReceived || 0} DMs`;
    document.getElementById('socialStatSent').innerText = `${data.totalSent || 0} disparos`;
    document.getElementById('socialStatLogged').innerText = `${data.totalMessagesLogged || 0} logs`;
  } catch (_) {}
}

async function loadSocialMessages() {
  try {
    const res = await fetch('/api/social/messages?limit=25');
    const messages = await res.json();
    const feed = document.getElementById('socialMessagesFeed');
    if (!feed) return;

    if (messages.length === 0) {
      feed.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhuma mensagem registrada ainda. Envie um teste pelo simulador ao lado!</div>';
      return;
    }

    feed.innerHTML = messages.map(m => {
      const isOut = m.direction === 'OUT';
      const isIg = m.platform === 'instagram';
      const platColor = isIg ? '#e1306c' : '#1877f2';
      const dirBadge = isOut 
        ? '<span style="color: #38bdf8; font-size: 11px; font-weight: bold;"><i class="fa-solid fa-robot"></i> PayBot Respondeu</span>'
        : `<span style="color: ${platColor}; font-size: 11px; font-weight: bold;"><i class="fa-solid fa-user"></i> ${m.sender_name || 'Lead Social'}</span>`;

      return `
        <div style="background: rgba(255,255,255,0.02); border-left: 3px solid ${isOut ? '#38bdf8' : platColor}; border-radius: 6px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            ${dirBadge}
            <small style="color: var(--text-muted); font-size: 10px;">${new Date(m.created_at).toLocaleTimeString()}</small>
          </div>
          <div style="font-size: 12px; color: var(--text-white); white-space: pre-wrap;">${m.message_text}</div>
        </div>
      `;
    }).join('');
  } catch (_) {}
}

function openSocialAccountModal() {
  document.getElementById('formSocialAccount').reset();
  document.getElementById('socialId').value = '';
  document.getElementById('modalSocialTitle').innerHTML = '<i class="fa-brands fa-meta" style="color: #0668e1;"></i> Conectar Nova Conta Social';
  populateSocialCompaniesDropdown();
  onSocialPlatformChange();
  document.getElementById('modalSocialAccount').classList.add('active');
}

function closeSocialAccountModal() {
  document.getElementById('modalSocialAccount').classList.remove('active');
}

function onSocialPlatformChange() {
  const plat = document.getElementById('socialPlatform').value;
  const lblName = document.getElementById('lblSocialName');
  const lblId = document.getElementById('lblSocialAccountId');
  const nameInput = document.getElementById('socialName');
  const idInput = document.getElementById('socialAccountId');

  if (plat === 'instagram') {
    lblName.innerText = 'Handle do Instagram (@username) *';
    nameInput.placeholder = 'Ex: @minhaloja.oficial';
    lblId.innerText = 'Instagram Business Account ID *';
    idInput.placeholder = 'Ex: 17841400000000001';
  } else {
    lblName.innerText = 'Nome da Página do Facebook *';
    nameInput.placeholder = 'Ex: Página Oficial Minha Loja';
    lblId.innerText = 'Facebook Page ID *';
    idInput.placeholder = 'Ex: 109876543210987';
  }
}

async function populateSocialCompaniesDropdown() {
  const select = document.getElementById('socialCompanyId');
  if (!select) return;
  try {
    const res = await fetch('/api/companies');
    const companies = await res.json();
    select.innerHTML = '<option value="">Geral (Sem empresa vinculada)</option>' +
      companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch (_) {}
}

function editSocialAccount(id) {
  const account = currentSocialAccounts.find(a => a.id === id);
  if (!account) return;

  document.getElementById('formSocialAccount').reset();
  document.getElementById('socialId').value = account.id;
  document.getElementById('socialPlatform').value = account.platform;
  document.getElementById('socialName').value = account.name;
  document.getElementById('socialAccountId').value = account.account_id;
  document.getElementById('socialAccessToken').value = account.access_token || '';
  document.getElementById('socialAutoReply').checked = account.auto_reply_enabled === 1;

  populateSocialCompaniesDropdown().then(() => {
    document.getElementById('socialCompanyId').value = account.assigned_company_id || '';
  });

  onSocialPlatformChange();
  document.getElementById('modalSocialTitle').innerHTML = `<i class="fa-brands fa-meta" style="color: #0668e1;"></i> Editar Conta Social #${account.id}`;
  document.getElementById('modalSocialAccount').classList.add('active');
}

async function saveSocialAccount(e) {
  e.preventDefault();
  const id = document.getElementById('socialId').value;
  const platform = document.getElementById('socialPlatform').value;
  const name = document.getElementById('socialName').value.trim();
  const account_id = document.getElementById('socialAccountId').value.trim();
  const access_token = document.getElementById('socialAccessToken').value.trim();
  const auto_reply_enabled = document.getElementById('socialAutoReply').checked ? 1 : 0;
  const assigned_company_id = document.getElementById('socialCompanyId').value;

  const payload = {
    platform,
    name,
    account_id,
    access_token: access_token || null,
    auto_reply_enabled,
    assigned_company_id: assigned_company_id ? parseInt(assigned_company_id, 10) : null
  };

  try {
    const url = id ? `/api/social/accounts/${id}` : '/api/social/accounts';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeSocialAccountModal();
      await loadSocialAccounts();
      loadSocialStats();
    } else {
      const err = await res.json();
      alert('Erro ao salvar conta: ' + (err.error || 'Falha ao salvar'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function toggleSocialAutoReply(id, enabled) {
  try {
    await fetch(`/api/social/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_reply_enabled: enabled })
    });
    loadSocialAccounts();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function deleteSocialAccount(id) {
  if (!confirm('Deseja realmente remover esta conta das redes sociais?')) return;
  try {
    await fetch(`/api/social/accounts/${id}`, { method: 'DELETE' });
    await loadSocialAccounts();
    loadSocialStats();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function prepareSocialSimulation(accountId) {
  const select = document.getElementById('simSocialAccountId');
  if (select) select.value = accountId;
  const input = document.getElementById('simSocialText');
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth' });
  }
}

async function submitSimulateSocialMessage(e) {
  e.preventDefault();
  const accountId = document.getElementById('simSocialAccountId').value;
  const senderName = document.getElementById('simSocialSenderName').value.trim();
  const text = document.getElementById('simSocialText').value.trim();
  const btn = document.getElementById('btnSimulateSocial');
  const resultBox = document.getElementById('simSocialResultBox');
  const resultText = document.getElementById('simSocialResultText');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';

  try {
    const res = await fetch('/api/social/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        senderName,
        text
      })
    });
    const data = await res.json();
    if (res.ok && data.replyText) {
      resultText.innerText = data.replyText;
      resultBox.style.display = 'block';
      loadSocialAccounts();
      loadSocialStats();
      loadSocialMessages();
    } else {
      alert('Erro na simulação: ' + (data.error || 'Sem resposta gerada'));
    }
  } catch (err) {
    alert('Erro ao simular direct: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Enviar Mensagem de Teste';
  }
}

function copySocialWebhookUrl() {
  const url = window.location.origin + '/api/social/webhook';
  navigator.clipboard.writeText(url).then(() => {
    alert('URL do Webhook copiada: ' + url);
  });
}

function copySocialVerifyToken() {
  navigator.clipboard.writeText('paybot_meta_token_2026').then(() => {
    alert('Token de Verificação copiado: paybot_meta_token_2026');
  });
}

// ====================================================================
// CONTROLE GLOBAL DE MODAIS (FECHAR COM ESC OU CLICANDO NO BACKDROP)
// ====================================================================
const globalModalDismissMap = {
  modalProduct: closeProductModal,
  modalSeller: closeSellerModal,
  modalAffiliate: closeAffiliateModal,
  modalAffiliateLinks: closeLinksModal,
  modalCompany: closeCompanyModal,
  modalRequestAffiliation: closeRequestAffiliationModal,
  modalPayCommission: closePayCommissionModal,
  modalCoupon: closeCouponModal,
  modalArmyInstance: closeArmyInstanceModal,
  modalArmyQr: closeArmyQrModal,
  modalAffiliateLink: closeAffiliateLinkModal,
  modalCampaign: closeCampaignModal,
  modalCampaignLeads: closeCampaignLeadsModal,
  modalFunnelStages: closeFunnelStagesModal,
  modalLeadsByStage: closeLeadsByStageModal,
  modalLeadConversation: closeLeadConversationModal,
  modalSocialAccount: closeSocialAccountModal
};

function dismissActiveModal(modalEl) {
  if (!modalEl) return;
  if (globalModalDismissMap[modalEl.id]) {
    globalModalDismissMap[modalEl.id]();
  } else {
    modalEl.classList.remove('active');
  }
}

// Fechar modal ao clicar fora (backdrop escuro)
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('modal') && e.target.classList.contains('active')) {
    dismissActiveModal(e.target);
  }
});

// Fechar modal ao pressionar a tecla ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    const activeModal = document.querySelector('.modal.active');
    if (activeModal) {
      dismissActiveModal(activeModal);
    }
  }
});

// ==========================================
// 17. PROCESSAMENTO DE LINGUAGEM NATURAL (NLP PT-BR)
// ==========================================
function setNlpExample(text) {
  const input = document.getElementById('nlpTestInput');
  if (input) {
    input.value = text;
    runNlpTest();
  }
}

async function runNlpTest() {
  const input = document.getElementById('nlpTestInput');
  const customerName = document.getElementById('nlpTestCustomerName')?.value || 'Carlos Eduardo';
  const platform = document.getElementById('nlpTestPlatform')?.value || 'whatsapp';
  const text = input ? input.value.trim() : '';

  if (!text) {
    alert('Por favor, digite uma mensagem ou selecione um dos exemplos acima para testar.');
    return;
  }

  const resultCard = document.getElementById('nlpResultCard');
  if (resultCard) resultCard.style.display = 'block';

  try {
    const res = await fetch('/api/nlp/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, customerName, platform })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na análise NLU');

    const intentEl = document.getElementById('nlpResultIntent');
    const confEl = document.getElementById('nlpResultConfidence');
    const actionEl = document.getElementById('nlpResultAction');
    const prodEl = document.getElementById('nlpResultProduct');
    const normEl = document.getElementById('nlpResultNormalized');
    const replyEl = document.getElementById('nlpResultReplyBox');

    if (intentEl) intentEl.innerText = data.intent;
    if (confEl) confEl.innerText = `${Math.round((data.confidence || 0) * 100)}%`;
    if (actionEl) actionEl.innerText = data.directAction || 'Nenhuma (Resposta Conversacional)';
    if (prodEl) {
      if (data.entities?.matchedProduct) {
        prodEl.innerText = `${data.entities.matchedProduct.name} (R$ ${Number(data.entities.matchedProduct.price_brl || data.entities.matchedProduct.price).toFixed(2)})`;
      } else {
        prodEl.innerText = 'Nenhum identificado especificamente';
      }
    }
    if (normEl) normEl.innerText = `"${data.normalized}"`;
    if (replyEl) replyEl.innerText = data.replyText || 'Sem resposta gerada.';

  } catch (err) {
    alert('Erro ao testar NLU: ' + err.message);
  }
}

async function loadNlpData() {
  try {
    const res = await fetch('/api/nlp/info');
    if (!res.ok) return;
    const data = await res.json();

    const tbody = document.getElementById('nlpSlangTableBody');
    if (tbody && data.dictionary) {
      const entries = Object.entries(data.dictionary);
      let html = '';
      entries.forEach(([slang, meaning]) => {
        html += `<tr><td><code>${slang}</code></td><td>${meaning}</td></tr>`;
      });
      tbody.innerHTML = html;
    }
    loadCustomTriggers();
  } catch (_) {}
}

// ==========================================
// 18. MODERAÇÃO & CONTROLE DE CHATS (MUTE & BLOQUEIOS)
// ==========================================
let currentChatControls = [];

async function loadChatControls() {
  try {
    const res = await fetch('/api/controls');
    if (!res.ok) return;
    const controls = await res.json();
    currentChatControls = controls;

    const tbody = document.getElementById('tableChatControlsBody');
    if (!tbody) return;

    let mutedPriv = 0;
    let mutedGrp = 0;
    let blockedUsr = 0;

    controls.forEach(c => {
      if (c.control_type === 'MUTE_CHAT') {
        if (c.target_type === 'GROUP') mutedGrp++;
        else mutedPriv++;
      } else if (c.control_type === 'BLOCK_USER') {
        blockedUsr++;
      }
    });

    const elPriv = document.getElementById('statMutedPrivate');
    const elGrp = document.getElementById('statMutedGroups');
    const elBlk = document.getElementById('statBlockedUsers');
    if (elPriv) elPriv.innerText = mutedPriv;
    if (elGrp) elGrp.innerText = mutedGrp;
    if (elBlk) elBlk.innerText = blockedUsr;

    if (controls.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px; color: var(--text-muted);">Nenhuma restrição ativa. Todos os chats e usuários estão liberados.</td></tr>';
      return;
    }

    let html = '';
    controls.forEach(c => {
      const isWpp = c.platform === 'whatsapp';
      const platBadge = isWpp 
        ? '<span class="badge" style="background:#25d366; color:#0f172a;"><i class="fa-brands fa-whatsapp"></i> WhatsApp</span>' 
        : '<span class="badge" style="background:#229ed9; color:#fff;"><i class="fa-brands fa-telegram"></i> Telegram</span>';

      let typeBadge = '';
      if (c.control_type === 'MUTE_CHAT') {
        typeBadge = c.target_type === 'GROUP' 
          ? '<span class="badge" style="background:#f59e0b; color:#12161f; font-weight:600;"><i class="fa-solid fa-users-slash"></i> Grupo Pausado</span>' 
          : '<span class="badge" style="background:#64748b; color:#fff;"><i class="fa-solid fa-comment-slash"></i> Chat Privado Pausado</span>';
      } else {
        typeBadge = '<span class="badge" style="background:#ef4444; color:#fff; font-weight:600;"><i class="fa-solid fa-user-lock"></i> Participante Bloqueado</span>';
      }

      const targetIdentifier = c.user_id ? `<b>${c.user_id}</b>${c.chat_id && c.chat_id !== '*' ? ` <small class="text-muted">(em ${c.chat_id})</small>` : ''}` : `<code>${c.chat_id}</code>`;
      const nameText = c.user_name ? `<br><small class="text-muted">${c.user_name}</small>` : '';
      const dateFormatted = c.created_at ? new Date(c.created_at).toLocaleString('pt-BR') : '-';

      html += `
        <tr>
          <td>${platBadge}</td>
          <td>${typeBadge}</td>
          <td>${targetIdentifier}${nameText}</td>
          <td>${c.reason || 'Sem motivo informado'}</td>
          <td><span class="badge-mini">${c.created_by || 'admin'}</span></td>
          <td style="font-size: 11px;">${dateFormatted}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-success" onclick="unmuteOrUnblockControl(${c.id}, '${c.platform}', '${c.control_type}', '${c.chat_id}', '${c.user_id || ''}')" title="Reativar bot ou desbloquear participante">
              <i class="fa-solid fa-unlock"></i> Liberar
            </button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (err) {
    console.error('Erro ao carregar moderação:', err.message);
  }
}

function openChatControlModal() {
  const modal = document.getElementById('modalChatControl');
  if (modal) {
    modal.classList.add('active');
    onControlTypeChange();
  }
}

function closeChatControlModal() {
  const modal = document.getElementById('modalChatControl');
  if (modal) modal.classList.remove('active');
}

function onControlPlatformChange() {
  onControlTypeChange();
}

function onControlTypeChange() {
  const type = document.getElementById('controlType')?.value || 'MUTE_PRIVATE';
  const platform = document.getElementById('controlPlatform')?.value || 'whatsapp';
  const lbl = document.getElementById('lblControlTarget');
  const input = document.getElementById('controlTargetId');
  const groupChatId = document.getElementById('groupControlChatId');

  if (type === 'MUTE_PRIVATE') {
    if (lbl) lbl.innerText = platform === 'whatsapp' ? 'Número do WhatsApp com DDD (ex: 5511999998888) *' : 'Chat ID do Telegram (ex: 123456789) *';
    if (input) input.placeholder = platform === 'whatsapp' ? '5511999998888' : '123456789';
    if (groupChatId) groupChatId.style.display = 'none';
  } else if (type === 'MUTE_GROUP') {
    if (lbl) lbl.innerText = platform === 'whatsapp' ? 'JID do Grupo do WhatsApp (ex: 120363028123456789@g.us) *' : 'Chat ID do Grupo Telegram (ex: -100123456789) *';
    if (input) input.placeholder = platform === 'whatsapp' ? '120363028123456789@g.us' : '-100123456789';
    if (groupChatId) groupChatId.style.display = 'none';
  } else if (type === 'BLOCK_USER') {
    if (lbl) lbl.innerText = platform === 'whatsapp' ? 'Número do Participante a Bloquear (ex: 5511999998888) *' : 'ID do Usuário a Bloquear (ex: 123456789) *';
    if (input) input.placeholder = platform === 'whatsapp' ? '5511999998888' : '123456789';
    if (groupChatId) groupChatId.style.display = 'block';
  } else if (type === 'BLOCK_GLOBAL') {
    if (lbl) lbl.innerText = platform === 'whatsapp' ? 'Número do Usuário para Bloqueio Global (ex: 5511999998888) *' : 'ID do Usuário para Bloqueio Global (ex: 123456789) *';
    if (input) input.placeholder = platform === 'whatsapp' ? '5511999998888' : '123456789';
    if (groupChatId) groupChatId.style.display = 'none';
  }
}

async function saveChatControl(e) {
  e.preventDefault();
  const platform = document.getElementById('controlPlatform').value;
  const type = document.getElementById('controlType').value;
  const targetId = document.getElementById('controlTargetId').value.trim();
  const specificChatId = document.getElementById('controlChatId')?.value?.trim() || null;
  const userName = document.getElementById('controlUserName')?.value?.trim() || null;
  const reason = document.getElementById('controlReason')?.value?.trim() || 'Moderação via painel admin';

  if (!targetId) {
    alert('Por favor, informe o identificador.');
    return;
  }

  try {
    let endpoint = '';
    let body = {};

    if (type === 'MUTE_PRIVATE' || type === 'MUTE_GROUP') {
      endpoint = '/api/controls/mute';
      body = {
        platform,
        chatId: targetId,
        targetType: type === 'MUTE_GROUP' ? 'GROUP' : 'PRIVATE',
        userName,
        reason
      };
    } else {
      endpoint = '/api/controls/block';
      body = {
        platform,
        userId: targetId,
        chatId: type === 'BLOCK_USER' ? specificChatId : '*',
        targetType: 'USER',
        userName,
        reason
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar controle');

    closeChatControlModal();
    document.getElementById('formChatControl').reset();
    loadChatControls();
  } catch (err) {
    alert('Erro ao aplicar moderação: ' + err.message);
  }
}

async function unmuteOrUnblockControl(id, platform, controlType, chatId, userId) {
  if (!confirm('Deseja realmente liberar este chat / participante para voltar a usar o bot?')) return;

  try {
    let res = null;
    if (controlType === 'MUTE_CHAT') {
      res = await fetch('/api/controls/unmute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, chatId })
      });
    } else {
      res = await fetch('/api/controls/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, userId, chatId })
      });
    }

    if (!res.ok) {
      await fetch(`/api/controls/${id}`, { method: 'DELETE' });
    }

    loadChatControls();
  } catch (err) {
    alert('Erro ao liberar: ' + err.message);
  }
}

// ==========================================
// GESTÃO DE GRUPOS & AUDITORIA (FRONTEND)
// ==========================================
async function loadGroupAuditLogs() {
  const tbody = document.getElementById('tableGroupAuditLogsBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/groups/audit-logs?limit=30');
    if (!res.ok) return;
    const logs = await res.json();

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 15px; color: var(--text-muted);">Nenhum comando de administração de grupos registrado ainda.</td></tr>';
      return;
    }

    let html = '';
    logs.forEach(l => {
      const isWpp = l.platform === 'whatsapp';
      const platBadge = isWpp
        ? '<span class="badge" style="background:#25d366; color:#0f172a; font-size:11px;"><i class="fa-brands fa-whatsapp"></i> WhatsApp</span>'
        : '<span class="badge" style="background:#229ed9; color:#fff; font-size:11px;"><i class="fa-brands fa-telegram"></i> Telegram</span>';

      let actionBadge = '';
      switch (l.action) {
        case 'BAN':
        case 'KICK':
          actionBadge = '<span class="badge" style="background:#ef4444; color:#fff;">Expulsão (Ban)</span>';
          break;
        case 'PROMOTE':
          actionBadge = '<span class="badge" style="background:#10b981; color:#fff;">Promover Admin</span>';
          break;
        case 'DEMOTE':
          actionBadge = '<span class="badge" style="background:#f59e0b; color:#12161f;">Rebaixar Admin</span>';
          break;
        case 'LOCK':
          actionBadge = '<span class="badge" style="background:#6366f1; color:#fff;">Trancar Grupo</span>';
          break;
        case 'UNLOCK':
          actionBadge = '<span class="badge" style="background:#06b6d4; color:#fff;">Abrir Grupo</span>';
          break;
        case 'RENAME':
          actionBadge = '<span class="badge" style="background:#8b5cf6; color:#fff;">Mudar Nome</span>';
          break;
        case 'SET_DESC':
          actionBadge = '<span class="badge" style="background:#8b5cf6; color:#fff;">Mudar Regras</span>';
          break;
        case 'REVOKE_LINK':
          actionBadge = '<span class="badge" style="background:#ec4899; color:#fff;">Resetar Link</span>';
          break;
        case 'TAG_ALL':
          actionBadge = '<span class="badge" style="background:#eab308; color:#12161f;">Marcar Todos</span>';
          break;
        case 'ANTILINK_ON':
        case 'ANTILINK_OFF':
        case 'ANTILINK_TRIGGER':
          actionBadge = '<span class="badge" style="background:#f43f5e; color:#fff;">Anti-Link</span>';
          break;
        case 'WELCOME_ON':
        case 'WELCOME_OFF':
        case 'WELCOME_MSG':
          actionBadge = '<span class="badge" style="background:#14b8a6; color:#fff;">Boas-Vindas</span>';
          break;
        default:
          actionBadge = `<span class="badge" style="background:#64748b; color:#fff;">${l.action}</span>`;
      }

      const dateStr = l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : '-';
      const groupDisp = l.group_name ? `<b>${l.group_name}</b><br><small class="text-muted">${l.group_id}</small>` : `<code>${l.group_id}</code>`;
      const adminDisp = l.admin_name ? `${l.admin_name} <small class="text-muted">(${l.admin_id})</small>` : `<b>${l.admin_id}</b>`;
      const targetDisp = l.target_id ? `<code>${l.target_id}</code>` : '-';

      html += `
        <tr>
          <td style="font-size: 11px;">${dateStr}</td>
          <td>${platBadge}</td>
          <td>${groupDisp}</td>
          <td>${adminDisp}</td>
          <td>${actionBadge}</td>
          <td>${targetDisp}</td>
          <td style="max-width: 250px; font-size: 11px;">${l.details || '-'}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (err) {
    console.error('Erro ao carregar logs de grupos:', err.message);
  }
}

async function clearGroupLogs() {
  if (!confirm('Deseja realmente limpar todos os logs de auditoria dos grupos?')) return;
  try {
    await fetch('/api/groups/audit-logs', { method: 'DELETE' });
    loadGroupAuditLogs();
  } catch (err) {
    alert('Erro ao limpar logs: ' + err.message);
  }
}

function openGroupSettingsModal() {
  const m = document.getElementById('modalGroupSettings');
  if (m) {
    m.classList.add('active');
  }
}

function closeGroupSettingsModal() {
  const m = document.getElementById('modalGroupSettings');
  if (m) m.classList.remove('active');
}

async function fetchGroupSettings() {
  const groupId = document.getElementById('groupSettingsId')?.value?.trim();
  const platform = document.getElementById('groupPlatform')?.value || 'whatsapp';
  if (!groupId) return;

  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/settings?platform=${platform}`);
    if (!res.ok) return;
    const data = await res.json();
    const chkAnti = document.getElementById('chkGroupAntilink');
    const chkWel = document.getElementById('chkGroupWelcome');
    const txtMsg = document.getElementById('txtGroupWelcomeMsg');
    const chkFake = document.getElementById('chkGroupAntifake');
    const chkDel = document.getElementById('chkGroupAntidelete');
    const chkView = document.getElementById('chkGroupAntiviewonce');
    const chkBye = document.getElementById('chkGroupBye');
    const txtBye = document.getElementById('txtGroupByeMsg');

    if (chkAnti) chkAnti.checked = !!data.antilink;
    if (chkWel) chkWel.checked = !!data.welcome;
    if (txtMsg) txtMsg.value = data.welcomeMsg || '';
    if (chkFake) chkFake.checked = !!data.antifake;
    if (chkDel) chkDel.checked = !!data.antidelete;
    if (chkView) chkView.checked = data.antiviewonce !== false;
    if (chkBye) chkBye.checked = !!data.bye;
    if (txtBye) txtBye.value = data.byeMsg || '';
  } catch (_) {}
}

async function saveGroupSettings(e) {
  e.preventDefault();
  const groupId = document.getElementById('groupSettingsId')?.value?.trim();
  const platform = document.getElementById('groupPlatform')?.value || 'whatsapp';
  const antilink = document.getElementById('chkGroupAntilink')?.checked;
  const welcome = document.getElementById('chkGroupWelcome')?.checked;
  const welcomeMsg = document.getElementById('txtGroupWelcomeMsg')?.value?.trim();
  const antifake = document.getElementById('chkGroupAntifake')?.checked;
  const antidelete = document.getElementById('chkGroupAntidelete')?.checked;
  const antiviewonce = document.getElementById('chkGroupAntiviewonce')?.checked;
  const bye = document.getElementById('chkGroupBye')?.checked;
  const byeMsg = document.getElementById('txtGroupByeMsg')?.value?.trim();

  if (!groupId) {
    return alert('Informe o ID do Grupo.');
  }

  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        antilink,
        welcome,
        welcomeMsg,
        antifake,
        antidelete,
        antiviewonce,
        bye,
        byeMsg
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar configurações do grupo.');

    alert('Configurações do grupo salvas com sucesso!');
    closeGroupSettingsModal();
    loadGroupAuditLogs();
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
}

// ==========================================
// MÉTRICAS POR CANAL (WHATSAPP, TELEGRAM, INSTAGRAM, FACEBOOK)
// ==========================================
async function loadChannelMetrics() {
  try {
    const res = await fetch('/api/metrics/channels');
    if (!res.ok) return;
    const data = await res.json();

    // WhatsApp
    const wpp = data.whatsapp || {};
    if (document.getElementById('chWppOrders')) document.getElementById('chWppOrders').innerText = `${wpp.ordersCount || 0} vendas`;
    if (document.getElementById('chWppRev')) document.getElementById('chWppRev').innerText = `R$ ${(wpp.revenueBRL || 0).toFixed(2)}`;
    if (document.getElementById('chWppUsdt')) document.getElementById('chWppUsdt').innerText = `${(wpp.revenueUSDT || 0).toFixed(2)} USDT`;
    if (document.getElementById('chWppSubs')) document.getElementById('chWppSubs').innerText = wpp.activeSubscriptions || 0;

    // Telegram
    const tg = data.telegram || {};
    if (document.getElementById('chTgOrders')) document.getElementById('chTgOrders').innerText = `${tg.ordersCount || 0} vendas`;
    if (document.getElementById('chTgRev')) document.getElementById('chTgRev').innerText = `R$ ${(tg.revenueBRL || 0).toFixed(2)}`;
    if (document.getElementById('chTgUsdt')) document.getElementById('chTgUsdt').innerText = `${(tg.revenueUSDT || 0).toFixed(2)} USDT`;
    if (document.getElementById('chTgSubs')) document.getElementById('chTgSubs').innerText = tg.activeSubscriptions || 0;

    // Instagram
    const ig = data.instagram || {};
    if (document.getElementById('chIgOrders')) document.getElementById('chIgOrders').innerText = `${ig.ordersCount || 0} vendas`;
    if (document.getElementById('chIgRev')) document.getElementById('chIgRev').innerText = `R$ ${(ig.revenueBRL || 0).toFixed(2)}`;

    // Facebook
    const fb = data.facebook || {};
    if (document.getElementById('chFbOrders')) document.getElementById('chFbOrders').innerText = `${fb.ordersCount || 0} vendas`;
    if (document.getElementById('chFbRev')) document.getElementById('chFbRev').innerText = `R$ ${(fb.revenueBRL || 0).toFixed(2)}`;
  } catch (_) {}
}

// ==========================================
// CHAMADOS DE SUPORTE & TRANSBORDO HUMANO
// ==========================================
async function loadSupportTickets() {
  const tbody = document.getElementById('tableSupportTicketsBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/tickets?limit=20');
    if (!res.ok) return;
    const tickets = await res.json();

    if (!tickets || tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 15px; color: var(--text-muted);">Nenhum chamado aberto. Todos os clientes atendidos com sucesso!</td></tr>';
      return;
    }

    let html = '';
    tickets.forEach(t => {
      const isWpp = t.platform === 'whatsapp';
      const platBadge = isWpp 
        ? '<span class="badge" style="background:#25d366; color:#0f172a; font-size:11px;"><i class="fa-brands fa-whatsapp"></i> WhatsApp</span>' 
        : '<span class="badge" style="background:#229ed9; color:#fff; font-size:11px;"><i class="fa-brands fa-telegram"></i> Telegram</span>';

      let statusBadge = '';
      if (t.status === 'OPEN') statusBadge = '<span class="badge" style="background:#ef4444; color:#fff;">Aberto</span>';
      else if (t.status === 'IN_PROGRESS') statusBadge = '<span class="badge" style="background:#f59e0b; color:#12161f;">Em Atendimento</span>';
      else if (t.status === 'RESOLVED') statusBadge = '<span class="badge" style="background:#10b981; color:#fff;">Resolvido</span>';
      else statusBadge = `<span class="badge">${t.status}</span>`;

      const cleanPhone = (t.customer_id || '').replace(/[^0-9]/g, '');
      const waLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
      const waBtn = waLink 
        ? `<a href="${waLink}" target="_blank" class="btn btn-sm btn-outline" style="color:#25d366; border-color:#25d366;" title="Conversar no WhatsApp"><i class="fa-brands fa-whatsapp"></i> Chamar</a>` 
        : '';

      const resolveBtn = t.status !== 'RESOLVED'
        ? `<button class="btn btn-sm btn-success" onclick="resolveSupportTicket(${t.id})" title="Marcar como resolvido"><i class="fa-solid fa-check"></i></button>`
        : '';

      html += `
        <tr>
          <td><b>#${t.id}</b></td>
          <td>${platBadge}</td>
          <td><b>${t.customer_name || 'Cliente'}</b><br><small class="text-muted">${t.customer_id}</small></td>
          <td>${t.seller_name ? `<span class="badge-mini" style="background:rgba(59,130,246,0.15); color:#60a5fa;">${t.seller_name}</span>` : '<span class="text-muted">Aguardando</span>'}</td>
          <td style="max-width: 250px; font-size: 11px;">${t.issue_summary || '-'}</td>
          <td>${statusBadge}</td>
          <td class="text-right" style="white-space: nowrap;">
            ${waBtn}
            ${resolveBtn}
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (_) {}
}

async function resolveSupportTicket(id) {
  try {
    const res = await fetch(`/api/tickets/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED' })
    });
    if (res.ok) {
      loadSupportTickets();
    }
  } catch (err) {
    alert('Erro ao resolver chamado: ' + err.message);
  }
}

// ==========================================
// CENTRAL DE TRIGGERS INTELIGENTES & FAQ
// ==========================================
let allCustomTriggers = [];

async function loadCustomTriggers() {
  const tbody = document.getElementById('tableCustomTriggersBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/triggers');
    if (!res.ok) return;
    const triggers = await res.json();
    allCustomTriggers = triggers;

    if (!triggers || triggers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 15px; color: var(--text-muted);">Nenhum trigger inteligente cadastrado ainda.</td></tr>';
      return;
    }

    let html = '';
    triggers.forEach(tr => {
      const isAct = tr.active === 1;
      const statusBadge = isAct 
        ? '<span class="badge badge-paid">Ativo</span>' 
        : '<span class="badge badge-expired">Pausado</span>';

      let typeBadge = '';
      if (tr.match_type === 'CONTAINS') typeBadge = '<span class="badge" style="background:#3b82f6; color:#fff;">Contém</span>';
      else if (tr.match_type === 'EXACT') typeBadge = '<span class="badge" style="background:#8b5cf6; color:#fff;">Exata</span>';
      else typeBadge = '<span class="badge" style="background:#ec4899; color:#fff;">Regex</span>';

      html += `
        <tr>
          <td><b>${tr.keyword}</b></td>
          <td>${typeBadge}</td>
          <td><span class="badge-mini">${tr.category || 'Geral'}</span></td>
          <td><span class="badge-mini">${tr.platform === 'all' ? 'Todos' : tr.platform}</span></td>
          <td style="max-width: 250px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${tr.response_text}">${tr.response_text}</td>
          <td><b style="color:#f59e0b;">${tr.usage_count || 0}</b></td>
          <td>${statusBadge}</td>
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="openTriggerModal(${tr.id})" title="Editar Trigger"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-outline" onclick="toggleTriggerActive(${tr.id}, ${isAct ? 0 : 1})" title="${isAct ? 'Pausar' : 'Ativar'}"><i class="fa-solid ${isAct ? 'fa-pause' : 'fa-play'}"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteCustomTrigger(${tr.id})" title="Excluir"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (_) {}
}

function openTriggerModal(id = null) {
  const m = document.getElementById('modalCustomTrigger');
  if (!m) return;
  m.classList.add('active');

  const form = document.getElementById('formCustomTrigger');
  if (form) form.reset();

  if (id) {
    const tr = allCustomTriggers.find(t => t.id === id);
    if (tr) {
      document.getElementById('modalTriggerTitle').innerHTML = '<i class="fa-solid fa-pen" style="color: #38bdf8;"></i> Editar Trigger Inteligente';
      document.getElementById('trigId').value = tr.id;
      document.getElementById('trigKeyword').value = tr.keyword;
      document.getElementById('trigMatchType').value = tr.match_type || 'CONTAINS';
      document.getElementById('trigCategory').value = tr.category || '';
      document.getElementById('trigPlatform').value = tr.platform || 'all';
      document.getElementById('trigResponseText').value = tr.response_text;
      document.getElementById('trigActive').checked = tr.active === 1;
      return;
    }
  }

  document.getElementById('modalTriggerTitle').innerHTML = '<i class="fa-solid fa-bolt" style="color: #38bdf8;"></i> Novo Trigger Inteligente';
  document.getElementById('trigId').value = '';
  document.getElementById('trigActive').checked = true;
}

function closeTriggerModal() {
  const m = document.getElementById('modalCustomTrigger');
  if (m) m.classList.remove('active');
}

async function saveCustomTrigger(e) {
  e.preventDefault();
  const id = document.getElementById('trigId')?.value;
  const keyword = document.getElementById('trigKeyword')?.value?.trim();
  const matchType = document.getElementById('trigMatchType')?.value;
  const category = document.getElementById('trigCategory')?.value?.trim();
  const platform = document.getElementById('trigPlatform')?.value;
  const responseText = document.getElementById('trigResponseText')?.value?.trim();
  const active = document.getElementById('trigActive')?.checked ? 1 : 0;

  if (!keyword || !responseText) {
    return alert('Preencha a palavra-chave e o texto de resposta.');
  }

  const payload = { keyword, matchType, category, platform, responseText, active };
  try {
    let res = null;
    if (id) {
      res = await fetch(`/api/triggers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar trigger.');

    closeTriggerModal();
    loadCustomTriggers();
  } catch (err) {
    alert('Erro ao salvar trigger: ' + err.message);
  }
}

async function toggleTriggerActive(id, newActive) {
  try {
    const res = await fetch(`/api/triggers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: newActive })
    });
    if (res.ok) {
      loadCustomTriggers();
    }
  } catch (err) {
    alert('Erro ao alterar status: ' + err.message);
  }
}

async function deleteCustomTrigger(id) {
  if (!confirm('Deseja realmente excluir este trigger inteligente?')) return;
  try {
    const res = await fetch(`/api/triggers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadCustomTriggers();
    }
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}


// ==========================================
// FACILIDADES DE USO: BUSCA GLOBAL & ATALHOS RÁPIDOS
// ==========================================
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openGlobalSearchModal();
  }
  if (e.key === 'Escape') {
    closeGlobalSearchModal();
    closeQuickChargeModal();
    closeLinkBuilderModal();
  }
});

function openGlobalSearchModal() {
  const m = document.getElementById('modalGlobalSearch');
  if (m) {
    m.classList.add('active');
    setTimeout(() => {
      const inp = document.getElementById('modalSearchField');
      if (inp) inp.focus();
    }, 50);
  }
}

function closeGlobalSearchModal() {
  const m = document.getElementById('modalGlobalSearch');
  if (m) m.classList.remove('active');
}

let searchDebounceTimer = null;
function onGlobalSearch(query) {
  clearTimeout(searchDebounceTimer);
  const container = document.getElementById('globalSearchResults');
  if (!container) return;

  const cleanQ = (query || '').trim();
  if (!cleanQ) {
    container.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">Digite um termo acima para buscar em pedidos, produtos, clientes e afiliados.</div>';
    return;
  }

  container.innerHTML = '<div style="padding: 20px; text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Pesquisando...</div>';

  searchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(cleanQ)}`);
      if (!res.ok) return;
      const data = await res.json();

      let html = '';
      let hasResults = false;

      // Pedidos
      if (data.orders && data.orders.length > 0) {
        hasResults = true;
        html += `<div style="margin-bottom: 15px;"><b style="font-size: 11px; text-transform: uppercase; color: #38bdf8;">📦 Pedidos Encontrados (${data.orders.length})</b>`;
        data.orders.forEach(o => {
          html += `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <b>#${o.trade_no}</b> — ${o.product_name}<br>
                <small class="text-muted">${o.platform_user_name || 'Cliente'} (${o.platform}) • ${new Date(o.created_at).toLocaleDateString('pt-BR')}</small>
              </div>
              <div style="text-align: right;">
                <b>${o.currency === 'BRL' ? 'R$ ' + o.amount.toFixed(2) : o.amount.toFixed(2) + ' USDT'}</b><br>
                <span class="badge ${o.status === 'PAID' ? 'badge-paid' : 'badge-expired'}">${o.status}</span>
              </div>
            </div>
          `;
        });
        html += `</div>`;
      }

      // Produtos
      if (data.products && data.products.length > 0) {
        hasResults = true;
        html += `<div style="margin-bottom: 15px;"><b style="font-size: 11px; text-transform: uppercase; color: #10b981;">🛍️ Produtos & Assinaturas (${data.products.length})</b>`;
        data.products.forEach(p => {
          html += `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <b>${p.name}</b> <small class="text-muted">(${p.category || 'Geral'})</small>
              </div>
              <div>
                <b style="color: #10b981;">R$ ${(p.price_brl || 0).toFixed(2)}</b> / <b style="color: #f59e0b;">${(p.price_usdt || 0).toFixed(2)} USDT</b>
              </div>
            </div>
          `;
        });
        html += `</div>`;
      }

      // Vendedores
      if (data.sellers && data.sellers.length > 0) {
        hasResults = true;
        html += `<div style="margin-bottom: 15px;"><b style="font-size: 11px; text-transform: uppercase; color: #f59e0b;">👔 Vendedores (${data.sellers.length})</b>`;
        data.sellers.forEach(s => {
          html += `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <b>${s.name}</b> <small class="text-muted">${s.phone || '-'}</small>
              </div>
              <span class="badge ${s.active ? 'badge-paid' : 'badge-expired'}">${s.active ? 'Ativo' : 'Pausado'}</span>
            </div>
          `;
        });
        html += `</div>`;
      }

      // Afiliados
      if (data.affiliates && data.affiliates.length > 0) {
        hasResults = true;
        html += `<div style="margin-bottom: 15px;"><b style="font-size: 11px; text-transform: uppercase; color: #ec4899;">🤝 Afiliados (${data.affiliates.length})</b>`;
        data.affiliates.forEach(a => {
          html += `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <b>${a.name}</b> — Código: <code>${a.ref_code}</code>
              </div>
              <span class="badge ${a.status === 'ACTIVE' ? 'badge-paid' : 'badge-expired'}">${a.status}</span>
            </div>
          `;
        });
        html += `</div>`;
      }

      // Chamados de Suporte
      if (data.tickets && data.tickets.length > 0) {
        hasResults = true;
        html += `<div style="margin-bottom: 15px;"><b style="font-size: 11px; text-transform: uppercase; color: #ef4444;">🛎️ Chamados de Atendimento (${data.tickets.length})</b>`;
        data.tickets.forEach(t => {
          html += `
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <b>#${t.id} - ${t.customer_name || 'Cliente'}</b> <small class="text-muted">(${t.platform})</small><br>
                <small>${t.issue_summary || '-'}</small>
              </div>
              <span class="badge ${t.status === 'RESOLVED' ? 'badge-paid' : 'badge-expired'}">${t.status}</span>
            </div>
          `;
        });
        html += `</div>`;
      }

      if (!hasResults) {
        html = `<div style="padding: 25px; text-align: center; color: var(--text-muted);">Nenhum resultado encontrado para "<b>${cleanQ}</b>".</div>`;
      }

      container.innerHTML = html;
    } catch (_) {}
  }, 250);
}

// ==========================================
// COBRANÇA RÁPIDA (PIX & CRIPTO)
// ==========================================
function openQuickChargeModal() {
  const m = document.getElementById('modalQuickCharge');
  if (!m) return;
  m.classList.add('active');

  // Popula produtos
  const sel = document.getElementById('quickChargeProduct');
  if (sel) {
    const products = allProducts || [];
    let opts = '';
    products.forEach(p => {
      opts += `<option value="${p.id}">${p.name} — R$ ${(p.price_brl || p.price).toFixed(2)} (${(p.price_usdt || (p.price / 5.5)).toFixed(2)} USDT)</option>`;
    });
    sel.innerHTML = opts;
  }

  document.getElementById('quickChargeResult').style.display = 'none';
  document.getElementById('btnGenerateQuickCharge').disabled = false;
  document.getElementById('btnGenerateQuickCharge').innerHTML = '<i class="fa-solid fa-bolt"></i> Gerar Cobrança Agora';
}

function closeQuickChargeModal() {
  const m = document.getElementById('modalQuickCharge');
  if (m) m.classList.remove('active');
}

async function generateQuickCharge(e) {
  e.preventDefault();
  const productId = document.getElementById('quickChargeProduct')?.value;
  const gateway = document.getElementById('quickChargeGateway')?.value;
  const customerName = document.getElementById('quickChargeCustomer')?.value?.trim() || 'Cliente Rápido';

  if (!productId) return alert('Selecione um produto.');

  const btn = document.getElementById('btnGenerateQuickCharge');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';

  try {
    const res = await fetch('/api/quick-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, gateway, customerName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao gerar cobrança rápida.');

    const resBox = document.getElementById('quickChargeResult');
    resBox.style.display = 'block';

    document.getElementById('quickChargeTradeNo').innerText = `#${data.tradeNo}`;
    document.getElementById('quickChargeAmountBadge').innerText = data.currency === 'BRL' ? `R$ ${data.amount.toFixed(2)}` : `${data.amount.toFixed(2)} USDT`;

    if (gateway === 'pix') {
      document.getElementById('quickPixContainer').style.display = 'block';
      document.getElementById('quickBinanceContainer').style.display = 'none';
      document.getElementById('quickPixCode').value = data.pixCode || 'PIX_SIMULADO';
    } else {
      document.getElementById('quickPixContainer').style.display = 'none';
      document.getElementById('quickBinanceContainer').style.display = 'block';
      document.getElementById('quickBinanceUrl').value = data.checkoutUrl || 'https://pay.binance.com/checkout';
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Cobrança Gerada!';
    loadOrders();
  } catch (err) {
    alert('Erro: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Tentar Novamente';
  }
}

// ==========================================
// GERADOR DE LINKS DE VENDA DIRETA
// ==========================================
function openLinkBuilderModal() {
  const m = document.getElementById('modalLinkBuilder');
  if (!m) return;
  m.classList.add('active');

  const sel = document.getElementById('linkProduct');
  if (sel) {
    const products = allProducts || [];
    let opts = '';
    products.forEach(p => {
      opts += `<option value="${p.id}" data-name="${p.name}">${p.name} — R$ ${(p.price_brl || p.price).toFixed(2)}</option>`;
    });
    sel.innerHTML = opts;
  }
  buildDirectLinks();
}

function closeLinkBuilderModal() {
  const m = document.getElementById('modalLinkBuilder');
  if (m) m.classList.remove('active');
}

function buildDirectLinks() {
  const prodSel = document.getElementById('linkProduct');
  const prodId = prodSel?.value || 1;
  const prodName = prodSel?.selectedOptions[0]?.getAttribute('data-name') || 'Produto';
  const refCode = document.getElementById('linkAffiliateCode')?.value?.trim().toUpperCase();
  const coupon = document.getElementById('linkCouponCode')?.value?.trim().toUpperCase();

  // Link WhatsApp: https://wa.me/?text=Ola...
  let wppMsg = `Olá! Quero adquirir o *${prodName}*`;
  if (refCode) wppMsg += ` (ref_${refCode})`;
  if (coupon) wppMsg += ` com o cupom *${coupon}*`;

  const wppLink = `https://wa.me/?text=${encodeURIComponent(wppMsg)}`;
  const tgLink = `https://t.me/PayBotCriptoBot?start=buy_${prodId}${refCode ? `_ref_${refCode}` : ''}${coupon ? `_cupom_${coupon}` : ''}`;

  if (document.getElementById('builtWppLink')) document.getElementById('builtWppLink').value = wppLink;
  if (document.getElementById('builtTgLink')) document.getElementById('builtTgLink').value = tgLink;
}

function copyQuickField(elementId) {
  const inp = document.getElementById(elementId);
  if (!inp) return;
  inp.select();
  inp.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(inp.value).then(() => {
    alert('Copiado para a área de transferência com sucesso!');
  }).catch(() => {
    document.execCommand('copy');
    alert('Copiado!');
  });
}


// ==========================================
// CENTRAL MULTI-CONTAS WHATSAPP (MULTI-DEVICE & SUB-BOTS)
// ==========================================
function openAddWhatsAppModal() {
  openArmyInstanceModal();
  const title = document.getElementById('modalArmyInstanceTitle');
  if (title) title.innerHTML = '<i class="fa-brands fa-whatsapp" style="color: #25d366;"></i> Conectar Outra Conta WhatsApp';
}

async function loadAllWhatsAppAccounts() {
  const container = document.getElementById('wppAccountsGrid');
  if (!container) return;

  try {
    const res = await fetch('/api/whatsapp/accounts');
    const accounts = await res.json();

    if (!accounts || accounts.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 25px; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.02); border-radius: 8px;">
          Nenhuma conta de WhatsApp cadastrada. Clique em "+ Adicionar Outra Conta WhatsApp" para começar.
        </div>`;
      return;
    }

    container.innerHTML = accounts.map(acc => {
      let statusBadge = '';
      if (acc.connected) {
        statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Conectado</span>';
      } else if (acc.status === 'WAITING_QR' || acc.hasQr) {
        statusBadge = '<span class="badge" style="background:#f59e0b20; color:#f59e0b"><i class="fa-solid fa-qrcode"></i> Aguardando QR</span>';
      } else if (acc.status === 'CONNECTING') {
        statusBadge = '<span class="badge" style="background:#3b82f620; color:#3b82f6"><i class="fa-solid fa-spinner fa-spin"></i> Conectando...</span>';
      } else {
        statusBadge = '<span class="badge badge-canceled"><i class="fa-solid fa-circle-xmark"></i> Desconectado</span>';
      }

      const roleBadge = acc.is_main
        ? '<span class="badge" style="background:#f0b90b20; color:#f0b90b; font-weight:700;"><i class="fa-solid fa-crown"></i> Matriz Principal</span>'
        : '<span class="badge" style="background:#25d36620; color:#25d366; font-weight:600;"><i class="fa-brands fa-whatsapp"></i> Sub-Bot / Chip #' + acc.id + '</span>';

      const phoneText = acc.phone ? `+${acc.phone}` : 'Aguardando pareamento de número';

      return `
        <div class="wpp-account-card ${acc.is_main ? 'main-account' : 'secondary-account'}">
          <div>
            <div class="wpp-account-header">
              <div>
                <div class="wpp-account-title">
                  <i class="fa-brands fa-whatsapp" style="color: ${acc.is_main ? '#f59e0b' : '#25d366'}; font-size: 20px;"></i>
                  ${acc.name || (acc.is_main ? 'WhatsApp Matriz' : 'Chip #' + acc.id)}
                </div>
                <div style="margin-top: 4px;">${roleBadge}</div>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div class="wpp-account-phone">
              <i class="fa-solid fa-mobile-screen"></i> <b>${phoneText}</b>
            </div>

            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
              <span>Envios hoje: <b>${acc.messages_sent_today || 0}</b> / ${acc.daily_limit || 50}</span>
            </div>
          </div>

          <div class="wpp-account-actions">
            <button class="btn btn-sm btn-primary" onclick="openArmyQrModal(${acc.id})" title="Abrir QR Code ou Código de Pareamento">
              <i class="fa-solid fa-qrcode"></i> ${acc.connected ? 'Ver Conexão' : 'Conectar'}
            </button>
            ${acc.connected ? `
              <button class="btn btn-sm btn-secondary" onclick="disconnectWhatsAppAccount(${acc.id})" title="Desconectar este aparelho">
                <i class="fa-solid fa-pause"></i> Desconectar
              </button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="resetWhatsAppAccountSession(${acc.id})" title="Limpar sessão se travado">
              <i class="fa-solid fa-arrows-rotate"></i> Resetar
            </button>
            ${!acc.is_main ? `
              <button class="btn btn-sm btn-danger" onclick="deleteWhatsAppAccount(${acc.id})" title="Excluir este número secundário">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar contas WhatsApp:', err);
  }
}

async function disconnectWhatsAppAccount(id) {
  try {
    await fetch(`/api/whatsapp/accounts/${id}/disconnect`, { method: 'POST' });
    await loadAllWhatsAppAccounts();
    await loadArmyInstances();
  } catch (err) {
    alert('Erro ao desconectar: ' + err.message);
  }
}

async function resetWhatsAppAccountSession(id) {
  if (!confirm('Deseja realmente resetar esta sessão? Você precisará ler o QR Code ou digitar o código novamente.')) return;
  try {
    await fetch(`/api/whatsapp/accounts/${id}/reset`, { method: 'POST' });
    alert('Sessão resetada! Abra a conexão para parear novamente.');
    await loadAllWhatsAppAccounts();
    await loadArmyInstances();
  } catch (err) {
    alert('Erro ao resetar: ' + err.message);
  }
}

async function deleteWhatsAppAccount(id) {
  if (!confirm('Deseja realmente remover esta conta secundária de WhatsApp?')) return;
  try {
    const res = await fetch(`/api/whatsapp/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadAllWhatsAppAccounts();
      await loadArmyInstances();
    } else {
      const data = await res.json();
      alert('Erro: ' + data.error);
    }
  } catch (err) {
    alert('Erro ao excluir conta: ' + err.message);
  }
}


// ==========================================
// 19. CENTRAL DE DIVULGAÇÃO DO DONO & CONTROLE DE SUB-BOTS
// ==========================================

async function loadOwnerSettings() {
  try {
    const res = await fetch('/api/army/owner');
    const data = await res.json();
    const input = document.getElementById('ownerPhoneInput');
    if (input && data.owner_phone) {
      input.value = data.owner_phone;
    }
  } catch (_) {}
}

async function saveOwnerPhone() {
  const input = document.getElementById('ownerPhoneInput');
  if (!input) return;
  const phone = input.value.trim();
  if (!phone) {
    alert('Por favor, informe o telefone do dono.');
    return;
  }
  try {
    const res = await fetch('/api/army/set-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (res.ok) {
      alert('👑 Dono atualizado com sucesso: +' + data.owner_phone);
    } else {
      alert('Erro: ' + (data.error || 'Falha ao salvar dono'));
    }
  } catch (err) {
    alert('Erro ao salvar dono: ' + err.message);
  }
}

async function loadSubBotsSummary() {
  try {
    const res = await fetch('/api/army/subbots/summary');
    const data = await res.json();
    const elOnline = document.getElementById('summaryOnlineSubBots');
    if (elOnline) {
      elOnline.innerText = `${data.onlineSubBots} / ${data.totalSubBots}`;
    }
    const elSent = document.getElementById('summaryTotalSentToday');
    if (elSent) {
      elSent.innerText = `${data.totalSentToday} msgs`;
    }
    const elCap = document.getElementById('summaryCapacityRemaining');
    if (elCap) {
      const remaining = Math.max(0, data.totalDailyCapacity - data.totalSentToday);
      elCap.innerText = `${remaining} msgs`;
    }
  } catch (_) {}
}

function insertSpintaxTag(tag) {
  const textarea = document.getElementById('broadcastMessageInput');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  textarea.value = text.substring(0, start) + tag + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + tag.length;
}

async function loadBroadcastProducts() {
  try {
    const res = await fetch('/api/products');
    const products = await res.json();
    const select = document.getElementById('broadcastProductSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecione um produto para autopreencher a copy --</option>';
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `[${p.id}] ${p.name} - R$ ${Number(p.price).toFixed(2)}`;
      opt.dataset.name = p.name;
      opt.dataset.price = Number(p.price).toFixed(2);
      opt.dataset.desc = p.description || '';
      select.appendChild(opt);
    });
  } catch (_) {}
}

function applyProductBroadcastTemplate() {
  const select = document.getElementById('broadcastProductSelect');
  const textarea = document.getElementById('broadcastMessageInput');
  if (!select || !textarea || !select.value) return;

  const opt = select.selectedOptions[0];
  const name = opt.dataset.name;
  const price = opt.dataset.price;
  const desc = opt.dataset.desc || 'Produto de alta qualidade e entrega imediata!';

  const template = `{🔥 OFERTA EXCLUSIVA|🚀 SUPER NOVIDADE|💎 OPORTUNIDADE IMPERDÍVEL}!\n\n` +
    `*${name}*\n` +
    `💰 Por apenas: *R$ ${price}*\n` +
    `📝 ${desc}\n\n` +
    `👉 {Para garantir o seu agora mesmo, envie|Peça já o seu enviando}: *MENU* ou *P${select.value}*`;

  textarea.value = template;
}

function toggleBroadcastTargetInput() {
  const select = document.getElementById('broadcastTargetType');
  const box = document.getElementById('broadcastCustomTargetsBox');
  if (!select || !box) return;
  box.style.display = select.value === 'custom' ? 'block' : 'none';
}

function previewBroadcastSpintax() {
  const textarea = document.getElementById('broadcastMessageInput');
  if (!textarea || !textarea.value.trim()) {
    alert('Digite uma mensagem com Spintax para pré-visualizar.');
    return;
  }
  let preview = textarea.value;
  // Resolve spintax simples no cliente para visualização imediata
  preview = preview.replace(/\{([^{}]+)\}/g, (match, choices) => {
    const parts = choices.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
  alert('✨ PRÉ-VISUALIZAÇÃO DE UMA VARIAÇÃO SPINTAX:\n\n' + preview);
}

async function dispatchOwnerBroadcast() {
  const textarea = document.getElementById('broadcastMessageInput');
  const targetSelect = document.getElementById('broadcastTargetType');
  const customTargetsTextarea = document.getElementById('broadcastCustomTargets');
  const btn = document.getElementById('btnDispatchBroadcast');
  const reportBox = document.getElementById('broadcastReportBox');
  const reportContent = document.getElementById('broadcastReportContent');

  if (!textarea || !textarea.value.trim()) {
    alert('Digite o texto da mensagem para disparar a divulgação.');
    return;
  }

  const message = textarea.value.trim();
  const targetType = targetSelect ? targetSelect.value : 'leads';
  let targets = [];

  if (targetType === 'custom') {
    const raw = customTargetsTextarea ? customTargetsTextarea.value : '';
    targets = raw.split(/[\n,;]+/).map(s => s.trim().replace(/\D/g, '')).filter(s => s.length >= 8);
    if (targets.length === 0) {
      alert('Informe ao menos um número de telefone válido na lista manual.');
      return;
    }
  }

  if (!confirm(`Confirmar disparo em massa pelo Exército de Sub-Bots?\n\nModo de Envio: ${targetType.toUpperCase()}\nAs mensagens serão distribuídas com proteção anti-ban e variação Spintax.`)) {
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando pelo Exército...';
  if (reportBox) reportBox.style.display = 'none';

  try {
    const res = await fetch('/api/army/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        targetType,
        targets
      })
    });
    const result = await res.json();
    if (res.ok) {
      if (reportBox && reportContent) {
        reportBox.style.display = 'block';
        reportContent.innerHTML = `
          <p><b>Sub-bots utilizados:</b> ${result.subBotsCount || 0}</p>
          <p><b>Total de destinatários:</b> ${result.totalRecipients || 0}</p>
          <p style="color: #10b981;"><b>Mensagens entregues com sucesso:</b> ${result.dispatched || 0} ✅</p>
          <p style="color: #ef4444;"><b>Falhas registradas:</b> ${result.failed || 0} ❌</p>
          <p style="margin-top: 8px; color: var(--text-muted); font-size: 12px;">${result.message || 'Transmissão concluída com sucesso!'}</p>
        `;
      }
      alert('🚀 Divulgação concluída com sucesso!');
      await loadSubBotsSummary();
      await loadArmyInstances();
    } else {
      alert('Erro na transmissão: ' + (result.error || 'Falha ao disparar'));
    }
  } catch (err) {
    alert('Erro de rede ao disparar transmissão: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bullhorn"></i> Disparar Divulgação pelo Exército';
  }
}

// ==========================================
// CENTRAL DE USABILIDADE, SUB-BOTS & COMANDOS
// ==========================================

const SYSTEM_COMMANDS = [
  // SUB-BOTS & JADIBOT
  { cmd: '!serbot', syntax: '!serbot [numero]', desc: 'Conectar um sub-bot via código de 8 dígitos ou QR Code', perm: 'Todos', category: 'subbots' },
  { cmd: '!bots', syntax: '!bots', desc: 'Listar todos os sub-bots conectados e status operacional', perm: 'Todos', category: 'subbots' },
  { cmd: '!stopbot', syntax: '!stopbot', desc: 'Desconectar a sessão do sub-bot atual', perm: 'Sub-bot', category: 'subbots' },
  { cmd: '!painelsubbots', syntax: '!painelsubbots', desc: 'Painel mestre com métricas, chips ativos e capacidade diária', perm: 'Dono/Owner', category: 'subbots' },
  { cmd: '!divulgar', syntax: '!divulgar <texto>', desc: 'Disparo simultâneo em massa através de todos os sub-bots', perm: 'Dono/Owner', category: 'subbots' },
  { cmd: '!promover', syntax: '!promover <oferta/link>', desc: 'Divulgar produtos/links nos grupos de todos os sub-bots', perm: 'Dono/Owner', category: 'subbots' },
  { cmd: '!reiniciarsubbot', syntax: '!reiniciarsubbot <id>', desc: 'Reiniciar a sessão de um sub-bot específico', perm: 'Dono/Owner', category: 'subbots' },
  { cmd: '!setowner', syntax: '!setowner <numero>', desc: 'Definir o número do Dono Supremo com permissões totais', perm: 'Dono/Owner', category: 'subbots' },
  { cmd: '!subbothelp', syntax: '!subbothelp', desc: 'Guia completo passo-a-passo de como conectar e usar sub-bots', perm: 'Todos', category: 'subbots' },

  // LANÇAMENTO METEÓRICO & MULTI-GRUPOS COM SUB-BOTS
  { cmd: '!meteorico', syntax: '!meteorico', desc: 'Painel do lançamento meteórico, status de grupos e link inteligente /l/vip', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico ativar', syntax: '!meteorico ativar [nome] [limite]', desc: 'Ativar modo meteórico e criação automática de grupos ao lotar', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico criargrupo', syntax: '!meteorico criargrupo [nome]', desc: 'Criar imediatamente o próximo grupo meteórico com sub-bots integrados', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico etapa', syntax: '!meteorico etapa <1-5>', desc: 'Disparar etapa de aquecimento com comunicado e diálogo de sub-bots', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico aquecer', syntax: '!meteorico aquecer [mensagem]', desc: 'Acionar interação rápida de aquecimento e quebra de objeções dos sub-bots', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico fechar', syntax: '!meteorico fechar', desc: 'Silenciar grupo meteórico (apenas administradores e sub-bots falam)', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico abrir', syntax: '!meteorico abrir', desc: 'Abrir grupo meteórico para dúvidas e mensagens de todos os participantes', perm: 'Admins', category: 'subbots' },
  { cmd: '!meteorico link', syntax: '!meteorico link', desc: 'Exibir o link do grupo ativo atual e o redirecionador inteligente /l/vip', perm: 'Admins', category: 'subbots' },

  // MÍDIA & YOUTUBE 200MB
  { cmd: '!lista', syntax: '!lista <busca>', desc: 'Busca os 20 principais vídeos do YouTube com opções rápidas de download', perm: 'Todos', category: 'media' },
  { cmd: 'A1 .. A20', syntax: 'A1 até A20', desc: 'Baixa o áudio MP3 (1 a 20) da última busca feita com !lista', perm: 'Todos', category: 'media' },
  { cmd: 'V1 .. V20', syntax: 'V1 até V20', desc: 'Baixa o vídeo MP4 (1 a 20) da última busca (até 200MB, arquivo se >60MB)', perm: 'Todos', category: 'media' },
  { cmd: '!video', syntax: '!video <termo ou link>', desc: 'Baixar vídeo do YouTube até 200MB (limite ampliado, arquivo se >60MB)', perm: 'Todos', category: 'media' },
  { cmd: '!play', syntax: '!play <musica ou link>', desc: 'Buscar e baixar áudio MP3 do YouTube com alta fidelidade', perm: 'Todos', category: 'media' },
  { cmd: '!s', syntax: '!s (ou !fig)', desc: 'Transformar imagem/vídeo/gif em figurinha com corte inteligente e bordas', perm: 'Todos', category: 'media' },
  { cmd: '!allstories', syntax: '!allstories @usuario', desc: 'Baixar todos os stories ativos de um perfil do Instagram', perm: 'Todos', category: 'media' },
  { cmd: '!scrapinsta', syntax: '!scrapinsta @usuario', desc: 'Download completo de posts, reels, seguidores e maturidade do perfil', perm: 'Todos', category: 'media' },
  { cmd: '!tiktok', syntax: '!tiktok <url>', desc: 'Baixar vídeo do TikTok sem marca d\'água em alta definição', perm: 'Todos', category: 'media' },

  // SEGURANÇA & GRUPOS
  { cmd: '!configurar', syntax: '!configurar [opcao on/off]', desc: 'Painel interativo de moderação no grupo ou alternar proteções', perm: 'Admins', category: 'security' },
  { cmd: '!todos', syntax: '!todos [mensagem]', desc: 'Marcar todos os participantes do grupo para avisos urgentes', perm: 'Admins', category: 'security' },
  { cmd: '!kick', syntax: '!kick @membro', desc: 'Remover participante indesejado do grupo', perm: 'Admins', category: 'security' },
  { cmd: '!ban', syntax: '!ban @membro', desc: 'Banir participante com bloqueio permanente', perm: 'Admins', category: 'security' },
  { cmd: '!promote', syntax: '!promote @membro', desc: 'Promover participante a administrador do grupo', perm: 'Admins', category: 'security' },
  { cmd: '!demote', syntax: '!demote @admin', desc: 'Rebaixar administrador a membro comum', perm: 'Admins', category: 'security' },
  { cmd: '!link', syntax: '!link', desc: 'Obter link de convite oficial do grupo', perm: 'Admins', category: 'security' },
  { cmd: '!hidetag', syntax: '!hidetag <texto>', desc: 'Marcar todos os membros de forma invisível/discreta', perm: 'Admins', category: 'security' },
  { cmd: '!advertir', syntax: '!advertir @membro', desc: 'Aplicar advertência (3 advertências = banimento automático)', perm: 'Admins', category: 'security' },

  // UTILIDADES & IA
  { cmd: '!ping', syntax: '!ping', desc: 'Diagnóstico com latência (ms), RAM, uptime e contagem de sub-bots', perm: 'Todos', category: 'utils' },
  { cmd: '!help', syntax: '!help (ou !bot / !menu)', desc: 'Menu e catálogo completo de comandos em categorias', perm: 'Todos', category: 'utils' },
  { cmd: '!ia', syntax: '!ia <pergunta>', desc: 'Consultar inteligência artificial avançada (OpenAI / Gemini)', perm: 'Todos', category: 'utils' },
  { cmd: '!perfil', syntax: '!perfil', desc: 'Ver seu nível de fidelidade, pontos acumulados e cupons disponíveis', perm: 'Todos', category: 'utils' },
  { cmd: '!resgatar', syntax: '!resgatar', desc: 'Trocar pontos de fidelidade por cupom de desconto real', perm: 'Todos', category: 'utils' },
  { cmd: '!cep', syntax: '!cep <00000000>', desc: 'Consultar endereço completo via CEP nos Correios', perm: 'Todos', category: 'utils' },
  { cmd: '!calc', syntax: '!calc <expressão>', desc: 'Calculadora matemática rápida (ex: !calc 50 * 1.25)', perm: 'Todos', category: 'utils' },
  { cmd: '!qr', syntax: '!qr <texto ou link>', desc: 'Gerar QR Code instantâneo com texto ou URL', perm: 'Todos', category: 'utils' },
  { cmd: '!traduzir', syntax: '!traduzir pt <texto>', desc: 'Traduzir texto entre mais de 100 idiomas com Google Translate', perm: 'Todos', category: 'utils' },
  { cmd: '!falar', syntax: '!falar <texto>', desc: 'Converter texto em áudio de voz ultra realista (Google TTS)', perm: 'Todos', category: 'utils' }
];

let activeCmdCategory = 'all';

function renderCommandsTable() {
  const tbody = document.getElementById('commandsTableBody');
  if (!tbody) return;

  const filterInput = document.getElementById('cmdSearchFilter');
  const query = filterInput ? filterInput.value.toLowerCase().trim() : '';

  const filtered = SYSTEM_COMMANDS.filter(item => {
    const matchCat = activeCmdCategory === 'all' || item.category === activeCmdCategory;
    const matchQuery = !query ||
      item.cmd.toLowerCase().includes(query) ||
      item.syntax.toLowerCase().includes(query) ||
      item.desc.toLowerCase().includes(query);
    return matchCat && matchQuery;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum comando encontrado para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    let permColor = '#10b981';
    if (item.perm.includes('Dono')) permColor = '#f59e0b';
    else if (item.perm.includes('Admin')) permColor = '#3b82f6';

    return `
      <tr>
        <td>
          <code style="background: rgba(255,255,255,0.06); color: #38bdf8; padding: 3px 8px; border-radius: 4px; font-weight: 700;">
            ${item.cmd}
          </code>
        </td>
        <td><span style="font-family: monospace; color: var(--text-main); font-size: 13px;">${item.syntax}</span></td>
        <td style="color: var(--text-muted); font-size: 13px;">${item.desc}</td>
        <td>
          <span class="badge" style="background: ${permColor}20; color: ${permColor}; border: 1px solid ${permColor}40;">
            ${item.perm}
          </span>
        </td>
        <td style="text-align: center;">
          <button class="btn btn-sm btn-secondary" onclick="copyCommand('${item.cmd}')" title="Copiar comando">
            <i class="fa-solid fa-copy"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function setCmdCategory(cat) {
  activeCmdCategory = cat;
  const btnGroup = document.getElementById('cmdCategoryButtons');
  if (btnGroup) {
    const btns = btnGroup.querySelectorAll('button');
    btns.forEach(b => {
      if (b.getAttribute('onclick')?.includes(`'${cat}'`)) {
        b.className = 'btn btn-sm btn-primary';
      } else {
        b.className = 'btn btn-sm btn-secondary';
      }
    });
  }
  renderCommandsTable();
}

function filterCommandList() {
  renderCommandsTable();
}

function copyCommand(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert(`Comando "${text}" copiado para a área de transferência!`);
  }).catch(() => {
    prompt('Copie o comando abaixo:', text);
  });
}

async function refreshSystemPing() {
  try {
    const res = await fetch('/api/system/ping');
    if (!res.ok) return;
    const data = await res.json();

    const elMatrix = document.getElementById('diagMatrixStatus');
    if (elMatrix) {
      if (data.matrix_connected) {
        elMatrix.innerHTML = `<span style="color: #10b981;"><i class="fa-solid fa-circle-check"></i> Conectado (${data.matrix_phone || 'Matriz'})</span>`;
      } else {
        elMatrix.innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-circle-xmark"></i> Desconectado</span>`;
      }
    }

    const elSubBots = document.getElementById('diagSubBotsCount');
    if (elSubBots) {
      elSubBots.innerText = `${data.subbots_online} / ${data.subbots_total}`;
    }

    const elPing = document.getElementById('diagPingMs');
    if (elPing) {
      elPing.innerText = `${data.ping_ms} ms`;
    }

    const elUptime = document.getElementById('diagUptime');
    if (elUptime) {
      elUptime.innerText = data.uptime_formatted || `${data.uptime_seconds}s`;
    }

    const elRam = document.getElementById('diagRamMb');
    if (elRam) {
      elRam.innerText = `${data.ram_mb} MB`;
    }
  } catch (err) {
    console.error('Erro ao consultar ping do sistema:', err);
  }
}

async function sendSubBotBroadcastFromWeb() {
  const msgInput = document.getElementById('subBotBroadcastMsg');
  const message = msgInput ? msgInput.value.trim() : '';

  if (!message) {
    alert('Digite a mensagem ou oferta a ser disparada pelos Sub-Bots!');
    return;
  }

  const targetRadio = document.querySelector('input[name="subBotTargetType"]:checked');
  const targetType = targetRadio ? targetRadio.value : 'leads';

  if (!confirm(`Confirmar disparo da mensagem via todos os Sub-Bots para ${targetType === 'groups' ? 'todos os Grupos' : 'a fila de Leads'}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/army/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        targetType
      })
    });
    const result = await res.json();
    if (res.ok) {
      alert(`🚀 Divulgação iniciada com sucesso via ${result.subBotsCount || 0} sub-bots!\nEntregas: ${result.dispatched || 0}`);
      if (msgInput) msgInput.value = '';
      refreshSystemPing();
    } else {
      alert('Erro ao disparar: ' + (result.error || 'Falha no envio'));
    }
  } catch (err) {
    alert('Erro de conexão ao disparar transmissão: ' + err.message);
  }
}

// ==========================================
// LANÇAMENTO METEÓRICO & MULTI-GRUPOS COM SUB-BOTS
// ==========================================

let currentMeteoricCampaign = null;
let currentMeteoricStages = [];
let currentMeteoricGroups = [];
let currentEditingStageNum = 1;

async function loadMeteoricData() {
  await Promise.all([
    loadMeteoricStatus(),
    loadMeteoricStages(),
    loadMeteoricGroupsList()
  ]);
}

async function loadMeteoricStatus() {
  try {
    const res = await fetch('/api/meteoric/status');
    if (!res.ok) return;
    const data = await res.json();
    currentMeteoricCampaign = data.campaign;

    // Métricas
    const elGroups = document.getElementById('meteoricStatGroups');
    if (elGroups) elGroups.innerText = `${data.totalGroups} grupos`;

    const elMembers = document.getElementById('meteoricStatMembers');
    if (elMembers) elMembers.innerText = `${data.totalMembers} membros`;

    const elSubBots = document.getElementById('meteoricStatSubBots');
    if (elSubBots) elSubBots.innerText = `${data.onlineSubBots} online`;

    const elStage = document.getElementById('meteoricStatStage');
    if (elStage) elStage.innerText = data.currentStage?.title || 'Etapa 1';

    // Badge Ativo/Pausado
    const badge = document.getElementById('meteoricActiveBadge');
    const btnToggle = document.getElementById('btnToggleMeteoric');
    if (badge) {
      if (data.campaign.active) {
        badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Monitoramento Ativo';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.color = '#10b981';
        badge.style.borderColor = '#10b981';
      } else {
        badge.innerHTML = '<i class="fa-solid fa-circle-pause"></i> Lançamento Pausado';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = '#ef4444';
        badge.style.borderColor = '#ef4444';
      }
    }
    if (btnToggle) {
      btnToggle.innerHTML = data.campaign.active 
        ? '<i class="fa-solid fa-pause"></i> Pausar Lançamento' 
        : '<i class="fa-solid fa-play"></i> Ativar Lançamento';
    }

    // Formulário de Configuração
    const inputName = document.getElementById('cfgMeteoricName');
    if (inputName) inputName.value = data.campaign.name || 'Lançamento Meteórico VIP';

    const inputBaseName = document.getElementById('cfgMeteoricBaseName');
    if (inputBaseName) inputBaseName.value = data.campaign.group_base_name || 'Oferta VIP #{num}';

    const inputMax = document.getElementById('cfgMeteoricMaxLimit');
    if (inputMax) inputMax.value = data.campaign.max_members_per_group || 200;

    const inputDesc = document.getElementById('cfgMeteoricDesc');
    if (inputDesc) inputDesc.value = data.campaign.group_description || '';

    // Grupo Ativo Atual
    const g = data.activeGroup;
    const titleEl = document.getElementById('activeGroupTitle');
    const linkEl = document.getElementById('activeGroupLinkText');
    const capTextEl = document.getElementById('activeGroupCapacityText');
    const barEl = document.getElementById('activeGroupProgressBar');

    if (g) {
      if (titleEl) titleEl.innerText = g.title;
      if (linkEl) linkEl.innerText = g.invite_url || 'Sem link gerado ainda';
      if (capTextEl) capTextEl.innerText = `${g.member_count} / ${g.max_limit}`;
      const pct = Math.min(100, Math.round((g.member_count / g.max_limit) * 100));
      if (barEl) {
        barEl.style.width = `${pct}%`;
        barEl.style.background = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#f97316';
      }
    } else {
      if (titleEl) titleEl.innerText = 'Nenhum grupo ativo (Crie um abaixo)';
      if (linkEl) linkEl.innerText = '-';
      if (capTextEl) capTextEl.innerText = '0 / 0';
      if (barEl) barEl.style.width = '0%';
    }
  } catch (err) {
    console.error('Erro ao carregar status do meteórico:', err);
  }
}

async function saveMeteoricConfig(e) {
  if (e && e.preventDefault) e.preventDefault();
  const name = document.getElementById('cfgMeteoricName')?.value.trim();
  const group_base_name = document.getElementById('cfgMeteoricBaseName')?.value.trim();
  const max_members_per_group = parseInt(document.getElementById('cfgMeteoricMaxLimit')?.value, 10) || 200;
  const group_description = document.getElementById('cfgMeteoricDesc')?.value.trim();

  try {
    const res = await fetch('/api/meteoric/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, group_base_name, max_members_per_group, group_description })
    });
    if (res.ok) {
      alert('✅ Configurações do Lançamento Meteórico salvas com sucesso!');
      await loadMeteoricStatus();
    } else {
      const err = await res.json();
      alert('Erro ao salvar: ' + (err.error || 'Falha na resposta'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function toggleMeteoricCampaign() {
  try {
    const res = await fetch('/api/meteoric/toggle', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.active ? '🚀 Lançamento Meteórico ATIVADO! Grupos serão criados automaticamente ao lotar.' : '⏸️ Lançamento Meteórico PAUSADO.');
      await loadMeteoricStatus();
    }
  } catch (err) {
    alert('Erro ao alternar campanha: ' + err.message);
  }
}

async function triggerCreateMeteoricGroup() {
  const customTitle = prompt('Digite o nome do novo grupo (ou deixe vazio para usar a numeração automática):', '');
  if (customTitle === null) return; // cancelou

  try {
    const res = await fetch('/api/meteoric/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: customTitle.trim() || undefined })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`🎉 Grupo "${data.group?.title}" criado com sucesso!\nConvite: ${data.group?.invite_url || 'Gerado'}`);
      await loadMeteoricData();
    } else {
      alert('Erro ao criar grupo: ' + (data.error || 'Falha no servidor'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

async function loadMeteoricGroupsList() {
  const tbody = document.getElementById('tableMeteoricGroupsBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/meteoric/groups');
    if (!res.ok) return;
    const groups = await res.json();
    currentMeteoricGroups = groups;

    if (!groups || groups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum grupo cadastrado ainda. Clique em "Forçar Novo Grupo Agora" ou envie !meteorico criargrupo no WhatsApp.</td></tr>`;
      return;
    }

    tbody.innerHTML = groups.map(g => {
      const pct = Math.min(100, Math.round(((g.member_count || 0) / (g.max_limit || 200)) * 100));
      const statusBadge = g.is_full 
        ? '<span class="badge" style="background:#ef444420; color:#ef4444; border:1px solid #ef444450;"><i class="fa-solid fa-lock"></i> Lotado</span>'
        : '<span class="badge badge-paid"><i class="fa-solid fa-door-open"></i> Vagas Abertas</span>';

      const modeBadge = g.is_closed
        ? '<span class="badge" style="background:#f59e0b20; color:#f59e0b; font-size:11px;">🔒 Anúncio</span>'
        : '<span class="badge" style="background:#10b98120; color:#10b981; font-size:11px;">🔓 Aberto</span>';

      return `
        <tr>
          <td><b style="color: #f97316;">#${g.group_num}</b></td>
          <td><b>${g.title}</b></td>
          <td>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>${g.member_count || 0} membros</span>
              <b>${pct}%</b>
            </div>
            <div class="progress" style="height:6px; background:rgba(255,255,255,0.05); border-radius:3px;">
              <div class="progress-bar" style="width:${pct}%; background:${pct >= 90 ? '#ef4444' : '#f97316'}; height:100%;"></div>
            </div>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:4px;">
              ${statusBadge}
              ${modeBadge}
            </div>
          </td>
          <td>
            ${g.invite_url ? `
              <div style="display:flex; align-items:center; gap:6px;">
                <code style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px;">${g.invite_url}</code>
                <button class="btn btn-sm btn-secondary" onclick="copyMeteoricGroupLink('${g.invite_url}')" title="Copiar Link"><i class="fa-solid fa-copy"></i></button>
              </div>
            ` : '<span style="color:var(--text-muted); font-size:12px;">Sem link</span>'}
          </td>
          <td style="text-align:center;">
            <div style="display:flex; gap:6px; justify-content:center;">
              <button class="btn btn-sm btn-secondary" onclick="toggleMeteoricGroupMode(${g.id}, '${g.is_closed ? 'open' : 'closed'}')" title="${g.is_closed ? 'Abrir grupo para conversas' : 'Fechar grupo (apenas admins)'}">
                <i class="fa-solid ${g.is_closed ? 'fa-lock-open' : 'fa-lock'}"></i>
              </button>
              <button class="btn btn-sm btn-primary" onclick="triggerWarmupForGroup('${g.group_jid}')" title="Disparar conversa de sub-bots neste grupo" style="background:#f97316; border-color:#f97316;">
                <i class="fa-solid fa-fire"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar grupos meteóricos:', err);
  }
}

async function loadMeteoricStages() {
  try {
    const res = await fetch('/api/meteoric/stages');
    if (!res.ok) return;
    currentMeteoricStages = await res.json();
    selectMeteoricStageView(currentEditingStageNum);
  } catch (err) {
    console.error('Erro ao carregar etapas meteóricas:', err);
  }
}

function selectMeteoricStageView(stageNum) {
  currentEditingStageNum = stageNum;

  // Atualiza botões das abas
  const tabs = document.querySelectorAll('#meteoricStageTabs button');
  tabs.forEach((b, idx) => {
    if (idx + 1 === stageNum) {
      b.className = 'btn btn-sm btn-primary';
      b.style.background = '#f97316';
      b.style.borderColor = '#f97316';
    } else {
      b.className = 'btn btn-sm btn-secondary';
      b.style.background = '';
      b.style.borderColor = '';
    }
  });

  const stage = currentMeteoricStages.find(s => s.stage_num === stageNum);
  if (!stage) return;

  const titleEl = document.getElementById('stageEditorTitle');
  if (titleEl) titleEl.innerText = stage.title;

  const modeSelect = document.getElementById('stageEditorGroupMode');
  if (modeSelect) modeSelect.value = stage.group_mode || 'announcement';

  const annEl = document.getElementById('stageEditorAnnouncement');
  if (annEl) annEl.value = stage.admin_announcement || '';

  const scriptsEl = document.getElementById('stageEditorScripts');
  if (scriptsEl) {
    let pretty = stage.subbot_scripts;
    try {
      if (typeof pretty === 'string') pretty = JSON.stringify(JSON.parse(pretty), null, 2);
    } catch (_) {}
    scriptsEl.value = pretty || '[]';
  }
}

async function saveMeteoricStageEditor() {
  const stageNum = currentEditingStageNum;
  const group_mode = document.getElementById('stageEditorGroupMode')?.value;
  const admin_announcement = document.getElementById('stageEditorAnnouncement')?.value.trim();
  const scriptsRaw = document.getElementById('stageEditorScripts')?.value.trim();

  let subbot_scripts = [];
  try {
    subbot_scripts = JSON.parse(scriptsRaw);
  } catch (e) {
    alert('Erro no formato JSON das falas dos sub-bots: ' + e.message);
    return;
  }

  try {
    const res = await fetch(`/api/meteoric/stages/${stageNum}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_mode, admin_announcement, subbot_scripts })
    });
    if (res.ok) {
      alert(`✅ Diretrizes da Etapa #${stageNum} salvas com sucesso!`);
      await loadMeteoricStages();
    } else {
      alert('Erro ao salvar diretrizes da etapa');
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function triggerMeteoricStageWarmup() {
  const stageNum = currentEditingStageNum;
  if (!confirm(`Confirmar disparo da ETAPA #${stageNum} nos grupos meteóricos?\n\nO comunicado oficial será postado no grupo e os sub-bots iniciarão a conversação e aquecimento agendados.`)) {
    return;
  }

  try {
    const res = await fetch('/api/meteoric/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageNum })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`🚀 Etapa #${stageNum} disparada com sucesso em ${data.report?.targetGroupsCount || 1} grupo(s)!\nAnúncios enviados: ${data.report?.announcementsSent}\nFalas de Sub-Bots agendadas: ${data.report?.subbotInteractionsScheduled}`);
      await loadMeteoricData();
    } else {
      alert('Erro ao disparar etapa: ' + (data.error || 'Falha'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function triggerInstantWarmupPrompt() {
  const customText = prompt('Digite a frase ou dúvida que deseja que os Sub-Bots enviem agora no grupo (ou deixe vazio para usar frases prontas de aquecimento):', '');
  if (customText === null) return;

  try {
    const res = await fetch('/api/meteoric/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customText: customText.trim() || undefined })
    });
    if (res.ok) {
      alert('💬 Aquecimento com Sub-Bots disparado com sucesso!');
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function triggerWarmupForGroup(groupJid) {
  const custom = prompt('Digite a mensagem para os Sub-Bots interagirem neste grupo (ou deixe vazio para quebra de objeções padrão):', '');
  if (custom === null) return;

  try {
    const res = await fetch('/api/meteoric/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetGroupJid: groupJid, customText: custom.trim() || undefined })
    });
    if (res.ok) {
      alert('🔥 Aquecimento dos sub-bots ativado para este grupo!');
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function toggleMeteoricGroupMode(groupId, mode) {
  try {
    const res = await fetch(`/api/meteoric/groups/${groupId}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    if (res.ok) {
      alert(`Grupo ${mode === 'open' ? 'ABERTO para mensagens de todos' : 'FECHADO para modo anúncio'}!`);
      await loadMeteoricGroupsList();
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function copyMeteoricRedirectUrl() {
  const input = document.getElementById('meteoricRedirectUrlInput');
  const url = input ? input.value : 'http://localhost:3000/l/vip';
  navigator.clipboard.writeText(url).then(() => {
    alert('🔗 Link de Tráfego Inteligente copiado!\n' + url);
  });
}

function copyMeteoricGroupLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    alert('Convite do grupo copiado: ' + url);
  });
}

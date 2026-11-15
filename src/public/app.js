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
  checkTunnelStatus();
  setInterval(checkTunnelStatus, 20000);
  renderCommandsTable();
  refreshSystemPing();

  // Polling regular a cada 8s
  setInterval(() => {
    loadMetrics();
    loadWhatsAppStatus();
    loadFunnelStats();
  }, 8000);
});

// 1. NAVEGAÇÃO DE ABAS (Mobile & Desktop)
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.toggle('mobile-open');
  if (backdrop) backdrop.classList.toggle('active');
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
}

async function openPublicStore(e) {
  if (e && e.preventDefault) e.preventDefault();
  try {
    const res = await fetch('/api/store/url').then(r => r.json()).catch(() => null);
    if (res && res.url) {
      window.open(res.url, '_blank');
      return;
    }
  } catch (_) {}
  window.open('/loja', '_blank');
}
window.openPublicStore = openPublicStore;

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
window.openModal = openModal;

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}
window.closeModal = closeModal;

function initNav() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const tabName = item.getAttribute('data-tab');
      if (!tabName) {
        // Link comum ou acao personalizada (ex: /loja)
        return;
      }
      e.preventDefault();
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  closeMobileSidebar();
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-btn').forEach(b => {
    if (b.getAttribute('data-tab') === tabName) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  const targetLink = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  const targetPane = document.getElementById(`tab-${tabName}`);

  if (targetLink && targetPane) {
    targetLink.classList.add('active');
    targetPane.classList.add('active');
    document.getElementById('pageTitle').innerText = targetLink.innerText.trim();
  }

  if (tabName === 'botdeck') {
    loadBotDeck();
    startBotDeckTelemetryPolling();
  } else {
    stopBotDeckTelemetryPolling();
  }
  if (tabName === 'connections') {
    startQrPolling();
    loadChatControls();
    refreshSystemPing();
    renderCommandsTable();
    loadWhatsappGroupsList();
  } else {
    stopQrPolling();
  }

  if (tabName === 'saas') loadSaasTenants();
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
  if (tabName === 'meteoric') {
    loadMeteoricData();
    startMeteoricFeedPolling();
  } else {
    stopMeteoricFeedPolling();
  }
  if (tabName === 'viral') loadViralRadarAll();
  if (tabName === 'social') loadSocialData();
  if (tabName === 'nlp') loadNlpData();
  if (tabName === 'cognitive') loadCognitiveOverview();
  if (tabName === 'rentals') loadRentalsOverview();
  if (tabName === 'notices') loadNotices();
  if (tabName === 'zapvoice') loadZapVoiceOverview();
  if (tabName === 'operations-manager') {
    loadOperationsManager(true);
    loadArbiterHistory();
  }
  if (tabName === 'connection-lab') {
    loadConnectionLab();
  }
  if (tabName === 'social-listening') {
    switchSlSubtab(typeof currentSlSubtab !== 'undefined' ? currentSlSubtab : 'rules');
    loadGroupManagers();
    loadRadarLeads();
    loadHeatingData();
    loadCartSessions();
    loadStoreTelemetry();
  }
  if (tabName === 'comfyart') {
    loadComfyArtStudio();
  }
}

// 2. CARREGAMENTO GERAL
async function loadAllData() {
  await Promise.all([
    loadMetrics(),
    loadWhatsAppStatus(),
    loadOperationsManager(false),
    loadCognitiveOverview(),
    loadRentalsOverview(),
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
    loadMeteoricData(),
    loadViralRadarAll(),
    loadSaasTenants()
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

async function requestWppPairingCode(btnEl) {
  const phoneInput = document.getElementById('wppPairingPhone');
  const rawPhone = phoneInput ? phoneInput.value.trim() : '';
  const cleanDigits = rawPhone.replace(/\D/g, '');

  if (!cleanDigits || cleanDigits.length < 8) {
    alert('Informe o número com código do país (DDI). Ex: +55 48 98470-2848 ou +1 202 555-0199');
    phoneInput?.focus();
    return;
  }

  const codeBox = document.getElementById('wppPairingCodeBox');
  const codeText = document.getElementById('wppPairingCodeText');
  let oldBtnHtml = '';
  if (btnEl) {
    oldBtnHtml = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
    btnEl.disabled = true;
  }

  if (codeText) codeText.innerText = 'GERANDO...';
  if (codeBox) codeBox.style.display = 'block';

  try {
    const res = await fetch('/api/whatsapp/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: rawPhone })
    });
    const data = await res.json();
    if (res.ok && data.pairingCode) {
      if (codeText) codeText.innerText = data.pairingCode;
      showBotToast('Código Gerado', `Código ${data.pairingCode} pronto! Digite no WhatsApp do seu celular.`, 'success');
    } else if (data.alreadyConnected) {
      if (codeText) codeText.innerText = 'ONLINE';
      showBotToast('Já Conectado', data.message || 'Esta conta WhatsApp já está pareada e ativa!', 'info');
      loadWhatsAppStatus();
    } else {
      if (codeText) codeText.innerText = 'ERRO';
      showBotToast('Erro no Pareamento', data.error || 'Falha ao gerar código.', 'error');
    }
  } catch (err) {
    if (codeText) codeText.innerText = 'ERRO';
    showBotToast('Erro de Conexão', err.message, 'error');
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldBtnHtml;
      btnEl.disabled = false;
    }
  }
}

function copyWppPairingCode() {
  const codeEl = document.getElementById('wppPairingCodeText');
  const code = codeEl ? codeEl.innerText.trim() : '';
  if (code && code !== '----' && code !== 'GERANDO...' && code !== 'ERRO') {
    navigator.clipboard.writeText(code).then(() => {
      showBotToast('Código Copiado', `Código ${code} copiado para a área de transferência!`, 'success');
    }).catch(() => {
      prompt('Copie o código abaixo:', code);
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
    currentCompanies = Array.isArray(companies) ? companies : (companies.companies || []);
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
      const data = await res.json();
      prods = Array.isArray(data) ? data : (data.products || []);
      currentProducts = prods;
    }
    prods = Array.isArray(prods) ? prods : [];

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
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhuma oferta publicada ainda.</td></tr>';
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
    const data = await res.json();
    currentProducts = Array.isArray(data) ? data : (data.products || []);
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
  const prods = Array.isArray(currentProducts) ? currentProducts : [];
  const categories = Array.from(new Set(prods.map(p => p.category || 'Geral'))).sort();
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
  const comps = Array.isArray(currentCompanies) ? currentCompanies : [];
  select.innerHTML = '<option value="">Todas as Empresas</option><option value="0">Matriz (Sem empresa)</option>' +
    comps.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhuma chave cadastrada neste produto.</td></tr>';
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
let currentOrders = [];

async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const orders = Array.isArray(data) ? data : (data.orders || []);
    currentOrders = orders;

    renderOrdersTable('tableOrders', orders);
    renderOrdersTable('tableOverviewOrders', orders.slice(0, 5));
    loadTaskQueue();
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

    const editBtn = `<button class="btn btn-sm btn-outline" onclick="openEditOrderModal('${o.merchant_trade_no}')" title="Editar Pedido, Cliente e Produto" style="margin-left: 6px;"><i class="fa-solid fa-pen-to-square"></i> Editar</button>`;

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
          <td>${actionBtn}${editBtn}</td>
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
        <td>${actionBtn}${editBtn}</td>
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
    const data = await res.json();
    const subs = Array.isArray(data) ? data : (data.subscriptions || []);

    const tbody = document.querySelector('#tableSubs tbody');
    if (!tbody) return;

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
    if (document.getElementById('cfgPixPrimaryProvider')) {
      document.getElementById('cfgPixPrimaryProvider').value = cfg.PIX_PRIMARY_PROVIDER || 'livepix';
    }
    if (document.getElementById('cfgPixKey')) {
      document.getElementById('cfgPixKey').value = cfg.PIX_KEY || '';
      updatePixKeyPreview(cfg.PIX_KEY || '');
    }
    if (document.getElementById('cfgPixMerchantName')) {
      document.getElementById('cfgPixMerchantName').value = cfg.PIX_MERCHANT_NAME || 'PAYBOT';
    }
    if (document.getElementById('cfgPixMerchantCity')) {
      document.getElementById('cfgPixMerchantCity').value = cfg.PIX_MERCHANT_CITY || 'SAO PAULO';
    }
    document.getElementById('cfgMercadoPagoToken').value = cfg.MERCADO_PAGO_ACCESS_TOKEN || '';
    document.getElementById('cfgLivepixUsername').value = cfg.LIVEPIX_USERNAME || '';
    if (typeof setLivepixPerfModeUI === 'function') { setLivepixPerfModeUI(cfg.LIVEPIX_PERF_MODE || 'balanced'); }
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

    // Automações e Segurança Spy
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
    if (document.getElementById('cfgGlobalSoDivu')) {
      document.getElementById('cfgGlobalSoDivu').checked = cfg.GLOBAL_SODIVU === true;
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

    PIX_PRIMARY_PROVIDER: document.getElementById('cfgPixPrimaryProvider')?.value || 'livepix',
    PIX_KEY: document.getElementById('cfgPixKey')?.value?.trim() || '',
    PIX_MERCHANT_NAME: document.getElementById('cfgPixMerchantName')?.value?.trim() || 'PAYBOT',
    PIX_MERCHANT_CITY: document.getElementById('cfgPixMerchantCity')?.value?.trim() || 'SAO PAULO',
    MERCADO_PAGO_ACCESS_TOKEN: document.getElementById('cfgMercadoPagoToken').value,
    LIVEPIX_USERNAME: document.getElementById('cfgLivepixUsername').value,
    LIVEPIX_PERF_MODE: typeof getLivepixPerfModeUI === 'function' ? getLivepixPerfModeUI() : 'balanced',
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

    // Automações, Moderação de Grupos & Segurança Spy
    ANTILINK_DEFAULT: document.getElementById('cfgAntiLinkDefault')?.checked ?? false,
    ANTIDELETE_DEFAULT: document.getElementById('cfgAntiDeleteDefault')?.checked ?? true,
    ANTIFAKE_DEFAULT: document.getElementById('cfgAntiFakeDefault')?.checked ?? true,
    ANTIFLOOD_DEFAULT: document.getElementById('cfgAntiFloodDefault')?.checked ?? true,
    ANTIVIEWONCE_DEFAULT: document.getElementById('cfgAntiViewOnceDefault')?.checked ?? true,
    ANTIPRIVADO_GLOBAL: document.getElementById('cfgAntiPrivadoGlobal')?.checked ?? false,
    GLOBAL_SODIVU: document.getElementById('cfgGlobalSoDivu')?.checked ?? false,
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
    loadBroadcastProducts(),
    loadMatrizTasks()
  ]);
  updateArmyMetrics();
}

function updateArmyMetrics() {
  const instances = Array.isArray(currentArmyInstances) ? currentArmyInstances : [];
  const links = Array.isArray(currentArmyLinks) ? currentArmyLinks : [];
  const campaigns = Array.isArray(currentArmyCampaigns) ? currentArmyCampaigns : [];

  const connectedCount = instances.filter(i => i.status === 'CONNECTED').length;
  const totalInstances = instances.length;
  const elConn = document.getElementById('armyStatConnected');
  if (elConn) elConn.innerText = `${connectedCount} / ${totalInstances}`;

  const sentToday = instances.reduce((acc, i) => acc + (i.messages_sent_today || 0), 0);
  const totalLimit = instances.reduce((acc, i) => acc + (i.daily_limit || 50), 0);
  const elSent = document.getElementById('armyStatSentToday');
  if (elSent) elSent.innerText = `${sentToday} / ${totalLimit} max`;

  const elLinks = document.getElementById('armyStatTotalLinks');
  if (elLinks) elLinks.innerText = `${links.length} cadastrados`;

  const activeCamps = campaigns.filter(c => c.status === 'RUNNING').length;
  const elCamps = document.getElementById('armyStatActiveCampaigns');
  if (elCamps) elCamps.innerText = `${activeCamps} ativas`;
}

// --- 1. INSTÂNCIAS / CHIPS DO EXÉRCITO ---

async function loadArmyInstances() {
  try {
    const res = await fetch('/api/army/instances');
    const data = await res.json();
    currentArmyInstances = Array.isArray(data) ? data : (data.instances || []);

    const tbody = document.querySelector('#tableArmyInstances tbody');
    if (!tbody) return;

    if (currentArmyInstances.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhum chip conectado ainda. Clique em "Conectar Novo Chip" acima.</td></tr>';
      updateArmySubbotSelectionCount();
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

      const feats = inst.features || {
        ai: true, group_posts: true, pv_chat: true, audio_voice: true,
        media_dl: true, stickers: true, games: true, moderation: true, auto_heating: true
      };
      const featureKeys = ['ai', 'group_posts', 'pv_chat', 'audio_voice', 'media_dl', 'stickers', 'games', 'moderation', 'auto_heating'];
      const activeCount = featureKeys.filter(k => feats[k] !== false).length;
      const totalCount = featureKeys.length;

      const featureBadgesHtml = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="badge" style="background: ${activeCount === totalCount ? 'rgba(16,185,129,0.15)' : (activeCount === 0 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)')}; color: ${activeCount === totalCount ? '#10b981' : (activeCount === 0 ? '#ef4444' : '#f59e0b')}; font-size: 11px; font-weight: 600;">
              <i class="fa-solid fa-sliders"></i> ${activeCount}/${totalCount} ativas
            </span>
            <button class="btn btn-xs btn-outline" onclick="openSubBotFeaturesModal(${inst.id})" title="Configurar funções deste chip" style="padding: 2px 7px; font-size: 11px; border-color: rgba(245,158,11,0.4); color: #f59e0b;">
              <i class="fa-solid fa-gear"></i> Ajustar
            </button>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 3px;">
            <span title="IA (!ia, Simi): ${feats.ai !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.ai !== false ? 'rgba(56,189,248,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.ai !== false ? '#38bdf8' : '#64748b'}; text-decoration: ${feats.ai !== false ? 'none' : 'line-through'};">IA</span>
            <span title="Divulgação em Grupos: ${feats.group_posts !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.group_posts !== false ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.group_posts !== false ? '#10b981' : '#64748b'}; text-decoration: ${feats.group_posts !== false ? 'none' : 'line-through'};">Grupos</span>
            <span title="Atendimento PV: ${feats.pv_chat !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.pv_chat !== false ? 'rgba(168,85,247,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.pv_chat !== false ? '#a855f7' : '#64748b'}; text-decoration: ${feats.pv_chat !== false ? 'none' : 'line-through'};">PV</span>
            <span title="Áudios/Voz: ${feats.audio_voice !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.audio_voice !== false ? 'rgba(234,179,8,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.audio_voice !== false ? '#eab308' : '#64748b'}; text-decoration: ${feats.audio_voice !== false ? 'none' : 'line-through'};">Voz</span>
            <span title="Downloads: ${feats.media_dl !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.media_dl !== false ? 'rgba(59,130,246,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.media_dl !== false ? '#3b82f6' : '#64748b'}; text-decoration: ${feats.media_dl !== false ? 'none' : 'line-through'};">Mídia</span>
            <span title="Stickers: ${feats.stickers !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.stickers !== false ? 'rgba(236,72,153,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.stickers !== false ? '#ec4899' : '#64748b'}; text-decoration: ${feats.stickers !== false ? 'none' : 'line-through'};">Stickers</span>
            <span title="Jogos: ${feats.games !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.games !== false ? 'rgba(249,115,22,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.games !== false ? '#f97316' : '#64748b'}; text-decoration: ${feats.games !== false ? 'none' : 'line-through'};">Jogos</span>
            <span title="Moderação: ${feats.moderation !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.moderation !== false ? 'rgba(20,184,166,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.moderation !== false ? '#14b8a6' : '#64748b'}; text-decoration: ${feats.moderation !== false ? 'none' : 'line-through'};">Mod</span>
            <span title="Aquecimento P2P: ${feats.auto_heating !== false ? 'Ativa' : 'Desativada'}" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${feats.auto_heating !== false ? 'rgba(239,68,68,0.2)' : 'rgba(100,116,139,0.2)'}; color: ${feats.auto_heating !== false ? '#ef4444' : '#64748b'}; text-decoration: ${feats.auto_heating !== false ? 'none' : 'line-through'};">Aquec</span>
          </div>
        </div>
      `;

      return `
        <tr>
          <td style="text-align: center;">
            <input type="checkbox" class="chk-army-subbot" data-id="${inst.id}" onchange="updateArmySubbotSelectionCount()">
          </td>
          <td>#${inst.id}</td>
          <td><b>${inst.name}</b>${mainBadge}</td>
          <td>${inst.phone ? `<b>${inst.phone}</b>` : '<span style="color:var(--text-muted)">Aguardando leitura</span>'}</td>
          <td>${statusBadge}</td>
          <td><b>${inst.messages_sent_today || 0}</b> <span style="font-size: 11px; color: var(--text-muted);">/ ${inst.daily_limit || 50}</span></td>
          <td>${featureBadgesHtml}</td>
          <td>${warmupBadge}</td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
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
              <button class="btn btn-sm btn-outline" onclick="openSubBotFeaturesModal(${inst.id})" title="Configurar Funções" style="color: #f59e0b; border-color: rgba(245,158,11,0.4);">
                <i class="fa-solid fa-sliders"></i>
              </button>
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

    updateArmySubbotSelectionCount();
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

async function requestArmyPairingCode(btnEl) {
  if (!currentArmyQrInstanceId) return;
  const phoneInput = document.getElementById('armyPairingPhone');
  const rawPhone = phoneInput ? phoneInput.value.trim() : '';
  const cleanDigits = rawPhone.replace(/\D/g, '');

  if (!cleanDigits || cleanDigits.length < 8) {
    showBotToast('Atenção', 'Informe o número com código do país (DDI). Ex: +55 48 98470-2848 ou +1 202 555-0199', 'warning');
    phoneInput?.focus();
    return;
  }

  const codeBox = document.getElementById('armyPairingCodeBox');
  const codeText = document.getElementById('armyPairingCodeText');
  let oldBtnHtml = '';
  if (btnEl) {
    oldBtnHtml = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
    btnEl.disabled = true;
  }

  if (codeText) codeText.innerText = 'GERANDO...';
  if (codeBox) codeBox.style.display = 'block';

  try {
    const res = await fetch(`/api/army/instances/${currentArmyQrInstanceId}/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: rawPhone })
    });
    const data = await res.json();
    if (res.ok && data.pairingCode) {
      if (codeText) codeText.innerText = data.pairingCode;
      showBotToast('Código Gerado', `Código ${data.pairingCode} gerado com sucesso!`, 'success');
    } else {
      if (codeText) codeText.innerText = 'ERRO';
      showBotToast('Erro no Pareamento', data.error || 'Falha ao gerar código.', 'error');
    }
  } catch (err) {
    if (codeText) codeText.innerText = 'ERRO';
    showBotToast('Erro de Conexão', err.message, 'error');
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldBtnHtml;
      btnEl.disabled = false;
    }
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

// =========================================================================
// 🎛️ CONTROLE DE FUNÇÕES DOS SUB-BOTS (DONO, DEVS & BOT MASTER)
// =========================================================================

const SUBBOT_FEATURE_CATALOG = [
  { id: 'ai', name: 'Inteligência Artificial', desc: 'Respostas com IA (!ia, Simi, atendimento cognitivo)', emoji: '🤖', icon: 'fa-brain' },
  { id: 'group_posts', name: 'Postagens em Grupos', desc: 'Disparo de ofertas, catálogo e achadinhos em grupos', emoji: '📢', icon: 'fa-bullhorn' },
  { id: 'pv_chat', name: 'Atendimento no PV', desc: 'Respostas e vendas 1-a-1 no chat privado do WhatsApp', emoji: '💬', icon: 'fa-comment-dots' },
  { id: 'audio_voice', name: 'Áudios & Voz', desc: 'Disparo de mensagens humanizadas de voz e ZapVoice', emoji: '🎙️', icon: 'fa-microphone' },
  { id: 'media_dl', name: 'Downloads de Mídia', desc: 'Comandos de download de músicas e vídeos (!play, !video)', emoji: '📥', icon: 'fa-download' },
  { id: 'stickers', name: 'Figurinhas & Stickers', desc: 'Criação de figurinhas estáticas e animadas (!s, !brat)', emoji: '🎨', icon: 'fa-icons' },
  { id: 'games', name: 'Jogos & Gamificação', desc: 'Gamificação, roleta, palpites e jogos de interação', emoji: '🎲', icon: 'fa-gamepad' },
  { id: 'moderation', name: 'Moderação de Grupos', desc: 'Anti-link, anti-fake, anti-delete e gestão de grupos', emoji: '🛡️', icon: 'fa-shield-halved' },
  { id: 'auto_heating', name: 'Aquecimento P2P', desc: 'Participação nas trocas de mensagens para maturação de chip', emoji: '🔥', icon: 'fa-fire' }
];

let activeModalSubBotInstance = null;

function getSelectedArmySubbotIds() {
  const checkboxes = document.querySelectorAll('.chk-army-subbot:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.id, 10)).filter(id => !isNaN(id));
}

function toggleSelectAllArmySubbots(checked) {
  const checkboxes = document.querySelectorAll('.chk-army-subbot');
  checkboxes.forEach(cb => { cb.checked = checked; });
  updateArmySubbotSelectionCount();
}

function updateArmySubbotSelectionCount() {
  const selected = getSelectedArmySubbotIds();
  const count = selected.length;
  const bar = document.getElementById('armyBatchActionBar');
  const badge = document.getElementById('armySelectedCountBadge');
  const chkAll = document.getElementById('chkArmySelectAll');
  const allCheckboxes = document.querySelectorAll('.chk-army-subbot');

  if (badge) {
    badge.innerHTML = `<i class="fa-solid fa-check-double"></i> ${count} sub-bot${count === 1 ? '' : 's'} selecionado${count === 1 ? '' : 's'}`;
  }

  if (bar) {
    bar.style.display = count > 0 ? 'flex' : 'none';
  }

  if (chkAll && allCheckboxes.length > 0) {
    chkAll.checked = (count === allCheckboxes.length);
    chkAll.indeterminate = (count > 0 && count < allCheckboxes.length);
  }
}

function clearArmySubbotSelection() {
  const checkboxes = document.querySelectorAll('.chk-army-subbot');
  checkboxes.forEach(cb => { cb.checked = false; });
  const chkAll = document.getElementById('chkArmySelectAll');
  if (chkAll) {
    chkAll.checked = false;
    chkAll.indeterminate = false;
  }
  updateArmySubbotSelectionCount();
}

async function applyBatchFeatureToggle(enabled) {
  const selectedIds = getSelectedArmySubbotIds();
  if (selectedIds.length === 0) {
    alert('Nenhum sub-bot selecionado. Marque as caixas de seleção na tabela.');
    return;
  }

  const selectEl = document.getElementById('selBatchFeatureKey');
  const featureKey = selectEl?.value || 'all';
  const actionText = enabled ? 'ATIVAR' : 'DESATIVAR';
  const featureLabel = selectEl?.selectedOptions[0]?.text || featureKey;

  const confirmMsg = `Deseja realmente ${actionText} a função "${featureLabel}" em ${selectedIds.length} sub-bot(s) selecionado(s)?`;
  if (!confirm(confirmMsg)) return;

  try {
    const payload = {
      targetIds: selectedIds,
      featureKey: featureKey,
      enabled: Boolean(enabled)
    };

    const res = await fetch('/api/subbots/features', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`Sucesso! ${data.message || 'Funções atualizadas nos sub-bots selecionados.'}`);
      await loadArmyInstances();
    } else {
      alert('Erro ao atualizar funções: ' + (data.error || 'Falha na requisição'));
    }
  } catch (err) {
    alert('Erro de conexão ao salvar funções em massa: ' + err.message);
  }
}

async function openSubBotFeaturesModal(instanceId) {
  const modal = document.getElementById('modalSubBotFeatures');
  const nameEl = document.getElementById('modalSubBotFeaturesName');
  const idEl = document.getElementById('modalSubBotFeaturesId');
  const gridEl = document.getElementById('subBotFeaturesListGrid');
  const statusEl = document.getElementById('subBotFeaturesSaveStatus');

  if (!modal || !gridEl) return;

  if (statusEl) statusEl.innerText = '';
  if (idEl) idEl.value = instanceId;

  const inst = currentArmyInstances.find(i => i.id === instanceId) || { id: instanceId, name: `Chip #${instanceId}` };
  activeModalSubBotInstance = inst;
  if (nameEl) {
    nameEl.innerText = `${inst.name || 'Chip #' + instanceId} ${inst.phone ? `(${inst.phone})` : ''}`;
  }

  let currentFeatures = inst.features;
  try {
    const res = await fetch(`/api/subbots/${instanceId}/features`);
    if (res.ok) {
      const data = await res.json();
      currentFeatures = data.features || currentFeatures;
    }
  } catch (e) {
    console.warn('Usando features em cache para modal:', e);
  }

  currentFeatures = currentFeatures || {
    ai: true, group_posts: true, pv_chat: true, audio_voice: true,
    media_dl: true, stickers: true, games: true, moderation: true, auto_heating: true
  };

  gridEl.innerHTML = SUBBOT_FEATURE_CATALOG.map(feat => {
    const isChecked = currentFeatures[feat.id] !== false;
    return `
      <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 13px; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
            <span>${feat.emoji}</span>
            <span>${feat.name}</span>
          </div>
          <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.3;">
            ${feat.desc}
          </div>
        </div>
        <label class="toggle-switch-sm" title="Ativar ou desativar ${feat.name}">
          <input type="checkbox" id="chkModalFeature_${feat.id}" class="chk-modal-subbot-feat" data-feature="${feat.id}" ${isChecked ? 'checked' : ''}>
          <span class="toggle-slider-sm"></span>
        </label>
      </div>
    `;
  }).join('');

  modal.classList.add('active');
}

function closeSubBotFeaturesModal() {
  const modal = document.getElementById('modalSubBotFeatures');
  if (modal) modal.classList.remove('active');
  activeModalSubBotInstance = null;
}

function toggleAllSubBotModalFeatures(enabled) {
  const inputs = document.querySelectorAll('.chk-modal-subbot-feat');
  inputs.forEach(inp => {
    inp.checked = enabled;
  });
}

async function saveSubBotFeaturesModal() {
  const idEl = document.getElementById('modalSubBotFeaturesId');
  const statusEl = document.getElementById('subBotFeaturesSaveStatus');
  const instanceId = parseInt(idEl?.value, 10);
  if (!instanceId) return;

  const featuresPatch = {};
  SUBBOT_FEATURE_CATALOG.forEach(feat => {
    const chk = document.getElementById(`chkModalFeature_${feat.id}`);
    if (chk) {
      featuresPatch[feat.id] = chk.checked;
    }
  });

  if (statusEl) {
    statusEl.style.color = '#38bdf8';
    statusEl.innerText = 'Salvando permissões...';
  }

  try {
    const res = await fetch(`/api/subbots/${instanceId}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: featuresPatch })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (statusEl) {
        statusEl.style.color = '#10b981';
        statusEl.innerText = '✓ Funções atualizadas com sucesso!';
      }
      setTimeout(async () => {
        closeSubBotFeaturesModal();
        await loadArmyInstances();
      }, 700);
    } else {
      if (statusEl) {
        statusEl.style.color = '#ef4444';
        statusEl.innerText = 'Erro: ' + (data.error || 'Falha ao salvar');
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = '#ef4444';
      statusEl.innerText = 'Erro de conexão: ' + err.message;
    }
  }
}

// --- 2. LINKS DE AFILIADO ---

async function loadArmyLinks() {
  try {
    const res = await fetch('/api/army/links');
    const data = await res.json();
    currentArmyLinks = Array.isArray(data) ? data : (data.links || []);

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
    const data = await res.json();
    currentArmyCampaigns = Array.isArray(data) ? data : (data.campaigns || []);

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
    const data = await res.json();
    const controls = Array.isArray(data) ? data : (data.controls || []);
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
    const data = await res.json();
    const logs = Array.isArray(data) ? data : (data.logs || []);

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

let allDiscoveredGroups = [];

async function populateGroupSettingsDropdown() {
  const sel = document.getElementById('groupSettingsSelect');
  if (!sel) return;

  try {
    if (allDiscoveredGroups.length === 0) {
      const res = await fetch('/api/whatsapp/groups');
      if (res.ok) {
        allDiscoveredGroups = await res.json();
      }
    }
  } catch (_) {}

  let html = '<option value="">-- Escolha um grupo na lista ou digite o ID abaixo --</option>';
  if (allDiscoveredGroups && allDiscoveredGroups.length > 0) {
    html += '<optgroup label="Grupos do WhatsApp Conectados">';
    allDiscoveredGroups.forEach(g => {
      html += `<option value="${g.id}">${g.subject} (${g.participantsCount || 0} membros)</option>`;
    });
    html += '</optgroup>';
  }

  if (currentMeteoricGroups && currentMeteoricGroups.length > 0) {
    html += '<optgroup label="Grupos do Lançamento Meteórico">';
    currentMeteoricGroups.forEach(g => {
      html += `<option value="${g.group_jid}">#${g.group_num} - ${g.title} (${g.member_count || 0} membros)</option>`;
    });
    html += '</optgroup>';
  }

  sel.innerHTML = html;
}

function onGroupSelectPickerChange(val) {
  if (!val) return;
  const inp = document.getElementById('groupSettingsId');
  if (inp) {
    inp.value = val;
    fetchGroupSettings();
  }
}

function openGroupSettingsModal(prefilledGroupId = null) {
  const m = document.getElementById('modalGroupSettings');
  if (m) {
    m.classList.add('active');
    populateGroupSettingsDropdown();
    if (prefilledGroupId) {
      const inp = document.getElementById('groupSettingsId');
      if (inp) inp.value = prefilledGroupId;
      const sel = document.getElementById('groupSettingsSelect');
      if (sel) sel.value = prefilledGroupId;
      fetchGroupSettings();
    }
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
    const chkBot = document.getElementById('chkGroupBotActive');
    const chkPost = document.getElementById('chkGroupPostingActive');
    const chkSoDivu = document.getElementById('chkGroupSoDivu');
    if (chkBot) chkBot.checked = data.botActive !== false && data.bot_active !== 0;
    if (chkPost) chkPost.checked = data.postingActive !== false && data.posting_active !== 0;
    if (chkSoDivu) chkSoDivu.checked = !!data.soDivu;
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
  const botActive = document.getElementById('chkGroupBotActive')?.checked;
  const postingActive = document.getElementById('chkGroupPostingActive')?.checked;
  const soDivu = document.getElementById('chkGroupSoDivu')?.checked;

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
        byeMsg,
        botActive,
        postingActive,
        soDivu
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar configurações do grupo.');

    alert('Configurações do grupo salvas com sucesso!');
    closeGroupSettingsModal();
    loadGroupAuditLogs();
    loadWhatsappGroupsList(false);
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
  const query = (filterInput && filterInput.value ? filterInput.value : '').toLowerCase().trim();

  const filtered = SYSTEM_COMMANDS.filter(item => {
    const matchCat = activeCmdCategory === 'all' || item.category === activeCmdCategory;
    const matchQuery = !query ||
      (item.cmd && item.cmd.toLowerCase().includes(query)) ||
      (item.syntax && item.syntax.toLowerCase().includes(query)) ||
      (item.desc && item.desc.toLowerCase().includes(query));
    return matchCat && matchQuery;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum comando encontrado para este filtro.</td></tr>`;
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
let meteoricFeedPollingInterval = null;

function startMeteoricFeedPolling() {
  if (meteoricFeedPollingInterval) return;
  meteoricFeedPollingInterval = setInterval(() => {
    loadMeteoricActivityLogs();
  }, 6000);
}

function stopMeteoricFeedPolling() {
  if (meteoricFeedPollingInterval) {
    clearInterval(meteoricFeedPollingInterval);
    meteoricFeedPollingInterval = null;
  }
}

async function loadMeteoricData() {
  await Promise.all([
    loadMeteoricStatus(),
    loadMeteoricStages(),
    loadMeteoricGroupsList(),
    loadMeteoricActivityLogs(),
    loadMeteoricArmyInstances()
  ]);
}

async function loadMeteoricStatus() {
  try {
    const res = await fetch('/api/meteoric/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.campaign) return;
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
  if (customTitle === null) return;

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

// Bulk abrir / fechar todos os grupos
async function setAllMeteoricGroupsMode(mode) {
  const isOpening = mode === 'open';
  const msg = isOpening 
    ? 'Deseja ABRIR todos os grupos do lançamento para que os participantes possam enviar mensagens?' 
    : 'Deseja FECHAR todos os grupos para modo anúncio (apenas administradores e sub-bots poderão enviar mensagens)?';
  
  if (!confirm(msg)) return;

  try {
    const res = await fetch('/api/meteoric/groups/mode-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`✅ Modo alterado com sucesso para ${data.count || 0} grupo(s)! (${isOpening ? 'Abertos para conversas' : 'Fechados em Modo Anúncio'})`);
      await loadMeteoricGroupsList();
      await loadMeteoricActivityLogs();
    } else {
      alert('Erro ao alterar modo dos grupos: ' + (data.error || 'Falha'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// Sincronizar participantes reais via Baileys
async function syncAllMeteoricGroups() {
  try {
    const res = await fetch('/api/meteoric/groups/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok) {
      alert(`🔄 Sincronização concluída! ${data.count || 0} grupo(s) verificados e contagens atualizadas.`);
      await loadMeteoricGroupsList();
      await loadMeteoricStatus();
    } else {
      alert('Erro ao sincronizar grupos: ' + (data.error || 'Falha'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function syncMeteoricGroup(groupJid) {
  try {
    const res = await fetch('/api/meteoric/groups/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid })
    });
    const data = await res.json();
    if (res.ok) {
      alert('🔄 Grupo sincronizado com o WhatsApp com sucesso!');
      await loadMeteoricGroupsList();
      await loadMeteoricStatus();
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function deleteMeteoricGroup(groupId, groupTitle) {
  if (!confirm(`Deseja realmente excluir/arquivar o grupo "${groupTitle || '#' + groupId}" do lançamento?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/meteoric/groups/${groupId}`, { method: 'DELETE' });
    if (res.ok) {
      alert('🗑️ Grupo removido da lista do lançamento.');
      await loadMeteoricGroupsList();
      await loadMeteoricStatus();
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function focusMeteoricMessageForGroup(groupJid) {
  const sel = document.getElementById('meteoricMsgTargetGroup');
  if (sel) {
    sel.value = groupJid;
  }
  const form = document.getElementById('formMeteoricWebMessage');
  if (form) {
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const txt = document.getElementById('meteoricMsgTextInput');
  if (txt) {
    txt.focus();
  }
}

async function loadMeteoricArmyInstances() {
  const sel = document.getElementById('meteoricMsgSpecificInstanceId');
  if (!sel) return;
  try {
    const res = await fetch('/api/army/instances');
    if (!res.ok) return;
    const data = await res.json();
    const instances = Array.isArray(data) ? data : (data.instances || []);
    if (!instances || instances.length === 0) {
      sel.innerHTML = '<option value="">Nenhum chip cadastrado no Exército</option>';
      return;
    }
    sel.innerHTML = instances.map(inst => {
      const isOnline = inst.status === 'CONNECTED';
      return `<option value="${inst.id}">Chip #${inst.id} - ${inst.name} (${isOnline ? '🟢 Online' : '⚪ Offline'})</option>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar instâncias para meteórico:', err);
  }
}

function toggleMeteoricSenderSelection() {
  const val = document.getElementById('meteoricMsgSenderType')?.value;
  const grp = document.getElementById('meteoricMsgSpecificSubbotGroup');
  if (grp) {
    grp.style.display = val === 'specific_subbot' ? 'block' : 'none';
  }
}

function fillMeteoricTemplate(type) {
  const txt = document.getElementById('meteoricMsgTextInput');
  if (!txt) return;

  if (type === 'social_proof') {
    txt.value = '{Acabei de garantir minha vaga|Comprei aqui agora}, deu super certo! Ansioso pra começar! 🔥';
  } else if (type === 'doubt_pix') {
    txt.value = '{Gente, o pagamento no Pix|Pessoal, fazendo no Pix} o acesso é liberado no mesmo segundo?';
  } else if (type === 'urgency') {
    txt.value = '🚨 ATENÇÃO: Restam pouquíssimas vagas com o valor de lançamento! Quem não aproveitar agora vai perder o bônus exclusivo.';
  } else if (type === 'link_offer') {
    txt.value = '👉 VAGAS LIBERADAS! Acesse o link oficial para garantir sua vaga com condição especial: {link}';
  }
  txt.focus();
}

async function sendMeteoricWebMessage(e) {
  if (e && e.preventDefault) e.preventDefault();
  const targetGroupJid = document.getElementById('meteoricMsgTargetGroup')?.value;
  const senderTypeVal = document.getElementById('meteoricMsgSenderType')?.value;
  const specificId = document.getElementById('meteoricMsgSpecificInstanceId')?.value;
  const text = document.getElementById('meteoricMsgTextInput')?.value.trim();
  const mediaUrl = document.getElementById('meteoricMsgMediaUrl')?.value.trim() || undefined;

  if (!text) {
    alert('Digite o texto da mensagem antes de enviar.');
    return;
  }

  const senderType = senderTypeVal === 'specific_subbot' ? 'subbot' : senderTypeVal;
  const senderInstanceId = senderTypeVal === 'specific_subbot' ? (parseInt(specificId, 10) || null) : null;

  const btn = document.getElementById('btnSendMeteoricMsg');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando...';
  }

  try {
    const res = await fetch('/api/meteoric/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetGroupJid: targetGroupJid === 'all' ? null : targetGroupJid,
        senderType,
        senderInstanceId,
        text,
        mediaUrl
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`🚀 Mensagem enviada com sucesso para ${data.totalSent || 0} grupo(s)!`);
      const txtInput = document.getElementById('meteoricMsgTextInput');
      if (txtInput) txtInput.value = '';
      const mediaInput = document.getElementById('meteoricMsgMediaUrl');
      if (mediaInput) mediaInput.value = '';
      await loadMeteoricActivityLogs();
    } else {
      alert('Erro ao enviar mensagem: ' + (data.error || 'Falha no envio'));
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Mensagem Agora para os Grupos';
    }
  }
}

async function loadMeteoricGroupsList() {
  const tbody = document.getElementById('tableMeteoricGroupsBody');
  const targetSel = document.getElementById('meteoricMsgTargetGroup');
  if (!tbody) return;

  try {
    const res = await fetch('/api/meteoric/groups');
    if (!res.ok) return;
    const data = await res.json();
    const groups = Array.isArray(data) ? data : (data.groups || []);
    currentMeteoricGroups = groups;

    // Atualiza seletor de grupos no mensageiro web e no simulador
    if (targetSel) {
      const currentVal = targetSel.value;
      let optionsHtml = '<option value="all">📢 Todos os Grupos do Lançamento</option>';
      if (groups && groups.length > 0) {
        optionsHtml += groups.map(g => `<option value="${g.group_jid}">#${g.group_num} - ${g.title} (${g.member_count} membros)</option>`).join('');
      }
      targetSel.innerHTML = optionsHtml;
      if (currentVal && groups.some(g => g.group_jid === currentVal)) {
        targetSel.value = currentVal;
      }
    }

    const simTargetSel = document.getElementById('simTargetGroup');
    if (simTargetSel) {
      const currentSimVal = simTargetSel.value;
      let simHtml = '<option value="preview_only">👁️ Apenas Visualizar na Tela (Preview)</option><option value="all">📢 Todos os Grupos do Lançamento</option>';
      if (groups && groups.length > 0) {
        simHtml += groups.map(g => `<option value="${g.group_jid}">#${g.group_num} - ${g.title} (${g.member_count} membros)</option>`).join('');
      }
      simTargetSel.innerHTML = simHtml;
      if (currentSimVal) simTargetSel.value = currentSimVal;
    }

    if (!groups || groups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum grupo cadastrado ainda. Clique em "Novo Grupo VIP" acima para criar o primeiro.</td></tr>`;
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
              <span>${g.member_count || 0} / ${g.max_limit || 200} membros</span>
              <b>${pct}%</b>
            </div>
            <div class="progress" style="height:6px; background:rgba(255,255,255,0.05); border-radius:3px;">
              <div class="progress-bar" style="width:${pct}%; background:${pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#f97316'}; height:100%;"></div>
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
            <div style="display:flex; gap:5px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-sm btn-secondary" onclick="toggleMeteoricGroupMode(${g.id}, '${g.is_closed ? 'open' : 'closed'}')" title="${g.is_closed ? 'Abrir grupo para conversas' : 'Fechar grupo (apenas admins)'}">
                <i class="fa-solid ${g.is_closed ? 'fa-lock-open' : 'fa-lock'}"></i>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="focusMeteoricMessageForGroup('${g.group_jid}')" title="Enviar mensagem web direta neste grupo" style="color:#38bdf8;">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
              <button class="btn btn-sm btn-primary" onclick="triggerWarmupForGroup('${g.group_jid}')" title="Disparar conversa de sub-bots neste grupo" style="background:#f97316; border-color:#f97316;">
                <i class="fa-solid fa-fire"></i>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="exportMeteoricGroupLeadsCsv(${g.id}, '${g.title}')" title="Exportar Leads deste Grupo (CSV)" style="color:#10b981;">
                <i class="fa-solid fa-file-csv"></i>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="syncMeteoricGroup('${g.group_jid}')" title="Sincronizar participantes reais">
                <i class="fa-solid fa-arrows-rotate"></i>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="deleteMeteoricGroup(${g.id}, '${g.title}')" title="Remover grupo do lançamento" style="color:#ef4444;">
                <i class="fa-solid fa-trash-can"></i>
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
    const data = await res.json();
    currentMeteoricStages = Array.isArray(data) ? data : (data.stages || []);
    if (currentMeteoricStages.length > 0) {
      selectMeteoricStageView(currentEditingStageNum);
    }
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

  // Atualiza destaque no Stepper das 5 etapas
  for (let s = 1; s <= 5; s++) {
    const card = document.getElementById(`stepCard${s}`);
    if (card) {
      if (s === stageNum) {
        card.style.borderColor = '#f97316';
        card.style.background = 'rgba(249, 115, 22, 0.08)';
        card.style.boxShadow = '0 0 10px rgba(249, 115, 22, 0.2)';
      } else {
        card.style.borderColor = 'var(--border-color)';
        card.style.background = 'rgba(255,255,255,0.03)';
        card.style.boxShadow = 'none';
      }
    }
  }

  const stage = currentMeteoricStages.find(s => s.stage_num === stageNum);
  if (!stage) return;

  const titleEl = document.getElementById('stageEditorTitle');
  if (titleEl) titleEl.innerText = stage.title;

  const modeSelect = document.getElementById('stageEditorGroupMode');
  if (modeSelect) modeSelect.value = stage.group_mode || 'announcement';

  const annEl = document.getElementById('stageEditorAnnouncement');
  if (annEl) annEl.value = stage.admin_announcement || '';

  const mediaEl = document.getElementById('stageEditorMediaUrl');
  if (mediaEl) mediaEl.value = stage.media_url || '';

  const schedEl = document.getElementById('stageEditorScheduledAt');
  if (schedEl) {
    schedEl.value = stage.scheduled_at ? stage.scheduled_at.replace(' ', 'T').slice(0, 16) : '';
  }

  const autoExecEl = document.getElementById('stageEditorAutoExecute');
  if (autoExecEl) {
    autoExecEl.checked = !!stage.auto_execute;
  }

  const scriptsEl = document.getElementById('stageEditorScripts');
  if (scriptsEl) {
    let pretty = stage.subbot_scripts;
    try {
      if (typeof pretty === 'string') pretty = JSON.stringify(JSON.parse(pretty), null, 2);
    } catch (_) {}
    scriptsEl.value = pretty || '[]';
  }
}

function triggerDirectStageWarmup(stageNum) {
  selectMeteoricStageView(stageNum);
  triggerMeteoricStageWarmup();
}

async function saveMeteoricStageEditor() {
  const stageNum = currentEditingStageNum;
  const group_mode = document.getElementById('stageEditorGroupMode')?.value;
  const admin_announcement = document.getElementById('stageEditorAnnouncement')?.value.trim();
  const media_url = document.getElementById('stageEditorMediaUrl')?.value.trim() || null;
  const scheduled_at = document.getElementById('stageEditorScheduledAt')?.value || null;
  const auto_execute = document.getElementById('stageEditorAutoExecute')?.checked ? 1 : 0;
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
      body: JSON.stringify({ group_mode, admin_announcement, subbot_scripts, media_url, scheduled_at, auto_execute })
    });
    if (res.ok) {
      alert(`✅ Diretrizes da Etapa #${stageNum} salvas com sucesso!${auto_execute && scheduled_at ? '\n⏰ Agendamento automático ativo para ' + scheduled_at : ''}`);
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
  if (!confirm(`Confirmar disparo da ETAPA #${stageNum} nos grupos meteóricos?\n\nO comunicado oficial será postado e os sub-bots iniciarão a conversação e aquecimento agendados.`)) {
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
      await loadMeteoricActivityLogs();
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
      await loadMeteoricActivityLogs();
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
      await loadMeteoricActivityLogs();
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// Feed de Atividades ao Vivo (Live Activity Stream)
async function loadMeteoricActivityLogs() {
  const feedEl = document.getElementById('meteoricActivityFeed');
  if (!feedEl) return;

  try {
    const res = await fetch('/api/meteoric/activity-logs?limit=40');
    if (!res.ok) return;
    const data = await res.json();
    const logs = Array.isArray(data) ? data : (data.logs || []);

    if (!logs || logs.length === 0) {
      feedEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 18px; font-size: 13px;">Nenhuma atividade recente registrada no lançamento. Novos membros, anúncios e conversas aparecerão aqui em tempo real.</div>`;
      return;
    }

    feedEl.innerHTML = logs.map(item => {
      let icon = 'fa-solid fa-circle-info';
      let badgeColor = 'rgba(56, 189, 248, 0.15)';
      let textColor = '#38bdf8';
      let eventLabel = item.event_type;

      if (item.event_type === 'MEMBER_JOINED') {
        icon = 'fa-solid fa-user-plus';
        badgeColor = 'rgba(16, 185, 129, 0.15)';
        textColor = '#10b981';
        eventLabel = 'NOVO LEAD';
      } else if (item.event_type === 'OVERFLOW') {
        icon = 'fa-solid fa-triangle-exclamation';
        badgeColor = 'rgba(239, 68, 68, 0.15)';
        textColor = '#ef4444';
        eventLabel = 'TRANSBORDAMENTO';
      } else if (item.event_type === 'ANNOUNCEMENT') {
        icon = 'fa-solid fa-bullhorn';
        badgeColor = 'rgba(59, 130, 246, 0.15)';
        textColor = '#3b82f6';
        eventLabel = 'ANÚNCIO ADMIN';
      } else if (item.event_type === 'SUBBOT_MESSAGE') {
        icon = 'fa-solid fa-robot';
        badgeColor = 'rgba(168, 85, 247, 0.15)';
        textColor = '#a855f7';
        eventLabel = 'FALA SUB-BOT';
      } else if (item.event_type === 'MODE_CHANGED') {
        icon = 'fa-solid fa-shield-halved';
        badgeColor = 'rgba(245, 158, 11, 0.15)';
        textColor = '#f59e0b';
        eventLabel = 'MODO GRUPO';
      } else if (item.event_type === 'WEB_MESSAGE') {
        icon = 'fa-solid fa-paper-plane';
        badgeColor = 'rgba(14, 203, 129, 0.15)';
        textColor = '#0ecb81';
        eventLabel = 'DISPARO WEB';
      } else if (item.event_type === 'MEMBER_MESSAGE') {
        icon = 'fa-solid fa-comment-dots';
        badgeColor = 'rgba(234, 179, 8, 0.15)';
        textColor = '#eab308';
        eventLabel = 'DÚVIDA LEAD';
      } else if (item.event_type === 'SCHEDULED_STAGE_TRIGGERED') {
        icon = 'fa-solid fa-clock';
        badgeColor = 'rgba(192, 132, 252, 0.15)';
        textColor = '#c084fc';
        eventLabel = 'CRON AUTOMÁTICO';
      }

      const formattedTime = item.created_at ? new Date(item.created_at).toLocaleTimeString('pt-BR') : '';
      const isLeadMessage = item.event_type === 'MEMBER_MESSAGE';

      return `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
            <span class="badge" style="background: ${badgeColor}; color: ${textColor}; border: 1px solid ${textColor}40; font-size: 10px; font-weight: 700; white-space: nowrap;">
              <i class="${icon}"></i> ${eventLabel}
            </span>
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <b style="color: #fff;">${item.group_title || 'Grupo VIP'}</b>
              ${item.sender_name ? `<span style="color: var(--text-muted); font-size: 12px;"> · ${item.sender_name}:</span>` : ''}
              <span style="color: #cbd5e1; margin-left: 4px;">"${item.message_text || ''}"</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${isLeadMessage && item.group_jid ? `
              <button class="btn btn-sm btn-secondary" onclick="replyToMeteoricLead('${item.group_jid}', '${escape(item.sender_name || '')}')" style="font-size: 11px; padding: 2px 8px; color: #38bdf8;" title="Responder este lead no grupo">
                <i class="fa-solid fa-reply"></i> Responder
              </button>
            ` : ''}
            <span style="font-size: 11px; color: var(--text-muted); font-family: monospace; white-space: nowrap;">${formattedTime}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar logs de atividade meteórica:', err);
  }
}

function replyToMeteoricLead(groupJid, escapedSenderName) {
  const senderName = unescape(escapedSenderName || '');
  const sel = document.getElementById('meteoricMsgTargetGroup');
  if (sel) sel.value = groupJid;
  const txt = document.getElementById('meteoricMsgTextInput');
  if (txt) {
    txt.value = senderName ? `@${senderName} ` : '';
    txt.focus();
  }
  const form = document.getElementById('formMeteoricWebMessage');
  if (form) {
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function clearMeteoricActivityLogs() {
  if (!confirm('Deseja limpar todo o histórico de atividades do lançamento?')) return;
  try {
    const res = await fetch('/api/meteoric/activity-logs', { method: 'DELETE' });
    if (res.ok) {
      await loadMeteoricActivityLogs();
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

// ==========================================
// 15. RADAR VIRAL & CRIADOR DE POSTS COM IA
// ==========================================
let globalViralCapturedCache = [];
let globalViralGeneratedCache = [];

async function loadViralRadarAll() {
  await Promise.all([
    loadViralStats(),
    loadViralProfiles(),
    loadViralCapturedPosts(),
    loadViralGeneratedPosts()
  ]);
}

async function loadViralStats() {
  try {
    const res = await fetch('/api/viral/stats');
    if (!res.ok) return;
    const stats = await res.json();
    const elProf = document.getElementById('viralStatProfiles');
    const elCapt = document.getElementById('viralStatCaptured');
    const elGen = document.getElementById('viralStatGenerated');
    const elAvg = document.getElementById('viralStatAvgScore');

    if (elProf) elProf.innerText = `${stats.totalProfiles} contas`;
    if (elCapt) elCapt.innerText = `${stats.totalCaptured} virais`;
    if (elGen) elGen.innerText = `${stats.totalGenerated} copies`;
    if (elAvg) elAvg.innerText = `${stats.avgViralScore} / 100`;
  } catch (_) {}
}

async function loadViralProfiles() {
  const tbody = document.getElementById('viralProfilesTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/viral/profiles');
    if (!res.ok) return;
    const profiles = await res.json();

    if (profiles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">Nenhum perfil cadastrado. Clique no botão acima para adicionar um @ do Instagram ou Facebook!</td></tr>`;
      return;
    }

    tbody.innerHTML = profiles.map(p => {
      const isIg = p.platform === 'instagram';
      const platBadge = isIg
        ? `<span class="badge" style="background: rgba(225,48,108,0.15); color: #e1306c;"><i class="fa-brands fa-instagram"></i> Instagram</span>`
        : `<span class="badge" style="background: rgba(24,119,242,0.15); color: #1877f2;"><i class="fa-brands fa-facebook"></i> Facebook</span>`;
      const dateStr = p.last_scraped_at ? new Date(p.last_scraped_at).toLocaleString('pt-BR') : 'Ainda não varrido';

      return `
        <tr>
          <td>${platBadge}</td>
          <td>
            <a href="${p.profile_url || '#'}" target="_blank" style="color: #60a5fa; font-weight: 600; text-decoration: none;">
              @${p.username} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 10px;"></i>
            </a>
          </td>
          <td><b>${p.display_name || p.username}</b></td>
          <td><span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0;">${p.niche || 'Geral'}</span></td>
          <td>${p.followers_count > 0 ? p.followers_count.toLocaleString('pt-BR') : '~15.000'}</td>
          <td><b style="color: #f97316;">${p.total_captured || 0} posts</b></td>
          <td style="font-size: 12px; color: var(--text-muted);">${dateStr}</td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button class="btn btn-sm btn-primary" onclick="triggerViralProfileScrape(${p.id})" title="Buscar virais deste perfil agora" style="background: #f97316; border-color: #f97316;">
                <i class="fa-solid fa-arrows-rotate"></i> Varrer
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteViralProfile(${p.id})" title="Remover perfil do radar">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">Falha ao carregar perfis: ${err.message}</td></tr>`;
  }
}

async function loadViralCapturedPosts() {
  const container = document.getElementById('viralPostsGrid');
  if (!container) return;

  const platform = document.getElementById('viralFilterPlatform')?.value || '';
  const minScore = document.getElementById('viralFilterScore')?.value || '';

  try {
    const params = new URLSearchParams();
    if (platform) params.append('platform', platform);
    if (minScore) params.append('min_score', minScore);

    const res = await fetch(`/api/viral/posts?${params.toString()}`);
    if (!res.ok) return;
    const posts = await res.json();
    globalViralCapturedCache = posts;

    // Atualiza opções do select de modal se existir
    updateViralSelectOptions(posts);

    if (posts.length === 0) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">Nenhum conteúdo viral encontrado com esses filtros. Tente clicar em "Varredura Geral" para capturar novidades!</div>`;
      return;
    }

    container.innerHTML = posts.map(p => {
      const isIg = p.platform === 'instagram';
      const platIcon = isIg ? '<i class="fa-brands fa-instagram" style="color: #e1306c;"></i>' : '<i class="fa-brands fa-facebook" style="color: #1877f2;"></i>';
      const scoreColor = p.viral_score >= 90 ? '#ef4444' : '#f97316';
      const statusBadge = p.status === 'USED' 
        ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-check"></i> Post Já Criado</span>`
        : `<span class="badge" style="background: rgba(249,115,22,0.15); color: #f97316;">🔥 Novo Viral</span>`;

      return `
        <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); border-radius: 10px; overflow: hidden;">
          <div style="position: relative; height: 160px; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <img src="${p.thumbnail_url || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=500&auto=format&fit=crop&q=60'}" 
                 alt="Thumbnail" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.65;">
            <div style="position: absolute; top: 10px; left: 10px; display: flex; gap: 6px;">
              <span class="badge" style="background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); font-size: 11px;">
                ${platIcon} @${p.source_username}
              </span>
            </div>
            <div style="position: absolute; top: 10px; right: 10px;">
              <span class="badge" style="background: ${scoreColor}; color: #fff; font-weight: 700; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                🔥 ${p.viral_score}/100
              </span>
            </div>
            <div style="position: absolute; bottom: 8px; left: 10px; right: 10px; display: flex; justify-content: space-between; align-items: center; color: #fff; font-size: 11px; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 4px;">
              <span><i class="fa-solid fa-heart" style="color: #ef4444;"></i> ${p.likes_count.toLocaleString('pt-BR')}</span>
              <span><i class="fa-solid fa-comment" style="color: #3b82f6;"></i> ${p.comments_count.toLocaleString('pt-BR')}</span>
              <span><i class="fa-solid fa-share" style="color: #10b981;"></i> ${p.shares_count.toLocaleString('pt-BR')}</span>
            </div>
          </div>
          <div style="padding: 16px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                ${statusBadge}
                <small style="color: var(--text-muted); font-size: 11px;">${new Date(p.captured_at).toLocaleDateString('pt-BR')}</small>
              </div>
              <h4 style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.4; color: #f8fafc;">
                "${p.hook_text || p.caption.slice(0, 90)}..."
              </h4>
              <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0 0 14px 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                ${p.caption}
              </p>
            </div>
            <div style="display: flex; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: auto;">
              <button class="btn btn-sm btn-primary flex-1" onclick="openGenerateViralPostModal(${p.id})" style="background: #10b981; border-color: #10b981; font-weight: 600;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Nosso Post
              </button>
              <button class="btn btn-sm btn-secondary" onclick="downloadViralMediaFromUrl('${p.post_url}')" title="Baixar Vídeo/Mídia Original">
                <i class="fa-solid fa-download"></i> Baixar Mídia
              </button>
              <a href="${p.post_url}" target="_blank" class="btn btn-sm btn-outline" title="Ver post original">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
              <button class="btn btn-sm btn-outline" onclick="deleteViralCapturedPost(${p.id})" title="Excluir post viral">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 30px;">Erro ao carregar conteúdos virais: ${err.message}</div>`;
  }
}

function updateViralSelectOptions(posts) {
  const sel = document.getElementById('genViralPostId');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">Selecione um post viral de referência...</option>' +
    posts.map(p => `
      <option value="${p.id}">[Score ${p.viral_score}/100] @${p.source_username}: "${(p.hook_text || p.caption).slice(0, 70)}..."</option>
    `).join('');
  if (currentVal) sel.value = currentVal;
}

async function loadViralGeneratedPosts() {
  const container = document.getElementById('viralGeneratedList');
  if (!container) return;

  try {
    const res = await fetch('/api/viral/generated');
    if (!res.ok) return;
    const list = await res.json();
    globalViralGeneratedCache = list;

    if (list.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhum post gerado ainda. Selecione qualquer viral acima e clique em "Gerar Nosso Post com IA"!</div>`;
      return;
    }

    container.innerHTML = list.map(g => {
      const isPublished = g.status === 'PUBLISHED';
      const statusBadge = isPublished
        ? `<span class="badge" style="background: rgba(16,185,129,0.2); color: #10b981;"><i class="fa-solid fa-circle-check"></i> Publicado / Disparado</span>`
        : `<span class="badge" style="background: rgba(59,130,246,0.2); color: #3b82f6;"><i class="fa-solid fa-clock"></i> Pronto para Uso</span>`;

      return `
        <div class="card" style="border: 1px solid rgba(16,185,129,0.25); background: rgba(16,185,129,0.02); border-radius: 10px; padding: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
            <div>
              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
                ${statusBadge}
                <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0;"><i class="fa-solid fa-bullseye"></i> ${g.objective || 'Vendas'}</span>
                <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0;"><i class="fa-solid fa-comment-dots"></i> ${g.tone || 'Persuasivo'}</span>
                <span class="badge" style="background: rgba(37,211,102,0.15); color: #25d366;"><i class="fa-brands fa-whatsapp"></i> ${g.target_platform.toUpperCase()}</span>
                ${g.product_name ? `<span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b;"><i class="fa-solid fa-box-open"></i> ${g.product_name}</span>` : ''}
              </div>
              <h4 style="margin: 0; color: #fff; font-size: 15px;">${g.title}</h4>
              <small style="color: var(--text-muted);">Inspirado no viral de @${g.source_username || 'referência'} • Criado em ${new Date(g.created_at).toLocaleString('pt-BR')}</small>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button class="btn btn-sm btn-primary" onclick="copyViralContent(${JSON.stringify(g.full_content).replace(/"/g, '&quot;')})" style="background: #10b981; border-color: #10b981; font-weight: 600;">
                <i class="fa-solid fa-copy"></i> Copiar Copy
              </button>
              <button class="btn btn-sm btn-primary" onclick="openPublishViralSocialModal(${g.id})" style="background: #3b82f6; border-color: #3b82f6; font-weight: 600;" title="Postar nas Redes Sociais Conectadas">
                <i class="fa-solid fa-share-nodes"></i> Postar na Rede
              </button>
              <button class="btn btn-sm btn-primary" onclick="broadcastViralPost(${g.id}, 'subbots')" style="background: #25d366; border-color: #25d366; font-weight: 600;" title="Disparar via Exército de Sub-Bots WhatsApp">
                <i class="fa-solid fa-tower-broadcast"></i> Disparar Sub-Bots
              </button>
              <button class="btn btn-sm btn-outline" onclick="deleteViralGeneratedPost(${g.id})" title="Excluir este post">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; margin-bottom: 12px; white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #cbd5e1; font-family: inherit;">
${g.full_content}
          </div>

          ${g.media_url ? `
            <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px; background: rgba(168,85,247,0.06); padding: 10px; border-radius: 8px; border: 1px solid rgba(168,85,247,0.25);">
              <img src="${g.media_url}" style="width: 76px; height: 76px; object-fit: cover; border-radius: 6px; border: 1px solid #a855f7; cursor: pointer;" onclick="window.open('${g.media_url}', '_blank')" alt="Arte do Post ComfyArt" />
              <div style="flex: 1;">
                <div style="font-size: 13px; color: #c084fc; font-weight: 700;"><i class="fa-solid fa-palette"></i> Criativo Visual ComfyArt</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Arte HD gerada pronta para Story, Feed e WhatsApp.</div>
              </div>
              <div style="display: flex; gap: 6px;">
                <a href="${g.media_url}" target="_blank" download class="btn btn-sm btn-outline" style="border-color: #a855f7; color: #c084fc;"><i class="fa-solid fa-download"></i> Baixar Arte</a>
                <button class="btn btn-sm btn-outline" onclick="openInComfyArtStudio(${g.id})"><i class="fa-solid fa-pen-ruler"></i> Abrir no Studio</button>
              </div>
            </div>
          ` : `
            <div style="margin-bottom: 12px; display: flex; justify-content: flex-end;">
              <button class="btn btn-sm btn-outline" style="border-color: #a855f7; color: #c084fc;" onclick="createComfyArtForViralPost(${g.id})">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Arte no ComfyArt Studio
              </button>
            </div>
          `}

          ${g.media_suggestion ? `
            <div style="background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.2); border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #93c5fd;">
              <b>💡 Roteiro Visual Sugerido:</b> ${g.media_suggestion}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Falha ao carregar posts gerados: ${err.message}</div>`;
  }
}

// Modais e Ações do Radar Viral
function openAddViralProfileModal() {
  document.getElementById('formAddViralProfile')?.reset();
  const m = document.getElementById('modalAddViralProfile');
  if (m) m.classList.add('active');
}

function closeAddViralProfileModal() {
  const m = document.getElementById('modalAddViralProfile');
  if (m) m.classList.remove('active');
}

async function saveViralProfile(event) {
  event.preventDefault();
  const platform = document.getElementById('viralNewPlatform').value;
  const username = document.getElementById('viralNewUsername').value;
  const niche = document.getElementById('viralNewNiche').value;
  const notes = document.getElementById('viralNewNotes').value;

  try {
    const res = await fetch('/api/viral/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, username, niche, notes })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao cadastrar perfil');
    }
    closeAddViralProfileModal();
    alert(`✅ Perfil @${username} cadastrado com sucesso! Iniciando varredura de virais...`);
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function deleteViralProfile(id) {
  if (!confirm('Deseja realmente remover este perfil e todos os posts virais capturados dele?')) return;
  try {
    const res = await fetch(`/api/viral/profiles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadViralRadarAll();
    }
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

async function triggerViralProfileScrape(id) {
  try {
    const res = await fetch(`/api/viral/profiles/${id}/scrape`, { method: 'POST' });
    const data = await res.json();
    alert(`✅ Varredura concluída! ${data.capturedCount || 0} posts virais atualizados.`);
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro na varredura: ' + err.message);
  }
}

async function triggerViralScrapeAll() {
  try {
    const res = await fetch('/api/viral/scrape-all', { method: 'POST' });
    const data = await res.json();
    alert(`✅ Varredura geral concluída em ${data.results?.length || 0} perfis monitorados!`);
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro na varredura geral: ' + err.message);
  }
}

async function openGenerateViralPostModal(preselectedPostId = null) {
  const m = document.getElementById('modalGenerateViralPost');
  if (!m) return;

  // Carrega produtos no select se ainda não carregados
  const prodSel = document.getElementById('genViralProductId');
  if (prodSel) {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const prods = await res.json();
        prodSel.innerHTML = prods.map(p => `
          <option value="${p.id}">${p.name} - R$ ${(p.price_brl || 0).toFixed(2)} (${p.price_usdt || 0} USDT)</option>
        `).join('');
      }
    } catch (_) {}
  }

  // Preenche select de posts virais a partir do cache
  updateViralSelectOptions(globalViralCapturedCache);

  if (preselectedPostId) {
    const postSel = document.getElementById('genViralPostId');
    if (postSel) postSel.value = preselectedPostId;
    onSelectViralPostForGen();
  }

  m.classList.add('active');
}

function closeGenerateViralPostModal() {
  const m = document.getElementById('modalGenerateViralPost');
  if (m) m.classList.remove('active');
}

function onSelectViralPostForGen() {
  const val = document.getElementById('genViralPostId')?.value;
  const box = document.getElementById('genViralPreviewBox');
  const txt = document.getElementById('genViralHookPreview');
  if (!val || !box || !txt) {
    if (box) box.style.display = 'none';
    return;
  }

  const found = globalViralCapturedCache.find(p => String(p.id) === String(val));
  if (found) {
    txt.innerText = `"${found.hook_text || found.caption}"`;
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

async function executeGenerateViralPost(event) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmitGenViral');
  const viralPostId = document.getElementById('genViralPostId').value;
  const productId = document.getElementById('genViralProductId').value;
  const targetPlatform = document.getElementById('genViralPlatform').value;
  const tone = document.getElementById('genViralTone').value;
  const objective = document.getElementById('genViralObjective').value;
  const customInstructions = document.getElementById('genViralInstructions').value;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Criando post persuasivo...`;
  }

  try {
    const res = await fetch('/api/viral/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        viralPostId,
        productId,
        targetPlatform,
        tone,
        objective,
        customInstructions
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao gerar post');
    }

    const data = await res.json();
    closeGenerateViralPostModal();
    alert(`🎉 Post gerado com sucesso com base no viral de @${data.sourceViral?.source_username}!\n\nConfira na seção "Nossos Posts Prontos".`);
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Nosso Post com IA`;
    }
  }
}

async function deleteViralCapturedPost(id) {
  if (!confirm('Deseja excluir este post viral capturado?')) return;
  try {
    await fetch(`/api/viral/posts/${id}`, { method: 'DELETE' });
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

async function deleteViralGeneratedPost(id) {
  if (!confirm('Deseja excluir este post gerado?')) return;
  try {
    await fetch(`/api/viral/generated/${id}`, { method: 'DELETE' });
    await loadViralRadarAll();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

async function broadcastViralPost(id, channel = 'subbots') {
  if (!confirm('Deseja disparar esta copy gerada através dos Sub-Bots do WhatsApp?')) return;
  try {
    const res = await fetch(`/api/viral/generated/${id}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });
    if (res.ok) {
      alert('🚀 Disparo iniciado com sucesso através do Exército de WhatsApp!');
      await loadViralGeneratedPosts();
    }
  } catch (err) {
    alert('Erro ao disparar: ' + err.message);
  }
}

function copyViralContent(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('📋 Copy completa copiada para a área de transferência!');
  });
}

async function downloadViralMediaFromUrl(postUrl) {
  if (!postUrl) {
    alert('URL do post não informada.');
    return;
  }
  
  const confirmed = confirm('Deseja extrair e baixar a mídia/vídeo viral deste post?\n\nURL: ' + postUrl);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/viral/download-media?url=' + encodeURIComponent(postUrl));
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao baixar mídia');
    }

    if (data.downloadUrl) {
      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.download = data.filename || 'viral-video.mp4';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      alert('🎉 Mídia viral encontrada!\n\nTítulo: ' + (data.title || 'Vídeo Viral') + '\nO download foi iniciado.');
    } else {
      alert('ℹ️ ' + (data.message || 'Mídia processada com sucesso.'));
    }
  } catch (err) {
    alert('Erro ao extrair mídia viral: ' + err.message);
  }
}

async function openPublishViralSocialModal(postId) {
  const m = document.getElementById('modalPublishViralSocial');
  if (!m) return;

  const idInput = document.getElementById('pubViralPostId');
  const txtInput = document.getElementById('pubViralText');
  const accSelect = document.getElementById('pubViralAccountId');
  const mediaInput = document.getElementById('pubViralMediaUrl');

  if (idInput) idInput.value = postId;

  // Carregar dados do post gerado
  let post = (globalViralGeneratedCache || []).find(p => String(p.id) === String(postId));
  if (!post) {
    try {
      const res = await fetch('/api/viral/generated');
      if (res.ok) {
        const list = await res.json();
        globalViralGeneratedCache = list;
        post = list.find(p => String(p.id) === String(postId));
      }
    } catch (_) {}
  }

  if (post && txtInput) {
    txtInput.value = post.full_content || '';
  }

  // Carregar contas sociais conectadas
  if (accSelect) {
    accSelect.innerHTML = '<option value="">Carregando contas sociais...</option>';
    try {
      const res = await fetch('/api/social/accounts');
      if (res.ok) {
        const accounts = await res.json();
        if (accounts.length === 0) {
          accSelect.innerHTML = '<option value="">Nenhuma conta social conectada. Conecte uma na aba Social!</option>';
        } else {
          const platformNames = {
            instagram: 'Instagram',
            facebook: 'Facebook',
            threads: 'Threads',
            x: 'X (Twitter)',
            tiktok: 'TikTok',
            olx: 'OLX',
            marketplace_facebook: 'Marketplace FB',
            snapchat: 'Snapchat',
            shopee: 'Shopee',
            mercadolivre: 'Mercado Livre',
            shein: 'Shein',
            reddit: 'Reddit',
            blog: 'Blog / CMS'
          };
          accSelect.innerHTML = '<option value="">Selecione a conta de destino...</option>' + accounts.map(acc => {
            const pName = platformNames[acc.platform] || acc.platform;
            return '<option value="' + acc.id + '">[' + pName + '] ' + acc.name + ' (' + acc.account_id + ')</option>';
          }).join('');
        }
      }
    } catch (e) {
      accSelect.innerHTML = '<option value="">Erro ao carregar contas</option>';
    }
  }

  if (mediaInput) mediaInput.value = '';

  m.classList.add('active');
}

function closePublishViralSocialModal() {
  const m = document.getElementById('modalPublishViralSocial');
  if (m) m.classList.remove('active');
}

async function executePublishViralSocial(event) {
  event.preventDefault();
  const btn = document.getElementById('btnSubmitPubViralSocial');
  const postId = document.getElementById('pubViralPostId').value;
  const socialAccountId = document.getElementById('pubViralAccountId').value;
  const customText = document.getElementById('pubViralText').value;
  const mediaUrl = document.getElementById('pubViralMediaUrl').value;

  if (!socialAccountId) {
    alert('Por favor, selecione uma conta social de destino.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publicando na rede...';
  }

  try {
    const res = await fetch('/api/viral/generated/' + postId + '/publish-social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        socialAccountId: Number(socialAccountId),
        customText,
        mediaUrl
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao publicar post na rede social');
    }

    closePublishViralSocialModal();
    alert('🎉 Sucesso! Post publicado na rede ' + (data.platform || '') + ' (@' + (data.accountName || '') + ')!\nID do Post: ' + (data.publishedPostId || data.post_id || 'OK'));
    await loadViralGeneratedPosts();
  } catch (err) {
    alert('Erro ao publicar: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Publicar Agora';
    }
  }
}

// ==========================================
// 17. GESTÃO CENTRAL DE GRUPOS WHATSAPP & EXTRAÇÃO DE LEADS (ZERO CELULAR)
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadWhatsappGroupsList(forceRefresh = false) {
  const tbody = document.getElementById('tableWhatsappGroupsBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Buscando grupos do WhatsApp...</td></tr>`;
    const res = await fetch(`/api/whatsapp/groups?refresh=${forceRefresh ? 'true' : 'false'}`);
    if (!res.ok) throw new Error('Falha ao carregar grupos');
    const groups = await res.json();
    allDiscoveredGroups = groups || [];
    populateGroupSettingsDropdown();

    if (!groups || groups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color: var(--text-muted);">Nenhum grupo encontrado. Conecte o WhatsApp Matriz para listar os grupos reais.</td></tr>`;
      return;
    }

    tbody.innerHTML = groups.map(g => {
      const isAnnounce = !!g.isAnnounce;
      const isAdmin = !!g.isBotAdmin;

      const modeBadge = isAnnounce
        ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);"><i class="fa-solid fa-lock"></i> 🔒 Anúncio</span>`
        : `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);"><i class="fa-solid fa-lock-open"></i> 🔓 Aberto</span>`;

      const adminBadge = isAdmin
        ? `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);"><i class="fa-solid fa-crown"></i> Admin</span>`
        : `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;"><i class="fa-solid fa-user"></i> Membro</span>`;

      const isBotActive = g.botActive !== false;
      const isPostingActive = g.postingActive !== false;
      const isSoDivu = Boolean(g.soDivu || g.isSoDivu);
      const isGlobalSoDivu = Boolean(g.isGlobalSoDivu);

      const botBadge = isBotActive
        ? `<button class="btn btn-xs" onclick="quickToggleGroupBot(\'${g.id}\', true)" title="Clique para pausar comandos e IA neste grupo" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #10b981; font-weight: 700; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-robot"></i> 🟢 Ativo</button>`
        : `<button class="btn btn-xs" onclick="quickToggleGroupBot(\'${g.id}\', false)" title="Clique para reativar comandos e IA neste grupo" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; font-weight: 700; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-robot"></i> 🔴 Pausado</button>`;

      const postingBadge = isPostingActive
        ? `<button class="btn btn-xs" onclick="quickToggleGroupPosting(\'${g.id}\', true)" title="Clique para pausar ofertas e achadinhos neste grupo" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-weight: 700; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-bullhorn"></i> 🟢 Ativo</button>`
        : `<button class="btn btn-xs" onclick="quickToggleGroupPosting(\'${g.id}\', false)" title="Clique para reativar ofertas e achadinhos neste grupo" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b; font-weight: 700; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-bullhorn"></i> 🔴 Pausado</button>`;

      const soDivuBadge = isSoDivu
        ? `<button class="btn btn-xs" onclick="quickToggleGroupSoDivu(\'${g.id}\', true)" title="Clique para desativar Só Divulgação e voltar ao modo normal" style="background: rgba(236, 72, 153, 0.15); border: 1px solid rgba(236, 72, 153, 0.4); color: #ec4899; font-weight: 700; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-bullhorn"></i> 🟢 Só Divu${isGlobalSoDivu ? ' (Global)' : ''}</button>`
        : `<button class="btn btn-xs" onclick="quickToggleGroupSoDivu(\'${g.id}\', false)" title="Clique para ativar Modo Só Divulgação (apenas postagens e ofertas)" style="background: rgba(148, 163, 184, 0.1); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 4px 8px;"><i class="fa-solid fa-bullhorn"></i> ⚪ Padrão</button>`;

      return `
        <tr>
          <td>
            <b style="color: #fff; font-size: 14px;">${escapeHtml(g.subject || 'Grupo sem nome')}</b>
            <div style="font-family: monospace; font-size: 11px; color: var(--text-muted); margin-top: 2px;">${g.id}</div>
          </td>
          <td>
            <span style="font-weight: 700; color: #38bdf8;">${g.participantsCount || 0}</span> membros
          </td>
          <td>${modeBadge}</td>
          <td style="text-align: center;">${botBadge}</td>
          <td style="text-align: center;">${postingBadge}</td>
          <td style="text-align: center;">${soDivuBadge}</td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
              <button class="btn btn-sm btn-secondary" onclick="openGroupSettingsModal('${g.id}')" title="Configurar Anti-Link, Boas-Vindas e Segurança" style="color: #3b82f6;">
                <i class="fa-solid fa-sliders"></i> Configurar
              </button>
              <button class="btn btn-sm btn-secondary" onclick="toggleWhatsappGroupMode('${g.id}', ${isAnnounce})" title="${isAnnounce ? 'Abrir grupo para todos falarem' : 'Fechar grupo (apenas admins falam)'}">
                <i class="fa-solid ${isAnnounce ? 'fa-lock-open' : 'fa-lock'}" style="color: ${isAnnounce ? '#10b981' : '#f59e0b'};"></i> ${isAnnounce ? 'Abrir' : 'Fechar'}
              </button>
              <button class="btn btn-sm btn-secondary" onclick="exportGroupLeadsCsv('${g.id}', '${encodeURIComponent(g.subject || 'grupo')}')" title="Baixar lista de contatos em CSV para Remarketing" style="color: #10b981;">
                <i class="fa-solid fa-file-csv"></i> Leads
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar grupos WhatsApp:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 24px; color: #ef4444;">Erro ao carregar grupos: ${err.message}</td></tr>`;
  }
}

async function quickToggleGroupBot(groupId, currentActive) {
  try {
    const res = await fetch('/api/whatsapp/groups/' + encodeURIComponent(groupId) + '/toggle-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentActive })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao alterar status');
    }
    await loadWhatsappGroupsList(false);
  } catch (err) {
    alert('Erro ao alternar bot no grupo: ' + err.message);
  }
}

async function quickToggleGroupPosting(groupId, currentActive) {
  try {
    const res = await fetch('/api/whatsapp/groups/' + encodeURIComponent(groupId) + '/toggle-posting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentActive })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao alterar status de postagens');
    }
    await loadWhatsappGroupsList(false);
  } catch (err) {
    alert('Erro ao alternar postagens no grupo: ' + err.message);
  }
}

async function quickToggleGroupSoDivu(groupId, currentActive) {
  try {
    const res = await fetch('/api/whatsapp/groups/' + encodeURIComponent(groupId) + '/toggle-sodivu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !currentActive })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao alterar status de Só Divulgação');
    }
    await loadWhatsappGroupsList(false);
  } catch (err) {
    alert('Erro ao alternar Só Divulgação no grupo: ' + err.message);
  }
}
window.quickToggleGroupSoDivu = quickToggleGroupSoDivu;

async function toggleWhatsappGroupMode(groupId, isCurrentlyAnnounce) {
  const newMode = isCurrentlyAnnounce ? 'open' : 'closed';
  try {
    const res = await fetch(`/api/whatsapp/groups/${encodeURIComponent(groupId)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode })
    });
    if (res.ok) {
      await loadWhatsappGroupsList(false);
    } else {
      const err = await res.json();
      alert('Aviso: ' + (err.error || 'Não foi possível alterar modo'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

function exportGroupLeadsCsv(groupJid, title = '') {
  window.location.href = `/api/whatsapp/groups/${encodeURIComponent(groupJid)}/export-leads.csv`;
}

function exportMeteoricGroupLeadsCsv(groupId, title = '') {
  window.location.href = `/api/meteoric/groups/${groupId}/export-leads.csv`;
}

function exportAllMeteoricLeadsCsv() {
  window.location.href = `/api/meteoric/export-all-leads.csv`;
}

// ==========================================
// 18. SIMULADOR & INJETOR DE CONVERSAS DE SUB-BOTS (VISUAL WEB)
// ==========================================
let activeSimulationTimeouts = [];

function onSimulatorThemeChange() {
  const theme = document.getElementById('simThemeSelect')?.value;
  const box = document.getElementById('simCustomScriptBox');
  if (box) {
    box.style.display = theme === 'custom' ? 'block' : 'none';
  }
}

function clearDialoguePreview() {
  activeSimulationTimeouts.forEach(t => clearTimeout(t));
  activeSimulationTimeouts = [];
  const chatWin = document.getElementById('simChatWindow');
  if (chatWin) {
    chatWin.innerHTML = `
      <div id="simChatPlaceholder" style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 30px;">
        <i class="fa-solid fa-mobile-screen fa-2x mb-2" style="color: #8b5cf6; display: block;"></i>
        Selecione um tema acima e clique em <b>"Simular no Cockpit"</b> para ver os sub-bots interagindo em tempo real!
      </div>
    `;
  }
}

async function runDialogueSimulation(dryRun = true) {
  const targetGroupJid = document.getElementById('simTargetGroup')?.value || 'preview_only';
  const theme = document.getElementById('simThemeSelect')?.value || 'social_proof';
  const delaySeconds = parseInt(document.getElementById('simDelaySeconds')?.value, 10) || 4;

  let customScripts = null;
  if (theme === 'custom') {
    const rawCustom = document.getElementById('simCustomScriptInput')?.value?.trim();
    if (rawCustom) {
      try {
        customScripts = JSON.parse(rawCustom);
      } catch (e) {
        alert('JSON de falas customizadas inválido! Verifique o formato.');
        return;
      }
    }
  }

  if (!dryRun) {
    const isTargetSpecific = targetGroupJid && targetGroupJid !== 'preview_only' && targetGroupJid !== 'all';
    const msgConfirm = isTargetSpecific 
      ? `Deseja realmente disparar este diálogo de aquecimento no grupo selecionado?`
      : `Deseja realmente disparar este diálogo de aquecimento em TODOS os grupos do lançamento?`;
    if (!confirm(msgConfirm)) return;
  }

  try {
    const res = await fetch('/api/meteoric/simulate-dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetGroupJid,
        theme,
        customScripts,
        delaySeconds,
        dryRun
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Falha ao processar simulação');
    }

    const data = await res.json();
    const timeline = data.timeline || [];

    if (!dryRun) {
      alert(`🚀 Aquecimento iniciado! ${timeline.length} falas estão sendo orquestradas e enviadas pelos Sub-Bots.`);
      loadMeteoricActivityLogs();
      return;
    }

    // Renderiza a simulação visual animada no chat simulator
    clearDialoguePreview();
    const chatWin = document.getElementById('simChatWindow');
    if (!chatWin) return;
    chatWin.innerHTML = `
      <div style="background: rgba(139, 92, 246, 0.1); border-left: 3px solid #8b5cf6; padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #a78bfa; margin-bottom: 10px;">
        <i class="fa-solid fa-play"></i> <b>Simulação em Tempo Real Iniciada:</b> ${timeline.length} falas programadas (${theme})
      </div>
    `;

    const avatarColors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

    timeline.forEach((item, idx) => {
      const waitMs = (item.delaySeconds || (idx * delaySeconds + 1)) * 1000;
      const tid = setTimeout(() => {
        const color = avatarColors[idx % avatarColors.length];
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const bubble = document.createElement('div');
        bubble.style.cssText = `
          display: flex;
          gap: 10px;
          align-items: flex-start;
          animation: fadeIn 0.3s ease;
          max-width: 82%;
          margin-bottom: 8px;
        `;

        bubble.innerHTML = `
          <div style="width: 34px; height: 34px; border-radius: 50%; background: ${color}20; color: ${color}; border: 1px solid ${color}60; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; flex-shrink: 0;">
            ${(item.speaker || 'SB').slice(0, 2).toUpperCase()}
          </div>
          <div style="background: #202c33; border: 1px solid rgba(255,255,255,0.08); border-radius: 0 10px 10px 10px; padding: 8px 12px; position: relative;">
            <div style="display: flex; justify-content: space-between; gap: 15px; margin-bottom: 3px;">
              <b style="font-size: 12px; color: ${color};">${escapeHtml(item.speaker)}</b>
              <span style="font-size: 10px; color: var(--text-muted);">${timeStr}</span>
            </div>
            <div style="font-size: 13px; color: #e9edef; line-height: 1.4;">${escapeHtml(item.text)}</div>
          </div>
        `;

        chatWin.appendChild(bubble);
        chatWin.scrollTop = chatWin.scrollHeight;
      }, waitMs);

      activeSimulationTimeouts.push(tid);
    });
  } catch (err) {
    alert('Erro no simulador: ' + err.message);
  }
}


// ==========================================
// CENTRAL DE AVISOS & ALERTA INTER-PC (SISTEMAS_AVISOS_PC)
// ==========================================
let audioAlertsEnabled = true;
let audioCtx = null;

function toggleAudioAlerts() {
  audioAlertsEnabled = !audioAlertsEnabled;
  const statusEl = document.getElementById('audioAlertStatus');
  if (statusEl) statusEl.textContent = audioAlertsEnabled ? 'Ativado' : 'Desativado';
  const btn = document.getElementById('btnAudioToggle');
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-volume-${audioAlertsEnabled ? 'high' : 'xmark'}"></i> Alerta Sonoro: <span id="audioAlertStatus">${audioAlertsEnabled ? 'Ativado' : 'Desativado'}</span>`;
  }
}

function playAudioBeep(type = 'alarm') {
  if (!audioAlertsEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'alarm' || type === 'urgente') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.35);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.3);
    }
  } catch (_) {}
}

function updateNoticeColor(cat) {
  const colors = {
    urgente: '#f44336',
    emergencia: '#d32f2f',
    alerta: '#ff5722',
    sucesso: '#4caf50',
    trabalho: '#2196f3',
    social: '#795548',
    info: '#3b82f6'
  };
  const color = colors[cat] || '#2196f3';
  const hiddenColor = document.getElementById('noticeColor');
  if (hiddenColor) hiddenColor.value = color;
}

function applyQuickNotice(title, msg, category, color) {
  document.getElementById('noticeTitle').value = title;
  document.getElementById('noticeMessage').value = msg;
  document.getElementById('noticeCategory').value = category;
  document.getElementById('noticeColor').value = color;
  playAudioBeep(category === 'urgente' || category === 'emergencia' ? 'alarm' : 'chime');
}

async function emitNotice(e) {
  e.preventDefault();
  const title = document.getElementById('noticeTitle').value.trim();
  const message = document.getElementById('noticeMessage').value.trim();
  const category = document.getElementById('noticeCategory').value;
  const color = document.getElementById('noticeColor').value || '#2196f3';
  const target = document.getElementById('noticeTarget').value;
  const sound_alert = document.getElementById('noticeSoundAlert').checked ? 1 : 0;
  const broadcast_whatsapp = document.getElementById('noticeBroadcastWA').checked;

  try {
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message, category, color, sender: 'Admin Web', target, sound_alert, broadcast_whatsapp })
    });
    const data = await res.json();
    if (data.success) {
      if (sound_alert) playAudioBeep('alarm');
      document.getElementById('noticeTitle').value = '';
      document.getElementById('noticeMessage').value = '';
      loadNotices();
    } else {
      alert('Erro ao emitir aviso: ' + (data.error || 'Falha desconhecida'));
    }
  } catch (err) {
    alert('Erro de conexão ao emitir aviso: ' + err.message);
  }
}

async function loadNotices() {
  try {
    const res = await fetch('/api/notices?status=active');
    const data = await res.json();
    if (!data.success || !Array.isArray(data.notices)) return;

    const feed = document.getElementById('noticesFeed');
    const countBadge = document.getElementById('activeNoticesCount');
    if (countBadge) countBadge.textContent = `${data.notices.length} Ativos`;

    if (data.notices.length === 0) {
      feed.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 40px 0;">
          <i class="fa-solid fa-bell-slash" style="font-size: 32px; margin-bottom: 8px; opacity: 0.5;"></i>
          <p>Nenhum aviso ativo no momento.</p>
        </div>
      `;
      return;
    }

    feed.innerHTML = data.notices.map(n => {
      const timeStr = new Date(n.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const responsesHtml = (n.responses || []).map(r => `
        <div style="background: rgba(0,0,0,0.25); border-left: 2px solid #38bdf8; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-top: 4px;">
          <b style="color: #38bdf8;">${escapeHtml(r.respondent)}:</b> ${escapeHtml(r.response_text)}
        </div>
      `).join('');

      return `
        <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-left: 4px solid ${n.color || '#2196f3'}; border-radius: 8px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
            <b style="font-size: 14px; color: #fff;">${escapeHtml(n.title)}</b>
            <span style="font-size: 11px; color: var(--text-muted);">${timeStr}</span>
          </div>
          <p style="font-size: 13px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4;">${escapeHtml(n.message)}</p>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
            <span>Por: <b>${escapeHtml(n.sender)}</b> &bull; Destino: <b>${n.target}</b></span>
            <div>
              <button class="btn btn-sm btn-outline" style="padding: 2px 8px; font-size: 11px;" onclick="promptRespondNotice(${n.id})">
                <i class="fa-solid fa-reply"></i> Responder
              </button>
              <button class="btn btn-sm btn-secondary" style="padding: 2px 8px; font-size: 11px; color: #ef4444;" onclick="archiveNotice(${n.id})">
                <i class="fa-solid fa-check"></i> Concluir
              </button>
            </div>
          </div>
          ${responsesHtml ? `<div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 6px;">${responsesHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar avisos:', err);
  }
}

async function promptRespondNotice(id) {
  const text = prompt('Digite sua resposta para a central de avisos:');
  if (!text || !text.trim()) return;

  try {
    const res = await fetch(`/api/notices/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respondent: 'Operador Web', response_text: text.trim() })
    });
    const data = await res.json();
    if (data.success) {
      loadNotices();
    } else {
      alert('Erro ao responder: ' + data.error);
    }
  } catch (e) {
    alert('Erro de conexão ao responder: ' + e.message);
  }
}

async function archiveNotice(id) {
  try {
    await fetch(`/api/notices/${id}`, { method: 'DELETE' });
    loadNotices();
  } catch (_) {}
}

// ==========================================
// TÚNEL REMOTO CLOUDFLARE (ACESSO EXTERNO)
// ==========================================
async function checkTunnelStatus() {
  try {
    const res = await fetch('/api/tunnel');
    const data = await res.json();
    const badge = document.getElementById('tunnelStatusBadge');
    const text = document.getElementById('tunnelStatusText');
    const btn = document.getElementById('btnCopyTunnel');
    if (!badge || !text) return;

    if (data.active && data.url) {
      window.remoteTunnelUrl = data.url;
      text.innerHTML = `Remoto: <a href="${data.url}" target="_blank" style="color: #60a5fa; text-decoration: underline; font-weight: 600;">${data.url.replace('https://', '')}</a>`;
      if (btn) btn.style.display = 'inline-block';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#34d399';
    } else {
      text.textContent = 'Remoto: Conectando...';
      if (btn) btn.style.display = 'none';
    }
  } catch (_) {}
}

function copyTunnelUrl() {
  if (window.remoteTunnelUrl) {
    navigator.clipboard.writeText(window.remoteTunnelUrl);
    showToast('Link de acesso remoto copiado com sucesso!');
  }
}


// ==========================================
// CENTRAL DE COMANDO DA MATRIZ: TAREFAS DOS SUB-BOTS
// ==========================================
let currentMatrizTasks = [];

async function loadMatrizTasks() {
  try {
    const res = await fetch('/api/matriz/tasks');
    const data = await res.json();
    if (data.success) {
      currentMatrizTasks = data.tasks || [];
      renderMatrizTasks(currentMatrizTasks, data.summary || {});
    }
  } catch (err) {
    console.error('Erro ao carregar tarefas da matriz:', err);
  }
}

function renderMatrizTasks(tasks, summary) {
  const elTotal = document.getElementById('matrizTotalTasks');
  const elComp = document.getElementById('matrizCompletedTasks');
  const elInProg = document.getElementById('matrizInProgressTasks');
  const elPend = document.getElementById('matrizPendingTasks');

  if (elTotal) elTotal.innerText = summary.total || tasks.length;
  if (elComp) elComp.innerText = summary.COMPLETED || tasks.filter(t => t.status === 'COMPLETED').length;
  if (elInProg) elInProg.innerText = summary.IN_PROGRESS || tasks.filter(t => t.status === 'IN_PROGRESS').length;
  if (elPend) elPend.innerText = summary.PENDING || tasks.filter(t => t.status === 'PENDING').length;

  const tbody = document.getElementById('tbodyMatrizTasks');
  if (!tbody) return;

  if (tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #888; padding: 25px;">
          Nenhuma missão delegada recentemente aos sub-bots. Clique em "Delegar Tarefa" ou envie uma ordem no WhatsApp do Bot Matriz!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tasks.map(t => {
    let statusBadge = '<span class="badge badge-warning">Pendente</span>';
    if (t.status === 'COMPLETED') statusBadge = '<span class="badge badge-success">Concluída</span>';
    else if (t.status === 'IN_PROGRESS') statusBadge = '<span class="badge badge-info">Em Andamento</span>';
    else if (t.status === 'FAILED') statusBadge = '<span class="badge badge-danger">Falhou</span>';

    const botName = t.bot_name ? `#${t.assigned_instance_id} (${t.bot_name})` : '<span style="color: #f59e0b; font-weight: 600;">Todos os Sub-Bots</span>';
    const target = t.target ? `+${t.target}` : '—';
    const time = t.created_at ? new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const result = t.result_summary || 'Aguardando processamento...';

    return `
      <tr>
        <td><code>${t.task_code}</code></td>
        <td><span style="font-size: 11px; padding: 3px 6px; background: rgba(255,255,255,0.06); border-radius: 4px;">${t.task_type}</span></td>
        <td><strong>${escapeHtml(t.title || 'Missão')}</strong></td>
        <td>${botName}</td>
        <td>${target}</td>
        <td>${statusBadge}</td>
        <td><small style="color: #aaa;">${time}</small></td>
        <td><small style="color: #ddd;">${escapeHtml(result)}</small></td>
      </tr>
    `;
  }).join('');
}

function openDelegateTaskModal() {
  const select = document.getElementById('delegateTargetBot');
  if (select) {
    select.innerHTML = '<option value="">Todos os Sub-Bots (Cluster / Balanceado)</option>';
    (currentArmyInstances || []).forEach(inst => {
      const isOnline = inst.status === 'CONNECTED';
      const label = `#${inst.id} - ${inst.name} (${inst.phone ? '+' + inst.phone : 'Sem número'}) ${isOnline ? '🟢' : '⚪'}`;
      select.innerHTML += `<option value="${inst.id}">${label}</option>`;
    });
  }
  document.getElementById('formDelegateTask')?.reset();
  onDelegateTaskTypeChange();
  document.getElementById('modalDelegateTask')?.classList.add('active');
}

function closeDelegateTaskModal() {
  document.getElementById('modalDelegateTask')?.classList.remove('active');
}

function onDelegateTaskTypeChange() {
  const type = document.getElementById('delegateTaskType')?.value;
  const groupTarget = document.getElementById('groupDelegateTarget');
  const phoneInput = document.getElementById('delegateTargetPhone');
  const lblTarget = document.getElementById('lblDelegateTarget');
  if (!groupTarget) return;

  if (type === 'DIRECT_MESSAGE' || type === 'VOICE_NOTE' || type === 'TAKEOVER_START' || type === 'TAKEOVER_END') {
    groupTarget.style.display = 'block';
    if (lblTarget) lblTarget.textContent = 'Telefone do Destinatário / Lead (com DDD) *';
    if (phoneInput) {
      phoneInput.required = true;
      phoneInput.placeholder = 'Ex: 5511999998888';
    }
  } else if (type === 'SMART_LOAD_BALANCE') {
    groupTarget.style.display = 'block';
    if (lblTarget) lblTarget.textContent = 'Quantidade Máxima de Leads para Balancear (Ex: 50)';
    if (phoneInput) {
      phoneInput.required = false;
      phoneInput.placeholder = 'Ex: 50';
    }
  } else {
    groupTarget.style.display = 'none';
    if (phoneInput) phoneInput.required = false;
  }
}

async function submitDelegateTask(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitDelegate');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Delegando Missão...';
  }

  try {
    const instanceId = document.getElementById('delegateTargetBot')?.value || null;
    const type = document.getElementById('delegateTaskType')?.value;
    const target = document.getElementById('delegateTargetPhone')?.value || '';
    const title = document.getElementById('delegateTaskTitle')?.value || '';
    const message = document.getElementById('delegateTaskMessage')?.value || '';
    const scheduled_at = document.getElementById('delegateScheduledAt')?.value || null;

    const res = await fetch('/api/matriz/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, instanceId, target, title, message, scheduled_at })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Missão delegada com sucesso aos sub-bots!');
      closeDelegateTaskModal();
      await loadMatrizTasks();
    } else {
      alert('Erro ao delegar tarefa: ' + (data.error || 'Falha na requisição'));
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Delegar Missão Imediata';
    }
  }
}


// ==========================================
// BOT DECK: OPERAÇÃO TOTAL DOS BOTS VIA PAINEL WEB
// ==========================================
let botdeckData = { instances: [], groups: [], main: {} };

async function loadBotDeck() {
  try {
    const res = await fetch('/api/botdeck/overview');
    const data = await res.json();
    if (!data.success) return;

    botdeckData = data;

    // Atualiza Top Bar
    const mainStatusEl = document.getElementById('botdeckMainStatus');
    if (mainStatusEl) {
      mainStatusEl.innerHTML = data.main.connected 
        ? `<span class="badge badge-success">Online</span> ${data.main.phone || ''}`
        : `<span class="badge badge-danger">Desconectado</span> ${data.main.phone || ''}`;
    }

    const subbotsEl = document.getElementById('botdeckSubbotsCount');
    if (subbotsEl) {
      const activeCount = data.instances.filter(i => i.status === 'CONNECTED').length;
      subbotsEl.innerText = `${activeCount} ativos / ${data.instances.length} chips`;
    }

    const todayEl = document.getElementById('botdeckTodaySent');
    if (todayEl) {
      const totalSent = data.instances.reduce((acc, curr) => acc + (curr.messages_sent_today || 0), 0);
      todayEl.innerText = `${totalSent} enviadas hoje`;
    }

    // Popula dropdowns de Instâncias / Chips
    const instSelects = document.querySelectorAll('.botdeck-inst-select');
    instSelects.forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = '<option value="main">Matriz Principal</option>';
      data.instances.forEach(inst => {
        const isConn = inst.status === 'CONNECTED';
        const opt = document.createElement('option');
        opt.value = inst.id;
        opt.innerText = `Sub-Bot #${inst.id} - ${inst.name} (${inst.phone || 'Sem número'}) [${inst.status}]`;
        sel.appendChild(opt);
      });
      if (currentVal) sel.value = currentVal;
    });

    // Popula dropdowns de Grupos
    const groupSelects = document.querySelectorAll('.botdeck-groups-select');
    groupSelects.forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = '<option value="">Selecione o grupo do WhatsApp...</option>';
      data.groups.forEach(grp => {
        const opt = document.createElement('option');
        opt.value = grp.id;
        opt.innerText = `${grp.subject || 'Grupo sem nome'} (${grp.size || 0} membros)`;
        sel.appendChild(opt);
      });
      if (currentVal) sel.value = currentVal;
    });

    // Carrega tarefas recentes no console se vazio
    const consoleEl = document.getElementById('botdeckConsole');
    if (consoleEl && data.recentTasks && data.recentTasks.length > 0) {
      data.recentTasks.slice(0, 5).forEach(t => {
        logBotDeck(`[${t.created_at || 'Recente'}] ${t.title} -> ${t.result_summary || t.status}`, 'info');
      });
    }

  } catch (err) {
    console.error('[BotDeck load error]:', err);
  }
}

function syncGroupJid(selectEl) {
  const jidInput = document.getElementById('botdeck-mod-group-jid');
  if (jidInput && selectEl.value) {
    jidInput.value = selectEl.value;
  }
}

function filterBotDeck(cat, btn) {
  document.querySelectorAll('.botdeck-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const cards = document.querySelectorAll('.botdeck-card');
  cards.forEach(card => {
    if (cat === 'all' || card.getAttribute('data-category') === cat) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
}

function logBotDeck(msg, type = 'info') {
  const consoleEl = document.getElementById('botdeckConsole');
  if (!consoleEl) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = `botdeck-console-line ${type}`;
  div.innerText = `[${time}] ${msg}`;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearBotDeckConsole() {
  const consoleEl = document.getElementById('botdeckConsole');
  if (consoleEl) {
    consoleEl.innerHTML = '<div class="botdeck-console-line text-muted">[Sistema] Console limpo. Pronto para novos comandos.</div>';
  }
}

async function botDeckAction(action, btnEl = null) {
  let oldBtnText = '';
  if (btnEl) {
    oldBtnText = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Executando...';
    btnEl.disabled = true;
  }

  try {
    let payload = {};

    switch (action) {
      case 'SEND_MESSAGE':
        payload = {
          instanceId: document.getElementById('botdeck-msg-inst')?.value || 'main',
          target: document.getElementById('botdeck-msg-target')?.value?.trim(),
          message: document.getElementById('botdeck-msg-text')?.value?.trim()
        };
        break;

      case 'SEND_VOICE_PTT':
        payload = {
          instanceId: document.getElementById('botdeck-voice-inst')?.value || 'main',
          target: document.getElementById('botdeck-voice-target')?.value?.trim(),
          text: document.getElementById('botdeck-voice-text')?.value?.trim()
        };
        break;

      case 'SCHEDULE_MESSAGE':
        payload = {
          instanceId: document.getElementById('botdeck-sched-inst')?.value || 'main',
          target: document.getElementById('botdeck-sched-target')?.value?.trim(),
          scheduled_at: document.getElementById('botdeck-sched-datetime')?.value,
          message: document.getElementById('botdeck-sched-text')?.value?.trim()
        };
        break;

      case 'SMART_LOAD_BALANCE':
        payload = {
          qty: document.getElementById('botdeck-balance-qty')?.value,
          message: document.getElementById('botdeck-balance-text')?.value?.trim()
        };
        break;

      case 'BROADCAST_GROUPS':
        payload = {
          message: document.getElementById('botdeck-broadcast-text')?.value?.trim()
        };
        break;

      case 'GROUP_TAGALL':
        payload = {
          groupJid: document.getElementById('botdeck-tagall-group')?.value,
          message: document.getElementById('botdeck-tagall-msg')?.value?.trim()
        };
        break;

      case 'GROUP_SET_NAME':
        payload = {
          groupJid: document.getElementById('botdeck-edit-group')?.value,
          title: document.getElementById('botdeck-edit-name')?.value?.trim()
        };
        break;

      case 'GROUP_SET_DESC':
        payload = {
          groupJid: document.getElementById('botdeck-edit-group')?.value,
          desc: document.getElementById('botdeck-edit-desc')?.value?.trim()
        };
        break;

      case 'DOWNLOAD_AUDIO':
        payload = {
          target: document.getElementById('botdeck-audio-target')?.value?.trim(),
          query: document.getElementById('botdeck-audio-query')?.value?.trim(),
          quality: document.getElementById('botdeck-audio-quality')?.value || 'H'
        };
        break;

      case 'DOWNLOAD_VIDEO':
        payload = {
          target: document.getElementById('botdeck-video-target')?.value?.trim(),
          url: document.getElementById('botdeck-video-url')?.value?.trim(),
          quality: document.getElementById('botdeck-video-quality')?.value || 'H'
        };
        break;

      case 'AI_QUERY':
        payload = {
          target: document.getElementById('botdeck-ai-target')?.value?.trim(),
          prompt: document.getElementById('botdeck-ai-prompt')?.value?.trim()
        };
        break;

      case 'AI_IMAGE':
        payload = {
          target: document.getElementById('botdeck-aiimg-target')?.value?.trim(),
          prompt: document.getElementById('botdeck-aiimg-prompt')?.value?.trim()
        };
        break;

      case 'SEND_TTS':
        payload = {
          target: document.getElementById('botdeck-tts-target')?.value?.trim(),
          lang: document.getElementById('botdeck-tts-lang')?.value || 'pt',
          text: document.getElementById('botdeck-tts-text')?.value?.trim()
        };
        break;

      case 'SEND_QR':
        payload = {
          target: document.getElementById('botdeck-qr-target')?.value?.trim(),
          text: document.getElementById('botdeck-qr-text')?.value?.trim()
        };
        break;

      case 'METEORIC_STAGE':
        payload = {
          stageNum: document.getElementById('botdeck-met-stage')?.value,
          link: document.getElementById('botdeck-met-link')?.value?.trim()
        };
        break;

      case 'METEORIC_MANADA':
        payload = {};
        break;

      case 'METEORIC_CREATE_GROUP':
        payload = {
          baseName: document.getElementById('botdeck-met-basename')?.value?.trim(),
          maxMembers: document.getElementById('botdeck-met-max')?.value
        };
        break;

      case 'QUICK_CHARGE':
        payload = {
          name: document.getElementById('botdeck-chg-name')?.value?.trim(),
          phone: document.getElementById('botdeck-chg-phone')?.value?.trim(),
          amount: document.getElementById('botdeck-chg-amt')?.value,
          gateway: document.getElementById('botdeck-chg-gw')?.value
        };
        break;

      case 'RECOVER_CARTS':
        payload = {};
        break;

      case 'QUICK_COUPON':
        payload = {
          code: document.getElementById('botdeck-cpn-code')?.value?.trim(),
          discount: document.getElementById('botdeck-cpn-disc')?.value,
          maxUses: document.getElementById('botdeck-cpn-uses')?.value
        };
        break;

      case 'CHAT_MUTE':
      case 'CHAT_UNMUTE':
        payload = {
          target: document.getElementById('botdeck-ctrl-target')?.value?.trim(),
          reason: document.getElementById('botdeck-ctrl-reason')?.value?.trim()
        };
        break;

      case 'USER_BLOCK':
      case 'USER_UNBLOCK':
        payload = {
          phone: document.getElementById('botdeck-ctrl-target')?.value?.trim(),
          reason: document.getElementById('botdeck-ctrl-reason')?.value?.trim()
        };
        break;

      case 'SUBBOT_PAIRING_CODE':
        payload = {
          phone: document.getElementById('botdeck-pair-phone')?.value?.trim()
        };
        break;

      case 'OPTIMIZE_MEMORY':
      case 'RESTART_TUNNEL':
        payload = {};
        break;
    }

    logBotDeck(`Disparando comando ${action}...`, 'info');

    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha ao executar ação no bot');
    }

    logBotDeck(`[SUCESSO] ${data.message}`, 'success');
    alert(data.message);

    if (action === 'SUBBOT_PAIRING_CODE' && data.message && data.message.includes('Código')) {
      const codeRes = document.getElementById('botdeckPairResult');
      if (codeRes) {
        codeRes.style.display = 'block';
        codeRes.innerText = data.message;
      }
    }

    loadBotDeck();

  } catch (err) {
    logBotDeck(`[ERRO] ${err.message}`, 'error');
    alert('Erro: ' + err.message);
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldBtnText;
      btnEl.disabled = false;
    }
  }
}

async function botDeckGroupAction(actionType, btnEl) {
  let oldText = '';
  if (btnEl) {
    oldText = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnEl.disabled = true;
  }

  try {
    const selectedGroup = document.getElementById('botdeck-mod-group')?.value;
    const manualGroup = document.getElementById('botdeck-mod-group-jid')?.value?.trim();
    const groupJid = selectedGroup || manualGroup;
    const userPhone = document.getElementById('botdeck-mod-user')?.value?.trim();
    const reason = document.getElementById('botdeck-mod-reason')?.value?.trim();

    if (!groupJid && actionType !== 'GROUP_REVOKE_LINK') {
      throw new Error('Selecione ou informe o JID do Grupo.');
    }

    let action = '';
    if (actionType === 'GROUP_PROMOTE') action = 'GROUP_PROMOTE';
    else if (actionType === 'GROUP_DEMOTE') action = 'GROUP_DEMOTE';
    else if (actionType === 'GROUP_BAN') action = 'GROUP_BAN';
    else if (actionType === 'GROUP_WARN') action = 'GROUP_WARN';
    else if (actionType === 'GROUP_MUTE') action = 'GROUP_MUTE';
    else if (actionType === 'GROUP_UNMUTE') action = 'GROUP_UNMUTE';
    else if (actionType === 'GROUP_REVOKE_LINK') action = 'GROUP_REVOKE_LINK';

    const payload = { groupJid, userPhone, reason };
    logBotDeck(`Executando ação no grupo: ${action}...`, 'info');

    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Erro na operação de grupo');

    logBotDeck(`[GRUPO SUCESSO] ${data.message}`, 'success');
    alert(data.message);

  } catch (err) {
    logBotDeck(`[ERRO GRUPO] ${err.message}`, 'error');
    alert('Erro: ' + err.message);
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldText;
      btnEl.disabled = false;
    }
  }
}

async function botDeckTakeover(subAction, btnEl) {
  const target = document.getElementById('botdeck-takeover-target')?.value?.trim();
  const instanceId = document.getElementById('botdeck-takeover-inst')?.value;
  const message = document.getElementById('botdeck-takeover-msg')?.value?.trim();

  let action = 'TAKEOVER_START';
  if (subAction === 'reply') action = 'TAKEOVER_REPLY';
  if (subAction === 'end') action = 'TAKEOVER_END';

  const payload = { target, instanceId, message };
  botDeckAction(action, btnEl);
}

async function botDeckMeteoricMode(mode, btnEl) {
  const payload = { mode };
  botDeckAction('METEORIC_MODE_ALL', btnEl);
}

async function botDeckNoticeAction(isUrgent, btnEl) {
  const title = document.getElementById('botdeck-ntc-title')?.value?.trim() || 'Aviso da Central';
  const message = document.getElementById('botdeck-ntc-msg')?.value?.trim();
  const category = isUrgent ? 'urgente' : (document.getElementById('botdeck-ntc-cat')?.value || 'info');

  if (!message) {
    alert('Digite a mensagem do comunicado.');
    return;
  }

  let oldText = '';
  if (btnEl) {
    oldText = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    btnEl.disabled = true;
  }

  try {
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        message,
        category,
        color: isUrgent ? '#ef4444' : '#2196f3',
        sound_alert: isUrgent ? 1 : 0,
        broadcast_whatsapp: true
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao emitir aviso');

    logBotDeck(`[AVISO EMITIDO] ${title}: ${message}`, 'success');
    alert('Aviso emitido com sucesso para a equipe e grupos!');
  } catch (err) {
    logBotDeck(`[ERRO AVISO] ${err.message}`, 'error');
    alert('Erro: ' + err.message);
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldText;
      btnEl.disabled = false;
    }
  }
}


// ==========================================
// BOT DECK PRO: REATIVIDADE, PRESETS & TOAST
// ==========================================

function showBotToast(title, message, type = 'success') {
  const container = document.getElementById('botdeck-toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `botdeck-toast ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info');

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <div class="botdeck-toast-content">
      <div class="botdeck-toast-title">${title}</div>
      <div>${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Som suave via Web Audio API
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = type === 'success' ? 587.33 : (type === 'error' ? 220.00 : 440.00);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function searchBotDeck(term) {
  const q = term.toLowerCase().trim();
  const cards = document.querySelectorAll('.botdeck-card');
  let matched = 0;

  cards.forEach(card => {
    const text = card.innerText.toLowerCase();
    const isMatch = !q || text.includes(q);
    card.style.display = isMatch ? 'flex' : 'none';
    if (isMatch) matched++;
  });
}

function fillOwnerNumber(targetId) {
  const el = document.getElementById(targetId);
  if (el) {
    el.value = '554884702848';
    showBotToast('Número Inserido', 'Telefone do Dono (554884702848) preenchido!', 'info');
  }
}

function fillPreset(targetId, text) {
  const el = document.getElementById(targetId);
  if (el) {
    el.value = text;
    showBotToast('Modelo Aplicado', 'Texto de alta conversão carregado!', 'info');
  }
}

async function pingChip(instId) {
  try {
    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PING_CHIP', payload: { instanceId: instId } })
    });
    const data = await res.json();
    showBotToast('Diagnóstico do Chip', data.message, 'success');
  } catch (err) {
    showBotToast('Erro no Diagnóstico', err.message, 'error');
  }
}

async function botDeckSecurityToggle(feature, enabled, btnEl) {
  const groupJid = document.getElementById('botdeck-sec-group')?.value;
  if (!groupJid) {
    showBotToast('Atenção', 'Selecione o grupo do WhatsApp primeiro.', 'warning');
    return;
  }
  const payload = { groupJid, feature, enabled };
  botDeckAction('GROUP_SET_SECURITY', btnEl, payload);
}

// Atualiza renderização dos chips de saúde no loadBotDeck
const originalLoadBotDeck = loadBotDeck;
loadBotDeck = async function() {
  await originalLoadBotDeck();
  const listEl = document.getElementById('botdeckChipsList');
  if (listEl && botdeckData && botdeckData.instances) {
    listEl.innerHTML = botdeckData.instances.map(inst => {
      const isOnline = inst.status === 'CONNECTED';
      const dotClass = isOnline ? 'online' : (inst.status === 'PAUSED' ? 'paused' : 'offline');
      return `
        <div class="chip-health-card" onclick="pingChip('${inst.id}')" style="cursor:pointer;" title="Clique para testar latência">
          <span class="chip-health-dot ${dotClass}"></span>
          <span>#${inst.id} ${inst.name.slice(0, 15)}</span>
          <span class="text-muted text-xs">${inst.phone || 'S/N'}</span>
        </div>
      `;
    }).join('');
  }
  if (typeof loadBotDeckTelemetry === 'function') {
    loadBotDeckTelemetry(false);
  }
};


// ==========================================
// CONTROLADOR DE MODERAÇÃO HEURÍSTICA & DENÚNCIAS (BOT DECK)
// ==========================================
async function loadModerationReports() {
  try {
    const res = await fetch('/api/moderation/reports?limit=25');
    const data = await res.json();
    if (data.success && data.reports) {
      renderModerationReports(data.reports);
    }
  } catch (err) {
    console.warn('[Moderation] Erro ao carregar denúncias:', err.message);
  }
}

function renderModerationReports(reports) {
  const tbody = document.getElementById('botdeckModerationTableBody');
  if (!tbody) return;

  if (!reports || reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-3">Nenhuma denúncia recente registrada na fila.</td></tr>';
    return;
  }

  tbody.innerHTML = reports.map(r => {
    const timeStr = r.created_at ? new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const authorPhone = (r.reported_author_jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const reporterPhone = (r.reporter_jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const scorePct = Math.round((r.spam_score || 0) * 100);
    const scoreColor = scorePct >= 80 ? '#ef4444' : (scorePct >= 50 ? '#f59e0b' : '#10b981');

    let statusBadge = '<span class="badge badge-warning">Pendente</span>';
    if (r.status === 'DELETED') statusBadge = '<span class="badge badge-danger">Apagada</span>';
    else if (r.status === 'UPHELD') statusBadge = '<span class="badge badge-success">Confirmada</span>';
    else if (r.status === 'DISMISSED') statusBadge = '<span class="badge badge-paid">Dispensada</span>';

    return `
      <tr>
        <td><strong>#${r.id}</strong></td>
        <td>${timeStr}</td>
        <td><span style="color:#ef4444; font-weight:600;">@${authorPhone || 'N/A'}</span></td>
        <td><span style="color:#38bdf8;">@${reporterPhone || 'S/N'}</span></td>
        <td style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${(r.reported_text || '').replace(/"/g, '&quot;')}">
          "${r.reported_text || 'Sem texto'}"
        </td>
        <td>
          <span style="font-weight:700; color:${scoreColor};">${scorePct}%</span>
          <span class="text-muted text-xs">(${r.category || 'Geral'})</span>
        </td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">
          <div class="d-inline-flex gap-1">
            <button class="btn btn-xs btn-outline text-danger" title="Apagar Mensagem no WhatsApp" onclick="deleteModReportMsg(${r.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
            <button class="btn btn-xs btn-outline text-warning" title="Banir Usuário do Grupo" onclick="banModReportUser(${r.id})">
              <i class="fa-solid fa-user-slash"></i>
            </button>
            <button class="btn btn-xs btn-outline" title="Dispensar Denúncia" onclick="dismissModReport(${r.id})">
              <i class="fa-solid fa-check"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function scanModText(btnEl) {
  const inputEl = document.getElementById('botdeck-mod-scan-text');
  const text = inputEl ? inputEl.value.trim() : '';
  if (!text) {
    showBotToast('Atenção', 'Digite uma mensagem para analisar as heurísticas.', 'warning');
    return;
  }

  const origHtml = btnEl ? btnEl.innerHTML : '';
  if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Escaneando...';

  try {
    const res = await fetch('/api/moderation/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao analisar');

    const an = data.analysis;
    const resBox = document.getElementById('botdeck-scan-result');
    if (resBox) {
      resBox.style.display = 'block';

      const scorePct = Math.round((an.score || 0) * 100);
      const isSpam = an.score >= 0.70;
      const isSuspicious = an.score >= 0.45;

      const badge = document.getElementById('scanResultBadge');
      if (badge) {
        badge.className = isSpam ? 'badge badge-danger' : (isSuspicious ? 'badge badge-warning' : 'badge badge-success');
        badge.innerText = isSpam ? `ALTO RISCO (${scorePct}%)` : (isSuspicious ? `SUSPEITO (${scorePct}%)` : `LIMPO (${scorePct}%)`);
      }

      const normEl = document.getElementById('scanNormalizedText');
      if (normEl) normEl.innerHTML = `<strong>Texto Normalizado:</strong> "${an.normalized.text}"`;

      const meterEl = document.getElementById('scanScoreMeter');
      if (meterEl) meterEl.innerText = `Spam Score: ${scorePct}%`;

      const catEl = document.getElementById('scanCategory');
      if (catEl) catEl.innerText = `Categoria Dominante: ${an.category || 'Nenhuma'}`;

      const statsEl = document.getElementById('scanStats');
      if (statsEl) {
        const s = an.normalized.stats;
        statsEl.innerText = `Invisíveis: ${s.invisibles} | Estilizados: ${Math.round(s.stylizedRatio * 100)}% | Emojis: ${s.emojiCount} | Links: ${s.linkCount}`;
      }

      const hitsEl = document.getElementById('scanRuleHits');
      if (hitsEl) {
        hitsEl.innerHTML = an.hits.length 
          ? '<strong>Regras Ativadas:</strong> ' + an.hits.map(h => `<span class="badge badge-mini" style="background:#334155;">${h.name} (${h.evidence})</span>`).join(' ')
          : '<span class="text-muted">Nenhuma regra heurística acionada.</span>';
      }

      const dampEl = document.getElementById('scanDampeners');
      if (dampEl) {
        dampEl.innerHTML = an.dampeners.length 
          ? '<strong>Atenuadores (Dampeners) Ativos:</strong> ' + an.dampeners.map(d => `<span class="badge badge-mini" style="background:#065f46; color:#a7f3d0;">${d} (Usuário reportando/citando)</span>`).join(' ')
          : '';
      }
    }

    logToBotDeckConsole('Escaner Heurístico', `Texto analisado com sucesso! Score: ${Math.round(an.score * 100)}% | Categoria: ${an.category || 'Limpo'}`);
    showBotToast('Escaneamento Concluído', `Score: ${Math.round(an.score * 100)}% | Categoria: ${an.category || 'Limpo'}`, an.score >= 0.7 ? 'warning' : 'success');
  } catch (err) {
    showBotToast('Erro no Escaneamento', err.message, 'error');
  } finally {
    if (btnEl) btnEl.innerHTML = origHtml;
  }
}

async function toggleModMode(btnEl) {
  const currentBadge = document.getElementById('badgeModMode');
  const isEnforce = currentBadge && currentBadge.innerText.includes('ENFORCE');
  const newMode = isEnforce ? 'shadow' : 'enforce';

  await botDeckAction('MODERATION_SET_MODE', btnEl, { mode: newMode });
  if (currentBadge) {
    currentBadge.className = newMode === 'enforce' ? 'badge badge-success' : 'badge badge-warning';
    currentBadge.innerText = newMode === 'enforce' ? 'ATIVO (ENFORCE)' : 'SOMBRA (SHADOW)';
  }
}

async function toggleModAutoDelete(btnEl) {
  const currentBadge = document.getElementById('badgeModAutoDel');
  const isDel = currentBadge && currentBadge.innerText.includes('ON');
  const newVal = !isDel;

  await botDeckAction('MODERATION_TOGGLE_AUTODELETE', btnEl, { enabled: newVal });
  if (currentBadge) {
    currentBadge.className = newVal ? 'badge badge-paid' : 'badge badge-secondary';
    currentBadge.innerText = newVal ? 'Auto-Delete ON' : 'Auto-Delete OFF';
  }
}

async function clearModReports(btnEl) {
  if (!confirm('Deseja limpar as denúncias antigas registradas na fila?')) return;
  await botDeckAction('MODERATION_CLEAR_REPORTS', btnEl, { days: 0 });
  loadModerationReports();
}

async function deleteModReportMsg(reportId) {
  try {
    const res = await fetch('/api/moderation/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, action: 'delete' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showBotToast('Sucesso', 'Mensagem apagada para todos com sucesso!', 'success');
    loadModerationReports();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function banModReportUser(reportId) {
  if (!confirm('Deseja realmente expulsar o autor desta mensagem do grupo?')) return;
  try {
    const res = await fetch('/api/moderation/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, action: 'ban' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showBotToast('Sucesso', 'Autor expulso do grupo com sucesso!', 'success');
    loadModerationReports();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function dismissModReport(reportId) {
  try {
    const res = await fetch('/api/moderation/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, action: 'dismiss' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showBotToast('Sucesso', 'Denúncia dispensada!', 'info');
    loadModerationReports();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}


// ==========================================
// MONITOR EM TEMPO REAL: BOTS & SUB-BOTS (TELEMETRIA, FUNÇÕES & PROJEÇÕES)
// ==========================================
let botDeckTelemetryTimer = null;
let botDeckTelemetryIntervalMs = 5000;
let botDeckTelemetryViewMode = 'grid'; // 'grid' | 'table'
let botDeckTelemetryData = null;
let isTelemetryFetching = false;

function startBotDeckTelemetryPolling() {
  if (botDeckTelemetryTimer) clearInterval(botDeckTelemetryTimer);
  loadBotDeckTelemetry(false);
  if (botDeckTelemetryIntervalMs > 0) {
    botDeckTelemetryTimer = setInterval(() => {
      loadBotDeckTelemetry(false);
    }, botDeckTelemetryIntervalMs);
  }
}

function stopBotDeckTelemetryPolling() {
  if (botDeckTelemetryTimer) {
    clearInterval(botDeckTelemetryTimer);
    botDeckTelemetryTimer = null;
  }
}

function toggleTelemetryLiveMode() {
  const badgeEl = document.getElementById('telemetryLiveBadge');
  const textEl = document.getElementById('telemetryLiveText');

  // Ciclo: 5s -> 10s -> 30s -> Pausado (0) -> 5s
  if (botDeckTelemetryIntervalMs === 5000) {
    botDeckTelemetryIntervalMs = 10000;
    if (textEl) textEl.innerText = 'LIVE (10s)';
    if (badgeEl) badgeEl.classList.remove('paused');
    showBotToast('Modo Tempo Real', 'Atualização ao vivo a cada 10 segundos.', 'info');
  } else if (botDeckTelemetryIntervalMs === 10000) {
    botDeckTelemetryIntervalMs = 30000;
    if (textEl) textEl.innerText = 'LIVE (30s)';
    if (badgeEl) badgeEl.classList.remove('paused');
    showBotToast('Modo Tempo Real', 'Atualização ao vivo a cada 30 segundos.', 'info');
  } else if (botDeckTelemetryIntervalMs === 30000) {
    botDeckTelemetryIntervalMs = 0;
    if (textEl) textEl.innerText = 'PAUSADO';
    if (badgeEl) badgeEl.classList.add('paused');
    showBotToast('Modo Tempo Real', 'Atualização automática pausada.', 'warning');
  } else {
    botDeckTelemetryIntervalMs = 5000;
    if (textEl) textEl.innerText = 'LIVE (5s)';
    if (badgeEl) badgeEl.classList.remove('paused');
    showBotToast('Modo Tempo Real', 'Atualização ao vivo a cada 5 segundos ativada!', 'success');
  }

  startBotDeckTelemetryPolling();
}

function toggleTelemetryViewMode() {
  const gridEl = document.getElementById('botdeckLiveBotsGrid');
  const tableContainerEl = document.getElementById('botdeckLiveBotsTableContainer');
  const btnTextEl = document.getElementById('telemetryViewModeText');

  if (botDeckTelemetryViewMode === 'grid') {
    botDeckTelemetryViewMode = 'table';
    if (gridEl) gridEl.style.display = 'none';
    if (tableContainerEl) tableContainerEl.classList.add('active');
    if (btnTextEl) btnTextEl.innerText = 'Ver Cards';
  } else {
    botDeckTelemetryViewMode = 'grid';
    if (gridEl) gridEl.style.display = 'grid';
    if (tableContainerEl) tableContainerEl.classList.remove('active');
    if (btnTextEl) btnTextEl.innerText = 'Ver Tabela';
  }
}

async function loadBotDeckTelemetry(showToast = false) {
  if (isTelemetryFetching) return;
  isTelemetryFetching = true;
  try {
    const res = await fetch('/api/botdeck/telemetry');
    const data = await res.json();
    const telemetry = data.telemetry || data.data;
    if (!data.success || !telemetry) return;

    botDeckTelemetryData = telemetry;
    renderClusterProjections(telemetry.cluster);
    renderTelemetryBotsGrid(telemetry);
    renderTelemetryBotsTable(telemetry);

    if (showToast) {
      showBotToast('Telemetria Sincronizada', 'Métricas de todos os bots e sub-bots atualizadas em tempo real!', 'success');
    }
  } catch (err) {
    console.warn('[Telemetry] Erro ao sincronizar telemetria:', err.message);
  } finally {
    isTelemetryFetching = false;
  }
}

function renderClusterProjections(cluster) {
  if (!cluster) return;

  const quotaVal = document.getElementById('clusterKpiQuotaVal');
  const quotaPct = document.getElementById('clusterKpiQuotaPct');
  const quotaBar = document.getElementById('clusterKpiQuotaBar');
  if (quotaVal) quotaVal.innerText = `${cluster.daily_sent} / ${cluster.total_capacity}`;
  if (quotaPct) quotaPct.innerText = `${cluster.quota_percentage}% da capacidade segura consumida`;
  if (quotaBar) {
    const pct = Math.min(cluster.quota_percentage, 100);
    quotaBar.style.width = `${pct}%`;
    quotaBar.style.background = pct >= 90 ? '#ef4444' : (pct >= 70 ? '#f59e0b' : '#38bdf8');
  }

  const reachVal = document.getElementById('clusterKpiReachVal');
  const reachPace = document.getElementById('clusterKpiReachPace');
  const reachBar = document.getElementById('clusterKpiReachBar');
  if (reachVal) reachVal.innerText = `~${(cluster.projected_reach || 0).toLocaleString('pt-BR')} contatos`;
  if (reachPace) reachPace.innerText = `${cluster.connected_bots} nós ativos | ${cluster.daily_sent} msgs disparadas`;
  if (reachBar) {
    const reachPct = cluster.total_capacity > 0 ? Math.min(Math.round(((cluster.projected_reach || 0) / cluster.total_capacity) * 100), 100) : 0;
    reachBar.style.width = `${reachPct}%`;
  }

  const salesVal = document.getElementById('clusterKpiSalesVal');
  const salesCount = document.getElementById('clusterKpiSalesCount');
  const salesBar = document.getElementById('clusterKpiSalesBar');
  if (salesVal) salesVal.innerText = `R$ ${(cluster.projected_revenue_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (salesCount) salesCount.innerText = `~${cluster.projected_sales || 0} conversões de soluções tech`;
  if (salesBar) {
    const salesProgress = Math.min((cluster.projected_sales || 0) * 10, 100);
    salesBar.style.width = `${salesProgress}%`;
  }

  const safetyVal = document.getElementById('clusterKpiSafetyVal');
  const safetyStatus = document.getElementById('clusterKpiSafetyStatus');
  const safetyBar = document.getElementById('clusterKpiSafetyBar');
  if (safetyVal) safetyVal.innerText = `${cluster.safety_score}%`;
  if (safetyStatus) {
    if (cluster.safety_score >= 85) {
      safetyStatus.innerHTML = '<span class="text-success"><i class="fa-solid fa-circle-check"></i> Operando no nível SEGURO</span>';
    } else if (cluster.safety_score >= 60) {
      safetyStatus.innerHTML = '<span class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Alerta de aquecimento</span>';
    } else {
      safetyStatus.innerHTML = '<span class="text-danger"><i class="fa-solid fa-fire"></i> Risco de ban elevado</span>';
    }
  }
  if (safetyBar) {
    safetyBar.style.width = `${cluster.safety_score}%`;
    safetyBar.style.background = cluster.safety_score >= 85 ? '#10b981' : (cluster.safety_score >= 60 ? '#f59e0b' : '#ef4444');
  }
}

function renderTelemetryBotsGrid(telemetry) {
  const container = document.getElementById('botdeckLiveBotsGrid');
  if (!container || !telemetry || !telemetry.bots) return;

  // Se o usuário estiver atualmente interagindo com um dropdown dentro da grade, preserva o foco
  if (document.activeElement && document.activeElement.closest('#botdeckLiveBotsGrid') && document.activeElement.tagName === 'SELECT') {
    return;
  }

  const roles = telemetry.roles_catalog || telemetry.available_roles || {};

  container.innerHTML = telemetry.bots.map(bot => {
    const isMatriz = bot.id === 'matriz';
    const isOnline = bot.status === 'CONNECTED';
    const isPaused = bot.status === 'PAUSED';
    const isQr = bot.status === 'QRCODE';

    let ringClass = 'offline';
    let statusBadge = '<span class="badge badge-danger">Offline</span>';
    if (isOnline) {
      ringClass = 'online';
      statusBadge = '<span class="badge badge-success">Online</span>';
    } else if (isPaused) {
      ringClass = 'paused';
      statusBadge = '<span class="badge badge-warning">Pausado</span>';
    } else if (isQr) {
      ringClass = 'warmup';
      statusBadge = '<span class="badge badge-info">Aguardando QR</span>';
    }

    const quotaPct = bot.quota_percentage || 0;
    const quotaColor = quotaPct >= 90 ? '#ef4444' : (quotaPct >= 70 ? '#f59e0b' : '#38bdf8');
    const safetyColor = bot.anti_ban_safety_score >= 85 ? '#10b981' : (bot.anti_ban_safety_score >= 60 ? '#f59e0b' : '#ef4444');

    const roleMeta = bot.role_meta || {
      label: bot.role || 'Geral',
      desc: 'Operação padrão de atendimento',
      color: '#38bdf8',
      icon: 'fa-solid fa-robot'
    };

    let roleOptionsHtml = '';
    Object.keys(roles).forEach(rk => {
      const r = roles[rk];
      const sel = rk === bot.role ? 'selected' : '';
      roleOptionsHtml += `<option value="${rk}" ${sel}>${r.label}</option>`;
    });

    const cardExtraClass = isMatriz ? 'main-bot-card' : (bot.role === 'BUSINESS_CATALOG' ? 'business-card' : '');

    return `
      <div class="telemetry-bot-card ${cardExtraClass}" id="telemetry-card-${bot.id}">
        <div class="telemetry-bot-top">
          <div class="telemetry-bot-avatar">
            <span class="telemetry-bot-status-ring ${ringClass}"></span>
            <i class="fa-solid ${isMatriz ? 'fa-crown text-warning' : 'fa-robot text-info'}"></i>
          </div>
          <div class="telemetry-bot-info">
            <div class="telemetry-bot-name">
              ${escapeHtml(bot.name)}
              ${isMatriz ? '<span class="badge badge-primary badge-mini">MATRIZ</span>' : `<span class="badge badge-info badge-mini">SUB-BOT #${bot.id}</span>`}
            </div>
            <div class="telemetry-bot-phone">
              <i class="fa-solid fa-phone text-xs"></i> ${bot.phone ? '+' + bot.phone : 'Sem número'} • ${statusBadge}
            </div>
          </div>
        </div>

        <div class="telemetry-role-box">
          <div class="telemetry-role-header">
            <span class="telemetry-role-label">Função Operacional:</span>
            <span class="badge badge-mini" style="background:${roleMeta.color}22; color:${roleMeta.color}; border: 1px solid ${roleMeta.color}55;">
              <i class="${roleMeta.icon}"></i> ${roleMeta.label}
            </span>
          </div>
          <select class="role-select-inline" onchange="changeBotRole('${bot.id}', this.value)" ${isMatriz ? 'disabled title="A Matriz Principal opera fixamente como Orquestradora Geral"' : ''}>
            ${roleOptionsHtml}
          </select>
          <div class="telemetry-role-desc">${roleMeta.desc}</div>
        </div>

        <div class="telemetry-metrics-grid">
          <div class="telemetry-metric-item">
            <div class="metric-item-label">
              <span>Cota Diária</span>
              <span style="color:${quotaColor};">${quotaPct}%</span>
            </div>
            <div class="metric-item-val">${bot.messages_sent_today} <span class="text-xs text-muted">/ ${bot.daily_limit}</span></div>
            <div class="progress-container-sm" style="margin-top:6px;">
              <div class="progress-bar-fill" style="width:${Math.min(quotaPct, 100)}%; background:${quotaColor};"></div>
            </div>
          </div>

          <div class="telemetry-metric-item">
            <div class="metric-item-label">
              <span>Saúde Uptime</span>
              <i class="fa-solid fa-heart-pulse text-success text-xs"></i>
            </div>
            <div class="metric-item-val text-success">${bot.health_score}%</div>
            <div class="progress-container-sm" style="margin-top:6px;">
              <div class="progress-bar-fill" style="width:${bot.health_score}%; background:#10b981;"></div>
            </div>
          </div>

          <div class="telemetry-metric-item">
            <div class="metric-item-label">
              <span>Entrega OK</span>
              <i class="fa-solid fa-check-double text-info text-xs"></i>
            </div>
            <div class="metric-item-val text-info">${bot.delivery_success_rate}%</div>
            <div class="progress-container-sm" style="margin-top:6px;">
              <div class="progress-bar-fill" style="width:${bot.delivery_success_rate}%; background:#38bdf8;"></div>
            </div>
          </div>

          <div class="telemetry-metric-item">
            <div class="metric-item-label">
              <span>Anti-Ban</span>
              <i class="fa-solid fa-shield-halved text-purple text-xs"></i>
            </div>
            <div class="metric-item-val" style="color:${safetyColor};">${bot.anti_ban_safety_score}%</div>
            <div class="progress-container-sm" style="margin-top:6px;">
              <div class="progress-bar-fill" style="width:${bot.anti_ban_safety_score}%; background:${safetyColor};"></div>
            </div>
          </div>
        </div>

        <div class="telemetry-projections-box">
          <div class="proj-row">
            <span class="proj-label"><i class="fa-solid fa-bullseye text-warning"></i> Alcance Projetado (hoje):</span>
            <span class="proj-val">~${(bot.projected_daily_reach || 0).toLocaleString('pt-BR')} contatos</span>
          </div>
          <div class="proj-row">
            <span class="proj-label"><i class="fa-solid fa-hand-holding-dollar text-success"></i> Vendas Tech Projetadas:</span>
            <span class="proj-val sales">R$ ${(bot.projected_revenue_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 })} (~${bot.projected_sales || 0} pedidos)</span>
          </div>
          <div class="proj-row">
            <span class="proj-label"><i class="fa-solid fa-gauge-simple-high text-info"></i> Velocidade &amp; Cota:</span>
            <span class="proj-val" style="color:#cbd5e1; font-weight:600;">${bot.pace_per_hour} msgs/h • ${bot.time_to_exhaustion}</span>
          </div>
        </div>

        <div class="telemetry-task-bar" title="Tarefa ativa no cluster">
          <i class="fa-solid fa-list-check text-info"></i>
          <span>${escapeHtml(bot.current_task)}</span>
        </div>

        <div class="telemetry-bot-actions">
          <button class="btn btn-xs btn-outline" onclick="pingChip('${bot.id}')" title="Testar latência e conectividade">
            <i class="fa-solid fa-bolt"></i> Ping
          </button>
          ${!isMatriz ? `
            <button class="btn btn-xs btn-outline ${isPaused ? 'text-success' : 'text-warning'}" onclick="toggleBotPause('${bot.id}', '${bot.status}')" title="${isPaused ? 'Retomar operações' : 'Pausar este sub-bot'}">
              <i class="fa-solid ${isPaused ? 'fa-play' : 'fa-pause'}"></i> ${isPaused ? 'Retomar' : 'Pausar'}
            </button>
            <button class="btn btn-xs btn-outline text-info" onclick="resetSingleBotQuota('${bot.id}')" title="Zerar mensagens enviadas hoje para novo ciclo">
              <i class="fa-solid fa-clock-rotate-left"></i> Zerar
            </button>
          ` : `
            <button class="btn btn-xs btn-outline text-info" onclick="loadBotDeck()" title="Sincronizar Matriz">
              <i class="fa-solid fa-arrows-rotate"></i> Sync
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function renderTelemetryBotsTable(telemetry) {
  const tbody = document.getElementById('botdeckLiveBotsTableBody');
  if (!tbody || !telemetry || !telemetry.bots) return;

  if (document.activeElement && document.activeElement.closest('#botdeckLiveBotsTableContainer') && document.activeElement.tagName === 'SELECT') {
    return;
  }

  const roles = telemetry.roles_catalog || telemetry.available_roles || {};

  tbody.innerHTML = telemetry.bots.map(bot => {
    const isMatriz = bot.id === 'matriz';
    const isOnline = bot.status === 'CONNECTED';
    const isPaused = bot.status === 'PAUSED';
    const isQr = bot.status === 'QRCODE';

    let ringClass = 'offline';
    let statusBadge = '<span class="badge badge-danger">Offline</span>';
    if (isOnline) {
      ringClass = 'online';
      statusBadge = '<span class="badge badge-success">Online</span>';
    } else if (isPaused) {
      ringClass = 'paused';
      statusBadge = '<span class="badge badge-warning">Pausado</span>';
    } else if (isQr) {
      ringClass = 'warmup';
      statusBadge = '<span class="badge badge-info">Aguardando QR</span>';
    }

    const quotaPct = bot.quota_percentage || 0;
    const quotaColor = quotaPct >= 90 ? '#ef4444' : (quotaPct >= 70 ? '#f59e0b' : '#38bdf8');
    const safetyColor = bot.anti_ban_safety_score >= 85 ? '#10b981' : (bot.anti_ban_safety_score >= 60 ? '#f59e0b' : '#ef4444');

    let roleOptionsHtml = '';
    Object.keys(roles).forEach(rk => {
      const r = roles[rk];
      const sel = rk === bot.role ? 'selected' : '';
      roleOptionsHtml += `<option value="${rk}" ${sel}>${r.label}</option>`;
    });

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="telemetry-bot-status-ring ${ringClass}" style="position:static; display:inline-block;"></span>
            <div>
              <strong>${escapeHtml(bot.name)}</strong>
              <div>${isMatriz ? '<span class="badge badge-primary badge-mini">MATRIZ</span>' : `<span class="badge badge-info badge-mini">SUB-BOT #${bot.id}</span>`}</div>
            </div>
          </div>
        </td>
        <td><code>${bot.phone ? '+' + bot.phone : 'Sem número'}</code></td>
        <td>${statusBadge}</td>
        <td>
          <select class="role-select-inline" style="font-size:11px; padding:4px 6px;" onchange="changeBotRole('${bot.id}', this.value)" ${isMatriz ? 'disabled' : ''}>
            ${roleOptionsHtml}
          </select>
        </td>
        <td>
          <div style="min-width:110px;">
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700;">
              <span>${bot.messages_sent_today}/${bot.daily_limit}</span>
              <span style="color:${quotaColor};">${quotaPct}%</span>
            </div>
            <div class="progress-container-sm" style="margin-top:2px;">
              <div class="progress-bar-fill" style="width:${Math.min(quotaPct, 100)}%; background:${quotaColor};"></div>
            </div>
          </div>
        </td>
        <td><span style="color:#10b981; font-weight:700;">${bot.health_score}%</span></td>
        <td><span style="color:${safetyColor}; font-weight:700;">${bot.anti_ban_safety_score}%</span></td>
        <td>
          <div><strong>~${(bot.projected_daily_reach || 0).toLocaleString('pt-BR')}</strong> contatos</div>
          <div class="text-xs text-muted">${bot.pace_per_hour} msgs/h</div>
        </td>
        <td>
          <div style="color:#10b981; font-weight:700;">R$ ${(bot.projected_revenue_brl || 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}</div>
          <div class="text-xs text-muted">~${bot.projected_sales || 0} vendas</div>
        </td>
        <td>
          <div class="d-inline-flex gap-1">
            <button class="btn btn-xs btn-outline" onclick="pingChip('${bot.id}')" title="Testar conectividade"><i class="fa-solid fa-bolt"></i></button>
            ${!isMatriz ? `
              <button class="btn btn-xs btn-outline ${isPaused ? 'text-success' : 'text-warning'}" onclick="toggleBotPause('${bot.id}', '${bot.status}')" title="${isPaused ? 'Retomar' : 'Pausar'}"><i class="fa-solid ${isPaused ? 'fa-play' : 'fa-pause'}"></i></button>
              <button class="btn btn-xs btn-outline text-info" onclick="resetSingleBotQuota('${bot.id}')" title="Zerar Cota"><i class="fa-solid fa-clock-rotate-left"></i></button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function changeBotRole(instanceId, newRole) {
  if (instanceId === 'matriz') {
    showBotToast('Aviso', 'A Matriz Principal opera fixamente como Orquestradora Geral.', 'info');
    return;
  }
  try {
    const res = await fetch(`/api/botdeck/subbots/${instanceId}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erro ao alterar função');
    showBotToast('Função Atualizada', data.message || `Sub-bot #${instanceId} reconfigurado!`, 'success');
    loadBotDeckTelemetry(false);
  } catch (err) {
    showBotToast('Erro na Função', err.message, 'error');
  }
}

async function resetAllSubbotsQuota(btnEl) {
  if (!confirm('Deseja resetar o contador diário de mensagens de TODOS os bots e sub-bots?')) return;
  let oldText = '';
  if (btnEl) {
    oldText = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetando...';
    btnEl.disabled = true;
  }
  try {
    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SUBBOT_RESET_QUOTA', payload: {} })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao resetar cotas');
    showBotToast('Cotas Reiniciadas', data.message || 'Cotas diárias zeradas com sucesso!', 'success');
    loadBotDeckTelemetry(false);
  } catch (err) {
    showBotToast('Erro ao Resetar Cotas', err.message, 'error');
  } finally {
    if (btnEl) {
      btnEl.innerHTML = oldText;
      btnEl.disabled = false;
    }
  }
}

async function resetSingleBotQuota(instanceId) {
  if (!confirm(`Zerar o contador diário de mensagens do bot #${instanceId}?`)) return;
  try {
    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SUBBOT_RESET_QUOTA', payload: { instanceId } })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao resetar cota');
    showBotToast('Cota Reiniciada', `Cota do bot #${instanceId} zerada para novo ciclo!`, 'success');
    loadBotDeckTelemetry(false);
  } catch (err) {
    showBotToast('Erro ao Resetar Cota', err.message, 'error');
  }
}

async function toggleBotPause(instanceId, currentStatus) {
  const isPaused = currentStatus === 'PAUSED';
  const action = isPaused ? 'SUBBOT_RESUME' : 'SUBBOT_PAUSE';
  try {
    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload: { instanceId } })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao alterar status');
    showBotToast('Status Atualizado', data.message || `Bot #${instanceId} ${isPaused ? 'retomado' : 'pausado'}!`, 'info');
    loadBotDeckTelemetry(false);
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}


// ==========================================
// CENTRAL DE INTELIGENCIA CONSULTIVA & CRM COGNITIVO (HEXIS)
// ==========================================
let currentCognitiveData = null;
let currentViewingCogPhone = null;

async function loadCognitiveOverview() {
  try {
    const res = await fetch('/api/cognitive/overview');
    const data = await res.json();
    if (!data.success) return;
    currentCognitiveData = data;

    // Métricas Top Cards
    const elTotal = document.getElementById('cogStatTotalLeads');
    const elAvg = document.getElementById('cogStatAvgReadiness');
    const elHigh = document.getElementById('cogStatHighIntent');
    const elPipe = document.getElementById('cogStatPipeline');

    if (elTotal) elTotal.innerText = data.total_leads || 0;
    if (elAvg) elAvg.innerText = (data.avg_readiness || 0) + '%';
    if (elHigh) elHigh.innerText = data.high_intent_count || 0;
    if (elPipe) elPipe.innerText = (data.total_pipeline_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Funil Pills
    renderCognitiveStagePills(data.stages || {});

    // Tabela de Leads
    renderCognitiveLeadsTable(data.leads || []);
    renderCognitiveKanban(data.leads || []);
    loadScheduledMeetings();
    loadCommercialProposals();
  } catch (err) {
    console.error('Erro ao carregar CRM cognitivo:', err);
  }
}

function renderCognitiveStagePills(stages) {
  const container = document.getElementById('cogStagePills');
  if (!container) return;

  const stageDefs = [
    { key: 'DESCOBERTA', label: '1. Descoberta', color: '#94a3b8' },
    { key: 'QUALIFICACAO', label: '2. Qualificação', color: '#38bdf8' },
    { key: 'PROPOSTA', label: '3. Proposta', color: '#f59e0b' },
    { key: 'OBJECOES', label: '4. Objeções', color: '#ec4899' },
    { key: 'FECHAMENTO', label: '5. Fechamento', color: '#a855f7' },
    { key: 'CONVERTIDO', label: '6. Convertido', color: '#10b981' },
    { key: 'PERDIDO', label: '7. Perdido', color: '#ef4444' }
  ];

  container.innerHTML = stageDefs.map(s => {
    const count = stages[s.key] || 0;
    return '<div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-left: 3px solid ' + s.color + '; border-radius: 6px; padding: 10px 12px;">' +
      '<span style="font-size: 11px; color: var(--text-muted); display: block;">' + s.label + '</span>' +
      '<div style="font-size: 18px; font-weight: 800; color: ' + s.color + '; margin-top: 2px;">' + count + '</div>' +
    '</div>';
  }).join('');
}

function renderCognitiveLeadsTable(leads) {
  const tbody = document.getElementById('tableCognitiveLeadsBody');
  if (!tbody) return;

  if (!leads || leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 30px; color: var(--text-muted);">Nenhum lead com perfil cognitivo registrado ainda. Envie uma mensagem no WhatsApp para ver a extração em tempo real!</td></tr>';
    return;
  }

  tbody.innerHTML = leads.map(lead => {
    const budgetBadgeClass = lead.budget_tier === 'CORPORATIVO' ? 'badge-primary' : (lead.budget_tier === 'ALTO' ? 'badge-paid' : 'badge-pending');
    const score = Math.max(0, Math.min(100, lead.readiness_score || 30));
    const scoreColor = score >= 75 ? '#10b981' : (score >= 50 ? '#38bdf8' : '#f59e0b');

    const objectionLabel = {
      'PRECO': '💰 Preço / Verba',
      'PRAZO': '⏱️ Prazo de Entrega',
      'CONFIANCA_GARANTIA': '🛡️ Garantia / SLA',
      'DECISOR': '👥 Sócio / Comitê',
      'COMPLEXIDADE': '⚙️ Complexidade',
      'NENHUMA': '✅ Sem Objeções'
    }[lead.main_objection] || (lead.main_objection || 'Nenhuma');

    return '<tr>' +
      '<td>' +
        '<div style="font-weight: 700; color: #fff;">' + (lead.name || 'Lead WhatsApp') + '</div>' +
        '<div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">+' + lead.phone + '</div>' +
      '</td>' +
      '<td>' +
        '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 11px;">' +
          (lead.company_niche || 'Geral Tech') +
        '</span>' +
      '</td>' +
      '<td style="max-width: 220px; font-size: 12px; color: #cbd5e1;">' +
        '<div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="' + (lead.project_scope || '') + '">' +
          (lead.project_scope || 'Software sob medida') +
        '</div>' +
        '<div style="font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' +
          'Stack: ' + (lead.tech_stack || 'Node.js, Web') +
        '</div>' +
      '</td>' +
      '<td>' +
        '<span class="badge ' + budgetBadgeClass + '" style="font-size: 11px;">' +
          lead.budget_tier + ' (' + (((lead.budget_confidence || 0.5) * 100).toFixed(0)) + '%)' +
        '</span>' +
      '</td>' +
      '<td>' +
        '<span style="font-size: 11px; font-weight: 600; color: ' + (lead.main_objection === 'NENHUMA' ? '#10b981' : '#ec4899') + ';">' +
          objectionLabel +
        '</span>' +
      '</td>' +
      '<td style="min-width: 140px;">' +
        '<div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">' +
          '<span style="color: ' + scoreColor + '; font-weight: 700;">' + score + '%</span>' +
          '<span style="color: var(--text-muted); font-size: 10px;">' + (score >= 70 ? 'Pronto' : 'Aquecendo') + '</span>' +
        '</div>' +
        '<div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">' +
          '<div style="width: ' + score + '%; height: 100%; background: ' + scoreColor + '; border-radius: 3px;"></div>' +
        '</div>' +
      '</td>' +
      '<td>' +
        '<select class="form-control form-control-sm" style="font-size: 11px; padding: 4px 6px; height: auto;" onchange="updateLeadBuyingStage(\'' + lead.phone + '\', this.value)">' +
          '<option value="DESCOBERTA" ' + (lead.buying_stage === 'DESCOBERTA' ? 'selected' : '') + '>Descoberta</option>' +
          '<option value="QUALIFICACAO" ' + (lead.buying_stage === 'QUALIFICACAO' ? 'selected' : '') + '>Qualificação</option>' +
          '<option value="PROPOSTA" ' + (lead.buying_stage === 'PROPOSTA' ? 'selected' : '') + '>Proposta</option>' +
          '<option value="OBJECOES" ' + (lead.buying_stage === 'OBJECOES' ? 'selected' : '') + '>Objeções</option>' +
          '<option value="FECHAMENTO" ' + (lead.buying_stage === 'FECHAMENTO' ? 'selected' : '') + '>Fechamento</option>' +
          '<option value="CONVERTIDO" ' + (lead.buying_stage === 'CONVERTIDO' ? 'selected' : '') + '>Convertido</option>' +
          '<option value="PERDIDO" ' + (lead.buying_stage === 'PERDIDO' ? 'selected' : '') + '>Perdido</option>' +
        '</select>' +
      '</td>' +
      '<td style="text-align: center; white-space: nowrap;">' +
        '<button class="btn btn-sm btn-primary" onclick="openCognitiveModal(\'' + lead.phone + '\')" title="Inspecionar crenças, memórias e histórico" style="padding: 4px 8px; font-size: 11px; background: #a855f7; border-color: #a855f7;">' +
          '<i class="fa-solid fa-brain"></i> Inspecionar' +
        '</button> ' +
        '<button class="btn btn-sm btn-secondary" onclick="openCognitiveModal(\'' + lead.phone + '\', true)" title="Gerar gancho de follow-up" style="padding: 4px 8px; font-size: 11px;">' +
          '<i class="fa-solid fa-bolt"></i> Gancho' +
        '</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteCognitiveLead(\'' + lead.phone + '\')" title="Excluir lead" style="padding: 4px 8px; font-size: 11px;">' +
          '<i class="fa-solid fa-trash-can"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function filterCognitiveTable() {
  const query = (document.getElementById('cogSearchInput')?.value || '').toLowerCase().trim();
  if (!currentCognitiveData || !currentCognitiveData.leads) return;
  const filtered = currentCognitiveData.leads.filter(l => {
    return (l.name || '').toLowerCase().includes(query) ||
      (l.phone || '').includes(query) ||
      (l.company_niche || '').toLowerCase().includes(query) ||
      (l.project_scope || '').toLowerCase().includes(query);
  });
  renderCognitiveLeadsTable(filtered);
}

async function updateLeadBuyingStage(phone, newStage) {
  try {
    const res = await fetch('/api/cognitive/leads/' + phone, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buying_stage: newStage })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao atualizar');
    showBotToast('Estágio Atualizado', 'Lead +' + phone + ' alterado para ' + newStage, 'info');
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function deleteCognitiveLead(phone) {
  if (!confirm('Deseja realmente excluir o lead +' + phone + ' e todas as suas memórias cognitivas?')) return;
  try {
    const res = await fetch('/api/cognitive/leads/' + phone, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao excluir');
    showBotToast('Lead Removido', 'Lead +' + phone + ' removido com sucesso.', 'info');
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro ao Excluir', err.message, 'error');
  }
}

async function openCognitiveModal(phone, autoGenerateHook) {
  currentViewingCogPhone = phone;
  const modal = document.getElementById('modalCognitiveLead');
  if (!modal) return;
  modal.classList.add('active');

  const containerDetails = document.getElementById('cogModalHeaderDetails');
  const beliefsBody = document.getElementById('tableCogBeliefsBody');
  const timeline = document.getElementById('cogMemoriesTimeline');
  const hookPreview = document.getElementById('cogHookPreview');
  const btnCopy = document.getElementById('btnCopyHook');
  const btnSend = document.getElementById('btnSendHook');

  if (hookPreview) hookPreview.value = '';
  if (btnCopy) btnCopy.style.display = 'none';
  if (btnSend) btnSend.style.display = 'none';

  if (containerDetails) containerDetails.innerHTML = '<div class="text-center"><i class="fa-solid fa-spinner fa-spin"></i> Carregando perfil cognitivo...</div>';
  if (beliefsBody) beliefsBody.innerHTML = '<tr><td colspan="4" class="text-center">Carregando crenças...</td></tr>';
  if (timeline) timeline.innerHTML = '<div class="text-center">Carregando memórias...</div>';

  try {
    const res = await fetch('/api/cognitive/leads/' + phone);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Lead não encontrado');
    const p = data.profile;

    document.getElementById('modalCogLeadTitle').innerHTML = '<i class="fa-solid fa-brain-circuit"></i> Perfil Cognitivo: ' + (p.name || 'Lead') + ' (+' + p.phone + ')';

    if (containerDetails) {
      containerDetails.innerHTML = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">' +
        '<div><b style="color:var(--text-muted); font-size:11px;">NICHO:</b><br><span style="color:#38bdf8; font-weight:700;">' + (p.company_niche || 'Geral') + '</span></div>' +
        '<div><b style="color:var(--text-muted); font-size:11px;">ESCOPO:</b><br><span style="color:#fff;">' + (p.project_scope || 'Software sob medida') + '</span></div>' +
        '<div><b style="color:var(--text-muted); font-size:11px;">ORÇAMENTO:</b><br><span style="color:#fbbf24; font-weight:700;">' + p.budget_tier + ' (' + (((p.budget_confidence || 0.5) * 100).toFixed(0)) + '%)</span></div>' +
        '<div><b style="color:var(--text-muted); font-size:11px;">OBJEÇÃO:</b><br><span style="color:#ec4899; font-weight:700;">' + (p.main_objection || 'Nenhuma') + '</span></div>' +
        '<div><b style="color:var(--text-muted); font-size:11px;">READINESS:</b><br><span style="color:#10b981; font-weight:800;">' + (p.readiness_score || 30) + '% de Fechamento</span></div>' +
        '<div><b style="color:var(--text-muted); font-size:11px;">ESTÁGIO:</b><br><span class="badge badge-paid">' + (p.buying_stage || 'DESCOBERTA') + '</span></div>' +
      '</div>' +
      (p.notes ? '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-color); font-size:12px; color:var(--text-muted);"><b>Notas:</b> ' + p.notes + '</div>' : '');
    }

    // Render Crenças
    if (beliefsBody) {
      if (!p.beliefs || p.beliefs.length === 0) {
        beliefsBody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:15px; color:var(--text-muted);">Nenhuma crença auditada cadastrada.</td></tr>';
      } else {
        beliefsBody.innerHTML = p.beliefs.map(b => '<tr>' +
          '<td style="font-family:monospace; color:#38bdf8;">' + b.belief_key + '</td>' +
          '<td style="font-weight:600; color:#fff;">' + b.belief_value + '</td>' +
          '<td style="color:var(--text-muted); font-size:11px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + (b.evidence_text || '') + '">' + (b.evidence_text || '-') + '</td>' +
          '<td><span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8;">' + (((b.confidence || 0.5) * 100).toFixed(0)) + '%</span></td>' +
        '</tr>').join('');
      }
    }

    // Render Memórias
    if (timeline) {
      if (!p.memories || p.memories.length === 0) {
        timeline.innerHTML = '<div style="text-align:center; padding:15px; color:var(--text-muted);">Nenhuma memória episódica registrada ainda.</div>';
      } else {
        const typeColors = {
          'REQUIREMENT': '#38bdf8',
          'BUDGET': '#fbbf24',
          'OBJECTION': '#ec4899',
          'QUOTE': '#a855f7',
          'AGREEMENT': '#10b981',
          'TIMELINE': '#f97316',
          'FEEDBACK': '#94a3b8'
        };
        timeline.innerHTML = p.memories.map(m => {
          const col = typeColors[m.memory_type] || '#fff';
          return '<div style="background:rgba(255,255,255,0.02); border-left:3px solid ' + col + '; border-radius:4px; padding:8px 12px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<span style="font-size:10px; font-weight:700; color:' + col + '; text-transform:uppercase;">[' + m.memory_type + ']</span>' +
              '<span style="font-size:10px; color:var(--text-muted);">' + new Date(m.created_at).toLocaleString('pt-BR') + '</span>' +
            '</div>' +
            '<div style="font-size:12px; color:#fff; margin-top:2px;">' + m.fact_summary + '</div>' +
            (m.raw_excerpt ? '<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:2px;">"' + m.raw_excerpt + '"</div>' : '') +
          '</div>';
        }).join('');
      }
    }

    if (autoGenerateHook) {
      generateAttentionHookForLead();
    }
  } catch (err) {
    if (containerDetails) containerDetails.innerHTML = '<div class="text-danger">Erro: ' + err.message + '</div>';
  }
}

function closeCognitiveModal() {
  const modal = document.getElementById('modalCognitiveLead');
  if (modal) modal.classList.remove('active');
  currentViewingCogPhone = null;
}

function toggleAddBeliefBox() {
  const box = document.getElementById('cogAddBeliefBox');
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function saveNewLeadBelief() {
  if (!currentViewingCogPhone) return;
  const key = document.getElementById('newBeliefKey')?.value?.trim();
  const value = document.getElementById('newBeliefVal')?.value?.trim();
  const confidence = parseFloat(document.getElementById('newBeliefConf')?.value || '0.85');
  const evidence = document.getElementById('newBeliefEvidence')?.value?.trim();

  if (!key || !value) {
    alert('Preencha a chave e o valor da crença.');
    return;
  }

  try {
    const res = await fetch('/api/cognitive/leads/' + currentViewingCogPhone + '/belief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, confidence, evidence })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao salvar crença');
    showBotToast('Crença Salva', 'Crença ' + key + ' adicionada ao lead.', 'success');
    toggleAddBeliefBox();
    openCognitiveModal(currentViewingCogPhone);
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

function toggleAddMemoryBox() {
  const box = document.getElementById('cogAddMemoryBox');
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function saveNewLeadMemory() {
  if (!currentViewingCogPhone) return;
  const type = document.getElementById('newMemType')?.value;
  const summary = document.getElementById('newMemSummary')?.value?.trim();

  if (!summary) {
    alert('Preencha o resumo do fato para registrar a memória.');
    return;
  }

  try {
    const res = await fetch('/api/cognitive/leads/' + currentViewingCogPhone + '/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, summary, importance: 4 })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao salvar memória');
    showBotToast('Memória Gravada', 'Fato episódico registrado com sucesso.', 'success');
    toggleAddMemoryBox();
    openCognitiveModal(currentViewingCogPhone);
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function generateAttentionHookForLead() {
  if (!currentViewingCogPhone) return;
  const hookPreview = document.getElementById('cogHookPreview');
  const btnCopy = document.getElementById('btnCopyHook');
  const btnSend = document.getElementById('btnSendHook');

  if (hookPreview) hookPreview.value = 'Sintetizando histórico e gerando gancho de alta atenção...';
  try {
    const res = await fetch('/api/cognitive/leads/' + currentViewingCogPhone + '/hook', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao gerar gancho');
    if (hookPreview) hookPreview.value = data.hook || '';
    if (btnCopy) btnCopy.style.display = 'inline-block';
    if (btnSend) btnSend.style.display = 'inline-block';
  } catch (err) {
    if (hookPreview) hookPreview.value = 'Erro: ' + err.message;
  }
}

function copyHookMessage() {
  const hookPreview = document.getElementById('cogHookPreview');
  if (!hookPreview || !hookPreview.value) return;
  navigator.clipboard.writeText(hookPreview.value);
  showBotToast('Copiado', 'Gancho de follow-up copiado para a área de transferência!', 'success');
}

async function sendHookViaWhatsApp() {
  if (!currentViewingCogPhone) return;
  const hookPreview = document.getElementById('cogHookPreview');
  const msg = hookPreview?.value?.trim();
  if (!msg) return;

  if (!confirm('Enviar este gancho de follow-up agora para +' + currentViewingCogPhone + ' via WhatsApp?')) return;

  try {
    const res = await fetch('/api/botdeck/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'SEND_MESSAGE',
        payload: { target: currentViewingCogPhone, message: msg }
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha no envio');
    showBotToast('Gancho Disparado', 'Mensagem enviada com sucesso para +' + currentViewingCogPhone + '!', 'success');
    closeCognitiveModal();
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro no Envio', err.message, 'error');
  }
}

async function runCognitiveHeartbeat() {
  if (!confirm('Deseja acionar a varredura autônoma do Heartbeat para todos os leads que precisam de follow-up?')) return;
  try {
    const res = await fetch('/api/cognitive/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false, limit: 15 })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha no Heartbeat');
    showBotToast('Heartbeat Concluído', data.processed + ' leads processados e cronogramas de atenção atualizados!', 'success');
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro no Heartbeat', err.message, 'error');
  }
}


function executeBotDeckCognitiveAction() {
  const act = document.getElementById('botdeckCogAction')?.value;
  if (act === 'inspect') {
    switchTab('cognitive');
  } else {
    runCognitiveHeartbeat();
  }
}


// ==========================================
// CENTRAL DE VENDAS CONSULTIVAS & CRM COGNITIVO HEXIS (KANBAN, MEETINGS, PROPOSALS, CALCULATOR)
// ==========================================

let currentActiveCognitiveView = 'kanban';
let currentCalculatedScope = null;

function switchCognitiveView(viewName) {
  currentActiveCognitiveView = viewName;
  const views = ['kanban', 'table', 'meetings', 'proposals', 'calculator'];
  const viewMap = {
    kanban: 'cogViewKanban',
    table: 'cogViewTable',
    meetings: 'cogViewMeetings',
    proposals: 'cogViewProposals',
    calculator: 'cogViewCalculator'
  };

  const btnMap = {
    kanban: 'btnViewKanban',
    table: 'btnViewTable',
    meetings: 'btnViewMeetings',
    proposals: 'btnViewProposals',
    calculator: 'btnViewCalculator'
  };

  views.forEach(v => {
    const el = document.getElementById(viewMap[v]);
    const btn = document.getElementById(btnMap[v]);
    if (el) el.style.display = (v === viewName) ? (v === 'calculator' ? 'block' : 'block') : 'none';
    if (btn) {
      if (v === viewName) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  if (viewName === 'meetings') loadScheduledMeetings();
  if (viewName === 'proposals') loadCommercialProposals();
  if (viewName === 'calculator') runLiveScopeCalculation();
}

async function refreshCognitiveWorkspace() {
  try {
    await Promise.all([
      loadCognitiveOverview(),
      loadScheduledMeetings(),
      loadCommercialProposals()
    ]);
    showBotToast('Sincronizado', 'Pipeline Kanban, reuniões e propostas atualizados!', 'success');
  } catch (err) {
    showBotToast('Aviso', 'Erro ao sincronizar: ' + err.message, 'warning');
  }
}

// ==========================================
// 1. PIPELINE KANBAN COM DRAG-AND-DROP
// ==========================================

function renderCognitiveKanban(leads) {
  const stages = ['DESCOBERTA', 'QUALIFICACAO', 'PROPOSTA', 'OBJECOES', 'FECHAMENTO', 'CONVERTIDO'];
  const grouped = {};
  const totals = {};

  stages.forEach(st => {
    grouped[st] = [];
    totals[st] = 0;
  });

  (leads || []).forEach(l => {
    const st = stages.includes(l.buying_stage) ? l.buying_stage : 'DESCOBERTA';
    grouped[st].push(l);
    totals[st] += Number(l.estimated_budget || 0);
  });

  stages.forEach(st => {
    const colCount = document.getElementById('count-' + st);
    const colVal = document.getElementById('val-' + st);
    const colCards = document.getElementById('cards-' + st);

    if (colCount) colCount.innerText = grouped[st].length;
    if (colVal) colVal.innerText = totals[st].toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    if (colCards) {
      if (grouped[st].length === 0) {
        colCards.innerHTML = '<div style="padding: 25px 10px; text-align: center; color: var(--text-muted); font-size: 11px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px;">Nenhum lead nesta etapa</div>';
      } else {
        colCards.innerHTML = grouped[st].map(lead => {
          const score = Math.max(0, Math.min(100, lead.readiness_score || 30));
          const scoreColor = score >= 75 ? '#10b981' : (score >= 50 ? '#38bdf8' : '#f59e0b');
          const budgetFormatted = Number(lead.estimated_budget || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

          return '<div class="crm-kanban-card" id="kcard-' + lead.phone + '" draggable="true" ondragstart="handleCardDragStart(event, \'' + lead.phone + '\')">' +
            '<div class="crm-card-title">' +
              '<span>' + (lead.name || 'Lead WhatsApp') + '</span>' +
              '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 10px;">' + (lead.company_niche || 'Tech') + '</span>' +
            '</div>' +
            '<div class="crm-card-phone">+' + lead.phone + '</div>' +
            '<div class="crm-card-scope" title="' + (lead.project_scope || '') + '">' +
              (lead.project_scope ? (lead.project_scope.length > 55 ? lead.project_scope.substring(0, 55) + '...' : lead.project_scope) : 'Software sob medida') +
            '</div>' +
            '<div class="crm-readiness-bar">' +
              '<div class="crm-readiness-fill" style="width: ' + score + '%; background: ' + scoreColor + ';"></div>' +
            '</div>' +
            '<div class="crm-card-footer">' +
              '<div class="crm-card-budget">' + budgetFormatted + '</div>' +
              '<div class="crm-card-actions">' +
                '<button class="crm-card-btn" title="Perfil e Crenças" onclick="openCognitiveModal(\'' + lead.phone + '\')"><i class="fa-solid fa-brain"></i></button>' +
                '<button class="crm-card-btn" title="Agendar Google Meet" onclick="openScheduleMeetingModal(\'' + lead.phone + '\', \'' + (lead.name || '') + '\', \'' + (lead.project_scope || '') + '\')"><i class="fa-solid fa-video"></i></button>' +
                '<button class="crm-card-btn" title="Gerar Proposta" onclick="openCreateProposalModal({ lead_phone: \'' + lead.phone + '\', lead_name: \'' + (lead.name || '') + '\', investment_brl: ' + (lead.estimated_budget || 0) + ' })"><i class="fa-solid fa-file-contract"></i></button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }
  });
}

function handleCardDragStart(e, phone) {
  e.dataTransfer.setData('text/plain', phone);
  e.dataTransfer.effectAllowed = 'move';
  const card = document.getElementById('kcard-' + phone);
  if (card) card.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  if (col && !col.classList.contains('drag-over')) {
    col.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  const col = e.currentTarget;
  if (col) col.classList.remove('drag-over');
}

async function handleDrop(e, targetStage) {
  e.preventDefault();
  const col = e.currentTarget;
  if (col) col.classList.remove('drag-over');

  const phone = e.dataTransfer.getData('text/plain');
  if (!phone) return;

  const card = document.getElementById('kcard-' + phone);
  if (card) card.classList.remove('dragging');

  // Atualiza visualmente e chama a API
  try {
    const res = await fetch('/api/cognitive/leads/' + phone + '/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: targetStage })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao atualizar estágio');

    showBotToast('Estágio Atualizado', 'Lead +' + phone + ' movido para ' + targetStage, 'success');
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro no Drag & Drop', err.message, 'error');
    loadCognitiveOverview();
  }
}

// ==========================================
// 2. REUNIÕES & GOOGLE MEET
// ==========================================

async function loadScheduledMeetings() {
  try {
    const res = await fetch('/api/meetings');
    const data = await res.json();
    if (!data.success) return;

    const meetings = data.meetings || [];
    const badge = document.getElementById('badgeMeetingCount');
    const stat = document.getElementById('cogStatTotalMeetings');
    if (badge) badge.innerText = meetings.length;
    if (stat) stat.innerText = meetings.length;

    const tbody = document.getElementById('tableScheduledMeetingsBody');
    if (!tbody) return;

    if (meetings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px; color: var(--text-muted);">Nenhuma reunião agendada no momento. Clique no botão acima para agendar uma call técnica!</td></tr>';
      return;
    }

    tbody.innerHTML = meetings.map(m => {
      const [y, mo, d] = (m.meeting_date || '').split('-');
      const dateFormatted = d ? `${d}/${mo}/${y}` : m.meeting_date;
      const statusMap = {
        SCHEDULED: '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">Agendada</span>',
        CONFIRMED: '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">Confirmada</span>',
        COMPLETED: '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">Concluída</span>',
        CANCELED: '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Cancelada</span>'
      };

      const reminderBadge = m.reminder_sent
        ? '<span style="color: #10b981; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-check"></i> Enviado</span>'
        : '<span style="color: #f59e0b; font-size: 11px;"><i class="fa-solid fa-clock"></i> Pendente (1h antes)</span>';

      return '<tr>' +
        '<td>' +
          '<div style="font-weight: 700; color: #fff;">' + dateFormatted + '</div>' +
          '<div style="font-size: 11px; color: #38bdf8; font-weight: 600;">' + m.meeting_time + ' (' + (m.duration_minutes || 30) + ' min)</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-weight: 600; color: #fff;">' + (m.lead_name || 'Lead') + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">+' + m.lead_phone + '</div>' +
        '</td>' +
        '<td style="max-width: 200px; font-size: 12px; color: #cbd5e1;">' +
          (m.topic_scope || m.meeting_title || 'Software / IA') +
        '</td>' +
        '<td>' +
          '<a href="' + m.meet_url + '" target="_blank" class="btn btn-sm btn-primary" style="padding: 3px 8px; font-size: 11px; background: rgba(56, 189, 248, 0.2); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">' +
            '<i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir Meet' +
          '</a>' +
        '</td>' +
        '<td>' + (statusMap[m.status] || m.status) + '</td>' +
        '<td>' + reminderBadge + '</td>' +
        '<td style="text-align: center; white-space: nowrap;">' +
          '<button class="btn btn-sm btn-secondary" onclick="remindScheduledMeeting(' + m.id + ')" title="Disparar Lembrete Agora" style="padding: 3px 7px; font-size: 11px;"><i class="fa-solid fa-bell"></i></button> ' +
          '<button class="btn btn-sm btn-success" onclick="completeScheduledMeeting(' + m.id + ')" title="Marcar como Concluída" style="padding: 3px 7px; font-size: 11px;"><i class="fa-solid fa-check"></i></button> ' +
          '<button class="btn btn-sm btn-danger" onclick="cancelScheduledMeeting(' + m.id + ')" title="Cancelar Reunião" style="padding: 3px 7px; font-size: 11px;"><i class="fa-solid fa-ban"></i></button>' +
        '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar reuniões:', err);
  }
}

function openScheduleMeetingModal(prefillPhone, prefillName, prefillScope) {
  const modal = document.getElementById('modalScheduleMeeting');
  if (!modal) return;

  if (prefillPhone) document.getElementById('meetLeadPhone').value = prefillPhone;
  if (prefillName) document.getElementById('meetLeadName').value = prefillName;
  if (prefillScope) document.getElementById('meetScope').value = prefillScope;

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  document.getElementById('meetDate').value = tomorrow.toISOString().split('T')[0];

  modal.classList.add('active');
}

function closeScheduleMeetingModal() {
  const modal = document.getElementById('modalScheduleMeeting');
  if (modal) modal.classList.remove('active');
}

async function saveScheduledMeeting(e) {
  e.preventDefault();
  const phone = document.getElementById('meetLeadPhone').value.trim();
  const name = document.getElementById('meetLeadName').value.trim();
  const title = document.getElementById('meetTitle').value.trim();
  const date = document.getElementById('meetDate').value;
  const time = document.getElementById('meetTime').value;
  const duration = document.getElementById('meetDuration').value;
  const meet_url = document.getElementById('meetUrl').value.trim();
  const topic = document.getElementById('meetScope').value.trim();

  try {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_phone: phone,
        lead_name: name,
        meeting_title: title,
        meeting_date: date,
        meeting_time: time,
        duration_minutes: duration,
        meet_url: meet_url || undefined,
        topic_scope: topic
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao agendar reunião');

    showBotToast('Reunião Agendada!', 'Call marcada para ' + date + ' às ' + time + '. Link: ' + data.meeting.meet_url, 'success');
    closeScheduleMeetingModal();
    loadScheduledMeetings();
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro no Agendamento', err.message, 'error');
  }
}

async function remindScheduledMeeting(id) {
  try {
    const res = await fetch('/api/meetings/' + id + '/remind', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao disparar');
    showBotToast('Lembrete Enviado', 'Mensagem de lembrete despachada pelo WhatsApp!', 'success');
    loadScheduledMeetings();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function completeScheduledMeeting(id) {
  try {
    const res = await fetch('/api/meetings/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao concluir');
    showBotToast('Concluída', 'Reunião marcada como realizada!', 'success');
    loadScheduledMeetings();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

async function cancelScheduledMeeting(id) {
  const reason = prompt('Informe o motivo do cancelamento (opcional):') || '';
  try {
    const res = await fetch('/api/meetings/' + id + '/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao cancelar');
    showBotToast('Cancelada', 'Reunião cancelada com sucesso.', 'info');
    loadScheduledMeetings();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

// ==========================================
// 3. PROPOSTAS COMERCIAIS & CONTRATOS INTERATIVOS
// ==========================================

async function loadCommercialProposals() {
  try {
    const res = await fetch('/api/proposals');
    const data = await res.json();
    if (!data.success) return;

    const proposals = data.proposals || [];
    const badge = document.getElementById('badgeProposalCount');
    const stat = document.getElementById('cogStatTotalProposals');
    if (badge) badge.innerText = proposals.length;
    if (stat) stat.innerText = proposals.length;

    const tbody = document.getElementById('tableCommercialProposalsBody');
    if (!tbody) return;

    if (proposals.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 30px; color: var(--text-muted);">Nenhuma proposta comercial gerada ainda. Clique em "Gerar Proposta Comercial" para criar a primeira!</td></tr>';
      return;
    }

    tbody.innerHTML = proposals.map(p => {
      const isAccepted = p.status === 'ACCEPTED';
      const statusBadge = isAccepted
        ? '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">✅ Aceita</span>'
        : (p.status === 'SENT' ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">Enviada</span>' : '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">Rascunho</span>');

      const valFormatted = Number(p.investment_brl || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      return '<tr>' +
        '<td>' +
          '<div style="font-weight: 700; color: #38bdf8; font-family: monospace;">' + p.code + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted);">' + new Date(p.created_at).toLocaleDateString('pt-BR') + '</div>' +
        '</td>' +
        '<td>' +
          '<div style="font-weight: 600; color: #fff;">' + (p.lead_name || 'Cliente') + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">+' + p.lead_phone + '</div>' +
        '</td>' +
        '<td style="max-width: 220px; font-size: 12px; color: #cbd5e1;">' +
          '<strong>' + p.project_title + '</strong>' +
        '</td>' +
        '<td>' +
          '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 11px;">' + p.category + '</span>' +
        '</td>' +
        '<td>' + p.timeline_weeks + ' sem</td>' +
        '<td style="font-weight: 700; color: #4ade80;">' + valFormatted + '</td>' +
        '<td>' +
          statusBadge +
          '<div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;"><i class="fa-solid fa-eye"></i> ' + (p.view_count || 0) + ' visualizações</div>' +
        '</td>' +
        '<td style="text-align: center; white-space: nowrap;">' +
          '<a href="/proposta/' + p.token + '" target="_blank" class="btn btn-sm btn-primary" title="Abrir Link da Proposta" style="padding: 3px 8px; font-size: 11px; background: #38bdf8; border-color: #38bdf8; color: #000; font-weight: 700;">' +
            '<i class="fa-solid fa-arrow-up-right-from-square"></i> Ver' +
          '</a> ' +
          '<button class="btn btn-sm btn-success" onclick="sendCommercialProposalToWhatsApp(' + p.id + ')" title="Enviar Proposta pelo WhatsApp" style="padding: 3px 8px; font-size: 11px;">' +
            '<i class="fa-brands fa-whatsapp"></i> Enviar' +
          '</button> ' +
          '<button class="btn btn-sm btn-danger" onclick="deleteCommercialProposal(' + p.id + ')" title="Excluir Proposta" style="padding: 3px 8px; font-size: 11px;">' +
            '<i class="fa-solid fa-trash-can"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar propostas:', err);
  }
}

function openCreateProposalModal(prefillData = {}) {
  const modal = document.getElementById('modalCreateProposal');
  if (!modal) return;

  if (prefillData.lead_phone) document.getElementById('propLeadPhone').value = prefillData.lead_phone;
  if (prefillData.lead_name) document.getElementById('propLeadName').value = prefillData.lead_name;
  if (prefillData.lead_company) document.getElementById('propLeadCompany').value = prefillData.lead_company;
  if (prefillData.project_title) document.getElementById('propProjectTitle').value = prefillData.project_title;
  if (prefillData.category) document.getElementById('propCategory').value = prefillData.category;
  if (prefillData.investment_brl) document.getElementById('propInvestment').value = prefillData.investment_brl;
  if (prefillData.timeline_weeks) document.getElementById('propTimeline').value = prefillData.timeline_weeks;
  if (prefillData.tech_stack) document.getElementById('propTechStack').value = prefillData.tech_stack;
  if (prefillData.scope_description) document.getElementById('propScopeDesc').value = prefillData.scope_description;

  if (!prefillData.project_title) {
    applyProposalPreset(document.getElementById('propCategory').value || 'SOFTWARE');
  }

  modal.classList.add('active');
}

function closeCreateProposalModal() {
  const modal = document.getElementById('modalCreateProposal');
  if (modal) modal.classList.remove('active');
}

function applyProposalPreset(cat) {
  const presets = {
    SOFTWARE: { title: 'Software Sob Medida & Painel de Gestão em Tempo Real', price: 4800, weeks: 3, stack: 'Node.js, Vue.js/React, SQLite/PostgreSQL, WebSockets' },
    APP_MOBILE: { title: 'Aplicativo Mobile Personalizado (iOS & Android)', price: 6500, weeks: 4, stack: 'React Native / Flutter, Node.js API, Firebase' },
    AI_AGENT: { title: 'Agente de IA Consultivo & Automação Cognitiva', price: 3900, weeks: 2, stack: 'Gemini API, Node.js, Baileys WhatsApp, SQLite Vetorial' },
    HARDWARE_IOT: { title: 'Solução Integrada de Hardware, IoT & Telemetria', price: 5400, weeks: 4, stack: 'ESP32 / MicroPython, MQTT Broker, Node.js, Dashboard' },
    SITE_PORTAL: { title: 'Portal Institucional de Alta Performance & Conversão', price: 2500, weeks: 2, stack: 'TailwindCSS, Vanilla JS, HTML5, CDN Cloudflare' },
    SEO_TUNING: { title: 'Consultoria de SEO Técnico, Indexação & Performance', price: 1900, weeks: 2, stack: 'Google Search Console, Schema.org, Lighthouse' },
    METEORIC: { title: 'Máquina de Lançamento Meteórico Automatizado', price: 3500, weeks: 2, stack: 'Baileys Multi-Device, Checkout Pix, Grupos VIP' }
  };

  const p = presets[cat] || presets.SOFTWARE;
  document.getElementById('propProjectTitle').value = p.title;
  document.getElementById('propInvestment').value = p.price;
  document.getElementById('propTimeline').value = p.weeks;
  document.getElementById('propTechStack').value = p.stack;
}

async function saveCommercialProposal(e) {
  e.preventDefault();
  const phone = document.getElementById('propLeadPhone').value.trim();
  const name = document.getElementById('propLeadName').value.trim();
  const company = document.getElementById('propLeadCompany').value.trim();
  const title = document.getElementById('propProjectTitle').value.trim();
  const category = document.getElementById('propCategory').value;
  const scopeDesc = document.getElementById('propScopeDesc').value.trim();
  const investment = document.getElementById('propInvestment').value;
  const timeline = document.getElementById('propTimeline').value;
  const techStack = document.getElementById('propTechStack').value.trim();
  const paymentTerms = document.getElementById('propPaymentTerms').value.trim();
  const rawDeliverables = document.getElementById('propDeliverablesText').value.trim();

  const deliverables = [];
  if (rawDeliverables) {
    rawDeliverables.split('\n').forEach(line => {
      if (line.includes('|')) {
        const [t, d] = line.split('|');
        deliverables.push({ title: t.trim(), desc: d.trim() });
      } else if (line.trim()) {
        deliverables.push({ title: line.trim(), desc: 'Entregável homologado com testes e documentação.' });
      }
    });
  }

  try {
    const res = await fetch('/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_phone: phone,
        lead_name: name,
        lead_company: company,
        project_title: title,
        category,
        scope_description: scopeDesc,
        investment_brl: investment,
        timeline_weeks: timeline,
        tech_stack: techStack,
        payment_terms: paymentTerms,
        deliverables: deliverables.length > 0 ? deliverables : undefined
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao salvar proposta');

    showBotToast('Proposta Gerada!', 'Código ' + data.proposal.code + ' gerado com sucesso! Link: /proposta/' + data.proposal.token, 'success');
    closeCreateProposalModal();
    loadCommercialProposals();
    loadCognitiveOverview();
  } catch (err) {
    showBotToast('Erro na Proposta', err.message, 'error');
  }
}

async function sendCommercialProposalToWhatsApp(id) {
  if (!confirm('Deseja enviar a proposta comercial e o link interativo diretamente para o WhatsApp do cliente?')) return;
  try {
    const res = await fetch('/api/proposals/' + id + '/send', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao enviar');

    showBotToast('Proposta Enviada!', data.message, 'success');
    loadCommercialProposals();
  } catch (err) {
    showBotToast('Erro no Envio', err.message, 'error');
  }
}

async function deleteCommercialProposal(id) {
  if (!confirm('Deseja realmente excluir esta proposta comercial?')) return;
  try {
    const res = await fetch('/api/proposals/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao excluir');

    showBotToast('Excluída', 'Proposta removida.', 'info');
    loadCommercialProposals();
  } catch (err) {
    showBotToast('Erro', err.message, 'error');
  }
}

// ==========================================
// 4. CALCULADORA INTERATIVA DE ESCOPO & ORÇAMENTO TÉCNICO
// ==========================================

async function runLiveScopeCalculation() {
  const category = document.getElementById('calcCategory')?.value || 'SOFTWARE';
  const complexity = document.getElementById('calcComplexity')?.value || 'INTERMEDIATE';
  const slaTier = document.getElementById('calcSla')?.value || 'PROFESSIONAL';
  const rushDelivery = Boolean(document.getElementById('calcRush')?.checked);

  const addons = [];
  ['calcAddonPix', 'calcAddonPanel', 'calcAddonWpp', 'calcAddonAi', 'calcAddonRbac', 'calcAddonDocker'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.checked) addons.push(el.value);
  });

  try {
    const res = await fetch('/api/scope-calculator/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, complexity, slaTier, addons, rushDelivery })
    });
    const data = await res.json();
    if (!data.success) return;

    currentCalculatedScope = data.result;
    const r = data.result;

    const elPrice = document.getElementById('calcResultPrice');
    const elDays = document.getElementById('calcResultDays');
    const elStack = document.getElementById('calcResultStack');
    const elDeliverables = document.getElementById('calcResultDeliverables');

    if (elPrice) elPrice.innerText = r.pricingBreakdown.totalInvestmentBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (elDays) elDays.innerText = r.timeline.totalDays + ' dias úteis (' + r.timeline.timelineWeeks + ' semanas)';
    if (elStack) elStack.innerText = r.recommendedTechStack;

    if (elDeliverables) {
      elDeliverables.innerHTML = (r.deliverables || []).map(d => {
        return '<div style="background: rgba(255, 255, 255, 0.03); padding: 6px 10px; border-radius: 6px; border-left: 2px solid #38bdf8;">' +
          '<strong style="color: #fff;">' + d.title + '</strong>' +
          '<div style="color: var(--text-muted); font-size: 11px;">' + d.desc + '</div>' +
        '</div>';
      }).join('');
    }
  } catch (err) {
    console.error('Erro no cálculo ao vivo:', err);
  }
}

function convertCalculationToProposal() {
  if (!currentCalculatedScope) {
    showBotToast('Atenção', 'Execute o cálculo de escopo primeiro.', 'warning');
    return;
  }
  const r = currentCalculatedScope;
  openCreateProposalModal({
    project_title: r.categoryName + ' - Projeto Sob Medida',
    category: r.category,
    investment_brl: r.pricingBreakdown.totalInvestmentBrl,
    timeline_weeks: r.timeline.timelineWeeks,
    tech_stack: r.recommendedTechStack,
    scope_description: 'Projeto ' + r.categoryName + ' com complexidade ' + r.complexityName + ' e garantia ' + r.slaName + '.'
  });
}

// ==========================================
// CENTRAL ZAPVOICE 2025 & RECURSOS AVANÇADOS NAZUNA / SPY BOT
// ==========================================

let currentZapVoiceMessages = [];
let currentZapVoiceAudios = [];
let currentZapVoiceFunnels = [];
let currentZvSubtab = 'messages';

function switchZvSubtab(subtabName) {
  currentZvSubtab = subtabName || 'messages';
  const subtabs = ['messages', 'audios', 'funnels', 'settings'];
  const paneMap = {
    messages: 'zvSubtabMessagesPane',
    audios: 'zvSubtabAudiosPane',
    funnels: 'zvSubtabFunnelsPane',
    settings: 'zvSubtabSettingsPane'
  };
  const btnMap = {
    messages: 'btnZvTabMessages',
    audios: 'btnZvTabAudios',
    funnels: 'btnZvTabFunnels',
    settings: 'btnZvTabSettings'
  };

  subtabs.forEach(t => {
    const pane = document.getElementById(paneMap[t]);
    const btn = document.getElementById(btnMap[t]);
    const isActive = (t === currentZvSubtab);
    if (pane) {
      pane.style.display = isActive ? 'block' : 'none';
    }
    if (btn) {
      if (isActive) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline');
        btn.style.background = 'rgba(236, 72, 153, 0.15)';
        btn.style.color = '#ec4899';
        btn.style.borderColor = '#ec4899';
        btn.style.fontWeight = '600';
      } else {
        btn.classList.remove('active');
        btn.classList.add('btn-outline');
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
        btn.style.fontWeight = 'normal';
      }
    }
  });

  if (currentZvSubtab === 'messages') loadZapVoiceMessages();
  else if (currentZvSubtab === 'audios') loadZapVoiceAudios();
  else if (currentZvSubtab === 'funnels') loadZapVoiceFunnels();
  else if (currentZvSubtab === 'settings') loadZapVoiceSettings();
}
window.switchZvSubtab = switchZvSubtab;

function copyZvVar(varName) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(varName).then(() => {
      showToastNotification('Copiado: ' + varName);
    }).catch(() => {
      prompt('Copie a variável:', varName);
    });
  } else {
    prompt('Copie a variável:', varName);
  }
}
window.copyZvVar = copyZvVar;

function insertZvVarIntoContent(varName) {
  const textarea = document.getElementById('zvMsgContent');
  if (!textarea) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const text = textarea.value;
  textarea.value = text.substring(0, start) + varName + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + varName.length;
}
window.insertZvVarIntoContent = insertZvVarIntoContent;

function showToastNotification(msg) {
  const toast = document.createElement('div');
  toast.innerText = msg;
  toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #ec4899; color: #fff; padding: 10px 18px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 99999; font-size: 13px; font-weight: 600; pointer-events: none; transition: opacity 0.3s ease;';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.remove(); }, 300);
  }, 2200);
}

async function loadZapVoiceOverview() {
  try {
    const [resStats, resVerif] = await Promise.all([
      fetch('/api/zapvoice/stats').then(r => r.json()).catch(() => ({ stats: {} })),
      fetch('/api/features/verificado-global').then(r => r.json()).catch(() => ({ config: {} }))
    ]);

    const stats = resStats.stats || {};
    if (document.getElementById('zvStatMessages')) document.getElementById('zvStatMessages').innerText = stats.totalMessages || 0;
    if (document.getElementById('zvStatAudios')) document.getElementById('zvStatAudios').innerText = stats.totalAudios || 0;
    if (document.getElementById('zvStatFunnels')) document.getElementById('zvStatFunnels').innerText = stats.totalFunnels || 0;
    if (document.getElementById('zvStatCampaigns')) document.getElementById('zvStatCampaigns').innerText = stats.totalCampaigns || 0;

    const verif = resVerif.config || {};
    const badgeEl = document.getElementById('verificadoGlobalBadgeStatus');
    if (badgeEl) {
      badgeEl.innerText = verif.enabled ? 'Ativado' : 'Desativado';
      badgeEl.className = 'badge ' + (verif.enabled ? 'badge-success' : 'badge-secondary');
    }

    if (currentZvSubtab === 'messages') await loadZapVoiceMessages();
    else if (currentZvSubtab === 'audios') await loadZapVoiceAudios();
    else if (currentZvSubtab === 'funnels') await loadZapVoiceFunnels();
    else if (currentZvSubtab === 'settings') await loadZapVoiceSettings();
  } catch (err) {
    console.error('Erro ao carregar ZapVoice overview:', err);
  }
}
window.loadZapVoiceOverview = loadZapVoiceOverview;

// 1. Mensagens Rápidas
async function loadZapVoiceMessages() {
  try {
    const res = await fetch('/api/zapvoice/messages').then(r => r.json());
    currentZapVoiceMessages = res.messages || [];
    renderZapVoiceMessagesTable();
  } catch (err) {
    console.error('Erro ao carregar mensagens ZapVoice:', err);
  }
}
window.loadZapVoiceMessages = loadZapVoiceMessages;

function renderZapVoiceMessagesTable() {
  const tbody = document.getElementById('zvMessagesTableBody');
  if (!tbody) return;
  const search = (document.getElementById('zvSearchMessages')?.value || '').toLowerCase().trim();

  const filtered = currentZapVoiceMessages.filter(m => {
    if (!search) return true;
    return (m.title && m.title.toLowerCase().includes(search)) ||
           (m.shortcut && m.shortcut.toLowerCase().includes(search)) ||
           (m.content && m.content.toLowerCase().includes(search)) ||
           (m.category && m.category.toLowerCase().includes(search));
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding: 24px;">Nenhuma mensagem rápida cadastrada. Clique em "+ Nova Mensagem" para cadastrar.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(m => {
    const preview = (m.content || '').length > 65 ? (m.content.substring(0, 65) + '...') : (m.content || '');
    return `
      <tr>
        <td><span style="color:#64748b; font-size:12px;">#${m.id}</span></td>
        <td><span class="badge" style="background: rgba(236,72,153,0.15); color: #ec4899; font-weight:700;">${m.shortcut || '-'}</span></td>
        <td><b>${escapeHtml(m.title || 'Sem título')}</b></td>
        <td><span style="font-size:13px; color:#cbd5e1;">${escapeHtml(preview)}</span></td>
        <td><span class="badge badge-secondary">${escapeHtml(m.category || 'Geral')}</span></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-xs btn-outline" onclick="openZvTestModal(\'message\', ${m.id})" title="Disparar teste via WhatsApp" style="margin-right:4px;"><i class="fa-solid fa-paper-plane" style="color:#10b981;"></i></button>
          <button class="btn btn-xs btn-outline" onclick="editZapVoiceMessage(${m.id})" title="Editar" style="margin-right:4px;"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-xs btn-danger" onclick="deleteZapVoiceMessage(${m.id})" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}
window.renderZapVoiceMessagesTable = renderZapVoiceMessagesTable;

function openNewZvMessageModal() {
  const form = document.getElementById('formZvMessage');
  if (form) form.reset();
  const idEl = document.getElementById('zvMsgId');
  if (idEl) idEl.value = '';
  const titleEl = document.getElementById('modalZvMsgTitleText');
  if (titleEl) titleEl.innerText = 'Nova Mensagem Rápida ZapVoice';
  openModal('modalZvMessage');
}
window.openNewZvMessageModal = openNewZvMessageModal;

function editZapVoiceMessage(id) {
  const msg = currentZapVoiceMessages.find(m => m.id === id);
  if (!msg) return;
  document.getElementById('zvMsgId').value = msg.id;
  document.getElementById('zvMsgTitle').value = msg.title || '';
  document.getElementById('zvMsgShortcut').value = msg.shortcut || '';
  document.getElementById('zvMsgCategory').value = msg.category || 'Vendas';
  document.getElementById('zvMsgKeywords').value = (msg.trigger_keywords && Array.isArray(msg.trigger_keywords)) ? msg.trigger_keywords.join(', ') : (msg.trigger_keywords || '');
  document.getElementById('zvMsgContent').value = msg.content || '';
  document.getElementById('modalZvMsgTitleText').innerText = 'Editar Mensagem: ' + (msg.title || msg.shortcut);
  openModal('modalZvMessage');
}
window.editZapVoiceMessage = editZapVoiceMessage;

async function saveZapVoiceMessageForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  const idVal = document.getElementById('zvMsgId').value;
  const kwRaw = document.getElementById('zvMsgKeywords').value;
  const keywords = kwRaw ? kwRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

  let shortcut = document.getElementById('zvMsgShortcut').value.trim();
  if (shortcut && !shortcut.startsWith('/')) shortcut = '/' + shortcut;

  const payload = {
    title: document.getElementById('zvMsgTitle').value.trim(),
    shortcut,
    category: document.getElementById('zvMsgCategory').value.trim() || 'Vendas',
    content: document.getElementById('zvMsgContent').value,
    trigger_keywords: keywords
  };
  if (idVal) payload.id = Number(idVal);

  try {
    const res = await fetch('/api/zapvoice/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success) {
      closeModal('modalZvMessage');
      showToastNotification('Mensagem rápida salva com sucesso!');
      await loadZapVoiceMessages();
      loadZapVoiceOverview();
    } else {
      alert('Erro ao salvar mensagem: ' + (res.error || 'Erro desconhecido'));
    }
  } catch (err) {
    alert('Falha na requisição: ' + err.message);
  }
}
window.saveZapVoiceMessageForm = saveZapVoiceMessageForm;

async function deleteZapVoiceMessage(id) {
  if (!confirm('Deseja realmente excluir esta mensagem rápida?')) return;
  try {
    const res = await fetch('/api/zapvoice/messages/' + id, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToastNotification('Mensagem rápida excluída!');
      await loadZapVoiceMessages();
      loadZapVoiceOverview();
    } else {
      alert('Erro: ' + (res.error || 'Não foi possível excluir'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.deleteZapVoiceMessage = deleteZapVoiceMessage;

// 2. Áudios PTT Neurais
async function loadZapVoiceAudios() {
  try {
    const res = await fetch('/api/zapvoice/audios').then(r => r.json());
    currentZapVoiceAudios = res.audios || [];
    renderZapVoiceAudiosTable();
  } catch (err) {
    console.error('Erro ao carregar áudios ZapVoice:', err);
  }
}
window.loadZapVoiceAudios = loadZapVoiceAudios;

function renderZapVoiceAudiosTable() {
  const tbody = document.getElementById('zvAudiosTableBody');
  if (!tbody) return;

  if (currentZapVoiceAudios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding: 24px;">Nenhum áudio PTT gerado. Clique em "Sintetizar / Adicionar Áudio" para criar o primeiro.</td></tr>';
    return;
  }

  tbody.innerHTML = currentZapVoiceAudios.map(a => {
    return `
      <tr>
        <td><span style="color:#64748b; font-size:12px;">#${a.id}</span></td>
        <td><span class="badge" style="background: rgba(6,182,212,0.15); color: #06b6d4; font-weight:700;">${a.shortcut || '-'}</span></td>
        <td>
          <b>${escapeHtml(a.title || 'Áudio PTT')}</b>
          <div style="font-size:11px; color:#10b981; margin-top:2px;"><i class="fa-solid fa-waveform-lines"></i> PTT Gravado na Hora (WhatsApp Waveform)</div>
        </td>
        <td><span class="badge badge-secondary">${a.duration_seconds || 5}s</span></td>
        <td>
          <audio controls preload="none" src="/api/zapvoice/audios/${a.id}/stream" style="height: 32px; width: 100%; max-width: 240px;"></audio>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-xs btn-outline" onclick="openZvTestModal(\'audio\', ${a.id})" title="Enviar teste no WhatsApp" style="margin-right:4px;"><i class="fa-solid fa-paper-plane" style="color:#10b981;"></i></button>
          <button class="btn btn-xs btn-danger" onclick="deleteZapVoiceAudio(${a.id})" title="Excluir áudio"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}
window.renderZapVoiceAudiosTable = renderZapVoiceAudiosTable;

function openNewZvAudioModal() {
  const form = document.getElementById('formZvAudio');
  if (form) form.reset();
  openModal('modalZvAudio');
}
window.openNewZvAudioModal = openNewZvAudioModal;

async function synthesizeZapVoiceAudio(e) {
  if (e && e.preventDefault) e.preventDefault();
  const btn = document.getElementById('btnSubmitZvAudio');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sintetizando com Voz Neural...';
  }

  const payload = {
    title: document.getElementById('zvAudioTitle').value.trim(),
    shortcut: document.getElementById('zvAudioShortcut').value.trim(),
    voice: document.getElementById('zvAudioVoice').value,
    text: document.getElementById('zvAudioText').value.trim()
  };

  try {
    const res = await fetch('/api/zapvoice/audios/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success) {
      closeModal('modalZvAudio');
      showToastNotification('Áudio PTT sintetizado e pronto para envio!');
      await loadZapVoiceAudios();
      loadZapVoiceOverview();
    } else {
      alert('Erro ao sintetizar áudio: ' + (res.error || 'Erro desconhecido'));
    }
  } catch (err) {
    alert('Falha na requisição de síntese: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}
window.synthesizeZapVoiceAudio = synthesizeZapVoiceAudio;

async function deleteZapVoiceAudio(id) {
  if (!confirm('Deseja realmente excluir este áudio PTT?')) return;
  try {
    const res = await fetch('/api/zapvoice/audios/' + id, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToastNotification('Áudio excluído com sucesso!');
      await loadZapVoiceAudios();
      loadZapVoiceOverview();
    } else {
      alert('Erro: ' + (res.error || 'Falha ao excluir'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.deleteZapVoiceAudio = deleteZapVoiceAudio;

// 3. Funis Sequenciais
async function loadZapVoiceFunnels() {
  try {
    const res = await fetch('/api/zapvoice/funnels').then(r => r.json());
    currentZapVoiceFunnels = res.funnels || [];
    await renderZapVoiceFunnels();
  } catch (err) {
    console.error('Erro ao carregar funis ZapVoice:', err);
  }
}
window.loadZapVoiceFunnels = loadZapVoiceFunnels;

async function renderZapVoiceFunnels() {
  const container = document.getElementById('zvFunnelsContainer');
  if (!container) return;

  if (currentZapVoiceFunnels.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding: 24px;">Nenhum funil configurado. Clique em "+ Novo Funil" para criar sua primeira automação sequencial.</div>';
    return;
  }

  const funnelsWithSteps = await Promise.all(
    currentZapVoiceFunnels.map(async (f) => {
      try {
        const stepRes = await fetch('/api/zapvoice/funnels/' + f.id + '/steps').then(r => r.json());
        return { ...f, steps: stepRes.steps || [] };
      } catch (_) {
        return { ...f, steps: [] };
      }
    })
  );

  container.innerHTML = funnelsWithSteps.map(f => {
    let triggers = [];
    if (Array.isArray(f.trigger_keywords)) triggers = f.trigger_keywords;
    else if (typeof f.trigger_keywords === 'string') {
      try { triggers = JSON.parse(f.trigger_keywords); } catch (_) { triggers = f.trigger_keywords.split(','); }
    }

    const stepsHtml = (f.steps && f.steps.length > 0)
      ? f.steps.map((st, idx) => {
          const isAudio = (st.step_type === 'audio_ptt');
          const typeIcon = isAudio ? '<i class="fa-solid fa-microphone" style="color:#06b6d4;"></i> Áudio PTT' : '<i class="fa-solid fa-comment-dots" style="color:#a855f7;"></i> Texto';
          const contentPreview = (st.content || '').length > 70 ? (st.content.substring(0, 70) + '...') : (st.content || '');
          return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; margin-bottom:6px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span class="badge badge-secondary" style="font-weight:700;">Etapa #${idx + 1}</span>
                <span style="font-size:12px; font-weight:600;">${typeIcon}</span>
                <span style="font-size:12px; color:#94a3b8;"><i class="fa-regular fa-clock"></i> Delay: ${st.delay_seconds || 3}s</span>
                <span style="font-size:13px; color:#cbd5e1; margin-left: 6px;">"${escapeHtml(contentPreview)}"</span>
              </div>
              <div>
                <button class="btn btn-xs btn-outline" onclick="deleteZvStep(${st.id})" title="Excluir etapa"><i class="fa-solid fa-trash" style="color:#ef4444;"></i></button>
              </div>
            </div>
          `;
        }).join('')
      : '<div style="color:#94a3b8; font-size:13px; padding:8px 0;">Nenhuma etapa cadastrada ainda neste funil.</div>';

    return `
      <div class="card" style="border: 1px solid rgba(168,85,247,0.25); background: rgba(30, 41, 59, 0.5);">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h3 style="font-size:16px; margin:0; color:#fff;">${escapeHtml(f.name)}</h3>
              <span class="badge ${f.is_active ? 'badge-success' : 'badge-secondary'}">${f.is_active ? 'Ativo' : 'Inativo'}</span>
            </div>
            <p style="margin:4px 0 0 0; font-size:13px; color:#94a3b8;">${escapeHtml(f.description || 'Sem descrição')}</p>
            <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              <span style="font-size:12px; color:#a855f7; font-weight:600;">Gatilhos:</span>
              ${triggers.map(t => `<span class="badge" style="background:rgba(168,85,247,0.15); color:#c084fc; font-size:11px;">${escapeHtml(String(t).trim())}</span>`).join('')}
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn btn-sm btn-outline" onclick="openZvAddStepModal(${f.id})" style="border-color:#a855f7; color:#c084fc;">
              <i class="fa-solid fa-plus"></i> Adicionar Etapa
            </button>
            <button class="btn btn-sm btn-outline" onclick="openZvTestModal(\'funnel\', ${f.id})" style="border-color:#10b981; color:#34d399;" title="Disparar teste do funil">
              <i class="fa-solid fa-play"></i> Testar Funil
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteZapVoiceFunnel(${f.id})" title="Excluir funil">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="card-body" style="padding-top:12px;">
          <h4 style="font-size:13px; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Linha do Tempo das Etapas:</h4>
          ${stepsHtml}
        </div>
      </div>
    `;
  }).join('');
}
window.renderZapVoiceFunnels = renderZapVoiceFunnels;

function openNewZvFunnelModal() {
  const form = document.getElementById('formZvFunnel');
  if (form) form.reset();
  const idEl = document.getElementById('zvFunnelId');
  if (idEl) idEl.value = '';
  openModal('modalZvFunnel');
}
window.openNewZvFunnelModal = openNewZvFunnelModal;

async function saveZapVoiceFunnelForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  const idVal = document.getElementById('zvFunnelId').value;
  const trRaw = document.getElementById('zvFunnelTriggers').value;
  const triggers = trRaw ? trRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

  const payload = {
    name: document.getElementById('zvFunnelName').value.trim(),
    description: document.getElementById('zvFunnelDescription').value.trim(),
    trigger_keywords: triggers,
    is_active: 1
  };
  if (idVal) payload.id = Number(idVal);

  try {
    const res = await fetch('/api/zapvoice/funnels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success) {
      closeModal('modalZvFunnel');
      showToastNotification('Funil salvo com sucesso!');
      await loadZapVoiceFunnels();
      loadZapVoiceOverview();
    } else {
      alert('Erro ao salvar funil: ' + (res.error || 'Erro desconhecido'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.saveZapVoiceFunnelForm = saveZapVoiceFunnelForm;

async function deleteZapVoiceFunnel(id) {
  if (!confirm('Deseja realmente excluir este funil e todas as suas etapas?')) return;
  try {
    const res = await fetch('/api/zapvoice/funnels/' + id, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToastNotification('Funil excluído com sucesso!');
      await loadZapVoiceFunnels();
      loadZapVoiceOverview();
    } else {
      alert('Erro: ' + (res.error || 'Falha ao excluir'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.deleteZapVoiceFunnel = deleteZapVoiceFunnel;

function openZvAddStepModal(funnelId) {
  document.getElementById('zvStepFunnelId').value = funnelId;
  const form = document.getElementById('formZvStep');
  if (form) form.reset();
  toggleZvStepTypeFields();
  openModal('modalZvStep');
}
window.openZvAddStepModal = openZvAddStepModal;

function toggleZvStepTypeFields() {
  const type = document.getElementById('zvStepType').value;
  const label = document.getElementById('zvStepContentLabel');
  const txt = document.getElementById('zvStepContent');
  if (type === 'audio_ptt') {
    if (label) label.innerText = 'Texto que será narrado no Áudio PTT Neural (ou atalho de áudio ex: /audio1):';
    if (txt) txt.placeholder = 'Digite o texto humanizado a ser falado pelo bot com tom consultivo ou o atalho do áudio...';
  } else {
    if (label) label.innerText = 'Conteúdo do Texto (suporta variáveis {primeiro_nome}, {valor}, etc.):';
    if (txt) txt.placeholder = 'Digite a mensagem de texto com variáveis dinâmicas...';
  }
}
window.toggleZvStepTypeFields = toggleZvStepTypeFields;

async function saveZapVoiceStepForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  const funnelId = document.getElementById('zvStepFunnelId').value;
  const type = document.getElementById('zvStepType').value;
  const delay = parseInt(document.getElementById('zvStepDelay').value, 10) || 3;
  const content = document.getElementById('zvStepContent').value.trim();

  const payload = {
    step_type: type,
    delay_seconds: delay,
    content: content
  };

  try {
    const res = await fetch('/api/zapvoice/funnels/' + funnelId + '/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (res.success) {
      closeModal('modalZvStep');
      showToastNotification('Etapa adicionada ao funil com sucesso!');
      await loadZapVoiceFunnels();
    } else {
      alert('Erro ao salvar etapa: ' + (res.error || 'Falha'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.saveZapVoiceStepForm = saveZapVoiceStepForm;

async function deleteZvStep(stepId) {
  if (!confirm('Deseja excluir esta etapa do funil?')) return;
  try {
    const res = await fetch('/api/zapvoice/funnels/steps/' + stepId, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      showToastNotification('Etapa excluída!');
      await loadZapVoiceFunnels();
    } else {
      alert('Erro: ' + (res.error || 'Falha ao excluir'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.deleteZvStep = deleteZvStep;

// 4. Modal de Teste de Disparo
function openZvTestModal(type, targetId) {
  document.getElementById('zvTestType').value = type;
  document.getElementById('zvTestTargetId').value = targetId;
  const titleEl = document.getElementById('zvTestModalTitle');
  if (titleEl) {
    if (type === 'message') titleEl.innerText = 'Disparar Teste de Mensagem Rápida';
    else if (type === 'audio') titleEl.innerText = 'Disparar Teste de Áudio PTT';
    else if (type === 'funnel') titleEl.innerText = 'Disparar Teste de Funil Sequencial';
  }
  openModal('modalZvTestSend');
}
window.openZvTestModal = openZvTestModal;

async function executeZapVoiceTestSend(e) {
  if (e && e.preventDefault) e.preventDefault();
  const type = document.getElementById('zvTestType').value;
  const targetId = document.getElementById('zvTestTargetId').value;
  const phone = document.getElementById('zvTestPhone').value.trim();
  const btn = document.getElementById('btnSubmitZvTest');

  if (!phone) {
    alert('Informe o número de telefone com DDI + DDD.');
    return;
  }

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando...';
  }

  try {
    let res;
    if (type === 'message') {
      res = await fetch('/api/zapvoice/messages/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: targetId, targetPhone: phone })
      }).then(r => r.json());
    } else if (type === 'audio') {
      res = await fetch('/api/zapvoice/audios/' + targetId + '/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPhone: phone })
      }).then(r => r.json());
    } else if (type === 'funnel') {
      const targetJid = phone.includes('@') ? phone : (phone.replace(/\D/g, '') + '@s.whatsapp.net');
      res = await fetch('/api/zapvoice/funnels/' + targetId + '/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetJid })
      }).then(r => r.json());
    }

    if (res && res.success) {
      closeModal('modalZvTestSend');
      showToastNotification('Disparo de teste executado com sucesso!');
    } else {
      alert('Resultado do envio: ' + (res?.error || res?.message || 'Verifique se o WhatsApp está conectado.'));
    }
  } catch (err) {
    alert('Falha na execução do teste: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}
window.executeZapVoiceTestSend = executeZapVoiceTestSend;

// ==========================================
// 5. ESTÚDIO DE VOZ HUMANA & CONFIGURAÇÕES ZAPVOICE
// ==========================================
const PERSONA_EDGE_MAP = {
  marcos: { voice: 'pt-BR-AntonioNeural', emotion: 'consultivo', desc: '👨‍💼 Firme & Executivo — Ideal para Advogados, Imóveis, Consórcios e Negócios B2B.' },
  lucas: { voice: 'en-US-BrianMultilingualNeural', emotion: 'entusiasmado', desc: '⚡ Jovem Vendedor Dinâmico — Energia comercial contagiante, ideal para Lanches, Pizzas e Academia.' },
  rodrigo: { voice: 'en-US-AndrewMultilingualNeural', emotion: 'acolhedor', desc: '🤝 Atendente Acolhedor & Empático — Caloroso e paciente, ideal para Marmitas, Sushi e Suporte.' },
  camila: { voice: 'pt-BR-FranciscaNeural', emotion: 'acolhedor', desc: '🌸 Atendente Acolhedora & Doce — Voz suave e humana, perfeita para Nails Design, Lashes e Beleza.' },
  juliana: { voice: 'en-US-AvaMultilingualNeural', emotion: 'consultivo', desc: '👩‍💼 Especialista Confiante & Persuasiva — Articulada e firme, excelente para Advocacia e Consultoria.' },
  thalita: { voice: 'pt-BR-ThalitaMultilingualNeural', emotion: 'entusiasmado', desc: '🚀 Jovem Espontânea & Vibrante — Conexão moderna com público de estética, academia e moda.' },
  larissa: { voice: 'en-US-EmmaMultilingualNeural', emotion: 'entusiasmado', desc: '✨ Entusiasta & Comunicativa — Expressiva e rápida, ótima para varejo e delivery.' },
  duarte: { voice: 'pt-PT-DuarteNeural', emotion: 'consultivo', desc: '🏛️ Consultor Internacional PT — Postura formal com sotaque português europeu.' },
  raquel: { voice: 'pt-PT-RaquelNeural', emotion: 'consultivo', desc: '👑 Executiva Internacional PT — Refinamento e elegância com sotaque português europeu.' }
};

function onPersonaSelectChange(personaKey) {
  const p = PERSONA_EDGE_MAP[personaKey];
  if (!p) return;
  const descEl = document.getElementById('zvPersonaDesc');
  if (descEl) descEl.textContent = p.desc;
  const voiceSelect = document.getElementById('zvCfgVoice');
  if (voiceSelect) voiceSelect.value = p.voice;
  const emotionSelect = document.getElementById('zvCfgEmotion');
  if (emotionSelect && p.emotion) emotionSelect.value = p.emotion;
}
window.onPersonaSelectChange = onPersonaSelectChange;

async function playVoicePreviewLive() {
  const btn = document.getElementById('btnZvPlayPreview');
  const player = document.getElementById('zvPreviewPlayer');
  const text = document.getElementById('zvPreviewCustomText')?.value?.trim() || 'Opa, tudo bem? Olha só, tava analisando aqui o seu caso e garanto que consigo te atender com total segurança e agilidade.';
  const persona = document.getElementById('zvCfgPersona')?.value || 'marcos';
  const emotion = document.getElementById('zvCfgEmotion')?.value || 'consultivo';
  const voice = document.getElementById('zvCfgVoice')?.value || 'pt-BR-AntonioNeural';
  const organicBreath = document.getElementById('zvCfgOrganicBreath')?.checked !== false;
  const phoneWarmth = document.getElementById('zvCfgPhoneWarmth')?.checked !== false;

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando voz...';
  }

  try {
    const res = await fetch('/api/voice/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, persona, emotion, voice, organicBreath, phoneWarmth })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || 'Falha ao sintetizar áudio');
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    if (player) {
      player.src = audioUrl;
      player.style.display = 'block';
      await player.play();
    }
  } catch (err) {
    alert('Erro ao reproduzir áudio de amostra: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}
window.playVoicePreviewLive = playVoicePreviewLive;

async function loadZapVoiceSettings() {
  try {
    const [settingsRes, voiceRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()).catch(() => ({})),
      fetch('/api/voice/settings').then(r => r.json()).catch(() => ({}))
    ]);
    const settings = settingsRes.settings || {};
    const vSettings = voiceRes.settings || {};

    const personaSelect = document.getElementById('zvCfgPersona');
    if (personaSelect && (vSettings.persona || settings.SALES_BOT_PERSONA)) {
      personaSelect.value = vSettings.persona || settings.SALES_BOT_PERSONA;
      onPersonaSelectChange(personaSelect.value);
    }
    const emotionSelect = document.getElementById('zvCfgEmotion');
    if (emotionSelect && (vSettings.emotion || settings.SALES_BOT_EMOTION)) {
      emotionSelect.value = vSettings.emotion || settings.SALES_BOT_EMOTION;
    }
    const voiceSelect = document.getElementById('zvCfgVoice');
    if (voiceSelect && (vSettings.voice || settings.ZAPVOICE_TTS_VOICE || settings.SALES_BOT_VOICE)) {
      voiceSelect.value = vSettings.voice || settings.ZAPVOICE_TTS_VOICE || settings.SALES_BOT_VOICE;
    }
    const breathCheckbox = document.getElementById('zvCfgOrganicBreath');
    if (breathCheckbox && (vSettings.organicBreath !== undefined || settings.SALES_BOT_ORGANIC_BREATH !== undefined)) {
      breathCheckbox.checked = (vSettings.organicBreath !== false && settings.SALES_BOT_ORGANIC_BREATH !== 'false');
    }
    const warmthCheckbox = document.getElementById('zvCfgPhoneWarmth');
    if (warmthCheckbox && (vSettings.phoneWarmth !== undefined || settings.SALES_BOT_PHONE_WARMTH !== undefined)) {
      warmthCheckbox.checked = (vSettings.phoneWarmth !== false && settings.SALES_BOT_PHONE_WARMTH !== 'false');
    }
    const delayInput = document.getElementById('zvCfgDefaultDelay');
    if (delayInput && settings.ZAPVOICE_DEFAULT_DELAY_SEC) {
      delayInput.value = settings.ZAPVOICE_DEFAULT_DELAY_SEC;
    }
    const simTyping = document.getElementById('zvCfgSimulateTyping');
    if (simTyping && settings.ZAPVOICE_SIMULATE_TYPING !== undefined) {
      simTyping.checked = (settings.ZAPVOICE_SIMULATE_TYPING !== 'false');
    }
  } catch (err) {
    console.error('Erro ao carregar configurações ZapVoice:', err);
  }
}
window.loadZapVoiceSettings = loadZapVoiceSettings;

async function saveZapVoiceSettings() {
  const persona = document.getElementById('zvCfgPersona')?.value || 'marcos';
  const emotion = document.getElementById('zvCfgEmotion')?.value || 'consultivo';
  const voice = document.getElementById('zvCfgVoice')?.value || 'pt-BR-AntonioNeural';
  const organicBreath = document.getElementById('zvCfgOrganicBreath')?.checked !== false;
  const phoneWarmth = document.getElementById('zvCfgPhoneWarmth')?.checked !== false;
  const defaultDelay = document.getElementById('zvCfgDefaultDelay')?.value || '3';
  const simulateTyping = document.getElementById('zvCfgSimulateTyping')?.checked !== false;

  const payload = {
    SALES_BOT_PERSONA: persona,
    SALES_BOT_EMOTION: emotion,
    SALES_BOT_VOICE: voice,
    ZAPVOICE_TTS_VOICE: voice,
    SALES_BOT_ORGANIC_BREATH: organicBreath ? 'true' : 'false',
    SALES_BOT_PHONE_WARMTH: phoneWarmth ? 'true' : 'false',
    ZAPVOICE_DEFAULT_DELAY_SEC: defaultDelay,
    ZAPVOICE_SIMULATE_TYPING: simulateTyping ? 'true' : 'false'
  };

  try {
    const [resSettings, resVoice] = await Promise.all([
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json()),
      fetch('/api/voice/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona,
          emotion,
          voice,
          organicBreath,
          phoneWarmth
        })
      }).then(r => r.json())
    ]);

    if (resSettings.success || resVoice.success) {
      const fb = document.getElementById('zvSaveFeedback');
      if (fb) {
        fb.style.display = 'inline-block';
        setTimeout(() => { fb.style.display = 'none'; }, 3500);
      }
      showToastNotification('Voz e configurações salvas com sucesso!');
    } else {
      alert('Erro ao salvar: ' + (resSettings.error || resVoice.error || 'Erro desconhecido'));
    }
  } catch (err) {
    alert('Falha: ' + err.message);
  }
}
window.saveZapVoiceSettings = saveZapVoiceSettings;

// ==========================================
// CENTRAL SOCIAL LISTENING (STEALTH EM GRUPOS) & TELEMETRIA DA VITRINE WEB
// ==========================================

// ==========================================
// CENTRAL SOCIAL LISTENING (STEALTH EM GRUPOS) & TELEMETRIA DA VITRINE WEB
// ==========================================

let currentSocialRules = [];
let currentSocialFilter = 'ALL';
let currentSlSubtab = 'rules';

function switchSlSubtab(subtabName) {
  currentSlSubtab = subtabName || 'rules';
  const subtabs = ['rules', 'heating', 'managers', 'store', 'radarLeads'];
  const paneMap = {
    rules: 'slSubtabRulesPane',
    heating: 'slSubtabHeatingPane',
    managers: 'slSubtabManagersPane',
    store: 'slSubtabStorePane',
    radarLeads: 'slSubtabRadarLeadsPane'
  };
  const btnMap = {
    rules: 'btnSlTabRules',
    heating: 'btnSlTabHeating',
    managers: 'btnSlTabManagers',
    store: 'btnSlTabStore',
    radarLeads: 'btnSlTabRadarLeads'
  };

  subtabs.forEach(t => {
    const pane = document.getElementById(paneMap[t]);
    const btn = document.getElementById(btnMap[t]);
    const isActive = (t === currentSlSubtab);
    if (pane) {
      pane.style.display = isActive ? 'block' : 'none';
    }
    if (btn) {
      if (isActive) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline');
      } else {
        btn.classList.remove('active');
        btn.classList.add('btn-outline');
      }
    }
  });

  // Carregamento reativo sob demanda da sub-aba
  if (currentSlSubtab === 'rules') loadSocialListening();
  else if (currentSlSubtab === 'heating') loadHeatingData();
  else if (currentSlSubtab === 'managers') loadGroupManagers();
  else if (currentSlSubtab === 'store') {
    loadCartSessions();
    loadStoreTelemetry();
  } else if (currentSlSubtab === 'radarLeads') {
    loadRadarLeads();
  }
}

function filterSocialRules(type) {
  currentSocialFilter = type || 'ALL';
  ['btnFilterRuleAll', 'btnFilterRuleReply', 'btnFilterRuleAlert'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });

  if (type === 'REPLY') {
    const b = document.getElementById('btnFilterRuleReply');
    if (b) b.classList.add('active');
  } else if (type === 'ALERT') {
    const b = document.getElementById('btnFilterRuleAlert');
    if (b) b.classList.add('active');
  } else {
    const b = document.getElementById('btnFilterRuleAll');
    if (b) b.classList.add('active');
  }

  renderSocialRulesTable();
}

function renderSocialRulesTable() {
  const table = document.getElementById('socialListeningRulesTable');
  if (!table) return;

  let rules = currentSocialRules;
  if (currentSocialFilter === 'REPLY') {
    rules = rules.filter(r => r.action_type !== 'ALERT');
  } else if (currentSocialFilter === 'ALERT') {
    rules = rules.filter(r => r.action_type === 'ALERT');
  }

  if (rules.length === 0) {
    table.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-ear-listen" style="font-size: 24px; margin-bottom: 8px; opacity: 0.5;"></i><br>Nenhuma regra cadastrada para este filtro.</td></tr>';
    return;
  }

  table.innerHTML = rules.map(r => {
    const isAlert = r.action_type === 'ALERT';
    const typeBadge = isAlert
      ? '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;"><i class="fa-solid fa-bell"></i> 🚨 Sentinela</span>'
      : '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;"><i class="fa-solid fa-bag-shopping"></i> 🛍️ Afiliado</span>';
    const templates = Array.isArray(r.templates) ? r.templates : (typeof r.templates === 'string' ? JSON.parse(r.templates || '[]') : []);
    const kwBadges = (r.keywords || '').split(',').map(k => '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; margin-right: 4px; font-size: 11px;">' + k.trim() + '</span>').join('');
    const linkStr = r.affiliate_url ? '<a href="' + r.affiliate_url + '" target="_blank" style="color: #38bdf8; text-decoration: underline; font-size: 12px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> ' + r.affiliate_url.slice(0, 28) + '...</a>' : '-';

    return '<tr>' +
      '<td>' + typeBadge + '</td>' +
      '<td><strong>' + (r.product_name || 'Sem nome') + '</strong></td>' +
      '<td>' + (kwBadges || '-') + '</td>' +
      '<td>' + linkStr + '</td>' +
      '<td><small style="color: var(--text-muted);">' + templates.length + ' template(s)</small></td>' +
      '<td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700;">' + (r.triggered_count || 0) + ' envios</span></td>' +
      '<td>' + (r.active ? '<span class="badge badge-success">🟢 Ativo</span>' : '<span class="badge badge-secondary">⚪ Pausado</span>') + '</td>' +
      '<td>' +
        '<button class="btn btn-xs btn-outline" onclick="editSocialRule(' + r.id + ')" title="Editar" style="margin-right: 4px;"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn btn-xs btn-danger" onclick="deleteSocialRule(' + r.id + ')" title="Excluir"><i class="fa-solid fa-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

async function loadSocialListening() {
  try {
    const res = await fetch('/api/social-listening/rules');
    const data = await res.json();
    currentSocialRules = data.rules || [];

    renderSocialRulesTable();

    const pillRules = document.getElementById('slPillRulesCount');
    if (pillRules) pillRules.innerText = currentSocialRules.length;

    const statRules = document.getElementById('slStatRules');
    if (statRules) statRules.innerText = currentSocialRules.length;

    const totalTriggers = currentSocialRules.reduce((acc, r) => acc + (r.triggered_count || 0), 0);
    const statTriggers = document.getElementById('slStatTriggers');
    if (statTriggers) statTriggers.innerText = totalTriggers;

    const affCount = currentSocialRules.filter(r => r.action_type !== 'ALERT').length;
    const sentCount = currentSocialRules.filter(r => r.action_type === 'ALERT').length;
    const elAff = document.getElementById('slStatAffiliateCount');
    if (elAff) elAff.innerText = affCount;
    const elSent = document.getElementById('slStatSentinelCount');
    if (elSent) elSent.innerText = sentCount;
  } catch (err) {
    console.error('Erro ao carregar social listening:', err);
  }
}

// ==========================================
// AQUECIMENTO ENTRE SUB-BOTS (DIÁLOGOS EM GRUPOS)
// ==========================================

async function loadHeatingData() {
  try {
    const res = await fetch('/api/group-heating/status');
    const data = await res.json();
    if (!data || !data.success) return;

    const statusEl = document.getElementById('heatingGlobalStatus');
    if (statusEl) {
      statusEl.innerHTML = data.enabled
        ? '<span style="color: #34d399; font-weight: 700;">🟢 Ativo</span>'
        : '<span style="color: #f87171; font-weight: 700;">⚪ Pausado</span>';
    }

    const tableSummaries = document.getElementById('heatingSummariesTable');
    if (tableSummaries) {
      const summaries = data.summaries || [];
      if (summaries.length === 0) {
        tableSummaries.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-fire" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i><br>Nenhum assunto aquecido nas últimas 24h. O motor atua automaticamente quando múltiplos chips estão no mesmo grupo.</td></tr>';
      } else {
        tableSummaries.innerHTML = summaries.map(s => {
          const count = s.interaction_count || s.count || 0;
          const badgeClass = count >= 9 ? 'badge-danger' : (count >= 5 ? 'badge-warning' : 'badge-success');
          const lastTime = s.last_interaction_at ? new Date(s.last_interaction_at).toLocaleTimeString('pt-BR') : '-';
          const grpJid = s.group_jid || '';
          const topic = s.topic_key || s.topic || '';
          return '<tr>' +
            '<td><strong>' + topic + '</strong><br><small style="color: var(--text-muted); font-size: 11px;">' + grpJid + '</small></td>' +
            '<td><span class="badge ' + badgeClass + '">' + count + ' / 9 interações</span></td>' +
            '<td><small style="color: #60a5fa;">' + (s.flows_used || 'Automático') + '</small></td>' +
            '<td><small style="color: var(--text-muted);">' + lastTime + '</small></td>' +
            '<td><button class="btn btn-xs btn-outline" onclick="resetHeatingTopic(\'' + grpJid + '\', \'' + topic + '\')" title="Resetar cota de 24h"><i class="fa-solid fa-rotate-left"></i> Resetar</button></td>' +
          '</tr>';
        }).join('');
      }
    }

    const tableLogs = document.getElementById('heatingRecentLogsTable');
    if (tableLogs) {
      const logs = data.recentLogs || [];
      if (logs.length === 0) {
        tableLogs.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-comments" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i><br>Aguardando diálogos automáticos entre sub-bots...</td></tr>';
      } else {
        tableLogs.innerHTML = logs.map(l => {
          const time = l.created_at ? new Date(l.created_at).toLocaleTimeString('pt-BR') : '-';
          const linkHtml = l.link_sent ? '<a href="' + l.link_sent + '" target="_blank" style="color: #38bdf8; font-size: 11px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Link</a>' : '-';
          return '<tr>' +
            '<td><small style="color: var(--text-muted);">' + time + '</small></td>' +
            '<td><code style="font-size: 11px;">' + (l.group_jid ? l.group_jid.split('@')[0] : '-') + '</code></td>' +
            '<td><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">Chip #' + (l.instance_id || 1) + '</span></td>' +
            '<td><span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 10px;">' + (l.flow_type || 'DIÁLOGO') + '</span></td>' +
            '<td><small style="color: #fff;">' + (l.message_text || '') + '</small></td>' +
            '<td>' + linkHtml + '</td>' +
          '</tr>';
        }).join('');
      }
    }
  } catch (err) {
    console.error('Erro ao carregar dados de aquecimento:', err);
  }
}

async function toggleHeatingGlobal() {
  try {
    const res = await fetch('/api/group-heating/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.success) {
      showBotToast('Aquecimento', data.enabled ? '🟢 Motor de aquecimento ativado!' : '⚪ Motor de aquecimento pausado.', 'info');
      loadHeatingData();
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao alterar status do aquecimento.', 'error');
  }
}

async function resetHeatingTopic(groupJid, topicKey) {
  if (!confirm('Deseja zerar a cota de 24h para o tópico "' + topicKey + '" neste grupo?')) return;
  try {
    const res = await fetch('/api/group-heating/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid, topicKey })
    });
    const data = await res.json();
    if (data.success) {
      showBotToast('Sucesso', 'Cota do tópico zerada com sucesso!', 'success');
      loadHeatingData();
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao resetar cota.', 'error');
  }
}

function openSimulateHeatingModal() {
  document.getElementById('simGroupJid').value = '';
  document.getElementById('simTopic').value = '';
  document.getElementById('simLinkA').value = '';
  document.getElementById('simLinkB').value = '';
  const modal = document.getElementById('modalSimulateHeating');
  if (modal) modal.style.display = 'flex';
}

function closeSimulateHeatingModal() {
  const modal = document.getElementById('modalSimulateHeating');
  if (modal) modal.style.display = 'none';
}

async function executeSimulateHeating(e) {
  if (e) e.preventDefault();
  const groupJid = document.getElementById('simGroupJid').value.trim();
  const topic = document.getElementById('simTopic').value.trim();
  const flowType = document.getElementById('simFlowType').value || null;
  const affiliateUrl = document.getElementById('simLinkA').value.trim() || null;
  const affiliateUrlAlt = document.getElementById('simLinkB').value.trim() || null;

  if (!groupJid || !topic) {
    showBotToast('Atenção', 'Informe o JID do grupo e o assunto.', 'warning');
    return;
  }

  try {
    showBotToast('Simulação', 'Disparando diálogo entre sub-bots no grupo...', 'info');
    const res = await fetch('/api/group-heating/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid, topic, flowType, affiliateUrl, affiliateUrlAlt })
    });
    const data = await res.json();
    if (data.success) {
      closeSimulateHeatingModal();
      showBotToast('Sucesso', 'Diálogo de aquecimento iniciado com sucesso!', 'success');
      loadHeatingData();
    } else {
      showBotToast('Aviso', data.error || 'Falha ao iniciar simulação.', 'warning');
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao conectar com o servidor.', 'error');
  }
}

// ==========================================
// SUB-BOTS GERENTES DE GRUPOS (DELEGAÇÃO OFICIAL)
// ==========================================

async function loadGroupManagers() {
  try {
    const res = await fetch('/api/group-managers');
    const data = await res.json();
    const managers = data.managers || [];

    const pill = document.getElementById('slPillManagersCount');
    if (pill) pill.innerText = managers.length;

    const stat = document.getElementById('slStatManagersCount');
    if (stat) stat.innerText = managers.length;

    const table = document.getElementById('groupManagersTable');
    if (!table) return;

    if (managers.length === 0) {
      table.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-crown" style="font-size: 24px; color: #f59e0b; opacity: 0.4; margin-bottom: 8px;"></i><br>Nenhum grupo delegado no momento. Todos os grupos operam sob a Matriz Principal.</td></tr>';
      return;
    }

    table.innerHTML = managers.map(m => {
      const isOnline = m.instance_status === 'CONNECTED';
      const statusBadge = isOnline
        ? '<span class="badge badge-success">🟢 Conectado</span>'
        : '<span class="badge badge-secondary">⚪ ' + (m.instance_status || 'Desconectado') + '</span>';
      const dateStr = m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '-';

      return '<tr>' +
        '<td><strong><code>' + (m.group_jid || '-') + '</code></strong></td>' +
        '<td><span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;"><i class="fa-solid fa-robot"></i> ' + (m.instance_name || 'Sub-Bot #' + m.instance_id) + '</span></td>' +
        '<td><small style="color: #fff;">' + (m.instance_phone ? '+' + m.instance_phone : '-') + '</small></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><small style="color: var(--text-muted);">' + (m.delegated_by || 'Dono') + '</small></td>' +
        '<td><small style="color: var(--text-muted);">' + dateStr + '</small></td>' +
        '<td><button class="btn btn-xs btn-danger" onclick="removeGroupManager(\'' + m.group_jid + '\')" title="Revogar gerência"><i class="fa-solid fa-user-xmark"></i> Revogar</button></td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar gerentes de grupos:', err);
  }
}

async function openDelegateManagerModal() {
  document.getElementById('dlgGroupJid').value = '';
  const select = document.getElementById('dlgSubBotSelect');
  if (select) {
    select.innerHTML = '<option value="">Carregando chips do exército...</option>';
    try {
      const res = await fetch('/api/subbot/list');
      const data = await res.json();
      const subbots = data.subbots || [];
      if (subbots.length === 0) {
        select.innerHTML = '<option value="">Nenhum sub-bot cadastrado. Crie um no Exército.</option>';
      } else {
        select.innerHTML = '<option value="">Selecione o Sub-Bot Gerente...</option>' +
          subbots.map(b => '<option value="' + b.id + '">#' + b.id + ' - ' + b.name + ' (' + (b.phone ? '+' + b.phone : 'Sem número') + ')</option>').join('');
      }
    } catch (_) {
      select.innerHTML = '<option value="">Erro ao carregar chips.</option>';
    }
  }

  const modal = document.getElementById('modalDelegateManager');
  if (modal) modal.style.display = 'flex';
}

function closeDelegateManagerModal() {
  const modal = document.getElementById('modalDelegateManager');
  if (modal) modal.style.display = 'none';
}

async function saveDelegateManager(e) {
  if (e) e.preventDefault();
  const groupJid = document.getElementById('dlgGroupJid').value.trim();
  const instanceId = document.getElementById('dlgSubBotSelect').value;

  if (!groupJid || !instanceId) {
    showBotToast('Atenção', 'Preencha o JID do grupo e escolha o Sub-Bot.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/group-managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid, instanceId, delegatedBy: 'Painel Web' })
    });
    const data = await res.json();
    if (data.success) {
      closeDelegateManagerModal();
      showBotToast('Sucesso', 'Sub-Bot nomeado gerente do grupo com sucesso!', 'success');
      loadGroupManagers();
    } else {
      showBotToast('Erro', data.error || 'Falha ao delegar gerente.', 'error');
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao conectar com o servidor.', 'error');
  }
}

async function removeGroupManager(groupJid) {
  if (!confirm('Deseja realmente revogar o Sub-Bot gerente deste grupo? O grupo voltará a ser atendido pelo Bot Master.')) return;
  try {
    const res = await fetch('/api/group-managers/' + encodeURIComponent(groupJid), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showBotToast('Sucesso', 'Gerência revogada com sucesso.', 'success');
      loadGroupManagers();
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao revogar gerência.', 'error');
  }
}

// ==========================================
// RADAR DE LEADS & MINERAÇÃO DE OPORTUNIDADES EM GRUPOS
// ==========================================

let currentRadarLeads = [];

async function loadRadarLeads() {
  try {
    const res = await fetch('/api/radar/leads?limit=60');
    const data = await res.json();
    currentRadarLeads = data.leads || [];

    const pill = document.getElementById('slPillRadarCount');
    if (pill) pill.innerText = currentRadarLeads.length;

    const statusEl = document.getElementById('radarAutoApproachStatus');
    if (statusEl && data.stats) {
      statusEl.innerHTML = data.stats.auto_approach
        ? '<span style="color: #34d399; font-weight: 700;">🟢 Ativada</span>'
        : '<span style="color: #f87171; font-weight: 700;">⚪ Desativada</span>';
    }

    const table = document.getElementById('radarLeadsTableBody');
    if (!table) return;

    if (currentRadarLeads.length === 0) {
      table.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-radar" style="font-size: 24px; color: #10b981; opacity: 0.4; margin-bottom: 8px;"></i><br>Nenhum lead de compra minerado nos grupos ainda. O radar está ativo monitorando conversas.</td></tr>';
      return;
    }

    table.innerHTML = currentRadarLeads.map(lead => {
      const time = lead.created_at ? new Date(lead.created_at).toLocaleTimeString('pt-BR') : '-';
      const cleanPhone = String(lead.sender_phone || lead.sender_jid || '').replace(/\D/g, '');
      const leadName = lead.sender_name || 'Lead';
      const cleanMsg = (lead.message_text || '').slice(0, 70);

      const statusBadge = (s) => {
        if (s === 'CONVERTED') return '<span class="badge badge-success">Convertido</span>';
        if (s === 'CONTACTED') return '<span class="badge badge-info">Contatado</span>';
        if (s === 'DISMISSED') return '<span class="badge badge-secondary">Descartado</span>';
        return '<span class="badge badge-warning">Pendente</span>';
      };

      const waMsg = encodeURIComponent('Olá, ' + leadName + '! Vi sua mensagem no grupo sobre ' + (lead.matched_trigger || 'nossas soluções') + '. Posso te mandar os detalhes e uma condição especial por aqui?');
      const waLink = cleanPhone ? 'https://wa.me/' + cleanPhone + '?text=' + waMsg : '#';

      return '<tr>' +
        '<td><small style="color: var(--text-muted);">' + time + '</small></td>' +
        '<td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">' + (lead.scout_type || 'Scout') + '</span></td>' +
        '<td><small style="color: #94a3b8;">' + (lead.group_name || (lead.group_jid ? lead.group_jid.split('@')[0] : 'Grupo')) + '</small></td>' +
        '<td><strong>' + leadName + '</strong><br><small style="color: var(--text-muted); font-size: 11px;">+' + cleanPhone + '</small></td>' +
        '<td><small style="color: #fbbf24;">🎯 ' + (lead.matched_trigger || '-') + '</small><br><span style="color: #cbd5e1; font-size: 11px;">"' + cleanMsg + '"</span></td>' +
        '<td><small style="color: #38bdf8;">' + (lead.recommended_product || 'PayBot Vendas') + '</small></td>' +
        '<td>' + statusBadge(lead.status) + '</td>' +
        '<td>' +
          (cleanPhone
            ? '<a href="' + waLink + '" target="_blank" class="btn btn-xs btn-outline" style="color: #25d366; border-color: #25d366; text-decoration: none; margin-right: 4px;" onclick="updateRadarLeadStatus(' + lead.id + ', \'CONTACTED\')"><i class="fa-brands fa-whatsapp"></i> Chamar PV</a>'
            : '-') +
          '<button class="btn btn-xs btn-outline" onclick="updateRadarLeadStatus(' + lead.id + ', \'CONVERTED\')" title="Marcar como Convertido"><i class="fa-solid fa-check"></i></button>' +
        '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar leads do radar:', err);
  }
}

async function toggleRadarAutoApproach() {
  try {
    const current = document.getElementById('radarAutoApproachStatus')?.innerText?.includes('Ativada');
    const res = await fetch('/api/radar/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_approach: !current })
    });
    const data = await res.json();
    if (data.success) {
      showBotToast('Radar de Leads', !current ? '🟢 Abordagem automática no PV ativada!' : '⚪ Abordagem automática desativada.', 'info');
      loadRadarLeads();
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao alterar configuração do radar.', 'error');
  }
}

async function updateRadarLeadStatus(id, newStatus) {
  try {
    const res = await fetch('/api/radar/leads/' + id + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      loadRadarLeads();
    }
  } catch (_) {}
}

// ==========================================
// IMPORTAÇÃO EM MASSA (BULK IMPORT) DE REGRAS E LINKS
// ==========================================

function openBulkImportModal() {
  const modal = document.getElementById('modalBulkImport');
  if (modal) {
    document.getElementById('bulkImportContent').value = '';
    const resEl = document.getElementById('bulkImportResult');
    if (resEl) resEl.style.display = 'none';
    modal.style.display = 'flex';
  }
}

function closeBulkImportModal() {
  const modal = document.getElementById('modalBulkImport');
  if (modal) modal.style.display = 'none';
}

function insertBulkExample() {
  const textarea = document.getElementById('bulkImportContent');
  if (textarea) {
    textarea.value =
      'Airfryer Oster | airfryer, fritadeira, oster | https://amzn.to/airfryer1 | https://shope.ee/airfryer2 | Menina, comprei essa aqui e recomendo demais: {link}\n' +
      'Robô Aspirador WAP | robo aspirador, wap, aspirador | https://amzn.to/robo1 | | Esse robo mudou minha vida, peguei nessa promo: {link}\n' +
      '[sentinela] Reclamações e Golpe | golpe, fraude, procon, processo, estelionato, policia\n' +
      'Fone Bluetooth QCY | fone bluetooth, fone sem fio, fone qcy | https://shope.ee/foneqcy | | O melhor fone custo-benefício que já usei: {link}';
  }
}

function handleBulkFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    const textarea = document.getElementById('bulkImportContent');
    if (textarea) textarea.value = content;
    showBotToast('Arquivo Carregado', 'Arquivo ' + file.name + ' lido com sucesso!', 'info');
  };
  reader.readAsText(file);
}

async function processBulkImport() {
  const content = document.getElementById('bulkImportContent').value.trim();
  if (!content) {
    showBotToast('Atenção', 'Insira ou solte um arquivo com as regras para importar.', 'warning');
    return;
  }

  const btn = document.getElementById('btnProcessBulkImport');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/social-listening/import-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    const resEl = document.getElementById('bulkImportResult');
    if (resEl) {
      resEl.style.display = 'block';
      if (data.success) {
        resEl.style.background = 'rgba(16, 185, 129, 0.15)';
        resEl.style.border = '1px solid #10b981';
        resEl.style.color = '#34d399';
        resEl.innerHTML = '<strong><i class="fa-solid fa-check"></i> Importação Concluída com Sucesso!</strong><br>' +
          '• Importadas: ' + (data.imported || 0) + ' regras<br>' +
          '• Ignoradas / Inválidas: ' + (data.skipped || 0);
        showBotToast('Sucesso', (data.imported || 0) + ' regras importadas com sucesso!', 'success');
        loadSocialListening();
      } else {
        resEl.style.background = 'rgba(239, 68, 68, 0.15)';
        resEl.style.border = '1px solid #ef4444';
        resEl.style.color = '#f87171';
        resEl.innerHTML = '<strong><i class="fa-solid fa-xmark"></i> Falha na Importação:</strong> ' + (data.error || 'Erro desconhecido');
      }
    }
  } catch (err) {
    showBotToast('Erro', 'Falha na requisição de importação.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}


async function toggleSocialListeningGlobal() {
  try {
    const res = await fetch('/api/social-listening/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.success) {
      const statusEl = document.getElementById('socialListeningGlobalStatus');
      if (statusEl) statusEl.innerText = data.enabled ? 'Ativado' : 'Pausado';
      showBotToast('Social Listening', data.enabled ? '🟢 Motor de escuta em grupos ativado!' : '🔴 Motor de escuta pausado.', 'info');
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao alterar status global do Social Listening.', 'error');
  }
}

function openNewSocialRuleModal() {
  document.getElementById('slRuleId').value = '';
  document.getElementById('slProductName').value = '';
  document.getElementById('slKeywords').value = '';
  document.getElementById('slAffiliateUrl').value = '';
  document.getElementById('slTemplates').value = 'Menina, comprei a minha por esse link aqui na promoção e chegou super rápido: {link} recomendo demais!\nSe você estiver procurando, dá uma olhada nesse link que tá com frete grátis: {link}';
  document.getElementById('slActive').checked = true;
  document.getElementById('modalSocialRuleTitle').innerHTML = '<i class="fa-solid fa-ear-listen" style="color: #f59e0b;"></i> Nova Regra de Escuta em Grupos';
  document.getElementById('modalSocialRule').style.display = 'flex';
}

function closeSocialRuleModal() {
  document.getElementById('modalSocialRule').style.display = 'none';
}

function editSocialRule(id) {
  const rule = currentSocialRules.find(r => r.id === id);
  if (!rule) return;
  document.getElementById('slRuleId').value = rule.id;
  document.getElementById('slProductName').value = rule.product_name || '';
  document.getElementById('slKeywords').value = rule.keywords || '';
  document.getElementById('slAffiliateUrl').value = rule.affiliate_url || '';
  const templates = Array.isArray(rule.templates) ? rule.templates : (typeof rule.templates === 'string' ? JSON.parse(rule.templates || '[]') : []);
  document.getElementById('slTemplates').value = templates.join('\n');
  document.getElementById('slActive').checked = !!rule.active;
  document.getElementById('modalSocialRuleTitle').innerHTML = '<i class="fa-solid fa-pen" style="color: #f59e0b;"></i> Editar Regra de Escuta #' + id;
  document.getElementById('modalSocialRule').style.display = 'flex';
}

async function saveSocialRule(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('slRuleId').value ? parseInt(document.getElementById('slRuleId').value, 10) : null;
  const productName = document.getElementById('slProductName').value.trim();
  const keywords = document.getElementById('slKeywords').value.trim();
  const affiliateUrl = document.getElementById('slAffiliateUrl').value.trim();
  const templates = document.getElementById('slTemplates').value.split('\n').map(t => t.trim()).filter(Boolean);
  const active = document.getElementById('slActive').checked;

  if (!productName || !keywords || !affiliateUrl) {
    showBotToast('Atenção', 'Preencha todos os campos obrigatórios.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/social-listening/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        product_name: productName,
        keywords,
        affiliate_url: affiliateUrl,
        templates,
        active
      })
    });
    const data = await res.json();
    if (data.success) {
      closeSocialRuleModal();
      loadSocialListening();
      showBotToast('Sucesso', 'Regra de escuta salva com sucesso!', 'success');
    } else {
      showBotToast('Erro', data.error || 'Falha ao salvar regra.', 'error');
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao conectar com o servidor.', 'error');
  }
}

async function deleteSocialRule(id) {
  if (!confirm('Deseja realmente excluir esta regra de escuta?')) return;
  try {
    const res = await fetch('/api/social-listening/rules/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadSocialListening();
      showBotToast('Sucesso', 'Regra excluída com sucesso.', 'success');
    }
  } catch (err) {
    showBotToast('Erro', 'Falha ao excluir regra.', 'error');
  }
}

async function loadStoreTelemetry() {
  try {
    const res = await fetch('/api/store/telemetry?limit=40');
    const data = await res.json();
    const events = data.events || [];
    const table = document.getElementById('storeTelemetryTable');
    if (!table) return;

    if (events.length === 0) {
      table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhum clique ou evento recente registrado na vitrine.</td></tr>';
      return;
    }

    const eventBadge = (type) => {
      if (type === 'PAGE_VIEW') return '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">Visualizou Loja</span>';
      if (type === 'PRODUCT_VIEW') return '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">Ver Detalhes</span>';
      if (type === 'ADD_TO_CART') return '<span class="badge badge-success">Adicionou Carrinho</span>';
      if (type === 'REMOVE_FROM_CART') return '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Removeu Item</span>';
      if (type === 'CHECKOUT_OPEN') return '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">Abriu Checkout</span>';
      if (type === 'CHECKOUT_SUBMIT' || type === 'ORDER_PLACED') return '<span class="badge badge-success">🎉 Pedido Criado</span>';
      if (type === 'PHONE_INPUT') return '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">Digitou Whats</span>';
      if (type === 'ABANDONED') return '<span class="badge badge-danger">Abandono</span>';
      return '<span class="badge badge-secondary">' + type + '</span>';
    };

    table.innerHTML = events.slice(0, 30).map(e => {
      const timeStr = e.created_at ? new Date(e.created_at).toLocaleTimeString('pt-BR') : '-';
      const custStr = e.phone ? ('+' + e.phone + (e.customer_name ? ' (' + e.customer_name + ')' : '')) : (e.session_id ? e.session_id.slice(0, 10) + '...' : 'Visitante');
      const prodStr = e.product_name ? ('📦 ' + e.product_name) : (e.cart_total ? 'R$ ' + Number(e.cart_total).toFixed(2) : '-');
      return '<tr>' +
        '<td><small style="color: var(--text-muted);">' + timeStr + '</small></td>' +
        '<td>' + eventBadge(e.event_type) + '</td>' +
        '<td><small style="color: #fff; font-weight: 600;">' + custStr + '</small></td>' +
        '<td><small style="color: #94a3b8;">' + prodStr + '</small></td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar telemetria:', err);
  }
}

async function loadCartSessions() {
  try {
    const [resAll, resAban] = await Promise.all([
      fetch('/api/store/cart-sessions?limit=30').then(r => r.json()).catch(() => ({ sessions: [] })),
      fetch('/api/store/cart-sessions/abandoned?minutes=10').then(r => r.json()).catch(() => ({ sessions: [] }))
    ]);

    const sessions = resAll.sessions || [];
    const abandoned = resAban.sessions || [];

    const statSessions = document.getElementById('slStatSessions');
    if (statSessions) statSessions.innerText = sessions.length;

    const statAbandoned = document.getElementById('slStatAbandoned');
    if (statAbandoned) statAbandoned.innerText = abandoned.length;

    const table = document.getElementById('storeCartSessionsTable');
    if (!table) return;

    if (sessions.length === 0) {
      table.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhum carrinho ativo no momento.</td></tr>';
      return;
    }

    table.innerHTML = sessions.slice(0, 25).map(s => {
      const isAban = s.status === 'ABANDONED';
      const isDone = s.status === 'ORDER_PLACED';
      const statusBadge = isDone
        ? '<span class="badge badge-success">Concluído</span>'
        : (isAban ? '<span class="badge badge-danger">Abandonado</span>' : '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">No Carrinho</span>');

      const recoveryBtn = s.phone
        ? '<button class="btn btn-xs btn-outline" style="color: #25d366; border-color: #25d366;" onclick="recoverAbandonedCart(\'' + s.phone + '\', \'' + (s.customer_name || 'Cliente') + '\', ' + Number(s.cart_total || 0).toFixed(2) + ')" title="Recuperar via WhatsApp"><i class="fa-brands fa-whatsapp"></i> Recuperar</button>'
        : '<small style="color: var(--text-muted);">Sem Whats</small>';

      return '<tr>' +
        '<td><strong>' + (s.customer_name || 'Visitante') + '</strong><br><small style="color: var(--text-muted); font-size: 10px;">' + (s.session_id ? s.session_id.slice(0, 12) + '...' : '-') + '</small></td>' +
        '<td>' + (s.phone ? '+' + s.phone : '<span style="color: var(--text-muted); font-size: 11px;">Não preencheu</span>') + '</td>' +
        '<td><strong style="color: #fff;">R$ ' + Number(s.cart_total || 0).toFixed(2) + '</strong></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + recoveryBtn + '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar sessões de carrinho:', err);
  }
}

function recoverAbandonedCart(phone, name, total) {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const msg = 'Olá, ' + name + '! Vi que você separou alguns itens na nossa loja (Total: R$ ' + total + '), mas ainda não concluiu seu pedido. Posso te ajudar com alguma dúvida ou liberar um cupom especial de 10% de desconto para fechar agora?';
  const url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msg);
  window.open(url, '_blank');
}

// ==========================================
// GESTÃO DE ALUGUÉIS & RECURSOS NAZUNA (FRONTEND)
// ==========================================
let currentRentalsGlobalMode = false;

async function loadRentalsOverview() {
  try {
    const res = await fetch('/api/rentals/overview');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.success) return;

    currentRentalsGlobalMode = !!data.globalMode;

    const btnToggle = document.getElementById('btnToggleRentalGlobal');
    if (btnToggle) {
      btnToggle.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Modo Global: ${data.globalMode ? '<span style="color:#10b981;font-weight:bold;">ATIVO</span>' : '<span style="color:#ef4444;font-weight:bold;">DESATIVADO</span>'}`;
    }

    if (data.stats) {
      const elTotal = document.getElementById('rentalsStatTotalGroups');
      if (elTotal) elTotal.innerText = data.stats.totalGroups || 0;
      const elActive = document.getElementById('rentalsStatActiveGroups');
      if (elActive) elActive.innerText = data.stats.activeGroups || 0;
      const elUnused = document.getElementById('rentalsStatUnusedCodes');
      if (elUnused) elUnused.innerText = data.stats.unusedCodes || 0;
      const elCmds = document.getElementById('rentalsStatTotalCmds');
      if (elCmds) elCmds.innerText = data.stats.totalCommands || 0;
    }

    const badgeActive = document.getElementById('badgeActiveRentalsCount');
    if (badgeActive) badgeActive.innerText = `${(data.rentals || []).length} grupos`;

    const tableGroups = document.getElementById('tableGroupRentalsBody');
    if (tableGroups) {
      if (!data.rentals || data.rentals.length === 0) {
        tableGroups.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 20px;">Nenhum grupo cadastrado.</td></tr>';
      } else {
        tableGroups.innerHTML = data.rentals.map(r => {
          const isPerm = !!r.is_permanent;
          const isAct = !!r.active;
          const expText = isPerm ? 'Vitalício / Permanente' : (r.expires_at ? new Date(r.expires_at).toLocaleDateString('pt-BR') : '-');
          const badge = isAct
            ? '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">Ativo</span>'
            : '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;">Expirado</span>';

          return `<tr>
            <td><strong>${r.group_name || 'Grupo'}</strong><br><small style="color: #64748b; font-family: monospace;">${r.group_jid}</small></td>
            <td>${badge}<br><small style="color: #94a3b8;">${expText}</small></td>
            <td>${r.payer_name || 'Admin'}</td>
            <td style="text-align: right;">
              <button class="btn btn-xs btn-outline" style="color: #ef4444; border-color: #ef4444;" onclick="deleteRentalGroup('${r.group_jid}')"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    const badgeCodes = document.getElementById('badgeRentalCodesCount');
    if (badgeCodes) badgeCodes.innerText = `${(data.codes || []).length} chaves`;

    const tableCodes = document.getElementById('tableRentalCodesBody');
    if (tableCodes) {
      if (!data.codes || data.codes.length === 0) {
        tableCodes.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">Nenhum código gerado ainda.</td></tr>';
      } else {
        tableCodes.innerHTML = data.codes.slice(0, 30).map(c => {
          const isUsed = !!c.used_at;
          const statusBadge = isUsed
            ? '<span class="badge" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8;">Usado</span>'
            : '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">Disponível</span>';

          return `<tr>
            <td><code style="font-weight: bold; color: #f59e0b; font-size: 13px;">${c.code}</code></td>
            <td>${c.duration_days === 0 ? 'Vitalício' : c.duration_days + ' dias'}</td>
            <td>${statusBadge}</td>
            <td><small style="color: #64748b;">${c.used_at ? new Date(c.used_at).toLocaleDateString('pt-BR') : '-'}</small></td>
            <td style="text-align: right;">
              <button class="btn btn-xs btn-outline" onclick="copyRentalCodeText('${c.code}')"><i class="fa-solid fa-copy"></i></button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    const tableTopCmds = document.getElementById('tableTopCommandsBody');
    if (tableTopCmds && data.stats && data.stats.topCommands) {
      if (data.stats.topCommands.length === 0) {
        tableTopCmds.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 20px;">Nenhum comando registrado ainda.</td></tr>';
      } else {
        const total = data.stats.totalCommands || 1;
        tableTopCmds.innerHTML = data.stats.topCommands.slice(0, 10).map((cmd, idx) => {
          const pct = Math.round(((cmd.count || 0) / total) * 100);
          return `<tr>
            <td><span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;">#${idx + 1}</span></td>
            <td><code style="color: #38bdf8; font-weight: bold;">${cmd.command}</code></td>
            <td><strong>${cmd.count}</strong></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                  <div style="width: ${pct}%; height: 100%; background: #a855f7;"></div>
                </div>
                <small style="color: #94a3b8; font-size: 11px;">${pct}%</small>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Erro ao carregar visão geral de aluguéis:', err);
  }
}

async function toggleGlobalRentalMode() {
  try {
    const nextMode = !currentRentalsGlobalMode;
    const res = await fetch('/api/rentals/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: nextMode })
    });
    const data = await res.json();
    if (data.success) {
      showToast(nextMode ? 'Modo Aluguel Global ATIVADO com sucesso!' : 'Modo Aluguel Global DESATIVADO!');
      loadRentalsOverview();
    }
  } catch (err) {
    showToast('Erro ao alternar modo global: ' + err.message, 'error');
  }
}

async function openGenerateRentalCodeModal() {
  const days = prompt('Informe a duração do aluguel em dias (ex: 30, ou 0 para Vitalício/Permanente):', '30');
  if (days === null) return;
  const numDays = parseInt(days, 10);
  if (isNaN(numDays) || numDays < 0) {
    alert('Por favor, informe um número de dias válido.');
    return;
  }

  try {
    const res = await fetch('/api/rentals/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationDays: numDays })
    });
    const data = await res.json();
    if (data.success && data.code) {
      prompt('Código de Ativação gerado com sucesso! Copie a chave abaixo:', data.code);
      loadRentalsOverview();
    } else {
      showToast(data.error || 'Erro ao gerar código', 'error');
    }
  } catch (err) {
    showToast('Erro ao comunicar com o servidor: ' + err.message, 'error');
  }
}

function copyRentalCodeText(code) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code);
    showToast('Código ' + code + ' copiado para a área de transferência!');
  }
}

async function deleteRentalGroup(groupJid) {
  if (!confirm('Deseja realmente revogar o aluguel do grupo ' + groupJid + '?')) return;
  try {
    const res = await fetch('/api/rentals/groups/' + encodeURIComponent(groupJid), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Aluguel do grupo revogado.');
      loadRentalsOverview();
    }
  } catch (err) {
    showToast('Erro ao revogar aluguel: ' + err.message, 'error');
  }
}

async function saveGroupProtectionWeb() {
  const groupJid = document.getElementById('protectionGroupJid')?.value.trim();
  if (!groupJid) {
    alert('Por favor, informe o JID do Grupo (@g.us).');
    return;
  }
  const antiFlood = parseInt(document.getElementById('protectionAntiFloodInterval')?.value, 10) || 3;
  const antiTrava = document.getElementById('protectionAntiTravaSelect')?.value === '1';
  const welcome = document.getElementById('protectionWelcomeText')?.value || '';
  const goodbye = document.getElementById('protectionGoodbyeText')?.value || '';

  try {
    const res = await fetch('/api/groups/' + encodeURIComponent(groupJid) + '/protection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anti_flood_interval: antiFlood,
        anti_trava: antiTrava ? 1 : 0,
        welcome_message: welcome,
        goodbye_message: goodbye
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configurações de proteção salvas com sucesso para o grupo!');
    } else {
      showToast(data.error || 'Erro ao salvar proteção', 'error');
    }
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
  }
}

function loadFreeSlotsForDate(dateStr) {
  const timeSelect = document.getElementById('meetTime');
  if (!timeSelect) return;
  console.log('Data selecionada para agendamento:', dateStr);
}

// ==========================================
// FILA DE TAREFAS, AUTOMAÇÕES & EDIÇÃO DE PEDIDOS
// ==========================================
let currentTaskQueueData = null;

async function loadTaskQueue() {
  const tbody = document.getElementById('tableRecoveryTasksBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/tasks/queue');
    if (!res.ok) return;
    const data = await res.json();
    currentTaskQueueData = data;

    const badgeStatus = document.getElementById('badgeQueueStatus');
    const btnToggle = document.getElementById('btnToggleQueueGlobal');

    if (badgeStatus) {
      if (data.abandonedCartEnabled) {
        badgeStatus.innerHTML = '<i class="fa-solid fa-play"></i> Fila: Ativa';
        badgeStatus.style.background = 'rgba(16, 185, 129, 0.2)';
        badgeStatus.style.color = '#10b981';
        badgeStatus.style.borderColor = '#10b981';
      } else {
        badgeStatus.innerHTML = '<i class="fa-solid fa-pause"></i> Fila: Pausada';
        badgeStatus.style.background = 'rgba(245, 158, 11, 0.2)';
        badgeStatus.style.color = '#fbbf24';
        badgeStatus.style.borderColor = '#fbbf24';
      }
    }

    if (btnToggle) {
      btnToggle.innerHTML = data.abandonedCartEnabled
        ? '<i class="fa-solid fa-pause"></i> Pausar Fila Global'
        : '<i class="fa-solid fa-play"></i> Retomar Fila Global';
      btnToggle.style.color = data.abandonedCartEnabled ? '#fbbf24' : '#10b981';
      btnToggle.style.borderColor = data.abandonedCartEnabled ? '#f59e0b' : '#10b981';
    }

    const orders = data.pendingOrders || [];
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-check-circle" style="color: #10b981;"></i> Nenhum pedido pendente na fila no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const rec = Number(o.recovery_sent || 0);
      let statusBadge = '';
      if (rec === 0) {
        statusBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;"><i class="fa-solid fa-clock"></i> Na Fila (Auto)</span>';
      } else if (rec === 1) {
        statusBadge = '<span class="badge" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8;"><i class="fa-solid fa-check"></i> Enviado</span>';
      } else if (rec === 2) {
        statusBadge = '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;"><i class="fa-solid fa-forward"></i> Pulado / Ignorado</span>';
      } else if (rec === 3) {
        statusBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;"><i class="fa-solid fa-pause"></i> Pausado</span>';
      }

      let actionsHtml = '';
      if (rec === 0) {
        actionsHtml = `
          <button class="btn btn-xs btn-outline" onclick="skipOrderRecovery('${o.merchant_trade_no}')" title="Pular Tarefa (Não enviar)"><i class="fa-solid fa-forward"></i> Pular</button>
          <button class="btn btn-xs btn-outline" onclick="pauseOrderRecovery('${o.merchant_trade_no}')" title="Pausar Lembrete"><i class="fa-solid fa-pause"></i> Pausar</button>
          <button class="btn btn-xs btn-primary" onclick="sendOrderRecoveryNow('${o.merchant_trade_no}')" title="Disparar Lembrete Agora" style="background: #10b981; border-color: #10b981;"><i class="fa-solid fa-paper-plane"></i> Enviar</button>
        `;
      } else if (rec === 2 || rec === 3) {
        actionsHtml = `
          <button class="btn btn-xs btn-outline" onclick="resumeOrderRecovery('${o.merchant_trade_no}')" title="Reativar na Fila"><i class="fa-solid fa-play"></i> Reativar</button>
        `;
      }

      actionsHtml += `
        <button class="btn btn-xs btn-secondary" onclick="openEditOrderModal('${o.merchant_trade_no}')" title="Editar Cliente, Número ou Produto"><i class="fa-solid fa-pen-to-square"></i> Editar</button>
      `;

      const platformIcon = o.platform === 'whatsapp'
        ? '<i class="fa-brands fa-whatsapp" style="color: #25d366;"></i>'
        : '<i class="fa-brands fa-telegram" style="color: #229ed9;"></i>';

      const valorStr = o.currency === 'BRL' ? `R$ ${Number(o.amount).toFixed(2)}` : `${Number(o.amount).toFixed(2)} USDT`;

      return `<tr>
        <td><code>${o.merchant_trade_no}</code><br><small style="color: var(--text-muted);">${platformIcon} ${o.platform || 'whatsapp'}</small></td>
        <td><strong>${o.platform_user_name || 'Cliente'}</strong><br><small style="color: #38bdf8; font-family: monospace;">${o.platform_user_id ? '+' + o.platform_user_id : 'Sem número'}</small></td>
        <td><b>${o.product_name}</b><br><small style="color: #10b981; font-weight: bold;">${valorStr}</small></td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">${actionsHtml}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar fila de tarefas:', err);
  }
}

async function toggleTaskQueueGlobal() {
  try {
    const res = await fetch('/api/tasks/queue/toggle', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.enabled ? 'Fila de Lembretes Automáticos ATIVADA!' : 'Fila de Lembretes Automáticos PAUSADA!');
      loadTaskQueue();
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function skipOrderRecovery(tradeNo) {
  try {
    const res = await fetch(`/api/orders/${tradeNo}/skip`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Tarefa pulada. Nenhum lembrete será enviado para este pedido.');
      loadTaskQueue();
      loadOrders();
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function pauseOrderRecovery(tradeNo) {
  try {
    const res = await fetch(`/api/orders/${tradeNo}/pause`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Lembrete do pedido pausado.');
      loadTaskQueue();
      loadOrders();
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function resumeOrderRecovery(tradeNo) {
  try {
    const res = await fetch(`/api/orders/${tradeNo}/resume`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Lembrete do pedido reativado na fila.');
      loadTaskQueue();
      loadOrders();
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function sendOrderRecoveryNow(tradeNo) {
  if (!confirm(`Deseja disparar o lembrete de carrinho do pedido ${tradeNo} agora?`)) return;
  try {
    const res = await fetch(`/api/orders/${tradeNo}/send-recovery-now`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Lembrete enviado com sucesso!');
      loadTaskQueue();
      loadOrders();
    } else {
      showToast(data.error || 'Falha ao enviar lembrete.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function openEditOrderModal(tradeNo) {
  let order = (currentOrders || []).find(o => o.merchant_trade_no === tradeNo);
  if (!order) {
    try {
      const res = await fetch('/api/orders');
      const data = await res.json();
      currentOrders = Array.isArray(data) ? data : (data.orders || []);
      order = currentOrders.find(o => o.merchant_trade_no === tradeNo);
    } catch (_) {}
  }

  if (!order) {
    alert('Pedido não encontrado.');
    return;
  }

  document.getElementById('editOrderTradeNo').value = order.merchant_trade_no;
  document.getElementById('editOrderCustomerName').value = order.platform_user_name || '';
  document.getElementById('editOrderCustomerPhone').value = order.platform_user_id || '';
  document.getElementById('editOrderAmount').value = Number(order.amount || 0).toFixed(2);
  document.getElementById('editOrderStatus').value = order.status || 'PENDING';
  document.getElementById('editOrderRecovery').value = (order.recovery_sent !== undefined && order.recovery_sent !== null) ? order.recovery_sent : 0;

  // Popula seletor de produtos
  const prodSel = document.getElementById('editOrderProductId');
  if (prodSel) {
    let prods = currentProducts || [];
    if (prods.length === 0) {
      try {
        const pRes = await fetch('/api/products');
        const pData = await pRes.json();
        prods = Array.isArray(pData) ? pData : (pData.products || []);
        currentProducts = prods;
      } catch (_) {}
    }
    prodSel.innerHTML = prods.map(p => {
      const isSel = p.id === order.product_id ? 'selected' : '';
      return `<option value="${p.id}" ${isSel}>${p.name} (R$ ${Number(p.price_brl || p.price).toFixed(2)})</option>`;
    }).join('');
  }

  document.getElementById('modalEditOrder').classList.add('active');
}

function closeEditOrderModal() {
  document.getElementById('modalEditOrder').classList.remove('active');
}

async function saveEditedOrder(e) {
  e.preventDefault();
  const tradeNo = document.getElementById('editOrderTradeNo').value;
  const name = document.getElementById('editOrderCustomerName').value.trim();
  const phone = document.getElementById('editOrderCustomerPhone').value.trim();
  const productId = Number(document.getElementById('editOrderProductId').value);
  const amount = parseFloat(document.getElementById('editOrderAmount').value);
  const status = document.getElementById('editOrderStatus').value;
  const recoverySent = parseInt(document.getElementById('editOrderRecovery').value, 10);

  try {
    const res = await fetch(`/api/orders/${tradeNo}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform_user_name: name,
        platform_user_id: phone,
        product_id: productId,
        amount: amount,
        status: status,
        recovery_sent: recoverySent
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Dados do pedido e cliente atualizados com sucesso!');
      closeEditOrderModal();
      loadOrders();
      loadTaskQueue();
    } else {
      showToast(data.error || 'Erro ao salvar alterações.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão: ' + err.message, 'error');
  }
}

// ==========================================
// PLATAFORMA SAAS MULTI-TENANT & GESTÃO DE LICENÇAS
// ==========================================
let currentSaasTenants = [];

async function loadSaasTenants() {
  try {
    const res = await fetch('/api/saas/tenants');
    const data = await res.json();
    if (!data.success) return;

    currentSaasTenants = Array.isArray(data.tenants) ? data.tenants : [];

    // Atualiza contadores do cockpit SaaS
    const s = data.summary || {};
    const elTotal = document.getElementById('saasMetricTotal');
    const elActive = document.getElementById('saasMetricActive');
    const elExpiring = document.getElementById('saasMetricExpiring');
    const elExpired = document.getElementById('saasMetricExpired');
    const elSuspended = document.getElementById('saasMetricSuspended');

    if (elTotal) elTotal.textContent = s.total || 0;
    if (elActive) elActive.textContent = s.active || 0;
    if (elExpiring) elExpiring.textContent = s.expiring_soon || 0;
    if (elExpired) elExpired.textContent = s.expired || 0;
    if (elSuspended) elSuspended.textContent = s.suspended || 0;

    filterSaasTenants();
  } catch (err) {
    console.error('Erro ao carregar tenants SaaS:', err);
  }
}

function filterSaasTenants() {
  const query = (document.getElementById('saasSearchFilter')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('saasStatusFilter')?.value || 'all';
  const planFilter = document.getElementById('saasPlanFilter')?.value || 'all';

  let list = currentSaasTenants;

  if (statusFilter !== 'all') {
    list = list.filter(t => t.effective_status === statusFilter);
  }
  if (planFilter !== 'all') {
    list = list.filter(t => (t.plan || '').toLowerCase() === planFilter.toLowerCase());
  }
  if (query) {
    list = list.filter(t =>
      (t.name && t.name.toLowerCase().includes(query)) ||
      (t.slug && t.slug.toLowerCase().includes(query)) ||
      (t.license_key && t.license_key.toLowerCase().includes(query)) ||
      (t.owner_phone && t.owner_phone.includes(query)) ||
      (t.owner_name && t.owner_name.toLowerCase().includes(query))
    );
  }

  renderSaasTenants(list);
}

function renderSaasTenants(list) {
  const tbody = document.getElementById('saasTenantsTbody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 30px; color: var(--text-muted);">Nenhum tenant encontrado. Clique em "+ Novo Tenant / Licença" para começar.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => {
    let statusBadge = '';
    if (t.effective_status === 'ACTIVE') {
      statusBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700;">🟢 Ativo</span>';
    } else if (t.effective_status === 'EXPIRED') {
      statusBadge = '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-weight: 700;">🔴 Expirado</span>';
    } else {
      statusBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700;">⏸️ Suspenso</span>';
    }

    let validityText = '';
    if (t.is_lifetime) {
      validityText = '<span style="color: #10b981; font-weight: 700;"><i class="fa-solid fa-infinity"></i> Vitalício</span>';
    } else if (t.is_expired) {
      validityText = `<span style="color: #ef4444; font-weight: 700;"><i class="fa-solid fa-circle-exclamation"></i> Venceu em ${formatDateOnly(t.expires_at)}</span>`;
    } else if (t.days_left <= 7) {
      validityText = `<span style="color: #f59e0b; font-weight: 700;">⚠️ ${t.days_left} dias restantes</span><br><small style="color: var(--text-muted); font-size: 11px;">Até ${formatDateOnly(t.expires_at)}</small>`;
    } else {
      validityText = `<span style="color: #38bdf8; font-weight: 600;">${t.days_left} dias restantes</span><br><small style="color: var(--text-muted); font-size: 11px;">Até ${formatDateOnly(t.expires_at)}</small>`;
    }

    const planBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; text-transform: uppercase; font-weight: 700;">${t.plan || 'PRO'}</span>`;
    let hasEcom = false;
    try {
      const mods = typeof t.modules_enabled === 'string' ? JSON.parse(t.modules_enabled || '[]') : (t.modules_enabled || []);
      hasEcom = mods.includes('ecommerce_sync') || mods.includes('all');
    } catch (_) {}

    return `
      <tr>
        <td>
          <strong style="color: #fff; font-size: 14px;">${escapeHtml(t.name)}</strong>
          <br><small style="color: #94a3b8; font-family: monospace;">/${t.slug}</small>
        </td>
        <td>
          ${escapeHtml(t.owner_name || 'Sem responsável')}
          ${t.owner_phone ? `<br><a href="https://wa.me/${t.owner_phone}" target="_blank" style="color: #25d366; text-decoration: none; font-size: 12px; font-weight: 600;"><i class="fa-brands fa-whatsapp"></i> +${t.owner_phone}</a>` : ''}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <code style="background: #0f172a; padding: 4px 8px; border-radius: 6px; font-weight: 700; color: #38bdf8; font-size: 12px;">${t.license_key}</code>
            <button class="btn btn-xs btn-outline" onclick="copyText('${t.license_key}', 'Chave de licença copiada!')" title="Copiar Chave"><i class="fa-solid fa-copy"></i></button>
          </div>
        </td>
        <td>${planBadge}</td>
        <td>${validityText}</td>
        <td>
          <small style="color: var(--text-muted);">Bots: <strong>${t.total_bots || 0}/${t.max_bots}</strong></small><br>
          <small style="color: var(--text-muted);">Prods: <strong>${t.active_products || 0}/${t.max_products}</strong></small>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn btn-xs ${hasEcom ? 'btn-success' : 'btn-outline'}" onclick="toggleTenantModuleMaster(${t.id}, 'ecommerce_sync')" title="${hasEcom ? 'Módulo E-commerce Ativo (Clique para desativar)' : 'Ativar Módulo E-commerce'}" style="${hasEcom ? 'background: rgba(16, 185, 129, 0.2); color: #10b981; border-color: #10b981;' : 'color: #94a3b8;'}">
              <i class="fa-solid fa-plug"></i> ${hasEcom ? 'E-com ON' : 'E-com OFF'}
            </button>
            <button class="btn btn-xs btn-primary" onclick="openRenewTenantModal(${t.id}, '${escapeJsString(t.name)}', '${t.expires_at || ''}')" title="Renovar Período de Licença" style="background: #10b981; border-color: #10b981;">
              <i class="fa-solid fa-arrows-rotate"></i> Renovar
            </button>
            <button class="btn btn-xs btn-outline" onclick="impersonateTenant(${t.id})" title="Acessar Painel do Tenant como Administrador" style="color: #38bdf8; border-color: #38bdf8;">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Acessar
            </button>
            <button class="btn btn-xs ${t.effective_status === 'SUSPENDED' ? 'btn-success' : 'btn-warning'}" onclick="togglePauseTenant(${t.id}, '${t.effective_status}')" title="${t.effective_status === 'SUSPENDED' ? 'Reativar Licença' : 'Suspender Licença'}">
              <i class="fa-solid ${t.effective_status === 'SUSPENDED' ? 'fa-play' : 'fa-pause'}"></i>
            </button>
            <button class="btn btn-xs btn-outline" onclick="regenerateTenantKey(${t.id})" title="Gerar Nova Chave de Licença">
              <i class="fa-solid fa-key"></i>
            </button>
            <button class="btn btn-xs btn-danger" onclick="deleteTenant(${t.id}, '${escapeJsString(t.name)}')" title="Excluir Tenant">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function autoGenerateSlug(name) {
  const elSlug = document.getElementById('tenantNewSlug');
  if (!elSlug) return;
  const slug = (name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  elSlug.value = slug;
}

function openCreateTenantModal() {
  document.getElementById('formCreateTenant').reset();
  document.getElementById('modalCreateTenant').classList.add('active');
}

function closeCreateTenantModal() {
  document.getElementById('modalCreateTenant').classList.remove('active');
}

async function submitCreateTenant(e) {
  e.preventDefault();
  const name = document.getElementById('tenantNewName').value.trim();
  const slug = document.getElementById('tenantNewSlug').value.trim();
  const ownerName = document.getElementById('tenantNewOwnerName').value.trim();
  const ownerPhone = document.getElementById('tenantNewOwnerPhone').value.trim();
  const plan = document.getElementById('tenantNewPlan').value;
  const duration = document.getElementById('tenantNewDuration').value;
  const maxBots = Number(document.getElementById('tenantNewMaxBots').value);
  const maxProds = Number(document.getElementById('tenantNewMaxProds').value);
  const password = document.getElementById('tenantNewPassword').value;
  const notes = document.getElementById('tenantNewNotes').value.trim();

  const isLifetime = duration === 'lifetime';
  const durationDays = isLifetime ? 0 : Number(duration);

  try {
    const res = await fetch('/api/saas/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        owner_name: ownerName,
        owner_phone: ownerPhone,
        plan,
        is_lifetime: isLifetime ? 1 : 0,
        duration_days: durationDays,
        max_bots: maxBots,
        max_products: maxProds,
        password: password || null,
        notes: notes || null,
        niche: document.getElementById('tenantNewNiche')?.value || 'vendedores',
        interaction_tone: document.getElementById('tenantNewTone')?.value || 'consultivo',
        populate_catalog: document.getElementById('tenantNewPopulateCatalog')?.checked !== false,
        apply_onboarding: true
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Tenant "${name}" cadastrado com sucesso! Chave: ${data.tenant.license_key}`);
      closeCreateTenantModal();
      loadSaasTenants();
    } else {
      showToast(data.error || 'Erro ao criar tenant.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão: ' + err.message, 'error');
  }
}

function openRenewTenantModal(id, name, exp) {
  document.getElementById('renewTenantId').value = id;
  document.getElementById('renewTenantName').textContent = name;
  document.getElementById('formRenewTenant').reset();
  document.getElementById('modalRenewTenant').classList.add('active');
}

function closeRenewTenantModal() {
  document.getElementById('modalRenewTenant').classList.remove('active');
}

async function submitRenewTenant(e) {
  e.preventDefault();
  const id = document.getElementById('renewTenantId').value;
  const days = Number(document.getElementById('renewDays').value);
  const notes = document.getElementById('renewNotes').value.trim();

  try {
    const res = await fetch(`/api/saas/tenants/${id}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, notes })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Licença renovada com sucesso por +${days} dias!`);
      closeRenewTenantModal();
      loadSaasTenants();
    } else {
      showToast(data.error || 'Erro ao renovar licença.', 'error');
    }
  } catch (err) {
    showToast('Erro de conexão: ' + err.message, 'error');
  }
}

async function togglePauseTenant(id, currentStatus) {
  const isSuspended = currentStatus === 'SUSPENDED';
  const action = isSuspended ? 'resume' : 'pause';
  const confirmMsg = isSuspended
    ? 'Deseja reativar a licença deste tenant?'
    : 'Deseja suspender temporariamente o acesso deste tenant?';

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/saas/tenants/${id}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(isSuspended ? 'Licença reativada com sucesso!' : 'Licença suspensa com sucesso!');
      loadSaasTenants();
    } else {
      showToast(data.error || 'Erro na operação.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function regenerateTenantKey(id) {
  if (!confirm('Atenção: A chave de licença atual será invalidada imediatamente e uma nova será emitida. Deseja continuar?')) return;
  try {
    const res = await fetch(`/api/saas/tenants/${id}/regenerate-key`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Nova chave de licença gerada: ${data.license_key}`);
      loadSaasTenants();
    } else {
      showToast(data.error || 'Erro ao regenerar chave.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function impersonateTenant(id) {
  try {
    const res = await fetch(`/api/saas/tenants/${id}/impersonate`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.redirectUrl) {
      window.open(data.redirectUrl, '_blank');
    } else {
      showToast(data.error || 'Erro ao abrir painel do tenant.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

async function deleteTenant(id, name) {
  if (!confirm(`Tem certeza que deseja excluir o tenant "${name}"? Todas as sessões e configurações associadas serão removidas.`)) return;
  try {
    const res = await fetch(`/api/saas/tenants/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Tenant excluído com sucesso.');
      loadSaasTenants();
    } else {
      showToast(data.error || 'Erro ao excluir tenant.', 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

function formatDateOnly(dt) {
  if (!dt) return '-';
  try {
    const d = new Date(dt);
    return d.toLocaleDateString('pt-BR');
  } catch (_) { return dt; }
}

function escapeJsString(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

async function toggleTenantModuleMaster(tenantId, moduleKey = 'ecommerce_sync') {
  try {
    const res = await fetch(`/api/saas/tenants/${tenantId}/toggle-module`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_key: moduleKey })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Módulo ${moduleKey} ${data.enabled ? 'ATIVADO' : 'DESATIVADO'} com sucesso!`, 'success');
      loadSaasTenants();
    } else {
      showToast('Erro ao alterar módulo: ' + (data.error || 'Falha'), 'error');
    }
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}


// ==========================================
// CONTROLE DO MOTOR LIVEPIX (SAVE MODE / TURBO CONVERSÃO)
// ==========================================
function setLivepixPerfModeUI(mode) {
  const normMode = ['save', 'turbo'].includes(mode) ? mode : 'balanced';
  const saveRadio = document.getElementById('modeLivepixSave');
  const balancedRadio = document.getElementById('modeLivepixBalanced');
  const turboRadio = document.getElementById('modeLivepixTurbo');
  if (normMode === 'save' && saveRadio) saveRadio.checked = true;
  else if (normMode === 'turbo' && turboRadio) turboRadio.checked = true;
  else if (balancedRadio) balancedRadio.checked = true;
  updateLivepixPerfCardStyles(normMode);
}

function updateLivepixPerfUI(mode) {
  updateLivepixPerfCardStyles(mode);
  showToast(
    mode === 'save'
      ? '🍃 Save Mode ativado: O navegador desliga após cada Pix e roda anti-crash leve.'
      : (mode === 'turbo'
          ? '⚡ Conversão Full ativada: Pool 24/7 pré-aquecido e concorrência máxima para picos de ads!'
          : '⚙️ Modo Balanceado: Desliga após 15 minutos sem novos pedidos.'),
    'info'
  );
}

function getLivepixPerfModeUI() {
  if (document.getElementById('modeLivepixSave')?.checked) return 'save';
  if (document.getElementById('modeLivepixTurbo')?.checked) return 'turbo';
  return 'balanced';
}

function updateLivepixPerfCardStyles(mode) {
  const cardSave = document.getElementById('cardLivepixSave');
  const cardBalanced = document.getElementById('cardLivepixBalanced');
  const cardTurbo = document.getElementById('cardLivepixTurbo');
  const badge = document.getElementById('badgeLivepixPerfMode');

  if (cardSave) {
    cardSave.style.borderColor = (mode === 'save') ? '#10b981' : 'var(--border-color)';
    cardSave.style.background = (mode === 'save') ? 'rgba(16, 185, 129, 0.14)' : 'rgba(0,0,0,0.3)';
  }
  if (cardBalanced) {
    cardBalanced.style.borderColor = (mode === 'balanced') ? '#38bdf8' : 'var(--border-color)';
    cardBalanced.style.background = (mode === 'balanced') ? 'rgba(56, 189, 248, 0.14)' : 'rgba(0,0,0,0.3)';
  }
  if (cardTurbo) {
    cardTurbo.style.borderColor = (mode === 'turbo') ? '#f59e0b' : 'var(--border-color)';
    cardTurbo.style.background = (mode === 'turbo') ? 'rgba(245, 158, 11, 0.18)' : 'rgba(0,0,0,0.3)';
  }

  if (badge) {
    if (mode === 'save') {
      badge.innerText = '🍃 Save Mode (Econômico)';
      badge.style.color = '#34d399';
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.borderColor = '#10b981';
    } else if (mode === 'turbo') {
      badge.innerText = '⚡ Conversão Full (Turbo Ads)';
      badge.style.color = '#fef08a';
      badge.style.background = 'rgba(245, 158, 11, 0.25)';
      badge.style.borderColor = '#f59e0b';
    } else {
      badge.innerText = '⚙️ Modo Inteligente (Balanceado)';
      badge.style.color = '#bae6fd';
      badge.style.background = 'rgba(56, 189, 248, 0.2)';
      badge.style.borderColor = '#38bdf8';
    }
  }
}

async function shutdownLivepixBrowserNow() {
  try {
    showToast('Encerrando Chrome em background e liberando RAM...', 'info');
    const res = await fetch('/api/livepix/shutdown-browser', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Navegador encerrado! Memória RAM liberada com sucesso.', 'success');
    } else {
      showToast('Erro ao liberar RAM: ' + (data.error || 'Falha'), 'error');
    }
  } catch (err) {
    showToast('Erro ao comunicar com servidor: ' + err.message, 'error');
  }
}

async function testLivepixScraper() {
  const username = (document.getElementById('cfgLivepixUsername')?.value || 'luizaa').trim().replace(/^@/, '');
  showToast(`⚡ Disparando teste para @${username}... Aguarde cerca de 6 a 15 segundos.`, 'info');
  try {
    const t0 = Date.now();
    const res = await fetch('/api/livepix/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, amount: '5.00' })
    });
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (data.success && data.pixCode) {
      const engineName = data.engine === 'turbo' ? '⚡ Turbo Alta Velocidade' : '🛡️ Clássico (Fallback Seguro)';
      showToast(`🎉 PIX Gerado com sucesso em ${elapsed}s via ${engineName}!`, 'success');
    } else {
      showToast('Falha no teste: ' + (data.error || data.reason || 'Não foi possível extrair o Pix'), 'error');
    }
  } catch (err) {
    showToast('Erro na requisição: ' + err.message, 'error');
  }
}


// ==========================================
// CENTRAL DE DIAGNÓSTICO & VALIDAÇÃO PIX BACEN
// ==========================================
function updatePixKeyPreview(rawKey) {
  const badge = document.getElementById('pixKeyTypeBadge');
  if (!badge) return;
  const clean = String(rawKey || '').trim();
  if (!clean) {
    badge.innerHTML = '<i class="fa-solid fa-circle-info"></i> Digite sua chave Pix (telefone, CPF, CNPJ, e-mail ou aleatória).';
    badge.style.color = '#94a3b8';
    return;
  }
  if (clean.includes('@')) {
    badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: E-mail</b> (minúsculo e sem espaços)';
    badge.style.color = '#10b981';
    return;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: Chave Aleatória (EVP/UUID)</b>';
    badge.style.color = '#10b981';
    return;
  }
  const digits = clean.replace(/\D/g, '');
  if (digits.length === 14) {
    badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: CNPJ</b> (14 dígitos)';
    badge.style.color = '#10b981';
    return;
  }
  if (digits.length === 11 && !clean.startsWith('+')) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    const third = digits[2];
    if (ddd >= 11 && ddd <= 99 && third === '9') {
      badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: Telefone Celular (+55' + digits + ')</b>';
      badge.style.color = '#10b981';
      return;
    }
    badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: CPF</b> (11 dígitos)';
    badge.style.color = '#10b981';
    return;
  }
  if (digits.length >= 10) {
    badge.innerHTML = '✅ <b style="color:#10b981;">Tipo Identificado: Telefone Nacional</b> (Formato BACEN E.164)';
    badge.style.color = '#10b981';
    return;
  }
  badge.innerHTML = 'ℹ️ Digitando chave Pix...';
  badge.style.color = '#38bdf8';
}

async function runPixDiagnosticsUI() {
  const card = document.getElementById('pixDiagResultCard');
  if (card) card.style.display = 'block';
  showToast('🔍 Executando bateria de testes e conformidade EMV BACEN...', 'info');

  try {
    const res = await fetch('/api/pix/diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1.00 })
    });
    const data = await res.json();

    if (!data.success) {
      showToast('Erro no teste de Pix: ' + (data.error || 'Falha ao gerar'), 'error');
      return;
    }

    const d = data.diagnostics;
    document.getElementById('pixDiagQrImg').src = data.qrCodeBase64;
    document.getElementById('pixDiagStatus').innerText = d.isCompliant ? '100% Homologado BACEN' : 'Atenção';
    document.getElementById('pixDiagStatus').className = d.isCompliant ? 'badge badge-paid' : 'badge badge-expired';
    document.getElementById('pixDiagType').innerText = d.type + (d.poi ? ' (' + d.poi + ')' : '');
    document.getElementById('pixDiagKey').innerText = data.settings?.pixKey || 'N/A';
    document.getElementById('pixDiagMerchant').innerText = d.merchantName + ' - ' + d.merchantCity;
    document.getElementById('pixDiagCrc').innerText = d.crc16;
    document.getElementById('pixDiagCopyCode').value = data.sampleCopiaECola;

    showToast('🎉 Código Pix validado com sucesso! Compatível com 100% dos bancos.', 'success');
  } catch (err) {
    showToast('Erro na requisição: ' + err.message, 'error');
  }
}

function copyPixDiagCode() {
  const input = document.getElementById('pixDiagCopyCode');
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('📋 Código Pix Copia e Cola copiado com sucesso!', 'success');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('📋 Código Pix copiado!', 'success');
  });
}

// ==========================================
// GERENTE GERAL DA OPERAÇÃO & ÁRBITRO SUPREMO
// ==========================================

async function loadOperationsManager(forceRefresh = false) {
  try {
    const url = forceRefresh ? '/api/operations-manager/arbitrate' : '/api/operations-manager/status';
    const method = forceRefresh ? 'POST' : 'GET';
    const res = await fetch(url, { method });
    const data = await res.json();
    if (!data.success || !data.audit) return;
    const audit = data.audit;

    const score = typeof audit.globalScore === 'number' ? audit.globalScore : (audit.global_score || 0);
    const statusColor = score >= 90 ? '#10b981' : (score >= 70 ? '#38bdf8' : (score >= 50 ? '#f59e0b' : '#ef4444'));
    const statusBg = score >= 90 ? 'rgba(16, 185, 129, 0.2)' : (score >= 70 ? 'rgba(56, 189, 248, 0.2)' : (score >= 50 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)'));

    // 1. Atualizar Badge do Sidebar Nav
    const navHealthBadge = document.getElementById('navHealthBadge');
    if (navHealthBadge) {
      navHealthBadge.innerText = `${score}%`;
      navHealthBadge.style.color = statusColor;
      navHealthBadge.style.background = statusBg;
    }

    // 2. Atualizar Cockpit do Overview
    const overviewBadge = document.getElementById('overviewArbiterVerdictBadge');
    const overviewScore = document.getElementById('overviewArbiterScoreText');
    const overviewSub = document.getElementById('overviewArbiterSubtext');

    if (overviewBadge) {
      overviewBadge.style.color = statusColor;
      overviewBadge.style.background = statusBg;
      overviewBadge.style.borderColor = statusColor;
      overviewBadge.innerHTML = `<span class="env-status-pulse" style="background:${statusColor}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span> ${audit.verdictLabel || audit.verdict || 'PLENO FUNCIONAMENTO'}`;
    }

    if (overviewScore) {
      overviewScore.innerText = `${score} / 100`;
      overviewScore.style.color = statusColor;
    }

    if (overviewSub) {
      const anomCount = audit.anomaliesCount ?? audit.anomalies_count ?? 0;
      const anomText = anomCount === 0 ? 'Nenhuma anomalia detectada' : `${anomCount} anomalia(s) sob monitoramento`;
      const timeStr = audit.timestamp ? new Date(audit.timestamp).toLocaleTimeString() : 'agora';
      overviewSub.innerText = `${anomText} • Última auditoria às ${timeStr}`;
    }

    // 3. Atualizar Tab Dedicado do Árbitro
    const arbiterVerdictBadgeBig = document.getElementById('arbiterVerdictBadgeBig');
    const arbiterScoreNumber = document.getElementById('arbiterScoreNumber');
    const arbiterScoreProgressBar = document.getElementById('arbiterScoreProgressBar');
    const arbiterLastCheckText = document.getElementById('arbiterLastCheckText');
    const arbiterAnomaliesCountText = document.getElementById('arbiterAnomaliesCountText');
    const arbiterAiProviderBadge = document.getElementById('arbiterAiProviderBadge');
    const arbiterAiDiagnosisText = document.getElementById('arbiterAiDiagnosisText');

    if (arbiterVerdictBadgeBig) {
      arbiterVerdictBadgeBig.style.color = statusColor;
      arbiterVerdictBadgeBig.style.background = statusBg;
      const icon = score >= 90 ? '🟢' : (score >= 70 ? '🔵' : (score >= 50 ? '🟡' : '🔴'));
      arbiterVerdictBadgeBig.innerHTML = `${icon} ${audit.verdictLabel || audit.verdict || 'PLENO FUNCIONAMENTO'}`;
    }

    if (arbiterScoreNumber) {
      arbiterScoreNumber.innerText = `${score}%`;
      arbiterScoreNumber.style.color = statusColor;
    }

    if (arbiterScoreProgressBar) {
      arbiterScoreProgressBar.style.width = `${score}%`;
      arbiterScoreProgressBar.style.background = statusColor;
    }

    if (arbiterLastCheckText) {
      const dateObj = audit.timestamp ? new Date(audit.timestamp) : new Date();
      arbiterLastCheckText.innerText = `Última auditoria: ${dateObj.toLocaleTimeString()} (${dateObj.toLocaleDateString()})`;
    }

    if (arbiterAnomaliesCountText) {
      const anomCount = audit.anomaliesCount ?? audit.anomalies_count ?? 0;
      arbiterAnomaliesCountText.innerText = `${anomCount} anomalias detectadas`;
      arbiterAnomaliesCountText.style.color = anomCount === 0 ? '#10b981' : '#f59e0b';
    }

    if (arbiterAiProviderBadge) {
      const prov = audit.aiProvider || audit.ai_provider || 'Núcleo de Inteligência';
      const mod = audit.aiModel || audit.ai_model || '';
      arbiterAiProviderBadge.innerText = `${prov}${mod ? ' (' + mod + ')' : ''}`;
    }

    if (arbiterAiDiagnosisText) {
      const diag = audit.aiDiagnosis || audit.ai_diagnosis;
      arbiterAiDiagnosisText.innerText = diag || 'Todos os subsistemas vitais operando em estabilidade.';
    }

    // 4. Renderizar Grid dos 8 Subsistemas
    let subs = audit.subsystems;
    if (typeof subs === 'string') {
      try { subs = JSON.parse(subs); } catch (_) { subs = null; }
    }
    if (subs) {
      renderArbiterSubsystemsGrid(subs);
    }
  } catch (err) {
    console.error('Erro ao carregar status do Gerente da Operação:', err);
  }
}

function renderArbiterSubsystemsGrid(subsystems) {
  const container = document.getElementById('arbiterSubsystemsGrid');
  if (!container) return;

  const metadata = {
    whatsapp_master: { name: 'WhatsApp Matriz', icon: 'fa-brands fa-whatsapp', color: '#25d366' },
    whatsapp_subbots: { name: 'Exército de Sub-bots', icon: 'fa-solid fa-tower-broadcast', color: '#38bdf8' },
    telegram: { name: 'Bot Telegram', icon: 'fa-brands fa-telegram', color: '#0088cc' },
    gateways_financial: { name: 'Gateways Financeiros', icon: 'fa-solid fa-credit-card', color: '#10b981' },
    web_servers_tunnels: { name: 'Servidores & Túneis', icon: 'fa-solid fa-network-wired', color: '#a855f7' },
    database_storage: { name: 'Banco de Dados SQLite', icon: 'fa-solid fa-database', color: '#f59e0b' },
    ai_intelligence_core: { name: 'Núcleo de Inteligência IA', icon: 'fa-solid fa-brain', color: '#ec4899' },
    queues_and_workflows: { name: 'Filas & Workflows', icon: 'fa-solid fa-list-check', color: '#6366f1' }
  };

  const keys = Object.keys(subsystems);
  let html = '';

  for (const key of keys) {
    const sub = subsystems[key] || {};
    const meta = metadata[key] || { name: key, icon: 'fa-solid fa-microchip', color: '#94a3b8' };
    const score = typeof sub.score === 'number' ? sub.score : 0;
    const isOk = score >= 90;
    const isWarning = score >= 50 && score < 90;
    const statusColor = isOk ? '#10b981' : (isWarning ? '#f59e0b' : '#ef4444');
    const statusBg = isOk ? 'rgba(16, 185, 129, 0.15)' : (isWarning ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)');

    let detailsList = [];
    if (sub.details && typeof sub.details === 'object') {
      for (const [k, v] of Object.entries(sub.details)) {
        if (typeof v === 'boolean') {
          detailsList.push(`<span>${k}: <b>${v ? 'Sim' : 'Não'}</b></span>`);
        } else if (typeof v === 'string' || typeof v === 'number') {
          detailsList.push(`<span>${k}: <b>${v}</b></span>`);
        }
      }
    }

    const anomaliesHtml = (sub.anomalies && sub.anomalies.length > 0)
      ? `<div style="margin-top: 8px; font-size: 11px; color: #ef4444; background: rgba(239, 68, 68, 0.1); padding: 4px 8px; border-radius: 4px;">⚠️ ${escapeHtml(sub.anomalies.join(' | '))}</div>`
      : '';

    html += `
      <div class="card" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); padding: 14px; border-radius: 10px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="${meta.icon}" style="font-size: 16px; color: ${meta.color};"></i>
              <span style="font-weight: 700; font-size: 13px; color: #fff;">${meta.name}</span>
            </div>
            <span class="badge" style="background: ${statusBg}; color: ${statusColor}; font-size: 11px; font-weight: 700;">
              ${score}%
            </span>
          </div>

          <!-- Mini Barra de Saúde -->
          <div style="background: rgba(255, 255, 255, 0.08); border-radius: 4px; height: 6px; overflow: hidden; margin-bottom: 10px;">
            <div style="width: ${score}%; height: 100%; background: ${statusColor}; transition: width 0.3s ease;"></div>
          </div>

          <div style="font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 3px;">
            ${detailsList.slice(0, 3).join('')}
          </div>

          ${anomaliesHtml}
        </div>

        <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: flex-end;">
          <button class="btn btn-xs btn-outline" onclick="healSpecificSubsystem('${key}')" style="border-color: rgba(255,255,255,0.2); font-size: 11px;" title="Executar auto-cura ou re-sondagem deste núcleo">
            <i class="fa-solid fa-wrench"></i> Reparar / Testar
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

async function loadArbiterHistory() {
  try {
    const res = await fetch('/api/operations-manager/history?limit=15');
    const data = await res.json();
    if (!data.success) return;

    const countBadge = document.getElementById('badgeArbiterAuditsCount');
    if (countBadge) {
      countBadge.innerText = `${(data.history || []).length} registros`;
    }

    const tbody = document.getElementById('tableArbiterAuditsBody');
    if (!tbody) return;

    if (!data.history || data.history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 16px; color: var(--text-muted);">Nenhuma auditoria registrada ainda.</td></tr>';
      return;
    }

    let rows = '';
    for (const h of data.history) {
      const score = typeof h.global_score === 'number' ? h.global_score : (h.globalScore || 0);
      const statusColor = score >= 90 ? '#10b981' : (score >= 70 ? '#38bdf8' : (score >= 50 ? '#f59e0b' : '#ef4444'));
      const statusBg = score >= 90 ? 'rgba(16, 185, 129, 0.15)' : (score >= 70 ? 'rgba(56, 189, 248, 0.15)' : (score >= 50 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)'));
      const dateStr = h.timestamp ? (new Date(h.timestamp).toLocaleTimeString() + ' ' + new Date(h.timestamp).toLocaleDateString()) : 'N/A';

      let actionsCount = 0;
      if (h.healing_actions) {
        try {
          const act = typeof h.healing_actions === 'string' ? JSON.parse(h.healing_actions) : h.healing_actions;
          actionsCount = Array.isArray(act) ? act.length : 0;
        } catch (_) {}
      }

      const anomCount = h.anomalies_count ?? 0;

      rows += `
        <tr>
          <td style="font-size: 12px; color: var(--text-muted);">${dateStr}</td>
          <td>
            <span class="badge" style="background: ${statusBg}; color: ${statusColor}; font-weight: 700;">
              ${score}%
            </span>
          </td>
          <td style="font-weight: 600; font-size: 12px;">${escapeHtml(h.verdict || 'PLENO_FUNCIONAMENTO')}</td>
          <td>
            <span style="font-size: 12px; color: ${anomCount > 0 ? '#ef4444' : '#10b981'}; font-weight: 600;">
              ${anomCount}
            </span>
          </td>
          <td>
            <span class="badge" style="background: ${actionsCount > 0 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)'}; color: ${actionsCount > 0 ? '#f59e0b' : 'var(--text-muted)'}; font-size: 11px;">
              ${actionsCount > 0 ? actionsCount + ' ação(ões) aplicada(s)' : 'Sem intervenção'}
            </span>
          </td>
          <td style="font-size: 11px; color: var(--text-muted);">
            ${escapeHtml(h.ai_provider || 'Heurístico')}
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rows;
  } catch (err) {
    console.error('Erro ao carregar histórico do árbitro:', err);
  }
}

async function triggerManualArbitration() {
  try {
    showToast('⚖️ Executando auditoria completa com Núcleo de Inteligência...', 'info');
    const res = await fetch('/api/operations-manager/arbitrate', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.audit) {
      showToast(`✅ Auditoria concluída: Score ${data.audit.globalScore}% (${data.audit.verdictLabel})`, 'success');
      loadOperationsManager(false);
      loadArbiterHistory();
    } else {
      showToast('Erro ao arbitrar: ' + (data.error || 'Falha desconhecida'), 'error');
    }
  } catch (err) {
    showToast('Erro na requisição do árbitro: ' + err.message, 'error');
  }
}

async function triggerAutoHealNow() {
  try {
    showToast('🛠️ Acionando protocolo de autocura em todos os subsistemas...', 'info');
    const res = await fetch('/api/operations-manager/auto-heal', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const actionsCount = (data.actions || []).length;
      showToast(`🎉 Autocura concluída: ${actionsCount} ações preventivas/corretivas aplicadas!`, 'success');
      loadOperationsManager(false);
      loadArbiterHistory();
    } else {
      showToast('Erro na autocura: ' + (data.error || 'Falha desconhecida'), 'error');
    }
  } catch (err) {
    showToast('Erro na autocura: ' + err.message, 'error');
  }
}

async function healSpecificSubsystem(subsystemKey) {
  try {
    showToast(`🔧 Executando autocura/reparo do núcleo: ${subsystemKey}...`, 'info');
    const res = await fetch(`/api/operations-manager/heal/${encodeURIComponent(subsystemKey)}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Núcleo ${subsystemKey} reparado/testado com sucesso!`, 'success');
      loadOperationsManager(false);
      loadArbiterHistory();
    } else {
      showToast('Erro ao reparar: ' + (data.error || 'Falha desconhecida'), 'error');
    }
  } catch (err) {
    showToast('Erro na ação de reparo: ' + err.message, 'error');
  }
}

// Exportações para escopo global do navegador
window.loadOperationsManager = loadOperationsManager;
window.renderArbiterSubsystemsGrid = renderArbiterSubsystemsGrid;
window.loadArbiterHistory = loadArbiterHistory;
window.triggerManualArbitration = triggerManualArbitration;
window.triggerAutoHealNow = triggerAutoHealNow;
window.healSpecificSubsystem = healSpecificSubsystem;

// ==========================================
// 🧪 LAB OPERACIONAL DE CONEXÕES & COMANDOS
// ==========================================

let currentLabConnectionId = null;
let cachedLabConnections = [];
let cachedLabCatalog = [];

async function loadConnectionLab() {
  try {
    const [connRes, cmdRes] = await Promise.all([
      fetch('/api/lab/connections').then(r => r.json()).catch(() => ({ connections: [] })),
      fetch('/api/lab/commands').then(r => r.json()).catch(() => ({ catalog: [] }))
    ]);

    cachedLabConnections = connRes.connections || [];
    cachedLabCatalog = cmdRes.catalog || [];

    // Atualiza badge de conexões ativas no sidebar
    const activeCount = cachedLabConnections.filter(c => c.status === 'CONNECTED').length;
    const navBadge = document.getElementById('navLabActiveConnBadge');
    if (navBadge) {
      navBadge.innerText = activeCount > 0 ? `${activeCount} ON` : 'LAB';
      navBadge.style.background = activeCount > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(168, 85, 247, 0.2)';
      navBadge.style.color = activeCount > 0 ? '#10b981' : '#c084fc';
    }

    // Se o usuário ainda não entrou em uma conexão específica, renderiza a tela de seleção
    if (!currentLabConnectionId) {
      renderLabConnectionsGrid(cachedLabConnections);
      const selView = document.getElementById('labSelectConnectionView');
      const workView = document.getElementById('labActiveWorkspaceView');
      if (selView) selView.style.display = 'block';
      if (workView) workView.style.display = 'none';
    } else {
      // Atualiza os metadados da conexão ativa no cabeçalho
      const currentConn = cachedLabConnections.find(c => c.id === currentLabConnectionId);
      if (currentConn) {
        updateLabActiveHeader(currentConn);
      }
    }
  } catch (err) {
    console.error('Erro ao carregar Lab de Conexões:', err);
  }
}

function renderLabConnectionsGrid(connections) {
  const container = document.getElementById('labConnectionsCardsGrid');
  if (!container) return;

  if (!connections || connections.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 32px; color: #f59e0b; margin-bottom: 10px;"></i><br>
        Nenhuma conexão identificada no momento.
      </div>
    `;
    return;
  }

  let html = '';
  for (const conn of connections) {
    const isOnline = conn.status === 'CONNECTED';
    const statusBg = isOnline ? 'rgba(16, 185, 129, 0.15)' : (conn.status === 'CONNECTING' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)');
    const statusColor = isOnline ? '#10b981' : (conn.status === 'CONNECTING' ? '#38bdf8' : 'var(--text-muted)');
    const borderColor = isOnline ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.08)';

    html += `
      <div class="card" style="background: rgba(15, 23, 42, 0.7); border: 1px solid ${borderColor}; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s, border-color 0.2s;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 42px; height: 42px; border-radius: 50%; background: ${conn.color ? conn.color + '22' : 'rgba(255,255,255,0.08)'}; display: flex; align-items: center; justify-content: center; font-size: 20px; color: ${conn.color || '#fff'}; border: 1px solid ${conn.color ? conn.color + '44' : 'transparent'};">
                <i class="${conn.icon || 'fa-solid fa-robot'}"></i>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff;">${escapeHtml(conn.name)}</h4>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                  ${conn.phone ? escapeHtml(conn.phone) : 'Sem número'}
                </div>
              </div>
            </div>
            <span class="badge" style="background: ${statusBg}; color: ${statusColor}; font-weight: 700; font-size: 11px;">
              ${escapeHtml(conn.statusLabel || conn.status)}
            </span>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; font-size: 12px; color: var(--text-muted);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Função / Perfil:</span>
              <span style="font-weight: 700; color: #e2e8f0;">${escapeHtml(conn.role || 'Geral')}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Plataforma:</span>
              <span style="font-weight: 700; color: ${conn.platform === 'telegram' ? '#0088cc' : '#25d366'}; text-transform: capitalize;">${conn.platform}</span>
            </div>
          </div>
        </div>

        <button class="btn btn-primary" onclick="enterConnectionLab('${conn.id}')" style="width: 100%; background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%); border: none; font-weight: 700; font-size: 13px; padding: 10px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;">
          <i class="fa-solid fa-flask-vial"></i> Entrar no Lab Desta Conexão
        </button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function enterConnectionLab(connId) {
  currentLabConnectionId = connId;
  const conn = cachedLabConnections.find(c => c.id === connId) || {
    id: connId,
    name: 'Conexão Selecionada',
    phone: '',
    role: 'Operação',
    status: 'CONNECTED',
    platform: 'whatsapp',
    icon: 'fa-brands fa-whatsapp'
  };

  // Alterna as visualizações
  const selView = document.getElementById('labSelectConnectionView');
  const workView = document.getElementById('labActiveWorkspaceView');
  if (selView) selView.style.display = 'none';
  if (workView) workView.style.display = 'block';

  // Atualiza cabeçalho do Lab ativo
  updateLabActiveHeader(conn);

  // Popula o seletor de comandos a partir do catálogo
  populateLabCommandSelect(cachedLabCatalog);

  // Reseta a área de resultado para estado inicial limpo (sem histórico acumulado)
  resetLabResultState();

  showToast(`🧪 Entrou no Lab da conexão: ${conn.name}`, 'info');
}

function exitConnectionLab() {
  currentLabConnectionId = null;
  const selView = document.getElementById('labSelectConnectionView');
  const workView = document.getElementById('labActiveWorkspaceView');
  if (selView) selView.style.display = 'block';
  if (workView) workView.style.display = 'none';

  loadConnectionLab();
}

function updateLabActiveHeader(conn) {
  const titleEl = document.getElementById('labActiveConnName');
  const metaEl = document.getElementById('labActiveConnMeta');
  const badgeEl = document.getElementById('labActiveConnStatusBadge');
  const iconEl = document.getElementById('labActiveConnIcon');

  if (titleEl) titleEl.innerText = conn.name;
  if (metaEl) metaEl.innerText = `${conn.phone || 'Sem telefone'} • ${conn.role || 'Operação'}`;
  if (badgeEl) {
    const isOnline = conn.status === 'CONNECTED';
    badgeEl.innerText = conn.statusLabel || (isOnline ? '🟢 Conectado' : '🟡 Standby');
    badgeEl.style.background = isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)';
    badgeEl.style.color = isOnline ? '#10b981' : 'var(--text-muted)';
  }
  if (iconEl) {
    iconEl.className = conn.icon || 'fa-solid fa-robot';
  }
}

function populateLabCommandSelect(catalog) {
  const select = document.getElementById('labSelectCommand');
  if (!select) return;

  if (!catalog || catalog.length === 0) {
    select.innerHTML = '<option value="menu">!menu - Menu Principal</option>';
    return;
  }

  let html = '';
  for (const cat of catalog) {
    html += `<optgroup label="${escapeHtml(cat.category)}">`;
    for (const cmd of cat.commands) {
      html += `<option value="${escapeHtml(cmd.cmd)}" data-desc="${escapeHtml(cmd.desc)}" data-placeholder="${escapeHtml(cmd.placeholder)}" data-default="${escapeHtml(cmd.defaultInput || '')}">${escapeHtml(cmd.name)} - ${escapeHtml(cmd.title)}</option>`;
    }
    html += `</optgroup>`;
  }

  select.innerHTML = html;
  onLabCommandChanged();
}

function onLabCommandChanged() {
  const select = document.getElementById('labSelectCommand');
  const descEl = document.getElementById('labCommandDesc');
  const inputEl = document.getElementById('labCommandInput');
  const pillsEl = document.getElementById('labQuickPills');
  if (!select) return;

  const selectedOpt = select.options[select.selectedIndex];
  if (!selectedOpt) return;

  const desc = selectedOpt.getAttribute('data-desc') || '';
  const placeholder = selectedOpt.getAttribute('data-placeholder') || 'Digite os parâmetros...';
  const defaultVal = selectedOpt.getAttribute('data-default') || '';
  const cmdVal = select.value;

  if (descEl) descEl.innerText = desc;
  if (inputEl) {
    inputEl.placeholder = placeholder;
    inputEl.value = defaultVal;
  }

  // Atalhos rápidos dinâmicos de exemplo
  if (pillsEl) {
    let pills = [];
    if (cmdVal === 'pix') {
      pills = ['19.90', '49.90', '99.90', '199.00'];
    } else if (cmdVal === 'ia') {
      pills = ['Quais são os produtos?', 'Como funciona a garantia?', 'Me dê um resumo das vendas'];
    } else if (cmdVal === 'menu') {
      pills = ['vendas', 'audio', 'bot', 'admin'];
    } else if (cmdVal === 'custom') {
      pills = ['!menu', '!ping', '!dono', '!chavefree'];
    }

    if (pills.length > 0) {
      pillsEl.innerHTML = pills.map(p => `
        <span onclick="setLabInputPill('${escapeHtml(p)}')" style="font-size: 11px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; padding: 2px 8px; cursor: pointer; user-select: none;">
          ${escapeHtml(p)}
        </span>
      `).join('');
    } else {
      pillsEl.innerHTML = '';
    }
  }
}

function setLabInputPill(val) {
  const inputEl = document.getElementById('labCommandInput');
  if (inputEl) {
    inputEl.value = val;
    inputEl.focus();
  }
}

function toggleLabRecipientField() {
  const chk = document.getElementById('labSendDirectlyCheckbox');
  const container = document.getElementById('labRecipientContainer');
  if (chk && container) {
    container.style.display = chk.checked ? 'block' : 'none';
    if (chk.checked) {
      const recIn = document.getElementById('labRecipientInput');
      if (recIn) recIn.focus();
    }
  }
}

function resetLabResultState() {
  const idleEl = document.getElementById('labResultIdlePlaceholder');
  const contentEl = document.getElementById('labResultContentContainer');
  const badgeEl = document.getElementById('labResultStatusBadge');
  const copyBtn = document.getElementById('btnCopyLabResult');
  const extraPayload = document.getElementById('labResultExtraPayload');

  if (idleEl) idleEl.style.display = 'flex';
  if (contentEl) contentEl.style.display = 'none';
  if (badgeEl) {
    badgeEl.innerText = 'Aguardando comando...';
    badgeEl.style.background = 'rgba(255,255,255,0.08)';
    badgeEl.style.color = 'var(--text-muted)';
  }
  if (copyBtn) copyBtn.style.display = 'none';
  if (extraPayload) {
    extraPayload.style.display = 'none';
    extraPayload.innerHTML = '';
  }
}

async function triggerExecuteLabCommand() {
  if (!currentLabConnectionId) {
    showToast('Por favor, selecione uma conexão ativa primeiro.', 'warning');
    return;
  }

  const select = document.getElementById('labSelectCommand');
  const inputEl = document.getElementById('labCommandInput');
  const sendChk = document.getElementById('labSendDirectlyCheckbox');
  const recInput = document.getElementById('labRecipientInput');
  const btn = document.getElementById('btnExecuteLabCommand');

  const command = select ? select.value : 'menu';
  const input = inputEl ? inputEl.value : '';
  const sendDirectly = sendChk ? sendChk.checked : false;
  const targetRecipient = recInput ? recInput.value.trim() : null;

  if (sendDirectly && !targetRecipient) {
    showToast('Informe o número ou grupo de destino para envio direto.', 'warning');
    if (recInput) recInput.focus();
    return;
  }

  const origBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Executando na conexão...';
  }

  try {
    const res = await fetch('/api/lab/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: currentLabConnectionId,
        command,
        input,
        targetRecipient,
        sendDirectly
      })
    });

    const data = await res.json();

    if (!data.success) {
      showToast('Falha na execução: ' + (data.error || 'Erro desconhecido'), 'error');
      renderLabResultError(data.error || 'Falha ao processar comando');
      return;
    }

    // Renderiza O RESULTADO DIRETO da conexão (sem histórico de comandos executados)
    renderLabDirectResult(data);
    showToast(`✅ Comando ${data.command} executado com sucesso (${data.executionTimeMs}ms)!`, 'success');
  } catch (err) {
    showToast('Erro na requisição ao Lab: ' + err.message, 'error');
    renderLabResultError(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
}

function renderLabDirectResult(data) {
  const idleEl = document.getElementById('labResultIdlePlaceholder');
  const contentEl = document.getElementById('labResultContentContainer');
  const badgeEl = document.getElementById('labResultStatusBadge');
  const connPill = document.getElementById('labResultConnPill');
  const latencyPill = document.getElementById('labResultLatencyPill');
  const textEl = document.getElementById('labResultFormattedText');
  const copyBtn = document.getElementById('btnCopyLabResult');
  const extraPayload = document.getElementById('labResultExtraPayload');

  if (idleEl) idleEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'flex';

  if (badgeEl) {
    badgeEl.innerText = data.sentDirectly ? '🟢 Resposta Enviada & Retornada' : '🟢 Resposta Recebida com Sucesso';
    badgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
    badgeEl.style.color = '#10b981';
  }

  if (connPill) {
    connPill.innerText = `📡 ${data.connectionName || 'Conexão'} (${data.command})`;
  }

  if (latencyPill) {
    latencyPill.innerText = `⚡ ${data.executionTimeMs}ms`;
  }

  if (textEl) {
    textEl.innerText = data.resultText || 'Comando executado sem texto de resposta.';
  }

  if (copyBtn) copyBtn.style.display = 'inline-block';

  // Renderiza payload extra (ex: se gerou Pix Copia e Cola)
  if (extraPayload) {
    extraPayload.innerHTML = '';
    extraPayload.style.display = 'none';

    if (data.resultPayload && data.resultPayload.pixCopiaECola) {
      extraPayload.style.display = 'block';
      extraPayload.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 700; color: #10b981; font-size: 12px;">💰 Código Pix Copia e Cola Gerado:</span>
            <button class="btn btn-xs btn-primary" onclick="navigator.clipboard.writeText('${escapeHtml(data.resultPayload.pixCopiaECola)}'); showToast('Código Pix copiado!', 'success');" style="background: #10b981; border: none; font-size: 11px;">
              <i class="fa-solid fa-copy"></i> Copiar Pix
            </button>
          </div>
          <input type="text" readonly value="${escapeHtml(data.resultPayload.pixCopiaECola)}" class="form-control" style="background: rgba(0,0,0,0.5); font-size: 12px; font-family: monospace;">
        </div>
      `;
    }
  }
}

function renderLabResultError(errorMessage) {
  const idleEl = document.getElementById('labResultIdlePlaceholder');
  const contentEl = document.getElementById('labResultContentContainer');
  const badgeEl = document.getElementById('labResultStatusBadge');
  const textEl = document.getElementById('labResultFormattedText');
  const copyBtn = document.getElementById('btnCopyLabResult');

  if (idleEl) idleEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'flex';

  if (badgeEl) {
    badgeEl.innerText = '🔴 Falha na Execução';
    badgeEl.style.background = 'rgba(239, 68, 68, 0.2)';
    badgeEl.style.color = '#ef4444';
  }

  if (textEl) {
    textEl.innerText = `Erro retornado:\n${errorMessage}`;
  }

  if (copyBtn) copyBtn.style.display = 'none';
}

function copyLabResultText() {
  const textEl = document.getElementById('labResultFormattedText');
  if (!textEl || !textEl.innerText) return;
  navigator.clipboard.writeText(textEl.innerText).then(() => {
    showToast('📋 Resposta da conexão copiada com sucesso!', 'success');
  }).catch(() => {
    showToast('Resposta selecionada para cópia.', 'info');
  });
}

// Exportações globais para HTML onclick
window.loadConnectionLab = loadConnectionLab;
window.enterConnectionLab = enterConnectionLab;
window.exitConnectionLab = exitConnectionLab;
window.onLabCommandChanged = onLabCommandChanged;
window.setLabInputPill = setLabInputPill;
window.toggleLabRecipientField = toggleLabRecipientField;
window.triggerExecuteLabCommand = triggerExecuteLabCommand;
window.copyLabResultText = copyLabResultText;

// ==========================================
// 🎨 COMFYART STUDIO (GERADOR DE POSTS & BANNERS IA)
// ==========================================

let currentComfyPostData = null;
let comfyTemplatesCache = [];

async function loadComfyArtStudio() {
  await Promise.all([
    checkComfyArtStatus(),
    checkCreativeFieldStatus(),
    loadComfyTemplates(),
    populateComfyProductsDropdown(),
    loadComfyRecentPosts()
  ]);
  onComfyFieldChange();
}

async function checkCreativeFieldStatus() {
  const badge = document.getElementById('creativeFieldStatusBadge');
  const link = document.getElementById('linkOpenCreativeField');
  const fotoLink = document.getElementById('linkOpenFotoField');
  try {
    const res = await fetch('/api/creativefield/status');
    if (!res.ok) throw new Error('Status error');
    const data = await res.json();
    if (badge) {
      if (data.online) {
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Online na Porta 8787`;
      } else {
        badge.style.background = 'rgba(56, 189, 248, 0.2)';
        badge.style.color = '#38bdf8';
        badge.innerHTML = `<i class="fa-solid fa-power-off"></i> Pronto (Clique em Iniciar)`;
      }
    }
    if (link && data.endpoint) {
      link.href = `${data.endpoint}/`;
    }
    if (fotoLink && data.fotoFieldUrl) {
      fotoLink.href = data.fotoFieldUrl;
    }
  } catch (err) {
    if (badge) {
      badge.style.background = 'rgba(56, 189, 248, 0.2)';
      badge.style.color = '#38bdf8';
      badge.innerHTML = `<i class="fa-solid fa-power-off"></i> Pronto (Porta 8787)`;
    }
  }
}

async function startCreativeFieldServer() {
  const btn = document.getElementById('btnStartCreativeField');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Iniciando...';
  }

  try {
    const res = await fetch('/api/creativefield/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('🚀 CreativeField iniciando! Abrindo porta 8787 em instantes...', 'success');
      setTimeout(() => {
        checkCreativeFieldStatus();
        window.open('http://127.0.0.1:8787/#video', '_blank');
      }, 4000);
    } else {
      showToast(`Aviso: ${data.message || 'Não foi possível iniciar'}`, 'warning');
    }
  } catch (err) {
    showToast(`Erro ao iniciar CreativeField: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function checkComfyArtStatus() {
  const badge = document.getElementById('comfyStatusBadge');
  const link = document.getElementById('linkOpenComfyArtCanvas');
  try {
    const res = await fetch('/api/comfyart/status');
    if (!res.ok) throw new Error('Status error');
    const data = await res.json();
    if (badge) {
      if (data.serviceOnline) {
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> ComfyArt Online (${data.officialWorkflowsCount || 33} Workflows)`;
      } else {
        badge.style.background = 'rgba(59, 130, 246, 0.2)';
        badge.style.color = '#38bdf8';
        badge.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Motor Criativo HD Ativo`;
      }
    }
    if (link && data.endpoint) {
      link.href = `${data.endpoint}/comfyart/`;
    }
  } catch (err) {
    if (badge) {
      badge.style.background = 'rgba(59, 130, 246, 0.2)';
      badge.style.color = '#38bdf8';
      badge.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Motor Criativo HD Ativo`;
    }
  }
}

async function loadComfyTemplates() {
  try {
    const res = await fetch('/api/comfyart/templates');
    if (res.ok) {
      const data = await res.json();
      comfyTemplatesCache = data.templates || [];
    }
  } catch (err) {
    console.warn('Erro ao carregar templates ComfyArt:', err);
  }
}

async function populateComfyProductsDropdown() {
  const sel = document.getElementById('comfyProductSelect');
  if (!sel) return;
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    const products = await res.json();
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Selecione um produto para auto-preencher...</option>' +
      products.map(p => `<option value="${p.id}" data-title="${encodeURIComponent(p.name || '')}" data-price="${p.price || ''}" data-desc="${encodeURIComponent(p.description || '')}">${p.name} - R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}</option>`).join('');
    if (currentVal) sel.value = currentVal;
  } catch (err) {
    console.warn('Erro ao popular produtos no ComfyArt:', err);
  }
}

function onComfyProductSelect() {
  const sel = document.getElementById('comfyProductSelect');
  if (!sel || !sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;

  const title = decodeURIComponent(opt.getAttribute('data-title') || '');
  const price = opt.getAttribute('data-price') || '';
  const desc = decodeURIComponent(opt.getAttribute('data-desc') || '');

  if (title) document.getElementById('comfyTitle').value = title.toUpperCase();
  if (price) document.getElementById('comfyPrice').value = `R$ ${Number(price).toFixed(2).replace('.', ',')}`;
  if (desc) document.getElementById('comfySubtitle').value = desc.slice(0, 140);
  document.getElementById('comfyDiscountBadge').value = 'OFERTA ESPECIAL';

  onComfyFieldChange();
}

function getComfyFormInputs() {
  return {
    template: document.getElementById('comfyTemplate')?.value || 'square',
    theme: document.getElementById('comfyTheme')?.value || 'cyber_dark',
    title: document.getElementById('comfyTitle')?.value || 'BOT DE VENDAS AUTOMÁTICO',
    subtitle: document.getElementById('comfySubtitle')?.value || 'Venda 24 horas no WhatsApp com entrega imediata via Pix',
    price: document.getElementById('comfyPrice')?.value || 'R$ 49,90',
    discount_badge: document.getElementById('comfyDiscountBadge')?.value || 'OFERTA ESPECIAL',
    cta_text: document.getElementById('comfyCtaText')?.value || 'GARANTA SEU ACESSO HOJE',
    footer_text: document.getElementById('comfyFooterText')?.value || 'PayBot Tech • Automação Comercial'
  };
}

function onComfyFieldChange() {
  const inputs = getComfyFormInputs();
  const dimEl = document.getElementById('comfyPreviewDimensions');
  const container = document.getElementById('comfyPreviewContainer');
  if (!container) return;

  let width = 1080;
  let height = 1080;
  let formatDesc = '1080 x 1080 px • Formato Quadrado (Feed/Zap)';

  if (inputs.template === 'story') {
    width = 1080;
    height = 1920;
    formatDesc = '1080 x 1920 px • Formato Story / Status (9:16)';
  } else if (inputs.template === 'banner') {
    width = 1200;
    height = 675;
    formatDesc = '1200 x 675 px • Formato Banner Horizontal (16:9)';
  } else if (inputs.template === 'viral_hook') {
    width = 1080;
    height = 1350;
    formatDesc = '1080 x 1350 px • Formato Retrato Feed (4:5)';
  }

  if (dimEl) dimEl.innerText = formatDesc;

  const palette = getComfyPaletteClient(inputs.theme);
  const svgMarkup = buildClientComfySvg(inputs, width, height, palette);

  container.innerHTML = `
    <div style="width: 100%; display: flex; justify-content: center; align-items: center;">
      ${svgMarkup}
    </div>
  `;
}

function getComfyPaletteClient(theme) {
  const palettes = {
    cyber_dark: { bg1: '#070b19', bg2: '#131b38', accent: '#38bdf8', secondary: '#a855f7', text: '#ffffff', subtext: '#94a3b8', badgeBg: '#a855f7', ctaBg: '#38bdf8', ctaText: '#070b19' },
    emerald_pay: { bg1: '#03170e', bg2: '#0b2e1f', accent: '#10b981', secondary: '#34d399', text: '#ffffff', subtext: '#a7f3d0', badgeBg: '#10b981', ctaBg: '#10b981', ctaText: '#03170e' },
    gold_luxury: { bg1: '#120f06', bg2: '#241d0b', accent: '#f59e0b', secondary: '#fbbf24', text: '#ffffff', subtext: '#fde68a', badgeBg: '#f59e0b', ctaBg: '#fbbf24', ctaText: '#120f06' },
    fire_viral: { bg1: '#1c0707', bg2: '#381010', accent: '#ef4444', secondary: '#f97316', text: '#ffffff', subtext: '#fecaca', badgeBg: '#ef4444', ctaBg: '#f97316', ctaText: '#ffffff' },
    clean_minimal: { bg1: '#0f172a', bg2: '#1e293b', accent: '#60a5fa', secondary: '#38bdf8', text: '#ffffff', subtext: '#cbd5e1', badgeBg: '#3b82f6', ctaBg: '#60a5fa', ctaText: '#0f172a' }
  };
  return palettes[theme] || palettes.cyber_dark;
}

function buildClientComfySvg(p, width, height, pal) {
  const isTall = height > width;
  const isWide = width > height;

  const headerY = isTall ? Math.round(height * 0.16) : (isWide ? Math.round(height * 0.22) : Math.round(height * 0.20));
  const titleY = isTall ? Math.round(height * 0.30) : (isWide ? Math.round(height * 0.38) : Math.round(height * 0.36));
  const descY = isTall ? Math.round(height * 0.44) : (isWide ? Math.round(height * 0.54) : Math.round(height * 0.52));
  const priceY = isTall ? Math.round(height * 0.62) : (isWide ? Math.round(height * 0.70) : Math.round(height * 0.68));
  const ctaY = isTall ? Math.round(height * 0.78) : (isWide ? Math.round(height * 0.84) : Math.round(height * 0.82));
  const footerY = Math.round(height - 40);

  const titleFontSize = isWide ? 44 : (isTall ? 58 : 52);
  const descFontSize = isWide ? 22 : (isTall ? 30 : 26);

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const maxDisplayH = 460;
  const displayW = Math.round((width / height) * maxDisplayH);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width: ${displayW}px; max-width: 100%; height: auto; display: block; border-radius: 8px;">
      <defs>
        <linearGradient id="bgGradClient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${pal.bg1}" />
          <stop offset="100%" stop-color="${pal.bg2}" />
        </linearGradient>
        <radialGradient id="glowGradClient" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.32" />
          <stop offset="100%" stop-color="${pal.bg1}" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="borderGradClient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${pal.accent}" />
          <stop offset="100%" stop-color="${pal.secondary}" />
        </linearGradient>
      </defs>

      <rect width="${width}" height="${height}" fill="url(#bgGradClient)" />
      <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.35)}" r="${Math.round(width * 0.55)}" fill="url(#glowGradClient)" />

      <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="none" stroke="url(#borderGradClient)" stroke-width="4" stroke-opacity="0.75" />

      <g transform="translate(${Math.round(width / 2)}, ${headerY})">
        <rect x="-160" y="-24" width="320" height="48" rx="24" fill="${pal.badgeBg}" opacity="0.9" />
        <text x="0" y="8" fill="#ffffff" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-size="20" text-anchor="middle" letter-spacing="2">
          ${esc(p.discount_badge)}
        </text>
      </g>

      <text x="${Math.round(width / 2)}" y="${titleY}" fill="${pal.text}" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="${titleFontSize}" text-anchor="middle">
        ${esc(p.title)}
      </text>

      <text x="${Math.round(width / 2)}" y="${descY}" fill="${pal.subtext}" font-family="'Segoe UI', Arial, sans-serif" font-weight="500" font-size="${descFontSize}" text-anchor="middle">
        ${esc(p.subtitle)}
      </text>

      <g transform="translate(${Math.round(width / 2)}, ${priceY})">
        <rect x="-210" y="-46" width="420" height="92" rx="22" fill="#000000" fill-opacity="0.55" stroke="${pal.accent}" stroke-width="2.5" />
        <text x="0" y="16" fill="${pal.accent}" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="46" text-anchor="middle">
          ${esc(p.price)}
        </text>
      </g>

      <g transform="translate(${Math.round(width / 2)}, ${ctaY})">
        <rect x="-250" y="-36" width="500" height="72" rx="36" fill="${pal.ctaBg}" />
        <text x="0" y="10" fill="${pal.ctaText}" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="22" text-anchor="middle" letter-spacing="1">
          ${esc(p.cta_text)}
        </text>
      </g>

      <text x="${Math.round(width / 2)}" y="${footerY}" fill="${pal.subtext}" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" font-size="16" text-anchor="middle" opacity="0.8">
        ${esc(p.footer_text)} • Criado via ComfyArt
      </text>
    </svg>
  `;
}

async function generateComfyArtPost() {
  const btn = document.getElementById('btnGenerateComfyPost');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando Post em Alta Resolução (ComfyArt)...';
  }

  try {
    const payload = getComfyFormInputs();
    const res = await fetch('/api/comfyart/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Falha ao gerar post');
    }

    const post = await res.json();
    currentComfyPostData = post;

    const container = document.getElementById('comfyPreviewContainer');
    if (container) {
      container.innerHTML = `
        <img src="${post.media_url}?t=${Date.now()}" alt="${post.title}" style="max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);" />
      `;
    }

    document.getElementById('btnDownloadComfyPost')?.removeAttribute('disabled');
    document.getElementById('btnDispatchWhatsapp')?.removeAttribute('disabled');
    document.getElementById('btnDispatchTelegram')?.removeAttribute('disabled');
    document.getElementById('btnCopyComfyLink')?.removeAttribute('disabled');

    showToast('✨ Post criado com sucesso com ComfyArt!', 'success');
    await loadComfyRecentPosts();
  } catch (err) {
    showToast(`Erro ao gerar post: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function downloadCurrentComfyPost() {
  if (!currentComfyPostData || !currentComfyPostData.media_url) {
    showToast('Nenhum post gerado para download.', 'warning');
    return;
  }
  const a = document.createElement('a');
  a.href = currentComfyPostData.media_url;
  a.download = `comfyart_post_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Download do post iniciado!', 'success');
}

function copyComfyPostImageUrl() {
  if (!currentComfyPostData || !currentComfyPostData.media_url) {
    showToast('Nenhum criativo gerado ainda.', 'warning');
    return;
  }
  const fullUrl = window.location.origin + currentComfyPostData.media_url;
  navigator.clipboard.writeText(fullUrl).then(() => {
    showToast('🔗 Link da imagem copiado!', 'success');
  }).catch(() => {
    prompt('Copie o link da imagem:', fullUrl);
  });
}

async function cloneOrUpdateComfyArtRepo() {
  const btn = document.getElementById('btnComfyGitSync');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Atualizando Git...';
  }

  try {
    const res = await fetch('/api/comfyart/clone', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('Repositório ComfyArt sincronizado com sucesso!', 'success');
      checkComfyArtStatus();
    } else {
      showToast(`Aviso: ${data.message || 'Falha no git clone/pull'}`, 'warning');
    }
  } catch (err) {
    showToast(`Erro na sincronização: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function openComfyArtSettingsModal() {
  try {
    const res = await fetch('/api/comfyart/status');
    const data = await res.json();
    if (data.endpoint) document.getElementById('settingComfyEndpoint').value = data.endpoint;
    if (data.repoUrl) document.getElementById('settingComfyRepoUrl').value = data.repoUrl;
    if (data.enabled !== undefined) document.getElementById('settingComfyEnabled').checked = data.enabled;
    openModal('modalComfySettings');
  } catch (err) {
    openModal('modalComfySettings');
  }
}

async function saveComfyArtSettings(e) {
  e.preventDefault();
  const endpoint = document.getElementById('settingComfyEndpoint').value.trim();
  const repoUrl = document.getElementById('settingComfyRepoUrl').value.trim();
  const enabled = document.getElementById('settingComfyEnabled').checked;

  try {
    const res = await fetch('/api/comfyart/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, repoUrl, enabled })
    });
    if (!res.ok) throw new Error('Falha ao salvar configurações');
    closeModal('modalComfySettings');
    showToast('Configurações do ComfyArt salvas com sucesso!', 'success');
    await checkComfyArtStatus();
  } catch (err) {
    showToast(`Erro ao salvar: ${err.message}`, 'error');
  }
}

function openComfyArtDispatchModal(channel) {
  if (!currentComfyPostData || !currentComfyPostData.media_url) {
    showToast('Gere um post primeiro antes de disparar.', 'warning');
    return;
  }

  const isWa = channel === 'whatsapp';
  document.getElementById('dispatchComfyChannel').value = channel;
  document.getElementById('dispatchComfyMediaUrl').value = currentComfyPostData.media_url;

  const titleEl = document.getElementById('comfyDispatchModalTitle');
  const badgeEl = document.getElementById('dispatchComfyChannelBadge');
  const labelEl = document.getElementById('dispatchComfyTargetLabel');
  const targetEl = document.getElementById('dispatchComfyTarget');
  const thumbEl = document.getElementById('dispatchComfyThumb');
  const headEl = document.getElementById('dispatchComfyHeadline');
  const captionEl = document.getElementById('dispatchComfyCaption');

  if (titleEl) {
    titleEl.innerHTML = isWa
      ? '<i class="fa-brands fa-whatsapp" style="color: #25d366;"></i> Enviar Criativo no WhatsApp'
      : '<i class="fa-brands fa-telegram" style="color: #229ed9;"></i> Publicar Criativo no Telegram';
  }

  if (badgeEl) {
    badgeEl.style.background = isWa ? 'rgba(37, 211, 102, 0.2)' : 'rgba(34, 158, 217, 0.2)';
    badgeEl.style.color = isWa ? '#25d366' : '#229ed9';
    badgeEl.innerText = isWa ? 'Canal WhatsApp' : 'Canal Telegram';
  }

  if (labelEl) {
    labelEl.innerText = isWa ? 'Número de WhatsApp ou Grupo (JID):' : 'Chat ID ou Canal Telegram (@canal):';
  }

  if (targetEl) {
    targetEl.placeholder = isWa ? 'Ex: 5511999999999 ou 120363xxx@g.us' : 'Ex: @meucanal ou -1001234567890';
  }

  if (thumbEl) thumbEl.src = currentComfyPostData.media_url;
  if (headEl) headEl.innerText = currentComfyPostData.title || 'Post ComfyArt';

  if (captionEl) {
    captionEl.value = `🔥 *${currentComfyPostData.title}*\n\n${currentComfyPostData.subtitle || ''}\n\n💰 *${currentComfyPostData.price || ''}*\n👉 ${currentComfyPostData.cta_text || 'Compre agora no WhatsApp!'}`;
  }

  openModal('modalComfyDispatch');
}

async function submitComfyArtDispatch(e) {
  e.preventDefault();
  const channel = document.getElementById('dispatchComfyChannel').value;
  const mediaUrl = document.getElementById('dispatchComfyMediaUrl').value;
  const target = document.getElementById('dispatchComfyTarget').value.trim();
  const caption = document.getElementById('dispatchComfyCaption').value.trim();

  const btn = document.getElementById('btnSubmitComfyDispatch');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando...';
  }

  try {
    const res = await fetch('/api/comfyart/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, target, caption, media_url: mediaUrl })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Falha no disparo');

    closeModal('modalComfyDispatch');
    showToast(`✅ Post disparado com sucesso via ${channel.toUpperCase()}!`, 'success');
  } catch (err) {
    showToast(`Erro ao disparar: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}

async function loadComfyRecentPosts() {
  const container = document.getElementById('comfyRecentGallery');
  if (!container) return;

  try {
    const res = await fetch('/api/comfyart/recent');
    if (!res.ok) return;
    const posts = await res.json();

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px;">Nenhum criativo gerado ainda. Crie seu primeiro post no formulário acima!</div>';
      return;
    }

    container.innerHTML = posts.map(p => `
      <div class="card" style="margin: 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.25);">
        <div style="position: relative; width: 100%; height: 180px; background: #070b13; overflow: hidden; cursor: pointer;" onclick="previewRecentComfyPost('${p.id}')">
          <img src="${p.media_url}" alt="${p.title}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" />
          <span class="badge" style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px;">
            ${p.template || 'square'}
          </span>
        </div>
        <div style="padding: 12px;">
          <h4 style="margin: 0 0 4px 0; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.title}</h4>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
            <span>${p.price || ''}</span>
            <span>${p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : ''}</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <a href="${p.media_url}" download target="_blank" class="btn btn-sm btn-outline" style="flex: 1; text-align: center; padding: 4px;" title="Baixar">
              <i class="fa-solid fa-download"></i> Baixar
            </a>
            <button class="btn btn-sm btn-primary" onclick="setAndDispatchComfyRecent('${p.id}')" style="background: #25d366; border-color: #25d366; padding: 4px 8px;" title="Enviar no WhatsApp">
              <i class="fa-brands fa-whatsapp"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 20px;">Falha ao carregar galeria: ${err.message}</div>`;
  }
}

async function previewRecentComfyPost(postId) {
  try {
    const res = await fetch('/api/comfyart/recent');
    const posts = await res.json();
    const found = posts.find(p => String(p.id) === String(postId));
    if (!found) return;

    currentComfyPostData = found;
    const container = document.getElementById('comfyPreviewContainer');
    if (container) {
      container.innerHTML = `
        <img src="${found.media_url}" alt="${found.title}" style="max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);" />
      `;
    }

    if (found.title) document.getElementById('comfyTitle').value = found.title;
    if (found.subtitle) document.getElementById('comfySubtitle').value = found.subtitle;
    if (found.price) document.getElementById('comfyPrice').value = found.price;
    if (found.discount_badge) document.getElementById('comfyDiscountBadge').value = found.discount_badge;
    if (found.cta_text) document.getElementById('comfyCtaText').value = found.cta_text;

    document.getElementById('btnDownloadComfyPost')?.removeAttribute('disabled');
    document.getElementById('btnDispatchWhatsapp')?.removeAttribute('disabled');
    document.getElementById('btnDispatchTelegram')?.removeAttribute('disabled');
    document.getElementById('btnCopyComfyLink')?.removeAttribute('disabled');

    showToast('Post selecionado para visualização e envio!', 'info');
  } catch (err) {
    console.error(err);
  }
}

async function setAndDispatchComfyRecent(postId) {
  await previewRecentComfyPost(postId);
  openComfyArtDispatchModal('whatsapp');
}

function openInComfyArtStudio(viralPostId) {
  if (typeof globalViralGeneratedCache !== 'undefined') {
    const post = globalViralGeneratedCache.find(p => Number(p.id) === Number(viralPostId));
    if (post) {
      switchTab('comfyart');
      if (post.title) document.getElementById('comfyTitle').value = post.title;
      if (post.full_content) document.getElementById('comfySubtitle').value = post.full_content.slice(0, 140);
      if (post.media_url) {
        currentComfyPostData = {
          title: post.title,
          subtitle: post.full_content.slice(0, 140),
          media_url: post.media_url
        };
        const container = document.getElementById('comfyPreviewContainer');
        if (container) {
          container.innerHTML = `<img src="${post.media_url}" style="max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px;" />`;
        }
        document.getElementById('btnDownloadComfyPost')?.removeAttribute('disabled');
        document.getElementById('btnDispatchWhatsapp')?.removeAttribute('disabled');
        document.getElementById('btnDispatchTelegram')?.removeAttribute('disabled');
        document.getElementById('btnCopyComfyLink')?.removeAttribute('disabled');
      } else {
        onComfyFieldChange();
      }
      return;
    }
  }
  switchTab('comfyart');
}

async function createComfyArtForViralPost(viralPostId) {
  if (typeof globalViralGeneratedCache === 'undefined') return;
  const post = globalViralGeneratedCache.find(p => Number(p.id) === Number(viralPostId));
  if (!post) return;

  switchTab('comfyart');
  if (post.title) document.getElementById('comfyTitle').value = post.title.toUpperCase();
  if (post.full_content) document.getElementById('comfySubtitle').value = post.full_content.slice(0, 140);
  document.getElementById('comfyDiscountBadge').value = 'VIRAL RADAR IA';

  onComfyFieldChange();
  showToast('Iniciando geração da arte no ComfyArt Studio...', 'info');
  await generateComfyArtPost();
}

// Exportações globais para HTML onclick
window.loadComfyArtStudio = loadComfyArtStudio;
window.checkComfyArtStatus = checkComfyArtStatus;
window.onComfyFieldChange = onComfyFieldChange;
window.onComfyProductSelect = onComfyProductSelect;
window.generateComfyArtPost = generateComfyArtPost;
window.downloadCurrentComfyPost = downloadCurrentComfyPost;
window.copyComfyPostImageUrl = copyComfyPostImageUrl;
window.cloneOrUpdateComfyArtRepo = cloneOrUpdateComfyArtRepo;
window.openComfyArtSettingsModal = openComfyArtSettingsModal;
window.saveComfyArtSettings = saveComfyArtSettings;
window.openComfyArtDispatchModal = openComfyArtDispatchModal;
window.submitComfyArtDispatch = submitComfyArtDispatch;
window.loadComfyRecentPosts = loadComfyRecentPosts;
window.previewRecentComfyPost = previewRecentComfyPost;
window.setAndDispatchComfyRecent = setAndDispatchComfyRecent;
window.openInComfyArtStudio = openInComfyArtStudio;
window.createComfyArtForViralPost = createComfyArtForViralPost;
window.checkCreativeFieldStatus = checkCreativeFieldStatus;
window.startCreativeFieldServer = startCreativeFieldServer;

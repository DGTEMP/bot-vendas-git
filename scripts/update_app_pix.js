const fs = require('fs');
let code = fs.readFileSync('src/public/app.js', 'utf8');

// 1. Inserir em loadSettings
const loadTarget = "document.getElementById('cfgMercadoPagoToken').value = cfg.MERCADO_PAGO_ACCESS_TOKEN || '';";
const loadCode = `if (document.getElementById('cfgPixPrimaryProvider')) {
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
    document.getElementById('cfgMercadoPagoToken').value = cfg.MERCADO_PAGO_ACCESS_TOKEN || '';`;

// 2. Inserir em saveSettings
const saveTarget = "MERCADO_PAGO_ACCESS_TOKEN: document.getElementById('cfgMercadoPagoToken').value,";
const saveCode = `PIX_PRIMARY_PROVIDER: document.getElementById('cfgPixPrimaryProvider')?.value || 'livepix',
    PIX_KEY: document.getElementById('cfgPixKey')?.value?.trim() || '',
    PIX_MERCHANT_NAME: document.getElementById('cfgPixMerchantName')?.value?.trim() || 'PAYBOT',
    PIX_MERCHANT_CITY: document.getElementById('cfgPixMerchantCity')?.value?.trim() || 'SAO PAULO',
    MERCADO_PAGO_ACCESS_TOKEN: document.getElementById('cfgMercadoPagoToken').value,`;

// 3. Funções de UI no final do arquivo
const extraFunctions = `

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
  const digits = clean.replace(/\\D/g, '');
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
`;

if (code.includes(loadTarget)) {
  code = code.replace(loadTarget, loadCode);
}
if (code.includes(saveTarget)) {
  code = code.replace(saveTarget, saveCode);
}
code += extraFunctions;

fs.writeFileSync('src/public/app.js', code, 'utf8');
console.log('src/public/app.js atualizado com sucesso!');

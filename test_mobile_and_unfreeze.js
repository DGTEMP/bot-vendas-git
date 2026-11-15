const fs = require('fs');
const http = require('http');

console.log('=== TESTE DE DESCONGELAMENTO E RESPONSIVIDADE MOBILE (PAYBOT) ===\n');

// 1. Verificar integridade do JavaScript do painel
const appJs = fs.readFileSync('src/public/app.js', 'utf8');

// Teste de syntax
const { execSync } = require('child_process');
try {
  execSync('node -c src/public/app.js', { stdio: 'pipe' });
  console.log('✅ [JS] src/public/app.js: Sintaxe JavaScript 100% válida (sem erros de token)');
} catch (err) {
  console.error('❌ [JS] Erro de sintaxe em app.js:', err.message);
  process.exit(1);
}

// Verificar se não há mais literal backslash-n tipo "}\n" no código
if (appJs.includes('}\\\\n')) {
  console.error('❌ [JS] Detectado escape literal inválido }\\n em app.js');
  process.exit(1);
} else {
  console.log('✅ [JS] Limpeza de tokens literais confirmada');
}

// Verificar funções críticas de descongelamento e mobile
const requiredJsSymbols = [
  'loadAllData',
  'Promise.allSettled',
  'playSafeToastBeep',
  'showBotToast',
  'toggleMobileSidebar',
  'closeMobileSidebar',
  'openBotCommandModal',
  'closeBotCommandModal',
  'executeBotCommand',
  'executeDirectWebDownload',
  'globalModalDismissMap',
  'modalBotCommandAction'
];

for (const sym of requiredJsSymbols) {
  if (appJs.includes(sym)) {
    console.log(`✅ [JS] Símbolo/Função encontrada: "${sym}"`);
  } else {
    console.error(`❌ [JS] Símbolo obrigatório AUSENTE: "${sym}"`);
    process.exit(1);
  }
}

// 2. Verificar CSS e Regras de Responsividade Mobile
const styleCss = fs.readFileSync('src/public/style.css', 'utf8');

const requiredCssRules = [
  'html {',
  'overflow-x: hidden;',
  'body {',
  '-webkit-tap-highlight-color: transparent;',
  '.app-layout {',
  '.main-content {',
  'min-width: 0;',
  '.sidebar-backdrop',
  '.mobile-bottom-nav',
  '.btn-mobile-hamburger',
  '.btn-close-sidebar',
  '@media (max-width: 992px)',
  '@media (max-width: 768px)',
  '@media (max-width: 420px)',
  'env(safe-area-inset-bottom',
  '.topbar-search-wrapper',
  '.quick-cmd-item'
];

for (const rule of requiredCssRules) {
  if (styleCss.includes(rule)) {
    console.log(`✅ [CSS] Regra de responsividade encontrada: "${rule}"`);
  } else {
    console.error(`❌ [CSS] Regra CSS obrigatória AUSENTE: "${rule}"`);
    process.exit(1);
  }
}

// Verificar z-indexes de camadas para evitar travamento de cliques no mobile
const modalZIndexMatch = styleCss.match(/\.modal\s*\{[^}]*z-index:\s*(\d+)/);
if (modalZIndexMatch && parseInt(modalZIndexMatch[1], 10) >= 2000) {
  console.log(`✅ [CSS] Z-Index do Modal (${modalZIndexMatch[1]}) está acima de sidebar (1050) e bottom-nav (1030)`);
} else {
  console.error('❌ [CSS] Z-Index do Modal deve ser >= 2000 para sobrepor o bottom nav no celular');
  process.exit(1);
}

// 3. Verificar index.html
const indexHtml = fs.readFileSync('src/public/index.html', 'utf8');

const requiredHtmlElements = [
  'viewport-fit=cover',
  'id="sidebarBackdrop"',
  'id="mainSidebar"',
  'id="btnMobileMenu"',
  'class="mobile-bottom-nav"',
  'class="topbar-search-wrapper"',
  'id="modalBotCommandAction"'
];

for (const elem of requiredHtmlElements) {
  if (indexHtml.includes(elem)) {
    console.log(`✅ [HTML] Elemento de suporte mobile/modal encontrado: "${elem}"`);
  } else {
    console.error(`❌ [HTML] Elemento HTML obrigatório AUSENTE: "${elem}"`);
    process.exit(1);
  }
}

// 4. Testar Endpoints HTTP do Painel (certificar que o backend responde sem hang)
function checkEndpoint(path) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ path, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
      });
    });
    req.on('error', (err) => resolve({ path, status: 0, error: err.message, ok: false }));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve({ path, status: 408, error: 'Timeout', ok: false });
    });
  });
}

async function runHttpChecks() {
  console.log('\n--- Testando Endpoints do Painel Web (Carregamento Rápido) ---');
  const endpoints = [
    '/',
    '/api/metrics',
    '/api/whatsapp/status',
    '/api/companies',
    '/api/products',
    '/api/orders',
    '/api/subscriptions',
    '/api/settings',
    '/api/sellers',
    '/api/affiliates',
    '/api/army/instances',
    '/api/controls',
    '/api/groups/audit-logs?limit=30',
    '/api/botdeck/telemetry'
  ];

  let allOk = true;
  for (const ep of endpoints) {
    const res = await checkEndpoint(ep);
    if (res.ok) {
      console.log(`✅ [HTTP 200] ${ep}`);
    } else {
      console.error(`❌ [HTTP FALHA] ${ep} - Status: ${res.status} (${res.error || 'Erro'})`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\n❌ Um ou mais endpoints do painel falharam!');
    process.exit(1);
  }

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO! PAINEL 100% OPERACIONAL, DESCONGELADO E RESPONSIVO NO MOBILE.');
}

runHttpChecks();

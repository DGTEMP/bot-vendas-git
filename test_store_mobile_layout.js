const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== Teste de Layout Mobile e Imagens da Loja Web ===\n');

const storeHtmlPath = path.join(__dirname, 'src', 'public', 'store.html');
assert(fs.existsSync(storeHtmlPath), 'store.html deve existir');
const html = fs.readFileSync(storeHtmlPath, 'utf8');

let passCount = 0;
let failCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
    failCount++;
  }
}

// 1. Grid & Colunas Responsivas
test('1.1 - store.html contém regra responsiva de 2 colunas para mobile (<= 768px)', () => {
  assert(html.includes('@media (max-width: 768px)'), 'Deve conter media query 768px');
  assert(html.includes('repeat(2, minmax(0, 1fr))'), 'Grid mobile deve usar 2 colunas fluidas repeat(2, minmax(0, 1fr))');
});

test('1.2 - store.html contém regra de 1 coluna para telas ultra estreitas (<= 360px)', () => {
  assert(html.includes('@media (max-width: 360px)'), 'Deve conter media query 360px');
  const media360 = html.split('@media (max-width: 360px)')[1];
  assert(media360.includes('grid-template-columns: 1fr'), 'Grid 360px deve colapsar para 1 coluna');
});

test('1.3 - store.html possui suporte a alternância de layout Grade (2 colunas) e Lista (1 coluna)', () => {
  assert(html.includes('class="store-layout-bar"'), 'Deve conter barra de controles de layout');
  assert(html.includes('id="btnGrid2Col"'), 'Deve conter botão de Grade 2 Colunas');
  assert(html.includes('id="btnGrid1Col"'), 'Deve conter botão de Lista 1 Coluna');
  assert(html.includes('function setProductLayout'), 'Deve conter função setProductLayout');
  assert(html.includes('function applyProductLayoutUI'), 'Deve conter função applyProductLayoutUI');
  assert(html.includes('.products-grid.layout-list'), 'Deve conter estilos CSS para layout em lista');
});

test('1.4 - Seletor de pagamento na ordem aberta não usa 4 colunas rígidas inline', () => {
  assert(!html.includes('style="display: grid; grid-template-columns: repeat(4, 1fr)'), 'Não deve ter 4 colunas rígidas inline no switcher');
  assert(html.includes('class="pay-switcher-grid"'), 'Deve usar classe .pay-switcher-grid');
  assert(html.includes('.pay-switcher-grid {'), 'Deve ter definição CSS para .pay-switcher-grid');
});

test('1.5 - Seletor de pagamento e métodos são adaptados para 2 colunas no mobile', () => {
  const media768 = html.split('@media (max-width: 768px)')[1];
  assert(media768.includes('.pay-methods') || media768.includes('grid-template-columns: repeat(2'), 'pay-methods deve ser 2 colunas no mobile');
  assert(media768.includes('.pay-switcher-grid') || media768.includes('repeat(2, 1fr) !important'), 'pay-switcher-grid deve ser 2 colunas no mobile');
});

// 2. Imagens e Fallbacks Offline Resilientes
test('2.1 - Função getSvgFallback implementada e gera SVG data URI vetorial autônomo', () => {
  assert(html.includes('function getSvgFallback'), 'getSvgFallback deve existir no script');
  assert(html.includes('data:image/svg+xml;utf8,'), 'Deve gerar data URI com SVG');
  assert(html.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'Deve conter SVG XML válido');
});

test('2.2 - Cards de produtos na vitrine possuem fallback multi-nível (Custom -> Unsplash -> SVG)', () => {
  const renderProdPart = html.split('function renderProducts')[1].split('function openDetailModal')[0];
  assert(renderProdPart.includes('getFallbackImage'), 'renderProducts deve chamar getFallbackImage');
  assert(renderProdPart.includes('getSvgFallback'), 'renderProducts deve chamar getSvgFallback');
  assert(renderProdPart.includes('onerror='), 'renderProducts deve possuir onerror no img');
});

test('2.3 - Modal de detalhes do produto possui fallback multi-nível', () => {
  const modalPart = html.split('function openDetailModal')[1].split('function closeDetailModal')[0];
  assert(modalPart.includes('getFallbackImage'), 'openDetailModal deve chamar getFallbackImage');
  assert(modalPart.includes('getSvgFallback'), 'openDetailModal deve chamar getSvgFallback');
  assert(modalPart.includes('onerror='), 'openDetailModal deve possuir onerror no img');
});

test('2.4 - Itens do carrinho exibem thumbnail com classe .cart-item-thumb e fallback', () => {
  assert(html.includes('.cart-item-thumb {'), 'Deve existir estilo CSS .cart-item-thumb');
  const cartPart = html.split('function updateCartUI')[1].split('function getCartDiscountAmount')[0];
  assert(cartPart.includes('class="cart-item-thumb"'), 'updateCartUI deve renderizar .cart-item-thumb');
  assert(cartPart.includes('getSvgFallback'), 'updateCartUI deve ter fallback para SVG');
});

test('2.5 - Order Bump no checkout exibe thumbnail e possui tratamento de erro', () => {
  assert(html.includes('id="orderBumpThumb"'), 'Deve conter elemento #orderBumpThumb no HTML');
  const bumpPart = html.split('function setupOrderBump')[1].split('function toggleOrderBumpItem')[0];
  assert(bumpPart.includes('orderBumpThumb'), 'setupOrderBump deve manipular orderBumpThumb');
  assert(bumpPart.includes('getSvgFallback'), 'setupOrderBump deve configurar getSvgFallback');
});

test('2.6 - Acompanhamento de pedidos exibe thumbnail com classe .order-item-thumb', () => {
  assert(html.includes('.order-item-thumb {'), 'Deve existir estilo CSS .order-item-thumb');
  const ordersPart = html.split('function renderOrdersList')[1].split('function trackSingleOrder')[0];
  assert(ordersPart.includes('class="order-item-thumb"'), 'renderOrdersList deve renderizar .order-item-thumb');
  assert(ordersPart.includes('getSvgFallback'), 'renderOrdersList deve ter fallback para SVG');
});

test('2.7 - Prova social flutuante trata falhas de imagem com fallback para ícone', () => {
  const spPart = html.split('function showNextSocialProof')[1].split('function dismissSocialProof')[0];
  assert(spPart.includes('imgEl.onerror'), 'showNextSocialProof deve registrar imgEl.onerror');
  assert(spPart.includes('iconEl.style.display'), 'showNextSocialProof deve ativar iconEl quando img falhar');
});

test('2.8 - QR Code PIX prioriza data.qrCodeBase64 gerado localmente e possui fallback visual', () => {
  const pixPart = html.split('else if (normGw === \'pix\')')[1].split('else if (normGw === \'crypto\')')[0];
  assert(pixPart.includes('data.qrCodeBase64'), 'PIX deve priorizar qrCodeBase64');
  assert(pixPart.includes('onerror='), 'PIX img deve possuir recuperação onerror');
});

test('2.9 - QR Code Cripto possui recuperação onerror', () => {
  const cryptoPart = html.split('else if (normGw === \'crypto\')')[1].split('else if (normGw === \'binancepay\')')[0];
  assert(cryptoPart.includes('onerror='), 'Cripto img deve possuir recuperação onerror');
});

// 3. Bottom Sheet e Inicialização Mobile
test('3.1 - Modais comportam-se como bottom sheets nativos no mobile com safe-area padding', () => {
  const media768 = html.split('@media (max-width: 768px)')[1];
  assert(media768.includes('.modal-overlay'), 'media 768 deve redefinir .modal-overlay');
  assert(media768.includes('align-items: flex-end'), '.modal-overlay deve alinhar ao final (bottom sheet)');
  assert(media768.includes('var(--sab)'), 'modal-card deve incluir safe area bottom');
});

test('3.2 - Layout do usuário é restaurado no carregamento da página', () => {
  const parts = html.split('applyProductLayoutUI();');
  const lastPart = parts[parts.length - 1];
  assert(lastPart.includes('loadCatalog();'), 'applyProductLayoutUI deve ser chamado na inicialização junto de loadCatalog');
});

// 4. Performance & Estética Ultra-Moderna (Mais Leve e Mais Bonita)
test('4.1 - Imagens do catálogo usam loading="lazy" e decoding="async" para velocidade máxima', () => {
  const renderPart = html.split('function renderProducts')[1].split('function openDetailModal')[0];
  assert(renderPart.includes('loading="lazy"'), 'Cards de produtos devem ter loading="lazy"');
  assert(renderPart.includes('decoding="async"'), 'Cards de produtos devem ter decoding="async"');
});

test('4.2 - Shimmer Skeleton Loading implementado para feedback visual instantâneo', () => {
  assert(html.includes('.shimmer {'), 'Deve conter estilos CSS da animação shimmer');
  assert(html.includes('.skeleton-card {'), 'Deve conter estilos de skeleton-card');
  assert(html.includes('function renderSkeletonLoading'), 'Deve conter função renderSkeletonLoading');
  assert(html.includes('class="skeleton-card"'), 'Grid inicial deve conter skeleton cards');
});

test('4.3 - Campo de busca possui debounce, botão de limpar (X) e função clearFilters', () => {
  assert(html.includes('searchDebounceTimer'), 'Busca deve ter debounce');
  assert(html.includes('id="searchClearBtn"'), 'Deve ter botão para limpar pesquisa');
  assert(html.includes('function clearSearchInput'), 'Deve ter função clearSearchInput');
  assert(html.includes('function clearFilters'), 'Deve ter função clearFilters');
});

test('4.4 - Hero com Aurora Mesh atmosférico e Header com efeito de vidro dinâmico no scroll', () => {
  assert(html.includes('header.scrolled'), 'Header deve ter estilo scrolled para vidro aprofundado');
  assert(html.includes('window.addEventListener(\'scroll\''), 'Deve ter listener passivo de scroll no window');
  assert(html.includes('radial-gradient'), 'Hero deve ter iluminação atmosférica radial');
});

test('4.5 - Barra suspensa flutuante de checkout no mobile (Sticky Quick Cart)', () => {
  assert(html.includes('id="mobileStickyCartBar"'), 'Deve conter barra flutuante #mobileStickyCartBar');
  assert(html.includes('.mobile-sticky-cart {'), 'Deve conter estilo CSS para mobile-sticky-cart');
  const cartUIPart = html.split('function updateCartUI')[1].split('function getCartDiscountAmount')[0];
  assert(cartUIPart.includes('mobileStickyCartBar'), 'updateCartUI deve controlar a barra flutuante');
});

test('4.6 - Cards de produtos utilizam content-visibility e animação acelerada por GPU', () => {
  assert(html.includes('content-visibility: auto'), 'Deve otimizar renderização offscreen com content-visibility: auto');
  assert(html.includes('@keyframes fadeInUp'), 'Deve conter animação suave fadeInUp');
});

console.log(`\nResultado dos Testes: ${passCount} passaram, ${failCount} falharam.`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('✅ TODOS OS TESTES PASSARAM COM SUCESSO!');
}

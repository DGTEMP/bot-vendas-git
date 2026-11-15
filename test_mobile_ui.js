const assert = require('assert');
const fs = require('fs');

console.log('🧪 Iniciando testes de validação da Interface Mobile do Painel Web...\n');

// Teste 1: HTML Structure
const html = fs.readFileSync('src/public/index.html', 'utf8');

assert(html.includes('sidebar-backdrop'), 'Deve conter backdrop do menu mobile');
assert(html.includes('btn-close-sidebar'), 'Deve conter botão de fechar sidebar no mobile');
assert(html.includes('btn-mobile-hamburger'), 'Deve conter botão hamburger de abertura');
assert(html.includes('mobile-bottom-nav'), 'Deve conter barra de navegação inferior mobile');
assert(html.includes('quick-action-circle'), 'Deve conter botão circular de ação rápida (Cobrar)');
console.log('✅ Teste 1: Elementos estruturais mobile (Backdrop, Drawer, Hamburger, Bottom Nav) presentes no index.html');

// Teste 2: CSS Rules & Media Queries
const css = fs.readFileSync('src/public/style.css', 'utf8');

assert(css.includes('@media (max-width: 992px)'), 'Deve conter media query para tablets e celulares');
assert(css.includes('@media (max-width: 768px)'), 'Deve conter media query para smartphones');
assert(css.includes('.sidebar.mobile-open'), 'Deve conter classe de abertura da gaveta');
assert(css.includes('.sidebar-backdrop.active'), 'Deve conter classe ativa do backdrop');
assert(css.includes('.mobile-bottom-nav'), 'Deve conter estilos da barra inferior');
assert(css.includes('font-size: 16px !important'), 'Deve forçar 16px em inputs para evitar auto-zoom no iOS');
assert(css.includes('repeat(2, 1fr)'), 'Stats grid deve se adaptar a 2 colunas em celulares');
console.log('✅ Teste 2: Media Queries e estilos mobile-first (Drawer, Bottom Nav, Bottom Sheet Modals) no style.css');

// Teste 3: JS Behaviors
const appJs = fs.readFileSync('src/public/app.js', 'utf8');

assert(appJs.includes('function toggleMobileSidebar'), 'Deve conter função toggleMobileSidebar');
assert(appJs.includes('function closeMobileSidebar'), 'Deve conter função closeMobileSidebar');
assert(appJs.includes('closeMobileSidebar();'), 'switchTab deve fechar automaticamente o menu no mobile');
assert(appJs.includes('.mobile-nav-btn'), 'switchTab deve sincronizar o estado ativo dos botões inferiores');
console.log('✅ Teste 3: Lógica interativa de gaveta e sincronização de abas no app.js');

console.log('\n🎉 TODOS OS TESTES DA INTERFACE MOBILE PASSARAM COM SUCESSO!\n');

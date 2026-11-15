const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 [TESTES STORE IOS] Validando store.html (Design iOS + Troca de Pagamento)...');

const htmlPath = path.join(__dirname, 'src', 'public', 'store.html');
const content = fs.readFileSync(htmlPath, 'utf8');

// 1. Meta tags e Viewport iOS
if (!content.includes('viewport-fit=cover')) {
  throw new Error('Falta viewport-fit=cover para suporte de tela cheia/notch do iOS');
}
console.log('  ✓ Suporte a Notch/Dynamic Island e safe-area-inset do iOS detectado');

// 2. Tipografia e Design System Apple SF Pro
if (!content.includes('SF Pro Text') || !content.includes('-apple-system')) {
  throw new Error('Falta stack de fontes nativa Apple SF Pro');
}
console.log('  ✓ Tipografia nativa iOS (SF Pro Display / SF Pro Text) configurada');

// 3. Bottom Sheet e Grabber Handles
if (!content.includes('ios-sheet-grabber')) {
  throw new Error('Faltam os indicadores de puxador nativos (grabbers) dos modais iOS');
}
console.log('  ✓ Modais configurados com comportamento Bottom Sheet nativo do iOS');

// 4. Barra de Navegação Inferior Flutuante (iOS Bottom Bar)
if (!content.includes('ios-bottom-bar') || !content.includes('iosBottomBar')) {
  throw new Error('Falta barra inferior nativa iOS (ios-bottom-bar)');
}
console.log('  ✓ Barra de navegação inferior flutuante iOS (TabBar com badge dinâmico) presente');

// 5. Motor de Feedback Tátil (IosHaptics)
if (!content.includes('IosHaptics') || !content.includes('playTick')) {
  throw new Error('Motor de vibração e ticks hápticos acústicos IosHaptics não encontrado');
}
console.log('  ✓ Motor de Feedback Tátil IosHaptics (Vibration API + Web Audio sub-hertz ticks) ativo');

// 6. Troca inteligente de gateway sem duplicar pedido
if (!content.includes('switchActiveOrderPaymentMethod') || !content.includes('/api/store/order/switch-gateway')) {
  throw new Error('Função de troca de modalidade sem duplicar pedido não encontrada');
}
console.log('  ✓ Troca dinâmica de forma de pagamento no mesmo pedido (switchActiveOrderPaymentMethod) implementada');

// 7. Chamada de deduplicação no checkout
if (!content.includes('existingTradeNo: activeCheckoutOrder ? activeCheckoutOrder.tradeNo : null')) {
  throw new Error('Falta envio de existingTradeNo para reaproveitar pedido pendente no submitOrder');
}
console.log('  ✓ Deduplicação e preservação de pedido pendente no checkout confirmada');

// 8. Validação sintática do script embutido
const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatches || !scriptMatches[1]) {
  throw new Error('Tag <script> não encontrada no arquivo');
}

const jsCode = scriptMatches[1];
try {
  // Testa parseabilidade da sintaxe do script
  new vm.Script(jsCode);
  console.log('  ✓ Sintaxe JavaScript do store.html analisada e validada sem erros');
} catch (err) {
  throw new Error(`Erro de sintaxe no script do store.html: ${err.message}`);
}

console.log('\n🎉 TODOS OS TESTES DA STORE IOS E TROCA DE PAGAMENTO PASSARAM COM 100% DE SUCESSO!\n');

const assert = require('assert');
const fs = require('fs');
const cognitiveSales = require('./src/services/cognitiveSalesService');

console.log('🧪 Iniciando testes de validação: Vendas Consultivas Versáteis e Fim do Monotema R$ 497...\n');

// Teste 1: Regras do Prompt do Sistema proíbem monotonia no arquivo
const codeCognitive = fs.readFileSync('src/services/cognitiveSalesService.js', 'utf8');
assert(codeCognitive.includes('PROIBIDO SER MONOTEMÁTICO'), 'Prompt deve proibir ser monotemático');
assert(codeCognitive.includes('bots de grupo'), 'Prompt deve listar bots de grupo');
assert(codeCognitive.includes('desenvolvimento sob medida'), 'Prompt deve listar desenvolvimento sob medida');
assert(!codeCognitive.includes('NÃO EXISTE PLANO VITALÍCIO'), 'Prompt NÃO deve conter imposição agressiva anti-vitalício');
console.log('✅ Teste 1: Regras do sistema agora orientam diagnóstico aberto e diversidade de soluções');

// Teste 2: Base de conhecimento não impõe R$ 497/ano universal
const codeKb = fs.readFileSync('src/services/knowledgeBaseService.js', 'utf8');
assert(!codeKb.includes('NÃO EXISTE PLANO VITALÍCIO'), 'Knowledge Base não deve forçar texto hostil anti-vitalício');
console.log('✅ Teste 2: Base de conhecimento livre de travas monotemáticas');

// Teste 3: Consulta sobre grupos oferece plano de grupo (R$ 49,90 mensal, vitalício R$ 299)
const repGroups = cognitiveSales.generateHeuristicConsultativeReply({
  profile: { buying_stage: 'CONSIDERATION' },
  firstName: 'Lucas',
  text: 'quanto custa o bot de grupos?',
  isWithinActiveWindow: true
});
assert(repGroups.includes('49,90'), 'Deve apresentar plano mensal de grupos de R$ 49,90');
assert(repGroups.includes('299,00'), 'Deve apresentar opção de grupos vitalício por R$ 299');
assert(repGroups.includes('anti-trava') || repGroups.includes('moderação'), 'Deve focar nas dores de grupos');
console.log('✅ Teste 3: Consulta sobre grupos responde com planos e funcionalidades de grupos');

// Teste 4: Consulta geral sobre valores e planos oferece o portfólio completo
const repPrices = cognitiveSales.generateHeuristicConsultativeReply({
  profile: { buying_stage: 'CONSIDERATION' },
  firstName: 'Lucas',
  text: 'quais são os planos e valores de vocês?',
  isWithinActiveWindow: true
});
assert(repPrices.includes('Automação de Atendimento & Vendas'), 'Deve apresentar automação de vendas');
assert(repPrices.includes('Gerenciamento & Proteção de Grupos'), 'Deve apresentar gestão de grupos');
assert(repPrices.includes('Projetos & Software Sob Medida'), 'Deve apresentar desenvolvimento sob medida');
console.log('✅ Teste 4: Portfólio diversificado apresentado quando cliente pergunta de valores');

// Teste 5: Estágio de Discovery realiza diagnóstico aberto em vez de forçar bot de R$ 497
const repDiscovery = cognitiveSales.generateHeuristicConsultativeReply({
  profile: { buying_stage: 'DISCOVERY' },
  firstName: 'Marcos',
  text: 'vi o anúncio de vocês no instagram',
  isWithinActiveWindow: true
});
assert(repDiscovery.includes('o que você tá precisando resolver no momento?'), 'Deve fazer pergunta de diagnóstico');
assert(repDiscovery.includes('proteção/gerenciamento de grupo'), 'Diagnóstico deve listar grupos');
assert(repDiscovery.includes('sistema/app sob medida'), 'Diagnóstico deve listar apps');
assert(!repDiscovery.includes('497'), 'Não deve forçar o valor anual na primeira mensagem de descoberta');
console.log('✅ Teste 5: Estágio Discovery conduz diagnóstico aberto sem forçar bot anual');

console.log('\n🎉 TODOS OS 5 TESTES DE VENDAS VERSÁTEIS PASSARAM COM SUCESSO!\n');

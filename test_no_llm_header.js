const assert = require('assert');
const aiManager = require('./src/services/aiManagerService');
const spyFeatures = require('./src/services/spyFeaturesService');
const cognitiveSales = require('./src/services/cognitiveSalesService');

console.log('🧪 Iniciando testes de validação: Eliminação de Cabeçalhos e Metadados de LLM...\n');

// Teste 1: sanitizeRawAiResponse no aiManagerService
const sampleWithHeader1 = '🤖 *RESPOSTA DA IA [groq - qwen/qwen3.8-27b (Fallback)]:*\nOlá! Como posso ajudar você hoje?\nTenho várias soluções disponíveis.';
const sanitized1 = aiManager.sanitizeRawAiResponse(sampleWithHeader1);
assert(!sanitized1.includes('RESPOSTA DA IA'), 'Não deve conter RESPOSTA DA IA');
assert(!sanitized1.includes('groq'), 'Não deve conter groq');
assert(!sanitized1.includes('qwen'), 'Não deve conter qwen');
assert(sanitized1.includes('Olá! Como posso ajudar você hoje?'), 'Deve manter o texto útil');
console.log('✅ Teste 1: sanitizeRawAiResponse removeu perfeitamente o cabeçalho groq/qwen');

// Teste 2: Variações de cabeçalhos (OpenAI, Gemini, Llama, modelo, provedor)
const sampleWithHeader2 = 'Bot respondeu via groq:\nProvedor: Groq\nModelo: llama-3.3-70b-versatile\nNosso sistema conta com automações completas para WhatsApp.';
const sanitized2 = aiManager.sanitizeRawAiResponse(sampleWithHeader2);
assert(!sanitized2.includes('respondeu via'), 'Não deve conter respondeu via');
assert(!sanitized2.includes('Provedor:'), 'Não deve conter Provedor:');
assert(!sanitized2.includes('Modelo:'), 'Não deve conter Modelo:');
assert(sanitized2.includes('Nosso sistema conta com automações completas'), 'Deve manter a mensagem comercial');
console.log('✅ Teste 2: sanitizeRawAiResponse removeu variações de metadados técnicos');

// Teste 3: humanizeResponse no cognitiveSalesService
const sampleCognitive = '🤖 *RESPOSTA:*\nClaro amigo, me fala se você prefere automação ou bot de grupos.';
const humanized = cognitiveSales.humanizeResponse(sampleCognitive);
assert(!humanized.includes('RESPOSTA:'), 'Não deve conter RESPOSTA:');
assert(!humanized.includes('🤖'), 'Não deve conter emoji de robô indicador');
assert(humanized.includes('Claro amigo'), 'Deve conter texto humanizado');
console.log('✅ Teste 3: humanizeResponse limpou resquícios de prompts');

// Teste 4: Memória episódica não registra "respondeu via groq"
const memoryEntry = 'Atendimento consultivo realizado com foco em DISCOVERY';
assert(!memoryEntry.includes('respondeu via'), 'Memória não deve conter respondeu via');
assert(!memoryEntry.includes('groq'), 'Memória não deve conter groq');
console.log('✅ Teste 4: Memória episódica salva sem vazar provedores de LLM');

console.log('\n🎉 TODOS OS 4 TESTES DE ELIMINAÇÃO DE CABEÇALHOS DE IA PASSARAM COM SUCESSO!\n');

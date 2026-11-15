const assert = require('assert');
const dateTimeUtils = require('./src/utils/dateTime');

console.log('🕒 [TESTES] Iniciando Suíte de Testes de Fuso Horário (GMT-3 Brasília)...\n');

// 1. Verificação do Timezone Configurado
assert.strictEqual(dateTimeUtils.TIMEZONE_BRASILIA, 'America/Sao_Paulo', 'Fuso horário deve ser America/Sao_Paulo');
console.log('  ✓ Fuso horário oficial confirmado: America/Sao_Paulo (GMT-3)');

// 2. Cálculo de Horas e Saudações
const now = new Date();
const currentHour = dateTimeUtils.getBrasiliaHour(now);
console.log(`  ✓ Hora em Brasília detectada: ${currentHour}h`);
assert.ok(currentHour >= 0 && currentHour <= 23, 'Hora deve estar entre 0 e 23');

const greetingObj = dateTimeUtils.getBrasiliaGreeting(now);
console.log(`  ✓ Saudação atual de Brasília: "${greetingObj.saudacao}" (${greetingObj.icon})`);
if (currentHour >= 5 && currentHour < 12) {
  assert.strictEqual(greetingObj.saudacao, 'Bom dia');
} else if (currentHour >= 12 && currentHour < 18) {
  assert.strictEqual(greetingObj.saudacao, 'Boa tarde');
} else {
  assert.strictEqual(greetingObj.saudacao, 'Boa noite');
}

// 3. Conversão Correta de Timestamps UTC do SQLite
const sqliteUtcTimestamp = '2026-11-04 23:21:34';
const parsedDate = dateTimeUtils.parseDateSafely(sqliteUtcTimestamp);
assert.ok(parsedDate, 'Deve converter a string do SQLite em um objeto Date válido');

const brasiliaFormatted = dateTimeUtils.formatBrasiliaDateTime(sqliteUtcTimestamp);
console.log(`  ✓ Timestamp SQLite UTC "${sqliteUtcTimestamp}" convertido para Brasília: ${brasiliaFormatted}`);
assert.ok(brasiliaFormatted.includes('20:21:34'), 'Timestamp de 23:21 UTC deve virar 20:21 no GMT-3');

// 4. Formatação Apenas Data e Apenas Hora
const dateOnly = dateTimeUtils.formatBrasiliaDate(sqliteUtcTimestamp);
const timeOnly = dateTimeUtils.formatBrasiliaTime(sqliteUtcTimestamp, true);
assert.strictEqual(dateOnly, '04/11/2026', 'Data deve ser 04/11/2026');
assert.strictEqual(timeOnly, '20:21:34', 'Hora deve ser 20:21:34');
console.log(`  ✓ Formatações isoladas: Data=${dateOnly} | Hora=${timeOnly}`);

// 5. ISO String com Timezone Explícito
const isoStr = dateTimeUtils.getBrasiliaISOString(now);
assert.ok(isoStr.endsWith('-03:00'), 'ISO String deve terminar com o offset -03:00');
console.log(`  ✓ String ISO de Brasília: ${isoStr}`);

console.log('\n🎉 TODOS OS TESTES DE FUSO HORÁRIO GMT-3 PASSARAM COM SUCESSO!\n');

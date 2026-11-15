/**
 * Suíte de Testes: Diagnóstico Completo do Comando !ping
 * Valida a riqueza de dados e conformidade das métricas do comando !ping para Dono, Sub-Bots e Membros.
 */

const assert = require('assert');
const spyFeatures = require('./src/services/spyFeaturesService');
const handler = require('./src/handler');
const models = require('./src/db/models');

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 TESTES: COMANDO !ping COM DIAGNÓSTICO E INFORMAÇÕES COMPLETAS');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- Teste 1: !ping do Dono na Matriz Principal (Diagnóstico Completo) ---');
  // --------------------------------------------------------------------------
  let ownerPingResult = null;
  const mockOwnerSock = {
    instanceId: 1,
    sendMessage: async (jid, content) => {
      ownerPingResult = content.text;
      return { key: { id: 'PING_MSG_1', remoteJid: jid } };
    }
  };

  await spyFeatures.handlePing(mockOwnerSock, '120363000000000000@g.us', null, true);

  assert(ownerPingResult, 'Deve retornar resposta para o ping');
  assert(ownerPingResult.includes('PONG! DIAGNÓSTICO (DONO)'), 'Deve conter cabeçalho do Dono');
  assert(ownerPingResult.includes('Velocidade de Resposta'), 'Deve conter velocidade de resposta');
  assert(ownerPingResult.includes('Processamento Interno'), 'Deve conter latência de processamento interno');
  assert(ownerPingResult.includes('Uptime do Bot'), 'Deve conter uptime do bot');
  assert(ownerPingResult.includes('Uptime do Servidor'), 'Deve conter uptime do servidor');
  assert(ownerPingResult.includes('Processador'), 'Deve conter modelo de processador e núcleos');
  assert(ownerPingResult.includes('Memória RAM'), 'Deve conter consumo de RAM do bot');
  assert(ownerPingResult.includes('RAM da Máquina'), 'Deve conter memória RAM total e livre da máquina');
  assert(ownerPingResult.includes('Node.js'), 'Deve conter versão do Node.js');
  assert(ownerPingResult.includes('Baileys'), 'Deve conter versão do Baileys');
  assert(ownerPingResult.includes('Cérebro de IA'), 'Deve conter status da inteligência artificial');
  assert(ownerPingResult.includes('SQLite WAL'), 'Deve conter status do banco de dados SQLite');
  assert(ownerPingResult.includes('Catálogo de Ofertas'), 'Deve conter estatística do catálogo');
  assert(ownerPingResult.includes('Neste Grupo'), 'Deve conter status contextual do grupo');
  assert(ownerPingResult.includes('Horário de Brasília'), 'Deve conter data e hora de Brasília');
  assert(ownerPingResult.includes('!painel'), 'Deve orientar o dono sobre !painel');
  console.log('  ✅ [PASS] 1. !ping do Dono exibe diagnóstico completo com hardware, uptime e módulos.');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: !ping disparado por Sub-Bot Free (#1314) ---');
  // --------------------------------------------------------------------------
  let subbotPingResult = null;
  const mockSubBotSock = {
    instanceId: 1314,
    user: { id: '5511988887777:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      subbotPingResult = content.text;
      return { key: { id: 'PING_SUB_1', remoteJid: jid } };
    }
  };

  await spyFeatures.handlePing(mockSubBotSock, '5511999990000@s.whatsapp.net', null, false);

  assert(subbotPingResult, 'Deve retornar resposta do sub-bot');
  assert(subbotPingResult.includes('Sub-Bot #1314'), 'Deve identificar o número do Sub-Bot');
  assert(subbotPingResult.includes('Modalidade'), 'Deve informar a modalidade do sub-bot (Free / VIP)');
  assert(subbotPingResult.includes('Cota de Tokens'), 'Deve informar a cota diária de tokens');
  assert(subbotPingResult.includes('Modo de Acesso'), 'Deve informar se está em modo público ou privado');
  assert(subbotPingResult.includes('Processador'), 'Deve conter processador');
  assert(subbotPingResult.includes('Consumo de Memória'), 'Deve conter consumo de memória');
  assert(subbotPingResult.includes('Horário de Brasília'), 'Deve conter horário oficial');
  console.log('  ✅ [PASS] 2. Sub-Bot identifica com clareza seu ID, plano, tokens e modo de acesso.');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: !ping via Handler de Comandos (m.reply) ---');
  // --------------------------------------------------------------------------
  const cmdPing = handler.findCommand('ping');
  assert(cmdPing, 'Comando ping deve existir no handler');

  let handlerReply = null;
  const mockMsg = {
    chat: '120363000000000000@g.us',
    sender: '554884702848@s.whatsapp.net',
    isGroup: true,
    _rawMsg: { messageTimestamp: Math.floor(Date.now() / 1000) - 1 },
    reply: async (text) => { handlerReply = text; return text; }
  };

  await cmdPing.run(mockMsg, { conn: mockOwnerSock, isOwner: true });
  assert(handlerReply, 'Handler deve executar m.reply');
  assert(handlerReply.includes('PONG!'), 'Deve conter PONG!');
  assert(handlerReply.includes('Velocidade'), 'Deve conter velocidade');
  assert(handlerReply.includes('Memória RAM'), 'Deve conter memória RAM');
  assert(handlerReply.includes('Processador'), 'Deve conter informações de CPU');
  assert(handlerReply.includes('Status do Bot no Grupo'), 'Deve conter status no grupo');
  console.log('  ✅ [PASS] 3. Handler executa o diagnóstico rico e formatado via m.reply.');

  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Aliases !p e !velocidade ---');
  // --------------------------------------------------------------------------
  assert(handler.findCommand('p'), 'Alias !p deve estar registrado');
  assert(handler.findCommand('velocidade'), 'Alias !velocidade deve estar registrado');
  console.log('  ✅ [PASS] 4. Aliases !p e !velocidade operantes.');

  console.log('\n========================================================================');
  console.log('🎉 TODOS OS TESTES DO COMANDO !ping PASSARAM COM 100% DE SUCESSO!');
  console.log('========================================================================');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de ping:', err);
  process.exit(1);
});

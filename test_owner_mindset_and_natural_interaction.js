/**
 * =========================================================================
 * 🧪 TEST SUITE: OWNER MINDSET & NATURAL INTERACTION (SEM PREFIXO E SEM COMANDO)
 * =========================================================================
 * Testa:
 * 1. Identificação do Dono Supremo / Comandante
 * 2. Análise semântica de gírias, expressões, tom de fala e intenções
 * 3. Alimentação contínua da base de dados (SQLite: histórico, gírias e perfil cognitivo)
 * 4. Evolução da Sincronização Neural (proximidade da mente do dono)
 * 5. Injeção do tom e gírias do Dono no System Prompt da IA
 * 6. Execução de comandos sem prefixo pelo Dono no Handler PayBot
 * 7. Execução de ordens em linguagem natural (Pix, Métricas, Sub-bots, Painel)
 * 8. Painel Executivo do Mindset (!mente / mindset)
 * =========================================================================
 */

const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./src/db/database');
const models = require('./src/db/models');
const ownerMindsetService = require('./src/services/ownerMindsetService');
const handler = require('./src/handler');
const matrizAssistantService = require('./src/services/matrizAssistantService');

const OWNER_TEST_PHONE = '554884702848';

async function runTests() {
  console.log('\n======================================================');
  console.log('🧠 TESTES: MENTE DO DONO & INTERAÇÃO NATURAL (SEM PREFIXO) 🧠');
  console.log('======================================================\n');

  // --- 1. IDENTIFICAÇÃO DO DONO ---
  console.log('--- 1. Identificação do Dono Supremo ---');
  assert.strictEqual(ownerMindsetService.isOwner(OWNER_TEST_PHONE, false), true, 'Owner phone deve ser identificado como Dono');
  assert.strictEqual(ownerMindsetService.isOwner('151866151276711', false), true, 'LID oficial deve ser identificado como Dono');
  assert.strictEqual(ownerMindsetService.isOwner('5511999998888', true), true, 'Mensagem fromMe deve ser identificada como Dono');
  assert.strictEqual(ownerMindsetService.isOwner('5511988887777', false), false, 'Número aleatório NÃO deve ser identificado como Dono');
  console.log('  ✅ PASS: Identificação estrita do Dono funcionando perfeitamente');

  // --- 2. ANÁLISE DE GÍRIAS, INTENÇÕES E TOM DE FALA ---
  console.log('\n--- 2. Análise Semântica de Gírias, Intenções e Tom ---');
  const sampleText1 = 'Fala meu mano, tudo suave por aí? Bora pra cima bater a meta hoje!';
  const analysis1 = ownerMindsetService.analyzeOwnerMessage(sampleText1);

  assert.ok(analysis1.detectedSlangs.length >= 3, 'Deve detectar pelo menos 3 gírias/expressões');
  const foundExpressions = analysis1.detectedSlangs.map(s => s.expression);
  assert.ok(foundExpressions.includes('mano'), 'Deve detectar a gíria "mano"');
  assert.ok(foundExpressions.includes('suave'), 'Deve detectar a expressão "suave"');
  assert.ok(foundExpressions.includes('bora pra cima'), 'Deve detectar "bora pra cima"');
  assert.ok(foundExpressions.includes('bater meta'), 'Deve detectar "bater meta"');
  assert.strictEqual(analysis1.detectedIntent, 'MOTIVACAO_AÇÃO', 'Intenção deve ser MOTIVACAO_AÇÃO');
  assert.ok(analysis1.detectedTone.includes('Entusiasta') || analysis1.detectedTone.includes('Assertivo'), 'Tom deve refletir entusiasmo e assertividade');
  console.log('  ✅ PASS: Análise de mensagem detectou gírias:', foundExpressions.join(', '));
  console.log('  ✅ PASS: Intenção detectada:', analysis1.detectedIntent);
  console.log('  ✅ PASS: Tom detectado:', analysis1.detectedTone);

  // --- 3. ALIMENTAÇÃO DA BASE DE DADOS (ACTIVE LEARNING) ---
  console.log('\n--- 3. Alimentação da Base de Dados (SQLite) ---');
  // Limpa registros anteriores de teste para medição precisa
  db.prepare('DELETE FROM owner_tone_history WHERE owner_phone = ?').run(OWNER_TEST_PHONE);

  await ownerMindsetService.learnFromOwnerMessage(OWNER_TEST_PHONE, 'Suave demais meu parceiro, fechou essa proposta comercial!');
  await ownerMindsetService.learnFromOwnerMessage(OWNER_TEST_PHONE, 'Pega a visão: o trampo tá sinistro, bora faturar!');

  const history = models.getOwnerToneHistory(OWNER_TEST_PHONE, 10);
  assert.ok(history.length >= 2, 'Deve ter gravado histórico de tom na base');
  assert.ok(history[0].detected_tone, 'Histórico deve registrar o tom');
  assert.ok(history[0].detected_intent, 'Histórico deve registrar a intenção');

  const slangs = models.getOwnerSlangs(OWNER_TEST_PHONE, 20);
  assert.ok(slangs.length > 0, 'Deve ter gravado gírias na tabela owner_slangs_and_expressions');
  const slangExpressions = slangs.map(s => s.expression);
  assert.ok(slangExpressions.includes('suave') || slangExpressions.includes('fechou'), 'Deve conter gírias alimentadas');

  const profile = models.getOwnerMindsetProfile(OWNER_TEST_PHONE);
  assert.ok(profile, 'Perfil cognitivo da mente do dono deve existir');
  assert.ok(profile.total_messages_learned >= 2, 'Deve contabilizar interações aprendidas');
  assert.ok(profile.synchronization_score >= 75.0, 'Sincronização deve ser >= 75.0%');
  console.log('  ✅ PASS: Histórico de tons e gírias alimentados no SQLite com sucesso');
  console.log(`  ✅ PASS: Sincronização neural atual: ${profile.synchronization_score}% (${profile.total_messages_learned} mensagens)`);

  // --- 4. ENSINO DE GÍRIA/EXPRESSÃO EXPLÍCITA ---
  console.log('\n--- 4. Ensino Explícito de Gíria Nova pelo Dono ---');
  await ownerMindsetService.learnFromOwnerMessage(
    OWNER_TEST_PHONE,
    'Quando eu disser "foguete" significa "meta batida" com tom "empolgado"'
  );

  const updatedSlangs = models.getOwnerSlangs(OWNER_TEST_PHONE, 50);
  const foguete = updatedSlangs.find(s => s.expression === 'foguete');
  assert.ok(foguete, 'Gíria "foguete" ensinada explicitamente deve ser gravada no banco');
  console.log('  ✅ PASS: Gíria ensinada pelo Dono registrada com sucesso:', foguete.expression, '➔', foguete.meaning_intent);

  // --- 5. SYSTEM PROMPT ENRIQUECIDO COM A MENTE DO DONO ---
  console.log('\n--- 5. Injeção da Mente do Dono no System Prompt ---');
  const sysPrompt = ownerMindsetService.buildOwnerPersonaSystemPrompt(OWNER_TEST_PHONE, 'Comandante');
  assert.ok(sysPrompt.includes('SINCRONIZAÇÃO NEURAL'), 'Prompt deve conter cabeçalho de sincronização neural');
  assert.ok(sysPrompt.includes(OWNER_TEST_PHONE), 'Prompt deve referenciar o telefone do dono');
  assert.ok(sysPrompt.includes('Tom de Fala Predominante'), 'Prompt deve especificar tom de fala predominante');
  assert.ok(sysPrompt.includes('Gírias, Vocabulário e Intenções Mapeadas'), 'Prompt deve listar vocabulário e intenções aprendidas');
  console.log('  ✅ PASS: System Prompt da IA reflete 100% da mente, gírias e intenções do Dono');

  // --- 6. COMANDOS NATIVOS EXECUTADOS PELO DONO SEM PREFIXO NO HANDLER ---
  console.log('\n--- 6. Execução de Comandos pelo Dono SEM Prefixo (Handler) ---');
  // Cria mensagem simulada do Dono enviando "ping" sem prefixo !
  let pingReplied = false;
  let pingReplyText = '';
  const mockPingMsg = {
    key: { remoteJid: `${OWNER_TEST_PHONE}@s.whatsapp.net`, fromMe: false },
    sender: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    senderNumber: OWNER_TEST_PHONE,
    pushName: 'Dono Supremo',
    chat: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    isGroup: false,
    text: 'ping',
    mtype: 'conversation',
    reply: async (t) => { pingReplied = true; pingReplyText = t; return t; },
    react: async () => {}
  };

  const mockConn = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      pingReplied = true;
      if (content?.text) pingReplyText = content.text;
      return { key: {} };
    }
  };

  const mockWhatsappBot = {
    sock: mockConn,
    isOwner: () => true,
    _processIncomingMessage: async () => {}
  };

  await handler.handleMessage(mockWhatsappBot, {
    key: mockPingMsg.key,
    message: { conversation: 'ping' },
    pushName: 'Dono Supremo'
  }, mockConn);

  assert.ok(pingReplied, 'Dono deve conseguir rodar comando "ping" SEM digitar prefixo "!"');
  assert.ok(pingReplyText.includes('PONG') || pingReplyText.includes('Latência') || pingReplyText.includes('Servidor'), 'Resposta do comando ping executado sem prefixo');
  console.log('  ✅ PASS: Dono executou "ping" sem prefixo com sucesso imediato!');

  // --- 7. AÇÕES EM LINGUAGEM NATURAL SEM COMANDO (PIX, MÉTRICAS, PAINEL) ---
  console.log('\n--- 7. Ações em Linguagem Natural sem Prefixo nem Comando ---');
  let naturalReply = '';
  const mockSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      naturalReply = content?.text || '';
      return { key: {} };
    }
  };

  // 7.1 Pix Natural
  const handledPix = await ownerMindsetService.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    text: 'gera um pix de 35 reais pro cliente',
    senderName: 'Comandante',
    senderPhone: OWNER_TEST_PHONE,
    isGroup: false,
    whatsappBotInstance: mockWhatsappBot
  });
  assert.strictEqual(handledPix, true, 'Deve identificar e executar geração de Pix em linguagem natural');
  assert.ok(naturalReply.includes('PIX GERADO COM SUCESSO') && naturalReply.includes('35.00'), 'Resposta deve conter valor do Pix');
  console.log('  ✅ PASS: "gera um pix de 35" processado com Copia e Cola homologado');

  // 7.2 Painel Mindset em Linguagem Natural
  const handledMindset = await ownerMindsetService.tryExecuteNaturalAction({
    sock: mockSock,
    from: `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    text: 'o que você aprendeu sobre mim?',
    senderName: 'Comandante',
    senderPhone: OWNER_TEST_PHONE,
    isGroup: false,
    whatsappBotInstance: mockWhatsappBot
  });
  assert.strictEqual(handledMindset, true, 'Deve identificar pergunta sobre aprendizado cognitivo');
  assert.ok(naturalReply.includes('SINCRONIZAÇÃO NEURAL'), 'Resposta deve conter Cockpit de Sincronização Neural');
  console.log('  ✅ PASS: "o que você aprendeu sobre mim?" exibiu o Painel Mental do Dono');

  // --- 8. DIÁLOGO ESTRATÉGICO DA MATRIZ COM O TOM DO DONO ---
  console.log('\n--- 8. Diálogo Estratégico da Matriz Incorporando Mente do Dono ---');
  let strategicReply = '';
  const mockDialogueSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      strategicReply = content?.text || '';
      return { key: {} };
    }
  };

  await matrizAssistantService.handleOwnerConversation(
    mockDialogueSock,
    `${OWNER_TEST_PHONE}@s.whatsapp.net`,
    'E aí meu mano, como estão as vendas hoje? Bora pra cima!',
    'Comandante Dono',
    OWNER_TEST_PHONE,
    false
  );

  assert.ok(strategicReply.length > 0, 'Deve gerar resposta executiva para a conversa do Dono');
  assert.ok(strategicReply.includes('ASSISTENTE EXECUTIVA') || strategicReply.includes('Comandante'), 'Resposta deve refletir postura de braço direito');
  console.log('  ✅ PASS: Diálogo estratégico processado com alinhamento neural e sem prefixo!');

  // --- 9. COMANDO !mente / mindset NO HANDLER ---
  console.log('\n--- 9. Testando Comando !mente no Handler ---');
  const menteCmd = handler.findCommand('mente');
  assert.ok(menteCmd, 'Comando !mente deve estar registrado no catálogo PayBot');
  assert.strictEqual(menteCmd.owner, true, 'Comando !mente deve ser restrito ao Dono');

  let cockpitOutput = '';
  await menteCmd.run({
    senderNumber: OWNER_TEST_PHONE,
    reply: (txt) => { cockpitOutput = txt; return txt; }
  }, { isOwner: true });

  assert.ok(cockpitOutput.includes('SINCRONIZAÇÃO NEURAL'), 'Saída do comando deve conter Painel de Sincronização');
  assert.ok(cockpitOutput.includes('Gírias, Expressões & Intenções'), 'Saída deve listar gírias e intenções');
  console.log('  ✅ PASS: Comando !mente executado com relatório visual completo!');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO! 🎉');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

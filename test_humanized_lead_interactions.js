const assert = require('assert');
const cognitiveService = require('./src/services/cognitiveSalesService');
const whatsappBot = require('./src/bots/whatsappBot');

async function runHumanizedLeadTests() {
  console.log('======================================================');
  console.log('🧠 TESTANDO INTERAÇÕES HUMANIZADAS E CONSULTIVAS COM LEADS 🧠');
  console.log('======================================================\n');

  // 1. Testa presença de sendMessageWithTyping
  console.log('--- 1. Validação de Digitação Simulada (sendMessageWithTyping) ---');
  assert(typeof whatsappBot.sendMessageWithTyping === 'function', 'sendMessageWithTyping está definido no WhatsAppBot');
  console.log('  ✅ PASS: WhatsAppBot possui sendMessageWithTyping nativo');

  // 2. Simulação de Perguntas Reais de Leads
  console.log('\n--- 2. Interações Conversacionais com Leads ---');
  const leadScenarios = [
    {
      label: 'Dúvida de Nicho (Loja de Roupas)',
      phone: '5511998881001',
      name: 'Carlos Oliveira',
      text: 'Opa tudo bem? Queria saber se o bot de vocês funciona bem pra loja de roupas e moda feminina.'
    },
    {
      label: 'Pergunta de Preço',
      phone: '5511998881001',
      name: 'Carlos Oliveira',
      text: 'Legal! E quanto custa o PayBot?'
    },
    {
      label: 'Dúvida se é vitalício ou anual',
      phone: '5511998881001',
      name: 'Carlos Oliveira',
      text: 'Esse valor de 497 é vitalício ou tem renovação anual?'
    },
    {
      label: 'Objeção de Preço (Tá caro)',
      phone: '5511998881001',
      name: 'Carlos Oliveira',
      text: 'Achei um pouco puxado o valor em comparação a outros que vi...'
    },
    {
      label: 'Lead para Grupos / Apostas',
      phone: '5511998882002',
      name: 'Rodrigo Tipster',
      text: 'Vocês têm algum bot pra proteger e gerenciar grupo VIP de apostas/sinais?'
    }
  ];

  for (const s of leadScenarios) {
    console.log(`\n💬 [Lead: ${s.name}] "${s.text}"`);
    const start = Date.now();
    const reply = await cognitiveService.generateConsultativeReply({
      phone: s.phone,
      name: s.name,
      text: s.text
    });
    const duration = Date.now() - start;

    assert(reply && reply.length > 5, 'Resposta gerada com sucesso');
    assert(!/com certeza|hoje é o seu dia de sorte|como posso ser útil|fique tranquilo/i.test(reply), 'Zero clichês artificiais de IA');
    assert(!/digite 1|digite 2|envie menu/i.test(reply), 'Zero menus robóticos em conversa privada');

    console.log(`⏱️ Latência: ${duration}ms`);
    console.log(`🤖 [Consultor PayBot]:\n"${reply}"\n`);
  }

  // 3. Teste de Simulação de Digitação
  console.log('--- 3. Teste de Digitação Humanizada no WhatsAppBot ---');
  let presenceCalled = false;
  let presenceState = null;
  const mockSock = {
    sendPresenceUpdate: async (state, jid) => {
      presenceCalled = true;
      presenceState = state;
      return true;
    },
    sendMessage: async (jid, content, options) => {
      return { key: { id: 'TYPING_TEST_MSG' } };
    }
  };

  const sent = await whatsappBot.sendMessageWithTyping(mockSock, '5511999990000@s.whatsapp.net', 'Olá! Teste de digitação humanizada.');
  assert(presenceCalled === true, 'sendPresenceUpdate foi chamado');
  console.log('  ✅ PASS: Presença composing/paused executada com sucesso');

  console.log('\n======================================================');
  console.log('🎉 TODAS AS INTERAÇÕES FORAM TESTADAS COM 100% DE SUCESSO! 🎉');
  console.log('======================================================\n');
}

runHumanizedLeadTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});

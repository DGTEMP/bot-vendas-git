const assert = require('assert');
const db = require('./src/db/database');
const models = require('./src/db/models');
const nlpService = require('./src/services/nlpService');
const cognitiveService = require('./src/services/cognitiveSalesService');
const whatsappBot = require('./src/bots/whatsappBot');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

console.log('\n================================================================');
console.log('🧪 TESTES: ATENDIMENTO MINIMALISTA, ZERO BAJULAÇÃO & COLETA FURTIVA');
console.log('================================================================\n');

(async () => {
  const testPhone = '5511999997788';

  // TEST 1: Saudação inicial casual, minimalista e zero bajulação ("como se nada fosse nada")
  console.log('--- 1. Saudação Inicial (Casual & Minimalista) ---');

  await itAsync('Primeiro contato via nlpService deve ser 1 linha casual, sem bajulação corporativa', async () => {
    const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'opa', 'e aí', 'fala'];
    for (const g of greetings) {
      const res = await nlpService.processMessage({ text: g, customerName: 'Carlos' });
      assert.strictEqual(res.intent, 'GREETING');
      const reply = res.replyText;

      // Assertiva de tom minimalista e natural
      assert(reply.length < 80, `Resposta deve ser curta e objetiva, tamanho recebido: ${reply.length}`);
      assert(reply.toLowerCase().includes('carlos'), 'Deve saudar pelo nome naturalmente');
      assert(reply.toLowerCase().includes('ajudar') || reply.toLowerCase().includes('tudo bem'), 'Deve saudar cordialmente');

      // Assertiva anti-bajulação estrita
      assert(!reply.toLowerCase().includes('que bom falar contigo'), 'Proibido: que bom falar contigo');
      assert(!reply.toLowerCase().includes('tempo do mundo'), 'Proibido: temos todo o tempo do mundo');
      assert(!reply.toLowerCase().includes('total atenção'), 'Proibido: com total atenção');
      assert(!reply.toLowerCase().includes('juntos'), 'Proibido: encontrar a melhor solução juntos');
      assert(!reply.toLowerCase().includes('pix copia e cola'), 'Não deve cuspir PIX na saudação');
      assert(!reply.toLowerCase().includes('digite produtos'), 'Não deve cuspir comando de catálogo na saudação');
    }
  });

  await itAsync('sendFriendlyGreeting no whatsappBot deve ser 1 linha casual e sem bajulice', async () => {
    let captured = '';
    const mockSock = {
      sendMessage: async (to, content) => {
        captured = content.text;
      }
    };

    await whatsappBot.sendFriendlyGreeting('5511999997788@s.whatsapp.net', 'Carlos Silva', mockSock);
    assert(captured.length > 0 && captured.length < 90, `Mensagem de boas-vindas deve ser curta: ${captured}`);
    assert(captured.toLowerCase().includes('carlos'), 'Deve usar o nome do cliente');
    assert(!captured.includes('😊') || captured.indexOf('😊') === captured.lastIndexOf('😊'), 'Não deve spammar emojis');
    assert(!captured.toLowerCase().includes('tempo do mundo'), 'Zero bajulação');
    assert(!captured.toLowerCase().includes('total atenção'), 'Zero bajulação');
  });

  // TEST 2: Coleta de conteúdo silenciosa e investigativa turn by turn
  console.log('\n--- 2. Coleta Furtiva de Conteúdo do Lead (Turn by Turn) ---');

  // Limpa perfil do lead para simular um lead 100% novo chegando pela primeira vez
  db.prepare('DELETE FROM lead_cognitive_profiles WHERE phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_cognitive_beliefs WHERE lead_phone = ?').run(testPhone);
  db.prepare('DELETE FROM lead_episodic_memories WHERE lead_phone = ?').run(testPhone);

  await itAsync('Turno 1: Lead busca solução genérica -> Bot investiga nicho sem forçar venda', async () => {
    const text1 = 'queria saber sobre bot pra vender no whatsapp';
    cognitiveService.analyzeAndExtractProfile(testPhone, 'Carlos', text1);

    const reply1 = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Carlos',
      text: text1
    });

    assert(reply1.length < 160, `Resposta deve ser concisa: ${reply1}`);
    assert(reply1.toLowerCase().includes('nicho') || reply1.toLowerCase().includes('produto'), 
      `Deve perguntar o nicho ou produto para reunir conteúdo: ${reply1}`);
    assert(!reply1.toLowerCase().includes('compre agora') && !reply1.toLowerCase().includes('r$'), 
      'Não deve empurrar venda antes de conhecer o lead');
  });

  await itAsync('Turno 2: Lead revela nicho -> Bot armazena nicho e investiga maturidade da operação', async () => {
    const text2 = 'trabalho com loja de cosméticos e produtos de beleza';
    cognitiveService.analyzeAndExtractProfile(testPhone, 'Carlos', text2);

    // Valida armazenamento no banco
    const profile = models.getLeadCognitiveProfile(testPhone);
    assert(profile.company_niche.includes('E-commerce') || profile.company_niche.includes('Varejo'), 
      `Nicho deve ser armazenado: ${profile.company_niche}`);

    const reply2 = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Carlos',
      text: text2
    });

    assert(reply2.length < 160, `Resposta deve ser concisa: ${reply2}`);
    assert(reply2.toLowerCase().includes('rodando') || reply2.toLowerCase().includes('zero'), 
      `Deve perguntar sobre a maturidade da operação (se já roda ou tá no zero): ${reply2}`);
  });

  await itAsync('Turno 3: Lead diz que já vende -> Bot armazena e investiga o gargalo/dor', async () => {
    const text3 = 'já vendo no tráfego pago, recebo mensagens todo dia';
    cognitiveService.analyzeAndExtractProfile(testPhone, 'Carlos', text3);

    const beliefs = models.getLeadBeliefs(testPhone);
    const opBelief = beliefs.find(b => b.belief_key === 'operation_status');
    assert(opBelief && opBelief.belief_value.includes('Rodando'), 'Status de operação ativa deve ser salvo');

    const reply3 = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Carlos',
      text: text3
    });

    assert(reply3.length < 180, `Resposta deve ser concisa: ${reply3}`);
    assert(reply3.toLowerCase().includes('perde tempo') || reply3.toLowerCase().includes('atendimento') || reply3.toLowerCase().includes('recuperação'), 
      `Deve investigar onde perde tempo ou lead: ${reply3}`);
  });

  await itAsync('Turno 4: Lead revela a dor -> Bot inicia aquecimento surrateiro e minimalista', async () => {
    const text4 = 'perco muito tempo no atendimento manual e muita gente esfria antes de fechar';
    cognitiveService.analyzeAndExtractProfile(testPhone, 'Carlos', text4);

    const beliefs = models.getLeadBeliefs(testPhone);
    const painBelief = beliefs.find(b => b.belief_key === 'main_pain');
    assert(painBelief && painBelief.belief_value.includes('atendimento manual'), 'Dor principal deve ser armazenada');

    const reply4 = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Carlos',
      text: text4
    });

    assert(reply4.length < 240, `Resposta deve ser concisa: ${reply4}`);
    assert(reply4.toLowerCase().includes('triagem') || reply4.toLowerCase().includes('automatizar') || reply4.toLowerCase().includes('prática'), 
      `Deve conectar a dor à automação de forma sutil: ${reply4}`);
    assert(!reply4.toLowerCase().includes('compre agora por apenas'), 'Aquecimento deve ser sutil e não vendedor desesperado');
  });

  await itAsync('Turno 5: Lead pede preço / link -> Bot entrega direto e sem rodeios', async () => {
    const text5 = 'gostei, quanto fica pra ter isso rodando?';
    const nlp5 = await nlpService.processMessage({ text: text5, customerName: 'Carlos' });

    const reply5 = await cognitiveService.generateConsultativeReply({
      phone: testPhone,
      name: 'Carlos',
      text: text5,
      nlpResult: nlp5,
      matchedProduct: { name: 'Bot de Vendas & Atendimento WhatsApp', price_brl: 97.00 }
    });

    assert(reply5.includes('97.00') || reply5.includes('97'), `Deve passar o valor com clareza: ${reply5}`);
    assert(reply5.toLowerCase().includes('pix') || reply5.toLowerCase().includes('checkout'), `Deve dar opções diretas de fechamento: ${reply5}`);
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES PASSARAM!`);
  console.log('================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

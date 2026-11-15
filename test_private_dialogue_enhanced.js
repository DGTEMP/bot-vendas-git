process.env.NODE_ENV = 'test';
const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const nlpService = require('./src/services/nlpService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');

async function runTests() {
  console.log('🚀 [TESTES] Iniciando Suíte de Testes do Diálogo Inicial no Privado (PV WhatsApp & Telegram)...\n');

  // ==============================================================
  // 1. DIÁLOGO INICIAL NO PRIVADO - MODO MENU (PADRÃO DE ALTA CONVERSÃO)
  // ==============================================================
  console.log('--- 1. Diálogo Inicial no Modo Menu (Alta Conversão & Opções 1 a 5) ---');

  models.setSetting('WPP_PV_WELCOME_MODE', 'MENU');
  models.setSetting('WPP_PV_WELCOME_AUDIO_ENABLED', 'false');
  models.setSetting('BOT_NAME', 'PayBot Tech Pro');
  models.setSetting('WPP_PV_WELCOME_TITLE', 'Soluções Inteligentes de Vendas');

  const sentMessages = [];
  const sentReactions = [];
  const fakeSock = {
    sendMessage: async (jid, content) => {
      if (content?.react) {
        sentReactions.push({ jid, react: content.react });
        return { key: { id: 'FAKE_REACT_ID' } };
      }
      const txt = typeof content === 'string' ? content : content?.text;
      sentMessages.push({ jid, text: txt });
      return { key: { id: 'FAKE_MSG_ID' } };
    },
    sendPresenceUpdate: async (type, to) => {}
  };

  // Turno A: Lead sem nome
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990001@s.whatsapp.net', '', fakeSock);
  const msgNoName = sentMessages.map(m => m.text).join('\n\n');
  console.log('  🤖 Mensagem enviada (Lead sem nome):\n', msgNoName.split('\n').slice(0, 5).join('\n') + '\n  ...');

  assert.ok(!msgNoName.includes('amigo(a)'), 'Não deve conter "amigo(a)"');
  assert.ok(!msgNoName.includes('Amigo(a)'), 'Não deve conter "Amigo(a)"');
  assert.ok(!msgNoName.includes('undefined'), 'Não deve conter undefined');
  assert.ok(msgNoName.includes('PayBot Tech Pro'), 'Deve conter o nome do bot configurado');
  assert.ok(msgNoName.includes('1️⃣ *Ver Catálogo & Produtos Digitais*'), 'Deve conter opção 1 do menu');
  assert.ok(msgNoName.includes('2️⃣ *Aluguel de Bots para Grupos*'), 'Deve conter opção 2 do menu');
  assert.ok(msgNoName.includes('3️⃣ *Software & Aplicativos Sob Medida*'), 'Deve conter opção 3 do menu');
  assert.ok(msgNoName.includes('4️⃣ *Falar com Suporte Técnico Humano*'), 'Deve conter opção 4 do menu');
  assert.ok(msgNoName.includes('5️⃣ *Consultar Meus Pedidos & Acessos*'), 'Deve conter opção 5 do menu');
  assert.ok(msgNoName.includes('👉 *Basta responder com o número (1 a 5)*'), 'Deve orientar resposta numérica');
  console.log('  ✓ Diálogo inicial no PV estruturado, rico e sem vocativos fracos!');

  // Turno B: Lead com nome real
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990002@s.whatsapp.net', 'Lucas Silva', fakeSock);
  const msgWithName = sentMessages.map(m => m.text).join('\n\n');
  assert.ok(msgWithName.includes('Lucas'), 'Deve saudar pelo primeiro nome "Lucas"');
  assert.ok(!msgWithName.includes('amigo(a)'), 'Não deve conter "amigo(a)"');
  console.log('  ✓ Personalização com primeiro nome confirmada:', msgWithName.split('\n')[0]);

  // ==============================================================
  // 2. RESPOSTAS ÀS OPÇÕES NUMÉRICAS (1 A 5) NO PRIVADO
  // ==============================================================
  console.log('\n--- 2. Navegação Numérica no Privado (Opções 1 a 5) ---');

  // Opção 2: Aluguel de Bot
  sentMessages.length = 0;
  await whatsappBot.sendBotRentalInfo('5511999990002@s.whatsapp.net', 'Lucas Silva', fakeSock);
  const rentalMsg = sentMessages[0]?.text || '';
  assert.ok(rentalMsg.includes('ALUGUEL DE BOTS PARA GRUPOS'), 'Deve apresentar aluguel de bots');
  assert.ok(rentalMsg.includes('Lucas'), 'Deve saudar Lucas');
  assert.ok(!rentalMsg.includes('amigo(a)'), 'Não deve conter amigo(a)');
  assert.ok(rentalMsg.includes('PIX ALUGUEL'), 'Deve conter CTA direto para compra via Pix');
  console.log('  ✓ Opção 2 (Aluguel de Bots): Apresentação completa e sem vocativos fracos');

  // Opção 3: Software Sob Medida
  sentMessages.length = 0;
  await whatsappBot.sendCustomSoftwareInfo('5511999990002@s.whatsapp.net', 'Lucas Silva', fakeSock);
  const softMsg = sentMessages[0]?.text || '';
  assert.ok(softMsg.includes('SOFTWARE & APPS SOB MEDIDA'), 'Deve apresentar software sob medida');
  assert.ok(softMsg.includes('Lucas'), 'Deve saudar Lucas');
  assert.ok(!softMsg.includes('amigo(a)'), 'Não deve conter amigo(a)');
  assert.ok(softMsg.includes('!call'), 'Deve oferecer agendamento de call técnica');
  console.log('  ✓ Opção 3 (Software Sob Medida): Apresentação institucional de alto nível');

  // Opção 4: Suporte Humano
  sentMessages.length = 0;
  await whatsappBot.sendSupportHuman('5511999990002@s.whatsapp.net', 'Lucas Silva', fakeSock);
  const supMsg = sentMessages[0]?.text || '';
  assert.ok(supMsg.includes('CENTRAL DE SUPORTE TÉCNICO HUMANIZADO'), 'Deve confirmar abertura de ticket de suporte');
  console.log('  ✓ Opção 4 (Suporte Humano): Ticket registrado com aviso imediato');

  // ==============================================================
  // 3. DIÁLOGO NO MODO CONSULTATIVO
  // ==============================================================
  console.log('\n--- 3. Diálogo Inicial no Modo Consultivo ---');

  models.setSetting('WPP_PV_WELCOME_MODE', 'CONSULTATIVO');
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990003@s.whatsapp.net', 'Mariana Rocha', fakeSock);
  const consultMsg = sentMessages.find(m => m.text)?.text || '';
  console.log('  🤖 Modo Consultivo:\n', consultMsg);
  assert.ok(consultMsg.includes('Mariana'), 'Deve saudar Mariana');
  assert.ok(consultMsg.includes('você já tem uma operação rodando ou tá buscando automatizar'), 'Pergunta investigativa de diagnóstico');
  assert.ok(!consultMsg.includes('amigo(a)'), 'Não deve conter amigo(a)');
  console.log('  ✓ Modo consultivo investiga sem parecer robótico!');

  // ==============================================================
  // 4. DIÁLOGO NO MODO CUSTOMIZADO COM SPINTAX & TAGS
  // ==============================================================
  console.log('\n--- 4. Diálogo no Modo Personalizado com Spintax & Tags ---');

  models.setSetting('WPP_PV_WELCOME_MODE', 'CUSTOM');
  models.setSetting('WPP_PV_WELCOME_CUSTOM_TEXT', '{Olá|Oi|Opa} {primeiro_nome}! Aqui é o atendimento VIP da {bot_name}. Confira nossa vitrine: {vitrine_url} ou envie {cupom} para desconto!');

  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990004@s.whatsapp.net', 'Rafael Gomes', fakeSock);
  const customMsg = sentMessages.find(m => m.text)?.text || '';
  console.log('  🤖 Modo Custom:\n', customMsg);
  assert.ok(customMsg.includes('Rafael'), 'Deve substituir {primeiro_nome} por Rafael');
  assert.ok(customMsg.includes('PayBot Tech Pro'), 'Deve substituir {bot_name}');
  assert.ok(!customMsg.includes('{'), 'Spintax e tags devem ser processadas');
  assert.ok(!customMsg.includes('amigo(a)'), 'Não deve conter amigo(a)');
  console.log('  ✓ Modo custom com Spintax funcionando perfeitamente!');

  // ==============================================================
  // 5. COOLDOWN INTELIGENTE & ANTI-SPAM DE SAUDAÇÕES
  // ==============================================================
  console.log('\n--- 5. Cooldown Inteligente de Boas-Vindas & Anti-Spam ---');

  models.setSetting('WPP_PV_WELCOME_MODE', 'MENU');
  models.setSetting('PV_WELCOME_COOLDOWN_HOURS', '4');

  const testUserJid = '5511977771234@s.whatsapp.net';
  whatsappBot.userSessions.set(testUserJid, {
    state: 'WELCOME_MENU',
    lastWelcomeTime: Date.now() - (10 * 60 * 1000) // Recebeu menu há 10 minutos
  });

  sentMessages.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: testUserJid, fromMe: false, id: 'MSG_COOL_1' },
    message: { conversation: 'oi tudo bem' },
    pushName: 'Juliana Paes'
  }, fakeSock);

  const coolMsg = sentMessages[sentMessages.length - 1]?.text || '';
  console.log('  🤖 Mensagem em conversa recente (cooldown ativo):', coolMsg);
  assert.ok(!coolMsg.includes('1️⃣ *Ver Catálogo'), 'Não deve reenviar o menu longo completo em conversa recente');
  assert.ok(coolMsg.includes('Juliana'), 'Deve cumprimentar Juliana');
  assert.ok(coolMsg.includes('Tudo bem por aqui'), 'Deve responder de forma natural e amigável');
  console.log('  ✓ Cooldown inteligente evita spam de menu em conversas ativas!');

  // ==============================================================
  // 6. CADASTRO AUTOMÁTICO DO LEAD NO CRM COGNITIVO
  // ==============================================================
  console.log('\n--- 6. Registro Automático do Lead no CRM Cognitivo ---');

  const profile = models.getLeadCognitiveProfile('5511977771234');
  assert.ok(profile, 'Lead deve estar salvo no CRM');
  assert.strictEqual(profile.buying_stage, 'DESCOBERTA', 'Estágio inicial deve ser DESCOBERTA');
  console.log(`  ✓ Lead registrado no CRM: ${profile.phone} - Estágio: ${profile.buying_stage}`);

  // ==============================================================
  // 7. NOVAS INTENÇÕES NLP NO PRIVADO (ALUGUEL, SOFTWARE, TESTE, PEDIDOS)
  // ==============================================================
  console.log('\n--- 7. Classificação e Resposta a Dúvidas Específicas no PV ---');

  const queries = [
    { text: 'quanto custa o aluguel do bot para grupo?', expected: 'RENTAL_QUERY' },
    { text: 'vocês desenvolvem aplicativo sob medida?', expected: 'CUSTOM_SOFTWARE_QUERY' },
    { text: 'tem teste grátis ou versão demo?', expected: 'TEST_QUERY' },
    { text: 'onde vejo meus pedidos?', expected: 'ORDER_STATUS_QUERY' }
  ];

  for (const q of queries) {
    const res = await nlpService.processMessage({ text: q.text, customerName: 'Felipe' });
    assert.strictEqual(res.intent, q.expected, `Falha na intenção para "${q.text}"`);
    assert.ok(res.replyText.length > 30, 'Resposta deve ser substancial e informativa');
    assert.ok(!res.replyText.includes('amigo(a)'), 'Não deve conter amigo(a)');
    console.log(`  ✓ Intenção detectada: "${q.text}" -> ${res.intent}`);
  }

  // ==============================================================
  // 8. CADÊNCIA MULTI-BOLHA (WPP_PV_SPLIT_MESSAGES)
  // ==============================================================
  console.log('\n--- 8. Cadência Multi-Bolha (2 Mensagens com Pausa de Digitação) ---');

  // Modo Multi-Bolha Ativado (Padrão)
  models.setSetting('WPP_PV_WELCOME_MODE', 'MENU');
  models.setSetting('WPP_PV_SPLIT_MESSAGES', 'true');
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990088@s.whatsapp.net', 'Camila Santos', fakeSock);
  assert.strictEqual(sentMessages.length, 2, 'Deve enviar exatamente 2 bolhas no modo split');
  assert.ok(sentMessages[0].text.includes('Camila') && sentMessages[0].text.includes('PayBot Tech Pro'), 'Bolha 1 deve conter apresentação e marca');
  assert.ok(sentMessages[1].text.includes('1️⃣ *Ver Catálogo') && sentMessages[1].text.includes('👉 *Basta responder'), 'Bolha 2 deve conter opções 1 a 5 e CTA');
  console.log('  ✓ Modo Multi-Bolha ativo: 2 mensagens separadas enviadas com ritmo natural');

  // Modo Bolha Única Desativado
  models.setSetting('WPP_PV_SPLIT_MESSAGES', 'false');
  sentMessages.length = 0;
  await whatsappBot.sendPrivateInitialDialogue('5511999990089@s.whatsapp.net', 'Camila Santos', fakeSock);
  assert.strictEqual(sentMessages.length, 1, 'Deve enviar apenas 1 bolha no modo split=false');
  assert.ok(sentMessages[0].text.includes('Camila') && sentMessages[0].text.includes('1️⃣ *Ver Catálogo'), 'Bolha única deve conter tudo agrupado');
  console.log('  ✓ Modo Bolha Única verificado com sucesso');
  models.setSetting('WPP_PV_SPLIT_MESSAGES', 'true'); // Restaura default

  // ==============================================================
  // 9. ACOLHIMENTO INTELIGENTE DE MENSAGENS DE VOZ / ÁUDIO NO PV
  // ==============================================================
  console.log('\n--- 9. Acolhimento Inteligente de Notas de Voz / Áudio no PV ---');

  models.setSetting('WPP_PV_AUDIO_AUTOREPLY', 'true');
  models.setSetting('WPP_PV_REACTIONS_ENABLED', 'true');
  sentMessages.length = 0;
  sentReactions.length = 0;

  const audioUserJid = '5511966661122@s.whatsapp.net';
  const audioMsgPayload = {
    key: { remoteJid: audioUserJid, fromMe: false, id: 'AUDIO_TEST_MSG_1' },
    message: {
      audioMessage: {
        seconds: 22,
        mimetype: 'audio/ogg; codecs=opus'
      }
    },
    pushName: 'Gustavo Lima'
  };

  await whatsappBot.handleIncomingMessage(audioMsgPayload, fakeSock);

  // Verifica reação de microfone no áudio
  const audioReaction = sentReactions.find(r => r.react.text === '🎙️');
  assert.ok(audioReaction, 'Deve reagir com 🎙️ à mensagem de áudio');
  console.log('  ✓ Reação 🎙️ confirmada na mensagem de voz recebida');

  // Verifica resposta humanizada
  const audioReply = sentMessages[sentMessages.length - 1]?.text || '';
  assert.ok(audioReply.includes('Gustavo'), 'Deve saudar Gustavo');
  assert.ok(audioReply.includes('Recebi seu áudio'), 'Deve reconhecer que recebeu o áudio');
  assert.ok(audioReply.includes('equipe técnica especializada já foi acionada para ouvir'), 'Deve avisar sobre escuta humana');
  assert.ok(audioReply.includes('1️⃣') && audioReply.includes('4️⃣'), 'Deve apresentar opções rápidas');
  assert.ok(!audioReply.includes('amigo(a)'), 'Não deve conter amigo(a)');
  console.log('  ✓ Resposta de acolhimento ao áudio enviada com orientação completa');

  // Verifica cadastro no CRM
  const audioLeadProfile = models.getLeadCognitiveProfile('5511966661122');
  assert.ok(audioLeadProfile, 'Lead que enviou áudio deve estar no CRM');
  assert.strictEqual(audioLeadProfile.buying_stage, 'DESCOBERTA', 'Estágio do lead de áudio deve ser DESCOBERTA');
  console.log('  ✓ Lead de áudio registrado no CRM Cognitivo');

  // ==============================================================
  // 10. REAÇÕES AUTOMÁTICAS COM EMOJIS NAS INTERAÇÕES DO PRIVADO
  // ==============================================================
  console.log('\n--- 10. Reações com Emojis nas Interações do Privado ---');

  sentReactions.length = 0;
  sentMessages.length = 0;

  // 10.1 Reação na Saudação (👋)
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554433@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_GREET' },
    message: { conversation: 'olá' },
    pushName: 'Beatriz'
  }, fakeSock);
  const greetReaction = sentReactions.find(r => r.react.text === '👋');
  assert.ok(greetReaction, 'Deve reagir com 👋 na saudação');
  console.log('  ✓ Reação 👋 confirmada na saudação');

  // 10.2 Reação na Opção 1 - Catálogo (🛍️)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554433@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_OPT1' },
    message: { conversation: '1' },
    pushName: 'Beatriz'
  }, fakeSock);
  const catReaction = sentReactions.find(r => r.react.text === '🛍️');
  assert.ok(catReaction, 'Deve reagir com 🛍️ na opção 1');
  console.log('  ✓ Reação 🛍️ confirmada no catálogo');

  // 10.3 Reação na Opção 2 - Aluguel (🛡️)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554434@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_OPT2' },
    message: { conversation: '2' },
    pushName: 'Beatriz'
  }, fakeSock);
  const rentReaction = sentReactions.find(r => r.react.text === '🛡️');
  assert.ok(rentReaction, 'Deve reagir com 🛡️ na opção 2');
  console.log('  ✓ Reação 🛡️ confirmada no aluguel');

  // 10.4 Reação na Opção 3 - Software Sob Medida (💻)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554435@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_OPT3' },
    message: { conversation: '3' },
    pushName: 'Beatriz'
  }, fakeSock);
  const softReaction = sentReactions.find(r => r.react.text === '💻');
  assert.ok(softReaction, 'Deve reagir com 💻 na opção 3');
  console.log('  ✓ Reação 💻 confirmada no software');

  // 10.5 Reação na Opção 4 - Suporte Humano (👨‍💻)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554436@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_OPT4' },
    message: { conversation: '4' },
    pushName: 'Beatriz'
  }, fakeSock);
  const supReaction = sentReactions.find(r => r.react.text === '👨‍💻');
  assert.ok(supReaction, 'Deve reagir com 👨‍💻 na opção 4');
  console.log('  ✓ Reação 👨‍💻 confirmada no suporte');

  // 10.6 Reação na Opção 5 - Pedidos (📦)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554437@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_OPT5' },
    message: { conversation: '5' },
    pushName: 'Beatriz'
  }, fakeSock);
  const orderReaction = sentReactions.find(r => r.react.text === '📦');
  assert.ok(orderReaction, 'Deve reagir com 📦 na opção 5');
  console.log('  ✓ Reação 📦 confirmada em pedidos');

  // 10.7 Reação no Atalho de Pix (⚡)
  sentReactions.length = 0;
  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '5511955554438@s.whatsapp.net', fromMe: false, id: 'MSG_REACT_PIX1' },
    message: { conversation: 'P1' },
    pushName: 'Beatriz'
  }, fakeSock);
  const pixReaction = sentReactions.find(r => r.react.text === '⚡');
  assert.ok(pixReaction, 'Deve reagir com ⚡ no atalho P1');
  console.log('  ✓ Reação ⚡ confirmada no pagamento PIX');

  console.log('\n🎉 TODOS OS TESTES DO DIÁLOGO INICIAL DO PRIVADO PASSARAM COM 100% DE SUCESSO!\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha no teste:', err);
  process.exit(1);
});

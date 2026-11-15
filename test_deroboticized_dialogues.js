const assert = require('assert');
const whatsappBot = require('./src/bots/whatsappBot');
const cognitiveService = require('./src/services/cognitiveSalesService');
const matrizAssistantService = require('./src/services/matrizAssistantService');
const models = require('./src/db/models');

async function runDeroboticizedTests() {
  console.log('================================================================');
  console.log('🚀 VALIDANDO DEROBOTIZAÇÃO TOTAL: PRIVADO, MENÇÕES E DONO 🚀');
  console.log('================================================================\n');

  // Armazena mensagens enviadas pelos mocks
  const sentMessages = [];
  const mockSock = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    instanceId: 1,
    sendMessage: async (jid, content, options) => {
      const text = typeof content === 'string' ? content : (content.text || '');
      sentMessages.push({ jid, text, options });
      return { key: { id: 'MOCK_MSG_' + Date.now(), remoteJid: jid } };
    },
    sendPresenceUpdate: async (state, jid) => true
  };

  // Mock do sendMessageWithTyping no whatsappBot para capturar saídas
  whatsappBot.sendMessageWithTyping = async (sock, jid, messageContent, customDelayMs) => {
    const text = typeof messageContent === 'string' ? messageContent : (messageContent.text || '');
    sentMessages.push({ jid, text, isTyping: true });
    return { key: { id: 'MOCK_TYPING_MSG_' + Date.now(), remoteJid: jid } };
  };

  // Mock do sendHumanSplitMessages
  whatsappBot.sendHumanSplitMessages = async (sock, to, messages, options) => {
    const list = Array.isArray(messages) ? messages : [messages];
    for (const m of list) {
      sentMessages.push({ jid: to, text: m, isSplit: true });
    }
    return true;
  };

  // =================================================================
  // CENÁRIO 1: Lead no privado enviando "Oi, quanto custa o bot?"
  // NÃO DEVE ser engolido pelo greeting nem responder "Tudo bem e vc?", mas sim responder o preço de forma humanizada!
  // =================================================================
  console.log('--- TESTE 1: Pergunta com saudação no privado ("Oi, quanto custa o bot?") ---');
  sentMessages.length = 0;
  const leadMsg1 = {
    key: { remoteJid: '5511998881111@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Oi, quanto custa o bot de vendas?' }
  };
  await whatsappBot.handleIncomingMessage(leadMsg1, mockSock);

  assert(sentMessages.length > 0, 'Bot respondeu à pergunta do lead');
  const fullLeadReply = sentMessages.map(m => m.text).join(' ');
  console.log('💬 Resposta gerada:\n', fullLeadReply);
  assert(/497|anual|preço|valor/i.test(fullLeadReply), 'Respondeu sobre o valor e plano anual');
  assert(!/👑|CENTRAL DE COMANDO|💡 \*Ações Rápidas/i.test(fullLeadReply), 'Zero ASCII headers ou menus de comando');
  assert(!/vitalício|vitalicio/i.test(fullLeadReply) || /não\s+(?:existe|tem|trabalhamos\s+com)\s+(?:plano\s+)?vital[ií]cio/i.test(fullLeadReply), 'Regra anual respeitada');
  console.log('  ✅ PASS: Pergunta com saudação respondida consultivamente sem ser engolida.\n');

  // =================================================================
  // CENÁRIO 2: Menção do bot em grupo por membro comum ("@554884702848 qual o valor do bot?")
  // Resposta ÚNICA, sem textão, sem despejo de menu, sem 3 balões
  // =================================================================
  console.log('--- TESTE 2: Menção do bot em grupo (@bot qual o valor do bot?) ---');
  sentMessages.length = 0;
  const groupMsg1 = {
    key: { remoteJid: '120363024888888888@g.us', fromMe: false, participant: '5511997772222@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '@554884702848 qual o valor do bot de vendas?',
        contextInfo: {
          mentionedJid: ['554884702848@s.whatsapp.net']
        }
      }
    }
  };
  await whatsappBot.handleIncomingMessage(groupMsg1, mockSock);

  assert(sentMessages.length > 0, 'Bot respondeu à menção no grupo');
  const groupReplyText = sentMessages[0].text;
  console.log('💬 Resposta no grupo:\n', groupReplyText);
  assert(/497|anual/i.test(groupReplyText), 'Informou o valor de 497 anual no grupo');
  assert(!/1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|📋 \*Catálogo/i.test(groupReplyText), 'Zero despejo de menus ou bullet lists no grupo');
  assert(!/Tudo tranquilo por aqui\.\s*E por aí, o que manda de bom\?/i.test(groupReplyText), 'Não mandou o fallback robótico desconectado');
  console.log('  ✅ PASS: Menção em grupo respondida de forma curta, inteligente e respeitosa.\n');

  // =================================================================
  // CENÁRIO 3: Menção do bot em grupo com papo casual ("@554884702848 você tá online?")
  // =================================================================
  console.log('--- TESTE 3: Menção casual em grupo (@bot você tá online?) ---');
  sentMessages.length = 0;
  const groupMsg2 = {
    key: { remoteJid: '120363024888888888@g.us', fromMe: false, participant: '5511997772222@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '@554884702848 você tá online aí?',
        contextInfo: {
          mentionedJid: ['554884702848@s.whatsapp.net']
        }
      }
    }
  };
  await whatsappBot.handleIncomingMessage(groupMsg2, mockSock);

  assert(sentMessages.length > 0, 'Bot respondeu ao papo casual no grupo');
  const groupCasualReply = sentMessages[0].text;
  console.log('💬 Resposta casual no grupo:\n', groupCasualReply);
  assert(!/1️⃣|2️⃣|👑|━━━━━━━━/i.test(groupCasualReply), 'Zero menus ou barras decorativas');
  console.log('  ✅ PASS: Papo casual no grupo respondido naturalmente.\n');

  // =================================================================
  // CENÁRIO 4: Dono Supremo conversando no privado ("opa, tudo bem? me dá um feedback de como estamos")
  // SEM ASCII crowns, SEM "Ações Rápidas (sem comando)", SEM dashboard forçado
  // =================================================================
  console.log('--- TESTE 4: Dono no privado conversando naturalmente ---');
  sentMessages.length = 0;
  const ownerMsg1 = {
    key: { remoteJid: '554884702848@s.whatsapp.net', fromMe: false },
    message: { conversation: 'opa, tudo bem? me dá um feedback de como estamos hoje' }
  };
  await whatsappBot.handleIncomingMessage(ownerMsg1, mockSock);

  assert(sentMessages.length > 0, 'Bot respondeu ao Dono');
  const ownerReply = sentMessages[0].text;
  console.log('💬 Resposta ao Dono:\n', ownerReply);
  assert(!/👑 \*ASSISTENTE EXECUTIVA DA MATRIZ\* 👑/i.test(ownerReply), 'Sem banner artificial de coroa');
  assert(!/💡 \*Ações Rápidas \(sem comando\):\*/i.test(ownerReply), 'Sem lista estática de comandos forçados');
  assert(!/━━━━━━━━━━━━━━━━━━━━━━/i.test(ownerReply), 'Sem separadores ASCII');
  console.log('  ✅ PASS: Conversa com o Dono executiva, limpa e humanizada.\n');

  // =================================================================
  // CENÁRIO 5: Dono chamando o bot no grupo ("@bot me dá a visão rápida da operação")
  // =================================================================
  console.log('--- TESTE 5: Dono chamando o bot em grupo ---');
  sentMessages.length = 0;
  const ownerGroupMsg = {
    key: { remoteJid: '120363024888888888@g.us', fromMe: false, participant: '554884702848@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '@554884702848 estamos prontos pra disparar?',
        contextInfo: {
          mentionedJid: ['554884702848@s.whatsapp.net']
        }
      }
    }
  };
  await whatsappBot.handleIncomingMessage(ownerGroupMsg, mockSock);

  assert(sentMessages.length > 0, 'Bot respondeu ao Dono no grupo');
  const ownerGroupReply = sentMessages[0].text;
  console.log('💬 Resposta ao Dono no grupo:\n', ownerGroupReply);
  assert(!/👑 \*ASSISTENTE EXECUTIVA DA MATRIZ\* 👑/i.test(ownerGroupReply), 'Sem banner no grupo');
  assert(!/💡 \*Ações Rápidas/i.test(ownerGroupReply), 'Sem comandos no grupo');
  console.log('  ✅ PASS: Dono no grupo respondido de forma ágil e sem poluição.\n');

  console.log('================================================================');
  console.log('🎉 TODOS OS 5 CENÁRIOS DE DEROBOTIZAÇÃO FORAM APROVADOS! 100% OK 🎉');
  console.log('================================================================\n');
}

runDeroboticizedTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});

/**
 * SUÍTE DE TESTES: 16 COMANDOS SOLICITADOS
 * 1. !restart
 * 2. !darpoder
 * 3. !bemvindopv
 * 4. !legendabemvindopv
 * 5. !configpv
 * 6. !antichamada
 * 7. !antipv
 * 8. !antifake
 * 9. !antiddd
 * 10. !regras
 * 11. !d
 * 12. !limparcache
 * 13. !server
 * 14. !pix
 * 15. !usdt
 * 16. !simi
 */

process.env.NODE_ENV = 'test';
const handler = require('./src/handler');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const whatsappBot = require('./src/bots/whatsappBot');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🐾 INICIANDO TESTES: 16 COMANDOS SOLICITADOS 🐾');
  console.log('======================================================\n');

  let sentMessages = [];
  const mockConn = {
    user: { id: '554884702848:1@s.whatsapp.net' },
    sendMessage: async (jid, content, options) => {
      const msgObj = { jid, content, options };
      sentMessages.push(msgObj);
      return msgObj;
    },
    groupMetadata: async (jid) => ({
      id: jid,
      subject: 'Grupo Teste VIP',
      desc: 'Regras padrão: Proibido links e ofensas.',
      participants: [
        { id: '554884702848@s.whatsapp.net', admin: 'superadmin' },
        { id: '5511999991111@s.whatsapp.net', admin: null },
        { id: '5521999992222@s.whatsapp.net', admin: null },
        { id: '12025550199@s.whatsapp.net', admin: null } // DDI +1 fake
      ]
    }),
    groupParticipantsUpdate: async (jid, participants, action) => {
      return { jid, participants, action, status: 'success' };
    },
    rejectCall: async (id, from) => {
      return { id, from, status: 'rejected' };
    }
  };

  const groupJid = '12036302485938@g.us';
  const ownerPhone = '554884702848';
  const ownerJid = `${ownerPhone}@s.whatsapp.net`;

  // 1. TESTE !restart
  console.log('\n--- 1. Testando !restart ---');
  sentMessages = [];
  const cmdRestart = handler.findCommand('restart');
  assert(!!cmdRestart, 'Comando !restart registrado no Handler');
  const msgRestart = handler.smsg(mockConn, {
    key: { remoteJid: groupJid, participant: ownerJid },
    message: { conversation: '!restart' }
  });
  await cmdRestart.run(msgRestart, { text: '', whatsappBot });
  assert(sentMessages.some(m => m.content.text.includes('REINICIALIZAÇÃO DO BOT SOLICITADA')), '!restart executa e envia confirmação de reinicialização');

  // 2. TESTE !darpoder
  console.log('\n--- 2. Testando !darpoder ---');
  sentMessages = [];
  const cmdDarpoder = handler.findCommand('darpoder');
  assert(!!cmdDarpoder, 'Comando !darpoder registrado no Handler');
  assert(handler.findCommand('promover') === cmdDarpoder, 'Alias !promover aponta para !darpoder');
  assert(handler.findCommand('daradmin') === cmdDarpoder, 'Alias !daradmin aponta para !darpoder');

  const msgDarpoder = handler.smsg(mockConn, {
    key: { remoteJid: groupJid, participant: ownerJid },
    message: { conversation: '!darpoder 5511999991111' }
  });
  await cmdDarpoder.run(msgDarpoder, {
    conn: mockConn,
    args: ['5511999991111'],
    text: '5511999991111',
    usedPrefix: '!',
    isBotAdmin: true,
    isAdmin: true
  });
  assert(sentMessages.some(m => (m.content.text.includes('PODER DE ADMINISTRADOR CONCEDIDO') || m.content.text.includes('ADMINISTRADOR PROMOVIDO')) && m.content.text.includes('5511999991111')), '!darpoder promove participante e envia confirmação');

  // 3. TESTE !bemvindopv
  console.log('\n--- 3. Testando !bemvindopv ---');
  sentMessages = [];
  const cmdBemVindoPv = handler.findCommand('bemvindopv');
  assert(!!cmdBemVindoPv, 'Comando !bemvindopv registrado no Handler');

  // Ativa no grupo
  await spyFeatures.handleBemVindoPv(mockConn, groupJid, '!bemvindopv on', true);
  assert(models.getWelcomePv(groupJid).enabled === true, 'models: Boas-vindas PV ativado no grupo');
  assert(sentMessages.some(m => m.content.text.includes('BOAS-VINDAS NO PRIVADO (PV) ATIVADA')), '!bemvindopv on responde com sucesso');

  // 4. TESTE !legendabemvindopv
  console.log('\n--- 4. Testando !legendabemvindopv ---');
  sentMessages = [];
  const cmdLegendaPv = handler.findCommand('legendabemvindopv');
  assert(!!cmdLegendaPv, 'Comando !legendabemvindopv registrado no Handler');

  await spyFeatures.handleLegendaBemVindoPv(mockConn, groupJid, '!legendabemvindopv Olá #nome#, bem-vindo ao #grupo#! Regras: #desc#', true);
  const updatedPv = models.getWelcomePv(groupJid);
  assert(updatedPv.text.includes('bem-vindo ao #grupo#'), 'Legenda PV atualizada com sucesso no banco');
  assert(sentMessages.some(m => m.content.text.includes('LEGENDA DO BEM-VINDO NO PRIVADO ATUALIZADA')), '!legendabemvindopv responde com confirmação');

  // Teste evento de entrada disparando Boas-Vindas no PV
  sentMessages = [];
  await spyFeatures.checkWelcomePvEntry(mockConn, groupJid, ['5511999991111@s.whatsapp.net']);
  assert(sentMessages.some(m => m.jid === '5511999991111@s.whatsapp.net' && (m.content.text || m.content.caption || '').includes('Grupo Teste VIP')), 'checkWelcomePvEntry envia mensagem personalizada no PV do membro');
  assert(sentMessages.some(m => m.jid === '5511999991111@s.whatsapp.net' && Buffer.isBuffer(m.content.image)), 'checkWelcomePvEntry envia cartão de imagem/SVG personalizado no PV');

  // 5. TESTE !configpv
  console.log('\n--- 5. Testando !configpv ---');
  sentMessages = [];
  const cmdConfigPv = handler.findCommand('configpv');
  assert(!!cmdConfigPv, 'Comando !configpv registrado no Handler');
  await spyFeatures.handleConfigPv(mockConn, groupJid, true, true);
  assert(sentMessages.some(m => m.content.text.includes('PAINEL DE CONFIGURAÇÕES DO PRIVADO (PV)') && m.content.text.includes('Anti-Privado') && m.content.text.includes('Anti-Chamada')), '!configpv exibe painel completo de opções do privado');

  // 6. TESTE !antichamada
  console.log('\n--- 6. Testando !antichamada ---');
  sentMessages = [];
  const cmdAntiChamada = handler.findCommand('antichamada');
  assert(!!cmdAntiChamada, 'Comando !antichamada registrado no Handler');

  await spyFeatures.handleAntiChamada(mockConn, groupJid, '!antichamada on', true);
  assert(models.isAntiChamadaActive() === true, 'Anti-chamada ativado no models e global.opts');
  assert(sentMessages.some(m => m.content.text.includes('ANTI-CHAMADA ATIVADO COM SUCESSO')), '!antichamada on responde com confirmação');

  // Teste evento Baileys de chamada recebida
  sentMessages = [];
  await spyFeatures.handleCallEvents(mockConn, [{ id: 'CALL_123', from: '5511999998888@s.whatsapp.net', status: 'offer' }]);
  assert(sentMessages.some(m => m.content.text.includes('CHAMADA RECUSADA AUTOMATICAMENTE')), 'handleCallEvents rejeita chamada e avisa o autor');

  // 7. TESTE !antipv
  console.log('\n--- 7. Testando !antipv ---');
  sentMessages = [];
  const cmdAntiPv = handler.findCommand('antipv');
  assert(!!cmdAntiPv, 'Comando !antipv registrado no Handler');

  const msgAntiPv = handler.smsg(mockConn, {
    key: { remoteJid: groupJid, participant: ownerJid },
    message: { conversation: '!antipv on' }
  });
  await cmdAntiPv.run(msgAntiPv, { text: 'on', isOwner: true, isAdmin: true, usedPrefix: '!' });
  assert(models.getSetting('ANTIPRIVADO_GLOBAL') === 'true', 'Anti-privado ativado globalmente');
  assert(sentMessages.some(m => m.content.text.includes('ANTI-PRIVADO ATIVADO')), '!antipv on responde com confirmação');

  // Limpa o estado para não deixar o Anti-Privado ativo no banco real após os testes
  await cmdAntiPv.run(msgAntiPv, { text: 'off', isOwner: true, isAdmin: true, usedPrefix: '!' });
  assert(models.getSetting('ANTIPRIVADO_GLOBAL') === 'false', 'Anti-privado restaurado para off após o teste');

  // 8. TESTE !antifake
  console.log('\n--- 8. Testando !antifake ---');
  sentMessages = [];
  const cmdAntiFake = handler.findCommand('antifake');
  assert(!!cmdAntiFake, 'Comando !antifake registrado no Handler');

  const msgAntiFake = handler.smsg(mockConn, {
    key: { remoteJid: groupJid, participant: ownerJid },
    message: { conversation: '!antifake on' }
  });
  await cmdAntiFake.run(msgAntiFake, { text: 'on', usedPrefix: '!' });
  assert(models.getSetting(`ANTIFAKE_${groupJid}`) === 'true', 'Anti-fake ativado para o grupo');

  // Teste de varredura antifake
  sentMessages = [];
  await cmdAntiFake.run(msgAntiFake, { conn: mockConn, text: 'varrer', usedPrefix: '!' });
  assert(sentMessages.some(m => m.content.text.includes('VARREDURA ANTI-FAKE') && m.content.text.includes('Expulsos')), '!antifake varrer identifica e expulsa estrangeiros');

  // Restaura antifake do grupo de teste
  await cmdAntiFake.run(msgAntiFake, { text: 'off', usedPrefix: '!' });

  // 9. TESTE !antiddd
  console.log('\n--- 9. Testando !antiddd ---');
  sentMessages = [];
  const cmdAntiDDD = handler.findCommand('antiddd');
  assert(!!cmdAntiDDD, 'Comando !antiddd registrado no Handler');

  // Adiciona DDD 21 à restrição
  await spyFeatures.handleAntiDDD(mockConn, groupJid, '!antiddd add 21', true);
  let dddConfig = models.getGroupAntiDDD(groupJid);
  assert(dddConfig.enabled === true && dddConfig.list.includes('21'), 'DDD 21 adicionado com sucesso');

  // Teste interceptação de novo membro com DDD 21
  sentMessages = [];
  await spyFeatures.checkAntiDDDEntry(mockConn, groupJid, ['5521999992222@s.whatsapp.net']);
  assert(sentMessages.some(m => m.content.text.includes('ANTI-DDD ATIVADO') && m.content.text.includes('(21)')), 'checkAntiDDDEntry detecta DDD restrito e expulsa participante');

  // 10. TESTE !regras
  console.log('\n--- 10. Testando !regras ---');
  sentMessages = [];
  const cmdRegras = handler.findCommand('regras');
  assert(!!cmdRegras, 'Comando !regras registrado no Handler');

  // Sem regras cadastradas -> usa descrição do grupo
  await spyFeatures.handleRegras(mockConn, groupJid);
  assert(sentMessages.some(m => m.content.text.includes('REGRAS OFICIAIS DO GRUPO') && m.content.text.includes('Proibido links')), '!regras exibe regras / descrição do grupo');

  // 11. TESTE !d (Deletar mensagem)
  console.log('\n--- 11. Testando !d ---');
  sentMessages = [];
  const cmdD = handler.findCommand('d');
  assert(!!cmdD, 'Comando !d registrado no Handler');
  assert(handler.findCommand('del') === cmdD, 'Alias !del aponta para !d');
  assert(handler.findCommand('delete') === cmdD, 'Alias !delete aponta para !d');

  let deletedCalled = false;
  const msgD = {
    chat: groupJid,
    isGroup: true,
    quoted: {
      id: 'MSG_TO_DELETE_001',
      async delete() {
        deletedCalled = true;
        return true;
      }
    },
    async delete() { return true; },
    reply: (t) => mockConn.sendMessage(groupJid, { text: t })
  };
  await cmdD.run(msgD, { conn: mockConn, isAdmin: true, isOwner: true, isBotAdmin: true });
  assert(deletedCalled === true, '!d apaga a mensagem citada com sucesso');

  // 12. TESTE !limparcache
  console.log('\n--- 12. Testando !limparcache ---');
  sentMessages = [];
  const cmdLimparCache = handler.findCommand('limparcache');
  assert(!!cmdLimparCache, 'Comando !limparcache registrado no Handler');

  await spyFeatures.handleLimparCache(mockConn, groupJid, true, handler);
  assert(sentMessages.some(m => m.content.text.includes('CACHE DO BOT LIMPO COM SUCESSO') && m.content.text.includes('Memória RAM')), '!limparcache libera memória e confirma limpeza');

  // 13. TESTE !server
  console.log('\n--- 13. Testando !server ---');
  sentMessages = [];
  const cmdServer = handler.findCommand('server');
  assert(!!cmdServer, 'Comando !server registrado no Handler');

  await spyFeatures.handleServerStatus(mockConn, groupJid);
  assert(sentMessages.some(m => m.content.text.includes('DIAGNÓSTICO DO SERVIDOR & BOT') && m.content.text.includes('Processador') && m.content.text.includes('Memória RAM Servidor')), '!server exibe diagnósticos completos de hardware e sistema');

  // 14. TESTE !pix
  console.log('\n--- 14. Testando !pix ---');
  sentMessages = [];
  const cmdPix = handler.findCommand('pix');
  assert(!!cmdPix, 'Comando !pix registrado no Handler');

  // Chamada com valor
  await spyFeatures.handleWhatsAppCobranca(mockConn, groupJid, '!pix 49.90', null, true, '5511999991111', 'Comprador Teste');
  assert(sentMessages.some(m => m.content.text.includes('PIX') && m.content.text.includes('49.90')), '!pix 49.90 gera cobrança Pix expressa com Copia e Cola');

  // 15. TESTE !usdt
  console.log('\n--- 15. Testando !usdt ---');
  sentMessages = [];
  const cmdUsdt = handler.findCommand('usdt');
  assert(!!cmdUsdt, 'Comando !usdt registrado no Handler');

  // Consulta sem argumentos
  await spyFeatures.handleUsdt(mockConn, groupJid, '!usdt', '5511999991111', 'Comprador Cripto', true);
  assert(sentMessages.some(m => m.content.text.includes('PAGAMENTO EM USDT / CRIPTO') && m.content.text.includes('TRC-20')), '!usdt sem argumentos exibe carteiras oficiais');

  // Geração com valor
  sentMessages = [];
  await spyFeatures.handleUsdt(mockConn, groupJid, '!usdt 25 trc20', '5511999991111', 'Comprador Cripto', true);
  assert(sentMessages.some(m => m.content.text.includes('COBRANÇA USDT EXPRESS GERADA') && m.content.text.includes('25.00 USDT')), '!usdt 25 gera cobrança expressa com endereço de carteira');

  // 16. TESTE !simi
  console.log('\n--- 16. Testando !simi ---');
  sentMessages = [];
  const cmdSimi = handler.findCommand('simi');
  assert(!!cmdSimi, 'Comando !simi registrado no Handler');

  // Toggle on
  await spyFeatures.handleSimi(mockConn, groupJid, '!simi on', 'Amigo', true);
  assert(models.isSimiActiveInChat(groupJid) === true, '!simi on ativa o modo auto-chat no grupo');
  assert(sentMessages.some(m => m.content.text.includes('SIMSIMI ATIVADO')), '!simi on confirma ativação');

  // Bate-papo direto
  sentMessages = [];
  await spyFeatures.handleSimi(mockConn, groupJid, '!simi olá como vai você', 'Amigo', true);
  assert(sentMessages.some(m => m.content.text.includes('SimSimi') || m.content.text.includes('🐥')), '!simi <texto> gera resposta inteligente do SimSimi');

  console.log('\n======================================================');
  console.log(`🎉 TODOS OS 16 COMANDOS TESTADOS: ${passedTests}/${totalTests} PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

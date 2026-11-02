/**
 * test_verificado_fake_zapvoice_menuadm.js
 * Teste completo e rigoroso das funcionalidades:
 * 1. Verificado Global (Gata Nina & SPY BOT)
 * 2. Comando /fake em Grupos (Criação de mensagens forjadas com Baileys Quoted)
 * 3. MenuAdm completo da Nazuna v4.0 (Ações administrativas, ban, kick, mute, limpar, sorteio, etc.)
 * 4. Proteções de grupo (antidoc, antiloc, antifig, soadm, muted_users, blacklist)
 * 5. ZapVoice 2025 (Mensagens Rápidas, Áudios PTT gravados na hora, Funis sequenciais, Gatilhos e Cockpit)
 * 6. Endpoints REST e Bot Deck Actions
 * 7. Isolamento de Segurança dos Dois Túneis (Porta 3001 bloqueia com 403)
 */

const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const db = require('./src/db/database');
const spyFeatures = require('./src/services/spyFeaturesService');
const zapVoiceService = require('./src/services/zapVoiceService');
const whatsappBot = require('./src/bots/whatsappBot');
const { createServer, createStoreServer } = require('./src/server/app');

process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 INICIANDO TESTES DO PACOTE VERIFICADO GLOBAL, FAKE, MENUADM & ZAPVOICE 2025');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`✅ [TESTE ${passed + failed}] ${name}`);
    } catch (err) {
      failed++;
      console.error(`❌ [TESTE ${passed + failed}] FALHOU: ${name}`);
      console.error(err);
    }
  }

  // ----------------------------------------------------
  // 1. VERIFICADO GLOBAL: PERSISTÊNCIA & CONFIGURAÇÃO
  // ----------------------------------------------------
  await test('Verificado Global: Ativação, desativação e configurações customizadas', async () => {
    // Configura ativo
    models.setVerificadoGlobal(true);
    assert.strictEqual(models.isVerificadoGlobal(), true);

    // Salva configuração customizada (usando parâmetros posicionais ou objeto)
    models.setVerificadoConfig('Antigravity Tech Studio ✓', 'Canal Oficial Verificado 🟢', true);
    const cfg = models.getVerificadoConfig();
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.title, 'Antigravity Tech Studio ✓');
    assert.strictEqual(cfg.body, 'Canal Oficial Verificado 🟢');
    assert.strictEqual(cfg.show_ad, true);

    // Desativa
    models.setVerificadoGlobal(false);
    assert.strictEqual(models.isVerificadoGlobal(), false);
  });

  // ----------------------------------------------------
  // 2. VERIFICADO GLOBAL: INJEÇÃO DE METADADOS EM MENSAGENS OUTBOUND (BAILEYS MOCK)
  // ----------------------------------------------------
  await test('Verificado Global: Injeção de selo oficial, externalAdReply e fake quoted 0@s.whatsapp.net', async () => {
    models.setVerificadoGlobal(true);
    models.setVerificadoConfig('PayBot Oficial ✓', 'Canal Oficial Verificado 🟢', true);

    let sentPayload = null;
    let sentOptions = null;

    const mockSock = {
      user: { id: '5548999990000:1@s.whatsapp.net' },
      sendPresenceUpdate: async () => {},
      sendMessage: async (jid, payload, opts) => {
        sentPayload = payload;
        sentOptions = opts;
        return { key: { id: 'MSG_123' } };
      }
    };

    const targetJid = '5511999998888@s.whatsapp.net';
    const ok = await whatsappBot.sendMessage(targetJid, 'Olá! Teste de verificado global.', {}, mockSock);

    assert.strictEqual(ok, true);
    assert.ok(sentPayload);
    assert.strictEqual(sentPayload.text, 'Olá! Teste de verificado global.');

    // Verifica se os metadados do selo foram injetados no options e payload
    assert.strictEqual(sentOptions.contextInfo.forwardingScore, 999);
    assert.strictEqual(sentOptions.contextInfo.isForwarded, true);
    assert.strictEqual(sentOptions.contextInfo.externalAdReply.title, 'PayBot Oficial ✓');
    assert.strictEqual(sentOptions.contextInfo.externalAdReply.body, 'Canal Oficial Verificado 🟢');
    assert.strictEqual(sentOptions.contextInfo.externalAdReply.showAdAttribution, true);

    // Verifica o quoted oficial fake do WhatsApp (0@s.whatsapp.net)
    assert.ok(sentOptions.quoted);
    assert.strictEqual(sentOptions.quoted.key.participant, '0@s.whatsapp.net');

    // Desativa para não afetar os próximos testes
    models.setVerificadoGlobal(false);
  });

  // ----------------------------------------------------
  // 3. COMANDO /fake E !fake EM GRUPOS
  // ----------------------------------------------------
  await test('Comando /fake: Criação de resposta forjada com Baileys Quoted de outro participante', async () => {
    let fakeDispatched = null;

    const mockSock = {
      sendMessage: async (jid, payload, opts) => {
        fakeDispatched = { jid, payload, opts };
        return { key: { id: 'FAKE_MSG_999' } };
      }
    };

    const groupJid = '120363099999999999@g.us';
    const sender = '5511999990001@s.whatsapp.net';

    // 3.1 Sintaxe com menção: /fake @5511988887777 Eu autorizo a compra | Perfeito, pedido aprovado!
    const body1 = '/fake @5511988887777 Eu autorizo a compra | Perfeito, pedido aprovado!';
    const res1 = await spyFeatures.handleFakeCommand(mockSock, groupJid, body1, null, sender);
    assert.ok(res1);
    assert.ok(fakeDispatched);
    assert.strictEqual(fakeDispatched.jid, groupJid);
    assert.strictEqual(fakeDispatched.payload.text, 'Perfeito, pedido aprovado!');
    assert.ok(fakeDispatched.opts?.quoted);
    assert.strictEqual(fakeDispatched.opts.quoted.key.participant, '5511988887777@s.whatsapp.net');
    assert.strictEqual(fakeDispatched.opts.quoted.key.fromMe, false);
    assert.strictEqual(fakeDispatched.opts.quoted.message.conversation, 'Eu autorizo a compra');

    // 3.2 Sintaxe com número direto: !fake 5548987654321 Aceito o orçamento de R$ 5000 | Ótimo, contrato gerado!
    const body2 = '!fake 5548987654321 Aceito o orçamento de R$ 5000 | Ótimo, contrato gerado!';
    const res2 = await spyFeatures.handleFakeCommand(mockSock, groupJid, body2, null, sender);
    assert.ok(res2);
    assert.strictEqual(fakeDispatched.payload.text, 'Ótimo, contrato gerado!');
    assert.strictEqual(fakeDispatched.opts.quoted.key.participant, '5548987654321@s.whatsapp.net');
    assert.strictEqual(fakeDispatched.opts.quoted.message.conversation, 'Aceito o orçamento de R$ 5000');
  });

  // ----------------------------------------------------
  // 4. MENUADM NAZUNA v4.0: RENDERIZAÇÃO DO MENU COMPLETO E PROTEÇÃO
  // ----------------------------------------------------
  await test('MenuAdm Nazuna: Renderização do menu administrativo completo e bloqueio em PV', async () => {
    let sentMenu = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMenu = content.text;
        return { key: { id: 'MENU_RESP' } };
      }
    };

    const groupJid = '120363099999999999@g.us';

    // 4.1 Teste de proteção: chamada em PV via whatsappBot deve recusar
    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5511999990001@s.whatsapp.net', fromMe: false },
      message: { conversation: '!menuadm' }
    }, mockSock);
    assert.ok(sentMenu && sentMenu.includes('dentro de grupos'));

    // 4.2 Renderização direta do MenuAdm
    sentMenu = null;
    await spyFeatures.handleMenuAdm(mockSock, groupJid, 'PayBot Oficial', 'Administrador', '!');
    assert.ok(sentMenu);
    assert.ok(sentMenu.includes('ADMINISTRAÇÃO'));
    assert.ok(sentMenu.includes('!ban'));
    assert.ok(sentMenu.includes('!promover'));
    assert.ok(sentMenu.includes('!rebaixar'));
    assert.ok(sentMenu.includes('!mute'));
    assert.ok(sentMenu.includes('!desmute'));
    assert.ok(sentMenu.includes('!limpar'));
    assert.ok(sentMenu.includes('!sorteio'));
    assert.ok(sentMenu.includes('!banghost'));
    assert.ok(sentMenu.includes('!hidetag'));
    assert.ok(sentMenu.includes('!marcar'));
    assert.ok(sentMenu.includes('!linkgp'));
    assert.ok(sentMenu.includes('!grupo a'));
    assert.ok(sentMenu.includes('!setname'));
    assert.ok(sentMenu.includes('!setdesc'));
    assert.ok(sentMenu.includes('!addregra'));
    assert.ok(sentMenu.includes('!regras'));
    assert.ok(sentMenu.includes('!blockcmd'));
    assert.ok(sentMenu.includes('!antidoc'));
    assert.ok(sentMenu.includes('!antiloc'));
    assert.ok(sentMenu.includes('!antifig'));
    assert.ok(sentMenu.includes('!antipt'));
    assert.ok(sentMenu.includes('!soadm'));
    assert.ok(sentMenu.includes('blacklist'));
  });

  // ----------------------------------------------------
  // 5. AÇÕES ADMINISTRATIVAS NAZUNA (Promote, Demote, Kick, Grupo A/F, LinkGP, Sorteio, Banghost)
  // ----------------------------------------------------
  await test('Ações Administrativas Nazuna: Execução de comandos do MenuAdm', async () => {
    let updateAction = null;
    let groupSettingAction = null;
    let groupSubjectAction = null;
    let groupDescAction = null;
    let groupInviteCalled = false;
    let lastSent = null;

    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        updateAction = { jid, participants, action };
      },
      groupSettingUpdate: async (jid, action) => {
        groupSettingAction = { jid, action };
      },
      groupUpdateSubject: async (jid, subject) => {
        groupSubjectAction = { jid, subject };
      },
      groupUpdateDescription: async (jid, desc) => {
        groupDescAction = { jid, desc };
      },
      groupInviteCode: async (jid) => {
        groupInviteCalled = true;
        return 'ABC123InviteCode';
      },
      sendMessage: async (jid, content) => {
        lastSent = content.text;
      }
    };

    const groupJid = '120363099999999999@g.us';
    const mockMetadata = {
      id: groupJid,
      subject: 'Grupo Teste Tech',
      desc: 'Descrição atual',
      participants: [
        { id: '5511999990001@s.whatsapp.net', admin: 'superadmin' },
        { id: '5511999990002@s.whatsapp.net', admin: null },
        { id: '5511999990003@s.whatsapp.net', admin: null }
      ]
    };

    // 5.1 Promover membro
    await spyFeatures.handlePromote(mockSock, groupJid, '5511999990002@s.whatsapp.net', true, true);
    assert.strictEqual(updateAction.action, 'promote');
    assert.deepStrictEqual(updateAction.participants, ['5511999990002@s.whatsapp.net']);

    // 5.2 Rebaixar membro
    await spyFeatures.handleDemote(mockSock, groupJid, '5511999990002@s.whatsapp.net', true, true);
    assert.strictEqual(updateAction.action, 'demote');

    // 5.3 Kick / Remover
    await spyFeatures.handleKick(mockSock, groupJid, '5511999990003@s.whatsapp.net', true, true);
    assert.strictEqual(updateAction.action, 'remove');

    // 5.4 Abrir e Fechar Grupo
    await spyFeatures.handleGrupoStatus(mockSock, groupJid, 'fechar', true, true);
    assert.strictEqual(groupSettingAction.action, 'announcement');
    await spyFeatures.handleGrupoStatus(mockSock, groupJid, 'abrir', true, true);
    assert.strictEqual(groupSettingAction.action, 'not_announcement');

    // 5.5 Link do Grupo
    await spyFeatures.handleLinkGp(mockSock, groupJid, true, true);
    assert.strictEqual(groupInviteCalled, true);
    assert.ok(lastSent.includes('chat.whatsapp.com/ABC123InviteCode'));

    // 5.6 Alterar Nome e Descrição
    await spyFeatures.handleSetName(mockSock, groupJid, 'Novo Nome Incrível', true, true);
    assert.strictEqual(groupSubjectAction.subject, 'Novo Nome Incrível');
    await spyFeatures.handleSetDesc(mockSock, groupJid, 'Nova Descrição Oficial', true, true);
    assert.strictEqual(groupDescAction.desc, 'Nova Descrição Oficial');

    // 5.7 Sorteio de Membro
    await spyFeatures.handleSorteio(mockSock, groupJid, '!sorteio VIP Discord | 1', mockMetadata, true);
    assert.ok(lastSent.includes('PARABÉNS AOS GANHADORES'));

    // 5.8 Banghost (Varredura de fantasmas / inativos)
    await spyFeatures.handleBanghost(mockSock, groupJid, mockMetadata, true, true);
    assert.ok(lastSent.includes('VARREDURA DE MEMBROS FANTASMAS'));
  });

  // ----------------------------------------------------
  // 6. SISTEMA DE MUTE, REGRAS E BLOQUEIO DE COMANDOS POR GRUPO
  // ----------------------------------------------------
  await test('Mute, Regras e Bloqueio de Comandos por Grupo no Banco de Dados', async () => {
    const groupJid = '120363077777777777@g.us';
    const targetUser = '5511988881234';

    // Garante estado limpo inicial
    models.unblockCommand(groupJid, 'fig');
    models.unmuteUser(groupJid, targetUser);

    // 6.1 Mute
    assert.strictEqual(models.isUserMuted(groupJid, targetUser), false);
    models.muteUser(groupJid, targetUser);
    assert.strictEqual(models.isUserMuted(groupJid, targetUser), true);
    const mutedList = models.listMutedUsers(groupJid);
    assert.ok(mutedList.includes(targetUser));

    models.unmuteUser(groupJid, targetUser);
    assert.strictEqual(models.isUserMuted(groupJid, targetUser), false);

    // 6.2 Bloqueio de comando específico por grupo
    assert.strictEqual(models.isCommandBlocked(groupJid, 'fig'), false);
    models.blockCommand(groupJid, 'fig');
    assert.strictEqual(models.isCommandBlocked(groupJid, 'fig'), true);
    const blockedList = models.listBlockedCommands(groupJid);
    assert.ok(blockedList.includes('fig'));

    models.unblockCommand(groupJid, 'fig');
    assert.strictEqual(models.isCommandBlocked(groupJid, 'fig'), false);

    // 6.3 Regras do Grupo
    models.setGroupRules(groupJid, '1. Proibido spam\n2. Respeitar todos os membros\n3. Compras apenas com o bot oficial');
    const rules = models.getGroupRules(groupJid);
    assert.ok(rules.includes('Proibido spam'));
    assert.ok(rules.includes('Compras apenas com o bot oficial'));
  });

  // ----------------------------------------------------
  // 7. BLACKLIST GLOBAL COM AUTO-BAN NA ENTRADA DO GRUPO
  // ----------------------------------------------------
  await test('Blacklist Global de Números: Adição, verificação e auto-expulsão ao entrar no grupo', async () => {
    const badNumber = '5511999990666';
    models.removeNumberBlacklist(badNumber);
    assert.strictEqual(models.isNumberBlacklisted(badNumber), false);

    models.addNumberBlacklist(badNumber, 'Golpista e spammer recorrente', 'admin-unit');
    assert.strictEqual(models.isNumberBlacklisted(badNumber), true);
    const blList = models.listBlacklist();
    assert.ok(blList.includes(badNumber));

    // Simula evento Baileys de entrada do participante na lista negra
    let kickCalled = false;
    const mockSock = {
      groupParticipantsUpdate: async (jid, participants, action) => {
        if (action === 'remove' && participants.includes(`${badNumber}@s.whatsapp.net`)) {
          kickCalled = true;
        }
      },
      sendMessage: async () => {}
    };

    await whatsappBot.handleGroupParticipantsUpdate({
      id: '120363099999999999@g.us',
      participants: [`${badNumber}@s.whatsapp.net`],
      action: 'add'
    }, mockSock);

    assert.strictEqual(kickCalled, true, 'Participante na blacklist deve ser expulso imediatamente ao entrar no grupo');

    models.removeNumberBlacklist(badNumber);
    assert.strictEqual(models.isNumberBlacklisted(badNumber), false);
  });

  // ----------------------------------------------------
  // 8. INTERCEPTORES DE PROTEÇÃO DE MENSAGENS (Mute, Antidoc, Antiloc, Antifig, Soadm)
  // ----------------------------------------------------
  await test('Interceptores de Mensagens: Muted user, Anti-Doc, Anti-Loc e Anti-Fig', async () => {
    const groupJid = '120363066666666666@g.us';
    const mutedSender = '5511977778888';

    // 8.1 Mensagem de usuário mutado deve ser deletada
    models.muteUser(groupJid, mutedSender);
    let deletedKey = null;

    const mockSock = {
      sendMessage: async (jid, content) => {
        if (content.delete) deletedKey = content.delete;
        return { key: { id: 'RESP_1' } };
      }
    };

    const msgFromMuted = {
      key: { remoteJid: groupJid, participant: `${mutedSender}@s.whatsapp.net`, id: 'MSG_MUTED_1', fromMe: false },
      message: { conversation: 'Tentando falar enquanto estou mutado!' }
    };

    await whatsappBot.handleIncomingMessage(msgFromMuted, mockSock);
    assert.ok(deletedKey);
    assert.strictEqual(deletedKey.id, 'MSG_MUTED_1');

    // 8.2 Proteção Anti-Documento (antidoc_enabled = 1)
    models.unmuteUser(groupJid, mutedSender);
    models.updateGroupProtection(groupJid, { antidoc_enabled: 1 });
    deletedKey = null;

    const msgWithDoc = {
      key: { remoteJid: groupJid, participant: '5511966665555@s.whatsapp.net', id: 'MSG_DOC_1', fromMe: false },
      message: { documentMessage: { fileName: 'malware.exe' } }
    };
    await whatsappBot.handleIncomingMessage(msgWithDoc, mockSock);
    assert.ok(deletedKey);
    assert.strictEqual(deletedKey.id, 'MSG_DOC_1');

    // 8.3 Proteção Anti-Figurinha (antifig_enabled = 1)
    models.updateGroupProtection(groupJid, { antidoc_enabled: 0, antifig_enabled: 1 });
    deletedKey = null;

    const msgWithSticker = {
      key: { remoteJid: groupJid, participant: '5511966665555@s.whatsapp.net', id: 'MSG_STICKER_1', fromMe: false },
      message: { stickerMessage: {} }
    };
    await whatsappBot.handleIncomingMessage(msgWithSticker, mockSock);
    assert.ok(deletedKey);
    assert.strictEqual(deletedKey.id, 'MSG_STICKER_1');

    // Restaura proteções
    models.updateGroupProtection(groupJid, { antifig_enabled: 0 });
  });

  // ----------------------------------------------------
  // 9. ZAPVOICE 2025: VARIÁVEIS DINÂMICAS & MENSAGENS RÁPIDAS
  // ----------------------------------------------------
  await test('ZapVoice 2025: Substituição de variáveis dinâmicas e gerenciamento de mensagens rápidas', async () => {
    // 9.1 Teste do formatador de variáveis
    const template = '{saudacao}, {primeiro_nome}! Seu link de proposta técnica é: {link_proposta}. Valor: {valor}. Chave: {chave_pix}';
    const parsed = zapVoiceService.replaceVariables(template, {
      fullName: 'Carlos Eduardo Oliveira',
      proposalLink: 'https://painel.tech/p/789',
      value: 'R$ 4.500,00',
      pixKey: 'pix@empresa.com'
    });

    assert.ok(parsed.includes('Carlos!'));
    assert.ok(parsed.includes('Bom dia') || parsed.includes('Boa tarde') || parsed.includes('Boa noite'));
    assert.ok(parsed.includes('https://painel.tech/p/789'));
    assert.ok(parsed.includes('R$ 4.500,00'));
    assert.ok(parsed.includes('pix@empresa.com'));

    // 9.2 CRUD de Mensagens Rápidas
    const createdMsg = models.saveZapVoiceMessage({
      title: 'Tabela de Preços Consultoria Tech',
      shortcut: '/consultoria',
      content: '{saudacao}, {nome}! O valor da consultoria é {valor}.',
      category: 'Vendas'
    });
    assert.ok(createdMsg.id);

    const matchMsg = zapVoiceService.findMatchingQuickMessage('/consultoria', { fullName: 'Ana Paula', value: 'R$ 1.500,00' });
    assert.ok(matchMsg);
    assert.strictEqual(matchMsg.shortcut, '/consultoria');
    assert.ok(matchMsg.parsedContent.includes('Ana Paula!'));
    assert.ok(matchMsg.parsedContent.includes('R$ 1.500,00'));

    models.deleteZapVoiceMessage(createdMsg.id);
    const checkDeleted = models.getZapVoiceMessage(createdMsg.id);
    assert.strictEqual(checkDeleted, null);
  });

  // ----------------------------------------------------
  // 10. ZAPVOICE 2025: ÁUDIOS PTT HUMANIZADOS & FUNIS MULTI-ETAPAS
  // ----------------------------------------------------
  await test('ZapVoice 2025: Execução de funil sequencial com delay, simulação de gravação e PTT nativo', async () => {
    // Cria um funil de teste com 2 etapas:
    // Etapa 1: Texto introdutório
    // Etapa 2: Áudio PTT simulando gravação ao vivo ("gravado na hora")
    const funnel = models.saveZapVoiceFunnel({
      name: 'Funil Teste Fechamento Rápido',
      description: 'Funil de 2 etapas para fechamento tech',
      trigger_keywords: 'propostatech',
      active: 1
    });
    assert.ok(funnel.id);

    models.saveZapVoiceFunnelStep({
      funnel_id: funnel.id,
      step_order: 1,
      step_type: 'text',
      content: '{saudacao}, {primeiro_nome}! Gravei um áudio rápido explicando os detalhes do sistema.',
      delay_seconds: 0
    });

    models.saveZapVoiceFunnelStep({
      funnel_id: funnel.id,
      step_order: 2,
      step_type: 'audio_ptt',
      content: 'https://exemplo.com/audio-demo.ogg',
      delay_seconds: 0
    });

    const steps = models.getZapVoiceFunnelSteps(funnel.id);
    assert.strictEqual(steps.length, 2);

    // Mock do socket para registrar o envio de texto e presença de gravação PTT
    const dispatched = [];
    const presenceUpdates = [];

    const mockSock = {
      user: { id: '5548999990000:1@s.whatsapp.net' },
      sendPresenceUpdate: async (type, jid) => {
        presenceUpdates.push({ type, jid });
      },
      sendMessage: async (jid, payload) => {
        dispatched.push({ jid, payload });
        return { key: { id: 'STEP_MSG_' + Math.random() } };
      }
    };

    const targetLead = '5511988887777@s.whatsapp.net';
    const execResult = await zapVoiceService.executeFunnel(mockSock, funnel.id, targetLead, {
      fullName: 'Mariana Silva'
    });

    assert.strictEqual(execResult.success, true);
    assert.strictEqual(execResult.stepsExecuted, 2);

    // Verifica etapa 1 (Texto)
    assert.strictEqual(dispatched[0].payload.text.includes('Mariana!'), true);

    // Verifica etapa 2 (PTT com presença de gravação)
    assert.ok(presenceUpdates.some(p => p.type === 'recording'));
    assert.strictEqual(dispatched[1].payload.ptt, true);
    assert.strictEqual(dispatched[1].payload.mimetype, 'audio/ogg; codecs=opus');

    // Limpa funil de teste
    models.deleteZapVoiceFunnel(funnel.id);
  });

  // ----------------------------------------------------
  // 11. ZAPVOICE 2025: GATILHOS POR PALAVRA-CHAVE (TRIGGERS)
  // ----------------------------------------------------
  await test('ZapVoice 2025: Detecção e disparo por gatilhos de palavras-chave', async () => {
    // 11.1 Gatilho de Funil
    const funnelTriggerMatch = zapVoiceService.findMatchingTrigger('Olá gostaria de contratar um bot de vendas para o meu grupo');
    assert.ok(funnelTriggerMatch);
    assert.strictEqual(funnelTriggerMatch.type, 'funnel');
    assert.ok(funnelTriggerMatch.funnel);

    // 11.2 Gatilho de Mensagem Rápida
    const msg = models.saveZapVoiceMessage({
      title: 'Disparo Orçamento Web',
      shortcut: '/orcamentovip',
      trigger_keywords: 'cotacaoviptech',
      content: 'Olá! Recebi seu pedido de orçamento vip tech. Vamos conversar?',
      category: 'Gatilhos'
    });

    const triggerMatch = zapVoiceService.findMatchingTrigger('Olá gostaria de uma cotacaoviptech sob medida');
    assert.ok(triggerMatch);
    assert.strictEqual(triggerMatch.type, 'message');
    assert.strictEqual(triggerMatch.data.id, msg.id);

    models.deleteZapVoiceMessage(msg.id);
  });

  // ----------------------------------------------------
  // 12. ENDPOINTS REST & BOT DECK ACTIONS
  // ----------------------------------------------------
  await test('Endpoints REST e Bot Deck Actions: Verificado Global, Fake, MenuAdm e ZapVoice', async () => {
    const app = createServer();
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 12.1 Bot Deck: TOGGLE_VERIFICADO_GLOBAL
      const resToggle = await fetch(`${baseUrl}/api/botdeck/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TOGGLE_VERIFICADO_GLOBAL',
          payload: { enabled: true, title: 'Spy Bot Elite ✓', body: 'Verificado 2026' }
        })
      });
      const dataToggle = await resToggle.json();
      assert.strictEqual(dataToggle.success, true);
      assert.strictEqual(models.isVerificadoGlobal(), true);

      // 12.2 REST GET /api/features/verificado-global
      const resVerifGet = await fetch(`${baseUrl}/api/features/verificado-global`);
      const dataVerifGet = await resVerifGet.json();
      assert.strictEqual(dataVerifGet.success, true);
      assert.strictEqual(dataVerifGet.config.enabled, true);
      assert.strictEqual(dataVerifGet.config.title, 'Spy Bot Elite ✓');

      // 12.3 REST GET /api/zapvoice/messages
      const resZvMsgs = await fetch(`${baseUrl}/api/zapvoice/messages`);
      const dataZvMsgs = await resZvMsgs.json();
      assert.strictEqual(dataZvMsgs.success, true);
      assert.ok(Array.isArray(dataZvMsgs.messages));

      // 12.4 REST GET /api/zapvoice/funnels
      const resZvFunnels = await fetch(`${baseUrl}/api/zapvoice/funnels`);
      const dataZvFunnels = await resZvFunnels.json();
      assert.strictEqual(dataZvFunnels.success, true);
      assert.ok(Array.isArray(dataZvFunnels.funnels));

      // 12.5 REST GET /api/zapvoice/stats
      const resZvStats = await fetch(`${baseUrl}/api/zapvoice/stats`);
      const dataZvStats = await resZvStats.json();
      assert.strictEqual(dataZvStats.success, true);
      assert.ok(dataZvStats.stats.total_messages >= 0);

      // Desativa verificado
      models.setVerificadoGlobal(false);
    } finally {
      await new Promise(res => server.close(res));
    }
  });

  // ----------------------------------------------------
  // 13. ISOLAMENTO RÍGIDO DOS TÚNEIS: STORE TUNNEL BLOQUEIA ZAPVOICE & FEATURES COM 403
  // ----------------------------------------------------
  await test('Isolamento de Segurança: Túnel da Loja (createStoreServer) bloqueia /api/zapvoice e /api/features com 403 Forbidden', async () => {
    const storeApp = createStoreServer();
    const storeServer = http.createServer(storeApp);
    await new Promise(res => storeServer.listen(0, '127.0.0.1', res));
    const storePort = storeServer.address().port;
    const storeBase = `http://127.0.0.1:${storePort}`;

    try {
      // Tentativa de acessar ZapVoice no servidor público da loja deve receber 403
      const zvRes = await fetch(`${storeBase}/api/zapvoice/messages`);
      assert.strictEqual(zvRes.status, 403, 'Acesso a /api/zapvoice no túnel da loja DEVE retornar 403 Forbidden');
      const zvText = await zvRes.text();
      assert.ok(zvText.includes('403 Forbidden'));

      // Tentativa de acessar Features no servidor público da loja deve receber 403
      const featRes = await fetch(`${storeBase}/api/features/verificado-global`);
      assert.strictEqual(featRes.status, 403, 'Acesso a /api/features no túnel da loja DEVE retornar 403 Forbidden');

      // Tentativa de disparar fake via servidor da loja deve receber 403
      const fakeRes = await fetch(`${storeBase}/api/features/fake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetJid: '123@g.us', fakeSender: '456', fakeText: 'x', responseText: 'y' })
      });
      assert.strictEqual(fakeRes.status, 403, 'Acesso a /api/features/fake no túnel da loja DEVE retornar 403 Forbidden');

      // Acesso à loja pública continua 200 OK
      const storeRes = await fetch(`${storeBase}/api/store/products`);
      assert.strictEqual(storeRes.status, 200);
    } finally {
      await new Promise(res => storeServer.close(res));
    }
  });

  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES VERIFICADO, FAKE, MENUADM & ZAPVOICE:`);
  console.log(`====================================================`);
  console.log(`Total: ${passed + failed} | ✅ Sucesso: ${passed} | ❌ Falhas: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Erro fatal no runner de testes:', err);
  process.exit(1);
});

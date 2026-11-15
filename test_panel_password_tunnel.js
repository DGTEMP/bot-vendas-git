/**
 * test_panel_password_tunnel.js
 * Teste completo e rigoroso de solicitação do link Cloudflare Tunnel
 * via comando WhatsApp (!painel / !tunnel / !remoto) com senha mestra
 * a partir de qualquer outro número de telefone.
 */

const assert = require('assert');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const tunnelService = require('./src/services/tunnelService');

let passedTests = 0;
let totalTests = 0;

async function it(desc, fn) {
  totalTests++;
  try {
    try {
      const sub = require('./src/services/subbotPrivateFilterService');
      if (sub && sub.trippedCircuitBreakers) sub.trippedCircuitBreakers.clear();
      if (sub && sub.privateLoopTracker) sub.privateLoopTracker.clear();
      if (sub && sub.floodTracker) sub.floodTracker.clear();
    } catch (_) {}
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    throw err;
  }
}

(async () => {
  console.log('\n======================================================');
  console.log('🧪 TESTES: ACESSO AO TÚNEL DO PAINEL COM SENHA MESTRA');
  console.log('======================================================\n');

  const registeredOwner = '554884702848';
  const otherNumber = '5511977776666';
  const groupJid = '120363099999999999@g.us';

  function resetOwner() {
    models.setSetting('OWNER_PHONE', registeredOwner);
    models.setSetting('OWNER_WHATSAPP', registeredOwner);
    models.setSetting('ADMIN_PHONE', registeredOwner);
    models.setSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', registeredOwner);
    models.setSetting('PANEL_ADMIN_PASSWORD', 'paybot2026');
    models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
    if (typeof whatsappBot.invalidateOwnerCache === 'function') whatsappBot.invalidateOwnerCache();
  }

  // Inicializa configurações base
  resetOwner();

  tunnelService.adminUrl = 'https://paybot-admin-secure.trycloudflare.com';
  tunnelService.storeUrl = 'https://loja-publica-vitrine.trycloudflare.com';

  // --- 1. Testes de Validação de Senha ---
  console.log('--- 1. Validador isPanelPasswordValid ---');

  await it('Deve validar a senha padrão do banco (paybot2026)', () => {
    assert.strictEqual(whatsappBot.isPanelPasswordValid('paybot2026'), true);
    assert.strictEqual(whatsappBot.isPanelPasswordValid('  paybot2026  '), true);
  });

  await it('Deve rejeitar senhas incorretas ou vazias', () => {
    assert.strictEqual(whatsappBot.isPanelPasswordValid(''), false);
    assert.strictEqual(whatsappBot.isPanelPasswordValid(null), false);
    assert.strictEqual(whatsappBot.isPanelPasswordValid('senhaerrada'), false);
    assert.strictEqual(whatsappBot.isPanelPasswordValid('123456'), false);
  });

  await it('Deve validar senhas mestras de contingência (antigravity, paybot, telefone do dono)', () => {
    assert.strictEqual(whatsappBot.isPanelPasswordValid('antigravity'), true);
    assert.strictEqual(whatsappBot.isPanelPasswordValid('paybot'), true);
    assert.strictEqual(whatsappBot.isPanelPasswordValid(registeredOwner), true);
  });

  await it('Deve respeitar alteração de senha personalizada no banco', () => {
    models.setSetting('PANEL_ADMIN_PASSWORD', 'minha_senha_secreta_99');
    assert.strictEqual(whatsappBot.isPanelPasswordValid('minha_senha_secreta_99'), true);
    // Restaura padrão
    models.setSetting('PANEL_ADMIN_PASSWORD', 'paybot2026');
  });

  // --- 2. Testes com Dono Registrado ---
  console.log('\n--- 2. Acesso do Dono Registrado (554884702848) ---');

  await it('Dono enviando !painel sem senha deve receber o link do túnel imediatamente no PV', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_OWNER_PV' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${registeredOwner}@s.whatsapp.net`, fromMe: false },
      pushName: 'Dono Supremo',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(!sentMsg.includes('ACESSO NEGADO'), 'NUNCA deve negar acesso ao Dono');
    assert(sentMsg.includes('paybot-admin-secure.trycloudflare.com'), 'Deve conter a URL do admin tunnel');
    assert(sentMsg.includes('PAINEL WEB & ACESSO REMOTO'), 'Deve conter cabeçalho do painel');
  });

  await it('Dono enviando !painel em grupo deve receber o link no PV e notificação no grupo', async () => {
    let groupMsg = '';
    let pvMsg = '';
    let pvTarget = '';

    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        const txt = typeof content === 'string' ? content : (content.text || '');
        if (jid.endsWith('@g.us')) {
          groupMsg = txt;
        } else {
          pvTarget = jid;
          pvMsg = txt;
        }
        return { key: { id: 'TEST_OWNER_GRP' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: groupJid,
        participant: `${registeredOwner}@s.whatsapp.net`,
        fromMe: false
      },
      pushName: 'Dono Supremo',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(groupMsg.includes('WhatsApp Privado') || groupMsg.includes('Comandante'), `Aviso no grupo: ${groupMsg}`);
    assert(!groupMsg.includes('paybot-admin-secure.trycloudflare.com'), 'URL não pode vazar no grupo');
    assert(pvTarget.includes(registeredOwner), 'Destinatário do PV deve ser o Dono');
    assert(pvMsg.includes('paybot-admin-secure.trycloudflare.com'), 'PV deve conter link seguro');
  });

  // --- 3. Testes com Outro Número (Não-Dono) ---
  console.log('\n--- 3. Acesso de Outro Número de Telefone (Não-Dono) ---');

  await it('Outro número enviando !painel sem senha deve receber ACESSO NEGADO com instrução de senha', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_DENIED_NOPASS' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${otherNumber}@s.whatsapp.net`, fromMe: false },
      pushName: 'Outro Celular',
      message: { conversation: '!painel' }
    }, mockSock);

    assert(sentMsg.includes('ACESSO NEGADO'), `Deve conter ACESSO NEGADO: ${sentMsg}`);
    assert(sentMsg.includes('!painel <senha>') || sentMsg.includes('!tunnel <senha>'), `Deve orientar como digitar a senha: ${sentMsg}`);
  });

  await it('Outro número enviando !painel com senha incorreta deve receber ACESSO NEGADO: Senha incorreta', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_DENIED_WRONGPASS' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${otherNumber}@s.whatsapp.net`, fromMe: false },
      pushName: 'Outro Celular',
      message: { conversation: '!painel senhaerrada123' }
    }, mockSock);

    assert(sentMsg.includes('ACESSO NEGADO'), 'Deve conter ACESSO NEGADO');
    assert(sentMsg.toLowerCase().includes('senha incorreta'), `Deve indicar senha incorreta: ${sentMsg}`);
  });

  await it('Outro número enviando !painel paybot2026 no PV deve receber link seguro do túnel com sucesso', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_SUCCESS_PASS_PV' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${otherNumber}@s.whatsapp.net`, fromMe: false },
      pushName: 'Outro Celular',
      message: { conversation: '!painel paybot2026' }
    }, mockSock);

    assert(!sentMsg.includes('ACESSO NEGADO'), 'NÃO deve conter ACESSO NEGADO ao fornecer senha correta');
    assert(sentMsg.includes('paybot-admin-secure.trycloudflare.com'), 'Deve conter a URL do túnel do admin');
    assert(sentMsg.includes('Autenticação Mestra Remota Bem-Sucedida') || sentMsg.includes('PAINEL WEB & ACESSO REMOTO'), 'Deve confirmar autenticação');
    assert(sentMsg.includes('!souodono'), 'Deve incluir dica de como fixar como Dono com !souodono');
  });

  await it('Outro número enviando !tunnel paybot2026 deve funcionar com mesmo comportamento', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_SUCCESS_TUNNEL_ALIAS' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${otherNumber}@s.whatsapp.net`, fromMe: false },
      pushName: 'Outro Celular',
      message: { conversation: '!tunnel paybot2026' }
    }, mockSock);

    assert(sentMsg.includes('paybot-admin-secure.trycloudflare.com'), 'Deve entregar a URL com comando !tunnel');
  });

  await it('Outro número enviando !painel paybot2026 em grupo deve despachar link no PV para não expor no grupo', async () => {
    let groupMsg = '';
    let pvMsg = '';
    let pvTarget = '';

    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        const txt = typeof content === 'string' ? content : (content.text || '');
        if (jid.endsWith('@g.us')) {
          groupMsg = txt;
        } else {
          pvTarget = jid;
          pvMsg = txt;
        }
        return { key: { id: 'TEST_REMOTE_GRP' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: {
        remoteJid: groupJid,
        participant: `${otherNumber}@s.whatsapp.net`,
        fromMe: false
      },
      pushName: 'Outro Celular',
      message: { conversation: '!painel paybot2026' }
    }, mockSock);

    assert(!groupMsg.includes('ACESSO NEGADO'), 'Não deve negar');
    assert(!groupMsg.includes('paybot-admin-secure.trycloudflare.com'), 'URL confidencial NÃO pode ser enviada no grupo');
    assert(groupMsg.includes('WhatsApp Privado'), `Grupo deve avisar envio no PV: ${groupMsg}`);
    assert(pvTarget.includes(otherNumber), `Link deve ser enviado no PV do número solicitante: ${pvTarget}`);
    assert(pvMsg.includes('paybot-admin-secure.trycloudflare.com'), 'PV deve conter a URL');
  });

  // --- 4. Bypass Anti-Privado ---
  console.log('\n--- 4. Convivência com Anti-Privado Ativado ---');

  await it('!painel <senha> no privado NÃO deve ser bloqueado quando ANTIPRIVADO_GLOBAL estiver ativo', async () => {
    try {
      const sub = require('./src/services/subbotPrivateFilterService');
      if (sub && sub.trippedCircuitBreakers) sub.trippedCircuitBreakers.clear();
      if (sub && sub.privateLoopTracker) sub.privateLoopTracker.clear();
      if (sub && sub.floodTracker) sub.floodTracker.clear();
    } catch (_) {}
    models.setSetting('ANTIPRIVADO_GLOBAL', 'true');
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_ANTIPRIVADO_BYPASS' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: `${otherNumber}@s.whatsapp.net`, fromMe: false },
      pushName: 'Outro Celular',
      message: { conversation: '!painel paybot2026' }
    }, mockSock);

    assert(sentMsg.includes('paybot-admin-secure.trycloudflare.com'), `Mesmo com Anti-PV ligado, !painel com senha deve responder com link: ${sentMsg}`);
    models.setSetting('ANTIPRIVADO_GLOBAL', 'false');
  });

  // --- 5. Reivindicação de Titularidade (!souodono <senha>) ---
  console.log('\n--- 5. Promoção a Dono com !souodono <senha> ---');

  await it('!souodono sem senha de número não-dono deve ser negado', async () => {
    let sentMsg = '';
    const mockSock = {
      user: { id: '254102815766:56@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sentMsg = typeof content === 'string' ? content : (content.text || '');
        return { key: { id: 'TEST_SOUODONO_DENIED' } };
      }
    };

    await whatsappBot.handleIncomingMessage({
      key: { remoteJid: '5521999990000@s.whatsapp.net', fromMe: false },
      pushName: 'Invasor',
      message: { conversation: '!souodono' }
    }, mockSock);

    assert(sentMsg.includes('ACESSO NEGADO'), `Deve negar !souodono sem senha: ${sentMsg}`);
  });

  await it('!souodono paybot2026 deve promover o novo número a Dono Supremo', async () => {
    try {
      let sentMsg = '';
      const mockSock = {
        user: { id: '254102815766:56@s.whatsapp.net' },
        sendMessage: async (jid, content) => {
          sentMsg = typeof content === 'string' ? content : (content.text || '');
          return { key: { id: 'TEST_SOUODONO_SUCCESS' } };
        }
      };

      const newOwnerNumber = '5511999990099';
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: `${newOwnerNumber}@s.whatsapp.net`, fromMe: false },
        pushName: 'Novo Dono',
        message: { conversation: '!souodono paybot2026' }
      }, mockSock);

      assert(sentMsg.includes('COMANDANTE RECONHECIDO E REGISTRADO COM SUCESSO'), `Deve confirmar promoção: ${sentMsg}`);
      assert.strictEqual(models.getSetting('OWNER_PHONE'), newOwnerNumber, 'OWNER_PHONE deve ser atualizado no banco');

      // Agora o novo número é Dono e pode pedir !painel sem senha
      sentMsg = '';
      await whatsappBot.handleIncomingMessage({
        key: { remoteJid: `${newOwnerNumber}@s.whatsapp.net`, fromMe: false },
        pushName: 'Novo Dono',
        message: { conversation: '!painel' }
      }, mockSock);

      assert(!sentMsg.includes('ACESSO NEGADO'), 'Novo Dono não deve receber acesso negado');
      assert(sentMsg.includes('paybot-admin-secure.trycloudflare.com'), 'Novo Dono recebe a URL sem precisar da senha');
    } finally {
      resetOwner();
    }
  });

  console.log('\n======================================================');
  console.log(`🎉 TODOS OS ${passedTests}/${totalTests} TESTES PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
})();

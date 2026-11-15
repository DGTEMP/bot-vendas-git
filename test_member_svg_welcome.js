/**
 * =========================================================================
 * 🧪 TEST SUITE: MEMBER SVG WELCOME SYSTEM (PAYBOT TECH)
 * =========================================================================
 * Valida a criação de cartões vetoriais SVG personalizados para cada membro:
 * 1. Temas visuais suportados (Cyber, Gold, Aurora, Neon, Dark, Sunset)
 * 2. Geração da estrutura XML do SVG com dados do membro e escape seguro
 * 3. Fallback vetorial quando membro não possui foto
 * 4. Incorporação de foto real em Base64
 * 5. Conversão expressa SVG -> PNG de alta definição
 * 6. Persistência de configurações por grupo no banco de dados SQLite
 * 7. Execução dos comandos !welcomesvg, !testbv e !svgperfil
 * =========================================================================
 */

const assert = require('assert');
const memberSvgService = require('./src/services/memberSvgService');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');

async function runTests() {
  console.log('\n======================================================');
  console.log('🎨 INICIANDO TESTES DO SISTEMA DE SVG DE BOAS-VINDAS 🎨');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
    }
  }

  // 1. Verificação dos Temas
  console.log('--- 1. Temas Visuais Disponíveis ---');
  test('Retorna catálogo de 6 temas visuais', () => {
    const themes = memberSvgService.getThemes();
    assert.strictEqual(themes.length, 6);
    const ids = themes.map(t => t.id);
    assert.ok(ids.includes('cyber'));
    assert.ok(ids.includes('gold'));
    assert.ok(ids.includes('aurora'));
    assert.ok(ids.includes('neon'));
    assert.ok(ids.includes('dark'));
    assert.ok(ids.includes('sunset'));
  });

  // 2. Geração de SVG
  console.log('\n--- 2. Geração de SVG Vetorial Personalizado ---');
  test('Gera SVG válido com dados completos do membro', () => {
    const svg = memberSvgService.generateMemberWelcomeSvg({
      memberName: '@5511999998888',
      groupName: 'Clube dos Investidores VIP',
      memberNumber: '154',
      date: '05/11/2026',
      theme: 'cyber',
      customTitle: 'BEM-VINDO(A)'
    });

    assert.ok(typeof svg === 'string');
    assert.ok(svg.startsWith('<?xml version="1.0"'));
    assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.includes('viewBox="0 0 1200 630"'));
    assert.ok(svg.includes('@5511999998888'));
    assert.ok(svg.includes('Clube dos Investidores VIP'));
    assert.ok(svg.includes('Membro #154'));
    assert.ok(svg.includes('05/11/2026'));
  });

  test('Gera SVG com escape seguro para caracteres especiais (&, <, >, ", \')', () => {
    const svg = memberSvgService.generateMemberWelcomeSvg({
      memberName: 'Dev <Hacker> & "Trader"',
      groupName: 'Negócios & Cia <Tech>',
      memberNumber: '99',
      theme: 'gold'
    });

    assert.ok(svg.includes('Dev &lt;Hacker&gt; &amp; &quot;Trader&quot;'));
    assert.ok(svg.includes('Negócios &amp; Cia &lt;Tech&gt;'));
    assert.ok(!svg.includes('<Hacker>'));
  });

  test('Gera avatar vetorial decorativo quando membro não tem foto', () => {
    const svg = memberSvgService.generateMemberWelcomeSvg({
      memberName: 'Lucas Silva',
      theme: 'neon'
    });

    assert.ok(svg.includes('Fallback Vector Avatar'));
    assert.ok(svg.includes('url(#avatar-fallback-gradient)'));
    assert.ok(svg.includes('>L<')); // Monograma com a inicial
  });

  test('Embutimento de foto real do usuário em Data URI Base64', () => {
    const fakeBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const svg = memberSvgService.generateMemberWelcomeSvg({
      memberName: 'Mariana',
      avatarBase64: fakeBase64,
      theme: 'aurora'
    });

    assert.ok(svg.includes('<image href="data:image/png;base64,'));
    assert.ok(svg.includes('clip-path="url(#avatar-clip)"'));
  });

  // 3. Renderização SVG -> PNG
  console.log('\n--- 3. Renderização SVG -> PNG de Alta Resolução ---');
  await testAsync('Renderiza SVG para PNG Buffer com sucesso e cabeçalho válido', async () => {
    const svg = memberSvgService.generateMemberWelcomeSvg({
      memberName: '@5548999990000',
      groupName: 'Comunidade PayBot',
      memberNumber: '250',
      theme: 'sunset'
    });

    const t0 = Date.now();
    const pngBuffer = await memberSvgService.renderSvgToPng(svg);
    const duration = Date.now() - t0;

    assert.ok(Buffer.isBuffer(pngBuffer));
    assert.ok(pngBuffer.length > 50000, `Buffer muito pequeno: ${pngBuffer.length} bytes`);

    // Validação da assinatura mágica do arquivo PNG (0x89 0x50 0x4E 0x47)
    assert.strictEqual(pngBuffer[0], 0x89);
    assert.strictEqual(pngBuffer[1], 0x50); // P
    assert.strictEqual(pngBuffer[2], 0x4E); // N
    assert.strictEqual(pngBuffer[3], 0x47); // G

    console.log(`     (Tamanho: ${(pngBuffer.length / 1024).toFixed(1)} KB | Tempo: ${duration} ms)`);
  });

  // 4. Configurações por Grupo no Banco de Dados
  console.log('\n--- 4. Persistência de Configurações no Banco SQLite ---');
  test('Consulta e atualiza configurações de Card SVG por grupo', () => {
    const testGroupId = `test_group_${Date.now()}@g.us`;

    // Padrão
    assert.strictEqual(memberSvgService.isWelcomeSvgEnabled(testGroupId), true);
    assert.strictEqual(memberSvgService.getWelcomeSvgTheme(testGroupId), 'cyber');
    assert.strictEqual(memberSvgService.isWelcomeSvgDocEnabled(testGroupId), false);

    // Altera valores
    memberSvgService.setWelcomeSvgEnabled(testGroupId, false);
    assert.strictEqual(memberSvgService.isWelcomeSvgEnabled(testGroupId), false);

    memberSvgService.setWelcomeSvgTheme(testGroupId, 'gold');
    assert.strictEqual(memberSvgService.getWelcomeSvgTheme(testGroupId), 'gold');

    memberSvgService.setWelcomeSvgDocEnabled(testGroupId, true);
    assert.strictEqual(memberSvgService.isWelcomeSvgDocEnabled(testGroupId), true);

    memberSvgService.setWelcomeSvgTitle(testGroupId, 'NOVO MEMBRO VIP');
    assert.strictEqual(memberSvgService.getWelcomeSvgTitle(testGroupId), 'NOVO MEMBRO VIP');

    // models.getGroupSettings
    const settings = models.getGroupSettings('whatsapp', testGroupId);
    assert.strictEqual(settings.welcomeSvg, false);
    assert.strictEqual(settings.welcomeSvgTheme, 'gold');
    assert.strictEqual(settings.welcomeSvgDoc, true);

    // models.updateGroupSettings
    models.updateGroupSettings('whatsapp', testGroupId, {
      welcomeSvg: true,
      welcomeSvgTheme: 'neon',
      welcomeSvgDoc: false
    });
    assert.strictEqual(memberSvgService.isWelcomeSvgEnabled(testGroupId), true);
    assert.strictEqual(memberSvgService.getWelcomeSvgTheme(testGroupId), 'neon');
    assert.strictEqual(memberSvgService.isWelcomeSvgDocEnabled(testGroupId), false);
  });

  // 5. Método de Alto Nível createMemberWelcomeCard
  console.log('\n--- 5. Fluxo Completo createMemberWelcomeCard ---');
  await testAsync('Gera pacote completo com SVG, svgBuffer e pngBuffer', async () => {
    const card = await memberSvgService.createMemberWelcomeCard({
      memberPhone: '5511988887777',
      memberName: 'Carlos Teste',
      groupName: 'Grupo de Demonstração',
      memberNumber: '101',
      theme: 'cyber'
    });

    assert.ok(card.svg);
    assert.ok(Buffer.isBuffer(card.svgBuffer));
    assert.ok(Buffer.isBuffer(card.pngBuffer));
    assert.strictEqual(card.theme, 'cyber');
    assert.strictEqual(card.displayName, 'Carlos Teste');
  });

  // 6. Cartão de Identidade / Perfil SVG
  console.log('\n--- 6. Cartão de Identidade / Perfil SVG (!svgperfil) ---');
  await testAsync('Gera Cartão de Identidade / Perfil de Membro com sucesso', async () => {
    const profileCard = await memberSvgService.createMemberProfileCard({
      memberPhone: '5511999993333',
      memberName: 'Roberto Dono',
      role: '👑 PROPRIETÁRIO / DONO',
      theme: 'gold'
    });

    assert.ok(profileCard.svg.includes('CARTÃO DE PERFIL'));
    assert.ok(profileCard.svg.includes('PROPRIETÁRIO / DONO'));
    assert.ok(Buffer.isBuffer(profileCard.pngBuffer));
  });

  // 7. Teste dos Comandos de Chat
  console.log('\n--- 7. Comandos de Gerenciamento do Card SVG (!welcomesvg) ---');
  await testAsync('Executa !welcomesvg on/off/tema/test', async () => {
    const testGroup = '120363888888888888@g.us';
    const sentMessages = [];
    const mockSock = {
      sendMessage: async (jid, payload) => {
        sentMessages.push({ jid, payload });
        return { key: { id: 'MOCK_MSG_ID' } };
      },
      groupMetadata: async () => ({
        subject: 'Grupo Teste Comandos',
        participants: [{}, {}, {}]
      })
    };

    // Consulta painel
    await spyFeatures.handleWelcomeSvgCommand(mockSock, testGroup, '!welcomesvg', true);
    assert.ok(sentMessages.length > 0);
    assert.ok(sentMessages[sentMessages.length - 1].payload.text.includes('CONFIGURAÇÃO DO CARD SVG'));

    // Liga
    await spyFeatures.handleWelcomeSvgCommand(mockSock, testGroup, '!welcomesvg on', true);
    assert.ok(sentMessages[sentMessages.length - 1].payload.text.includes('ATIVADO'));
    assert.strictEqual(memberSvgService.isWelcomeSvgEnabled(testGroup), true);

    // Muda tema
    await spyFeatures.handleWelcomeSvgCommand(mockSock, testGroup, '!welcomesvg tema gold', true);
    assert.ok(sentMessages[sentMessages.length - 1].payload.text.includes('gold'));
    assert.strictEqual(memberSvgService.getWelcomeSvgTheme(testGroup), 'gold');

    // Desliga
    await spyFeatures.handleWelcomeSvgCommand(mockSock, testGroup, '!welcomesvg off', true);
    assert.ok(sentMessages[sentMessages.length - 1].payload.text.includes('DESATIVADO'));
    assert.strictEqual(memberSvgService.isWelcomeSvgEnabled(testGroup), false);

    // Teste de renderização via comando
    await spyFeatures.handleWelcomeSvgCommand(mockSock, testGroup, '!welcomesvg test', true, '5511999990000@s.whatsapp.net', 'Tester');
    const imageMsg = sentMessages.find(m => m.payload && m.payload.image);
    assert.ok(imageMsg, 'Deveria ter enviado mensagem com imagem');
    assert.ok(Buffer.isBuffer(imageMsg.payload.image));
  });

  console.log('\n======================================================');
  console.log(`🎉 TESTES FINALIZADOS: ${passed}/${total} PASSARAM COM SUCESSO!`);
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

/**
 * =========================================================================
 * 🧪 TEST SUITE: SUB-BOT MANDATORY AI KEYS & SWARM INTELLIGENCE
 * =========================================================================
 * Valida os novos fluxos:
 * 1. Sub-Bot sem chave de IA tem todos os comandos bloqueados com aviso de ativação
 * 2. Colar uma chave de API válida em qualquer conversa ativa o Sub-Bot e libera os 50 tokens garantidos
 * 3. Colar uma chave inválida é rejeitado com mensagem explicativa e mantém o bloqueio
 * 4. Revogação de chave inválida/expirada revoga o acesso imediatamente até regularização
 * 5. Garimpo do Enxame: Coleta de links de grupos de WhatsApp (chat.whatsapp.com)
 * 6. Garimpo do Enxame: Coleta de produtos relevantes conforme auge de repercussão (buzz)
 * 7. Garimpo do Enxame: Caçador de chaves de IA vazadas para o Mega-Pool do Master
 * 8. Comando !enxame e Endpoints REST /api/swarm/...
 * =========================================================================
 */

const assert = require('assert');
process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const aiManager = require('./src/services/aiManagerService');
const subbotTokenService = require('./src/services/subbotTokenService');
const swarmIntelligence = require('./src/services/swarmIntelligenceService');
const handler = require('./src/handler');

async function runTests() {
  console.log('=================================================================');
  console.log('🚀 INICIANDO TESTES DE CHAVES DE IA EM SUB-BOTS & ENXAME INTELIGENTE');
  console.log('=================================================================\n');

  const testSubbotId = 9888;
  const testGroup = '120363999999999999@g.us';
  const regularUser = '5511999998888@s.whatsapp.net';
  const ownerPhone = '554884702848';

  // Limpa estado anterior do subbot de teste
  models.setSubBotAiKeys(testSubbotId, 'groq', []);
  models.setSubBotAiKeys(testSubbotId, 'gemini', []);
  models.setSubBotAiKeys(testSubbotId, 'openai', []);

  // ---------------------------------------------------------------------------
  // TESTE 1: Sub-bot sem chave de IA -> Comandos bloqueados
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 1] Sub-Bot sem chave de IA deve ter comandos bloqueados');
  assert.strictEqual(models.canSubBotUseAi(testSubbotId), false, 'Sub-Bot sem chaves deve retornar canSubBotUseAi = false');

  let blockedReply = '';
  const mockMsg = {
    chat: '5511999991111@s.whatsapp.net',
    sender: regularUser,
    senderNumber: '5511999998888',
    fromMe: false,
    text: '!menu',
    isCommand: true,
    command: 'menu',
    args: [],
    textArgs: '',
    prefix: '!',
    reply: (txt) => { blockedReply = txt; return true; }
  };

  const mockCustomSock = {
    instanceId: testSubbotId,
    sendMessage: async (jid, content) => {
      blockedReply = content.text || content;
      return true;
    }
  };

  // Simula execução de comando no sub-bot sem chave
  await handler.handleMessage(null, {
    key: { remoteJid: mockMsg.chat, fromMe: false, id: 'TEST_MSG_1' },
    message: { conversation: '!menu' },
    pushName: 'Membro Teste'
  }, mockCustomSock);

  assert.ok(blockedReply.includes('SUB-BOT #9888 BLOQUEADO') && blockedReply.includes('CADASTRO DE CHAVE DE IA OBRIGATÓRIO'),
    'Sub-bot sem chave deve bloquear comandos com mensagem de ativação');
  console.log('   ✅ Sub-Bot bloqueou comando com sucesso e solicitou chave de IA.\n');

  // ---------------------------------------------------------------------------
  // TESTE 2: Colar chave de IA inválida em conversa -> Rejeitada e mantém bloqueio
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 2] Colar chave de IA INVÁLIDA deve ser recusada e manter bloqueio');
  let invalidReply = '';
  const mockSockForInvalid = {
    instanceId: testSubbotId,
    sendMessage: async (jid, content) => {
      invalidReply = content.text || content;
      return true;
    }
  };

  const invalidKeyText = 'Opa amigo, tenta essa chave aqui gsk_mock_invalid_key_123456789012345678901234567890';
  const invalidResult = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForInvalid,
    instanceId: testSubbotId,
    from: '5511999991111@s.whatsapp.net',
    sender: regularUser,
    text: invalidKeyText,
    pushName: 'Membro Teste',
    isGroup: false
  });

  assert.strictEqual(invalidResult.handled, true, 'Mensagem com chave deve ser interceptada');
  assert.strictEqual(invalidResult.action, 'KEY_REJECTED', 'Ação deve ser KEY_REJECTED');
  assert.ok(invalidReply.includes('CHAVE DE IA RECUSADA'), 'Mensagem de retorno deve avisar recusa da chave');
  assert.strictEqual(models.canSubBotUseAi(testSubbotId), false, 'Sub-Bot deve continuar bloqueado');
  console.log('   ✅ Chave inválida rejeitada com sucesso, mantendo bloqueio.\n');

  // ---------------------------------------------------------------------------
  // TESTE 3: Colar chave de IA VÁLIDA em qualquer conversa -> Auto-Ativação e +50 Tokens
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 3] Colar chave de IA VÁLIDA ativa o Sub-Bot e libera 50 tokens garantidos');
  let validReply = '';
  const mockSockForValid = {
    instanceId: testSubbotId,
    sendMessage: async (jid, content) => {
      validReply = content.text || content;
      return true;
    }
  };

  const validKey = 'gsk_mock_valid_key_123456789012345678901234567890';
  const validKeyText = `Toma aqui a chave de ativação: ${validKey}`;

  const validResult = await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForValid,
    instanceId: testSubbotId,
    from: '5511999991111@s.whatsapp.net',
    sender: regularUser,
    text: validKeyText,
    pushName: 'Membro Teste',
    isGroup: false
  });

  assert.strictEqual(validResult.handled, true, 'Mensagem com chave válida deve ser tratada');
  assert.strictEqual(validResult.action, 'KEY_ACTIVATED', 'Ação deve ser KEY_ACTIVATED');
  assert.ok(validReply.includes('CHAVE DE IA VALIDADA E ATIVADA COM SUCESSO') && validReply.includes('50 Tokens Liberados'),
    'Mensagem deve confirmar sucesso e liberação dos tokens');
  assert.strictEqual(models.canSubBotUseAi(testSubbotId), true, 'Sub-Bot agora deve ter permissão canSubBotUseAi = true');

  const registeredKeys = models.getSubBotAiKeys(testSubbotId, 'groq');
  assert.ok(registeredKeys.includes(validKey), 'Chave válida deve constar no banco de dados do Sub-Bot');
  console.log('   ✅ Sub-Bot ativado com sucesso! Chave registrada e tokens liberados.\n');

  // ---------------------------------------------------------------------------
  // TESTE 4: Revogação de chave inválida -> Acesso revogado imediatamente
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 4] Revogação de chave inválida/expirada revoga o acesso do Sub-Bot');
  const revokeRes = aiManager.revokeSubBotKey(testSubbotId, 'groq', validKey, 'Token expirado pela provedora');
  assert.strictEqual(revokeRes.hasValidKeysRemaining, false, 'Sub-Bot não deve ter mais chaves válidas');
  assert.strictEqual(revokeRes.isRevoked, true, 'isRevoked deve ser true');
  assert.strictEqual(models.canSubBotUseAi(testSubbotId), false, 'canSubBotUseAi deve voltar para false');

  // Testa que os comandos voltam a ser bloqueados
  blockedReply = '';
  await handler.handleMessage(null, {
    key: { remoteJid: mockMsg.chat, fromMe: false, id: 'TEST_MSG_REVOKED' },
    message: { conversation: '!menu' },
    pushName: 'Membro Teste'
  }, mockCustomSock);

  assert.ok(blockedReply.includes('SUB-BOT #9888 BLOQUEADO'), 'Comandos devem ser bloqueados novamente após revogação');
  console.log('   ✅ Revogação imediata comprovada: acesso bloqueado até nova regularização.\n');

  // Reativa para testes subsequentes
  aiManager.addApiKey('groq', validKey, { subbotId: testSubbotId });
  assert.strictEqual(models.canSubBotUseAi(testSubbotId), true);

  // ---------------------------------------------------------------------------
  // TESTE 5: Garimpo do Enxame: Coleta de links de grupos de WhatsApp
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 5] Exército de Sub-Bots coletando links de grupos (chat.whatsapp.com)');
  const sampleGroupCode = 'ABCDefgh1234567890WXYZ';
  const sampleLinkText = `Galera entrem no grupo de ofertas aqui: https://chat.whatsapp.com/${sampleGroupCode} tá muito bom!`;

  await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForValid,
    instanceId: testSubbotId,
    from: testGroup,
    sender: regularUser,
    text: sampleLinkText,
    pushName: 'Vendedor Externo',
    isGroup: true,
    chatMetadata: { subject: 'Grupo Networking Tech' }
  });

  const links = models.listSwarmCollectedLinks(10);
  const foundLink = links.find(l => l.invite_code === sampleGroupCode);
  assert.ok(foundLink, 'Link de grupo deve ser coletado e salvo na base de inteligência');
  assert.strictEqual(foundLink.collected_by_subbot_id, testSubbotId, 'Deve registrar ID do chip que garimpou');
  console.log(`   ✅ Link de grupo ${foundLink.url} coletado com sucesso pelo Chip #${foundLink.collected_by_subbot_id}!\n`);

  // ---------------------------------------------------------------------------
  // TESTE 6: Garimpo do Enxame: Produtos relevantes em auge de repercussão (Buzz)
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 6] Exército coletando produtos relevantes conforme auge de repercussões');
  const sampleShopeeUrl = 'https://shope.ee/testePromocaoAugeRepercussao99';
  const sampleProductMessage = `Gente corre que tá com super desconto e promoção imperdível cupom barato: ${sampleShopeeUrl}`;

  await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForValid,
    instanceId: testSubbotId,
    from: testGroup,
    sender: regularUser,
    text: sampleProductMessage,
    pushName: 'Membro Comprador',
    isGroup: true
  });

  const products = models.listSwarmCollectedProducts(10, 1);
  const foundProd = products.find(p => p.url === sampleShopeeUrl);
  assert.ok(foundProd, 'Produto Shopee deve ser garimpado');
  assert.ok(foundProd.buzz_score >= 3, 'Produto com palavras-chave de promoção deve receber buzz inicial alto (>=3)');
  assert.strictEqual(foundProd.platform, 'Shopee', 'Plataforma deve ser identificada como Shopee');

  // Simula outra menção do mesmo produto aumentando o buzz
  await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForValid,
    instanceId: 2,
    from: 'outro_grupo@g.us',
    sender: '5511999997777@s.whatsapp.net',
    text: `Alguém mais comprou nesse link ${sampleShopeeUrl} ??`,
    isGroup: true
  });

  const updatedProducts = models.listSwarmCollectedProducts(10, 1);
  const updatedProd = updatedProducts.find(p => p.url === sampleShopeeUrl);
  assert.ok(updatedProd.buzz_score > foundProd.buzz_score, 'Nova menção deve incrementar a repercussão (buzz)');
  console.log(`   ✅ Produto ${updatedProd.url} monitorado com repercussão (Buzz: ${updatedProd.buzz_score})!\n`);

  // ---------------------------------------------------------------------------
  // TESTE 7: Garimpo do Enxame: Caçador de chaves de IA vazadas em grupos
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 7] Caçador de chaves de IA vazadas em grupos para o Mega-Pool Master');
  const leakedKey = 'gsk_mock_valid_leaked_public_key_12345678901234567890';
  const leakMessage = `Ops deixei cair minha chave do groq sem querer: ${leakedKey}`;

  await swarmIntelligence.inspectIncomingIntelligence({
    sock: mockSockForValid,
    instanceId: testSubbotId,
    from: testGroup,
    sender: regularUser,
    text: leakMessage,
    isGroup: true
  });

  // Aguarda processamento assíncrono do harvest
  await new Promise(r => setTimeout(r, 200));

  const harvestedKeys = models.listSwarmCollectedApiKeys(10);
  const foundHarvested = harvestedKeys.find(k => k.provider === 'groq');
  assert.ok(foundHarvested, 'Chave vazada deve ser capturada');
  assert.strictEqual(foundHarvested.status, 'ACTIVE', 'Chave capturada válida deve ter status ACTIVE');
  console.log(`   ✅ Chave vazada (${foundHarvested.masked_key}) interceptada e incorporada ao Mega-Pool!\n`);

  // ---------------------------------------------------------------------------
  // TESTE 8: Comando !enxame e Formatação de Relatórios
  // ---------------------------------------------------------------------------
  console.log('👉 [TESTE 8] Comando !enxame e Relatório de Telemetria do Exército');
  const report = swarmIntelligence.formatSwarmReport();
  assert.ok(report.includes('CENTRAL DO ENXAME (SWARM INTELLIGENCE)'), 'Relatório deve ter cabeçalho do Enxame');
  assert.ok(report.includes('Grupos Coletados'), 'Relatório deve listar contagem de grupos');
  assert.ok(report.includes('Produtos Garimpados'), 'Relatório deve listar contagem de produtos');
  assert.ok(report.includes('Chaves de IA Interceptadas'), 'Relatório deve listar chaves incorporadas');
  console.log('   ✅ Relatório !enxame formatado com sucesso:\n');
  console.log(report.split('\n').map(l => '      ' + l).join('\n'));

  // ---------------------------------------------------------------------------
  // TESTE 9: Estatísticas do Enxame via Models
  // ---------------------------------------------------------------------------
  console.log('\n👉 [TESTE 9] Validação do método models.getSwarmStats()');
  const stats = models.getSwarmStats();
  assert.ok(stats.linksCount >= 1, 'Deve haver ao menos 1 link registrado');
  assert.ok(stats.productsCount >= 1, 'Deve haver ao menos 1 produto registrado');
  assert.ok(stats.highBuzzCount >= 1, 'Deve haver ao menos 1 produto com alto buzz');
  console.log(`   ✅ Telemetria: Links=${stats.linksCount}, Produtos=${stats.productsCount}, Alto Buzz=${stats.highBuzzCount}, Chaves=${stats.keysCount}`);

  // Limpeza final de chaves de teste para isolamento de outras suítes
  try {
    models.setSubBotAiKeys(testSubbotId, 'groq', []);
    models.setSubBotAiKeys(testSubbotId, 'gemini', []);
    models.setSubBotAiKeys(testSubbotId, 'openai', []);
    aiManager.removeApiKey('groq', leakedKey, { isMaster: true });
    aiManager.keyPools.clear();
  } catch (_) {}

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('🎉 TODOS OS 9 TESTES DE ATIVAÇÃO, REVOGAÇÃO E ENXAME FORAM APROVADOS!');
  console.log('═════════════════════════════════════════════════════════════════');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de chaves de IA e Enxame:', err);
  process.exit(1);
});

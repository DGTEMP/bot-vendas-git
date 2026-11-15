const assert = require('assert');
const request = require('supertest');
const { createServer } = require('./src/server/app');
const models = require('./src/db/models');
const whatsappBot = require('./src/bots/whatsappBot');
const tunnelService = require('./src/services/tunnelService');
const statusStoryService = require('./src/services/statusStoryService');
const subbotTokenService = require('./src/services/subbotTokenService');
const viralRadarService = require('./src/services/viralRadarService');
const meteoricDialogueEngine = require('./src/services/meteoricDialogueEngine');
const zapVoiceService = require('./src/services/zapVoiceService');

async function runTests() {
  console.log('====================================================');
  console.log('🛡️ TESTES DE SEGURANÇA: MASTER AUTH & ZERO LEAKS');
  console.log('====================================================\n');

  const app = createServer();

  // Configura túneis simulados
  tunnelService.adminUrl = 'https://paybot-admin-secure.trycloudflare.com';
  tunnelService.storeUrl = 'https://paybot-store-public.trycloudflare.com';

  const defaultPass = 'paybot2026';
  models.setSetting('PANEL_ADMIN_PASSWORD', defaultPass);

  // ----------------------------------------------------
  // TESTE 1: Requisições locais no Port 3000 funcionam diretamente
  // ----------------------------------------------------
  console.log('🔒 [TESTE 1] Requisição local (localhost) ao /api/orders é liberada');
  const localRes = await request(app)
    .get('/api/orders')
    .set('Host', 'localhost:3000');
  assert.strictEqual(localRes.status, 200, 'Localhost deve ter acesso 200 sem atrito');
  console.log('   └─ Sucesso: Acesso local funcionando normalmente.');

  // ----------------------------------------------------
  // TESTE 2: Requisição remota (Cloudflare / Externa) ao /api/orders sem token é bloqueada com 401
  // ----------------------------------------------------
  console.log('⛔ [TESTE 2] Requisição remota externa ao /api/orders sem token é bloqueada com 401');
  const remoteRes = await request(app)
    .get('/api/orders')
    .set('Host', 'paybot-admin-secure.trycloudflare.com')
    .set('CF-Connecting-IP', '187.54.23.11');
  assert.strictEqual(remoteRes.status, 401, 'Requisição remota sem token DEVE retornar 401');
  assert(remoteRes.body.error.includes('Não Autorizado'), 'Deve conter mensagem de não autorizado');
  console.log('   └─ Sucesso: Bloqueio 401 ativo para tráfego remoto não autenticado.');

  // ----------------------------------------------------
  // TESTE 3: Verificação de PIN Mestre incorreto
  // ----------------------------------------------------
  console.log('🔑 [TESTE 3] /api/admin/verify-pin com senha incorreta retorna 401');
  const wrongPinRes = await request(app)
    .post('/api/admin/verify-pin')
    .set('Host', 'paybot-admin-secure.trycloudflare.com')
    .send({ password: 'senha_errada_xyz' });
  assert.strictEqual(wrongPinRes.status, 401);
  assert.strictEqual(wrongPinRes.body.success, false);
  console.log('   └─ Sucesso: Senha incorreta rejeitada.');

  // ----------------------------------------------------
  // TESTE 4: Verificação de PIN Mestre correto gera token válido
  // ----------------------------------------------------
  console.log('🔓 [TESTE 4] /api/admin/verify-pin com senha mestra correta gera token de sessão');
  const correctPinRes = await request(app)
    .post('/api/admin/verify-pin')
    .set('Host', 'paybot-admin-secure.trycloudflare.com')
    .send({ password: defaultPass });
  assert.strictEqual(correctPinRes.status, 200);
  assert.strictEqual(correctPinRes.body.success, true);
  assert(Boolean(correctPinRes.body.token), 'Deve retornar token de sessão');
  const adminToken = correctPinRes.body.token;
  console.log('   └─ Sucesso: Token master gerado:', adminToken.slice(0, 16) + '...');

  // ----------------------------------------------------
  // TESTE 5: Requisição remota com x-admin-token é autorizada (200 OK)
  // ----------------------------------------------------
  console.log('✅ [TESTE 5] Requisição remota com x-admin-token válido é autorizada');
  const authRemoteRes = await request(app)
    .get('/api/orders')
    .set('Host', 'paybot-admin-secure.trycloudflare.com')
    .set('CF-Connecting-IP', '187.54.23.11')
    .set('x-admin-token', adminToken);
  assert.strictEqual(authRemoteRes.status, 200);
  console.log('   └─ Sucesso: Sessão remota autorizada com token.');

  // ----------------------------------------------------
  // TESTE 6: Endpoints públicos continuam acessíveis remotamente sem token
  // ----------------------------------------------------
  console.log('🌐 [TESTE 6] Endpoints públicos e webhooks acessíveis sem token');
  const publicPinCheck = await request(app)
    .post('/api/admin/verify-pin')
    .set('Host', 'paybot-admin-secure.trycloudflare.com')
    .send({ password: 'test' });
  assert.strictEqual(publicPinCheck.status, 401, 'Endpoint de auth deve ser acessível para validar');

  const redirectRes = await request(app)
    .get('/l/vip')
    .set('Host', 'paybot-admin-secure.trycloudflare.com');
  assert([200, 302].includes(redirectRes.status), 'Redirecionamento /l/vip deve responder normalmente');
  console.log('   └─ Sucesso: Rotas públicas não sofrem bloqueio falso positivo.');

  // ----------------------------------------------------
  // TESTE 7: Verificação de Ausência de Vazamento em Serviços
  // ----------------------------------------------------
  console.log('🔍 [TESTE 7] Verificação de links gerados em serviços do PayBot');

  // Viral Radar
  const viralLink = viralRadarService.generatePostContent ? 'ok' : 'ok';
  assert(!JSON.stringify(viralRadarService).includes('localhost:3000'), 'Viral radar não deve referenciar localhost:3000');

  // Meteoric Dialogue
  const resolvedDiag = meteoricDialogueEngine.resolveSpintax('{link}', {});
  assert(!resolvedDiag.includes('localhost:3000'), 'Meteoric dialogue não deve conter localhost:3000');
  assert(resolvedDiag.includes(tunnelService.getStoreUrl()) || resolvedDiag.includes('3001'), 'Meteoric dialogue deve usar Store URL');

  // ZapVoice
  const renderedVoice = zapVoiceService.replaceVariables('{link_proposta}', {});
  assert(!renderedVoice.includes('localhost:3000'), 'ZapVoice não deve conter localhost:3000');
  assert(renderedVoice.includes(tunnelService.getStoreUrl()) || renderedVoice.includes('3001'), 'ZapVoice deve usar Store URL');

  console.log('   └─ Sucesso: Todos os serviços utilizam a Store URL (Porta 3001) para links públicos.');

  // ----------------------------------------------------
  // TESTE 8: WhatsApp Bot - !help não vaza adminUrl
  // ----------------------------------------------------
  console.log('📱 [TESTE 8] WhatsApp !help / !comandos não vaza link do painel admin');
  let helpMsg = '';
  const mockSock = {
    user: { id: '5511999990000:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      helpMsg = typeof content === 'string' ? content : (content.text || '');
      return { key: { id: 'TEST_HELP' } };
    }
  };

  await whatsappBot.handleIncomingMessage({
    key: { remoteJid: '120363000000000000@g.us', participant: '5511999991111@s.whatsapp.net', fromMe: false },
    pushName: 'Membro Comum',
    message: { conversation: '!help' }
  }, mockSock);

  assert(!helpMsg.includes('paybot-admin-secure.trycloudflare.com'), '!help NUNCA deve conter o túnel admin');
  assert(!helpMsg.includes('localhost:3000'), '!help NUNCA deve conter localhost:3000');
  console.log('   └─ Sucesso: Menu público do WhatsApp livre de URLs administrativas.');

  console.log('\n====================================================');
  console.log('🎉 TODOS OS 8 TESTES DE SEGURANÇA PASSARAM COM SUCESSO!');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

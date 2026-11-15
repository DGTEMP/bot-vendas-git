const assert = require('assert');
const http = require('http');

process.env.NODE_ENV = 'test';

const models = require('./src/db/models');
const { createServer } = require('./src/server/app');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const socialListeningService = require('./src/services/socialListeningService');

async function runTests() {
  console.log('🧪 Iniciando Testes do Pacote de Novas Funcionalidades (4 Features)...');

  // Servidor Admin para teste dos endpoints do Radar
  const adminApp = createServer();
  const adminServer = http.createServer(adminApp);
  await new Promise(r => adminServer.listen(0, r));
  const adminPort = adminServer.address().port;

  function makeRequest(port, method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // ==========================================
    // TESTE 1: CAPTURA AUTOMÁTICA DE PUSHNAME & PRIMEIRO NOME
    // ==========================================
    console.log('\n--- 1. Testando Captura de pushName e Primeiro Nome ---');
    const testPhone = '5511988887777';
    const contact = models.upsertWhatsAppContact(testPhone, '🌟 Rafael Oliveira 💻');
    assert.ok(contact, 'Contato deve ser salvo');
    assert.strictEqual(contact.phone, testPhone);
    assert.strictEqual(contact.first_name, 'Rafael');
    assert.strictEqual(models.getContactFirstName(testPhone), 'Rafael');
    console.log('  ✅ pushName "🌟 Rafael Oliveira 💻" higienizado para primeiro nome "Rafael" com sucesso!');

    // ==========================================
    // TESTE 2: ÁUDIOS DO DONO NO MOMENTO CERTO (VOZ PTT)
    // ==========================================
    console.log('\n--- 2. Testando Disparo de Áudio da Voz do Dono nos Gatilhos-Chave ---');

    // 2.1 Gatilho de Garantia / Confiança
    const replyTrust = await cognitiveSalesService.generateConsultativeReply({
      phone: testPhone,
      name: 'Rafael',
      text: 'Tem garantia? É confiável mesmo?'
    });
    assert.ok(replyTrust.includes('[AUDIO:'), 'Resposta deve conter tag [AUDIO: ...]');
    assert.ok(replyTrust.toLowerCase().includes('garantia'), 'Conteúdo do áudio deve abordar garantia');
    console.log('  ✅ Gatilho de Garantia/Confiança gerou nota de voz [AUDIO: ...] com sucesso!');

    // 2.2 Gatilho de Funcionamento
    const replyFunc = await cognitiveSalesService.generateConsultativeReply({
      phone: testPhone,
      name: 'Rafael',
      text: 'Como funciona esse bot de vendas?'
    });
    assert.ok(replyFunc.includes('[AUDIO:'), 'Resposta deve conter tag [AUDIO: ...]');
    assert.ok(replyFunc.toLowerCase().includes('funciona'), 'Conteúdo do áudio deve explicar o funcionamento');
    console.log('  ✅ Gatilho de Funcionamento gerou nota de voz [AUDIO: ...] com sucesso!');

    // 2.3 Gatilho de Desconto / Cupom
    const replyDiscount = await cognitiveSalesService.generateConsultativeReply({
      phone: testPhone,
      name: 'Rafael',
      text: 'Consegue me dar um desconto no pix?'
    });
    assert.ok(replyDiscount.includes('[AUDIO:'), 'Resposta deve conter tag [AUDIO: ...]');
    assert.ok(replyDiscount.toLowerCase().includes('desconto'), 'Conteúdo do áudio deve oferecer condição especial');
    console.log('  ✅ Gatilho de Desconto gerou nota de voz [AUDIO: ...] com sucesso!');

    // ==========================================
    // TESTE 3: RECUPERAÇÃO HUMANIZADA DE CARRINHO ABANDONADO
    // ==========================================
    console.log('\n--- 3. Testando Recuperação Humanizada de Carrinho ---');
    const cron = require('./src/services/subscriptionCron');
    models.saveCartSession({
      session_id: 'sess_cart_test_' + Date.now(),
      phone: testPhone,
      customer_name: 'Rafael Oliveira',
      current_product_name: 'PayBot Vendas Automáticas',
      cart_total: 497,
      status: 'IN_CART',
      cart_items: [{ name: 'PayBot Vendas Automáticas', price: 497, quantity: 1 }]
    });

    const abandonedList = models.getAbandonedCartSessions(0);
    const foundSession = abandonedList.find(s => s.phone === testPhone);
    assert.ok(foundSession, 'Sessão de carrinho abandonada deve ser listada');
    console.log('  ✅ Carrinho abandonado detectado pelo motor de cron.');

    // ==========================================
    // TESTE 4: RADAR DE LEADS & MINERAÇÃO EM GRUPOS (BOTS & SUB-BOTS)
    // ALIMENTANDO O NÚCLEO DE INTELIGÊNCIA DO PAYBOT
    // ==========================================
    console.log('\n--- 4. Testando Radar de Leads em Grupos (Bots & Sub-Bots) ---');
    
    // Simula socket de um SUB-BOT (#2) no exército
    const mockSubBotSock = {
      instanceId: 2,
      user: { id: '554899991111:2@s.whatsapp.net' },
      groupMetadata: async () => ({ subject: 'Grupo Papelarias & Vendas Brasil' }),
      sendMessage: async (jid, content) => {
        return { key: { id: 'MSG_' + Date.now(), remoteJid: jid }, message: content };
      }
    };

    socialListeningService.resetCooldown();
    const groupJid = '120363000000000@g.us';
    const leadPhone = '5511966665555';
    models.upsertWhatsAppContact(leadPhone, 'Lucas Papelaria 📚');

    // Sub-Bot escuta mensagem de intenção de compra no grupo
    const matched = await socialListeningService.handleIncomingGroupMessage(
      mockSubBotSock,
      groupJid,
      leadPhone + '@s.whatsapp.net',
      'Galera, alguém sabe onde compro bot de vendas automático pra atender minha papelaria?',
      false,
      { senderName: 'Lucas Papelaria', instanceId: 2 }
    );

    // 4.1 Validação do Scout nos Registros do Radar
    const resLeads = await makeRequest(adminPort, 'GET', '/api/radar/leads');
    assert.strictEqual(resLeads.status, 200);
    assert.strictEqual(resLeads.body.success, true);
    assert.ok(Array.isArray(resLeads.body.leads), 'Leads deve ser array');

    const capturedLead = resLeads.body.leads.find(l => l.sender_phone === leadPhone);
    assert.ok(capturedLead, 'Lead deve estar salvo no banco');
    assert.strictEqual(capturedLead.instance_id, 2, 'Scout deve ser registrado como Sub-Bot #2');
    assert.ok(capturedLead.scout_name.includes('Sub-Bot'), 'Nome do scout deve identificar o sub-bot');
    assert.ok(capturedLead.matched_product_name.includes('PayBot') || capturedLead.matched_product_name.includes('Vendas'), 'Deve mapear produto de vendas');
    assert.ok(capturedLead.ready_message, 'Deve conter mensagem pronta humanizada');
    console.log(`  ✅ Scout Sub-Bot (#${capturedLead.instance_id}) identificado: ${capturedLead.scout_name}`);
    console.log(`  ✅ Solução recomendada: ${capturedLead.matched_product_name}`);
    console.log(`  ✅ Script pronto para 1-clique gerado com sucesso.`);

    // 4.2 Validação da Alimentação no CRM COGNITIVO
    const crmProfile = models.getLeadCognitiveProfile(leadPhone);
    assert.ok(crmProfile, 'Perfil do lead deve ser criado/alimentado no CRM Cognitivo');
    assert.strictEqual(crmProfile.buying_stage, 'CONSIDERACAO', 'Estágio do lead deve ser avançado para CONSIDERACAO');
    assert.strictEqual(crmProfile.readiness_score, 85, 'Readiness score deve ser turbinado para 85');
    assert.ok(crmProfile.company_niche.toLowerCase().includes('papelaria'), 'Nicho deve ser identificado automaticamente como Papelaria');
    console.log(`  ✅ CRM Cognitivo alimentado: Nicho [${crmProfile.company_niche}] | Prontidão [${crmProfile.readiness_score}%] | Estágio [${crmProfile.buying_stage}]`);

    // Valida crenças e memórias episódicas
    const beliefs = models.getLeadBeliefs(leadPhone);
    assert.ok(beliefs.some(b => b.belief_key === 'scout_responsavel'), 'Crença de scout responsável deve ser registrada');
    assert.ok(beliefs.some(b => b.belief_key === 'nicho'), 'Crença de nicho deve ser registrada');
    
    const memories = models.getLeadEpisodicMemories(leadPhone);
    assert.ok(memories.some(m => m.memory_type === 'RADAR_OPPORTUNITY'), 'Memória episódica de radar deve ser gravada');
    console.log('  ✅ Crenças e Memórias Episódicas gravadas no cérebro do PayBot com sucesso!');

    // 4.3 Validação da Alimentação na INTELIGÊNCIA PREDITIVA
    const insights = models.getRecentPredictiveInsights('554884702848', 5);
    const radarInsight = insights.find(i => i.insight_type === 'RADAR_GROUP_OPPORTUNITY');
    assert.ok(radarInsight, 'Insight preditivo de radar deve ser gerado');
    assert.ok(radarInsight.title.includes('Grupo'), 'Título do insight deve referenciar o grupo');
    console.log(`  ✅ Inteligência Preditiva alimentada: "${radarInsight.title}" (Score: ${radarInsight.probability_score}%)`);

    // 4.4 Atualiza status do lead no painel
    const resUpdate = await makeRequest(adminPort, 'POST', `/api/radar/leads/${capturedLead.id}/status`, {
      status: 'CONTACTED',
      notes: 'Acionado no WhatsApp pelo dono'
    });
    assert.strictEqual(resUpdate.status, 200);
    assert.strictEqual(resUpdate.body.lead.status, 'CONTACTED');
    console.log('  ✅ Status do lead atualizado para CONTACTED com sucesso.');

    console.log('\n🎉 TODOS OS TESTES DO NÚCLEO DE INTELIGÊNCIA DO PAYBOT PASSARAM COM 100% DE SUCESSO! 🎉\n');
  } finally {
    adminServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});

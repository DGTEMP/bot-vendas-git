const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const nicheService = require('./src/services/nicheModularService');
const knowledgeBaseService = require('./src/services/knowledgeBaseService');
const cognitiveSalesService = require('./src/services/cognitiveSalesService');
const db = require('./src/db/database');
const models = require('./src/db/models');
const { createServer } = require('./src/server/app');

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🧠 TEST SUITE: NÚCLEO DE INTELIGÊNCIA - USO & ALIMENTAÇÃO MULTI-NICHO & MODELOS');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  const ALL_15_NICHES = [
    'advogados', 'vendedores', 'nailsdesigns', 'leshes', 'marmitas',
    'pizzas', 'lanches', 'sushi', 'arena_esportiva', 'academia',
    'corretor_imoveis', 'consorcio', 'carros', 'alugueis', 'hospedagens'
  ];

  const ACTIVE_MODELS = [
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
    { provider: 'local', model: 'ollama-llama3' }
  ];

  // -------------------------------------------------------------
  // GRUPO 1: TODOS OS 15 NICHOS USAM O NÚCLEO DE INTELIGÊNCIA
  // -------------------------------------------------------------
  console.log('--- GRUPO 1: Todos os 15 Nichos USAM o Núcleo de Inteligência ---');

  test('Todos os 15 nichos recebem diretivas cognitivas da Base de Conhecimento', () => {
    for (const nicheKey of ALL_15_NICHES) {
      const playbook = knowledgeBaseService.getContextualPlaybook({
        text: 'Qual o valor e como funciona?',
        stage: 'CONSCIENCIA',
        niche: nicheKey,
        tone: 'consultivo'
      });

      assert.ok(playbook, `Playbook vazio para o nicho ${nicheKey}`);
      assert.ok(playbook.includes('BASE DE CONHECIMENTO COGNITIVA'), `Nicho ${nicheKey} não incluiu base fundamental`);
    }
  });

  test('Padrões canônicos aprendidos pelo Núcleo são injetados no playbook do nicho', () => {
    // Insere padrão prévio no nicho sushi
    models.upsertNichePattern({
      niche: 'sushi',
      pattern_type: 'WINNING_PITCH',
      trigger_topic: 'COMBINADO_CHEF',
      canonical_response: 'Nosso combinado do chef vai com salmão fresco maçaricado e cream cheese especial, preparo na hora!',
      model: 'gemini/gemini-2.0-flash',
      confidence: 0.96
    });

    const sushiPlaybook = knowledgeBaseService.getContextualPlaybook({
      text: 'Quero um sushi top pra hoje',
      niche: 'sushi'
    });

    assert.ok(sushiPlaybook.includes('APRENDIZADO VIVO DO NÚCLEO'), 'Playbook do sushi deve conter aprendizado vivo');
    assert.ok(sushiPlaybook.includes('salmão fresco maçaricado'), 'Playbook do sushi deve conter o padrão canônico');
  });

  // -------------------------------------------------------------
  // GRUPO 2: TODOS OS MODELOS ATIVOS USAM O NÚCLEO DE INTELIGÊNCIA
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 2: Todos os Modelos Ativos USAM o Núcleo de Inteligência ---');

  test('Todos os modelos e provedores ativos recebem calibração neural do Núcleo', () => {
    for (const m of ACTIVE_MODELS) {
      const playbook = knowledgeBaseService.getContextualPlaybook({
        text: 'Gostei da proposta, como fazemos?',
        stage: 'FECHAMENTO',
        provider: m.provider,
        model: m.model,
        niche: 'advogados'
      });

      assert.ok(playbook.includes(`CALIBRAÇÃO DO NÚCLEO PARA O MODELO ATIVO`), `Modelo ${m.model} sem calibração`);
      assert.ok(playbook.toUpperCase().includes(m.provider.toUpperCase()), `Provedor ${m.provider} não citado na calibração`);
    }
  });

  // -------------------------------------------------------------
  // GRUPO 3: TODOS OS NICHOS E MODELOS ALIMENTAM O NÚCLEO
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 3: Todos os Nichos e Modelos ALIMENTAM o Núcleo ---');

  test('Todos os 15 nichos alimentam a tabela de aprendizado com seus diálogos', () => {
    let fedCount = 0;
    ALL_15_NICHES.forEach((nicheKey, idx) => {
      const modelObj = ACTIVE_MODELS[idx % ACTIVE_MODELS.length];
      const testPhone = `55119999900${String(idx).padStart(2, '0')}`;

      const learning = knowledgeBaseService.feedFromInteraction({
        tenantId: 10 + idx,
        niche: nicheKey,
        interaction_tone: 'consultivo',
        provider: modelObj.provider,
        model: modelObj.model,
        leadPhone: testPhone,
        userInput: `Olá, tenho interesse nos serviços de ${nicheKey}. Pode me passar valores?`,
        botResponse: `Com certeza! Temos planos e soluções completas para ${nicheKey} com atendimento ágil no WhatsApp.`,
        intent: 'PRICE_QUERY',
        objection: null,
        buyingStage: 'QUALIFICACAO',
        conversionSignal: 0,
        source: 'whatsapp_test'
      });

      assert.ok(learning && learning.id, `Falha ao alimentar núcleo para o nicho ${nicheKey}`);
      fedCount++;
    });

    assert.strictEqual(fedCount, 15, 'Todos os 15 nichos devem ter alimentado o núcleo');
  });

  test('Superação de objeção gera padrão de aprendizado no Núcleo de Inteligência', () => {
    const learning = knowledgeBaseService.feedFromInteraction({
      tenantId: 1,
      niche: 'academia',
      interaction_tone: 'comercial',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      leadPhone: '5511988887766',
      userInput: 'Achei a mensalidade meio cara...',
      botResponse: 'Entendo perfeitamente! Mas no plano anual você economiza 35% e ainda ganha bioimpedância inclusa todo mês.',
      intent: 'OBJECTION',
      objection: 'PRECO',
      buyingStage: 'OBJECOES',
      conversionSignal: 0
    });

    assert.ok(learning.id);
    const patterns = models.getNichePatterns('academia', 'OBJECTION_REVERSAL');
    assert.ok(patterns.length > 0, 'Padrão de superação de objeção deve ser criado no nicho academia');
    assert.strictEqual(patterns[0].trigger_topic, 'PRECO');
  });

  test('Intenção de compra com Pix gera padrão canônico de alta conversão (WINNING_PITCH)', () => {
    const learning = knowledgeBaseService.feedFromInteraction({
      tenantId: 1,
      niche: 'pizzas',
      interaction_tone: 'comercial',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      leadPhone: '5511977771122',
      userInput: 'Pode fechar! Manda o Pix que vou pagar agora!',
      botResponse: 'Maravilha! Segue o Pix Copia e Cola para ativação imediata: 00020126... Seu pedido entra no forno agora!',
      intent: 'BUY_INTENT',
      buyingStage: 'FECHAMENTO'
    });

    assert.ok(learning.id);
    const winningPatterns = models.getNichePatterns('pizzas', 'WINNING_PITCH');
    assert.ok(winningPatterns.length > 0, 'Deve registrar padrão de alta conversão para o nicho pizzas');
  });

  // -------------------------------------------------------------
  // GRUPO 4: ALIMENTAÇÃO POR CONVERSÃO DE PEDIDO (#ORD_)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 4: Conversão de Venda (#ORD_) Reforça o Núcleo ---');

  test('feedFromOrder retroalimenta os turnos do lead promovendo-os para score máximo de conversão', () => {
    const targetPhone = '5511966665544';

    // 1. Cria interação prévia
    knowledgeBaseService.feedFromInteraction({
      tenantId: 1,
      niche: 'carros',
      interaction_tone: 'consultivo',
      provider: 'openai',
      model: 'gpt-4o-mini',
      leadPhone: targetPhone,
      userInput: 'Quero reservar o Honda Civic 2022',
      botResponse: 'Excelente escolha! O veículo possui laudo cautelar 100% aprovado e garantia de 1 ano. Vou emitir a reserva.',
      intent: 'BUY_INTENT',
      buyingStage: 'FECHAMENTO'
    });

    // 2. Confirmação de pedido pago
    const orderRes = knowledgeBaseService.feedFromOrder({
      order: {
        id: 9991,
        merchant_trade_no: 'ORD_CIVIC_9991',
        amount: 2500.0,
        platform_user_id: targetPhone
      },
      leadPhone: targetPhone,
      niche: 'carros'
    });

    assert.ok(orderRes.success);
    assert.ok(orderRes.affected_turns > 0, 'Turnos do lead devem ter sido atualizados com conversão');

    // 3. Verifica se aprendizado no banco foi marcado como conversão
    const learnings = models.getIntelligenceLearnings({ niche: 'carros', onlyConversions: true });
    assert.ok(learnings.length > 0, 'Aprendizado de carros deve constar como conversão');
    assert.strictEqual(learnings[0].conversion_signal, 1);
    assert.strictEqual(learnings[0].feedback_score, 5.0);
  });

  // -------------------------------------------------------------
  // GRUPO 5: INTEGRAÇÃO DIRETA COM COGNITIVE SALES SERVICE
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 5: CognitiveSalesService Usa e Alimenta Automaticamente ---');

  await testAsync('generateConsultativeReply usa o núcleo e grava aprendizado em tempo real', async () => {
    const leadPhone = '5511955554433';
    const reply = await cognitiveSalesService.generateConsultativeReply({
      senderPhone: leadPhone,
      text: 'Qual o valor da consulta jurídica trabalhista?',
      firstName: 'Drauzio',
      isMasterBot: false,
      tenantObj: {
        id: 55,
        name: 'Advocacia Trabalhista Prime',
        slug: 'adv-prime',
        niche: 'advogados',
        interaction_tone: 'formal'
      }
    });

    assert.ok(reply, 'Resposta consultiva deve ser gerada');

    // Verifica se o diálogo alimentou o Núcleo de Inteligência
    const recentAdv = models.getIntelligenceLearnings({ niche: 'advogados', limit: 5 });
    const match = recentAdv.find(l => l.lead_phone === leadPhone);
    assert.ok(match, 'Diálogo com o CognitiveSalesService deve ter alimentado o Núcleo para o nicho advogados');
    assert.strictEqual(match.niche, 'advogados');
  });

  // -------------------------------------------------------------
  // GRUPO 6: ENDPOINTS REST DO NÚCLEO DE INTELIGÊNCIA
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 6: Rotas HTTP REST do Núcleo de Inteligência ---');

  let server;
  let baseUrl;

  await testAsync('Servidor HTTP iniciado para testar rotas do Núcleo', async () => {
    await new Promise((resolve) => {
      const expressApp = createServer();
      server = expressApp.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  async function requestJson(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(urlPath, baseUrl);
      const reqOpts = {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      };

      const req = http.request(fullUrl, reqOpts, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  await testAsync('GET /api/intelligence-core/stats retorna métricas consolidadas', async () => {
    const res = await requestJson('/api/intelligence-core/stats');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.success);
    assert.ok(res.body.total_learnings > 0, 'Deve ter aprendizados registrados');
    assert.ok(res.body.niches_active_count > 0, 'Deve ter nichos ativos');
    assert.ok(Array.isArray(res.body.learnings_by_niche), 'Deve conter quebra por nicho');
    assert.ok(Array.isArray(res.body.learnings_by_model), 'Deve conter quebra por modelo');
  });

  await testAsync('GET /api/intelligence-core/niche/:nicheKey retorna padrões e aprendizados específicos', async () => {
    const res = await requestJson('/api/intelligence-core/niche/advogados');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.success);
    assert.strictEqual(res.body.niche, 'advogados');
    assert.ok(Array.isArray(res.body.patterns));
    assert.ok(Array.isArray(res.body.recent_learnings));
  });

  await testAsync('GET /api/intelligence-core/models retorna distribuição de modelos ativos', async () => {
    const res = await requestJson('/api/intelligence-core/models');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.success);
    assert.ok(Array.isArray(res.body.models));
  });

  await testAsync('POST /api/intelligence-core/feed permite alimentação externa/manual de aprendizado', async () => {
    const res = await requestJson('/api/intelligence-core/feed', {
      method: 'POST',
      body: {
        niche: 'hospedagens',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        leadPhone: '5548991112233',
        userInput: 'Tem vaga no chalé master com hidromassagem para o próximo fim de semana?',
        botResponse: 'Temos sim! O Chalé Master está disponível com café colonial e hidro aquecida inclusos. Posso segurar para você?',
        intent: 'AVAILABILITY_QUERY',
        buyingStage: 'QUALIFICACAO'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.success);
    assert.ok(res.body.learning && res.body.learning.id);
  });

  if (server) {
    server.close();
  }

  console.log('\n========================================================================');
  console.log(`🎉 TODOS OS ${passed}/${total} TESTES DO NÚCLEO DE INTELIGÊNCIA PASSARAM COM SUCESSO!`);
  console.log('========================================================================\n');
}

runTestSuite().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});

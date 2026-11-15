/**
 * test_sheets_sync.js
 * Teste de Integração e Verificação Completa do Sincronizador Google Sheets
 * Cobre:
 * 1. Extração de URLs e Sheet ID
 * 2. Parser RFC 4180 com delimitadores variados (, e ;) e aspas
 * 3. Detecção automática de Plataforma (Shopee, Amazon, Hotmart, Kiwify, etc.)
 * 4. Extração de Palavras-chave e integração automática com Social Listening
 * 5. Ingestão no Banco de Dados (bulkUpsertAffiliateLinksFromSheet)
 * 6. Webhook Streaming Push em Tempo Real com validação de secret
 * 7. Comandos do WhatsApp Bot (!planilha, !syncplanilha, !planilha webhook, etc.)
 */

const assert = require('assert');
const models = require('./src/db/models');
const googleSheetsSyncService = require('./src/services/googleSheetsSyncService');
const whatsappBot = require('./src/bots/whatsappBot');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('🧪 INICIANDO TESTES DO SINCRONIZADOR GOOGLE SHEETS 📊');
  console.log('======================================================\n');

  // 1. Extração de URLs e IDs
  it('1.1 Extrai Sheet ID de URL de edição padrão com GID', () => {
    const raw = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=12345';
    const info = googleSheetsSyncService.extractSheetIdAndUrls(raw);
    assert(info !== null, 'Deveria extrair info');
    assert.strictEqual(info.sheetId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    assert(info.csvExportUrl.includes('export?format=csv&gid=12345'));
    assert(info.gvizUrl.includes('/gviz/tq?tqx=out:csv&gid=12345'));
  });

  it('1.2 Extrai Sheet ID quando fornecido diretamente', () => {
    const sheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
    const info = googleSheetsSyncService.extractSheetIdAndUrls(sheetId);
    assert(info !== null);
    assert.strictEqual(info.sheetId, sheetId);
    assert(info.csvExportUrl.includes(sheetId));
  });

  // 2. Parser RFC 4180
  it('2.1 Parser com vírgula e aspas com vírgula interna', () => {
    const csv = `Título,Link,Preço,Comissão
"Chapinha Titanium Pro, Edição Especial",https://shopee.com.br/chapinha-pro,189.90,20
"Curso Robô Scalper",https://kiwify.com.br/robo,297.00,50`;

    const parsed = googleSheetsSyncService.parseCsv(csv);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].title, 'Chapinha Titanium Pro, Edição Especial');
    assert.strictEqual(parsed[0].affiliate_url, 'https://shopee.com.br/chapinha-pro');
    assert.strictEqual(parsed[0].product_price, 189.90);
    assert.strictEqual(parsed[0].commission_percent, 20);
    assert.strictEqual(parsed[0].platform, 'Shopee');
  });

  it('2.2 Parser com ponto-e-vírgula (delimitador padrão pt-BR)', () => {
    const csv = `Produto;URL Afiliado;Valor;Plataforma
Fritadeira Air Fryer Mondial;https://amzn.to/airfryer-mondial;349.90;Amazon
Secador de Cabelo Taiff;https://shopee.com.br/secador-taiff;129.00;Shopee`;

    const parsed = googleSheetsSyncService.parseCsv(csv);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].title, 'Fritadeira Air Fryer Mondial');
    assert.strictEqual(parsed[0].platform, 'Amazon');
    assert.strictEqual(parsed[0].product_price, 349.90);
    assert.strictEqual(parsed[1].platform, 'Shopee');
  });

  // 3. Detecção Automática de Plataformas
  it('3.1 Detecta plataformas conhecidas pelos domínios da URL', () => {
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://shopee.com.br/product/123'), 'Shopee');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://amzn.to/3xyz'), 'Amazon');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://go.hotmart.com/A12345'), 'Hotmart');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://pay.kiwify.com.br/xyz'), 'Kiwify');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://ev.braip.com/ref?pv=123'), 'Braip');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://mercadolivre.com/sec/abc'), 'Mercado Livre');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://magalu.com/p/item'), 'Magalu');
    assert.strictEqual(googleSheetsSyncService.detectPlatformFromUrl('https://aliexpress.com/item/123'), 'AliExpress');
  });

  // 4. Extração de Palavras-Chave e Gatilhos
  it('4.1 Extrai termos chave sem stop words', () => {
    const kw1 = googleSheetsSyncService.extractKeywordsFromTitle('Chapinha de Cabelo Titanium Profissional');
    assert(kw1.includes('chapinha'), 'Deveria conter chapinha');
    assert(kw1.includes('cabelo'), 'Deveria conter cabelo');
    assert(!kw1.split(',').includes('de'), 'Não deveria conter stop word "de"');
  });

  // 5. Ingestão e Social Listening
  it('5.1 Ingestão em lote vincula produtos ao Social Listening', () => {
    const items = [
      {
        title: 'Chapinha Nano Titanium 450F',
        affiliate_url: 'https://shopee.com.br/chapinha-nano-titanium-test-unique',
        platform: 'Shopee',
        product_price: 159.90,
        commission_percent: 15.0,
        keywords: 'chapinha, prancha, titanium, alisador',
        pitch_copy: 'Meninas, eu comprei essa chapinha na Shopee e alisou meu cabelo na metade do tempo!'
      }
    ];

    const result = models.bulkUpsertAffiliateLinksFromSheet(items, { auto_social_listening: true });
    assert(result.added > 0 || result.updated > 0, 'Deveria inserir ou atualizar');

    // Verifica se salvou em affiliate_links
    const allLinks = models.getAffiliateLinks();
    const found = allLinks.find(l => l.affiliate_url === 'https://shopee.com.br/chapinha-nano-titanium-test-unique');
    assert(found !== undefined, 'Link de afiliado deve estar no banco');
    assert.strictEqual(found.source, 'google_sheets');
    assert.strictEqual(found.platform, 'Shopee');

    // Verifica se gerou regra de social listening
    const rules = models.listSocialListeningRules(false);
    const slRule = rules.find(r => r.affiliate_url === found.affiliate_url);
    assert(slRule !== undefined, 'Regra de Social Listening deve ter sido gerada automaticamente');
    assert(slRule.keywords.includes('chapinha'), 'Palavras-chave devem conter chapinha');
    assert.strictEqual(slRule.active, 1, 'Regra deve estar ativa');
  });

  // 6. Webhook Streaming Push
  it('6.1 Webhook Push adiciona links e valida autenticação', () => {
    const cfg = models.getGoogleSheetsSyncConfig();
    assert(cfg.webhook_secret, 'Deve existir webhook_secret');

    // Falha com secret inválido
    assert.throws(() => {
      googleSheetsSyncService.handleWebhookPush({
        title: 'Produto Inválido',
        link: 'https://exemplo.com'
      }, 'chave_incorreta_123');
    }, /inválida/i);

    // Sucesso com secret correto
    const hookRes = googleSheetsSyncService.handleWebhookPush({
      title: 'Smartwatch Ultra 9 NFC',
      link: 'https://amzn.to/smartwatch-ultra-9-test',
      preco: '199.90',
      comissao: '12'
    }, cfg.webhook_secret);

    assert.strictEqual(hookRes.success, true);
    assert(hookRes.total >= 1);

    const saved = models.getAffiliateLinks().find(l => l.affiliate_url === 'https://amzn.to/smartwatch-ultra-9-test');
    assert(saved !== undefined);
    assert.strictEqual(saved.platform, 'Amazon');
    assert.strictEqual(saved.product_price, 199.90);
  });

  // 7. Simulação de Comandos WhatsApp Bot
  await itAsync('7.1 WhatsApp Bot responde ao comando !planilha', async () => {
    let captured = null;
    const mockSock = {
      user: { id: '554884702848:0@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        captured = { jid, content };
        return { key: { id: 'MOCK_MSG_ID' } };
      }
    };

    await whatsappBot.handleOwnerSheetsCommand('554884702848@s.whatsapp.net', '!planilha', mockSock);
    assert(captured !== null, 'Deveria enviar resposta');
    assert(captured.content.text.includes('CENTRAL DE SINCRONIZAÇÃO GOOGLE SHEETS'), 'Deve conter título da central');
    assert(captured.content.text.includes('Status do Poller'), 'Deve conter status do poller');
  });

  await itAsync('7.2 WhatsApp Bot altera intervalo com !planilha intervalo 2', async () => {
    let captured = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        captured = { jid, content };
        return { key: { id: 'MOCK_MSG_ID' } };
      }
    };

    await whatsappBot.handleOwnerSheetsCommand('554884702848@s.whatsapp.net', '!planilha intervalo 2', mockSock);
    assert(captured !== null);
    assert(captured.content.text.includes('2 segundo(s)'));
    const cfg = models.getGoogleSheetsSyncConfig();
    assert.strictEqual(cfg.sync_interval_seconds, 2);
  });

  await itAsync('7.3 WhatsApp Bot fornece instruções de webhook com !planilha webhook', async () => {
    let captured = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        captured = { jid, content };
        return { key: { id: 'MOCK_MSG_ID' } };
      }
    };

    await whatsappBot.handleOwnerSheetsCommand('554884702848@s.whatsapp.net', '!planilha webhook', mockSock);
    assert(captured !== null);
    assert(captured.content.text.includes('STREAMING INSTANTÂNEA'));
    assert(captured.content.text.includes('/api/sheets/webhook'));
  });

  await itAsync('7.4 WhatsApp Bot pausa e retoma com !planilha pausar e !planilha ativar', async () => {
    let captured = null;
    const mockSock = {
      sendMessage: async (jid, content) => {
        captured = { jid, content };
        return { key: { id: 'MOCK_MSG_ID' } };
      }
    };

    await whatsappBot.handleOwnerSheetsCommand('554884702848@s.whatsapp.net', '!planilha pausar', mockSock);
    let cfg = models.getGoogleSheetsSyncConfig();
    assert.strictEqual(cfg.sync_enabled, 0);

    await whatsappBot.handleOwnerSheetsCommand('554884702848@s.whatsapp.net', '!planilha ativar', mockSock);
    cfg = models.getGoogleSheetsSyncConfig();
    assert.strictEqual(cfg.sync_enabled, 1);
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL DOS TESTES: ${passedTests}/${totalTests} PASSARAM`);
  console.log('======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

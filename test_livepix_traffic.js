/**
 * test_livepix_traffic.js
 * Inspeciona todo o tráfego HTTP/API do LivePix durante o fluxo real de geração
 */
const puppeteer = require('rebrowser-puppeteer');

async function inspectFullTraffic() {
  console.log('🚀 Iniciando inspeção completa de tráfego do LivePix...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const apiCalls = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('livepix.gg') && !url.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2|woff|ttf|css|js)$/)) {
      apiCalls.push({
        time: Date.now(),
        type: 'REQ',
        method: req.method(),
        url: url,
        postData: req.postData()
      });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('livepix.gg') && !url.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2|woff|ttf|css|js)$/)) {
      let body = null;
      try {
        const text = await res.text();
        if (text && (text.startsWith('{') || text.startsWith('['))) {
          body = JSON.parse(text);
        } else if (text && text.length < 200) {
          body = text;
        }
      } catch (_) {}

      apiCalls.push({
        time: Date.now(),
        type: 'RES',
        status: res.status(),
        url: url,
        body: body
      });
    }
  });

  const t0 = Date.now();
  console.log(`[${Date.now() - t0}ms] Acessando livepix.gg/luizaa...`);
  await page.goto('https://livepix.gg/luizaa', { waitUntil: 'domcontentloaded' });
  console.log(`[${Date.now() - t0}ms] Página inicial carregada`);

  await page.waitForSelector('input[name="username"]', { timeout: 8000 });
  await page.type('input[name="username"]', '5511999998888');
  await page.type('textarea[name="message"]', 'TEST_PERF_1');

  const amountInput = await page.$('input[name="amount"]');
  if (amountInput) {
    await amountInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await amountInput.type('5,00');
  }

  // Switch de taxa
  try {
    const cb = await page.$('input[type="checkbox"]');
    if (cb) {
      const isChecked = await page.evaluate(el => el.checked, cb);
      if (!isChecked) await cb.click();
    }
  } catch (_) {}

  await new Promise(r => setTimeout(r, 1200));

  let payBtn = await page.$('button[aria-label="Continuar para pagamento"]');
  if (!payBtn) {
    const buttons = await page.$$('button');
    for (const b of buttons) {
      const txt = await page.evaluate(el => el.innerText, b);
      if (txt && txt.trim().toLowerCase().includes('continuar')) {
        payBtn = b;
        break;
      }
    }
  }

  console.log(`[${Date.now() - t0}ms] Clicando em Continuar...`);
  await payBtn.click();

  // Espera recompensa se houver
  await new Promise(r => setTimeout(r, 1500));
  try {
    const rewardBtns = await page.$$('button');
    for (const rb of rewardBtns) {
      const txt = await page.evaluate(el => el.innerText, rb);
      if (txt && txt.trim().toLowerCase().includes('continuar')) {
        await rb.click();
        break;
      }
    }
  } catch (_) {}

  // Espera checkout
  console.log(`[${Date.now() - t0}ms] Aguardando checkout / paymentId...`);
  let checkoutTarget = null;
  const startWait = Date.now();
  while (Date.now() - startWait < 15000) {
    const frames = page.frames();
    const frame = frames.find(f => f.url().includes('checkout.livepix.gg'));
    if (frame) {
      checkoutTarget = frame;
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (checkoutTarget) {
    console.log(`[${Date.now() - t0}ms] Frame checkout encontrado! Aguardando botão Continuar (escolha do Pix)...`);
    await checkoutTarget.waitForSelector('button', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));

    const fButtons = await checkoutTarget.$$('button');
    for (const fb of fButtons) {
      const txt = await checkoutTarget.evaluate(el => el.innerText, fb);
      if (txt && txt.trim().toUpperCase() === 'CONTINUAR') {
        await fb.click();
        console.log(`[${Date.now() - t0}ms] Botão Continuar do checkout clicado!`);
        break;
      }
    }

    console.log(`[${Date.now() - t0}ms] Aguardando código Pix Copia e Cola...`);
    const pixWait = Date.now();
    let pixCode = null;
    while (Date.now() - pixWait < 10000) {
      const inputs = await checkoutTarget.$$eval('input', els => els.map(i => i.value));
      const found = inputs.find(v => v && v.startsWith('000201'));
      if (found) {
        pixCode = found;
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[${Date.now() - t0}ms] Pix Code obtido:`, pixCode ? pixCode.slice(0, 40) + '...' : 'NÃO OBTIDO');
  }

  await browser.close();

  console.log('\n========================================');
  console.log('CHAMADAS DE API INTERCEPTADAS DO LIVEPIX:');
  console.log('========================================');
  apiCalls.forEach(c => {
    if (c.type === 'REQ') {
      console.log(`\n➡️ [REQ ${c.method}] ${c.url}`);
      if (c.postData) console.log(`   Data: ${c.postData}`);
    } else {
      console.log(`⬅️ [RES ${c.status}] ${c.url}`);
      if (c.body) console.log(`   Body: ${JSON.stringify(c.body).slice(0, 300)}`);
    }
  });
}

inspectFullTraffic().catch(console.error);

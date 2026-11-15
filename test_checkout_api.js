/**
 * test_checkout_api.js
 * Inspeciona exatamente quais requisições a página checkout.livepix.gg faz
 */
const puppeteer = require('rebrowser-puppeteer');

async function inspectCheckoutFlow() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  let paymentId = null;

  page.on('response', async res => {
    const url = res.url();
    try {
      if (url.includes('/tip') && res.status() === 200) {
        const json = await res.json();
        paymentId = json?.paymentId;
        console.log('⚡ paymentId capturado:', paymentId, JSON.stringify(json));
      } else if (url.includes('checkout') || url.includes('pix') || url.includes('infopago') || url.includes('webservice')) {
        const text = await res.text();
        if (text.includes('000201') || text.includes('qr') || text.includes('pix')) {
          console.log('🔥 RESPOSTA COM PIX ENCONTRADA!');
          console.log('  URL:', url);
          console.log('  Status:', res.status());
          console.log('  Body:', text.slice(0, 300));
        }
      }
    } catch (_) {}
  });

  page.on('request', req => {
    const url = req.url();
    if (url.includes('checkout') || url.includes('tip') || url.includes('pix') || url.includes('payment')) {
      console.log(`➡️ [REQ ${req.method()}] ${url}`);
      if (req.postData()) console.log(`   Data:`, req.postData());
    }
  });

  console.log('1. Acessando perfil...');
  await page.goto('https://livepix.gg/luizaa', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]');

  await page.type('input[name="username"]', '5511999998888');
  await page.type('textarea[name="message"]', 'ORD_API_TEST');

  const amountInput = await page.$('input[name="amount"]');
  if (amountInput) {
    await amountInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await amountInput.type('5,00');
  }

  // Clica Continuar
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const txt = await page.evaluate(el => el.innerText, b);
    if (txt && txt.trim().toLowerCase().includes('continuar')) {
      await b.click();
      break;
    }
  }

  console.log('2. Aguardando paymentId da API...');
  const start = Date.now();
  while (!paymentId && Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 200));
  }

  if (paymentId) {
    console.log('3. Navegando para checkout:', `https://checkout.livepix.gg/${paymentId}`);
    await page.goto(`https://checkout.livepix.gg/${paymentId}`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('button');
    const cButtons = await page.$$('button');
    for (const cb of cButtons) {
      const txt = await page.evaluate(el => el.innerText, cb);
      if (txt && txt.trim().toUpperCase() === 'CONTINUAR') {
        console.log('4. Clicando no Continuar do checkout...');
        await cb.click();
        break;
      }
    }

    // Espera 5s para ver as chamadas
    await new Promise(r => setTimeout(r, 5000));
  }

  await browser.close();
}

inspectCheckoutFlow().catch(console.error);

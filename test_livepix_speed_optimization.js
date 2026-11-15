/**
 * test_livepix_speed_optimization.js
 * Testa técnicas de aceleração extrema para o LivePix:
 * 1. Bloqueio de mídia/fontes/rastreadores
 * 2. Preenchimento instantâneo via DOM dispatchEvent (0ms)
 * 3. Remoção de timeouts arbitrários
 * 4. Reutilização de browser (Warm Browser Pool)
 */
const puppeteer = require('rebrowser-puppeteer');

async function testOptimizedLivepix() {
  console.log('⚡ Iniciando teste de velocidade otimizada do LivePix...');
  const t0 = Date.now();

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  console.log(`[+${Date.now() - t0}ms] Browser pronto`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 1. Bloqueia mídias pesadas, fontes, áudios e analytics que consomem tempo e banda
  await page.setRequestInterception(true);
  page.on('request', req => {
    const resType = req.resourceType();
    const url = req.url();
    if (
      ['image', 'media', 'font'].includes(resType) ||
      url.includes('google-analytics') ||
      url.includes('doubleclick') ||
      url.includes('sentry') ||
      url.includes('facebook')
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  console.log(`[+${Date.now() - t0}ms] Acessando livepix.gg/luizaa com bloqueio de mídia...`);
  await page.goto('https://livepix.gg/luizaa', { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log(`[+${Date.now() - t0}ms] DOM pronto!`);

  // 2. Preenchimento instantâneo (via DOM nativo com dispatchEvent, 0ms de delay)
  await page.waitForSelector('input[name="username"]', { timeout: 5000 });

  await page.evaluate(() => {
    const setVal = (sel, val) => {
      const el = document.querySelector(sel);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    setVal('input[name="username"]', '5511999998888');
    setVal('textarea[name="message"]', 'TESTE_VELOCIDADE');
    setVal('input[name="amount"]', '5,00');

    const cb = document.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) {
      cb.click();
    }
  });
  console.log(`[+${Date.now() - t0}ms] Campos preenchidos instantaneamente!`);

  // Pequeno tempo para validação do form
  await new Promise(r => setTimeout(r, 400));

  // Clica no botão Continuar
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('continuar'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log(`[+${Date.now() - t0}ms] Botão Continuar acionado: ${clicked}`);

  // Monitora abertura de recompensa ou checkout
  let pixCode = null;
  const waitStart = Date.now();
  let clickedCheckoutBtn = false;

  while (Date.now() - waitStart < 15000) {
    // Se apareceu tela de recompensa, clica no Continuar dela
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const rewardBtn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('continuar') && !b.disabled);
      if (rewardBtn) rewardBtn.click();
    }).catch(() => {});

    // Procura no frame de checkout ou na página
    const frames = page.frames();
    for (const f of frames) {
      try {
        // Se ainda não clicou no Continuar da escolha do Pix (Tela 2)
        if (!clickedCheckoutBtn) {
          const didClick = await f.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const cBtn = btns.find(b => b.innerText && b.innerText.trim().toUpperCase() === 'CONTINUAR');
            if (cBtn) {
              cBtn.click();
              return true;
            }
            return false;
          });
          if (didClick) {
            clickedCheckoutBtn = true;
            console.log(`[+${Date.now() - t0}ms] Botão de escolha Pix acionado no checkout!`);
          }
        }

        // Procura o input do Pix Copia e Cola (Tela 3)
        const code = await f.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          const found = inputs.find(i => i.value && i.value.startsWith('000201'));
          return found ? found.value : null;
        });

        if (code) {
          pixCode = code;
          break;
        }
      } catch (_) {}
    }

    if (pixCode) break;
    await new Promise(r => setTimeout(r, 200));
  }

  const totalTime = Date.now() - t0;
  console.log(`\n========================================`);
  console.log(`🏁 TEMPO TOTAL: ${totalTime}ms (${(totalTime / 1000).toFixed(1)} segundos)`);
  console.log(`🔑 Pix Code Obtido: ${pixCode ? pixCode.slice(0, 45) + '...' : 'FALHOU'}`);
  console.log(`========================================`);

  await browser.close();
}

testOptimizedLivepix().catch(console.error);

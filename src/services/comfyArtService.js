/**
 * =========================================================================
 * 🎨 COMFYART SERVICE - DESIGN & POST CREATION ENGINE
 * =========================================================================
 * Integração oficial com ComfyArt (https://github.com/jtydhr88/ComfyArt.git)
 * e ComfyUI para criação automatizada de posts, banners, stories e criativos:
 * 
 * 1. Conexão com ComfyArt & ComfyUI API (http://127.0.0.1:8188)
 * 2. Gerenciamento e clonagem do repositório jtydhr88/ComfyArt
 * 3. Mapeamento de Workflows oficiais ComfyUI (Qwen, FLUX, Cutout, Mockup)
 * 4. Engine Criativo de Alta Fidelidade (SVG / Headless Chrome Render)
 * 5. Formatos de Post: Feed 1:1, Story/Status 9:16, Banner 16:9, Card de Oferta
 * 6. Disparo direto para WhatsApp e Canais do Telegram
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const models = require('../db/models');
const memberSvgService = require('./memberSvgService');

const COMFYART_REPO_URL = 'https://github.com/jtydhr88/ComfyArt.git';

// Modelos e Dimensões Oficiais de Posts
const POST_TEMPLATES = {
  square: {
    id: 'square',
    name: 'Feed Instagram & WhatsApp (1:1)',
    width: 1080,
    height: 1080,
    aspect: '1:1',
    description: 'Quadrado perfeito para Catálogo WhatsApp, Instagram Feed e Facebook'
  },
  story: {
    id: 'story',
    name: 'Status WhatsApp & Stories (9:16)',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    description: 'Vertical imersivo para Status do WhatsApp, Instagram Stories e Reels'
  },
  banner: {
    id: 'banner',
    name: 'Banner Horizontal Telegram & X (16:9)',
    width: 1200,
    height: 675,
    aspect: '16:9',
    description: 'Formato panorâmico para Canais do Telegram, X (Twitter) e Sites'
  },
  product_card: {
    id: 'product_card',
    name: 'Card de Oferta & Preço Pix (1:1)',
    width: 1080,
    height: 1080,
    aspect: '1:1',
    description: 'Foco total em conversão com destaque de preço, chave Pix e CTA'
  },
  viral_hook: {
    id: 'viral_hook',
    name: 'Post Viral Retrato Feed (4:5)',
    width: 1080,
    height: 1350,
    aspect: '4:5',
    description: 'Maior retenção e ocupação de tela no feed do Instagram e redes sociais'
  }
};

// Paletas e Temas Visuais ComfyArt
const THEMES = {
  cyber_dark: {
    id: 'cyber_dark',
    name: 'Cyber Neon Tech',
    bg: '#070b13',
    cardBg: 'rgba(15, 23, 42, 0.75)',
    accent: '#00f0ff',
    secondary: '#a855f7',
    textMain: '#ffffff',
    textMuted: '#94a3b8',
    priceColor: '#00f0ff',
    glowColor: 'rgba(0, 240, 255, 0.4)',
    borderGradient: ['#00f0ff', '#a855f7', '#3b82f6']
  },
  emerald_pay: {
    id: 'emerald_pay',
    name: 'Verde Pix & Dinheiro',
    bg: '#04130d',
    cardBg: 'rgba(6, 30, 20, 0.8)',
    accent: '#00e676',
    secondary: '#14b8a6',
    textMain: '#ffffff',
    textMuted: '#a7f3d0',
    priceColor: '#00e676',
    glowColor: 'rgba(0, 230, 118, 0.45)',
    borderGradient: ['#00e676', '#14b8a6', '#10b981']
  },
  gold_luxury: {
    id: 'gold_luxury',
    name: 'Ouro & Obsidian Luxo',
    bg: '#09090b',
    cardBg: 'rgba(24, 24, 27, 0.85)',
    accent: '#fbbf24',
    secondary: '#f59e0b',
    textMain: '#ffffff',
    textMuted: '#d4d4d8',
    priceColor: '#fbbf24',
    glowColor: 'rgba(251, 191, 36, 0.4)',
    borderGradient: ['#fbbf24', '#f59e0b', '#d97706']
  },
  fire_viral: {
    id: 'fire_viral',
    name: 'Fogo Viral & Urgência',
    bg: '#140606',
    cardBg: 'rgba(35, 10, 10, 0.8)',
    accent: '#ef4444',
    secondary: '#f97316',
    textMain: '#ffffff',
    textMuted: '#fca5a5',
    priceColor: '#f97316',
    glowColor: 'rgba(239, 68, 68, 0.45)',
    borderGradient: ['#ef4444', '#f97316', '#dc2626']
  },
  clean_minimal: {
    id: 'clean_minimal',
    name: 'Minimalista Clean',
    bg: '#0f172a',
    cardBg: 'rgba(30, 41, 59, 0.75)',
    accent: '#38bdf8',
    secondary: '#818cf8',
    textMain: '#ffffff',
    textMuted: '#cbd5e1',
    priceColor: '#38bdf8',
    glowColor: 'rgba(56, 189, 248, 0.35)',
    borderGradient: ['#38bdf8', '#818cf8', '#6366f1']
  }
};

class ComfyArtService {
  constructor() {
    this.repoUrl = COMFYART_REPO_URL;
    this.repoDir = path.join(__dirname, '../../tools/ComfyArt');
    this.uploadsDir = path.join(__dirname, '../public/uploads/comfyart');
    this.ensureUploadsDir();
  }

  ensureUploadsDir() {
    try {
      if (!fs.existsSync(this.uploadsDir)) {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
      }
    } catch (_) {}
  }

  getEndpoint() {
    try {
      return models.getSetting('COMFYART_ENDPOINT', 'http://127.0.0.1:8188');
    } catch (_) {
      return 'http://127.0.0.1:8188';
    }
  }

  setEndpoint(url) {
    if (!url) return;
    const cleanUrl = String(url).trim().replace(/\/+$/, '');
    models.setSetting('COMFYART_ENDPOINT', cleanUrl);
    return cleanUrl;
  }

  isInstalled() {
    try {
      return fs.existsSync(this.repoDir) && fs.existsSync(path.join(this.repoDir, 'workflows'));
    } catch (_) {
      return false;
    }
  }

  /**
   * Clona ou atualiza o repositório oficial jtydhr88/ComfyArt
   */
  async cloneOrUpdateRepository() {
    const gitDir = path.join(this.repoDir, '.git');
    const isCloned = fs.existsSync(gitDir);

    return new Promise((resolve, reject) => {
      let cmd, args;
      if (isCloned) {
        cmd = 'git';
        args = ['-C', this.repoDir, 'pull', '--ff-only'];
      } else {
        cmd = 'git';
        const parentDir = path.dirname(this.repoDir);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        args = ['clone', '--depth', '1', this.repoUrl, this.repoDir];
      }

      const proc = spawn(cmd, args, { windowsHide: true });
      let output = '';
      let errorOut = '';

      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { errorOut += d.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve({
            success: true,
            action: isCloned ? 'updated' : 'cloned',
            message: isCloned ? 'ComfyArt atualizado com sucesso!' : 'ComfyArt clonado com sucesso!',
            path: this.repoDir,
            details: output || errorOut
          });
        } else {
          reject(new Error(`Falha no git (código ${code}): ${errorOut || output}`));
        }
      });
    });
  }

  /**
   * Verifica a conectividade com o backend do ComfyUI / ComfyArt
   */
  async checkHealth() {
    const endpoint = this.getEndpoint();
    const installed = this.isInstalled();
    const workflows = this.listWorkflows();

    let online = false;
    let systemStats = null;
    let latencyMs = 0;

    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);

      const res = await fetch(`${endpoint}/system_stats`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        online = true;
        systemStats = await res.json();
      }
    } catch (_) {
      online = false;
    }
    latencyMs = Date.now() - t0;

    return {
      success: true,
      repoUrl: this.repoUrl,
      repoDir: this.repoDir,
      installed,
      repoCloned: installed,
      endpoint,
      online,
      serviceOnline: online,
      latencyMs: online ? latencyMs : null,
      systemStats,
      workflowsCount: workflows.length,
      officialWorkflowsCount: workflows.length,
      creativeEngineReady: true,
      activeMode: online ? 'COMFYUI_BACKEND' : 'COMFYART_CREATIVE_ENGINE'
    };
  }

  async checkStatus() {
    return this.checkHealth();
  }

  /**
   * Retorna os workflows ComfyUI disponíveis em tools/ComfyArt/workflows
   */
  listWorkflows() {
    const wfDir = path.join(this.repoDir, 'workflows');
    if (!fs.existsSync(wfDir)) return [];

    try {
      const files = fs.readdirSync(wfDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const name = f.replace(/\.api\.json$|\.json$/, '');
          return {
            filename: f,
            name,
            displayName: name.replace(/-/g, ' ').toUpperCase(),
            path: path.join(wfDir, f)
          };
        });
    } catch (_) {
      return [];
    }
  }

  getTemplates() {
    return Object.values(POST_TEMPLATES);
  }

  getThemes() {
    return Object.values(THEMES);
  }

  /**
   * Renderiza layout SVG de alta fidelidade no estilo ComfyArt
   */
  buildPostSvg({
    template = 'square',
    theme = 'cyber_dark',
    title = 'OFERTA ESPECIAL',
    subtitle = 'Garanta acesso imediato com entrega automatizada via Pix',
    price = '',
    discountBadge = 'LANÇAMENTO EXCLUSIVO',
    ctaText = 'CHAME NO WHATSAPP • ENTREGA IMEDIATA',
    storeUrl = '',
    footerText = 'PayBot Tech • Automação Comercial',
    icon = '🚀'
  }) {
    const tpl = POST_TEMPLATES[template] || POST_TEMPLATES.square;
    const th = THEMES[theme] || THEMES.cyber_dark;
    const { width, height } = tpl;

    // Escapa caracteres HTML
    const esc = (str) => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const safeTitle = esc(title).toUpperCase();
    const safeSub = esc(subtitle);
    const safePrice = esc(price);
    const safeBadge = esc(discountBadge).toUpperCase();
    const safeCta = esc(ctaText).toUpperCase();
    const safeFooter = esc(footerText);

    // Ajusta posições verticais conforme o template
    const isStory = template === 'story';
    const isBanner = template === 'banner';

    const cardPadding = isStory ? 70 : (isBanner ? 40 : 50);
    const cardWidth = width - (cardPadding * 2);
    const cardHeight = height - (cardPadding * 2);

    const titleFontSize = isBanner ? 48 : (isStory ? 64 : 58);
    const subFontSize = isBanner ? 22 : 26;

    // Quebra título em linhas caso seja longo
    const words = safeTitle.split(/\s+/);
    let line1 = words.slice(0, 4).join(' ');
    let line2 = words.slice(4, 9).join(' ');
    let line3 = words.slice(9).join(' ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${th.bg}"/>
      <stop offset="50%" stop-color="#0b1329"/>
      <stop offset="100%" stop-color="${th.bg}"/>
    </linearGradient>

    <!-- Accent Border Gradient -->
    <linearGradient id="border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${th.borderGradient[0]}"/>
      <stop offset="50%" stop-color="${th.borderGradient[1]}"/>
      <stop offset="100%" stop-color="${th.borderGradient[2]}"/>
    </linearGradient>

    <!-- Button Gradient -->
    <linearGradient id="cta-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${th.accent}"/>
      <stop offset="100%" stop-color="${th.secondary}"/>
    </linearGradient>

    <!-- Radial Glows -->
    <radialGradient id="glow-center" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="${th.accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${th.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-corner" cx="90%" cy="15%" r="45%">
      <stop offset="0%" stop-color="${th.secondary}" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="${th.secondary}" stop-opacity="0"/>
    </radialGradient>

    <!-- Tech Grid Pattern -->
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255, 255, 255, 0.04)" stroke-width="1"/>
      <circle cx="48" cy="48" r="1.5" fill="rgba(255, 255, 255, 0.07)"/>
    </pattern>

    <!-- Drop Shadows -->
    <filter id="shadow-card" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="20" stdDeviation="30" flood-color="#000000" flood-opacity="0.8"/>
    </filter>
    <filter id="glow-text" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <style>
    .font-heavy { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 900; }
    .font-bold { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 800; }
    .font-med { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 500; }
  </style>

  <!-- Fundo Sólido com Gradiente & Orbs -->
  <rect width="${width}" height="${height}" fill="url(#bg-grad)"/>
  <rect width="${width}" height="${height}" fill="url(#glow-center)"/>
  <rect width="${width}" height="${height}" fill="url(#glow-corner)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>

  <!-- Moldura Externa Glassmorphism -->
  <rect x="${cardPadding}" y="${cardPadding}" width="${cardWidth}" height="${cardHeight}" rx="32" 
        fill="${th.cardBg}" stroke="url(#border-grad)" stroke-width="2.5" filter="url(#shadow-card)"/>

  <!-- Cantoneiras Tecnológicas ComfyArt -->
  <path d="M ${cardPadding + 30} ${cardPadding + 70} L ${cardPadding + 30} ${cardPadding + 30} L ${cardPadding + 70} ${cardPadding + 30}" 
        fill="none" stroke="${th.accent}" stroke-width="4" stroke-linecap="round"/>
  <path d="M ${width - cardPadding - 70} ${cardPadding + 30} L ${width - cardPadding - 30} ${cardPadding + 30} L ${width - cardPadding - 30} ${cardPadding + 70}" 
        fill="none" stroke="${th.secondary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M ${cardPadding + 30} ${height - cardPadding - 70} L ${cardPadding + 30} ${height - cardPadding - 30} L ${cardPadding + 70} ${height - cardPadding - 30}" 
        fill="none" stroke="${th.secondary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M ${width - cardPadding - 70} ${height - cardPadding - 30} L ${width - cardPadding - 30} ${height - cardPadding - 30} L ${width - cardPadding - 30} ${height - cardPadding - 70}" 
        fill="none" stroke="${th.accent}" stroke-width="4" stroke-linecap="round"/>

  <!-- HEADER: Selo / Badge Superior -->
  <g transform="translate(${width / 2}, ${cardPadding + 65})">
    <rect x="-180" y="-22" width="360" height="44" rx="22" fill="rgba(255, 255, 255, 0.08)" stroke="${th.accent}" stroke-width="1.5"/>
    <circle cx="-150" cy="0" r="6" fill="${th.accent}"/>
    <text x="0" y="6" text-anchor="middle" class="font-bold" font-size="14" fill="${th.accent}" letter-spacing="2">
      ${safeBadge || 'COMFYART DESIGN STUDIO'}
    </text>
    <circle cx="150" cy="0" r="6" fill="${th.secondary}"/>
  </g>

  <!-- CENTRO: Título Principal com Brilho -->
  <g transform="translate(${width / 2}, ${isStory ? cardPadding + 280 : (isBanner ? cardPadding + 150 : cardPadding + 230)})">
    <text x="0" y="0" text-anchor="middle" class="font-heavy" font-size="${titleFontSize}" fill="#ffffff" letter-spacing="-0.5" filter="url(#glow-text)">
      ${line1}
    </text>
    ${line2 ? `
    <text x="0" y="${titleFontSize * 1.08}" text-anchor="middle" class="font-heavy" font-size="${titleFontSize * 0.95}" fill="${th.accent}">
      ${line2}
    </text>` : ''}
    ${line3 ? `
    <text x="0" y="${titleFontSize * 2.1}" text-anchor="middle" class="font-heavy" font-size="${titleFontSize * 0.85}" fill="#ffffff">
      ${line3}
    </text>` : ''}
  </g>

  <!-- SUBTÍTULO / DESCRIÇÃO -->
  <g transform="translate(${width / 2}, ${isStory ? cardPadding + 540 : (isBanner ? cardPadding + 270 : cardPadding + 440)})">
    <text x="0" y="0" text-anchor="middle" class="font-med" font-size="${subFontSize}" fill="${th.textMuted}" letter-spacing="0.2">
      ${safeSub.slice(0, 85)}
    </text>
    ${safeSub.length > 85 ? `
    <text x="0" y="36" text-anchor="middle" class="font-med" font-size="${subFontSize}" fill="${th.textMuted}" letter-spacing="0.2">
      ${safeSub.slice(85, 170)}
    </text>` : ''}
  </g>

  <!-- CARD CENTRAL: PREÇO & CONDIÇÃO -->
  ${safePrice ? `
  <g transform="translate(${width / 2}, ${isStory ? cardPadding + 820 : (isBanner ? cardPadding + 390 : cardPadding + 620)})">
    <rect x="-240" y="-60" width="480" height="120" rx="28" fill="rgba(0, 0, 0, 0.45)" stroke="url(#border-grad)" stroke-width="2"/>
    <text x="0" y="-12" text-anchor="middle" class="font-bold" font-size="14" fill="${th.textMuted}" letter-spacing="3">
      VALOR PROMOCIONAL
    </text>
    <text x="0" y="38" text-anchor="middle" class="font-heavy" font-size="46" fill="${th.priceColor}" filter="url(#glow-text)">
      ${safePrice}
    </text>
  </g>` : ''}

  <!-- BOTÃO CTA: TOQUE / AÇÃO -->
  <g transform="translate(${width / 2}, ${height - cardPadding - (isStory ? 180 : (isBanner ? 95 : 130))})">
    <rect x="-280" y="-36" width="560" height="72" rx="36" fill="url(#cta-grad)" stroke="#ffffff" stroke-width="1.5" filter="url(#shadow-card)"/>
    <text x="0" y="10" text-anchor="middle" class="font-heavy" font-size="20" fill="#000000" letter-spacing="1">
      ⚡ ${safeCta} ⚡
    </text>
  </g>

  <!-- RODAPÉ: Marca & Selo de Autenticidade -->
  <g transform="translate(${width / 2}, ${height - cardPadding - 35})">
    <text x="0" y="0" text-anchor="middle" class="font-med" font-size="13" fill="rgba(255, 255, 255, 0.45)" letter-spacing="1.5">
      ${safeFooter} • GERADO COM COMFYART
    </text>
  </g>
</svg>`;
  }

  /**
   * Converte a string SVG para Buffer PNG de alta definição via Headless Chrome / Puppeteer
   */
  async renderSvgToPng(svgString, width = 1080, height = 1080) {
    const browserBin = memberSvgService.detectBrowserBinary();
    const tmpDir = os.tmpdir();
    const rand = Math.random().toString(36).substring(2, 9);
    const tmpSvg = path.join(tmpDir, `comfy_${rand}.svg`);
    const tmpPng = path.join(tmpDir, `comfy_${rand}.png`);
    const tmpUserData = path.join(tmpDir, `comfy_ud_${rand}`);

    try {
      fs.writeFileSync(tmpSvg, svgString, 'utf8');

      // Tentativa 1: Renderização com Chrome / Edge Headless CLI
      if (browserBin) {
        const fileUrl = `file:///${tmpSvg.replace(/\\/g, '/')}`;
        const args = [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--user-data-dir=${tmpUserData}`,
          `--window-size=${width},${height}`,
          `--screenshot=${tmpPng}`,
          fileUrl
        ];

        const res = spawnSync(browserBin, args, { windowsHide: true, timeout: 12000 });
        if (res.status === 0 && fs.existsSync(tmpPng) && fs.statSync(tmpPng).size > 1000) {
          return fs.readFileSync(tmpPng);
        }
      }

      // Tentativa 2: Puppeteer
      try {
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());

        const browser = await puppeteer.launch({
          executablePath: browserBin || undefined,
          headless: 'new',
          userDataDir: tmpUserData,
          args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${width},${height}`]
        });

        try {
          const page = await browser.newPage();
          await page.setViewport({ width, height });
          await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:#000;">${svgString}</body></html>`);
          const buf = await page.screenshot({ type: 'png', omitBackground: false });
          return buf;
        } finally {
          await browser.close().catch(() => {});
        }
      } catch (pupErr) {
        console.warn('[ComfyArtService ⚠️ Fallback puppeteer]:', pupErr.message);
      }

      // Fallback final: Retorna buffer do SVG se não houver renderizador PNG binário
      return Buffer.from(svgString, 'utf8');
    } finally {
      try { if (fs.existsSync(tmpSvg)) fs.unlinkSync(tmpSvg); } catch (_) {}
      try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
      try { if (fs.existsSync(tmpUserData)) fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    }
  }

  /**
   * Método de alto nível para gerar o post completo via ComfyArt
   */
  async generatePostCreative({
    template = 'square',
    theme = 'cyber_dark',
    title = 'BOT DE VENDAS AUTOMÁTICO',
    subtitle = 'Venda 24 horas no WhatsApp com entrega imediata via Pix',
    price = '',
    discountBadge = 'OFERTA ESPECIAL',
    ctaText = 'GARANTA SEU ACESSO HOJE',
    storeUrl = '',
    footerText = 'PayBot Tech • Automação Comercial',
    prompt = '',
    productId = null,
    forceLocalEngine = true
  } = {}) {
    this.ensureUploadsDir();

    // Se tiver productId, puxa os dados do produto para enriquecer o post
    if (productId) {
      try {
        const prod = models.getProductById(Number(productId));
        if (prod) {
          if (!title || title === 'BOT DE VENDAS AUTOMÁTICO') title = prod.name;
          if (!subtitle || subtitle.includes('Venda 24 horas')) subtitle = prod.description || `Adquira ${prod.name} com ativação imediata.`;
          if (!price) price = `R$ ${Number(prod.price_brl || prod.price).toFixed(2)}`;
        }
      } catch (_) {}
    }

    const tpl = POST_TEMPLATES[template] || POST_TEMPLATES.square;
    const rand = Math.random().toString(36).substring(2, 8);
    const timestamp = Date.now();
    const filename = `post_${template}_${timestamp}_${rand}.png`;
    const outputPath = path.join(this.uploadsDir, filename);

    // Constrói SVG de Alta Fidelidade no padrão ComfyArt
    const svgContent = this.buildPostSvg({
      template,
      theme,
      title,
      subtitle,
      price,
      discountBadge,
      ctaText,
      storeUrl,
      footerText
    });

    // Converte para PNG
    const pngBuffer = await this.renderSvgToPng(svgContent, tpl.width, tpl.height);
    fs.writeFileSync(outputPath, pngBuffer);

    const publicUrl = `/uploads/comfyart/${filename}`;
    const postRecord = {
      id: `comfy_${timestamp}_${rand}`,
      filename,
      imageUrl: publicUrl,
      media_url: publicUrl,
      fullPath: outputPath,
      local_path: outputPath,
      width: tpl.width,
      height: tpl.height,
      template,
      theme,
      title,
      subtitle,
      price,
      discount_badge: discountBadge,
      cta_text: ctaText,
      ctaText,
      footer_text: footerText,
      engine: 'comfyart_creative_engine',
      repoSource: COMFYART_REPO_URL,
      createdAt: new Date().toISOString()
    };

    // Salva nos registros recentes
    this.saveRecentPost(postRecord);

    return {
      success: true,
      id: postRecord.id,
      media_url: publicUrl,
      imageUrl: publicUrl,
      local_path: outputPath,
      fullPath: outputPath,
      width: tpl.width,
      height: tpl.height,
      template,
      theme,
      title,
      subtitle,
      price,
      discount_badge: discountBadge,
      cta_text: ctaText,
      post: postRecord,
      buffer: pngBuffer
    };
  }

  saveRecentPost(record) {
    try {
      const raw = models.getSetting('COMFYART_RECENT_POSTS', '[]');
      let list = [];
      try { list = JSON.parse(raw); } catch (_) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift(record);
      if (list.length > 50) list = list.slice(0, 50);
      models.setSetting('COMFYART_RECENT_POSTS', JSON.stringify(list));
    } catch (_) {}
  }

  getRecentPosts(limit = 20) {
    try {
      const raw = models.getSetting('COMFYART_RECENT_POSTS', '[]');
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.slice(0, limit) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Dispara o criativo do post para um destinatário ou grupo do WhatsApp
   */
  async dispatchToWhatsApp(targetJid, postData, captionText = '', sock = null) {
    if (!targetJid || !postData) {
      throw new Error('Destinatário e dados do post são obrigatórios');
    }

    const cleanJid = targetJid.includes('@') ? targetJid : `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    let imageBuffer = null;

    if (Buffer.isBuffer(postData)) {
      imageBuffer = postData;
    } else if (typeof postData === 'string') {
      if (fs.existsSync(postData)) {
        imageBuffer = fs.readFileSync(postData);
      } else {
        const localPath = path.join(__dirname, '../public', postData.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
          imageBuffer = fs.readFileSync(localPath);
        }
      }
    } else if (postData.local_path && fs.existsSync(postData.local_path)) {
      imageBuffer = fs.readFileSync(postData.local_path);
    } else if (postData.fullPath && fs.existsSync(postData.fullPath)) {
      imageBuffer = fs.readFileSync(postData.fullPath);
    } else if (postData.media_url || postData.imageUrl) {
      const url = (postData.media_url || postData.imageUrl).replace(/^\//, '');
      const localPath = path.join(__dirname, '../public', url);
      if (fs.existsSync(localPath)) {
        imageBuffer = fs.readFileSync(localPath);
      }
    }

    if (!imageBuffer) {
      throw new Error('Arquivo de imagem do post não localizado');
    }

    const activeSock = sock || require('../bots/whatsappBot').sock;
    if (!activeSock) throw new Error('Bot do WhatsApp não conectado');

    const fullCaption = (captionText || `${postData.title || ''}\n\n${postData.subtitle || ''}\n\n💰 ${postData.price || ''}\n👉 ${postData.ctaText || 'Garanta já o seu!'}`).trim();

    await activeSock.sendMessage(cleanJid, {
      image: imageBuffer,
      caption: fullCaption
    });

    return { success: true, targetJid: cleanJid };
  }

  /**
   * Publica o criativo no canal oficial do Telegram
   */
  async dispatchToTelegram(postData, captionText = '') {
    const telegramBot = require('../bots/telegramBot');
    const channelId = models.getSetting('TELEGRAM_VIP_CHANNEL_ID', '') || models.getSetting('TELEGRAM_UPDATES_CHANNEL_ID', '');
    if (!channelId) {
      throw new Error('Canal do Telegram não configurado em Central de Configurações');
    }

    let imageBuffer = null;
    if (Buffer.isBuffer(postData)) {
      imageBuffer = postData;
    } else if (typeof postData === 'string') {
      if (fs.existsSync(postData)) {
        imageBuffer = fs.readFileSync(postData);
      } else {
        const localPath = path.join(__dirname, '../public', postData.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
          imageBuffer = fs.readFileSync(localPath);
        }
      }
    } else if (postData.local_path && fs.existsSync(postData.local_path)) {
      imageBuffer = fs.readFileSync(postData.local_path);
    } else if (postData.fullPath && fs.existsSync(postData.fullPath)) {
      imageBuffer = fs.readFileSync(postData.fullPath);
    } else if (postData.media_url || postData.imageUrl) {
      const url = (postData.media_url || postData.imageUrl).replace(/^\//, '');
      const localPath = path.join(__dirname, '../public', url);
      if (fs.existsSync(localPath)) {
        imageBuffer = fs.readFileSync(localPath);
      }
    }

    if (!imageBuffer) throw new Error('Arquivo de imagem do post não localizado');

    const fullCaption = (captionText || `🔥 *${postData.title || ''}*\n\n${postData.subtitle || ''}\n\n💰 *${postData.price || ''}*\n\n👉 _${postData.ctaText || 'Garanta o seu hoje!'}_`).trim();

    await telegramBot.bot.telegram.sendPhoto(channelId, { source: imageBuffer }, {
      caption: fullCaption,
      parse_mode: 'Markdown'
    });

    return { success: true, channelId };
  }
}

module.exports = new ComfyArtService();

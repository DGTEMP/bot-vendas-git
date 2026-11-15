const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const models = require('../db/models');

/**
 * =========================================================================
 * 🎨 MEMBER SVG SERVICE - PAYBOT TECH
 * =========================================================================
 * Geração de cartões e banners vetoriais SVG 100% personalizados para
 * novos membros em boas-vindas e perfis de usuários.
 *
 * Recursos:
 * - 6 Temas Visuais (Cyber, Gold VIP, Aurora, Neon Synthwave, Dark Slate, Sunset)
 * - Suporte à foto real do perfil (Base64 embutido) ou Avatar Vetorial elegante
 * - Tags dinâmicas: Nome, Telefone, Grupo, Contagem de Membro, Data/Hora, Badges
 * - Conversão de altíssima performance SVG -> PNG (Chrome / Edge / Puppeteer)
 * - Suporte a envio de Imagem no feed do chat e arquivo .svg vetorial anexado
 * =========================================================================
 */

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const THEMES = {
  cyber: {
    id: 'cyber',
    name: 'Cyberpunk Neon',
    bgFrom: '#090d16',
    bgTo: '#0f172a',
    accent: '#06b6d4',
    accentSecondary: '#8b5cf6',
    accentGradient: ['#06b6d4', '#3b82f6', '#8b5cf6'],
    badgeBg: ['#0284c7', '#6366f1'],
    textPrimary: '#ffffff',
    textSecondary: '#94a3b8',
    glowColor: 'rgba(6, 182, 212, 0.45)',
    borderGradient: ['#06b6d4', '#6366f1', '#ec4899']
  },
  gold: {
    id: 'gold',
    name: 'Ouro VIP Luxury',
    bgFrom: '#0a0a0c',
    bgTo: '#18181b',
    accent: '#fbbf24',
    accentSecondary: '#d97706',
    accentGradient: ['#fef08a', '#fbbf24', '#d97706'],
    badgeBg: ['#b45309', '#f59e0b'],
    textPrimary: '#ffffff',
    textSecondary: '#d4d4d8',
    glowColor: 'rgba(251, 191, 36, 0.4)',
    borderGradient: ['#fef08a', '#f59e0b', '#78350f']
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora Boreal',
    bgFrom: '#022c22',
    bgTo: '#0f172a',
    accent: '#10b981',
    accentSecondary: '#06b6d4',
    accentGradient: ['#34d399', '#10b981', '#06b6d4'],
    badgeBg: ['#059669', '#0d9488'],
    textPrimary: '#ffffff',
    textSecondary: '#a7f3d0',
    glowColor: 'rgba(16, 185, 129, 0.45)',
    borderGradient: ['#34d399', '#06b6d4', '#3b82f6']
  },
  neon: {
    id: 'neon',
    name: 'Synthwave Neon',
    bgFrom: '#120726',
    bgTo: '#2e1065',
    accent: '#ec4899',
    accentSecondary: '#8b5cf6',
    accentGradient: ['#f43f5e', '#ec4899', '#a855f7'],
    badgeBg: ['#be185d', '#7e22ce'],
    textPrimary: '#ffffff',
    textSecondary: '#fbcfe8',
    glowColor: 'rgba(236, 72, 153, 0.45)',
    borderGradient: ['#f43f5e', '#ec4899', '#8b5cf6']
  },
  dark: {
    id: 'dark',
    name: 'Dark Slate Glass',
    bgFrom: '#0b0f17',
    bgTo: '#1e293b',
    accent: '#38bdf8',
    accentSecondary: '#94a3b8',
    accentGradient: ['#38bdf8', '#818cf8', '#c084fc'],
    badgeBg: ['#334155', '#475569'],
    textPrimary: '#ffffff',
    textSecondary: '#94a3b8',
    glowColor: 'rgba(56, 189, 248, 0.3)',
    borderGradient: ['#38bdf8', '#64748b', '#94a3b8']
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset Twilight',
    bgFrom: '#1e112a',
    bgTo: '#3b0764',
    accent: '#f97316',
    accentSecondary: '#f43f5e',
    accentGradient: ['#fbbf24', '#f97316', '#f43f5e'],
    badgeBg: ['#ea580c', '#e11d48'],
    textPrimary: '#ffffff',
    textSecondary: '#fed7aa',
    glowColor: 'rgba(249, 115, 22, 0.45)',
    borderGradient: ['#fbbf24', '#f97316', '#db2777']
  }
};

class MemberSvgService {
  constructor() {
    this.chromePath = this.detectBrowserBinary();
  }

  /**
   * Detecta executável do Chrome ou Edge no sistema Windows
   */
  detectBrowserBinary() {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.CHROME_BIN,
      process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Retorna os temas disponíveis
   */
  getThemes() {
    return Object.values(THEMES);
  }

  /**
   * Verifica se o card SVG de boas-vindas está ativado para o grupo ou privado
   */
  isWelcomeSvgEnabled(groupId) {
    if (!groupId) return true;
    const cleanId = String(groupId).trim();
    const val = models.getSetting(`WELCOME_SVG_${cleanId}`, null);
    if (val !== null) return val === 'true';
    if (cleanId.includes('@s.whatsapp.net') || cleanId === 'pv') {
      const pvVal = models.getSetting('WELCOME_SVG_PV', null);
      if (pvVal !== null) return pvVal === 'true';
    }
    return true; // Padrão ativado quando as boas-vindas estiverem ativas
  }

  /**
   * Ativa ou desativa o card SVG para o grupo ou privado
   */
  setWelcomeSvgEnabled(groupId, enabled) {
    if (!groupId) return;
    const cleanId = String(groupId).trim();
    models.setSetting(`WELCOME_SVG_${cleanId}`, enabled ? 'true' : 'false');
    if (cleanId === 'pv' || cleanId.includes('@s.whatsapp.net')) {
      models.setSetting('WELCOME_SVG_PV', enabled ? 'true' : 'false');
    }
  }

  /**
   * Retorna o tema configurado para o grupo ou privado
   */
  getWelcomeSvgTheme(groupId) {
    if (!groupId) return 'cyber';
    const cleanId = String(groupId).trim();
    let val = models.getSetting(`WELCOME_SVG_THEME_${cleanId}`, null);
    if (!val && (cleanId.includes('@s.whatsapp.net') || cleanId === 'pv')) {
      val = models.getSetting('WELCOME_SVG_THEME_PV', null);
    }
    val = val || 'cyber';
    return THEMES[val] ? val : 'cyber';
  }

  /**
   * Altera o tema configurado para o grupo ou privado
   */
  setWelcomeSvgTheme(groupId, theme) {
    if (!groupId) return 'cyber';
    const cleanId = String(groupId).trim();
    const cleanTheme = String(theme || 'cyber').toLowerCase().trim();
    const validTheme = THEMES[cleanTheme] ? cleanTheme : 'cyber';
    models.setSetting(`WELCOME_SVG_THEME_${cleanId}`, validTheme);
    if (cleanId === 'pv' || cleanId.includes('@s.whatsapp.net')) {
      models.setSetting('WELCOME_SVG_THEME_PV', validTheme);
    }
    return validTheme;
  }

  /**
   * Verifica se deve enviar o documento .svg junto com a imagem
   */
  isWelcomeSvgDocEnabled(groupId) {
    if (!groupId) return false;
    const cleanId = String(groupId).trim();
    const val = models.getSetting(`WELCOME_SVG_DOC_${cleanId}`, null);
    if (val !== null) return val === 'true';
    if (cleanId.includes('@s.whatsapp.net') || cleanId === 'pv') {
      return models.getSetting('WELCOME_SVG_DOC_PV', 'false') === 'true';
    }
    return false;
  }

  /**
   * Configura envio do arquivo .svg original
   */
  setWelcomeSvgDocEnabled(groupId, enabled) {
    if (!groupId) return;
    const cleanId = String(groupId).trim();
    models.setSetting(`WELCOME_SVG_DOC_${cleanId}`, enabled ? 'true' : 'false');
    if (cleanId === 'pv' || cleanId.includes('@s.whatsapp.net')) {
      models.setSetting('WELCOME_SVG_DOC_PV', enabled ? 'true' : 'false');
    }
  }

  /**
   * Retorna o título personalizado do card
   */
  getWelcomeSvgTitle(groupId) {
    if (!groupId) return 'BEM-VINDO(A)';
    return models.getSetting(`WELCOME_SVG_TITLE_${String(groupId).trim()}`, 'BEM-VINDO(A)');
  }

  /**
   * Altera o título personalizado do card
   */
  setWelcomeSvgTitle(groupId, title) {
    if (!groupId) return;
    models.setSetting(`WELCOME_SVG_TITLE_${String(groupId).trim()}`, String(title || 'BEM-VINDO(A)').trim());
  }

  /**
   * Baixa foto de perfil do participante e converte para Data URI Base64
   */
  async fetchAvatarBase64(sock, jid) {
    if (!sock || !jid) return null;
    try {
      if (typeof sock.profilePictureUrl !== 'function') return null;
      const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
      if (!url) return null;

      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;

      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${b64}`;
    } catch (_) {
      return null;
    }
  }

  /**
   * Baixa foto de perfil do usuário no Telegram e converte para Data URI Base64
   */
  async fetchTelegramAvatarBase64(bot, userId) {
    if (!bot || !userId) return null;
    try {
      const photos = await bot.telegram.getUserProfilePhotos(userId, 0, 1).catch(() => null);
      if (!photos || !photos.total_count || !photos.photos.length) return null;

      const photoArr = photos.photos[0];
      const bestPhoto = photoArr[photoArr.length - 1];
      if (!bestPhoto?.file_id) return null;

      const link = await bot.telegram.getFileLink(bestPhoto.file_id);
      if (!link) return null;

      const res = await fetch(link.href || link, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;

      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      return `data:image/jpeg;base64,${b64}`;
    } catch (_) {
      return null;
    }
  }

  /**
   * Gera a string SVG personalizada para o membro
   */
  generateMemberWelcomeSvg({
    memberName = 'Novo Membro',
    groupName = 'Comunidade Oficial',
    memberNumber = '1',
    date = null,
    avatarBase64 = null,
    theme = 'cyber',
    customTitle = 'BEM-VINDO(A)',
    customSubtitle = 'Seja muito bem-vindo à nossa comunidade oficial!',
    memberRole = 'MEMBRO OFICIAL'
  } = {}) {
    const activeTheme = THEMES[theme] || THEMES.cyber;
    const safeName = escapeXml(String(memberName).slice(0, 28));
    const safeGroup = escapeXml(String(groupName).slice(0, 34));
    const safeTitle = escapeXml(String(customTitle || 'BEM-VINDO(A)').slice(0, 24).toUpperCase());
    const safeSubtitle = escapeXml(String(customSubtitle || 'Seja muito bem-vindo à nossa comunidade oficial!').slice(0, 75));
    const safeNumber = escapeXml(String(memberNumber || '1'));
    const safeRole = escapeXml(String(memberRole || 'MEMBRO OFICIAL').slice(0, 20).toUpperCase());

    const formattedDate = date || new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo'
    }).format(new Date());

    const safeDate = escapeXml(formattedDate);
    const initial = safeName.replace(/[@+]/g, '').trim().charAt(0).toUpperCase() || 'M';

    const avatarSvg = avatarBase64
      ? `<image href="${avatarBase64}" x="100" y="205" width="220" height="220" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>`
      : `
        <!-- Fallback Vector Avatar -->
        <circle cx="210" cy="315" r="105" fill="url(#avatar-fallback-gradient)" clip-path="url(#avatar-clip)"/>
        <circle cx="210" cy="275" r="42" fill="${activeTheme.textPrimary}" opacity="0.9"/>
        <path d="M 140 395 C 140 335, 280 335, 280 395 Z" fill="${activeTheme.textPrimary}" opacity="0.9"/>
        <text x="210" y="325" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="900" fill="#ffffff" text-anchor="middle" opacity="0.3">${initial}</text>
      `;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${activeTheme.bgFrom}"/>
      <stop offset="100%" stop-color="${activeTheme.bgTo}"/>
    </linearGradient>

    <!-- Accent Gradient -->
    <linearGradient id="accent-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${activeTheme.accentGradient[0]}"/>
      <stop offset="50%" stop-color="${activeTheme.accentGradient[1]}"/>
      <stop offset="100%" stop-color="${activeTheme.accentGradient[2]}"/>
    </linearGradient>

    <!-- Border Gradient -->
    <linearGradient id="border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${activeTheme.borderGradient[0]}"/>
      <stop offset="50%" stop-color="${activeTheme.borderGradient[1]}"/>
      <stop offset="100%" stop-color="${activeTheme.borderGradient[2]}"/>
    </linearGradient>

    <!-- Badge Gradient -->
    <linearGradient id="badge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${activeTheme.badgeBg[0]}"/>
      <stop offset="100%" stop-color="${activeTheme.badgeBg[1]}"/>
    </linearGradient>

    <!-- Fallback Avatar Gradient -->
    <linearGradient id="avatar-fallback-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${activeTheme.accentSecondary}"/>
      <stop offset="100%" stop-color="${activeTheme.accent}"/>
    </linearGradient>

    <!-- Radial Glows -->
    <radialGradient id="glow-left" cx="20%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${activeTheme.accent}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${activeTheme.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-right" cx="80%" cy="20%" r="40%">
      <stop offset="0%" stop-color="${activeTheme.accentSecondary}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${activeTheme.accentSecondary}" stop-opacity="0"/>
    </radialGradient>

    <!-- Clip Path for Avatar -->
    <clipPath id="avatar-clip">
      <circle cx="210" cy="315" r="105"/>
    </clipPath>

    <!-- Tech Grid Pattern -->
    <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.04)" stroke-width="1"/>
      <circle cx="40" cy="40" r="1.5" fill="rgba(255, 255, 255, 0.08)"/>
    </pattern>

    <!-- Drop Shadows & Glow -->
    <filter id="shadow-card" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
    <filter id="glow-avatar" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <style>
    .font-title { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 800; }
    .font-sans { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .text-glow { filter: drop-shadow(0 2px 10px ${activeTheme.glowColor}); }
  </style>

  <!-- Base Background -->
  <rect width="1200" height="630" rx="36" fill="url(#bg-grad)"/>

  <!-- Glowing Radial Orbs -->
  <rect width="1200" height="630" rx="36" fill="url(#glow-left)"/>
  <rect width="1200" height="630" rx="36" fill="url(#glow-right)"/>

  <!-- Tech Grid Overlay -->
  <rect width="1200" height="630" rx="36" fill="url(#grid-pattern)"/>

  <!-- Outer Card Border -->
  <rect x="12" y="12" width="1176" height="606" rx="28" fill="none" stroke="url(#border-grad)" stroke-width="2.5" opacity="0.85"/>

  <!-- Inner Subtle Glass Panel -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="rgba(255, 255, 255, 0.02)" stroke="rgba(255, 255, 255, 0.06)" stroke-width="1"/>

  <!-- Decorative Corner Brackets -->
  <path d="M 60 90 L 60 60 L 90 60" fill="none" stroke="${activeTheme.accent}" stroke-width="3" stroke-linecap="round"/>
  <path d="M 1140 90 L 1140 60 L 1110 60" fill="none" stroke="${activeTheme.accentSecondary}" stroke-width="3" stroke-linecap="round"/>
  <path d="M 60 540 L 60 570 L 90 570" fill="none" stroke="${activeTheme.accentSecondary}" stroke-width="3" stroke-linecap="round"/>
  <path d="M 1140 540 L 1140 570 L 1110 570" fill="none" stroke="${activeTheme.accent}" stroke-width="3" stroke-linecap="round"/>

  <!-- ================= AVATAR SECTION ================= -->
  <!-- Outer Glow Halo -->
  <circle cx="210" cy="315" r="116" fill="none" stroke="${activeTheme.accent}" stroke-width="3" opacity="0.5" filter="url(#glow-avatar)"/>
  
  <!-- Outer Ring Accent -->
  <circle cx="210" cy="315" r="112" fill="none" stroke="url(#border-grad)" stroke-width="5"/>
  
  <!-- Avatar Background Base -->
  <circle cx="210" cy="315" r="105" fill="#1e293b"/>

  <!-- Avatar Image or Vector Fallback -->
  ${avatarSvg}

  <!-- Online Status Indicator Dot -->
  <circle cx="290" cy="390" r="18" fill="#10b981" stroke="${activeTheme.bgFrom}" stroke-width="5"/>
  <circle cx="290" cy="390" r="8" fill="#ffffff" opacity="0.75"/>

  <!-- Role / Level Pill Below Avatar -->
  <g transform="translate(125, 445)">
    <rect width="170" height="34" rx="17" fill="rgba(15, 23, 42, 0.85)" stroke="url(#border-grad)" stroke-width="1.5"/>
    <text x="85" y="22" class="font-sans" font-size="12" font-weight="700" fill="${activeTheme.accent}" text-anchor="middle" letter-spacing="1.5">★ ${safeRole} ★</text>
  </g>

  <!-- ================= CONTENT SECTION ================= -->
  <!-- Top Welcome Pill Badge -->
  <g transform="translate(390, 85)">
    <rect width="220" height="38" rx="19" fill="url(#badge-grad)"/>
    <text x="110" y="24" class="font-sans" font-size="14" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="2">🎉 ${safeTitle}</text>
  </g>

  <!-- Member Name / Phone (Large Header) -->
  <text x="390" y="195" class="font-title text-glow" font-size="52" fill="${activeTheme.textPrimary}">${safeName}</text>

  <!-- Group Destination -->
  <g transform="translate(390, 240)">
    <text x="0" y="20" class="font-sans" font-size="22" font-weight="500" fill="${activeTheme.textSecondary}">Seja bem-vindo(a) ao grupo:</text>
    <text x="0" y="58" class="font-title text-glow" font-size="34" fill="url(#accent-grad)">${safeGroup}</text>
  </g>

  <!-- Custom Subtitle / Community Greeting -->
  <text x="390" y="350" class="font-sans" font-size="19" fill="#cbd5e1" font-style="italic" opacity="0.95">"${safeSubtitle}"</text>

  <!-- Badges Info Bar -->
  <g transform="translate(390, 395)">
    <!-- Member Number Badge -->
    <rect x="0" y="0" width="180" height="46" rx="12" fill="rgba(255, 255, 255, 0.05)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1"/>
    <text x="20" y="29" class="font-sans" font-size="16" font-weight="700" fill="${activeTheme.accent}">👥 Membro #${safeNumber}</text>

    <!-- Entry Date Badge -->
    <rect x="200" y="0" width="170" height="46" rx="12" fill="rgba(255, 255, 255, 0.05)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1"/>
    <text x="220" y="29" class="font-sans" font-size="16" font-weight="600" fill="${activeTheme.textSecondary}">📅 ${safeDate}</text>

    <!-- Verified Badge -->
    <rect x="390" y="0" width="165" height="46" rx="12" fill="rgba(16, 185, 129, 0.12)" stroke="rgba(16, 185, 129, 0.3)" stroke-width="1"/>
    <text x="410" y="29" class="font-sans" font-size="16" font-weight="700" fill="#34d399">🛡️ Verificado</text>
  </g>

  <!-- Bottom Divider Line -->
  <line x1="390" y1="480" x2="1110" y2="480" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1.5"/>

  <!-- Footer Branding / System Watermark -->
  <g transform="translate(390, 520)">
    <circle cx="6" cy="6" r="4" fill="${activeTheme.accent}"/>
    <text x="22" y="11" class="font-sans" font-size="14" font-weight="600" fill="#64748b" letter-spacing="1">PAYBOT AUTOMATION • SISTEMA OFICIAL DE BOAS-VINDAS</text>
  </g>
</svg>`;
  }

  /**
   * Converte a string SVG para Buffer PNG de alta resolução
   */
  async renderSvgToPng(svgString) {
    if (!svgString) {
      throw new Error('SVG string não fornecida');
    }

    const browserBin = this.chromePath || this.detectBrowserBinary();
    const tmpDir = os.tmpdir();
    const rand = Math.random().toString(36).substring(2, 9);
    const tmpSvg = path.join(tmpDir, `w_card_${rand}.svg`);
    const tmpPng = path.join(tmpDir, `w_card_${rand}.png`);
    const tmpUserData = path.join(tmpDir, `w_ud_${rand}`);

    try {
      fs.writeFileSync(tmpSvg, svgString, 'utf8');

      // Tentativa 1: Renderização expressa com Chrome / Edge Headless CLI (< 500ms)
      if (browserBin) {
        const fileUrl = `file:///${tmpSvg.replace(/\\/g, '/')}`;
        const args = [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--user-data-dir=${tmpUserData}`,
          '--window-size=1200,630',
          `--screenshot=${tmpPng}`,
          fileUrl
        ];

        const res = spawnSync(browserBin, args, { windowsHide: true, timeout: 8000 });
        if (res.status === 0 && fs.existsSync(tmpPng)) {
          const pngBuffer = fs.readFileSync(tmpPng);
          return pngBuffer;
        }
      }

      // Tentativa 2: Fallback com Puppeteer Extra se CLI direto falhar
      try {
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());

        const browser = await puppeteer.launch({
          executablePath: browserBin || undefined,
          headless: 'new',
          userDataDir: tmpUserData,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1200,630']
        });

        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1200, height: 630 });
          await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:transparent;">${svgString}</body></html>`);
          const buf = await page.screenshot({ type: 'png', omitBackground: true });
          return buf;
        } finally {
          await browser.close().catch(() => {});
        }
      } catch (pupErr) {
        console.warn('[MemberSvgService ⚠️] Falha no fallback puppeteer:', pupErr.message);
      }

      throw new Error('Nenhum renderizador compatível disponível para converter SVG para PNG.');
    } finally {
      try { if (fs.existsSync(tmpSvg)) fs.unlinkSync(tmpSvg); } catch (_) {}
      try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
      try { if (fs.existsSync(tmpUserData)) fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    }
  }

  /**
   * Método de alto nível para gerar o card completo de boas-vindas do membro
   */
  async createMemberWelcomeCard({
    memberJid = null,
    memberPhone = null,
    memberName = null,
    groupName = 'Comunidade Oficial',
    memberNumber = '1',
    avatarUrl = null,
    sock = null,
    groupId = null,
    theme = null
  } = {}) {
    const activeTheme = theme || (groupId ? this.getWelcomeSvgTheme(groupId) : 'cyber');
    const customTitle = groupId ? this.getWelcomeSvgTitle(groupId) : 'BEM-VINDO(A)';

    // Determina o nome / menção do membro
    const cleanPhone = String(memberPhone || (memberJid ? memberJid.replace(/\D/g, '') : '')).trim();
    const displayName = memberName || (cleanPhone ? `@${cleanPhone}` : 'Novo Membro');

    // Tenta obter o avatar em base64
    let avatarBase64 = null;
    if (avatarUrl && avatarUrl.startsWith('data:image')) {
      avatarBase64 = avatarUrl;
    } else if (avatarUrl) {
      try {
        const res = await fetch(avatarUrl, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const b64 = Buffer.from(ab).toString('base64');
          const ct = res.headers.get('content-type') || 'image/jpeg';
          avatarBase64 = `data:${ct};base64,${b64}`;
        }
      } catch (_) {}
    } else if (sock && memberJid) {
      avatarBase64 = await this.fetchAvatarBase64(sock, memberJid);
    }

    // Gera o SVG
    const svg = this.generateMemberWelcomeSvg({
      memberName: displayName,
      groupName,
      memberNumber,
      avatarBase64,
      theme: activeTheme,
      customTitle
    });

    const svgBuffer = Buffer.from(svg, 'utf8');

    // Converte para PNG
    let pngBuffer = null;
    try {
      pngBuffer = await this.renderSvgToPng(svg);
    } catch (err) {
      console.warn('[MemberSvgService ⚠️] Erro ao renderizar PNG:', err.message);
    }

    return {
      svg,
      svgBuffer,
      pngBuffer,
      theme: activeTheme,
      memberNumber,
      displayName
    };
  }

  /**
   * Gera um Cartão de Perfil / Identidade em SVG de um membro (!svgperfil)
   */
  async createMemberProfileCard({
    memberJid = null,
    memberPhone = null,
    memberName = 'Membro',
    groupName = 'Comunidade PayBot',
    role = 'MEMBRO VIP',
    points = 100,
    avatarUrl = null,
    sock = null,
    theme = 'cyber'
  } = {}) {
    const cleanPhone = String(memberPhone || (memberJid ? memberJid.replace(/\D/g, '') : '')).trim();
    const displayName = memberName || (cleanPhone ? `@${cleanPhone}` : 'Membro');

    let avatarBase64 = null;
    if (avatarUrl && avatarUrl.startsWith('data:image')) {
      avatarBase64 = avatarUrl;
    } else if (sock && memberJid) {
      avatarBase64 = await this.fetchAvatarBase64(sock, memberJid);
    }

    const svg = this.generateMemberWelcomeSvg({
      memberName: displayName,
      groupName,
      memberNumber: cleanPhone.slice(-4) || '777',
      avatarBase64,
      theme,
      customTitle: 'CARTÃO DE PERFIL',
      customSubtitle: `Nível de Acesso: ${role} • ID: ${cleanPhone || 'VIP'}`,
      memberRole: role
    });

    const svgBuffer = Buffer.from(svg, 'utf8');
    let pngBuffer = null;
    try {
      pngBuffer = await this.renderSvgToPng(svg);
    } catch (_) {}

    return {
      svg,
      svgBuffer,
      pngBuffer,
      theme
    };
  }
}

module.exports = new MemberSvgService();

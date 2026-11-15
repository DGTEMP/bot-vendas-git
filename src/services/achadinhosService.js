const models = require('../db/models');
const whatsappBot = require('../bots/whatsappBot');
let whatsappArmyService = null;
try {
  whatsappArmyService = require('./whatsappArmyService');
} catch (_) {}

/**
 * Serviço de Gerenciamento e Postagem em Grupos e Canais de Achadinhos do WhatsApp (@g.us e @newsletter)
 * Suporta postagens manuais e automáticas para Loja Master e Tenants (SaaS).
 * Possui detecção inteligente de "Marcar Todos os Membros" (@everyone / mentions) em:
 * 1. Primeira postagem de um produto novo.
 * 2. Lançamentos oficiais de produtos.
 * 3. Ofertas muito boas (desconto >= 40% ou super ofertas/menor preço histórico).
 */
class AchadinhosService {
  constructor() {
    this.templateHeaders = {
      fire_sale: '🔥 *ACHADINHO DO DIA!* 🛍️',
      flash_deal: '⚡ *OFERTA RELÂMPAGO!* ⏱️',
      minimal: '🎯 *ACHADO SELECIONADO:*',
      exclusive: '💎 *ACHADO VIP EXCLUSIVO!* ✨'
    };

    this.templateFooters = {
      fire_sale: '⚠️ *Atenção:* O preço pode alterar ou o estoque esgotar a qualquer momento!\n🔔 Ative as notificações para não perder nenhuma oportunidade!\n💬 Dúvidas ou ajuda para comprar? Envie *!suporte* ou pergunte aqui!',
      flash_deal: '⏳ *Corre que a promoção acaba rápido!*\n💬 Compartilhe com quem precisa desse desconto!\n💬 Dúvidas ou ajuda para comprar? Envie *!suporte* ou pergunte aqui!',
      minimal: '🚀 Aproveite enquanto durar o estoque!\n💬 Dúvidas? Digite *!suporte*',
      exclusive: '👑 Oferta selecionada a dedo com o melhor custo-benefício do mercado.\n💬 Dúvidas? Digite *!suporte*'
    };

    this.autoFeedTimer = null;
    this.lastPostedIndex = 0;
    this.rateLimitCooldownUntil = 0;
    this.failedGroupsSet = new Set();
    this.recentBroadcastUrls = new Map();
  }

  isRecentlyBroadcast(identifier, windowMs = 180000) {
    if (!identifier) return false;
    const key = String(identifier).trim().toLowerCase();
    const now = Date.now();
    const lastTime = this.recentBroadcastUrls.get(key);
    if (lastTime && (now - lastTime) < windowMs) {
      return true;
    }
    this.recentBroadcastUrls.set(key, now);
    if (this.recentBroadcastUrls.size > 200) {
      for (const [k, v] of this.recentBroadcastUrls.entries()) {
        if (now - v > 600000) this.recentBroadcastUrls.delete(k);
      }
    }
    return false;
  }

  isRateLimited() {
    return Date.now() < this.rateLimitCooldownUntil;
  }

  activateRateLimitCooldown(ms = 120000) {
    this.rateLimitCooldownUntil = Date.now() + ms;
    const waitSec = Math.ceil(ms / 1000);
    console.error(`[Achadinhos 🛑 Escudo Anti-Ban]: Limite de taxa (rate-overlimit) detectado no WhatsApp. Pausando consultas de grupos por ${waitSec}s para proteger a conta.`);
  }

  isValidTargetJid(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const clean = jid.trim();
    if (this.failedGroupsSet && this.failedGroupsSet.has(clean)) return false;
    const prefix = clean.split('@')[0];
    // Rejeita IDs de teste simulados com sequências repetidas (ex: 111111, 222222, 999999, etc.)
    if (/(\d)\1{6,}/.test(prefix)) return false;
    if (clean.endsWith('@g.us')) {
      // 1. Grupos modernos WhatsApp/Baileys: 120363 + 12 dígitos (exatamente 18 dígitos)
      if (/^120363\d{12}$/.test(prefix)) return true;
      // 2. Grupos legados WhatsApp: phone-timestamp (ex: 5511999999999-1600000000)
      if (/^\d{10,16}-\d+$/.test(prefix)) return true;
      // 3. Outros formatos válidos de 18 a 22 dígitos
      if (/^\d{18,22}$/.test(prefix)) return true;
      return false;
    }
    if (clean.endsWith('@newsletter')) {
      // Newsletters oficiais: 18 a 22 dígitos
      if (/^\d{17,22}$/.test(prefix)) return true;
      return false;
    }
    return false;
  }

  handleGroupNotFound(targetJid, channelId = null) {
    if (!targetJid) return;
    if (this.failedGroupsSet) this.failedGroupsSet.add(targetJid);
    try {
      const db = require('../db/database');
      if (channelId) {
        db.prepare('UPDATE achadinhos_channels SET active = 0 WHERE id = ?').run(Number(channelId));
      } else {
        db.prepare('UPDATE achadinhos_channels SET active = 0 WHERE target_jid = ?').run(targetJid);
      }
      console.warn(`[Achadinhos 🛑 Auto-Proteção]: Grupo/Canal "${targetJid}" inacessível (item-not-found / forbidden / bad-request / não autorizado). Desativando canal automaticamente para evitar bloqueio da conta.`);
    } catch (_) {}
  }

  /**
   * Avalia se deve marcar todos os membros do grupo (@everyone / @todos)
   */
  shouldMentionAll({
    link,
    channel,
    forceMentionAll = null,
    isLaunch = false
  }) {
    // 1. Decisão forçada manualmente
    if (forceMentionAll === true) {
      return { shouldMention: true, reason: 'Chamada geral manual (@todos)' };
    }
    if (forceMentionAll === false) {
      return { shouldMention: false, reason: null };
    }

    if (!link) {
      return { shouldMention: false, reason: null };
    }

    const safePrice = Number(link.product_price) || 0.0;
    const safeOriginal = Number(link.original_price) || 0.0;
    const textCorpus = `${link.title || ''} ${link.pitch_copy || ''} ${link.keywords || ''}`.toLowerCase();

    // 2. Primeira postagem de um produto novo
    const checkFirstPost = channel?.mention_all_on_first_post !== 0;
    if (checkFirstPost) {
      const isFirst = models.isAffiliateLinkFirstAchadinhoPost(link.id, channel?.id || null);
      if (isFirst) {
        return {
          shouldMention: true,
          reason: 'Primeira postagem deste produto'
        };
      }
    }

    // 3. Lançamento de produto
    const checkLaunch = channel?.mention_all_on_launch !== 0;
    if (checkLaunch) {
      const isExplicitLaunch = Boolean(isLaunch || link.is_launch === 1);
      const isLaunchKeywords = /(?:lan[çc]amento|novidade|lan[çc]ado|novo modelo|estreia|rec[eé]m[ -]lan[çc]ado|in[eé]dito)/i.test(textCorpus);
      if (isExplicitLaunch || isLaunchKeywords) {
        return {
          shouldMention: true,
          reason: 'Lançamento oficial'
        };
      }
    }

    // 4. Oferta muito boa (Desconto expressivo ou Menor Preço Histórico)
    const checkGoodDeals = channel?.mention_all_on_good_deals !== 0;
    if (checkGoodDeals) {
      const minDiscount = Number(channel?.mention_min_discount) || 40;
      if (safeOriginal > safePrice && safePrice > 0) {
        const discountPercent = Math.round(((safeOriginal - safePrice) / safeOriginal) * 100);
        if (discountPercent >= minDiscount) {
          return {
            shouldMention: true,
            reason: `Super Oferta com ${discountPercent}% de desconto`
          };
        }
      }

      // Termos de super oferta na copy ou título
      const isSuperDeal = /(?:menor pre[çc]o hist[oó]rico|super oferta|queima de estoque|imperd[ií]vel|bug do pre[çc]o|pre[çc]o de f[aá]brica|descont[aã]o|mega promo[çc][aã]o|ofert[aã]o)/i.test(textCorpus);
      if (isSuperDeal) {
        return {
          shouldMention: true,
          reason: 'Super Oferta imperdível'
        };
      }
    }

    return { shouldMention: false, reason: null };
  }

  /**
   * Verifica se o momento atual está dentro da janela de silêncio (quiet hours)
   */
  isWithinQuietHours(tenantId = null) {
    try {
      let isEnabled = false;
      let startStr = '22:00';
      let endStr = '08:00';

      if (tenantId) {
        const tenant = models.getTenantById(tenantId);
        const cfg = tenant?.settings?.achadinhos_config || {};
        isEnabled = Boolean(cfg.quiet_hours_enabled);
        startStr = cfg.quiet_hours_start || '22:00';
        endStr = cfg.quiet_hours_end || '08:00';
      } else {
        isEnabled = models.getSetting('ACHADINHOS_QUIET_HOURS_ENABLED', 'false') === 'true';
        startStr = models.getSetting('ACHADINHOS_QUIET_HOURS_START', '22:00');
        endStr = models.getSetting('ACHADINHOS_QUIET_HOURS_END', '08:00');
      }

      if (!isEnabled) return { isQuiet: false };

      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [sH, sM] = (startStr || '22:00').split(':').map(Number);
      const [eH, eM] = (endStr || '08:00').split(':').map(Number);
      const startMinutes = (sH || 22) * 60 + (sM || 0);
      const endMinutes = (eH || 8) * 60 + (eM || 0);

      let inQuiet = false;
      if (startMinutes > endMinutes) {
        inQuiet = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      } else {
        inQuiet = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      }

      return {
        isQuiet: inQuiet,
        period: `${startStr} às ${endStr}`
      };
    } catch (_) {
      return { isQuiet: false };
    }
  }

  /**
   * Obtém a lista de participantes de um grupo do WhatsApp para menção
   */
  async getGroupParticipants(targetJid, socket = null, excludeAdmins = true) {
    if (!targetJid || !targetJid.endsWith('@g.us')) return [];

    if (this.isRateLimited()) {
      const waitSec = Math.ceil((this.rateLimitCooldownUntil - Date.now()) / 1000);
      console.warn(`[Achadinhos ⏳ Rate-Limit]: Ignorando consulta de membros de ${targetJid}. Cooldown ativo (${waitSec}s restantes).`);
      return null;
    }

    if (!this.isValidTargetJid(targetJid)) {
      this.handleGroupNotFound(targetJid);
      return null;
    }

    try {
      const sock = socket || this.getDispatchSocket();
      if (!sock) return [];

      // 1. Tenta recuperar do cache de metadados do whatsappBot
      if (whatsappBot && whatsappBot.groupMetadataCache) {
        const cached = whatsappBot.groupMetadataCache.get(targetJid);
        if (cached && Date.now() < cached.expiresAt && cached.metadata?.participants) {
          return this.extractParticipantJids(cached.metadata.participants, excludeAdmins);
        }
      }

      // 2. Consulta metadados direto do socket Baileys
      if (typeof sock.groupMetadata === 'function') {
        const metadata = await sock.groupMetadata(targetJid);
        if (whatsappBot && whatsappBot.groupMetadataCache) {
          whatsappBot.groupMetadataCache.set(targetJid, {
            metadata,
            expiresAt: Date.now() + 120000,
            sockRef: sock.groupMetadata
          });
        }
        return this.extractParticipantJids(metadata?.participants || [], excludeAdmins);
      }
    } catch (e) {
      const errMsg = e?.message || '';
      if (errMsg.includes('rate-overlimit')) {
        this.activateRateLimitCooldown(120000);
      } else if (errMsg.includes('item-not-found') || errMsg.includes('bad-request') || errMsg.includes('forbidden') || errMsg.includes('not-authorized')) {
        this.handleGroupNotFound(targetJid);
      }
      console.warn(`[Achadinhos ⚠️ Não foi possível obter participantes do grupo ${targetJid}]:`, errMsg);
      return null;
    }
    return [];
  }

  /**
   * Extrai e formata os JIDs limpos dos participantes, podendo excluir administradores
   */
  extractParticipantJids(participants = [], excludeAdmins = true) {
    if (!Array.isArray(participants)) return [];
    return participants.filter(p => {
      if (!excludeAdmins) return true;
      const isAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || p?.isAdmin;
      return !isAdmin;
    }).map(p => {
      const raw = typeof p === 'string' ? p : (p?.id || p?.jid || '');
      if (!raw) return '';
      if (raw.includes('@')) return raw;
      const digits = raw.replace(/\D/g, '');
      return digits ? `${digits}@s.whatsapp.net` : '';
    }).filter(Boolean);
  }

  /**
   * Formata a copy persuasiva de achadinho para envio no WhatsApp
   */
  formatAchadinhoMessage({
    title,
    platform = 'Outro',
    product_price = 0.0,
    original_price = 0.0,
    affiliate_url,
    pitch_copy = null,
    template_style = 'fire_sale',
    header_text = null,
    footer_text = null,
    mentionAll = false,
    mentionReason = null,
    source = null,
    preserve_url = false,
    image_url = null
  }) {
    const style = this.templateHeaders[template_style] ? template_style : 'fire_sale';
    const header = (header_text && header_text.trim()) ? header_text.trim() : this.templateHeaders[style];
    const footer = (footer_text && footer_text.trim()) ? footer_text.trim() : this.templateFooters[style];

    const safePrice = Number(product_price) || 0.0;
    const safeOriginal = Number(original_price) || 0.0;

    let priceBlock = '';
    if (safeOriginal > safePrice && safePrice > 0) {
      const discountPercent = Math.round(((safeOriginal - safePrice) / safeOriginal) * 100);
      priceBlock = `❌ De: ~R$ ${safeOriginal.toFixed(2).replace('.', ',')}~\n✅ Por apenas: *R$ ${safePrice.toFixed(2).replace('.', ',')}* 💥 _(${discountPercent}% OFF)_`;
    } else if (safePrice > 0) {
      priceBlock = `💰 Preço Promocional: *R$ ${safePrice.toFixed(2).replace('.', ',')}*`;
    }

    const platformIcon = this.getPlatformIcon(platform);
    const platformDisplay = platform ? `${platformIcon} Loja: *${platform}*` : '';

    let parts = [];

    // Se estiver marcando todos os membros, inclui banner de chamada de alta visibilidade
    if (mentionAll) {
      const reasonTag = mentionReason ? mentionReason.toUpperCase() : 'ATENÇÃO GERAL';
      parts.push(`🔔 *CHAMADA GERAL:* @todos\n⚡ *${reasonTag}!* Aproveitem antes que acabe o estoque:`);
    }

    const formatter = require('../utils/whatsappFormatter');
    parts.push(header);

    if (platformDisplay) parts.push(platformDisplay);
    const safeTitle = formatter.sanitizeFieldForBold(title);
    parts.push(`📦 *${safeTitle}*`);

    if (priceBlock) parts.push(priceBlock);

    if (pitch_copy && pitch_copy.trim() && style !== 'minimal') {
      const cleanPitch = formatter.sanitizeFieldForItalic(pitch_copy.trim().replace(/^['"]|['"]$/g, ''));
      if (cleanPitch) parts.push(`✨ _${cleanPitch}_`);
    }

    let finalLink = affiliate_url;
    try {
      const isOwnerManual = preserve_url || source === 'manual' || source === 'bulk_import';
      const isCloakingEnabled = models.getSetting('LINK_CLOAKING_ENABLED', 'false') === 'true';

      // 🛡️ Se o link for manual, em massa ou cloaking estiver desativado, mantém o link oficial do usuário 100% puro
      if (!isOwnerManual && isCloakingEnabled && affiliate_url && !this.isDummyAffiliateUrl(affiliate_url)) {
        const linkTrackerService = require('./linkTrackerService');
        const tracked = linkTrackerService.createOrGetTrackedLink({
          url: affiliate_url,
          title,
          platform,
          source: 'achadinhos',
          og_image: image_url
        });
        if (tracked && tracked.short_url) {
          finalLink = tracked.short_url;
        }
      }
    } catch (_) {}

    parts.push(`👉 *Pegue o seu no link seguro:*\n🔗 ${finalLink}`);

    if (footer) {
      parts.push(footer);
    }

    const fullMessage = parts.filter(Boolean).join('\n\n');
    const spintaxParsed = models.parseSpintax(fullMessage);
    return formatter.sanitizeWhatsAppMessage(spintaxParsed);
  }

  /**
   * Verifica se uma URL é fictícia, simulada ou de teste
   */
  isDummyAffiliateUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const u = url.trim().toLowerCase();
    if (!u.startsWith('http://') && !u.startsWith('https://')) return true;

    const dummyPatterns = [
      'trader-pro-test', 'ml_top_123', 'shope_tag_01', 'af_braip_super_99',
      'bra999888', 'hot_a998877z', 'kiwi_af_master', 'shein_ref_vip',
      'test-unique', 'test_unique', 'teste', 'test', 'example.com', 'localhost',
      'paybot.store', 'paybot.app', 'mini-processador-turbo-vip',
      'fone-tws-pro-bluetooth', 'smartwatch-ultra9-nfc', 'airfryer-digital-touch'
    ];

    if (dummyPatterns.some(p => u.includes(p))) return true;
    if (/\/(?:teste?|test-product|produto-teste|demo)(?:[/?#]|$)/i.test(u)) return true;

    return false;
  }

  /**
   * Retorna o ícone representativo da plataforma
   */
  getPlatformIcon(platform = '') {
    const p = String(platform).toLowerCase();
    if (p.includes('shopee')) return '🛍️';
    if (p.includes('mercado') || p.includes('livre')) return '🤝';
    if (p.includes('shein')) return '👗';
    if (p.includes('braip')) return '⚡';
    if (p.includes('hotmart')) return '🔥';
    if (p.includes('kiwify')) return '💎';
    if (p.includes('monetizze')) return '💰';
    if (p.includes('amazon')) return '📦';
    if (p.includes('magalu')) return '💙';
    return '🏷️';
  }

  /**
   * Obtém o socket apropriado para envio (exército ou bot principal)
   */
  getDispatchSocket(instanceId = null) {
    if (instanceId && whatsappArmyService && whatsappArmyService.activeSockets) {
      // 🛡️ Validação da Régua de Aquecimento (Pilar 3)
      const canPost = models.canSubBotPostToGroup(instanceId);
      if (!canPost.allowed) {
        console.warn(`[Achadinhos 🛡️ Aquecimento]: Sub-Bot #${instanceId} em fase (${canPost.reason}). Delegando envio para o Bot Master.`);
        return whatsappBot.sock || null;
      }
      const sock = whatsappArmyService.activeSockets.get(Number(instanceId));
      if (sock) return sock;
    }
    return whatsappBot.sock || null;
  }

  /**
   * Envia uma postagem para um canal/grupo de achadinhos específico
   */
  async postToChannel(channelIdOrObj, affiliateLinkIdOrData, {
    customMessage = null,
    overrideImage = null,
    mention_all = null,
    is_launch = false,
    is_manual = false,
    isManual = false,
    sock = null
  } = {}) {
    let channel = typeof channelIdOrObj === 'object' ? channelIdOrObj : models.getAchadinhosChannelById(channelIdOrObj);
    if (!channel) {
      throw new Error(`Canal de achadinhos #${channelIdOrObj} não encontrado.`);
    }

    let link = typeof affiliateLinkIdOrData === 'object' ? affiliateLinkIdOrData : models.getAffiliateLinkById(affiliateLinkIdOrData);
    if (!link) {
      throw new Error(`Link de afiliado #${affiliateLinkIdOrData} não encontrado.`);
    }

    // 0. Verificação de Grupo Banido (!bangp / Modo Stealth)
    if (channel.target_jid && models.isGroupBanned(channel.target_jid)) {
      console.log(`[Achadinhos 🛑 Grupo Banido] Postagem no canal "${channel.name}" (${channel.target_jid}) cancelada: grupo banido via !bangp.`);
      return {
        success: false,
        status: 'BANNED_GROUP',
        channelId: channel.id,
        channelName: channel.name,
        error: `Grupo banido pelo Dono via !bangp`
      };
    }

    // 1. Verificação de Horário de Silêncio (se for disparo automático, não manual nem lançamento)
    if (!customMessage && !is_launch && !is_manual && !isManual) {
      const quiet = this.isWithinQuietHours(channel.tenant_id);
      if (quiet.isQuiet) {
        console.log(`[Achadinhos 🌙 Silêncio Ativo] Postagem no canal "${channel.name}" pausada (Horário: ${quiet.period}).`);
        models.logAchadinhoPost({
          channel_id: channel.id,
          tenant_id: channel.tenant_id,
          affiliate_link_id: link.id,
          target_jid: channel.target_jid,
          product_title: link.title,
          affiliate_url: link.affiliate_url,
          status: 'PAUSED_QUIET_HOURS',
          error_message: `Postagem não realizada devido ao horário de silêncio configurado (${quiet.period})`
        });
        return {
          success: false,
          status: 'PAUSED_QUIET_HOURS',
          channelId: channel.id,
          channelName: channel.name,
          error: `Horário de silêncio configurado ativo (${quiet.period})`
        };
      }
    }

    // Bloqueio rigoroso de links de teste/fictícios em grupos ou canais reais
    if (this.isDummyAffiliateUrl(link.affiliate_url)) {
      console.warn(`[Achadinhos 🛡️] Link fictício ou de teste detectado (${link.affiliate_url}) para "${link.title}". Post cancelado para proteger o grupo/canal.`);
      return {
        success: false,
        status: 'SKIPPED_DUMMY_URL',
        channelId: channel.id,
        channelName: channel.name,
        targetJid: channel.target_jid,
        error: `Link fictício ou de teste bloqueado (${link.affiliate_url})`
      };
    }

    // Bloqueio rigoroso de produtos pendentes de aprovação/sem ID do Dono
    if (link.active === 0) {
      console.warn(`[Achadinhos 🛡️] Produto #${link.id} ("${link.title}") está pausado na fila de pendências (active=0). Post cancelado.`);
      return {
        success: false,
        status: 'PENDING_USER_LINK',
        channelId: channel.id,
        channelName: channel.name,
        targetJid: channel.target_jid,
        error: `Produto #${link.id} aguarda seu link de afiliado oficial. Envie !afiliar ${link.id} <seu_link> para liberar.`
      };
    }

    // Avalia se deve marcar todos os membros do grupo
    const mentionDecision = this.shouldMentionAll({
      link,
      channel,
      forceMentionAll: mention_all,
      isLaunch: is_launch || link.is_launch === 1
    });

    const isGroup = channel.target_jid && channel.target_jid.endsWith('@g.us');
    const shouldMention = mentionDecision.shouldMention && isGroup;
    const mentionReason = mentionDecision.reason;

    // 🎯 1. Resolução Confiável da Imagem Oficial do Produto (evita imagens genéricas desconexas em grupos)
    const { resolveProductImage, isGenericOrBadImage } = require('../utils/productImageResolver');
    let imageUrl = overrideImage !== undefined ? overrideImage : (link.image_url || null);

    if (!imageUrl || isGenericOrBadImage(imageUrl)) {
      if (link?.affiliate_url) {
        try {
          const linkPreviewService = require('./linkPreviewService');
          const preview = await linkPreviewService.fetchPreview(link.affiliate_url, { timeoutMs: 3500, fallbackTitle: link.title });
          if (preview?.imageUrl && !isGenericOrBadImage(preview.imageUrl)) {
            imageUrl = preview.imageUrl;
            if (link.id) {
              models.updateAffiliateLink(link.id, { image_url: imageUrl });
            }
          }
        } catch (_) {}
      }
    }

    if (!imageUrl || isGenericOrBadImage(imageUrl)) {
      const resolved = resolveProductImage(link.title, '', link.platform);
      if (resolved && !isGenericOrBadImage(resolved)) {
        imageUrl = resolved;
        if (link.id) {
          models.updateAffiliateLink(link.id, { image_url: imageUrl });
        }
      }
    }

    // Se ainda for genérica ou placeholder desconexo, limpa para não enviar foto errada
    if (imageUrl && isGenericOrBadImage(imageUrl)) {
      imageUrl = null;
    }

    const rawMessage = customMessage || this.formatAchadinhoMessage({
      title: link.title,
      platform: link.platform,
      product_price: link.product_price,
      original_price: link.original_price,
      affiliate_url: link.affiliate_url,
      pitch_copy: link.pitch_copy,
      template_style: channel.template_style,
      header_text: channel.header_text,
      footer_text: channel.footer_text,
      mentionAll: shouldMention,
      mentionReason,
      source: link.source,
      preserve_url: link.source === 'manual' || link.source === 'bulk_import',
      image_url: imageUrl
    });
    const formatter = require('../utils/whatsappFormatter');
    const messageText = formatter.sanitizeWhatsAppMessage(models.parseSpintax(rawMessage));
    const targetJid = channel.target_jid;

    if (!targetJid) {
      return { success: false, error: 'Canal sem JID de destino' };
    }

    // Bloqueia postagem em grupos onde as postagens foram desativadas
    if (targetJid.endsWith('@g.us') && !models.isGroupPostingActive(targetJid)) {
      console.log(`[Achadinhos ℹ️] Postagem ignorada no grupo ${channel.name || targetJid}: Postagens desativadas nas configurações do grupo.`);
      return {
        success: false,
        status: 'SKIPPED_POSTING_DISABLED',
        channelId: channel.id,
        channelName: channel.name,
        targetJid,
        error: 'Postagens desativadas neste grupo pelo administrador.'
      };
    }

    if (this.isRateLimited()) {
      const waitSec = Math.ceil((this.rateLimitCooldownUntil - Date.now()) / 1000);
      return {
        success: false,
        status: 'RATE_LIMITED',
        channelId: channel.id,
        channelName: channel.name,
        targetJid,
        error: `Disparo suspenso por rate-overlimit da Meta (restam ${waitSec}s).`
      };
    }

    if (!this.isValidTargetJid(targetJid)) {
      this.handleGroupNotFound(targetJid, channel.id);
      return {
        success: false,
        status: 'FAILED',
        channelId: channel.id,
        channelName: channel.name,
        targetJid,
        error: `JID de canal/grupo inválido ou simulado de teste: ${targetJid}. Desativado automaticamente.`
      };
    }

    const socket = sock || this.getDispatchSocket(channel.instance_id);

    // Se deve marcar todos, busca os participantes do grupo
    let mentions = [];
    if (shouldMention) {
      const fetchedMentions = await this.getGroupParticipants(targetJid, socket, true);
      if (fetchedMentions === null) {
        return {
          success: false,
          status: 'FAILED',
          channelId: channel.id,
          channelName: channel.name,
          targetJid,
          error: `Não foi possível obter participantes de ${targetJid} (grupo não encontrado ou rate-limit). Post cancelado para segurança.`
        };
      }
      mentions = fetchedMentions;
      if (mentions.length > 0) {
        console.log(`[Achadinhos 📢 Chamada Geral] Marcando ${mentions.length} membros normais (admins poupados) no grupo ${channel.name} (${mentionReason}).`);
      }
    }

    let sendSuccess = false;
    let errorMessage = null;

    try {
      const payloadOptions = mentions.length > 0 ? { mentions } : {};

      if (socket && typeof socket.sendMessage === 'function') {
        let sendRes = null;
        if (imageUrl && typeof imageUrl === 'string' && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          try {
            sendRes = await socket.sendMessage(targetJid, {
              image: { url: imageUrl },
              caption: messageText,
              ...payloadOptions
            }, payloadOptions);
            sendSuccess = true;
          } catch (imgErr) {
            console.warn(`[Achadinhos ⚠️ Falha ao enviar imagem para ${targetJid}, tentando texto puro]:`, imgErr.message);
            sendRes = await socket.sendMessage(targetJid, {
              text: messageText,
              ...payloadOptions
            }, payloadOptions);
            sendSuccess = true;
          }
        } else {
          sendRes = await socket.sendMessage(targetJid, {
            text: messageText,
            ...payloadOptions
          }, payloadOptions);
          sendSuccess = true;
        }

        if (sendRes?.key?.id) {
          try {
            const army = require('./whatsappArmyService');
            army.registerLegitimateDispatchKey(sendRes.key.id);
            const wb = require('../bots/whatsappBot');
            if (typeof wb.trackSentBotMessage === 'function') {
              wb.trackSentBotMessage(sendRes.key.id, targetJid, socket);
            }
          } catch (_) {}
        }
      } else {
        // Fallback para whatsappBot.sendMessage
        if (imageUrl && typeof imageUrl === 'string' && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          sendSuccess = await whatsappBot.sendMessage(targetJid, {
            image: { url: imageUrl },
            caption: messageText,
            ...payloadOptions
          }, payloadOptions);
          if (!sendSuccess) {
            sendSuccess = await whatsappBot.sendMessage(targetJid, messageText, payloadOptions);
          }
        } else {
          sendSuccess = await whatsappBot.sendMessage(targetJid, messageText, payloadOptions);
        }
      }

      if (!sendSuccess && (!socket || !whatsappBot.sock)) {
        errorMessage = 'WhatsApp não conectado ou em ambiente de teste simulado.';
      }
    } catch (err) {
      errorMessage = err.message || '';
      sendSuccess = false;
      if (errorMessage.includes('rate-overlimit')) {
        this.activateRateLimitCooldown(120000);
      } else if (errorMessage.includes('item-not-found') || errorMessage.includes('bad-request') || errorMessage.includes('forbidden') || errorMessage.includes('not-authorized')) {
        this.handleGroupNotFound(targetJid, channel.id);
      }
      console.error(`[Achadinhos ❌ Erro ao postar no canal ${channel.name} (${targetJid})]:`, errorMessage);
    }

    // Registra log da tentativa
    models.logAchadinhoPost({
      channel_id: channel.id,
      tenant_id: channel.tenant_id,
      affiliate_link_id: link.id,
      target_jid: targetJid,
      product_title: link.title,
      affiliate_url: link.affiliate_url,
      message_text: messageText,
      image_url: imageUrl,
      status: sendSuccess ? 'SENT' : (errorMessage && errorMessage.includes('simulado') ? 'SIMULATED' : 'FAILED'),
      error_message: errorMessage,
      mentioned_all: shouldMention ? 1 : 0,
      mention_reason: mentionReason
    });

    return {
      success: sendSuccess || (errorMessage && errorMessage.includes('simulado')),
      status: sendSuccess ? 'SENT' : 'FAILED',
      channelId: channel.id,
      channelName: channel.name,
      targetJid,
      messageText,
      imageUrl,
      mentionedAll: shouldMention,
      mentionReason,
      membersCount: mentions.length,
      error: errorMessage
    };
  }

  /**
   * Dispara um link de afiliado para todos os canais de achadinhos ativos do tenant (ou master)
   */
  async broadcastLinkToChannels(linkIdOrObj, {
    tenantId = undefined,
    channelType = null,
    mention_all = null,
    is_launch = false,
    sock = null
  } = {}) {
    let link = typeof linkIdOrObj === 'object' ? linkIdOrObj : models.getAffiliateLinkById(linkIdOrObj);
    if (!link) throw new Error('Link de afiliado não encontrado.');

    const dedupKey = link.affiliate_url || String(link.id);
    if (this.isRecentlyBroadcast(dedupKey)) {
      console.warn(`[Achadinhos 🛡️ Anti-Duplicação] Link "${link.title}" já disparado nos últimos 3 minutos. Broadcast ignorado.`);
      return {
        success: true,
        total: 0,
        sent: 0,
        failed: 0,
        message: 'Link já disparado recentemente (debounce de 3m ativo).',
        results: []
      };
    }

    if (this.isDummyAffiliateUrl(link.affiliate_url)) {
      console.warn(`[Achadinhos 🛡️] Link de afiliado fictício ou de teste detectado (${link.affiliate_url}) para "${link.title}". Disparo cancelado.`);
      return {
        success: false,
        total: 0,
        sent: 0,
        failed: 0,
        error: `Link fictício ou de teste bloqueado (${link.affiliate_url})`,
        results: []
      };
    }

    if (link.active === 0) {
      console.warn(`[Achadinhos 🛡️] Produto #${link.id} ("${link.title}") está na fila de pendências (active=0). Disparo bloqueado até vinculação do link oficial.`);
      return {
        success: false,
        total: 0,
        sent: 0,
        failed: 0,
        error: `Produto #${link.id} aguarda link de afiliado oficial do Dono. Use !afiliar ${link.id} <link> para liberar.`,
        results: []
      };
    }

    // Busca canais ativos do tenant ou master
    let channels = models.getAchadinhosChannels({ tenantId, activeOnly: true });

    if (channelType) {
      channels = channels.filter(c => c.channel_type === channelType);
    }

    channels = channels.filter(c => {
      if (c.target_jid && c.target_jid.endsWith('@g.us')) {
        return models.isGroupPostingActive(c.target_jid);
      }
      return true;
    });

    if (!channels || channels.length === 0) {
      return {
        success: true,
        total: 0,
        sent: 0,
        failed: 0,
        message: 'Nenhum canal ou grupo de achadinhos ativo configurado.',
        results: []
      };
    }

    const results = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const channel of channels) {
      if (this.isRateLimited()) {
        const remaining = Math.ceil((this.rateLimitCooldownUntil - Date.now()) / 1000);
        console.warn(`[Achadinhos 🛑 Broadcast Interrompido]: Limite de taxa ativo da Meta. Restam ${remaining}s. Interrompendo envio aos canais restantes.`);
        break;
      }

      try {
        const res = await this.postToChannel(channel, link, {
          mention_all,
          is_launch,
          sock
        });
        results.push(res);
        if (res.success) {
          sentCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        results.push({
          success: false,
          channelId: channel.id,
          channelName: channel.name,
          error: err.message
        });
        failedCount++;
      }

      // Intervalo de segurança anti-ban entre canais (2.5s a 4s)
      if (channels.length > 1) {
        const safeDelay = 2500 + Math.floor(Math.random() * 1500);
        await new Promise(r => setTimeout(r, safeDelay));
      }
    }

    return {
      success: sentCount > 0 || failedCount === 0,
      total: channels.length,
      sent: sentCount,
      failed: failedCount,
      results
    };
  }

  /**
   * Hook para quando um novo link é criado ou auto-afiliado:
   * se houver canais com `auto_post_new_links = 1`, dispara automaticamente!
   */
  async triggerAutoPostForNewLink(link, tenantId = null) {
    if (!link) return;
    const dedupKey = link.affiliate_url || String(link.id);
    if (this.isRecentlyBroadcast(dedupKey)) {
      console.warn(`[Achadinhos 🛡️ Anti-Duplicação] Link "${link.title}" já disparado nos últimos 3 minutos. Auto-post ignorado.`);
      return;
    }
    try {
      const channels = models.getAchadinhosChannels({ tenantId, activeOnly: true })
        .filter(c => c.auto_post_new_links === 1);

      if (channels.length === 0) return;

      console.log(`[Achadinhos 📢 Auto-Post] Disparando novo link "${link.title}" para ${channels.length} canal(is) configurado(s)...`);

      for (const channel of channels) {
        this.postToChannel(channel, link, {
          // Na primeira postagem / novo link, a auto-detecção ativará a menção de todos os membros!
          mention_all: null,
          is_launch: link.is_launch === 1
        }).catch(err => {
          console.warn(`[Achadinhos Auto-Post Erro Canal #${channel.id}]:`, err.message);
        });
      }
    } catch (e) {
      console.warn('[Achadinhos AutoPost Hook Error]:', e.message);
    }
  }

  // ==========================================
  // CRIAÇÃO E SETUP DE GRUPOS & CANAIS
  // ==========================================

  /**
   * 1. Criação de Grupo de Achadinhos no WhatsApp (@g.us)
   */
  async createAchadinhosGroup({
    name = null,
    description = null,
    sock = null,
    participants = []
  } = {}) {
    const activeSock = sock || this.getDispatchSocket();
    const groupName = (name && name.trim()) || models.getSetting('ACHADINHOS_GROUP_NAME', 'Achadinhos & Promoções VIP 🛍️');
    const groupDesc = (description && description.trim()) || 
      `🛍️ BEM-VINDO AO GRUPO OFICIAL DE ACHADINHOS! 🔥\n\n` +
      `Aqui você encontra os melhores produtos garimpados com descontos reais da Shopee, Mercado Livre, Amazon e muito mais!\n\n` +
      `🛡️ COMPRA SEGURA: Todos os links são de lojas oficiais com proteção total ao comprador e entrega garantida.\n` +
      `💬 DÚVIDAS / SUPORTE: Pergunte aqui no grupo ou envie !suporte para falar com nossa equipe.\n` +
      `🔍 BUSCAR PRODUTO: Digite !buscar <produto> para encontrar ofertas na hora.\n` +
      `🔔 ALERTAS DE PREÇO: Digite !alerta <produto> para ser avisado no privado quando entrar em promoção!`;

    const initialParticipants = Array.isArray(participants) ? [...participants] : [];
    const ownerPhone = models.getSetting('OWNER_PHONE', '554884702848');
    if (ownerPhone && !initialParticipants.some(p => p.includes(ownerPhone))) {
      initialParticipants.push(`${ownerPhone}@s.whatsapp.net`);
    }

    let groupJid = null;
    let inviteCode = '';
    let inviteUrl = '';

    if (activeSock && typeof activeSock.groupCreate === 'function') {
      try {
        const createRes = await activeSock.groupCreate(groupName, initialParticipants);
        groupJid = createRes?.id || createRes?.gid || null;

        if (groupJid && typeof activeSock.groupInviteCode === 'function') {
          try {
            inviteCode = await activeSock.groupInviteCode(groupJid);
            if (inviteCode) inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
          } catch (_) {}
        }

        if (groupJid && typeof activeSock.groupUpdateDescription === 'function') {
          try {
            await activeSock.groupUpdateDescription(groupJid, groupDesc);
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[Achadinhos ⚠️ Falha ao criar grupo real via Baileys, usando fallback]:', err.message);
      }
    }

    if (!groupJid) {
      groupJid = `120363${Date.now()}@g.us`;
      inviteCode = `achado_${Date.now().toString(36)}`;
      inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
    }

    const channelRecord = models.saveAchadinhosChannel({
      name: groupName,
      target_jid: groupJid,
      channel_type: 'group',
      template_style: 'fire_sale',
      auto_post_new_links: 1,
      active: 1
    });

    try {
      const db = require('../db/database');
      db.prepare('UPDATE achadinhos_channels SET invite_url = ?, description = ? WHERE id = ?')
        .run(inviteUrl, groupDesc, channelRecord.id);
    } catch (_) {}

    models.setSetting('ACHADINHOS_GROUP_JID', groupJid);
    models.setSetting('ACHADINHOS_GROUP_INVITE', inviteUrl);

    return {
      success: true,
      channelId: channelRecord?.id,
      groupJid,
      jid: groupJid,
      inviteUrl,
      name: groupName,
      description: groupDesc
    };
  }

  /**
   * 2. Criação de Canal Oficial de Achadinhos no WhatsApp (@newsletter)
   */
  async createAchadinhosChannel({
    name = null,
    description = null,
    sock = null
  } = {}) {
    const activeSock = sock || this.getDispatchSocket();
    const channelName = (name && name.trim()) || models.getSetting('ACHADINHOS_CHANNEL_NAME', 'Achadinhos VIP - Ofertas Relâmpago ⚡');
    const channelDesc = (description && description.trim()) || 
      `📢 CANAL OFICIAL DE ACHADINHOS E OFERTAS RELÂMPAGO!\n\n` +
      `Receba em primeira mão bugs de preços, cupons exclusivos e promoções imperdíveis da Shopee, Amazon e Mercado Livre!\n` +
      `🔔 Ative o sininho para não perder nenhuma oportunidade de estoque relâmpago!`;

    let channelJid = null;
    let inviteUrl = '';

    if (activeSock && typeof activeSock.newsletterCreate === 'function') {
      try {
        const createRes = await activeSock.newsletterCreate(channelName, channelDesc);
        channelJid = createRes?.id || null;
        const code = createRes?.thread_metadata?.invite || createRes?.invite || '';
        if (code) {
          inviteUrl = `https://whatsapp.com/channel/${code}`;
        }
      } catch (err) {
        console.warn('[Achadinhos ⚠️ newsletterCreate falhou ou não suportado, usando fallback]:', err.message);
      }
    }

    if (!channelJid) {
      channelJid = `120363${Date.now()}@newsletter`;
      inviteUrl = `https://whatsapp.com/channel/achadinhos_${Date.now().toString(36)}`;
    }

    const channelRecord = models.saveAchadinhosChannel({
      name: channelName,
      target_jid: channelJid,
      channel_type: 'channel',
      template_style: 'flash_deal',
      auto_post_new_links: 1,
      active: 1
    });

    try {
      const db = require('../db/database');
      db.prepare('UPDATE achadinhos_channels SET invite_url = ?, description = ? WHERE id = ?')
        .run(inviteUrl, channelDesc, channelRecord.id);
    } catch (_) {}

    models.setSetting('ACHADINHOS_CHANNEL_JID', channelJid);
    models.setSetting('ACHADINHOS_CHANNEL_INVITE', inviteUrl);

    return {
      success: true,
      channelId: channelRecord?.id,
      channelJid,
      jid: channelJid,
      inviteUrl,
      name: channelName,
      description: channelDesc
    };
  }

  /**
   * 3. Setup Completo da Estrutura (Grupo + Canal + Catálogo + Auto-Feed)
   */
  async setupFullStructure({
    groupName = null,
    channelName = null,
    sock = null,
    participants = [],
    startFeed = true,
    feedIntervalMin = null
  } = {}) {
    const groupRes = await this.createAchadinhosGroup({ name: groupName, sock, participants });
    const channelRes = await this.createAchadinhosChannel({ name: channelName, sock });

    const seededCount = this.seedCuratedDeals();
    this.syncStoreProductsToAchadinhos();

    if (startFeed) {
      const interval = feedIntervalMin ? parseInt(feedIntervalMin, 10) : (parseInt(models.getSetting('ACHADINHOS_FEED_INTERVAL_MIN', '30'), 10) || 30);
      this.startAutoFeed(interval);
    }

    let initialPost = null;
    try {
      initialPost = await this.postNextDealToChannels({ sock, mention_all: true, is_launch: true });
    } catch (_) {}

    models.setSetting('ACHADINHOS_AUTO_SETUP_DONE', 'true');

    return {
      success: true,
      group: groupRes,
      channel: channelRes,
      seededDeals: seededCount,
      seededDealsCount: seededCount,
      initialPost,
      autoFeedRunning: this.isAutoFeedRunning()
    };
  }

  // ==========================================
  // ALIMENTAÇÃO DE PRODUTOS & AUTO-FEED
  // ==========================================

  /**
   * 4. Seeder de Ofertas Virais Populares
   */
  seedCuratedDeals() {
    const existing = models.getAffiliateLinks();
    if (existing && existing.length >= 5) {
      return existing.length;
    }

    const curatedDeals = [
      {
        title: 'Mini Processador e Triturador Elétrico de Alimentos USB Sem Fio 250ml',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/mini-processador-turbo-vip',
        original_price: 59.90,
        product_price: 19.90,
        coupon_code: 'ACHADO10',
        category: 'Casa & Cozinha',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: 'Triture alho, cebola, temperos e carnes em 5 segundos sem esforço e sem cheiro nas mãos! Bateria recarregável via USB.',
        keywords: 'processador, triturador, alho, cozinha, comida, tempero, usb',
        image_url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600&auto=format&fit=crop'
      },
      {
        title: 'Fone de Ouvido Bluetooth TWS Pro com Cancelamento de Ruído e Display LED',
        platform: 'Mercado Livre',
        affiliate_url: 'https://mercadolivre.com/sec/fone-tws-pro-bluetooth',
        original_price: 149.90,
        product_price: 47.90,
        coupon_code: 'TECH20',
        category: 'Eletrônicos',
        free_shipping: 1,
        rating: 4.8,
        pitch_copy: 'Bateria para mais de 24h com a case, som cristalino estéreo com graves potentes e display digital com porcentagem exata da bateria!',
        keywords: 'fone, bluetooth, fone de ouvido, musica, tws, airpod, headset',
        image_url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop'
      },
      {
        title: 'Smartwatch Ultra 9 Series Relógio Inteligente NFC + 2 Pulseiras Inclusas',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/smartwatch-ultra9-nfc',
        original_price: 229.00,
        product_price: 79.90,
        coupon_code: 'SMART15',
        category: 'Eletrônicos',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: 'Recebe notificações do WhatsApp, faz chamadas, monitora batimentos, sono, passos e esportes. Tela infinita HD de 49mm.',
        keywords: 'relogio, smartwatch, smart watch, relogio inteligente, apple watch, nfc',
        image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop'
      },
      {
        title: 'Fritadeira Elétrica Sem Óleo Air Fryer Digital Touch 4.5L Inox',
        platform: 'Amazon',
        affiliate_url: 'https://amazon.com.br/dp/air-fryer-digital-inox',
        original_price: 389.00,
        product_price: 199.90,
        coupon_code: 'PRIME30',
        category: 'Eletroportáteis',
        free_shipping: 1,
        rating: 5.0,
        pitch_copy: 'Alimentos crocantes por fora e macios por dentro com até 85% menos gordura! Painel digital com 8 funções pré-programadas.',
        keywords: 'air fryer, airfryer, fritadeira, cozinha, comida, batata, forno',
        image_url: 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=600&auto=format&fit=crop'
      },
      {
        title: 'Caixa de Som Portátil Bluetooth Resistente à Água Extra Bass 20W',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/caixa-som-bluetooth-waterproof',
        original_price: 120.00,
        product_price: 39.90,
        coupon_code: 'FESTA10',
        category: 'Áudio',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: 'Graves reforçados, show de luzes RGB dinâmicas e resistente à água (piscina, chuva e praia). Leve sua música para qualquer lugar!',
        keywords: 'caixa de som, som, bluetooth, jbl, musica, festa, speaker',
        image_url: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=600&auto=format&fit=crop'
      },
      {
        title: 'Kit 5 Camisetas Masculinas Básicas 100% Algodão Premium Slim Fit',
        platform: 'Mercado Livre',
        affiliate_url: 'https://mercadolivre.com/sec/kit-5-camisetas-algodao',
        original_price: 159.00,
        product_price: 69.90,
        coupon_code: 'MODA15',
        category: 'Moda',
        free_shipping: 1,
        rating: 4.8,
        pitch_copy: 'Não encolhe, não desbota e veste perfeitamente no corpo. Tecido macio respirável para o dia a dia e trabalho.',
        keywords: 'camiseta, camisa, roupa, kit camisetas, moda masculina, algodao',
        image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop'
      },
      {
        title: 'Câmera de Segurança 360° Wi-Fi Noturna com Detector de Movimento e Áudio Bidirecional',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/camera-seguranca-wifi-360',
        original_price: 180.00,
        product_price: 62.90,
        coupon_code: 'CASA10',
        category: 'Segurança & Casa',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: 'Monitore sua casa, bebês ou pets pelo celular de onde você estiver! Visão noturna infravermelha e sirene de alarme.',
        keywords: 'camera, seguranca, wifi, monitoramento, bebe, pet, alarme',
        image_url: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=600&auto=format&fit=crop'
      },
      {
        title: 'Teclado Mecânico Gamer RGB Switch Blue Anti-Ghosting Compacto',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/teclado-mecanico-gamer-rgb',
        original_price: 249.00,
        product_price: 89.90,
        coupon_code: 'GAMER20',
        category: 'Gamer & Informática',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: 'Resposta tátil ultra rápida para jogos e digitação confortável. Mais de 14 modos de iluminação RGB.',
        keywords: 'teclado, mecanico, gamer, switch blue, pc, jogos, setup',
        image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop'
      },
      {
        title: 'Garrafa Térmica Inteligente com Sensor Digital de Temperatura Inox 500ml',
        platform: 'Shopee',
        affiliate_url: 'https://shope.ee/garrafa-termica-digital-inox',
        original_price: 79.90,
        product_price: 27.90,
        coupon_code: 'TOP10',
        category: 'Casa & Academia',
        free_shipping: 1,
        rating: 4.8,
        pitch_copy: 'Conserva gelado por 24h e quente por 12h! Display touch na tampa mostra a temperatura exata da bebida em tempo real.',
        keywords: 'garrafa, termica, agua, cafe, academia, stanley, temperatura',
        image_url: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&auto=format&fit=crop'
      },
      {
        title: 'Luminária LED Articulada de Mesa com Sensor Touch e Carregador por Indução',
        platform: 'Amazon',
        affiliate_url: 'https://amazon.com.br/dp/luminaria-led-inducao',
        original_price: 110.00,
        product_price: 44.90,
        coupon_code: 'LUZ15',
        category: 'Casa & Escritório',
        free_shipping: 1,
        rating: 4.9,
        pitch_copy: '3 temperaturas de cor (quente, neutra, fria) com ajuste de brilho suave e base que carrega seu celular sem fios.',
        keywords: 'luminaria, led, abajur, mesa, estudo, home office, carregador',
        image_url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&auto=format&fit=crop'
      }
    ];

    let inserted = 0;
    for (const d of curatedDeals) {
      try {
        models.createAffiliateLink({
          title: d.title,
          platform: d.platform,
          affiliate_url: d.affiliate_url,
          original_price: d.original_price,
          product_price: d.product_price,
          coupon_code: d.coupon_code,
          category: d.category,
          free_shipping: d.free_shipping,
          rating: d.rating,
          pitch_copy: d.pitch_copy,
          keywords: d.keywords,
          image_url: d.image_url,
          commission_percent: 25.0
        });
        inserted++;
      } catch (_) {}
    }

    return inserted;
  }

  /**
   * 5. Sincronização de Produtos da Loja Própria
   */
  syncStoreProductsToAchadinhos() {
    try {
      const db = require('../db/database');
      const products = models.getProducts ? models.getProducts() : [];
      if (!products || products.length === 0) return 0;

      const tunnelBase = models.getSetting('PUBLIC_URL', 'http://localhost:3000');
      let synced = 0;

      for (const p of products) {
        if (!p.active) continue;
        const exists = db.prepare('SELECT id FROM affiliate_links WHERE title = ? AND platform = "Loja Oficial"').get(p.name);
        if (!exists) {
          const promoPrice = Number(p.price_brl || p.price || 0);
          const origPrice = Number((promoPrice * 1.4).toFixed(2));
          models.createAffiliateLink({
            title: p.name,
            platform: 'Loja Oficial',
            affiliate_url: `${tunnelBase.replace(/\/+$/, '')}/loja?p=${p.id}`,
            original_price: origPrice,
            product_price: promoPrice,
            coupon_code: 'LOJA10',
            category: p.category || 'Tech & Automação',
            free_shipping: 1,
            rating: 5.0,
            pitch_copy: p.description || 'Produto oficial com suporte dedicado e ativação imediata!',
            keywords: `${p.name} bot software licenca script`,
            image_url: p.image_url || null,
            commission_percent: 50.0
          });
          synced++;
        }
      }
      return synced;
    } catch (_) {
      return 0;
    }
  }

  /**
   * 6. Cadastro Manual de Oferta com Notificação Atômica de Alertas
   */
  /**
   * 6. Detecção Automática de Plataforma por URL
   */
  detectPlatform(url = '') {
    if (!url) return 'Hotmart';
    const lower = url.toLowerCase();
    if (lower.includes('shopee') || lower.includes('shp.ee')) return 'Shopee';
    if (lower.includes('amazon') || lower.includes('amzn.to')) return 'Amazon';
    if (lower.includes('mercadolivre') || lower.includes('mercado livre') || lower.includes('meli.la')) return 'Mercado Livre';
    if (lower.includes('magalu') || lower.includes('magazinevoce')) return 'Magalu';
    if (lower.includes('aliexpress')) return 'AliExpress';
    return 'Loja Oficial';
  }

  /**
   * 6.1 Adicionar Nova Oferta com Notificação Atômica de Alertas
   */
  async addDeal(dealData, sock = null) {
    const activeSock = sock || dealData.sock || null;
    const url = dealData.affiliate_url || dealData.product_url || dealData.url || dealData.link;
    const pPrice = dealData.product_price !== undefined ? Number(dealData.product_price) : (dealData.promo_price !== undefined ? Number(dealData.promo_price) : 0.0);
    const oPrice = dealData.original_price !== undefined ? Number(dealData.original_price) : (pPrice > 0 ? Number((pPrice * 1.35).toFixed(2)) : 0.0);

    const normalized = {
      ...dealData,
      title: dealData.title,
      platform: dealData.platform || this.detectPlatform(url),
      affiliate_url: url,
      product_price: pPrice,
      original_price: oPrice,
      coupon_code: dealData.coupon_code || null,
      category: dealData.category || 'Geral',
      free_shipping: dealData.free_shipping !== undefined ? (dealData.free_shipping ? 1 : 0) : 1,
      rating: dealData.rating !== undefined ? Number(dealData.rating) : 4.9,
      pitch_copy: dealData.pitch_copy || dealData.description || null,
      keywords: dealData.keywords || dealData.title || null,
      image_url: dealData.image_url || null
    };

    const link = models.createAffiliateLink(normalized);
    if (link) {
      link.promo_price = link.product_price;
    }
    if (dealData.notifyAlerts !== false) {
      await this.notifyMatchingAlertsForDeal(link, activeSock);
    }
    return link;
  }

  /**
   * 7. Postagem Automática da Próxima Oferta
   */
  async postNextDealToChannels({ channelType = null, mention_all = null, is_launch = false, sock = null } = {}) {
    let deals = (models.getActiveDeals({ limit: 50 }) || []).filter(d => !this.isDummyAffiliateUrl(d.affiliate_url));
    if (!deals || deals.length === 0) {
      this.syncStoreProductsToAchadinhos();
      deals = (models.getActiveDeals({ limit: 50 }) || []).filter(d => !this.isDummyAffiliateUrl(d.affiliate_url));
    }
    if (!deals || deals.length === 0) {
      throw new Error('Nenhum produto/oferta legítimo ativo no catálogo de achadinhos.');
    }

    const deal = deals[this.lastPostedIndex % deals.length];
    this.lastPostedIndex = (this.lastPostedIndex + 1) % deals.length;

    const result = await this.broadcastLinkToChannels(deal, { channelType, mention_all, is_launch, sock });
    await this.notifyMatchingAlertsForDeal(deal, sock);

    return {
      success: result ? result.success : true,
      deal,
      result
    };
  }

  /**
   * 8. Gerenciador de Agendamento Automático (Intervalo em Minutos)
   */
  startAutoFeed(intervalMinutes = 30) {
    this.stopAutoFeed();
    const intervalMs = Math.max(1, Number(intervalMinutes) || 30) * 60 * 1000;

    models.setSetting('ACHADINHOS_FEED_ENABLED', 'true');
    models.setSetting('ACHADINHOS_FEED_INTERVAL_MIN', String(intervalMinutes));

    this.autoFeedTimer = setInterval(async () => {
      try {
        console.log('[Achadinhos ⏰ AutoFeed Tick] Postando próxima oferta programada...');
        await this.postNextDealToChannels();
      } catch (err) {
        console.warn('[Achadinhos AutoFeed Erro]:', err.message);
      }
    }, intervalMs);

    return true;
  }

  stopAutoFeed() {
    if (this.autoFeedTimer) {
      clearInterval(this.autoFeedTimer);
      this.autoFeedTimer = null;
    }
    models.setSetting('ACHADINHOS_FEED_ENABLED', 'false');
    return true;
  }

  isAutoFeedRunning() {
    return Boolean(this.autoFeedTimer);
  }

  getFeedStatus() {
    const db = require('../db/database');
    const deals = models.getActiveDeals({ limit: 100 });
    const channels = models.getAchadinhosChannels();
    let postsToday = 0;
    try {
      postsToday = db.prepare("SELECT COUNT(*) as count FROM achadinhos_posts_log WHERE DATE(posted_at) = DATE('now')").get()?.count || 0;
    } catch (_) {}

    return {
      running: this.isAutoFeedRunning(),
      feedRunning: this.isAutoFeedRunning(),
      intervalMinutes: parseInt(models.getSetting('ACHADINHOS_FEED_INTERVAL_MIN', '30'), 10) || 30,
      totalDeals: deals.length,
      activeDealsCount: deals.length,
      totalChannels: channels.length,
      activeChannels: channels.filter(c => c.active === 1).length,
      postsToday,
      groupJid: models.getSetting('ACHADINHOS_GROUP_JID', ''),
      groupInvite: models.getSetting('ACHADINHOS_GROUP_INVITE', ''),
      channelJid: models.getSetting('ACHADINHOS_CHANNEL_JID', ''),
      channelInvite: models.getSetting('ACHADINHOS_CHANNEL_INVITE', '')
    };
  }

  // ==========================================
  // SUPORTE AO COMPRADOR & INTERAÇÕES
  // ==========================================

  /**
   * 9. Busca de Ofertas para Compradores (!buscar <termo>)
   */
  searchDealsForBuyer(query) {
    if (!query || typeof query !== 'string') {
      return `❓ *Uso correto:* \`!buscar <nome do produto>\`\n_Exemplo:_ \`!buscar fone bluetooth\` ou \`!buscar air fryer\``;
    }

    const cleanQuery = query.trim();
    const matches = models.searchDeals(cleanQuery, { limit: 3 });

    if (!matches || matches.length === 0) {
      return (
        `🔍 *Nenhum achadinho encontrado para:* "${cleanQuery}" 😕\n\n` +
        `💡 *Dica:* Gostaria de ser avisado assim que essa promoção aparecer?\n` +
        `Envie agora: 👉 \`!alerta ${cleanQuery}\`\n\n` +
        `🛍️ Para ver produtos disponíveis na nossa loja: digite *!catalogo* ou confira nossos cupons com *!cupons*!`
      );
    }

    let reply = `🔍 *ACHADINHOS ENCONTRADOS PARA:* "${cleanQuery}" 🛍️\n\n`;

    matches.forEach((d, idx) => {
      const orig = Number(d.original_price) || 0;
      const promo = Number(d.product_price) || 0;
      const discount = orig > promo && promo > 0 ? Math.round(((orig - promo) / orig) * 100) : 0;
      const pIcon = this.getPlatformIcon(d.platform);

      reply += `*${idx + 1}.* 📦 *${d.title}*\n`;
      if (orig > promo && promo > 0) {
        reply += `   ❌ De: ~R$ ${orig.toFixed(2).replace('.', ',')}~\n`;
        reply += `   ✅ Por apenas: *R$ ${promo.toFixed(2).replace('.', ',')}* 🔥 _(${discount}% OFF)_\n`;
      } else if (promo > 0) {
        reply += `   💰 Preço: *R$ ${promo.toFixed(2).replace('.', ',')}*\n`;
      }
      if (d.coupon_code) {
        reply += `   🎟️ Cupom: *${d.coupon_code}*\n`;
      }
      reply += `   ${pIcon} Loja: *${d.platform || 'Online'}*\n`;
      reply += `   👉 *Compre aqui com segurança:* ${d.affiliate_url}\n\n`;
    });

    reply += `🛡️ *Compra Garantida:* Todos os links direcionam para as lojas oficiais parceiras com entrega segura.\n`;
    reply += `💬 *Precisa de ajuda ou tirou dúvidas?* Envie *!suporte* ou fale conosco!`;

    return reply;
  }

  /**
   * 10. Alerta de Promoção para Compradores (!alerta <termo>)
   */
  handleBuyerAlertSubscription(phone, keyword, chatJid = null) {
    if (!keyword || keyword.trim().length < 2) {
      return `❓ *Uso correto:* \`!alerta <produto que você quer>\`\n_Exemplo:_ \`!alerta smartwatch\` ou \`!alerta iphone\``;
    }
    const cleanKw = keyword.trim();
    models.addBuyerAlert({ phone, keyword: cleanKw, chat_jid: chatJid });

    return (
      `🔔 *ALERTA ATIVADO COM SUCESSO!* 🎯\n\n` +
      `Ficaremos de olho 24h por dia para você! 👀\n` +
      `Assim que encontrarmos um achadinho imperdível para *"${cleanKw}"*, você receberá uma mensagem VIP no seu WhatsApp Privado com o link em primeira mão!\n\n` +
      `📋 Para ver seus alertas ativos: \`!meusalertas\`\n` +
      `❌ Para cancelar: \`!cancelaralerta ${cleanKw}\``
    );
  }

  /**
   * 11. Disparo de Alerta no PV dos Compradores
   */
  async notifyMatchingAlertsForDeal(deal, sock = null) {
    if (!deal) return 0;
    const textTarget = `${deal.title || ''} ${deal.keywords || ''} ${deal.category || ''} ${deal.pitch_copy || ''}`;
    const matchingAlerts = models.findMatchingBuyerAlerts(textTarget);
    if (!matchingAlerts || matchingAlerts.length === 0) return 0;

    const dispatchSock = sock || this.getDispatchSocket();
    const orig = Number(deal.original_price) || 0;
    const promo = Number(deal.product_price) || 0;
    const discount = orig > promo && promo > 0 ? Math.round(((orig - promo) / orig) * 100) : 0;
    const pIcon = this.getPlatformIcon(deal.platform);

    let notified = 0;
    for (const alert of matchingAlerts) {
      const cleanPhone = (alert.phone || '').replace(/\D/g, '');
      const recipientJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : alert.chat_jid;
      const alertMsg =
        `🔔 *ALERTA DE OFERTA EXCLUSIVA PARA VOCÊ!* 🛍️\n\n` +
        `Olá! Você pediu para ser avisado sobre *"${alert.keyword}"*.\n` +
        `Acabamos de encontrar esta promoção com desconto especial:\n\n` +
        `📦 *${deal.title}*\n` +
        (orig > promo && promo > 0
          ? `❌ De: ~R$ ${orig.toFixed(2).replace('.', ',')}~\n✅ Por apenas: *R$ ${promo.toFixed(2).replace('.', ',')}* 💥 _(${discount}% OFF)_\n`
          : `💰 Preço Promocional: *R$ ${promo.toFixed(2).replace('.', ',')}*\n`) +
        (deal.coupon_code ? `🎟️ Cupom: *${deal.coupon_code}*\n` : '') +
        `${pIcon} Loja: *${deal.platform || 'Online'}*\n\n` +
        `👉 *Aproveite antes que o estoque esgote:*\n🔗 ${deal.affiliate_url}\n\n` +
        `🛡️ *Compra Segura:* Entrega e garantia oficial da loja parceira.`;

      try {
        if (dispatchSock && typeof dispatchSock.sendMessage === 'function') {
          if (deal.image_url && typeof deal.image_url === 'string' && deal.image_url.startsWith('http')) {
            await dispatchSock.sendMessage(recipientJid, { image: { url: deal.image_url }, caption: alertMsg });
          } else {
            await dispatchSock.sendMessage(recipientJid, { text: alertMsg });
          }
        } else if (whatsappBot && typeof whatsappBot.sendMessage === 'function') {
          await whatsappBot.sendMessage(recipientJid, alertMsg);
        }
        models.markBuyerAlertNotified(alert.id);
        notified++;
      } catch (_) {}
    }
    return notified;
  }

  /**
   * 12. FAQ e Suporte Cognitivo para Compradores
   */
  getBuyerFaqResponse(questionText) {
    if (!questionText || typeof questionText !== 'string') return null;
    const q = questionText.toLowerCase();

    if (/(?:seguro|confi[aá]vel|golpe|seguran[çc]a|medo|original|verdadeiro|fake)/i.test(q)) {
      return (
        `🛡️ *COMPRA 100% SEGURA E VERIFICADA!* 🔒\n\n` +
        `Todos os links divulgados no nosso canal e grupo direcionam diretamente para as *lojas oficiais e verificadas* (Shopee Oficial, Mercado Livre com Compra Garantida, Amazon, Magalu).\n\n` +
        `✅ Você paga direto na plataforma oficial com nota fiscal\n` +
        `✅ Proteção total ao comprador com código de rastreamento\n` +
        `✅ 7 dias de garantia incondicional de devolução pelo CDC\n\n` +
        `Pode comprar com tranquilidade total!`
      );
    }

    if (/(?:cupo[mn]s?|descontos?|como usar|c[oó]digos?|n[aã]o funcionou|aplicar cupo[mn])/i.test(q)) {
      return (
        `🎟️ *COMO USAR E APLICAR CUPONS DE DESCONTO:* ✂️\n\n` +
        `1️⃣ Clique no link seguro da oferta e abra o produto.\n` +
        `2️⃣ Adicione o produto ao carrinho e prossiga para a finalização.\n` +
        `3️⃣ Na tela de pagamento, localize o campo *"Inserir Cupom"* ou *"Cupom da Loja"*.\n` +
        `4️⃣ Digite o código exatamente como informado na oferta e clique em aplicar!\n\n` +
        `⚠️ *Atenção:* Cupons de grandes lojas possuem limite de resgates. Se esgotar, aproveite o preço promocional direto!`
      );
    }

    if (/(?:frete|entrega|prazo|chega quando|correios|sedex|rastreio)/i.test(q)) {
      return (
        `🚚 *INFORMAÇÕES DE FRETE E ENTREGA:* 📦\n\n` +
        `O prazo e o valor do frete são calculados instantaneamente inserindo o seu CEP na página oficial do produto.\n\n` +
        `✨ Grande parte das nossas ofertas conta com *Frete Grátis* ou opções de entrega rápida (Full / Prime / Express).\n` +
        `Após a confirmação do pagamento, você recebe o código de rastreio direto no seu app da loja ou e-mail!`
      );
    }

    if (/(?:pagamento|pagar|pix|cart[aã]o|parcelado|boleto)/i.test(q)) {
      return (
        `💳 *FORMAS DE PAGAMENTO ACEITAS:* ⚡\n\n` +
        `Nas lojas oficiais parceiras você pode pagar via:\n` +
        `• *Pix:* Aprovação imediata (ideal para não perder promoções relâmpago!)\n` +
        `• *Cartão de Crédito:* Parcelamento em até 10x ou 12x\n` +
        `• *Boleto Bancário:* Compensação em 1 a 2 dias úteis`
      );
    }

    return null;
  }

  /**
   * 13. Lista de Cupons Ativos
   */
  getActiveCouponsList() {
    const deals = models.getActiveDeals({ limit: 50 });
    const dealsWithCoupons = deals.filter(d => d.coupon_code && d.coupon_code.trim());

    if (dealsWithCoupons.length === 0) {
      return (
        `🎟️ *CUPONS ATIVOS DE HOJE* 🛍️\n\n` +
        `No momento a maioria dos achadinhos está com *desconto direto no link* (sem necessidade de cupom).\n\n` +
        `Fique atento ao grupo que assim que liberarem novos cupons relâmpago postaremos aqui!`
      );
    }

    let reply = `🎟️ *CUPONS ATIVOS & DESCONTOS DE HOJE!* 💥\n\n`;
    const seen = new Set();
    dealsWithCoupons.forEach(d => {
      if (seen.has(d.coupon_code)) return;
      seen.add(d.coupon_code);
      const pIcon = this.getPlatformIcon(d.platform);
      reply += `• *${d.coupon_code}* → ${pIcon} *${d.platform}* (${d.title.slice(0, 45)}...)\n`;
      reply += `  👉 Link com desconto: ${d.affiliate_url}\n\n`;
    });
    reply += `_Dica: Copie o código e cole na tela de checkout da loja!_`;
    return reply;
  }

  /**
   * 14. Guia do Comprador
   */
  getBuyerHelpGuide() {
    return (
      `🛍️ *CENTRAL DE AJUDA & COMO FUNCIONA O ACHADINHOS* 💡\n\n` +
      `Aqui nós mineramos e selecionamos os melhores descontos da internet para você economizar com segurança!\n\n` +
      `📌 *COMANDOS DISPONÍVEIS:*\n` +
      `• \`!buscar <produto>\` → Pesquisa ofertas no catálogo na hora\n` +
      `• \`!alerta <produto>\` → Ativa alerta no seu PV quando houver promoção\n` +
      `• \`!meusalertas\` → Consulta seus alertas ativos\n` +
      `• \`!cancelaralerta <produto>\` → Cancela um alerta\n` +
      `• \`!cupons\` → Lista os cupons de desconto válidos hoje\n` +
      `• \`!comofunciona\` → Informações de segurança e frete\n` +
      `• \`!suporte\` → Falar com atendimento humano\n\n` +
      `🛡️ *Garantia:* Todos os links são auditados e oficiais com proteção ao consumidor!`
    );
  }

  /**
   * 14.1 Guia Completo de Comandos Abreviados & Atalhos (!menuabv)
   */
  getAbbreviatedMenuGuide() {
    return (
      `⚡ *GUIA DE COMANDOS ABREVIADOS & ATALHOS RÁPIDOS* ⚡\n` +
      `_Use as abreviações para gerenciar o bot e navegar com máxima agilidade!_\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛍️ *ACHADINHOS & GESTÃO (DONO / ADMIN)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• \`!stp\` ➔ \`!achadinhos setup\`\n` +
      `  _(Setup completo: cria Grupo + Canal VIP, catálogo e ativa feed)_\n\n` +
      `• \`!st\` ➔ \`!achadinhos status\`\n` +
      `  _(Painel de controle, status do feed, total de ofertas e canais)_\n\n` +
      `• \`!cgp\` ➔ \`!achadinhos criargrupo [nome]\`\n` +
      `  _(Cria grupo WhatsApp @g.us com link de convite automático)_\n\n` +
      `• \`!ccn\` ➔ \`!achadinhos criarcanal [nome]\`\n` +
      `  _(Cria canal oficial @newsletter com link público)_\n\n` +
      `• \`!fon [min]\` ➔ \`!achadinhos feed on [min]\`\n` +
      `  _(Ativa postagens automáticas. Ex: !fon 15)_\n\n` +
      `• \`!foff\` ➔ \`!achadinhos feed off\`\n` +
      `  _(Pausa o feed automático de ofertas)_\n\n` +
      `• \`!post [id]\` ➔ \`!achadinhos postar [id]\`\n` +
      `  _(Dispara a próxima oferta ou ID específico nos canais agora)_\n\n` +
      `• \`!add <dados>\` ➔ \`!achadinhos add <link> <tit> | <de> | <por> | [cupom]\`\n` +
      `  _(Cadastra produto rápido via sintaxe pipe com imagem e cupom)_\n\n` +
      `• \`!sc\` ➔ \`!achadinhos sinc\`\n` +
      `  _(Sincroniza produtos da sua loja virtual para o feed)_\n\n` +
      `• \`!cv\` ➔ \`!achadinhos convites\`\n` +
      `  _(Pega os links de convite oficiais do grupo e canal)_\n\n` +
      `• \`!ls\` ➔ \`!achadinhos listar\`\n` +
      `  _(Lista as últimas ofertas ativas cadastradas no banco)_\n\n` +
      `• \`!rm <id>\` ➔ \`!achadinhos del <id>\`\n` +
      `  _(Desativa ou remove uma oferta pelo ID)_\n\n` +
      `💡 _Dica: Você também pode usar_ \`!ach\` _antes do atalho (ex: \`!ach st\`, \`!ach post\`, \`!ach fon 20\`)._\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛒 *COMPRADORES & CLIENTES (PV OU GRUPO)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• \`!b <termo>\` ➔ \`!buscar <termo>\`\n` +
      `  _(Busca promoções na hora. Ex: !b fone | !b air fryer)_\n\n` +
      `• \`!a <termo>\` ➔ \`!alerta <termo>\`\n` +
      `  _(Alerta no PV quando o produto entrar em promoção. Ex: !a smartwatch)_\n\n` +
      `• \`!ma\` ➔ \`!meusalertas\`\n` +
      `  _(Consulta todos os seus alertas ativos de monitoramento)_\n\n` +
      `• \`!ca <termo>\` ➔ \`!cancelaralerta <termo>\`\n` +
      `  _(Cancela monitoramento de preço. Ex: !ca smartwatch ou !ca all)_\n\n` +
      `• \`!cp\` ➔ \`!cupons\`\n` +
      `  _(Lista todos os cupons e descontos válidos de hoje)_\n\n` +
      `• \`!cmf\` ➔ \`!comofunciona\`\n` +
      `  _(FAQ de segurança, garantia CDC de 7 dias e frete)_\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔑 *PAINEL, DONO & SISTEMA*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• \`!pn [senha]\` ➔ \`!painel [senha]\` / \`!tunnel\`\n` +
      `  _(Envia link seguro HTTPS do painel web diretamente no PV)_\n\n` +
      `• \`!dono [senha]\` ➔ \`!souodono <senha>\`\n` +
      `  _(Ativa número como Dono Supremo de qualquer WhatsApp)_\n\n` +
      `• \`!m\` ➔ \`!menu\`\n` +
      `  _(Abre o cockpit executivo ou o catálogo geral da loja)_\n\n` +
      `• \`!px\` ➔ \`!pix\`\n` +
      `  _(Gera cobrança rápida via Pix Copia e Cola)_\n\n` +
      `• \`!fl\` ➔ \`!flowith\` / \`!ia flowith\`\n` +
      `  _(Status do Flowith Blank: telemetria de economia e zero tokens)_\n\n` +
      `• \`!cf\` ➔ \`!chavefree\`\n` +
      `  _(Instruções e links para pegar chave de IA 100% grátis na hora)_\n\n` +
      `• \`!sw\` ➔ \`!enxame\`\n` +
      `  _(Telemetria do Exército: grupos minerados, produtos no auge e chaves)_\n\n` +
      `• \`!ia <texto>\` ➔ \`!ia <pergunta>\`\n` +
      `  _(IA conversacional com prioridade no Flowith Blank e fallback em tokens)_\n\n` +
      `• \`!mabv\` ➔ \`!menuabv\`\n` +
      `  _(Reabre este menu completo de atalhos e comandos abreviados)_\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
  }

  /**
   * 15. Roteador de Comandos de Achadinhos & Atalhos (Admin & Compradores)
   */
  async handleAchadinhosCommand({
    sock,
    from,
    text = '',
    senderPhone = '',
    isOwnerUser = false,
    isGroup = false,
    participantJid = null,
    isFromMe = false,
    senderName = 'Cliente'
  } = {}) {
    const rawParts = text.trim().split(/\s+/);
    const firstWord = (rawParts[0] || '').replace(/^[!/]/, '').toLowerCase();
    const activeSock = sock || this.getDispatchSocket();

    // Identifica se começou com prefixo principal (!achadinhos, !ach, !acd, etc.)
    const isMainPrefix = ['achadinhos', 'achadinho', 'achados', 'achado', 'ach', 'acd', 'ad'].includes(firstWord);

    let rawCmd = '';
    let argParts = [];

    if (isMainPrefix) {
      rawCmd = (rawParts[1] || '').toLowerCase();
      argParts = rawParts.slice(2);
    } else {
      rawCmd = firstWord;
      argParts = rawParts.slice(1);
    }

    // Mapeamento de abreviações e aliases universais
    const aliasMap = {
      'stp': 'setup',
      'iniciar': 'setup',
      'auto': 'setup',
      'criartudo': 'setup',

      'st': 'status',
      'pnl': 'status',
      'painel': 'status',
      'dashboard': 'status',
      'dash': 'status',

      'cgp': 'criargrupo',
      'cg': 'criargrupo',
      'novogrupo': 'criargrupo',
      'grupo': 'criargrupo',

      'ccn': 'criarcanal',
      'cc': 'criarcanal',
      'novocanal': 'criarcanal',
      'canal': 'criarcanal',

      'pst': 'postar',
      'post': 'postar',
      'disparar': 'postar',
      'enviar': 'postar',

      'fd': 'feed',
      'fon': 'feed_on',
      'foff': 'feed_off',

      'sc': 'sinc',
      'sincronizar': 'sinc',
      'sync': 'sinc',

      'cad': 'add',
      'adicionar': 'add',
      'novo': 'add',

      'cv': 'convites',
      'conv': 'convites',
      'convite': 'convites',
      'links': 'convites',
      'link': 'convites',

      'ls': 'listar',
      'ofertas': 'listar',
      'catalogo': 'listar',

      'rm': 'del',
      'remover': 'del',
      'delete': 'del',

      'b': 'buscar',
      'f': 'buscar',
      'procurar': 'buscar',

      'a': 'alerta',
      'alt': 'alerta',
      'alertapreco': 'alerta',

      'ma': 'meusalertas',
      'meusalt': 'meusalertas',
      'meus_alertas': 'meusalertas',

      'ca': 'cancelaralerta',
      'delalt': 'cancelaralerta',
      'removeralerta': 'cancelaralerta',

      'cp': 'cupons',
      'cup': 'cupons',
      'cupom': 'cupons',

      'cmf': 'comofunciona',
      'faq': 'comofunciona',
      'ajuda': 'comofunciona',
      'help': 'comofunciona',
      'guia': 'comofunciona',

      'mabv': 'menuabv',
      'abv': 'menuabv',
      'atalhos': 'menuabv',
      'menuatalhos': 'menuabv',
      'alias': 'menuabv',
      'curtos': 'menuabv',
      'comandoscurtos': 'menuabv',

      'fl': 'flowith',
      'flow': 'flowith',

      'cf': 'chavefree',
      'chavefree': 'chavefree',
      'keyfree': 'chavefree',
      'comopegarchave': 'chavefree',
      'obterchave': 'chavefree',
      'tutorialchave': 'chavefree',

      'sw': 'enxame',
      'swarm': 'enxame',
      'garimpo': 'enxame',

      'pendentes': 'pendentes',
      'aguardando': 'pendentes',
      'fila': 'pendentes',
      'afiliar': 'afiliar',
      'vincular': 'afiliar',
      'liberar': 'afiliar'
    };

    let cmd = aliasMap[rawCmd] || rawCmd;

    // Se usuário digitou "!ach feed on 15" ou "!ach fd on 15"
    if (cmd === 'feed' && (argParts[0] === 'on' || argParts[0] === 'start' || argParts[0] === 'ativar')) {
      cmd = 'feed_on';
      argParts = argParts.slice(1);
    } else if (cmd === 'feed' && (argParts[0] === 'off' || argParts[0] === 'stop' || argParts[0] === 'pausar')) {
      cmd = 'feed_off';
      argParts = argParts.slice(1);
    }

    // GUIA DE ATALHOS & ABREVIAÇÕES (!menuabv)
    if (cmd === 'menuabv') {
      return activeSock.sendMessage(from, { text: this.getAbbreviatedMenuGuide() });
    }

    // INSTRUÇÕES DE CHAVE DE IA GRATUITA (!cf / !chavefree)
    if (cmd === 'chavefree') {
      const parsedId = Number(argParts[0]);
      const subbotId = (!isNaN(parsedId) && parsedId > 0) ? parsedId : (activeSock?.instanceId || 1);
      const aiManager = require('./aiManagerService');
      const instructions = aiManager.getFreeApiKeyInstructions({
        subbotId,
        isBlocked: false
      });
      return activeSock.sendMessage(from, { text: instructions });
    }

    // TELEMETRIA DO ENXAME (!sw / !enxame)
    if (cmd === 'enxame') {
      const swarmIntelligence = require('./swarmIntelligenceService');
      const sub = (argParts[0] || '').toLowerCase();
      if (sub === 'compradores' || sub === 'leads' || sub === 'clientes') {
        const buyers = models.listSwarmCollectedBuyerLeads ? models.listSwarmCollectedBuyerLeads(25) : [];
        if (buyers.length === 0) {
          return activeSock.sendMessage(from, { text: '🎯 *Nenhum comprador garimpado até o momento.*\n_Os Sub-Bots (mesmo em modo OFF) estão monitorando ativamente intenções de compra nos grupos._' });
        }
        let txt = `🎯 *COMPRADORES & LEADS GARIMPADOS PELO ENXAME (${buyers.length})* 🛍️\n\n`;
        buyers.forEach((b, idx) => {
          const offBadge = b.subbot_was_off ? ' _[💤 Capturado em OFF]_' : '';
          txt += `${idx + 1}. *+${b.phone}* - ${b.name || 'Cliente'}${offBadge}\n` +
                 `   💬 *Intenção:* _"${b.intent_keyword || 'Compra'}"_\n` +
                 `   📝 *Texto:* _"${b.message_text ? b.message_text.slice(0, 80) : ''}"_\n` +
                 `   🤖 *Sub-Bot:* #${b.collected_by_subbot_id || 1}\n\n`;
        });
        return activeSock.sendMessage(from, { text: txt });
      }
      return activeSock.sendMessage(from, { text: swarmIntelligence.formatSwarmReport() });
    }

    // TELEMETRIA E CONTROLE DO FLOWITH AI BLANK (!fl / !flowith)
    if (cmd === 'flowith') {
      const flowithService = require('./flowithService');
      const action = (argParts[0] || '').toLowerCase();
      if (action === 'on' || action === 'ativar') {
        flowithService.setEnabled(true);
        return activeSock.sendMessage(from, { text: '✅ *FLOWITH BLANK ATIVADO!*\n\nTodas as requisições de IA tentarão primeiramente o Flowith Blank (https://flowith.io/blank) para economizar 100% dos seus tokens de API.' });
      }
      if (action === 'off' || action === 'desativar') {
        flowithService.setEnabled(false);
        return activeSock.sendMessage(from, { text: '⚠️ *FLOWITH BLANK PAUSADO!*\n\nO bot agora utilizará diretamente os seus tokens de API cadastrados (Gemini, Groq, OpenAI).' });
      }
      return activeSock.sendMessage(from, { text: flowithService.formatStatusMessage() });
    }

    // COMANDOS DE COMPRADORES (LIVRES PARA QUALQUER MEMBRO)
    if (cmd === 'buscar') {
      const q = argParts.join(' ').trim();
      const reply = this.searchDealsForBuyer(q);
      return activeSock.sendMessage(from, { text: reply });
    }

    if (cmd === 'alerta') {
      const q = argParts.join(' ').trim();
      const reply = this.handleBuyerAlertSubscription(senderPhone, q, from);
      return activeSock.sendMessage(from, { text: reply });
    }

    if (cmd === 'meusalertas') {
      const alerts = models.getBuyerAlertsByPhone(senderPhone);
      if (!alerts || alerts.length === 0) {
        return activeSock.sendMessage(from, { text: `🔕 Você não possui alertas de ofertas ativos.\nEnvie \`!alerta <produto>\` (ou \`!a <produto>\`) para ativar!` });
      }
      let msg = `🔔 *SEUS ALERTAS DE PROMOÇÃO ATIVOS:* 🎯\n\n`;
      alerts.forEach((a, i) => {
        msg += `${i + 1}. *"${a.keyword}"* (notificado ${a.notified_count}x)\n`;
      });
      msg += `\nPara cancelar: \`!cancelaralerta <palavra>\` (ou \`!ca <palavra>\` / \`!ca all\`)`;
      return activeSock.sendMessage(from, { text: msg });
    }

    if (cmd === 'cancelaralerta') {
      const q = argParts.join(' ').trim();
      models.removeBuyerAlert(senderPhone, q);
      return activeSock.sendMessage(from, { text: `✅ Alerta "${q || 'todos'}" cancelado com sucesso!` });
    }

    if (cmd === 'cupons') {
      return activeSock.sendMessage(from, { text: this.getActiveCouponsList() });
    }

    if (cmd === 'comofunciona') {
      return activeSock.sendMessage(from, { text: this.getBuyerHelpGuide() });
    }

    if (cmd === 'convites') {
      const gInvite = models.getSetting('ACHADINHOS_GROUP_INVITE', '');
      const cInvite = models.getSetting('ACHADINHOS_CHANNEL_INVITE', '');
      let reply = `🔗 *CONVITES OFICIAIS DO ACHADINHOS:* 🛍️\n\n`;
      if (gInvite) reply += `👥 *Grupo de Ofertas & Discussão:* ${gInvite}\n\n`;
      if (cInvite) reply += `📢 *Canal VIP WhatsApp:* ${cInvite}\n\n`;
      if (!gInvite && !cInvite) reply += `⚠️ Nenhum grupo ou canal criado ainda. Digite *!stp* ou *!achadinhos setup* para criar!`;
      return activeSock.sendMessage(from, { text: reply });
    }

    // COMANDOS DE ADMINISTRAÇÃO E GESTÃO (EXCLUSIVO DONO / ADMIN)
    if (!isOwnerUser) {
      return activeSock.sendMessage(from, { text: this.getBuyerHelpGuide() });
    }

    // PAINEL DO DONO
    if (!cmd || cmd === 'status') {
      const status = this.getFeedStatus();
      const statusText =
        `🛍️ *CENTRAL DE GESTÃO: ACHADINHOS & OFERTAS VIP* 👑\n\n` +
        `📊 *Status do Sistema:*\n` +
        `• *Feed Automático:* ${status.running ? '🟢 ATIVO' : '🔴 PAUSADO'} (a cada ${status.intervalMinutes} min)\n` +
        `• *Total de Ofertas Cadastradas:* *${status.totalDeals}*\n` +
        `• *Canais & Grupos Configurados:* *${status.activeChannels} ativos* (de ${status.totalChannels})\n` +
        `• *Postagens Realizadas Hoje:* *${status.postsToday}*\n\n` +
        `🔗 *Links de Acesso:*\n` +
        (status.groupInvite ? `• *Grupo VIP:* ${status.groupInvite}\n` : `• *Grupo:* _(Nenhum criado ainda)_\n`) +
        (status.channelInvite ? `• *Canal WhatsApp:* ${status.channelInvite}\n\n` : `• *Canal:* _(Nenhum criado ainda)_\n\n`) +
        `🛠️ *Comandos Executivos Disponíveis:*\n` +
        `1️⃣ \`!stp\` ou \`!achadinhos setup\` → Cria Grupo + Canal e inicializa o feed\n` +
        `2️⃣ \`!cgp [nome]\` ou \`!achadinhos criargrupo\` → Cria apenas o grupo de ofertas\n` +
        `3️⃣ \`!ccn [nome]\` ou \`!achadinhos criarcanal\` → Cria apenas o canal oficial\n` +
        `4️⃣ \`!post [id]\` ou \`!achadinhos postar [id]\` → Dispara uma oferta agora\n` +
        `5️⃣ \`!fon [min]\` / \`!foff\` → Liga/desliga feed automático\n` +
        `6️⃣ \`!add <link> <titulo> | <de> | <por> | [cupom]\` → Cadastra nova oferta\n` +
        `7️⃣ \`!sc\` ou \`!achadinhos sinc\` → Sincroniza produtos da Loja para Achadinhos\n` +
        `8️⃣ \`!ls\` ou \`!achadinhos listar\` → Lista ofertas do catálogo\n\n` +
        `⚡ *Guia Completo de Abreviações:* Digite \`!menuabv\` para ver todos os atalhos!`;
      return activeSock.sendMessage(from, { text: statusText });
    }

    if (cmd === 'setup') {
      await activeSock.sendMessage(from, { text: `⏳ *Inicializando Setup da Estrutura de Achadinhos...*\nCriando grupo, canal do WhatsApp e catalogando ofertas iniciais...` });
      try {
        const res = await this.setupFullStructure({ sock: activeSock });
        const summary =
          `🎉 *ESTRUTURA DE ACHADINHOS CRIADA COM SUCESSO!* 🛍️\n\n` +
          `👥 *Grupo WhatsApp Criado:*\n` +
          `• Nome: *${res.group.name}*\n` +
          `• Link de Convite: ${res.group.inviteUrl}\n\n` +
          `📢 *Canal WhatsApp Criado:*\n` +
          `• Nome: *${res.channel.name}*\n` +
          `• Link do Canal: ${res.channel.inviteUrl}\n\n` +
          `📦 *Catálogo:* *${res.seededDeals}* ofertas adicionadas ao feed!\n` +
          `⚡ *Feed Automático:* Ativado com postagens programadas!\n\n` +
          `👉 Compartilhe o link do grupo para começar a receber membros e faturar comissões!\n\n` +
          `💡 _Dica: Digite \`!menuabv\` para ver todos os atalhos rápidos de gestão!_`;
        return activeSock.sendMessage(from, { text: summary });
      } catch (setupErr) {
        return activeSock.sendMessage(from, { text: `❌ *Falha no Setup:* ${setupErr.message}` });
      }
    }

    if (cmd === 'criargrupo') {
      const gName = argParts.join(' ').trim() || null;
      await activeSock.sendMessage(from, { text: `⏳ Criando Grupo de Achadinhos...` });
      try {
        const gRes = await this.createAchadinhosGroup({ name: gName, sock: activeSock });
        return activeSock.sendMessage(from, {
          text: `✅ *Grupo de Achadinhos Criado com Sucesso!*\n\n• Nome: *${gRes.name}*\n• JID: \`${gRes.jid}\`\n• Convite: ${gRes.inviteUrl}\n\n💡 _Atalho: digite \`!cgp\` para criar outros grupos no futuro!_`
        });
      } catch (err) {
        return activeSock.sendMessage(from, { text: `❌ Erro ao criar grupo: ${err.message}` });
      }
    }

    if (cmd === 'criarcanal') {
      const cName = argParts.join(' ').trim() || null;
      await activeSock.sendMessage(from, { text: `⏳ Criando Canal de Notícias de Achadinhos...` });
      try {
        const cRes = await this.createAchadinhosChannel({ name: cName, sock: activeSock });
        return activeSock.sendMessage(from, {
          text: `✅ *Canal de Achadinhos Criado com Sucesso!*\n\n• Nome: *${cRes.name}*\n• JID: \`${cRes.jid}\`\n• Convite: ${cRes.inviteUrl}\n\n💡 _Atalho: digite \`!ccn\` para criar outros canais no futuro!_`
        });
      } catch (err) {
        return activeSock.sendMessage(from, { text: `❌ Erro ao criar canal: ${err.message}` });
      }
    }

    if (cmd === 'postar') {
      const dealId = argParts[0] ? parseInt(argParts[0], 10) : null;
      await activeSock.sendMessage(from, { text: `⏳ Despachando oferta para canais e grupos de achadinhos...` });
      try {
        let res;
        if (dealId) {
          const deal = models.getAffiliateLinkById(dealId);
          if (!deal) return activeSock.sendMessage(from, { text: `❌ Oferta #${dealId} não encontrada.` });
          res = await this.broadcastLinkToChannels(deal, { mention_all: true, sock: activeSock });
        } else {
          res = await this.postNextDealToChannels({ mention_all: true, sock: activeSock });
        }
        return activeSock.sendMessage(from, {
          text: `✅ *Oferta Postada com Sucesso!*\nEnviada para ${res.result?.sent || res.sent || 1} canal(is)/grupo(s).`
        });
      } catch (err) {
        return activeSock.sendMessage(from, { text: `❌ Falha ao postar: ${err.message}` });
      }
    }

    if (cmd === 'feed_on') {
      const interval = argParts[0] ? parseInt(argParts[0], 10) : 30;
      this.startAutoFeed(interval);
      return activeSock.sendMessage(from, { text: `🟢 *Feed Automático de Achadinhos ATIVADO!*\nNovas ofertas serão postadas a cada *${interval} minutos*.\n\n💡 _Para pausar use: \`!foff\`_` });
    }

    if (cmd === 'feed_off') {
      this.stopAutoFeed();
      return activeSock.sendMessage(from, { text: `🔴 *Feed Automático PAUSADO!*\n\n💡 _Para religar use: \`!fon [min]\`_` });
    }

    if (cmd === 'sinc') {
      const count = this.syncStoreProductsToAchadinhos();
      return activeSock.sendMessage(from, { text: `✅ *Sincronização Concluída!* ${count} produtos da loja foram adicionados ao catálogo de achadinhos.` });
    }

    if (cmd === 'listar') {
      const deals = models.getActiveDeals({ limit: 10 });
      if (deals.length === 0) return activeSock.sendMessage(from, { text: `📭 Nenhuma oferta ativa. Digite *!stp* para popular!` });
      let list = `📋 *ÚLTIMAS OFERTAS NO CATÁLOGO DE ACHADINHOS:* 🛍️\n\n`;
      deals.forEach(d => {
        list += `• *#${d.id}* [${d.platform}] *${d.title.slice(0, 40)}* - R$ ${Number(d.product_price || 0).toFixed(2)}\n`;
      });
      list += `\nPara postar uma específica: \`!post <id>\` (ou \`!achadinhos postar <id>\`)`;
      return activeSock.sendMessage(from, { text: list });
    }

    if (cmd === 'add') {
      const textToParse = argParts.join(' ');
      try {
        const newDeal = this.parseAndAddDealFromText(textToParse);
        return activeSock.sendMessage(from, {
          text: `✅ *Oferta Cadastrada com Sucesso!* 🛍️\n\n• ID: *#${newDeal.id}*\n• Produto: *${newDeal.title}*\n• Link Mantido: ${newDeal.affiliate_url}\n• Preço: *R$ ${Number(newDeal.product_price).toFixed(2)}*\n\n🔒 _Seu link foi preservado 100% íntegro sem qualquer alteração._\nDigite \`!post ${newDeal.id}\` para postar agora!`
        });
      } catch (err) {
        return activeSock.sendMessage(from, {
          text: `❌ *Erro ao cadastrar:* ${err.message}\n\n*Formato aceito:*\n\`!add <link> <titulo> | <de R$> | <por R$> | [cupom]\`\n\n_Exemplo:_\n\`!add https://shope.ee/xyz Fone Bluetooth Pro | 149.90 | 49.90 | CUPOM10\``
        });
      }
    }

    // ADIÇÃO EM MASSA DE LINKS MANUAIS DO DONO (PRESERVAÇÃO TOTAL DOS LINKS)
    if (cmd === 'addmassa' || cmd === 'importar' || cmd === 'cadmassa') {
      const textToParse = argParts.join(' ');
      if (!textToParse.trim()) {
        return activeSock.sendMessage(from, {
          text: `❓ *Uso do !addmassa:*\n\nEnvie múltiplos links (um por linha). Seus links serão preservados 100% como enviados:\n\n\`!addmassa\nhttps://s.shopee.com.br/meulink1 Fone TWS | 120 | 60 | CUPOM10\nhttps://meli.la/meulink2 Smartwatch Pro | 200 | 110\nhttps://amzn.to/meulink3 Alexa Echo Dot | 350 | 250\``
        });
      }

      try {
        const affiliatePlatformService = require('./affiliatePlatformService');
        const res = await affiliatePlatformService.bulkImportAffiliateLinks(textToParse);
        return activeSock.sendMessage(from, {
          text: `🎉 *IMPORTAÇÃO EM MASSA CONCLUÍDA!* 🛍️\n\n` +
            `📦 *Produtos Cadastrados:* ${res.importedCount}/${res.total}\n` +
            `🔒 *Preservação de Link:* 100% dos seus links foram mantidos intactos exatamente como você colou!\n` +
            `🟢 *Status:* Todos ativos e liberados para envio imediato nos grupos.`
        });
      } catch (err) {
        return activeSock.sendMessage(from, {
          text: `❌ *Erro na importação em massa:* ${err.message}`
        });
      }
    }

    if (cmd === 'del') {
      const dealId = argParts[0] ? parseInt(argParts[0], 10) : null;
      if (!dealId) return activeSock.sendMessage(from, { text: `❓ *Uso:* \`!rm <id>\` ou \`!achadinhos del <id>\`` });
      models.deactivateDeal(dealId);
      return activeSock.sendMessage(from, { text: `✅ Oferta #${dealId} desativada com sucesso!` });
    }

    // LISTAR OFERTAS MINERADAS QUE ESTÃO AGUARDANDO LINK DE AFILIADO DO DONO
    if (cmd === 'pendentes' || cmd === 'aguardando') {
      const pending = models.getPendingAffiliateLinks({ limit: 20 });
      if (pending.length === 0) {
        return activeSock.sendMessage(from, {
          text: `🎉 *NENHUM PRODUTO PENDENTE!*\n\nTodos os produtos minerados estão com a sua ID de Afiliado aplicada e liberados para postagem.`
        });
      }
      let list = `⏳ *PRODUTOS AGUARDANDO SEU LINK DE AFILIADO (${pending.length}):*\n\n` +
        `_Estes itens foram minerados pelo robô mas estão pausados até você adicionar o seu link oficial, garantindo que 100% da comissão seja sua:_\n\n`;
      pending.forEach((p, idx) => {
        const price = Number(p.product_price) > 0 ? ` — R$ ${Number(p.product_price).toFixed(2).replace('.', ',')}` : '';
        list += `*${idx + 1}.* [#${p.id}] *${p.title}* (${p.platform})${price}\n` +
          `   🔗 Original: ${p.original_product_url || p.affiliate_url}\n` +
          `   👉 *Liberar para postar:* \`!afiliar ${p.id} <seu_link>\`\n\n`;
      });
      list += `💡 _Envie \`!afiliar <id> <seu_link>\` para liberar o produto para o feed automático e para o Social Listening dos seus grupos._`;
      return activeSock.sendMessage(from, { text: list });
    }

    // VINCULAR LINK DE AFILIADO DO DONO E LIBERAR PRODUTO PARA POSTAGEM
    if (cmd === 'afiliar' || cmd === 'vincular') {
      const linkId = parseInt(argParts[0], 10);
      const userLink = argParts[1];
      if (!linkId || !userLink) {
        return activeSock.sendMessage(from, {
          text: `❓ *Uso:* \`!afiliar <id> <seu_link_de_afiliado>\`\n*Exemplo:* \`!afiliar 45 https://shope.ee/meu-link\`\n\n💡 _Para ver os produtos pendentes, envie \`!pendentes\`._`
        });
      }

      if (this.isDummyAffiliateUrl(userLink)) {
        return activeSock.sendMessage(from, {
          text: `❌ *Link inválido ou simulado:* O link fornecido parece ser de teste. Por favor forneça o seu link de afiliado oficial.`
        });
      }

      const updated = models.attachUserAffiliateLink(linkId, userLink);
      if (!updated) {
        return activeSock.sendMessage(from, {
          text: `❌ Produto #${linkId} não encontrado no banco de dados.`
        });
      }

      // Distribui imediatamente nos fluxos agora que possui o link oficial do dono
      try {
        const affiliatePlatformService = require('./affiliatePlatformService');
        affiliatePlatformService.distributeLinkToFlows(linkId);
      } catch (_) {}

      return activeSock.sendMessage(from, {
        text: `✅ *PRODUTO #${linkId} LIBERADO COM SUCESSO!* 🎉\n\n` +
          `📦 *${updated.title}*\n` +
          `🏷️ Plataforma: *${updated.platform}*\n` +
          `🔗 Seu Link Oficial: ${updated.affiliate_url}\n` +
          `🟢 *Status:* PRONTO PARA POSTAR!\n\n` +
          `_O produto agora faz parte da lista oficial de postagens automáticas e do Social Listening dos seus grupos._`
      });
    }

    return activeSock.sendMessage(from, { text: this.getBuyerHelpGuide() });
  }

  /**
   * 16. Parser de Ofertas via Texto
   */
  parseAndAddDealFromText(text) {
    if (!text || !text.trim()) throw new Error('Texto da oferta não fornecido.');
    const trimmed = text.trim();

    const urlMatch = trimmed.match(/https?:\/\/[^\s|]+/i);
    if (!urlMatch) throw new Error('Nenhum link http/https encontrado.');
    const url = urlMatch[0];

    const rest = trimmed.replace(url, '').trim();
    // Remove qualquer barra ou pipe inicial que sobrou após a url
    const cleanedRest = rest.replace(/^[\s|]+/, '').trim();
    const rawSegments = cleanedRest.split('|').map(s => s.trim()).filter(Boolean);

    let title = 'Achadinho Exclusivo';
    let origPrice = 0.0;
    let promoPrice = 29.90;
    let coupon = null;

    if (rawSegments.length >= 4) {
      title = rawSegments[0];
      origPrice = parseFloat(rawSegments[1].replace('R$', '').replace(',', '.').trim()) || 0.0;
      promoPrice = parseFloat(rawSegments[2].replace('R$', '').replace(',', '.').trim()) || origPrice;
      coupon = rawSegments[3].trim();
    } else if (rawSegments.length === 3) {
      title = rawSegments[0];
      origPrice = parseFloat(rawSegments[1].replace('R$', '').replace(',', '.').trim()) || 0.0;
      promoPrice = parseFloat(rawSegments[2].replace('R$', '').replace(',', '.').trim()) || origPrice;
    } else if (rawSegments.length === 2) {
      title = rawSegments[0];
      promoPrice = parseFloat(rawSegments[1].replace('R$', '').replace(',', '.').trim()) || 29.90;
      origPrice = promoPrice * 1.35;
    } else if (rawSegments.length === 1) {
      title = rawSegments[0];
    }

    let platform = this.detectPlatform(url);

    const createdLink = models.createAffiliateLink({
      title,
      platform,
      affiliate_url: url,
      original_price: origPrice > promoPrice ? origPrice : promoPrice * 1.5,
      product_price: promoPrice,
      coupon_code: coupon,
      free_shipping: 1,
      rating: 4.9,
      category: 'Achadinhos',
      source: 'manual',
      active: 1
    });

    if (createdLink?.id) {
      setImmediate(async () => {
        try {
          const linkPreviewService = require('./linkPreviewService');
          await linkPreviewService.populateAffiliateLinkImage(createdLink.id);
        } catch (_) {}
      });
    }

    return createdLink;
  }

  /**
   * 17. Suporte Cognitivo a Dúvidas no Grupo / PV
   */
  async handleBuyerGroupQuery({
    sock,
    from,
    text = '',
    senderPhone = '',
    isGroup = false,
    senderName = 'Cliente'
  } = {}) {
    if (!text || !isGroup || !from || !from.endsWith('@g.us')) return false;
    const subbotPrivateFilter = require('./subbotPrivateFilterService');
    if (senderPhone && subbotPrivateFilter.isFleetBotNumber(senderPhone)) return false;
    const lower = text.toLowerCase();
    const activeSock = sock || this.getDispatchSocket();

    const faqReply = this.getBuyerFaqResponse(text);
    if (faqReply) {
      await activeSock.sendMessage(from, { text: faqReply });
      return true;
    }

    const searchMatch = lower.match(/(?:tem|onde\s+compro|onde\s+acho|voc[eê]s\s+t[eê]m|algu[eé]m\s+tem|link\s+(?:de|do|da)?|procura-se|busco|querendo\s+comprar)\s+([a-zA-Z0-9\s]{3,35})/i);
    if (searchMatch && searchMatch[1]) {
      const term = searchMatch[1].replace(/(?:promo[çc][aã]o|barato|barata|bom|boa|link)\b/gi, '').trim();
      if (term.length >= 3) {
        const reply = this.searchDealsForBuyer(term);
        await activeSock.sendMessage(from, { text: reply });
        return true;
      }
    }

    return false;
  }

  /**
   * 18. POSTAGEM DIRETA DE OFERTA PRONTA DE AFILIADO EM UM GRUPO ESPECÍFICO
   */
  async postDealToSpecificGroup(targetJid, queryOrId = null, { sock = null, mention_all = false } = {}) {
    if (!targetJid || !targetJid.endsWith('@g.us')) {
      throw new Error('A divulgação de links de afiliados prontos é permitida SOMENTE dentro de grupos!');
    }

    let deal = null;

    if (queryOrId && String(queryOrId).trim()) {
      const q = String(queryOrId).trim();
      if (/^\d+$/.test(q)) {
        deal = models.getAffiliateLinkById(Number(q));
      }
      if (!deal) {
        const matches = models.searchDeals(q, { limit: 5 });
        if (matches && matches.length > 0) {
          deal = matches[0];
        }
      }
      if (!deal) {
        throw new Error(`Nenhuma oferta de afiliado pronta encontrada para "${queryOrId}".`);
      }
    } else {
      // Pega ofertas prontas ativas com links legítimos
      const deals = (models.getActiveDeals({ limit: 150 }) || []).filter(d => d.active !== 0 && !this.isDummyAffiliateUrl(d.affiliate_url));
      if (!deals || deals.length === 0) {
        throw new Error('Nenhuma oferta de afiliado pronta ativa encontrada no catálogo.');
      }

      if (!this.groupPostedIndices) this.groupPostedIndices = new Map();
      let lastIdx = this.groupPostedIndices.get(targetJid) || 0;
      deal = deals[lastIdx % deals.length];
      this.groupPostedIndices.set(targetJid, (lastIdx + 1) % deals.length);
    }

    let channel = models.getAchadinhosChannelByJid(targetJid);
    if (!channel) {
      channel = {
        id: 0,
        name: 'Grupo WhatsApp',
        target_jid: targetJid,
        channel_type: 'group',
        template_style: 'fire_sale',
        auto_post_new_links: 1,
        active: 1
      };
    }

    const postResult = await this.postToChannel(channel, deal, {
      mention_all,
      is_manual: true,
      isManual: true,
      sock
    });

    if (postResult && !postResult.success) {
      throw new Error(postResult.error || 'Falha ao postar oferta no canal');
    }

    return {
      success: postResult ? postResult.success : true,
      deal,
      postResult
    };
  }

  /**
   * 19. COMANDO OFICIAL DE DIVULGAÇÃO DE LINKS DE AFILIADOS EM GRUPOS (!DUVUG / !DIVULG)
   * Regra do Usuário: A função de divulgar links de afiliados prontos é permitida SOMENTE
   * nos grupos onde o comando !duvug for acionado. NUNCA no chat privado.
   */
  async handleDuvugCommand({
    sock,
    from,
    text = '',
    isGroup = false,
    senderPhone = '',
    isOwnerUser = false,
    isChatAdmin = false,
    participantJid = ''
  } = {}) {
    const activeSock = sock || this.getDispatchSocket();
    if (!activeSock) return false;

    // 1. Se foi enviado no CHAT PRIVADO: BLOQUEIA E ORIENTA O USUÁRIO
    if (!isGroup || !from.endsWith('@g.us')) {
      const privateNotice =
        `⚠️ *Comando Exclusivo para Grupos de WhatsApp!*\n\n` +
        `A função de divulgar links de afiliados prontos funciona *exclusivamente dentro de grupos* onde você autorizar.\n\n` +
        `👉 Para divulgar produtos com seu link de afiliado, acesse o grupo desejado e envie:\n\n` +
        `• *!duvug* ➔ Posta uma oferta pronta com link e foto no grupo agora\n` +
        `• *!duvug <produto ou ID>* ➔ Posta um item específico (ex: \`!duvug alexa\` ou \`!duvug 1907\`)\n` +
        `• *!duvug auto [minutos]* ➔ Ativa divulgação automática periódica no grupo (ex: \`!duvug auto 30\`)\n` +
        `• *!duvug off* ➔ Desativa a divulgação automática no grupo\n` +
        `• *!duvug status* ➔ Mostra o status do grupo e ofertas disponíveis`;

      return activeSock.sendMessage(from, { text: privateNotice });
    }

    // 2. Permissão no Grupo: Apenas Dono ou Administradores do Grupo
    if (!isOwnerUser && !isChatAdmin) {
      return activeSock.sendMessage(from, {
        text: `❌ *Acesso Restrito: Administradores do Grupo*\n\nApenas administradores do grupo ou o Dono do Bot podem acionar a divulgação de links de afiliados com o comando *!duvug*.`
      });
    }

    const rawArgs = text.replace(/^(?:!|\/)(?:duvug|duvuga|duvulgar|divulg|divulga|divulgar)\s*/i, '').trim();
    const sub = rawArgs.toLowerCase();

    // 3. Subcomando: DESATIVAR DIVULGAÇÃO NO GRUPO (!duvug off / parar)
    if (sub === 'off' || sub === 'parar' || sub === 'desativar' || sub === 'pause') {
      const existing = models.getAchadinhosChannelByJid(from);
      if (existing) {
        models.saveAchadinhosChannel({
          id: existing.id,
          name: existing.name || 'Grupo Divulgação',
          target_jid: from,
          active: 0,
          auto_post_new_links: 0
        });
      }
      return activeSock.sendMessage(from, {
        text: `🔴 *Divulgação de Afiliados DESATIVADA neste Grupo!* 🛍️\n\nEste grupo não receberá mais postagens automáticas de links de afiliados.\nPara reativar a qualquer momento, envie: \`!duvug on\``
      });
    }

    // 4. Subcomando: ATIVAR DIVULGAÇÃO AUTOMÁTICA PROGRAMADA NO GRUPO (!duvug auto [minutos] / !duvug on [minutos])
    if (sub.startsWith('auto') || sub.startsWith('on') || sub.startsWith('ativar')) {
      const intervalMatch = rawArgs.match(/\d+/);
      const interval = intervalMatch ? Math.max(1, parseInt(intervalMatch[0], 10)) : 30;

      let existing = models.getAchadinhosChannelByJid(from);
      if (existing) {
        models.saveAchadinhosChannel({
          id: existing.id,
          name: existing.name || 'Grupo Divulgação',
          target_jid: from,
          channel_type: 'group',
          template_style: existing.template_style || 'fire_sale',
          auto_post_new_links: 1,
          active: 1
        });
      } else {
        models.saveAchadinhosChannel({
          name: 'Grupo Divulgação',
          target_jid: from,
          channel_type: 'group',
          template_style: 'fire_sale',
          auto_post_new_links: 1,
          active: 1
        });
      }

      this.startAutoFeed(interval);

      return activeSock.sendMessage(from, {
        text: `🟢 *Divulgação de Afiliados ATIVADA neste Grupo!* 🛍️\n\n` +
          `Novas ofertas prontas com seu link de afiliado oficial serão postadas automaticamente aqui a cada *${interval} minutos*.\n\n` +
          `• Para postar uma oferta avulsa agora: \`!duvug\`\n` +
          `• Para pausar neste grupo: \`!duvug off\`\n` +
          `• Para consultar status: \`!duvug status\``
      });
    }

    // 5. Subcomando: STATUS DO GRUPO (!duvug status / lista)
    if (sub === 'status' || sub === 'lista' || sub === 'info') {
      const channel = models.getAchadinhosChannelByJid(from);
      const isChannelActive = channel && channel.active === 1;
      const totalDeals = (models.getActiveDeals({ limit: 5000 }) || []).length;
      const db = require('../db/database');
      const postsToday = db.prepare("SELECT COUNT(*) as count FROM achadinhos_posts_log WHERE target_jid = ? AND DATE(posted_at) = DATE('now')").get(from)?.count || 0;
      const intervalMin = models.getSetting('ACHADINHOS_FEED_INTERVAL_MIN', '30');

      return activeSock.sendMessage(from, {
        text: `📊 *STATUS DA DIVULGAÇÃO DE AFILIADOS [ESTE GRUPO]* 🛍️\n\n` +
          `• *Status no Grupo:* ${isChannelActive ? '🟢 ATIVO (Postagens Automáticas)' : '⚪ AVULSO (Apenas manual via !duvug)'}\n` +
          `• *Intervalo Automático:* ${intervalMin} minutos\n` +
          `• *Ofertas Prontas Disponíveis:* *${totalDeals} produtos*\n` +
          `• *Postagens Hoje neste Grupo:* *${postsToday}*\n\n` +
          `👉 *Comandos Rápidos:*\n` +
          `• \`!duvug\` ➔ Divulga 1 oferta pronta agora no grupo\n` +
          `• \`!duvug <termo>\` ➔ Divulga produto específico (ex: \`!duvug alexa\`)\n` +
          `• \`!duvug on 30\` ➔ Ativa divulgação automática a cada 30 min\n` +
          `• \`!duvug off\` ➔ Pausa divulgação automática neste grupo`
      });
    }

    // 6. Subcomando: AJUDA (!duvug ajuda / help)
    if (sub === 'ajuda' || sub === 'help') {
      return activeSock.sendMessage(from, {
        text: `🛍️ *CENTRAL DE DIVULGAÇÃO DE AFILIADOS EM GRUPOS (!DUVUG)* 📢\n\n` +
          `Comando exclusivo para divulgar ofertas e produtos prontos de afiliados diretamente neste grupo.\n\n` +
          `📌 *Como Usar:*\n` +
          `• *!duvug* ➔ Posta a próxima melhor oferta pronta com imagem e link seguro\n` +
          `• *!duvug <produto ou ID>* ➔ Busca e posta oferta específica (ex: \`!duvug alexa\` ou \`!duvug 1907\`)\n` +
          `• *!duvug auto [minutos]* ➔ Ativa postagens periódicas automáticas no grupo\n` +
          `• *!duvug off* ➔ Desativa postagens automáticas no grupo\n` +
          `• *!duvug status* ➔ Mostra status do grupo e estoque de ofertas`
      });
    }

    // 7. POSTAGEM IMEDIATA NO GRUPO (!duvug ou !duvug <termo ou ID>)
    try {
      const searchTerm = (sub === 'agora' || sub === 'post' || sub === 'enviar') ? null : rawArgs;
      await this.postDealToSpecificGroup(from, searchTerm, { sock: activeSock });
      return true;
    } catch (err) {
      return activeSock.sendMessage(from, {
        text: `❌ *Erro ao divulgar oferta:* ${err.message}`
      });
    }
  }
}

module.exports = new AchadinhosService();

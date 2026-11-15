const crypto = require('crypto');
const models = require('../db/models');

/**
 * Catálogo Oficial de Plataformas Omni-Channel Suportadas
 * (Redes Sociais, Marketplaces, E-commerce e Comunidades)
 */
const SUPPORTED_PLATFORMS = {
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    icon: 'fa-brands fa-instagram',
    color: '#e1306c',
    commentLabel: 'Comentário em Post / Reels',
    dmLabel: 'Direct Privado (DM)',
    idPlaceholder: 'Ex: 17841400000000001 (Instagram Business ID)'
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook Pages',
    category: 'social',
    icon: 'fa-brands fa-facebook',
    color: '#1877f2',
    commentLabel: 'Comentário na Página / Post',
    dmLabel: 'Messenger Privado',
    idPlaceholder: 'Ex: 109876543210987 (Facebook Page ID)'
  },
  threads: {
    id: 'threads',
    name: 'Threads',
    category: 'social',
    icon: 'fa-brands fa-threads',
    color: '#000000',
    commentLabel: 'Resposta em Thread',
    dmLabel: 'Direct Privado Threads',
    idPlaceholder: 'Ex: threads_user_id (Meta Threads ID)'
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    category: 'social',
    icon: 'fa-brands fa-x-twitter',
    color: '#000000',
    commentLabel: 'Tweet / Resposta Pública',
    dmLabel: 'Mensagem Direta (DM)',
    idPlaceholder: 'Ex: @handle ou Twitter User ID'
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    category: 'social',
    icon: 'fa-brands fa-tiktok',
    color: '#00f2fe',
    commentLabel: 'Comentário em Vídeo',
    dmLabel: 'Chat Direto TikTok',
    idPlaceholder: 'Ex: @perfil ou TikTok Open ID'
  },
  snapchat: {
    id: 'snapchat',
    name: 'Snapchat',
    category: 'social',
    icon: 'fa-brands fa-snapchat',
    color: '#fffc00',
    commentLabel: 'Interação de Story / Snap',
    dmLabel: 'Chat Privado Snap',
    idPlaceholder: 'Ex: snap_account_id'
  },
  mercadolivre: {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    category: 'marketplace',
    icon: 'fa-solid fa-handshake',
    color: '#ffe600',
    commentLabel: 'Pergunta no Anúncio',
    dmLabel: 'Chat Pós-Venda / Mensagens',
    idPlaceholder: 'Ex: MLB123456789 ou Seller User ID'
  },
  shopee: {
    id: 'shopee',
    name: 'Shopee',
    category: 'marketplace',
    icon: 'fa-solid fa-bag-shopping',
    color: '#ee4d2d',
    commentLabel: 'Pergunta no Produto',
    dmLabel: 'Chat Oficial do Vendedor',
    idPlaceholder: 'Ex: shop_id (Shopee Partner ID)'
  },
  olx: {
    id: 'olx',
    name: 'OLX',
    category: 'marketplace',
    icon: 'fa-solid fa-tag',
    color: '#6e0ad6',
    commentLabel: 'Pergunta no Anúncio',
    dmLabel: 'Chat da OLX',
    idPlaceholder: 'Ex: user_account_olx_id'
  },
  marketplace_facebook: {
    id: 'marketplace_facebook',
    name: 'Marketplace Facebook',
    category: 'marketplace',
    icon: 'fa-solid fa-store',
    color: '#0084ff',
    commentLabel: 'Interesse no Anúncio',
    dmLabel: 'Chat de Compra (Messenger)',
    idPlaceholder: 'Ex: listing_id ou Seller Page ID'
  },
  shein: {
    id: 'shein',
    name: 'Shein Marketplace',
    category: 'marketplace',
    icon: 'fa-solid fa-shirt',
    color: '#222222',
    commentLabel: 'Dúvida de Produto / Medidas',
    dmLabel: 'Chat de Atendimento Shein',
    idPlaceholder: 'Ex: shein_supplier_id'
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    category: 'community',
    icon: 'fa-brands fa-reddit',
    color: '#ff4500',
    commentLabel: 'Comentário em Subreddit',
    dmLabel: 'Mensagem Privada (PM)',
    idPlaceholder: 'Ex: u/username ou subreddit'
  },
  blog: {
    id: 'blog',
    name: 'Blog / Webhook',
    category: 'community',
    icon: 'fa-solid fa-blog',
    color: '#21759b',
    commentLabel: 'Comentário no Artigo',
    dmLabel: 'Email / Contato do Autor',
    idPlaceholder: 'Ex: blog_id ou URL do site'
  }
};

class SocialMediaService {
  constructor() {
    this.defaultVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'paybot_meta_token_2026';
    this._simModeOverride = undefined;
  }

  get isSimulationMode() {
    if (this._simModeOverride !== undefined) return this._simModeOverride;
    const envMode = typeof models.getEnvironmentMode === 'function' ? models.getEnvironmentMode() : models.getSetting('ENVIRONMENT_MODE', 'sandbox');
    if (envMode === 'production') return false;
    return models.getSetting('PIX_SIMULATION_MODE', 'true') === 'true';
  }

  set isSimulationMode(val) {
    this._simModeOverride = val;
  }

  getSupportedPlatforms() {
    return Object.values(SUPPORTED_PLATFORMS);
  }

  getPlatformMeta(platform) {
    const key = (platform || '').toLowerCase().trim();
    return SUPPORTED_PLATFORMS[key] || {
      id: key || 'social',
      name: key ? key.toUpperCase() : 'Social Network',
      category: 'social',
      icon: 'fa-solid fa-share-nodes',
      color: '#38bdf8',
      commentLabel: 'Comentário',
      dmLabel: 'Mensagem Direta',
      idPlaceholder: 'ID da conta'
    };
  }

  // ==============================================================
  // 1. PROCESSAMENTO DE MENSAGENS DIRETAS RECEBIDAS (OMNI-CHANNEL)
  // ==============================================================
  async handleIncomingMessage({ platform = 'instagram', accountId, senderId, senderName = 'Cliente Social', text, metadata = {} }) {
    if (!text || !senderId) return null;

    const plat = platform.toLowerCase();
    const cleanText = text.trim();
    console.log(`[Social Direct 📩 ${plat.toUpperCase()}] Mensagem recebida de ${senderName} (${senderId}) na conta ID ${accountId}: "${cleanText}"`);

    // Busca conta vinculada
    let account = null;
    if (accountId) {
      account = models.getSocialAccountByAccountId(accountId) || models.getSocialAccountById(accountId);
    }
    if (!account) {
      const allAccounts = models.getSocialAccounts({ platform: plat });
      account = allAccounts.find(a => a.status === 'CONNECTED') || allAccounts[0];
    }

    const socialAccountId = account ? account.id : null;

    // Registra mensagem recebida
    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform: plat,
      sender_id: senderId,
      sender_name: senderName,
      message_text: cleanText,
      direction: 'IN',
      stage: 'ENGAGED'
    });

    if (socialAccountId) {
      models.incrementSocialAccountCounters(socialAccountId, { received: 1 });
    }

    // Se auto-resposta estiver desabilitada na conta
    if (account && account.auto_reply_enabled === 0) {
      return { handled: true, replied: false, reason: 'auto_reply_disabled' };
    }

    // Processa intenção e gera resposta pelo motor de conversão
    const replyText = await this.generateConversationalReply(cleanText, senderName, plat);

    // Envia resposta (API oficial ou Simulação)
    const sent = await this.sendMessage({
      platform: plat,
      account,
      recipientId: senderId,
      text: replyText
    });

    // Registra mensagem enviada
    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform: plat,
      sender_id: senderId,
      sender_name: senderName,
      message_text: replyText,
      direction: 'OUT',
      stage: 'REPLIED'
    });

    if (socialAccountId) {
      models.incrementSocialAccountCounters(socialAccountId, { sent: 1 });
    }

    return {
      handled: true,
      platform: plat,
      replied: true,
      replyText,
      sent
    };
  }

  // ==============================================================
  // 2. MOTOR CONVERSACIONAL COM INTELIGÊNCIA POR PLATAFORMA (NLU)
  // ==============================================================
  async generateConversationalReply(text, senderName, platform = 'instagram') {
    const rawName = (senderName || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente|user)/i.test(rawName);
    const name = isGeneric ? '' : rawName.replace(/^[@u\/]+/, '').split(' ')[0];
    const plat = (platform || '').toLowerCase();

    let nlp = null;
    try {
      const nlpService = require('./nlpService');
      nlp = await nlpService.processMessage({ text, customerName: senderName, platform: 'social' });
    } catch (_) {}

    // Busca link de afiliado ou produto padrão (prioriza sempre o túnel ativo se não houver link configurado)
    const tunnelService = require('./tunnelService');
    const tunnelBase = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
    const defaultVipLink = `${tunnelBase.replace(/\/+$/, '')}/l/vip`;
    const links = models.getAffiliateLinks();
    const defaultLink = links.length > 0 ? links[0] : null;
    const linkUrl = (defaultLink && defaultLink.affiliate_url && !defaultLink.affiliate_url.includes('paybot.app')) ? defaultLink.affiliate_url : defaultVipLink;
    const productName = defaultLink ? defaultLink.title : 'nosso Produto VIP';

    // 1. Respostas específicas para Marketplaces
    if (plat === 'mercadolivre') {
      if (nlp && (nlp.intent === 'BUY_INTENT' || nlp.intent === 'PRICE_QUERY' || nlp.intent === 'PAYMENT_PIX')) {
        return `Olá ${name || 'amigo(a)'}! Temos o *${productName}* à pronta entrega com envio imediato via Mercado Envios Full e garantia total. Aproveite a condição especial de hoje pelo link oficial: ${linkUrl}`;
      }
      return `Olá ${name || 'amigo(a)'}! Agradecemos o contato em nossa loja no Mercado Livre! O *${productName}* é 100% original, novo, com nota fiscal e garantia incondicional. Link oficial: ${linkUrl}`;
    }

    if (plat === 'shopee') {
      return `Olá ${name || 'amigo(a)'}! 🥰 Bem-vindo(a) à nossa loja oficial na Shopee! O *${productName}* está disponível com cupom de desconto e frete grátis liberado hoje: 👉 ${linkUrl}`;
    }

    if (plat === 'olx') {
      return `Olá ${name || 'amigo(a)'}! Ainda está disponível sim! Se quiser fechar com envio seguro e garantia ou Pix com desconto: 👉 ${linkUrl}`;
    }

    if (plat === 'marketplace_facebook') {
      return `Olá ${name || 'amigo(a)'}! Está disponível sim! Podemos combinar a retirada ou entrega imediata. Para garantir o valor promocional com segurança: 👉 ${linkUrl}`;
    }

    if (plat === 'shein') {
      return `Olá ${name || 'amigo(a)'}! Esse item é de altíssima qualidade e temos pronta entrega. Confira todos os detalhes e garanta seu cupom exclusivo aqui: 👉 ${linkUrl}`;
    }

    if (plat === 'reddit') {
      return `Fala u/${rawName.replace(/^u\//i, '') || 'amigo'}! Sobre isso, recomendo dar uma olhada no *${productName}*, funcionou perfeitamente para essa mesma necessidade. Você pode ver todos os detalhes aqui: ${linkUrl}`;
    }

    if (plat === 'blog') {
      return `Olá ${name || 'Leitor'}! Muito obrigado pelo comentário no artigo! Preparamos um material complementar exclusivo sobre o *${productName}* que você pode acessar aqui: ${linkUrl}`;
    }

    // 2. Respostas para Redes Sociais com NLP Inteligente
    if (nlp) {
      if (nlp.intent === 'CONFIRM_PURCHASE') {
        return `Sensacional, ${name}! Parabéns pela sua decisão! 🚀 Seu acesso está liberado. Se precisar de qualquer suporte, nossa equipe está pronta para te ajudar!`;
      }
      if (nlp.intent === 'TRUST_AND_GUARANTEE') {
        return `Pode ficar 100% seguro(a), ${name}! 🛡️ Nossa entrega é imediata e você conta com garantia incondicional de 7 dias com reembolso total sem burocracia. O link oficial é: ${linkUrl}`;
      }
      if (nlp.intent === 'BUY_INTENT' || nlp.intent === 'PAYMENT_PIX' || nlp.intent === 'PAYMENT_CRYPTO' || nlp.intent === 'PRICE_QUERY') {
        return `Olá ${name}! 🎉 Tudo bem?\n\nLiberamos uma condição especial com 50% de desconto hoje para o *${productName}*!\n\nAcesse todos os detalhes e garanta seu acesso aqui:\n👉 ${linkUrl}\n\nQualquer dúvida sobre a ativação, pode me chamar por aqui!`;
      }
      if (nlp.intent === 'DISCOUNT_QUERY') {
        return `Olá ${name}! 🎁 Temos uma condição promocional exclusiva ativada hoje para o *${productName}*! Acesse o link oficial para garantir seu desconto:\n👉 ${linkUrl}`;
      }
      if (nlp.intent === 'GREETING') {
        return `Olá ${name}! Que bom ter você por aqui no nosso canal oficial! 😊\n\nVocê já conhece o *${productName}* ou gostaria de saber como ele funciona na prática para acelerar seus resultados?`;
      }
    }

    return `Olá ${name}! Obrigado por entrar em contato! Como posso te ajudar hoje com relação ao *${productName}*? Se quiser ver a página oficial com a condição exclusiva, o link é: ${linkUrl}`;
  }

  // ==============================================================
  // 3. RESPOSTA PÚBLICA AO COMENTÁRIO / PERGUNTA (POSTS & ANÚNCIOS)
  // ==============================================================
  generateCommentPublicReply(text, senderName, platform = 'instagram') {
    const rawName = (senderName || '').trim();
    const cleanHandle = rawName.startsWith('@') ? rawName : `@${rawName}`;
    const cleanUser = rawName && !/^(cliente|lead|amigo|usuário|user)/i.test(rawName) ? rawName : 'amigo(a)';
    const targetTag = rawName && !/^(cliente|lead|amigo|usuário|user)/i.test(rawName) ? cleanHandle : 'amigo(a)';
    const plat = (platform || '').toLowerCase();

    switch (plat) {
      case 'mercadolivre':
        return `Olá ${cleanUser}! Sim, temos produto 100% novo, original com garantia e envio imediato Full! Emitimos nota fiscal eletrônica. Aproveite o preço promocional garantindo agora!`;

      case 'shopee':
        return `Olá ${cleanUser}! 🥰 Obrigado pelo interesse! Temos à pronta entrega com envio rápido e cupom de frete grátis liberado na loja. Aproveite! ✨`;

      case 'olx':
        return `Olá! Ainda está disponível sim! Produto em perfeito estado com envio seguro ou entrega facilitada. Confira as fotos e aproveite a condição!`;

      case 'marketplace_facebook':
        return `Olá! Está disponível sim! Posso enviar hoje mesmo ou podemos combinar a retirada. Se quiser fechar agora com Pix e desconto, me avise!`;

      case 'shein':
        return `Olá ${cleanUser}! Peça de altíssima qualidade com envio rápido e garantia de satisfação. Qualquer dúvida sobre medidas estamos à disposição!`;

      case 'tiktok':
        return `Fala ${targetTag}! 🔥 Corre no link da nossa bio ou no direct que liberamos o cupom exclusivo do vídeo! 🚀 Aproveita!`;

      case 'x':
      case 'twitter':
        return `Fala ${targetTag}! Te mandei uma DM agora com o link oficial e desconto exclusivo! Confere lá 🚀`;

      case 'threads':
        return `Opa ${targetTag}! Já te mandei todos os detalhes e o acesso no privado! Confere lá ✨`;

      case 'reddit':
        return `Fala u/${rawName.replace(/^u\//i, '')}! Valeu pelo comentário! Se quiser conferir a solução completa testada e aprovada, compartilhei os detalhes no privado.`;

      case 'blog':
        return `Olá ${cleanUser}! Muito obrigado pelo comentário e contribuição no artigo! Te enviamos um conteúdo complementar exclusivo no contato.`;

      case 'snapchat':
        return `Hey ${cleanUser}! Mandei os detalhes e o desconto especial direto no chat do Snap! Dá uma olhada 👻🔥`;

      case 'facebook':
        return `Olá ${cleanUser}! Que excelente pergunta! Acabamos de te enviar uma mensagem no privado com todas as informações e o link com desconto! Dá uma olhada no seu Messenger! 🚀`;

      case 'instagram':
      default:
        const variations = [
          `Olá ${targetTag}! 🎉 Te mandei uma mensagem no seu Direct com todos os detalhes e uma condição exclusiva! Dá uma olhada lá na sua caixa de mensagens 🚀`,
          `${targetTag} Que excelente pergunta! 🚀 Acabei de te enviar no privado todas as informações completas. Confere seu Direct! ✨`,
          `Opa ${targetTag}! Já te respondi por mensagem privada com o link oficial e a surpresa especial! 🎁 Dá uma olhada lá!`,
          `Olá ${targetTag}! Verifique seu Direct 📩, acabamos de te enviar todos os detalhes e o acesso com desconto exclusivo!`
        ];
        return variations[Math.floor(Math.random() * variations.length)];
    }
  }

  // ==============================================================
  // 4. DISPARO DE RESPOSTA PÚBLICA (API OFICIAL OU SIMULAÇÃO)
  // ==============================================================
  async replyToComment({ platform, account, commentId, text }) {
    const plat = (platform || 'instagram').toLowerCase();
    const token = account?.access_token;

    if (token && !this.isSimulationMode) {
      try {
        if (plat === 'instagram') {
          await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, access_token: token }),
            signal: AbortSignal.timeout(8000)
          });
        } else if (plat === 'facebook' || plat === 'marketplace_facebook') {
          await fetch(`https://graph.facebook.com/v19.0/${commentId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, access_token: token }),
            signal: AbortSignal.timeout(8000)
          });
        } else if (plat === 'mercadolivre') {
          await fetch(`https://api.mercadolibre.com/answers?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question_id: commentId, text }),
            signal: AbortSignal.timeout(8000)
          });
        } else if (plat === 'x' || plat === 'twitter') {
          await fetch(`https://api.twitter.com/2/tweets`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: commentId } }),
            signal: AbortSignal.timeout(8000)
          });
        }
        console.log(`[Social Comment ✅ ${plat.toUpperCase()}] Resposta pública enviada para ${commentId}.`);
        return { success: true, commentId };
      } catch (err) {
        console.error(`[Social Comment ❌ ${plat.toUpperCase()} API Error]:`, err.message);
      }
    }

    console.log(`[Social Comment 🟢 SIMULAÇÃO ${plat.toUpperCase()}] Resposta pública ao item ${commentId}: "${text}"`);
    return { success: true, simulated: true, commentId };
  }

  // ==============================================================
  // 5. DISPARO DE MENSAGEM PRIVADA VIA COMENTÁRIO (PRIVATE REPLY)
  // ==============================================================
  async sendPrivateReply({ platform, account, commentId, recipientId, text }) {
    const plat = (platform || 'instagram').toLowerCase();
    const token = account?.access_token;

    if (token && !this.isSimulationMode) {
      try {
        if (plat === 'instagram' || plat === 'facebook' || plat === 'threads' || plat === 'marketplace_facebook') {
          const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`;
          const payload = {
            recipient: commentId ? { comment_id: commentId } : { id: recipientId },
            message: { text }
          };
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000)
          });
        }
        console.log(`[Social Private Reply ✅ ${plat.toUpperCase()}] Direct privado enviado referente ao comentário ${commentId}.`);
        return { success: true, commentId };
      } catch (err) {
        console.error(`[Social Private Reply ❌ ${plat.toUpperCase()} API Error]:`, err.message);
      }
    }

    console.log(`[Social Private Reply 🟢 SIMULAÇÃO ${plat.toUpperCase()}] DM enviada referente ao comentário ${commentId}: "${text.substring(0, 70)}..."`);
    return { success: true, simulated: true };
  }

  // ==============================================================
  // 6. PROCESSAMENTO DE COMENTÁRIOS / PERGUNTAS RECEBIDAS
  // ==============================================================
  async handleIncomingComment({ platform = 'instagram', accountId, senderId, senderName = 'Cliente Social', text, commentId, mediaId = null, postId = null, parentId = null, metadata = {} }) {
    if (!text || !commentId) return null;

    const plat = platform.toLowerCase();
    const cleanText = text.trim();
    console.log(`[Social Comment 💬 ${plat.toUpperCase()}] Novo comentário/pergunta de ${senderName} (${senderId}) no item ${commentId}: "${cleanText}"`);

    // Busca conta vinculada
    let account = null;
    if (accountId) {
      account = models.getSocialAccountByAccountId(accountId) || models.getSocialAccountById(accountId);
    }
    if (!account) {
      const allAccounts = models.getSocialAccounts({ platform: plat });
      account = allAccounts.find(a => a.status === 'CONNECTED') || allAccounts[0];
    }

    // Evita loopback caso o comentário seja da própria conta
    if (account) {
      if (senderId && (senderId === account.account_id || senderId === String(account.id))) {
        return { handled: false, reason: 'self_comment' };
      }
      if (senderName && senderName.replace(/^[@u\/]+/, '').toLowerCase() === account.name.replace(/^[@u\/]+/, '').toLowerCase()) {
        return { handled: false, reason: 'self_comment' };
      }
    }

    const socialAccountId = account ? account.id : null;

    // Registra comentário recebido no histórico
    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform: plat,
      sender_id: senderId,
      sender_name: senderName,
      message_text: `[Item ${mediaId || postId || commentId}] ${cleanText}`,
      direction: 'IN',
      stage: 'COMMENT_RECEIVED'
    });

    if (socialAccountId) {
      models.incrementSocialAccountCounters(socialAccountId, { received: 1 });
    }

    // Se auto-resposta estiver desabilitada na conta
    if (account && account.auto_reply_enabled === 0) {
      return { handled: true, replied: false, reason: 'auto_reply_disabled' };
    }

    // 1. Gera e envia resposta pública
    const publicReplyText = this.generateCommentPublicReply(cleanText, senderName, plat);
    const publicReplyResult = await this.replyToComment({
      platform: plat,
      account,
      commentId,
      text: publicReplyText
    });

    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform: plat,
      sender_id: senderId,
      sender_name: senderName,
      message_text: `[Resposta Pública ${commentId}] ${publicReplyText}`,
      direction: 'OUT',
      stage: 'COMMENT_PUBLIC_REPLY'
    });

    if (socialAccountId) {
      models.incrementSocialAccountCounters(socialAccountId, { sent: 1 });
    }

    // 2. Gera e envia mensagem privada no Direct (se suportado na plataforma)
    const privateDmText = await this.generateConversationalReply(cleanText, senderName, plat);
    const privateDmResult = await this.sendPrivateReply({
      platform: plat,
      account,
      commentId,
      recipientId: senderId,
      text: privateDmText
    });

    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform: plat,
      sender_id: senderId,
      sender_name: senderName,
      message_text: `[Direct Privado via Comentário] ${privateDmText}`,
      direction: 'OUT',
      stage: 'COMMENT_PRIVATE_DM'
    });

    if (socialAccountId) {
      models.incrementSocialAccountCounters(socialAccountId, { sent: 1 });
    }

    return {
      handled: true,
      platform: plat,
      commentId,
      senderName,
      publicReplyText,
      publicReplyResult,
      privateDmText,
      privateDmResult
    };
  }

  // ==============================================================
  // 7. ENVIO DE MENSAGENS DIRETAS (API OFICIAL OU SIMULAÇÃO)
  // ==============================================================
  async sendMessage({ platform = 'instagram', account, recipientId, text }) {
    const plat = platform.toLowerCase();
    const token = account?.access_token;

    if (token && !this.isSimulationMode) {
      try {
        if (plat === 'instagram' || plat === 'facebook' || plat === 'threads' || plat === 'marketplace_facebook') {
          const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`;
          const payload = {
            recipient: { id: recipientId },
            message: { text }
          };
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000)
          });
          const resData = await response.json();
          console.log(`[Social Direct ✅ ${plat.toUpperCase()}] Resposta enviada via Graph API para ${recipientId}.`);
          return { success: true, messageId: resData?.message_id };
        }
      } catch (err) {
        console.error(`[Social Direct ❌ ${plat.toUpperCase()} API Error]:`, err.message);
      }
    }

    console.log(`[Social Direct 🟢 SIMULAÇÃO ${plat.toUpperCase()}] Resposta para ${recipientId}: "${text.substring(0, 70)}..."`);
    return { success: true, simulated: true };
  }

  // ==============================================================
  // 8. VERIFICAÇÃO DE WEBHOOKS (META, TWITTER CRC, ETC.)
  // ==============================================================
  verifyWebhook(mode, token, challenge, platform = 'meta') {
    if (mode === 'subscribe') {
      const validTokens = [this.defaultVerifyToken, 'paybot_meta_token_2026'];
      const accounts = models.getSocialAccounts();
      const accountTokens = accounts.map(a => a.webhook_verify_token).filter(Boolean);
      const allTokens = [...validTokens, ...accountTokens];

      if (allTokens.includes(token)) {
        return challenge;
      }
    }
    return null;
  }

  verifyTwitterCrc(crcToken, appSecret = 'paybot_twitter_secret_2026') {
    if (!crcToken) return null;
    const hmac = crypto.createHmac('sha256', appSecret).update(crcToken).digest('base64');
    return `sha256=${hmac}`;
  }

  // ==============================================================
  // 9. INGESTÃO DE WEBHOOK DO ECOSSISTEMA META (INSTA, FACEBOOK, THREADS)
  // ==============================================================
  async processWebhookPayload(payload) {
    if (!payload || !payload.object) return { processed: 0 };

    let platform = 'instagram';
    if (payload.object === 'page') platform = 'facebook';
    else if (payload.object === 'threads') platform = 'threads';
    else if (payload.object === 'instagram') platform = 'instagram';

    const entries = payload.entry || [];
    let processed = 0;

    for (const entry of entries) {
      const accountId = entry.id;

      // Formato Messaging padrão do Messenger & Direct
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          const messageText = event.message?.text;

          if (senderId && senderId === accountId) continue;
          if (event.message?.is_echo) continue;

          if (senderId && messageText) {
            await this.handleIncomingMessage({
              platform,
              accountId,
              senderId,
              senderName: `Usuário ${platform.toUpperCase()}`,
              text: messageText
            });
            processed++;
          }
        }
      }

      // Formato Changes (Mensagens e Comentários do Instagram & Facebook)
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          // Mensagens diretas
          if (change.field === 'messages' && change.value) {
            const val = change.value;
            const senderId = val.sender?.id || val.from?.id;
            const text = val.message || val.text;
            if (senderId && text) {
              await this.handleIncomingMessage({
                platform,
                accountId,
                senderId,
                senderName: val.from?.name || val.from?.username || 'Usuário Social',
                text
              });
              processed++;
            }
          }

          // Comentários em Posts/Reels (Instagram & Threads)
          if ((change.field === 'comments' || change.field === 'live_comments' || change.field === 'replies') && change.value) {
            const val = change.value;
            const commentId = val.id;
            const senderId = val.from?.id;
            const senderName = val.from?.username || val.from?.name || `Seguidor ${platform.toUpperCase()}`;
            const text = val.text;
            const mediaId = val.media?.id;

            if (commentId && text) {
              await this.handleIncomingComment({
                platform,
                accountId,
                senderId: senderId || `${platform}_${commentId}`,
                senderName,
                text,
                commentId,
                mediaId
              });
              processed++;
            }
          }

          // Comentários em Posts da Página do Facebook / Marketplace
          if (change.field === 'feed' && change.value) {
            const val = change.value;
            const isComment = val.item === 'comment' && (!val.verb || val.verb === 'add');
            if (isComment) {
              const commentId = val.comment_id;
              const postId = val.post_id;
              const senderId = val.sender_id || val.from?.id;
              const senderName = val.sender_name || val.from?.name || 'Usuário Facebook';
              const text = val.message || val.text;

              if (commentId && text) {
                await this.handleIncomingComment({
                  platform: 'facebook',
                  accountId,
                  senderId: senderId || `fb_${commentId}`,
                  senderName,
                  text,
                  commentId,
                  postId,
                  parentId: val.parent_id
                });
                processed++;
              }
            }
          }
        }
      }
    }

    return { processed, platform };
  }

  // ==============================================================
  // 10. INGESTÃO DE WEBHOOK UNIVERSAL OMNI-CHANNEL (TODAS AS REDES)
  // ==============================================================
  async processPlatformWebhook(platform, body = {}, query = {}, headers = {}) {
    const plat = (platform || '').toLowerCase().trim();
    if (!plat) return { processed: 0, reason: 'invalid_platform' };

    let processed = 0;

    // 1. Ecossistema Meta (Instagram, Facebook, Threads, Marketplace Facebook)
    if (plat === 'instagram' || plat === 'facebook' || plat === 'threads' || plat === 'marketplace_facebook') {
      return await this.processWebhookPayload(body);
    }

    // 2. X / Twitter (Webhook Account Activity API)
    if (plat === 'x' || plat === 'twitter') {
      if (body.tweet_create_events && Array.isArray(body.tweet_create_events)) {
        for (const tweet of body.tweet_create_events) {
          const senderId = tweet.user?.id_str || tweet.user?.id;
          const senderName = tweet.user?.screen_name ? `@${tweet.user.screen_name}` : 'Usuário X';
          const text = tweet.text || tweet.full_text;
          const commentId = tweet.id_str || tweet.id;
          if (text && commentId) {
            await this.handleIncomingComment({
              platform: 'x',
              accountId: null,
              senderId: String(senderId),
              senderName,
              text,
              commentId: String(commentId)
            });
            processed++;
          }
        }
      }
      if (body.direct_message_events && Array.isArray(body.direct_message_events)) {
        for (const dm of body.direct_message_events) {
          const msgData = dm.message_create?.message_data;
          const senderId = dm.message_create?.sender_id;
          const text = msgData?.text;
          if (senderId && text) {
            await this.handleIncomingMessage({
              platform: 'x',
              accountId: null,
              senderId: String(senderId),
              senderName: 'Usuário X',
              text
            });
            processed++;
          }
        }
      }
    }

    // 3. TikTok (Vídeo Comments & Direct Messages)
    if (plat === 'tiktok') {
      const event = body.event || body.type;
      if (event === 'video.comment' || body.comment_id || (body.text && !body.is_dm)) {
        const commentId = body.comment_id || `tt_comm_${Date.now()}`;
        const senderId = body.user_id || body.from_user_id || `tt_user_${Date.now()}`;
        const senderName = body.username ? (body.username.startsWith('@') ? body.username : `@${body.username}`) : (body.nickname || 'Criador TikTok');
        const text = body.text || body.content || body.message;
        if (text) {
          await this.handleIncomingComment({
            platform: 'tiktok',
            accountId: body.account_id || null,
            senderId: String(senderId),
            senderName,
            text,
            commentId: String(commentId),
            mediaId: body.video_id || null
          });
          processed++;
        }
      } else {
        const senderId = body.sender_id || body.user_id || `tt_user_${Date.now()}`;
        const text = body.message || body.text;
        if (text) {
          await this.handleIncomingMessage({
            platform: 'tiktok',
            accountId: body.account_id || null,
            senderId: String(senderId),
            senderName: body.username || 'Seguidor TikTok',
            text
          });
          processed++;
        }
      }
    }

    // 4. Mercado Livre (Perguntas no Anúncio & Chat Pós-Venda)
    if (plat === 'mercadolivre' || plat === 'meli') {
      const topic = body.topic || (body.resource && body.resource.includes('/questions/') ? 'questions' : (body.question_id || body.question ? 'questions' : 'messages'));
      if (topic === 'questions' || body.question_id || body.question) {
        const questionId = body.question_id || body.id || (body.resource ? body.resource.split('/').pop() : `meli_q_${Date.now()}`);
        const text = body.text || body.question || 'Olá, tem à pronta entrega e nota fiscal?';
        const senderId = body.from?.id || body.buyer_id || `meli_user_${Date.now()}`;
        const senderName = body.from?.nickname || body.buyer_name || 'Comprador Mercado Livre';
        await this.handleIncomingComment({
          platform: 'mercadolivre',
          accountId: body.user_id || null,
          senderId: String(senderId),
          senderName,
          text,
          commentId: String(questionId),
          postId: body.item_id || null
        });
        processed++;
      } else {
        const senderId = body.from?.id || body.buyer_id || `meli_buyer_${Date.now()}`;
        const text = body.text || body.message || 'Olá, confirmação do pedido';
        await this.handleIncomingMessage({
          platform: 'mercadolivre',
          accountId: body.user_id || null,
          senderId: String(senderId),
          senderName: body.from?.nickname || 'Comprador Meli',
          text
        });
        processed++;
      }
    }

    // 5. Shopee (Chat do Vendedor & Perguntas no Produto)
    if (plat === 'shopee') {
      const text = body.message || body.content || body.text;
      const senderId = body.buyer_id || body.user_id || body.sender_id || `shopee_user_${Date.now()}`;
      const senderName = body.buyer_name || body.user_name || 'Cliente Shopee';
      if (body.type === 'item_question' || body.item_id) {
        await this.handleIncomingComment({
          platform: 'shopee',
          accountId: body.shop_id || null,
          senderId: String(senderId),
          senderName,
          text: text || 'Tem pronta entrega e frete grátis?',
          commentId: body.question_id || `shopee_q_${Date.now()}`,
          postId: body.item_id || null
        });
        processed++;
      } else if (text) {
        await this.handleIncomingMessage({
          platform: 'shopee',
          accountId: body.shop_id || null,
          senderId: String(senderId),
          senderName,
          text
        });
        processed++;
      }
    }

    // 6. OLX (Chat de Anúncios & Leads)
    if (plat === 'olx') {
      const text = body.message || body.text;
      const senderId = body.buyer_id || body.sender_id || `olx_user_${Date.now()}`;
      const senderName = body.buyer_name || body.user_name || 'Interessado OLX';
      if (body.ad_id || body.is_question) {
        await this.handleIncomingComment({
          platform: 'olx',
          accountId: body.seller_id || null,
          senderId: String(senderId),
          senderName,
          text: text || 'Ainda está disponível? Faz por menos?',
          commentId: body.inquiry_id || `olx_inq_${Date.now()}`,
          postId: body.ad_id || null
        });
        processed++;
      } else if (text) {
        await this.handleIncomingMessage({
          platform: 'olx',
          accountId: body.seller_id || null,
          senderId: String(senderId),
          senderName,
          text
        });
        processed++;
      }
    }

    // 7. Shein (Marketplace & Atendimento)
    if (plat === 'shein') {
      const text = body.message || body.text;
      const senderId = body.customer_id || body.user_id || `shein_cust_${Date.now()}`;
      const senderName = body.customer_name || 'Cliente Shein';
      if (body.item_id || body.is_question) {
        await this.handleIncomingComment({
          platform: 'shein',
          accountId: body.supplier_id || null,
          senderId: String(senderId),
          senderName,
          text: text || 'Qual o tamanho recomendado?',
          commentId: body.inquiry_id || `shein_q_${Date.now()}`,
          postId: body.item_id || null
        });
        processed++;
      } else if (text) {
        await this.handleIncomingMessage({
          platform: 'shein',
          accountId: body.supplier_id || null,
          senderId: String(senderId),
          senderName,
          text
        });
        processed++;
      }
    }

    // 8. Reddit (Subreddits & PMs)
    if (plat === 'reddit') {
      const text = body.body || body.text || body.message;
      const senderId = body.author || body.user || `redditor_${Date.now()}`;
      const senderName = String(senderId).startsWith('u/') ? senderId : `u/${senderId}`;
      if (body.kind === 'comment' || body.post_id || body.thing_id) {
        await this.handleIncomingComment({
          platform: 'reddit',
          accountId: body.subreddit || null,
          senderId: String(senderId),
          senderName,
          text: text || 'Qual a melhor recomendação para isso?',
          commentId: body.thing_id || body.id || `t1_${Date.now()}`,
          postId: body.post_id || body.link_id || null
        });
        processed++;
      } else if (text) {
        await this.handleIncomingMessage({
          platform: 'reddit',
          accountId: null,
          senderId: String(senderId),
          senderName,
          text
        });
        processed++;
      }
    }

    // 9. Blog (WordPress / Webhooks)
    if (plat === 'blog') {
      const text = body.comment_content || body.content || body.text || body.message;
      const senderName = body.comment_author || body.author_name || 'Leitor do Blog';
      const senderId = body.comment_author_email || body.email || `reader_${Date.now()}`;
      const commentId = body.comment_ID || body.comment_id || body.id || `blog_comm_${Date.now()}`;
      if (text) {
        await this.handleIncomingComment({
          platform: 'blog',
          accountId: body.blog_id || null,
          senderId: String(senderId),
          senderName,
          text,
          commentId: String(commentId),
          postId: body.comment_post_ID || body.post_id || null
        });
        processed++;
      }
    }

    // 10. Snapchat
    if (plat === 'snapchat') {
      const text = body.text || body.message;
      const senderId = body.snap_user_id || body.sender_id || `snap_${Date.now()}`;
      const senderName = body.display_name || 'Usuário Snapchat';
      if (text) {
        await this.handleIncomingMessage({
          platform: 'snapchat',
          accountId: body.account_id || null,
          senderId: String(senderId),
          senderName,
          text
        });
        processed++;
      }
    }

    return { processed, platform: plat };
  }
}

module.exports = new SocialMediaService();

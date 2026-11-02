const models = require('../db/models');

class SocialMediaService {
  constructor() {
    this.defaultVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'paybot_meta_token_2026';
    this.isSimulationMode = process.env.PIX_SIMULATION_MODE === 'true';
  }

  // ==============================================================
  // 1. PROCESSAMENTO DE MENSAGENS RECEBIDAS (INSTAGRAM & FACEBOOK)
  // ==============================================================
  async handleIncomingMessage({ platform, accountId, senderId, senderName = 'Cliente Social', text }) {
    if (!text || !senderId) return null;

    const cleanText = text.trim();
    console.log(`[Social Direct 📩 ${platform.toUpperCase()}] Mensagem recebida de ${senderName} (${senderId}) na conta ID ${accountId}: "${cleanText}"`);

    // Busca conta social vinculada
    let account = null;
    if (accountId) {
      account = models.getSocialAccountByAccountId(accountId) || models.getSocialAccountById(accountId);
    }
    if (!account) {
      const allAccounts = models.getSocialAccounts({ platform });
      account = allAccounts.find(a => a.status === 'CONNECTED') || allAccounts[0];
    }

    const socialAccountId = account ? account.id : null;

    // Registra mensagem recebida
    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform,
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
    const replyText = await this.generateConversationalReply(cleanText, senderName);

    // Envia resposta (Graph API ou Simulação)
    const sent = await this.sendMessage({
      platform,
      account,
      recipientId: senderId,
      text: replyText
    });

    // Registra mensagem enviada
    models.logSocialMessage({
      social_account_id: socialAccountId,
      platform,
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
      replied: true,
      replyText,
      sent
    };
  }

  // ==============================================================
  // 2. MOTOR DE RESPOSTA CONVERSACIONAL DE AQUECIMENTO SOCIAL (NLU PT-BR)
  // ==============================================================
  async generateConversationalReply(text, senderName) {
    const rawName = (senderName || '').trim();
    const isGeneric = !rawName || /^(amigo\(a\)|amigo|lead|cliente)$/i.test(rawName);
    const name = isGeneric ? '' : rawName.split(' ')[0];
    let nlp = null;
    try {
      const nlpService = require('./nlpService');
      nlp = await nlpService.processMessage({ text, customerName: senderName, platform: 'social' });
    } catch (_) {}

    // Busca primeiro link de afiliado ou produto padrão
    const links = models.getAffiliateLinks();
    const defaultLink = links.length > 0 ? links[0] : null;
    const linkUrl = defaultLink ? defaultLink.affiliate_url : 'https://paybot.app/oferta-vip';
    const productName = defaultLink ? defaultLink.title : 'nosso Produto VIP';

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
        return `Olá ${name}! Que bom ter você por aqui no nosso Direct! 😊\n\nVocê já conhece o *${productName}* ou gostaria de saber como ele funciona na prática para acelerar seus resultados?`;
      }
    }

    // Default amigável
    return `Olá ${name}! Obrigado por entrar em contato! Como posso te ajudar hoje com relação ao *${productName}*? Se quiser ver a página oficial com a condição exclusiva, o link é: ${linkUrl}`;
  }

  // ==============================================================
  // 3. DISPARO DE MENSAGENS VIA META GRAPH API / SIMULAÇÃO
  // ==============================================================
  async sendMessage({ platform, account, recipientId, text }) {
    const token = account?.access_token;

    // Se houver token de acesso configurado e não for simulação estrita
    if (token && !this.isSimulationMode) {
      try {
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
        console.log(`[Social Direct ✅ ${platform.toUpperCase()}] Resposta enviada via Graph API para ${recipientId}.`);
        return { success: true, messageId: resData?.message_id };
      } catch (err) {
        console.error(`[Social Direct ❌ Graph API Error]:`, err.response?.data || err.message);
        // Fallback em simulação se erro de token
      }
    }

    // Modo Simulação / Log no console
    console.log(`[Social Direct 🟢 SIMULAÇÃO ${platform.toUpperCase()}] Resposta para ${recipientId}: "${text.substring(0, 70)}..."`);
    return { success: true, simulated: true };
  }

  // ==============================================================
  // 4. VERIFICAÇÃO DO WEBHOOK DO META (CHALLENGE)
  // ==============================================================
  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe') {
      const validTokens = [this.defaultVerifyToken, 'paybot_meta_token_2026'];
      // Verifica se bate com token padrão ou com token de alguma conta cadastrada
      const accounts = models.getSocialAccounts();
      const accountTokens = accounts.map(a => a.webhook_verify_token).filter(Boolean);
      const allTokens = [...validTokens, ...accountTokens];

      if (allTokens.includes(token)) {
        return challenge;
      }
    }
    return null;
  }

  // ==============================================================
  // 5. INGESTÃO DE EVENTOS DO WEBHOOK (INSTAGRAM & FACEBOOK)
  // ==============================================================
  async processWebhookPayload(payload) {
    if (!payload || !payload.object) return { processed: 0 };

    const platform = payload.object === 'instagram' ? 'instagram' : 'facebook';
    const entries = payload.entry || [];
    let processed = 0;

    for (const entry of entries) {
      const accountId = entry.id;

      // Formato Messaging padrão do Facebook Messenger & Instagram Direct
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id;
          const messageText = event.message?.text;

          // Ignora mensagens enviadas pela própria página
          if (senderId && senderId === accountId) continue;
          if (event.message?.is_echo) continue;

          if (senderId && messageText) {
            await this.handleIncomingMessage({
              platform,
              accountId,
              senderId,
              senderName: `Usuário ${platform === 'instagram' ? 'Instagram' : 'Facebook'}`,
              text: messageText
            });
            processed++;
          }
        }
      }

      // Formato Changes (ex: Instagram direct messages em algumas versões da API)
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
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
        }
      }
    }

    return { processed, platform };
  }
}

module.exports = new SocialMediaService();

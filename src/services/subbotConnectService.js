/**
 * subbotConnectService.js
 * Serviço de Conexão Inteligente e Onboarding Web de Sub-Bots
 *
 * Permite que qualquer cliente/lead se torne um Sub-Bot PayBot Free através de
 * um link único pré-configurado gerado pelo bot no WhatsApp (igual à Loja Web).
 *
 * Ao abrir o link único, a página web já vem preenchida com o nome e telefone do solicitante,
 * gerando o código de pareamento de 8 dígitos ou QR Code com 1 clique e ativando os 50 tokens diários!
 */

const models = require('../db/models');
const phoneUtil = require('../utils/phoneUtil');

class SubbotConnectService {
  /**
   * Constrói e retorna a URL única pré-configurada para o cliente conectar seu Sub-Bot
   */
  buildSubBotConnectUrl({
    phone = null,
    name = null,
    customerName = null,
    instanceId = null,
    referralCode = null,
    preferShort = true,
    host = null
  } = {}) {
    const tunnelService = require('./tunnelService');
    const baseHost = (host || tunnelService.getStoreUrl() || tunnelService.getUrl() || 'http://localhost:3000').replace(/\/+$/, '');

    // 1. Limpa e normaliza o telefone do solicitante
    let cleanPhone = '';
    const rawPhone = phone || null;
    if (rawPhone) {
      cleanPhone = String(rawPhone).split('@')[0].replace(/\D/g, '');
    }

    // 2. Resolve o nome do cliente
    let cleanName = (name || customerName || '').trim();
    if (!cleanName && cleanPhone) {
      try {
        const prof = models.getLeadCognitiveProfile(cleanPhone);
        if (prof && prof.name && !/^(cliente|lead|amigo|user|undefined|null|Lead Loja Web)$/i.test(prof.name.trim())) {
          cleanName = prof.name.trim();
        }
      } catch (_) {}
    }
    if (!cleanName || /^(cliente|lead|amigo|user|undefined|null)$/i.test(cleanName)) {
      cleanName = 'Cliente';
    }

    // 3. Código de indicação / Ref
    let finalRef = referralCode || null;
    if (!finalRef && cleanPhone) {
      try {
        const shortRecent = models.getStoreShortLinksByPhone(cleanPhone, 1);
        if (shortRecent && shortRecent.length > 0 && shortRecent[0].ref_code) {
          finalRef = shortRecent[0].ref_code;
        }
      } catch (_) {}
    }

    // 4. Cria ou reaproveita o token único de rastreamento via store_short_links
    let trackCode = null;
    try {
      const shortObj = models.getOrCreateStoreShortLink({
        phone: cleanPhone || 'anon',
        name: cleanName !== 'Cliente' ? cleanName : null,
        instanceId: instanceId || 1,
        refCode: finalRef,
        couponCode: null,
        source: 'whatsapp_subbot_invite',
        targetPath: '/subbot/conectar'
      });
      if (shortObj && shortObj.code) {
        trackCode = shortObj.code;
      }
    } catch (err) {
      console.warn('[SubbotConnectService ⚠️ Erro ao registrar link único]:', err.message);
    }

    if (!trackCode) {
      trackCode = 'bot' + Date.now().toString(36).slice(-5);
    }

    // 5. Montagem da URL completa pré-configurada
    const queryParts = [];
    if (cleanPhone) queryParts.push(`phone=${encodeURIComponent(cleanPhone)}`);
    if (cleanName && cleanName !== 'Cliente') queryParts.push(`name=${encodeURIComponent(cleanName)}`);
    queryParts.push(`token=${encodeURIComponent(trackCode)}`);
    queryParts.push(`s=${encodeURIComponent(trackCode)}`);
    if (finalRef) queryParts.push(`ref=${encodeURIComponent(finalRef)}`);

    const fullUrl = `${baseHost}/subbot/conectar?${queryParts.join('&')}`;
    const shortUrl = `${baseHost}/s/${trackCode}`;

    return {
      url: fullUrl,
      shortUrl: preferShort ? shortUrl : fullUrl,
      token: trackCode,
      code: trackCode,
      shortCode: trackCode,
      phone: cleanPhone,
      name: cleanName,
      targetPath: '/subbot/conectar'
    };
  }

  /**
   * Resolve e valida os dados de conexão de um token ou telefone
   */
  resolveConnectData(tokenOrCode = null, queryPhone = null, queryName = null) {
    let cleanPhone = queryPhone ? String(queryPhone).split('@')[0].replace(/\D/g, '') : '';
    let customerName = (queryName || '').trim();
    let refCode = null;

    if (tokenOrCode) {
      const link = models.getStoreShortLinkByCode(tokenOrCode, { trackClick: true });
      if (link) {
        if (!cleanPhone && link.phone && link.phone !== 'anon') {
          cleanPhone = link.phone;
        }
        if (!customerName && link.customer_name) {
          customerName = link.customer_name;
        }
        if (link.ref_code) {
          refCode = link.ref_code;
        }
      }
    }

    if (!customerName && cleanPhone) {
      try {
        const prof = models.getLeadCognitiveProfile(cleanPhone);
        if (prof && prof.name && !/^(cliente|lead|amigo|user|undefined|null|Lead Loja Web)$/i.test(prof.name.trim())) {
          customerName = prof.name.trim();
        }
      } catch (_) {}
    }
    if (!customerName) customerName = 'Cliente';

    // Normaliza informações telefônicas internacionais (país, bandeira, formato)
    const parsed = cleanPhone ? phoneUtil.parseAndNormalizePhone(cleanPhone) : { isValid: false, flag: '📱', formatted: cleanPhone };

    // Verifica se já existe um Sub-Bot associado a este número no banco
    let existingInst = null;
    if (cleanPhone && cleanPhone.length >= 8) {
      const instances = models.getArmyInstances();
      existingInst = instances.find(i => !i.is_main && i.phone && (i.phone === cleanPhone || i.phone.endsWith(cleanPhone.slice(-8)) || cleanPhone.endsWith(i.phone.slice(-8))));
    }

    return {
      success: true,
      phone: cleanPhone,
      name: customerName,
      formattedPhone: parsed.formatted || cleanPhone,
      flag: parsed.flag || '📱',
      countryFlag: parsed.flag || '📱',
      countryName: parsed.countryName || 'Global',
      token: tokenOrCode,
      refCode,
      hasExistingInstance: !!existingInst,
      customer: {
        phone: cleanPhone,
        name: customerName,
        formattedPhone: parsed.formatted || cleanPhone,
        countryFlag: parsed.flag || '📱',
        countryName: parsed.countryName || 'Global'
      },
      instance: existingInst ? {
        id: existingInst.id,
        name: existingInst.name,
        phone: existingInst.phone,
        status: existingInst.status,
        isConnected: existingInst.status === 'CONNECTED' || existingInst.connected === 1,
        isPaused: existingInst.status === 'PAUSED' || existingInst.is_paused === 1,
        tokens_balance: existingInst.tokens_balance !== undefined ? existingInst.tokens_balance : 50,
        terms_accepted: existingInst.terms_accepted === 1
      } : null
    };
  }

  /**
   * Formata a mensagem de convite exclusiva do WhatsApp com o link único do cliente
   */
  formatSubBotInvitationMessage({ phone, name, connectUrl, shortUrl, senderPhone }) {
    const finalUrl = shortUrl || connectUrl;
    const clientName = (name && name !== 'Cliente') ? name : 'Amigo(a)';
    const parsed = phone ? phoneUtil.parseAndNormalizePhone(phone) : { flag: '📱' };

    return `🤖 *CONECTE SEU SUB-BOT GRATUITO (PAYBOT FREE)* 🚀\n\n` +
      `Olá, *${clientName}*! Seu link único de ativação já está configurado para o seu número ${parsed.flag}!\n\n` +
      `👉 *Toque no link abaixo para conectar em 1 clique:*\n` +
      `🔗 ${finalUrl}\n\n` +
      `💎 *O QUE VOCÊ GANHA:* \n` +
      `• *R$ 0,00 de custo!* Sem taxas nem mensalidade\n` +
      `• *50 Tokens Grátis todo dia* para figurinhas (!figu), downloads (!play), IA (!ia) e áudio\n` +
      `• Conexão ultra rápida com *código de 8 dígitos* direto no seu WhatsApp!\n\n` +
      `_Abra o link acima pelo celular ou computador para gerar seu código e ativar seus 50 tokens na hora!_ ✨`;
  }
}

const subbotConnectService = new SubbotConnectService();
module.exports = subbotConnectService;

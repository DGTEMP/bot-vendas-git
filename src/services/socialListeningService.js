/**
 * socialListeningService.js
 * =========================================================================
 * 🎧 MOTOR HÍBRIDO DE ESCUTA, SOCIAL LISTENING & SENTINELA
 * =========================================================================
 * 1. Social Listening Stealth: Identifica menções de produtos em grupos e
 *    dispara recomendações naturais com links de afiliado.
 * 2. Radar Sentinela Confidencial: Monitora termos de oportunidade/risco
 *    (ex: "comprar", "pix", "golpe", "reembolso") e alerta o Dono em tempo real no PV.
 * 3. Escuta & Transcrição de Áudio (IA): Transcreve áudios de voz enviados
 *    nos grupos e aplica a mesma inteligência analítica em segundo plano.
 * 4. Gestão Completa via Chat: Painel, ativações, CRUD e simulações via !escuta.
 * 5. Importação em Massa: Adiciona regras e links por texto (uma por linha),
 *    ou via arquivo (.txt, .csv, .json) anexado ou respondido no chat.
 * =========================================================================
 */

const models = require('../db/models');

class SocialListeningService {
  constructor() {
    // Rastreia cooldown por grupo para recomendações de afiliados (evita spam)
    this.groupCooldowns = new Map();
    // Rastreia cooldown por remetente/regra para alertas no PV do dono (evita flood)
    this.alertCooldowns = new Map();
    // Cache de nomes de grupos
    this.groupMetaCache = new Map();
  }

  /**
   * Verifica se o motor de escuta está ativado globalmente
   */
  isEnabled() {
    return models.getSetting('SOCIAL_LISTENING_ENABLED', 'true') === 'true';
  }

  /**
   * Verifica se a transcrição e escuta em áudios de grupos está ativada
   */
  isAudioEnabled() {
    return models.getSetting('SOCIAL_LISTENING_AUDIO_ENABLED', 'true') === 'true';
  }

  /**
   * Verifica se os alertas Sentinela no PV do Dono estão ativados
   */
  isAlertEnabled() {
    return models.getSetting('SOCIAL_LISTENING_ALERT_ENABLED', 'true') === 'true';
  }

  /**
   * Retorna o tempo de cooldown padrão para grupos em minutos
   */
  getCooldownMinutes() {
    const val = parseInt(models.getSetting('SOCIAL_LISTENING_COOLDOWN_MIN', '15'), 10);
    return isNaN(val) ? 15 : Math.max(1, val);
  }

  /**
   * Obtém o JID do WhatsApp do Dono/Administrador para envio dos alertas confidenciais
   */
  getOwnerTargetJid() {
    const ownerPhone = (
      models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '') ||
      models.getSetting('OWNER_WHATSAPP', '') ||
      models.getSetting('OWNER_PHONE', '') ||
      process.env.ADMIN_NOTIFY_WHATSAPP_PHONE ||
      process.env.OWNER_PHONE ||
      '554884702848'
    ).replace(/\D/g, '');

    return ownerPhone ? `${ownerPhone}@s.whatsapp.net` : null;
  }

  /**
   * Obtém o JID de destino para os alertas do Radar Sentinela.
   * Prioridade máxima: Grupo confidencial #Sentinela (@g.us).
   * Fallback seguro: Número privado do Dono (@s.whatsapp.net).
   */
  getSentinelTargetJid() {
    const forcePv = models.getSetting('RADAR_SENTINELA_FORCE_PV', 'false') === 'true';
    if (!forcePv) {
      const groupJid = models.getSetting('RADAR_SENTINELA_GROUP_JID', '') ||
                       models.getSetting('SENTINELA_GROUP_JID', '');
      if (groupJid && groupJid.trim().endsWith('@g.us')) {
        return groupJid.trim();
      }
    }
    return this.getOwnerTargetJid();
  }

  /**
   * Obtém o socket adequado para despacho de alertas no grupo #Sentinela.
   * Prefere o socket da Matriz (whatsappBot.sock) para garantir que seja a administradora do grupo.
   */
  getAlertDispatchSocket(preferredSock = null) {
    try {
      const whatsappBot = require('../bots/whatsappBot');
      if (whatsappBot && whatsappBot.sock && whatsappBot.sock.user) {
        return whatsappBot.sock;
      }
    } catch (_) {}
    return preferredSock || null;
  }

  /**
   * Garante a existência do grupo confidencial "#Sentinela" no WhatsApp.
   * Se já existir, vincula o JID. Se não existir, cria automaticamente via Baileys,
   * adiciona o Dono Supremo (+554884702848) como Administrador e configura a descrição.
   *
   * @param {object} [preferredSock] - Socket Baileys ativo
   * @param {object} [options]
   * @param {boolean} [options.forceRecreate=false] - Força criação de novo grupo
   * @returns {Promise<{ success: boolean, groupJid?: string, inviteUrl?: string, alreadyExists?: boolean, created?: boolean, error?: string }>}
   */
  async ensureSentinelGroup(preferredSock = null, { forceRecreate = false } = {}) {
    try {
      const whatsappBot = require('../bots/whatsappBot');
      const sock = preferredSock || whatsappBot.sock;
      if (!sock) {
        return { success: false, error: 'Socket do WhatsApp não conectado no momento.' };
      }

      const ownerPhone = (
        models.getSetting('ADMIN_NOTIFY_WHATSAPP_PHONE', '') ||
        models.getSetting('OWNER_WHATSAPP', '') ||
        models.getSetting('OWNER_PHONE', '') ||
        process.env.ADMIN_NOTIFY_WHATSAPP_PHONE ||
        process.env.OWNER_PHONE ||
        '554884702848'
      ).replace(/\D/g, '');
      const ownerJid = `${ownerPhone}@s.whatsapp.net`;

      let currentJid = models.getSetting('RADAR_SENTINELA_GROUP_JID', '') ||
                       models.getSetting('SENTINELA_GROUP_JID', '');

      // 1. Se já está configurado e válido (e não for forçada recriação), retorna
      if (currentJid && currentJid.endsWith('@g.us') && !forceRecreate) {
        return {
          success: true,
          groupJid: currentJid,
          inviteUrl: models.getSetting('RADAR_SENTINELA_INVITE_URL', null),
          alreadyExists: true
        };
      }

      // 2. Se o bot já participa de um grupo chamado "#Sentinela", reaproveita
      if (!forceRecreate && typeof sock.groupFetchAllParticipating === 'function') {
        try {
          const participating = await sock.groupFetchAllParticipating();
          if (participating && typeof participating === 'object') {
            for (const [gid, gdata] of Object.entries(participating)) {
              const subject = (gdata?.subject || '').trim();
              if (/^#?sentinela$/i.test(subject) || subject.toLowerCase().includes('#sentinela')) {
                console.log(`[Sentinela 🛡️] Grupo existente encontrado no WhatsApp: "${subject}" (${gid}). Vinculando ao Radar.`);
                models.setSetting('RADAR_SENTINELA_GROUP_JID', gid);

                let code = '';
                try {
                  if (typeof sock.groupInviteCode === 'function') {
                    code = await sock.groupInviteCode(gid);
                    if (code) {
                      const url = `https://chat.whatsapp.com/${code}`;
                      models.setSetting('RADAR_SENTINELA_INVITE_URL', url);
                    }
                  }
                } catch (_) {}

                return {
                  success: true,
                  groupJid: gid,
                  inviteUrl: code ? `https://chat.whatsapp.com/${code}` : null,
                  alreadyExists: true
                };
              }
            }
          }
        } catch (fetchErr) {
          console.warn('[Sentinela ⚠️ Falha ao consultar grupos participantes]:', fetchErr.message);
        }
      }

      // 3. Criação do grupo "#Sentinela"
      const groupName = '#Sentinela';
      const initialParticipants = [ownerJid];

      // Tenta incluir chips da frota de sub-bots como participantes
      try {
        const army = require('./whatsappArmyService');
        if (army && typeof army.getAllActivePhones === 'function') {
          const phones = army.getAllActivePhones();
          for (const p of phones) {
            const cleanP = String(p).replace(/\D/g, '');
            if (cleanP && cleanP !== ownerPhone && !initialParticipants.includes(`${cleanP}@s.whatsapp.net`)) {
              initialParticipants.push(`${cleanP}@s.whatsapp.net`);
            }
          }
        }
      } catch (_) {}

      let groupJid = null;
      let inviteUrl = '';

      if (typeof sock.groupCreate === 'function') {
        console.log(`[Sentinela 🚀 Criando Grupo #Sentinela...] Participantes:`, initialParticipants);
        const createRes = await sock.groupCreate(groupName, initialParticipants);
        groupJid = createRes?.id || createRes?.gid;

        if (groupJid) {
          models.setSetting('RADAR_SENTINELA_GROUP_JID', groupJid);

          // Promove o Dono Supremo a Administrador
          try {
            if (typeof sock.groupParticipantsUpdate === 'function') {
              await sock.groupParticipantsUpdate(groupJid, [ownerJid], 'promote');
            }
          } catch (pErr) {
            console.warn('[Sentinela ⚠️ Erro ao promover Dono]:', pErr.message);
          }

          // Atualiza descrição oficial
          const groupDesc =
            `🚨 *CANAL OFICIAL #SENTINELA — RADAR DE LEADS & ESCUTA ATIVA* 🕵️\n\n` +
            `Central operacional confidencial de inteligência para recepção de todos os leads minerados, ` +
            `intenções de compra e oportunidades comerciais captadas pela frota de robôs.\n\n` +
            `👑 Dono Supremo: +${ownerPhone}\n` +
            `⚡ Mensagens do Radar centralizadas aqui para preservar seu WhatsApp privado!`;

          try {
            if (typeof sock.groupUpdateDescription === 'function') {
              await sock.groupUpdateDescription(groupJid, groupDesc);
            }
          } catch (_) {}

          // Gera link de convite
          try {
            if (typeof sock.groupInviteCode === 'function') {
              const code = await sock.groupInviteCode(groupJid);
              if (code) {
                inviteUrl = `https://chat.whatsapp.com/${code}`;
                models.setSetting('RADAR_SENTINELA_INVITE_URL', inviteUrl);
              }
            }
          } catch (_) {}

          // Mensagem de manifesto no grupo #Sentinela
          const groupWelcomeText =
            `🛡️ *CANAL OFICIAL #SENTINELA ATIVADO!* 🚨\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `A partir de agora, todas as notificações de inteligência mineradas pelo Enxame de Robôs serão entregues exclusivamente aqui:\n\n` +
            `🎯 *Leads de Compra:* Clientes com intenção de compra garimpados em grupos.\n` +
            `🕵️ *Alertas de Oportunidades:* Termos de busca e produtos procurados.\n` +
            `⚡ *Scripts Prontos:* Links rápidos para abordar cada lead com 1 clique no WhatsApp.\n\n` +
            `✅ Seu WhatsApp privado está oficialmente liberado e despoluído!\n` +
            `👑 *Dono Supremo:* +${ownerPhone}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

          await sock.sendMessage(groupJid, { text: groupWelcomeText }).catch(() => {});

          // Notificação no privado do Dono informando da ativação
          const ownerNotifyText =
            `✅ *Grupo #Sentinela Criado e Ativado com Sucesso!* 🛡️\n\n` +
            `Todas as mensagens e alertas do *Radar Sentinela* agora serão enviadas diretamente para o grupo *#Sentinela*.\n\n` +
            `Seu número privado não receberá mais a enxurrada de notificações de leads!\n\n` +
            (inviteUrl ? `🔗 *Link do Grupo:* ${inviteUrl}\n` : '') +
            `👑 Você foi adicionado como Administrador.`;

          await sock.sendMessage(ownerJid, { text: ownerNotifyText }).catch(() => {});

          console.log(`[Sentinela ✅ Grupo Criado]: #Sentinela (${groupJid}) configurado e ativo!`);
          return {
            success: true,
            groupJid,
            inviteUrl,
            created: true
          };
        }
      }

      // Fallback para ambiente simulado / offline
      groupJid = `120363${Date.now()}@g.us`;
      models.setSetting('RADAR_SENTINELA_GROUP_JID', groupJid);
      return {
        success: true,
        groupJid,
        simulated: true
      };
    } catch (err) {
      console.error('[Sentinela ❌ Erro ao garantir grupo #Sentinela]:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Normaliza texto para correspondência insensível a acentuação e pontuação
   */
  normalizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
   * Templates com rica variação Spintax para recomendações orgânicas
   */
  getDefaultSpintaxTemplates() {
    return [
      `{Olá|Oi|Opa|E aí|Fala pessoal|Fala galera|Tudo bem?}! {Comprei o meu por esse link oficial na promoção e recomendo demais|Peguei o meu por esse link com desconto e entrega rápida}: {link} 🚀`,
      `{Ei|Dica rápida|Passando aqui rapidinho}: Para quem estava procurando por *{produto}*, {encontrei essa oferta com ótimo desconto|achei esse link oficial em promoção hoje}: {link} ⭐`,
      `{Atenção|Aviso rápido|Alerta de oportunidade}: O produto *{produto}* {está com cupom de desconto liberado|teve o valor reduzido hoje}. {Vale a pena conferir antes que acabe|Recomendo muito}: {link} 🔥`
    ];
  }

  /**
   * Reseta o cooldown de grupos ou alertas (útil para testes e reset manual)
   */
  resetCooldown(groupJid = null) {
    if (groupJid) {
      this.groupCooldowns.delete(groupJid);
    } else {
      this.groupCooldowns.clear();
      this.alertCooldowns.clear();
    }
  }

  /**
   * Resolve o nome legível de um grupo com cache em memória
   */
  async resolveGroupName(sock, groupJid) {
    if (!groupJid) return 'Grupo WhatsApp';
    const cached = this.groupMetaCache.get(groupJid);
    if (cached && (Date.now() - cached.timestamp < 300000)) {
      return cached.name;
    }
    let name = 'Grupo WhatsApp';
    try {
      if (sock && typeof sock.groupMetadata === 'function') {
        const meta = await sock.groupMetadata(groupJid);
        if (meta?.subject) {
          name = meta.subject;
        }
      }
    } catch (_) {}
    this.groupMetaCache.set(groupJid, { name, timestamp: Date.now() });
    return name;
  }

  /**
   * Extrai buffer de documento ou arquivo de texto de mensagem direta ou citada
   */
  async extractDocumentBuffer(msg) {
    if (!msg) return null;

    // 1. Suporte a wrapper smsg do handler (tem .download() e .quoted.download())
    if (msg.quoted && typeof msg.quoted.download === 'function') {
      try {
        const qBuf = await msg.quoted.download();
        if (qBuf && qBuf.length > 0) return qBuf;
      } catch (_) {}
    }
    if (typeof msg.download === 'function') {
      try {
        const mBuf = await msg.download();
        if (mBuf && mBuf.length > 0) return mBuf;
      } catch (_) {}
    }

    // 2. Suporte a Baileys raw
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted || msg.message;
    if (!targetMsg) return null;

    const unwrappedMsg = targetMsg.viewOnceMessageV2?.message ||
                         targetMsg.viewOnceMessage?.message ||
                         targetMsg.documentWithCaptionMessage?.message ||
                         targetMsg;

    const docObj = unwrappedMsg.documentMessage;
    if (!docObj) return null;

    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(docObj, 'document');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return buffer;
    } catch (err) {
      console.warn('[SocialListening ⚠️ Erro ao baixar documento]:', err.message);
      return null;
    }
  }

  /**
   * Importação de Regras em Massa por Texto (Linhas), CSV ou JSON
   */
  bulkImportRules(content) {
    if (!content) return { success: false, total: 0, added: 0, sentinelCount: 0, affiliateCount: 0, errors: ['Conteúdo vazio'] };
    const rawStr = Buffer.isBuffer(content) ? content.toString('utf-8') : String(content);
    const trimmed = rawStr.trim();
    if (!trimmed) return { success: false, total: 0, added: 0, sentinelCount: 0, affiliateCount: 0, errors: ['Conteúdo vazio'] };

    let addedCount = 0;
    let sentinelCount = 0;
    let affiliateCount = 0;
    const errors = [];

    // 1. Caso seja JSON
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        let items = JSON.parse(trimmed);
        if (!Array.isArray(items) && items.rules && Array.isArray(items.rules)) {
          items = items.rules;
        } else if (!Array.isArray(items)) {
          items = [items];
        }

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const keywords = item.keywords || item.gatilhos || item.palavras;
          const productName = item.product_name || item.produto || item.nome || item.name || 'Regra Importada';
          const affiliateUrl = item.affiliate_url || item.url || item.link || '';
          const actionType = (item.action_type || item.tipo || (affiliateUrl ? 'REPLY' : 'ALERT')).toUpperCase();
          const templates = Array.isArray(item.templates) ? item.templates : (item.template ? [item.template] : (affiliateUrl ? ['Comprei o meu por esse link aqui na promoção e recomendo demais: {link}'] : []));

          try {
            models.saveSocialListeningRule({
              product_name: productName,
              keywords: String(keywords || '').trim(),
              affiliate_url: affiliateUrl,
              templates,
              action_type: actionType,
              active: item.active !== undefined ? (item.active ? 1 : 0) : 1,
              cooldown_minutes: item.cooldown_minutes || 15
            });
            addedCount++;
            if (actionType === 'ALERT') sentinelCount++;
            else affiliateCount++;
          } catch (itemErr) {
            errors.push(`Item #${i + 1} (${productName}): ${itemErr.message}`);
          }
        }

        return {
          success: addedCount > 0,
          total: items.length,
          added: addedCount,
          sentinelCount,
          affiliateCount,
          errors
        };
      } catch (_) {}
    }

    // 2. Caso seja Texto em Linhas / CSV / Pipe
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Formato Sentinela explícito: [sentinela] Nome | gatilho1, gatilho2
      const sentinelMatch = line.match(/^\[(?:sentinela|radar|alerta)\]\s*(.+)/i);
      if (sentinelMatch) {
        const body = sentinelMatch[1].trim();
        const parts = body.split(/[|;]/).map(p => p.trim());
        const ruleName = parts[0] || 'Alerta Sentinela';
        const keywords = parts[1] || parts[0];

        try {
          models.saveSocialListeningRule({
            product_name: ruleName,
            keywords,
            affiliate_url: '',
            templates: [],
            action_type: 'ALERT',
            active: 1,
            cooldown_minutes: 5
          });
          addedCount++;
          sentinelCount++;
        } catch (err) {
          errors.push(`Linha ${i + 1}: ${err.message}`);
        }
        continue;
      }

      // Separador Pipe (|) ou Ponto-e-vírgula (;)
      const delimiter = line.includes('|') ? '|' : (line.includes(';') ? ';' : null);
      if (delimiter) {
        const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (parts.length >= 3) {
          const productName = parts[0];
          const keywords = parts[1];
          const affiliateUrl = parts[2];
          const customTemplate = parts[3] || null;

          try {
            models.saveSocialListeningRule({
              product_name: productName,
              keywords,
              affiliate_url: affiliateUrl,
              templates: customTemplate ? [customTemplate] : this.getDefaultSpintaxTemplates(),
              action_type: 'REPLY',
              active: 1,
              cooldown_minutes: this.getCooldownMinutes()
            });
            addedCount++;
            affiliateCount++;
          } catch (err) {
            errors.push(`Linha ${i + 1}: ${err.message}`);
          }
          continue;
        } else if (parts.length === 2) {
          const ruleName = parts[0];
          const keywords = parts[1];
          try {
            models.saveSocialListeningRule({
              product_name: ruleName,
              keywords,
              affiliate_url: '',
              templates: [],
              action_type: 'ALERT',
              active: 1,
              cooldown_minutes: 5
            });
            addedCount++;
            sentinelCount++;
          } catch (err) {
            errors.push(`Linha ${i + 1}: ${err.message}`);
          }
          continue;
        }
      }

      errors.push(`Linha ${i + 1} inválida (use Nome | gatilhos | link): "${line.slice(0, 40)}..."`);
    }

    return {
      success: addedCount > 0,
      total: lines.length,
      added: addedCount,
      sentinelCount,
      affiliateCount,
      errors
    };
  }

  /**
   * Transcreve áudio enviado em grupo e o injeta no pipeline de escuta
   */
  async handleIncomingGroupAudio(sock, groupJid, senderJid, msg, isOwnerUser = false) {
    if (!this.isAudioEnabled() || !this.isEnabled() || isOwnerUser) return false;
    if (!sock || !groupJid || !msg?.message) return false;

    const senderPhone = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const subbotPrivateFilter = require('./subbotPrivateFilterService');
    if (subbotPrivateFilter.isFleetBotNumber(senderPhone)) return false;

    const audioObj = msg.message?.audioMessage || msg.message?.voiceMessage;
    if (!audioObj) return false;

    const durationSec = audioObj.seconds || 0;
    // Ignora áudios excessivamente longos (> 90s) para economizar recursos de IA
    if (durationSec > 90) return false;

    try {
      const speechToTextService = require('./speechToTextService');
      if (!speechToTextService.isEnabled()) return false;

      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (!buffer || buffer.length === 0) return false;

      const mime = audioObj.mimetype || 'audio/ogg';
      const transcribedText = await speechToTextService.transcribeAudio(buffer, mime);

      if (transcribedText && transcribedText.trim()) {
        console.log(`[Escuta 🎙️ Grupo ${groupJid}] Áudio de ${senderJid} (${durationSec}s): "${transcribedText.slice(0, 100)}..."`);
        return await this.handleIncomingGroupMessage(sock, groupJid, senderJid, transcribedText, isOwnerUser, {
          isAudio: true,
          durationSec,
          senderName: msg.pushName || ''
        });
      }
    } catch (err) {
      console.warn(`[Escuta ⚠️] Erro ao transcrever áudio do grupo ${groupJid}:`, err.message);
    }
    return false;
  }

  /**
   * Analisa mensagens (texto ou áudio transcrito) em grupos
   * e dispara tanto o Social Listening stealth quanto os alertas Sentinela no PV do Dono.
   */
  async handleIncomingGroupMessage(sock, groupJid, senderJid, text, isOwnerUser = false, extra = {}) {
    // Suporte flexível para chamada via objeto único desestruturado: ({ sock, groupJid, senderJid, senderPhone, text, messageText, ... })
    if (sock && typeof sock === 'object' && !sock.sendMessage && (sock.groupJid || sock.text || sock.messageText)) {
      const opts = sock;
      sock = opts.sock || null;
      groupJid = opts.groupJid || '';
      senderJid = opts.senderJid || (opts.senderPhone ? `${opts.senderPhone}@s.whatsapp.net` : '');
      text = opts.text || opts.messageText || '';
      isOwnerUser = opts.isOwnerUser || false;
      extra = opts.extra || { senderName: opts.senderName || '' };
    }

    if (!this.isEnabled()) return false;
    if (isOwnerUser) return false; // Dono nunca é alvo de entrosamento stealth ou alertas de si mesmo
    if (!groupJid || !text || typeof text !== 'string') return false;

    const senderPhone = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const subbotPrivateFilter = require('./subbotPrivateFilterService');
    // Regra Suprema: Robôs da própria frota (Matriz ou qualquer Sub-Bot) nunca são minerados como leads nem acionam aquecimento/respostas
    if (subbotPrivateFilter.isFleetBotNumber(senderPhone)) {
      return false;
    }

    const rawText = text.trim();
    // Ignora comandos iniciados por ! ou /
    if (rawText.startsWith('!') || rawText.startsWith('/')) return false;

    const normalizedMsg = this.normalizeText(rawText);
    if (!normalizedMsg) return false;

    // Busca todas as regras de escuta ativas no banco
    const rules = models.listSocialListeningRules(true) || [];

    const { isAudio = false, durationSec = 0, senderName = '' } = extra;
    const now = Date.now();

    // ══════════════════════════════════════════════════════════════════
    // 🧠 MINERAÇÃO COGNITIVA DE LEADS EM GRUPOS (JEV DECISION / VIRAL RADAR)
    // Avalia a mensagem com o motor de inferência ultra-rápido para
    // capturar oportunidades de compra espontâneas de alto valor prioritário!
    // ══════════════════════════════════════════════════════════════════
    try {
      const jevDecisionService = require('./jevDecisionService');
      if (jevDecisionService.isEnabled()) {
        const groupName = await this.resolveGroupName(sock, groupJid);
        const jevResult = await jevDecisionService.decideLeadTemperature({
          text: rawText,
          senderPhone,
          senderName,
          groupJid,
          groupName,
          platform: 'whatsapp'
        });

        if (jevResult && jevResult.isHotLead && jevResult.temperature === 'HOT') {
          const alertCooldownKey = `${senderPhone}_jev_hot`;
          const lastAlertTime = this.alertCooldowns.get(alertCooldownKey);
          const alertCooldownMs = process.env.NODE_ENV === 'test' ? 50 : 90000;

          if (!lastAlertTime || (now - lastAlertTime) >= alertCooldownMs) {
            this.alertCooldowns.set(alertCooldownKey, Date.now());

            const firstName = models.getContactFirstName(senderPhone) || (senderName ? senderName.split(' ')[0] : 'Amigo');
            let detectedNiche = 'Geral / Tech';
            if (/papelaria|livraria|escrit[oó]rio/i.test(rawText)) detectedNiche = 'Papelaria & Escritório';
            else if (/roupa|moda|vestu[aá]rio|calcado|cal[cç]a/i.test(rawText)) detectedNiche = 'Moda & Vestuário';
            else if (/delivery|restaurante|comida|lanche|pizz/i.test(rawText)) detectedNiche = 'Delivery & Alimentação';
            else if (/curso|infoproduto|afiliad|drop/i.test(rawText)) detectedNiche = 'Infoprodutos & Afiliados';
            else if (/loja|varejo|e-?commerce/i.test(rawText)) detectedNiche = 'E-commerce & Varejo';

            // Ingestão no CRM Cognitivo
            try {
              models.upsertLeadCognitiveProfile(senderPhone, {
                name: senderName || firstName || 'Lead Quente (Radar)',
                company_niche: detectedNiche,
                project_scope: `Oportunidade detectada no grupo ${groupName}`,
                buying_stage: 'DESCOBERTA',
                readiness_score: Math.round((jevResult.buyingIntentScore || 0.95) * 100),
                notes: `Lead quente detectado no grupo "${groupName}" via Radar Cognitivo (JEV). Mensagem: "${rawText.slice(0, 100)}"`
              });

              models.recordCognitiveMemory(senderPhone, {
                memory_type: 'NEED',
                fact_summary: `Interesse de compra no grupo ${groupName}: "${rawText.slice(0, 150)}"`,
                confidence_score: 0.95
              });
            } catch (_) {}

            // Geração de Recomendação Stealth (Sub-bot Wingman)
            const isWingmanEnabled = models.getSetting('WINGMAN_MODE_ENABLED', 'true') === 'true';
            let wingmanText = '';
            if (isWingmanEnabled) {
              const wingmanTemplates = [
                `Cara, semana passada passei por isso e coloquei um bot que atende no zap e gera o Pix direto. Se quiser, te passo o contato do rapaz que montou pra mim, resolveu na hora.`,
                `Opa, eu uso uma automação de atendimento com Pix automático que me salvou demais nisso aí. Se quiser, me dá um toque no privado que te passo o contato.`,
                `Aqui na minha operação a gente resolveu isso com um bot de vendas consultivas no WhatsApp. Se precisar, te indico o especialista que configurou o meu.`
              ];
              wingmanText = wingmanTemplates[Math.floor(Math.random() * wingmanTemplates.length)];

              // Registra a missão stealth do enxame (Swarm Wingman Mission)
              try {
                models.recordSwarmMission({
                  missionType: 'WINGMAN_STEALTH_RECOMMENDATION',
                  targetJid: groupJid,
                  prospectPhone: senderPhone,
                  notes: `Recomendação orgânica stealth para ${senderName || firstName || 'membro'} (${wingmanText})`
                });
              } catch (_) {}
            }

            // Alerta Estratégico no Canal Sentinela ou Dono
            let targetJid = this.getSentinelTargetJid() || this.getOwnerTargetJid();
            if (targetJid && this.isAlertEnabled()) {
              const nameGreet = firstName && firstName !== 'Amigo' ? `Fala ${firstName}, ` : 'Opa, ';
              const prefilledMsg = `${nameGreet}tudo bem? vi sua mensagem lá no grupo *${groupName}*... conseguiu resolver ou ainda tá precisando?`;
              const readyWaLink = `https://wa.me/${senderPhone}?text=${encodeURIComponent(prefilledMsg)}`;

              const alertCard =
                `🚨 *RADAR VIRAL COGNITIVO: OPORTUNIDADE DE VENDA DETECTADA!* 🎯\n\n` +
                `📍 *Grupo:* *${groupName}*\n` +
                `👤 *Lead:* *${senderName || firstName || 'Membro'}* (+${senderPhone})\n` +
                `🧠 *CRM Cognitivo:* Nicho ${detectedNiche} | Prontidão: ${Math.round((jevResult.buyingIntentScore || 0.95) * 100)}% 🔥\n` +
                `🔥 *Intenção Detectada:* \`${jevResult.intent || 'HOT_BUYING_OPPORTUNITY'}\`\n` +
                `💬 *Mensagem no Grupo:*\n"${rawText.slice(0, 300)}"\n\n` +
                (wingmanText ? `🥷 *Sub-Bot Wingman (Indicação Stealth Orgânica):*\n"${wingmanText}"\n\n` : '') +
                `💡 *Ação Recomendada:* ${jevResult.recommendedAction || 'Abordar com consultoria rápida no privado'}\n\n` +
                `⚡ *Chamar com 1 Clique (WhatsApp):*\n${readyWaLink}`;

              const dispatchSock = this.getAlertDispatchSocket(sock) || sock;
              if (dispatchSock && typeof dispatchSock.sendMessage === 'function') {
                try {
                  await dispatchSock.sendMessage(targetJid, { text: alertCard });
                } catch (_) {}
              }
            }

            return {
              triggered: true,
              alerted: true,
              replied: false,
              jevOpportunity: true,
              wingmanOpportunity: isWingmanEnabled,
              wingmanText,
              temperature: 'HOT',
              intent: jevResult.intent
            };
          }
        }
      }
    } catch (jevErr) {
      console.warn('[SocialListening ⚠️ Erro no Radar Cognitivo JEV]:', jevErr.message);
    }

    if (rules && rules.length > 0) {
      for (const rule of rules) {
      if (!rule.keywords) continue;

      // Se a regra tiver grupos específicos definidos, valida o grupo atual
      if (rule.target_groups && rule.target_groups.trim()) {
        const allowed = rule.target_groups.split(',').map(g => g.trim());
        if (!allowed.includes(groupJid)) continue;
      }

      const keywords = rule.keywords
        .split(',')
        .map(k => this.normalizeText(k))
        .filter(Boolean);

      // Verifica se a mensagem contém alguma das palavras-chave
      const matchedKeyword = keywords.find(kw => {
        if (!kw) return false;
        // Correspondência por palavra ou termo exato
        return normalizedMsg.includes(kw);
      });

      if (!matchedKeyword) continue;

      const actionType = (rule.action_type || 'REPLY').toUpperCase();
      let alertTriggered = false;
      let replyTriggered = false;
      let recommendationText = null;

      // ==============================================================
      // 1. MODO SENTINELA / RADAR: Alerta confidencial no PV do Dono
      // ==============================================================
      if ((actionType === 'ALERT' || actionType === 'BOTH') && this.isAlertEnabled()) {
        const alertCooldownKey = `${senderPhone}_${rule.id}`;
        const lastAlertTime = this.alertCooldowns.get(alertCooldownKey);
        // Cooldown de 90 segundos por remetente/regra para não inundar o PV do dono
        const alertCooldownMs = process.env.NODE_ENV === 'test' ? 50 : 90000;

        if (!lastAlertTime || (now - lastAlertTime) >= alertCooldownMs) {
          const groupName = await this.resolveGroupName(sock, groupJid);
          const userDisplay = senderName ? `*${senderName}*` : 'Participante';

          // 1. Identificação do Scout (Matriz ou Sub-Bot do Exército)
          const instanceId = Number(extra.instanceId || sock?.instanceId || 1);
          let scoutName = 'WhatsApp Matriz Principal (Dono)';
          let scoutPhone = '';
          if (instanceId > 1) {
            const armyInst = models.getArmyInstanceById(instanceId);
            if (armyInst) {
              scoutName = `Sub-Bot #${armyInst.id} (${armyInst.name || armyInst.role || 'Exército'})`;
              scoutPhone = armyInst.phone || '';
            } else {
              scoutName = `Sub-Bot #${instanceId}`;
            }
          }

          // 2. Extração de Primeiro Nome & Nicho do Lead
          const firstName = models.getContactFirstName(senderPhone) || (senderName ? senderName.split(' ')[0] : 'Amigo');
          let detectedNiche = 'Geral / Tech';
          if (/papelaria|livraria|escrit[oó]rio/i.test(rawText)) detectedNiche = 'Papelaria & Escritório';
          else if (/roupa|moda|vestu[aá]rio|calcado|cal[cç]a/i.test(rawText)) detectedNiche = 'Moda & Vestuário';
          else if (/delivery|restaurante|comida|lanche|pizz/i.test(rawText)) detectedNiche = 'Delivery & Alimentação';
          else if (/curso|infoproduto|afiliad|drop/i.test(rawText)) detectedNiche = 'Infoprodutos & Afiliados';
          else if (/loja|varejo|e-?commerce/i.test(rawText)) detectedNiche = 'E-commerce & Varejo';

          // 3. Recomendação Inteligente de Produto do Catálogo
          let matchedProd = null;
          try {
            const allProds = models.getProducts(true);
            if (/bot|automacao|whatsapp|zap|atendimento|vendas/i.test(rawText) || /bot|vendas/i.test(rule.product_name)) {
              matchedProd = allProds.find(p => p.id === 842 || /paybot|bot de vendas/i.test(p.name)) || allProds[0];
            } else if (/grupo|aluguel|moderacao|trava/i.test(rawText)) {
              matchedProd = allProds.find(p => /aluguel|grupo/i.test(p.name)) || allProds[0];
            } else if (/software|app|painel|sistema|site/i.test(rawText)) {
              matchedProd = allProds.find(p => /software sob medida/i.test(p.name)) || allProds[0];
            } else {
              matchedProd = allProds[0];
            }
          } catch (_) {}

          const prodName = matchedProd?.name || rule.product_name;
          const prodPrice = matchedProd ? `R$ ${Number(matchedProd.price_brl || matchedProd.price).toFixed(2)}` : 'R$ 497,00';

          // 4. Geração de Link Próprio e Rastreável (/v/:code)
          let customTrackUrl = '';
          try {
            const webStoreTrackerService = require('./webStoreTrackerService');
            const trackObj = webStoreTrackerService.buildTrackedStoreUrl({
              phone: senderPhone,
              name: firstName,
              instanceId,
              source: 'radar_group_lead',
              preferShort: true
            });
            customTrackUrl = trackObj.shortUrl || trackObj.url;
          } catch (_) {}

          // 5. Script Pronto Humanizado (1-Clique WhatsApp)
          const nameGreet = firstName && firstName !== 'Amigo' && firstName !== 'Participante' ? `Fala ${firstName}, ` : 'Opa, ';
          const prefilledMsg = `${nameGreet}tudo bem? vi sua mensagem lá no grupo *${groupName}* procurando sobre isso... conseguiu resolver ou ainda tá precisando de ajuda?`;
          const readyWaLink = `https://wa.me/${senderPhone}?text=${encodeURIComponent(prefilledMsg)}`;

          // 6. ALIMENTA O CRM COGNITIVO (Perfis, Crenças & Memórias Episódicas)
          try {
            models.upsertLeadCognitiveProfile(senderPhone, {
              name: senderName || 'Lead Minerado',
              company_niche: detectedNiche,
              project_scope: `Interesse em ${prodName} detectado no grupo ${groupName}`,
              buying_stage: 'CONSIDERACAO',
              readiness_score: 85,
              last_viewed_product_id: matchedProd?.id || null,
              last_viewed_product_name: prodName,
              high_margin_interest: 1,
              notes: `Minerado pelo ${scoutName} no grupo "${groupName}" (Gatilho: ${matchedKeyword})`
            });

            models.updateLeadBelief(senderPhone, 'nicho', detectedNiche, `Manifestou interesse no grupo ${groupName}`, 0.95);
            models.updateLeadBelief(senderPhone, 'origem_radar', groupName, `Capturado via ${scoutName}`, 0.98);
            models.updateLeadBelief(senderPhone, 'gatilho_detectado', matchedKeyword, rawText.slice(0, 150), 0.95);
            models.updateLeadBelief(senderPhone, 'scout_responsavel', scoutName, `Chip #${instanceId}`, 0.99);

            models.addLeadEpisodicMemory(
              senderPhone,
              'RADAR_OPPORTUNITY',
              `Minerado pelo ${scoutName} no grupo "${groupName}". Disse: "${rawText.slice(0, 150)}"`,
              rawText.slice(0, 250),
              4
            );
          } catch (crmErr) {
            console.warn('[Radar Leads ⚠️ Erro ao alimentar CRM Cognitivo]:', crmErr.message);
          }

          // 7. ALIMENTA A INTELIGÊNCIA PREDITIVA DO PAYBOT (insights & oráculo)
          try {
            models.recordPredictiveInsight({
              insight_type: 'RADAR_GROUP_OPPORTUNITY',
              probability_score: 85.0,
              projected_impact_brl: Number(matchedProd?.price_brl || 497.0),
              title: `Oportunidade Quente no Grupo "${groupName}"`,
              recommendation: `O membro ${userDisplay} demonstrou forte interesse em ${prodName}. Abordagem recomendada através de ${scoutName}.`,
              suggested_action: `wa.me/${senderPhone}?text=${encodeURIComponent(prefilledMsg)}`,
              evidence_data: {
                sender_phone: senderPhone,
                sender_name: senderName,
                group_name: groupName,
                group_jid: groupJid,
                scout: scoutName,
                instance_id: instanceId,
                keyword: matchedKeyword,
                message: rawText.slice(0, 200)
              }
            });
          } catch (predErr) {
            console.warn('[Radar Leads ⚠️ Erro ao alimentar Inteligência Preditiva]:', predErr.message);
          }

          // 8. Registra o Lead Minerado no Banco de Dados com Scout e Inteligência
          try {
            models.recordRadarLead({
              group_jid: groupJid,
              group_name: groupName,
              sender_phone: senderPhone,
              sender_name: senderName || firstName || 'Participante',
              keyword_matched: matchedKeyword,
              category: rule.product_name,
              message_text: rawText,
              is_audio: isAudio ? 1 : 0,
              status: 'NEW',
              instance_id: instanceId,
              scout_name: scoutName,
              matched_product_id: matchedProd?.id || null,
              matched_product_name: prodName,
              custom_track_url: customTrackUrl,
              ready_message: prefilledMsg
            });
          } catch (rLeadErr) {
            console.warn('[Radar Leads ⚠️ Erro ao registrar lead]:', rLeadErr.message);
          }

          // 9. Dispara Alerta Estratégico no Grupo #Sentinela (ou PV do Dono como fallback)
          let targetJid = this.getSentinelTargetJid();
          if (!targetJid || !targetJid.endsWith('@g.us')) {
            try {
              const ensured = await this.ensureSentinelGroup(sock);
              if (ensured && ensured.groupJid) targetJid = ensured.groupJid;
            } catch (_) {}
          }
          if (!targetJid) {
            targetJid = this.getOwnerTargetJid();
          }

          if (targetJid) {
            const isGroupTarget = targetJid.endsWith('@g.us');
            const alertCard =
              `🚨 *RADAR SENTINELA / ESCUTA ATIVA* 🕵️\n\n` +
              `🤖 *Scout:* ${scoutName}\n` +
              `📍 *Grupo:* *${groupName}*\n` +
              `👤 *Lead:* ${userDisplay} (+${senderPhone})\n` +
              `🧠 *CRM Cognitivo:* Nicho ${detectedNiche} | Prontidão: 85% 🔥\n` +
              `🎯 *Solução Sugerida:* *${prodName}* (${prodPrice})\n` +
              `🔑 *Gatilho Detectado:* \`${matchedKeyword}\`\n` +
              `🎙️ *Origem:* ${isAudio ? `Áudio de Voz (${durationSec}s) 🗣️` : 'Mensagem de Texto 💬'}\n\n` +
              `💬 *Conteúdo:* \n"${rawText.slice(0, 300)}${rawText.length > 300 ? '...' : ''}"\n\n` +
              `⚡ *Chamar com 1 Clique (Script Pronto):*\n${readyWaLink}`;

            try {
              const dispatchSock = this.getAlertDispatchSocket(sock) || sock;
              if (dispatchSock && typeof dispatchSock.sendMessage === 'function') {
                await dispatchSock.sendMessage(targetJid, { text: alertCard });
                this.alertCooldowns.set(alertCooldownKey, Date.now());
                alertTriggered = true;
                const destLabel = isGroupTarget ? `canal #Sentinela (${targetJid})` : `Dono (+${targetJid.split('@')[0]})`;
                console.log(`[Radar Leads 🚨] Lead minerado por ${scoutName} em "${groupName}" (+${senderPhone}) enviado para o ${destLabel}`);
              }
            } catch (alertErr) {
              console.warn('[Radar Leads ⚠️] Falha ao enviar alerta para o canal Sentinela:', alertErr.message);
              // Fallback de contingência para o PV do Dono caso falhe o envio no grupo
              if (isGroupTarget) {
                const fallbackOwner = this.getOwnerTargetJid();
                if (fallbackOwner && fallbackOwner !== targetJid) {
                  try {
                    await sock.sendMessage(fallbackOwner, { text: alertCard });
                    console.log(`[Radar Leads 🔄 Fallback] Alerta entregue no PV do Dono (+${fallbackOwner.split('@')[0]})`);
                  } catch (_) {}
                }
              }
            }
          }

          // 10. Abordagem Sutil no PV do Membro (se ativada pelo Dono no painel)
          try {
            const autoApproach = models.getSetting('RADAR_AUTO_PV_APPROACH', 'false') === 'true';
            if (autoApproach && senderPhone && senderPhone.length >= 8) {
              const approachText = `${nameGreet}tudo bem? vi sua mensagem lá no grupo *${groupName}* procurando sobre isso... conseguiu encontrar o que precisava ou ainda tá buscando?`;
              const approachDelay = process.env.NODE_ENV === 'test' ? 10 : (Math.floor(Math.random() * 6000) + 12000);

              setTimeout(async () => {
                try {
                  const whatsappBot = require('../bots/whatsappBot');
                  if (whatsappBot && typeof whatsappBot.sendHumanSplitMessages === 'function') {
                    await whatsappBot.sendHumanSplitMessages(sock, `${senderPhone}@s.whatsapp.net`, approachText);
                    console.log(`[Radar Leads 🎯 Abordagem PV]: Mensagem humanizada enviada para +${senderPhone} via ${scoutName}`);
                  }
                } catch (apprErr) {
                  console.warn('[Radar Leads ⚠️ Erro na abordagem PV]:', apprErr.message);
                }
              }, approachDelay);
            }
          } catch (_) {}
        }
      }

      // ==============================================================
      // 2. MODO SOCIAL LISTENING: Recomendação Orgânica Stealth no Grupo
      // ==============================================================
      // 🛑 Se o grupo estiver banido via !bangp, ou com postagens/bot desativados, NÃO envia recomendações nem diálogos públicos no grupo!
      if (models.isGroupBanned(groupJid) || !models.isGroupPostingActive(groupJid) || !models.isGroupBotActive(groupJid)) {
        continue;
      }

      if (actionType === 'REPLY' || actionType === 'BOTH') {
        let heatingExecuted = false;
        let heatingLimitReached = false;

        // Se houver 2 ou mais sub-bots no grupo, ativa o motor de aquecimento mútuo (diálogo entre sub-bots)
        try {
          const groupHeatingService = require('./groupHeatingService');
          if (groupHeatingService.isEnabled()) {
            const subBots = await groupHeatingService.getSubBotsInGroup(groupJid, sock, extra);
            if (subBots && subBots.length >= 2) {
              const heatingResult = await groupHeatingService.handleGroupTopicTrigger(groupJid, rule, rawText, {
                ...extra,
                sock,
                senderPhone,
                senderName,
                matchedKeyword
              });

              if (heatingResult && heatingResult.triggered) {
                heatingExecuted = true;
                replyTriggered = true;
                recommendationText = heatingResult.summaryText || 'Diálogo de aquecimento realizado entre sub-bots';
                this.groupCooldowns.set(groupJid, Date.now());
              } else if (heatingResult && heatingResult.reason === '24H_LIMIT_REACHED') {
                heatingLimitReached = true;
              }
            }
          }
        } catch (heatErr) {
          console.warn('[Social Listening ⚠️] Erro ao tentar acionar aquecimento de sub-bots:', heatErr.message);
        }

        // Se o aquecimento de sub-bots não foi executado e NÃO atingiu o teto de 24h,
        // executa a recomendação individual padrão com cooldown
        if (!heatingExecuted && !heatingLimitReached) {
          const lastGroupTrigger = this.groupCooldowns.get(groupJid);
          const cooldownMs = process.env.NODE_ENV === 'test' ? 50 : (this.getCooldownMinutes() * 60 * 1000);

          if (!lastGroupTrigger || (now - lastGroupTrigger) >= cooldownMs) {
            const templates = Array.isArray(rule.templates) && rule.templates.length > 0
              ? rule.templates
              : this.getDefaultSpintaxTemplates();

            const tunnelService = require('./tunnelService');
            const tunnelBase = tunnelService.getStoreUrl() || tunnelService.getAdminUrl() || 'http://localhost:3000';
            let activeAffiliateUrl = rule.affiliate_url || '';
            if (!activeAffiliateUrl || activeAffiliateUrl.includes('paybot.store') || activeAffiliateUrl.includes('paybot.app')) {
              activeAffiliateUrl = `${tunnelBase.replace(/\/+$/, '')}/loja`;
            }

            // Proteção estrita contra disparo de links fictícios ou de teste em grupos reais
            if (this.isDummyAffiliateUrl(activeAffiliateUrl)) {
              console.warn(`[Social Listening 🛡️] Disparo suspenso: Link fictício ou de teste detectado (${activeAffiliateUrl}) para a regra "${rule.product_name}".`);
              continue;
            }

            const formatter = require('../utils/whatsappFormatter');
            const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
            const rawSpintax = models.parseSpintax(randomTemplate, {
              link: activeAffiliateUrl,
              produto: formatter.sanitizeFieldForBold(rule.product_name || ''),
              url: activeAffiliateUrl
            });
            recommendationText = formatter.sanitizeWhatsAppMessage(rawSpintax);

            console.log(`[Social Listening 🎯] Palavra "${matchedKeyword}" detectada no grupo ${groupJid}! Disparando recomendação de "${rule.product_name}" com Spintax resolvido...`);

            // Simula digitação humana
            try {
              if (typeof sock.sendPresenceUpdate === 'function') {
                await sock.sendPresenceUpdate('composing', groupJid);
                if (process.env.NODE_ENV !== 'test') {
                  const delay = Math.min(2500, Math.max(1000, recommendationText.length * 20));
                  await new Promise(resolve => setTimeout(resolve, delay));
                  await sock.sendPresenceUpdate('paused', groupJid);
                }
              }
            } catch (_) {}

            try {
              const sendRes = await sock.sendMessage(groupJid, { text: recommendationText });
              this.groupCooldowns.set(groupJid, Date.now());
              replyTriggered = true;
              if (sendRes?.key?.id) {
                try {
                  const army = require('./whatsappArmyService');
                  army.registerLegitimateDispatchKey(sendRes.key.id);
                  const wb = require('../bots/whatsappBot');
                  if (typeof wb.trackSentBotMessage === 'function') {
                    wb.trackSentBotMessage(sendRes.key.id, groupJid, sock);
                  }
                } catch (_) {}
              }
            } catch (replyErr) {
              console.warn('[Social Listening ⚠️] Erro ao enviar mensagem no grupo:', replyErr.message);
            }
          }
        }
      }

      if (alertTriggered || replyTriggered) {
        models.recordSocialListeningTrigger(rule.id);
        return {
          triggered: true,
          alerted: alertTriggered,
          replied: replyTriggered,
          ruleId: rule.id,
          productName: rule.product_name,
          matchedKeyword,
          sentText: recommendationText,
          actionType
        };
      }
    }
  }

    return false;
  }

  /**
   * Roteador interativo de comandos do WhatsApp (!escuta ...)
   */
  async handleEscutaCommand(sock, from, text = '', senderPhone = '', isOwner = false, isAdmin = false, msg = null) {
    if (!sock || !from) return;

    // Apenas o Dono ou Administradores autorizados têm acesso à Central de Escuta
    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, {
        text: '⚠️ *ACESSO RESTRITO:* Apenas o Dono e Administradores autorizados podem gerenciar a Escuta e Sentinela.'
      });
    }

    const rawArgs = text.replace(/^(?:!|\/)?(?:escuta|social|sociallistening|sentinela|ouvinte)\s*/i, '').trim();
    const parts = rawArgs.split(/\s+/);
    const subCmd = (parts[0] || '').toLowerCase();
    const rest = rawArgs.replace(/^[^\s]+\s*/, '').trim();

    // 1. ATIVAR / LIGAR
    if (subCmd === 'on' || subCmd === 'ligar' || subCmd === 'ativar' || subCmd === 'start') {
      models.setSetting('SOCIAL_LISTENING_ENABLED', 'true');
      return sock.sendMessage(from, {
        text: `🟢 *MOTOR DE ESCUTA E SENTINELA ATIVADO!*\n\nO bot agora monitora ativamente palavras-chave e áudios em todos os grupos autorizados.`
      });
    }

    // 2. PAUSAR / DESLIGAR
    if (subCmd === 'off' || subCmd === 'pausar' || subCmd === 'desativar' || subCmd === 'stop') {
      models.setSetting('SOCIAL_LISTENING_ENABLED', 'false');
      return sock.sendMessage(from, {
        text: `🔴 *MOTOR DE ESCUTA E SENTINELA PAUSADO!*\n\nNenhuma recomendação ou alerta em grupos será disparado até nova ativação com *!escuta on*.`
      });
    }

    // 3. CONTROLE DE ESCUTA DE ÁUDIOS (SPEECH-TO-TEXT)
    if (subCmd === 'audio') {
      const mode = (parts[1] || '').toLowerCase();
      if (mode === 'on' || mode === 'ativar' || mode === 'ligar') {
        models.setSetting('SOCIAL_LISTENING_AUDIO_ENABLED', 'true');
        return sock.sendMessage(from, {
          text: `🎙️ *ESCUTA DE ÁUDIOS EM GRUPOS ATIVADA!*\n\nMensagens de voz nos grupos serão transcritas pela IA e verificadas pelos gatilhos de escuta.`
        });
      } else if (mode === 'off' || mode === 'desativar' || mode === 'pausar') {
        models.setSetting('SOCIAL_LISTENING_AUDIO_ENABLED', 'false');
        return sock.sendMessage(from, {
          text: `🔕 *ESCUTA DE ÁUDIOS EM GRUPOS DESATIVADA!*\n\nO bot analisará apenas mensagens de texto em grupos.`
        });
      }
      const audioStatus = this.isAudioEnabled();
      return sock.sendMessage(from, {
        text: `🎙️ *STATUS DA ESCUTA DE ÁUDIOS:* ${audioStatus ? '🟢 Ativada' : '🔴 Desativada'}\n\nPara alterar: \`!escuta audio on\` ou \`!escuta audio off\`.`
      });
    }

    // 4. CONTROLE DO RADAR SENTINELA & CANAL #SENTINELA
    if (subCmd === 'alerta' || subCmd === 'sentinela' || subCmd === 'radar' || subCmd === 'grupo' || subCmd === 'sentinelagp') {
      const mode = (parts[1] || '').toLowerCase();
      if (mode === 'criar' || mode === 'recriar' || mode === 'regerar' || subCmd === 'sentinelagp') {
        await sock.sendMessage(from, { text: '⏳ *Garantindo/Criando grupo #Sentinela no WhatsApp...*' });
        const res = await this.ensureSentinelGroup(sock, { forceRecreate: true });
        if (res.success) {
          return sock.sendMessage(from, {
            text: `✅ *GRUPO #SENTINELA ATIVADO COM SUCESSO!* 🛡️\n\n` +
                  `• *Grupo:* \`${res.groupJid}\`\n` +
                  (res.inviteUrl ? `• *Link do Grupo:* ${res.inviteUrl}\n` : '') +
                  `\nTodas as mensagens e leads minerados pelo Radar agora serão entregues no grupo, liberando o seu PV!`
          });
        } else {
          return sock.sendMessage(from, {
            text: `❌ Falha ao criar grupo #Sentinela: ${res.error || 'Erro desconhecido'}`
          });
        }
      } else if (mode === 'pv' || mode === 'privado') {
        models.setSetting('RADAR_SENTINELA_FORCE_PV', 'true');
        return sock.sendMessage(from, {
          text: `📱 *ALERTAS REDIRECIONADOS PARA O PRIVADO!*\n\nOs alertas do Radar Sentinela voltarão a ser entregues no seu WhatsApp privado.`
        });
      } else if (mode === 'gp' || mode === 'grupo') {
        models.setSetting('RADAR_SENTINELA_FORCE_PV', 'false');
        const res = await this.ensureSentinelGroup(sock);
        return sock.sendMessage(from, {
          text: `🛡️ *ALERTAS REDIRECIONADOS PARA O GRUPO #SENTINELA!*\n\n` +
                `• *Grupo:* \`${res.groupJid || 'Em sincronização'}\`\n` +
                (res.inviteUrl ? `• *Link:* ${res.inviteUrl}\n` : '') +
                `\nSeu privado não receberá mais notificações automáticas de leads.`
        });
      } else if (mode === 'on' || mode === 'ativar') {
        models.setSetting('SOCIAL_LISTENING_ALERT_ENABLED', 'true');
        return sock.sendMessage(from, {
          text: `🚨 *RADAR SENTINELA ATIVADO!*\n\nVocê receberá alertas instantâneos de novos leads e oportunidades no canal configurado.`
        });
      } else if (mode === 'off' || mode === 'desativar') {
        models.setSetting('SOCIAL_LISTENING_ALERT_ENABLED', 'false');
        return sock.sendMessage(from, {
          text: `🔕 *RADAR SENTINELA PAUSADO!*\n\nNotificações de termos críticos em grupos foram desativadas temporariamente.`
        });
      } else if (mode === 'link' || mode === 'convite') {
        const inviteUrl = models.getSetting('RADAR_SENTINELA_INVITE_URL', '');
        return sock.sendMessage(from, {
          text: inviteUrl 
            ? `🔗 *LINK DE CONVITE DO GRUPO #SENTINELA:*\n${inviteUrl}`
            : `ℹ️ Link de convite ainda não disponível. Use \`!sentinela criar\` para gerar.`
        });
      } else {
        const target = this.getSentinelTargetJid();
        const isGroup = target && target.endsWith('@g.us');
        const inviteUrl = models.getSetting('RADAR_SENTINELA_INVITE_URL', '');
        return sock.sendMessage(from, {
          text: `🛡️ *STATUS DO RADAR SENTINELA* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `• *Status:* ${this.isAlertEnabled() ? '🟢 Ativo' : '🔴 Pausado'}\n` +
                `• *Destino:* ${isGroup ? `Grupo #Sentinela (\`${target}\`)` : `Privado (+${target?.split('@')[0]})`}\n` +
                (inviteUrl ? `• *Link:* ${inviteUrl}\n` : '') +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚙️ *Comandos Rápidos:*\n` +
                `• \`!sentinela criar\` — Cria ou reconecta o grupo #Sentinela\n` +
                `• \`!sentinela grupo\` — Direciona alertas para o grupo\n` +
                `• \`!sentinela pv\` — Direciona alertas para seu privado\n` +
                `• \`!sentinela link\` — Exibe link de convite do grupo\n` +
                `• \`!sentinela on / off\` — Liga ou pausa as notificações`
        });
      }
    }

    // 5. COOLDOWN ENTRE DISPAROS
    if (subCmd === 'cooldown' || subCmd === 'tempo' || subCmd === 'delay') {
      const minutes = parseInt(parts[1], 10);
      if (isNaN(minutes) || minutes < 1) {
        return sock.sendMessage(from, {
          text: `⏱️ *Cooldown Atual:* ${this.getCooldownMinutes()} minutos por grupo.\n\nPara alterar: \`!escuta cooldown <minutos>\` (ex: \`!escuta cooldown 20\`).`
        });
      }
      models.setSetting('SOCIAL_LISTENING_COOLDOWN_MIN', String(minutes));
      return sock.sendMessage(from, {
        text: `⏱️ *COOLDOWN ATUALIZADO!*\n\nNovo intervalo mínimo entre recomendações no mesmo grupo: *${minutes} minutos*.`
      });
    }

    // 6. ADIÇÃO EM MASSA / IMPORTAÇÃO (LOTE, ARQUIVO OU MÚLTIPLAS LINHAS)
    if (subCmd === 'lote' || subCmd === 'importar' || subCmd === 'import' || subCmd === 'addlote' || ((subCmd === 'add' || subCmd === 'nova') && rest.includes('\n'))) {
      let contentToImport = '';

      // A) Verifica se foi enviado um arquivo no comando ou respondido no chat
      if (msg) {
        try {
          const docBuffer = await this.extractDocumentBuffer(msg);
          if (docBuffer && docBuffer.length > 0) {
            contentToImport = docBuffer.toString('utf-8');
            console.log(`[Escuta 📥] Arquivo recebido para importação (${docBuffer.length} bytes)`);
          }
        } catch (docErr) {
          console.warn('[Escuta ⚠️] Erro ao baixar arquivo de regras:', docErr.message);
        }

        // B) Se não veio arquivo binário, verifica se o usuário respondeu/citou uma mensagem de texto longa
        if (!contentToImport) {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const quotedText = msg.quoted?.text ||
                             quoted?.conversation ||
                             quoted?.extendedTextMessage?.text ||
                             quoted?.documentMessage?.caption ||
                             '';
          if (quotedText && (quotedText.includes('|') || quotedText.includes(';') || quotedText.includes('\n') || quotedText.includes('{'))) {
            contentToImport = quotedText;
          }
        }
      }

      // C) Se não veio de arquivo nem citação, pega o corpo de texto digitado no comando
      if (!contentToImport && rest && (rest.includes('\n') || rest.includes('|') || rest.includes(';') || rest.includes('{'))) {
        contentToImport = rest;
      }

      if (!contentToImport || !contentToImport.trim()) {
        return sock.sendMessage(from, {
          text: `📥 *IMPORTAÇÃO DE REGRAS EM MASSA (!escuta lote)*\n\n` +
            `Você pode importar dezenas ou centenas de regras de 3 maneiras:\n\n` +
            `1️⃣ *Por Texto com Múltiplas Linhas:*\n` +
            `\`!escuta lote\`\n` +
            `\`Chapinha Titanium | lizze, prancha | https://link1 | Amei: {link}\`\n` +
            `\`Secador Turbo | secador, escova | https://link2 | Uso no salão: {link}\`\n` +
            `\`[sentinela] Oportunidades | comprar bot, quanto custa, pix\`\n\n` +
            `2️⃣ *Enviando Arquivo (.txt, .csv, .json):*\n` +
            `Envie um arquivo como Documento no WhatsApp com a legenda:\n` +
            `\`!escuta lote\`\n\n` +
            `3️⃣ *Respondendo um Arquivo ou Lista:*\n` +
            `Responda (cite) a qualquer arquivo ou texto de regras no chat com:\n` +
            `\`!escuta lote\``
        });
      }

      const res = this.bulkImportRules(contentToImport);
      const errorsSnippet = res.errors.length > 0
        ? `\n\n⚠️ *Avisos / Linhas Ignoradas (${res.errors.length}):*\n` + res.errors.slice(0, 5).map(e => `• ${e}`).join('\n') + (res.errors.length > 5 ? `\n_...e mais ${res.errors.length - 5} linhas ignoradas._` : '')
        : '';

      return sock.sendMessage(from, {
        text: `📥 *IMPORTAÇÃO EM MASSA CONCLUÍDA!* 🎉\n\n` +
          `• Total de Linhas/Itens Analisados: *${res.total}*\n` +
          `• Regras Cadastradas com Sucesso: 🟢 *${res.added}*\n` +
          `   ├ 🛍️ Afiliados (Stealth): *${res.affiliateCount}*\n` +
          `   └ 🚨 Sentinela (Alertas PV): *${res.sentinelCount}*` +
          errorsSnippet +
          `\n\n_Envie *!escuta list* para visualizar todo o catálogo ativo._`
      });
    }

    // 7. ADICIONAR REGRA ÚNICA DE AFILIADO
    // Formato: !escuta add <Produto> | <gatilhos> | <link> [| <frase>]
    if (subCmd === 'add' || subCmd === 'nova' || subCmd === 'criar') {
      const pipeParts = rest.split('|').map(p => p.trim());
      if (pipeParts.length < 3) {
        return sock.sendMessage(from, {
          text: `⚠️ *FORMATO INVÁLIDO!*\n\nUso para Social Listening de Afiliado:\n\`!escuta add <Produto> | <gatilhos separados por vírgula> | <link de afiliado> [| <frase com {link}>]\`\n\n*Exemplo:*\n\`!escuta add Prancha Titanium | lizze, chapinha, prancha | https://shopee.com/prancha | Menina, comprei essa aqui e recomendo demais: {link}\`\n\n💡 _Para adicionar várias regras de uma vez, envie cada uma em uma linha com \`!escuta lote\`._`
        });
      }

      const productName = pipeParts[0];
      const keywords = pipeParts[1];
      const affiliateUrl = pipeParts[2];
      const customTemplate = pipeParts[3];

      try {
        const saved = models.saveSocialListeningRule({
          product_name: productName,
          keywords,
          affiliate_url: affiliateUrl,
          templates: customTemplate ? [customTemplate] : this.getDefaultSpintaxTemplates(),
          action_type: 'REPLY',
          active: true,
          cooldown_minutes: this.getCooldownMinutes()
        });

        return sock.sendMessage(from, {
          text: `✅ *NOVA REGRA DE SOCIAL LISTENING CADASTRADA!*\n\n` +
            `• *ID:* \`#${saved.id}\`\n` +
            `• *Produto:* ${saved.product_name}\n` +
            `• *Gatilhos:* \`${saved.keywords}\`\n` +
            `• *Link:* ${saved.affiliate_url}\n` +
            `• *Ação:* 🛍️ Recomendação Stealth no Grupo\n` +
            `• *Status:* 🟢 Ativa`
        });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ *Erro ao salvar regra:* ${err.message}` });
      }
    }

    // 8. ADICIONAR REGRA SENTINELA (ALERTA NO PV)
    // Formato: !escuta sentinela <Nome da Regra> | <gatilhos separados por vírgula>
    if (subCmd === 'sentinelaadd' || (subCmd === 'sentinela' && rest.includes('|')) || (subCmd === 'radar' && rest.includes('|'))) {
      const pipeParts = (subCmd === 'sentinela' || subCmd === 'radar' ? rest : rawArgs.replace(/^[^\s]+\s*/, '')).split('|').map(p => p.trim());
      if (pipeParts.length < 2) {
        return sock.sendMessage(from, {
          text: `⚠️ *FORMATO INVÁLIDO!*\n\nUso para Alerta Sentinela no PV:\n\`!escuta sentinela <Nome da Regra> | <gatilhos separados por vírgula>\`\n\n*Exemplo:*\n\`!escuta sentinela Oportunidade Vendas | quero comprar, preco, quanto custa, pix\``
        });
      }

      const ruleName = pipeParts[0];
      const keywords = pipeParts[1];

      try {
        const saved = models.saveSocialListeningRule({
          product_name: ruleName,
          keywords,
          affiliate_url: '',
          templates: [],
          action_type: 'ALERT',
          active: true,
          cooldown_minutes: 5
        });

        return sock.sendMessage(from, {
          text: `🚨 *NOVA REGRA SENTINELA CADASTRADA!*\n\n` +
            `• *ID:* \`#${saved.id}\`\n` +
            `• *Regra:* ${saved.product_name}\n` +
            `• *Gatilhos de Monitoramento:* \`${saved.keywords}\`\n` +
            `• *Ação:* 📲 Alerta Imediato no seu WhatsApp Privado\n` +
            `• *Status:* 🟢 Ativa`
        });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ *Erro ao salvar sentinela:* ${err.message}` });
      }
    }

    // 9. EXCLUIR REGRA
    if (subCmd === 'del' || subCmd === 'rm' || subCmd === 'remover' || subCmd === 'delete') {
      const id = parseInt(parts[1], 10);
      if (isNaN(id)) {
        return sock.sendMessage(from, { text: `⚠️ Forneça o ID da regra. Exemplo: \`!escuta del 3\`` });
      }
      const existing = models.getSocialListeningRule(id);
      if (!existing) {
        return sock.sendMessage(from, { text: `❌ Regra #${id} não encontrada.` });
      }
      models.deleteSocialListeningRule(id);
      return sock.sendMessage(from, { text: `🗑️ *Regra #${id} (${existing.product_name}) removida com sucesso!*` });
    }

    // 10. PAUSAR / ATIVAR REGRA INDIVIDUAL (TOGGLE)
    if (subCmd === 'toggle' || subCmd === 'pausarregra' || subCmd === 'ativarregra') {
      const id = parseInt(parts[1], 10);
      if (isNaN(id)) {
        return sock.sendMessage(from, { text: `⚠️ Forneça o ID da regra. Exemplo: \`!escuta toggle 2\`` });
      }
      const updated = models.toggleSocialListeningRule(id);
      if (!updated) {
        return sock.sendMessage(from, { text: `❌ Regra #${id} não encontrada.` });
      }
      return sock.sendMessage(from, {
        text: `🔄 *Regra #${id} (${updated.product_name}) atualizada:*\nNovo status: ${updated.active ? '🟢 Ativa' : '⚪ Pausada'}`
      });
    }

    // 11. DETALHES DE UMA REGRA
    if (subCmd === 'ver' || subCmd === 'info') {
      const id = parseInt(parts[1], 10);
      if (isNaN(id)) {
        return sock.sendMessage(from, { text: `⚠️ Forneça o ID da regra. Exemplo: \`!escuta ver 1\`` });
      }
      const r = models.getSocialListeningRule(id);
      if (!r) {
        return sock.sendMessage(from, { text: `❌ Regra #${id} não encontrada.` });
      }
      const templatesList = (r.templates || []).map((t, idx) => `   ${idx + 1}. "${t}"`).join('\n') || 'Nenhum';
      return sock.sendMessage(from, {
        text: `🔎 *DETALHES DA REGRA #${r.id}*\n\n` +
          `• *Nome:* ${r.product_name}\n` +
          `• *Tipo:* ${r.action_type === 'ALERT' ? '🚨 Alerta Sentinela no PV' : '🛍️ Recomendação Stealth de Afiliado'}\n` +
          `• *Status:* ${r.active ? '🟢 Ativa' : '⚪ Pausada'}\n` +
          `• *Gatilhos:* \`${r.keywords}\`\n` +
          `• *Link:* ${r.affiliate_url || 'N/A'}\n` +
          `• *Disparos Acumulados:* ${r.triggered_count || 0}\n` +
          `• *Último Disparo:* ${r.last_triggered_at || 'Nunca'}\n\n` +
          `📝 *Frases Cadastradas:*\n${templatesList}`
      });
    }

    // 12. LISTAR TODAS AS REGRAS
    if (subCmd === 'list' || subCmd === 'listar' || subCmd === 'regras' || subCmd === 'todas') {
      const rules = models.listSocialListeningRules(false);
      if (!rules || rules.length === 0) {
        return sock.sendMessage(from, {
          text: `📋 *NENHUMA REGRA CADASTRADA AINDA!*\n\nCrie a primeira regra com:\n\`!escuta add <Produto> | <gatilhos> | <link>\` ou\n\`!escuta lote\` para adicionar várias de uma vez.`
        });
      }

      let listTxt = `📋 *CATÁLOGO COMPLETO DE ESCUTA (${rules.length} REGRAS)*\n\n`;
      rules.forEach(r => {
        const typeIcon = r.action_type === 'ALERT' ? '🚨 [SENTINELA]' : '🛍️ [AFILIADO]';
        const statusIcon = r.active ? '🟢' : '⚪';
        listTxt += `*#${r.id} ${typeIcon}* ${r.product_name} (${statusIcon})\n` +
          `  • Gatilhos: \`${r.keywords.slice(0, 70)}${r.keywords.length > 70 ? '...' : ''}\`\n` +
          `  • Disparos: ${r.triggered_count || 0}x\n\n`;
      });
      listTxt += `_Para ver detalhes de uma regra: *!escuta ver <id>*_`;
      return sock.sendMessage(from, { text: listTxt });
    }

    // 13. SIMULAR / TESTAR UMA FRASE
    if (subCmd === 'teste' || subCmd === 'test' || subCmd === 'simular') {
      const sampleText = rest;
      if (!sampleText) {
        return sock.sendMessage(from, {
          text: `🧪 *SIMULADOR DE ESCUTA*\n\nUso: \`!escuta teste <mensagem a ser testada>\`\nExemplo: \`!escuta teste Meninas, onde acho uma boa chapinha?\``
        });
      }

      const normalized = this.normalizeText(sampleText);
      const activeRules = models.listSocialListeningRules(true);
      let matchFound = null;
      let matchedWord = null;

      for (const r of activeRules) {
        const keywords = r.keywords.split(',').map(k => this.normalizeText(k)).filter(Boolean);
        const hit = keywords.find(kw => normalized.includes(kw));
        if (hit) {
          matchFound = r;
          matchedWord = hit;
          break;
        }
      }

      if (!matchFound) {
        return sock.sendMessage(from, {
          text: `🧪 *RESULTADO DO TESTE:*\n\n❌ Nenhuma regra ativa deu match para a frase:\n"${sampleText}"\n\n_Dica: Adicione novas palavras-chave nas suas regras com *!escuta add* ou *!escuta lote*._`
        });
      }

      const action = (matchFound.action_type || 'REPLY').toUpperCase();
      let outcome = '';
      if (action === 'ALERT') {
        outcome = `🚨 *AÇÃO: Alerta Sentinela Confidencial*\nO bot enviaria um alerta privado para o seu WhatsApp com os dados do lead, sem falar nada no grupo.`;
      } else {
        const tpls = matchFound.templates && matchFound.templates.length > 0 ? matchFound.templates : ['{link}'];
        const sampleReply = tpls[0]
          .replace(/\{link\}/gi, matchFound.affiliate_url)
          .replace(/\{produto\}/gi, matchFound.product_name);
        outcome = `🛍️ *AÇÃO: Recomendação Stealth no Grupo*\nO bot responderia no grupo com:\n"${sampleReply}"`;
      }

      return sock.sendMessage(from, {
        text: `🧪 *RESULTADO DO TESTE (MATCH ENCONTRADO!):*\n\n` +
          `• *Regra Disparada:* #${matchFound.id} - *${matchFound.product_name}*\n` +
          `• *Gatilho Acionado:* \`${matchedWord}\`\n` +
          `• *Tipo:* ${action}\n\n` +
          outcome
      });
    }

    // 14. RESETAR COOLDOWNS MANUALMENTE
    if (subCmd === 'reset' || subCmd === 'resetcooldown') {
      this.resetCooldown();
      return sock.sendMessage(from, {
        text: `🔄 *TODOS OS COOLDOWNS DE GRUPOS E ALERTAS FORAM RESETADOS!*`
      });
    }

    // 15. COCKPIT PRINCIPAL (DASHBOARD EXECUTIVO DA ESCUTA)
    const rules = models.listSocialListeningRules(false);
    const isGlobal = this.isEnabled();
    const isAudio = this.isAudioEnabled();
    const isAlert = this.isAlertEnabled();
    const cooldown = this.getCooldownMinutes();

    const affiliateCount = rules.filter(r => (r.action_type || 'REPLY') !== 'ALERT').length;
    const sentinelCount = rules.filter(r => (r.action_type || 'REPLY') === 'ALERT').length;
    const totalTriggers = rules.reduce((acc, r) => acc + (r.triggered_count || 0), 0);

    let cockpit =
      `╭━━━〔 🎧 *CENTRAL DE COMANDO DA ESCUTA & SENTINELA* 〕━━━⬣\n` +
      `┃\n` +
      `┃ 📊 *Status Operacional:*\n` +
      `┃ 🔹 Motor Global: ${isGlobal ? '🟢 *Ativo*' : '🔴 *Pausado*'}\n` +
      `┃ 🔹 Escuta de Áudios (IA): ${isAudio ? '🎙️ *Ativado*' : '🔕 *Pausado*'}\n` +
      `┃ 🔹 Radar Sentinela (PV): ${isAlert ? '🚨 *Ativado*' : '🔕 *Pausado*'}\n` +
      `┃ 🔹 Cooldown de Grupo: ⏱️ *${cooldown} minutos*\n` +
      `┃ 🔹 Regras Totais: 📋 *${rules.length}* (${affiliateCount} Afiliados / ${sentinelCount} Sentinelas)\n` +
      `┃ 🔹 Total de Disparos: 🎯 *${totalTriggers} eventos*\n` +
      `┃\n` +
      `┃ 📋 *Regras em Destaque:*\n`;

    rules.slice(0, 4).forEach((r, idx) => {
      const typeTag = r.action_type === 'ALERT' ? '🚨 [SENTINELA]' : '🛍️ [AFILIADO]';
      cockpit += `┃ ${idx + 1}. *#${r.id} ${typeTag}* ${r.product_name} (${r.active ? '🟢' : '⚪'})\n` +
        `┃    Gatilhos: \`${r.keywords.slice(0, 40)}${r.keywords.length > 40 ? '...' : ''}\`\n`;
    });

    cockpit +=
      `┃\n` +
      `┃ ⚡ *Subcomandos Rápidos:*\n` +
      `┃ 🔹 \`!escuta on\` / \`off\` — Ligar/pausar motor global\n` +
      `┃ 🔹 \`!escuta lote <linhas|arquivo>\` — Importação em massa de regras\n` +
      `┃ 🔹 \`!escuta audio on\` / \`off\` — Ligar/pausar escuta de áudios\n` +
      `┃ 🔹 \`!escuta alerta on\` / \`off\` — Ligar/pausar radar no PV\n` +
      `┃ 🔹 \`!escuta add <Prod> | <gatilhos> | <link> [| <frase>]\`\n` +
      `┃ 🔹 \`!escuta sentinela <Nome> | <gatilhos>\` — Alerta no PV\n` +
      `┃ 🔹 \`!escuta del <id>\` / \`!escuta toggle <id>\`\n` +
      `┃ 🔹 \`!escuta list\` — Listar todas as regras detalhadas\n` +
      `┃ 🔹 \`!escuta ver <id>\` — Inspecionar regra específica\n` +
      `┃ 🔹 \`!escuta teste <frase>\` — Simular gatilho ao vivo\n` +
      `┃ 🔹 \`!escuta cooldown <min>\` — Alterar tempo de resfriamento\n` +
      `┃ 🔹 \`!escuta reset\` — Zerar cooldown dos grupos\n` +
      `┃ 🔹 \`!aquecimento\` — Central de Diálogos entre Sub-Bots (Máx 9 msgs/24h)\n` +
      `┃\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣\n` +
      `💡 _Dica: Quando 2+ sub-bots estiverem no grupo, eles dialogam entre si com o \`!aquecimento\` (3 fluxos inteligentes)._`;

    return sock.sendMessage(from, { text: cockpit });
  }

  /**
   * Limpeza periódica de memória RAM para evitar vazamentos em processos de longa duração
   */
  cleanupMemory() {
    try {
      const now = Date.now();
      // 1. Purga cooldowns de alerta mais velhos que 30 minutos
      for (const [key, ts] of this.alertCooldowns.entries()) {
        if (now - ts > 30 * 60 * 1000) {
          this.alertCooldowns.delete(key);
        }
      }
      // 2. Purga cooldowns de grupo mais velhos que 2 horas
      for (const [groupJid, ts] of this.groupCooldowns.entries()) {
        if (now - ts > 2 * 60 * 60 * 1000) {
          this.groupCooldowns.delete(groupJid);
        }
      }
      // 3. Purga cache de nomes de grupo mais velhos que 6 horas
      for (const [groupJid, item] of this.groupMetaCache.entries()) {
        if (!item || (now - (item.timestamp || 0) > 6 * 60 * 60 * 1000)) {
          this.groupMetaCache.delete(groupJid);
        }
      }
      // Se ainda exceder 500 grupos, descarta os mais antigos (FIFO)
      if (this.groupMetaCache.size > 500) {
        const excess = this.groupMetaCache.size - 500;
        let count = 0;
        for (const key of this.groupMetaCache.keys()) {
          if (count++ >= excess) break;
          this.groupMetaCache.delete(key);
        }
      }
    } catch (_) {}
  }
}

module.exports = new SocialListeningService();

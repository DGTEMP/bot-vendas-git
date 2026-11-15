/**
 * ProfilePictureService
 * Motor Avançado de Gestão e Atualização de Fotos de Perfil e Capas
 *
 * Permite alterar e ajustar as imagens de:
 * 1. Bots Principais (Bot Master)
 * 2. Sub-Bots (Chips do Exército / Bots de Suporte)
 * 3. Grupos do WhatsApp (@g.us)
 * 4. Canais / Newsletters Oficiais (@newsletter)
 *
 * Suporta imagens enviadas como anexo (legenda), respondidas (citação) ou links diretos (URL).
 * Otimiza e enquadra automaticamente via sharp (640x640 JPEG alta fidelidade).
 */

const sharp = require('sharp');
const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const models = require('../db/models');

class ProfilePictureService {
  constructor() {
    this.defaultSize = 640;
    this.jpegQuality = 85;
  }

  /**
   * Otimiza e enquadra o buffer da imagem para o padrão oficial do WhatsApp (640x640 JPEG)
   */
  async optimizeProfileImage(inputBuffer) {
    if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
      throw new Error('Buffer de imagem inválido ou vazio.');
    }

    try {
      const processed = await sharp(inputBuffer)
        .resize(this.defaultSize, this.defaultSize, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({
          quality: this.jpegQuality,
          chromaSubsampling: '4:4:4'
        })
        .toBuffer();

      return processed;
    } catch (err) {
      throw new Error(`Falha no processamento da imagem via sharp: ${err.message}`);
    }
  }

  /**
   * Extrai o buffer de imagem de diferentes origens (anexo, citação, URL ou buffer prévio)
   */
  async extractImageBuffer(msg, text = '', from = '', customBuffer = null) {
    // 1. Buffer direto fornecido
    if (Buffer.isBuffer(customBuffer) && customBuffer.length > 0) {
      return customBuffer;
    }

    // 2. Buffer pré-armazenado no objeto de mensagem
    if (msg?._imageBuffer && Buffer.isBuffer(msg._imageBuffer)) {
      return msg._imageBuffer;
    }
    if (msg?._mediaBuffer && Buffer.isBuffer(msg._mediaBuffer)) {
      return msg._mediaBuffer;
    }

    // 3. Imagem enviada diretamente na mensagem (com legenda)
    const directImage = msg?.message?.imageMessage ||
                        msg?.message?.documentWithCaptionMessage?.message?.imageMessage ||
                        msg?.message?.viewOnceMessage?.message?.imageMessage ||
                        msg?.message?.viewOnceMessageV2?.message?.imageMessage;

    if (directImage) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        if (buffer && buffer.length > 0) return buffer;
      } catch (err) {
        console.warn('[ProfilePictureService] Falha ao baixar anexo direto:', err.message);
      }
    }

    // 4. Imagem citada / respondida (quoted message)
    const contextInfo = msg?.message?.extendedTextMessage?.contextInfo ||
                        msg?.message?.imageMessage?.contextInfo ||
                        msg?.message?.videoMessage?.contextInfo;

    const quoted = contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage ||
                        quoted?.documentWithCaptionMessage?.message?.imageMessage ||
                        quoted?.viewOnceMessage?.message?.imageMessage ||
                        quoted?.viewOnceMessageV2?.message?.imageMessage ||
                        (quoted?.documentMessage?.mimetype?.startsWith('image/') ? quoted.documentMessage : null);

    if (quotedImage) {
      try {
        const fakeQuotedMsg = {
          key: {
            remoteJid: from || msg?.key?.remoteJid,
            id: contextInfo?.stanzaId || 'fake-id',
            participant: contextInfo?.participant
          },
          message: quoted
        };
        const buffer = await downloadMediaMessage(fakeQuotedMsg, 'buffer', {});
        if (buffer && buffer.length > 0) return buffer;
      } catch (err) {
        console.warn('[ProfilePictureService] Falha ao baixar imagem citada:', err.message);
      }
    }

    // 5. URL no texto da mensagem
    const urlMatch = text.match(/https?:\/\/[^\s<>"]+/i);
    if (urlMatch) {
      const url = urlMatch[0];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)/i.test(url)) {
            const arrayBuf = await resp.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            if (buffer.length > 0) return buffer;
          }
        }
      } catch (err) {
        console.warn('[ProfilePictureService] Falha ao baixar imagem da URL:', err.message);
      }
    }

    return null;
  }

  /**
   * Atualiza a foto de perfil do Bot (Master ou bot ativo)
   */
  async updateBotProfilePicture(targetSock, rawBuffer) {
    if (!targetSock) throw new Error('Socket do bot indisponível ou offline.');
    const processed = await this.optimizeProfileImage(rawBuffer);

    const botJid = targetSock.user?.id ? jidNormalizedUser(targetSock.user.id) : null;
    if (!botJid) throw new Error('Não foi possível identificar o JID do bot conectado.');

    if (typeof targetSock.updateProfilePicture !== 'function') {
      throw new Error('Método updateProfilePicture não suportado pelo socket.');
    }

    await targetSock.updateProfilePicture(botJid, processed);

    const cleanPhone = botJid.split('@')[0].split(':')[0];
    return {
      success: true,
      target: 'bot',
      jid: botJid,
      phone: cleanPhone,
      instanceId: targetSock.instanceId || null,
      isSubBot: !!targetSock.instanceId
    };
  }

  /**
   * Atualiza a foto de perfil de um Sub-Bot específico ou de todos os Sub-Bots conectados
   */
  async updateSubBotProfilePicture(instanceIdOrTarget = null, rawBuffer, fallbackSock = null) {
    const whatsappArmyService = require('./whatsappArmyService');
    const processed = await this.optimizeProfileImage(rawBuffer);

    // Caso 1: 'all' ou 'todos' -> atualiza a frota inteira de sub-bots online
    const targetStr = String(instanceIdOrTarget || '').toLowerCase().trim();
    if (targetStr === 'all' || targetStr === 'todos' || targetStr === 'frota') {
      const activeSockets = whatsappArmyService.activeSockets;
      if (!activeSockets || activeSockets.size === 0) {
        throw new Error('Nenhum sub-bot (chip da frota) está online no momento.');
      }

      const results = [];
      for (const [id, subSock] of activeSockets.entries()) {
        try {
          const subJid = subSock.user?.id ? jidNormalizedUser(subSock.user.id) : null;
          if (subJid && typeof subSock.updateProfilePicture === 'function') {
            await subSock.updateProfilePicture(subJid, processed);
            results.push({ instanceId: id, jid: subJid, success: true });
          }
        } catch (err) {
          results.push({ instanceId: id, success: false, error: err.message });
        }
      }

      return {
        success: results.some(r => r.success),
        target: 'subbot_fleet',
        total: activeSockets.size,
        updated: results.filter(r => r.success).length,
        details: results
      };
    }

    // Caso 2: Se não passou ID e o comando veio diretamente de um socket de sub-bot
    let targetInstanceId = Number(instanceIdOrTarget);
    if (!targetInstanceId && fallbackSock && fallbackSock.instanceId) {
      targetInstanceId = Number(fallbackSock.instanceId);
    }

    // Se o usuário passou um número de telefone em vez de ID (ex: 5511999990000)
    if (!targetInstanceId && instanceIdOrTarget) {
      const cleanDigits = String(instanceIdOrTarget).replace(/\D/g, '');
      if (cleanDigits.length >= 8) {
        const inst = models.getArmyInstances().find(i => i.phone && i.phone.includes(cleanDigits));
        if (inst) targetInstanceId = inst.id;
      }
    }

    if (!targetInstanceId) {
      throw new Error('Informe o ID ou número do sub-bot (ex: !fotosubbot 2 ou !fotosubbot all).');
    }

    const subSock = whatsappArmyService.activeSockets.get(targetInstanceId);
    if (!subSock) {
      const instData = models.getArmyInstanceById(targetInstanceId);
      const name = instData ? `"${instData.name}" (#${targetInstanceId})` : `#${targetInstanceId}`;
      throw new Error(`Sub-Bot ${name} está desconectado ou offline. Conecte-o primeiro.`);
    }

    const subJid = subSock.user?.id ? jidNormalizedUser(subSock.user.id) : null;
    if (!subJid) throw new Error(`Não foi possível obter o JID do Sub-Bot #${targetInstanceId}.`);

    await subSock.updateProfilePicture(subJid, processed);

    const instData = models.getArmyInstanceById(targetInstanceId);
    return {
      success: true,
      target: 'subbot',
      instanceId: targetInstanceId,
      name: instData?.name || `Sub-Bot #${targetInstanceId}`,
      phone: instData?.phone || subJid.split('@')[0]
    };
  }

  /**
   * Atualiza a foto / ícone de um Grupo do WhatsApp (@g.us)
   */
  async updateGroupPicture(groupJidOrLink, rawBuffer, dispatchSock = null) {
    const whatsappBot = require('../bots/whatsappBot');
    const processed = await this.optimizeProfileImage(rawBuffer);

    const activeSock = dispatchSock || whatsappBot.sock;
    if (!activeSock) throw new Error('Conexão do bot indisponível para atualizar o grupo.');

    let groupJid = String(groupJidOrLink || '').trim();

    // Se for link de convite (chat.whatsapp.com/...)
    const inviteMatch = groupJid.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
    if (inviteMatch) {
      const code = inviteMatch[1];
      if (typeof activeSock.groupGetInviteInfo === 'function') {
        try {
          const info = await activeSock.groupGetInviteInfo(code);
          if (info && info.id) {
            groupJid = info.id.includes('@') ? info.id : `${info.id}@g.us`;
          }
        } catch (_) {}
      }
    }

    if (!groupJid.endsWith('@g.us')) {
      throw new Error('JID de grupo inválido. Envie o comando dentro do grupo ou informe o link/JID.');
    }

    if (typeof activeSock.updateProfilePicture !== 'function') {
      throw new Error('Método updateProfilePicture não suportado pelo socket.');
    }

    await activeSock.updateProfilePicture(groupJid, processed);

    // Registra ação de auditoria no banco
    try {
      models.logGroupAdminAction({
        platform: 'whatsapp',
        groupId: groupJid,
        adminId: activeSock.user?.id ? jidNormalizedUser(activeSock.user.id) : 'SYSTEM',
        adminName: 'ProfilePictureService',
        action: 'UPDATE_PHOTO',
        details: 'Foto de perfil do grupo atualizada com sucesso'
      });
    } catch (_) {}

    return {
      success: true,
      target: 'group',
      groupJid
    };
  }

  /**
   * Atualiza a foto / ícone de um Canal / Newsletter oficial (@newsletter)
   */
  async updateChannelPicture(channelJidOrLink, rawBuffer, dispatchSock = null) {
    const whatsappBot = require('../bots/whatsappBot');
    const processed = await this.optimizeProfileImage(rawBuffer);

    const activeSock = dispatchSock || whatsappBot.sock;
    if (!activeSock) throw new Error('Conexão do bot indisponível para atualizar o canal.');

    let channelJid = String(channelJidOrLink || '').trim();

    // Se não passou JID, busca o canal oficial de achadinhos cadastrado no sistema
    if (!channelJid || !channelJid.includes('@')) {
      const channels = typeof models.getAchadinhosChannels === 'function' ? models.getAchadinhosChannels() : [];
      const officialChannel = channels.find(c => c.channel_type === 'channel' && c.active === 1) ||
                              channels.find(c => c.channel_type === 'channel') ||
                              channels.find(c => c.target_jid && c.target_jid.endsWith('@newsletter'));
      if (officialChannel && officialChannel.target_jid) {
        channelJid = officialChannel.target_jid;
      }
    }

    // Se for link de canal (whatsapp.com/channel/...)
    const channelLinkMatch = channelJid.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
    if (channelLinkMatch) {
      const code = channelLinkMatch[1];
      if (typeof activeSock.newsletterMetadata === 'function') {
        try {
          const meta = await activeSock.newsletterMetadata('invite', code);
          if (meta && meta.id) {
            channelJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
          }
        } catch (_) {}
      }
    }

    if (!channelJid.endsWith('@newsletter')) {
      throw new Error('JID de canal (@newsletter) inválido. Cadastre o canal no sistema ou informe o JID/link.');
    }

    // Baileys usa newsletterUpdatePicture para newsletters
    if (typeof activeSock.newsletterUpdatePicture === 'function') {
      await activeSock.newsletterUpdatePicture(channelJid, processed);
    } else if (typeof activeSock.updateProfilePicture === 'function') {
      await activeSock.updateProfilePicture(channelJid, processed);
    } else {
      throw new Error('Socket não suporta atualização de foto de canal.');
    }

    return {
      success: true,
      target: 'channel',
      channelJid
    };
  }

  /**
   * Remove a foto de perfil (reseta para o avatar padrão)
   */
  async removePicture(targetType, targetId = null, dispatchSock = null) {
    const whatsappBot = require('../bots/whatsappBot');
    const whatsappArmyService = require('./whatsappArmyService');
    const activeSock = dispatchSock || whatsappBot.sock;

    const t = String(targetType || '').toLowerCase().trim();

    if (t === 'bot' || t === 'master') {
      const jid = activeSock.user?.id ? jidNormalizedUser(activeSock.user.id) : null;
      if (!jid) throw new Error('Não foi possível identificar o bot.');
      await activeSock.removeProfilePicture(jid);
      return { success: true, target: 'bot', jid };
    }

    if (t === 'subbot') {
      const instId = Number(targetId) || (dispatchSock && dispatchSock.instanceId);
      if (!instId) throw new Error('Informe o ID do sub-bot para remover a foto.');
      const subSock = whatsappArmyService.activeSockets.get(instId);
      if (!subSock) throw new Error(`Sub-bot #${instId} está offline.`);
      const jid = subSock.user?.id ? jidNormalizedUser(subSock.user.id) : null;
      await subSock.removeProfilePicture(jid);
      return { success: true, target: 'subbot', instanceId: instId, jid };
    }

    if (t === 'group' || t === 'grupo') {
      const groupJid = targetId;
      if (!groupJid || !groupJid.endsWith('@g.us')) throw new Error('JID do grupo inválido.');
      await activeSock.removeProfilePicture(groupJid);
      return { success: true, target: 'group', groupJid };
    }

    if (t === 'channel' || t === 'canal') {
      const channelJid = targetId;
      if (!channelJid || !channelJid.endsWith('@newsletter')) throw new Error('JID do canal inválido.');
      if (typeof activeSock.newsletterRemovePicture === 'function') {
        await activeSock.newsletterRemovePicture(channelJid);
      } else {
        await activeSock.removeProfilePicture(channelJid);
      }
      return { success: true, target: 'channel', channelJid };
    }

    throw new Error('Tipo de alvo inválido. Use bot, subbot, grupo ou canal.');
  }

  /**
   * Processador unificado de comandos de ajuste de fotos via WhatsApp
   */
  async handleProfilePictureCommand({ sock, from, text, msg, senderPhone, isGroup, isOwnerUser, isAdmin }) {
    const rawText = String(text || '').trim();
    const lower = rawText.toLowerCase();

    // 1. Menu de Ajuda de Fotos: !ajudafoto / !fotomenu / !setfoto (sem argumentos)
    if (/^(?:!|\/)(?:ajudafoto|fotomenu|fotohelp|fotoshelp)$/i.test(lower) || /^(?:!|\/)setfoto\s*$/i.test(lower)) {
      const isSubBotSocket = !!sock.instanceId;
      const helpMsg =
        `📸 *CENTRAL DE GESTÃO DE IMAGENS & AVATARES* 🖼️\n\n` +
        `Você pode alterar as fotos de perfil de *Bots, Sub-Bots, Grupos e Canais* com facilidade!\n\n` +
        `💡 *Como enviar a imagem:*\n` +
        `• *Opção 1:* Anexe uma foto no WhatsApp e digite o comando na *legenda*.\n` +
        `• *Opção 2:* *Responda (cite)* uma foto já enviada com o comando.\n` +
        `• *Opção 3:* Digite o comando seguido do link da imagem (URL).\n\n` +
        `⚙️ *Comandos Disponíveis:*\n` +
        `🤖 *1. Bots & Sub-Bots (Apenas Dono):*\n` +
        `• *!fotobot* — Altera a foto deste bot (${isSubBotSocket ? `Sub-Bot #${sock.instanceId}` : 'Bot Master'})\n` +
        `• *!fotosubbot <id>* — Altera a foto de um sub-bot específico (Ex: \`!fotosubbot 2\`)\n` +
        `• *!fotosubbot all* — Aplica a mesma foto em *todos* os sub-bots da frota\n\n` +
        `👥 *2. Grupos (Dono ou Admin):*\n` +
        `• *!fotogrupo* — Altera a foto do grupo atual onde o comando foi enviado\n` +
        `• *!fotogrupo <link/jid>* — Altera a foto de um grupo específico\n\n` +
        `📢 *3. Canais Oficiais (Apenas Dono):*\n` +
        `• *!fotocanal* — Altera a foto do seu Canal de Ofertas (@newsletter)\n` +
        `• *!fotocanal <link/jid>* — Altera a foto de um canal específico\n\n` +
        `🗑️ *4. Remover Foto (Restaurar Padrão):*\n` +
        `• *!removerfotobot* | *!removerfotosubbot <id>*\n` +
        `• *!removerfotogrupo* | *!removerfotocanal*\n\n` +
        `_Todas as fotos são automaticamente otimizadas em 640x640 HD!_ ✨`;

      return sock.sendMessage(from, { text: helpMsg });
    }

    // 2. Remoção de Fotos
    if (/^(?:!|\/)removerfoto(bot|subbot|grupo|canal)(?:\s+(.*))?$/i.test(lower)) {
      const match = lower.match(/^(?:!|\/)removerfoto(bot|subbot|grupo|canal)(?:\s+(.*))?$/i);
      const subType = match[1];
      const param = (match[2] || '').trim();

      if (subType === 'bot' || subType === 'subbot' || subType === 'canal') {
        if (!isOwnerUser) {
          return sock.sendMessage(from, { text: '🚫 *Acesso Negado:* Apenas o Dono Supremo pode gerenciar a imagem de bots e canais.' });
        }
      } else if (subType === 'grupo') {
        if (!isOwnerUser && !isAdmin) {
          return sock.sendMessage(from, { text: '⚠️ Apenas administradores do grupo ou o Dono podem alterar a imagem do grupo.' });
        }
      }

      try {
        const targetId = param || (subType === 'grupo' ? from : null);
        const res = await this.removePicture(subType, targetId, sock);
        return sock.sendMessage(from, { text: `✅ *Foto Removida com Sucesso!*\n\nO avatar de *${subType.toUpperCase()}* foi restaurado para o padrão do WhatsApp.` });
      } catch (err) {
        return sock.sendMessage(from, { text: `❌ *Erro ao remover foto:* ${err.message}` });
      }
    }

    // 3. Identifica o comando e o alvo desejado
    let targetCategory = null; // 'bot' | 'subbot' | 'group' | 'channel'
    let targetArg = null;

    if (/^(?:!|\/)(?:fotobot|setfotobot|avatarbot|perfilbot)(?:\s+(.*))?$/i.test(lower)) {
      targetCategory = 'bot';
      const m = rawText.match(/^(?:!|\/)(?:fotobot|setfotobot|avatarbot|perfilbot)(?:\s+(.*))?$/i);
      targetArg = (m && m[1]) ? m[1].trim() : null;
    } else if (/^(?:!|\/)(?:fotosubbot|setfotosubbot|fotonina|fotosuporte)(?:\s+(.*))?$/i.test(lower)) {
      targetCategory = 'subbot';
      const m = rawText.match(/^(?:!|\/)(?:fotosubbot|setfotosubbot|fotonina|fotosuporte)(?:\s+(.*))?$/i);
      targetArg = (m && m[1]) ? m[1].trim() : null;
    } else if (/^(?:!|\/)(?:fotogrupo|setfotogrupo|avatargrupo)(?:\s+(.*))?$/i.test(lower)) {
      targetCategory = 'group';
      const m = rawText.match(/^(?:!|\/)(?:fotogrupo|setfotogrupo|avatargrupo)(?:\s+(.*))?$/i);
      targetArg = (m && m[1]) ? m[1].trim() : null;
    } else if (/^(?:!|\/)(?:fotocanal|setfotocanal|avatarcanal)(?:\s+(.*))?$/i.test(lower)) {
      targetCategory = 'channel';
      const m = rawText.match(/^(?:!|\/)(?:fotocanal|setfotocanal|avatarcanal)(?:\s+(.*))?$/i);
      targetArg = (m && m[1]) ? m[1].trim() : null;
    } else if (/^(?:!|\/)setfoto\s+(bot|subbot|grupo|canal)(?:\s+(.*))?$/i.test(lower)) {
      const m = rawText.match(/^(?:!|\/)setfoto\s+(bot|subbot|grupo|canal)(?:\s+(.*))?$/i);
      const cat = m[1].toLowerCase();
      targetCategory = cat === 'grupo' ? 'group' : (cat === 'canal' ? 'channel' : cat);
      targetArg = (m[2] || '').trim() || null;
    }

    if (!targetCategory) return false;

    // 4. Verificação rigorosa de Permissões
    if (targetCategory === 'bot' || targetCategory === 'subbot' || targetCategory === 'channel') {
      if (!isOwnerUser) {
        return sock.sendMessage(from, { text: '🚫 *Acesso Negado:* Apenas o *Dono Supremo* pode alterar a foto de perfil de bots, sub-bots e canais.' });
      }
    } else if (targetCategory === 'group') {
      if (!isOwnerUser && !isAdmin) {
        return sock.sendMessage(from, { text: '⚠️ Apenas *Administradores* deste grupo ou o *Dono* podem alterar a imagem do grupo.' });
      }
    }

    // 5. Extração da Imagem (Buffer)
    const imageBuffer = await this.extractImageBuffer(msg, rawText, from);

    if (!imageBuffer) {
      return sock.sendMessage(from, {
        text:
          `📸 *Nenhuma imagem detectada!*\n\n` +
          `Para atualizar a foto:\n` +
          `1️⃣ Envie a foto no WhatsApp com a legenda: *${rawText.split(/\s+/)[0]}*\n` +
          `2️⃣ Ou responda (cite) uma foto com: *${rawText.split(/\s+/)[0]}*\n` +
          `3️⃣ Ou envie com o link da imagem: *${rawText.split(/\s+/)[0]} https://link-da-imagem.jpg*\n\n` +
          `_Envie *!ajudafoto* para ver todos os detalhes._`
      });
    }

    // Feedback imediato de processamento
    await sock.sendMessage(from, { text: '⏳ *Processando imagem em alta resolução e aplicando...*' });

    // 6. Execução da Atualização conforme o Alvo
    try {
      if (targetCategory === 'bot') {
        const result = await this.updateBotProfilePicture(sock, imageBuffer);
        const botType = result.isSubBot ? `Sub-Bot #${result.instanceId}` : 'Bot Master Principal';
        return sock.sendMessage(from, {
          text:
            `✨ *FOTO DO BOT ATUALIZADA COM SUCESSO!* 🎉\n\n` +
            `🤖 *Bot:* ${botType}\n` +
            `📱 *Número:* +${result.phone}\n` +
            `📐 *Resolução:* 640x640 px (JPEG Otimizado HD)\n\n` +
            `_A nova foto de perfil já está visível para todos os contatos!_`
        });
      }

      if (targetCategory === 'subbot') {
        const result = await this.updateSubBotProfilePicture(targetArg, imageBuffer, sock);

        if (result.target === 'subbot_fleet') {
          return sock.sendMessage(from, {
            text:
              `🚀 *FROTA DE SUB-BOTS ATUALIZADA!* 🌐\n\n` +
              `📦 *Total Conectados:* ${result.total}\n` +
              `✅ *Atualizados com Sucesso:* ${result.updated}\n` +
              `📐 *Resolução:* 640x640 px HD\n\n` +
              `_A nova imagem foi sincronizada em todos os chips da sua frota!_`
          });
        }

        return sock.sendMessage(from, {
          text:
            `✨ *FOTO DO SUB-BOT ATUALIZADA COM SUCESSO!* 🎉\n\n` +
            `🤖 *Sub-Bot:* ${result.name} (#${result.instanceId})\n` +
            `📱 *Número:* +${result.phone}\n` +
            `📐 *Resolução:* 640x640 px (JPEG Otimizado HD)\n\n` +
            `_O avatar do sub-bot foi alterado com sucesso!_`
        });
      }

      if (targetCategory === 'group') {
        const targetGroupJid = (targetArg && targetArg.includes('@g.us')) ? targetArg : from;
        const result = await this.updateGroupPicture(targetGroupJid, imageBuffer, sock);

        return sock.sendMessage(from, {
          text:
            `🎉 *FOTO DO GRUPO ATUALIZADA COM SUCESSO!* 👥\n\n` +
            `🏷️ *Grupo:* ${result.groupJid}\n` +
            `📐 *Resolução:* 640x640 px (JPEG Otimizado HD)\n\n` +
            `_O ícone oficial do grupo foi atualizado!_`
        });
      }

      if (targetCategory === 'channel') {
        const result = await this.updateChannelPicture(targetArg, imageBuffer, sock);

        return sock.sendMessage(from, {
          text:
            `📢 *FOTO DO CANAL ATUALIZADA COM SUCESSO!* ⚡\n\n` +
            `📡 *Canal:* ${result.channelJid}\n` +
            `📐 *Resolução:* 640x640 px (JPEG Otimizado HD)\n\n` +
            `_A capa do seu Canal Oficial no WhatsApp foi atualizada com sucesso!_`
        });
      }
    } catch (err) {
      console.error('[ProfilePictureService] Falha na atualização:', err);
      return sock.sendMessage(from, {
        text: `❌ *Falha ao atualizar imagem:* ${err.message}\n\n_Verifique se o bot possui permissão de Administrador ou se o alvo está online._`
      });
    }

    return true;
  }
}

const profilePictureService = new ProfilePictureService();
module.exports = profilePictureService;

/**
 * interactiveMessageService.js
 * 
 * Gerenciador de Mensagens Interativas do WhatsApp (Baileys Native Flow):
 * - Botões de Resposta Rápida (quick_reply)
 * - Botões de Link / URL (cta_url)
 * - Botões de Cópia com 1 Toque (cta_copy - Pix Copia e Cola)
 * - Listas e Menus Interativos (single_select)
 * - Fallback inteligente para texto tradicional caso o cliente não suporte Native Flow
 */

const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const models = require('../db/models');

class InteractiveMessageService {
  /**
   * Verifica se o envio de mensagens interativas está habilitado nas configurações
   */
  isEnabled() {
    try {
      return models.getSetting('ENABLE_INTERACTIVE_MESSAGES', 'true') !== 'false';
    } catch (_) {
      return true;
    }
  }

  /**
   * Converte uma lista de botões para texto formatado caso o envio nativo falhe
   */
  formatButtonsAsText({ title, text, footer, buttons = [] }) {
    let out = '';
    if (title) out += `*${title}*\n\n`;
    if (text) out += `${text}\n\n`;

    if (buttons && buttons.length > 0) {
      out += `👉 *Escolha tocando ou respondendo com a opção:*\n`;
      buttons.forEach((btn, idx) => {
        const type = btn.type || (btn.url ? 'cta_url' : (btn.copyCode || btn.code ? 'cta_copy' : 'quick_reply'));
        const label = btn.text || btn.title || `Opção ${idx + 1}`;
        if (type === 'cta_url') {
          out += `• 🌐 *${label}*: ${btn.url}\n`;
        } else if (type === 'cta_copy') {
          out += `• 📋 *${label}*: \`${btn.copyCode || btn.code}\`\n`;
        } else {
          const actionId = btn.id || btn.actionId || `${idx + 1}`;
          out += `• 🔘 Envie *${actionId}* para: *${label}*\n`;
        }
      });
    }

    if (footer) out += `\n_${footer}_`;
    return out.trim();
  }

  /**
   * Converte seções de lista interativa para texto formatado
   */
  formatSectionsAsText({ title, text, footer, sections = [] }) {
    let out = '';
    if (title) out += `*${title}*\n\n`;
    if (text) out += `${text}\n\n`;

    if (sections && sections.length > 0) {
      sections.forEach(sec => {
        if (sec.title) out += `\n📂 *${sec.title.toUpperCase()}*\n`;
        (sec.rows || []).forEach(row => {
          const id = row.id || row.rowId || '•';
          const rTitle = row.title || '';
          const rDesc = row.description ? ` - _${row.description}_` : '';
          out += `👉 Envie *${id}*: *${rTitle}*${rDesc}\n`;
        });
      });
    }

    if (footer) out += `\n_${footer}_`;
    return out.trim();
  }

  /**
   * Monta a estrutura protobuf de botões Native Flow
   */
  buildNativeFlowButtons(buttons = []) {
    return buttons.map((b, idx) => {
      const type = b.type || (b.url ? 'cta_url' : (b.copyCode || b.code ? 'cta_copy' : (b.sections ? 'single_select' : 'quick_reply')));

      if (type === 'cta_copy') {
        return {
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({
            display_text: b.text || b.title || '📋 Copiar Código',
            copy_code: String(b.code || b.copyCode || '').trim()
          })
        };
      }

      if (type === 'cta_url') {
        return {
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: b.text || b.title || '🌐 Acessar',
            url: b.url || ''
          })
        };
      }

      if (type === 'cta_call') {
        return {
          name: 'cta_call',
          buttonParamsJson: JSON.stringify({
            display_text: b.text || b.title || '📞 Ligar',
            phone_number: b.phone || b.phoneNumber || ''
          })
        };
      }

      if (type === 'single_select') {
        return {
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: b.buttonText || b.text || 'Ver Opções',
            sections: b.sections || []
          })
        };
      }

      // quick_reply padrão
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: b.text || b.title || `Opção ${idx + 1}`,
          id: String(b.id || b.actionId || `${idx + 1}`)
        })
      };
    });
  }

  /**
   * Envia botões interativos (Quick Reply, URL, Copy Pix) via Native Flow
   */
  async sendInteractiveButtons(sock, targetJid, {
    title = '',
    text = '',
    footer = '',
    buttons = [],
    fallbackText = null,
    quoted = null,
    contextInfo = null
  }) {
    if (!sock || !targetJid) return false;
    let cleanJid = targetJid.includes('@') ? targetJid : `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    if (cleanJid.endsWith('@lid')) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        const resolved = whatsappBot.resolveLidToPhone ? whatsappBot.resolveLidToPhone(cleanJid) : null;
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          cleanJid = `${resolved}@s.whatsapp.net`;
        }
      } catch (_) {}
    }

    if (!this.isEnabled() || !buttons || buttons.length === 0) {
      const fb = fallbackText || this.formatButtonsAsText({ title, text, footer, buttons });
      return sock.sendMessage(cleanJid, { text: fb, contextInfo }, { quoted });
    }

    try {
      const formattedButtons = this.buildNativeFlowButtons(buttons);

      const interactiveMessage = proto.Message.InteractiveMessage.create({
        header: title ? proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }) : undefined,
        body: proto.Message.InteractiveMessage.Body.create({ text: text || 'Selecione uma opção:' }),
        footer: footer ? proto.Message.InteractiveMessage.Footer.create({ text: footer }) : undefined,
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: formattedButtons
        }),
        contextInfo: contextInfo || undefined
      });

      const messageContent = {
        viewOnceMessage: {
          message: {
            interactiveMessage
          }
        }
      };

      const waMessage = generateWAMessageFromContent(cleanJid, messageContent, {
        userJid: sock.user?.id,
        quoted
      });

      await sock.relayMessage(cleanJid, waMessage.message, { messageId: waMessage.key.id });
      return true;
    } catch (err) {
      console.warn(`[InteractiveMessage ⚠️ Falha no envio nativo para ${cleanJid}, aplicando fallback texto]:`, err.message);
      const fb = fallbackText || this.formatButtonsAsText({ title, text, footer, buttons });
      return sock.sendMessage(cleanJid, { text: fb, contextInfo }, { quoted });
    }
  }

  /**
   * Envia uma Lista Interativa categorizada com seções (single_select)
   */
  async sendInteractiveList(sock, targetJid, {
    title = '',
    text = '',
    footer = '',
    buttonText = '📂 Ver Opções / Cardápio',
    sections = [],
    fallbackText = null,
    quoted = null,
    contextInfo = null
  }) {
    if (!sock || !targetJid) return false;
    let cleanJid = targetJid.includes('@') ? targetJid : `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    if (cleanJid.endsWith('@lid')) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        const resolved = whatsappBot.resolveLidToPhone ? whatsappBot.resolveLidToPhone(cleanJid) : null;
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          cleanJid = `${resolved}@s.whatsapp.net`;
        }
      } catch (_) {}
    }

    if (!this.isEnabled() || !sections || sections.length === 0) {
      const fb = fallbackText || this.formatSectionsAsText({ title, text, footer, sections });
      return sock.sendMessage(cleanJid, { text: fb, contextInfo }, { quoted });
    }

    try {
      const listButton = {
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
          title: buttonText || 'Ver Opções',
          sections: sections.map(s => ({
            title: s.title || 'Opções',
            rows: (s.rows || []).map(r => ({
              id: String(r.id || r.rowId || ''),
              title: String(r.title || '').slice(0, 50),
              description: r.description ? String(r.description).slice(0, 72) : undefined
            }))
          }))
        })
      };

      const interactiveMessage = proto.Message.InteractiveMessage.create({
        header: title ? proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }) : undefined,
        body: proto.Message.InteractiveMessage.Body.create({ text: text || 'Confira nosso catálogo:' }),
        footer: footer ? proto.Message.InteractiveMessage.Footer.create({ text: footer }) : undefined,
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: [listButton]
        }),
        contextInfo: contextInfo || undefined
      });

      const messageContent = {
        viewOnceMessage: {
          message: {
            interactiveMessage
          }
        }
      };

      const waMessage = generateWAMessageFromContent(cleanJid, messageContent, {
        userJid: sock.user?.id,
        quoted
      });

      await sock.relayMessage(cleanJid, waMessage.message, { messageId: waMessage.key.id });
      return true;
    } catch (err) {
      console.warn(`[InteractiveList ⚠️ Falha na lista nativa para ${cleanJid}, aplicando fallback texto]:`, err.message);
      const fb = fallbackText || this.formatSectionsAsText({ title, text, footer, sections });
      return sock.sendMessage(cleanJid, { text: fb, contextInfo }, { quoted });
    }
  }

  /**
   * Envia um Carrossel Interativo de Produtos (Cards Deslizantes Native Flow no WhatsApp)
   * Cada card possui cabeçalho (imagem/título), descrição, valor e botões de ação ("Comprar Agora", "Ver na Loja")
   */
  async sendProductCarousel(sock, targetJid, {
    title = '',
    text = 'Confira nossos produtos no carrossel abaixo:',
    footer = '👉 Deslize para o lado para ver todos os produtos',
    products = [],
    fallbackText = null,
    quoted = null,
    contextInfo = null
  }) {
    if (!sock || !targetJid) return false;
    let cleanJid = targetJid.includes('@') ? targetJid : `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    if (cleanJid.endsWith('@lid')) {
      try {
        const whatsappBot = require('../bots/whatsappBot');
        const resolved = whatsappBot.resolveLidToPhone ? whatsappBot.resolveLidToPhone(cleanJid) : null;
        if (resolved && resolved.length >= 8 && resolved.length <= 13) {
          cleanJid = `${resolved}@s.whatsapp.net`;
        }
      } catch (_) {}
    }

    if (!this.isEnabled() || !products || products.length === 0) {
      let fb = fallbackText;
      if (!fb) {
        fb = `🛍️ *${title || 'CATÁLOGO DE PRODUTOS'}*\n\n${text}\n\n`;
        products.forEach((p, i) => {
          const brl = Number(p.price_brl || p.price || 0).toFixed(2);
          fb += `━━━━━━━━━━━━━━━━━━━━━\n`;
          fb += `📦 *${i + 1}. ${p.name}*\n`;
          if (p.description) fb += `📝 _${p.description}_\n`;
          fb += `💰 *Valor:* R$ ${brl}\n`;
          fb += `👉 *Comprar:* envie \`!pix ${brl}\`\n`;
          if (p.url) fb += `🌐 *Link:* ${p.url}\n`;
        });
        if (footer) fb += `\n_${footer}_`;
      }
      return sock.sendMessage(cleanJid, { text: fb.trim(), contextInfo }, { quoted });
    }

    try {
      const cards = [];
      for (const prod of products) {
        const priceBrl = Number(prod.price_brl || prod.price || 0).toFixed(2);
        const cardTitle = prod.name || 'Produto';
        const desc = prod.description ? `\n\n_${prod.description}_` : '';
        const cardBody = `*${cardTitle}*\n💰 *Valor:* R$ ${priceBrl}${desc}`;

        const buttons = [];
        // Botão de compra rápida com 1 toque
        buttons.push({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: '🛒 Comprar Agora',
            id: prod.buyCommand || `!pix ${priceBrl}`
          })
        });

        // Botão de link para checkout / vitrine online
        if (prod.url) {
          buttons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '🌐 Ver na Loja',
              url: prod.url
            })
          });
        }

        let header;
        if (prod.image_url || prod.image) {
          try {
            const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
            const media = await prepareWAMessageMedia(
              { image: { url: prod.image_url || prod.image } },
              { upload: sock.waUploadToServer }
            );
            header = proto.Message.InteractiveMessage.Header.create({
              title: cardTitle.slice(0, 50),
              hasMediaAttachment: true,
              imageMessage: media?.imageMessage
            });
          } catch (_) {
            header = proto.Message.InteractiveMessage.Header.create({
              title: cardTitle.slice(0, 50),
              hasMediaAttachment: false
            });
          }
        } else {
          header = proto.Message.InteractiveMessage.Header.create({
            title: cardTitle.slice(0, 50),
            hasMediaAttachment: false
          });
        }

        const card = proto.Message.InteractiveMessage.create({
          header,
          body: proto.Message.InteractiveMessage.Body.create({ text: cardBody }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: prod.cardFooter || 'Entrega Automática via Pix' }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons
          })
        });

        cards.push(card);
      }

      const interactiveMessage = proto.Message.InteractiveMessage.create({
        header: title ? proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }) : undefined,
        body: proto.Message.InteractiveMessage.Body.create({ text: text || 'Confira nossos produtos no carrossel abaixo:' }),
        footer: footer ? proto.Message.InteractiveMessage.Footer.create({ text: footer }) : undefined,
        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
          cards,
          messageVersion: 1
        }),
        contextInfo: contextInfo || undefined
      });

      const messageContent = {
        viewOnceMessage: {
          message: {
            interactiveMessage
          }
        }
      };

      const waMessage = generateWAMessageFromContent(cleanJid, messageContent, {
        userJid: sock.user?.id,
        quoted
      });

      await sock.relayMessage(cleanJid, waMessage.message, { messageId: waMessage.key.id });
      return true;
    } catch (err) {
      console.warn(`[ProductCarousel ⚠️ Falha no envio nativo para ${cleanJid}, aplicando fallback texto]:`, err.message);
      let fb = fallbackText;
      if (!fb) {
        fb = `🛍️ *${title || 'CATÁLOGO DE PRODUTOS'}*\n\n${text}\n\n`;
        products.forEach((p, i) => {
          const brl = Number(p.price_brl || p.price || 0).toFixed(2);
          fb += `━━━━━━━━━━━━━━━━━━━━━\n`;
          fb += `📦 *${i + 1}. ${p.name}*\n`;
          if (p.description) fb += `📝 _${p.description}_\n`;
          fb += `💰 *Valor:* R$ ${brl}\n`;
          fb += `👉 *Comprar:* envie \`!pix ${brl}\`\n`;
          if (p.url) fb += `🌐 *Link:* ${p.url}\n`;
        });
        if (footer) fb += `\n_${footer}_`;
      }
      return sock.sendMessage(cleanJid, { text: fb.trim(), contextInfo }, { quoted });
    }
  }

  /**
   * Extrai comando, ID de botão clicado ou texto normal de qualquer mensagem recebida no WhatsApp
   */
  extractInteractiveAction(rawMsg) {
    if (!rawMsg) return { text: '', actionId: '' };

    let msgObj = rawMsg.message || rawMsg;
    if (!msgObj) return { text: '', actionId: '' };

    // Desempacota envelopes de visualização única, efêmeros ou documentos
    const unwrapKeys = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage', 'documentWithCaptionMessage'];
    for (const key of unwrapKeys) {
      if (msgObj[key]?.message) {
        msgObj = msgObj[key].message;
      }
    }

    // 1. Resposta de Botão / Lista Native Flow (interactiveResponseMessage)
    if (msgObj.interactiveResponseMessage) {
      const nativeFlow = msgObj.interactiveResponseMessage.nativeFlowResponseMessage;
      if (nativeFlow?.paramsJson) {
        try {
          const parsed = JSON.parse(nativeFlow.paramsJson);
          const id = parsed.id || parsed.selected_id || parsed.button_id || parsed.rowId || parsed.row_id || '';
          if (id) {
            return { text: String(id).trim(), actionId: String(id).trim() };
          }
        } catch (_) {
          if (typeof nativeFlow.paramsJson === 'string' && nativeFlow.paramsJson.trim().length > 0) {
            return { text: nativeFlow.paramsJson.trim(), actionId: nativeFlow.paramsJson.trim() };
          }
        }
      }

      if (msgObj.interactiveResponseMessage.body?.text) {
        const bText = msgObj.interactiveResponseMessage.body.text.trim();
        return { text: bText, actionId: bText };
      }
    }

    // 2. Resposta de Botões Rápidos Tradicionais (buttonsResponseMessage)
    if (msgObj.buttonsResponseMessage) {
      const btnId = msgObj.buttonsResponseMessage.selectedButtonId || msgObj.buttonsResponseMessage.selectedDisplayText || '';
      if (btnId) {
        return { text: String(btnId).trim(), actionId: String(btnId).trim() };
      }
    }

    // 3. Resposta de Botão Template (templateButtonReplyMessage)
    if (msgObj.templateButtonReplyMessage) {
      const tId = msgObj.templateButtonReplyMessage.selectedId || msgObj.templateButtonReplyMessage.selectedDisplayText || '';
      if (tId) {
        return { text: String(tId).trim(), actionId: String(tId).trim() };
      }
    }

    // 4. Resposta de Lista Tradicional (listResponseMessage)
    if (msgObj.listResponseMessage) {
      const listId = msgObj.listResponseMessage.singleSelectReply?.selectedRowId || msgObj.listResponseMessage.title || '';
      if (listId) {
        return { text: String(listId).trim(), actionId: String(listId).trim() };
      }
    }

    // 5. Mensagens de Texto padrão, legendas de mídias e conversas
    const standardText = (
      msgObj.conversation ||
      msgObj.extendedTextMessage?.text ||
      msgObj.imageMessage?.caption ||
      msgObj.videoMessage?.caption ||
      msgObj.documentMessage?.caption ||
      ''
    ).trim();

    return { text: standardText, actionId: '' };
  }
}

module.exports = new InteractiveMessageService();

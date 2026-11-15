/**
 * ============================================================================
 * 📢 STATUS & STORIES SERVICE - PAYBOT & EXÉRCITO DE SUB-BOTS
 * ============================================================================
 * Permite aos bots postarem Stories/Status no WhatsApp marcando e notificando:
 * 1. Todos os membros de um grupo específico (!statusgp / !swgp)
 * 2. Toda a base de contatos, clientes e leads do banco de dados (!statusbase / !swbase)
 * 3. Todo o exército de sub-bots disparando simultaneamente (!statusarmy / !swarmy)
 *
 * Utiliza o protocolo nativo de status@broadcast do Baileys com statusJidList
 * e mentions para ativar o sistema oficial de menções em status do WhatsApp.
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const models = require('../db/models');

class StatusStoryService {
  constructor() {
    this.defaultBackgroundColor = '#111b21';
    this.defaultFont = 1;
  }

  /**
   * Extrai todos os contatos únicos válidos do banco de dados SQLite
   * (pedidos, leads de campanhas, funis, perfis cognitivos, fidelidade e logs)
   */
  getDatabaseContacts() {
    const phones = new Set();
    const queries = [
      'SELECT customer_phone as phone FROM orders WHERE customer_phone IS NOT NULL',
      'SELECT phone FROM campaign_leads WHERE phone IS NOT NULL',
      'SELECT lead_phone as phone FROM lead_funnel_conversations WHERE lead_phone IS NOT NULL',
      'SELECT phone FROM lead_cognitive_profiles WHERE phone IS NOT NULL',
      'SELECT user_phone as phone FROM user_loyalty WHERE user_phone IS NOT NULL',
      'SELECT sender_phone as phone FROM bot_command_audit_logs WHERE sender_phone IS NOT NULL'
    ];

    for (const q of queries) {
      try {
        const rows = db.prepare(q).all();
        for (const row of rows) {
          const clean = String(row.phone || '').replace(/\D/g, '');
          if (clean.length >= 8 && clean.length <= 15) {
            phones.add(`${clean}@s.whatsapp.net`);
          }
        }
      } catch (_) {}
    }

    return Array.from(phones);
  }

  /**
   * Constrói o payload de mensagem apropriado para status@broadcast
   */
  _buildStatusPayload(mediaOptions, targetJids = []) {
    const { text, caption, image, video, audio, backgroundColor, font } = mediaOptions;

    // 1. Status de Imagem
    if (image && Buffer.isBuffer(image)) {
      return {
        payload: {
          image,
          caption: caption || text || '',
          mentions: targetJids
        },
        options: {
          statusJidList: targetJids
        },
        type: 'image'
      };
    }

    // 2. Status de Vídeo
    if (video && Buffer.isBuffer(video)) {
      return {
        payload: {
          video,
          caption: caption || text || '',
          mentions: targetJids
        },
        options: {
          statusJidList: targetJids
        },
        type: 'video'
      };
    }

    // 3. Status de Áudio / Voz (PTT)
    if (audio && Buffer.isBuffer(audio)) {
      return {
        payload: {
          audio,
          mimetype: 'audio/mp4',
          ptt: true
        },
        options: {
          statusJidList: targetJids
        },
        type: 'audio'
      };
    }

    // 4. Status de Texto Padrão
    const statusText = text || caption || '🔥 Comunicado Oficial PayBot';
    return {
      payload: {
        text: statusText,
        mentions: targetJids
      },
      options: {
        statusJidList: targetJids,
        backgroundColor: backgroundColor || this.defaultBackgroundColor,
        font: font || this.defaultFont
      },
      type: 'text'
    };
  }

  /**
   * 1. Publica Story marcando todos os membros de um grupo específico
   * @param {object} conn Instância do Baileys
   * @param {string} groupJid JID do grupo (ex: 120363000@g.us)
   * @param {object} mediaOptions { text, caption, image, video, audio, backgroundColor, font }
   */
  async postGroupStatus(conn, groupJid, mediaOptions = {}) {
    if (!conn || typeof conn.sendMessage !== 'function') {
      throw new Error('Instância do WhatsApp indisponível para postagem.');
    }
    if (!groupJid || !groupJid.endsWith('@g.us')) {
      throw new Error('JID de grupo inválido para captura de membros.');
    }

    let meta = null;
    try {
      meta = await conn.groupMetadata(groupJid);
    } catch (err) {
      throw new Error(`Falha ao obter participantes do grupo: ${err.message}`);
    }

    const participants = meta?.participants || [];
    if (participants.length === 0) {
      throw new Error('O grupo não possui participantes para marcar.');
    }

    const targetJids = participants.map(p => p.id || p.jid).filter(Boolean);
    const { payload, options, type } = this._buildStatusPayload(mediaOptions, targetJids);

    const result = await conn.sendMessage('status@broadcast', payload, options);

    return {
      success: true,
      type,
      groupName: meta.subject || 'Grupo WhatsApp',
      groupJid,
      totalParticipants: targetJids.length,
      statusId: result?.key?.id || 'STATUS_OK'
    };
  }

  /**
   * 2. Publica Story marcando toda a base de contatos/leads do banco de dados
   * @param {object} conn Instância do Baileys
   * @param {object} mediaOptions { text, caption, image, video, audio }
   * @param {number} batchSize Tamanho máximo de membros por story (padrão: 100)
   */
  async postDatabaseStatus(conn, mediaOptions = {}, batchSize = 100) {
    if (!conn || typeof conn.sendMessage !== 'function') {
      throw new Error('Instância do WhatsApp indisponível para postagem.');
    }

    const allContacts = this.getDatabaseContacts();
    if (allContacts.length === 0) {
      throw new Error('Nenhum contato encontrado no banco de dados para marcar no status.');
    }

    const limit = Math.max(10, Math.min(300, batchSize));
    const batches = [];
    for (let i = 0; i < allContacts.length; i += limit) {
      batches.push(allContacts.slice(i, i + limit));
    }

    let dispatchedBatches = 0;
    let lastType = 'text';

    for (const batch of batches) {
      const { payload, options, type } = this._buildStatusPayload(mediaOptions, batch);
      lastType = type;
      await conn.sendMessage('status@broadcast', payload, options);
      dispatchedBatches++;

      // Pausa anti-spam se houver múltiplos lotes
      if (batches.length > 1 && process.env.NODE_ENV !== 'test') {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    return {
      success: true,
      type: lastType,
      totalContacts: allContacts.length,
      batchesCount: dispatchedBatches
    };
  }

  /**
   * 3. Dispara Story em massa através de todos os Sub-Bots do Exército (WhatsApp Army)
   * Cada sub-bot publica um status marcando todos os participantes dos seus grupos ou leads
   */
  async postArmyStatus(mediaOptions = {}) {
    let whatsappArmyService;
    try {
      whatsappArmyService = require('./whatsappArmyService');
    } catch (_) {
      throw new Error('Serviço WhatsApp Army indisponível no sistema.');
    }

    const instances = models.getArmyInstances();
    const activeInstances = instances.filter(i => i.active);

    if (activeInstances.length === 0) {
      throw new Error('Nenhum chip ou sub-bot do exército está ativo no momento.');
    }

    let dispatchedBots = 0;
    let totalTargeted = 0;
    const details = [];

    for (const inst of activeInstances) {
      let sock = whatsappArmyService.activeSockets?.get(inst.id);
      if (!sock && inst.is_main) {
        try {
          sock = require('../bots/whatsappBot').sock;
        } catch (_) {}
      }

      if (!sock) {
        details.push({ instanceId: inst.id, phone: inst.phone, status: 'SKIPPED_DISCONNECTED' });
        continue;
      }

      try {
        let targetJids = [];

        // 1. Busca grupos nos quais este sub-bot participa
        if (typeof sock.groupFetchAllParticipating === 'function') {
          try {
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups || {});
            for (const g of groupList) {
              const pList = g.participants || [];
              pList.forEach(p => targetJids.push(p.id));
            }
          } catch (_) {}
        }

        // 2. Se não estiver em grupos, usa contatos do banco
        if (targetJids.length === 0) {
          targetJids = this.getDatabaseContacts().slice(0, 100);
        }

        // Deduplica JIDs
        targetJids = Array.from(new Set(targetJids));

        if (targetJids.length > 0) {
          const { payload, options, type } = this._buildStatusPayload(mediaOptions, targetJids);
          await sock.sendMessage('status@broadcast', payload, options);
          dispatchedBots++;
          totalTargeted += targetJids.length;
          details.push({ instanceId: inst.id, phone: inst.phone, status: 'POSTED', targetedCount: targetJids.length, type });
        } else {
          details.push({ instanceId: inst.id, phone: inst.phone, status: 'NO_TARGETS' });
        }
      } catch (err) {
        details.push({ instanceId: inst.id, phone: inst.phone, status: 'ERROR', error: err.message });
      }
    }

    return {
      success: true,
      activeInstancesCount: activeInstances.length,
      dispatchedBots,
      totalTargeted,
      details
    };
  }

  /**
   * 4. Posta Status Promocional e de Divulgação Oficial do PayBot
   * nos Sub-Bots que aceitaram os termos de adesão do Exército
   */
  async postPayBotPromotionalStatus({ instanceId = null, customText = null, affiliateUrl = null, imageUrl = null } = {}) {
    let whatsappArmyService;
    try {
      whatsappArmyService = require('./whatsappArmyService');
    } catch (_) {
      throw new Error('Serviço WhatsApp Army indisponível no sistema.');
    }

    const instances = models.getArmyInstances();
    let targets = [];
    if (instanceId) {
      const inst = instances.find(i => i.id === Number(instanceId));
      if (inst) targets = [inst];
    } else {
      targets = instances.filter(i => i.active && (i.is_main || (i.terms_accepted === 1 || i.can_post_status !== 0)));
    }

    if (targets.length === 0) {
      throw new Error('Nenhum Sub-Bot apto para postagem de status promocional do PayBot.');
    }

    const tunnelService = require('./tunnelService');
    const defaultSubbotUrl = (tunnelService.getStoreUrl() || 'http://localhost:3001') + '/subbot';

    const promoText = customText || (
      `🤖 *TRANSFORME SEU WHATSAPP EM SUB-BOT PAYBOT (100% GRÁTIS)!* 🚀\n\n` +
      `Use Inteligência Artificial, figurinhas automáticas, downloads e utilitários no seu próprio número!\n\n` +
      `🔋 *Ganhe 50 TOKENS de presente na hora.*\n` +
      `👉 Conecte em 1 minuto sem pagar nada:\n` +
      `🔗 ${affiliateUrl || defaultSubbotUrl}\n\n` +
      `💬 Me mande *!menu* ou me chame no privado para testar agora!`
    );

    const mediaOptions = imageUrl ? {
      image: imageUrl,
      caption: promoText
    } : {
      text: promoText,
      backgroundColor: '#0a0d1a',
      font: 2
    };

    let dispatchedCount = 0;
    const results = [];

    for (const inst of targets) {
      let sock = whatsappArmyService.activeSockets?.get(inst.id);
      if (!sock && inst.is_main) {
        try {
          sock = require('../bots/whatsappBot').sock;
        } catch (_) {}
      }

      if (!sock) {
        results.push({ instanceId: inst.id, phone: inst.phone, status: 'SKIPPED_DISCONNECTED' });
        continue;
      }

      try {
        let targetJids = [];
        if (typeof sock.groupFetchAllParticipating === 'function') {
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const g of Object.values(groups || {})) {
              (g.participants || []).forEach(p => targetJids.push(p.id));
            }
          } catch (_) {}
        }

        if (targetJids.length === 0) {
          targetJids = this.getDatabaseContacts().slice(0, 100);
        }
        targetJids = Array.from(new Set(targetJids));

        if (targetJids.length > 0) {
          const { payload, options, type } = this._buildStatusPayload(mediaOptions, targetJids);
          await sock.sendMessage('status@broadcast', payload, options);
          dispatchedCount++;
          results.push({ instanceId: inst.id, phone: inst.phone, status: 'POSTED', targetCount: targetJids.length, type });
        } else {
          results.push({ instanceId: inst.id, phone: inst.phone, status: 'NO_TARGETS' });
        }
      } catch (err) {
        results.push({ instanceId: inst.id, phone: inst.phone, status: 'ERROR', error: err.message });
      }
    }

    return {
      success: true,
      dispatchedCount,
      totalEligible: targets.length,
      results
    };
  }
}

module.exports = new StatusStoryService();

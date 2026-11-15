/**
 * =========================================================================
 * 🎛️ SUB-BOT FEATURE SERVICE (CONTROLE DE FUNÇÕES POR SELEÇÃO DE SUB-BOTS)
 * =========================================================================
 * Permite que o Dono Supremo, Desenvolvedores de Suporte (Devs) e o Bot Master
 * ativem ou desativem recursos específicos de Sub-Bots selecionando-os
 * individualmente, em lote ou globalmente.
 *
 * Recursos Gerenciados:
 * 1. ai: Inteligência Artificial (!ia, Simi, respostas cognitivas)
 * 2. group_posts: Divulgação & Postagens em Grupos (achadinhos, ofertas automáticas)
 * 3. pv_chat: Atendimento 1-a-1 no Privado (PV)
 * 4. audio_voice: Disparo de Mensagens de Áudio / Voz (ZapVoice / PTT)
 * 5. media_dl: Downloads de Mídia (!play, músicas, vídeos, instagram, tiktok)
 * 6. stickers: Criação de Figurinhas (!s, !brat, !qc, !attp)
 * 7. games: Jogos, Cassino e Gamificação (!roleta, !cassino, !jogodavelha)
 * 8. moderation: Moderação de Grupos & Proteções (anti-link, anti-fake)
 * 9. auto_heating: Aquecimento Autônomo P2P entre chips
 */

const models = require('../db/models');

const FEATURE_DEFINITIONS = {
  ai: {
    id: 'ai',
    name: 'Inteligência Artificial',
    shortName: 'IA',
    desc: 'Respostas com IA (!ia, Simi, atendimento cognitivo)',
    icon: 'fa-brain',
    emoji: '🤖',
    default: true
  },
  group_posts: {
    id: 'group_posts',
    name: 'Postagens em Grupos',
    shortName: 'Divulgação',
    desc: 'Disparo de ofertas, catálogo e achadinhos em grupos',
    icon: 'fa-bullhorn',
    emoji: '📢',
    default: true
  },
  pv_chat: {
    id: 'pv_chat',
    name: 'Atendimento no PV',
    shortName: 'PV',
    desc: 'Respostas e vendas 1-a-1 no chat privado do WhatsApp',
    icon: 'fa-comment-dots',
    emoji: '💬',
    default: true
  },
  audio_voice: {
    id: 'audio_voice',
    name: 'Áudios & Voz',
    shortName: 'Áudios',
    desc: 'Disparo de mensagens humanizadas de voz e ZapVoice',
    icon: 'fa-microphone',
    emoji: '🎙️',
    default: true
  },
  media_dl: {
    id: 'media_dl',
    name: 'Downloads de Mídia',
    shortName: 'Downloads',
    desc: 'Comandos de download de músicas e vídeos (!play, !video)',
    icon: 'fa-download',
    emoji: '📥',
    default: true
  },
  stickers: {
    id: 'stickers',
    name: 'Figurinhas & Stickers',
    shortName: 'Stickers',
    desc: 'Criação de figurinhas estáticas e animadas (!s, !brat)',
    icon: 'fa-icons',
    emoji: '🎨',
    default: true
  },
  games: {
    id: 'games',
    name: 'Jogos & Gamificação',
    shortName: 'Jogos',
    desc: 'Gamificação, roleta, palpites e jogos de interação',
    icon: 'fa-gamepad',
    emoji: '🎲',
    default: true
  },
  moderation: {
    id: 'moderation',
    name: 'Moderação de Grupos',
    shortName: 'Moderação',
    desc: 'Anti-link, anti-fake, anti-delete e gestão de grupos',
    icon: 'fa-shield-halved',
    emoji: '🛡️',
    default: true
  },
  auto_heating: {
    id: 'auto_heating',
    name: 'Aquecimento P2P',
    shortName: 'Aquecimento',
    desc: 'Participação nas trocas de mensagens para maturação de chip',
    icon: 'fa-fire',
    emoji: '🔥',
    default: true
  }
};

class SubBotFeatureService {
  constructor() {
    this.definitions = FEATURE_DEFINITIONS;
  }

  getFeatureDefinitions() {
    return Object.values(this.definitions);
  }

  /**
   * Normaliza sinônimos e termos informados pelo operador
   */
  normalizeFeatureKey(term) {
    if (!term) return null;
    const clean = String(term).toLowerCase().trim().replace(/^[!/#.]/, '');

    if (['ai', 'ia', 'inteligencia', 'inteligência', 'cerebro', 'cérebro', 'gpt', 'gemini'].includes(clean)) return 'ai';
    if (['group_posts', 'groupposts', 'posts', 'postagens', 'grupos', 'divulgacao', 'divulgação', 'divu', 'ofertas', 'achadinhos'].includes(clean)) return 'group_posts';
    if (['pv_chat', 'pvchat', 'pv', 'privado', 'chat', 'atendimento', '1a1'].includes(clean)) return 'pv_chat';
    if (['audio_voice', 'audiovoice', 'audio', 'áudio', 'audios', 'áudios', 'voz', 'zapvoice', 'ptt', 'voice'].includes(clean)) return 'audio_voice';
    if (['media_dl', 'mediadl', 'dl', 'download', 'downloads', 'musica', 'música', 'play', 'video', 'vídeo', 'yt', 'insta', 'tiktok'].includes(clean)) return 'media_dl';
    if (['stickers', 'sticker', 's', 'fig', 'figurinhas', 'figurinha', 'brat', 'qc', 'attp'].includes(clean)) return 'stickers';
    if (['games', 'game', 'jogo', 'jogos', 'cassino', 'roleta', 'jogodavelha'].includes(clean)) return 'games';
    if (['moderation', 'mod', 'moderacao', 'moderação', 'antilink', 'antifake', 'antidelete'].includes(clean)) return 'moderation';
    if (['auto_heating', 'autoheating', 'aquecimento', 'aquec', 'aquecer', 'aquecendo', 'heating', 'warmup', 'p2p'].includes(clean)) return 'auto_heating';
    if (['all', 'tudo', 'todos', 'todas', 'full', '*'].includes(clean)) return 'all';

    return null;
  }

  /**
   * Valida se a entidade solicitante tem permissão:
   * 1. Dono Supremo (Owner / ROwner)
   * 2. Devs de Suporte (support_devs)
   * 3. Bot Master (Matriz ID 1 ou fromMe no Master)
   */
  isOperatorAuthorized({ senderPhone, isOwner = false, isROwner = false, isMaster = false }) {
    if (isOwner || isROwner || isMaster) return true;

    const clean = String(senderPhone || '').replace(/\D/g, '');
    if (!clean) return false;

    // 1. Checa Dono Supremo por telefone
    let ownerPhone = '';
    try {
      const commandAuditService = require('./commandAuditService');
      ownerPhone = (commandAuditService.getOwnerPhone() || '554884702848').replace(/\D/g, '');
    } catch (_) {
      ownerPhone = '554884702848';
    }

    if (clean === ownerPhone || (clean.length >= 8 && ownerPhone.endsWith(clean.slice(-8)))) {
      return true;
    }

    // 2. Checa Desenvolvedor de Suporte (Dev)
    try {
      if (typeof models.isSupportDev === 'function' && models.isSupportDev(clean)) {
        return true;
      }
    } catch (_) {}

    return false;
  }

  /**
   * Verifica se um comando PayBot é permitido para o Sub-Bot
   */
  isCommandAllowedForSubBot(instanceId, commandName, cmdDef = null) {
    if (!instanceId || Number(instanceId) <= 1) {
      return { allowed: true };
    }

    const sId = Number(instanceId);
    const cmd = String(commandName || '').toLowerCase().trim();
    const tags = Array.isArray(cmdDef?.tags) ? cmdDef.tags.map(t => String(t).toLowerCase()) : [];

    // 1. Inteligência Artificial
    const isAiCmd = ['ia', 'simi', 'mente', 'gemini', 'gpt', 'chatgpt'].includes(cmd) || tags.includes('ai') || tags.includes('ia');
    if (isAiCmd && !models.isSubBotFeatureEnabled(sId, 'ai')) {
      return {
        allowed: false,
        featureKey: 'ai',
        featureName: 'Inteligência Artificial',
        message: '⚠️ *Função Desativada:* A função de *Inteligência Artificial (!ia)* está desativada neste chip pelo Dono/Bot Master.'
      };
    }

    // 2. Criação de Figurinhas
    const isStickerCmd = ['s', 'sticker', 'fig', 'brat', 'qc', 'attp', 'attp2', 'emojimix'].includes(cmd) || tags.includes('sticker');
    if (isStickerCmd && !models.isSubBotFeatureEnabled(sId, 'stickers')) {
      return {
        allowed: false,
        featureKey: 'stickers',
        featureName: 'Figurinhas & Stickers',
        message: '⚠️ *Função Desativada:* A criação de *Figurinhas (!s, !brat)* está desativada neste chip pelo Dono/Bot Master.'
      };
    }

    // 3. Downloads de Mídia
    const isMediaCmd = ['play', 'playdoc', 'video', 'tiktok', 'ig', 'insta', 'yt', 'download', 'dl', 'baixar'].includes(cmd) || tags.includes('downloader');
    if (isMediaCmd && !models.isSubBotFeatureEnabled(sId, 'media_dl')) {
      return {
        allowed: false,
        featureKey: 'media_dl',
        featureName: 'Downloads de Mídia',
        message: '⚠️ *Função Desativada:* O download de *Mídias (!play, vídeos)* está desativado neste chip pelo Dono/Bot Master.'
      };
    }

    // 4. Jogos e Gamificação
    const isGameCmd = ['roleta', 'cassino', 'jogodavelha', 'dado', 'caraoucoroa', 'ppt', 'tictactoe', 'sopa', 'matematica'].includes(cmd) || tags.includes('game');
    if (isGameCmd && !models.isSubBotFeatureEnabled(sId, 'games')) {
      return {
        allowed: false,
        featureKey: 'games',
        featureName: 'Jogos & Gamificação',
        message: '⚠️ *Função Desativada:* Os *Jogos e Cassino* estão desativados neste chip pelo Dono/Bot Master.'
      };
    }

    return { allowed: true };
  }

  /**
   * Executa a alteração de funções para os sub-bots selecionados
   * @param {Object} params
   * @param {string|number|Array<number>} params.targetIds - IDs selecionados (ex: '2', [2, 3], '2,3,4', 'all')
   * @param {string} params.featureKey - Chave da função (ou 'all' para todas)
   * @param {boolean} params.enabled - true para ativar, false para desativar
   * @param {string} params.operatorPhone - Telefone de quem executou
   * @param {string} params.operatorName - Nome do operador (Dono, Dev, Bot Master)
   */
  async executeFeatureToggle({ targetIds, featureKey, enabled, operatorPhone = 'owner', operatorName = 'Dono Supremo' }) {
    const key = this.normalizeFeatureKey(featureKey);
    if (!key) {
      throw new Error(`Função "${featureKey}" não reconhecida. Use: ia, posts, pv, audio, dl, stickers, games, mod, heating ou all.`);
    }

    const allSubbots = models.getArmyInstances().filter(i => !i.is_main && i.id !== 1);
    if (allSubbots.length === 0) {
      throw new Error('Nenhum sub-bot cadastrado no Exército WhatsApp.');
    }

    // Resolve lista de instâncias alvo
    let selectedIds = [];
    if (targetIds === 'all' || targetIds === '*' || (Array.isArray(targetIds) && targetIds.includes('all'))) {
      selectedIds = allSubbots.map(i => i.id);
    } else if (Array.isArray(targetIds)) {
      selectedIds = targetIds.map(Number).filter(id => id > 1);
    } else {
      selectedIds = String(targetIds).split(/[\s,]+/).map(Number).filter(id => id > 1);
    }

    if (selectedIds.length === 0) {
      throw new Error('Nenhum sub-bot selecionado. Informe os IDs desejados (ex: 2 ou 2,3,4) ou "all".');
    }

    // Monta o patch de features a aplicar
    const patch = {};
    if (key === 'all') {
      Object.keys(this.definitions).forEach(fKey => {
        patch[fKey] = Boolean(enabled);
      });
    } else {
      patch[key] = Boolean(enabled);
    }

    const updatedInstances = [];
    for (const instId of selectedIds) {
      const inst = allSubbots.find(i => i.id === instId);
      if (!inst) continue;

      const currentFeats = models.getSubBotFeatures(instId);
      const newFeats = { ...currentFeats, ...patch };

      // Se for a função 'ai', sincroniza também ai_enabled no banco
      if (patch.ai !== undefined) {
        models.updateArmyInstance(instId, {
          enabled_features: JSON.stringify(newFeats),
          ai_enabled: patch.ai ? 1 : 0
        });
      } else {
        models.updateArmyInstance(instId, {
          enabled_features: JSON.stringify(newFeats)
        });
      }

      updatedInstances.push({
        id: instId,
        name: inst.name,
        phone: inst.phone,
        features: newFeats
      });
    }

    // Registra auditoria da alteração
    try {
      models.logGroupAdminAction({
        platform: 'whatsapp',
        groupId: 'subbots_fleet',
        adminId: operatorPhone,
        adminName: operatorName,
        action: 'SUBBOT_FEATURES_UPDATE',
        details: `Subbots [${selectedIds.join(', ')}]: função ${key} definida como ${enabled ? 'ATIVADA' : 'DESATIVADA'} por ${operatorName}`
      });
    } catch (_) {}

    return {
      success: true,
      updatedCount: updatedInstances.length,
      featureKey: key,
      featureName: key === 'all' ? 'Todas as Funções' : this.definitions[key]?.name,
      enabled: Boolean(enabled),
      instances: updatedInstances
    };
  }

  /**
   * Gera relatório formatado em Markdown para WhatsApp/Telegram
   */
  formatStatusCard(targetIds = 'all') {
    const allSubbots = models.getArmyInstances().filter(i => !i.is_main && i.id !== 1);
    if (allSubbots.length === 0) {
      return '📋 *EXÉRCITO DE SUB-BOTS:* Nenhum sub-bot conectado no momento.';
    }

    let targets = allSubbots;
    if (targetIds && targetIds !== 'all') {
      const idList = Array.isArray(targetIds) ? targetIds.map(Number) : String(targetIds).split(/[\s,]+/).map(Number);
      targets = allSubbots.filter(i => idList.includes(i.id));
    }

    let report = `🎛️ *PAINEL DE FUNÇÕES DOS SUB-BOTS* 🎛️\n` +
      `_Gerenciado pelo Dono Supremo, Devs e Bot Master_\n\n` +
      `👥 *Chips Selecionados:* ${targets.length} sub-bot(s)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    targets.forEach(inst => {
      const feats = models.getSubBotFeatures(inst.id);
      const isOnline = inst.status === 'CONNECTED';
      const cleanPhone = (inst.phone || '').replace(/\D/g, '');

      report += `🤖 *Sub-Bot #${inst.id}: ${inst.name}*\n` +
        `📱 *Número:* ${cleanPhone ? `+${cleanPhone}` : 'Não vinculado'} | ${isOnline ? '🟢 Online' : '⚪ Standby'}\n` +
        `⚙️ *Funções:* \n` +
        `  • 🤖 *IA / Cognição:* ${feats.ai ? '🟢 Ativa' : '🔴 Inativa'}\n` +
        `  • 📢 *Divulgação / Grupos:* ${feats.group_posts ? '🟢 Ativa' : '🔴 Inativa'}\n` +
        `  • 💬 *Atendimento PV:* ${feats.pv_chat ? '🟢 Ativo' : '🔴 Inativo'}\n` +
        `  • 🎙️ *Áudios / Voz:* ${feats.audio_voice ? '🟢 Ativo' : '🔴 Inativo'}\n` +
        `  • 📥 *Downloads:* ${feats.media_dl ? '🟢 Ativo' : '🔴 Inativo'}\n` +
        `  • 🎨 *Figurinhas:* ${feats.stickers ? '🟢 Ativa' : '🔴 Inativa'}\n` +
        `  • 🎲 *Jogos & Cassino:* ${feats.games ? '🟢 Ativo' : '🔴 Inativo'}\n` +
        `  • 🛡️ *Moderação:* ${feats.moderation ? '🟢 Ativa' : '🔴 Inativa'}\n` +
        `  • 🔥 *Aquecimento P2P:* ${feats.auto_heating ? '🟢 Ativo' : '🔴 Inativo'}\n` +
        `────────────────────────────\n`;
    });

    report += `\n💡 *Como Ativar / Desativar:*\n` +
      `• *!subbotfunc <id|all> <funcao> on* — Ativa a função\n` +
      `• *!subbotfunc <id|all> <funcao> off* — Desativa a função\n` +
      `• *!subbotfunc 2,3,4 ai off* — Desativa IA nos chips 2, 3 e 4\n` +
      `• *!subbotfunc all games off* — Desativa jogos em todos os chips\n\n` +
      `📌 *Funções aceitas:* \`ia\`, \`posts\`, \`pv\`, \`audio\`, \`dl\`, \`stickers\`, \`games\`, \`mod\`, \`heating\`, \`all\``;

    return report;
  }

  /**
   * Trata comando de controle de funções de sub-bots enviado via chat
   */
  async handleCommand(sock, from, text, senderPhone, isGroup, isAdmin = false, isOwner = false, isMaster = false) {
    const rawParts = (text || '').trim().split(/\s+/);
    const cleanCmd = (rawParts[0] || '').replace(/^[!/#.]/, '').toLowerCase();

    // 1. Validação estrita de autorização
    const isAuthorized = this.isOperatorAuthorized({ senderPhone, isOwner, isMaster });
    if (!isAuthorized) {
      return sock.sendMessage(from, {
        text: '⛔ *Acesso Negado:* Apenas o Dono Supremo, Desenvolvedores de Suporte (Devs) ou o Bot Master têm permissão para ativar ou desativar funções dos Sub-Bots.'
      });
    }

    // Se o comando for consulta (!subbotfuncoes ou !funcoessubbot sem args adicionais)
    if (['subbotfuncoes', 'subbotfunções', 'funcoessubbot', 'funçõessubbot'].includes(cleanCmd) && rawParts.length <= 2) {
      const targetArg = rawParts[1] || 'all';
      const card = this.formatStatusCard(targetArg);
      return sock.sendMessage(from, { text: card });
    }

    // Se o comando for !subbotfunc sem argumentos suficientes
    if (rawParts.length < 3) {
      return sock.sendMessage(from, {
        text: `🎛️ *COMANDO DE FUNÇÕES DE SUB-BOTS* 🎛️\n\n` +
              `*Uso correto:*\n` +
              `• *!subbotfunc <id|all> <funcao> <on|off>*\n\n` +
              `*Exemplos práticos:*\n` +
              `• \`!subbotfunc 2 ia off\` — Desativa IA no Chip #2\n` +
              `• \`!subbotfunc 2,3,4 posts on\` — Ativa divulgação nos Chips #2, #3 e #4\n` +
              `• \`!subbotfunc all games off\` — Desativa jogos em todos os chips\n` +
              `• \`!subbotfunc 2 all on\` — Ativa todas as funções no Chip #2\n\n` +
              `*Funções disponíveis:*\n` +
              `\`ia\`, \`posts\`, \`pv\`, \`audio\`, \`dl\`, \`stickers\`, \`games\`, \`mod\`, \`heating\`, \`all\``
      });
    }

    const targetArg = rawParts[1];
    const featureArg = rawParts[2];
    const actionArg = (rawParts[3] || '').toLowerCase().trim();

    const isEnable = ['on', 'ativar', 'ligar', '1', 'enable', 'true', 'sim'].includes(actionArg);
    const isDisable = ['off', 'desativar', 'desligar', '0', 'disable', 'false', 'nao', 'não'].includes(actionArg);

    if (!isEnable && !isDisable) {
      return sock.sendMessage(from, {
        text: `⚠️ Ação inválida: "${actionArg}". Use *on* para ativar ou *off* para desativar.`
      });
    }

    try {
      const operatorName = isOwner ? 'Dono Supremo' : (isMaster ? 'Bot Master' : 'Dev de Suporte');
      const result = await this.executeFeatureToggle({
        targetIds: targetArg,
        featureKey: featureArg,
        enabled: isEnable,
        operatorPhone: senderPhone,
        operatorName
      });

      const emojiStatus = isEnable ? '🟢 *ATIVADA*' : '🔴 *DESATIVADA*';
      const instancesList = result.instances.map(i => `• Chip #${i.id} (${i.name})`).join('\n');

      return sock.sendMessage(from, {
        text: `✅ *FUNÇÃO ATUALIZADA COM SUCESSO!* 🎛️\n\n` +
              `⚙️ *Função:* *${result.featureName}*\n` +
              `📊 *Novo Status:* ${emojiStatus}\n` +
              `👑 *Autorizado por:* ${operatorName}\n` +
              `👥 *Sub-Bots Atualizados (${result.updatedCount}):*\n${instancesList}\n\n` +
              `💡 _Para conferir a tabela completa, envie: *!subbotfuncoes*_`
      });
    } catch (err) {
      return sock.sendMessage(from, {
        text: `❌ *Erro ao atualizar função de sub-bots:* ${err.message}`
      });
    }
  }
}

module.exports = new SubBotFeatureService();

/**
 * ============================================================================
 * 👥 MEMBER REFERRAL SERVICE - PILAR 5: INDIQUE & GANHE VIRAL NOS GRUPOS
 * ============================================================================
 * Transforma membros de grupos em embaixadores ativos de crescimento orgânico:
 *
 * 1. Comandos no Grupo:
 *    - !meulink / !indicar: Gera link rastreável exclusivo de convite.
 *    - !meusconvites / !pontos: Mostra pontuação e distância até o próximo prêmio.
 *    - !ranking / !topindicadores: Top 5 membros que mais adicionaram pessoas.
 *    - !regrasindicacao: Metas e prêmios (3, 5 e 10 amigos).
 *
 * 2. Reconhecimento Automático de Entrada (group-participants.update):
 *    - Detecta quem adicionou novos membros ao grupo.
 *    - Celebra publicamente no grupo com menção de destaque.
 *    - Entrega cupom de 15% OFF VIP gerado na hora direto no PV do indicador.
 * ============================================================================
 */

const models = require('../db/models');

class MemberReferralService {
  constructor() {
    this.milestones = [
      { count: 3, label: 'Cupom de 15% OFF VIP', type: 'coupon_15' },
      { count: 5, label: 'Acesso à Lista Secreta de Lançamentos', type: 'vip_access' },
      { count: 10, label: 'Brinde Exclusivo da Loja PayBot', type: 'special_gift' }
    ];
  }

  /**
   * Processa comandos de indicação enviados no grupo
   */
  async handleReferralCommand(sock, groupJid, senderJid, text, isGroup = true) {
    if (!isGroup || !groupJid || !groupJid.endsWith('@g.us')) {
      return sock.sendMessage(senderJid, {
        text: '⚠️ Esse recurso é exclusivo para grupos! Use o comando *!meulink* dentro de um dos nossos grupos de ofertas.'
      });
    }

    const lower = text.trim().toLowerCase();
    const cleanPhone = senderJid.split('@')[0].replace(/\D/g, '');

    // 1. Comando: !meulink / !indicar
    if (/^(?:!|\/)(?:meulink|indicar|convidar|linkconvite|meuconvite)$/i.test(lower)) {
      let inviteUrl = null;
      try {
        if (typeof sock.groupInviteCode === 'function') {
          const code = await sock.groupInviteCode(groupJid);
          if (code) inviteUrl = `https://chat.whatsapp.com/${code}`;
        }
      } catch (_) {}

      if (!inviteUrl) {
        inviteUrl = 'https://chat.whatsapp.com/convite-vip';
      }

      const count = models.getMemberReferralCount(groupJid, senderJid);
      const nextMilestone = this.milestones.find(m => m.count > count) || this.milestones[this.milestones.length - 1];
      const remaining = Math.max(0, nextMilestone.count - count);

      const msg = `🎁 *PROGRAMA INDIQUE & GANHE OFICIAL* 🚀\n\n` +
        `Olá @${cleanPhone}! Convide seus amigos para este grupo e desbloqueie recompensas exclusivas:\n\n` +
        `🔗 *Seu link de convite do grupo:*\n${inviteUrl}\n\n` +
        `🏆 *Tabela de Prêmios:*\n` +
        `• *3 amigos:* Cupom de 15% OFF VIP\n` +
        `• *5 amigos:* Acesso à Lista VIP de Lançamentos\n` +
        `• *10 amigos:* Brinde Exclusivo da Loja\n\n` +
        `📊 *Seu progresso:* Você já indicou *${count}* amigo(s).\n` +
        (remaining > 0 ? `👉 Faltam apenas *${remaining}* para liberar: *${nextMilestone.label}*!\n\n` : `🎉 *Você já atingiu as metas principais! Continue convidando!*\n\n`) +
        `_Dica: Você pode compartilhar o link acima ou adicionar seus amigos diretamente neste grupo!_`;

      return sock.sendMessage(groupJid, {
        text: msg,
        mentions: [senderJid]
      });
    }

    // 2. Comando: !meusconvites / !pontos
    if (/^(?:!|\/)(?:meusconvites|pontos|meuspontos|minhasindicacoes)$/i.test(lower)) {
      const count = models.getMemberReferralCount(groupJid, senderJid);
      const nextMilestone = this.milestones.find(m => m.count > count);

      let statusMsg = `📊 *SEUS PONTOS DE INDICAÇÃO*\n\n` +
        `Membro: @${cleanPhone}\n` +
        `Total de amigos convidados: *${count}*\n\n`;

      if (nextMilestone) {
        const diff = nextMilestone.count - count;
        statusMsg += `🎯 *Próxima Meta:* ${nextMilestone.label}\n` +
          `Faltam apenas *${diff} amigo(s)* para desbloquear!\n\n` +
          `Use *!meulink* para pegar seu link de compartilhamento.`;
      } else {
        statusMsg += `🏆 *PARABÉNS!* Você completou todas as metas de indicação deste grupo! Em breve novas missões exclusivas.`;
      }

      return sock.sendMessage(groupJid, {
        text: statusMsg,
        mentions: [senderJid]
      });
    }

    // 3. Comando: !ranking / !topindicadores
    if (/^(?:!|\/)(?:ranking|topindicadores|topindica|rankindicacoes)$/i.test(lower)) {
      const ranking = models.getGroupReferralRanking(groupJid, 5);

      if (!ranking || ranking.length === 0) {
        return sock.sendMessage(groupJid, {
          text: `🏆 *RANKING DE INDICAÇÕES DO GRUPO*\n\nNenhum amigo foi convidado ainda nesta rodada!\n\nSeja o primeiro a pontuar usando o comando *!meulink*!`
        });
      }

      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const mentions = [];
      let rankText = `🏆 *TOP 5 MAIORES INDICADORES DO GRUPO* 🚀\n\n`;

      ranking.forEach((r, idx) => {
        const medal = medals[idx] || '⭐';
        const pPhone = r.referrer_jid.split('@')[0].replace(/\D/g, '');
        mentions.push(r.referrer_jid);
        rankText += `${medal} *${idx + 1}º Lugar:* @${pPhone} — *${r.referrals_count}* amigos\n`;
      });

      rankText += `\n👉 Quer entrar no ranking e ganhar prêmios? Digite *!meulink* e chame seus amigos!`;

      return sock.sendMessage(groupJid, {
        text: rankText,
        mentions
      });
    }

    // 4. Comando: !regrasindicacao
    if (/^(?:!|\/)(?:regrasindicacao|regrasindica|comofuncionaindica)$/i.test(lower)) {
      const rules = `📜 *REGRAS DO INDIQUE & GANHE PAYBOT*\n\n` +
        `1. Digite *!meulink* para receber seu link de convite oficial.\n` +
        `2. Envie o link para seus amigos ou adicione-os diretamente no grupo.\n` +
        `3. Cada pessoa que entrar conta como 1 ponto.\n` +
        `4. Ao atingir as metas (3, 5 e 10 amigos), o prêmio é liberado na hora!\n` +
        `5. Os cupons de desconto são enviados automaticamente no seu privado (PV).\n\n` +
        `Participe agora mesmo e aproveite as vantagens! 💥`;

      return sock.sendMessage(groupJid, { text: rules });
    }
  }

  /**
   * Monitora quando participantes entram ou são adicionados no grupo
   */
  async handleParticipantJoined(sock, groupJid, newParticipants, actorJid = null) {
    if (!newParticipants || !newParticipants.length) return;
    if (!actorJid) return;

    // Se quem adicionou foi o próprio bot, não pontua
    const botUserJid = sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
    if (botUserJid && actorJid.includes(botUserJid.split('@')[0])) return;

    const actorPhone = actorJid.split('@')[0].replace(/\D/g, '');
    let addedCount = 0;

    for (const participant of newParticipants) {
      const res = models.recordMemberReferral(groupJid, actorJid, participant);
      if (res && res.recorded) {
        addedCount++;
      }
    }

    if (addedCount === 0) return;

    const totalCount = models.getMemberReferralCount(groupJid, actorJid);

    // Verifica se desbloqueou algum prêmio de marco (3, 5, 10)
    const unlocked = models.checkAndUnlockMilestoneReward(groupJid, actorJid, totalCount);

    if (unlocked && unlocked.length > 0) {
      for (const reward of unlocked) {
        // 1. Mensagem de celebração no grupo
        const groupMsg = `🎉 *CONQUISTA DESBLOQUEADA!* 🚀\n\n` +
          `Parabéns @${actorPhone}! Você acabou de convidar seu *${reward.milestone}º amigo* para o grupo e conquistou o prêmio:\n` +
          `🎁 *${reward.description}*!\n\n` +
          `Acabei de te chamar no privado com o seu presente exclusivo! Verifique suas mensagens! 👊`;

        try {
          await sock.sendMessage(groupJid, {
            text: groupMsg,
            mentions: [actorJid]
          });
        } catch (_) {}

        // 2. Entrega do prêmio no privado (PV) do indicador
        let pvMsg = '';
        if (reward.reward_type === 'coupon_15') {
          pvMsg = `🎉 *PARABÉNS, VOCÊ GANHOU!* 🎁\n\n` +
            `Você indicou amigos para o grupo e desbloqueou seu *Cupom VIP de 15% de Desconto*!\n\n` +
            `🎟️ Seu Cupom: *${reward.payload}*\n` +
            `⏰ Válido para qualquer compra na nossa loja online!\n\n` +
            `Aproveite seu desconto e continue convidando amigos para desbloquear novos prêmios! 🚀`;
        } else {
          pvMsg = `🎉 *PARABÉNS!* 🎁\n\nVocê conquistou o prêmio *${reward.description}* por indicar amigos para o grupo!\n\nNossa equipe já registrou sua premiação. Qualquer dúvida, é só responder por aqui! 👊`;
        }

        try {
          await sock.sendMessage(actorJid, { text: pvMsg });
          console.log(`[MemberReferral 🎁 Prêmio Entregue no PV]: ${actorPhone} -> ${reward.description} (${reward.payload})`);
        } catch (err) {
          console.warn(`[MemberReferral ⚠️ Falha ao entregar no PV de ${actorPhone}]:`, err.message);
        }
      }
    }
  }
}

module.exports = new MemberReferralService();

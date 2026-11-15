/**
 * =========================================================================
 * 🛡️ GROUP ADMIN & OWNER EXTRA SERVICE - PAYBOT TECH
 * =========================================================================
 * Ferramentas de Administração Avançada de Grupos e Controle do Dono:
 * 1. Adicionar Membro pelo Número (!add)
 * 2. Revogar e Resetar Link de Convite (!revoke / !resetlink)
 * 3. Mudar Nome / Assunto do Grupo (!setname)
 * 4. Mudar Descrição do Grupo (!setdesc)
 * 5. Varredura e Expulsão por DDI Estrangeiro (!listanum / !kicknum)
 * 6. Mudar Foto de Perfil do Bot WhatsApp (!setppbot)
 * 7. Fazer o Bot Entrar em Grupo por Link (!join)
 * =========================================================================
 */

const models = require('../db/models');

class GroupAdminExtraService {

  /**
   * 1. Adiciona Participante ao Grupo (!add / !adicionar)
   */
  async addParticipant(conn, groupJid, rawPhone, extra = {}) {
    const spyFeatures = require('./spyFeaturesService');
    return spyFeatures.handleAddParticipant(conn, groupJid, {
      text: `!add ${rawPhone || ''}`,
      args: rawPhone ? [String(rawPhone)] : [],
      isAdmin: true,
      isBotAdmin: true,
      ...extra
    });
  }

  /**
   * 2. Revoga e Redefine Link de Convite (!revoke / !resetlink)
   */
  async revokeInvite(conn, groupJid) {
    if (!conn || typeof conn.groupRevokeInvite !== 'function') {
      throw new Error('O bot precisa ser Administrador para revogar o link do grupo.');
    }

    const newCode = await conn.groupRevokeInvite(groupJid);
    const newLink = newCode ? `https://chat.whatsapp.com/${newCode}` : null;

    return {
      code: newCode,
      link: newLink
    };
  }

  /**
   * 3. Altera o Título / Nome do Grupo (!setname)
   */
  async setGroupName(conn, groupJid, newName) {
    if (!conn || typeof conn.groupUpdateSubject !== 'function') {
      throw new Error('O bot precisa ser Administrador para alterar o nome do grupo.');
    }
    const safeName = String(newName || '').trim().slice(0, 100);
    if (!safeName) throw new Error('Informe o novo nome do grupo.');

    await conn.groupUpdateSubject(groupJid, safeName);
    return safeName;
  }

  /**
   * 4. Altera a Descrição do Grupo (!setdesc)
   */
  async setGroupDescription(conn, groupJid, newDesc) {
    if (!conn || typeof conn.groupUpdateDescription !== 'function') {
      throw new Error('O bot precisa ser Administrador para alterar a descrição do grupo.');
    }
    const safeDesc = String(newDesc || '').trim().slice(0, 512);

    await conn.groupUpdateDescription(groupJid, safeDesc);
    return safeDesc;
  }

  /**
   * 5. Lista ou Expulsa Participantes por DDI Estrangeiro (!listanum / !kicknum)
   */
  async filterParticipantsByDdi(conn, groupJid, ddi, shouldKick = false) {
    if (!conn || typeof conn.groupMetadata !== 'function') {
      throw new Error('Não foi possível obter os dados do grupo.');
    }

    const cleanDdi = String(ddi || '').replace(/\D/g, '');
    if (!cleanDdi) throw new Error('Informe o DDI (ex: !listanum 1 para EUA, !listanum 92 para Paquistão).');

    const metadata = await conn.groupMetadata(groupJid);
    const participants = metadata?.participants || [];

    const matches = [];
    for (const p of participants) {
      const phone = (p.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
      const isOwner = models.isOwner(p.id) || models.isOwner(phone);

      if (phone.startsWith(cleanDdi) && !isAdmin && !isOwner) {
        matches.push({
          id: p.id,
          phone
        });
      }
    }

    if (shouldKick && matches.length > 0 && conn.groupParticipantsUpdate) {
      const jidsToKick = matches.map(m => m.id);
      await conn.groupParticipantsUpdate(groupJid, jidsToKick, 'remove');
    }

    return {
      ddi: cleanDdi,
      count: matches.length,
      kicked: shouldKick,
      members: matches
    };
  }

  /**
   * 6. Altera Foto de Perfil do Bot WhatsApp (!setppbot)
   */
  async setBotProfilePicture(conn, imageBuffer) {
    if (!conn || typeof conn.updateProfilePicture !== 'function') {
      throw new Error('Função de alterar foto de perfil não disponível.');
    }

    const botJid = conn.user?.id ? (conn.user.id.split(':')[0] + '@s.whatsapp.net') : null;
    if (!botJid) throw new Error('Bot não conectado.');

    await conn.updateProfilePicture(botJid, imageBuffer);
    return true;
  }

  /**
   * 7. Entra em Grupo por Link de Convite (!join)
   */
  async joinGroupByLink(conn, inviteLink) {
    if (!conn || typeof conn.groupAcceptInvite !== 'function') {
      throw new Error('Instância do WhatsApp não pronta.');
    }

    const match = String(inviteLink || '').match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
    if (!match || !match[1]) {
      throw new Error('Link de convite do grupo inválido.');
    }

    const code = match[1];
    const groupId = await conn.groupAcceptInvite(code);
    return {
      code,
      groupId
    };
  }

  /**
   * 8. Puxar Foto de Perfil em Alta Resolução (!getpp / !getppgc)
   */
  async getUserProfilePic(conn, jid) {
    if (!conn || typeof conn.profilePictureUrl !== 'function') {
      throw new Error('Instância do WhatsApp não disponível.');
    }
    try {
      const url = await conn.profilePictureUrl(jid, 'image');
      return url;
    } catch (_) {
      return 'https://i.ibb.co/vzB71Yv/default-avatar.png';
    }
  }

  /**
   * 9. Puxar Biografia / Recado do Usuário (!getbio)
   */
  async getUserBio(conn, jid) {
    if (!conn || typeof conn.fetchStatus !== 'function') {
      throw new Error('Instância do WhatsApp não disponível.');
    }
    try {
      const statusObj = await conn.fetchStatus(jid);
      return statusObj?.status || 'Sem recado configurado.';
    } catch (_) {
      return 'Recado privado ou indisponível.';
    }
  }

  /**
   * 10. Alternar Mensagens Temporárias no Grupo (!ephemeral)
   */
  async toggleGroupEphemeral(conn, groupJid, option = 'on') {
    if (!conn || typeof conn.groupToggleEphemeral !== 'function') {
      throw new Error('O bot precisa ser Administrador para alterar mensagens temporárias.');
    }

    const opt = String(option).toLowerCase();
    let seconds = 86400; // Padrão: 24 horas

    if (opt === 'off' || opt === 'desativar' || opt === '0') {
      seconds = 0;
    } else if (opt === '7' || opt === '7d') {
      seconds = 604800; // 7 dias
    } else if (opt === '90' || opt === '90d') {
      seconds = 7776000; // 90 dias
    } else if (opt === '24' || opt === '24h' || opt === '1d' || opt === 'on') {
      seconds = 86400; // 24 horas
    }

    await conn.groupToggleEphemeral(groupJid, seconds);
    return {
      seconds,
      status: seconds === 0 ? 'Desativado' : `${seconds / 86400} dia(s)`
    };
  }

  /**
   * 11. Silenciador Temporário de Emergência (!diem / !silent)
   */
  async muteGroupTemporarily(conn, groupJid, minutes = 5) {
    if (!conn || typeof conn.groupSettingUpdate !== 'function') {
      throw new Error('O bot precisa ser Administrador para silenciar o grupo.');
    }

    const durationMin = Math.max(1, Math.min(120, parseInt(minutes, 10) || 5));
    await conn.groupSettingUpdate(groupJid, 'announcement');

    // Agenda reabertura automática
    setTimeout(async () => {
      try {
        await conn.groupSettingUpdate(groupJid, 'not_announcement');
        await conn.sendMessage(groupJid, { text: '🔔 *O grupo foi reaberto automaticamente!* Todos podem enviar mensagens novamente.' });
      } catch (_) {}
    }, durationMin * 60 * 1000);

    return durationMin;
  }

  /**
   * 12. Remover Foto de Perfil do Grupo (!delppgc)
   */
  async removeGroupProfilePic(conn, groupJid) {
    if (!conn || typeof conn.removeProfilePicture !== 'function') {
      throw new Error('O bot precisa ser Administrador para remover a foto do grupo.');
    }
    await conn.removeProfilePicture(groupJid);
    return true;
  }

  /**
   * 13. Remover Foto de Perfil do Próprio Bot (!delppbot)
   */
  async removeBotProfilePic(conn) {
    if (!conn || typeof conn.removeProfilePicture !== 'function') {
      throw new Error('Bot não conectado.');
    }
    const botJid = conn.user?.id ? (conn.user.id.split(':')[0] + '@s.whatsapp.net') : null;
    if (!botJid) throw new Error('JID do bot não localizado.');
    await conn.removeProfilePicture(botJid);
    return true;
  }

  /**
   * 14. Enviar Backup do Banco SQLite ao Dono (!backup)
   */
  async backupDatabaseToOwner(conn, targetJid) {
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');
    const possiblePaths = [
      config.dbPath,
      path.join(process.cwd(), 'data', 'database.sqlite'),
      path.join(process.cwd(), 'data', 'paybot.db')
    ];
    const dbPath = possiblePaths.find(p => p && fs.existsSync(p));

    if (!dbPath) {
      throw new Error('Arquivo do banco de dados SQLite não encontrado.');
    }

    const dbBuffer = fs.readFileSync(dbPath);
    const dateStr = new Date().toISOString().slice(0, 10);

    return await conn.sendMessage(targetJid, {
      document: dbBuffer,
      mimetype: 'application/x-sqlite3',
      fileName: `PayBot_Backup_${dateStr}.db`,
      caption: `📦 *BACKUP DO BANCO DE DADOS PAYBOT (SQLITE)*\n\n📅 Data: ${new Date().toLocaleString('pt-BR')}\n⚖️ Tamanho: ${(dbBuffer.length / (1024 * 1024)).toFixed(2)} MB`
    });
  }

  /**
   * 15. Limpeza de Arquivos de Sessões Órfãs Signal (!clearsessions)
   */
  cleanSignalSessions() {
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');
    const authDir = config.whatsapp?.authFolder || path.join(process.cwd(), 'data', 'whatsapp_auth');

    let deleted = 0;
    if (fs.existsSync(authDir)) {
      const files = fs.readdirSync(authDir);
      for (const f of files) {
        // Preserva estritamente creds.json!
        if (f !== 'creds.json' && (f.startsWith('pre-key') || f.startsWith('session-') || f.startsWith('sender-key-memory'))) {
          try {
            fs.unlinkSync(path.join(authDir, f));
            deleted++;
          } catch (_) {}
        }
      }
    }
    return deleted;
  }

  /**
   * 16. Ler Código-Fonte de Plugin / Serviço (!pluginget)
   */
  getPluginSourceCode(pluginName) {
    const fs = require('fs');
    const path = require('path');
    const cleanName = String(pluginName).replace(/[^a-zA-Z0-9_.-]/g, '');

    const candidates = [
      path.join(process.cwd(), 'src', 'services', `${cleanName}.js`),
      path.join(process.cwd(), 'src', 'services', cleanName),
      path.join(process.cwd(), 'src', `${cleanName}.js`),
      path.join(process.cwd(), 'src', cleanName)
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        return {
          filename: path.basename(p),
          content: content.slice(0, 2500)
        };
      }
    }

    throw new Error(`Arquivo ou plugin "${pluginName}" não encontrado.`);
  }
}

module.exports = new GroupAdminExtraService();

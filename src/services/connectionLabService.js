/**
 * =========================================================================
 * 🧪 CONNECTION LAB SERVICE (LABORATÓRIO OPERACIONAL DE CONEXÕES)
 * =========================================================================
 * Permite ao Dono e Operador escolher uma CONEXÃO ATIVA NO MOMENTO
 * (WhatsApp Matriz, Sub-Bots do Exército de Chips, Telegram) para entrar no
 * LAB dedicado dessa conexão, selecionar comandos, adicionar inputs e
 * obter o RESULTADO DIRETO da conexão instantaneamente, SEM poluição ou
 * histórico de comandos executados no painel.
 * =========================================================================
 */

const models = require('../db/models');
const config = require('../config');

class ConnectionLabService {
  constructor() {
    this.DEFAULT_OWNER_PHONE = '554884702848';
  }

  /**
   * 1. Lista todas as conexões ativas ou disponíveis no momento
   */
  listActiveConnections() {
    const connections = [];

    // A) WHATSAPP MATRIZ PRINCIPAL (DONO)
    let whatsappBot = null;
    try {
      whatsappBot = require('../bots/whatsappBot');
    } catch (_) {}

    const ownerPhone = (models.getSetting('OWNER_PHONE') || process.env.OWNER_PHONE || this.DEFAULT_OWNER_PHONE).replace(/\D/g, '');
    const isWppMasterConnected = Boolean(whatsappBot && ((whatsappBot.sock && whatsappBot.sock.user) || whatsappBot.isConnected));
    const masterUserName = whatsappBot?.sock?.user?.name || whatsappBot?.sock?.user?.notify || 'PayBot Matriz';
    const masterPhone = whatsappBot?.sock?.user?.id ? whatsappBot.sock.user.id.split(':')[0].replace(/\D/g, '') : ownerPhone;

    connections.push({
      id: 'whatsapp_master',
      name: 'WhatsApp Matriz Principal (Dono)',
      platform: 'whatsapp',
      type: 'master',
      phone: `+${masterPhone}`,
      cleanPhone: masterPhone,
      status: isWppMasterConnected ? 'CONNECTED' : (whatsappBot?.sock ? 'CONNECTING' : 'DISCONNECTED'),
      statusLabel: isWppMasterConnected ? '🟢 Conectado & Operante' : '🟡 Standby / Aguardando',
      role: 'Comando Supremo & Orquestrador',
      isReady: true,
      isMain: true,
      userName: masterUserName,
      icon: 'fa-brands fa-whatsapp',
      color: '#25d366'
    });

    // B) SUB-BOTS DO EXÉRCITO DE CHIPS
    let whatsappArmyService = null;
    try {
      whatsappArmyService = require('./whatsappArmyService');
    } catch (_) {}

    const armyList = models.getArmyInstances ? models.getArmyInstances() : [];
    // Prioriza instâncias que não sejam a matriz e filtra as ativas/relevantes
    const subbots = armyList.filter(inst => !inst.is_main && inst.id !== 1);

    // Adiciona instâncias do exército (até 20 mais relevantes para o Lab)
    subbots.slice(0, 20).forEach(inst => {
      const hasActiveSocket = Boolean(whatsappArmyService?.activeSockets?.has(Number(inst.id)));
      const isOnline = hasActiveSocket || inst.status === 'CONNECTED';
      const cleanSubPhone = (inst.phone || '').replace(/\D/g, '');

      connections.push({
        id: `subbot_${inst.id}`,
        instanceId: inst.id,
        name: inst.name || `Sub-Bot Chip #${inst.id}`,
        platform: 'whatsapp',
        type: 'subbot',
        phone: cleanSubPhone ? `+${cleanSubPhone}` : 'Sem número',
        cleanPhone: cleanSubPhone,
        status: isOnline ? 'CONNECTED' : (inst.status || 'DISCONNECTED'),
        statusLabel: isOnline ? '🟢 Conectado & Ativo' : '🟡 Standby / Pronto',
        role: inst.role || 'Vendas & Atendimento',
        isReady: true,
        isMain: false,
        userName: inst.name,
        icon: 'fa-solid fa-tower-broadcast',
        color: '#38bdf8'
      });
    });

    // C) TELEGRAM BOT OFICIAL
    let telegramBot = null;
    try {
      telegramBot = require('../bots/telegramBot');
    } catch (_) {}

    const isTgConnected = Boolean(telegramBot && (telegramBot.bot || telegramBot.isPolling));
    connections.push({
      id: 'telegram',
      name: 'Telegram Bot Oficial (@PayBot)',
      platform: 'telegram',
      type: 'telegram',
      phone: '@PayBot',
      cleanPhone: 'telegram',
      status: isTgConnected ? 'CONNECTED' : 'STANDBY',
      statusLabel: isTgConnected ? '🟢 Conectado' : '🟡 Standby / Pronto',
      role: 'Atendimento & Suporte Telegram',
      isReady: true,
      isMain: false,
      userName: 'PayBot Telegram',
      icon: 'fa-brands fa-telegram',
      color: '#0088cc'
    });

    // Ordena para que as conexões ativas no momento apareçam no topo
    return connections.sort((a, b) => {
      const score = (c) => {
        let s = 0;
        if (c.status === 'CONNECTED') s += 100;
        else if (c.status === 'CONNECTING' || c.status === 'STANDBY') s += 50;
        if (c.isMain) s += 20;
        return s;
      };
      return score(b) - score(a);
    });
  }

  /**
   * 2. Catálogo de comandos organizados por categoria para o seletor do Lab
   */
  getCommandCatalog() {
    return [
      {
        category: 'Vendas & Pagamentos',
        icon: 'fa-solid fa-cart-shopping',
        color: '#10b981',
        commands: [
          {
            cmd: 'pix',
            name: '!pix',
            title: 'Gerar Cobrança Pix',
            desc: 'Gera cobrança com QR Code e Copia e Cola instantâneo homologado BACEN.',
            placeholder: 'Digite o valor em R$ (ex: 49.90 ou 100.00)',
            defaultInput: '49.90'
          },
          {
            cmd: 'usdt',
            name: '!usdt',
            title: 'Pagamento em Cripto (USDT)',
            desc: 'Exibe carteira oficial TRC-20 / BEP-20 para recebimento de USDT.',
            placeholder: 'Deixe vazio ou digite o valor em dólares (ex: 20)',
            defaultInput: ''
          },
          {
            cmd: 'pedido',
            name: '!pedido',
            title: 'Consultar Pedido',
            desc: 'Verifica status de pagamento, chaves geradas e entrega do pedido.',
            placeholder: 'Código do pedido (ex: ORD_123456) ou deixe vazio para recentes',
            defaultInput: ''
          },
          {
            cmd: 'loja',
            name: '!loja',
            title: 'Vitrine & Catálogo Web',
            desc: 'Envia o link oficial da vitrine de produtos e planos.',
            placeholder: 'Deixe vazio ou adicione uma mensagem opcional',
            defaultInput: ''
          },
          {
            cmd: 'verpix',
            name: '!verpix',
            title: 'Ver Chave Pix Configurada',
            desc: 'Mostra a chave Pix principal ativa no sistema (BACEN / Mercado Pago).',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          }
        ]
      },
      {
        category: 'Inteligência Artificial & Cognição',
        icon: 'fa-solid fa-brain',
        color: '#ec4899',
        commands: [
          {
            cmd: 'ia',
            name: '!ia',
            title: 'Perguntar ao Cérebro IA (Mega-Pool)',
            desc: 'Consulta o núcleo cognitivo usando Groq / Gemini / OpenAI com resposta em tempo real.',
            placeholder: 'Ex: Como funciona a garantia dos produtos? Me explique os planos.',
            defaultInput: 'Como funciona a garantia dos produtos?'
          },
          {
            cmd: 'mente',
            name: '!mente',
            title: 'Sincronização Neural do Dono',
            desc: 'Exibe status de gírias, tom de voz e respostas aprendidas com o Dono.',
            placeholder: 'Deixe vazio para ver status ou digite nova expressão a aprender',
            defaultInput: ''
          },
          {
            cmd: 'simi',
            name: '!simi',
            title: 'Atendimento Rápido Simi',
            desc: 'Conversação rápida para engajamento e quebra de gelo.',
            placeholder: 'Digite uma mensagem de teste',
            defaultInput: 'Oi, tudo bem?'
          },
          {
            cmd: 'status',
            name: '!status',
            title: 'Telemetria & Latência da IA',
            desc: 'Mede a velocidade de resposta do provedor de IA ativo no Mega-Pool.',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          }
        ]
      },
      {
        category: 'Árbitro da Operação & Sistema',
        icon: 'fa-solid fa-scale-balanced',
        color: '#f59e0b',
        commands: [
          {
            cmd: 'gerente',
            name: '!gerente',
            title: 'Árbitro Supremo da Operação',
            desc: 'Audita os 8 pilares vitais e sintetiza parecer cognitivo da operação.',
            placeholder: 'Deixe vazio para auditoria completa com IA',
            defaultInput: ''
          },
          {
            cmd: 'autocura',
            name: '!autocura',
            title: 'Autocura Geral do Sistema',
            desc: 'Dispara protocolo autônomo de autocura em todos os subsistemas degradados.',
            placeholder: 'Deixe vazio para todos os módulos ou digite um específico',
            defaultInput: ''
          },
          {
            cmd: 'ping',
            name: '!ping',
            title: 'Ping & Diagnóstico de Hardware',
            desc: 'Mede velocidade de resposta, uso de CPU, RAM, uptime e WebSocket.',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          },
          {
            cmd: 'dono',
            name: '!dono',
            title: 'Contato Oficial do Dono',
            desc: 'Exibe o contato e credenciais oficiais do Dono Supremo.',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          },
          {
            cmd: 'sodivu',
            name: '!sodivu',
            title: 'Modo Só Divulgação (Grupo)',
            desc: 'Faz com que o bot envie APENAS divulgações, ofertas e achadinhos no grupo, silenciando conversas e comandos comuns de membros.',
            placeholder: 'on, off, toggle ou status (opcional: on 120363028@g.us)',
            defaultInput: 'status'
          },
          {
            cmd: 'sodivuglobal',
            name: '!sodivu-global',
            title: 'Modo Só Divulgação Global (Todos os Grupos)',
            desc: 'Ativa ou desativa o modo Só Divulgação em escala global para todos os grupos do bot.',
            placeholder: 'on, off, toggle ou status',
            defaultInput: 'status'
          }
        ]
      },
      {
        category: 'Utilidades & Ferramentas',
        icon: 'fa-solid fa-screwdriver-wrench',
        color: '#38bdf8',
        commands: [
          {
            cmd: 'menu',
            name: '!menu',
            title: 'Menu Principal de Autoatendimento',
            desc: 'Gera a mensagem do menu oficial com botões e categorias.',
            placeholder: 'Submenu opcional (ex: vendas, audio, bot) ou vazio para geral',
            defaultInput: ''
          },
          {
            cmd: 'help',
            name: '!help',
            title: 'Manual de Comandos & Ajuda',
            desc: 'Lista comandos úteis e explicações operacionais.',
            placeholder: 'Nome do comando que quer consultar (ex: pix)',
            defaultInput: ''
          },
          {
            cmd: 'clones',
            name: '!clones',
            title: 'Listar Comandos Clonados',
            desc: 'Exibe todos os comandos e mensagens clonados ativos no sistema.',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          },
          {
            cmd: 'subbots',
            name: '!subbots',
            title: 'Status do Exército de Chips',
            desc: 'Lista os chips do exército, status de conexão e rotatividade.',
            placeholder: 'Deixe vazio',
            defaultInput: ''
          }
        ]
      },
      {
        category: 'Comando Livre / Manual',
        icon: 'fa-solid fa-terminal',
        color: '#a855f7',
        commands: [
          {
            cmd: 'custom',
            name: '✍️ Digitação Livre',
            title: 'Comando Personalizado',
            desc: 'Digite qualquer comando nativo ou clonado com seus parâmetros livremente.',
            placeholder: 'Ex: !promocao ou !alugar 30 ou !chavefree',
            defaultInput: '!menu'
          }
        ]
      }
    ];
  }

  /**
   * 3. Executa um comando no Lab para a conexão selecionada
   * e extrai o RESULTADO DIRETO da conexão, sem histórico de comandos.
   */
  async executeLabCommand({
    connectionId = 'whatsapp_master',
    command,
    input = '',
    targetRecipient = null,
    sendDirectly = false
  }) {
    const startTime = Date.now();

    if (!command) {
      throw new Error('Comando obrigatório para execução no Lab.');
    }

    // 1. Identifica a conexão
    const connections = this.listActiveConnections();
    const connObj = connections.find(c => c.id === connectionId) || connections[0];

    // 2. Normaliza o comando e argumentos
    let rawCmd = String(command).trim();
    let rawInput = String(input || '').trim();

    // Se o usuário selecionou 'custom', analisa o input para extrair comando e argumentos
    if (rawCmd === 'custom') {
      const parts = rawInput.split(/\s+/);
      rawCmd = parts[0] ? parts[0].replace(/^[!/]/, '') : 'menu';
      rawInput = parts.slice(1).join(' ');
    } else {
      rawCmd = rawCmd.replace(/^[!/]/, '');
    }

    const cleanCommand = rawCmd.toLowerCase();
    const args = rawInput ? rawInput.split(/\s+/) : [];

    // 3. Capturador do Resultado Direto
    const outputs = [];
    let payloadResult = null;

    // Conector Mock / Capturador para interceptar o retorno
    const labMessageCollector = {
      push: (content) => {
        if (!content) return;
        if (typeof content === 'string') {
          outputs.push(content);
        } else if (typeof content === 'object') {
          payloadResult = { ...payloadResult, ...content };
          if (content.text) outputs.push(content.text);
          else if (content.caption) outputs.push(content.caption);
          else if (content.message?.conversation) outputs.push(content.message.conversation);
          else if (content.message?.extendedTextMessage?.text) outputs.push(content.message.extendedTextMessage.text);
          else if (content.error) outputs.push(`⚠️ ${content.error}`);
        }
      }
    };

    // 4. Execução específica por plataforma
    let sentToTarget = false;
    let actualSocket = null;

    if (connObj.platform === 'whatsapp') {
      let handler = null;
      try {
        handler = require('../handler');
      } catch (err) {
        throw new Error('Falha ao inicializar o motor de comandos: ' + err.message);
      }

      // Procura o comando registrado
      const cmdDef = handler.findCommand(cleanCommand);

      // Resolve o socket real da conexão caso o usuário queira envio real
      if (connObj.id === 'whatsapp_master') {
        const whatsappBot = require('../bots/whatsappBot');
        actualSocket = whatsappBot.sock;
      } else if (connObj.type === 'subbot') {
        const whatsappArmyService = require('./whatsappArmyService');
        const instId = Number(connObj.instanceId);
        actualSocket = whatsappArmyService?.activeSockets?.get(instId) || null;
      }

      // Monta o conector intermediário com captura
      const targetJid = targetRecipient ? (targetRecipient.includes('@') ? targetRecipient : `${targetRecipient.replace(/\D/g, '')}@s.whatsapp.net`) : null;

      const connHarness = {
        user: {
          id: (connObj.cleanPhone || '554884702848') + ':1@s.whatsapp.net',
          name: connObj.name
        },
        sendMessage: async (chat, content, options = {}) => {
          labMessageCollector.push(content);

          // Se envio real solicitado e houver socket real conectado
          if (sendDirectly && actualSocket && typeof actualSocket.sendMessage === 'function') {
            try {
              const dest = targetJid || chat;
              const sendRes = await actualSocket.sendMessage(dest, content, options);
              sentToTarget = true;
              return sendRes;
            } catch (err) {
              console.warn('[Lab] Aviso no envio real via socket:', err.message);
            }
          }
          return { key: { id: `LAB_${Date.now()}` } };
        },
        groupMetadata: async () => ({ id: 'lab@g.us', subject: 'Lab de Testes', participants: [] })
      };

      const mHarness = {
        chat: targetJid || '554884702848@s.whatsapp.net',
        sender: '554884702848@s.whatsapp.net',
        senderNumber: '554884702848',
        fromMe: true,
        isGroup: false,
        pushName: 'Operador do Painel Web',
        command: cleanCommand,
        prefix: '!',
        args,
        textArgs: rawInput,
        reply: async (text, options = {}) => {
          labMessageCollector.push(text);
          if (sendDirectly && actualSocket && targetJid && typeof actualSocket.sendMessage === 'function') {
            try {
              await actualSocket.sendMessage(targetJid, { text: String(text) }, options);
              sentToTarget = true;
            } catch (_) {}
          }
        },
        react: async (emoji) => {
          payloadResult = { ...payloadResult, reaction: emoji };
        }
      };

      if (cmdDef) {
        // Executa o comando nativo do robô
        const ret = await cmdDef.run(mHarness, {
          conn: connHarness,
          args,
          text: rawInput,
          usedPrefix: '!',
          command: cleanCommand,
          isOwner: true,
          isROwner: true,
          isAdmin: true,
          handler
        });

        if (ret) {
          labMessageCollector.push(ret);
        }
      } else {
        // Se não for um comando nativo exato, submete ao Núcleo de Inteligência (AI Core) como mensagem conversacional
        try {
          const aiManager = require('./aiManagerService');
          const prompt = rawInput ? `${cleanCommand} ${rawInput}` : cleanCommand;
          const aiResponse = await aiManager.chat({
            prompt,
            systemInstruction: `Você é a IA operacional da conexão ${connObj.name}. Responda de forma direta, executiva e prestativa.`
          });
          const textRes = aiResponse.text || 'Comando processado com sucesso.';
          labMessageCollector.push(textRes);

          if (sendDirectly && actualSocket && targetJid && typeof actualSocket.sendMessage === 'function') {
            await actualSocket.sendMessage(targetJid, { text: textRes });
            sentToTarget = true;
          }
        } catch (err) {
          labMessageCollector.push(`⚠️ Comando "!${cleanCommand}" não encontrado e falha ao consultar IA: ${err.message}`);
        }
      }
    } else if (connObj.platform === 'telegram') {
      // TELEGRAM BOT
      const telegramBot = require('../bots/telegramBot');

      if (cleanCommand === 'gerente' || cleanCommand === 'arbitro') {
        const operationsArbiter = require('./operationsArbiterService');
        const audit = await operationsArbiter.auditAll({ forceAi: false });
        const report = operationsArbiter.formatTelegramReport(audit);
        labMessageCollector.push(report);
      } else if (cleanCommand === 'autocura') {
        const operationsArbiter = require('./operationsArbiterService');
        const audit = await operationsArbiter.auditAll({ triggerAutoHeal: true, forceAi: false });
        const report = operationsArbiter.formatTelegramReport(audit);
        labMessageCollector.push(report);
      } else if (cleanCommand === 'pix') {
        labMessageCollector.push(
          `💰 *Telegram Pix Checkout*\n\n` +
          `Para gerar cobrança Pix via Telegram, use valor ex: *!pix ${rawInput || '49.90'}*.\n` +
          `Chave registrada pronta para recebimento instantâneo.`
        );
      } else {
        // Envia mensagem ou executa com IA
        try {
          const aiManager = require('./aiManagerService');
          const prompt = rawInput ? `${cleanCommand} ${rawInput}` : cleanCommand;
          const aiResponse = await aiManager.chat({
            prompt,
            systemInstruction: 'Você é o Bot Oficial do Telegram. Responda em formato executivo conciso.'
          });
          labMessageCollector.push(aiResponse.text || `Comando /${cleanCommand} executado no Telegram.`);
        } catch (_) {
          labMessageCollector.push(`✅ Comando /${cleanCommand} processado no canal Telegram.`);
        }
      }

      // Se destinatário informado (chat ID do telegram) e bot ativo
      if (sendDirectly && targetRecipient && telegramBot?.bot?.telegram) {
        try {
          const msgToSend = outputs.join('\n\n') || `Comando /${cleanCommand} executado com sucesso.`;
          await telegramBot.bot.telegram.sendMessage(targetRecipient, msgToSend);
          sentToTarget = true;
        } catch (err) {
          console.warn('[Lab Telegram] Falha no disparo direto:', err.message);
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const finalResultText = outputs.filter(Boolean).join('\n\n') || 'Comando executado com sucesso pela conexão.';

    // Retorna O RESULTADO DIRETO da conexão (sem histórico gravado na resposta)
    return {
      success: true,
      connectionId: connObj.id,
      connectionName: connObj.name,
      connectionPhone: connObj.phone,
      platform: connObj.platform,
      command: `!${cleanCommand}`,
      input: rawInput,
      targetRecipient: targetRecipient || null,
      sentDirectly: sentToTarget,
      executionTimeMs,
      resultText: finalResultText,
      resultPayload: payloadResult,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new ConnectionLabService();

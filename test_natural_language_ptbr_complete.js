const assert = require('assert');
const naturalCommandService = require('./src/services/naturalLanguageCommandService');

console.log('=== TESTES DE OTIMIZAÇÃO COMPLETA EM PORTUGUÊS DO BRASIL (PT-BR) ===\n');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`✅ [PASSOU] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FALHOU] ${name}`);
    console.error(`   Detalhes:`, err.message);
  }
}

// 1. Normalização PT-BR e Gírias
runTest('PT-BR Gírias: "pfv bot faz uma figurinha dessa foto" com mídia direta', () => {
  const res = naturalCommandService.resolveCommand('pfv bot faz uma figurinha dessa foto', {
    msg: { message: { imageMessage: { url: 'https://...' } } }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'STICKER');
});

runTest('PT-BR Gírias: "mano baixa esse video pra mim https://youtu.be/123456"', () => {
  const res = naturalCommandService.resolveCommand('mano baixa esse video pra mim https://youtu.be/123456');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'DOWNLOAD_VIDEO');
  assert.strictEqual(res.syntheticText, '!video https://youtu.be/123456');
});

runTest('PT-BR Gírias: "adm apaga isso plmds" com quoted stanzaId e admin', () => {
  const res = naturalCommandService.resolveCommand('adm apaga isso plmds', {
    isGroup: true,
    isAdmin: true,
    msg: {
      message: {
        extendedTextMessage: {
          contextInfo: { stanzaId: 'MSG_9999', participant: '5511999991111@s.whatsapp.net' }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_DELETE');
  assert.strictEqual(res.params.stanzaId, 'MSG_9999');
});

runTest('PT-BR Gírias: "veio tranca o grupo ai por favor" (admin)', () => {
  const res = naturalCommandService.resolveCommand('veio tranca o grupo ai por favor', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_LOCK');
});

runTest('PT-BR Gírias: "bora abre o chat rapaziada" (admin)', () => {
  const res = naturalCommandService.resolveCommand('bora abre o chat rapaziada', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_UNLOCK');
});

runTest('PT-BR Gírias: "marca a galera do grupo reuniao hoje as 18h" (admin)', () => {
  const res = naturalCommandService.resolveCommand('marca a galera do grupo reuniao hoje as 18h', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_TAGALL');
  assert.strictEqual(res.syntheticText, '!marcar reuniao hoje as 18h');
});

runTest('PT-BR Gírias: "alguem vazou do grupo?" (admin)', () => {
  const res = naturalCommandService.resolveCommand('alguem vazou do grupo?', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_X9');
});

// 2. Extração Contextual de Mensagem Citada (Quoted Messages)
runTest('Contexto Citado: "baixa esse reels ai" citando link do Instagram', () => {
  const res = naturalCommandService.resolveCommand('baixa esse reels ai', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'baixa esse reels ai',
          contextInfo: {
            quotedMessage: {
              conversation: 'Olha que legal: https://www.instagram.com/reel/DC123456789/'
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.confidence, 0.99);
  assert.strictEqual(res.type, 'DOWNLOAD_INSTAGRAM');
  assert.strictEqual(res.params.url, 'https://www.instagram.com/reel/DC123456789/');
  assert.strictEqual(res.syntheticText, '!ig https://www.instagram.com/reel/DC123456789/');
});

runTest('Contexto Citado: "analisa a velocidade desse site" citando mensagem com link', () => {
  const res = naturalCommandService.resolveCommand('analisa a velocidade desse site', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'analisa a velocidade desse site',
          contextInfo: {
            quotedMessage: {
              conversation: 'Meu e-commerce tá pronto: https://minhalojaonline.com.br'
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'PAGESPEED');
  assert.strictEqual(res.params.url, 'https://minhalojaonline.com.br');
});

runTest('Contexto Citado: "checa a procedencia desse imei" citando mensagem com IMEI', () => {
  const res = naturalCommandService.resolveCommand('checa a procedencia desse imei', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'checa a procedencia desse imei',
          contextInfo: {
            quotedMessage: {
              conversation: 'Vou comprar esse iPhone, o IMEI dele é 352099001761481'
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'CONSULTAR_IMEI');
  assert.strictEqual(res.params.imei, '352099001761481');
});

runTest('Contexto Citado: "passa pra foto essa figurinha" citando sticker', () => {
  const res = naturalCommandService.resolveCommand('passa pra foto essa figurinha', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'passa pra foto essa figurinha',
          contextInfo: {
            quotedMessage: {
              stickerMessage: { url: 'https://...' }
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'STICKER_TO_IMG');
  assert.strictEqual(res.syntheticText, '!toimg');
});

runTest('Contexto Citado: "tira o audio desse video" citando vídeo', () => {
  const res = naturalCommandService.resolveCommand('tira o audio desse video', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'tira o audio desse video',
          contextInfo: {
            quotedMessage: {
              videoMessage: { url: 'https://...' }
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'VIDEO_TO_MP3');
  assert.strictEqual(res.syntheticText, '!tomp3');
});

runTest('Contexto Citado: "manda em alta qualidade" citando mídia', () => {
  const res = naturalCommandService.resolveCommand('manda em alta qualidade', {
    msg: {
      message: {
        extendedTextMessage: {
          text: 'manda em alta qualidade',
          contextInfo: {
            quotedMessage: {
              videoMessage: { url: 'https://...' }
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'MEDIA_UPGRADE');
  assert.strictEqual(res.syntheticText, '!h');
});

runTest('Contexto Citado: "bane esse cara" citando mensagem do autor infrator', () => {
  const res = naturalCommandService.resolveCommand('bane esse cara', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true,
    msg: {
      message: {
        extendedTextMessage: {
          text: 'bane esse cara',
          contextInfo: {
            participant: '5511988887777@s.whatsapp.net',
            quotedMessage: {
              conversation: 'Mensagem com spam ou golpe'
            }
          }
        }
      }
    }
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_BAN');
  assert.strictEqual(res.params.targetUser, '5511988887777@s.whatsapp.net');
  assert.strictEqual(res.syntheticText, '!ban @5511988887777');
});

// 3. Comandos Expandidos em PT-BR
runTest('Texto para Figurinha: "faz uma figurinha escrita \'Bom dia galera\'"', () => {
  const res = naturalCommandService.resolveCommand("faz uma figurinha escrita 'Bom dia galera'");
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'TEXT_TO_STICKER');
  assert.strictEqual(res.params.text, 'Bom dia galera');
  assert.strictEqual(res.syntheticText, '!ttp Bom dia galera');
});

runTest('Figurinha Animada: "faz uma figurinha animada com o texto \'Top Demais\'"', () => {
  const res = naturalCommandService.resolveCommand("faz uma figurinha animada com o texto 'Top Demais'");
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'ATTP');
  assert.strictEqual(res.params.text, 'Top Demais');
  assert.strictEqual(res.syntheticText, '!attp Top Demais');
});

runTest('Texto para Voz Neural: "fala pra mim \'Seja muito bem-vindo ao robô\'"', () => {
  const res = naturalCommandService.resolveCommand("fala pra mim 'Seja muito bem-vindo ao robô'");
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'TEXT_TO_SPEECH');
  assert.strictEqual(res.params.text, 'Seja muito bem-vindo ao robô');
  assert.strictEqual(res.syntheticText, '!tts Seja muito bem-vindo ao robô');
});

runTest('Instagram Stories: "baixa todos os stories do perfil @neymarjr"', () => {
  const res = naturalCommandService.resolveCommand('baixa todos os stories do perfil @neymarjr');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'DOWNLOAD_STORIES');
  assert.strictEqual(res.params.username, 'neymarjr');
  assert.strictEqual(res.syntheticText, '!allstories @neymarjr');
});

runTest('Instagram Stalk: "stalkea o perfil @lojaoficial"', () => {
  const res = naturalCommandService.resolveCommand('stalkea o perfil @lojaoficial');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'STALK_INSTAGRAM');
  assert.strictEqual(res.params.username, 'lojaoficial');
  assert.strictEqual(res.syntheticText, '!scrapinsta @lojaoficial');
});

runTest('YouTube Lista Musical: "pesquisa uma lista de musicas do Legiao Urbana"', () => {
  const res = naturalCommandService.resolveCommand('pesquisa uma lista de musicas do Legiao Urbana');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'MUSIC_LIST');
  assert.strictEqual(res.params.query, 'Legiao Urbana');
  assert.strictEqual(res.syntheticText, '!lista Legiao Urbana');
});

runTest('Rastreamento de Compras: "rastreia minha compra ORD_ABC123"', () => {
  const res = naturalCommandService.resolveCommand('rastreia minha compra ORD_ABC123');
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'ORDER_TRACKING');
  assert.strictEqual(res.params.orderCode, 'ORD_ABC123');
  assert.strictEqual(res.syntheticText, '!pedido ORD_ABC123');
});

runTest('Moderação: "muta esse cara @5511999990000" (admin)', () => {
  const res = naturalCommandService.resolveCommand('muta esse cara @5511999990000', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_MUTE_USER');
  assert.strictEqual(res.params.targetUser, '5511999990000@s.whatsapp.net');
});

runTest('Moderação: "desmuta esse cara @5511999990000" (admin)', () => {
  const res = naturalCommandService.resolveCommand('desmuta esse cara @5511999990000', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_UNMUTE_USER');
  assert.strictEqual(res.params.targetUser, '5511999990000@s.whatsapp.net');
});

runTest('Moderação: "muda o nome do grupo para Clientes VIP 2026" (admin)', () => {
  const res = naturalCommandService.resolveCommand('muda o nome do grupo para Clientes VIP 2026', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_SET_NAME');
  assert.strictEqual(res.params.newName, 'Clientes VIP 2026');
  assert.strictEqual(res.syntheticText, '!setname Clientes VIP 2026');
});

runTest('Moderação: "muda a descricao do grupo para Regras Oficiais e Suporte" (admin)', () => {
  const res = naturalCommandService.resolveCommand('muda a descricao do grupo para Regras Oficiais e Suporte', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_SET_DESC');
  assert.strictEqual(res.params.newDesc, 'Regras Oficiais e Suporte');
  assert.strictEqual(res.syntheticText, '!setdesc Regras Oficiais e Suporte');
});

runTest('Moderação: "qual e o link de convite do grupo?" (admin)', () => {
  const res = naturalCommandService.resolveCommand('qual e o link de convite do grupo?', {
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_LINK');
  assert.strictEqual(res.syntheticText, '!linkgp');
});

runTest('Moderação: "faz um sorteio entre os membros do grupo" (admin)', () => {
  const res = naturalCommandService.resolveCommand('faz um sorteio entre os membros do grupo', {
    isGroup: true,
    isAdmin: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_RAFFLE');
  assert.strictEqual(res.syntheticText, '!sorteio 1 Prêmio Surpresa | 1');
});

runTest('Informações: "quais sao as regras do grupo?"', () => {
  const res = naturalCommandService.resolveCommand('quais sao as regras do grupo?', {
    isGroup: true
  });
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.type, 'GROUP_RULES');
  assert.strictEqual(res.syntheticText, '!regras');
});

console.log(`\n======================================================`);
console.log(`TOTAL PT-BR COMPLETO: ${passed}/${total} TESTES PASSARAM!`);
console.log(`======================================================`);

if (passed !== total) {
  process.exit(1);
}

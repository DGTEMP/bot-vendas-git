const assert = require('assert');
const http = require('http');
const models = require('./src/db/models');
const spyFeatures = require('./src/services/spyFeaturesService');
const { createServer } = require('./src/server/app');

async function runTests() {
  console.log('🧪 Iniciando testes do Sistema X9 e Revelação de Visualização Única...\n');
  process.env.NODE_ENV = 'test';

  const groupJid = '120363099999999999@g.us';
  const userPhone = '5511999991111';
  const userJid = `${userPhone}@s.whatsapp.net`;
  let sentMessages = [];

  const mockSock = {
    sendMessage: async (to, content) => {
      sentMessages.push({ to, content });
      return { key: { id: 'msg_' + Date.now() } };
    }
  };

  // ==========================================
  // PARTE 1: TESTES DO SISTEMA X9 DO GRUPO
  // ==========================================
  console.log('--- TESTE 1: !x9 no Privado (Orientação) ---');
  sentMessages = [];
  await spyFeatures.handleX9(mockSock, userJid, '!x9', false);
  assert.strictEqual(sentMessages.length, 1);
  assert(sentMessages[0].content.text.includes('SISTEMA X9'), 'Deve explicar o X9');
  assert(sentMessages[0].content.text.includes('grupos'), 'Deve informar que é para grupos');
  console.log('  ✅ 1.1 !x9 em privado orienta sobre o uso em grupos');

  console.log('\n--- TESTE 2: !x9 no Grupo (Painel de Auditoria e Status) ---');
  sentMessages = [];
  await spyFeatures.handleX9(mockSock, groupJid, '!x9', false);
  assert.strictEqual(sentMessages.length, 1);
  assert(sentMessages[0].content.text.includes('PAINEL DE AUDITORIA X9'), 'Deve exibir o painel X9');
  assert(sentMessages[0].content.text.includes('Anti-Delete'), 'Deve listar o módulo Anti-Delete');
  assert(sentMessages[0].content.text.includes('Anti-View-Once'), 'Deve listar o módulo Anti-View-Once');
  console.log('  ✅ 2.1 !x9 no grupo exibe painel completo de auditoria');

  console.log('\n--- TESTE 3: !x9 on e !x9 off (Ativação e Desativação do Dedo-Duro) ---');
  sentMessages = [];
  // Não-admin não pode ativar
  await spyFeatures.handleX9(mockSock, groupJid, '!x9 on', false);
  assert(sentMessages[0].content.text.includes('Apenas administradores'), 'Não-admin deve ser bloqueado');

  // Admin ativa X9
  sentMessages = [];
  await spyFeatures.handleX9(mockSock, groupJid, '!x9 on', true);
  const protAfterOn = models.getGroupProtection(groupJid);
  assert.strictEqual(protAfterOn.x9_enabled, 1, 'x9_enabled deve ser 1');
  assert.strictEqual(models.getSetting(`ANTIDELETE_${groupJid}`), 'true', 'Anti-Delete deve ser ativado junto');
  assert.strictEqual(models.getSetting(`ANTIVIEWONCE_${groupJid}`), 'true', 'Anti-View-Once deve ser ativado junto');
  assert(sentMessages[0].content.text.includes('SISTEMA X9 DO GRUPO ATIVADO'), 'Mensagem de ativação confirmada');
  console.log('  ✅ 3.1 !x9 on ativa x9_enabled, antidelete e antiviewonce');

  // Admin desativa X9
  sentMessages = [];
  await spyFeatures.handleX9(mockSock, groupJid, '!x9 off', true);
  const protAfterOff = models.getGroupProtection(groupJid);
  assert.strictEqual(protAfterOff.x9_enabled, 0, 'x9_enabled deve ser 0');
  assert.strictEqual(models.getSetting(`ANTIDELETE_${groupJid}`), 'false');
  assert.strictEqual(models.getSetting(`ANTIVIEWONCE_${groupJid}`), 'false');
  assert(sentMessages[0].content.text.includes('SISTEMA X9 DESATIVADO'), 'Mensagem de desativação confirmada');
  console.log('  ✅ 3.2 !x9 off desativa o modo dedo-duro com sucesso');

  // ==========================================
  // PARTE 2: TESTES DE VISUALIZAÇÃO ÚNICA (VIEW-ONCE)
  // ==========================================
  console.log('\n--- TESTE 4: Desempacotamento de Envelopes Baileys (extractViewOnceMedia) ---');

  // 4.1 Envelope padrão viewOnceMessageV2 com imagem
  const mockMsgV2 = {
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: { url: 'https://test.com/img', caption: 'Foto secreta' }
        }
      }
    }
  };
  const extractedV2 = spyFeatures.extractViewOnceMedia(mockMsgV2);
  assert(extractedV2, 'Deve extrair envelope viewOnceMessageV2');
  assert.strictEqual(extractedV2.type, 'image');
  assert.strictEqual(extractedV2.caption, 'Foto secreta');
  console.log('  ✅ 4.1 viewOnceMessageV2 extraído com sucesso');

  // 4.2 Envelope aninhado em ephemeralMessage (mensagens temporárias ativadas)
  const mockEphemeralV2Ext = {
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2Extension: {
            message: {
              videoMessage: { url: 'https://test.com/vid', caption: 'Vídeo temporário' }
            }
          }
        }
      }
    }
  };
  const extractedEph = spyFeatures.extractViewOnceMedia(mockEphemeralV2Ext);
  assert(extractedEph, 'Deve desempacotar ephemeralMessage aninhado');
  assert.strictEqual(extractedEph.type, 'video');
  assert.strictEqual(extractedEph.caption, 'Vídeo temporário');
  console.log('  ✅ 4.2 ephemeralMessage com viewOnceMessageV2Extension extraído');

  // 4.3 Áudio de visualização única (Voice Note PTT)
  const mockAudioViewOnce = {
    message: {
      viewOnceMessage: {
        message: {
          audioMessage: { url: 'https://test.com/audio.ogg', mimetype: 'audio/ogg; codecs=opus' }
        }
      }
    }
  };
  const extractedAudio = spyFeatures.extractViewOnceMedia(mockAudioViewOnce);
  assert(extractedAudio, 'Deve suportar áudio de visualização única');
  assert.strictEqual(extractedAudio.type, 'audio');
  console.log('  ✅ 4.3 Áudio de visualização única (Voice Note) suportado');

  // 4.4 Mídia normal (NÃO visualização única) NÃO deve ser confundida com View-Once
  const mockNormalImage = {
    message: {
      imageMessage: { url: 'https://test.com/normal.jpg', caption: 'Foto pública normal' }
    }
  };
  const extractedNormal = spyFeatures.extractViewOnceMedia(mockNormalImage);
  assert.strictEqual(extractedNormal, null, 'Mídia normal sem flag viewOnce NÃO deve ser extraída como temporária');
  console.log('  ✅ 4.4 Mídia pública normal ignorada corretamente pelo Anti-View-Once');

  console.log('\n--- TESTE 5: Auto-Interceptador Anti-View-Once no Grupo e PV ---');
  // Reativa X9 no grupo
  models.updateGroupProtection(groupJid, { x9_enabled: 1 });
  models.setSetting(`ANTIVIEWONCE_${groupJid}`, 'true');

  sentMessages = [];
  const testVoId = 'VO_MSG_12345';
  const incomingVoMsg = {
    key: { remoteJid: groupJid, id: testVoId, participant: userJid },
    message: mockMsgV2.message
  };

  await spyFeatures.handleAntiViewOnce(mockSock, incomingVoMsg, groupJid);
  assert(sentMessages.length >= 1, 'Deve revelar a mídia no grupo');
  const revealedMsg = sentMessages[0];
  assert(revealedMsg.content.image, 'Deve reenviar a imagem sem restrição');
  assert(revealedMsg.content.caption.includes('Foto secreta'), 'Deve manter legenda original');
  assert(revealedMsg.content.caption.includes('X9 DO GRUPO') || revealedMsg.content.caption.includes('ANTI-VIEW-ONCE'), 'Deve ter cabeçalho de revelação');

  // Verifica persistência nos logs de visualização única e X9
  const voLogs = models.getViewOnceLogs(groupJid, 10);
  assert(voLogs.length > 0, 'Deve registrar no banco de dados view_once_logs');
  const x9Logs = models.getX9Events(groupJid, 10);
  assert(x9Logs.some(e => e.event_type === 'VIEW_ONCE_MEDIA'), 'Deve registrar ocorrência no x9_events_log');
  console.log('  ✅ 5.1 Anti-View-Once interceptou foto temporária e revelou permanente no grupo');

  console.log('\n--- TESTE 6: Comando !revelar / !rv sob Demanda ---');
  // 6.1 !revelar sem citar mensagem exibe instruções
  sentMessages = [];
  await spyFeatures.handleRevelar(mockSock, { message: { conversation: '!revelar' } }, groupJid);
  assert(sentMessages[0].content.text.includes('REVELADOR DE VISUALIZAÇÃO ÚNICA'), 'Deve exibir instruções');
  console.log('  ✅ 6.1 !revelar sem citação orienta o usuário a responder a uma mídia');

  // 6.2 !revelar citando a mensagem que está em cache
  sentMessages = [];
  const replyCmdMsg = {
    message: {
      extendedTextMessage: {
        text: '!revelar',
        contextInfo: {
          stanzaId: testVoId,
          participant: userJid,
          quotedMessage: mockMsgV2.message
        }
      }
    }
  };

  await spyFeatures.handleRevelar(mockSock, replyCmdMsg, groupJid);
  assert(sentMessages.length >= 1, 'Deve revelar a mídia citada');
  assert(sentMessages[0].content.image, 'Deve reenviar o buffer da imagem recuperada');
  console.log('  ✅ 6.2 !revelar citando a mídia recupera e reenvia instantaneamente');

  console.log('\n--- TESTE 7: Delação de Mensagem Apagada (handleRevoke com X9) ---');
  await spyFeatures.handleX9(mockSock, groupJid, '!x9 on', false);
  sentMessages = [];
  const deletedMsgId = 'DEL_99988';
  spyFeatures.recentMessages.set(`${groupJid}:${deletedMsgId}`, {
    from: groupJid,
    id: deletedMsgId,
    sender: userJid,
    text: 'Mensagem secreta que apaguei',
    pushName: 'João Lead',
    timestamp: Date.now() - 5000
  });

  await spyFeatures.handleRevoke(mockSock, groupJid, deletedMsgId, userJid);
  assert(sentMessages.length >= 1, 'X9 deve dedurar mensagem apagada');
  assert(sentMessages[0].content.text.includes('X9 DO GRUPO'), 'Deve alertar como X9 do grupo');
  assert(sentMessages[0].content.text.includes('Mensagem secreta que apaguei'), 'Deve expor o texto original');

  const x9RevokeEvents = models.getX9Events(groupJid, 10);
  assert(x9RevokeEvents.some(e => e.event_type === 'REVOKED_MESSAGE'), 'Deve registrar REVOKED_MESSAGE no x9_events_log');
  console.log('  ✅ 7.1 X9 dedurou mensagem apagada e expôs o autor e conteúdo');

  console.log('\n--- TESTE 8: !x9 logs Exibe Histórico Completo de Auditoria ---');
  sentMessages = [];
  await spyFeatures.handleX9(mockSock, groupJid, '!x9 logs', false);
  assert(sentMessages[0].content.text.includes('ÚLTIMAS DELAÇÕES DO X9'), 'Deve listar as delações');
  assert(sentMessages[0].content.text.includes('Mensagem Apagada') || sentMessages[0].content.text.includes('Visualização Única'), 'Deve conter os tipos delatados');
  console.log('  ✅ 8.1 !x9 logs exibe o histórico consolidado de auditoria');

  console.log('\n--- TESTE 9: Endpoints REST no Servidor (/api/groups/:groupId/x9 e /api/view-once-logs) ---');
  const expressApp = createServer();
  const server = http.createServer(expressApp);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 9.1 Consulta status X9
    const resGetX9 = await fetch(`${baseUrl}/api/groups/${groupJid}/x9`);
    assert.strictEqual(resGetX9.status, 200);
    const dataGetX9 = await resGetX9.json();
    assert.strictEqual(dataGetX9.success, true);
    assert.strictEqual(dataGetX9.x9_enabled, true);
    assert(Array.isArray(dataGetX9.events), 'Deve retornar lista de eventos X9');

    // 9.2 Alteração via API
    const resPostX9 = await fetch(`${baseUrl}/api/groups/${groupJid}/x9`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert.strictEqual(resPostX9.status, 200);
    const dataPostX9 = await resPostX9.json();
    assert.strictEqual(dataPostX9.x9_enabled, false);

    // 9.3 Logs de Visualização Única
    const resVoLogs = await fetch(`${baseUrl}/api/view-once-logs?chatId=${groupJid}`);
    assert.strictEqual(resVoLogs.status, 200);
    const dataVoLogs = await resVoLogs.json();
    assert(dataVoLogs.count > 0, 'Deve listar registros de view_once_logs');
    console.log('  ✅ 9.1 Endpoints REST /api/groups/:groupId/x9 e /api/view-once-logs funcionando 100%');
  } finally {
    server.close();
  }

  // ==========================================
  // PARTE 3: REVELAÇÃO SOB DEMANDA VIA !VER (MENSAGEM CITADA/RESPONDIDA)
  // ==========================================
  console.log('\n--- TESTE 10: Comando !ver por Qualquer Membro ao Citar Mídia de Visualização Única ---');

  // 10.1 Membro A envia foto de visualização única no grupo
  const authorPhone = '5511988887777';
  const authorJid = `${authorPhone}@s.whatsapp.net`;
  const requesterPhone = '5521977776666';
  const requesterJid = `${requesterPhone}@s.whatsapp.net`;

  const voPhotoId = 'VO_PHOTO_998877';
  const voPhotoMsg = {
    key: { remoteJid: groupJid, id: voPhotoId, participant: authorJid },
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: {
            url: 'https://whatsapp.net/mms/image/encrypted_123',
            caption: 'Foto confidencial de visualização única',
            mimetype: 'image/jpeg'
          }
        }
      }
    }
  };

  // Pré-captura executada automaticamente no recebimento
  await spyFeatures.captureViewOnceMedia(mockSock, voPhotoMsg, groupJid);

  // 10.2 Membro B responde à foto enviando !ver
  sentMessages = [];
  const replyWithVer = {
    key: { remoteJid: groupJid, id: 'CMD_VER_001', participant: requesterJid },
    message: {
      extendedTextMessage: {
        text: '!ver',
        contextInfo: {
          stanzaId: voPhotoId,
          participant: authorJid,
          quotedMessage: {
            imageMessage: { caption: 'Foto confidencial de visualização única' }
          }
        }
      }
    }
  };

  await spyFeatures.handleRevelar(mockSock, replyWithVer, groupJid);
  assert(sentMessages.length >= 1, 'Deve enviar a imagem revelada');
  const revealedPhoto = sentMessages[0];
  assert(revealedPhoto.content.image, 'Deve conter o buffer da imagem');
  assert(revealedPhoto.content.caption.includes('MÍDIA DE VISUALIZAÇÃO ÚNICA REVELADA'), 'Deve ter cabeçalho de revelação');
  assert(revealedPhoto.content.caption.includes(authorPhone), 'Deve mencionar o autor original');
  assert(revealedPhoto.content.caption.includes(requesterPhone), 'Deve mencionar quem solicitou o !ver');
  assert(revealedPhoto.content.caption.includes('Foto confidencial'), 'Deve manter a legenda original');
  console.log('  ✅ 10.1 !ver ao responder foto única traz a imagem em alta qualidade citando autor e solicitante');

  // 10.3 Membro A envia vídeo de visualização única
  const voVideoId = 'VO_VIDEO_445566';
  const voVideoMsg = {
    key: { remoteJid: groupJid, id: voVideoId, participant: authorJid },
    message: {
      viewOnceMessage: {
        message: {
          videoMessage: {
            url: 'https://whatsapp.net/mms/video/encrypted_456',
            caption: 'Vídeo secreto em visualização única',
            mimetype: 'video/mp4'
          }
        }
      }
    }
  };
  await spyFeatures.captureViewOnceMedia(mockSock, voVideoMsg, groupJid);

  // Membro C responde com /ver (usando barra)
  sentMessages = [];
  const replyWithSlashVer = {
    key: { remoteJid: groupJid, id: 'CMD_VER_002', participant: requesterJid },
    message: {
      extendedTextMessage: {
        text: '/ver',
        contextInfo: {
          stanzaId: voVideoId,
          participant: authorJid,
          quotedMessage: {
            videoMessage: { caption: 'Vídeo secreto em visualização única' }
          }
        }
      }
    }
  };

  await spyFeatures.handleRevelar(mockSock, replyWithSlashVer, groupJid);
  assert(sentMessages.length >= 1, 'Deve enviar o vídeo revelado');
  const revealedVideo = sentMessages[0];
  assert(revealedVideo.content.video, 'Deve conter o buffer do vídeo');
  assert(revealedVideo.content.caption.includes('VÍDEO DE VISUALIZAÇÃO ÚNICA REVELADO'), 'Deve confirmar revelação de vídeo');
  assert(revealedVideo.content.caption.includes('Vídeo secreto'), 'Deve manter a legenda');
  console.log('  ✅ 10.2 /ver ao responder vídeo único entrega o vídeo em alta qualidade no chat');

  // 10.4 Membro envia áudio/voz de visualização única
  const voAudioId = 'VO_AUDIO_112233';
  const voAudioMsg = {
    key: { remoteJid: groupJid, id: voAudioId, participant: authorJid },
    message: {
      viewOnceMessageV2: {
        message: {
          audioMessage: {
            url: 'https://whatsapp.net/mms/audio/encrypted_789',
            mimetype: 'audio/ogg; codecs=opus'
          }
        }
      }
    }
  };
  await spyFeatures.captureViewOnceMedia(mockSock, voAudioMsg, groupJid);

  sentMessages = [];
  const replyWithVoAudio = {
    key: { remoteJid: groupJid, id: 'CMD_VER_003', participant: requesterJid },
    message: {
      extendedTextMessage: {
        text: '!ver',
        contextInfo: {
          stanzaId: voAudioId,
          participant: authorJid
        }
      }
    }
  };

  await spyFeatures.handleRevelar(mockSock, replyWithVoAudio, groupJid);
  assert(sentMessages.length >= 1, 'Deve enviar o áudio revelado');
  const revealedAudio = sentMessages[0];
  assert(revealedAudio.content.audio, 'Deve conter o buffer do áudio');
  assert(revealedAudio.content.ptt, 'Deve ser enviado como mensagem de voz ptt');
  console.log('  ✅ 10.3 !ver ao responder áudio único entrega a nota de voz permanente no chat');

  console.log('\n🎉 TODOS OS 10 TESTES DO SISTEMA X9 E VISUALIZAÇÃO ÚNICA (!VER) PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de X9 e Visualização Única:', err);
  process.exit(1);
});

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('🚀 Iniciando testes de integração do CreativeField & FotoField...');

  // 1. Testar Serviço CreativeField
  console.log('\n--- Teste 1: Serviço CreativeField (Instalação e Status) ---');
  const creativeFieldService = require('./src/services/creativeFieldService');
  assert(creativeFieldService.isInstalled(), 'tools/Creativefield deve estar instalado com package.json');
  assert(creativeFieldService.isDependenciesInstalled(), 'tools/Creativefield/node_modules deve estar presente');
  assert(creativeFieldService.isBuildReady(), 'tools/Creativefield/dist deve estar compilado');
  console.log('✅ Repositório, dependências e build do CreativeField validados!');

  const health = await creativeFieldService.checkHealth();
  console.log('Status CreativeField:', health);
  assert(health.serviceName.includes('CreativeField'), 'Nome do serviço inválido');
  assert(health.endpoint === 'http://127.0.0.1:8787', 'Endpoint padrão deve ser porta 8787');
  assert(health.fotoFieldUrl === 'http://127.0.0.1:8787/#video', 'URL do FotoField deve ser http://127.0.0.1:8787/#video');
  assert(health.installed === true, 'Deve reportar installed = true');
  assert(health.buildReady === true, 'Deve reportar buildReady = true');

  // 2. Testar Scripts de Inicialização no Windows
  console.log('\n--- Teste 2: Scripts de Inicialização (.bat e .ps1) ---');
  const batPath = path.resolve(__dirname, 'iniciar_creativefield.bat');
  const ps1Path = path.resolve(__dirname, 'iniciar_creativefield.ps1');
  const fullBatPath = path.resolve(__dirname, 'iniciar_estudio_ia_completo.bat');

  assert(fs.existsSync(batPath), 'iniciar_creativefield.bat deve existir');
  assert(fs.existsSync(ps1Path), 'iniciar_creativefield.ps1 deve existir');
  assert(fs.existsSync(fullBatPath), 'iniciar_estudio_ia_completo.bat deve existir');

  const batContent = fs.readFileSync(batPath, 'utf8');
  assert(batContent.includes('npm start'), 'Script bat deve executar npm start');
  assert(batContent.includes('8787'), 'Script bat deve referenciar a porta 8787');
  console.log('✅ Scripts Windows (.bat e .ps1) verificados com sucesso!');

  // 3. Testar Comandos do WhatsApp Bot
  console.log('\n--- Teste 3: Comandos do Bot WhatsApp (!creativefield / !fotofield) ---');
  const botInstance = require('./src/bots/whatsappBot');
  let sentMessages = [];
  const mockSock = {
    user: { id: '5511999999999:1@s.whatsapp.net' },
    sendMessage: async (jid, payload) => {
      sentMessages.push({ jid, payload });
      return { key: { id: 'MSG_' + Date.now() } };
    }
  };

  await botInstance.handleComfyArtCommand(mockSock, '5511888888888@s.whatsapp.net', '!creativefield', true);
  assert(sentMessages.length === 1, 'Deve ter enviado resposta para !creativefield');
  assert(sentMessages[0].payload.text.includes('CreativeField & FotoField'), 'Mensagem deve citar CreativeField & FotoField');
  assert(sentMessages[0].payload.text.includes('8787'), 'Mensagem deve conter a porta 8787');
  assert(sentMessages[0].payload.text.includes('HIGGSFIELD'), 'Mensagem deve citar o desafio Higgsfield');
  console.log('✅ Comando !creativefield no WhatsApp validado com sucesso!');

  // Testar comando !fotofield
  sentMessages = [];
  await botInstance.handleComfyArtCommand(mockSock, '5511888888888@s.whatsapp.net', '!fotofield', true);
  assert(sentMessages.length === 1, 'Deve ter enviado resposta para !fotofield');
  assert(sentMessages[0].payload.text.includes('FotoField'), 'Mensagem deve citar FotoField');
  console.log('✅ Comando !fotofield no WhatsApp validado com sucesso!');

  // 4. Testar Integração Conjunta (ComfyArt + CreativeField)
  console.log('\n--- Teste 4: Integração Conjunta (ComfyArt + CreativeField) ---');
  const comfyArtService = require('./src/services/comfyArtService');
  const comfyStatus = await comfyArtService.checkStatus();
  assert(comfyStatus.officialWorkflowsCount >= 30, 'ComfyArt deve continuar com 33 workflows oficiais');
  console.log(`✅ ComfyArt (Porta 8188) e CreativeField (Porta 8787) coexistem em harmonia!`);

  console.log('\n🎉 TODOS OS TESTES DE INTEGRAÇÃO DO CREATIVEFIELD PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE DO CREATIVEFIELD:', err);
  process.exit(1);
});

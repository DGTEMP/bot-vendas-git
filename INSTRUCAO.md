# 📘 MANUAL DE ENGENHARIA & ONBOARDING — PROJETO PAYBOT TECH
> **Documento Oficial de Instruções e Diretrizes de Arquitetura para Desenvolvedores**  
> **Versão:** 3.0 (2026) | **Status:** Produção & Expansão Contínua | **Ambiente:** Windows / Node.js 18+

Seja muito bem-vindo à equipe de desenvolvimento do **PayBot**! Este documento foi estruturado para que você possa entender rapidamente toda a arquitetura, regras de negócio, fluxos de dados, componentes técnicos e boas práticas do ecossistema, permitindo que você colabore com máxima produtividade desde o seu primeiro commit.

---

## 🎯 1. VISÃO GERAL DO PROJETO

O **PayBot** é uma plataforma corporativa completa de **Vendas Automatizadas, CRM Cognitivo, Assinaturas VIP, Automação ZapVoice e Gestão de Comunidades** que opera de forma integrada via **WhatsApp (Baileys v7 Multi-Device)** e **Telegram (Telegraf)**.

### Capacidades Centrais da Plataforma:
1. **Cobrança Multi-Gateway em Tempo Real**:
   - 🟢 **PIX Dinâmico (Mercado Pago)**: Gera QR Code em imagem + código Copia e Cola instantâneo com conciliação via Webhook ou Polling.
   - 🟡 **Binance Pay (Cripto/USDT)**: Cobranças globais descentralizadas com confirmação de pagamento instantânea.
   - 💜 **LivePix (PIX Secundário / Fallback)**: Redirecionamento automático caso a conta primária do Mercado Pago oscile.
   - 🧪 **Modo de Simulação Global**: Permite testar todo o fluxo de ponta a ponta sem transações financeiras reais.
2. **Entrega Instantânea (Fulfillment)**:
   - Licenças/chaves de software em estoque unitário ou geradas dinamicamente.
   - Links de convite exclusivos para grupos/canais VIP com revogação e expulsão automática ao expirar a assinatura.
   - Comissões automáticas para afiliados e distribuição de leads via roleta de vendedores (*Round-Robin*).
3. **ZapVoice 2025 & Síntese Neural de Voz PTT**:
   - **Áudios PTT Humanizados (Microfone Verde)**: Áudios entregues no WhatsApp com aparência de gravação em tempo real no celular (`ptt: true`, codec Opus).
   - **Voz Neural TTS**: Geração de áudios sob demanda via **Microsoft Edge-TTS** (vozes `FranciscaNeural`, `AntonioNeural`, etc.) e **Google TTS**.
   - **Funis de Conversão Sequenciais**: Disparo de múltiplos passos (texto + áudio + fechamento) com simulação de presença (`recording`, `composing`) e delay dinâmico anti-ban.
   - **Biblioteca de Mensagens Rápidas & Atalhos**: Atalhos (`/preco`, `/pix`, `/proposta`) com preenchimento de variáveis dinâmicas (`{primeiro_nome}`, `{saudacao}`, `{chave_pix}`, `{valor}`).
   - **Disparador de Campanhas em Massa**: Envio progressivo para listas de contatos com jitter aleatório configurável.
   - **Carga de Modelos Oficiais com 1 Clique**: Botão no painel que popula automaticamente 5 funis de alta conversão, 4 áudios PTT e 7 mensagens rápidas.
4. **Diálogo Inicial no Privado (PV) de Alta Conversão**:
   - Saudação inteligente com horário de Brasília (`Bom dia`, `Boa tarde`, `Boa noite`).
   - Reconhecimento automático do primeiro nome do lead através do `pushName`.
   - Identificação de cliente recorrente (com histórico de compras) vs novo lead.
   - 3 Modos configuráveis no painel: `MENU` (5 opções interativas), `CONSULTATIVO` (diagnóstico investigativo) e `CUSTOM` (Spintax `{Olá|Oi|Opa}` + tags).
   - Cooldown inteligente anti-spam para não reenviar menus longos em conversas ativas.
   - Inscrição automática do lead no CRM Cognitivo Hexis em estágio `DESCOBERTA`.
5. **Segurança de Grupos & Spy Bot (Nazuna Core)**:
   - **Anti-View-Once**: Revelação permanente de fotos, vídeos e áudios de visualização única (com destino configurável: grupo ou PV confidencial do Dono).
   - **Anti-Delete**: Interceptação de mensagens apagadas com delação do autor e conteúdo original.
   - **Proteções Ativas**: Anti-Link, Anti-Fake (+55), Anti-Flood, Anti-Documento, Anti-Localização, Blacklist Global e Mute individual.
6. **Multi-Tenant SaaS & Exército de Chips (WhatsApp Army)**:
   - Gestão de múltiplos números de WhatsApp simultâneos (Matriz + Sub-Bots).
   - Lançamento Meteórico automatizado com transbordamento inteligente entre grupos cheios.
   - Duplo Túnel Cloudflare confidencial com isolamento estrito de portas (Admin vs Loja Pública).

---

## 🏗️ 2. STACK TECNOLÓGICA & PRÉ-REQUISITOS

* **Runtime:** Node.js (versão 18+ LTS, validado até Node 24).
* **WhatsApp Engine:** `@whiskeysockets/baileys` (v7.0.0-rc14) com protocolo multi-device e signal key store em cache.
* **Telegram Engine:** `telegraf` (v4.16.3).
* **Banco de Dados:** SQLite em modo **WAL (Write-Ahead Logging)** com transações seguras e prepared statements (`better-sqlite3`).
* **Servidores Web Isolados:**
  * **Porta 3000:** Painel Administrativo, Backoffice e APIs de Gestão Interna (`src/server/app.js` -> `createServer`).
  * **Porta 3001:** Vitrine Pública e Loja Virtual dos Clientes (`src/server/app.js` -> `createStoreServer`).
* **Processamento de Mídia:**
  * `ffmpeg` (para conversão e empacotamento em OGG Opus WhatsApp PTT).
  * `edge-tts` (Python) / Google Translate TTS para síntese vocal neural humana.
* **Frontend:** Single-Page Application (SPA) nativa (HTML5, Vanilla CSS3 responsivo, JavaScript ES6+ moderno) — **sem ferramentas pesadas de build (sem Webpack/Vite)**, garantindo carregamento instantâneo e manutenção direta.

---

## 📁 3. ESTRUTURA DO REPOSITÓRIO

```
bot vendas git/
├── src/
│   ├── index.js                     # Ponto de entrada mestre (inicia DB, servidores, bots e crons)
│   ├── config.js                    # Leitura de variáveis de ambiente (.env) e fallbacks
│   ├── handler.js                   # Roteador mestre de comandos do WhatsApp
│   │
│   ├── db/
│   │   ├── database.js              # Inicialização do SQLite, migrações de schema, chaves padrão e seeds
│   │   └── models.js                # Camada ORM/Data Access Layer (queries preparadas better-sqlite3)
│   │
│   ├── server/
│   │   └── app.js                   # Servidores Express: createServer (3000) e createStoreServer (3001)
│   │
│   ├── bots/
│   │   ├── whatsappBot.js           # Cliente Baileys Matriz, eventos de conexão, diálogo no PV e menus
│   │   └── telegramBot.js           # Cliente Telegraf para Telegram e canais VIP
│   │
│   ├── services/
│   │   ├── zapVoiceService.js       # Funis ZapVoice, campanhas, delay anti-ban e execução PTT
│   │   ├── audioConverterService.js # Conversão FFmpeg Opus e síntese neural Edge/Google TTS
│   │   ├── spyFeaturesService.js    # Anti-View-Once, Anti-Delete, Anti-Fake e X9 Audit
│   │   ├── cognitiveSalesService.js # CRM Cognitivo Hexis & inteligência de objeções
│   │   ├── nlpService.js            # Classificação de intenções no WhatsApp privado
│   │   ├── binancePay.js            # Integração com Binance Pay API (USDT)
│   │   ├── pixPayment.js            # Mercado Pago Pix Dinâmico e LivePix secundário
│   │   ├── fulfillment.js           # Entrega de pedidos, chaves, licenças e comissões
│   │   ├── meteoricService.js       # Cockpit de Lançamentos Meteóricos em múltiplos grupos
│   │   ├── whatsappArmyService.js   # Gestão de múltiplos chips WhatsApp (Sub-Bots)
│   │   ├── groupRentalService.js    # Sistema de aluguel e expiração de grupos
│   │   ├── tunnelService.js         # Gerenciamento de túneis Cloudflare (trycloudflare)
│   │   └── subscriptionCron.js      # Cron de verificação de expiração de assinaturas VIP
│   │
│   └── public/                      # Frontend SPA do Painel Administrativo
│       ├── index.html               # Interface completa do Painel Admin (Dashboard)
│       ├── app.js                   # Lógica JavaScript cliente (REST, SSE, Modais, ZapVoice)
│       ├── style.css                # Estilização moderna Dark Glassmorphism
│       ├── store.html               # Vitrine Pública da Loja (Porta 3001)
│       └── tenant_dashboard.html    # Painel isolado para clientes SaaS
│
├── data/                            # Persistência de dados locais
│   ├── database.sqlite              # Banco de dados principal SQLite
│   ├── zapvoice_audios/             # Arquivos de áudio .opus e .mp3 persistidos
│   └── whatsapp_auth/               # Sessão e credenciais criptográficas do Baileys
│
├── INSTRUCAO.md                     # Este manual de engenharia e arquitetura
├── INSTRUCOES.md                    # Atalho de referência para desenvolvedores
├── package.json                     # Metadados e dependências do projeto
└── .env                             # Credenciais e parâmetros de ambiente
```

---

## 🎛️ 4. ARQUITETURA DETALHADA DOS MÓDULOS CENTRAIS

### 4.1. Conexão do WhatsApp & Baileys (`whatsappBot.js`)
* **Keep-Alive do WebSocket:** O parâmetro `keepAliveIntervalMs` deve ser mantido entre **20s e 30s** (padrão: `25s`). O WhatsApp encerra sockets ociosos após 35 segundos sem ping, provocando o erro **código 428 (`connectionClosed`)**.
* **Prevenção de Race Conditions:** O método `start()` possui trava com `isStarting`. Nunca chame `makeWASocket` em paralelo. Todas as reconexões passam por `scheduleReconnect(delayMs)`, que limpa timers pendentes com `clearTimeout()`.
* **Resolução Criptográfica de Mensagens (`getMessage`):** O callback `getMessage` fornecido ao Baileys **nunca deve retornar mensagens falsas estáticas** (como `{ conversation: 'PayBot' }`), pois isso corrompe os *prekey bundles* do Signal. Ele consulta a mensagem real no cache em memória `spyFeatures.recentMessages` ou retorna `undefined`.
* **Filtro de Ruído do LibSignal:** Ao renovar sessões, a biblioteca `libsignal` imprime dumps gigantescos de `SessionEntry` no terminal. Esses dumps são suprimidos dinamicamente via interceptor de console quando `WPP_SUPPRESS_LIBSIGNAL_LOGS === true`.

---

### 4.2. Central ZapVoice 2025 (`zapVoiceService.js`)
A Central ZapVoice é dividida em 4 pilares visuais e funcionais:

1. **Funis & Fluxos Sequenciais**:
   - Cada funil possui `name`, `trigger_keywords`, `active` e uma lista ordenada de etapas (`steps`).
   - Etapas suportam tipos: `text`, `audio_ptt`, `image`, `video`.
   - Cada etapa tem seu próprio `delay_seconds` e configuração `is_ptt`.
   - A execução simula presença no WhatsApp (`composing` para texto e `recording` para áudio) antes do envio.

2. **Biblioteca de Áudios PTT**:
   - Áudios são entregues no WhatsApp com `ptt: true` e `mimetype: 'audio/ogg; codecs=opus'`.
   - Podem ser carregados por upload (.mp3, .ogg, .wav) ou sintetizados via Voz Neural (Edge-TTS / Google TTS).
   - O player nativo HTML5 do painel consome o endpoint `GET /api/zapvoice/audios/:id/stream` com suporte a cabeçalhos `Range` (`206 Partial Content`).

3. **Mensagens Rápidas & Variáveis Dinâmicas**:
   - Atalhos iniciados por barra (ex: `/preco`, `/pix`).
   - Variáveis dinâmicas suportadas:
     - `{primeiro_nome}`: Primeiro nome do lead.
     - `{nome}`: Nome completo.
     - `{saudacao}`: Bom dia / Boa tarde / Boa noite conforme a hora atual.
     - `{chave_pix}`: Chave Pix configurada no sistema.
     - `{valor}`: Valor formatado (ex: R$ 49,90).
     - `{vitrine_url}`: URL pública da vitrine da loja.
     - `{link_proposta}`: Link comercial.

4. **Campanhas de Disparo em Massa com Anti-Ban**:
   - Tabela: `zapvoice_campaigns` (`name`, `funnel_id`, `targets`, `min_delay`, `max_delay`, `sent_count`, `total_count`, `status`).
   - O disparador calcula um jitter dinâmico: `delay = Math.floor(Math.random() * (max - min + 1)) + min` (segundos entre envios).
   - O painel exibe progresso percentual em tempo real e permite Pausar, Retomar e Excluir campanhas.

5. **Gatilhos por Palavra-Chave**:
   - A função `findMatchingTrigger(text)` utiliza fronteiras de palavra (*regex unicode* `(?:^|[^\p{L}\p{N}])palavra(?:[^\p{L}\p{N}]|$)`) para garantir que palavras curtas como `vip` ou `app` não disparem acidentalmente dentro de palavras como `cotacaoviptech` ou `whatsapp`.

---

### 4.3. Diálogo Inicial no Privado do WhatsApp (`whatsappBot.js`)
Quando um usuário envia uma saudação no privado (`oi`, `olá`, `bom dia`, etc.):

1. **Reconhecimento do Lead**:
   - Extrai o primeiro nome de `pushName`.
   - Verifica no banco de dados se o número já realizou compras anteriores. Se sim, saúda como cliente recorrente.
2. **Modos de Operação (Seção 13 do Painel)**:
   - **`MENU`**:
     ```
     ☀️ Bom dia, Lucas! Tudo bem com você? 👋
     Seja muito bem-vindo à PayBot Tech Pro — Soluções Inteligentes de Vendas!
     
     Como posso te ajudar hoje? Escolha uma das opções abaixo:
     1️⃣ Ver Catálogo & Comprar Produtos
     2️⃣ Aluguel de Bots de Grupos
     3️⃣ Desenvolvimento de Software Sob Medida
     4️⃣ Falar com Atendente / Suporte Técnico
     5️⃣ Consultar Meus Pedidos
     ```
   - **`CONSULTATIVO`**: Inicia com uma pergunta investigativa de diagnóstico para qualificar a necessidade do lead.
   - **`CUSTOM`**: Executa o texto configurado pelo Dono, processando Spintax (`{Opção A|Opção B}`) e tags dinâmicas.
3. **Máquina de Estados de Sessão (`userSessions`)**:
   - Diferencia o estado `WELCOME_MENU` do estado `VIEWING_CATALOG`.
   - Se o usuário estiver no menu inicial, digitar `1`, `2`, `3`, `4`, `5` navega pelas opções institucionais.
   - Se estiver visualizando o catálogo de produtos, os números selecionam os produtos da loja.
   - O comando `voltar` ou `menu` retorna para o menu inicial.
4. **Cooldown Anti-Spam (`PV_WELCOME_COOLDOWN_HOURS`)**:
   - Se o lead já conversou com o bot nas últimas X horas, o bot não repete o menu longo; responde de forma acolhedora e direta: *"Opa Lucas! Tudo bem por aqui. Como posso te ajudar agora?"*.

---

### 4.4. Isolamento dos Servidores Web & Segurança dos Túneis
* **Porta 3000 (Admin Server):** Contém todas as rotas de API administrativa (`/api/settings`, `/api/zapvoice`, `/api/army`, `/api/orders`, etc.) e o painel backoffice.
* **Porta 3001 (Store Server):** Vitrine pública dos clientes (`store.html`).
* **Regra de Isolamento Rígido:** Qualquer tentativa de acessar endpoints administrativos através da porta 3001 recebe imediatamente **`403 Forbidden`**.

---

## 🎛️ 5. TABELA DE CONFIGURAÇÕES (`settings`)

Todas as configurações são persistidas na tabela `settings` do SQLite e editáveis no Painel Admin:

| Seção | Chave de Configuração | Tipo | Padrão | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| **10. View-Once** | `ANTIVIEWONCE_DEFAULT` | Boolean | `true` | Ativação global da revelação de visualização única. |
| **10. View-Once** | `ANTIVIEWONCE_TARGET` | Enum | `'SAME_CHAT'` | Destino da mídia: `'SAME_CHAT'`, `'OWNER_PV'` ou `'BOTH'`. |
| **11. WhatsApp** | `WPP_KEEPALIVE_INTERVAL_SEC` | Integer | `25` | Intervalo em segundos de keep-alive WebSocket. |
| **11. WhatsApp** | `WPP_AUTO_RECONNECT` | Boolean | `true` | Reconexão contínua automática em caso de queda de rede. |
| **11. WhatsApp** | `WPP_SUPPRESS_LIBSIGNAL_LOGS` | Boolean | `true` | Silencia dumps de `SessionEntry` no terminal. |
| **12. ZapVoice** | `ZAPVOICE_TTS_AUTO_SYNTHESIS` | Boolean | `true` | Converte texto em voz neural se faltar áudio físico. |
| **12. ZapVoice** | `ZAPVOICE_TTS_ENGINE` | Enum | `'edge'` | Provedor de TTS: `'edge'` (Edge-TTS) ou `'google'` (Google TTS). |
| **12. ZapVoice** | `ZAPVOICE_TTS_VOICE` | String | `'pt-BR-FranciscaNeural'` | Voz neural brasileira padrão. |
| **12. ZapVoice** | `ZAPVOICE_DEFAULT_DELAY_SEC` | Integer | `3` | Delay padrão entre etapas do funil. |
| **13. Diálogo PV** | `WPP_PV_WELCOME_MODE` | Enum | `'MENU'` | Modo do primeiro contato: `'MENU'`, `'CONSULTATIVO'`, `'CUSTOM'`. |
| **13. Diálogo PV** | `WPP_PV_WELCOME_AUDIO_ENABLED` | Boolean | `false` | Dispara áudio PTT gravado na hora junto com as boas-vindas. |
| **13. Diálogo PV** | `PV_WELCOME_COOLDOWN_HOURS` | Integer | `4` | Horas de cooldown para não reenviar menu longo. |

---

## 🚀 6. COMANDOS DO SISTEMA & ROTINAS DE TESTE

### 6.1. Como Iniciar a Aplicação

```powershell
# Instalar dependências
npm install

# Iniciar servidor em produção com GC exposto
npm start

# Iniciar em modo desenvolvimento com watch
npm run dev
```

### 6.2. Suíte de Testes Automatizados

**Sempre execute a bateria de testes antes de subir alterações**:

```powershell
# 1. Teste do Diálogo Inicial no Privado (Modos Menu, Consultivo, Custom e CRM)
node test_private_dialogue_enhanced.js

# 2. Teste da Central ZapVoice (Templates, Campanhas, Streaming de Áudio e Backup)
node test_zapvoice_campaigns_and_templates.js

# 3. Teste do Verificado Global, Comando /fake, MenuAdm e ZapVoice Integrado
node test_verificado_fake_zapvoice_menuadm.js

# 4. Teste do Anti-View-Once e Auditoria X9
node test_x9_and_viewonce.js

# 5. Teste de Acesso do Dono e Comando !fake
node test_fake_and_owner_panel.js

# 6. Teste de Isolamento de Segurança dos Túneis (Porta 3000 vs 3001)
node test_dual_tunnels_security.js
```

---

## 🛡️ 7. BOAS PRÁTICAS & DIRETRIZES DE CÓDIGO

1. **Segurança de Banco de Dados**:
   - Utilize sempre `db.prepare('...').run()` ou `.get()`. Nunca use concatenação de strings em SQL.
2. **Normalização de JIDs**:
   - Utilize os helpers de extração (`from.replace(/@.*$/, '')`) para obter números puros sem sufixos.
   - Trate sempre tanto `@s.whatsapp.net` quanto contas `@lid`.
3. **Buffers de Áudio no WhatsApp**:
   - O Baileys rejeita conexões se receber mídias de áudio corrompidas. Certifique-se de que buffers de áudio sejam arquivos OGG Opus válidos e use sempre `mimetype: 'audio/ogg; codecs=opus'`.
4. **Respeito ao Modo de Teste**:
   - Em testes unitários (`process.env.NODE_ENV === 'test'`), chamadas pesadas de FFmpeg ou rede externa utilizam simulações locais rápidas para manter os testes rodando em menos de 2 segundos.
5. **Configuração Centralizada no Painel Web**:
   - Qualquer nova regra ou comportamento criado deve ter sua respectiva chave adicionada no banco de dados e controle visual correspondente no painel web (`src/public/index.html` e `src/public/app.js`).

---

**Equipe PayBot Tech**  
*Excelência em engenharia, alta conversão e automação inteligente.* 🚀

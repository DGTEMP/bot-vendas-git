# 🚀 PayBot - Vendas Automatizadas & Assinaturas VIP (WhatsApp & Telegram) com Binance Pay (USDT)

Sistema completo e profissional para venda de **produtos digitais** (links, e-books, arquivos) e **assinaturas recorrentes/VIP** (grupos e canais no Telegram) com cobrança automatizada via **Binance Pay**.

---

## 🌟 Principais Recursos

- ⚡ **Cobranças Automáticas via Binance Pay**:
  - Geração de QR Code e link de checkout oficial da Binance para pagamentos em **USDT** (ou outras criptos).
  - Verificação dupla: **Webhook em tempo real** + **Motor de Polling em segundo plano** (identifica o pagamento mesmo rodando em localhost sem IP público!).
  - **Modo de Simulação / Teste**: teste todo o fluxo (compra -> pagamento -> entrega) sem gastar cripto real.
- 📱 **Robô de Atendimento no WhatsApp**:
  - Conexão nativa Multi-Device via **Baileys** (basta escanear o QR Code no terminal ou no painel web).
  - Catálogo interativo, comandos simples (`menu`, `ajuda`, `status`), envio de imagem de QR Code e entrega automática no chat.
- 🤖 **Robô de Atendimento no Telegram**:
  - Menu moderno com botões inline interativos (`/start`, `/produtos`, `/planos`, `/ajuda`).
  - Geração de fatura com QR Code e botão de checkout direto para o aplicativo da Binance.
- ⭐ **Gestão Automatizada de Assinaturas VIP (Telegram)**:
  - Gera **link de convite de uso único** (`member_limit: 1`) para evitar vazamento ou compartilhamento.
  - Monitora o prazo de validade (ex: 30 dias, 90 dias, 365 dias).
  - Envia **lembrete de renovação** automático 48 horas antes do vencimento.
  - **Remove/expulsa o usuário automaticamente** do canal/grupo VIP quando o prazo expirar sem pagamento de renovação.
- 🔑 **Estoque de Chaves / Licenças**:
  - Cadastro de chaves de ativação ou contas pré-fabricadas com distribuição automática de 1 chave por compra.
- 🖥️ **Painel Administrativo Web (Dashboard)**:
  - Métricas de faturamento em USDT, pedidos pagos e assinaturas ativas.
  - Gerenciador de produtos e planos com criação e edição em tempo real.
  - Leitor do QR Code do WhatsApp em tela para fácil conexão pelo celular.
  - Histórico de pedidos com botão para simular pagamento e testar a entrega na hora.

---

## 📁 Estrutura do Projeto

```
├── src/
│   ├── config.js              # Configurações e variáveis de ambiente
│   ├── index.js               # Ponto de entrada do sistema
│   ├── db/
│   │   ├── database.js        # Banco SQLite integrado (zero dependência externa)
│   │   └── models.js          # Operações de produtos, pedidos, chaves e assinaturas
│   ├── services/
│   │   ├── binancePay.js      # Integração com a API Merchant da Binance Pay
│   │   ├── fulfillment.js     # Entrega automática de produtos e convites VIP
│   │   └── subscriptionCron.js# Motor em segundo plano (polling de pagamentos e prazos VIP)
│   ├── bots/
│   │   ├── telegramBot.js     # Bot do Telegram com teclados inline
│   │   └── whatsappBot.js     # Bot do WhatsApp com Baileys Multi-Device
│   ├── server/
│   │   └── app.js             # API REST, Webhook Binance e simulador de checkout
│   └── public/                # Painel Web Administrativo (HTML, CSS Dark, JS)
│       ├── index.html
│       ├── style.css
│       └── app.js
├── data/                      # Banco de dados e sessão do WhatsApp (gerado automaticamente)
├── .env                       # Variáveis de ambiente configuráveis
├── .env.example
└── package.json
```

---

## 🛠️ Como Iniciar o Sistema

### 1. Pré-requisitos
- Node.js instalado (v18, v20 ou v24+).

### 2. Instalação das dependências
Caso ainda não tenha instalado:
```bash
npm install
```

### 3. Iniciar o Servidor
```bash
npm start
```
Ou no modo de desenvolvimento com auto-reload:
```bash
npm run dev
```

Assim que iniciado, o terminal exibirá:
- **Painel Web:** `http://localhost:3000`
- **QR Code do WhatsApp:** visível no terminal e também na aba **"Conexões & QR"** do painel web.

---

## ⚙️ Como Configurar

Você pode configurar tudo tanto pelo arquivo `.env` quanto diretamente na aba **"Configurações"** do Painel Web:

### 1. Binance Pay (Cobrança Oficial)
1. Acesse o portal de comerciantes da Binance: [Binance Merchant](https://merchant.binance.com/).
2. Ative sua conta de comerciante e gere suas chaves de API:
   - `BINANCE_API_KEY`
   - `BINANCE_SECRET_KEY`
3. Se estiver testando localmente ou sem as chaves ainda, mantenha `BINANCE_SIMULATION_MODE=true`. O sistema funcionará 100% em modo de teste com simulação visual!

### 2. Bot do Telegram & Canal VIP
1. Abra o Telegram e procure por `@BotFather`.
2. Envie `/newbot`, escolha um nome e usuário e copie o **HTTP API Token** gerado.
3. Cole o token no `.env` (`TELEGRAM_BOT_TOKEN`) ou na aba Configurações do Painel.
4. Crie o seu **Canal ou Grupo VIP** no Telegram:
   - Adicione o seu Bot recém-criado como **Administrador** do canal/grupo.
   - Dê permissões de:
     - ✅ *Convidar usuários por link*
     - ✅ *Banir/remover usuários*
5. Obtenha o ID do canal (ex: `-1001234567890`) e salve em `TELEGRAM_VIP_CHANNEL_ID`.

### 3. WhatsApp Bot
1. Inicie o sistema (`npm start`).
2. Acesse `http://localhost:3000` e clique na aba **"Conexões & QR"** (ou veja o QR code no terminal).
3. No WhatsApp do seu celular:
   - Vá em **Configurações > Aparelhos Conectados > Conectar um aparelho**.
   - Aponte a câmera para o QR Code.
4. Pronto! O bot responderá qualquer cliente que mandar mensagem privada.

---

## 💡 Como Funciona a Entrega e Renovação

### Produtos Digitais (Link ou E-book)
- O cliente escolhe o produto, recebe o link da Binance Pay e o QR Code.
- Ao pagar, a Binance confirma e o bot entrega imediatamente a mensagem com o link de download/acesso.

### Chaves de Licença / Contas
- Você cadastra as chaves em lote no Painel Web (Aba **"Estoque de Chaves"**).
- A cada venda confirmada, o sistema retira automaticamente 1 chave única e envia para o comprador.

### Assinaturas VIP
- Ao pagar a assinatura (ex: 30 dias), o robô cria um **link de convite único do Telegram** com limite de 1 pessoa e envia ao comprador.
- A vigência é registrada no banco de dados.
- 48 horas antes de acabar, o robô envia um lembrete amigável no chat com link para renovação.
- Se o prazo expirar sem pagamento, o robô remove o usuário do canal automaticamente e envia aviso de expiração.

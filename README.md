# 🚀 PayBot - Sistema Completo de Vendas Automatizadas & Assinaturas VIP (WhatsApp & Telegram) com PIX & Binance Pay

Sistema profissional para venda de **produtos digitais** (links, cursos, e-books, licenças/chaves) e **assinaturas recorrentes com acesso VIP** (grupos e canais no Telegram) com suporte a cobranças via **PIX Dinâmico (Mercado Pago)**, **Binance Pay (USDT)** e **LivePix**, gerenciado 100% por um **Painel Administrativo Web**.

---

## 🌟 Principais Recursos

- 💳 **Múltiplos Gateways de Pagamento (Configuráveis no Painel Admin)**:
  - 🟢 **PIX Dinâmico (Mercado Pago)**: Gera **QR Code** e código **PIX Copia e Cola** instantaneamente no chat do WhatsApp e Telegram. O cliente paga e em 2 segundos o robô entrega o produto.
  - 🟡 **Binance Pay (Criptomoedas)**: Cobrança automática em **USDT** (ou BTC/BNB) com link de checkout oficial e QR Code do app da Binance.
  - 💜 **LivePix**: Suporte a envio de página de apoiador com webhook de confirmação automática.
  - 🧪 **Modo de Simulação / Testes Global**: Permite testar todo o fluxo de compras e entrega sem gastar dinheiro real.
- ⚙️ **Central de Configurações no Painel Web**:
  - Ative ou desative cada método de pagamento (PIX, Binance Pay, LivePix) com botões de alternância.
  - Insira suas chaves de API, Tokens e IDs de canais diretamente pela interface visual, sem precisar mexer em código.
  - Visualização dos endpoints exatos de Webhook para cadastrar no Mercado Pago, Binance e LivePix.
- 📱 **Robô de Atendimento no WhatsApp**:
  - Conexão nativa Multi-Device via **Baileys** (basta ler o QR Code no terminal ou na tela do painel).
  - Envio de QR Code em imagem + envio do código Pix Copia e Cola em mensagem separada para facilitar o toque e cópia no celular.
- 🤖 **Robô de Atendimento no Telegram**:
  - Menus e teclados inline modernos (`/start`, `/produtos`, `/planos`, `/ajuda`).
  - Geração de cobranças PIX e Binance Pay com botões interativos de checagem imediata.
- ⭐ **Gestão Automatizada de Assinaturas VIP (Telegram)**:
  - Gera **link de convite de uso único** (`member_limit: 1`) exclusivo para o comprador.
  - Registra a vigência (ex: 30, 90, 365 dias).
  - Envia **lembrete de renovação** automático 48 horas antes do vencimento.
  - **Remove o usuário automaticamente** do canal/grupo VIP ao expirar o prazo sem pagamento.
- 🔑 **Estoque de Chaves / Licenças**:
  - Cadastro de chaves e credenciais em lote com entrega automática de 1 chave por cliente.
- 📊 **Painel Web Administrativo**:
  - Métricas separadas de faturamento em **R$ (PIX)** e **USDT (Cripto)**.
  - Gestão visual de produtos, assinaturas ativas e histórico de pedidos.

---

## 🛠️ Como Iniciar o Sistema

### 1. Iniciar o Servidor
No terminal, execute:
```powershell
npm start
```
*(Ou `npm run dev` para modo de desenvolvimento com recarga automática).*

### 2. Acessar a Central de Configurações
Abra no seu navegador:
👉 **http://localhost:3000** e clique na aba **"Central de Configurações"** no menu lateral.

Na Central de Configurações você pode:
1. **Ativar/Desativar** o PIX, o Binance Pay ou o LivePix.
2. Inserir o **Mercado Pago Access Token** (para Pix Copia e Cola real).
3. Inserir a **Binance Pay API Key & Secret Key**.
4. Inserir o **Telegram Bot Token** e o **ID do Canal VIP**.
5. Manter o **Modo de Simulação / Teste** ativo enquanto configura suas contas para testar tudo sem gastar nada!

---

## 📱 Pareamento do WhatsApp

1. Acesse **http://localhost:3000** e vá na aba **"Conexões & QR"** (ou veja o QR Code no próprio terminal).
2. No seu WhatsApp no celular:
   - Vá em **Aparelhos Conectados > Conectar um Aparelho**.
   - Aponte a câmera para o QR Code na tela.
3. Pronto! O WhatsApp responderá automaticamente a comandos como `oi`, `menu`, `1`, `P1`, etc.

---

## 🤖 Configuração do Telegram

1. Fale com o [@BotFather](https://t.me/BotFather) no Telegram e crie seu bot com `/newbot`.
2. Copie o Token HTTP e cole no campo **Telegram Bot Token** na Central de Configurações do painel.
3. Adicione o seu robô como **Administrador** no seu Grupo ou Canal VIP com permissão para:
   - ✅ *Convidar usuários por link*
   - ✅ *Banir/remover usuários*
4. Coloque o ID do canal (ex: `-1001234567890`) no painel.

---

## 🔗 Endpoints de Webhook para Produção

Quando você hospedar seu bot em uma VPS ou usar um túnel como ngrok, cadastre os webhooks nos portais correspondentes:
- **Mercado Pago:** `https://seu-dominio.com/api/mercadopago/webhook`
- **Binance Pay:** `https://seu-dominio.com/api/binance/webhook`
- **LivePix:** `https://seu-dominio.com/api/livepix/webhook`

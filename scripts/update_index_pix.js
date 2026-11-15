const fs = require('fs');
let html = fs.readFileSync('src/public/index.html', 'utf8');

const target = '<h4 class="section-title"><i class="fa-solid fa-key"></i> 5. Chaves de API & Gateways</h4>';
const replacement = `<h4 class="section-title"><i class="fa-solid fa-key"></i> 5. Configuração Oficial de Pagamentos & Chaves Pix</h4>
                  <p class="section-desc">Defina como você deseja receber seus pagamentos via Pix. Compatibilidade total com a especificação oficial do Banco Central (EMVCo BR Code).</p>
                  <div class="form-row">
                    <div class="form-group flex-1">
                      <label><i class="fa-brands fa-pix text-pix"></i> Provedor Primário de Pix</label>
                      <select id="cfgPixPrimaryProvider" class="form-control" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); font-weight: bold; color: #10b981;">
                        <option value="livepix">💜 LivePix (Automação de Checkout / Apoie)</option>
                        <option value="pix_manual">🏦 Chave Pix Oficial BACEN (Direto na sua conta bancária sem intermediários)</option>
                        <option value="mercadopago">💙 Mercado Pago (API Pix com Webhook)</option>
                      </select>
                      <small class="hint">Escolha se o bot deve processar via LivePix ou direto pela sua Chave Pix bancária.</small>
                    </div>
                    <div class="form-group flex-1">
                      <label><i class="fa-solid fa-key gold"></i> Chave Pix Oficial do Recebedor</label>
                      <input type="text" id="cfgPixKey" class="form-control" placeholder="Ex: 48984702848, seu@email.com, CPF ou CNPJ" oninput="updatePixKeyPreview(this.value)">
                      <small id="pixKeyTypeBadge" class="hint" style="color: #38bdf8;"><i class="fa-solid fa-circle-info"></i> Identificação automática do tipo de chave.</small>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group flex-1">
                      <label>Nome do Recebedor / Loja (EMV Tag 59)</label>
                      <input type="text" id="cfgPixMerchantName" class="form-control" placeholder="PAYBOT" maxlength="25">
                      <small class="hint">Nome que aparecerá no app do banco do cliente (máx 25 caracteres).</small>
                    </div>
                    <div class="form-group flex-1">
                      <label>Cidade do Recebedor (EMV Tag 60)</label>
                      <input type="text" id="cfgPixMerchantCity" class="form-control" placeholder="SAO PAULO" maxlength="15">
                      <small class="hint">Cidade registrada na conta bancária (máx 15 caracteres).</small>
                    </div>
                  </div>
                  <div style="margin-bottom: 18px; padding: 12px; background: rgba(56, 189, 248, 0.06); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                    <div>
                      <b style="color: #38bdf8; font-size: 13px;"><i class="fa-solid fa-stethoscope"></i> Testador & Validador de Código Pix</b>
                      <p style="margin: 0; font-size: 11px; color: #94a3b8;">Gera um código Pix de teste e valida instantaneamente conformidade com Nubank, Itaú, Bradesco, Inter, BB, Caixa, etc.</p>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary" onclick="runPixDiagnosticsUI()">
                      <i class="fa-solid fa-circle-check"></i> Testar & Validar Pix Agora
                    </button>
                  </div>
                  <div id="pixDiagResultCard" style="display: none; margin-bottom: 18px; padding: 16px; background: rgba(0,0,0,0.4); border: 1px solid #10b981; border-radius: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                      <span style="font-weight: bold; color: #10b981; font-size: 14px;"><i class="fa-solid fa-shield-halved"></i> Diagnóstico de Conformidade EMV BACEN</span>
                      <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('pixDiagResultCard').style.display='none'">Fechar</button>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
                      <div style="text-align: center;">
                        <img id="pixDiagQrImg" src="" alt="QR Code Pix" style="max-width: 140px; border-radius: 6px; border: 2px solid #fff;">
                      </div>
                      <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
                        <div><b>Status:</b> <span id="pixDiagStatus" class="badge badge-paid">100% Válido</span></div>
                        <div><b>Tipo:</b> <span id="pixDiagType">Estático</span></div>
                        <div><b>Chave:</b> <code id="pixDiagKey" style="color: #38bdf8;"></code></div>
                        <div><b>Recebedor:</b> <span id="pixDiagMerchant"></span></div>
                        <div><b>Checksum CRC16:</b> <code id="pixDiagCrc" style="color: #f59e0b;"></code> (OK)</div>
                      </div>
                    </div>
                    <div>
                      <small style="color: #94a3b8; display: block; margin-bottom: 4px;">Código Pix Copia e Cola Oficial de Teste:</small>
                      <div style="display: flex; gap: 8px;">
                        <input type="text" id="pixDiagCopyCode" class="form-control form-control-sm" readonly style="font-family: monospace; font-size: 11px;">
                        <button type="button" class="btn btn-sm btn-secondary" onclick="copyPixDiagCode()"><i class="fa-regular fa-copy"></i> Copiar</button>
                      </div>
                    </div>
                  </div>`;

if (html.includes(target)) {
  html = html.replace(target, replacement);
  fs.writeFileSync('src/public/index.html', html, 'utf8');
  console.log('index.html atualizado com sucesso!');
} else {
  console.error('Target não encontrado em index.html');
}

# Iniciar CreativeField & FotoField (Porta 8787)
$Host.UI.RawUI.WindowTitle = "CreativeField 8787 (FotoField & ComfyUI)"
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Magenta
Write-Host "  🎨 CREATIVEFIELD & FOTOFIELD • ESTÚDIO CRIATIVO IA" -ForegroundColor Cyan
Write-Host "  Vencedor do Desafio Open-Source ComfyUI / Higgsfield" -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Magenta
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CreativeFieldDir = Join-Path $ScriptDir "tools\Creativefield"

if (-not (Test-Path "$CreativeFieldDir\package.json")) {
    Write-Host "[ERRO] Pasta do CreativeField não encontrada em: $CreativeFieldDir" -ForegroundColor Red
    Pause
    Exit 1
}

Write-Host "[1/2] Acessando diretório do CreativeField..." -ForegroundColor Gray
Set-Location $CreativeFieldDir

Write-Host "[2/2] Iniciando servidor CreativeField na porta 8787..." -ForegroundColor Green
Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Magenta
Write-Host "  🌐 Acesse no Navegador: http://127.0.0.1:8787/" -ForegroundColor Yellow
Write-Host "  🖼️  FotoField (Editor de Imagens): http://127.0.0.1:8787/#video" -ForegroundColor Cyan
Write-Host "  ⚡ Conexão com ComfyUI: http://127.0.0.1:8188/" -ForegroundColor Green
Write-Host ""
Write-Host "  Mantenha este terminal aberto enquanto utiliza o CreativeField!" -ForegroundColor Gray
Write-Host "=========================================================================" -ForegroundColor Magenta
Write-Host ""

npm start

# PAYBOT - Script de Inicialização de Alta Performance (Nitro V15)
$Host.UI.RawUI.WindowTitle = "PAYBOT NITRO V15 - i7-13620H / NVMe Gen4 / 16GB DDR5"

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "  PAYBOT - MODO DE ALTA PERFORMANCE NITRO V15 (SEM UPGRADES / SEM GARGALOS)   " -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "  Hardware: Intel Core i7-13620H (16 Threads) + NVMe Gen4 + 16GB DDR5" -ForegroundColor Yellow
Write-Host "  [+] UV_THREADPOOL_SIZE: 32 Threads" -ForegroundColor Gray
Write-Host "  [+] Heap V8: 8.192 MB (8GB com GC Exposto)" -ForegroundColor Gray
Write-Host "  [+] Staggered Sub-Bot Boot (Zero Spikes de CPU)" -ForegroundColor Gray
Write-Host "  [+] Bypass de Newsletters/Canais no Baileys (-60% RAM por Sub-Bot)" -ForegroundColor Gray
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host ""

$env:UV_THREADPOOL_SIZE = "32"
$env:NODE_OPTIONS = "--expose-gc --max-old-space-size=8192"

node --expose-gc --max-old-space-size=8192 src/index.js

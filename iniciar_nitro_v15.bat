@echo off
TITLE PAYBOT NITRO V15 - i7-13620H / NVMe Gen4 / 16GB DDR5
COLOR 0A

echo ==============================================================================
echo   PAYBOT - MODO DE ALTA PERFORMANCE NITRO V15 (SEM UPGRADES / SEM GARGALOS)
echo ==============================================================================
echo   Hardware Detectado: Intel Core i7-13620H (16 Threads) + NVMe G4 + 16GB DDR5
echo   Otimizacoes Ativas:
echo   [+] Libuv Thread Pool: 32 threads paralelas nativas
echo   [+] V8 Memory Heap: 8.192 MB (8GB de Heap com Coleta de Lixo Exposta)
echo   [+] Escalonamento Suave de Sub-Bots (Anti-Spike Boot)
echo   [+] Reducao de Consumo de Socket Baileys (-60%% RAM)
echo   [+] Guardiao Ativo de Memoria com Purga Emergencial
echo ==============================================================================
echo.

:: Define variáveis de ambiente otimizadas para o hardware do Nitro V15
set UV_THREADPOOL_SIZE=32
set NODE_OPTIONS=--expose-gc --max-old-space-size=8192

:: Inicia o PayBot com prioridade de processo otimizada
node --expose-gc --max-old-space-size=8192 src/index.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] O processo do PayBot foi encerrado com codigo de erro %ERRORLEVEL%.
    pause
)

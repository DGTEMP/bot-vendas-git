@echo off
chcp 65001 >nul
title CreativeField 8787 (FotoField ^& ComfyUI AI Studio)
cls

echo =========================================================================
echo   🎨 CREATIVEFIELD ^& FOTOFIELD • ESTÚDIO CRIATIVO IA
echo   Vencedor do Desafio Open-Source ComfyUI / Higgsfield
echo =========================================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "CREATIVEFIELD_DIR=%SCRIPT_DIR%tools\Creativefield"

if not exist "%CREATIVEFIELD_DIR%\package.json" (
    echo [ERRO] Pasta do CreativeField não encontrada em:
    echo        %CREATIVEFIELD_DIR%
    echo.
    echo Clone o repositório primeiro com:
    echo git clone https://github.com/rhymeas/Creativefield.git tools\Creativefield
    pause
    exit /b 1
)

echo [1/3] Verificando Node.js...
node -v >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js não encontrado no PATH!
    echo        Instale o Node.js 22 ou mais recente em: https://nodejs.org/
    pause
    exit /b 1
)

echo [2/3] Acessando diretório do CreativeField...
cd /d "%CREATIVEFIELD_DIR%"

if not exist "node_modules\" (
    echo [AVISO] node_modules não encontrado. Executando npm install...
    call npm install
)

echo [3/3] Iniciando CreativeField na porta 8787...
echo.
echo =========================================================================
echo   🌐 Acesse no Navegador: http://127.0.0.1:8787/
echo   🖼️  FotoField (Editor de Imagens): http://127.0.0.1:8787/#video
echo   ⚡ Conexão com ComfyUI: http://127.0.0.1:8188/
echo.
echo   Mantenha esta janela aberta enquanto estiver utilizando o CreativeField!
echo =========================================================================
echo.

call npm start

pause

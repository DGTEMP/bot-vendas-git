@echo off
chcp 65001 >nul
title Super Estúdio Criativo IA (ComfyArt + CreativeField + Bot de Vendas)
cls

echo =========================================================================
echo   🚀 SUPER ESTÚDIO CRIATIVO IA • SUÍTE COMPLETA DE CRIAÇÃO & VENDAS
echo   ComfyArt + CreativeField (FotoField) + Bot de Vendas WhatsApp/Telegram
echo =========================================================================
echo.

set "ROOT_DIR=%~dp0"

echo [1/3] Iniciando CreativeField & FotoField (Porta 8787)...
start "CreativeField 8787" cmd /c "cd /d "%ROOT_DIR%tools\Creativefield" && npm start"

timeout /t 3 /nobreak >nul

echo [2/3] Verificando ComfyUI (Porta 8188)...
echo       Se você possui o ComfyUI Portable, certifique-se de executá-lo
echo       para conexões com workflows do ComfyArt e CreativeField.
echo.

echo [3/3] Iniciando Servidor do Bot de Vendas & Painel Web (Porta 3000)...
echo =========================================================================
echo   Painel Web do Bot:      http://127.0.0.1:3000/
echo   ComfyArt Studio:        http://127.0.0.1:3000/#tab-comfyart
echo   CreativeField & Foto:   http://127.0.0.1:8787/
echo =========================================================================
echo.

cd /d "%ROOT_DIR%"
call npm start

pause

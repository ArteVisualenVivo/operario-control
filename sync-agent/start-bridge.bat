// Arrancador del puente local del agente 3C (solo PC de 3C).
// Escucha SOLO en 127.0.0.1:3033 para que el boton Sincronizar despierte
// al agente AL INSTANTE cuando el navegador esta en esta PC.
// No es un servicio de sincronizacion: solo despierta bajo demanda.
@echo off
cd /d "%~dp0.."
:loop
node "%~dp0bridge.mjs" >> sync-agent\bridge.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
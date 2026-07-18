@echo off
REM operario-control agent startup script
REM EJECUTAR MANUALMENTE SOLO CUANDO SE REQUIERA SINCRONIZAR
REM El agente se inicia automaticamente desde la Web via /api/sync-3c/start-agent

cd /d "C:\Users\Cesar\Desktop\operario-control"
npx tsx sync-agent/agent.ts %1 %2 %3 %4 %5

REM Uso: start-agent.bat <commandId> <module> [autoEnqueued...]
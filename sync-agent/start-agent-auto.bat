@echo off
REM operario-control — agente 3C AUTO-SYNC PROGRAMADO (modo --auto)
REM ---------------------------------------------------------------------------
REM Lo lanza el Programador de tareas de Windows a las 10/12/15/17
REM (ver scripts\install-auto-sync-tasks.ps1).
REM
REM El agente SE DESPIERTA, corre el pipeline de los módulos seleccionados
REM (fuente de verdad: Redis `sync-3c:sync-config`), drena la cola manual y SALE
REM solo: no queda como servicio permanente.
REM
REM Uso manual (prueba):  sync-agent\start-agent-auto.bat
REM ---------------------------------------------------------------------------

cd /d "C:\Users\Cesar\Desktop\operario-control"
npx tsx sync-agent/agent.ts --auto >> "C:\Users\Cesar\Desktop\operario-control\sync-agent\agent-autostart.log" 2>&1
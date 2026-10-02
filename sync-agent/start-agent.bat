@echo off
REM operario-control — agente 3C (pruebas manuales)
REM ---------------------------------------------------------------------------
REM El agente tiene 3 modos:
REM   * ON-DEMAND (por defecto) → click en "Sincronizar" en la web
REM     (POST /api/sync-3c/start-agent). Procesa el pipeline, drena la cola
REM     FIFO y SALE solo.
REM   * --auto → corrida PROGRAMADA. Lo lanza el Programador de tareas de
REM     Windows a las 10/12/15/17 (scripts\install-auto-sync-tasks.ps1).
REM     Ver también sync-agent\start-agent-auto.bat
REM   * --listener → servicio permanente (solo debug manual).
REM
REM Sin argumentos: solo drena la cola pendiente y termina.
REM ---------------------------------------------------------------------------

cd /d "C:\Users\Cesar\Desktop\operario-control"
npx tsx sync-agent/agent.ts %1 %2 %3 %4 %5

REM Uso: start-agent.bat <commandId> <module> [autoEnqueued...]
REM      start-agent.bat --auto    (corrida programada a mano)
REM      start-agent.bat           (drena la cola y sale)
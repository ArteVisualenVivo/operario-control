' start-agent-windows.vbs
' ---------------------------------------------------------------------------
' ⚠️  DESHABILITADO — el agente 3C ya NO se auto-inicia con Windows.
' ---------------------------------------------------------------------------
' El agente se DESPIERTA de dos formas, y en ambas termina solo:
'
'   1) MANUAL — el usuario presiona "Sincronizar" en la web:
'        UI → POST /api/sync-3c/start-agent
'           → npx tsx sync-agent/agent.ts <commandId> <module> [autoEnqueued...]
'
'   2) AUTOMÁTICO (horario programado) — Programador de tareas de Windows a las
'      10/12/15/17 (tarea `operario-control-auto-sync`):
'        wscript sync-agent\start-agent-auto.vbs
'           → npx tsx sync-agent/agent.ts --auto
'        Instalar/actualizar la tarea:
'          powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1
'
' El arranque al INICIAR SESIÓN se eliminó a propósito: la agenda la manda la
' tarea programada (así no queda un servicio permanente corriendo).
'
' Este archivo se conserva sólo como referencia histórica: si se lo vuelve a
' copiar a la carpeta Startup, NO arrancará nada (no-op intencional).
'
' Para una corrida puntual por línea de comandos usá:
'     sync-agent\start-agent.bat <commandId> <module>
'     sync-agent\start-agent-auto.bat          (corrida programada a mano)
' ---------------------------------------------------------------------------
Option Explicit

' No-op: no se lanza ningún proceso. Ver los modos manual y automático arriba.
WScript.Quit 0

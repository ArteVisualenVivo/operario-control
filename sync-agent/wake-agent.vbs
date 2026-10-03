' --------------------------------------------------------------
' Despertador del agente 3C — lanzador OCULTO
'
' Lo invoca el Programador de tareas de Windows cada minuto
' (tarea `operario-control-agent-wake`, ver
' scripts\install-auto-sync-tasks.ps1).
'
' Solo llama al script que mira la cola de Redis: si NO hay comandos
' no arranca nada; si hay, lanza el agente on-demand (que drena la
' cola FIFO y SALE solo: no es un servicio permanente).
' --------------------------------------------------------------
Option Explicit

Dim shell, baseDir, ps1
Set shell = CreateObject("WScript.Shell")

baseDir = "C:\Users\Cesar\Desktop\operario-control"
ps1 = baseDir & "\scripts\wake-agent-if-pending.ps1"

' 0 = ventana oculta; False = no esperar a que termine
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -Quiet", 0, False
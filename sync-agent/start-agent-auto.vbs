' start-agent-auto.vbs
' ---------------------------------------------------------------------------
' Lanza OCULTO el auto-sync programado del agente 3C (modo --auto).
'
' Lo invoca el Programador de tareas de Windows a las 10/12/15/17:
'     scripts\install-auto-sync-tasks.ps1
'
' El agente corre, sincroniza y TERMINA solo (no es un servicio permanente).
' ---------------------------------------------------------------------------
Option Explicit

Dim shell, baseDir, bat
Set shell = CreateObject("WScript.Shell")

baseDir = "C:\Users\Cesar\Desktop\operario-control"
bat = baseDir & "\sync-agent\start-agent-auto.bat"

' 0 = ventana oculta; False = no esperar a que termine
shell.Run """" & bat & """", 0, False
' start-agent-windows.vbs
' Lanza el agente de sincronización 3C de forma OCULTA al iniciar sesión en Windows.
' El agente corre en LISTENER MODE (servicio permanente) conectado a Redis.
' Reedirección de logs a un archivo para diagnóstico.
Option Explicit
Dim shell, fso, baseDir, logDir, logFile, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = "C:\Users\Cesar\Desktop\operario-control"
logDir = baseDir & "\sync-agent"
If fso.FolderExists(logDir) = False Then fso.CreateFolder(logDir)
logFile = logDir & "\agent-autostart.log"

' El agente usa node/tsx; lo lanzamos oculto. Redirijo salida a log.
cmd = "cmd /c cd /d """ & baseDir & """ && npx tsx sync-agent/agent.ts >> """ & logFile & """ 2>&1"

' windowsHide equivalente en VBS: Run con ventana oculta (0)
shell.Run cmd, 0, False

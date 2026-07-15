Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Cesar\Desktop\operario-control"

' --- Verificar si ya hay un agente corriendo (singleton) ---
Set objWMI = GetObject("winmgmts:")
Set colProcesses = objWMI.ExecQuery("Select * from Win32_Process Where Name='node.exe'")
If colProcesses.Count > 0 Then
    WScript.Echo "Agente ya está corriendo. No se inicia una nueva instancia."
    WScript.Quit 0
End If

' Iniciar el agente en segundo plano
WshShell.Run """C:\Program Files\nodejs\node.exe"" node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs >> sync-agent\agent.log 2>&1", 0, False

' Darle un momento al agente para arrancar y luego abrir la web local
WScript.Sleep 2500
WshShell.Run """C:\Program Files\nodejs\node.exe"" node_modules\next\dist\bin\next dev --hostname 127.0.0.1 --port 3000 >> start-local.log 2>&1", 0, False

' Abrir la web
WScript.Sleep 6000
WshShell.Run "http://127.0.0.1:3000", 1, False
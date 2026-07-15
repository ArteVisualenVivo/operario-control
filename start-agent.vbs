Set WshShell = CreateObject("WScript.Shell")
Set WshEnv = WshShell.Environment("PROCESS")

' --- Verificar si ya hay un agente corriendo (singleton) ---
Set objWMI = GetObject("winmgmts:")
Set colProcesses = objWMI.ExecQuery("Select * from Win32_Process Where Name='node.exe'")
If colProcesses.Count > 0 Then
    WScript.Echo "Agente ya está corriendo. No se inicia una nueva instancia."
    WScript.Quit 0
End If

' --- Sincronizar hora para evitar ACCESS_TOKEN_EXPIRED ---
On Error Resume Next
WshShell.Run "C:\Windows\System32\w32tm.exe /resync", 0, True
If Err.Number <> 0 Then
    WshShell.Run "net start w32time", 0, True
    WshShell.Run "C:\Windows\System32\w32tm.exe /resync", 0, True
End If
On Error Goto 0

' --- Lanzar agente oculto ---
WshShell.CurrentDirectory = "C:\Users\Cesar\Desktop\operario-control"
WshShell.Run """C:\Program Files\nodejs\node.exe"" node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs >> sync-agent\agent.log 2>&1", 0, False
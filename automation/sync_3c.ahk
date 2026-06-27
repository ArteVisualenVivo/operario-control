#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================================
; sync_3c.ahk — Operador Automático de 3C v2.0
; Basado en: click por coordenadas (no TABs)
; ============================================================================

; ---------------------------------------------------------------------------
; CONFIG
; ---------------------------------------------------------------------------
configFile := A_ScriptDir "\config.ini"
logDir     := A_ScriptDir "\logs"
statusFile := logDir "\last_status.ini"

windowTitle := IniRead(configFile, "Window", "Title", "3C")

; Leer coordenadas como "X,Y" y convertirlas
coords := Map()
for key in ["Almacenes","Informes","Existencias","Depositos",
            "SeleccionarTodos","Consulta","Aceptar","Excel"] {
    val := IniRead(configFile, "Coords", key, "")
    parts := StrSplit(val, ",")
    coords[key] := [Integer(parts[1]), Integer(parts[2])]
}

; Leer timings
initDelay      := Integer(IniRead(configFile, "Timing", "InitDelay", "1000"))
afterActivate  := Integer(IniRead(configFile, "Timing", "AfterActivate", "1000"))
afterClick     := Integer(IniRead(configFile, "Timing", "AfterClick", "500"))
afterSubmenu   := Integer(IniRead(configFile, "Timing", "AfterSubmenu", "500"))
afterQuery     := Integer(IniRead(configFile, "Timing", "AfterQuery", "300"))
afterAccept    := Integer(IniRead(configFile, "Timing", "AfterAccept", "2000"))
afterExcel     := Integer(IniRead(configFile, "Timing", "AfterExcel", "5000"))
resyncDelay    := Integer(IniRead(configFile, "Timing", "ResyncDelay", "300"))

excelTimeout   := Integer(IniRead(configFile, "Excel", "Timeout", "30"))

loggingEnabled := IniRead(configFile, "Logging", "Enabled", "true") = "true"
maxLogSizeKB   := Integer(IniRead(configFile, "Logging", "MaxSizeKB", "1024"))

; ---------------------------------------------------------------------------
; HOTKEYS DE EMERGENCIA
; ---------------------------------------------------------------------------
F5:: Reload()
Esc:: ExitApp()
^F12:: DumpState()

; ---------------------------------------------------------------------------
; MODO COORDENADAS: absolutas de pantalla (por defecto en AHK v2)
; ---------------------------------------------------------------------------
CoordMode("Mouse", "Screen")

; ============================================================================
; FUNCIONES
; ============================================================================

Log(message) {
    if !loggingEnabled
        return
    if !DirExist(logDir)
        DirCreate(logDir)
    timestamp := FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss")
    logFile   := logDir "\sync_" FormatTime(A_Now, "yyyyMMdd") ".log"
    if (maxLogSizeKB > 0 && FileExist(logFile)) {
        sizeBytes := FileGetSize(logFile)
        if (sizeBytes > maxLogSizeKB * 1024)
            FileMove(logFile, logFile ".bak", 1)
    }
    FileAppend("[" timestamp "] " message "`n", logFile)
}

SaveStatus(status, step := "", duration := "") {
    IniWrite(FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss"), statusFile, "LastRun", "Date")
    IniWrite(status, statusFile, "LastRun", "Status")
    IniWrite(step, statusFile, "LastRun", "Step")
    IniWrite(duration, statusFile, "LastRun", "Duration")
}

DumpState() {
    Log("=== DUMP ===")
    Log("3C activa: " (WinActive(windowTitle) ? "Sí" : "No"))
    if WinExist(windowTitle) {
        WinGetPos(&x, &y, &w, &h, windowTitle)
        Log("Posición: " x "," y " | " w "x" h)
    }
    for k, v in coords
        Log("  " k " → " v[1] "," v[2])
    Log("=== FIN DUMP ===")
}

ValidarFoco() {
    if !WinActive(windowTitle) {
        Log("ERROR: Ventana '" windowTitle "' perdió el foco")
        SaveStatus("fallo", "foco_perdido", "")
        MsgBox("3C perdió el foco. Verificar ventana activa.", "Foco perdido", "Icon!")
        ExitApp()
    }
}

ClickAt(name) {
    c := coords[name]
    if !c {
        Log("ERROR: Coordenada '" name "' no definida")
        throw Error("Coordenada no encontrada: " name)
    }
    Log("Click en " name " (" c[1] "," c[2] ")")
    Click(c[1], c[2])
}

Check3CRunning() {
    if !WinExist(windowTitle) {
        Log("ERROR: '" windowTitle "' no encontrada")
        SaveStatus("fallo", "check_running", "0s")
        MsgBox("Por favor iniciar sesión en 3C antes de ejecutar el bot",
               "3C no detectado", "Icon!")
        ExitApp()
    }
    WinActivate(windowTitle)
    WinWaitActive(windowTitle)
    Log("Ventana '" windowTitle "' detectada y activada")
}

NavigateAndExport() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Abrir Almacenes
    ClickAt("Almacenes")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Abrir Informes
    ClickAt("Informes")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Seleccionar Existencias
    ClickAt("Existencias")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 4 — Elegir Depósitos
    ClickAt("Depositos")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Seleccionar todos
    ClickAt("SeleccionarTodos")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Click en Consulta
    ClickAt("Consulta")
    Sleep(afterQuery)
    ValidarFoco()

    ; 7 — Aceptar
    ClickAt("Aceptar")
    Sleep(afterAccept)
    ValidarFoco()

    ; 8 — Click en Excel
    ClickAt("Excel")
    Sleep(afterExcel)

    Log("Exportación completada. Esperando Excel...")
}

WaitForExcel() {
    Log("Esperando Excel (timeout: " excelTimeout "s)...")
    Loop excelTimeout {
        if WinExist("ahk_class XLMAIN") {
            Log("Excel detectado correctamente")
            return true
        }
        Sleep(1000)
    }
    Log("WARNING: Excel no detectado tras " excelTimeout "s")
    SaveStatus("advertencia", "excel_no_detectado", "")
    MsgBox("Exportación realizada pero no se detectó Excel.", "Excel no detectado", "Icon!")
    return false
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount

Log("=== INICIO ===")

; Pausa inicial para que el usuario suelte el mouse/teclado
Sleep(initDelay)

Check3CRunning()

try {
    NavigateAndExport()
    WaitForExcel()
    dur := Format("{:.1f}s", (A_TickCount - startTime) / 1000)
    Log("[OK] Sync completado en " dur)
    SaveStatus("exito", "completado", dur)
    MsgBox("Exportación completada")
} catch as err {
    dur := Format("{:.1f}s", (A_TickCount - startTime) / 1000)
    Log("ERROR: " err.Message)
    Log("Stack: " err.Stack)
    SaveStatus("fallo", err.Message, dur)
    MsgBox("Error en automatización 3C.`n`n" err.Message "`n`n" .
           "Presionar F5 para reintentar.", "Error de automatización", "Icon!")
}

Log("=== FIN ===")

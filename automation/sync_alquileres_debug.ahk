#Include sync_common.ahk

; ============================================================================
; sync_alquileres_debug.ahk — VERSIÓN DE DEPURACIÓN INSTRUMENTADA
; Módulo ALQUILERES PENDIENTES DE ANDAMIOS
; ============================================================================

; Crear archivo de log de depuración
debugLogFile := A_ScriptDir "\logs\sync_alquileres_debug_" A_YYYY A_MM A_DD ".log"
FileAppend("`n========================================`n", debugLogFile)
FileAppend("INICIO DEPURACIÓN ALQUILERES - " A_YYYY "-" A_MM "-" A_DD " " A_Hour ":" A_Min ":" A_Sec "`n", debugLogFile)
FileAppend("========================================`n", debugLogFile)

; Función para obtener información de la ventana activa
GetWindowInfo() {
    WinGetTitle(&title, "A")
    WinGetClass(&class, "A")
    WinGetProcessName(&process, "A")
    MouseGetPos(&x, &y)
    return "Window=" title " | Class=" class " | Process=" process " | Mouse=" x "," y
}

; Función de logging detallada
DebugLog(step, phase, info) {
    timestamp := A_Hour ":" A_Min ":" A_Sec "." A_MSec
    logEntry := "[" timestamp "] STEP " step " | " phase " | " info "`n"
    FileAppend(logEntry, debugLogFile)
    OutputDebug(logEntry)
}

; Wrapper de ClickAt con logging
ClickAtDebug(name, step) {
    c := coords[name]
    if !c {
        DebugLog(step, "ERROR", "Coordenada '" name "' no definida")
        throw Error("Coordenada no encontrada: " name)
    }
    
    DebugLog(step, "ANTES Click " name, GetWindowInfo())
    Log("Click en " name " (" c[1] "," c[2] ")")
    
    Click(c[1], c[2])
    
    Sleep(100)  ; Pequeña pausa para logging
    DebugLog(step, "DESPUES Click " name, GetWindowInfo())
}

; Wrapper de ValidarFoco con logging
ValidarFocoDebug(step) {
    DebugLog(step, "ANTES ValidarFoco", GetWindowInfo())
    
    if !WinActive(windowTitle) {
        DebugLog(step, "VALIDACION FALLO", "Ventana '" windowTitle "' perdió el foco")
        SaveStatus("fallo", "foco_perdido", "")
        Log("ERROR: Ventana '" windowTitle "' perdió el foco")
        throw Error("Foco perdido")
    }
    
    DebugLog(step, "DESPUES ValidarFoco", "OK - Foco confirmado")
}

; Wrapper de Sleep con logging
SleepDebug(ms, step, reason) {
    DebugLog(step, "SLEEP " ms "ms", reason)
    Sleep(ms)
}

NavigateAlquileres() {
    ; Volver a estado base
    Log("Resync: enviando Ctrl+Home")
    DebugLog("INICIO", "ANTES Resync", GetWindowInfo())
    SendInput("^Home")
    SleepDebug(resyncDelay, "INICIO", "ResyncDelay")
    DebugLog("INICIO", "DESPUES Resync", GetWindowInfo())

    ; 1 — Click Ventas
    DebugLog("1", "ANTES Click Ventas", GetWindowInfo())
    ClickAtDebug("Ventas", "1")
    SleepDebug(afterClick, "1", "AfterClick")
    ValidarFocoDebug("1")
    DebugLog("1", "DESPUES ValidarFoco", GetWindowInfo())

    ; 2 — Click Informes
    DebugLog("2", "ANTES Click Informes", GetWindowInfo())
    ClickAtDebug("Informes", "2")
    SleepDebug(afterSubmenu, "2", "AfterSubmenu")
    ValidarFocoDebug("2")
    DebugLog("2", "DESPUES ValidarFoco", GetWindowInfo())

    ; 3 — Click Remitos
    DebugLog("3", "ANTES Click Remitos", GetWindowInfo())
    ClickAtDebug("Remitos", "3")
    SleepDebug(afterSubmenu, "3", "AfterSubmenu")
    ValidarFocoDebug("3")
    DebugLog("3", "DESPUES ValidarFoco", GetWindowInfo())

    ; 4 — Click Alquileres pendientes
    DebugLog("4", "ANTES Click AlquileresPendientes", GetWindowInfo())
    ClickAtDebug("AlquileresPendientes", "4")
    SleepDebug(afterSubmenu, "4", "AfterSubmenu")
    ValidarFocoDebug("4")
    DebugLog("4", "DESPUES ValidarFoco", GetWindowInfo())

    ; 5 — Click Aceptar
    DebugLog("5", "ANTES Click Aceptar", GetWindowInfo())
    ClickAtDebug("Aceptar", "5")
    SleepDebug(afterAccept, "5", "AfterAccept")
    ValidarFocoDebug("5")
    DebugLog("5", "DESPUES ValidarFoco", GetWindowInfo())

    ; 6 — Seleccionar formato Excel
    DebugLog("6", "ANTES Click ExcelFormat", GetWindowInfo())
    ClickAtDebug("ExcelFormat", "6")
    SleepDebug(afterExcel, "6", "AfterExcel")
    DebugLog("6", "DESPUES Sleep ExcelFormat", GetWindowInfo())

    Log("Exportación de alquileres completada. Esperando Excel...")
    DebugLog("6", "FIN NAVEGACIÓN", "Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO ALQUILERES DEBUG ===")
FileAppend("=== INICIO ALQUILERES DEBUG ===`n", debugLogFile)
DebugLog("MAIN", "INICIO", "Script iniciado")
SleepDebug(initDelay, "MAIN", "InitDelay")

try {
    DebugLog("MAIN", "ANTES FocusFix", GetWindowInfo())
    FocusFix()
    DebugLog("MAIN", "DESPUES FocusFix", GetWindowInfo())
    
    DebugLog("MAIN", "ANTES Check3CRunning", GetWindowInfo())
    Check3CRunning()
    DebugLog("MAIN", "DESPUES Check3CRunning", GetWindowInfo())
    
    DebugLog("MAIN", "ANTES NavigateAlquileres", GetWindowInfo())
    NavigateAlquileres()
    DebugLog("MAIN", "DESPUES NavigateAlquileres", GetWindowInfo())
    
    DebugLog("MAIN", "ANTES WaitForExcel", GetWindowInfo())
    WaitForExcel()
    DebugLog("MAIN", "DESPUES WaitForExcel", GetWindowInfo())
    
    DebugLog("MAIN", "ANTES WatchAndCopy", GetWindowInfo())
    WatchAndCopy()
    DebugLog("MAIN", "DESPUES WatchAndCopy", GetWindowInfo())

    ; Cerrar Excel y volver al menú principal
    DebugLog("MAIN", "ANTES Cerrar Excel", GetWindowInfo())
    if WinExist("ahk_class XLMAIN") {
        WinClose("ahk_class XLMAIN")
        SleepDebug(500, "MAIN", "Espera cierre Excel")
    }
    DebugLog("MAIN", "DESPUES Cerrar Excel", GetWindowInfo())
    
    WinActivate(windowTitle)
    SleepDebug(500, "MAIN", "Espera activación 3C")
    
    DebugLog("MAIN", "ANTES Click Salir", GetWindowInfo())
    ClickAt("Salir")
    SleepDebug(1000, "MAIN", "After Salir")
    DebugLog("MAIN", "DESPUES Click Salir", GetWindowInfo())
    
    Log("[NAV] Main menu restored (Alquileres)")
    FileAppend("=== NAVEGACIÓN COMPLETADA ===`n", debugLogFile)
    DebugLog("MAIN", "FIN", "Navegación completada exitosamente")
} catch as err {
    Log("[ERROR] " err.Message)
    FileAppend("=== ERROR: " err.Message " ===`n", debugLogFile)
    DebugLog("MAIN", "ERROR", err.Message)
    ToolTip("ERROR: " err.Message, 10, 10)
    Sleep(5000)
    ToolTip()
}

Log("=== FIN ALQUILERES DEBUG ===")
FileAppend("=== FIN ALQUILERES DEBUG ===`n", debugLogFile)
DebugLog("MAIN", "FIN SCRIPT", "Script finalizado")
ExitApp
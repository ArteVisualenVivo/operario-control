#Include sync_common.ahk

; ============================================================================
; sync_alquileres.ahk — Módulo ALQUILERES PENDIENTES DE ANDAMIOS
; Navegación: Ventas → Informes → Remitos → Alquileres pendientes →
;             Aceptar → Formato Excel → (esperar Excel) → copiar → cerrar.
; El motor compartido vive en sync_common.ahk.
; ============================================================================

NavigateAlquileres() {
    ; Volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Click Ventas
    ClickAt("VentasAlq")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Informes
    ClickAt("InformesAlq")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Click Remitos
    ; (1800ms: la pantalla de Remitos carga lento; con 500ms el click siguiente
    ;  caía durante la transición y rompía la navegación — verificado con
    ;  _nav_alq_obs.ahk que con 1800ms toda la secuencia funciona)
    ClickAt("Remitos")
    Sleep(1800)
    ValidarFoco()

    ; 4 — Click Alquileres pendientes
    ClickAt("AlquileresPendientes")
    Sleep(1800)
    ValidarFoco()

    ; 5 — Click Aceptar
    ClickAt("AceptarAlq")
    Sleep(2500)
    ValidarFoco()

    ; 6 — Seleccionar formato Excel
    ClickAt("ExcelFormatAlq")
    Sleep(afterExcel)

    ; --- DIAGNÓSTICO: qué ventana quedó activa tras el click de exportación ---
    try {
        actHwnd := WinExist("A")
        if (actHwnd) {
            actTitle := WinGetTitle(actHwnd)
            actClass := WinGetClass(actHwnd)
            Log("[DIAG] Ventana activa tras ExportarExcel: class=" actClass " title=" actTitle)
        }
        ; ¿Apareció algún diálogo (#32770) o ventana de Excel?
        if WinExist("ahk_class #32770")
            Log("[DIAG] Hay un DIÁLOGO abierto (ahk_class #32770): " WinGetTitle("ahk_class #32770"))
        if WinExist("ahk_class XLMAIN")
            Log("[DIAG] Se abrió una ventana de EXCEL (XLMAIN)")
        ; Listado de Temp\tresc en este momento
        tallFiles := 0
        Loop Files "C:\Users\Cesar\AppData\Local\Temp\tresc\*.*"
            tallFiles++
        Log("[DIAG] Archivos en Temp\tresc ahora: " tallFiles)
    }

    Log("Exportación de alquileres completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO ALQUILERES ===")
Sleep(initDelay)

try {
    CaptureTrescBaseline()
    FocusFix()
    Check3CRunning()
    NavigateAlquileres()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("SalirAlq")
    Sleep(1000)
    Log("[NAV] Main menu restored (Alquileres)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN ALQUILERES ===")
ExitApp
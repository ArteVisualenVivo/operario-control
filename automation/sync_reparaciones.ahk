#Include sync_common.ahk

; ============================================================================
; sync_reparaciones.ahk — Módulo ÓRDENES DE REPARACIÓN
; Solo contiene la navegación específica de Reparaciones.
; El motor compartido vive en sync_common.ahk.
; ============================================================================

; ============================================================================
; NAVEGACIÓN REPARACIONES
; ============================================================================

NavigateReparaciones() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Click Ventas (acceso al submenú de reparaciones)
    ClickAt("Ventas")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — DEBUG: verificar posición del mouse antes de click
    MouseMove 448, 346
    Sleep(2000)

    ; 2 — Click Reparaciones
    ClickAt("Reparaciones")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Establecer fecha inicial
    Click(959, 395)
    Sleep(300)
    SendInput("^a")
    Sleep(100)
    SendText("01/01/2025")
    Sleep(300)

    ; 4 — Tildar imprimir todas
    ClickAt("PrintAll")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Click imprimir
    ClickAt("Imprimir")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Seleccionar formato Excel
    ClickAt("ExcelFormat")
    Sleep(afterExcel)

    Log("Exportación de reparaciones completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO REPARACIONES ===")
Sleep(initDelay)

try {
    FocusFix()
    Check3CRunning()
    NavigateReparaciones()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("SalirRep")
    Sleep(1000)
    Log("[NAV] Main menu restored (Reparaciones)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN REPARACIONES ===")
ExitApp

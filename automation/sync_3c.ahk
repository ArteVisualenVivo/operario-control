#Include sync_common.ahk

; ============================================================================
; sync_3c.ahk — Módulo STOCK
; Solo contiene la navegación específica de Stock.
; El motor compartido vive en sync_common.ahk.
; ============================================================================

; ============================================================================
; NAVEGACIÓN STOCK
; ============================================================================

NavigateStock() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Abrir Almacenes
    ClickAt("StockAlmacenes")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Abrir Informes
    ClickAt("StockInformes")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Seleccionar Existencias
    ClickAt("StockExistencias")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 4 — Elegir Depósitos
    ClickAt("StockDepositos")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Seleccionar todos
    ClickAt("StockSeleccionarTodos")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Click en Consulta
    ClickAt("StockConsulta")
    Sleep(afterQuery)
    ValidarFoco()

    ; 7 — Aceptar
    ClickAt("StockAceptar")
    Sleep(afterAccept)
    ValidarFoco()

    ; 8 — Click en Excel
    ClickAt("StockExcel")
    Sleep(afterExcel)

    Log("Exportación completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO STOCK ===")
Sleep(initDelay)

try {
    CaptureTrescBaseline()
    FocusFix()
    Check3CRunning()
    NavigateStock()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("StockSalir")
    Sleep(1000)
    Log("[NAV] Main menu restored")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN STOCK ===")
ExitApp

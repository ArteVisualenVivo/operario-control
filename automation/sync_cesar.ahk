#Include sync_common.ahk

; ============================================================================
; sync_cesar.ahk — Módulo CESAR (órdenes de trabajo de 3C)
; Exporta el informe de órdenes de trabajo con sus ítems (repuestos + mano de obra)
; para liquidación de ganancias por quincena.
; ============================================================================

; ============================================================================
; NAVEGACIÓN CESAR — ÓRDENES DE TRABAJO
; ============================================================================

NavigateCesar() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Click Ventas (acceso al submenú)
    ClickAt("CesarVentas")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Reparaciones
    ClickAt("CesarReparaciones")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Click ExcelItems
    ClickAt("CesarExcelItems")
    Sleep(afterClick)
    ValidarFoco()

    ; 4 — Click PrintAll
    ClickAt("CesarPrintAll")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Click Imprimir
    ClickAt("CesarImprimir")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Click ExcelFormat
    ClickAt("CesarExcelFormat")
    Sleep(afterExcel)

    Log("Exportación de órdenes de trabajo CESAR completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================

startTime := A_TickCount
Log("=== INICIO CESAR ===")
Sleep(initDelay)

try {
    CaptureTrescBaseline()
    FocusFix()
    Check3CRunning()
    NavigateCesar()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("CesarSalir")
    Sleep(1000)
    Log("[NAV] Main menu restored (CESAR)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN CESAR ===")
ExitApp

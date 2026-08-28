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
    ClickAt("RepVentas")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Reparaciones (Quitar la orden)
    ClickAt("RepReparaciones")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Establecer fecha inicial: escribir la fecha completa 01/01/2024
    ; Clic único posiciona el cursor SIN abrir el calendario/popup (el doble clic abría el popup
    ; y bloqueaba los clics siguientes, por eso dejó de exportar el Excel).
    ClickAt("RepFechaIni")
    Sleep(200)
    ; Borrar la fecha anterior completa (DD/MM/YYYY = 10 dígitos + separadores) sin depender de ^a
    SendInput("{End}")
    Sleep(80)
    Loop 12 {
        SendInput("{Backspace}")
        Sleep(20)
    }
    Sleep(100)
    SendText("01/01/2024")
    Sleep(400)

    ; 4 — Actualizar el filtro de fecha
    ClickAt("RepActualizar")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Tildar imprimir todas
    ClickAt("RepPrintAll")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Excel con ítems
    ClickAt("RepExcelItems")
    Sleep(afterClick)
    ValidarFoco()

    ; 7 — Click imprimir
    ClickAt("RepImprimir")
    Sleep(afterClick)
    ValidarFoco()

    ; 8 — Seleccionar formato Excel
    ClickAt("RepExcelFormat")
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
    CaptureTrescBaseline()
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
    ClickAt("RepSalirRep")
    Sleep(1000)
    Log("[NAV] Main menu restored (Reparaciones)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN REPARACIONES ===")
ExitApp

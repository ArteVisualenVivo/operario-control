#Include sync_common.ahk

; ============================================================================
; sync_reparaciones_facturadas.ahk — Módulo REPARACIONES FACTURADAS (2º Excel)
; Exporta el informe de órdenes de reparación FACTURADAS que aporta el ESTADO
; real de cada orden (Taller, Recepción, Retirada, Facturado, etc.).
; Se cruza con el Excel de Reparaciones por número de orden.
; ============================================================================

; ============================================================================
; NAVEGACIÓN REPARACIONES FACTURADAS
; ============================================================================

NavigateReparacionesFacturadas() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Click Ventas (acceso al submenú)
    ClickAt("RepFactVentas")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Informes
    ClickAt("RepFactInformes")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Click Orden de reparación
    ClickAt("RepFactOrdenRep")
    Sleep(afterClick)
    ValidarFoco()

    ; 4 — Click Reparaciones facturadas
    ClickAt("RepFactFacturadas")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Establecer fecha "Desde": escribir 01/01/2025
    ; (mismo patrón que el campo desde de Reparaciones: clic único + End + Backspace + texto)
    ClickAt("RepFactDesde")
    Sleep(200)
    SendInput("{End}")
    Sleep(80)
    Loop 12 {
        SendInput("{Backspace}")
        Sleep(20)
    }
    Sleep(100)
    SendText("01/01/2025")
    Sleep(400)

    ; 6 — Click Orden de reparación (selección)
    ClickAt("RepFactOrdenSeleccion")
    Sleep(afterClick)
    ValidarFoco()

    ; 7 — Click Aceptar
    ClickAt("RepFactAceptar")
    Sleep(afterAccept)
    ValidarFoco()

    ; 8 — Seleccionar formato Excel
    ClickAt("RepFactExcelFormat")
    Sleep(afterExcel)

    Log("Exportación de reparaciones facturadas completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO REPARACIONES FACTURADAS ===")
Sleep(initDelay)

try {
    CaptureTrescBaseline()
    FocusFix()
    Check3CRunning()
    NavigateReparacionesFacturadas()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("RepFactSalir")
    Sleep(1000)
    Log("[NAV] Main menu restored (Reparaciones Facturadas)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN REPARACIONES FACTURADAS ===")
ExitApp
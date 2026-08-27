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

    ; 2 — Click Reparaciones (Quitar la orden)
    ClickAt("Reparaciones")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Establecer fecha inicial: cambiar SOLO el dígito del año (2026 → 2024)
    ; Clic único posiciona el cursor SIN abrir el calendario/popup (el doble clic abría el popup
    ; y bloqueaba los clics siguientes, por eso dejó de exportar el Excel).
    ClickAt("FechaIni")
    Sleep(200)
    SendInput("{End}")          ; llevar cursor al final del campo (año)
    Sleep(100)
    SendInput("{Backspace}")    ; borrar el dígito final (6 de ...2026)
    Sleep(100)
    SendText("4")               ; escribir el 4 → 01/01/2024
    Sleep(300)

    ; 4 — Actualizar el filtro de fecha
    ClickAt("Actualizar")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Tildar imprimir todas
    ClickAt("PrintAll")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Excel con ítems
    ClickAt("ExcelItems")
    Sleep(afterClick)
    ValidarFoco()

    ; 7 — Click imprimir
    ClickAt("Imprimir")
    Sleep(afterClick)
    ValidarFoco()

    ; 8 — Seleccionar formato Excel
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

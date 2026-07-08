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
    ClickAt("Ventas")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Informes
    ClickAt("Informes")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Click Remitos
    ClickAt("Remitos")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 4 — Click Alquileres pendientes
    ClickAt("AlquileresPendientes")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 5 — Click Aceptar
    ClickAt("Aceptar")
    Sleep(afterAccept)
    ValidarFoco()

    ; 6 — Seleccionar formato Excel
    ClickAt("ExcelFormat")
    Sleep(afterExcel)

    Log("Exportación de alquileres completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO ALQUILERES ===")
Sleep(initDelay)

try {
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
    ClickAt("Salir")
    Sleep(1000)
    Log("[NAV] Main menu restored (Alquileres)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN ALQUILERES ===")
ExitApp
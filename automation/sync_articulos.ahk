#Include sync_common.ahk

; ============================================================================
; sync_articulos.ahk — Módulo ARTÍCULOS
; Solo contiene la navegación específica de Artículos.
; El motor compartido vive en sync_common.ahk.
; ============================================================================

; ============================================================================
; NAVEGACIÓN ARTÍCULOS
; ============================================================================

NavigateArticulos() {
    ; Resync — intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 — Click Servicios
    ClickAt("ServiciosArt")
    Sleep(afterClick)
    ValidarFoco()

    ; 2 — Click Artículos (menú)
    ClickAt("ArticulosMenu")
    Sleep(afterSubmenu)
    ValidarFoco()

    ; 3 — Click Artículos (lista)
    ClickAt("ArticulosLista")
    Sleep(afterClick)
    ValidarFoco()

    ; 4 — Click Imprimir
    ClickAt("ImprimirArt")
    Sleep(afterClick)
    ValidarFoco()

    ; 5 — Click Generar
    ClickAt("Generar")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 — Click Formato Excel
    ClickAt("ExcelArt")
    Sleep(afterExcel)

    Log("Exportación de artículos completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO ARTÍCULOS ===")
Sleep(initDelay)

try {
    FocusFix()
    Check3CRunning()
    NavigateArticulos()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menú principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ClickAt("SalirArt")
    Sleep(300)
    ClickAt("SalirArt2")
    Sleep(1000)
    Log("[NAV] Main menu restored (Artículos)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN ARTÍCULOS ===")
ExitApp

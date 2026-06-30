#Include sync_common.ahk

; ============================================================================
; sync_articulos.ahk - Modulo ARTICULOS
; Solo contiene la navegacion especifica de Articulos.
; El motor compartido vive en sync_common.ahk.
; ============================================================================

; ============================================================================
; NAVEGACION ARTICULOS
; ============================================================================

NavigateArticulos() {
    ; - Timings locales especificos para Articulos -
    ; (no afectan a globales afterClick/afterSubmenu/afterExcel)
    local_afterServiciosArt  := 1000
    local_afterArticulosMenu := 1000
    local_afterArticulosLista := 600
    local_afterImprimirArt   := 2000

    ; Resync - intentar volver a estado base
    Log("Resync: enviando Ctrl+Home")
    SendInput("^Home")
    Sleep(resyncDelay)

    ; 1 - Servicios
    ClickAt("ServiciosArt")
    Sleep(local_afterServiciosArt)
    ValidarFoco()

    ; 2 - Articulos (menu)
    ClickAt("ArticulosMenu")
    Sleep(local_afterArticulosMenu)
    ValidarFoco()

    ; 3 - Articulos (segunda opcion)
    ClickAt("ArticulosLista")
    Sleep(local_afterArticulosLista)
    ValidarFoco()

    ; 4 - Imprimir
    ClickAt("ImprimirArt")
    Sleep(local_afterImprimirArt)
    ValidarFoco()

    ; 5 - Generar
    ClickAt("Generar")
    Sleep(afterClick)
    ValidarFoco()

    ; 6 - Formato Excel
    ClickAt("ExcelArt")
    Sleep(afterExcel)

    Log("Exportacion de articulos completada. Esperando Excel...")
}

; ============================================================================
; MAIN
; ============================================================================
startTime := A_TickCount
Log("=== INICIO ARTICULOS ===")
Sleep(initDelay)

try {
    FocusFix()
    Check3CRunning()
    NavigateArticulos()
    WaitForExcel()
    WatchAndCopy()

    ; Cerrar Excel y volver al menu principal
    if WinExist("ahk_class XLMAIN")
        WinClose("ahk_class XLMAIN")
    Sleep(500)
    WinActivate(windowTitle)
    Sleep(500)
    ; 7 - Salir de la pantalla de impresion
    ClickAt("SalirArt2")
    Sleep(300)
    ; 8 - Salir de Articulos
    ClickAt("SalirArt")
    Sleep(1000)
    Log("[NAV] Main menu restored (Articulos)")
} catch as err {
    Log("[ERROR] " err.Message)
}

Log("=== FIN ARTICULOS ===")
ExitApp

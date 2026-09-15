; DIAGNOSTICO ALQUILERES — navega y SE DETIENE tras Aceptar
; Deja 3C en la pantalla real para inspeccion visual.
; Muestra un tooltip con la posicion del mouse en todo momento.
#Requires AutoHotkey v2.0
#SingleInstance Force
#Include sync_common.ahk

Log("=== DIAG ALQ: inicio (se detiene tras Aceptar) ===")
if !WinExist(windowTitle) {
    Log("DIAG: ventana 3C no encontrada")
    MsgBox("No se encontro la ventana 3C")
    ExitApp()
}
WinActivate(windowTitle)
WinWaitActive(windowTitle)
Send("{Ctrl down}{Home}{Ctrl up}")
Sleep(1500)

ClickAt("VentasAlq")
Sleep(1500)
ClickAt("InformesAlq")
Sleep(1800)
ClickAt("Remitos")
Sleep(1800)
ClickAt("AlquileresPendientes")
Sleep(1800)
ClickAt("AceptarAlq")
Sleep(4000)

Log("=== DIAG ALQ: DETENIDO. Mirando pantalla... ===")
; Bucle de 60s mostrando la posicion del mouse para que el usuario la lea
endTime := A_TickCount + 60000
while (A_TickCount < endTime) {
    MouseGetPos(&mx, &my)
    ToolTip("POSICION MOUSE -> X=" mx "  Y=" my "`n(60s) Anota la posicion sobre 'Exportar Excel'", mx + 20, my + 20)
    Sleep(200)
}
ToolTip()
Log("=== DIAG ALQ: fin ===")

#Requires AutoHotkey v2.0
#ErrorStdOut
#SingleInstance Force
#Include sync_common.ahk

; NAVEGACION TEMPORAL DE OBSERVACION - deja la pantalla en Alquileres pendientes
Log("=== NAV ALQ OBS START ===")
Check3CRunning()
SendInput("^Home")
Sleep(resyncDelay)

ClickAt("Ventas")
Sleep(afterClick)
ValidarFoco()
Log("1 Ventas ok")

ClickAt("Informes")
Sleep(afterSubmenu)
ValidarFoco()
Log("2 Informes ok")

ClickAt("Remitos")
Sleep(1800)
ValidarFoco()
Log("3 Remitos ok")

ClickAt("AlquileresPendientes")
Sleep(1800)
ValidarFoco()
Log("4 AlquileresPendientes ok")

ClickAt("Aceptar")
Sleep(2500)
Log("5 Aceptar ok - izquierda abierta")

WinActivate(windowTitle)
ExitApp()
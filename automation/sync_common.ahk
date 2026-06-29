#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon

; ============================================================================
; sync_common.ahk — Motor compartido para todos los módulos de sincronización 3C
; Incluir en cada módulo con: #Include sync_common.ahk
; ============================================================================

; ---------------------------------------------------------------------------
; CONFIG
; ---------------------------------------------------------------------------
configFile := A_ScriptDir "\config.ini"
logDir     := A_ScriptDir "\logs"
statusFile := logDir "\last_status.ini"

windowTitle := IniRead(configFile, "Window", "Title", "3C")

; Leer coordenadas como "X,Y" y convertirlas
coords := Map()
for key in ["Almacenes","Informes","Existencias","Depositos",
            "SeleccionarTodos","Consulta","Aceptar","Excel","Salir",
            "Ventas","Reparaciones","ExcelItems","PrintAll","Imprimir","ExcelFormat","SalirRep",
            "ServiciosArt","ArticulosMenu","ArticulosLista","ImprimirArt","Generar","ExcelArt","SalirArt","SalirArt2"] {
    val := IniRead(configFile, "Coords", key, "")
    parts := StrSplit(val, ",")
    coords[key] := [Integer(parts[1]), Integer(parts[2])]
}

; Leer timings
initDelay      := Integer(IniRead(configFile, "Timing", "InitDelay", "1000"))
afterActivate  := Integer(IniRead(configFile, "Timing", "AfterActivate", "1000"))
afterClick     := Integer(IniRead(configFile, "Timing", "AfterClick", "500"))
afterSubmenu   := Integer(IniRead(configFile, "Timing", "AfterSubmenu", "500"))
afterQuery     := Integer(IniRead(configFile, "Timing", "AfterQuery", "300"))
afterAccept    := Integer(IniRead(configFile, "Timing", "AfterAccept", "2000"))
afterExcel     := Integer(IniRead(configFile, "Timing", "AfterExcel", "5000"))
resyncDelay    := Integer(IniRead(configFile, "Timing", "ResyncDelay", "300"))

excelTimeout   := Integer(IniRead(configFile, "Excel", "Timeout", "30"))

loggingEnabled := IniRead(configFile, "Logging", "Enabled", "true") = "true"
maxLogSizeKB   := Integer(IniRead(configFile, "Logging", "MaxSizeKB", "1024"))

; ---------------------------------------------------------------------------
; HOTKEYS DE EMERGENCIA
; ---------------------------------------------------------------------------
F5:: Reload()
Esc:: ExitApp()
^F12:: DumpState()

; ---------------------------------------------------------------------------
; MODO COORDENADAS: absolutas de pantalla (por defecto en AHK v2)
; ---------------------------------------------------------------------------
CoordMode("Mouse", "Screen")

; ============================================================================
; FUNCIONES COMPARTIDAS
; ============================================================================

Log(message) {
    if !loggingEnabled
        return
    if !DirExist(logDir)
        DirCreate(logDir)
    timestamp := FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss")
    logFile   := logDir "\sync_" FormatTime(A_Now, "yyyyMMdd") ".log"
    if (maxLogSizeKB > 0 && FileExist(logFile)) {
        sizeBytes := FileGetSize(logFile)
        if (sizeBytes > maxLogSizeKB * 1024)
            FileMove(logFile, logFile ".bak", 1)
    }
    FileAppend("[" timestamp "] " message "`n", logFile)
}

SaveStatus(status, step := "", duration := "") {
    IniWrite(FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss"), statusFile, "LastRun", "Date")
    IniWrite(status, statusFile, "LastRun", "Status")
    IniWrite(step, statusFile, "LastRun", "Step")
    IniWrite(duration, statusFile, "LastRun", "Duration")
}

DumpState() {
    Log("=== DUMP ===")
    Log("3C activa: " (WinActive(windowTitle) ? "Sí" : "No"))
    if WinExist(windowTitle) {
        WinGetPos(&x, &y, &w, &h, windowTitle)
        Log("Posición: " x "," y " | " w "x" h)
    }
    for k, v in coords
        Log("  " k " → " v[1] "," v[2])
    Log("=== FIN DUMP ===")
}

ValidarFoco() {
    if !WinActive(windowTitle) {
        Log("ERROR: Ventana '" windowTitle "' perdió el foco")
        SaveStatus("fallo", "foco_perdido", "")
        ExitApp()
    }
}

ClickAt(name) {
    c := coords[name]
    if !c {
        Log("ERROR: Coordenada '" name "' no definida")
        throw Error("Coordenada no encontrada: " name)
    }
    Log("Click en " name " (" c[1] "," c[2] ")")
    Click(c[1], c[2])
}

Check3CRunning() {
    if !WinExist(windowTitle) {
        Log("ERROR: '" windowTitle "' no encontrada")
        SaveStatus("fallo", "check_running", "0s")
        ExitApp()
    }
    WinActivate(windowTitle)
    WinWaitActive(windowTitle)
    Log("Ventana '" windowTitle "' detectada y activada")
}

FocusFix() {
    if WinExist("ahk_exe chrome.exe")
        WinMinimize("ahk_exe chrome.exe")
    if WinExist("ahk_exe msedge.exe")
        WinMinimize("ahk_exe msedge.exe")
}

WaitForExcel() {
    Log("Esperando Excel (timeout: " excelTimeout "s)...")
    Loop excelTimeout {
        if WinExist("ahk_class XLMAIN") {
            Log("Excel detectado correctamente")
            return true
        }
        Sleep(1000)
    }
    Log("WARNING: Excel no detectado tras " excelTimeout "s")
    SaveStatus("advertencia", "excel_no_detectado", "")
    return false
}

WatchAndCopy() {
    downloadDir := EnvGet("LOCALAPPDATA") "\Temp\tresc"
    exportsDir := A_ScriptDir "\..\automation-watcher\3c_exports"

    Log("[WATCHER] Directorio fijo 3C: " downloadDir)

    if !DirExist(downloadDir) {
        Log("[WATCHER ERROR] No existe carpeta tresc en Temp")
        return ""
    }

    if !DirExist(exportsDir)
        DirCreate(exportsDir)

    Loop 60 {
        Sleep(1000)

        Loop Files downloadDir "\tresc*.xls" {
            Log("[WATCHER] ARCHIVO DETECTADO:")
            Log("[WATCHER] Ruta: " A_LoopFileFullPath)
            Log("[WATCHER] Fecha: " A_LoopFileTimeModified)
            Log("[WATCHER] Tamaño: " A_LoopFileSizeKB " KB")

            targetFile := exportsDir "\" A_LoopFileName
            if FileCopy(A_LoopFileFullPath, targetFile, 1) {
                Log("[OK] Archivo copiado a exports: " targetFile)
                try {
                    FileDelete(A_LoopFileFullPath)
                    Log("[OK] Archivo original eliminado: " A_LoopFileFullPath)
                } catch {
                    Log("[WARN] No se pudo eliminar el original: " A_LoopFileFullPath)
                }
            } else {
                Log("[ERROR] No se pudo copiar el archivo a exports")
            }

            return A_LoopFileName
        }
    }

    Log("[WATCHER] TIMEOUT � no se detectaron archivos tresc*.xls en Temp	resc")
    return ""
}


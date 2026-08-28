#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon

; ============================================================================
; sync_common.ahk - Motor compartido para todos los modulos de sincronizacion 3C
; Incluir en cada modulo con: #Include sync_common.ahk
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
for key in ["StockAlmacenes","StockInformes","StockExistencias","StockDepositos",
            "StockSeleccionarTodos","StockConsulta","StockAceptar","StockExcel","StockSalir",
            "RepVentas","RepReparaciones","RepExcelItems","RepPrintAll","RepImprimir","RepExcelFormat","RepSalirRep",
            "RepFechaIni","RepActualizar",
            "Remitos","AlquileresPendientes","VentasAlq","InformesAlq","AceptarAlq","ExcelFormatAlq","SalirAlq",
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
    Log("3C activa: " (WinActive(windowTitle) ? "Si" : "No"))
    if WinExist(windowTitle) {
        WinGetPos(&x, &y, &w, &h, windowTitle)
        Log("Posicion: " x "," y " | " w "x" h)
    }
    for k, v in coords
        Log("  " k " -> " v[1] "," v[2])
    Log("=== FIN DUMP ===")
}

ValidarFoco() {
    if !WinActive(windowTitle) {
        Log("ERROR: Ventana '" windowTitle "' perdio el foco")
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
; ============================================================================
; PROTOCOLO AHK -> AGENTE: manifiesto de ejecucion
; El agente lee _last_export.json (en 3c_exports) para procesar EXACTAMENTE
; el Excel generado por ESTA ejecucion (commandId + modulo), nunca uno viejo.
; ============================================================================
EscapeJson(str) {
    ; Escapado JSON robusto usando codigos ASCII (evita problemas de quoting en AHK v2)
    BS := Chr(92)   ; backslash
    Q  := Chr(34)   ; comilla doble
    s := StrReplace(str, BS, BS BS)      ; \ -> \\
    s := StrReplace(s, Q, BS Q)          ; " -> \"
    s := StrReplace(s, "`n", BS "n")
    s := StrReplace(s, "`r", BS "r")
    s := StrReplace(s, "`t", BS "t")
    return s
}

WriteExportManifest(fileName, status, err, module, commandId, exportsDir, destPath := "") {
    size := 0
    if (destPath != "" and FileExist(destPath))
        size := FileGetSize(destPath)
    q := Chr(34)
    json := "{" . q . "commandId" . q . ":" . q . EscapeJson(commandId) . q
    json .= "," . q . "module" . q . ":" . q . EscapeJson(module) . q
    json .= "," . q . "status" . q . ":" . q . EscapeJson(status) . q
    json .= "," . q . "error" . q . ":" . q . EscapeJson(err) . q
    json .= "," . q . "fileName" . q . ":" . q . EscapeJson(fileName) . q
    json .= "," . q . "destPath" . q . ":" . q . EscapeJson(destPath) . q
    json .= "," . q . "size" . q . ":" . size
    json .= "," . q . "writtenAt" . q . ":" . q . FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss") . q
    json .= "}"
    manifest := exportsDir "\_last_export.json"
    try
        FileDelete(manifest)
    FileAppend(json, manifest, "UTF-8-RAW")
    Log("[WATCHER] Manifiesto escrito (" status "): " manifest)
}

; Snapshot de los archivos tresc que ya existian ANTES de navegar.
CaptureTrescBaseline() {
    global trescBaseline
    downloadDir := EnvGet("LOCALAPPDATA") "\Temp\tresc"
    trescBaseline := Map()
    if !DirExist(downloadDir)
        return
    Loop Files downloadDir "\tresc*.xls" {
        trescBaseline[A_LoopFileName] := FileGetTime(A_LoopFileFullPath, "M")
    }
    Log("[WATCHER] Baseline Temp\tresc (antes de navegar): " trescBaseline.Count " archivo(s)")
}
WatchAndCopy() {
    global trescBaseline
    if !IsSet(trescBaseline)
        trescBaseline := Map()
    downloadDir := EnvGet("LOCALAPPDATA") "\Temp\tresc"
    exportsDir := A_ScriptDir "\..\automation-watcher\3c_exports"

    ; Identidad de la ejecucion - el agente la pasa como argumentos
    commandId := ""
    module := ""
    if A_Args.Length >= 1
        commandId := A_Args[1]
    if A_Args.Length >= 2
        module := A_Args[2]

    Log("[WATCHER] Directorio: " downloadDir "  [commandId=" commandId " module=" module "]")

    if !DirExist(downloadDir) {
        Log("[WATCHER ERROR] No existe carpeta tresc en Temp")
        WriteExportManifest("", "EXPORT_NOT_FOUND", "No existe carpeta tresc en Temp", module, commandId, exportsDir)
        return ""
    }

    if !DirExist(exportsDir)
        DirCreate(exportsDir)

    ; --- Seleccionar SOLO el archivo NUEVO de esta ejecucion ---
    selected     := ""
    selectedPath := ""
    bestTime     := ""
    deadline     := A_TickCount + 60000   ; hasta 60s esperando el archivo nuevo
    while (A_TickCount < deadline) {
        bestFile := ""
        bestPath := ""
        bestT    := ""
        Loop Files downloadDir "\tresc*.xls" {
            thisTime := FileGetTime(A_LoopFileFullPath, "M")
            isNew := false
            if !trescBaseline.Has(A_LoopFileName) {
                isNew := true
            } else if (trescBaseline[A_LoopFileName] != thisTime) {
                isNew := true          ; mismo nombre pero reescrito (mtime cambio)
            }
            if !isNew
                continue
            if (bestFile = "" or thisTime > bestT) {
                bestFile := A_LoopFileName
                bestPath := A_LoopFileFullPath
                bestT    := thisTime
            }
        }
        if (bestFile != "") {
            selected     := bestFile
            selectedPath := bestPath
            bestTime     := bestT
            break
        }
        Sleep(1000)
    }

    if (selected = "") {
        Log("[WATCHER TIMEOUT] No se detecto un archivo NUEVO en " downloadDir " tras 60s (baseline=" trescBaseline.Count ")")
        WriteExportManifest("", "EXPORT_NOT_FOUND", "No se detecto archivo nuevo tras 60s", module, commandId, exportsDir)
        return ""
    }
    Log("[WATCHER] Archivo NUEVO detectado: " selectedPath " (mtime " bestTime ")")

    ; --- Confirmar fin de escritura: tamano estable (2 lecturas iguales > 0) ---
    stableSize  := -1
    stableCount := 0
    Loop 25 {
        curSize := FileGetSize(selectedPath)
        if (curSize = stableSize and curSize > 0)
            stableCount++
        else {
            stableCount := 0
            stableSize  := curSize
        }
        if (stableCount >= 2)
            break
        Sleep(800)
    }
    if (stableCount < 2) {
        Log("[WATCHER ERROR] Tamano inestable - Excel todavia escribiendo: " selectedPath " (last size=" stableSize ")")
        WriteExportManifest("", "EXPORT_STILL_WRITING", "Tamano inestable (Excel aun escribiendo)", module, commandId, exportsDir)
        return ""
    }
    Log("[WATCHER] Tamano estable: " stableSize " bytes")

    ; --- Copiar con reintentos robustos y verificar la copia ---
    targetFile := exportsDir "\" selected
    copied     := false
    Loop 25 {
        try {
            FileCopy(selectedPath, targetFile, 1)
        } catch {
            copied := false
        }
        if (FileExist(targetFile) and FileGetSize(targetFile) > 0 and FileGetSize(targetFile) = FileGetSize(selectedPath)) {
            copied := true
            break
        }
        Sleep(1500)
    }
    if !copied {
        Log("[WATCHER ERROR] No se pudo copiar a exports tras reintentos: " selectedPath)
        WriteExportManifest("", "EXPORT_COPY_FAILED", "No se pudo copiar a 3c_exports", module, commandId, exportsDir)
        return ""
    }
    Log("[OK] Copiado y verificado en exports: " targetFile " (" FileGetSize(targetFile) " bytes)")

    ; --- Recien ahora, con la copia verificada, borrar el original ---
    try {
        FileDelete(selectedPath)
        Log("[OK] Original eliminado tras verificar copia: " selectedPath)
    } catch {
        Log("[WARN] No se pudo eliminar el original (se deja, no afecta): " selectedPath)
    }

    ; --- Informar al agente que archivo procesar ---
    WriteExportManifest(selected, "OK", "", module, commandId, exportsDir, targetFile)
    return selected
}
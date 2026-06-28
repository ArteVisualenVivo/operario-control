#Requires AutoHotkey v2.0
#SingleInstance Force

logFile := A_ScriptDir "\com_diagnostic.log"
ts := FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss")

FileAppend("[" ts "] Iniciando test COM...`n", logFile)

try {
    xl := ComObjActive("Excel.Application")
    FileAppend("[" ts "] [OK] ComObjActive conectado`n", logFile)
    FileAppend("[" ts "] Excel Version: " xl.Version "`n", logFile)
    FileAppend("[" ts "] Workbook count: " xl.Workbooks.Count "`n", logFile)

    if xl.Workbooks.Count > 0 {
        wb := xl.ActiveWorkbook
        FileAppend("[" ts "] ActiveWorkbook: " wb.Name "`n", logFile)
        if wb.FullName
            FileAppend("[" ts "] Path: " wb.FullName "`n", logFile)
        else
            FileAppend("[" ts "] Path: (unsaved)`n", logFile)
        FileAppend("[" ts "] Saved: " wb.Saved "`n", logFile)
        FileAppend("[" ts "] ReadOnly: " wb.ReadOnly "`n", logFile)
    }
} catch as err {
    FileAppend("[" ts "] [ERROR] Message: " err.Message "`n", logFile)
    FileAppend("[" ts "] [ERROR] What: " err.What "`n", logFile)
    FileAppend("[" ts "] [ERROR] Extra: " err.Extra "`n", logFile)
    FileAppend("[" ts "] [ERROR] Stack: " err.Stack "`n", logFile)
}

FileAppend("[" ts "] Test finalizado.`n", logFile)
MsgBox("Test COM completado. Revisar:`n" logFile)

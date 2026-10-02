<#
.SYNOPSIS
    Registra el auto-sync programado del agente 3C (modo --auto) en el
    Programador de tareas de Windows.

.DESCRIPTION
    El agente NO corre como servicio permanente: esta tarea lo DESPIERTA a cada
    hora programada (por defecto 10:00, 12:00, 15:00 y 17:00, hora local). El
    agente sincroniza los módulos seleccionados (fuente de verdad: Redis
    `sync-3c:sync-config`), drena la cola manual y TERMINA solo.

    La tarea:
      * StartWhenAvailable -> si la PC estaba apagada a la hora programada, corre
        apenas se encienda.
      * WakeToRun         -> despierta la PC si estaba en suspensión.
      * IgnoreNew         -> si la corrida anterior sigue viva, no apila otra.

    Es idempotente: volver a ejecutarlo ACTUALIZA la tarea existente.
    OJO: la ventana de tolerancia de 5 min NO aplica al modo --auto (el reloj lo
    decide el Programador de tareas, no el agente).

.PARAMETER TaskName
    Nombre de la tarea. Por defecto "operario-control-auto-sync".

.PARAMETER Hours
    Horas (0-23) de las corridas diarias. Por defecto 10, 12, 15, 17.

.PARAMETER ProjectRoot
    Raíz del proyecto. Por defecto C:\Users\Cesar\Desktop\operario-control.

.PARAMETER Uninstall
    Elimina la tarea en vez de instalarla.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1 -Hours 8,13,18

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string] $TaskName    = "operario-control-auto-sync",
    [int[]]  $Hours       = @(10, 12, 15, 17),
    [string] $ProjectRoot = "C:\Users\Cesar\Desktop\operario-control",
    [switch] $Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Yellow
    } else {
        Write-Host "La tarea '$TaskName' no existe (nada que hacer)." -ForegroundColor DarkGray
    }
    exit 0
}

$vbs = Join-Path $ProjectRoot "sync-agent\start-agent-auto.vbs"
if (-not (Test-Path $vbs)) { throw "No existe el lanzador: $vbs" }

$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"

$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"" -WorkingDirectory $ProjectRoot

$validHours = $Hours | Sort-Object -Unique
foreach ($h in $validHours) {
    if ($h -lt 0 -or $h -gt 23) { throw "Hora invalida: $h (debe ser 0-23)" }
}
$triggers = @($validHours | ForEach-Object {
    New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour $_ -Minute 0 -Second 0)
})

$baseSettings = @{
    StartWhenAvailable          = $true
    AllowStartIfOnBatteries     = $true
    DontStopIfGoingOnBatteries  = $true
    MultipleInstances           = "IgnoreNew"
    ExecutionTimeLimit          = (New-TimeSpan -Hours 2)
}

$userId    = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

try {
    $settings = New-ScheduledTaskSettingsSet @baseSettings -WakeToRun
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
        -Settings $settings -Principal $principal -Force | Out-Null
} catch {
    Write-Warning "No se pudo registrar con 'WakeToRun' ($($_.Exception.Message)). Se reintenta sin despertar la PC."
    $settings = New-ScheduledTaskSettingsSet @baseSettings
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
        -Settings $settings -Principal $principal -Force | Out-Null
}

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host "OK - tarea '$($task.TaskName)' registrada." -ForegroundColor Green
Write-Host ("  Estado    : {0}" -f $task.State)
Write-Host ("  Horario   : {0}" -f (($validHours) -join ", "))
Write-Host ("  Lanzador  : {0}" -f $vbs)
Write-Host ("  Usuario   : {0} (corre solo con la sesion iniciada)" -f $userId)
Write-Host ""
Write-Host "Proximas ejecuciones:" -ForegroundColor Cyan
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object NextRunTime, LastRunTime, LastTaskResult | Format-List
Write-Host "Para probarla ya mismo (sin esperar la hora):" -ForegroundColor Cyan
Write-Host ("  Start-ScheduledTask -TaskName {0}" -f $TaskName)
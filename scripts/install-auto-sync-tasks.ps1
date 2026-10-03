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

.PARAMETER WakeIntervalMinutes
    Cada cuantos minutos corre el DESPERTADOR (`operario-control-agent-wake`).
    Por defecto 1 minuto: el minimo que permite el Programador de tareas.
    El despertador mira la cola de Redis (`sync-3c:queue`) y solo arranca el
    agente si hay comandos pendientes: asi el boton "Sincronizar" de la web
    (aunque la web corra en Vercel) llega a la PC en menos de 1 minuto.

.PARAMETER NoWaker
    No instala el despertador (solo la tarea de auto-sync programado).
    Sin despertador, un click en la web REMOTA queda en cola hasta la proxima
    corrida programada (el `spawn` de la web solo funciona en la PC de 3C).

.PARAMETER WakeTaskName
    Nombre de la tarea del despertador. Por defecto "operario-control-agent-wake".

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1 -Hours 8,13,18

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1 -WakeIntervalMinutes 2

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install-auto-sync-tasks.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string] $TaskName    = "operario-control-auto-sync",
    [int[]]  $Hours       = @(10, 12, 15, 17),
    [string] $ProjectRoot = "C:\Users\Cesar\Desktop\operario-control",
    [int]    $WakeIntervalMinutes = 1,
    [string] $WakeTaskName = "operario-control-agent-wake",
    [string] $BridgeTaskName = "operario-control-agent-bridge",
    [switch] $NoWaker,
    [switch] $Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
    foreach ($name in @($TaskName, $WakeTaskName, $BridgeTaskName)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Tarea '$name' eliminada." -ForegroundColor Yellow
        } else {
            Write-Host "La tarea '$name' no existe (nada que hacer)." -ForegroundColor DarkGray
        }
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

# ---------------------------------------------------------------------------
# PUENTE LOCAL (operario-control-agent-bridge)
# ---------------------------------------------------------------------------
# La web de Vercel NO puede hacer spawn en la PC: el click queda en cola y el
# despertador tarda hasta 1 min. Este puente escucha SOLO en 127.0.0.1:3033 y
# despierta al agente AL INSTANTE cuando el navegador esta en la PC de 3C.
# Corre al iniciar sesion (el 3C necesita escritorio) y se auto-reinicia si
# se cae. Solo despierta si hay trabajo real en Redis: no sincroniza solo.
# ---------------------------------------------------------------------------
$bridgeVbs = Join-Path $ProjectRoot "sync-agent\start-bridge.vbs"
if (-not (Test-Path $bridgeVbs)) { throw "No existe el lanzador del puente: $bridgeVbs" }

$bridgeAction = New-ScheduledTaskAction -Execute $wscript -Argument "`"$bridgeVbs`"" -WorkingDirectory $ProjectRoot
$bridgeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$bridgeSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 3) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $BridgeTaskName -Action $bridgeAction -Trigger $bridgeTrigger `
    -Settings $bridgeSettings -Principal $principal -Force | Out-Null
# Lo levanta ya mismo (sin esperar el proximo inicio de sesion).
Start-ScheduledTask -TaskName $BridgeTaskName -ErrorAction SilentlyContinue

$bridgeTask = Get-ScheduledTask -TaskName $BridgeTaskName
# ---------------------------------------------------------------------------
# La web (Vercel) NO puede hacer `spawn` en la PC: solo encola el comando en
# Redis. El despertador mira esa cola cada N minutos y arranca el agente SOLO si
# hay comandos pendientes. Asi el boton "Sincronizar" funciona tambien cuando la
# web se abre desde el sitio remoto (tarda a lo sumo un intervalo).
# ---------------------------------------------------------------------------
if ($NoWaker) {
    Write-Host ""
    Write-Host "Despertador OMITIDO (-NoWaker): un click en la web remota solo se ejecuta en la proxima corrida programada." -ForegroundColor Yellow
    exit 0
}

if ($WakeIntervalMinutes -lt 1 -or $WakeIntervalMinutes -gt 60) {
    throw "WakeIntervalMinutes fuera de rango: $WakeIntervalMinutes (debe ser 1-60)"
}

$wakeVbs = Join-Path $ProjectRoot "sync-agent\wake-agent.vbs"
if (-not (Test-Path $wakeVbs)) { throw "No existe el lanzador del despertador: $wakeVbs" }

$wakeAction = New-ScheduledTaskAction -Execute $wscript -Argument "`"$wakeVbs`"" -WorkingDirectory $ProjectRoot
$wakeTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $WakeIntervalMinutes)
$wakeSettingsMap = @{
    StartWhenAvailable          = $true
    AllowStartIfOnBatteries     = $true
    DontStopIfGoingOnBatteries  = $true
    MultipleInstances           = "IgnoreNew"
    ExecutionTimeLimit          = (New-TimeSpan -Minutes 3)
}
$wakeSettings = New-ScheduledTaskSettingsSet @wakeSettingsMap

Register-ScheduledTask -TaskName $WakeTaskName -Action $wakeAction -Trigger $wakeTrigger `
    -Settings $wakeSettings -Principal $principal -Force | Out-Null

$wakeTask = Get-ScheduledTask -TaskName $WakeTaskName
$wakeInfo = Get-ScheduledTaskInfo -TaskName $WakeTaskName
Write-Host ""
Write-Host "OK - tarea '$($wakeTask.TaskName)' registrada (DESPERTADOR)." -ForegroundColor Green
Write-Host ("  Estado    : {0}" -f $wakeTask.State)
Write-Host ("  Frecuencia: cada {0} min (respaldo si el puente esta caido)" -f $WakeIntervalMinutes)
Write-Host ("  Lanzador  : {0}" -f $wakeVbs)
Write-Host ("  Proxima   : {0}" -f $wakeInfo.NextRunTime)
Write-Host ""
Write-Host "OK - tarea '$($bridgeTask.TaskName)' registrada (PUENTE LOCAL)." -ForegroundColor Green
Write-Host ("  Estado    : {0}" -f $bridgeTask.State)
Write-Host "  Inicio    : al iniciar sesion (despierta al agente al instante)"
Write-Host ("  Lanzador  : {0}" -f $bridgeVbs)
Write-Host ("  Escucha   : http://127.0.0.1:3033 (solo esta PC)")
Write-Host ""
Write-Host "Prueba del puente (el navegador de ESTA pc lo usa al sincronizar):" -ForegroundColor Cyan
Write-Host "  curl.exe -s http://127.0.0.1:3033/health"
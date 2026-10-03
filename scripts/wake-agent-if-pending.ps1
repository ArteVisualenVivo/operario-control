<#
.SYNOPSIS
    Despertador del agente 3C: si hay comandos en la cola, arranca el agente.

.DESCRIPTION
    La web (Vercel o cualquier host remoto respecto de la PC de 3C) NO puede
    hacer `spawn` local: solo puede ENCOLAR el comando en Redis
    (`sync-3c:queue`). Sin nadie que mire esa cola en la PC, el comando queda
    `pending` hasta la proxima corrida programada (10/12/15/17) y la web
    termina avisando "el agente no la tomo a tiempo".

    Este script cierra ese hueco: lo invoca cada minuto la tarea programada
    `operario-control-agent-wake` (ver scripts\install-auto-sync-tasks.ps1).
    Hace UNA consulta barata a Redis (`LLEN sync-3c:queue`) y:

      * cola vacia                                  -> sale (1 request, 0 procesos).
      * hay un agente vivo (lock `.agent.lock` OK)  -> sale (el agente ya drena).
      * hay comandos en cola                        -> lanza OCULTO
        `npx tsx sync-agent/agent.ts` (modo drenado) y se va.

    No es un servicio permanente: cada tick es un proceso corto que termina
    enseguida. Quien sincroniza sigue siendo el agente on-demand: toma el lock
    unico, drena la cola FIFO y SALE solo (ver AGENTS.md, invariante 2).

.PARAMETER ProjectRoot
    Raiz del proyecto. Por defecto C:\Users\Cesar\Desktop\operario-control.

.PARAMETER Force
    Lanza el agente aunque la cola este vacia (pruebas manuales).

.PARAMETER DryRun
    No lanza nada: solo informa que haria (pruebas manuales).

.PARAMETER RedisUrl
    URL REST de Upstash. Si no se pasa, se lee de `.env.local`.

.PARAMETER RedisToken
    Token REST de Upstash. Si no se pasa, se lee de `.env.local`.

.PARAMETER Quiet
    No escribe en consola (lo usa la tarea programada).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\wake-agent-if-pending.ps1 -DryRun

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\wake-agent-if-pending.ps1 -Force -DryRun
#>
[CmdletBinding()]
param(
    [string] $ProjectRoot = "C:\Users\Cesar\Desktop\operario-control",
    [switch] $Force,
    [switch] $DryRun,
    [string] $RedisUrl   = "",
    [string] $RedisToken = "",
    [string] $QueueKey   = "sync-3c:queue",
    [switch] $Quiet
)

$ErrorActionPreference = "Stop"

$envFile  = Join-Path $ProjectRoot ".env.local"
$lockFile = Join-Path $ProjectRoot "sync-agent\.agent.lock"
$wakeLog  = Join-Path $ProjectRoot "sync-agent\agent-wake.log"

function Write-Trace {
    param([string] $Message)
    if (-not $Quiet) { Write-Host $Message }
}

function Write-WakeLog {
    param([string] $Message)
    try {
        $line = "{0} {1}" -f (Get-Date).ToString("s"), $Message
        Add-Content -Path $wakeLog -Value $line -Encoding UTF8
        # El log tambien recibe el stdout del agente: se recorta si crece demasiado
        # (esto corre cada minuto, no puede crecer sin tope).
        $info = Get-Item $wakeLog -ErrorAction SilentlyContinue
        if ($info -and $info.Length -gt 524288) {
            $tail = Get-Content -Path $wakeLog -Tail 300
            Set-Content -Path $wakeLog -Value $tail -Encoding UTF8
        }
    } catch {
        # El log del despertador es best-effort: nunca debe romper el tick.
    }
}

function Get-EnvValue {
    param([string] $Name)
    if (-not (Test-Path $envFile)) { return "" }
    $match = Select-String -Path $envFile -Pattern ("^" + [regex]::Escape($Name) + "=(.*)$") |
        Select-Object -First 1
    if (-not $match) { return "" }
    return ($match.Matches[0].Groups[1].Value).Trim().Trim('"').Trim("'")
}

# ---------------------------------------------------------------------------
# 1. Credenciales de Redis (.env.local o parametros)
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($RedisUrl))   { $RedisUrl   = Get-EnvValue "UPSTASH_REDIS_REST_URL" }
if ([string]::IsNullOrWhiteSpace($RedisToken)) { $RedisToken = Get-EnvValue "UPSTASH_REDIS_REST_TOKEN" }

if ([string]::IsNullOrWhiteSpace($RedisUrl) -or [string]::IsNullOrWhiteSpace($RedisToken)) {
    Write-Trace "[WAKE] Sin credenciales de Upstash (.env.local): nada que hacer."
    Write-WakeLog "[WAKE] SKIP sin credenciales de Upstash"
    exit 0
}

# ---------------------------------------------------------------------------
# 2. Hay comandos en cola? (una sola request REST: LLEN)
# ---------------------------------------------------------------------------
try {
    $headers  = @{ Authorization = "Bearer $RedisToken" }
    $llenBody = '["LLEN","' + $QueueKey + '"]'
    $response = Invoke-RestMethod -Uri $RedisUrl -Method Post -Headers $headers `
        -ContentType "application/json" -Body $llenBody -TimeoutSec 20
    $queueLength = [int] $response.result
} catch {
    # Redis caido / sin respuesta: no se arranca nada y se reintenta en el proximo tick.
    Write-Trace "[WAKE] Redis no respondio: $($_.Exception.Message)"
    Write-WakeLog "[WAKE] SKIP Redis inaccesible: $($_.Exception.Message)"
    exit 0
}

if ($queueLength -lt 1 -and -not $Force) {
    Write-Trace "[WAKE] Cola vacia (LLEN $QueueKey = 0): no se arranca nada."
    exit 0
}

# ---------------------------------------------------------------------------
# 3. Ya hay un agente vivo? (lock con PID vivo)
#    Si el agente esta corriendo, el mismo drena la cola: no se pisa el carril.
# ---------------------------------------------------------------------------
function Get-LiveAgentPid {
    if (-not (Test-Path $lockFile)) { return $null }
    try {
        $raw = Get-Content $lockFile -Raw | ConvertFrom-Json
        $lockOwner = [int] $raw.pid
        if ($lockOwner -le 0) { return $null }
        if (Get-Process -Id $lockOwner -ErrorAction SilentlyContinue) { return $lockOwner }
    } catch {
        return $null
    }
    return $null
}

$livePid = Get-LiveAgentPid
if ($livePid) {
    Write-Trace "[WAKE] Agente ya en curso (PID $livePid): la cola la drena el mismo."
    exit 0
}

# ---------------------------------------------------------------------------
# 4. Despertar al agente (modo drenado, oculto, detached)
# ---------------------------------------------------------------------------
if ($DryRun) {
    Write-Trace "[WAKE] DRY-RUN: lanzaria 'npx tsx sync-agent/agent.ts' (cola=$queueLength)"
    exit 0
}

Write-Trace "[WAKE] Cola con $queueLength comando(s): despertando al agente."
Write-WakeLog "[WAKE] LAUNCH agente on-demand (cola=$queueLength)"

try {
    $agentCmd = "npx tsx sync-agent/agent.ts >> `"$wakeLog`" 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $agentCmd `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
} catch {
    Write-Trace "[WAKE] No se pudo lanzar el agente: $($_.Exception.Message)"
    Write-WakeLog "[WAKE] ERROR no se pudo lanzar el agente: $($_.Exception.Message)"
    exit 1
}

exit 0
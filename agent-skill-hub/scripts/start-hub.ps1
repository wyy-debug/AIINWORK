param(
  [string]$ConfigPath,
  [string]$HostAddress,
  [int]$Port,
  [string]$DataDir,
  [string]$AdminToken,
  [string]$SubmitToken,
  [switch]$OpenFirewall,
  [switch]$UseNode,
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DefaultConfig = Join-Path $RepoRoot "hub.config.json"
$ExePath = Join-Path $RepoRoot "dist\agent-skill-hub.exe"

function First-Value {
  param(
    [object[]]$Values
  )

  foreach ($Value in $Values) {
    if ($null -eq $Value) {
      continue
    }

    if ($Value -is [string]) {
      if ($Value.Trim().Length -gt 0) {
        return $Value.Trim()
      }
      continue
    }

    if ($Value -is [int] -and $Value -le 0) {
      continue
    }

    return $Value
  }

  return $null
}

$ResolvedConfig = First-Value @($ConfigPath, $env:HUB_CONFIG, $env:AGENT_SKILL_HUB_CONFIG, $DefaultConfig)
$ResolvedConfig = [System.IO.Path]::GetFullPath($ResolvedConfig)

if (-not (Test-Path $ResolvedConfig)) {
  throw "Hub config not found: $ResolvedConfig. Copy hub.config.example.json to hub.config.json and edit it."
}

$Config = Get-Content -Path $ResolvedConfig -Raw | ConvertFrom-Json

$ResolvedHost = First-Value @($HostAddress, $env:HUB_HOST, $env:HOST, $Config.host, "0.0.0.0")
$ResolvedPort = First-Value @($Port, $env:HUB_PORT, $env:PORT, $Config.port, 4877)
$ResolvedDataDir = First-Value @($DataDir, $env:HUB_DATA_DIR, $Config.dataDir, "D:\mtl-agent-skill-hub-data")
$ResolvedAdminToken = First-Value @($AdminToken, $env:HUB_ADMIN_TOKEN, $Config.adminToken)
$ResolvedSubmitToken = First-Value @($SubmitToken, $env:HUB_SUBMIT_TOKEN, $Config.submitToken)
$ResolvedName = First-Value @($env:HUB_NAME, $Config.name, "Agent/Skill Hub")
$ResolvedDescription = First-Value @($env:HUB_DESCRIPTION, $Config.description, "Shared Agent templates and Skills.")
$ResolvedPublicBasePath = First-Value @($env:HUB_PUBLIC_BASE_PATH, $Config.publicBasePath, "/agent-repository")
$ResolvedAdminBasePath = First-Value @($env:HUB_ADMIN_BASE_PATH, $Config.adminBasePath, "/api/admin")

if ([string]::IsNullOrWhiteSpace([string]$ResolvedAdminToken) -and [string]$ResolvedHost -ne "127.0.0.1" -and [string]$ResolvedHost -ne "localhost") {
  throw "adminToken is required for a remote Hub. Set adminToken in hub.config.json."
}

New-Item -ItemType Directory -Force -Path $ResolvedDataDir | Out-Null

$env:HUB_CONFIG = [string]$ResolvedConfig
$env:HOST = [string]$ResolvedHost
$env:HUB_HOST = [string]$ResolvedHost
$env:PORT = [string]$ResolvedPort
$env:HUB_PORT = [string]$ResolvedPort
$env:HUB_DATA_DIR = [string]$ResolvedDataDir
$env:HUB_ADMIN_TOKEN = [string]$ResolvedAdminToken
$env:HUB_PUBLIC_BASE_PATH = [string]$ResolvedPublicBasePath
$env:HUB_ADMIN_BASE_PATH = [string]$ResolvedAdminBasePath
$env:HUB_NAME = [string]$ResolvedName
$env:HUB_DESCRIPTION = [string]$ResolvedDescription

if (-not [string]::IsNullOrWhiteSpace([string]$ResolvedSubmitToken)) {
  $env:HUB_SUBMIT_TOKEN = [string]$ResolvedSubmitToken
}

if ($OpenFirewall) {
  $RuleName = "Agent Skill Hub $ResolvedPort"
  $ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  if (-not $ExistingRule) {
    New-NetFirewallRule `
      -DisplayName $RuleName `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort $ResolvedPort `
      -Action Allow | Out-Null
  }
}

$LanIps = @()
try {
  $LanIps = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -ExpandProperty IPAddress
} catch {
  $LanIps = @()
}

Write-Host "Agent/Skill Hub startup configuration"
Write-Host "  HUB_CONFIG    = $ResolvedConfig"
Write-Host "  HOST          = $ResolvedHost"
Write-Host "  PORT          = $ResolvedPort"
Write-Host "  HUB_DATA_DIR  = $ResolvedDataDir"
Write-Host "  Catalog local = http://localhost:$ResolvedPort$ResolvedPublicBasePath/catalog.json"
foreach ($Ip in $LanIps) {
  Write-Host "  Catalog LAN   = http://$Ip`:$ResolvedPort$ResolvedPublicBasePath/catalog.json"
}
Write-Host ""

if ($PrintOnly) {
  exit 0
}

if ($UseNode) {
  Push-Location $RepoRoot
  try {
    npm start
  } finally {
    Pop-Location
  }
  exit $LASTEXITCODE
}

if (-not (Test-Path $ExePath)) {
  throw "Portable exe not found: $ExePath. Run npm run package:win first, or start with -UseNode."
}

& $ExePath
exit $LASTEXITCODE

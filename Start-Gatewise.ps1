$ErrorActionPreference = 'Stop'
$serverFile = Join-Path $PSScriptRoot 'server.js'
$dataFolder = Join-Path $PSScriptRoot 'app-data'
New-Item -ItemType Directory -Force -Path $dataFolder | Out-Null

$node = $null
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node.exe'
if (Test-Path -LiteralPath $bundledNode) { $node = (Resolve-Path -LiteralPath $bundledNode).Path }
if (-not $node) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $node = $nodeCommand.Source }
}
if (-not $node) { throw 'Node.js is required. Install Node.js (v18+ or v20+), then run this script again.' }

$healthUrl = 'http://127.0.0.1:8080/api/me'
try {
  Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 | Out-Null
} catch {
  $argsList = @($serverFile)
  $stdout = Join-Path $dataFolder 'server.log'
  $stderr = Join-Path $dataFolder 'server-error.log'
  Start-Process -FilePath $node -ArgumentList $argsList -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 350
    try { Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw "Gatewise did not start. Review $stderr for the server error." }
}
Start-Process 'http://127.0.0.1:8080'
Write-Host 'Gatewise is running at http://127.0.0.1:8080'
Write-Host 'Demo sign-in: admin@northfield.school / GatewiseDemo!26'
Write-Host 'Stop the local server by closing its node.exe process in Task Manager.'

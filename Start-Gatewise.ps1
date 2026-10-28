$ErrorActionPreference = 'Stop'
$serverFile = Join-Path $PSScriptRoot 'server.py'
$dataFolder = Join-Path $PSScriptRoot 'app-data'
New-Item -ItemType Directory -Force -Path $dataFolder | Out-Null

$python = $null
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) { $python = (Resolve-Path -LiteralPath $bundledPython).Path }
if (-not $python) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) { $python = $pythonCommand.Source }
}
if (-not $python) {
  $pyCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCommand) { $python = $pyCommand.Source }
}
if (-not $python) { throw 'Python 3 is required. Install Python 3, then run this script again.' }

$healthUrl = 'http://127.0.0.1:8080/api/me'
try {
  Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 | Out-Null
} catch {
  $argsList = @()
  if ((Split-Path -Leaf $python) -eq 'py.exe') { $argsList += '-3' }
  $argsList += $serverFile
  $stdout = Join-Path $dataFolder 'server.log'
  $stderr = Join-Path $dataFolder 'server-error.log'
  Start-Process -FilePath $python -ArgumentList $argsList -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
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
Write-Host 'Stop the local server by closing its python.exe process in Task Manager.'

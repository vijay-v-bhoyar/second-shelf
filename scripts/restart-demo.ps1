$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Force -Path 'output\server','output\playwright','output\verification' | Out-Null
if(Test-Path -LiteralPath 'output\server\pid.txt') {
  $taskPid=[int](Get-Content -LiteralPath 'output\server\pid.txt')
  $taskOwner=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
  if($taskOwner -and $taskOwner.CommandLine -like '*scripts/demo-server.mjs*') {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$taskPid" | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
    Stop-Process -Id $taskPid -Force -ErrorAction SilentlyContinue
  }
}
if(Get-NetTCPConnection -LocalPort 4397 -State Listen -ErrorAction SilentlyContinue){throw 'Port 4397 belongs to another process; it has not been stopped.'}
# OneDrive can mark directories ReadOnly. PGlite maps this metadata to POSIX
# permissions and cannot create its lock even when native Windows writes work.
# Clear only that attribute on this app's local database directories; retain data/ACLs.
$taskDataRoot=Join-Path $taskRoot '.data\second-shelf'
if(Test-Path -LiteralPath $taskDataRoot) {
  $taskDataDirectories=@(Get-Item -LiteralPath $taskDataRoot -Force)+@(Get-ChildItem -LiteralPath $taskDataRoot -Directory -Recurse -Force)
  foreach($taskDirectory in $taskDataDirectories) {
    if($taskDirectory.Attributes -band [IO.FileAttributes]::ReadOnly) {
      $taskDirectory.Attributes=$taskDirectory.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly)
    }
  }
}
$env:PORT='4397'
$env:SECOND_SHELF_PROVIDER_MODE='fixture'
$env:SECOND_SHELF_LIVE_CALLS_AUTHORIZED='false'
$taskProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/demo-server.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput 'output\server\stdout.log' -RedirectStandardError 'output\server\stderr.log' -PassThru
$taskProcess.Id | Set-Content -LiteralPath 'output\server\pid.txt'
for($taskAttempt=0;$taskAttempt -lt 30;$taskAttempt++) {
  try {
    $taskHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:4397/api/v1/health'
    if($taskHealth.app -eq 'Second Shelf' -and $taskHealth.providerMode -eq 'fixture' -and $taskHealth.databaseReady -eq $true) {Write-Output ('Sample production demo ready at http://127.0.0.1:4397 · PID '+$taskProcess.Id);exit 0}
  }catch{}
  Start-Sleep -Milliseconds 300
}
throw 'Demo process started but its expected health response was not verified.'

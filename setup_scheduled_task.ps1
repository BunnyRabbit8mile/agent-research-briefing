# setup_scheduled_task.ps1
# Run this ONCE in an ADMIN PowerShell to register the daily arXiv briefing + watchdog.
# Runs run_briefing.bat which chains: arxiv_feishu_briefing.js -> watchdog.js

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatchPath = Join-Path $ScriptDir "run_briefing.bat"
$LogDir = Join-Path $ScriptDir "logs"

# Create logs directory
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatchPath`"" `
    -WorkingDirectory $ScriptDir

$Trigger = New-ScheduledTaskTrigger -Daily -At "13:00"
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

$TaskName = "arXivDailyBriefing"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Daily arXiv briefing + watchdog: fetch papers, push to Feishu, then auto-fix errors" `
    -RunLevel Limited -Force

Write-Host ""
Write-Host "=== Scheduled task registered ===" -ForegroundColor Green
Write-Host "  Task name : $TaskName"
Write-Host "  Schedule  : Every day at 13:00"
Write-Host "  Batch     : $BatchPath"
Write-Host ""
Write-Host "Manual run: $BatchPath" -ForegroundColor Yellow
# setup_nightly_report.ps1
# Run ONCE in an ADMIN PowerShell to register the nightly error report.
# Runs nightly_report.js at 21:00 daily

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeExe = "node"
$ScriptPath = Join-Path $ScriptDir "nightly_report.js"
$LogDir = Join-Path $ScriptDir "logs"

# Create logs directory
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument "`"$ScriptPath`"" `
    -WorkingDirectory $ScriptDir

$Trigger = New-ScheduledTaskTrigger -Daily -At "21:00"
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

$TaskName = "NightlyErrorReport"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Nightly error report: checks briefing errors and pushes summary to Feishu Docx" `
    -RunLevel Limited -Force

Write-Host ""
Write-Host "=== Nightly report task registered ===" -ForegroundColor Green
Write-Host "  Task name : $TaskName"
Write-Host "  Schedule  : Every day at 21:00"
Write-Host "  Script    : $ScriptPath"
Write-Host ""
Write-Host "Manual run: $NodeExe $ScriptPath" -ForegroundColor Yellow
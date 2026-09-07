<#
.SYNOPSIS
    Register the Windows Scheduled Tasks that run the crawl automation unattended.
    (automation-phase3.md, P3-3 "local runner" and P3-7 "board sync")

.DESCRIPTION
    ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as the ANSI code page
    (CP949 here), which would mangle Korean comments. Keep this file ASCII, or save it as
    UTF-8 *with* BOM if you ever add Korean text.

    Task 1  "yonsei-me keep-alive"        AtLogOn  -> node tools/automation/session-keepalive.mjs
            Watches the crawl session. On death it files the login issue and then waits for a new
            cookie, so it must never be stopped by an execution time limit -> ExecutionTimeLimit 0
            (PT0S = unlimited in the Task Scheduler schema). Restarts 3x/1min if it crashes.

    Task 2  "yonsei-me semester-update"   Daily 03:00 -> node tools/automation/scheduled-update.mjs
            Wakes the machine, decides whether today is inside a semester-update window, and only
            then calls the orchestrator. Missed runs (PC off) fire on the next boot via
            StartWhenAvailable; the wrapper's 14-day window covers the rest.

    Task 3  "yonsei-me board-sync"        Daily 04:30 -> node tools/automation/board-sync.mjs
            TEMPORARY, until the me.yonsei.ac.kr domain cutover. Crawls the OLD department board
            and imports only the posts our Supabase does not have yet. No WakeToRun: missing a
            night is harmless (the next run picks the same posts up). Capped at 2h. Remove this
            task on cutover day -> -Unregister -Only board-sync.

    All tasks run as the CURRENT user, non-elevated, LogonType Interactive -> no stored password,
    no admin rights needed to register. The trade-off: they only run while that user is logged on,
    and a console window is visible. See -DryRun output and the NOTES below.

.PARAMETER DryRun
    Print the task definitions that WOULD be registered (or removed) and exit. Registers nothing.

.PARAMETER Unregister
    Remove the tasks (all of them, or the ones matched by -Only).

.PARAMETER Only
    Act on the tasks whose name CONTAINS this text (case-insensitive), e.g. -Only board-sync.
    Use it to add or remove one task without re-registering the others: re-registering
    "keep-alive" kills the running daemon.

.PARAMETER RepoPath
    Repository root. Defaults to the folder two levels above this script.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/automation/register-tasks.ps1 -DryRun

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/automation/register-tasks.ps1 -Only board-sync

.NOTES
    A console window WILL appear for each run: New-ScheduledTaskAction in PS 5.1 has no
    WindowStyle, and hiding it needs a wrapper (wscript.exe + a .vbs shim) that is easy to get
    wrong and hard to debug. Left visible on purpose - decide before registering.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Unregister,
    [string]$Only,
    [string]$RepoPath
)

$ErrorActionPreference = 'Stop'

$KEEPALIVE_TASK  = 'yonsei-me keep-alive'
$UPDATE_TASK     = 'yonsei-me semester-update'
$BOARDSYNC_TASK  = 'yonsei-me board-sync'

# -Only <substring>: name filter. Empty filter = every task.
function Test-Selected {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Only)) { return $true }
    return ($Name -like "*$Only*")
}

if (-not $RepoPath) { $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
if (-not (Test-Path (Join-Path $RepoPath 'tools\automation\session-keepalive.mjs'))) {
    throw "Not a yonsei-me checkout: $RepoPath (pass -RepoPath)"
}

# ---- remove -----------------------------------------------------------------
if ($Unregister) {
    $matched = 0
    foreach ($name in @($KEEPALIVE_TASK, $UPDATE_TASK, $BOARDSYNC_TASK)) {
        if (-not (Test-Selected $name)) { continue }
        $matched++
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { Write-Host "not registered: $name"; continue }
        if ($DryRun) { Write-Host "[dry-run] would remove: $name"; continue }
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "removed: $name"
    }
    if ($matched -eq 0) { Write-Host "-Only '$Only' matched no task name." }
    return
}

# ---- definitions ------------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node.exe not found in PATH - install Node or run from a shell that has it.' }
$user = "$env:USERDOMAIN\$env:USERNAME"

# Hidden console: Task Scheduler cannot hide a console app by itself, but a hidden
# powershell.exe host passes its (hidden) console down to node. The window flashes for a
# moment at start and then stays hidden. The script path is relative to WorkingDirectory
# so no non-ASCII characters ever travel through the command line.
$psExe = Join-Path $PSHOME 'powershell.exe'
function New-HiddenNodeAction {
    param([string]$Script)
    $cmd = "& '$node' '$Script'"
    New-ScheduledTaskAction -Execute $psExe `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" `
        -WorkingDirectory $RepoPath
}

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

# 1) keep-alive: starts at logon, never times out, restarts if it dies.
$keepAlive = @{
    Name        = $KEEPALIVE_TASK
    Description = 'Watches the yonsei course-catalog session; files a login issue when it dies and resumes when a new cookie arrives. (P3-0/P3-3)'
    Action      = New-HiddenNodeAction -Script 'tools/automation/session-keepalive.mjs'
    Trigger     = New-ScheduledTaskTrigger -AtLogOn -User $user
    Settings    = New-ScheduledTaskSettingsSet `
                      -ExecutionTimeLimit ([TimeSpan]::Zero) `
                      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                      -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                      -MultipleInstances IgnoreNew
}

# 2) semester-update: daily 03:00, wakes the PC, 12h cap, no overlapping runs.
$semesterUpdate = @{
    Name        = $UPDATE_TASK
    Description = 'Daily 03:00 - runs the semester update orchestrator only inside an update window (12/1, 1/15, 6/1, 7/15 + 14 days). (P3-3)'
    Action      = New-HiddenNodeAction -Script 'tools/automation/scheduled-update.mjs'
    Trigger     = New-ScheduledTaskTrigger -Daily -At '3:00AM'
    Settings    = New-ScheduledTaskSettingsSet `
                      -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
                      -WakeToRun -StartWhenAvailable `
                      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                      -MultipleInstances IgnoreNew
}

# 3) board-sync: daily 04:30, TEMPORARY until the domain cutover, 2h cap, no wake.
#    Deliberately no -WakeToRun: this only mirrors new posts from the old site, and a
#    skipped night costs nothing (the next run sees the same posts as still missing).
$boardSync = @{
    Name        = $BOARDSYNC_TASK
    Description = 'Daily 04:30 - imports NEW posts from the legacy department board into Supabase. Temporary: unregister on domain cutover (-Unregister -Only board-sync). (P3-7)'
    Action      = New-HiddenNodeAction -Script 'tools/automation/board-sync.mjs'
    Trigger     = New-ScheduledTaskTrigger -Daily -At '4:30AM'
    Settings    = New-ScheduledTaskSettingsSet `
                      -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
                      -StartWhenAvailable `
                      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                      -MultipleInstances IgnoreNew
}

# ---- print / register -------------------------------------------------------
function Show-TaskPlan {
    param([hashtable]$Task, [object]$Principal)

    $a = $Task.Action
    $t = $Task.Trigger
    $s = $Task.Settings
    Write-Host ''
    Write-Host ('=' * 78)
    Write-Host "Task        : $($Task.Name)"
    Write-Host "Description : $($Task.Description)"
    Write-Host "Principal   : $($Principal.UserId)  LogonType=$($Principal.LogonType)  RunLevel=$($Principal.RunLevel)"
    Write-Host "Action      : $($a.Execute)"
    Write-Host "  Arguments : $($a.Arguments)"
    Write-Host "  WorkingDir: $($a.WorkingDirectory)"
    Write-Host "Trigger     : $($t.CimClass.CimClassName)"
    Write-Host "  Enabled   : $($t.Enabled)"
    if ($t.StartBoundary) {
        # The CIM object keeps the boundary in UTC; show the local time it actually fires at.
        $local = ''
        try { $local = "  (local {0})" -f ([datetime]$t.StartBoundary).ToString('yyyy-MM-dd HH:mm') } catch { }
        Write-Host "  StartAt   : $($t.StartBoundary)$local"
    }
    if ($t.DaysInterval)  { Write-Host "  Every     : $($t.DaysInterval) day(s)" }
    if ($t.UserId)        { Write-Host "  ForUser   : $($t.UserId)" }
    # NOTE: -AllowStartIfOnBatteries / -DontStopIfGoingOnBatteries are switches that CLEAR the
    # inverse properties, so those two are what we print (both False = runs on battery).
    Write-Host 'Settings    :'
    foreach ($p in 'ExecutionTimeLimit', 'RestartCount', 'RestartInterval', 'StartWhenAvailable',
                   'DisallowStartIfOnBatteries', 'StopIfGoingOnBatteries', 'WakeToRun',
                   'MultipleInstances', 'Enabled', 'Hidden') {
        $v = $s.$p
        if ($null -eq $v -or "$v" -eq '') { $v = '(default)' }
        Write-Host ("  {0,-27}: {1}" -f $p, $v)
    }
}

# @(...) around the pipeline on purpose: PS 5.1 unrolls a single match to a scalar, and
# .Count on a bare hashtable returns its KEY count (5), not 1.
$plans = @(@($keepAlive, $semesterUpdate, $boardSync) | Where-Object { Test-Selected $_.Name })

if ($plans.Count -eq 0) {
    Write-Host "-Only '$Only' matched no task name. Nothing to do."
    return
}

if ($DryRun) {
    Write-Host "[dry-run] repo : $RepoPath"
    Write-Host "[dry-run] node : $node"
    if (-not [string]::IsNullOrWhiteSpace($Only)) { Write-Host "[dry-run] only : *$Only* ($($plans.Count) task(s))" }
    Write-Host '[dry-run] nothing is registered; run without -DryRun to apply.'
    foreach ($p in $plans) { Show-TaskPlan -Task $p -Principal $principal }
    Write-Host ''
    Write-Host 'Notes:'
    Write-Host '  ExecutionTimeLimit PT0S = unlimited (Task Scheduler schema). PT12H = 12 hours.'
    Write-Host '  Console is hidden via a powershell.exe -WindowStyle Hidden host (brief flash at start).'
    Write-Host '  Tasks only run while this user is logged on (Interactive, no stored password).'
    Write-Host '  Re-registering a RUNNING task restarts it - use -Only to touch just one.'
    return
}

foreach ($p in $plans) {
    Show-TaskPlan -Task $p -Principal $principal
    Register-ScheduledTask -TaskName $p.Name -Description $p.Description `
        -Action $p.Action -Trigger $p.Trigger -Settings $p.Settings -Principal $principal -Force | Out-Null
    Write-Host "registered: $($p.Name)"
}

Write-Host ''
Write-Host 'Current state:'
Get-ScheduledTask -TaskName 'yonsei-me*' |
    Get-ScheduledTaskInfo |
    Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

if ($plans.Name -contains $KEEPALIVE_TASK) {
    Write-Host 'Start the keep-alive task now (it normally waits for the next logon):'
    Write-Host "  Start-ScheduledTask -TaskName '$KEEPALIVE_TASK'"
}
if ($plans.Name -contains $BOARDSYNC_TASK) {
    Write-Host 'Try the board sync once without writing anything:'
    Write-Host '  node tools/automation/board-sync.mjs --dry-run'
}

[CmdletBinding()]
param(
  [string[]]$DeviceSerial = @(),
  [string]$PackageName = "com.anonymous.rinnallaapp"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogDirectory = Join-Path $RepositoryRoot ".dev\logs\android-smoke\$Timestamp"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$SdkCandidates = @()
if ($env:ANDROID_HOME) { $SdkCandidates += $env:ANDROID_HOME }
if ($env:ANDROID_SDK_ROOT) { $SdkCandidates += $env:ANDROID_SDK_ROOT }
$SdkCandidates += "$env:LOCALAPPDATA\Android\Sdk"
$AndroidSdk = $SdkCandidates |
  Where-Object { $_ -and (Test-Path (Join-Path $_ "platform-tools\adb.exe")) } |
  Select-Object -First 1
if (-not $AndroidSdk) { throw "Could not locate adb. Set ANDROID_HOME." }
$Adb = Join-Path $AndroidSdk "platform-tools\adb.exe"

function Get-Devices {
  $Devices = @()
  foreach ($Line in @(& $Adb devices -l)) {
    if ($Line -match "^(\S+)\s+device\b(.*)$") {
      $Serial = $Matches[1]
      $Details = $Matches[2]
      $Model = $Serial
      if ($Details -match "\bmodel:(\S+)") { $Model = $Matches[1] }
      $Devices += [pscustomobject]@{ Serial = $Serial; Model = $Model }
    }
  }
  if ($DeviceSerial.Count -gt 0) {
    $Devices = @($Devices | Where-Object { $DeviceSerial -contains $_.Serial })
  }
  return @($Devices)
}

function Get-UiHierarchy([string]$Serial, [string]$Name) {
  $RemotePath = "/sdcard/rinnalla-$Name.xml"
  & $Adb -s $Serial shell uiautomator dump $RemotePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not capture the UI hierarchy." }
  $Contents = (& $Adb -s $Serial exec-out cat $RemotePath) -join "`n"
  $Contents | Out-File (Join-Path $LogDirectory "$Serial-$Name.xml") -Encoding utf8
  return [xml]$Contents
}

function Get-NodeCenter($Node) {
  $Bounds = $Node.GetAttribute("bounds")
  $Match = [regex]::Match($Bounds, "\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
  if (-not $Match.Success) { throw "Could not parse UI bounds: $Bounds" }
  return @(
    [int](([int]$Match.Groups[1].Value + [int]$Match.Groups[3].Value) / 2),
    [int](([int]$Match.Groups[2].Value + [int]$Match.Groups[4].Value) / 2)
  )
}

$Devices = @(Get-Devices)
if ($Devices.Count -eq 0) { throw "No requested authorized Android devices are connected." }
$Results = @()

foreach ($Device in $Devices) {
  $StartedAt = Get-Date
  $Status = "passed"
  $Detail = "settings drawer opened"
  try {
    & $Adb -s $Device.Serial logcat -b crash -c | Out-Null
    & $Adb -s $Device.Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
    & $Adb -s $Device.Serial shell wm dismiss-keyguard | Out-Null
    & $Adb -s $Device.Serial shell cmd statusbar collapse | Out-Null
    & $Adb -s $Device.Serial shell am force-stop $PackageName | Out-Null
    & $Adb -s $Device.Serial shell am start -n "$PackageName/.MainActivity" | Out-Null
    Start-Sleep -Seconds 4

    $Before = Get-UiHierarchy $Device.Serial "before"
    if ($Before.SelectSingleNode("//*[@content-desc='Device locked']") -or
        $Before.SelectSingleNode("//*[@text='Enter PIN']")) {
      throw "Device is locked. Unlock it once, then run npm run android:smoke again."
    }
    $Cog = $Before.SelectSingleNode("//*[@content-desc='Open household settings']")
    if (-not $Cog) { throw "Settings cog was not found." }
    $Center = Get-NodeCenter $Cog
    & $Adb -s $Device.Serial shell input tap $Center[0] $Center[1] | Out-Null
    Start-Sleep -Seconds 3

    $After = Get-UiHierarchy $Device.Serial "after"
    if (-not $After.SelectSingleNode("//*[@text='Household settings']")) {
      throw "Household settings title was not visible."
    }
    if (-not $After.SelectSingleNode("//*[@content-desc='Close household menu']")) {
      throw "Household settings close control was not visible."
    }

    $ProcessId = ([string](& $Adb -s $Device.Serial shell pidof $PackageName)).Trim()
    if (-not $ProcessId) { throw "Application process is not running." }
    $Focus = (& $Adb -s $Device.Serial shell dumpsys window | Select-String "mCurrentFocus" | Select-Object -First 1).Line
    if ($Focus -notmatch [regex]::Escape($PackageName)) {
      throw "Application is not the focused window."
    }

    $CrashLog = (& $Adb -s $Device.Serial logcat -b crash -d -v brief) -join "`n"
    $CrashLog | Out-File (Join-Path $LogDirectory "$($Device.Serial)-crash.log") -Encoding utf8
    if ($CrashLog -match [regex]::Escape($PackageName)) {
      throw "Application crash was recorded."
    }
  } catch {
    $Status = "failed"
    $Detail = $_.Exception.Message
  }

  $VersionDump = (& $Adb -s $Device.Serial shell dumpsys package $PackageName 2>$null) -join "`n"
  $VersionMatch = [regex]::Match($VersionDump, "versionCode=(\d+)")
  $Version = if ($VersionMatch.Success) { $VersionMatch.Groups[1].Value } else { "missing" }
  $Results += [pscustomobject]@{
    Model = $Device.Model
    Serial = $Device.Serial
    Version = $Version
    Status = $Status
    Seconds = [math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 1)
    Detail = $Detail
  }
}

$Results | Format-Table -AutoSize
Write-Host "[logs] $($LogDirectory.Substring($RepositoryRoot.Length + 1))"
if (@($Results | Where-Object { $_.Status -ne "passed" }).Count -gt 0) { exit 1 }

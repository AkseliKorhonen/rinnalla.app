[CmdletBinding()]
param(
  [ValidateSet("Build", "Install", "BuildInstall", "Launch")]
  [string]$Action = "BuildInstall",
  [string[]]$DeviceSerial = @(),
  [string]$Architecture = "arm64-v8a",
  [long]$VersionCode = 0,
  [switch]$SkipPrebuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$MobileRoot = Join-Path $RepositoryRoot "apps\mobile"
$AndroidRoot = Join-Path $MobileRoot "android"
$PackageName = "app.rinnalla"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogDirectory = Join-Path $RepositoryRoot ".dev\logs\android\$Timestamp"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-Result([string]$Status, [string]$Message) {
  Write-Host "[$Status] $Message"
}

function Invoke-Logged {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory
  )

  $LogPath = Join-Path $LogDirectory "$Name.log"
  $StdoutPath = "$LogPath.stdout"
  $StderrPath = "$LogPath.stderr"
  $StartedAt = Get-Date
  try {
    $Process = Start-Process -FilePath $Command `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory `
      -Wait `
      -PassThru `
      -NoNewWindow `
      -RedirectStandardOutput $StdoutPath `
      -RedirectStandardError $StderrPath
    $ExitCode = $Process.ExitCode
  } finally {
    @(
      if (Test-Path $StdoutPath) { Get-Content -LiteralPath $StdoutPath }
      if (Test-Path $StderrPath) { Get-Content -LiteralPath $StderrPath }
    ) | Out-File -LiteralPath $LogPath -Encoding utf8
    foreach ($TemporaryLog in @($StdoutPath, $StderrPath)) {
      if (Test-Path $TemporaryLog) { Remove-Item -LiteralPath $TemporaryLog -Force }
    }
  }

  $Duration = [math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 1)
  if ($ExitCode -ne 0) {
    Write-Result "fail" "$Name (${Duration}s)"
    Get-Content -LiteralPath $LogPath -Tail 40
    throw "$Name failed. Full log: $LogPath"
  }

  Write-Result "ok" "$Name (${Duration}s)"
}

function Resolve-JavaHome {
  $Candidates = @()
  if ($env:JAVA_HOME) { $Candidates += $env:JAVA_HOME }
  $Candidates += @(
    "$env:ProgramFiles\Android\Android Studio\jbr",
    "$env:ProgramFiles\Android\Android Studio\jre",
    "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
  )

  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path (Join-Path $Candidate "bin\java.exe"))) {
      return (Resolve-Path $Candidate).Path
    }
  }
  throw "Could not locate Java. Install Android Studio or set JAVA_HOME."
}

function Resolve-AndroidSdk {
  $Candidates = @()
  if ($env:ANDROID_HOME) { $Candidates += $env:ANDROID_HOME }
  if ($env:ANDROID_SDK_ROOT) { $Candidates += $env:ANDROID_SDK_ROOT }
  $Candidates += "$env:LOCALAPPDATA\Android\Sdk"

  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path (Join-Path $Candidate "platform-tools\adb.exe"))) {
      return (Resolve-Path $Candidate).Path
    }
  }
  throw "Could not locate the Android SDK. Install it or set ANDROID_HOME."
}

$env:JAVA_HOME = Resolve-JavaHome
$env:ANDROID_HOME = Resolve-AndroidSdk
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
$Adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$NpxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $NpxCommand) { $NpxCommand = Get-Command npx -ErrorAction Stop }
$Npx = $NpxCommand.Source

function Get-AndroidDevices {
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
    $Missing = @($DeviceSerial | Where-Object { $_ -notin $Devices.Serial })
    if ($Missing.Count -gt 0) {
      throw "Requested Android device(s) are not connected: $($Missing -join ', ')"
    }
  }
  return @($Devices)
}

$NeedsDevices = $Action -in @("Install", "BuildInstall", "Launch")
$Devices = @(Get-AndroidDevices)
if ($NeedsDevices -and $Devices.Count -eq 0) {
  throw "No authorized Android devices are connected."
}

foreach ($Device in $Devices) {
  $Abis = [string](& $Adb -s $Device.Serial shell getprop ro.product.cpu.abilist)
  if ($Architecture -and $Abis -notmatch [regex]::Escape($Architecture)) {
    throw "$($Device.Model) ($($Device.Serial)) does not support $Architecture. Reported ABIs: $Abis"
  }
}

function Get-InstalledVersionCode([string]$Serial) {
  $PackageDump = (& $Adb -s $Serial shell dumpsys package $PackageName 2>$null) -join "`n"
  $Match = [regex]::Match($PackageDump, "versionCode=(\d+)")
  if ($Match.Success) { return [long]$Match.Groups[1].Value }
  return 0
}

function Set-AndroidSigningEnvironment {
  $KeystorePath = $env:ANDROID_DEV_KEYSTORE_PATH
  if (-not $KeystorePath) {
    $KeystorePath = Join-Path $MobileRoot "credentials\rinnalla-development.jks"
  }
  if (-not (Test-Path $KeystorePath)) {
    throw "Development keystore was not found at $KeystorePath."
  }

  if (-not $env:ANDROID_DEV_KEYSTORE_PASSWORD -or -not $env:ANDROID_DEV_KEY_PASSWORD) {
    $PasswordPath = Join-Path $MobileRoot "credentials\rinnalla-development.password.dpapi"
    if (-not (Test-Path $PasswordPath)) {
      throw "Set Android signing password variables or restore $PasswordPath."
    }
    $SecurePassword = ConvertTo-SecureString ((Get-Content $PasswordPath -Raw).Trim())
    $PlainPassword = [System.Net.NetworkCredential]::new("", $SecurePassword).Password
    $env:ANDROID_DEV_KEYSTORE_PASSWORD = $PlainPassword
    $env:ANDROID_DEV_KEY_PASSWORD = $PlainPassword
  }

  $env:ANDROID_DEV_KEYSTORE_PATH = (Resolve-Path $KeystorePath).Path
  if (-not $env:ANDROID_DEV_KEY_ALIAS) {
    $env:ANDROID_DEV_KEY_ALIAS = "rinnalla-development"
  }
}

function Resolve-VersionCode {
  if ($VersionCode -gt 0) { return $VersionCode }
  $InstalledMaximum = 0
  foreach ($Device in $Devices) {
    $InstalledMaximum = [math]::Max(
      $InstalledMaximum,
      (Get-InstalledVersionCode $Device.Serial)
    )
  }
  $Minimum = $InstalledMaximum + 1
  $Computed = & $Node (Join-Path $RepositoryRoot "scripts\android-version-code.mjs") "--minimum=$Minimum"
  if ($LASTEXITCODE -ne 0) { throw "Could not compute the Android version code." }
  return [long]$Computed
}

function Find-ApkSigner {
  $BuildTools = Join-Path $env:ANDROID_HOME "build-tools"
  $Candidates = Get-ChildItem $BuildTools -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "apksigner.bat" } |
    Where-Object { Test-Path $_ }
  $Signer = $Candidates | Select-Object -First 1
  if (-not $Signer) { throw "Could not locate apksigner.bat under $BuildTools." }
  return $Signer
}

function Verify-Apk([string]$ApkPath, [long]$ExpectedVersionCode) {
  if (-not (Test-Path $ApkPath)) { throw "Gradle did not produce $ApkPath." }
  if ((Get-Item $ApkPath).Length -eq 0) { throw "The APK is empty: $ApkPath" }

  $MetadataPath = Join-Path (Split-Path $ApkPath) "output-metadata.json"
  $Metadata = Get-Content $MetadataPath -Raw | ConvertFrom-Json
  if ($Metadata.applicationId -ne $PackageName) {
    throw "APK package is $($Metadata.applicationId), expected $PackageName."
  }
  if ([long]$Metadata.elements[0].versionCode -ne $ExpectedVersionCode) {
    throw "APK version is $($Metadata.elements[0].versionCode), expected $ExpectedVersionCode."
  }

  $Jar = Join-Path $env:JAVA_HOME "bin\jar.exe"
  $Entries = @(& $Jar tf $ApkPath)
  if ($LASTEXITCODE -ne 0 -or "assets/index.android.bundle" -notin $Entries) {
    throw "The APK does not contain assets/index.android.bundle."
  }

  $ApkSigner = Find-ApkSigner
  $SigningReport = @(& $ApkSigner verify --verbose --print-certs $ApkPath 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed." }
  $SigningReport | Out-File (Join-Path $LogDirectory "apk-signature.log") -Encoding utf8

  $Keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
  $KeyReport = @(& $Keytool -list -v -keystore $env:ANDROID_DEV_KEYSTORE_PATH `
    -storepass $env:ANDROID_DEV_KEYSTORE_PASSWORD -alias $env:ANDROID_DEV_KEY_ALIAS 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the development signing key." }
  $KeyDigest = [regex]::Match(($KeyReport -join "`n"), "SHA256:\s*([0-9A-F:]+)", "IgnoreCase")
  $ApkDigest = [regex]::Match(($SigningReport -join "`n"), "certificate SHA-256 digest:\s*([0-9a-f]+)", "IgnoreCase")
  if (-not $KeyDigest.Success -or -not $ApkDigest.Success) {
    throw "Could not compare the signing certificate digests."
  }
  $ExpectedDigest = $KeyDigest.Groups[1].Value.Replace(":", "").ToLowerInvariant()
  if ($ApkDigest.Groups[1].Value.ToLowerInvariant() -ne $ExpectedDigest) {
    throw "The APK was not signed by the configured development key."
  }

  Write-Result "ok" "APK verified: $PackageName version $ExpectedVersionCode"
}

$Apk = Join-Path $AndroidRoot "app\build\outputs\apk\release\app-release.apk"
$BuildRequested = $Action -in @("Build", "BuildInstall")
$InstallRequested = $Action -in @("Install", "BuildInstall")
$LaunchRequested = $Action -in @("Install", "BuildInstall", "Launch")
$RequestedVersionCode = 0

if ($BuildRequested) {
  Set-AndroidSigningEnvironment
  $RequestedVersionCode = Resolve-VersionCode
  $env:ANDROID_VERSION_CODE = [string]$RequestedVersionCode
  $env:NODE_ENV = "production"

  Invoke-Logged "react-compatibility" $Node `
    @((Join-Path $RepositoryRoot "scripts\check-react-native-versions.mjs")) $RepositoryRoot

  if (-not $SkipPrebuild) {
    Invoke-Logged "expo-prebuild" $Npx @("expo", "prebuild", "--platform", "android", "--no-install") $MobileRoot
  }
  Invoke-Logged "android-release-configuration" $Node `
    @((Join-Path $RepositoryRoot "scripts\configure-android-release.mjs")) $RepositoryRoot

  $AutolinkingPaths = @(
    (Join-Path $AndroidRoot "build\generated\autolinking"),
    (Join-Path $AndroidRoot "app\build\generated\autolinking")
  )
  foreach ($AutolinkingPath in $AutolinkingPaths) {
    if (Test-Path $AutolinkingPath) {
      Remove-Item -LiteralPath $AutolinkingPath -Recurse -Force
    }
  }

  $Bundle = Join-Path $AndroidRoot "app\build\generated\assets\react\release\index.android.bundle"
  $SourceMap = Join-Path $AndroidRoot "app\build\intermediates\sourcemaps\react\release\index.android.bundle.packager.map"
  foreach ($GeneratedFile in @($Bundle, $SourceMap)) {
    if (Test-Path $GeneratedFile) { Remove-Item -LiteralPath $GeneratedFile -Force }
  }

  $Gradle = Join-Path $AndroidRoot "gradlew.bat"
  Invoke-Logged "gradle-assemble-release" $Gradle `
    @("assembleRelease", "-PreactNativeArchitectures=$Architecture") $AndroidRoot
  Verify-Apk $Apk $RequestedVersionCode
} elseif ($InstallRequested) {
  if (-not (Test-Path $Apk)) { throw "Build the APK first: npm run android:build" }
  $Metadata = Get-Content (Join-Path (Split-Path $Apk) "output-metadata.json") -Raw | ConvertFrom-Json
  $RequestedVersionCode = [long]$Metadata.elements[0].versionCode
}

$DeviceResults = @()
if ($InstallRequested) {
  foreach ($Device in $Devices) {
    Invoke-Logged "install-$($Device.Serial)" $Adb `
      @("-s", $Device.Serial, "install", "--no-streaming", "-r", $Apk) $RepositoryRoot
  }
}

if ($LaunchRequested) {
  foreach ($Device in $Devices) {
    & $Adb -s $Device.Serial shell am force-stop $PackageName | Out-Null
    & $Adb -s $Device.Serial shell am start -n "$PackageName/.MainActivity" | Out-Null
    Start-Sleep -Seconds 3
    $ProcessId = ([string](& $Adb -s $Device.Serial shell pidof $PackageName)).Trim()
    $InstalledVersion = Get-InstalledVersionCode $Device.Serial
    $Status = "running"
    if (-not $ProcessId) { $Status = "not running" }
    if ($RequestedVersionCode -gt 0 -and $InstalledVersion -ne $RequestedVersionCode) {
      $Status = "version mismatch"
    }
    $DeviceResults += [pscustomobject]@{
      Model = $Device.Model
      Serial = $Device.Serial
      Version = $InstalledVersion
      Status = $Status
    }
  }

  $DeviceResults | Format-Table -AutoSize
  if (@($DeviceResults | Where-Object { $_.Status -ne "running" }).Count -gt 0) {
    throw "One or more devices failed post-install verification."
  }
}

Write-Result "logs" ($LogDirectory.Substring($RepositoryRoot.Length + 1))

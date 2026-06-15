$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$JdkRoot = Join-Path $ProjectRoot '.toolchains\jdk-21'
$AndroidSdkRoot = Join-Path $ProjectRoot '.toolchains\android-sdk'
$Adb = Join-Path $AndroidSdkRoot 'platform-tools\adb.exe'
$ApkPath = Join-Path $ProjectRoot 'android\app\build\outputs\apk\release\app-release.apk'

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-android-release.ps1')

if (-not (Test-Path -LiteralPath $Adb)) {
  throw "adb not found at $Adb"
}

$env:JAVA_HOME = $JdkRoot
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:Path = "$JdkRoot\bin;$AndroidSdkRoot\platform-tools;$env:Path"

$devicesOutput = & $Adb devices
$connectedDevices = $devicesOutput | Where-Object { $_ -match "`tdevice$" }

if ($connectedDevices.Count -eq 0) {
  throw 'No Android device is connected. Enable USB debugging, connect the phone, approve the RSA prompt, then rerun npm run android:install-release.'
}

$installOutput = & $Adb install -r $ApkPath 2>&1
$installOutput | Write-Host

if ($LASTEXITCODE -ne 0) {
  if ($installOutput -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
    throw 'A build signed with another key is already installed. Manually uninstall the old Daily Predict app, then rerun this command. Android app data will be removed by that uninstall.'
  }

  throw 'adb release install failed.'
}

Write-Host ''
Write-Host "Installed signed 每日预测 release from $ApkPath"

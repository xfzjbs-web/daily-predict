$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$JdkRoot = Join-Path $ProjectRoot '.toolchains\jdk-21'
$AndroidSdkRoot = Join-Path $ProjectRoot '.toolchains\android-sdk'
$Adb = Join-Path $AndroidSdkRoot 'platform-tools\adb.exe'
$ApkPath = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-android-debug.ps1')

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
  throw "No Android device is connected. Enable USB debugging, connect the phone, approve the RSA prompt, then rerun npm run android:install."
}

& $Adb install -r $ApkPath
if ($LASTEXITCODE -ne 0) {
  throw 'adb install failed.'
}

Write-Host ''
Write-Host "Installed 每日预测 from $ApkPath"

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$JdkRoot = Join-Path $ProjectRoot '.toolchains\jdk-21'
$AndroidSdkRoot = Join-Path $ProjectRoot '.toolchains\android-sdk'
$GradleRoot = Join-Path $ProjectRoot '.toolchains\gradle-8.14.3'

if (-not (Test-Path -LiteralPath (Join-Path $JdkRoot 'bin\java.exe')) -or
    -not (Test-Path -LiteralPath (Join-Path $AndroidSdkRoot 'platforms\android-36\android.jar')) -or
    -not (Test-Path -LiteralPath (Join-Path $GradleRoot 'bin\gradle.bat'))) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-android-toolchain.ps1') -ProjectRoot $ProjectRoot
}

$env:JAVA_HOME = $JdkRoot
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:Path = "$JdkRoot\bin;$GradleRoot\bin;$AndroidSdkRoot\platform-tools;$env:Path"

Push-Location $ProjectRoot
try {
  npm run android:sync
  Push-Location (Join-Path $ProjectRoot 'android')
  try {
    & (Join-Path $GradleRoot 'bin\gradle.bat') assembleDebug
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$apkPath = Join-Path $ProjectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apkPath)) {
  throw "APK was not generated at $apkPath"
}

Write-Host ''
Write-Host "Debug APK generated: $apkPath"

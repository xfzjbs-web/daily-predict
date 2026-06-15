$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$JdkRoot = Join-Path $ProjectRoot '.toolchains\jdk-21'
$AndroidSdkRoot = Join-Path $ProjectRoot '.toolchains\android-sdk'
$GradleRoot = Join-Path $ProjectRoot '.toolchains\gradle-8.14.3'
$SigningRoot = Join-Path $ProjectRoot '.signing'
$KeystorePath = Join-Path $SigningRoot 'daily-predict-release.jks'
$SigningPropertiesPath = Join-Path $ProjectRoot 'android\signing.properties'

if (-not (Test-Path -LiteralPath (Join-Path $JdkRoot 'bin\java.exe')) -or
    -not (Test-Path -LiteralPath (Join-Path $AndroidSdkRoot 'platforms\android-36\android.jar')) -or
    -not (Test-Path -LiteralPath (Join-Path $GradleRoot 'bin\gradle.bat'))) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-android-toolchain.ps1') -ProjectRoot $ProjectRoot
}

$env:JAVA_HOME = $JdkRoot
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:Path = "$JdkRoot\bin;$GradleRoot\bin;$AndroidSdkRoot\platform-tools;$env:Path"

$hasKeystore = Test-Path -LiteralPath $KeystorePath
$hasProperties = Test-Path -LiteralPath $SigningPropertiesPath

if ($hasKeystore -xor $hasProperties) {
  throw 'Release signing files are incomplete. Restore both .signing/daily-predict-release.jks and android/signing.properties from backup.'
}

if (-not $hasKeystore) {
  New-Item -ItemType Directory -Force -Path $SigningRoot | Out-Null
  $password = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')).Substring(0, 40)
  $keytool = Join-Path $JdkRoot 'bin\keytool.exe'

  & $keytool `
    -genkeypair `
    -noprompt `
    -keystore $KeystorePath `
    -storetype PKCS12 `
    -storepass $password `
    -keypass $password `
    -alias 'daily-predict' `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname 'CN=Daily Predict, OU=Mobile, O=Daily Predict, L=Shanghai, ST=Shanghai, C=CN'

  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to generate the Android release signing key.'
  }

  $properties = @(
    'storeFile=../.signing/daily-predict-release.jks'
    "storePassword=$password"
    'keyAlias=daily-predict'
    "keyPassword=$password"
  )
  Set-Content -LiteralPath $SigningPropertiesPath -Value $properties -Encoding ASCII

  Write-Host 'Created a new Android release signing key.'
  Write-Host 'Back up .signing/ and android/signing.properties together. Losing them prevents future in-place upgrades.'
}

Push-Location $ProjectRoot
try {
  npm run android:sync
  Push-Location (Join-Path $ProjectRoot 'android')
  try {
    & (Join-Path $GradleRoot 'bin\gradle.bat') assembleRelease
    if ($LASTEXITCODE -ne 0) {
      throw 'Gradle release build failed.'
    }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$apkPath = Join-Path $ProjectRoot 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path -LiteralPath $apkPath)) {
  throw "Release APK was not generated at $apkPath"
}

$apksigner = Join-Path $AndroidSdkRoot 'build-tools\36.0.0\apksigner.bat'
if (-not (Test-Path -LiteralPath $apksigner)) {
  throw "apksigner was not found at $apksigner"
}

& $apksigner verify --verbose $apkPath
if ($LASTEXITCODE -ne 0) {
  throw 'Generated release APK did not pass signature verification.'
}

Write-Host ''
Write-Host "Signed release APK generated: $apkPath"

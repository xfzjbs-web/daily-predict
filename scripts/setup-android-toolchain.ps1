param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$ToolchainRoot = Join-Path $ProjectRoot '.toolchains'
$DownloadRoot = Join-Path $ToolchainRoot 'downloads'
$JdkRoot = Join-Path $ToolchainRoot 'jdk-21'
$AndroidSdkRoot = Join-Path $ToolchainRoot 'android-sdk'
$GradleRoot = Join-Path $ToolchainRoot 'gradle-8.14.3'
$CmdlineToolsRoot = Join-Path $AndroidSdkRoot 'cmdline-tools'
$CmdlineToolsLatest = Join-Path $CmdlineToolsRoot 'latest'

New-Item -ItemType Directory -Force -Path $DownloadRoot, $AndroidSdkRoot | Out-Null

function Invoke-Download {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  if (Test-Path -LiteralPath $OutFile) {
    Write-Host "Using cached download: $OutFile"
    return
  }

  Write-Host "Downloading $Url"
  & curl.exe -L --fail --retry 3 --output $OutFile $Url
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed: $Url"
  }
}

function Expand-FreshArchive {
  param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (Test-Path -LiteralPath $Destination) {
    Write-Host "Already extracted: $Destination"
    return
  }

  $tempDestination = "$Destination.tmp"
  if (Test-Path -LiteralPath $tempDestination) {
    Remove-Item -LiteralPath $tempDestination -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $tempDestination | Out-Null
  Expand-Archive -LiteralPath $Archive -DestinationPath $tempDestination -Force

  $children = Get-ChildItem -LiteralPath $tempDestination
  if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
    Move-Item -LiteralPath $children[0].FullName -Destination $Destination
    Remove-Item -LiteralPath $tempDestination -Recurse -Force
  } else {
    Move-Item -LiteralPath $tempDestination -Destination $Destination
  }
}

function Convert-ToJavaPropertiesValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  $builder = [System.Text.StringBuilder]::new()
  foreach ($character in $Value.ToCharArray()) {
    $code = [int][char]$character
    if ($code -gt 127) {
      [void]$builder.Append(('\u{0:X4}' -f $code))
    } elseif ($character -eq '\') {
      [void]$builder.Append('/')
    } else {
      [void]$builder.Append($character)
    }
  }

  $builder.ToString()
}

$jdkZip = Join-Path $DownloadRoot 'microsoft-jdk21-windows-x64.zip'
Invoke-Download `
  -Url 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip' `
  -OutFile $jdkZip
Expand-FreshArchive -Archive $jdkZip -Destination $JdkRoot

$gradleZip = Join-Path $DownloadRoot 'gradle-8.14.3-bin.zip'
Invoke-Download `
  -Url 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip' `
  -OutFile $gradleZip
Expand-FreshArchive -Archive $gradleZip -Destination $GradleRoot

$repositoryXmlUrl = 'https://dl.google.com/android/repository/repository2-1.xml'
Write-Host "Resolving latest Android command line tools from $repositoryXmlUrl"
$repositoryXml = (Invoke-WebRequest -UseBasicParsing -Uri $repositoryXmlUrl).Content
$toolMatches = [regex]::Matches($repositoryXml, 'commandlinetools-win-([0-9]+)_latest\.zip')
if ($toolMatches.Count -eq 0) {
  throw 'Unable to resolve Android command line tools package.'
}

$latestRevision = $toolMatches |
  ForEach-Object { [int]$_.Groups[1].Value } |
  Sort-Object -Descending |
  Select-Object -First 1

$cmdlineToolsZip = Join-Path $DownloadRoot "commandlinetools-win-$latestRevision`_latest.zip"
Invoke-Download `
  -Url "https://dl.google.com/android/repository/commandlinetools-win-$latestRevision`_latest.zip" `
  -OutFile $cmdlineToolsZip

if (-not (Test-Path -LiteralPath $CmdlineToolsLatest)) {
  $tempTools = Join-Path $CmdlineToolsRoot 'extracted'
  if (Test-Path -LiteralPath $tempTools) {
    Remove-Item -LiteralPath $tempTools -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $tempTools | Out-Null
  Expand-Archive -LiteralPath $cmdlineToolsZip -DestinationPath $tempTools -Force
  New-Item -ItemType Directory -Force -Path $CmdlineToolsRoot | Out-Null
  Move-Item -LiteralPath (Join-Path $tempTools 'cmdline-tools') -Destination $CmdlineToolsLatest
  Remove-Item -LiteralPath $tempTools -Recurse -Force
}

$env:JAVA_HOME = $JdkRoot
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:Path = "$JdkRoot\bin;$CmdlineToolsLatest\bin;$AndroidSdkRoot\platform-tools;$env:Path"

$sdkManager = Join-Path $CmdlineToolsLatest 'bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $sdkManager)) {
  throw "sdkmanager not found at $sdkManager"
}

Write-Host 'Accepting Android SDK licenses'
1..80 | ForEach-Object { 'y' } | & $sdkManager --sdk_root=$AndroidSdkRoot --licenses

Write-Host 'Installing Android SDK packages'
& $sdkManager --sdk_root=$AndroidSdkRoot 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0) {
  throw 'Android SDK package installation failed.'
}

$localProperties = Join-Path $ProjectRoot 'android\local.properties'
$sdkDir = Convert-ToJavaPropertiesValue -Value $AndroidSdkRoot
Set-Content -LiteralPath $localProperties -Encoding ASCII -Value "sdk.dir=$sdkDir"

Write-Host ''
Write-Host 'Android toolchain ready.'
Write-Host "JAVA_HOME=$JdkRoot"
Write-Host "ANDROID_HOME=$AndroidSdkRoot"
Write-Host "GRADLE_HOME=$GradleRoot"

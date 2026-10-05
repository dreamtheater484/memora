# Tests the Microsoft Store package (docs/SIGNING.md) as people will get it: installed as a
# package, started from the Start menu, and uninstalled again. What's different in the Store's
# package is checked on the way:
#   - Memora starts, and its server answers;
#   - the notes are in the person's own folder (%USERPROFILE%\Memora), not in AppData, which
#     Windows keeps apart for a Store app;
#   - uninstalling leaves them there.
#
# CI only: it trusts a throwaway certificate on this computer, to sign the package as the Store
# would. Run it after the build (release/Memora-Store.appx), with the package's identity.
param(
  [Parameter(Mandatory)] [string] $Package,
  [Parameter(Mandatory)] [string] $Identity,
  [Parameter(Mandatory)] [string] $Publisher,
  [string] $Screenshot = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Step($message) { Write-Host "store: $message" }

if ($Screenshot) { $Screenshot = Join-Path (Get-Location) $Screenshot }
$notes = Join-Path $env:USERPROFILE 'Memora'
$db = Join-Path $notes 'Data\memora.db'

# Nothing left from the tests before: the installer's own start of Memora, or a previous run.
Get-Process Memora -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $notes -Recurse -Force -ErrorAction SilentlyContinue

# The Store signs the package itself. Here a throwaway certificate for the same publisher does,
# trusted on this computer only.
$cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
  -FriendlyName 'Memora Store package test' -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$secret = [guid]::NewGuid().ToString()
$pfx = Join-Path $env:RUNNER_TEMP 'memora-store-test.pfx'
Export-PfxCertificate -Cert $cert -FilePath $pfx `
  -Password (ConvertTo-SecureString -String $secret -Force -AsPlainText) | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople `
  -Password (ConvertTo-SecureString -String $secret -Force -AsPlainText) | Out-Null

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe is missing: the Windows SDK is needed.' }
# A copy is signed: the package for Partner Center stays as it was built.
$signed = Join-Path $env:RUNNER_TEMP 'Memora-Store-test.appx'
Copy-Item $Package $signed -Force
& $signtool.FullName sign /fd SHA256 /f $pfx /p $secret $signed
if ($LASTEXITCODE) { throw "signtool couldn't sign the package (exit code $LASTEXITCODE)." }

Step 'installing the package'
Add-AppxPackage -Path $signed
$installed = Get-AppxPackage -Name $Identity
if (-not $installed) { throw "The package $Identity isn't installed." }
Step "installed $($installed.PackageFullName)"

# Started as the Start menu starts it: as the package, which is what makes Windows treat it as one.
Start-Process "shell:AppsFolder\$($installed.PackageFamilyName)!Memora"

# The server listens on 127.0.0.1, on a port of its choosing: whichever one Memora's processes hold.
$health = $null
$deadline = (Get-Date).AddSeconds(90)
while (-not $health -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $ids = @(Get-Process Memora -ErrorAction SilentlyContinue | ForEach-Object Id)
  if (-not $ids) { continue }
  $ports = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue |
    Where-Object { $ids -contains $_.OwningProcess } | ForEach-Object LocalPort
  foreach ($port in $ports) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 5
      Step "the server answers on port ${port}: $($health | ConvertTo-Json -Compress)"
      break
    } catch {
      # Not ready yet, or not Memora's port.
    }
  }
}
if (-not $health) {
  $logs = Get-ChildItem -Recurse -Filter memora.log -ErrorAction SilentlyContinue -Path `
    $notes, "$env:APPDATA\Memora", "$env:LOCALAPPDATA\Packages\$($installed.PackageFamilyName)"
  $logs | ForEach-Object { Write-Host "--- $($_.FullName)"; Get-Content $_.FullName -Tail 50 }
  throw 'Memora from the Store package did not answer within 90 seconds.'
}

if (-not (Test-Path $db)) { throw "The notes aren't in $notes\Data." }
Step "the notes are in $notes\Data"

# A picture of the window, for the run's artifacts.
if ($Screenshot) {
  Start-Sleep -Seconds 8
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    New-Item -ItemType Directory -Force (Split-Path $Screenshot) | Out-Null
    $bitmap.Save($Screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
    Step "screenshot in $Screenshot"
  } catch {
    Write-Warning "No screenshot: $_"
  }
}

Get-Process Memora -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

Step 'uninstalling the package'
Remove-AppxPackage -Package $installed.PackageFullName
if (Get-AppxPackage -Name $Identity) { throw 'The package is still installed.' }
if (-not (Test-Path $db)) { throw "Uninstalling removed the notes from $notes\Data." }
Step 'uninstalled; the notes stay'

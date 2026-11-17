# Launch the dedicated interactive Android preview. Existing app data is retained.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tooling = Join-Path $projectRoot '.tooling'
$avdName = 'KROK_Phone'
$emulatorPort = 5584
$device = "emulator-$emulatorPort"
$serverPort = 5177
$statusUrl = "http://127.0.0.1:$serverPort/api/coach/status"
$launchLock = $null
$hasLock = $false

function Quote-NativeArgument([string] $Value) {
    # ProcessStartInfo.Arguments uses Windows command-line quoting, not shell quoting.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-Native([string] $File, [string[]] $Arguments, [int] $TimeoutSeconds = 20, [string] $InputText = '') {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
    $info.WorkingDirectory = $projectRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # This is only the command created above, never another emulator/server.
            $process.Kill()
            throw "Command timed out: $(Split-Path -Leaf $File)"
        }
        return [pscustomobject] @{ Code = $process.ExitCode; Out = $stdout.Result.Trim(); Error = $stderr.Result.Trim() }
    } finally { $process.Dispose() }
}

function Test-LocalPort([int] $Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(700)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Test-KrokServer {
    try {
        $response = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 2
        return ($response -is [pscustomobject] -and $response.provider -ceq 'openai' -and $response.configured -is [bool])
    } catch { return $false }
}

function Start-KrokServer {
    if (Test-KrokServer) { Write-Host 'KROK server is already running on port 5177.'; return }
    if (Test-LocalPort $serverPort) {
        throw 'Port 5177 is occupied by a server that does not identify itself as KROK. Close that server yourself, then run PHONE.cmd again. Nothing was stopped.'
    }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js is missing. Install Node.js 22 or newer and run PHONE.cmd again.' }
    $serverScript = Join-Path $PSScriptRoot 'serve.mjs'
    if (-not (Test-Path -LiteralPath $serverScript)) { throw 'scripts/serve.mjs is missing. Restore the project files.' }
    $previousPort = $env:PORT
    try {
        $env:PORT = [string] $serverPort
        $serverProcess = Start-Process -FilePath $node.Source -ArgumentList (Quote-NativeArgument $serverScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tooling 'phone-server.log') -RedirectStandardError (Join-Path $tooling 'phone-server-errors.log') -PassThru
    } finally { $env:PORT = $previousPort }
    Set-Content -LiteralPath (Join-Path $tooling 'phone-server.pid') -Value $serverProcess.Id -Encoding ASCII
    $readyBy = [DateTime]::UtcNow.AddSeconds(25)
    do {
        if (Test-KrokServer) { Write-Host 'KROK server is ready on port 5177.'; return }
        if ($serverProcess.HasExited) { break }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $readyBy)
    if (-not $serverProcess.HasExited) { $serverProcess.Kill() }
    throw 'KROK server did not become ready. See .tooling/phone-server.log and phone-server-errors.log. No existing server was stopped.'
}

function Get-PreviewProcesses {
    # Match both the dedicated port and AVD; never select another Android device.
    return @(Get-CimInstance Win32_Process -Filter "Name LIKE 'emulator%' OR Name LIKE 'qemu-system%'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match '(?:^|\s)-port\s+"?5584"?(?:\s|$)' -and
        $_.CommandLine -match '(?:^|\s)-avd\s+"?KROK_Phone"?(?:\s|$)'
    })
}

function Show-PreviewWindow {
    try {
        if (-not ('KrokPreviewWindow' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KrokPreviewWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
        }
        $ownerIds = @(Get-PreviewProcesses | ForEach-Object { [int] $_.ProcessId })
        $windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowHandle -ne [IntPtr]::Zero -and ($ownerIds -contains $_.Id -or $_.MainWindowTitle -match 'KROK_Phone.*5584|5584.*KROK_Phone')
        })
        foreach ($window in $windows) {
            [void] [KrokPreviewWindow]::ShowWindowAsync($window.MainWindowHandle, 9)
            [void] [KrokPreviewWindow]::SetForegroundWindow($window.MainWindowHandle)
        }
    } catch { Write-Host 'Phone is running. Select its window from the Windows taskbar.' }
}

function Ensure-Avd {
    $available = Invoke-Native $emulator @('-list-avds')
    if ($available.Code -ne 0) { throw "Cannot list Android virtual devices: $($available.Error)" }
    if (@($available.Out -split '\r?\n' | Where-Object { $_.Trim() -ceq $avdName }).Count -gt 0) { return }
    $image = Join-Path $sdk 'system-images\android-35\google_apis\x86_64\system.img'
    if (-not (Test-Path -LiteralPath $image)) {
        throw 'KROK_Phone is missing and Android 35 Google APIs x86_64 is not installed. Install that system image in Android Studio Device Manager, then run PHONE.cmd again. This launcher does not download SDK packages.'
    }
    $javaCandidates = @()
    if ($env:JAVA_HOME) { $javaCandidates += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    if ($env:ProgramFiles) { $javaCandidates += Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin\java.exe' }
    $javaCandidates += @(Get-ChildItem -LiteralPath $tooling -Directory -Filter 'jdk*' | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
    $javaOnPath = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($javaOnPath) { $javaCandidates += $javaOnPath.Source }
    $java = $null
    foreach ($candidate in ($javaCandidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $version = Invoke-Native $candidate @('-version')
        if ($version.Code -eq 0 -and "$($version.Out) $($version.Error)" -match 'version\s+"(\d+)' -and [int]$Matches[1] -ge 21) { $java = $candidate; break }
    }
    if (-not $java) { throw 'Creating KROK_Phone requires JDK 21+. Set JAVA_HOME, install Android Studio, or create a Pixel 7 virtual device named KROK_Phone in Android Studio first.' }
    $toolsRoot = Join-Path $sdk 'cmdline-tools'
    $classpath = Join-Path $toolsRoot 'latest\lib\avdmanager-classpath.jar'
    if (-not (Test-Path -LiteralPath $classpath)) {
        $classpath = Get-ChildItem -LiteralPath $toolsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'lib\avdmanager-classpath.jar' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $classpath) { throw 'Android SDK Command-line Tools are missing. Install them in Android Studio SDK Manager; no SDK packages are downloaded by PHONE.cmd.' }
    $commandLineTools = Split-Path -Parent (Split-Path -Parent $classpath)
    Write-Host 'Creating the dedicated Pixel 7 preview from the installed Android 35 image...'
    $created = Invoke-Native $java @("-Dcom.android.sdkmanager.toolsdir=$commandLineTools", '-classpath', $classpath, 'com.android.sdklib.tool.AvdManagerCli', 'create', 'avd', '--name', $avdName, '--package', 'system-images;android-35;google_apis;x86_64', '--device', 'pixel_7') 120 "no`n"
    Set-Content -LiteralPath (Join-Path $tooling 'phone-avd-create.log') -Value "$($created.Out)`r`n$($created.Error)" -Encoding UTF8
    if ($created.Code -ne 0) { throw 'Could not create KROK_Phone. See .tooling/phone-avd-create.log. Existing virtual devices were not changed.' }
}

try {
    $launchLock = New-Object System.Threading.Mutex($false, 'Local\KROK_Phone_Preview_5584')
    try { $hasLock = $launchLock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { Write-Host 'KROK phone preview is already starting. Please wait for its window.'; exit 0 }
    Set-Location -LiteralPath $projectRoot
    New-Item -ItemType Directory -Path $tooling -Force | Out-Null
    $package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($package.version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'package.json has an invalid app version.' }
    $apk = Join-Path $projectRoot "releases\krok-$($package.version)-debug.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "APK for version $($package.version) is missing. Run BUILD-ANDROID.cmd first." }
    $sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
    if ($env:LOCALAPPDATA) { $sdkCandidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    $sdk = $sdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platform-tools\adb.exe')) -and (Test-Path -LiteralPath (Join-Path $_ 'emulator\emulator.exe')) } | Select-Object -First 1
    if (-not $sdk) { throw 'Android SDK is missing. Set ANDROID_HOME or install Android Studio with Emulator and Platform Tools.' }
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    $emulator = Join-Path $sdk 'emulator\emulator.exe'
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    if (-not $env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android' }
    if (-not $env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME = Join-Path $env:ANDROID_USER_HOME 'avd' }
    $startedAdb = Invoke-Native $adb @('start-server')
    if ($startedAdb.Code -ne 0) { throw "Android Debug Bridge could not start: $($startedAdb.Error)" }
    Start-KrokServer
    $bootBy = [DateTime]::UtcNow.AddMinutes(3)
    $existing = Get-PreviewProcesses
    $occupied = Test-LocalPort $emulatorPort
    if (-not $occupied -and $existing.Count -eq 0) {
        Ensure-Avd
        Write-Host 'Opening KROK_Phone. The first boot can take a few minutes...'
        $preview = Start-Process -FilePath $emulator -ArgumentList @('-avd', $avdName, '-port', [string] $emulatorPort, '-gpu', 'software', '-no-boot-anim', '-scale', '0.4') -WorkingDirectory $projectRoot -WindowStyle Normal -RedirectStandardOutput (Join-Path $tooling 'phone-emulator.log') -RedirectStandardError (Join-Path $tooling 'phone-emulator-errors.log') -PassThru
        Set-Content -LiteralPath (Join-Path $tooling 'phone-emulator.pid') -Value $preview.Id -Encoding ASCII
        $bootBy = [DateTime]::UtcNow.AddMinutes(3)
    } else { Write-Host 'Checking the existing phone on emulator port 5584...' }
    $verifiedAvd = $false
    $booted = $false
    do {
        $remaining = [Math]::Max(1, [Math]::Min(5, [Math]::Ceiling(($bootBy - [DateTime]::UtcNow).TotalSeconds)))
        try { $identity = Invoke-Native $adb @('-s', $device, 'emu', 'avd', 'name') $remaining } catch { $identity = $null }
        if ($identity -and $identity.Code -eq 0 -and $identity.Out) {
            $actualAvd = [string] ($identity.Out -split '\r?\n' | Where-Object { $_.Trim() -and $_.Trim() -ne 'OK' } | Select-Object -First 1)
            $actualAvd = $actualAvd.Trim()
            if ($actualAvd -cne $avdName) { throw "Port 5584 belongs to '$actualAvd', not KROK_Phone. Nothing on that device was changed. Close it yourself and run PHONE.cmd again." }
            $verifiedAvd = $true
            if ([DateTime]::UtcNow -ge $bootBy) { break }
            $remaining = [Math]::Max(1, [Math]::Min(5, [Math]::Ceiling(($bootBy - [DateTime]::UtcNow).TotalSeconds)))
            try { $boot = Invoke-Native $adb @('-s', $device, 'shell', 'getprop', 'sys.boot_completed') $remaining } catch { $boot = $null }
            if ($boot -and $boot.Code -eq 0 -and $boot.Out.Trim() -eq '1') { $booted = $true; break }
        }
        if ([DateTime]::UtcNow -ge $bootBy) { break }
        Start-Sleep -Milliseconds 700
    } while ([DateTime]::UtcNow -lt $bootBy)
    if (-not $verifiedAvd) { throw 'Could not verify KROK_Phone on port 5584 within 3 minutes. No APK was installed. Check .tooling/phone-emulator-errors.log and any program using that port.' }
    if (-not $booted) { throw 'KROK_Phone is still booting after 3 minutes. Leave its window open and run PHONE.cmd again when Android is ready.' }
    Show-PreviewWindow
    Write-Host "Installing KROK $($package.version), keeping existing app data..."
    $installed = Invoke-Native $adb @('-s', $device, 'install', '-r', $apk) 120
    if ($installed.Code -ne 0 -or $installed.Out -notmatch '\bSuccess\b') { throw "APK installation failed. $($installed.Out) $($installed.Error)" }
    $launched = Invoke-Native $adb @('-s', $device, 'shell', 'am', 'start', '-n', 'app.krok.mobile/.MainActivity')
    if ($launched.Code -ne 0 -or $launched.Out -match '(?m)^Error:') { throw "KROK could not open. $($launched.Out) $($launched.Error)" }
    Show-PreviewWindow
    Write-Host 'KROK is open in the phone window. Use the mouse as a finger; drag to scroll.'
    Write-Host 'PHONE.cmd can be run again safely. App data is retained, and other devices are untouched.'
    exit 0
} catch {
    Write-Host "KROK phone: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($hasLock) { $launchLock.ReleaseMutex() }
    if ($launchLock) { $launchLock.Dispose() }
}

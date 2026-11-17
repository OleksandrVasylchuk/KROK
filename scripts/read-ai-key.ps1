param([Parameter(Mandatory=$true)][string]$KeyFile)
$ErrorActionPreference = 'Stop'
try {
    $krokEncrypted = [System.IO.File]::ReadAllText($KeyFile).Trim()
    $krokSecure = ConvertTo-SecureString -String $krokEncrypted
    $krokPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($krokSecure)
    try {
        # Captured only by the server process; never run this helper interactively.
        [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($krokPointer))
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($krokPointer)
        $krokSecure.Dispose()
    }
} catch { exit 1 }

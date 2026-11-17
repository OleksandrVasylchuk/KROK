$ErrorActionPreference = 'Stop'
$krokRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$krokLocal = Join-Path $krokRoot '.local'
$krokKeyFile = Join-Path $krokLocal 'openai-key.dpapi'
Write-Host ''
Write-Host 'KROK - connect your OpenAI API key' -ForegroundColor Cyan
Write-Host 'Create a key: https://platform.openai.com/api-keys'
Write-Host 'API usage may cost money. Check your API billing and project limits.'
Write-Host 'Paste the key below. Input is hidden. Never send it in a chat.'
Write-Host 'The key is encrypted for this Windows user, outside the app and APK.'
Write-Host 'An empty entry cancels without changing the existing key.'
Write-Host ''
$krokSecret = Read-Host 'OpenAI API key' -AsSecureString
try {
    if ($krokSecret.Length -eq 0) { Write-Host 'Cancelled.'; exit 0 }
    $krokPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($krokSecret)
    try {
        $krokPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($krokPointer).Trim()
        if (!$krokPlain.StartsWith('sk-') -or $krokPlain.Length -gt 4096 -or $krokPlain -match '\s') {
            throw 'This does not look like an OpenAI secret API key. Nothing was saved.'
        }
        $krokTrimmed = ConvertTo-SecureString -String $krokPlain -AsPlainText -Force
        $krokPlain = $null
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($krokPointer) }
    try {
        $krokCipher = ConvertFrom-SecureString -SecureString $krokTrimmed
        New-Item -ItemType Directory -Path $krokLocal -Force | Out-Null
        $krokTemporary = Join-Path $krokLocal ('key-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        try {
            [System.IO.File]::WriteAllText($krokTemporary, $krokCipher, [System.Text.Encoding]::ASCII)
            if (Test-Path -LiteralPath $krokKeyFile) {
                [System.IO.File]::Replace($krokTemporary, $krokKeyFile, [NullString]::Value)
            } else { [System.IO.File]::Move($krokTemporary, $krokKeyFile) }
        } finally {
            if (Test-Path -LiteralPath $krokTemporary) { Remove-Item -LiteralPath $krokTemporary }
        }
    } finally { $krokTrimmed.Dispose() }
    Write-Host ''
    Write-Host 'Key saved. No paid API request has been made.' -ForegroundColor Green
    Write-Host 'Open PHONE.cmd or START.cmd, then open the coach and refresh its connection.'
    Write-Host 'Sending a message in OpenAI mode uses your API account.'
    Write-Host 'To disconnect, remove .local\openai-key.dpapi from this project.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally { $krokSecret.Dispose() }

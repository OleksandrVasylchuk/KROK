$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot '.local'
$secretFile = Join-Path $localDirectory 'google-oauth.dpapi'
$publicFile = Join-Path $localDirectory 'auth-public.json'
Write-Host 'KROK: finish Google sign-in in Supabase' -ForegroundColor Cyan
if (-not (Test-Path $secretFile) -or -not (Test-Path $publicFile)) { throw 'Missing .local\google-oauth.dpapi or .local\auth-public.json on this computer.' }
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
$public = Get-Content -Raw -Encoding UTF8 $publicFile | ConvertFrom-Json
$reference = ([Uri]$public.supabaseUrl).Host.Split('.')[0]
# The client secret is decrypted only in this window and only placed on the clipboard; it is never printed or written to a file.
$client = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secretFile), $null, 'CurrentUser')) | ConvertFrom-Json
if ($client.clientId -notmatch '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$' -or -not $client.clientSecret) { throw 'The saved Google client data has an unexpected format.' }
try {
  Write-Host ''
  Write-Host "Google Cloud: the client must list this Authorized redirect URI:"
  Write-Host "  $($public.supabaseUrl)/auth/v1/callback" -ForegroundColor Yellow
  Write-Host 'Opening Supabase: Authentication > Sign In / Providers > Google ...'
  Start-Process "https://supabase.com/dashboard/project/$reference/auth/providers?provider=Google"
  Write-Host ''
  Write-Host 'Step 1. Turn on "Enable Sign in with Google".'
  [Windows.Forms.Clipboard]::SetText($client.clientId)
  Read-Host 'Step 2. The Client ID is on the clipboard. Paste it into "Client IDs", then press Enter here' | Out-Null
  [Windows.Forms.Clipboard]::SetText($client.clientSecret)
  Read-Host 'Step 3. The Client Secret is on the clipboard. Paste it into "Client Secret (for OAuth)", click Save, then press Enter here' | Out-Null
} finally {
  [Windows.Forms.Clipboard]::Clear()
  $client = $null
}
Write-Host 'Clipboard cleared. Checking the public Supabase settings...'
$settings = Invoke-RestMethod -Uri "$($public.supabaseUrl)/auth/v1/settings" -Headers @{ apikey = $public.publishableKey } -TimeoutSec 15
if ($settings.external.google -ne $true) {
  Write-Host 'Supabase still reports Google as disabled. Check that the provider was saved, then run this file again.' -ForegroundColor Yellow
  exit 1
}
$configuration = @{ supabaseUrl = $public.supabaseUrl; publishableKey = $public.publishableKey; googleEnabled = $true } | ConvertTo-Json
[IO.File]::WriteAllText($publicFile, $configuration, [Text.UTF8Encoding]::new($false))
Write-Host 'Google is enabled in Supabase and in the local KROK settings.' -ForegroundColor Green
Write-Host 'For the public site set KROK_GOOGLE_AUTH=true in Vercel > Settings > Environment Variables and redeploy.'
Write-Host 'While the Google app is in Testing, only accounts added under Audience > Test users can sign in.'

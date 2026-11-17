$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Write-Host 'KROK: connect Supabase accounts' -ForegroundColor Cyan
Write-Host 'Use Project URL and a PUBLISHABLE key. Never enter a secret/service-role key.'
$projectUrl = (Read-Host 'Supabase Project URL (https://...supabase.co)').Trim().TrimEnd('/')
$publicKey = (Read-Host 'Publishable key (sb_publishable_...)').Trim()
$parsedUrl = $null
if (-not [Uri]::TryCreate($projectUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or $parsedUrl.Scheme -ne 'https' -or $parsedUrl.UserInfo -or $parsedUrl.Query -or $parsedUrl.Fragment -or $parsedUrl.AbsolutePath -ne '/') { throw 'Enter only an HTTPS Project URL without a path or credentials.' }
if ($publicKey -notmatch '^sb_publishable_[a-zA-Z0-9_-]{16,200}$') { throw 'Only a publishable key is accepted. Do not use secret, service-role or legacy anon keys.' }
$google = (Read-Host 'Have you enabled and configured Google in Supabase Authentication? (y/N)') -match '^[yY]$'
$localDirectory = Join-Path $projectRoot '.local'
[System.IO.Directory]::CreateDirectory($localDirectory) | Out-Null
$destination = Join-Path $localDirectory 'auth-public.json'
$configuration = @{supabaseUrl=$projectUrl;publishableKey=$publicKey;googleEnabled=$google} | ConvertTo-Json
[System.IO.File]::WriteAllText($destination,$configuration,[System.Text.UTF8Encoding]::new($false))
Write-Host 'Saved public account settings. In KROK open Account and click Check connection.' -ForegroundColor Green
Write-Host 'Google client secret belongs ONLY in Supabase dashboard; no secret is needed by this app.'
Write-Host 'See AUTH_SETUP.md for redirect URLs, email setup and limitations.'

param([ValidateSet('test', 'wasm')][string]$Action = 'test', [switch]$Offline,
    [ValidateSet('reserve', 'adapter')][string]$Contract = 'reserve')
$ErrorActionPreference = 'Stop'
$lenzRoot = Split-Path -Parent $PSScriptRoot
$lenzContract = if ($Contract -eq 'adapter') { 'contracts/adapter' } else { 'contracts' }
$env:CARGO_TARGET_DIR = Join-Path $lenzRoot 'contracts/target'
$env:RUSTUP_HOME = Join-Path $PSScriptRoot '.rustup'
$env:CARGO_HOME = Join-Path $PSScriptRoot '.cargo'
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
$env:CARGO_HTTP_TIMEOUT = '45'
$env:CARGO_NET_RETRY = '1'
$env:CARGO_HTTP_MULTIPLEXING = 'false'
# Documented aws-lc-sys fallback for Windows; objects come from the locked crate.
$env:AWS_LC_SYS_PREBUILT_NASM = '1'
$lenzArgs = @('+1.99.1', 'test', '--manifest-path', (Join-Path $lenzRoot "$lenzContract/Cargo.toml"), '--lib', '--locked')
if ($Action -eq 'wasm') {
    $env:RUSTFLAGS = '--cfg near -C target-feature=-bulk-memory,-reference-types,-multivalue'
    $lenzArgs = @('+1.99.1', 'build', '--manifest-path', (Join-Path $lenzRoot "$lenzContract/Cargo.toml"), '--target', 'wasm32-unknown-unknown', '--release', '--locked')
} else { Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue }
if ($Offline) { $lenzArgs += '--offline' }
$lenzLog = Join-Path $lenzRoot "$lenzContract/$Action-output.txt"
& (Join-Path $env:CARGO_HOME 'bin/cargo.exe') @lenzArgs 2>&1 | Tee-Object -FilePath $lenzLog
$lenzExit = $LASTEXITCODE
$lenzResult = [ordered]@{
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    action = $Action
    exitCode = $lenzExit
    sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $lenzRoot "$lenzContract/src/lib.rs") -Algorithm SHA256).Hash.ToLowerInvariant()
    cargoLockSha256 = (Get-FileHash -LiteralPath (Join-Path $lenzRoot "$lenzContract/Cargo.lock") -Algorithm SHA256).Hash.ToLowerInvariant()
    log = "$Action-output.txt"
    scope = 'Local Rust result only; no deployment or network transaction.'
}
$lenzResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $lenzRoot "$lenzContract/$Action-results.json")
exit $lenzExit

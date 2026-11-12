$ErrorActionPreference = 'Stop'
$lenzRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$env:CARGO_HOME = Join-Path $lenzRoot 'tooling/.cargo'
$env:RUSTUP_HOME = Join-Path $lenzRoot 'tooling/.rustup'
$lenzCargo = Join-Path $env:CARGO_HOME 'bin/cargo.exe'
& $lenzCargo +1.99.1 test --manifest-path (Join-Path $PSScriptRoot 'Cargo.toml') --locked --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $lenzCargo +1.99.1 build --manifest-path (Join-Path $PSScriptRoot 'Cargo.toml') --release --locked --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$lenzBuild = [ordered]@{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); rust = '1.99.1'; librustzcashRevision = 'eb38d7a373661179dbc083a2fd58b3a6c9b25818'; memoInspectionVersion = 1 }
foreach ($lenzEntry in @(@('sourceSha256','src/main.rs'),@('effectsSourceSha256','src/effects.rs'),@('testsSourceSha256','src/synthetic_tests.rs'),@('manifestSha256','Cargo.toml'),@('lockSha256','Cargo.lock'),@('executableSha256','target/release/lenz-zcash-review-inspector.exe'))) {
  $lenzBuild[$lenzEntry[0]] = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $lenzEntry[1]) -Algorithm SHA256).Hash.ToLowerInvariant()
}
$lenzBuild | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'build.json')

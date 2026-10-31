$ErrorActionPreference = 'Stop'
$lenzRoot = Split-Path -Parent $PSScriptRoot
$lenzSource = Join-Path $lenzRoot 'contracts/adapter'
$lenzTarget = Join-Path $lenzRoot 'contracts/target/adapter-mutations'
$env:RUSTUP_HOME = Join-Path $PSScriptRoot '.rustup'
$env:CARGO_HOME = Join-Path $PSScriptRoot '.cargo'
$env:CARGO_TARGET_DIR = Join-Path $lenzRoot 'contracts/target'
$env:AWS_LC_SYS_PREBUILT_NASM = '1'
Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
$lenzOriginal = Get-Content -LiteralPath (Join-Path $lenzSource 'src/lib.rs') -Raw
$lenzCases = @(
    @{name='callback-sender'; old='require!(env::predecessor_account_id() == env::current_account_id(), "Private callback only");'; new=''; test='rejects_external_callback'},
    @{name='swap-signature'; old='verify(&i.owner, &terms, &i.signature);'; new=''; test='every_signed_field_and_configuration_is_bound'},
    @{name='minimum-output'; old='Some(amount) if amount.0 >= o.instruction.min_output.0 =>'; new='Some(amount) =>'; test='ambiguous_withdrawal_or_below_minimum_output_freezes'},
    @{name='redemption-evidence'; old='if consumed == Some(expected)'; new='if consumed.is_some()'; test='recovery_unknown_failed_and_foreign_consumption_remain_unavailable'},
    @{name='recovery-stage'; old='require!(expected.contains(&order.stage), "Unexpected callback stage");'; new=''; test='recovery_never_rewinds_other_stages_even_with_matching_consumption'},
    @{name='recovery-read-only'; old='self.reserve.clone(), "spent_by", json!({"id":input})'; new='self.reserve.clone(), "redeem", json!({"id":input})'; test='recovery_queries_only_the_configured_reserve_without_moving_money'}
)
$lenzResults = @()
foreach ($lenzCase in $lenzCases) {
    if (-not $lenzOriginal.Contains($lenzCase.old)) { throw "Mutation target missing: $($lenzCase.name)" }
    $lenzFolder = Join-Path $lenzTarget $lenzCase.name
    New-Item -ItemType Directory -Force -Path (Join-Path $lenzFolder 'src'),(Join-Path $lenzFolder 'fixtures') | Out-Null
    Copy-Item -LiteralPath (Join-Path $lenzSource 'Cargo.toml'),(Join-Path $lenzSource 'Cargo.lock') -Destination $lenzFolder
    # Distinct package identities prevent Cargo reusing another copied crate's test binary.
    $lenzMutantName = 'lenz-rhea-adapter-mutant-' + $lenzCase.name
    foreach ($lenzManifest in @('Cargo.toml','Cargo.lock')) {
        $lenzManifestPath = Join-Path $lenzFolder $lenzManifest
        $lenzManifestText = (Get-Content -LiteralPath $lenzManifestPath -Raw).Replace('name = "lenz-rhea-adapter"', ('name = "' + $lenzMutantName + '"'))
        Set-Content -LiteralPath $lenzManifestPath -Value $lenzManifestText
    }
    Copy-Item -LiteralPath (Join-Path $lenzSource 'src/tests.rs') -Destination (Join-Path $lenzFolder 'src/tests.rs')
    Copy-Item -LiteralPath (Join-Path $lenzSource 'fixtures/browser-swap.json') -Destination (Join-Path $lenzFolder 'fixtures/browser-swap.json')
    Set-Content -LiteralPath (Join-Path $lenzFolder 'src/lib.rs') -Value $lenzOriginal.Replace($lenzCase.old,$lenzCase.new)
    $lenzOutput = & (Join-Path $env:CARGO_HOME 'bin/cargo.exe') +1.99.1 test --manifest-path (Join-Path $lenzFolder 'Cargo.toml') --lib --locked --offline $lenzCase.test 2>&1
    $lenzExit = $LASTEXITCODE
    $lenzOutput | Set-Content -LiteralPath (Join-Path $lenzFolder 'output.txt')
    $lenzCaught = $lenzExit -ne 0 -and (($lenzOutput -join "`n") -match 'test result: FAILED')
    $lenzResults += @{name=$lenzCase.name;detected=$lenzCaught;exitCode=$lenzExit}
    Write-Output "$($lenzCase.name): detected=$lenzCaught"
    if (-not $lenzCaught) { throw "Mutation survived or did not execute: $($lenzCase.name)" }
}
@{checkedAt=(Get-Date).ToUniversalTime().ToString('o');detected=$lenzResults.Count;cases=$lenzResults;scope='Targeted guard removals in disposable crate copies; not a security audit.'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $lenzSource 'mutation-results.json')

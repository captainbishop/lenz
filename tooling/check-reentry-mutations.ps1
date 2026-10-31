$ErrorActionPreference = 'Stop'
$lenzRoot = Split-Path -Parent $PSScriptRoot
$lenzSource = Join-Path $lenzRoot 'contracts'
$env:RUSTUP_HOME = Join-Path $PSScriptRoot '.rustup'
$env:CARGO_HOME = Join-Path $PSScriptRoot '.cargo'
$env:CARGO_TARGET_DIR = Join-Path $lenzRoot 'contracts/target'
$env:AWS_LC_SYS_PREBUILT_NASM = '1'
Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
$lenzOriginal = Get-Content -LiteralPath (Join-Path $lenzSource 'src/lib.rs') -Raw
$lenzStart = $lenzOriginal.IndexOf('pub fn deposit_offline')
if ($lenzStart -lt 0) { throw 'Deposit method missing' }
$lenzCases = @(
    @{name='backing';old='self.token.internal_transfer(&payer, &reserve, amount.0, Some("Lenz offline deposit".into()));';new='';test='deposit_moves_existing_tokens_and_retry_after_spend_never_revives_value'},
    @{name='authorization';old='verify(&owner, &terms, &signature);';new='';test='deposit_signature_binds_payer_source_owner_amount_and_reserve'},
    @{name='idempotence';old='if let Some(existing) = self.roots.get(&id) {';new='if false { let existing = self.roots.get(&id).unwrap();';test='deposit_moves_existing_tokens_and_retry_after_spend_never_revives_value'}
)
$lenzResults = @()
foreach ($lenzCase in $lenzCases) {
    $lenzFolder = Join-Path $env:CARGO_TARGET_DIR ('reentry-mutations/' + $lenzCase.name)
    New-Item -ItemType Directory -Force -Path (Join-Path $lenzFolder 'src'),(Join-Path $lenzFolder 'fixtures') | Out-Null
    foreach ($lenzFile in @('Cargo.toml','Cargo.lock')) {
        $lenzContent = (Get-Content -LiteralPath (Join-Path $lenzSource $lenzFile) -Raw).Replace('name = "lenz-test-dollar"', ('name = "lenz-deposit-mutant-' + $lenzCase.name + '"'))
        Set-Content -LiteralPath (Join-Path $lenzFolder $lenzFile) -Value $lenzContent
    }
    Copy-Item -LiteralPath (Join-Path $lenzSource 'src/tests.rs') -Destination (Join-Path $lenzFolder 'src/tests.rs')
    foreach ($lenzFixture in @('browser-transfer.json','browser-deposit.json')) { Copy-Item -LiteralPath (Join-Path $lenzSource ('fixtures/' + $lenzFixture)) -Destination (Join-Path $lenzFolder ('fixtures/' + $lenzFixture)) }
    $lenzDeposit = $lenzOriginal.Substring($lenzStart)
    if (-not $lenzDeposit.Contains($lenzCase.old)) { throw 'Mutation target missing' }
    $lenzMutated = $lenzOriginal.Substring(0,$lenzStart) + $lenzDeposit.Replace($lenzCase.old,$lenzCase.new)
    Set-Content -LiteralPath (Join-Path $lenzFolder 'src/lib.rs') -Value $lenzMutated
    $lenzOutput = & (Join-Path $env:CARGO_HOME 'bin/cargo.exe') +1.99.1 test --manifest-path (Join-Path $lenzFolder 'Cargo.toml') --lib --locked --offline $lenzCase.test 2>&1
    $lenzExit = $LASTEXITCODE
    $lenzOutput | Set-Content -LiteralPath (Join-Path $lenzFolder 'output.txt')
    $lenzDetected = $lenzExit -ne 0 -and (($lenzOutput -join "`n") -match 'test result: FAILED')
    $lenzResults += @{name=$lenzCase.name;detected=$lenzDetected;exitCode=$lenzExit}
    Write-Output "$($lenzCase.name): detected=$lenzDetected"
    if (-not $lenzDetected) { throw 'Mutation survived or did not execute' }
}
@{checkedAt=(Get-Date).ToUniversalTime().ToString('o');detected=$lenzResults.Count;cases=$lenzResults;scope='Three targeted guard removals in disposable crate copies; not a security audit.'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $lenzSource 'upgrade/mutation-results.json')

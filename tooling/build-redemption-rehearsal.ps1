$ErrorActionPreference = 'Stop'
$recoveryRoot = Split-Path -Parent $PSScriptRoot
$recoveryEvidence = Join-Path $recoveryRoot 'contracts/adapter/redemption-recovery'
$recoveryCrate = Join-Path $recoveryRoot 'contracts/target/redemption-rehearsal-fixture'
$recoveryOriginal = Get-Content -LiteralPath (Join-Path $recoveryEvidence 'lib-before.rs') -Raw
$recoveryStart = $recoveryOriginal.IndexOf('    #[private]' + "`n" + '    pub fn on_redeem(')
$recoveryEnd = $recoveryOriginal.IndexOf('    #[private]' + "`n" + '    pub fn on_deposit(', $recoveryStart)
if ($recoveryStart -lt 0 -or $recoveryEnd -le $recoveryStart) { throw 'Pinned callback layout changed' }
$recoveryFixture = @'
    // TEST FIXTURE ONLY. Never deploy to a configured product account.
    #[private]
    pub fn on_redeem(&mut self, id: String) -> Order {
        self.callback(&id, &[Stage::Redeeming]);
        env::panic_str("LENZ_REHEARSAL_INJECTED_REDEMPTION_CALLBACK_FAILURE")
    }
    // Recreate an old callback with a real idempotent reserve result, without resetting its stage.
    #[private]
    pub fn rehearsal_replay_redemption(&self, id: String) -> Promise {
        require!(env::current_account_id().as_str().starts_with("lenz-redrec-adapter-"), "Rehearsal account only");
        let o = self.orders.get(&id).expect("Unknown order"); let i = o.instruction;
        Promise::new(self.reserve.clone()).function_call("redeem",
            near_sdk::serde_json::to_vec(&json!({"input":i.input,"receiver_id":env::current_account_id(),
                "nonce":i.nonce,"signature":i.redemption_signature})).unwrap(),
            NearToken::from_millinear(20), Gas::from_tgas(35))
            .then(Promise::new(env::current_account_id()).function_call("on_redeem",
                near_sdk::serde_json::to_vec(&json!({"id":id})).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(25)))
    }
'@
$recoverySource = $recoveryOriginal.Substring(0,$recoveryStart) + $recoveryFixture + "`n" + $recoveryOriginal.Substring($recoveryEnd)
New-Item -ItemType Directory -Force -Path (Join-Path $recoveryCrate 'src') | Out-Null
foreach ($recoveryName in @('Cargo.toml','Cargo.lock')) {
    $recoveryText = (Get-Content -LiteralPath (Join-Path $recoveryRoot "contracts/adapter/$recoveryName") -Raw).Replace('name = "lenz-rhea-adapter"','name = "lenz-redemption-rehearsal-fixture"')
    Set-Content -LiteralPath (Join-Path $recoveryCrate $recoveryName) -Value $recoveryText
}
Set-Content -LiteralPath (Join-Path $recoveryCrate 'src/lib.rs') -Value $recoverySource
Set-Content -LiteralPath (Join-Path $recoveryEvidence 'fault-fixture.rs') -Value $recoverySource
$env:RUSTUP_HOME = Join-Path $PSScriptRoot '.rustup'
$env:CARGO_HOME = Join-Path $PSScriptRoot '.cargo'
$env:CARGO_TARGET_DIR = Join-Path $recoveryRoot 'contracts/target'
$env:RUSTFLAGS = '--cfg near -C target-feature=-bulk-memory,-reference-types,-multivalue'
& (Join-Path $env:CARGO_HOME 'bin/cargo.exe') +1.99.1 build --manifest-path (Join-Path $recoveryCrate 'Cargo.toml') --target wasm32-unknown-unknown --release --locked --offline 2>&1 | Tee-Object -FilePath (Join-Path $recoveryEvidence 'fault-build-output.txt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown/release/lenz_redemption_rehearsal_fixture.wasm') -Destination (Join-Path $recoveryEvidence 'fault-fixture.wasm')
@{checkedAt=(Get-Date).ToUniversalTime().ToString('o');sourceSha256=(Get-FileHash -LiteralPath (Join-Path $recoveryEvidence 'fault-fixture.rs')).Hash.ToLowerInvariant();wasmSha256=(Get-FileHash -LiteralPath (Join-Path $recoveryEvidence 'fault-fixture.wasm')).Hash.ToLowerInvariant();scope='Deliberately broken callback fixture for isolated testnet accounts only.'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $recoveryEvidence 'fault-build.json')

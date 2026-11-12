use pczt::{Pczt, roles::verifier::{Verifier, OrchardError}};
use zcash_keys::{address::Address, keys::UnifiedFullViewingKey};
use zcash_protocol::consensus::TEST_NETWORK;
use sha2::{Digest, Sha256};

// Viewing keys arrive on stdin and are never returned or written to disk.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Terms {
    pub(super) ufvk: String,
    pub(super) recipient: String,
    pub(super) amount: u64,
    pub(super) fee: u64,
}

pub fn verify(bytes: &[u8], terms: Terms) -> Result<serde_json::Value, &'static str> {
    verify_outputs(bytes, terms).map(|(effects, _, _)| effects)
}

pub fn verify_memos(bytes: &[u8], terms: Terms) -> Result<serde_json::Value, &'static str> {
    let (mut effects, recipient_memo, change_memo) = verify_outputs(bytes, terms)?;
    let result = effects.as_object_mut().ok_or("Missing review result")?;
    result.insert("pcztSha256".into(), serde_json::json!(format!("{:x}", Sha256::digest(bytes))));
    result.insert("memos".into(), serde_json::json!({
        "recipient": { "hex": memo_hex(&recipient_memo) },
        "change": { "hex": memo_hex(&change_memo) },
    }));
    Ok(effects)
}

fn memo_hex(memo: &[u8; 512]) -> String {
    memo.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn verify_outputs(bytes: &[u8], terms: Terms) -> Result<(serde_json::Value, [u8; 512], [u8; 512]), &'static str> {
    if terms.amount == 0 || terms.amount > 10_000_000 || terms.fee == 0 || terms.fee > 10_000 {
        return Err("Review amount or fee exceeds test bounds");
    }
    let transaction = Pczt::parse(bytes).map_err(|_| "Invalid transaction file")?;
    if *transaction.global().tx_version() != 6 || transaction.ironwood().actions().len() != 2
        || !transaction.orchard().actions().is_empty()
        || transaction.orchard().value_sum().0 != 0 || *transaction.sapling().value_sum() != 0
        || !transaction.sapling().spends().is_empty() || !transaction.sapling().outputs().is_empty()
        || !transaction.transparent().inputs().is_empty() || !transaction.transparent().outputs().is_empty()
    { return Err("Expected an unsigned two-action Ironwood test payment"); }
    let ufvk = UnifiedFullViewingKey::decode(&TEST_NETWORK, &terms.ufvk).map_err(|_| "Invalid testnet viewing key")?;
    let fvk = ufvk.orchard().ok_or("Missing wallet viewing component")?;
    let recipient = match Address::decode(&TEST_NETWORK, &terms.recipient) {
        Some(Address::Unified(ua)) => ua.orchard().copied(),
        _ => None,
    }.ok_or("Expected a testnet shielded recipient")?;
    if fvk.scope_for_address(&recipient).is_some() { return Err("Recipient must be the other test wallet"); }
    let mut verified = None;
    Verifier::new(transaction).with_ironwood::<&'static str, _>(|bundle| {
        let check = || -> Result<(u64, u64, [u8; 512], [u8; 512]), &'static str> {
            if !bundle.flags().spends_enabled() || !bundle.flags().outputs_enabled() { return Err("Payment inputs or outputs are disabled"); }
            bundle.verify_cross_address_restriction().map_err(|_| "Invalid cross-address binding")?;
            let (mut spent, mut paid, mut change, mut inputs, mut recipients, mut changes) = (0u64, 0u64, 0u64, 0, 0, 0);
            let (mut recipient_memo, mut change_memo) = (None, None);
            for action in bundle.actions() {
                action.verify_cv_net().map_err(|_| "Invalid value commitment")?;
                action.spend().verify_nullifier(Some(fvk)).map_err(|_| "Input does not match wallet viewing key")?;
                action.spend().verify_rk(Some(fvk)).map_err(|_| "Invalid spend key binding")?;
                action.output().verify_note_commitment(action.spend()).map_err(|_| "Invalid output commitment")?;
                let value = action.spend().value().ok_or("Missing input value")?.inner();
                // The I/O finalizer signs zero-value dummy spends during creation.
                // A real spend signature would cross this unsigned-review boundary.
                if !unsigned_real_spend(value, action.spend().spend_auth_sig().is_some()) { return Err("Real input is already signed"); }
                if value > 0 { inputs += 1; }
                spent = spent.checked_add(value).ok_or("Input overflow")?;
                let output = action.output();
                let value = output.value().ok_or("Missing output value")?.inner();
                let address = output.recipient().as_ref().ok_or("Missing output recipient")?;
                // The native creator recovers payments with the external OVK, while
                // internal change deliberately has no outgoing recovery channel.
                let recovered = if address == &recipient {
                    action.recover_output_with_ovk(&fvk.to_ovk(zip32::Scope::External), *bundle.bundle_version())
                } else {
                    action.decrypt_output_with_ivk(&fvk.to_ivk(zip32::Scope::Internal).prepare(), *bundle.bundle_version())
                }.map_err(|_| "Unsupported note encryption domain")?
                    .ok_or("Output note encryption could not be verified")?;
                if recovered.1 != *address || recovered.0.value().inner() != value {
                    return Err("Encrypted output differs from committed terms");
                }
                if address == &recipient {
                    recipients += 1; paid = paid.checked_add(value).ok_or("Output overflow")?;
                    recipient_memo = Some(recovered.2);
                } else {
                    if fvk.scope_for_address(address) != Some(zip32::Scope::Internal) { return Err("Change is not owned by the sending wallet"); }
                    changes += 1; change = change.checked_add(value).ok_or("Change overflow")?;
                    change_memo = Some(recovered.2);
                }
            }
            if inputs != 1 || recipients != 1 || changes != 1 || change == 0 { return Err("Expected one real input, recipient and owned change"); }
            if paid != terms.amount { return Err("Recipient amount differs from review"); }
            let fee = spent.checked_sub(paid).and_then(|n| n.checked_sub(change)).ok_or("Value does not conserve")?;
            if fee != terms.fee { return Err("Fee differs from review"); }
            if i64::try_from(*bundle.value_sum()).ok() != Some(fee as i64) { return Err("Bundle balance differs from fee"); }
            Ok((spent, change, recipient_memo.ok_or("Missing recipient memo")?, change_memo.ok_or("Missing change memo")?))
        };
        verified = Some(check().map_err(OrchardError::Custom)?); Ok(())
    }).map_err(|e| match e { OrchardError::Custom(reason) => reason, _ => "Invalid Ironwood bundle" })?;
    let (spent, change, recipient_memo, change_memo) = verified.ok_or("Missing review result")?;
    Ok((serde_json::json!({"status":"verified", "version":6, "pool":"ironwood",
        "amount":terms.amount.to_string(), "fee":terms.fee.to_string(), "change":change.to_string(),
        "inputValue":spent.to_string(), "recipient":terms.recipient,
        "changeOwned":true, "commitmentsVerified":true, "noteEncryptionVerified":true, "canSign":false, "canSend":false}), recipient_memo, change_memo))
}

fn unsigned_real_spend(value: u64, has_signature: bool) -> bool {
    value == 0 || !has_signature
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_and_out_of_bounds_terms_fail_closed() {
        for (amount, fee) in [(0, 10_000), (10_000_001, 10_000), (1, 0), (1, 10_001), (1, 1)] {
            assert!(verify(b"invalid", Terms { ufvk: String::new(), recipient: String::new(), amount, fee }).is_err());
        }
        assert!(serde_json::from_str::<Terms>(r#"{"ufvk":"x","recipient":"x","amount":1,"fee":1,"sign":true}"#).is_err());
    }
    #[test]
    fn dummy_signatures_do_not_authorize_real_value() {
        assert!(unsigned_real_spend(0, true));
        assert!(unsigned_real_spend(1, false));
        assert!(!unsigned_real_spend(1, true));
    }
}

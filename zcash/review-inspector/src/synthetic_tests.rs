use super::effects::{verify, verify_memos, Terms};
use orchard::{
    builder::{Builder, BundleType}, bundle::BundleVersion, keys::Scope,
    note::{NoteVersion, RandomSeed, Rho}, tree::{MerkleHashOrchard, MerklePath},
    value::NoteValue, Note,
};
use pczt::roles::{creator::Creator, io_finalizer::IoFinalizer};
use rand::{SeedableRng, rngs::StdRng};
use zcash_keys::{address::{Address, UnifiedAddress}, keys::UnifiedSpendingKey};
use zcash_primitives::transaction::{builder::PcztParts, TxVersion};
use zcash_protocol::consensus::{BranchId, TEST_NETWORK};

struct Fixture { bytes: Vec<u8>, terms: Terms, recipient_index: usize, change_index: usize }

fn fixture() -> Fixture {
    fixture_with_memos([0; 512], [0; 512])
}

fn fixture_with_memos(recipient_memo: [u8; 512], change_memo: [u8; 512]) -> Fixture {
    // Public test seeds generate disposable in-memory keys; no wallet is opened.
    let sender = UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[0; 32], zip32::AccountId::ZERO).unwrap();
    let other = UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[1; 32], zip32::AccountId::ZERO).unwrap();
    let ufvk = sender.to_unified_full_viewing_key();
    let fvk = ufvk.orchard().unwrap();
    let recipient = other.to_unified_full_viewing_key().orchard().unwrap().address_at(0u32, Scope::External);
    let address = Address::Unified(Box::new(UnifiedAddress::from_receivers(Some(recipient), None, None, None).unwrap())).encode(&TEST_NETWORK);
    let rho = Rho::from_bytes(&[0; 32]).unwrap();
    let rseed = (0u8..).find_map(|i| RandomSeed::from_bytes([i; 32], &rho).into_option()).unwrap();
    let note = Note::from_parts(fvk.address_at(0u32, Scope::External), NoteValue::from_raw(100_000_000), rho, rseed, NoteVersion::V3).unwrap();
    let path = MerklePath::from_parts(0, [MerkleHashOrchard::from_bytes(&[0; 32]).unwrap(); 32]);
    let anchor = path.root(note.commitment().into());
    let version = BundleVersion::ironwood_v3();
    let mut builder = Builder::new(BundleType::DEFAULT, version, version.default_flags(), anchor).unwrap();
    builder.add_spend(fvk.clone(), note, path).unwrap();
    builder.add_output(Some(fvk.to_ovk(Scope::External)), recipient, NoteValue::from_raw(1_000_000), recipient_memo).unwrap();
    builder.add_output(None, fvk.address_at(0u32, Scope::Internal), NoteValue::from_raw(98_990_000), change_memo).unwrap();
    let mut rng = StdRng::from_seed([2; 32]);
    let (bundle, meta) = builder.build_for_pczt(&mut rng).unwrap();
    let recipient_index = meta.output_action_index(0).unwrap();
    let change_index = meta.output_action_index(1).unwrap();
    let parts = PcztParts { params: TEST_NETWORK, version: TxVersion::V6, consensus_branch_id: BranchId::Nu6_3,
        lock_time: 0, expiry_height: 4_800_040.into(), transparent: None, sapling: None, orchard: None, ironwood: Some(bundle) };
    let pczt = IoFinalizer::new(Creator::build_from_parts(parts).unwrap()).finalize_io(rng).unwrap();
    Fixture { bytes: pczt::v2::Pczt::try_from(pczt).unwrap().serialize(), terms: Terms {
        ufvk: ufvk.encode(&TEST_NETWORK).unwrap(), recipient: address, amount: 1_000_000, fee: 10_000,
    }, recipient_index, change_index }
}

fn corrupt_output(f: &Fixture, index: usize, field: &str) -> Vec<u8> {
    let pczt = pczt::Pczt::parse(&f.bytes).unwrap();
    let output = pczt.ironwood().actions()[index].output();
    let needle = match field {
        "ephemeral_key" => output.ephemeral_key().to_vec(),
        "enc_ciphertext" | "memo_ciphertext" | "memo_tag" => output.enc_ciphertext().clone().into_encrypted().unwrap(),
        "out_ciphertext" => output.out_ciphertext().clone(),
        _ => panic!("unknown test field"),
    };
    let offsets: Vec<_> = f.bytes.windows(needle.len()).enumerate().filter(|(_, bytes)| *bytes == needle.as_slice()).map(|(i, _)| i).collect();
    assert_eq!(offsets.len(), 1, "mutate exactly one serialized field");
    let mut bytes = f.bytes.clone();
    let within_field = match field { "memo_ciphertext" => 52, "memo_tag" => needle.len() - 1, _ => 0 };
    bytes[offsets[0] + within_field] ^= 1;
    // The control remains a well-formed PCZT with identical committed terms.
    pczt::Pczt::parse(&bytes).unwrap(); bytes
}

#[test]
fn synthetic_native_review_verifies_recoverable_recipient_and_owned_change() {
    let f = fixture(); let result = verify(&f.bytes, f.terms).unwrap();
    assert_eq!(result["noteEncryptionVerified"], true);
    assert_eq!(result["amount"], "1000000"); assert_eq!(result["change"], "98990000");
    assert_eq!(result["canSign"], false); assert_eq!(result["canSend"], false);
    let fields: std::collections::BTreeSet<_> = result.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(fields, ["status", "version", "pool", "amount", "fee", "change", "inputValue", "recipient",
        "changeOwned", "commitmentsVerified", "noteEncryptionVerified", "canSign", "canSend"].into_iter().collect());
}

#[test]
fn exact_memo_review_returns_only_authenticated_recipient_and_change_bytes() {
    let mut recipient_memo = [0; 512]; recipient_memo[..5].copy_from_slice(b"hello");
    let mut change_memo = [0; 512]; change_memo[0] = 0xf6;
    let f = fixture_with_memos(recipient_memo, change_memo);
    let result = verify_memos(&f.bytes, f.terms).unwrap();
    // Independently hashed serialized public fixture; test randomness is fixed.
    assert_eq!(result["pcztSha256"], "fa2b8f98425e8f42cd5475cd0a38df4fc9e91f85320ae4f2e22e1622a9ed700e");
    assert_eq!(result["memos"]["recipient"]["hex"], format!("68656c6c6f{}", "00".repeat(507)));
    assert_eq!(result["memos"]["change"]["hex"], format!("f6{}", "00".repeat(511)));
    assert_eq!(result["canSign"], false); assert_eq!(result["canSend"], false);
    let fields: std::collections::BTreeSet<_> = result.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(fields, ["status", "version", "pool", "amount", "fee", "change", "inputValue", "recipient",
        "changeOwned", "commitmentsVerified", "noteEncryptionVerified", "canSign", "canSend", "pcztSha256", "memos"].into_iter().collect());
    let roles: std::collections::BTreeSet<_> = result["memos"].as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(roles, ["recipient", "change"].into_iter().collect());
    for role in ["recipient", "change"] {
        let fields: Vec<_> = result["memos"][role].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(fields, ["hex"]);
    }
}

#[test]
fn valid_changed_memo_padding_changes_exact_review_without_changing_payment_terms() {
    let original = fixture(); let original_bytes = original.bytes.clone();
    let original = verify_memos(&original.bytes, original.terms).unwrap();
    for role in ["recipient", "change"] {
        let mut changed = [0; 512]; changed[511] = 1;
        let f = if role == "recipient" { fixture_with_memos(changed, [0; 512]) } else { fixture_with_memos([0; 512], changed) };
        assert_ne!(f.bytes, original_bytes);
        let revised = verify_memos(&f.bytes, f.terms).unwrap();
        for field in ["amount", "fee", "change", "inputValue", "recipient"] {
            assert_eq!(revised[field], original[field]);
        }
        assert_ne!(revised["pcztSha256"], original["pcztSha256"]);
        assert_eq!(revised["memos"][role]["hex"], format!("{}01", "00".repeat(511)));
        let other_role = if role == "recipient" { "change" } else { "recipient" };
        assert_eq!(revised["memos"][other_role], original["memos"][other_role]);
    }
}

#[test]
fn memo_ciphertext_and_authentication_tag_corruption_cannot_return_a_partial_memo_review() {
    for role in ["recipient", "change"] {
        for field in ["memo_ciphertext", "memo_tag"] {
            let f = fixture();
            let index = if role == "recipient" { f.recipient_index } else { f.change_index };
            let bytes = corrupt_output(&f, index, field);
            assert!(verify_memos(&bytes, f.terms).is_err(), "corrupt authenticated memo must fail closed");
        }
    }
}

#[test]
fn corrupt_recipient_ciphertexts_and_key_cannot_pass_committed_term_review() {
    for field in ["ephemeral_key", "enc_ciphertext", "out_ciphertext"] {
        let f = fixture(); let bytes = corrupt_output(&f, f.recipient_index, field);
        assert!(verify(&bytes, f.terms).is_err(), "recipient {field} must fail");
    }
}

#[test]
fn corrupt_change_ciphertext_or_key_cannot_pass_owned_change_review() {
    for field in ["ephemeral_key", "enc_ciphertext"] {
        let f = fixture(); let bytes = corrupt_output(&f, f.change_index, field);
        assert!(verify(&bytes, f.terms).is_err(), "change {field} must fail");
    }
}

#[test]
fn synthetic_native_review_rejects_foreign_key_recipient_and_amount() {
    for verify in [verify, verify_memos] {
        let mut f = fixture(); f.terms.amount = 1;
        assert!(verify(&f.bytes, f.terms).is_err());
        let mut f = fixture(); f.terms.fee = 1;
        assert!(verify(&f.bytes, f.terms).is_err());
        let mut f = fixture();
        let other = UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[2; 32], zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
        f.terms.ufvk = other.encode(&TEST_NETWORK).unwrap();
        assert!(verify(&f.bytes, f.terms).is_err());
        let mut f = fixture();
        let recipient = other.orchard().unwrap().address_at(0u32, Scope::External);
        f.terms.recipient = Address::Unified(Box::new(UnifiedAddress::from_receivers(Some(recipient), None, None, None).unwrap())).encode(&TEST_NETWORK);
        assert!(verify(&f.bytes, f.terms).is_err());
    }
}

#[test]
fn missing_role_unsupported_domain_and_signature_marker_cannot_return_memos() {
    for fault in ["missing_recipient", "missing_change", "unsupported_domain", "signature_marker"] {
        let f = fixture();
        let pczt = pczt::v2::Pczt::try_from(pczt::Pczt::parse(&f.bytes).unwrap()).unwrap();
        let mut encoded = serde_json::to_value(pczt).unwrap();
        match fault {
            "missing_recipient" => encoded["ironwood"]["actions"][f.recipient_index]["output"]["recipient"] = serde_json::Value::Null,
            "missing_change" => encoded["ironwood"]["actions"][f.change_index]["output"]["recipient"] = serde_json::Value::Null,
            "unsupported_domain" => encoded["ironwood"]["note_version"] = serde_json::json!("V2"),
            "signature_marker" => {
                let real_input = encoded["ironwood"]["actions"].as_array_mut().unwrap().iter_mut()
                    .find(|action| action["spend"]["value"].as_u64().unwrap() > 0).unwrap();
                // Inject invalid bytes; this test never performs a signing operation.
                real_input["spend"]["spend_auth_sig"] = serde_json::json!(vec![0u8; 64]);
            }
            _ => unreachable!(),
        }
        let revised: pczt::v2::Pczt = serde_json::from_value(encoded).unwrap();
        let bytes = revised.serialize();
        pczt::Pczt::parse(&bytes).unwrap();
        assert!(verify_memos(&bytes, f.terms).is_err(), "incomplete or authorized transaction must fail closed");
    }
}

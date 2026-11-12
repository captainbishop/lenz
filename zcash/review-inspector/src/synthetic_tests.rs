use super::effects::{verify, Terms};
use orchard::{
    builder::{Builder, BundleType}, bundle::BundleVersion, keys::Scope,
    note::{NoteVersion, RandomSeed, Rho}, tree::{MerkleHashOrchard, MerklePath},
    value::NoteValue, Note,
};
use pczt::roles::{creator::Creator, io_finalizer::IoFinalizer};
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use zcash_keys::{address::{Address, UnifiedAddress}, keys::UnifiedSpendingKey};
use zcash_primitives::transaction::{builder::PcztParts, TxVersion};
use zcash_protocol::consensus::{BranchId, TEST_NETWORK};

struct Fixture { bytes: Vec<u8>, terms: Terms, recipient_index: usize, change_index: usize }

fn fixture() -> Fixture {
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
    builder.add_output(Some(fvk.to_ovk(Scope::External)), recipient, NoteValue::from_raw(1_000_000), [0; 512]).unwrap();
    builder.add_output(None, fvk.address_at(0u32, Scope::Internal), NoteValue::from_raw(98_990_000), [0; 512]).unwrap();
    let (bundle, meta) = builder.build_for_pczt(&mut UnwrapErr(SysRng)).unwrap();
    let recipient_index = meta.output_action_index(0).unwrap();
    let change_index = meta.output_action_index(1).unwrap();
    let parts = PcztParts { params: TEST_NETWORK, version: TxVersion::V6, consensus_branch_id: BranchId::Nu6_3,
        lock_time: 0, expiry_height: 4_800_040.into(), transparent: None, sapling: None, orchard: None, ironwood: Some(bundle) };
    let pczt = IoFinalizer::new(Creator::build_from_parts(parts).unwrap()).finalize_io(UnwrapErr(SysRng)).unwrap();
    Fixture { bytes: pczt::v2::Pczt::try_from(pczt).unwrap().serialize(), terms: Terms {
        ufvk: ufvk.encode(&TEST_NETWORK).unwrap(), recipient: address, amount: 1_000_000, fee: 10_000,
    }, recipient_index, change_index }
}

fn corrupt_output(f: &Fixture, index: usize, field: &str) -> Vec<u8> {
    let pczt = pczt::Pczt::parse(&f.bytes).unwrap();
    let output = pczt.ironwood().actions()[index].output();
    let needle = match field {
        "ephemeral_key" => output.ephemeral_key().to_vec(),
        "enc_ciphertext" => output.enc_ciphertext().clone().into_encrypted().unwrap(),
        "out_ciphertext" => output.out_ciphertext().clone(),
        _ => panic!("unknown test field"),
    };
    let offsets: Vec<_> = f.bytes.windows(needle.len()).enumerate().filter(|(_, bytes)| *bytes == needle.as_slice()).map(|(i, _)| i).collect();
    assert_eq!(offsets.len(), 1, "mutate exactly one serialized field");
    let mut bytes = f.bytes.clone(); bytes[offsets[0]] ^= 1;
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

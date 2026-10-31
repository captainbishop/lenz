use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env};
use p256::ecdsa::{SigningKey, signature::Signer, Signature};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn context(who: &str) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("reserve.lenz.testnet".parse().unwrap()).predecessor_account_id(who.parse().unwrap())
        .attached_deposit(NearToken::from_near(1)).block_height(100);
    testing_env!(b.build());
}
fn identity(n: u8) -> (SigningKey, String) {
    let k = SigningKey::from_bytes((&[n; 32]).into()).unwrap();
    let owner = hex::encode(k.verifying_key().to_encoded_point(true).as_bytes()); (k, owner)
}
fn sign(k: &SigningKey, terms: &[&str]) -> String {
    let s: Signature = k.sign(&near_sdk::serde_json::to_vec(terms).unwrap()); hex::encode(s.to_bytes())
}
fn fund(c: &mut Lenz, k: &SigningKey, owner: &str) -> Note {
    let n = "01".repeat(16);
    c.fund_test(owner.into(), U128(100_000_000), n.clone(),
        sign(k, &[FUND, "testnet", "reserve.lenz.testnet", owner, "100000000", &n]))
}
fn spend(k: &SigningKey, input: &str, recipient: &str, amount: u128, n: u8) -> Spend {
    let nonce = format!("{n:032x}");
    Spend { input: input.into(), recipient: recipient.into(), amount: U128(amount), nonce: nonce.clone(),
        signature: sign(k, &[TRANSFER, "testnet", "reserve.lenz.testnet", input, recipient, &amount.to_string(), &nonce]) }
}
#[test]
fn offline_onward_settlement_replay_and_redemption_conserve_reserve() {
    context("relay.testnet"); let mut c = Lenz::new();
    let (a, pa) = identity(1); let (b, pb) = identity(2); let (d, pd) = identity(3);
    let root = fund(&mut c, &a, &pa);
    assert_eq!(c.ft_total_supply().0, 100_000_000);
    let first = spend(&a, &root.id, &pb, 20_000_000, 1);
    let r = c.settle(vec![first.clone()]);
    let second = spend(&b, &r[0].outputs[0].id, &pd, 8_000_000, 2);
    let path = vec![first, second];
    let r = c.settle(path.clone()); let again = c.settle(path);
    assert_eq!(r[1].outputs, again[1].outputs);
    assert_eq!(c.reserved_balance().0, 100_000_000);
    c.storage_deposit(Some("recipient.testnet".parse().unwrap()), Some(true));
    let id = &r[1].outputs[0].id; let n = "02".repeat(16);
    let signature = sign(&d, &[REDEEM, "testnet", "reserve.lenz.testnet", id, "recipient.testnet", &n]);
    c.redeem(id.clone(), "recipient.testnet".parse().unwrap(), n.clone(), signature.clone());
    c.redeem(id.clone(), "recipient.testnet".parse().unwrap(), n, signature);
    assert_eq!(c.ft_balance_of("recipient.testnet".parse().unwrap()).0, 8_000_000);
    assert_eq!(c.reserved_balance().0, 92_000_000);
    assert_eq!(c.ft_balance_of("reserve.lenz.testnet".parse().unwrap()).0, 92_000_000);
}
#[test]
#[should_panic(expected = "Conflicting spend")]
fn rejects_competing_spend() {
    context("relay.testnet"); let mut c = Lenz::new(); let (a, pa) = identity(1); let (_, pb) = identity(2);
    let root = fund(&mut c, &a, &pa); c.settle(vec![spend(&a, &root.id, &pb, 20, 1)]);
    c.settle(vec![spend(&a, &root.id, &pb, 30, 2)]);
}
#[test]
#[should_panic(expected = "Signature rejected")]
fn rejects_changed_recipient() {
    context("relay.testnet"); let mut c = Lenz::new(); let (a, pa) = identity(1); let (_, pb) = identity(2);
    let root = fund(&mut c, &a, &pa); let mut s = spend(&a, &root.id, &pb, 20, 1); s.recipient = pa;
    c.settle(vec![s]);
}
#[test]
#[should_panic(expected = "Insufficient reserve")]
fn rejects_inflation() {
    context("relay.testnet"); let mut c = Lenz::new(); let (a, pa) = identity(1); let (_, pb) = identity(2);
    let root = fund(&mut c, &a, &pa); c.settle(vec![spend(&a, &root.id, &pb, 100_000_001, 1)]);
}
#[test]
#[should_panic(expected = "already claimed")]
fn rejects_repeated_grant() {
    context("relay.testnet"); let mut c = Lenz::new(); let (a, pa) = identity(1); fund(&mut c, &a, &pa); fund(&mut c, &a, &pa);
}
#[test]
#[should_panic(expected = "Attach enough")]
fn charges_storage_to_submitter() {
    context("relay.testnet"); let mut c = Lenz::new();
    let mut b = VMContextBuilder::new(); b.current_account_id("reserve.lenz.testnet".parse().unwrap()); testing_env!(b.build());
    let (a, pa) = identity(1); fund(&mut c, &a, &pa);
}
#[test]
fn verifies_browser_signatures_and_matches_browser_output_ids() {
    context("relay.testnet"); let mut c = Lenz::new();
    let fixture: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!("../fixtures/browser-transfer.json")).unwrap();
    let f = &fixture["funding"];
    let root = c.fund_test(f["owner"].as_str().unwrap().into(), U128(f["amount"].as_str().unwrap().parse().unwrap()),
        f["nonce"].as_str().unwrap().into(), f["signature"].as_str().unwrap().into());
    assert_eq!(root.id, fixture["root"]["id"].as_str().unwrap());
    let path: Vec<Spend> = near_sdk::serde_json::from_value(fixture["path"].clone()).unwrap();
    let result = c.settle(path);
    for (i, receipt) in result.iter().enumerate() { assert_eq!(receipt.id, fixture["ids"][i].as_str().unwrap()); }
    assert_eq!(result[1].outputs[0].amount.0, 8_000_000);
}

fn liquid_balance() -> (Lenz, SigningKey, String, Note) {
    context("payer.testnet"); let mut c = Lenz::new(); let (k, owner) = identity(1);
    let root = fund(&mut c, &k, &owner);
    c.storage_deposit(Some("payer.testnet".parse().unwrap()), Some(true));
    let n = "03".repeat(16);
    c.redeem(root.id.clone(), "payer.testnet".parse().unwrap(), n.clone(),
        sign(&k, &[REDEEM, "testnet", "reserve.lenz.testnet", &root.id, "payer.testnet", &n]));
    (c, k, owner, root)
}
fn deposit_sign(k: &SigningKey, payer: &str, owner: &str, value: u128, source: &str) -> String {
    sign(k, &[DEPOSIT, "testnet", "reserve.lenz.testnet", payer, source, owner, &value.to_string()])
}
#[test]
fn deposit_moves_existing_tokens_and_retry_after_spend_never_revives_value() {
    let (mut c, k, owner, old) = liquid_balance(); let source = "ab".repeat(32);
    let sig = deposit_sign(&k, "payer.testnet", &owner, 40_000_000, &source);
    let root = c.deposit_offline(owner.clone(), U128(40_000_000), source.clone(), sig.clone());
    assert_ne!(root.id, old.id); assert!(c.spent_by(old.id).is_some());
    assert_eq!(c.ft_total_supply().0, 100_000_000);
    assert_eq!(c.ft_balance_of("payer.testnet".parse().unwrap()).0, 60_000_000);
    assert_eq!(c.reserved_balance().0, 40_000_000);
    assert_eq!(c.ft_balance_of("reserve.lenz.testnet".parse().unwrap()).0, 40_000_000);
    c.settle(vec![spend(&k, &root.id, &owner, 40_000_000, 9)]);
    let consumed = c.spent_by(root.id.clone());
    assert_eq!(c.deposit_offline(owner, U128(40_000_000), source, sig), root);
    assert_eq!(c.spent_by(root.id), consumed);
    assert_eq!(c.reserved_balance().0, 40_000_000);
    assert_eq!(c.ft_balance_of("payer.testnet".parse().unwrap()).0, 60_000_000);
}
#[test]
fn deposit_signature_binds_payer_source_owner_amount_and_reserve() {
    let (mut c, k, owner, _) = liquid_balance(); let source = "ab".repeat(32);
    for field in 0..5 {
        context("payer.testnet");
        let mut terms = vec![DEPOSIT, "testnet", "reserve.lenz.testnet", "payer.testnet", &source, &owner, "100"];
        terms[[1,2,3,4,6][field]] = "different";
        let bad = sign(&k, &terms);
        assert!(catch_unwind(AssertUnwindSafe(|| c.deposit_offline(owner.clone(), U128(100), source.clone(), bad))).is_err());
    }
    let (_, other) = identity(2); let sig = deposit_sign(&k, "payer.testnet", &owner, 100, &source);
    assert!(catch_unwind(AssertUnwindSafe(|| c.deposit_offline(other, U128(100), source, sig))).is_err());
    assert_eq!(c.reserved_balance().0, 0);
}
#[test]
#[should_panic(expected = "Deposit source already used")]
fn same_source_cannot_change_amount_even_with_valid_signature() {
    let (mut c, k, owner, _) = liquid_balance(); let s = "ab".repeat(32);
    c.deposit_offline(owner.clone(), U128(100), s.clone(), deposit_sign(&k,"payer.testnet",&owner,100,&s));
    c.deposit_offline(owner.clone(), U128(200), s.clone(), deposit_sign(&k,"payer.testnet",&owner,200,&s));
}
#[test]
#[should_panic(expected = "Deposit source already used")]
fn same_source_cannot_change_owner_even_with_valid_signature() {
    let (mut c, k, owner, _) = liquid_balance(); let s = "ab".repeat(32);
    c.deposit_offline(owner.clone(), U128(100), s.clone(), deposit_sign(&k,"payer.testnet",&owner,100,&s));
    let (other, pk) = identity(2);
    c.deposit_offline(pk.clone(), U128(100), s.clone(), deposit_sign(&other,"payer.testnet",&pk,100,&s));
}
#[test]
#[should_panic(expected = "The account doesn't have enough balance")]
fn deposit_cannot_create_unbacked_notes() {
    let (mut c, k, owner, _) = liquid_balance(); let s = "ab".repeat(32);
    c.deposit_offline(owner.clone(), U128(100_000_001), s.clone(), deposit_sign(&k,"payer.testnet",&owner,100_000_001,&s));
}
#[test]
#[should_panic(expected = "Attach NEAR")]
fn deposit_rejects_zero_attached_deposit() {
    let (mut c, k, owner, _) = liquid_balance(); let s = "ab".repeat(32);
    let mut b = VMContextBuilder::new(); b.current_account_id("reserve.lenz.testnet".parse().unwrap()).predecessor_account_id("payer.testnet".parse().unwrap());testing_env!(b.build());
    c.deposit_offline(owner.clone(), U128(100), s.clone(), deposit_sign(&k,"payer.testnet",&owner,100,&s));
}
#[test]
fn existing_serialized_state_roundtrips_with_notes_balances_and_consumption() {
    let (c, _, _, root) = liquid_balance();
    let state = near_sdk::borsh::to_vec(&c).unwrap();
    let restored: Lenz = near_sdk::borsh::from_slice(&state).unwrap();
    assert_eq!(restored.get_root(root.id.clone()), Some(root.clone()));
    assert_eq!(restored.spent_by(root.id.clone()), c.spent_by(root.id));
    assert_eq!(restored.ft_total_supply(), c.ft_total_supply());
    assert_eq!(restored.ft_balance_of("payer.testnet".parse().unwrap()), c.ft_balance_of("payer.testnet".parse().unwrap()));
}

#[test]
fn verifies_actual_edge_deposit_signature_and_root_id() {
    let (mut c, _, _, _) = liquid_balance();
    let r: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!("../fixtures/browser-deposit.json")).unwrap();
    let note = c.deposit_offline(r["owner"].as_str().unwrap().into(), U128(r["amount"].as_str().unwrap().parse().unwrap()),
        r["source"].as_str().unwrap().into(), r["signature"].as_str().unwrap().into());
    assert_eq!(note.id, r["id"].as_str().unwrap());
}

#[test]
fn redemption_consumption_identifies_exact_transfer_and_survives_later_balance_changes() {
    context("relay.testnet"); let mut c = Lenz::new(); let (k, owner) = identity(1);
    let root = fund(&mut c, &k, &owner); let receiver: AccountId = "adapter.lenz.testnet".parse().unwrap();
    c.storage_deposit(Some(receiver.clone()), Some(true));
    c.storage_deposit(Some("other.testnet".parse().unwrap()), Some(true));
    let nonce = "05".repeat(16);
    let terms = ["lenz/near-redeem/v1", "testnet", "reserve.lenz.testnet", &root.id, receiver.as_str(), &nonce];
    let digest = hex::encode(env::sha256(&near_sdk::serde_json::to_vec(&terms).unwrap()));
    assert_eq!(c.spent_by(root.id.clone()), None);
    let signature = sign(&k, &terms);
    assert_eq!(c.redeem(root.id.clone(), receiver.clone(), nonce.clone(), signature.clone()), root.amount);
    assert_eq!(c.spent_by(root.id.clone()), Some(digest.clone()));
    assert_eq!(c.ft_balance_of(receiver.clone()), root.amount); assert_eq!(c.reserved_balance(), U128(0));
    // Subsequent movement makes balance inference useless; the order-specific record remains.
    c.token.internal_transfer(&receiver, &"other.testnet".parse().unwrap(), root.amount.0, None);
    assert_eq!(c.ft_balance_of(receiver.clone()), U128(0));
    assert_eq!(c.spent_by(root.id.clone()), Some(digest.clone()));
    c.redeem(root.id.clone(), receiver.clone(), nonce, signature);
    assert_eq!(c.ft_balance_of(receiver), U128(0));
    assert_eq!(c.ft_balance_of("other.testnet".parse().unwrap()), root.amount);
    assert_eq!(c.spent_by(root.id), Some(digest));
}

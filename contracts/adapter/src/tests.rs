use super::*;
use near_sdk::{test_utils::{VMContextBuilder, get_created_receipts}, testing_env, PromiseResult};
use p256::ecdsa::{SigningKey, Signature, signature::Signer};
use std::panic::{catch_unwind, AssertUnwindSafe};

const ACCOUNT: &str = "adapter.lenz.testnet";
fn context(who: &str, ms: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(ACCOUNT.parse().unwrap()).predecessor_account_id(who.parse().unwrap())
        .attached_deposit(NearToken::from_millinear(100)).prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(ms * 1_000_000);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(), results);
}
fn result(amount: u128) -> PromiseResult { PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(amount)).unwrap()) }
fn signed(c: &Adapter, nonce: u8) -> Instruction {
    let key = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
    let mut i = Instruction { input: format!("root:{}", "a".repeat(64)),
        owner: hex::encode(key.verifying_key().to_encoded_point(true).as_bytes()),
        amount: U128(1_000_000), min_output: U128(100), receiver_id: "alice.testnet".parse().unwrap(),
        nonce: format!("{nonce:032x}"), deadline_ms: U64(10_000), signature: String::new(), redemption_signature: String::new() };
    let signature: Signature = key.sign(&near_sdk::serde_json::to_vec(&c.terms(&i)).unwrap());
    i.signature = hex::encode(signature.to_bytes());
    let redemption: Signature = key.sign(&near_sdk::serde_json::to_vec(&c.redemption_terms(&i)).unwrap());
    i.redemption_signature = hex::encode(redemption.to_bytes()); i
}
fn setup() -> (Adapter, Instruction) {
    context("relay.testnet", 1, vec![]);
    let c = Adapter::new("reserve.lenz.testnet".parse().unwrap(), 2870);
    let i = signed(&c, 1); (c, i)
}
fn submit(c: &mut Adapter, i: Instruction) -> String {
    let id = hex::encode(env::sha256(&near_sdk::serde_json::to_vec(&c.terms(&i)).unwrap()));
    drop(c.submit(i)); id
}
fn ready(c: &mut Adapter, i: &Instruction, id: &str) {
    context(ACCOUNT, 1, vec![PromiseResult::Successful(near_sdk::serde_json::to_vec(&json!({
        "id":i.input,"owner":i.owner,"amount":i.amount })).unwrap())]);
    assert_eq!(c.on_note(id.into()).stage, Stage::Ready);
}
fn advance(c: &mut Adapter, id: &str, ms: u64, stage: Stage) {
    context("carrier.testnet", ms, vec![]); drop(c.advance(id.into()));
    assert_eq!(c.get_order(id.into()).unwrap().stage, stage);
}
fn seeded(stage: Stage) -> (Adapter, String) {
    let (mut c, i) = setup(); let id = submit(&mut c, i);
    let mut o = c.get_order(id.clone()).unwrap(); o.stage = stage; o.output = U128(120); c.save(o); (c, id)
}

#[test]
fn successful_flow_binds_output_and_never_repeats_inflight_or_terminal_calls() {
    let (mut c, i) = setup(); let id = submit(&mut c, i.clone()); ready(&mut c, &i, &id);
    advance(&mut c, &id, 1, Stage::Redeeming);
    context(ACCOUNT, 1, vec![result(i.amount.0)]); assert_eq!(c.on_redeem(id.clone()).stage, Stage::Funded);
    advance(&mut c, &id, 1, Stage::Depositing);
    advance(&mut c, &id, 1, Stage::Depositing); assert!(get_created_receipts().is_empty());
    context(ACCOUNT, 1, vec![result(i.amount.0)]); c.on_deposit(id.clone());
    advance(&mut c, &id, 1, Stage::Swapping);
    context(ACCOUNT, 1, vec![result(120)]); assert_eq!(c.on_swap(id.clone()).output, U128(120));
    advance(&mut c, &id, 1, Stage::WithdrawingOutput);
    context(ACCOUNT, 1, vec![result(120)]); c.on_withdraw(id.clone());
    advance(&mut c, &id, 1, Stage::PayingOutput);
    let receipts = format!("{:?}", get_created_receipts()); assert!(receipts.contains("wrap.testnet"));
    context(ACCOUNT, 1, vec![PromiseResult::Successful(vec![])]); assert_eq!(c.on_payout(id.clone()).stage, Stage::Complete);
    advance(&mut c, &id, 1, Stage::Complete); assert!(get_created_receipts().is_empty());
    drop(c.submit(i)); assert!(get_created_receipts().is_empty());
}

#[test]
fn every_signed_field_and_configuration_is_bound() {
    let (mut c, i) = setup();
    for field in 0..11 {
        let mut changed = i.clone();
        match field {
            0 => changed.input = format!("root:{}", "b".repeat(64)),
            1 => changed.amount = U128(2), 2 => changed.min_output = U128(2),
            3 => changed.receiver_id = "bob.testnet".parse().unwrap(),
            4 => changed.nonce = "b".repeat(32), 5 => changed.deadline_ms = U64(11_000),
            6 => c.pool_id += 1, 7 => c.reserve = "other.testnet".parse().unwrap(),
            8 => changed.signature = "0".repeat(128),
            9 => changed.redemption_signature = "0".repeat(128),
            _ => { let k = SigningKey::from_bytes((&[8u8; 32]).into()).unwrap(); changed.owner = hex::encode(k.verifying_key().to_encoded_point(true).as_bytes()); },
        }
        assert!(catch_unwind(AssertUnwindSafe(|| {drop(c.submit(changed));})).is_err(), "field {field} accepted");
        c.pool_id = 2870; c.reserve = "reserve.lenz.testnet".parse().unwrap();
        context("relay.testnet", 1, vec![]);
    }
}

#[test]
fn another_adapter_or_network_domain_signature_is_rejected() {
    let (mut c, mut i) = setup(); let key = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
    for field in [0, 1, 2, 4, 6] {
        let mut terms = c.terms(&i); terms[field] = "wrong-domain".into();
        let sig: Signature = key.sign(&near_sdk::serde_json::to_vec(&terms).unwrap()); i.signature = hex::encode(sig.to_bytes());
        assert!(catch_unwind(AssertUnwindSafe(|| {drop(c.submit(i.clone()));})).is_err());
        context("relay.testnet", 1, vec![]);
    }
}

#[test]
fn wrong_owner_does_not_poison_input_and_second_order_cannot_reuse_it() {
    let (mut c, i) = setup(); let id = submit(&mut c, i.clone());
    context(ACCOUNT, 1, vec![PromiseResult::Successful(near_sdk::serde_json::to_vec(&json!({"id":i.input,"owner":"wrong","amount":i.amount})).unwrap())]);
    assert_eq!(c.on_note(id).stage, Stage::Rejected); assert!(c.inputs.get(&i.input).is_none());
    context("relay.testnet", 1, vec![]); let second = signed(&c, 2); let id = submit(&mut c, second.clone()); ready(&mut c, &second, &id);
    context("relay.testnet", 1, vec![]); let third = signed(&c, 3); let other = submit(&mut c, third);
    context(ACCOUNT, 1, vec![PromiseResult::Successful(near_sdk::serde_json::to_vec(&json!({"id":i.input,"owner":i.owner,"amount":i.amount})).unwrap())]);
    assert_eq!(c.on_note(other).stage, Stage::Rejected); assert_eq!(c.inputs.get(&i.input), Some(id));
}

#[test]
fn wrong_note_amount_is_rejected() {
    let (mut c, i) = setup(); let id = submit(&mut c, i.clone());
    context(ACCOUNT, 1, vec![PromiseResult::Successful(near_sdk::serde_json::to_vec(&json!({"id":i.input,"owner":i.owner,"amount":"999999"})).unwrap())]);
    assert_eq!(c.on_note(id).stage, Stage::Rejected); assert!(c.inputs.get(&i.input).is_none());
}

#[test]
fn expiry_before_deposit_refunds_without_exchange_call() {
    let (mut c, id) = seeded(Stage::Funded); advance(&mut c, &id, 10_000, Stage::RefundAvailable);
    assert!(get_created_receipts().is_empty());
}
#[test]
fn expiry_before_swap_withdraws_input_without_swapping() {
    let (mut c, id) = seeded(Stage::Deposited); advance(&mut c, &id, 10_000, Stage::RefundOnDex);
    assert!(get_created_receipts().is_empty()); advance(&mut c, &id, 10_000, Stage::WithdrawingRefund);
}
#[test]
fn slippage_failure_and_refund_payout_retry() {
    let (mut c, id) = seeded(Stage::Swapping);
    context(ACCOUNT, 1, vec![PromiseResult::Failed]); assert_eq!(c.on_swap(id.clone()).stage, Stage::RefundOnDex);
    advance(&mut c, &id, 1, Stage::WithdrawingRefund);
    context(ACCOUNT, 1, vec![result(1_000_000)]); assert_eq!(c.on_withdraw(id.clone()).stage, Stage::RefundAvailable);
    advance(&mut c, &id, 1, Stage::PayingRefund);
    context(ACCOUNT, 1, vec![PromiseResult::Failed]); assert_eq!(c.on_payout(id.clone()).stage, Stage::RefundAvailable);
    advance(&mut c, &id, 1, Stage::PayingRefund);
    context(ACCOUNT, 1, vec![PromiseResult::Successful(vec![])]); assert_eq!(c.on_payout(id).stage, Stage::Refunded);
}
#[test]
fn output_payout_failure_is_retryable() {
    let (mut c, id) = seeded(Stage::PayingOutput);
    context(ACCOUNT, 1, vec![PromiseResult::Failed]); assert_eq!(c.on_payout(id.clone()).stage, Stage::OutputAvailable);
    advance(&mut c, &id, 1, Stage::PayingOutput);
}
#[test]
fn zero_deposit_result_refunds() {
    let (mut c, id) = seeded(Stage::Depositing);
    context(ACCOUNT, 1, vec![result(0)]); assert_eq!(c.on_deposit(id).stage, Stage::RefundAvailable);
}
#[test]
fn ambiguous_deposits_freeze_instead_of_spending_shared_balance() {
    let (mut c, id) = seeded(Stage::Depositing);
    for outcome in [result(1), PromiseResult::Failed, PromiseResult::Successful(b"null".to_vec())] {
        let mut o = c.get_order(id.clone()).unwrap(); o.stage = Stage::Depositing; c.save(o);
        context(ACCOUNT, 1, vec![outcome]); assert_eq!(c.on_deposit(id.clone()).stage, Stage::Attention);
        advance(&mut c, &id, 1, Stage::Attention); assert!(get_created_receipts().is_empty());
    }
}
#[test]
fn ambiguous_withdrawal_or_below_minimum_output_freezes() {
    let (mut c, id) = seeded(Stage::WithdrawingOutput);
    context(ACCOUNT, 1, vec![result(119)]); assert_eq!(c.on_withdraw(id.clone()).stage, Stage::Attention);
    let mut o = c.get_order(id.clone()).unwrap(); o.stage = Stage::Swapping; c.save(o);
    context(ACCOUNT, 1, vec![result(99)]); assert_eq!(c.on_swap(id).stage, Stage::Attention);
}
#[test]
fn failed_reserve_redemption_never_credits_input() {
    let (mut c, id) = seeded(Stage::Redeeming);
    context(ACCOUNT, 1, vec![PromiseResult::Failed]); assert_eq!(c.on_redeem(id).stage, Stage::Rejected);
}
#[test]
#[should_panic(expected = "Private callback only")]
fn rejects_external_callback() {
    let (mut c, id) = seeded(Stage::PayingOutput);
    context("attacker.testnet", 1, vec![result(120)]); c.on_payout(id);
}
#[test]
#[should_panic(expected = "Expected one promise result")]
fn rejects_callback_without_result() {
    let (mut c, id) = seeded(Stage::PayingOutput);
    context(ACCOUNT, 1, vec![]); c.on_payout(id);
}
#[test]
#[should_panic(expected = "Unexpected callback stage")]
fn rejects_replayed_callback() {
    let (mut c, id) = seeded(Stage::PayingOutput);
    context(ACCOUNT, 1, vec![PromiseResult::Successful(vec![])]); c.on_payout(id.clone()); c.on_payout(id);
}
#[test]
#[should_panic(expected = "Invalid input id")]
fn rejects_unicode_input_without_invalid_utf8_slice() {
    let (mut c, mut i) = setup(); i.input = format!("{}é0", "a".repeat(63)); drop(c.submit(i));
}

#[test]
fn oversized_success_is_not_mistaken_for_failed_swap_or_payout() {
    let (mut c, id) = seeded(Stage::Swapping);
    context(ACCOUNT, 1, vec![PromiseResult::Successful(vec![b'0'; 129])]);
    assert_eq!(c.on_swap(id.clone()).stage, Stage::Attention);
    let mut o = c.get_order(id.clone()).unwrap(); o.stage = Stage::PayingOutput; c.save(o);
    context(ACCOUNT, 1, vec![PromiseResult::Successful(vec![b'0'; 129])]);
    assert_eq!(c.on_payout(id).stage, Stage::Attention);
}

#[test]
fn verifies_actual_edge_signatures_and_matches_order_id() {
    let fixture: Value = near_sdk::serde_json::from_str(include_str!("../fixtures/browser-swap.json")).unwrap();
    context("relay.testnet", fixture["now"].as_u64().unwrap(), vec![]);
    let mut c = Adapter::new("reserve.lenz.testnet".parse().unwrap(), 2870);
    let i: Instruction = near_sdk::serde_json::from_value(fixture["packet"]["instruction"].clone()).unwrap();
    let id = submit(&mut c, i); assert_eq!(id, fixture["id"].as_str().unwrap());
}

fn redemption_status(c: &Adapter, id: &str) -> PromiseResult {
    let o = c.get_order(id.into()).unwrap();
    let i = &o.instruction;
    let terms = ["lenz/near-redeem/v1", "testnet", "reserve.lenz.testnet", &i.input, ACCOUNT, &i.nonce];
    let digest = hex::encode(env::sha256(&near_sdk::serde_json::to_vec(&terms).unwrap()));
    PromiseResult::Successful(near_sdk::serde_json::to_vec(&Some(digest)).unwrap())
}

#[test]
fn recovery_queries_only_the_configured_reserve_without_moving_money() {
    use near_sdk::mock::MockAction;
    let (mut c, i) = setup(); let id = submit(&mut c, i.clone()); ready(&mut c, &i, &id);
    advance(&mut c, &id, 1, Stage::Redeeming);
    let before = c.get_order(id.clone()).unwrap();
    for _ in 0..2 {
        context("anyone.testnet", 20_000, vec![]); drop(c.recover_redemption(id.clone()));
        assert_eq!(c.get_order(id.clone()).unwrap(), before);
        assert_eq!(c.inputs.get(&i.input), Some(id.clone()));
        let receipts = get_created_receipts(); assert_eq!(receipts.len(), 2);
        for (receipt, target, method, args) in [
            (&receipts[0], "reserve.lenz.testnet", "spent_by", json!({"id":i.input})),
            (&receipts[1], ACCOUNT, "on_redemption_status", json!({"id":id})),
        ] {
            assert_eq!(receipt.receiver_id.as_str(), target); assert_eq!(receipt.actions.len(), 1);
            match &receipt.actions[0] {
                MockAction::FunctionCallWeight { method_name, args: bytes, attached_deposit, .. } => {
                    assert_eq!(method_name, method.as_bytes());
                    assert_eq!(near_sdk::serde_json::from_slice::<Value>(bytes).unwrap(), args);
                    assert_eq!(*attached_deposit, NearToken::from_yoctonear(0));
                },
                action => panic!("Unexpected recovery action: {action:?}"),
            }
        }
        assert!(!receipts[1].receipt_indices.is_empty());
    }
}

#[test]
fn recovery_restores_only_exact_redemption_and_expiry_can_refund_once() {
    let (mut c, i) = setup(); let id = submit(&mut c, i.clone()); ready(&mut c, &i, &id);
    advance(&mut c, &id, 1, Stage::Redeeming);
    let status = redemption_status(&c, &id);
    context(ACCOUNT, 20_000, vec![status]);
    assert_eq!(c.on_redemption_status(id.clone()).stage, Stage::Funded);
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.inputs.get(&i.input), Some(id.clone()));
    advance(&mut c, &id, 20_000, Stage::RefundAvailable);
    assert!(get_created_receipts().is_empty());
    advance(&mut c, &id, 20_000, Stage::PayingRefund);
    assert_eq!(get_created_receipts().len(), 2);
    advance(&mut c, &id, 20_000, Stage::PayingRefund);
    assert!(get_created_receipts().is_empty());
    context(ACCOUNT, 20_000, vec![PromiseResult::Successful(vec![])]);
    assert_eq!(c.on_payout(id.clone()).stage, Stage::Refunded);
    context("anyone.testnet", 20_000, vec![]); drop(c.recover_redemption(id.clone()));
    assert_eq!(c.get_order(id).unwrap().stage, Stage::Refunded);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn recovery_unknown_failed_and_foreign_consumption_remain_unavailable() {
    let (mut c, id) = seeded(Stage::Redeeming);
    let before = c.get_order(id.clone()).unwrap();
    let mut outcomes = vec![PromiseResult::Failed, PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(b"{}".to_vec()), result(1_000_000),
        PromiseResult::Successful(vec![b'x'; 129]), PromiseResult::Successful(b"not-json".to_vec())];
    let terms = c.redemption_terms(&before.instruction);
    // A consumption identifier must match domain, network, reserve, input, receiver AND nonce.
    for index in 0..terms.len() {
        let mut foreign = terms.clone(); foreign[index] = "different".into();
        outcomes.push(PromiseResult::Successful(near_sdk::serde_json::to_vec(
            &hex::encode(env::sha256(&near_sdk::serde_json::to_vec(&foreign).unwrap()))).unwrap()));
    }
    for outcome in outcomes {
        context(ACCOUNT, 20_000, vec![outcome]);
        assert_eq!(c.on_redemption_status(id.clone()), before);
        assert!(get_created_receipts().is_empty());
    }
}

#[test]
fn recovery_never_rewinds_other_stages_even_with_matching_consumption() {
    let (mut c, id) = seeded(Stage::Redeeming);
    for stage in [Stage::Checking, Stage::Ready, Stage::Funded, Stage::Depositing, Stage::Deposited,
        Stage::Swapping, Stage::OutputOnDex, Stage::RefundOnDex, Stage::WithdrawingOutput,
        Stage::WithdrawingRefund, Stage::OutputAvailable, Stage::RefundAvailable,
        Stage::PayingOutput, Stage::PayingRefund, Stage::Complete, Stage::Refunded,
        Stage::Rejected, Stage::Attention] {
        let mut before = c.get_order(id.clone()).unwrap(); before.stage = stage; c.save(before.clone());
        context("anyone.testnet", 20_000, vec![]); drop(c.recover_redemption(id.clone()));
        assert_eq!(c.get_order(id.clone()).unwrap(), before); assert!(get_created_receipts().is_empty());
        context(ACCOUNT, 20_000, vec![redemption_status(&c, &id)]);
        assert!(catch_unwind(AssertUnwindSafe(|| c.on_redemption_status(id.clone()))).is_err());
        assert_eq!(c.get_order(id.clone()).unwrap(), before); assert!(get_created_receipts().is_empty());
    }
}

#[test]
fn recovery_racing_original_or_duplicate_callbacks_cannot_restore_spent_backing() {
    let (mut c, id) = seeded(Stage::Redeeming);
    let status = redemption_status(&c, &id);
    context(ACCOUNT, 1, vec![redemption_status(&c, &id)]); c.on_redemption_status(id.clone());
    advance(&mut c, &id, 1, Stage::Depositing);
    let before = c.get_order(id.clone()).unwrap();
    context(ACCOUNT, 1, vec![status]);
    assert!(catch_unwind(AssertUnwindSafe(|| c.on_redemption_status(id.clone()))).is_err());
    context(ACCOUNT, 1, vec![result(1_000_000)]);
    assert!(catch_unwind(AssertUnwindSafe(|| c.on_redeem(id.clone()))).is_err());
    assert_eq!(c.get_order(id.clone()).unwrap(), before); assert!(get_created_receipts().is_empty());
    // Reverse arrival order: the original callback wins, then the recovery result is stale.
    let mut o = before; o.stage = Stage::Redeeming; c.save(o);
    context(ACCOUNT, 1, vec![result(1_000_000)]); c.on_redeem(id.clone());
    context(ACCOUNT, 1, vec![redemption_status(&c, &id)]);
    assert!(catch_unwind(AssertUnwindSafe(|| c.on_redemption_status(id.clone()))).is_err());
    assert_eq!(c.get_order(id).unwrap().stage, Stage::Funded);
}

#[test]
fn recovery_rejects_external_or_unbound_callback_results() {
    let (mut c, id) = seeded(Stage::Redeeming);
    let before = c.get_order(id.clone()).unwrap(); let status = redemption_status(&c, &id);
    for (caller, outcomes) in [("attacker.testnet", vec![redemption_status(&c, &id)]),
        (ACCOUNT, vec![]), (ACCOUNT, vec![redemption_status(&c, &id), status])] {
        context(caller, 1, outcomes);
        assert!(catch_unwind(AssertUnwindSafe(|| c.on_redemption_status(id.clone()))).is_err());
        assert_eq!(c.get_order(id.clone()).unwrap(), before); assert!(get_created_receipts().is_empty());
    }
}

#[test]
fn recovery_cannot_attribute_a_sibling_orders_redemption_to_this_order() {
    let (mut c, first) = setup(); let first_id = submit(&mut c, first.clone()); ready(&mut c, &first, &first_id);
    advance(&mut c, &first_id, 1, Stage::Redeeming);
    let key = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
    let mut second = signed(&c, 2); second.input = format!("root:{}", "b".repeat(64));
    let signature: Signature = key.sign(&near_sdk::serde_json::to_vec(&c.terms(&second)).unwrap());
    second.signature = hex::encode(signature.to_bytes());
    let signature: Signature = key.sign(&near_sdk::serde_json::to_vec(&c.redemption_terms(&second)).unwrap());
    second.redemption_signature = hex::encode(signature.to_bytes());
    context("carrier.testnet", 1, vec![]); let second_id = submit(&mut c, second.clone()); ready(&mut c, &second, &second_id);
    advance(&mut c, &second_id, 1, Stage::Redeeming);
    context(ACCOUNT, 1, vec![redemption_status(&c, &second_id)]);
    assert_eq!(c.on_redemption_status(first_id.clone()).stage, Stage::Redeeming);
    assert_eq!(c.get_order(second_id.clone()).unwrap().stage, Stage::Redeeming);
    context(ACCOUNT, 1, vec![redemption_status(&c, &second_id)]);
    assert_eq!(c.on_redemption_status(second_id.clone()).stage, Stage::Funded);
    assert_eq!(c.get_order(first_id.clone()).unwrap().stage, Stage::Redeeming);
    assert_eq!(c.inputs.get(&first.input), Some(first_id));
    assert_eq!(c.inputs.get(&second.input), Some(second_id));
    assert!(get_created_receipts().is_empty());
}

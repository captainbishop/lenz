//! Testnet-only P-256 authorized reserve -> Rhea -> signed recipient adapter.
//! Public terms. Each asynchronous movement is recorded before dispatch.
use near_sdk::{collections::LookupMap, env, json_types::{U128, U64}, near, require,
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseError};
use near_sdk::serde_json::{json, Value};

const DOMAIN: &str = "lenz/rhea-swap/v1";
const DEX: &str = "ref-finance-101.testnet";
const OUTPUT: &str = "wrap.testnet";

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Instruction {
    pub input: String,
    pub owner: String,
    pub amount: U128,
    pub min_output: U128,
    pub receiver_id: AccountId,
    pub nonce: String,
    pub deadline_ms: U64,
    pub signature: String,
    pub redemption_signature: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Checking, Ready, Redeeming, Funded, Depositing, Deposited, Swapping,
    OutputOnDex, RefundOnDex, WithdrawingOutput, WithdrawingRefund,
    OutputAvailable, RefundAvailable, PayingOutput, PayingRefund,
    Complete, Refunded, Rejected, Attention,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub id: String,
    pub instruction: Instruction,
    pub stage: Stage,
    pub output: U128,
    pub reason: String,
}

#[near(serializers = [json])]
pub struct Note { pub id: String, pub owner: String, pub amount: U128 }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Adapter {
    reserve: AccountId,
    pool_id: u64,
    orders: LookupMap<String, Order>,
    inputs: LookupMap<String, String>,
}

fn hex_text(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn verify(owner: &str, terms: &[String], signature: &str) {
    require!(hex_text(owner, 66) && (owner.starts_with("02") || owner.starts_with("03")), "Invalid public key");
    require!(hex_text(signature, 128), "Invalid signature encoding");
    let public: [u8; 33] = hex::decode(owner).unwrap().try_into().unwrap();
    let sig: [u8; 64] = hex::decode(signature).unwrap().try_into().unwrap();
    require!(env::p256_verify(&sig, &env::sha256_array(&near_sdk::serde_json::to_vec(terms).unwrap()), &public), "Signature rejected");
}
fn result_amount() -> Option<U128> {
    match env::promise_result_checked(0, 128) {
        Ok(bytes) => near_sdk::serde_json::from_slice(&bytes).ok(),
        _ => None,
    }
}

impl Adapter {
    fn terms(&self, i: &Instruction) -> Vec<String> {
        [DOMAIN, "testnet", env::current_account_id().as_str(), self.reserve.as_str(), DEX,
            &self.pool_id.to_string(), OUTPUT, &i.input, &i.owner, &i.amount.0.to_string(),
            &i.min_output.0.to_string(), i.receiver_id.as_str(), &i.nonce, &i.deadline_ms.0.to_string()]
            .map(str::to_owned).to_vec()
    }
    fn redemption_terms(&self, i: &Instruction) -> Vec<String> {
        ["lenz/near-redeem/v1", "testnet", self.reserve.as_str(), &i.input,
            env::current_account_id().as_str(), &i.nonce].map(str::to_owned).to_vec()
    }
    fn save(&mut self, order: Order) -> Order { self.orders.insert(&order.id, &order); order }
    fn callback(&self, id: &String, expected: &[Stage]) -> Order {
        require!(env::predecessor_account_id() == env::current_account_id(), "Private callback only");
        require!(env::promise_results_count() == 1, "Expected one promise result");
        let order = self.orders.get(id).expect("Unknown order");
        require!(expected.contains(&order.stage), "Unexpected callback stage");
        order
    }
    fn dispatch(&mut self, mut o: Order, stage: Stage, target: AccountId, method: &str,
        args: Value, deposit: NearToken, gas: u64, callback: &str) -> PromiseOrValue<Order> {
        o.stage = stage;
        let id = o.id.clone(); self.save(o);
        PromiseOrValue::Promise(Promise::new(target).function_call(method,
            near_sdk::serde_json::to_vec(&args).unwrap(), deposit, Gas::from_tgas(gas))
            .then(Promise::new(env::current_account_id()).function_call(callback,
                near_sdk::serde_json::to_vec(&json!({"id":id})).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(25))))
    }
}

#[near]
impl Adapter {
    #[init]
    pub fn new(reserve: AccountId, pool_id: u64) -> Self {
        require!(env::current_account_id().as_str().ends_with(".testnet") && reserve.as_str().ends_with(".testnet"), "Testnet only");
        Self { reserve, pool_id, orders: LookupMap::new(b"o"), inputs: LookupMap::new(b"i") }
    }
    pub fn configuration(&self) -> Value {
        json!({"network":"testnet","adapter":env::current_account_id(),"reserve":self.reserve,
            "exchange":DEX,"poolId":self.pool_id,"tokenOut":OUTPUT})
    }
    pub fn get_order(&self, id: String) -> Option<Order> { self.orders.get(&id) }

    /// Anyone can submit signed terms. A fixed test deposit funds storage and calls.
    /// Duplicate terms never create a second external action.
    #[payable]
    pub fn submit(&mut self, instruction: Instruction) -> PromiseOrValue<Order> {
        let i = &instruction;
        require!(i.amount.0 > 0 && i.min_output.0 > 0, "Amounts must be positive");
        require!(hex_text(&i.nonce, 32), "Invalid nonce");
        require!(i.receiver_id.as_str().ends_with(".testnet") && i.receiver_id != env::current_account_id()
            && i.receiver_id != self.reserve && i.receiver_id.as_str() != DEX, "Choose a separate testnet receiving account");
        require!(i.deadline_ms.0 > 0 && i.deadline_ms.0 <= env::block_timestamp_ms().saturating_add(86_400_000), "Deadline is too far away");
        let valid_input = i.input.strip_prefix("root:").is_some_and(|s| hex_text(s, 64))
            || (i.input.is_ascii() && i.input.len() == 66 && hex_text(&i.input[..64], 64) && [":0", ":1"].contains(&&i.input[64..]));
        require!(valid_input, "Invalid input id");
        let terms = self.terms(i);
        verify(&i.owner, &terms, &i.signature);
        verify(&i.owner, &self.redemption_terms(i), &i.redemption_signature);
        let id = hex::encode(env::sha256(&near_sdk::serde_json::to_vec(&terms).unwrap()));
        if let Some(order) = self.orders.get(&id) { return PromiseOrValue::Value(order); }
        require!(env::attached_deposit() >= NearToken::from_millinear(100), "Attach 0.1 test NEAR for storage and calls");
        let input = instruction.input.clone();
        let order = Order { id, instruction, stage: Stage::Checking, output: U128(0), reason: String::new() };
        self.dispatch(order, Stage::Checking, self.reserve.clone(), "get_note", json!({"id":input}),
            NearToken::from_yoctonear(0), 10, "on_note")
    }

    /// Advances only a settled stage. In-flight/terminal states return unchanged.
    pub fn advance(&mut self, id: String) -> PromiseOrValue<Order> {
        let mut o = self.orders.get(&id).expect("Unknown order");
        let i = o.instruction.clone();
        let one = NearToken::from_yoctonear(1);
        let expired = env::block_timestamp_ms() >= i.deadline_ms.0;
        match o.stage {
            Stage::Ready => self.dispatch(o, Stage::Redeeming, self.reserve.clone(), "redeem",
                json!({"input":i.input,"receiver_id":env::current_account_id(),"nonce":i.nonce,"signature":i.redemption_signature}),
                NearToken::from_millinear(20), 35, "on_redeem"),
            Stage::Funded if expired => { o.stage = Stage::RefundAvailable; o.reason = "Submission deadline passed".into(); PromiseOrValue::Value(self.save(o)) },
            Stage::Funded => self.dispatch(o, Stage::Depositing, self.reserve.clone(), "ft_transfer_call",
                json!({"receiver_id":DEX,"amount":i.amount,"msg":""}), one, 120, "on_deposit"),
            Stage::Deposited if expired => { o.stage = Stage::RefundOnDex; o.reason = "Submission deadline passed".into(); PromiseOrValue::Value(self.save(o)) },
            Stage::Deposited => self.dispatch(o, Stage::Swapping, DEX.parse().unwrap(), "swap",
                json!({"actions":[{"pool_id":self.pool_id,"token_in":self.reserve,"amount_in":i.amount,"token_out":OUTPUT,"min_amount_out":i.min_output}]}),
                one, 60, "on_swap"),
            Stage::OutputOnDex | Stage::RefundOnDex => {
                let output = o.stage == Stage::OutputOnDex;
                let amount = if output { o.output } else { i.amount };
                self.dispatch(o, if output { Stage::WithdrawingOutput } else { Stage::WithdrawingRefund }, DEX.parse().unwrap(), "withdraw",
                    json!({"token_id":if output {OUTPUT} else {self.reserve.as_str()},"amount":amount}), one, 100, "on_withdraw")
            },
            Stage::OutputAvailable | Stage::RefundAvailable => {
                let output = o.stage == Stage::OutputAvailable;
                let amount = if output { o.output } else { i.amount };
                self.dispatch(o, if output { Stage::PayingOutput } else { Stage::PayingRefund },
                    if output {OUTPUT.parse().unwrap()} else {self.reserve.clone()}, "ft_transfer",
                    json!({"receiver_id":i.receiver_id,"amount":amount,"memo":"Lenz authorized Rhea outcome"}), one, 30, "on_payout")
            },
            _ => PromiseOrValue::Value(o),
        }
    }

    #[private]
    pub fn on_note(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::Checking]);
        let note: Option<Note> = match env::promise_result_checked(0, 1024) {
            Ok(bytes) => near_sdk::serde_json::from_slice(&bytes).ok().flatten(),
            _ => None,
        };
        if !note.is_some_and(|n| n.id == o.instruction.input && n.owner == o.instruction.owner && n.amount == o.instruction.amount) {
            o.stage = Stage::Rejected; o.reason = "Reserve note does not match signed instruction".into();
        } else if self.inputs.get(&o.instruction.input).is_some_and(|existing| existing != id) {
            o.stage = Stage::Rejected; o.reason = "Input already assigned to an order".into();
        } else {
            self.inputs.insert(&o.instruction.input, &id); o.stage = Stage::Ready;
        }
        self.save(o)
    }
    #[private]
    pub fn on_redeem(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::Redeeming]);
        match env::promise_result_checked(0, 128) {
            Err(PromiseError::Failed) => { o.stage = Stage::Rejected; o.reason = "Reserve rejected redemption; reconcile the input on NEAR".into(); },
            _ if result_amount() == Some(o.instruction.amount) => o.stage = Stage::Funded,
            _ => { o.stage = Stage::Attention; o.reason = "Unrecognized reserve result".into(); },
        }
        self.save(o)
    }
    #[private]
    pub fn on_deposit(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::Depositing]);
        match result_amount() {
            Some(amount) if amount == o.instruction.amount => o.stage = Stage::Deposited,
            Some(U128(0)) => { o.stage = Stage::RefundAvailable; o.reason = "Exchange returned the input".into(); },
            _ => { o.stage = Stage::Attention; o.reason = "Deposit result needs reconciliation".into(); },
        }
        self.save(o)
    }
    #[private]
    pub fn on_swap(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::Swapping]);
        match env::promise_result_checked(0, 128) {
            Err(PromiseError::Failed) => { o.stage = Stage::RefundOnDex; o.reason = "Exchange rejected the swap".into(); },
            _ => match result_amount() {
                Some(amount) if amount.0 >= o.instruction.min_output.0 => { o.output = amount; o.stage = Stage::OutputOnDex; },
                _ => { o.stage = Stage::Attention; o.reason = "Swap output needs reconciliation".into(); },
            },
        }
        self.save(o)
    }
    #[private]
    pub fn on_withdraw(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::WithdrawingOutput, Stage::WithdrawingRefund]);
        let output = o.stage == Stage::WithdrawingOutput;
        if result_amount() == Some(if output {o.output} else {o.instruction.amount}) {
            o.stage = if output {Stage::OutputAvailable} else {Stage::RefundAvailable};
        } else { o.stage = Stage::Attention; o.reason = "Withdrawal result needs reconciliation".into(); }
        self.save(o)
    }
    #[private]
    pub fn on_payout(&mut self, id: String) -> Order {
        let mut o = self.callback(&id, &[Stage::PayingOutput, Stage::PayingRefund]);
        let output = o.stage == Stage::PayingOutput;
        o.stage = match env::promise_result_checked(0, 128) {
            Ok(_) => if output {Stage::Complete} else {Stage::Refunded},
            Err(PromiseError::Failed) => { o.reason = "Receiving account must accept this token; payout can be retried".into();
                if output {Stage::OutputAvailable} else {Stage::RefundAvailable} },
            _ => { o.reason = "Payout result needs reconciliation".into(); Stage::Attention },
        };
        self.save(o)
    }
}

#[cfg(test)]
mod tests;

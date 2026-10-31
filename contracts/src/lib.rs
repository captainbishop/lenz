//! Testnet-only NEP-141 tUSD and an atomic offline-payment reserve.
//! Public settlement prototype: amounts and spending keys appear on NEAR.
use near_contract_standards::{
    fungible_token::{FungibleToken, core::FungibleTokenCore, resolver::FungibleTokenResolver,
        metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC}, events::FtMint},
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{collections::{LookupMap, LookupSet}, env, json_types::U128,
    near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue};

const TRANSFER: &str = "lenz/near-transfer/v1";
const FUND: &str = "lenz/near-fund/v1";
const REDEEM: &str = "lenz/near-redeem/v1";
const DEPOSIT: &str = "lenz/near-deposit/v1";
const MAX_PATH: usize = 16;
const TEST_GRANT: u128 = 100_000_000; // 100 tUSD, six decimals; no dollar redemption.

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Note { pub id: String, pub owner: String, pub amount: U128 }

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Spend {
    pub input: String,
    pub recipient: String,
    pub amount: U128,
    pub nonce: String,
    pub signature: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Receipt { pub id: String, pub input: String, pub outputs: Vec<Note>, pub block_height: u64 }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Lenz {
    token: FungibleToken,
    notes: LookupMap<String, Note>,
    consumed: LookupMap<String, String>,
    receipts: LookupMap<String, Receipt>,
    grants: LookupSet<String>,
    roots: LookupMap<String, Note>,
    reserved: u128,
}

fn hash(value: &impl near_sdk::serde::Serialize) -> String {
    hex::encode(env::sha256(&near_sdk::serde_json::to_vec(value).unwrap()))
}
fn key(text: &str) -> [u8; 33] {
    require!(text.len() == 66 && (text.starts_with("02") || text.starts_with("03")), "Invalid spending key");
    require!(text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "Noncanonical key");
    hex::decode(text).expect("Invalid spending key").try_into().unwrap()
}
fn nonce(text: &str) {
    require!(text.len() == 32 && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "Invalid nonce");
}
fn verify(owner: &str, value: &impl near_sdk::serde::Serialize, signature: &str) {
    require!(signature.len() == 128, "Invalid signature");
    let sig: [u8; 64] = hex::decode(signature).expect("Invalid signature").try_into().unwrap();
    let digest = env::sha256_array(&near_sdk::serde_json::to_vec(value).unwrap());
    require!(env::p256_verify(&sig, &digest, &key(owner)), "Signature rejected");
}
fn charge_storage(before: u64) {
    let cost = u128::from(env::storage_usage().saturating_sub(before)) * env::storage_byte_cost().as_yoctonear();
    let paid = env::attached_deposit().as_yoctonear();
    require!(paid >= cost, "Attach enough NEAR for storage");
    if paid > cost { Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(paid - cost)).detach(); }
}

#[near]
impl Lenz {
    #[init]
    pub fn new() -> Self {
        require!(env::current_account_id().as_str().ends_with(".testnet"), "Testnet named account required");
        let mut token = FungibleToken::new(b"t");
        token.internal_register_account(&env::current_account_id());
        Self { token, notes: LookupMap::new(b"n"), consumed: LookupMap::new(b"c"),
            receipts: LookupMap::new(b"r"), grants: LookupSet::new(b"g"), roots: LookupMap::new(b"o"), reserved: 0 }
    }

    /// Mints an on-chain test grant directly into reserve, once per spending key.
    /// The signature binds the browser key to this network, contract, amount and nonce.
    #[payable]
    pub fn fund_test(&mut self, owner: String, amount: U128, nonce: String, signature: String) -> Note {
        require!(amount.0 > 0 && amount.0 <= TEST_GRANT, "Test grant is at most 100 tUSD");
        require!(!self.grants.contains(&owner), "This key already claimed its test grant");
        crate::nonce(&nonce);
        let terms = [FUND, "testnet", env::current_account_id().as_str(), &owner, &amount.0.to_string(), &nonce].map(str::to_owned);
        verify(&owner, &terms, &signature);
        let before = env::storage_usage();
        let note = Note { id: format!("root:{}", hash(&terms)), owner: owner.clone(), amount };
        self.token.internal_deposit(&env::current_account_id(), amount.0);
        self.reserved = self.reserved.checked_add(amount.0).unwrap();
        self.grants.insert(&owner);
        self.notes.insert(&note.id, &note);
        self.roots.insert(&note.id, &note);
        FtMint { owner_id: &env::current_account_id(), amount, memo: Some("Lenz test grant reserved for an offline key") }.emit();
        charge_storage(before);
        note
    }

    /// Anyone may carry an authorized path to NEAR. All steps execute atomically.
    /// Replaying the same terms returns the same receipt, independent of signature malleability.
    #[payable]
    pub fn settle(&mut self, path: Vec<Spend>) -> Vec<Receipt> {
        require!(!path.is_empty() && path.len() <= MAX_PATH, "Expected 1 to 16 transfers");
        let before = env::storage_usage();
        let mut result = Vec::new();
        for spend in path {
            crate::nonce(&spend.nonce); key(&spend.recipient);
            require!(spend.amount.0 > 0, "Amount must be positive");
            let terms = [TRANSFER, "testnet", env::current_account_id().as_str(), &spend.input,
                &spend.recipient, &spend.amount.0.to_string(), &spend.nonce].map(str::to_owned);
            let id = hash(&terms);
            if let Some(receipt) = self.receipts.get(&id) { result.push(receipt); continue; }
            require!(self.consumed.get(&spend.input).is_none(), "Conflicting spend: input already consumed");
            let input = self.notes.get(&spend.input).expect("Input has not reached NEAR");
            require!(spend.amount.0 <= input.amount.0, "Insufficient reserve");
            verify(&input.owner, &terms, &spend.signature);
            let mut outputs = vec![Note { id: format!("{id}:0"), owner: spend.recipient, amount: spend.amount }];
            if spend.amount.0 < input.amount.0 { outputs.push(Note { id: format!("{id}:1"), owner: input.owner,
                amount: U128(input.amount.0 - spend.amount.0) }); }
            self.consumed.insert(&spend.input, &id);
            for output in &outputs { self.notes.insert(&output.id, output); }
            let receipt = Receipt { id: id.clone(), input: spend.input, outputs, block_height: env::block_height() };
            self.receipts.insert(&id, &receipt);
            result.push(receipt);
        }
        charge_storage(before);
        result
    }

    /// Moves a settled note into a registered NEAR account's NEP-141 balance.
    /// Reserve consumption and token transfer happen in one receipt, with no external callback.
    #[payable]
    pub fn redeem(&mut self, input: String, receiver_id: AccountId, nonce: String, signature: String) -> U128 {
        crate::nonce(&nonce);
        require!(receiver_id != env::current_account_id(), "Choose a separate receiver account");
        let terms = [REDEEM, "testnet", env::current_account_id().as_str(), &input, receiver_id.as_str(), &nonce].map(str::to_owned);
        let id = hash(&terms);
        let note = self.notes.get(&input).expect("Input has not reached NEAR");
        if self.consumed.get(&input) == Some(id.clone()) { return note.amount; }
        require!(self.consumed.get(&input).is_none(), "Conflicting spend: input already consumed");
        verify(&note.owner, &terms, &signature);
        let before = env::storage_usage();
        self.token.internal_transfer(&env::current_account_id(), &receiver_id, note.amount.0, Some("Lenz reserve redemption".into()));
        self.consumed.insert(&input, &id);
        self.reserved = self.reserved.checked_sub(note.amount.0).unwrap();
        charge_storage(before);
        note.amount
    }

    pub fn get_note(&self, id: String) -> Option<Note> { self.notes.get(&id) }

    /// Converts the caller's existing NEP-141 balance to an offline note atomically.
    /// A payer/source pair creates one root, including after that root is spent.
    #[payable]
    pub fn deposit_offline(&mut self, owner: String, amount: U128, source: String, signature: String) -> Note {
        require!(env::attached_deposit().as_yoctonear() > 0, "Attach NEAR for deposit storage");
        require!(amount.0 > 0, "Amount must be positive");
        require!(source.len() == 64 && source.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "Invalid deposit source");
        let payer = env::predecessor_account_id();
        let reserve = env::current_account_id();
        require!(payer != reserve, "Choose a separate payer account");
        let terms = [DEPOSIT, "testnet", reserve.as_str(), payer.as_str(), &source, &owner, &amount.0.to_string()].map(str::to_owned);
        verify(&owner, &terms, &signature);
        let id = format!("root:{}", hash(&["lenz/near-deposit-root/v1", "testnet", reserve.as_str(), payer.as_str(), &source]));
        let before = env::storage_usage();
        if let Some(existing) = self.roots.get(&id) {
            require!(existing.owner == owner && existing.amount == amount, "Deposit source already used with different terms");
            charge_storage(before);
            return existing;
        }
        let next_reserved = self.reserved.checked_add(amount.0).expect("Reserve overflow");
        self.token.internal_transfer(&payer, &reserve, amount.0, Some("Lenz offline deposit".into()));
        let note = Note { id, owner, amount };
        self.notes.insert(&note.id, &note);
        self.roots.insert(&note.id, &note);
        self.reserved = next_reserved;
        charge_storage(before);
        note
    }

    pub fn capabilities(&self) -> Vec<String> { vec!["deposit_offline_v1".into()] }
    pub fn get_root(&self, id: String) -> Option<Note> { self.roots.get(&id) }
    pub fn get_receipt(&self, id: String) -> Option<Receipt> { self.receipts.get(&id) }
    pub fn spent_by(&self, id: String) -> Option<String> { self.consumed.get(&id) }
    pub fn reserved_balance(&self) -> U128 { U128(self.reserved) }
}

#[near]
impl FungibleTokenMetadataProvider for Lenz {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata { spec: FT_METADATA_SPEC.into(), name: "Lenz Test Dollar".into(), symbol: "tUSD".into(),
            icon: None, reference: None, reference_hash: None, decimals: 6 }
    }
}
#[near]
impl FungibleTokenCore for Lenz {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) { self.token.ft_transfer(receiver_id, amount, memo) }
    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 { self.token.ft_total_supply() }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 { self.token.ft_balance_of(account_id) }
}
#[near]
impl FungibleTokenResolver for Lenz {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.token.ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}
#[near]
impl StorageManagement for Lenz {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance { self.token.storage_withdraw(amount) }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool { self.token.storage_unregister(force) }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds { self.token.storage_balance_bounds() }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> { self.token.storage_balance_of(account_id) }
}

#[cfg(test)]
mod tests;

// Native read-only preflight. No nullifier, witness or viewing key is returned.
use std::{env, fs, io::Read, process};
use orchard::Note;
use pczt::{Pczt, roles::verifier::{Verifier, OrchardError}};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use zcash_client_backend::{data_api::{InputSource, WalletRead, WalletCommitmentTrees, locking::{LockFilter, LockedInputPolicy}, wallet::TargetHeight}, wallet::Note as WalletNote};
use zcash_client_sqlite::{WalletDb, error::SqliteClientError};
use zcash_primitives::transaction::TxId;
use zcash_protocol::{ShieldedPool, consensus::{BlockHeight, BranchId, TEST_NETWORK}};

fn inspect(bytes: &[u8], connection: Connection, expected_height: u32) -> Result<serde_json::Value, &'static str> {
    let transaction = Pczt::parse(bytes).map_err(|_| "Invalid transaction file")?;
    if *transaction.global().tx_version() != 6 || transaction.ironwood().actions().len() != 2
        || !transaction.orchard().actions().is_empty() || !transaction.sapling().spends().is_empty()
        || !transaction.sapling().outputs().is_empty() || !transaction.transparent().inputs().is_empty()
        || !transaction.transparent().outputs().is_empty() {
        return Err("Expected the bounded Ironwood payment");
    }
    if expected_height == 0 || expected_height >= 499_999_999 {
        return Err("Invalid target height");
    }
    let target = expected_height + 1;
    if *transaction.global().expiry_height() < target
        || *transaction.global().consensus_branch_id() != u32::from(BranchId::for_height(&TEST_NETWORK, BlockHeight::from_u32(target))) {
        return Err("Expired transaction or changed network branch");
    }
    rusqlite::vtab::array::load_module(&connection).map_err(|_| "Cannot inspect wallet storage")?;
    let mut selected = None;
    let mut root_bytes = None;
    Verifier::new(transaction).with_ironwood::<&'static str, _>(|bundle| {
        let mut check = || -> Result<(), &'static str> {
            if !bundle.flags().spends_enabled() || !bundle.flags().outputs_enabled() { return Err("Payment inputs or outputs disabled"); }
            bundle.verify_cross_address_restriction().map_err(|_| "Invalid cross-address restriction")?;
            root_bytes = Some(bundle.anchor().to_bytes());
            for action in bundle.actions() {
                let spend = action.spend();
                let value = spend.value().ok_or("Missing input value")?.inner();
                if value == 0 { continue; }
                if selected.is_some() || spend.spend_auth_sig().is_some() { return Err("Expected one unsigned real input"); }
                spend.verify_nullifier(None).map_err(|_| "Invalid input nullifier or ownership")?;
                let note = Note::from_parts(*spend.recipient().as_ref().ok_or("Missing input recipient")?,
                    *spend.value().as_ref().ok_or("Missing input value")?, *spend.rho().as_ref().ok_or("Missing input rho")?,
                    *spend.rseed().as_ref().ok_or("Missing input seed")?, *spend.note_version())
                    .into_option().ok_or("Invalid input note")?;
                let witness = spend.witness().as_ref().ok_or("Missing input witness")?;
                if witness.root(note.commitment().into()) != *bundle.anchor() { return Err("Input witness does not match the committed anchor"); }
                selected = Some((spend.nullifier().to_bytes(), note, u64::from(witness.position())));
            }
            Ok(())
        };
        check().map_err(OrchardError::Custom)
    }).map_err(|error| match error { OrchardError::Custom(reason) => reason, _ => "Invalid Ironwood bundle" })?;
    let (nullifier, expected_note, position) = selected.ok_or("Missing real input")?;
    let root_bytes = root_bytes.ok_or("Missing anchor")?;
    let (source_txid, index): (Vec<u8>, u32) = connection.query_row(
        "SELECT t.txid, rn.action_index FROM ironwood_received_notes rn JOIN transactions t ON t.id_tx=rn.transaction_id WHERE rn.nf=?1",
        [nullifier.as_slice()], |row| Ok((row.get(0)?,row.get(1)?)))
        .map_err(|_| "Input is not a uniquely known native wallet note")?;
    let source_txid: [u8;32] = source_txid.try_into().map_err(|_| "Invalid source transaction")?;
    let checkpoints: Vec<u32> = connection.prepare("SELECT checkpoint_id FROM ironwood_tree_checkpoints WHERE checkpoint_id<=?1 ORDER BY checkpoint_id DESC LIMIT 128")
        .map_err(|_| "Cannot inspect retained anchors")?.query_map([expected_height], |row| row.get(0))
        .map_err(|_| "Cannot inspect retained anchors")?.collect::<Result<_,_>>()
        .map_err(|_| "Cannot inspect retained anchors")?;
    let mut wallet = WalletDb::from_connection(connection, TEST_NETWORK, (), ());
    let chain = wallet.chain_height().map_err(|_| "Cannot inspect wallet height")?.ok_or("Wallet height unavailable")?;
    let scanned = wallet.block_fully_scanned().map_err(|_| "Cannot inspect scan readiness")?.ok_or("Wallet scan readiness unavailable")?;
    if u32::from(chain) != expected_height || scanned.block_height() != chain {
        return Err("Wallet is not fully scanned to the selected server tip");
    }
    let input = wallet.get_spendable_note(&TxId::from_bytes(source_txid),ShieldedPool::Ironwood,index,
        TargetHeight::from(target),LockFilter::Policy(&LockedInputPolicy::Exclude))
        .map_err(|_| "Cannot inspect current note eligibility")?.ok_or("Input is already spent, locked or unavailable")?;
    let native_note = match input.note() { WalletNote::Orchard { note, pool:orchard::ValuePool::Ironwood } => note, _ => return Err("Input belongs to another pool") };
    if *native_note != expected_note || u64::from(input.note_commitment_tree_position()) != position {
        return Err("Native input note differs from the approved witness");
    }
    let retained = wallet.with_ironwood_tree_mut::<_,_,SqliteClientError>(|tree| {
        for height in &checkpoints {
            if let Some(root) = tree.root_at_checkpoint_id(&BlockHeight::from_u32(*height))? {
                if root.to_bytes() == root_bytes { return Ok(true); }
            }
        }
        Ok(false)
    }).map_err(|_| "Cannot inspect current retained anchor")?.unwrap_or(false);
    if !retained { return Err("Approved anchor is not retained in the current wallet chain"); }
    Ok(serde_json::json!({"network":"testnet","pool":"ironwood","walletHeight":expected_height,
        "currentInputs":true,"witnessVerified":true,"pcztSha256":format!("{:x}",Sha256::digest(bytes))}))
}

fn inspect_expired_input(bytes: &[u8], connection: Connection, expected_height: u32) -> Result<serde_json::Value, &'static str> {
    let transaction = Pczt::parse(bytes).map_err(|_| "Invalid transaction file")?;
    if *transaction.global().tx_version() != 6 || transaction.ironwood().actions().len() != 2
        || !transaction.orchard().actions().is_empty() || !transaction.sapling().spends().is_empty()
        || !transaction.sapling().outputs().is_empty() || !transaction.transparent().inputs().is_empty()
        || !transaction.transparent().outputs().is_empty() {
        return Err("Expected the bounded Ironwood payment");
    }
    let expiry = *transaction.global().expiry_height();
    if expected_height == 0 || expected_height >= 499_999_999 || expiry == 0 || expiry >= 500_000_000
        || expiry.checked_add(10).is_none_or(|minimum| expected_height < minimum) {
        return Err("The original transaction is not beyond the expiry confirmation boundary");
    }
    let mut selected = None;
    Verifier::new(transaction).with_ironwood::<&'static str, _>(|bundle| {
        let mut check = || -> Result<(), &'static str> {
            if !bundle.flags().spends_enabled() || !bundle.flags().outputs_enabled() { return Err("Payment inputs or outputs disabled"); }
            bundle.verify_cross_address_restriction().map_err(|_| "Invalid cross-address restriction")?;
            for action in bundle.actions() {
                let spend = action.spend();
                let value = spend.value().ok_or("Missing input value")?.inner();
                if value == 0 { continue; }
                if selected.is_some() || spend.spend_auth_sig().is_some() { return Err("Expected one unsigned real input"); }
                spend.verify_nullifier(None).map_err(|_| "Invalid input nullifier or ownership")?;
                let note = Note::from_parts(*spend.recipient().as_ref().ok_or("Missing input recipient")?,
                    *spend.value().as_ref().ok_or("Missing input value")?, *spend.rho().as_ref().ok_or("Missing input rho")?,
                    *spend.rseed().as_ref().ok_or("Missing input seed")?, *spend.note_version())
                    .into_option().ok_or("Invalid input note")?;
                let witness = spend.witness().as_ref().ok_or("Missing input witness")?;
                if witness.root(note.commitment().into()) != *bundle.anchor() { return Err("Input witness does not match the committed anchor"); }
                selected = Some((spend.nullifier().to_bytes(), note, u64::from(witness.position())));
            }
            Ok(())
        };
        check().map_err(OrchardError::Custom)
    }).map_err(|error| match error { OrchardError::Custom(reason) => reason, _ => "Invalid Ironwood bundle" })?;
    let (nullifier, expected_note, position) = selected.ok_or("Missing real input")?;
    rusqlite::vtab::array::load_module(&connection).map_err(|_| "Cannot inspect wallet storage")?;
    connection.execute_batch("BEGIN").map_err(|_| "Cannot snapshot native wallet storage")?;
    let (source_txid, index, source_height, source_hash): (Vec<u8>, u32, u32, Vec<u8>) = connection.query_row(
        "SELECT t.txid, rn.action_index, t.block, b.hash FROM ironwood_received_notes rn
         JOIN transactions t ON t.id_tx=rn.transaction_id JOIN blocks b ON b.height=t.block
         WHERE rn.nf=?1 AND t.mined_height=t.block AND t.mined_height>0 AND t.mined_height<=?2 AND length(b.hash)=32
         AND NOT EXISTS (SELECT 1 FROM ironwood_received_note_spends ns JOIN transactions st ON st.id_tx=ns.transaction_id
             WHERE ns.ironwood_received_note_id=rn.id AND (st.mined_height IS NOT NULL OR st.block IS NOT NULL))",
        rusqlite::params![nullifier.as_slice(),expected_height], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))
        .map_err(|_| "Input is not a uniquely known scanned native wallet note")?;
    let source_txid: [u8;32] = source_txid.try_into().map_err(|_| "Invalid source transaction")?;
    let wallet = WalletDb::from_connection(connection, TEST_NETWORK, (), ());
    let chain = wallet.chain_height().map_err(|_| "Cannot inspect wallet height")?.ok_or("Wallet height unavailable")?;
    let scanned = wallet.block_fully_scanned().map_err(|_| "Cannot inspect scan readiness")?.ok_or("Wallet scan readiness unavailable")?;
    if u32::from(chain) != expected_height || scanned.block_height() != chain {
        return Err("Wallet is not fully scanned to the selected server tip");
    }
    let input = wallet.get_spendable_note(&TxId::from_bytes(source_txid),ShieldedPool::Ironwood,index,
        TargetHeight::from(expected_height+1),LockFilter::Policy(&LockedInputPolicy::Exclude))
        .map_err(|_| "Cannot inspect current note eligibility")?.ok_or("Input is already spent, locked or unavailable")?;
    let native_note = match input.note() { WalletNote::Orchard { note, pool:orchard::ValuePool::Ironwood } => note, _ => return Err("Input belongs to another pool") };
    if *native_note != expected_note || u64::from(input.note_commitment_tree_position()) != position {
        return Err("Native input note differs from the approved witness");
    }
    Ok(serde_json::json!({"network":"testnet","pool":"ironwood","walletHeight":expected_height,
        "expiryHeight":expiry,"currentInputs":true,"sourceBlockHeight":source_height,
        "sourceBlockHash":source_hash.iter().map(|byte|format!("{byte:02x}")).collect::<String>(),
        "pcztSha256":format!("{:x}",Sha256::digest(bytes))}))
}

fn scan_status(connection: Connection, expected_height: u32) -> Result<serde_json::Value, &'static str> {
    if expected_height == 0 || expected_height >= 499_999_999 { return Err("Invalid current height"); }
    let wallet = WalletDb::from_connection(connection, TEST_NETWORK, (), ());
    let chain = wallet.chain_height().map_err(|_| "Cannot inspect wallet height")?.ok_or("Wallet height unavailable")?;
    let scanned = wallet.block_fully_scanned().map_err(|_| "Cannot inspect scan readiness")?.ok_or("Wallet scan readiness unavailable")?;
    if u32::from(chain) != expected_height || scanned.block_height() != chain {
        return Err("Wallet is not fully scanned to the selected server tip");
    }
    let hash: String = scanned.block_hash().0.iter().map(|byte|format!("{byte:02x}")).collect();
    Ok(serde_json::json!({"network":"testnet","walletHeight":expected_height,"fullyScannedHeight":expected_height,"tipHash":hash}))
}

fn chain_endpoint() -> Result<tonic::transport::Endpoint, &'static str> {
    use std::time::Duration;
    use tonic::transport::{Channel, ClientTlsConfig};
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        rustls::crypto::ring::default_provider().install_default().map_err(|_| "Cannot initialize testnet TLS provider")?;
    }
    Channel::from_static("https://testnet.zec.rocks:443")
        .connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(30))
        .tls_config(ClientTlsConfig::new().domain_name("testnet.zec.rocks").assume_http2(true).with_webpki_roots())
        .map_err(|_| "Cannot configure testnet chain observation")
}

async fn chain_observation(selected_height: Option<u32>) -> Result<serde_json::Value, &'static str> {
    use zcash_client_backend::proto::service::{self, compact_tx_streamer_client::CompactTxStreamerClient};
    let endpoint = chain_endpoint()?;
    let channel = endpoint.connect().await.map_err(|_| "Cannot connect for testnet chain observation")?;
    let mut client = CompactTxStreamerClient::new(channel);
    let info = client.get_lightd_info(service::Empty{}).await.map_err(|_| "Cannot inspect testnet network")?.into_inner();
    if info.chain_name != "test" { return Err("Refusing a non-testnet chain observation"); }
    let (height,bytes) = if let Some(height) = selected_height {
        let block = client.get_block(service::BlockId{height:u64::from(height),hash:vec![]}).await
            .map_err(|_| "Cannot inspect the canonical testnet block")?.into_inner();
        if block.height != u64::from(height) { return Err("Canonical block height differs from request"); }
        (block.height,block.hash)
    } else {
        let tip = client.get_latest_block(service::ChainSpec::default()).await.map_err(|_| "Cannot inspect testnet chain tip")?.into_inner();
        (tip.height,tip.hash)
    };
    if height == 0 || height >= 499_999_999 || bytes.len() != 32 { return Err("Invalid testnet chain observation"); }
    let hash: String = bytes.iter().map(|byte|format!("{byte:02x}")).collect();
    Ok(serde_json::json!({"network":"testnet","height":height,"hash":hash}))
}

fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let result = (|| {
        if args.len()==1 && args[0]=="--tip" {
            return tokio::runtime::Runtime::new().map_err(|_| "Cannot start read-only chain observation")?.block_on(chain_observation(None));
        }
        if args.len()==2 && args[0]=="--block" {
            let height=args[1].to_str().and_then(|s|s.parse::<u32>().ok()).filter(|h|*h>0 && *h<499_999_999).ok_or("Invalid canonical block height")?;
            return tokio::runtime::Runtime::new().map_err(|_| "Cannot start read-only chain observation")?.block_on(chain_observation(Some(height)));
        }
        let expired = args.first().is_some_and(|arg|arg=="--expired-input");
        if args.len()!=if expired {4} else {3} { return Err("Expected a PCZT file, native database and current height"); }
        let offset=usize::from(expired);
        let height=args[offset+2].to_str().and_then(|s|s.parse::<u32>().ok()).ok_or("Invalid current height")?;
        if args[0]=="--scan" {
            let connection=Connection::open_with_flags(&args[1],OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "Cannot open native wallet read-only")?;
            return scan_status(connection,height);
        }
        let meta=fs::metadata(&args[offset]).map_err(|_| "Cannot read transaction file")?;
        if !meta.is_file() || meta.len()==0 || meta.len()>1_048_576 { return Err("Unsupported transaction file"); }
        let mut bytes=Vec::new();fs::File::open(&args[offset]).map_err(|_| "Cannot read transaction file")?.take(1_048_577)
            .read_to_end(&mut bytes).map_err(|_| "Cannot read transaction file")?;
        if bytes.len()>1_048_576 { return Err("Unsupported transaction file"); }
        let connection=Connection::open_with_flags(&args[offset+1],OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "Cannot open native wallet read-only")?;
        if expired { inspect_expired_input(&bytes,connection,height) } else { inspect(&bytes,connection,height) }
    })();
    match result { Ok(value)=>println!("{value}"),Err(error)=>{eprintln!("{error}");process::exit(1);} }
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchard::{builder::{Builder, BundleType}, bundle::BundleVersion, keys::Scope,
        note::{NoteVersion, RandomSeed, Rho}, tree::{MerkleHashOrchard, MerklePath}, value::NoteValue};
    use pczt::roles::{creator::Creator, io_finalizer::IoFinalizer};
    use rand::{SeedableRng, rngs::StdRng};
    use zcash_keys::keys::UnifiedSpendingKey;
    use zcash_primitives::transaction::{builder::PcztParts, TxVersion};

    const EXPIRED_HEIGHT: u32 = 4_800_050;
    fn expired_fixture() -> (Vec<u8>, Connection) {
        expired_fixture_with_expiry(4_800_040)
    }
    fn expired_fixture_with_expiry(expiry: u32) -> (Vec<u8>, Connection) {
        let sender = UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[0;32], zip32::AccountId::ZERO).unwrap();
        let ufvk = sender.to_unified_full_viewing_key();
        let fvk = ufvk.orchard().unwrap();
        let address = fvk.address_at(0u32, Scope::External);
        let rho = Rho::from_bytes(&[0;32]).unwrap();
        let rseed = (0u8..).find_map(|i| RandomSeed::from_bytes([i;32], &rho).into_option()).unwrap();
        let note = Note::from_parts(address, NoteValue::from_raw(100_000_000), rho, rseed, NoteVersion::V3).unwrap();
        let nullifier = note.nullifier(fvk).to_bytes();
        let path = MerklePath::from_parts(0, [MerkleHashOrchard::from_bytes(&[0;32]).unwrap();32]);
        let version = BundleVersion::ironwood_v3();
        let mut builder = Builder::new(BundleType::DEFAULT, version, version.default_flags(), path.root(note.commitment().into())).unwrap();
        builder.add_spend(fvk.clone(), note, path).unwrap();
        builder.add_output(None, address, NoteValue::from_raw(1_000_000), [0;512]).unwrap();
        builder.add_output(None, fvk.address_at(0u32, Scope::Internal), NoteValue::from_raw(98_990_000), [0;512]).unwrap();
        let mut rng = StdRng::from_seed([2;32]);
        let (bundle, _) = builder.build_for_pczt(&mut rng).unwrap();
        let parts = PcztParts {params:TEST_NETWORK,version:TxVersion::V6,consensus_branch_id:BranchId::Nu6_3,
            lock_time:0,expiry_height:expiry.into(),transparent:None,sapling:None,orchard:None,ironwood:Some(bundle)};
        let pczt = IoFinalizer::new(Creator::build_from_parts(parts).unwrap()).finalize_io(rng).unwrap();
        let bytes = pczt::v2::Pczt::try_from(pczt).unwrap().serialize();
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE accounts (id INTEGER PRIMARY KEY, birthday_height INTEGER, ufvk TEXT);
            CREATE TABLE blocks (height INTEGER PRIMARY KEY, hash BLOB, sapling_commitment_tree_size INTEGER, sapling_tree BLOB, orchard_commitment_tree_size INTEGER, ironwood_commitment_tree_size INTEGER);
            CREATE TABLE scan_queue (block_range_start INTEGER, block_range_end INTEGER, priority INTEGER);
            CREATE TABLE transactions (id_tx INTEGER PRIMARY KEY, txid BLOB, mined_height INTEGER, block INTEGER, expiry_height INTEGER, min_observed_height INTEGER);
            CREATE TABLE ironwood_received_notes (id INTEGER PRIMARY KEY, transaction_id INTEGER, action_index INTEGER, account_id INTEGER, diversifier BLOB, value INTEGER, rho BLOB, rseed BLOB, nf BLOB UNIQUE, commitment_tree_position INTEGER, recipient_key_scope INTEGER, note_version INTEGER, lock_expiry_height INTEGER, lock_owner BLOB);
            CREATE TABLE ironwood_received_note_spends (ironwood_received_note_id INTEGER, transaction_id INTEGER);
            CREATE TABLE transparent_received_output_spends (transparent_received_output_id INTEGER, transaction_id INTEGER);
            CREATE TABLE transparent_received_outputs (id INTEGER, account_id INTEGER, transaction_id INTEGER);
            INSERT INTO scan_queue VALUES (4800000,4800051,10);
            INSERT INTO blocks VALUES (4800050,zeroblob(32),0,x'',0,2);
            INSERT INTO blocks VALUES (4800000,zeroblob(32),0,x'',0,1);
            INSERT INTO transactions VALUES (1,zeroblob(32),4800000,4800000,NULL,4800000);").unwrap();
        db.execute("INSERT INTO accounts VALUES (1,4800000,?1)", [ufvk.encode(&TEST_NETWORK).unwrap()]).unwrap();
        db.execute("INSERT INTO ironwood_received_notes VALUES (1,1,0,1,?1,100000000,?2,?3,?4,0,0,3,NULL,NULL)",
            rusqlite::params![address.diversifier().as_array(),rho.to_bytes(),rseed.as_bytes(),nullifier]).unwrap();
        (bytes, db)
    }

    #[test]
    fn expired_original_retains_its_exact_unspent_native_input_without_private_fields() {
        let (bytes, db) = expired_fixture();
        let result = inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).unwrap();
        assert_eq!(result["currentInputs"],true);
        assert_eq!(result["walletHeight"],4_800_050);
        assert_eq!(result["expiryHeight"],4_800_040);
        assert_eq!(result["sourceBlockHeight"],4_800_000);
        assert_eq!(result["sourceBlockHash"],"00".repeat(32));
        let fields: std::collections::BTreeSet<_> = result.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(fields,["network","pool","walletHeight","expiryHeight","currentInputs","sourceBlockHeight","sourceBlockHash","pcztSha256"].into_iter().collect());
    }

    #[test]
    fn expiry_inspection_requires_the_finite_expiry_and_ten_block_boundary() {
        let (bytes, db) = expired_fixture();
        db.execute("UPDATE scan_queue SET block_range_end=4800050", []).unwrap();
        assert!(inspect_expired_input(&bytes,db,4_800_049).is_err());
        let (bytes, db) = expired_fixture_with_expiry(0);
        assert!(inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).is_err());
    }

    #[test]
    fn expiry_inspection_rejects_malformed_input_and_unavailable_scans() {
        for bytes in [b"".as_slice(),b"not a pczt",b"PCZT\x01\x00\x00\x00"] {
            assert!(inspect_expired_input(bytes,Connection::open_in_memory().unwrap(),EXPIRED_HEIGHT).is_err());
        }
        let (bytes, db) = expired_fixture();
        db.execute("UPDATE scan_queue SET block_range_start=4800001", []).unwrap();
        assert!(inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).is_err());
    }

    #[test]
    fn expiry_inspection_requires_the_same_known_note_and_witness_position() {
        for change in ["DELETE FROM ironwood_received_notes", "UPDATE ironwood_received_notes SET value=99999999",
            "UPDATE ironwood_received_notes SET commitment_tree_position=1", "UPDATE transactions SET block=NULL",
            "UPDATE transactions SET mined_height=4799999"] {
            let (bytes, db) = expired_fixture();
            db.execute_batch(change).unwrap();
            assert!(inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).is_err(),"{change}");
        }
    }

    #[test]
    fn expired_original_cannot_release_a_mined_or_unexpired_conflicting_spend_or_lock() {
        for change in [
            "INSERT INTO transactions VALUES (2,zeroblob(32),4800010,4800010,4800040,4800001); INSERT INTO ironwood_received_note_spends VALUES (1,2)",
            "INSERT INTO transactions VALUES (2,zeroblob(32),NULL,NULL,4800051,4800001); INSERT INTO ironwood_received_note_spends VALUES (1,2)",
            "INSERT INTO transactions VALUES (2,zeroblob(32),4800060,4800060,4800040,4800001); INSERT INTO ironwood_received_note_spends VALUES (1,2)",
            "INSERT INTO transactions VALUES (2,zeroblob(32),NULL,4800010,4800040,4800001); INSERT INTO ironwood_received_note_spends VALUES (1,2)",
            "UPDATE ironwood_received_notes SET lock_expiry_height=4800051,lock_owner=x'01'",
        ] {
            let (bytes, db) = expired_fixture();
            db.execute_batch(change).unwrap();
            assert!(inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).is_err(),"{change}");
        }
    }

    #[test]
    fn an_unmined_expired_spend_relation_remains_saved_and_does_not_override_current_eligibility() {
        let (bytes, db) = expired_fixture();
        db.execute_batch("INSERT INTO transactions VALUES (2,zeroblob(32),NULL,NULL,4800040,4800001); INSERT INTO ironwood_received_note_spends VALUES (1,2)").unwrap();
        assert_eq!(inspect_expired_input(&bytes,db,EXPIRED_HEIGHT).unwrap()["currentInputs"],true);
    }

    #[test]
    fn ordinary_input_inspection_still_refuses_the_expired_original() {
        let (bytes, db) = expired_fixture();
        assert!(inspect(&bytes,db,EXPIRED_HEIGHT).is_err());
    }
    #[test]
    fn malformed_input_has_no_readiness_result() {
        for bytes in [b"".as_slice(),b"not a pczt",b"PCZT\x01\x00\x00\x00"] {
            assert!(inspect(bytes,Connection::open_in_memory().unwrap(),100).is_err());
        }
    }
    #[test]
    fn unavailable_scan_has_no_readiness_result() {
        for height in [0,100,499_999_999] {
            assert!(scan_status(Connection::open_in_memory().unwrap(),height).is_err());
        }
    }
    #[test]
    fn testnet_tls_configuration_does_not_panic() {
        let endpoint = chain_endpoint().unwrap();
        assert_eq!(endpoint.uri().scheme_str(),Some("https"));
        assert_eq!(endpoint.uri().authority().unwrap().as_str(),"testnet.zec.rocks:443");
    }
}

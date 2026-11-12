// Read-only transaction review. Effects and memo modes accept a viewing key over stdin.
use std::{env, fs, io::{self, Read}, process};
mod effects;
#[cfg(test)]
mod synthetic_tests;
use pczt::Pczt;
use zcash_protocol::consensus::{BlockHeight, BranchId, TEST_NETWORK};

fn inspect(bytes: &[u8], target_height: u32) -> Result<serde_json::Value, &'static str> {
    let transaction = Pczt::parse(bytes).map_err(|_| "Invalid transaction file")?;
    if *transaction.global().tx_version() != 6
        || transaction.ironwood().actions().len() != 2
        || !transaction.orchard().actions().is_empty()
        || !transaction.sapling().spends().is_empty()
        || !transaction.sapling().outputs().is_empty()
        || !transaction.transparent().inputs().is_empty()
        || !transaction.transparent().outputs().is_empty()
    { return Err("Expected the bounded version-6 Ironwood test payment"); }
    let expiry = *transaction.global().expiry_height();
    if expiry == 0 || expiry >= 500_000_000 || target_height == 0 || target_height >= 500_000_000 {
        return Err("Unsupported expiry or target height");
    }
    let expected: u32 = BranchId::for_height(&TEST_NETWORK, BlockHeight::from_u32(target_height)).into();
    Ok(serde_json::json!({
        "version": 6, "network": "testnet", "expiryHeight": expiry,
        "targetHeight": target_height,
        "branchMatches": *transaction.global().consensus_branch_id() == expected
    }))
}

fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let result = (|| {
        if args.len() != 2 { return Err("Expected a transaction file and target block height"); }
        let effects_mode = args[0] == "--effects";
        let memos_mode = args[0] == "--memos";
        let file = if effects_mode || memos_mode { &args[1] } else { &args[0] };
        let meta = fs::metadata(file).map_err(|_| "Cannot read transaction file")?;
        if !meta.is_file() || meta.len() > 1_048_576 { return Err("Unsupported transaction file"); }
        let mut bytes = Vec::new();
        fs::File::open(file).map_err(|_| "Cannot read transaction file")?.take(1_048_577)
            .read_to_end(&mut bytes).map_err(|_| "Cannot read transaction file")?;
        if bytes.len() > 1_048_576 { return Err("Unsupported transaction file"); }
        if effects_mode || memos_mode {
            let mut input = Vec::new();
            io::stdin().take(16_385).read_to_end(&mut input).map_err(|_| "Cannot read review terms")?;
            if input.len() > 16_384 { return Err("Review terms too large"); }
            let terms = serde_json::from_slice(&input).map_err(|_| "Invalid review terms")?;
            if memos_mode { effects::verify_memos(&bytes, terms) } else { effects::verify(&bytes, terms) }
        } else {
            let height = args[1].to_str().and_then(|s| s.parse::<u32>().ok()).ok_or("Invalid target height")?;
            inspect(&bytes, height)
        }
    })();
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => { eprintln!("{error}"); process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_input_has_no_partial_review() {
        for bytes in [&b""[..], &b"not a pczt"[..], &b"PCZT\x01\x00\x00\x00"[..]] {
            assert!(inspect(bytes, 4_563_326).is_err());
        }
    }
}

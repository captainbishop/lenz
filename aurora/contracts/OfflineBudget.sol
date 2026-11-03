// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice A budget's isolated caller at a venue. Only its creating budget manager
///         can invoke it; there is no generic public forwarding or withdrawal path.
contract BudgetCall {
    address private immutable manager;
    error Unauthorized();
    error CallFailed();
    constructor() { manager = msg.sender; }
    /// @notice Accept route refunds; they are owner-recoverable, not a new budget.
    receive() external payable {}
    /// @notice Forward this call's ETH to the fixed-policy target selected by the manager.
    /// @param target Venue or adapter checked by the manager.
    /// @param data Exact signed call bytes checked by the manager.
    function run(address target, bytes calldata data) external payable {
        if (msg.sender != manager) revert Unauthorized();
        (bool ok,) = target.call{value: msg.value}(data);
        if (!ok) revert CallFailed();
    }
    /// @notice Return this caller's residual native funds to the manager-selected owner.
    /// @param owner Original funding owner, checked by the manager.
    function sweep(address owner) external {
        if (msg.sender != manager) revert Unauthorized();
        if (address(this).balance != 0) {
            (bool ok,) = owner.call{value: address(this).balance}("");
            if (!ok) revert CallFailed();
        }
    }
}

/// @title Lenz source-asset offline budget rehearsal
/// @notice Local-only enforcement candidate. It does not provide private settlement.
/// @dev No administrator, upgrade, delegatecall or unlimited wallet allowance. Only
///      deposited ETH is at risk. The offline signer is delegated authority over
///      that deposit within a fixed route, price floor, per-call debit and fee cap.
contract OfflineBudget {
    bytes32 public constant PUBLIC_REHEARSAL = keccak256("lenz/public-local-rehearsal/v1");
    bytes32 private constant DOMAIN_TYPE = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ORDER_TYPE = keccak256("Order(uint256 budgetId,uint256 nonce,uint128 amount,uint128 minOutput,uint128 fee,address feeRecipient,uint64 deadline,bytes32 dataHash,bytes32 privacyPolicy)");
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Policy {
        address signer;
        address target;
        bytes32 targetCodeHash;
        bytes4 selector;
        address outputToken;
        bytes32 outputCodeHash;
        address beneficiary;
        uint128 maxDebit;
        uint128 maxFee;
        uint128 minOutputPerEth;
        uint64 expiresAt;
        bytes32 privacyPolicy;
    }
    struct Budget {
        address owner;
        BudgetCall executor;
        uint128 remaining;
        uint256 nonce;
        bool revoked;
        Policy policy;
    }
    struct Order {
        uint256 budgetId;
        uint256 nonce;
        uint128 amount;
        uint128 minOutput;
        uint128 fee;
        address feeRecipient;
        uint64 deadline;
        bytes32 dataHash;
        bytes32 privacyPolicy;
    }
    mapping(uint256 => Budget) private budgets;
    uint256 public nextBudgetId = 1;
    uint256 public totalRemaining;
    bool private entered;

    error InvalidPolicy();
    error Unauthorized();
    error Unavailable();
    error InvalidOrder();
    error InvalidSignature();
    error RouteChanged();
    error ExecutionFailed();
    error InsufficientOutput();
    error TransferFailed();
    error Reentrant();

    event Funded(uint256 indexed budgetId, address indexed owner, address signer, uint256 amount);
    event Executed(uint256 indexed budgetId, uint256 indexed nonce, bytes32 digest, uint256 debit, uint256 output);
    event Revoked(uint256 indexed budgetId);
    event Withdrawn(uint256 indexed budgetId, uint256 amount);
    event Recovered(uint256 indexed budgetId, address target, bytes32 dataHash);

    modifier guarded() {
        if (entered) revert Reentrant();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Prevent accidental use of this public rehearsal on a funded network.
    constructor() { if (block.chainid != 31337) revert Unavailable(); }

    /// @notice Fund a new immutable policy using only ETH attached to this call.
    /// @param p Fixed route and limits. Code hashes do not authenticate proxy dependencies.
    /// @return id Unique budget ID in this deployment.
    function fund(Policy calldata p) external payable guarded returns (uint256 id) {
        if (msg.value == 0 || msg.value > type(uint128).max || p.signer == address(0)
            || p.target == address(this) || p.target.code.length == 0
            || p.target.codehash != p.targetCodeHash || p.selector == bytes4(0)
            || p.beneficiary == address(0) || p.beneficiary == address(this)
            || p.maxDebit == 0 || p.maxFee > p.maxDebit || p.minOutputPerEth == 0
            || p.expiresAt <= block.timestamp || p.privacyPolicy != PUBLIC_REHEARSAL) revert InvalidPolicy();
        if (p.outputToken == address(0)) {
            if (p.outputCodeHash != bytes32(0)) revert InvalidPolicy();
        } else if (p.outputToken.code.length == 0 || p.outputToken.codehash != p.outputCodeHash) revert InvalidPolicy();
        id = nextBudgetId++;
        Budget storage b = budgets[id];
        b.owner = msg.sender;
        b.executor = new BudgetCall();
        b.remaining = uint128(msg.value);
        b.policy = p;
        totalRemaining += msg.value;
        emit Funded(id, msg.sender, p.signer, msg.value);
    }

    /// @notice Read the exact policy, unspent deposit and next nonce.
    /// @param id Budget ID.
    /// @return Current budget state; an unknown ID has a zero owner.
    function getBudget(uint256 id) external view returns (Budget memory) { return budgets[id]; }

    /// @notice Compute a chain- and deployment-bound EIP-712 instruction digest.
    /// @param o Exact signed order.
    /// @return Typed-data digest. It contains no Lenz social identity.
    function orderDigest(Order calldata o) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPE, keccak256("LenzOfflineBudget"), keccak256("1"), block.chainid, address(this)));
        bytes32 body = keccak256(abi.encode(ORDER_TYPE, o.budgetId, o.nonce, o.amount, o.minOutput, o.fee, o.feeRecipient, o.deadline, o.dataHash, o.privacyPolicy));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    /// @notice Execute one offline-signed instruction. Any sender may relay it.
    /// @dev State changes, venue call, output check and fee are one local EVM
    ///      transaction. This is not a claim of cross-chain atomicity. An execution
    ///      failure reverts the nonce and debit, so the same order remains usable
    ///      until expiry or revocation. The fee goes only to its signed recipient.
    /// @param o Signed amounts, nonce, deadline, calldata hash and privacy policy.
    /// @param data Exact call bytes for the policy's fixed target and selector.
    /// @param signature Canonical 65-byte secp256k1 signature from the offline signer.
    /// @return output Measured increase at the policy beneficiary.
    function execute(Order calldata o, bytes calldata data, bytes calldata signature) external guarded returns (uint256 output) {
        Budget storage b = budgets[o.budgetId];
        Policy storage p = b.policy;
        if (b.owner == address(0) || b.revoked || block.timestamp >= p.expiresAt) revert Unavailable();
        uint256 debit = uint256(o.amount) + o.fee;
        uint256 floor = (uint256(o.amount) * p.minOutputPerEth + 1 ether - 1) / 1 ether;
        if (o.nonce != b.nonce || o.amount == 0 || o.minOutput == 0 || o.minOutput < floor
            || debit > b.remaining || debit > p.maxDebit || o.fee > p.maxFee
            || o.feeRecipient == address(0) || o.feeRecipient == address(this)
            || o.deadline <= block.timestamp || o.deadline > p.expiresAt
            || o.privacyPolicy != p.privacyPolicy || data.length < 4
            || data.length > 16384 || bytes4(data[:4]) != p.selector || keccak256(data) != o.dataHash) revert InvalidOrder();
        bytes32 digest = orderDigest(o);
        if (recover(digest, signature) != p.signer) revert InvalidSignature();
        if (p.target.codehash != p.targetCodeHash || (p.outputToken != address(0) && p.outputToken.codehash != p.outputCodeHash)) revert RouteChanged();
        b.nonce++;
        b.remaining -= uint128(debit);
        totalRemaining -= debit;
        if (o.fee != 0) {
            (bool paid,) = o.feeRecipient.call{value: o.fee}("");
            if (!paid) revert TransferFailed();
        }
        // Measure after the fee callback so it cannot alter the final output or
        // count a fee paid to the beneficiary as venue proceeds.
        uint256 beforeOutput = outputBalance(p.outputToken, p.beneficiary);
        try b.executor.run{value: o.amount}(p.target, data) {} catch { revert ExecutionFailed(); }
        uint256 afterOutput = outputBalance(p.outputToken, p.beneficiary);
        if (afterOutput < beforeOutput || afterOutput - beforeOutput < o.minOutput) revert InsufficientOutput();
        output = afterOutput - beforeOutput;
        emit Executed(o.budgetId, o.nonce, digest, debit, output);
    }

    /// @notice Immediately revoke on chain, even if the owner's receiver rejects ETH.
    /// @param id Budget controlled by the caller. Pending transactions may win ordering.
    function revoke(uint256 id) external guarded {
        Budget storage b = budgets[id];
        if (msg.sender != b.owner) revert Unauthorized();
        b.revoked = true;
        emit Revoked(id);
    }

    /// @notice Close and return all unspent ETH to the original funding owner.
    /// @param id Budget controlled by the caller. No caller-chosen withdrawal address.
    function withdraw(uint256 id) external guarded {
        Budget storage b = budgets[id];
        if (msg.sender != b.owner) revert Unauthorized();
        b.revoked = true;
        uint256 amount = b.remaining;
        b.remaining = 0;
        totalRemaining -= amount;
        (bool ok,) = b.owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(id, amount);
    }

    /// @notice Revoke delegation and recover a position/reward through its isolated
    ///         caller. This requires the funding owner's transaction, not the
    ///         offline key. No unspent budget ETH is forwarded. Route-specific
    ///         recovery calldata still requires wallet review; it may select a
    ///         different selector or related token contract to exit a position.
    /// @param id Budget controlled by the caller.
    /// @param target Contract the owner explicitly authorizes for recovery.
    /// @param data Exact owner-authorized recovery bytes; empty permits native sweep.
    function recoverPosition(uint256 id, address target, bytes calldata data) external guarded {
        Budget storage b = budgets[id];
        if (msg.sender != b.owner) revert Unauthorized();
        b.revoked = true;
        if (data.length != 0) {
            if (target.code.length == 0 || data.length > 16384) revert InvalidOrder();
            b.executor.run(target, data);
        }
        b.executor.sweep(b.owner);
        emit Recovered(id, target, keccak256(data));
    }

    function outputBalance(address token, address beneficiary) private view returns (uint256) {
        if (token == address(0)) return beneficiary.balance;
        (bool ok, bytes memory value) = token.staticcall(abi.encodeWithSelector(bytes4(keccak256("balanceOf(address)")), beneficiary));
        if (!ok || value.length != 32) revert RouteChanged();
        return abi.decode(value, (uint256));
    }

    function recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}

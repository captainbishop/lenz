// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface IIntentAsset {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool);
}

interface IIntentAdapter {
    function swap(uint256 amount, uint256 minimum, address recipient) external;
    function inputToken() external view returns (address);
    function outputToken() external view returns (address);
}

interface IPrivateIntentPool {
    function token() external view returns (address);
    function denomination() external view returns (uint256);
    function levels() external view returns (uint32);
    function verifier() external view returns (address);
    function hasher() external view returns (address);
    function withdraw(bytes calldata proof, bytes32 root, bytes32 nullifierHash, address payable recipient, address payable relayer, uint256 fee, uint256 refund) external payable;
}

library IntentAsset {
    function callToken(address token, bytes memory data) internal {
        (bool success, bytes memory result) = token.call(data);
        require(success && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), "Token operation failed");
    }
    function transfer(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        uint256 beforeBalance = IIntentAsset(token).balanceOf(recipient);
        callToken(token, abi.encodeCall(IIntentAsset.transfer, (recipient, amount)));
        require(IIntentAsset(token).balanceOf(recipient) == beforeBalance + amount, "Incorrect recipient credit");
    }
}

/// @notice Executes one immutable swap from a proof-funded vault.
/// @dev Anyone may execute or refund, but neither payout address can change.
contract PrivateIntentVault {
    struct Terms {
        address inputToken;
        address outputToken;
        address adapter;
        uint256 inputAmount;
        uint256 minOutput;
        uint256 deadline;
        address beneficiary;
        address refundRecipient;
        uint256 chainId;
    }
    address public immutable inputToken;
    address public immutable outputToken;
    address public immutable adapter;
    bytes32 public immutable inputCodeHash;
    bytes32 public immutable outputCodeHash;
    bytes32 public immutable adapterCodeHash;
    uint256 public immutable inputAmount;
    uint256 public immutable minOutput;
    uint256 public immutable deadline;
    address public immutable beneficiary;
    address public immutable refundRecipient;
    uint256 public immutable chainId;
    // 0 awaits funding, 1 is processing, 2 executed, 3 refunded.
    uint8 public status;

    constructor(Terms memory terms) {
        require(terms.chainId == block.chainid, "Wrong chain");
        require(terms.inputToken != terms.outputToken, "Identical assets");
        require(terms.inputToken.code.length > 0 && terms.outputToken.code.length > 0 && terms.adapter.code.length > 0, "Missing code");
        require(terms.beneficiary != address(0) && terms.refundRecipient != address(0), "Missing recipient");
        require(terms.beneficiary != address(this) && terms.refundRecipient != address(this), "Vault cannot receive payout");
        require(terms.inputAmount > 0 && terms.minOutput > 0, "Empty swap");
        inputToken = terms.inputToken;
        outputToken = terms.outputToken;
        adapter = terms.adapter;
        inputCodeHash = terms.inputToken.codehash;
        outputCodeHash = terms.outputToken.codehash;
        adapterCodeHash = terms.adapter.codehash;
        inputAmount = terms.inputAmount;
        minOutput = terms.minOutput;
        deadline = terms.deadline;
        beneficiary = terms.beneficiary;
        refundRecipient = terms.refundRecipient;
        chainId = terms.chainId;
    }

    function checkCode() private view {
        require(block.chainid == chainId, "Wrong chain");
        require(inputToken.codehash == inputCodeHash && outputToken.codehash == outputCodeHash && adapter.codehash == adapterCodeHash, "Changed code");
    }

    /// @notice Pays the beneficiary only after exact input consumption and minimum output.
    function execute() external {
        require(status == 0, "Intent already resolved");
        require(block.timestamp <= deadline, "Intent expired");
        checkCode();
        uint256 inputBefore = IIntentAsset(inputToken).balanceOf(address(this));
        require(inputBefore >= inputAmount, "Intent not funded");
        uint256 outputBefore = IIntentAsset(outputToken).balanceOf(address(this));
        status = 1;
        IntentAsset.callToken(inputToken, abi.encodeCall(IIntentAsset.approve, (adapter, 0)));
        IntentAsset.callToken(inputToken, abi.encodeCall(IIntentAsset.approve, (adapter, inputAmount)));
        IIntentAdapter(adapter).swap(inputAmount, minOutput, address(this));
        IntentAsset.callToken(inputToken, abi.encodeCall(IIntentAsset.approve, (adapter, 0)));
        require(IIntentAsset(inputToken).allowance(address(this), adapter) == 0, "Allowance remains");
        require(IIntentAsset(inputToken).balanceOf(address(this)) == inputBefore - inputAmount, "Incorrect input consumption");
        uint256 received = IIntentAsset(outputToken).balanceOf(address(this)) - outputBefore;
        require(received >= minOutput, "Minimum output not met");
        IntentAsset.transfer(outputToken, beneficiary, received);
        IntentAsset.transfer(outputToken, refundRecipient, outputBefore);
        IntentAsset.transfer(inputToken, refundRecipient, inputBefore - inputAmount);
        status = 2;
    }

    /// @notice Returns funded assets to the fixed refund recipient after the deadline.
    function refund() external {
        require(status == 0, "Intent already resolved");
        require(block.timestamp > deadline, "Intent still active");
        checkCode();
        uint256 inputBalance = IIntentAsset(inputToken).balanceOf(address(this));
        require(inputBalance >= inputAmount, "Intent not funded");
        status = 1;
        IntentAsset.transfer(inputToken, refundRecipient, inputBalance);
        IntentAsset.transfer(outputToken, refundRecipient, IIntentAsset(outputToken).balanceOf(address(this)));
        status = 3;
    }

    /// @notice Recovers later donations without reactivating the resolved intent.
    function recoverExtras() external {
        require(status == 2 || status == 3, "Intent unresolved");
        checkCode();
        uint8 resolved = status;
        status = 1;
        IntentAsset.transfer(inputToken, refundRecipient, IIntentAsset(inputToken).balanceOf(address(this)));
        IntentAsset.transfer(outputToken, refundRecipient, IIntentAsset(outputToken).balanceOf(address(this)));
        status = resolved;
    }
}

/// @notice A funded, fixed-rate test venue; it does not represent external liquidity.
contract FixedRateIntentAdapter is IIntentAdapter {
    address public immutable inputToken;
    address public immutable outputToken;
    uint256 public immutable numerator;
    uint256 public immutable denominator;

    constructor(address input, address output, uint256 rateNumerator, uint256 rateDenominator) {
        require(input != output && input.code.length > 0 && output.code.length > 0, "Invalid assets");
        require(rateNumerator > 0 && rateDenominator > 0, "Invalid rate");
        inputToken = input;
        outputToken = output;
        numerator = rateNumerator;
        denominator = rateDenominator;
    }

    function swap(uint256 amount, uint256 minimum, address recipient) external {
        require(amount > 0 && recipient != address(0) && recipient != address(this), "Invalid swap");
        uint256 payout = amount * numerator / denominator;
        require(payout >= minimum && payout > 0, "Minimum output not met");
        uint256 beforeBalance = IIntentAsset(inputToken).balanceOf(address(this));
        IntentAsset.callToken(inputToken, abi.encodeCall(IIntentAsset.transferFrom, (msg.sender, address(this), amount)));
        require(IIntentAsset(inputToken).balanceOf(address(this)) == beforeBalance + amount, "Incorrect input credit");
        IntentAsset.transfer(outputToken, recipient, payout);
    }
}

/// @notice Binds an original pool withdrawal to one deterministic swap vault.
/// @dev No administrator can change the pool, asset, adapter or payout terms.
contract PrivateIntentFactory {
    struct Plan {
        address beneficiary;
        address refundRecipient;
        address relayer;
        uint256 relayerFee;
        uint256 minOutput;
        uint256 deadline;
        bytes32 salt;
    }
    address public immutable pool;
    address public immutable inputToken;
    address public immutable outputToken;
    address public immutable adapter;
    address public immutable verifier;
    address public immutable hasher;
    uint256 public immutable denomination;
    uint256 public immutable chainId;
    bytes32 public immutable poolCodeHash;
    bytes32 public immutable inputCodeHash;
    bytes32 public immutable outputCodeHash;
    bytes32 public immutable adapterCodeHash;
    bytes32 public immutable verifierCodeHash;
    bytes32 public immutable hasherCodeHash;
    event IntentVault(address indexed vault, bytes32 indexed planHash);

    constructor(address originalPool, address receivedToken, address fixedAdapter, uint256 expectedChainId) {
        require(expectedChainId == block.chainid, "Wrong chain");
        require(originalPool.code.length > 0 && receivedToken.code.length > 0 && fixedAdapter.code.length > 0, "Missing code");
        IPrivateIntentPool instance = IPrivateIntentPool(originalPool);
        address source = instance.token();
        address proofVerifier = instance.verifier();
        address treeHasher = instance.hasher();
        require(source.code.length > 0 && proofVerifier.code.length > 0 && treeHasher.code.length > 0, "Missing pool dependency");
        require(instance.levels() == 20 && instance.denomination() > 0, "Unsupported pool");
        require(IIntentAdapter(fixedAdapter).inputToken() == source && IIntentAdapter(fixedAdapter).outputToken() == receivedToken, "Wrong adapter assets");
        require(source != receivedToken, "Identical assets");
        pool = originalPool;
        inputToken = source;
        outputToken = receivedToken;
        adapter = fixedAdapter;
        verifier = proofVerifier;
        hasher = treeHasher;
        denomination = instance.denomination();
        chainId = expectedChainId;
        poolCodeHash = originalPool.codehash;
        inputCodeHash = source.codehash;
        outputCodeHash = receivedToken.codehash;
        adapterCodeHash = fixedAdapter.codehash;
        verifierCodeHash = proofVerifier.codehash;
        hasherCodeHash = treeHasher.codehash;
    }

    function checkCode() private view {
        require(block.chainid == chainId, "Wrong chain");
        require(pool.codehash == poolCodeHash && inputToken.codehash == inputCodeHash && outputToken.codehash == outputCodeHash && adapter.codehash == adapterCodeHash, "Changed route code");
        require(verifier.codehash == verifierCodeHash && hasher.codehash == hasherCodeHash, "Changed proof code");
    }

    function terms(Plan calldata plan) private view returns (PrivateIntentVault.Terms memory) {
        require(plan.relayerFee < denomination, "Invalid fee");
        require(plan.relayerFee == 0 || plan.relayer != address(0), "Missing relayer");
        require(plan.beneficiary != address(0) && plan.refundRecipient != address(0) && plan.minOutput > 0, "Invalid plan");
        return PrivateIntentVault.Terms(inputToken, outputToken, adapter, denomination - plan.relayerFee, plan.minOutput, plan.deadline, plan.beneficiary, plan.refundRecipient, chainId);
    }

    /// @notice Returns the recipient committed by the original withdrawal proof.
    function vaultAddress(Plan calldata plan) public view returns (address) {
        bytes32 initHash = keccak256(abi.encodePacked(type(PrivateIntentVault).creationCode, abi.encode(terms(plan))));
        // Include fee and relayer even when two plans have the same vault balance.
        bytes32 salt = keccak256(abi.encode(chainId, plan));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
    }

    function deploy(Plan calldata plan) public returns (PrivateIntentVault vault) {
        checkCode();
        address predicted = vaultAddress(plan);
        if (predicted.code.length == 0) {
            vault = new PrivateIntentVault{salt: keccak256(abi.encode(chainId, plan))}(terms(plan));
            require(address(vault) == predicted, "Wrong vault address");
            emit IntentVault(predicted, keccak256(abi.encode(chainId, address(this), plan)));
        } else {
            vault = PrivateIntentVault(predicted);
        }
    }

    /// @notice Atomically withdraws and executes only the proof's committed plan.
    function fulfill(Plan calldata plan, bytes calldata proof, bytes32 root, bytes32 nullifierHash) external {
        require(block.timestamp <= plan.deadline, "Intent expired");
        PrivateIntentVault vault = deploy(plan);
        IPrivateIntentPool(pool).withdraw(proof, root, nullifierHash, payable(address(vault)), payable(plan.relayer), plan.relayerFee, 0);
        vault.execute();
    }

    /// @notice Completes an already funded vault after direct submission to the pool.
    function recover(Plan calldata plan) external {
        PrivateIntentVault vault = deploy(plan);
        if (block.timestamp <= plan.deadline) vault.execute();
        else vault.refund();
    }

    /// @notice Uses an expired note's exact plan to return funds to its fixed recipient.
    function withdrawRefund(Plan calldata plan, bytes calldata proof, bytes32 root, bytes32 nullifierHash) external {
        require(block.timestamp > plan.deadline, "Intent still active");
        PrivateIntentVault vault = deploy(plan);
        IPrivateIntentPool(pool).withdraw(proof, root, nullifierHash, payable(address(vault)), payable(plan.relayer), plan.relayerFee, 0);
        vault.refund();
    }
}

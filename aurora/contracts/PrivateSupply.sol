// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface ISupplyAsset {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

interface ISupplyReceipt {
    function scaledBalanceOf(address account) external view returns (uint256);
    function POOL() external view returns (address);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

interface IAaveSupplyPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

interface IOriginalSupplyPool {
    function token() external view returns (address);
    function denomination() external view returns (uint256);
    function levels() external view returns (uint32);
    function verifier() external view returns (address);
    function hasher() external view returns (address);
    function withdraw(bytes calldata proof, bytes32 root, bytes32 nullifierHash, address payable recipient, address payable relayer, uint256 fee, uint256 refund) external payable;
}

library SupplyAsset {
    function callToken(address token, bytes memory data) internal {
        (bool success, bytes memory result) = token.call(data);
        require(success && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), "Token operation failed");
    }

    function transfer(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        uint256 beforeBalance = ISupplyAsset(token).balanceOf(recipient);
        callToken(token, abi.encodeCall(ISupplyAsset.transfer, (recipient, amount)));
        require(ISupplyAsset(token).balanceOf(recipient) == beforeBalance + amount, "Incorrect refund credit");
    }
}

/// @notice Supplies one fixed LINK amount directly to a durable Aave position owner.
/// @dev Proxy code hashes do not freeze Aave implementations. Protocol upgrades remain a governance trust boundary.
contract PrivateSupplyVault {
    struct Terms {
        address inputToken;
        address aavePool;
        address aToken;
        uint256 inputAmount;
        uint256 minScaledCredit;
        uint256 deadline;
        address beneficiary;
        address refundRecipient;
        uint256 chainId;
        bytes32 salt;
        bytes32 inputCodeHash;
        bytes32 aavePoolCodeHash;
        bytes32 aTokenCodeHash;
    }

    address public immutable inputToken;
    address public immutable aavePool;
    address public immutable aToken;
    uint256 public immutable inputAmount;
    uint256 public immutable minScaledCredit;
    uint256 public immutable deadline;
    address public immutable beneficiary;
    address public immutable refundRecipient;
    uint256 public immutable chainId;
    bytes32 public immutable salt;
    bytes32 public immutable inputCodeHash;
    bytes32 public immutable aavePoolCodeHash;
    bytes32 public immutable aTokenCodeHash;
    // 0 awaits funding, 1 is processing, 2 supplied, 3 refunded.
    uint8 public status;
    event Supplied(address indexed beneficiary, uint256 inputAmount, uint256 scaledCredit);
    event Refunded(address indexed recipient, uint256 inputAmount);

    constructor(Terms memory terms) {
        require(terms.chainId == block.chainid, "Wrong chain");
        require(terms.inputToken.code.length > 0 && terms.inputToken.codehash == terms.inputCodeHash, "Changed input code");
        require(terms.aavePool != address(0) && terms.aToken != address(0) && terms.inputToken != terms.aToken, "Invalid supply route");
        require(terms.aavePoolCodeHash != bytes32(0) && terms.aTokenCodeHash != bytes32(0), "Missing route pins");
        require(terms.beneficiary != address(0) && terms.refundRecipient != address(0), "Missing recipient");
        require(terms.beneficiary != address(this) && terms.refundRecipient != address(this), "Vault cannot receive payout");
        require(terms.inputAmount > 0 && terms.minScaledCredit > 0, "Empty supply");
        inputToken = terms.inputToken;
        aavePool = terms.aavePool;
        aToken = terms.aToken;
        inputAmount = terms.inputAmount;
        minScaledCredit = terms.minScaledCredit;
        deadline = terms.deadline;
        beneficiary = terms.beneficiary;
        refundRecipient = terms.refundRecipient;
        chainId = terms.chainId;
        salt = terms.salt;
        inputCodeHash = terms.inputCodeHash;
        aavePoolCodeHash = terms.aavePoolCodeHash;
        aTokenCodeHash = terms.aTokenCodeHash;
    }

    function checkInput() private view {
        require(block.chainid == chainId, "Wrong chain");
        require(inputToken.codehash == inputCodeHash, "Changed input code");
    }

    function checkSupplyRoute() private view {
        checkInput();
        require(aavePool.codehash == aavePoolCodeHash && aToken.codehash == aTokenCodeHash, "Changed Aave code");
        require(ISupplyReceipt(aToken).POOL() == aavePool && ISupplyReceipt(aToken).UNDERLYING_ASSET_ADDRESS() == inputToken, "Changed receipt identity");
    }

    /// @notice Credits the fixed owner only after exact LINK debit and minimum scaled aLINK credit.
    function execute() external {
        require(status == 0, "Supply already resolved");
        require(block.timestamp <= deadline, "Supply expired");
        checkSupplyRoute();
        uint256 inputBefore = ISupplyAsset(inputToken).balanceOf(address(this));
        require(inputBefore >= inputAmount, "Supply not funded");
        uint256 creditBefore = ISupplyReceipt(aToken).scaledBalanceOf(beneficiary);
        status = 1;
        SupplyAsset.callToken(inputToken, abi.encodeCall(ISupplyAsset.approve, (aavePool, 0)));
        SupplyAsset.callToken(inputToken, abi.encodeCall(ISupplyAsset.approve, (aavePool, inputAmount)));
        require(ISupplyAsset(inputToken).allowance(address(this), aavePool) == inputAmount, "Incorrect allowance");
        IAaveSupplyPool(aavePool).supply(inputToken, inputAmount, beneficiary, 0);
        SupplyAsset.callToken(inputToken, abi.encodeCall(ISupplyAsset.approve, (aavePool, 0)));
        require(ISupplyAsset(inputToken).allowance(address(this), aavePool) == 0, "Allowance remains");
        require(ISupplyAsset(inputToken).balanceOf(address(this)) == inputBefore - inputAmount, "Incorrect input consumption");
        uint256 scaledCredit = ISupplyReceipt(aToken).scaledBalanceOf(beneficiary) - creditBefore;
        require(scaledCredit >= minScaledCredit, "Minimum scaled credit not met");
        SupplyAsset.transfer(inputToken, refundRecipient, inputBefore - inputAmount);
        status = 2;
        emit Supplied(beneficiary, inputAmount, scaledCredit);
    }

    /// @notice Returns unconsumed LINK after expiry; supplied aLINK remains owned by the beneficiary.
    function refund() external {
        require(status == 0, "Supply already resolved");
        require(block.timestamp > deadline, "Supply still active");
        checkInput();
        uint256 inputBalance = ISupplyAsset(inputToken).balanceOf(address(this));
        require(inputBalance >= inputAmount, "Supply not funded");
        status = 1;
        SupplyAsset.transfer(inputToken, refundRecipient, inputBalance);
        status = 3;
        emit Refunded(refundRecipient, inputBalance);
    }

    /// @notice Returns later LINK donations to the fixed refund recipient without reactivating the vault.
    function recoverExtras() external {
        require(status == 2 || status == 3, "Supply unresolved");
        checkInput();
        uint8 resolved = status;
        status = 1;
        SupplyAsset.transfer(inputToken, refundRecipient, ISupplyAsset(inputToken).balanceOf(address(this)));
        status = resolved;
    }
}

/// @notice Binds the original 20-level ERC20 withdrawal relation to a deterministic Supply vault.
/// @dev Relayer, fee and native refund are always zero; there is no administrator or arbitrary call target.
contract PrivateSupplyFactory {
    struct Plan {
        address beneficiary;
        address refundRecipient;
        uint256 minScaledCredit;
        uint256 deadline;
        bytes32 salt;
    }

    address public immutable privacyPool;
    address public immutable inputToken;
    address public immutable aavePool;
    address public immutable aToken;
    address public immutable verifier;
    address public immutable hasher;
    uint256 public immutable denomination;
    uint256 public immutable chainId;
    bytes32 public immutable privacyPoolCodeHash;
    bytes32 public immutable inputCodeHash;
    bytes32 public immutable aavePoolCodeHash;
    bytes32 public immutable aTokenCodeHash;
    bytes32 public immutable verifierCodeHash;
    bytes32 public immutable hasherCodeHash;
    bool private processing;
    event SupplyVault(address indexed vault, bytes32 indexed planHash);

    modifier nonReentrant() {
        require(!processing, "Supply processing");
        processing = true;
        _;
        processing = false;
    }

    constructor(address originalPool, address lendingPool, address receiptToken, uint256 expectedChainId) {
        require(expectedChainId == block.chainid, "Wrong chain");
        require(originalPool.code.length > 0 && lendingPool.code.length > 0 && receiptToken.code.length > 0, "Missing code");
        IOriginalSupplyPool instance = IOriginalSupplyPool(originalPool);
        address source = instance.token();
        address proofVerifier = instance.verifier();
        address treeHasher = instance.hasher();
        require(source.code.length > 0 && proofVerifier.code.length > 0 && treeHasher.code.length > 0, "Missing proof dependency");
        require(instance.levels() == 20 && instance.denomination() > 0, "Unsupported original pool");
        require(source != receiptToken && ISupplyReceipt(receiptToken).POOL() == lendingPool && ISupplyReceipt(receiptToken).UNDERLYING_ASSET_ADDRESS() == source, "Wrong receipt identity");
        privacyPool = originalPool;
        inputToken = source;
        aavePool = lendingPool;
        aToken = receiptToken;
        verifier = proofVerifier;
        hasher = treeHasher;
        denomination = instance.denomination();
        chainId = expectedChainId;
        privacyPoolCodeHash = originalPool.codehash;
        inputCodeHash = source.codehash;
        aavePoolCodeHash = lendingPool.codehash;
        aTokenCodeHash = receiptToken.codehash;
        verifierCodeHash = proofVerifier.codehash;
        hasherCodeHash = treeHasher.codehash;
    }

    function checkInput() private view {
        require(block.chainid == chainId, "Wrong chain");
        require(inputToken.codehash == inputCodeHash, "Changed input code");
    }

    function checkFundingRoute() private view {
        checkInput();
        require(privacyPool.codehash == privacyPoolCodeHash && verifier.codehash == verifierCodeHash && hasher.codehash == hasherCodeHash, "Changed proof code");
        IOriginalSupplyPool instance = IOriginalSupplyPool(privacyPool);
        require(instance.token() == inputToken && instance.denomination() == denomination && instance.levels() == 20 && instance.verifier() == verifier && instance.hasher() == hasher, "Changed proof relation");
    }

    function terms(Plan calldata plan) private view returns (PrivateSupplyVault.Terms memory) {
        require(plan.beneficiary != address(0) && plan.refundRecipient != address(0) && plan.minScaledCredit > 0, "Invalid plan");
        return PrivateSupplyVault.Terms(inputToken, aavePool, aToken, denomination, plan.minScaledCredit, plan.deadline, plan.beneficiary, plan.refundRecipient, chainId, plan.salt, inputCodeHash, aavePoolCodeHash, aTokenCodeHash);
    }

    /// @notice Returns the recipient that must be committed by the original withdrawal proof.
    function vaultAddress(Plan calldata plan) public view returns (address) {
        bytes32 initHash = keccak256(abi.encodePacked(type(PrivateSupplyVault).creationCode, abi.encode(terms(plan))));
        bytes32 salt = keccak256(abi.encode(chainId, plan));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
    }

    /// @notice Creates or returns the same vault, retaining the factory's original code pins.
    function deploy(Plan calldata plan) public returns (PrivateSupplyVault vault) {
        checkInput();
        address predicted = vaultAddress(plan);
        if (predicted.code.length == 0) {
            vault = new PrivateSupplyVault{salt: keccak256(abi.encode(chainId, plan))}(terms(plan));
            require(address(vault) == predicted, "Wrong vault address");
            emit SupplyVault(predicted, keccak256(abi.encode(chainId, address(this), plan)));
        } else vault = PrivateSupplyVault(predicted);
    }

    /// @notice Atomically withdraws the original note and supplies only its committed plan.
    function fulfill(Plan calldata plan, bytes calldata proof, bytes32 root, bytes32 nullifierHash) external nonReentrant {
        require(block.timestamp <= plan.deadline, "Supply expired");
        checkFundingRoute();
        PrivateSupplyVault vault = deploy(plan);
        require(vault.status() == 0, "Supply already resolved");
        uint256 beforeBalance = ISupplyAsset(inputToken).balanceOf(address(vault));
        IOriginalSupplyPool(privacyPool).withdraw(proof, root, nullifierHash, payable(address(vault)), payable(address(0)), 0, 0);
        require(ISupplyAsset(inputToken).balanceOf(address(vault)) == beforeBalance + denomination, "Incorrect funding credit");
        vault.execute();
    }

    /// @notice Completes the same vault after an original withdrawal submitted directly to the pool.
    function recover(Plan calldata plan) external nonReentrant {
        PrivateSupplyVault vault = deploy(plan);
        if (block.timestamp <= plan.deadline) vault.execute();
        else vault.refund();
    }

    /// @notice Withdraws an expired original note into its committed vault and refunds unconsumed LINK.
    function withdrawRefund(Plan calldata plan, bytes calldata proof, bytes32 root, bytes32 nullifierHash) external nonReentrant {
        require(block.timestamp > plan.deadline, "Supply still active");
        checkFundingRoute();
        PrivateSupplyVault vault = deploy(plan);
        require(vault.status() == 0, "Supply already resolved");
        uint256 beforeBalance = ISupplyAsset(inputToken).balanceOf(address(vault));
        IOriginalSupplyPool(privacyPool).withdraw(proof, root, nullifierHash, payable(address(vault)), payable(address(0)), 0, 0);
        require(ISupplyAsset(inputToken).balanceOf(address(vault)) == beforeBalance + denomination, "Incorrect funding credit");
        vault.refund();
    }
}

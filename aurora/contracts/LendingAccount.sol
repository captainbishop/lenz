// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface ILendingToken {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address account, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

interface ILendingReceipt is ILendingToken {
    function POOL() external view returns (address);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function scaledBalanceOf(address account) external view returns (uint256);
}

interface ILendingPool {
    struct ReserveData {
        uint256 configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }
    function borrow(address asset, uint256 amount, uint256 mode, uint16 referral, address owner) external;
    function repay(address asset, uint256 amount, uint256 mode, address owner) external returns (uint256);
    function withdraw(address asset, uint256 amount, address recipient) external returns (uint256);
    function getReserveData(address asset) external view returns (ReserveData memory);
    function getUserAccountData(address account) external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
}

library LendingToken {
    function callToken(address token, bytes memory data) internal {
        (bool ok, bytes memory result) = token.call(data);
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), "Token call failed");
    }

    function payout(address token, address recipient, uint256 amount) internal {
        if (recipient == address(this)) return;
        uint256 beforeBalance = ILendingToken(token).balanceOf(recipient);
        uint256 beforeSource = ILendingToken(token).balanceOf(address(this));
        callToken(token, abi.encodeCall(ILendingToken.transfer, (recipient, amount)));
        require(ILendingToken(token).balanceOf(recipient) == beforeBalance + amount, "Incorrect payout credit");
        require(ILendingToken(token).balanceOf(address(this)) == beforeSource - amount, "Incorrect payout debit");
    }
}

/// @notice One recoverable owner controls a fixed Aave testnet position through exact relayed permissions.
/// @dev Aave proxy upgrades remain a governance trust boundary; proxy hashes do not freeze implementations.
contract LendingAccount {
    struct Route {
        address pool;
        address link;
        address usdc;
        address aLink;
        address variableDebt;
        uint256 chainId;
        bytes32 poolCodeHash;
        bytes32 linkCodeHash;
        bytes32 usdcCodeHash;
        bytes32 aLinkCodeHash;
        bytes32 variableDebtCodeHash;
    }
    /// @dev Actions: 0 borrows USDC, 1 repays USDC, 2 withdraws LINK.
    ///      Amount/minResult use that action's underlying token units. Repay minResult is
    ///      the minimum actual repayment; Borrow and Withdraw require the exact amount.
    ///      maxDebt uses USDC units, minHealthFactor uses WAD, maxBorrowRateRay uses RAY.
    struct Order {
        uint8 action;
        uint256 nonce;
        uint256 deadline;
        uint256 amount;
        address recipient;
        uint256 minResult;
        uint256 maxDebt;
        uint256 minHealthFactor;
        uint256 maxBorrowRateRay;
    }
    struct Transfer {
        uint8 asset;
        uint256 nonce;
        uint256 deadline;
        uint256 amount;
        address recipient;
    }

    bytes32 private constant DOMAIN_TYPE = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ORDER_TYPE = keccak256("Order(uint8 action,uint256 nonce,uint256 deadline,uint256 amount,address recipient,uint256 minResult,uint256 maxDebt,uint256 minHealthFactor,uint256 maxBorrowRateRay)");
    bytes32 private constant CANCEL_TYPE = keccak256("Cancel(uint256 nonce,uint256 deadline)");
    bytes32 private constant TRANSFER_TYPE = keccak256("Transfer(uint8 asset,uint256 nonce,uint256 deadline,uint256 amount,address recipient)");
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    address public immutable owner;
    uint256 public nonce;
    Route private policy;
    bool private processing;
    event Executed(uint256 indexed nonce, bytes32 indexed digest, uint8 action, uint256 amount, address recipient, uint256 result);
    event Cancelled(uint256 indexed nonce, bytes32 indexed digest);
    event Transferred(uint256 indexed nonce, bytes32 indexed digest, address token, uint256 amount, address recipient);

    modifier guarded() {
        require(!processing, "Lending account processing");
        processing = true;
        _;
        processing = false;
    }

    constructor(address accountOwner, Route memory route) {
        require(accountOwner != address(0) && accountOwner != address(this), "Missing owner");
        require(route.chainId == block.chainid && (route.chainId == 11155111 || route.chainId == 31337), "Wrong testnet");
        require(route.link != route.usdc && route.link != route.aLink && route.usdc != route.variableDebt, "Invalid assets");
        owner = accountOwner;
        policy = route;
        checkRoute();
    }

    function getRoute() external view returns (Route memory) { return policy; }

    function checkRoute() private view returns (uint256 rate) {
        Route memory r = policy;
        require(block.chainid == r.chainId, "Wrong chain");
        require(r.pool.code.length > 0 && r.pool.codehash == r.poolCodeHash, "Changed pool code");
        require(r.link.code.length > 0 && r.link.codehash == r.linkCodeHash && r.usdc.code.length > 0 && r.usdc.codehash == r.usdcCodeHash, "Changed asset code");
        require(r.aLink.code.length > 0 && r.aLink.codehash == r.aLinkCodeHash && r.variableDebt.code.length > 0 && r.variableDebt.codehash == r.variableDebtCodeHash, "Changed receipt code");
        require(ILendingReceipt(r.aLink).POOL() == r.pool && ILendingReceipt(r.aLink).UNDERLYING_ASSET_ADDRESS() == r.link, "Changed collateral receipt");
        require(ILendingReceipt(r.variableDebt).POOL() == r.pool && ILendingReceipt(r.variableDebt).UNDERLYING_ASSET_ADDRESS() == r.usdc, "Changed debt receipt");
        require(ILendingPool(r.pool).getReserveData(r.link).aTokenAddress == r.aLink, "Changed LINK reserve");
        ILendingPool.ReserveData memory debtReserve = ILendingPool(r.pool).getReserveData(r.usdc);
        require(debtReserve.variableDebtTokenAddress == r.variableDebt, "Changed USDC reserve");
        return debtReserve.currentVariableBorrowRate;
    }

    /// @notice Returns the exact chain- and account-bound digest an owner approves.
    function orderDigest(Order calldata order) public view returns (bytes32) {
        bytes32 body = keccak256(abi.encode(ORDER_TYPE, order.action, order.nonce, order.deadline, order.amount, order.recipient, order.minResult, order.maxDebt, order.minHealthFactor, order.maxBorrowRateRay));
        return typedDigest(body);
    }

    function typedDigest(bytes32 body) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPE, keccak256("LenzLendingAccount"), keccak256("1"), block.chainid, address(this)));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    /// @notice Cancels the current nonce through a separate owner permission, even if Aave is unavailable.
    /// @dev Cancellation and execution compete for chain ordering; only a finalized nonce settles the conflict.
    function cancel(uint256 expectedNonce, uint256 deadline, bytes calldata signature) external guarded {
        require(block.chainid == policy.chainId && expectedNonce == nonce && deadline > block.timestamp, "Cancellation expired or used");
        bytes32 digest = typedDigest(keccak256(abi.encode(CANCEL_TYPE, expectedNonce, deadline)));
        require(recoverSigner(digest, signature) == owner, "Wrong owner");
        nonce++;
        emit Cancelled(expectedNonce, digest);
    }

    /// @notice Returns the owner digest for an exact free-balance transfer; asset 0 is LINK, 1 is USDC.
    function transferDigest(Transfer calldata transfer) public view returns (bytes32) {
        return typedDigest(keccak256(abi.encode(TRANSFER_TYPE, transfer.asset, transfer.nonce, transfer.deadline, transfer.amount, transfer.recipient)));
    }

    /// @notice Releases only fixed underlying tokens. Aave availability is unnecessary for free funds.
    function transferFunds(Transfer calldata transfer, bytes calldata signature) external guarded {
        require(block.chainid == policy.chainId && transfer.nonce == nonce && transfer.deadline > block.timestamp, "Permission expired or used");
        require(transfer.asset <= 1 && transfer.amount > 0 && transfer.recipient != address(0) && transfer.recipient != address(this), "Invalid transfer");
        bytes32 digest = transferDigest(transfer);
        require(recoverSigner(digest, signature) == owner, "Wrong owner");
        address token = transfer.asset == 0 ? policy.link : policy.usdc;
        bytes32 codeHash = transfer.asset == 0 ? policy.linkCodeHash : policy.usdcCodeHash;
        require(token.code.length > 0 && token.codehash == codeHash, "Changed asset code");
        require(ILendingToken(token).balanceOf(address(this)) >= transfer.amount, "Insufficient free funds");
        nonce++;
        LendingToken.payout(token, transfer.recipient, transfer.amount);
        emit Transferred(transfer.nonce, digest, token, transfer.amount, transfer.recipient);
    }

    function recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        require(signature.length == 65, "Invalid signature");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(uint256(s) <= HALF_N && (v == 27 || v == 28), "Invalid signature");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
    }

    function health(uint256 minimum) private view {
        (, uint256 debt,,,, uint256 factor) = ILendingPool(policy.pool).getUserAccountData(address(this));
        require(debt == 0 || factor >= minimum, "Health bound not met");
    }

    // Use Aave's post-operation stored index: an unused debt reserve need not apply its earlier projection.
    function scaledAmount(uint256 amount, uint256 index) private pure returns (uint256 scaled) {
        require(index >= 1e27 && amount <= (type(uint256).max - index / 2) / 1e27, "Invalid indexed amount");
        scaled = (amount * 1e27 + index / 2) / index;
        require(scaled > 0, "Amount rounds to zero");
    }

    /// @notice Executes only the fixed protocol action and signed bounds. Any sender may relay it.
    function execute(Order calldata order, bytes calldata signature) external guarded returns (uint256 result) {
        require(order.nonce == nonce && order.deadline > block.timestamp, "Permission expired or used");
        require(order.amount > 0 && order.amount != type(uint256).max && order.recipient != address(0), "Invalid amount or recipient");
        require(order.action <= 2, "Unsupported action");
        bytes32 digest = orderDigest(order);
        require(recoverSigner(digest, signature) == owner, "Wrong owner");
        uint256 rate = checkRoute();
        nonce++;
        if (order.action == 0) result = borrow(order, rate);
        else if (order.action == 1) result = repay(order);
        else result = withdraw(order);
        emit Executed(order.nonce, digest, order.action, order.amount, order.recipient, result);
    }

    function borrow(Order calldata order, uint256 rate) private returns (uint256) {
        require(order.minResult == order.amount && order.minHealthFactor >= 1e18 && order.maxBorrowRateRay > 0, "Invalid borrow bounds");
        require(rate <= order.maxBorrowRateRay, "Borrow rate bound not met");
        health(order.minHealthFactor);
        Route memory r = policy;
        uint256 beforeBalance = ILendingToken(r.usdc).balanceOf(address(this));
        uint256 beforeDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        uint256 beforeScaled = ILendingReceipt(r.variableDebt).scaledBalanceOf(address(this));
        ILendingPool(r.pool).borrow(r.usdc, order.amount, 2, 0, address(this));
        require(ILendingToken(r.usdc).balanceOf(address(this)) == beforeBalance + order.amount, "Incorrect borrow credit");
        uint256 afterDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        require(afterDebt > beforeDebt && afterDebt <= order.maxDebt, "Debt bound not met");
        uint256 index = ILendingPool(r.pool).getReserveData(r.usdc).variableBorrowIndex;
        require(ILendingReceipt(r.variableDebt).scaledBalanceOf(address(this)) == beforeScaled + scaledAmount(order.amount, index), "Incorrect scaled debt increase");
        require(checkRoute() <= order.maxBorrowRateRay, "Borrow rate bound not met");
        health(order.minHealthFactor);
        LendingToken.payout(r.usdc, order.recipient, order.amount);
        return order.amount;
    }

    function repay(Order calldata order) private returns (uint256 paid) {
        require(order.recipient == address(this) && order.minResult > 0 && order.minResult <= order.amount && order.minHealthFactor == 0 && order.maxBorrowRateRay == 0, "Invalid repay bounds");
        Route memory r = policy;
        uint256 beforeBalance = ILendingToken(r.usdc).balanceOf(address(this));
        uint256 beforeDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        uint256 beforeScaled = ILendingReceipt(r.variableDebt).scaledBalanceOf(address(this));
        require(beforeDebt > 0, "No debt to repay");
        LendingToken.callToken(r.usdc, abi.encodeCall(ILendingToken.approve, (r.pool, 0)));
        LendingToken.callToken(r.usdc, abi.encodeCall(ILendingToken.approve, (r.pool, order.amount)));
        require(ILendingToken(r.usdc).allowance(address(this), r.pool) == order.amount, "Incorrect repayment allowance");
        paid = ILendingPool(r.pool).repay(r.usdc, order.amount, 2, address(this));
        LendingToken.callToken(r.usdc, abi.encodeCall(ILendingToken.approve, (r.pool, 0)));
        require(ILendingToken(r.usdc).allowance(address(this), r.pool) == 0, "Repayment allowance remains");
        require(paid >= order.minResult && paid <= order.amount && paid <= beforeBalance, "Repayment bound not met");
        require(ILendingToken(r.usdc).balanceOf(address(this)) == beforeBalance - paid, "Incorrect repayment debit");
        uint256 afterDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        require(afterDebt < beforeDebt && afterDebt <= order.maxDebt, "Remaining debt bound not met");
        uint256 index = ILendingPool(r.pool).getReserveData(r.usdc).variableBorrowIndex;
        require(ILendingReceipt(r.variableDebt).scaledBalanceOf(address(this)) + scaledAmount(paid, index) == beforeScaled, "Incorrect scaled debt reduction");
        checkRoute();
    }

    function withdraw(Order calldata order) private returns (uint256 received) {
        require(order.minResult == order.amount && order.minHealthFactor >= 1e18 && order.maxBorrowRateRay == 0, "Invalid withdrawal bounds");
        health(order.minHealthFactor);
        Route memory r = policy;
        uint256 beforeBalance = ILendingToken(r.link).balanceOf(address(this));
        uint256 beforeScaled = ILendingReceipt(r.aLink).scaledBalanceOf(address(this));
        uint256 beforeDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        received = ILendingPool(r.pool).withdraw(r.link, order.amount, address(this));
        require(received == order.amount && ILendingToken(r.link).balanceOf(address(this)) == beforeBalance + received, "Incorrect withdrawal credit");
        uint256 index = ILendingPool(r.pool).getReserveData(r.link).liquidityIndex;
        require(ILendingReceipt(r.aLink).scaledBalanceOf(address(this)) + scaledAmount(received, index) == beforeScaled, "Incorrect scaled collateral debit");
        uint256 afterDebt = ILendingToken(r.variableDebt).balanceOf(address(this));
        require(afterDebt <= beforeDebt && afterDebt <= order.maxDebt, "Remaining debt bound not met");
        health(order.minHealthFactor);
        LendingToken.payout(r.link, order.recipient, received);
        checkRoute();
    }
}

/// @notice Predicts one fixed-route position account per recoverable owner.
contract LendingAccountFactory {
    LendingAccount.Route private policy;
    event Account(address indexed owner, address indexed account);

    constructor(address pool, address link, address usdc, address aLink, address variableDebt, uint256 expectedChainId) {
        require(expectedChainId == block.chainid && (expectedChainId == 11155111 || expectedChainId == 31337), "Wrong testnet");
        require(pool.code.length > 0 && link.code.length > 0 && usdc.code.length > 0 && aLink.code.length > 0 && variableDebt.code.length > 0, "Missing code");
        policy = LendingAccount.Route(pool, link, usdc, aLink, variableDebt, expectedChainId, pool.codehash, link.codehash, usdc.codehash, aLink.codehash, variableDebt.codehash);
    }

    function getRoute() external view returns (LendingAccount.Route memory) { return policy; }

    function accountAddress(address owner) public view returns (address) {
        require(owner != address(0), "Missing owner");
        bytes32 initHash = keccak256(abi.encodePacked(type(LendingAccount).creationCode, abi.encode(owner, policy)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), keccak256(abi.encode(owner)), initHash)))));
    }

    function deploy(address owner) external returns (LendingAccount account) {
        address predicted = accountAddress(owner);
        if (predicted.code.length == 0) {
            account = new LendingAccount{salt: keccak256(abi.encode(owner))}(owner, policy);
            require(address(account) == predicted, "Changed account address");
            emit Account(owner, predicted);
        } else account = LendingAccount(predicted);
    }
}

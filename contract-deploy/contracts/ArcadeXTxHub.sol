// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcadeXTxHub
 * @notice General MiniPay transaction surface for ArcadeX on Celo Mainnet.
 * @dev Free `signIn(purpose)` for activity txs (e.g. play) plus USDT/USDC
 *      `payWith*(purpose)` for future paid flows. Fees are owner-configurable
 *      per purpose so new product uses do not require redeploy / MiniPay re-whitelist.
 *      Ship all entrypoints in v1 — new Solidity functions later need a new allowlist.
 */
contract ArcadeXTxHub {
    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    address public owner;
    address public pendingOwner;
    bool public paused;

    /// @notice Per-purpose fee in token smallest units (USDT/USDC use 6 decimals).
    mapping(bytes32 => uint256) public feeOf;
    /// @notice True after owner calls setFee for that purpose (paid paths require this).
    mapping(bytes32 => bool) public feeConfigured;

    uint256 public totalCollectedUSDT;
    uint256 public totalCollectedUSDC;
    uint256 public totalWithdrawnUSDT;
    uint256 public totalWithdrawnUSDC;

    mapping(address => uint256) public payCountUSDT;
    mapping(address => uint256) public payCountUSDC;
    mapping(address => uint256) public signInCount;

    event SignedIn(address indexed player, bytes32 indexed purpose, uint256 timestamp);
    event EntryPaid(
        address indexed player,
        address indexed token,
        bytes32 indexed purpose,
        uint256 amount,
        uint256 timestamp
    );
    event FeeUpdated(bytes32 indexed purpose, uint256 oldFee, uint256 newFee);
    event WithdrawnUSDT(address indexed to, uint256 amount);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error PausedError();
    error AlreadyPaused();
    error NotPaused();
    error ZeroAddress();
    error InvalidOwner();
    error PurposeNotConfigured();
    error NoBalance();
    error Reentrancy();
    error TransferFailed();
    error TransferAmountMismatch();
    error NoCelo();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrancy();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    /// @notice Gas-only activity / sign-in style tx. No value transfer.
    function signIn(bytes32 purpose) external whenNotPaused {
        unchecked {
            signInCount[msg.sender] += 1;
        }
        emit SignedIn(msg.sender, purpose, block.timestamp);
    }

    function payWithUSDT(bytes32 purpose) external nonReentrant whenNotPaused {
        if (!feeConfigured[purpose]) revert PurposeNotConfigured();
        uint256 amount = feeOf[purpose];

        unchecked {
            payCountUSDT[msg.sender] += 1;
            totalCollectedUSDT += amount;
        }

        _collectPayment(USDT, msg.sender, amount);
        emit EntryPaid(msg.sender, USDT, purpose, amount, block.timestamp);
    }

    function payWithUSDC(bytes32 purpose) external nonReentrant whenNotPaused {
        if (!feeConfigured[purpose]) revert PurposeNotConfigured();
        uint256 amount = feeOf[purpose];

        unchecked {
            payCountUSDC[msg.sender] += 1;
            totalCollectedUSDC += amount;
        }

        _collectPayment(USDC, msg.sender, amount);
        emit EntryPaid(msg.sender, USDC, purpose, amount, block.timestamp);
    }

    /// @notice Configure (or update) the paid fee for a purpose. Enables payWith* for that purpose.
    function setFee(bytes32 purpose, uint256 newFee) external onlyOwner {
        uint256 oldFee = feeOf[purpose];
        feeOf[purpose] = newFee;
        feeConfigured[purpose] = true;
        emit FeeUpdated(purpose, oldFee, newFee);
    }

    function withdrawUSDT() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDT, address(this));
        if (bal == 0) revert NoBalance();
        totalWithdrawnUSDT += bal;
        _safeTransfer(USDT, owner, bal);
        emit WithdrawnUSDT(owner, bal);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDC, address(this));
        if (bal == 0) revert NoBalance();
        totalWithdrawnUSDC += bal;
        _safeTransfer(USDC, owner, bal);
        emit WithdrawnUSDC(owner, bal);
    }

    function pause() external onlyOwner {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == USDT || newOwner == USDC || newOwner == address(this)) {
            revert InvalidOwner();
        }
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function getBalanceUSDT() external view returns (uint256) {
        return _balanceOf(USDT, address(this));
    }

    function getBalanceUSDC() external view returns (uint256) {
        return _balanceOf(USDC, address(this));
    }

    function getStats()
        external
        view
        returns (
            uint256 currentUSDT,
            uint256 currentUSDC,
            uint256 lifetimeUSDT,
            uint256 lifetimeUSDC,
            uint256 withdrawnUSDT,
            uint256 withdrawnUSDC
        )
    {
        currentUSDT = _balanceOf(USDT, address(this));
        currentUSDC = _balanceOf(USDC, address(this));
        lifetimeUSDT = totalCollectedUSDT;
        lifetimeUSDC = totalCollectedUSDC;
        withdrawnUSDT = totalWithdrawnUSDT;
        withdrawnUSDC = totalWithdrawnUSDC;
    }

    function getPayCount(address player) external view returns (uint256) {
        return payCountUSDT[player] + payCountUSDC[player];
    }

    function _collectPayment(address token, address player, uint256 amount) internal {
        uint256 contractBalanceBefore = _balanceOf(token, address(this));
        if (amount > 0) {
            _safeTransferFrom(token, player, address(this), amount);
        }
        uint256 contractBalanceAfter = _balanceOf(token, address(this));
        if (contractBalanceAfter < contractBalanceBefore + amount) {
            revert TransferAmountMismatch();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        if (!(success && (data.length == 0 || abi.decode(data, (bool))))) {
            revert TransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        if (!(success && (data.length == 0 || abi.decode(data, (bool))))) {
            revert TransferFailed();
        }
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", account)
        );
        require(success && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    receive() external payable {
        revert NoCelo();
    }

    fallback() external payable {
        revert NoCelo();
    }
}

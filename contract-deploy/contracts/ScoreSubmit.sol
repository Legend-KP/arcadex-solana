// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ScoreSubmit
 * @notice Pay a configurable fee in USDT or USDC to submit scores on Celo Mainnet.
 * @dev Supports two ERC-20 tokens with separate accounting and shared access control.
 *      The submission fee is owner-adjustable post-deployment (e.g. for promotional discounts)
 *      so it never requires a redeploy / re-whitelisting on integrators like MiniPay.
 */
contract ScoreSubmit {
    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    /// @notice Current submission fee, in the token's smallest unit (USDT/USDC use 6 decimals).
    /// @dev Mutable so the owner can run promotions without redeploying the contract.
    ///      Default: 50_000 = $0.05
    uint256 public fee = 50_000;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    address public owner;
    address public pendingOwner;
    bool public paused;

    uint256 public totalCollectedUSDT;
    uint256 public totalCollectedUSDC;
    uint256 public totalWithdrawnUSDT;
    uint256 public totalWithdrawnUSDC;

    mapping(address => uint256) public payCountUSDT;
    mapping(address => uint256) public payCountUSDC;

    event EntryPaid(address indexed player, address indexed token, uint256 amount, uint256 timestamp);
    event WithdrawnUSDT(address indexed to, uint256 amount);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
    }

    function payWithUSDT() external nonReentrant whenNotPaused {
        uint256 amount = fee;

        payCountUSDT[msg.sender] += 1;
        totalCollectedUSDT += amount;

        _collectPayment(USDT, msg.sender, amount);

        emit EntryPaid(msg.sender, USDT, amount, block.timestamp);
    }

    function payWithUSDC() external nonReentrant whenNotPaused {
        uint256 amount = fee;

        payCountUSDC[msg.sender] += 1;
        totalCollectedUSDC += amount;

        _collectPayment(USDC, msg.sender, amount);

        emit EntryPaid(msg.sender, USDC, amount, block.timestamp);
    }

    function setFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = fee;
        fee = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    function withdrawUSDT() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDT, address(this));
        require(bal > 0, "No USDT to withdraw");
        totalWithdrawnUSDT += bal;
        _safeTransfer(USDT, owner, bal);
        emit WithdrawnUSDT(owner, bal);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 bal = _balanceOf(USDC, address(this));
        require(bal > 0, "No USDC to withdraw");
        totalWithdrawnUSDC += bal;
        _safeTransfer(USDC, owner, bal);
        emit WithdrawnUSDC(owner, bal);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        require(newOwner != USDT, "New owner cannot be USDT contract");
        require(newOwner != USDC, "New owner cannot be USDC contract");
        require(newOwner != address(this), "New owner cannot be this contract");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
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

    function getPayCountUSDT(address player) external view returns (uint256) {
        return payCountUSDT[player];
    }

    function getPayCountUSDC(address player) external view returns (uint256) {
        return payCountUSDC[player];
    }

    function _collectPayment(address token, address player, uint256 amount) internal {
        uint256 contractBalanceBefore = _balanceOf(token, address(this));
        if (amount > 0) {
            _safeTransferFrom(token, player, address(this), amount);
        }
        uint256 contractBalanceAfter = _balanceOf(token, address(this));
        require(
            contractBalanceAfter >= contractBalanceBefore + amount,
            "Transfer amount mismatch"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "transferFrom failed"
        );
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", account)
        );
        require(success && data.length >= 32, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    receive() external payable {
        revert("No CELO accepted");
    }

    fallback() external payable {
        revert("No CELO accepted");
    }
}

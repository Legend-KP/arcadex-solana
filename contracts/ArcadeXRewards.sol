// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IMintable {
    function mintReward(address to) external;
}

/**
 * @title ArcadeXRewards
 * @notice MiniPay hub: STREAK daily check-in + SHUFFLE signed spins + shared claim path.
 *
 * @dev Hardened for safe deployment:
 *      - Interval enforcement after first-ever check-in/spin (no post-reset bypass)
 *      - Campaign core params freeze after first participant
 *      - startTime / endTime windows
 *      - Treasury reservation for USDT/USDC (fixed streak or per-spin won amount)
 *      - cancelCampaign keeps claim() open for earners
 *      - Optional EIP-712 eligibility (Sybil gate) separate from spin-result signatures
 *      - maxClaims enforced at reward reservation time
 *      - maxSinglePayout caps signed shuffle amounts on-chain
 */
contract ArcadeXRewards is ReentrancyGuard, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint8 public constant REWARD_OFFCHAIN = 0;
    uint8 public constant REWARD_ERC721 = 1;
    uint8 public constant REWARD_USDT = 2;
    uint8 public constant REWARD_USDC = 3;

    enum CampaignType {
        STREAK,
        SHUFFLE
    }

    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    bytes32 private constant _ELIGIBLE_TYPEHASH =
        keccak256("Eligible(address player,uint256 campaignId,uint256 deadline)");

    bytes32 private constant _SPIN_TYPEHASH = keccak256(
        "Spin(address player,uint256 campaignId,uint8 rewardMode,address rewardTarget,uint256 rewardAmount,uint256 nonce,uint256 deadline)"
    );

    address public owner;
    address public pendingOwner;
    address public eligibilitySigner;
    /// @notice Dedicated key for authorizing shuffle spin outcomes (separate from eligibility).
    address public spinResultSigner;
    bool public paused;

    struct Campaign {
        bool active;
        bool cancelled;
        bool requireEligibility;
        CampaignType campaignType;
        uint16 requiredDays;
        uint32 minIntervalSeconds;
        uint32 maxClaims;
        uint64 startTime;
        uint64 endTime;
        uint8 rewardMode;
        address rewardTarget;
        uint256 rewardAmount;
        bytes32 rewardMeta;
        bool resetAfterMilestone;
        /// @notice On-chain ceiling for a single shuffle payout (USDT/USDC). Ignored for STREAK.
        uint256 maxSinglePayout;
    }

    struct Progress {
        uint16 currentDay;
        uint64 lastCheckInAt;
        bool milestoneReached;
        bool onChainClaimed;
        bool initialized;
    }

    struct WonReward {
        bool pending;
        uint8 rewardMode;
        address rewardTarget;
        uint256 rewardAmount;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(address => mapping(uint256 => Progress)) public progress;
    mapping(address => mapping(uint256 => WonReward)) public wonRewards;
    mapping(uint256 => bool) public hasParticipants;
    mapping(uint256 => uint32) public claimCount;
    /// @notice Replay protection for spin digests.
    mapping(bytes32 => bool) public usedSignatures;
    /// @notice Per-player per-campaign spin nonce (must match signed payload).
    mapping(address => mapping(uint256 => uint256)) public spinNonce;

    uint256 public reservedUSDT;
    uint256 public reservedUSDC;

    error NotOwner();
    error PausedError();
    error CampaignInactive();
    error CampaignIsCancelled();
    error CampaignNotStarted();
    error CampaignEnded();
    error CampaignMisconfigured();
    error TooSoon();
    error SpinTooSoon();
    error StreakComplete();
    error ClaimPending();
    error OffchainNoClaim();
    error StreakIncomplete();
    error AlreadyClaimed();
    error ZeroAddress();
    error ZeroAmount();
    error UnknownRewardMode();
    error ParamsFrozen();
    error InsufficientTreasury();
    error InsufficientWithdrawable();
    error InvalidEligibility();
    error EligibilityExpired();
    error NothingToExpire();
    error AlreadyPaused();
    error NotPaused();
    error UnsupportedReward();
    error NftContractRequired();
    error InvalidCampaignType();
    error MaxClaimsReached();
    error SignatureAlreadyUsed();
    error InvalidSpinSignature();
    error SpinExpired();
    error InvalidSpinNonce();
    error ExceedsMaxPayout();
    error NoWonReward();
    error SpinSignerRequired();

    event CheckedIn(
        address indexed player,
        uint256 indexed campaignId,
        uint16 day,
        uint256 timestamp
    );
    event MilestoneReached(
        address indexed player,
        uint256 indexed campaignId,
        uint16 day,
        uint8 rewardMode,
        bytes32 rewardMeta,
        uint256 timestamp
    );
    event SpinResultGranted(
        address indexed player,
        uint256 indexed campaignId,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        uint256 timestamp
    );
    event SpinSignatureUsed(bytes32 indexed signatureHash);
    event StreakReset(
        address indexed player,
        uint256 indexed campaignId,
        string reason,
        uint256 timestamp
    );
    event OnChainRewardClaimed(
        address indexed player,
        uint256 indexed campaignId,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        uint256 timestamp
    );
    event CampaignUpdated(
        uint256 indexed campaignId,
        bool active,
        uint16 requiredDays,
        uint8 rewardMode,
        uint64 startTime,
        uint64 endTime
    );
    event CampaignCancelled(uint256 indexed campaignId, address indexed by);
    event ReservationReleased(
        address indexed player,
        uint256 indexed campaignId,
        address token,
        uint256 amount
    );
    event EligibilitySignerUpdated(address indexed previousSigner, address indexed newSigner);
    event SpinResultSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WithdrawnUSDT(address indexed to, uint256 amount);
    event WithdrawnUSDC(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor(address initialEligibilitySigner) EIP712("ArcadeXRewards", "1") {
        owner = msg.sender;
        if (initialEligibilitySigner != address(0)) {
            eligibilitySigner = initialEligibilitySigner;
        }
    }

    // ─── Daily check-in (STREAK) ─────────────────────────────────────────────────

    /**
     * @param campaignId Campaign id (must be STREAK)
     * @param deadline EIP-712 eligibility deadline (ignored if campaign does not require it)
     * @param signature Backend eligibility signature (empty if not required)
     */
    function checkIn(uint256 campaignId, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        Campaign memory cfg = campaigns[campaignId];
        if (cfg.campaignType != CampaignType.STREAK) revert InvalidCampaignType();
        if (!cfg.active) revert CampaignInactive();
        if (cfg.cancelled) revert CampaignIsCancelled();
        if (cfg.requiredDays == 0 || cfg.minIntervalSeconds == 0) revert CampaignMisconfigured();
        if (block.timestamp < cfg.startTime) revert CampaignNotStarted();
        if (cfg.endTime != 0 && block.timestamp > cfg.endTime) revert CampaignEnded();

        if (cfg.requireEligibility) {
            _verifyEligibility(msg.sender, campaignId, deadline, signature);
        }

        Progress storage p = progress[msg.sender][campaignId];
        uint64 nowTs = uint64(block.timestamp);

        if (p.milestoneReached && cfg.rewardMode != REWARD_OFFCHAIN) {
            revert ClaimPending();
        }

        if (!p.initialized) {
            // True first-ever check-in for this wallet/campaign — interval skipped once.
            p.initialized = true;
            p.currentDay = 1;
            if (!hasParticipants[campaignId]) {
                hasParticipants[campaignId] = true;
            }
        } else {
            // One check-in per UTC calendar day (resets at 00:00 UTC).
            uint256 lastDay = _utcDay(p.lastCheckInAt);
            uint256 today = _utcDay(nowTs);
            if (today <= lastDay) revert TooSoon();

            // Missed at least one full UTC day since last check-in.
            if (today > lastDay + 1) {
                emit StreakReset(msg.sender, campaignId, "missed_day", nowTs);
                p.currentDay = 1;
                p.milestoneReached = false;
                p.onChainClaimed = false;
            } else if (p.currentDay == 0) {
                // Post off-chain / claim reset — start a new cycle at day 1.
                p.currentDay = 1;
            } else {
                if (p.currentDay >= cfg.requiredDays) revert StreakComplete();
                unchecked {
                    p.currentDay += 1;
                }
            }
        }

        p.lastCheckInAt = nowTs;
        emit CheckedIn(msg.sender, campaignId, p.currentDay, nowTs);

        if (p.currentDay >= cfg.requiredDays) {
            _assertMaxClaimsAvailable(cfg, campaignId);

            p.milestoneReached = true;
            emit MilestoneReached(
                msg.sender,
                campaignId,
                p.currentDay,
                cfg.rewardMode,
                cfg.rewardMeta,
                nowTs
            );

            unchecked {
                claimCount[campaignId] += 1;
            }

            if (cfg.rewardMode == REWARD_USDT) {
                reservedUSDT += cfg.rewardAmount;
            } else if (cfg.rewardMode == REWARD_USDC) {
                reservedUSDC += cfg.rewardAmount;
            }

            if (cfg.resetAfterMilestone && cfg.rewardMode == REWARD_OFFCHAIN) {
                emit StreakReset(msg.sender, campaignId, "milestone_complete", nowTs);
                p.currentDay = 0;
                p.milestoneReached = false;
                p.onChainClaimed = false;
            }
        }
    }

    // ─── Shuffle spin ────────────────────────────────────────────────────────────

    /**
     * @notice Record a signed shuffle outcome. Does not pay out — use claim().
     * @dev EIP-712 Spin typed data must be signed by spinResultSigner.
     */
    function spin(
        uint256 campaignId,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused {
        Campaign memory cfg = campaigns[campaignId];
        if (cfg.campaignType != CampaignType.SHUFFLE) revert InvalidCampaignType();
        if (!cfg.active) revert CampaignInactive();
        if (cfg.cancelled) revert CampaignIsCancelled();
        if (cfg.minIntervalSeconds == 0) revert CampaignMisconfigured();
        if (block.timestamp < cfg.startTime) revert CampaignNotStarted();
        if (cfg.endTime != 0 && block.timestamp > cfg.endTime) revert CampaignEnded();
        if (block.timestamp > deadline) revert SpinExpired();
        if (rewardMode > REWARD_USDC) revert UnknownRewardMode();

        Progress storage p = progress[msg.sender][campaignId];
        WonReward storage won = wonRewards[msg.sender][campaignId];

        if (won.pending || (p.milestoneReached && !p.onChainClaimed)) {
            revert ClaimPending();
        }

        uint64 nowTs = uint64(block.timestamp);
        if (p.initialized) {
            // One spin per UTC calendar day (resets at 00:00 UTC).
            if (_utcDay(nowTs) <= _utcDay(p.lastCheckInAt)) revert SpinTooSoon();
        }

        if (nonce != spinNonce[msg.sender][campaignId]) revert InvalidSpinNonce();

        _normalizeAndValidateSpinReward(cfg, rewardMode, rewardTarget, rewardAmount);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _SPIN_TYPEHASH,
                    msg.sender,
                    campaignId,
                    rewardMode,
                    rewardTarget,
                    rewardAmount,
                    nonce,
                    deadline
                )
            )
        );
        if (usedSignatures[digest]) revert SignatureAlreadyUsed();

        if (spinResultSigner == address(0)) revert SpinSignerRequired();
        address recovered = digest.recover(signature);
        if (recovered != spinResultSigner) revert InvalidSpinSignature();

        usedSignatures[digest] = true;
        unchecked {
            spinNonce[msg.sender][campaignId] = nonce + 1;
        }
        emit SpinSignatureUsed(digest);

        // Resolve targets for storage (USDT/USDC pinned; ERC721 uses signed target).
        address resolvedTarget = rewardTarget;
        if (rewardMode == REWARD_USDT) resolvedTarget = USDT;
        else if (rewardMode == REWARD_USDC) resolvedTarget = USDC;
        else if (rewardMode == REWARD_OFFCHAIN) resolvedTarget = address(0);

        if (!p.initialized) {
            p.initialized = true;
            if (!hasParticipants[campaignId]) {
                hasParticipants[campaignId] = true;
            }
        }

        p.lastCheckInAt = nowTs;
        p.onChainClaimed = false;

        if (rewardMode == REWARD_OFFCHAIN) {
            // Non-winning / off-chain result never goes through claim() — always clear
            // so the next interval can spin (do not depend on resetAfterMilestone).
            p.milestoneReached = false;
            delete wonRewards[msg.sender][campaignId];
        } else {
            _assertMaxClaimsAvailable(cfg, campaignId);
            unchecked {
                claimCount[campaignId] += 1;
            }

            if (rewardMode == REWARD_USDT) {
                reservedUSDT += rewardAmount;
            } else if (rewardMode == REWARD_USDC) {
                reservedUSDC += rewardAmount;
            }

            p.milestoneReached = true;
            won.pending = true;
            won.rewardMode = rewardMode;
            won.rewardTarget = resolvedTarget;
            won.rewardAmount = rewardAmount;
        }

        emit SpinResultGranted(
            msg.sender, campaignId, rewardMode, resolvedTarget, rewardAmount, nowTs
        );
    }

    /**
     * @notice Claim on-chain rewards. STREAK uses campaign defaults; SHUFFLE uses wonRewards.
     * @dev Allowed even if campaign was cancelled.
     */
    function claim(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign memory cfg = campaigns[campaignId];
        Progress storage p = progress[msg.sender][campaignId];

        uint8 mode;
        address target;
        uint256 amount;

        if (cfg.campaignType == CampaignType.SHUFFLE) {
            WonReward storage won = wonRewards[msg.sender][campaignId];
            if (!won.pending) revert NoWonReward();
            if (p.onChainClaimed) revert AlreadyClaimed();
            if (won.rewardMode == REWARD_OFFCHAIN) revert OffchainNoClaim();

            mode = won.rewardMode;
            target = won.rewardTarget;
            amount = won.rewardAmount;

            won.pending = false;
        } else if (cfg.campaignType == CampaignType.STREAK) {
            if (cfg.rewardMode == REWARD_OFFCHAIN) revert OffchainNoClaim();
            if (!p.milestoneReached) revert StreakIncomplete();
            if (p.onChainClaimed) revert AlreadyClaimed();
            if (p.currentDay < cfg.requiredDays) revert StreakIncomplete();

            mode = cfg.rewardMode;
            target = cfg.rewardTarget;
            amount = cfg.rewardAmount;
        } else {
            revert InvalidCampaignType();
        }

        p.onChainClaimed = true;

        if (mode == REWARD_USDT) {
            reservedUSDT -= amount;
        } else if (mode == REWARD_USDC) {
            reservedUSDC -= amount;
        }

        _payout(msg.sender, mode, target, amount);

        emit OnChainRewardClaimed(
            msg.sender, campaignId, mode, target, amount, block.timestamp
        );

        if (cfg.resetAfterMilestone) {
            emit StreakReset(msg.sender, campaignId, "claim_complete", block.timestamp);
            p.currentDay = 0;
            p.milestoneReached = false;
            p.onChainClaimed = false;
            if (cfg.campaignType == CampaignType.SHUFFLE) {
                delete wonRewards[msg.sender][campaignId];
            }
        }
    }

    /**
     * @notice Release reserved funds after campaign end if an earner never claimed.
     */
    function expireUnclaimed(address player, uint256 campaignId) external nonReentrant {
        Campaign memory cfg = campaigns[campaignId];
        Progress storage p = progress[player][campaignId];

        if (!p.milestoneReached || p.onChainClaimed) revert NothingToExpire();
        if (cfg.endTime == 0 || block.timestamp <= cfg.endTime) revert NothingToExpire();

        uint8 mode;
        uint256 amount;

        if (cfg.campaignType == CampaignType.SHUFFLE) {
            WonReward storage won = wonRewards[player][campaignId];
            if (!won.pending) revert NothingToExpire();
            if (won.rewardMode != REWARD_USDT && won.rewardMode != REWARD_USDC) {
                revert NothingToExpire();
            }
            mode = won.rewardMode;
            amount = won.rewardAmount;
            won.pending = false;
        } else {
            if (cfg.rewardMode != REWARD_USDT && cfg.rewardMode != REWARD_USDC) {
                revert NothingToExpire();
            }
            mode = cfg.rewardMode;
            amount = cfg.rewardAmount;
        }

        p.onChainClaimed = true; // lock — cannot claim after expiry sweep
        p.milestoneReached = false;

        if (mode == REWARD_USDT) {
            reservedUSDT -= amount;
            emit ReservationReleased(player, campaignId, USDT, amount);
        } else {
            reservedUSDC -= amount;
            emit ReservationReleased(player, campaignId, USDC, amount);
        }
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setCampaign(
        uint256 campaignId,
        CampaignType campaignType,
        bool active,
        uint16 requiredDays,
        uint32 minIntervalSeconds,
        uint32 maxClaims,
        uint64 startTime,
        uint64 endTime,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        bytes32 rewardMeta,
        bool resetAfterMilestone,
        bool requireEligibility,
        uint256 maxSinglePayout
    ) external onlyOwner {
        if (endTime != 0 && endTime < startTime) revert CampaignMisconfigured();
        if (rewardMode > REWARD_USDC) revert UnknownRewardMode();
        if (minIntervalSeconds == 0) revert CampaignMisconfigured();

        if (campaignType == CampaignType.STREAK) {
            if (requiredDays == 0) revert CampaignMisconfigured();
            if (maxSinglePayout != 0) revert CampaignMisconfigured();
        } else if (campaignType == CampaignType.SHUFFLE) {
            // requiredDays unused; per-spin rewards come from signatures, not campaign defaults.
            if (spinResultSigner == address(0)) revert SpinSignerRequired();
            rewardMode = REWARD_OFFCHAIN;
            rewardTarget = address(0);
            rewardAmount = 0;
        } else {
            revert InvalidCampaignType();
        }

        // Campaign-level reward fields apply to STREAK only (SHUFFLE forced OFFCHAIN above).
        if (campaignType == CampaignType.STREAK) {
            if (rewardMode == REWARD_ERC721) {
                if (rewardTarget == address(0)) revert NftContractRequired();
                if (rewardTarget.code.length == 0) revert NftContractRequired();
            }
            if (rewardMode == REWARD_USDT) {
                rewardTarget = USDT;
                if (rewardAmount == 0) revert ZeroAmount();
            }
            if (rewardMode == REWARD_USDC) {
                rewardTarget = USDC;
                if (rewardAmount == 0) revert ZeroAmount();
            }
            if (rewardMode == REWARD_OFFCHAIN) {
                rewardTarget = address(0);
            }
        }
        if (requireEligibility && eligibilitySigner == address(0)) {
            revert InvalidEligibility();
        }

        Campaign storage existing = campaigns[campaignId];

        if (existing.cancelled) revert CampaignIsCancelled();

        if (hasParticipants[campaignId]) {
            // Core economics frozen after first participant. New rules => new campaignId.
            if (
                campaignType != existing.campaignType ||
                requiredDays != existing.requiredDays ||
                minIntervalSeconds != existing.minIntervalSeconds ||
                rewardMode != existing.rewardMode ||
                rewardTarget != existing.rewardTarget ||
                rewardAmount != existing.rewardAmount ||
                rewardMeta != existing.rewardMeta ||
                resetAfterMilestone != existing.resetAfterMilestone ||
                requireEligibility != existing.requireEligibility ||
                maxClaims != existing.maxClaims ||
                maxSinglePayout != existing.maxSinglePayout ||
                startTime != existing.startTime
            ) {
                revert ParamsFrozen();
            }
            // Allowed post-participation: active flag + endTime (shorten window).
            existing.active = active;
            existing.endTime = endTime;
            emit CampaignUpdated(
                campaignId,
                active,
                existing.requiredDays,
                existing.rewardMode,
                existing.startTime,
                endTime
            );
            return;
        }

        // STREAK: fund fixed reward × maxClaims. SHUFFLE: fund maxSinglePayout × maxClaims
        // (actual token chosen per spin; require either stable can cover the ceiling).
        if (campaignType == CampaignType.STREAK) {
            if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
                uint256 available = _availableBalance(rewardTarget);
                uint256 needed = rewardAmount;
                if (maxClaims > 0) {
                    needed = rewardAmount * uint256(maxClaims);
                }
                if (available < needed) revert InsufficientTreasury();
            }
        } else if (maxSinglePayout > 0 && maxClaims > 0) {
            uint256 needed = maxSinglePayout * uint256(maxClaims);
            if (
                _availableBalance(USDT) < needed && _availableBalance(USDC) < needed
            ) {
                revert InsufficientTreasury();
            }
        }

        campaigns[campaignId] = Campaign({
            active: active,
            cancelled: false,
            requireEligibility: requireEligibility,
            campaignType: campaignType,
            requiredDays: requiredDays,
            minIntervalSeconds: minIntervalSeconds,
            maxClaims: maxClaims,
            startTime: startTime,
            endTime: endTime,
            rewardMode: rewardMode,
            rewardTarget: rewardTarget,
            rewardAmount: rewardAmount,
            rewardMeta: rewardMeta,
            resetAfterMilestone: resetAfterMilestone,
            maxSinglePayout: maxSinglePayout
        });

        emit CampaignUpdated(campaignId, active, requiredDays, rewardMode, startTime, endTime);
    }

    /**
     * @notice Stop new check-ins/spins; earners can still claim() reserved on-chain rewards.
     */
    function cancelCampaign(uint256 campaignId) external onlyOwner {
        Campaign storage cfg = campaigns[campaignId];
        cfg.active = false;
        cfg.cancelled = true;
        emit CampaignCancelled(campaignId, msg.sender);
    }

    function setEligibilitySigner(address newSigner) external onlyOwner {
        emit EligibilitySignerUpdated(eligibilitySigner, newSigner);
        eligibilitySigner = newSigner;
    }

    function setSpinResultSigner(address newSigner) external onlyOwner {
        emit SpinResultSignerUpdated(spinResultSigner, newSigner);
        spinResultSigner = newSigner;
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
        if (newOwner == address(this)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function withdrawUSDT(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > _availableBalance(USDT)) revert InsufficientWithdrawable();
        IERC20(USDT).safeTransfer(to, amount);
        emit WithdrawnUSDT(to, amount);
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > _availableBalance(USDC)) revert InsufficientWithdrawable();
        IERC20(USDC).safeTransfer(to, amount);
        emit WithdrawnUSDC(to, amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    function getCampaign(uint256 campaignId)
        external
        view
        returns (
            bool active,
            bool cancelled,
            bool requireEligibility,
            CampaignType campaignType,
            uint16 requiredDays,
            uint32 minIntervalSeconds,
            uint32 maxClaims,
            uint64 startTime,
            uint64 endTime,
            uint8 rewardMode,
            address rewardTarget,
            uint256 rewardAmount,
            bytes32 rewardMeta,
            bool resetAfterMilestone,
            uint256 maxSinglePayout
        )
    {
        Campaign memory cfg = campaigns[campaignId];
        return (
            cfg.active,
            cfg.cancelled,
            cfg.requireEligibility,
            cfg.campaignType,
            cfg.requiredDays,
            cfg.minIntervalSeconds,
            cfg.maxClaims,
            cfg.startTime,
            cfg.endTime,
            cfg.rewardMode,
            cfg.rewardTarget,
            cfg.rewardAmount,
            cfg.rewardMeta,
            cfg.resetAfterMilestone,
            cfg.maxSinglePayout
        );
    }

    function getWonReward(address player, uint256 campaignId)
        external
        view
        returns (bool pending, uint8 rewardMode, address rewardTarget, uint256 rewardAmount)
    {
        WonReward memory won = wonRewards[player][campaignId];
        return (won.pending, won.rewardMode, won.rewardTarget, won.rewardAmount);
    }

    function getProgress(address player, uint256 campaignId)
        external
        view
        returns (
            uint16 currentDay,
            uint64 lastCheckInAt,
            bool milestoneReached,
            bool onChainClaimed,
            bool initialized,
            bool canCheckIn,
            bool streakWouldReset
        )
    {
        Campaign memory cfg = campaigns[campaignId];
        Progress memory p = progress[player][campaignId];
        currentDay = p.currentDay;
        lastCheckInAt = p.lastCheckInAt;
        milestoneReached = p.milestoneReached;
        onChainClaimed = p.onChainClaimed;
        initialized = p.initialized;

        canCheckIn = false;
        streakWouldReset = false;

        if (
            !cfg.active ||
            cfg.cancelled ||
            cfg.minIntervalSeconds == 0 ||
            block.timestamp < cfg.startTime ||
            (cfg.endTime != 0 && block.timestamp > cfg.endTime)
        ) {
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        WonReward memory won = wonRewards[player][campaignId];
        if (won.pending || (p.milestoneReached && cfg.rewardMode != REWARD_OFFCHAIN)) {
            // Pending claim blocks another check-in / spin.
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        if (!p.initialized) {
            canCheckIn = true;
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        // Eligible again starting at the next 00:00 UTC after lastCheckInAt.
        uint256 lastDay = _utcDay(p.lastCheckInAt);
        uint256 today = _utcDay(block.timestamp);
        canCheckIn = today > lastDay;
        streakWouldReset = cfg.campaignType == CampaignType.STREAK && canCheckIn
            && today > lastDay + 1 && p.currentDay > 0;
    }

    function availableUSDT() external view returns (uint256) {
        return _availableBalance(USDT);
    }

    function availableUSDC() external view returns (uint256) {
        return _availableBalance(USDC);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    /// @dev Unix day index — aligns with UTC calendar dates (00:00 UTC boundaries).
    function _utcDay(uint256 timestamp) internal pure returns (uint256) {
        return timestamp / 1 days;
    }

    function _assertMaxClaimsAvailable(Campaign memory cfg, uint256 campaignId) internal view {
        if (cfg.maxClaims > 0 && claimCount[campaignId] >= cfg.maxClaims) {
            revert MaxClaimsReached();
        }
    }

    function _normalizeAndValidateSpinReward(
        Campaign memory cfg,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount
    ) internal view {
        if (rewardMode == REWARD_OFFCHAIN) {
            return;
        }
        if (rewardMode == REWARD_ERC721) {
            if (rewardTarget == address(0) || rewardTarget.code.length == 0) {
                revert NftContractRequired();
            }
            return;
        }
        if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            if (cfg.maxSinglePayout == 0 || rewardAmount > cfg.maxSinglePayout) {
                revert ExceedsMaxPayout();
            }
            // Ensure treasury can cover this variable reservation.
            address token = rewardMode == REWARD_USDT ? USDT : USDC;
            if (_availableBalance(token) < rewardAmount) revert InsufficientTreasury();
            return;
        }
        revert UnknownRewardMode();
    }

    function _verifyEligibility(
        address player,
        uint256 campaignId,
        uint256 deadline,
        bytes calldata signature
    ) internal view {
        if (block.timestamp > deadline) revert EligibilityExpired();
        if (eligibilitySigner == address(0)) revert InvalidEligibility();

        bytes32 structHash =
            keccak256(abi.encode(_ELIGIBLE_TYPEHASH, player, campaignId, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        if (recovered != eligibilitySigner) revert InvalidEligibility();
    }

    function _availableBalance(address token) internal view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = token == USDT ? reservedUSDT : reservedUSDC;
        if (bal <= reserved) return 0;
        return bal - reserved;
    }

    function _payout(address player, uint8 rewardMode, address rewardTarget, uint256 rewardAmount)
        internal
    {
        if (rewardMode == REWARD_ERC721) {
            if (rewardAmount == 0) {
                _safeMintReward(rewardTarget, player);
            } else {
                IERC721(rewardTarget).safeTransferFrom(address(this), player, rewardAmount);
            }
            return;
        }
        if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
            if (rewardAmount == 0) revert ZeroAmount();
            IERC20(rewardTarget).safeTransfer(player, rewardAmount);
            return;
        }
        revert UnsupportedReward();
    }

    function _safeMintReward(address nft, address to) internal {
        if (nft.code.length == 0) revert NftContractRequired();
        IMintable(nft).mintReward(to);
    }

    receive() external payable {
        revert("No CELO accepted");
    }

    fallback() external payable {
        revert("No CELO accepted");
    }
}

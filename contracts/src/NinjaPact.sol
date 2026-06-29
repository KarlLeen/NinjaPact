// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IBadge} from "./interfaces/IBadge.sol";

contract NinjaPact {
    // ─── Enums ────────────────────────────────────────────────────────────────

    enum Mode { SOLO, DUO, POOL, MILESTONE, DEPOSIT }

    enum Role { COMMITTER, CHALLENGER }

    // DEPOSIT (code-delivery escrow) lifecycle, tracked alongside State.Active.
    // None = not an escrow / pre-join. Terminal outcome lives in State (Settled).
    enum EscrowPhase { None, InProgress, UnderReview, RevisionRequested, Arbitration }

    enum State {
        Created,
        AwaitingParties,
        Active,
        Success,
        Fail,
        Locked,
        Claimable,
        Settled,
        Cancelled
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct EvidencePolicy {
        uint32 totalRequired;   // total evidence submissions expected
        uint32 failThreshold;   // unexcused misses that trigger Fail
        uint32 restCards;       // excused-miss budget (locked at creation)
        uint32 restCardsUsed;   // runtime counter
    }

    struct Schedule {
        uint64 startTime;
        uint64 endTime;
        uint32 windowStartHour; // UTC hour (0-23) when daily window opens
        uint32 windowDurationH; // hours the window stays open
    }

    struct Party {
        address addr;
        uint256 stake;
        Role    role;
        bool    funded;
    }

    struct OpenSlot {
        Role    role;
        uint256 requiredStake;
        bytes32 inviteHash;
    }

    // DEPOSIT escrow state (party[0]=payer, party[1]=deliverer). Empty for other modes.
    struct Escrow {
        EscrowPhase phase;
        uint64  phaseDeadline;    // review deadline (UnderReview) or fix deadline (RevisionRequested)
        uint32  revisionsAllowed; // 改次数, locked at creation (from policy.restCards)
        uint32  revisionsUsed;
        bytes32 deliveryHash;     // hash of the current delivered source/build (the asset)
        bytes32 disputeMsgHash;   // hash of the payer's latest complaint (text off-chain)
    }

    struct Commitment {
        uint64        id;
        Mode          mode;
        Party[]       parties;
        OpenSlot[]    openSlots;
        address       judge;
        address       witness;
        bytes32       witnessInviteHash;
        bytes32       termsHash;
        EvidencePolicy evidencePolicy;
        Schedule      schedule;
        uint64        joinDeadline;
        State         state;
        // verdict accounting
        uint32        verdictPass;
        uint32        verdictFail;
        // lock
        uint64        lockedUntil;   // timestamp: lockedAt + 6 months
        bool          lockRedeemed;  // true once a Success rescued this slot
        bool          witnessDisputeUsed; // P1: witness gets one dispute per commitment
        bool          creatorBetsYes; // DUO bet: true if creator (party[0]) staked the YES side
        Escrow        escrow;        // DEPOSIT only
    }

    // Per-day verdict record — enables witness-dispute re-review to undo & overwrite
    struct DayVerdict {
        bool judged;
        bool pass;
        bool useRestCard;
        bool underReview; // witness disputed this day; one re-submission allowed
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    uint64 public constant LOCK_DURATION = 180 days;

    // DEPOSIT escrow windows (MVP constants; payer review / deliverer fix)
    uint64 public constant ESCROW_REVIEW_WINDOW = 2 days;
    uint64 public constant ESCROW_FIX_WINDOW    = 3 days;

    // DUO bet: grace after the event deadline before anyone may force a refund-both
    // safety settlement (used only if the Judge never resolves — funds never stuck).
    uint64 public constant BET_RESOLVE_GRACE = 3 days;

    // EIP-712 typehashes
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VERDICT_TYPEHASH =
        keccak256("Verdict(uint64 commitmentId,uint32 dayIndex,bool pass,bool useRestCard,bytes32 reasonHash)");

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public immutable token;   // mock ERC-20 stablecoin
    address public immutable badge;   // soulbound ERC-721

    bytes32 public immutable DOMAIN_SEPARATOR; // EIP-712 domain, cached at deploy

    uint64 private _nextId = 1;

    // id → storage; parties/openSlots stored in arrays inside mapping value
    mapping(uint64 => Commitment) private _commitments;

    // Track which successId has been used for redemption
    mapping(uint64 => bool) private _successUsedForRedemption;

    // creator address → list of commitment IDs (for frontend enumeration)
    mapping(address => uint64[]) private _userCommitments;

    // id → dayIndex → DayVerdict (replay protection + dispute re-review)
    mapping(uint64 => mapping(uint32 => DayVerdict)) private _days;

    // DEPOSIT id → true once settled in the deliverer's favor (lets the Judge gate
    // source release: payer only downloads the asset if they actually paid for it).
    mapping(uint64 => bool) public escrowDelivered;

    // ─── Events ───────────────────────────────────────────────────────────────

    event CommitmentCreated(uint64 indexed id, address indexed creator, Mode mode);
    event Funded(uint64 indexed id, address indexed party, uint256 amount);
    event VerdictSubmitted(
        uint64 indexed id,
        uint32 dayIndex,
        bool pass,
        bytes32 reasonHash,
        address signer,
        uint32 passTotal,
        uint32 failTotal
    );
    event CommitmentSettled(uint64 indexed id, State outcome);
    event Claimed(uint64 indexed id, address indexed claimant, uint256 amount);
    event LockRedeemed(uint64 indexed lockedId, uint64 indexed successId);
    event Cancelled(uint64 indexed id);
    event WitnessAccepted(uint64 indexed id, address witness);
    event VerdictUnderReview(uint64 indexed id, uint32 dayIndex, address witness);
    // DEPOSIT escrow lifecycle
    event DeliverySubmitted(uint64 indexed id, bytes32 deliveryHash, uint64 reviewDeadline);
    event RevisionRequested(uint64 indexed id, uint32 revisionsUsed, bytes32 disputeMsgHash, uint64 fixDeadline);
    event ArbitrationRequested(uint64 indexed id);
    event Arbitrated(uint64 indexed id, bool pass);
    // DUO public-event bet
    event BetResolved(uint64 indexed id, bool outcome, address indexed winner, uint256 pot);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotParty();
    error WrongState(State expected, State actual);
    error AlreadyFunded();
    error InvalidSecret();
    error NotOwner();
    error LockNotExpired();
    error SuccessAlreadyUsed();
    error NotSuccess();
    error DifferentOwner();
    error JudgePastDeadline();
    error ZeroAddress();
    error InvalidSchedule();
    error NoRestCardsLeft();
    error BadSignature();
    error DayAlreadyJudged();
    error NotWitness();
    error DayNotJudged();
    error DisputeAlreadyUsed();
    error NotPayer();
    error NotDeliverer();
    error WrongPhase();
    error NoRevisionsLeft();
    error RevisionsRemain();
    error NotSettleable();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier inState(uint64 id, State s) {
        if (_commitments[id].state != s) revert WrongState(s, _commitments[id].state);
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _token, address _badge) {
        if (_token == address(0) || _badge == address(0)) revert ZeroAddress();
        token = _token;
        badge = _badge;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("NinjaPact")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getCommitment(uint64 id) external view returns (
        uint64,
        Mode,
        address,    // judge
        address,    // witness
        bytes32,    // termsHash
        State,
        uint32,     // verdictPass
        uint32,     // verdictFail
        uint64      // lockedUntil
    ) {
        Commitment storage c = _commitments[id];
        return (c.id, c.mode, c.judge, c.witness, c.termsHash, c.state,
                c.verdictPass, c.verdictFail, c.lockedUntil);
    }

    function getUserCommitments(address user) external view returns (uint64[] memory) {
        return _userCommitments[user];
    }

    function getParties(uint64 id) external view returns (Party[] memory) {
        return _commitments[id].parties;
    }

    function getOpenSlots(uint64 id) external view returns (OpenSlot[] memory) {
        return _commitments[id].openSlots;
    }

    function getEvidencePolicy(uint64 id) external view returns (EvidencePolicy memory) {
        return _commitments[id].evidencePolicy;
    }

    function getEscrow(uint64 id) external view returns (Escrow memory) {
        return _commitments[id].escrow;
    }

    function getSchedule(uint64 id) external view returns (Schedule memory) {
        return _commitments[id].schedule;
    }

    /// DUO bet: which side the creator (party[0]) staked (true = YES). Frontend reads this
    /// to label the two sides; payout uses the same field (chain is the source of truth).
    function getCreatorBetsYes(uint64 id) external view returns (bool) {
        return _commitments[id].creatorBetsYes;
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /// @param mode          Only SOLO supported in MVP (DUO structure allowed but no join logic)
    /// @param judge         Address authorized to submit verdicts
    /// @param termsHash     keccak256 of full terms text (stored off-chain)
    /// @param policy        Evidence rules including restCards — immutable after creation
    /// @param schedule      Start/end/window
    /// @param stake         Amount the creator stakes (SOLO = only party)
    /// @param witnessInviteHash  hash(secret) for witness invite; zero if none
    /// @param duoInviteHash      hash(secret) for DUO open slot; zero for SOLO
    /// @param duoRequiredStake   Required stake for DUO partner; 0 for SOLO
    function createCommitment(
        Mode mode,
        address judge,
        bytes32 termsHash,
        EvidencePolicy calldata policy,
        Schedule calldata schedule,
        uint256 stake,
        bytes32 witnessInviteHash,
        bytes32 duoInviteHash,
        uint256 duoRequiredStake
    ) external returns (uint64 id) {
        return _createCommitment(
            mode, judge, termsHash, policy, schedule, stake,
            witnessInviteHash, duoInviteHash, duoRequiredStake, false
        );
    }

    /// @notice Create a DUO bet on a public event. Both sides stake equally; the creator
    /// picks the YES (true) or NO (false) side, the opponent joins the opposite side via
    /// the invite secret. The event question lives off-chain (termsHash). Resolved by the
    /// Judge's signed verdict (resolveBet); winner (one of the two fixed parties) takes the pot.
    /// @param schedule           endTime = the event deadline
    /// @param stake              each side stakes this amount
    /// @param opponentInviteHash hash(secret) for the opponent's open slot
    /// @param creatorBetsYes     true if the creator stakes the YES side
    function createBet(
        address judge,
        bytes32 termsHash,
        Schedule calldata schedule,
        uint256 stake,
        bytes32 opponentInviteHash,
        bool creatorBetsYes
    ) external returns (uint64 id) {
        EvidencePolicy memory empty; // bets carry no evidence/rest-card policy
        return _createCommitment(
            Mode.DUO, judge, termsHash, empty, schedule, stake,
            bytes32(0), opponentInviteHash, stake, creatorBetsYes
        );
    }

    function _createCommitment(
        Mode mode,
        address judge,
        bytes32 termsHash,
        EvidencePolicy memory policy,
        Schedule memory schedule,
        uint256 stake,
        bytes32 witnessInviteHash,
        bytes32 duoInviteHash,
        uint256 duoRequiredStake,
        bool creatorBetsYes
    ) internal returns (uint64 id) {
        if (judge == address(0)) revert ZeroAddress();
        if (schedule.endTime <= schedule.startTime) revert InvalidSchedule();

        id = _nextId++;
        Commitment storage c = _commitments[id];
        c.id            = id;
        c.mode          = mode;
        c.judge         = judge;
        c.termsHash     = termsHash;
        c.evidencePolicy = policy;
        c.schedule      = schedule;
        c.witnessInviteHash = witnessInviteHash;
        c.creatorBetsYes = creatorBetsYes;
        // DEPOSIT escrow + DUO bet: the second party may join any time up to the deadline;
        // habit modes give challengers a 48h window to lock in.
        c.joinDeadline  = (mode == Mode.DEPOSIT || mode == Mode.DUO)
            ? schedule.endTime
            : uint64(block.timestamp + 48 hours);
        _userCommitments[msg.sender].push(id);

        // Creator becomes first party (unfunded until fund() called)
        c.parties.push(Party({
            addr:   msg.sender,
            stake:  stake,
            role:   Role.COMMITTER,
            funded: false
        }));

        // DUO opens a challenger slot; DEPOSIT opens the deliverer slot (the party who
        // must deliver to release the escrow). Both join via joinCommitment(secret).
        if ((mode == Mode.DUO || mode == Mode.DEPOSIT) && duoInviteHash != bytes32(0)) {
            c.openSlots.push(OpenSlot({
                role:          Role.CHALLENGER,
                requiredStake: duoRequiredStake,
                inviteHash:    duoInviteHash
            }));
        }

        // DEPOSIT: the revision budget (改次数) rides in on policy.restCards.
        if (mode == Mode.DEPOSIT) {
            c.escrow.revisionsAllowed = policy.restCards;
        }

        c.state = State.Created;

        emit CommitmentCreated(id, msg.sender, mode);
    }

    // ─── Fund ─────────────────────────────────────────────────────────────────

    /// Creator calls this after createCommitment to deposit stake.
    /// For SOLO: transitions Created → Active immediately.
    function fund(uint64 id) external {
        Commitment storage c = _commitments[id];
        if (c.state != State.Created && c.state != State.AwaitingParties) {
            revert WrongState(State.Created, c.state);
        }

        uint256 partyIdx = _findPartyIndex(c, msg.sender);
        Party storage p = c.parties[partyIdx];
        if (p.funded) revert AlreadyFunded();

        p.funded = true;
        require(IERC20(token).transferFrom(msg.sender, address(this), p.stake), "transfer failed");

        emit Funded(id, msg.sender, p.stake);

        // SOLO: go straight to Active
        if (c.mode == Mode.SOLO && c.openSlots.length == 0) {
            c.state = State.Active;
        } else {
            c.state = State.AwaitingParties;
        }
    }

    // ─── Join (DUO / future modes) ────────────────────────────────────────────

    /// Challenger joins an open slot by providing the invite secret.
    /// Simultaneously stakes in the same call.
    function joinCommitment(uint64 id, bytes32 secret) external inState(id, State.AwaitingParties) {
        Commitment storage c = _commitments[id];
        if (block.timestamp > c.joinDeadline) revert JudgePastDeadline();

        uint256 slotIdx = _findSlotBySecret(c, secret);
        OpenSlot storage slot = c.openSlots[slotIdx];

        // Burn the invite hash
        slot.inviteHash = bytes32(0);

        uint256 stake = slot.requiredStake;
        Role role = slot.role;

        // Remove slot (swap-and-pop)
        c.openSlots[slotIdx] = c.openSlots[c.openSlots.length - 1];
        c.openSlots.pop();

        c.parties.push(Party({ addr: msg.sender, stake: stake, role: role, funded: true }));
        // Index the joiner so getUserCommitments(joiner) enumerates this commitment too
        // (creator is indexed at create; joiners — DUO challenger / DEPOSIT deliverer — here).
        _userCommitments[msg.sender].push(id);
        require(IERC20(token).transferFrom(msg.sender, address(this), stake), "transfer failed");

        emit Funded(id, msg.sender, stake);

        // If no open slots remain, activate
        if (c.openSlots.length == 0) {
            c.state = State.Active;
            // DEPOSIT: deliverer just bound → escrow work begins
            if (c.mode == Mode.DEPOSIT) {
                c.escrow.phase = EscrowPhase.InProgress;
            }
        }
    }

    // ─── Accept Witness (P1 structure, no-op in SOLO flow) ───────────────────

    function acceptWitness(uint64 id, bytes32 secret) external {
        Commitment storage c = _commitments[id];
        if (c.state != State.Active && c.state != State.AwaitingParties && c.state != State.Created) {
            revert WrongState(State.Active, c.state);
        }
        if (c.witnessInviteHash == bytes32(0)) revert InvalidSecret();
        if (keccak256(abi.encodePacked(secret)) != c.witnessInviteHash) revert InvalidSecret();

        c.witnessInviteHash = bytes32(0); // burn
        c.witness = msg.sender;

        emit WitnessAccepted(id, msg.sender);
    }

    // ─── Witness Dispute (P1) ──────────────────────────────────────────────────

    /// Bound witness flags one already-judged day for flagship re-review.
    /// One dispute per commitment; must be while Active (before settlement).
    /// The Judge service listens for VerdictUnderReview and re-submits a verdict,
    /// which overwrites the original via submitVerdict's re-review path.
    function witnessDispute(uint64 id, uint32 dayIndex) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];
        if (msg.sender != c.witness || c.witness == address(0)) revert NotWitness();
        if (c.witnessDisputeUsed) revert DisputeAlreadyUsed();

        DayVerdict storage dv = _days[id][dayIndex];
        if (!dv.judged) revert DayNotJudged();

        c.witnessDisputeUsed = true;
        dv.underReview = true;

        emit VerdictUnderReview(id, dayIndex, msg.sender);
    }

    // ─── Cancel Unfunded ──────────────────────────────────────────────────────

    /// Creator can cancel after joinDeadline if not fully funded.
    function cancelUnfunded(uint64 id) external {
        Commitment storage c = _commitments[id];
        if (c.state != State.Created && c.state != State.AwaitingParties) {
            revert WrongState(State.AwaitingParties, c.state);
        }
        if (block.timestamp <= c.joinDeadline) revert JudgePastDeadline();

        // Refund all funded parties
        c.state = State.Cancelled;
        _refundAll(c);

        emit Cancelled(id);
    }

    // ─── Submit Verdict ───────────────────────────────────────────────────────

    /// @notice EIP-712 digest a Judge must sign to authorize a verdict.
    /// Frontends / off-chain signers reconstruct this to produce `signature`.
    function hashVerdict(
        uint64 id,
        uint32 dayIndex,
        bool pass,
        bool useRestCard,
        bytes32 reasonHash
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            VERDICT_TYPEHASH, id, dayIndex, pass, useRestCard, reasonHash
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function isDayJudged(uint64 id, uint32 dayIndex) external view returns (bool) {
        return _days[id][dayIndex].judged;
    }

    function getDayVerdict(uint64 id, uint32 dayIndex) external view returns (DayVerdict memory) {
        return _days[id][dayIndex];
    }

    /// Verdict authorized by the Judge's ECDSA signature, NOT by msg.sender —
    /// anyone (judge, keeper, relayer) may broadcast a validly-signed verdict.
    /// @param dayIndex    evidence slot index; each slot may be judged once (replay guard)
    /// @param pass        true = evidence accepted, false = rejected
    /// @param useRestCard true = charge a rest card for this miss (only when !pass)
    /// @param reasonHash  keccak256 of reasoning text stored off-chain
    /// @param signature   judge's EIP-712 signature over hashVerdict(...)
    function submitVerdict(
        uint64 id,
        uint32 dayIndex,
        bool pass,
        bool useRestCard,
        bytes32 reasonHash,
        bytes calldata signature
    ) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];

        // Verify the verdict was signed by the registered judge
        bytes32 digest = hashVerdict(id, dayIndex, pass, useRestCard, reasonHash);
        if (_recoverSigner(digest, signature) != c.judge) revert BadSignature();

        DayVerdict storage dv = _days[id][dayIndex];
        if (dv.judged) {
            // Re-submission only allowed for a day the witness disputed (re-review)
            if (!dv.underReview) revert DayAlreadyJudged();
            _undoTally(c, dv);   // remove the old verdict's effect first
            dv.underReview = false;
        }

        // Apply the new verdict's effect on the tallies
        if (pass) {
            c.verdictPass++;
        } else {
            if (useRestCard) {
                if (c.evidencePolicy.restCardsUsed >= c.evidencePolicy.restCards) revert NoRestCardsLeft();
                c.evidencePolicy.restCardsUsed++;
                // Rest card absorbs the miss — no fail tally increment
            } else {
                c.verdictFail++;
            }
        }

        dv.judged = true;
        dv.pass = pass;
        dv.useRestCard = useRestCard;

        emit VerdictSubmitted(id, dayIndex, pass, reasonHash, c.judge, c.verdictPass, c.verdictFail);

        // Check fail threshold
        if (c.evidencePolicy.failThreshold > 0 &&
            c.verdictFail >= c.evidencePolicy.failThreshold) {
            _transitionFail(c);
            return;
        }

        // Check if schedule ended and total verdicts reached
        if (block.timestamp >= c.schedule.endTime) {
            uint32 total = c.verdictPass + c.verdictFail + c.evidencePolicy.restCardsUsed;
            if (total >= c.evidencePolicy.totalRequired || c.verdictFail >= c.evidencePolicy.failThreshold) {
                // Determine outcome
                if (c.evidencePolicy.failThreshold == 0 || c.verdictFail < c.evidencePolicy.failThreshold) {
                    _transitionSuccess(c);
                } else {
                    _transitionFail(c);
                }
            }
        }
    }

    // ─── Settle ───────────────────────────────────────────────────────────────

    /// Anyone can call settle after schedule end to trigger outcome evaluation.
    function settle(uint64 id) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];

        // DEPOSIT escrow settles on phase deadlines, not the overall schedule.
        if (c.mode == Mode.DEPOSIT) {
            _settleEscrowOnTimeout(c);
            return;
        }

        // DUO bet safety net: if the Judge never resolved within the grace window after the
        // event deadline, anyone may settle to refund both sides (失败不罚没 — funds never stuck).
        if (c.mode == Mode.DUO) {
            if (block.timestamp < c.schedule.endTime + BET_RESOLVE_GRACE) revert NotSettleable();
            c.state = State.Settled;
            _refundAll(c);
            emit CommitmentSettled(c.id, State.Cancelled);
            return;
        }

        if (block.timestamp < c.schedule.endTime) revert InvalidSchedule();
        if (c.evidencePolicy.failThreshold > 0 && c.verdictFail >= c.evidencePolicy.failThreshold) {
            _transitionFail(c);
        } else {
            _transitionSuccess(c);
        }
    }

    // ─── DEPOSIT escrow (code-delivery) ─────────────────────────────────────────

    /// Deliverer submits (or resubmits) a delivery → opens the payer review window.
    function submitDelivery(uint64 id, bytes32 deliveryHash) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DEPOSIT) revert WrongPhase();
        if (msg.sender != c.parties[1].addr) revert NotDeliverer();
        EscrowPhase p = c.escrow.phase;
        if (p != EscrowPhase.InProgress && p != EscrowPhase.RevisionRequested) revert WrongPhase();

        c.escrow.deliveryHash = deliveryHash;
        c.escrow.phase = EscrowPhase.UnderReview;
        uint64 deadline = uint64(block.timestamp) + ESCROW_REVIEW_WINDOW;
        c.escrow.phaseDeadline = deadline;
        emit DeliverySubmitted(id, deliveryHash, deadline);
    }

    /// Payer is satisfied → release the escrow to the deliverer immediately.
    function confirmDelivery(uint64 id) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DEPOSIT) revert WrongPhase();
        if (msg.sender != c.parties[0].addr) revert NotPayer();
        if (c.escrow.phase != EscrowPhase.UnderReview) revert WrongPhase();
        c.escrow.phase = EscrowPhase.None;
        _settleDeposit(c, true);
    }

    /// Payer disputes with a complaint (text off-chain, hash anchored) → deliverer must
    /// fix within the fix window. Burns one revision. AI in-spec refereeing is off-chain
    /// (advisory) for MVP; the original-spec check binds only at final arbitration.
    function requestRevision(uint64 id, bytes32 disputeMsgHash) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DEPOSIT) revert WrongPhase();
        if (msg.sender != c.parties[0].addr) revert NotPayer();
        if (c.escrow.phase != EscrowPhase.UnderReview) revert WrongPhase();
        if (c.escrow.revisionsUsed >= c.escrow.revisionsAllowed) revert NoRevisionsLeft();

        c.escrow.revisionsUsed++;
        c.escrow.disputeMsgHash = disputeMsgHash;
        c.escrow.phase = EscrowPhase.RevisionRequested;
        uint64 deadline = uint64(block.timestamp) + ESCROW_FIX_WINDOW;
        c.escrow.phaseDeadline = deadline;
        emit RevisionRequested(id, c.escrow.revisionsUsed, disputeMsgHash, deadline);
    }

    /// Payer is still unsatisfied but revisions are exhausted → escalate to the Judge,
    /// who makes a binding pass/fail call against the ORIGINAL spec (arbitrate()).
    function requestArbitration(uint64 id) external inState(id, State.Active) {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DEPOSIT) revert WrongPhase();
        if (msg.sender != c.parties[0].addr) revert NotPayer();
        if (c.escrow.phase != EscrowPhase.UnderReview) revert WrongPhase();
        if (c.escrow.revisionsUsed < c.escrow.revisionsAllowed) revert RevisionsRemain();

        c.escrow.phase = EscrowPhase.Arbitration;
        emit ArbitrationRequested(id);
    }

    /// Judge's binding terminal verdict (EIP-712, reuses the Verdict signature with
    /// dayIndex=0). pass → release to deliverer; fail → refund payer. 铁律#3: the Judge
    /// only picks pass/fail between the two pre-fixed parties, never a third recipient.
    function arbitrate(uint64 id, bool pass, bytes32 reasonHash, bytes calldata signature)
        external
        inState(id, State.Active)
    {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DEPOSIT) revert WrongPhase();
        if (c.escrow.phase != EscrowPhase.Arbitration) revert WrongPhase();

        bytes32 digest = hashVerdict(id, 0, pass, false, reasonHash);
        if (_recoverSigner(digest, signature) != c.judge) revert BadSignature();

        c.escrow.phase = EscrowPhase.None;
        emit Arbitrated(id, pass);
        _settleDeposit(c, pass);
    }

    // ─── DUO public-event bet resolution ───────────────────────────────────────

    /// Judge's signed verdict on the bet's public event (reuses the Verdict typed-data
    /// with dayIndex=0; pass = outcome). Winner is whichever pre-fixed party staked the
    /// resolved side — the Judge only signs the outcome bool, never picks the recipient
    /// (铁律#3, same bounded relaxation as escrow). Winner takes the pot.
    function resolveBet(uint64 id, bool outcome, bytes32 reasonHash, bytes calldata signature)
        external
        inState(id, State.Active)
    {
        Commitment storage c = _commitments[id];
        if (c.mode != Mode.DUO) revert WrongPhase();

        bytes32 digest = hashVerdict(id, 0, outcome, false, reasonHash);
        if (_recoverSigner(digest, signature) != c.judge) revert BadSignature();

        _settleBet(c, outcome);
    }

    /// Settle a DUO bet: the side matching the resolved outcome takes both stakes.
    function _settleBet(Commitment storage c, bool outcome) internal {
        c.state = State.Settled;
        uint256 pot = c.parties[0].stake + c.parties[1].stake;
        c.parties[0].stake = 0;
        c.parties[1].stake = 0;

        // creator (party[0]) holds the YES side iff creatorBetsYes; opponent holds the other.
        address winner = (outcome == c.creatorBetsYes) ? c.parties[0].addr : c.parties[1].addr;
        if (pot > 0) {
            require(IERC20(token).transfer(winner, pot), "transfer failed");
            emit Claimed(c.id, winner, pot);
        }
        IBadge(badge).mint(winner, c.id); // winner earns the soulbound badge

        emit BetResolved(c.id, outcome, winner, pot);
        emit CommitmentSettled(c.id, State.Success);
    }

    /// Time-based escrow settlement (keeper / anyone): review window passed → release;
    /// fix window passed → refund; never delivered by deadline → refund.
    function _settleEscrowOnTimeout(Commitment storage c) internal {
        EscrowPhase p = c.escrow.phase;
        if (p == EscrowPhase.UnderReview) {
            if (block.timestamp < c.escrow.phaseDeadline) revert NotSettleable();
            c.escrow.phase = EscrowPhase.None;
            _settleDeposit(c, true);   // payer silent → deliverer paid
        } else if (p == EscrowPhase.RevisionRequested) {
            if (block.timestamp < c.escrow.phaseDeadline) revert NotSettleable();
            c.escrow.phase = EscrowPhase.None;
            _settleDeposit(c, false);  // deliverer abandoned → payer refunded
        } else if (p == EscrowPhase.InProgress) {
            if (block.timestamp < c.schedule.endTime) revert NotSettleable();
            c.escrow.phase = EscrowPhase.None;
            _settleDeposit(c, false);  // never delivered → payer refunded
        } else {
            revert NotSettleable();    // Arbitration is resolved by arbitrate(), not settle
        }
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    /// Anyone can trigger claim for a Claimable commitment (keeper-friendly).
    function claim(uint64 id) external {
        Commitment storage c = _commitments[id];
        if (c.state == State.Locked) {
            if (block.timestamp < c.lockedUntil) revert LockNotExpired();
            c.state = State.Claimable;
        }
        if (c.state != State.Claimable) revert WrongState(State.Claimable, c.state);

        c.state = State.Settled; // mark spent before transfers
        _refundAll(c);

        emit CommitmentSettled(id, State.Claimable);
    }

    // ─── Redeem Lock ──────────────────────────────────────────────────────────

    /// One Success rescues one Locked commitment (same owner).
    function redeemLock(uint64 lockedId, uint64 successId) external {
        Commitment storage locked  = _commitments[lockedId];
        Commitment storage success = _commitments[successId];

        if (locked.state != State.Locked) revert WrongState(State.Locked, locked.state);
        if (success.state != State.Success) revert NotSuccess();
        if (_successUsedForRedemption[successId]) revert SuccessAlreadyUsed();

        // Both must belong to msg.sender
        _requireParty(locked, msg.sender);
        _requireParty(success, msg.sender);

        _successUsedForRedemption[successId] = true;
        locked.lockRedeemed = true;
        locked.state = State.Claimable;

        emit LockRedeemed(lockedId, successId);
    }

    // ─── Internal transitions ─────────────────────────────────────────────────

    /// DEPOSIT escrow settlement. Relaxes 铁律#3 in a bounded way: funds may go to a
    /// THIRD PARTY (the deliverer) — but ONLY the deliverer fixed at creation via the
    /// invite slot, never an address the Judge chooses. Judge only picks pass/fail.
    /// delivered=true → escrow → deliverer (party[1]); false → refund payer (party[0]).
    function _settleDeposit(Commitment storage c, bool delivered) internal {
        c.state = State.Settled;
        Party storage payer = c.parties[0];
        uint256 amt = payer.stake;
        payer.stake = 0;

        if (delivered && c.parties.length > 1) {
            address deliverer = c.parties[1].addr;
            if (amt > 0) {
                require(IERC20(token).transfer(deliverer, amt), "transfer failed");
                emit Claimed(c.id, deliverer, amt);
            }
            IBadge(badge).mint(deliverer, c.id); // deliverer earns the soulbound badge
            escrowDelivered[c.id] = true;        // unlocks source release to the payer
            emit CommitmentSettled(c.id, State.Success);
        } else {
            if (amt > 0) {
                require(IERC20(token).transfer(payer.addr, amt), "transfer failed");
                emit Claimed(c.id, payer.addr, amt);
            }
            emit CommitmentSettled(c.id, State.Cancelled);
        }
    }

    function _transitionSuccess(Commitment storage c) internal {
        c.state = State.Success;
        emit CommitmentSettled(c.id, State.Success);

        // Refund all parties
        for (uint256 i = 0; i < c.parties.length; i++) {
            Party storage p = c.parties[i];
            if (p.funded && p.stake > 0) {
                uint256 amt = p.stake;
                p.stake = 0;
                require(IERC20(token).transfer(p.addr, amt), "transfer failed");
                emit Claimed(c.id, p.addr, amt);
            }
        }

        // Mint soulbound badge for each committer
        for (uint256 i = 0; i < c.parties.length; i++) {
            if (c.parties[i].role == Role.COMMITTER) {
                IBadge(badge).mint(c.parties[i].addr, c.id);
            }
        }
    }

    function _transitionFail(Commitment storage c) internal {
        c.state = State.Locked;
        c.lockedUntil = uint64(block.timestamp + LOCK_DURATION);
        emit CommitmentSettled(c.id, State.Locked);
    }

    function _refundAll(Commitment storage c) internal {
        for (uint256 i = 0; i < c.parties.length; i++) {
            Party storage p = c.parties[i];
            if (p.funded && p.stake > 0) {
                uint256 amt = p.stake;
                p.stake = 0;
                require(IERC20(token).transfer(p.addr, amt), "transfer failed");
                emit Claimed(c.id, p.addr, amt);
            }
        }
    }

    function _findPartyIndex(Commitment storage c, address addr) internal view returns (uint256) {
        for (uint256 i = 0; i < c.parties.length; i++) {
            if (c.parties[i].addr == addr) return i;
        }
        revert NotParty();
    }

    function _requireParty(Commitment storage c, address addr) internal view {
        _findPartyIndex(c, addr); // reverts if not found
    }

    function _findSlotBySecret(Commitment storage c, bytes32 secret) internal view returns (uint256) {
        bytes32 h = keccak256(abi.encodePacked(secret));
        for (uint256 i = 0; i < c.openSlots.length; i++) {
            if (c.openSlots[i].inviteHash == h) return i;
        }
        revert InvalidSecret();
    }

    /// Reverse a previously-applied day verdict's effect on the tallies (for re-review).
    function _undoTally(Commitment storage c, DayVerdict storage dv) internal {
        if (dv.pass) {
            c.verdictPass--;
        } else if (dv.useRestCard) {
            c.evidencePolicy.restCardsUsed--;
        } else {
            c.verdictFail--;
        }
    }

    /// ECDSA recover with EIP-2 low-s malleability guard.
    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Reject high-s (malleable) signatures per EIP-2
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert BadSignature();
        }
        if (v != 27 && v != 28) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}

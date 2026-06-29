// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {NinjaPact} from "../src/NinjaPact.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {Badge} from "../src/Badge.sol";

contract NinjaPactTest is Test {
    NinjaPact public pact;
    MockUSD   public usd;
    Badge     public badge;

    address constant ALICE  = address(0xA11CE);
    address constant BOB    = address(0xB0B);
    address constant KEEPER = address(0xCEECEE);

    // Judge identity is now key-based (verdicts are ECDSA-signed, not msg.sender-gated)
    uint256 constant JUDGE_KEY    = 0x111DE;
    uint256 constant NONJUDGE_KEY = 0xBAD5161;
    address JUDGE; // = vm.addr(JUDGE_KEY), set in setUp

    uint256 constant STAKE = 300e6; // 300 mUSD

    // Per-id day counter so repeated _verdict() calls get unique dayIndex
    mapping(uint64 => uint32) private _nextDay;

    // ─── helpers ───────────────────────────────────────────────────────────────

    function _deployAll() internal {
        usd   = new MockUSD();
        badge = new Badge();
        pact  = new NinjaPact(address(usd), address(badge));
        badge.initialize(address(pact));
    }

    function _defaultPolicy(uint32 restCards) internal pure returns (NinjaPact.EvidencePolicy memory) {
        return NinjaPact.EvidencePolicy({
            totalRequired:  30,
            failThreshold:  3,
            restCards:      restCards,
            restCardsUsed:  0
        });
    }

    function _defaultSchedule() internal view returns (NinjaPact.Schedule memory) {
        return NinjaPact.Schedule({
            startTime:       uint64(block.timestamp),
            endTime:         uint64(block.timestamp + 30 days),
            windowStartHour: 0,
            windowDurationH: 24
        });
    }

    function _createSolo(address user, uint32 restCards) internal returns (uint64 id) {
        vm.startPrank(user);
        id = pact.createCommitment(
            NinjaPact.Mode.SOLO,
            JUDGE,
            keccak256("terms"),
            _defaultPolicy(restCards),
            _defaultSchedule(),
            STAKE,
            bytes32(0),  // no witness
            bytes32(0),  // no DUO slot
            0
        );
        vm.stopPrank();
    }

    function _fund(address user, uint64 id) internal {
        vm.startPrank(user);
        usd.approve(address(pact), STAKE);
        pact.fund(id);
        vm.stopPrank();
    }

    /// Sign a verdict with the given key and return the 65-byte signature.
    function _sign(uint256 key, uint64 id, uint32 dayIndex, bool pass, bool useRest, bytes32 reasonHash)
        internal view returns (bytes memory)
    {
        bytes32 digest = pact.hashVerdict(id, dayIndex, pass, useRest, reasonHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Submit a judge-signed verdict using the next dayIndex for this id.
    function _verdict(uint64 id, bool pass, bool useRest) internal {
        uint32 dayIndex = _nextDay[id]++;
        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, dayIndex, pass, useRest, reasonHash);
        pact.submitVerdict(id, dayIndex, pass, useRest, reasonHash, sig);
    }

    // ─── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        JUDGE = vm.addr(JUDGE_KEY);
        _deployAll();
        usd.mint(ALICE, 10_000e6);
        usd.mint(BOB,   10_000e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE
    // ══════════════════════════════════════════════════════════════════════════

    function test_create_solo_state_is_Created() public {
        uint64 id = _createSolo(ALICE, 3);
        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Created));
    }

    function test_create_increments_id() public {
        uint64 id1 = _createSolo(ALICE, 0);
        uint64 id2 = _createSolo(ALICE, 0);
        assertEq(id2, id1 + 1);
    }

    function test_create_judge_zero_reverts() public {
        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.ZeroAddress.selector);
        pact.createCommitment(
            NinjaPact.Mode.SOLO, address(0), bytes32(0),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            bytes32(0), bytes32(0), 0
        );
    }

    function test_create_bad_schedule_reverts() public {
        NinjaPact.Schedule memory s = NinjaPact.Schedule({
            startTime: uint64(block.timestamp + 10),
            endTime:   uint64(block.timestamp),     // end < start
            windowStartHour: 0, windowDurationH: 24
        });
        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.InvalidSchedule.selector);
        pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, bytes32(0),
            _defaultPolicy(0), s, STAKE,
            bytes32(0), bytes32(0), 0
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FUND → ACTIVE
    // ══════════════════════════════════════════════════════════════════════════

    function test_fund_transitions_to_Active() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Active));
    }

    function test_fund_pulls_tokens() public {
        uint64 id = _createSolo(ALICE, 0);
        uint256 before = usd.balanceOf(ALICE);
        _fund(ALICE, id);
        assertEq(usd.balanceOf(ALICE), before - STAKE);
        assertEq(usd.balanceOf(address(pact)), STAKE);
    }

    function test_fund_double_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        vm.startPrank(ALICE);
        usd.approve(address(pact), STAKE);
        // State is now Active, not Created
        vm.expectRevert();
        pact.fund(id);
        vm.stopPrank();
    }

    function test_non_party_cannot_fund() public {
        uint64 id = _createSolo(ALICE, 0);
        vm.startPrank(BOB);
        usd.approve(address(pact), STAKE);
        vm.expectRevert(NinjaPact.NotParty.selector);
        pact.fund(id);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VERDICT & FAIL THRESHOLD
    // ══════════════════════════════════════════════════════════════════════════

    function test_verdict_wrong_state_reverts() public {
        uint64 id = _createSolo(ALICE, 0); // still Created
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, bytes32(0));
        vm.expectRevert(); // inState(Active) reverts before signature check
        pact.submitVerdict(id, 0, true, false, bytes32(0), sig);
    }

    function test_fail_threshold_transitions_to_Locked() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        _verdict(id, false, false); // fail 1
        _verdict(id, false, false); // fail 2
        _verdict(id, false, false); // fail 3 → threshold met

        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Locked));
    }

    function test_locked_sets_lockedUntil() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false);
        (,,,,,,,, uint64 lockedUntil) = pact.getCommitment(id);
        assertEq(lockedUntil, block.timestamp + 180 days);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // REST CARDS (免卡券)
    // ══════════════════════════════════════════════════════════════════════════

    function test_rest_card_absorbs_miss() public {
        uint64 id = _createSolo(ALICE, 3);
        _fund(ALICE, id);

        _verdict(id, false, true); // use rest card 1
        _verdict(id, false, true); // use rest card 2
        _verdict(id, false, true); // use rest card 3

        // 3 rest cards used, 0 real fails → still Active
        (,,,,,NinjaPact.State state,,uint32 failTotal,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Active));
        assertEq(failTotal, 0);
    }

    function test_rest_card_exhausted_reverts() public {
        uint64 id = _createSolo(ALICE, 1);
        _fund(ALICE, id);

        _verdict(id, false, true); // uses the 1 rest card

        // Next miss-with-restcard should revert: no cards left
        uint32 dayIndex = _nextDay[id]++;
        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, dayIndex, false, true, reasonHash);
        vm.expectRevert(NinjaPact.NoRestCardsLeft.selector);
        pact.submitVerdict(id, dayIndex, false, true, reasonHash, sig);
    }

    function test_rest_cards_fixed_at_creation() public {
        uint64 id = _createSolo(ALICE, 2);
        NinjaPact.EvidencePolicy memory p = pact.getEvidencePolicy(id);
        assertEq(p.restCards, 2);
    }

    function test_rest_cards_zero_still_works() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        // A real fail should go to fail counter, not rest card
        _verdict(id, false, false);
        (,,,,,,,uint32 failTotal,) = pact.getCommitment(id);
        assertEq(failTotal, 1);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VERDICT SIGNATURE VERIFICATION (W2b: ECDSA + replay guard)
    // ══════════════════════════════════════════════════════════════════════════

    function test_verdict_valid_signature_accepted() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes32 reasonHash = keccak256("good evidence");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);
        pact.submitVerdict(id, 0, true, false, reasonHash, sig);

        (,,,,,,uint32 passTotal,,) = pact.getCommitment(id);
        assertEq(passTotal, 1);
        assertTrue(pact.isDayJudged(id, 0));
    }

    /// Anyone (keeper, relayer, random EOA) may broadcast a validly-signed verdict.
    function test_verdict_anyone_can_relay() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);

        // msg.sender is a random address, NOT the judge — still accepted
        vm.prank(address(0xDEAD));
        pact.submitVerdict(id, 0, true, false, reasonHash, sig);

        (,,,,,,uint32 passTotal,,) = pact.getCommitment(id);
        assertEq(passTotal, 1);
    }

    /// A verdict signed by a non-judge key is rejected.
    function test_verdict_non_judge_signer_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(NONJUDGE_KEY, id, 0, true, false, reasonHash);

        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.submitVerdict(id, 0, true, false, reasonHash, sig);
    }

    /// Tampering with verdict content after signing is rejected
    /// (signature was over pass=true, but pass=false is submitted).
    function test_verdict_tampered_content_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);

        // Submit with pass flipped to false → digest mismatch → recovered signer != judge
        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.submitVerdict(id, 0, false, false, reasonHash, sig);
    }

    /// Tampering with reasonHash is rejected.
    function test_verdict_tampered_reason_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, keccak256("original"));

        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.submitVerdict(id, 0, true, false, keccak256("swapped"), sig);
    }

    /// Replaying the same dayIndex (same signature) is rejected.
    function test_verdict_replay_same_day_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);

        pact.submitVerdict(id, 0, true, false, reasonHash, sig);

        vm.expectRevert(NinjaPact.DayAlreadyJudged.selector);
        pact.submitVerdict(id, 0, true, false, reasonHash, sig);
    }

    /// A signature for one commitment cannot be replayed on another (domain binds id).
    function test_verdict_cross_commitment_replay_reverts() public {
        uint64 id1 = _createSolo(ALICE, 0);
        _fund(ALICE, id1);
        uint64 id2 = _createSolo(ALICE, 0);
        _fund(ALICE, id2);

        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id1, 0, true, false, reasonHash);

        // Using id1's signature on id2 → recovered signer differs → reject
        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.submitVerdict(id2, 0, true, false, reasonHash, sig);
    }

    function test_verdict_malformed_signature_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.submitVerdict(id, 0, true, false, keccak256("r"), hex"1234");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SUCCESS PATH
    // ══════════════════════════════════════════════════════════════════════════

    function test_settle_after_endTime_success() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);

        // Advance past end
        vm.warp(block.timestamp + 31 days);
        pact.settle(id);

        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Success));
    }

    function test_success_refunds_stake() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        uint256 before = usd.balanceOf(ALICE);

        vm.warp(block.timestamp + 31 days);
        pact.settle(id);

        assertEq(usd.balanceOf(ALICE), before + STAKE);
    }

    function test_success_mints_badge() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        assertEq(badge.balanceOf(ALICE), 0);

        vm.warp(block.timestamp + 31 days);
        pact.settle(id);

        assertEq(badge.balanceOf(ALICE), 1);
    }

    function test_settle_before_end_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        vm.expectRevert(NinjaPact.InvalidSchedule.selector);
        pact.settle(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LOCKED → CLAIMABLE → CLAIM
    // ══════════════════════════════════════════════════════════════════════════

    function test_claim_before_lock_expires_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false); // Locked

        vm.expectRevert(NinjaPact.LockNotExpired.selector);
        pact.claim(id);
    }

    function test_claim_after_lock_refunds() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        uint256 before = usd.balanceOf(ALICE);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false); // Locked

        vm.warp(block.timestamp + 181 days);
        pact.claim(id); // keeper triggers

        assertEq(usd.balanceOf(ALICE), before + STAKE);
    }

    function test_claim_wrong_state_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        // Still Active → cannot claim
        vm.expectRevert();
        pact.claim(id);
    }

    function test_double_claim_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false);
        vm.warp(block.timestamp + 181 days);
        pact.claim(id);
        vm.expectRevert();
        pact.claim(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // REDEEM LOCK (救赎)
    // ══════════════════════════════════════════════════════════════════════════

    function _makeLocked(address user) internal returns (uint64 id) {
        id = _createSolo(user, 0);
        _fund(user, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false);
    }

    function _makeSuccess(address user) internal returns (uint64 id) {
        id = _createSolo(user, 0);
        _fund(user, id);
        vm.warp(block.timestamp + 31 days);
        pact.settle(id);
    }

    function test_redeem_lock_transitions_to_Claimable() public {
        uint64 lockedId  = _makeLocked(ALICE);
        uint64 successId = _makeSuccess(ALICE);

        vm.prank(ALICE);
        pact.redeemLock(lockedId, successId);

        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(lockedId);
        assertEq(uint8(state), uint8(NinjaPact.State.Claimable));
    }

    function test_redeem_then_claim_refunds() public {
        uint64 lockedId  = _makeLocked(ALICE);
        uint64 successId = _makeSuccess(ALICE);
        uint256 before = usd.balanceOf(ALICE);

        vm.prank(ALICE);
        pact.redeemLock(lockedId, successId);
        pact.claim(lockedId);

        assertEq(usd.balanceOf(ALICE), before + STAKE);
    }

    function test_redeem_success_already_used_reverts() public {
        uint64 lockedId1 = _makeLocked(ALICE);
        uint64 lockedId2 = _makeLocked(ALICE);
        uint64 successId = _makeSuccess(ALICE);

        vm.startPrank(ALICE);
        pact.redeemLock(lockedId1, successId);

        vm.expectRevert(NinjaPact.SuccessAlreadyUsed.selector);
        pact.redeemLock(lockedId2, successId);
        vm.stopPrank();
    }

    function test_redeem_wrong_owner_reverts() public {
        uint64 lockedId  = _makeLocked(ALICE);
        uint64 successId = _makeSuccess(BOB);

        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.NotParty.selector);
        pact.redeemLock(lockedId, successId);
    }

    function test_redeem_not_success_reverts() public {
        uint64 lockedId = _makeLocked(ALICE);
        uint64 otherId  = _createSolo(ALICE, 0); // Created, not Success
        _fund(ALICE, otherId);

        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.NotSuccess.selector);
        pact.redeemLock(lockedId, otherId);
    }

    function test_redeem_not_locked_reverts() public {
        uint64 successId1 = _makeSuccess(ALICE);
        uint64 successId2 = _makeSuccess(ALICE);

        vm.prank(ALICE);
        vm.expectRevert();
        pact.redeemLock(successId1, successId2); // successId1 is Success not Locked
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CANCEL UNFUNDED
    // ══════════════════════════════════════════════════════════════════════════

    function test_cancel_after_deadline() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        // SOLO goes directly to Active, so we need a DUO to test cancellation
        // Create a DUO scenario manually via a second solo (just test the function mechanics)
        // Actually let's test: create a commitment but don't fund, advance past joinDeadline
        // Re-create without funding
        vm.prank(BOB);
        uint64 id2 = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("t"),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            bytes32(0), bytes32(0), 0
        );
        // Not funded yet (state = Created)
        vm.warp(block.timestamp + 49 hours);
        pact.cancelUnfunded(id2); // anyone can trigger
        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id2);
        assertEq(uint8(state), uint8(NinjaPact.State.Cancelled));
    }

    function test_cancel_before_deadline_reverts() public {
        vm.prank(BOB);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("t"),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            bytes32(0), bytes32(0), 0
        );
        vm.expectRevert(NinjaPact.JudgePastDeadline.selector);
        pact.cancelUnfunded(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WITNESS INVITE
    // ══════════════════════════════════════════════════════════════════════════

    function test_accept_witness_valid_secret() public {
        bytes32 secret = keccak256("witness-secret");
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));

        vm.prank(ALICE);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("t"),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            inviteHash, bytes32(0), 0
        );
        _fund(ALICE, id);

        vm.prank(BOB);
        pact.acceptWitness(id, secret);

        (,,, address witness,,,,, ) = pact.getCommitment(id);
        assertEq(witness, BOB);
    }

    function test_accept_witness_wrong_secret_reverts() public {
        bytes32 inviteHash = keccak256(abi.encodePacked(keccak256("real")));
        vm.prank(ALICE);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("t"),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            inviteHash, bytes32(0), 0
        );
        _fund(ALICE, id);

        vm.prank(BOB);
        vm.expectRevert(NinjaPact.InvalidSecret.selector);
        pact.acceptWitness(id, keccak256("wrong"));
    }

    function test_accept_witness_replay_reverts() public {
        bytes32 secret = keccak256("s");
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));

        vm.prank(ALICE);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("t"),
            _defaultPolicy(0), _defaultSchedule(), STAKE,
            inviteHash, bytes32(0), 0
        );
        _fund(ALICE, id);

        vm.prank(BOB);
        pact.acceptWitness(id, secret);

        address newGuy = address(0x999);
        vm.prank(newGuy);
        vm.expectRevert(NinjaPact.InvalidSecret.selector);
        pact.acceptWitness(id, secret); // hash is now zero
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WITNESS DISPUTE → RE-REVIEW (Part B)
    // ══════════════════════════════════════════════════════════════════════════

    function _createWithWitness(address user, address witnessAddr) internal returns (uint64 id) {
        bytes32 secret = keccak256(abi.encodePacked("w", witnessAddr));
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));
        vm.prank(user);
        id = pact.createCommitment(
            NinjaPact.Mode.SOLO, JUDGE, keccak256("terms"),
            _defaultPolicy(3), _defaultSchedule(), STAKE,
            inviteHash, bytes32(0), 0
        );
        _fund(user, id);
        vm.prank(witnessAddr);
        pact.acceptWitness(id, secret);
    }

    function test_dispute_emits_under_review_and_marks_day() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        _verdict(id, true, false); // day 0 = pass

        vm.expectEmit(true, false, false, true);
        emit NinjaPact.VerdictUnderReview(id, 0, BOB);
        vm.prank(BOB);
        pact.witnessDispute(id, 0);

        assertTrue(pact.getDayVerdict(id, 0).underReview);
    }

    function test_dispute_only_witness() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        _verdict(id, true, false);
        vm.prank(ALICE); // committer, not witness
        vm.expectRevert(NinjaPact.NotWitness.selector);
        pact.witnessDispute(id, 0);
    }

    function test_dispute_unjudged_day_reverts() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        vm.prank(BOB);
        vm.expectRevert(NinjaPact.DayNotJudged.selector);
        pact.witnessDispute(id, 0);
    }

    function test_dispute_only_once() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        _verdict(id, true, false); // day 0
        _verdict(id, true, false); // day 1
        vm.prank(BOB);
        pact.witnessDispute(id, 0);
        vm.prank(BOB);
        vm.expectRevert(NinjaPact.DisputeAlreadyUsed.selector);
        pact.witnessDispute(id, 1);
    }

    /// Re-review flips a pass → fail: verdictPass-- and verdictFail++.
    function test_dispute_reReview_overwrites_pass_to_fail() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        _verdict(id, true, false); // day 0 = pass
        (,,,,,, uint32 passBefore, uint32 failBefore,) = pact.getCommitment(id);
        assertEq(passBefore, 1);
        assertEq(failBefore, 0);

        vm.prank(BOB);
        pact.witnessDispute(id, 0);

        // Judge re-submits day 0 as a fail (flagship re-review)
        bytes32 reasonHash = keccak256("re-review: actually failed");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, false, false, reasonHash);
        pact.submitVerdict(id, 0, false, false, reasonHash, sig);

        (,,,,,, uint32 passAfter, uint32 failAfter,) = pact.getCommitment(id);
        assertEq(passAfter, 0); // undone
        assertEq(failAfter, 1); // new
        assertTrue(pact.getDayVerdict(id, 0).judged);
        assertEq(pact.getDayVerdict(id, 0).pass, false);
        assertTrue(!pact.getDayVerdict(id, 0).underReview); // cleared
    }

    /// Without a dispute, re-submitting a judged day is still blocked.
    function test_resubmit_without_dispute_reverts() public {
        uint64 id = _createWithWitness(ALICE, BOB);
        _verdict(id, true, false); // day 0
        bytes32 reasonHash = keccak256("reason");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, false, false, reasonHash);
        vm.expectRevert(NinjaPact.DayAlreadyJudged.selector);
        pact.submitVerdict(id, 0, false, false, reasonHash, sig);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DEPOSIT ESCROW — code delivery (验 demo / 扣源码 / 修改环 / 终局裁决)
    // ══════════════════════════════════════════════════════════════════════════

    // payer ALICE escrows; deliverer BOB joins via invite (stake 0). `revisions` = 改次数.
    function _createEscrow(address payer, address deliverer, uint32 revisions) internal returns (uint64 id) {
        bytes32 secret = keccak256(abi.encodePacked("deliver", deliverer));
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));
        vm.prank(payer);
        id = pact.createCommitment(
            NinjaPact.Mode.DEPOSIT, JUDGE, keccak256("deliverable terms"),
            _defaultPolicy(revisions), _defaultSchedule(), STAKE,
            bytes32(0), inviteHash, 0
        );
        _fund(payer, id);                 // payer locks the escrow
        vm.prank(deliverer);
        pact.joinCommitment(id, secret);  // deliverer binds (stake 0) → Active / InProgress
    }

    function _deliver(uint64 id, address deliverer) internal {
        vm.prank(deliverer);
        pact.submitDelivery(id, keccak256("build"));
    }

    function _phase(uint64 id) internal view returns (NinjaPact.EscrowPhase) {
        return pact.getEscrow(id).phase;
    }

    // joinCommitment must index the joiner so getUserCommitments() enumerates joined
    // commitments from chain (kills the frontend localStorage deliver-jobs workaround).
    function test_join_indexes_deliverer_commitments() public {
        // BOB has no commitments before joining anything
        assertEq(pact.getUserCommitments(BOB).length, 0);

        uint64 id = _createEscrow(ALICE, BOB, 2); // ALICE creates+funds, BOB joins as deliverer

        // creator indexed at create
        uint64[] memory aliceIds = pact.getUserCommitments(ALICE);
        assertEq(aliceIds.length, 1);
        assertEq(aliceIds[0], id);

        // joiner (deliverer) now indexed at join
        uint64[] memory bobIds = pact.getUserCommitments(BOB);
        assertEq(bobIds.length, 1);
        assertEq(bobIds[0], id);
    }

    // A deliverer who joins multiple escrows sees all of them enumerated on chain.
    function test_join_indexes_multiple_commitments() public {
        uint64 id1 = _createEscrow(ALICE, BOB, 1);
        // second escrow from a different payer (KEEPER) with BOB delivering again
        usd.mint(KEEPER, STAKE);
        bytes32 secret = keccak256(abi.encodePacked("deliver", BOB));
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));
        vm.prank(KEEPER);
        uint64 id2 = pact.createCommitment(
            NinjaPact.Mode.DEPOSIT, JUDGE, keccak256("second terms"),
            _defaultPolicy(1), _defaultSchedule(), STAKE, bytes32(0), inviteHash, 0
        );
        _fund(KEEPER, id2);
        vm.prank(BOB);
        pact.joinCommitment(id2, secret);

        uint64[] memory bobIds = pact.getUserCommitments(BOB);
        assertEq(bobIds.length, 2);
        assertEq(bobIds[0], id1);
        assertEq(bobIds[1], id2);
    }

    function test_escrow_confirm_pays_deliverer() public {
        uint256 payerBefore = usd.balanceOf(ALICE);
        uint256 delivBefore = usd.balanceOf(BOB);
        uint64 id = _createEscrow(ALICE, BOB, 2);
        assertEq(uint8(_phase(id)), uint8(NinjaPact.EscrowPhase.InProgress));
        assertEq(usd.balanceOf(ALICE), payerBefore - STAKE); // escrowed

        _deliver(id, BOB);
        assertEq(uint8(_phase(id)), uint8(NinjaPact.EscrowPhase.UnderReview));

        vm.prank(ALICE);
        pact.confirmDelivery(id); // payer satisfied → release

        assertEq(usd.balanceOf(BOB), delivBefore + STAKE);   // deliverer paid
        assertEq(usd.balanceOf(ALICE), payerBefore - STAKE); // payer not refunded
        (,,,,,NinjaPact.State s,,,) = pact.getCommitment(id);
        assertEq(uint8(s), uint8(NinjaPact.State.Settled));
        assertEq(badge.balanceOf(BOB), 1);
        assertEq(usd.balanceOf(address(pact)), 0);
        assertTrue(pact.escrowDelivered(id)); // source release unlocked for payer
    }

    function test_escrow_review_timeout_releases_to_deliverer() public {
        uint64 id = _createEscrow(ALICE, BOB, 2);
        uint256 delivBefore = usd.balanceOf(BOB);
        _deliver(id, BOB);

        vm.warp(block.timestamp + 2 days + 1); // payer silent past review window
        pact.settle(id);
        assertEq(usd.balanceOf(BOB), delivBefore + STAKE);
    }

    function test_escrow_revision_then_confirm() public {
        uint64 id = _createEscrow(ALICE, BOB, 2);
        _deliver(id, BOB);

        vm.prank(ALICE);
        pact.requestRevision(id, keccak256("login page errors"));
        assertEq(uint8(_phase(id)), uint8(NinjaPact.EscrowPhase.RevisionRequested));
        assertEq(pact.getEscrow(id).revisionsUsed, 1);

        _deliver(id, BOB); // resubmit → back to review
        assertEq(uint8(_phase(id)), uint8(NinjaPact.EscrowPhase.UnderReview));

        uint256 delivBefore = usd.balanceOf(BOB);
        vm.prank(ALICE);
        pact.confirmDelivery(id);
        assertEq(usd.balanceOf(BOB), delivBefore + STAKE);
    }

    function test_escrow_fix_timeout_refunds_payer() public {
        uint256 payerBefore = usd.balanceOf(ALICE);
        uint64 id = _createEscrow(ALICE, BOB, 2);
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.requestRevision(id, keccak256("broken"));

        vm.warp(block.timestamp + 3 days + 1); // deliverer abandons past fix window
        pact.settle(id);
        assertEq(usd.balanceOf(ALICE), payerBefore); // refunded
    }

    function test_escrow_revisions_exhausted_then_arbitrate_pass() public {
        uint64 id = _createEscrow(ALICE, BOB, 1); // one revision
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.requestRevision(id, keccak256("r1")); // uses the only revision
        _deliver(id, BOB);

        vm.prank(ALICE);
        pact.requestArbitration(id); // no revisions left → escalate
        assertEq(uint8(_phase(id)), uint8(NinjaPact.EscrowPhase.Arbitration));

        uint256 delivBefore = usd.balanceOf(BOB);
        bytes32 reason = keccak256("meets original spec");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reason);
        pact.arbitrate(id, true, reason, sig); // judge: meets spec → pay deliverer
        assertEq(usd.balanceOf(BOB), delivBefore + STAKE);
        (,,,,,NinjaPact.State s,,,) = pact.getCommitment(id);
        assertEq(uint8(s), uint8(NinjaPact.State.Settled));
    }

    function test_escrow_arbitrate_fail_refunds_payer() public {
        uint256 payerBefore = usd.balanceOf(ALICE);
        uint64 id = _createEscrow(ALICE, BOB, 0); // zero revisions → straight to arbitration
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.requestArbitration(id);

        bytes32 reason = keccak256("does not meet spec");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, false, false, reason);
        pact.arbitrate(id, false, reason, sig); // judge: fails spec → refund payer
        assertEq(usd.balanceOf(ALICE), payerBefore);
        assertTrue(!pact.escrowDelivered(id)); // refunded → source stays withheld
    }

    function test_escrow_never_delivered_refunds_payer() public {
        uint256 payerBefore = usd.balanceOf(ALICE);
        uint64 id = _createEscrow(ALICE, BOB, 2); // joined, InProgress, never delivers
        vm.warp(block.timestamp + 31 days);
        pact.settle(id);
        assertEq(usd.balanceOf(ALICE), payerBefore);
    }

    function test_escrow_deliverer_can_join_late() public {
        bytes32 secret = keccak256(abi.encodePacked("deliver", BOB));
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));
        vm.prank(ALICE);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.DEPOSIT, JUDGE, keccak256("late terms"),
            _defaultPolicy(1), _defaultSchedule(), STAKE, bytes32(0), inviteHash, 0
        );
        _fund(ALICE, id);

        vm.warp(block.timestamp + 10 days); // past a 48h window, before the deadline
        vm.prank(BOB);
        pact.joinCommitment(id, secret); // must still succeed

        uint256 delivBefore = usd.balanceOf(BOB);
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.confirmDelivery(id);
        assertEq(usd.balanceOf(BOB), delivBefore + STAKE);
    }

    function test_escrow_no_deliverer_refunds_payer() public {
        uint256 payerBefore = usd.balanceOf(ALICE);
        bytes32 inviteHash = keccak256(abi.encodePacked(keccak256("nobody")));
        vm.prank(ALICE);
        uint64 id = pact.createCommitment(
            NinjaPact.Mode.DEPOSIT, JUDGE, keccak256("unclaimed terms"),
            _defaultPolicy(0), _defaultSchedule(), STAKE, bytes32(0), inviteHash, 0
        );
        _fund(ALICE, id); // AwaitingParties, no deliverer ever joins

        vm.warp(block.timestamp + 31 days);
        pact.cancelUnfunded(id);
        assertEq(usd.balanceOf(ALICE), payerBefore); // refunded
    }

    // ── access control / guards ─────────────────────────────────────────────────

    function test_escrow_only_deliverer_submits() public {
        uint64 id = _createEscrow(ALICE, BOB, 1);
        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.NotDeliverer.selector);
        pact.submitDelivery(id, keccak256("x"));
    }

    function test_escrow_only_payer_confirms() public {
        uint64 id = _createEscrow(ALICE, BOB, 1);
        _deliver(id, BOB);
        vm.prank(BOB); // deliverer can't approve their own delivery
        vm.expectRevert(NinjaPact.NotPayer.selector);
        pact.confirmDelivery(id);
    }

    function test_escrow_no_revisions_left_reverts() public {
        uint64 id = _createEscrow(ALICE, BOB, 1);
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.requestRevision(id, keccak256("r1"));
        _deliver(id, BOB);
        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.NoRevisionsLeft.selector);
        pact.requestRevision(id, keccak256("r2"));
    }

    function test_escrow_arbitration_requires_revisions_exhausted() public {
        uint64 id = _createEscrow(ALICE, BOB, 2);
        _deliver(id, BOB);
        vm.prank(ALICE);
        vm.expectRevert(NinjaPact.RevisionsRemain.selector);
        pact.requestArbitration(id); // revisions still remain
    }

    function test_escrow_arbitrate_non_judge_reverts() public {
        uint64 id = _createEscrow(ALICE, BOB, 0);
        _deliver(id, BOB);
        vm.prank(ALICE);
        pact.requestArbitration(id);
        bytes32 reason = keccak256("x");
        bytes memory sig = _sign(NONJUDGE_KEY, id, 0, true, false, reason);
        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.arbitrate(id, true, reason, sig);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BADGE SOULBOUND
    // ══════════════════════════════════════════════════════════════════════════

    function test_badge_transfer_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        vm.warp(block.timestamp + 31 days);
        pact.settle(id);

        vm.prank(ALICE);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.transferFrom(ALICE, BOB, 1);
    }

    function test_badge_only_pact_can_mint() public {
        vm.prank(ALICE);
        vm.expectRevert(Badge.Unauthorized.selector);
        badge.mint(ALICE, 99);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // EDGE CASES
    // ══════════════════════════════════════════════════════════════════════════

    function test_fail_then_settle_at_end() public {
        // Reach fail threshold via submitVerdict before schedule end
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false); // → Locked

        vm.warp(block.timestamp + 31 days);
        // settle should revert since already Locked
        vm.expectRevert();
        pact.settle(id);
    }

    function test_pass_verdicts_then_settle_success() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        // Some passes
        for (uint i = 0; i < 10; i++) _verdict(id, true, false);
        // One partial fail (under threshold)
        _verdict(id, false, false);

        vm.warp(block.timestamp + 31 days);
        pact.settle(id);

        (,,,,,NinjaPact.State state,,,) = pact.getCommitment(id);
        assertEq(uint8(state), uint8(NinjaPact.State.Success));
    }

    function test_judge_zero_funds_not_drained() public {
        // Confirm Judge has no token balance after all operations
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false);
        // JUDGE address should never receive tokens
        assertEq(usd.balanceOf(JUDGE), 0);
    }

    function test_contract_balance_zero_after_success() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        vm.warp(block.timestamp + 31 days);
        pact.settle(id);
        assertEq(usd.balanceOf(address(pact)), 0);
    }

    function test_contract_balance_zero_after_claim() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id);
        _verdict(id, false, false);
        _verdict(id, false, false);
        _verdict(id, false, false);
        vm.warp(block.timestamp + 181 days);
        pact.claim(id);
        assertEq(usd.balanceOf(address(pact)), 0);
    }

    function test_multiple_commitments_independent() public {
        uint64 id1 = _createSolo(ALICE, 0);
        uint64 id2 = _createSolo(ALICE, 0);
        _fund(ALICE, id1);
        vm.startPrank(ALICE);
        usd.approve(address(pact), STAKE);
        pact.fund(id2);
        vm.stopPrank();

        // Fail id1
        _verdict(id1, false, false);
        _verdict(id1, false, false);
        _verdict(id1, false, false);

        // id2 still Active
        (,,,,,NinjaPact.State s1,,,) = pact.getCommitment(id1);
        (,,,,,NinjaPact.State s2,,,) = pact.getCommitment(id2);
        assertEq(uint8(s1), uint8(NinjaPact.State.Locked));
        assertEq(uint8(s2), uint8(NinjaPact.State.Active));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DUO PUBLIC-EVENT BET (对赌:Judge 签结果 → 赢家通吃;铁律#3 胜者∈两固定方)
    // ══════════════════════════════════════════════════════════════════════════

    // creator stakes a side; opponent joins the other via invite, staking equal.
    function _createBet(address creator, address opponent, bool creatorYes) internal returns (uint64 id) {
        bytes32 secret = keccak256(abi.encodePacked("bet", opponent));
        bytes32 inviteHash = keccak256(abi.encodePacked(secret));
        vm.prank(creator);
        id = pact.createBet(JUDGE, keccak256("Will Drake drop an album by Oct 1?"), _defaultSchedule(), STAKE, inviteHash, creatorYes);
        _fund(creator, id); // creator stakes → AwaitingParties
        usd.mint(opponent, STAKE);
        vm.startPrank(opponent);
        usd.approve(address(pact), STAKE);
        pact.joinCommitment(id, secret); // opponent stakes equal → Active
        vm.stopPrank();
    }

    function _resolveBet(uint64 id, bool outcome) internal {
        bytes32 reasonHash = keccak256("event resolved");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, outcome, false, reasonHash);
        pact.resolveBet(id, outcome, reasonHash, sig); // anyone may relay the signed verdict
    }

    function test_bet_yes_creator_wins() public {
        uint64 id = _createBet(ALICE, BOB, true); // ALICE = YES side
        assertEq(usd.balanceOf(address(pact)), 2 * STAKE); // both staked, escrowed
        uint256 a = usd.balanceOf(ALICE);
        uint256 b = usd.balanceOf(BOB);

        _resolveBet(id, true); // event happened → YES (ALICE) wins the pot

        assertEq(usd.balanceOf(ALICE), a + 2 * STAKE); // winner takes pot
        assertEq(usd.balanceOf(BOB), b);               // loser gets nothing back
        assertEq(usd.balanceOf(address(pact)), 0);
        assertEq(badge.balanceOf(ALICE), 1);
        (,,,,,NinjaPact.State s,,,) = pact.getCommitment(id);
        assertEq(uint8(s), uint8(NinjaPact.State.Settled));
    }

    function test_bet_no_opponent_wins() public {
        uint64 id = _createBet(ALICE, BOB, true); // ALICE = YES side, BOB = NO
        uint256 a = usd.balanceOf(ALICE);
        uint256 b = usd.balanceOf(BOB);

        _resolveBet(id, false); // event did NOT happen → NO (BOB) wins

        assertEq(usd.balanceOf(BOB), b + 2 * STAKE);
        assertEq(usd.balanceOf(ALICE), a);
        assertEq(badge.balanceOf(BOB), 1);
    }

    // creatorBetsYes=false mapping: creator holds the NO side and wins when outcome=false.
    function test_bet_creator_no_side_wins() public {
        uint64 id = _createBet(ALICE, BOB, false); // ALICE = NO side
        uint256 a = usd.balanceOf(ALICE);

        _resolveBet(id, false); // outcome==creatorBetsYes(false) → creator wins

        assertEq(usd.balanceOf(ALICE), a + 2 * STAKE);
    }

    function test_bet_resolve_non_judge_reverts() public {
        uint64 id = _createBet(ALICE, BOB, true);
        bytes32 reasonHash = keccak256("event resolved");
        bytes memory sig = _sign(NONJUDGE_KEY, id, 0, true, false, reasonHash);
        vm.expectRevert(NinjaPact.BadSignature.selector);
        pact.resolveBet(id, true, reasonHash, sig);
    }

    function test_bet_resolve_wrong_mode_reverts() public {
        uint64 id = _createSolo(ALICE, 0);
        _fund(ALICE, id); // SOLO → Active
        bytes32 reasonHash = keccak256("x");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);
        vm.expectRevert(NinjaPact.WrongPhase.selector);
        pact.resolveBet(id, true, reasonHash, sig);
    }

    function test_bet_resolve_replay_reverts() public {
        uint64 id = _createBet(ALICE, BOB, true);
        _resolveBet(id, true); // → Settled
        bytes32 reasonHash = keccak256("event resolved");
        bytes memory sig = _sign(JUDGE_KEY, id, 0, true, false, reasonHash);
        vm.expectRevert(); // inState(Active) guard → WrongState
        pact.resolveBet(id, true, reasonHash, sig);
    }

    function test_bet_timeout_refunds_both() public {
        uint64 id = _createBet(ALICE, BOB, true);
        uint256 a = usd.balanceOf(ALICE);
        uint256 b = usd.balanceOf(BOB);

        // Judge never resolves; past event deadline + grace → anyone settles, both refunded
        vm.warp(block.timestamp + 30 days + 3 days + 1);
        pact.settle(id);

        assertEq(usd.balanceOf(ALICE), a + STAKE); // own stake back
        assertEq(usd.balanceOf(BOB), b + STAKE);   // own stake back
        assertEq(usd.balanceOf(address(pact)), 0);
        (,,,,,NinjaPact.State s,,,) = pact.getCommitment(id);
        assertEq(uint8(s), uint8(NinjaPact.State.Settled));
    }

    function test_bet_settle_before_grace_reverts() public {
        uint64 id = _createBet(ALICE, BOB, true);
        vm.warp(block.timestamp + 30 days + 1); // past endTime but within grace
        vm.expectRevert(NinjaPact.NotSettleable.selector);
        pact.settle(id);
    }
}

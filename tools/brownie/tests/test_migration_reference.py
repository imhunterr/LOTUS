"""The synopsis's EVM behavior and gas reference, executed by real Brownie.

Fabric remains the application ledger. These tests deliberately exercise the
retained Solidity source, including its known public-calldata privacy boundary.
"""
import hashlib
import importlib.metadata
import json
import random
from pathlib import Path

import pytest
from brownie import (
    accounts, chain, web3, reverts, PoseidonT3, RoleRegistry, CustodyLedger,
    BatchRegistry, PrescriptionRegistry, DispenseLedger, RecallRegistry,
)

ZERO = "0x" + "00" * 32
NDC = "0002-1433-80"
GAS = {}
ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def suite():
    admin, mfr, dist, pharmacy, other, doctor, regulator = accounts[:7]
    PoseidonT3.deploy({"from": admin})
    roles = RoleRegistry.deploy(admin, {"from": admin})
    custody = CustodyLedger.deploy(roles, {"from": admin})
    lots = BatchRegistry.deploy(roles, custody, {"from": admin})
    permits = PrescriptionRegistry.deploy(roles, {"from": admin})
    dispenses = DispenseLedger.deploy(roles, lots, custody, permits, {"from": admin})
    recalls = RecallRegistry.deploy(roles, lots, dispenses, {"from": admin})
    dispenses.setRecallRegistry(recalls, {"from": admin})
    for contract in (lots, dispenses):
        roles.registerSystemContract(contract, {"from": admin})
    for actor, role in ((mfr, "MANUFACTURER"), (dist, "DISTRIBUTOR"),
                        (pharmacy, "PHARMACY"), (other, "PHARMACY"),
                        (doctor, "PRESCRIBER"), (regulator, "REGULATOR")):
        roles.registerActor(actor, web3.keccak(text=role), 1, {"from": admin})
    GAS["register_lot"] = lots.registerLot(NDC, "BROWNIE-REFERENCE", chain.time() + 86400,
                                           ZERO, 100, {"from": mfr}).gas_used
    lot = lots.lotKeyOf(NDC, "BROWNIE-REFERENCE")
    for sender, recipient, quantity in ((mfr, dist, 100), (dist, pharmacy, 80), (dist, other, 20)):
        sid = custody.shipmentCount()
        custody.ship(lot, recipient, quantity, ZERO, {"from": sender})
        custody.accept(sid, {"from": recipient})
    secret = "0x" + "42" * 32  # Public, isolated test credential only.
    GAS["issue_permit"] = permits.issue(web3.keccak(hexstr=secret), NDC, 30,
                                        chain.time() + 3600, {"from": doctor}).gas_used
    return locals()


@pytest.fixture(autouse=True)
def isolate(fn_isolation):
    pass


def request(s, qty, commitment=101, lot=None):
    return (lot or s["lot"], 0, s["secret"], qty, commitment, ZERO)


def test_partial_fill_transfer_and_recall(suite):
    s = suite
    GAS["dispense_first_leaf"] = s["dispenses"].dispense(request(s, 10), {"from": s["pharmacy"]}).gas_used
    assert s["permits"].getPermit(0)[2] == 20
    s["permits"].transferPermit(0, s["other"], {"from": s["pharmacy"]})
    GAS["dispense_second_leaf"] = s["dispenses"].dispense(request(s, 20, 102), {"from": s["other"]}).gas_used
    assert s["permits"].getPermit(0)[2] == 0
    GAS["recall"] = s["recalls"].issueRecall(s["lot"], 1, ZERO, False, {"from": s["regulator"]}).gas_used
    assert s["recalls"].totalAffected(0) == 30
    assert s["dispenses"].verifyCommit(101)
    with reverts("Dispense: lot recalled"):
        s["dispenses"].dispense(request(s, 1, 103), {"from": s["other"]})


def test_duplicate_and_overfill_are_atomic(suite):
    s = suite
    s["dispenses"].dispense(request(s, 10), {"from": s["pharmacy"]})
    before = s["custody"].onHand(s["lot"], s["pharmacy"])
    with reverts("Dispense: commitment reused"):
        s["dispenses"].dispense(request(s, 1), {"from": s["pharmacy"]})
    with reverts("Rx: insufficient balance"):
        s["dispenses"].dispense(request(s, 21, 102), {"from": s["pharmacy"]})
    assert s["permits"].getPermit(0)[2] == 20
    assert s["custody"].onHand(s["lot"], s["pharmacy"]) == before


def test_batch_rolls_back_every_entry(suite):
    s = suite
    with reverts("Rx: insufficient balance"):
        s["dispenses"].dispenseBatch([request(s, 10, 201), request(s, 25, 202)], {"from": s["pharmacy"]})
    assert s["permits"].getPermit(0)[2] == 30
    assert s["dispenses"].totalDispenses() == 0
    assert not s["dispenses"].verifyCommit(201)


def test_wrong_actor_and_immutable_recall(suite):
    s = suite
    for actor in (s["mfr"], s["dist"], s["pharmacy"], s["doctor"], accounts[9]):
        with reverts():
            s["recalls"].issueRecall(s["lot"], 1, ZERO, False, {"from": actor})
    s["recalls"].issueRecall(s["lot"], 1, ZERO, False, {"from": s["regulator"]})
    with reverts("Recall: already recalled"):
        s["recalls"].issueRecall(s["lot"], 2, ZERO, False, {"from": s["regulator"]})


def test_absent_custody_rejects_and_preserves_permit(suite):
    s = suite
    s["lots"].registerLot(NDC, "NEVER-RECEIVED", chain.time()+86400, ZERO, 10, {"from": s["mfr"]})
    lot = s["lots"].lotKeyOf(NDC, "NEVER-RECEIVED")
    with reverts("Custody: lot never received"):
        s["dispenses"].dispense(request(s, 1, lot=lot), {"from": s["pharmacy"]})
    assert s["permits"].getPermit(0)[2] == 30


def test_seeded_adversarial_closure(suite):
    s, rng, rejected = suite, random.Random(84121), 0
    for index in range(40):
        quantity = rng.randint(1, 35)
        try:
            if rng.random() < 0.6:
                s["dispenses"].dispense(request(s, quantity, 1000+index), {"from": s["pharmacy"]})
            else:
                s["custody"].reportShrinkage(s["lot"], quantity, ZERO, {"from": s["pharmacy"]})
        except Exception as error:
            # Only an actual EVM rejection counts; infrastructure errors must fail.
            from brownie.exceptions import VirtualMachineError
            if not isinstance(error, VirtualMachineError):
                raise
            rejected += 1
        inbound, dispensed, returned, shrinkage = s["custody"].bookOf(s["pharmacy"], s["lot"])
        assert dispensed + returned + shrinkage <= inbound
        assert s["custody"].onHand(s["lot"], s["pharmacy"]) == inbound-dispensed-returned-shrinkage
        assert s["permits"].getPermit(0)[2] >= 0
    assert rejected > 0


def teardown_module():
    output = ROOT / "test-results" / "brownie"
    output.mkdir(parents=True, exist_ok=True)
    sources = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in sorted((ROOT / "contracts/contracts").rglob("*.sol"))}
    (output / "gas-reference.json").write_text(json.dumps({
        "tool": "eth-brownie", "version": importlib.metadata.version("eth-brownie"),
        "network": "isolated local EVM", "compiler": "0.8.24", "optimizerRuns": 200,
        "gas": GAS, "sourceSha256": sources,
        "scope": "Retained Solidity reference; not Fabric throughput or application privacy evidence",
    }, indent=2))

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/comparators.circom";

// LOTUS anonymous membership proof.
//
// Proves, without revealing which leaf:
//   1. commitment = Poseidon(secret, Poseidon(secret, index)) is a leaf of the lot's Merkle tree
//   2. nullifierHash = Poseidon(secret, externalNullifier)   (one signal per patient per topic)
//   3. signalHash is bound to the proof (a relayer can't swap the report contents)
//
// The tree is a LeanIMT (see contracts/libraries/LotTree.sol): the proof carries only the levels
// that really have a sibling; `depth` says how many, the rest are padding.
//
// Public inputs order MUST match AnonymousSignals: [root, nullifierHash, externalNullifier, signalHash]
template LotusMembership(MAX_DEPTH) {
    signal input root;
    signal input nullifierHash;
    signal input externalNullifier;
    signal input signalHash;

    signal input secret;
    signal input index;
    signal input depth;
    signal input pathElements[MAX_DEPTH];
    signal input pathIndices[MAX_DEPTH];

    component nonce = Poseidon(2);
    nonce.inputs[0] <== secret;
    nonce.inputs[1] <== index;

    component leaf = Poseidon(2);
    leaf.inputs[0] <== secret;
    leaf.inputs[1] <== nonce.out;

    component nul = Poseidon(2);
    nul.inputs[0] <== secret;
    nul.inputs[1] <== externalNullifier;
    nul.out === nullifierHash;

    // Walk all MAX_DEPTH levels; pick the node at level `depth` as the computed root.
    signal nodes[MAX_DEPTH + 1];
    signal picked[MAX_DEPTH + 1];
    component isDepth[MAX_DEPTH + 1];
    component muxes[MAX_DEPTH];
    component hashers[MAX_DEPTH];
    nodes[0] <== leaf.out;

    var computed = 0;
    for (var i = 0; i < MAX_DEPTH; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        isDepth[i] = IsEqual();
        isDepth[i].in[0] <== depth;
        isDepth[i].in[1] <== i;
        picked[i] <== isDepth[i].out * nodes[i];
        computed += picked[i];

        muxes[i] = MultiMux1(2);
        muxes[i].c[0][0] <== nodes[i];
        muxes[i].c[0][1] <== pathElements[i];
        muxes[i].c[1][0] <== pathElements[i];
        muxes[i].c[1][1] <== nodes[i];
        muxes[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxes[i].out[0];
        hashers[i].inputs[1] <== muxes[i].out[1];
        nodes[i + 1] <== hashers[i].out;
    }
    isDepth[MAX_DEPTH] = IsEqual();
    isDepth[MAX_DEPTH].in[0] <== depth;
    isDepth[MAX_DEPTH].in[1] <== MAX_DEPTH;
    picked[MAX_DEPTH] <== isDepth[MAX_DEPTH].out * nodes[MAX_DEPTH];
    computed += picked[MAX_DEPTH];

    root === computed;

    signal signalSquared;
    signalSquared <== signalHash * signalHash;
}

component main {public [root, nullifierHash, externalNullifier, signalHash]} = LotusMembership(16);

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// LOTUS anonymous membership proof.
//
// Proves, without revealing which leaf:
//   1. commitment = Poseidon(secret, Poseidon(secret, index)) is a leaf of the lot's Merkle tree
//   2. nullifierHash = Poseidon(secret, externalNullifier)   (one signal per patient per topic)
//   3. signalHash is bound to the proof (prevents a relayer from swapping the report contents)
//
// Public inputs order MUST match AnonymousSignals: [root, nullifierHash, externalNullifier, signalHash]
template LotusMembership(depth) {
    signal input root;
    signal input nullifierHash;
    signal input externalNullifier;
    signal input signalHash;

    signal input secret;
    signal input index;
    signal input pathElements[depth];
    signal input pathIndices[depth];

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

    component hashers[depth];
    component muxes[depth];
    signal levelHash[depth + 1];
    levelHash[0] <== leaf.out;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        muxes[i] = MultiMux1(2);
        muxes[i].c[0][0] <== levelHash[i];
        muxes[i].c[0][1] <== pathElements[i];
        muxes[i].c[1][0] <== pathElements[i];
        muxes[i].c[1][1] <== levelHash[i];
        muxes[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxes[i].out[0];
        hashers[i].inputs[1] <== muxes[i].out[1];
        levelHash[i + 1] <== hashers[i].out;
    }
    root === levelHash[depth];

    signal signalSquared;
    signalSquared <== signalHash * signalHash;
}

component main {public [root, nullifierHash, externalNullifier, signalHash]} = LotusMembership(16);

pragma circom 2.2.3;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Research one-input/two-output relation. No membership or global-spentness
// claim. Zero-value outputs are padding; a zero-value input cannot be spent.
template Step() {
    signal input context;
    signal input inputCommitment;
    signal input nullifier;
    signal input outputCommitments[2];
    signal input nonce;
    signal input transferDigest;

    signal input secret;
    signal input asset;
    signal input inputValue;
    signal input inputRandomness;
    signal input outputOwners[2];
    signal input outputValues[2];
    signal input outputRandomness[2];

    component secretZero = IsZero();
    secretZero.in <== secret;
    secretZero.out === 0;
    component inputZero = IsZero();
    inputZero.in <== inputValue;
    inputZero.out === 0;

    component owner = Poseidon(3);
    owner.inputs[0] <== 101;
    owner.inputs[1] <== context;
    owner.inputs[2] <== secret;

    component inputRange = Num2Bits(64);
    inputRange.in <== inputValue;
    component outputRanges[2];
    for (var i = 0; i < 2; i++) {
        outputRanges[i] = Num2Bits(64);
        outputRanges[i].in <== outputValues[i];
    }
    inputValue === outputValues[0] + outputValues[1];

    component inputNote = Poseidon(6);
    inputNote.inputs[0] <== 102;
    inputNote.inputs[1] <== context;
    inputNote.inputs[2] <== asset;
    inputNote.inputs[3] <== owner.out;
    inputNote.inputs[4] <== inputValue;
    inputNote.inputs[5] <== inputRandomness;
    inputNote.out === inputCommitment;

    component spent = Poseidon(4);
    spent.inputs[0] <== 103;
    spent.inputs[1] <== context;
    spent.inputs[2] <== secret;
    spent.inputs[3] <== inputCommitment;
    spent.out === nullifier;

    component outputNotes[2];
    for (var j = 0; j < 2; j++) {
        outputNotes[j] = Poseidon(6);
        outputNotes[j].inputs[0] <== 102;
        outputNotes[j].inputs[1] <== context;
        outputNotes[j].inputs[2] <== asset;
        outputNotes[j].inputs[3] <== outputOwners[j];
        outputNotes[j].inputs[4] <== outputValues[j];
        outputNotes[j].inputs[5] <== outputRandomness[j];
        outputNotes[j].out === outputCommitments[j];
    }
    component equalOutputs = IsZero();
    equalOutputs.in <== outputCommitments[0] - outputCommitments[1];
    equalOutputs.out === 0;

    component transcript = Poseidon(7);
    transcript.inputs[0] <== 104;
    transcript.inputs[1] <== context;
    transcript.inputs[2] <== inputCommitment;
    transcript.inputs[3] <== nullifier;
    transcript.inputs[4] <== outputCommitments[0];
    transcript.inputs[5] <== outputCommitments[1];
    transcript.inputs[6] <== nonce;
    transcript.out === transferDigest;
}

component main {public [context, inputCommitment, nullifier, outputCommitments, nonce, transferDigest]} = Step();

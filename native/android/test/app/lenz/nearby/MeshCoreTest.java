package app.lenz.nearby;

import java.util.*;

public final class MeshCoreTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        byte[] original = new byte[204800];
        new Random(17).nextBytes(original);
        List<byte[]> frames = MeshCore.fragment(original, 7, 180);
        check(frames.size() > 1000, "large envelopes need fragments");
        Collections.reverse(frames);
        MeshCore receiver = new MeshCore();
        MeshCore.Envelope received = null;
        for (byte[] frame : frames) {
            MeshCore.Envelope next = receiver.receive("alice", frame, 1000);
            if (next != null) received = next;
        }
        check(received != null && Arrays.equals(original, received.bytes), "reordered fragments retain exact encrypted bytes");
        check(received.hops == 7, "hop budget retained on receive");
        check(receiver.receive("alice", frames.get(0), 1001) == null, "fragment duplicate does not deliver again");
        MeshCore concurrent = new MeshCore();
        List<byte[]> otherMtu = MeshCore.fragment(original, 6, 512);
        concurrent.receive("other-peer", otherMtu.get(0), 1100);
        MeshCore.Envelope valid = null;
        for (byte[] frame : frames) { MeshCore.Envelope next = concurrent.receive("alice", frame, 1100); if (next != null) valid = next; }
        check(valid != null && Arrays.equals(valid.bytes, original), "another peer's MTU cannot poison a valid assembly");
        byte[] damaged = frames.get(0).clone(); damaged[damaged.length - 1] ^= 1;
        MeshCore tampered = new MeshCore();
        boolean rejected = false;
        try {
            for (int i = 0; i < frames.size(); i++) tampered.receive("attacker", i == 0 ? damaged : frames.get(i), 2000);
        } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "content digest must reject corrupted ciphertext");
        MeshCore incomplete = new MeshCore();
        for (int i = 1; i < frames.size(); i++) check(incomplete.receive("alice", frames.get(i), 3000) == null, "missing fragment cannot deliver");
        check(incomplete.receive("alice", frames.get(0), 40000) == null, "expired partial transfer cannot combine with old fragments");
        rejected = false;
        try { MeshCore.fragment(new byte[204801], 7, 180); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "oversized envelopes rejected before radio send");
        rejected = false;
        try { MeshCore.fragment(new byte[10], 8, 180); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "invalid relay TTL rejected");
        rejected = false;
        try { MeshCore.fragment(new byte[10], 7, 20); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "unsupported small MTU is explicit");
        System.out.println("9 native mesh behavior checks passed");
    }
}

package app.lenz.nearby;

public final class MeshTokensTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        MeshTokens tokens = new MeshTokens();
        MeshCore.Envelope envelope = new MeshCore.Envelope(new byte[]{3,4}, 5);
        String token = tokens.offer(envelope, "ingress", "alice", 1000);
        boolean rejected = false;
        try { tokens.take(token, "bob", 1001); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "wrong owner cannot authorize forwarding");
        MeshTokens.Pending value = tokens.take(token, "alice", 1002);
        check(value.bytes[1] == 4 && value.hops == 5 && value.source.equals("ingress"), "permission retains exact payload, hops and ingress");
        rejected = false;
        try { tokens.take(token, "alice", 1003); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "discard or forwarding consumes permission once");
        token = tokens.offer(envelope, "ingress", "alice", 2000);
        rejected = false;
        try { tokens.take(token, "alice", 32000); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "expired receive permission cannot forward");
        token = tokens.offer(envelope, "ingress", "alice", 40000); tokens.clear();
        rejected = false;
        try { tokens.take(token, "alice", 40001); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "session shutdown invalidates pending permission");
        for (int i = 0; i < 16; i++) tokens.offer(envelope, "ingress", "alice", 50000);
        rejected = false;
        try { tokens.offer(envelope, "ingress", "alice", 50000); } catch (IllegalStateException expected) { rejected = true; }
        check(rejected, "receive permission capacity is bounded");
        System.out.println("6 native receive-permission checks passed");
    }
}

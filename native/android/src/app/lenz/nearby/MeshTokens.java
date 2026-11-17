package app.lenz.nearby;

import java.util.*;

/** One-use forwarding/discard permission for exact received bytes and current account. */
public final class MeshTokens {
    public static final class Pending {
        public final byte[] bytes;
        public final int hops;
        public final String source, owner;
        private final long expires;
        Pending(MeshCore.Envelope envelope, String source, String owner, long now) {
            bytes = envelope.bytes.clone(); hops = envelope.hops; this.source = source; this.owner = owner; expires = now + 30000;
        }
    }
    private final LinkedHashMap<String, Pending> pending = new LinkedHashMap<>();
    private void purge(long now) { pending.values().removeIf(value -> value.expires <= now); }
    public synchronized String offer(MeshCore.Envelope envelope, String source, String owner, long now) {
        purge(now); int retained = 0; for (Pending value : pending.values()) retained += value.bytes.length;
        if (pending.size() >= 16 || retained + envelope.bytes.length > 1048576) throw new IllegalStateException("Bluetooth intake is full.");
        String token = UUID.randomUUID().toString(); pending.put(token, new Pending(envelope, source, owner, now)); return token;
    }
    public synchronized Pending take(String token, String owner, long now) {
        purge(now); Pending value = pending.get(token);
        if (value == null || !value.owner.equals(owner)) throw new IllegalArgumentException("Bluetooth receive permission expired or belongs to another account.");
        pending.remove(token); return value;
    }
    public synchronized void clear() { pending.clear(); }
}

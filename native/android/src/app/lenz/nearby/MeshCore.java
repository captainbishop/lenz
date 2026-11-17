package app.lenz.nearby;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.*;

/** Lenz ciphertext framing. This is a Lenz wire protocol, not a Bitchat client. */
public final class MeshCore {
    public static final int MAX_BYTES = 204800, MAX_HOPS = 7;
    private static final int HEADER = 28, MAX_FRAGMENTS = 8192;
    private static final long ASSEMBLY_MS = 30000, DUPLICATE_MS = 5000;
    private final LinkedHashMap<String, Assembly> assemblies = new LinkedHashMap<>();
    private final LinkedHashMap<String, Long> delivered = new LinkedHashMap<>();

    public static final class Envelope {
        public final byte[] bytes;
        public final int hops;
        public final String id;
        Envelope(byte[] bytes, int hops) { this.bytes = bytes; this.hops = hops; this.id = digestId(bytes); }
    }
    private static final class Assembly {
        final byte[][] fragments;
        final int total, hops;
        final long started;
        final String peer;
        int bytes, count;
        Assembly(int count, int total, int hops, long now, String peer) {
            fragments = new byte[count][]; this.total = total; this.hops = hops; started = now; this.peer = peer;
        }
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }
    private static byte[] digest(byte[] payload) {
        try { return Arrays.copyOf(MessageDigest.getInstance("SHA-256").digest(payload), 16); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) text.append(String.format(Locale.ROOT, "%02x", b & 255));
        return text.toString();
    }
    public static String digestId(byte[] payload) { return hex(digest(payload)); }
    public static List<byte[]> fragment(byte[] payload, int hops, int frameBytes) {
        require(payload != null && payload.length > 0 && payload.length <= MAX_BYTES, "Envelope size is invalid.");
        require(hops > 0 && hops <= MAX_HOPS, "Hop limit is invalid.");
        require(frameBytes >= 61 && frameBytes <= 512, "This Bluetooth link has an unsupported MTU.");
        int chunk = frameBytes - HEADER, count = (payload.length + chunk - 1) / chunk;
        require(count <= MAX_FRAGMENTS, "Too many Bluetooth fragments.");
        byte[] hash = digest(payload);
        List<byte[]> frames = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            int offset = i * chunk, length = Math.min(chunk, payload.length - offset);
            ByteBuffer frame = ByteBuffer.allocate(HEADER + length);
            frame.put((byte) 'L').put((byte) 'Z').put((byte) 1).put((byte) hops);
            frame.putShort((short) i).putShort((short) count).putInt(payload.length).put(hash);
            frame.put(payload, offset, length); frames.add(frame.array());
        }
        return frames;
    }
    public synchronized Envelope receive(String peer, byte[] frame, long now) {
        assemblies.entrySet().removeIf(entry -> now - entry.getValue().started > ASSEMBLY_MS);
        delivered.entrySet().removeIf(entry -> now - entry.getValue() > DUPLICATE_MS);
        require(peer != null && frame != null && frame.length > HEADER && frame.length <= 512, "Invalid Bluetooth frame.");
        ByteBuffer input = ByteBuffer.wrap(frame);
        require(input.get() == 'L' && input.get() == 'Z' && input.get() == 1, "Unknown Bluetooth frame version.");
        int hops = input.get() & 255, index = input.getShort() & 65535, count = input.getShort() & 65535, total = input.getInt();
        require(hops > 0 && hops <= MAX_HOPS && count > 0 && count <= MAX_FRAGMENTS && index < count && total > 0 && total <= MAX_BYTES, "Invalid Bluetooth frame bounds.");
        require(count <= total && (long) count * (512 - HEADER) >= total, "Invalid Bluetooth fragment count.");
        byte[] hash = new byte[16]; input.get(hash); String id = hex(hash);
        if (delivered.containsKey(id)) return null;
        String assemblyId = peer + ":" + id;
        Assembly assembly = assemblies.get(assemblyId);
        if (assembly == null) {
            require(assemblies.size() < 16, "Bluetooth assembly capacity is full.");
            int samePeer = 0, retained = 0;
            for (Assembly existing : assemblies.values()) { if (existing.peer.equals(peer)) samePeer++; retained += existing.total; }
            require(samePeer < 4 && retained + total <= 1048576, "Bluetooth peer assembly capacity is full.");
            assembly = new Assembly(count, total, hops, now, peer); assemblies.put(assemblyId, assembly);
        }
        require(assembly.total == total && assembly.fragments.length == count && assembly.hops == hops, "Conflicting Bluetooth fragments.");
        byte[] fragment = new byte[input.remaining()]; input.get(fragment);
        if (assembly.fragments[index] != null) {
            require(Arrays.equals(fragment, assembly.fragments[index]), "Conflicting duplicate Bluetooth fragment.");
            return null;
        }
        assembly.fragments[index] = fragment; assembly.bytes += fragment.length; assembly.count++;
        if (assembly.bytes > total) { assemblies.remove(assemblyId); throw new IllegalArgumentException("Bluetooth transfer exceeds its declared size."); }
        if (assembly.count != count) return null;
        assemblies.remove(assemblyId);
        require(assembly.bytes == total, "Incomplete Bluetooth transfer.");
        byte[] payload = new byte[total]; int offset = 0;
        for (byte[] part : assembly.fragments) { System.arraycopy(part, 0, payload, offset, part.length); offset += part.length; }
        require(MessageDigest.isEqual(hash, digest(payload)), "Bluetooth ciphertext digest does not match.");
        delivered.put(id, now); while (delivered.size() > 1024) delivered.remove(delivered.keySet().iterator().next());
        return new Envelope(payload, hops);
    }
    public synchronized void clear() { assemblies.clear(); delivered.clear(); }
}

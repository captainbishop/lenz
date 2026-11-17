package app.lenz.nearby;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Device-private retention of already encrypted envelopes, scoped to one Lenz account. */
public final class MeshQueue {
    public static final int MAX_ITEMS = 32, MAX_STORAGE = 1048576;
    public static final long MAX_LIFETIME = 86400000;
    public static final class Item {
        public final String id, ingress;
        public final byte[] bytes;
        public final int hops;
        public final long expires;
        public final Map<String, Integer> attempts = new HashMap<>();
        Item(byte[] bytes, int hops, long expires, String ingress) {
            this.bytes = bytes.clone(); this.hops = hops; this.expires = expires; this.ingress = ingress;
            id = MeshCore.digestId(bytes);
        }
    }
    private final File file;
    private String owner = "";
    private final LinkedHashMap<String, Item> items = new LinkedHashMap<>();
    public MeshQueue(File file) { this.file = file; }
    public synchronized void open(String nextOwner, long now) throws IOException {
        if (!nextOwner.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid Lenz account scope.");
        if (owner.equals(nextOwner)) { purge(now); return; }
        items.clear(); owner = nextOwner;
        if (file.isFile()) {
            try (DataInputStream input = new DataInputStream(new BufferedInputStream(new FileInputStream(file)))) {
                if (input.readInt() != 2 || !owner.equals(input.readUTF())) { save(); return; }
                int count = input.readInt(), total = 0;
                if (count < 0 || count > MAX_ITEMS) throw new IOException("Invalid Bluetooth retention count.");
                for (int i = 0; i < count; i++) {
                    int hops = input.readUnsignedByte(); long expires = input.readLong(); String ingress = input.readUTF(); int length = input.readInt();
                    if (ingress.length() > 64 || hops < 1 || hops > MeshCore.MAX_HOPS || length < 1 || length > MeshCore.MAX_BYTES || (total += length) > MAX_STORAGE) throw new IOException("Invalid Bluetooth retention bounds.");
                    byte[] bytes = new byte[length]; input.readFully(bytes);
                    if (expires > now && expires - now <= MAX_LIFETIME) {
                        Item item = new Item(bytes, hops, expires, ingress); items.put(item.id, item);
                    }
                }
                if (input.read() != -1) throw new IOException("Unexpected Bluetooth retention bytes.");
            } catch (IOException malformed) { items.clear(); }
        }
        save();
    }
    public synchronized Item add(byte[] bytes, int hops, long expires, String ingress, long now) throws IOException {
        if (owner.isEmpty() || bytes == null || bytes.length == 0 || bytes.length > MeshCore.MAX_BYTES || hops < 1 || hops > MeshCore.MAX_HOPS || expires <= now || expires - now > MAX_LIFETIME) throw new IllegalArgumentException("Invalid Bluetooth retention request.");
        purge(now);
        String id = MeshCore.digestId(bytes);
        if (items.containsKey(id)) return items.get(id);
        ingress = ingress == null ? "" : ingress;
        if (ingress.length() > 64) throw new IllegalArgumentException("Invalid Bluetooth ingress scope.");
        int retained = 0, relayBytes = 0, relays = 0, samePeer = 0;
        for (Item item : items.values()) {
            retained += item.bytes.length;
            if (!item.ingress.isEmpty()) { relayBytes += item.bytes.length; relays++; if (item.ingress.equals(ingress)) samePeer++; }
        }
        if (!ingress.isEmpty() && (relays >= 8 || relayBytes + bytes.length > 262144 || samePeer >= 4)) throw new IllegalStateException("Bluetooth relay capacity is full.");
        if (items.size() >= MAX_ITEMS || retained + bytes.length > MAX_STORAGE) throw new IllegalStateException("Bluetooth queue is full. Original messages remain in Lenz.");
        Item item = new Item(bytes, hops, expires, ingress); items.put(id, item);
        try { save(); } catch (IOException error) { items.remove(id); throw error; }
        return item;
    }
    public synchronized List<Item> pending(long now) throws IOException { purge(now); return new ArrayList<>(items.values()); }
    public synchronized String forget(byte[] bytes) throws IOException {
        String id = MeshCore.digestId(bytes); Item item = items.get(id);
        if (item == null || !Arrays.equals(item.bytes, bytes)) return "";
        items.remove(id);
        try { save(); } catch (IOException error) { items.put(id, item); throw error; }
        return id;
    }
    private void purge(long now) throws IOException {
        if (items.values().removeIf(item -> item.expires <= now)) save();
    }
    private void save() throws IOException {
        File parent = file.getParentFile(); if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Bluetooth queue directory unavailable.");
        File temporary = new File(parent, file.getName() + ".new");
        try (FileOutputStream stream = new FileOutputStream(temporary); DataOutputStream output = new DataOutputStream(new BufferedOutputStream(stream))) {
            output.writeInt(2); output.writeUTF(owner); output.writeInt(items.size());
            for (Item item : items.values()) { output.writeByte(item.hops); output.writeLong(item.expires); output.writeUTF(item.ingress); output.writeInt(item.bytes.length); output.write(item.bytes); }
            output.flush(); stream.getFD().sync();
        }
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
    public synchronized void clear() throws IOException { items.clear(); owner = ""; save(); }
}

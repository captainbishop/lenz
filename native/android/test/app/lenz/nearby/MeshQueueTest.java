package app.lenz.nearby;

import java.io.*;
import java.nio.file.*;

public final class MeshQueueTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        File directory = Files.createTempDirectory("lenz-native-queue-").toFile();
        File file = new File(directory, "queue.bin");
        String alice = new String(new char[64]).replace('\0', 'a'), bob = new String(new char[64]).replace('\0', 'b');
        MeshQueue queue = new MeshQueue(file); queue.open(alice, 1000);
        queue.add(new byte[] {1,2,3}, 7, 5000, "", 1000);
        queue.add(new byte[] {1,2,3}, 7, 5000, "", 1000);
        check(queue.pending(1000).size() == 1, "retries retain one original envelope");
        check(queue.forget(new byte[] {9}).isEmpty() && queue.pending(1000).size() == 1, "unrelated acknowledgement cannot erase queued bytes");
        MeshQueue restarted = new MeshQueue(file); restarted.open(alice, 2000);
        check(restarted.pending(2000).size() == 1 && restarted.pending(2000).get(0).bytes[2] == 3, "same account restart retains exact encrypted bytes");
        check(restarted.pending(5000).isEmpty(), "expired envelope is removed");
        restarted.add(new byte[] {4}, 7, 9000, "", 5000); restarted.open(bob, 6000);
        check(restarted.pending(6000).isEmpty(), "account changes cannot dispatch old account queue");
        for (int i = 0; i < 32; i++) restarted.add(new byte[] {(byte)i}, 7, 10000, "", 6000);
        boolean rejected = false;
        try { restarted.add(new byte[] {99}, 7, 10000, "", 6000); } catch (IllegalStateException expected) { rejected = true; }
        check(rejected, "queue capacity preserves original entries");
        restarted.clear(); restarted.open(bob, 7000);
        check(restarted.pending(7000).isEmpty(), "explicit stop erases retained native queue");
        for (int i = 0; i < 4; i++) restarted.add(new byte[] {(byte)i}, 6, 10000, "peer", 7000);
        rejected = false;
        try { restarted.add(new byte[] {90}, 6, 10000, "peer", 7000); } catch (IllegalStateException expected) { rejected = true; }
        check(rejected, "one authenticated relay cannot exhaust sender slots");
        MeshQueue relayRestart = new MeshQueue(file); relayRestart.open(bob, 7000);
        check(relayRestart.pending(7000).get(0).ingress.equals("peer"), "restart preserves relay capacity classification");
        Files.delete(file.toPath()); Files.delete(directory.toPath());
        System.out.println("9 native queue behavior checks passed");
    }
}

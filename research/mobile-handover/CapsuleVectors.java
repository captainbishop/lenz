import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;

public final class CapsuleVectors {
    private static byte[] hex(String text) {
        if (!text.matches("(?:[0-9a-f]{2})*")) throw new IllegalArgumentException("invalid-hex");
        byte[] result = new byte[text.length() / 2];
        for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        return result;
    }
    private static void check(boolean ok, String why) { if (!ok) throw new AssertionError(why); }
    public static void main(String[] args) throws Exception {
        int count = 0;
        for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8)) {
            if (line.startsWith("id\t") || line.isEmpty()) continue;
            String[] v = line.split("\t", -1);
            check(v.length == 10, "wrong vector column count");
            String id = v[0], expected = v[1], domain = v[2], handoff = v[3];
            byte[] key = hex(v[4]), nonce = hex(v[5]), plaintext = hex(v[6]), ciphertext = hex(v[7]), tag = hex(v[8]);
            try {
                check(Arrays.equals(CapsuleCrypto.aad(domain, handoff), hex(v[9])), id + ": AAD mismatch");
                byte[] opened = CapsuleCrypto.open(key, domain, handoff, nonce, ciphertext, tag);
                check(expected.equals("accept"), id + ": unexpectedly accepted");
                check(Arrays.equals(opened, plaintext), id + ": plaintext mismatch");
                CapsuleCrypto.Envelope sealed = CapsuleCrypto.sealForVector(plaintext, key, domain, handoff, nonce);
                check(Arrays.equals(sealed.ciphertext, ciphertext) && Arrays.equals(sealed.tag, tag), id + ": encryption mismatch");
                check(Arrays.equals(CapsuleCrypto.open(key, domain, handoff, nonce, ciphertext, tag), plaintext), id + ": exact retry mismatch");
                CapsuleCrypto.Envelope fresh = CapsuleCrypto.seal(plaintext, key, domain, handoff);
                check(!Arrays.equals(fresh.nonce, nonce), id + ": nonce reused");
                check(Arrays.equals(CapsuleCrypto.open(key, domain, handoff, fresh.nonce, fresh.ciphertext, fresh.tag), plaintext), id + ": fresh round trip failed");
            } catch (AEADBadTagException e) {
                check(expected.equals("reject-auth"), id + ": unexpected authentication failure");
            } catch (IllegalArgumentException e) {
                check(expected.equals("reject-format"), id + ": unexpected format failure: " + e.getMessage());
            }
            count++;
        }
        check(count > 0, "no vectors exercised");
        System.out.println("JVM vectors passed: " + count);
    }
}

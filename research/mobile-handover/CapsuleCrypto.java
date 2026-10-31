import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

// Java 8 API surface suitable for later Android integration. Desktop JVM tests
// do not validate Android providers, storage, key exchange, or BLE behavior.
public final class CapsuleCrypto {
    public static final int MAX_BYTES = 65536;
    public static final String VERSION = "proof-u/witness-capsule/v1";
    private static final SecureRandom RANDOM = new SecureRandom();

    public static final class Envelope {
        public final byte[] nonce, ciphertext, tag;
        Envelope(byte[] nonce, byte[] ciphertext, byte[] tag) {
            this.nonce = nonce.clone(); this.ciphertext = ciphertext.clone(); this.tag = tag.clone();
        }
    }

    private static void require(boolean condition, String reason) {
        if (!condition) throw new IllegalArgumentException(reason);
    }

    public static byte[] aad(String domain, String handoff) {
        require(domain != null && domain.matches("[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}"), "unsupported-domain");
        require(handoff != null && handoff.matches("[0-9a-f]{32}"), "invalid-handoff");
        return ("[\"" + VERSION + "\",\"" + domain + "\",\"" + handoff + "\"]").getBytes(StandardCharsets.UTF_8);
    }

    public static Envelope seal(byte[] plaintext, byte[] key, String domain, String handoff) throws GeneralSecurityException {
        byte[] nonce = new byte[12];
        RANDOM.nextBytes(nonce);
        return sealForVector(plaintext, key, domain, handoff, nonce);
    }

    // Package-private deterministic entry point used ONLY by the public vectors.
    static Envelope sealForVector(byte[] plaintext, byte[] key, String domain, String handoff, byte[] nonce) throws GeneralSecurityException {
        require(key != null && key.length == 32, "invalid-key");
        require(nonce != null && nonce.length == 12, "invalid-nonce");
        require(plaintext != null && plaintext.length > 0 && plaintext.length <= MAX_BYTES, "invalid-plaintext-size");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad(domain, handoff));
        byte[] combined = cipher.doFinal(plaintext); // JVM returns ciphertext || tag.
        return new Envelope(nonce, Arrays.copyOf(combined, combined.length - 16), Arrays.copyOfRange(combined, combined.length - 16, combined.length));
    }

    public static byte[] open(byte[] key, String expectedDomain, String expectedHandoff, byte[] nonce, byte[] ciphertext, byte[] tag) throws GeneralSecurityException {
        require(key != null && key.length == 32, "invalid-key");
        require(nonce != null && nonce.length == 12, "invalid-nonce");
        require(tag != null && tag.length == 16, "invalid-tag");
        require(ciphertext != null && ciphertext.length > 0 && ciphertext.length <= MAX_BYTES, "invalid-ciphertext-size");
        byte[] combined = Arrays.copyOf(ciphertext, ciphertext.length + tag.length);
        System.arraycopy(tag, 0, combined, ciphertext.length, tag.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(aad(expectedDomain, expectedHandoff));
        return cipher.doFinal(combined); // Returns no plaintext on tag failure.
    }
}

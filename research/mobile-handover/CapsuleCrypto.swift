import Foundation
import CryptoKit

// Prepared for Apple platforms; not compiled/tested on this Windows host.
// Byte crypto only. Caller must validate the capsule and its payment proofs.
enum CapsuleCrypto {
    static let version = "proof-u/witness-capsule/v1"
    static let maxBytes = 65_536
    enum FormatError: Error { case invalid }
    struct Envelope { let nonce: Data; let ciphertext: Data; let tag: Data }

    static func aad(domain: String, handoff: String) throws -> Data {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:/-".utf8)
        let first = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".utf8)
        let domainBytes = Array(domain.utf8)
        guard let head = domainBytes.first, domainBytes.count <= 128,
              first.contains(head), domainBytes.allSatisfy({ allowed.contains($0) }),
              handoff.utf8.count == 32,
              handoff.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw FormatError.invalid
        }
        return Data("[\"\(version)\",\"\(domain)\",\"\(handoff)\"]".utf8)
    }

    static func seal(_ plaintext: Data, key: Data, domain: String, handoff: String) throws -> Envelope {
        try sealForVector(plaintext, key: key, domain: domain, handoff: handoff, nonce: Data(AES.GCM.Nonce()))
    }

    // Internal deterministic entry point ONLY for these public test vectors.
    static func sealForVector(_ plaintext: Data, key: Data, domain: String, handoff: String, nonce: Data) throws -> Envelope {
        guard key.count == 32, nonce.count == 12, !plaintext.isEmpty, plaintext.count <= maxBytes else {
            throw FormatError.invalid
        }
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad(domain: domain, handoff: handoff))
        return Envelope(nonce: Data(box.nonce), ciphertext: box.ciphertext, tag: box.tag)
    }

    static func open(key: Data, expectedDomain: String, expectedHandoff: String, nonce: Data, ciphertext: Data, tag: Data) throws -> Data {
        guard key.count == 32, nonce.count == 12, tag.count == 16, !ciphertext.isEmpty, ciphertext.count <= maxBytes else {
            throw FormatError.invalid
        }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ciphertext, tag: tag)
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad(domain: expectedDomain, handoff: expectedHandoff))
    }
}

import Foundation
import CryptoKit

@main struct CapsuleVectors {
    static func check(_ ok: Bool, _ reason: String) { precondition(ok, reason) }
    static func hex(_ text: String) throws -> Data {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0, chars.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw CapsuleCrypto.FormatError.invalid
        }
        var result = Data()
        for i in stride(from: 0, to: chars.count, by: 2) {
            let high = chars[i] <= 57 ? chars[i] - 48 : chars[i] - 87
            let low = chars[i + 1] <= 57 ? chars[i + 1] - 48 : chars[i + 1] - 87
            result.append(high * 16 + low)
        }
        return result
    }
    static func main() throws {
        let contents = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        var count = 0
        for line in contents.split(separator: "\n") where !line.hasPrefix("id\t") {
            let v = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
            check(v.count == 10, "wrong vector column count")
            let id = v[0], expected = v[1], domain = v[2], handoff = v[3]
            let key = try hex(v[4]), nonce = try hex(v[5]), plaintext = try hex(v[6]), ciphertext = try hex(v[7]), tag = try hex(v[8])
            do {
                check(try CapsuleCrypto.aad(domain: domain, handoff: handoff) == hex(v[9]), "\(id): AAD mismatch")
                let opened = try CapsuleCrypto.open(key: key, expectedDomain: domain, expectedHandoff: handoff, nonce: nonce, ciphertext: ciphertext, tag: tag)
                check(expected == "accept" && opened == plaintext, "\(id): unexpected plaintext acceptance")
                let sealed = try CapsuleCrypto.sealForVector(plaintext, key: key, domain: domain, handoff: handoff, nonce: nonce)
                check(sealed.ciphertext == ciphertext && sealed.tag == tag, "\(id): encryption mismatch")
                let retry = try CapsuleCrypto.open(key: key, expectedDomain: domain, expectedHandoff: handoff, nonce: nonce, ciphertext: ciphertext, tag: tag)
                check(retry == plaintext, "\(id): exact retry mismatch")
                let fresh = try CapsuleCrypto.seal(plaintext, key: key, domain: domain, handoff: handoff)
                check(fresh.nonce != nonce, "\(id): nonce reused")
                let roundTrip = try CapsuleCrypto.open(key: key, expectedDomain: domain, expectedHandoff: handoff, nonce: fresh.nonce, ciphertext: fresh.ciphertext, tag: fresh.tag)
                check(roundTrip == plaintext, "\(id): fresh round trip failed")
            } catch CapsuleCrypto.FormatError.invalid {
                check(expected == "reject-format", "\(id): unexpected format failure")
            } catch CryptoKitError.authenticationFailure {
                check(expected == "reject-auth", "\(id): unexpected authentication failure")
            }
            count += 1
        }
        check(count > 0, "no vectors exercised")
        print("Swift/CryptoKit vectors passed: \(count)")
    }
}

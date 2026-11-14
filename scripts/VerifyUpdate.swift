import Foundation
import CryptoKit

// Verify against the trust anchor shipped in the app, independently of the signing key.
do {
    let publicKey = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let bytes = Data(base64Encoded: publicKey), let signature = Data(base64Encoded: CommandLine.arguments[3]) else { throw CocoaError(.fileReadCorruptFile) }
    let key = try Curve25519.Signing.PublicKey(rawRepresentation: bytes)
    let archive = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
    guard key.isValidSignature(signature, for: archive) else { throw CocoaError(.fileReadCorruptFile) }
} catch {
    fputs("Update signature does not match the app's trusted public key.\n", stderr)
    exit(1)
}

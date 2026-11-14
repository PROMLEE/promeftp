import CryptoKit
import Foundation

let key = Curve25519.Signing.PrivateKey()
let destination = URL(fileURLWithPath: CommandLine.arguments[1])
try key.rawRepresentation.base64EncodedData().write(to: destination, options: [.withoutOverwriting])
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
print(key.publicKey.rawRepresentation.base64EncodedString())

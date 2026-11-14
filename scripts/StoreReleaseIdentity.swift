import Foundation
import Security
import LocalAuthentication

let service = "com.promlee.promeftp.release-signing"
let account = "production"
let identity: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: service,
    kSecAttrAccount: account,
]
func check(_ result: OSStatus) {
    guard result == errSecSuccess else {
        let message = SecCopyErrorMessageString(result, nil) as String? ?? "Keychain error"
        FileHandle.standardError.write(Data((message + "\n").utf8))
        exit(1)
    }
}
if CommandLine.arguments[1] == "--read" {
    var query = identity
    query[kSecReturnData] = true
    let authentication = LAContext()
    authentication.interactionNotAllowed = true
    query[kSecUseAuthenticationContext] = authentication
    var data: CFTypeRef?
    check(SecItemCopyMatching(query as CFDictionary, &data))
    FileHandle.standardOutput.write(data as! Data)
} else {
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    var query = identity
    query[kSecValueData] = data
    check(SecItemAdd(query as CFDictionary, nil))
}

import Darwin
import Foundation

let protocolVersion = 1

func report(_ code: String, exitCode: Int32 = 1) -> Never {
    let json = try! JSONSerialization.data(withJSONObject: ["version": protocolVersion, "error": code])
    FileHandle.standardOutput.write(json + Data([10]))
    exit(exitCode)
}

func help() -> Never {
    print("""
    promeftp profiles list
    promeftp session open --profile ID --mode sftp|ssh
    promeftp session status|close --session ID
    promeftp sftp list|stat|download --session ID --path PATH
    promeftp ssh run --session ID --task TASK
    promeftp ssh command --session ID --command COMMAND
    promeftp events list --session ID [--after CURSOR]
    All operations emit JSON. Supply PROMEFTP_AGENT_TOKEN via the environment.
    """)
    exit(0)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.isEmpty || arguments == ["--help"] { help() }
guard arguments.count >= 2 else { report("USAGE", exitCode: 2) }
let method = arguments.prefix(2).joined(separator: ".")
let methods: [String: [String]] = [
    "profiles.list": [], "session.open": ["profile","mode"], "session.status": ["session"],
    "session.close": ["session"], "sftp.list": ["session","path"], "sftp.stat": ["session","path"],
    "sftp.download": ["session","path"], "ssh.run": ["session","task"], "ssh.command": ["session","command"],
    "events.list": ["session","after"],
]
guard let allowed = methods[method] else { report("USAGE", exitCode: 2) }
var params: [String: Any] = [:]
var index = 2
while index < arguments.count {
    let option = arguments[index]
    if option == "--json" { index += 1; continue }
    guard option.hasPrefix("--"), index + 1 < arguments.count else { report("USAGE", exitCode: 2) }
    let key = String(option.dropFirst(2))
    guard allowed.contains(key), params[key] == nil else { report("USAGE", exitCode: 2) }
    if key == "after" {
        guard let cursor = Int(arguments[index + 1]), cursor >= 0 else { report("USAGE", exitCode: 2) }
        params[key] = cursor
    } else {
        params[key] = arguments[index + 1]
    }
    index += 2
}
guard allowed.filter({ $0 != "after" }).allSatisfy({ params[$0] != nil }) else { report("USAGE", exitCode: 2) }
guard let token = ProcessInfo.processInfo.environment["PROMEFTP_AGENT_TOKEN"], token.utf8.count == 43 else {
    report("CREDENTIAL_REQUIRED", exitCode: 3)
}

let fd = socket(AF_UNIX, SOCK_STREAM, 0)
guard fd >= 0 else { report("SOCKET_ERROR") }
var timeout = timeval(tv_sec: 38, tv_usec: 0)
setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
var on: Int32 = 1
setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
let socketPath = "/tmp/promeftp-agent-\(getuid())/api.sock"
let socketBytes = socketPath.utf8CString
withUnsafeMutableBytes(of: &address.sun_path) { bytes in
    for (index, char) in socketBytes.enumerated() { bytes[index] = UInt8(bitPattern: char) }
}
let connected = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
}
guard connected == 0 else { report("APP_OFFLINE", exitCode: 4) }
var peer = uid_t()
var group = gid_t()
guard getpeereid(fd, &peer, &group) == 0 && peer == getuid() else { report("UNSAFE_SOCKET") }
let request = try! JSONSerialization.data(withJSONObject: [
    "version": protocolVersion, "token": token, "method": method, "params": params,
]) + Data([10])
guard request.count <= 16_384 else { report("REQUEST_LIMIT", exitCode: 2) }
let sent = request.withUnsafeBytes { buffer -> Bool in
    var offset = 0
    while offset < buffer.count {
        let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
        if count == -1 && errno == EINTR { continue }
        if count <= 0 { return false }
        offset += count
    }
    return true
}
guard sent else { report("SOCKET_ERROR") }
var response = Data()
var buffer = [UInt8](repeating: 0, count: 8192)
while true {
    let count = Darwin.read(fd, &buffer, buffer.count)
    if count == -1 && errno == EINTR { continue }
    if count < 0 { report("SOCKET_ERROR") }
    if count == 0 { break }
    response.append(contentsOf: buffer.prefix(count))
    if response.count > 2 * 1024 * 1024 { report("RESPONSE_LIMIT") }
    if response.last == 10 { break }
}
close(fd)
guard let object = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
      object["version"] as? Int == protocolVersion else { report("INVALID_RESPONSE") }
FileHandle.standardOutput.write(response)
if object["error"] != nil { exit(1) }
if let data = object["data"] as? [String: Any], data["exitCode"] != nil,
   (data["exitCode"] as? Int != 0 || data["truncated"] as? Bool == true) { exit(5) }

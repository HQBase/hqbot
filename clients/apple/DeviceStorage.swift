#if os(macOS)
import Foundation
import Security

struct LocalJob: Codable {
    let id: String
    let botId: String
    let command: String
    let directory: String
    let state: String
}
struct LocalReceipt: Codable {
    let id: String
    let claimId: String
    var state: String
    var result: String
}
struct DevicePairing: Codable {
    let origin: String
    let token: String
    let folder: String
}
struct DeviceStorage {
    private static let service = "com.hqbot.local-companion"
    static func pairing() throws -> DevicePairing? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "pairing", kSecReturnData as String: true]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ClientError.message("Keychain is unavailable. Unlock the Mac and try again.") }
        return try JSONDecoder().decode(DevicePairing.self, from: data)
    }
    static func save(_ value: DevicePairing?) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "pairing"]
        guard let value else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw ClientError.message("Keychain could not remove the pairing. Local access remains disabled.") }
            return
        }
        let data = try JSONEncoder().encode(value)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query; insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw ClientError.message("The device pairing could not be saved in Keychain.") }
        } else if status != errSecSuccess { throw ClientError.message("The device pairing could not be saved in Keychain.") }
    }
    static var journalURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("HQBot/local-receipts.json")
    }
    static func receipts() throws -> [LocalReceipt] {
        guard FileManager.default.fileExists(atPath: journalURL.path) else { return [] }
        return try JSONDecoder().decode([LocalReceipt].self, from: Data(contentsOf: journalURL))
    }
    static func saveReceipts(_ values: [LocalReceipt]) throws {
        try FileManager.default.createDirectory(at: journalURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(values).write(to: journalURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journalURL.path)
    }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
#endif

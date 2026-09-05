import Foundation
@main struct ProcessTests {
    static func main() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let normal = CommandProcess().run(command: "printf 'hqbot-native-ok'", directory: folder)
        precondition(normal.0 == "completed" && normal.1 == "hqbot-native-ok", "Normal process result")
        let bad = CommandProcess().run(command: "exit 7", directory: folder)
        precondition(bad.0 == "failed", "Nonzero exit")
        let flood = CommandProcess().run(command: "head -c 50000 /dev/zero", directory: folder)
        precondition(flood.1.utf8.count <= 32000, "Output limit")
        let stopped = CommandProcess()
        let work = Task.detached { stopped.run(command: "sleep 20; printf 'must-not-run'", directory: folder) }
        try await Task.sleep(for: .milliseconds(200)); stopped.cancel()
        let result = await work.value
        precondition(result.0 == "uncertain" && !result.1.contains("must-not-run"), "Cancellation")
        let early = CommandProcess(); early.cancel()
        precondition(early.run(command: "touch forbidden", directory: folder).0 == "uncertain", "Early stop")
        precondition(!FileManager.default.fileExists(atPath: folder.appendingPathComponent("forbidden").path))
        print("5 native process checks passed")
    }
}

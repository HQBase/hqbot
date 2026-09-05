#if os(macOS)
import AppKit
import SwiftUI

@MainActor final class LocalCompanion: ObservableObject {
    @Published var status = "Local access is off"
    @Published var paired = false
    static weak var active: LocalCompanion?
    func stopForExit() { process?.cancel(force: true) }
    private var pairing: DevicePairing?
    private var timer: Timer?
    private var busy = false
    private var generation = 0
    private var process: CommandProcess?
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    init() {
        Self.active = self
        do {
            pairing = UserDefaults.standard.bool(forKey: "localAccessDisabled") ? nil : try DeviceStorage.pairing(); paired = pairing != nil
            if paired { status = "Paired. Waiting for local requests."; startPolling() }
        } catch { status = error.localizedDescription }
    }
    func pair(origin: String, code: String, folder: URL) async {
        guard !busy, pairing == nil else { status = "Remove the current pairing first."; return }
        let revision = generation
        do {
            let url = try workspaceURL(origin)
            let response = try await request(origin: url.absoluteString, token: nil, path: "/pair", body: ["code": code.trimmingCharacters(in: .whitespacesAndNewlines), "name": Host.current().localizedName ?? "Mac"])
            guard let token = response["token"] as? String else { throw ClientError.message("The workspace did not return a device token.") }
            let value = DevicePairing(origin: url.absoluteString, token: token, folder: folder.resolvingSymlinksInPath().path)
            guard revision == generation else {
                _ = try? await request(origin: value.origin, token: value.token, path: "/unpair", body: [:]); return
            }
            do { try DeviceStorage.save(value) }
            catch { _ = try? await request(origin: value.origin, token: value.token, path: "/unpair", body: [:]); throw error }
            UserDefaults.standard.set(false, forKey: "localAccessDisabled")
            pairing = value; paired = true; status = "Paired. Every command still needs your approval."; startPolling()
        } catch { status = error.localizedDescription }
    }
    func disconnect() {
        generation += 1
        UserDefaults.standard.set(true, forKey: "localAccessDisabled")
        timer?.invalidate(); timer = nil; process?.cancel()
        let old = pairing; pairing = nil; paired = false
        do { try DeviceStorage.save(nil) } catch { status = error.localizedDescription; return }
        status = "Local access is off. Remove this device in Settings if the workspace is offline."
        if let old { Task { _ = try? await request(origin: old.origin, token: old.token, path: "/unpair", body: [:]) } }
    }
    private func startPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in await self?.poll() } }
    }
    private func request(origin: String, token: String?, path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        let root = try workspaceURL(origin)
        let url = root.appendingPathComponent("api/local-client" + path)
        var request = URLRequest(url: url); request.timeoutInterval = 20
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            throw ClientError.message("The workspace did not accept the device request. Check the connection or remove and pair the device again.")
        }
        guard data.count <= 200000, let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ClientError.message("Invalid workspace response.") }
        return result
    }
    private func send(_ value: LocalReceipt, pairing: DevicePairing) async throws {
        _ = try await request(origin: pairing.origin, token: pairing.token, path: "/result", body: ["id": value.id, "claimId": value.claimId, "state": value.state, "result": value.result])
    }
    private func poll() async {
        guard !busy, let current = pairing else { return }
        busy = true; defer { busy = false }
        do {
            var receipts = try DeviceStorage.receipts()
            for index in receipts.indices where receipts[index].state == "claimed" {
                receipts[index].state = "uncertain"; receipts[index].result = "The companion restarted before saving an outcome. Check the Mac. This command was not repeated."
            }
            try DeviceStorage.saveReceipts(receipts)
            // Settle saved outcomes before accepting new commands. Never replay a local process.
            for receipt in receipts {
                let response = try await request(origin: current.origin, token: current.token, path: "/jobs/" + receipt.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)
                let state = (response["job"] as? [String: Any])?["state"] as? String
                if state == "claimed" || state == "running" { try await send(receipt, pairing: current) }
                receipts.removeAll { $0.id == receipt.id }; try DeviceStorage.saveReceipts(receipts)
            }
            let response = try await request(origin: current.origin, token: current.token, path: "/jobs")
            guard let values = response["jobs"] as? [[String: Any]], let first = values.first else { return }
            let job = try JSONDecoder().decode(LocalJob.self, from: JSONSerialization.data(withJSONObject: first))
            guard pairing?.token == current.token else { return }
            var receipt = LocalReceipt(id: job.id, claimId: UUID().uuidString, state: "claimed", result: "")
            // Save before claim so an uncertain network response can never cause execution on retry.
            receipts.append(receipt); try DeviceStorage.saveReceipts(receipts)
            _ = try await request(origin: current.origin, token: current.token, path: "/claim", body: ["id": job.id, "claimId": receipt.claimId])
            let folder = try workingFolder(root: current.folder, relative: job.directory)
            status = "A teammate is asking to run a local command."
            let accepted = approve(job: job, folder: folder, origin: current.origin)
            if !accepted { receipt.state = "denied"; receipt.result = "The owner declined this local command." }
            else {
                guard pairing?.token == current.token else { return }
                let started = try await request(origin: current.origin, token: current.token, path: "/start", body: ["id": job.id, "claimId": receipt.claimId])
                guard started["started"] as? Bool == true else { throw ClientError.message("Execution was not confirmed. The command was not run.") }
                guard pairing?.token == current.token else { return }
                let child = CommandProcess(); process = child; status = "Running the approved command…"
                let monitor = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(2))
                        if Task.isCancelled { return }
                        do {
                            let update = try await request(origin: current.origin, token: current.token, path: "/jobs/" + job.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)
                            if (update["job"] as? [String: Any])?["state"] as? String != "running" { child.cancel(); return }
                        } catch { child.cancel(); return }
                    }
                }
                let result = await Task.detached { child.run(command: job.command, directory: folder) }.value
                monitor.cancel(); process = nil; receipt.state = result.0; receipt.result = result.1
            }
            receipts.removeAll { $0.id == receipt.id }; receipts.append(receipt)
            try DeviceStorage.saveReceipts(receipts)
            try await send(receipt, pairing: current)
            receipts.removeAll { $0.id == receipt.id }; try DeviceStorage.saveReceipts(receipts)
            status = "Result saved. Waiting for local requests."
        } catch { process?.cancel(); status = error.localizedDescription }
    }
    private func workingFolder(root: String, relative: String) throws -> URL {
        let base = URL(fileURLWithPath: root).resolvingSymlinksInPath().standardizedFileURL
        let folder = base.appendingPathComponent(relative).resolvingSymlinksInPath().standardizedFileURL
        guard !relative.hasPrefix("/"), folder.path == base.path || folder.path.hasPrefix(base.path + "/") else { throw ClientError.message("The working folder is outside the selected workspace.") }
        return folder
    }
    private func approve(job: LocalJob, folder: URL, origin: String) -> Bool {
        let alert = NSAlert(); alert.alertStyle = .warning
        alert.messageText = "Allow this local command?"
        alert.informativeText = "Workspace: \(origin)\nTeammate: \(job.botId)\nFolder: \(folder.path)\n\nThis command runs with your Mac account. The folder is a starting location, not a filesystem sandbox. Output is sent to this workspace."
        alert.addButton(withTitle: "Deny"); alert.addButton(withTitle: "Run once")
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 180)); scroll.hasVerticalScroller = true
        let text = NSTextView(frame: scroll.bounds); text.string = job.command; text.isEditable = false; text.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        text.autoresizingMask = [.width]; scroll.documentView = text; alert.accessoryView = scroll
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertSecondButtonReturn
    }
}
#endif

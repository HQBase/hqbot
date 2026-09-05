import SwiftUI
import WebKit

@main
struct HQBotApp: App {
    @StateObject private var settings = AppSettings()
    #if os(macOS)
    @NSApplicationDelegateAdaptor(ClientLifecycle.self) private var lifecycle
    @StateObject private var companion = LocalCompanion()
    #endif
    var body: some Scene {
        WindowGroup {
            ClientHome(settings: settings)
                #if os(macOS)
                .environmentObject(companion)
                .frame(minWidth: 420, minHeight: 600)
                #endif
        }
        #if os(macOS)
        .commands { CommandGroup(replacing: .newItem) {} }
        #endif
    }
}

@MainActor final class AppSettings: ObservableObject {
    @Published var origin = UserDefaults.standard.string(forKey: "workspaceOrigin") ?? ""
    func save(_ value: String) throws {
        let url = try workspaceURL(value)
        origin = url.absoluteString
        UserDefaults.standard.set(origin, forKey: "workspaceOrigin")
    }
}
func workspaceURL(_ value: String) throws -> URL {
    guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
          url.scheme == "https", let host = url.host, !host.isEmpty,
          url.user == nil, url.password == nil,
          url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil else {
        throw ClientError.message("Enter the HTTPS address of your HQBot workspace, with no path.")
    }
    return url
}
enum ClientError: Error, LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}
struct ClientHome: View {
    @ObservedObject var settings: AppSettings
    @State private var editing = false
    @State private var address = ""
    @State private var error = ""
    #if os(macOS)
    @EnvironmentObject var companion: LocalCompanion
    @State private var localAccess = false
    #endif
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("HQBot").font(.headline)
                Spacer()
                #if os(macOS)
                Button("Local access") { localAccess = true }
                    .disabled(settings.origin.isEmpty)
                    .sheet(isPresented: $localAccess) { LocalAccessView(companion: companion, origin: settings.origin) }
                #endif
                Button("Workspace") { address = settings.origin; editing = true }
            }.padding(12)
            Divider()
            if let url = try? workspaceURL(settings.origin) {
                WorkspaceWebView(url: url).id(settings.origin)
            } else {
                VStack(spacing: 16) {
                    Text("Your AI teammates, wherever you work.").font(.title2)
                    Text("Connect to your own HQBot workspace.").foregroundStyle(.secondary)
                    Button("Connect workspace") { editing = true }
                }.padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $editing) {
            VStack(alignment: .leading, spacing: 18) {
                Text("Connect your workspace").font(.title2)
                TextField("https://your-workspace.workers.dev", text: $address)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                    .textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
                    #endif
                Text("Sign in on the workspace page. HQBot does not use a shared account or relay.").font(.callout).foregroundStyle(.secondary)
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                HStack {
                    Button("Cancel") { editing = false }
                    Spacer()
                    Button("Connect") {
                        do {
                            let previous = settings.origin
                            let next = try workspaceURL(address).absoluteString
                            #if os(macOS)
                            if previous != next { companion.disconnect() }
                            #endif
                            try settings.save(address); error = ""; editing = false
                        } catch { self.error = error.localizedDescription }
                    }
                }
            }.padding(24)
            #if os(macOS)
            .frame(width: 450)
            #endif
        }
    }
}

#if os(macOS)
@MainActor final class ClientLifecycle: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        LocalCompanion.active?.stopForExit(); return .terminateNow
    }
}
#endif

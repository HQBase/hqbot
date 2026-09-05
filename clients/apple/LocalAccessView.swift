#if os(macOS)
import SwiftUI
import AppKit
struct LocalAccessView: View {
    @ObservedObject var companion: LocalCompanion
    let origin: String
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var folder: URL?
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Local access").font(.title2)
            Text("Let selected teammates request commands on this Mac. You approve each command here. Commands run with your Mac account and can access files outside the working folder.").font(.callout).foregroundStyle(.secondary)
            if !companion.paired {
                Text("In HQBot, open Settings → Devices → Pair a computer.").font(.callout)
                SecureField("Pairing code", text: $code).textFieldStyle(.roundedBorder)
                Button(folder?.path ?? "Choose a working folder…") {
                    let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true
                    if panel.runModal() == .OK { folder = panel.url }
                }.lineLimit(2)
                Button(saving ? "Pairing…" : "Pair this Mac") {
                    guard let folder else { return }; saving = true
                    Task { await companion.pair(origin: origin, code: code, folder: folder); code = ""; saving = false }
                }.disabled(saving || code.isEmpty || folder == nil)
            } else { Button("Remove local access", role: .destructive) { companion.disconnect() } }
            Text(companion.status).font(.callout).textSelection(.enabled)
            HStack { Spacer(); Button("Done") { dismiss() } }
        }.padding(24).frame(width: 520)
    }
}
#endif

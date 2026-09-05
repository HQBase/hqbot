import SwiftUI
import WebKit
#if os(macOS)
import AppKit
typealias PlatformViewRepresentable = NSViewRepresentable
#else
import UIKit
typealias PlatformViewRepresentable = UIViewRepresentable
#endif

struct WorkspaceWebView: PlatformViewRepresentable {
    let url: URL
    func makeCoordinator() -> WebCoordinator { WebCoordinator(origin: url) }
    func makeWebView(_ coordinator: WebCoordinator) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Remote pages have no native message handler, script bridge, or command authority.
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: url))
        return view
    }
    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
    #else
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
    #endif
}
@MainActor final class WebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let origin: URL
    private var destinations: [ObjectIdentifier: URL] = [:]
    init(origin: URL) { self.origin = origin }
    func sameOrigin(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == origin.host && (url.port ?? 443) == (origin.port ?? 443)
    }
    func external(_ url: URL) {
        guard url.scheme == "https" else { return }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if sameOrigin(url) { decisionHandler(action.shouldPerformDownload ? .download : .allow) }
        else if url.scheme == "blob", action.shouldPerformDownload {
            decisionHandler(.download)
        } else {
            if action.navigationType == .linkActivated { external(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" { external(url) }
        return nil
    }
    #if os(macOS)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    #endif
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        #if os(macOS)
        let panel = NSSavePanel(); panel.nameFieldStringValue = name
        panel.begin { result in completionHandler(result == .OK ? panel.url : nil) }
        #else
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let target = directory.appendingPathComponent(name)
            destinations[ObjectIdentifier(download)] = target; completionHandler(target)
        } catch { completionHandler(nil) }
        #endif
    }
    func downloadDidFinish(_ download: WKDownload) {
        #if os(iOS)
        guard let target = destinations.removeValue(forKey: ObjectIdentifier(download)),
              let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
        let share = UIActivityViewController(activityItems: [target], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = root.view
        root.present(share, animated: true)
        #endif
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

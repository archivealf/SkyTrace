import SwiftUI
import UIKit
import WebKit

struct SkyTraceWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(context.coordinator, name: "skytraceLiveActivity")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.__SKYTRACE_NATIVE_IOS__ = true;",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.isUserInteractionEnabled = true
        webView.scrollView.isUserInteractionEnabled = true
        webView.scrollView.delaysContentTouches = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "skytraceLiveActivity")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "skytraceLiveActivity",
                  JSONSerialization.isValidJSONObject(message.body),
                  let data = try? JSONSerialization.data(withJSONObject: message.body),
                  let payload = try? JSONDecoder().decode(FlightActivityMessage.self, from: data) else { return }
            Task { @MainActor in await LiveActivityController.shared.handle(payload) }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .linkActivated,
               let target = navigationAction.request.url,
               let targetHost = target.host,
               let currentHost = webView.url?.host,
               targetHost.caseInsensitiveCompare(currentHost) != .orderedSame {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            // If WebKit kills the content process under memory pressure, reload
            // instead of leaving a visually intact but permanently untouchable UI.
            webView.reloadFromOrigin()
        }
    }
}

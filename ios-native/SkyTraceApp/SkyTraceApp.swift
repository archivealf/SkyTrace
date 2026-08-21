import SwiftUI

@main
struct SkyTraceApp: App {
    var body: some Scene {
        WindowGroup {
            SkyTraceRootView()
        }
    }
}

struct SkyTraceRootView: View {
    private var webURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SKYTRACE_WEB_URL") as? String else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty,
              !value.contains("YOUR-SKYTRACE-HOST"),
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              (scheme == "https" || scheme == "http"),
              url.host != nil else { return nil }
        return url
    }

    var body: some View {
        Group {
            if let webURL {
                SkyTraceWebView(url: webURL)
                    .ignoresSafeArea()
            } else {
                ContentUnavailableView(
                    "SkyTrace URL missing",
                    systemImage: "airplane",
                    description: Text("Set SKYTRACE_WEB_URL in Config/Info.plist to your SkyTrace /app/ URL.")
                )
            }
        }
        .preferredColorScheme(.dark)
    }
}

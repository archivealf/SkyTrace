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
        return URL(string: raw)
    }

    var body: some View {
        Group {
            if let webURL {
                SkyTraceWebView(url: webURL)
                    .ignoresSafeArea()
            } else {
                ContentUnavailableView("SkyTrace URL missing", systemImage: "airplane", description: Text("Set SKYTRACE_WEB_URL in Config/Info.plist."))
            }
        }
        .preferredColorScheme(.dark)
    }
}

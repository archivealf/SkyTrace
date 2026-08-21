# SkyTrace iOS Native Bridge (35.0)

This is the native companion for the SkyTrace 35.0 mobile web client. The map and account UI remain the same SkyTrace web app; the SwiftUI shell adds Apple-only features that a Home Screen PWA cannot provide, starting with ActivityKit Live Activities and Dynamic Island presentation.

## Generate the Xcode project

1. Install XcodeGen on the Mac used for iOS development.
2. In this directory run `xcodegen generate`.
3. Open `SkyTraceIOS.xcodeproj` in Xcode.
4. Change `SKYTRACE_WEB_URL` in `Config/Info.plist` to the public HTTPS URL of the SkyTrace commerce app, ending in `/app/`.
5. Select your Apple signing team for both the `SkyTrace` app and `SkyTraceActivityWidget` extension.
6. Run on a physical iPhone. Live Activities appear on the Lock Screen; supported Dynamic Island iPhones also show the compact/expanded island UI.

The web client calls the native `skytraceLiveActivity` WKWebView message handler when a user taps **Dynamic Island / Live Activity** on an aircraft. The app starts, updates and ends an ActivityKit activity for that aircraft.

## Remote background updates

The current bridge updates while the SkyTrace app is active. Background/server-driven Live Activity updates require APNs Live Activity push tokens plus the appropriate Apple Developer capabilities. Add those only when the deployment account is ready for push notifications; do not put APNs keys or signing secrets in this repository.

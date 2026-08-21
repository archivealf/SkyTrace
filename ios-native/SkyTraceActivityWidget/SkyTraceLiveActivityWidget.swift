import ActivityKit
import SwiftUI
import WidgetKit

struct SkyTraceLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SkyTraceActivityAttributes.self) { context in
            LockScreenActivityView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.92))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.callsign).font(.headline)
                        Text(context.attributes.registration).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(context.state.altitudeFt.formatted()) ft").font(.headline)
                        Text(verticalText(context.state.verticalRateFpm)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Label("\(context.state.speedKts) kt", systemImage: "speedometer")
                        Spacer()
                        if !context.attributes.origin.isEmpty || !context.attributes.destination.isEmpty {
                            Text("\(context.attributes.origin.isEmpty ? "—" : context.attributes.origin) → \(context.attributes.destination.isEmpty ? "—" : context.attributes.destination)")
                        } else if let distance = context.state.distanceNm {
                            Text(String(format: "%.1f nm away", distance))
                        }
                    }
                    .font(.caption)
                }
            } compactLeading: {
                Image(systemName: "airplane")
            } compactTrailing: {
                Text(shortAltitude(context.state.altitudeFt)).font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: "airplane")
            }
            .keylineTint(.blue)
        }
    }

    private func shortAltitude(_ feet: Int) -> String {
        if feet >= 1000 { return String(format: "%.1fk", Double(feet) / 1000) }
        return "\(feet)"
    }

    private func verticalText(_ rate: Int) -> String {
        if rate > 100 { return "↑ \(rate.formatted()) fpm" }
        if rate < -100 { return "↓ \(abs(rate).formatted()) fpm" }
        return "Level"
    }
}

private struct LockScreenActivityView: View {
    let context: ActivityViewContext<SkyTraceActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "airplane")
                .font(.title2)
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(context.attributes.callsign).font(.headline)
                    if !context.attributes.operatorName.isEmpty {
                        Text(context.attributes.operatorName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Text("\(context.state.altitudeFt.formatted()) ft · \(context.state.speedKts) kt · \(verticalText)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !context.attributes.origin.isEmpty || !context.attributes.destination.isEmpty {
                    Text("\(context.attributes.origin.isEmpty ? "—" : context.attributes.origin) → \(context.attributes.destination.isEmpty ? "—" : context.attributes.destination)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if let distance = context.state.distanceNm {
                Text(String(format: "%.1f nm", distance)).font(.caption.monospacedDigit())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var verticalText: String {
        let rate = context.state.verticalRateFpm
        if rate > 100 { return "↑ \(rate.formatted()) fpm" }
        if rate < -100 { return "↓ \(abs(rate).formatted()) fpm" }
        return "Level"
    }
}

import ActivityKit
import Foundation

@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()
    private var activity: Activity<SkyTraceActivityAttributes>?

    private init() {
        // Recover an activity that survived a normal app relaunch so a later
        // update/end message controls the existing Dynamic Island instead of
        // accidentally creating a duplicate.
        activity = Activity<SkyTraceActivityAttributes>.activities.first
    }

    func handle(_ message: FlightActivityMessage) async {
        switch message.action.lowercased() {
        case "start": await start(message)
        case "update": await update(message)
        case "end": await end(message)
        default: break
        }
    }

    private func matchingActivity(for icao: String) -> Activity<SkyTraceActivityAttributes>? {
        if let activity, activity.attributes.icao.caseInsensitiveCompare(icao) == .orderedSame {
            return activity
        }
        if let recovered = Activity<SkyTraceActivityAttributes>.activities.first(where: {
            $0.attributes.icao.caseInsensitiveCompare(icao) == .orderedSame
        }) {
            activity = recovered
            return recovered
        }
        return nil
    }

    private func start(_ message: FlightActivityMessage) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let current = matchingActivity(for: message.icao) {
            await current.update(ActivityContent(state: message.state, staleDate: Date().addingTimeInterval(45)))
            return
        }
        if let current = activity {
            await current.end(nil, dismissalPolicy: .immediate)
            activity = nil
        }
        do {
            activity = try Activity.request(
                attributes: message.attributes,
                content: ActivityContent(state: message.state, staleDate: Date().addingTimeInterval(45)),
                pushType: nil
            )
        } catch {
            print("SkyTrace Live Activity start failed: \(error)")
        }
    }

    private func update(_ message: FlightActivityMessage) async {
        guard let current = matchingActivity(for: message.icao) else {
            await start(message)
            return
        }
        await current.update(ActivityContent(state: message.state, staleDate: Date().addingTimeInterval(45)))
    }

    private func end(_ message: FlightActivityMessage) async {
        guard let current = matchingActivity(for: message.icao) else { return }
        await current.end(ActivityContent(state: message.state, staleDate: nil), dismissalPolicy: .immediate)
        if activity?.id == current.id { activity = nil }
    }
}

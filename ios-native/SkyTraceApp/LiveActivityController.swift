import ActivityKit
import Foundation

@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()
    private var activity: Activity<SkyTraceActivityAttributes>?

    func handle(_ message: FlightActivityMessage) async {
        switch message.action.lowercased() {
        case "start": await start(message)
        case "update": await update(message)
        case "end": await end(message)
        default: break
        }
    }

    private func start(_ message: FlightActivityMessage) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let current = activity, current.attributes.icao == message.icao {
            await current.update(ActivityContent(state: message.state, staleDate: Date().addingTimeInterval(45)))
            return
        }
        if let current = activity {
            await current.end(nil, dismissalPolicy: .immediate)
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
        guard let current = activity, current.attributes.icao == message.icao else {
            await start(message)
            return
        }
        await current.update(ActivityContent(state: message.state, staleDate: Date().addingTimeInterval(45)))
    }

    private func end(_ message: FlightActivityMessage) async {
        guard let current = activity else { return }
        await current.end(ActivityContent(state: message.state, staleDate: nil), dismissalPolicy: .immediate)
        activity = nil
    }
}

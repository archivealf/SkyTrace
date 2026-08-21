import ActivityKit
import Foundation

struct SkyTraceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var altitudeFt: Int
        var speedKts: Int
        var verticalRateFpm: Int
        var distanceNm: Double?
        var updatedAt: Date
    }

    var icao: String
    var callsign: String
    var registration: String
    var aircraftType: String
    var operatorName: String
    var origin: String
    var destination: String
}

struct FlightActivityMessage: Codable {
    var action: String
    var icao: String
    var callsign: String
    var registration: String
    var aircraftType: String
    var operatorName: String
    var origin: String
    var destination: String
    var altitudeFt: Int
    var speedKts: Int
    var verticalRateFpm: Int
    var distanceNm: Double?
    var updatedAt: Double

    enum CodingKeys: String, CodingKey {
        case action, icao, callsign, registration, aircraftType, origin, destination
        case operatorName = "operator"
        case altitudeFt, speedKts, verticalRateFpm, distanceNm, updatedAt
    }

    var state: SkyTraceActivityAttributes.ContentState {
        .init(
            altitudeFt: altitudeFt,
            speedKts: speedKts,
            verticalRateFpm: verticalRateFpm,
            distanceNm: distanceNm,
            updatedAt: Date(timeIntervalSince1970: updatedAt / 1000)
        )
    }

    var attributes: SkyTraceActivityAttributes {
        .init(
            icao: icao,
            callsign: callsign,
            registration: registration,
            aircraftType: aircraftType,
            operatorName: operatorName,
            origin: origin,
            destination: destination
        )
    }
}

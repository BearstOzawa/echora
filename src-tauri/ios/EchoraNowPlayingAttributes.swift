import ActivityKit
import Foundation

struct EchoraNowPlayingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let artist: String
        let artworkBase64: String?
        let isPlaying: Bool
        let isLiked: Bool
        let elapsed: Double
        let duration: Double
    }
}

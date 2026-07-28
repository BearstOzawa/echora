import ActivityKit
import AppIntents
import Foundation
import SwiftUI
import WidgetKit

private let echoraLiveAccent = Color(red: 0.28, green: 0.65, blue: 0.76)

private struct LiveArtwork: View {
    let base64: String?
    let size: CGFloat
    var circular = false
    var showsSpindle = false
    var elapsed: Double = 0

    var body: some View {
        Group {
            if let base64,
               let data = Data(base64Encoded: base64),
               let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .scaleEffect(circular ? 1.1 : 1)
            } else {
                ZStack {
                    Color.white.opacity(0.1)
                    Image(systemName: "music.note")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
        }
        .frame(width: size, height: size)
        .rotationEffect(.degrees(circular ? elapsed * 45 : 0))
        .animation(.linear(duration: 1), value: elapsed)
        .clipShape(RoundedRectangle(cornerRadius: circular ? size / 2 : size * 0.24, style: .continuous))
        .overlay {
            if circular && showsSpindle {
                Circle()
                    .fill(.black.opacity(0.82))
                    .frame(width: size * 0.18, height: size * 0.18)
                    .overlay {
                        Circle()
                            .fill(.white.opacity(0.82))
                            .frame(width: size * 0.06, height: size * 0.06)
                    }
            }
        }
    }
}

private struct LiveArtworkBackdrop: View {
    let base64: String?

    var body: some View {
        Group {
            if let base64,
               let data = Data(base64Encoded: base64),
               let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(
                    colors: [echoraLiveAccent.opacity(0.72), Color.black.opacity(0.9)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
        .scaleEffect(1.24)
        .blur(radius: 24)
        .overlay(Color.black.opacity(0.34))
        .clipped()
    }
}

private func playbackTime(_ seconds: Double, remaining: Bool = false) -> String {
    let value = max(0, Int(seconds.rounded(.down)))
    return "\(remaining ? "−" : "")\(value / 60):\(String(format: "%02d", value % 60))"
}

private struct PlaybackPulse: View {
    let isPlaying: Bool
    let elapsed: Double
    var color: Color = .white

    var body: some View {
        if isPlaying {
            HStack(spacing: 2) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(color.opacity(0.88))
                        .frame(width: 2, height: barHeight(index: index))
                        .animation(.spring(response: 0.42, dampingFraction: 0.68), value: elapsed)
                }
            }
            .frame(width: 16, height: 16)
        } else {
            Image(systemName: "pause.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(color.opacity(0.82))
        }
    }

    private func barHeight(index: Int) -> CGFloat {
        let phase = elapsed * 3.4 + Double(index) * 1.7
        return 4 + CGFloat(abs(sin(phase))) * 10
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct LivePlaybackControls: View {
    let isPlaying: Bool
    let isLiked: Bool

    var body: some View {
        HStack(spacing: 0) {
            Button(intent: ToggleLikeIntent()) {
                Image(systemName: isLiked ? "heart.fill" : "heart")
                    .foregroundStyle(isLiked ? Color.pink : Color.white.opacity(0.86))
            }
            .accessibilityLabel(isLiked ? "取消喜欢" : "喜欢")
            .frame(maxWidth: .infinity)

            Button(intent: PreviousTrackIntent()) {
                Image(systemName: "backward.fill")
            }
            .accessibilityLabel("上一首")
            .frame(maxWidth: .infinity)

            Button(intent: TogglePlaybackIntent()) {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 27, weight: .bold))
                    .frame(width: 42, height: 38)
            }
            .accessibilityLabel(isPlaying ? "暂停" : "播放")
            .frame(maxWidth: .infinity)

            Button(intent: NextTrackIntent()) {
                Image(systemName: "forward.fill")
            }
            .accessibilityLabel("下一首")
            .frame(maxWidth: .infinity)
        }
        .font(.system(size: 21, weight: .semibold))
        .foregroundStyle(.white)
        .buttonStyle(.plain)
    }
}

struct EchoraNowPlayingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: EchoraNowPlayingAttributes.self) { context in
            ZStack {
                LiveArtworkBackdrop(base64: context.state.artworkBase64)

                VStack(spacing: 11) {
                    HStack(spacing: 12) {
                        LiveArtwork(base64: context.state.artworkBase64, size: 54)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(context.state.title)
                                .font(.system(size: 16, weight: .semibold))
                                .lineLimit(1)
                            Text(context.state.artist)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                        Spacer(minLength: 8)
                    }

                    HStack(spacing: 8) {
                        Text(playbackTime(context.state.elapsed))
                        ProgressView(
                            value: min(context.state.elapsed, max(context.state.duration, 1)),
                            total: max(context.state.duration, 1)
                        )
                        .tint(.white.opacity(0.92))
                        Text(playbackTime(max(0, context.state.duration - context.state.elapsed), remaining: true))
                    }
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))

                    if #available(iOSApplicationExtension 17.0, *) {
                        LivePlaybackControls(isPlaying: context.state.isPlaying, isLiked: context.state.isLiked)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
            }
            .foregroundStyle(.white)
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.white.opacity(0.16), lineWidth: 1)
            }
            .activityBackgroundTint(.clear)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveArtwork(base64: context.state.artworkBase64, size: 44, circular: true, showsSpindle: true, elapsed: context.state.elapsed)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(context.state.artist)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white.opacity(0.68))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PlaybackPulse(isPlaying: context.state.isPlaying, elapsed: context.state.elapsed)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(
                        value: min(context.state.elapsed, max(context.state.duration, 1)),
                        total: max(context.state.duration, 1)
                    )
                    .tint(echoraLiveAccent)
                }
            } compactLeading: {
                LiveArtwork(base64: context.state.artworkBase64, size: 24, circular: true, showsSpindle: true, elapsed: context.state.elapsed)
            } compactTrailing: {
                PlaybackPulse(isPlaying: context.state.isPlaying, elapsed: context.state.elapsed)
            } minimal: {
                LiveArtwork(base64: context.state.artworkBase64, size: 20, circular: true, showsSpindle: true, elapsed: context.state.elapsed)
            }
            .keylineTint(.clear)
        }
    }
}

@main
struct EchoraNowPlayingWidgetBundle: WidgetBundle {
    var body: some Widget {
        EchoraNowPlayingLiveActivity()
    }
}

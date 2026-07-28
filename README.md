# Echora

Echora is a local-first music workspace for Web, desktop, and mobile clients. It treats listening as an arrangement that can be shaped by intent, energy, time, and personal preferences instead of centering the product on a traditional player bar.

## Current scope

- A music library for search, liked tracks, local tracks, current arrangements, and playlists
- Playlist creation, duplication, deletion, bulk actions, and desktop context menus
- A draggable two-dimensional arrangement where position represents time and planned intensity
- Persistent Listening Agent sessions with natural-language search, arrangement changes, undo, and reusable preferences
- Embedded playback, volume, source status, quality switching, speed controls, and audio effects
- Light and dark appearances, each with seven accent palettes and optional track-following color
- Local persistence for playlists, liked tracks, settings, playback sessions, and AI session data
- Two built-in LX source variants with optional user-supplied enhanced-quality credentials
- Real multi-platform search with configurable result sizes and URL resolution: v1.2.0 uses QQ, NetEase Cloud Music, Kuwo, and Kugou; v1.1.2 replaces Kugou with Migu
- Dynamic platform chart catalogs loaded from the public QQ Music, NetEase Cloud Music, Kuwo, Kugou, and Migu feeds supported by the selected source variant
- A frameless, resizable Tauri desktop shell with native-style window controls
- Keyboard-accessible menus and reduced-motion behavior

Home and Featured use ten editorial discovery dimensions backed by current source searches and are presented as theme browsing rather than rankings. Collection and chart request sizes come from Content settings. The Charts page keeps platform-provided ordering, update metadata, and explicit live/cached/fallback provenance. Playback URLs are resolved through the isolated built-in LX runtime and cached for 20 minutes. Web downloads are handed to the browser and do not create an Echora local library. Desktop and mobile builds store downloaded or imported audio under the scoped application-local `music` directory. Desktop users can register multiple source folders in `Application Settings -> Local & Downloads`; rescans copy new audio into the managed library, and removing a source does not delete imported tracks. Mobile uses the system file picker instead of desktop-style folder sources.

Listening sessions use the configured OpenAI, Anthropic, OpenAI-compatible, or Ollama service to produce a structured plan. The model never supplies track records directly: search queries from the plan are executed against the currently available music sources, and only validated catalog results enter the queue. When AI is not configured, the same workflow uses an explicit local strategy for common artist, scene, energy, discovery, and keep-current requests.

## Development

```bash
npm install
npm run dev
```

The automatic Web entry selects one UI application when the page starts. It does not swap component trees when the window is resized. For platform-specific development, use the fixed entries:

```bash
npm run dev:desktop
npm run dev:mobile
```

Run the desktop client:

```bash
npm run client:desktop:dev
```

Production build:

```bash
npm run build
```

Platform-only Web bundles are emitted separately and do not include the other platform application:

```bash
npm run build:desktop # dist-desktop
npm run build:mobile  # dist-mobile
```

Run the automated behavior tests:

```bash
npm test
```

Configure the cross-platform update service for release builds:

```bash
VITE_ECHORA_UPDATE_ENDPOINT=https://your-worker.example \
ECHORA_BUILD_ID="$GITHUB_SHA" \
npm run build:desktop
```

The update endpoint is optional during development. When omitted, Echora keeps update checks disabled without affecting startup or playback. Release builds send only the application version, build ID, platform, architecture, channel, and a random local installation ID. Desktop installers, Android APKs, and signed iOS IPAs are downloaded from GitHub Releases; Web updates refresh to the published build. The update service lives in the sibling `echora-cloud` project.

Package the desktop client:

```bash
npm run client:desktop:build
```

Initialize and run a mobile target after its native SDK is installed:

```bash
npm run client:mobile:android:init
npm run client:mobile:android:dev

npm run client:mobile:ios:init
npm run client:mobile:ios:dev
npm run client:mobile:ios:build:simulator
```

## Architecture

- Tauri 2 desktop shell (scaffolded)
- React and TypeScript UI
- Independent desktop and mobile React application trees selected by `src/platforms/uiPlatform.ts`
- A shared `useEchoraController` application controller for playback, sources, library data, AI sessions, persistence, and configuration
- Platform-owned navigation, page composition, player placement, settings presentation, and transient surfaces under `src/platforms/desktop` and `src/platforms/mobile`
- Platform bridge contract for search, official charts, lyrics, source requests, media, and AI requests
- Web BFF transport for provider APIs that browsers cannot call directly because of CORS
- Scoped Tauri filesystem storage for native offline audio, with an IndexedDB non-native adapter
- Sandboxed built-in LX runtime for playback URL resolution
- Deterministic format and quality verification
- Optional user-provided AI model configuration routed through the platform bridge

The Web surface is the current complete development entry point. Desktop Web and native desktop share the desktop UI application; mobile Web and the future native mobile package share the mobile UI application. Business state is shared, but platform UI must not branch on viewport inside the controller. The legacy shared stylesheet remains a migration base while page styles move into their platform directories.

A production Web deployment must run the BFF routes provided by the Vite gateway (preview mode includes them). Desktop and mobile Tauri builds consume fixed, platform-only frontend bundles through separate configuration overlays. Native packages now use the system HTTP stack for multi-platform search, LX source requests, and AI requests. Chart catalogs, lyrics, and range-aware media delivery remain on the native transport roadmap.

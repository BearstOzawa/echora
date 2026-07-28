# Echora multi-platform architecture

## Product targets

Echora has three shipping targets, but only two interaction shells:

- Responsive Web: desktop Web and mobile Web, deployed together.
- Desktop Native: the desktop shell packaged with Tauri.
- Mobile Native: the mobile shell packaged with Tauri mobile.

Desktop Web and desktop native share the desktop shell. Mobile Web and mobile
native share the mobile shell. Native-only behavior is supplied by a platform
adapter rather than being embedded in page components.

## Intended boundaries

```text
src/
  core/                 music, queue, AI, library and settings domain logic
  features/             headless feature controllers and shared view models
  shells/
    desktop/            desktop navigation, windows and pointer interactions
    mobile/             mobile navigation, sheets, gestures and safe areas
  platforms/
    web/                 BFF transport, browser download and browser storage
    tauri-desktop/       filesystem, window, tray and desktop download adapter
    tauri-mobile/        offline library, share sheet and mobile lifecycle
  entries/
    web.tsx              responsive shell loader; mobile shell is lazy loaded
    desktop.tsx          imports desktop shell and desktop adapter only
    mobile.tsx           imports mobile shell and mobile adapter only
```

The dependency direction is one way:

```text
entry -> shell -> features -> core
  |                 |
  +-> platform adapter <-+
```

`core` must not import React, Tauri or browser globals. Shells must not perform
provider requests or direct filesystem work.

## Build behavior

- The Web build may contain both shells, but loads the unused shell as a lazy
  chunk only after the responsive breakpoint changes.
- The desktop package imports only the desktop entry, so mobile navigation and
  mobile styles are absent from its bundle.
- The mobile package imports only the mobile entry, so desktop tables, window
  controls and desktop-only local-library code are absent from its bundle.
- Shared domain modules are bundled once in each product, not copied at runtime.

CSS follows the same rule: shared tokens are small, while `desktop.css` and
`mobile.css` are imported only by their corresponding shell.

## Platform contracts

`PlatformBridge` selects the Web BFF in browsers and the Tauri HTTP transport in
native packages. Native search, LX source requests, and AI requests no longer
depend on Vite middleware. Chart catalogs, lyrics, and range-aware media delivery
remain the next native transport milestones.

Storage, download and lifecycle behavior also stay behind capabilities:

| Capability | Web | Desktop native | Mobile native |
| --- | --- | --- | --- |
| Music transport | deployed BFF | native command/HTTP adapter | native command/HTTP adapter |
| Download | browser download | managed offline library | managed offline library |
| File import | file picker | file and folder picker | system document picker |
| Window lifecycle | browser | tray/close policy | foreground/background lifecycle |
| Share | Web Share when available | system save/share | native share sheet |

## Migration sequence

1. Keep the current shared app while the first Web product is completed.
2. Extract platform-neutral state and commands from `App.tsx` into feature
   controllers without changing behavior.
3. Move existing desktop and mobile markup into separate shell components.
4. Add target-specific entries and CSS imports, then compare bundle contents.
5. Complete the remaining native chart, lyrics, and media stream adapters.

This sequence avoids a premature rewrite while preventing the current responsive
prototype from becoming the permanent native architecture.

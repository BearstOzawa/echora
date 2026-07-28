use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[cfg(target_os = "macos")]
use std::sync::{
    atomic::{AtomicPtr, Ordering},
    OnceLock,
};

#[cfg(target_os = "macos")]
use objc2::{
    ffi::{class_addMethod, object_getClass},
    rc::Retained,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel, MainThreadMarker,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};

#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

#[cfg(target_os = "ios")]
use base64::Engine;

#[cfg(target_os = "ios")]
use std::{
    ffi::{c_char, CStr, CString},
    sync::{Mutex, OnceLock},
};

#[cfg(target_os = "ios")]
use objc2::{msg_send, rc::Retained, runtime::AnyObject, AnyThread};

#[cfg(target_os = "ios")]
use objc2_avf_audio::{AVAudioSession, AVAudioSessionCategoryPlayback};

#[cfg(target_os = "ios")]
use objc2_foundation::{NSData, NSMutableDictionary, NSNumber, NSString};

#[cfg(target_os = "ios")]
use objc2_media_player::{
    MPMediaItemArtwork, MPMediaItemPropertyAlbumTitle, MPMediaItemPropertyArtist,
    MPMediaItemPropertyArtwork, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
    MPNowPlayingInfoCenter, MPNowPlayingInfoPropertyElapsedPlaybackTime,
    MPNowPlayingInfoPropertyPlaybackRate,
};

#[cfg(target_os = "ios")]
use objc2_ui_kit::{
    UIImage, UIScrollView, UIScrollViewContentInsetAdjustmentBehavior, UIView, UIViewAutoresizing,
    UIViewController,
};

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
struct IosNowPlayingMetadata {
    title: String,
    artist: String,
    album: String,
    duration: f64,
    artwork_data_url: Option<String>,
    live_artwork_base64: Option<String>,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
struct IosNowPlayingState {
    elapsed: f64,
    duration: f64,
    playback_rate: f64,
    is_playing: bool,
    is_liked: bool,
}

#[cfg(target_os = "ios")]
static IOS_NOW_PLAYING_METADATA: OnceLock<Mutex<Option<IosNowPlayingMetadata>>> = OnceLock::new();

#[cfg(target_os = "ios")]
static IOS_NATIVE_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

#[cfg(target_os = "ios")]
type QuickActionsInstallFn = unsafe extern "C" fn(unsafe extern "C" fn(*const c_char));

#[cfg(target_os = "ios")]
type MediaSessionInstallFn = unsafe extern "C" fn(unsafe extern "C" fn(*const c_char));

#[cfg(target_os = "ios")]
type SpeechRecognitionInstallFn = unsafe extern "C" fn(unsafe extern "C" fn(*const c_char));

#[cfg(target_os = "ios")]
type SpeechRecognitionStartFn = unsafe extern "C" fn(i64);

#[cfg(target_os = "ios")]
type SpeechRecognitionControlFn = unsafe extern "C" fn();

#[cfg(target_os = "ios")]
type LiveActivityUpdateFn =
    unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, i32, i32, f64, f64);

#[cfg(target_os = "ios")]
type LiveActivityEndFn = unsafe extern "C" fn();

#[cfg(target_os = "ios")]
fn ios_live_activity_update_symbol() -> Option<LiveActivityUpdateFn> {
    static SYMBOL: OnceLock<Option<LiveActivityUpdateFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_live_activity_update\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_live_activity_end_symbol() -> Option<LiveActivityEndFn> {
    static SYMBOL: OnceLock<Option<LiveActivityEndFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_live_activity_end\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_quick_actions_install_symbol() -> Option<QuickActionsInstallFn> {
    static SYMBOL: OnceLock<Option<QuickActionsInstallFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_quick_actions_install\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_media_session_install_symbol() -> Option<MediaSessionInstallFn> {
    static SYMBOL: OnceLock<Option<MediaSessionInstallFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_media_session_install\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_speech_recognition_install_symbol() -> Option<SpeechRecognitionInstallFn> {
    static SYMBOL: OnceLock<Option<SpeechRecognitionInstallFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_speech_recognition_install\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_speech_recognition_start_symbol() -> Option<SpeechRecognitionStartFn> {
    static SYMBOL: OnceLock<Option<SpeechRecognitionStartFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_speech_recognition_start\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_speech_recognition_stop_symbol() -> Option<SpeechRecognitionControlFn> {
    static SYMBOL: OnceLock<Option<SpeechRecognitionControlFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_speech_recognition_stop\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
fn ios_speech_recognition_cancel_symbol() -> Option<SpeechRecognitionControlFn> {
    static SYMBOL: OnceLock<Option<SpeechRecognitionControlFn>> = OnceLock::new();
    *SYMBOL.get_or_init(|| unsafe {
        let pointer = libc::dlsym(
            libc::RTLD_DEFAULT,
            b"echora_speech_recognition_cancel\0".as_ptr().cast(),
        );
        (!pointer.is_null()).then(|| std::mem::transmute(pointer))
    })
}

#[cfg(target_os = "ios")]
unsafe extern "C" fn receive_ios_quick_action(action_pointer: *const c_char) {
    if action_pointer.is_null() {
        return;
    }
    let action_type = CStr::from_ptr(action_pointer).to_string_lossy();
    let action = action_type.rsplit('.').next().unwrap_or_default();
    if !matches!(action, "liked" | "search" | "daily") {
        return;
    }
    if let Some(app) = IOS_NATIVE_APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = app.emit("echora://quick-action", action);
    }
}

#[cfg(target_os = "ios")]
unsafe extern "C" fn receive_ios_media_command(command_pointer: *const c_char) {
    if command_pointer.is_null() {
        return;
    }
    let command = CStr::from_ptr(command_pointer)
        .to_string_lossy()
        .into_owned();
    if let Some(app) = IOS_NATIVE_APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = app.emit("echora://ios-media-command", command);
    }
}

#[cfg(target_os = "ios")]
unsafe extern "C" fn receive_ios_speech_event(event_pointer: *const c_char) {
    if event_pointer.is_null() {
        return;
    }
    let event = CStr::from_ptr(event_pointer).to_string_lossy().into_owned();
    if let Some(app) = IOS_NATIVE_APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = app.emit("echora://ios-speech", event);
    }
}

fn media_error_response(
    status: tauri::http::StatusCode,
    message: &str,
) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(
            tauri::http::header::CONTENT_TYPE,
            "text/plain; charset=utf-8",
        )
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.as_bytes().to_vec())
        .expect("valid media error response")
}

fn is_safe_media_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    match url.host() {
        Some(url::Host::Ipv4(address)) => {
            !address.is_loopback()
                && !address.is_private()
                && !address.is_link_local()
                && !address.is_unspecified()
        }
        Some(url::Host::Ipv6(address)) => {
            !address.is_loopback()
                && !address.is_unspecified()
                && !address.is_unique_local()
                && !address.is_unicast_link_local()
        }
        Some(url::Host::Domain(host)) => host != "localhost" && !host.ends_with(".localhost"),
        None => false,
    }
}

fn normalized_media_content_type(
    remote_url: &reqwest::Url,
    upstream_type: Option<&str>,
    body: &[u8],
) -> String {
    let signature_type = if body.starts_with(b"fLaC") {
        Some("audio/flac")
    } else if body.starts_with(b"ID3")
        || body.starts_with(&[0xff, 0xfb])
        || body.starts_with(&[0xff, 0xf3])
        || body.starts_with(&[0xff, 0xf2])
    {
        Some("audio/mpeg")
    } else if body.starts_with(b"OggS") {
        Some("audio/ogg")
    } else if body.starts_with(b"RIFF") && body.get(8..12) == Some(b"WAVE") {
        Some("audio/wav")
    } else {
        None
    };
    if let Some(content_type) = signature_type {
        return content_type.to_string();
    }
    let extension = remote_url
        .path_segments()
        .and_then(Iterator::last)
        .and_then(|name| name.rsplit_once('.').map(|(_, extension)| extension))
        .map(str::to_ascii_lowercase);
    let extension_type = match extension.as_deref() {
        Some("flac") => Some("audio/flac"),
        Some("mp3") => Some("audio/mpeg"),
        Some("m4a" | "mp4") => Some("audio/mp4"),
        Some("aac") => Some("audio/aac"),
        Some("ogg" | "oga" | "opus") => Some("audio/ogg"),
        Some("wav") => Some("audio/wav"),
        Some("webm") => Some("audio/webm"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("avif") => Some("image/avif"),
        _ => None,
    };
    extension_type
        .or(upstream_type)
        .unwrap_or("application/octet-stream")
        .to_string()
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackCacheMeta {
    content_type: String,
    size: u64,
    accessed_at: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackCacheStats {
    bytes: u64,
    entries: u64,
}

fn stable_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn playback_cache_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("playback");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn playback_cache_paths(app: &tauri::AppHandle, key: &str) -> Result<(PathBuf, PathBuf), String> {
    let directory = playback_cache_directory(app)?;
    let token = stable_hash(key);
    Ok((
        directory.join(format!("{token}.audio")),
        directory.join(format!("{token}.json")),
    ))
}

fn read_playback_cache(app: &tauri::AppHandle, key: &str) -> Option<(Vec<u8>, PlaybackCacheMeta)> {
    let (audio_path, metadata_path) = playback_cache_paths(app, key).ok()?;
    let audio = fs::read(audio_path).ok()?;
    let mut metadata =
        serde_json::from_str::<PlaybackCacheMeta>(&fs::read_to_string(&metadata_path).ok()?)
            .ok()?;
    if audio.len() as u64 != metadata.size {
        return None;
    }
    metadata.accessed_at = unix_timestamp_millis();
    if let Ok(content) = serde_json::to_string(&metadata) {
        let _ = fs::write(metadata_path, content);
    }
    Some((audio, metadata))
}

fn playback_cache_stats_inner(app: &tauri::AppHandle) -> Result<PlaybackCacheStats, String> {
    let directory = playback_cache_directory(app)?;
    let mut stats = PlaybackCacheStats {
        bytes: 0,
        entries: 0,
    };
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("audio") {
            continue;
        }
        stats.bytes = stats
            .bytes
            .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        stats.entries += 1;
    }
    Ok(stats)
}

fn prune_playback_cache_inner(
    app: &tauri::AppHandle,
    limit_mb: u64,
) -> Result<PlaybackCacheStats, String> {
    let directory = playback_cache_directory(app)?;
    let mut entries = Vec::new();
    let mut valid_audio_paths = HashSet::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata_path = entry.path();
        if metadata_path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = fs::read_to_string(&metadata_path)
            .ok()
            .and_then(|content| serde_json::from_str::<PlaybackCacheMeta>(&content).ok());
        let audio_path = metadata_path.with_extension("audio");
        let Some(metadata) = metadata else {
            let _ = fs::remove_file(&metadata_path);
            let _ = fs::remove_file(&audio_path);
            continue;
        };
        let actual_size = audio_path.metadata().map(|value| value.len()).ok();
        if actual_size != Some(metadata.size) {
            let _ = fs::remove_file(&metadata_path);
            let _ = fs::remove_file(&audio_path);
            continue;
        }
        valid_audio_paths.insert(audio_path.clone());
        entries.push((
            metadata.accessed_at,
            metadata.size,
            audio_path,
            metadata_path,
        ));
    }
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let extension = path.extension().and_then(|value| value.to_str());
        if extension == Some("next")
            || (extension == Some("audio") && !valid_audio_paths.contains(&path))
        {
            let _ = fs::remove_file(path);
        }
    }
    entries.sort_by_key(|entry| entry.0);
    let limit_bytes = limit_mb.clamp(128, 20_480).saturating_mul(1024 * 1024);
    let mut total = entries.iter().map(|entry| entry.1).sum::<u64>();
    for (_, size, audio_path, metadata_path) in entries {
        if total <= limit_bytes {
            break;
        }
        let _ = fs::remove_file(audio_path);
        let _ = fs::remove_file(metadata_path);
        total = total.saturating_sub(size);
    }
    playback_cache_stats_inner(app)
}

fn write_playback_cache(
    app: &tauri::AppHandle,
    key: &str,
    body: &[u8],
    content_type: &str,
    limit_mb: u64,
) {
    let Ok((audio_path, metadata_path)) = playback_cache_paths(app, key) else {
        return;
    };
    let temporary_path = audio_path.with_extension("next");
    if fs::write(&temporary_path, body).is_err()
        || fs::rename(&temporary_path, &audio_path).is_err()
    {
        let _ = fs::remove_file(temporary_path);
        return;
    }
    let metadata = PlaybackCacheMeta {
        content_type: content_type.to_string(),
        size: body.len() as u64,
        accessed_at: unix_timestamp_millis(),
    };
    if let Ok(content) = serde_json::to_string(&metadata) {
        let temporary_metadata_path = metadata_path.with_extension("next.json");
        if fs::write(&temporary_metadata_path, content).is_ok()
            && fs::rename(&temporary_metadata_path, &metadata_path).is_err()
        {
            let _ = fs::remove_file(temporary_metadata_path);
        }
    }
    let _ = prune_playback_cache_inner(app, limit_mb);
}

fn parse_byte_range(value: &str, length: usize) -> Option<(usize, usize)> {
    let value = value.strip_prefix("bytes=")?.split(',').next()?;
    let (start, end) = value.split_once('-')?;
    let start = start.parse::<usize>().ok()?;
    if start >= length {
        return None;
    }
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<usize>().ok()?.min(length - 1)
    };
    (end >= start).then_some((start, end))
}

fn cached_media_response(
    body: Vec<u8>,
    content_type: &str,
    range: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    if let Some((start, end)) = range.and_then(|value| parse_byte_range(value, body.len())) {
        let length = body.len();
        return tauri::http::Response::builder()
            .status(tauri::http::StatusCode::PARTIAL_CONTENT)
            .header(tauri::http::header::CONTENT_TYPE, content_type)
            .header(
                tauri::http::header::CONTENT_LENGTH,
                (end - start + 1).to_string(),
            )
            .header(
                tauri::http::header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{length}"),
            )
            .header(tauri::http::header::ACCEPT_RANGES, "bytes")
            .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body[start..=end].to_vec())
            .expect("valid cached media response");
    }
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::OK)
        .header(tauri::http::header::CONTENT_TYPE, content_type)
        .header(tauri::http::header::CONTENT_LENGTH, body.len().to_string())
        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .expect("valid cached media response")
}

#[tauri::command]
fn playback_cache_stats(app: tauri::AppHandle) -> Result<PlaybackCacheStats, String> {
    playback_cache_stats_inner(&app)
}

#[tauri::command]
fn prune_playback_cache(
    app: tauri::AppHandle,
    limit_mb: u64,
) -> Result<PlaybackCacheStats, String> {
    prune_playback_cache_inner(&app, limit_mb)
}

#[tauri::command]
fn clear_playback_cache(app: tauri::AppHandle) -> Result<PlaybackCacheStats, String> {
    let directory = playback_cache_directory(&app)?;
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    Ok(PlaybackCacheStats {
        bytes: 0,
        entries: 0,
    })
}

#[tauri::command]
fn available_local_storage_bytes(app: tauri::AppHandle) -> Result<u64, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    fs2::available_space(directory).map_err(|error| error.to_string())
}

fn register_media_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(
        "echora-media",
        |context, request, responder| {
            let protocol_url = reqwest::Url::parse(&request.uri().to_string()).ok();
            let requested_url = protocol_url
                .as_ref()
                .and_then(|url| {
                    url.query_pairs()
                        .find(|(key, _)| key == "url")
                        .map(|(_, value)| value.into_owned())
                })
                .and_then(|value| reqwest::Url::parse(&value).ok());
            let Some(remote_url) = requested_url.filter(is_safe_media_url) else {
                responder.respond(media_error_response(
                    tauri::http::StatusCode::BAD_REQUEST,
                    "Invalid media URL",
                ));
                return;
            };
            let range = request
                .headers()
                .get(tauri::http::header::RANGE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let cache_key = protocol_url.as_ref().and_then(|url| {
                url.query_pairs()
                    .find(|(key, _)| key == "cacheKey")
                    .map(|(_, value)| value.into_owned())
            });
            let cache_limit_mb = protocol_url.as_ref().and_then(|url| {
                url.query_pairs()
                    .find(|(key, _)| key == "cacheLimitMb")
                    .and_then(|(_, value)| value.parse::<u64>().ok())
            });
            let app = context.app_handle().clone();

            tauri::async_runtime::spawn(async move {
                if let Some(cache_key) = cache_key.as_deref() {
                    if let Some((body, metadata)) = read_playback_cache(&app, cache_key) {
                        responder.respond(cached_media_response(
                            body,
                            &metadata.content_type,
                            range.as_deref(),
                        ));
                        return;
                    }
                }
                let client = match reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        if attempt.previous().len() >= 5 {
                            attempt.error("too many media redirects")
                        } else if is_safe_media_url(attempt.url()) {
                            attempt.follow()
                        } else {
                            attempt.stop()
                        }
                    }))
                    .timeout(std::time::Duration::from_secs(30))
                    .build()
                {
                    Ok(client) => client,
                    Err(_) => {
                        responder.respond(media_error_response(
                            tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                            "Media client unavailable",
                        ));
                        return;
                    }
                };
                let mut upstream_request = client
                    .get(remote_url.as_str())
                    .header(reqwest::header::ACCEPT, "audio/*,image/*,*/*;q=0.8");
                if let Some(range) = range.as_deref() {
                    upstream_request = upstream_request.header(reqwest::header::RANGE, range);
                }
                let upstream = match upstream_request.send().await {
                    Ok(response) => response,
                    Err(_) => {
                        responder.respond(media_error_response(
                            tauri::http::StatusCode::BAD_GATEWAY,
                            "Media request failed",
                        ));
                        return;
                    }
                };
                let status = tauri::http::StatusCode::from_u16(upstream.status().as_u16())
                    .unwrap_or(tauri::http::StatusCode::BAD_GATEWAY);
                let upstream_headers = upstream.headers().clone();
                let body = match upstream.bytes().await {
                    Ok(bytes) => bytes.to_vec(),
                    Err(_) => {
                        responder.respond(media_error_response(
                            tauri::http::StatusCode::BAD_GATEWAY,
                            "Media response interrupted",
                        ));
                        return;
                    }
                };
                let upstream_content_type = upstream_headers
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned);
                let content_type = normalized_media_content_type(
                    &remote_url,
                    upstream_content_type.as_deref(),
                    &body,
                );
                let content_range_total = upstream_headers
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.rsplit_once('/'))
                    .and_then(|(_, total)| total.parse::<usize>().ok());
                let complete_response = status == tauri::http::StatusCode::OK
                    || (range.as_deref().is_some_and(|value| value == "bytes=0-")
                        && content_range_total == Some(body.len()));
                if complete_response {
                    if let (Some(cache_key), Some(cache_limit_mb)) =
                        (cache_key.as_deref(), cache_limit_mb)
                    {
                        write_playback_cache(&app, cache_key, &body, &content_type, cache_limit_mb);
                    }
                }
                let mut response = tauri::http::Response::builder()
                    .status(status)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes");
                response = response.header(tauri::http::header::CONTENT_TYPE, &content_type);
                for header in [
                    reqwest::header::CONTENT_LENGTH,
                    reqwest::header::CONTENT_RANGE,
                    reqwest::header::CACHE_CONTROL,
                    reqwest::header::ETAG,
                    reqwest::header::LAST_MODIFIED,
                ] {
                    if let Some(value) = upstream_headers
                        .get(&header)
                        .and_then(|value| value.to_str().ok())
                    {
                        response = response.header(header.as_str(), value);
                    }
                }
                responder.respond(response.body(body).expect("valid media response"));
            });
        },
    )
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicFolderRecord {
    id: String,
    name: String,
    path: String,
    added_at: u64,
    last_scanned_at: Option<u64>,
    track_count: u64,
    available: bool,
}

fn unix_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn music_folder_registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("music");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("folders.json"))
}

fn read_music_folders(app: &tauri::AppHandle) -> Result<Vec<MusicFolderRecord>, String> {
    let path = music_folder_registry_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_music_folders(
    app: &tauri::AppHandle,
    folders: &[MusicFolderRecord],
) -> Result<(), String> {
    let path = music_folder_registry_path(app)?;
    let temporary = path.with_extension("next.json");
    let content = serde_json::to_string(folders).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn restore_music_folder_scopes(app: &tauri::AppHandle, folders: &mut [MusicFolderRecord]) {
    let scope = app.fs_scope();
    for folder in folders {
        let path = PathBuf::from(&folder.path);
        folder.available = path.is_dir();
        if folder.available {
            let _ = scope.allow_directory(path, true);
        }
    }
}

fn is_supported_audio_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "mp3"
                    | "flac"
                    | "m4a"
                    | "aac"
                    | "ogg"
                    | "opus"
                    | "wav"
                    | "aif"
                    | "aiff"
                    | "ape"
                    | "wma"
            )
        })
        .unwrap_or(false)
}

fn collect_music_files(directory: &std::path::Path, paths: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_music_files(&path, paths)?;
        } else if file_type.is_file() && is_supported_audio_file(&path) {
            paths.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn list_music_folders(app: tauri::AppHandle) -> Result<Vec<MusicFolderRecord>, String> {
    let mut folders = read_music_folders(&app)?;
    restore_music_folder_scopes(&app, &mut folders);
    Ok(folders)
}

#[tauri::command]
fn register_music_folders(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<MusicFolderRecord>, String> {
    let mut folders = read_music_folders(&app)?;
    for input in paths {
        let canonical = fs::canonicalize(&input).map_err(|_| format!("无法访问文件夹：{input}"))?;
        if !canonical.is_dir() {
            continue;
        }
        let path = canonical.to_string_lossy().to_string();
        if folders.iter().any(|folder| folder.path == path) {
            continue;
        }
        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("音乐文件夹")
            .to_string();
        folders.push(MusicFolderRecord {
            id: format!("folder-{:x}", hasher.finish()),
            name,
            path,
            added_at: unix_timestamp_millis(),
            last_scanned_at: None,
            track_count: 0,
            available: true,
        });
    }
    restore_music_folder_scopes(&app, &mut folders);
    write_music_folders(&app, &folders)?;
    Ok(folders)
}

#[tauri::command]
fn remove_music_folder(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<MusicFolderRecord>, String> {
    let mut folders = read_music_folders(&app)?;
    folders.retain(|folder| folder.id != id);
    restore_music_folder_scopes(&app, &mut folders);
    write_music_folders(&app, &folders)?;
    Ok(folders)
}

#[tauri::command]
fn scan_music_folder(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let mut folders = read_music_folders(&app)?;
    let index = folders
        .iter()
        .position(|folder| folder.id == id)
        .ok_or_else(|| "音乐文件夹已被移除".to_string())?;
    let path = PathBuf::from(&folders[index].path);
    if !path.is_dir() {
        folders[index].available = false;
        write_music_folders(&app, &folders)?;
        return Err("音乐文件夹当前不可用".to_string());
    }

    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|error| error.to_string())?;
    let mut paths = Vec::new();
    collect_music_files(&path, &mut paths)?;
    paths.sort();
    folders[index].available = true;
    folders[index].last_scanned_at = Some(unix_timestamp_millis());
    folders[index].track_count = paths.len() as u64;
    write_music_folders(&app, &folders)?;
    Ok(paths)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateContext {
    os: &'static str,
    arch: &'static str,
    version: String,
}

#[tauri::command]
fn get_update_context(app: tauri::AppHandle) -> UpdateContext {
    UpdateContext {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn open_enhanced_quality_registration(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url("https://api-v2.yuafeng.cn", None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
struct TrayMenuState {
    now_playing: tauri::menu::MenuItem<tauri::Wry>,
    previous: tauri::menu::MenuItem<tauri::Wry>,
    toggle_playback: tauri::menu::MenuItem<tauri::Wry>,
    next: tauri::menu::MenuItem<tauri::Wry>,
    toggle_like: tauri::menu::MenuItem<tauri::Wry>,
}

#[cfg(target_os = "macos")]
static NATIVE_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
#[cfg(target_os = "macos")]
static DOCK_MENU: AtomicPtr<NSMenu> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(target_os = "macos")]
static DOCK_NOW_PLAYING: AtomicPtr<NSMenuItem> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(target_os = "macos")]
static DOCK_PREVIOUS: AtomicPtr<NSMenuItem> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(target_os = "macos")]
static DOCK_TOGGLE_PLAYBACK: AtomicPtr<NSMenuItem> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(target_os = "macos")]
static DOCK_NEXT: AtomicPtr<NSMenuItem> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(target_os = "macos")]
static DOCK_TOGGLE_LIKE: AtomicPtr<NSMenuItem> = AtomicPtr::new(std::ptr::null_mut());

#[cfg(target_os = "macos")]
fn emit_native_playback_control(action: &'static str) {
    use tauri::Emitter;
    if let Some(app) = NATIVE_APP_HANDLE.get() {
        let _ = app.emit("echora://tray-control", action);
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_menu_callback(
    _this: *mut AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) -> *mut AnyObject {
    DOCK_MENU.load(Ordering::Acquire).cast()
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_previous_callback(
    _this: *mut AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) {
    emit_native_playback_control("previous");
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_toggle_playback_callback(
    _this: *mut AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) {
    emit_native_playback_control("toggle-playback");
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_next_callback(
    _this: *mut AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) {
    emit_native_playback_control("next");
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_toggle_like_callback(
    _this: *mut AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) {
    emit_native_playback_control("toggle-like");
}

#[cfg(target_os = "macos")]
unsafe fn add_delegate_method(
    class: *mut AnyClass,
    selector: Sel,
    callback: Imp,
    signature: &'static [u8],
) -> Result<(), String> {
    if class_addMethod(class, selector, callback, signature.as_ptr().cast()).as_bool() {
        Ok(())
    } else {
        Err(format!(
            "unable to install native menu action {}",
            selector.name().to_string_lossy()
        ))
    }
}

#[cfg(target_os = "macos")]
unsafe fn dock_action_item(
    mtm: MainThreadMarker,
    delegate: &AnyObject,
    title: &str,
    action: Sel,
) -> Retained<NSMenuItem> {
    let item = NSMenuItem::initWithTitle_action_keyEquivalent(
        mtm.alloc(),
        &NSString::from_str(title),
        Some(action),
        &NSString::new(),
    );
    item.setTarget(Some(delegate));
    item
}

#[cfg(target_os = "macos")]
fn setup_macos_dock_menu(app: &tauri::AppHandle) -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "dock menu must be installed on the main thread".to_string())?;
    NATIVE_APP_HANDLE
        .set(app.clone())
        .map_err(|_| "dock menu app handle already installed".to_string())?;

    unsafe {
        let ns_app = NSApplication::sharedApplication(mtm);
        let delegate = ns_app
            .delegate()
            .ok_or_else(|| "macOS application delegate is unavailable".to_string())?;
        let delegate_object: &AnyObject = (&*delegate).as_ref();
        let delegate_class = object_getClass(delegate_object as *const AnyObject) as *mut AnyClass;
        if delegate_class.is_null() {
            return Err("macOS application delegate class is unavailable".to_string());
        }

        add_delegate_method(
            delegate_class,
            sel!(applicationDockMenu:),
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
                Imp,
            >(dock_menu_callback),
            b"@@:@\0",
        )?;
        for (selector, callback) in [
            (
                sel!(echoraPrevious:),
                dock_previous_callback
                    as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject),
            ),
            (sel!(echoraTogglePlayback:), dock_toggle_playback_callback),
            (sel!(echoraNext:), dock_next_callback),
            (sel!(echoraToggleLike:), dock_toggle_like_callback),
        ] {
            add_delegate_method(
                delegate_class,
                selector,
                std::mem::transmute::<
                    unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject),
                    Imp,
                >(callback),
                b"v@:@\0",
            )?;
        }

        let menu = NSMenu::new(mtm);
        menu.setAutoenablesItems(false);
        let now_playing = NSMenuItem::initWithTitle_action_keyEquivalent(
            mtm.alloc(),
            &NSString::from_str("暂无播放"),
            None,
            &NSString::new(),
        );
        now_playing.setEnabled(false);
        let previous = dock_action_item(mtm, delegate_object, "上一首", sel!(echoraPrevious:));
        let toggle_playback =
            dock_action_item(mtm, delegate_object, "播放", sel!(echoraTogglePlayback:));
        let next = dock_action_item(mtm, delegate_object, "下一首", sel!(echoraNext:));
        let toggle_like = dock_action_item(mtm, delegate_object, "喜欢", sel!(echoraToggleLike:));
        previous.setEnabled(false);
        toggle_playback.setEnabled(false);
        next.setEnabled(false);
        toggle_like.setEnabled(false);

        menu.addItem(&now_playing);
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        menu.addItem(&previous);
        menu.addItem(&toggle_playback);
        menu.addItem(&next);
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        menu.addItem(&toggle_like);

        DOCK_MENU.store(Retained::as_ptr(&menu).cast_mut(), Ordering::Release);
        DOCK_NOW_PLAYING.store(Retained::as_ptr(&now_playing).cast_mut(), Ordering::Release);
        DOCK_PREVIOUS.store(Retained::as_ptr(&previous).cast_mut(), Ordering::Release);
        DOCK_TOGGLE_PLAYBACK.store(
            Retained::as_ptr(&toggle_playback).cast_mut(),
            Ordering::Release,
        );
        DOCK_NEXT.store(Retained::as_ptr(&next).cast_mut(), Ordering::Release);
        DOCK_TOGGLE_LIKE.store(Retained::as_ptr(&toggle_like).cast_mut(), Ordering::Release);
        std::mem::forget(menu);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn update_macos_dock_state(track_label: String, is_playing: bool, is_liked: bool, can_like: bool) {
    unsafe {
        if let Some(item) = DOCK_NOW_PLAYING.load(Ordering::Acquire).as_ref() {
            item.setTitle(&NSString::from_str(&track_label));
        }
        if let Some(item) = DOCK_TOGGLE_PLAYBACK.load(Ordering::Acquire).as_ref() {
            item.setTitle(&NSString::from_str(if is_playing {
                "暂停"
            } else {
                "播放"
            }));
            item.setEnabled(can_like);
        }
        for pointer in [&DOCK_PREVIOUS, &DOCK_NEXT] {
            if let Some(item) = pointer.load(Ordering::Acquire).as_ref() {
                item.setEnabled(can_like);
            }
        }
        if let Some(item) = DOCK_TOGGLE_LIKE.load(Ordering::Acquire).as_ref() {
            item.setTitle(&NSString::from_str(if is_liked {
                "取消喜欢"
            } else {
                "喜欢"
            }));
            item.setEnabled(can_like);
        }
    }
}

#[tauri::command]
fn update_tray_state(
    app: tauri::AppHandle,
    title: Option<String>,
    artist: Option<String>,
    is_playing: bool,
    is_liked: bool,
    can_like: bool,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let state = app.state::<TrayMenuState>();
        let track_label = match (title.as_deref(), artist.as_deref()) {
            (Some(title), Some(artist)) if !artist.is_empty() => format!("{title} · {artist}"),
            (Some(title), _) => title.to_string(),
            _ => "暂无播放".to_string(),
        };
        state
            .now_playing
            .set_text(&track_label)
            .map_err(|error| error.to_string())?;
        state
            .toggle_playback
            .set_text(if is_playing { "暂停" } else { "播放" })
            .map_err(|error| error.to_string())?;
        for item in [
            &state.previous,
            &state.toggle_playback,
            &state.next,
            &state.toggle_like,
        ] {
            item.set_enabled(can_like)
                .map_err(|error| error.to_string())?;
        }
        state
            .toggle_like
            .set_text(if is_liked { "取消喜欢" } else { "喜欢" })
            .map_err(|error| error.to_string())?;
        if let Some(tray) = app.tray_by_id("echora-tray") {
            let tooltip = if title.is_some() {
                format!("Echora · {track_label}")
            } else {
                "Echora".to_string()
            };
            tray.set_tooltip(Some(tooltip))
                .map_err(|error| error.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            let dock_track_label = track_label.clone();
            app.run_on_main_thread(move || {
                update_macos_dock_state(dock_track_label, is_playing, is_liked, can_like)
            })
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn setup_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{MenuBuilder, MenuItemBuilder},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        Emitter,
    };

    let now_playing = MenuItemBuilder::with_id("now-playing", "暂无播放")
        .enabled(false)
        .build(app)?;
    let previous = MenuItemBuilder::with_id("previous", "上一首").build(app)?;
    let toggle_playback = MenuItemBuilder::with_id("toggle-playback", "播放").build(app)?;
    let next = MenuItemBuilder::with_id("next", "下一首").build(app)?;
    let toggle_like = MenuItemBuilder::with_id("toggle-like", "喜欢").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&now_playing)
        .separator()
        .items(&[&previous, &toggle_playback, &next])
        .item(&toggle_like)
        .separator()
        .text("show", "显示 Echora")
        .separator()
        .text("quit", "退出 Echora")
        .build()?;
    let mut tray = TrayIconBuilder::with_id("echora-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Echora")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            "previous" | "toggle-playback" | "next" | "toggle-like" => {
                let _ = app.emit("echora://tray-control", event.id().as_ref());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    tray = tray.icon(tray_icon);
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon_as_template(true);
    }
    tray.build(app)?;
    app.manage(TrayMenuState {
        now_playing,
        previous,
        toggle_playback,
        next,
        toggle_like,
    });
    #[cfg(target_os = "macos")]
    setup_macos_dock_menu(app.handle())
        .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
    Ok(())
}

#[cfg(test)]
mod playback_cache_tests {
    use super::{normalized_media_content_type, parse_byte_range};

    #[test]
    fn parses_open_and_bounded_ranges() {
        assert_eq!(parse_byte_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=20-39", 100), Some((20, 39)));
        assert_eq!(parse_byte_range("bytes=90-120", 100), Some((90, 99)));
    }

    #[test]
    fn rejects_ranges_outside_the_cached_file() {
        assert_eq!(parse_byte_range("bytes=100-", 100), None);
        assert_eq!(parse_byte_range("invalid", 100), None);
    }

    #[test]
    fn corrects_provider_mime_metadata_for_flac() {
        let url = reqwest::Url::parse("http://stream.example.com/F000track.flac?token=1").unwrap();
        assert_eq!(
            normalized_media_content_type(&url, Some("audio/x-ogg"), b"fLaC\0\0\0\0"),
            "audio/flac"
        );
    }

    #[test]
    fn detects_audio_signature_when_url_has_no_extension() {
        let url = reqwest::Url::parse("https://stream.example.com/play?id=1").unwrap();
        assert_eq!(
            normalized_media_content_type(&url, Some("application/octet-stream"), b"OggS\0\0\0\0"),
            "audio/ogg"
        );
    }
}

#[cfg(target_os = "ios")]
fn ios_artwork_from_data_url(value: &str) -> Option<Retained<MPMediaItemArtwork>> {
    let (_, encoded) = value.split_once(',')?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let data = NSData::with_bytes(&bytes);
    let image = UIImage::imageWithData(&data)?;
    let artwork: Retained<MPMediaItemArtwork> =
        unsafe { msg_send![MPMediaItemArtwork::alloc(), initWithImage: &*image] };
    Some(artwork)
}

#[cfg(target_os = "ios")]
fn activate_ios_playback_session() {
    unsafe {
        let session = AVAudioSession::sharedInstance();
        if let Some(category) = AVAudioSessionCategoryPlayback {
            let _ = session.setCategory_error(category);
        }
        let _ = session.setActive_error(true);
    }
}

#[cfg(target_os = "ios")]
fn set_ios_now_playing_metadata(payload: IosNowPlayingMetadata) {
    if let Ok(mut current) = IOS_NOW_PLAYING_METADATA
        .get_or_init(|| Mutex::new(None))
        .lock()
    {
        *current = Some(payload.clone());
    }
    activate_ios_playback_session();
    let info = NSMutableDictionary::<NSString, AnyObject>::new();
    let title = NSString::from_str(&payload.title);
    let artist = NSString::from_str(&payload.artist);
    let album = NSString::from_str(&payload.album);
    let duration = NSNumber::new_f64(payload.duration.max(0.0));
    unsafe {
        info.insert(MPMediaItemPropertyTitle, &title);
        info.insert(MPMediaItemPropertyArtist, &artist);
        info.insert(MPMediaItemPropertyAlbumTitle, &album);
        info.insert(MPMediaItemPropertyPlaybackDuration, &duration);
    }
    if let Some(artwork) = payload
        .artwork_data_url
        .as_deref()
        .and_then(ios_artwork_from_data_url)
    {
        unsafe { info.insert(MPMediaItemPropertyArtwork, &artwork) };
    }
    unsafe { MPNowPlayingInfoCenter::defaultCenter().setNowPlayingInfo(Some(&info)) };
}

#[cfg(target_os = "ios")]
fn update_ios_live_activity(metadata: &IosNowPlayingMetadata, state: &IosNowPlayingState) {
    let Ok(title) = CString::new(metadata.title.as_str()) else {
        return;
    };
    let Ok(artist) = CString::new(metadata.artist.as_str()) else {
        return;
    };
    let artwork = metadata
        .live_artwork_base64
        .as_deref()
        .and_then(|value| CString::new(value).ok());
    if let Some(update) = ios_live_activity_update_symbol() {
        unsafe {
            update(
                title.as_ptr(),
                artist.as_ptr(),
                artwork
                    .as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                i32::from(state.is_playing),
                i32::from(state.is_liked),
                state.elapsed,
                state.duration,
            );
        }
    }
}

#[cfg(target_os = "ios")]
fn set_ios_now_playing_state(payload: IosNowPlayingState) {
    let center = unsafe { MPNowPlayingInfoCenter::defaultCenter() };
    let info = unsafe { center.nowPlayingInfo() }
        .map(|current| NSMutableDictionary::dictionaryWithDictionary(&current))
        .unwrap_or_else(NSMutableDictionary::<NSString, AnyObject>::new);
    let duration = payload.duration.max(0.0);
    let elapsed = payload.elapsed.clamp(0.0, duration.max(payload.elapsed));
    let rate = if payload.is_playing {
        payload.playback_rate.max(0.1)
    } else {
        0.0
    };
    unsafe {
        info.insert(
            MPMediaItemPropertyPlaybackDuration,
            &NSNumber::new_f64(duration),
        );
        info.insert(
            MPNowPlayingInfoPropertyElapsedPlaybackTime,
            &NSNumber::new_f64(elapsed),
        );
        info.insert(
            MPNowPlayingInfoPropertyPlaybackRate,
            &NSNumber::new_f64(rate),
        );
    }
    unsafe { center.setNowPlayingInfo(Some(&info)) };
    if let Some(metadata) = IOS_NOW_PLAYING_METADATA
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|value| value.clone())
    {
        update_ios_live_activity(&metadata, &payload);
    }
}

#[tauri::command]
fn update_ios_now_playing_metadata(
    app: tauri::AppHandle,
    payload: IosNowPlayingMetadata,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || set_ios_now_playing_metadata(payload))
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = (app, payload);
    Ok(())
}

#[tauri::command]
fn update_ios_now_playing_state(
    app: tauri::AppHandle,
    payload: IosNowPlayingState,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || set_ios_now_playing_state(payload))
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = (app, payload);
    Ok(())
}

#[tauri::command]
fn clear_ios_now_playing(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(|| unsafe {
        MPNowPlayingInfoCenter::defaultCenter().setNowPlayingInfo(None);
        if let Ok(mut current) = IOS_NOW_PLAYING_METADATA
            .get_or_init(|| Mutex::new(None))
            .lock()
        {
            *current = None;
        }
        if let Some(end) = ios_live_activity_end_symbol() {
            end();
        }
    })
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
fn start_ios_speech_recognition(app: tauri::AppHandle, generation: i64) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(move || {
        if let Some(start) = ios_speech_recognition_start_symbol() {
            unsafe { start(generation) };
        }
    })
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = (app, generation);
    Ok(())
}

#[tauri::command]
fn stop_ios_speech_recognition(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(|| {
        if let Some(stop) = ios_speech_recognition_stop_symbol() {
            unsafe { stop() };
        }
    })
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
fn cancel_ios_speech_recognition(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    app.run_on_main_thread(|| {
        if let Some(cancel) = ios_speech_recognition_cancel_symbol() {
            unsafe { cancel() };
        }
    })
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_media_protocol(tauri::Builder::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            setup_system_tray(app)?;
            #[cfg(target_os = "ios")]
            setup_ios_webview(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_update_context,
            open_enhanced_quality_registration,
            update_tray_state,
            list_music_folders,
            register_music_folders,
            remove_music_folder,
            scan_music_folder,
            playback_cache_stats,
            prune_playback_cache,
            clear_playback_cache,
            available_local_storage_bytes,
            update_ios_now_playing_metadata,
            update_ios_now_playing_state,
            clear_ios_now_playing,
            start_ios_speech_recognition,
            stop_ios_speech_recognition,
            cancel_ios_speech_recognition,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Echora")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(target_os = "ios")]
fn setup_ios_webview(app: &tauri::App) -> tauri::Result<()> {
    let _ = IOS_NATIVE_APP_HANDLE.set(app.handle().clone());
    if let Some(install) = ios_quick_actions_install_symbol() {
        unsafe { install(receive_ios_quick_action) };
    }
    if let Some(install) = ios_media_session_install_symbol() {
        unsafe { install(receive_ios_media_command) };
    }
    if let Some(install) = ios_speech_recognition_install_symbol() {
        unsafe { install(receive_ios_speech_event) };
    }
    if let Some(window) = app.get_webview_window("main") {
        window.with_webview(|platform_webview| unsafe {
            let webview = &*(platform_webview.inner() as *mut UIView);
            let controller = &*(platform_webview.view_controller() as *mut UIViewController);

            if let Some(root_view) = controller.view() {
                webview.setFrame(root_view.bounds());
                webview.setAutoresizingMask(
                    UIViewAutoresizing::FlexibleWidth | UIViewAutoresizing::FlexibleHeight,
                );
            }

            let scroll_view: Retained<UIScrollView> = objc2::msg_send![webview, scrollView];
            scroll_view.setContentInsetAdjustmentBehavior(
                UIScrollViewContentInsetAdjustmentBehavior::Never,
            );
        })?;
    }
    Ok(())
}

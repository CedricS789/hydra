#![cfg_attr(not(any(target_os = "linux", target_os = "windows")), allow(dead_code))]

mod binding;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
mod windows_hid;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
use unsupported as platform;
#[cfg(target_os = "windows")]
use windows as platform;

use binding::{
    find_key, gamepad, parse_hex_rgb, Backend, ControllerLedMode, HotkeyBinding, InputBinding,
    TriggerAction, TriggerSource, WakeMode, DEFAULT_CONTROLLER_LED_RGB,
};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::Status;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

#[napi(object)]
pub struct ScreenshotInputConfig {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub gamepad_enabled: bool,
    pub gamepad_buttons: Vec<String>,
    pub keyboard_enabled: Option<bool>,
    pub wake_enabled: Option<bool>,
    pub wake_mode: Option<String>,
    pub wake_buttons: Option<Vec<String>>,
    pub wake_hold_ms: Option<u32>,
    pub controller_led_mode: Option<String>,
    pub controller_led_color: Option<String>,
}

#[napi(object)]
pub struct ScreenshotInputEvent {
    pub kind: String,
    pub action: String,
    pub source: String,
    pub backend: String,
}

#[napi(object)]
pub struct ScreenshotInputNativeStatus {
    pub keyboard_backend: String,
    pub gamepad_backend: String,
    pub keyboard_error: Option<String>,
    pub gamepad_error: Option<String>,
    pub wayland_session: bool,
}

pub type ScreenshotInputCallback =
    ThreadsafeFunction<ScreenshotInputEvent, (), ScreenshotInputEvent, Status, false, true>;

pub struct BackendResult {
    pub backend: Backend,
    pub error: Option<&'static str>,
}

impl BackendResult {
    pub fn active(backend: Backend) -> Self {
        Self {
            backend,
            error: None,
        }
    }

    pub fn unavailable(error: &'static str) -> Self {
        Self {
            backend: Backend::Unavailable,
            error: Some(error),
        }
    }

    pub fn disabled() -> Self {
        Self {
            backend: Backend::Unavailable,
            error: None,
        }
    }
}

pub struct PlatformStatus {
    pub keyboard: BackendResult,
    pub gamepad: BackendResult,
    pub wayland_session: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    Trigger,
    Stopped,
}

impl EventKind {
    fn as_str(self) -> &'static str {
        match self {
            EventKind::Trigger => "trigger",
            EventKind::Stopped => "stopped",
        }
    }
}

pub struct Context {
    stopped: AtomicBool,
    binding: RwLock<InputBinding>,
    emit: Box<dyn Fn(EventKind, TriggerAction, TriggerSource, Backend) + Send + Sync>,
}

impl Context {
    pub fn new(
        binding: InputBinding,
        emit: Box<dyn Fn(EventKind, TriggerAction, TriggerSource, Backend) + Send + Sync>,
    ) -> Self {
        Self {
            stopped: AtomicBool::new(false),
            binding: RwLock::new(binding),
            emit,
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    pub fn binding(&self) -> InputBinding {
        self.binding
            .read()
            .map(|binding| *binding)
            .unwrap_or_default()
    }

    pub fn emit(&self, source: TriggerSource, backend: Backend) {
        self.emit_action(TriggerAction::Screenshot, source, backend);
    }

    pub fn emit_action(&self, action: TriggerAction, source: TriggerSource, backend: Backend) {
        if !self.is_stopped() {
            (self.emit)(EventKind::Trigger, action, source, backend);
        }
    }

    pub fn report_stopped(&self, source: TriggerSource, backend: Backend) {
        if !self.is_stopped() {
            (self.emit)(EventKind::Stopped, TriggerAction::Screenshot, source, backend);
        }
    }

    fn set_binding(&self, binding: InputBinding) {
        if let Ok(mut current) = self.binding.write() {
            *current = binding;
        }
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}

#[derive(Clone, Copy)]
pub struct StartOptions {
    pub keyboard: bool,
    pub gamepad: bool,
}

struct ParsedConfig {
    binding: InputBinding,
    options: StartOptions,
    keyboard_error: Option<&'static str>,
    gamepad_error: Option<&'static str>,
}

fn parse_config(config: &ScreenshotInputConfig) -> ParsedConfig {
    let keyboard_requested = config.keyboard_enabled.unwrap_or(true);
    let hotkey = if keyboard_requested {
        find_key(&config.key).map(|key| HotkeyBinding {
            key,
            ctrl: config.ctrl,
            alt: config.alt,
            shift: config.shift,
        })
    } else {
        None
    };
    let gamepad_mask = if config.gamepad_enabled {
        gamepad::combo_mask(&config.gamepad_buttons).unwrap_or(0)
    } else {
        0
    };
    let wake_requested = config.wake_enabled.unwrap_or(false);
    let wake_mask = if wake_requested {
        config
            .wake_buttons
            .as_deref()
            .and_then(gamepad::wake_combo_mask)
            .unwrap_or(0)
    } else {
        0
    };
    let wake_mode = config
        .wake_mode
        .as_deref()
        .map(WakeMode::from_str)
        .unwrap_or(WakeMode::Press);
    let wake_hold_ms = u64::from(config.wake_hold_ms.unwrap_or(400));
    let controller_led_mode = config
        .controller_led_mode
        .as_deref()
        .map(ControllerLedMode::from_str)
        .unwrap_or(ControllerLedMode::Off);
    let controller_led_color = config
        .controller_led_color
        .as_deref()
        .and_then(parse_hex_rgb)
        .unwrap_or(DEFAULT_CONTROLLER_LED_RGB);

    let keyboard = keyboard_requested && hotkey.is_some();
    let led_active = matches!(
        controller_led_mode,
        ControllerLedMode::Idle | ControllerLedMode::Active
    );
    let gamepad =
        (config.gamepad_enabled && gamepad_mask != 0) || (wake_requested && wake_mask != 0) || led_active;

    ParsedConfig {
        binding: InputBinding {
            hotkey,
            gamepad_mask,
            wake_mask,
            wake_mode,
            wake_hold_ms,
            controller_led_mode,
            controller_led_color,
        },
        options: StartOptions { keyboard, gamepad },
        keyboard_error: (keyboard_requested && hotkey.is_none()).then_some("unsupported-key"),
        gamepad_error: ((config.gamepad_enabled && gamepad_mask == 0)
            || (wake_requested && wake_mask == 0))
            .then_some("invalid-combo"),
    }
}

fn to_native_status(status: PlatformStatus, parsed: &ParsedConfig) -> ScreenshotInputNativeStatus {
    ScreenshotInputNativeStatus {
        keyboard_backend: status.keyboard.backend.as_str().to_string(),
        gamepad_backend: status.gamepad.backend.as_str().to_string(),
        keyboard_error: parsed
            .keyboard_error
            .or(status.keyboard.error)
            .map(str::to_string),
        gamepad_error: parsed
            .gamepad_error
            .or(status.gamepad.error)
            .map(str::to_string),
        wayland_session: status.wayland_session,
    }
}

struct Runtime {
    context: Arc<Context>,
    platform: platform::Runtime,
}

impl Runtime {
    fn shutdown(self) {
        self.context.stop();
        self.platform.stop();
    }
}

static RUNTIME: OnceLock<Mutex<Option<Runtime>>> = OnceLock::new();

fn runtime() -> &'static Mutex<Option<Runtime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

#[napi]
pub fn start_screenshot_input(
    config: ScreenshotInputConfig,
    callback: ScreenshotInputCallback,
) -> napi::Result<ScreenshotInputNativeStatus> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| napi::Error::from_reason("Screenshot input lock poisoned"))?;
    if let Some(previous) = guard.take() {
        previous.shutdown();
    }

    let parsed = parse_config(&config);
    let context = Arc::new(Context::new(
        parsed.binding,
        Box::new(move |kind, action, source, backend| {
            callback.call(
                ScreenshotInputEvent {
                    kind: kind.as_str().to_string(),
                    action: action.as_str().to_string(),
                    source: source.as_str().to_string(),
                    backend: backend.as_str().to_string(),
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }),
    ));
    let (platform_runtime, status) = platform::start(context.clone(), parsed.options);
    *guard = Some(Runtime {
        context,
        platform: platform_runtime,
    });

    Ok(to_native_status(status, &parsed))
}

#[napi]
pub fn update_screenshot_input_binding(config: ScreenshotInputConfig) -> bool {
    let Ok(guard) = runtime().lock() else {
        return false;
    };
    let Some(current) = guard.as_ref() else {
        return false;
    };
    current.context.set_binding(parse_config(&config).binding);
    #[cfg(target_os = "windows")]
    windows::notify_binding_updated(&current.platform);
    true
}

#[napi]
pub fn stop_screenshot_input() {
    let previous = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(previous) = previous {
        previous.shutdown();
    }
}

#[napi]
pub fn probe_screenshot_input(config: ScreenshotInputConfig) -> ScreenshotInputNativeStatus {
    let parsed = parse_config(&config);
    to_native_status(platform::probe(parsed.options), &parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(key: &str, buttons: &[&str]) -> ScreenshotInputConfig {
        ScreenshotInputConfig {
            key: key.to_string(),
            ctrl: false,
            alt: true,
            shift: false,
            gamepad_enabled: true,
            gamepad_buttons: buttons.iter().map(|value| value.to_string()).collect(),
            keyboard_enabled: None,
            wake_enabled: None,
            wake_mode: None,
            wake_buttons: None,
            wake_hold_ms: None,
            controller_led_mode: None,
            controller_led_color: None,
        }
    }

    #[test]
    fn parses_valid_config() {
        let parsed = parse_config(&config("F10", &["back", "rb"]));
        let hotkey = parsed.binding.hotkey.unwrap();
        assert_eq!(hotkey.key.name, "F10");
        assert!(hotkey.alt);
        assert_eq!(parsed.binding.gamepad_mask, gamepad::BACK | gamepad::RB);
        assert!(parsed.options.keyboard && parsed.options.gamepad);
        assert!(parsed.keyboard_error.is_none() && parsed.gamepad_error.is_none());
    }

    #[test]
    fn parses_wake_only_config_without_keyboard_hook() {
        let mut value = config("MetaLeft", &[]);
        value.gamepad_enabled = false;
        value.keyboard_enabled = Some(false);
        value.wake_enabled = Some(true);
        value.wake_mode = Some("hold".to_string());
        value.wake_buttons = Some(vec!["home".to_string()]);
        value.wake_hold_ms = Some(400);
        value.controller_led_mode = Some("active".to_string());
        value.controller_led_color = Some("#0070d1".to_string());
        let parsed = parse_config(&value);
        assert!(!parsed.options.keyboard);
        assert!(parsed.options.gamepad);
        assert_eq!(parsed.binding.wake_mask, gamepad::HOME);
        assert_eq!(parsed.binding.wake_mode, WakeMode::Hold);
        assert_eq!(parsed.binding.wake_hold_ms, 400);
        assert_eq!(parsed.binding.controller_led_color, [0, 112, 209]);
        assert!(parsed.keyboard_error.is_none());
        assert!(parsed.gamepad_error.is_none());
    }

    #[test]
    fn reports_invalid_key_and_combo() {
        let parsed = parse_config(&config("MetaLeft", &["rb"]));
        assert!(!parsed.options.keyboard && !parsed.options.gamepad);
        assert_eq!(parsed.keyboard_error, Some("unsupported-key"));
        assert_eq!(parsed.gamepad_error, Some("invalid-combo"));
    }

    #[test]
    fn disabled_gamepad_reports_no_error() {
        let mut value = config("F10", &[]);
        value.gamepad_enabled = false;
        let parsed = parse_config(&value);
        assert!(parsed.keyboard_error.is_none() && parsed.gamepad_error.is_none());
    }

    #[test]
    fn stopped_context_drops_events() {
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = count.clone();
        let context = Context::new(
            InputBinding::default(),
            Box::new(move |_, _, _, _| {
                counter.fetch_add(1, Ordering::SeqCst);
            }),
        );
        context.emit(TriggerSource::Keyboard, Backend::Unavailable);
        context.report_stopped(TriggerSource::Keyboard, Backend::Unavailable);
        context.stop();
        context.emit(TriggerSource::Keyboard, Backend::Unavailable);
        context.report_stopped(TriggerSource::Keyboard, Backend::Unavailable);
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
}

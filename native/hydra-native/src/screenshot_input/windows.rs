use super::binding::{
    gamepad, is_windows_modifier_scan_code, windows_scan_code, windows_virtual_key_scan_code,
    Backend, ComboMatcher, ControllerLedMode, HotkeyMatcher, Modifiers, TriggerAction,
    TriggerSource, WakeMatcher, WindowsShiftTracker,
};
use super::windows_hid::{
    build_sony_led_report, classify_hid_controller, decode_sony_bluetooth_report,
    detect_hid_transport, hat_to_dpad_mask, is_xinput_raw_device_name, map_hid_usages,
    ControllerLedState, HidControllerKind, HidTransport,
};
use super::{BackendResult, Context, PlatformStatus, StartOptions};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::mem::{size_of, transmute, zeroed};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HidP_GetCaps, HidP_GetSpecificValueCaps, HidP_GetUsageValue, HidP_GetUsages, HidP_Input,
    HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, PHIDP_PREPARSED_DATA,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_CLASS_ALREADY_EXISTS, ERROR_IO_PENDING, GENERIC_READ,
    GENERIC_WRITE, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, WAIT_OBJECT_0,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetCurrentThreadId, ResetEvent, SetEvent, WaitForMultipleObjectsEx,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, MAPVK_VK_TO_VSC_EX, VK_CONTROL, VK_LCONTROL, VK_LMENU,
    VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, GetRawInputDeviceInfoW, GetRawInputDeviceList, RegisterRawInputDevices,
    HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTDEVICELIST, RAWINPUTHEADER, RIDEV_INPUTSINK,
    RIDEV_REMOVE, RIDI_DEVICEINFO, RIDI_DEVICENAME, RIDI_PREPARSEDDATA, RID_DEVICE_INFO, RID_INPUT,
    RIM_TYPEHID, RIM_TYPEKEYBOARD,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PeekMessageW,
    PostThreadMessageW, RegisterClassW, UnregisterClassW, HWND_MESSAGE, MSG, PM_NOREMOVE,
    RI_KEY_BREAK, WM_INPUT, WM_QUIT, WNDCLASSW,
};

const READY_TIMEOUT: Duration = Duration::from_secs(2);
const XINPUT_POLL_INTERVAL: Duration = Duration::from_millis(16);
const XINPUT_RECONNECT_INTERVAL: Duration = Duration::from_secs(1);
const XINPUT_USER_COUNT: usize = 4;
const HID_RESCAN_INTERVAL: Duration = Duration::from_secs(1);
const HID_MAX_WAIT_DEVICES: usize = 63;
const MAX_HID_DRAIN_PACKETS: usize = 64;
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_JOYSTICK: u16 = 0x04;
const HID_USAGE_GENERIC_GAMEPAD: u16 = 0x05;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;
const HID_USAGE_GENERIC_HATSWITCH: u16 = 0x39;
const HID_USAGE_PAGE_BUTTON: u16 = 0x09;
const HID_USAGE_PAGE_CONSUMER: u16 = 0x0C;
const KEYBOARD_OVERRUN_MAKE_CODE: u16 = 0xFF;
const PRINT_SCREEN_SCAN_CODE: u16 = 0xE037;
const PRINT_SCREEN_MODIFIER_GRACE: Duration = Duration::from_millis(500);

#[derive(Default)]
struct RawInputControl {
    thread_id: AtomicU32,
    cancelled: AtomicBool,
}

impl RawInputControl {
    fn publish_thread(&self, context: &Context) -> bool {
        self.thread_id
            .store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
        !self.cancelled.load(Ordering::SeqCst) && !context.is_stopped()
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let thread_id = self.thread_id.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }
}

struct RawInputThread {
    handle: JoinHandle<()>,
    control: Arc<RawInputControl>,
}

struct HidControl {
    wake_event: isize,
    cancelled: AtomicBool,
}

impl HidControl {
    fn new() -> Option<Self> {
        let event = unsafe { CreateEventW(null(), 1, 0, null()) };
        if event.is_null() {
            None
        } else {
            Some(Self {
                wake_event: event as isize,
                cancelled: AtomicBool::new(false),
            })
        }
    }

    fn wake_handle(&self) -> HANDLE {
        self.wake_event as HANDLE
    }

    fn reset_wake(&self) {
        if self.wake_event != 0 {
            unsafe { ResetEvent(self.wake_handle()) };
        }
    }

    fn wake(&self) {
        if self.wake_event != 0 {
            unsafe { SetEvent(self.wake_handle()) };
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.wake();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

impl Drop for HidControl {
    fn drop(&mut self) {
        if self.wake_event != 0 {
            unsafe { CloseHandle(self.wake_handle()) };
        }
    }
}

struct HidGamepadThread {
    handle: JoinHandle<()>,
    control: Arc<HidControl>,
}

pub struct Runtime {
    raw_input: Option<RawInputThread>,
    hid_gamepad: Option<HidGamepadThread>,
    gamepad: Option<JoinHandle<()>>,
}

impl Runtime {
    pub fn stop(self) {
        if let Some(raw_input) = self.raw_input {
            raw_input.control.cancel();
            let _ = raw_input.handle.join();
        }
        if let Some(hid_gamepad) = self.hid_gamepad {
            hid_gamepad.control.cancel();
            let _ = hid_gamepad.handle.join();
        }
        if let Some(gamepad) = self.gamepad {
            gamepad.thread().unpark();
            let _ = gamepad.join();
        }
    }
}

pub fn notify_binding_updated(runtime: &Runtime) {
    if let Some(hid_gamepad) = &runtime.hid_gamepad {
        hid_gamepad.control.wake();
    }
}

pub fn probe(options: StartOptions) -> PlatformStatus {
    PlatformStatus {
        keyboard: if options.keyboard {
            BackendResult::active(Backend::WindowsRawInput)
        } else {
            BackendResult::disabled()
        },
        gamepad: if options.gamepad {
            BackendResult::active(Backend::XInput)
        } else {
            BackendResult::disabled()
        },
        wayland_session: false,
    }
}

pub fn start(context: Arc<Context>, options: StartOptions) -> (Runtime, PlatformStatus) {
    let mut status = probe(options);
    let mut runtime = Runtime {
        raw_input: None,
        hid_gamepad: None,
        gamepad: None,
    };

    if options.keyboard {
        let (ready, receiver) = mpsc::sync_channel(1);
        let control = Arc::new(RawInputControl::default());
        let thread_control = control.clone();
        let thread_context = context.clone();
        match thread::Builder::new()
            .name("hydra-screenshot-raw-input".into())
            .spawn(move || run_raw_input(&thread_context, &thread_control, options, ready))
        {
            Ok(handle) => match receiver.recv_timeout(READY_TIMEOUT) {
                Ok(Ok(())) => runtime.raw_input = Some(RawInputThread { handle, control }),
                Ok(Err(error)) => {
                    status.keyboard = BackendResult::unavailable(error);
                    let _ = handle.join();
                }
                Err(_) => {
                    status.keyboard = BackendResult::unavailable("raw-input-timeout");
                    control.cancel();
                    runtime.raw_input = Some(RawInputThread { handle, control });
                }
            },
            Err(_) => {
                status.keyboard = BackendResult::unavailable("thread-failed");
            }
        }
    }

    if options.gamepad {
        // Read non-XInput HID gamepads via shared CreateFileW + overlapped ReadFile rather than
        // RegisterRawInputDevices so Chromium's Gamepad API in Big Picture cannot steal or remove
        // our process-wide registration when Big Picture opens and closes.
        if let Some(hid_control) = HidControl::new() {
            let hid_control = Arc::new(hid_control);
            let thread_control = hid_control.clone();
            let thread_context = context.clone();
            if let Ok(handle) = thread::Builder::new()
                .name("hydra-screenshot-hid-gamepad".into())
                .spawn(move || run_hid_gamepads(&thread_context, &thread_control))
            {
                runtime.hid_gamepad = Some(HidGamepadThread {
                    handle,
                    control: hid_control,
                });
            }
        }

        let thread_context = context.clone();
        match thread::Builder::new()
            .name("hydra-screenshot-xinput".into())
            .spawn(move || run_xinput(&thread_context))
        {
            Ok(handle) => runtime.gamepad = Some(handle),
            Err(_) => {
                if runtime.hid_gamepad.is_none() {
                    status.gamepad = BackendResult::unavailable("thread-failed");
                }
            }
        }
    }

    (runtime, status)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn register_keyboard_raw_input(window: HWND, remove: bool) -> bool {
    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_KEYBOARD,
        dwFlags: if remove { RIDEV_REMOVE } else { RIDEV_INPUTSINK },
        hwndTarget: if remove { null_mut() } else { window },
    };
    unsafe { RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32) != 0 }
}

fn run_raw_input(
    context: &Context,
    control: &RawInputControl,
    options: StartOptions,
    ready: mpsc::SyncSender<Result<(), &'static str>>,
) {
    let mut message: MSG = unsafe { zeroed() };
    unsafe { PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE) };
    if !control.publish_thread(context) {
        let _ = ready.send(Err("raw-input-cancelled"));
        return;
    }

    let class_name = wide("HydraScreenshotRawInput");
    let instance = unsafe { GetModuleHandleW(null()) };
    let class = WNDCLASSW {
        lpfnWndProc: Some(DefWindowProcW),
        hInstance: instance,
        lpszClassName: class_name.as_ptr(),
        ..unsafe { zeroed() }
    };
    if unsafe { RegisterClassW(&class) } == 0
        && unsafe { GetLastError() } != ERROR_CLASS_ALREADY_EXISTS
    {
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    let window = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            instance,
            null(),
        )
    };
    if window.is_null() {
        unsafe { UnregisterClassW(class_name.as_ptr(), instance) };
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    if !register_keyboard_raw_input(window, false) {
        unsafe {
            DestroyWindow(window);
            UnregisterClassW(class_name.as_ptr(), instance);
        }
        let _ = ready.send(Err("raw-input-failed"));
        return;
    }

    let _ = ready.send(Ok(()));

    let mut keyboard = KeyboardState {
        hotkey: HotkeyMatcher::default(),
        shift: WindowsShiftTracker::new(key_down(VK_LSHIFT), key_down(VK_RSHIFT)),
        print_screen_down: false,
        modifier_releases: ModifierReleases::default(),
    };
    let mut raw_buffer = Vec::<u8>::with_capacity(256);

    let failed = loop {
        match unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } {
            0 => break false,
            -1 => break true,
            _ => {}
        }
        if message.message == WM_INPUT && message.hwnd == window && options.keyboard {
            handle_raw_input(context, &mut keyboard, &mut raw_buffer, message.lParam);
        }
        unsafe { DispatchMessageW(&message) };
    };

    register_keyboard_raw_input(window, true);
    unsafe {
        DestroyWindow(window);
        UnregisterClassW(class_name.as_ptr(), instance);
    }
    if failed && options.keyboard {
        context.report_stopped(TriggerSource::Keyboard, Backend::WindowsRawInput);
    }
}

fn key_down(virtual_key: u16) -> bool {
    unsafe { GetAsyncKeyState(i32::from(virtual_key)) as u16 & 0x8000 != 0 }
}

fn is_shift_virtual_key(virtual_key: u16) -> bool {
    matches!(virtual_key, VK_SHIFT | VK_LSHIFT | VK_RSHIFT)
}

fn is_modifier_virtual_key(virtual_key: u16) -> bool {
    is_shift_virtual_key(virtual_key)
        || matches!(
            virtual_key,
            VK_CONTROL
                | VK_LCONTROL
                | VK_RCONTROL
                | VK_MENU
                | VK_LMENU
                | VK_RMENU
                | VK_LWIN
                | VK_RWIN
        )
}

#[derive(Default)]
struct ModifierReleases {
    ctrl: Option<Instant>,
    alt: Option<Instant>,
    shift: Option<Instant>,
    meta: Option<Instant>,
}

impl ModifierReleases {
    fn on_key(&mut self, virtual_key: u16, pressed: bool, now: Instant) {
        let slot = match virtual_key {
            VK_CONTROL | VK_LCONTROL | VK_RCONTROL => &mut self.ctrl,
            VK_MENU | VK_LMENU | VK_RMENU => &mut self.alt,
            VK_SHIFT | VK_LSHIFT | VK_RSHIFT => &mut self.shift,
            VK_LWIN | VK_RWIN => &mut self.meta,
            _ => return,
        };
        *slot = if pressed { None } else { Some(now) };
    }

    fn within_grace(&self, now: Instant) -> Modifiers {
        let recent = |released: Option<Instant>| {
            released.is_some_and(|at| now.duration_since(at) <= PRINT_SCREEN_MODIFIER_GRACE)
        };
        Modifiers {
            ctrl: recent(self.ctrl),
            alt: recent(self.alt),
            shift: recent(self.shift),
            meta: recent(self.meta),
        }
    }
}

struct KeyboardState {
    hotkey: HotkeyMatcher,
    shift: WindowsShiftTracker,
    print_screen_down: bool,
    modifier_releases: ModifierReleases,
}

impl KeyboardState {
    fn current_modifiers(&self) -> Modifiers {
        Modifiers {
            ctrl: key_down(VK_CONTROL),
            alt: key_down(VK_MENU),
            shift: self.shift.is_held(key_down(VK_SHIFT)),
            meta: key_down(VK_LWIN) || key_down(VK_RWIN),
        }
    }
}

fn scan_code_from_virtual_key(virtual_key: u16, flags: u16) -> Option<u16> {
    let mapped = unsafe { MapVirtualKeyW(u32::from(virtual_key), MAPVK_VK_TO_VSC_EX) };
    windows_virtual_key_scan_code(mapped, flags)
}

fn to_led_state(mode: ControllerLedMode, color: [u8; 3]) -> ControllerLedState {
    match mode {
        ControllerLedMode::Off => ControllerLedState::Off,
        ControllerLedMode::Idle => ControllerLedState::Idle(color),
        ControllerLedMode::Active => ControllerLedState::Active(color),
        ControllerLedMode::PausedForGame => ControllerLedState::PausedForGame,
    }
}

fn binding_led_state(context: &Context) -> ControllerLedState {
    let binding = context.binding();
    to_led_state(binding.controller_led_mode, binding.controller_led_color)
}

struct HidDeviceEntry {
    device_path: String,
    kind: HidControllerKind,
    transport: HidTransport,
    output_report_len: usize,
    preparsed: Vec<u8>,
    has_hat: bool,
    hat_logical_min: i32,
    read_handle: HANDLE,
    read_event: HANDLE,
    overlapped: Box<OVERLAPPED>,
    read_buf: Box<[u8]>,
    read_pending: bool,
    last_buttons: u32,
    combo: ComboMatcher,
    wake: WakeMatcher,
    last_led_applied: Option<ControllerLedState>,
}

impl Drop for HidDeviceEntry {
    fn drop(&mut self) {
        if self.read_pending {
            unsafe {
                CancelIoEx(self.read_handle, &*self.overlapped);
            }
            let mut transferred = 0u32;
            unsafe {
                GetOverlappedResult(self.read_handle, &*self.overlapped, &mut transferred, 1);
            }
            self.read_pending = false;
        }
        unsafe {
            CloseHandle(self.read_handle);
            CloseHandle(self.read_event);
        }
    }
}

impl HidDeviceEntry {
    fn sync_led(&mut self, state: ControllerLedState) {
        if self.last_led_applied == Some(state) {
            return;
        }
        let Some(rgb) = state.rgb() else {
            self.last_led_applied = Some(state);
            return;
        };
        let Some(report) = build_sony_led_report(
            self.kind,
            self.transport,
            self.output_report_len,
            rgb,
            state.player_leds(),
        ) else {
            self.last_led_applied = Some(state);
            return;
        };
        if write_hid_output_report(&self.device_path, &report) {
            self.last_led_applied = Some(state);
        }
    }

    fn arm_read(&mut self) -> Result<Option<usize>, ()> {
        unsafe { ResetEvent(self.read_event) };
        *self.overlapped = unsafe { zeroed() };
        self.overlapped.hEvent = self.read_event;
        let mut bytes_read = 0u32;
        let ok = unsafe {
            ReadFile(
                self.read_handle,
                self.read_buf.as_mut_ptr(),
                self.read_buf.len() as u32,
                &mut bytes_read,
                &mut *self.overlapped,
            )
        };
        if ok != 0 {
            self.read_pending = false;
            return Ok(Some(bytes_read as usize));
        }
        if unsafe { GetLastError() } == ERROR_IO_PENDING {
            self.read_pending = true;
            Ok(None)
        } else {
            self.read_pending = false;
            Err(())
        }
    }

    fn process_report(&mut self, context: &Context, len: usize, now: Instant) {
        let len = len.min(self.read_buf.len());
        if len == 0 {
            return;
        }
        let binding = context.binding();
        self.sync_led(to_led_state(
            binding.controller_led_mode,
            binding.controller_led_color,
        ));
        let buttons = decode_hid_report_mask(self, &self.read_buf[..len]);
        self.last_buttons = buttons;
        if self.combo.update(buttons, binding.gamepad_mask) {
            context.emit_action(
                TriggerAction::Screenshot,
                TriggerSource::Gamepad,
                Backend::WindowsRawInput,
            );
        }
        if self.wake.update(
            buttons,
            binding.wake_mask,
            binding.wake_mode,
            binding.wake_hold_ms,
            now,
        ) {
            context.emit_action(
                TriggerAction::BigPictureWake,
                TriggerSource::Gamepad,
                Backend::WindowsRawInput,
            );
        }
    }

    fn drain_ready_reads(&mut self, context: &Context, completed_sync_len: Option<usize>) -> bool {
        let now = Instant::now();
        if let Some(len) = completed_sync_len {
            self.process_report(context, len, now);
        }
        for _ in 0..MAX_HID_DRAIN_PACKETS {
            match self.arm_read() {
                Ok(Some(len)) => self.process_report(context, len, Instant::now()),
                Ok(None) => return true,
                Err(()) => return false,
            }
        }
        // Keep the event signaled if the kernel buffer still had packets beyond the cap.
        unsafe { SetEvent(self.read_event) };
        true
    }

    fn on_read_signaled(&mut self, context: &Context) -> bool {
        let mut bytes_read = 0u32;
        let ok = unsafe {
            GetOverlappedResult(self.read_handle, &*self.overlapped, &mut bytes_read, 0)
        };
        self.read_pending = false;
        if ok == 0 {
            return false;
        }
        self.drain_ready_reads(context, Some(bytes_read as usize))
    }
}

#[derive(Default)]
struct HidDeviceCache {
    devices: HashMap<isize, HidDeviceEntry>,
    ignored: HashSet<isize>,
}

impl HidDeviceCache {
    fn reconcile_devices(&mut self, context: &Context, led_state: ControllerLedState) {
        let mut count = 0u32;
        let list_size = size_of::<RAWINPUTDEVICELIST>() as u32;
        if unsafe { GetRawInputDeviceList(null_mut(), &mut count, list_size) } != 0 || count == 0 {
            self.devices.clear();
            self.ignored.clear();
            return;
        }
        let mut list: Vec<RAWINPUTDEVICELIST> = vec![unsafe { zeroed() }; count as usize];
        let filled = unsafe { GetRawInputDeviceList(list.as_mut_ptr(), &mut count, list_size) };
        if filled == u32::MAX {
            return;
        }

        let mut active_hid_handles = HashSet::new();
        for item in list.iter().take(filled as usize) {
            if item.dwType == RIM_TYPEHID {
                active_hid_handles.insert(item.hDevice as isize);
            }
        }
        self.devices.retain(|key, _| active_hid_handles.contains(key));
        self.ignored.retain(|key| active_hid_handles.contains(key));

        for item in list.into_iter().take(filled as usize) {
            if item.dwType != RIM_TYPEHID {
                continue;
            }
            let key = item.hDevice as isize;
            if self.devices.contains_key(&key) || self.ignored.contains(&key) {
                continue;
            }
            match build_hid_device_entry(item.hDevice, context) {
                Some(mut entry) => {
                    entry.sync_led(led_state);
                    self.devices.insert(key, entry);
                }
                None => {
                    self.ignored.insert(key);
                }
            }
        }
    }

    fn sync_all_leds(&mut self, state: ControllerLedState) {
        for entry in self.devices.values_mut() {
            entry.sync_led(state);
        }
    }

    fn poll_hold_timers(&mut self, context: &Context, now: Instant) {
        let binding = context.binding();
        for entry in self.devices.values_mut() {
            if entry.wake.update(
                entry.last_buttons,
                binding.wake_mask,
                binding.wake_mode,
                binding.wake_hold_ms,
                now,
            ) {
                context.emit_action(
                    TriggerAction::BigPictureWake,
                    TriggerSource::Gamepad,
                    Backend::WindowsRawInput,
                );
            }
        }
    }

    fn wait_timeout_ms(&self, hold_ms: u64, last_rescan: Instant, now: Instant) -> u32 {
        let hold_due = self
            .devices
            .values()
            .filter_map(|entry| entry.wake.remaining_hold_ms(hold_ms, now))
            .min()
            .map(|ms| (ms as u64).clamp(16, 200));
        let rescan_due = HID_RESCAN_INTERVAL
            .saturating_sub(now.saturating_duration_since(last_rescan))
            .as_millis() as u64;
        match hold_due {
            Some(hold) => hold.min(rescan_due.max(16)) as u32,
            None => rescan_due.clamp(16, HID_RESCAN_INTERVAL.as_millis() as u64) as u32,
        }
    }
}

fn run_hid_gamepads(context: &Context, control: &HidControl) {
    let mut hid_cache = HidDeviceCache::default();
    let mut last_rescan = Instant::now();
    hid_cache.reconcile_devices(context, binding_led_state(context));

    let mut wait_handles: Vec<HANDLE> = Vec::with_capacity(HID_MAX_WAIT_DEVICES + 1);
    let mut wait_keys: Vec<isize> = Vec::with_capacity(HID_MAX_WAIT_DEVICES);

    while !context.is_stopped() && !control.is_cancelled() {
        wait_handles.clear();
        wait_keys.clear();
        wait_handles.push(control.wake_handle());
        for (&key, entry) in hid_cache.devices.iter().take(HID_MAX_WAIT_DEVICES) {
            wait_handles.push(entry.read_event);
            wait_keys.push(key);
        }

        let now = Instant::now();
        let timeout_ms =
            hid_cache.wait_timeout_ms(context.binding().wake_hold_ms, last_rescan, now);
        let signaled = unsafe {
            WaitForMultipleObjectsEx(
                wait_handles.len() as u32,
                wait_handles.as_ptr(),
                0,
                timeout_ms,
                0,
            )
        };

        if context.is_stopped() || control.is_cancelled() {
            break;
        }

        let after_wait = Instant::now();
        if signaled == WAIT_OBJECT_0 {
            control.reset_wake();
            let led_state = binding_led_state(context);
            hid_cache.reconcile_devices(context, led_state);
            hid_cache.sync_all_leds(led_state);
            last_rescan = after_wait;
        } else if signaled > WAIT_OBJECT_0
            && (signaled - WAIT_OBJECT_0) as usize <= wait_keys.len()
        {
            let key = wait_keys[(signaled - WAIT_OBJECT_0 - 1) as usize];
            let keep = hid_cache
                .devices
                .get_mut(&key)
                .is_some_and(|entry| entry.on_read_signaled(context));
            if !keep {
                hid_cache.devices.remove(&key);
                hid_cache.ignored.insert(key);
            }
        }

        hid_cache.poll_hold_timers(context, after_wait);
        if after_wait.saturating_duration_since(last_rescan) >= HID_RESCAN_INTERVAL {
            hid_cache.reconcile_devices(context, binding_led_state(context));
            last_rescan = after_wait;
        }
    }

    if !matches!(
        context.binding().controller_led_mode,
        ControllerLedMode::PausedForGame
    ) {
        hid_cache.sync_all_leds(ControllerLedState::Off);
    }
}

fn query_device_name(handle: HANDLE) -> Option<String> {
    let mut char_count = 0u32;
    if unsafe { GetRawInputDeviceInfoW(handle, RIDI_DEVICENAME, null_mut(), &mut char_count) } != 0
        || char_count == 0
    {
        return None;
    }
    let mut buffer = vec![0u16; char_count as usize];
    let read = unsafe {
        GetRawInputDeviceInfoW(
            handle,
            RIDI_DEVICENAME,
            buffer.as_mut_ptr().cast(),
            &mut char_count,
        )
    };
    if read == u32::MAX || read == 0 {
        return None;
    }
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}

fn open_hid_read_handle(device_path: &str) -> HANDLE {
    let path_wide = wide(device_path);
    let open = |access: u32| unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            null_mut(),
        )
    };
    let handle = open(GENERIC_READ | GENERIC_WRITE);
    if handle != INVALID_HANDLE_VALUE {
        return handle;
    }
    open(GENERIC_READ)
}

fn build_hid_device_entry(handle: HANDLE, context: &Context) -> Option<HidDeviceEntry> {
    let device_path = query_device_name(handle)?;
    if is_xinput_raw_device_name(&device_path) {
        return None;
    }

    let mut info: RID_DEVICE_INFO = unsafe { zeroed() };
    info.cbSize = size_of::<RID_DEVICE_INFO>() as u32;
    let mut info_size = info.cbSize;
    if unsafe {
        GetRawInputDeviceInfoW(
            handle,
            RIDI_DEVICEINFO,
            (&mut info as *mut RID_DEVICE_INFO).cast(),
            &mut info_size,
        )
    } == u32::MAX
    {
        return None;
    }
    if info.dwType != RIM_TYPEHID {
        return None;
    }
    let hid_info = unsafe { info.Anonymous.hid };
    if hid_info.usUsagePage != HID_USAGE_PAGE_GENERIC
        || !matches!(
            hid_info.usUsage,
            HID_USAGE_GENERIC_GAMEPAD | HID_USAGE_GENERIC_JOYSTICK
        )
    {
        return None;
    }

    let mut preparsed_size = 0u32;
    if unsafe { GetRawInputDeviceInfoW(handle, RIDI_PREPARSEDDATA, null_mut(), &mut preparsed_size) }
        != 0
        || preparsed_size == 0
    {
        return None;
    }
    let mut preparsed = vec![0u8; preparsed_size as usize];
    if unsafe {
        GetRawInputDeviceInfoW(
            handle,
            RIDI_PREPARSEDDATA,
            preparsed.as_mut_ptr().cast(),
            &mut preparsed_size,
        )
    } == u32::MAX
    {
        return None;
    }

    let mut caps: HIDP_CAPS = unsafe { zeroed() };
    if unsafe { HidP_GetCaps(preparsed.as_ptr() as PHIDP_PREPARSED_DATA, &mut caps) }
        != HIDP_STATUS_SUCCESS
    {
        return None;
    }

    let mut hat_caps: HIDP_VALUE_CAPS = unsafe { zeroed() };
    let mut hat_len = 1u16;
    let has_hat = unsafe {
        HidP_GetSpecificValueCaps(
            HidP_Input,
            HID_USAGE_PAGE_GENERIC,
            0,
            HID_USAGE_GENERIC_HATSWITCH,
            &mut hat_caps,
            &mut hat_len,
            preparsed.as_ptr() as PHIDP_PREPARSED_DATA,
        )
    } == HIDP_STATUS_SUCCESS
        && hat_len > 0;

    let read_handle = open_hid_read_handle(&device_path);
    if read_handle == INVALID_HANDLE_VALUE {
        return None;
    }
    let read_event = unsafe { CreateEventW(null(), 1, 0, null()) };
    if read_event.is_null() {
        unsafe { CloseHandle(read_handle) };
        return None;
    }

    let kind = classify_hid_controller(hid_info.dwVendorId as u16, hid_info.dwProductId as u16);
    let transport = detect_hid_transport(caps.InputReportByteLength, caps.OutputReportByteLength);
    let input_len = usize::from(caps.InputReportByteLength).max(1);

    let mut entry = HidDeviceEntry {
        device_path,
        kind,
        transport,
        output_report_len: usize::from(caps.OutputReportByteLength),
        preparsed,
        has_hat,
        hat_logical_min: if has_hat { hat_caps.LogicalMin } else { 0 },
        read_handle,
        read_event,
        overlapped: Box::new(unsafe { zeroed() }),
        read_buf: vec![0u8; input_len].into_boxed_slice(),
        read_pending: false,
        last_buttons: 0,
        combo: ComboMatcher::default(),
        wake: WakeMatcher::default(),
        last_led_applied: None,
    };
    if !entry.drain_ready_reads(context, None) {
        return None;
    }
    Some(entry)
}

fn write_hid_output_report(device_path: &str, report: &[u8]) -> bool {
    let path_wide = wide(device_path);
    let open = |access: u32| unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    let mut handle = open(GENERIC_WRITE | GENERIC_READ);
    if handle == INVALID_HANDLE_VALUE {
        handle = open(GENERIC_WRITE);
    }
    if handle == INVALID_HANDLE_VALUE {
        return false;
    }
    let mut written = 0u32;
    let ok = unsafe {
        WriteFile(
            handle,
            report.as_ptr(),
            report.len() as u32,
            &mut written,
            null_mut(),
        ) != 0
    };
    unsafe { CloseHandle(handle) };
    ok && written as usize == report.len()
}

fn decode_hid_report_mask(entry: &HidDeviceEntry, report: &[u8]) -> u32 {
    if let Some(sony_mask) = decode_sony_bluetooth_report(entry.kind, report) {
        return sony_mask;
    }

    let preparsed = entry.preparsed.as_ptr() as PHIDP_PREPARSED_DATA;
    let mut button_usages = [0u16; 32];
    let mut button_count = button_usages.len() as u32;
    let button_status = unsafe {
        HidP_GetUsages(
            HidP_Input,
            HID_USAGE_PAGE_BUTTON,
            0,
            button_usages.as_mut_ptr(),
            &mut button_count,
            preparsed,
            report.as_ptr() as *mut u8,
            report.len() as u32,
        )
    };
    let active_buttons = if button_status == HIDP_STATUS_SUCCESS {
        &button_usages[..button_count.min(button_usages.len() as u32) as usize]
    } else {
        &[]
    };

    let mut consumer_usages = [0u16; 8];
    let mut consumer_count = consumer_usages.len() as u32;
    let consumer_status = unsafe {
        HidP_GetUsages(
            HidP_Input,
            HID_USAGE_PAGE_CONSUMER,
            0,
            consumer_usages.as_mut_ptr(),
            &mut consumer_count,
            preparsed,
            report.as_ptr() as *mut u8,
            report.len() as u32,
        )
    };
    let active_consumers = if consumer_status == HIDP_STATUS_SUCCESS {
        &consumer_usages[..consumer_count.min(consumer_usages.len() as u32) as usize]
    } else {
        &[]
    };

    let mut hat_mask = 0;
    if entry.has_hat {
        let mut hat_val = 0u32;
        if unsafe {
            HidP_GetUsageValue(
                HidP_Input,
                HID_USAGE_PAGE_GENERIC,
                0,
                HID_USAGE_GENERIC_HATSWITCH,
                &mut hat_val,
                preparsed,
                report.as_ptr() as *mut u8,
                report.len() as u32,
            )
        } == HIDP_STATUS_SUCCESS
        {
            hat_mask = hat_to_dpad_mask(hat_val, entry.hat_logical_min);
        }
    }

    map_hid_usages(entry.kind, active_buttons, active_consumers, hat_mask)
}

fn handle_raw_input(
    context: &Context,
    state: &mut KeyboardState,
    raw_buffer: &mut Vec<u8>,
    lparam: LPARAM,
) {
    let mut size = 0u32;
    let header_size = size_of::<RAWINPUTHEADER>() as u32;
    if unsafe { GetRawInputData(lparam as HRAWINPUT, RID_INPUT, null_mut(), &mut size, header_size) }
        != 0
        || size == 0
    {
        return;
    }
    if raw_buffer.len() < size as usize {
        raw_buffer.resize(size as usize, 0);
    }
    let read = unsafe {
        GetRawInputData(
            lparam as HRAWINPUT,
            RID_INPUT,
            raw_buffer.as_mut_ptr().cast::<c_void>(),
            &mut size,
            header_size,
        )
    };
    if read == u32::MAX || read < header_size {
        return;
    }

    let header = unsafe { &*(raw_buffer.as_ptr().cast::<RAWINPUTHEADER>()) };
    if header.dwType != RIM_TYPEKEYBOARD {
        return;
    }

    let input = unsafe { &*(raw_buffer.as_ptr().cast::<RAWINPUT>()) };
    let keyboard = unsafe { input.data.keyboard };
    let code = if keyboard.MakeCode == 0 || keyboard.MakeCode == KEYBOARD_OVERRUN_MAKE_CODE {
        match scan_code_from_virtual_key(keyboard.VKey, keyboard.Flags) {
            Some(code) => code,
            None => return,
        }
    } else {
        windows_scan_code(keyboard.MakeCode, keyboard.Flags)
    };
    let pressed = u32::from(keyboard.Flags) & RI_KEY_BREAK == 0;
    let mut release_without_press = false;
    if code == PRINT_SCREEN_SCAN_CODE {
        release_without_press = !pressed && !state.print_screen_down;
        state.print_screen_down = pressed;
    }
    if is_windows_modifier_scan_code(code) {
        state
            .modifier_releases
            .on_key(keyboard.VKey, pressed, Instant::now());
    }

    if state.shift.on_key(code, pressed) {
        return;
    }
    if is_modifier_virtual_key(keyboard.VKey) && !is_windows_modifier_scan_code(code) {
        if is_shift_virtual_key(keyboard.VKey) {
            state.shift.on_system_shift();
        }
        return;
    }

    let Some(binding) = context.binding().hotkey else {
        return;
    };
    if code != binding.key.platform_code() {
        return;
    }
    let mut modifiers = state.current_modifiers();
    if release_without_press && !binding.matches_modifiers(modifiers) {
        modifiers = modifiers.union(state.modifier_releases.within_grace(Instant::now()));
    }
    let fired = state
        .hotkey
        .on_key(code, pressed || release_without_press, &binding, modifiers);
    if release_without_press {
        state.hotkey.on_key(code, false, &binding, modifiers);
    }
    if fired {
        context.emit(TriggerSource::Keyboard, Backend::WindowsRawInput);
    }
}

type XInputGetStateExFn = unsafe extern "system" fn(u32, *mut XINPUT_STATE) -> u32;

fn resolve_xinput_get_state_ex() -> Option<XInputGetStateExFn> {
    for dll in ["xinput1_4.dll", "xinput1_3.dll"] {
        let name = wide(dll);
        let module = unsafe {
            let existing = GetModuleHandleW(name.as_ptr());
            if existing.is_null() {
                LoadLibraryW(name.as_ptr())
            } else {
                existing
            }
        };
        if module.is_null() {
            continue;
        }
        // Ordinal 100 (XInputGetStateEx) exposes the Xbox Guide button bit (0x0400).
        if let Some(proc) = unsafe { GetProcAddress(module, 100usize as *const u8) } {
            return Some(unsafe { transmute::<_, XInputGetStateExFn>(proc) });
        }
    }
    None
}

fn run_xinput(context: &Context) {
    let get_state_ex = resolve_xinput_get_state_ex();
    let mut combos: [ComboMatcher; XINPUT_USER_COUNT] = Default::default();
    let mut wakes: [WakeMatcher; XINPUT_USER_COUNT] = Default::default();
    let mut next_probe: [Option<Instant>; XINPUT_USER_COUNT] = [None; XINPUT_USER_COUNT];

    while !context.is_stopped() {
        let binding = context.binding();
        let now = Instant::now();
        for user in 0..XINPUT_USER_COUNT {
            if next_probe[user].is_some_and(|deadline| now < deadline) {
                continue;
            }
            let mut state: XINPUT_STATE = unsafe { zeroed() };
            let status = unsafe {
                match get_state_ex {
                    Some(func) => func(user as u32, &mut state),
                    None => XInputGetState(user as u32, &mut state),
                }
            };
            if status != 0 {
                next_probe[user] = Some(now + XINPUT_RECONNECT_INTERVAL);
                combos[user] = ComboMatcher::default();
                wakes[user] = WakeMatcher::default();
                continue;
            }
            next_probe[user] = None;
            let screenshot_buttons = gamepad::xinput_mask(
                state.Gamepad.wButtons,
                state.Gamepad.bLeftTrigger,
                state.Gamepad.bRightTrigger,
            );
            if combos[user].update(screenshot_buttons, binding.gamepad_mask) {
                context.emit_action(
                    TriggerAction::Screenshot,
                    TriggerSource::Gamepad,
                    Backend::XInput,
                );
            }
            let all_buttons = gamepad::xinput_all_mask(
                state.Gamepad.wButtons,
                state.Gamepad.bLeftTrigger,
                state.Gamepad.bRightTrigger,
            );
            if wakes[user].update(
                all_buttons,
                binding.wake_mask,
                binding.wake_mode,
                binding.wake_hold_ms,
                now,
            ) {
                context.emit_action(
                    TriggerAction::BigPictureWake,
                    TriggerSource::Gamepad,
                    Backend::XInput,
                );
            }
        }
        thread::park_timeout(xinput_wait(&next_probe, Instant::now()));
    }
}

fn xinput_wait(next_probe: &[Option<Instant>; XINPUT_USER_COUNT], now: Instant) -> Duration {
    let mut earliest_probe: Option<Instant> = None;
    for deadline in next_probe {
        let Some(deadline) = *deadline else {
            return XINPUT_POLL_INTERVAL;
        };
        earliest_probe = Some(earliest_probe.map_or(deadline, |earliest| earliest.min(deadline)));
    }
    earliest_probe.map_or(XINPUT_POLL_INTERVAL, |deadline| {
        deadline
            .saturating_duration_since(now)
            .max(XINPUT_POLL_INTERVAL)
    })
}

#[cfg(windows)]
use std::collections::HashSet;
#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use windows_sys::core::BOOL;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowLongW,
    GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    SetForegroundWindow, SetWindowPos, ShowWindow, ASFW_ANY, GWL_EXSTYLE, HWND_NOTOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_RESTORE, WS_EX_TOOLWINDOW,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowCandidate {
    pub window_handle: String,
    pub process_id: u32,
    pub area: i64,
    pub is_minimized: bool,
    pub is_tool_window: bool,
}

#[cfg(windows)]
fn parse_window_handle(window_handle: &str) -> Option<HWND> {
    let trimmed = window_handle.trim();
    if trimmed.is_empty() {
        return None;
    }

    let raw = if let Ok(signed) = trimmed.parse::<i64>() {
        if signed == 0 {
            return None;
        }
        signed as isize
    } else if let Ok(unsigned) = trimmed.parse::<u64>() {
        if unsigned == 0 {
            return None;
        }
        unsigned as usize as isize
    } else {
        return None;
    };

    Some(raw as HWND)
}

fn sort_window_candidates(candidates: &mut [WindowCandidate]) {
    candidates.sort_by(|left, right| {
        left.is_minimized
            .cmp(&right.is_minimized)
            .then_with(|| left.is_tool_window.cmp(&right.is_tool_window))
            .then_with(|| right.area.cmp(&left.area))
    });
}

#[cfg(windows)]
pub fn get_foreground_window() -> Option<(String, u32)> {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(window, &mut process_id);
        if process_id == 0 {
            return None;
        }

        Some(((window as isize as i64).to_string(), process_id))
    }
}

#[cfg(not(windows))]
pub fn get_foreground_window() -> Option<(String, u32)> {
    None
}

#[cfg(windows)]
pub fn allow_set_foreground_window(process_id: Option<u32>) -> bool {
    unsafe { AllowSetForegroundWindow(process_id.unwrap_or(ASFW_ANY)) != 0 }
}

#[cfg(not(windows))]
pub fn allow_set_foreground_window(_process_id: Option<u32>) -> bool {
    false
}

#[cfg(windows)]
fn is_window_cloaked(window: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let hr = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED as _,
            &mut cloaked as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    hr == 0 && cloaked != 0
}

#[cfg(windows)]
struct EnumWindowsContext {
    target_pids: HashSet<u32>,
    candidates: Vec<WindowCandidate>,
}

#[cfg(windows)]
unsafe extern "system" fn collect_matching_window(window: HWND, lparam: LPARAM) -> BOOL {
    let context = &mut *(lparam as *mut EnumWindowsContext);

    if IsWindowVisible(window) == 0 {
        return 1;
    }

    let mut process_id = 0u32;
    GetWindowThreadProcessId(window, &mut process_id);
    if process_id == 0 || !context.target_pids.contains(&process_id) {
        return 1;
    }

    if is_window_cloaked(window) {
        return 1;
    }

    let is_minimized = IsIconic(window) != 0;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if GetWindowRect(window, &mut rect) == 0 {
        return 1;
    }

    let width = i64::from(rect.right - rect.left).max(0);
    let height = i64::from(rect.bottom - rect.top).max(0);
    let area = width.saturating_mul(height);
    if !is_minimized && (width == 0 || height == 0) {
        return 1;
    }

    let ex_style = GetWindowLongW(window, GWL_EXSTYLE) as u32;
    let is_tool_window = (ex_style & WS_EX_TOOLWINDOW) != 0;

    context.candidates.push(WindowCandidate {
        window_handle: (window as isize as i64).to_string(),
        process_id,
        area,
        is_minimized,
        is_tool_window,
    });

    1
}

#[cfg(windows)]
pub fn find_windows_by_process_ids(process_ids: &[u32]) -> Vec<WindowCandidate> {
    let target_pids: HashSet<u32> = process_ids.iter().copied().filter(|pid| *pid > 0).collect();
    if target_pids.is_empty() {
        return Vec::new();
    }

    let mut context = EnumWindowsContext {
        target_pids,
        candidates: Vec::new(),
    };

    unsafe {
        EnumWindows(
            Some(collect_matching_window),
            &mut context as *mut EnumWindowsContext as LPARAM,
        );
    }

    sort_window_candidates(&mut context.candidates);
    context.candidates
}

#[cfg(not(windows))]
pub fn find_windows_by_process_ids(_process_ids: &[u32]) -> Vec<WindowCandidate> {
    Vec::new()
}

#[cfg(windows)]
pub fn focus_window(window_handle: &str, lower_window_handle: Option<&str>) -> bool {
    let Some(target) = parse_window_handle(window_handle) else {
        return false;
    };

    unsafe {
        if IsWindow(target) == 0 {
            return false;
        }

        let lower_window = lower_window_handle
            .and_then(parse_window_handle)
            .filter(|hwnd| *hwnd != target && IsWindow(*hwnd) != 0);

        if IsIconic(target) != 0 {
            ShowWindow(target, SW_RESTORE);
        }

        if let Some(lower_hwnd) = lower_window {
            SetWindowPos(
                lower_hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            SetWindowPos(
                lower_hwnd,
                target,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }

        BringWindowToTop(target);
        if SetForegroundWindow(target) == 0 || GetForegroundWindow() != target {
            let fg_window = GetForegroundWindow();
            let fg_thread = if fg_window.is_null() {
                0
            } else {
                GetWindowThreadProcessId(fg_window, std::ptr::null_mut())
            };
            let current_thread = GetCurrentThreadId();
            let target_thread = GetWindowThreadProcessId(target, std::ptr::null_mut());

            let attached_fg = fg_thread != 0
                && fg_thread != current_thread
                && AttachThreadInput(current_thread, fg_thread, 1) != 0;
            let attached_target = target_thread != 0
                && target_thread != current_thread
                && target_thread != fg_thread
                && AttachThreadInput(current_thread, target_thread, 1) != 0;

            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetFocus(target);

            if attached_target {
                AttachThreadInput(current_thread, target_thread, 0);
            }
            if attached_fg {
                AttachThreadInput(current_thread, fg_thread, 0);
            }
        }

        if let Some(lower_hwnd) = lower_window {
            SetWindowPos(
                lower_hwnd,
                target,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }

        GetForegroundWindow() == target
    }
}

#[cfg(not(windows))]
pub fn focus_window(_window_handle: &str, _lower_window_handle: Option<&str>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{sort_window_candidates, WindowCandidate};

    #[test]
    fn sorts_non_minimized_non_tool_largest_windows_first() {
        let mut candidates = vec![
            WindowCandidate {
                window_handle: "1".to_string(),
                process_id: 10,
                area: 2_000_000,
                is_minimized: true,
                is_tool_window: false,
            },
            WindowCandidate {
                window_handle: "2".to_string(),
                process_id: 10,
                area: 500_000,
                is_minimized: false,
                is_tool_window: true,
            },
            WindowCandidate {
                window_handle: "3".to_string(),
                process_id: 10,
                area: 100_000,
                is_minimized: false,
                is_tool_window: false,
            },
            WindowCandidate {
                window_handle: "4".to_string(),
                process_id: 10,
                area: 2_073_600,
                is_minimized: false,
                is_tool_window: false,
            },
        ];

        sort_window_candidates(&mut candidates);

        let handles: Vec<&str> = candidates
            .iter()
            .map(|candidate| candidate.window_handle.as_str())
            .collect();
        assert_eq!(handles, vec!["4", "3", "2", "1"]);
    }
}

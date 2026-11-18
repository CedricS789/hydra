use super::binding::gamepad;

pub const SONY_VENDOR_ID: u16 = 0x054C;
pub const NINTENDO_VENDOR_ID: u16 = 0x057E;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HidControllerKind {
    DualSense,
    DualShock4,
    SwitchPro,
    Generic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HidTransport {
    Usb,
    Bluetooth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControllerLedState {
    Off,
    Idle([u8; 3]),
    Active([u8; 3]),
    PausedForGame,
}

pub fn scale_idle_led_rgb(base: [u8; 3]) -> [u8; 3] {
    base.map(|channel| {
        if channel == 0 {
            0
        } else {
            ((u16::from(channel) * 28) / 100).max(1) as u8
        }
    })
}

impl ControllerLedState {
    pub fn rgb(self) -> Option<[u8; 3]> {
        match self {
            // Subtle glow when idle on desktop/tray; full configured color inside Big Picture.
            Self::Idle(color) => Some(scale_idle_led_rgb(color)),
            Self::Active(color) => Some(color),
            Self::Off => Some([0, 0, 0]),
            Self::PausedForGame => None,
        }
    }

    pub fn player_leds(self) -> u8 {
        match self {
            Self::Idle(_) | Self::Active(_) => 0x04,
            Self::Off | Self::PausedForGame => 0x00,
        }
    }
}

pub fn classify_hid_controller(vendor_id: u16, product_id: u16) -> HidControllerKind {
    match (vendor_id, product_id) {
        (SONY_VENDOR_ID, 0x0CE6 | 0x0DF2) => HidControllerKind::DualSense,
        (SONY_VENDOR_ID, 0x05C4 | 0x09CC) => HidControllerKind::DualShock4,
        (NINTENDO_VENDOR_ID, 0x2009) => HidControllerKind::SwitchPro,
        _ => HidControllerKind::Generic,
    }
}

pub fn detect_hid_transport(input_len: u16, output_len: u16) -> HidTransport {
    if input_len > 64 || output_len > 64 {
        HidTransport::Bluetooth
    } else {
        HidTransport::Usb
    }
}

/// Windows exposes XInput controllers through both XInput and Raw Input HID
/// (`IG_XX` in the device path). Skipping `IG_` devices avoids double triggers.
pub fn is_xinput_raw_device_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.windows(3).any(|window| {
        (window[0] == b'I' || window[0] == b'i')
            && (window[1] == b'G' || window[1] == b'g')
            && window[2] == b'_'
    })
}

pub fn hat_to_dpad_mask(hat: u32, logical_min: i32) -> u32 {
    let normalized = (hat as i32) - logical_min;
    match normalized {
        0 => gamepad::DPAD_UP,
        1 => gamepad::DPAD_UP | gamepad::DPAD_RIGHT,
        2 => gamepad::DPAD_RIGHT,
        3 => gamepad::DPAD_DOWN | gamepad::DPAD_RIGHT,
        4 => gamepad::DPAD_DOWN,
        5 => gamepad::DPAD_DOWN | gamepad::DPAD_LEFT,
        6 => gamepad::DPAD_LEFT,
        7 => gamepad::DPAD_UP | gamepad::DPAD_LEFT,
        _ => 0,
    }
}

pub fn map_hid_usages(
    kind: HidControllerKind,
    button_usages: &[u16],
    consumer_usages: &[u16],
    hat_mask: u32,
) -> u32 {
    let mut mask = hat_mask;

    for &usage in button_usages {
        mask |= match kind {
            HidControllerKind::DualSense | HidControllerKind::DualShock4 => match usage {
                1 => gamepad::X,
                2 => gamepad::A,
                3 => gamepad::B,
                4 => gamepad::Y,
                5 => gamepad::LB,
                6 => gamepad::RB,
                7 => gamepad::LT,
                8 => gamepad::RT,
                9 => gamepad::BACK,
                10 => gamepad::START,
                11 => gamepad::LS,
                12 => gamepad::RS,
                13 => gamepad::HOME,
                _ => 0,
            },
            HidControllerKind::SwitchPro => match usage {
                1 => gamepad::B,
                2 => gamepad::A,
                3 => gamepad::Y,
                4 => gamepad::X,
                5 => gamepad::LB,
                6 => gamepad::RB,
                7 => gamepad::LT,
                8 => gamepad::RT,
                9 => gamepad::BACK,
                10 => gamepad::START,
                11 => gamepad::LS,
                12 => gamepad::RS,
                13 => gamepad::HOME,
                _ => 0,
            },
            HidControllerKind::Generic => match usage {
                1 => gamepad::A,
                2 => gamepad::B,
                3 => gamepad::X,
                4 => gamepad::Y,
                5 => gamepad::LB,
                6 => gamepad::RB,
                7 => gamepad::LT,
                8 => gamepad::RT,
                9 => gamepad::BACK,
                10 => gamepad::START,
                11 => gamepad::LS,
                12 => gamepad::RS,
                13 => gamepad::HOME,
                _ => 0,
            },
        };
    }

    // Consumer Control AC Home (0x0223) when exposed by generic/Bluetooth controllers.
    if consumer_usages.contains(&0x0223) {
        mask |= gamepad::HOME;
    }

    mask
}

pub fn decode_sony_bluetooth_report(kind: HidControllerKind, report: &[u8]) -> Option<u32> {
    match kind {
        HidControllerKind::DualSense if report.first() == Some(&0x31) && report.len() >= 12 => {
            Some(decode_sony_button_bytes(report[9], report[10], report[11]))
        }
        HidControllerKind::DualShock4 if report.first() == Some(&0x11) && report.len() >= 10 => {
            Some(decode_sony_button_bytes(report[7], report[8], report[9]))
        }
        _ => None,
    }
}

fn decode_sony_button_bytes(b0: u8, b1: u8, b2: u8) -> u32 {
    let mut mask = hat_to_dpad_mask(u32::from(b0 & 0x0F), 0);
    if b0 & 0x10 != 0 {
        mask |= gamepad::X;
    }
    if b0 & 0x20 != 0 {
        mask |= gamepad::A;
    }
    if b0 & 0x40 != 0 {
        mask |= gamepad::B;
    }
    if b0 & 0x80 != 0 {
        mask |= gamepad::Y;
    }
    if b1 & 0x01 != 0 {
        mask |= gamepad::LB;
    }
    if b1 & 0x02 != 0 {
        mask |= gamepad::RB;
    }
    if b1 & 0x04 != 0 {
        mask |= gamepad::LT;
    }
    if b1 & 0x08 != 0 {
        mask |= gamepad::RT;
    }
    if b1 & 0x10 != 0 {
        mask |= gamepad::BACK;
    }
    if b1 & 0x20 != 0 {
        mask |= gamepad::START;
    }
    if b1 & 0x40 != 0 {
        mask |= gamepad::LS;
    }
    if b1 & 0x80 != 0 {
        mask |= gamepad::RS;
    }
    if b2 & 0x01 != 0 {
        mask |= gamepad::HOME;
    }
    mask
}

pub fn sony_bt_crc32(report_without_crc: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in std::iter::once(&0xA2u8).chain(report_without_crc.iter()) {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

pub fn build_sony_led_report(
    kind: HidControllerKind,
    transport: HidTransport,
    output_len: usize,
    rgb: [u8; 3],
    player_leds: u8,
) -> Option<Vec<u8>> {
    match (kind, transport) {
        (HidControllerKind::DualSense, HidTransport::Usb) => {
            let len = output_len.max(48);
            let mut buf = vec![0u8; len];
            buf[0] = 0x02;
            write_dualsense_common(&mut buf[1..48], rgb, player_leds);
            Some(buf)
        }
        (HidControllerKind::DualSense, HidTransport::Bluetooth) => {
            let len = output_len.max(78);
            let mut buf = vec![0u8; len];
            buf[0] = 0x31;
            buf[1] = 0x02;
            write_dualsense_common(&mut buf[2..49], rgb, player_leds);
            let crc = sony_bt_crc32(&buf[..74]).to_le_bytes();
            buf[74..78].copy_from_slice(&crc);
            Some(buf)
        }
        (HidControllerKind::DualShock4, HidTransport::Usb) => {
            let len = output_len.max(32);
            let mut buf = vec![0u8; len];
            buf[0] = 0x05;
            buf[1] = 0x02;
            buf[6] = rgb[0];
            buf[7] = rgb[1];
            buf[8] = rgb[2];
            Some(buf)
        }
        (HidControllerKind::DualShock4, HidTransport::Bluetooth) => {
            let len = output_len.max(78);
            let mut buf = vec![0u8; len];
            buf[0] = 0x11;
            buf[1] = 0xC0;
            buf[2] = 0x20;
            buf[3] = 0x02;
            buf[8] = rgb[0];
            buf[9] = rgb[1];
            buf[10] = rgb[2];
            let crc = sony_bt_crc32(&buf[..74]).to_le_bytes();
            buf[74..78].copy_from_slice(&crc);
            Some(buf)
        }
        _ => None,
    }
}

fn write_dualsense_common(common: &mut [u8], rgb: [u8; 3], player_leds: u8) {
    // valid_flag1: bit 2 = lightbar control, bit 4 = player indicator LEDs.
    common[1] = 0x04 | 0x10;
    // valid_flag2: bit 1 = lightbar setup control (turn lightbar on/off cleanly).
    common[39] = 0x02;
    common[41] = if rgb == [0, 0, 0] { 0x01 } else { 0x02 };
    common[42] = 0x00;
    common[43] = player_leds;
    common[44] = rgb[0];
    common[45] = rgb[1];
    common[46] = rgb[2];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_xinput_ig_device_paths() {
        assert!(is_xinput_raw_device_name(
            r"\\?\HID#VID_045E&PID_02FF&IG_00#7&123456&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        ));
        assert!(is_xinput_raw_device_name(r"\\?\hid#vid_045e&ig_01"));
        assert!(!is_xinput_raw_device_name(
            r"\\?\HID#VID_054C&PID_0CE6#8&123456&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        ));
    }

    #[test]
    fn maps_dualsense_and_switch_pro_hid_buttons_including_home() {
        assert_eq!(
            map_hid_usages(HidControllerKind::DualSense, &[2, 13], &[], 0),
            gamepad::A | gamepad::HOME
        );
        assert_eq!(
            map_hid_usages(HidControllerKind::SwitchPro, &[1, 2, 13], &[], 0),
            gamepad::B | gamepad::A | gamepad::HOME
        );
        assert_eq!(
            map_hid_usages(
                HidControllerKind::Generic,
                &[],
                &[0x0223],
                hat_to_dpad_mask(2, 0)
            ),
            gamepad::HOME | gamepad::DPAD_RIGHT
        );
    }

    #[test]
    fn decodes_sony_bluetooth_enhanced_reports() {
        let mut ds_bt = [0u8; 12];
        ds_bt[0] = 0x31;
        ds_bt[9] = 0x20 | 0x08; // Cross (A) + neutral-ish? 0x08 = neutral hat
        ds_bt[10] = 0x10; // Create (BACK)
        ds_bt[11] = 0x01; // PS (HOME)
        assert_eq!(
            decode_sony_bluetooth_report(HidControllerKind::DualSense, &ds_bt),
            Some(gamepad::A | gamepad::BACK | gamepad::HOME)
        );

        let mut ds4_bt = [0u8; 10];
        ds4_bt[0] = 0x11;
        ds4_bt[7] = 0x08;
        ds4_bt[9] = 0x01;
        assert_eq!(
            decode_sony_bluetooth_report(HidControllerKind::DualShock4, &ds4_bt),
            Some(gamepad::HOME)
        );
    }

    #[test]
    fn builds_dualsense_and_ds4_led_reports_with_valid_crc() {
        let usb = build_sony_led_report(
            HidControllerKind::DualSense,
            HidTransport::Usb,
            64,
            [28, 154, 246],
            0x04,
        )
        .unwrap();
        assert_eq!(usb.len(), 64);
        assert_eq!(usb[0], 0x02);
        assert_eq!(usb[2], 0x14);
        assert_eq!(usb[44], 0x04);
        assert_eq!(&usb[45..48], &[28, 154, 246]);

        let bt = build_sony_led_report(
            HidControllerKind::DualSense,
            HidTransport::Bluetooth,
            78,
            [28, 154, 246],
            0x04,
        )
        .unwrap();
        assert_eq!(bt.len(), 78);
        assert_eq!(bt[0], 0x31);
        assert_eq!(bt[1], 0x02);
        assert_eq!(&bt[46..49], &[28, 154, 246]);
        let expected_crc = sony_bt_crc32(&bt[..74]).to_le_bytes();
        assert_eq!(&bt[74..78], &expected_crc);

        let ds4_bt = build_sony_led_report(
            HidControllerKind::DualShock4,
            HidTransport::Bluetooth,
            78,
            [12, 54, 96],
            0,
        )
        .unwrap();
        assert_eq!(ds4_bt[0], 0x11);
        assert_eq!(&ds4_bt[8..11], &[12, 54, 96]);
        assert_eq!(
            &ds4_bt[74..78],
            &sony_bt_crc32(&ds4_bt[..74]).to_le_bytes()
        );
    }

    #[test]
    fn scales_custom_and_preset_led_colors_for_idle_and_active() {
        assert_eq!(scale_idle_led_rgb([0, 112, 209]), [0, 31, 58]);
        assert_eq!(scale_idle_led_rgb([255, 77, 109]), [71, 21, 30]);
        assert_eq!(scale_idle_led_rgb([2, 0, 1]), [1, 0, 1]);
        assert_eq!(
            ControllerLedState::Active([0, 112, 209]).rgb(),
            Some([0, 112, 209])
        );
        assert_eq!(
            ControllerLedState::Idle([0, 112, 209]).rgb(),
            Some([0, 31, 58])
        );
        assert_eq!(ControllerLedState::Off.rgb(), Some([0, 0, 0]));
        assert_eq!(ControllerLedState::PausedForGame.rgb(), None);
    }
}

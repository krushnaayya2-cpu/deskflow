//! System audio output: master volume and the live peak level that drives
//! the audio-reactive visualizers. Uses the default playback device.

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use windows::Win32::{
        Media::Audio::{
            eMultimedia, eRender,
            Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
            IMMDeviceEnumerator, MMDeviceEnumerator,
        },
        System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
    };

    thread_local! {
        static DEV: RefCell<Option<(IAudioMeterInformation, IAudioEndpointVolume)>> = const { RefCell::new(None) };
    }

    fn with<T>(f: impl FnOnce(&IAudioMeterInformation, &IAudioEndpointVolume) -> Option<T>) -> Option<T> {
        DEV.with(|d| {
            let mut d = d.borrow_mut();
            if d.is_none() {
                *d = unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                    (|| {
                        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
                        let dev = en.GetDefaultAudioEndpoint(eRender, eMultimedia).ok()?;
                        let meter: IAudioMeterInformation = dev.Activate(CLSCTX_ALL, None).ok()?;
                        let vol: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None).ok()?;
                        Some((meter, vol))
                    })()
                };
            }
            let r = d.as_ref().and_then(|(m, v)| f(m, v));
            if r.is_none() {
                *d = None; // device may have changed; reconnect next time
            }
            r
        })
    }

    pub fn peak() -> f32 {
        with(|m, _| unsafe { m.GetPeakValue().ok() }).unwrap_or(0.0)
    }

    pub fn volume() -> f32 {
        with(|_, v| unsafe { v.GetMasterVolumeLevelScalar().ok() }).unwrap_or(0.0)
    }

    pub fn set_volume(level: f32) -> Result<(), String> {
        with(|_, v| unsafe { v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null()).ok() })
            .ok_or_else(|| "Couldn't change the volume".to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn peak() -> f32 {
        0.0
    }
    pub fn volume() -> f32 {
        0.0
    }
    pub fn set_volume(_level: f32) -> Result<(), String> {
        Err("Only supported on Windows".into())
    }
}

pub use imp::*;

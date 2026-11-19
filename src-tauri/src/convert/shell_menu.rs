//! "Convert with DeskFlow" in the right-click menu of supported files.
//! Registered per user (HKCU), so no admin rights are needed. On Windows 11
//! it appears under "Show more options".

const VERB: &str = "DeskFlowConvert";

#[cfg(windows)]
pub fn install(exe: &str) -> std::io::Result<()> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for ext in super::SUPPORTED_EXTS {
        let (key, _) = hkcu.create_subkey(format!(r"Software\Classes\SystemFileAssociations\.{ext}\shell\{VERB}"))?;
        key.set_value("MUIVerb", &"Convert with DeskFlow")?;
        key.set_value("Icon", &format!("\"{exe}\",0"))?;
        key.set_value("MultiSelectModel", &"Player")?;
        let (cmd, _) = key.create_subkey("command")?;
        cmd.set_value("", &format!("\"{exe}\" --convert \"%1\""))?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn uninstall() -> std::io::Result<()> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for ext in super::SUPPORTED_EXTS {
        let _ = hkcu.delete_subkey_all(format!(r"Software\Classes\SystemFileAssociations\.{ext}\shell\{VERB}"));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn install(_exe: &str) -> std::io::Result<()> {
    let _ = VERB;
    Ok(())
}

#[cfg(not(windows))]
pub fn uninstall() -> std::io::Result<()> {
    Ok(())
}

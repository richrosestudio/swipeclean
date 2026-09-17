use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use fs2::FileExt;
use serde::{Deserialize, Serialize};

pub const DEFAULT_RECENT_HOURS: u64 = 24;
const MAX_SKIP_ROWS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    System,
    InUse,
    Recent,
    UserFolder,
    UserExt,
    UserName,
    Vcs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionSettings {
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub folder_names: Vec<String>,
    #[serde(default = "default_recent_hours")]
    pub recent_hours: u64,
}

fn default_recent_hours() -> u64 {
    DEFAULT_RECENT_HOURS
}

impl Default for ProtectionSettings {
    fn default() -> Self {
        Self {
            folders: Vec::new(),
            extensions: Vec::new(),
            folder_names: Vec::new(),
            recent_hours: DEFAULT_RECENT_HOURS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkipEntry {
    pub reason: SkipReason,
    pub path: String,
    pub detail: Option<String>,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkipCounts {
    pub system: u64,
    pub in_use: u64,
    pub recent: u64,
    pub user_folder: u64,
    pub user_ext: u64,
    pub user_name: u64,
    pub vcs: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkipSummary {
    pub total: u64,
    pub counts: SkipCounts,
    pub entries: Vec<SkipEntry>,
    pub broad_rule_warning: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootCheck {
    pub allowed: bool,
    pub applications_warning: bool,
    pub message: Option<String>,
}

#[derive(Debug, Default)]
pub struct SkipLog {
    total: u64,
    counts: SkipCounts,
    groups: HashMap<(SkipReason, String), (u64, Option<String>)>,
}

impl SkipLog {
    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn add(&mut self, reason: SkipReason, path: &Path, detail: Option<String>) {
        self.total += 1;
        match reason {
            SkipReason::System => self.counts.system += 1,
            SkipReason::InUse => self.counts.in_use += 1,
            SkipReason::Recent => self.counts.recent += 1,
            SkipReason::UserFolder => self.counts.user_folder += 1,
            SkipReason::UserExt => self.counts.user_ext += 1,
            SkipReason::UserName => self.counts.user_name += 1,
            SkipReason::Vcs => self.counts.vcs += 1,
        }
        let key = group_key(reason, path);
        let entry = self.groups.entry((reason, key)).or_insert((0, detail));
        entry.0 += 1;
    }

    pub fn finish(self, files_found: u64) -> SkipSummary {
        let mut entries: Vec<SkipEntry> = self
            .groups
            .into_iter()
            .map(|((reason, path), (count, detail))| SkipEntry {
                reason,
                path,
                detail,
                count,
            })
            .collect();
        entries.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.path.cmp(&b.path)));
        entries.truncate(MAX_SKIP_ROWS);
        let seen = self.total + files_found;
        let broad_rule_warning = seen > 50 && self.total * 5 > seen * 4;
        SkipSummary {
            total: self.total,
            counts: self.counts,
            entries,
            broad_rule_warning,
        }
    }
}

fn group_key(reason: SkipReason, path: &Path) -> String {
    match reason {
        SkipReason::Vcs | SkipReason::UserName | SkipReason::UserFolder | SkipReason::System => {
            path.to_string_lossy().into_owned()
        }
        _ => path
            .parent()
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned(),
    }
}

pub struct ProtectContext {
    system_roots: Vec<PathBuf>,
    user_roots: Vec<PathBuf>,
    extensions: Vec<String>,
    folder_names: Vec<String>,
    recent_window: Option<Duration>,
}

impl ProtectContext {
    pub fn from_settings(settings: ProtectionSettings) -> Self {
        let system_roots = system_protected_paths();
        let user_roots: Vec<PathBuf> = settings
            .folders
            .iter()
            .filter_map(|p| canonicalize_existing(Path::new(p)))
            .collect();
        let extensions = settings
            .extensions
            .iter()
            .map(|ext| normalize_extension(ext))
            .filter(|ext| !ext.is_empty())
            .collect();
        let folder_names = settings
            .folder_names
            .iter()
            .map(|name| name.trim().to_ascii_lowercase())
            .filter(|name| !name.is_empty())
            .collect();
        let recent_window = if settings.recent_hours == 0 {
            None
        } else {
            Some(Duration::from_secs(settings.recent_hours.saturating_mul(3600)))
        };
        Self {
            system_roots,
            user_roots,
            extensions,
            folder_names,
            recent_window,
        }
    }

    pub fn load_from_config_dir(config_dir: &Path) -> Self {
        Self::from_settings(load_settings(config_dir))
    }
}

pub fn config_file(config_dir: &Path) -> PathBuf {
    config_dir.join("protection.json")
}

pub fn load_settings(config_dir: &Path) -> ProtectionSettings {
    let path = config_file(config_dir);
    let Ok(bytes) = fs::read(&path) else {
        return ProtectionSettings::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn save_settings(config_dir: &Path, settings: ProtectionSettings) -> Result<ProtectionSettings, String> {
    let cleaned = validate_settings(settings)?;
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let path = config_file(config_dir);
    let json = serde_json::to_vec_pretty(&cleaned).map_err(|e| e.to_string())?;
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(&json).map_err(|e| e.to_string())?;
    Ok(cleaned)
}

pub fn validate_settings(mut settings: ProtectionSettings) -> Result<ProtectionSettings, String> {
    let mut folders = Vec::new();
    for folder in settings.folders {
        let trimmed = folder.trim();
        if trimmed.is_empty() {
            continue;
        }
        if is_wildcard(trimmed) {
            return Err("That folder rule would match too much. Choose a specific folder.".into());
        }
        folders.push(trimmed.to_string());
    }

    let mut extensions = Vec::new();
    for ext in settings.extensions {
        let normalized = normalize_extension(&ext);
        if normalized.is_empty() {
            continue;
        }
        if is_wildcard(&normalized) || !is_simple_extension(&normalized) {
            return Err("Extensions must be simple types like psd, not wildcards.".into());
        }
        if !extensions.contains(&normalized) {
            extensions.push(normalized);
        }
    }

    let mut folder_names = Vec::new();
    for name in settings.folder_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "." || trimmed == ".." || is_wildcard(trimmed) {
            return Err("That folder name would match too much.".into());
        }
        let key = trimmed.to_string();
        if !folder_names.iter().any(|existing: &String| existing.eq_ignore_ascii_case(&key)) {
            folder_names.push(key);
        }
    }

    settings.folders = folders;
    settings.extensions = extensions;
    settings.folder_names = folder_names;
    Ok(settings)
}

fn is_wildcard(value: &str) -> bool {
    let t = value.trim();
    t == "*" || t == "*.*" || t == ".*" || t == "*.*"
}

fn is_simple_extension(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=12).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric())
}

fn normalize_extension(value: &str) -> String {
    value.trim().trim_start_matches('.').to_ascii_lowercase()
}

pub fn check_scan_root(path: &Path) -> RootCheck {
    let blocked_msg = "This folder is protected and can't be scanned. Choose a different folder or adjust protected-folder settings.";
    if is_applications_path(path) {
        return RootCheck {
            allowed: true,
            applications_warning: true,
            message: Some(
                "This is the Applications folder. You can scan it, but files in use and OS-owned items will be skipped."
                    .into(),
            ),
        };
    }
    if dir_is_hard_protected(path) {
        return RootCheck {
            allowed: false,
            applications_warning: false,
            message: Some(blocked_msg.into()),
        };
    }
    RootCheck {
        allowed: true,
        applications_warning: false,
        message: None,
    }
}

pub fn is_vcs_dir_name(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), ".git" | ".svn" | ".hg")
}

pub fn skip_directory(ctx: &ProtectContext, path: &Path) -> Option<(SkipReason, Option<String>)> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if is_vcs_dir_name(&name) {
        return Some((SkipReason::Vcs, Some("version control internals".into())));
    }
    if folder_name_blocked(ctx, path) {
        return Some((SkipReason::UserName, Some(format!("folder named {name}"))));
    }
    if let Some(reason) = path_protection(ctx, path) {
        return Some(reason);
    }
    None
}

pub fn skip_file(
    ctx: &ProtectContext,
    path: &Path,
    mtime: Option<SystemTime>,
) -> Option<(SkipReason, Option<String>)> {
    if let Some(reason) = path_protection(ctx, path) {
        return Some(reason);
    }
    if folder_name_blocked(ctx, path) {
        let name = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Some((SkipReason::UserName, Some(format!("folder named {name}"))));
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ext.is_empty() && ctx.extensions.iter().any(|rule| rule == &ext) {
        return Some((SkipReason::UserExt, Some(format!(".{ext} files"))));
    }
    if let (Some(window), Some(modified)) = (ctx.recent_window, mtime) {
        if let Ok(age) = SystemTime::now().duration_since(modified) {
            if age <= window {
                return Some((SkipReason::Recent, Some("modified recently".into())));
            }
        } else {
            return Some((SkipReason::Recent, Some("modified recently".into())));
        }
    }
    if let Some(detail) = file_in_use(path) {
        return Some((SkipReason::InUse, Some(detail)));
    }
    None
}

pub fn path_is_protected_for_trash(ctx: &ProtectContext, path: &Path) -> Option<SkipReason> {
    let mtime = fs::metadata(path).ok().and_then(|meta| meta.modified().ok());
    skip_file(ctx, path, mtime).map(|(reason, _)| reason)
}

fn path_protection(ctx: &ProtectContext, path: &Path) -> Option<(SkipReason, Option<String>)> {
    let resolved = canonicalize_existing(path).unwrap_or_else(|| path.to_path_buf());
    if is_applications_path(&resolved) {
        return None;
    }
    if ctx.system_roots.iter().any(|root| is_under(&resolved, root)) {
        return Some((SkipReason::System, Some("system location".into())));
    }
    if ctx.user_roots.iter().any(|root| is_under(&resolved, root)) {
        return Some((SkipReason::UserFolder, Some("protected folder".into())));
    }
    None
}

fn folder_name_blocked(ctx: &ProtectContext, path: &Path) -> bool {
    if ctx.folder_names.is_empty() {
        return false;
    }
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        ctx.folder_names.iter().any(|rule| rule == &name)
    })
}

fn dir_is_hard_protected(path: &Path) -> bool {
    if is_applications_path(path) {
        return false;
    }
    let roots = system_protected_paths();
    let resolved = canonicalize_existing(path).unwrap_or_else(|| path.to_path_buf());
    roots.iter().any(|root| is_under(&resolved, root))
}

pub fn is_applications_path(path: &Path) -> bool {
    let normalized = normalize_path_display(path);
    normalized == "/applications" || normalized.starts_with("/applications/")
}

fn normalize_path_display(path: &Path) -> String {
    let resolved = canonicalize_existing(path).unwrap_or_else(|| path.to_path_buf());
    resolved.to_string_lossy().replace('\\', "/").to_ascii_lowercase()
}

fn is_under(path: &Path, root: &Path) -> bool {
    let path_n = normalize_cmp(path);
    let root_n = normalize_cmp(root);
    path_n == root_n || path_n.starts_with(&format!("{root_n}/"))
}

fn normalize_cmp(path: &Path) -> String {
    let mut text = path.to_string_lossy().replace('\\', "/");
    while text.ends_with('/') && text.len() > 1 {
        text.pop();
    }
    #[cfg(windows)]
    {
        text = text.to_ascii_lowercase();
    }
    #[cfg(target_os = "macos")]
    {
        text = text.to_ascii_lowercase();
    }
    text
}

fn canonicalize_existing(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn file_in_use(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    match file.try_lock_exclusive() {
        Ok(()) => {
            let _ = file.unlock();
            None
        }
        Err(error) if error.kind() == io::ErrorKind::WouldBlock || is_lock_denied(&error) => {
            Some(locker_detail(path))
        }
        Err(_) => None,
    }
}

fn is_lock_denied(error: &io::Error) -> bool {
    let text = error.to_string().to_ascii_lowercase();
    text.contains("lock") || text.contains("sharing") || text.contains("being used")
}

fn locker_detail(path: &Path) -> String {
    if let Some(name) = locker_process_name(path) {
        format!("in use by {name}")
    } else {
        "in use by another app".into()
    }
}

fn locker_process_name(path: &Path) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-F", "c", "--"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().find_map(|line| {
        let rest = line.strip_prefix('c')?;
        let name = rest.trim();
        if name.is_empty() || name == "lsof" {
            None
        } else {
            Some(name.to_string())
        }
    })
}

pub fn system_protected_paths() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        use known_folders::{get_known_folder_path, KnownFolder};
        for folder in [
            KnownFolder::Windows,
            KnownFolder::ProgramFiles,
            KnownFolder::ProgramFilesX86,
            KnownFolder::ProgramData,
            KnownFolder::RoamingAppData,
        ] {
            if let Some(path) = get_known_folder_path(folder) {
                roots.push(path);
            }
        }
        if let Some(local) = get_known_folder_path(KnownFolder::LocalAppData) {
            roots.push(local.join("Microsoft"));
        }
    }

    #[cfg(not(windows))]
    {
        for p in [
            "/System",
            "/Library",
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/private/etc",
            "/lib",
            "/lib64",
            "/boot",
            "/proc",
            "/sys",
            "/dev",
        ] {
            let path = PathBuf::from(p);
            if path.exists() {
                roots.push(canonicalize_existing(&path).unwrap_or(path));
            }
        }
        if let Some(home) = dirs::home_dir() {
            let library = home.join("Library");
            for name in [
                "Application Support",
                "Preferences",
                "Keychains",
                "Mail",
                "Containers",
                "Group Containers",
                "Safari",
                "Accounts",
            ] {
                let path = library.join(name);
                if path.exists() {
                    roots.push(canonicalize_existing(&path).unwrap_or(path));
                }
            }
        }
    }

    roots.sort();
    roots.dedup();
    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "swipeclean-protect-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_wildcard_rules() {
        let settings = ProtectionSettings {
            extensions: vec!["*".into()],
            ..Default::default()
        };
        assert!(validate_settings(settings).is_err());
        let settings = ProtectionSettings {
            folder_names: vec!["*".into()],
            ..Default::default()
        };
        assert!(validate_settings(settings).is_err());
    }

    #[test]
    fn applications_root_is_allowed_with_warning() {
        let check = check_scan_root(Path::new("/Applications"));
        assert!(check.allowed);
        assert!(check.applications_warning);
    }

    #[test]
    fn system_root_is_blocked() {
        let roots = system_protected_paths();
        let Some(root) = roots.into_iter().find(|path| !is_applications_path(path)) else {
            return;
        };
        let check = check_scan_root(&root);
        assert!(!check.allowed);
        assert!(!check.applications_warning);
    }

    #[test]
    fn vcs_dir_is_skipped() {
        let ctx = ProtectContext::from_settings(ProtectionSettings::default());
        let git = Path::new("/tmp/project/.git");
        let skip = skip_directory(&ctx, git).unwrap();
        assert_eq!(skip.0, SkipReason::Vcs);
    }

    #[test]
    fn recent_mtime_is_skipped_by_default() {
        let ctx = ProtectContext::from_settings(ProtectionSettings::default());
        let dir = temp_dir("recent");
        let file = dir.join("notes.txt");
        fs::write(&file, b"hi").unwrap();
        let skip = skip_file(&ctx, &file, Some(SystemTime::now())).unwrap();
        assert_eq!(skip.0, SkipReason::Recent);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recent_rule_can_be_disabled() {
        let ctx = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            ..Default::default()
        });
        let dir = temp_dir("recent-off");
        let file = dir.join("notes.txt");
        fs::write(&file, b"hi").unwrap();
        assert!(skip_file(&ctx, &file, Some(SystemTime::now())).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn user_extension_rule_skips_file() {
        let ctx = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            extensions: vec!["psd".into()],
            ..Default::default()
        });
        let dir = temp_dir("ext");
        let file = dir.join("art.psd");
        fs::write(&file, b"ps").unwrap();
        let skip = skip_file(&ctx, &file, None).unwrap();
        assert_eq!(skip.0, SkipReason::UserExt);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_name_rule_skips_directory() {
        let ctx = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            folder_names: vec!["Archive".into()],
            ..Default::default()
        });
        let dir = temp_dir("names").join("Archive");
        fs::create_dir_all(&dir).unwrap();
        let skip = skip_directory(&ctx, &dir).unwrap();
        assert_eq!(skip.0, SkipReason::UserName);
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn symlink_into_protected_user_folder_is_skipped() {
        let ctx_dir = temp_dir("link-root");
        let protected = ctx_dir.join("keep");
        let other = ctx_dir.join("scan");
        fs::create_dir_all(&protected).unwrap();
        fs::create_dir_all(&other).unwrap();
        let target = protected.join("secret.txt");
        fs::write(&target, b"no").unwrap();
        let link = other.join("alias.txt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).unwrap();

        let ctx = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            folders: vec![protected.to_string_lossy().into_owned()],
            ..Default::default()
        });
        let skip = skip_file(&ctx, &link, None).unwrap();
        assert_eq!(skip.0, SkipReason::UserFolder);
        let _ = fs::remove_dir_all(&ctx_dir);
    }
}

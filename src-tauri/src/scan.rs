use std::cell::RefCell;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::protect::{
    check_scan_root, skip_directory, skip_file, ProtectContext, SkipLog,
};
use crate::types::{ScanComplete, ScanProgress, ScanRequest, ScannedFile};
use crate::AppState;

const EMIT_INTERVAL: Duration = Duration::from_millis(50);

pub fn classify_kind(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "bmp" | "tif" | "tiff"
        | "avif" | "svg" | "ico" | "raw" | "cr2" | "nef" | "arw" | "dng" => "image",
        "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm" | "wmv" | "flv" | "mpeg" | "mpg" | "3gp" => {
            "video"
        }
        "mp3" | "aac" | "m4a" | "wav" | "flac" | "ogg" | "opus" | "aiff" | "aif" | "wma" => "audio",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "rtf" | "md"
        | "pages" | "numbers" | "key" | "csv" | "odt" | "ods" => "document",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "dmg" | "iso" => "archive",
        _ => "other",
    }
}

pub fn is_trash_dir(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".trash" | ".trashes" | "$recycle.bin" | "recycle.bin" | "recycler"
    )
}

pub fn is_noise_file(name: &str) -> bool {
    matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini")
}

fn to_millis(time: SystemTime) -> Option<i64> {
    match time.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_millis()).ok(),
        Err(e) => i64::try_from(e.duration().as_millis())
            .ok()
            .map(|ms| -ms),
    }
}

fn scanned_from_meta(path: &Path, meta: &fs::Metadata) -> Option<ScannedFile> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    if is_noise_file(&name) {
        return None;
    }
    if !meta.is_file() {
        return None;
    }

    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = classify_kind(&extension).to_string();
    let mtime_ms = meta.modified().ok().and_then(to_millis);
    let atime_ms = meta.accessed().ok().and_then(to_millis);
    let atime_available = match (atime_ms, mtime_ms) {
        (Some(accessed), Some(modified)) => (accessed - modified).abs() > 2_000,
        (Some(_), None) => true,
        _ => false,
    };

    Some(ScannedFile {
        path: path.to_string_lossy().into_owned(),
        name,
        size: meta.len(),
        mtime_ms,
        atime_ms,
        atime_available,
        extension,
        kind,
    })
}

fn scanned_from_path(path: &Path) -> Option<ScannedFile> {
    let meta = fs::metadata(path).ok()?;
    scanned_from_meta(path, &meta)
}

pub fn scan_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ScanRequest,
) -> Result<ScanComplete, String> {
    state.cancel_scan.store(false, Ordering::SeqCst);

    let root = Path::new(&request.path);
    if !root.exists() {
        return Err("That folder no longer exists.".into());
    }
    if !root.is_dir() {
        return Err("Please choose a folder, not a file.".into());
    }

    let root_check = check_scan_root(root);
    if !root_check.allowed {
        return Err(root_check.message.unwrap_or_else(|| {
            "This folder is protected and can't be scanned. Choose a different folder or adjust protected-folder settings.".into()
        }));
    }

    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| {
            dirs::config_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("com.richrose.swipeclean")
        });
    let protect = ProtectContext::load_from_config_dir(&config_dir);
    let skip_log = RefCell::new(SkipLog::default());

    let mut walker = WalkDir::new(root).follow_links(false);
    if !request.recursive {
        walker = walker.max_depth(1);
    }
    let walker = walker.into_iter().filter_entry(|entry| {
        if entry.depth() == 0 {
            return true;
        }
        if entry.file_type().is_dir() {
            if is_trash_dir(&entry.file_name().to_string_lossy()) {
                return false;
            }
            if let Some((reason, detail)) = skip_directory(&protect, entry.path()) {
                skip_log.borrow_mut().add(reason, entry.path(), detail);
                return false;
            }
            if entry.path_is_symlink() {
                return false;
            }
            return true;
        }
        true
    });

    let mut files: Vec<ScannedFile> = Vec::new();
    let mut bytes_found: u64 = 0;
    let mut skipped: u64 = 0;
    let mut last_emit = Instant::now()
        .checked_sub(EMIT_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut current_path = request.path.clone();
    let mut cancelled = false;

    let emit_progress = |files_found: u64,
                         bytes_found: u64,
                         skipped: u64,
                         current_path: &str| {
        let _ = app.emit(
            "scan-progress",
            ScanProgress {
                files_found,
                bytes_found,
                skipped: skipped + skip_log.borrow().total(),
                current_path: current_path.to_string(),
            },
        );
    };

    emit_progress(0, 0, 0, &current_path);

    for entry in walker {
        if state.cancel_scan.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if entry.depth() == 0 {
            continue;
        }

        if entry.file_type().is_dir() {
            current_path = entry.path().to_string_lossy().into_owned();
            if last_emit.elapsed() >= EMIT_INTERVAL {
                emit_progress(files.len() as u64, bytes_found, skipped, &current_path);
                last_emit = Instant::now();
            }
            continue;
        }

        let meta = if entry.file_type().is_symlink() {
            fs::metadata(entry.path()).ok()
        } else {
            entry.metadata().ok()
        };
        let Some(meta) = meta else {
            skipped += 1;
            continue;
        };
        let Some(file) = scanned_from_meta(entry.path(), &meta) else {
            skipped += 1;
            continue;
        };

        if request.min_size > 0 && file.size < request.min_size {
            continue;
        }

        let mtime = meta.modified().ok();
        if let Some((reason, detail)) = skip_file(&protect, entry.path(), mtime) {
            skip_log.borrow_mut().add(reason, entry.path(), detail);
            continue;
        }

        bytes_found += file.size;
        current_path = file.path.clone();
        files.push(file);

        if last_emit.elapsed() >= EMIT_INTERVAL {
            emit_progress(files.len() as u64, bytes_found, skipped, &current_path);
            last_emit = Instant::now();
        }
    }

    emit_progress(files.len() as u64, bytes_found, skipped, &current_path);

    let skip_summary = skip_log.into_inner().finish(files.len() as u64);
    let skipped_total = skipped + skip_summary.total;

    if let Ok(mut last_scan) = state.last_scan.lock() {
        *last_scan = files.clone();
    }

    let complete = ScanComplete {
        files_found: files.len() as u64,
        bytes_found,
        skipped: skipped_total,
        cancelled,
        files,
        skip_summary,
    };
    Ok(complete)
}

pub fn cancel_scan(state: State<'_, AppState>) {
    state.cancel_scan.store(true, Ordering::SeqCst);
}

pub fn read_file_bytes(path: String, max_bytes: usize) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut reader = file.take(max_bytes as u64);
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protect::{skip_directory, ProtectContext, ProtectionSettings};

    #[test]
    fn classifies_common_extensions() {
        assert_eq!(classify_kind("png"), "image");
        assert_eq!(classify_kind("MP4"), "other"); // callers lowercase first
        assert_eq!(classify_kind("mp4"), "video");
        assert_eq!(classify_kind("pdf"), "document");
        assert_eq!(classify_kind("zip"), "archive");
        assert_eq!(classify_kind("exe"), "other");
    }

    #[test]
    fn reads_image_metadata_from_temp_file() {
        let dir = std::env::temp_dir().join(format!("swipeclean-scan-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("photo.png");
        std::fs::write(&file, b"\x89PNG\r\n\x1a\n").unwrap();
        let scanned = scanned_from_path(&file).expect("metadata");
        assert_eq!(scanned.kind, "image");
        assert_eq!(scanned.extension, "png");
        assert_eq!(scanned.size, 8);
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn skips_trash_and_noise() {
        assert!(is_trash_dir(".Trash"));
        assert!(is_trash_dir("$Recycle.Bin"));
        assert!(is_noise_file(".DS_Store"));
        assert!(!is_noise_file("photo.jpg"));
    }

    #[test]
    fn recursive_walk_includes_nested_small_files() {
        let dir = std::env::temp_dir().join(format!("swipeclean-nested-{}", std::process::id()));
        let nested = dir.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("top.txt"), b"hi").unwrap();
        std::fs::write(nested.join("deep.txt"), b"yo").unwrap();

        let mut names: Vec<String> = WalkDir::new(&dir)
            .follow_links(false)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| !entry.file_type().is_dir())
            .filter_map(|entry| scanned_from_path(entry.path()))
            .map(|file| file.name)
            .collect();
        names.sort();
        assert_eq!(names, ["deep.txt", "top.txt"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walker_does_not_descend_into_git() {
        let dir = std::env::temp_dir().join(format!("swipeclean-vcs-{}", std::process::id()));
        let git_obj = dir.join(".git").join("objects");
        std::fs::create_dir_all(&git_obj).unwrap();
        std::fs::write(git_obj.join("pack"), b"obj").unwrap();
        std::fs::write(dir.join("keep.txt"), b"ok").unwrap();
        let protect = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            ..Default::default()
        });

        let mut names: Vec<String> = WalkDir::new(&dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                if entry.depth() == 0 {
                    return true;
                }
                if entry.file_type().is_dir() {
                    return skip_directory(&protect, entry.path()).is_none();
                }
                true
            })
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["keep.txt"]);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

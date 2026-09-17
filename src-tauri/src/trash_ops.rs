use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::protect::{path_is_protected_for_trash, ProtectContext};
use crate::types::TrashItemResult;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashProgress {
    done: usize,
    total: usize,
    path: String,
}

fn humanize_error(error: trash::Error) -> String {
    let text = error.to_string();
    let lower = text.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("access") {
        "Permission denied".into()
    } else if lower.contains("not found")
        || lower.contains("no such")
        || lower.contains("cannot find")
        || lower.contains("os error 2")
    {
        "File already moved or missing".into()
    } else if lower.contains("busy")
        || lower.contains("in use")
        || lower.contains("being used")
        || lower.contains("locked")
    {
        "File in use".into()
    } else {
        text
    }
}

fn trash_one(ctx: &trash::TrashContext, protect: &ProtectContext, path: String) -> TrashItemResult {
    if let Some(_) = path_is_protected_for_trash(protect, std::path::Path::new(&path)) {
        return TrashItemResult {
            path,
            ok: false,
            error: Some("This file is protected and was not moved.".into()),
        };
    }
    if !std::path::Path::new(&path).exists() {
        return TrashItemResult {
            path,
            ok: false,
            error: Some("File already moved or missing".into()),
        };
    }
    match ctx.delete(&path) {
        Ok(()) => TrashItemResult {
            path,
            ok: true,
            error: None,
        },
        Err(error) => TrashItemResult {
            path,
            ok: false,
            error: Some(humanize_error(error)),
        },
    }
}

fn trash_context() -> trash::TrashContext {
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // Finder records Put Back metadata. NsFileManager is faster but Finder then
        // has no Put Back. Keep NsFileManager in tests so CI does not need Automation.
        if cfg!(test) {
            ctx.set_delete_method(DeleteMethod::NsFileManager);
        } else {
            ctx.set_delete_method(DeleteMethod::Finder);
        }
    }
    ctx
}

/// Move each path to the OS trash / recycle bin. Never permanently deletes.
pub fn move_to_trash(app: &AppHandle, paths: Vec<String>) -> Vec<TrashItemResult> {
    let total = paths.len();
    let mut results = Vec::with_capacity(total);
    let ctx = trash_context();
    let config_dir = app.path().app_config_dir().unwrap_or_else(|_| {
        dirs::config_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("com.richrose.swipeclean")
    });
    let protect = ProtectContext::load_from_config_dir(&config_dir);

    for (index, path) in paths.into_iter().enumerate() {
        let result = trash_one(&ctx, &protect, path.clone());
        let _ = app.emit(
            "trash-progress",
            TrashProgress {
                done: index + 1,
                total,
                path,
            },
        );
        results.push(result);
    }
    results
}

/// Restore files that this app moved to Trash, back to their original paths.
pub fn restore_from_trash(paths: Vec<String>) -> Vec<TrashItemResult> {
    restore_paths(paths)
}

fn restore_paths(paths: Vec<String>) -> Vec<TrashItemResult> {
    #[cfg(target_os = "macos")]
    {
        return paths.into_iter().map(restore_one_macos).collect();
    }
    #[cfg(any(
        target_os = "windows",
        all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
    ))]
    {
        return restore_paths_os_limited(paths);
    }
    #[allow(unreachable_code)]
    {
        paths
            .into_iter()
            .map(|path| TrashItemResult {
                path,
                ok: false,
                error: Some("Put Back is not available on this system.".into()),
            })
            .collect()
    }
}

#[cfg(any(
    target_os = "windows",
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn restore_paths_os_limited(paths: Vec<String>) -> Vec<TrashItemResult> {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    let wanted: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let listed = match trash::os_limited::list() {
        Ok(items) => items,
        Err(error) => {
            let message = humanize_error(error);
            return paths
                .into_iter()
                .map(|path| TrashItemResult {
                    path,
                    ok: false,
                    error: Some(message.clone()),
                })
                .collect();
        }
    };

    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 - 60 * 60 * 24 * 14)
        .unwrap_or(0);

    let mut by_original: HashMap<PathBuf, trash::TrashItem> = HashMap::new();
    for item in listed {
        if item.time_deleted > 0 && item.time_deleted < cutoff {
            continue;
        }
        let original = item.original_path();
        if !wanted.iter().any(|path| path == &original) {
            continue;
        }
        let replace = by_original
            .get(&original)
            .map(|existing| item.time_deleted >= existing.time_deleted)
            .unwrap_or(true);
        if replace {
            by_original.insert(original, item);
        }
    }

    let mut results = Vec::with_capacity(paths.len());
    let mut to_restore = Vec::new();
    let mut restore_order = Vec::new();
    for path in &paths {
        let original = PathBuf::from(path);
        if original.exists() {
            results.push(TrashItemResult {
                path: path.clone(),
                ok: true,
                error: None,
            });
            continue;
        }
        match by_original.remove(&original) {
            Some(item) => {
                restore_order.push(path.clone());
                to_restore.push(item);
            }
            None => results.push(TrashItemResult {
                path: path.clone(),
                ok: false,
                error: Some("Not in Trash. It may have been emptied or Put Back already.".into()),
            }),
        }
    }

    if !to_restore.is_empty() {
        match trash::os_limited::restore_all(to_restore) {
            Ok(()) => {
                for path in restore_order {
                    results.push(TrashItemResult {
                        path,
                        ok: true,
                        error: None,
                    });
                }
            }
            Err(error) => {
                let message = humanize_error(error);
                for path in restore_order {
                    results.push(TrashItemResult {
                        path,
                        ok: false,
                        error: Some(message.clone()),
                    });
                }
            }
        }
    }
    results
}

#[cfg(target_os = "macos")]
fn restore_one_macos(path: String) -> TrashItemResult {
    let original = std::path::Path::new(&path);
    if original.exists() {
        return TrashItemResult {
            path,
            ok: true,
            error: None,
        };
    }
    if restore_from_home_trash(original).is_ok() || restore_using_finder(original).is_ok() {
        return TrashItemResult {
            path,
            ok: true,
            error: None,
        };
    }
    TrashItemResult {
        path,
        ok: false,
        error: Some("Not in Trash. It may have been emptied or Put Back already.".into()),
    }
}

#[cfg(target_os = "macos")]
fn restore_using_finder(original: &std::path::Path) -> Result<(), String> {
    use std::process::Command;

    let name = original
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid path".to_string())?;
    let parent = original
        .parent()
        .and_then(|p| p.to_str())
        .ok_or_else(|| "Invalid path".to_string())?;
    let script = format!(
        r#"tell application "Finder"
  set dest to POSIX file "{parent}" as alias
  set hits to (items of trash whose name is "{name}")
  if (count of hits) is 0 then error "Not in Trash"
  move item 1 of hits to dest
end tell"#,
        parent = esc_applescript(parent),
        name = esc_applescript(name),
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(target_os = "macos")]
fn esc_applescript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn restore_from_home_trash(original: &std::path::Path) -> Result<(), String> {
    let name = original
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?;
    let home = dirs::home_dir().ok_or_else(|| "No home folder".to_string())?;
    let candidate = home.join(".Trash").join(name);
    if !candidate.exists() {
        return Err("Not in Trash".into());
    }
    std::fs::rename(&candidate, original).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protect::{ProtectContext, ProtectionSettings};

    fn open_protect() -> ProtectContext {
        ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            ..Default::default()
        })
    }

    #[test]
    fn moves_temp_file_to_os_trash() {
        let path = std::env::temp_dir().join("swipeclean-ok-to-empty-from-trash.txt");
        std::fs::write(&path, b"swipe clean test").unwrap();
        let result = trash_one(
            &trash_context(),
            &open_protect(),
            path.to_string_lossy().into_owned(),
        );
        assert!(result.ok, "{:?}", result.error);
        assert!(!path.exists());
    }

    #[test]
    fn missing_file_fails_without_hanging() {
        let path = std::env::temp_dir().join("swipeclean-missing-xyz-123.txt");
        let _ = std::fs::remove_file(&path);
        let result = trash_one(
            &trash_context(),
            &open_protect(),
            path.to_string_lossy().into_owned(),
        );
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("File already moved or missing"));
    }

    #[test]
    fn refuses_protected_user_folder() {
        let dir = std::env::temp_dir().join(format!(
            "swipeclean-protected-trash-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secret.txt");
        std::fs::write(&path, b"nope").unwrap();
        let protect = ProtectContext::from_settings(ProtectionSettings {
            recent_hours: 0,
            folders: vec![dir.to_string_lossy().into_owned()],
            ..Default::default()
        });
        let result = trash_one(
            &trash_context(),
            &protect,
            path.to_string_lossy().into_owned(),
        );
        assert!(!result.ok);
        assert_eq!(
            result.error.as_deref(),
            Some("This file is protected and was not moved.")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn puts_trashed_temp_file_back() {
        let path = std::env::temp_dir().join(format!(
            "swipeclean-putback-{}.txt",
            std::process::id()
        ));
        std::fs::write(&path, b"put back").unwrap();
        let original = path.to_string_lossy().into_owned();
        let trashed = trash_one(&trash_context(), &open_protect(), original.clone());
        assert!(trashed.ok, "{:?}", trashed.error);
        assert!(!path.exists());
        let restored = restore_paths(vec![original]);
        assert_eq!(restored.len(), 1);
        assert!(restored[0].ok, "{:?}", restored[0].error);
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }
}

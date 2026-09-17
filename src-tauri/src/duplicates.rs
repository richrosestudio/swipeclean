use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use img_hash::{HashAlg, HasherConfig};
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::types::{DupProgress, DuplicateCluster, FindDuplicatesResult, ScannedFile, SimilarHash};
use crate::AppState;

const CHUNK_SIZE: u64 = 8 * 1024;
const EMIT_INTERVAL: Duration = Duration::from_millis(80);
const PHASH_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"];
const MAX_PHASH_BYTES: u64 = 12 * 1024 * 1024;

struct Progress {
    app: AppHandle,
    last: Mutex<Instant>,
}

impl Progress {
    fn emit(&self, progress: DupProgress) {
        let mut last = match self.last.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if last.elapsed() >= EMIT_INTERVAL {
            let _ = self.app.emit("dup-progress", &progress);
            *last = Instant::now();
        }
    }
}

pub fn find_duplicates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FindDuplicatesResult, String> {
    state.cancel_scan.store(false, Ordering::SeqCst);
    let files = state
        .last_scan
        .lock()
        .map_err(|_| "Scan results are busy.".to_string())?
        .clone();
    let cancelled = &state.cancel_scan;
    let progress = Progress {
        app: app.clone(),
        last: Mutex::new(
            Instant::now()
                .checked_sub(EMIT_INTERVAL)
                .unwrap_or_else(Instant::now),
        ),
    };

    let result = detect_duplicates(&files, cancelled, &progress);
    let _ = app.emit(
        "dup-progress",
        &DupProgress {
            phase: if result.cancelled {
                "cancelled".into()
            } else {
                "done".into()
            },
            done: files.len() as u64,
            total: files.len() as u64,
            path: String::new(),
        },
    );
    Ok(result)
}

trait EmitProgress: Sync {
    fn emit_progress(&self, progress: DupProgress);
}

impl EmitProgress for Progress {
    fn emit_progress(&self, progress: DupProgress) {
        self.emit(progress);
    }
}

struct NoopProgress;

impl EmitProgress for NoopProgress {
    fn emit_progress(&self, _: DupProgress) {}
}

fn detect_duplicates(
    files: &[ScannedFile],
    cancelled: &AtomicBool,
    progress: &dyn EmitProgress,
) -> FindDuplicatesResult {
    let empty = FindDuplicatesResult {
        exact_clusters: Vec::new(),
        similar_hashes: Vec::new(),
        cancelled: true,
    };

    let (exact_clusters, exact_paths) = match exact_duplicate_clusters(files, cancelled, progress) {
        Some(value) => value,
        None => return empty,
    };

    let similar_hashes = match similar_image_hashes(files, &exact_paths, cancelled, progress) {
        Some(value) => value,
        None => return empty,
    };

    FindDuplicatesResult {
        exact_clusters,
        similar_hashes,
        cancelled: false,
    }
}

fn exact_duplicate_clusters(
    files: &[ScannedFile],
    cancelled: &AtomicBool,
    progress: &dyn EmitProgress,
) -> Option<(Vec<DuplicateCluster>, HashSet<String>)> {
    let mut by_size: HashMap<u64, Vec<&ScannedFile>> = HashMap::new();
    for file in files {
        by_size.entry(file.size).or_default().push(file);
    }

    let candidates: Vec<&ScannedFile> = by_size
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    let total = candidates.len() as u64;
    let done = AtomicU64::new(0);

    let chunked: Vec<(&ScannedFile, [u8; 32])> = candidates
        .par_iter()
        .filter_map(|file| {
            if cancelled.load(Ordering::Relaxed) {
                return None;
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress.emit_progress(DupProgress {
                phase: "exact".into(),
                done: n,
                total,
                path: file.path.clone(),
            });
            sha256_chunks(Path::new(&file.path), file.size).map(|hash| (*file, hash))
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return None;
    }

    let mut chunk_groups: HashMap<[u8; 32], Vec<&ScannedFile>> = HashMap::new();
    for (file, hash) in chunked {
        chunk_groups.entry(hash).or_default().push(file);
    }

    let full_candidates: Vec<&ScannedFile> = chunk_groups
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();
    let full_total = full_candidates.len() as u64;
    let hashed = AtomicU64::new(0);

    let full_hashed: Vec<(ScannedFile, [u8; 32])> = full_candidates
        .par_iter()
        .filter_map(|file| {
            if cancelled.load(Ordering::Relaxed) {
                return None;
            }
            let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
            progress.emit_progress(DupProgress {
                phase: "exact".into(),
                done: n,
                total: full_total,
                path: file.path.clone(),
            });
            sha256_file(Path::new(&file.path)).map(|hash| ((*file).clone(), hash))
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return None;
    }

    let mut full_groups: HashMap<[u8; 32], Vec<ScannedFile>> = HashMap::new();
    for (file, hash) in full_hashed {
        full_groups.entry(hash).or_default().push(file);
    }

    let mut exact_paths = HashSet::new();
    let mut clusters = Vec::new();
    for (hash, group) in full_groups {
        if group.len() < 2 {
            continue;
        }
        for file in &group {
            exact_paths.insert(file.path.clone());
        }
        clusters.push(DuplicateCluster {
            id: format!("exact-{}", hex_bytes(&hash)[..16].to_string()),
            files: group,
        });
    }
    clusters.sort_by(|a, b| b.files.len().cmp(&a.files.len()).then_with(|| a.id.cmp(&b.id)));
    Some((clusters, exact_paths))
}

fn similar_image_hashes(
    files: &[ScannedFile],
    exact_paths: &HashSet<String>,
    cancelled: &AtomicBool,
    progress: &dyn EmitProgress,
) -> Option<Vec<SimilarHash>> {
    let candidates: Vec<&ScannedFile> = files
        .iter()
        .filter(|file| {
            !exact_paths.contains(&file.path)
                && file.kind == "image"
                && file.size > 0
                && file.size <= MAX_PHASH_BYTES
                && PHASH_EXTS.contains(&file.extension.as_str())
        })
        .collect();

    let total = candidates.len() as u64;
    let done = AtomicU64::new(0);

    let hashes: Vec<SimilarHash> = candidates
        .par_iter()
        .filter_map(|file| {
            if cancelled.load(Ordering::Relaxed) {
                return None;
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress.emit_progress(DupProgress {
                phase: "similar".into(),
                done: n,
                total,
                path: file.path.clone(),
            });
            let image = image::open(&file.path).ok()?;
            let hasher = HasherConfig::new()
                .hash_size(8, 8)
                .hash_alg(HashAlg::Gradient)
                .to_hasher();
            let hash = hasher.hash_image(&image);
            Some(SimilarHash {
                file: (*file).clone(),
                dhash: hex_bytes(hash.as_bytes()),
            })
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return None;
    }

    Some(hashes)
}

fn sha256_chunks(path: &Path, size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE as usize];

    let first = std::cmp::min(size, CHUNK_SIZE) as usize;
    file.read_exact(&mut buf[..first]).ok()?;
    hasher.update(&buf[..first]);

    if size > CHUNK_SIZE {
        let last = std::cmp::min(size, CHUNK_SIZE) as usize;
        file.seek(SeekFrom::End(-(last as i64))).ok()?;
        file.read_exact(&mut buf[..last]).ok()?;
        hasher.update(&buf[..last]);
    }

    Some(hasher.finalize().into())
}

fn sha256_file(path: &Path) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hasher.finalize().into())
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn scanned(path: &Path, size: u64) -> ScannedFile {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = if PHASH_EXTS.contains(&extension.as_str()) {
            "image"
        } else {
            "other"
        }
        .into();
        ScannedFile {
            path: path.to_string_lossy().into_owned(),
            name,
            size,
            mtime_ms: Some(1),
            atime_ms: None,
            atime_available: false,
            extension,
            kind,
        }
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "swipeclean-dup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn identical_bytes_form_exact_cluster() {
        let dir = temp_dir();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        let payload = vec![7u8; 32 * 1024];
        std::fs::write(&a, &payload).unwrap();
        std::fs::write(&b, &payload).unwrap();
        let files = vec![
            scanned(&a, payload.len() as u64),
            scanned(&b, payload.len() as u64),
        ];
        let cancelled = AtomicBool::new(false);
        let result = detect_duplicates(&files, &cancelled, &NoopProgress);
        assert!(!result.cancelled);
        assert_eq!(result.exact_clusters.len(), 1);
        assert_eq!(result.exact_clusters[0].files.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_size_different_bytes_are_not_exact() {
        let dir = temp_dir();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        let left = vec![1u8; 24 * 1024];
        let mut right = vec![1u8; 24 * 1024];
        right[12 * 1024] = 9;
        std::fs::write(&a, &left).unwrap();
        std::fs::write(&b, &right).unwrap();
        let files = vec![
            scanned(&a, left.len() as u64),
            scanned(&b, right.len() as u64),
        ];
        let cancelled = AtomicBool::new(false);
        let result = detect_duplicates(&files, &cancelled, &NoopProgress);
        assert!(result.exact_clusters.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn different_sizes_never_group() {
        let dir = temp_dir();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        std::fs::write(&a, b"abc").unwrap();
        std::fs::write(&b, b"abcd").unwrap();
        let files = vec![scanned(&a, 3), scanned(&b, 4)];
        let cancelled = AtomicBool::new(false);
        let result = detect_duplicates(&files, &cancelled, &NoopProgress);
        assert!(result.exact_clusters.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identical_pngs_share_dhash() {
        let dir = temp_dir();
        let a = dir.join("a.png");
        let b = dir.join("b.png");
        let img: image::RgbImage = image::ImageBuffer::from_pixel(48, 48, image::Rgb([20, 80, 180]));
        img.save(&a).unwrap();
        img.save(&b).unwrap();
        let files = vec![
            scanned(&a, std::fs::metadata(&a).unwrap().len()),
            scanned(&b, std::fs::metadata(&b).unwrap().len()),
        ];
        let cancelled = AtomicBool::new(false);
        let result = detect_duplicates(&files, &cancelled, &NoopProgress);
        // Byte-identical PNGs are exact duplicates, so they skip similar hashing.
        assert_eq!(result.exact_clusters.len(), 1);
        assert!(result.similar_hashes.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn similar_pngs_get_dhashes_when_bytes_differ() {
        let dir = temp_dir();
        let a = dir.join("a.png");
        let b = dir.join("near.png");
        let mut img_a: image::RgbImage =
            image::ImageBuffer::from_pixel(64, 64, image::Rgb([10, 20, 30]));
        let mut img_b = img_a.clone();
        img_a.put_pixel(0, 0, image::Rgb([11, 20, 30]));
        img_b.put_pixel(0, 0, image::Rgb([12, 21, 31]));
        img_a.save(&a).unwrap();
        img_b.save(&b).unwrap();
        let files = vec![
            scanned(&a, std::fs::metadata(&a).unwrap().len()),
            scanned(&b, std::fs::metadata(&b).unwrap().len()),
        ];
        let cancelled = AtomicBool::new(false);
        let result = detect_duplicates(&files, &cancelled, &NoopProgress);
        assert!(result.exact_clusters.is_empty());
        assert_eq!(result.similar_hashes.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

use serde::{Deserialize, Serialize};

use crate::protect::SkipSummary;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime_ms: Option<i64>,
    pub atime_ms: Option<i64>,
    pub atime_available: bool,
    pub extension: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub path: String,
    pub recursive: bool,
    pub min_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files_found: u64,
    pub bytes_found: u64,
    pub skipped: u64,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanComplete {
    pub files_found: u64,
    pub bytes_found: u64,
    pub skipped: u64,
    pub cancelled: bool,
    pub files: Vec<ScannedFile>,
    #[serde(default)]
    pub skip_summary: SkipSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCluster {
    pub id: String,
    pub files: Vec<ScannedFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarHash {
    pub file: ScannedFile,
    pub dhash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindDuplicatesResult {
    pub exact_clusters: Vec<DuplicateCluster>,
    pub similar_hashes: Vec<SimilarHash>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupProgress {
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItemResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

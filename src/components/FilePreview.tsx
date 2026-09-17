import { convertFileSrc } from "@tauri-apps/api/core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";
import { extensionLabel } from "../lib/format";
import { readFileBytes } from "../lib/ipc";
import type { ScannedFile } from "../types";

GlobalWorkerOptions.workerSrc = workerUrl;

const VIDEO_PREVIEW_MAX = 500 * 1024 * 1024;
const PDF_PREVIEW_MAX = 50 * 1024 * 1024;

function Fallback({ file, message }: { file: ScannedFile; message?: string }) {
  return (
    <div className="preview-fallback">
      <span className={`preview-badge kind-${file.kind}`}>
        {extensionLabel(file.extension)}
      </span>
      <p>{message ?? "No inline preview"}</p>
    </div>
  );
}

function ImagePreview({ file }: { file: ScannedFile }) {
  const [failed, setFailed] = useState(false);
  const src = convertFileSrc(file.path);
  if (failed) return <Fallback file={file} />;
  return (
    <img
      className="preview-media"
      src={src}
      alt={file.name}
      onError={() => setFailed(true)}
    />
  );
}

function VideoPreview({ file }: { file: ScannedFile }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(file.size > VIDEO_PREVIEW_MAX);

  useEffect(() => {
    if (file.size > VIDEO_PREVIEW_MAX) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.src = convertFileSrc(file.path);

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const capture = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0) {
        setFailed(true);
        cleanup();
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumb(canvas.toDataURL("image/jpeg", 0.72));
      cleanup();
    };

    video.addEventListener("loadeddata", () => {
      video.currentTime = Math.min(0.4, (video.duration || 1) * 0.05);
    });
    video.addEventListener("seeked", capture);
    video.addEventListener("error", () => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [file.path, file.size]);

  if (failed) {
    return (
      <Fallback
        file={file}
        message={
          file.size > VIDEO_PREVIEW_MAX
            ? "Video is too large to thumbnail"
            : "Could not capture a frame"
        }
      />
    );
  }
  if (!thumb) return <div className="preview-loading">Loading thumbnail…</div>;
  return <img className="preview-media" src={thumb} alt={file.name} />;
}

function PdfPreview({ file }: { file: ScannedFile }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(file.size > PDF_PREVIEW_MAX);

  useEffect(() => {
    if (file.size > PDF_PREVIEW_MAX) return;
    let cancelled = false;

    async function renderPage(data: { url?: string; data?: Uint8Array }) {
      const pdf = await getDocument(data).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.15 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("canvas");
      await page.render({ canvas, canvasContext, viewport }).promise;
      const url = canvas.toDataURL("image/png");
      await pdf.cleanup();
      return url;
    }

    (async () => {
      try {
        const url = convertFileSrc(file.path);
        const rendered = await renderPage({ url });
        if (!cancelled) setThumb(rendered);
      } catch {
        try {
          const data = await readFileBytes(file.path, PDF_PREVIEW_MAX);
          const rendered = await renderPage({ data });
          if (!cancelled) setThumb(rendered);
        } catch {
          if (!cancelled) setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.path, file.size]);

  if (failed) {
    return (
      <Fallback
        file={file}
        message={
          file.size > PDF_PREVIEW_MAX
            ? "PDF is too large to preview"
            : "Could not render the first page"
        }
      />
    );
  }
  if (!thumb) return <div className="preview-loading">Rendering first page…</div>;
  return <img className="preview-media preview-pdf" src={thumb} alt={file.name} />;
}

export function FilePreview({ file }: { file: ScannedFile }) {
  if (file.kind === "image") return <ImagePreview file={file} />;
  if (file.kind === "video") return <VideoPreview file={file} />;
  if (file.extension === "pdf") return <PdfPreview file={file} />;
  return <Fallback file={file} />;
}

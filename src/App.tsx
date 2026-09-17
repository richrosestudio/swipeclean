import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DuplicatesScreen } from "./screens/DuplicatesScreen";
import { Home } from "./screens/Home";
import { ProgressScreen } from "./screens/ProgressScreen";
import { ProtectScreen } from "./screens/ProtectScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { SkipDetailsScreen } from "./screens/SkipDetailsScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { SwipeScreen } from "./screens/SwipeScreen";
import { clusterSimilar, dupSteps, nextDupIndex } from "./lib/duplicates";
import {
  cancelScan,
  checkScanRoot,
  findDuplicates,
  getProtectionSettings,
  moveToTrash,
  onDupProgress,
  onScanProgress,
  onTrashProgress,
  pickFolder,
  restoreFromTrash,
  scanFolder,
} from "./lib/ipc";
import { keptCount, queuedBytes, queuedFiles, remainingFiles } from "./lib/sort";
import {
  DEFAULT_HAMMING,
  DEFAULT_OPTIONS,
  DEFAULT_PROTECTION,
  EMPTY_SKIP_SUMMARY,
  type Decision,
  type DupProgress,
  type DuplicateCluster,
  type ProtectionSettings,
  type RootCheck,
  type ScanOptions,
  type ScanPhase,
  type ScanProgress,
  type ScannedFile,
  type Screen,
  type SimilarHash,
  type SkipSummary,
  type TrashItemResult,
  type TrashProgress,
} from "./types";
import "./App.css";

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [options, setOptions] = useState<ScanOptions>(DEFAULT_OPTIONS);
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("listing");
  const [dupProgress, setDupProgress] = useState<DupProgress | null>(null);
  const [exactClusters, setExactClusters] = useState<DuplicateCluster[]>([]);
  const [similarHashes, setSimilarHashes] = useState<SimilarHash[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [rootCheck, setRootCheck] = useState<RootCheck | null>(null);
  const [protection, setProtection] = useState<ProtectionSettings>(DEFAULT_PROTECTION);
  const [skipSummary, setSkipSummary] = useState<SkipSummary | null>(null);
  const [skipReturn, setSkipReturn] = useState<Screen>("home");
  const [reviewReturn, setReviewReturn] = useState<Screen>("swipe");
  const [dupIndex, setDupIndex] = useState(0);
  const [failedTrash, setFailedTrash] = useState<TrashItemResult[]>([]);
  const [lastTrashBytes, setLastTrashBytes] = useState(0);
  const [lastTrashedFiles, setLastTrashedFiles] = useState<ScannedFile[]>([]);
  const [puttingBack, setPuttingBack] = useState(false);
  const [putBackError, setPutBackError] = useState<string | null>(null);
  const [holdListing, setHoldListing] = useState(false);
  const listingReadyRef = useRef<() => void>(() => undefined);
  const [trashResults, setTrashResults] = useState<TrashItemResult[]>([]);
  const [trashProgress, setTrashProgress] = useState<TrashProgress | null>(null);
  const filesRef = useRef<ScannedFile[]>([]);
  const sessionRef = useRef(0);

  useEffect(() => {
    void getProtectionSettings()
      .then(setProtection)
      .catch(() => undefined);
  }, []);

  const remaining = useMemo(
    () => remainingFiles(files, decisions, options.sort),
    [files, decisions, options.sort],
  );
  const queued = useMemo(() => queuedFiles(decisions), [decisions]);
  const current = remaining[0];
  const upcoming = remaining.slice(1, 3);

  const chooseFolder = useCallback(async () => {
    setPicking(true);
    try {
      const path = await pickFolder();
      if (path) {
        setOptions((prev) => ({ ...prev, root: path }));
        try {
          setRootCheck(await checkScanRoot(path));
        } catch {
          setRootCheck(null);
        }
      }
    } finally {
      setPicking(false);
    }
  }, []);

  const startScan = useCallback(async () => {
    const session = ++sessionRef.current;
    setScanError(null);
    setFiles([]);
    filesRef.current = [];
    setDecisions([]);
    setExactClusters([]);
    setSimilarHashes([]);
    setDupIndex(0);
    setFailedTrash([]);
    setLastTrashBytes(0);
    setLastTrashedFiles([]);
    setPuttingBack(false);
    setPutBackError(null);
    setReviewReturn("swipe");
    setScanPhase("listing");
    setDupProgress(null);
    setHoldListing(false);
    setSkipSummary(null);
    setScanProgress({
      filesFound: 0,
      bytesFound: 0,
      skipped: 0,
      currentPath: options.root,
    });
    setScreen("scan");

    const unlistenProgress = await onScanProgress((progress) => {
      if (session !== sessionRef.current) return;
      setScanProgress(progress);
    });

    let listingReady: (() => void) | null = null;
    const listingReadyPromise = new Promise<void>((resolve) => {
      listingReady = resolve;
    });
    listingReadyRef.current = () => listingReady?.();

    try {
      const result = await scanFolder({
        path: options.root,
        recursive: options.recursive,
        minSize: options.minSizeBytes,
      });
      if (session !== sessionRef.current) return;
      filesRef.current = result.files ?? [];
      setFiles(filesRef.current);
      setSkipSummary(result.skipSummary ?? EMPTY_SKIP_SUMMARY);
      setScanProgress({
        filesFound: result.filesFound,
        bytesFound: result.bytesFound,
        skipped: result.skipped,
        currentPath: options.root,
      });
      if (result.cancelled) {
        setScreen("home");
        return;
      }
      if (filesRef.current.length === 0) {
        if ((result.skipSummary?.total ?? 0) > 0) {
          setHoldListing(true);
          await Promise.race([listingReadyPromise, wait(1600)]);
          if (session !== sessionRef.current) return;
          setHoldListing(false);
          setSkipReturn("home");
          setScreen("skips");
          return;
        }
        setScanError("No files found in this folder.");
        setScreen("home");
        return;
      }

      setHoldListing(true);
      await Promise.race([listingReadyPromise, wait(1600)]);
      if (session !== sessionRef.current) return;
      setHoldListing(false);

      setScanPhase("duplicates");
      const unlistenDup = await onDupProgress((progress) => {
        if (session !== sessionRef.current) return;
        setDupProgress(progress);
      });
      try {
        const dup = await findDuplicates();
        if (session !== sessionRef.current) return;
        if (dup.cancelled) {
          setScreen("home");
          return;
        }
        const similar = clusterSimilar(dup.similarHashes, DEFAULT_HAMMING);
        if (dup.exactClusters.length === 0 && similar.length === 0) {
          setScreen("swipe");
          return;
        }
        setExactClusters(dup.exactClusters);
        setSimilarHashes(dup.similarHashes);
        setDupIndex(0);
        setScreen("duplicates");
      } finally {
        unlistenDup();
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
      setScreen("home");
    } finally {
      unlistenProgress();
    }
  }, [options]);

  const decide = useCallback((action: "keep" | "delete") => {
    const file = remaining[0];
    if (!file) return;
    setDecisions((prev) => [...prev, { file, action }]);
  }, [remaining]);

  const undo = useCallback(() => {
    setDecisions((prev) => prev.slice(0, -1));
  }, []);

  const unqueue = useCallback((path: string) => {
    setDecisions((prev) =>
      prev.map((decision) =>
        decision.file.path === path && decision.action === "delete"
          ? { ...decision, action: "keep" as const }
          : decision,
      ),
    );
  }, []);

  const acceptExact = useCallback((keeper: ScannedFile, rest: ScannedFile[]) => {
    setDecisions((prev) => [
      ...prev,
      { file: keeper, action: "keep" },
      ...rest.map((file) => ({ file, action: "delete" as const })),
    ]);
  }, []);

  const queueSimilar = useCallback((file: ScannedFile) => {
    setDecisions((prev) => {
      if (prev.some((decision) => decision.file.path === file.path)) return prev;
      return [...prev, { file, action: "delete" }];
    });
  }, []);

  const unqueueSimilar = useCallback((path: string) => {
    setDecisions((prev) => prev.filter((decision) => decision.file.path !== path));
  }, []);

  const confirmTrash = useCallback(async () => {
    const snapshot = queued;
    const paths = snapshot.map((file) => file.path);
    if (paths.length === 0) return;
    setFailedTrash([]);
    setTrashProgress({ done: 0, total: paths.length, path: "" });
    const session = sessionRef.current;
    setScreen("progress");
    const unlisten = await onTrashProgress(setTrashProgress);
    let results: TrashItemResult[];
    try {
      results = await moveToTrash(paths);
    } catch (error) {
      results = paths.map((path) => ({
        path,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      unlisten();
    }

    if (sessionRef.current !== session) return;

    setTrashResults(results);
    const moved = new Set(results.filter((item) => item.ok).map((item) => item.path));
    const failed = results.filter((item) => !item.ok);
    const movedBytes = results
      .filter((item) => item.ok)
      .reduce((sum, item) => {
        const file = snapshot.find((entry) => entry.path === item.path);
        return sum + (file?.size ?? 0);
      }, 0);

    const filesNext = files.filter((file) => !moved.has(file.path));
    const decisionsNext = decisions.filter((decision) => !moved.has(decision.file.path));
    const exactNext = exactClusters
      .map((cluster) => ({
        ...cluster,
        files: cluster.files.filter((file) => !moved.has(file.path)),
      }))
      .filter((cluster) => cluster.files.length >= 2);
    const similarNext = similarHashes.filter((item) => !moved.has(item.file.path));
    const beforeSteps = dupSteps(exactClusters, similarHashes);
    const afterSteps = dupSteps(exactNext, similarNext);

    filesRef.current = filesNext;
    setFiles(filesNext);
    setDecisions(decisionsNext);
    setExactClusters(exactNext);
    setSimilarHashes(similarNext);
    setDupIndex((index) => nextDupIndex(beforeSteps, afterSteps, index));
    setFailedTrash(failed);
    setLastTrashBytes(movedBytes);
    setLastTrashedFiles(snapshot.filter((file) => moved.has(file.path)));
    setPutBackError(null);

    if (moved.size === 0) {
      setScreen("review");
      return;
    }

    setScreen("summary");
  }, [queued, files, decisions, exactClusters, similarHashes]);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    void cancelScan();
    setScreen("home");
    setFiles([]);
    filesRef.current = [];
    setDecisions([]);
    setScanProgress(null);
    setScanPhase("listing");
    setDupProgress(null);
    setExactClusters([]);
    setSimilarHashes([]);
    setDupIndex(0);
    setFailedTrash([]);
    setLastTrashBytes(0);
    setLastTrashedFiles([]);
    setPuttingBack(false);
    setPutBackError(null);
    setReviewReturn("swipe");
    setSkipSummary(null);
    setHoldListing(false);
    setTrashResults([]);
    setTrashProgress(null);
    setScanError(null);
  }, []);

  const continueFromSummary = useCallback(() => {
    if (failedTrash.length > 0) {
      setScreen("review");
      return;
    }
    if (reviewReturn === "duplicates" && dupSteps(exactClusters, similarHashes).length > 0) {
      setScreen("duplicates");
      return;
    }
    if (remaining.length > 0) {
      setScreen("swipe");
      return;
    }
    reset();
  }, [failedTrash.length, reviewReturn, exactClusters, similarHashes, remaining.length, reset]);

  const putBack = useCallback(async () => {
    if (lastTrashedFiles.length === 0) return;
    setPuttingBack(true);
    setPutBackError(null);
    try {
      const results = await restoreFromTrash(lastTrashedFiles.map((file) => file.path));
      const ok = new Set(results.filter((item) => item.ok).map((item) => item.path));
      const restored = lastTrashedFiles.filter((file) => ok.has(file.path));
      const failedRestore = results.filter((item) => !item.ok);
      const filesNext = [...files];
      for (const file of restored) {
        if (!filesNext.some((existing) => existing.path === file.path)) {
          filesNext.push(file);
        }
      }
      filesRef.current = filesNext;
      setFiles(filesNext);
      setLastTrashedFiles((prev) => prev.filter((file) => !ok.has(file.path)));
      if (failedRestore.length > 0) {
        setPutBackError(
          `Could not put back ${failedRestore.length} ${
            failedRestore.length === 1 ? "file" : "files"
          }. They may have been emptied from Trash.`,
        );
        return;
      }
      const remainingNext = remainingFiles(filesNext, decisions, options.sort);
      const dupLeft = dupSteps(exactClusters, similarHashes).length > 0;
      if (failedTrash.length > 0) setScreen("review");
      else if (reviewReturn === "duplicates" && dupLeft) setScreen("duplicates");
      else if (remainingNext.length > 0) setScreen("swipe");
      else setScreen("home");
    } catch (error) {
      setPutBackError(error instanceof Error ? error.message : String(error));
    } finally {
      setPuttingBack(false);
    }
  }, [
    lastTrashedFiles,
    files,
    decisions,
    options.sort,
    exactClusters,
    similarHashes,
    failedTrash.length,
    reviewReturn,
  ]);

  const goReview = useCallback((from: Screen) => {
    setReviewReturn(from);
    setScreen("review");
  }, []);
  const goSwipe = useCallback(() => {
    if (remaining.length === 0) setScreen("review");
    else setScreen("swipe");
  }, [remaining.length]);
  const finishDuplicates = useCallback(() => {
    setExactClusters([]);
    setSimilarHashes([]);
    setDupIndex(0);
    setReviewReturn("swipe");
    if (remaining.length === 0) setScreen("review");
    else setScreen("swipe");
  }, [remaining.length]);
  const leaveReview = useCallback(() => {
    if (reviewReturn === "duplicates" && dupSteps(exactClusters, similarHashes).length > 0) {
      setScreen("duplicates");
      return;
    }
    goSwipe();
  }, [reviewReturn, exactClusters, similarHashes, goSwipe]);
  const goSeeSkips = useCallback((from: Screen) => {
    setSkipReturn(from);
    setScreen("skips");
  }, []);
  const leaveSkips = useCallback(() => {
    if (skipReturn === "swipe" && remaining.length === 0) setScreen("review");
    else setScreen(skipReturn);
  }, [skipReturn, remaining.length]);

  if (screen === "scan") {
    return (
      <ScanScreen
        phase={scanPhase}
        progress={scanProgress}
        dupProgress={dupProgress}
        fileCount={files.length}
        holdListing={holdListing}
        onListingReady={() => listingReadyRef.current()}
        onCancel={() => {
          void cancelScan();
          reset();
        }}
        onHome={() => {
          void cancelScan();
          reset();
        }}
      />
    );
  }

  if (screen === "duplicates") {
    return (
      <DuplicatesScreen
        exactClusters={exactClusters}
        similarHashes={similarHashes}
        total={files.length}
        kept={keptCount(decisions)}
        queued={queued.length}
        queuedBytes={queuedBytes(decisions)}
        reviewed={decisions.length}
        queuedPaths={new Set(queued.map((file) => file.path))}
        index={dupIndex}
        onIndexChange={setDupIndex}
        onAcceptExact={acceptExact}
        onQueueSimilar={queueSimilar}
        onUnqueueSimilar={unqueueSimilar}
        onContinue={finishDuplicates}
        onReview={() => goReview("duplicates")}
        onHome={reset}
        skipSummary={skipSummary}
        onSeeSkips={() => goSeeSkips("duplicates")}
      />
    );
  }

  if (screen === "swipe" && current) {
    return (
      <SwipeScreen
        current={current}
        upcoming={upcoming}
        options={options}
        reviewed={decisions.length}
        total={files.length}
        kept={keptCount(decisions)}
        queued={queued.length}
        queuedBytes={queuedBytes(decisions)}
        canUndo={decisions.length > 0}
        onKeep={() => decide("keep")}
        onDelete={() => decide("delete")}
        onUndo={undo}
        onChangeOptions={setOptions}
        onReview={() => goReview("swipe")}
        onHome={reset}
        skipSummary={skipSummary}
        onSeeSkips={() => goSeeSkips("swipe")}
      />
    );
  }

  if (screen === "swipe" && !current) {
    return (
      <ReviewScreen
        queued={queued}
        remaining={0}
        reviewed={decisions.length}
        total={files.length}
        kept={keptCount(decisions)}
        queuedBytes={queuedBytes(decisions)}
        backLabel="Back"
        failedTrash={failedTrash}
        onUnqueue={unqueue}
        onBack={() => setScreen("home")}
        onConfirm={() => {
          void confirmTrash();
        }}
        onHome={reset}
      />
    );
  }

  if (screen === "review") {
    return (
      <ReviewScreen
        queued={queued}
        remaining={remaining.length}
        reviewed={decisions.length}
        total={files.length}
        kept={keptCount(decisions)}
        queuedBytes={queuedBytes(decisions)}
        backLabel={
          reviewReturn === "duplicates" &&
          dupSteps(exactClusters, similarHashes).length > 0
            ? "Back to duplicates"
            : remaining.length > 0
              ? "Back to swiping"
              : "Back"
        }
        failedTrash={failedTrash}
        onUnqueue={unqueue}
        onBack={leaveReview}
        onConfirm={() => {
          void confirmTrash();
        }}
        onHome={reset}
      />
    );
  }

  if (screen === "protect") {
    return (
      <ProtectScreen
        settings={protection}
        onChange={setProtection}
        onBack={() => setScreen("home")}
      />
    );
  }

  if (screen === "skips") {
    return (
      <SkipDetailsScreen
        summary={skipSummary ?? EMPTY_SKIP_SUMMARY}
        allProtected={files.length === 0}
        onBack={leaveSkips}
        onHome={reset}
      />
    );
  }

  if (screen === "progress") {
    return (
      <ProgressScreen progress={trashProgress} total={trashProgress?.total ?? 0} />
    );
  }

  if (screen === "summary") {
    const canContinue =
      failedTrash.length > 0 ||
      remaining.length > 0 ||
      dupSteps(exactClusters, similarHashes).length > 0;
    return (
      <SummaryScreen
        results={trashResults}
        bytesMoved={lastTrashBytes}
        canContinue={canContinue}
        puttingBack={puttingBack}
        putBackError={putBackError}
        onPutBack={lastTrashedFiles.length > 0 ? () => void putBack() : undefined}
        onContinue={continueFromSummary}
        onDone={reset}
      />
    );
  }

  return (
    <Home
      options={options}
      onChange={setOptions}
      onPickFolder={chooseFolder}
      onStart={() => {
        void startScan();
      }}
      onProtect={() => setScreen("protect")}
      onSeeSkips={
        skipSummary && skipSummary.total > 0
          ? () => goSeeSkips("home")
          : undefined
      }
      picking={picking}
      rootCheck={rootCheck}
      lastSkipSummary={skipSummary}
      scanError={scanError}
    />
  );
}

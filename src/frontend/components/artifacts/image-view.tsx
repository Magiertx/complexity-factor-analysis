"use client";

import { useState, useEffect } from "react";
import { ZoomIn, ZoomOut, Download, X, RotateCcw, Maximize2, SunMoon } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { localizedAlgoText, useT } from "@/lib/i18n";

type I = Extract<Artifact, { kind: "image" }>;

export function ImageView({ artifact, runId, fixedHeight = false }: { artifact: I; runId?: string | null; fixedHeight?: boolean }) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [bgType, setBgType] = useState<"grid" | "light" | "dark">("grid");

  // Escape key closes lightbox
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const zoomIn = () => setScale((s) => Math.min(s + 0.5, 5));
  const zoomOut = () => {
    setScale((s) => {
      const next = Math.max(s - 0.5, 1);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };
  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale === 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scale === 1) return;
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPosition({ x: touch.clientX - dragStart.x, y: touch.clientY - dragStart.y });
  };

  const handleTouchEnd = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = 0.2;
    const nextScale = e.deltaY < 0 ? Math.min(scale + factor, 5) : Math.max(scale - factor, 1);
    if (nextScale === 1) setPosition({ x: 0, y: 0 });
    setScale(nextScale);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = `data:${artifact.mime};base64,${artifact.data_base64}`;
    link.download = artifact.label || "process_model.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cycleBg = () => {
    setBgType((current) => {
      if (current === "grid") return "light";
      if (current === "light") return "dark";
      return "grid";
    });
  };

  const getBgStyle = () => {
    if (bgType === "light") return { backgroundColor: "#ffffff" };
    if (bgType === "dark") return { backgroundColor: "#18181b" };
    return {
      backgroundImage: "conic-gradient(#e5e7eb 0.25turn, #ffffff 0.25turn 0.5turn, #e5e7eb 0.5turn 0.75turn, #ffffff 0.75turn)",
      backgroundSize: "20px 20px",
    };
  };

  const bgLabel = {
    grid: t("artifacts.image.bg_transparent"),
    light: t("artifacts.image.bg_light"),
    dark: t("artifacts.image.bg_dark"),
  }[bgType];

  const imgSrc = `data:${artifact.mime};base64,${artifact.data_base64}`;
  const label = localizedAlgoText(artifact.label, t);
  const caption = artifact.caption ? localizedAlgoText(artifact.caption, t) : null;

  return (
    <>
      <figure className="rounded-md bg-tile/40 overflow-hidden bg-white group relative">
        {/* Direct download button visible on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
          title={t("artifacts.image.download_title")}
          className="absolute top-2.5 right-2.5 z-20 h-8 w-8 rounded-full bg-black/75 hover:bg-black/90 text-white flex items-center justify-center backdrop-blur-sm shadow-lg border border-white/15 opacity-0 group-hover:opacity-100 transition duration-200"
        >
          <Download className="h-4 w-4" />
        </button>

        <div
          onClick={handleOpen}
          className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors cursor-zoom-in flex items-center justify-center z-10"
        >
          <span className="opacity-0 group-hover:opacity-100 bg-black/70 text-white rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 backdrop-blur-sm transition shadow-lg pointer-events-none">
            <Maximize2 className="h-3.5 w-3.5" />
            {t("artifacts.image.preview_zoom")}
          </span>
        </div>
        {fixedHeight ? (
          <div className="w-full h-64 md:h-80 flex items-center justify-center bg-white p-4">
            <img
              src={imgSrc}
              alt={label}
              className="max-w-full max-h-full object-contain transition group-hover:scale-[1.01]"
            />
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={label}
            className="w-full h-auto block transition group-hover:scale-[1.01]"
          />
        )}
        {(artifact.caption || runId) && (
          <figcaption className="px-3 py-2 text-xs text-muted border-t border-border bg-surface relative z-20 flex items-center justify-between gap-3 flex-wrap">
            <span>{caption || t("artifacts.image.process_model_fallback")}</span>
            {runId && (
              <span className="text-[10px] font-mono bg-accent/15 text-accent-ink px-2 py-0.5 rounded-full shrink-0">
                {t("artifacts.image.run_label", { id: runId.slice(0, 8) })}
              </span>
            )}
          </figcaption>
        )}
      </figure>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 select-none">
          {/* Backdrop Click */}
          <div className="absolute inset-0" onClick={handleClose} />

          {/* Floating Actions Toolbar */}
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800 backdrop-blur-md rounded-full px-4 py-2 z-50 shadow-2xl">
            <button
              onClick={zoomOut}
              disabled={scale === 1}
              title={t("artifacts.image.zoom_out_title")}
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-300 hover:text-white transition disabled:opacity-40"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs font-mono text-zinc-400 min-w-[45px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={scale === 5}
              title={t("artifacts.image.zoom_in_title")}
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-300 hover:text-white transition disabled:opacity-40"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={resetZoom}
              title={t("artifacts.image.reset_zoom_title")}
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <div className="w-[1px] h-5 bg-zinc-800 mx-1" />
            <button
              onClick={cycleBg}
              title={t("artifacts.image.toggle_bg_title", { bg: bgLabel })}
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
            >
              <SunMoon className="h-4 w-4" />
            </button>
            <div className="w-[1px] h-5 bg-zinc-800 mx-1" />
            <button
              onClick={handleDownload}
              title={t("artifacts.image.download_image_title")}
              className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
            >
              <Download className="h-4 w-4" />
            </button>
            <div className="w-[1px] h-5 bg-zinc-800 mx-1" />
            <button
              onClick={handleClose}
              title={t("artifacts.image.close_title")}
              className="h-8 w-8 rounded-full flex items-center justify-center bg-accent/20 hover:bg-accent text-accent-ink hover:text-accent-fg transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Interactive Image Container */}
          <div
            className="w-full h-full flex items-center justify-center overflow-hidden z-10"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
          >
            <div
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
                transition: isDragging ? "none" : "transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)",
                cursor: scale === 1 ? "default" : isDragging ? "grabbing" : "grab",
                willChange: "transform",
              }}
              className="relative select-none flex items-center justify-center"
            >
              <img
                src={imgSrc}
                alt={label}
                draggable={false}
                style={getBgStyle()}
                className="max-w-[95vw] max-h-[85vh] object-contain rounded-md shadow-2xl"
              />
            </div>
          </div>

          {/* Bottom Info Bar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-zinc-900/80 backdrop-blur-md px-4 py-2 rounded-full border border-zinc-800/80 text-xs text-zinc-300 z-10 shadow-2xl font-medium flex items-center gap-2">
            <span>{label || t("artifacts.image.process_model_fallback")}</span>
            {runId && <span className="text-zinc-500">·</span>}
            {runId && <span className="text-zinc-400">{t("artifacts.image.run_label", { id: runId.slice(0, 8) })}</span>}
            {caption && <span className="text-zinc-500">·</span>}
            {caption && <span className="text-zinc-400">{caption}</span>}
            <span className="text-zinc-500">·</span>
            <span className="text-accent-ink text-[11px] bg-accent/20 px-2 py-0.5 rounded-full">{bgLabel}</span>
          </div>
        </div>
      )}
    </>
  );
}

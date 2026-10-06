/**
 * 宠物精灵图 canvas 播放器。
 * - drawImage 源矩形切帧；逐帧时长驱动。
 * - prefers-reduced-motion 时只画首帧。
 * - 图片解码失败显示空白占位，不抛错。
 */
import { useEffect, useRef } from "react";
import type { PetManifest } from "@nex/shared";
import { PET_DISPLAY_HEIGHT_PX } from "@nex/shared";
import { resolvePetAnimationFrames } from "./petSpriteFrames.js";
import { logger } from "@/logger.js";

interface PetSpriteProps {
  spriteUrl: string;
  manifest: PetManifest | null;
  animationName: string;
  /** 展示高度（px）；宽度按帧宽高比自动推导。 */
  heightPx?: number;
  className?: string;
}

export function PetSprite({
  spriteUrl,
  manifest,
  animationName,
  heightPx = PET_DISPLAY_HEIGHT_PX,
  className,
}: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const framesRef = useRef(resolvePetAnimationFrames(manifest, animationName));

  useEffect(() => {
    framesRef.current = resolvePetAnimationFrames(manifest, animationName);
  }, [manifest, animationName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let cancelled = false;
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let frameIndex = 0;

    const image = new Image();
    image.decoding = "async";
    image.src = spriteUrl;
    imageRef.current = image;

    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const drawFrame = (index: number) => {
      const frames = framesRef.current;
      const frame = frames[index % frames.length];
      if (!frame || !image.complete || image.naturalWidth === 0) return;
      const scale = heightPx / frame.sh;
      const widthPx = Math.round(frame.sw * scale);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== widthPx * dpr || canvas.height !== heightPx * dpr) {
        canvas.width = widthPx * dpr;
        canvas.height = heightPx * dpr;
        canvas.style.width = `${widthPx}px`;
        canvas.style.height = `${heightPx}px`;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, widthPx, heightPx);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, widthPx, heightPx);
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const frames = framesRef.current;
      const current = frames[frameIndex % frames.length];
      const delay = current?.durationMs ?? 120;
      timerId = setTimeout(() => {
        if (cancelled) return;
        frameIndex = (frameIndex + 1) % frames.length;
        rafId = requestAnimationFrame(() => {
          drawFrame(frameIndex);
          scheduleNext();
        });
      }, delay);
    };

    image
      .decode()
      .then(() => {
        if (cancelled) return;
        drawFrame(0);
        if (!reducedMotion) {
          scheduleNext();
        }
      })
      .catch((error: unknown) => {
        logger.warn(
          `[pets] 精灵图解码失败 ${spriteUrl}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      cancelAnimationFrame(rafId);
    };
  }, [spriteUrl, heightPx, animationName, manifest]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

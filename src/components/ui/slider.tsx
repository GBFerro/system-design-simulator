"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  className?: string;
  value?: number[];
  defaultValue?: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number[]) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Human-readable value for screen readers (e.g. "12,000 requests per second"). */
  "aria-valuetext"?: string;
}

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-valuetext": ariaValueText,
}: SliderProps) {
  const currentValue = value?.[0] ?? defaultValue?.[0] ?? min;
  const percentage = ((currentValue - min) / (max - min)) * 100;

  return (
    <div
      data-slot="slider"
      className={cn("relative flex h-5 w-full touch-none items-center select-none", className)}
    >
      {/* Track background */}
      <div className="relative h-1.5 w-full rounded-full bg-zinc-800">
        {/* Filled track */}
        <div
          className="absolute h-full rounded-full bg-cyan-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {/* Native range input — fully visible, styled */}
      <input
        type="range"
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-valuetext={ariaValueText}
        min={min}
        max={max}
        step={step}
        value={currentValue}
        disabled={disabled}
        onChange={(e) => {
          onValueChange?.([Number(e.target.value)]);
        }}
        className={cn(
          "absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-95",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-cyan-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm",
          "[&::-webkit-slider-runnable-track]:h-0 [&::-webkit-slider-runnable-track]:appearance-none",
          "[&::-moz-range-track]:h-0 [&::-moz-range-track]:appearance-none",
          disabled && "pointer-events-none opacity-50",
        )}
      />
    </div>
  );
}

export { Slider };

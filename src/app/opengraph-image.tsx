import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SystemForge — System Design Interview Simulator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background:
          "radial-gradient(1000px 500px at 80% -10%, rgba(34,211,238,0.18), transparent), #0b0e14",
        padding: "72px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Logo lockup */}
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="g" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#5eead4" />
              <stop offset="0.55" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <path
            d="M16 8 L8 23 M16 8 L24 23 M8 23 L24 23"
            stroke="url(#g)"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <circle cx="8" cy="23" r="3.1" fill="#0b1220" stroke="url(#g)" strokeWidth="2.1" />
          <circle cx="24" cy="23" r="3.1" fill="#0b1220" stroke="url(#g)" strokeWidth="2.1" />
          <circle cx="16" cy="8" r="4" fill="url(#g)" />
        </svg>
        <span
          style={{ fontSize: "40px", fontWeight: 800, color: "#fafafa", letterSpacing: "-1px" }}
        >
          SystemForge
        </span>
      </div>

      {/* Headline */}
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div
          style={{
            fontSize: "68px",
            fontWeight: 800,
            color: "#fafafa",
            letterSpacing: "-2px",
            lineHeight: 1.05,
          }}
        >
          Build architectures.
        </div>
        <div
          style={{
            fontSize: "68px",
            fontWeight: 800,
            letterSpacing: "-2px",
            lineHeight: 1.05,
            color: "#22d3ee",
          }}
        >
          Simulate. Get scored.
        </div>
        <div style={{ fontSize: "30px", color: "#a1a1aa", marginTop: "8px" }}>
          The open-source system design interview simulator · 35 problems
        </div>
      </div>

      {/* Footer chips */}
      <div style={{ display: "flex", gap: "14px" }}>
        {["Drag & wire components", "Production-scale traffic", "5-category scoring"].map((t) => (
          <div
            key={t}
            style={{
              display: "flex",
              fontSize: "22px",
              color: "#d4d4d8",
              border: "1px solid #27272a",
              background: "#101218",
              borderRadius: "999px",
              padding: "10px 22px",
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </div>,
    { ...size },
  );
}

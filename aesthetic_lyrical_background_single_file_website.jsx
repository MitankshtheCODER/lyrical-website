import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * A single‑file React app that creates an aesthetic, animated lyrical background
 * synchronized to an uploaded audio file or to timestamps from a pasted .lrc.
 *
 * How it works (quick):
 * 1) Drop an audio file (mp3/m4a/wav/ogg) OR paste a public URL.
 * 2) Paste lyrics (plain text) OR drop/paste an .lrc with timestamps.
 * 3) Click Play — the background animates to the music; lyrics appear line‑by‑line.
 *    If lyrics have timestamps (.lrc), they sync precisely. Otherwise we spread
 *    lines evenly across the track duration.
 *
 * No servers / keys required — everything runs in the browser.
 */

// ---------- Helpers ----------
function parseLRC(text) {
  // Returns array of { time: seconds, text: string }
  // Supports multiple timestamps on a single line.
  const lines = text.split(/\r?\n/);
  const entries = [];
  const timeTag = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const line of lines) {
    const tags = [...line.matchAll(timeTag)];
    const content = line.replace(timeTag, "").trim();
    if (!tags.length || !content) continue;
    for (const m of tags) {
      const min = parseInt(m[1], 10) || 0;
      const sec = parseInt(m[2], 10) || 0;
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      const t = min * 60 + sec + ms / 1000;
      entries.push({ time: t, text: content });
    }
  }
  // sort by time
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Theme Presets ----------
const THEMES = {
  "Midnight Neon": {
    bgFrom: "#0f1023",
    bgTo: "#1a1b3a",
    accentA: "#7f5af0",
    accentB: "#2cb67d",
  },
  Aurora: {
    bgFrom: "#0b1220",
    bgTo: "#102a43",
    accentA: "#5eead4",
    accentB: "#93c5fd",
  },
  Sunset: {
    bgFrom: "#1b0f1a",
    bgTo: "#2a172b",
    accentA: "#f59e0b",
    accentB: "#ef4444",
  },
  Blossom: {
    bgFrom: "#1a1020",
    bgTo: "#2a1a2f",
    accentA: "#fb7185",
    accentB: "#a78bfa",
  },
};

const FONTS = [
  { name: "Inter", class: "font-sans" },
  { name: "Serif", class: "font-serif" },
  { name: "Mono", class: "font-mono" },
  { name: "Cinematic", class: "[font-family:Georgia,Times,\"Times New Roman\",serif]" },
  { name: "Grotesk", class: "[font-family:'Space Grotesk',system-ui,sans-serif]" },
];

export default function App() {
  const [audioUrl, setAudioUrl] = useState("");
  const [rawLyrics, setRawLyrics] = useState("");
  const [parsed, setParsed] = useState([]); // [{time, text}] if .lrc
  const [unsyncedLines, setUnsyncedLines] = useState([]); // plain text lines
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [themeKey, setThemeKey] = useState("Midnight Neon");
  const [fontKey, setFontKey] = useState("Inter");
  const [blurBg, setBlurBg] = useState(24);
  const [density, setDensity] = useState(60); // particles
  const [lyricSize, setLyricSize] = useState(72);
  const [shadow, setShadow] = useState(true);

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const dataRef = useRef(null);

  const theme = THEMES[themeKey];
  const fontClass = useMemo(() => {
    return FONTS.find((f) => f.name === fontKey)?.class || "font-sans";
  }, [fontKey]);

  // Re-parse when lyrics change
  useEffect(() => {
    if (!rawLyrics.trim()) {
      setParsed([]);
      setUnsyncedLines([]);
      return;
    }
    const asLrc = parseLRC(rawLyrics);
    if (asLrc.length) {
      setParsed(asLrc);
      setUnsyncedLines([]);
    } else {
      const lines = rawLyrics
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      setParsed([]);
      setUnsyncedLines(lines);
    }
  }, [rawLyrics]);

  // Visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    // particles
    const particles = [];
    const count = Math.max(10, Math.min(400, density));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5,
      });
    }

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, theme.bgFrom);
    gradient.addColorStop(1, theme.bgTo);

    const draw = () => {
      // Background
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Audio energy
      let energy = 0.1;
      if (dataRef.current) {
        const arr = dataRef.current;
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        energy = sum / (arr.length * 255);
      }

      // Glow fog
      const fogCount = 6;
      for (let i = 0; i < fogCount; i++) {
        const x = (i / fogCount) * width + Math.sin(i + performance.now() / 20000) * 80;
        const y = (i / fogCount) * height + Math.cos(i + performance.now() / 15000) * 80;
        const rad = Math.max(width, height) * (0.3 + 0.5 * energy);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `${theme.accentA}10`);
        g.addColorStop(1, "#00000000");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        p.x += p.vx + (Math.random() - 0.5) * 0.2 * energy;
        p.y += p.vy + (Math.random() - 0.5) * 0.2 * energy;
        if (p.x < 0) p.x = width; if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height; if (p.y > height) p.y = 0;
        const rr = p.r * (1 + energy * 2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 8);
        g.addColorStop(0, `${theme.accentB}80`);
        g.addColorStop(1, "#00000000");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [theme.bgFrom, theme.bgTo, theme.accentA, theme.accentB, density]);

  // Hook up WebAudio analyser
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let ctx, analyser, src, data;

    const setup = () => {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const bufferLength = analyser.frequencyBinCount;
      data = new Uint8Array(bufferLength);
      dataRef.current = data;
      analyserRef.current = analyser;

      src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(ctx.destination);
    };

    const onPlay = () => {
      setup();
      if (ctx.state === "suspended") ctx.resume();
      const tick = () => {
        if (analyser) analyser.getByteFrequencyData(data);
        if (!audio.paused) requestAnimationFrame(tick);
      };
      tick();
    };

    audio.addEventListener("play", onPlay);
    return () => audio.removeEventListener("play", onPlay);
  }, []);

  // Determine current lyric line
  const [now, setNow] = useState(0);
  useEffect(() => {
    const audio = audioRef.current;
    let id;
    const loop = () => {
      setNow(audio?.currentTime || 0);
      id = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, []);

  const duration = audioRef.current?.duration || 0;

  const currentIndex = useMemo(() => {
    if (parsed.length) {
      let idx = parsed.findIndex((e, i) => {
        const next = parsed[i + 1]?.time ?? Infinity;
        return now >= e.time && now < next;
      });
      if (idx === -1 && now >= (parsed.at(-1)?.time ?? Infinity)) idx = parsed.length - 1;
      return idx;
    }
    if (unsyncedLines.length && duration > 0) {
      const per = duration / unsyncedLines.length;
      const idx = Math.min(unsyncedLines.length - 1, Math.floor(now / per));
      return idx;
    }
    return -1;
  }, [parsed, unsyncedLines, now, duration]);

  const currentText = useMemo(() => {
    if (parsed.length && currentIndex >= 0) return parsed[currentIndex].text;
    if (unsyncedLines.length && currentIndex >= 0) return unsyncedLines[currentIndex];
    return "";
  }, [parsed, unsyncedLines, currentIndex]);

  const prevText = useMemo(() => {
    const idx = Math.max(0, currentIndex - 1);
    if (parsed.length && currentIndex > 0) return parsed[idx].text;
    if (unsyncedLines.length && currentIndex > 0) return unsyncedLines[idx];
    return "";
  }, [parsed, unsyncedLines, currentIndex]);

  const nextText = useMemo(() => {
    const idx = Math.min((parsed.length || unsyncedLines.length) - 1, currentIndex + 1);
    if (parsed.length && currentIndex >= 0 && idx !== currentIndex) return parsed[idx].text;
    if (unsyncedLines.length && currentIndex >= 0 && idx !== currentIndex) return unsyncedLines[idx];
    return "";
  }, [parsed, unsyncedLines, currentIndex]);

  // ---------- UI Handlers ----------
  const onPickAudio = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith("audio/")) return onPickAudio(file);
    if (file.name.toLowerCase().endsWith(".lrc") || file.type === "text/plain") {
      const reader = new FileReader();
      reader.onload = () => setRawLyrics(String(reader.result || ""));
      reader.readAsText(file);
    }
  };

  const exportPoster = async () => {
    // Simple text export for socials / reels captioning.
    const meta = `Title: ${title}\nArtist: ${artist}\n\nLyrics:\n${rawLyrics || (parsed.length ? parsed.map(e=>e.text).join("\n") : unsyncedLines.join("\n"))}`;
    downloadText(`${(title || "lyrics").replace(/[^a-z0-9]+/gi,'_')}.txt`, meta);
  };

  const exampleLyrics = `I wandered through the midnight air\nHumming songs nobody hears\nCity lights are fireflies\nDancing slow behind my tears\n\nIf you find me in the static\nHold my hand and count to ten\nLet the neon heal the panic\nTill the dawn begins again`;

  // ---------- Render ----------
  return (
    <div className={`relative min-h-screen w-full overflow-hidden ${fontClass}`} onDragOver={(e)=>e.preventDefault()} onDrop={onDrop}>
      {/* Canvas Visualizer */}
      <canvas ref={canvasRef} className="fixed inset-0 -z-10" />

      {/* Glass overlay for blur & tint */}
      <div
        className="pointer-events-none fixed inset-0 -z-0"
        style={{ backdropFilter: `blur(${blurBg}px)`, WebkitBackdropFilter: `blur(${blurBg}px)` }}
      />

      {/* Top controls */}
      <div className="absolute top-0 w-full p-4 md:p-6 flex flex-wrap gap-3 items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <div className="text-xl md:text-2xl font-semibold tracking-wide">Lyrical Aesthetic</div>
          <div className="hidden md:block opacity-80">Drag & drop audio or .lrc anywhere</div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select className="bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2" value={themeKey} onChange={(e)=>setThemeKey(e.target.value)}>
            {Object.keys(THEMES).map(k=> <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2" value={fontKey} onChange={(e)=>setFontKey(e.target.value)}>
            {FONTS.map(f=> <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
          <label className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
            <span className="opacity-80">Blur</span>
            <input type="range" min={0} max={40} value={blurBg} onChange={(e)=>setBlurBg(+e.target.value)} />
          </label>
          <label className="hidden md:flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
            <span className="opacity-80">Particles</span>
            <input type="range" min={10} max={300} value={density} onChange={(e)=>setDensity(+e.target.value)} />
          </label>
          <button className="bg-white/10 hover:bg-white/20 rounded-xl px-4 py-2" onClick={exportPoster}>Export .txt</button>
        </div>
      </div>

      {/* Center stage */}
      <div className="relative z-10 flex flex-col md:flex-row gap-6 items-stretch justify-center min-h-screen pt-24 pb-32 px-4 md:px-10 text-white">
        {/* Left: Inputs */}
        <div className="md:w-[420px] w-full bg-white/5 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-white/10 shadow-xl">
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wider opacity-80">Song Title</label>
              <input className="w-full mt-1 bg-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 ring-white/30" placeholder="e.g., Night Drive" value={title} onChange={(e)=>setTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider opacity-80">Artist</label>
              <input className="w-full mt-1 bg-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 ring-white/30" placeholder="e.g., Lofi Vision" value={artist} onChange={(e)=>setArtist(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider opacity-80">Audio</label>
              <div className="flex gap-2 mt-1">
                <label className="flex-1 bg-white/10 rounded-xl px-3 py-2 cursor-pointer hover:bg-white/20 text-center">Upload
                  <input type="file" accept="audio/*" className="hidden" onChange={(e)=>onPickAudio(e.target.files?.[0])} />
                </label>
              </div>
              <input className="w-full mt-2 bg-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 ring-white/30" placeholder="…or paste a direct audio URL (CORS-permitting)" onBlur={(e)=>setAudioUrl(e.target.value)} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider opacity-80">Lyrics / .lrc</label>
                <button className="text-xs opacity-80 hover:opacity-100 underline" onClick={()=>setRawLyrics(exampleLyrics)}>Load example</button>
              </div>
              <textarea className="w-full mt-1 min-h-[140px] bg-white/10 rounded-xl px-3 py-2 outline-none focus:ring-2 ring-white/30" placeholder={"Paste lyrics here (plain text), or paste .lrc text with timestamps like\n[00:11.20] first line\n[00:21.50] second line"} value={rawLyrics} onChange={(e)=>setRawLyrics(e.target.value)} />
              <div className="text-xs opacity-80 mt-2">Tip: Drop a .lrc file onto the page for perfect sync.</div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider opacity-80">Lyric Size</label>
              <input type="range" min={28} max={120} className="w-full" value={lyricSize} onChange={(e)=>setLyricSize(+e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={shadow} onChange={(e)=>setShadow(e.target.checked)} />
                <span className="text-sm opacity-90">Soft glow behind text</span>
              </label>
            </div>
            <div className="pt-2">
              <audio ref={audioRef} src={audioUrl} controls className="w-full" />
            </div>
          </div>
        </div>

        {/* Right: Lyrical stage */}
        <div className="relative flex-1 rounded-3xl border border-white/10 bg-black/10 overflow-hidden shadow-2xl">
          {/* Title + artist */}
          <div className="absolute top-4 left-4 right-4 md:top-6 md:left-6 md:right-6 flex items-center justify-between text-white/90">
            <div className="truncate">
              <div className="text-sm uppercase tracking-widest opacity-80">{artist || "Artist"}</div>
              <div className="text-2xl md:text-3xl font-semibold tracking-wide">{title || "Title"}</div>
            </div>
            <div className="text-xs opacity-70 bg-white/10 rounded-full px-3 py-1">Live Visual</div>
          </div>

          {/* Current + neighbor lines */}
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-4xl text-center select-none">
              <AnimatePresence initial={false}>
                <motion.div
                  key={currentIndex}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 120, damping: 18 }}
                  className="px-2"
                >
                  <div
                    className="leading-tight md:leading-snug font-semibold"
                    style={{
                      fontSize: `${lyricSize}px`,
                      textShadow: shadow ? `0 10px 40px ${theme.accentA}55, 0 0 1px #000` : "none",
                      filter: shadow ? "drop-shadow(0 5px 20px rgba(0,0,0,0.6))" : "none",
                    }}
                  >
                    {currentText || "Your lyrics will appear here."}
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Previous / next ghost lines */}
              <div className="mt-6 text-white/60 text-base md:text-lg">
                <div className="line-clamp-1">{prevText}</div>
                <div className="line-clamp-1">{nextText}</div>
              </div>
            </div>
          </div>

          {/* Bottom helper bar */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/50 to-transparent text-white/90 flex items-center justify-between">
            <div className="text-xs opacity-80">{parsed.length ? "Synced via .lrc" : unsyncedLines.length ? "Auto‑timed (even spread)" : "No lyrics yet"}</div>
            <div className="text-xs opacity-80">{formatTime(now)} / {isFinite(duration) && duration > 0 ? formatTime(duration) : "--:--"}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 w-full p-4 text-center text-white/70 text-xs">
        Pro tip: Use timestamped .lrc for precise syncing. Drag & drop to load quickly.
      </div>
    </div>
  );
}

function formatTime(sec) {
  if (!isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

import * as THREE from "three";
import { registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { CFG } from "./config.js";
import { initTheme, onTheme } from "./theme.js";
import { isNative } from "./notify.js";
import { initFeed } from "./feed.js";

const Sonakshi = registerPlugin("Sonakshi");
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

initTheme();

/* ───────── Three.js arc reactor ───────── */
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 9);

const mats = [];   // every material, so a theme switch can swap blending in one pass
const glow = (color, opacity = 0.9) => {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.push(m); return m;
};
const reactor = new THREE.Group();
scene.add(reactor);

const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), glow(0x46e3ff));
reactor.add(core);
const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.78, 64), glow(0x46e3ff, 0.6));
reactor.add(halo);

const rings = [
  { r: 1.5, t: 0.025, speed: 0.6, tilt: 1.1 },
  { r: 2.1, t: 0.018, speed: -0.4, tilt: 0.5 },
  { r: 2.8, t: 0.012, speed: 0.25, tilt: -0.8 },
].map(({ r, t, speed, tilt }) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 128), glow(0x46e3ff, 0.7));
  m.rotation.x = tilt; m.userData.speed = speed; reactor.add(m); return m;
});

// segmented coil ring: the arc-reactor look
const coil = new THREE.Group();
for (let i = 0; i < 12; i++) {
  const seg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), glow(0x46e3ff, 0.8));
  const a = (i / 12) * Math.PI * 2;
  seg.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
  seg.rotation.z = a; coil.add(seg);
}
reactor.add(coil);

// dust field
const N = 450, pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  const a = Math.random() * Math.PI * 2, r = 3.2 + Math.random() * 3.5;
  pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * 5; pos[i * 3 + 2] = Math.sin(a) * r - 2;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0x46e3ff, size: 0.03, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
mats.push(dustMat);
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.position.z = w / h < 0.8 ? 11 : 9; // portrait phones sit further back
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

/* Dark: glowing additive cyan on near-black. Light: the same shapes in deeper inks on paper (additive blending is invisible on light). */
const PALETTE = {
  dark:  { bg: 0x04080d, blend: THREE.AdditiveBlending, sleep: 0x46e3ff, thinking: 0xffae42, speaking: 0xcffaff },
  light: { bg: 0xeef3f6, blend: THREE.NormalBlending,   sleep: 0x0a8fa8, thinking: 0xc2650d, speaking: 0x0b6e83 },
};
const LOOK = {
  sleep:     { spin: 0.15, pulse: 0.0, label: isNative ? "standing by" : "ready" },
  listening: { spin: 0.8,  pulse: 1.0, label: "listening" },
  thinking:  { spin: 2.4,  pulse: 0.2, label: "thinking" },
  speaking:  { spin: 1.0,  pulse: 0.6, label: "speaking" },
};
let COLORS = {};
const tint = new THREE.Color(0x46e3ff);
onTheme((t) => {
  const P = PALETTE[t];
  renderer.setClearColor(P.bg);
  mats.forEach((m) => { m.blending = P.blend; m.needsUpdate = true; });
  COLORS = {
    sleep: new THREE.Color(P.sleep), listening: new THREE.Color(P.sleep),
    thinking: new THREE.Color(P.thinking), speaking: new THREE.Color(P.speaking),
  };
});

let state = "sleep", level = 0, levelTarget = 0, spin = 0.15;

function setState(s) {
  state = s; $("status").textContent = LOOK[s].label;
  document.body.dataset.state = s;          // drives the avatar ring colour in CSS
  if (s !== "listening") levelTarget = 0;
}
setState("sleep");

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, L = LOOK[state];
  tint.lerp(COLORS[state], 0.08);
  spin += (L.spin - spin) * 0.05;
  if (state === "speaking") levelTarget = 0.35 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.1);
  level += (levelTarget - level) * 0.2;

  core.scale.setScalar(1 + level * 0.6 * L.pulse + 0.04 * Math.sin(t * 2));
  halo.scale.setScalar(1 + level * 0.5);
  core.material.color.copy(tint); halo.material.color.copy(tint);
  rings.forEach((r) => { r.rotation.z += r.userData.speed * spin * dt; r.material.color.copy(tint); });
  coil.rotation.z -= 0.4 * spin * dt; coil.children.forEach((c) => c.material.color.copy(tint));
  dust.rotation.y += 0.05 * spin * dt; dust.material.color.copy(tint);
  reactor.rotation.y = Math.sin(t * 0.3) * 0.25;
  renderer.render(scene, camera);
}
const startRender = () => { clock.start(); renderer.setAnimationLoop(frame); };
const stopRender = () => renderer.setAnimationLoop(null); // zero GPU/CPU while hidden

// keep the floating widget just above the reply text, whatever its height
new ResizeObserver(() => document.documentElement.style.setProperty("--main-h", `${$("main").offsetHeight}px`)).observe($("main"));

/* ───────── Conversation lifecycle ───────── */
let busy = false;

async function ask(text) {
  for (let i = 0; i < 4; i++) {            // data can take 1-2 s to come up after MacroDroid enables it
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(CFG.API_URL, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "X-Sonakshi-Key": CFG.API_KEY },
        body: JSON.stringify({ text }),
      });
      clearTimeout(timer);
      if (r.ok) return (await r.json()).reply;
    } catch { clearTimeout(timer); }
    await wait(500 * (i + 1));
  }
  return "I can't reach my brain right now.";
}

async function respond(text) {
  $("you").textContent = text; $("reply").textContent = "";
  setState("thinking");
  const reply = await ask(text);
  $("reply").textContent = reply;
  if (isNative) { setState("speaking"); await Sonakshi.speak({ text: reply }); }
  else setState("sleep");                   // browser build: typed chat, text reply
}

async function sleep() {
  setState("sleep"); $("you").textContent = ""; $("reply").textContent = "";
  await Sonakshi.sleep();   // native: tells MacroDroid to cut data, resumes Porcupine, moves task to back
  busy = false;
}

async function session() {
  if (busy) return; busy = true;
  for (;;) {                                  // follow-ups continue until a silent window
    setState("listening");
    const { text } = await Sonakshi.listen({ maxMs: CFG.IDLE_MS });
    if (!text) break;
    await respond(text);
  }
  await sleep();
}

/* ───────── Read aloud (feed cards) ───────── */
const canStop = !isNative && "speechSynthesis" in window;
let speakToken = 0;

async function webSpeak(text) {
  const token = ++speakToken;
  speechSynthesis.cancel();
  // long utterances get cut off by some browsers, so speak sentence by sentence
  for (const part of text.match(/[^.!?\n]+[.!?]*\s*/g) || [text]) {
    if (token !== speakToken) return;
    if (!part.trim()) continue;
    await new Promise((done) => {
      const u = new SpeechSynthesisUtterance(part.trim());
      u.lang = "en-IN"; u.onend = u.onerror = done;
      speechSynthesis.speak(u);
    });
  }
}

async function readAloud(text) {
  const idle = !busy;
  if (idle) setState("speaking");
  try {
    if (isNative) await Sonakshi.speak({ text });
    else if (canStop) await webSpeak(text);
  } catch { /* TTS unavailable */ }
  finally { if (idle && !busy) setState("sleep"); }
}

const feed = initFeed({
  speak: readAloud,
  stop: () => { speakToken++; speechSynthesis.cancel(); },
  canStop,
});

/* ───────── Native events (Android app only) ───────── */
if (isNative) {
  Sonakshi.addListener("rms", ({ level: v }) => { if (state === "listening") levelTarget = v; });
  Sonakshi.addListener("partial", ({ text }) => { $("you").textContent = text; });

  // Text pushed from MacroDroid: Send Intent com.sonakshi.TEXT, extras: text, speak, prompt
  Sonakshi.addListener("macrodroidText", async ({ text, speak, prompt }) => {
    if (!text) return;
    if (prompt) { busy = true; await respond(text); busy = false; return session(); }
    $("reply").textContent = text; levelTarget = 0.8;
    if (speak) { setState("speaking"); await Sonakshi.speak({ text }); setState("sleep"); }
  });

  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) { startRender(); feed.setActive(true); session(); }
    else { stopRender(); feed.setActive(false); }
  });
} else {
  // Browser build: typed chat instead of the voice session
  const form = $("ask-form");
  form.classList.replace("hidden", "flex");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("ask-input").value.trim();
    if (!text || busy) return;
    $("ask-input").value = ""; busy = true;
    await respond(text);
    busy = false;
  });
  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? startRender() : stopRender()));
}

startRender();
if (isNative) session();

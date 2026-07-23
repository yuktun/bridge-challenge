import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, get, runTransaction } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);
const bridgeRef = path => ref(db, `${BRIDGE_PATH}/${path}`);
const sessionPayloads = new Map();

async function loadEventPayload(id) {
  if (sessionPayloads.has(id)) return sessionPayloads.get(id);
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    const enabled = (await get(bridgeRef("config/hiddenContentEnabled"))).val() === true;
    if (!enabled) return null;
    const value = (await get(bridgeRef(`privatePayloads/${id}`))).val();
    if (!value || typeof value !== "object") return null;
    sessionPayloads.set(id, value);
    return value;
  } catch {
    return null;
  }
}

function payloadText(value) {
  if (!value || typeof value !== "object") return String(value || "");
  return String(value[window.bridgeI18n?.language === "zh-HK" ? "zh" : "en"] || value.en || "");
}

function payloadTemplate(value, replacements = {}) {
  return Object.entries(replacements).reduce(
    (text, [key, replacement]) => text.replaceAll(`{${key}}`, replacement),
    payloadText(value)
  );
}

let serverOffset = 0;
let state = {};
let renderTicker = null;

const SUPER_BONUS_SOUND_ENABLED_KEY = "bridge-super-bonus-sound-enabled";
const SUPER_BONUS_PLAYED_EVENTS_KEY = "bridge-super-bonus-played-events";
let superBonusSoundEnabled = localStorage.getItem(SUPER_BONUS_SOUND_ENABLED_KEY) !== "false";
let superBonusAudioContext = null;
let superBonusAudioBufferPromise = null;
let superBonusActiveSource = null;
const pendingSuperBonusEvents = new Set();
let superBonusBellPlaying = false;
let superBonusBellPlaybackTimer = null;

function readPlayedSuperBonusEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(SUPER_BONUS_PLAYED_EVENTS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

const playedSuperBonusEvents = readPlayedSuperBonusEvents();

function rememberSuperBonusEvent(eventId) {
  if (!eventId || playedSuperBonusEvents.has(eventId)) return false;
  playedSuperBonusEvents.add(eventId);
  const recentEvents = [...playedSuperBonusEvents].slice(-100);
  try { localStorage.setItem(SUPER_BONUS_PLAYED_EVENTS_KEY, JSON.stringify(recentEvents)); } catch {}
  return true;
}

function getSuperBonusAudioContext() {
  if (!superBonusAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) superBonusAudioContext = new AudioContextClass();
  }
  return superBonusAudioContext;
}

function loadSuperBonusAudioBuffer() {
  if (!superBonusAudioBufferPromise) {
    const context = getSuperBonusAudioContext();
    if (!context) return Promise.resolve(null);

    const soundUrl = new URL("./super-bonus-victory-chime.mp3?v=1.0", import.meta.url);
    superBonusAudioBufferPromise = fetch(soundUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load Super Bonus sound (${response.status})`);
        return response.arrayBuffer();
      })
      .then(audioData => context.decodeAudioData(audioData))
      .catch(() => null);
  }
  return superBonusAudioBufferPromise;
}

async function unlockSuperBonusAudio() {
  try {
    const context = getSuperBonusAudioContext();
    if (context?.state === "suspended") await context.resume();
    if (context?.state === "running") {
      const silentSource = context.createOscillator();
      const silentGain = context.createGain();
      silentGain.gain.value = 0.00001;
      silentSource.connect(silentGain).connect(context.destination);
      silentSource.start();
      silentSource.stop(context.currentTime + 0.01);
      flushPendingSuperBonusEvents();
    }
  } catch {}
}

async function playSuperBonusWinningBell(onEnded) {
  try {
    const context = getSuperBonusAudioContext();
    if (!context || context.state !== "running") return false;

    const audioBuffer = await loadSuperBonusAudioBuffer();
    if (!audioBuffer || context.state !== "running") return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = audioBuffer;
    gain.gain.value = 0.9;
    source.connect(gain).connect(context.destination);
    source.onended = () => {
      if (superBonusActiveSource === source) superBonusActiveSource = null;
      onEnded?.();
    };
    superBonusActiveSource = source;
    source.start();
    return true;
  } catch {
    // The announcement remains visible if a browser blocks or lacks audio support.
    return false;
  }
}

async function flushPendingSuperBonusEvents() {
  if (!pendingSuperBonusEvents.size) return;

  if (!superBonusSoundEnabled) {
    pendingSuperBonusEvents.forEach(rememberSuperBonusEvent);
    pendingSuperBonusEvents.clear();
    return;
  }

  if (superBonusAudioContext?.state !== "running" || superBonusBellPlaying) return;

  const eventId = pendingSuperBonusEvents.values().next().value;
  superBonusBellPlaying = true;

  const finishPlayback = () => {
    clearTimeout(superBonusBellPlaybackTimer);
    superBonusBellPlaying = false;
    flushPendingSuperBonusEvents();
  };

  if (await playSuperBonusWinningBell(finishPlayback)) {
    rememberSuperBonusEvent(eventId);
    pendingSuperBonusEvents.delete(eventId);
    clearTimeout(superBonusBellPlaybackTimer);
    superBonusBellPlaybackTimer = setTimeout(finishPlayback, 12000);
  } else {
    superBonusBellPlaying = false;
  }
}

function queueSuperBonusWinningBell(eventId) {
  if (!eventId || playedSuperBonusEvents.has(eventId) || pendingSuperBonusEvents.has(eventId)) return;
  if (!superBonusSoundEnabled) {
    rememberSuperBonusEvent(eventId);
    return;
  }

  pendingSuperBonusEvents.add(eventId);
  unlockSuperBonusAudio();
}

loadSuperBonusAudioBuffer();

function updateSuperBonusSoundToggle() {
  const toggle = el("superBonusSoundToggle");
  if (!toggle) return;
  toggle.textContent = superBonusSoundEnabled ? "🔊" : "🔇";
  toggle.setAttribute("aria-pressed", String(superBonusSoundEnabled));
  toggle.setAttribute("aria-label", `Turn Super Bonus sound ${superBonusSoundEnabled ? "off" : "on"}`);
  toggle.title = `Super Bonus sound: ${superBonusSoundEnabled ? "on" : "off"}`;
}

el("superBonusSoundToggle")?.addEventListener("click", async () => {
  superBonusSoundEnabled = !superBonusSoundEnabled;
  try { localStorage.setItem(SUPER_BONUS_SOUND_ENABLED_KEY, String(superBonusSoundEnabled)); } catch {}
  updateSuperBonusSoundToggle();
  if (superBonusSoundEnabled) await unlockSuperBonusAudio();
  else {
    if (superBonusActiveSource) {
      try { superBonusActiveSource.stop(); } catch {}
      superBonusActiveSource = null;
    }
    flushPendingSuperBonusEvents();
  }
});

document.addEventListener("pointerdown", unlockSuperBonusAudio, { once:true, passive:true });
document.addEventListener("keydown", unlockSuperBonusAudio, { once:true });
updateSuperBonusSoundToggle();

const phases = [
  { name:"Strategy & Planning", duration:300, desc:"Plan your approach. Do not touch any materials yet.", cls:"" },
  { name:"Bridge Construction", duration:900, desc:"Build using only the provided paper and masking tape.", cls:"blue" },
  { name:"Judging & Load Testing", duration:300, desc:"Stop building and prepare for judging and the load test.", cls:"green" }
];

function nowServer(){ return Date.now() + serverOffset; }
function formatTime(sec){
  sec = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function currentRemaining(){
  const phase = phases[state.phaseIndex || 0];
  if(state.status === "running" && Number.isFinite(state.startedAt)){
    return Math.max(0, Number(state.remainingAtStart ?? phase.duration) - (nowServer() - state.startedAt)/1000);
  }
  return Number(state.pausedRemaining ?? state.remainingAtStart ?? phase.duration);
}
function renderTimer(){
  const idx = Math.min(2, Math.max(0, Number(state.phaseIndex || 0)));
  const phase = phases[idx];
  const remaining = currentRemaining();
  const status = state.status || "waiting";
  el("phaseName").textContent = phase.name;
  el("phaseDesc").textContent = phase.desc;
  el("timeDisplay").textContent = formatTime(remaining);
  el("timeDisplay").classList.toggle("urgent", status === "running" && remaining <= 10);
  el("phaseBadge").textContent = `PHASE ${idx+1} OF 3`;
  el("timerStatus").textContent =
    status === "running" ? "Running" :
    status === "paused" ? "Paused by MC" :
    status === "completed" ? "Phase complete" : "Waiting for MC";
  el("timerBox").className = `timerbox ${status === "waiting" ? "waiting" : phase.cls}`;
}
function renderAnnouncement(data={}){
  const box = el("announcement");
  const message = String(data.message || "").trim();
  if(!message){ box.className = "announcement hidden"; box.textContent = ""; return; }
  box.className = `announcement ${data.type || "info"}`;
  box.textContent = `📢 ${message}`;
}
function resetTicker(){
  clearInterval(renderTicker);
  renderTicker = setInterval(renderTimer, 250);
  renderTimer();
}

onValue(ref(db, ".info/connected"), snap => {
  const online = snap.val() === true;
  const badge = el("connectionBadge");
  badge.textContent = online ? "Live" : "Offline";
  badge.className = `connection ${online ? "online" : "offline"}`;
});
onValue(ref(db, ".info/serverTimeOffset"), snap => { serverOffset = snap.val() || 0; renderTimer(); });
onValue(bridgeRef("state"), snap => { state = snap.val() || {}; resetTicker(); });
onValue(bridgeRef("announcement"), snap => renderAnnouncement(snap.val() || {}));

document.querySelectorAll(".bottom button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".bottom button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    window.scrollTo({top:0,behavior:"smooth"});
  });
});

const info = {
  pier:"🥫 The Piers: Use exactly two metal coffee cans as the bridge supports.",
  gap:"📏 The Gap: The cans must remain at least 30 cm apart.",
  deck:"📄 The Bridge: Use no more than 15 A4 sheets and 60 cm of masking tape.",
  weight:"🏋️ The Goal: Hold as much weight as possible without collapsing or touching the table."
};
const hot = [...document.querySelectorAll(".hot")];
function activate(part){
  const box = el("diagramInfo");
  hot.forEach(x => { x.classList.toggle("active", x===part); x.classList.toggle("dim", x!==part); });
  box.textContent = window.bridgeI18n?.t(info[part.dataset.part]) || info[part.dataset.part];
  box.classList.add("highlight");
}
function clear(){
  hot.forEach(x => x.classList.remove("active","dim"));
  el("diagramInfo").textContent = window.bridgeI18n?.t("✨ Move over or tap a bridge component to inspect the rules.") || "✨ Move over or tap a bridge component to inspect the rules.";
  el("diagramInfo").classList.remove("highlight");
}

window.addEventListener("bridge-language-change", () => {
  const activePart = document.querySelector(".hot.active");
  if (activePart) activate(activePart); else clear();
});

hot.forEach(part => {
  part.addEventListener("mouseenter",()=>activate(part));
  part.addEventListener("mouseleave",clear);
  part.addEventListener("focus",()=>activate(part));
  part.addEventListener("blur",clear);
  part.addEventListener("click",()=>activate(part));
});

const checks = [...document.querySelectorAll(".check input")];
let bonusRevealTimer = null;
let bonusAlreadyRevealed = false;
const teamSpiritControl = el("teamSpiritControl");

function updateChecklistProgress() {
  const checkedCount = checks.filter(item => item.checked).length;
  el("checkProgress").style.width = `${checkedCount / checks.length * 100}%`;

  const firstThreeComplete = checks.slice(0, 3).every(item => item.checked);
  const firstChecklistItemComplete = Boolean(checks[0]?.checked);
  const reveal = el("bonusGameReveal");
  if (firstChecklistItemComplete) {
    loadEventPayload("p05").then(payload => {
      if (!payload || !checks[0]?.checked) return;
      teamSpiritButton.textContent = payloadText(payload.readyLabel);
      teamSpiritControl?.classList.remove("hidden");
    });
  } else {
    teamSpiritControl?.classList.add("hidden");
  }

  if (firstThreeComplete && !bonusAlreadyRevealed && !bonusRevealTimer) {
    bonusRevealTimer = setTimeout(async () => {
      bonusAlreadyRevealed = true;
      bonusRevealTimer = null;
      const payload = await loadEventPayload("p07");
      if (!payload) return;
      reveal.querySelector(".bonus-confetti").textContent = payload.revealIcon || "";
      reveal.querySelector(".bonus-label").textContent = payloadText(payload.revealLabel);
      reveal.querySelector("h3").textContent = payloadText(payload.revealTitle);
      const gameLink = reveal.querySelector(".bonus-game-button");
      gameLink.textContent = payloadText(payload.revealButton);
      gameLink.addEventListener("click", () => sessionStorage.setItem("bridge-access-p07", "1"), { once:true });
      reveal.classList.remove("hidden");
      reveal.classList.add("bonus-reveal-active");
      reveal.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 5000);
  }

  if (!firstThreeComplete && !bonusAlreadyRevealed) {
    clearTimeout(bonusRevealTimer);
    bonusRevealTimer = null;
  }
}

checks.forEach(item => item.addEventListener("change", updateChecklistProgress));

const teamSpiritButton = el("activateTeamSpirit");
const teamSpiritStatus = el("teamSpiritStatus");
const teamSpiritEffects = el("teamSpiritEffects");
let teamSpiritCooldownTimer = null;
let teamSpiritEffectTimer = null;

function clearTeamSpiritEffects() {
  clearTimeout(teamSpiritEffectTimer);
  document.body.classList.remove("team-spirit-glow");
  teamSpiritEffects?.classList.remove("team-spirit-effects-active");
  if (teamSpiritEffects) teamSpiritEffects.replaceChildren();
}

function launchTeamSpiritEffects() {
  clearTeamSpiritEffects();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const symbols = ["🎉", "🔥", "✨", "🌉", "💪"];
  const particleCount = reducedMotion ? 8 : 42;

  for (let index = 0; index < particleCount; index += 1) {
    const particle = document.createElement("span");
    particle.textContent = symbols[index % symbols.length];
    particle.style.setProperty("--confetti-x", `${Math.random() * 100}vw`);
    particle.style.setProperty("--confetti-drift", `${(Math.random() - .5) * 180}px`);
    particle.style.setProperty("--confetti-delay", `${Math.random() * .55}s`);
    particle.style.setProperty("--confetti-duration", `${2.1 + Math.random() * .8}s`);
    teamSpiritEffects?.appendChild(particle);
  }

  document.body.classList.add("team-spirit-glow");
  teamSpiritEffects?.classList.add("team-spirit-effects-active");
  teamSpiritEffectTimer = setTimeout(clearTeamSpiritEffects, 3000);
}

async function activateTeamSpirit() {
  if (!teamSpiritButton || teamSpiritButton.disabled) return;
  const payload = await loadEventPayload("p05");
  if (!payload) return;

  launchTeamSpiritEffects();
  openMomentPanelEgg({
    kind: "team-spirit",
    icon: payload.icon || "",
    title: payloadText(payload.title),
    copy: payloadText(payload.copy),
    button: payloadText(payload.button)
  });

  teamSpiritButton.disabled = true;
  teamSpiritButton.textContent = payloadText(payload.activeLabel);
  if (teamSpiritStatus) teamSpiritStatus.textContent = payloadText(payload.cooldownLabel);

  clearTimeout(teamSpiritCooldownTimer);
  teamSpiritCooldownTimer = setTimeout(() => {
    teamSpiritButton.disabled = false;
    teamSpiritButton.textContent = payloadText(payload.readyLabel);
    if (teamSpiritStatus) teamSpiritStatus.textContent = "";
  }, 5000);
}

teamSpiritButton?.addEventListener("click", activateTeamSpirit);

signInAnonymously(auth).catch(console.error);


// Design Lab unlock questions
const designAnswers = {
  pride: "a",
  red: "b",
  redlines: "a"
};

const unlockedHints = JSON.parse(localStorage.getItem("bridgeUnlockedHints") || "{}");

function unlockHint(questionKey, save = true){
  const card = document.querySelector(`.hint-card[data-hint="${questionKey}"]`);
  const question = document.getElementById(`question-${questionKey}`);
  const hint = document.getElementById(`hint-${questionKey}`);
  const status = document.getElementById(`status-${questionKey}`);

  card?.classList.add("unlocked");
  question?.classList.add("hidden");
  hint?.classList.remove("hidden");
  if(status) status.textContent = "✅ Unlocked";

  if(save){
    unlockedHints[questionKey] = true;
    localStorage.setItem("bridgeUnlockedHints", JSON.stringify(unlockedHints));
  }
}

Object.keys(unlockedHints).forEach(key => {
  if(unlockedHints[key]) unlockHint(key, false);
});

document.querySelectorAll(".hint-options button").forEach(button => {
  button.addEventListener("click", () => {
    const questionKey = button.dataset.question;
    const selected = button.dataset.answer;
    const group = button.closest(".hint-options");
    const feedback = document.getElementById(`feedback-${questionKey}`);

    group.querySelectorAll("button").forEach(btn => btn.classList.remove("correct","wrong"));

    if(selected === designAnswers[questionKey]){
      button.classList.add("correct");
      feedback.textContent = "Correct — design hint unlocked!";
      feedback.className = "answer-feedback good";
      setTimeout(() => unlockHint(questionKey), 450);
    }else{
      button.classList.add("wrong");
      feedback.textContent = "Not quite. Try another answer.";
      feedback.className = "answer-feedback bad";
    }
  });
});


// Expand/collapse the Strength load-test rules
const strengthButton = document.getElementById("strengthScoreButton");
const strengthRules = document.getElementById("strengthRules");
if (strengthButton && strengthRules) {
  strengthButton.addEventListener("click", () => {
    const expanded = strengthButton.getAttribute("aria-expanded") === "true";
    strengthButton.setAttribute("aria-expanded", String(!expanded));
    strengthRules.classList.toggle("hidden", expanded);
  });
}


// Live final award winners selected by the MC.
function normalizeParticipantAwardTeams(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function renderAwardWinners(data = {}) {
  const winners = [
    {
      icon: "🥇",
      title: "Ultimate Champion",
      teams: normalizeParticipantAwardTeams(data.champion)
    },
    {
      icon: "💡",
      title: "Most Innovative Design",
      teams: normalizeParticipantAwardTeams(data.innovation)
    },
    {
      icon: "🔥",
      title: "Best Team Spirit",
      teams: normalizeParticipantAwardTeams(data.spirit)
    }
  ].filter(item => item.teams.length);

  const panel = document.getElementById("awardWinnersPanel");
  const host = document.getElementById("awardWinnerCards");
  if (!panel || !host) return;

  if (!winners.length) {
    panel.classList.add("hidden");
    host.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  host.innerHTML = winners.map(item => `
    <div class="award-card final-winner-card">
      <div class="award-icon">${item.icon}</div>
      <div>
        <h3>${item.title}</h3>
        <div class="award-winner-team-list">
          ${item.teams.map(team => `<span>${team}</span>`).join("")}
        </div>
      </div>
    </div>
  `).join("");
}

onValue(bridgeRef("awards"), snapshot => renderAwardWinners(snapshot.val() || {}));


const hiddenBonusModal = el("hiddenBonusModal");
const hiddenBonusQuestionView = el("hiddenBonusQuestionView");
const hiddenBonusSuccess = el("hiddenBonusSuccess");
const hiddenBonusTeam = el("hiddenBonusTeam");
const hiddenBonusFeedback = el("hiddenBonusFeedback");
let hiddenBonusTeamNames = makeTeamNames(DEFAULT_TEAM_COUNT);
let lastHint3TapAt = 0;
let activityOnePayload = null;

function allDesignHintsUnlocked() {
  return ["pride", "red", "redlines"].every(key => unlockedHints[key]);
}

function populateHiddenBonusTeams(count) {
  hiddenBonusTeamNames = makeTeamNames(count);
  const previous = hiddenBonusTeam.value;
  hiddenBonusTeam.innerHTML = `<option value="">${payloadText(activityOnePayload?.teamPlaceholder) || "—"}</option>` +
    hiddenBonusTeamNames.map((name, index) =>
      `<option value="${index}">${name}</option>`
    ).join("");
  if (previous !== "" && Number(previous) < hiddenBonusTeamNames.length) {
    hiddenBonusTeam.value = previous;
  }
}

function renderActivityOnePayload(payload) {
  activityOnePayload = payload;
  hiddenBonusModal.querySelector(".hidden-bonus-sparkles").textContent = payload.icon || "";
  hiddenBonusModal.querySelector(".hidden-bonus-label").textContent = payloadText(payload.label);
  el("hiddenBonusTitle").textContent = payloadText(payload.title);
  hiddenBonusModal.querySelector(".hidden-bonus-copy").textContent = payloadText(payload.copy);
  hiddenBonusModal.querySelector(".hidden-bonus-team-label").textContent = payloadText(payload.teamLabel);
  hiddenBonusModal.querySelector(".hidden-bonus-question").textContent = payloadText(payload.question);
  hiddenBonusModal.querySelector(".hidden-bonus-options").innerHTML = (payload.options || []).map(option =>
    `<button type="button" data-choice="${String(option.id).replace(/[^a-z0-9_-]/gi, "")}"></button>`
  ).join("");
  [...hiddenBonusModal.querySelectorAll("[data-choice]")].forEach((button, index) => {
    button.textContent = payloadText(payload.options[index]?.text);
  });
  hiddenBonusSuccess.querySelector(".hidden-bonus-celebration").textContent = payload.successIcon || "";
  hiddenBonusSuccess.querySelector("h2").textContent = payloadText(payload.successTitle);
  el("finishHiddenBonus").textContent = payloadText(payload.closeButton);
  populateHiddenBonusTeams(hiddenBonusTeamNames.length);
}

async function openHiddenBonusQuestion() {
  if (!allDesignHintsUnlocked()) return;
  const payload = await loadEventPayload("p01");
  if (!payload) return;
  renderActivityOnePayload(payload);
  hiddenBonusQuestionView.classList.remove("hidden");
  hiddenBonusSuccess.classList.add("hidden");
  hiddenBonusFeedback.textContent = "";
  hiddenBonusFeedback.className = "answer-feedback";
  hiddenBonusModal.classList.remove("hidden");
  hiddenBonusModal.classList.add("hidden-bonus-visible");
}

function closeHiddenBonusQuestion() {
  hiddenBonusModal.classList.add("hidden");
  hiddenBonusModal.classList.remove("hidden-bonus-visible");
}

const hint3Image = document.querySelector('#hint-redlines .design-visual');
hint3Image?.addEventListener("dblclick", event => {
  event.preventDefault();
  openHiddenBonusQuestion();
});

hint3Image?.addEventListener("touchend", event => {
  if (!allDesignHintsUnlocked()) return;
  const now = Date.now();
  if (now - lastHint3TapAt < 600) {
    event.preventDefault();
    openHiddenBonusQuestion();
    lastHint3TapAt = 0;
  } else {
    lastHint3TapAt = now;
  }
}, { passive: false });

el("closeHiddenBonus")?.addEventListener("click", closeHiddenBonusQuestion);
el("finishHiddenBonus")?.addEventListener("click", closeHiddenBonusQuestion);
hiddenBonusModal?.addEventListener("click", event => {
  if (event.target === hiddenBonusModal) closeHiddenBonusQuestion();
});

hiddenBonusModal?.querySelector(".hidden-bonus-options")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-choice]");
    if (!button || !activityOnePayload) return;
    const teamIndex = Number(hiddenBonusTeam.value);
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= hiddenBonusTeamNames.length) {
      hiddenBonusFeedback.textContent = payloadText(activityOnePayload.selectTeam);
      hiddenBonusFeedback.className = "answer-feedback bad";
      return;
    }

    hiddenBonusModal.querySelectorAll("[data-choice]").forEach(item =>
      item.classList.remove("correct", "wrong")
    );

    if (button.dataset.choice !== activityOnePayload.answer) {
      button.classList.add("wrong");
      hiddenBonusFeedback.textContent = payloadText(activityOnePayload.wrong);
      hiddenBonusFeedback.className = "answer-feedback bad";
      return;
    }

    button.classList.add("correct");
    hiddenBonusFeedback.textContent = payloadText(activityOnePayload.correct);
    hiddenBonusFeedback.className = "answer-feedback good";

    const teamKey = `team${teamIndex + 1}`;
    const teamName = hiddenBonusTeamNames[teamIndex];
    const rewardRef = bridgeRef(`hiddenBonus/teamRewards/${teamKey}`);

    try {
      let firstUnlock = false;
      const result = await runTransaction(rewardRef, current => {
        if (current) return;
        firstUnlock = true;
        return {
          teamName,
          unlockedAt: Date.now(),
          source: "p01"
        };
      });

      hiddenBonusQuestionView.classList.add("hidden");
      hiddenBonusSuccess.classList.remove("hidden");

      if (result.committed && firstUnlock) {
        el("hiddenBonusSuccessText").textContent = payloadTemplate(activityOnePayload.successNew, { team: teamName });
      } else {
        el("hiddenBonusSuccessText").textContent = payloadTemplate(activityOnePayload.successRepeat, { team: teamName });
      }
    } catch (error) {
      hiddenBonusFeedback.textContent = payloadText(activityOnePayload.unavailable);
      hiddenBonusFeedback.className = "answer-feedback bad";
    }
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  populateHiddenBonusTeams(snapshot.val() || DEFAULT_TEAM_COUNT);
});

populateHiddenBonusTeams(DEFAULT_TEAM_COUNT);


const intelInnovationSecret = el("intelInnovationSecret");
const intelDareModal = el("intelDareModal");
const intelDareForm = el("intelDareForm");
const intelDareSuccess = el("intelDareSuccess");
const intelDareTeam = el("intelDareTeam");
const intelDareFeedback = el("intelDareFeedback");

let intelDareTeamNames = makeTeamNames(DEFAULT_TEAM_COUNT);
let innovationTapCount = 0;
let innovationTapResetTimer = null;
let activityTwoPayload = null;

function populateIntelDareTeams(count) {
  intelDareTeamNames = makeTeamNames(count);
  const previous = intelDareTeam.value;
  intelDareTeam.innerHTML = `<option value="">${payloadText(activityTwoPayload?.teamPlaceholder) || "—"}</option>` +
    intelDareTeamNames.map((name, index) =>
      `<option value="${index}">${name}</option>`
    ).join("");

  if (previous !== "" && Number(previous) < intelDareTeamNames.length) {
    intelDareTeam.value = previous;
  }
}

function renderActivityTwoPayload(payload) {
  activityTwoPayload = payload;
  intelDareForm.querySelector(".intel-dare-warning-icon").textContent = payload.icon || "";
  intelDareForm.querySelector(".intel-dare-label").textContent = payloadText(payload.label);
  el("intelDareTitle").textContent = payloadText(payload.title);
  intelDareForm.querySelector(".intel-dare-copy").textContent = payloadText(payload.copy);
  intelDareForm.querySelector(".intel-dare-team-label").textContent = payloadText(payload.teamLabel);
  el("acceptIntelDare").textContent = payloadText(payload.acceptButton);
  intelDareSuccess.querySelector(".intel-dare-celebration").textContent = payload.successIcon || "";
  intelDareSuccess.querySelector("h2").textContent = payloadText(payload.successTitle);
  el("finishIntelDare").textContent = payloadText(payload.closeButton);
  populateIntelDareTeams(intelDareTeamNames.length);
}

async function openIntelDare() {
  const payload = await loadEventPayload("p02");
  if (!payload) return;
  renderActivityTwoPayload(payload);
  intelDareForm.classList.remove("hidden");
  intelDareSuccess.classList.add("hidden");
  intelDareFeedback.textContent = "";
  intelDareFeedback.className = "answer-feedback";
  intelDareModal.classList.remove("hidden");
  intelDareModal.classList.add("intel-dare-visible");
}

function closeIntelDare() {
  intelDareModal.classList.add("hidden");
  intelDareModal.classList.remove("intel-dare-visible");
}

function registerInnovationSecretTap(event) {
  event.preventDefault();
  innovationTapCount += 1;

  clearTimeout(innovationTapResetTimer);
  innovationTapResetTimer = setTimeout(() => {
    innovationTapCount = 0;
  }, 900);

  if (innovationTapCount >= 3) {
    innovationTapCount = 0;
    clearTimeout(innovationTapResetTimer);
    openIntelDare();
  }
}

intelInnovationSecret?.addEventListener("click", registerInnovationSecretTap);
intelInnovationSecret?.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") registerInnovationSecretTap(event);
});

el("closeIntelDare")?.addEventListener("click", closeIntelDare);
el("finishIntelDare")?.addEventListener("click", closeIntelDare);
intelDareModal?.addEventListener("click", event => {
  if (event.target === intelDareModal) closeIntelDare();
});

el("acceptIntelDare")?.addEventListener("click", async () => {
  const teamIndex = Number(intelDareTeam.value);

  if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= intelDareTeamNames.length) {
    intelDareFeedback.textContent = payloadText(activityTwoPayload?.selectTeam);
    intelDareFeedback.className = "answer-feedback bad";
    return;
  }

  const teamKey = `team${teamIndex + 1}`;
  const teamName = intelDareTeamNames[teamIndex];
  const rewardRef = bridgeRef(`intelDareBonus/teamRewards/${teamKey}`);
  const acceptButton = el("acceptIntelDare");

  acceptButton.disabled = true;
  acceptButton.textContent = payloadText(activityTwoPayload?.processing);

  try {
    let firstUnlock = false;
    const result = await runTransaction(rewardRef, current => {
      if (current) return;
      firstUnlock = true;
      return {
        teamName,
        unlockedAt: Date.now(),
        source: "p02"
      };
    });

    intelDareForm.classList.add("hidden");
    intelDareSuccess.classList.remove("hidden");

    if (result.committed && firstUnlock) {
      el("intelDareSuccessText").textContent = payloadTemplate(activityTwoPayload.successNew, { team: teamName });
    } else {
      el("intelDareSuccessText").textContent = payloadTemplate(activityTwoPayload.successRepeat, { team: teamName });
    }
  } catch (error) {
    intelDareFeedback.textContent = payloadText(activityTwoPayload?.unavailable);
    intelDareFeedback.className = "answer-feedback bad";
  } finally {
    acceptButton.disabled = false;
    acceptButton.textContent = payloadText(activityTwoPayload?.acceptButton);
  }
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  populateIntelDareTeams(snapshot.val() || DEFAULT_TEAM_COUNT);
});

populateIntelDareTeams(DEFAULT_TEAM_COUNT);

window.addEventListener("bridge-language-change", () => {
  if (activityOnePayload && !hiddenBonusModal?.classList.contains("hidden")) {
    renderActivityOnePayload(activityOnePayload);
  }
  if (activityTwoPayload && !intelDareModal?.classList.contains("hidden")) {
    renderActivityTwoPayload(activityTwoPayload);
  }
  const spiritPayload = sessionPayloads.get("p05");
  if (spiritPayload && teamSpiritButton && !teamSpiritButton.disabled) {
    teamSpiritButton.textContent = payloadText(spiritPayload.readyLabel);
  }
  const revealPayload = sessionPayloads.get("p07");
  const reveal = el("bonusGameReveal");
  if (revealPayload && reveal && !reveal.classList.contains("hidden")) {
    reveal.querySelector(".bonus-label").textContent = payloadText(revealPayload.revealLabel);
    reveal.querySelector("h3").textContent = payloadText(revealPayload.revealTitle);
    reveal.querySelector(".bonus-game-button").textContent = payloadText(revealPayload.revealButton);
  }
});


async function renderSuperBonusAnnouncement(data = {}) {
  let banner = document.getElementById("superBonusAnnouncement");

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "superBonusAnnouncement";
    banner.className = "super-bonus-announcement hidden";

    const normalAnnouncement = document.getElementById("announcement");
    if (normalAnnouncement?.parentNode) {
      normalAnnouncement.parentNode.insertBefore(banner, normalAnnouncement.nextSibling);
    } else {
      document.body.prepend(banner);
    }
  }

  const teams = Object.values(data.teams || {})
    .filter(Boolean)
    .sort((a, b) => Number(a.announcedAt || 0) - Number(b.announcedAt || 0));

  if (!teams.length) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return false;
  }

  const payload = await loadEventPayload("p08");
  if (!payload) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return false;
  }

  const teamNames = teams.map(item => item.teamName).filter(Boolean);
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div class="super-bonus-announcement-title"></div>
    <div class="super-bonus-announcement-copy">
    </div>
  `;
  banner.querySelector(".super-bonus-announcement-title").textContent = payloadText(payload.title);
  banner.querySelector(".super-bonus-announcement-copy").textContent = payloadTemplate(
    teamNames.length === 1 ? payload.copyOne : payload.copyMany,
    { teams: teamNames.join(", ") }
  );
  return true;
}

let completionChannelInitialized = false;
let pendingCompletionAnnouncement = null;

async function processCompletionAnnouncement(announcement) {
  const displayed = await renderSuperBonusAnnouncement(announcement);
  if (!displayed) return;

  Object.values(announcement.teams || {})
    .filter(item => item?.type === "superBonus" && item?.eventId)
    .sort((a, b) => Number(a.announcedAt || 0) - Number(b.announcedAt || 0))
    .forEach(item => {
      queueSuperBonusWinningBell(item.eventId);
    });
}

onValue(bridgeRef("superBonusAnnouncement"), snapshot => {
  const announcement = snapshot.val() || {};
  if (!completionChannelInitialized) {
    completionChannelInitialized = true;
    pendingCompletionAnnouncement = announcement;
    return;
  }
  pendingCompletionAnnouncement = null;
  processCompletionAnnouncement(announcement);
});

document.addEventListener("pointerdown", () => {
  if (!pendingCompletionAnnouncement) return;
  const announcement = pendingCompletionAnnouncement;
  pendingCompletionAnnouncement = null;
  processCompletionAnnouncement(announcement);
}, { once:true, passive:true });


// Live load-test results on the Intel page.
// A team appears only on the highest stage it has passed.
// Example: if Team 1 passed stages 1–3, it appears on row 3.
let participantStrengthResults = {};
let participantActiveTeamCount = DEFAULT_TEAM_COUNT;

function highestPassedStrengthStage(teamResult) {
  if (!teamResult) return 0;

  let highest = 0;
  for (let stage = 1; stage <= 5; stage += 1) {
    if (teamResult.stages?.[`stage${stage}`] === true) {
      highest = stage;
    }
  }

  // Backward-compatible fallback for older saved results that only contain score.
  if (!highest && Number.isFinite(Number(teamResult.score))) {
    const score = Number(teamResult.score);
    if (score >= 50) return 5;
    if (score >= 35) return 4;
    if (score >= 25) return 3;
    if (score >= 15) return 2;
    if (score >= 10) return 1;
  }

  return highest;
}

function renderParticipantStrengthResults() {
  const activeTeams = makeTeamNames(participantActiveTeamCount);
  const teamsByStage = Array.from({ length: 5 }, () => []);

  activeTeams.forEach((teamName, index) => {
    const teamKey = `team${index + 1}`;
    const highestStage = highestPassedStrengthStage(participantStrengthResults?.[teamKey]);

    if (highestStage >= 1 && highestStage <= 5) {
      teamsByStage[highestStage - 1].push(teamName);
    }
  });

  teamsByStage.forEach((teamNames, index) => {
    const host = el(`strengthStageTeams${index + 1}`);
    if (!host) return;

    if (!teamNames.length) {
      host.innerHTML = "";
      host.classList.remove("has-teams");
      return;
    }

    host.classList.add("has-teams");
    host.innerHTML = teamNames
      .map(teamName => `<span class="strength-team-chip">${teamName}</span>`)
      .join("");
  });
}

onValue(bridgeRef("scores/strength"), snapshot => {
  participantStrengthResults = snapshot.val() || {};
  renderParticipantStrengthResults();
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  participantActiveTeamCount = Number(snapshot.val() || DEFAULT_TEAM_COUNT);
  renderParticipantStrengthResults();
});

renderParticipantStrengthResults();


// Hidden Interactive Mission Setup optional interaction:
// tap/click the red LOAD block three times to overload and break the demo bridge.
const missionLoadBlock = el("missionLoadBlock");
const missionBridgeDeck = el("missionBridgeDeck");
const bridgeBreakModal = el("bridgeBreakModal");
let missionLoadTapCount = 0;
let missionLoadTapResetTimer = null;
let bridgeBreakRunning = false;

function resetMissionBridgeBreak() {
  bridgeBreakRunning = false;
  missionLoadTapCount = 0;
  clearTimeout(missionLoadTapResetTimer);

  missionLoadBlock?.classList.remove("load-overload-grow", "load-overload-drop");
  missionBridgeDeck?.classList.remove("bridge-shake", "bridge-broken");
  document.querySelector(".blueprint")?.classList.remove("diagram-overload");
}

async function openBridgeBreakSurprise() {
  if (bridgeBreakRunning) return;
  const payload = await loadEventPayload("p06");
  if (!payload) return;
  bridgeBreakRunning = true;

  bridgeBreakModal.querySelector(".bridge-break-icon").textContent = payload.icon || "";
  bridgeBreakModal.querySelector(".bridge-break-label").textContent = payloadText(payload.label);
  el("bridgeBreakTitle").textContent = payloadText(payload.title);
  bridgeBreakModal.querySelector("p").textContent = payloadText(payload.copy);
  el("closeBridgeBreak").textContent = payloadText(payload.button);

  const diagram = document.querySelector(".blueprint");
  diagram?.classList.add("diagram-overload");
  missionLoadBlock?.classList.add("load-overload-grow");
  missionBridgeDeck?.classList.add("bridge-shake");

  setTimeout(() => {
    missionLoadBlock?.classList.remove("load-overload-grow");
    missionLoadBlock?.classList.add("load-overload-drop");
    missionBridgeDeck?.classList.remove("bridge-shake");
    missionBridgeDeck?.classList.add("bridge-broken");
  }, 650);

  setTimeout(() => {
    bridgeBreakModal?.classList.remove("hidden");
    bridgeBreakModal?.classList.add("bridge-break-visible");
  }, 1050);
}

function registerMissionLoadTap(event) {
  if (bridgeBreakRunning) return;
  event.preventDefault();

  missionLoadTapCount += 1;
  missionLoadBlock?.classList.remove("load-tap-bounce");
  void missionLoadBlock?.getBoundingClientRect();
  missionLoadBlock?.classList.add("load-tap-bounce");

  clearTimeout(missionLoadTapResetTimer);
  missionLoadTapResetTimer = setTimeout(() => {
    missionLoadTapCount = 0;
  }, 1800);

  if (missionLoadTapCount >= 3) {
    missionLoadTapCount = 0;
    clearTimeout(missionLoadTapResetTimer);
    openBridgeBreakSurprise();
  }
}

missionLoadBlock?.addEventListener("click", registerMissionLoadTap);
missionLoadBlock?.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") registerMissionLoadTap(event);
});

el("closeBridgeBreak")?.addEventListener("click", () => {
  bridgeBreakModal?.classList.add("hidden");
  bridgeBreakModal?.classList.remove("bridge-break-visible");
  resetMissionBridgeBreak();
});

bridgeBreakModal?.addEventListener("click", event => {
  if (event.target !== bridgeBreakModal) return;
  bridgeBreakModal.classList.add("hidden");
  bridgeBreakModal.classList.remove("bridge-break-visible");
  resetMissionBridgeBreak();
});


const momentPanelModal = el("momentPanelModal");
const momentPanelTitle = el("momentPanelTitle");
const momentPanelCopy = el("momentPanelCopy");
const momentPanelIcon = el("momentPanelIcon");
const closeMomentPanel = el("closeMomentPanel");
let momentPanelCleanup = null;
let momentPanelPreviousFocus = null;

function closeMomentPanelEgg() {
  momentPanelModal?.classList.add("hidden");
  momentPanelModal?.classList.remove("moment-panel-visible", "coffee", "gap-friendly", "team-spirit");
  const cleanup = momentPanelCleanup;
  momentPanelCleanup = null;
  cleanup?.();
  momentPanelPreviousFocus?.focus?.();
  momentPanelPreviousFocus = null;
}

function openMomentPanelEgg({ kind, icon, title, copy, button, onClose }) {
  if (!momentPanelModal) return;
  if (!momentPanelModal.classList.contains("hidden")) closeMomentPanelEgg();

  momentPanelPreviousFocus = document.activeElement;
  momentPanelCleanup = onClose || null;
  momentPanelIcon.textContent = icon;
  momentPanelTitle.textContent = title;
  momentPanelCopy.textContent = copy;
  closeMomentPanel.textContent = button;
  momentPanelModal.classList.add(kind, "moment-panel-visible");
  momentPanelModal.classList.remove("hidden");
  closeMomentPanel.focus();
}

closeMomentPanel?.addEventListener("click", closeMomentPanelEgg);
momentPanelModal?.addEventListener("click", event => {
  if (event.target === momentPanelModal) closeMomentPanelEgg();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !momentPanelModal?.classList.contains("hidden")) {
    closeMomentPanelEgg();
  }
});

function createRepeatedTapTrigger(element, requiredTaps, windowMs, onTrigger) {
  let tapCount = 0;
  let firstTapTime = 0;
  let resetTimer = null;

  function reset() {
    tapCount = 0;
    firstTapTime = 0;
    clearTimeout(resetTimer);
    resetTimer = null;
  }

  function register(event) {
    event?.preventDefault();
    const now = Date.now();
    if (!firstTapTime || now - firstTapTime > windowMs) {
      tapCount = 0;
      firstTapTime = now;
    }

    tapCount += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, Math.max(0, windowMs - (now - firstTapTime)));

    if (tapCount >= requiredTaps) {
      reset();
      onTrigger();
    }
  }

  element?.addEventListener("click", register);
  element?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") register(event);
  });

  return { reset };
}

const missionCoffeeCanLeft = el("missionCoffeeCanLeft");
const missionCoffeeCanRight = el("missionCoffeeCanRight");
const missionGapIndicator = el("missionGapIndicator");
const missionBlueprint = document.querySelector(".blueprint");
let leftCoffeeTapTrigger = null;
let rightCoffeeTapTrigger = null;
let gapTapTrigger = null;
let gapPopupTimer = null;

async function triggerCoffeeCanDisturbance(can, tapTrigger) {
  const payload = await loadEventPayload("p03");
  if (!payload) return;
  can?.classList.add("coffee-can-disturbed");
  openMomentPanelEgg({
    kind: "coffee",
    icon: payload.icon || "",
    title: payloadText(payload.title),
    copy: payloadText(payload.copy),
    button: payloadText(payload.button),
    onClose: () => {
      can?.classList.remove("coffee-can-disturbed");
      tapTrigger?.reset();
    }
  });
}

leftCoffeeTapTrigger = createRepeatedTapTrigger(missionCoffeeCanLeft, 4, 2000, () => {
  triggerCoffeeCanDisturbance(missionCoffeeCanLeft, leftCoffeeTapTrigger);
});
rightCoffeeTapTrigger = createRepeatedTapTrigger(missionCoffeeCanRight, 4, 2000, () => {
  triggerCoffeeCanDisturbance(missionCoffeeCanRight, rightCoffeeTapTrigger);
});

function resetGapWarning() {
  clearTimeout(gapPopupTimer);
  missionGapIndicator?.classList.remove("gap-violation-active");
  missionCoffeeCanLeft?.classList.remove("gap-can-inward");
  missionCoffeeCanRight?.classList.remove("gap-can-inward");
  missionBlueprint?.classList.remove("gap-diagram-shake");
  gapTapTrigger?.reset();
}

async function triggerGapWarning() {
  const payload = await loadEventPayload("p04");
  if (!payload) return;
  missionGapIndicator?.classList.add("gap-violation-active");
  missionCoffeeCanLeft?.classList.add("gap-can-inward");
  missionCoffeeCanRight?.classList.add("gap-can-inward");
  missionBlueprint?.classList.add("gap-diagram-shake");

  openMomentPanelEgg({
    kind: "gap-friendly",
    icon: payload.icon || "",
    title: payloadText(payload.title),
    copy: payloadText(payload.copyFirst),
    button: payloadText(payload.button),
    onClose: resetGapWarning
  });

  gapPopupTimer = setTimeout(() => {
    if (!momentPanelModal?.classList.contains("gap-friendly")) return;
    momentPanelCopy.textContent = payloadText(payload.copySecond);
  }, 1000);
}

gapTapTrigger = createRepeatedTapTrigger(missionGapIndicator, 3, 2000, triggerGapWarning);


// v1.7.28 bilingual workflow diagram with full-screen zoom and drag support
const workflowPreview = el("workflowPreview");
const workflowPreviewImage = el("workflowPreviewImage");
const workflowModal = el("workflowModal");
const workflowModalImage = el("workflowModalImage");
const workflowModalStage = el("workflowModalStage");
const workflowModalToolbar = el("workflowModalToolbar");
const workflowZoomIn = el("workflowZoomIn");
const workflowZoomOut = el("workflowZoomOut");
const workflowZoomReset = el("workflowZoomReset");
const workflowModalClose = el("workflowModalClose");
let workflowZoom = 1;
let workflowDragging = false;
let workflowDragStartX = 0;
let workflowDragStartY = 0;
let workflowScrollStartLeft = 0;
let workflowScrollStartTop = 0;
let workflowPageScrollY = 0;
const workflowPointers = new Map();
let workflowPinchStartDistance = 0;
let workflowPinchStartZoom = 1;
let workflowFitScale = 1;
let workflowPinchStartScrollLeft = 0;
let workflowPinchStartScrollTop = 0;
let workflowPinchStartMidX = 0;
let workflowPinchStartMidY = 0;
let workflowControlsTimer = null;
let workflowTapStart = null;
let workflowGestureMoved = false;
let workflowGestureMultiTouch = false;

function currentWorkflowLanguage() {
  return window.bridgeI18n?.getLanguage?.() || document.documentElement.lang || "en";
}

function workflowImageSource() {
  return currentWorkflowLanguage() === "zh-HK" ? "game-flow-zh.png" : "game-flow-en.png";
}

function updateWorkflowLanguage() {
  const src = workflowImageSource();
  if (workflowPreviewImage) workflowPreviewImage.src = src;
  if (workflowModalImage) workflowModalImage.src = src;
}

function centerWorkflowDiagram() {
  if (!workflowModalStage) return;
  requestAnimationFrame(() => {
    workflowModalStage.scrollLeft = Math.max(0, (workflowModalStage.scrollWidth - workflowModalStage.clientWidth) / 2);
    workflowModalStage.scrollTop = 0;
  });
}

function isMobileWorkflowViewer() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function updateWorkflowImagePosition() {
  if (!workflowModalImage || !workflowModalStage) return;
  if (!isMobileWorkflowViewer()) {
    workflowModalImage.style.marginTop = "";
    return;
  }
  const imageRatio = workflowModalImage.naturalWidth / workflowModalImage.naturalHeight;
  if (!Number.isFinite(imageRatio) || imageRatio <= 0) return;
  const renderedWidth = workflowModalStage.clientWidth * workflowFitScale * workflowZoom;
  const renderedHeight = renderedWidth / imageRatio;
  const topOffset = Math.max(0, (workflowModalStage.clientHeight - renderedHeight) / 2);
  workflowModalImage.style.marginTop = `${Math.round(topOffset)}px`;
}

function hideWorkflowControls() {
  if (!isMobileWorkflowViewer()) return;
  clearTimeout(workflowControlsTimer);
  workflowModal?.classList.add("workflow-controls-hidden");
  if (workflowModalToolbar) workflowModalToolbar.inert = true;
}

function showWorkflowControls(autoHide = true) {
  clearTimeout(workflowControlsTimer);
  workflowModal?.classList.remove("workflow-controls-hidden");
  if (workflowModalToolbar) workflowModalToolbar.inert = false;
  if (autoHide && isMobileWorkflowViewer()) {
    workflowControlsTimer = setTimeout(hideWorkflowControls, 2200);
  }
}

function applyWorkflowZoom(nextZoom, center = false) {
  workflowZoom = Math.min(4, Math.max(0.5, nextZoom));
  if (workflowModalImage) workflowModalImage.style.width = `${workflowFitScale * workflowZoom * 100}%`;
  if (workflowZoomReset) workflowZoomReset.textContent = `${Math.round(workflowZoom * 100)}%`;
  requestAnimationFrame(updateWorkflowImagePosition);
  if (center) centerWorkflowDiagram();
}

function fitWorkflowDiagram() {
  if (!workflowModalStage || !workflowModalImage) return;
  const imageRatio = workflowModalImage.naturalWidth / workflowModalImage.naturalHeight;
  if (!Number.isFinite(imageRatio) || imageRatio <= 0) return;
  workflowModalStage.style.height = "";
  const stageWidth = workflowModalStage.clientWidth;
  const isMobileViewer = isMobileWorkflowViewer();
  if (isMobileViewer) {
    workflowModalStage.style.height = `${window.innerHeight}px`;
    workflowFitScale = 1;
    applyWorkflowZoom(1, true);
    return;
  }
  const reservedHeight = 180;
  const availableHeight = Math.min(760, window.innerHeight * 0.7, Math.max(180, window.innerHeight - reservedHeight));
  const fittedHeight = Math.min(stageWidth / imageRatio, availableHeight);
  workflowModalStage.style.height = `${Math.round(fittedHeight)}px`;
  workflowFitScale = Math.min(1, (fittedHeight * imageRatio) / stageWidth);
  applyWorkflowZoom(1, true);
}

function openWorkflowModal() {
  updateWorkflowLanguage();
  workflowPointers.clear();
  workflowDragging = false;
  workflowPinchStartDistance = 0;
  workflowPageScrollY = window.scrollY;
  workflowModal?.classList.remove("hidden");
  document.body.classList.add("workflow-modal-open");
  showWorkflowControls(true);
  requestAnimationFrame(fitWorkflowDiagram);
}

function closeWorkflowModal() {
  workflowPointers.clear();
  workflowDragging = false;
  workflowPinchStartDistance = 0;
  workflowModalStage?.classList.remove("dragging", "pinching");
  clearTimeout(workflowControlsTimer);
  workflowModal?.classList.add("hidden");
  document.body.classList.remove("workflow-modal-open");
  requestAnimationFrame(() => {
    window.scrollTo({ top: workflowPageScrollY, left: 0, behavior: "auto" });
  });
}

workflowPreview?.addEventListener("click", openWorkflowModal);
workflowModalClose?.addEventListener("click", closeWorkflowModal);
workflowZoomIn?.addEventListener("click", () => { applyWorkflowZoom(workflowZoom + 0.25); showWorkflowControls(true); });
workflowZoomOut?.addEventListener("click", () => { applyWorkflowZoom(workflowZoom - 0.25); showWorkflowControls(true); });
workflowZoomReset?.addEventListener("click", () => { fitWorkflowDiagram(); showWorkflowControls(true); });
workflowModalImage?.addEventListener("load", fitWorkflowDiagram);
window.addEventListener("resize", () => {
  if (!workflowModal?.classList.contains("hidden")) fitWorkflowDiagram();
});
workflowModal?.addEventListener("click", event => {
  if (event.target === workflowModal) closeWorkflowModal();
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !workflowModal?.classList.contains("hidden")) closeWorkflowModal();
});
workflowModalStage?.addEventListener("wheel", event => {
  event.preventDefault();
  applyWorkflowZoom(workflowZoom + (event.deltaY < 0 ? 0.12 : -0.12));
}, { passive:false });
workflowModalStage?.addEventListener("pointerdown", event => {
  event.preventDefault();
  workflowPointers.set(event.pointerId, { x:event.clientX, y:event.clientY });
  if (workflowPointers.size === 1) {
    workflowTapStart = { x:event.clientX, y:event.clientY, time:performance.now() };
    workflowGestureMoved = false;
    workflowGestureMultiTouch = false;
  } else {
    workflowGestureMultiTouch = true;
    hideWorkflowControls();
  }
  workflowModalStage.setPointerCapture?.(event.pointerId);
  if (workflowPointers.size === 2) {
    const [first, second] = [...workflowPointers.values()];
    const stageRect = workflowModalStage.getBoundingClientRect();
    workflowPinchStartDistance = Math.hypot(second.x - first.x, second.y - first.y);
    workflowPinchStartZoom = workflowZoom;
    workflowPinchStartScrollLeft = workflowModalStage.scrollLeft;
    workflowPinchStartScrollTop = workflowModalStage.scrollTop;
    workflowPinchStartMidX = (first.x + second.x) / 2 - stageRect.left;
    workflowPinchStartMidY = (first.y + second.y) / 2 - stageRect.top;
    workflowDragging = false;
    workflowModalStage.classList.add("pinching");
    workflowModalStage.classList.remove("dragging");
    return;
  }
  if (workflowZoom <= 1) return;
  workflowDragging = true;
  workflowDragStartX = event.clientX;
  workflowDragStartY = event.clientY;
  workflowScrollStartLeft = workflowModalStage.scrollLeft;
  workflowScrollStartTop = workflowModalStage.scrollTop;
  workflowModalStage.classList.add("dragging");
});
workflowModalStage?.addEventListener("pointermove", event => {
  if (!workflowPointers.has(event.pointerId)) return;
  if (workflowTapStart && Math.hypot(event.clientX - workflowTapStart.x, event.clientY - workflowTapStart.y) > 8) {
    workflowGestureMoved = true;
    hideWorkflowControls();
  }
  workflowPointers.set(event.pointerId, { x:event.clientX, y:event.clientY });
  if (workflowPointers.size >= 2) {
    const [first, second] = [...workflowPointers.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (workflowPinchStartDistance > 0) {
      const nextZoom = Math.min(4, Math.max(0.5, workflowPinchStartZoom * (distance / workflowPinchStartDistance)));
      const zoomRatio = nextZoom / workflowPinchStartZoom;
      const stageRect = workflowModalStage.getBoundingClientRect();
      const currentMidX = (first.x + second.x) / 2 - stageRect.left;
      const currentMidY = (first.y + second.y) / 2 - stageRect.top;
      applyWorkflowZoom(nextZoom);
      workflowModalStage.scrollLeft = (workflowPinchStartScrollLeft + workflowPinchStartMidX) * zoomRatio - currentMidX;
      workflowModalStage.scrollTop = (workflowPinchStartScrollTop + workflowPinchStartMidY) * zoomRatio - currentMidY;
    }
    event.preventDefault();
    return;
  }
  if (!workflowDragging) return;
  event.preventDefault();
  workflowModalStage.scrollLeft = workflowScrollStartLeft - (event.clientX - workflowDragStartX);
  workflowModalStage.scrollTop = workflowScrollStartTop - (event.clientY - workflowDragStartY);
});
function stopWorkflowDrag(event) {
  if (event?.pointerId !== undefined) workflowPointers.delete(event.pointerId);
  if (workflowPointers.size < 2) {
    workflowPinchStartDistance = 0;
    workflowModalStage?.classList.remove("pinching");
  }
  if (workflowPointers.size === 1 && workflowZoom > 1 && workflowModalStage) {
    const remaining = [...workflowPointers.values()][0];
    workflowDragging = true;
    workflowDragStartX = remaining.x;
    workflowDragStartY = remaining.y;
    workflowScrollStartLeft = workflowModalStage.scrollLeft;
    workflowScrollStartTop = workflowModalStage.scrollTop;
    workflowModalStage.classList.add("dragging");
  } else {
    workflowDragging = false;
    workflowModalStage?.classList.remove("dragging");
  }
}
workflowModalStage?.addEventListener("pointerup", stopWorkflowDrag);
workflowModalStage?.addEventListener("pointercancel", stopWorkflowDrag);
workflowModalStage?.addEventListener("pointerup", () => {
  if (workflowPointers.size !== 0) return;
  const wasTap = workflowTapStart && !workflowGestureMoved && !workflowGestureMultiTouch && performance.now() - workflowTapStart.time < 350;
  if (wasTap) {
    if (workflowModal?.classList.contains("workflow-controls-hidden")) showWorkflowControls(true);
    else hideWorkflowControls();
  }
  workflowTapStart = null;
  workflowGestureMoved = false;
  workflowGestureMultiTouch = false;
});
window.addEventListener("bridge-language-change", updateWorkflowLanguage);
updateWorkflowLanguage();

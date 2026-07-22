import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);
const bridgeRef = path => ref(db, `${BRIDGE_PATH}/${path}`);

let serverOffset = 0;
let state = {};
let renderTicker = null;

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

  // The secret game now unlocks when the first three checklist items are complete.
  const firstThreeComplete = checks.slice(0, 3).every(item => item.checked);
  const firstChecklistItemComplete = Boolean(checks[0]?.checked);
  const reveal = el("bonusGameReveal");
  teamSpiritControl?.classList.toggle("hidden", !firstChecklistItemComplete);

  if (firstThreeComplete && !bonusAlreadyRevealed && !bonusRevealTimer) {
    bonusRevealTimer = setTimeout(() => {
      bonusAlreadyRevealed = true;
      bonusRevealTimer = null;
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

function activateTeamSpirit() {
  if (!teamSpiritButton || teamSpiritButton.disabled) return;

  launchTeamSpiritEffects();
  openVisualEasterEgg({
    kind: "team-spirit",
    icon: "🔥🎉🔥",
    title: "TEAM SPIRIT ACTIVATED! 🔥",
    copy: "Communication +10\nConfidence +20\nActual score still judged by Kitty.",
    button: "We Are Ready!"
  });

  teamSpiritButton.disabled = true;
  teamSpiritButton.textContent = "🔥 TEAM SPIRIT ACTIVE";
  if (teamSpiritStatus) teamSpiritStatus.textContent = "Recharging Team Spirit…";

  clearTimeout(teamSpiritCooldownTimer);
  teamSpiritCooldownTimer = setTimeout(() => {
    teamSpiritButton.disabled = false;
    teamSpiritButton.textContent = "🔥 ACTIVATE TEAM SPIRIT";
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


// Hidden fourth Design Lab question.
// It appears only after all three normal hints are unlocked and the Hint 3 image
// is double-clicked (or double-tapped on a phone).
const hiddenBonusModal = el("hiddenBonusModal");
const hiddenBonusQuestionView = el("hiddenBonusQuestionView");
const hiddenBonusSuccess = el("hiddenBonusSuccess");
const hiddenBonusTeam = el("hiddenBonusTeam");
const hiddenBonusFeedback = el("hiddenBonusFeedback");
let hiddenBonusTeamNames = makeTeamNames(DEFAULT_TEAM_COUNT);
let lastHint3TapAt = 0;

function allDesignHintsUnlocked() {
  return ["pride", "red", "redlines"].every(key => unlockedHints[key]);
}

function populateHiddenBonusTeams(count) {
  hiddenBonusTeamNames = makeTeamNames(count);
  const previous = hiddenBonusTeam.value;
  hiddenBonusTeam.innerHTML = '<option value="">— Select your team —</option>' +
    hiddenBonusTeamNames.map((name, index) =>
      `<option value="${index}">${name}</option>`
    ).join("");
  if (previous !== "" && Number(previous) < hiddenBonusTeamNames.length) {
    hiddenBonusTeam.value = previous;
  }
}

function openHiddenBonusQuestion() {
  if (!allDesignHintsUnlocked()) return;
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

// Mobile double-tap support.
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

document.querySelectorAll("[data-hidden-answer]").forEach(button => {
  button.addEventListener("click", async () => {
    const teamIndex = Number(hiddenBonusTeam.value);
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= hiddenBonusTeamNames.length) {
      hiddenBonusFeedback.textContent = "Please select your team first.";
      hiddenBonusFeedback.className = "answer-feedback bad";
      return;
    }

    document.querySelectorAll("[data-hidden-answer]").forEach(item =>
      item.classList.remove("correct", "wrong")
    );

    if (button.dataset.hiddenAnswer !== "a") {
      button.classList.add("wrong");
      hiddenBonusFeedback.textContent = "Not quite. Try another answer.";
      hiddenBonusFeedback.className = "answer-feedback bad";
      return;
    }

    button.classList.add("correct");
    hiddenBonusFeedback.textContent = "Correct! Checking your team reward…";
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
          source: "designLabHiddenQuestion"
        };
      });

      hiddenBonusQuestionView.classList.add("hidden");
      hiddenBonusSuccess.classList.remove("hidden");

      if (result.committed && firstUnlock) {
        el("hiddenBonusSuccessText").innerHTML = window.bridgeI18n?.language === "zh-HK"
          ? `<strong>${teamName}</strong> 已解鎖一份額外資源。請出示此訊息並向<strong>活動工作人員</strong>領取。`
          : `<strong>${teamName}</strong> has unlocked one extra resource. Show this message and check with <strong>the event team</strong>.`;
      } else {
        el("hiddenBonusSuccessText").innerHTML = window.bridgeI18n?.language === "zh-HK"
          ? `<strong>${teamName}</strong> 已經領取過一次這項隱藏獎勵。`
          : `<strong>${teamName}</strong> has already claimed this hidden bonus once.`;
      }
    } catch (error) {
      hiddenBonusFeedback.textContent = error?.message || "Unable to check the reward.";
      hiddenBonusFeedback.className = "answer-feedback bad";
    }
  });
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  populateHiddenBonusTeams(snapshot.val() || DEFAULT_TEAM_COUNT);
});

populateHiddenBonusTeams(DEFAULT_TEAM_COUNT);


// Hidden Intel-page dare bonus.
// Triple-tap/click the Innovation scoring card to trigger a playful warning.
const intelInnovationSecret = el("intelInnovationSecret");
const intelDareModal = el("intelDareModal");
const intelDareForm = el("intelDareForm");
const intelDareSuccess = el("intelDareSuccess");
const intelDareTeam = el("intelDareTeam");
const intelDareFeedback = el("intelDareFeedback");

let intelDareTeamNames = makeTeamNames(DEFAULT_TEAM_COUNT);
let innovationTapCount = 0;
let innovationTapResetTimer = null;

function populateIntelDareTeams(count) {
  intelDareTeamNames = makeTeamNames(count);
  const previous = intelDareTeam.value;
  intelDareTeam.innerHTML = '<option value="">— Select your team —</option>' +
    intelDareTeamNames.map((name, index) =>
      `<option value="${index}">${name}</option>`
    ).join("");

  if (previous !== "" && Number(previous) < intelDareTeamNames.length) {
    intelDareTeam.value = previous;
  }
}

function openIntelDare() {
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
    intelDareFeedback.textContent = "You must select the team brave enough to accept this penalty.";
    intelDareFeedback.className = "answer-feedback bad";
    return;
  }

  const teamKey = `team${teamIndex + 1}`;
  const teamName = intelDareTeamNames[teamIndex];
  const rewardRef = bridgeRef(`intelDareBonus/teamRewards/${teamKey}`);
  const acceptButton = el("acceptIntelDare");

  acceptButton.disabled = true;
  acceptButton.textContent = "PROCESSING PENALTY…";

  try {
    let firstUnlock = false;
    const result = await runTransaction(rewardRef, current => {
      if (current) return;
      firstUnlock = true;
      return {
        teamName,
        unlockedAt: Date.now(),
        source: "intelInnovationTripleTap"
      };
    });

    intelDareForm.classList.add("hidden");
    intelDareSuccess.classList.remove("hidden");

    if (result.committed && firstUnlock) {
      el("intelDareSuccessText").innerHTML = window.bridgeI18n?.language === "zh-HK"
        ? `其實沒有懲罰！<strong>${teamName}</strong> 發現了隱藏獎勵。請出示此訊息並向<strong>活動工作人員</strong>領取一份額外資源。`
        : `There is no penalty. <strong>${teamName}</strong> has discovered a hidden reward! Show this message and collect one extra resource from <strong>the event team</strong>.`;
    } else {
      el("intelDareSuccessText").innerHTML = window.bridgeI18n?.language === "zh-HK"
        ? `<strong>${teamName}</strong> 已經發現並領取過一次這項驚喜。`
        : `<strong>${teamName}</strong> already discovered and claimed this surprise once.`;
    }
  } catch (error) {
    intelDareFeedback.textContent = error?.message || "Unable to check the surprise reward.";
    intelDareFeedback.className = "answer-feedback bad";
  } finally {
    acceptButton.disabled = false;
    acceptButton.textContent = "I ACCEPT THE PENALTY";
  }
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  populateIntelDareTeams(snapshot.val() || DEFAULT_TEAM_COUNT);
});

populateIntelDareTeams(DEFAULT_TEAM_COUNT);


// Dedicated Super Bonus announcement channel.
// This is separate from the normal MC announcement, so publishing a new normal
// message does not remove the accumulated Super Bonus winners.
function renderSuperBonusAnnouncement(data = {}) {
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
    return;
  }

  const teamNames = teams.map(item => item.teamName).filter(Boolean);
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div class="super-bonus-announcement-title">🏆 SUPER BONUS WINNERS</div>
    <div class="super-bonus-announcement-copy">
      ${teamNames.join(", ")} ${teamNames.length === 1 ? "has" : "have"} completed all three hidden challenges.
      Please come forward to collect the SUPER EXTRA RESOURCE!
    </div>
  `;
}

onValue(bridgeRef("superBonusAnnouncement"), snapshot => {
  renderSuperBonusAnnouncement(snapshot.val() || {});
});


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


// Hidden Interactive Mission Setup Easter egg:
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

function openBridgeBreakSurprise() {
  if (bridgeBreakRunning) return;
  bridgeBreakRunning = true;

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


// Reusable visual-only popup and timed multi-tap triggers.
const visualEasterModal = el("visualEasterEggModal");
const visualEasterTitle = el("visualEasterTitle");
const visualEasterCopy = el("visualEasterCopy");
const visualEasterIcon = el("visualEasterIcon");
const closeVisualEaster = el("closeVisualEaster");
let visualEasterCleanup = null;
let visualEasterPreviousFocus = null;

function closeVisualEasterEgg() {
  visualEasterModal?.classList.add("hidden");
  visualEasterModal?.classList.remove("visual-easter-visible", "coffee", "gap-warning", "team-spirit");
  const cleanup = visualEasterCleanup;
  visualEasterCleanup = null;
  cleanup?.();
  visualEasterPreviousFocus?.focus?.();
  visualEasterPreviousFocus = null;
}

function openVisualEasterEgg({ kind, icon, title, copy, button, onClose }) {
  if (!visualEasterModal) return;
  if (!visualEasterModal.classList.contains("hidden")) closeVisualEasterEgg();

  visualEasterPreviousFocus = document.activeElement;
  visualEasterCleanup = onClose || null;
  visualEasterIcon.textContent = icon;
  visualEasterTitle.textContent = title;
  visualEasterCopy.textContent = copy;
  closeVisualEaster.textContent = button;
  visualEasterModal.classList.add(kind, "visual-easter-visible");
  visualEasterModal.classList.remove("hidden");
  closeVisualEaster.focus();
}

closeVisualEaster?.addEventListener("click", closeVisualEasterEgg);
visualEasterModal?.addEventListener("click", event => {
  if (event.target === visualEasterModal) closeVisualEasterEgg();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !visualEasterModal?.classList.contains("hidden")) {
    closeVisualEasterEgg();
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

function triggerCoffeeCanDisturbance(can, tapTrigger) {
  can?.classList.add("coffee-can-disturbed");
  openVisualEasterEgg({
    kind: "coffee",
    icon: "☕♨☕",
    title: "Coffee Can Disturbance Detected ☕",
    copy: "Please stop testing the coffee before testing the bridge.\nThe can has officially filed a complaint.",
    button: "Let the Can Rest",
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

function triggerGapWarning() {
  missionGapIndicator?.classList.add("gap-violation-active");
  missionCoffeeCanLeft?.classList.add("gap-can-inward");
  missionCoffeeCanRight?.classList.add("gap-can-inward");
  missionBlueprint?.classList.add("gap-diagram-shake");

  openVisualEasterEgg({
    kind: "gap-warning",
    icon: "🚨📏🚨",
    title: "GAP VIOLATION DETECTED 🚨",
    copy: "Engineering enforcement has been notified.",
    button: "Restore Safe Distance",
    onClose: resetGapWarning
  });

  gapPopupTimer = setTimeout(() => {
    if (!visualEasterModal?.classList.contains("gap-warning")) return;
    visualEasterCopy.textContent = "Just kidding. No engineers are coming.\nPlease keep the cans at least 30 cm apart.";
  }, 1000);
}

gapTapTrigger = createRepeatedTapTrigger(missionGapIndicator, 3, 2000, triggerGapWarning);


// v1.7.28 bilingual workflow diagram with full-screen zoom and drag support
const workflowPreview = el("workflowPreview");
const workflowPreviewImage = el("workflowPreviewImage");
const workflowModal = el("workflowModal");
const workflowModalImage = el("workflowModalImage");
const workflowModalStage = el("workflowModalStage");
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

function applyWorkflowZoom(nextZoom, center = false) {
  workflowZoom = Math.min(4, Math.max(0.5, nextZoom));
  if (workflowModalImage) workflowModalImage.style.width = `${workflowFitScale * workflowZoom * 100}%`;
  if (workflowZoomReset) workflowZoomReset.textContent = `${Math.round(workflowZoom * 100)}%`;
  if (center) centerWorkflowDiagram();
}

function fitWorkflowDiagram() {
  if (!workflowModalStage || !workflowModalImage) return;
  const imageRatio = workflowModalImage.naturalWidth / workflowModalImage.naturalHeight;
  if (!Number.isFinite(imageRatio) || imageRatio <= 0) return;
  workflowModalStage.style.height = "";
  const stageWidth = workflowModalStage.clientWidth;
  const isMobileViewer = window.matchMedia("(max-width: 640px)").matches;
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
  requestAnimationFrame(fitWorkflowDiagram);
}

function closeWorkflowModal() {
  workflowPointers.clear();
  workflowDragging = false;
  workflowPinchStartDistance = 0;
  workflowModalStage?.classList.remove("dragging", "pinching");
  workflowModal?.classList.add("hidden");
  document.body.classList.remove("workflow-modal-open");
  requestAnimationFrame(() => {
    window.scrollTo({ top: workflowPageScrollY, left: 0, behavior: "auto" });
  });
}

workflowPreview?.addEventListener("click", openWorkflowModal);
workflowModalClose?.addEventListener("click", closeWorkflowModal);
workflowZoomIn?.addEventListener("click", () => applyWorkflowZoom(workflowZoom + 0.25));
workflowZoomOut?.addEventListener("click", () => applyWorkflowZoom(workflowZoom - 0.25));
workflowZoomReset?.addEventListener("click", fitWorkflowDiagram);
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
window.addEventListener("bridge-language-change", updateWorkflowLanguage);
updateWorkflowLanguage();

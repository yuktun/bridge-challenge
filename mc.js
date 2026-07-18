import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

let TEAM_NAMES = makeTeamNames(DEFAULT_TEAM_COUNT);
const MC_PASSWORD = "gicgic";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const el = id => document.getElementById(id);
const bridgeRef = path => ref(db, `${BRIDGE_PATH}/${path}`);

const phases = [
  { name: "Strategy & Planning", duration: 300 },
  { name: "Bridge Construction", duration: 900 },
  { name: "Judging & Load Testing", duration: 300 }
];

let state = {
  phaseIndex: 0,
  status: "waiting",
  remainingAtStart: 300,
  pausedRemaining: 300,
  startedAt: null
};
let serverOffset = 0;
let completionTimer = null;
let teamworkScores = null;
let innovationSubmissions = {};
let strengthScores = {};

const readyMarker = el("loginButton");
if (readyMarker) readyMarker.dataset.moduleReady = "yes";

function nowServer() {
  return Date.now() + serverOffset;
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function remaining() {
  const index = Math.min(2, Math.max(0, Number(state.phaseIndex || 0)));
  const phase = phases[index];

  if (state.status === "running" && Number.isFinite(Number(state.startedAt))) {
    return Math.max(
      0,
      Number(state.remainingAtStart ?? phase.duration) -
        (nowServer() - Number(state.startedAt)) / 1000
    );
  }

  return Number(state.pausedRemaining ?? state.remainingAtStart ?? phase.duration);
}

function renderTimer() {
  const index = Math.min(2, Math.max(0, Number(state.phaseIndex || 0)));
  el("phaseSelect").value = String(index);
  el("mcTime").textContent = formatTime(remaining());

  const label =
    state.status === "running" ? "Running" :
    state.status === "paused" ? "Paused" :
    state.status === "completed" ? "Completed" :
    "Waiting";

  el("statusText").textContent = label;
  el("statusText").className = `connection ${state.status === "running" ? "online" : ""}`;
  el("startButton").disabled = state.status === "running";
  el("pauseButton").disabled = state.status !== "running";
}

function showMessage(id, text, type = "ok", sticky = false) {
  const box = el(id);
  if (!box) return;

  box.textContent = text;
  box.className = `msg ${type}`;
  clearTimeout(box._timer);

  if (!sticky) {
    box._timer = setTimeout(() => {
      box.textContent = "";
      box.className = "msg";
    }, 5000);
  }
}

function friendlyError(error) {
  const code = String(error?.code || "");

  if (code.includes("permission-denied")) {
    return "Firebase rejected the write. Add bridgeChallenge read/write permission in Realtime Database Rules.";
  }

  if (code.includes("auth")) {
    return "Firebase authentication failed. Confirm Anonymous Authentication is enabled.";
  }

  return error?.message || "Unknown Firebase error.";
}

async function runAction(button, action, successText, messageId = "controlMessage") {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";

  try {
    await action();
    showMessage(messageId, successText, "ok");
  } catch (error) {
    console.error(error);
    showMessage(messageId, friendlyError(error), "err", true);
  } finally {
    button.textContent = originalText;
    renderTimer();
  }
}

function scheduleCompletion() {
  clearTimeout(completionTimer);

  if (state.status !== "running") return;

  completionTimer = setTimeout(async () => {
    try {
      await update(bridgeRef("state"), {
        status: "completed",
        pausedRemaining: 0,
        remainingAtStart: 0,
        startedAt: null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Automatic completion failed:", error);
      showMessage("controlMessage", friendlyError(error), "err", true);
    }
  }, Math.max(0, remaining() * 1000 + 300));
}

function unlockMcPage() {
  el("loginScreen").classList.add("hidden");
  el("mcApp").classList.remove("hidden");
  sessionStorage.setItem("bridgeMcUnlocked", "yes");
}

el("loginButton").addEventListener("click", () => {
  if (el("mcPassword").value === MC_PASSWORD) {
    el("loginError").textContent = "";
    unlockMcPage();
  } else {
    el("loginError").textContent = "Incorrect password.";
    el("mcPassword").select();
  }
});

el("mcPassword").addEventListener("keydown", event => {
  if (event.key === "Enter") el("loginButton").click();
});

if (sessionStorage.getItem("bridgeMcUnlocked") === "yes") {
  unlockMcPage();
}

el("phaseSelect").addEventListener("change", async event => {
  const index = Number(event.target.value);

  try {
    clearTimeout(completionTimer);
    await set(bridgeRef("state"), {
      phaseIndex: index,
      status: "waiting",
      remainingAtStart: phases[index].duration,
      pausedRemaining: phases[index].duration,
      startedAt: null,
      updatedAt: serverTimestamp()
    });
    showMessage("controlMessage", `Selected ${phases[index].name}.`, "ok");
  } catch (error) {
    console.error(error);
    showMessage("controlMessage", friendlyError(error), "err", true);
    renderTimer();
  }
});

el("startButton").addEventListener("click", () => {
  const index = Number(state.phaseIndex || 0);
  const currentRemaining = Math.max(0, remaining() || phases[index].duration);

  runAction(
    el("startButton"),
    () => update(bridgeRef("state"), {
      phaseIndex: index,
      status: "running",
      startedAt: nowServer(),
      remainingAtStart: currentRemaining,
      pausedRemaining: null,
      updatedAt: serverTimestamp()
    }),
    "Shared timer started."
  );
});

el("pauseButton").addEventListener("click", () => {
  const currentRemaining = remaining();

  runAction(
    el("pauseButton"),
    () => update(bridgeRef("state"), {
      status: "paused",
      pausedRemaining: currentRemaining,
      remainingAtStart: currentRemaining,
      startedAt: null,
      updatedAt: serverTimestamp()
    }),
    "Shared timer paused."
  );
});

el("resetButton").addEventListener("click", () => {
  const index = Number(state.phaseIndex || 0);
  clearTimeout(completionTimer);

  runAction(
    el("resetButton"),
    () => set(bridgeRef("state"), {
      phaseIndex: index,
      status: "waiting",
      remainingAtStart: phases[index].duration,
      pausedRemaining: phases[index].duration,
      startedAt: null,
      updatedAt: serverTimestamp()
    }),
    "Current phase reset."
  );
});

el("nextButton").addEventListener("click", () => {
  const index = (Number(state.phaseIndex || 0) + 1) % 3;
  clearTimeout(completionTimer);

  runAction(
    el("nextButton"),
    () => set(bridgeRef("state"), {
      phaseIndex: index,
      status: "waiting",
      remainingAtStart: phases[index].duration,
      pausedRemaining: phases[index].duration,
      startedAt: null,
      updatedAt: serverTimestamp()
    }),
    `Ready for ${phases[index].name}.`
  );
});

el("completeButton").addEventListener("click", () => {
  clearTimeout(completionTimer);

  runAction(
    el("completeButton"),
    () => update(bridgeRef("state"), {
      status: "completed",
      pausedRemaining: 0,
      remainingAtStart: 0,
      startedAt: null,
      updatedAt: serverTimestamp()
    }),
    "Phase marked complete."
  );
});

el("sendAnnouncement").addEventListener("click", () => {
  const text = el("announcementText").value.trim();

  if (!text) {
    el("announcementText").focus();
    showMessage("announcementMessage", "Enter an announcement first.", "err");
    return;
  }

  runAction(
    el("sendAnnouncement"),
    () => set(bridgeRef("announcement"), {
      message: text,
      type: el("announcementType").value,
      updatedAt: serverTimestamp()
    }),
    "Announcement published.",
    "announcementMessage"
  );
});

el("clearAnnouncement").addEventListener("click", async () => {
  await runAction(
    el("clearAnnouncement"),
    () => set(bridgeRef("announcement"), null),
    "Announcement cleared.",
    "announcementMessage"
  );
  el("announcementText").value = "";
});

function scoreOrDash(value, decimals = 0) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function getInnovationSubmissions() {
  return Object.entries(innovationSubmissions || {})
    .filter(([, item]) => item && item.scores && item.judgeName)
    .map(([key, item]) => ({ key, ...item }));
}

function renderManagerEntries() {
  const host = el("managerEntries");
  const submissions = getInnovationSubmissions()
    .sort((a, b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0));

  if (!submissions.length) {
    host.innerHTML = '<p class="empty-score">No manager submissions yet.</p>';
    return;
  }

  host.innerHTML = "";

  submissions.forEach(item => {
    const card = document.createElement("article");
    card.className = "manager-entry";

    const scoreCells = TEAM_NAMES.map((team, index) => {
      const value = Number(item.scores?.[`team${index + 1}`]);
      return `<span><b>${escapeHtml(team)}</b>${Number.isFinite(value) ? value : "—"}</span>`;
    }).join("");

    const submitted = Number(item.submittedAt);
    const submittedText = Number.isFinite(submitted)
      ? new Date(submitted).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "Time unavailable";

    card.innerHTML = `
      <div class="manager-entry-head">
        <div>
          <h3>${escapeHtml(item.judgeName || "Unnamed manager")}</h3>
          <p>${escapeHtml(submittedText)}</p>
        </div>
        <button class="danger compact-btn" data-key="${escapeHtml(item.key)}">Delete entry</button>
      </div>
      <div class="manager-score-grid">${scoreCells}</div>
    `;

    card.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`Delete innovation submission from ${item.judgeName}?`)) return;

      try {
        await set(bridgeRef(`scores/innovation/${item.key}`), null);
        showMessage("managerEntryMessage", "Manager submission deleted.", "ok");
      } catch (error) {
        showMessage("managerEntryMessage", friendlyError(error), "err", true);
      }
    });

    host.appendChild(card);
  });
}

function compareResultRows(a, b) {
  return (
    (b.total - a.total) ||
    ((Number.isFinite(b.strength) ? b.strength : -1) - (Number.isFinite(a.strength) ? a.strength : -1)) ||
    ((Number.isFinite(b.teamwork) ? b.teamwork : -1) - (Number.isFinite(a.teamwork) ? a.teamwork : -1)) ||
    (a.index - b.index)
  );
}

function sameRankScore(a, b) {
  return (
    a &&
    b &&
    a.total === b.total &&
    (Number.isFinite(a.strength) ? a.strength : -1) === (Number.isFinite(b.strength) ? b.strength : -1) &&
    (Number.isFinite(a.teamwork) ? a.teamwork : -1) === (Number.isFinite(b.teamwork) ? b.teamwork : -1)
  );
}

function renderJudgingResults() {
  const body = el("judgingResultsBody");
  body.innerHTML = "";

  const submissions = getInnovationSubmissions();

  const rows = TEAM_NAMES.map((teamName, index) => {
    const teamKey = `team${index + 1}`;
    const strength = Number(strengthScores?.[teamKey]?.score);
    const teamwork = Number(teamworkScores?.scores?.[teamKey]);
    const innovationValues = submissions
      .map(item => Number(item.scores?.[teamKey]))
      .filter(Number.isFinite);

    const innovationAverage = innovationValues.length
      ? innovationValues.reduce((sum, value) => sum + value, 0) / innovationValues.length
      : NaN;

    const anyScore =
      Number.isFinite(strength) ||
      Number.isFinite(teamwork) ||
      Number.isFinite(innovationAverage);

    const total =
      (Number.isFinite(strength) ? strength : 0) +
      (Number.isFinite(teamwork) ? teamwork : 0) +
      (Number.isFinite(innovationAverage) ? innovationAverage : 0);

    return {
      index,
      teamName,
      strength,
      teamwork,
      innovationAverage,
      managerVotes: innovationValues.length,
      total: anyScore ? total : NaN,
      anyScore
    };
  });

  const scoredRows = rows.filter(row => row.anyScore).sort(compareResultRows);
  const unscoredRows = rows.filter(row => !row.anyScore);
  const displayRows = [...scoredRows, ...unscoredRows];

  let previousScoredRow = null;
  let previousRank = 0;

  displayRows.forEach((row, displayIndex) => {
    let rank = null;
    if (row.anyScore) {
      if (sameRankScore(row, previousScoredRow)) {
        rank = previousRank;
      } else {
        rank = displayIndex + 1;
        previousRank = rank;
      }
      previousScoredRow = row;
    }

    const tableRow = document.createElement("tr");
    if (rank && rank <= 3) tableRow.classList.add("top-three-row");

    tableRow.innerHTML = `
      <td class="rank-cell">${rank || "—"}</td>
      <td><strong>${escapeHtml(row.teamName)}</strong></td>
      <td class="${Number.isFinite(row.strength) ? "score-ready" : "score-waiting"}">${scoreOrDash(row.strength)}</td>
      <td class="${Number.isFinite(row.teamwork) ? "score-ready" : "score-waiting"}">${scoreOrDash(row.teamwork)}</td>
      <td class="${Number.isFinite(row.innovationAverage) ? "score-ready" : "score-waiting"}">${scoreOrDash(row.innovationAverage, 1)}</td>
      <td>${row.managerVotes}</td>
      <td class="score-total">${scoreOrDash(row.total, 1)}</td>
    `;
    body.appendChild(tableRow);
  });

  const teamworkReady = TEAM_NAMES.every((_, index) =>
    Number.isFinite(Number(teamworkScores?.scores?.[`team${index + 1}`]))
  );

  el("teamworkStatusBadge").textContent =
    teamworkReady ? "Teamwork: submitted by Kitty" : "Teamwork: not complete";
  el("teamworkStatusBadge").className = `connection ${teamworkReady ? "online" : ""}`;

  el("innovationStatusBadge").textContent =
    `Innovation: ${submissions.length} manager${submissions.length === 1 ? "" : "s"}`;
  el("innovationStatusBadge").className =
    `connection ${submissions.length ? "online" : ""}`;

  renderManagerEntries();
}

el("clearJudgingButton").addEventListener("click", async () => {
  if (!confirm("Clear all Strength, Teamwork and Innovation scores? This cannot be undone.")) {
    return;
  }

  await runAction(
    el("clearJudgingButton"),
    () => set(bridgeRef("scores"), null),
    "All judging scores cleared.",
    "judgingMessage"
  );
});

onValue(ref(db, ".info/connected"), snapshot => {
  const online = snapshot.val() === true;
  el("connectionBadge").textContent = online ? "Connected" : "Offline";
  el("connectionBadge").className = `connection ${online ? "online" : "offline"}`;
});

onValue(ref(db, ".info/serverTimeOffset"), snapshot => {
  serverOffset = Number(snapshot.val() || 0);
});

onValue(
  bridgeRef("state"),
  snapshot => {
    state = snapshot.val() || state;
    renderTimer();
    scheduleCompletion();
  },
  error => showMessage("controlMessage", friendlyError(error), "err", true)
);

onValue(
  bridgeRef("scores/teamwork"),
  snapshot => {
    teamworkScores = snapshot.val() || null;
    renderJudgingResults();
  },
  error => showMessage("judgingMessage", friendlyError(error), "err", true)
);

onValue(
  bridgeRef("scores/innovation"),
  snapshot => {
    innovationSubmissions = snapshot.val() || {};
    renderJudgingResults();
  },
  error => showMessage("judgingMessage", friendlyError(error), "err", true)
);

onValue(
  bridgeRef("scores/strength"),
  snapshot => {
    strengthScores = snapshot.val() || {};
    renderJudgingResults();
  },
  error => showMessage("judgingMessage", friendlyError(error), "err", true)
);

setInterval(renderTimer, 250);
renderTimer();
renderJudgingResults();

signInAnonymously(auth).catch(error => {
  console.error("Anonymous sign-in failed:", error);
  showMessage("controlMessage", friendlyError(error), "err", true);
});


// ---- Dynamic team count and award winners ----
let currentAwardData = {};

function normalizeAwardTeams(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

const awardChoiceConfig = [
  { field: "champion", hostId: "championChoices" },
  { field: "innovation", hostId: "innovationWinnerChoices" },
  { field: "spirit", hostId: "spiritWinnerChoices" }
];

function renderAwardTeamChoices() {
  awardChoiceConfig.forEach(({ field, hostId }) => {
    const host = el(hostId);
    if (!host) return;

    const selectedTeams = new Set(normalizeAwardTeams(currentAwardData[field]));
    host.innerHTML = "";

    TEAM_NAMES.forEach((teamName, index) => {
      const label = document.createElement("label");
      label.className = "award-team-choice";
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(teamName)}" ${selectedTeams.has(teamName) ? "checked" : ""}>
        <span>Team ${index + 1}</span>
      `;

      const checkbox = label.querySelector("input");
      checkbox.addEventListener("change", () => saveAwardChoices(field, hostId));
      host.appendChild(label);
    });
  });
}

async function saveAwardChoices(field, hostId) {
  const host = el(hostId);
  const selectedTeams = [...host.querySelectorAll('input[type="checkbox"]:checked')]
    .map(input => input.value);

  try {
    await update(bridgeRef("awards"), {
      [field]: selectedTeams.length ? selectedTeams : null,
      updatedAt: serverTimestamp()
    });
    showMessage(
      "awardControlMessage",
      selectedTeams.length
        ? `${selectedTeams.length} winner${selectedTeams.length === 1 ? "" : "s"} selected.`
        : "Award selection cleared.",
      "ok"
    );
  } catch (error) {
    showMessage("awardControlMessage", friendlyError(error), "err", true);
    renderAwardTeamChoices();
  }
}

el("teamCountSelect")?.addEventListener("change", async event => {
  const count = Number(event.target.value);
  try {
    await set(bridgeRef("settings/teamCount"), count);
    showMessage("settingsMessage", `Updated to ${count} teams.`, "ok");
  } catch (error) {
    showMessage("settingsMessage", friendlyError(error), "err", true);
  }
});


el("resetAwardsButton")?.addEventListener("click", async () => {
  try {
    await set(bridgeRef("awards"), null);
    showMessage("awardControlMessage", "Awards reset.", "ok");
  } catch (error) {
    showMessage("awardControlMessage", friendlyError(error), "err", true);
  }
});

onValue(bridgeRef("settings/teamCount"), snapshot => {
  const count = Number(snapshot.val() || DEFAULT_TEAM_COUNT);
  TEAM_NAMES = makeTeamNames(count);
  if (el("teamCountSelect")) el("teamCountSelect").value = String(count);
  if (el("teamCountStatus")) el("teamCountStatus").textContent = `${count} teams`;
  renderAwardTeamChoices();
  renderJudgingResults();
});

onValue(bridgeRef("awards"), snapshot => {
  currentAwardData = snapshot.val() || {};
  renderAwardTeamChoices();
});


// ---- Bonus-game Firebase results ----
let bonusLeaderboard = {};
let bonusRewards = {};

function renderBonusAdmin() {
  const host = el("bonusAdminList");
  if (!host) return;

  const entries = Object.values(bonusLeaderboard || {})
    .filter(item => item && Number.isFinite(Number(item.score)))
    .sort((a, b) => Number(b.score) - Number(a.score) || Number(a.submittedAt || 0) - Number(b.submittedAt || 0));

  const rewardTeams = Object.values(bonusRewards || {}).filter(Boolean);
  el("bonusEntryBadge").textContent = `${entries.length} leaderboard entr${entries.length === 1 ? "y" : "ies"}`;
  el("bonusRewardBadge").textContent = `${rewardTeams.length} team${rewardTeams.length === 1 ? "" : "s"} qualified`;
  el("bonusEntryBadge").className = `connection ${entries.length ? "online" : ""}`;
  el("bonusRewardBadge").className = `connection ${rewardTeams.length ? "online" : ""}`;

  if (!entries.length) {
    host.innerHTML = '<p class="empty-score">No bonus-game results yet.</p>';
    return;
  }

  host.innerHTML = entries.slice(0, 30).map((entry, index) => {
    const qualified = Boolean(bonusRewards?.[entry.teamKey]);
    return `<article class="bonus-admin-entry">
      <div>
        <strong>${index + 1}. ${escapeHtml(entry.playerName || "Anonymous")} · ${escapeHtml(entry.teamName || "")}</strong>
        <small>${qualified ? "✅ Team reward unlocked" : "Score submitted"}</small>
      </div>
      <b>${Number(entry.score)}</b>
      <small>${Number(entry.submittedAt) ? new Date(Number(entry.submittedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}</small>
    </article>`;
  }).join("");
}

onValue(bridgeRef("bonusGame/leaderboard"), snapshot => {
  bonusLeaderboard = snapshot.val() || {};
  renderBonusAdmin();
});

onValue(bridgeRef("bonusGame/teamRewards"), snapshot => {
  bonusRewards = snapshot.val() || {};
  renderBonusAdmin();
});

el("clearBonusGameButton")?.addEventListener("click", async () => {
  if (!confirm("Clear the bonus-game leaderboard and all one-time team reward records?")) return;

  try {
    await set(bridgeRef("bonusGame"), null);
    showMessage("bonusAdminMessage", "Bonus-game results cleared.", "ok");
  } catch (error) {
    showMessage("bonusAdminMessage", friendlyError(error), "err", true);
  }
});


// ---- Hidden Design Lab bonus administration ----
let hiddenBonusRewards = {};

function renderHiddenBonusAdmin() {
  const host = el("hiddenBonusAdminList");
  if (!host) return;

  const entries = Object.entries(hiddenBonusRewards || {})
    .filter(([, item]) => item)
    .sort(([, a], [, b]) => Number(a.unlockedAt || 0) - Number(b.unlockedAt || 0));

  if (!entries.length) {
    host.innerHTML = '<p class="empty-score">No teams have unlocked the hidden bonus yet.</p>';
    return;
  }

  host.innerHTML = entries.map(([teamKey, item], index) => `
    <article class="bonus-admin-entry">
      <div>
        <strong>${index + 1}. ${escapeHtml(item.teamName || teamKey)}</strong>
        <small>✅ One-time hidden bonus unlocked</small>
      </div>
      <b>Extra resource</b>
      <small>${Number(item.unlockedAt) ? new Date(Number(item.unlockedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}</small>
    </article>
  `).join("");
}

onValue(bridgeRef("hiddenBonus/teamRewards"), snapshot => {
  hiddenBonusRewards = snapshot.val() || {};
  renderHiddenBonusAdmin();
});

el("clearHiddenBonusButton")?.addEventListener("click", async () => {
  if (!confirm("Clear all hidden Design Lab bonus claims?")) return;
  try {
    await set(bridgeRef("hiddenBonus"), null);
    showMessage("hiddenBonusAdminMessage", "Hidden bonus claims cleared.", "ok");
  } catch (error) {
    showMessage("hiddenBonusAdminMessage", friendlyError(error), "err", true);
  }
});


// ---- Intel Innovation triple-tap dare administration ----
let intelDareRewards = {};

function renderIntelDareAdmin() {
  const host = el("intelDareAdminList");
  if (!host) return;

  const entries = Object.entries(intelDareRewards || {})
    .filter(([, item]) => item)
    .sort(([, a], [, b]) => Number(a.unlockedAt || 0) - Number(b.unlockedAt || 0));

  if (!entries.length) {
    host.innerHTML = '<p class="empty-score">No teams have discovered this surprise yet.</p>';
    return;
  }

  host.innerHTML = entries.map(([teamKey, item], index) => `
    <article class="bonus-admin-entry">
      <div>
        <strong>${index + 1}. ${escapeHtml(item.teamName || teamKey)}</strong>
        <small>🎁 Intel Innovation surprise unlocked</small>
      </div>
      <b>Extra resource</b>
      <small>${Number(item.unlockedAt) ? new Date(Number(item.unlockedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}</small>
    </article>
  `).join("");
}

onValue(bridgeRef("intelDareBonus/teamRewards"), snapshot => {
  intelDareRewards = snapshot.val() || {};
  renderIntelDareAdmin();
});

el("clearIntelDareButton")?.addEventListener("click", async () => {
  if (!confirm("Clear all Intel Innovation dare-bonus claims?")) return;

  try {
    await set(bridgeRef("intelDareBonus"), null);
    showMessage("intelDareAdminMessage", "Intel dare-bonus claims cleared.", "ok");
  } catch (error) {
    showMessage("intelDareAdminMessage", friendlyError(error), "err", true);
  }
});


// ---- Automatic Super Bonus live announcement ----
// A team qualifies only after completing all three hidden activities:
// 1. Bonus Game score reward
// 2. Hidden Design Lab question
// 3. Intel Innovation dare
let bonusGameTeamRewards = {};
let designLabHiddenRewards = {};
let intelDareTeamRewards = {};

async function checkForSuperBonusTeams() {
  const eligibleTeamKeys = Object.keys(bonusGameTeamRewards || {}).filter(teamKey =>
    bonusGameTeamRewards?.[teamKey] &&
    designLabHiddenRewards?.[teamKey] &&
    intelDareTeamRewards?.[teamKey]
  );

  for (const teamKey of eligibleTeamKeys) {
    const teamName =
      bonusGameTeamRewards?.[teamKey]?.teamName ||
      designLabHiddenRewards?.[teamKey]?.teamName ||
      intelDareTeamRewards?.[teamKey]?.teamName ||
      teamKey;

    const announcedRef = bridgeRef(`superBonus/announcedTeams/${teamKey}`);

    try {
      let firstAnnouncement = false;
      const transactionResult = await runTransaction(announcedRef, current => {
        if (current) return;
        firstAnnouncement = true;
        return {
          teamName,
          announcedAt: Date.now()
        };
      });

      if (transactionResult.committed && firstAnnouncement) {
        await update(bridgeRef("superBonusAnnouncement"), {
          [`teams/${teamKey}`]: {
            teamName,
            announcedAt: Date.now()
          },
          updatedAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error("Unable to publish Super Bonus announcement:", error);
      showMessage(
        "superBonusAdminMessage",
        `Unable to publish the Super Bonus announcement: ${friendlyError(error)}`,
        "err",
        true
      );
    }
  }
}

onValue(bridgeRef("bonusGame/teamRewards"), snapshot => {
  bonusGameTeamRewards = snapshot.val() || {};
  checkForSuperBonusTeams();
});

onValue(bridgeRef("hiddenBonus/teamRewards"), snapshot => {
  designLabHiddenRewards = snapshot.val() || {};
  checkForSuperBonusTeams();
});

onValue(bridgeRef("intelDareBonus/teamRewards"), snapshot => {
  intelDareTeamRewards = snapshot.val() || {};
  checkForSuperBonusTeams();
});


let superBonusAnnouncements = {};

function renderSuperBonusAdmin() {
  const host = el("superBonusAdminList");
  if (!host) return;

  const entries = Object.entries(superBonusAnnouncements || {})
    .filter(([, item]) => item)
    .sort(([, a], [, b]) => Number(a.announcedAt || 0) - Number(b.announcedAt || 0));

  if (!entries.length) {
    host.innerHTML = '<p class="empty-score">No team has completed all three hidden activities yet.</p>';
    return;
  }

  host.innerHTML = entries.map(([teamKey, item], index) => `
    <article class="bonus-admin-entry">
      <div>
        <strong>${index + 1}. ${escapeHtml(item.teamName || teamKey)}</strong>
        <small>🏆 All three hidden activities completed</small>
      </div>
      <b>Super extra resource</b>
      <small>${Number(item.announcedAt) ? new Date(Number(item.announcedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}</small>
    </article>
  `).join("");
}

onValue(bridgeRef("superBonus/announcedTeams"), snapshot => {
  superBonusAnnouncements = snapshot.val() || {};
  renderSuperBonusAdmin();
});

el("clearSuperBonusButton")?.addEventListener("click", async () => {
  if (!confirm("Reset all Super Bonus announcement records? Teams may be announced again if they still have all three hidden rewards.")) return;

  try {
    await Promise.all([
      set(bridgeRef("superBonus"), null),
      set(bridgeRef("superBonusAnnouncement"), null)
    ]);
    showMessage("superBonusAdminMessage", "Super Bonus announcements cleared.", "ok");
  } catch (error) {
    showMessage("superBonusAdminMessage", friendlyError(error), "err", true);
  }
});


el("clearSuperBonusMessageButton")?.addEventListener("click", async () => {
  if (!confirm("Clear the dedicated Super Bonus winner announcement?")) return;

  try {
    await set(bridgeRef("superBonusAnnouncement"), null);
    showMessage("superBonusAdminMessage", "Super Bonus winner message cleared.", "ok");
  } catch (error) {
    showMessage("superBonusAdminMessage", friendlyError(error), "err", true);
  }
});


onValue(bridgeRef("superBonusAnnouncement"), snapshot => {
  const data = snapshot.val() || {};
  const preview = el("superBonusAnnouncementPreview");
  if (!preview) return;

  const teams = Object.values(data.teams || {})
    .filter(Boolean)
    .sort((a, b) => Number(a.announcedAt || 0) - Number(b.announcedAt || 0));

  if (!teams.length) {
    preview.textContent = "No Super Bonus winners announced yet.";
    preview.className = "announcement";
    return;
  }

  const names = teams.map(item => item.teamName).filter(Boolean);
  preview.textContent =
    `🏆 SUPER BONUS WINNERS: ${names.join(", ")}. ` +
    `${names.length === 1 ? "This team has" : "These teams have"} completed all three hidden challenges. ` +
    `Please come forward to collect the SUPER EXTRA RESOURCE!`;
  preview.className = "announcement success";
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

let TEAM_NAMES = makeTeamNames(DEFAULT_TEAM_COUNT);
const PASSWORD = "gicgic";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);
const teamworkRef = ref(db, `${BRIDGE_PATH}/scores/teamwork`);

let values = Array(TEAM_NAMES.length).fill(null);
let saveTimers = Array(TEAM_NAMES.length).fill(null);
let cards = [];

function showStatus(text, className = "") {
  const box = el("teamworkAutosaveStatus");
  box.textContent = text;
  box.className = `small ${className}`.trim();
}

function friendlyError(error) {
  return String(error?.code || "").includes("permission-denied")
    ? "Firebase permission denied. Confirm bridgeChallenge rules are published."
    : (error?.message || "Unable to save.");
}

function unlock() {
  el("judgeLogin").classList.add("hidden");
  el("judgeApp").classList.remove("hidden");
  sessionStorage.setItem("teamworkJudgeUnlocked", "yes");
}

el("judgeLoginButton").addEventListener("click", () => {
  if (el("judgePassword").value === PASSWORD) {
    el("judgeLoginError").textContent = "";
    unlock();
  } else {
    el("judgeLoginError").textContent = "Incorrect password.";
  }
});

el("judgePassword").addEventListener("keydown", event => {
  if (event.key === "Enter") el("judgeLoginButton").click();
});

if (sessionStorage.getItem("teamworkJudgeUnlocked") === "yes") unlock();

function updateCompletion() {
  const count = values.filter(Number.isFinite).length;
  el("teamworkCompletion").textContent = `${count} / ${TEAM_NAMES.length} teams scored`;
}

async function saveTeam(index) {
  if (!Number.isFinite(values[index])) return;

  const card = cards[index];
  const saveLabel = card.querySelector(".team-save-state");
  saveLabel.textContent = "Saving…";
  saveLabel.className = "team-save-state saving";

  try {
    await update(teamworkRef, {
      judgeName: "KC",
      [`scores/team${index + 1}`]: values[index],
      submittedAt: serverTimestamp()
    });
    saveLabel.textContent = "Saved ✓";
    saveLabel.className = "team-save-state saved";
    showStatus(`Latest change saved for ${TEAM_NAMES[index]}.`, "saved-text");
  } catch (error) {
    console.error(error);
    saveLabel.textContent = "Save failed";
    saveLabel.className = "team-save-state failed";
    showStatus(friendlyError(error), "error-text");
  }
}

function queueSave(index) {
  clearTimeout(saveTimers[index]);
  cards[index].querySelector(".team-save-state").textContent = "Waiting…";
  cards[index].querySelector(".team-save-state").className = "team-save-state saving";
  saveTimers[index] = setTimeout(() => saveTeam(index), 350);
}

function buildCards() {
  values = Array(TEAM_NAMES.length).fill(null);
  saveTimers = Array(TEAM_NAMES.length).fill(null);
  cards = [];

  const host = el("teamworkCards");
  host.innerHTML = "";

  TEAM_NAMES.forEach((name, index) => {
    const card = document.createElement("section");
    card.className = "judge-score-card";
    card.innerHTML = `
      <div class="judge-team-heading">
        <div>
          <span class="team-number">TEAM ${index + 1}</span>
          <h2>${name}</h2>
          <span class="team-save-state">Not scored</span>
        </div>
        <output id="tw-output-${index}" class="score-output">— / 30</output>
      </div>
      <input id="tw-range-${index}" class="score-range teamwork-range" type="range" min="0" max="30" step="1" value="15">
      <div class="quick-scores">
        <button data-score="10">10</button>
        <button data-score="15">15</button>
        <button data-score="20">20</button>
        <button data-score="25">25</button>
        <button data-score="30">30</button>
      </div>`;

    const range = card.querySelector("input");
    const output = card.querySelector("output");

    const setScore = score => {
      values[index] = Number(score);
      range.value = String(score);
      output.textContent = `${score} / 30`;
      card.classList.add("scored");
      updateCompletion();
      queueSave(index);
    };

    range.addEventListener("input", () => setScore(range.value));
    card.querySelectorAll(".quick-scores button").forEach(button => {
      button.addEventListener("click", () => setScore(button.dataset.score));
    });

    cards.push(card);
    host.appendChild(card);
  });

  updateCompletion();
}

buildCards();

onValue(ref(db, ".info/connected"), snapshot => {
  const online = snapshot.val() === true;
  el("connectionBadge").textContent = online ? "Connected" : "Offline";
  el("connectionBadge").className = `connection ${online ? "online" : "offline"}`;
});

onValue(teamworkRef, snapshot => {
  const data = snapshot.val();
  if (!data?.scores) {
    updateCompletion();
    return;
  }

  TEAM_NAMES.forEach((_, index) => {
    const saved = Number(data.scores[`team${index + 1}`]);
    if (!Number.isFinite(saved)) return;

    values[index] = saved;
    el(`tw-range-${index}`).value = String(saved);
    el(`tw-output-${index}`).textContent = `${saved} / 30`;
    cards[index].classList.add("scored");
    const saveLabel = cards[index].querySelector(".team-save-state");
    saveLabel.textContent = "Saved ✓";
    saveLabel.className = "team-save-state saved";
  });

  updateCompletion();
  showStatus("All displayed scores are synchronised with Firebase.", "saved-text");
});

signInAnonymously(auth).catch(error => showStatus(friendlyError(error), "error-text"));


let latestTeamwork = null;
let latestStrength = {};
let latestInnovation = {};

function compareKCRows(a, b) {
  return (
    (b.total - a.total) ||
    ((Number.isFinite(b.strength) ? b.strength : -1) - (Number.isFinite(a.strength) ? a.strength : -1)) ||
    ((Number.isFinite(b.teamwork) ? b.teamwork : -1) - (Number.isFinite(a.teamwork) ? a.teamwork : -1)) ||
    (a.index - b.index)
  );
}

function sameKCRank(a, b) {
  return (
    a &&
    b &&
    a.total === b.total &&
    (Number.isFinite(a.strength) ? a.strength : -1) === (Number.isFinite(b.strength) ? b.strength : -1) &&
    (Number.isFinite(a.teamwork) ? a.teamwork : -1) === (Number.isFinite(b.teamwork) ? b.teamwork : -1)
  );
}

function renderKCBoard() {
  const body = el("kittyResultsBody");
  if (!body) return;

  const managerEntries = Object.values(latestInnovation || {}).filter(item => item?.scores);
  const rows = TEAM_NAMES.map((teamName, index) => {
    const key = `team${index + 1}`;
    const strength = Number(latestStrength?.[key]?.score);
    const teamwork = Number(latestTeamwork?.scores?.[key]);
    const innovationValues = managerEntries
      .map(item => Number(item.scores?.[key]))
      .filter(Number.isFinite);
    const innovation = innovationValues.length
      ? innovationValues.reduce((sum, value) => sum + value, 0) / innovationValues.length
      : NaN;
    const any =
      Number.isFinite(strength) ||
      Number.isFinite(teamwork) ||
      Number.isFinite(innovation);
    const total =
      (Number.isFinite(strength) ? strength : 0) +
      (Number.isFinite(teamwork) ? teamwork : 0) +
      (Number.isFinite(innovation) ? innovation : 0);

    return {
      index,
      teamName,
      strength,
      teamwork,
      innovation,
      managerVotes: innovationValues.length,
      total: any ? total : NaN,
      any
    };
  });

  const scoredRows = rows.filter(row => row.any).sort(compareKCRows);
  const unscoredRows = rows.filter(row => !row.any);
  const displayRows = [...scoredRows, ...unscoredRows];

  let previous = null;
  let previousRank = 0;

  body.innerHTML = displayRows.map((row, displayIndex) => {
    let rank = null;
    if (row.any) {
      if (sameKCRank(row, previous)) {
        rank = previousRank;
      } else {
        rank = displayIndex + 1;
        previousRank = rank;
      }
      previous = row;
    }

    return `<tr class="${rank && rank <= 3 ? "top-three-row" : ""}">
      <td>${rank || "—"}</td>
      <td><strong>${row.teamName}</strong></td>
      <td>${Number.isFinite(row.strength) ? row.strength : "—"}</td>
      <td>${Number.isFinite(row.teamwork) ? row.teamwork : "—"}</td>
      <td>${Number.isFinite(row.innovation) ? row.innovation.toFixed(1) : "—"}</td>
      <td>${row.managerVotes}</td>
      <td class="score-total">${row.any ? row.total.toFixed(1) : "—"}</td>
    </tr>`;
  }).join("");
}

onValue(ref(db, `${BRIDGE_PATH}/settings/teamCount`), snapshot => {
  TEAM_NAMES = makeTeamNames(snapshot.val() || DEFAULT_TEAM_COUNT);
  buildCards();

  if (latestTeamwork?.scores) {
    TEAM_NAMES.forEach((_, index) => {
      const saved = Number(latestTeamwork.scores[`team${index + 1}`]);
      if (!Number.isFinite(saved)) return;

      values[index] = saved;
      el(`tw-range-${index}`).value = String(saved);
      el(`tw-output-${index}`).textContent = `${saved} / 30`;
      cards[index].classList.add("scored");

      const saveLabel = cards[index].querySelector(".team-save-state");
      saveLabel.textContent = "Saved ✓";
      saveLabel.className = "team-save-state saved";
    });
    updateCompletion();
  }

  renderKCBoard();
});

onValue(teamworkRef, snapshot => {
  latestTeamwork = snapshot.val() || null;
  renderKCBoard();
});

onValue(ref(db, `${BRIDGE_PATH}/scores/strength`), snapshot => {
  latestStrength = snapshot.val() || {};
  renderKCBoard();
});

onValue(ref(db, `${BRIDGE_PATH}/scores/innovation`), snapshot => {
  latestInnovation = snapshot.val() || {};
  renderKCBoard();
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

let TEAM_NAMES = makeTeamNames(DEFAULT_TEAM_COUNT);
const PASSWORD = "gicgic";

const stages = [
  { id: "stage1", title: "A4 paper", detail: "Bridge completed and supports 1 A4 paper", points: 10 },
  { id: "stage2", title: "10 coins", detail: "Add 10 identical coins", points: 5 },
  { id: "stage3", title: "1 coffee can", detail: "Place 1 coffee can on top", points: 10 },
  { id: "stage4", title: "2 cans total", detail: "Increase to 2 coffee cans in total", points: 10 },
  { id: "stage5", title: "2.5 kg object", detail: "Place a 2.5 kg object on top", points: 15 }
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);

let results = TEAM_NAMES.map(() => Array(stages.length).fill(false));
let cards = [];
let saveTimers = Array(TEAM_NAMES.length).fill(null);
let loadedFromFirebase = false;

function teamRef(index) {
  return ref(db, `${BRIDGE_PATH}/scores/strength/team${index + 1}`);
}

function friendlyError(error) {
  return String(error?.code || "").includes("permission-denied")
    ? "Firebase permission denied. Confirm bridgeChallenge rules are published."
    : (error?.message || "Unable to save.");
}

function showStatus(text, className = "") {
  const box = el("loadAutosaveStatus");
  box.textContent = text;
  box.className = `small ${className}`.trim();
}

function unlock() {
  el("judgeLogin").classList.add("hidden");
  el("judgeApp").classList.remove("hidden");
  sessionStorage.setItem("loadTestUnlocked", "yes");
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

if (sessionStorage.getItem("loadTestUnlocked") === "yes") unlock();

function totalScore(teamIndex) {
  return stages.reduce(
    (sum, stage, stageIndex) => sum + (results[teamIndex][stageIndex] ? stage.points : 0),
    0
  );
}

function testedCount() {
  return results.filter(team => team.some(Boolean)).length;
}

function updateCompletion() {
  el("loadCompletion").textContent = `${testedCount()} / ${TEAM_NAMES.length} teams tested`;
}

function renderTeam(teamIndex) {
  const card = cards[teamIndex];
  card.querySelector(".load-team-total").textContent = `${totalScore(teamIndex)} / 50`;

  card.querySelectorAll(".load-stage-toggle").forEach((button, stageIndex) => {
    const passed = results[teamIndex][stageIndex];
    button.classList.toggle("passed", passed);
    button.setAttribute("aria-pressed", String(passed));
    button.querySelector(".stage-state").textContent = passed ? `Passed +${stages[stageIndex].points}` : "Not passed";
  });

  card.classList.toggle("tested", results[teamIndex].some(Boolean));
  updateCompletion();
}

async function saveTeam(teamIndex) {
  const card = cards[teamIndex];
  const saveState = card.querySelector(".team-save-state");
  saveState.textContent = "Saving…";
  saveState.className = "team-save-state saving";

  const stagePayload = {};
  stages.forEach((stage, stageIndex) => {
    stagePayload[stage.id] = results[teamIndex][stageIndex];
  });

  try {
    await set(teamRef(teamIndex), {
      teamName: TEAM_NAMES[teamIndex],
      score: totalScore(teamIndex),
      stages: stagePayload,
      updatedAt: serverTimestamp()
    });
    saveState.textContent = "Saved ✓";
    saveState.className = "team-save-state saved";
    showStatus(`Latest result saved for ${TEAM_NAMES[teamIndex]}.`, "saved-text");
  } catch (error) {
    console.error(error);
    saveState.textContent = "Save failed";
    saveState.className = "team-save-state failed";
    showStatus(friendlyError(error), "error-text");
  }
}

function queueSave(teamIndex) {
  clearTimeout(saveTimers[teamIndex]);
  const saveState = cards[teamIndex].querySelector(".team-save-state");
  saveState.textContent = "Waiting…";
  saveState.className = "team-save-state saving";
  saveTimers[teamIndex] = setTimeout(() => saveTeam(teamIndex), 300);
}

function toggleStage(teamIndex, stageIndex) {
  const next = !results[teamIndex][stageIndex];

  if (next) {
    for (let index = 0; index <= stageIndex; index += 1) {
      results[teamIndex][index] = true;
    }
  } else {
    for (let index = stageIndex; index < stages.length; index += 1) {
      results[teamIndex][index] = false;
    }
  }

  renderTeam(teamIndex);
  queueSave(teamIndex);
}

function buildCards() {
  results = TEAM_NAMES.map(() => Array(stages.length).fill(false));
  cards = [];
  saveTimers = Array(TEAM_NAMES.length).fill(null);
  const host = el("loadTeamCards");
  host.innerHTML = "";

  TEAM_NAMES.forEach((teamName, teamIndex) => {
    const card = document.createElement("section");
    card.className = "load-team-card";
    card.innerHTML = `
      <div class="load-team-heading">
        <div>
          <span class="team-number">TEAM ${teamIndex + 1}</span>
          <h2>${teamName}</h2>
          <span class="team-save-state">Not tested</span>
        </div>
        <output class="load-team-total">0 / 50</output>
      </div>
      <div class="load-stage-buttons">
        ${stages.map((stage, stageIndex) => `
          <button class="load-stage-toggle" data-stage="${stageIndex}" aria-pressed="false">
            <span class="load-stage-index">${stageIndex + 1}</span>
            <span class="load-stage-copy">
              <b>${stage.title}</b>
              <small>${stage.detail}</small>
            </span>
            <span class="stage-state">Not passed</span>
          </button>
        `).join("")}
      </div>`;

    card.querySelectorAll(".load-stage-toggle").forEach((button, stageIndex) => {
      button.addEventListener("click", () => toggleStage(teamIndex, stageIndex));
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

onValue(ref(db, `${BRIDGE_PATH}/scores/strength`), snapshot => {
  const data = snapshot.val() || {};

  TEAM_NAMES.forEach((_, teamIndex) => {
    const saved = data[`team${teamIndex + 1}`];
    if (!saved) return;

    results[teamIndex] = stages.map(stage => Boolean(saved.stages?.[stage.id]));
    renderTeam(teamIndex);

    const saveState = cards[teamIndex].querySelector(".team-save-state");
    saveState.textContent = "Saved ✓";
    saveState.className = "team-save-state saved";
  });

  loadedFromFirebase = true;
  updateCompletion();
  showStatus("All displayed results are synchronised with Firebase.", "saved-text");
});

signInAnonymously(auth).catch(error => showStatus(friendlyError(error), "error-text"));


onValue(ref(db, `${BRIDGE_PATH}/settings/teamCount`), snapshot => {
  TEAM_NAMES = makeTeamNames(snapshot.val() || DEFAULT_TEAM_COUNT);
  buildCards();
});

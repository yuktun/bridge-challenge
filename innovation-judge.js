import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);
const PASSWORD = "gicgic";
const ALLOWED_JUDGES = ["DC", "EL", "HL", "KP", "OL", "PW", "RL", "THC", "Other 1", "Other 2"];
let TEAM_NAMES = makeTeamNames(DEFAULT_TEAM_COUNT);
let values = Array(TEAM_NAMES.length).fill(null);
let currentJudgeKey = "";
let currentJudgeName = "";
let authUser = null;
let judgeUnsubscribe = null;
const saveTimers = new Map();

function cleanKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").slice(0, 50);
}
function judgeRef(key) {
  return ref(db, `${BRIDGE_PATH}/scores/innovation/${key}`);
}
function showMessage(text, type = "ok") {
  const box = el("innovationMessage");
  box.textContent = text;
  box.className = `msg judge-page-message ${type}`;
}
function setAutosaveStatus(text) {
  el("innovationAutosaveStatus").textContent = text;
}
function friendlyError(error) {
  return String(error?.code || "").includes("permission-denied")
    ? "Firebase permission denied. Confirm bridgeChallenge read/write rules are published."
    : (error?.message || "Unable to save.");
}
function unlock(name) {
  currentJudgeName = name;
  currentJudgeKey = cleanKey(name);
  el("activeJudgeName").textContent = name;
  el("judgeLogin").classList.add("hidden");
  el("judgeApp").classList.remove("hidden");
  sessionStorage.setItem("innovationJudgeUnlockedName", name);
  subscribeToJudgeScores();
}

el("judgeLoginButton").onclick = () => {
  const name = el("judgeIdentity").value;
  if (!ALLOWED_JUDGES.includes(name)) {
    el("judgeLoginError").textContent = "Please select your login name.";
    return;
  }
  if (el("judgePassword").value !== PASSWORD) {
    el("judgeLoginError").textContent = "Incorrect password.";
    return;
  }
  el("judgeLoginError").textContent = "";
  unlock(name);
};
el("judgePassword").addEventListener("keydown", event => {
  if (event.key === "Enter") el("judgeLoginButton").click();
});

function updateCompletion() {
  const count = values.filter(Number.isFinite).length;
  el("innovationCompletion").textContent = `${count} / ${TEAM_NAMES.length} teams scored`;
}

function markCard(index, score) {
  const range = el(`in-range-${index}`);
  const output = el(`in-output-${index}`);
  if (!range || !output) return;
  values[index] = score;
  range.value = String(score);
  output.textContent = `${score} / 20`;
  range.closest(".judge-score-card")?.classList.add("scored");
  updateCompletion();
}

async function saveTeam(index) {
  if (!currentJudgeKey || !Number.isFinite(values[index])) return;
  const cardStatus = el(`in-save-${index}`);
  if (cardStatus) cardStatus.textContent = "Saving…";
  setAutosaveStatus("Saving…");
  try {
    await update(judgeRef(currentJudgeKey), {
      judgeName: currentJudgeName,
      judgeKey: currentJudgeKey,
      authUid: authUser?.uid || "",
      [`scores/team${index + 1}`]: values[index],
      submittedAt: serverTimestamp()
    });
    if (cardStatus) cardStatus.textContent = "Saved";
    setAutosaveStatus("All changes saved");
    showMessage(`${TEAM_NAMES[index]} saved automatically.`, "ok");
  } catch (error) {
    console.error(error);
    if (cardStatus) cardStatus.textContent = "Save failed";
    setAutosaveStatus("Unable to save");
    showMessage(friendlyError(error), "err");
  }
}

function queueSave(index) {
  clearTimeout(saveTimers.get(index));
  const cardStatus = el(`in-save-${index}`);
  if (cardStatus) cardStatus.textContent = "Waiting to save…";
  setAutosaveStatus("Changes pending…");
  saveTimers.set(index, setTimeout(() => saveTeam(index), 350));
}

function buildCards() {
  values = Array(TEAM_NAMES.length).fill(null);
  const host = el("innovationCards");
  host.innerHTML = "";
  TEAM_NAMES.forEach((name, index) => {
    const card = document.createElement("section");
    card.className = "judge-score-card";
    card.innerHTML = `
      <div class="judge-team-heading">
        <div><span class="team-number">TEAM ${index + 1}</span><h2>${name}</h2></div>
        <output id="in-output-${index}" class="score-output">— / 20</output>
      </div>
      <input id="in-range-${index}" class="score-range innovation-range" type="range" min="0" max="20" step="1" value="10">
      <div class="quick-scores">
        <button type="button" data-score="5">5</button><button type="button" data-score="10">10</button>
        <button type="button" data-score="12">12</button><button type="button" data-score="15">15</button><button type="button" data-score="20">20</button>
      </div>
      <small id="in-save-${index}" class="team-save-state">Not scored</small>`;
    const range = card.querySelector("input");
    const setScore = score => {
      markCard(index, Number(score));
      queueSave(index);
    };
    range.addEventListener("input", () => setScore(range.value));
    card.querySelectorAll(".quick-scores button").forEach(button => {
      button.onclick = () => setScore(button.dataset.score);
    });
    host.appendChild(card);
  });
  updateCompletion();
}

function subscribeToJudgeScores() {
  judgeUnsubscribe?.();
  if (!currentJudgeKey) return;
  judgeUnsubscribe = onValue(judgeRef(currentJudgeKey), snapshot => {
    const scores = snapshot.val()?.scores || {};
    TEAM_NAMES.forEach((_, index) => {
      const saved = Number(scores[`team${index + 1}`]);
      if (Number.isFinite(saved)) {
        markCard(index, saved);
        const status = el(`in-save-${index}`);
        if (status) status.textContent = "Saved";
      }
    });
    setAutosaveStatus("All changes saved");
  }, error => showMessage(friendlyError(error), "err"));
}

buildCards();
const savedIdentity = sessionStorage.getItem("innovationJudgeUnlockedName");
if (ALLOWED_JUDGES.includes(savedIdentity)) {
  el("judgeIdentity").value = savedIdentity;
  unlock(savedIdentity);
}

onValue(ref(db, ".info/connected"), snapshot => {
  const online = snapshot.val() === true;
  el("connectionBadge").textContent = online ? "Connected" : "Offline";
  el("connectionBadge").className = `connection ${online ? "online" : "offline"}`;
});

onAuthStateChanged(auth, user => {
  authUser = user;
});
signInAnonymously(auth).catch(error => showMessage(friendlyError(error), "err"));

onValue(ref(db, `${BRIDGE_PATH}/settings/teamCount`), snapshot => {
  TEAM_NAMES = makeTeamNames(snapshot.val() || DEFAULT_TEAM_COUNT);
  buildCards();
  subscribeToJudgeScores();
});

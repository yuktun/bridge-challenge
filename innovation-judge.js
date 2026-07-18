import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue, set, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { firebaseConfig, BRIDGE_PATH, DEFAULT_TEAM_COUNT, makeTeamNames } from "./config.js";
let TEAM_NAMES = makeTeamNames(DEFAULT_TEAM_COUNT);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const el = id => document.getElementById(id);
const PASSWORD = "gicgic";
let values = Array(TEAM_NAMES.length).fill(null);
let currentJudgeKey = "";
let currentJudgeName = "";
let authUser = null;

function cleanKey(name){
  return name.trim().toLowerCase()
    .replace(/[.#$\[\]\/]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-\u00C0-\u024F\u4E00-\u9FFF]/g, "")
    .slice(0,50);
}
function judgeRef(key){ return ref(db, `${BRIDGE_PATH}/scores/innovation/${key}`); }
function showMessage(text, type="ok"){
  const box = el("innovationMessage");
  box.textContent = text;
  box.className = `msg judge-page-message ${type}`;
}
function friendlyError(error){
  return String(error?.code || "").includes("permission-denied")
    ? "Firebase permission denied. Confirm bridgeChallenge read/write rules are published."
    : (error?.message || "Unable to save.");
}
function unlock(){
  el("judgeLogin").classList.add("hidden");
  el("judgeApp").classList.remove("hidden");
  sessionStorage.setItem("innovationJudgeUnlocked","yes");
}
el("judgeLoginButton").onclick = () => {
  if(el("judgePassword").value === PASSWORD){ el("judgeLoginError").textContent=""; unlock(); }
  else { el("judgeLoginError").textContent="Incorrect password."; }
};
el("judgePassword").addEventListener("keydown", e => { if(e.key==="Enter") el("judgeLoginButton").click(); });
if(sessionStorage.getItem("innovationJudgeUnlocked")==="yes") unlock();

const savedName = localStorage.getItem("innovationJudgeName") || "";
el("judgeName").value = savedName;

function updateCompletion(){
  const count = values.filter(Number.isFinite).length;
  el("innovationCompletion").textContent = `${count} / ${TEAM_NAMES.length} teams scored`;
}
function buildCards(){
  values = Array(TEAM_NAMES.length).fill(null);
  const host = el("innovationCards");
  host.innerHTML = "";
  TEAM_NAMES.forEach((name,index) => {
    const card = document.createElement("section");
    card.className = "judge-score-card";
    card.innerHTML = `
      <div class="judge-team-heading">
        <div><span class="team-number">TEAM ${index+1}</span><h2>${name}</h2></div>
        <output id="in-output-${index}" class="score-output">— / 20</output>
      </div>
      <input id="in-range-${index}" class="score-range innovation-range" type="range" min="0" max="20" step="1" value="10">
      <div class="quick-scores">
        <button data-score="5">5</button><button data-score="10">10</button>
        <button data-score="12">12</button><button data-score="15">15</button><button data-score="20">20</button>
      </div>`;
    const range = card.querySelector("input");
    const output = card.querySelector("output");
    const setScore = score => {
      values[index] = Number(score);
      range.value = String(score);
      output.textContent = `${score} / 20`;
      card.classList.add("scored");
      updateCompletion();
    };
    range.addEventListener("input", () => setScore(range.value));
    card.querySelectorAll(".quick-scores button").forEach(btn => btn.onclick = () => setScore(btn.dataset.score));
    host.appendChild(card);
  });
}
buildCards();

async function loadExisting(name){
  const key = cleanKey(name);
  if(!key) return;
  try{
    const snap = await get(judgeRef(key));
    const data = snap.val();
    if(!data?.scores) return;
    TEAM_NAMES.forEach((_,i) => {
      const saved = Number(data.scores[`team${i+1}`]);
      if(Number.isFinite(saved)){
        values[i] = saved;
        el(`in-range-${i}`).value = String(saved);
        el(`in-output-${i}`).textContent = `${saved} / 20`;
        el(`in-range-${i}`).closest(".judge-score-card").classList.add("scored");
      }
    });
    updateCompletion();
    showMessage("Your previous submission has been loaded.", "ok");
  }catch(error){ console.error(error); }
  updateCompletion();
}

if(savedName) loadExisting(savedName);
el("judgeName").addEventListener("change", () => loadExisting(el("judgeName").value));

onValue(ref(db, ".info/connected"), snap => {
  const online = snap.val() === true;
  el("connectionBadge").textContent = online ? "Connected" : "Offline";
  el("connectionBadge").className = `connection ${online ? "online" : "offline"}`;
});

el("saveInnovationButton").onclick = async () => {
  const name = el("judgeName").value.trim();
  const key = cleanKey(name);
  if(!name || !key){ showMessage("Please enter your name.", "err"); el("judgeName").focus(); return; }
  if(values.some(v => !Number.isFinite(v))){
    showMessage("Please score all six teams before submitting.", "err");
    return;
  }
  const button = el("saveInnovationButton");
  const original = button.textContent;
  button.disabled = true; button.textContent = "Submitting…";
  try{
    const scores = {};
    values.forEach((v,i) => scores[`team${i+1}`] = v);
    await set(judgeRef(key), {
      judgeName:name,
      judgeKey:key,
      authUid:authUser?.uid || "",
      scores,
      submittedAt:serverTimestamp()
    });
    localStorage.setItem("innovationJudgeName", name);
    showMessage("Your innovation scores were submitted. Thank you.", "ok");
  }catch(error){
    console.error(error); showMessage(friendlyError(error), "err");
  }finally{
    button.disabled = false; button.textContent = original;
  }
};

onAuthStateChanged(auth, user => { authUser = user; });
signInAnonymously(auth).catch(error => showMessage(friendlyError(error), "err"));


onValue(ref(db, `${BRIDGE_PATH}/settings/teamCount`), snapshot => {
  TEAM_NAMES = makeTeamNames(snapshot.val() || DEFAULT_TEAM_COUNT);
  buildCards();
  if (el("judgeName").value.trim()) loadExisting(el("judgeName").value);
});

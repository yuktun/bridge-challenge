export const firebaseConfig = {
  apiKey: "AIzaSyDgdTBIqZx8Lx0kSDKkNuf-uysgjqRksMg",
  authDomain: "engagement-fastest-finger.firebaseapp.com",
  databaseURL: "https://engagement-fastest-finger-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "engagement-fastest-finger",
  storageBucket: "engagement-fastest-finger.firebasestorage.app",
  messagingSenderId: "325565400131",
  appId: "1:325565400131:web:31b2ce4e4a7d10946ac0f6",
  measurementId: "G-GCSX4X9BYR"
};

export const BRIDGE_PATH = "bridgeChallenge";


export const DEFAULT_TEAM_COUNT = 6;
export const MIN_TEAM_COUNT = 2;
export const MAX_TEAM_COUNT = 10;

export function makeTeamNames(count = DEFAULT_TEAM_COUNT) {
  const safeCount = Math.min(
    MAX_TEAM_COUNT,
    Math.max(MIN_TEAM_COUNT, Number(count) || DEFAULT_TEAM_COUNT)
  );
  return Array.from({ length: safeCount }, (_, index) => `Team ${index + 1}`);
}

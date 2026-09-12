// -----------------------------------------------------------------------
// Firebase configuration — OPTIONAL, only needed for cross-device sync.
//
// Without this filled in, the app still works fully; it just saves data
// to the local browser only (like before).
//
// To enable sync across devices/browsers:
//   1. Go to https://console.firebase.google.com and create a free project.
//   2. In the project, click "Build" -> "Firestore Database" -> "Create database"
//      (start in test mode for a personal project).
//   3. Click the gear icon -> "Project settings" -> scroll to "Your apps" ->
//      click the </> (web) icon -> register the app (no hosting needed).
//   4. Firebase will show you a firebaseConfig object. Copy its values below.
// -----------------------------------------------------------------------
const firebaseConfig = {
    apiKey: "PASTE_YOUR_API_KEY_HERE",
    authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
    projectId: "PASTE_YOUR_PROJECT_ID",
    storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
    messagingSenderId: "PASTE_YOUR_SENDER_ID",
    appId: "PASTE_YOUR_APP_ID"
};

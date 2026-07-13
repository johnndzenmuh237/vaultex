/* =========================================================
   FIREBASE-INIT.JS — shared Firebase app + auth instance
   Load this BEFORE auth.js or auth-guard.js on every page
   that needs to know who's logged in.
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyB4zLVvw6SVuFa7TxU4Ee7Ic7381K6Kz0s",
  authDomain: "swiftchain-827f2.firebaseapp.com",
  databaseURL: "https://swiftchain-827f2-default-rtdb.firebaseio.com",
  projectId: "swiftchain-827f2",
  storageBucket: "swiftchain-827f2.firebasestorage.app",
  messagingSenderId: "709059558659",
  appId: "1:709059558659:web:7c3eb1d6ddba07bb14bd36",
  measurementId: "G-5SSGXJL3DS"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
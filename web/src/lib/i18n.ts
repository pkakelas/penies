// All the site's text, in Greek (the default, served at /) and English (/en).

export type Lang = "el" | "en";

export const SITE_NAME = { el: "Πενιά", en: "Penia" } as const;

/** Path of a page in the given language: Greek has no prefix, English lives under /en. */
export function href(lang: Lang, path: string): string {
  if (lang === "el") return path;
  return path === "/" ? "/en" : `/en${path}`;
}

/** m:ss */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const el = {
  meta: {
    title: "Πενιά — backing tracks για μπουζούκι",
    description: "Backing tracks για μπουζούκι.",
  },
  nav: { songs: "Τραγούδια" },
  hero: {
    title: "Backing tracks για",
    titleEm: "μπουζούκι",
    soundOn: "Ήχος χορδών: ανοιχτός",
    soundOff: "Ήχος χορδών: κλειστός",
  },
  songs: {
    title: "Τραγούδια",
    empty: "Τα πρώτα τραγούδια ανεβαίνουν σύντομα.",
    open: "Άνοιγμα",
    unknownArtist: "Άγνωστος καλλιτέχνης",
  },
  song: {
    firstPerformed: "Πρώτη εκτέλεση",
    firstSinger: "Πρώτη ερμηνεία",
    singer: "Σε αυτή την εκτέλεση",
  },
  player: {
    back: "Όλα τα τραγούδια",
    play: "Αναπαραγωγή",
    pause: "Παύση",
    loading: "Φόρτωση ήχου",
    loadError: "Ο ήχος δεν φορτώθηκε. Δοκίμασε να ανανεώσεις τη σελίδα.",
    bouzouki: "Μπουζούκι",
    bouzoukiOn: "Ακούγεται το μπουζούκι της ηχογράφησης",
    bouzoukiOff: "Κλειστό — παίζεις εσύ",
    vocals: "Φωνή",
    vocalsOn: "Ακούγεται η φωνή",
    vocalsOff: "Χωρίς φωνή",
    noVocals: "Αυτό το τραγούδι δεν έχει ξεχωριστή φωνή",
    speed: "Ταχύτητα",
    reset: "Επαναφορά",
    position: "Θέση στο τραγούδι",
    original: "Το πρωτότυπο στο YouTube",
    spaceHint: "Πάτα το πλήκτρο διαστήματος για αναπαραγωγή και παύση.",
    draft: "Πρόχειρο — το βλέπουν μόνο οι διαχειριστές",
    notFound: "Το τραγούδι δεν βρέθηκε.",
    checking: "Αναζήτηση τραγουδιού…",
  },
  admin: {
    title: "Διαχείριση",
    username: "Όνομα χρήστη",
    password: "Κωδικός",
    signIn: "Είσοδος",
    signingIn: "Είσοδος…",
    signOut: "Αποσύνδεση",
    badLogin: "Λάθος όνομα χρήστη ή κωδικός.",
    notAdmin: "Αυτός ο λογαριασμός δεν έχει δικαιώματα διαχειριστή.",
    addTitle: "Νέο τραγούδι",
    addHelp:
      "Επικόλλησε έναν σύνδεσμο YouTube. Το τραγούδι χωρίζεται σε κανάλια και εμφανίζεται εδώ ως πρόχειρο για να το δοκιμάσεις πριν το δημοσιεύσεις.",
    urlPlaceholder: "https://www.youtube.com/watch?v=…",
    add: "Προσθήκη",
    adding: "Προσθήκη…",
    badUrl: "Αυτός δεν μοιάζει με σύνδεσμο βίντεο του YouTube.",
    duplicate: "Αυτό το βίντεο υπάρχει ήδη στη λίστα.",
    failedGeneric: "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
    processing: "Σε επεξεργασία",
    drafts: "Πρόχειρα",
    published: "Δημοσιευμένα",
    none: "Κανένα",
    queued: "Στην ουρά",
    queuedHelp: "Περιμένει τον worker. Αν δεν προχωρά, τρέξε στον υπολογιστή: uv run worker.py",
    steps: {
      download: "Λήψη από το YouTube",
      split: "Διαχωρισμός καναλιών",
      upload: "Ανέβασμα καναλιών",
    } as Record<string, string>,
    failed: "Απέτυχε",
    retry: "Νέα προσπάθεια",
    songTitle: "Τίτλος",
    save: "Αποθήκευση",
    saved: "Αποθηκεύτηκε",
    test: "Δοκιμή",
    view: "Προβολή",
    publish: "Δημοσίευση",
    unpublish: "Απόσυρση",
    remove: "Διαγραφή",
    confirmRemove: "Να διαγραφεί οριστικά το τραγούδι και τα αρχεία του;",
    untitled: "Χωρίς τίτλο",
  },
};

export type Dict = typeof el;

const en: Dict = {
  meta: {
    title: "Penia — backing tracks for bouzouki",
    description: "Backing tracks for bouzouki.",
  },
  nav: { songs: "Songs" },
  hero: {
    title: "Backing tracks for",
    titleEm: "bouzouki",
    soundOn: "String sound: on",
    soundOff: "String sound: off",
  },
  songs: {
    title: "Songs",
    empty: "The first songs are on their way.",
    open: "Open",
    unknownArtist: "Unknown artist",
  },
  song: {
    firstPerformed: "First performed",
    firstSinger: "First sung by",
    singer: "In this recording",
  },
  player: {
    back: "All songs",
    play: "Play",
    pause: "Pause",
    loading: "Loading audio",
    loadError: "The audio did not load. Try reloading the page.",
    bouzouki: "Bouzouki",
    bouzoukiOn: "The recording's bouzouki is playing",
    bouzoukiOff: "Off — you play it",
    vocals: "Vocals",
    vocalsOn: "The singer is on",
    vocalsOff: "No vocals",
    noVocals: "This song has no separate vocals",
    speed: "Speed",
    reset: "Reset",
    position: "Position in the song",
    original: "The original on YouTube",
    spaceHint: "Press the space bar to play and pause.",
    draft: "Draft — only admins can see it",
    notFound: "Song not found.",
    checking: "Looking for the song…",
  },
  admin: {
    title: "Admin",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
    badLogin: "Wrong username or password.",
    notAdmin: "This account does not have admin rights.",
    addTitle: "New song",
    addHelp:
      "Paste a YouTube link. The song is split into parts and shows up here as a draft, so you can test it before publishing.",
    urlPlaceholder: "https://www.youtube.com/watch?v=…",
    add: "Add",
    adding: "Adding…",
    badUrl: "That does not look like a YouTube video link.",
    duplicate: "That video is already in the list.",
    failedGeneric: "Something went wrong. Try again.",
    processing: "Processing",
    drafts: "Drafts",
    published: "Published",
    none: "None",
    queued: "Queued",
    queuedHelp: "Waiting for the worker. If it does not move, run on the computer: uv run worker.py",
    steps: {
      download: "Downloading from YouTube",
      split: "Separating the parts",
      upload: "Uploading the parts",
    },
    failed: "Failed",
    retry: "Try again",
    songTitle: "Title",
    save: "Save",
    saved: "Saved",
    test: "Test",
    view: "View",
    publish: "Publish",
    unpublish: "Unpublish",
    remove: "Delete",
    confirmRemove: "Delete this song and its files for good?",
    untitled: "Untitled",
  },
};

export const dictionaries: Record<Lang, Dict> = { el, en };

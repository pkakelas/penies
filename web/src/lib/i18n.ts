// All the site's text, in Greek (the default, served at /) and English (/en).

export type Lang = "el" | "en";

export const SITE_NAME = { el: "Πενιές", en: "Penies" } as const;

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

/** m:ss, keeping tenths of a second when there are any (for the admin's trim fields). */
export function formatTimeExact(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const whole = formatTime(tenths / 10);
  return tenths % 10 ? `${whole}.${tenths % 10}` : whole;
}

/**
 * Seconds from text typed as "m:ss", "m:ss.s" or plain seconds.
 * Blank gives null; anything else that is not a time gives NaN.
 */
export function parseTime(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(trimmed);
  if (!match) return NaN;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2].replace(",", "."));
  if (match[1] && seconds >= 60) return NaN;
  return minutes * 60 + seconds;
}

const el = {
  meta: {
    title: "Πενιές — backing tracks για μπουζούκι και φωνή",
    description: "Backing tracks για μπουζούκι και φωνή.",
  },
  nav: { songs: "Τραγούδια" },
  // In the footer; a heart is drawn after it.
  credit: "Φτιαγμένο με",
  contact: "Γράψε μου στο",
  hero: {
    title: "Backing tracks για",
    titleEm: "μπουζούκι και φωνή",
  },
  songs: {
    title: "Τραγούδια",
    empty: "Τα πρώτα τραγούδια ανεβαίνουν σύντομα.",
    open: "Άνοιγμα",
    search: "Αναζήτηση",
    searchPlaceholder: "Τίτλος, συνθέτης, τραγουδιστής",
    noMatch: "Δεν βρέθηκε τραγούδι.",
    all: "Όλα",
    byComposer: "Μουσική",
    bySinger: "Ερμηνεία",
  },
  request: {
    button: "Ζήτα τραγούδια",
    title: "Η παραγγελιά σου",
    offer: "Έχεις παραγγελιά;",
    blank: "Η παραγγελιά σου",
    terms: "Από 2\u00a0€ το τραγούδι",
    // Signing in: the email, then the code that was mailed to it.
    signInNote: "Γράψε το email σου και θα σου στείλουμε έναν κωδικό.",
    email: "Email",
    sendCode: "Συνέχεια",
    sendingCode: "Αποστολή…",
    codeSent: "Σου στείλαμε έναν κωδικό στο email σου.",
    code: "Κωδικός",
    signIn: "Σύνδεση",
    checkingCode: "Έλεγχος…",
    badCode: "Ο κωδικός δεν είναι σωστός ή έληξε.",
    back: "Πίσω",
    signOut: "Αποσύνδεση",
    // Signed in. The songs still to ask for; {n} is the number.
    leftOne: "Σου μένει ένα τραγούδι",
    leftMany: "Σου μένουν {n} τραγούδια",
    promise: "Γράψε ένα τραγούδι και θα το έχουμε εδώ μέσα σε 24 ώρες. Θα σου στείλουμε email μόλις ανέβει.",
    note: "Ψάχνουμε την πρώτη εκτέλεση. Αν δεν τη βρούμε σε καλή remastered έκδοση, παίρνουμε μια νεότερη, για να χωριστούν καθαρά τα όργανα.",
    song: "Τραγούδι",
    examples: ["Αχάριστη, Τσιτσάνης", "Ευδοκία, Λοΐζος", "Ο πασατέμπος, Χιώτης"],
    name: "Όνομα",
    ask: "Αποστολή",
    asking: "Αποστολή…",
    // After a song was sent. `more` goes back to the next song while there are some left, `buyMore` to the packs.
    thanks: "Ευχαριστούμε!",
    thanksNote: "Το τραγούδι σου θα είναι εδώ μέσα σε 24 ώρες. Θα σου στείλουμε email μόλις ανέβει.",
    more: "Ζήτα κι άλλο τραγούδι",
    buyMore: "Αγόρασε κι άλλα τραγούδια",
    // The link to the orders page, with how many songs they are waiting for; {n} is the number.
    askedOne: "Έχεις ζητήσει 1 τραγούδι",
    askedMany: "Έχεις ζητήσει {n} τραγούδια",
    // The packs to choose from before paying. `songs` is which one it is (SongRequest.tsx has a
    // payment link for each); the prices are also in Stripe and in the database's song_pack(cents).
    packsLabel: "Πόσα τραγούδια",
    packs: [
      { songs: 1, label: "1 τραγούδι", price: "3\u00a0€", each: "" },
      { songs: 3, label: "3 τραγούδια", price: "6\u00a0€", each: "2\u00a0€ το ένα" },
      { songs: 5, label: "5 τραγούδια", price: "10\u00a0€", each: "2\u00a0€ το ένα" },
    ],
    // Under the packs: a few words, then a line under them.
    perks: [
      ["Όποτε θέλεις", "Τα ζητάς ένα ένα ή όλα μαζί. Δεν λήγουν."],
      ["Έτοιμο σε 24 ώρες", "Θα σου στείλουμε email μόλις ανέβει."],
      ["Η πρώτη εκτέλεση, όπου γίνεται", "Αν δεν τη βρούμε σε καλή remastered έκδοση, παίρνουμε μια νεότερη, για να χωριστούν καθαρά τα όργανα."],
    ],
    // {price} is the chosen pack's.
    pay: "Πληρωμή {price}",
    paying: "Προς την πληρωμή…",
    paid: "Η πληρωμή έγινε.",
    paidSoon: "Τα τραγούδια σου θα φανούν εδώ σε λίγο.",
    failed: "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
    close: "Κλείσιμο",
  },
  // The page with the songs a signed-in visitor asked for and is waiting for.
  orders: {
    title: "Οι παραγγελίες σου",
    signedOut: "Σύνδεσου για να δεις τις παραγγελίες σου.",
    empty: "Δεν περιμένεις κανένα τραγούδι.",
  },
  song: {
    firstPerformed: "Πρώτη εκτέλεση",
    firstSinger: "Πρώτη ερμηνεία",
    firstPlayer: "Πρώτη ερμηνεία",
    singer: "Σε αυτή την εκτέλεση",
    instrumental: "Ορχηστρικό",
    composer: "Μουσική",
    requestedBy: "Ζητήθηκε από",
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
    instrumental: "Ορχηστρικό — δεν έχει φωνή",
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
    instrumental: "Ορχηστρικό, χωρίς φωνή",
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
    startsAt: "Αρχή",
    endsAt: "Τέλος",
    trimHelp: "Σε λεπτά:δευτερόλεπτα από την αρχή της ηχογράφησης. Κενό: ολόκληρη.",
    badTime: "Γράψε χρόνο όπως 1:23. Η αρχή πρέπει να είναι πριν από το τέλος και μέσα στο τραγούδι.",
    plays: "Παίζει",
    moveUp: "Πιο πάνω στη λίστα",
    moveDown: "Πιο κάτω στη λίστα",
    orderHelp: "Με αυτή τη σειρά εμφανίζονται στην αρχική σελίδα.",
    save: "Αποθήκευση",
    saved: "Αποθηκεύτηκε",
    test: "Δοκιμή",
    view: "Προβολή",
    publish: "Δημοσίευση",
    unpublish: "Απόσυρση",
    archive: "Αρχειοθέτηση",
    restore: "Επαναφορά στα πρόχειρα",
    archived: "Αρχείο",
    remove: "Διαγραφή",
    confirmRemove: "Να διαγραφεί οριστικά το τραγούδι και τα αρχεία του;",
    untitled: "Χωρίς τίτλο",
    requests: "Αιτήματα",
    requestDone: "Έγινε",
    requestPaid: "Πληρώθηκε",
    confirmRequestDone: "Να διαγραφεί το αίτημα;",
  },
};

export type Dict = typeof el;

const en: Dict = {
  meta: {
    title: "Penies — backing tracks for bouzouki and voice",
    description: "Backing tracks for bouzouki and voice.",
  },
  nav: { songs: "Songs" },
  credit: "Made with",
  contact: "Reach out at",
  hero: {
    title: "Backing tracks for",
    titleEm: "bouzouki and voice",
  },
  songs: {
    title: "Songs",
    empty: "The first songs are on their way.",
    open: "Open",
    search: "Search",
    searchPlaceholder: "Title, composer, singer",
    noMatch: "No song found.",
    all: "All",
    byComposer: "Music",
    bySinger: "Voice",
  },
  request: {
    button: "Request songs",
    title: "Your request",
    offer: "Got a request?",
    blank: "Your request",
    terms: "From €2 a song",
    signInNote: "Enter your email and we'll send you a code.",
    email: "Email",
    sendCode: "Continue",
    sendingCode: "Sending…",
    codeSent: "We sent a code to your email.",
    code: "Code",
    signIn: "Sign in",
    checkingCode: "Checking…",
    badCode: "That code is wrong or has expired.",
    back: "Back",
    signOut: "Sign out",
    leftOne: "One song left",
    leftMany: "{n} songs left",
    promise: "Add a song and we'll have it here within 24 hours. We'll email you when it's up.",
    note: "We look for the original recording. If there's no good remastered version of it, we use a newer one, so the instruments separate cleanly.",
    song: "Song",
    examples: ["Acharisti, Tsitsanis", "Evdokia, Loizos", "O pasatempos, Chiotis"],
    name: "Name",
    ask: "Send",
    asking: "Sending…",
    thanks: "Thank you!",
    thanksNote: "Your song will be here within 24 hours. We'll email you when it's up.",
    more: "Ask for another song",
    buyMore: "Buy more songs",
    askedOne: "You've asked for 1 song",
    askedMany: "You've asked for {n} songs",
    packsLabel: "How many songs",
    packs: [
      { songs: 1, label: "1 song", price: "€3", each: "" },
      { songs: 3, label: "3 songs", price: "€6", each: "€2 each" },
      { songs: 5, label: "5 songs", price: "€10", each: "€2 each" },
    ],
    perks: [
      ["Whenever you like", "Ask for them one at a time or all together. They don't expire."],
      ["Ready within 24 hours", "We'll email you when it's up."],
      ["The original recording, where we can", "If there's no good remastered version of it, we use a newer one, so the instruments separate cleanly."],
    ],
    pay: "Pay {price}",
    paying: "Taking you to payment…",
    paid: "Payment received.",
    paidSoon: "Your songs will show up here in a moment.",
    failed: "Something went wrong. Try again.",
    close: "Close",
  },
  orders: {
    title: "Your requests",
    signedOut: "Sign in to see your requests.",
    empty: "You're not waiting for any songs.",
  },
  song: {
    firstPerformed: "First performed",
    firstSinger: "First sung by",
    firstPlayer: "First played by",
    singer: "In this recording",
    instrumental: "Instrumental",
    composer: "Music",
    requestedBy: "Requested by",
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
    instrumental: "Instrumental — no vocals",
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
    instrumental: "Instrumental, no vocals",
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
    startsAt: "Starts at",
    endsAt: "Ends at",
    trimHelp: "In minutes:seconds from the start of the recording. Blank: the whole recording.",
    badTime: "Write a time like 1:23. The start must come before the end and lie within the song.",
    plays: "Plays",
    moveUp: "Move up the list",
    moveDown: "Move down the list",
    orderHelp: "This is the order on the landing page.",
    save: "Save",
    saved: "Saved",
    test: "Test",
    view: "View",
    publish: "Publish",
    unpublish: "Unpublish",
    archive: "Archive",
    restore: "Back to drafts",
    archived: "Archive",
    remove: "Delete",
    confirmRemove: "Delete this song and its files for good?",
    untitled: "Untitled",
    requests: "Requests",
    requestDone: "Done",
    requestPaid: "Paid",
    confirmRequestDone: "Delete this request?",
  },
};

export const dictionaries: Record<Lang, Dict> = { el, en };

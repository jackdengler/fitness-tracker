(() => {
  const root = document.getElementById("fitness-tracker-v13");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  const stage = root.querySelector("#stage");
  const STORAGE_KEY = "fitnessTrackerV13";

  // --- Remote sync (private-data-storage via the GitHub Contents API) ---
  // The launcher hands this app a PAT over postMessage (type "co.pat") once
  // the iframe loads. That PAT needs Contents: Read & write on
  // jackdengler/private-data-storage for sync to work; without it (or
  // offline) the app still runs entirely off localStorage.
  const GH_REPO = "jackdengler/private-data-storage";
  const GH_PATH = "fitness.json";
  const GH_API = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
  const REMOTE_SYNC_DELAY_MS = 2500;
  let githubToken = null;
  let remoteSha = null;
  let remoteSyncTimer = null;

  function b64EncodeUnicode(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      ),
    );
  }
  function b64DecodeUnicode(str) {
    return decodeURIComponent(
      atob(str.replace(/\n/g, ""))
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  }
  function ghHeaders(extra) {
    return Object.assign(
      {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      extra,
    );
  }
  function setSyncState(s) {
    const el = root.querySelector("#syncStatus");
    if (!el) return;
    const label = {
      syncing: "Syncing to private data storage…",
      synced: "Synced to private data storage",
      offline: "Offline — changes saved on this device only",
      error: "Sync failed — will retry on next change",
    }[s];
    el.textContent = label || "";
  }
  async function ghGet() {
    const res = await fetch(GH_API, { headers: ghHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("GET " + res.status);
    const json = await res.json();
    remoteSha = json.sha;
    return JSON.parse(b64DecodeUnicode(json.content));
  }
  async function ghPut(dbObj, isRetry) {
    const body = {
      message: "Update fitness data",
      content: b64EncodeUnicode(JSON.stringify(dbObj, null, 2)),
    };
    if (remoteSha) body.sha = remoteSha;
    const res = await fetch(GH_API, {
      method: "PUT",
      headers: ghHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 409 && !isRetry) {
      const fresh = await fetch(GH_API, { headers: ghHeaders() });
      if (fresh.ok) remoteSha = (await fresh.json()).sha;
      return ghPut(dbObj, true);
    }
    if (!res.ok) throw new Error("PUT " + res.status);
    remoteSha = (await res.json()).content.sha;
  }
  function persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {}
  }
  function scheduleRemoteSync() {
    if (!githubToken) return;
    if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
    remoteSyncTimer = setTimeout(flushRemoteSync, REMOTE_SYNC_DELAY_MS);
  }
  function flushRemoteSync() {
    if (remoteSyncTimer) {
      clearTimeout(remoteSyncTimer);
      remoteSyncTimer = null;
    }
    if (!githubToken) return;
    setSyncState("syncing");
    ghPut(db)
      .then(() => setSyncState("synced"))
      .catch(() => setSyncState("error"));
  }
  async function initRemote(token) {
    githubToken = token;
    setSyncState("syncing");
    try {
      const remote = await ghGet();
      if (remote) {
        db = Object.assign(
          {
            foodLogs: [],
            weightLogs: [],
            waistLogs: [],
            workoutLogs: [],
            liftHistory: {},
            activeWorkout: null,
          },
          remote,
        );
        persistLocal();
        if (phase === "home") showHome();
      } else {
        await ghPut(db);
      }
      setSyncState("synced");
    } catch (e) {
      setSyncState("offline");
    }
  }
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "co.pat" || !d.pat) return;
    initRemote(d.pat);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && remoteSyncTimer)
      flushRemoteSync();
  });
  // --- end remote sync ---

  const targets = { calories: 2000, protein: 180 };
  const ingredients = {
    turkey: {
      name: "Boar’s Head No Salt Added Turkey",
      serving: "4 oz",
      calories: 140,
      protein: 28,
      carbs: 0,
      fat: 2,
      sodium: 110,
      fiber: 0,
      other: "~380mg potassium · 80mg cholesterol",
    },
    bacon: {
      name: "Oscar Mayer bacon",
      serving: "1 strip",
      calories: 30,
      protein: 2.5,
      carbs: 0.5,
      carbsDisplay: "<0.5",
      fat: 2,
      sodium: 140,
      fiber: 0,
      other: "~0.75g saturated fat",
    },
    provolone: {
      name: "Sargento provolone",
      serving: "1 slice",
      calories: 70,
      protein: 5,
      carbs: 0,
      fat: 5,
      sodium: 130,
      fiber: 0,
      other: "140mg calcium · 3g saturated fat",
    },
    mayo: {
      name: "Best Foods Light Mayo",
      serving: "1 tbsp",
      calories: 35,
      protein: 0,
      carbs: 1,
      fat: 3.5,
      sodium: 110,
      fiber: 0,
      other: "~0.5g saturated fat",
    },
    dijon: {
      name: "Dijon mustard",
      serving: "1 tsp",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 115,
      fiber: 0,
      other: "Negligible calories",
    },
    pepper: {
      name: "Fresh banana pepper",
      serving: "~¼ pepper",
      calories: 5,
      protein: 0.3,
      carbs: 1,
      fat: 0,
      sodium: 1,
      fiber: 0.4,
      other: "Good vitamin C source",
      approx: true,
    },
    lettuce: {
      name: "Iceberg lettuce",
      serving: "3–4 leaves",
      calories: 15,
      protein: 1,
      carbs: 3,
      fat: 0,
      sodium: 10,
      fiber: 1,
      other: "Folate · vitamin K · water/volume",
      approx: true,
    },
    tomato: {
      name: "Tomato",
      serving: "2–3 slices",
      calories: 10,
      protein: 0.5,
      carbs: 2,
      fat: 0,
      sodium: 3,
      fiber: 0.7,
      other: "~140mg potassium · vitamin C · lycopene",
      approx: true,
    },
    onion: {
      name: "Red onion",
      serving: "small amount",
      calories: 5,
      protein: 0.2,
      carbs: 1.5,
      fat: 0,
      sodium: 1,
      fiber: 0.2,
      other: "Sodium and fiber estimated from USDA raw-onion values (not label-supplied)",
      approx: true,
    },
  };
  const meals = [
    {
      id: "turkey-club-wrap",
      name: "Turkey Club Wrap",
      serving: "1 wrap (lettuce wrap, no tortilla)",
      calories: 310,
      protein: 37.5,
      carbs: 9,
      fat: 12.5,
      sodium: 620,
      fiber: 2.3,
      approx: true,
      note: "Lettuce wrap — there's no tortilla, lettuce leaves are the wrap. Total is the exact sum of the 9 listed ingredients; onion's sodium/fiber are estimated (see note on that ingredient).",
      ingredientIds: [
        "turkey",
        "bacon",
        "provolone",
        "mayo",
        "dijon",
        "pepper",
        "lettuce",
        "tomato",
        "onion",
      ],
    },
    {
      id: "korean-beef-bowl",
      name: "Korean Beef Bowl",
      serving: "1 full batch as made",
      calories: 860,
      protein: 65,
      carbs: 76,
      fat: 32,
      sodium: 1335,
      fiber: 6.5,
      approx: true,
      note: "Estimated from half of the Damn Delicious Korean beef sauce/base recipe + 0.5 lb 93/7 ground beef + 1/4 cup dry jasmine rice + 115 calories of edamame.",
      ingredientText: [
        "0.5 lb 93/7 ground beef",
        "1/4 cup dry jasmine rice",
        "115 calories edamame",
        "Half of Korean beef sauce/base recipe",
      ],
    },
  ];
  const snacks = [
    {
      id: "fatboyicecreamsandwich",
      name: "Fat Boy Vanilla Ice Cream Sandwich",
      serving: "1 sandwich",
      calories: 160,
      protein: 3,
      carbs: 28,
      fat: 5,
      sodium: 105,
      fiber: 1,
      approx: true,
      note: "~15g sugar. Typical packaging values — check the box for your exact SKU.",
    },
    {
      id: "outshinestrawberrypopsicle",
      name: "Outshine Strawberry Fruit Bar",
      serving: "1 bar",
      calories: 60,
      protein: 1,
      carbs: 15,
      fat: 0,
      sodium: 5,
      fiber: 1,
      approx: true,
      note: "~13g sugar · 25% DV vitamin C",
    },
  ];
  const drinks = [
    {
      id: "flatwhite",
      name: "Flat White",
      serving: "Grande (16 fl oz), 2% milk",
      calories: 170,
      protein: 9,
      carbs: 13,
      fat: 9,
      sodium: 105,
      fiber: 0,
      approx: true,
      note: "Starbucks-style estimate — varies with milk type, size, and shots.",
    },
    {
      id: "americano",
      name: "Americano",
      serving: "Grande (16 fl oz), black",
      calories: 15,
      protein: 1,
      carbs: 3,
      fat: 0,
      sodium: 10,
      fiber: 0,
      approx: true,
      note: "Black coffee estimate — add milk/sugar separately if used. Varies with size and shots.",
    },
  ];
  const templates = {
    A: {
      name: "Workout A",
      ex: [
        ["legpress", "Leg press", 12, 120, "lower"],
        ["chestpress", "Machine chest press", 12, 120, "upper"],
        ["row", "Seated row", 12, 120, "upper"],
        ["legcurl", "Seated leg curl", 15, 90, "lower2"],
        ["biceps", "Biceps curl machine", 15, 75, "small"],
        ["triceps", "Triceps pressdown", 15, 75, "small"],
        ["abs", "Ab crunch machine", 15, 75, "small"],
      ],
    },
    B: {
      name: "Workout B",
      ex: [
        ["hacksquat", "Hack squat", 12, 120, "lower"],
        ["pulldown", "Lat pulldown", 12, 120, "upper"],
        ["shoulderpress", "Shoulder press", 12, 120, "upper"],
        ["pecdeck", "Pec deck", 15, 90, "small"],
        ["lateral", "Lateral raise", 15, 75, "small"],
        ["cablecurl", "Cable biceps curl", 15, 75, "small"],
        ["kneeraise", "Knee raise", 15, 75, "body"],
      ],
    },
    C: {
      name: "Workout C",
      ex: [
        ["legpress", "Leg press", 12, 120, "lower"],
        ["inclinepress", "Incline chest press", 12, 120, "upper"],
        ["supportedrow", "Chest-supported row", 12, 120, "upper"],
        ["legextension", "Leg extension", 15, 90, "lower2"],
        ["reversepec", "Reverse pec deck", 15, 75, "small"],
        ["preachercurl", "Preacher curl", 15, 75, "small"],
        ["overheadtri", "Overhead triceps extension", 15, 75, "small"],
        ["abs", "Ab crunch machine", 15, 75, "small"],
      ],
    },
  };
  function loadDB() {
    try {
      const x = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (x)
        return Object.assign(
          {
            foodLogs: [],
            weightLogs: [],
            waistLogs: [],
            workoutLogs: [],
            liftHistory: {},
            activeWorkout: null,
          },
          x,
        );
    } catch (e) {}
    return {
      foodLogs: [],
      weightLogs: [],
      waistLogs: [],
      workoutLogs: [],
      liftHistory: {},
      activeWorkout: null,
    };
  }
  let db = loadDB();
  let editingFoodId = null;
  function saveDB() {
    persistLocal();
    scheduleRemoteSync();
  }
  let phase = "home",
    workout = null,
    order = [],
    exerciseIndex = 0,
    weight = null,
    reps = null,
    pendingWeight = null,
    timer = null,
    bgTimer = null,
    deadline = null,
    paused = false,
    pauseStarted = null,
    restDone = false,
    session = [],
    lastLogged = null,
    startedAt = null,
    audioContext = null,
    locked = false;
  function dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function r1(v) {
    return Math.round((v || 0) * 10) / 10;
  }
  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  function stopBgTimer() {
    if (bgTimer) {
      clearInterval(bgTimer);
      bgTimer = null;
    }
  }
  function clone(k) {
    return templates[k].ex.map((x) => ({
      id: x[0],
      name: x[1],
      target: x[2],
      rest: x[3],
      type: x[4],
    }));
  }
  function cur() {
    return order[exerciseIndex] || null;
  }
  function sets(id) {
    return session.filter((x) => x.id === id);
  }
  function complete(id) {
    return sets(id).length >= 2;
  }
  function active() {
    return workout && ["set", "rest", "swap"].includes(phase);
  }
  function audio() {
    try {
      if (!audioContext) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioContext = new AC();
      }
      if (audioContext && audioContext.state === "suspended")
        audioContext.resume();
    } catch (e) {}
  }
  function beep() {
    try {
      audio();
      if (!audioContext) return;
      const n = audioContext.currentTime;
      [0, 0.18, 0.36].forEach((d, i) => {
        const o = audioContext.createOscillator(),
          g = audioContext.createGain();
        o.frequency.value = i === 2 ? 1100 : 880;
        g.gain.setValueAtTime(0.0001, n + d);
        g.gain.exponentialRampToValueAtTime(0.07, n + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, n + d + 0.13);
        o.connect(g);
        g.connect(audioContext.destination);
        o.start(n + d);
        o.stop(n + d + 0.14);
      });
    } catch (e) {}
  }
  function saveActive() {
    if (!active()) return;
    db.activeWorkout = {
      workout,
      order: order.map((x) => ({ ...x })),
      exerciseIndex,
      session: session.map((x) => ({ ...x })),
      startedAt,
      deadline,
      paused,
      pauseStarted,
      restDone,
      lastLogged: lastLogged ? { ...lastLogged } : null,
      selectedWeight: phase === "set" ? weight : pendingWeight,
      expired: false,
      phase,
    };
    saveDB();
  }
  function armBackgroundTimer() {
    stopBgTimer();
    const a = db.activeWorkout;
    if (!a || a.phase !== "rest" || a.paused || a.expired || a.deadline === null)
      return;
    bgTimer = setInterval(() => {
      const x = db.activeWorkout;
      if (!x || x.phase !== "rest" || x.paused || x.expired || x.deadline === null) {
        stopBgTimer();
        return;
      }
      if (Date.now() >= x.deadline) {
        stopBgTimer();
        beep();
        x.expired = true;
        x.deadline = null;
        db.activeWorkout = x;
        saveDB();
      }
    }, 500);
  }
  function clearActive() {
    db.activeWorkout = null;
    saveDB();
  }
  let undoTimer = null;
  function clearUndoToast() {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    root.querySelector("#undoToast")?.remove();
  }
  function showUndoToast(message, restore) {
    clearUndoToast();
    const el = document.createElement("div");
    el.id = "undoToast";
    el.className = "undoToast";
    el.innerHTML = `<span>${esc(message)}</span><button type="button" data-undo>Undo</button>`;
    el.querySelector("[data-undo]").addEventListener("click", () => {
      clearUndoToast();
      restore();
    });
    root.appendChild(el);
    undoTimer = setTimeout(clearUndoToast, 5000);
  }
  function showHome() {
    stopTimer();
    if (active()) saveActive();
    phase = "home";
    const t = foodTotals(dayKey()),
      lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lwa = db.waistLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    let resume = "";
    const a = db.activeWorkout;
    if (a && a.workout) {
      const e = a.order[a.exerciseIndex];
      if (e)
        resume = `<button id="resume" class="resume" type="button"><div>Resume ${templates[a.workout].name}<br><small>${esc(e.name)} · ${a.phase === "rest" ? "Resting" : "Set " + Math.min(a.session.filter((x) => x.id === e.id).length + 1, 2)}</small></div><div>→</div></button>`;
    }
    stage.innerHTML = `<section class="home"><div id="syncStatus" class="syncLine"></div>${resume}<div class="label">Workout</div><div class="days"><button class="day" data-start="A">A<span>Monday</span></button><button class="day" data-start="B">B<span>Wednesday</span></button><button class="day" data-start="C">C<span>Friday</span></button></div><div class="label">Tracking</div><div class="sections"><button id="food" class="sectionTile" type="button"><strong>Food</strong><span>${Math.round(t.calories)} / ${targets.calories} kcal · ${r1(t.protein)} / ${targets.protein}g protein</span></button><button id="body" class="sectionTile" type="button"><strong>Body</strong><span>${lw ? Number(lw.weight).toFixed(1) + " lb" : "No weight"} · ${lwa ? Number(lwa.waist).toFixed(1) + " in" : "No waist"}</span></button></div><button id="history" class="historyOpen" type="button">Workout history · ${db.workoutLogs.length}</button><div id="publishTime" class="syncLine" style="border-bottom:0;border-top:1px solid light-dark(#cfd1cc,#343733)">published —</div></section>`;
    stage.querySelector("#resume")?.addEventListener("click", restore);
    stage.querySelector("#food").addEventListener("click", () => showFood("meals"));
    stage.querySelector("#body").addEventListener("click", showBody);
    stage.querySelector("#history").addEventListener("click", showHistory);
    setPublishStamp();
    armBackgroundTimer();
  }
  async function setPublishStamp() {
    let when = null;
    try {
      const res = await fetch("./build.json", { cache: "no-cache" });
      if (res.ok) {
        const info = await res.json();
        const d = info?.builtAt ? new Date(info.builtAt) : null;
        if (d && !Number.isNaN(d.valueOf())) when = d;
      }
    } catch (e) {}
    const el = root.querySelector("#publishTime");
    if (!el || !when) return;
    const ptFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const ptDateFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
    });
    el.textContent = `published ${ptDateFmt.format(when)} · ${ptFmt.format(when)} PT`;
  }
  function restore() {
    const a = db.activeWorkout;
    if (!a) return;
    stopTimer();
    stopBgTimer();
    workout = a.workout;
    order = a.order.map((x) => ({ ...x }));
    exerciseIndex = a.exerciseIndex;
    session = a.session.map((x) => ({ ...x }));
    startedAt = a.startedAt;
    deadline = a.deadline;
    paused = a.paused;
    pauseStarted = a.pauseStarted;
    restDone = a.restDone;
    lastLogged = a.lastLogged ? { ...a.lastLogged } : null;
    pendingWeight = a.selectedWeight ?? null;
    if (a.phase === "rest") {
      phase = "rest";
      if (a.expired || (!paused && deadline !== null && deadline <= Date.now())) {
        beep();
        advance();
      } else if (deadline !== null) renderRest();
      else advance();
    } else {
      phase = "set";
      showSet();
    }
  }
  function start(k) {
    audio();
    stopTimer();
    stopBgTimer();
    workout = k;
    order = clone(k);
    exerciseIndex = 0;
    session = [];
    startedAt = Date.now();
    deadline = null;
    paused = false;
    pauseStarted = null;
    restDone = false;
    lastLogged = null;
    pendingWeight = null;
    locked = false;
    phase = "set";
    saveActive();
    showSet();
  }
  function defaultWeight(e) {
    if (e.type === "body") return 0;
    if (db.liftHistory[e.id] && Number.isFinite(db.liftHistory[e.id].weight))
      return db.liftHistory[e.id].weight;
    if (e.type === "lower") return 140;
    if (e.type === "lower2") return 60;
    if (e.type === "upper") return 50;
    return 30;
  }
  function weightVals(e) {
    if (e.type === "body") return [0];
    const c = defaultWeight(e),
      a = [];
    for (let w = Math.max(10, c - 100); w <= c + 150; w += 10) a.push(w);
    if (!a.includes(c)) a.push(c);
    return [...new Set(a)].sort((x, y) => x - y);
  }
  function showSet() {
    stopTimer();
    deadline = null;
    paused = false;
    pauseStarted = null;
    phase = "set";
    locked = false;
    while (exerciseIndex < order.length && complete(order[exerciseIndex].id))
      exerciseIndex++;
    if (exerciseIndex >= order.length) return finish();
    const e = cur(),
      w = pendingWeight !== null ? pendingWeight : defaultWeight(e);
    weight = w;
    pendingWeight = null;
    reps = e.target;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="exerciseHead"><div class="exerciseTitle"><div class="exerciseName">${esc(e.name)}</div><div class="exerciseMeta">${exerciseIndex + 1}/${order.length} · SET ${sets(e.id).length + 1}/2</div></div><button id="swap" class="btn" type="button">Swap</button></div><div class="picker"><div class="half"><div class="label">Weight · swipe ↔</div><div id="weights" class="rail">${weightVals(e).map((v) => `<button class="choice ${v === w ? "selected" : ""}" data-w="${v}" type="button">${v === 0 ? "BW" : v}</button>`).join("")}</div></div><div class="half"><div class="label">Reps · tap to log · target ${e.target}</div><div id="reps" class="rail">${Array.from({ length: 25 }, (_, i) => i + 1).map((v) => `<button class="choice ${v === e.target ? "target selected" : ""}" data-r="${v}" type="button">${v}</button>`).join("")}</div></div></div></section>`;
    stage.querySelectorAll("[data-w]").forEach((b) =>
      b.addEventListener("click", () => {
        if (phase !== "set") return;
        weight = Number(b.dataset.w);
        stage.querySelectorAll("[data-w]").forEach((x) => x.classList.toggle("selected", x === b));
        saveActive();
      }),
    );
    stage.querySelectorAll("[data-r]").forEach((b) =>
      b.addEventListener("click", () => {
        if (locked || phase !== "set") return;
        reps = Number(b.dataset.r);
        logSet();
      }),
    );
    stage.querySelector("#swap").addEventListener("click", showSwap);
    requestAnimationFrame(() => {
      stage.querySelector("#weights .selected")?.scrollIntoView({ inline: "center", block: "nearest" });
      stage.querySelector("#reps .selected")?.scrollIntoView({ inline: "center", block: "nearest" });
    });
    saveActive();
  }
  function logSet() {
    if (locked || phase !== "set") return;
    locked = true;
    const e = cur(),
      previous = db.liftHistory[e.id] ? { ...db.liftHistory[e.id] } : null,
      entry = { id: e.id, name: e.name, set: sets(e.id).length + 1, weight, reps, previous };
    session.push(entry);
    lastLogged = entry;
    db.liftHistory[e.id] = { weight, reps };
    saveDB();
    if (session.length >= order.length * 2) return finish();
    restDone = complete(e.id);
    phase = "rest";
    deadline = Date.now() + e.rest * 1000;
    paused = false;
    pauseStarted = null;
    saveActive();
    renderRest();
  }
  function renderRest() {
    stopTimer();
    phase = "rest";
    const next = restDone
        ? order.slice(exerciseIndex + 1).find((x) => !complete(x.id))?.name || "Finish"
        : cur().name,
      left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    stage.innerHTML = `<section class="timer"><div>${esc(lastLogged.name)} · Set ${lastLogged.set}</div><div class="logged">${lastLogged.weight === 0 ? "BW" : lastLogged.weight + " lb"} × ${lastLogged.reps}</div><div style="margin-top:8px">Next: ${esc(next)}</div><div id="secs" class="seconds">${left}</div><div class="timerActions"><button id="back" type="button">Back</button><button id="pause" type="button">${paused ? "Resume" : "Pause"}</button><button id="skip" type="button">Skip</button></div></section>`;
    stage.querySelector("#back").addEventListener("click", undo);
    stage.querySelector("#pause").addEventListener("click", togglePause);
    stage.querySelector("#skip").addEventListener("click", advance);
    if (!paused) {
      tick();
      if (phase === "rest") timer = setInterval(tick, 250);
    }
  }
  function tick() {
    if (phase !== "rest" || paused || deadline === null) return;
    const n = stage.querySelector("#secs");
    if (!n) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    n.textContent = left;
    if (left <= 0) {
      stopTimer();
      deadline = null;
      beep();
      advance();
    }
  }
  function togglePause() {
    if (phase !== "rest") return;
    if (!paused) {
      paused = true;
      pauseStarted = Date.now();
      stopTimer();
    } else {
      paused = false;
      if (deadline !== null && pauseStarted !== null) deadline += Date.now() - pauseStarted;
      pauseStarted = null;
    }
    saveActive();
    renderRest();
  }
  function undo() {
    if (phase !== "rest" || !lastLogged) return;
    stopTimer();
    deadline = null;
    paused = false;
    pauseStarted = null;
    const x = session.pop();
    if (x.previous) db.liftHistory[x.id] = { ...x.previous };
    else delete db.liftHistory[x.id];
    exerciseIndex = order.findIndex((e) => e.id === x.id);
    pendingWeight = x.weight;
    lastLogged = session.length ? session[session.length - 1] : null;
    saveDB();
    phase = "set";
    showSet();
  }
  function advance() {
    if (phase !== "rest") return;
    stopTimer();
    deadline = null;
    paused = false;
    pauseStarted = null;
    if (restDone) {
      do {
        exerciseIndex++;
      } while (exerciseIndex < order.length && complete(order[exerciseIndex].id));
    }
    pendingWeight = null;
    phase = "set";
    showSet();
  }
  function showSwap() {
    if (phase !== "set") return;
    pendingWeight = weight;
    phase = "swap";
    saveActive();
    const options = order.map((e, i) => ({ e, i })).filter((x) => x.i > exerciseIndex && !complete(x.e.id));
    if (!options.length) {
      phase = "set";
      return showSet();
    }
    stage.innerHTML = `<div class="head"><div class="title">Swap with</div><button id="swapBack" class="btn" type="button">Back</button></div><div class="swapList">${options.map((x) => `<button class="swapRow" data-i="${x.i}" type="button">${esc(x.e.name)}</button>`).join("")}</div>`;
    stage.querySelector("#swapBack").addEventListener("click", () => {
      phase = "set";
      showSet();
    });
    stage.querySelectorAll("[data-i]").forEach((b) =>
      b.addEventListener("click", () => {
        if (phase !== "swap") return;
        const i = Number(b.dataset.i),
          t = order[exerciseIndex];
        order[exerciseIndex] = order[i];
        order[i] = t;
        pendingWeight = null;
        phase = "set";
        saveActive();
        showSet();
      }),
    );
  }
  function finish() {
    stopTimer();
    const ended = Date.now(),
      log = {
        id: Date.now(),
        name: templates[workout].name,
        date: new Date(ended).toISOString(),
        duration: Math.max(1, Math.round((ended - startedAt) / 60000)),
        sets: session.map((x) => ({ id: x.id, name: x.name, set: x.set, weight: x.weight, reps: x.reps })),
      };
    db.workoutLogs.push(log);
    clearActive();
    workout = null;
    order = [];
    phase = "done";
    stage.innerHTML = `<section class="done"><strong>Done.</strong><div>${log.sets.length} sets · ${log.duration} min · saved</div><button id="doneHome" class="submit" type="button">Home</button></section>`;
    stage.querySelector("#doneHome").addEventListener("click", showHome);
  }
  function foodTotals(date) {
    return db.foodLogs
      .filter((x) => x.date === date)
      .reduce(
        (a, x) => {
          a.calories += x.calories || 0;
          a.protein += x.protein || 0;
          a.carbs += x.carbs || 0;
          a.fat += x.fat || 0;
          a.sodium += x.sodium || 0;
          a.fiber += x.fiber || 0;
          return a;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0 },
      );
  }
  function macroLine(x) {
    return `${x.approx ? "~" : ""}${x.calories} cal · ${r1(x.protein)}g P · ${r1(x.carbs)}g C · ${r1(x.fat)}g F · ${Math.round(x.sodium || 0)}mg Na · ${r1(x.fiber)}g fiber`;
  }
  function showFood(tab = "meals") {
    stopTimer();
    if (active()) saveActive();
    if (tab !== "today") editingFoodId = null;
    phase = "food";
    const d = dayKey(),
      t = foodTotals(d),
      count = db.foodLogs.filter((x) => x.date === d).length;
    const library =
      tab === "meals" ? renderFoodList(meals) : tab === "snacks" ? renderFoodList(snacks) : tab === "drinks" ? renderFoodList(drinks) : renderToday(d);
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Food</div><button id="foodBack" class="btn" type="button">Back</button></div><div class="metrics"><div class="metric"><div class="metricName">Calories</div><div class="metricVal">${Math.round(t.calories)}</div><div>${targets.calories} target</div></div><div class="metric"><div class="metricName">Protein</div><div class="metricVal">${r1(t.protein)}g</div><div>${targets.protein}g target</div></div><div class="metric"><div class="metricName">Carbs</div><div class="metricVal">${r1(t.carbs)}g</div></div><div class="metric"><div class="metricName">Fat</div><div class="metricVal">${r1(t.fat)}g</div></div><div class="metric"><div class="metricName">Sodium</div><div class="metricVal">${Math.round(t.sodium)}</div><div>mg</div></div><div class="metric"><div class="metricName">Fiber</div><div class="metricVal">${r1(t.fiber)}g</div></div></div><div class="tabs"><button data-tab="meals" class="${tab === "meals" ? "active" : ""}" type="button">Meals</button><button data-tab="snacks" class="${tab === "snacks" ? "active" : ""}" type="button">Snacks</button><button data-tab="drinks" class="${tab === "drinks" ? "active" : ""}" type="button">Drinks</button><button data-tab="today" class="${tab === "today" ? "active" : ""}" type="button">Today · ${count}</button></div><div class="library">${library}</div></section>`;
    stage.querySelector("#foodBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showFood(b.dataset.tab)));
    stage.querySelectorAll("[data-add-food]").forEach((b) => b.addEventListener("click", () => addFoodItem(b.dataset.addFood)));
    stage.querySelectorAll("[data-delete-food]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.deleteFood;
        const idx = db.foodLogs.findIndex((x) => String(x.id) === id);
        if (idx === -1) return;
        const [removed] = db.foodLogs.splice(idx, 1);
        if (editingFoodId === id) editingFoodId = null;
        saveDB();
        showFood("today");
        showUndoToast(`Deleted ${removed.name}`, () => {
          db.foodLogs.splice(idx, 0, removed);
          saveDB();
          if (phase === "food") showFood("today");
        });
      }),
    );
    stage.querySelectorAll("[data-edit-food]").forEach((b) =>
      b.addEventListener("click", () => {
        editingFoodId = b.dataset.editFood;
        showFood("today");
      }),
    );
    stage.querySelectorAll("[data-cancel-edit-food]").forEach((b) =>
      b.addEventListener("click", () => {
        editingFoodId = null;
        showFood("today");
      }),
    );
    stage.querySelectorAll("[data-save-food]").forEach((b) =>
      b.addEventListener("click", () => saveFoodEdit(b.dataset.saveFood)),
    );
    stage.querySelectorAll("[data-save-food-ingredients]").forEach((b) =>
      b.addEventListener("click", () => saveFoodIngredientEdit(b.dataset.saveFoodIngredients)),
    );
    if (tab === "today" && editingFoodId) {
      const editingItem = db.foodLogs.find((x) => String(x.id) === editingFoodId);
      if (editingItem && Array.isArray(editingItem.ingredients) && editingItem.ingredients.length) {
        wireIngredientEditLive(editingItem);
      }
    }
    armBackgroundTimer();
  }
  function renderFoodList(list) {
    return list
      .map((m) => {
        const details = m.ingredientIds
          ? m.ingredientIds
              .map((id) => {
                const f = ingredients[id];
                return `<div class="ingredientMini"><span>${esc(f.name)} · ${esc(f.serving)}</span><span>${f.calories} cal</span></div>`;
              })
              .join("")
          : m.ingredientText
            ? m.ingredientText.map((x) => `<div class="ingredientMini"><span>${esc(x)}</span><span></span></div>`).join("")
            : "";
        return `<div class="mealCard"><div class="mealTop"><div><div class="foodName">${esc(m.name)}${m.incomplete ? " · INCOMPLETE" : ""}</div><div class="serving">${esc(m.serving)}</div><div class="macroLine">${macroLine(m)}</div>${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}</div><button class="add" data-add-food="${m.id}" type="button">Add</button></div>${details ? `<details><summary>Ingredients</summary>${details}</details>` : ""}</div>`;
      })
      .join("");
  }
  function findFoodItem(id) {
    return meals.find((x) => x.id === id) || snacks.find((x) => x.id === id) || drinks.find((x) => x.id === id) || null;
  }
  function addFoodItem(id) {
    const m = findFoodItem(id);
    if (!m) return;
    const entry = {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
      date: dayKey(),
      refId: m.id,
      name: m.name,
      serving: m.serving,
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbs,
      fat: m.fat,
      sodium: m.sodium || 0,
      fiber: m.fiber || 0,
      approx: !!m.approx,
      incomplete: !!m.incomplete,
    };
    if (m.ingredientIds) {
      entry.ingredients = m.ingredientIds.map((ingId) => {
        const f = ingredients[ingId];
        return {
          id: ingId,
          name: f.name,
          serving: f.serving,
          calories: f.calories || 0,
          protein: f.protein || 0,
          carbs: f.carbs || 0,
          fat: f.fat || 0,
          sodium: f.sodium || 0,
          fiber: f.fiber || 0,
          qty: 1,
        };
      });
    }
    db.foodLogs.push(entry);
    saveDB();
    showFood("today");
  }
  function sumIngredients(list) {
    return list.reduce(
      (a, ing) => {
        const q = Number(ing.qty);
        const qty = Number.isFinite(q) && q >= 0 ? q : 0;
        a.calories += (ing.calories || 0) * qty;
        a.protein += (ing.protein || 0) * qty;
        a.carbs += (ing.carbs || 0) * qty;
        a.fat += (ing.fat || 0) * qty;
        a.sodium += (ing.sodium || 0) * qty;
        a.fiber += (ing.fiber || 0) * qty;
        return a;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0 },
    );
  }
  function renderToday(d) {
    const rows = db.foodLogs.filter((x) => x.date === d).slice().reverse();
    if (!rows.length) return `<div class="logRow"><div class="foodName">Nothing logged today.</div></div>`;
    return rows.map((x) => (String(x.id) === editingFoodId ? renderFoodEditRow(x) : renderFoodRow(x))).join("");
  }
  function renderFoodRow(x) {
    return `<div class="logRow" data-food-row="${x.id}"><div class="logTop"><div><div class="foodName">${esc(x.name)}${x.incomplete ? " · INCOMPLETE" : ""}</div><div class="serving">${esc(x.serving || "")}</div><div class="macroLine">${x.approx ? "~" : ""}${x.calories} cal · ${r1(x.protein)}g P · ${r1(x.carbs)}g C · ${r1(x.fat)}g F · ${Math.round(x.sodium || 0)}mg Na · ${r1(x.fiber)}g fiber</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="delete" data-edit-food="${x.id}" type="button" aria-label="Edit">✎</button><button class="delete" data-delete-food="${x.id}" type="button" aria-label="Delete">×</button></div></div></div>`;
  }
  function renderFoodEditRow(x) {
    if (Array.isArray(x.ingredients) && x.ingredients.length) return renderIngredientEditRow(x);
    return `<div class="logRow" data-food-row="${x.id}"><div style="display:flex;flex-direction:column;gap:8px;width:100%">
      <input data-edit-field="name" type="text" value="${esc(x.name)}" placeholder="Name">
      <input data-edit-field="serving" type="text" value="${esc(x.serving || "")}" placeholder="Serving">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input data-edit-field="calories" type="number" value="${x.calories}" placeholder="Calories">
        <input data-edit-field="protein" type="number" step="0.1" value="${x.protein}" placeholder="Protein (g)">
        <input data-edit-field="carbs" type="number" step="0.1" value="${x.carbs}" placeholder="Carbs (g)">
        <input data-edit-field="fat" type="number" step="0.1" value="${x.fat}" placeholder="Fat (g)">
        <input data-edit-field="sodium" type="number" value="${x.sodium || 0}" placeholder="Sodium (mg)">
        <input data-edit-field="fiber" type="number" step="0.1" value="${x.fiber || 0}" placeholder="Fiber (g)">
      </div>
      <div style="display:flex;gap:8px">
        <button class="submit" style="margin-top:0" data-save-food="${x.id}" type="button">Save</button>
        <button class="btn" data-cancel-edit-food type="button">Cancel</button>
      </div>
    </div></div>`;
  }
  function renderIngredientEditRow(x) {
    const rows = x.ingredients
      .map(
        (ing, i) =>
          `<div class="ingredientMini" data-ing-row="${i}"><span>${esc(ing.name)} · ${esc(ing.serving)}</span><span style="display:flex;align-items:center;gap:8px"><input type="number" step="0.5" min="0" value="${ing.qty}" data-ing-qty="${i}" style="width:60px;min-height:32px;padding:0 6px;text-align:center">×<span data-ing-cal style="min-width:52px;text-align:right">${Math.round((ing.calories || 0) * ing.qty)} cal</span></span></div>`,
      )
      .join("");
    return `<div class="logRow" data-food-row="${x.id}"><div style="display:flex;flex-direction:column;gap:8px;width:100%">
      <input data-edit-field="name" type="text" value="${esc(x.name)}" placeholder="Name">
      <div>${rows}</div>
      <div class="macroLine" data-ing-totals>${macroLine(Object.assign(sumIngredients(x.ingredients), { approx: x.approx }))}</div>
      <div style="display:flex;gap:8px">
        <button class="submit" style="margin-top:0" data-save-food-ingredients="${x.id}" type="button">Save</button>
        <button class="btn" data-cancel-edit-food type="button">Cancel</button>
      </div>
    </div></div>`;
  }
  function wireIngredientEditLive(x) {
    const row = stage.querySelector(`[data-food-row="${CSS.escape(String(x.id))}"]`);
    if (!row) return;
    const update = () => {
      const list = x.ingredients.map((ing, i) => {
        const input = row.querySelector(`[data-ing-qty="${i}"]`);
        const q = input ? Number(input.value) : ing.qty;
        return { ...ing, qty: Number.isFinite(q) && q >= 0 ? q : 0 };
      });
      row.querySelectorAll("[data-ing-row]").forEach((r) => {
        const i = Number(r.dataset.ingRow);
        const calEl = r.querySelector("[data-ing-cal]");
        if (calEl) calEl.textContent = `${Math.round((list[i].calories || 0) * list[i].qty)} cal`;
      });
      const totalsEl = row.querySelector("[data-ing-totals]");
      if (totalsEl) totalsEl.textContent = macroLine(Object.assign(sumIngredients(list), { approx: x.approx }));
    };
    row.querySelectorAll("[data-ing-qty]").forEach((input) => input.addEventListener("input", update));
  }
  function saveFoodIngredientEdit(id) {
    const row = stage.querySelector(`[data-food-row="${CSS.escape(id)}"]`);
    const x = db.foodLogs.find((f) => String(f.id) === id);
    if (!row || !x || !Array.isArray(x.ingredients)) return;
    const name = (row.querySelector('[data-edit-field="name"]')?.value || "").trim();
    if (name) x.name = name;
    x.ingredients = x.ingredients.map((ing, i) => {
      const input = row.querySelector(`[data-ing-qty="${i}"]`);
      const q = input ? Number(input.value) : ing.qty;
      return { ...ing, qty: Number.isFinite(q) && q >= 0 ? q : 0 };
    });
    const totals = sumIngredients(x.ingredients);
    x.calories = totals.calories;
    x.protein = totals.protein;
    x.carbs = totals.carbs;
    x.fat = totals.fat;
    x.sodium = totals.sodium;
    x.fiber = totals.fiber;
    editingFoodId = null;
    saveDB();
    showFood("today");
  }
  function saveFoodEdit(id) {
    const row = stage.querySelector(`[data-food-row="${CSS.escape(id)}"]`);
    const x = db.foodLogs.find((f) => String(f.id) === id);
    if (!row || !x) return;
    const field = (f) => row.querySelector(`[data-edit-field="${f}"]`)?.value;
    const num = (f, cur) => {
      const v = Number(field(f));
      return Number.isFinite(v) ? v : cur;
    };
    const name = (field("name") || "").trim();
    if (name) x.name = name;
    x.serving = (field("serving") || "").trim();
    x.calories = num("calories", x.calories);
    x.protein = num("protein", x.protein);
    x.carbs = num("carbs", x.carbs);
    x.fat = num("fat", x.fat);
    x.sodium = num("sodium", x.sodium);
    x.fiber = num("fiber", x.fiber);
    editingFoodId = null;
    saveDB();
    showFood("today");
  }
  function showBody() {
    stopTimer();
    if (active()) saveActive();
    phase = "body";
    const d = dayKey(),
      tw = db.weightLogs.find((x) => x.date === d),
      lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lwa = db.waistLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column"><div class="head"><div class="title">Body</div><button id="bodyBack" class="btn" type="button">Back</button></div><div class="metrics" style="grid-template-columns:1fr 1fr"><div class="metric"><div class="metricName">Latest weight</div><div class="metricVal">${lw ? Number(lw.weight).toFixed(1) : "—"}</div><div>lb</div></div><div class="metric"><div class="metricName">Latest waist</div><div class="metricVal">${lwa ? Number(lwa.waist).toFixed(1) : "—"}</div><div>in</div></div></div><div class="bodyForms"><form id="weightForm" class="form"><strong>Daily weight</strong><input id="weightInput" type="number" inputmode="decimal" min="100" max="400" step="0.1" value="${tw ? tw.weight : ""}" placeholder="Weight (lb)" required><button class="submit" type="submit">Save</button></form><form id="waistForm" class="form"><strong>Weekly waist</strong><input id="waistInput" type="number" inputmode="decimal" min="20" max="80" step="0.1" placeholder="Waist at navel (in)" required><button class="submit" type="submit">Save</button></form></div><div class="list">${renderBody()}</div></section>`;
    stage.querySelector("#bodyBack").addEventListener("click", showHome);
    stage.querySelector("#weightForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = Number(stage.querySelector("#weightInput").value);
      if (!Number.isFinite(v) || v < 100 || v > 400) return;
      const x = db.weightLogs.find((x) => x.date === d);
      if (x) x.weight = v;
      else db.weightLogs.push({ date: d, weight: v });
      saveDB();
      showBody();
    });
    stage.querySelector("#waistForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = Number(stage.querySelector("#waistInput").value);
      if (!Number.isFinite(v) || v < 20 || v > 80) return;
      const x = db.waistLogs.find((x) => x.date === d);
      if (x) x.waist = v;
      else db.waistLogs.push({ date: d, waist: v });
      saveDB();
      showBody();
    });
    armBackgroundTimer();
  }
  function renderBody() {
    const dates = [...new Set([...db.weightLogs.map((x) => x.date), ...db.waistLogs.map((x) => x.date)])].sort().reverse();
    return dates.length
      ? dates
          .map((d) => {
            const w = db.weightLogs.find((x) => x.date === d),
              wa = db.waistLogs.find((x) => x.date === d);
            return `<div class="bodyRow"><strong>${esc(d)}</strong><span>${w ? Number(w.weight).toFixed(1) + " lb" : ""}${w && wa ? " · " : ""}${wa ? Number(wa.waist).toFixed(1) + " in" : ""}</span></div>`;
          })
          .join("")
      : `<div class="bodyRow">No measurements yet.</div>`;
  }
  function showHistory() {
    stopTimer();
    if (active()) saveActive();
    phase = "history";
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column"><div class="head"><div class="title">History</div><button id="historyBack" class="btn" type="button">Back</button></div><div class="list">${db.workoutLogs.length ? db.workoutLogs.slice().reverse().map((l) => `<div class="setRow"><div><strong>${esc(l.name)}</strong><div>${new Date(l.date).toLocaleDateString()}</div></div><div style="display:flex;align-items:center;gap:10px"><span>${l.sets.length} sets · ${l.duration} min</span><button class="delete" data-delete-workout="${l.id}" type="button" aria-label="Delete">×</button></div></div>`).join("") : `<div class="setRow">No workouts yet.</div>`}</div></section>`;
    stage.querySelector("#historyBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-delete-workout]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = String(b.dataset.deleteWorkout);
        const idx = db.workoutLogs.findIndex((l) => String(l.id) === id);
        if (idx === -1) return;
        const [removed] = db.workoutLogs.splice(idx, 1);
        saveDB();
        showHistory();
        showUndoToast(`Deleted ${removed.name}`, () => {
          db.workoutLogs.splice(idx, 0, removed);
          saveDB();
          if (phase === "history") showHistory();
        });
      }),
    );
    armBackgroundTimer();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && phase === "rest" && deadline !== null && !paused) tick();
  });
  stage.addEventListener("click", (e) => {
    const b = e.target.closest("[data-start]");
    if (b) start(b.dataset.start);
  });
  showHome();
})();

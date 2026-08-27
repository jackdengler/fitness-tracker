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
            cardioLogs: [],
            liftHistory: {},
            activeWorkout: null,
          },
          remote,
        );
        ensureTemplates();
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

  const targets = {
    calories: { min: 1900, max: 2100 },
    protein: { min: 175, max: 195 },
    carbs: { min: 120, max: 160 },
    fat: { min: 50, max: 60 },
    sodium: { min: 1500, max: 2300 },
    fiber: { min: 30, max: 40 },
  };
  function targetLabel(key) {
    const t = targets[key];
    if (!t) return "";
    const unit = key === "sodium" ? "mg" : key === "calories" ? "" : "g";
    if (t.min !== undefined && t.max !== undefined) return `${t.min}–${t.max}${unit}`;
    if (t.min !== undefined) return `min ${t.min}${unit}`;
    if (t.max !== undefined) return `max ${t.max}${unit}`;
    return "";
  }
  const METRIC_BUFFER = 0.1; // within 10% of a threshold = yellow, beyond = red
  function metricStatus(value, key) {
    const t = targets[key];
    if (!t) return " good";
    if (t.min !== undefined && value < t.min) {
      return value >= t.min * (1 - METRIC_BUFFER) ? " warn" : " bad";
    }
    if (t.max !== undefined && value > t.max) {
      return value <= t.max * (1 + METRIC_BUFFER) ? " warn" : " bad";
    }
    return " good";
  }
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
    thomasplainbagel: {
      name: "Thomas' Plain Bagel",
      serving: "1 bagel",
      calories: 260,
      protein: 9,
      carbs: 52,
      fat: 1,
      sodium: 460,
      fiber: 2,
      other: "~7g sugar. Label values for the standard (non-mini, non-thin) bagel.",
    },
    philadelphiawhippedcreamcheese: {
      name: "Philadelphia Whipped Cream Cheese",
      serving: "3 tbsp (heavy schmear)",
      calories: 105,
      protein: 3,
      carbs: 3,
      fat: 9,
      sodium: 158,
      fiber: 0,
      other: "1.5x the standard 2 tbsp label serving to reflect a heavy schmear.",
      approx: true,
    },
    chickentenderbare: {
      name: "Chicken Tenders (BARE/Pilgrim's)",
      serving: "g",
      calories: 1.828,
      protein: 0.1828,
      carbs: 0.1183,
      fat: 0.0645,
      sodium: 6.6667,
      fiber: 0,
      other: "Per-gram values from label: 93g (2 pieces) = 170 cal, 6g fat, 50mg cholesterol, 620mg sodium, 11g carb, 2g sugar, 17g protein.",
    },
    butterromainelettuceleaves: {
      name: "Butter/Romaine Lettuce Leaves",
      serving: "8 leaves",
      calories: 15,
      protein: 1,
      carbs: 3,
      fat: 0,
      sodium: 5,
      fiber: 1.5,
    },
    tomatomedium: {
      name: "Tomato, diced",
      serving: "1 medium",
      calories: 22,
      protein: 1,
      carbs: 5,
      fat: 0,
      sodium: 6,
      fiber: 1.5,
    },
    redonionquartercup: {
      name: "Red onion, chopped",
      serving: "¼ cup",
      calories: 16,
      protein: 0,
      carbs: 4,
      fat: 0,
      sodium: 2,
      fiber: 0.5,
    },
    honeymustarddressing: {
      name: "Honey Mustard Yogurt Dressing (Bolthouse Farms)",
      serving: "2 tbsp",
      calories: 45,
      protein: 1,
      carbs: 5,
      fat: 2,
      sodium: 115,
      fiber: 0,
    },
    groundbeef937: {
      name: "Ground beef 93/7 (cooked)",
      serving: "g",
      calories: 1.9294,
      protein: 0.2471,
      carbs: 0,
      fat: 0.0941,
      sodium: 0.7059,
      fiber: 0,
      other: "Per-gram, cooked-weight basis (328 cal / 42g protein / 16g fat / 120mg sodium per 6oz/170g cooked).",
    },
    avocadooilspray: {
      name: "Avocado oil spray",
      serving: "~1-2 sec spray",
      calories: 40,
      protein: 0,
      carbs: 0,
      fat: 4.5,
      sodium: 0,
      fiber: 0,
    },
    garlic: {
      name: "Garlic",
      serving: "1.5 cloves",
      calories: 6,
      protein: 0,
      carbs: 1.4,
      fat: 0,
      sodium: 1,
      fiber: 0.1,
    },
    reducedsodiumsoysauce: {
      name: "Reduced-sodium soy sauce (TJ's)",
      serving: "1 tbsp",
      calories: 10,
      protein: 1,
      carbs: 1,
      fat: 0,
      sodium: 530,
      fiber: 0,
    },
    ricevinegar: {
      name: "Rice vinegar",
      serving: "1 tbsp",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 0,
      fiber: 0,
    },
    sesameoilkadoya: {
      name: "Sesame oil (Kadoya)",
      serving: "1 tsp",
      calories: 43,
      protein: 0,
      carbs: 0,
      fat: 4.7,
      sodium: 0,
      fiber: 0,
    },
    brownsugar: {
      name: "Brown sugar",
      serving: "1 tbsp",
      calories: 52,
      protein: 0,
      carbs: 13,
      fat: 0,
      sodium: 1,
      fiber: 0,
    },
    redpepperflakes: {
      name: "Red pepper flakes",
      serving: "¼ tsp",
      calories: 1,
      protein: 0,
      carbs: 0.2,
      fat: 0,
      sodium: 0,
      fiber: 0.1,
    },
    groundginger: {
      name: "Ground ginger",
      serving: "⅛ tsp",
      calories: 1,
      protein: 0,
      carbs: 0.2,
      fat: 0,
      sodium: 0,
      fiber: 0,
    },
    greenonion: {
      name: "Green onion",
      serving: "1 stalk",
      calories: 5,
      protein: 0.3,
      carbs: 1,
      fat: 0,
      sodium: 2,
      fiber: 0.4,
    },
    sesameseeds: {
      name: "Sesame seeds",
      serving: "⅛ tsp",
      calories: 5,
      protein: 0.2,
      carbs: 0.2,
      fat: 0.4,
      sodium: 0,
      fiber: 0.1,
    },
    whitericeuncooked: {
      name: "White rice, uncooked",
      serving: "¼ cup",
      calories: 165,
      protein: 3,
      carbs: 36,
      fat: 0.4,
      sodium: 1,
      fiber: 0.6,
    },
    edamamekroger: {
      name: "Edamame, shelled (Kroger)",
      serving: "½ bag (1.25 srv)",
      calories: 113,
      protein: 8.8,
      carbs: 12.5,
      fat: 3.1,
      sodium: 0,
      fiber: 3.8,
    },
    egg: {
      name: "Egg (large)",
      serving: "1 egg",
      calories: 70,
      protein: 6,
      carbs: 0,
      fat: 5,
      sodium: 70,
      fiber: 0,
      other: "185mg cholesterol · 1.5g saturated fat. Per carton label.",
    },
    oliveoildrizzle: {
      name: "Olive oil (pan drizzle)",
      serving: "1 tsp",
      calories: 40,
      protein: 0,
      carbs: 0,
      fat: 4.5,
      sodium: 0,
      fiber: 0,
      other: "~0.6g saturated fat",
      approx: true,
    },
    saltpinch: {
      name: "Salt",
      serving: "~⅛ tsp",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 290,
      fiber: 0,
      approx: true,
    },
    blackpepper: {
      name: "Black pepper",
      serving: "a few grinds",
      calories: 1,
      protein: 0,
      carbs: 0.2,
      fat: 0,
      sodium: 0,
      fiber: 0.1,
      approx: true,
    },
    cholulahotsauce: {
      name: "Cholula Hot Sauce",
      serving: "~1 tsp",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 85,
      fiber: 0,
      approx: true,
    },
    everythingbagelseasoning: {
      name: "Everything Bagel Seasoning",
      serving: "¼ tsp",
      calories: 5,
      protein: 0,
      carbs: 0.3,
      fat: 0.3,
      sodium: 75,
      fiber: 0.1,
      other: "Sesame, poppy seed, garlic, onion, salt blend",
      approx: true,
    },
    salmonfillet: {
      name: "Salmon Fillet",
      serving: "g",
      calories: 2.2124,
      protein: 0.2035,
      carbs: 0,
      fat: 0.1593,
      sodium: 0.4425,
      fiber: 0,
      other: "Per-gram values from label: 113g (4oz, ~1/2 fillet) = 250 cal, 18g fat, 65mg cholesterol, 50mg sodium, 0g carb, 23g protein.",
    },
    avocado: {
      name: "Avocado",
      serving: "g",
      calories: 1.6,
      protein: 0.02,
      carbs: 0.0853,
      fat: 0.1466,
      sodium: 0.07,
      fiber: 0.067,
      other: "USDA per-100g raw avocado: 160 cal, 2g protein, 8.53g carb, 14.66g fat, 7mg sodium, 6.7g fiber.",
      approx: true,
    },
    raspberriesg: {
      name: "Raspberries",
      serving: "g",
      calories: 0.5161,
      protein: 0.0113,
      carbs: 0.1129,
      fat: 0.0065,
      sodium: 0.0161,
      fiber: 0.0645,
      other: "Per-gram, derived from USDA raw-raspberry values (~62g = 32 cal, 0.7g protein, 7g carb, 0.4g fat, 1mg sodium, 4g fiber).",
      approx: true,
    },
    isopurepowderscoop: {
      name: "Isopure Zero Carb Protein Powder (Vanilla)",
      serving: "scoop",
      calories: 110,
      protein: 25,
      carbs: 0,
      fat: 0.5,
      sodium: 190,
      fiber: 0,
      other: "Per label: 1 scoop (31g) = 5mg cholesterol, 0g sugar. About 15 servings per container.",
    },
    broccoli170g: {
      name: "Broccoli, steamed/roasted",
      serving: "170g",
      calories: 70,
      protein: 4,
      carbs: 12,
      fat: 0,
      sodium: 60,
      fiber: 4,
      other: "Label: 1 cup (85g) = 35 cal, 30mg sodium, 6g carb, 2g fiber, 2g protein. 170g = 2 servings exactly.",
    },
  };
  const meals = [
    {
      id: "two-fried-eggs",
      name: "Two Fried Eggs",
      serving: "2 eggs fried in olive oil, salt, pepper, Cholula, everything bagel seasoning",
      calories: 186,
      protein: 12,
      carbs: 0.5,
      fat: 14.8,
      sodium: 590,
      fiber: 0.2,
      approx: true,
      note: "Egg values per carton label (1 egg = 70 cal, 185mg cholesterol). Oil, salt, pepper, Cholula, and everything seasoning are all \"a little\" estimates — adjust any ingredient's qty to match how much you actually used.",
      ingredientIds: ["egg", "egg", "oliveoildrizzle", "saltpinch", "blackpepper", "cholulahotsauce", "everythingbagelseasoning"],
    },
    {
      id: "chicken-honey-mustard-wrap",
      name: "Chicken Honey Mustard Wrap",
      serving: "170g chicken, 8 lettuce wraps, honey mustard dressing",
      calories: 409,
      protein: 34.1,
      carbs: 37.1,
      fat: 13,
      sodium: 1261,
      fiber: 3.5,
      approx: true,
      note: "Chicken is a per-gram ingredient — edit its qty to the exact grams you used and the total recalculates. Default here is 170g (~6 oz, 2 tenders). Butter/romaine lettuce is the wrap, plus diced tomato, chopped red onion, and Bolthouse honey mustard yogurt dressing.",
      ingredientIds: [["chickentenderbare", 170], "butterromainelettuceleaves", "tomatomedium", "redonionquartercup", "honeymustarddressing"],
    },
    {
      id: "bagel-cream-cheese",
      name: "Thomas' Plain Bagel with Whipped Philadelphia",
      serving: "1 bagel + heavy cream cheese",
      calories: 365,
      protein: 12,
      carbs: 55,
      fat: 10,
      sodium: 618,
      fiber: 2,
      approx: true,
      note: "Cream cheese portion is a heavy schmear (~3 tbsp) — adjust its ingredient qty if you use less.",
      ingredientIds: ["thomasplainbagel", "philadelphiawhippedcreamcheese"],
    },
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
      serving: "Whole recipe (½ lb beef)",
      calories: 879,
      protein: 69.4,
      carbs: 65.5,
      fat: 34.5,
      sodium: 695,
      fiber: 5.1,
      approx: true,
      note: "Totals are the exact sum of the 13 listed ingredients. Beef is gram-adjustable (like the chicken wrap) — default is ½ lb (227g) cooked; edit its qty to your exact amount.",
      ingredientIds: [
        ["groundbeef937", 227],
        "avocadooilspray",
        "garlic",
        "reducedsodiumsoysauce",
        "ricevinegar",
        "sesameoilkadoya",
        "brownsugar",
        "redpepperflakes",
        "groundginger",
        "greenonion",
        "sesameseeds",
        "whitericeuncooked",
        "edamamekroger",
      ],
    },
    {
      id: "salmon-broccoli-rice-dinner",
      name: "Salmon Broccoli Rice Dinner",
      serving: "113g salmon, 170g broccoli, ¼ cup uncooked rice, ½ avocado",
      calories: 686,
      protein: 32,
      carbs: 56.73,
      fat: 37.56,
      sodium: 408,
      fiber: 11.4,
      approx: true,
      note: "Totals are the exact sum of the listed ingredients. Salmon and avocado are both gram-adjustable (like the chicken/beef) — defaults are 113g salmon (4oz, ~1/2 fillet) and 100g avocado (~1/2 a Hass avocado); edit either qty to your exact amount. Broccoli is a fixed 170g. Seasoned with avocado oil spray, salt, and pepper (no elote seasoning).",
      ingredientIds: [["salmonfillet", 113], "whitericeuncooked", "broccoli170g", ["avocado", 100], "avocadooilspray", "saltpinch", "blackpepper"],
    },
  ];
  const snacks = [
    {
      id: "fatboyicecreamsandwich",
      name: "Fat Boy Vanilla Ice Cream Sandwich",
      serving: "1 sandwich",
      calories: 210,
      protein: 3,
      carbs: 28,
      fat: 5,
      sodium: 105,
      fiber: 1,
      approx: true,
      note: "Calories per label (210). Protein/carbs/fat/sodium/fiber are still typical estimates, not from this SKU's label.",
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
    {
      id: "oikostriplezero",
      name: "Oikos Triple Zero",
      serving: "1 cup",
      calories: 85,
      protein: 15,
      carbs: 6.5,
      fat: 0,
      sodium: 55,
      fiber: 0,
      approx: true,
      note: "Label range 80–90 cal, 6–7g carbs. Also 150mg calcium, 2mcg vitamin D, 150mg potassium, 5g sugar.",
    },
    {
      id: "raspberries",
      name: "Raspberries",
      serving: "62g",
      calories: 32,
      protein: 0.7,
      carbs: 7,
      fat: 0.4,
      sodium: 1,
      fiber: 4,
      approx: true,
      note: "Gram-adjustable — default is 62g (~½ cup); edit its qty to your exact amount. Fat, sodium, and fiber estimated from USDA raw-raspberry values (not label-supplied).",
      ingredientIds: [["raspberriesg", 62]],
    },
  ];
  const drinks = [
    {
      id: "flatwhite",
      name: "Flat White",
      serving: "~8 fl oz, double shot (18g) + steamed whole milk",
      calories: 123,
      protein: 7,
      carbs: 10,
      fat: 7,
      sodium: 102,
      fiber: 0,
      approx: true,
      note: "Your measured values (range given: 122-124 cal).",
    },
    {
      id: "americano",
      name: "Americano",
      serving: "Double shot (18g), black, hot water",
      calories: 5,
      protein: 0,
      carbs: 1,
      fat: 0,
      sodium: 5,
      fiber: 0,
      approx: true,
      note: "Black — add milk/sugar separately if used.",
    },
    {
      id: "isopureproteinshake",
      name: "Isopure Protein Shake",
      serving: "1 scoop (31g)",
      calories: 110,
      protein: 25,
      carbs: 0,
      fat: 0.5,
      sodium: 190,
      fiber: 0,
      note: "Isopure Zero Carb Protein Powder (Vanilla) — scoop-adjustable; edit its qty to how many scoops you use. Default is 1 scoop.",
      ingredientIds: [["isopurepowderscoop", 1]],
    },
    {
      id: "lowcarbmonster",
      name: "Low Carb Monster",
      serving: "1 can",
      calories: 30,
      protein: 0,
      carbs: 9,
      fat: 0,
      sodium: 380,
      fiber: 0,
      note: "Per label: 9g total carb, 6g total sugars (6g added).",
    },
    {
      id: "crystallightlemonade",
      name: "Crystal Light Lemonade",
      serving: "1 packet (16 fl oz)",
      calories: 10,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 70,
      fiber: 0,
      note: "Per label, as prepared (16 fl oz). Also 140mg potassium. Contains soy, phenylalanine.",
    },
    {
      id: "crystallightpeachtea",
      name: "Crystal Light Peach Tea",
      serving: "1 packet (16 fl oz)",
      calories: 5,
      protein: 0,
      carbs: 0.5,
      fat: 0,
      sodium: 0,
      fiber: 0,
      note: "Per label, as prepared (16 fl oz). Carb listed as <1g. 30mg caffeine. Contains phenylalanine.",
    },
  ];
  const DEFAULT_TEMPLATES = {
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
            cardioLogs: [],
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
      cardioLogs: [],
      liftHistory: {},
      activeWorkout: null,
    };
  }
  function cloneTemplates(src) {
    const out = {};
    for (const k in src) out[k] = { name: src[k].name, ex: src[k].ex.map((x) => x.slice()) };
    return out;
  }
  function buildDefaultArchive() {
    const seen = {},
      arr = [];
    Object.values(DEFAULT_TEMPLATES).forEach((t) =>
      t.ex.forEach(([id, name, target, rest, type]) => {
        if (seen[id]) return;
        seen[id] = true;
        arr.push({ id, name, target, rest, type });
      }),
    );
    return arr;
  }
  function ensureTemplates() {
    if (!db.templates) db.templates = cloneTemplates(DEFAULT_TEMPLATES);
    if (!db.exerciseArchive) db.exerciseArchive = buildDefaultArchive();
  }
  let db = loadDB();
  ensureTemplates();
  let cardioMachine = "treadmill";
  let cardioMode = "run";
  let editorDay = "A";
  let swappingExIdx = null;
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
  const DAY_ROLLOVER_HOUR = 4; // "today" doesn't flip to the next date until 4am
  function effectiveNow() {
    return new Date(Date.now() - DAY_ROLLOVER_HOUR * 60 * 60 * 1000);
  }
  function dayKey() {
    const d = effectiveNow();
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
    return db.templates[k].ex.map((x) => ({
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
      lwa = db.waistLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lc = db.cardioLogs.slice().sort((a, b) => b.ts - a.ts)[0];
    let resume = "";
    const a = db.activeWorkout;
    if (a && a.workout) {
      const e = a.order[a.exerciseIndex];
      if (e)
        resume = `<button id="resume" class="resume" type="button"><div>Resume ${db.templates[a.workout].name}<br><small>${esc(e.name)} · ${a.phase === "rest" ? "Resting" : "Set " + Math.min(a.session.filter((x) => x.id === e.id).length + 1, 2)}</small></div><div>→</div></button>`;
    }
    const cardioLabel = lc ? (lc.machine === "treadmill" ? (lc.mode === "walk" ? "Walk" : "Run") : "Bike") : "Log";
    stage.innerHTML = `<section class="home"><div id="syncStatus" class="syncLine"></div>${resume}<div class="label" style="justify-content:space-between">Workout<button id="editWorkouts" type="button" style="background:none;border:0;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit;padding:0">Edit</button></div><div class="days" style="grid-template-columns:repeat(4,1fr)"><button class="day" data-start="A">A<span>Monday</span></button><button class="day" data-start="B">B<span>Wednesday</span></button><button class="day" data-start="C">C<span>Friday</span></button><button class="day" id="cardio" type="button" style="font-size:22px">Cardio<span>${cardioLabel}</span></button></div><div class="label">Tracking</div><div class="sections"><button id="food" class="sectionTile" type="button"><strong>Food</strong><span>${Math.round(t.calories)} kcal · ${r1(t.protein)}g protein</span></button><button id="body" class="sectionTile" type="button"><strong>Body</strong><span>${lw ? Number(lw.weight).toFixed(1) + " lb" : "No weight"} · ${lwa ? Number(lwa.waist).toFixed(1) + " in" : "No waist"}</span></button></div><button id="history" class="historyOpen" type="button">Workout history · ${db.workoutLogs.length}</button><button id="mealHistory" class="historyOpen" type="button" style="margin-top:0">Meal history</button><div id="publishTime" class="syncLine" style="border-bottom:0;border-top:1px solid light-dark(#cfd1cc,#343733)">published —</div></section>`;
    stage.querySelector("#resume")?.addEventListener("click", restore);
    stage.querySelector("#food").addEventListener("click", () => showFood("meals"));
    stage.querySelector("#body").addEventListener("click", showBody);
    stage.querySelector("#cardio").addEventListener("click", showCardio);
    stage.querySelector("#editWorkouts").addEventListener("click", showWorkoutEditor);
    stage.querySelector("#history").addEventListener("click", showHistory);
    stage.querySelector("#mealHistory").addEventListener("click", () => showFoodHistory());
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
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="exerciseHead"><div class="exerciseTitle"><div class="exerciseName">${esc(e.name)}</div><div class="exerciseMeta">${exerciseIndex + 1}/${order.length} · SET ${sets(e.id).length + 1}/2</div></div><button id="swap" class="btn" type="button">Swap</button><button id="pauseWorkout" class="btn" type="button">Pause</button><button id="endWorkout" class="btn" type="button">End</button></div><div class="picker"><div class="half"><div class="label">Weight · swipe ↔</div><div id="weights" class="rail">${weightVals(e).map((v) => `<button class="choice ${v === w ? "selected" : ""}" data-w="${v}" type="button">${v === 0 ? "BW" : v}</button>`).join("")}</div></div><div class="half"><div class="label">Reps · tap to log · target ${e.target}</div><div id="reps" class="rail">${Array.from({ length: 25 }, (_, i) => i + 1).map((v) => `<button class="choice ${v === e.target ? "target selected" : ""}" data-r="${v}" type="button">${v}</button>`).join("")}</div></div></div></section>`;
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
    stage.querySelector("#pauseWorkout").addEventListener("click", showHome);
    stage.querySelector("#endWorkout").addEventListener("click", endWorkout);
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
    const remaining = order
      .map((e, i) => {
        const done = sets(e.id).length;
        const isCurrent = i === exerciseIndex && done < 2;
        return `<div class="setRow" style="padding:6px 10px;${done >= 2 ? "opacity:0.5" : isCurrent ? "font-weight:700" : ""}"><span>${esc(e.name)}</span><span>${done >= 2 ? "✓" : `${done}/2`}</span></div>`;
      })
      .join("");
    stage.innerHTML = `<section class="timer"><div style="display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;width:100%"><button id="pauseWorkout" class="btn" type="button">Pause</button><button id="endWorkout" class="btn" type="button">End</button></div><div>${esc(lastLogged.name)} · Set ${lastLogged.set}</div><div class="logged">${lastLogged.weight === 0 ? "BW" : lastLogged.weight + " lb"} × ${lastLogged.reps}</div><div style="margin-top:8px">Next: ${esc(next)}</div><div id="secs" class="seconds">${left}</div><div class="timerActions"><button id="back" type="button">Back</button><button id="pause" type="button">${paused ? "Resume" : "Hold"}</button><button id="skip" type="button">Skip</button></div><div style="width:100%;overflow-y:auto;max-height:35vh;border-top:1px solid light-dark(#cfd1cc,#343733)">${remaining}</div></section>`;
    stage.querySelector("#back").addEventListener("click", undo);
    stage.querySelector("#pause").addEventListener("click", togglePause);
    stage.querySelector("#skip").addEventListener("click", advance);
    stage.querySelector("#pauseWorkout").addEventListener("click", showHome);
    stage.querySelector("#endWorkout").addEventListener("click", endWorkout);
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
    const inOrder = new Set(order.map((e) => e.id));
    const alts = db.exerciseArchive.filter((a) => a.type === cur().type && !inOrder.has(a.id)).slice(0, 2);
    if (!options.length && !alts.length) {
      phase = "set";
      return showSet();
    }
    stage.innerHTML = `<div class="head"><div class="title">Swap with</div><button id="swapBack" class="btn" type="button">Back</button></div><div class="swapList">${
      options.length
        ? `<div class="note" style="padding:8px 12px 0">Reorder — do later</div>${options.map((x) => `<button class="swapRow" data-i="${x.i}" type="button">${esc(x.e.name)}</button>`).join("")}`
        : ""
    }${
      alts.length
        ? `<div class="note" style="padding:8px 12px 0">Alternative — machine busy/missing</div>${alts.map((a) => `<button class="swapRow" data-alt="${a.id}" type="button">${esc(a.name)}</button>`).join("")}`
        : ""
    }</div>`;
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
    stage.querySelectorAll("[data-alt]").forEach((b) =>
      b.addEventListener("click", () => {
        if (phase !== "swap") return;
        const a = db.exerciseArchive.find((x) => x.id === b.dataset.alt);
        if (!a) return;
        order[exerciseIndex] = { id: a.id, name: a.name, target: a.target, rest: a.rest, type: a.type };
        pendingWeight = null;
        phase = "set";
        saveActive();
        showSet();
      }),
    );
  }
  function endWorkout() {
    stopTimer();
    if (!session.length) {
      clearActive();
      workout = null;
      order = [];
      showHome();
      return;
    }
    finish();
  }
  function finish() {
    stopTimer();
    const ended = Date.now(),
      log = {
        id: Date.now(),
        name: db.templates[workout].name,
        date: new Date(ended).toISOString(),
        duration: Math.max(1, Math.round((ended - startedAt) / 60000)),
        sets: session.map((x) => ({ id: x.id, name: x.name, set: x.set, weight: x.weight, reps: x.reps })),
      };
    db.workoutLogs.push(log);
    clearActive();
    workout = null;
    order = [];
    phase = "done";
    stage.innerHTML = `<section class="done"><strong>Done.</strong><div>${log.sets.length} sets · saved</div><button id="doneHome" class="submit" type="button">Home</button></section>`;
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
    phase = "food";
    const d = dayKey(),
      t = foodTotals(d);
    const library =
      tab === "meals" ? renderFoodList(meals) : tab === "snacks" ? renderFoodList(snacks) : renderFoodList(drinks);
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Food</div><button id="foodBack" class="btn" type="button">Back</button></div><div class="metrics"><div class="metric"><div class="metricName">Calories</div><div class="metricVal${metricStatus(t.calories, "calories")}">${Math.round(t.calories)}</div><div>${targetLabel("calories")}</div></div><div class="metric"><div class="metricName">Protein</div><div class="metricVal${metricStatus(t.protein, "protein")}">${r1(t.protein)}g</div><div>${targetLabel("protein")}</div></div><div class="metric"><div class="metricName">Carbs</div><div class="metricVal${metricStatus(t.carbs, "carbs")}">${r1(t.carbs)}g</div><div>${targetLabel("carbs")}</div></div><div class="metric"><div class="metricName">Fat</div><div class="metricVal${metricStatus(t.fat, "fat")}">${r1(t.fat)}g</div><div>${targetLabel("fat")}</div></div><div class="metric"><div class="metricName">Sodium</div><div class="metricVal${metricStatus(t.sodium, "sodium")}">${Math.round(t.sodium)}</div><div>${targetLabel("sodium")}</div></div><div class="metric"><div class="metricName">Fiber</div><div class="metricVal${metricStatus(t.fiber, "fiber")}">${r1(t.fiber)}g</div><div>${targetLabel("fiber")}</div></div></div><div class="tabs"><button data-tab="meals" class="${tab === "meals" ? "active" : ""}" type="button">Meals</button><button data-tab="snacks" class="${tab === "snacks" ? "active" : ""}" type="button">Snacks</button><button data-tab="drinks" class="${tab === "drinks" ? "active" : ""}" type="button">Drinks</button><button id="openFoodHistory" type="button">History</button></div><div class="library">${library}</div></section>`;
    stage.querySelector("#foodBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showFood(b.dataset.tab)));
    stage.querySelectorAll("[data-add-food]").forEach((b) => b.addEventListener("click", () => addFoodItem(b.dataset.addFood)));
    stage.querySelector("#openFoodHistory").addEventListener("click", showFoodHistory);
    armBackgroundTimer();
  }
  function showFoodHistory() {
    stopTimer();
    if (active()) saveActive();
    phase = "foodHistory";
    const d = dayKey();
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">History</div><div style="display:flex;gap:8px"><button id="openAdHocFood" class="btn" type="button">+ Add</button><button id="foodHistoryBack" class="btn" type="button">Back</button></div></div><div class="library">${renderToday(d)}</div></section>`;
    stage.querySelector("#foodHistoryBack").addEventListener("click", () => showFood("meals"));
    stage.querySelector("#openAdHocFood").addEventListener("click", showAdHocFood);
    stage.querySelectorAll("[data-delete-food]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.dataset.deleteFood;
        const idx = db.foodLogs.findIndex((x) => String(x.id) === id);
        if (idx === -1) return;
        const [removed] = db.foodLogs.splice(idx, 1);
        saveDB();
        showFoodHistory();
        showUndoToast(`Deleted ${removed.name}`, () => {
          db.foodLogs.splice(idx, 0, removed);
          saveDB();
          if (phase === "foodHistory") showFoodHistory();
        });
      }),
    );
    stage.querySelectorAll("[data-view-food]").forEach((el) =>
      el.addEventListener("click", () => showFoodDetail(el.dataset.viewFood)),
    );
    armBackgroundTimer();
  }
  function showAdHocFood() {
    stopTimer();
    if (active()) saveActive();
    phase = "adHocFood";
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Add Food</div><button id="adHocBack" class="btn" type="button">Back</button></div><div class="library"><form id="adHocForm" class="form" style="display:flex;flex-direction:column;gap:8px">
      <input id="adHocName" type="text" placeholder="Name" required>
      <input id="adHocCalories" type="number" inputmode="decimal" placeholder="Calories" required>
      <details><summary>+ Protein, carbs, fat, sodium, fiber</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <input id="adHocProtein" type="number" inputmode="decimal" step="0.1" placeholder="Protein (g)">
          <input id="adHocCarbs" type="number" inputmode="decimal" step="0.1" placeholder="Carbs (g)">
          <input id="adHocFat" type="number" inputmode="decimal" step="0.1" placeholder="Fat (g)">
          <input id="adHocSodium" type="number" inputmode="decimal" placeholder="Sodium (mg)">
          <input id="adHocFiber" type="number" inputmode="decimal" step="0.1" placeholder="Fiber (g)">
        </div>
      </details>
      <button class="submit" type="submit">Add</button>
    </form></div></section>`;
    stage.querySelector("#adHocBack").addEventListener("click", showFoodHistory);
    stage.querySelector("#adHocForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (stage.querySelector("#adHocName").value || "").trim();
      const calories = Number(stage.querySelector("#adHocCalories").value);
      if (!name || !Number.isFinite(calories)) return;
      const num = (id) => {
        const v = Number(stage.querySelector(id).value);
        return Number.isFinite(v) ? v : 0;
      };
      db.foodLogs.push({
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        date: dayKey(),
        name,
        serving: "",
        calories,
        protein: num("#adHocProtein"),
        carbs: num("#adHocCarbs"),
        fat: num("#adHocFat"),
        sodium: num("#adHocSodium"),
        fiber: num("#adHocFiber"),
        approx: false,
      });
      saveDB();
      showFoodHistory();
    });
    armBackgroundTimer();
  }
  function ingredientSpec(spec) {
    return Array.isArray(spec) ? { id: spec[0], qty: spec[1] } : { id: spec, qty: 1 };
  }
  function renderFoodList(list) {
    return list
      .map((m) => {
        const details = m.ingredientIds
          ? m.ingredientIds
              .map((spec) => {
                const { id, qty } = ingredientSpec(spec);
                const f = ingredients[id];
                const label = f.serving === "g" ? `${qty}g` : qty !== 1 ? `${qty}× ${f.serving}` : f.serving;
                return `<div class="ingredientMini"><span>${esc(f.name)} · ${esc(label)}</span><span>${Math.round((f.calories || 0) * qty)} cal</span></div>`;
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
      entry.ingredients = m.ingredientIds.map((spec) => {
        const { id: ingId, qty } = ingredientSpec(spec);
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
          qty,
        };
      });
    }
    db.foodLogs.push(entry);
    saveDB();
    showFoodHistory();
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
  function formatDayLabel(dateStr) {
    const dt = new Date(dateStr + "T00:00:00");
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function renderToday(d) {
    if (!db.foodLogs.length) return `<div class="logRow"><div class="foodName">Nothing logged yet.</div></div>`;
    const byDate = {};
    db.foodLogs.forEach((x) => {
      (byDate[x.date] || (byDate[x.date] = [])).push(x);
    });
    const dates = Object.keys(byDate).sort().reverse();
    const head = `<div class="foodTableHead"><span>Day</span><span>Cal</span><span>P</span><span>C</span><span>F</span><span>Na</span><span>Fi</span><span></span></div>`;
    const body = dates
      .map((date) => {
        const items = byDate[date];
        const totals = items.reduce(
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
        const isToday = date === d;
        const rows = items
          .slice()
          .reverse()
          .map((x) => renderFoodRow(x))
          .join("");
        const label = `${formatDayLabel(date)}${isToday ? " · today" : ""}`;
        return `<details ${isToday ? "open" : ""}><summary class="foodDaySummary"><div class="foodTableRow"><span><span class="chevron">▸</span><span class="cellName">${esc(label)}</span></span><span>${Math.round(totals.calories)}</span><span>${Math.round(totals.protein)}</span><span>${Math.round(totals.carbs)}</span><span>${Math.round(totals.fat)}</span><span>${Math.round(totals.sodium)}</span><span>${Math.round(totals.fiber)}</span><span></span></div></summary><div>${rows}</div></details>`;
      })
      .join("");
    return `${head}<div class="foodDayList">${body}</div>`;
  }
  function renderFoodRow(x) {
    return `<div class="foodItemRow" data-view-food="${x.id}"><div class="foodTableRow"><span><span class="cellName">${x.approx ? "~" : ""}${esc(x.name)}${x.incomplete ? " · INCOMPLETE" : ""}</span></span><span>${Math.round(x.calories)}</span><span>${Math.round(x.protein || 0)}</span><span>${Math.round(x.carbs || 0)}</span><span>${Math.round(x.fat || 0)}</span><span>${Math.round(x.sodium || 0)}</span><span>${Math.round(x.fiber || 0)}</span><span><button class="foodDeleteBtn" data-delete-food="${x.id}" type="button" aria-label="Delete">×</button></span></div></div>`;
  }
  function showFoodDetail(id) {
    stopTimer();
    if (active()) saveActive();
    phase = "foodDetail";
    const x = db.foodLogs.find((f) => String(f.id) === String(id));
    if (!x) return showFoodHistory();
    const hasIngredients = Array.isArray(x.ingredients) && x.ingredients.length;
    const body = hasIngredients ? renderIngredientEditBody(x) : renderWholeItemEditBody(x);
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">${esc(x.name)}</div><button id="foodDetailBack" class="btn" type="button">Back</button></div><div class="library"><div class="form" style="display:flex;flex-direction:column;gap:8px">${body}</div></div></section>`;
    stage.querySelector("#foodDetailBack").addEventListener("click", () => showFoodHistory());
    if (hasIngredients) {
      const update = () => {
        const list = x.ingredients.map((ing, i) => {
          const input = stage.querySelector(`[data-ing-qty="${i}"]`);
          const q = input ? Number(input.value) : ing.qty;
          return { ...ing, qty: Number.isFinite(q) && q >= 0 ? q : 0 };
        });
        stage.querySelectorAll("[data-ing-row]").forEach((r) => {
          const i = Number(r.dataset.ingRow);
          const calEl = r.querySelector("[data-ing-cal]");
          if (calEl) calEl.textContent = `${Math.round((list[i].calories || 0) * list[i].qty)} cal`;
          const macroEl = r.querySelector("[data-ing-macros]");
          if (macroEl) macroEl.textContent = ingredientMacroLine(list[i], list[i].qty);
        });
        const totalsEl = stage.querySelector("[data-ing-totals]");
        if (totalsEl) totalsEl.textContent = macroLine(Object.assign(sumIngredients(list), { approx: x.approx }));
      };
      stage.querySelectorAll("[data-ing-qty]").forEach((input) => input.addEventListener("input", update));
      stage.querySelector("#saveFoodIngredients").addEventListener("click", () => {
        const name = (stage.querySelector('[data-edit-field="name"]')?.value || "").trim();
        if (name) x.name = name;
        x.ingredients = x.ingredients.map((ing, i) => {
          const input = stage.querySelector(`[data-ing-qty="${i}"]`);
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
        saveDB();
        showFoodHistory();
      });
    } else {
      stage.querySelector("#saveFood").addEventListener("click", () => {
        const field = (f) => stage.querySelector(`[data-edit-field="${f}"]`)?.value;
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
        saveDB();
        showFoodHistory();
      });
    }
    armBackgroundTimer();
  }
  function renderWholeItemEditBody(x) {
    return `<input data-edit-field="name" type="text" value="${esc(x.name)}" placeholder="Name">
      <input data-edit-field="serving" type="text" value="${esc(x.serving || "")}" placeholder="Serving">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input data-edit-field="calories" type="number" value="${x.calories}" placeholder="Calories">
        <input data-edit-field="protein" type="number" step="0.1" value="${x.protein}" placeholder="Protein (g)">
        <input data-edit-field="carbs" type="number" step="0.1" value="${x.carbs}" placeholder="Carbs (g)">
        <input data-edit-field="fat" type="number" step="0.1" value="${x.fat}" placeholder="Fat (g)">
        <input data-edit-field="sodium" type="number" value="${x.sodium || 0}" placeholder="Sodium (mg)">
        <input data-edit-field="fiber" type="number" step="0.1" value="${x.fiber || 0}" placeholder="Fiber (g)">
      </div>
      <button class="submit" id="saveFood" style="margin-top:0" type="button">Save</button>`;
  }
  function ingredientMacroLine(ing, qty) {
    return macroLine({
      calories: Math.round((ing.calories || 0) * qty),
      protein: (ing.protein || 0) * qty,
      carbs: (ing.carbs || 0) * qty,
      fat: (ing.fat || 0) * qty,
      sodium: (ing.sodium || 0) * qty,
      fiber: (ing.fiber || 0) * qty,
    });
  }
  function renderIngredientEditBody(x) {
    const rows = x.ingredients
      .map(
        (ing, i) =>
          `<div class="ingredientMini" data-ing-row="${i}" style="flex-direction:column;align-items:stretch;gap:4px"><div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(ing.name)} · ${esc(ing.serving)}</span><span style="display:flex;align-items:center;gap:8px"><input type="number" step="0.5" min="0" value="${ing.qty}" data-ing-qty="${i}" style="width:60px;min-height:32px;padding:0 6px;text-align:center">×<span data-ing-cal style="min-width:52px;text-align:right">${Math.round((ing.calories || 0) * ing.qty)} cal</span></span></div><div class="macroLine" data-ing-macros="${i}" style="margin-top:0">${ingredientMacroLine(ing, ing.qty)}</div></div>`,
      )
      .join("");
    return `<input data-edit-field="name" type="text" value="${esc(x.name)}" placeholder="Name">
      <div>${rows}</div>
      <div class="macroLine" data-ing-totals>${macroLine(Object.assign(sumIngredients(x.ingredients), { approx: x.approx }))}</div>
      <button class="submit" id="saveFoodIngredients" style="margin-top:0" type="button">Save</button>`;
  }
  const WAIST_DAY = 0; // 0=Sunday .. 6=Saturday
  const WAIST_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function showBody() {
    stopTimer();
    if (active()) saveActive();
    phase = "body";
    const d = dayKey(),
      isWaistDay = effectiveNow().getDay() === WAIST_DAY,
      tw = db.weightLogs.find((x) => x.date === d),
      lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lwa = db.waistLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const waistBlock = isWaistDay
      ? `<form id="waistForm" class="form"><strong>Weekly waist</strong><input id="waistInput" type="number" inputmode="decimal" min="20" max="80" step="0.1" value="${db.waistLogs.find((x) => x.date === d) ? db.waistLogs.find((x) => x.date === d).waist : ""}" placeholder="Waist at navel (in)" required><button class="submit" type="submit">Save</button></form>`
      : `<div class="form"><strong>Weekly waist</strong><div class="note" style="margin-top:8px">Logged ${WAIST_DAY_NAMES[WAIST_DAY]}s. ${lwa ? `Last: ${Number(lwa.waist).toFixed(1)} in on ${esc(lwa.date)}.` : "Not logged yet."}</div></div>`;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Body</div><button id="bodyBack" class="btn" type="button">Back</button></div><div class="metrics" style="grid-template-columns:1fr 1fr"><div class="metric"><div class="metricName">Latest weight</div><div class="metricVal">${lw ? Number(lw.weight).toFixed(1) : "—"}</div><div>lb</div></div><div class="metric"><div class="metricName">Latest waist</div><div class="metricVal">${lwa ? Number(lwa.waist).toFixed(1) : "—"}</div><div>in</div></div></div><div class="bodyForms"><form id="weightForm" class="form"><strong>Daily weight</strong><input id="weightInput" type="number" inputmode="decimal" min="100" max="400" step="0.1" value="${tw ? tw.weight : ""}" placeholder="Weight (lb)" required><button class="submit" type="submit">Save</button></form>${waistBlock}</div><div class="list">${renderBody()}</div></section>`;
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
    if (isWaistDay) {
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
    }
    stage.querySelectorAll("[data-delete-body]").forEach((b) =>
      b.addEventListener("click", () => {
        const [kind, date] = b.dataset.deleteBody.split("|");
        const arr = kind === "weight" ? db.weightLogs : db.waistLogs;
        const idx = arr.findIndex((x) => x.date === date);
        if (idx === -1) return;
        const [removed] = arr.splice(idx, 1);
        saveDB();
        showBody();
        showUndoToast(`Deleted ${kind} · ${date}`, () => {
          arr.splice(idx, 0, removed);
          saveDB();
          if (phase === "body") showBody();
        });
      }),
    );
    armBackgroundTimer();
  }
  function renderBody() {
    const items = [
      ...db.weightLogs.map((x) => ({ kind: "weight", date: x.date, text: `${Number(x.weight).toFixed(1)} lb` })),
      ...db.waistLogs.map((x) => ({ kind: "waist", date: x.date, text: `${Number(x.waist).toFixed(1)} in (waist)` })),
    ].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === b.kind ? 0 : a.kind === "weight" ? -1 : 1));
    if (!items.length) return `<div class="bodyRow">No measurements yet.</div>`;
    return items
      .map(
        (it) =>
          `<div class="bodyRow"><strong>${esc(it.date)}</strong><span style="display:flex;align-items:center;gap:10px">${it.text}<button class="delete" data-delete-body="${it.kind}|${esc(it.date)}" type="button" aria-label="Delete">×</button></span></div>`,
      )
      .join("");
  }
  function estimateCardioCalories(c) {
    const lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const kg = lw && Number.isFinite(Number(lw.weight)) ? Number(lw.weight) * 0.453592 : 79.4;
    let met;
    if (c.machine === "treadmill") {
      const speed = c.speed || (c.mode === "walk" ? 3 : 5.5);
      const grade = (c.incline || 0) / 100;
      const speedMmin = speed * 26.8224;
      const isWalk = c.mode === "walk" || speed < 4;
      const vo2 = isWalk ? 0.1 * speedMmin + 1.8 * speedMmin * grade + 3.5 : 0.2 * speedMmin + 0.9 * speedMmin * grade + 3.5;
      met = vo2 / 3.5;
    } else {
      const r = c.resistance || 10;
      met = r <= 8 ? 5.5 : r <= 16 ? 7 : r <= 24 ? 9 : 11;
    }
    return Math.round(met * kg * (c.duration / 60));
  }
  function formatCardioLine(c) {
    const parts = [`${c.duration} min`];
    if (c.machine === "treadmill") {
      if (c.speed) parts.push(`${c.speed} mph`);
      if (c.incline) parts.push(`${c.incline}% incline`);
      parts.push(`~${estimateCardioCalories(c)} cal`);
      return `${c.mode === "walk" ? "Walk" : "Run"} · ${parts.join(" · ")}`;
    }
    if (c.resistance) parts.push(`resistance ${c.resistance}`);
    if (c.distance) parts.push(`${c.distance} mi`);
    parts.push(`~${estimateCardioCalories(c)} cal`);
    return `Bike · ${parts.join(" · ")}`;
  }
  function showCardio() {
    stopTimer();
    if (active()) saveActive();
    phase = "cardio";
    const isTread = cardioMachine === "treadmill";
    const fields = isTread
      ? `<div class="tabs" style="grid-template-columns:repeat(2,1fr)"><button type="button" data-mode="walk" class="${cardioMode === "walk" ? "active" : ""}">Walk</button><button type="button" data-mode="run" class="${cardioMode === "run" ? "active" : ""}">Run</button></div><input id="cardioDuration" type="number" inputmode="decimal" min="1" max="300" placeholder="Duration (min)" required><input id="cardioSpeed" type="number" inputmode="decimal" step="0.1" min="0" max="15" placeholder="Speed (mph)"><input id="cardioIncline" type="number" inputmode="decimal" step="0.5" min="0" max="20" placeholder="Incline (%)">`
      : `<input id="cardioDuration" type="number" inputmode="decimal" min="1" max="300" placeholder="Duration (min)" required><input id="cardioResistance" type="number" inputmode="decimal" min="1" max="30" placeholder="Resistance level"><input id="cardioDistance" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Distance (mi, optional)">`;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Cardio</div><button id="cardioBack" class="btn" type="button">Back</button></div><div class="tabs" style="grid-template-columns:repeat(2,1fr)"><button data-machine="treadmill" class="${isTread ? "active" : ""}" type="button">Treadmill</button><button data-machine="bike" class="${!isTread ? "active" : ""}" type="button">Bike</button></div><form id="cardioForm" class="form" style="display:flex;flex-direction:column;gap:8px">${fields}<button class="submit" type="submit">Save</button></form><div class="list">${renderCardioList()}</div></section>`;
    stage.querySelector("#cardioBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-machine]").forEach((b) =>
      b.addEventListener("click", () => {
        cardioMachine = b.dataset.machine;
        showCardio();
      }),
    );
    if (isTread) {
      stage.querySelectorAll("[data-mode]").forEach((b) =>
        b.addEventListener("click", () => {
          cardioMode = b.dataset.mode;
          showCardio();
        }),
      );
    }
    stage.querySelector("#cardioForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const duration = Number(stage.querySelector("#cardioDuration").value);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const entry = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        ts: Date.now(),
        date: dayKey(),
        machine: cardioMachine,
        duration,
      };
      if (isTread) {
        entry.mode = cardioMode;
        const speed = Number(stage.querySelector("#cardioSpeed").value);
        const incline = Number(stage.querySelector("#cardioIncline").value);
        if (Number.isFinite(speed) && speed > 0) entry.speed = speed;
        if (Number.isFinite(incline) && incline > 0) entry.incline = incline;
      } else {
        const resistance = Number(stage.querySelector("#cardioResistance").value);
        const distance = Number(stage.querySelector("#cardioDistance").value);
        if (Number.isFinite(resistance) && resistance > 0) entry.resistance = resistance;
        if (Number.isFinite(distance) && distance > 0) entry.distance = distance;
      }
      db.cardioLogs.push(entry);
      saveDB();
      showCardio();
    });
    stage.querySelectorAll("[data-delete-cardio]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.deleteCardio;
        const idx = db.cardioLogs.findIndex((x) => String(x.id) === id);
        if (idx === -1) return;
        const [removed] = db.cardioLogs.splice(idx, 1);
        saveDB();
        showCardio();
        showUndoToast(`Deleted ${formatCardioLine(removed)}`, () => {
          db.cardioLogs.splice(idx, 0, removed);
          saveDB();
          if (phase === "cardio") showCardio();
        });
      }),
    );
    armBackgroundTimer();
  }
  function renderCardioList() {
    const rows = db.cardioLogs.slice().sort((a, b) => b.ts - a.ts);
    if (!rows.length) return `<div class="setRow">No cardio yet.</div>`;
    return rows
      .map(
        (c) =>
          `<div class="setRow"><div><strong>${esc(c.date)}</strong><div>${esc(formatCardioLine(c))}</div></div><button class="delete" data-delete-cardio="${c.id}" type="button" aria-label="Delete">×</button></div>`,
      )
      .join("");
  }
  function showHistory() {
    stopTimer();
    if (active()) saveActive();
    phase = "history";
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">History</div><button id="historyBack" class="btn" type="button">Back</button></div><div class="list">${db.workoutLogs.length ? db.workoutLogs.slice().reverse().map((l) => `<div class="setRow" data-view-workout="${l.id}" style="cursor:pointer"><div><strong>${esc(l.name)}</strong><div>${new Date(l.date).toLocaleDateString()}</div></div><div style="display:flex;align-items:center;gap:10px"><span>${l.sets.length} sets</span><button class="delete" data-delete-workout="${l.id}" type="button" aria-label="Delete">×</button></div></div>`).join("") : `<div class="setRow">No workouts yet.</div>`}</div></section>`;
    stage.querySelector("#historyBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-view-workout]").forEach((el) =>
      el.addEventListener("click", () => showWorkoutDetail(el.dataset.viewWorkout)),
    );
    stage.querySelectorAll("[data-delete-workout]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
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
  function showWorkoutDetail(id) {
    stopTimer();
    phase = "workoutDetail";
    const log = db.workoutLogs.find((l) => String(l.id) === String(id));
    if (!log) return showHistory();
    const groups = [];
    const byId = {};
    log.sets.forEach((s, i) => {
      if (!byId[s.id]) {
        byId[s.id] = { name: s.name, sets: [] };
        groups.push(byId[s.id]);
      }
      byId[s.id].sets.push({ ...s, idx: i });
    });
    const rows = groups
      .map(
        (g) =>
          `<div class="setRow" style="flex-direction:column;align-items:flex-start;gap:6px"><strong>${esc(g.name)}</strong>${g.sets
            .map(
              (s) =>
                `<div style="display:flex;align-items:center;gap:6px;width:100%" data-set-row="${s.idx}"><span style="min-width:42px">Set ${s.set}:</span><input type="number" step="0.5" min="0" value="${s.weight}" data-set-weight="${s.idx}" style="width:64px;min-height:32px;padding:0 6px;text-align:center">lb ×<input type="number" step="1" min="0" value="${s.reps}" data-set-reps="${s.idx}" style="width:52px;min-height:32px;padding:0 6px;text-align:center"><button class="delete" data-remove-set="${s.idx}" type="button" aria-label="Remove set">×</button></div>`,
            )
            .join("")}</div>`,
      )
      .join("");
    const addForm = db.exerciseArchive.length
      ? `<form id="addSetForm" class="form" style="display:flex;flex-direction:column;gap:8px;margin:8px">
          <strong>Add exercise</strong>
          <select id="addSetExercise">${db.exerciseArchive.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input id="addSetWeight" type="number" step="0.5" min="0" placeholder="Weight (lb, 0=BW)">
            <input id="addSetReps" type="number" step="1" min="0" placeholder="Reps" required>
          </div>
          <button class="submit" style="margin-top:0" type="submit">Add set</button>
        </form>`
      : "";
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">${esc(log.name)}</div><button id="detailBack" class="btn" type="button">Back</button></div><div class="list">${rows}${addForm}<button class="submit" id="saveWorkoutDetail" style="margin:8px" type="button">Save</button></div></section>`;
    stage.querySelector("#detailBack").addEventListener("click", showHistory);
    stage.querySelector("#saveWorkoutDetail").addEventListener("click", () => {
      log.sets = log.sets.map((s, i) => {
        const wEl = stage.querySelector(`[data-set-weight="${i}"]`);
        const rEl = stage.querySelector(`[data-set-reps="${i}"]`);
        const weight = wEl ? Number(wEl.value) : s.weight;
        const reps = rEl ? Number(rEl.value) : s.reps;
        return {
          ...s,
          weight: Number.isFinite(weight) && weight >= 0 ? weight : s.weight,
          reps: Number.isFinite(reps) && reps >= 0 ? reps : s.reps,
        };
      });
      saveDB();
      showHistory();
    });
    stage.querySelectorAll("[data-remove-set]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.removeSet);
        const [removed] = log.sets.splice(i, 1);
        saveDB();
        showWorkoutDetail(id);
        showUndoToast(`Removed set ${removed.set} of ${removed.name}`, () => {
          log.sets.splice(i, 0, removed);
          saveDB();
          if (phase === "workoutDetail") showWorkoutDetail(id);
        });
      }),
    );
    const addSetForm = stage.querySelector("#addSetForm");
    if (addSetForm) {
      addSetForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const exId = stage.querySelector("#addSetExercise").value;
        const ex = db.exerciseArchive.find((a) => a.id === exId);
        if (!ex) return;
        const weight = Number(stage.querySelector("#addSetWeight").value) || 0;
        const reps = Number(stage.querySelector("#addSetReps").value);
        if (!Number.isFinite(reps) || reps <= 0) return;
        const setNum = log.sets.filter((s) => s.id === exId).length + 1;
        log.sets.push({ id: exId, name: ex.name, set: setNum, weight, reps });
        saveDB();
        showWorkoutDetail(id);
      });
    }
    armBackgroundTimer();
  }
  function slugify(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "exercise";
    let id = base,
      n = 2;
    while (db.exerciseArchive.some((x) => x.id === id)) {
      id = base + n;
      n++;
    }
    return id;
  }
  function showWorkoutEditor() {
    stopTimer();
    if (active()) saveActive();
    phase = "editor";
    swappingExIdx = null;
    renderWorkoutEditor();
  }
  function renderWorkoutEditor() {
    const day = db.templates[editorDay];
    const inDay = new Set(day.ex.map((x) => x[0]));
    const available = db.exerciseArchive.filter((a) => !inDay.has(a.id));
    const rows = day.ex
      .map((ex, i) => {
        if (i === swappingExIdx) {
          return `<div class="setRow" style="flex-direction:column;align-items:stretch;gap:8px"><strong>Swap ${esc(ex[1])} for…</strong><select id="swapPick">${available.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select><div style="display:flex;gap:8px"><button class="submit" style="margin-top:0" data-confirm-swap="${i}" type="button">Confirm</button><button class="btn" data-cancel-swap type="button">Cancel</button></div></div>`;
        }
        return `<div class="setRow"><div><strong>${esc(ex[1])}</strong><div>${ex[2]} reps · ${ex[3]}s rest</div></div><div style="display:flex;gap:8px"><button class="btn" data-swap-ex="${i}" type="button">Swap</button><button class="delete" data-remove-ex="${i}" type="button" aria-label="Remove">×</button></div></div>`;
      })
      .join("");
    const addOptions = available.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Edit Workouts</div><button id="editorBack" class="btn" type="button">Back</button></div><div class="tabs" style="grid-template-columns:repeat(3,1fr)"><button data-day="A" class="${editorDay === "A" ? "active" : ""}" type="button">A</button><button data-day="B" class="${editorDay === "B" ? "active" : ""}" type="button">B</button><button data-day="C" class="${editorDay === "C" ? "active" : ""}" type="button">C</button></div><div class="library">${rows || `<div class="setRow">No exercises — add one below.</div>`}<form id="addFromArchiveForm" class="form" style="display:flex;flex-direction:column;gap:8px"><strong>Add from archive</strong>${available.length ? `<select id="archivePick">${addOptions}</select><button class="submit" type="submit">Add</button>` : `<div class="note">Every archived exercise is already in ${editorDay}.</div>`}</form><form id="addCustomForm" class="form" style="display:flex;flex-direction:column;gap:8px"><strong>New custom exercise</strong><input id="newExName" type="text" placeholder="Name" required><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input id="newExTarget" type="number" inputmode="decimal" value="12" placeholder="Target reps"><input id="newExRest" type="number" inputmode="decimal" value="90" placeholder="Rest (sec)"></div><select id="newExType"><option value="upper">Upper body</option><option value="lower">Lower body</option><option value="small">Small / isolation</option><option value="body">Bodyweight</option></select><button class="submit" type="submit">Add to archive + ${editorDay}</button></form></div></section>`;
    stage.querySelector("#editorBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-day]").forEach((b) =>
      b.addEventListener("click", () => {
        editorDay = b.dataset.day;
        swappingExIdx = null;
        renderWorkoutEditor();
      }),
    );
    stage.querySelectorAll("[data-swap-ex]").forEach((b) =>
      b.addEventListener("click", () => {
        swappingExIdx = Number(b.dataset.swapEx);
        renderWorkoutEditor();
      }),
    );
    stage.querySelectorAll("[data-cancel-swap]").forEach((b) =>
      b.addEventListener("click", () => {
        swappingExIdx = null;
        renderWorkoutEditor();
      }),
    );
    stage.querySelectorAll("[data-confirm-swap]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.confirmSwap);
        const pick = stage.querySelector("#swapPick")?.value;
        const a = db.exerciseArchive.find((x) => x.id === pick);
        if (!a) return;
        db.templates[editorDay].ex[i] = [a.id, a.name, a.target, a.rest, a.type];
        swappingExIdx = null;
        saveDB();
        renderWorkoutEditor();
      }),
    );
    stage.querySelectorAll("[data-remove-ex]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.removeEx);
        const d = db.templates[editorDay];
        const [removed] = d.ex.splice(i, 1);
        saveDB();
        renderWorkoutEditor();
        showUndoToast(`Removed ${removed[1]} from ${editorDay}`, () => {
          d.ex.splice(i, 0, removed);
          saveDB();
          if (phase === "editor") renderWorkoutEditor();
        });
      }),
    );
    const archiveForm = stage.querySelector("#addFromArchiveForm");
    if (available.length) {
      archiveForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const pick = stage.querySelector("#archivePick")?.value;
        const a = db.exerciseArchive.find((x) => x.id === pick);
        if (!a) return;
        db.templates[editorDay].ex.push([a.id, a.name, a.target, a.rest, a.type]);
        saveDB();
        renderWorkoutEditor();
      });
    }
    stage.querySelector("#addCustomForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (stage.querySelector("#newExName").value || "").trim();
      if (!name) return;
      const target = Number(stage.querySelector("#newExTarget").value) || 12;
      const rest = Number(stage.querySelector("#newExRest").value) || 90;
      const type = stage.querySelector("#newExType").value;
      const id = slugify(name);
      db.exerciseArchive.push({ id, name, target, rest, type });
      db.templates[editorDay].ex.push([id, name, target, rest, type]);
      saveDB();
      renderWorkoutEditor();
    });
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

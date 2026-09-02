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
        db = withDefaults(remote);
        const migrated = runMigrations();
        ensureTemplates();
        persistLocal();
        if (migrated) await ghPut(db);
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
    calories: { min: 1900, max: 2050 },
    protein: { min: 170 },
    carbs: { min: 140 },
    fat: { min: 50 },
    fiber: { min: 18 },
  };
  function targetLabel(key) {
    const t = targets[key];
    if (!t) return "";
    const unit = key === "calories" ? "" : "g";
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
    peasbirdseye: {
      name: "Peas (Birds Eye)",
      serving: "g",
      calories: 0.8046,
      protein: 0.046,
      carbs: 0.1379,
      fat: 0,
      sodium: 0,
      fiber: 0.046,
      other: "Per-gram values from label: 2/3 cup (87g) frozen = 70 cal, 12g carb, 4g fiber, 4g sugar, 4g protein, 0mg sodium.",
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
    broccolislawtaylorfarms: {
      name: "Broccoli Slaw (Taylor Farms)",
      serving: "1 cup (85g)",
      calories: 30,
      protein: 2,
      carbs: 6,
      fat: 0,
      sodium: 30,
      fiber: 2,
      other: "Per label: 1 cup (85g) = 30 cal, 2g sugar, 270mg potassium, 40mg calcium, 60mg vitamin C, 80mcg vitamin K. 4 cups per bag. Broccoli, carrot, red cabbage.",
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
      id: "chicken-honey-mustard-slaw-salad",
      name: "Chicken Honey Mustard Slaw Salad",
      serving: "170g chicken, 2 cups broccoli slaw, honey mustard dressing",
      calories: 454,
      protein: 37.1,
      carbs: 46.1,
      fat: 13,
      sodium: 1316,
      fiber: 6,
      approx: true,
      note: "The chicken honey mustard wrap as a salad — broccoli slaw is the base instead of lettuce leaves. Slaw defaults to 2 cups (170g, half a bag); edit its qty in cups. Chicken is a per-gram ingredient — edit its qty to the exact grams you used and the total recalculates. Default here is 170g (~6 oz, 2 tenders).",
      ingredientIds: [["chickentenderbare", 170], ["broccolislawtaylorfarms", 2], "tomatomedium", "redonionquartercup", "honeymustarddressing"],
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
      note: "Totals are the exact sum of the 13 listed ingredients (peas default to 0g and aren't counted). Beef is gram-adjustable (like the chicken wrap) — default is ½ lb (227g) cooked; edit its qty to your exact amount. To swap peas for edamame, set edamame's qty to 0 and peas' qty to however many grams you want (one serving is 87g) in the ingredient editor.",
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
        ["peasbirdseye", 0],
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
    {
      id: "brothers-cousins-carnitas-burrito",
      name: "Brothers Cousins Carnitas Burrito",
      serving: "1 burrito",
      calories: 1165,
      protein: 66,
      carbs: 122,
      fat: 50,
      sodium: 2375,
      fiber: 12,
      approx: true,
      note: "Restaurant item, estimated. 18g of the 50g fat is saturated (not tracked separately).",
    },
    {
      id: "jersey-mikes-italian-no-mayo",
      name: "Jersey Mike's Italian (no mayo)",
      serving: "1 sub, no mayo",
      calories: 960,
      protein: 46.9,
      carbs: 72,
      fat: 54.5,
      sodium: 2824,
      fiber: 4.7,
      note: "Totals from the Jersey Mike's nutrition calculator for the sub as ordered, no mayo: 960 cal, 54.52g fat (14.21g saturated, 0.36g trans), 92.38mg cholesterol, 2,823.62mg sodium, 71.99g carb, 4.69g fiber, 10.03g sugar, 46.87g protein.",
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
      serving: "1 container (150g)",
      calories: 80,
      protein: 15,
      carbs: 6,
      fat: 0,
      sodium: 55,
      fiber: 0,
      note: "Per label (Vanilla, 4-pack): 10mg cholesterol, 5g sugar (0g added), 150mg calcium, 2mcg vitamin D, 150mg potassium.",
    },
    {
      id: "frozengreekyogurtbar",
      name: "Frozen Greek Yogurt Fudge Bar",
      serving: "1 bar (65g)",
      calories: 80,
      protein: 5,
      carbs: 15,
      fat: 0,
      sodium: 55,
      fiber: 0.5,
      note: "Per label: 1 bar (65g) = 80 cal, <5mg cholesterol, 12g sugar (8g added), 100mg calcium, 1.3mg iron, 190mg potassium. Fiber reads <1g on the label and is recorded as 0.5. 4 bars per box. Nonfat milk and nonfat Greek yogurt base with cocoa; made by The Magnum Ice Cream Company.",
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
      id: "monsterzerosugar",
      name: "Monster Zero Sugar (Carnitine)",
      serving: "1 can",
      calories: 10,
      protein: 0,
      carbs: 6,
      fat: 0,
      sodium: 380,
      fiber: 0,
      note: "Per label: 6g total carb (0g sugar, 0g added sugar), 2g erythritol.",
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
  // Exercise metadata. `equip` is how the movement is loaded; `mode` is whether
  // the number you dial in is the total load or the load on each side (plate-
  // loaded machines) / in each hand (dumbbells). Both are editable per exercise
  // in Edit Workouts — these are just the shipped defaults.
  const EQUIP_LABEL = {
    machine: "Machine",
    cable: "Cable",
    dumbbell: "Dumbbell",
    barbell: "Barbell",
    bodyweight: "Bodyweight",
  };
  const EXERCISE_META = {
    legpress: { name: "Leg press", equip: "machine", mode: "perSide" },
    chestpress: { name: "Chest press", equip: "machine", mode: "total" },
    row: { name: "Seated row", equip: "machine", mode: "total" },
    legcurl: { name: "Seated leg curl", equip: "machine", mode: "total" },
    biceps: { name: "Biceps curl", equip: "machine", mode: "total" },
    triceps: { name: "Triceps pressdown", equip: "cable", mode: "total" },
    abs: { name: "Ab crunch", equip: "machine", mode: "total" },
    hacksquat: { name: "Hack squat", equip: "machine", mode: "perSide" },
    pulldown: { name: "Lat pulldown", equip: "machine", mode: "total" },
    shoulderpress: { name: "Shoulder press", equip: "machine", mode: "total" },
    pecdeck: { name: "Pec fly", equip: "machine", mode: "total" },
    lateral: { name: "Lateral raise", equip: "dumbbell", mode: "perSide" },
    cablecurl: { name: "Cable biceps curl", equip: "cable", mode: "total" },
    kneeraise: { name: "Knee raise", equip: "bodyweight", mode: "total" },
    inclinepress: { name: "Incline chest press", equip: "machine", mode: "total" },
    supportedrow: { name: "Chest-supported row", equip: "machine", mode: "total" },
    legextension: { name: "Leg extension", equip: "machine", mode: "total" },
    reversepec: { name: "Reverse pec fly", equip: "machine", mode: "total" },
    preachercurl: { name: "Preacher curl", equip: "machine", mode: "total" },
    overheadtri: { name: "Overhead triceps extension", equip: "cable", mode: "total" },
  };
  function metaEx(id, target, rest, type) {
    const m = EXERCISE_META[id] || {};
    return [id, m.name || id, target, rest, type, m.equip || "machine", m.mode || "total"];
  }
  // A = Monday, B = Wednesday, C = Friday. The three sessions were rotated one
  // slot in Aug 2026 (old C → A, old A → B, old B → C) and renamed so the
  // letters still run in weekday order; migrateDb() does the same to saved data.
  const DEFAULT_TEMPLATES = {
    A: {
      name: "Workout A",
      ex: [
        metaEx("legpress", 12, 120, "lower"),
        metaEx("inclinepress", 12, 120, "upper"),
        metaEx("supportedrow", 12, 120, "upper"),
        metaEx("legextension", 15, 90, "lower2"),
        metaEx("reversepec", 15, 75, "small"),
        metaEx("preachercurl", 15, 75, "small"),
        metaEx("overheadtri", 15, 75, "small"),
        metaEx("abs", 15, 75, "small"),
      ],
    },
    B: {
      name: "Workout B",
      ex: [
        metaEx("legpress", 12, 120, "lower"),
        metaEx("chestpress", 12, 120, "upper"),
        metaEx("row", 12, 120, "upper"),
        metaEx("legcurl", 15, 90, "lower2"),
        metaEx("biceps", 15, 75, "small"),
        metaEx("triceps", 15, 75, "small"),
        metaEx("abs", 15, 75, "small"),
      ],
    },
    C: {
      name: "Workout C",
      ex: [
        metaEx("hacksquat", 12, 120, "lower"),
        metaEx("pulldown", 12, 120, "upper"),
        metaEx("shoulderpress", 12, 120, "upper"),
        metaEx("pecdeck", 15, 90, "small"),
        metaEx("lateral", 15, 75, "small"),
        metaEx("cablecurl", 15, 75, "small"),
        metaEx("kneeraise", 15, 75, "body"),
      ],
    },
  };
  // One-time reshapes of saved data. Each runs once per device/dataset and is
  // recorded in db.migrations so it never re-applies (a fresh install starts
  // with them all marked done, since the shipped defaults already reflect them).
  const MIGRATIONS = {
    // Shift the split one slot: Monday now runs what used to be Workout C.
    // The letters are reassigned so A/B/C still read Mon/Wed/Fri in order.
    dayRotation2026(d) {
      const t = d.templates;
      if (!t || !t.A || !t.B || !t.C) return;
      const rotated = { A: t.C.ex, B: t.A.ex, C: t.B.ex };
      ["A", "B", "C"].forEach((k) => {
        t[k].ex = rotated[k];
      });
    },
  };
  function freshDB() {
    const migrations = {};
    Object.keys(MIGRATIONS).forEach((k) => (migrations[k] = true));
    return {
      foodLogs: [],
      weightLogs: [],
      waistLogs: [],
      creatineLogs: [],
      workoutLogs: [],
      cardioLogs: [],
      liftHistory: {},
      activeWorkout: null,
      migrations,
    };
  }
  function withDefaults(x) {
    return Object.assign(
      {
        foodLogs: [],
        weightLogs: [],
        waistLogs: [],
        creatineLogs: [],
        workoutLogs: [],
        cardioLogs: [],
        liftHistory: {},
        activeWorkout: null,
      },
      x,
    );
  }
  function loadDB() {
    try {
      const x = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (x) return withDefaults(x);
    } catch (e) {}
    return freshDB();
  }
  function runMigrations() {
    if (!db.migrations) db.migrations = {};
    let ran = false;
    Object.keys(MIGRATIONS).forEach((k) => {
      if (db.migrations[k]) return;
      MIGRATIONS[k](db);
      db.migrations[k] = true;
      ran = true;
    });
    return ran;
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
      t.ex.forEach(([id, name, target, rest, type, equip, mode]) => {
        if (seen[id]) return;
        seen[id] = true;
        arr.push({ id, name, target, rest, type, equip, mode });
      }),
    );
    return arr;
  }
  // Exercises saved before equipment / per-side tracking existed get backfilled
  // from EXERCISE_META; custom exercises keep whatever the user typed.
  function normalizeEx(id, name, equip, mode) {
    const m = EXERCISE_META[id];
    return {
      name: m ? m.name : name || id,
      equip: equip || (m ? m.equip : "machine"),
      mode: mode || (m ? m.mode : "total"),
    };
  }
  function ensureTemplates() {
    if (!db.templates) db.templates = cloneTemplates(DEFAULT_TEMPLATES);
    if (!db.exerciseArchive) db.exerciseArchive = buildDefaultArchive();
    db.exerciseArchive.forEach((a) => Object.assign(a, normalizeEx(a.id, a.name, a.equip, a.mode)));
    const known = new Set(db.exerciseArchive.map((a) => a.id));
    Object.values(db.templates).forEach((t) => {
      t.ex = (t.ex || []).map((ex) => {
        const m = normalizeEx(ex[0], ex[1], ex[5], ex[6]);
        if (!known.has(ex[0])) {
          known.add(ex[0]);
          db.exerciseArchive.push({ id: ex[0], name: m.name, target: ex[2], rest: ex[3], type: ex[4], equip: m.equip, mode: m.mode });
        }
        return [ex[0], m.name, ex[2], ex[3], ex[4], m.equip, m.mode];
      });
    });
  }
  let db = loadDB();
  const didMigrate = runMigrations();
  ensureTemplates();
  // Record the migration immediately, otherwise the next load would re-run it
  // against data that has already been reshaped.
  if (didMigrate) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {}
  }
  let cardioMachine = "treadmill";
  let editorDay = "A";
  let newExEquip = "machine";
  let newExMode = "total";
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
  function num(v) {
    return Math.round(v || 0).toLocaleString("en-US");
  }

  // --- Dates -------------------------------------------------------------
  // Everything user-facing goes through fmtDay/fmtDayTime so a date reads the
  // same on every screen: "Today", "Yesterday", or "Wed, Aug 26".
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function dayKeyOf(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function dayKeyFromTs(ts) {
    return dayKeyOf(new Date(ts - DAY_ROLLOVER_HOUR * 60 * 60 * 1000));
  }
  function parseDayKey(s) {
    const [y, m, d] = String(s || "").split("-").map(Number);
    if (!y || !m || !d) return new Date(NaN);
    return new Date(y, m - 1, d);
  }
  function addDays(dateStr, n) {
    const d = parseDayKey(dateStr);
    d.setDate(d.getDate() + n);
    return dayKeyOf(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseDayKey(b) - parseDayKey(a)) / 86400000);
  }
  function fmtDay(dateStr, opts) {
    const o = opts || {};
    const d = parseDayKey(dateStr);
    if (Number.isNaN(d.valueOf())) return String(dateStr || "—");
    const today = dayKey();
    if (o.relative !== false) {
      if (dateStr === today) return "Today";
      if (dateStr === addDays(today, -1)) return "Yesterday";
      if (o.relative === "near" && dateStr === addDays(today, 1)) return "Tomorrow";
    }
    const sameYear = d.getFullYear() === parseDayKey(today).getFullYear();
    return d.toLocaleDateString("en-US", {
      weekday: o.weekday === false ? undefined : "short",
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
  }
  function fmtDayShort(dateStr) {
    return fmtDay(dateStr, { relative: false, weekday: false });
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function fmtDayTime(ts) {
    const t = typeof ts === "number" ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return "—";
    return `${fmtDay(dayKeyFromTs(t))} · ${fmtTime(t)}`;
  }
  function fmtMinutes(mins) {
    const m = Math.max(0, Math.round(mins || 0));
    return m >= 60 ? `${Math.floor(m / 60)}h ${pad2(m % 60)}m` : `${m}m`;
  }

  // --- Charts ------------------------------------------------------------
  // Inline SVG, no dependencies (the app has no build step and runs offline).
  // Colors come from CSS custom properties so light/dark swap in one place.
  const CHART_W = 360;
  let chartSpecs = {};
  let chartSeq = 0;
  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    if (!(raw > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function emptyBlock(msg) {
    return `<div class="empty" style="border:0;background:transparent;padding:18px 0">${esc(msg)}</div>`;
  }
  // cfg: { days:[dayKey], bars:{label,color,values}, lines:[{label,color,values,dash,dots}],
  //        band:{min,max,label}, refs:[{label,value,dash}], fmt, unit, zero, height, empty }
  function timeChart(cfg) {
    const days = cfg.days || [];
    const lines = (cfg.lines || []).filter((l) => l && l.values);
    const bars = cfg.bars && cfg.bars.values ? cfg.bars : null;
    const refs = cfg.refs || [];
    const fmt = cfg.fmt || num;
    let vals = [];
    if (bars) vals = vals.concat(bars.values);
    lines.forEach((l) => (vals = vals.concat(l.values)));
    vals = vals.filter((v) => Number.isFinite(v));
    if (!days.length || !vals.length) return emptyBlock(cfg.empty || "Not enough data yet.");

    const bounds = vals.slice();
    if (cfg.band) bounds.push(cfg.band.min, cfg.band.max);
    refs.forEach((r) => bounds.push(r.value));
    const h = cfg.height || 160;
    const padL = 36,
      padR = 12,
      padT = 10,
      padB = 18;
    const plotW = CHART_W - padL - padR;
    const plotH = h - padT - padB;
    let lo = Math.min(...bounds),
      hi = Math.max(...bounds);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const padY = (hi - lo) * 0.12;
    hi += padY;
    lo = cfg.zero ? 0 : lo - padY;
    const step = niceStep(hi - lo, 3);
    lo = cfg.zero ? 0 : Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
    const slot = plotW / days.length;
    const X = (i) => padL + slot * (i + 0.5);
    const baseline = padT + plotH;

    let grid = "";
    for (let v = lo; v <= hi + step / 1000; v += step) {
      const y = Y(v).toFixed(1);
      grid += `<line x1="${padL}" x2="${CHART_W - padR}" y1="${y}" y2="${y}" style="stroke:var(--ch-grid);stroke-width:1"/><text x="${padL - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" style="fill:var(--muted);font-size:9px;font-weight:800">${fmt(v)}</text>`;
    }
    let bandEl = "";
    if (cfg.band) {
      const yTop = Y(cfg.band.max),
        yBot = Y(cfg.band.min);
      bandEl = `<rect x="${padL}" y="${yTop.toFixed(1)}" width="${plotW}" height="${Math.max(1, yBot - yTop).toFixed(1)}" style="fill:var(--ch-band)"/>`;
    }
    const refEls = refs
      .map(
        (r) =>
          `<line x1="${padL}" x2="${CHART_W - padR}" y1="${Y(r.value).toFixed(1)}" y2="${Y(r.value).toFixed(1)}" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:${r.dash || "5 4"}"/>`,
      )
      .join("");

    const series = [];
    let barEls = "";
    if (bars) {
      const barW = Math.max(2, Math.min(slot - 2, 22));
      barEls = bars.values
        .map((v, i) =>
          Number.isFinite(v)
            ? `<rect x="${(X(i) - barW / 2).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, baseline - Y(v)).toFixed(1)}" rx="${Math.min(3, barW / 2).toFixed(1)}" style="fill:${bars.color}"/>`
            : "",
        )
        .join("");
      series.push(bars);
    }
    const lineEls = lines
      .map((l) => {
        let d = "",
          pen = false;
        l.values.forEach((v, i) => {
          if (!Number.isFinite(v)) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
          pen = true;
        });
        const dots = l.dots
          ? l.values
              .map((v, i) => (Number.isFinite(v) ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.4" style="fill:${l.color}"/>` : ""))
              .join("")
          : "";
        const path = d
          ? `<path d="${d.trim()}" fill="none" style="stroke:${l.color};stroke-width:${l.width || 2};stroke-linecap:round;stroke-linejoin:round${l.dash ? ";stroke-dasharray:" + l.dash : ""}"/>`
          : "";
        series.push(l);
        return path + dots;
      })
      .join("");

    const tickIdx = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])].filter((i) => i >= 0);
    const xLabels = tickIdx
      .map((i, n) => {
        const anchor = n === 0 ? "start" : n === tickIdx.length - 1 ? "end" : "middle";
        const x = n === 0 ? padL : n === tickIdx.length - 1 ? CHART_W - padR : X(i);
        return `<text x="${x.toFixed(1)}" y="${h - 5}" text-anchor="${anchor}" style="fill:var(--muted);font-size:9px;font-weight:800">${esc(fmtDayShort(days[i]))}</text>`;
      })
      .join("");

    const points = days.map((date, i) => {
      const marks = [];
      const parts = [];
      series.forEach((s) => {
        const v = s.values[i];
        if (Number.isFinite(v)) {
          marks.push({ x: X(i), y: Y(v), color: s.color });
          parts.push(`${s.label} ${fmt(v)}${cfg.unit ? " " + cfg.unit : ""}`);
        } else marks.push(null);
      });
      return { x: X(i), text: `${fmtDay(date)}${parts.length ? " · " + parts.join(" · ") : " · nothing logged"}`, marks };
    });
    const lastWithData = points.map((p, i) => (p.marks.some(Boolean) ? i : -1)).filter((i) => i >= 0).pop();
    const id = "c" + ++chartSeq;
    chartSpecs[id] = {
      padL,
      slot,
      w: CHART_W,
      points,
      defaultText: lastWithData >= 0 ? points[lastWithData].text : "No data in this range",
    };

    const markEls = series
      .map((s) => `<circle data-mark r="3.6" opacity="0" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>`)
      .join("");
    const legend = series
      .map((s) => `<span><i class="swatch ${s === bars ? "" : "line"}" style="background:${s.color}"></i>${esc(s.label)}</span>`)
      .concat(cfg.band ? [`<span><i class="swatch" style="background:var(--ch-band)"></i>${esc(cfg.band.label)}</span>`] : [])
      .concat(refs.map((r) => `<span style="color:var(--muted)"><i class="swatch dash"></i><span>${esc(r.label)}</span></span>`))
      .join("");

    return `<div class="chartReadout" data-readout="${id}"></div><svg class="chart" data-chart="${id}" viewBox="0 0 ${CHART_W} ${h}" role="img" aria-label="${esc(cfg.aria || "Chart")}">${grid}${bandEl}${refEls}${barEls}${lineEls}<line data-cross y1="${padT}" y2="${baseline}" opacity="0" style="stroke:var(--muted);stroke-width:1"/>${markEls}${xLabels}</svg><div class="legend">${legend}</div>`;
  }
  function mountCharts() {
    const specs = chartSpecs;
    chartSpecs = {};
    Object.keys(specs).forEach((id) => {
      const svg = stage.querySelector(`[data-chart="${id}"]`);
      if (!svg) return;
      const spec = specs[id];
      const readout = stage.querySelector(`[data-readout="${id}"]`);
      const cross = svg.querySelector("[data-cross]");
      const marks = Array.from(svg.querySelectorAll("[data-mark]"));
      const reset = () => {
        if (cross) cross.setAttribute("opacity", "0");
        marks.forEach((m) => m.setAttribute("opacity", "0"));
        if (readout) readout.textContent = spec.defaultText;
      };
      const show = (i) => {
        const p = spec.points[i];
        if (!p) return;
        if (cross) {
          cross.setAttribute("x1", p.x.toFixed(1));
          cross.setAttribute("x2", p.x.toFixed(1));
          cross.setAttribute("opacity", "1");
        }
        marks.forEach((m, s) => {
          const mk = p.marks[s];
          if (!mk) return m.setAttribute("opacity", "0");
          m.setAttribute("cx", mk.x.toFixed(1));
          m.setAttribute("cy", mk.y.toFixed(1));
          m.setAttribute("opacity", "1");
        });
        if (readout) readout.textContent = p.text;
      };
      const at = (clientX) => {
        const r = svg.getBoundingClientRect();
        if (!r.width) return 0;
        const px = ((clientX - r.left) / r.width) * spec.w;
        return Math.max(0, Math.min(spec.points.length - 1, Math.floor((px - spec.padL) / spec.slot)));
      };
      svg.addEventListener("pointerdown", (e) => show(at(e.clientX)));
      svg.addEventListener("pointermove", (e) => {
        if (e.pointerType === "mouse" || e.buttons) show(at(e.clientX));
      });
      svg.addEventListener("pointerleave", reset);
      svg.addEventListener("pointercancel", reset);
      reset();
    });
  }
  // Rolling mean of the trailing `win` days, needs `minPts` real values to show.
  function rollingMean(values, win, minPts) {
    return values.map((_, i) => {
      let sum = 0,
        n = 0;
      for (let j = Math.max(0, i - win + 1); j <= i; j++) {
        if (Number.isFinite(values[j])) {
          sum += values[j];
          n++;
        }
      }
      return n >= (minPts || 1) ? sum / n : null;
    });
  }
  function dayRange(fromKeys, maxDays) {
    const keys = fromKeys.filter(Boolean).sort();
    if (!keys.length) return [];
    const end = dayKey();
    const span = Math.min(maxDays, Math.max(1, daysBetween(keys[0], end) + 1));
    const start = addDays(end, -(span - 1));
    const out = [];
    for (let d = start; daysBetween(d, end) >= 0; d = addDays(d, 1)) out.push(d);
    return out;
  }

  // --- Day-by-day activity (weight / food / lifts / cardio) ---------------
  const PLAN_LIFT_DAYS = [1, 3, 5]; // Mon / Wed / Fri per the plan
  const PLAN_CARDIO_DAYS = [2, 4]; // Tue / Thu
  const CARDIO_DAY_MIN = 30; // total minutes in a day for it to count as cardio
  // Estimated maintenance, used as the calorie chart's baseline: roughly
  // 13 kcal per lb of bodyweight for this training load, tracking the latest
  // weigh-in so the line moves as bodyweight does.
  const BASELINE_CAL_PER_LB = 13;
  function latestWeight() {
    const w = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    return w && Number.isFinite(Number(w.weight)) ? Number(w.weight) : null;
  }
  function baselineCalories() {
    const w = latestWeight();
    return w ? Math.round((w * BASELINE_CAL_PER_LB) / 10) * 10 : null;
  }
  function workoutLetter(log) {
    const m = /workout\s+([abc])/i.exec(log.name || "");
    return m ? m[1].toUpperCase() : "•";
  }
  function dayFacts() {
    const map = {};
    const get = (d) => (map[d] || (map[d] = { lifts: [], cardio: 0, cardioMin: 0, calories: 0, food: false, weight: null }));
    db.workoutLogs.forEach((l) => get(dayKeyFromTs(Date.parse(l.date))).lifts.push(workoutLetter(l)));
    db.cardioLogs.forEach((c) => {
      const f = get(c.date || dayKeyFromTs(c.ts));
      f.cardio++;
      f.cardioMin += c.duration || 0;
    });
    db.foodLogs.forEach((x) => {
      const f = get(x.date);
      f.calories += x.calories || 0;
      f.food = true;
    });
    db.weightLogs.forEach((w) => (get(w.date).weight = w.weight));
    Object.values(map).forEach((f) => {
      f.over = f.food && f.calories > targets.calories.max;
      f.cardioDay = f.cardioMin >= CARDIO_DAY_MIN;
    });
    return map;
  }

  // --- Activity calendar --------------------------------------------------
  let calMonth = null; // "YYYY-MM", lazily set to the month being viewed
  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function renderCalendarCard() {
    if (!calMonth) calMonth = dayKey().slice(0, 7);
    const facts = dayFacts();
    const [y, m] = calMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const total = new Date(y, m, 0).getDate();
    const today = dayKey();
    const dows = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const head = dows.map((d) => `<div class="calDow">${d}</div>`).join("");
    const blanks = Array.from({ length: first.getDay() }, () => `<div class="calCell blank"></div>`).join("");
    const tally = { lifts: 0, cardio: 0, over: 0, weighed: 0, elapsed: 0 };
    const cells = Array.from({ length: total }, (_, i) => {
      const d = i + 1;
      const key = `${calMonth}-${pad2(d)}`;
      const f = facts[key] || {};
      const wd = new Date(y, m - 1, d).getDay();
      const past = daysBetween(key, today) > 0;
      const lifts = f.lifts || [];
      const planned = PLAN_LIFT_DAYS.includes(wd) ? "lift" : PLAN_CARDIO_DAYS.includes(wd) ? "cardio" : null;
      const missed = past && ((planned === "lift" && !lifts.length) || (planned === "cardio" && !f.cardioDay));
      if (past || key === today) {
        tally.elapsed++;
        tally.lifts += lifts.length;
        if (f.cardioDay) tally.cardio++;
        if (f.over) tally.over++;
        if (f.weight != null) tally.weighed++;
      }
      const cls = ["calCell"];
      if (f.over) cls.push("over");
      if (missed) cls.push("missed");
      if (key === today) cls.push("today");
      const dots =
        (f.cardio
          ? `<i class="calDot${f.cardioDay ? "" : " partial"}" style="${f.cardioDay ? "background:var(--ch-3)" : "border-color:var(--ch-3)"}"></i>`
          : "") +
        (f.over ? `<i class="calDot" style="background:var(--ch-bad)"></i>` : "") +
        (f.weight != null ? `<i class="calDot" style="background:var(--muted)"></i>` : "");
      const notes = [];
      if (lifts.length) notes.push(`Workout ${lifts.join(" + ")}`);
      if (f.cardio) notes.push(`${fmtMinutes(f.cardioMin)} cardio${f.cardioDay ? "" : " (under " + CARDIO_DAY_MIN + " min)"}`);
      if (f.food) notes.push(`${num(f.calories)} cal`);
      if (f.weight != null) notes.push(`${Number(f.weight).toFixed(1)} lb`);
      if (missed) notes.push(`missed planned ${planned}`);
      return `<div class="${cls.join(" ")}" title="${esc(fmtDay(key) + (notes.length ? " — " + notes.join(", ") : ""))}"><span class="calNum">${d}</span>${lifts.length ? `<span class="calLift">${esc(lifts.join(""))}</span>` : ""}<span class="calDots">${dots}</span></div>`;
    }).join("");
    const legend = [
      `<span><i class="swatch" style="background:var(--ch-1)"></i>Lift (A/B/C)</span>`,
      `<span><i class="swatch dot" style="background:var(--ch-3)"></i>Cardio day (${CARDIO_DAY_MIN}+ min)</span>`,
      `<span><i class="swatch dot" style="background:transparent;border:1.5px solid var(--ch-3)"></i>Under ${CARDIO_DAY_MIN} min</span>`,
      `<span><i class="swatch dot" style="background:var(--ch-bad)"></i>Over ${targets.calories.max} cal</span>`,
      `<span><i class="swatch dot" style="background:var(--muted)"></i>Weighed in</span>`,
      `<span><i class="swatch" style="background:transparent;border:1px dashed var(--ch-bad)"></i>Planned session missed</span>`,
    ].join("");
    const summary = tally.elapsed
      ? `${tally.lifts} lift${tally.lifts === 1 ? "" : "s"} · ${tally.cardio} cardio day${tally.cardio === 1 ? "" : "s"} · ${tally.over} day${tally.over === 1 ? "" : "s"} over · weighed in ${tally.weighed}/${tally.elapsed} days`
      : "Nothing logged this month yet.";
    return `<div class="card"><div class="calNav"><button type="button" data-cal="-1" aria-label="Previous month">‹</button><div class="calMonth">${esc(first.toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</div><button type="button" data-cal="1" aria-label="Next month">›</button></div><div class="calGrid">${head}${blanks}${cells}</div><div class="calSummary">${esc(summary)}</div><div class="legend">${legend}</div></div>`;
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
      equip: x[5],
      mode: x[6],
    }));
  }
  // How a weight was loaded, so "80 lb" is never ambiguous between a machine's
  // total stack and 80 lb on each side / in each hand.
  // Live workouts, templates and archive entries all carry equip/mode. Logged
  // sets carry their own copy taken when the set was logged — nothing here
  // falls back to the current settings, so editing an exercise in Edit
  // Workouts never rewrites history. Sets logged before the app tracked this
  // read as "not recorded" until they are set on the logged workout itself.
  function exMetaFor(x) {
    return x && (x.equip || x.mode) ? x : { equip: "machine", mode: "total" };
  }
  function loggedLoadLabel(s) {
    if (!s || !s.mode) return null;
    if (s.mode !== "perSide") return "total";
    return s.equip === "dumbbell" ? "per hand" : "per side";
  }
  function loggedUnit(s) {
    const m = loggedLoadLabel(s);
    return m === "per hand" ? "lb/hand" : m === "per side" ? "lb/side" : "lb";
  }
  function equipLabel(x) {
    return EQUIP_LABEL[exMetaFor(x).equip] || "Machine";
  }
  function loadLabel(x) {
    const m = exMetaFor(x);
    if (x && x.type === "body") return "bodyweight";
    if (m.equip === "bodyweight") return "bodyweight";
    if (m.mode !== "perSide") return "total";
    return m.equip === "dumbbell" ? "per hand" : "per side";
  }
  function loadSuffix(x) {
    const m = exMetaFor(x);
    if (m.mode !== "perSide") return " lb";
    return m.equip === "dumbbell" ? " lb/hand" : " lb/side";
  }
  function weightText(w, x) {
    return w === 0 ? "BW" : `${w}${loadSuffix(x)}`;
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
  // daysOverride lets a caller line this chart up with another one above it —
  // weight and calories are different units, so they read as two stacked charts
  // over the same dates rather than one chart with two y-scales.
  function renderWeightChartCard(daysOverride) {
    const logged = db.weightLogs.filter((w) => Number.isFinite(Number(w.weight)));
    if (logged.length < 2)
      return `<div class="card"><div class="cardHead"><div class="cardTitle">Weight trend</div></div>${emptyBlock("Log weight on two or more days to see the trend.")}</div>`;
    const days = daysOverride && daysOverride.length ? daysOverride : dayRange(logged.map((w) => w.date), 60);
    const byDate = {};
    logged.forEach((w) => (byDate[w.date] = Number(w.weight)));
    const daily = days.map((d) => (Number.isFinite(byDate[d]) ? byDate[d] : null));
    const avg = rollingMean(daily, 7, 2);
    const firstAvg = avg.find((v) => v != null);
    const lastAvg = avg.slice().reverse().find((v) => v != null);
    const delta = firstAvg != null && lastAvg != null ? lastAvg - firstAvg : null;
    const note =
      delta == null
        ? `${days.length} days`
        : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} lb over ${days.length} days`;
    const chart = timeChart({
      days,
      lines: [
        { label: "Daily", color: "var(--ch-1)", values: daily, width: 1, dots: true },
        { label: "7-day avg", color: "var(--ch-2)", values: avg, width: 2.5 },
      ],
      fmt: (v) => v.toFixed(1),
      unit: "lb",
      aria: "Daily bodyweight and 7-day rolling average",
    });
    return `<div class="card"><div class="cardHead"><div class="cardTitle">Weight trend</div><div class="cardNote">${esc(note)}</div></div>${chart}</div>`;
  }
  function renderCaloriesChartCard(daysOverride) {
    if (!db.foodLogs.length)
      return `<div class="card"><div class="cardHead"><div class="cardTitle">Calories</div></div>${emptyBlock("Log some food to see the trend.")}</div>`;
    const days = daysOverride && daysOverride.length ? daysOverride : dayRange(db.foodLogs.map((x) => x.date), 60);
    const byDate = {};
    db.foodLogs.forEach((x) => (byDate[x.date] = (byDate[x.date] || 0) + (x.calories || 0)));
    const daily = days.map((d) => (byDate[d] != null ? byDate[d] : null));
    const avg = rollingMean(daily, 7, 3);
    const base = baselineCalories();
    const lastAvg = avg.slice().reverse().find((v) => v != null);
    const note =
      lastAvg != null
        ? `7-day avg ${num(lastAvg)}${base ? ` · ~${num(base - lastAvg)} under baseline` : ""}`
        : `${days.length} days`;
    const chart = timeChart({
      days,
      zero: true,
      bars: { label: "Daily", color: "var(--ch-1)", values: daily },
      lines: [{ label: "7-day avg", color: "var(--ch-2)", values: avg, width: 2.5 }],
      band: { min: targets.calories.min, max: targets.calories.max, label: `Target ${targets.calories.min}–${targets.calories.max}` },
      refs: base ? [{ label: `Baseline ~${num(base)}`, value: base }] : [],
      unit: "cal",
      aria: "Daily calories with 7-day rolling average, target range and estimated maintenance",
    });
    return `<div class="card"><div class="cardHead"><div class="cardTitle">Calories</div><div class="cardNote">${esc(note)}</div></div>${chart}</div>`;
  }
  function weekStart(dateStr) {
    const d = parseDayKey(dateStr);
    return addDays(dateStr, -((d.getDay() + 6) % 7)); // back to Monday
  }
  function renderWeekCard(facts) {
    const today = dayKey();
    const start = weekStart(today);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    const elapsed = days.filter((d) => daysBetween(d, today) >= 0);
    const lifts = elapsed.reduce((n, d) => n + ((facts[d] && facts[d].lifts.length) || 0), 0);
    const cardio = elapsed.filter((d) => facts[d] && facts[d].cardioDay).length;
    // Today is still in progress, so it would drag the average down.
    const calDays = elapsed.filter((d) => d !== today && facts[d] && facts[d].food);
    const avgCal = calDays.length ? calDays.reduce((n, d) => n + facts[d].calories, 0) / calDays.length : null;
    const weighed = elapsed.map((d) => (facts[d] ? facts[d].weight : null)).filter((v) => v != null);
    const prior = [];
    for (let i = 1; i <= 7; i++) {
      const f = facts[addDays(start, -i)];
      if (f && f.weight != null) prior.push(Number(f.weight));
    }
    const mean = (a) => a.reduce((x, y) => x + Number(y), 0) / a.length;
    const delta = weighed.length && prior.length ? mean(weighed) - mean(prior) : null;
    const stat = (name, value, tone) =>
      `<div><div class="chipName">${esc(name)}</div><div class="chipVal"${tone ? ` style="color:${tone}"` : ""}>${value}</div></div>`;
    return `<div class="label">This week · from ${esc(fmtDay(start, { relative: false }))}</div><div class="macroStrip"><div class="macroChips">${stat(
      "Lifts",
      `${lifts}<span style="font-size:10px;color:var(--muted)">/3</span>`,
    )}${stat("Cardio", `${cardio}<span style="font-size:10px;color:var(--muted)">/2</span>`)}${stat(
      "Avg cal",
      avgCal == null
        ? "—"
        : `${num(avgCal)}<span style="font-size:10px;color:var(--muted)"> ${calDays.length}d</span>`,
    )}${stat(
      "Weight",
      delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`,
      delta == null ? null : delta <= 0 ? "light-dark(#1e7d32,#4ade80)" : "light-dark(#9a6a00,#e8b339)",
    )}</div></div>`;
  }
  // Today's checklist, straight off the plan: lift Mon/Wed/Fri, incline walk
  // Tue/Thu, weigh in daily, waist on Mondays, calories inside the target band.
  function renderTodayCard(facts) {
    const today = dayKey();
    const f = facts[today] || {};
    const wd = effectiveNow().getDay();
    const plan = { 1: "A", 3: "B", 5: "C" }[wd];
    const items = [];
    if (plan) items.push([`Workout ${plan}`, (f.lifts || []).length > 0]);
    const cardioSoFar = f.cardioMin ? ` · ${fmtMinutes(f.cardioMin)} so far` : "";
    if (PLAN_CARDIO_DAYS.includes(wd))
      items.push([`Incline walk · ${CARDIO_DAY_MIN}+ min${f.cardioDay ? "" : cardioSoFar}`, !!f.cardioDay]);
    if (!plan && !PLAN_CARDIO_DAYS.includes(wd))
      items.push([`Rest day — optional walk${f.cardioDay ? "" : cardioSoFar}`, !!f.cardioDay]);
    items.push(["Weigh in", f.weight != null]);
    items.push([`Creatine · ${CREATINE_DOSE_G}g`, creatineTaken(today), "creatine"]);
    if (wd === WAIST_DAY) items.push(["Waist measurement", db.waistLogs.some((x) => x.date === today)]);
    items.push([
      `Calories ${targetLabel("calories")}`,
      !!f.food && f.calories >= targets.calories.min && f.calories <= targets.calories.max,
    ]);
    const rows = items
      .map(([label, done, tap]) => {
        const inner = `<span class="tick${done ? " on" : ""}">${done ? "✓" : ""}</span>${esc(label)}`;
        return tap
          ? `<button class="todo todoTap" type="button" data-toggle="${tap}" aria-pressed="${done}">${inner}</button>`
          : `<div class="todo">${inner}</div>`;
      })
      .join("");
    const weekday = effectiveNow().toLocaleDateString("en-US", { weekday: "long" });
    return `<div class="label">Today · ${esc(weekday)}</div><div class="macroStrip" style="gap:9px">${rows}</div>`;
  }
  function showHome() {
    stopTimer();
    if (active()) saveActive();
    phase = "home";
    const t = foodTotals(dayKey()),
      lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lwa = db.waistLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0],
      lc = db.cardioLogs.slice().sort((a, b) => b.ts - a.ts)[0];
    const facts = dayFacts();
    let resume = "";
    const a = db.activeWorkout;
    if (a && a.workout) {
      const e = a.order[a.exerciseIndex];
      if (e)
        resume = `<button id="resume" class="resume" type="button"><div>Resume ${db.templates[a.workout].name}<br><small>${esc(e.name)} · ${a.phase === "rest" ? "Resting" : "Set " + Math.min(a.session.filter((x) => x.id === e.id).length + 1, 2)}</small></div><div>→</div></button>`;
    }
    const cardioLabel = lc
      ? `${fmtMinutes(lc.duration)} · ${esc(fmtDay(lc.date || dayKeyFromTs(lc.ts), { weekday: false }))}`
      : "Log";
    // A/B/C map to Mon/Wed/Fri; today's session gets the underline.
    const planToday = { 1: "A", 3: "B", 5: "C" }[effectiveNow().getDay()] || null;
    const dayTile = (k, weekday) =>
      `<button class="day${planToday === k ? " todayPlan" : ""}" data-start="${k}">${k}<span>${weekday}</span></button>`;
    const avg7 = (() => {
      const days = dayRange(db.weightLogs.map((w) => w.date), 14);
      if (!days.length) return null;
      const byDate = {};
      db.weightLogs.forEach((w) => (byDate[w.date] = Number(w.weight)));
      const vals = rollingMean(days.map((d) => (Number.isFinite(byDate[d]) ? byDate[d] : null)), 7, 2);
      return vals.slice().reverse().find((v) => v != null) || null;
    })();
    stage.innerHTML = `<section class="home"><div id="syncStatus" class="syncLine"></div>${resume}<div class="label" style="justify-content:space-between">Workout<button id="editWorkouts" type="button" style="background:none;border:0;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit;padding:0">Edit</button></div><div class="days" style="grid-template-columns:repeat(4,1fr)">${dayTile("A", "Monday")}${dayTile("B", "Wednesday")}${dayTile("C", "Friday")}<button class="day" id="cardio" type="button" style="font-size:22px">Cardio<span>${cardioLabel}</span></button></div><div class="label">Tracking</div><div class="sections"><button id="food" class="sectionTile" type="button"><strong>Food</strong><span>${t.approx ? "~" : ""}${num(t.calories)} cal · ${r1(t.protein)}g protein<br>target ${targetLabel("calories")}</span></button><button id="body" class="sectionTile" type="button"><strong>Body</strong><span>${lw ? Number(lw.weight).toFixed(1) + " lb" : "No weight"}${avg7 ? ` · 7-day ${avg7.toFixed(1)}` : ""}<br>${lwa ? Number(lwa.waist).toFixed(1) + " in waist" : "No waist yet"}</span></button></div>${renderTodayCard(facts)}${renderWeekCard(facts)}<button id="history" class="historyOpen" type="button">Workout history &amp; calendar · ${db.workoutLogs.length}</button><button id="mealHistory" class="historyOpen" type="button" style="margin-top:0">Meal history</button><button id="openPlan" class="historyOpen" type="button" style="margin-top:0">Plan</button><div id="publishTime" class="syncLine" style="border-bottom:0;border-top:1px solid light-dark(#cfd1cc,#343733)">published —</div></section>`;
    stage.querySelector("#resume")?.addEventListener("click", restore);
    stage.querySelector("#food").addEventListener("click", () => showFood("meals"));
    stage.querySelector("#body").addEventListener("click", showBody);
    stage.querySelector("#cardio").addEventListener("click", showCardio);
    stage.querySelector("#editWorkouts").addEventListener("click", showWorkoutEditor);
    stage.querySelector("#history").addEventListener("click", showHistory);
    stage.querySelector("#mealHistory").addEventListener("click", () => showFoodHistory());
    stage.querySelector("#openPlan").addEventListener("click", showPlan);
    stage.querySelectorAll('[data-toggle="creatine"]').forEach((b) =>
      b.addEventListener("click", () => {
        toggleCreatine(dayKey());
        rerenderHome();
      }),
    );
    setPublishStamp();
    armBackgroundTimer();
  }
  // Re-render home in place — the Today card sits below the fold, so a plain
  // showHome() would jump the scroll back to the top on every tap.
  function rerenderHome() {
    const top = stage.querySelector(".home")?.scrollTop || 0;
    showHome();
    const next = stage.querySelector(".home");
    if (next) next.scrollTop = top;
  }
  function showPlan() {
    stopTimer();
    if (active()) saveActive();
    phase = "plan";
    const h = (text) =>
      `<div style="font-size:15px;font-weight:950;margin-top:4px">${esc(text)}</div>`;
    const sub = (text) => `<div style="font-size:12px;font-weight:850;color:light-dark(#555a54,#bdc1bb);margin-top:8px">${esc(text)}</div>`;
    const p = (text) => `<div style="font-size:13px;margin-top:4px">${text}</div>`;
    const ul = (items) => `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${items.map((i) => `<li style="margin-top:3px">${i}</li>`).join("")}</ul>`;
    const table = (head, rows) =>
      `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px"><thead><tr>${head.map((c) => `<th style="text-align:left;padding:6px 4px;border-bottom:1px solid light-dark(#cfd1cc,#343733);font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:light-dark(#6d716b,#a8aca6)">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c, i) => `<td style="padding:6px 4px;border-bottom:1px solid light-dark(#ecece8,#272a27);${i === 0 ? "font-weight:850" : ""}">${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    const section = (title, body) =>
      `<div class="form" style="padding:16px">${h(title)}${body}</div>`;

    const content = [
      section(
        "10-Month Physique Plan — Aug 24, 2026 → June 2027",
        p(
          `6'2", 196 lbs, male, ~22% body fat (est.), former athlete, low current muscle mass.<br>` +
            `Goal: ~13–14% body fat, flat/hard stomach, visible abs when flexed, obviously muscular (not huge) arms.<br>` +
            `June 2027 is Checkpoint 1, not the finish line — see Phase 3B.<br>` +
            `Cut target before switching to muscle-building: 13% body fat (chosen over 15%).`,
        ) +
          sub("Trade-off") +
          p(
            "Cutting to 13% before Phase 3 takes an estimated ~6–6.5 months, leaving only ~3.5 months to build muscle before June. Arms are the slowest-responding part of the goal — expect them furthest from \"done\" by June under this path. Known cost of prioritizing leanness first, not a mistake.",
          ),
      ),
      section(
        "Daily Non-Negotiables (all phases)",
        ul(["Sleep: 7+ hours/night", "Water: minimum half bodyweight (lbs) in oz", "Weigh-in: same time/conditions, track weekly average not daily number"]),
      ),
      section(
        "Weekly Schedule (all phases)",
        ul([
          "Mon / Wed / Fri: 3-day lifting split (rotating A/B/C)",
          "Tue / Thu: 60 min incline treadmill walk (mandatory)",
          "Sat / Sun: optional extra incline walk if desired, not required",
          "Monday: waist measurement + full body-fat tape measurement (weekly)",
        ]),
      ),
      section(
        "Nutrition Targets by Phase",
        table(
          ["Metric", "Phase 1–2 (Cut)", "Phase 3 (Build)", "Final Cut"],
          [
            ["Calories", "1,900–2,050", "Maint. +200–300", "1,900–2,050"],
            ["Protein", "170g+", "180–190g+", "180g+"],
            ["Carbs", "140g+", "160g+", "140g+"],
            ["Fat", "50g+", "60g+", "50g+"],
            ["Fiber", "18g+", "20g+", "18g+"],
            ["Sodium", "hidden/ignore (soft cap <3,000mg)", "same", "same"],
          ],
        ),
      ),
      section(
        "Phase 1 — Weeks 1–8 (Aug 24 – Oct 19, 2026)",
        p("Goal: fat loss, relearn lifts, rebuild joint/tendon tolerance, habit formation.") +
          ul([
            "Weeks 1–4 (through ~Sep 21): 2 sets/exercise. Focus on form, full range of motion, consistency. No weight-chasing yet.",
            "Weeks 5–8 (through ~Oct 19): move to 3 sets/exercise. Begin progressive overload — add weight when you hit top of rep range 2 sessions in a row.",
          ]) +
          sub("Tracking") +
          p("Weekly: waist + tape body-fat measurement every Monday, bodyweight daily (track weekly average). Monthly: progress photo, same lighting/pose.") +
          sub("Expected by end of Phase 1 (~Oct 19)") +
          ul(["Weight: -7 to -10 lbs", "Body fat: 22% → ~19-20%"]),
      ),
      section(
        "Phase 2 — Weeks 9–24ish (Oct 20, 2026 – early Mar 2027)",
        p("Goal: continue the cut down to 13%, build training volume along the way.") +
          ul([
            "Late Oct: recalculate TDEE using new bodyweight. Adjust calories only if progress stalls 2+ weeks despite adherence.",
            "Nov onward: increase to 4 sets/exercise once 3 feels easy.",
            "Continue weekly Monday measurements — this is the main signal for when to switch to Phase 3.",
          ]) +
          sub("Rough body fat trajectory (go by actual Monday numbers, not the calendar)") +
          ul(["End Nov: ~18%", "End Dec: ~16-17%", "End Jan: ~15%", "End Feb: ~13-14%", "Early Mar: 13% — switch to Phase 3"]) +
          sub("Decision rule") +
          p("Switch to Phase 3 the Monday the tape measurement reads ~13%, whenever that actually happens — don't wait for a calendar date, and don't keep cutting past 13% \"just to be sure.\""),
      ),
      section(
        "Phase 3 — Early Mar – Late May 2027 (~3.5 months)",
        p("Goal: build as much visible muscle as possible in a compressed window, especially arms. Given the short window, prioritize efficiency over volume creep.") +
          ul([
            "Switch: move calories to maintenance +200-300 surplus immediately. Retest TDEE at new bodyweight. Protein to 180-190g.",
            "Training: 4 sets/exercise on all main lifts. Add a dedicated arm-focused block — extra set of biceps curl + triceps pressdown each session, or a short 4th day if recovery allows. Highest-leverage change to compensate for the shortened window.",
            "Consistency over intensity: with only ~14-15 weeks, missed sessions cost proportionally more than in a longer phase — protect Mon/Wed/Fri lifting above almost everything else.",
            "Monitor body fat weekly: some regain is expected and fine (target creeping to ~15-16% during the surplus is normal); if it climbs past ~17-18%, tighten the surplus to +100-150.",
          ]) +
          sub("Expected by late May 2027") +
          ul([
            "Some new muscle, most visible in shoulders/chest/back (faster-responding areas)",
            "Arms: likely still developing — visible improvement from Aug, but probably not \"fully arrived\" given the short window",
            "Body fat: ~15-16% (before final cut)",
          ]),
      ),
      section(
        "Final Polish — Late May – June 2027 (~3-4 weeks)",
        p("Goal: cut back down to reveal whatever muscle was built, sharpen for the June date.") +
          ul([
            "Shift back to 1,900-2,050 cal, protein stays at 180g+ to protect the new muscle.",
            "Keep training volume (4 sets) — don't cut training just because calories drop.",
            "Final 1-2 weeks: water intake up, sodium moderation, for peak visual definition on a specific date.",
          ]) +
          sub("Expected by June 2027 (Checkpoint 1, not the finish line)") +
          ul([
            "Body fat: ~13-14%",
            "Stomach: flat and firm, visible abs when flexed",
            "Arms: visibly more developed than August, but likely still the least \"finished\" part of the physique — expected, not a failure. Phase 3B is where arms actually get finished.",
          ]),
      ),
      section(
        "Phase 3B — July – Dec 2027 (unhurried second build block)",
        p(
          "Goal: finish what the compressed Phase 3 couldn't — primarily arm/shoulder size — without a deadline forcing rushed decisions. Only starts once June checkpoint results are actually seen — this is a template to adapt once the real starting point is known.",
        ) +
          ul([
            "July 2027: reassess honestly. Take a body fat + physique check similar to the June one. Decide surplus size based on how June actually looks (bigger surplus if body fat is comfortably low; smaller if already near the top of comfort range).",
            "July–Nov 2027 (~5 months): maintenance +200-300 surplus, 4-5 sets/exercise, continued arm/shoulder emphasis. No forced deadline means surplus phases can extend longer if muscle gain is still progressing well, or cut short if body fat creeps too high.",
            "Dec 2027: optional second short cut (2-4 weeks) if body fat has risen enough to want to reveal the new muscle before year-end — otherwise the build can extend further into 2028 if progress is still trending well.",
          ]) +
          sub("Key difference from Phase 3") +
          p("No artificial time pressure. Extend or shorten based on actual weekly Monday tape measurements and how arms are progressing, not a fixed calendar. This is the phase where \"obviously muscular arms\" should actually arrive."),
      ),
      section(
        "Tracking Checklist",
        ul([
          "Bodyweight — daily, track weekly average",
          "Waist + full body-fat tape measurement — every Monday",
          "Progress photo — monthly, same lighting/pose/time",
          "Lift weights/reps — every session",
        ]),
      ),
      section(
        "Key Decision Rules",
        ul([
          "Never below 1,900 cal, even mid-cut.",
          "Never below 170g protein (180g+ in Phase 3/surplus).",
          "Switch phases by the Monday body-fat number, not the calendar.",
          "Retest TDEE at every phase transition.",
          "Don't stack extra cardio cuts and extra calorie cuts simultaneously.",
          "Given the compressed Phase 3, protect the Mon/Wed/Fri lifting sessions above all else — missed sessions cost more in a short window.",
        ]),
      ),
    ].join("");
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Plan</div><button id="planBack" class="btn" type="button">Back</button></div><div class="library" style="padding:12px;display:flex;flex-direction:column;gap:10px">${content}</div></section>`;
    stage.querySelector("#planBack").addEventListener("click", showHome);
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
  // The weight an exercise starts at comes from the saved logs, not just from
  // what was last logged live — so correcting a weight or adding a set on a
  // past workout carries into the next one.
  function lastLoggedWeight(id) {
    let best = null;
    db.workoutLogs.forEach((l) => {
      const last = (l.sets || []).filter((x) => x.id === id).pop();
      const w = last ? Number(last.weight) : NaN;
      if (!Number.isFinite(w)) return;
      const t = Date.parse(l.date) || 0;
      if (!best || t >= best.t) best = { t, weight: w };
    });
    return best ? best.weight : null;
  }
  function defaultWeight(e) {
    if (e.type === "body") return 0;
    // A set already logged in this session wins, so set 2 follows set 1.
    const inSession = sets(e.id).slice(-1)[0];
    if (inSession && Number.isFinite(Number(inSession.weight))) return Number(inSession.weight);
    const logged = lastLoggedWeight(e.id);
    if (logged != null) return logged;
    // liftHistory still covers an exercise whose only history is a workout
    // that was ended without saving a log.
    if (db.liftHistory[e.id] && Number.isFinite(db.liftHistory[e.id].weight))
      return db.liftHistory[e.id].weight;
    if (e.type === "lower") return 140;
    if (e.type === "lower2") return 60;
    if (e.type === "upper") return 50;
    return 30;
  }
  const WEIGHT_STEP = 5; // gyms have 5 lb plates and 5 lb stack steps
  function weightVals(e) {
    if (e.type === "body") return [0];
    const c = defaultWeight(e),
      a = [];
    const start = Math.max(WEIGHT_STEP, Math.round((c - 40) / WEIGHT_STEP) * WEIGHT_STEP);
    for (let w = start; w <= c + 80; w += WEIGHT_STEP) a.push(w);
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
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="exerciseHead"><div class="exerciseTitle"><div class="exerciseName">${esc(e.name)}</div><div class="exerciseMeta">${exerciseIndex + 1}/${order.length} · SET ${sets(e.id).length + 1}/2 · ${esc(equipLabel(e))} · ${esc(loadLabel(e))}</div></div><button id="swap" class="btn" type="button">Swap</button><button id="pauseWorkout" class="btn" type="button">Pause</button><button id="endWorkout" class="btn" type="button">End</button></div><div class="picker"><div class="half"><div class="label">${e.type === "body" ? "Bodyweight" : `Weight (lb ${esc(loadLabel(e))}) · swipe ↔`}</div><div id="weights" class="rail">${weightVals(e).map((v) => `<button class="choice ${v === w ? "selected" : ""}" data-w="${v}" type="button">${v === 0 ? "BW" : v}</button>`).join("")}</div></div><div class="half"><div class="label">Reps · tap to log · target ${e.target}</div><div id="reps" class="rail">${Array.from({ length: 25 }, (_, i) => i + 1).map((v) => `<button class="choice ${v === e.target ? "target selected" : ""}" data-r="${v}" type="button">${v}</button>`).join("")}</div></div></div></section>`;
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
      entry = {
        id: e.id,
        name: e.name,
        set: sets(e.id).length + 1,
        weight,
        reps,
        equip: e.equip,
        mode: e.mode,
        previous,
      };
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
    stage.innerHTML = `<section class="timer"><div style="display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;width:100%"><button id="pauseWorkout" class="btn" type="button">Pause</button><button id="endWorkout" class="btn" type="button">End</button></div><div>${esc(lastLogged.name)} · Set ${lastLogged.set}</div><div class="logged">${esc(weightText(lastLogged.weight, lastLogged))} × ${lastLogged.reps}</div><div style="margin-top:8px">Next: ${esc(next)}</div><div id="secs" class="seconds">${left}</div><div class="timerActions"><button id="back" type="button">Back</button><button id="pause" type="button">${paused ? "Resume" : "Hold"}</button><button id="skip" type="button">Skip</button></div><div style="width:100%;overflow-y:auto;max-height:35vh;border-top:1px solid light-dark(#cfd1cc,#343733)">${remaining}</div></section>`;
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
        ? `<div class="note" style="padding:8px 12px 0">Alternative — machine busy/missing</div>${alts.map((a) => `<button class="swapRow" data-alt="${a.id}" type="button">${esc(a.name)}<div class="tagRow"><span class="tag">${esc(equipLabel(a))}</span><span class="tag">${esc(loadLabel(a))}</span></div></button>`).join("")}`
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
        order[exerciseIndex] = { id: a.id, name: a.name, target: a.target, rest: a.rest, type: a.type, equip: a.equip, mode: a.mode };
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
        sets: session.map((x) => ({ id: x.id, name: x.name, set: x.set, weight: x.weight, reps: x.reps, equip: x.equip, mode: x.mode })),
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
          a.approx = a.approx || !!x.approx;
          return a;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0, approx: false },
      );
  }
  function macroLine(x) {
    return `${x.approx ? "~" : ""}${x.calories} cal · ${r1(x.protein)}g P · ${r1(x.carbs)}g C · ${r1(x.fat)}g F · ${Math.round(x.sodium || 0)}mg Na · ${r1(x.fiber)}g fiber`;
  }
  // Compact calories + macro readout. Deliberately short so the food list
  // below it gets most of the screen.
  function renderMacroStrip(t) {
    const statusColor = (cls) =>
      cls === "good"
        ? "light-dark(#1e7d32,#4ade80)"
        : cls === "warn"
          ? "light-dark(#9a6a00,#e8b339)"
          : "light-dark(#b3261e,#ff6b5e)";
    const chip = (name, value, key) => {
      const target = targets[key] || {};
      const goal = target.min !== undefined ? target.min : target.max;
      const cls = metricStatus(value, key).trim();
      const pct = goal ? Math.max(0, Math.min(100, (value / goal) * 100)) : 0;
      return `<div><div class="chipName">${esc(name)}</div><div class="chipVal">${r1(value)}<span style="font-size:10px;font-weight:850;color:var(--muted)">/${goal}</span></div><div class="chipBar" style="color:${statusColor(cls)}"><div class="chipFill" style="width:${pct.toFixed(0)}%"></div></div></div>`;
    };
    const base = baselineCalories();
    const gap = base ? base - t.calories : null;
    return `<div class="macroStrip"><div class="macroTop"><div><div class="macroCal ${metricStatus(t.calories, "calories").trim()}">${t.approx ? "~" : ""}${num(t.calories)}<span style="font-size:12px;font-weight:850;color:var(--muted)"> cal</span></div><div class="chipName" style="margin-top:4px">Today · target ${targetLabel("calories")}</div></div><div class="macroSub">${base ? `baseline ~${num(base)}<br>${gap >= 0 ? num(gap) + " under" : num(-gap) + " over"}` : ""}</div></div><div class="macroChips">${chip("Protein", t.protein, "protein")}${chip("Carbs", t.carbs, "carbs")}${chip("Fat", t.fat, "fat")}${chip("Fiber", t.fiber, "fiber")}</div></div>`;
  }
  function showFood(tab = "meals") {
    stopTimer();
    if (active()) saveActive();
    phase = "food";
    const d = dayKey(),
      t = foodTotals(d);
    const library =
      tab === "meals" ? renderFoodList(meals) : tab === "snacks" ? renderFoodList(snacks) : renderFoodList(drinks);
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Food</div><button id="foodBack" class="btn" type="button">Back</button></div>${renderMacroStrip(t)}<div class="tabs"><button data-tab="meals" class="${tab === "meals" ? "active" : ""}" type="button">Meals</button><button data-tab="snacks" class="${tab === "snacks" ? "active" : ""}" type="button">Snacks</button><button data-tab="drinks" class="${tab === "drinks" ? "active" : ""}" type="button">Drinks</button><button id="openFoodHistory" type="button">History</button></div><div class="library">${library}</div></section>`;
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
    const foodDays = db.foodLogs.length ? dayRange(db.foodLogs.map((x) => x.date), 60) : null;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">History</div><div style="display:flex;gap:8px"><button id="openAdHocFood" class="btn" type="button">+ Add</button><button id="foodHistoryBack" class="btn" type="button">Back</button></div></div><div class="library">${renderCaloriesChartCard(foodDays)}${renderWeightChartCard(foodDays)}${renderToday(d)}</div></section>`;
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
    mountCharts();
    armBackgroundTimer();
  }
  function showAdHocFood() {
    stopTimer();
    if (active()) saveActive();
    phase = "adHocFood";
    const today = dayKey();
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Add Food</div><button id="adHocBack" class="btn" type="button">Back</button></div><div class="library"><form id="adHocForm" class="form" style="display:flex;flex-direction:column;gap:8px">
      <input id="adHocName" type="text" placeholder="Name" required>
      <label style="display:flex;flex-direction:column;gap:4px"><span class="chipName">Date</span><input id="adHocDate" type="date" value="${today}" max="${today}" required></label>
      <input id="adHocCalories" type="number" inputmode="decimal" placeholder="Calories" required>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input id="adHocApprox" type="checkbox" style="width:auto;min-height:auto" checked>Estimate (eating out / not exact)</label>
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
      const date = stage.querySelector("#adHocDate").value || dayKey();
      if (!name || !Number.isFinite(calories)) return;
      const num = (id) => {
        const v = Number(stage.querySelector(id).value);
        return Number.isFinite(v) ? v : 0;
      };
      db.foodLogs.push({
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        date,
        name,
        serving: "",
        calories,
        protein: num("#adHocProtein"),
        carbs: num("#adHocCarbs"),
        fat: num("#adHocFat"),
        sodium: num("#adHocSodium"),
        fiber: num("#adHocFiber"),
        approx: !!stage.querySelector("#adHocApprox").checked,
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
  function renderToday(d) {
    if (!db.foodLogs.length) return `<div class="empty">Nothing logged yet.</div>`;
    const byDate = {};
    db.foodLogs.forEach((x) => {
      (byDate[x.date] || (byDate[x.date] = [])).push(x);
    });
    const dates = Object.keys(byDate).sort().reverse();
    const weightByDate = {};
    db.weightLogs.forEach((w) => (weightByDate[w.date] = Number(w.weight)));
    const head = `<div class="foodTableHead"><span>Day</span><span>Cal</span><span>P</span><span>C</span><span>F</span><span>Fib</span><span>Wt</span><span></span></div>`;
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
            a.approx = a.approx || !!x.approx;
            return a;
          },
          { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0, approx: false },
        );
        const isToday = date === d;
        const rows = items
          .slice()
          .reverse()
          .map((x) => renderFoodRow(x))
          .join("");
        const label = `${fmtDay(date)}${totals.approx ? " · ~est" : ""}`;
        return `<details ${isToday ? "open" : ""}><summary class="foodDaySummary"><div class="foodTableRow"><span><span class="chevron">▸</span><span class="cellName">${esc(label)}</span></span><span>${totals.approx ? "~" : ""}${Math.round(totals.calories)}</span><span>${Math.round(totals.protein)}</span><span>${Math.round(totals.carbs)}</span><span>${Math.round(totals.fat)}</span><span>${Math.round(totals.fiber)}</span><span>${Number.isFinite(weightByDate[date]) ? weightByDate[date].toFixed(1) : "—"}</span><span></span></div></summary><div>${rows}</div></details>`;
      })
      .join("");
    return `${head}<div class="foodDayList">${body}</div>`;
  }
  function renderFoodRow(x) {
    return `<div class="foodItemRow" data-view-food="${x.id}"><div class="foodTableRow"><span><span class="cellName">${x.approx ? "~" : ""}${esc(x.name)}${x.incomplete ? " · INCOMPLETE" : ""}</span></span><span>${Math.round(x.calories)}</span><span>${Math.round(x.protein || 0)}</span><span>${Math.round(x.carbs || 0)}</span><span>${Math.round(x.fat || 0)}</span><span>${Math.round(x.fiber || 0)}</span><span></span><span><button class="foodDeleteBtn" data-delete-food="${x.id}" type="button" aria-label="Delete">×</button></span></div></div>`;
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
        if (totalsEl) totalsEl.textContent = macroLine(Object.assign(sumIngredients(list), { approx: stage.querySelector("#editApprox").checked }));
      };
      stage.querySelectorAll("[data-ing-qty]").forEach((input) => input.addEventListener("input", update));
      stage.querySelector("#editApprox").addEventListener("change", update);
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
        x.approx = !!stage.querySelector("#editApprox").checked;
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
        x.approx = !!stage.querySelector("#editApprox").checked;
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
      <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input id="editApprox" type="checkbox" style="width:auto;min-height:auto" ${x.approx ? "checked" : ""}>Estimate (not exact)</label>
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
      <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input id="editApprox" type="checkbox" style="width:auto;min-height:auto" ${x.approx ? "checked" : ""}>Estimate (not exact)</label>
      <button class="submit" id="saveFoodIngredients" style="margin-top:0" type="button">Save</button>`;
  }
  const CREATINE_DOSE_G = 5;
  // A daily yes/no tick, not a measurement: a date is in creatineLogs or it
  // isn't. Tapping the row on the Today card is the only way to set it.
  function creatineTaken(date) {
    return db.creatineLogs.some((x) => x.date === date);
  }
  function toggleCreatine(date) {
    const i = db.creatineLogs.findIndex((x) => x.date === date);
    if (i === -1) db.creatineLogs.push({ date, ts: Date.now() });
    else db.creatineLogs.splice(i, 1);
    saveDB();
  }
  const WAIST_DAY = 1; // 0=Sunday .. 6=Saturday
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
      : `<div class="form"><strong>Weekly waist</strong><div class="note" style="margin-top:8px">Logged ${WAIST_DAY_NAMES[WAIST_DAY]}s. ${lwa ? `Last: ${Number(lwa.waist).toFixed(1)} in on ${esc(fmtDay(lwa.date))}.` : "Not logged yet."}</div></div>`;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Body</div><button id="bodyBack" class="btn" type="button">Back</button></div><div class="metrics" style="grid-template-columns:1fr 1fr"><div class="metric"><div class="metricName">Latest weight</div><div class="metricVal">${lw ? Number(lw.weight).toFixed(1) : "—"}</div><div>lb</div></div><div class="metric"><div class="metricName">Latest waist</div><div class="metricVal">${lwa ? Number(lwa.waist).toFixed(1) : "—"}</div><div>in</div></div></div><div class="bodyForms"><form id="weightForm" class="form"><strong>Daily weight</strong><input id="weightInput" type="number" inputmode="decimal" min="100" max="400" step="0.1" value="${tw ? tw.weight : ""}" placeholder="Weight (lb)" required><button class="submit" type="submit">Save</button></form>${waistBlock}</div><div class="list">${renderWeightChartCard()}${renderBody()}</div></section>`;
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
        const arr = { weight: db.weightLogs, waist: db.waistLogs, creatine: db.creatineLogs }[kind];
        if (!arr) return;
        const idx = arr.findIndex((x) => x.date === date);
        if (idx === -1) return;
        const [removed] = arr.splice(idx, 1);
        saveDB();
        showBody();
        showUndoToast(`Deleted ${kind} · ${fmtDay(date)}`, () => {
          arr.splice(idx, 0, removed);
          saveDB();
          if (phase === "body") showBody();
        });
      }),
    );
    mountCharts();
    armBackgroundTimer();
  }
  function renderBody() {
    const order = { weight: 0, waist: 1, creatine: 2 };
    const items = [
      ...db.weightLogs.map((x) => ({ kind: "weight", date: x.date, text: `${Number(x.weight).toFixed(1)} lb` })),
      ...db.waistLogs.map((x) => ({ kind: "waist", date: x.date, text: `${Number(x.waist).toFixed(1)} in (waist)` })),
      ...db.creatineLogs.map((x) => ({ kind: "creatine", date: x.date, text: `${CREATINE_DOSE_G}g creatine` })),
    ].sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind]);
    if (!items.length) return `<div class="empty">No measurements yet.</div>`;
    return items
      .map(
        (it) =>
          `<div class="bodyRow"><strong>${esc(fmtDay(it.date))}</strong><span style="display:flex;align-items:center;gap:10px;font-variant-numeric:tabular-nums">${it.text}<button class="delete" data-delete-body="${it.kind}|${esc(it.date)}" type="button" aria-label="Delete ${esc(it.kind)} from ${esc(fmtDay(it.date))}">×</button></span></div>`,
      )
      .join("");
  }
  function estimateCardioCalories(c) {
    const lw = db.weightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const kg = lw && Number.isFinite(Number(lw.weight)) ? Number(lw.weight) * 0.453592 : 79.4;
    let met;
    if (c.machine === "treadmill") {
      const speed = c.speed || 3;
      const grade = (c.incline || 0) / 100;
      const speedMmin = speed * 26.8224;
      // ACSM walking vs running equations — which one applies follows from the
      // speed itself, so there is nothing to pick when logging.
      const isWalk = speed < 4.5;
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
      parts.push(`~${num(estimateCardioCalories(c))} cal`);
      return `Treadmill · ${parts.join(" · ")}`;
    }
    if (c.resistance) parts.push(`resistance ${c.resistance}`);
    if (c.distance) parts.push(`${c.distance} mi`);
    parts.push(`~${num(estimateCardioCalories(c))} cal`);
    return `Bike · ${parts.join(" · ")}`;
  }
  function showCardio() {
    stopTimer();
    if (active()) saveActive();
    phase = "cardio";
    const isTread = cardioMachine === "treadmill";
    const fields = isTread
      ? `<input id="cardioDuration" type="number" inputmode="decimal" min="1" max="300" placeholder="Duration (min)" required><input id="cardioSpeed" type="number" inputmode="decimal" step="0.1" min="0" max="15" placeholder="Speed (mph)"><input id="cardioIncline" type="number" inputmode="decimal" step="0.5" min="0" max="20" placeholder="Incline (%)">`
      : `<input id="cardioDuration" type="number" inputmode="decimal" min="1" max="300" placeholder="Duration (min)" required><input id="cardioResistance" type="number" inputmode="decimal" min="1" max="30" placeholder="Resistance level"><input id="cardioDistance" type="number" inputmode="decimal" step="0.1" min="0" placeholder="Distance (mi, optional)">`;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Cardio</div><button id="cardioBack" class="btn" type="button">Back</button></div><div class="tabs" style="grid-template-columns:repeat(2,1fr)"><button data-machine="treadmill" class="${isTread ? "active" : ""}" type="button">Treadmill</button><button data-machine="bike" class="${!isTread ? "active" : ""}" type="button">Bike</button></div><form id="cardioForm" class="form" style="display:flex;flex-direction:column;gap:8px">${fields}<button class="submit" type="submit">Save</button></form><div class="list">${renderCardioList()}</div></section>`;
    stage.querySelector("#cardioBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-machine]").forEach((b) =>
      b.addEventListener("click", () => {
        cardioMachine = b.dataset.machine;
        showCardio();
      }),
    );
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
    if (!rows.length) return `<div class="empty">No cardio yet.</div>`;
    return rows
      .map(
        (c) =>
          `<div class="setRow"><div><strong>${esc(fmtDay(c.date || dayKeyFromTs(c.ts)))}</strong><div style="font-size:12px;font-weight:800;color:var(--muted)">${esc(formatCardioLine(c))}</div></div><button class="delete" data-delete-cardio="${c.id}" type="button" aria-label="Delete cardio">×</button></div>`,
      )
      .join("");
  }
  function showHistory() {
    stopTimer();
    if (active()) saveActive();
    phase = "history";
    const logs = db.workoutLogs.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const rows = logs.length
      ? logs
          .map(
            (l) =>
              `<div class="setRow" data-view-workout="${l.id}" style="cursor:pointer"><div><strong>${esc(l.name)}</strong><div style="font-size:12px;font-weight:800;color:var(--muted)">${esc(fmtDayTime(l.date))} · ${esc(fmtMinutes(l.duration))}</div></div><div style="display:flex;align-items:center;gap:10px"><span style="font-size:13px;font-weight:850">${l.sets.length} sets</span><button class="delete" data-delete-workout="${l.id}" type="button" aria-label="Delete ${esc(l.name)}">×</button></div></div>`,
          )
          .join("")
      : `<div class="empty">No workouts yet.</div>`;
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">History</div><button id="historyBack" class="btn" type="button">Back</button></div><div class="list">${renderCalendarCard()}<div class="label">Workouts · ${logs.length}</div>${rows}</div></section>`;
    stage.querySelector("#historyBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-cal]").forEach((b) =>
      b.addEventListener("click", () => {
        calMonth = shiftMonth(calMonth, Number(b.dataset.cal));
        showHistory();
      }),
    );
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
        byId[s.id] = { id: s.id, name: s.name, sets: [] };
        groups.push(byId[s.id]);
      }
      byId[s.id].sets.push({ ...s, idx: i });
    });
    const rows = groups
      .map((g, gi) => {
        const first = g.sets[0];
        const sets = g.sets
          .map(
            (s) =>
              `<div style="display:flex;align-items:center;gap:6px;width:100%" data-set-row="${s.idx}"><span style="min-width:42px">Set ${s.set}:</span><input type="number" step="0.5" min="0" value="${s.weight}" data-set-weight="${s.idx}" style="width:64px;min-height:32px;padding:0 6px;text-align:center"><span data-unit="${gi}">${esc(loggedUnit(s))}</span>×<input type="number" step="1" min="0" value="${s.reps}" data-set-reps="${s.idx}" style="width:52px;min-height:32px;padding:0 6px;text-align:center"><button class="delete" data-remove-set="${s.idx}" type="button" aria-label="Remove set">×</button></div>`,
          )
          .join("");
        const unset = !first.equip && !first.mode
          ? `<div data-unset="${gi}" style="font-size:11px;font-weight:800;color:var(--muted)">Not recorded — tap to set for this workout only</div>`
          : "";
        const addSet = `<button class="btn" data-add-set="${gi}" type="button" style="align-self:flex-start;min-height:34px;font-size:12px">+ Add set</button>`;
        return `<div class="setRow" style="flex-direction:column;align-items:stretch;gap:8px"><strong>${esc(g.name)}</strong>${sets}${addSet}${unset}${segRow(
          "Equip",
          `data-log-equip="${gi}"`,
          EQUIP_OPTIONS,
          first.equip,
        )}${segRow("Weight", `data-log-mode="${gi}"`, loadOptions(first.equip), first.mode)}</div>`;
      })
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
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">${esc(log.name)}</div><button id="detailBack" class="btn" type="button">Back</button></div><div class="list">${rows}${addForm}<button class="submit" id="saveWorkoutDetail" style="margin:8px;width:calc(100% - 16px)" type="button">Save</button></div></section>`;
    stage.querySelector("#detailBack").addEventListener("click", showHistory);
    // Weight and reps live in their inputs until something commits them, so
    // anything that re-renders this screen has to harvest them first.
    const commitEdits = () => {
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
    };
    const rerenderDetail = () => {
      const top = stage.querySelector(".list")?.scrollTop || 0;
      showWorkoutDetail(id);
      const next = stage.querySelector(".list");
      if (next) next.scrollTop = top;
    };
    stage.querySelector("#saveWorkoutDetail").addEventListener("click", () => {
      commitEdits();
      saveDB();
      showHistory();
    });
    const setLogMeta = (gi, field, value) => {
      const g = groups[gi];
      if (!g) return;
      g.sets.forEach((s) => {
        s[field] = value;
        if (log.sets[s.idx]) log.sets[s.idx][field] = value;
      });
      saveDB();
      stage.querySelectorAll(`[data-log-${field === "equip" ? "equip" : "mode"}="${gi}"]`).forEach((btn) => {
        const on = btn.dataset.seg === value;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", String(on));
      });
      const modeBtn = stage.querySelector(`[data-log-mode="${gi}"][data-seg="perSide"]`);
      if (modeBtn) modeBtn.textContent = g.sets[0].equip === "dumbbell" ? "Per hand" : "Per side";
      stage.querySelectorAll(`[data-unit="${gi}"]`).forEach((el) => (el.textContent = loggedUnit(g.sets[0])));
      stage.querySelector(`[data-unset="${gi}"]`)?.remove();
    };
    stage.querySelectorAll("[data-log-equip]").forEach((b) =>
      b.addEventListener("click", () => setLogMeta(Number(b.dataset.logEquip), "equip", b.dataset.seg)),
    );
    stage.querySelectorAll("[data-log-mode]").forEach((b) =>
      b.addEventListener("click", () => setLogMeta(Number(b.dataset.logMode), "mode", b.dataset.seg)),
    );
    stage.querySelectorAll("[data-remove-set]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.removeSet);
        commitEdits();
        const [removed] = log.sets.splice(i, 1);
        saveDB();
        rerenderDetail();
        showUndoToast(`Removed set ${removed.set} of ${removed.name}`, () => {
          log.sets.splice(i, 0, removed);
          saveDB();
          if (phase === "workoutDetail") showWorkoutDetail(id);
        });
      }),
    );
    stage.querySelectorAll("[data-add-set]").forEach((b) =>
      b.addEventListener("click", () => {
        commitEdits();
        const g = groups[Number(b.dataset.addSet)];
        if (!g) return;
        const lastIdx = log.sets.map((x) => x.id).lastIndexOf(g.id);
        if (lastIdx === -1) return;
        // Sit the new set next to the ones it belongs with, then renumber the
        // exercise so the labels stay 1..n even if a set was removed earlier.
        log.sets.splice(lastIdx + 1, 0, { ...log.sets[lastIdx] });
        let n = 0;
        log.sets.forEach((x) => {
          if (x.id === g.id) x.set = ++n;
        });
        saveDB();
        rerenderDetail();
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
        const sameEx = log.sets.filter((s) => s.id === exId);
        const from = sameEx.find((s) => s.equip || s.mode) || ex;
        log.sets.push({ id: exId, name: ex.name, set: sameEx.length + 1, weight, reps, equip: from.equip, mode: from.mode });
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
  const EQUIP_OPTIONS = [
    ["machine", "Machine"],
    ["cable", "Cable"],
    ["dumbbell", "DB"],
    ["barbell", "BB"],
    ["bodyweight", "Body"],
  ];
  // "per side" reads as "per hand" for dumbbells, matching the set screen.
  function loadOptions(equip) {
    return [["total", "Total"], ["perSide", equip === "dumbbell" ? "Per hand" : "Per side"]];
  }
  function segRow(label, attr, options, value) {
    const buttons = options
      .map(
        ([k, text]) =>
          `<button type="button" ${attr} data-seg="${k}" class="${k === value ? "on" : ""}" aria-pressed="${k === value}">${esc(text)}</button>`,
      )
      .join("");
    return `<div class="segRow"><span class="segLabel">${esc(label)}</span><div class="seg">${buttons}</div></div>`;
  }
  // Equipment / load mode belong to the exercise, so an edit here follows it
  // into every workout that uses it and into the archive.
  function setExerciseField(id, field, value) {
    const slot = field === "equip" ? 5 : 6;
    Object.values(db.templates).forEach((t) =>
      t.ex.forEach((ex) => {
        if (ex[0] === id) ex[slot] = value;
      }),
    );
    const a = db.exerciseArchive.find((x) => x.id === id);
    if (a) a[field] = value;
    saveDB();
  }
  function rerenderEditor() {
    const top = stage.querySelector(".library")?.scrollTop || 0;
    renderWorkoutEditor();
    const next = stage.querySelector(".library");
    if (next) next.scrollTop = top;
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
        return `<div class="setRow" style="flex-direction:column;align-items:stretch;gap:8px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><strong>${esc(ex[1])}</strong><div style="font-size:12px;font-weight:800;color:var(--muted)">${ex[2]} reps · ${ex[3]}s rest</div></div><div style="display:flex;gap:8px"><button class="btn" data-swap-ex="${i}" type="button">Swap</button><button class="delete" data-remove-ex="${i}" type="button" aria-label="Remove ${esc(ex[1])}">×</button></div></div>${segRow("Equip", `data-equip="${i}"`, EQUIP_OPTIONS, ex[5])}${segRow("Weight", `data-loadmode="${i}"`, loadOptions(ex[5]), ex[6])}</div>`;
      })
      .join("");
    const addOptions = available.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    stage.innerHTML = `<section style="display:flex;flex:1;flex-direction:column;min-height:0"><div class="head"><div class="title">Edit Workouts</div><button id="editorBack" class="btn" type="button">Back</button></div><div class="tabs" style="grid-template-columns:repeat(3,1fr)"><button data-day="A" class="${editorDay === "A" ? "active" : ""}" type="button">A · Mon</button><button data-day="B" class="${editorDay === "B" ? "active" : ""}" type="button">B · Wed</button><button data-day="C" class="${editorDay === "C" ? "active" : ""}" type="button">C · Fri</button></div><div class="library">${rows || `<div class="setRow">No exercises — add one below.</div>`}<form id="addFromArchiveForm" class="form" style="display:flex;flex-direction:column;gap:8px"><strong>Add from archive</strong>${available.length ? `<select id="archivePick">${addOptions}</select><button class="submit" type="submit">Add</button>` : `<div class="note">Every archived exercise is already in ${editorDay}.</div>`}</form><form id="addCustomForm" class="form" style="display:flex;flex-direction:column;gap:8px"><strong>New custom exercise</strong><input id="newExName" type="text" placeholder="Name" required><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input id="newExTarget" type="number" inputmode="decimal" value="12" placeholder="Target reps"><input id="newExRest" type="number" inputmode="decimal" value="90" placeholder="Rest (sec)"></div><select id="newExType"><option value="upper">Upper body</option><option value="lower">Lower body</option><option value="small">Small / isolation</option><option value="body">Bodyweight</option></select>${segRow("Equip", "data-new-equip", EQUIP_OPTIONS, newExEquip)}${segRow("Weight", "data-new-mode", loadOptions(newExEquip), newExMode)}<button class="submit" type="submit">Add to archive + ${editorDay}</button></form></div></section>`;
    stage.querySelector("#editorBack").addEventListener("click", showHome);
    stage.querySelectorAll("[data-day]").forEach((b) =>
      b.addEventListener("click", () => {
        editorDay = b.dataset.day;
        swappingExIdx = null;
        renderWorkoutEditor();
      }),
    );
    const retoggle = (attr, field) =>
      stage.querySelectorAll(`[${attr}]`).forEach((b) =>
        b.addEventListener("click", () => {
          const ex = db.templates[editorDay].ex[Number(b.getAttribute(attr))];
          if (!ex || ex[field === "equip" ? 5 : 6] === b.dataset.seg) return;
          setExerciseField(ex[0], field, b.dataset.seg);
          rerenderEditor();
        }),
      );
    retoggle("data-equip", "equip");
    retoggle("data-loadmode", "mode");
    // The new-exercise toggles only flip local state — re-rendering here would
    // wipe the name/reps/rest the user is part-way through typing.
    const pickNew = (attr, set) =>
      stage.querySelectorAll(`[${attr}]`).forEach((b) =>
        b.addEventListener("click", () => {
          set(b.dataset.seg);
          stage.querySelectorAll(`[${attr}]`).forEach((x) => {
            x.classList.toggle("on", x === b);
            x.setAttribute("aria-pressed", String(x === b));
          });
        }),
      );
    pickNew("data-new-equip", (v) => {
      newExEquip = v;
      const modeBtn = stage.querySelector('[data-new-mode][data-seg="perSide"]');
      if (modeBtn) modeBtn.textContent = v === "dumbbell" ? "Per hand" : "Per side";
    });
    pickNew("data-new-mode", (v) => (newExMode = v));
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
        db.templates[editorDay].ex[i] = [a.id, a.name, a.target, a.rest, a.type, a.equip, a.mode];
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
            db.templates[editorDay].ex.push([a.id, a.name, a.target, a.rest, a.type, a.equip, a.mode]);
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
      const equip = newExEquip;
      const mode = newExMode;
      const id = slugify(name);
      db.exerciseArchive.push({ id, name, target, rest, type, equip, mode });
      db.templates[editorDay].ex.push([id, name, target, rest, type, equip, mode]);
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

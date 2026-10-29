require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const config = require("../config.json");

const OUTPUT_FILE  = path.join(__dirname, "..", "cache", "linkedin_posts.json");
const CSV_FILE     = path.join(__dirname, "..", "csv_output", "linkedin_posts.csv");
const TARGET_POSTS = config.targetPosts || process.env.TARGET_POSTS || 500;
const rawQuery = (config.searchQuery || config.searchTerms || process.env.LINKEDIN_SEARCH_QUERY || '("react developer" OR "frontend developer") AND (hiring OR recruiting OR "job opening" OR "we\'re hiring")').trim();
const SEARCH_QUERY = encodeURIComponent(rawQuery);
const SEARCH_URL   = `https://www.linkedin.com/search/results/content/?keywords=${SEARCH_QUERY}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}
function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
function isBrowserClosedError(error) {
  const message = error && error.message ? error.message : String(error || "");
  return /(Target page, context or browser has been closed|Browser has been closed|browser has been closed|Execution context was destroyed|WebSocket.*closed|disconnected)/i.test(message);
}
function saveJSON(posts, outputFile = OUTPUT_FILE) {
  ensureDir(outputFile);
  fs.writeFileSync(outputFile, JSON.stringify(posts, null, 2), "utf-8");
  console.log(` Auto-saved ${posts.length} posts ${outputFile}`);
}
function saveCSV(posts, outputFile = CSV_FILE) {
  ensureDir(outputFile);
  const headers = ["id","author","authorHeadline","timestamp","content","likes","comments","reposts","postUrl"];
  const rows = posts.map(p =>
    headers.map(h => `"${String(p[h]||"").replace(/"/g,'""')}"`).join(",")
  );
  fs.writeFileSync(outputFile, [headers.join(","), ...rows].join("\n"), "utf-8");
  console.log(` Saved CSV → ${outputFile}`);
}
function saveCollectedPosts(posts, options = {}) {
  const jsonPath = options.jsonPath || OUTPUT_FILE;
  const csvPath = options.csvPath || CSV_FILE;
  const cleanPosts = dedupe(posts || []);
  if (!cleanPosts.length) {
    console.log("No posts collected yet; skipping save.");
    return 0;
  }
  saveJSON(cleanPosts, jsonPath);
  saveCSV(cleanPosts, csvPath);
  return cleanPosts.length;
}

async function countCards(page) {
  return await page.evaluate(() =>
    [...document.querySelectorAll("div[role='listitem']")]
      .filter(el => el.innerText?.includes("Feed post") || el.innerText?.trim().length > 80)
      .length
  );
}

async function extractAll(page) {
  return await page.evaluate(() => {
    const results = [];
    const cards = [...document.querySelectorAll("div[role='listitem']")]
      .filter(el => el.innerText?.includes("Feed post") || el.innerText?.trim().length > 80);

    cards.forEach((card, idx) => {
      try {
        const fullText = card.innerText || "";
        if (fullText.trim().length < 30) return;

        const paragraphs = [...card.querySelectorAll("p")]
          .map(p => p.innerText?.trim())
          .filter(t => t && t.length > 30);
        const spans = [...card.querySelectorAll("span")]
          .map(s => s.innerText?.trim())
          .filter(t => t && t.length > 60 && !t.startsWith("Follow") && !t.startsWith("Connect"));

        let content = "";
        if (paragraphs.length > 0) {
          content = paragraphs.sort((a, b) => b.length - a.length)[0];
        } else if (spans.length > 0) {
          content = spans.sort((a, b) => b.length - a.length)[0];
        }
        if (!content || content.length < 20) return;

        const links = [...card.querySelectorAll("a")];
        let author = "";
        let postUrl = "";
        for (const a of links) {
          const href = a.href || "";
          const text = a.innerText?.trim() || "";
          if (href.includes("/in/") && text.length > 1 && text.length < 80 && !text.includes("\n")) {
            author = text; break;
          }
        }
        if (!author) {
          const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
          const fi = lines.findIndex(l => l === "Feed post");
          if (fi >= 0 && lines[fi + 1]) author = lines[fi + 1];
        }

        for (const a of links) {
          const href = a.href || "";
          if (href.includes("/feed/update/") || href.includes("activity") || href.includes("/posts/")) {
            postUrl = href; break;
          }
        }

        const timeEl = card.querySelector("time");
        const timestamp = timeEl
          ? (timeEl.getAttribute("datetime") || timeEl.innerText?.trim() || "")
          : (fullText.match(/(\d+[mhd])\s*•/)?.[1] || "");

        const shortParas = [...card.querySelectorAll("p")]
          .map(p => p.innerText?.trim())
          .filter(t => t && t.length > 5 && t.length < 150 && t !== author);
        const authorHeadline = shortParas[0] || "";

        const reactionEl = card.querySelector("[aria-label*='reaction'],[aria-label*='like']");
        const likes = reactionEl
          ? (reactionEl.getAttribute("aria-label")?.match(/(\d[\d,]*)/)?.[1] || reactionEl.innerText?.trim() || "0")
          : (fullText.match(/(\d[\d,]*)\s*reaction/i)?.[1] || "0");

        const commentEl = card.querySelector("[aria-label*='comment']");
        const comments = commentEl
          ? (commentEl.getAttribute("aria-label")?.match(/(\d[\d,]*)/)?.[1] || commentEl.innerText?.trim() || "0")
          : (fullText.match(/(\d[\d,]*)\s*comment/i)?.[1] || "0");

        const repostEl = card.querySelector("[aria-label*='repost']");
        const reposts = repostEl
          ? (repostEl.getAttribute("aria-label")?.match(/(\d[\d,]*)/)?.[1] || repostEl.innerText?.trim() || "0")
          : (fullText.match(/(\d[\d,]*)\s*repost/i)?.[1] || "0");

        const id = card.getAttribute("data-urn")
          || card.getAttribute("id")
          || `post_${idx}_${content.slice(0,20).replace(/\W/g,"_")}`;

        results.push({ id, author, authorHeadline, timestamp, content, likes, comments, reposts, postUrl });
      } catch (_) {}
    });

    return results;
  });
}

function dedupe(posts) {
  const seen = new Set();
  return posts.filter(p => {
    const key = p.content?.slice(0, 100);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createGracefulShutdown({ getPosts, browser, exitCode = 0 }) {
  let hasExited = false;

  return async function gracefulExit(reason) {
    if (hasExited) return;
    hasExited = true;

    console.log(`\n⚠️  Scraper stopped: ${reason}. Saving the current results before continuing...`);
    const posts = getPosts ? getPosts() : [];
    saveCollectedPosts(posts);

    try {
      if (browser && typeof browser.close === "function") {
        await browser.close();
      }
    } catch (_) {}

    process.exit(exitCode);
  };
}

// ── Smooth continuous auto-scroll (human-like, no manual input needed) ────
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalScrolled = 0;
      const maxScroll = 3000;
      const tick = () => {
        const step = Math.floor(Math.random() * 120) + 60;
        window.scrollBy(0, step);
        totalScrolled += step;
        const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
        if (totalScrolled >= maxScroll || atBottom) {
          resolve();
        } else {
          setTimeout(tick, Math.floor(Math.random() * 50) + 30);
        }
      };
      tick();
    });
  });
}

// ── Wait for DOM card count to grow (with timeout) ────────────────────────
async function waitForNewCards(page, previousCount, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(400);
    const current = await countCards(page);
    if (current > previousCount) return current;
  }
  return await countCards(page);
}

// ── Click "Show more results" if the button is present ────────────────────
async function clickShowMore(page) {
  try {
    const btn = await page.$("button:has-text('Show more results')");
    if (btn) {
      const visible = await btn.isVisible();
      if (visible) {
        await btn.scrollIntoViewIfNeeded();
        await sleep(500);
        await btn.click();
        console.log("  ▶ Clicked 'Show more results'");
        await sleep(3000);
        return true;
      }
    }
  } catch (_) {}
  return false;
}

// ── Get the first two visible, enabled input fields on the page ───────────
// Works regardless of what LinkedIn names/IDs them
async function getLoginInputs(page) {
  console.log("  🔍 Locating login input fields by position...");

  // Poll until at least 2 usable inputs exist
  await page.waitForFunction(() => {
    const inputs = [...document.querySelectorAll("input")].filter(el => {
      const t = (el.type || "").toLowerCase();
      return (
        !["hidden","checkbox","radio","submit","button","file","image","reset"].includes(t) &&
        !el.hidden &&
        el.offsetParent !== null &&
        !el.disabled &&
        !el.readOnly
      );
    });
    return inputs.length >= 2;
  }, { timeout: 20000 });

  // Collect all matching visible+enabled inputs
  const allInputs = page.locator(
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio'])" +
    ":not([type='submit']):not([type='button']):not([type='file'])" +
    ":not([type='image']):not([type='reset'])"
  );

  const visibleInputs = [];
  const total = await allInputs.count();
  for (let i = 0; i < total; i++) {
    const el = allInputs.nth(i);
    if (await el.isVisible() && await el.isEnabled()) {
      visibleInputs.push(el);
      if (visibleInputs.length === 2) break;
    }
  }

  if (visibleInputs.length < 2) {
    throw new Error(`❌ Expected 2 login inputs, only found ${visibleInputs.length}`);
  }

  console.log(`  ✅ Found ${visibleInputs.length} input fields (using first two)`);
  return visibleInputs; // [0] = email/username, [1] = password
}

// ── Fill one input locator reliably, retrying if field stays empty ─────────
async function fillInput(locator, value, label) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(200);
  await locator.click();
  await sleep(200);

  // Clear any pre-filled / ghost / autofill value
  await locator.press("Control+A");
  await locator.press("Delete");
  await sleep(150);

  // Type with human-like per-character delay
  await locator.pressSequentially(value, { delay: Math.floor(Math.random() * 50) + 40 });

  // Verify and retry up to 2 more times if field is empty
  for (let attempt = 1; attempt <= 3; attempt++) {
    const filled = await locator.inputValue();
    if (filled.length > 0) {
      console.log(`  ✅ ${label} filled (${filled.length} chars)`);
      return;
    }
    console.log(`  ⚠️  ${label} empty (attempt ${attempt}/3) — retrying...`);
    await locator.click({ clickCount: 3 });
    await sleep(200);
    await locator.press("Delete");
    await sleep(150);
    await locator.pressSequentially(value, { delay: 70 });
  }

  const final = await locator.inputValue();
  if (final.length === 0) throw new Error(`❌ Could not fill ${label} after 3 attempts`);
  console.log(`  ✅ ${label} filled (${final.length} chars)`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
let allPosts = [];

(async () => {
  console.log("🚀 LinkedIn Scraper — Auto-Scroll Mode");
  console.log(`🎯 Target: ${TARGET_POSTS} posts\n`);

  let browser;
  const gracefulExit = createGracefulShutdown({
    getPosts: () => allPosts,
    browser: null,
    exitCode: 0,
  });

  process.on("SIGINT", () => {
    gracefulExit("SIGINT");
  });

  process.on("SIGTERM", () => {
    gracefulExit("SIGTERM");
  });

  process.on("uncaughtException", (error) => {
    if (isBrowserClosedError(error)) {
      gracefulExit("browser closed");
      return;
    }
    console.error("Unhandled scraper error:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (error) => {
    if (isBrowserClosedError(error)) {
      gracefulExit("browser disconnected");
      return;
    }
    console.error("Unhandled scraper rejection:", error);
    process.exit(1);
  });

  try {
    browser = await chromium.launch({
      headless: false,
      slowMo: 30,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--start-maximized"],
    });
    const currentBrowser = browser;
    gracefulExit.browser = currentBrowser;
    currentBrowser.on("disconnected", () => {
      gracefulExit("browser disconnected");
    });

    const context = await currentBrowser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();

  // ── Login ─────────────────────────────────────────────────────────────
  console.log("🔐 Logging in...");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "load" });
  await sleep(2000); // let JS hydration finish after the load event fires

  // Find the two inputs by DOM position — immune to LinkedIn renaming IDs
  const [emailInput, passwordInput] = await getLoginInputs(page);

  await fillInput(emailInput,    process.env.LINKEDIN_EMAIL,    "Email");
  await randomDelay(400, 700);
  await fillInput(passwordInput, process.env.LINKEDIN_PASSWORD, "Password");
  await randomDelay(400, 700);

  // Submit — locate by visible text since LinkedIn uses randomised class names
  // and type="button" instead of type="submit". Try multiple strategies in order.
  console.log("  🖱️  Clicking sign in button...");
  const signInBtn = page.locator(
    'button:has-text("Sign in"), button:has-text("Sign In"), ' +
    'button:has-text("Log in"), button:has-text("Log In"), ' +
    '[type="submit"]'
  ).first();

  const btnFound = await signInBtn.isVisible().catch(() => false);
  if (btnFound) {
    await signInBtn.scrollIntoViewIfNeeded();
    await sleep(300);
    await signInBtn.click();
    console.log("  ✅ Clicked sign in button");
  } else {
    // Fallback: press Enter from the password field — always works
    console.log("  ⚠️  Button not found — pressing Enter on password field");
    await passwordInput.press("Enter");
  }

  try { await page.waitForURL(/linkedin\.com\/(feed|checkpoint)/, { timeout: 25000 }); }
  catch { await sleep(10000); }
  if (page.url().includes("checkpoint")) {
    console.log("⚠️  Complete verification in browser. Waiting 60s...");
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 60000 });
  }
  console.log("✅ Logged in!\n");
  await randomDelay(2000, 3000);

  // ── Navigate to search page ───────────────────────────────────────────
  console.log("🔍 Loading search page...");
  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
  try { await page.waitForSelector("div[role='listitem']", { timeout: 15000 }); }
  catch { /* proceed anyway */ }
  await sleep(4000);
  console.log("✅ Page loaded!\n");
  console.log("📜 Auto-scrolling and collecting posts...\n");

  // ── MAIN AUTO-SCROLL LOOP ─────────────────────────────────────────────
  let round      = 0;
  let stuckCount = 0;
  const MAX_STUCK = 6;

  while (allPosts.length < TARGET_POSTS && stuckCount < MAX_STUCK) {
    round++;

    const cardsBefore = await countCards(page);

    // 1. Smooth auto-scroll
    await autoScroll(page);

    // 2. Try "Show more results" button
    const clicked = await clickShowMore(page);

    // 3. Wait for LinkedIn to inject new cards
    const cardsAfter = clicked
      ? await waitForNewCards(page, cardsBefore, 8000)
      : await waitForNewCards(page, cardsBefore, 6000);

    // 4. Extract & deduplicate
    const freshPosts = await extractAll(page);
    const before = allPosts.length;
    allPosts = dedupe([...allPosts, ...freshPosts]);
    const added = allPosts.length - before;

    console.log(
      `  Round ${round}: cards ${cardsBefore}→${cardsAfter} | ` +
      `extracted ${freshPosts.length} | +${added} new | total ${allPosts.length}/${TARGET_POSTS}`
    );

    if (cardsAfter <= cardsBefore && added === 0) {
      stuckCount++;
      console.log(`  ⏳ No new content (${stuckCount}/${MAX_STUCK}) — pausing before retry...`);
      await page.evaluate(() => window.scrollBy(0, -500));
      await sleep(3000 + stuckCount * 1000);
    } else {
      stuckCount = 0;
    }

    if (allPosts.length > 0 && allPosts.length % 50 === 0) saveJSON(allPosts);
    if (allPosts.length >= TARGET_POSTS) break;

    await randomDelay(800, 1800);
  }

  // ── Final save ────────────────────────────────────────────────────────
  console.log(`\n✅ Done! Collected ${allPosts.length} posts.`);
  saveCollectedPosts(allPosts);
  await browser.close();
  console.log("🎉 Complete! Check linkedin_posts.json and linkedin_posts.csv");
  process.exit(0);
  } catch (error) {
    if (isBrowserClosedError(error)) {
      await gracefulExit("browser closed");
      return;
    }

    console.error("\n❌ Scraper failed:", error?.message || error);
    saveCollectedPosts(allPosts);
    process.exit(1);
  }
})();

module.exports = {
  dedupe,
  saveJSON,
  saveCSV,
  saveCollectedPosts,
  isBrowserClosedError,
  createGracefulShutdown,
};

const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.join(__dirname, "..", "cache", "linkedin_posts.json");
const OUTPUT_CSV = path.join(__dirname, "..", "csv_output", "phone_numbers.csv");

const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{4,6}/g;

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  const trimmed = digits.replace(/^0+/, "");
  if (trimmed.length < 10) return null;
  return trimmed;
}

function sanitizePhone(raw) {
  const cleaned = String(raw || "").replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : null;
}

try {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const posts = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const seen = new Set();
  const rows = [];

  posts.forEach(post => {
    const text = post.content || "";
    const matches = text.match(PHONE_REGEX) || [];

    matches.forEach(match => {
      const normalized = normalizePhone(match);
      if (!normalized) return;

      const cleaned = sanitizePhone(match);
      if (!cleaned) return;

      const key = normalized;
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        phone_number: cleaned,
        post_id: post.id || "",
        author: post.author || ""
      });
    });
  });

  const csvHeader = "phone_number,post_id,author\n";
  const csvRows = rows
    .map(row => {
      const phone = row.phone_number.replace(/"/g, '""');
      const postId = String(row.post_id || "").replace(/"/g, '""');
      const author = String(row.author || "").replace(/"/g, '""');
      return `"${phone}",${postId ? `"${postId}"` : ""},${author ? `"${author}"` : ""}`;
    })
    .join("\n");

  const csvContent = csvHeader + csvRows;

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csvContent, "utf-8");

  console.log(`✅ Extracted ${rows.length} phone number(s)`);
  console.log(`📊 Saved to ${OUTPUT_CSV}`);
} catch (error) {
  console.error("❌ Error extracting phone numbers:", error.message);
  process.exit(1);
}

const fs = require("fs");
const path = require("path");

const EMAIL_REGEX = /[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.(com|in|org|net|edu|gov|io|co|uk|ca|au|de|fr|jp|cn|ru|br|mx|it|es|nl|se|ch|be|at|nz|sg|hk|ae|sa|za|kr|tw|th|vn|ph|id|my|pk|bd|lk|ng|ke|eg|tr|il|no|dk|fi|gr|pt|cz|pl|ro|ua|bg|hr|sk|hu|si|lt|lv|ee|is|ie|il|mx|ar|cl|co|ve|pe|uy|bo|py|ec|gy|sr|fk|gl|pm|re|mu|sc|km|dz|tn|ly|sd|et|sd|dj|so|er|jm|bs|bb|tt|ky|ag|vc|lc|dm|gd|kn|ai|vg|tc|ms|bm|gi)/gi;

const INPUT_FILE = path.join(__dirname, "..", "cache", "linkedin_posts.json");
const OUTPUT_CSV = path.join(__dirname, "..", "csv_output", "emails.csv");

function parseExistingEmails(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.trim()) return [];

  const rows = [];
  let inQuotes = false;
  let row = [];
  let field = "";

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    if (row.length) rows.push(row);
    row = [];
  };

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      pushField();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[i + 1] === "\n") i++;
      pushField();
      pushRow();
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    pushField();
    pushRow();
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const entries = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const rowObj = {};
    headers.forEach((header, idx) => {
      rowObj[header] = (values[idx] || "").trim();
    });

    if (rowObj.email) {
      entries.push(rowObj);
    }
  }

  return entries;
}

function csvEscape(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

try {
  const posts = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const existingRows = parseExistingEmails(OUTPUT_CSV);
  const existingEmails = new Set(existingRows.map(row => (row.email || "").toLowerCase()));
  const emails = [];

  posts.forEach(post => {
    const content = post.content || "";
    const matches = content.match(EMAIL_REGEX);

    if (matches) {
      const uniqueEmails = [...new Set(matches.map(e => e.toLowerCase()))].filter(e => !e.endsWith('@gmail.com'));
      uniqueEmails.forEach(email => {
        if (existingEmails.has(email)) return;

        const [localPart, domainPart] = email.split("@");
        const name = localPart.replace(/[._-]/g, " ").trim();
        const company = domainPart.split(".")[0];
        const safeContent = (post.content || "").replace(/"/g, '""');
        emails.push({
          email,
          name,
          company,
          content: safeContent,
          status: "new",
          dateAdded: new Date().toISOString()
        });
        existingEmails.add(email);
      });
    }
  });

  const mergedRows = [
    ...existingRows,
    ...emails.map(e => ({
      email: e.email,
      name: e.name,
      company: e.company,
      content: e.content,
      status: e.status,
      "date added": e.dateAdded
    }))
  ];

  const columns = [
    ["email", "email"],
    ["name", "name"],
    ["company", "company"],
    ["content", "content"],
    ["status", "status"],
    ["Date Added", "date added"]
  ];
  const csvRows = mergedRows.map(row => columns.map(([, key]) => csvEscape(row[key] ?? "")).join(",")).join("\n");
  const csvContent = columns.map(([header]) => header).join(",") + "\n" + csvRows + "\n";

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csvContent, "utf-8");

  console.log(`✅ Extracted ${emails.length} new email(s)`);
  console.log(`📊 Saved to ${OUTPUT_CSV}`);
} catch (error) {
  console.error("❌ Error:", error.message);
}

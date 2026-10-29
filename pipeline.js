const { spawn } = require("child_process");
const path = require("path");

console.log("\n🚀 Email Automation Pipeline");
console.log("============================\n");

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const normalized = scriptName.startsWith("./") || scriptName.startsWith("../") || scriptName.includes("/")
      ? scriptName
      : `scripts/${scriptName}`;

    const scriptPath = path.resolve(__dirname, normalized);
    console.log(`⏳ Running ${scriptName}...\n`);

    const process = spawn("node", [scriptPath], {
      stdio: "inherit",
      cwd: __dirname
    });

    process.on("close", (code) => {
      if (code === 0) {
        console.log(`\n✅ ${scriptName} completed successfully\n`);
        resolve();
      } else if (scriptName === "scraper.js") {
        console.log(`\n⚠️  ${scriptName} exited with code ${code}. Continuing with saved data if available.\n`);
        resolve();
      } else {
        reject(new Error(`${scriptName} failed with code ${code}`));
      }
    });

    process.on("error", (err) => {
      reject(err);
    });
  });
}

(async () => {
  try {
    // Step 1: Run scraper.js
    await runScript("scraper.js");

    // Step 2: Run extract_emails.js
    await runScript("extract_emails.js");

    // Step 3: Run extract_phone_numbers.js
    await runScript("extract_phone_numbers.js");

    // Step 4: Run email sender
    await runScript("email-sender/email-sender.js");

    console.log("🎉 Pipeline completed successfully!");
    console.log("\n📁 Output files:");
    console.log("   cache/linkedin_posts.json");
    console.log("   csv_output/linkedin_posts.csv");
    console.log("   csv_output/emails.csv\n");

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Pipeline failed: ${error.message}\n`);
    process.exit(1);
  }
})();

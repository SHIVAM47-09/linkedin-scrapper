# Email Automation Pipeline

Automated tool to scrape LinkedIn job posts, extract email addresses, and send personalized job application emails.

## How It Works

```
Scraper.js → LinkedIn Posts (JSON)
    ↓
Extract Emails → Email List (CSV)
    ↓
Email Sender → Send Emails Automatically
```

## Setup

### 1. Install Dependencies

```bash
cd linkedin-scrapper
npm install
```

### 2. Configure LinkedIn Credentials

Edit `.env` file:

```env
# LinkedIn login credentials
LINKEDIN_EMAIL=your-email@gmail.com
LINKEDIN_PASSWORD=your-password
```

### 3. Configure Gmail (Email Sender)

**Step 1: Enable 2-Factor Authentication**

- Go to [myaccount.google.com/security](https://myaccount.google.com/security)
- Enable 2-Step Verification

**Step 2: Generate App Password**

- In Security settings, find "App passwords"
- Select: Mail + Windows Computer
- Copy the 16-character password

**Step 3: Update .env**

```env
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=xxxx xxxx xxxx xxxx
```

### 4. Optional: Customize Email Template

Edit `config.json`:

- Change `emailTemplate.from` (sender name/email)
- Change `emailTemplate.subject` (email subject)
- Change `emailTemplate.html` (email body)
- Use `{{firstName}}` and `{{company}}` as template variables

## Running the Pipeline

**Run everything automatically:**

```bash
node pipeline.js
```

This runs:

1. **Scraper** - Scrapes LinkedIn for job posts (~10-15 min)
2. **Email Extractor** - Extracts emails from posts
3. **Email Sender** - Sends personalized emails to extracted addresses

**Run individual scripts:**

```bash
# Just scrape LinkedIn
node scripts/scraper.js

# Just extract emails
node scripts/extract_emails.js

# Just send emails
node email-sender/email-sender.js
```

## File Structure

```
linkedin-scrapper/
├── pipeline.js                 # Master script (run this!)
├── .env                        # Credentials (SECRET - never commit)
├── .env.example                # Template for .env
├── config.json                 # Email template & config
├── scripts/
│   ├── scraper.js             # LinkedIn scraper
│   └── extract_emails.js      # Email extractor
├── email-sender/
│   ├── email-sender.js        # Email sender
│   └── Shivam_Sharma_Nodejs_Developer_3Year.pdf # Resume to attach
├── cache/
│   └── linkedin_posts.json    # Scraped posts (intermediate)
└── csv_output/
    ├── emails.csv             # Extracted emails
    ├── linkedin_posts.csv     # Posts as CSV
    └── phone_numbers.csv      # Phone numbers (if found)
```

## Important Notes

⚠️ **Security:**

- `.env` contains credentials - never commit it to git
- `.gitignore` is configured to protect `.env`
- Use App Passwords for Gmail, not regular passwords

📧 **Email Delays:**

- 2-second delay between emails to avoid Gmail rate limiting
- Scraping has randomized delays to avoid LinkedIn detection

🔍 **LinkedIn Changes:**

- If scraper stops working, LinkedIn may have updated their website
- CSS selectors may need updating in `scraper.js`

## Troubleshooting

**"Cannot reach smtp.gmail.com"**

- Check internet connection
- Verify firewall isn't blocking port 587
- Try a VPN if in restricted network

**"Invalid login" error**

- Make sure you're using 16-character App Password, not regular password
- Verify EMAIL_USER and EMAIL_PASSWORD are correct
- Check 2FA is enabled on your Gmail

**LinkedIn scraper finds 0 posts**

- LinkedIn may have updated their HTML structure
- Run `diagonose.js` to inspect the new DOM (if kept)
- Update CSS selectors in `scraper.js`

**Too many requests error**

- Reduce `TARGET_POSTS` in `.env`
- LinkedIn blocks aggressive scrapers
- Wait 24 hours before retrying

## Testing

**Test email sender only** (without scraping):

```bash
node email-sender/email-sender.js
```

**Create test email in csv_output/emails.csv:**

```csv
email,name,company,content
your-test@gmail.com,John,TestCo,"Test job posting"
```

Then run email-sender to test.

## License

For personal use only.

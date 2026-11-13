const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');

// Load environment variables if dotenv is available
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
} catch (e) {
  // dotenv not installed, use environment variables directly
}

const RESUME_PATH = path.join(__dirname, 'Shivam_Sharma_Nodejs_Developer_3Year.pdf');
const CSV_FILE = path.join(__dirname, '../csv_output/emails.csv');
const config = require('../config.json');

// Validate environment variables
const requiredEnvVars = ['EMAIL_USER', 'EMAIL_PASSWORD'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing environment variable: ${envVar}`);
    console.log(`   Make sure .env file contains ${envVar}`);
    process.exit(1);
  }
}

process.env.EMAIL_USER = String(process.env.EMAIL_USER).trim();
process.env.EMAIL_PASSWORD = String(process.env.EMAIL_PASSWORD).replace(/\s+/g, '');

// Parse CSV while preserving quoted values and multi-line content
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = [];
  let inQuotes = false;
  let row = [];
  let field = '';

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length) {
      rows.push(row);
    }
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

    if (char === ',' && !inQuotes) {
      pushField();
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i++;
      }
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

  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const data = [];

  for (let i = 1; i < rows.length; i++) {
    const rowValues = rows[i];
    const rowObj = {};
    headers.forEach((header, idx) => {
      rowObj[header] = (rowValues[idx] || '').trim();
    });

    if (rowObj.email && rowObj.email.includes('@')) {
      data.push(rowObj);
    }
  }

  return data;
}

function writeCSV(rows) {
  const header = ['email', 'name', 'company', 'content', 'status', 'date added'];
  const csvRows = rows.map(row => {
    return header.map(field => `"${String(row[field] || '').replace(/"/g, '""')}"`).join(',');
  });

  const content = [['email', 'name', 'company', 'content', 'status', 'Date Added'].join(','), ...csvRows].join('\n') + '\n';
  fs.writeFileSync(CSV_FILE, content, 'utf-8');
}

function markEmailStatus(email, nextStatus) {
  const rows = parseCSV(CSV_FILE);
  const updated = rows.map(row => {
    if ((row.email || '').toLowerCase() === String(email).trim().toLowerCase()) {
      row.status = nextStatus;
    }
    return row;
  });
  writeCSV(updated);
}

// Load emails from CSV
let emailData = [];
try {
  emailData = parseCSV(CSV_FILE).filter(row => {
    const status = String(row.status || 'sent').toLowerCase();
    return status === 'new';
  });
  console.log(`✅ Loaded ${emailData.length} new emails from ${CSV_FILE}\n`);
  if (emailData.length === 0) {
    console.log('⚠️  No new emails found in CSV. Nothing to send.');
    process.exit(0);
  }
} catch (error) {
  console.error(`❌ Error reading CSV: ${error.message}`);
  console.log('   Make sure to run pipeline.js first to generate emails.csv');
  process.exit(1);
}

// Email configuration - Gmail SMTP
const newTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,  // TLS port (more reliable than 465)
    secure: true,  // Use STARTTLS instead of SSL
    requireTLS: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    logger: false,
    debug: false,
    connectionTimeout: 10000,
    socketTimeout: 10000
  });
};

const transporter = newTransporter();

const sendEmail = async (row) => {
  const { email, name, company, content } = row;

  // Skip invalid emails
  if (!email || !email.includes('@')) {
    console.log(`⏭️  Skipping invalid email: ${email}`);
    return;
  }

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    console.log(`⏭️  Skipping malformed email: ${email}`);
    return;
  }
  
  const nameParts = name && name.split(' ');
  const firstName = nameParts?.[0] || 'Hiring Manager';
  const companyName = company || 'Your esteemed Organization';
  
  // Apply template variables
  const emailTemplate = config.emailTemplate;
  const htmlContent = emailTemplate.html
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{company}}/g, companyName);

  const senderName = (emailTemplate.from || '').match(/^(.+?)\s*<.*>$/)?.[1]?.trim() || 'Lets Connect';
  const senderEmail = process.env.EMAIL_USER || (emailTemplate.from || '').match(/<([^>]+)>/)?.[1] || 'letsconnectdhruv@gmail.com';
  
  const mailOptions = {
    from: `${senderName} <${senderEmail}>`,
    to: email,
    subject: emailTemplate.subject.replace(/{{company}}/g, companyName),
    attachments: [
      {
        filename: emailTemplate.resumeFilename,
        path: RESUME_PATH,
      }
    ],
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    markEmailStatus(email, 'sent');
    console.log(`✅ Email sent to ${email}`);
  } catch (error) { 
    console.error(`❌ Error sending email to ${email}`);
    console.error(`   Error: ${error.message}`);
    
    // Diagnose common issues
    if (error.message.includes('ENOTFOUND')) {
      console.error(`   → Network issue: Cannot reach smtp.gmail.com`);
      console.error(`   → Check: Internet connection, firewall, or VPN`);
    } else if (error.message.includes('Invalid login')) {
      console.error(`   → Authentication failed`);
      console.error(`   → Check: EMAIL_USER and EMAIL_PASSWORD in .env`);
      console.error(`   → Make sure you're using an App Password, not regular Gmail password`);
    } else if (error.message.includes('ECONNRESET')) {
      console.error(`   → Connection was reset by Gmail`);
      console.error(`   → Try: Waiting a moment before retrying`);
    }
  }
};

const sendEmailsSynchronously = async () => {
  console.log(`📧 Sending ${emailData.length} emails...\n`);
  
  for (const [index, row] of emailData.entries()) {
    console.log(`[${index + 1}/${emailData.length}] Processing ${row.email}...`);
    await sendEmail(row);
    // Add delay between emails to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n✨ Batch complete!`);
};

// Call the function to send emails
(async () => {
  try {
    await sendEmailsSynchronously();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();

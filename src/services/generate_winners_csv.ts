import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { format } from 'fast-csv';

// 1. Configuration & Setup
const baseCsvPath = path.join(process.cwd(), 'csv');
const audience_Offer_FilePath = path.join(baseCsvPath, 'audience_offer');
const winnersFilePath = path.join(baseCsvPath, 'winners');

// Automatically create the audience_offer and winners folders if they don't exist
if (!fs.existsSync(audience_Offer_FilePath)) {
  fs.mkdirSync(audience_Offer_FilePath, { recursive: true });
}
if (!fs.existsSync(winnersFilePath)) {
  fs.mkdirSync(winnersFilePath, { recursive: true });
}

// Regular expressions for file name parsing
const DATE_RE = /(\d{4})[-_](\d{2})[-_](\d{2})(?=\.csv$)/;          // yyyy-mm-dd or yyyy_mm_dd at end
const COMP_FILE_RE = /^(comp\d+).*?(audience|offer).*?\.csv$/i;     // compxxxx + audience/offer


// // used.json - record used customer ID each time
// const usedPath = path.join(baseCsvPath, 'used_customer_ids.json');
// const usedCustomerIds = new Set<string>();
// if (fs.existsSync(usedPath)) {
//   try {
//     const usedData = JSON.parse(fs.readFileSync(usedPath, 'utf-8'));
//     usedData.forEach((id: string) => usedCustomerIds.add(id));
//   } catch (err) {
//     console.error('!! Failed to parse used.json:', err);
//   }
// }

// Running mode - strict/manual
const MODE = (process.env.MODE as 'strict' | 'manual') ?? 'strict';
const TARGET_COUNT = parseInt(process.env.TARGET_COUNT || '100', 10);

// ================= Utils =================

// Getting current timestamp in AEST sydney time - used for winners.csv's created_date_time field
function nowSydneyTimestamp(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(new Date()).replace('T', ' ');
}
const createdDateTime = nowSydneyTimestamp();

// generate winner file name
function generateOutputFilename(audienceFilePath: string): string {
  const originalName = path.basename(audienceFilePath);
  const baseName = originalName.replace(/audience/i, 'winners'); // replace audience to winners
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const timeSuffix = `${hh}_${mm}`; // add hh_mm by end of file name
  return baseName.replace(/(\d{4}-\d{2}-\d{2})(?:_\d{2}_\d{2})?/, `$1_${timeSuffix}`);
}

// // Scan and load all history csv file under csv/ folder, collect all customer_id and exclude - deduplication
// function loadUsedFromWinnersCsv(): Set<string> {
//   const ids = new Set<string>();
//   const winnerFiles = fs.readdirSync(baseCsvPath).filter(f => /_winners_.*\.csv$/i.test(f));

//   for (const file of winnerFiles) {
//     const filePath = path.join(baseCsvPath, file);
//     const data = fs.readFileSync(filePath, 'utf-8');
//     const lines = data.split('\n');
//     const header = (lines[0] || '').replace(/^\uFEFF/, '').split(',');
//     const customerIdIndex = header.indexOf('customer_id');
//     if (customerIdIndex === -1) {
//       console.warn(`!! Skipped file without 'customer_id' column: ${file}`);
//       continue;
//     }
//     for (let i = 1; i < lines.length; i++) {
//       const line = lines[i].trim();
//       if (!line) continue;
//       const cols = line.split(',');
//       const customerId = cols[customerIdIndex]?.trim();
//       if (customerId) {
//         ids.add(customerId);
//       } else {
//         console.warn(`!! Ignored empty customer_id in file "${file}", line ${i + 1}`);
//       }
//     }
//   }
//   console.log(`Loaded ${ids.size} historical customer_id(s) from winners CSVs`);
//   return ids;
// }

// // Save newly used customer_id into used.json
// function saveUsedCustomerIds(ids: string[]): void {
//   ids.forEach(id => usedCustomerIds.add(id));
//   fs.writeFileSync(usedPath, JSON.stringify(Array.from(usedCustomerIds), null, 2));
// }

// Simple shuffle function - with seed to randomly allocate
function shuffle<T>(array: T[], seed: number): T[] {
  let currentIndex = array.length, temporaryValue: T, randomIndex: number;
  const random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  while (currentIndex !== 0) {
    randomIndex = Math.floor(random() * currentIndex);
    currentIndex -= 1;
    temporaryValue = array[currentIndex]!;
    array[currentIndex] = array[randomIndex]!;
    array[randomIndex] = temporaryValue!;
  }
  return array;
}

// helper function - only handle the latest date bathed on file name or modified time
function extractDateFromFilename(file: string): string | null {
  const match = file.match(DATE_RE);
  if(!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// =============== Multi-comp picker ===============
type FileType = 'audience' | 'offer';
type CompPair = { compId: string; audienceFile: string; offerFile: string };

function scoreCsvFile(fullPath: string): number {
  const stat = fs.statSync(fullPath);
  const mtime = stat.mtimeMs;

  const base = path.basename(fullPath);
  const match = base.match(DATE_RE);
  let nameTs: number | null = null;

  if (match) {
    const [_, y, m, d] = match;
    const parsed = new Date(`${y}-${m}-${d}T00:00:00Z`);
    if (!isNaN(parsed.getTime())) nameTs = parsed.getTime();
  }

  // same logic as your original: prefer the max(name date, mtime)
  return nameTs ? Math.max(nameTs, mtime) : mtime;
}

  function pickLatestCompPairs(dir: string): CompPair[] {
    console.log(`Scanning input folder: ${dir}`);
    const allFiles = fs.readdirSync(dir).filter(f => /\.csv$/i.test(f));
    // Step 1: find the latest date among all files
    let latestDate: string | null = null;
    for (const f of allFiles) {
      const d = extractDateFromFilename(f);
      if (!d) continue;
      if (!latestDate || d > latestDate) {
        latestDate = d;
      }
    }
    // Step 2: filter files to only include those with the latest date (if found)
    const files = latestDate
    ? allFiles.filter(f => extractDateFromFilename(f) === latestDate)
    : allFiles;

    console.log(`Latest batch date detected: ${latestDate}`);
    
    // Step 3: group files by compId and type, and pick the one with the highest score (latest activity)
    // compId -> { audience?: {path, score}, offer?: {path, score} }
    const map = new Map<string, {
      audience?: { p: string; s: number };
      offer?: { p: string; s: number };
    }>();

    for (const f of files) {
      const m = f.match(COMP_FILE_RE);
      if (!m) {
        console.log(`Skip file (no match): ${f}`);
        continue;
      }
      console.log(`Matched file: ${f} -> comp=${m[1]} type=${m[2]}`);
      const compId = m[1].toLowerCase();
      const type = m[2].toLowerCase() as FileType;
      const full = path.join(dir, f);
      const s = scoreCsvFile(full);

      if (!map.has(compId)) map.set(compId, {});
      const entry = map.get(compId)!;

      const cur = entry[type];
      if (!cur || s > cur.s) entry[type] = { p: full, s };
  }

  const pairs: CompPair[] = [];
  for (const [compId, v] of map.entries()) {
    if (v.audience && v.offer) {
      pairs.push({ compId, audienceFile: v.audience.p, offerFile: v.offer.p });
    } else {
      console.warn(
        `!! Skip ${compId}: missing ${!v.audience ? 'audience' : ''}${!v.audience && !v.offer ? ' & ' : ''}${!v.offer ? 'offer' : ''} file`
      );
    }
  }

  // sort by "latest comp activity" (max of the two scores) desc
  pairs.sort((a, b) => {
    const as = Math.max(scoreCsvFile(a.audienceFile), scoreCsvFile(a.offerFile));
    const bs = Math.max(scoreCsvFile(b.audienceFile), scoreCsvFile(b.offerFile));
    return bs - as;
  });

  console.log(`Detected ${pairs.length} comp pair(s): ${pairs.map(p => p.compId).join(', ')}`);
  return pairs;
}


// optional: only generate the newest comp
const ONLY_LATEST_COMP = (process.env.ONLY_LATEST_COMP ?? 'false').toLowerCase() === 'true';


// =============== Offer file - load & build offer pool ===============
async function generateForComp(audienceFilePath: string, offerFilePath: string): Promise<void> {
  const outputFile = path.join(winnersFilePath, generateOutputFilename(audienceFilePath));

  // per-comp state
  const offerLimitMap = new Map<string, number>();
  let expandedOffers: string[] = [];

  function loadOffers(): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(offerFilePath)
        .pipe(csv())
        .on('data', (row) => {
          if (row['offer_id'] && row['num_of_winners']) {
            const offerId = String(row['offer_id']).trim();
            const limit = parseInt(String(row['num_of_winners']), 10);
            if (!isNaN(limit)) offerLimitMap.set(offerId, limit);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

function buildExpandedOffersFromLimits(): string[] {
  const arr: string[] = [];
  offerLimitMap.forEach((limit, offerId) => {
    for (let i = 0; i < limit; i++) arr.push(offerId);
  });
  return arr;
}

// =============== Main process: deduplication, draw, allocation ===============
const filteredRows: any[] = [];

function processAudienceFile(): Promise<void> {
  return new Promise((resolve, reject) => {
    // const usedFromCsv = loadUsedFromWinnersCsv(); // deduplication
    const tempRows: any[] = [];
    const seenCustomerIds = new Set<string>();

    fs.createReadStream(audienceFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const raw = row['customer_id']?.trim?.() ?? String(row['customer_id'] || '').trim();
       const customerId = raw.trim();
        if (
          (customerId && !seenCustomerIds.has(customerId))
        ) {
          tempRows.push(row);
          seenCustomerIds.add(customerId);
        }
      })
      .on('end', () => {
        const capacity = expandedOffers.length;
        const requiredCount = (MODE === 'strict') ? capacity : Math.min(capacity, TARGET_COUNT);

        if (capacity <= 0) {
          return reject(new Error(`Offer capacity is 0. Check offer file: ${path.basename(offerFilePath)}`));
      }

        if (tempRows.length < requiredCount) {
          return reject(new Error(`Only ${tempRows.length} eligible rows found. Need at least ${requiredCount}.`));
        }

        const sampled = shuffle(tempRows, Date.now()).slice(0, requiredCount);
        const assignedOffers = shuffle(expandedOffers.slice(), Date.now()).slice(0, requiredCount);

        const offerCountMap = new Map<string, number>();
        sampled.forEach((row, index) => {
          const offerId = assignedOffers[index];
          row['offer_id'] = offerId;
          row['created_date_time'] = createdDateTime;
          filteredRows.push(row);
          offerCountMap.set(offerId, (offerCountMap.get(offerId) || 0) + 1);
        });

        // Offer assignment summary:
        console.log('Offer assignment summary:');
        offerCountMap.forEach((count, offerId) => {
          console.log(`  - ${offerId}: ${count}`);
        });

        resolve();
      })
      .on('error', reject);
  });
}

// =============== generate winners output csv ===============
function writeFilteredCSV(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    const csvStream = format({ headers: true });

    csvStream.pipe(ws)
      .on('finish', resolve)
      .on('error', reject);

    for (const row of filteredRows) {
      csvStream.write(row);
    }
    csvStream.end();
  });
}

// Run one comp
  console.log('\n==============================');
  console.log(`Audience: ${path.basename(audienceFilePath)}`);
  console.log(`Offer   : ${path.basename(offerFilePath)}`);
  console.log(`Output  : ${path.basename(outputFile)}`);

  console.log('Loading offers...');
  await loadOffers();
  expandedOffers = buildExpandedOffersFromLimits();
  const totalOfferCapacity = expandedOffers.length;

  if (MODE === 'manual' && totalOfferCapacity < TARGET_COUNT) {
    throw new Error(`Offer capacity (${totalOfferCapacity}) is less than requested count (${TARGET_COUNT}).`);
  }

  console.log(`Offer capacity (sum of num_of_winners): ${totalOfferCapacity}`);
  console.log(`Generation mode: ${MODE} | rows to generate: ${MODE === 'strict' ? totalOfferCapacity : Math.min(totalOfferCapacity, TARGET_COUNT)}`);
  console.log(`Loaded ${offerLimitMap.size} offer entries`);

  console.log('Processing audience file...');
  await processAudienceFile();

  console.log('Writing winners CSV...');
  await writeFilteredCSV(outputFile);
  console.log(`Done! Winners saved to: ${outputFile}`);
}

(async () => {
  try {
    const pairs = pickLatestCompPairs(audience_Offer_FilePath);
    const toRun = ONLY_LATEST_COMP ? pairs.slice(0, 1) : pairs;

    if (toRun.length === 0) {
      throw new Error(`No valid (audience+offer) comp pairs found in: ${baseCsvPath}`);
    }

    for (const p of toRun) {
      await generateForComp(p.audienceFile, p.offerFile);
    }
  } catch (err) {
    console.error('Error during processing:', err);
  }
})();
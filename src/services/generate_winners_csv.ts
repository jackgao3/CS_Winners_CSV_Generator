import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { format } from 'fast-csv';

const baseCsvPath = path.join(process.cwd(), 'csv');

// used.json - record used customer ID each time
const usedPath = path.join(baseCsvPath, 'used_customer_ids.json');
const usedCustomerIds = new Set<string>();
if (fs.existsSync(usedPath)) {
  try {
    const usedData = JSON.parse(fs.readFileSync(usedPath, 'utf-8'));
    usedData.forEach((id: string) => usedCustomerIds.add(id));
  } catch (err) {
    console.error('!! Failed to parse used.json:', err);
  }
}

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

// Find the latest CSV file in target folder - order by modified time
function pickLatestCsvByKeyword(dir: string, keyword: RegExp): string {
  const candidates = fs.readdirSync(dir).filter(f => keyword.test(f) && /\.csv$/i.test(f));
  if (candidates.length === 0) {
    throw new Error(`No CSV found by ${keyword} in: ${dir}`);
  }

  const DATE_RE = /(\d{4})[-_](\d{2})[-_](\d{2})(?=\.csv$)/;

  const scored = candidates.map(f => {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    const mtime = stat.mtimeMs;

    // Extract date time from file name
    const match = f.match(DATE_RE);
    let nameTs: number | null = null;
    if (match) {
      const [_, y, m, d] = match;
      const yyyy = y.padStart(4, '0');
      const mm = m.padStart(2, '0');
      const dd = d.padStart(2, '0');
      const parsed = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      if (!isNaN(parsed.getTime())) {
        nameTs = parsed.getTime();
      }
    }

    // Compare date time in file name with mtime（Y-M-D）
    const mtimeDateStr = new Date(mtime).toISOString().slice(0, 10);
    const nameDateStr = nameTs ? new Date(nameTs).toISOString().slice(0, 10) : 'N/A';

    if (nameTs && nameDateStr !== mtimeDateStr) {
      console.warn(`⚠️ Date mismatch in file "${f}": filename=${nameDateStr}, modified=${mtimeDateStr}`);
    }

    // pick the latest date and sort
    const finalScore = nameTs ? Math.max(nameTs, mtime) : mtime;
    return { file: full, score: finalScore };
  });

  // sort by reverse order
  scored.sort((a, b) => b.score - a.score);

  const chosen = scored[0].file;
  console.log(`Using file: ${path.basename(chosen)}`);
  return chosen;
}

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

// Scan and load all history csv file under csv/ folder, collect all customer_id and exclude - deduplication
function loadUsedFromWinnersCsv(): Set<string> {
  const ids = new Set<string>();
  const winnerFiles = fs.readdirSync(baseCsvPath).filter(f => /_winners_.*\.csv$/i.test(f));

  for (const file of winnerFiles) {
    const filePath = path.join(baseCsvPath, file);
    const data = fs.readFileSync(filePath, 'utf-8');
    const lines = data.split('\n');
    const header = (lines[0] || '').replace(/^\uFEFF/, '').split(',');
    const customerIdIndex = header.indexOf('customer_id');
    if (customerIdIndex === -1) {
      console.warn(`!! Skipped file without 'customer_id' column: ${file}`);
      continue;
    }
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      const customerId = cols[customerIdIndex]?.trim();
      if (customerId) {
        ids.add(customerId);
      } else {
        console.warn(`!! Ignored empty customer_id in file "${file}", line ${i + 1}`);
      }
    }
  }
  console.log(`Loaded ${ids.size} historical customer_id(s) from winners CSVs`);
  return ids;
}

// Save newly used customer_id into used.json
function saveUsedCustomerIds(ids: string[]): void {
  ids.forEach(id => usedCustomerIds.add(id));
  fs.writeFileSync(usedPath, JSON.stringify(Array.from(usedCustomerIds), null, 2));
}

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

// =============== Automatically pick latest audience/offer file ===============
const audienceFile = pickLatestCsvByKeyword(baseCsvPath, /audience/i);
const offerFile = pickLatestCsvByKeyword(baseCsvPath, /offer/i);
const outputFile = path.join(baseCsvPath, generateOutputFilename(audienceFile));

// =============== Offer file - load & build offer pool ===============
const offerLimitMap = new Map<string, number>();
let expandedOffers: string[] = [];

function loadOffers(): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(offerFile)
      .pipe(csv())
      .on('data', (row) => {
        if (row['offer_id'] && row['num_of_winners']) {
          const offerId = String(row['offer_id']).trim();
          const limit = parseInt(String(row['num_of_winners']), 10);
          if (!isNaN(limit)) {
            offerLimitMap.set(offerId, limit);
          }
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
    const usedFromCsv = loadUsedFromWinnersCsv(); // deduplication
    const tempRows: any[] = [];
    const seenCustomerIds = new Set<string>();

    fs.createReadStream(audienceFile)
      .pipe(csv())
      .on('data', (row) => {
        const customerId = row['customer_id']?.trim?.() ?? String(row['customer_id'] || '').trim();
        if (
          customerId &&
          !usedFromCsv.has(customerId) &&
          !usedCustomerIds.has(customerId) &&
          !seenCustomerIds.has(customerId)
        ) {
          tempRows.push(row);
          seenCustomerIds.add(customerId);
        }
      })
      .on('end', () => {
        const capacity = expandedOffers.length;
        const requiredCount = (MODE === 'strict') ? capacity : Math.min(capacity, TARGET_COUNT);

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

        // Record the new customerIds used this time
        const newCustomerIds = sampled.map(r => r['customer_id']);
        saveUsedCustomerIds(newCustomerIds);
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
function writeFilteredCSV(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outputFile);
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

(async () => {
  try {
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
    await writeFilteredCSV();
    console.log(`Done! Winners saved to: ${outputFile}`);
  } catch (err) {
    console.error('Error during processing:', err);
  }
})();
# CS_Winners_CSV_Generator
A command-line tool to simulate Creata behaviour - generate winners csv file based on input Audience and Offer file to pass winner validation and process on coupon allocation testing.

---

## Features
	•	Automatically selects latest date's audience & offer file to generate winners.csv
	•	Enforces randomly allocation by offer.csv (offer_id / num_of_winners)
	•	Supports strict mode (exact match with offer quotas) and manual mode (custom row count)
	•	Avoids reusing historical customer_ids (tracked in used_customer_ids.json and past winners files)
	•	Add AEST timestamp(hh:mm) by end of filenames for traceability

## Directory Layout

```bash
.
├── src/
│   ├── service/
│   │   └── generate_winners.ts       # Main script: generate winners from audience + offers
│   └── ...
├── csv/                              # Folder to drop Audience and Offer file as sample file to generate winner file
│   ├── used_customer_ids.json        # Tracking file for used customer_ids
│   └── ...
└── README.md
```

## Requirements
	•	Node.js ≥ 18
	•	npm or pnpm
	•	(optional) ts-node for running TypeScript directly

## Installation

```bash
npm install
# or
pnpm install

# For direct execution:

npx ts-node src/service/generate_winners.ts
```

## Configuration

```bash
# Mode: strict = exact match with offer.csv total
#       manual = custom TARGET_COUNT
# Row count (only used in manual mode)
TARGET_COUNT=100
# Timezone for timestamps
TZ=Australia/Sydney

strict mode:
MODE=strict node src/services/generate_winners_csv.ts

manual mode:
MODE=manual TARGET_COUNT=500 npx ts-node src/service/generate_winners.ts
```

## File Naming

### Input files:
	•	compXXXX_audience_2025-08-01.csv
	•	compXXXX_offer_2025-08-01.csv
### Output files:
	•	compXXXX_winners_2025-08-01_12_00.csv

## Steps

### Drop sample audience & offer csv files
1. Directly drop audience and offer file into csv folder

2. Run below commond line to trigger winner file generator: 

#### Strict mode (row count = sum of num_of_winners in offer.csv):
```bash
MODE=strict node src/services/generate_winners_csv.ts
```

#### Manual mode (row count = TARGET_COUNT, capped at offer capacity):
```bash
MODE=manual TARGET_COUNT=1000 npx ts-node src/service/generate_winners.ts
```

## Typical output:

```bash
Using file: comp1001_17580732-5191-4755-9691-656684755691_audience_2025-09-17.csv
Using file: comp1001_17580732-5191-4755-9691-656684755691_offer_2025-09-17.csv
Loading offers...
Offer capacity (sum of num_of_winners): 8
Generation mode: strict | rows to generate: 8
Loaded 2 offer entries
Processing audience file...
Loaded 8 historical customer_id(s) from winners CSVs
Offer assignment summary:
  - 101225860: 4
  - 101225861: 4
Writing winners CSV...
Done! Winners saved to: /Users/ygao4/Documents/CSV handler/csv/comp1001_17580732-5191-4755-9691-656684755691_winners_2025-09-17_12_35.csv
```

## Data Formats

```bash
audience.csv

customer_id
<salted_hash_crn>
<salted_hash_crn>
...
```
• Note: customer_id currently uses salted hashed CRNs. Mapping back to hashed CRNs requires a separate internal lookup table.
```bash
offer.csv

offer_id,num_of_winners
101225818,85
101225860,6
...
```
```bash
winners.csv
customer_id,offer_id,created_date_time
<salted_hash_crn>,101225818,2025-08-01 12:00:00
...
```

## De-Duplication Strategy

	•	Reads csv/used_customer_ids.json to exclude previously used IDs
	•	Scans existing _winners_*.csv files in csv/ and excludes those IDs
	•	Appends all newly used IDs to used_customer_ids.json after each run

### To reset:

	•	Delete the relevant winners file(s)
	•	Manually remove associated IDs from used_customer_ids.json
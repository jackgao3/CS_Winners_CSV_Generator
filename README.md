# CS_Winners_CSV_Generator
To simulate Creata behaviour - generate winners csv file based on input Audience and Offer file.

A command-line tool for generating winners CSV files from audience and offer file inputs.
It supports de-duplication, quota enforcement, configurable row counts, and audit logging, making it suitable for batch jobs or scheduled runs.

Features
	•	Selects and samples records from audience.csv to produce winners.csv
	•	Enforces allocation by offer.csv (offer_id / num_of_winners)
	•	Supports strict mode (exact match with offer quotas) and manual mode (custom row count)
	•	Avoids reusing historical customer_ids (tracked in used_customer_ids.json and past winners files)
	•	Timestamped filenames for traceability
	•	Stream-based processing, tested with 10M+ rows

Directory Layout

.
├── src/
│   ├── service/
│   │   └── generate_winners.ts       # Main script: generate winners from audience + offers
│   └── ...
├── csv/                              # Folder to drop Audience and Offer file as sample file to generate winner file
│   ├── used_customer_ids.json        # Tracking file for used customer_ids
│   └── ...
└── README.md

Requirements
	•	Node.js ≥ 18
	•	npm or pnpm
	•	(optional) ts-node for running TypeScript directly

Installation

npm install
# or
pnpm install

For direct execution:

npx ts-node src/service/generate_winners.ts

Configuration

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

File Naming

Input files:
	•	compXXXX_audience_2025-08-01.csv
	•	compXXXX_offer_2025-08-01.csv
Output files:
	•	compXXXX_winners_2025-08-01_12_00.csv
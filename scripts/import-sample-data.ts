/**
 * Script to import sample jobs from sample-data.json
 * Usage: npx ts-node scripts/import-sample-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const SAMPLE_DATA_PATH = path.join(__dirname, '../sample-data.json');

async function importSampleData() {
  try {
    // Read sample data
    const sampleData = JSON.parse(
      fs.readFileSync(SAMPLE_DATA_PATH, 'utf-8')
    );

    console.log(`Importing ${sampleData.length} sample jobs...`);

    const results = [];

    for (const jobSpec of sampleData) {
      try {
        const response = await axios.post(`${API_BASE_URL}/jobs`, jobSpec);
        results.push({
          success: true,
          jobSpec,
          jobId: response.data.jobId,
        });
        console.log(`✓ Created job: ${response.data.jobId}`);
      } catch (error: any) {
        results.push({
          success: false,
          jobSpec,
          error: error.response?.data?.error || error.message,
        });
        console.error(`✗ Failed to create job: ${error.response?.data?.error || error.message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log('\n=== Import Summary ===');
    console.log(`Total: ${sampleData.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    if (successCount > 0) {
      console.log('\nCreated Job IDs:');
      results
        .filter(r => r.success)
        .forEach(r => console.log(`  - ${r.jobId}`));
    }
  } catch (error) {
    console.error('Failed to import sample data:', error);
    process.exit(1);
  }
}

importSampleData();


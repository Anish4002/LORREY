const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const AccountDetail = require('../models/AccountDetail');
  
  const docs = await AccountDetail.find({}, { transactionDate: 1, _source: 1 });
  console.log("Total docs:", docs.length);
  
  const dateSet = new Set();
  docs.forEach(d => {
    if (d.transactionDate) {
      const parts = d.transactionDate.split(/[-\/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          dateSet.add(`${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`);
        } else {
          dateSet.add(`${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`);
        }
      }
    }
  });
  console.log("Uploaded dates:", Array.from(dateSet).sort());
  process.exit(0);
}
run().catch(console.error);

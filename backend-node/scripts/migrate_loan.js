const mongoose = require('mongoose');
require('dotenv').config({ path: '../backend-node/.env' });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.useDb('main_cashbook').collection('entries');
  
  const cursor = col.find({});
  let modified = 0;
  for await (const doc of cursor) {
    if (doc.P_SOURCE !== undefined) {
      const sourceVal = String(doc.P_SOURCE || '');
      let setUpdate = {};
      
      if (sourceVal.startsWith('DAC-RS-')) {
        setUpdate.P_LOAN_PAY = sourceVal;
        setUpdate.P_LOAN_RECV = '';
      } else {
        setUpdate.P_LOAN_RECV = sourceVal;
        setUpdate.P_LOAN_PAY = '';
      }
      
      await col.updateOne({ _id: doc._id }, { $set: setUpdate, $unset: { P_SOURCE: 1 } });
      modified++;
    }
  }
  
  console.log(`Migrated ${modified} documents.`);
  process.exit(0);
}
run().catch(console.error);

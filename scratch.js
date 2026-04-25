const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://lorrey0004:lorrey0004@cluster0.pqbigfd.mongodb.net/invoiceAI?retryWrites=true&w=majority')
  .then(async () => {
    const col = mongoose.connection.collection('vouchers');
    const docs = await col.find({ expenseType: "Direct Expense" }).toArray();
    console.log(docs.map(d => ({ amount: d.amount, purpose: d.purpose, date: d.date })));
    process.exit(0);
  });

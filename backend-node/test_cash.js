const mongoose = require("mongoose");
mongoose.connect("mongodb+srv://lorrey0004:lorrey0004@cluster0.pqbigfd.mongodb.net/invoiceAI?retryWrites=true&w=majority").then(async () => {
    const vouchers = await mongoose.connection.useDb("invoiceAI").collection("vouchers").find({}).sort({_id:-1}).limit(10).toArray();
    console.log("VOUCHERS:");
    vouchers.forEach(v => console.log(`${v.date} - Type: ${v.expenseType} - Amt: ${v.amount}`));
    
    const cement = await mongoose.connection.useDb("cement_register").collection("entries").find({$or: [{"Site Cash": {$ne: null, $ne: ""}}, {"OFFICE CASH": {$ne: null, $ne: ""}}]}).sort({_id:-1}).limit(10).toArray();
    console.log("\nCEMENT:");
    cement.forEach(c => console.log(`${c['LOADING DT']} - SiteCash: ${c['Site Cash']} - OfficeCash: ${c['OFFICE CASH']}`));
    process.exit(0);
});

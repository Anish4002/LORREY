const mongoose = require("mongoose");
mongoose.connect("mongodb+srv://lorrey0004:lorrey0004@cluster0.pqbigfd.mongodb.net/invoiceAI?retryWrites=true&w=majority").then(async () => {
    const vouchers = await mongoose.connection.useDb("invoiceAI").collection("vouchers").find({amount: {$gte: 500}}).sort({_id:-1}).limit(10).toArray();
    console.log("VOUCHERS:");
    vouchers.forEach(v => {
        let d = v.date;
        if(v.date instanceof Date) { d = v.date.toISOString().split('T')[0]; }
        console.log(`${d} - Type: ${v.expenseType} - Purpose: ${v.purpose} - Amt: ${v.amount} - ID: ${v._id}`);
    });
    
    const cement = await mongoose.connection.useDb("cement_register").collection("entries").find({"LOADING DT": "24/04/2026"}).sort({_id:-1}).limit(10).toArray();
    console.log("\nCEMENT:");
    cement.forEach(c => console.log(`${c['LOADING DT']} - SiteCash: ${c['Site Cash']} - OfficeCash: ${c['OFFICE CASH']} - Advance: ${c['ADVANCE']}`));
    process.exit(0);
});

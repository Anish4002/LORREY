const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FinancialYearPayment = require('../models/FinancialYearPayment');
const FinancialYearRow = require('../models/FinancialYearRow');
const paymentProofUpload = require('../middleware/paymentProofUpload');

function getCementCol() {
  return mongoose.connection.useDb("cement_register").collection("entries");
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;

  const str = String(val).trim();

  // ── Detect DD-MM-YYYY (Indian format) — MUST check first ──
  const ddmmyyyy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyy) {
    const d = parseInt(ddmmyyyy[1]), m = parseInt(ddmmyyyy[2]), y = parseInt(ddmmyyyy[3]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return new Date(y, m - 1, d);
    }
  }

  // ── Try ISO / standard JS parsing ──
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;

  return null;
}


const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

// Normalize legacy site names to canonical values
function normalizeSite(site) {
  if (!site) return '';
  const s = String(site).trim().toUpperCase();
  if (s === 'NVCL') return 'NVCL';
  if (s === 'NVL') return 'NVL';
  return site.trim();
}

router.get('/data', async (req, res) => {
  try {
    // ── Run all 3 DB reads in PARALLEL ─────────────────────────────
    const CEMENT_PROJECTION = {
      'GCN NO': 1, 'BILL NO': 1, 'INVOICE NO': 1, 'BILLING': 1,
      'LOADING DT': 1, 'LOADING DATE': 1,
      'SITE': 1,
      'BILLING ER 95%': 1, 'BILLING @ 95% (PARTY PAYABLE)': 1,
      'AMOUNT': 1, 'Billing Amount': 1,
      _id: 0
    };

    const [allCement, rowOverrides, payments] = await Promise.all([
      getCementCol().find({}, { projection: CEMENT_PROJECTION }).toArray(),
      FinancialYearRow.find({}).lean(),
      FinancialYearPayment.find({}).lean()
    ]);

    // ── Aggregate cement rows by invoice number AND site ──────────────
    const aggregated = {};
    for (const row of allCement) {
      let invNo = row['BILL NO'];
      if (!invNo) continue;
      invNo = String(invNo).trim();

      const rawSite = normalizeSite(row['SITE']);
      if (rawSite !== 'NVCL' && rawSite !== 'NVL') continue;

      const prefix = rawSite === 'NVCL' ? 'NVCL/' : 'DAC/';
      const cleanInvNo = invNo.replace(/^(DAC|NVCL)\//i, '');
      const finalInvNo = `${prefix}${cleanInvNo}`;

      if (!aggregated[finalInvNo]) {
        const invDate = row['BILL DATE'] || row['LOADING DT'] || row['LOADING DATE'] || '';
        let monthStr = '';
        const dObj = parseDate(invDate);
        if (dObj) {
          const m = dObj.getMonth();
          const yy = String(dObj.getFullYear()).slice(-2);
          monthStr = `${MONTH_NAMES[m]} '${yy}`;
        }
        aggregated[finalInvNo] = { invoiceDate: invDate, invoiceNumber: finalInvNo, month: monthStr, site: rawSite, amount: 0 };
      }

      const amt =
        parseFloat(row['BILLING AMOUNT']) ||
        parseFloat(row['Billing Amount']) ||
        parseFloat(row['BILLING ER 95%']) ||
        parseFloat(row['AMOUNT']) || 0;
      aggregated[finalInvNo].amount += amt;
    }

    // ── Merge overrides (O(1) map lookup) ──────────────────────────
    const rowMap = {};
    for (const r of rowOverrides) rowMap[r.billNo] = r;

    const finalRows = Object.values(aggregated).map(r => {
      const ov = rowMap[r.invoiceNumber] || {};
      if (ov.hidden) return null; // soft-deleted
      return {
        ...r,
        billType:              ov.billType              ?? 'FREIGHT',
        invoiceDate:           ov.editedInvoiceDate     ?? r.invoiceDate,
        displayInvoiceNumber:  ov.editedInvoiceNumber   ?? r.invoiceNumber,
        month:                 ov.editedMonth           ?? r.month,
        site:                  normalizeSite(ov.editedSite ?? r.site),
        amount:                ov.editedAmount          ?? r.amount,
      };
    }).filter(Boolean);

    res.json({ rows: finalRows, payments });
  } catch (err) {
    console.error('[FYDetails] /data error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/save-group', async (req, res) => {
  try {
    const { id, billNos, paymentAmount, paymentDate, referenceNo, debitAmount, remarks, tdsProvision } = req.body;
    await FinancialYearPayment.findOneAndUpdate(
      { id },
      { billNos, paymentAmount, paymentDate, referenceNo, debitAmount, remarks, tdsProvision },
      { upsert: true, returnDocument: 'after' }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Soft-delete: marks selected invoice numbers as hidden
router.post('/delete-rows', async (req, res) => {
  try {
    const { billNos } = req.body; // array of invoiceNumbers to delete
    if (!Array.isArray(billNos) || billNos.length === 0)
      return res.status(400).json({ error: 'No bill numbers provided' });

    await Promise.all(billNos.map(billNo =>
      FinancialYearRow.findOneAndUpdate(
        { billNo },
        { $set: { hidden: true } },
        { upsert: true }
      )
    ));
    res.json({ success: true, deleted: billNos.length });
  } catch (err) {
    console.error('[FYDetails] /delete-rows error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.post('/upload-proof', paymentProofUpload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { id } = req.body;
    if (id) {
      await FinancialYearPayment.findOneAndUpdate(
        { id },
        { paymentProofUrl: req.file.location },
        { upsert: true, returnDocument: 'after' }
      );
    }
    res.json({ message: "Proof saved successfully", url: req.file.location });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/save-row', async (req, res) => {
  try {
    const { billNo, billType, editedInvoiceDate, editedInvoiceNumber, editedMonth, editedSite, editedAmount } = req.body;
    let updateObj = {};
    if (billType !== undefined) updateObj.billType = billType;
    if (editedInvoiceDate !== undefined) updateObj.editedInvoiceDate = editedInvoiceDate;
    if (editedInvoiceNumber !== undefined) updateObj.editedInvoiceNumber = editedInvoiceNumber;
    if (editedMonth !== undefined) updateObj.editedMonth = editedMonth;
    if (editedSite !== undefined) updateObj.editedSite = editedSite;
    if (editedAmount !== undefined) updateObj.editedAmount = parseFloat(editedAmount) || 0;

    await FinancialYearRow.findOneAndUpdate(
      { billNo },
      { $set: updateObj },
      { upsert: true, returnDocument: 'after' }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

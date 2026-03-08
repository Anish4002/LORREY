const express = require("express");
const router = express.Router();
const axios = require("axios");
const upload = require("../middleware/upload");
const Invoice = require("../models/Invoice");
const TruckContact = require("../models/TruckContact");
const s3 = require("../config/s3");
const { HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const lorryHireSlipUpload = require("../middleware/lorryHireSlipUpload");
const fuelSlipUpload = require("../middleware/fuelSlipUpload");


// DOWNLOAD PROXY
router.get("/download-proxy", async (req, res) => {
    const { url, filename } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Proxy: downloading ${url} -> ${filename}`);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 30000
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename || 'download.pdf'}"`);

        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy download failed:", err.message);
        res.status(500).json({ error: "Download failed: " + err.message });
    }
});

// Lookup truck contact by truck number
router.get("/truck-contact/:truck_no", async (req, res) => {
    try {
        const { truck_no } = req.params;
        // Case-insensitive search, strip spaces
        const record = await TruckContact.findOne({
            truck_no: { $regex: new RegExp(`^${truck_no.trim()}$`, "i") }
        }).lean();
        if (!record) return res.json({ found: false });
        res.json({
            found: true,
            contact: record.contact_no || record["Contact No."] || "",
            owner: record.owner_name || record["Owner Name"] || "",
            pan_no: record.pan_no || "",
            aadhar_no: record.aadhar_no || "",
            driver_name: record.driver_name || "",
            license_no: record.license_no || "",
            address: record.address || "",
            // Include other fields just in case they are needed later
            type: record.type || "",
            gst_no: record.gst_no || "",
            rc_validity: record.rc_validity || "",
            insurance_validity: record.insurance_validity || "",
            fitness_validity: record.fitness_validity || "",
            road_tax_validity: record.road_tax_validity || "",
            permit: record.permit || "",
            puc: record.puc || "",
            np_validity: record.np_validity || "",
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/upload", upload.single("invoice"), async (req, res) => {

    try {
        console.log("/upload endpoint hit");
        if (!req.file) {
            console.error("No file received in request");
            return res.status(400).json({ error: "No file uploaded" });
        }
        const fileUrl = req.file.location;
        console.log("File URL:", fileUrl);

        // Call FastAPI pipeline for AI extraction
        let aiData = null;
        try {
            const aiWorkerUrl = process.env.AI_WORKER_URL || "http://127.0.0.1:8000";
            const aiResponse = await require("axios").post(
                `${aiWorkerUrl}/process`,
                { file: fileUrl },
                { timeout: 60000 }
            );
            aiData = aiResponse.data;
            console.log("AI extraction success");
        } catch (aiErr) {
            console.error("AI extraction failed:", aiErr.message);
            return res.status(500).json({ error: "AI extraction failed", details: aiErr.message });
        }

        // Save invoice with AI data
        const consignee_name =
            aiData?.invoice_data?.consignee_details?.consignee_name || '';

        const invoice = new Invoice({
            file_url: fileUrl,
            ai_data: aiData,
            consignee_name,
            status: "pending"
        });
        await invoice.save();
        console.log("Invoice saved with _id:", invoice._id);
        res.json({
            message: "Invoice uploaded and processed",
            file_url: fileUrl,
            invoice_id: invoice._id,
            ai_data: aiData
        });
    } catch (error) {
        console.error("Error in /upload:", error);
        res.status(500).json({ error: error.message });
    }

});

router.post("/process-ai", async (req, res) => {

    const { invoice_id, ai_data } = req.body;

    await Invoice.findByIdAndUpdate(invoice_id, {
        ai_data: ai_data
    });

    res.json({ message: "AI data saved" });

});

router.get("/pending", async (req, res) => {
    const invoices = await Invoice.find({ status: "pending" });
    res.json(invoices);
});

router.get("/all", async (req, res) => {
    try {
        const invoices = await Invoice.find().sort({ created_at: -1 }).lean();

        // Parallel check for S3 existence using SDK v3
        const verifiedInvoices = await Promise.all(invoices.map(async (inv) => {
            if (inv.softcopy_url) {
                try {
                    const url = new URL(inv.softcopy_url);
                    const key = decodeURIComponent(url.pathname.substring(1));

                    await s3.send(new HeadObjectCommand({
                        Bucket: process.env.AWS_BUCKET_NAME || "lorreyproject",
                        Key: key
                    }));

                    return { ...inv, s3_exists: true };
                } catch (err) {
                    console.warn("S3 headObject failed for", inv._id, ":", err.name || err.message);
                    return { ...inv, s3_exists: false };
                }
            }
            return { ...inv, s3_exists: false };
        }));

        res.json(verifiedInvoices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/approve", async (req, res) => {

    const { invoice_id, corrected_data } = req.body;

    // Extract consignee_name from the verified data for top-level storage
    const consignee_name =
        corrected_data?.consignee_details?.consignee_name || '';

    await Invoice.findByIdAndUpdate(invoice_id, {
        human_verified_data: corrected_data,
        consignee_name,
        status: "approved"
    });

    res.json({
        message: "Invoice approved and saved"
    });

});

// GET invoice data for Lorry Hire Slip review form
router.get("/lorry-data/:id", async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).lean();
        if (!invoice) return res.status(404).json({ error: "Invoice not found" });
        res.json(invoice);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST — save Lorry Hire Slip PDF to S3 + persist slip data to MongoDB
router.post("/lorry-hire-slip-softcopy", lorryHireSlipUpload.single("softcopy"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { invoice_id, slip_data } = req.body;
    let parsedSlipData = {};
    try { parsedSlipData = JSON.parse(slip_data); } catch (_) { /* ignore */ }

    const updatePayload = {
        "lorry_hire_slip_data.lorry_hire_slip_no": parsedSlipData.lorry_hire_slip_no,
        "lorry_hire_slip_data.fuel_slip_no": parsedSlipData.fuel_slip_no,
        "lorry_hire_slip_data.loading_advance": Number(parsedSlipData.loading_advance) || 0,
        "lorry_hire_slip_data.diesel_litres": Number(parsedSlipData.diesel_litres) || 0,
        "lorry_hire_slip_data.diesel_rate": Number(parsedSlipData.diesel_rate) || 90,
        "lorry_hire_slip_data.diesel_advance": Number(parsedSlipData.diesel_advance) || 0,
        "lorry_hire_slip_data.total_advance": Number(parsedSlipData.total_advance) || 0,
        "lorry_hire_slip_data.lorry_hire_slip_url": req.file.location,
        "lorry_hire_slip_data.created_at": new Date(),
    };

    if (invoice_id) {
        await Invoice.findByIdAndUpdate(invoice_id, { $set: updatePayload });
    }

    res.json({ message: "Lorry Hire Slip saved successfully", url: req.file.location });
});

// POST — save Fuel Slip PDF to S3 + persist data to MongoDB
router.post("/fuel-slip-softcopy", fuelSlipUpload.single("softcopy"), async (req, res) => {
    console.log(">>> Fuel Slip Upload Hit");
    if (!req.file) {
        console.error(">>> No file uploaded in Fuel Slip request");
        return res.status(400).json({ error: "No file uploaded" });
    }

    const { invoice_id, slip_data } = req.body;
    console.log(">>> Received invoice_id:", invoice_id);
    console.log(">>> Received slip_data:", slip_data);

    let parsedSlipData = {};
    try {
        parsedSlipData = JSON.parse(slip_data);
    } catch (e) {
        console.error(">>> Failed to parse slip_data:", e.message);
    }

    const updatePayload = {
        "lorry_hire_slip_data.station_name": parsedSlipData.station_name,
        "lorry_hire_slip_data.station_address": parsedSlipData.station_address,
        "lorry_hire_slip_data.diesel_litres": Number(parsedSlipData.diesel_litres) || 0,
        "lorry_hire_slip_data.diesel_rate": Number(parsedSlipData.diesel_rate) || 0,
        "lorry_hire_slip_data.diesel_advance": Number(parsedSlipData.diesel_advance) || 0,
        "lorry_hire_slip_data.fuel_slip_url": req.file.location,
    };

    if (invoice_id) {
        try {
            const updated = await Invoice.findByIdAndUpdate(
                invoice_id,
                { $set: updatePayload },
                { new: true }
            );
            if (updated) {
                console.log(">>> DB Update Success for invoice:", invoice_id);
            } else {
                console.error(">>> DB Update Failed: Document not found for ID:", invoice_id);
            }
        } catch (dbErr) {
            console.error(">>> DB Update Error:", dbErr.message);
        }
    } else {
        console.error(">>> No invoice_id provided in request body");
    }

    res.json({ message: "Fuel Slip saved successfully", url: req.file.location });
});

// DELETE invoice by ID (also removes S3 files if present)
router.delete("/:id", async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ error: "Invoice not found" });

        // Helper to delete an S3 key from a URL
        const deleteS3File = async (url) => {
            if (!url) return;
            try {
                const urlObj = new URL(url);
                const key = decodeURIComponent(urlObj.pathname.slice(1));
                await s3.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME || "lorreyproject",
                    Key: key,
                }));
            } catch (e) {
                console.warn("S3 delete skipped:", e.message);
            }
        };

        await deleteS3File(invoice.softcopy_url);
        await deleteS3File(invoice.gcn_url);
        await Invoice.findByIdAndDelete(req.params.id);

        res.json({ message: "Invoice deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// BULK DELETE
router.post("/bulk-delete", async (req, res) => {
    try {
        const { ids } = req.body; // array of invoice _ids
        if (!ids || !ids.length) return res.status(400).json({ error: "No IDs provided" });

        const invoices = await Invoice.find({ _id: { $in: ids } }).lean();

        const deleteS3File = async (url) => {
            if (!url) return;
            try {
                const urlObj = new URL(url);
                const key = decodeURIComponent(urlObj.pathname.slice(1));
                await s3.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME || "lorreyproject",
                    Key: key,
                }));
            } catch (e) {
                console.warn("S3 bulk-delete skipped:", e.message);
            }
        };

        await Promise.all(invoices.flatMap(inv => [
            deleteS3File(inv.softcopy_url),
            deleteS3File(inv.gcn_url),
        ]));

        await Invoice.deleteMany({ _id: { $in: ids } });
        res.json({ message: `${invoices.length} invoices deleted` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DOWNLOAD PROXY (bypass CORS for S3)
router.get("/download-proxy", async (req, res) => {
    const { url, filename } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Proxy: downloading ${url} -> ${filename}`);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 30000
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename || 'download.pdf'}"`);

        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy download failed:", err.message);
        res.status(500).json({ error: "Download failed: " + err.message });
    }
});

module.exports = router;
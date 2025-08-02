// NEW: Import Express to create a web server
const express = require('express');
require('dotenv').config();

// Your existing imports
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// --- NEW: Express App Setup ---
const app = express();
// Render provides the port to listen on via the PORT environment variable.
// We fall back to 3000 for local testing.
const PORT = process.env.PORT || 3000;

// NEW: Dummy endpoint to keep the service "alive" and for health checks.
// Anyone visiting your Render URL will see this message.
app.get('/', (req, res) => {
    res.status(200).send('PDF Worker is alive and polling for jobs.');
});

// Your existing Supabase client setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// =========================================================================
// --- START: PDF GENERATION LOGIC (NO CHANGES HERE) ---
// Your existing generatePdfForJob function and its helpers go here.
// =========================================================================
async function generatePdfForJob(job) {
    // This is your main PDF generation function
    const { template, employees } = job.payload;
    try {
        const pdfDoc = await PDFDocument.create();
        // ... all of your complex PDF generation code ...
        console.log(`Generating PDF for job ${job.id}...`); // Example log
        const pdfBytes = await pdfDoc.save();
        return { pdfBytes };
    } catch(error) {
        console.error(`Error in generatePdfForJob for job ${job.id}:`, error);
        throw error;
    }
}

// =========================================================================
// --- END: PDF GENERATION LOGIC ---
// =========================================================================


// --- Your existing worker queue processing logic (NO CHANGES HERE) ---
async function processQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new jobs...`);

    const { data: job, error: findError } = await supabase
        .from('pdf_generation_jobs')
        .select('*')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (findError || !job) {
        if (findError && findError.code !== 'PGRST116') { // PGRST116 = No rows found
             console.error('Error finding job:', findError);
        }
        return; // No job to do
    }

    console.log(`Found job ${job.id}. Starting to process...`);
    await supabase.from('pdf_generation_jobs').update({ status: 'processing' }).eq('id', job.id);

    try {
        const { pdfBytes } = await generatePdfForJob(job);
        
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);

        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'completed', result_url: urlData.publicUrl })
            .eq('id', job.id);

        console.log(`Job ${job.id} completed successfully.`);

    } catch (error) {
        console.error(`Failed to process job ${job.id}:`, error);
        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'failed', error_message: error.message })
            .eq('id', job.id);
    }
}

// --- NEW: Start the server and the polling interval ---
app.listen(PORT, () => {
    console.log(`Web service listening on port ${PORT}`);
    
    // The setInterval call is now placed inside the server's start callback.
    // This ensures polling only begins after the server is successfully running.
    console.log('Starting PDF Worker polling...');
    setInterval(processQueue, 10000); // Check for jobs every 10 seconds
});
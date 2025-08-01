// worker.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
// ... และ dependencies อื่นๆ ของคุณ

// <<< FIX: แก้ไขชื่อ Environment Variable ให้ตรงกับการตั้งค่าของคุณ
// Worker ต้องใช้ SERVICE_ROLE_KEY เพื่อให้มีสิทธิ์สูงสุดในการจัดการข้อมูล
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // เปลี่ยนจาก SUPABASE_SERVICE_KEY
const supabase = createClient(supabaseUrl, serviceKey);

// =========================================================================
// --- ส่วนของ LOGIC การสร้าง PDF (ให้คัดลอกมาวางที่นี่เหมือนเดิม) ---
// ...
// async function generatePdfForJob(job) { ... }
// ...
// =========================================================================

async function processQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new jobs...`);

    const { data: job, error: findError } = await supabase
        .from('pdf_generation_jobs').select('*').eq('status', 'pending').limit(1).single();

    if (!job) {
        return; // ไม่มีงานให้ทำ
    }
    
    console.log(`Processing job ${job.id}...`);
    await supabase.from('pdf_generation_jobs').update({ status: 'processing' }).eq('id', job.id);

    try {
        const { pdfBytes } = await generatePdfForJob(job);
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        await supabase.from('pdf_generation_jobs').update({ status: 'completed', result_url: urlData.publicUrl }).eq('id', job.id);
        console.log(`Job ${job.id} completed.`);

    } catch (error) {
        console.error(`Failed job ${job.id}:`, error);
        await supabase.from('pdf_generation_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    }
}

// ตั้งให้ Worker ทำงานทุกๆ 10 วินาที
setInterval(processQueue, 10000);
console.log('PDF Worker started.');

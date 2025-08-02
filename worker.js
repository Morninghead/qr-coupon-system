// worker.js
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, rgb } = require('pdf-lib'); // และ dependencies อื่นๆ ของคุณ
const fontkit = require('@pdf-lib/fontkit');
// ... import/require ทุกอย่างที่โค้ดสร้าง PDF ของคุณต้องการ

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); // **ใช้ SERVICE KEY**

// =========================================================================
// --- START: PDF GENERATION LOGIC ---
// คัดลอกโค้ด Helper Functions ทั้งหมดของคุณ (pt, drawCropMarks, fetchImage, etc.) มาวางที่นี่
// =========================================================================

async function generatePdfForJob(job) {
    // นี่คือฟังก์ชันหลักในการสร้าง PDF
    // มันจะใช้ "job.payload" เป็นข้อมูล
    const { template, employees } = job.payload;
    
    // ...
    // คัดลอกโค้ด "try...catch" หลักจาก handler เดิมของคุณมาวางที่นี่
    // โดยเปลี่ยนจากการ return statusCode มาเป็นการ return object ที่มี pdfBytes
    // หรือ throw error
    // ...
    // ตัวอย่าง:
    try {
        const pdfDoc = await PDFDocument.create();
        // ... โค้ดสร้าง PDF ทั้งหมดของคุณ ...
        const pdfBytes = await pdfDoc.save();
        return { pdfBytes };
    } catch(error) {
        throw error;
    }
}

// =========================================================================
// --- END: PDF GENERATION LOGIC ---
// =========================================================================

async function processQueue() {
    console.log('Checking for new jobs...');

    // 1. ค้นหางานที่ยังค้างอยู่
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
        return; // ไม่มีงานให้ทำ
    }

    console.log(`Found job ${job.id}. Starting to process...`);

    // 2. "ล็อก" งานทันทีโดยเปลี่ยนสถานะเป็น 'processing'
    await supabase.from('pdf_generation_jobs').update({ status: 'processing' }).eq('id', job.id);

    try {
        // 3. เริ่มทำงานที่หนักที่สุด คือการสร้าง PDF
        const { pdfBytes } = await generatePdfForJob(job);
        
        // 4. อัปโหลดไฟล์ PDF ไปที่ Supabase Storage
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage
            .from('documents') // 'documents' คือชื่อ Bucket ของคุณ
            .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

        if (uploadError) throw uploadError;

        // 5. ดึง Public URL ของไฟล์ที่อัปโหลด
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);

        // 6. อัปเดตสถานะเป็น 'completed' พร้อมลิงก์ดาวน์โหลด
        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'completed', result_url: urlData.publicUrl })
            .eq('id', job.id);

        console.log(`Job ${job.id} completed successfully.`);

    } catch (error) {
        console.error(`Failed to process job ${job.id}:`, error);
        // หากล้มเหลว ให้อัปเดตสถานะเป็น 'failed' พร้อมข้อความ Error
        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'failed', error_message: error.message })
            .eq('id', job.id);
    }
}

// ตั้งให้ Worker ทำงานทุกๆ 10 วินาที
console.log('PDF Worker started. Waiting for jobs...');
setInterval(processQueue, 10000);

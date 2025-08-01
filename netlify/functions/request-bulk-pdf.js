// netlify/functions/request-bulk-pdf.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
    try {
        const { template, employees } = JSON.parse(event.body);
        if (!template || !employees || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required fields.' }) };
        }

        // สร้าง "งาน" ใหม่ลงในตารางคิว
        const { data, error } = await supabase
            .from('pdf_generation_jobs')
            .insert([{
                status: 'pending',
                payload: { template, employees } // เก็บข้อมูลทั้งหมดที่ต้องใช้ไว้ใน payload
            }])
            .select('id')
            .single();

        if (error) throw error;

        // ตอบกลับ job_id ให้หน้าบ้านทันที
        return {
            statusCode: 202, // 202 Accepted หมายถึง "รับเรื่องไว้แล้ว"
            body: JSON.stringify({ jobId: data.id })
        };

    } catch (error) {
        console.error('Error creating PDF job:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Could not create PDF job.', error: error.message }) };
    }
};

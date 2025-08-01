// netlify/functions/request-bulk-pdf.js

const { createClient } = require('@supabase/supabase-js');

// ควรตั้งค่า Environment Variables บน Netlify UI
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// <<< FIX: แก้ไข handler ให้รับ "context" เข้ามาด้วย
exports.handler = async (event, context) => {
    // 1. (แนะนำ) ตรวจสอบว่าผู้ใช้ล็อกอินเข้ามาหรือไม่
    if (!context.clientContext || !context.clientContext.user) {
        return {
            statusCode: 401, // Unauthorized
            body: JSON.stringify({ message: 'You must be logged in to create a PDF job.' })
        };
    }
    
    // ดึง user_id จาก context
    const userId = context.clientContext.user.sub;

    try {
        const { template, employees } = JSON.parse(event.body);
        if (!template || !employees || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing template or employees data.' }) };
        }

        // 2. สร้าง "งาน" ใหม่ลงในตารางคิว พร้อมกับบันทึก `user_id`
        const { data, error } = await supabase
            .from('pdf_generation_jobs')
            .insert([{
                status: 'pending',
                payload: { template, employees },
                user_id: userId // <<< FIX: เพิ่ม user_id เข้าไปใน object ที่จะ insert
            }])
            .select('id')
            .single();

        if (error) throw error;

        // 3. ตอบกลับ job_id ให้หน้าบ้านทันที (เหมือนเดิม)
        return {
            statusCode: 202, // Accepted
            body: JSON.stringify({ jobId: data.id })
        };

    } catch (error) {
        console.error('Error creating PDF job:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Could not create PDF job.', error: error.message }) };
    }
};

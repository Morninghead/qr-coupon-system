// get-departments.js
import { createClient } from '@supabase/supabase-js';

// ฟังก์ชันนี้จะถูกเรียกใช้งานบน Server ของ Netlify
// จึงต้องใช้ Environment Variables ที่ตั้งค่าไว้ใน Netlify UI
const supabaseUrl = process.env.SUPABASE_URL;
// **สำคัญ:** ในฝั่ง Server ต้องใช้ Service Role Key เพื่อให้มีสิทธิ์ในการตรวจสอบ Token
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

/**
 * Fetches all departments from the database.
 * Accessible by any user authenticated via Supabase.
 */
export const handler = async (event, context) => {
    // 1. ตรวจสอบว่ามี Authorization header ส่งมาหรือไม่
    const authHeader = event.headers['authorization'];
    if (!authHeader) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authorization header is missing' }) };
    }

    // 2. ดึง Token ออกมาจาก Header
    const token = authHeader.split(' ')[1]; // รูปแบบ "Bearer <TOKEN>"
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Token is missing' }) };
    }

    // 3. สร้าง Supabase client บน server ด้วย Service Role Key
    // เพื่อใช้ในการตรวจสอบ Token ที่ส่งมาจากผู้ใช้
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            // ป้องกันไม่ให้ Supabase client พยายามบันทึก session ในฝั่ง server
            persistSession: false
        }
    });

    try {
        // 4. ใช้ Supabase ตรวจสอบความถูกต้องของ Token
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        // หาก Token ไม่ถูกต้องหรือหมดอายุ, authError จะเกิดขึ้น
        if (authError || !user) {
            console.error('Authentication error:', authError?.message);
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token', error: authError?.message }) };
        }

        // --- ณ จุดนี้, ยืนยันตัวตนสำเร็จแล้ว ---
        // 5. ดึงข้อมูลแผนกจากฐานข้อมูล
        const { data, error } = await supabase
            .from('departments') // แก้ไขตรงนี้: 'Departments' -> 'departments'
            .select('id, name')
            .order('name', { ascending: true });

        if (error) {
            // หากเกิดข้อผิดพลาดในการดึงข้อมูลจาก Database
            throw error;
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error('Get Departments Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch departments', error: error.message }),
        };
    }
};
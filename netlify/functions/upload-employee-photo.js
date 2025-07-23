import { createClient } from '@supabase/supabase-js';

// ใช้ Admin client เพื่อตรวจสอบสิทธิ์และอัปโหลด/อัปเดตข้อมูล
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Storage bucket สำหรับรูปภาพพนักงานที่เราสร้างไว้
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos'; 

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. ตรวจสอบ Token และยืนยันตัวตนผู้ใช้ (ต้องเป็น Superuser)
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // 2. วิเคราะห์ข้อมูลที่ส่งมาจาก Frontend
        // คาดหวังว่า body จะมี photos: [{ employee_id: "...", photo_data: "..." }]
        const { photos } = JSON.parse(event.body);

        if (!photos || !Array.isArray(photos) || photos.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'No photo data provided.' }) };
        }

        let uploadedCount = 0;
        let failedCount = 0;
        let failedIds = [];

        // 3. วนลูปเพื่ออัปโหลดและอัปเดตข้อมูลรูปภาพแต่ละรูป
        for (const photoItem of photos) {
            const { employee_id, photo_data } = photoItem;

            if (!employee_id || !photo_data) {
                failedCount++;
                failedIds.push(employee_id || 'UNKNOWN_ID');
                continue; // ข้ามรูปภาพนี้ไป
            }

            // กำหนดชื่อไฟล์ (เช่น "30000.jpg")
            // ตรวจสอบว่า photo_data เป็น Base64 ของ JPEG หรือ PNG
            const imageBuffer = Buffer.from(photo_data, 'base64');
            const fileExtension = photo_data.startsWith('/9j/') ? 'jpg' : (photo_data.startsWith('iVBORw0KGgoAAAAN') ? 'png' : 'jpg'); // ตรวจสอบ magic number ของ Base64
            const fileName = `${employee_id}.${fileExtension}`;
            const contentType = `image/${fileExtension}`;

            try {
                // 3a. อัปโหลดรูปภาพไปยัง Supabase Storage
                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from(EMPLOYEE_PHOTOS_BUCKET)
                    .upload(fileName, imageBuffer, {
                        contentType: contentType,
                        upsert: true // หากมีไฟล์ชื่อนี้อยู่แล้ว ให้อัปเดตทับ
                    });

                if (uploadError) {
                    console.error(`Error uploading photo for ${employee_id}:`, uploadError);
                    failedCount++;
                    failedIds.push(employee_id);
                    continue;
                }

                // 3b. รับ Public URL ของรูปภาพ
                const publicUrl = `${supabaseUrl}/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/${fileName}`;

                // 3c. อัปเดตคอลัมน์ photo_url ในตาราง employees
                const { error: updateError } = await supabaseAdmin
                    .from('employees') // ตรวจสอบว่าใช้ 'employees' ตัวพิมพ์เล็ก
                    .update({ photo_url: publicUrl })
                    .eq('employee_id', employee_id); // อัปเดตตามรหัสพนักงาน

                if (updateError) {
                    console.error(`Error updating photo_url for ${employee_id}:`, updateError);
                    failedCount++;
                    failedIds.push(employee_id);
                    // (Optional) หากอัปเดต DB ไม่ได้ อาจจะลบรูปจาก Storage ทิ้งด้วย
                    // await supabaseAdmin.storage.from(EMPLOYEE_PHOTOS_BUCKET).remove([fileName]);
                    continue;
                }

                uploadedCount++;

            } catch (error) {
                console.error(`Unhandled error during photo processing for ${employee_id}:`, error);
                failedCount++;
                failedIds.push(employee_id);
            }
        }

        // 4. ส่งผลลัพธ์การอัปโหลดกลับไป Frontend
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `อัปโหลดรูปภาพสำเร็จ ${uploadedCount} รูป`,
                uploadedCount: uploadedCount,
                failedCount: failedCount,
                failedIds: failedIds,
            }),
        };

    } catch (error) {
        console.error('Upload Employee Photo Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'เกิดข้อผิดพลาดภายในระบบ', error: error.message }),
        };
    }
};
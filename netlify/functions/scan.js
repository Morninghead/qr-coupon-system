// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // ใช้ Anon Key สำหรับฝั่ง Client/Public Function
const supabase = createClient(supabaseUrl, supabaseKey);

// Main function handler
export const handler = async (event) => {
    // 1. รับค่า Input จาก URL (token ที่ได้จากการสแกน QR หรือพิมพ์)
    const inputValue = event.queryStringParameters.token; 

    if (!inputValue) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูล Input' }),
        };
    }

    try {
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(inputValue);
        
        let employee = null; // ข้อมูลพนักงานที่หาเจอ (ไม่ว่าจะจาก QR ปกติหรือชั่วคราว)
        let couponToUseEmployeeId = null; // ID (UUID) ของพนักงานที่ใช้ค้นหาคูปองใน Daily_Coupons

        // --- NEW LOGIC: ตรวจสอบ QR Code ชั่วคราว (temporary_coupon_requests) ก่อน ---
        if (isUuid) { // ถ้า Input เป็น UUID มีความเป็นไปได้ทั้ง permanent_token และ issued_token
            const { data: tempRequest, error: tempReqError } = await supabase
                .from('temporary_coupon_requests')
                .select('id, employee_id, status, expires_at, temp_employee_name, coupon_type') // เพิ่ม temp_employee_name, coupon_type
                .eq('issued_token', inputValue)
                .single();

            // จัดการข้อผิดพลาดในการดึงข้อมูล temp request (ยกเว้นกรณีไม่พบข้อมูล)
            if (tempReqError && tempReqError.code !== 'PGRST116') { // PGRST116 คือ "ไม่พบข้อมูล"
                 console.error("Error fetching temporary request:", tempReqError);
                 // ไม่ throw error ที่นี่ เพื่อให้ Logic ไปลองค้นหาด้วย permanent_token ต่อไป
            }

            if (tempRequest) { // ถ้าเจอ record ใน temporary_coupon_requests
                const now = new Date();
                const expiresAt = new Date(tempRequest.expires_at);

                // ตรวจสอบสถานะและวันหมดอายุ
                if (tempRequest.status === 'ISSUED' && now < expiresAt) {
                    // ** กรณีนี้คือ QR ชั่วคราวสำหรับพนักงานที่มีอยู่แล้ว (แนวทางที่ 1) **
                    // `employee_id` ใน tempRequest จะต้องไม่เป็น NULL

                    if (!tempRequest.employee_id) {
                         // กรณีนี้คือ temp request ที่ไม่มี employee_id ผูกอยู่ (จะเจอในแนวทางที่ 2)
                         // สำหรับตอนนี้ ถ้าเจอแบบไม่มี employee_id ให้ถือว่ายังไม่รองรับ และปล่อยให้ไป process ต่อ
                         // หรือจะ return error ที่นี่เลยก็ได้ เช่น "QR ชั่วคราวนี้ไม่รองรับการใช้งานในปัจจุบัน"
                         console.warn(`Temporary QR with no employee_id found: ${inputValue}. Skipping direct coupon usage for now.`);
                    } else {
                        // ดึงข้อมูลพนักงานจากตาราง Employees โดยใช้ employee_id จาก tempRequest
                        const { data: tempEmp, error: tempEmpError } = await supabase
                            .from('Employees')
                            .select('id, name, is_active')
                            .eq('id', tempRequest.employee_id) // ค้นหาด้วย UUID จริงๆ ของพนักงาน
                            .single();

                        if (tempEmpError || !tempEmp) {
                            return { statusCode: 404, body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ผูกกับ QR ชั่วคราวนี้' }) };
                        }
                        if (!tempEmp.is_active) {
                            return { statusCode: 403, body: JSON.stringify({ success: false, message: 'พนักงานที่ผูกกับ QR ชั่วคราวนี้ไม่มีสถานะใช้งาน' }) };
                        }
                        
                        employee = tempEmp;
                        couponToUseEmployeeId = tempEmp.id; // ใช้ ID ของพนักงานจริงในการหาคูปองรายวัน

                        // **บันทึกการใช้งาน QR ชั่วคราวนี้**
                        const { error: updateTempReqError } = await supabase
                            .from('temporary_coupon_requests')
                            .update({ status: 'USED', used_at: new Date().toISOString() })
                            .eq('id', tempRequest.id); // อัปเดต record เฉพาะของ temp request นี้

                        if (updateTempReqError) {
                            console.error('Error updating temporary request status:', updateTempReqError);
                            // ไม่ return error หนัก เพราะการใช้คูปองหลักยังสำคัญกว่า
                        }
                    }
                } else if (tempRequest.status === 'USED') {
                     return { statusCode: 403, body: JSON.stringify({ success: false, message: 'QR ชั่วคราวนี้ถูกใช้ไปแล้ว', name: tempRequest.temp_employee_name || 'พนักงาน' }) };
                } else if (now >= expiresAt) {
                     return { statusCode: 403, body: JSON.stringify({ success: false, message: 'QR ชั่วคราวนี้หมดอายุแล้ว', name: tempRequest.temp_employee_name || 'พนักงาน' }) };
                } else {
                    return { statusCode: 403, body: JSON.stringify({ success: false, message: 'QR ชั่วคราวนี้ไม่สามารถใช้งานได้', name: tempRequest.temp_employee_name || 'พนักงาน' }) };
                }
            }
        }
        // --- END NEW LOGIC: ตรวจสอบ QR Code ชั่วคราว ---

        // ถ้ายังไม่พบข้อมูลพนักงานผ่าน QR ชั่วคราว (หรือ input ไม่ใช่ UUID), ให้ใช้ Logic เดิม
        if (!employee) { 
            let query = supabase.from('Employees').select('id, name, is_active');
            
            if (isUuid) { // อาจจะเป็น permanent_token
                query = query.eq('permanent_token', inputValue);
            } else { // อาจจะเป็น employee_id
                query = query.eq('employee_id', inputValue);
            }

            const { data: fetchedEmployee, error: employeeError } = await query.single();
            
            if (employeeError || !fetchedEmployee) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงาน' }),
                };
            }
            if (!fetchedEmployee.is_active) {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' }),
                };
            }
            employee = fetchedEmployee;
            couponToUseEmployeeId = fetchedEmployee.id; // ใช้ ID ของพนักงานจริงในการหาคูปองรายวัน
        }

        // ตอนนี้ `employee` คือข้อมูลพนักงานที่ถูกต้อง และ `couponToUseEmployeeId` คือ ID (UUID) ของเขา
        // เราจะใช้ couponToUseEmployeeId เพื่อค้นหาคูปองใน Daily_Coupons

        // 3. ค้นหาคูปองที่พร้อมใช้งานสำหรับวันนี้ใน Daily_Coupons
        const today = new Date().toISOString().split('T')[0];

        const { data: availableCoupon, error: couponError } = await supabase
            .from('Daily_Coupons')
            .select('id, coupon_type')
            .eq('employee_id', couponToUseEmployeeId) // ใช้ ID (UUID) ของพนักงาน
            .eq('coupon_date', today)
            .eq('status', 'READY')
            .limit(1)
            .single();

        if (couponError || !availableCoupon) {
            console.error('Coupon fetch error:', couponError);
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: 'ไม่พบสิทธิ์คูปองที่พร้อมใช้งานสำหรับวันนี้',
                    name: employee.name,
                }),
            };
        }

        // 4. อัปเดตสถานะคูปองใน Daily_Coupons เป็น USED
        const { error: updateError } = await supabase
            .from('Daily_Coupons')
            .update({
                status: 'USED',
                used_at: new Date().toISOString(),
            })
            .eq('id', availableCoupon.id);

        if (updateError) throw updateError;

        // 5. ส่งผลลัพธ์ว่า "อนุมัติ"
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `อนุมัติ (ประเภท: ${availableCoupon.coupon_type})`,
                name: employee.name,
            }),
        };

    } catch (error) {
        console.error('Error in scan function:', error); 
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในระบบ', error: error.message }),
        };
    }
};
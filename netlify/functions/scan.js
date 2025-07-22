// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin client (with service_role_key)
// สำคัญ: ใช้ service_role_key เพื่อให้ Function มีสิทธิ์ bypass RLS ในการอ่าน/อัปเดตข้อมูลที่สำคัญ
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey); 

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
        
        let employee = null; // ข้อมูลพนักงานที่หาเจอ
        let couponToUseEmployeeId = null; // ID (UUID) ของพนักงานที่ใช้ค้นหาคูปองใน daily_coupons (ถ้ามี)
        let isTempQrConsumed = false; // Flag เพื่อตรวจสอบว่ามีการใช้ QR ชั่วคราวไปแล้ว (ไม่ว่าจะเป็นแนวทางไหน)

        // --- NEW LOGIC: ตรวจสอบ QR Code ชั่วคราว (temporary_coupon_requests) ก่อน ---
        if (isUuid) { // ถ้า Input เป็น UUID มีความเป็นไปได้ทั้ง permanent_token และ issued_token
            const { data: tempRequest, error: tempReqError } = await supabaseAdmin // ใช้ supabaseAdmin
                .from('temporary_coupon_requests') // แก้เป็น 'temporary_coupon_requests' ตัวเล็ก
                .select('id, employee_id, status, expires_at, temp_employee_name, coupon_type') 
                .eq('issued_token', inputValue)
                .single();

            if (tempReqError && tempReqError.code !== 'PGRST116') { // PGRST116 คือ "ไม่พบข้อมูล"
                 console.error("Error fetching temporary request:", tempReqError);
                 // ไม่ throw error ที่นี่ เพื่อให้ Logic ไปลองค้นหาด้วย permanent_token ต่อไป
            }

            if (tempRequest) { // ถ้าเจอ record ใน temporary_coupon_requests
                const now = new Date();
                const expiresAt = new Date(tempRequest.expires_at);

                // ตรวจสอบสถานะและวันหมดอายุ
                if (tempRequest.status === 'ISSUED' && now < expiresAt) {
                    // ** บันทึกการใช้งาน QR ชั่วคราวนี้ (ไม่ว่าจะผูก employee_id หรือไม่ก็ตาม) **
                    const { error: updateTempReqError } = await supabaseAdmin // ใช้ supabaseAdmin
                        .from('temporary_coupon_requests') // แก้เป็น 'temporary_coupon_requests' ตัวเล็ก
                        .update({ status: 'USED', used_at: new Date().toISOString() })
                        .eq('id', tempRequest.id); 

                    if (updateTempReqError) {
                        console.error('Error updating temporary request status:', updateTempReqError);
                        // หากอัปเดตสถานะไม่ได้ ก็ควรมีข้อผิดพลาด
                        return { statusCode: 500, body: JSON.stringify({ success: false, message: `ไม่สามารถบันทึกสถานะ QR ชั่วคราวได้: ${updateTempReqError.message}` }) };
                    }
                    isTempQrConsumed = true; // ตั้งค่า flag ว่า QR ชั่วคราวถูกใช้แล้ว

                    if (!tempRequest.employee_id) { 
                        // ** กรณีนี้คือ QR ชั่วคราวสำหรับบุคคลใหม่/บุคคลที่ไม่รู้จัก (แนวทางที่ 2) **
                        // ไม่ผูกกับ employee_id ในตาราง employees
                        employee = { // สร้าง Object พนักงานจำลองสำหรับ Response
                            id: null, // ไม่มี employee_id จริง
                            name: tempRequest.temp_employee_name || 'บุคคลชั่วคราว',
                            is_active: true // สมมติว่าใช้งานได้
                        };
                        couponToUseEmployeeId = null; // ไม่ต้องไปค้นหาใน daily_coupons ด้วย employee_id
                        
                        // ส่งผลลัพธ์ว่าใช้คูปองชั่วคราวสำเร็จ
                        return {
                            statusCode: 200,
                            body: JSON.stringify({
                                success: true,
                                message: `อนุมัติ (คูปองชั่วคราว ประเภท: ${tempRequest.coupon_type})`,
                                name: employee.name,
                            }),
                        };

                    } else { 
                        // ** กรณีนี้คือ QR ชั่วคราวสำหรับพนักงานที่มีอยู่แล้ว (แนวทางที่ 1) **
                        // ผูกกับ employee_id ในตาราง employees
                        const { data: tempEmp, error: tempEmpError } = await supabaseAdmin // ใช้ supabaseAdmin
                            .from('employees') // แก้เป็น 'employees' ตัวเล็ก
                            .select('id, name, is_active')
                            .eq('id', tempRequest.employee_id) 
                            .single();

                        if (tempEmpError || !tempEmp) {
                            return { statusCode: 404, body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ผูกกับ QR ชั่วคราวนี้' }) };
                        }
                        if (!tempEmp.is_active) {
                            return { statusCode: 403, body: JSON.stringify({ success: false, message: 'พนักงานที่ผูกกับ QR ชั่วคราวนี้ไม่มีสถานะใช้งาน' }) };
                        }
                        
                        employee = tempEmp;
                        couponToUseEmployeeId = tempEmp.id; // ใช้ ID ของพนักงานจริงในการหาคูปองรายวัน
                        // Logic การหาคูปองรายวันจะดำเนินต่อด้านล่าง
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

        // ถ้ายังไม่พบข้อมูลพนักงานผ่าน QR ชั่วคราว (isTempQrConsumed เป็น false), 
        // หรือ input ไม่ใช่ UUID, ให้ใช้ Logic เดิมในการค้นหาพนักงานหลัก
        if (!employee) { 
            let query = supabaseAdmin.from('employees').select('id, name, is_active'); // แก้เป็น 'employees' ตัวเล็ก
            
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
            couponToUseEmployeeId = fetchedEmployee.id; 
        }

        // ตอนนี้ `employee` คือข้อมูลพนักงานที่ถูกต้อง และ `couponToUseEmployeeId` คือ ID (UUID) ของเขา
        // เราจะใช้ couponToUseEmployeeId เพื่อค้นหาคูปองใน daily_coupons
        // Logic นี้จะทำงานก็ต่อเมื่อเป็นพนักงานปกติ หรือเป็นพนักงานเดิมที่ใช้ QR ชั่วคราว (แนวทางที่ 1)

        // 3. ค้นหาคูปองที่พร้อมใช้งานสำหรับวันนี้ใน daily_coupons
        const today = new Date().toISOString().split('T')[0];

        const { data: availableCoupon, error: couponError } = await supabaseAdmin // ใช้ supabaseAdmin
            .from('daily_coupons') // แก้เป็น 'daily_coupons' ตัวเล็ก
            .select('id, coupon_type')
            .eq('employee_id', couponToUseEmployeeId) 
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

        // 4. อัปเดตสถานะคูปองใน daily_coupons เป็น USED
        const { error: updateError } = await supabaseAdmin // ใช้ supabaseAdmin
            .from('daily_coupons') // แก้เป็น 'daily_coupons' ตัวเล็ก
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
// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin client (with service_role_key)
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey); 

export const handler = async (event) => {
    const inputValue = event.queryStringParameters.token; 

    if (!inputValue) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, status_code: 'INVALID_INPUT', message: 'ไม่พบข้อมูล Input' }),
        };
    }

    try {
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(inputValue);
        
        let employee = null; 
        let couponToUseEmployeeId = null; 

        // --- ตรวจสอบ QR Code ชั่วคราว (temporary_coupon_requests) ก่อน ---
        if (isUuid) { 
            const { data: tempRequest, error: tempReqError } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .select('id, employee_id, status, expires_at, temp_employee_name, coupon_type') 
                .eq('issued_token', inputValue)
                .single();

            if (tempReqError && tempReqError.code !== 'PGRST116') {
                 console.error("Error fetching temporary request:", tempReqError);
            }

            if (tempRequest) {
                const now = new Date();
                const expiresAt = new Date(tempRequest.expires_at);

                if (tempRequest.status === 'ISSUED' && now < expiresAt) {
                    const updateData = { status: 'USED', used_at: new Date().toISOString() };
                    const { error: updateTempReqError } = await supabaseAdmin
                        .from('temporary_coupon_requests')
                        .update(updateData)
                        .eq('id', tempRequest.id); 

                    if (updateTempReqError) {
                        console.error('Error updating temporary request status:', updateTempReqError);
                        return { 
                            statusCode: 500, 
                            body: JSON.stringify({ 
                                success: false, 
                                status_code: 'UPDATE_FAILED', 
                                message: `ไม่สามารถบันทึกสถานะ QR ชั่วคราวได้: ${updateTempReqError.message}` 
                            }) 
                        };
                    }

                    // ถ้าเป็น QR ชั่วคราวสำหรับบุคคลใหม่/ไม่รู้จัก
                    if (!tempRequest.employee_id) { 
                        return {
                            statusCode: 200,
                            body: JSON.stringify({
                                success: true,
                                status_code: 'APPROVED_TEMP_NEW', // สถานะใหม่: อนุมัติคูปองชั่วคราวสำหรับบุคคลใหม่
                                message: `อนุมัติ (คูปองชั่วคราว)`,
                                name: tempRequest.temp_employee_name || 'บุคคลชั่วคราว',
                                employee_id: tempRequest.temp_employee_identifier || 'N/A', // ใช้ temp_employee_identifier
                                coupon_type: tempRequest.coupon_type,
                                used_at: updateData.used_at // ใช้เวลาที่อัปเดตไป
                            }),
                        };
                    } else { 
                        // ถ้าเป็น QR ชั่วคราวสำหรับพนักงานที่มีอยู่แล้ว (ยังต้องไปเช็ค Daily_Coupons)
                        const { data: tempEmp, error: tempEmpError } = await supabaseAdmin
                            .from('employees')
                            .select('id, name, employee_id, is_active') // เพิ่ม employee_id
                            .eq('id', tempRequest.employee_id) 
                            .single();

                        if (tempEmpError || !tempEmp) {
                            return { 
                                statusCode: 404, 
                                body: JSON.stringify({ 
                                    success: false, 
                                    status_code: 'EMP_NOT_FOUND_TEMP_QR', 
                                    message: 'ไม่พบข้อมูลพนักงานที่ผูกกับ QR ชั่วคราวนี้' 
                                }) 
                            };
                        }
                        if (!tempEmp.is_active) {
                            return { 
                                statusCode: 403, 
                                body: JSON.stringify({ 
                                    success: false, 
                                    status_code: 'EMP_INACTIVE', 
                                    message: 'พนักงานที่ผูกกับ QR ชั่วคราวนี้ไม่มีสถานะใช้งาน', 
                                    name: tempEmp.name, 
                                    employee_id: tempEmp.employee_id 
                                }) 
                            };
                        }
                        
                        employee = tempEmp;
                        couponToUseEmployeeId = tempEmp.id;
                        // Logic การหาคูปองรายวันจะดำเนินต่อด้านล่าง
                    }
                } else if (tempRequest.status === 'USED') {
                     return { 
                         statusCode: 403, 
                         body: JSON.stringify({ 
                             success: false, 
                             status_code: 'ALREADY_USED_TEMP', 
                             message: 'QR ชั่วคราวนี้ถูกใช้ไปแล้ว', 
                             name: tempRequest.temp_employee_name || 'พนักงาน', 
                             employee_id: tempRequest.temp_employee_identifier || 'N/A',
                             coupon_type: tempRequest.coupon_type
                         }) 
                     };
                } else if (now >= expiresAt) {
                     return { 
                         statusCode: 403, 
                         body: JSON.stringify({ 
                             success: false, 
                             status_code: 'EXPIRED_TEMP', 
                             message: 'QR ชั่วคราวนี้หมดอายุแล้ว', 
                             name: tempRequest.temp_employee_name || 'พนักงาน', 
                             employee_id: tempRequest.temp_employee_identifier || 'N/A',
                             coupon_type: tempRequest.coupon_type
                         }) 
                     };
                } else {
                    return { 
                        statusCode: 403, 
                        body: JSON.stringify({ 
                            success: false, 
                            status_code: 'TEMP_QR_INVALID_STATUS', 
                            message: 'QR ชั่วคราวนี้ไม่สามารถใช้งานได้', 
                            name: tempRequest.temp_employee_name || 'พนักงาน', 
                            employee_id: tempRequest.temp_employee_identifier || 'N/A',
                            coupon_type: tempRequest.coupon_type
                        }) 
                    };
                }
            }
        }
        // --- สิ้นสุดการตรวจสอบ QR Code ชั่วคราว ---

        // ถ้ายังไม่พบข้อมูลพนักงานผ่าน QR ชั่วคราว หรือ input ไม่ใช่ UUID, ให้ใช้ Logic เดิม
        if (!employee) { 
            let query = supabaseAdmin.from('employees').select('id, name, employee_id, is_active'); // เพิ่ม employee_id
            
            if (isUuid) { 
                query = query.eq('permanent_token', inputValue);
            } else { 
                query = query.eq('employee_id', inputValue);
            }

            const { data: fetchedEmployee, error: employeeError } = await query.single();
            
            if (employeeError || !fetchedEmployee) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ 
                        success: false, 
                        status_code: 'EMP_NOT_FOUND', 
                        message: 'ไม่พบข้อมูลพนักงาน', 
                        employee_id: inputValue 
                    }),
                };
            }
            if (!fetchedEmployee.is_active) {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ 
                        success: false, 
                        status_code: 'EMP_INACTIVE', 
                        message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน', 
                        name: fetchedEmployee.name, 
                        employee_id: fetchedEmployee.employee_id 
                    }),
                };
            }
            employee = fetchedEmployee;
            couponToUseEmployeeId = fetchedEmployee.id; 
        }

        // 3. ค้นหาคูปองที่พร้อมใช้งานสำหรับวันนี้ใน daily_coupons (สำหรับพนักงานหลักหรือ QR ชั่วคราวที่ผูกกับพนักงานหลัก)
        const today = new Date().toISOString().split('T')[0];

        const { data: availableCoupon, error: couponError } = await supabaseAdmin
            .from('daily_coupons')
            .select('id, coupon_type, used_at') // เพิ่ม used_at
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
                    status_code: 'COUPON_NOT_READY',
                    message: 'ไม่พบสิทธิ์คูปองที่พร้อมใช้งานสำหรับวันนี้',
                    name: employee.name,
                    employee_id: employee.employee_id,
                }),
            };
        }

        // 4. อัปเดตสถานะคูปองใน daily_coupons เป็น USED
        const updateData = { status: 'USED', used_at: new Date().toISOString() };
        const { error: updateError } = await supabaseAdmin
            .from('daily_coupons')
            .update(updateData)
            .eq('id', availableCoupon.id);

        if (updateError) throw updateError;

        // 5. ส่งผลลัพธ์ว่า "อนุมัติ"
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                status_code: 'APPROVED_DAILY', // สถานะใหม่: อนุมัติคูปองรายวันปกติ
                message: `อนุมัติ`,
                name: employee.name,
                employee_id: employee.employee_id,
                coupon_type: availableCoupon.coupon_type,
                used_at: updateData.used_at // ใช้เวลาที่อัปเดตไป
            }),
        };

    } catch (error) {
        console.error('Error in scan function:', error); 
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, status_code: 'SERVER_ERROR', message: 'เกิดข้อผิดพลาดในระบบ', error: error.message }),
        };
    }
};
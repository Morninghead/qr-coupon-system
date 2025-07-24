
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
        const today = new Date().toISOString().split('T')[0]; // Current date for daily coupons

        let employee = null; 
        let couponToUseEmployeeId = null; 
        let finalCouponType = null; // Store the coupon type that was used
        let isPermanentTokenScan = false; // Flag to indicate if it's a permanent token scan

        // --- 1. Check if the scanned UUID is an active temporary coupon request ---
        if (isUuid) { 
            const { data: tempRequest, error: tempReqError } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .select('id, employee_id, status, expires_at, temp_employee_name, temp_employee_identifier, coupon_type') 
                .eq('issued_token', inputValue)
                .single();

            if (tempReqError && tempReqError.code !== 'PGRST116') { // PGRST116 means "No rows found"
                 console.error("Error fetching temporary request:", tempReqError);
            }

            if (tempRequest) {
                const now = new Date();
                const expiresAt = new Date(tempRequest.expires_at);

                if (tempRequest.status === 'ISSUED' && now < expiresAt) {
                    const updateTempReqData = { status: 'USED', used_at: new Date().toISOString() };
                    const { error: updateTempReqError } = await supabaseAdmin
                        .from('temporary_coupon_requests')
                        .update(updateTempReqData)
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
                    
                    finalCouponType = tempRequest.coupon_type; // Store the coupon type from temp request

                    // If it's a temporary QR for a new/unknown individual
                    if (!tempRequest.employee_id) { 
                        return {
                            statusCode: 200,
                            body: JSON.stringify({
                                success: true,
                                status_code: 'APPROVED_TEMP_NEW', 
                                message: `อนุมัติ (คูปองชั่วคราว)`,
                                name: tempRequest.temp_employee_name || 'บุคคลชั่วคราว',
                                employee_id: tempRequest.temp_employee_identifier || 'N/A', 
                                coupon_type: finalCouponType,
                                used_at: updateTempReqData.used_at 
                            }),
                        };
                    } else { 
                        // It's a temporary QR for an EXISTING employee (reusing permanent token)
                        // This scan should now create/update a daily coupon entry
                        const { data: empDetails, error: empDetailsError } = await supabaseAdmin
                            .from('employees')
                            .select('id, name, employee_id, is_active')
                            .eq('id', tempRequest.employee_id)
                            .single();
                        
                        if (empDetailsError || !empDetails) {
                             console.error('Error fetching employee details for temp QR:', empDetailsError);
                             return {
                                statusCode: 404, 
                                body: JSON.stringify({
                                    success: false,
                                    status_code: 'EMP_NOT_FOUND_FOR_TEMP_QR',
                                    message: 'ไม่พบข้อมูลพนักงานที่ผูกกับ QR ชั่วคราวนี้',
                                    name: tempRequest.temp_employee_name || 'พนักงาน',
                                    employee_id: tempRequest.temp_employee_identifier || 'N/A',
                                    coupon_type: finalCouponType
                                }),
                            };
                        }
                        if (!empDetails.is_active) {
                            return { 
                                statusCode: 403, 
                                body: JSON.stringify({ 
                                    success: false, 
                                    status_code: 'EMP_INACTIVE', 
                                    message: 'พนักงานที่ผูกกับ QR ชั่วคราวนี้ไม่มีสถานะใช้งาน', 
                                    name: empDetails.name, 
                                    employee_id: empDetails.employee_id,
                                    coupon_type: finalCouponType
                                }) 
                            };
                        }

                        // Try to find an existing READY daily coupon or create a new USED one
                        const { data: existingDailyCoupon, error: dailyCouponError } = await supabaseAdmin
                            .from('daily_coupons')
                            .select('id, status, used_at')
                            .eq('employee_id', empDetails.id)
                            .eq('coupon_date', today)
                            .eq('coupon_type', finalCouponType) 
                            .single();

                        const dailyCouponUseTime = new Date().toISOString();
                        let finalUsedAt = dailyCouponUseTime; // Default to current scan time

                        if (existingDailyCoupon && existingDailyCoupon.status === 'READY') {
                            // If READY coupon exists, update it to USED
                            const { error: updateDailyError } = await supabaseAdmin
                                .from('daily_coupons')
                                .update({ status: 'USED', used_at: dailyCouponUseTime })
                                .eq('id', existingDailyCoupon.id);
                            if (updateDailyError) throw updateDailyError;
                            
                        } else if (!existingDailyCoupon) {
                            // If no coupon exists, insert a new USED one
                            const { error: insertDailyError } = await supabaseAdmin
                                .from('daily_coupons')
                                .insert({
                                    employee_id: empDetails.id,
                                    coupon_date: today,
                                    coupon_type: finalCouponType,
                                    status: 'USED',
                                    used_at: dailyCouponUseTime
                                });
                            if (insertDailyError) throw insertDailyError;
                        } else if (existingDailyCoupon.status === 'USED') {
                            // If already USED, log a warning but still approve the temporary usage
                            console.warn(`Daily coupon for ${empDetails.employee_id} (type: ${finalCouponType}) was already USED today.`);
                            finalUsedAt = existingDailyCoupon.used_at || dailyCouponUseTime; // Use existing used_at if available
                        }

                        // Return success for the temporary coupon usage for existing employee
                        return {
                            statusCode: 200,
                            body: JSON.stringify({
                                success: true,
                                status_code: 'APPROVED_DAILY', // Report as a standard daily coupon usage
                                message: `อนุมัติ`,
                                name: empDetails.name,
                                employee_id: empDetails.employee_id,
                                coupon_type: finalCouponType,
                                used_at: finalUsedAt 
                            }),
                        };
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
            } else {
                // If tempRequest is null, it means the UUID scanned is NOT an issued_token in temporary_coupon_requests.
                // In this case, proceed with it being a permanent token scan.
                isPermanentTokenScan = true;
            }
        } else {
            // If inputValue is not a UUID, it must be an employee_id (permanent scan)
            isPermanentTokenScan = true;
        }

        // --- 2. If it's a permanent token scan (either direct or UUID not found in temp requests) ---
        if (isPermanentTokenScan) { 
            let query = supabaseAdmin.from('employees').select('id, name, employee_id, is_active, permanent_token'); 
            
            if (isUuid) { // If it's a UUID, check permanent_token
                query = query.eq('permanent_token', inputValue);
            } else { // If not a UUID, assume employee_id
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

            // 3. Find a READY daily coupon for today
            const { data: availableCoupon, error: couponError } = await supabaseAdmin
                .from('daily_coupons')
                .select('id, coupon_type, used_at') 
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

            // 4. Update the daily coupon status to USED
            const updateData = { status: 'USED', used_at: new Date().toISOString() };
            const { error: updateError } = await supabaseAdmin
                .from('daily_coupons')
                .update(updateData)
                .eq('id', availableCoupon.id);

            if (updateError) throw updateError;

            // 5. Return "Approved" result
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    status_code: 'APPROVED_DAILY', 
                    message: `อนุมัติ`,
                    name: employee.name,
                    employee_id: employee.employee_id,
                    coupon_type: availableCoupon.coupon_type,
                    used_at: updateData.used_at 
                }),
            };
        } // End of isPermanentTokenScan block

    } catch (error) {
        console.error('Error in scan function:', error); 
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, status_code: 'SERVER_ERROR', message: 'เกิดข้อผิดพลาดในระบบ', error: error.message }),
        };
    }
};

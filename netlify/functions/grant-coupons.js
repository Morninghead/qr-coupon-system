import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

function getBangkokDate() {
    const now = new Date();
    const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    return bangkokTime.toISOString().split('T')[0];
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authentication and Authorization Check
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }
        
        // 2. ตรวจสอบสิทธิ์ - อนุญาตเฉพาะ 'superuser' หรือ 'department_admin'
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || !['superuser', 'department_admin'].includes(profile.role)) {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied' }) };
        }

        const { action } = event.queryStringParameters; // Get action from query string

        // --- PHASE 1: Pre-check eligibility ---
        if (action === 'pre_check') {
            const { employeeIds, couponType } = JSON.parse(event.body);
            if (!employeeIds || !couponType || employeeIds.length === 0) {
                return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee IDs or coupon type for pre-check.' }) };
            }

            // Fetch all employee details for display (id, name, employee_id)
            const { data: employeesData, error: employeesDataError } = await supabaseAdmin
                .from('employees')
                .select('id, employee_id, name')
                .in('employee_id', employeeIds);
            
            if (employeesDataError) throw employeesDataError;
            
            const foundEmployeeMap = new Map(employeesData.map(e => [e.employee_id, { id: e.id, name: e.name }]));
            
            const today = getBangkokDate();

            // Check existing coupons for today and this type
            const { data: existingCoupons, error: checkError } = await supabaseAdmin
                .from('daily_coupons')
                .select('employee_id, status, used_at') // <<< NEW: Select status and used_at
                .in('employee_id', employeesData.map(e => e.id)) // Use UUIDs for query
                .eq('coupon_date', today)
                .eq('coupon_type', couponType);

            if (checkError) throw checkError;

            // Map employee UUID to their current coupon status and used_at
            const existingCouponStatusMap = new Map(existingCoupons.map(c => [c.employee_id, { status: c.status, used_at: c.used_at }])); // <<< NEW: Map coupon status and used_at

            let readyToGrantIds = []; 
            let alreadyExistsIds = []; 
            let notFoundIds = []; 

            // Prepare results for frontend
            const employeesForFrontend = [];
            for (const empId of employeeIds) {
                const empDetails = foundEmployeeMap.get(empId);
                if (empDetails) {
                    const couponStatus = existingCouponStatusMap.get(empDetails.id); // Get coupon status
                    
                    employeesForFrontend.push({
                        employee_id: empId,
                        name: empDetails.name,
                        status: couponStatus ? 'duplicate' : 'ready_to_grant', // Set 'duplicate' if coupon exists
                        coupon_status_detail: couponStatus ? couponStatus.status : null, // Add coupon status detail
                        coupon_used_at: couponStatus ? couponStatus.used_at : null // Add coupon used_at
                    });
                    if (couponStatus) { 
                        alreadyExistsIds.push(empId);
                    } else {
                        readyToGrantIds.push(empId);
                    }
                } else {
                    notFoundIds.push(empId);
                    employeesForFrontend.push({
                        employee_id: empId,
                        name: 'ไม่พบชื่อ',
                        status: 'not_found',
                        coupon_status_detail: null, 
                        coupon_used_at: null
                    });
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'Pre-check completed.',
                    employees: employeesForFrontend, 
                    readyToGrant: readyToGrantIds,
                    alreadyExists: alreadyExistsIds,
                    notFound: notFoundIds
                }),
            };
        }

        // --- PHASE 2: Final Grant ---
        if (action === 'final_grant') {
            const { couponType, employeeIdsToGrant, employeeIdsToGrantDuplicates } = JSON.parse(event.body);

            if (!couponType || (!employeeIdsToGrant && !employeeIdsToGrantDuplicates)) {
                return { statusCode: 400, body: JSON.stringify({ message: 'Missing coupon type or employee IDs for final grant.' }) };
            }

            let insertedCount = 0;
            let updatedCount = 0; 

            const allEmployeeIdsToProcess = [...(employeeIdsToGrant || []), ...(employeeIdsToGrantDuplicates || [])];
            if (allEmployeeIdsToProcess.length === 0) {
                 return { statusCode: 400, body: JSON.stringify({ message: 'No employees selected for final grant.' }) };
            }

            // Fetch UUIDs for selected employee_ids
            const { data: employeesSelected, error: employeesSelectedError } = await supabaseAdmin
                .from('employees')
                .select('id, employee_id')
                .in('employee_id', allEmployeeIdsToProcess);

            if (employeesSelectedError) throw employeesSelectedError;

            const selectedEmployeeIdMap = new Map(employeesSelected.map(e => [e.employee_id, e.id]));

            const today = getBangkokDate();

            // Handle new grants (idsToGrant)
            if (employeeIdsToGrant && employeeIdsToGrant.length > 0) {
                const uuidsToInsert = employeeIdsToGrant
                    .filter(empId => selectedEmployeeIdMap.has(empId))
                    .map(empId => selectedEmployeeIdMap.get(empId));

                const couponsToInsert = uuidsToInsert.map(uuid => ({
                    employee_id: uuid,
                    coupon_date: today,
                    coupon_type: couponType,
                    status: 'READY', 
                    issued_by: user.id 
                }));

                if (couponsToInsert.length > 0) {
                    const { error: insertError } = await supabaseAdmin.from('daily_coupons').insert(couponsToInsert);
                    if (insertError) {
                        console.error('Error inserting new coupons:', insertError);
                        throw new Error(`Failed to insert new coupons: ${insertError.message}`);
                    }
                    insertedCount += couponsToInsert.length;
                }
            }

            // Handle force grants (idsToGrantDuplicates) - Update existing to "READY" if needed, or re-insert
            if (employeeIdsToGrantDuplicates && employeeIdsToGrantDuplicates.length > 0) {
                const uuidsToForceGrant = employeeIdsToGrantDuplicates
                    .filter(empId => selectedEmployeeIdMap.has(empId))
                    .map(empId => selectedEmployeeIdMap.get(empId));

                for (const uuid of uuidsToForceGrant) {
                    const { data: existingCoupon, error: findError } = await supabaseAdmin
                        .from('daily_coupons')
                        .select('id, status') 
                        .eq('employee_id', uuid)
                        .eq('coupon_date', today)
                        .eq('coupon_type', couponType)
                        .single();

                    if (findError && findError.code !== 'PGRST116') {
                        console.error('Error finding existing coupon for force grant:', findError);
                        throw findError;
                    }

                    if (existingCoupon) {
                        if (existingCoupon.status !== 'READY') { 
                            const { error: updateError } = await supabaseAdmin
                                .from('daily_coupons')
                                .update({ status: 'READY', used_at: null, updated_at: new Date().toISOString(), issued_by: user.id }) 
                                .eq('id', existingCoupon.id);
                            if (updateError) {
                                console.error('Error updating existing coupon for force grant:', updateError);
                                throw new Error(`Failed to update existing coupon for force grant: ${updateError.message}`);
                            }
                            updatedCount++;
                        } else {
                            updatedCount++; 
                        }
                    } else {
                        const { error: insertError } = await supabaseAdmin
                            .from('daily_coupons')
                            .insert({
                                employee_id: uuid,
                                coupon_date: today,
                                coupon_type: couponType,
                                status: 'READY',
                                issued_by: user.id
                            });
                        if (insertError) {
                            console.error('Error inserting new coupon for force grant (no existing):', insertError);
                            throw new Error(`Failed to insert new coupon for force grant: ${insertError.message}`);
                        }
                        insertedCount++; 
                    }
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: `ให้สิทธิ์คูปองสำเร็จ ${insertedCount} รายการ และอัปเดต ${updatedCount} รายการ`,
                    insertedCount: insertedCount,
                    updatedCount: updatedCount
                }),
            };
        }

        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid action specified.' }) };

    } catch (error) {
        console.error('Grant Coupon Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};
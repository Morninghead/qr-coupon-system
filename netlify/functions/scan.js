// ส่วน import และ const supabase = createClient(...) เหมือนเดิม

export const handler = async (event) => {
    // 1. รับค่า Input จาก URL (อาจจะเป็น token หรือ employee_id)
    const inputValue = event.queryStringParameters.token; // ตั้งชื่อตัวแปรเหมือนเดิมเพื่อง่าย

    if (!inputValue) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูล Input' }),
        };
    }

    try {
        // --- ส่วนที่แก้ไข ---
        // 2. ตรวจสอบว่า Input เป็น UUID (token) หรือ Employee ID
        // Regex to check for UUID format
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(inputValue);
        
        let query = supabase.from('Employees').select('id, name, is_active');
        
        if (isUuid) {
            // ถ้าเป็น UUID ให้ค้นหาจาก permanent_token
            query = query.eq('permanent_token', inputValue);
        } else {
            // ถ้าไม่ใช่ ให้ค้นหาจาก employee_id
            query = query.eq('employee_id', inputValue);
        }

        const { data: employee, error: employeeError } = await query.single();
        // ------------------

        if (employeeError || !employee) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงาน' }),
            };
        }

        if (!employee.is_active) {
            return {
                statusCode: 403,
                body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' }),
            };
        }

        // 3. ค้นหาคูปองที่พร้อมใช้งานสำหรับวันนี้ (เหมือนเดิม)
        const today = new Date().toISOString().split('T')[0];

        const { data: availableCoupon, error: couponError } = await supabase
            .from('Daily_Coupons')
            .select('id, coupon_type')
            .eq('employee_id', employee.id)
            .eq('coupon_date', today)
            .eq('status', 'READY')
            .limit(1)
            .single();

        if (couponError || !availableCoupon) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: 'ไม่พบสิทธิ์ที่พร้อมใช้งานสำหรับวันนี้',
                    name: employee.name,
                }),
            };
        }

        // 4. อัปเดตสถานะคูปองเป็น USED (เหมือนเดิม)
        const { error: updateError } = await supabase
            .from('Daily_Coupons')
            .update({
                status: 'USED',
                used_at: new Date().toISOString(),
            })
            .eq('id', availableCoupon.id);

        if (updateError) throw updateError;

        // 5. ส่งผลลัพธ์ว่า "อนุมัติ" (เหมือนเดิม)
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `อนุมัติ (ประเภท: ${availableCoupon.coupon_type})`,
                name: employee.name,
            }),
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' }),
        };
    }
};
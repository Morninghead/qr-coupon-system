// /netlify/functions/get-coupon-by-employee-id.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Allow': 'POST' }, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  try {
    // 1. Authentication (Don't touch)
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token' }) };
    }

    // 2. Parse ID from body
    const { employeeId } = JSON.parse(event.body);
    if (!employeeId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Missing employeeId.' }) };
    }

    const today = new Date().toISOString().split('T')[0];

    // 3. Attempt to find a ready coupon in 'daily_coupons' for a regular employee
    let { data: coupon, error: regularError } = await supabaseAdmin
      .from('daily_coupons')
      .select(`
        *,
        employees ( name, employee_id, photo_url )
      `)
      .eq('employee_id_input', employeeId) // Assuming you have a column for manual ID entry
      .eq('coupon_date', today)
      .eq('status', 'READY')
      .maybeSingle();

    if (regularError) throw regularError;
    
    if (coupon) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          type: 'regular',
          couponId: coupon.id,
          name: coupon.employees.name,
          employee_id: coupon.employees.employee_id,
          photo_url: coupon.employees.photo_url
        }),
      };
    }

    // 4. If not found, attempt to find in 'temporary_coupon_requests'
    let { data: tempCoupon, error: tempError } = await supabaseAdmin
      .from('temporary_coupon_requests')
      .select('*')
      .eq('temp_employee_id', employeeId) // Assuming the human-readable ID field is 'temp_employee_id'
      .eq('coupon_date', today)
      .eq('status', 'READY')
      .maybeSingle();

    if (tempError) throw tempError;

    if (tempCoupon) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          type: 'temp',
          couponId: tempCoupon.id, // This is the request ID, which you use to redeem
          name: tempCoupon.temp_employee_name,
          employee_id: tempCoupon.temp_employee_id,
          photo_url: 'https://placehold.co/100x100/EFEFEF/AAAAAA?text=Temp' // Placeholder photo
        }),
      };
    }
    
    // 5. If not found in either, return an error
    return {
      statusCode: 404,
      body: JSON.stringify({ success: false, message: `ไม่พบคูปองที่พร้อมใช้งานสำหรับรหัส '${employeeId}' ในวันนี้` }),
    };

  } catch (error) {
    console.error('Get Coupon by ID Error:', error);
    if (error instanceof SyntaxError) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Malformed JSON.' }) };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
    };
  }
};

// /netlify/functions/get-report-data.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
  // Authentication (Don't touch)
  const token = event.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
  }
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token' }) };
  }
  
  const { startDate, endDate, departmentId } = event.queryStringParameters;
  const startOfDay = `${startDate} 00:00:00`;
  const endOfDay = `${endDate} 23:59:59`;

  try {
    // --- Step 1: Fetch Regular Coupons (Normal & OT) ---
    // This query correctly filters by department via the employees table.
    let regularQuery = supabaseAdmin
      .from('daily_coupons')
      .select('coupon_type, status, employees!inner(department_id)')
      .gte('coupon_date', startDate)
      .lte('coupon_date', endDate);

    if (departmentId && departmentId !== 'all') {
      regularQuery = regularQuery.eq('employees.department_id', departmentId);
    }

    const { data: regularCoupons, error: regularError } = await regularQuery;
    if (regularError) {
        console.error('Regular Coupon Query Error:', regularError);
        throw regularError;
    }

    // --- Step 2: Fetch Temporary Coupons ---
    let tempCoupons = [];
    // Only fetch temp coupons if 'All Departments' is selected.
    if (!departmentId || departmentId === 'all') {
        const { data: tempData, error: tempError } = await supabaseAdmin
          .from('temporary_coupon_requests')
          .select('status')
          // *** FIX: Changed 'coupon_date' to the correct column 'created_at' ***
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay);
        
        if (tempError) {
            console.error('Temporary Coupon Query Error:', tempError);
            throw tempError;
        }
        tempCoupons = tempData;
    }
    
    // --- Step 3: Process Data (This logic remains the same) ---
    const report = {
      normalData: { totalGranted: 0, totalUsed: 0 },
      otData: { totalGranted: 0, totalUsed: 0 },
      tempData: { totalGranted: 0, totalUsed: 0 }
    };

    regularCoupons.forEach(c => {
      if (c.coupon_type === 'NORMAL') {
        report.normalData.totalGranted++;
        if (c.status === 'USED') {
          report.normalData.totalUsed++;
        }
      } else if (c.coupon_type === 'OT') {
        report.otData.totalGranted++;
        if (c.status === 'USED') {
          report.otData.totalUsed++;
        }
      }
    });

    tempCoupons.forEach(c => {
      report.tempData.totalGranted++;
      if (c.status === 'USED') {
        report.tempData.totalUsed++;
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify(report),
    };

  } catch (error) {
    console.error('Get Report Data Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
    };
  }
};

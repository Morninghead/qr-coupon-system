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
    // --- Step 1: Fetch Regular Coupons ---
    let regularQuery = supabaseAdmin
      .from('daily_coupons')
      // Correctly join with employees table to access department_id
      .select('coupon_type, status, employees!inner(department_id)') 
      .gte('coupon_date', startDate)
      .lte('coupon_date', endDate);

    // Now, filter on the joined table
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
    // Temp coupons are not associated with a department, so only include them when 'All' is selected.
    if (!departmentId || departmentId === 'all') {
        const { data: tempData, error: tempError } = await supabaseAdmin
          .from('temporary_coupon_requests')
          .select('coupon_type, status')
          .gte('created_at', startOfDay) // Use 'created_at' as per our last fix
          .lte('created_at', endOfDay);
        
        if (tempError) {
            console.error('Temporary Coupon Query Error:', tempError);
            throw tempError;
        }
        tempCoupons = tempData;
    }
    
    // --- Step 3: Process Data into the 4 required categories ---
    const report = {
      regularNormalData: { totalGranted: 0, totalUsed: 0 },
      regularOtData: { totalGranted: 0, totalUsed: 0 },
      tempNormalData: { totalGranted: 0, totalUsed: 0 },
      tempOtData: { totalGranted: 0, totalUsed: 0 },
    };

    regularCoupons.forEach(c => {
      if (c.coupon_type === 'NORMAL') {
        report.regularNormalData.totalGranted++;
        if (c.status === 'USED') report.regularNormalData.totalUsed++;
      } else if (c.coupon_type === 'OT') {
        report.regularOtData.totalGranted++;
        if (c.status === 'USED') report.regularOtData.totalUsed++;
      }
    });

    tempCoupons.forEach(c => {
      if (c.coupon_type === 'NORMAL') {
        report.tempNormalData.totalGranted++;
        if (c.status === 'USED') report.tempNormalData.totalUsed++;
      } else if (c.coupon_type === 'OT') {
        report.tempOtData.totalGranted++;
        if (c.status === 'USED') report.tempOtData.totalUsed++;
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

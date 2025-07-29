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

  try {
    // --- Step 1: Fetch Regular Coupons (Normal & OT) ---
    let regularQuery = supabaseAdmin
      .from('daily_coupons')
      .select('coupon_type, status')
      .gte('coupon_date', startDate)
      .lte('coupon_date', endDate);

    if (departmentId && departmentId !== 'all') {
      regularQuery = regularQuery.eq('department_id', departmentId);
    }

    const { data: regularCoupons, error: regularError } = await regularQuery;
    if (regularError) throw regularError;

    // --- Step 2: Fetch Temporary Coupons ---
    const { data: tempCoupons, error: tempError } = await supabaseAdmin
      .from('temporary_coupon_requests')
      .select('status')
      .gte('coupon_date', startDate)
      .lte('coupon_date', endDate);
    
    if (tempError) throw tempError;

    // --- Step 3: Process Data ---
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

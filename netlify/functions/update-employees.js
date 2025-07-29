// /netlify/functions/update-employees.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Allow': 'POST' },
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  try {
    // 1. Authentication and Authorization
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token' }) };
    }
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
        return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
    }

    // 2. Parse data from body
    const { id, name, department_id, is_active } = JSON.parse(event.body);
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Missing required field `id`.' }) };
    }

    // 3. Check if the ID exists in the 'employees' table
    const { data: regularEmployee } = await supabaseAdmin.from('employees').select('id').eq('id', id).single();

    if (regularEmployee) {
      // It's a regular employee. Build the update payload.
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (department_id !== undefined) updateData.department_id = department_id;
      
      if (is_active !== undefined) {
        if (profile.role !== 'superuser') {
          return { statusCode: 403, body: JSON.stringify({ message: 'Permission Denied: Only a Superuser can change employee status.' }) };
        }
        updateData.is_active = is_active;
      }

      if (Object.keys(updateData).length === 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'No fields provided to update.'}) };
      }

      const { data, error } = await supabaseAdmin.from('employees').update(updateData).eq('id', id).select().single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Regular employee updated successfully.', data }) };
    }

    // 4. If not regular, check the 'temporary_coupon_requests' table
    const { data: tempEmployee } = await supabaseAdmin.from('temporary_coupon_requests').select('id').eq('id', id).single();

    if (tempEmployee) {
      if (profile.role !== 'superuser') {
          return { statusCode: 403, body: JSON.stringify({ message: 'Permission Denied: Only a Superuser can update temporary employees.' }) };
      }
      if (name === undefined) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: `name` is required to update a temporary employee.' }) };
      }
      
      const { data, error } = await supabaseAdmin.from('temporary_coupon_requests').update({ temp_employee_name: name }).eq('id', id).select().single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Temporary employee updated successfully.', data }) };
    }

    // 5. If not found in either table, return 404
    return {
      statusCode: 404,
      body: JSON.stringify({ message: `Record with ID ${id} not found in any table.` }),
    };

  } catch (error) {
    console.error('Update Employee Error:', error);
    if (error instanceof SyntaxError) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Malformed JSON.' }) };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to update record', error: error.message }),
    };
  }
};

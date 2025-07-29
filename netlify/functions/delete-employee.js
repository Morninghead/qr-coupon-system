// /netlify/functions/delete-employee.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
  // Enforce POST request method
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Allow': 'POST' },
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  try {
    // 1. Authentication and Authorization (Superuser only)
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token' }) };
    }
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'superuser') {
      return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required for deletion.' }) };
    }

    // 2. Parse ID from the request body
    const { id } = JSON.parse(event.body);
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Missing required field `id`.' }) };
    }

    // 3. Attempt to delete from 'employees' table first
    let { data: deletedItem, error: regularError } = await supabaseAdmin.from('employees').delete().eq('id', id).select().single();
    
    // Throw only if it's a real database error, not just 'not found'
    if (regularError && regularError.code !== 'PGRST116') { // PGRST116 is PostgREST code for "not found"
        throw regularError;
    }

    if (deletedItem) {
      // Success: Found and deleted from the 'employees' table.
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: `Regular employee '${deletedItem.name}' was deleted successfully.` }),
      };
    }

    // 4. If not found, attempt to delete from 'temporary_coupon_requests'
    let { data: tempDeletedItem, error: tempError } = await supabaseAdmin.from('temporary_coupon_requests').delete().eq('id', id).select().single();
    
    if (tempError && tempError.code !== 'PGRST116') {
        throw tempError;
    }

    if (tempDeletedItem) {
      // Success: Found and deleted from the temporary table.
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: `Temporary employee '${tempDeletedItem.temp_employee_name}' was deleted successfully.` }),
      };
    }

    // 5. If not found in either table, return 404
    return {
      statusCode: 404,
      body: JSON.stringify({ message: `Record with ID ${id} not found in any table.` }),
    };

  } catch (error) {
    console.error('Delete Employee Error:', error);
    if (error instanceof SyntaxError) {
      return { statusCode: 400, body: JSON.stringify({ message: 'Bad Request: Malformed JSON.' }) };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to delete employee', error: error.message }),
    };
  }
};

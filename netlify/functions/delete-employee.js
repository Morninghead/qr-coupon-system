import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์ลบข้อมูล
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

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

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        // การลบพนักงานควรจำกัดเฉพาะ superuser เท่านั้น เพื่อความปลอดภัย
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // 2. Parse Request Body
        const { id, type } = JSON.parse(event.body);

        if (!id || !type) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee ID or type for deletion.' }) };
        }

        let deleteResult = null;
        let bucketToDeletePhotoFrom = null; // To track which storage bucket to delete from
        let fileNameToDelete = null; // To track the file name for deletion

        if (type === 'regular') {
            // Before deleting the employee, try to get their photo_url and permanent_token
            // to delete their associated photo and potentially QR code image
            const { data: employeeData, error: fetchError } = await supabaseAdmin
                .from('employees')
                .select('employee_id, photo_url')
                .eq('id', id)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') { // If it's not just "not found" error
                 console.error('Error fetching employee data before deletion:', fetchError);
                 // Don't throw, try to proceed with deletion even if photo info fetch fails
            }

            // Attempt to delete associated photo from storage
            if (employeeData && employeeData.photo_url) {
                // Extract filename from photo_url
                const photoUrlParts = employeeData.photo_url.split('/');
                const photoFileName = photoUrlParts[photoUrlParts.length - 1];
                if (photoFileName) {
                    bucketToDeletePhotoFrom = 'employee-photos'; // Assuming this is your bucket for employee photos
                    fileNameToDelete = photoFileName;
                }
            }

            // Perform the deletion in the 'employees' table
            const { error } = await supabaseAdmin
                .from('employees')
                .delete()
                .eq('id', id);

            if (error) throw error;
            deleteResult = { success: true, message: `Regular employee with ID ${id} deleted.` };

        } else if (type === 'temp') {
            // For temporary coupon requests, we might also have an associated QR code image
            const { data: tempRequestData, error: fetchError } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .select('issued_token')
                .eq('id', id)
                .single();
            
            if (fetchError && fetchError.code !== 'PGRST116') {
                 console.error('Error fetching temporary request data before deletion:', fetchError);
            }

            // Attempt to delete associated temporary QR code image
            if (tempRequestData && tempRequestData.issued_token) {
                 // Assuming temp QR filenames are temp-<UUID>.png
                 // Note: If issued_token for existing employees is their permanent_token,
                 // we DO NOT want to delete their permanent QR image.
                 // This logic must only apply to *new* temporary QR tokens generated.
                 const isTempUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(tempRequestData.issued_token);
                 // We need a way to differentiate if this issued_token was a newly generated UUID for a 'new-temp' or a permanent_token.
                 // The 'employee_id' field in temporary_coupon_requests is null for 'new-temp'.
                 const { data: checkTempType, error: checkTempTypeError } = await supabaseAdmin
                     .from('temporary_coupon_requests')
                     .select('employee_id')
                     .eq('id', id)
                     .single();

                 if (!checkTempTypeError && checkTempType && checkTempType.employee_id === null && isTempUUID) {
                    // This is definitely a new temporary individual, and issued_token is its UUID.
                    bucketToDeletePhotoFrom = 'temporary-qrcodes'; // Your bucket for temporary QRs
                    fileNameToDelete = `temp-${tempRequestData.issued_token}.png`; // Adjust filename pattern if different
                 } else {
                     console.log(`Skipping temporary QR deletion for ID ${id}. Either not a new temp QR or issued_token is permanent token.`);
                 }
            }


            // Perform the deletion in the 'temporary_coupon_requests' table
            const { error } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .delete()
                .eq('id', id);

            if (error) throw error;
            deleteResult = { success: true, message: `Temporary employee request with ID ${id} deleted.` };

        } else {
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid employee type for deletion.' }) };
        }

        // Attempt to delete file from storage if identified
        if (bucketToDeletePhotoFrom && fileNameToDelete) {
            console.log(`Attempting to delete file ${fileNameToDelete} from bucket ${bucketToDeletePhotoFrom}`);
            const { error: deleteFileError } = await supabaseAdmin.storage
                .from(bucketToDeletePhotoFrom)
                .remove([fileNameToDelete]);
            
            if (deleteFileError) {
                console.error(`Error deleting associated file ${fileNameToDelete}:`, deleteFileError);
                // Don't fail the main operation just because file deletion failed
                deleteResult.message += ` (Warning: Could not delete associated file ${fileNameToDelete}.)`;
            } else {
                console.log(`Successfully deleted file ${fileNameToDelete} from bucket ${bucketToDeletePhotoFrom}`);
            }
        }


        return {
            statusCode: 200,
            body: JSON.stringify(deleteResult),
        };

    } catch (error) {
        console.error('Delete Employee Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to delete employee', error: error.message }),
        };
    }
};
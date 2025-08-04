import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import qrcode from 'qrcode';

// Use the Admin client to have full access
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

const QR_CODE_BUCKET = 'employee-qrcodes';
// This should be the URL for your public-facing status check page
const BASE_URL_FOR_QR = 'https://ssth-ecoupon.netlify.app/check-status'; 

export const handler = async (event) => {
    // This function should be protected. Anyone with the link can run it.
    // For a one-time use, this is okay.
    try {
        // 1. Find all employees that are missing a permanent_token
        const { data: employeesToUpdate, error: findError } = await supabaseAdmin
            .from('employees')
            .select('id, employee_id, name')
            .is('permanent_token', null);

        if (findError) throw findError;

        if (!employeesToUpdate || employeesToUpdate.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No employees needed a QR code update.' })
            };
        }

        let updatedCount = 0;
        const errors = [];

        // 2. Loop through each employee and generate their token and QR code
        for (const employee of employeesToUpdate) {
            try {
                const permanent_token = randomUUID();
                const qrCodeData = `${BASE_URL_FOR_QR}?token=${permanent_token}`;
                const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });
                const qrCodePath = `${employee.employee_id}.png`; // Simplified path

                // 3. Upload the QR code image to Supabase Storage
                const { error: uploadError } = await supabaseAdmin.storage
                    .from(QR_CODE_BUCKET)
                    .upload(qrCodePath, qrCodeBuffer, {
                        contentType: 'image/png',
                        upsert: true 
                    });
                if (uploadError) throw uploadError;
                
                const { data: urlData } = supabaseAdmin.storage.from(QR_CODE_BUCKET).getPublicUrl(qrCodePath);

                // 4. Update the employee record with the new token and URL
                const { error: updateError } = await supabaseAdmin
                    .from('employees')
                    .update({
                        permanent_token: permanent_token,
                        qr_code_url: urlData.publicUrl
                    })
                    .eq('id', employee.id);
                if (updateError) throw updateError;
                
                updatedCount++;
            } catch (err) {
                console.error(`Failed to process QR for employee ${employee.employee_id}:`, err.message);
                errors.push(`${employee.employee_id}: ${err.message}`);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Backfill process completed.',
                total_found: employeesToUpdate.length,
                updated_successfully: updatedCount,
                failed_count: errors.length,
                errors: errors
            }),
        };

    } catch (error) {
        console.error('Backfill QR Code Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};
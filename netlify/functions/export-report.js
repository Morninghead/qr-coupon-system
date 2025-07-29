// /netlify/functions/export-report.js

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Helper function remains unchanged
async function fetchAllData(query) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data.length === 0) break;
        allData = allData.concat(data);
        page++;
    }
    return allData;
}

export const handler = async (event) => {
    // Authentication remains unchanged
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) return { statusCode: 401, body: 'Authentication required' };
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) return { statusCode: 401, body: 'Invalid token' };

    const { startDate, endDate, departmentId, departmentName, format } = event.queryStringParameters;
    const startOfDay = `${startDate} 00:00:00`;
    const endOfDay = `${endDate} 23:59:59`;

    try {
        // --- Data fetching logic remains unchanged ---
        let regularQuery = supabaseAdmin
            .from('daily_coupons')
            .select('coupon_date, coupon_type, status, employees!inner(employee_id, name, departments(name))')
            .gte('coupon_date', startDate)
            .lte('coupon_date', endDate)
            .order('coupon_date', { ascending: true });
        
        if (departmentId && departmentId !== 'all') {
            regularQuery = regularQuery.eq('employees.department_id', departmentId);
        }
        const regularCoupons = await fetchAllData(regularQuery);

        let tempCoupons = [];
        if (!departmentId || departmentId === 'all') {
            const tempQuery = supabaseAdmin
                .from('temporary_coupon_requests')
                .select('created_at, temp_employee_name, coupon_type, status')
                .gte('created_at', startOfDay)
                .lte('created_at', endOfDay)
                .order('created_at', { ascending: true });
            tempCoupons = await fetchAllData(tempQuery);
        }

        const usedRegular = regularCoupons.filter(c => c.status === 'USED');
        const usedTemp = tempCoupons.filter(c => c.status === 'USED');

        const summary = {
            regularNormal: usedRegular.filter(c => c.coupon_type === 'NORMAL').length * 45,
            regularOt: usedRegular.filter(c => c.coupon_type === 'OT').length * 45,
            tempNormal: usedTemp.filter(c => c.coupon_type === 'NORMAL').length * 45,
            tempOt: usedTemp.filter(c => c.coupon_type === 'OT').length * 45,
        };
        summary.total = summary.regularNormal + summary.regularOt + summary.tempNormal + summary.tempOt;

        if (format === 'xlsx') {
            // --- XLSX Generation logic remains unchanged ---
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Employee Coupon System';
            const summarySheet = workbook.addWorksheet('Summary');
            summarySheet.columns = [{ header: 'ประเภท', key: 'category', width: 30 }, { header: 'ยอดรวม (บาท)', key: 'amount', width: 20 }];
            summarySheet.addRow({ category: 'รายงานสรุปยอด', amount: '' });
            summarySheet.addRow({ category: `ช่วงวันที่: ${startDate} ถึง ${endDate}`, amount: '' });
            summarySheet.addRow({ category: `แผนก: ${departmentName}`, amount: '' });
            summarySheet.addRow({});
            summarySheet.addRow({ category: 'คูปองปกติ (กลางวัน)', amount: summary.regularNormal });
            summarySheet.addRow({ category: 'คูปองปกติ (โอที)', amount: summary.regularOt });
            summarySheet.addRow({ category: 'คูปองชั่วคราว (กลางวัน)', amount: summary.tempNormal });
            summarySheet.addRow({ category: 'คูปองชั่วคราว (โอที)', amount: summary.tempOt });
            summarySheet.addRow({ category: 'รวมทั้งสิ้น', amount: summary.total });
            summarySheet.findRow(9).font = { bold: true };
            summarySheet.getCell('B9').numFmt = '#,##0.00';
            ['B5','B6','B7','B8'].forEach(cell => { summarySheet.getCell(cell).numFmt = '#,##0.00'; });
            const regularSheet = workbook.addWorksheet('รายละเอียดคูปองปกติ');
            regularSheet.columns = [{ header: 'วันที่', key: 'date', width: 15 }, { header: 'รหัสพนักงาน', key: 'id', width: 15 }, { header: 'ชื่อ-สกุล', key: 'name', width: 30 }, { header: 'ประเภทคูปอง', key: 'type', width: 15 }];
            usedRegular.forEach(c => { regularSheet.addRow({ date: c.coupon_date, id: c.employees.employee_id, name: c.employees.name, type: c.coupon_type }); });
            if(usedTemp.length > 0) {
                 const tempSheet = workbook.addWorksheet('รายละเอียดคูปองชั่วคราว');
                 tempSheet.columns = [{ header: 'วันที่', key: 'date', width: 20 }, { header: 'รหัสพนักงาน', key: 'id', width: 15 }, { header: 'ชื่อ-สกุล', key: 'name', width: 30 }, { header: 'ประเภทคูปอง', key: 'type', width: 15 }];
                 usedTemp.forEach(c => { tempSheet.addRow({ date: new Date(c.created_at).toLocaleString('th-TH'), id: 'N/A', name: c.temp_employee_name, type: c.coupon_type }); });
            }
            const buffer = await workbook.xlsx.writeBuffer();
            return { statusCode: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="report-${startDate}-to-${endDate}.xlsx"`, }, body: buffer.toString('base64'), isBase64Encoded: true };

        } else if (format === 'pdf') {
            // --- PDF Generation logic ---
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            
            // *** FIX: Updated font paths to point to the new '/fonts' directory ***
            const fontPath = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
            const boldFontPath = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');
            
            doc.registerFont('Sarabun', fontPath);
            doc.registerFont('Sarabun-Bold', boldFontPath);

            // The rest of the PDF generation logic remains unchanged
            doc.font('Sarabun-Bold').fontSize(16).text('รายงานสรุปยอดการใช้คูปอง', { align: 'center' });
            doc.moveDown();
            doc.font('Sarabun').fontSize(12).text(`ช่วงวันที่: ${startDate} ถึง ${endDate}`);
            doc.text(`แผนก: ${departmentName}`);
            doc.moveDown(2);
            doc.font('Sarabun-Bold').text('สรุปยอดรวม');
            const formatCurrency = (amount) => amount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
            doc.font('Sarabun').text(` - คูปองปกติ (กลางวัน): ${formatCurrency(summary.regularNormal)} บาท`);
            doc.text(` - คูปองปกติ (โอที): ${formatCurrency(summary.regularOt)} บาท`);
            doc.text(` - คูปองชั่วคราว (กลางวัน): ${formatCurrency(summary.tempNormal)} บาท`);
            doc.text(` - คูปองชั่วคราว (โอที): ${formatCurrency(summary.tempOt)} บาท`);
            doc.font('Sarabun-Bold').text(`รวมทั้งสิ้น: ${formatCurrency(summary.total)} บาท`);
            if (usedRegular.length > 0) {
                doc.addPage().font('Sarabun-Bold').fontSize(14).text('รายละเอียดการใช้คูปองปกติ', { continued: false });
                doc.moveDown();
                usedRegular.forEach(c => { doc.font('Sarabun').fontSize(10).text(`${c.coupon_date} | ${c.employees.employee_id} | ${c.employees.name} | ${c.coupon_type}`); });
            }
            if (usedTemp.length > 0) {
                 doc.addPage().font('Sarabun-Bold').fontSize(14).text('รายละเอียดการใช้คูปองชั่วคราว', { continued: false });
                 doc.moveDown();
                 usedTemp.forEach(c => { doc.font('Sarabun').fontSize(10).text(`${new Date(c.created_at).toLocaleDateString('th-TH')} | ${c.temp_employee_name} | ${c.coupon_type}`); });
            }
            return new Promise(resolve => {
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve({ statusCode: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="report-${startDate}-to-${endDate}.pdf"` }, body: pdfBuffer.toString('base64'), isBase64Encoded: true });
                });
                doc.end();
            });
        }
        
    } catch (error) {
        console.error('Export Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: error.message }) };
    }
};

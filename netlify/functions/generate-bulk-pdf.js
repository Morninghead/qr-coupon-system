import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

// ฟังก์ชัน Helper สำหรับการสร้าง QR Code (ไม่มีการเปลี่ยนแปลง)
async function createQrCodeImage(data) {
    try {
        const dataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: 'H' });
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        return Buffer.from(base64Data, 'base64');
    } catch (err) {
        console.error('Error generating QR code:', err);
        return null;
    }
}

export const handler = async (event, context) => {
    try {
        // --- 1. การรับและเตรียมข้อมูล ---
        const { records = [] } = JSON.parse(event.body || '{ "records": [] }');
        const sampleRecords = [
            { id: 'EMP001', name: 'สมชาย ใจดี', position: 'พนักงานฝ่ายผลิต' },
            { id: 'EMP002', name: 'สมศรี มีสุข', position: 'พนักงานฝ่ายขาย' },
            { id: 'EMP003', name: 'มานะ อดทน', position: 'ผู้จัดการ' },
            { id: 'EMP004', name: 'ปิติ ยินดี', position: 'พนักงานคลังสินค้า' },
            { id: 'EMP005', name: 'วีระ กล้าหาญ', position: 'รปภ.' }
        ];
        const dataToProcess = records.length > 0 ? records : sampleRecords;
        if (dataToProcess.length === 0) {
            return { statusCode: 400, body: 'No records provided.' };
        }

        // --- 2. การเตรียมเอกสาร PDF และฟอนต์ ---
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        const fontPath = path.resolve(process.cwd(), 'fonts/NotoSansThai-Regular.ttf');
        const fontBytes = await fs.readFile(fontPath);
        const customFont = await pdfDoc.embedFont(fontBytes);

        // --- 3. หัวใจของ Logic ใหม่: การสร้าง Layout แบบ Grid 3x2 ---
        let currentPage;
        const pairsPerPage = 3;

        for (let i = 0; i < dataToProcess.length; i++) {
            const record = dataToProcess[i];
            const pairIndexOnPage = i % pairsPerPage; // คู่ที่ 0, 1, หรือ 2 บนหน้าปัจจุบัน

            // A. สร้างหน้าใหม่ทุกๆ 3 คู่ (เมื่อเริ่มต้นคู่แรกของหน้าใหม่)
            if (pairIndexOnPage === 0) {
                currentPage = pdfDoc.addPage();
            }

            const { width, height } = currentPage.getSize();
            const blockWidth = width / 2;   // แบ่งครึ่งแนวนอนสำหรับ หน้า/หลัง
            const blockHeight = height / 3; // แบ่ง 3 ส่วนแนวตั้งสำหรับแต่ละคู่

            // B. คำนวณพิกัดของ "แถว" ปัจจุบัน
            const rowY = height - (pairIndexOnPage * blockHeight);

            // C. สร้าง QR Code เพียงครั้งเดียวเพื่อใช้ทั้งหน้าและหลัง
            const qrCodeData = `EMP_ID:${record.id}`;
            const qrImageBytes = await createQrCodeImage(qrCodeData);
            if (!qrImageBytes) continue; // ข้ามไปหากสร้าง QR ไม่สำเร็จ
            const qrImage = await pdfDoc.embedPng(qrImageBytes);
            const qrDims = qrImage.scale(0.35);

            // --- D. วาดบัตรด้านหน้า (คอลัมน์ซ้าย) ---
            const frontX = 0; // เริ่มจากขอบซ้าย
            const padding = 40;
            
            // วาดข้อมูลตัวอักษรด้านหน้า
            currentPage.drawText(`รหัสพนักงาน: ${record.id}`, { x: frontX + padding, y: rowY - padding, font: customFont, size: 14 });
            currentPage.drawText(`ชื่อ: ${record.name}`, { x: frontX + padding, y: rowY - padding - 25, font: customFont, size: 12 });
            currentPage.drawText(`ตำแหน่ง: ${record.position}`, { x: frontX + padding, y: rowY - padding - 45, font: customFont, size: 10 });
            // วาดเส้นขอบเพื่อความสวยงาม
            currentPage.drawRectangle({ x: frontX + 5, y: rowY - blockHeight + 5, width: blockWidth - 10, height: blockHeight - 10, borderWidth: 0.5, borderColor: rgb(0.8, 0.8, 0.8) });

            // --- E. วาดบัตรด้านหลัง (คอลัมน์ขวา) ---
            const backX = blockWidth; // เริ่มจากกึ่งกลางหน้า
            
            // วาด QR Code ตรงกลางบัตรด้านหลัง
            currentPage.drawImage(qrImage, {
                x: backX + (blockWidth - qrDims.width) / 2, // จัดให้อยู่กึ่งกลางคอลัมน์
                y: rowY - blockHeight + (blockHeight - qrDims.height) / 2, // จัดให้อยู่กึ่งกลางแถว
                width: qrDims.width,
                height: qrDims.height,
            });
            // วาดเส้นขอบ
            currentPage.drawRectangle({ x: backX + 5, y: rowY - blockHeight + 5, width: blockWidth - 10, height: blockHeight - 10, borderWidth: 0.5, borderColor: rgb(0.8, 0.8, 0.8) });
        }

        // --- 4. บันทึกและส่งไฟล์ PDF กลับ ---
        const pdfBytes = await pdfDoc.save();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="bulk_cards_3x2.pdf"' },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('Failed to generate PDF:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', message: error.message }) };
    }
};

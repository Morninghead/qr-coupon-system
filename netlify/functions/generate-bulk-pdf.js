import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

// --- ฟังก์ชัน Helper สำหรับการสร้าง QR Code ---
// สร้าง QR Code และคืนค่าเป็น Buffer รูปภาพ PNG
async function createQrCodeImage(data) {
    try {
        // สร้าง QR Code เป็น Data URL แล้วแปลงเป็น Buffer
        const dataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: 'H' });
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        return Buffer.from(base64Data, 'base64');
    } catch (err) {
        console.error('Error generating QR code:', err);
        return null;
    }
}

// --- Netlify Function Handler ---
export const handler = async (event, context) => {
    // 1. รับข้อมูลจาก Request Body
    // ในสถานการณ์จริง ข้อมูลนี้จะมาจาก event.body
    // ตัวอย่างนี้ใช้ข้อมูลจำลองเพื่อการสาธิต
    const { records } = JSON.parse(event.body || '{ "records": [] }');

    // ใช้ข้อมูลจำลองหากไม่มีข้อมูลส่งมา
    const sampleRecords = [
        { id: 'EMP001', name: 'สมชาย ใจดี', position: 'พนักงานฝ่ายผลิต' },
        { id: 'EMP002', name: 'สมศรี มีสุข', position: 'พนักงานฝ่ายขาย' },
        { id: 'EMP003', name: 'มานะ อดทน', position: 'ผู้จัดการ' },
        { id: 'EMP004', name: 'ปิติ ยินดี', position: 'พนักงานคลังสินค้า' },
        { id: 'EMP005', name: 'วีระ กล้าหาญ', position: 'เจ้าหน้าที่รักษาความปลอดภัย' }
    ];
    const dataToProcess = records.length > 0 ? records : sampleRecords;

    if (dataToProcess.length === 0) {
        return {
            statusCode: 400,
            body: 'No records provided to generate PDF.',
        };
    }

    try {
        // 2. สร้างเอกสาร PDF และโหลดฟอนต์
        const pdfDoc = await PDFDocument.create();
        
        // โหลดฟอนต์ภาษาไทย (ต้องแน่ใจว่า path ถูกต้องและไฟล์ถูก include ใน netlify.toml)
        const fontPath = path.resolve(process.cwd(), 'netlify/functions/fonts/NotoSansThai-Regular.ttf');
        const fontBytes = await fs.readFile(fontPath);
        const customFont = await pdfDoc.embedFont(fontBytes);

        // --- หัวใจของ Logic การสร้าง 2 บล็อกต่อหน้า ---
        let currentPage;
        const recordsPerPage = 2;

        for (let i = 0; i < dataToProcess.length; i++) {
            const record = dataToProcess[i];
            const recordIndexOnPage = i % recordsPerPage; // ตำแหน่งบนหน้าปัจจุบัน (0 หรือ 1)

            // A. สร้างหน้าใหม่เมื่อเริ่มต้นวาดบล็อกแรกของหน้า
            if (recordIndexOnPage === 0) {
                currentPage = pdfDoc.addPage(); // ขนาด A4 เริ่มต้น
            }

            const { width, height } = currentPage.getSize();
            const blockHeight = height / recordsPerPage;

            // B. คำนวณพิกัด Y ของบล็อกปัจจุบัน
            // บล็อกบน (index 0) เริ่มที่ด้านบนของหน้า (y=height)
            // บล็อกล่าง (index 1) เริ่มที่กึ่งกลางหน้า (y=blockHeight)
            const yOffset = height - (recordIndexOnPage * blockHeight);

            // C. สร้างและฝังรูปภาพ QR Code
            const qrCodeData = `EMP_ID:${record.id}`; // ข้อมูลที่จะใส่ใน QR Code
            const qrImageBytes = await createQrCodeImage(qrCodeData);
            const qrImage = await pdfDoc.embedPng(qrImageBytes);
            const qrDims = qrImage.scale(0.3); // ย่อขนาด QR Code

            // D. วาดเนื้อหาลงในบล็อกปัจจุบัน
            const padding = 50;
            
            // วาด QR Code ที่มุมขวาบนของบล็อก
            currentPage.drawImage(qrImage, {
                x: width - qrDims.width - padding,
                y: yOffset - qrDims.height - padding,
                width: qrDims.width,
                height: qrDims.height,
            });

            // วาดข้อมูลตัวอักษร
            currentPage.drawText(`รหัสพนักงาน: ${record.id}`, {
                x: padding,
                y: yOffset - padding,
                font: customFont,
                size: 16,
                color: rgb(0, 0, 0),
            });
            currentPage.drawText(`ชื่อ: ${record.name}`, {
                x: padding,
                y: yOffset - padding - 30, // เลื่อนลงมา 30 units
                font: customFont,
                size: 14,
                color: rgb(0.2, 0.2, 0.2),
            });
            currentPage.drawText(`ตำแหน่ง: ${record.position}`, {
                x: padding,
                y: yOffset - padding - 55, // เลื่อนลงมาอีก
                font: customFont,
                size: 12,
                color: rgb(0.4, 0.4, 0.4),
            });
            
            // วาดเส้นแบ่งระหว่างบล็อก (ยกเว้นบล็อกสุดท้ายของหน้า)
            if (recordIndexOnPage < recordsPerPage - 1) {
                currentPage.drawLine({
                    start: { x: padding, y: yOffset - blockHeight },
                    end: { x: width - padding, y: yOffset - blockHeight },
                    thickness: 0.5,
                    color: rgb(0.8, 0.8, 0.8),
                });
            }
        }

        // 3. บันทึกไฟล์ PDF และส่งกลับ
        const pdfBytes = await pdfDoc.save();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="bulk_document.pdf"'
            },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('Failed to generate PDF:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error', message: error.message }),
        };
    }
};

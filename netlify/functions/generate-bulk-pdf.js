import { PDFDocument, rgb, PageSizes } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

// --- ฟังก์ชัน Helper ---
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

// ฟังก์ชันสำหรับวาดเส้นตัดรอบบัตร
function drawCutMarks(page, x, y, width, height) {
    const lineLength = 15; // ความยาวของเส้นตัด
    const color = rgb(0.7, 0.7, 0.7);
    const thickness = 0.5;
    const dashArray = [3, 3];

    // วาดเส้นประ (Dashe Lines) เป็นแนวตัด
    // Top-Left
    page.drawLine({ start: { x: x - lineLength, y: y + height }, end: { x: x + lineLength, y: y + height }, color, thickness, dashArray });
    page.drawLine({ start: { x: x, y: y + height + lineLength }, end: { x: x, y: y + height - lineLength }, color, thickness, dashArray });
    // Top-Right
    page.drawLine({ start: { x: x + width - lineLength, y: y + height }, end: { x: x + width + lineLength, y: y + height }, color, thickness, dashArray });
    page.drawLine({ start: { x: x + width, y: y + height + lineLength }, end: { x: x + width, y: y + height - lineLength }, color, thickness, dashArray });
    // Bottom-Left
    page.drawLine({ start: { x: x - lineLength, y: y }, end: { x: x + lineLength, y: y }, color, thickness, dashArray });
    page.drawLine({ start: { x: x, y: y + lineLength }, end: { x: x, y: y - lineLength }, color, thickness, dashArray });
    // Bottom-Right
    page.drawLine({ start: { x: x + width - lineLength, y: y }, end: { x: x + width + lineLength, y: y }, color, thickness, dashArray });
    page.drawLine({ start: { x: x + width, y: y + lineLength }, end: { x: x + width, y: y - lineLength }, color, thickness, dashArray });
}


export const handler = async (event, context) => {
    try {
        // --- 1. การเตรียมข้อมูล ---
        const { records = [] } = JSON.parse(event.body || '{ "records": [] }');
        const sampleRecords = [
            { id: 'EMP001', name: 'สมชาย ใจดี', position: 'พนักงานฝ่ายผลิต' },
            { id: 'EMP002', name: 'สมศรี มีสุข', position: 'พนักงานฝ่ายขาย' },
            { id: 'EMP003', name: 'มานะ อดทน', position: 'ผู้จัดการ' },
        ];
        const dataToProcess = records.length > 0 ? records : sampleRecords;
        if (dataToProcess.length === 0) return { statusCode: 400, body: 'No records provided.' };

        // --- 2. การเตรียมเอกสารและฟอนต์ ---
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const fontPath = path.resolve(process.cwd(), 'fonts/NotoSansThai-Regular.ttf');
        const fontBytes = await fs.readFile(fontPath);
        const customFont = await pdfDoc.embedFont(fontBytes);

        // --- 3. การตั้งค่า Layout ตามขนาดบัตรมาตรฐาน ---
        // ใช้ขนาดบัตรมาตรฐาน CR80 (85.6mm x 53.98mm) แปลงเป็นหน่วย points (1mm = 2.835 points)
        const CARD_WIDTH = 85.6 * 2.835;  // ~242.6 points
        const CARD_HEIGHT = 53.98 * 2.835; // ~153.0 points
        
        const pairsPerPage = 3;
        let currentPage;

        for (let i = 0; i < dataToProcess.length; i++) {
            const record = dataToProcess[i];
            const pairIndexOnPage = i % pairsPerPage;

            if (pairIndexOnPage === 0) {
                currentPage = pdfDoc.addPage(PageSizes.A4);
            }

            const page = currentPage;
            const { width: pageWidth, height: pageHeight } = page.getSize();
            
            // คำนวณตำแหน่งเริ่มต้นเพื่อจัดให้อยู่กึ่งกลางหน้า
            const totalContentWidth = CARD_WIDTH * 2;
            const totalContentHeight = CARD_HEIGHT * 3;
            const marginX = (pageWidth - totalContentWidth) / 2;
            const marginY = (pageHeight - totalContentHeight) / 2;

            // คำนวณตำแหน่งของแถวปัจจุบัน
            const rowY = pageHeight - marginY - (pairIndexOnPage * CARD_HEIGHT) - CARD_HEIGHT;

            // --- 4. วาดบัตรหน้าและหลังตามขนาดมาตรฐาน ---
            const padding = 20;

            // --- วาดบัตรด้านหน้า (ซ้าย) ---
            const frontX = marginX;
            drawCutMarks(page, frontX, rowY, CARD_WIDTH, CARD_HEIGHT);
            // เนื้อหา
            page.drawText(`รหัส: ${record.id}`, { x: frontX + padding, y: rowY + CARD_HEIGHT - padding - 10, font: customFont, size: 11 });
            page.drawText(`ชื่อ: ${record.name}`, { x: frontX + padding, y: rowY + CARD_HEIGHT - padding - 30, font: customFont, size: 10 });
            page.drawText(`ตำแหน่ง: ${record.position}`, { x: frontX + padding, y: rowY + CARD_HEIGHT - padding - 48, font: customFont, size: 9 });

            // --- วาดบัตรด้านหลัง (ขวา) ---
            const backX = marginX + CARD_WIDTH;
            drawCutMarks(page, backX, rowY, CARD_WIDTH, CARD_HEIGHT);
            // เนื้อหา (QR Code)
            const qrCodeData = `EMP_ID:${record.id}`;
            const qrImageBytes = await createQrCodeImage(qrCodeData);
            if (qrImageBytes) {
                const qrImage = await pdfDoc.embedPng(qrImageBytes);
                const qrDims = qrImage.scale(0.3); // ปรับขนาด QR Code ตามความเหมาะสม
                page.drawImage(qrImage, {
                    x: backX + (CARD_WIDTH - qrDims.width) / 2,
                    y: rowY + (CARD_HEIGHT - qrDims.height) / 2,
                    width: qrDims.width,
                    height: qrDims.height,
                });
            }
        }
        
        // --- 5. บันทึกและส่งไฟล์ PDF ---
        const pdfBytes = await pdfDoc.save();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="standard_size_cards.pdf"' },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('Failed to generate PDF:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error', message: error.message }) };
    }
};

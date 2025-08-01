import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit'; // <<< FIX 1: Import fontkit
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

// ... (ฟังก์ชัน createQrCodeImage ไม่มีการเปลี่ยนแปลง)
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
        // ... (ส่วนการรับข้อมูล records เหมือนเดิม)
        const { records = [] } = JSON.parse(event.body || '{ "records": [] }');
        const sampleRecords = [
            { id: 'EMP001', name: 'สมชาย ใจดี', position: 'พนักงานฝ่ายผลิต' },
            { id: 'EMP002', name: 'สมศรี มีสุข', position: 'พนักงานฝ่ายขาย' },
        ];
        const dataToProcess = records.length > 0 ? records : sampleRecords;
        if (dataToProcess.length === 0) {
            return { statusCode: 400, body: 'No records provided.' };
        }

        const pdfDoc = await PDFDocument.create();
        
        // <<< FIX 2: ลงทะเบียน fontkit กับเอกสาร PDF ของคุณ
        pdfDoc.registerFontkit(fontkit);

        // โค้ดส่วนที่เหลือทำงานได้ตามปกติแล้ว เพราะเราลงทะเบียน fontkit แล้ว
        const fontPath = path.resolve(process.cwd(), 'fonts/NotoSansThai-Regular.ttf');
        const fontBytes = await fs.readFile(fontPath);
        const customFont = await pdfDoc.embedFont(fontBytes);

        // ... (ส่วนที่เหลือของโค้ดในการสร้าง PDF ไม่มีการเปลี่ยนแปลง) ...
        let currentPage;
        const recordsPerPage = 2;

        for (let i = 0; i < dataToProcess.length; i++) {
            const record = dataToProcess[i];
            const recordIndexOnPage = i % recordsPerPage;

            if (recordIndexOnPage === 0) { currentPage = pdfDoc.addPage(); }

            const { width, height } = currentPage.getSize();
            const blockHeight = height / recordsPerPage;
            const yOffset = height - (recordIndexOnPage * blockHeight);

            const qrCodeData = `EMP_ID:${record.id}`;
            const qrImageBytes = await createQrCodeImage(qrCodeData);
            if (!qrImageBytes) continue;
            const qrImage = await pdfDoc.embedPng(qrImageBytes);
            const qrDims = qrImage.scale(0.3);

            const padding = 50;
            
            currentPage.drawImage(qrImage, {
                x: width - qrDims.width - padding,
                y: yOffset - qrDims.height - padding,
                width: qrDims.width,
                height: qrDims.height,
            });

            currentPage.drawText(`รหัสพนักงาน: ${record.id}`, { x: padding, y: yOffset - padding, font: customFont, size: 16 });
            currentPage.drawText(`ชื่อ: ${record.name}`, { x: padding, y: yOffset - padding - 30, font: customFont, size: 14 });
            currentPage.drawText(`ตำแหน่ง: ${record.position}`, { x: padding, y: yOffset - padding - 55, font: customFont, size: 12 });
            
            if (recordIndexOnPage < recordsPerPage - 1) {
                currentPage.drawLine({
                    start: { x: padding, y: yOffset - blockHeight },
                    end: { x: width - padding, y: yOffset - blockHeight },
                    thickness: 0.5,
                    color: rgb(0.8, 0.8, 0.8),
                });
            }
        }

        const pdfBytes = await pdfDoc.save();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="bulk_document.pdf"' },
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

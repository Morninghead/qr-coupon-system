import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

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
    // 1. รับข้อมูลจาก Request Body อย่างปลอดภัย
    // <<< FIX: เพิ่ม Default Value เป็น Array ว่าง ([]) เพื่อป้องกัน error
    const { records = [] } = JSON.parse(event.body || '{ "records": [] }');

    // ใช้ข้อมูลจำลองหากไม่มีข้อมูลจาก request body ส่งมา
    const sampleRecords = [
        { id: 'EMP001', name: 'สมชาย ใจดี', position: 'พนักงานฝ่ายผลิต' },
        { id: 'EMP002', name: 'สมศรี มีสุข', position: 'พนักงานฝ่ายขาย' },
        { id: 'EMP003', name: 'มานะ อดทน', position: 'ผู้จัดการ' },
        { id: 'EMP004', name: 'ปิติ ยินดี', position: 'พนักงานคลังสินค้า' },
        { id: 'EMP005', name: 'วีระ กล้าหาญ', position: 'เจ้าหน้าที่รักษาความปลอดภัย' }
    ];
    
    // Logic นี้จะทำงานถูกต้องเสมอ เพราะ records จะเป็น array เสมอ
    const dataToProcess = records.length > 0 ? records : sampleRecords;

    if (dataToProcess.length === 0) {
        return {
            statusCode: 400,
            body: 'No records provided to generate PDF.',
        };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        const fontPath = path.resolve(process.cwd(), 'netlify/functions/fonts/NotoSansThai-Regular.ttf');
        const fontBytes = await fs.readFile(fontPath);
        const customFont = await pdfDoc.embedFont(fontBytes);

        let currentPage;
        const recordsPerPage = 2;

        for (let i = 0; i < dataToProcess.length; i++) {
            const record = dataToProcess[i];
            const recordIndexOnPage = i % recordsPerPage;

            if (recordIndexOnPage === 0) {
                currentPage = pdfDoc.addPage();
            }

            const { width, height } = currentPage.getSize();
            const blockHeight = height / recordsPerPage;
            const yOffset = height - (recordIndexOnPage * blockHeight);

            const qrCodeData = `EMP_ID:${record.id}`;
            const qrImageBytes = await createQrCodeImage(qrCodeData);
            const qrImage = await pdfDoc.embedPng(qrImageBytes);
            const qrDims = qrImage.scale(0.3);

            const padding = 50;
            
            currentPage.drawImage(qrImage, {
                x: width - qrDims.width - padding,
                y: yOffset - qrDims.height - padding,
                width: qrDims.width,
                height: qrDims.height,
            });

            currentPage.drawText(`รหัสพนักงาน: ${record.id}`, {
                x: padding,
                y: yOffset - padding,
                font: customFont,
                size: 16,
                color: rgb(0, 0, 0),
            });
            currentPage.drawText(`ชื่อ: ${record.name}`, {
                x: padding,
                y: yOffset - padding - 30,
                font: customFont,
                size: 14,
                color: rgb(0.2, 0.2, 0.2),
            });
            currentPage.drawText(`ตำแหน่ง: ${record.position}`, {
                x: padding,
                y: yOffset - padding - 55,
                font: customFont,
                size: 12,
                color: rgb(0.4, 0.4, 0.4),
            });
            
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
